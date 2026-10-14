import { Capacitor } from '@capacitor/core';
import { apiRequest, getSessionToken } from './apiClient';

const SUBSCRIPTION_STORAGE_KEY = 'fazatak_web_push_subscription';
const VAPID_KEY_STORAGE_KEY = 'fazatak_web_push_vapid_key';

const isSupported = () => (
  typeof window !== 'undefined' &&
  !Capacitor.isNativePlatform() &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window
);

const readStoredSubscription = () => {
  try {
    const value = localStorage.getItem(SUBSCRIPTION_STORAGE_KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
};

const writeStoredSubscription = (subscription) => {
  try {
    localStorage.setItem(SUBSCRIPTION_STORAGE_KEY, JSON.stringify(subscription));
  } catch {
    // The subscription remains valid even if storage is unavailable.
  }
};

const clearStoredSubscription = () => {
  try {
    localStorage.removeItem(SUBSCRIPTION_STORAGE_KEY);
  } catch {}
};

const readStoredVapidKey = () => {
  try {
    return localStorage.getItem(VAPID_KEY_STORAGE_KEY) || '';
  } catch {
    return '';
  }
};

const writeStoredVapidKey = (key) => {
  try {
    localStorage.setItem(VAPID_KEY_STORAGE_KEY, key);
  } catch {}
};

const clearStoredVapidKey = () => {
  try {
    localStorage.removeItem(VAPID_KEY_STORAGE_KEY);
  } catch {}
};

const toBase64Url = (value) => {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (value) => {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const getErrorCode = (error) => error?.code || error?.message || 'unknown';

const getConfig = async () => {
  let config;
  try {
    config = await apiRequest('push/config', { token: '' });
  } catch (error) {
    error.code = error.status === 503 ? 'not_configured' : 'push_config_failed';
    throw error;
  }
  if (!config.vapidPublicKey) {
    const error = new Error('push_not_configured');
    error.code = 'not_configured';
    throw error;
  }
  return config;
};

const getRegistration = async () => navigator.serviceWorker.ready;

const getAuthHeaders = async () => {
  if (!getSessionToken()) {
    const error = new Error('not_authenticated');
    error.code = 'not_authenticated';
    throw error;
  }
  return true;
};

const serializeSubscription = (subscription) => {
  const json = subscription.toJSON();
  return {
    endpoint: json.endpoint,
    expirationTime: json.expirationTime ?? null,
    keys: {
      p256dh: json.keys?.p256dh,
      auth: json.keys?.auth,
    },
  };
};

const saveSubscription = async (subscription) => {
  const serialized = serializeSubscription(subscription);
  await getAuthHeaders();
  try {
    await apiRequest('push/subscribe', {
      method: 'POST',
      body: {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Riyadh',
      subscription: serialized,
      },
    });
  } catch {
    const error = new Error('push_registration_failed');
    error.code = 'registration_failed';
    throw error;
  }

  writeStoredSubscription(serialized);
  return serialized;
};

export const webPushService = {
  isSupported,

  async getSubscription() {
    if (!isSupported()) return null;
    const registration = await getRegistration();
    return registration.pushManager.getSubscription();
  },

  async ensureSubscription({ requestPermission = false } = {}) {
    if (!isSupported()) return { granted: false, reason: 'unsupported' };
    if (Notification.permission === 'denied') return { granted: false, reason: 'denied' };

    if (Notification.permission !== 'granted') {
      if (!requestPermission) return { granted: false, reason: 'default' };
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return { granted: false, reason: permission };
    }

    try {
      const config = await getConfig();
      const registration = await getRegistration();
      let subscription = await registration.pushManager.getSubscription();

      // Recreate subscriptions issued with an older VAPID key.
      if (subscription && readStoredVapidKey() !== config.vapidPublicKey) {
        await subscription.unsubscribe();
        clearStoredSubscription();
        subscription = null;
      }

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: fromBase64Url(config.vapidPublicKey),
        });
      }

      const serialized = await saveSubscription(subscription);
      writeStoredVapidKey(config.vapidPublicKey);
      return { granted: true, reason: 'granted', subscription: serialized };
    } catch (error) {
      console.warn('[WebPush] Subscription failed:', error);
      return { granted: false, reason: getErrorCode(error) };
    }
  },

  async unsubscribe() {
    if (!isSupported()) return false;

    try {
      const subscription = await this.getSubscription();
      const endpoint = subscription?.endpoint || readStoredSubscription()?.endpoint;
      if (endpoint) {
        await getAuthHeaders();
        await apiRequest('push/unsubscribe', {
          method: 'POST',
          body: { endpoint },
        });
      }
      if (subscription) await subscription.unsubscribe();
    } catch (error) {
      console.warn('[WebPush] Unsubscribe failed:', error);
    } finally {
      clearStoredSubscription();
      clearStoredVapidKey();
    }
    return true;
  },

  async sendTestNotification() {
    const result = await this.ensureSubscription({ requestPermission: true });
    if (!result.granted) return { sent: false, permission: result.reason };

    await getAuthHeaders();
    try {
      await apiRequest('push/test', {
        method: 'POST',
        body: { endpoint: result.subscription.endpoint },
      });
    } catch {
      return { sent: false, permission: 'send_failed' };
    }
    return { sent: true, permission: 'granted' };
  },

  toBase64Url,
  readStoredSubscription,
};
