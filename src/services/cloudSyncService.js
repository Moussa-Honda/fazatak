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

    // 1. عند حدوث أي عملية (إضافة عميل، عقد، سداد قسط، تعديل، حذف)
    window.addEventListener(DATA_CHANGED_EVENT, (e) => {
      // تفادي التكرار إذا كان التغيير ناتجاً عن استيراد سحابي
      if (isImportingCloud) return;
      this.triggerAutoSync();
    });

    // 2. عند عودة الاتصال بالإنترنت
    window.addEventListener('online', () => {
      this.triggerAutoSync(null, 500);
    });

    // 3. عند الرجوع للتطبيق/التبويب
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

    console.log('⚡ [AutoSync] Background real-time auto-sync activated.');
  },

  /**
   * جدولة مزامنة سحابية تلقائية خفيفة (Debounced)
   */
  triggerAutoSync(phone = null, delayMs = 1500) {
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
   * مزامنة ذكية: إذا كانت السحابة تحتوي على تحديث أحدث من جهاز آخر، يتم استيراده تلقائياً
   */
  async syncWithCloud(phone) {
    if (!phone || !isSupabaseConfigured() || !supabase || isImportingCloud) return;

    try {
      const cloudRecord = await this.getCloudBackup(phone);
      if (!cloudRecord || !cloudRecord.updated_at) return;

      const localLastSync = localStorage.getItem(LAST_SYNC_KEY);
      const cloudDate = new Date(cloudRecord.updated_at).getTime();
      const localDate = localLastSync ? new Date(localLastSync).getTime() : 0;

      // إذا كان تحديث السحابة أحدث من الجهاز الحالي بأكثر من 3 ثوانٍ
      if (cloudDate > localDate + 3000 && cloudRecord.backup_payload) {
        console.log('[CloudSync] Newer data found in cloud. Auto-updating local database...');
        isImportingCloud = true;
        try {
          await importData(cloudRecord.backup_payload);
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
      await importData(cloudRecord.backup_payload);
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
   * عند تسجيل الدخول من أي جهاز جديد: يتم استرجاع المعاملات السحابية تلقائياً
   */
  async checkAndAutoRestoreOnLogin(phone) {
    if (!phone) return { restored: false };

    try {
      const cloudRecord = await this.getCloudBackup(phone);
      if (cloudRecord && cloudRecord.backup_payload && cloudRecord.records_count > 0) {
        console.log('[CloudSync] User logged in: automatically restoring all cloud transactions for:', phone);
        isImportingCloud = true;
        try {
          await importData(cloudRecord.backup_payload);
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
