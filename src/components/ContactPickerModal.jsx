import { useState, useRef } from 'react';
import { 
  isWebContactsSupported, 
  isNativePlatform, 
  pickContactDirectly, 
  parseVCard, 
  parseContactText 
} from '../services/contactService';
import { formatPhoneForDisplay } from '../utils/phoneUtils';

const ContactPickerModal = ({ isOpen, onClose, onSelectContact, title = 'استرداد جهة اتصال' }) => {
  const fileInputRef = useRef(null);
  const [activeTab, setActiveTab] = useState('direct'); // direct | file | paste
  const [pastedText, setPastedText] = useState('');
  const [parsedFromPaste, setParsedFromPaste] = useState(null);
  const [vcardContacts, setVcardContacts] = useState([]);
  const [vcardSearch, setVcardSearch] = useState('');
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
        setErrorMsg('متصفحك الحالي لا يدعم الاختيار المباشر. يمكنك استخدام خيار "ملف جهة اتصال VCF" أو "اللصق الذكي" أدناه.');
        setActiveTab('file');
      }
    } catch (err) {
      console.warn('Direct pick error:', err);
      setErrorMsg('تعذر فتح جهات الاتصال المباشرة. يرجى اختيار ملف VCF أو استخدام اللصق.');
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg('');
    setLoading(true);

    try {
      const text = await file.text();
      const contacts = parseVCard(text);

      if (!contacts || contacts.length === 0) {
        setErrorMsg('لم يتم العثور على أي جهات اتصال صالحة في الملف المختار.');
        setVcardContacts([]);
      } else if (contacts.length === 1) {
        // جهة اتصال واحدة فقط، نعتمدها مباشرة ونغلق النافذة
        onSelectContact(contacts[0]);
        onClose();
      } else {
        // ملف يحتوي على عدة جهات اتصال (مثل نسخة احتياطية من جهات الاتصال)
        setVcardContacts(contacts);
      }
    } catch (err) {
      console.error('Error reading VCF:', err);
      setErrorMsg('حدث خطأ أثناء قراءة ملف جهة الاتصال: ' + err.message);
    } finally {
      setLoading(false);
      // إعادة تعيين الحقل ليسمح باختيار نفس الملف مجدداً إن لزم
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePasteChange = (text) => {
    setPastedText(text);
    if (!text.trim()) {
      setParsedFromPaste(null);
      return;
    }
    const detected = parseContactText(text);
    setParsedFromPaste(detected);
  };

  const handleApplyPasted = () => {
    if (parsedFromPaste) {
      onSelectContact({
        name: parsedFromPaste.name || 'عميل جديد',
        phone: parsedFromPaste.phone || ''
      });
      onClose();
    }
  };

  const filteredVcardContacts = vcardContacts.filter(c => 
    c.name.toLowerCase().includes(vcardSearch.toLowerCase()) || 
    c.phone.includes(vcardSearch)
  );

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4 modal-safe-area animate-fade-in">
      <div className="bg-slate-800 border border-slate-700 rounded-3xl w-full max-w-md overflow-hidden max-h-[90dvh] flex flex-col shadow-2xl">
        
        {/* Header */}
        <div className="bg-slate-700/70 border-b border-slate-600/50 px-5 py-4 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">📇</span>
            <div>
              <h3 className="text-base font-bold text-white leading-snug">{title}</h3>
              <p className="text-xs text-slate-400">جلب وتعبئة بيانات الاسم ورقم الهاتف تلقائياً</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex p-2 bg-slate-900/60 border-b border-slate-800 gap-1 text-xs font-bold shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('direct')}
            className={`flex-1 py-2.5 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'direct' 
                ? 'bg-blue-600 text-white shadow-md shadow-blue-900/30' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>📱</span>
            <span>مباشر من الهاتف</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('file')}
            className={`flex-1 py-2.5 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'file' 
                ? 'bg-blue-600 text-white shadow-md shadow-blue-900/30' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>📁</span>
            <span>ملف VCF / بطاقة</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('paste')}
            className={`flex-1 py-2.5 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'paste' 
                ? 'bg-blue-600 text-white shadow-md shadow-blue-900/30' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>📋</span>
            <span>لصق ذكي</span>
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto custom-scrollbar space-y-4 flex-1">
          {errorMsg && (
            <div className="p-3 bg-rose-500/15 border border-rose-500/30 rounded-xl text-rose-300 text-xs flex items-start gap-2">
              <span className="text-sm shrink-0">⚠️</span>
              <p className="leading-relaxed">{errorMsg}</p>
            </div>
          )}

          {/* TAB 1: Direct Contact Picker */}
          {activeTab === 'direct' && (
            <div className="space-y-4 py-2 text-center">
              <div className="w-16 h-16 bg-blue-500/10 border border-blue-500/30 rounded-2xl mx-auto flex items-center justify-center text-3xl shadow-inner">
                📲
              </div>
              <div>
                <h4 className="font-bold text-white text-base">استيراد مباشر من دفتر الهاتف</h4>
                <p className="text-slate-400 text-xs mt-1 leading-relaxed max-w-xs mx-auto">
                  {canPickDirectly 
                    ? 'اضغط على الزر أدناه لاختيار جهة الاتصال من هاتفك فوراً.' 
                    : 'متصفحك الحالي (مثل Safari على iPhone أو متصفح الكمبيوتر) لا يوفر ميزة الوصول المباشر لجهات الاتصال، لكن يمكنك استخدام خيار "ملف VCF" بسهولة.'}
                </p>
              </div>

              {canPickDirectly ? (
                <button
                  type="button"
                  onClick={handleDirectPick}
                  disabled={loading}
                  className="w-full bg-blue-600 hover:bg-blue-500 active:scale-[0.99] text-white py-3.5 rounded-xl font-bold btn-press shadow-lg shadow-blue-600/30 transition-all flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                      </svg>
                      <span>فتح قائمة جهات الاتصال</span>
                    </>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setActiveTab('file')}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-3.5 rounded-xl font-bold btn-press shadow-lg shadow-emerald-600/30 transition-all flex items-center justify-center gap-2"
                >
                  <span>📁 الانتقال لاختيار ملف جهة الاتصال (VCF)</span>
                </button>
              )}

              <div className="bg-slate-900/60 rounded-xl p-3 border border-slate-700/60 text-right space-y-1">
                <p className="text-[11px] font-bold text-slate-300">💡 معلومة عن خصوصية PWA:</p>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  نحن لا نطلع على جهات اتصالك بالكامل، بل يطلب المتصفح منك اختيار الاسم المطلوب فقط لتعبئة بياناته تلقائياً.
                </p>
              </div>
            </div>
          )}

          {/* TAB 2: VCF / vCard file */}
          {activeTab === 'file' && (
            <div className="space-y-4">
              <input 
                ref={fileInputRef}
                type="file" 
                accept=".vcf,text/vcard,text/x-vcard" 
                onChange={handleFileChange}
                className="hidden" 
              />

              <div 
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-600 hover:border-blue-500 rounded-2xl p-6 text-center cursor-pointer bg-slate-900/40 hover:bg-slate-900/80 transition-all group"
              >
                <div className="w-14 h-14 rounded-2xl bg-blue-500/10 text-blue-400 group-hover:scale-110 group-hover:bg-blue-500/20 transition-all flex items-center justify-center mx-auto text-2xl mb-3">
                  📂
                </div>
                <h4 className="font-bold text-white text-sm">اختر ملف جهة الاتصال (.vcf)</h4>
                <p className="text-slate-400 text-xs mt-1">اضغط هنا لفتح الملفات واختيار بطاقة جهة الاتصال</p>
                <span className="inline-block mt-3 px-3 py-1 bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-lg text-xs font-bold">
                  تصفح الملفات
                </span>
              </div>

              {/* إذا كان الملف يحتوي على عدة أسماء */}
              {vcardContacts.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-slate-700">
                  <div className="flex justify-between items-center text-xs text-slate-300">
                    <span className="font-bold">عُثر على {vcardContacts.length} جهة اتصال في الملف:</span>
                    <button 
                      onClick={() => setVcardContacts([])}
                      className="text-rose-400 hover:underline"
                    >
                      إلغاء القائمة
                    </button>
                  </div>

                  <input
                    type="text"
                    value={vcardSearch}
                    onChange={(e) => setVcardSearch(e.target.value)}
                    placeholder="ابحث داخل الملف..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white text-xs placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />

                  <div className="max-h-48 overflow-y-auto custom-scrollbar space-y-1.5">
                    {filteredVcardContacts.slice(0, 50).map((contact, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          onSelectContact(contact);
                          onClose();
                        }}
                        className="w-full text-right bg-slate-900/70 hover:bg-blue-600/20 border border-slate-700/60 hover:border-blue-500/50 p-2.5 rounded-xl transition-all flex items-center justify-between group"
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-slate-800 text-slate-300 flex items-center justify-center font-bold text-xs">
                            {contact.name?.charAt(0) || '👤'}
                          </div>
                          <div>
                            <p className="text-xs font-bold text-white group-hover:text-blue-300">{contact.name}</p>
                            <p className="text-[10px] text-slate-400 font-mono" dir="ltr">{formatPhoneForDisplay(contact.phone)}</p>
                          </div>
                        </div>
                        <span className="text-xs text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity">اختيار ←</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* iPhone guidance tip */}
              <div className="bg-slate-900/70 rounded-xl p-3.5 border border-slate-700/60 text-right space-y-1.5 text-xs">
                <p className="font-bold text-amber-400 flex items-center gap-1.5">
                  <span>💡</span>
                  <span>طريقة استخراج جهة الاتصال في iPhone:</span>
                </p>
                <ol className="text-[11px] text-slate-300 leading-relaxed list-decimal list-inside space-y-1">
                  <li>افتح تطبيق <strong>جهات الاتصال</strong> على الآيفون.</li>
                  <li>اختر الاسم المطلوب ثم اضغط <strong>مشاركة جهة الاتصال</strong> (Share Contact).</li>
                  <li>اضغط <strong>حفظ في الملفات</strong> (Save to Files).</li>
                  <li>ارجع إلى التطبيق هنا واختر الملف المحفوظ ليتم استرداده فوراً.</li>
                </ol>
              </div>
            </div>
          )}

          {/* TAB 3: Smart Paste */}
          {activeTab === 'paste' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">
                  ألصق النص هنا (من واتساب، الرسائل أو جهات الاتصال):
                </label>
                <textarea
                  value={pastedText}
                  onChange={(e) => handlePasteChange(e.target.value)}
                  placeholder="مثال:
محمد عبد الله
0501234567"
                  rows={3}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white text-xs placeholder-slate-500 focus:outline-none focus:border-blue-500 custom-scrollbar"
                />
              </div>

              {parsedFromPaste && (
                <div className="bg-blue-900/20 border border-blue-500/40 rounded-xl p-3 space-y-2">
                  <p className="text-[11px] font-bold text-blue-300">البيانات التي تم التعرف عليها تلقائياً:</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                      <span className="text-[10px] text-slate-400 block">الاسم المستخرج:</span>
                      <span className="font-bold text-white">{parsedFromPaste.name || 'لم يحدد'}</span>
                    </div>
                    <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                      <span className="text-[10px] text-slate-400 block">رقم الهاتف:</span>
                      <span className="font-bold text-emerald-400 font-mono" dir="ltr">{parsedFromPaste.phone || 'لم يعثر على رقم'}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleApplyPasted}
                    disabled={!parsedFromPaste.phone && !parsedFromPaste.name}
                    className="w-full mt-2 bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-lg font-bold text-xs shadow-md disabled:opacity-50 transition-colors"
                  >
                    اعتماد البيانات وتعبئة النموذج
                  </button>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="bg-slate-800 border-t border-slate-700/60 p-3.5 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-bold rounded-xl transition-colors"
          >
            إغلاق
          </button>
        </div>

      </div>
    </div>
  );
};

export default ContactPickerModal;
