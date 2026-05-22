import { useEffect, useState } from 'react';
import Dashboard from './screens/Dashboard';
import LicenseGate from './components/LicenseGate';
import licenseService from './services/license';
import { settingsService } from './services/database';
import { PrivacyScreen } from '@capacitor-community/privacy-screen';
import './index.css';

function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [isLicensed, setIsLicensed] = useState(false);
  const [isExpired, setIsExpired] = useState(false);
  const [expiry, setExpiry] = useState(null);
  const [decryptionKey, setDecryptionKey] = useState(null);

  useEffect(() => {
    checkAppLicense();
    initScreenPrivacy();
  }, []);

  const initScreenPrivacy = async () => {
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
      const status = await licenseService.checkLicenseStatus();
      if (status.isValid) {
        setIsLicensed(true);
        setIsExpired(false);
        setExpiry(status.expiry);
        setDecryptionKey(status.key || 'DUMMY_KEY');
      }
    } catch (err) {
      if (err.message === 'ERR_EXPIRED') {
        setIsLicensed(true);
        setIsExpired(true);
        // We might still want to show expiry even if expired
        try {
          const status = await licenseService.checkLicenseStatus();
          setExpiry(status.expiry);
        } catch(e) {}
      } else {
        setIsLicensed(false);
      }
    } finally {
      setTimeout(() => setIsLoading(false), 800);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-900">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div>
          <p className="text-slate-400 text-xs animate-pulse">جاري التحقق من الترخيص...</p>
        </div>
      </div>
    );
  }

  if (!isLicensed) {
    return <LicenseGate onActivated={(key, exp) => {
      setDecryptionKey(key || 'DUMMY_KEY');
      setExpiry(exp);
      setIsLicensed(true);
      setIsExpired(false);
    }} />;
  }

  return <Dashboard decryptionKey={decryptionKey} isExpired={isExpired} expiry={expiry} onReActivate={checkAppLicense} />;
}

export default App;
