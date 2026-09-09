import { supabase, isSupabaseConfigured } from './supabase';
import { exportData, importData } from './backupService';
import { getDatabase } from './database';
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
   */
  async backupUserToCloud(phone) {
    if (!phone || !isSupabaseConfigured() || !supabase) {
      return { success: false, reason: 'offline_or_unconfigured' };
    }

    try {
      const payload = await exportData();
      const recordsCount = Object.values(payload.counts || {}).reduce((acc, c) => acc + c, 0);

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
   */
  async syncWithCloud(phone) {
    if (!phone || !isSupabaseConfigured() || !supabase || isImportingCloud) return;

    try {
      // 🛡️ فحص الأولوية الأولى: هل توجد أي عملية محلية معلقة (سداد قسط، إضافة عميل، إلخ)؟
      const hasPendingSync = localStorage.getItem('fazatak_has_pending_cloud_sync') === 'true';
      const localLastMutation = Number(localStorage.getItem('fazatak_last_local_mutation') || 0);
      const localLastSync = Number(new Date(localStorage.getItem(LAST_SYNC_KEY) || 0).getTime());

      if (hasPendingSync || (localLastMutation > 0 && localLastMutation > localLastSync)) {
        console.log('⚡ [CloudSync] اكتشاف عمليات محلية جديدة معلقة: جاري رفعها للسحابة فوراً لحمايتها...');
        await this.backupUserToCloud(phone);
        return;
      }

      const cloudRecord = await this.getCloudBackup(phone);
      if (!cloudRecord || !cloudRecord.updated_at) return;

      const localPayload = await exportData();
      const localCustomersCount = localPayload.tables?.customers?.length || 0;
      const cloudCustomersCount = cloudRecord.backup_payload?.tables?.customers?.length || 0;

      // أمان مطلق: إذا كان الجهاز المحلي به عملاء والسحابة فارغة، نقوم برفع المحلي فوراً لمنع مسح أي بيانات
      if (localCustomersCount > 0 && cloudCustomersCount === 0) {
        console.log('[CloudSync] Local has customers but cloud has none. Pushing local data to cloud...');
        await this.backupUserToCloud(phone);
        return;
      }

      const cloudDate = new Date(cloudRecord.updated_at).getTime();
      const localDate = localLastSync;

      // إذا كان تحديث السحابة أحدث من الجهاز الحالي
      if (cloudDate > localDate + 3000 && cloudRecord.backup_payload) {
        console.log('[CloudSync] Newer data found in cloud. Safe-merging into local database...');
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
   * عند تسجيل الدخول من أي جهاز: دمج ذكي بدون مسح البيانات المحلية
   */
  async checkAndAutoRestoreOnLogin(phone) {
    if (!phone) return { restored: false };

    try {
      // 🛡️ فحص الأولوية الأولى: هل توجد أي عملية محلية معلقة (سداد قسط، إضافة عميل، إلخ)؟
      const hasPendingSync = localStorage.getItem('fazatak_has_pending_cloud_sync') === 'true';
      const localLastMutation = Number(localStorage.getItem('fazatak_last_local_mutation') || 0);
      const localLastSync = Number(new Date(localStorage.getItem(LAST_SYNC_KEY) || 0).getTime());

      if (hasPendingSync || (localLastMutation > 0 && localLastMutation > localLastSync)) {
        console.log('⚡ [CloudSync] تسجيل الدخول: وجود عمليات محلية جديدة، جاري رفعها للسحابة فوراً لحمايتها...');
        await this.backupUserToCloud(phone);
        return { restored: false };
      }

      const cloudRecord = await this.getCloudBackup(phone);
      if (!cloudRecord || !cloudRecord.backup_payload) {
        return { restored: false };
      }

      const localPayload = await exportData();
      const localCustomersCount = localPayload.tables?.customers?.length || 0;
      const cloudCustomersCount = cloudRecord.backup_payload?.tables?.customers?.length || 0;

      // أمان مطلق: إذا كان الجهاز المحلي به عملاء والسحابة فارغة، احفظ المحلي في السحابة فوراً
      if (localCustomersCount > 0 && cloudCustomersCount === 0) {
        console.log('[CloudSync] Login check: Local has customers, preserving and uploading to cloud...');
        await this.backupUserToCloud(phone);
        return { restored: false };
      }

      if (cloudRecord.records_count > 0) {
        console.log('[CloudSync] User logged in: safe-merging cloud transactions for:', phone);
        isImportingCloud = true;
        try {
          await this.safeMergeCloudData(cloudRecord.backup_payload);
          localStorage.setItem(LAST_SYNC_KEY, cloudRecord.updated_at);
          notifySyncStatus('synced', {
            lastSync: cloudRecord.updated_at,
            recordsCount: cloudRecord.records_count
          });
          notifyDataChanged({ scope: 'all', action: 'login-restore' });
          return { restored: true, recordsCount: cloudRecord.records_count };
        } finally {
          isImportingCloud = false;
        }
      }
      return { restored: false };
    } catch (e) {
      console.warn('[CloudSync] Auto restore check bypassed:', e);
      return { restored: false };
    }
  }
};
