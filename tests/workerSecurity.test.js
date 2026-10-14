import assert from 'node:assert/strict';
import test from 'node:test';
import { getDueCandidate, handlePushApi, runScheduledNotifications } from '../worker.js';

test('push mutations reject requests without a verified bearer session', async () => {
  const response = await handlePushApi(new Request('https://app.example/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userPhone: '+966500000000',
      subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/example', keys: { p256dh: 'x', auth: 'y' } },
    }),
  }), {});

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'authentication_required' });
});

test('push subscription ownership comes from the verified session, not request fields', async () => {
  const originalFetch = globalThis.fetch;
  const restRequests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify({
        id: 'verified-user-id',
        phone: '+966551234567',
        phone_confirmed_at: new Date().toISOString(),
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    restRequests.push({ url, init });
    if (init.method === 'GET') return new Response('[]', { status: 200 });
    return new Response(null, { status: 201 });
  };

  try {
    const response = await handlePushApi(new Request('https://app.example/api/push/subscribe', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer verified-session-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userPhone: '+966500000000',
        timezone: 'Asia/Riyadh',
        subscription: {
          endpoint: 'https://fcm.googleapis.com/fcm/send/private-endpoint-token',
          keys: { p256dh: 'public-key', auth: 'auth-key' },
        },
      }),
    }), {
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
    });

    assert.equal(response.status, 200);
    const insert = restRequests.find(({ init }) => init.method === 'POST');
    assert.ok(insert);
    const record = JSON.parse(insert.init.body)[0];
    assert.equal(record.owner_user_id, 'verified-user-id');
    assert.equal(record.user_phone, undefined);
    assert.match(insert.url, /rest\/v1\/fazatak_push_subscriptions$/);
    assert.equal(new Headers(insert.init.headers).get('Authorization'), 'Bearer service-role-secret');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('push configuration exposes no key when VAPID is not configured', async () => {
  const response = await handlePushApi(new Request('https://app.example/api/push/config'), {});
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'push_not_configured' });
});

test('scheduled push fails closed without a service-role secret', async () => {
  await assert.rejects(
    runScheduledNotifications({ VAPID_PUBLIC_KEY: 'public', VAPID_PRIVATE_KEY: 'private' }),
    /Worker secrets are not configured/
  );
});

test('due reminders do not reveal customer names or amounts', () => {
  const now = new Date();
  const dateParts = Object.fromEntries(new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  const dueDate = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
  const payload = {
    tables: {
      settings: [{ key: 'due_alerts_enabled', value: 'true' }],
      customers: [{ id: 1, name: 'Private Customer' }],
      contracts: [{ id: 2, customer_id: 1, status: 'active' }],
      installments: [{ id: 3, contract_id: 2, status: 'pending', due_date: dueDate, amount: 987654, actual_paid: 0 }],
    },
  };

  const notification = getDueCandidate(payload, now, 'Asia/Riyadh');
  assert.ok(notification);
  assert.doesNotMatch(notification.body, /Private Customer|987654/);
  assert.equal(notification.body, 'افتح تطبيق أقساطي لمراجعة التفاصيل.');
});
