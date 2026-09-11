const DEFAULT_SUPABASE_URL = 'https://ehufhgulrubgnntmdhxn.supabase.co';
const DEFAULT_SUPABASE_KEY = 'sb_publishable_5O9wP_WCo3zqIkNzI_8Cpg_hYFM9NGC';
const PUSH_TABLE = 'fazatak_push_subscriptions';
const NOTIFICATION_WINDOW_MINUTES = 15;

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  },
});

const getSupabaseConfig = (env) => ({
  url: env.SUPABASE_URL || DEFAULT_SUPABASE_URL,
  key: env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_KEY,
});

const supabaseRequest = async (env, path, init = {}) => {
  const { url, key } = getSupabaseConfig(env);
  const headers = new Headers(init.headers || {});
  headers.set('apikey', key);
  headers.set('Authorization', `Bearer ${key}`);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${url}/rest/v1/${path}`, { ...init, headers });
  if (!response.ok) {
    throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  }
  if (response.status === 204) return null;
  return response.json();
};

const readJson = async (request) => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

const isValidSubscription = (subscription) => Boolean(
  subscription?.endpoint &&
  subscription?.keys?.p256dh &&
  subscription?.keys?.auth
);

const subscriptionRecord = (payload) => ({
  user_phone: String(payload.userPhone || '').trim(),
  endpoint: String(payload.subscription.endpoint),
  subscription: payload.subscription,
  expiration_time: payload.subscription.expirationTime || null,
  timezone: payload.timezone || payload.subscription.timezone || 'Asia/Riyadh',
  last_notification_key: null,
  updated_at: new Date().toISOString(),
});

const handlePushApi = async (request, env) => {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (url.pathname === '/api/push/config' && request.method === 'GET') {
    if (!env.VAPID_PUBLIC_KEY) return jsonResponse({ error: 'push_not_configured' }, 503);
    return jsonResponse({ vapidPublicKey: env.VAPID_PUBLIC_KEY });
  }

  if (url.pathname === '/api/push/subscribe' && request.method === 'POST') {
    const payload = await readJson(request);
    if (!payload?.userPhone || !isValidSubscription(payload.subscription)) {
      return jsonResponse({ error: 'invalid_subscription' }, 400);
    }

    await supabaseRequest(env, `${PUSH_TABLE}?on_conflict=endpoint`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([subscriptionRecord(payload)]),
    });
    return jsonResponse({ ok: true });
  }

  if (url.pathname === '/api/push/unsubscribe' && request.method === 'POST') {
    const payload = await readJson(request);
    if (!payload?.endpoint) return jsonResponse({ error: 'invalid_endpoint' }, 400);

    await supabaseRequest(env, `${PUSH_TABLE}?endpoint=eq.${encodeURIComponent(payload.endpoint)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
    return jsonResponse({ ok: true });
  }

  if (url.pathname === '/api/push/test' && request.method === 'POST') {
    const payload = await readJson(request);
    if (!payload?.endpoint) return jsonResponse({ error: 'invalid_endpoint' }, 400);

    const rows = await supabaseRequest(
      env,
      `${PUSH_TABLE}?endpoint=eq.${encodeURIComponent(payload.endpoint)}&select=endpoint,subscription`
    );
    const record = rows?.[0];
    if (!record) return jsonResponse({ error: 'subscription_not_found' }, 404);

    const result = await sendWebPush(env, record.subscription, {
      title: 'اختبار تنبيهات الأقساط',
      body: 'تم تفعيل إشعارات الأقساط بنجاح',
      tag: 'fazatak-test',
      data: { url: '/' },
    });
    if (result.expired) await deleteSubscription(env, record.endpoint);
    return jsonResponse({ ok: result.sent }, result.sent ? 200 : 502);
  }

  return jsonResponse({ error: 'not_found' }, 404);
};

