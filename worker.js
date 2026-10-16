const PUSH_TABLE = 'fazatak_push_subscriptions';
const AUTH_SALT_PREFIX = 'FAZATAK_2026_SECURITY_SALT_';
const AUTH_SESSION_ISSUER = 'fazatak-worker';
const AUTH_SESSION_SECONDS = 7 * 24 * 60 * 60;
const PROFILE_COLUMNS = 'id,account_number,phone,name,subscription_status,subscription_expiry,created_at';

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  },
});

const getSupabaseConfig = (env) => {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase Worker secrets are not configured');
  }
  return { url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY };
};

const supabaseRequest = async (env, path, init = {}) => {
  const { url, key } = getSupabaseConfig(env);
  const headers = new Headers(init.headers || {});
  headers.set('apikey', key);
  headers.set('Authorization', `Bearer ${key}`);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${url}/rest/v1/${path}`, { ...init, headers });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  const body = await response.text();
  return body ? JSON.parse(body) : null;
};

const base64UrlEncode = (bytes) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const base64UrlDecode = (value) => {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const constantTimeEqual = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
};

const normalizePhone = (value) => String(value || '')
  .trim()
  .replace(/[\u0660-\u0669]/g, (digit) => digit.charCodeAt(0) - 1632)
  .replace(/[\u06f0-\u06f9]/g, (digit) => digit.charCodeAt(0) - 1776)
  .replace(/[^\d+]/g, '');

const phoneCandidates = (value) => {
  const normalized = normalizePhone(value);
  const digits = normalized.replace(/\D/g, '');
  const candidates = [normalized, digits];
  if (digits.startsWith('966') && digits.length === 12) candidates.push(`0${digits.slice(3)}`);
  if (digits.startsWith('0') && digits.length === 10) candidates.push(`+966${digits.slice(1)}`);
  if (digits.startsWith('5') && digits.length === 9) candidates.push(`+966${digits}`);
  return [...new Set(candidates.filter(Boolean))];
};

const canonicalRateLimitPhone = (value) => {
  const digits = normalizePhone(value).replace(/\D/g, '');
  if (digits.startsWith('966') && digits.length === 12) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 10) return `+966${digits.slice(1)}`;
  if (digits.startsWith('5') && digits.length === 9) return `+966${digits}`;
  return digits || 'unknown';
};

const hashLegacyValue = async (value, phone) => {
  const input = new TextEncoder().encode(`${AUTH_SALT_PREFIX}${phone}_${String(value || '').trim()}`);
  const digest = await crypto.subtle.digest('SHA-256', input);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const signSession = async (env, account) => {
  if (!env.AUTH_SESSION_SECRET) throw new Error('Authentication session secret is not configured');
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify({
    iss: AUTH_SESSION_ISSUER,
    sub: account.account_number,
    iat: now,
    exp: now + AUTH_SESSION_SECONDS,
  })));
  const message = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.AUTH_SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return `${message}.${base64UrlEncode(new Uint8Array(signature))}`;
};

const verifySession = async (request, env) => {
  const token = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token || !env.AUTH_SESSION_SECRET) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const [header, payload, signature] = parts;
    const decodedHeader = JSON.parse(new TextDecoder().decode(base64UrlDecode(header)));
    const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
    if (decodedHeader.alg !== 'HS256' || claims.iss !== AUTH_SESSION_ISSUER
      || !claims.sub || !Number.isFinite(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000)) return null;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(env.AUTH_SESSION_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const expected = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${payload}`));
    return constantTimeEqual(base64UrlEncode(new Uint8Array(expected)), signature) ? claims : null;
  } catch {
    return null;
  }
};

const getAccountByPhone = async (env, phone, columns = PROFILE_COLUMNS) => {
  for (const candidate of phoneCandidates(phone)) {
    const rows = await supabaseRequest(
      env,
      `fazatak_users?phone=eq.${encodeURIComponent(candidate)}&select=${columns}&limit=1`
    );
    if (rows?.[0]) return rows[0];
  }
  return null;
};

const getAccountByNumber = async (env, accountNumber, columns = PROFILE_COLUMNS) => {
  const rows = await supabaseRequest(
    env,
    `fazatak_users?account_number=eq.${encodeURIComponent(accountNumber)}&select=${columns}&limit=1`
  );
  return rows?.[0] || null;
};

