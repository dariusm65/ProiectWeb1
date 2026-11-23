import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { TOKEN_STORAGE_KEY } from '../src/api/client.js';
import { AuthProvider } from '../src/context/AuthContext.jsx';
import { ThemeProvider } from '../src/context/ThemeContext.jsx';
import { PublishRidePage } from '../src/pages/PublishRidePage.jsx';

function renderPublishWithUser(userProfile, extraHandler) {
  window.localStorage.setItem(TOKEN_STORAGE_KEY, 'driver-jwt');
  const fetchMock = vi.fn().mockImplementation(async (url, init) => {
    if (url === '/api/auth/me') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ user: userProfile }),
      };
    }
    if (extraHandler) {
      return extraHandler(url, init);
    }
    return {
      ok: true,
      status: 201,
      json: async () => ({ ride: { id: 77 }, rule: { id: 88 } }),
    };
  });

  render(
    <MemoryRouter initialEntries={['/publish']}>
      <ThemeProvider>
        <AuthProvider fetchFn={fetchMock}>
          <Routes>
            <Route path="/publish" element={<PublishRidePage />} />
            <Route path="/rides/:rideId" element={<div>Detalii Cursă Publicată</div>} />
          </Routes>
        </AuthProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );

  return { fetchMock };
}

describe('PublishRidePage (DS-006)', () => {
  it('disables women_only toggle for non-female drivers (D-018) and enables it for female drivers', async () => {
    renderPublishWithUser({
      id: 3,
      email: 'radu@ulbsibiu.ro',
      full_name: 'Radu D.',
      gender: 'male',
      has_university_badge: true,
      role: 'user',
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    });

    const womenCheckbox = screen.getByLabelText(/Cursă exclusiv pentru femei \(Women-only/i);
    expect(womenCheckbox).toBeDisabled();
  });

  it('previews live D-010 segment cost sharing and submits single and recurring rides', async () => {
    const user = userEvent.setup();
    const { fetchMock } = renderPublishWithUser({
      id: 4,
      email: 'ioana@ulbsibiu.ro',
      full_name: 'Ioana P.',
      gender: 'female',
      has_university_badge: true,
      role: 'user',
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/Cursă exclusiv pentru femei \(Women-only/i)).not.toBeDisabled();
    });

    // Live D-010 preview shows seat full price cap (default 120 lei / (2 + 1) = 40 lei)
    expect(screen.getByTestId('d010-seat-cap')).toHaveTextContent(/40 lei/i);

    // Enable women_only and submit single ride
    await user.click(screen.getByLabelText(/Cursă exclusiv pentru femei \(Women-only/i));
    await user.click(screen.getByRole('button', { name: /Publică cursa/i }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(([u]) => u === '/api/rides');
      expect(postCall).toBeDefined();
      const payload = JSON.parse(postCall[1].body);
      expect(payload.women_only).toBe(true);
      expect(payload.stops.length).toBeGreaterThanOrEqual(2);
      expect(payload.stops[0].distance_from_origin_km).toBe(0);
    });
  });

  it('switches to recurring mode and submits POST /api/recurring-rides with days_of_week and estimated_offset_minutes', async () => {
    const user = userEvent.setup();
    const { fetchMock } = renderPublishWithUser({
      id: 4,
      email: 'ioana@ulbsibiu.ro',
      full_name: 'Ioana P.',
      gender: 'female',
      has_university_badge: true,
      role: 'user',
    });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Cursă recurentă/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('tab', { name: /Cursă recurentă/i }));
    await user.click(screen.getByRole('button', { name: /Publică regula recurentă/i }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(([u]) => u === '/api/recurring-rides');
      expect(postCall).toBeDefined();
      const payload = JSON.parse(postCall[1].body);
      expect(Array.isArray(payload.days_of_week)).toBe(true);
      expect(payload.days_of_week.length).toBeGreaterThanOrEqual(1);
      expect(payload.stops[0].estimated_offset_minutes).toBe(0);
    });
  });
});
