import { createClient } from '@supabase/supabase-js';
import { apiRequest, getSessionToken } from './apiClient';
import { authService } from './authService';

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
  try {
    if (!getSessionToken()) return { ok: false, error: 'يلزم تسجيل الدخول للتحقق من الحساب.' };
    await apiRequest('auth/profile');
    await apiRequest('sync/data');
    return { ok: true, tableReady: true };
  } catch (err) {
    return { ok: false, error: err.message || 'فشل الاتصال بالخادم' };
  }
};

/**
 * حفظ نسخة احتياطية سحابية كاملة في Supabase
 */
export const saveCloudBackup = async (backupPayload) => {
  const user = authService.getCurrentUser();
  if (!user?.account_number || !getSessionToken()) throw new Error('يلزم تسجيل الدخول لحفظ نسخة سحابية.');
  const { record: current } = await apiRequest('sync/data');
  const counts = Object.values(backupPayload.counts || {}).reduce((total, count) => total + count, 0);
  const { record } = await apiRequest('sync/data', {
    method: 'PUT',
    body: {
      backupPayload,
      recordsCount: counts,
      expectedUpdatedAt: current?.updated_at || null,
    },
  });
  return { success: true, record: { id: user.account_number, created_at: record.updated_at } };
};

/**
 * جلب قائمة النسخ الاحتياطية السحابية من Supabase
 */
export const listCloudBackups = async (limit = 10) => {
  if (!getSessionToken()) return [];
  const { record } = await apiRequest('sync/data');
  if (!record) return [];
  return [{
    id: authService.getCurrentUser()?.account_number,
    file_name: 'نسخة أقساطي السحابية',
    version: record.backup_payload?.version || '2.0-offline',
    records_count: record.records_count,
    tables_count: Object.keys(record.backup_payload?.tables || {}).length,
    created_at: record.updated_at,
  }].slice(0, Math.max(1, Math.min(Number(limit) || 10, 50)));
};

/**
 * استعادة نسخة احتياطية سحابية محددة بالمعرف
 */
export const getCloudBackupById = async (id) => {
  const user = authService.getCurrentUser();
  if (!getSessionToken() || !user?.account_number || String(id) !== String(user.account_number)) {
    throw new Error('لا يمكن الوصول إلى نسخة حساب آخر.');
  }
  const { record } = await apiRequest('sync/data');
  if (!record?.backup_payload) throw new Error('لا توجد نسخة سحابية لهذا الحساب.');
  return record.backup_payload;
};
