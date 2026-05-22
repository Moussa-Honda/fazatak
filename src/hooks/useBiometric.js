import { useState, useEffect } from 'react';
import { settingsService } from '../services/database';

// Biometric auth - will be loaded dynamically
let BiometricAuth = null;

try {
  BiometricAuth = require('@aparajita/capacitor-biometric-auth').BiometricAuth;
} catch (e) {
  console.log('Biometric auth not available');
}

export const useBiometric = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [isAvailable, setIsAvailable] = useState(false);

  useEffect(() => {
    checkAvailability();
  }, []);

  const checkAvailability = async () => {
    try {
      if (!BiometricAuth) {
        setIsAuthenticated(true);
        setIsChecking(false);
        return;
      }

      const result = await BiometricAuth.checkBiometry();
      setIsAvailable(result.isAvailable);
      
      const enabled = await settingsService.isBiometricEnabled();
      if (!enabled || !result.isAvailable) {
        setIsAuthenticated(true);
      }
    } catch (error) {
      console.error('Biometric check error:', error);
      setIsAuthenticated(true);
    } finally {
      setIsChecking(false);
    }
  };

  const authenticate = async () => {
    try {
      const enabled = await settingsService.isBiometricEnabled();
      if (!enabled || !BiometricAuth) {
        setIsAuthenticated(true);
        return true;
      }

      const result = await BiometricAuth.authenticate({
        reason: 'يرجى المصادقة لفتح التطبيق',
        cancelTitle: 'إلغاء',
        allowDeviceCredential: true,
        iosBiometryType: 'both'
      });

      if (result.success) {
        setIsAuthenticated(true);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Authentication error:', error);
      return false;
    }
  };

  const lock = () => {
    setIsAuthenticated(false);
  };

  return {
    isAuthenticated,
    isChecking,
    isAvailable,
    authenticate,
    lock
  };
};
