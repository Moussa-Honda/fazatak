import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { getDatabase, settingsService } from './database';
import { webPushService } from './webPushService';

const CHANNEL_ID = 'installment-reminders';
const NOTIFICATION_ID_BASE = 1100000000;
const NOTIFICATION_ID_LIMIT = 1200000000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const DEFAULTS = {
  enabled: false,
  daysBefore: 1,
  time: '09:00',
  overdueEnabled: true,
};

const toInt = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toMoney = (amount) => Math.round(Number(amount || 0)).toLocaleString('en-US');

const formatLocalDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseLocalDate = (value) => {
  const [year, month, day] = String(value || '').split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
};

const startOfToday = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
};

const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const parseNotificationTime = (time) => {
  const [rawHour, rawMinute] = String(time || DEFAULTS.time).split(':');
  const hour = Math.min(23, Math.max(0, toInt(rawHour, 9)));
  const minute = Math.min(59, Math.max(0, toInt(rawMinute, 0)));
  return { hour, minute };
};

const dateAtTime = (date, time, staggerMinutes = 0) => {
  const { hour, minute } = parseNotificationTime(time);
  const at = new Date(date);
  at.setHours(hour, minute + staggerMinutes, 0, 0);
  return at;
};

const nextDailyTime = (time, staggerMinutes = 0) => {
  const at = dateAtTime(new Date(), time, staggerMinutes);
  if (at <= new Date()) {
    at.setDate(at.getDate() + 1);
  }
  return at;
};

const ensureFutureTime = (date, staggerMinutes = 0) => {
  const now = new Date();
  if (date > now) return date;
  return new Date(now.getTime() + (1 + staggerMinutes) * 60 * 1000);
};

const notificationId = (installmentId, kind, occurrence = 0) => {
  const numericId = Math.abs(toInt(installmentId, 0)) % 1000000;
  return NOTIFICATION_ID_BASE + (numericId * 100) + (kind * 10) + occurrence;
};

const isOurNotification = (notification) => {
  const id = Number(notification?.id);
  return id >= NOTIFICATION_ID_BASE && id < NOTIFICATION_ID_LIMIT;
};

const getSettings = async () => {
  const [enabled, daysBefore, time, overdueEnabled] = await Promise.all([
    settingsService.get('installment_notifications_enabled'),
    settingsService.get('installment_notification_days_before'),
    settingsService.get('installment_notification_time'),
    settingsService.get('installment_overdue_notifications_enabled'),
  ]);

  return {
    enabled: enabled === 'true',
    daysBefore: Math.max(0, toInt(daysBefore, DEFAULTS.daysBefore)),
    time: time || DEFAULTS.time,
    overdueEnabled: overdueEnabled !== 'false',
  };
};

const ensurePermission = async (requestPermission = false) => {
  if (!Capacitor.isNativePlatform()) {
    return webPushService.ensureSubscription({ requestPermission });
  }

  let status = await LocalNotifications.checkPermissions();
  if (status.display !== 'granted' && requestPermission) {
    status = await LocalNotifications.requestPermissions();
  }

  return {
    granted: status.display === 'granted',
    reason: status.display,
  };
};

const ensureChannel = async () => {
  // Notification channels are an Android-only API. The iOS implementation
  // deliberately returns "unimplemented", which would otherwise stop the
  // complete scheduling flow before any iPhone notification is created.
  if (Capacitor.getPlatform() !== 'android') return;

  await LocalNotifications.createChannel({
    id: CHANNEL_ID,
    name: 'تنبيهات الأقساط',
    description: 'تنبيهات مواعيد الأقساط المستحقة والقريبة والمتأخرة',
    importance: 4,
    visibility: 1,
    lights: true,
    lightColor: '#10b981',
    vibration: true,
  });
};

const cancelInstallmentNotifications = async ({ removeWebSubscription = false } = {}) => {
  if (!Capacitor.isNativePlatform()) {
    if (removeWebSubscription) await webPushService.unsubscribe();
    return 0;
  }

  const pending = await LocalNotifications.getPending();
  const ours = (pending.notifications || []).filter(isOurNotification);
  if (ours.length > 0) {
    await LocalNotifications.cancel({
      notifications: ours.map(({ id }) => ({ id })),
    });
  }
  return ours.length;
};

