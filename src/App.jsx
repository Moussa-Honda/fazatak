import { useEffect, useState } from 'react';
import Dashboard from './screens/Dashboard';
import AuthGate from './components/AuthGate';
import WelcomeOnboarding, { useOnboarding } from './components/WelcomeOnboarding';
import { authService } from './services/authService';
import { cloudSyncService } from './services/cloudSyncService';
import licenseService from './services/license';
import { settingsService } from './services/database';
import { notificationService } from './services/notificationService';
import { Capacitor } from '@capacitor/core';
import { PrivacyScreen } from '@capacitor-community/privacy-screen';
import './index.css';

function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [isLicensed, setIsLicensed] = useState(false);
  const [isExpired, setIsExpired] = useState(false);
  const [expiry, setExpiry] = useState(null);
  const [decryptionKey, setDecryptionKey] = useState('FAZATAK_SECURE_KEY');
  const { showOnboarding, completeOnboarding } = useOnboarding();

  useEffect(() => {
    checkAppLicense();
    initScreenPrivacy();
    cloudSyncService.initAutoSyncListener();
  }, []);

  useEffect(() => {
    if (!isLicensed) return;

    notificationService.refreshSchedule().catch((error) => {
      console.error('Notification schedule init error:', error);
    });

    // فحص واسترجاع ذكي فوري عند فتح التطبيق بحساب العميل
    if (currentUser?.phone) {
      cloudSyncService.checkAndAutoRestoreOnLogin(currentUser.phone).catch((err) => {
        console.warn('Startup auto-restore/sync note:', err);
      });
    }
  }, [isLicensed, currentUser]);

  const initScreenPrivacy = async () => {
    if (!Capacitor.isNativePlatform()) return;

    try {
      const isEnabled = await settingsService.get('screen_privacy');
      if (isEnabled === 'false') {
        await PrivacyScreen.disable();
      } else {
        await PrivacyScreen.enable();
      }
    } catch (e) {
      console.error('PrivacyScreen init error:', e);
    }
  };

  const checkAppLicense = async () => {
    try {
      // 1. التحقق أولاً من جلسة العميل المربوطة برقم الهاتف
      const user = authService.getCurrentUser();

      if (user && user.phone) {
        setCurrentUser(user);
        const expiryMs = new Date(user.subscription_expiry).getTime();
        const hasExpired = expiryMs < Date.now() || user.subscription_status === 'expired';

        if (hasExpired) {
          setIsLicensed(false);
          setIsExpired(true);
          setExpiry(Math.floor(expiryMs / 1000));
        } else {
          setIsLicensed(true);
          setIsExpired(false);
          setExpiry(Math.floor(expiryMs / 1000));
          setDecryptionKey('FAZATAK_SECURE_KEY');
        }

        // تحديث صلاحية الاشتراك في الخلفية إن وجد إنترنت
        authService.refreshSubscription().then((updated) => {
          if (updated && updated.subscription_expiry) {
            setCurrentUser(updated);
            const updatedExpMs = new Date(updated.subscription_expiry).getTime();
            setExpiry(Math.floor(updatedExpMs / 1000));
            if (updatedExpMs < Date.now() || updated.subscription_status === 'expired') {
              setIsLicensed(false);
              setIsExpired(true);
            }
          }
        }).catch(() => {});

        return;
      }

      // 2. إذا لم يكن مسجلاً برقم الهاتف، يجب تسجيل الدخول أو إنشاء حساب
      setIsLicensed(false);
      setIsExpired(false);
      setCurrentUser(null);
    } catch (err) {
      if (err.message === 'ERR_EXPIRED') {
        setIsLicensed(false);
        setIsExpired(true);
      } else {
        setIsLicensed(false);
      }
    } finally {
      setTimeout(() => setIsLoading(false), 600);
    }
  };

  const handleAuthenticated = async (user) => {
    setCurrentUser(user);
    const expiryMs = new Date(user.subscription_expiry).getTime();
    setExpiry(Math.floor(expiryMs / 1000));
    setIsLicensed(true);
    setIsExpired(false);
    setDecryptionKey('FAZATAK_SECURE_KEY');

    // تشغيل فحص المزامنة التلقائية
    try {
      await cloudSyncService.checkAndAutoRestoreOnLogin(user.phone);
    } catch (e) {
      console.warn('Auto restore post-auth warning:', e);
    }
  };

  const handleLogout = () => {
    authService.logout();
    setCurrentUser(null);
    setIsLicensed(false);
    setIsExpired(false);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-900">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div>
          <p className="text-slate-400 text-xs animate-pulse">جاري التحقق من الحساب والترخيص...</p>
        </div>
      </div>
    );
  }

  // Show welcome onboarding for brand new users (before auth gate)
  if (showOnboarding) {
    return <WelcomeOnboarding onComplete={completeOnboarding} />;
  }

  if (!isLicensed) {
    return (
      <AuthGate
        isExpired={isExpired}
        initialUser={currentUser}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  return (
    <Dashboard
      currentUser={currentUser}
      decryptionKey={decryptionKey}
      isExpired={isExpired}
      expiry={expiry}
      onReActivate={checkAppLicense}
      onLogout={handleLogout}
    />
  );
}

export default App;
