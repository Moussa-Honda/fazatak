import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = () => Boolean(supabaseUrl && supabaseKey);

export const supabase = isSupabaseConfigured()
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true
      }
    })
  : null;

/**
 * اختبار الاتصال بمشروع Supabase
 */
export const testSupabaseConnection = async () => {
  if (!supabase) {
    return { ok: false, error: 'لم يتم تكوين بيانات Supabase في متغيرات البيئة.' };
  }

  try {
    // محاولة قراءة خفيفة للتحقق من الاتصال
    const { error } = await supabase.from('fazatak_backups').select('id').limit(1);
    if (error && error.code !== 'PGRST116' && error.code !== '42P01') {
      // 42P01 يعني أن الجدول غير منشأ بعد لكن الاتصال والتوثيق سليم 100%
      return { ok: false, error: error.message };
    }
    return { ok: true, tableReady: error?.code !== '42P01' };
  } catch (err) {
    return { ok: false, error: err.message || 'فشل الاتصال بـ Supabase' };
  }
};

/**
 * حفظ نسخة احتياطية سحابية كاملة في Supabase
 */
export const saveCloudBackup = async (backupPayload) => {
  if (!supabase) {
    throw new Error('Supabase غير مهيأ، يرجى ضبط VITE_SUPABASE_URL و VITE_SUPABASE_PUBLISHABLE_KEY');
  }

  const record = {
    file_name: backupPayload.fileName || 'Fazatak_Main_Backup.json',
    version: backupPayload.version || '2.0-offline',
    records_count: Object.values(backupPayload.counts || {}).reduce((a, b) => a + b, 0),
    tables_count: Object.keys(backupPayload.tables || {}).length,
    backup_data: backupPayload,
    created_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('fazatak_backups')
    .insert([record])
    .select();

  if (error) {
    console.error('Supabase backup error:', error);
    throw new Error(`فشل رفع النسخة إلى Supabase: ${error.message}`);
  }

  return { success: true, record: data?.[0] };
};

/**
 * جلب قائمة النسخ الاحتياطية السحابية من Supabase
 */
export const listCloudBackups = async (limit = 10) => {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('fazatak_backups')
    .select('id, file_name, version, records_count, tables_count, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('Failed to list cloud backups:', error.message);
    return [];
  }

  return data || [];
};

/**
 * استعادة نسخة احتياطية سحابية محددة بالمعرف
 */
export const getCloudBackupById = async (id) => {
  if (!supabase) throw new Error('Supabase غير مهيأ');

  const { data, error } = await supabase
    .from('fazatak_backups')
    .select('backup_data')
    .eq('id', id)
    .single();

  if (error) {
    throw new Error(`فشل استرجاع النسخة: ${error.message}`);
  }

  return data.backup_data;
};
