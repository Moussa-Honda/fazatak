import { useState, useEffect } from 'react';
import { useGreeting, useManagerStats } from '../hooks/useApp';
import CustomerList from '../components/CustomerList';
import ContractList from '../components/ContractList';
import Settings from '../components/Settings';
import LicenseGate from '../components/LicenseGate';
import CustodyList from '../components/CustodyList';
import CustodyDetails from '../components/CustodyDetails';
import ManagerList from '../components/ManagerList';
import { generatePDFStatement } from '../utils/pdfGenerator';
import { contractService, managerService, customerService } from '../services/database';

const Dashboard = ({ isExpired, expiry, onReActivate }) => {
  const greeting = useGreeting();
  const { stats, loading } = useManagerStats();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [selectedCustody, setSelectedCustody] = useState(null);
  const [selectedManager, setSelectedManager] = useState(null);
  const [showRenewal, setShowRenewal] = useState(false);

  const getRemainingDays = () => {
    if (!expiry) return null;
    if (expiry > 2100000000) return 'تفعيل دائم';
    const now = Math.floor(Date.now() / 1000);
    const diff = expiry - now;
    if (diff <= 0) return 'منتهي';
    const days = Math.ceil(diff / (24 * 60 * 60));
    return `باقي ${days} يوم`;
  };

  const remainingText = getRemainingDays();

  const tabs = [
    { id: 'dashboard', label: 'الرئيسية', icon: (active) => (
      <svg className="w-6 h-6" fill={active ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    )},
    { id: 'managers', label: 'الحسابات بالنيابة', icon: (active) => (
      <svg className="w-6 h-6" fill={active ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
          d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    )},
    { id: 'debtors', label: 'المتعثرين', icon: (active) => (
      <svg className="w-6 h-6" fill={active ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    )},
    { id: 'custody', label: 'العهد', icon: (active) => (
      <svg className="w-6 h-6" fill={active ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
          d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    )},
    { id: 'settings', label: 'الإعدادات', icon: (active) => (
      <svg className="w-6 h-6" fill={active ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    )},
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <div className="flex flex-col h-full overflow-y-auto custom-scrollbar">
            {isExpired && (
              <div className="mx-4 mt-4 p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-center justify-between gap-3 animate-pulse">
                <div className="flex-1">
                  <h4 className="text-rose-400 font-bold text-sm">انتهى الاشتراك! ⚠️</h4>
                  <p className="text-rose-400/80 text-[10px]">برجاء التجديد لمتابعة إضافة المعاملات الجديدة.</p>
                </div>
                <button
                  onClick={() => setShowRenewal(true)}
                  className="bg-rose-500 text-white px-3 py-2 rounded-lg text-xs font-bold shadow-lg shadow-rose-500/20"
                >
                  تجديد الآن
                </button>
              </div>
            )}

            <div className="p-4 flex items-center justify-between" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}>
              <div>
                <h1 className="text-2xl font-bold text-white mb-1">
                  {greeting}
                  <span className="text-[10px] bg-blue-500 text-white px-2 py-0.5 rounded-full ml-2 align-middle">v2.0</span>
                </h1>
                <p className="text-slate-400">نظرة عامة على أداء عملك اليوم</p>
              </div>
              {remainingText && (
                <div className={`px-3 py-1.5 rounded-full text-[10px] font-bold flex items-center gap-1.5 border shadow-sm ${
                  isExpired ? 'bg-rose-500/10 text-rose-400 border-rose-500/30' :
                  remainingText === 'تفعيل دائم' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' :
                  'bg-blue-500/10 text-blue-400 border-blue-500/30'
                }`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                  {remainingText}
                </div>
              )}
            </div>

            <div className="p-4 space-y-3">
              {/* Manager Accounts Statistics */}
              <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-4">
                <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                  <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  إحصائيات الحسابات بالنيابة
                </h3>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-slate-900/50 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-slate-500 font-bold mb-1">إجمالي التقسيط</p>
                    <p className="text-sm font-black text-indigo-400">{Math.round(stats.managerTotalInstallments || 0).toLocaleString('en-US')}</p>
                  </div>
                  <div className="bg-slate-900/50 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-slate-500 font-bold mb-1">المدفوع</p>
                    <p className="text-sm font-black text-emerald-400">{Math.round(stats.managerTotalPaid || 0).toLocaleString('en-US')}</p>
                  </div>
                  <div className="bg-slate-900/50 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-slate-500 font-bold mb-1">المتبقي</p>
                    <p className="text-sm font-black text-rose-400">{Math.round(stats.managerTotalRemaining || 0).toLocaleString('en-US')}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-4 pb-4">
              <button
                onClick={() => {
                  if (isExpired) {
                    setShowRenewal(true);
                  } else {
                    setActiveTab('managers');
                  }
                }}
                className={`w-full ${isExpired ? 'bg-slate-700 text-slate-400' : 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white'} py-4 rounded-2xl font-bold text-lg btn-press flex items-center justify-center gap-3 shadow-lg ${!isExpired && 'shadow-indigo-600/30'}`}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {isExpired ? 'تجديد لإضافة عملاء' : 'إضافة حساب بالنيابة'}
              </button>
            </div>
          </div>
        );

      case 'managers':
        return selectedCustomer ? (
          <div className="flex flex-col h-full">
            <div className="p-4 bg-slate-800 border-b border-slate-700 flex items-center gap-3" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}>
              <button onClick={() => setSelectedCustomer(null)} className={`p-2 ${selectedCustomer.manager_id ? 'hover:bg-indigo-700/50' : 'hover:bg-slate-700'} rounded-lg transition-colors`}>
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
              <div className="flex-1">
                <h2 className="text-lg font-bold text-white">{selectedCustomer.name?.replace(/\s*0+$/g, '').trim() || 'عميل'}</h2>
                <p className="text-slate-400 text-sm">{selectedCustomer.phone}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    const newValue = !selectedCustomer.is_manually_flagged_as_overdue;
                    await customerService.update(selectedCustomer.id, { is_manually_flagged_as_overdue: newValue });
                    setSelectedCustomer({ ...selectedCustomer, is_manually_flagged_as_overdue: newValue });
                  }}
                  className={`px-3 py-2 rounded-lg text-xs font-bold transition-all border ${
                    selectedCustomer.is_manually_flagged_as_overdue 
                      ? 'bg-amber-500 border-amber-600 text-white' 
                      : 'bg-slate-700 border-slate-600 text-slate-400'
                  }`}
                >
                  {selectedCustomer.is_manually_flagged_as_overdue ? '🔴 متعثر' : '⚪ تمييز كمتعثر'}
                </button>
                <button
                  onClick={async () => {
                    try {
                      const contracts = await contractService.getByCustomerId(selectedCustomer.id);
                      await generatePDFStatement(selectedCustomer, contracts);
                    } catch (pdfErr) {
                      console.error('[Dashboard] PDF button error:', pdfErr);
                      alert('حدث خطأ أثناء إنشاء PDF');
                    }
                  }}
                  className="px-3 py-2 bg-purple-600/20 border border-purple-500/50 text-purple-400 rounded-lg text-sm font-medium hover:bg-purple-600/30 transition-colors"
                >
                  PDF
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
              <ContractList 
                customerId={selectedCustomer.id} 
                isReadOnly={isExpired} 
                onRenewalRequest={() => setShowRenewal(true)} 
                themeColor={selectedCustomer.manager_id ? 'indigo' : 'blue'}
              />
            </div>
          </div>
        ) : selectedManager ? (
          <CustomerList 
            onSelect={setSelectedCustomer} 
            isReadOnly={isExpired} 
            onRenewalRequest={() => setShowRenewal(true)} 
            managerId={selectedManager.id}
            managerName={selectedManager.name}
            onBack={() => setSelectedManager(null)}
          />
        ) : (
          <ManagerList 
            key="managers-list"
            onSelectManager={setSelectedManager} 
            onBack={() => setActiveTab('dashboard')} 
          />
        );

      case 'debtors':
        return selectedCustomer ? (
          <div className="flex flex-col h-full">
            <div className="p-4 bg-slate-800 border-b border-slate-700 flex items-center gap-3" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}>
              <button onClick={() => setSelectedCustomer(null)} className="p-2 hover:bg-rose-900/30 rounded-lg transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
              <div className="flex-1">
                <h2 className="text-lg font-bold text-white">{selectedCustomer.name}</h2>
                <span className="text-[10px] bg-rose-500 text-white px-2 py-0.5 rounded-full">عميل متعثر ⚠️</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    const newValue = !selectedCustomer.is_manually_flagged_as_overdue;
                    await customerService.update(selectedCustomer.id, { is_manually_flagged_as_overdue: newValue });
                    setSelectedCustomer({ ...selectedCustomer, is_manually_flagged_as_overdue: newValue });
                  }}
                  className={`px-3 py-2 rounded-lg text-xs font-bold transition-all border ${
                    selectedCustomer.is_manually_flagged_as_overdue 
                      ? 'bg-amber-500 border-amber-600 text-white' 
                      : 'bg-slate-700 border-slate-600 text-slate-400'
                  }`}
                >
                  {selectedCustomer.is_manually_flagged_as_overdue ? '🔴 متعثر' : '⚪ تمييز كمتعثر'}
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
              <ContractList customerId={selectedCustomer.id} isReadOnly={isExpired} themeColor="red" />
            </div>
          </div>
        ) : selectedManager ? (
          <CustomerList 
            onSelect={setSelectedCustomer} 
            isReadOnly={isExpired} 
            managerId={selectedManager.id}
            managerName={selectedManager.name}
            filterType="overdue"
            onBack={() => setSelectedManager(null)}
          />
        ) : (
          <ManagerList 
            key="debtors-list"
            onSelectManager={setSelectedManager} 
            filterType="overdue"
            onBack={() => setActiveTab('dashboard')} 
          />
        );

      case 'custody':
        return selectedCustody ? (
          <CustodyDetails 
            custody={selectedCustody} 
            onBack={() => setSelectedCustody(null)} 
            isReadOnly={isExpired}
          />
        ) : (
          <CustodyList onSelectCustody={setSelectedCustody} isReadOnly={isExpired} onRenewalRequest={() => setShowRenewal(true)} />
        );

      case 'settings':
        return <Settings 
          isReadOnly={isExpired} 
          onRenewalRequest={() => setShowRenewal(true)} 
        />;

      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-900">
      {/* ── Page content ── */}
      <div className="flex-1 overflow-hidden">
        {renderContent()}
      </div>

      {/* ── Bottom Navigation ── */}
      <nav className="bg-slate-900 border-t border-slate-700/50 shrink-0" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}>
        <div className="flex justify-around items-stretch" style={{ height: '70px' }}>
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  if (tab.id !== 'customers' && tab.id !== 'managers' && tab.id !== 'debtors') {
                    setSelectedCustomer(null);
                    setSelectedManager(null);
                  } else {
                    // Also reset selection when switching between these specific tabs
                    setSelectedCustomer(null);
                    setSelectedManager(null);
                  }
                  if (tab.id !== 'custody') setSelectedCustody(null);
                }}
                className="flex flex-col items-center justify-center gap-0.5 flex-1 relative px-1"
                style={{ minHeight: '70px' }}
              >
                {active && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[3px] rounded-full bg-blue-400" />
                )}
                <span className={`transition-all duration-200 ${active ? 'text-blue-400' : 'text-slate-400'}`}
                      style={{ transform: active ? 'scale(1.1)' : 'scale(1)', display: 'block' }}>
                  {tab.icon(active)}
                </span>
                <span style={{
                  fontSize: '9px',
                  fontWeight: '700',
                  color: active ? '#60a5fa' : '#94a3b8',
                  lineHeight: 1.2,
                  marginTop: '2px',
                  textAlign: 'center',
                  whiteSpace: 'nowrap'
                }}>
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* ── Renewal Modal ── */}
      {showRenewal && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowRenewal(false)} />
          <div className="relative w-full max-w-sm mx-4">
            <button
              onClick={() => setShowRenewal(false)}
              className="absolute -top-12 right-0 text-white/60 hover:text-white transition-colors"
            >
              إغلاق [X]
            </button>
            <LicenseGate
              onActivated={() => {
                setShowRenewal(false);
                onReActivate?.();
              }}
              isModal={true}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;