const getNotifiableInstallments = async ({ daysBefore, overdueEnabled }) => {
  const database = await getDatabase();
  const today = startOfToday();
  const horizon = addDays(today, Math.max(daysBefore, 1));
  const overdueThreshold = Math.max(0, toInt(await settingsService.get('overdue_threshold_days'), 30));
  const debtorCutoff = formatLocalDate(addDays(today, -overdueThreshold));
  const todayText = formatLocalDate(today);
  const horizonText = formatLocalDate(horizon);

  const sql = `
    SELECT
      i.*,
      c.title as contract_title,
      cu.id as customer_id,
      cu.name as customer_name,
      cu.phone as customer_phone,
      m.name as manager_name
    FROM installments i
    JOIN contracts c ON i.contract_id = c.id
    JOIN customers cu ON c.customer_id = cu.id
    LEFT JOIN managers m ON cu.manager_id = m.id
    WHERE i.status = 'pending'
      AND c.status = 'active'
      AND (cu.status IS NULL OR cu.status = 'active')
      AND (cu.is_deleted IS NULL OR cu.is_deleted = 0)
      AND (cu.manager_id IS NULL OR cu.manager_id = 0 OR cu.manager_id = '')
      AND (cu.deleted_manager_id IS NULL OR cu.deleted_manager_id = 0)
      AND (m.id IS NULL OR m.is_deleted IS NULL OR m.is_deleted = 0)
      AND (cu.is_manually_flagged_as_overdue IS NULL OR cu.is_manually_flagged_as_overdue = 0)
      AND NOT EXISTS (
        SELECT 1
        FROM installments oi
        JOIN contracts oc ON oi.contract_id = oc.id
        WHERE oc.customer_id = cu.id
          AND oc.status = 'active'
          AND oi.status = 'pending'
          AND oi.due_date < ?
      )
      AND i.due_date <= ?
      AND (? = 1 OR i.due_date >= ?)
    ORDER BY i.due_date ASC, i.id ASC
  `;

  const result = await database.query(sql, [
    debtorCutoff,
    horizonText,
    overdueEnabled ? 1 : 0,
    todayText,
  ]);

  return result.values || [];
};

const buildBody = (installment, state, daysUntil) => {
  const remaining = Math.max(0, Number(installment.amount || 0) - Number(installment.actual_paid || 0));
  const amount = toMoney(remaining || installment.amount);
  const owner = installment.manager_name ? ` - ${installment.manager_name}` : '';
  const customer = `${installment.customer_name || 'عميل'}${owner}`;

  if (state === 'upcoming') {
    return `باقي ${daysUntil} يوم على قسط ${customer} بقيمة ${amount} ريال`;
  }

  if (state === 'overdue') {
    const daysLate = Math.abs(daysUntil);
    return `قسط متأخر منذ ${daysLate} يوم: ${customer} - ${amount} ريال`;
  }

  return `قسط مستحق اليوم: ${customer} - ${amount} ريال`;
};