const getCloudRecordRow = async (env, accountNumber) => {
  const rows = await supabaseRequest(
    env,
    `fazatak_user_data?user_account_number=eq.${encodeURIComponent(accountNumber)}&select=user_account_number,user_phone,backup_payload,records_count,updated_at&limit=1`
  );
  return rows?.[0] || null;
};

const gzipJson = async (value) => {
  const stream = new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

const readKvJson = async (env, key) => {
  if (!env.BACKUP_KV) throw new Error('Cloud backup KV namespace is not configured');
  const value = await env.BACKUP_KV.get(key, 'arrayBuffer');
  if (!value) throw new Error('Archived backup is missing');
  const stream = new Blob([value]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).json();
};

const readKvBackup = async (env, pointer) => {
  const separator = pointer.lastIndexOf('#');
  if (separator < 0) throw new Error('Archived backup pointer is invalid');
  const key = pointer.slice(0, separator);
  const id = decodeURIComponent(pointer.slice(separator + 1));
  const batch = await readKvJson(env, key);
  const item = batch?.items?.find((candidate) => String(candidate.id) === id);
  if (!item) throw new Error('Archived backup record is missing');
  return item.data;
};

const storeVerifiedKvBackupBatch = async (env, key, items) => {
  if (!env.BACKUP_KV) throw new Error('Cloud backup KV namespace is not configured');
  const payload = { version: 1, items };
  const compressed = await gzipJson(payload);
  if (compressed.byteLength > 25 * 1024 * 1024) throw new Error('KV backup batch exceeds the value size limit');
  const value = compressed.buffer.slice(
    compressed.byteOffset,
    compressed.byteOffset + compressed.byteLength
  );
  await env.BACKUP_KV.put(key, value);
  try {
    const verifiedPayload = await readKvJson(env, key);
    if (JSON.stringify(verifiedPayload) !== JSON.stringify(payload)) {
      throw new Error('KV backup verification failed');
    }
  } catch (error) {
    try {
      await env.BACKUP_KV.delete(key);
    } catch {
      // An unreferenced key is safer than clearing the source backup.
    }
    throw error;
  }
};

const getCloudRecord = getCloudRecordRow;

const publicCloudRecord = (record) => record || null;

const publicProfile = (account) => {
  const expired = account.subscription_expiry
    && new Date(account.subscription_expiry).getTime() < Date.now();
  return {
    id: account.id,
    account_number: account.account_number,
    phone: account.phone,
    name: account.name,
    subscription_status: expired ? 'expired' : account.subscription_status,
    subscription_expiry: account.subscription_expiry,
    created_at: account.created_at,
  };
};

const updateAccount = async (env, accountId, fields) => supabaseRequest(
  env,
  `fazatak_users?id=eq.${encodeURIComponent(accountId)}`,
  {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(fields),
  }
);

const checkAuthRateLimit = async (request, env, phone) => {
  if (!env.AUTH_IP_LIMITER || !env.AUTH_ACCOUNT_LIMITER) return false;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const normalized = canonicalRateLimitPhone(phone);
  const accountKey = await hashLegacyValue(normalized, 'rate-limit');
  const [byIp, byAccount] = await Promise.all([
    env.AUTH_IP_LIMITER.limit({ key: ip }),
    env.AUTH_ACCOUNT_LIMITER.limit({ key: accountKey }),
  ]);
  return byIp.success && byAccount.success;
};

const authenticateAccount = async (request, env) => {
  const claims = await verifySession(request, env);
  if (!claims) return null;
  return getAccountByNumber(env, claims.sub);
};

const handleAuthApi = async (request, env) => {
  const url = new URL(request.url);
  const payload = request.method === 'POST' ? await readJson(request, 16_000) : null;

  if (url.pathname === '/api/auth/login' && request.method === 'POST') {
    const phone = normalizePhone(payload?.phone);
    const password = String(payload?.password || '').trim();
    if (!phone || !password) return jsonResponse({ error: 'invalid_credentials' }, 401);
    if (!(await checkAuthRateLimit(request, env, phone))) {
      return jsonResponse({ error: env.AUTH_IP_LIMITER && env.AUTH_ACCOUNT_LIMITER ? 'too_many_attempts' : 'auth_unavailable' }, env.AUTH_IP_LIMITER && env.AUTH_ACCOUNT_LIMITER ? 429 : 503);
    }

    const account = await getAccountByPhone(env, phone, `${PROFILE_COLUMNS},password_hash`);
    if (!account || !constantTimeEqual(await hashLegacyValue(password, account.phone), account.password_hash)) {
      return jsonResponse({ error: 'invalid_credentials' }, 401);
    }

    await updateAccount(env, account.id, { last_login_at: new Date().toISOString() });
    const token = await signSession(env, account);
    return jsonResponse({ user: publicProfile(account), token });
  }

  if (url.pathname === '/api/auth/register' && request.method === 'POST') {
    const name = String(payload?.name || '').trim();
    const phone = normalizePhone(payload?.phone);
    const password = String(payload?.password || '').trim();
    const pin = String(payload?.pin || '').trim();
    if (name.length < 2 || name.length > 120 || !/^\+?\d{9,15}$/.test(phone)
      || password.length < 6 || !/^\d{4,6}$/.test(pin)) {
      return jsonResponse({ error: 'invalid_registration' }, 400);
    }
    if (!(await checkAuthRateLimit(request, env, phone))) {
      return jsonResponse({ error: env.AUTH_IP_LIMITER && env.AUTH_ACCOUNT_LIMITER ? 'too_many_attempts' : 'auth_unavailable' }, env.AUTH_IP_LIMITER && env.AUTH_ACCOUNT_LIMITER ? 429 : 503);
    }
    if (await getAccountByPhone(env, phone, 'id')) return jsonResponse({ error: 'account_exists' }, 409);

    const rows = await supabaseRequest(env, 'fazatak_users', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify([{
        phone,
        name,
        password_hash: await hashLegacyValue(password, phone),
        pin_hash: await hashLegacyValue(pin, phone),
        metadata: { registeredPlatform: request.headers.get('Origin') || 'app' },
      }]),
    });
    const account = rows?.[0];
    if (!account?.account_number) throw new Error('Account creation returned no profile');
    return jsonResponse({ user: publicProfile(account), token: await signSession(env, account) }, 201);
  }

  if (url.pathname === '/api/auth/recover' && request.method === 'POST') {
    const phone = normalizePhone(payload?.phone);
    const pin = String(payload?.pin || '').trim();
    const password = String(payload?.newPassword || '').trim();
    if (!phone || !/^\d{4,6}$/.test(pin) || password.length < 6) {
      return jsonResponse({ error: 'invalid_recovery' }, 400);
    }
    if (!(await checkAuthRateLimit(request, env, phone))) {
      return jsonResponse({ error: env.AUTH_IP_LIMITER && env.AUTH_ACCOUNT_LIMITER ? 'too_many_attempts' : 'auth_unavailable' }, env.AUTH_IP_LIMITER && env.AUTH_ACCOUNT_LIMITER ? 429 : 503);
    }
    const account = await getAccountByPhone(env, phone, 'id,phone,pin_hash');
    if (!account || !constantTimeEqual(await hashLegacyValue(pin, account.phone), account.pin_hash)) {
      return jsonResponse({ error: 'invalid_recovery' }, 401);
    }
    await updateAccount(env, account.id, { password_hash: await hashLegacyValue(password, account.phone) });
    return jsonResponse({ success: true });
  }

  const account = await authenticateAccount(request, env);
  if (!account) return jsonResponse({ error: 'authentication_required' }, 401);

  if (url.pathname === '/api/auth/profile' && request.method === 'GET') {
    return jsonResponse({ user: publicProfile(account) });
  }

  if (url.pathname === '/api/auth/password' && request.method === 'POST') {
    const currentPassword = String(payload?.currentPassword || '').trim();
    const newPassword = String(payload?.newPassword || '').trim();
    if (newPassword.length < 6 || newPassword === currentPassword) {
      return jsonResponse({ error: 'invalid_password' }, 400);
    }
    const fullAccount = await getAccountByNumber(env, account.account_number, 'id,phone,password_hash');
    if (!constantTimeEqual(await hashLegacyValue(currentPassword, fullAccount.phone), fullAccount.password_hash)) {
      return jsonResponse({ error: 'invalid_password' }, 401);
    }
    await updateAccount(env, account.id, { password_hash: await hashLegacyValue(newPassword, account.phone) });
    return jsonResponse({ success: true });
  }

  return jsonResponse({ error: 'not_found' }, 404);
};

