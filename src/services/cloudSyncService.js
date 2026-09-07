import { supabase, isSupabaseConfigured } from './supabase';
import { exportData, importData } from './backupService';
import { getDatabase } from './database';

const LAST_SYNC_KEY = 'fazatak_last_cloud_sync';

export const cloudSyncService = {
  /**
   * رفع وحفظ نسخة من بيانات ومعاملات العميل الحالية إلى السحابة
   */
  async backupUserToCloud(phone) {
    if (!phone || !isSupabaseConfigured() || !supabase) {
      return { success: false, reason: 'offline_or_unconfigured' };
    }

    try {
      // تصدير كافة جداول قاعدة البيانات المحلية
      const payload = await exportData();
      const recordsCount = Object.values(payload.counts || {}).reduce((acc, c) => acc + c, 0);

      const record = {
        user_phone: phone,
        backup_payload: payload,
        records_count: recordsCount,
        updated_at: new Date().toISOString()
      };

      // حفظ أو تحديث بيانات العميل في السحابة
      const { data, error } = await supabase
        .from('fazatak_user_data')
        .upsert(record, { onConflict: 'user_phone' })
        .select('id, updated_at, records_count')
        .single();

      if (error) {
        console.warn('[CloudSync] Backup to cloud failed:', error.message);
        return { success: false, error: error.message };
      }

      localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
      return { success: true, recordsCount, updatedAt: data?.updated_at };
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
   * استرجاع وتطبيق بيانات ومعاملات العميل السحابية على المتصفح/الجهاز الحالي
   */
  async restoreUserFromCloud(phone) {
    const cloudRecord = await this.getCloudBackup(phone);
    if (!cloudRecord || !cloudRecord.backup_payload) {
      return { success: false, message: 'لا توجد بيانات سحابية مسجلة لهذا الحساب حتى الآن' };
    }

    try {
      await importData(cloudRecord.backup_payload);
      localStorage.setItem(LAST_SYNC_KEY, cloudRecord.updated_at);
      return {
        success: true,
        recordsCount: cloudRecord.records_count,
        updatedAt: cloudRecord.updated_at
      };
    } catch (err) {
      console.error('[CloudSync] Failed to import cloud data:', err);
      throw new Error(`فشل استرجاع البيانات السحابية: ${err.message}`);
    }
  },

  /**
   * فحص المتصفح الجديد عند تسجيل الدخول: إذا كانت قاعدة البيانات فارغة، يتم الاسترجاع تلقائياً
   */
  async checkAndAutoRestoreOnLogin(phone) {
    try {
      const db = await getDatabase();
      const res = await db.query('SELECT COUNT(*) as count FROM customers');
      const customerCount = Number(res.values?.[0]?.count || 0);

      // إذا كان المتصفح جديداً ولا يحتوي على عملاء
      if (customerCount === 0) {
        const cloudRecord = await this.getCloudBackup(phone);
        if (cloudRecord && cloudRecord.backup_payload && cloudRecord.records_count > 0) {
          console.log('[CloudSync] New browser/empty database detected. Auto-restoring cloud transactions...');
          await importData(cloudRecord.backup_payload);
          return { restored: true, recordsCount: cloudRecord.records_count };
        }
      }
      return { restored: false };
    } catch (e) {
      console.warn('[CloudSync] Auto restore check bypassed:', e);
      return { restored: false };
    }
  }
};
