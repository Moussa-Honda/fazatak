import { Capacitor, registerPlugin } from '@capacitor/core';
import { authService } from './authService';

const License = registerPlugin('License');
const SECRET_SALT = 'NAYEF_FAZATK_2026_SECURITY_SALT';
const WEB_LICENSE_KEY = 'fazatak_license_data';
const ACCOUNT_NUMBER_LENGTH = 8;

const generateNumericHash = async (input) => {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    let numericCode = 0;
    for (let i = 0; i < 8; i++) {
      numericCode = (numericCode * 256 + hashArray[i]) % 100000000;
    }
    return String(numericCode).padStart(8, '0');
  } catch (err) {
    console.error('[License] Hash error:', err);
    return '00000000';
  }
};

const normalizeAccountNumber = (value) => String(value || '')
  .trim()
  .replace(/[\u0660-\u0669]/g, d => d.charCodeAt(0) - 1632)
  .replace(/[\u06F0-\u06F9]/g, d => d.charCodeAt(0) - 1776);

const getCurrentAccountNumber = () => normalizeAccountNumber(authService.getCurrentUser()?.account_number);

const isValidAccountNumber = (value) => new RegExp(`^\\d{${ACCOUNT_NUMBER_LENGTH}}$`).test(value);

const getStoredWebLicenseStatus = (accountNumber) => {
  try {
    if (typeof localStorage === 'undefined' || !accountNumber) return null;

    const stored = localStorage.getItem(WEB_LICENSE_KEY);
    if (!stored) return null;

    const data = JSON.parse(stored);
    const now = Math.floor(Date.now() / 1000);
    if (data.accountNumber !== accountNumber || !data.expiry || now > data.expiry) return null;

    data.lastSeen = now;
    localStorage.setItem(WEB_LICENSE_KEY, JSON.stringify(data));

    return {
      isValid: true,
      expiry: data.expiry,
      key: data.key || 'DUMMY_KEY',
      accountNumber
    };
  } catch {
    return null;
  }
};

export const licenseService = {
  getAccountNumber() {
    return getCurrentAccountNumber();
  },

  async activateLicense(code, accountNumber = getCurrentAccountNumber()) {
    if (!code) throw new Error('ERR_MISSING_CODE');

    const cleanAccountNumber = normalizeAccountNumber(accountNumber);
    if (!isValidAccountNumber(cleanAccountNumber)) {
      throw new Error('ERR_ACCOUNT_NUMBER_REQUIRED');
    }

    const cleanCode = String(code).trim()
      .replace(/[\u0660-\u0669]/g, d => d.charCodeAt(0) - 1632)
      .replace(/[\u06F0-\u06F9]/g, d => d.charCodeAt(0) - 1776);

    if (cleanCode.length !== 9) throw new Error('ERR_INVALID_FORMAT');

    if (Capacitor.isNativePlatform()) {
      try {
        return await License.activateLicense({
          code: cleanCode,
          accountNumber: cleanAccountNumber
        });
      } catch (err) {
        console.warn('[LicenseService] Native activateLicense failed, trying account verification:', err);
      }
    }

    const durations = ['30', '90', '180', '365', '9999'];
    const typeDigit = cleanCode.substring(0, 1);
    const codeHash = cleanCode.substring(1);
    let matchedDuration = null;

    for (const duration of durations) {
      const expectedHash = await generateNumericHash(cleanAccountNumber + duration + SECRET_SALT);
      if (expectedHash !== codeHash) continue;

      const expectedType = duration === '30'
        ? '1'
        : duration === '90'
          ? '3'
          : duration === '180'
            ? '6'
            : duration === '365'
              ? '9'
              : '0';

      if (typeDigit === expectedType) {
        matchedDuration = duration;
        break;
      }
    }

    if (!matchedDuration) throw new Error('ERR_WRONG_CODE');

    const now = Math.floor(Date.now() / 1000);
    let currentExpiry = 0;
    try {
      const stored = JSON.parse(localStorage.getItem(WEB_LICENSE_KEY) || 'null');
      if (stored?.accountNumber === cleanAccountNumber) currentExpiry = Number(stored.expiry) || 0;
    } catch {
      currentExpiry = 0;
    }

    const baseTime = Math.max(now, currentExpiry);
    const expiry = matchedDuration === '9999'
      ? 2147483647
      : baseTime + (Number(matchedDuration) * 24 * 60 * 60);
    const keySource = cleanAccountNumber + cleanCode + SECRET_SALT;
    const derivedKey = (await generateNumericHash(keySource)).substring(0, 8);

    localStorage.setItem(WEB_LICENSE_KEY, JSON.stringify({
      code: cleanCode,
      accountNumber: cleanAccountNumber,
      expiry,
      lastSeen: now,
      key: derivedKey
    }));

    return {
      success: true,
      expiry,
      key: derivedKey,
      durationDays: Number(matchedDuration),
      accountNumber: cleanAccountNumber
    };
  },

  async checkLicenseStatus() {
    const accountNumber = getCurrentAccountNumber();
    if (!isValidAccountNumber(accountNumber)) {
      return { isValid: false, error: 'ERR_ACCOUNT_NUMBER_REQUIRED' };
    }

    if (Capacitor.isNativePlatform()) {
      try {
        return await License.checkLicense({ accountNumber });
      } catch (err) {
        if (err.message && err.message.includes('ERR_EXPIRED')) {
          throw new Error('ERR_EXPIRED', { cause: err });
        }
      }
    }

    const localLicense = getStoredWebLicenseStatus(accountNumber);
    if (localLicense) return localLicense;

    try {
      const user = authService.getCurrentUser();
      if (user?.account_number === accountNumber && user.subscription_expiry) {
        const expiryMs = new Date(user.subscription_expiry).getTime();
        const isExpired = expiryMs < Date.now() || user.subscription_status === 'expired';
        if (isExpired) throw new Error('ERR_EXPIRED');

        return {
          isValid: true,
          expiry: Math.floor(expiryMs / 1000),
          key: 'FAZATAK_SECURE_KEY',
          user,
          accountNumber
        };
      }
    } catch (err) {
      if (err.message && err.message.includes('ERR_EXPIRED')) throw err;
    }

    return { isValid: false, error: 'ERR_NO_LICENSE' };
  }
};

export default licenseService;