const handleSyncApi = async (request, env) => {
  const url = new URL(request.url);
  const account = await authenticateAccount(request, env);
  if (!account) return jsonResponse({ error: 'authentication_required' }, 401);

  if (url.pathname === '/api/sync/data' && request.method === 'GET') {
    return jsonResponse({ record: publicCloudRecord(await getCloudRecord(env, account.account_number)) });
  }

  if (url.pathname === '/api/sync/data' && request.method === 'PUT') {
    const payload = await readJson(request, 8 * 1024 * 1024);
    if (!payload?.backupPayload?.tables || typeof payload.backupPayload.tables !== 'object') {
      return jsonResponse({ error: 'invalid_backup' }, 400);
    }

    const existing = await getCloudRecord(env, account.account_number);
    const expectedUpdatedAt = payload.expectedUpdatedAt || null;
    if ((existing?.updated_at || null) !== expectedUpdatedAt) {
      return jsonResponse({ error: 'sync_conflict', record: publicCloudRecord(existing) }, 409);
    }

    const updatedAt = new Date().toISOString();
    const rows = await supabaseRequest(env, 'fazatak_user_data?on_conflict=user_account_number', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify([{
        user_account_number: account.account_number,
        user_phone: account.phone,
        backup_payload: payload.backupPayload,
        records_count: Math.max(0, Number(payload.recordsCount) || 0),
        updated_at: updatedAt,
      }]),
    });
    return jsonResponse({ record: publicCloudRecord({
      ...(rows?.[0] || { ...existing, user_account_number: account.account_number, updated_at: updatedAt }),
      backup_payload: payload.backupPayload,
    }) });
  }

  return jsonResponse({ error: 'not_found' }, 404);
};

