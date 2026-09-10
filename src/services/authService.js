import { supabase, isSupabaseConfigured } from './supabase';

const AUTH_STORAGE_KEY = 'fazatak_auth_user';
const HASH_SALT_PREFIX = 'FAZATAK_2026_SECURITY_SALT_';

/**
 * توحيد أرقام الهواتف وتحويل الأرقام العربية إلى إنجليزية وإزالة المسافات والرموز الزائدة
 */
export const normalizePhone = (phone) => {
  if (!phone) return '';
  return String(phone)
    .trim()
    .replace(/[\u0660-\u0669]/g, (d) => d.charCodeAt(0) - 1632)
    .replace(/[\u06F0-\u06F9]/g, (d) => d.charCodeAt(0) - 1776)
    .replace(/[^\d+]/g, '');
};

/**
 * تجزئة وتشفير النصوص (كلمات المرور والـ PIN) عبر خوارزمية SHA-256 مع Salt
 */
export const hashSecureValue = async (value, saltKey = '') => {
  if (!value) return '';
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(`${HASH_SALT_PREFIX}${saltKey}_${String(value).trim()}`);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch (err) {
    console.error('Hash error:', err);
    throw new Error('فشل تشفير البيانات في المتصفح');
  }
};

export const authService = {
  /**
   * جلب بيانات المستخدم المسجل محلياً
   */
  getCurrentUser() {
    try {
      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      if (!raw) return null;
      const user = JSON.parse(raw);
      // فحص انتهاء الصلاحية محلياً في حالة عدم الاتصال
      if (user && user.subscription_expiry) {
        const isExpired = new Date(user.subscription_expiry).getTime() < Date.now();
        if (isExpired && user.subscription_status !== 'expired') {
          user.subscription_status = 'expired';
          this.setCurrentUser(user);
        }
      }
      return user;
    } catch {
      return null;
    }
  },

  /**
   * التحقق مما إذا كان اشتراك المستخدم أو فترته التجريبية منتهية الصلاحية
   */
  isSubscriptionExpired() {
    const user = this.getCurrentUser();
    if (!user || !user.subscription_expiry) return false;
    return new Date(user.subscription_expiry).getTime() < Date.now() || user.subscription_status === 'expired';
  },

  /**
   * تخزين جلسة المستخدم محلياً
   */
  setCurrentUser(user) {
    if (!user) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    } else {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
    }
  },

  /**
   * تسجيل الخروج
   */
  logout() {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  },

  /**
   * إنشاء حساب جديد للعميل
   * @param {Object} param0 { name, phone, password, pin }
   */
  async register({ name, phone, password, pin }) {
    if (!isSupabaseConfigured() || !supabase) {
      throw new Error('خدمة السحابة (Supabase) غير مهيأة في النظام. يرجى التحقق من متغيرات البيئة.');
    }

    const cleanName = String(name || '').trim();
    const cleanPhone = normalizePhone(phone);
    const cleanPass = String(password || '').trim();
    const cleanPin = String(pin || '').trim();

    // التحقق من المدخلات
    if (!cleanName || cleanName.length < 2) {
      throw new Error('يرجى إدخال اسم صحيح مكون من حرفين على الأقل');
    }
    if (!cleanPhone || cleanPhone.length < 9) {
      throw new Error('يرجى إدخال رقم هاتف صحيح مكون من 9 أرقام على الأقل');
    }
    if (!cleanPass || cleanPass.length < 6) {
      throw new Error('كلمة المرور يجب أن تتكون من 6 خانات أو أحرف على الأقل');
    }
    if (!cleanPin || cleanPin.length < 4 || !/^\d+$/.test(cleanPin)) {
      throw new Error('رمز الـ PIN يجب أن يكون أرقاماً فقط (من 4 إلى 6 أرقام) لاسترجاع الحساب');
    }

    // التحقق من عدم تكرار رقم الهاتف
    const { data: existingUser, error: checkError } = await supabase
      .from('fazatak_users')
      .select('id')
      .eq('phone', cleanPhone)
      .maybeSingle();

    if (checkError && checkError.code !== 'PGRST116') {
      console.error('Check user error:', checkError);
      throw new Error(`خطأ في التحقق من الحساب: ${checkError.message}`);
    }

    if (existingUser) {
      throw new Error('رقم الهاتف هذا مسجل مسبقاً! يرجى تسجيل الدخول أو استخدام خيار استرجاع الحساب.');
    }

    // تشفير كلمة السر ورمز الـ PIN مع رقم الهاتف كـ Salt
    const passwordHash = await hashSecureValue(cleanPass, cleanPhone);
    const pinHash = await hashSecureValue(cleanPin, cleanPhone);

    // منح فترة تجريبية مجانية لمدة 35 يوماً تلقائياً
    const trialDays = 35;
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + trialDays);

    const newUserPayload = {
      phone: cleanPhone,
      name: cleanName,
      password_hash: passwordHash,
      pin_hash: pinHash,
      subscription_status: 'trial',
      subscription_expiry: expiryDate.toISOString(),
      created_at: new Date().toISOString(),
      last_login_at: new Date().toISOString(),
      metadata: {
        registeredPlatform: typeof navigator !== 'undefined' ? navigator.userAgent : 'web',
        initialTrialDays: trialDays
      }
    };

    const { data: insertedUser, error: insertError } = await supabase
      .from('fazatak_users')
      .insert([newUserPayload])
      .select('id, phone, name, subscription_status, subscription_expiry, created_at')
      .single();

    if (insertError) {
      console.error('Registration error:', insertError);
      throw new Error(`فشل إنشاء الحساب: ${insertError.message}`);
    }

    // حفظ جلسة المستخدم
    this.setCurrentUser(insertedUser);
    return insertedUser;
  },

  /**
   * تسجيل الدخول برقم الهاتف وكلمة المرور
   */
  async login(phone, password) {
    if (!isSupabaseConfigured() || !supabase) {
      // إذا كنا في وضع عدم الاتصال وهناك جلسة محفوظة لنفس الرقم
      const cached = this.getCurrentUser();
      const cleanPhone = normalizePhone(phone);
      if (cached && cached.phone === cleanPhone) {
        return cached;
      }
      throw new Error('خدمة السحابة (Supabase) غير متصلة ولا توجد جلسة محفوظة لهذا الرقم.');
    }

    const cleanPhone = normalizePhone(phone);
    const cleanPass = String(password || '').trim();

    if (!cleanPhone || !cleanPass) {
      throw new Error('يرجى إدخال رقم الهاتف وكلمة المرور');
    }

    // جلب الحساب من Supabase
    const { data: user, error } = await supabase
      .from('fazatak_users')
      .select('id, phone, name, password_hash, subscription_status, subscription_expiry, created_at')
      .eq('phone', cleanPhone)
      .maybeSingle();

    if (error) {
      console.error('Login error:', error);
      throw new Error(`تعذر تسجيل الدخول: ${error.message}`);
    }

    if (!user) {
      throw new Error('رقم الهاتف أو كلمة المرور غير صحيحة');
    }

    // التحقق من صحة كلمة المرور عبر مطابقة الـ Hash
    const expectedHash = await hashSecureValue(cleanPass, cleanPhone);
    if (user.password_hash !== expectedHash) {
      throw new Error('رقم الهاتف أو كلمة المرور غير صحيحة');
    }

    // فحص صلاحية الاشتراك وتحديث الحالة إذا انتهى
    const isExpired = new Date(user.subscription_expiry).getTime() < Date.now();
    const currentStatus = isExpired ? 'expired' : user.subscription_status;

    // تحديث وقت آخر تسجيل دخول
    await supabase
      .from('fazatak_users')
      .update({
        last_login_at: new Date().toISOString(),
        subscription_status: currentStatus
      })
      .eq('id', user.id);

    // تنظيف البيانات وعدم تخزين كلمة المرور محلياً
    const safeUser = {
      id: user.id,
      phone: user.phone,
      name: user.name,
      subscription_status: currentStatus,
      subscription_expiry: user.subscription_expiry,
      created_at: user.created_at
    };

    this.setCurrentUser(safeUser);
    return safeUser;
  },

  /**
   * استرجاع الحساب وتعيين كلمة مرور جديدة عبر رمز الـ PIN
   */
  async recoverPassword(phone, pin, newPassword) {
    if (!isSupabaseConfigured() || !supabase) {
      throw new Error('خدمة السحابة غير متصلة لاسترجاع الحساب.');
    }

    const cleanPhone = normalizePhone(phone);
    const cleanPin = String(pin || '').trim();
    const cleanNewPass = String(newPassword || '').trim();

    if (!cleanPhone) throw new Error('يرجى إدخال رقم الهاتف المسجل');
    if (!cleanPin) throw new Error('يرجى إدخال رمز الـ PIN السري');
    if (!cleanNewPass || cleanNewPass.length < 6) {
      throw new Error('كلمة المرور الجديدة يجب أن تكون 6 أحرف/أرقام على الأقل');
    }

    // جلب الحساب والـ PIN Hash
    const { data: user, error } = await supabase
      .from('fazatak_users')
      .select('id, phone, name, pin_hash')
      .eq('phone', cleanPhone)
      .maybeSingle();

    if (error || !user) {
      throw new Error('رقم الهاتف هذا غير مسجل في النظام');
    }

    // التحقق من صحة رمز الـ PIN
    const enteredPinHash = await hashSecureValue(cleanPin, cleanPhone);
    if (user.pin_hash !== enteredPinHash) {
      throw new Error('رمز الـ PIN غير صحيح! تأكد من الرمز الذي قمت بتعيينه أثناء إنشاء الحساب.');
    }

    // تشفير كلمة المرور الجديدة وتحديثها في قاعدة البيانات
    const newPasswordHash = await hashSecureValue(cleanNewPass, cleanPhone);

    const { error: updateError } = await supabase
      .from('fazatak_users')
      .update({ password_hash: newPasswordHash })
      .eq('id', user.id);

    if (updateError) {
      throw new Error(`فشل تحديث كلمة المرور: ${updateError.message}`);
    }

    return { success: true, message: 'تم استرجاع الحساب وتعيين كلمة المرور الجديدة بنجاح!' };
  },

  /**
   * تحديث وفحص صلاحية الاشتراك من السحابة
   */
  async refreshSubscription() {
    const currentUser = this.getCurrentUser();
    if (!currentUser || !isSupabaseConfigured() || !supabase) return currentUser;

    try {
      const { data, error } = await supabase
        .from('fazatak_users')
        .select('subscription_status, subscription_expiry')
        .eq('phone', currentUser.phone)
        .maybeSingle();

      if (!error && data) {
        const isExpired = new Date(data.subscription_expiry).getTime() < Date.now();
        const updatedUser = {
          ...currentUser,
          subscription_status: isExpired ? 'expired' : data.subscription_status,
          subscription_expiry: data.subscription_expiry
        };
        this.setCurrentUser(updatedUser);
        return updatedUser;
      }
    } catch (e) {
      console.warn('Failed to refresh subscription from cloud:', e);
    }
    return currentUser;
  },

  /**
   * تمديد الاشتراك باستخدام كود تفعيل أو مباشرة
   */
  async activateOrExtendSubscription(days = 30) {
    const currentUser = this.getCurrentUser();
    if (!currentUser || !supabase) throw new Error('يرجى تسجيل الدخول أولاً');

    const currentExpiry = new Date(currentUser.subscription_expiry || Date.now());
    const baseDate = currentExpiry.getTime() > Date.now() ? currentExpiry : new Date();
    baseDate.setDate(baseDate.getDate() + Number(days));

    const { data, error } = await supabase
      .from('fazatak_users')
      .update({
        subscription_status: 'active',
        subscription_expiry: baseDate.toISOString()
      })
      .eq('phone', currentUser.phone)
      .select('subscription_status, subscription_expiry')
      .single();

    if (error) {
      throw new Error(`فشل تمديد الاشتراك: ${error.message}`);
    }

    const updated = {
      ...currentUser,
      subscription_status: data.subscription_status,
      subscription_expiry: data.subscription_expiry
    };
    this.setCurrentUser(updated);
    return updated;
  }
};
