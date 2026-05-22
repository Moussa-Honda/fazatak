import { useState, useEffect } from 'react';
import { settingsService } from '../services/database';
import { PrivacyScreen } from '@capacitor-community/privacy-screen';

const Settings = ({ isReadOnly, onRenewalRequest, onSettingsChange }) => {
  const [biometricEnabled, setBiometricEnabled] = useState(true);
  const [quickPaymentMode, setQuickPaymentMode] = useState(false);
  const [privacyMode, setPrivacyMode] = useState(false);
  const [screenPrivacy, setScreenPrivacy] = useState(true);
  const [hijriCalendar, setHijriCalendar] = useState(false);
  const [autoAppendIban, setAutoAppendIban] = useState(false);
  const [ibanNumber, setIbanNumber] = useState('');
  const [overdueThreshold, setOverdueThreshold] = useState(30);
  const [stagnancyThreshold, setStagnancyThreshold] = useState(90);
  
  const [accountType, setAccountType] = useState('individual');
  const [businessName, setBusinessName] = useState('');
  const [businessContact, setBusinessContact] = useState('');
  const [showDetailsOnPdf, setShowDetailsOnPdf] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const [
        bio, quick, privacy, screenPrivacyValue, autoIban, iban,
        accType, bizName, bizContact, showPdf
      ] = await Promise.all([
        settingsService.isBiometricEnabled(),
        settingsService.get('quick_payment_mode'),
        settingsService.get('privacy_mode'),
        settingsService.get('screen_privacy'),
        settingsService.get('auto_append_iban'),
        settingsService.get('iban_number'),
        settingsService.get('account_type'),
        settingsService.get('business_name'),
        settingsService.get('business_contact'),
        settingsService.get('show_details_on_pdf'),
        settingsService.get('overdue_threshold_days'),
        settingsService.get('stagnancy_threshold_days')
      ]);
      
      setBiometricEnabled(bio === true);
      setQuickPaymentMode(quick === 'true');
      setPrivacyMode(privacy === 'true');
      setScreenPrivacy(screenPrivacyValue !== 'false');
      setAutoAppendIban(autoIban === 'true');
      setIbanNumber(iban || '');
      setAccountType(accType || 'individual');
      setBusinessName(bizName || '');
      setBusinessContact(bizContact || '');
      setShowDetailsOnPdf(showPdf === 'true');
      
      const overThreshold = await settingsService.get('overdue_threshold_days');
      setOverdueThreshold(parseInt(overThreshold) || 30);
      
      const stagThreshold = await settingsService.get('stagnancy_threshold_days');
      setStagnancyThreshold(parseInt(stagThreshold) || 90);
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const toggleSetting = async (key, value, setter) => {
    try {
      const newValue = !value;
      await settingsService.set(key, newValue.toString());
      setter(newValue);
      onSettingsChange?.();

      if (key === 'screen_privacy') {
        if (newValue) {
          await PrivacyScreen.enable();
        } else {
          await PrivacyScreen.disable();
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const ToggleItem = ({ title, description, value, onToggle, icon }) => (
    <div className="flex items-center justify-between py-3 border-b border-slate-700 last:border-0">
      <div className="flex items-center gap-3">
        <span className="text-xl">{icon}</span>
        <div>
          <p className="text-white font-medium">{title}</p>
          <p className="text-slate-400 text-sm">{description}</p>
        </div>
      </div>
      <button
        onClick={onToggle}
        className={`w-14 h-8 rounded-full transition-colors relative ${value ? 'bg-blue-500' : 'bg-slate-600'}`}
      >
        <span className={`absolute top-1 w-6 h-6 rounded-full bg-white transition-transform ${value ? 'left-7' : 'left-1'}`} />
      </button>
    </div>
  );

  return (
    <div className="p-4 space-y-6 overflow-y-auto custom-scrollbar h-full bg-slate-900 pb-20" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}>
      {/* Privacy Section */}
      <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-sm">
        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">🛡️ الخصوصية والعرض</h3>
        <ToggleItem title="وضع الخصوصية" description="إخفاء الأرقام المالية" value={privacyMode} onToggle={() => toggleSetting('privacy_mode', privacyMode, setPrivacyMode)} icon="🔒" />
        <ToggleItem title="حماية الشاشة" description="منع لقطات الشاشة وتسجيل الفيديو" value={screenPrivacy} onToggle={() => toggleSetting('screen_privacy', screenPrivacy, setScreenPrivacy)} icon="📸" />
        <ToggleItem title="التاريخ الهجري" description="عرض التاريخ الهجري" value={hijriCalendar} onToggle={() => toggleSetting('hijri_calendar', hijriCalendar, setHijriCalendar)} icon="📅" />
      </div>

      {/* Payment Section */}
      <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-sm">
        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">💳 الدفع والإشعارات</h3>
        <ToggleItem title="نمط السداد السريع" description="الضغطة الواحدة تسدد فوراً" value={quickPaymentMode} onToggle={() => toggleSetting('quick_payment_mode', quickPaymentMode, setQuickPaymentMode)} icon="⚡" />

        <div className="pt-4 border-t border-slate-700/50 mt-4 space-y-4">
          <h4 className="text-sm font-bold text-slate-400">إعدادات قسم المتعثرين الذكي</h4>
          
          <div className="flex items-center justify-between">
            <p className="text-white text-sm">أيام تأخر السداد</p>
            <input
              type="number"
              value={overdueThreshold}
              onChange={async (e) => {
                const val = e.target.value;
                setOverdueThreshold(val);
                await settingsService.set('overdue_threshold_days', val.toString());
                onSettingsChange?.();
              }}
              className="w-20 bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-center outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          <div className="flex items-center justify-between">
            <p className="text-white text-sm">أيام الركود (Stagnancy)</p>
            <input
              type="number"
              value={stagnancyThreshold}
              onChange={async (e) => {
                const val = e.target.value;
                setStagnancyThreshold(val);
                await settingsService.set('stagnancy_threshold_days', val.toString());
                onSettingsChange?.();
              }}
              className="w-20 bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-center outline-none focus:border-blue-500 transition-colors"
            />
          </div>
        </div>
      </div>

      <div className="text-center text-slate-500 text-sm pt-4">
        <p>نظام فزتك (fazatak) v2.0 - مشفر أوفلاين</p>
      </div>
    </div>
  );
};

export default Settings;
