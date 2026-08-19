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
    return License.activateLicense({ code });
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
        throw new Error('ERR_EXPIRED', { cause: err });
      }
      return { isValid: false, error: err.message };
    }
  }
};

export default licenseService;
