import { useState, useEffect } from 'react';
import { settingsService } from '../services/database';
import { notificationService } from '../services/notificationService';
import licenseService from '../services/license';
import { PrivacyScreen } from '@capacitor-community/privacy-screen';
import { Clipboard } from '@capacitor/clipboard';
import BackupRestore from './BackupRestore';
import { useLiveRefresh } from '../hooks/useLiveRefresh';

const SUPPORT_PHONE_DISPLAY = '+966556854162';
const SUPPORT_WHATSAPP_PHONE = '966556854162';

const ToggleItem = ({ title, description, value, onToggle, icon }) => (
  <div className="flex items-center justify-between py-3 border-b border-slate-700 last:border-0 gap-4">
    <div className="flex items-center gap-3">
      <span className="text-xl">{icon}</span>
      <div>
        <p className="text-white font-medium">{title}</p>
        <p className="text-slate-400 text-sm">{description}</p>
      </div>
    </div>
    <button
      type="button"
      onClick={onToggle}
      className={`w-14 h-8 rounded-full transition-colors relative shrink-0 ${value ? 'bg-blue-500' : 'bg-slate-600'}`}
    >
      <span className={`absolute top-1 w-6 h-6 rounded-full bg-white transition-transform ${value ? 'left-7' : 'left-1'}`} />
    </button>
  </div>
);

