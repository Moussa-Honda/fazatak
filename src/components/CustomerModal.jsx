import { useState, useEffect } from 'react';
import { customerService } from '../services/database';
import { sanitizePhoneNumber } from '../utils/phoneUtils';

const CustomerModal = ({ isOpen, onClose, onSave, customer = null, managerId = null, themeColor = 'blue' }) => {
  const themeBg = themeColor === 'indigo' ? 'bg-indigo-600' : 'bg-blue-600';
  const themeFocus = themeColor === 'indigo' ? 'focus:border-indigo-500' : 'focus:border-blue-500';
  const themeShadow = themeColor === 'indigo' ? 'shadow-indigo-600/30' : 'shadow-blue-600/30';
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    is_blacklisted: false,
    is_manually_flagged_as_overdue: false,
    manager_id: managerId
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (customer) {
      setFormData({
        name: customer.name || '',
        phone: customer.phone || '',
        is_blacklisted: customer.is_blacklisted || false,
        is_manually_flagged_as_overdue: customer.is_manually_flagged_as_overdue || false,
        manager_id: customer.manager_id || managerId
      });
    } else {
      setFormData({ name: '', phone: '', is_blacklisted: false, is_manually_flagged_as_overdue: false, manager_id: managerId });
    }
  }, [customer, isOpen, managerId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      // Sanitize phone number before saving
      const sanitizedPhone = sanitizePhoneNumber(formData.phone);
      
      // Apply fallback for empty name
      const dataToSave = {
        ...formData,
        name: formData.name.trim() || 'عميل جديد',
        phone: sanitizedPhone
      };

      if (customer) {
        await customerService.update(customer.id, dataToSave);
      } else {
        await customerService.create(dataToSave);
      }
      onSave();
      onClose();
    } catch (error) {
      console.error('Error saving customer:', error);
    } finally {
      setLoading(false);
    }
  };

  const pickFromContacts = async () => {
    try {
      if ('contacts' in navigator && 'ContactsManager' in window) {
        try {
          const props = ['name', 'tel'];
          const contacts = await navigator.contacts.select(props, { multiple: false });
          if (contacts && contacts.length > 0) {
            const c = contacts[0];
            const name = c.name?.[0] || '';
            const phone = c.tel?.[0] || '';
            setFormData(prev => ({
              ...prev,
              name: name || prev.name,
              phone: sanitizePhoneNumber(phone) || prev.phone
            }));
            return;
          }
        } catch (e) {
          if (e.name === 'AbortError') return;
        }
      }

      const { Contacts } = await import('@capacitor-community/contacts');
      
      const result = await Contacts.pickContact({
        projection: {
          name: true,
          phones: true
        }
      });
      
      if (result.contact) {
        const contact = result.contact;
        const rawPhone = contact.phones?.[0]?.number || '';
        const sanitizedPhone = sanitizePhoneNumber(rawPhone);
        
        setFormData(prev => ({
          ...prev,
          name: contact.name?.display || prev.name,
          phone: sanitizedPhone
        }));
      }
    } catch (error) {
      console.warn('Contacts error:', error);
      alert('ميزة جلب الأسماء من جهات الاتصال تتطلب متصفحاً يدعم الوصول أو تشغيل التطبيق المثبت.');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 modal-safe-area">
      <div className="bg-slate-800 rounded-2xl w-full max-w-md overflow-hidden max-h-[90dvh] flex flex-col">
        <div className={`${themeColor === 'indigo' ? 'bg-indigo-900/50' : 'bg-slate-700'} px-6 py-4 flex justify-between items-center shrink-0`}>
          <h3 className="text-lg font-bold text-white">
            {customer ? 'تعديل عميل' : 'إضافة عميل جديد'}
          </h3>
          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto custom-scrollbar">
          {!customer && (
            <button
              type="button"
              onClick={pickFromContacts}
              className="w-full bg-blue-600/20 border border-blue-500/50 text-blue-400 py-3 rounded-xl font-medium btn-press flex items-center justify-center gap-2 hover:bg-blue-600/30 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
              </svg>
              اختيار من جهات الاتصال
            </button>
          )}

          <div>
            <label className="block text-sm text-slate-400 mb-2">اسم العميل</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className={`w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 ${themeFocus} focus:outline-none transition-colors`}
              placeholder="الاسم الثلاثي..."
            />
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-2">رقم الهاتف</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              onBlur={(e) => {
                // Sanitize on blur for preview
                const sanitized = sanitizePhoneNumber(e.target.value);
                setFormData(prev => ({ ...prev, phone: sanitized }));
              }}
              className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none transition-colors"
              placeholder="05xxxxxxxx أو +9665xxxxxxxx"
              dir="ltr"
            />
            <p className="text-xs text-slate-500 mt-1">يدعم 05 أو 00966 أو +966 (سيتم التحويل تلقائياً)</p>
          </div>

          <div className="flex items-center gap-3 bg-rose-500/10 border border-rose-500/30 rounded-xl p-3">
            <input
              type="checkbox"
              id="blacklist"
              checked={formData.is_blacklisted}
              onChange={(e) => setFormData({ ...formData, is_blacklisted: e.target.checked })}
              className="w-5 h-5 rounded border-slate-500 text-rose-500 focus:ring-rose-500"
            />
            <label htmlFor="blacklist" className="text-rose-400 text-sm font-medium">
              ⚠️ إضافة إلى القائمة السوداء
            </label>
          </div>

          <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
            <input
              type="checkbox"
              id="manual-overdue"
              checked={formData.is_manually_flagged_as_overdue}
              onChange={(e) => setFormData({ ...formData, is_manually_flagged_as_overdue: e.target.checked })}
              className="w-5 h-5 rounded border-slate-500 text-amber-500 focus:ring-amber-500"
            />
            <label htmlFor="manual-overdue" className="text-amber-400 text-sm font-medium">
              🔴 تأشير كمتعثر يدوياً
            </label>
          </div>

          <button
            type="submit"
            disabled={loading}
            className={`w-full ${themeBg} text-white py-3 rounded-xl font-bold btn-press disabled:opacity-50 shadow-lg ${themeShadow}`}
          >
            {loading ? 'جاري الحفظ...' : (customer ? 'حفظ التغييرات' : 'إضافة العميل')}
          </button>
        </form>
      </div>
    </div>
  );
};

export default CustomerModal;
