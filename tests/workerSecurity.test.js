import assert from 'node:assert/strict';
import test from 'node:test';
import worker, {
  getDueCandidate,
  handleAuthApi,
  handlePushApi,
  handleSyncApi,
  runScheduledNotifications,
} from '../worker.js';

const makeHash = async (value, phone) => {
  const bytes = new TextEncoder().encode(`FAZATAK_2026_SECURITY_SALT_${phone}_${value}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const createMock = async () => {
  const phone = '0551234567';
  const account = {
    id: 'account-id',
    account_number: '10000001',
    phone,
    name: 'Test Account',
    password_hash: await makeHash('correct-password', phone),
    pin_hash: await makeHash('1234', phone),
    subscription_status: 'trial',
    subscription_expiry: '2099-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
  };
  let cloudRecord = null;
  const restRequests = [];
  const rateLimitKeys = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method || 'GET';
    restRequests.push({ url: url.toString(), method, body: init.body });

    if (url.pathname.endsWith('/fazatak_users')) {
      if (method === 'PATCH') {
        Object.assign(account, JSON.parse(init.body));
        return new Response(JSON.stringify([account]), { status: 200 });
      }
      const phoneFilter = url.searchParams.get('phone');
      const accountFilter = url.searchParams.get('account_number');
      if (phoneFilter) return new Response(JSON.stringify(phoneFilter === `eq.${phone}` ? [account] : []), { status: 200 });
      if (accountFilter) return new Response(JSON.stringify(accountFilter === `eq.${account.account_number}` ? [account] : []), { status: 200 });
    }

    if (url.pathname.endsWith('/fazatak_user_data')) {
      if (method === 'POST') {
        cloudRecord = JSON.parse(init.body)[0];
        return new Response(JSON.stringify([cloudRecord]), { status: 201 });
      }
      return new Response(JSON.stringify(cloudRecord ? [cloudRecord] : []), { status: 200 });
    }
    return new Response('[]', { status: 200 });
  };

  const env = {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-secret',
    AUTH_SESSION_SECRET: 'test-session-secret-with-sufficient-length',
    AUTH_IP_LIMITER: { limit: async ({ key }) => { rateLimitKeys.push(['ip', key]); return { success: true }; } },
    AUTH_ACCOUNT_LIMITER: { limit: async ({ key }) => { rateLimitKeys.push(['account', key]); return { success: true }; } },
  };
  return {
    account,
    env,
    restRequests,
    rateLimitKeys,
    restore: () => { globalThis.fetch = originalFetch; },
  };
};

const postJson = (url, body, headers = {}) => new Request(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

const putJson = (url, body, headers = {}) => new Request(url, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

test('Worker protects the API and allows localhost Vite origins', async () => {
  const response = await worker.fetch(new Request('https://fazatak.honda-druid.workers.dev/api/auth/profile', {
    headers: { Origin: 'http://localhost:5173' },
  }), {});

  assert.equal(response.status, 401);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'http://localhost:5173');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('password login keeps the legacy account and never returns its hashes', async () => {
  const mock = await createMock();
  try {
    const response = await handleAuthApi(postJson('https://app.example/api/auth/login', {
      phone: '٠٥٥١٢٣٤٥٦٧',
      password: 'correct-password',
    }), mock.env);
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.user.account_number, mock.account.account_number);
    assert.equal(result.user.phone, mock.account.phone);
    assert.equal(result.user.password_hash, undefined);
    assert.equal(result.user.pin_hash, undefined);
    assert.match(result.token, /^.+\..+\..+$/);

    const profile = await handleAuthApi(new Request('https://app.example/api/auth/profile', {
      headers: { Authorization: `Bearer ${result.token}` },
    }), mock.env);
    assert.equal((await profile.json()).user.account_number, mock.account.account_number);
  } finally {
    mock.restore();
  }
});

test('invalid credentials reveal no account details', async () => {
  const mock = await createMock();
  try {
    const response = await handleAuthApi(postJson('https://app.example/api/auth/login', {
      phone: mock.account.phone,
      password: 'wrong-password',
    }), mock.env);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'invalid_credentials' });
  } finally {
    mock.restore();
  }
});

test('login fails closed when rate-limit bindings reject attempts', async () => {
  const mock = await createMock();
  mock.env.AUTH_IP_LIMITER = { limit: async () => ({ success: false }) };
  try {
    const response = await handleAuthApi(postJson('https://app.example/api/auth/login', {
      phone: mock.account.phone,
      password: 'correct-password',
    }), mock.env);
    assert.equal(response.status, 429);
    assert.equal(mock.restRequests.length, 0);
  } finally {
    mock.restore();
  }
});

test('account rate limit uses one key for Saudi phone formats', async () => {
  const mock = await createMock();
  try {
    for (const phone of ['0551234567', '+966551234567']) {
      const response = await handleAuthApi(postJson('https://app.example/api/auth/login', {
        phone,
        password: 'correct-password',
      }), mock.env);
      assert.equal(response.status, 200);
    }

    const keys = mock.rateLimitKeys.filter(([scope]) => scope === 'account').map(([, key]) => key);
    assert.equal(keys.length, 2);
    assert.equal(keys[0], keys[1]);
  } finally {
    mock.restore();
  }
});

test('cloud reads and writes are scoped to the signed-in account', async () => {
  const mock = await createMock();
  try {
    const login = await handleAuthApi(postJson('https://app.example/api/auth/login', {
      phone: mock.account.phone,
      password: 'correct-password',
    }), mock.env);
    const { token } = await login.json();
    const headers = { Authorization: `Bearer ${token}` };

    const read = await handleSyncApi(new Request('https://app.example/api/sync/data', { headers }), mock.env);
    assert.equal((await read.json()).record, null);

    const backupPayload = { tables: { customers: [{ id: 1, name: 'Private Customer' }] } };
    const write = await handleSyncApi(putJson('https://app.example/api/sync/data', {
      backupPayload,
      recordsCount: 1,
      expectedUpdatedAt: null,
    }, headers), mock.env);
    const result = await write.json();

    assert.equal(write.status, 200);
    assert.equal(result.record.user_account_number, mock.account.account_number);
    assert.equal(result.record.backup_payload.tables.customers[0].name, 'Private Customer');
    const insert = mock.restRequests.find((request) => request.url.includes('/fazatak_user_data') && request.method === 'POST');
    assert.ok(insert);
    assert.match(insert.url, /on_conflict=user_account_number/);
    assert.equal(JSON.parse(insert.body)[0].owner_user_id, undefined);
  } finally {
    mock.restore();
  }
});

test('cloud writes reject stale versions rather than overwriting newer data', async () => {
  const mock = await createMock();
  const current = {
    user_account_number: mock.account.account_number,
    user_phone: mock.account.phone,
    backup_payload: { tables: { customers: [{ id: 1 }] } },
    records_count: 1,
    updated_at: '2026-10-14T10:00:00.000Z',
  };
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/fazatak_users')) return new Response(JSON.stringify([mock.account]), { status: 200 });
    if (url.pathname.endsWith('/fazatak_user_data')) return new Response(JSON.stringify([current]), { status: 200 });
    return new Response('[]', { status: 200 });
  };
  try {
    const login = await handleAuthApi(postJson('https://app.example/api/auth/login', {
      phone: mock.account.phone,
      password: 'correct-password',
    }), mock.env);
    const { token } = await login.json();
    const response = await handleSyncApi(putJson('https://app.example/api/sync/data', {
      backupPayload: { tables: { customers: [] } },
      recordsCount: 0,
      expectedUpdatedAt: '2026-10-14T09:00:00.000Z',
    }, { Authorization: `Bearer ${token}` }), mock.env);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).record.updated_at, current.updated_at);
  } finally {
    mock.restore();
  }
});

test('push mutations reject requests without a signed-in session', async () => {
  const response = await handlePushApi(postJson('https://app.example/api/push/subscribe', {
    subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/example', keys: { p256dh: 'x', auth: 'y' } },
  }), {});
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'authentication_required' });
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
