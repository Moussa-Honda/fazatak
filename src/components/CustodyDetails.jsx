import { useState, useEffect } from 'react';
import { portfolioExpenseService, settingsService } from '../services/database';
import { toHijriDate } from '../utils/dateUtils';
import { generatePDF, PDF_MODES } from '../utils/pdfGenerator';
import CustodyExpenseModal from './CustodyExpenseModal';

const CustodyDetails = ({ custody, onBack, isReadOnly }) => {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [spent, setSpent] = useState(0);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [hijriEnabled, setHijriEnabled] = useState(false);

  useEffect(() => {
    loadData();
    loadSettings();
  }, [custody.id]);

  const loadSettings = async () => {
    const hijri = await settingsService.get('hijri_calendar');
    setHijriEnabled(hijri === 'true');
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const list = await portfolioExpenseService.getByPortfolioId(custody.id);
      const total = await portfolioExpenseService.getStats(custody.id);
      setExpenses(list);
      setSpent(total);
    } catch (err) {
      console.error('Failed to load custody details:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteExpense = async (id) => {
    if (window.confirm('هل أنت متأكد من حذف هذا المصروف؟')) {
      await portfolioExpenseService.delete(id);
      loadData();
    }
  };

  const handleExportPDF = async () => {
    setGeneratingPdf(true);
    try {
      await generatePDF(custody, PDF_MODES.CUSTODY_STATEMENT, expenses);
    } catch (err) {
      console.error('PDF Error:', err);
    } finally {
      setGeneratingPdf(false);
    }
  };

  const remaining = custody.capital - spent;
  const spentPercentage = (spent / custody.capital) * 100;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-900">
      {/* Header */}
      <div className="p-4 bg-slate-800 border-b border-slate-700 flex items-center gap-3 shrink-0" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}>
        <button onClick={onBack} className="p-2 hover:bg-slate-700 rounded-lg transition-colors">
          <svg className="w-6 h-6 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-white">{custody.name}</h2>
          <p className="text-slate-400 text-xs">إدارة مصروفات العهدة</p>
        </div>
        <button
          onClick={handleExportPDF}
          disabled={generatingPdf}
          className="px-3 py-2 bg-purple-600/20 border border-purple-500/50 text-purple-400 rounded-lg text-sm font-medium hover:bg-purple-600/30 transition-colors flex items-center gap-1.5"
        >
          {generatingPdf ? (
            <div className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          )}
          PDF
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {/* Summary Card */}
        <div className="p-4">
          <div className="bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl relative overflow-hidden">
            {/* Background Decoration */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-600/10 blur-3xl -mr-16 -mt-16 rounded-full" />
            
            <div className="relative">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <p className="text-slate-400 text-sm mb-1">الرصيد المتبقي</p>
                  <h3 className="text-3xl font-black text-white">
                    {remaining.toLocaleString()} <span className="text-sm font-normal text-slate-500">SAR</span>
                  </h3>
                </div>
                <div className="w-12 h-12 bg-blue-500/20 rounded-2xl flex items-center justify-center text-2xl">💰</div>
              </div>

              <div className="space-y-4">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">إجمالي العهدة: {custody.capital.toLocaleString()}</span>
                  <span className="text-rose-400">المنصرف: {spent.toLocaleString()}</span>
                </div>
                
                <div className="h-3 bg-slate-900 rounded-full overflow-hidden p-0.5 border border-slate-700">
                  <div 
                    className={`h-full rounded-full transition-all duration-1000 ${
                      spentPercentage > 90 ? 'bg-rose-500' : spentPercentage > 70 ? 'bg-amber-500' : 'bg-blue-500'
                    }`}
                    style={{ width: `${Math.min(100, spentPercentage)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Expenses List */}
        <div className="px-4 pb-20 space-y-3">
          <div className="flex items-center justify-between py-2">
            <h3 className="text-white font-bold">سجل المصروفات</h3>
            <span className="text-slate-500 text-xs">{expenses.length} عملية</span>
          </div>

          {expenses.length === 0 ? (
            <div className="py-12 text-center bg-slate-800/30 rounded-3xl border border-dashed border-slate-700">
              <p className="text-slate-500 text-sm">لا توجد مصروفات مسجلة لهذه العهدة</p>
            </div>
          ) : (
            expenses.map((exp) => (
              <div key={exp.id} className="bg-slate-800/50 rounded-2xl p-4 border border-slate-700/50 flex items-center justify-between group">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-rose-500/10 rounded-xl flex items-center justify-center text-rose-400">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="text-white font-bold text-sm">{exp.description || 'مصروف عام'}</h4>
                    <div className="text-slate-500 text-[10px]">
                      {exp.date}
                      {hijriEnabled && (
                        <span className="block text-slate-600">{toHijriDate(exp.date)}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-rose-400 font-bold">{exp.amount.toLocaleString()}</span>
                  <button 
                    onClick={() => handleDeleteExpense(exp.id)}
                    className="p-2 text-slate-600 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* FAB Add Expense */}
      <div className="fixed bottom-24 left-6 z-50">
        <button
          onClick={() => setShowExpenseModal(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white w-14 h-14 rounded-2xl shadow-lg shadow-blue-600/30 flex items-center justify-center btn-press"
        >
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        </button>
      </div>

      {showExpenseModal && (
        <CustodyExpenseModal
          portfolioId={custody.id}
          onClose={() => setShowExpenseModal(false)}
          onSaved={() => {
            setShowExpenseModal(false);
            loadData();
          }}
        />
      )}
    </div>
  );
};

export default CustodyDetails;
