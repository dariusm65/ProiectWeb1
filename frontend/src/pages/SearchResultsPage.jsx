import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ridesApi } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import {
  UniversityBadge,
  WomenOnlyBadge,
  RecentCancellationBadge,
  ReputationRow,
} from '../components/Badges.jsx';
import { GeocodeAutocomplete } from '../components/GeocodeAutocomplete.jsx';
import { RouteMap } from '../components/RouteMap.jsx';
import {
  formatBucharestTime,
  KNOWN_SURVEY_PLACES,
  resolveKnownSurveyPlace,
} from '../domain/bucharestTime.js';
import { useDocumentMeta } from '../hooks/useDocumentMeta.js';

export function SearchResultsPage() {
  useDocumentMeta({
    title: 'StudRide · Rezultate Căutare Curse & Hartă Segmente',
    description:
      'Compară cursele studențești disponibile pe segmentul tău, cu preț proporțional în lei, scor de seriozitate, rating și badge universitar pe domeniu.',
  });

  const { fetchFn } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [originText, setOriginText] = useState(
    searchParams.get('originLabel') || 'Sibiu (Gara Mare Sibiu)',
  );
  const [destText, setDestText] = useState(
    searchParams.get('destLabel') || 'Cluj-Napoca (Campus Hașdeu)',
  );
  const [originCoords, setOriginCoords] = useState({
    lat: Number(searchParams.get('originLat') || KNOWN_SURVEY_PLACES[4].latitude),
    lng: Number(searchParams.get('originLng') || KNOWN_SURVEY_PLACES[4].longitude),
  });
  const [destCoords, setDestCoords] = useState({
    lat: Number(searchParams.get('destLat') || KNOWN_SURVEY_PLACES[0].latitude),
    lng: Number(searchParams.get('destLng') || KNOWN_SURVEY_PLACES[0].longitude),
  });
  const [date, setDate] = useState(searchParams.get('date') || '');
  const [radiusKm, setRadiusKm] = useState(Number(searchParams.get('radiusKm') || 1));
  const [womenOnly, setWomenOnly] = useState(searchParams.get('womenOnly') === 'true');
  const [universityOnly, setUniversityOnly] = useState(searchParams.get('universityOnly') === 'true');
  const [reloadNonce, setReloadNonce] = useState(0);

  const [rides, setRides] = useState([]);
  const [selectedRideId, setSelectedRideId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    async function executeSearch() {
      setLoading(true);
      setError('');
      try {
        const query = {
          originLat: originCoords.lat,
          originLng: originCoords.lng,
          destLat: destCoords.lat,
          destLng: destCoords.lng,
          radiusKm,
        };
        if (date) query.date = date;
        if (womenOnly) query.womenOnly = 'true';
        if (universityOnly) query.universityOnly = 'true';

        const data = await ridesApi.search(query, {
          signal: controller.signal,
          fetchFn,
        });
        if (controller.signal.aborted) return;
        const list = Array.isArray(data?.rides) ? data.rides : [];
        setRides(list);
        setSelectedRideId(list.length > 0 ? list[0].ride_id : null);
      } catch (err) {
        if (controller.signal.aborted || err?.name === 'AbortError') return;
        setError(err.message || 'Eroare la căutarea segmentelor disponibile.');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    executeSearch();
    return () => {
      controller.abort();
    };
  }, [
    originCoords.lat,
    originCoords.lng,
    destCoords.lat,
    destCoords.lng,
    date,
    radiusKm,
    womenOnly,
    universityOnly,
    reloadNonce,
    fetchFn,
  ]);

  const handleManualSearchClick = () => {
    const matchedOrigin = resolveKnownSurveyPlace(originText);
    const matchedDest = resolveKnownSurveyPlace(destText);
    const nextOrigin = matchedOrigin
      ? { lat: matchedOrigin.latitude, lng: matchedOrigin.longitude }
      : originCoords;
    const nextDest = matchedDest
      ? { lat: matchedDest.latitude, lng: matchedDest.longitude }
      : destCoords;

    setOriginCoords(nextOrigin);
    setDestCoords(nextDest);

    const nextParams = {
      originLat: String(nextOrigin.lat),
      originLng: String(nextOrigin.lng),
      destLat: String(nextDest.lat),
      destLng: String(nextDest.lng),
      originLabel: originText,
      destLabel: destText,
      radiusKm: String(radiusKm),
    };
    if (date) nextParams.date = date;
    if (womenOnly) nextParams.womenOnly = 'true';
    if (universityOnly) nextParams.universityOnly = 'true';
    setSearchParams(nextParams);
  };

  const selectedRide = rides.find((r) => r.ride_id === selectedRideId) || rides[0] || null;
  const totalDistKm =
    selectedRide?.stops?.length > 1
      ? selectedRide.stops[selectedRide.stops.length - 1].distance_from_origin_km
      : (selectedRide?.dropoff_stop?.distance_from_origin_km ?? 168);
  const segmentDistKm = selectedRide
    ? Math.max(
        1,
        (selectedRide.dropoff_stop?.distance_from_origin_km ?? totalDistKm) -
          (selectedRide.pickup_stop?.distance_from_origin_km ?? 0),
      )
    : 168;
  const declaredTripCost = selectedRide?.declared_trip_cost ?? 152;
  const availableSeats = selectedRide?.available_seats ?? 3;
  const seatFullPrice = Math.round(declaredTripCost / (availableSeats + 1));

  return (
    <>
      <section className="search-section" aria-label="Filtre căutare curse">
        <div className="search-container">
          <div className="search-grid">
            <GeocodeAutocomplete
              id="search-origin"
              label="Plecare (Origine)"
              value={originText}
              onChange={setOriginText}
              onSelectPlace={(p) => setOriginCoords({ lat: p.latitude, lng: p.longitude })}
            />
            <GeocodeAutocomplete
              id="search-dest"
              label="Destinație"
              value={destText}
              onChange={setDestText}
              onSelectPlace={(p) => setDestCoords({ lat: p.latitude, lng: p.longitude })}
            />
            <div className="field">
              <label htmlFor="search-date">Data plecării (opțional)</label>
              <input
                id="search-date"
                type="date"
                className="input"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleManualSearchClick}
            >
              Caută curse
            </button>
          </div>

          <div className="search-footer">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }} role="group" aria-label="Rază de căutare">
              <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-muted)' }}>
                Rază de căutare:
              </span>
              {[
                { val: 1, label: '1 km (Implicit)' },
                { val: 3, label: '3 km' },
                { val: 5, label: '5 km' },
              ].map((r) => (
                <button
                  key={r.val}
                  type="button"
                  aria-pressed={radiusKm === r.val}
                  className={radiusKm === r.val ? 'chip-btn active' : 'chip-btn'}
                  onClick={() => setRadiusKm(r.val)}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: 'var(--font-size-xs)', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={womenOnly}
                  onChange={(e) => setWomenOnly(e.target.checked)}
                />
                <span>Doar curse pentru femei (Women-only)</span>
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: 'var(--font-size-xs)', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={universityOnly}
                  onChange={(e) => setUniversityOnly(e.target.checked)}
                />
                <span>Doar șoferi validați universitar</span>
              </label>
            </div>
          </div>
        </div>
      </section>

      <div className="main-layout">
        <section className="results-column" aria-label="Lista de curse disponibile">
          <div className="results-header">
            <h1 className="results-count">
              {loading
                ? 'Se caută segmente disponibile...'
                : rides.length === 1
                  ? '1 cursă disponibilă'
                  : `${rides.length} curse disponibile`}
            </h1>
            <span className="tabular" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
              Rază activă: {radiusKm} km · 1 loc / pasager
            </span>
          </div>

          {error && (
            <div className="status-banner error" role="alert">
              <div>
                <strong>Eroare la căutarea segmentelor:</strong> {error}
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => setReloadNonce((n) => n + 1)}
              >
                Reîncearcă
              </button>
            </div>
          )}

          {!loading && !error && rides.length === 0 && (
            <div className="card" style={{ textAlign: 'center', alignItems: 'center' }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-lg)' }}>
                Nicio cursă găsită pe acest segment
              </h2>
              <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', maxWidth: '46ch' }}>
                Nu există șoferi disponibili {date ? `pe ${date}` : 'în perioada următoare'} în raza de {radiusKm} km.
                Încearcă să extinzi raza de căutare la 3 km sau 5 km pentru a include opririle apropiate.
              </p>
              <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setRadiusKm(3)}
                >
                  Extinde la 3 km
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setRadiusKm(5)}
                >
                  Extinde la 5 km
                </button>
              </div>
            </div>
          )}

          {rides.map((ride) => {
            const priceLei = ride.price_lei ?? ride.segment_price_lei;
            const stopsList =
              Array.isArray(ride.stops) && ride.stops.length >= 2
                ? ride.stops
                : [ride.pickup_stop, ride.dropoff_stop].filter(Boolean);
            const initials = String(ride.driver?.full_name || 'SR')
              .split(' ')
              .map((w) => w[0])
              .join('')
              .slice(0, 2)
              .toUpperCase();

            return (
              <article
                key={ride.ride_id}
                className={selectedRide?.ride_id === ride.ride_id ? 'ticket-card selected' : 'ticket-card'}
                onClick={() => setSelectedRideId(ride.ride_id)}
              >
                <div className="ticket-main">
                  <div className="driver-row">
                    <div className="driver-meta">
                      <div className="driver-avatar" aria-hidden="true">
                        {initials}
                      </div>
                      <div>
                        <div className="driver-name-line">
                          <Link
                            to={`/profile/${ride.driver?.id}`}
                            style={{ fontWeight: 700, fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', textDecoration: 'none' }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {ride.driver?.full_name}
                          </Link>
                          <UniversityBadge
                            hasBadge={ride.driver?.has_university_badge}
                            note={ride.driver?.university_badge_note}
                          />
                          <WomenOnlyBadge womenOnly={ride.women_only} />
                          <RecentCancellationBadge
                            hasRecentCancellation={ride.driver?.has_recent_cancellation_badge}
                          />
                        </div>
                        <ReputationRow
                          ratingAverage={ride.driver?.rating_average ?? null}
                          ratingCount={ride.driver?.rating_count ?? 0}
                          seriousnessScore={ride.driver?.seriousness_score ?? 100}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="route-arc-row">
                    <div className="endpoint">
                      <span className="ep-time">{formatBucharestTime(ride.pickup_stop?.estimated_arrival_time || ride.departure_time)}</span>
                      <span className="ep-city">{ride.pickup_stop?.city_name || ride.origin_name}</span>
                      <span className="ep-landmark">{ride.pickup_stop?.location_name}</span>
                    </div>

                    <div className="arc-middle">
                      <span className="arc-meta">
                        {stopsList.length} opriri · {ride.dropoff_stop?.distance_from_origin_km ?? 0} km
                      </span>
                      <svg className="arc-svg" viewBox="0 0 180 26" fill="none" aria-hidden="true">
                        <path
                          d="M8 20 Q 90 -4 172 20"
                          stroke="var(--color-primary)"
                          strokeWidth="2"
                          strokeDasharray="4 4"
                        />
                        <circle cx="8" cy="20" r="6.5" fill="var(--color-node-terminal-ring)" />
                        <circle cx="8" cy="20" r="3.8" fill="var(--color-node-terminal)" />
                        <circle cx="90" cy="8" r="3" fill="var(--color-node-intermediate)" />
                        <circle cx="172" cy="20" r="6.5" fill="var(--color-node-terminal-ring)" />
                        <circle cx="172" cy="20" r="3.8" fill="var(--color-node-terminal)" />
                      </svg>
                    </div>

                    <div className="endpoint right">
                      <span className="ep-time">
                        {formatBucharestTime(ride.dropoff_stop?.estimated_arrival_time || ride.estimated_arrival_time)}
                      </span>
                      <span className="ep-city">{ride.dropoff_stop?.city_name || ride.destination_name}</span>
                      <span className="ep-landmark">{ride.dropoff_stop?.location_name}</span>
                    </div>
                  </div>

                  <details className="stops-details" onClick={(e) => e.stopPropagation()}>
                    <summary>Vezi opririle intermediare ({stopsList.length} opriri)</summary>
                    <div className="stops-list">
                      {stopsList.map((s, idx) => (
                        <div key={s.id || idx} className="stop-item">
                          <strong>{formatBucharestTime(s.estimated_arrival_time)}</strong>
                          <span className={idx === 0 || idx === stopsList.length - 1 ? 'stop-dot key' : 'stop-dot'} />
                          <span>
                            <strong>{s.city_name}</strong> · {s.location_name}
                          </span>
                          <span>{s.distance_from_origin_km} km</span>
                        </div>
                      ))}
                    </div>
                  </details>

                  <div className="ticket-meta-foot">
                    <span>
                      Disponibilitate segment:{' '}
                      <strong style={{ color: 'var(--color-success)' }}>
                        {ride.free_seats} {ride.free_seats === 1 ? 'loc liber' : 'locuri libere'} din {ride.available_seats}
                      </strong>
                    </span>
                    <span>
                      {ride.luggage_allowed ? 'Bagaj acceptat' : 'Fără bagaj'} ·{' '}
                      {ride.smoking_allowed ? 'Fumat permis' : 'Fără fumat'} ·{' '}
                      {ride.pets_allowed ? 'Animale acceptate' : 'Fără animale'}
                    </span>
                  </div>
                </div>

                <div className="ticket-stub">
                  <span className="stub-kicker">Preț segment</span>
                  <div className="stub-price">
                    <span className="stub-amount">{priceLei}</span>
                    <span className="stub-currency">lei</span>
                  </div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                    1 loc / pasager
                    <br />
                    Cost împărțit echitabil
                  </span>
                  <Link
                    to={`/rides/${ride.ride_id}`}
                    className="btn btn-primary"
                    style={{ width: '100%', fontSize: 'var(--font-size-xs)' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    Detalii &amp; Rezervă
                  </Link>
                </div>
              </article>
            );
          })}
        </section>

        <aside className="map-column" aria-label="Hartă traseu și defalcare cost">
          <RouteMap
            title={
              selectedRide
                ? `${selectedRide.origin_name} → ${selectedRide.destination_name}`
                : 'România · Coridor Studențesc'
            }
            subtitle={
              selectedRide
                ? `${totalDistKm} km · Șofer: ${selectedRide.driver?.full_name}`
                : 'Selectează o cursă pentru a vedea opririle'
            }
            radiusKm={radiusKm}
            stops={selectedRide?.stops || []}
          />

          <section className="fuel-box" aria-labelledby="fuel-heading">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2
                id="fuel-heading"
                style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-base)', fontWeight: 700 }}
              >
                Împărțire transparentă cost
              </h2>
              <span className="badge badge-uni">Fără profit</span>
            </div>
            <div className="fuel-row">
              <span>Cost total declarat al cursei</span>
              <strong>{declaredTripCost} lei</strong>
            </div>
            <div className="fuel-row">
              <span>Împărțire egală (locuri oferite + șofer)</span>
              <strong>
                {availableSeats} + 1 = {availableSeats + 1} părți
              </strong>
            </div>
            <div className="fuel-row">
              <span>Preț loc rută completă (plafon)</span>
              <strong>{seatFullPrice} lei / loc</strong>
            </div>
            <div className="fuel-row">
              <span>
                Segment selectat ({segmentDistKm} / {totalDistKm} km)
              </span>
              <strong style={{ color: 'var(--color-primary-ink)' }}>
                {selectedRide ? selectedRide.price_lei ?? selectedRide.segment_price_lei : 38} lei
              </strong>
            </div>
            <div className="fuel-formula">
              Calcul transparent: <strong>{declaredTripCost} lei / ({availableSeats} + 1)</strong>. Suma tuturor pasagerilor
              nu depășește niciodată costul declarat de șofer.
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
