import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../src/context/AuthContext.jsx';
import { ThemeProvider } from '../src/context/ThemeContext.jsx';
import { SearchResultsPage } from '../src/pages/SearchResultsPage.jsx';
import { RideDetailsPage } from '../src/pages/RideDetailsPage.jsx';
import { PublicProfilePage } from '../src/pages/PublicProfilePage.jsx';

const SAMPLE_SEARCH_RIDE = {
  ride_id: 42,
  recurring_rule_id: null,
  origin_name: 'Cluj-Napoca',
  destination_name: 'Sibiu',
  departure_time: '2026-12-04T14:30:00.000Z',
  estimated_arrival_time: '2026-12-04T17:15:00.000Z',
  available_seats: 3,
  declared_trip_cost: 152,
  luggage_allowed: true,
  pets_allowed: false,
  smoking_allowed: false,
  women_only: true,
  driver: {
    id: 9,
    full_name: 'Ioana P.',
    has_university_badge: true,
    university_badge_note: 'domain-validated (not identity-verified; mailbox ownership unverified)',
    rating_average: 4.9,
    rating_count: 18,
    seriousness_score: 95,
    has_recent_cancellation_badge: true,
  },
  pickup_stop: {
    id: 101,
    stop_order: 10,
    city_name: 'Cluj-Napoca',
    location_name: 'Campus Hașdeu',
    latitude: 46.77,
    longitude: 23.6,
    distance_from_origin_km: 0,
    estimated_arrival_time: '2026-12-04T14:30:00.000Z',
  },
  dropoff_stop: {
    id: 104,
    stop_order: 40,
    city_name: 'Sibiu',
    location_name: 'Gara Mare',
    latitude: 45.79,
    longitude: 24.15,
    distance_from_origin_km: 168,
    estimated_arrival_time: '2026-12-04T17:15:00.000Z',
  },
  stops: [
    {
      id: 101,
      stop_order: 10,
      city_name: 'Cluj-Napoca',
      location_name: 'Campus Hașdeu',
      latitude: 46.77,
      longitude: 23.6,
      distance_from_origin_km: 0,
      estimated_arrival_time: '2026-12-04T14:30:00.000Z',
    },
    {
      id: 102,
      stop_order: 20,
      city_name: 'Turda',
      location_name: 'Centru Turda',
      latitude: 46.57,
      longitude: 23.78,
      distance_from_origin_km: 32,
      estimated_arrival_time: '2026-12-04T15:05:00.000Z',
    },
    {
      id: 104,
      stop_order: 40,
      city_name: 'Sibiu',
      location_name: 'Gara Mare',
      latitude: 45.79,
      longitude: 24.15,
      distance_from_origin_km: 168,
      estimated_arrival_time: '2026-12-04T17:15:00.000Z',
    },
  ],
  pickup_distance_km: 0.4,
  dropoff_distance_km: 0.3,
  free_seats: 2,
  price_lei: 38,
  segment_price_lei: 38,
};

