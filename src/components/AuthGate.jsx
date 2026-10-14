import { useState } from 'react';
import { authService } from '../services/authService';
import { cloudSyncService } from '../services/cloudSyncService';

const SUPPORT_WHATSAPP_PHONE = '966556854162';

const AuthGate = ({ onAuthenticated, isExpired = false, initialUser = null }) => {
  const [mode, setMode] = useState(isExpired ? 'expired' : 'login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const currentUser = initialUser || authService.getCurrentUser();

  const chooseMode = (nextMode) => {
    setMode(nextMode);
    setCodeSent(false);
    setCode('');
    setError('');
    setMessage('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);
    try {
      if (!codeSent) {
        if (mode === 'register') await authService.register({ name, phone });
        else await authService.requestPhoneCode(phone);
        setCodeSent(true);
        setMessage('أرسلنا رمز تحقق إلى هاتفك. أدخله للمتابعة.');
        return;
      }

      const user = await authService.verifyPhoneCode(phone, code, mode === 'register' ? name : '');
      const syncResult = await cloudSyncService.fullSyncOnLogin(user.account_number, {
        legacyPhone: user.phone,
        forceIsolated: Boolean(user.is_new_account),
      });
      if (syncResult?.success === false) {
        throw new Error('تعذر تجهيز مساحة الحساب بأمان. لم يتم فتح الحساب لحماية بياناتك.');
      }
      onAuthenticated(user);
    } catch (submitError) {
      setError(submitError.message || 'تعذر التحقق من الحساب. حاول مرة أخرى.');
    } finally {
      setLoading(false);
    }
  };

  const handleSupport = () => {
    const accountNumber = currentUser?.account_number || '';
    const messageText = `السلام عليكم، أحتاج مساعدة في حساب أقساطي ${accountNumber}`;
    window.open(`https://wa.me/${SUPPORT_WHATSAPP_PHONE}?text=${encodeURIComponent(messageText)}`, '_blank');
  };

  return (
    <div className="premium-auth fixed inset-0 z-[9999] bg-slate-950/95 backdrop-blur-xl flex items-center justify-center p-4 overflow-y-auto modal-safe-area" dir="rtl">
      <div className="auth-card relative my-auto w-full max-w-md overflow-hidden rounded-3xl border border-slate-800 shadow-2xl">
        <header className="px-6 pb-5 pt-8 text-center">
          <img src="/logo-mark.svg" alt="شعار أقساطي" className="mx-auto mb-3 h-16 w-16" />
          <h1 className="text-3xl font-black tracking-wide text-white">أقساطي</h1>
          <p className="mt-2 text-xs font-medium text-slate-400">تسجيل دخول برمز تحقق للهاتف</p>
        </header>

        {mode !== 'expired' && (
          <div className="px-6 pb-2">
            <div className="auth-tabs flex rounded-2xl border border-slate-800 bg-slate-950 p-1">
              <button type="button" onClick={() => chooseMode('login')} className={`flex-1 rounded-xl py-2.5 text-xs font-bold ${mode === 'login' ? 'auth-tab-active text-white' : 'text-slate-400'}`}>
                تسجيل الدخول
              </button>
              <button type="button" onClick={() => chooseMode('register')} className={`flex-1 rounded-xl py-2.5 text-xs font-bold ${mode === 'register' ? 'auth-tab-active text-white' : 'text-slate-400'}`}>
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
              <p className="text-xs text-slate-400">يمكنك التواصل مع الدعم أو متابعة الحساب بوضع العرض فقط.</p>
              <button type="button" onClick={handleSupport} className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white">
                التواصل مع الدعم عبر واتساب
              </button>
              <button type="button" onClick={() => currentUser && onAuthenticated(currentUser)} className="w-full rounded-xl bg-slate-800 py-3 text-xs font-bold text-slate-200">
                تصفح الحساب بوضع العرض فقط
              </button>
              <button type="button" onClick={() => { authService.logout(); chooseMode('login'); }} className="text-xs text-slate-500 underline">
                تسجيل الخروج أو استخدام حساب آخر
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'register' && (
                <label className="block text-xs font-semibold text-slate-300">
                  الاسم
                  <input
                    required
                    minLength={2}
                    maxLength={120}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-emerald-500"
                    autoComplete="name"
                  />
                </label>
              )}

              <label className="block text-xs font-semibold text-slate-300">
                رقم الهاتف
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="05xxxxxxxx أو +966..."
                  className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm font-mono text-white outline-none focus:border-emerald-500"
                  dir="ltr"
                  autoComplete="tel"
                />
              </label>

              {codeSent && (
                <label className="block text-xs font-semibold text-slate-300">
                  رمز التحقق المرسل برسالة SMS
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    required
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="••••••"
                    className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-center font-mono text-lg tracking-[0.4em] text-white outline-none focus:border-emerald-500"
                    dir="ltr"
                  />
                </label>
              )}

              <button type="submit" disabled={loading} className="auth-submit flex w-full items-center justify-center rounded-xl py-3.5 text-sm font-bold text-white disabled:opacity-50">
                {loading ? 'جارٍ التحقق...' : codeSent ? 'تأكيد الرمز وفتح الحساب' : mode === 'register' ? 'إرسال رمز التحقق' : 'إرسال رمز الدخول'}
              </button>

              {codeSent && (
                <button type="button" onClick={() => { setCodeSent(false); setCode(''); setMessage(''); }} className="w-full text-xs text-slate-400 underline">
                  تغيير رقم الهاتف
                </button>
              )}
            </form>
          )}
        </main>

        <footer className="border-t border-slate-800 bg-slate-950/80 px-6 py-3.5 text-center text-[11px] text-slate-400">
          لا يُربط الحساب إلا بعد التحقق من ملكية رقم الهاتف.
        </footer>
      </div>
    </div>
  );
};

export default AuthGate;
