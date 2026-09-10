import { useState } from 'react';
import { 
  isWebContactsSupported, 
  isNativePlatform, 
  pickContactDirectly,
  parseContactText
} from '../services/contactService';

const ContactPickerModal = ({ isOpen, onClose, onSelectContact, title = 'إضافة من جهات الاتصال' }) => {
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const canPickDirectly = isWebContactsSupported() || isNativePlatform();

  if (!isOpen) return null;

  // تجربة فتح سجل الهاتف مباشرة
  const handleDirectPick = async () => {
    setErrorMsg('');
    setInfoMsg('');
    setLoading(true);
    try {
      const contact = await pickContactDirectly();
      if (contact && !contact.unsupported) {
        onSelectContact(contact);
        onClose();
        return;
      }
      // إذا كان المتصفح لا يدعم الواجهة البرمجية (مثل Safari بدون تفعيل الـ Flag)
      setErrorMsg('سجل الهاتف المباشر غير مفعل في Safari بعد. يرجى اتباع خطوات التفعيل أدناه أو استخدام زر اللصق السريع.');
    } catch (err) {
      if (err?.name === 'AbortError') {
        // قام المستخدم بإلغاء الاختيار من الشيت
        return;
      }
      console.warn('Direct pick error:', err);
      setErrorMsg('تعذر فتح جهات الاتصال. تأكد من تفعيل الميزة في إعدادات Safari.');
    } finally {
      setLoading(false);
    }
  };

  // لصق جهة اتصال من الحافظة بضغطة زر واحدة
  const handlePasteFromClipboard = async () => {
    setErrorMsg('');
    setInfoMsg('');
    setLoading(true);
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        setErrorMsg('المتصفح لا يدعم قراءة الحافظة، يمكنك لصق النص مباشرة في النموذج.');
        return;
      }

      const text = await navigator.clipboard.readText();
      if (!text || !text.trim()) {
        setErrorMsg('الحافظة فارغة! انسخ جهة الاتصال أو رقم الهاتف من هاتفك أولاً ثم اضغط هنا.');
        return;
      }

      const parsed = parseContactText(text);
      if (parsed && (parsed.name || parsed.phone)) {
        onSelectContact(parsed);
        onClose();
      } else {
        setErrorMsg('لم نتمكن من العثور على اسم أو رقم هاتف في النص المنسوخ.');
      }
    } catch (err) {
      console.warn('Clipboard read error:', err);
      setErrorMsg('يرجى السماح للتطبيق بقراءة الحافظة عند طلب الإذن.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[60] p-4 modal-safe-area animate-fade-in" dir="rtl">
      <div className="bg-slate-800 border border-slate-700 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="bg-slate-700/60 border-b border-slate-600/50 px-5 py-4 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">📇</span>
            <div>
              <h3 className="text-base font-bold text-white leading-snug">{title}</h3>
              <p className="text-xs text-slate-400">إضافة الاسم ورقم الهاتف من هاتفك</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 overflow-y-auto custom-scrollbar text-center">
          {errorMsg && (
            <div className="p-3 bg-rose-500/15 border border-rose-500/30 rounded-xl text-rose-300 text-xs flex items-start gap-2 text-right animate-shake">
              <span className="text-sm shrink-0">⚠️</span>
              <p className="leading-relaxed">{errorMsg}</p>
            </div>
          )}

          {infoMsg && (
            <div className="p-3 bg-blue-500/15 border border-blue-500/30 rounded-xl text-blue-300 text-xs flex items-start gap-2 text-right">
              <span className="text-sm shrink-0">ℹ️</span>
              <p className="leading-relaxed">{infoMsg}</p>
            </div>
          )}

          {canPickDirectly ? (
            /* متصفحات تدعم الاختيار البرمجي المباشر (مثل Android Chrome أو تطبيق Native أو Safari مع الـ Flag) */
            <div className="space-y-4 py-2">
              <div className="w-16 h-16 bg-blue-500/10 border border-blue-500/30 rounded-2xl mx-auto flex items-center justify-center text-3xl shadow-inner">
                📲
              </div>
              <div>
                <h4 className="font-bold text-white text-base">استيراد مباشر من جهات الاتصال</h4>
                <p className="text-slate-400 text-xs mt-1 leading-relaxed max-w-xs mx-auto">
                  اضغط على الزر أدناه لاختيار جهة الاتصال من دفتر هاتفك وسيتم تعبئة البيانات تلقائياً.
                </p>
              </div>

              <button
                type="button"
                onClick={handleDirectPick}
                disabled={loading}
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white py-3.5 rounded-xl font-bold shadow-lg shadow-blue-600/30 transition-all active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                    </svg>
                    <span>فتح قائمة جهات الاتصال</span>
                  </>
                )}
              </button>
            </div>
          ) : (
            /* أجهزة iPhone متصفح Safari */
            <div className="space-y-4 py-1 text-right">
              
              {/* الخيار 1: لصق سريع من الحافظة */}
              <div className="bg-gradient-to-br from-slate-900 to-slate-900/90 rounded-2xl p-4 border border-emerald-500/30 shadow-lg space-y-3">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                  <span>⚡</span>
                  <span>الخيار الأسرع: لصق جهة اتصال منسوخة</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  انسخ أي جهة اتصال أو رقم هاتف من هاتفك (أو الواتساب)، ثم اضغط الزر أدناه وسيتم استخراج الاسم والرقم وتعبئتهما تلقائياً:
                </p>
                <button
                  type="button"
                  onClick={handlePasteFromClipboard}
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white py-3 px-4 rounded-xl font-bold shadow-md shadow-emerald-900/30 transition-all active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer text-sm"
                >
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                      <span>📋 لصق جهة الاتصال من الحافظة</span>
                    </>
                  )}
                </button>
              </div>

              {/* الخيار 2: تفعيل فتح جهات الاتصال في Safari مباشرة */}
              <div className="bg-slate-900/80 rounded-2xl p-4 border border-slate-700/60 space-y-3">
                <div className="flex items-center gap-2 text-indigo-300 font-bold text-xs">
                  <span>⚙️</span>
                  <span>الخيار الدائم: تفعيل فتح سجل الهاتف في Safari</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  تمنع Apple المتصفحات من فتح الأسماء افتراضياً لحماية الخصوصية. لتفعيلها لمرة واحدة:
                </p>
                
                <div className="space-y-1.5 text-xs text-slate-300 bg-slate-800/80 p-3 rounded-xl border border-slate-700/40">
                  <p>1️⃣ افتح <strong className="text-white">إعدادات الآيفون</strong> ⬅️ <strong className="text-white">Safari</strong></p>
                  <p>2️⃣ انزل للأسفل واختر <strong className="text-white">متقدم (Advanced)</strong></p>
                  <p>3️⃣ اضغط <strong className="text-white">Feature Flags</strong></p>
                  <p>4️⃣ فعّل خيار <strong className="text-emerald-400">Contact Picker API</strong></p>
                </div>

                <button
                  type="button"
                  onClick={handleDirectPick}
                  disabled={loading}
                  className="w-full bg-slate-800 hover:bg-slate-700 border border-indigo-500/40 text-indigo-300 hover:text-white py-2.5 rounded-xl font-bold transition-all text-xs flex items-center justify-center gap-2 cursor-pointer"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                  </svg>
                  <span>📇 تجربة فتح سجل الأسماء الآن</span>
                </button>
              </div>

            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-slate-900/60 border-t border-slate-700/60 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            إلغاء
          </button>
        </div>

      </div>
    </div>
  );
};

export default ContactPickerModal;
