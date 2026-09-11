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

  // Password Visibility toggles
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

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

  const [loginStatusText, setLoginStatusText] = useState('');
  const currentUser = initialUser || authService.getCurrentUser();

  const handleLogin = async (e) => {
    e?.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoginStatusText('جاري التحقق من بيانات الدخول...');
    setLoading(true);

    try {
      const user = await authService.login(loginPhone, loginPassword);
      
      // مزامنة واسترجاع تلقائي كامل قبل دخول التطبيق لضمان استرجاع كافة المعاملات
      setLoginStatusText('جاري استرجاع معاملاتك وبياناتك من السحابة...');
      try {
        await cloudSyncService.fullSyncOnLogin(user.phone);
      } catch (syncErr) {
        console.warn('Login cloud sync error:', syncErr);
      }

      // الدخول مباشرة للتطبيق حتى وإن كانت التجربة أو الاشتراك منتهياً (وضع العرض فقط)
      onAuthenticated(user);
    } catch (err) {
      setError(err.message || 'فشل تسجيل الدخول، تأكد من صحة البيانات');
    } finally {
      setLoading(false);
      setLoginStatusText('');
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
    const message = `السلام عليكم، أريد تجديد اشتراك تطبيق فزعتك لرقم الحساب: ${phone}`;
    window.open(`https://wa.me/${SUPPORT_WHATSAPP_PHONE}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const handleActivateWithCode = async () => {
    if (!activationCode.trim()) return;
    setLoading(true);
    setError('');

    try {
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
    <div className="premium-auth fixed inset-0 z-[9999] bg-slate-950/95 backdrop-blur-xl flex items-center justify-center p-4 overflow-y-auto modal-safe-area" dir="rtl">
      {/* Background ambient lighting */}
      <div className="fixed top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none -z-10" />

      <div className="auth-card w-full max-w-md rounded-3xl border border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.6)] overflow-hidden my-auto relative backdrop-blur-2xl">
        
        {/* Header Branding */}
        <div className="relative pt-8 pb-5 px-6 text-center overflow-hidden">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-56 h-20 bg-emerald-500/15 blur-2xl pointer-events-none rounded-full" />
          
          <div className="relative mx-auto w-16 h-16 mb-3">
            <div className="absolute inset-0 bg-emerald-500/25 rounded-2xl blur-md" />
            <div className="auth-brand-mark relative w-16 h-16 bg-gradient-to-b from-slate-800 to-slate-900 rounded-2xl border border-emerald-500/40 shadow-inner flex items-center justify-center p-1.5">
              <img src="/logo-mark.svg" alt="شعار فزعتك" className="w-full h-full" />
            </div>
          </div>

          <h1 className="text-3xl font-black text-white tracking-wide flex items-center justify-center gap-2">
            <span>فزعتك</span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">سحابي</span>
          </h1>
          <p className="auth-tagline text-slate-400 text-xs mt-1.5 font-medium">أدر التزاماتك بثقة، واترك التفاصيل علينا</p>
        </div>

        {/* Mode Selector Tabs (Login & Register) */}
        {mode !== 'expired' && (
          <div className="px-6 pb-2">
            <div className="auth-tabs flex bg-slate-950/90 p-1 rounded-2xl border border-slate-800/80">
              <button
                type="button"
                onClick={() => { setMode('login'); setError(''); setSuccessMsg(''); }}
                className={`flex-1 py-2.5 rounded-xl font-bold text-xs transition-all duration-200 flex items-center justify-center gap-1.5 ${
                  mode === 'login'
                    ? 'auth-tab-active text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                </svg>
                <span>تسجيل الدخول</span>
              </button>
              <button
                type="button"
                onClick={() => { setMode('register'); setError(''); setSuccessMsg(''); }}
                className={`flex-1 py-2.5 rounded-xl font-bold text-xs transition-all duration-200 flex items-center justify-center gap-1.5 ${
                  mode === 'register'
                    ? 'auth-tab-active text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
                <span>إنشاء حساب جديد</span>
              </button>
            </div>
          </div>
        )}

        {/* Content Body */}
        <div className="p-6 pt-3 space-y-4">
          {error && (
            <div className="p-3 bg-rose-500/15 border border-rose-500/30 rounded-xl text-rose-300 text-xs flex items-center gap-2">
              <span className="text-sm">⚠️</span>
              <span className="font-medium">{error}</span>
            </div>
          )}
          {successMsg && (
            <div className="p-3 bg-emerald-500/15 border border-emerald-500/30 rounded-xl text-emerald-300 text-xs flex items-center gap-2">
              <span className="text-sm">✅</span>
              <span className="font-medium">{successMsg}</span>
            </div>
          )}

          {/* 1. LOGIN MODE */}
          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-slate-300 text-xs font-semibold mb-1.5">رقم الهاتف</label>
                <div className="relative">
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                  </span>
                  <input
                    type="tel"
                    required
                    placeholder="مثال: 0501234567"
                    value={loginPhone}
                    onChange={(e) => setLoginPhone(e.target.value)}
                    className="w-full bg-slate-950/90 border border-slate-800 rounded-xl pr-11 pl-4 py-3 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all font-mono"
                    dir="ltr"
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-slate-300 text-xs font-semibold">كلمة المرور</label>
                  <button
                    type="button"
                    onClick={() => { setMode('recover'); setError(''); setSuccessMsg(''); setRecPhone(loginPhone); }}
                    className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors font-medium"
                  >
                    نسيت كلمة المرور؟
                  </button>
                </div>
                <div className="relative">
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="••••••••"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    className="w-full bg-slate-950/90 border border-slate-800 rounded-xl pr-11 pl-11 py-3 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-1 transition-colors"
                  >
                    {showPassword ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="auth-submit w-full py-3.5 disabled:opacity-50 text-white rounded-xl font-bold text-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer mt-2"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>{loginStatusText || 'جاري تسجيل الدخول...'}</span>
                  </>
                ) : (
                  <>
                    <span>دخول إلى حسابي</span>
                    <svg className="w-4 h-4 rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  </>
                )}
              </button>

              <div className="pt-2 text-center">
                <p className="text-xs text-slate-400">
                  لا تملك حساباً بعد؟{' '}
                  <button
                    type="button"
                    onClick={() => { setMode('register'); setError(''); }}
                    className="text-emerald-400 hover:text-emerald-300 font-bold transition-colors"
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
                <label className="block text-slate-300 text-xs font-semibold mb-1">الاسم الكامل / اسم المؤسسة</label>
                <div className="relative">
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </span>
                  <input
                    type="text"
                    required
                    placeholder="مثال: مؤسسة التقسيط المتحدة"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    className="w-full bg-slate-950/90 border border-slate-800 rounded-xl pr-11 pl-4 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 text-xs font-semibold mb-1">رقم الهاتف (هوية حسابك الثابتة)</label>
                <div className="relative">
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                  </span>
                  <input
                    type="tel"
                    required
                    placeholder="05xxxxxxxx"
                    value={regPhone}
                    onChange={(e) => setRegPhone(e.target.value)}
                    className="w-full bg-slate-950/90 border border-slate-800 rounded-xl pr-11 pl-4 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all font-mono"
                    dir="ltr"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-slate-300 text-xs font-semibold mb-1">كلمة المرور</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      placeholder="6 خانات فأكثر"
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      className="w-full bg-slate-950/90 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all font-mono"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-slate-300 text-xs font-semibold mb-1">تأكيد كلمة المرور</label>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      required
                      placeholder="تأكيد الكلمة"
                      value={regConfirmPassword}
                      onChange={(e) => setRegConfirmPassword(e.target.value)}
                      className="w-full bg-slate-950/90 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Secret PIN Section */}
              <div className="bg-emerald-950/30 border border-emerald-500/20 rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-emerald-300 text-xs font-bold flex items-center gap-1.5">
                    <span>🔑</span>
                    <span>رمز الـ PIN لاسترجاع الحساب</span>
                  </label>
                  <span className="text-[10px] text-emerald-400/90 bg-emerald-900/60 px-2.5 py-0.5 rounded-full font-mono font-bold">4-6 أرقام</span>
                </div>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  placeholder="مثال: 1234"
                  value={regPin}
                  onChange={(e) => setRegPin(e.target.value.replace(/[^\d]/g, ''))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white text-sm tracking-widest text-center font-mono focus:outline-none focus:border-emerald-500 transition-colors"
                />
                <p className="text-[10px] text-emerald-200/70 leading-relaxed">
                  احفظ هذا الرمز جيداً: هو مفتاحك لاسترجاع حسابك إذا نسيت كلمة المرور مستقبلاً دون الحاجة لرسائل SMS.
                </p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="auth-submit w-full py-3.5 disabled:opacity-50 text-white rounded-xl font-bold text-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer mt-1"
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
                <h2 className="text-base font-bold text-white">استرجاع الحساب عبر رمز الـ PIN</h2>
                <p className="text-xs text-slate-400 mt-1">أدخل رقم هاتفك المسجل ورمز الـ PIN لتعيين كلمة مرور جديدة</p>
              </div>

              <div>
                <label className="block text-slate-300 text-xs font-semibold mb-1.5">رقم الهاتف المسجل</label>
                <div className="relative">
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                  </span>
                  <input
                    type="tel"
                    required
                    placeholder="05xxxxxxxx"
                    value={recPhone}
                    onChange={(e) => setRecPhone(e.target.value)}
                    className="w-full bg-slate-950/90 border border-slate-800 rounded-xl pr-11 pl-4 py-3 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all font-mono"
                    dir="ltr"
                  />
                </div>
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
                    type={showNewPassword ? 'text' : 'password'}
                    required
                    placeholder="6 خانات فأكثر"
                    value={recNewPassword}
                    onChange={(e) => setRecNewPassword(e.target.value)}
                    className="w-full bg-slate-950/90 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 text-xs font-semibold mb-1">تأكيد الكلمة</label>
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    required
                    placeholder="تأكيد الكلمة"
                    value={recConfirmPassword}
                    onChange={(e) => setRecConfirmPassword(e.target.value)}
                    className="w-full bg-slate-950/90 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all font-mono"
                  />
                </div>
              </div>

              <div className="flex gap-2.5 pt-1">
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
                  className="flex-[2] py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-white rounded-xl font-bold text-xs shadow-lg shadow-emerald-900/40 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  {loading ? 'جاري التحقق...' : 'تعيين كلمة المرور ➔'}
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
                className="w-full py-3.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm rounded-xl shadow-lg flex items-center justify-center gap-2 transition-all cursor-pointer"
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

              <div className="pt-2 flex flex-col gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    const usr = authService.getCurrentUser() || initialUser;
                    if (usr) onAuthenticated(usr);
                  }}
                  className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <span>👁️</span>
                  <span>تصفح الحساب والمعاملات (عرض فقط)</span>
                </button>
                <button
                  type="button"
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
        <div className="auth-trust py-3.5 px-6 bg-slate-950/80 border-t border-slate-800/80 text-center flex items-center justify-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <p className="text-[11px] text-slate-400 font-medium">
            كافة المعاملات مشفرة ومحمية بسحابة فزعتك الآمنة
          </p>
        </div>

      </div>
    </div>
  );
};

export default AuthGate;