describe('SearchResultsPage (DS-004), RideDetailsPage (DS-005) & PublicProfilePage (DS-010)', () => {
  it('renders search result cards with driver name, university badge, star rating, seriousness score, 30-day "Anulare recentă" badge, price_lei, and free seats', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ rides: [SAMPLE_SEARCH_RIDE] }),
    });

    render(
      <MemoryRouter initialEntries={['/rides?originLat=46.77&originLng=23.6&destLat=45.79&destLng=24.15&date=2026-12-04&radiusKm=1']}>
        <ThemeProvider>
          <AuthProvider fetchFn={fetchMock}>
            <Routes>
              <Route path="/rides" element={<SearchResultsPage />} />
            </Routes>
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Ioana P.')).toBeInTheDocument();
    });

    const uniBadge = screen.getByText(/Email universitar/i);
    expect(uniBadge).toBeInTheDocument();
    expect(uniBadge).toHaveAttribute(
      'title',
      'Validat pe baza domeniului de email universitar — nu implică verificarea identității',
    );
    expect(screen.getByText(/Anulare recentă/i)).toBeInTheDocument();
    expect(screen.getByText(/95% seriozitate/i)).toBeInTheDocument();
    expect(screen.getByText(/★ 4\.9/i)).toBeInTheDocument();
    expect(screen.getByText(/2 locuri libere/i)).toBeInTheDocument();
    expect(screen.getAllByText(/38/).length).toBeGreaterThan(0);
  });

  it('renders RideDetailsPage (DS-005) stop timeline with per-segment availability, dynamic segment prices, and driver reputation card', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
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
          university_badge_note: 'domain-validated (not identity-verified; mailbox ownership unverified)',
          rating_average: 4.8,
          rating_count: 14,
          seriousness_score: 100,
          has_recent_cancellation_badge: false,
        },
        passengers: [
          {
            full_name: 'Paul Passenger',
            has_university_badge: true,
            university_badge_note: 'domain-validated',
            pickup_stop_name: 'Centru Turda',
            dropoff_stop_name: 'Gara Sibiu',
          },
        ],
      }),
    });

    render(
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

    expect(screen.getByText(/100% seriozitate/i)).toBeInTheDocument();
    expect(screen.getByText(/8 lei/i)).toBeInTheDocument();
    expect(screen.getByText(/32 lei/i)).toBeInTheDocument();
    expect(screen.getByText('Paul Passenger')).toBeInTheDocument();
  });

  it('renders PublicProfilePage (DS-010) dual reputation and received reviews via GET /api/users/:userId/reviews', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        user: {
          id: 9,
          full_name: 'Dana Driver',
          has_university_badge: true,
          university_badge_note: 'domain-validated (not identity-verified; mailbox ownership unverified)',
          rating_average: 4.8,
          rating_count: 14,
          seriousness_score: 96,
          has_recent_cancellation_badge: true,
          created_at: '2026-11-01T10:00:00.000Z',
        },
        reviews: [
          {
            id: 1,
            ride_id: 42,
            reviewer_id: 12,
            reviewed_user_id: 9,
            rating_stars: 5,
            comment: 'Punctuală la oprirea din Turda!',
            created_at: '2026-11-20T18:00:00.000Z',
            reviewer: {
              id: 12,
              full_name: 'Paul Passenger',
              has_university_badge: true,
              university_badge_note: 'domain-validated',
            },
          },
        ],
      }),
    });

    render(
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
      expect(screen.getByRole('heading', { name: 'Dana Driver' })).toBeInTheDocument();
    });

    expect(screen.getByText(/96%/)).toBeInTheDocument();
    expect(screen.getByText(/Anulare recentă/i)).toBeInTheDocument();
    expect(screen.getByText(/Punctuală la oprirea din Turda!/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\b(D-\d{3}|DS-\d{3}|C-\d{3}|Q-\d{3}|PATTERN-|Slice \d)\b/);
  });

  it('never renders internal ledger or spec IDs in user-facing UI text across pages', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ rides: [SAMPLE_SEARCH_RIDE] }),
    });

    const { container } = render(
      <MemoryRouter initialEntries={['/rides?originLat=46.77&originLng=23.6&destLat=45.79&destLng=24.15&date=2026-12-04&radiusKm=1']}>
        <ThemeProvider>
          <AuthProvider fetchFn={fetchMock}>
            <Routes>
              <Route path="/rides" element={<SearchResultsPage />} />
            </Routes>
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Ioana P.')).toBeInTheDocument();
    });

    const internalIdPattern = /\b(D-\d{3}|DS-\d{3}|C-\d{3}|Q-\d{3}|PATTERN-|Slice \d)\b/;
    expect(container.textContent).not.toMatch(internalIdPattern);
    expect(document.title).not.toMatch(internalIdPattern);
    const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
    expect(metaDesc).not.toMatch(internalIdPattern);
  });
});
