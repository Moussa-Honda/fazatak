import { useState } from 'react';
import { 
  isWebContactsSupported, 
  isNativePlatform, 
  pickContactDirectly 
} from '../services/contactService';

const ContactPickerModal = ({ isOpen, onClose, onSelectContact, onFocusForm, title = 'إضافة من جهات الاتصال' }) => {
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const canPickDirectly = isWebContactsSupported() || isNativePlatform();

  if (!isOpen) return null;

  const handleDirectPick = async () => {
    setErrorMsg('');
    setLoading(true);
    try {
      const contact = await pickContactDirectly();
      if (contact && !contact.unsupported) {
        onSelectContact(contact);
        onClose();
      } else if (contact?.unsupported) {
        // إذا كان المتصفح لا يدعم الواجهة البرمجية، نوجه للتعبئة التلقائية
        handleStartAutoFill();
      }
    } catch (err) {
      console.warn('Direct pick error:', err);
      handleStartAutoFill();
    } finally {
      setLoading(false);
    }
  };

  const handleStartAutoFill = () => {
    onClose();
    if (onFocusForm) {
      onFocusForm();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[60] p-4 modal-safe-area animate-fade-in" dir="rtl">
      <div className="bg-slate-800 border border-slate-700 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col">
        
        {/* Header */}
        <div className="bg-slate-700/60 border-b border-slate-600/50 px-5 py-4 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">📇</span>
            <div>
              <h3 className="text-base font-bold text-white leading-snug">{title}</h3>
              <p className="text-xs text-slate-400">جلب بيانات الاسم ورقم الهاتف من هاتفك</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 text-center">
          {errorMsg && (
            <div className="p-3 bg-rose-500/15 border border-rose-500/30 rounded-xl text-rose-300 text-xs flex items-start gap-2 text-right">
              <span className="text-sm shrink-0">⚠️</span>
              <p className="leading-relaxed">{errorMsg}</p>
            </div>
          )}

          {canPickDirectly ? (
            /* متصفحات تدعم الاختيار البرمجي المباشر (مثل Android Chrome أو تطبيق Native) */
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
            /* متصفح Safari على iPhone */
            <div className="space-y-4 py-1 text-right">
              <div className="w-16 h-16 bg-gradient-to-br from-indigo-500/20 to-blue-500/20 border border-indigo-500/30 rounded-2xl mx-auto flex items-center justify-center text-3xl shadow-inner">
                📱
              </div>

              <div className="text-center">
                <h4 className="font-bold text-white text-base">إضافة جهة اتصال على iPhone (Safari)</h4>
                <p className="text-slate-400 text-xs mt-1 leading-relaxed">
                  يدعم Safari ملء جهة الاتصال مباشرة من دفتر هاتفك بنقرة واحدة عبر لوحة المفاتيح:
                </p>
              </div>

              <div className="bg-slate-900/80 rounded-2xl p-4 border border-slate-700/60 space-y-3">
                <div className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">1</span>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    اضغط على زر <span className="text-white font-bold">"البدء الآن"</span> أدناه للانتقال لخانة الاسم.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">2</span>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    ستظهر لك في شريط اقتراحات لوحة المفاتيح ميزة <span className="text-emerald-400 font-bold">"تعبئة جهة اتصال / AutoFill Contact"</span>.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">3</span>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    اختر جهة الاتصال المطلوبة، وسيتم إدراج الاسم ورقم الهاتف تلقائياً في النموذج.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleStartAutoFill}
                className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white py-3.5 rounded-xl font-bold shadow-lg shadow-emerald-900/40 transition-all active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer text-sm"
              >
                <span>📲 البدء واختيار جهة الاتصال</span>
              </button>

              <button
                type="button"
                onClick={handleDirectPick}
                disabled={loading}
                className="w-full text-xs text-slate-400 hover:text-slate-200 py-1 transition-colors text-center block"
              >
                {loading ? 'جاري المحاولة...' : 'أو تجربة فتح دفتر العناوين مباشرة ➔'}
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-slate-900/60 border-t border-slate-700/60 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-colors"
          >
            إلغاء
          </button>
        </div>

      </div>
    </div>
  );
};

export default ContactPickerModal;