const buildNotifications = (installments, settings) => {
  const today = startOfToday();
  const notifications = [];

  installments.forEach((installment, index) => {
    const dueDate = parseLocalDate(installment.due_date);
    if (!dueDate) return;

    const daysUntil = Math.round((dueDate.getTime() - today.getTime()) / MS_PER_DAY);
    const stagger = index % 10;
    const base = {
      channelId: CHANNEL_ID,
      group: 'installments',
      autoCancel: true,
      extra: {
        source: 'installment-reminders',
        installmentId: installment.id,
        contractId: installment.contract_id,
        customerId: installment.customer_id,
      },
    };

    if (daysUntil > 0 && settings.daysBefore > 0) {
      const reminderDate = addDays(dueDate, -settings.daysBefore);
      notifications.push({
        ...base,
        id: notificationId(installment.id, 1),
        title: 'اقترب موعد القسط',
        body: buildBody(installment, 'upcoming', daysUntil),
        schedule: { at: ensureFutureTime(dateAtTime(reminderDate, settings.time, stagger), stagger), allowWhileIdle: true },
      });
    }

    if (daysUntil >= 0) {
      notifications.push({
        ...base,
        id: notificationId(installment.id, 2),
        title: 'قسط مستحق اليوم',
        body: buildBody(installment, 'today', daysUntil),
        schedule: { at: ensureFutureTime(dateAtTime(dueDate, settings.time, stagger), stagger), allowWhileIdle: true },
      });
    }

    if (settings.overdueEnabled) {
      if (daysUntil < 0) {
        notifications.push({
          ...base,
          id: notificationId(installment.id, 3),
          title: 'قسط متأخر',
          body: buildBody(installment, 'overdue', daysUntil),
          schedule: { at: nextDailyTime(settings.time, stagger), allowWhileIdle: true },
        });
      } else {
        const overdueDate = addDays(dueDate, 1);
        notifications.push({
          ...base,
          id: notificationId(installment.id, 4),
          title: 'متابعة قسط غير مسدد',
          body: buildBody(installment, 'overdue', -1),
          schedule: { at: dateAtTime(overdueDate, settings.time, stagger), allowWhileIdle: true },
        });
      }
    }
  });

  // iOS keeps at most 64 pending local notifications per application.
  const platformLimit = Capacitor.getPlatform() === 'ios' ? 64 : 100;
  return notifications
    .filter(notification => notification.schedule.at > new Date())
    .slice(0, platformLimit);
};

const scheduleNotifications = async (notifications) => {
  try {
    await LocalNotifications.schedule({ notifications });
  } catch {
    const relaxedNotifications = notifications.map(notification => ({
      ...notification,
      schedule: { ...notification.schedule, allowWhileIdle: false },
    }));
    await LocalNotifications.schedule({ notifications: relaxedNotifications });
  }
};

export const notificationService = {
  async refreshSchedule({ requestPermission = false } = {}) {
    const settings = await getSettings();

    if (!settings.enabled) {
      const cancelled = await cancelInstallmentNotifications({ removeWebSubscription: true });
      return { enabled: false, scheduled: 0, cancelled };
    }

    const permission = await ensurePermission(requestPermission);
    if (!permission.granted) {
      const cancelled = await cancelInstallmentNotifications();
      return { enabled: true, scheduled: 0, cancelled, permission: permission.reason };
    }

    if (!Capacitor.isNativePlatform()) {
      return { enabled: true, scheduled: 0, cancelled: 0, permission: 'granted', webPush: true };
    }

    await ensureChannel();
    const cancelled = await cancelInstallmentNotifications();
    const installments = await getNotifiableInstallments(settings);
    const notifications = buildNotifications(installments, settings);

    if (notifications.length > 0) {
      await scheduleNotifications(notifications);
    }

    return { enabled: true, scheduled: notifications.length, cancelled, permission: 'granted' };
  },

  async setEnabled(enabled) {
    if (!enabled) {
      await settingsService.set('installment_notifications_enabled', 'false');
      await cancelInstallmentNotifications({ removeWebSubscription: true });
      return { enabled: false, scheduled: 0 };
    }

    await settingsService.set('installment_notifications_enabled', 'true');
    const result = await this.refreshSchedule({ requestPermission: true });

    if (result.permission && result.permission !== 'granted') {
      await settingsService.set('installment_notifications_enabled', 'false');
      await cancelInstallmentNotifications({ removeWebSubscription: true });
      return { ...result, enabled: false };
    }

    return result;
  },

  async updateSetting(key, value) {
    await settingsService.set(key, String(value));
    return await this.refreshSchedule();
  },

  async sendTestNotification() {
    if (!Capacitor.isNativePlatform()) {
      return webPushService.sendTestNotification();
    }

    const permission = await ensurePermission(true);
    if (!permission.granted) {
      return { sent: false, permission: permission.reason };
    }

    await ensureChannel();
    await scheduleNotifications([{
      id: NOTIFICATION_ID_BASE + 9,
      title: 'اختبار تنبيهات الأقساط',
      body: 'تم تفعيل إشعارات الأقساط بنجاح',
      channelId: CHANNEL_ID,
      autoCancel: true,
      schedule: { at: new Date(Date.now() + 3000), allowWhileIdle: true },
    }]);

    return { sent: true, permission: 'granted' };
  },
};
