// Centralized REST API client for StudRide (D-002, D-004, D-013, D-014).
// Injects Authorization: Bearer <token> from localStorage, normalizes error payloads into ApiError,
// and notifies AuthContext when a protected call receives 401 UNAUTHORIZED or 403 ACCOUNT_SUSPENDED.

export const TOKEN_STORAGE_KEY = 'studride_jwt';

let authFailureListener = null;

export function setAuthFailureListener(listener) {
  authFailureListener = typeof listener === 'function' ? listener : null;
}

export class ApiError extends Error {
  constructor(statusCode, code, message, details = null) {
    super(message || 'A apărut o eroare la comunicarea cu serverul');
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code || 'API_ERROR';
    this.details = details;
  }
}

export function getStoredToken() {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token) {
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors in private browsing
  }
}

export async function apiRequest(
  path,
  { method = 'GET', body, token, signal, fetchFn = globalThis.fetch } = {},
) {
  const activeToken = token !== undefined ? token : getStoredToken();
  const headers = {
    Accept: 'application/json',
  };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (activeToken) {
    headers.Authorization = `Bearer ${activeToken}`;
  }

  let response;
  try {
    response = await fetchFn(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (networkErr) {
    if (networkErr?.name === 'AbortError') {
      throw networkErr;
    }
    throw new ApiError(0, 'NETWORK_ERROR', 'Conexiunea cu serverul StudRide a eșuat. Verifică rețeaua.');
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const apiErr = new ApiError(
      response.status,
      data?.error || 'API_ERROR',
      data?.message || `Eroare HTTP ${response.status}`,
      data?.details || null,
    );

    const isLoginEndpoint = path === '/api/auth/login' || path === '/api/auth/register';
    if (
      !isLoginEndpoint &&
      activeToken &&
      (apiErr.statusCode === 401 ||
        (apiErr.statusCode === 403 && apiErr.code === 'ACCOUNT_SUSPENDED'))
    ) {
      setStoredToken(null);
      if (authFailureListener) {
        authFailureListener(apiErr);
      }
    }

    throw apiErr;
  }

  return data;
}

export const authApi = {
  register: (payload, opts) =>
    apiRequest('/api/auth/register', { ...opts, method: 'POST', body: payload }),
  login: (payload, opts) =>
    apiRequest('/api/auth/login', { ...opts, method: 'POST', body: payload }),
  me: (opts) => apiRequest('/api/auth/me', { ...opts, method: 'GET' }),
};

export const geocodingApi = {
  search: (q, opts) => {
    const params = new URLSearchParams({ q: String(q).trim() });
    return apiRequest(`/api/geocoding/search?${params.toString()}`, { ...opts, method: 'GET' });
  },
  reverse: (lat, lng, opts) => {
    const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
    return apiRequest(`/api/geocoding/reverse?${params.toString()}`, { ...opts, method: 'GET' });
  },
};

export const ridesApi = {
  search: (query, opts) => {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        params.set(k, String(v));
      }
    });
    return apiRequest(`/api/rides?${params.toString()}`, { ...opts, method: 'GET' });
  },
  getDetails: (rideId, opts) =>
    apiRequest(`/api/rides/${encodeURIComponent(rideId)}`, { ...opts, method: 'GET' }),
  publish: (payload, opts) =>
    apiRequest('/api/rides', { ...opts, method: 'POST', body: payload }),
};

export const recurringRidesApi = {
  createRule: (payload, opts) =>
    apiRequest('/api/recurring-rides', { ...opts, method: 'POST', body: payload }),
};

export const usersApi = {
  getPublicProfileAndReviews: (userId, opts) =>
    apiRequest(`/api/users/${encodeURIComponent(userId)}/reviews`, { ...opts, method: 'GET' }),
};
