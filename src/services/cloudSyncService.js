import { supabase, isSupabaseConfigured } from './supabase';
import { exportData, importData } from './backupService';
import { getDatabase, persistWebStore } from './database';
import { DATA_CHANGED_EVENT, notifyDataChanged } from './dataEvents';
import { authService } from './authService';

export const LAST_SYNC_KEY = 'fazatak_last_cloud_sync';
export const SYNC_STATUS_EVENT = 'fazatak:cloud-sync-status';

let autoSyncTimeout = null;
let isSyncInProgress = false;
let isImportingCloud = false;
let autoSyncInitialized = false;

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

    // 1. عند حدوث أي عملية (إضافة عميل، عقد، سداد قسط، تعديل، حذف): حفظ ومزامنة فورية (50ms)
    window.addEventListener(DATA_CHANGED_EVENT, (e) => {
      if (isImportingCloud) return;
      this.triggerAutoSync(null, 50);
    });

    // 2. عند عودة الاتصال بالإنترنت: رفع المعاملات فوراً
    window.addEventListener('online', () => {
      this.triggerAutoSync(null, 0);
    });

    // 3. عند الرجوع للتطبيق/التبويب: التأكد من سلامة المزامنة ورفع أي تغيير معلق
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          const userPhone = authService.getCurrentUser()?.phone;
          if (userPhone) {
            this.syncWithCloud(userPhone).catch((err) => {
              console.warn('[AutoSync] Background sync check warning:', err);
            });
          }
        }
      });
    }

    // 4. عند إغلاق التطبيق أو إخفاء الشاشة: رفع فوري دون أي تأخير لأي معاملة معلقة
    if (typeof window !== 'undefined') {
      const flushPendingSync = () => {
        const userPhone = authService.getCurrentUser()?.phone;
        const hasPendingSync = localStorage.getItem('fazatak_has_pending_cloud_sync') === 'true';
        if (userPhone && hasPendingSync && !isImportingCloud) {
          if (autoSyncTimeout) {
            clearTimeout(autoSyncTimeout);
            autoSyncTimeout = null;
          }
          this.backupUserToCloud(userPhone).catch(err => {
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

    const db = await getDatabase();
    const tables = ['customers', 'contracts', 'installments', 'expenses', 'managers', 'custody', 'settings'];

    for (const tableName of tables) {
      const cloudRows = cloudPayload.tables[tableName];
      if (!Array.isArray(cloudRows) || cloudRows.length === 0) continue;

      for (const row of cloudRows) {
        if (row.id !== undefined && row.id !== null) {
          try {
            const checkSql = `SELECT * FROM ${tableName} WHERE id = ?`;
            const existing = await db.query(checkSql, [row.id]);
            if (existing.values && existing.values.length > 0) {
              const localRow = existing.values[0];

              // 🛡️ حماية خاصة للأقساط: إذا سُدد القسط محلياً، لا نسمح للسحابة القديمة بإرجاعه لغير مسدد أبداً
              if (tableName === 'installments') {
                const isLocallyPaid = String(localRow.status || '').toLowerCase() === 'paid' || Number(localRow.actual_paid || 0) > 0;
                const isCloudPaid = String(row.status || '').toLowerCase() === 'paid' || Number(row.actual_paid || 0) > 0;
                if (isLocallyPaid && !isCloudPaid) {
                  console.log(`[SafeMerge] 🛡️ حماية السداد المحلي للقسط #${row.id} ومنع إرجاعه لغير مسدد.`);
                  continue;
                }
              }

              // 🛡️ حماية خاصة للعملاء: لا نسمح للسحابة بحذف عميل نشط محلياً
              if (tableName === 'customers') {
                if (!localRow.is_deleted && row.is_deleted) {
                  console.log(`[SafeMerge] 🛡️ حماية العميل المحلي #${row.id} ومنع حذفه.`);
                  continue;
                }
              }

              const cols = Object.keys(row).filter(c => c !== 'id');
              if (cols.length > 0) {
                const setClause = cols.map(c => `${c} = ?`).join(', ');
                const values = [...cols.map(c => row[c] ?? null), row.id];
                await db.run(`UPDATE ${tableName} SET ${setClause} WHERE id = ?`, values, false);
              }
            } else {
              const cols = Object.keys(row);
              const placeholders = cols.map(() => '?').join(', ');
              const values = cols.map(c => row[c] ?? null);
              await db.run(`INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders})`, values, false);
            }
          } catch (rowErr) {
            console.warn(`[SafeMerge] Note merging row in ${tableName}:`, rowErr.message);
          }
        }
      }
    }

    // تأكيد حفظ الدمج في SQLite WebStore محلياً
    await persistWebStore();

    // تحديث كاش المستخدم المحلي في localStorage برقم هاتفه
    const currentUserPhone = authService.getCurrentUser()?.phone;
    if (currentUserPhone) {
      try {
        const fullPayload = await exportData();
        localStorage.setItem(`fazatak_user_cache_${currentUserPhone}`, JSON.stringify(fullPayload));
      } catch {}
    }
  },

  /**
   * جدولة مزامنة سحابية تلقائية فائقة السرعة وفورية (50ms)
   */
  triggerAutoSync(phone = null, delayMs = 50) {
    if (isImportingCloud) return;

    const userPhone = phone || authService.getCurrentUser()?.phone;
    if (!userPhone || !isSupabaseConfigured() || !supabase) return;

    if (autoSyncTimeout) {
      clearTimeout(autoSyncTimeout);
    }

    notifySyncStatus('pending');

    autoSyncTimeout = setTimeout(async () => {
      autoSyncTimeout = null;
      if (isSyncInProgress) return;

      isSyncInProgress = true;
      notifySyncStatus('syncing');

      try {
        const res = await this.backupUserToCloud(userPhone);
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
   * رفع وحفظ نسخة من بيانات ومعاملات العميل الحالية إلى السحابة
   * مربوطة برقم هاتف العميل (ID المستخدم)
   */
  async backupUserToCloud(phone) {
    if (!phone) {
      return { success: false, reason: 'no_phone' };
    }

    try {
      const payload = await exportData();
      const recordsCount = Object.values(payload.counts || {}).reduce((acc, c) => acc + c, 0);

      // 🛡️ حفظ فوري محلي في localStorage مرتبط برقم هاتف المستخدم (يدعم العمل بدون إنترنت)
      try {
        localStorage.setItem(`fazatak_user_cache_${phone}`, JSON.stringify(payload));
      } catch (cacheErr) {
        console.warn('[LocalCache] User cache write warning:', cacheErr);
      }

      if (!isSupabaseConfigured() || !supabase) {
        return { success: true, localOnly: true, recordsCount };
      }

      // 🛡️ حماية كبرى: لا تسمح برفع قاعدة بيانات فارغة ومسح السحابة إذا كان لدى العميل بيانات سابقة بالسحابة
      const existingCloud = await this.getCloudBackup(phone);
      if (existingCloud && (existingCloud.records_count || 0) > 0 && recordsCount === 0) {
        console.warn(`🛑 [CloudSync] القاعدة المحلية فارغة والسحابة تحتوي على ${existingCloud.records_count} سجل للرقم ${phone}. جاري استرجاع بيانات العميل وحمايتها من المسح!`);
        isImportingCloud = true;
        try {
          await this.safeMergeCloudData(existingCloud.backup_payload);
          notifyDataChanged({ scope: 'all', action: 'prevent-wipe-restore' });
          return { success: true, restoredFromCloud: true, recordsCount: existingCloud.records_count };
        } finally {
          isImportingCloud = false;
        }
      }

      const record = {
        user_phone: phone,
        backup_payload: payload,
        records_count: recordsCount,
        updated_at: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from('fazatak_user_data')
        .upsert(record, { onConflict: 'user_phone' })
        .select('id, updated_at, records_count')
        .single();

      if (error) {
        console.warn('[CloudSync] Backup to cloud failed:', error.message);
        return { success: false, error: error.message };
      }

      const syncTime = data?.updated_at || new Date().toISOString();
      localStorage.setItem(LAST_SYNC_KEY, syncTime);
      localStorage.removeItem('fazatak_has_pending_cloud_sync');
      localStorage.setItem('fazatak_last_synced_mutation', Date.now().toString());
      return { success: true, recordsCount, updatedAt: syncTime };
    } catch (err) {
      console.error('[CloudSync] Unexpected error during cloud backup:', err);
      return { success: false, error: err.message };
    }
  },

  /**
   * جلب أحدث نسخة سحابية مسجلة للعميل
   */
  async getCloudBackup(phone) {
    if (!phone || !isSupabaseConfigured() || !supabase) return null;

    try {
      const { data, error } = await supabase
        .from('fazatak_user_data')
        .select('user_phone, backup_payload, records_count, updated_at')
        .eq('user_phone', phone)
        .maybeSingle();

      if (error) {
        console.warn('[CloudSync] Failed to fetch cloud backup:', error.message);
        return null;
      }

      return data;
    } catch (err) {
      console.error('[CloudSync] Error fetching cloud data:', err);
      return null;
    }
  },

  /**
   * مزامنة ذكية: دمج آمن بين السحابة والجهاز دون حذف أي بيانات
   * مربوطة بهوية العميل (رقم الهاتف)
   */
  async syncWithCloud(phone) {
    if (!phone || isImportingCloud) return;

    try {
      const localPayload = await exportData();
      const localCustomersCount = localPayload.tables?.customers?.length || 0;

      const cloudRecord = await this.getCloudBackup(phone);
      const cloudCustomersCount = cloudRecord?.backup_payload?.tables?.customers?.length || 0;

      // 🛡️ حماية قصوى: إذا كان SQLite فارغاً لكن السحابة بها بيانات، استرجع فوراً دون أي تردد
      if (localCustomersCount === 0 && cloudCustomersCount > 0) {
        console.log(`[CloudSync] SQLite فارغة والسحابة تحتوي على بيانات (${cloudCustomersCount} عميل): جاري الاسترجاع الفوري...`);
        isImportingCloud = true;
        try {
          await this.safeMergeCloudData(cloudRecord.backup_payload);
          localStorage.setItem(LAST_SYNC_KEY, cloudRecord.updated_at);
          localStorage.removeItem('fazatak_has_pending_cloud_sync');
          notifySyncStatus('synced', {
            lastSync: cloudRecord.updated_at,
            recordsCount: cloudRecord.records_count
          });
          notifyDataChanged({ scope: 'all', action: 'cloud-auto-restore' });
        } finally {
          isImportingCloud = false;
        }
        return;
      }

      // فحص العمليات المعلقة بعد التأكد من أن المحلي ليس فارغاً في وجود سحابة ممتلئة
      const hasPendingSync = localStorage.getItem('fazatak_has_pending_cloud_sync') === 'true';
      const localLastMutation = Number(localStorage.getItem('fazatak_last_local_mutation') || 0);
      const localLastSync = Number(new Date(localStorage.getItem(LAST_SYNC_KEY) || 0).getTime());

      if (hasPendingSync || (localLastMutation > 0 && localLastMutation > localLastSync)) {
        console.log('⚡ [CloudSync] اكتشاف عمليات محلية جديدة: رفع فوري للسحابة لحمايتها...');
        await this.backupUserToCloud(phone);
        return;
      }

      if (!cloudRecord || !cloudRecord.updated_at) return;

      // إذا كان المحلي به بيانات والسحابة فارغة
      if (localCustomersCount > 0 && cloudCustomersCount === 0) {
        console.log('[CloudSync] المحلي به بيانات والسحابة فارغة: رفع البيانات للسحابة...');
        await this.backupUserToCloud(phone);
        return;
      }

      const cloudDate = new Date(cloudRecord.updated_at).getTime();
      const localDate = localLastSync;

      // إذا كانت السحابة أحدث
      if (cloudDate > localDate + 3000 && cloudRecord.backup_payload) {
        console.log('[CloudSync] السحابة أحدث: دمج آمن في قاعدة البيانات المحلية...');
        isImportingCloud = true;
        try {
          await this.safeMergeCloudData(cloudRecord.backup_payload);
          localStorage.setItem(LAST_SYNC_KEY, cloudRecord.updated_at);
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
   * استرجاع وتطبيق بيانات ومعاملات العميل السحابية على المتصفح/الجهاز الحالي
   */
  async restoreUserFromCloud(phone) {
    const cloudRecord = await this.getCloudBackup(phone);
    if (!cloudRecord || !cloudRecord.backup_payload) {
      return { success: false, message: 'لا توجد بيانات سحابية مسجلة لهذا الحساب حتى الآن' };
    }

    try {
      isImportingCloud = true;
      await this.safeMergeCloudData(cloudRecord.backup_payload);
      localStorage.setItem(LAST_SYNC_KEY, cloudRecord.updated_at);
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
      throw new Error(`فشل استرجاع البيانات السحابية: ${err.message}`);
    } finally {
      isImportingCloud = false;
    }
  },

  /**
   * عند تسجيل الدخول أو فتح التطبيق: فحص واسترجاع ذكي فوري برقم الهاتف
   */
  async checkAndAutoRestoreOnLogin(phone) {
    if (!phone) return { restored: false };

    try {
      const localPayload = await exportData();
      const localCustomersCount = localPayload.tables?.customers?.length || 0;

      // 1. أولاً: فحص كاش المستخدم المحلي في localStorage برقم هاتفه
      const cachedRaw = localStorage.getItem(`fazatak_user_cache_${phone}`);
      let cached = null;
      try { if (cachedRaw) cached = JSON.parse(cachedRaw); } catch {}
      const cachedCustomersCount = cached?.tables?.customers?.length || 0;

      // إذا كانت قاعدة SQLite فارغة لكن يوجد كاش محلي محفوظ لهذا الرقم، استرجع فوراً!
      if (localCustomersCount === 0 && cachedCustomersCount > 0) {
        console.log(`[AutoRestore] SQLite فارغة، جاري الاستعادة فوراً من الكاش المحلي للمستخدم: ${phone}`);
        isImportingCloud = true;
        try {
          await this.safeMergeCloudData(cached);
          notifyDataChanged({ scope: 'all', action: 'cache-restore' });
        } finally {
          isImportingCloud = false;
        }
      }

      // 2. ثانياً: فحص السحابة Supabase لهذا الرقم
      const cloudRecord = await this.getCloudBackup(phone);
      if (cloudRecord && cloudRecord.backup_payload) {
        const cloudCustomersCount = cloudRecord.backup_payload.tables?.customers?.length || 0;
        
        // إعادة فحص المحلي بعد احتمالية استرجاع الكاش
        const currentPayload = await exportData();
        const currentCustomersCount = currentPayload.tables?.customers?.length || 0;

        if (currentCustomersCount === 0 && cloudCustomersCount > 0) {
          console.log(`[AutoRestore] SQLite فارغة، جاري الاستعادة من سحابة Supabase للرقم: ${phone}`);
          isImportingCloud = true;
          try {
            await this.safeMergeCloudData(cloudRecord.backup_payload);
            localStorage.setItem(LAST_SYNC_KEY, cloudRecord.updated_at);
            localStorage.removeItem('fazatak_has_pending_cloud_sync');
            notifySyncStatus('synced', {
              lastSync: cloudRecord.updated_at,
              recordsCount: cloudRecord.records_count
            });
            notifyDataChanged({ scope: 'all', action: 'cloud-restore' });
            return { restored: true, recordsCount: cloudRecord.records_count };
          } finally {
            isImportingCloud = false;
          }
        } else if (currentCustomersCount > 0 && cloudCustomersCount === 0) {
          console.log(`[CloudSync] الجهاز به بيانات والسحابة فارغة: حفظ بالسحابة للرقم: ${phone}`);
          await this.backupUserToCloud(phone);
        } else if (currentCustomersCount > 0 && cloudCustomersCount > 0) {
          await this.syncWithCloud(phone);
        }
      } else {
        // لا يوجد سجل سحابي، إذا كان الجهاز به بيانات احفظها بالسحابة فوراً
        const currentPayload = await exportData();
        if ((currentPayload.tables?.customers?.length || 0) > 0) {
          await this.backupUserToCloud(phone);
        }
      }

      return { restored: false };
    } catch (e) {
      console.warn('[CloudSync] Auto restore check bypassed:', e);
      return { restored: false };
    }
  }
};
