import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { TOKEN_STORAGE_KEY } from '../src/api/client.js';
import { AuthProvider } from '../src/context/AuthContext.jsx';
import { ThemeProvider } from '../src/context/ThemeContext.jsx';
import { Navbar } from '../src/components/Navbar.jsx';
import { AdminPage } from '../src/pages/AdminPage.jsx';
import { RideDetailsPage } from '../src/pages/RideDetailsPage.jsx';
import { PublicProfilePage } from '../src/pages/PublicProfilePage.jsx';
import { RideChatPage } from '../src/pages/RideChatPage.jsx';

const INTERNAL_ID_REGEX = /\b(D-\d{3}|DS-\d{3}|C-\d{3}|Q-\d{3}|PATTERN-|Slice \d)\b/;

const SAMPLE_ENRICHED_REPORTS = [
  {
    id: 101,
    reporter_id: 21,
    reported_user_id: 9,
    ride_id: 42,
    message_id: 555,
    reason: 'harassment',
    details: 'Limbaj neadecvat în grupul cursei',
    status: 'pending',
    resolved_by: null,
    resolved_at: null,
    created_at: '2026-12-04T11:00:00.000Z',
    reporter: { id: 21, full_name: 'Paula Pasager' },
    reported_user: {
      id: 9,
      full_name: 'Tudor Target',
      role: 'user',
      is_suspended: false,
    },
    ride: {
      id: 42,
      origin_name: 'Cluj-Napoca',
      destination_name: 'Sibiu',
      departure_time: '2026-12-04T16:00:00.000Z',
      status: 'active',
      driver_id: 9,
    },
    message: {
      id: 555,
      ride_id: 42,
      excerpt: 'Mesaj jignitor în chat',
      sender_id: 9,
      sender_name: 'Tudor Target',
    },
    resolved_by_name: null,
  },
];

const SAMPLE_MOD_USERS = [
  {
    id: 9,
    email: 'tudor@ulbsibiu.ro',
    full_name: 'Tudor Target',
    phone: '+40722000111',
    university_domain: 'ulbsibiu.ro',
    has_university_badge: true,
    role: 'user',
    gender: 'male',
    is_suspended: false,
    rating_average: 4.5,
    rating_count: 6,
    seriousness_score: 95,
    infraction_count: 1,
    has_recent_cancellation_badge: true,
    created_at: '2026-11-01T10:00:00.000Z',
  },
  {
    id: 2,
    email: 'moderator@studride.ro',
    full_name: 'Mara Moderator',
    phone: null,
    university_domain: 'ulbsibiu.ro',
    has_university_badge: true,
    role: 'moderator',
    gender: 'female',
    is_suspended: false,
    rating_average: 5.0,
    rating_count: 8,
    seriousness_score: 100,
    infraction_count: 0,
    has_recent_cancellation_badge: false,
    created_at: '2026-11-01T09:00:00.000Z',
  },
];

const SAMPLE_STATS = {
  total_users: 48,
  suspended_users: 1,
  university_validated_users: 41,
  total_rides: 29,
  active_rides: 14,
  cancelled_rides: 3,
  total_bookings: 64,
  confirmed_bookings: 51,
  total_reports: 5,
  pending_reports: 1,
  total_reviews: 37,
};

const SAMPLE_RIDE_DETAILS = {
  ride: {
    id: 42,
    driver_id: 9,
    origin_name: 'Cluj-Napoca',
    destination_name: 'Sibiu',
    departure_time: '2026-12-04T16:00:00.000Z',
    estimated_arrival_time: '2026-12-04T19:00:00.000Z',
    available_seats: 2,
    declared_trip_cost: 120,
    luggage_allowed: true,
    pets_allowed: false,
    smoking_allowed: false,
    women_only: false,
    status: 'active',
  },
  stops: [
    {
      id: 1,
      stop_order: 10,
      city_name: 'Cluj-Napoca',
      location_name: 'Gara Cluj',
      latitude: 46.77,
      longitude: 23.6,
      distance_from_origin_km: 0,
      estimated_arrival_time: '2026-12-04T16:00:00.000Z',
    },
    {
      id: 2,
      stop_order: 20,
      city_name: 'Sibiu',
      location_name: 'Gara Sibiu',
      latitude: 45.79,
      longitude: 24.15,
      distance_from_origin_km: 160,
      estimated_arrival_time: '2026-12-04T19:00:00.000Z',
    },
  ],
  segments: [
    { from_stop_id: 1, to_stop_id: 2, distance_km: 160, occupied_seats: 0, free_seats: 2, price_lei: 40 },
  ],
  driver: {
    id: 9,
    full_name: 'Tudor Target',
    has_university_badge: true,
    rating_average: 4.5,
    rating_count: 6,
    seriousness_score: 95,
    has_recent_cancellation_badge: true,
  },
  passengers: [],
};