const getVerifiedUser = async (request, env) => {
  const account = await authenticateAccount(request, env);
  return account ? {
    id: account.id,
    account_number: account.account_number,
    phone: account.phone,
  } : null;
};

const isAllowedPushEndpoint = (endpoint) => {
  try {
    const parsed = new URL(endpoint);
    const host = parsed.hostname.toLowerCase();
    const allowedHost = host === 'fcm.googleapis.com'
      || host === 'web.push.apple.com'
      || host.endsWith('.push.apple.com')
      || host === 'updates.push.services.mozilla.com'
      || host.endsWith('.push.services.mozilla.com')
      || host.endsWith('.notify.windows.com');
    return parsed.protocol === 'https:'
      && !parsed.username
      && !parsed.password
      && (!parsed.port || parsed.port === '443')
      && allowedHost;
  } catch {
    return false;
  }
};

const readJson = async (request, maxBytes = 128_000) => {
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).length > maxBytes) return null;
    return JSON.parse(body);
  } catch {
    return null;
  }
};

const isValidSubscription = (subscription) => Boolean(
  subscription?.endpoint &&
  subscription?.keys?.p256dh &&
  subscription?.keys?.auth
);

const subscriptionRecord = (payload, ownerPhone) => ({
  user_phone: ownerPhone,
  endpoint: String(payload.subscription.endpoint),
  subscription: payload.subscription,
  expiration_time: payload.subscription.expirationTime || null,
  timezone: payload.timezone || payload.subscription.timezone || 'Asia/Riyadh',
  last_notification_key: null,
  updated_at: new Date().toISOString(),
});

