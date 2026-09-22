import { Capacitor, registerPlugin } from '@capacitor/core';

const Billing = registerPlugin('Billing');
export const GOOGLE_PLAY_PRODUCT_ID = 'aqsaati_yearly';

const billingService = {
  isAvailable() {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  },

  async getStatus() {
    if (!this.isAvailable()) return { active: false, unavailable: true };
    return Billing.getStatus({ productId: GOOGLE_PLAY_PRODUCT_ID });
  },

  async purchase() {
    if (!this.isAvailable()) {
      throw new Error('الاشتراك عبر Google Play متاح من تطبيق Android فقط.');
    }
    return Billing.purchase({ productId: GOOGLE_PLAY_PRODUCT_ID });
  }
};

export default billingService;
