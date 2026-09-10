import { useCallback, useEffect, useState } from 'react';
import { useGreeting, useManagerStats } from '../hooks/useApp';
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import CustomerList from '../components/CustomerList';
import ContractList from '../components/ContractList';
import Settings from '../components/Settings';
import AuthGate from '../components/AuthGate';
import LicenseGate from '../components/LicenseGate';
import CustodyList from '../components/CustodyList';
import CustodyDetails from '../components/CustodyDetails';
import ManagerList from '../components/ManagerList';
import { generatePDFStatement } from '../utils/pdfGenerator';
import { contractService, customerService, installmentService, settingsService } from '../services/database';
import { notificationService } from '../services/notificationService';
import { formatForWhatsApp } from '../utils/phoneUtils';

const SUPPORT_PHONE_DISPLAY = '+966556854162';
const SUPPORT_WHATSAPP_PHONE = '966556854162';

const ALERT_META = {
  today: {
    title: 'الأقساط المستحقة اليوم',
    empty: 'لا توجد أقساط مستحقة اليوم.',
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/40'
  },
  late: {
    title: 'الأقساط المتأخرة حديثاً',
    empty: 'لا توجد أقساط متأخرة حديثاً خارج قسم المتعثرين.',
    badge: 'bg-rose-500/15 text-rose-300 border-rose-500/40'
  },
  upcoming: {
    title: 'الأقساط قريبة الاستحقاق',
    empty: 'لا توجد أقساط قريبة خلال الأيام القادمة.',
    badge: 'bg-sky-500/15 text-sky-300 border-sky-500/40'
  }
};

const getAlertAmount = (item) => {
  const remaining = Number(item?.amount || 0) - Number(item?.actual_paid || 0);
  return Math.round(Math.max(0, remaining) || Number(item?.amount || 0));
};