const base64UrlToBytes = (value) => {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const bytesToBase64Url = (bytes) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const utf8 = (value) => new TextEncoder().encode(value);

const concatBytes = (...parts) => {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

const hmac = async (keyBytes, data) => {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
};

const hkdfExtract = (salt, input) => hmac(salt.length ? salt : new Uint8Array(32), input);

const hkdfExpand = async (prk, info, length) => {
  const chunks = [];
  let previous = new Uint8Array(0);
  for (let counter = 1; chunks.reduce((total, chunk) => total + chunk.length, 0) < length; counter += 1) {
    previous = await hmac(prk, concatBytes(previous, info, new Uint8Array([counter])));
    chunks.push(previous);
  }
  return concatBytes(...chunks).slice(0, length);
};

const uint32Bytes = (value) => new Uint8Array([
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
]);

const normalizeEcdsaSignature = (signature) => {
  const bytes = new Uint8Array(signature);
  if (bytes.length === 64) return bytes;
  if (bytes[0] !== 0x30) throw new Error('Invalid VAPID signature');

  let offset = 2;
  if (bytes[offset] !== 0x02) throw new Error('Invalid VAPID signature');
  const rLength = bytes[offset + 1];
  const r = bytes.slice(offset + 2, offset + 2 + rLength);
  offset += 2 + rLength;
  if (bytes[offset] !== 0x02) throw new Error('Invalid VAPID signature');
  const sLength = bytes[offset + 1];
  const s = bytes.slice(offset + 2, offset + 2 + sLength);
  const raw = new Uint8Array(64);
  raw.set(r.slice(-32), 32 - Math.min(32, r.length));
  raw.set(s.slice(-32), 64 - Math.min(32, s.length));
  return raw;
};

const getVapidKeys = async (env) => {
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) {
    throw new Error('VAPID keys are not configured');
  }

  const publicBytes = base64UrlToBytes(env.VAPID_PUBLIC_KEY);
  if (publicBytes.length !== 65 || publicBytes[0] !== 4) throw new Error('Invalid VAPID public key');

  const privateKey = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: bytesToBase64Url(publicBytes.slice(1, 33)),
      y: bytesToBase64Url(publicBytes.slice(33, 65)),
      d: env.VAPID_PRIVATE_KEY,
      ext: true,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  return { privateKey, publicKey: env.VAPID_PUBLIC_KEY };
};

const createVapidAuthorization = async (env, endpoint) => {
  const { privateKey, publicKey } = await getVapidKeys(env);
  const endpointUrl = new URL(endpoint);
  const audience = `${endpointUrl.protocol}//${endpointUrl.host}`;
  const encodeJson = (value) => bytesToBase64Url(utf8(JSON.stringify(value)));
  const header = encodeJson({ typ: 'JWT', alg: 'ES256' });
  const payload = encodeJson({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + (12 * 60 * 60),
    sub: env.VAPID_SUBJECT || 'mailto:inquisitivestation92@mail.bu.app',
  });
  const signed = utf8(`${header}.${payload}`);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    signed
  );
  return `vapid t=${bytesToBase64Url(normalizeEcdsaSignature(signature))}, k=${publicKey}`;
};

const encryptPayload = async (subscription, payload) => {
  const receiverPublicBytes = base64UrlToBytes(subscription.keys.p256dh);
  const receiverPublic = await crypto.subtle.importKey(
    'raw',
    receiverPublicBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  const serverKeys = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
  const serverPublicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeys.publicKey));
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: receiverPublic },
    serverKeys.privateKey,
    256
  ));
  const authSecret = base64UrlToBytes(subscription.keys.auth);
  const keyPrk = await hkdfExtract(authSecret, sharedSecret);
  const keyInfo = concatBytes(utf8('WebPush: info\0'), receiverPublicBytes, serverPublicBytes);
  const ikm = await hkdfExpand(keyPrk, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const contentPrk = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand(contentPrk, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdfExpand(contentPrk, utf8('Content-Encoding: nonce\0'), 12);
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const plaintext = concatBytes(utf8(JSON.stringify(payload)), new Uint8Array([2]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 },
    aesKey,
    plaintext
  ));

  return concatBytes(salt, uint32Bytes(4096), new Uint8Array([serverPublicBytes.length]), serverPublicBytes, ciphertext);
};

const sendWebPush = async (env, subscription, payload) => {
  try {
    const body = await encryptPayload(subscription, payload);
    const authorization = await createVapidAuthorization(env, subscription.endpoint);
    const response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        TTL: '86400',
        Urgency: 'normal',
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
      },
      body,
    });
    return { sent: response.ok, expired: response.status === 404 || response.status === 410 };
  } catch (error) {
    console.warn('[Push] Send failed:', error);
    return { sent: false, expired: false };
  }
};

