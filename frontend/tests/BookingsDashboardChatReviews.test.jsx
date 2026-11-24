import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { TOKEN_STORAGE_KEY } from '../src/api/client.js';
import { AuthProvider } from '../src/context/AuthContext.jsx';
import { ThemeProvider } from '../src/context/ThemeContext.jsx';
import { Navbar } from '../src/components/Navbar.jsx';
import { RideDetailsPage } from '../src/pages/RideDetailsPage.jsx';
import { DashboardPage } from '../src/pages/DashboardPage.jsx';
import { RideChatPage } from '../src/pages/RideChatPage.jsx';

const INTERNAL_ID_REGEX = /\b(D-\d{3}|DS-\d{3}|C-\d{3}|Q-\d{3}|PATTERN-|Slice \d)\b/;

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
      city_name: 'Turda',
      location_name: 'Centru Turda',
      latitude: 46.57,
      longitude: 23.78,
      distance_from_origin_km: 32,
      estimated_arrival_time: '2026-12-04T16:35:00.000Z',
    },
    {
      id: 3,
      stop_order: 30,
      city_name: 'Sibiu',
      location_name: 'Gara Sibiu',
      latitude: 45.79,
      longitude: 24.15,
      distance_from_origin_km: 160,
      estimated_arrival_time: '2026-12-04T19:00:00.000Z',
    },
  ],
  segments: [
    { from_stop_id: 1, to_stop_id: 2, distance_km: 32, occupied_seats: 0, free_seats: 2, price_lei: 8 },
    { from_stop_id: 2, to_stop_id: 3, distance_km: 128, occupied_seats: 1, free_seats: 1, price_lei: 32 },
  ],
  driver: {
    id: 9,
    full_name: 'Dana Driver',
    has_university_badge: true,
    university_badge_note: 'domain-validated',
    rating_average: 4.8,
    rating_count: 14,
    seriousness_score: 100,
    has_recent_cancellation_badge: false,
  },
  passengers: [],
};