const handleBackupArchiveApi = async (request, env) => {
  if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  const suppliedSecret = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!env.BACKUP_ADMIN_SECRET || env.BACKUP_ADMIN_SECRET.length < 32
    || !constantTimeEqual(suppliedSecret, env.BACKUP_ADMIN_SECRET)) {
    return jsonResponse({ error: 'authentication_required' }, 401);
  }
  if (!env.BACKUP_KV) return jsonResponse({ error: 'backup_kv_not_configured' }, 503);

  const payload = await readJson(request, 4096);
  const action = payload?.action;
  if (!['archive', 'restore'].includes(action)) return jsonResponse({ error: 'invalid_action' }, 400);

  const requestedLimit = Number(payload.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(8, Math.floor(requestedLimit))
    : 8;
  const isArchive = action === 'archive';
  const filter = isArchive
    ? 'backup_data=not.is.null&backup_kv_key=is.null'
    : 'backup_data=is.null&backup_kv_key=not.is.null';

  let rows;
  try {
    rows = await supabaseRequest(
      env,
      `fazatak_backups?select=id,backup_data,backup_kv_key&${filter}&order=id.asc&limit=${limit}`
    );
  } catch (error) {
    console.warn('[BackupArchive] Batch query failed:', error?.name || 'unknown error');
    return jsonResponse({ error: 'archive_unavailable' }, 503);
  }

  let completed = 0;
  if (isArchive && rows?.length) {
    const key = `legacy/fazatak_backups/batch-${crypto.randomUUID()}.json.gz`;
    const items = rows.map((row) => ({ id: String(row.id), data: row.backup_data }));
    try {
      await storeVerifiedKvBackupBatch(env, key, items);
      for (const row of rows) {
        const pointer = `${key}#${encodeURIComponent(row.id)}`;
        const updated = await supabaseRequest(
          env,
          `fazatak_backups?id=eq.${encodeURIComponent(row.id)}&backup_data=not.is.null&backup_kv_key=is.null&select=id`,
          {
            method: 'PATCH',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({ backup_data: null, backup_kv_key: pointer }),
          }
        );
        if (updated?.length) completed += 1;
      }
      if (!completed) await env.BACKUP_KV.delete(key).catch(() => {});
    } catch (error) {
      console.warn('[BackupArchive] Batch stopped safely:', error?.name || 'unknown error');
      return jsonResponse({ error: 'archive_failed', completed }, 503);
    }
  } else if (!isArchive) {
    for (const row of rows || []) {
      try {
        const backupData = await readKvBackup(env, row.backup_kv_key);
        const updated = await supabaseRequest(
          env,
          `fazatak_backups?id=eq.${encodeURIComponent(row.id)}&backup_data=is.null&backup_kv_key=eq.${encodeURIComponent(row.backup_kv_key)}&select=id`,
          {
            method: 'PATCH',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({ backup_data: backupData, backup_kv_key: null }),
          }
        );
        if (!updated?.length) continue;
        completed += 1;
      } catch (error) {
        console.warn('[BackupArchive] Batch stopped safely:', error?.name || 'unknown error');
        return jsonResponse({ error: 'archive_failed', completed }, 503);
      }
    }
  }

  return jsonResponse({ action, scanned: rows?.length || 0, completed, hasMore: rows?.length === limit });
};

