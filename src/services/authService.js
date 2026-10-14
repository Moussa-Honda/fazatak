import { apiRequest, getSessionToken, setSessionToken } from './apiClient';
import { normalizePhone } from './phoneNumber';

export { normalizePhone };

const AUTH_STORAGE_KEY = 'fazatak_auth_user';
const APP_LOCK_STORAGE_KEY = 'fazatak_app_lock';
const HASH_SALT_PREFIX = 'FAZATAK_2026_SECURITY_SALT_';

const hashSecureValue = async (value, saltKey = '') => {
  const bytes = new TextEncoder().encode(`${HASH_SALT_PREFIX}${saltKey}_${String(value || '').trim()}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
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

const throwAuthError = (error) => {
  const messages = {
    invalid_credentials: 'رقم الهاتف أو كلمة المرور غير صحيحة.',
    too_many_attempts: 'محاولات كثيرة. انتظر دقيقة ثم حاول مجددًا.',
    auth_unavailable: 'خدمة تسجيل الدخول غير جاهزة بعد. حاول لاحقًا.',
    account_exists: 'رقم الهاتف مسجل مسبقًا. سجّل الدخول إلى الحساب الموجود.',
    invalid_recovery: 'رقم الهاتف أو رمز الاسترجاع غير صحيح.',
    invalid_password: 'كلمة المرور الحالية غير صحيحة أو كلمة المرور الجديدة غير صالحة.',
    invalid_registration: 'تحقق من الاسم ورقم الهاتف وكلمة المرور ورمز PIN.',
    service_unavailable: 'الخدمة غير متاحة مؤقتًا. لم تتغير بيانات حسابك.',
  };
  throw new Error(messages[error.code] || error.message || 'تعذر إكمال الطلب. حاول مرة أخرى.');
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

  isSubscriptionExpired() {
    const user = this.getCurrentUser();
    return Boolean(user?.subscription_expiry && new Date(user.subscription_expiry).getTime() < Date.now());
  },

  setCurrentUser(user) {
    saveCachedUser(user);
  },

  async restoreSession() {
    const cached = this.getCurrentUser();
    if (!getSessionToken()) return cached;
    try {
      const { user } = await apiRequest('auth/profile');
      saveCachedUser(user);
      return user;
    } catch (error) {
      if (error.status === 401) {
        setSessionToken('');
        saveCachedUser(null);
        return null;
      }
      return cached;
    }
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
    const pinHash = await hashSecureValue(cleanPin, `${cleanPhone}_APP_LOCK`);
    localStorage.setItem(APP_LOCK_STORAGE_KEY, JSON.stringify({ phone: cleanPhone, pinHash, enabled: true }));
    return { success: true };
  },

  async verifyAppLockPin(pin, phone = this.getCurrentUser()?.phone) {
    const settings = this.getAppLockSettings(phone);
    if (!settings?.enabled || !settings?.pinHash) return false;
    const pinHash = await hashSecureValue(String(pin || '').trim(), `${normalizePhone(phone)}_APP_LOCK`);
    return pinHash === settings.pinHash;
  },

  async disableAppLock(pin, phone = this.getCurrentUser()?.phone) {
    if (!(await this.verifyAppLockPin(pin, phone))) throw new Error('رمز القفل غير صحيح');
    localStorage.removeItem(APP_LOCK_STORAGE_KEY);
    return { success: true };
  },

  async register({ name, phone, password, pin }) {
    try {
      const result = await apiRequest('auth/register', {
        method: 'POST',
        body: { name, phone: normalizePhone(phone), password, pin },
        token: '',
      });
      setSessionToken(result.token);
      saveCachedUser(result.user);
      return result.user;
    } catch (error) {
      throwAuthError(error);
    }
  },

  async login(phone, password) {
    try {
      const result = await apiRequest('auth/login', {
        method: 'POST',
        body: { phone: normalizePhone(phone), password },
        token: '',
      });
      setSessionToken(result.token);
      saveCachedUser(result.user);
      return result.user;
    } catch (error) {
      throwAuthError(error);
    }
  },

  async changePassword(currentPassword, newPassword) {
    try {
      await apiRequest('auth/password', { method: 'POST', body: { currentPassword, newPassword } });
      return { success: true, message: 'تم تغيير كلمة المرور بنجاح.' };
    } catch (error) {
      throwAuthError(error);
    }
  },

  async recoverPassword(phone, pin, newPassword) {
    try {
      await apiRequest('auth/recover', {
        method: 'POST',
        body: { phone: normalizePhone(phone), pin, newPassword },
        token: '',
      });
      return { success: true, message: 'تم تعيين كلمة المرور الجديدة. سجّل الدخول بها الآن.' };
    } catch (error) {
      throwAuthError(error);
    }
  },

  logout() {
    setSessionToken('');
    saveCachedUser(null);
  },

  async refreshSubscription() {
    const currentUser = this.getCurrentUser();
    if (!currentUser || !getSessionToken()) return currentUser;
    try {
      const { user } = await apiRequest('auth/profile');
      saveCachedUser(user);
      return user;
    } catch (error) {
      if (error.status === 401) {
        setSessionToken('');
        saveCachedUser(null);
        return null;
      }
      return currentUser;
    }
  },

  async activateOrExtendSubscription() {
    throw new Error('تجديد الاشتراك بالكود متوقف مؤقتًا لحماية الحساب. استخدم Google Play أو تواصل مع الدعم.');
  },
};