describe('Slice 8: Admin & Moderation UI, Role-Based Navbar, and Shared ReportModal', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('blocks regular student users on /admin with 403 alert, hides Moderare link in Navbar, and makes zero /api/admin/* fetches', async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'user-jwt');

    const fetchMock = vi.fn().mockImplementation(async (url) => {
      if (url === '/api/auth/me') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            user: {
              id: 21,
              email: 'paula@stud.ubbcluj.ro',
              full_name: 'Paula Pasager',
              role: 'user',
              gender: 'female',
            },
          }),
        };
      }
      if (String(url).startsWith('/api/notifications')) {
        return { ok: true, status: 200, json: async () => ({ notifications: [], unread_count: 0 }) };
      }
      throw new Error(`Unexpected admin fetch by regular user: ${url}`);
    });

    const { container } = render(
      <MemoryRouter initialEntries={['/admin']}>
        <ThemeProvider>
          <AuthProvider fetchFn={fetchMock}>
            <Navbar />
            <Routes>
              <Route path="/admin" element={<AdminPage />} />
            </Routes>
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Permisiuni insuficiente/i);
    });
    expect(screen.queryByRole('link', { name: /Moderare/i })).not.toBeInTheDocument();

    const adminCalls = fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/admin'));
    expect(adminCalls).toHaveLength(0);
    expect(container.textContent).not.toMatch(INTERNAL_ID_REGEX);
  });

  it('allows moderator to view reports & users without calling admin-only /api/admin/stats or rendering role promotion controls', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'mod-jwt');

    const fetchMock = vi.fn().mockImplementation(async (url) => {
      if (url === '/api/auth/me') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            user: {
              id: 2,
              email: 'moderator@studride.ro',
              full_name: 'Mara Moderator',
              role: 'moderator',
              gender: 'female',
            },
          }),
        };
      }
      if (String(url).startsWith('/api/admin/reports')) {
        return { ok: true, status: 200, json: async () => ({ reports: SAMPLE_ENRICHED_REPORTS }) };
      }
      if (String(url).startsWith('/api/admin/users')) {
        return { ok: true, status: 200, json: async () => ({ users: SAMPLE_MOD_USERS }) };
      }
      if (String(url).startsWith('/api/notifications')) {
        return { ok: true, status: 200, json: async () => ({ notifications: [], unread_count: 0 }) };
      }
      throw new Error(`Unexpected fetch by moderator: ${url}`);
    });

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <ThemeProvider>
          <AuthProvider fetchFn={fetchMock}>
            <Navbar />
            <Routes>
              <Route path="/admin" element={<AdminPage />} />
            </Routes>
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Moderare/i })).toBeInTheDocument();
      expect(screen.getByText(/Hărțuire sau comportament abuziv/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Mesaj jignitor în chat/i)).toBeInTheDocument();

    // Moderator must not call /api/admin/stats
    const statsCalls = fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/admin/stats'));
    expect(statsCalls).toHaveLength(0);

    // Switch to Users tab: moderator sees suspend for regular user, but no role promotion buttons
    await user.click(screen.getByRole('tab', { name: /Utilizatori & Roluri/i }));
    await waitFor(() => {
      expect(screen.getByText('tudor@ulbsibiu.ro')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /Promovează moderator/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retrogradează la student/i })).not.toBeInTheDocument();
  });

  it('allows admin to view platform stats, resolve reports, cancel a reported ride, filter users, suspend with cascade confirmation, and promote roles', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'admin-jwt');

    let reportsState = [...SAMPLE_ENRICHED_REPORTS];
    let usersState = SAMPLE_MOD_USERS.map((u) => ({ ...u }));

    const fetchMock = vi.fn().mockImplementation(async (url, init = {}) => {
      if (url === '/api/auth/me') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            user: {
              id: 1,
              email: 'admin@studride.ro',
              full_name: 'Andrei Admin',
              role: 'admin',
              gender: 'male',
            },
          }),
        };
      }
      if (url === '/api/admin/stats') {
        return { ok: true, status: 200, json: async () => ({ stats: SAMPLE_STATS }) };
      }
      if (String(url).startsWith('/api/admin/reports') && (!init.method || init.method === 'GET')) {
        return { ok: true, status: 200, json: async () => ({ reports: reportsState }) };
      }
      if (url === '/api/admin/reports/101' && init.method === 'PATCH') {
        const body = JSON.parse(init.body);
        reportsState = reportsState.map((r) => (r.id === 101 ? { ...r, status: body.status } : r));
        return { ok: true, status: 200, json: async () => ({ report: reportsState[0] }) };
      }
      if (url === '/api/admin/rides/42/cancel' && init.method === 'POST') {
        reportsState = reportsState.map((r) =>
          r.id === 101 ? { ...r, ride: { ...r.ride, status: 'cancelled' } } : r,
        );
        return {
          ok: true,
          status: 200,
          json: async () => ({ cancelled_ride_id: 42, cancelled_bookings: 2, infraction_recorded: false }),
        };
      }
      if (String(url).startsWith('/api/admin/users') && (!init.method || init.method === 'GET')) {
        return { ok: true, status: 200, json: async () => ({ users: usersState }) };
      }
      if (url === '/api/admin/users/9/suspend' && init.method === 'POST') {
        usersState = usersState.map((u) => (u.id === 9 ? { ...u, is_suspended: true } : u));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            user: usersState.find((u) => u.id === 9),
            cancelled_rides: 1,
            cancelled_passenger_bookings: 2,
          }),
        };
      }
      if (url === '/api/admin/users/9/role' && init.method === 'PATCH') {
        const body = JSON.parse(init.body);
        usersState = usersState.map((u) => (u.id === 9 ? { ...u, role: body.role } : u));
        return {
          ok: true,
          status: 200,
          json: async () => ({ user: usersState.find((u) => u.id === 9) }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ notifications: [], unread_count: 0 }) };
    });

    const { container } = render(
      <MemoryRouter initialEntries={['/admin']}>
        <ThemeProvider>
          <AuthProvider fetchFn={fetchMock}>
            <Routes>
              <Route path="/admin" element={<AdminPage />} />
            </Routes>
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );

    // Summary stats & enriched report row
    await waitFor(() => {
      expect(screen.getByText('48')).toBeInTheDocument();
      expect(screen.getByText(/Hărțuire sau comportament abuziv/i)).toBeInTheDocument();
    });

    // Cancel ride via confirm modal
    await user.click(screen.getByRole('button', { name: /Anulează cursa/i }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/nu înregistrează penalizare de seriozitate/i)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Motiv transmis în notificare/i), 'Cursă duplicată abuzivă');
    await user.click(within(dialog).getByRole('button', { name: /Confirmă acțiunea/i }));

    await waitFor(() => {
      expect(screen.getByText(/fost anulată administrativ/i)).toBeInTheDocument();
    });

    // Resolve report
    await user.click(screen.getByRole('button', { name: /^Rezolvă$/i }));
    await waitFor(() => {
      expect(screen.getByText(/a fost marcată ca rezolvată/i)).toBeInTheDocument();
    });

    // Keyboard roving tab navigation (ArrowRight switches from Reports tab to Users tab)
    const reportsTab = screen.getByRole('tab', { name: /Coada de raportări/i });
    const usersTab = screen.getByRole('tab', { name: /Utilizatori & Roluri/i });
    expect(reportsTab).toHaveAttribute('tabindex', '0');
    expect(usersTab).toHaveAttribute('tabindex', '-1');
    reportsTab.focus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => {
      expect(usersTab).toHaveAttribute('aria-selected', 'true');
      expect(usersTab).toHaveAttribute('tabindex', '0');
      expect(screen.getByText('tudor@ulbsibiu.ro')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/Caută utilizator/i), 'Tudor');
    await user.click(screen.getByRole('button', { name: /Filtrează/i }));
    await waitFor(() => {
      const searchCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/admin/users?q=Tudor'));
      expect(searchCall).toBeDefined();
    });

    // Promote user to moderator
    await user.click(screen.getByRole('button', { name: /Promovează moderator/i }));
    await waitFor(() => {
      expect(screen.getByText(/a fost schimbat în Moderator/i)).toBeInTheDocument();
    });

    // Suspend user via confirmation dialog
    const suspendButtons = screen.getAllByRole('button', { name: /^Suspendă$/i });
    await user.click(suspendButtons[0]);
    const suspendDialog = screen.getByRole('dialog');
    expect(within(suspendDialog).getByText(/anulează în cascadă toate cursele viitoare/i)).toBeInTheDocument();
    await user.click(within(suspendDialog).getByRole('button', { name: /Confirmă acțiunea/i }));

    await waitFor(() => {
      expect(screen.getByText(/a fost suspendat \(curse viitoare anulate: 1/i)).toBeInTheDocument();
    });
    expect(container.textContent).not.toMatch(INTERNAL_ID_REGEX);
  });

  it('submits ride, user profile, and chat message reports through ReportModal, handles 409 duplicate pending error, and aborts PublicProfilePage on unmount', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'pax-jwt');

    let capturedProfileSignal = null;
    let forceDuplicate409 = false;

    const fetchMock = vi.fn().mockImplementation(async (url, init = {}) => {
      if (url === '/api/auth/me') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            user: {
              id: 21,
              email: 'paula@stud.ubbcluj.ro',
              full_name: 'Paula Pasager',
              role: 'user',
              gender: 'female',
            },
          }),
        };
      }
      if (url === '/api/rides/42') {
        return { ok: true, status: 200, json: async () => SAMPLE_RIDE_DETAILS };
      }
      if (url === '/api/users/9/reviews') {
        capturedProfileSignal = init.signal;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            user: SAMPLE_RIDE_DETAILS.driver,
            reviews: [],
          }),
        };
      }
      if (url === '/api/rides/42/messages' && (!init.method || init.method === 'GET')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            messages: [
              {
                id: 555,
                ride_id: 42,
                sender_id: 9,
                message_text: 'Salut, ne vedem la gară!',
                created_at: '2026-12-04T11:00:00.000Z',
                sender: { id: 9, full_name: 'Tudor Target', has_university_badge: true },
              },
              {
                id: 556,
                ride_id: 42,
                sender_id: 21,
                message_text: 'Mesajul meu propriu',
                created_at: '2026-12-04T11:02:00.000Z',
                sender: { id: 21, full_name: 'Paula Pasager', has_university_badge: true },
              },
            ],
          }),
        };
      }
      if (url === '/api/bookings/me') {
        return { ok: true, status: 200, json: async () => ({ bookings: [] }) };
      }
      if (url === '/api/reports' && init.method === 'POST') {
        if (forceDuplicate409) {
          return {
            ok: false,
            status: 409,
            json: async () => ({
              error: 'REPORT_ALREADY_PENDING',
              message: 'You already have a pending report for this target',
            }),
          };
        }
        const body = JSON.parse(init.body);
        return {
          ok: true,
          status: 201,
          json: async () => ({
            report: { id: 901, status: 'pending', ...body },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ notifications: [], unread_count: 0 }) };
    });

    // 1. RideDetailsPage reporting
    const { unmount: unmountRide } = render(
      <MemoryRouter initialEntries={['/rides/42']}>
        <ThemeProvider>
          <AuthProvider fetchFn={fetchMock}>
            <Routes>
              <Route path="/rides/:rideId" element={<RideDetailsPage />} />
            </Routes>
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Raportează cursa/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Raportează cursa/i }));

    const modal = screen.getByRole('dialog');
    await user.selectOptions(within(modal).getByLabelText(/Motivul raportării/i), 'unsafe_driving');
    await user.type(within(modal).getByLabelText(/Detalii suplimentare/i), 'Viteză excesivă pe A10');
    await user.click(within(modal).getByRole('button', { name: /Trimite raportarea/i }));

    await waitFor(() => {
      expect(screen.getByText(/Raportare înregistrată!/i)).toBeInTheDocument();
    });

    const rideReportCall = fetchMock.mock.calls.find(([u, i]) => u === '/api/reports' && i?.method === 'POST');
    expect(JSON.parse(rideReportCall[1].body)).toEqual({
      reported_user_id: 9,
      ride_id: 42,
      message_id: null,
      reason: 'unsafe_driving',
      details: 'Viteză excesivă pe A10',
    });
    unmountRide();

    // 2. PublicProfilePage reporting + 409 handling + AbortController on unmount
    forceDuplicate409 = true;
    const { unmount: unmountProfile } = render(
      <MemoryRouter initialEntries={['/profile/9']}>
        <ThemeProvider>
          <AuthProvider fetchFn={fetchMock}>
            <Routes>
              <Route path="/profile/:userId" element={<PublicProfilePage />} />
            </Routes>
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Raportează utilizatorul/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Raportează utilizatorul/i }));
    await user.click(screen.getByRole('button', { name: /Trimite raportarea/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Ai deja o raportare în așteptare/i);
    });
    unmountProfile();
    expect(capturedProfileSignal?.aborted).toBe(true);

    // 3. RideChatPage per-message reporting (only on other participant's message, never own)
    forceDuplicate409 = false;
    render(
      <MemoryRouter initialEntries={['/rides/42/chat']}>
        <ThemeProvider>
          <AuthProvider fetchFn={fetchMock}>
            <Routes>
              <Route path="/rides/:rideId/chat" element={<RideChatPage />} />
            </Routes>
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Salut, ne vedem la gară!')).toBeInTheDocument();
    });

    const reportBtns = screen.getAllByRole('button', { name: /Raportează mesajul/i });
    expect(reportBtns).toHaveLength(1);
    await user.click(reportBtns[0]);
    const chatReportModal = screen.getByRole('dialog');
    await user.selectOptions(within(chatReportModal).getByLabelText(/Motivul raportării/i), 'inappropriate_content');
    await user.click(within(chatReportModal).getByRole('button', { name: /Trimite raportarea/i }));

    await waitFor(() => {
      expect(screen.getByText(/Raportare înregistrată!/i)).toBeInTheDocument();
    });
  });
});
