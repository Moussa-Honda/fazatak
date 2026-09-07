import { useState } from 'react';
import { authService, normalizePhone } from '../services/authService';
import { cloudSyncService } from '../services/cloudSyncService';
import licenseService from '../services/license';

const SUPPORT_PHONE_DISPLAY = '+966556854162';
const SUPPORT_WHATSAPP_PHONE = '966556854162';

const AuthGate = ({ onAuthenticated, isExpired = false, initialUser = null }) => {
  const [mode, setMode] = useState(isExpired ? 'expired' : 'login'); // 'login' | 'register' | 'recover' | 'expired'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Login Form
  const [loginPhone, setLoginPhone] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Register Form
  const [regName, setRegName] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [regPin, setRegPin] = useState('');

  // Recovery Form
  const [recPhone, setRecPhone] = useState('');
  const [recPin, setRecPin] = useState('');
  const [recNewPassword, setRecNewPassword] = useState('');
  const [recConfirmPassword, setRecConfirmPassword] = useState('');

  // Activation Code for Expired Accounts
  const [activationCode, setActivationCode] = useState('');

  const currentUser = initialUser || authService.getCurrentUser();

  const handleLogin = async (e) => {
    e?.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);

    try {
      const user = await authService.login(loginPhone, loginPassword);
      
      // مزامنة واسترجاع تلقائي في حال كان المتصفح جديداً ولا توجد بيانات
      try {
        await cloudSyncService.checkAndAutoRestoreOnLogin(user.phone);
      } catch (syncErr) {
        console.warn('Auto restore sync notice:', syncErr);
      }

      if (user.subscription_status === 'expired') {
        setMode('expired');
      } else {
        onAuthenticated(user);
      }
    } catch (err) {
      setError(err.message || 'فشل تسجيل الدخول، تأكد من صحة البيانات');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e?.preventDefault();
    setError('');
    setSuccessMsg('');

    if (regPassword !== regConfirmPassword) {
      setError('كلمة المرور وتأكيدها غير متطابقين');
      return;
    }

    setLoading(true);
    try {
      const user = await authService.register({
        name: regName,
        phone: regPhone,
        password: regPassword,
        pin: regPin
      });

      setSuccessMsg('تم إنشاء حسابك بنجاح وبدء الفترة التجريبية!');
      setTimeout(() => {
        onAuthenticated(user);
      }, 1000);
    } catch (err) {
      setError(err.message || 'فشل إنشاء الحساب، يرجى المحاولة مجدداً');
    } finally {
      setLoading(false);
    }
  };

  const handleRecover = async (e) => {
    e?.preventDefault();
    setError('');
    setSuccessMsg('');

    if (recNewPassword !== recConfirmPassword) {
      setError('كلمة المرور الجديدة وتأكيدها غير متطابقين');
      return;
    }

    setLoading(true);
    try {
      const res = await authService.recoverPassword(recPhone, recPin, recNewPassword);
      setSuccessMsg(res.message);
      setLoginPhone(recPhone);
      setLoginPassword('');
      setTimeout(() => {
        setMode('login');
      }, 2000);
    } catch (err) {
      setError(err.message || 'فشل استرجاع الحساب، تأكد من رقم الهاتف ورمز الـ PIN');
    } finally {
      setLoading(false);
    }
  };

  const handleSupportWhatsApp = () => {
    const phone = currentUser?.phone || loginPhone || '';
    const message = `السلام عليكم، أريد تجديد اشتراك تطبيق فزتك لرقم الحساب: ${phone}`;
    window.open(`https://wa.me/${SUPPORT_WHATSAPP_PHONE}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const handleActivateWithCode = async () => {
    if (!activationCode.trim()) return;
    setLoading(true);
    setError('');

    try {
      // تجربة تفعيل الكود عبر خدمة الترخيص وتمديد الاشتراك
      const result = await licenseService.activateLicense(activationCode.trim());
      if (result.success) {
        await authService.activateOrExtendSubscription(30);
        const updatedUser = authService.getCurrentUser();
        setSuccessMsg('تم تجديد الاشتراك بنجاح!');
        setTimeout(() => {
          onAuthenticated(updatedUser);
        }, 1200);
      }
    } catch (err) {
      setError('كود التفعيل غير صحيح أو منتهي الصلاحية');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-slate-950/95 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto modal-safe-area" dir="rtl">
      <div className="w-full max-w-md bg-slate-900 rounded-3xl border border-slate-800/80 shadow-2xl overflow-hidden my-auto">
        
        {/* Header Banner */}
        <div className="bg-gradient-to-br from-emerald-600 via-teal-600 to-slate-900 p-6 text-center relative">
          <div className="w-16 h-16 bg-white/15 rounded-2xl flex items-center justify-center mx-auto mb-3 backdrop-blur-sm shadow-inner border border-white/20">
            <span className="text-3xl">💼</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">فزتك</h1>
          <p className="text-emerald-100/90 text-xs mt-1 font-medium">نظام التقسيط والجدولة — حساب العميل الموحد</p>
        </div>

        {/* Tabs for Login & Register (if not expired) */}
        {mode !== 'expired' && (
          <div className="flex border-b border-slate-800 bg-slate-950/60 p-1.5 gap-1.5">
            <button
              onClick={() => { setMode('login'); setError(''); setSuccessMsg(''); }}
              className={`flex-1 py-2.5 rounded-xl font-bold text-xs transition-all ${
                mode === 'login'
                  ? 'bg-emerald-600 text-white shadow-lg'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
            >
              تسجيل الدخول
            </button>
            <button
              onClick={() => { setMode('register'); setError(''); setSuccessMsg(''); }}
              className={`flex-1 py-2.5 rounded-xl font-bold text-xs transition-all ${
                mode === 'register'
                  ? 'bg-emerald-600 text-white shadow-lg'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
            >
              إنشاء حساب جديد
            </button>
          </div>
        )}

        {/* Messages */}
        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-rose-500/15 border border-rose-500/30 rounded-xl text-rose-400 text-xs flex items-center gap-2">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}
          {successMsg && (
            <div className="p-3 bg-emerald-500/15 border border-emerald-500/30 rounded-xl text-emerald-400 text-xs flex items-center gap-2">
              <span>✅</span>
              <span>{successMsg}</span>
            </div>
          )}

          {/* 1. LOGIN MODE */}
          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-slate-300 text-xs font-semibold mb-1.5">رقم الهاتف</label>
                <input
                  type="tel"
                  required
                  placeholder="مثال: 0501234567"
                  value={loginPhone}
                  onChange={(e) => setLoginPhone(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                  dir="ltr"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-slate-300 text-xs font-semibold">كلمة المرور</label>
                  <button
                    type="button"
                    onClick={() => { setMode('recover'); setError(''); setSuccessMsg(''); setRecPhone(loginPhone); }}
                    className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors underline underline-offset-4"
                  >
                    نسيت كلمة المرور؟
                  </button>
                </div>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl font-bold text-sm shadow-lg shadow-emerald-900/30 transition-all active:scale-[0.99] flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>جاري تسجيل الدخول...</span>
                  </>
                ) : (
                  <span>دخول إلى حسابي ➔</span>
                )}
              </button>

              <div className="pt-2 text-center">
                <p className="text-[11px] text-slate-400">
                  لا تملك حساباً بعد؟{' '}
                  <button
                    type="button"
                    onClick={() => { setMode('register'); setError(''); }}
                    className="text-emerald-400 hover:underline font-bold"
                  >
                    أنشئ حساباً في دقيقة
                  </button>
                </p>
              </div>
            </form>
          )}

          {/* 2. REGISTER MODE */}
          {mode === 'register' && (
            <form onSubmit={handleRegister} className="space-y-3.5">
              <div>
                <label className="block text-slate-300 text-xs font-semibold mb-1">الاسم الكامل / اسم النشاط</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: مؤسسة التقسيط المتحدة"
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>

              <div>
                <label className="block text-slate-300 text-xs font-semibold mb-1">رقم الهاتف (هوية حسابك الثابتة)</label>
                <input
                  type="tel"
                  required
                  placeholder="05xxxxxxxx"
                  value={regPhone}
                  onChange={(e) => setRegPhone(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                  dir="ltr"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-slate-300 text-xs font-semibold mb-1">كلمة المرور</label>
                  <input
                    type="password"
                    required
                    placeholder="6 خانات فأكثر"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 text-xs font-semibold mb-1">تأكيد كلمة المرور</label>
                  <input
                    type="password"
                    required
                    placeholder="تأكيد الكلمة"
                    value={regConfirmPassword}
                    onChange={(e) => setRegConfirmPassword(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>
              </div>

              {/* Secret PIN Section */}
              <div className="bg-emerald-950/40 border border-emerald-500/20 rounded-2xl p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-emerald-300 text-xs font-bold flex items-center gap-1.5">
                    <span>🔑</span>
                    <span>رمز الـ PIN لاسترجاع الحساب</span>
                  </label>
                  <span className="text-[10px] text-emerald-400/80 bg-emerald-900/60 px-2 py-0.5 rounded-full font-mono">4-6 أرقام</span>
                </div>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  placeholder="مثال: 1234"
                  value={regPin}
                  onChange={(e) => setRegPin(e.target.value.replace(/[^\d]/g, ''))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-white text-sm tracking-widest text-center font-mono focus:outline-none focus:border-emerald-500 transition-colors"
                />
                <p className="text-[10px] text-emerald-200/70 leading-relaxed">
                  احفظ هذا الرمز جيداً: هو مفتاحك لاسترجاع حسابك إذا نسيت كلمة المرور دون الحاجة لرسائل SMS.
                </p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl font-bold text-sm shadow-lg shadow-emerald-900/30 transition-all active:scale-[0.99] flex items-center justify-center gap-2 mt-1"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>جاري إنشاء الحساب...</span>
                  </>
                ) : (
                  <span>إنشاء الحساب وبدء التجربة المجانية 🚀</span>
                )}
              </button>
            </form>
          )}

          {/* 3. RECOVER VIA PIN MODE */}
          {mode === 'recover' && (
            <form onSubmit={handleRecover} className="space-y-4">
              <div className="text-center pb-1">
                <h2 className="text-base font-bold text-white">استرجاع الحساب عبر الـ PIN</h2>
                <p className="text-xs text-slate-400 mt-0.5">أدخل رقم الهاتف ورمز الـ PIN الذي عيّنته عند التسجيل</p>
              </div>

              <div>
                <label className="block text-slate-300 text-xs font-semibold mb-1.5">رقم الهاتف المسجل</label>
                <input
                  type="tel"
                  required
                  placeholder="05xxxxxxxx"
                  value={recPhone}
                  onChange={(e) => setRecPhone(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                  dir="ltr"
                />
              </div>

              <div>
                <label className="block text-slate-300 text-xs font-semibold mb-1.5">رمز الـ PIN السري</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  placeholder="أدخل رمز الـ PIN المكون من 4-6 أرقام"
                  value={recPin}
                  onChange={(e) => setRecPin(e.target.value.replace(/[^\d]/g, ''))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white text-sm tracking-widest text-center font-mono focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-slate-300 text-xs font-semibold mb-1">كلمة المرور الجديدة</label>
                  <input
                    type="password"
                    required
                    placeholder="6 خانات فأكثر"
                    value={recNewPassword}
                    onChange={(e) => setRecNewPassword(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 text-xs font-semibold mb-1">تأكيد الكلمة</label>
                  <input
                    type="password"
                    required
                    placeholder="تأكيد الكلمة"
                    value={recConfirmPassword}
                    onChange={(e) => setRecConfirmPassword(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => { setMode('login'); setError(''); }}
                  className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-semibold text-xs transition-colors"
                >
                  إلغاء والعودة
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-[2] py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl font-bold text-xs shadow-lg shadow-emerald-900/30 transition-all flex items-center justify-center gap-2"
                >
                  {loading ? 'جاري التحقق والتحديث...' : 'تعيين كلمة المرور ➔'}
                </button>
              </div>
            </form>
          )}

          {/* 4. SUBSCRIPTION EXPIRED MODE */}
          {mode === 'expired' && (
            <div className="space-y-4 text-center">
              <div className="w-14 h-14 bg-amber-500/20 text-amber-400 rounded-2xl flex items-center justify-center mx-auto text-2xl border border-amber-500/30">
                ⏳
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">انتهت فترة الاشتراك</h2>
                <p className="text-xs text-slate-400 mt-1">
                  حساب العميل: <span className="text-emerald-400 font-mono font-bold" dir="ltr">{currentUser?.phone || loginPhone}</span>
                </p>
                <p className="text-xs text-slate-400 mt-0.5">لتجديد الاشتراك ومتابعة إدارة معاملاتك يرجى التواصل معنا</p>
              </div>

              {/* WhatsApp Support Button */}
              <button
                type="button"
                onClick={handleSupportWhatsApp}
                className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm rounded-xl shadow-lg flex items-center justify-center gap-2 transition-all"
              >
                <span>💬</span>
                <span>تجديد الاشتراك عبر واتساب ({SUPPORT_PHONE_DISPLAY})</span>
              </button>

              {/* Code Activation Alternative */}
              <div className="pt-2 border-t border-slate-800 space-y-2 text-right">
                <label className="text-slate-400 text-xs">هل لديك كود تجديد؟</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    maxLength={9}
                    placeholder="أدخل كود التفعيل"
                    value={activationCode}
                    onChange={(e) => setActivationCode(e.target.value)}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white text-sm text-center font-mono focus:border-emerald-500 outline-none"
                    dir="ltr"
                  />
                  <button
                    onClick={handleActivateWithCode}
                    disabled={loading || !activationCode.trim()}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-emerald-400 rounded-xl text-xs font-bold transition-all disabled:opacity-40"
                  >
                    تفعيل
                  </button>
                </div>
              </div>

              <div className="pt-2">
                <button
                  onClick={() => { authService.logout(); setMode('login'); }}
                  className="text-xs text-slate-500 hover:text-slate-300 underline"
                >
                  تسجيل الخروج أو الدخول بحساب آخر
                </button>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="p-3 bg-slate-950/80 border-t border-slate-800/80 text-center">
          <p className="text-[11px] text-slate-500">
            🔒 كافة المعاملات والبيانات مشفرة ومحمية ومرتبطة برقم هاتفك السحابي
          </p>
        </div>

      </div>
    </div>
  );
};

export default AuthGate;
