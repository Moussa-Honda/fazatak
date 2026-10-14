import { supabase, isSupabaseConfigured } from './supabase';
import { normalizePhone, toE164Phone } from './phoneNumber';

export { normalizePhone, toE164Phone };

const AUTH_STORAGE_KEY = 'fazatak_auth_user';
const APP_LOCK_STORAGE_KEY = 'fazatak_app_lock';
const DEVICE_LOCK_SALT = 'FAZATAK_2026_SECURITY_SALT_';

const hashDeviceLockPin = async (pin, phone) => {
  const bytes = new TextEncoder().encode(`${DEVICE_LOCK_SALT}${phone}_${String(pin).trim()}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const requireSupabase = () => {
  if (!isSupabaseConfigured() || !supabase) {
    throw new Error('تسجيل الدخول الآمن غير مهيأ حاليًا. يرجى المحاولة لاحقًا.');
  }
  return supabase;
};

const readCachedUser = () => {
  try {
    return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
};

const saveCachedUser = (user) => {
  if (!user) localStorage.removeItem(AUTH_STORAGE_KEY);
  else localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
};

export const authService = {
  getCurrentUser() {
    const user = readCachedUser();
    if (user?.subscription_expiry && new Date(user.subscription_expiry).getTime() < Date.now()) {
      user.subscription_status = 'expired';
      saveCachedUser(user);
    }
    return user;
  },

  setCurrentUser(user) {
    saveCachedUser(user);
  },

  async restoreSession() {
    const cached = this.getCurrentUser();
    if (!supabase) return cached;

    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) return cached;

    const { data, error } = await supabase.rpc('fazatak_get_my_profile');
    if (error) {
      console.warn('[Auth] Profile refresh deferred:', error.message);
      return cached?.auth_user_id === session.user.id ? cached : null;
    }
    if (!data) return cached?.auth_user_id === session.user.id ? cached : null;

    saveCachedUser(data);
    return data;
  },

  getAppLockSettings(phone = this.getCurrentUser()?.phone) {
    try {
      const settings = JSON.parse(localStorage.getItem(APP_LOCK_STORAGE_KEY) || 'null');
      return settings?.phone === normalizePhone(phone) ? settings : null;
    } catch {
      return null;
    }
  },

  isAppLockEnabled(phone = this.getCurrentUser()?.phone) {
    const settings = this.getAppLockSettings(phone);
    return Boolean(settings?.enabled && settings?.pinHash);
  },

  async setAppLockPin(pin, phone = this.getCurrentUser()?.phone) {
    const cleanPhone = normalizePhone(phone);
    const cleanPin = String(pin || '').trim();
    if (!cleanPhone) throw new Error('انتهت جلسة المستخدم. يرجى تسجيل الدخول من جديد.');
    if (!/^\d{4,6}$/.test(cleanPin)) throw new Error('رمز القفل يجب أن يكون من 4 إلى 6 أرقام');
    const pinHash = await hashDeviceLockPin(cleanPin, cleanPhone);
    localStorage.setItem(APP_LOCK_STORAGE_KEY, JSON.stringify({ phone: cleanPhone, pinHash, enabled: true }));
    return { success: true };
  },

  async verifyAppLockPin(pin, phone = this.getCurrentUser()?.phone) {
    const settings = this.getAppLockSettings(phone);
    if (!settings?.enabled || !settings?.pinHash) return false;
    return (await hashDeviceLockPin(String(pin || '').trim(), normalizePhone(phone))) === settings.pinHash;
  },

  async disableAppLock(pin, phone = this.getCurrentUser()?.phone) {
    if (!(await this.verifyAppLockPin(pin, phone))) throw new Error('رمز القفل غير صحيح');
    localStorage.removeItem(APP_LOCK_STORAGE_KEY);
    return { success: true };
  },

  async requestPhoneCode(phone, name = '') {
    const client = requireSupabase();
    const phoneE164 = toE164Phone(phone);
    if (name && String(name).trim().length < 2) throw new Error('يرجى إدخال اسم صحيح');

    const { error } = await client.auth.signInWithOtp({
      phone: phoneE164,
      options: {
        shouldCreateUser: true,
        data: name ? { full_name: String(name).trim().slice(0, 120) } : undefined,
      },
    });
    if (error) throw new Error('تعذر إرسال رمز التحقق. تأكد من الرقم وحاول لاحقًا.');
    return { success: true, phone: phoneE164 };
  },

  async verifyPhoneCode(phone, token, name = '') {
    const client = requireSupabase();
    const phoneE164 = toE164Phone(phone);
    const cleanToken = String(token || '').replace(/\D/g, '');
    if (!/^\d{6}$/.test(cleanToken)) throw new Error('أدخل رمز التحقق المكوّن من 6 أرقام');

    const { data: verified, error: verifyError } = await client.auth.verifyOtp({
      phone: phoneE164,
      token: cleanToken,
      type: 'sms',
    });
    if (verifyError || !verified.session) throw new Error('رمز التحقق غير صحيح أو منتهي الصلاحية');

    const { data: profile, error: profileError } = await client.rpc('fazatak_finish_phone_signin', {
      p_display_name: String(name || '').trim().slice(0, 120) || null,
    });
    if (profileError || !profile?.account_number) {
      await client.auth.signOut();
      saveCachedUser(null);
      console.error('[Auth] Secure account setup failed:', profileError?.message);
      throw new Error('تم التحقق من الهاتف، لكن إعداد الحساب الآمن لم يكتمل بعد. يرجى التواصل مع الدعم.');
    }

    saveCachedUser(profile);
    return profile;
  },

  async register({ name, phone }) {
    if (!String(name || '').trim() || String(name).trim().length < 2) {
      throw new Error('يرجى إدخال الاسم الكامل');
    }
    return this.requestPhoneCode(phone, name);
  },

  async login(phone, token, name = '') {
    return this.verifyPhoneCode(phone, token, name);
  },

  logout() {
    if (supabase) supabase.auth.signOut().catch((error) => console.warn('[Auth] Sign out failed:', error));
    saveCachedUser(null);
  },

  async changePassword() {
    throw new Error('تسجيل الدخول يستخدم رمز تحقق للهاتف؛ كلمة مرور الحساب غير مستخدمة.');
  },

  async recoverPassword(phone, _token, name = '') {
    return this.requestPhoneCode(phone, name);
  },

  async refreshSubscription() {
    const currentUser = this.getCurrentUser();
    if (!currentUser || !supabase) return currentUser;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session && session.user.id !== currentUser.auth_user_id) return null;
      const { data, error } = await supabase.rpc('fazatak_get_my_profile');
      if (!error && data) {
        saveCachedUser(data);
        return data;
      }
    } catch (error) {
      console.warn('[Auth] Could not refresh profile:', error);
    }
    return currentUser;
  },

  async activateOrExtendSubscription() {
    throw new Error('تجديد الاشتراك بالكود متوقف مؤقتًا إلى حين تفعيل التحقق الآمن من جهة الخادم.');
  },
};