const deleteSubscription = async (env, endpoint) => {
  await supabaseRequest(env, `${PUSH_TABLE}?endpoint=eq.${encodeURIComponent(endpoint)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
};

const getLocalDateParts = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
};

const dateNumber = (dateText) => {
  const [year, month, day] = String(dateText || '').split('-').map(Number);
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day);
};

const getSettingsMap = (rows = []) => Object.fromEntries(
  rows.map((row) => [row.key, row.value])
);

const getDueCandidate = (backupPayload, now, timezone) => {
  const tables = backupPayload?.tables || {};
  const settings = getSettingsMap(tables.settings || []);
  if (settings.installment_notifications_enabled !== 'true') return null;

  const localNow = getLocalDateParts(now, timezone);
  const todayNumber = dateNumber(`${localNow.year}-${localNow.month}-${localNow.day}`);
  const daysBefore = Math.max(0, Number.parseInt(settings.installment_notification_days_before || '1', 10) || 0);
  const overdueEnabled = settings.installment_overdue_notifications_enabled !== 'false';
  const overdueThreshold = Math.max(0, Number.parseInt(settings.overdue_threshold_days || '30', 10) || 30);
  const configuredTime = String(settings.installment_notification_time || '09:00').split(':').map(Number);
  const configuredMinutes = (configuredTime[0] || 9) * 60 + (configuredTime[1] || 0);
  const currentMinutes = Number(localNow.hour) * 60 + Number(localNow.minute);
  if (Math.floor(currentMinutes / NOTIFICATION_WINDOW_MINUTES) !== Math.floor(configuredMinutes / NOTIFICATION_WINDOW_MINUTES)) return null;

  const customers = new Map((tables.customers || []).map((row) => [row.id, row]));
  const contracts = new Map((tables.contracts || []).map((row) => [row.id, row]));
  const candidates = [];

  for (const installment of tables.installments || []) {
    if (installment.status !== 'pending') continue;
    const contract = contracts.get(installment.contract_id);
    const customer = contract ? customers.get(contract.customer_id) : null;
    if (!contract || contract.status !== 'active' || !customer) continue;
    if (customer.status && customer.status !== 'active') continue;
    if (customer.is_deleted || customer.is_manually_flagged_as_overdue) continue;
    if (customer.manager_id && Number(customer.manager_id) !== 0) continue;
    if (customer.deleted_manager_id && Number(customer.deleted_manager_id) !== 0) continue;

    const dueNumber = dateNumber(installment.due_date);
    if (dueNumber === null) continue;
    const daysUntil = Math.round((dueNumber - todayNumber) / 86400000);
    let kind = null;
    let title = '';
    if (daysUntil > 0 && daysUntil <= daysBefore) {
      kind = 'upcoming';
      title = 'اقترب موعد القسط';
    } else if (daysUntil === 0) {
      kind = 'today';
      title = 'قسط مستحق اليوم';
    } else if (daysUntil < 0 && overdueEnabled && Math.abs(daysUntil) <= overdueThreshold) {
      kind = 'overdue';
      title = 'قسط متأخر';
    }
    if (!kind) continue;

    candidates.push({ installment, customer, kind, title, daysUntil, dueNumber });
  }

  candidates.sort((left, right) => left.dueNumber - right.dueNumber || Number(left.installment.id) - Number(right.installment.id));
  const candidate = candidates[0];
  if (!candidate) return null;

  const amount = settings.privacy_mode === 'true'
    ? '***'
    : Math.max(0, Number(candidate.installment.amount || 0) - Number(candidate.installment.actual_paid || 0)).toLocaleString('en-US');
  const customerName = candidate.customer.name || 'عميل';
  const owner = candidate.customer.manager_id ? '' : '';
  const body = candidate.kind === 'upcoming'
    ? `باقي ${candidate.daysUntil} يوم على قسط ${customerName}${owner} بقيمة ${amount} ريال`
    : candidate.kind === 'overdue'
      ? `قسط متأخر منذ ${Math.abs(candidate.daysUntil)} يوم: ${customerName} - ${amount} ريال`
      : `قسط مستحق اليوم: ${customerName} - ${amount} ريال`;

  return {
    key: `${candidate.installment.id}:${candidate.kind}:${localNow.year}-${localNow.month}-${localNow.day}`,
    title: candidate.title,
    body,
    tag: `installment-${candidate.installment.id}-${candidate.kind}`,
    data: { url: '/' },
  };
};

const runScheduledNotifications = async (env) => {
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return;

  const subscriptions = await supabaseRequest(env, `${PUSH_TABLE}?select=endpoint,user_phone,subscription,timezone,last_notification_key`);
  for (const record of subscriptions || []) {
    try {
      const rows = await supabaseRequest(
        env,
        `fazatak_user_data?user_phone=eq.${encodeURIComponent(record.user_phone)}&select=backup_payload&limit=1`
      );
      const candidate = getDueCandidate(rows?.[0]?.backup_payload, new Date(), record.timezone);
      if (!candidate || candidate.key === record.last_notification_key) continue;

      const result = await sendWebPush(env, record.subscription, candidate);
      if (result.expired) {
        await deleteSubscription(env, record.endpoint);
      } else if (result.sent) {
        await supabaseRequest(env, `${PUSH_TABLE}?endpoint=eq.${encodeURIComponent(record.endpoint)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ last_notification_key: candidate.key, updated_at: new Date().toISOString() }),
        });
      }
    } catch (error) {
      console.warn('[Push] Scheduled notification failed:', error);
    }
  }
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/push/')) {
      try {
        return await handlePushApi(request, env);
      } catch (error) {
        console.error('[Push API] Request failed:', error);
        return jsonResponse({ error: 'push_service_unavailable' }, 503);
      }
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runScheduledNotifications(env));
  },
};

export { handlePushApi, runScheduledNotifications };
