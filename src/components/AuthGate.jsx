import { useState } from 'react';
import { authService } from '../services/authService';
import { cloudSyncService } from '../services/cloudSyncService';

const SUPPORT_WHATSAPP_PHONE = '966556854162';

const AuthGate = ({ onAuthenticated, isExpired = false, initialUser = null }) => {
  const [mode, setMode] = useState(isExpired ? 'expired' : 'login');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const currentUser = initialUser || authService.getCurrentUser();

  const selectMode = (nextMode) => {
    setMode(nextMode);
    setError('');
    setMessage('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);
    try {
      if (mode === 'recover') {
        if (newPassword !== confirmNewPassword) throw new Error('كلمتا المرور غير متطابقتين.');
        await authService.recoverPassword(phone, pin, newPassword);
        setPassword('');
        setNewPassword('');
        setConfirmNewPassword('');
        setMessage('تم تحديث كلمة المرور. سجّل الدخول بها الآن.');
        setMode('login');
        return;
      }

      const user = mode === 'register'
        ? await (async () => {
          if (password !== confirmPassword) throw new Error('كلمتا المرور غير متطابقتين.');
          return authService.register({ name, phone, password, pin });
        })()
        : await authService.login(phone, password);

      setMessage('جاري استرجاع بيانات حسابك بأمان...');
      const syncResult = await cloudSyncService.fullSyncOnLogin(user.account_number, {
        legacyPhone: user.phone,
        forceIsolated: mode === 'register',
      });
      if (syncResult?.success === false) {
        throw new Error('تعذر تجهيز بيانات الحساب بأمان. لم يتم تغيير بيانات السحابة.');
      }
      onAuthenticated(user);
    } catch (submitError) {
      setError(submitError.message || 'تعذر فتح الحساب. حاول مرة أخرى.');
    } finally {
      setLoading(false);
    }
  };

  const handleSupport = () => {
    const accountNumber = currentUser?.account_number || '';
    const text = `السلام عليكم، أحتاج مساعدة في حساب أقساطي ${accountNumber}`;
    window.open(`https://wa.me/${SUPPORT_WHATSAPP_PHONE}?text=${encodeURIComponent(text)}`, '_blank');
  };

  const renderPhone = (label = 'رقم الهاتف') => (
    <label className="block text-xs font-semibold text-slate-300">
      {label}
      <input
        type="tel"
        required
        autoComplete="tel"
        value={phone}
        onChange={(event) => setPhone(event.target.value)}
        placeholder="05xxxxxxxx أو +966..."
        className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm font-mono text-white outline-none focus:border-emerald-500"
        dir="ltr"
      />
    </label>
  );

  const renderPassword = (value, setter, label = 'كلمة المرور') => (
    <label className="block text-xs font-semibold text-slate-300">
      {label}
      <input
        type="password"
        required
        minLength={6}
        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        value={value}
        onChange={(event) => setter(event.target.value)}
        className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm font-mono text-white outline-none focus:border-emerald-500"
        dir="ltr"
      />
    </label>
  );

  return (
    <div className="premium-auth fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-slate-950/95 p-4 backdrop-blur-xl modal-safe-area" dir="rtl">
      <div className="auth-card relative my-auto w-full max-w-md overflow-hidden rounded-3xl border border-slate-800 shadow-2xl">
        <header className="px-6 pb-5 pt-8 text-center">
          <img src="/logo-mark.svg" alt="شعار أقساطي" className="mx-auto mb-3 h-16 w-16" />
          <h1 className="text-3xl font-black tracking-wide text-white">أقساطي</h1>
          <p className="mt-2 text-xs font-medium text-slate-400">دخول آمن إلى حسابك وبياناتك السحابية</p>
        </header>

        {mode !== 'expired' && mode !== 'recover' && (
          <div className="px-6 pb-2">
            <div className="auth-tabs flex rounded-2xl border border-slate-800 bg-slate-950 p-1">
              <button type="button" onClick={() => selectMode('login')} className={`flex-1 rounded-xl py-2.5 text-xs font-bold ${mode === 'login' ? 'auth-tab-active text-white' : 'text-slate-400'}`}>
                تسجيل الدخول
              </button>
              <button type="button" onClick={() => selectMode('register')} className={`flex-1 rounded-xl py-2.5 text-xs font-bold ${mode === 'register' ? 'auth-tab-active text-white' : 'text-slate-400'}`}>
                حساب جديد
              </button>
            </div>
          </div>
        )}

        <main className="space-y-4 p-6 pt-3">
          {error && <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">{error}</p>}
          {message && <p role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300">{message}</p>}

          {mode === 'expired' ? (
            <div className="space-y-4 text-center">
              <p className="text-sm font-bold text-white">انتهت فترة الاشتراك</p>
              <p className="text-xs text-slate-400">يمكنك التواصل مع الدعم أو متابعة حسابك بوضع العرض فقط.</p>
              <button type="button" onClick={handleSupport} className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white">التواصل مع الدعم عبر واتساب</button>
              <button type="button" onClick={() => currentUser && onAuthenticated(currentUser)} className="w-full rounded-xl bg-slate-800 py-3 text-xs font-bold text-slate-200">تصفح الحساب بوضع العرض فقط</button>
              <button type="button" onClick={() => { authService.logout(); selectMode('login'); }} className="text-xs text-slate-500 underline">تسجيل الخروج أو استخدام حساب آخر</button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'register' && (
                <label className="block text-xs font-semibold text-slate-300">
                  الاسم الكامل / اسم المؤسسة
                  <input required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-emerald-500" />
                </label>
              )}

              {renderPhone(mode === 'recover' ? 'رقم الهاتف المسجل' : 'رقم الهاتف')}

              {mode === 'recover' ? (
                <>
                  <label className="block text-xs font-semibold text-slate-300">
                    رمز الاسترجاع PIN
                    <input type="password" required minLength={4} maxLength={6} inputMode="numeric" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-center font-mono text-white outline-none focus:border-emerald-500" />
                  </label>
                  {renderPassword(newPassword, setNewPassword, 'كلمة المرور الجديدة')}
                  {renderPassword(confirmNewPassword, setConfirmNewPassword, 'تأكيد كلمة المرور الجديدة')}
                </>
              ) : (
                <>
                  {renderPassword(password, setPassword)}
                  {mode === 'register' && (
                    <>
                      {renderPassword(confirmPassword, setConfirmPassword, 'تأكيد كلمة المرور')}
                      <label className="block text-xs font-semibold text-slate-300">
                        PIN لاسترجاع الحساب (4 إلى 6 أرقام)
                        <input type="password" required minLength={4} maxLength={6} inputMode="numeric" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-center font-mono text-white outline-none focus:border-emerald-500" />
                      </label>
                    </>
                  )}
                </>
              )}

              <button type="submit" disabled={loading} className="auth-submit flex w-full items-center justify-center rounded-xl py-3.5 text-sm font-bold text-white disabled:opacity-50">
                {loading ? 'جارٍ التحقق واسترجاع البيانات...' : mode === 'register' ? 'إنشاء الحساب' : mode === 'recover' ? 'تعيين كلمة المرور' : 'دخول إلى حسابي'}
              </button>

              {mode === 'login' && <button type="button" onClick={() => selectMode('recover')} className="w-full text-xs text-emerald-400 underline">نسيت كلمة المرور؟ استرجاع عبر PIN</button>}
              {mode === 'recover' && <button type="button" onClick={() => selectMode('login')} className="w-full text-xs text-slate-400 underline">العودة لتسجيل الدخول</button>}
            </form>
          )}
        </main>

        <footer className="border-t border-slate-800 bg-slate-950/80 px-6 py-3.5 text-center text-[11px] text-slate-400">
          بيانات حسابك لا تُفتح إلا بعد التحقق من كلمة المرور على الخادم.
        </footer>
      </div>
    </div>
  );
};

export default AuthGate;