const handlePushApi = async (request, env) => {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

  if (url.pathname === '/api/push/config' && request.method === 'GET') {
    if (!env.VAPID_PUBLIC_KEY) return jsonResponse({ error: 'push_not_configured' }, 503);
    return jsonResponse({ vapidPublicKey: env.VAPID_PUBLIC_KEY });
  }

  const user = await getVerifiedUser(request, env);
  if (!user) return jsonResponse({ error: 'authentication_required' }, 401);

  if (url.pathname === '/api/push/subscribe' && request.method === 'POST') {
    const payload = await readJson(request);
    if (!isValidSubscription(payload?.subscription)
      || !isAllowedPushEndpoint(payload.subscription.endpoint)) {
      return jsonResponse({ error: 'invalid_subscription' }, 400);
    }

    const endpointFilter = encodeURIComponent(payload.subscription.endpoint);
    const existing = await supabaseRequest(
      env,
      `${PUSH_TABLE}?endpoint=eq.${endpointFilter}&select=user_phone`
    );
    if (existing?.length && existing[0].user_phone !== user.phone) {
      return jsonResponse({ error: 'subscription_already_owned' }, 409);
    }

    const route = existing?.length
      ? `${PUSH_TABLE}?user_phone=eq.${encodeURIComponent(user.phone)}&endpoint=eq.${endpointFilter}`
      : PUSH_TABLE;
    await supabaseRequest(env, route, {
      method: existing?.length ? 'PATCH' : 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(existing?.length
        ? subscriptionRecord(payload, user.phone)
        : [subscriptionRecord(payload, user.phone)]),
    });
    return jsonResponse({ ok: true });
  }

  if (url.pathname === '/api/push/unsubscribe' && request.method === 'POST') {
    const payload = await readJson(request);
    if (!isAllowedPushEndpoint(payload?.endpoint)) return jsonResponse({ error: 'invalid_endpoint' }, 400);

    await supabaseRequest(env, `${PUSH_TABLE}?user_phone=eq.${encodeURIComponent(user.phone)}&endpoint=eq.${encodeURIComponent(payload.endpoint)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
    return jsonResponse({ ok: true });
  }

  if (url.pathname === '/api/push/test' && request.method === 'POST') {
    const payload = await readJson(request);
    if (!isAllowedPushEndpoint(payload?.endpoint)) return jsonResponse({ error: 'invalid_endpoint' }, 400);

    const rows = await supabaseRequest(
      env,
      `${PUSH_TABLE}?user_phone=eq.${encodeURIComponent(user.phone)}&endpoint=eq.${encodeURIComponent(payload.endpoint)}&select=endpoint,subscription`
    );
    const record = rows?.[0];
    if (!record) return jsonResponse({ error: 'subscription_not_found' }, 404);

    const result = await sendWebPush(env, record.subscription, {
      title: 'تجربة تنبيهات أقساطي',
      body: 'تم تفعيل Push على هذا الجهاز بنجاح ✅',
      tag: 'fazatak-test',
      data: { url: '/' },
    });
    if (result.expired) await deleteSubscription(env, record.endpoint, user.id);
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
    sub: env.VAPID_SUBJECT || 'https://fazatak.pages.dev',
  });
  const signed = utf8(`${header}.${payload}`);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    signed
  );
  return `vapid t=${header}.${payload}.${bytesToBase64Url(normalizeEcdsaSignature(signature))}, k=${publicKey}`;
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
    console.warn('[Push] Send failed:', error?.name || 'unknown error');
    return { sent: false, expired: false };
  }
};

const deleteSubscription = async (env, endpoint, ownerUserId) => {
  await supabaseRequest(env, `${PUSH_TABLE}?user_phone=eq.${encodeURIComponent(ownerUserId)}&endpoint=eq.${encodeURIComponent(endpoint)}`, {
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

const getSettingsMap = (rows = []) => Object.fromEntries(rows.map((row) => [row.key, row.value]));

const getDueCandidate = (backupPayload, now, timezone) => {
  const tables = backupPayload?.tables || {};
  const settings = getSettingsMap(tables.settings || []);
  if (settings.due_alerts_enabled !== 'true') return null;

  const localNow = getLocalDateParts(now, timezone);
  const todayNumber = dateNumber(`${localNow.year}-${localNow.month}-${localNow.day}`);
  if (todayNumber === null) return null;

  const customers = new Map((tables.customers || []).map((row) => [row.id, row]));
  const contracts = new Map((tables.contracts || []).map((row) => [row.id, row]));
  const groups = new Map();

  for (const installment of tables.installments || []) {
    if (installment.status !== 'pending') continue;
    const contract = contracts.get(installment.contract_id);
    const customer = contract ? customers.get(contract.customer_id) : null;
    if (!contract || contract.status !== 'active' || !customer) continue;
    if (customer.status && customer.status !== 'active') continue;
    if (customer.is_deleted || customer.deleted_at) continue;

    const dueNumber = dateNumber(installment.due_date);
    if (dueNumber === null || dueNumber > todayNumber) continue;
    const bucket = dueNumber < todayNumber ? 'late' : 'today';
    const key = `${customer.id}:${bucket}`;
    const existing = groups.get(key) || {
      customerId: customer.id,
      bucket,
      count: 0,
      amount: 0,
      firstDueDate: installment.due_date,
      daysLate: Math.max(0, Math.round((todayNumber - dueNumber) / 86400000)),
    };
    existing.count += 1;
    existing.amount += Math.max(0, Number(installment.amount || 0) - Number(installment.actual_paid || 0));
    if (String(installment.due_date) < String(existing.firstDueDate)) existing.firstDueDate = installment.due_date;
    existing.daysLate = Math.max(existing.daysLate, Math.max(0, Math.round((todayNumber - dueNumber) / 86400000)));
    groups.set(key, existing);
  }

  const entries = [...groups.values()].sort((left, right) => (
    right.daysLate - left.daysLate || right.amount - left.amount
  ));
  if (entries.length === 0) return null;

  const late = entries.filter((entry) => entry.bucket === 'late');
  const dateKey = `${localNow.year}-${localNow.month}-${localNow.day}`;
  const signature = entries.map((entry) => `${entry.customerId}:${entry.bucket}:${entry.count}:${Math.round(entry.amount)}`).join('|');
  const title = late.length ? 'تذكير بالمتابعة' : 'تذكير باستحقاق اليوم';
  const body = 'افتح تطبيق أقساطي لمراجعة التفاصيل.';

  return {
    key: `${dateKey}:${signature}`,
    title,
    body,
    tag: `fazatak-due-alerts-${dateKey}`,
    data: { url: '/' },
  };
};

const runScheduledNotifications = async (env) => {
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return;

  const subscriptions = await supabaseRequest(
    env,
    `${PUSH_TABLE}?user_phone=not.is.null&select=user_phone,endpoint,subscription,timezone,last_notification_key`
  );
  for (const record of subscriptions || []) {
    try {
      if (!record.user_phone || !isAllowedPushEndpoint(record.endpoint)) continue;
      const account = await getAccountByPhone(env, record.user_phone, 'account_number');
      if (!account?.account_number) continue;
      const cloudRecord = await getCloudRecord(env, account.account_number);
      const candidate = getDueCandidate(cloudRecord?.backup_payload, new Date(), record.timezone);
      if (!candidate || candidate.key === record.last_notification_key) continue;

      const result = await sendWebPush(env, record.subscription, candidate);
      if (result.expired) {
        await deleteSubscription(env, record.endpoint, record.user_phone);
      } else if (result.sent) {
        await supabaseRequest(env, `${PUSH_TABLE}?user_phone=eq.${encodeURIComponent(record.user_phone)}&endpoint=eq.${encodeURIComponent(record.endpoint)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ last_notification_key: candidate.key, updated_at: new Date().toISOString() }),
        });
      }
    } catch (error) {
      console.warn('[Push] Scheduled notification failed:', error?.name || 'unknown error');
    }
  }
};

