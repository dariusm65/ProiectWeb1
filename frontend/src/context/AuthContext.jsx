import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { authApi, getStoredToken, setStoredToken } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children, fetchFn = globalThis.fetch }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => getStoredToken());
  const [status, setStatus] = useState(() => (getStoredToken() ? 'loading' : 'unauthenticated'));
  const [authError, setAuthError] = useState(null);

  const hydrateMe = useCallback(
    async (activeToken) => {
      if (!activeToken) {
        setUser(null);
        setStatus('unauthenticated');
        return;
      }
      setStatus('loading');
      try {
        const res = await authApi.me({ token: activeToken, fetchFn });
        setUser(res.user);
        setAuthError(null);
        setStatus('authenticated');
      } catch (err) {
        setStoredToken(null);
        setToken(null);
        setUser(null);
        setStatus('unauthenticated');
        if (err?.statusCode === 403 && err?.code === 'ACCOUNT_SUSPENDED') {
          setAuthError(err);
        } else if (err?.statusCode === 401) {
          setAuthError(null);
        } else {
          setAuthError(err);
        }
      }
    },
    [fetchFn],
  );

  useEffect(() => {
    const initialToken = getStoredToken();
    if (initialToken) {
      hydrateMe(initialToken);
    } else {
      setStatus('unauthenticated');
    }
  }, [hydrateMe]);

  const login = async (credentials) => {
    setAuthError(null);
    const res = await authApi.login(credentials, { fetchFn });
    setStoredToken(res.token);
    setToken(res.token);
    setUser(res.user);
    setStatus('authenticated');
    return res.user;
  };

  const register = async (payload) => {
    setAuthError(null);
    const res = await authApi.register(payload, { fetchFn });
    setStoredToken(res.token);
    setToken(res.token);
    setUser(res.user);
    setStatus('authenticated');
    return res.user;
  };

  const logout = () => {
    setStoredToken(null);
    setToken(null);
    setUser(null);
    setAuthError(null);
    setStatus('unauthenticated');
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        status,
        authError,
        fetchFn,
        login,
        register,
        logout,
        refreshMe: () => hydrateMe(token),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside an AuthProvider');
  }
  return ctx;
}
