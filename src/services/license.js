import { Capacitor, registerPlugin } from '@capacitor/core';
import { authService } from './authService';

const License = registerPlugin('License');
const ACCOUNT_NUMBER_LENGTH = 8;

const normalizeAccountNumber = (value) => String(value || '')
  .trim()
  .replace(/[\u0660-\u0669]/g, (digit) => digit.charCodeAt(0) - 1632)
  .replace(/[\u06F0-\u06F9]/g, (digit) => digit.charCodeAt(0) - 1776);

const getCurrentAccountNumber = () => normalizeAccountNumber(authService.getCurrentUser()?.account_number);
const isValidAccountNumber = (value) => new RegExp(`^\\d{${ACCOUNT_NUMBER_LENGTH}}$`).test(value);

export const licenseService = {
  getAccountNumber() {
    return getCurrentAccountNumber();
  },

  async activateLicense() {
    throw new Error('ERR_SERVER_VALIDATION_REQUIRED');
  },

  async checkLicenseStatus() {
    const accountNumber = getCurrentAccountNumber();
    if (!isValidAccountNumber(accountNumber)) {
      return { isValid: false, error: 'ERR_ACCOUNT_NUMBER_REQUIRED' };
    }

    if (Capacitor.isNativePlatform()) {
      try {
        return await License.checkLicense({ accountNumber });
      } catch (error) {
        if (error.message?.includes('ERR_EXPIRED')) throw new Error('ERR_EXPIRED', { cause: error });
      }
    }

    const user = authService.getCurrentUser();
    if (user?.account_number === accountNumber && user.subscription_expiry) {
      const expiry = Math.floor(new Date(user.subscription_expiry).getTime() / 1000);
      if (expiry * 1000 < Date.now() || user.subscription_status === 'expired') {
        throw new Error('ERR_EXPIRED');
      }
      return { isValid: true, expiry, user, accountNumber };
    }

    return { isValid: false, error: 'ERR_NO_LICENSE' };
  },
};

export default licenseService;
