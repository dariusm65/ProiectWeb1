import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { apiRequest, ApiError, ridesApi, TOKEN_STORAGE_KEY } from '../src/api/client.js';
import { AuthProvider, useAuth } from '../src/context/AuthContext.jsx';
import { ThemeProvider, useTheme } from '../src/context/ThemeContext.jsx';
import { buildIsoTimestampFromDateAndTime } from '../src/domain/bucharestTime.js';

function AuthConsumer() {
  const { user, status, authError, fetchFn, logout } = useAuth();
  const triggerProtectedCall = async () => {
    try {
      await ridesApi.publish({ available_seats: 2, declared_trip_cost: 50, stops: [] }, { fetchFn });
    } catch {
      // handled via global authFailureListener
    }
  };
  return (
    <div>
      <span data-testid="auth-status">{status}</span>
      <span data-testid="auth-user">{user ? user.email : 'guest'}</span>
      {authError && <span data-testid="auth-error">{authError.code}:{authError.message}</span>}
      <button type="button" onClick={logout}>Logout</button>
      <button type="button" onClick={triggerProtectedCall}>ProtectedCall</button>
    </div>
  );
}

function ThemeConsumer() {
  const { theme, toggleTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme-val">{theme}</span>
      <button type="button" onClick={toggleTheme}>Comută</button>
    </div>
  );
}

describe('frontend API client, AuthContext & ThemeContext', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('apiRequest attaches Authorization Bearer header from localStorage and parses ApiError payloads', async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-token-123');
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({
        error: 'ACCOUNT_SUSPENDED',
        message: 'Account is suspended',
      }),
    });

    await expect(
      apiRequest('/api/auth/me', { fetchFn: fetchMock }),
    ).rejects.toMatchObject({
      name: 'ApiError',
      statusCode: 403,
      code: 'ACCOUNT_SUSPENDED',
      message: 'Account is suspended',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/auth/me');
    expect(init.headers.Authorization).toBe('Bearer jwt-token-123');
  });

  it('AuthContext hydrates user via GET /api/auth/me when a stored token is valid', async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'valid-jwt');
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        user: {
          id: 7,
          email: 'ioana@ulbsibiu.ro',
          full_name: 'Ioana Popescu',
          has_university_badge: true,
          gender: 'female',
          role: 'user',
        },
      }),
    });

    render(
      <AuthProvider fetchFn={fetchMock}>
        <AuthConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated');
    });
    expect(screen.getByTestId('auth-user')).toHaveTextContent('ioana@ulbsibiu.ro');
  });

  it('AuthContext clears token and surfaces ACCOUNT_SUSPENDED when GET /api/auth/me returns 403', async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'suspended-jwt');
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({
        error: 'ACCOUNT_SUSPENDED',
        message: 'Account is suspended',
      }),
    });

    render(
      <AuthProvider fetchFn={fetchMock}>
        <AuthConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent('unauthenticated');
    });
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    expect(screen.getByTestId('auth-error')).toHaveTextContent('ACCOUNT_SUSPENDED');
  });

  it('ThemeContext syncs data-theme on <html> and persists light/dark toggle', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('theme-val')).toHaveTextContent('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    await user.click(screen.getByRole('button', { name: 'Comută' }));
    expect(screen.getByTestId('theme-val')).toHaveTextContent('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem('studride_theme')).toBe('dark');
  });

  it('clears studride_jwt and resets AuthContext user when a mid-session protected API call receives 401 or 403 ACCOUNT_SUSPENDED', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'active-jwt');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          user: {
            id: 7,
            email: 'ioana@ulbsibiu.ro',
            full_name: 'Ioana Popescu',
            has_university_badge: true,
            gender: 'female',
            role: 'user',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({
          error: 'ACCOUNT_SUSPENDED',
          message: 'Account is suspended',
        }),
      });

    render(
      <AuthProvider fetchFn={fetchMock}>
        <AuthConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated');
    });

    await user.click(screen.getByRole('button', { name: 'ProtectedCall' }));

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent('unauthenticated');
    });
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    expect(screen.getByTestId('auth-error')).toHaveTextContent('ACCOUNT_SUSPENDED');
  });

  it('buildIsoTimestampFromDateAndTime computes DST-aware Europe/Bucharest offsets (+02:00 winter EET vs +03:00 summer EEST) and throws on invalid input (D-020)', () => {
    // Winter (December = EET, UTC+2): 16:30 Bucharest -> 14:30Z
    expect(buildIsoTimestampFromDateAndTime('2026-12-04', '16:30', 0)).toBe('2026-12-04T14:30:00.000Z');
    // Summer (July = EEST, UTC+3): 16:30 Bucharest -> 13:30Z
    expect(buildIsoTimestampFromDateAndTime('2026-07-15', '16:30', 0)).toBe('2026-07-15T13:30:00.000Z');
    // Invalid date throws RangeError instead of silently fabricating Date.now()
    expect(() => buildIsoTimestampFromDateAndTime('invalid-date', '16:30', 0)).toThrow(RangeError);
  });
});
