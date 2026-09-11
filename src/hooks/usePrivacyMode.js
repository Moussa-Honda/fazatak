import { useEffect, useState } from 'react';
import { settingsService } from '../services/database';
import { DATA_CHANGED_EVENT } from '../services/dataEvents';

export const formatPrivateAmount = (value, privacyMode, suffix = '') => {
  if (privacyMode) return '***';

  const amount = Math.round(Number(value) || 0).toLocaleString('en-US');
  return suffix ? `${amount} ${suffix}` : amount;
};

export const usePrivacyMode = () => {
  const [privacyMode, setPrivacyMode] = useState(false);

  useEffect(() => {
    let active = true;

    const loadPrivacyMode = async () => {
      try {
        const value = await settingsService.get('privacy_mode');
        if (active) setPrivacyMode(value === 'true');
      } catch (error) {
        console.warn('Privacy mode load error:', error);
      }
    };

    const handleDataChange = (event) => {
      const detail = event.detail || {};
      if (detail.scope === 'settings' && detail.key !== 'privacy_mode') return;
      if (detail.scope !== 'settings' && detail.scope !== 'all') return;
      loadPrivacyMode();
    };

    loadPrivacyMode();
    window.addEventListener(DATA_CHANGED_EVENT, handleDataChange);

    return () => {
      active = false;
      window.removeEventListener(DATA_CHANGED_EVENT, handleDataChange);
    };
  }, []);

  return privacyMode;
};