const CORS_ORIGINS = new Set([
  'https://fazatak.pages.dev',
  'capacitor://localhost',
  'https://localhost',
  'http://localhost',
]);

const withCors = (response, request) => {
  const headers = new Headers(response.headers);
  const origin = request.headers.get('Origin');
  const isProjectPreview = /^https:\/\/[a-z0-9-]+\.fazatak\.pages\.dev$/.test(origin || '');
  const isLocalDevelopmentOrigin = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin || '');
  if (origin && (CORS_ORIGINS.has(origin) || isProjectPreview || isLocalDevelopmentOrigin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    headers.set('Access-Control-Max-Age', '600');
    headers.append('Vary', 'Origin');
  }
  return new Response(response.body, { status: response.status, headers });
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), request);
      try {
        let response;
        if (url.pathname === '/api/admin/backup-archive') response = await handleBackupArchiveApi(request, env);
        else if (url.pathname.startsWith('/api/push/')) response = await handlePushApi(request, env);
        else if (url.pathname.startsWith('/api/auth/')) response = await handleAuthApi(request, env);
        else if (url.pathname.startsWith('/api/sync/')) response = await handleSyncApi(request, env);
        else response = jsonResponse({ error: 'not_found' }, 404);
        return withCors(response, request);
      } catch (error) {
        console.error('[Worker API] Request failed:', error?.name || 'unknown error');
        return withCors(jsonResponse({ error: 'service_unavailable' }, 503), request);
      }
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runScheduledNotifications(env));
  },
};

export {
  handleAuthApi,
  handleBackupArchiveApi,
  handlePushApi,
  handleSyncApi,
  runScheduledNotifications,
  getDueCandidate,
  signSession,
};
