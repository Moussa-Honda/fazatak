import { createClient } from '@supabase/supabase-js';

const sanitizeSupabaseUrl = (url) => {
  if (!url || typeof url !== 'string') return null;
  let trimmed = url.trim();
  if (!trimmed) return null;

  // Extract from markdown link if pasted as [url](url) or similar
  const markdownMatch = trimmed.match(/\((https?:\/\/[^)]+)\)/) || trimmed.match(/\[(https?:\/\/[^\]]+)\]/);
  if (markdownMatch) {
    trimmed = markdownMatch[1];
  }
  trimmed = trimmed.replaceAll('[', '').replaceAll(']', '').replace(/[()\s]/g, '');

  // Auto-prepend https:// if protocol was omitted
  const withProtocol = (!trimmed.startsWith('http://') && !trimmed.startsWith('https://'))
    ? `https://${trimmed}`
    : trimmed;

  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.origin;
    }
  } catch {
    return null;
  }
  return null;
};

const sanitizeSupabaseKey = (key) => {
  if (!key || typeof key !== 'string') return null;
  const cleaned = key.trim().replaceAll('[', '').replaceAll(']', '').replace(/[()`'"\s]/g, '');
  return cleaned.length > 10 ? cleaned : null;
};

const DEFAULT_SUPABASE_URL = 'https://ehufhgulrubgnntmdhxn.supabase.co';
const DEFAULT_SUPABASE_KEY = 'sb_publishable_5O9wP_WCo3zqIkNzI_8Cpg_hYFM9NGC';

const rawUrl = import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
const rawKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_KEY;

const supabaseUrl = sanitizeSupabaseUrl(rawUrl);
const supabaseKey = sanitizeSupabaseKey(rawKey);

export const isSupabaseConfigured = () => Boolean(supabaseUrl && supabaseKey && supabaseKey.length > 10);

let client = null;
if (isSupabaseConfigured()) {
  try {
    client = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true
      }
    });
  } catch (err) {
    console.warn('[Supabase] Failed to initialize Supabase client:', err);
    client = null;
  }
}

export const supabase = client;

/**
 * اختبار الاتصال بمشروع Supabase
 */
export const testSupabaseConnection = async () => {
  if (!supabase) {
    return { ok: false, error: 'لم يتم تكوين بيانات Supabase في متغيرات البيئة.' };
  }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { ok: false, error: 'يلزم تسجيل الدخول للتحقق من الحساب.' };
    const { error } = await supabase.rpc('fazatak_get_my_profile');
    if (error) return { ok: false, error: error.message };
    return { ok: true, tableReady: true };
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

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('يلزم تسجيل الدخول الآمن لحفظ نسخة سحابية.');

  const record = {
    owner_user_id: session.user.id,
    file_name: backupPayload.fileName || 'أقساطي_Backup.json',
    version: backupPayload.version || '2.0-offline',
    records_count: Object.values(backupPayload.counts || {}).reduce((a, b) => a + b, 0),
    tables_count: Object.keys(backupPayload.tables || {}).length,
    backup_data: backupPayload,
    created_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('fazatak_backups')
    .insert([record])
    .select('id, created_at')
    .single();

  if (error) {
    console.error('Supabase backup error:', error);
    throw new Error(`فشل رفع النسخة إلى Supabase: ${error.message}`);
  }

  const { data: oldRecords } = await supabase
    .from('fazatak_backups')
    .select('id')
    .eq('owner_user_id', session.user.id)
    .order('created_at', { ascending: false })
    .range(10, 1000);

  if (oldRecords?.length) {
    await supabase
      .from('fazatak_backups')
      .delete()
      .eq('owner_user_id', session.user.id)
      .in('id', oldRecords.map((item) => item.id));
  }

  return { success: true, record: data };
};

/**
 * جلب قائمة النسخ الاحتياطية السحابية من Supabase
 */
export const listCloudBackups = async (limit = 10) => {
  if (!supabase) return [];

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return [];

  const { data, error } = await supabase
    .from('fazatak_backups')
    .select('id, file_name, version, records_count, tables_count, created_at')
    .eq('owner_user_id', session.user.id)
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(Number(limit) || 10, 50)));

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

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('يلزم تسجيل الدخول الآمن لاستعادة نسخة سحابية.');

  const { data, error } = await supabase
    .from('fazatak_backups')
    .select('backup_data')
    .eq('id', id)
    .eq('owner_user_id', session.user.id)
    .single();

  if (error) {
    throw new Error(`فشل استرجاع النسخة: ${error.message}`);
  }

  return data.backup_data;
};
