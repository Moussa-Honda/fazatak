import { registerPlugin } from '@capacitor/core';

const License = registerPlugin('License');

export const licenseService = {
  /**
   * Returns the unique hardware fingerprint of the device
   */
  async getDeviceId() {
    try {
      const { deviceId } = await License.getDeviceId();
      return deviceId;
    } catch (err) {
      console.error('[LicenseService] getDeviceId failed:', err);
      return 'ERR: ' + (err.message || 'Unknown Error');
    }
  },

  /**
   * Attempts to activate the app with the provided code
   */
  async activateLicense(code) {
    try {
      const result = await License.activateLicense({ code });
      return result;
    } catch (err) {
      throw err;
    }
  },

  /**
   * Checks the status of the current license
   */
  async checkLicenseStatus() {
    try {
      const status = await License.checkLicense();
      return status;
    } catch (err) {
      // Return a specific error code if expired
      if (err.message && err.message.includes('ERR_EXPIRED')) {
        throw new Error('ERR_EXPIRED');
      }
      return { isValid: false, error: err.message };
    }
  }
};

export default licenseService;