const HomeAlertsPanel = ({ alerts, loading, onSelectAlert }) => {
  const total = alerts?.total || 0;
  const cards = [
    {
      key: 'today',
      title: 'مستحق اليوم',
      count: alerts?.today?.length || 0,
      detail: 'أقساط تحتاج متابعة الآن',
      color: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
      dot: 'bg-amber-400',
      onClick: () => onSelectAlert('today')
    },
    {
      key: 'late',
      title: 'متأخر حديثاً',
      count: alerts?.late?.length || 0,
      detail: 'غير موجودة في قسم المتعثرين',
      color: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
      dot: 'bg-rose-400',
      onClick: () => onSelectAlert('late')
    },
    {
      key: 'upcoming',
      title: 'قريب الاستحقاق',
      count: alerts?.upcoming?.length || 0,
      detail: 'خلال الأيام القادمة',
      color: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
      dot: 'bg-sky-400',
      onClick: () => onSelectAlert('upcoming')
    }
  ];

  if (loading) {
    return (
      <div className="bg-slate-800/50 border border-slate-700/60 rounded-2xl p-4">
        <div className="h-4 w-32 bg-slate-700 rounded animate-pulse mb-3" />
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map(item => <div key={item} className="h-20 bg-slate-900/60 rounded-xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-emerald-300">كل الأقساط هادئة اليوم</h3>
          <p className="text-xs text-emerald-300/70 mt-1">لا توجد أقساط قريبة أو مستحقة أو متأخرة خارج قسم المتعثرين.</p>
        </div>
        <span className="w-3 h-3 rounded-full bg-emerald-400 shadow-[0_0_14px] shadow-emerald-400/60" />
      </div>
    );
  }

  return (
    <div className="bg-slate-800/50 border border-slate-700/60 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold text-white">تنبيهات الأقساط</h3>
          <p className="text-xs text-slate-400 mt-0.5">تظهر بدون عملاء قسم المتعثرين</p>
        </div>
        <div className="text-left">
          <p className="text-xl font-black text-white">{total}</p>
          <p className="text-[10px] text-slate-500">تنبيه</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {cards.map(card => (
          <button
            key={card.key}
            type="button"
            onClick={card.onClick}
            disabled={card.count === 0}
            className={`rounded-xl border p-3 text-right transition-transform active:scale-95 disabled:opacity-45 disabled:active:scale-100 ${card.color}`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className={`w-2.5 h-2.5 rounded-full ${card.dot}`} />
              <span className="text-xl font-black">{card.count}</span>
            </div>
            <p className="text-xs font-bold text-white">{card.title}</p>
            <p className="text-[10px] opacity-75 mt-1 leading-4">{card.detail}</p>
          </button>
        ))}
      </div>
    </div>
  );
};

const AlertDetailsModal = ({ type, items, onClose, onOpenCustomer, onSendWhatsApp }) => {
  const meta = ALERT_META[type] || ALERT_META.today;

  return (
    <div className="fixed inset-0 z-[9990] flex items-end sm:items-center justify-center modal-safe-area">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[86vh] bg-slate-900 border border-slate-700 shadow-2xl rounded-t-2xl sm:rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-slate-700 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-white text-lg font-bold">{meta.title}</h3>
            <p className="text-slate-400 text-xs mt-1">{items.length} تنبيه</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
          >
            X
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto custom-scrollbar max-h-[68vh]">
          {items.length === 0 ? (
            <div className="bg-slate-800/70 border border-slate-700 rounded-xl p-4 text-center text-slate-400 text-sm">
              {meta.empty}
            </div>
          ) : items.map((item) => (
            <div key={item.id} className="bg-slate-800/80 border border-slate-700 rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="text-white font-bold truncate">{item.customer_name || 'عميل'}</h4>
                  <p className="text-slate-400 text-xs mt-1 truncate">{item.contract_title || 'عقد'}</p>
                </div>
                <span className={`shrink-0 text-[11px] font-bold border rounded-full px-2 py-1 ${meta.badge}`}>
                  {getAlertAmount(item).toLocaleString('en-US')} ر.س
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-slate-900/60 rounded-lg p-2">
                  <p className="text-slate-500">تاريخ الاستحقاق</p>
                  <p className="text-slate-200 font-bold mt-1">{item.due_date || '-'}</p>
                </div>
                <div className="bg-slate-900/60 rounded-lg p-2">
                  <p className="text-slate-500">المسؤول</p>
                  <p className="text-slate-200 font-bold mt-1 truncate">{item.manager_name || 'بدون'}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onOpenCustomer(item)}
                  className="bg-blue-600/20 border border-blue-500/40 text-blue-300 py-2.5 rounded-xl text-xs font-bold hover:bg-blue-600/30 transition-colors"
                >
                  فتح العميل
                </button>
                <button
                  type="button"
                  onClick={() => onSendWhatsApp(item)}
                  className="bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 py-2.5 rounded-xl text-xs font-bold hover:bg-emerald-600/30 transition-colors"
                >
                  واتساب
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const Dashboard = ({ isExpired, expiry, onReActivate, currentUser, onLogout }) => {
  const greeting = useGreeting();
  const { stats } = useManagerStats();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [selectedCustody, setSelectedCustody] = useState(null);
  const [selectedManager, setSelectedManager] = useState(null);
  const [showRenewal, setShowRenewal] = useState(false);
  const [homeAlerts, setHomeAlerts] = useState({ late: [], today: [], upcoming: [], total: 0, totalAmount: 0 });
  const [homeAlertsLoading, setHomeAlertsLoading] = useState(true);
  const [selectedAlertType, setSelectedAlertType] = useState(null);

  const loadHomeAlerts = useCallback(async () => {
    try {
      setHomeAlertsLoading(true);
      const data = await installmentService.getHomeAlerts(3);
      setHomeAlerts(data);
    } catch (error) {
      console.error('Home alerts error:', error);
    } finally {
      setHomeAlertsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHomeAlerts();
    const interval = setInterval(loadHomeAlerts, 30000);
    return () => clearInterval(interval);
  }, [loadHomeAlerts]);

  useLiveRefresh(loadHomeAlerts);

  useEffect(() => {
    if (activeTab === 'dashboard') {
      loadHomeAlerts();
    }
  }, [activeTab, loadHomeAlerts]);

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
  const selectedAlertItems = selectedAlertType ? (homeAlerts?.[selectedAlertType] || []) : [];

  const handleSupportWhatsApp = () => {
    const message = 'السلام عليكم، أريد تجديد اشتراك تطبيق فزتك.';
    window.open(`https://wa.me/${SUPPORT_WHATSAPP_PHONE}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const handleOpenAlertCustomer = async (item) => {
    try {
      const customer = await customerService.getById(item.customer_id);
      if (!customer) {
        alert('تعذر فتح العميل');
        return;
      }

      setSelectedAlertType(null);
      setSelectedManager(null);
      setSelectedCustomer(customer);
      setActiveTab('managers');
    } catch (error) {
      console.error('Open alert customer error:', error);
      alert('تعذر فتح العميل');
    }
  };

  const handleAlertWhatsApp = async (item) => {
    const phone = formatForWhatsApp(item.customer_phone);
    if (!phone) {
      alert('لا يوجد رقم جوال لهذا العميل');
      return;
    }

    try {
      const template = await settingsService.getWhatsAppTemplate();
      const message = template
        .replace(/\[الاسم\]/g, item.customer_name || '')
        .replace(/\[المبلغ\]/g, getAlertAmount(item).toLocaleString('en-US'))
        .replace(/\[التاريخ\]/g, item.due_date || '')
        .replace(/\[العقد\]/g, item.contract_title || '');

      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
    } catch (error) {
      console.error('Alert WhatsApp error:', error);
      alert('تعذر تجهيز رسالة واتساب');
    }
  };

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
              <div className="mx-4 mt-4 p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-center justify-between gap-3">
                <div className="flex-1">
                  <h4 className="text-rose-400 font-bold text-sm">انتهى الاشتراك! ⚠️</h4>
                  <p className="text-rose-400/80 text-[10px]">لتجديد الاشتراك تواصل معنا: <span dir="ltr">{SUPPORT_PHONE_DISPLAY}</span></p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSupportWhatsApp}
                    className="bg-emerald-600 text-white px-3 py-2 rounded-lg text-xs font-bold shadow-lg shadow-emerald-600/20"
                  >
                    واتساب
                  </button>
                  <button
                    onClick={() => setShowRenewal(true)}
                    className="bg-rose-500 text-white px-3 py-2 rounded-lg text-xs font-bold shadow-lg shadow-rose-500/20"
                  >
                    تجديد
                  </button>
                </div>
              </div>
            )}

            <div className="p-4 flex items-center justify-between" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}>
              <div>
                <h1 className="text-2xl font-bold text-white mb-1">
                  {greeting}
                  <span className="text-[10px] bg-blue-500 text-white px-2 py-0.5 rounded-full ml-2 align-middle">v2.0</span>
                </h1>
                <p className="text-slate-400 text-xs">
                  {currentUser?.name ? (
                    <span className="text-emerald-400 font-medium">حساب: {currentUser.name} ({currentUser.phone})</span>
                  ) : (
                    'نظرة عامة على أداء عملك اليوم'
                  )}
                </p>
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
              <HomeAlertsPanel
                alerts={homeAlerts}
                loading={homeAlertsLoading}
                onSelectAlert={setSelectedAlertType}
              />

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
                    notificationService.refreshSchedule().catch(error => console.error('Notification refresh error:', error));
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
                    notificationService.refreshSchedule().catch(error => console.error('Notification refresh error:', error));
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
          onSettingsChange={loadHomeAlerts}
          onLicenseRenewed={onReActivate}
          currentUser={currentUser}
          onLogout={onLogout}
        />;

      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full max-h-full flex-1 min-h-0 w-full bg-slate-900 overflow-hidden relative">
      {/* ── Page content ── */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        {renderContent()}
      </div>

      {/* ── Bottom Navigation ── */}
      <nav
        className="bg-slate-900 border-t border-slate-700/50 shrink-0 z-30 relative"
        style={{
          paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 8px)'
        }}
      >
        <div className="flex justify-around items-stretch" style={{ height: '64px' }}>
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
                style={{ minHeight: '64px' }}
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

      {selectedAlertType && (
        <AlertDetailsModal
          type={selectedAlertType}
          items={selectedAlertItems}
          onClose={() => setSelectedAlertType(null)}
          onOpenCustomer={handleOpenAlertCustomer}
          onSendWhatsApp={handleAlertWhatsApp}
        />
      )}

      {/* ── Renewal Modal ── */}
      {showRenewal && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center modal-safe-area">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowRenewal(false)} />
          <div className="relative w-full max-w-md mx-4">
            <button
              onClick={() => setShowRenewal(false)}
              className="absolute -top-10 left-2 text-white/70 hover:text-white transition-colors text-xs font-bold bg-slate-800 px-3 py-1.5 rounded-lg z-10"
            >
              إغلاق [✕]
            </button>
            <AuthGate
              isExpired={true}
              initialUser={currentUser}
              onAuthenticated={() => {
                setShowRenewal(false);
                onReActivate?.();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;

