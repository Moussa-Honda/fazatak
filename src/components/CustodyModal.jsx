import { useState, useEffect } from 'react';
import { portfolioService } from '../services/database';

const CustodyModal = ({ custody, onClose, onSaved }) => {
  const [formData, setFormData] = useState({
    name: '',
    capital: '',
    description: ''
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (custody) {
      setFormData({
        name: custody.name,
        capital: custody.capital.toString(),
        description: custody.description || ''
      });
    }
  }, [custody]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name || !formData.capital) {
      alert('يرجى إدخال اسم المسؤول والمبلغ');
      return;
    }

    setLoading(true);
    try {
      const data = {
        name: formData.name,
        capital: parseFloat(formData.capital),
        description: formData.description
      };

      if (custody) {
        await portfolioService.update(custody.id, data);
      } else {
        await portfolioService.create(data);
      }
      onSaved();
    } catch (err) {
      console.error('Failed to save custody:', err);
      alert('حدث خطأ أثناء الحفظ');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center modal-safe-area">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative w-full max-w-md bg-slate-800 rounded-3xl border border-slate-700 shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="p-6 border-b border-slate-700 flex justify-between items-center">
          <h3 className="text-xl font-bold text-white">
            {custody ? 'تعديل بيانات العهدة' : 'فتح عهدة جديدة'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">اسم المسؤول</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:border-blue-500 focus:outline-none transition-colors"
              placeholder="مثال: موسى"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">المبلغ الإجمالي المسلم</label>
            <input
              type="number"
              value={formData.capital}
              onChange={(e) => setFormData({ ...formData, capital: e.target.value })}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:border-blue-500 focus:outline-none transition-colors"
              placeholder="0.00"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">ملاحظات (اختياري)</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:border-blue-500 focus:outline-none transition-colors h-24 resize-none"
              placeholder="تفاصيل إضافية عن العهدة..."
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl shadow-lg shadow-blue-600/20 transition-all active:scale-95 disabled:opacity-50"
          >
            {loading ? 'جاري الحفظ...' : (custody ? 'حفظ التعديلات' : 'تأكيد فتح العهدة')}
          </button>
        </form>
      </div>
    </div>
  );
};

export default CustodyModal;
