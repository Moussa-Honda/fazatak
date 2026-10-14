const AUTH_TOKEN_KEY = 'fazatak_session_token';
const configuredBaseUrl = String(import.meta.env?.VITE_API_BASE_URL || '').trim().replace(/\/$/, '');
const location = typeof window === 'undefined' ? null : window.location;
const nativeOrLocal = location && (
  location.protocol === 'capacitor:' || location.hostname === 'localhost'
);
const API_BASE_URL = configuredBaseUrl || (nativeOrLocal ? 'https://fazatak.pages.dev' : '');

export const getSessionToken = () => {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY) || '';
  } catch {
    return '';
  }
};

export const setSessionToken = (token) => {
  if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
  else localStorage.removeItem(AUTH_TOKEN_KEY);
};

export const apiRequest = async (path, { method = 'GET', body, token = getSessionToken() } = {}) => {
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (body !== undefined) headers.set('Content-Type', 'application/json');

  let response;
  try {
    response = await fetch(`${API_BASE_URL}/api/${path.replace(/^\//, '')}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw Object.assign(new Error('تعذر الاتصال بالخادم. تحقق من اتصال الإنترنت وحاول مجددًا.'), { code: 'network_error' });
  }

  let result = null;
  try {
    result = await response.json();
  } catch {}
  if (!response.ok) {
    const error = new Error(result?.error || 'service_unavailable');
    error.code = result?.error || 'service_unavailable';
    error.status = response.status;
    error.data = result;
    throw error;
  }
  return result;
};
