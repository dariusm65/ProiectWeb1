import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/context/AuthContext.jsx';
import { ThemeProvider } from '../src/context/ThemeContext.jsx';
import { AuthPage } from '../src/pages/AuthPage.jsx';

function renderAuthPage(fetchMock = vi.fn()) {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <ThemeProvider>
        <AuthProvider fetchFn={fetchMock}>
          <AuthPage />
        </AuthProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe('AuthPage (DS-003)', () => {
  it('displays live Romanian university domain badge hint (D-004) as user types email', async () => {
    const user = userEvent.setup();
    renderAuthPage();

    const emailInput = screen.getByLabelText(/Adresă de email/i);
    await user.clear(emailInput);
    await user.type(emailInput, 'darius@stud.acs.upb.ro');

    expect(screen.getByRole('status')).toHaveTextContent(/✓ UPB București — Email universitar/i);
    expect(screen.getByRole('status')).toHaveTextContent(
      /Pe profil îți va apărea bifa „Email universitar” pe baza adresei de facultate \(fără verificare de buletin\)\./i,
    );

    await user.clear(emailInput);
    await user.type(emailInput, 'tester@gmail.com');
    expect(screen.getByRole('status')).toHaveTextContent(/Cont standard \(fără badge universitar\)/i);
  });

  it('shows inline validation errors when registration fields are invalid and submits POST /api/auth/register when valid', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        token: 'new-jwt-token',
        user: {
          id: 11,
          email: 'ioana@ulbsibiu.ro',
          full_name: 'Ioana Popescu',
          phone: '0722123456',
          university_domain: 'ulbsibiu.ro',
          has_university_badge: true,
          gender: 'female',
          role: 'user',
        },
      }),
    });

    renderAuthPage(fetchMock);

    const nameInput = screen.getByLabelText(/Nume complet/i);
    const emailInput = screen.getByLabelText(/Adresă de email/i);
    const passwordInput = screen.getByLabelText(/Parolă/i);

    await user.clear(nameInput);
    await user.clear(passwordInput);
    await user.type(passwordInput, 'short');
    await user.click(screen.getByRole('button', { name: /Creează cont StudRide/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/minim 2 caractere|minim 8 caractere/i);
    expect(fetchMock).not.toHaveBeenCalled();

    await user.type(nameInput, 'Ioana Popescu');
    await user.clear(emailInput);
    await user.type(emailInput, 'ioana@ulbsibiu.ro');
    await user.clear(passwordInput);
    await user.type(passwordInput, 'ParolaSigura123');
    await user.click(screen.getByLabelText(/Femeie/i));

    await user.click(screen.getByRole('button', { name: /Creează cont StudRide/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/auth/register');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({
      full_name: 'Ioana Popescu',
      email: 'ioana@ulbsibiu.ro',
      gender: 'female',
    });
  });

  it('switches to Login tab and submits POST /api/auth/login', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        token: 'login-jwt',
        user: {
          id: 5,
          email: 'andrei@stud.ubbcluj.ro',
          full_name: 'Andrei M.',
          has_university_badge: true,
          gender: 'male',
          role: 'user',
        },
      }),
    });

    renderAuthPage(fetchMock);

    await user.click(screen.getByRole('tab', { name: /Autentificare/i }));
    const emailInput = screen.getByLabelText(/Adresă de email/i);
    const passwordInput = screen.getByLabelText(/Parolă/i);

    await user.clear(emailInput);
    await user.type(emailInput, 'andrei@stud.ubbcluj.ro');
    await user.clear(passwordInput);
    await user.type(passwordInput, 'Parola1234!');

    await user.click(screen.getByRole('button', { name: /Intră în cont/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/login');
  });
});
