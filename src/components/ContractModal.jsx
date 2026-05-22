import { useState, useEffect } from 'react';
import { contractService, installmentService, customerService, settingsService } from '../services/database';
import { getDefaultDueDate } from '../utils/dateUtils';
import { sanitizePhoneNumber } from '../utils/phoneUtils';

const ContractModal = ({ isOpen, onClose, onSave, customerId, customerName, isBlacklisted, themeColor = 'blue' }) => {
  const themeBg = themeColor === 'indigo' ? 'bg-indigo-600' : 'bg-emerald-600';
  const themeFocus = themeColor === 'indigo' ? 'focus:border-indigo-500' : 'focus:border-blue-500';
  const themeShadow = themeColor === 'indigo' ? 'shadow-indigo-600/30' : 'shadow-emerald-600/30';
  const [formData, setFormData] = useState({
    title: '',
    capital_amount: '',
    total_amount: '',
    monthly_amount: '',
    installment_count: '',
    first_due_date: new Date().toISOString().split('T')[0],
    guarantor_name: '',
    guarantor_phone: ''
  });
  const [loading, setLoading] = useState(false);
  const [salaryDaySync, setSalaryDaySync] = useState(false);
  const [customerCreditScore, setCustomerCreditScore] = useState('A');

  useEffect(() => {
    if (isOpen) {
      loadSettings();
      checkCreditScore();
      setFormData({
        title: '',
        capital_amount: '',
        total_amount: '',
        monthly_amount: '',
        installment_count: '',
        first_due_date: salaryDaySync ? getDefaultDueDate() : new Date().toISOString().split('T')[0],
        guarantor_name: '',
        guarantor_phone: ''
      });
    }
  }, [isOpen, salaryDaySync]);

  const loadSettings = async () => {
    const salary = await settingsService.get('salary_day_sync');
    setSalaryDaySync(salary === 'true');
  };

  const checkCreditScore = async () => {
    const score = await customerService.getCreditScore(customerId);
    setCustomerCreditScore(score);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (isBlacklisted) {
      const confirmed = window.confirm('⚠️ هذا العميل في القائمة السوداء. هل تريد المتابعة؟');
      if (!confirmed) return;
    }

    if (customerCreditScore === 'C') {
      const confirmed = window.confirm('⚠️ هذا العميل لديه تقييم ائتماني ضعيف (C). هل تريد المتابعة؟');
      if (!confirmed) return;
    }

    setLoading(true);
    
    try {
      const title = formData.title.trim() || 'عقد جديد';
      const capitalAmount = parseFloat(formData.capital_amount) || 0;
      const totalAmount = parseFloat(formData.total_amount) || 0;
      const monthlyAmount = parseFloat(formData.monthly_amount) || 0;
      const months = parseFloat(formData.installment_count) || 0;

      // Validation: Check if months are sufficient
      // The last month can have extra amount to cover the total
      // Example: 7600 total, 500 monthly, 15 months
      // 14 months × 500 = 7000, last month = 600 (500 + 100 extra) ✓
      
      const regularAmountTotal = monthlyAmount * (months - 1);
      const lastMonthMin = totalAmount - regularAmountTotal;
      
      // Last month must be at least the monthly amount (can be more)
      if (lastMonthMin > monthlyAmount * 2) {
        // If last month needs more than 2x monthly, reject
        const requiredMonths = Math.ceil(totalAmount / monthlyAmount);
        alert(`❌ عدد الأشهر غير كافٍ!\n\nالمطلوب: ${requiredMonths} أشهر على الأقل\nالمُدخل: ${months} شهر\n\nلتغطية مبلغ ${totalAmount.toLocaleString('ar-SA')} ريال بقسط شهري ${monthlyAmount.toLocaleString('ar-SA')} ريال`);
        setLoading(false);
        return;
      }

      const contractId = await contractService.create({
        customer_id: customerId,
        title: title,
        capital_amount: capitalAmount,
        total_amount: totalAmount,
        guarantor_name: formData.guarantor_name || null,
        guarantor_phone: formData.guarantor_phone ? sanitizePhoneNumber(formData.guarantor_phone) : null
      });

      const firstDate = new Date(formData.first_due_date);
      const totalMonths = Math.ceil(months);
      
      // Smart calculation: distribute total amount across months
      // Example: 7600 total, 500 monthly, 15 months
      // 14 months × 500 = 7000
      // Last month = 7600 - 7000 = 600
      
      // All months except last get the regular monthly amount
      const regularInstallmentAmount = monthlyAmount;
      const numberOfRegularMonths = totalMonths - 1;
      const totalRegularAmount = regularInstallmentAmount * numberOfRegularMonths;
      
      // Last installment gets the remainder (can be more than monthly amount)
      const lastInstallmentAmount = totalAmount - totalRegularAmount;
      
      for (let i = 0; i < totalMonths; i++) {
        const dueDate = new Date(firstDate);
        dueDate.setMonth(dueDate.getMonth() + i);
        
        // Determine amount for this installment
        let installmentAmount;
        
        if (i < numberOfRegularMonths) {
          // Regular months get the monthly amount
          installmentAmount = regularInstallmentAmount;
        } else {
          // Last month gets the remainder (may be more than monthly amount)
          installmentAmount = lastInstallmentAmount;
        }
        
        // Handle fractional months for the last installment
        if (i === totalMonths - 1 && months % 1 !== 0) {
          const fractionalPart = months % 1;
          installmentAmount = installmentAmount * fractionalPart;
        }
        
        // Only create installment if amount > 0
        if (installmentAmount > 0) {
          await installmentService.create({
            contract_id: contractId,
            amount: Math.round(installmentAmount * 100) / 100,
            due_date: dueDate.toISOString().split('T')[0]
          });
        }
      }

      onSave();
      onClose();
    } catch (error) {
      console.error('Error creating contract:', error);
    } finally {
      setLoading(false);
    }
  };

  const totalAmount = parseFloat(formData.total_amount) || 0;
  const installmentCount = parseFloat(formData.installment_count) || 0;
  const monthlyAmount = parseFloat(formData.monthly_amount) || 0;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl w-full max-w-md overflow-hidden max-h-[90dvh] flex flex-col">
        <div className={`${themeColor === 'indigo' ? 'bg-indigo-900/50' : 'bg-slate-700'} px-6 py-4 flex justify-between items-center shrink-0`}>
          <div>
            <h3 className="text-lg font-bold text-white">عقد جديد - {customerName}</h3>
            {customerCreditScore !== 'A' && (
              <div className={`text-xs mt-1 px-2 py-0.5 rounded inline-block ${
                customerCreditScore === 'B' ? 'bg-amber-500/20 text-amber-400' : 'bg-rose-500/20 text-rose-400'
              }`}>
                التقييم الائتماني: {customerCreditScore}
              </div>
            )}
          </div>
          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {isBlacklisted && (
          <div className="bg-rose-500/20 border border-rose-500/50 text-rose-400 px-4 py-3 m-4 rounded-xl">
            ⚠️ تحذير: هذا العميل في القائمة السوداء
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto custom-scrollbar">
          <div>
            <label className="block text-sm text-slate-400 mb-2">وصف العقد / المنتج</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className={`w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 ${themeFocus} focus:outline-none transition-colors`}
              placeholder="مثال: جهاز iPhone 15 Pro (أو اتركه فارغاً لـ 'عقد جديد')"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-2">
              رأس المال (للمالك فقط)
              <span className="text-rose-400 text-xs mr-1">* مخفي عن العميل</span>
            </label>
            <input
              type="number"
              step="0.01"
              value={formData.capital_amount}
              onChange={(e) => setFormData({ ...formData, capital_amount: e.target.value })}
              className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none transition-colors"
              placeholder="0.00"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-2">إجمالي مبلغ العقد</label>
            <input
              type="number"
              step="0.01"
              value={formData.total_amount}
              onChange={(e) => setFormData({ ...formData, total_amount: e.target.value })}
              className={`w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 ${themeFocus} focus:outline-none transition-colors`}
              placeholder="0.00"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-400 mb-2">القسط الشهري</label>
              <input
                type="number"
                step="0.01"
                value={formData.monthly_amount}
                onChange={(e) => setFormData({ ...formData, monthly_amount: e.target.value })}
                className={`w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white ${themeFocus} focus:outline-none transition-colors`}
                placeholder="0.00"
                required
              />
            </div>

            <div>
              <label className="block text-sm text-slate-400 mb-2">عدد الأقساط</label>
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={formData.installment_count}
                onChange={(e) => setFormData({ ...formData, installment_count: e.target.value })}
                className={`w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white ${themeFocus} focus:outline-none transition-colors`}
                placeholder="مثال: 12 أو 3.5"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-2">أول قسط</label>
            <input
              type="date"
              value={formData.first_due_date}
              onChange={(e) => setFormData({ ...formData, first_due_date: e.target.value })}
              className={`w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white ${themeFocus} focus:outline-none transition-colors`}
            />
          </div>

          {totalAmount > 0 && installmentCount > 0 && monthlyAmount > 0 && (
            <div className="bg-slate-700/50 rounded-xl p-4 text-center border border-slate-600">
              <p className="text-slate-400 text-sm mb-1">توزيع الأقساط</p>
              <p className="text-lg text-amber-400">
                الأقساط 1-{Math.ceil(installmentCount) - 1}: <span className="font-bold">{monthlyAmount.toLocaleString('ar-SA')}</span> ريال
              </p>
              <p className="text-slate-500 text-xs mt-1">
                القسط الأخير: {(totalAmount - (monthlyAmount * (Math.ceil(installmentCount) - 1))).toLocaleString('ar-SA')} ريال
              </p>
            </div>
          )}

          {/* Guarantor Section */}
          <div className="border-t border-slate-700 pt-4">
            <h4 className="text-sm font-bold text-slate-400 mb-3 flex items-center gap-2">
              <span>👤</span>
              معلومات الكفيل (اختياري)
            </h4>
            
            <div className="space-y-3">
              <input
                type="text"
                value={formData.guarantor_name}
                onChange={(e) => setFormData({ ...formData, guarantor_name: e.target.value })}
                className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none transition-colors"
                placeholder="اسم الكفيل"
              />
              
              <input
                type="tel"
                value={formData.guarantor_phone}
                onChange={(e) => setFormData({ ...formData, guarantor_phone: e.target.value })}
                className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none transition-colors"
                placeholder="رقم هاتف الكفيل"
                dir="ltr"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className={`w-full ${themeBg} text-white py-3 rounded-xl font-bold btn-press disabled:opacity-50 shadow-lg ${themeShadow}`}
          >
            {loading ? 'جاري الإنشاء...' : 'إنشاء العقد والأقساط'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ContractModal;
