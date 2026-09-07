import { Capacitor, registerPlugin } from '@capacitor/core';

const License = registerPlugin('License');
const SECRET_SALT = 'NAYEF_FAZATK_2026_SECURITY_SALT';
const WEB_DEVICE_ID_KEY = 'fazatak_web_device_id';
const WEB_LICENSE_KEY = 'fazatak_license_data';

// Helper to hash using crypto.subtle (SHA-256) exactly matching Android / Generator logic
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

const getWebDeviceId = () => {
  let id = localStorage.getItem(WEB_DEVICE_ID_KEY);
  if (!id || id.length !== 6) {
    // Generate stable 6-digit numeric device ID
    id = String(Math.floor(100000 + Math.random() * 900000));
    localStorage.setItem(WEB_DEVICE_ID_KEY, id);
  }
  return id;
};

export const licenseService = {
  /**
   * Returns the unique device identifier
   */
  async getDeviceId() {
    if (!Capacitor.isNativePlatform()) {
      return getWebDeviceId();
    }

    try {
      const { deviceId } = await License.getDeviceId();
      return deviceId;
    } catch (err) {
      console.error('[LicenseService] Native getDeviceId failed, falling back to web ID:', err);
      return getWebDeviceId();
    }
  },

  /**
   * Attempts to activate the app with the provided code
   */
  async activateLicense(code) {
    if (!code) {
      throw new Error('ERR_MISSING_CODE');
    }

    // Standardize Arabic-Indic digits to Western digits
    const cleanCode = String(code).trim()
      .replace(/[\u0660-\u0669]/g, d => d.charCodeAt(0) - 1632)
      .replace(/[\u06F0-\u06F9]/g, d => d.charCodeAt(0) - 1776);

    if (cleanCode.length !== 9) {
      throw new Error('ERR_INVALID_FORMAT');
    }

    if (Capacitor.isNativePlatform()) {
      try {
        return await License.activateLicense({ code: cleanCode });
      } catch (err) {
        // Fall back to web algorithm if native plugin fails
        console.warn('[LicenseService] Native activateLicense failed, trying web verification:', err);
      }
    }

    // Web verification matching tools/license_web_generator.html
    const deviceId = await this.getDeviceId();
    const durations = ['30', '90', '180', '365', '9999'];
    const typeDigit = cleanCode.substring(0, 1);
    const codeHash = cleanCode.substring(1);

    let matchedDuration = null;
    for (const d of durations) {
      const expectedHash = await generateNumericHash(deviceId + d + SECRET_SALT);
      if (expectedHash === codeHash) {
        let expectedType = '0';
        if (d === '30') expectedType = '1';
        else if (d === '90') expectedType = '3';
        else if (d === '180') expectedType = '6';
        else if (d === '365') expectedType = '9';

        if (typeDigit === expectedType) {
          matchedDuration = d;
          break;
        }
      }
    }

    if (!matchedDuration) {
      throw new Error('ERR_WRONG_CODE');
    }

    const now = Math.floor(Date.now() / 1000);
    let expiry;
    if (matchedDuration === '9999') {
      expiry = 2147483647; // Lifetime
    } else {
      expiry = now + (Number(matchedDuration) * 24 * 60 * 60);
    }

    const keySource = deviceId + cleanCode + SECRET_SALT;
    const derivedKey = (await generateNumericHash(keySource)).substring(0, 8);

    const licensePayload = {
      code: cleanCode,
      expiry,
      lastSeen: now,
      key: derivedKey
    };

    localStorage.setItem(WEB_LICENSE_KEY, JSON.stringify(licensePayload));
    return { success: true, expiry, key: derivedKey };
  },

  /**
   * Checks the status of the current license
   */
  async checkLicenseStatus() {
    if (Capacitor.isNativePlatform()) {
      try {
        const status = await License.checkLicense();
        return status;
      } catch (err) {
        if (err.message && err.message.includes('ERR_EXPIRED')) {
          throw new Error('ERR_EXPIRED', { cause: err });
        }
        // Fall back to web storage if native fails
      }
    }

    // 1. First check if a user is logged in via Phone Account
    try {
      const authRaw = localStorage.getItem('fazatak_auth_user');
      if (authRaw) {
        const user = JSON.parse(authRaw);
        if (user && user.subscription_expiry) {
          const expiryMs = new Date(user.subscription_expiry).getTime();
          const isExpired = expiryMs < Date.now() || user.subscription_status === 'expired';

          if (isExpired) {
            throw new Error('ERR_EXPIRED');
          }

          return {
            isValid: true,
            expiry: Math.floor(expiryMs / 1000),
            key: 'FAZATAK_SECURE_KEY',
            user
          };
        }
      }
    } catch (err) {
      if (err.message && err.message.includes('ERR_EXPIRED')) {
        throw err;
      }
    }

    // 2. Fall back to legacy web license status check
    try {
      const stored = localStorage.getItem(WEB_LICENSE_KEY);
      if (!stored) {
        return { isValid: false, error: 'ERR_NO_LICENSE' };
      }

      const data = JSON.parse(stored);
      const now = Math.floor(Date.now() / 1000);

      if (!data.expiry || now > data.expiry) {
        throw new Error('ERR_EXPIRED');
      }

      data.lastSeen = now;
      localStorage.setItem(WEB_LICENSE_KEY, JSON.stringify(data));

      return {
        isValid: true,
        expiry: data.expiry,
        key: data.key || 'DUMMY_KEY'
      };
    } catch (err) {
      if (err.message && err.message.includes('ERR_EXPIRED')) {
        throw err;
      }
      return { isValid: false, error: err.message };
    }
  }
};

export default licenseService;