const Settings = ({ onSettingsChange, onLicenseRenewed }) => {
  const [quickPaymentMode, setQuickPaymentMode] = useState(false);
  const [privacyMode, setPrivacyMode] = useState(false);
  const [screenPrivacy, setScreenPrivacy] = useState(true);
  const [hijriCalendar, setHijriCalendar] = useState(false);
  const [overdueThreshold, setOverdueThreshold] = useState(30);
  const [stagnancyThreshold, setStagnancyThreshold] = useState(90);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [notificationDaysBefore, setNotificationDaysBefore] = useState(1);
  const [notificationTime, setNotificationTime] = useState('09:00');
  const [overdueNotificationsEnabled, setOverdueNotificationsEnabled] = useState(true);
  const [notificationStatus, setNotificationStatus] = useState('');
  const [whatsappTemplate, setWhatsappTemplate] = useState('');

  const [businessName, setBusinessName] = useState('');
  const [businessContact, setBusinessContact] = useState('');
  const [taxNumber, setTaxNumber] = useState('');
  const [showDetailsOnPdf, setShowDetailsOnPdf] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const [licenseExpiry, setLicenseExpiry] = useState(null);
  const [renewalCode, setRenewalCode] = useState('');
  const [renewalLoading, setRenewalLoading] = useState(false);
  const [renewalMessage, setRenewalMessage] = useState('');
  const [deviceCopied, setDeviceCopied] = useState(false);

  // حالة نافذة النسخ الاحتياطي
  const [showBackup, setShowBackup] = useState(false);

  async function loadSettings() {
    try {
      const [
        quick, privacy, screenPrivacyValue,
        bizName, bizContact, taxNo, showPdf, overThreshold, stagThreshold,
        notifEnabled, notifDays, notifTime, notifOverdue, whatsappText
      ] = await Promise.all([
        settingsService.get('quick_payment_mode'),
        settingsService.get('privacy_mode'),
        settingsService.get('screen_privacy'),
        settingsService.get('business_name'),
        settingsService.get('business_contact'),
        settingsService.get('tax_number'),
        settingsService.get('show_details_on_pdf'),
        settingsService.get('overdue_threshold_days'),
        settingsService.get('stagnancy_threshold_days'),
        settingsService.get('installment_notifications_enabled'),
        settingsService.get('installment_notification_days_before'),
        settingsService.get('installment_notification_time'),
        settingsService.get('installment_overdue_notifications_enabled'),
        settingsService.getWhatsAppTemplate()
      ]);
      
      setQuickPaymentMode(quick === 'true');
      setPrivacyMode(privacy === 'true');
      setScreenPrivacy(screenPrivacyValue !== 'false');
      setBusinessName(bizName || '');
      setBusinessContact(bizContact || '');
      setTaxNumber(taxNo || '');
      setShowDetailsOnPdf(showPdf === 'true');
      setOverdueThreshold(parseInt(overThreshold) || 30);
      setStagnancyThreshold(parseInt(stagThreshold) || 90);
      setNotificationsEnabled(notifEnabled === 'true');
      setNotificationDaysBefore(parseInt(notifDays) || 1);
      setNotificationTime(notifTime || '09:00');
      setOverdueNotificationsEnabled(notifOverdue !== 'false');
      setWhatsappTemplate(whatsappText || '');
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  useLiveRefresh(loadSettings);

  async function loadLicenseInfo() {
    try {
      const id = await licenseService.getDeviceId();
      setDeviceId(id);
    } catch (error) {
      console.error('Device ID error:', error);
    }

    try {
      const status = await licenseService.checkLicenseStatus();
      setLicenseExpiry(status?.expiry || null);
    } catch {
      setLicenseExpiry(null);
    }
  }

  useEffect(() => {
    loadSettings();
    loadLicenseInfo();
  }, []);

  const formatLicenseExpiry = (expiry) => {
    if (!expiry) return 'غير متاح';
    if (expiry > 2100000000) return 'تفعيل دائم';
    const date = new Date(expiry * 1000);
    return date.toLocaleDateString('ar-SA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const copyDeviceId = async () => {
    if (!deviceId) return;
    await Clipboard.write({ string: deviceId });
    setDeviceCopied(true);
    setTimeout(() => setDeviceCopied(false), 2000);
  };

  const handleSupportWhatsApp = () => {
    const message = `السلام عليكم، أريد تجديد اشتراك تطبيق فزتك. رقم الجهاز: ${deviceId || ''}`;
    window.open(`https://wa.me/${SUPPORT_WHATSAPP_PHONE}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const handleRenewLicense = async (e) => {
    e.preventDefault();
    if (!renewalCode.trim()) return;

    setRenewalLoading(true);
    setRenewalMessage('');

    try {
      const result = await licenseService.activateLicense(renewalCode.trim());
      if (result.success) {
        setLicenseExpiry(result.expiry);
        setRenewalCode('');
        setRenewalMessage(`تم تجديد الاشتراك بنجاح. تاريخ الانتهاء الجديد: ${formatLicenseExpiry(result.expiry)}`);
        onLicenseRenewed?.(result.key, result.expiry);
      }
    } catch (error) {
      const errCode = error.message || '';
      let msg = 'تعذر تجديد الاشتراك. تأكد من الكود وحاول مرة أخرى.';
      if (errCode.includes('ERR_WRONG_CODE')) msg = 'هذا الكود غير صالح لهذا الجهاز.';
      else if (errCode.includes('ERR_INVALID_FORMAT')) msg = 'تنسيق الكود غير صحيح. يجب أن يكون 9 أرقام.';
      else if (errCode.includes('ERR_TIME_TAMPERED')) msg = 'تم اكتشاف تلاعب في وقت الجهاز.';
      setRenewalMessage(msg);
    } finally {
      setRenewalLoading(false);
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

  const handleNotificationToggle = async () => {
    try {
      setNotificationStatus('جاري تحديث التنبيهات...');
      const result = await notificationService.setEnabled(!notificationsEnabled);
      setNotificationsEnabled(result.enabled);

      if (!result.enabled && notificationsEnabled) {
        setNotificationStatus('تم إيقاف تنبيهات الأقساط');
      } else if (!result.enabled) {
        setNotificationStatus('لم يتم منح صلاحية الإشعارات من النظام');
      } else {
        setNotificationStatus(`تم تفعيل التنبيهات وجدولة ${result.scheduled || 0} إشعار`);
      }

      onSettingsChange?.();
    } catch (error) {
      console.error('Notification toggle error:', error);
      setNotificationStatus('تعذر تحديث التنبيهات');
    }
  };

  const updateNotificationSetting = async (key, value, setter) => {
    try {
      setter(value);
      setNotificationStatus('جاري تحديث جدول التنبيهات...');
      const result = await notificationService.updateSetting(key, value);
      setNotificationStatus(notificationsEnabled ? `تم تحديث الجدولة: ${result.scheduled || 0} إشعار` : '');
      onSettingsChange?.();
    } catch (error) {
      console.error('Notification setting error:', error);
      setNotificationStatus('تعذر تحديث إعدادات التنبيهات');
    }
  };

  const handleTestNotification = async () => {
    try {
      setNotificationStatus('سيظهر إشعار اختباري بعد ثوانٍ');
      const result = await notificationService.sendTestNotification();
      if (!result.sent) {
        setNotificationStatus('لم يتم منح صلاحية الإشعارات من النظام');
      }
    } catch (error) {
      console.error('Test notification error:', error);
      setNotificationStatus('تعذر إرسال إشعار اختباري');
    }
  };

  const updateBusinessSetting = async (key, value, setter) => {
    setter(value);
    await settingsService.set(key, value);
    onSettingsChange?.();
  };

  const updateWhatsappTemplate = async (value) => {
    setWhatsappTemplate(value);
    await settingsService.set('whatsapp_template', value);
    onSettingsChange?.();
  };

  return (
    <div className="p-4 space-y-6 overflow-y-auto custom-scrollbar h-full bg-slate-900 pb-20" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}>
      {/* License Section */}
      <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-sm">
        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">الاشتراك والجهاز</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-2">رقم الجهاز</label>
            <div className="flex gap-2">
              <div className="flex-1 bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-emerald-400 font-mono text-center tracking-wider">
                {deviceId || 'جاري التحميل...'}
              </div>
              <button
                type="button"
                onClick={copyDeviceId}
                className={`px-4 rounded-xl font-bold transition-colors ${deviceCopied ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'}`}
              >
                {deviceCopied ? 'تم' : 'نسخ'}
              </button>
            </div>
          </div>

          <div className="bg-slate-900/70 border border-slate-700 rounded-xl p-4 flex items-center justify-between gap-3">
            <span className="text-slate-400 text-sm">انتهاء الاشتراك الحالي</span>
            <span className="text-white font-bold text-sm">{formatLicenseExpiry(licenseExpiry)}</span>
          </div>

          <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-xl p-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-white text-sm font-bold">تواصل معنا للتجديد</p>
              <p className="text-emerald-300 text-sm font-mono mt-1" dir="ltr">{SUPPORT_PHONE_DISPLAY}</p>
            </div>
            <button
              type="button"
              onClick={handleSupportWhatsApp}
              className="h-10 px-4 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-500 transition-colors active:scale-95"
            >
              واتساب
            </button>
          </div>

          <form onSubmit={handleRenewLicense} className="space-y-3">
            <label className="block text-sm text-slate-400">كود تجديد الاشتراك</label>
            <input
              type="tel"
              value={renewalCode}
              onChange={(e) => setRenewalCode(e.target.value.replace(/[^0-9٠-٩]/g, ''))}
              maxLength={9}
              className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white text-center font-bold tracking-[0.35em] placeholder-slate-500 focus:border-emerald-500 focus:outline-none transition-colors"
              placeholder="912345678"
              dir="ltr"
            />
            <button
              type="submit"
              disabled={renewalLoading || !renewalCode.trim()}
              className="w-full bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-500 transition-colors disabled:opacity-50"
            >
              {renewalLoading ? 'جاري التجديد...' : 'تفعيل / تجديد الاشتراك'}
            </button>
          </form>

          {renewalMessage && (
            <p className="text-xs text-slate-300 leading-5 bg-slate-900/70 border border-slate-700 rounded-xl p-3">
              {renewalMessage}
            </p>
          )}
        </div>
      </div>

      {/* Privacy Section */}
      <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-sm">
        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">🛡️ الخصوصية والعرض</h3>
        <ToggleItem title="وضع الخصوصية" description="إخفاء الأرقام المالية" value={privacyMode} onToggle={() => toggleSetting('privacy_mode', privacyMode, setPrivacyMode)} icon="🔒" />
        <ToggleItem title="حماية الشاشة" description="منع لقطات الشاشة وتسجيل الفيديو" value={screenPrivacy} onToggle={() => toggleSetting('screen_privacy', screenPrivacy, setScreenPrivacy)} icon="📸" />
        <ToggleItem title="التاريخ الهجري" description="عرض التاريخ الهجري" value={hijriCalendar} onToggle={() => toggleSetting('hijri_calendar', hijriCalendar, setHijriCalendar)} icon="📅" />
      </div>

      {/* Business Details Section */}
      <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-sm">
        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">بيانات المؤسسة / المستخدم</h3>
        <ToggleItem
          title="إظهار البيانات في الفواتير والكشوفات"
          description="عرض الاسم والجوال والرقم الضريبي في رأس PDF"
          value={showDetailsOnPdf}
          onToggle={() => toggleSetting('show_details_on_pdf', showDetailsOnPdf, setShowDetailsOnPdf)}
          icon="🏷️"
        />

        <div className="pt-4 border-t border-slate-700/50 mt-4 space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-2">اسم المؤسسة أو الشخص</label>
            <input
              type="text"
              value={businessName}
              onChange={(e) => updateBusinessSetting('business_name', e.target.value, setBusinessName)}
              className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none transition-colors"
              placeholder="مثال: مؤسسة فزتك للتقسيط"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-2">رقم الجوال</label>
            <input
              type="tel"
              value={businessContact}
              onChange={(e) => updateBusinessSetting('business_contact', e.target.value, setBusinessContact)}
              className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none transition-colors"
              placeholder="مثال: 05xxxxxxxx"
              dir="ltr"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-2">الرقم الضريبي</label>
            <input
              type="text"
              value={taxNumber}
              onChange={(e) => updateBusinessSetting('tax_number', e.target.value, setTaxNumber)}
              className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none transition-colors"
              placeholder="مثال: 300000000000003"
              dir="ltr"
            />
          </div>
        </div>
      </div>

      {/* Payment Section */}
      <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-sm">
        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">💳 الدفع والإشعارات</h3>
        <ToggleItem title="نمط السداد السريع" description="الضغطة الواحدة تسدد فوراً" value={quickPaymentMode} onToggle={() => toggleSetting('quick_payment_mode', quickPaymentMode, setQuickPaymentMode)} icon="⚡" />

        <div className="pt-4 border-t border-slate-700/50 mt-4 space-y-4">
          <h4 className="text-sm font-bold text-slate-400">رسالة واتساب للأقساط</h4>
          <textarea
            value={whatsappTemplate}
            onChange={(e) => updateWhatsappTemplate(e.target.value)}
            rows={5}
            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none transition-colors resize-none leading-6"
            placeholder="اكتب رسالة واتساب الافتراضية"
          />
          <p className="text-xs text-slate-500 leading-5">
            المتغيرات المتاحة: [الاسم] [المبلغ] [التاريخ] [العقد]
          </p>
        </div>

        <div className="pt-4 border-t border-slate-700/50 mt-4 space-y-4">
          <h4 className="text-sm font-bold text-slate-400">تنبيهات الأقساط خارج التطبيق</h4>
          <ToggleItem
            title="تنبيهات الجهاز"
            description="إظهار تنبيه حتى لو كان التطبيق مغلقاً"
            value={notificationsEnabled}
            onToggle={handleNotificationToggle}
            icon="🔔"
          />

          {notificationsEnabled && (
            <div className="space-y-4 bg-slate-900/50 rounded-xl p-4 border border-slate-700/60">
              <div className="flex items-center justify-between gap-3">
                <p className="text-white text-sm">التنبيه قبل الاستحقاق</p>
                <input
                  type="number"
                  min="0"
                  max="30"
                  value={notificationDaysBefore}
                  onChange={(e) => {
                    const val = Math.max(0, parseInt(e.target.value, 10) || 0);
                    updateNotificationSetting('installment_notification_days_before', val, setNotificationDaysBefore);
                  }}
                  className="w-20 bg-slate-950 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-center outline-none focus:border-blue-500 transition-colors"
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <p className="text-white text-sm">وقت التنبيه اليومي</p>
                <input
                  type="time"
                  value={notificationTime}
                  onChange={(e) => updateNotificationSetting('installment_notification_time', e.target.value || '09:00', setNotificationTime)}
                  className="w-32 bg-slate-950 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-center outline-none focus:border-blue-500 transition-colors"
                />
              </div>

              <ToggleItem
                title="تنبيهات المتأخرات الحديثة"
                description="لا تشمل العملاء الظاهرين في قسم المتعثرين"
                value={overdueNotificationsEnabled}
                onToggle={() => updateNotificationSetting(
                  'installment_overdue_notifications_enabled',
                  !overdueNotificationsEnabled,
                  setOverdueNotificationsEnabled
                )}
                icon="⏰"
              />

              <button
                type="button"
                onClick={handleTestNotification}
                className="w-full bg-blue-600/20 border border-blue-500/40 text-blue-300 py-2.5 rounded-xl font-bold text-sm hover:bg-blue-600/30 transition-colors"
              >
                إرسال إشعار اختباري
              </button>
            </div>
          )}

          {notificationStatus && (
            <p className="text-xs text-slate-400 leading-5 bg-slate-900/70 border border-slate-700 rounded-xl p-3">
              {notificationStatus}
            </p>
          )}
        </div>

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
                notificationService.refreshSchedule().catch(error => console.error('Notification refresh error:', error));
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

      {/* Backup Section */}
      <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-sm">
        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">النسخ الاحتياطي</h3>
        <p className="text-slate-400 text-sm mb-4">احفظ نسخة أوفلاين على الجهاز وشارك نفس الملف عبر واتساب أو Google Drive</p>
        <button
          onClick={() => setShowBackup(true)}
          className="w-full bg-emerald-500 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-emerald-600 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
          </svg>
          فتح النسخ الاحتياطي
        </button>
      </div>

      {/* نافذة النسخ الاحتياطي */}
      <BackupRestore
        isOpen={showBackup}
        onClose={() => setShowBackup(false)}
      />

      <div className="text-center text-slate-500 text-sm pt-4">
        <p>نظام فزتك (fazatak) v2.0 - مشفر أوفلاين</p>
      </div>
    </div>
  );
};

export default Settings;