describe('Bookings, Passenger & Driver Dashboard, Ride Chat, Notifications & Mutual Reviews', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('submits real POST /api/rides/:rideId/bookings on RideDetailsPage and displays locked price confirmation', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'pax-jwt');

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
              gender: 'female',
              has_university_badge: true,
              role: 'user',
            },
          }),
        };
      }
      if (url === '/api/rides/42' && (!init.method || init.method === 'GET')) {
        return {
          ok: true,
          status: 200,
          json: async () => SAMPLE_RIDE_DETAILS,
        };
      }
      if (url === '/api/rides/42/bookings' && init.method === 'POST') {
        const body = JSON.parse(init.body);
        return {
          ok: true,
          status: 201,
          json: async () => ({
            booking: {
              id: 501,
              ride_id: 42,
              passenger_id: 21,
              pickup_stop_id: body.pickup_stop_id,
              dropoff_stop_id: body.dropoff_stop_id,
              pickup_stop_name: 'Centru Turda',
              dropoff_stop_name: 'Gara Sibiu',
              price_lei: 32,
              status: 'pending',
            },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ notifications: [], unread_count: 0 }) };
    });

    const { container } = render(
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
      expect(screen.getByText('Dana Driver')).toBeInTheDocument();
    });

    // Select pickup stop Turda (id=2) -> Sibiu (id=3)
    const pickupSelect = screen.getByLabelText(/Oprire de urcare/i);
    await user.selectOptions(pickupSelect, '2');

    await user.click(screen.getByRole('button', { name: /Solicită rezervare pe acest segment/i }));

    await waitFor(() => {
      expect(screen.getByText(/Cerere trimisă!/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Centru Turda → Gara Sibiu/i)).toBeInTheDocument();

    const bookingPostCall = fetchMock.mock.calls.find(
      ([u, i]) => u === '/api/rides/42/bookings' && i?.method === 'POST',
    );
    expect(bookingPostCall).toBeDefined();
    expect(JSON.parse(bookingPostCall[1].body)).toEqual({
      pickup_stop_id: 2,
      dropoff_stop_id: 3,
    });
    expect(container.textContent).not.toMatch(INTERNAL_ID_REGEX);
  });

  it('renders Passenger Dashboard bookings, reconfirms pending_reconfirmation, warns on < 4h late cancellation, and submits a post-ride review', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'pax-jwt');

    const twoHoursFromNowIso = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const fourHoursFromNowIso = new Date(Date.now() + 3.5 * 60 * 60 * 1000).toISOString();
    const pastDepartureIso = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    const pastArrivalIso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const mockBookings = [
      {
        id: 701,
        ride_id: 10,
        passenger_id: 21,
        pickup_stop_id: 2,
        dropoff_stop_id: 3,
        pickup_stop_name: 'Centru Turda',
        dropoff_stop_name: 'Gara Sibiu',
        pickup_stop_removed: false,
        dropoff_stop_removed: false,
        price_lei: 32,
        status: 'pending_reconfirmation',
        reconfirm_deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        cancellation_fee_lei: null,
        ride: {
          id: 10,
          driver_id: 9,
          driver_name: 'Dana Driver',
          driver_has_university_badge: true,
          origin_name: 'Cluj-Napoca',
          destination_name: 'Sibiu',
          departure_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          estimated_arrival_time: new Date(Date.now() + 27 * 60 * 60 * 1000).toISOString(),
          status: 'active',
          women_only: false,
        },
      },
      {
        id: 702,
        ride_id: 11,
        passenger_id: 21,
        pickup_stop_id: 4,
        dropoff_stop_id: 5,
        pickup_stop_name: 'Gara Sibiu',
        dropoff_stop_name: 'Gara Brașov',
        pickup_stop_removed: false,
        dropoff_stop_removed: false,
        price_lei: 40,
        status: 'confirmed',
        reconfirm_deadline: null,
        cancellation_fee_lei: null,
        ride: {
          id: 11,
          driver_id: 12,
          driver_name: 'Andrei Șofer',
          driver_has_university_badge: true,
          origin_name: 'Sibiu',
          destination_name: 'Brașov',
          departure_time: twoHoursFromNowIso,
          estimated_arrival_time: fourHoursFromNowIso,
          status: 'active',
          women_only: false,
        },
      },
      {
        id: 703,
        ride_id: 12,
        passenger_id: 21,
        pickup_stop_id: 6,
        dropoff_stop_id: 7,
        pickup_stop_name: 'Timișoara Complex',
        dropoff_stop_name: 'Gara Deva',
        pickup_stop_removed: false,
        dropoff_stop_removed: false,
        price_lei: 25,
        status: 'confirmed',
        reconfirm_deadline: null,
        cancellation_fee_lei: null,
        ride: {
          id: 12,
          driver_id: 15,
          driver_name: 'Radu Șofer',
          driver_has_university_badge: true,
          origin_name: 'Timișoara',
          destination_name: 'Deva',
          departure_time: pastDepartureIso,
          estimated_arrival_time: pastArrivalIso,
          status: 'completed',
          women_only: false,
        },
      },
    ];

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
              gender: 'female',
              has_university_badge: true,
              role: 'user',
            },
          }),
        };
      }
      if (url === '/api/bookings/me') {
        return { ok: true, status: 200, json: async () => ({ bookings: mockBookings }) };
      }
      if (url === '/api/rides/me') {
        return { ok: true, status: 200, json: async () => ({ rides: [] }) };
      }
      if (url === '/api/recurring-rides/me') {
        return { ok: true, status: 200, json: async () => ({ rules: [] }) };
      }
      if (url.startsWith('/api/notifications')) {
        return { ok: true, status: 200, json: async () => ({ notifications: [], unread_count: 2 }) };
      }
      if (url === '/api/bookings/701/reconfirm' && init.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ booking: { ...mockBookings[0], status: 'confirmed' } }),
        };
      }
      if (url === '/api/bookings/702/cancel' && init.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            booking: { ...mockBookings[1], status: 'cancelled', cancellation_fee_lei: 20 },
            infraction_recorded: true,
          }),
        };
      }
      if (url === '/api/rides/12/reviews' && init.method === 'POST') {
        const body = JSON.parse(init.body);
        return {
          ok: true,
          status: 201,
          json: async () => ({
            review: {
              id: 901,
              ride_id: 12,
              reviewer_id: 21,
              reviewed_user_id: body.reviewed_user_id,
              rating_stars: body.rating_stars,
              comment: body.comment,
            },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    const { container } = render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <ThemeProvider>
          <AuthProvider fetchFn={fetchMock}>
            <Navbar />
            <Routes>
              <Route path="/dashboard" element={<DashboardPage defaultTab="passenger" />} />
            </Routes>
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Centru Turda → Gara Sibiu/i)).toBeInTheDocument();
    });

    // Navbar displays unread badge count = 2
    expect(screen.getByTestId('navbar-unread-badge')).toHaveTextContent('2');

    // 1. Reconfirm pending_reconfirmation booking #701
    await user.click(screen.getByRole('button', { name: /Reconfirmă locul \(32 lei\)/i }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([u, i]) => u === '/api/bookings/701/reconfirm' && i?.method === 'POST'),
      ).toBe(true);
    });

    // 2. Click cancel on confirmed booking #702 (< 4h before departure) -> displays Romanian late-cancellation warning
    await user.click(screen.getByRole('button', { name: /Anulează rezervarea/i }));
    expect(
      screen.getByText(/anulare cu mai puțin de 4 ore înainte de plecare/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/3 puncte procentuale/i)).toBeInTheDocument();
    expect(screen.getAllByText(/20 lei/i).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /Confirmă anularea/i }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([u, i]) => u === '/api/bookings/702/cancel' && i?.method === 'POST'),
      ).toBe(true);
    });

    // 3. Open ReviewModal on completed booking #703 and submit 5-star review
    await user.click(screen.getByRole('button', { name: /★ Evaluează șoferul/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const commentBox = screen.getByLabelText(/Comentariu opțional/i);
    await user.type(commentBox, 'Drum foarte plăcut și șofer punctual!');
    await user.click(screen.getByRole('button', { name: /Trimite evaluarea/i }));

    await waitFor(() => {
      const reviewCall = fetchMock.mock.calls.find(
        ([u, i]) => u === '/api/rides/12/reviews' && i?.method === 'POST',
      );
      expect(reviewCall).toBeDefined();
      expect(JSON.parse(reviewCall[1].body)).toEqual({
        reviewed_user_id: 15,
        rating_stars: 5,
        comment: 'Drum foarte plăcut și șofer punctual!',
      });
    });

    expect(container.textContent).not.toMatch(INTERNAL_ID_REGEX);
  });

  it('renders Driver Dashboard published rides, accepts pending booking, edits stops, marks ride completed, and marks notifications read', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'driver-jwt');

    const mockDriverRide = {
      ride: {
        id: 88,
        driver_id: 9,
        origin_name: 'Cluj-Napoca',
        destination_name: 'Sibiu',
        departure_time: '2026-12-04T14:00:00.000Z',
        estimated_arrival_time: '2026-12-04T17:00:00.000Z',
        available_seats: 2,
        declared_trip_cost: 120,
        luggage_allowed: true,
        pets_allowed: false,
        smoking_allowed: false,
        women_only: false,
        status: 'active',
      },
      stops: SAMPLE_RIDE_DETAILS.stops,
      segments: SAMPLE_RIDE_DETAILS.segments,
      bookings: [
        {
          id: 801,
          ride_id: 88,
          passenger_id: 21,
          pickup_stop_id: 2,
          dropoff_stop_id: 3,
          pickup_stop_name: 'Centru Turda',
          dropoff_stop_name: 'Gara Sibiu',
          price_lei: 32,
          status: 'pending',
          passenger: {
            id: 21,
            full_name: 'Paula Pasager',
            has_university_badge: true,
          },
        },
      ],
    };

    const mockNotifs = [
      {
        id: 301,
        user_id: 9,
        type: 'booking_requested',
        title: 'Cerere nouă de rezervare',
        message: 'Paula Pasager a solicitat 1 loc pe segmentul Centru Turda → Gara Sibiu (32 lei).',
        is_read: false,
        created_at: '2026-12-01T10:00:00.000Z',
      },
    ];

    const fetchMock = vi.fn().mockImplementation(async (url, init = {}) => {
      if (url === '/api/auth/me') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            user: {
              id: 9,
              email: 'dana@ulbsibiu.ro',
              full_name: 'Dana Driver',
              gender: 'female',
              has_university_badge: true,
              role: 'user',
            },
          }),
        };
      }
      if (url === '/api/bookings/me') {
        return { ok: true, status: 200, json: async () => ({ bookings: [] }) };
      }
      if (url === '/api/rides/me') {
        return { ok: true, status: 200, json: async () => ({ rides: [mockDriverRide] }) };
      }
      if (url === '/api/recurring-rides/me') {
        return { ok: true, status: 200, json: async () => ({ rules: [] }) };
      }
      if (url.startsWith('/api/notifications') && (!init.method || init.method === 'GET')) {
        return { ok: true, status: 200, json: async () => ({ notifications: mockNotifs, unread_count: 1 }) };
      }
      if (url === '/api/bookings/801/accept' && init.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            booking: { ...mockDriverRide.bookings[0], status: 'confirmed' },
            auto_rejected_ids: [],
            kept_pending_ids: [],
          }),
        };
      }
      if (url === '/api/rides/88/stops' && init.method === 'PATCH') {
        return { ok: true, status: 200, json: async () => SAMPLE_RIDE_DETAILS };
      }
      if (url === '/api/rides/88/complete' && init.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ride: { ...mockDriverRide.ride, status: 'completed' } }),
        };
      }
      if (url === '/api/notifications/301/read' && init.method === 'PATCH') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ notification: { ...mockNotifs[0], is_read: true }, unread_count: 0 }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <ThemeProvider>
          <AuthProvider fetchFn={fetchMock}>
            <Routes>
              <Route path="/dashboard" element={<DashboardPage defaultTab="passenger" />} />
            </Routes>
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Cursele publicate ca șofer/i })).toBeInTheDocument();
    });

    // Switch to Driver tab
    await user.click(screen.getByRole('tab', { name: /Cursele publicate ca șofer/i }));
    expect(screen.getByText('Paula Pasager')).toBeInTheDocument();

    // Accept pending booking #801
    await user.click(screen.getByRole('button', { name: 'Acceptă' }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([u, i]) => u === '/api/bookings/801/accept' && i?.method === 'POST'),
      ).toBe(true);
    });

    // Open inline stop editor and save edited stops
    await user.click(screen.getByRole('button', { name: /Editează opririle/i }));
    await user.click(screen.getByRole('button', { name: /Salvează opririle actualizate/i }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([u, i]) => u === '/api/rides/88/stops' && i?.method === 'PATCH'),
      ).toBe(true);
    });

    // Mark ride completed
    await user.click(screen.getByRole('button', { name: /Marchează finalizată/i }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([u, i]) => u === '/api/rides/88/complete' && i?.method === 'POST'),
      ).toBe(true);
    });

    // Switch to Notifications tab and mark notification #301 read
    await user.click(screen.getByRole('tab', { name: /Notificări/i }));
    expect(screen.getByText('Cerere nouă de rezervare')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Marchează citită/i }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([u, i]) => u === '/api/notifications/301/read' && i?.method === 'PATCH'),
      ).toBe(true);
    });
  });

  it('renders RideChatPage messages safely without XSS and posts a new message via POST /api/rides/:rideId/messages', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'driver-jwt');

    const xssPayload = '<img src=x onerror=alert(1)> Salut din Turda!';
    const fetchMock = vi.fn().mockImplementation(async (url, init = {}) => {
      if (url === '/api/auth/me') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            user: {
              id: 9,
              email: 'dana@ulbsibiu.ro',
              full_name: 'Dana Driver',
              gender: 'female',
              has_university_badge: true,
              role: 'user',
            },
          }),
        };
      }
      if (url === '/api/rides/42') {
        return { ok: true, status: 200, json: async () => SAMPLE_RIDE_DETAILS };
      }
      if (url === '/api/rides/42/messages' && (!init.method || init.method === 'GET')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            messages: [
              {
                id: 1,
                ride_id: 42,
                sender_id: 21,
                message_text: xssPayload,
                created_at: '2026-12-04T15:30:00.000Z',
                sender: {
                  id: 21,
                  full_name: 'Paula Pasager',
                  has_university_badge: true,
                },
              },
            ],
          }),
        };
      }
      if (url === '/api/rides/42/messages' && init.method === 'POST') {
        const body = JSON.parse(init.body);
        return {
          ok: true,
          status: 201,
          json: async () => ({
            message: {
              id: 2,
              ride_id: 42,
              sender_id: 9,
              message_text: body.message_text,
              created_at: '2026-12-04T15:32:00.000Z',
              sender: {
                id: 9,
                full_name: 'Dana Driver',
                has_university_badge: true,
              },
            },
          }),
        };
      }
      if (url === '/api/bookings/me') {
        return { ok: true, status: 200, json: async () => ({ bookings: [] }) };
      }
      return { ok: true, status: 200, json: async () => ({ notifications: [], unread_count: 0 }) };
    });

    const { container } = render(
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
      expect(screen.getByText(xssPayload)).toBeInTheDocument();
    });

    // Zero XSS: <img src=x> is rendered as literal text, never as a DOM <img> element
    expect(container.querySelector('img')).toBeNull();

    const input = screen.getByLabelText(/Mesaj pentru participanții la cursă/i);
    await user.type(input, 'Ne vedem la ora 16:00 fix!');
    await user.click(screen.getByRole('button', { name: /Trimite mesajul/i }));

    await waitFor(() => {
      expect(screen.getByText('Ne vedem la ora 16:00 fix!')).toBeInTheDocument();
    });
    expect(container.textContent).not.toMatch(INTERNAL_ID_REGEX);
  });
});
