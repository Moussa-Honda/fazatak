import { exportData, importData, getBusinessRecordsCount } from './backupService';
import { getDatabase, persistWebStore } from './database';
import { DATA_CHANGED_EVENT, notifyDataChanged } from './dataEvents';
import { authService } from './authService';
import { apiRequest, getSessionToken } from './apiClient';

export const LAST_SYNC_KEY = 'fazatak_last_cloud_sync';
export const SYNC_STATUS_EVENT = 'fazatak:cloud-sync-status';

let autoSyncTimeout = null;
let isSyncInProgress = false;
let isImportingCloud = false;
let autoSyncInitialized = false;

// Notification permission belongs to this device, not the cloud account.
const DEVICE_NOTIFICATION_SETTING_KEYS = [
  'due_alerts_enabled',
  'screen_privacy',
];

const preserveDeviceNotificationSettings = async (cloudPayload) => {
  if (!cloudPayload?.tables) return cloudPayload;

  const database = await getDatabase();
  const placeholders = DEVICE_NOTIFICATION_SETTING_KEYS.map(() => '?').join(', ');
  const localSettings = await database.query(
    `SELECT key, value FROM settings WHERE key IN (${placeholders})`,
    DEVICE_NOTIFICATION_SETTING_KEYS
  );
  const cloudSettings = Array.isArray(cloudPayload.tables.settings)
    ? cloudPayload.tables.settings.filter(
      (row) => !DEVICE_NOTIFICATION_SETTING_KEYS.includes(row?.key)
    )
    : [];

  return {
    ...cloudPayload,
    tables: {
      ...cloudPayload.tables,
      settings: [...cloudSettings, ...(localSettings.values || [])],
    },
  };
};

const clearLocalUserData = async (localPayload) => {
  const localTables = localPayload?.tables || {};
  const tables = Object.fromEntries(
    Object.entries(localTables).map(([tableName, rows]) => [
      tableName,
      tableName === 'settings'
        ? (Array.isArray(rows)
          ? rows.filter((row) => DEVICE_NOTIFICATION_SETTING_KEYS.includes(row?.key))
          : [])
        : []
    ])
  );

  await importData({
    app: 'fazatak',
    version: localPayload?.version || '2.0-offline',
    fileName: localPayload?.fileName || 'أقساطي_Backup.json',
    exportedAt: new Date().toISOString(),
    counts: Object.fromEntries(Object.entries(tables).map(([tableName, rows]) => [tableName, rows.length])),
    tables
  });
  await persistWebStore();
};

export const notifySyncStatus = (status, detail = {}) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SYNC_STATUS_EVENT, {
    detail: {
      status, // 'idle' | 'pending' | 'syncing' | 'synced' | 'error'
      lastSync: localStorage.getItem(LAST_SYNC_KEY),
      ...detail,
      timestamp: Date.now()
    }
  }));
};

