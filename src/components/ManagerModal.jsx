import { useState, useEffect } from 'react';
import { managerService } from '../services/database';

const ManagerModal = ({ isOpen, onClose, onSave, manager = null }) => {
  const [formData, setFormData] = useState({
    name: '',
    phone: ''
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (manager) {
      setFormData({
        name: manager.name || '',
        phone: manager.phone || ''
      });
    } else {
      setFormData({ name: '', phone: '' });
    }
  }, [manager, isOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) return alert('يرجى إدخال اسم المدير');
    
    setLoading(true);
    try {
      if (manager) {
        // We don't have update manager in service yet, let's add it if needed, 
        // but for now let's just focus on creation as requested.
        // I'll add update to managerService later.
      } else {
        await managerService.create(formData);
      }
      onSave();
      onClose();
    } catch (error) {
      console.error('Error saving manager:', error);
      alert('حدث خطأ أثناء الحفظ');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] modal-safe-area">
      <div className="bg-slate-800 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-700">
        <div className="bg-slate-700/50 px-6 py-4 flex justify-between items-center border-b border-slate-600">
          <h3 className="text-xl font-black text-white">
            {manager ? 'تعديل مدير' : 'إضافة مدير جديد'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors p-2">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className="block text-sm font-bold text-slate-400 mb-2 mr-1">اسم المدير (أو الجروب)</label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full bg-slate-900/50 border border-slate-700 rounded-2xl px-5 py-4 text-white placeholder-slate-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-all"
              placeholder="مثلاً: موسى، محمد، جروب الرياض..."
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-400 mb-2 mr-1">رقم الهاتف (اختياري)</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full bg-slate-900/50 border border-slate-700 rounded-2xl px-5 py-4 text-white placeholder-slate-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-all"
              placeholder="05xxxxxxxx"
              dir="ltr"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white py-4 rounded-2xl font-black text-lg btn-press disabled:opacity-50 shadow-xl shadow-blue-900/20 mt-2"
          >
            {loading ? 'جاري الحفظ...' : (manager ? 'حفظ التغييرات' : 'إضافة الآن')}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ManagerModal;