export const cloudSyncService = {
  /**
   * تفعيل الاستماع للمزامنة التلقائية اللحظية
   * يتم استدعاؤها عند بدء تشغيل التطبيق
   */
  initAutoSyncListener() {
    if (typeof window === 'undefined' || autoSyncInitialized) return;
    autoSyncInitialized = true;

    // 1. عند حدوث أي عملية (إضافة عميل، عقد، سداد قسط، تعديل، حذف): حفظ ومزامنة فورية (100ms)
    window.addEventListener(DATA_CHANGED_EVENT, () => {
      if (isImportingCloud) return;
      this.triggerAutoSync(null, 100);
    });

    // 2. عند عودة الاتصال بالإنترنت: رفع المعاملات فوراً
    window.addEventListener('online', () => {
      this.triggerAutoSync(null, 0);
    });

    // 3. عند الرجوع للتطبيق/التبويب أو التركيز عليه: فحص السحابة لجلب أي تعديل من متصفح آخر
    if (typeof document !== 'undefined') {
      const checkRemoteUpdates = () => {
        const user = authService.getCurrentUser();
        if (user?.account_number && !isImportingCloud && !isSyncInProgress) {
          this.syncWithCloud(user.account_number, user.phone).catch((err) => {
            console.warn('[AutoSync] Focus sync check note:', err);
          });
        }
      };

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          checkRemoteUpdates();
        }
      });

      window.addEventListener('focus', checkRemoteUpdates);
    }

    // 4. عند إغلاق التطبيق أو إخفاء الشاشة: رفع فوري لأي معاملة معلقة
    if (typeof window !== 'undefined') {
      const flushPendingSync = () => {
        const user = authService.getCurrentUser();
        const hasPendingSync = localStorage.getItem('fazatak_has_pending_cloud_sync') === 'true';
        if (user?.account_number && hasPendingSync && !isImportingCloud) {
          if (autoSyncTimeout) {
            clearTimeout(autoSyncTimeout);
            autoSyncTimeout = null;
          }
          this.backupUserToCloud(user.account_number).catch(err => {
            console.warn('[AutoSync] Flush on exit note:', err);
          });
        }
      };
      window.addEventListener('beforeunload', flushPendingSync);
      window.addEventListener('pagehide', flushPendingSync);
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') {
            flushPendingSync();
          }
        });
      }
    }

    console.log('⚡ [AutoSync] Ultra-fast background real-time auto-sync activated.');
  },

  /**
   * دمج بيانات السحابة بأمان فائق دون حذف أو إرجاع أي سداد أو عميل محلي
   */
  async safeMergeCloudData(cloudPayload) {
    if (!cloudPayload || !cloudPayload.tables) return;

    const database = await getDatabase();
    const mergePayload = await preserveDeviceNotificationSettings(cloudPayload);

    // إذا كانت القاعدة المحلية خالية من المعاملات، استخدم importData الشامل والموثوق فوراً
    const localPayload = await exportData();
    const localBusinessCount = getBusinessRecordsCount(localPayload);
    if (localBusinessCount === 0) {
      await importData(mergePayload);
      await persistWebStore();
      return;
    }

    const db = database;
    const tables = [
      'settings',
      'managers',
      'customers',
      'contracts',
      'installments',
      'expenses',
      'portfolios',
      'portfolio_expenses',
      'customer_month_statuses',
      'installment_postponements'
    ];

    for (const tableName of tables) {
      const cloudRows = mergePayload.tables[tableName];
      if (!Array.isArray(cloudRows) || cloudRows.length === 0) continue;

      for (const row of cloudRows) {
        if (!row || typeof row !== 'object') continue;

        try {
          if (tableName === 'settings') {
            if (row.key) {
              await db.run(
                'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
                [row.key, row.value ?? ''],
                false
              );
            }
            continue;
          }

          if (row.id !== undefined && row.id !== null) {
            const checkSql = `SELECT * FROM ${tableName} WHERE id = ?`;
            const existing = await db.query(checkSql, [row.id]);

            if (existing.values && existing.values.length > 0) {
              const localRow = existing.values[0];

              // 🛡️ حماية خاصة للأقساط: إذا سُدد القسط محلياً، لا نسمح للسحابة القديمة بإرجاعه لغير مسدد
              if (tableName === 'installments') {
                const isLocallyPaid = String(localRow.status || '').toLowerCase() === 'paid' || Number(localRow.actual_paid || 0) > 0;
                const isCloudPaid = String(row.status || '').toLowerCase() === 'paid' || Number(row.actual_paid || 0) > 0;
                if (isLocallyPaid && !isCloudPaid) {
                  continue;
                }
              }

              // 🛡️ حماية خاصة للعملاء: لا نسمح للسحابة بحذف عميل نشط محلياً
              if (tableName === 'customers') {
                if (!localRow.is_deleted && row.is_deleted) {
                  continue;
                }
              }

              const cols = Object.keys(row).filter(c => c !== 'id');
              if (cols.length > 0) {
                const setClause = cols.map(c => `"${c}" = ?`).join(', ');
                const values = [...cols.map(c => row[c] ?? null), row.id];
                await db.run(`UPDATE ${tableName} SET ${setClause} WHERE id = ?`, values, false);
              }
            } else {
              const cols = Object.keys(row);
              const quotedCols = cols.map(c => `"${c}"`).join(', ');
              const placeholders = cols.map(() => '?').join(', ');
              const values = cols.map(c => row[c] ?? null);
              await db.run(`INSERT INTO ${tableName} (${quotedCols}) VALUES (${placeholders})`, values, false);
            }
          }
        } catch (rowErr) {
          console.warn(`[SafeMerge] Note merging row in ${tableName}:`, rowErr.message);
        }
      }
    }

    // تأكيد حفظ الدمج في SQLite WebStore محلياً
    await persistWebStore();
  },

  /**
   * جدولة مزامنة سحابية تلقائية فائقة السرعة
   */
  triggerAutoSync(accountNumber = null, delayMs = 100) {
    if (isImportingCloud) return;

    const user = authService.getCurrentUser();
    const currentAccountNumber = accountNumber || user?.account_number;
    if (!currentAccountNumber || !getSessionToken()) return;

    if (autoSyncTimeout) {
      clearTimeout(autoSyncTimeout);
    }

    localStorage.setItem('fazatak_has_pending_cloud_sync', 'true');
    notifySyncStatus('pending');

    autoSyncTimeout = setTimeout(async () => {
      autoSyncTimeout = null;
      if (isSyncInProgress || isImportingCloud) return;

      isSyncInProgress = true;
      notifySyncStatus('syncing');

      try {
        const res = await this.backupUserToCloud(currentAccountNumber);
        if (res.success) {
          notifySyncStatus('synced', {
            lastSync: res.updatedAt || new Date().toISOString(),
            recordsCount: res.recordsCount
          });
        } else {
          notifySyncStatus('error', { error: res.error });
        }
      } catch (err) {
        console.warn('[AutoSync] Background sync error:', err);
        notifySyncStatus('error', { error: err.message });
      } finally {
        isSyncInProgress = false;
      }
    }, delayMs);
  },

  /**
   * رفع وحفظ نسخة كاملة من بيانات ومعاملات العميل الحالية إلى السحابة
   * مربوطة برقم الحساب الثابت من خلال جلسة المستخدم الحالية
   */
  async backupUserToCloud(accountNumber) {
    if (!accountNumber) {
      return { success: false, reason: 'no_account_number' };
    }
    if (authService.getCurrentUser()?.account_number !== accountNumber || !getSessionToken()) {
      return { success: false, reason: 'authentication_required' };
    }

    try {
      const payload = await exportData();
      const localBusinessCount = getBusinessRecordsCount(payload);
      const totalRecordsCount = Object.values(payload.counts || {}).reduce((acc, c) => acc + c, 0);

      // 🛡️ حفظ فوري محلي في localStorage مرتبط برقم هاتف المستخدم (يدعم العمل بدون إنترنت)
      try {
        localStorage.setItem(`fazatak_user_cache_${accountNumber}`, JSON.stringify(payload));
      } catch (cacheErr) {
        console.warn('[LocalCache] User cache write warning:', cacheErr);
      }

      if (!getSessionToken()) {
        return { success: true, localOnly: true, recordsCount: totalRecordsCount };
      }

      // 🛡️ الدرع الحديدي: منع مسح السحابة نهائياً إذا كانت القاعدة المحلية خالية من المعاملات
      let existingCloud = await this.getCloudBackup(accountNumber);
      let cloudBusinessCount = getBusinessRecordsCount(existingCloud?.backup_payload);

      if (localBusinessCount === 0 && existingCloud?.backup_payload) {
        console.warn(`🛑 [Shield] تم إيقاف رفع قاعدة فارغة! السحابة تحتوي على ${cloudBusinessCount} معاملة للحساب ${accountNumber}. جاري استرجاع معاملات العميل فوراً!`);
        await this.restoreUserFromCloud(accountNumber);
        return { success: true, restoredFromCloud: true, recordsCount: existingCloud.records_count };
      }

      let uploadPayload = payload;
      let uploadRecordsCount = totalRecordsCount;
      const saveBackup = () => apiRequest('sync/data', {
        method: 'PUT',
        body: {
          backupPayload: uploadPayload,
          recordsCount: uploadRecordsCount,
          expectedUpdatedAt: existingCloud?.updated_at || null,
        },
      });

      let result;
      try {
        result = await saveBackup();
      } catch (error) {
        if (error.code !== 'sync_conflict' || !error.data?.record?.backup_payload) throw error;
        existingCloud = error.data.record;
        cloudBusinessCount = getBusinessRecordsCount(existingCloud.backup_payload);
        if (localBusinessCount === 0 && existingCloud.backup_payload) {
          await this.restoreUserFromCloud(accountNumber);
          return { success: true, restoredFromCloud: true, recordsCount: existingCloud.records_count };
        }

        isImportingCloud = true;
        try {
          await this.safeMergeCloudData(existingCloud.backup_payload);
        } finally {
          isImportingCloud = false;
        }
        uploadPayload = await exportData();
        uploadRecordsCount = Object.values(uploadPayload.counts || {}).reduce((acc, count) => acc + count, 0);
        result = await saveBackup();
      }

      const confirmedTime = result.record?.updated_at || new Date().toISOString();
      localStorage.setItem(LAST_SYNC_KEY, confirmedTime);
      localStorage.removeItem('fazatak_has_pending_cloud_sync');
      localStorage.setItem('fazatak_last_synced_mutation', Date.now().toString());
      localStorage.setItem(`fazatak_user_cache_${accountNumber}`, JSON.stringify(uploadPayload));

      return { success: true, recordsCount: uploadRecordsCount, updatedAt: confirmedTime };
    } catch (err) {
      console.error('[CloudSync] Unexpected error during cloud backup:', err);
      return { success: false, error: err.message };
    }
  },

  /**
   * جلب أحدث نسخة سحابية مسجلة للعميل
   */
  async getCloudBackup(accountNumber) {
    if (!accountNumber || !getSessionToken()) return null;
    if (authService.getCurrentUser()?.account_number !== accountNumber) return null;

    try {
      const { record } = await apiRequest('sync/data');
      return record;
    } catch (err) {
      console.error('[CloudSync] Error fetching cloud data:', err);
      return null;
    }
  },

  /**
   * مزامنة ذكية: مقارنة السحابة والمحلي ودمجهما دون فقدان أي بيانات
   */
  async syncWithCloud(accountNumber, legacyPhone = null) {
    if (!accountNumber || isImportingCloud) return;

    try {
      const localPayload = await exportData();
      const localBusinessCount = getBusinessRecordsCount(localPayload);

      const cloudRecord = await this.getCloudBackup(accountNumber);
      const cloudBusinessCount = getBusinessRecordsCount(cloudRecord?.backup_payload);

      // 🛡️ إذا كان المحلي خالياً من المعاملات والسحابة بها معاملات: استرجاع فوري
      if (localBusinessCount === 0 && cloudRecord?.backup_payload) {
        console.log(`[CloudSync] الجهاز خالي من المعاملات والسحابة بها ${cloudBusinessCount} معاملة: استرجاع فوري...`);
        await this.restoreUserFromCloud(accountNumber, legacyPhone);
        return;
      }

      // 🛡️ إذا كان المحلي به معاملات والسحابة خالية من المعاملات: رفع فوري لحمايتها
      if (localBusinessCount > 0 && !cloudRecord?.backup_payload) {
        console.log(`[CloudSync] الجهاز به ${localBusinessCount} معاملة والسحابة خالية: رفع فوري للسحابة...`);
        await this.backupUserToCloud(accountNumber);
        return;
      }

      if (!cloudRecord || !cloudRecord.updated_at) return;

      const localLastSyncStr = localStorage.getItem(LAST_SYNC_KEY);
      const cloudTime = new Date(cloudRecord.updated_at).getTime();
      const localSyncTime = localLastSyncStr ? new Date(localLastSyncStr).getTime() : 0;

      // إذا كانت السحابة أحدث بـ 2 ثوانٍ وبها معاملات: دمج ذكي
      if (cloudTime > localSyncTime + 2000 && cloudRecord.backup_payload) {
        console.log('[CloudSync] السحابة تحتوي على تحديثات أحدث من جهاز آخر: دمج ذكي...');
        isImportingCloud = true;
        try {
          await this.safeMergeCloudData(cloudRecord.backup_payload);
          localStorage.setItem(LAST_SYNC_KEY, cloudRecord.updated_at);
          localStorage.setItem(`fazatak_user_cache_${accountNumber}`, JSON.stringify(cloudRecord.backup_payload));
          notifySyncStatus('synced', {
            lastSync: cloudRecord.updated_at,
            recordsCount: cloudRecord.records_count
          });
          notifyDataChanged({ scope: 'all', action: 'cloud-auto-sync' });
        } finally {
          isImportingCloud = false;
        }
      }
    } catch (e) {
      console.warn('[CloudSync] Smart sync check note:', e);
    }
  },

  /**
   * استرجاع وتطبيق بيانات ومعاملات العميل السحابية على المتصفح/الجهاز الحالي بالكامل
   */
  async restoreUserFromCloud(accountNumber) {
    const cloudRecord = await this.getCloudBackup(accountNumber);
    if (!cloudRecord || !cloudRecord.backup_payload) {
      return { success: false, message: 'لا توجد بيانات سحابية مسجلة لهذا الحساب حتى الآن' };
    }

    try {
      isImportingCloud = true;
      // استخدام importData الموثوق الذي يكتب جميع الجداول داخل Transaction واحدة مؤمنة
      await importData(await preserveDeviceNotificationSettings(cloudRecord.backup_payload));
      await persistWebStore();

      localStorage.setItem(LAST_SYNC_KEY, cloudRecord.updated_at);
      localStorage.setItem(`fazatak_user_cache_${accountNumber}`, JSON.stringify(cloudRecord.backup_payload));
      localStorage.setItem('fazatak_current_db_account_number', accountNumber);
      localStorage.removeItem('fazatak_has_pending_cloud_sync');

      notifySyncStatus('synced', {
        lastSync: cloudRecord.updated_at,
        recordsCount: cloudRecord.records_count
      });
      notifyDataChanged({ scope: 'all', action: 'cloud-restore' });

      return {
        success: true,
        recordsCount: cloudRecord.records_count,
        updatedAt: cloudRecord.updated_at
      };
    } catch (err) {
      console.error('[CloudSync] Failed to import cloud data:', err);
      throw new Error(`فشل استرجاع البيانات السحابية: ${err.message}`, { cause: err });
    } finally {
      isImportingCloud = false;
    }
  },

  /**
   * المزامنة الشاملة عند تسجيل الدخول أو فتح التطبيق:
   * تضمن تحميل كافة المعاملات من السحابة قبل الانتقال للواجهة الرئيسية
   */
  async fullSyncOnLogin(accountNumber, { legacyPhone = null, forceIsolated = false } = {}) {
    if (!accountNumber) return { success: false };

    try {
      if (!getSessionToken()) return { success: true, localOnly: true };

      isImportingCloud = true;

      const localPayload = await exportData();
      const localBusinessCount = getBusinessRecordsCount(localPayload);

      // هل هذا المتصفح كان مسجلاً بحساب آخر؟
      const lastDbAccountNumber = localStorage.getItem('fazatak_current_db_account_number');
      const legacyLastDbPhone = localStorage.getItem('fazatak_current_db_phone');
      const isUserSwitch = forceIsolated
        || Boolean(lastDbAccountNumber && lastDbAccountNumber !== accountNumber)
        || Boolean(!lastDbAccountNumber && legacyLastDbPhone && legacyLastDbPhone !== legacyPhone)
        || Boolean(!lastDbAccountNumber && !legacyLastDbPhone && localBusinessCount > 0);

      // 1. جلب بيانات السحابة للحساب الحالي
      const cloudRecord = await this.getCloudBackup(accountNumber);
      const cloudBusinessCount = getBusinessRecordsCount(cloudRecord?.backup_payload);

      // لا تسمح لبيانات الحساب السابق بالبقاء عند تبديل الحساب أو إنشاء حساب جديد.
      // نحفظ نسخة محلية للحساب السابق قبل تنظيف قاعدة البيانات حتى لا نفقدها عند العودة إليه.
      if (isUserSwitch) {
        const previousIdentity = lastDbAccountNumber || legacyLastDbPhone;
        if (localBusinessCount > 0) {
          const cacheIdentity = previousIdentity && previousIdentity !== accountNumber && previousIdentity !== legacyPhone
            ? previousIdentity
            : 'unassigned';
          localStorage.setItem(`fazatak_user_cache_${cacheIdentity}`, JSON.stringify(localPayload));
        }

        if (cloudRecord?.backup_payload) {
          await importData(await preserveDeviceNotificationSettings(cloudRecord.backup_payload));
          await persistWebStore();
          localStorage.setItem(LAST_SYNC_KEY, cloudRecord.updated_at || new Date().toISOString());
          localStorage.setItem(`fazatak_user_cache_${accountNumber}`, JSON.stringify(cloudRecord.backup_payload));
          localStorage.setItem('fazatak_current_db_account_number', accountNumber);
          localStorage.removeItem('fazatak_has_pending_cloud_sync');
          notifyDataChanged({ scope: 'all', action: 'login-restore' });
          return { success: true, restored: true, recordsCount: cloudRecord.records_count };
        }

        await clearLocalUserData(localPayload);
        localStorage.setItem('fazatak_current_db_account_number', accountNumber);
        localStorage.removeItem(LAST_SYNC_KEY);
        localStorage.removeItem('fazatak_has_pending_cloud_sync');
        notifyDataChanged({ scope: 'all', action: 'account-switch' });
        return { success: true, switched: true, empty: true };
      }

      // 2. إذا كانت السحابة تحتوي على معاملات: استرجاعها فوراً وبشكل حاسم
      if (cloudRecord?.backup_payload) {
        if (localBusinessCount === 0) {
          console.log(`[FullSyncOnLogin] جاري استرجاع ${cloudBusinessCount} معاملة من السحابة للحساب: ${accountNumber}`);
          await importData(await preserveDeviceNotificationSettings(cloudRecord.backup_payload));
          await persistWebStore();
          localStorage.setItem(LAST_SYNC_KEY, cloudRecord.updated_at);
          localStorage.setItem(`fazatak_user_cache_${accountNumber}`, JSON.stringify(cloudRecord.backup_payload));
          localStorage.setItem('fazatak_current_db_account_number', accountNumber);
          localStorage.removeItem('fazatak_has_pending_cloud_sync');

          notifySyncStatus('synced', {
            lastSync: cloudRecord.updated_at,
            recordsCount: cloudRecord.records_count
          });
          notifyDataChanged({ scope: 'all', action: 'login-restore' });
          return { success: true, restored: true, recordsCount: cloudRecord.records_count };
        }

        await this.safeMergeCloudData(cloudRecord.backup_payload);
        const mergedPayload = await exportData();
        localStorage.setItem(LAST_SYNC_KEY, cloudRecord.updated_at || new Date().toISOString());
        localStorage.setItem(`fazatak_user_cache_${accountNumber}`, JSON.stringify(mergedPayload));
        localStorage.setItem('fazatak_current_db_account_number', accountNumber);
        notifyDataChanged({ scope: 'all', action: 'login-merge' });
        return { success: true, merged: true, recordsCount: getBusinessRecordsCount(mergedPayload) };
      }

      // 3. إذا كانت السحابة خالية ولكن الجهاز المحلي يحتوي على معاملات لنفس المستخدم: رفعها للسحابة لحمايتها
      if (localBusinessCount > 0 && !isUserSwitch) {
        console.log(`[FullSyncOnLogin] تم العثور على ${localBusinessCount} معاملة محلية والسحابة فارغة: رفع فوري لحمايتها...`);
        await this.backupUserToCloud(accountNumber);
        localStorage.setItem('fazatak_current_db_account_number', accountNumber);
        return { success: true, uploaded: true };
      }

      // 4. في حالة عدم وجود إنترنت ولكن يوجد كاش محلي سابق لنفس الرقم
      const cachedRaw = localStorage.getItem(`fazatak_user_cache_${accountNumber}`);
      let cached = null;
      try { if (cachedRaw) cached = JSON.parse(cachedRaw); } catch {}
      const cachedBusinessCount = getBusinessRecordsCount(cached);

      if (localBusinessCount === 0 && cachedBusinessCount > 0) {
        console.log(`[FullSyncOnLogin] استعادة من الكاش المحلي أوفلاين للحساب: ${accountNumber}`);
        await importData(await preserveDeviceNotificationSettings(cached));
        await persistWebStore();
        localStorage.setItem('fazatak_current_db_account_number', accountNumber);
        notifyDataChanged({ scope: 'all', action: 'cache-restore' });
        return { success: true, restoredFromCache: true };
      }

      localStorage.setItem('fazatak_current_db_account_number', accountNumber);
      return { success: true, empty: true };
    } catch (err) {
      console.warn('[FullSyncOnLogin] Login sync note:', err);
      return { success: false, error: err.message };
    } finally {
      isImportingCloud = false;
    }
  },

  /**
   * الاسم القديم متوافقاً مع الاستدعاءات السابقة
   */
  async checkAndAutoRestoreOnLogin(phone) {
    const user = authService.getCurrentUser();
    return this.fullSyncOnLogin(user?.account_number, { legacyPhone: phone || user?.phone });
  }
};

      
