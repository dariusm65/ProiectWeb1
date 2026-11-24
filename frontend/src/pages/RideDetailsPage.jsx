import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { emitNotificationsRefresh, ridesApi } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import {
  UniversityBadge,
  WomenOnlyBadge,
  RecentCancellationBadge,
  ReputationRow,
} from '../components/Badges.jsx';
import { RouteMap } from '../components/RouteMap.jsx';
import { calculateSegmentPrice } from '../domain/segmentPricing.js';
import { formatBucharestDate, formatBucharestTime } from '../domain/bucharestTime.js';
import { useDocumentMeta } from '../hooks/useDocumentMeta.js';

export function RideDetailsPage() {
  const { rideId } = useParams();
  const navigate = useNavigate();
  const { user, fetchFn } = useAuth();

  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pickupStopId, setPickupStopId] = useState(null);
  const [dropoffStopId, setDropoffStopId] = useState(null);
  const [submittingBooking, setSubmittingBooking] = useState(false);
  const [bookingError, setBookingError] = useState('');
  const [createdBooking, setCreatedBooking] = useState(null);
  const activeControllerRef = useRef(null);

  useDocumentMeta({
    title: details
      ? `StudRide · Cursă ${details.ride.origin_name} → ${details.ride.destination_name}`
      : 'StudRide · Detalii Cursă & Segmente',
    description:
      'Cronologia opririlor intermediare, disponibilitatea locurilor pe fiecare segment, prețul proporțional și reputația șoferului.',
  });

  const loadDetails = useCallback(
    async (preserveStops = false) => {
      if (activeControllerRef.current) {
        activeControllerRef.current.abort();
      }
      const controller = new AbortController();
      activeControllerRef.current = controller;
      const { signal } = controller;

      if (!preserveStops) {
        setLoading(true);
      }
      setError('');
      try {
        const data = await ridesApi.getDetails(rideId, { fetchFn, signal });
        if (signal.aborted) return;
        setDetails(data);
        if (!preserveStops && data?.stops?.length >= 2) {
          setPickupStopId(data.stops[0].id);
          setDropoffStopId(data.stops[data.stops.length - 1].id);
        }
      } catch (err) {
        if (signal.aborted || err?.name === 'AbortError') return;
        setError(err.message || 'Cursa nu a putut fi încărcată.');
      } finally {
        if (!signal.aborted) {
          setLoading(false);
        }
      }
    },
    [rideId, fetchFn],
  );

  useEffect(() => {
    loadDetails(false);
    return () => {
      if (activeControllerRef.current) {
        activeControllerRef.current.abort();
      }
    };
  }, [loadDetails]);

  if (loading) {
    return (
      <div className="main-layout">
        <div className="card">
          <h1>Se încarcă detaliile cursei...</h1>
        </div>
      </div>
    );
  }

  if (error || !details) {
    return (
      <div className="main-layout">
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-xl)' }}>
            Detaliile cursei nu sunt disponibile
          </h1>
          <div className="status-banner error" role="alert">
            <div>
              <strong>Eroare:</strong> {error || 'Cursa nu a fost găsită.'}
            </div>
            <Link to="/rides" className="btn">
              Înapoi la căutare
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const { ride, stops = [], segments = [], driver, passengers = [] } = details;
  const totalDistKm = stops.length > 0 ? stops[stops.length - 1].distance_from_origin_km : 1;
  const pickupStop = stops.find((s) => s.id === Number(pickupStopId)) || stops[0];
  const dropoffStop =
    stops.find((s) => s.id === Number(dropoffStopId)) || stops[stops.length - 1];

  const dynamicPriceLei =
    pickupStop && dropoffStop && pickupStop.stop_order < dropoffStop.stop_order
      ? calculateSegmentPrice({
          declaredTripCost: ride.declared_trip_cost,
          availableSeats: ride.available_seats,
          pickupDistKm: pickupStop.distance_from_origin_km,
          dropoffDistKm: dropoffStop.distance_from_origin_km,
          totalDistKm,
        })
      : 0;

  // Compute minimum free seats across elementary segments between pickupStop and dropoffStop
  const stopOrderById = new Map(stops.map((s) => [s.id, s.stop_order]));
  const traversedSegments = segments.filter((seg) => {
    const fromOrder = stopOrderById.get(seg.from_stop_id);
    const toOrder = stopOrderById.get(seg.to_stop_id);
    if (fromOrder === undefined || toOrder === undefined || !pickupStop || !dropoffStop) {
      return false;
    }
    return fromOrder >= pickupStop.stop_order && toOrder <= dropoffStop.stop_order;
  });
  const minFreeSeatsOnSelection =
    traversedSegments.length > 0
      ? Math.min(...traversedSegments.map((s) => Number(s.free_seats ?? 0)))
      : Number(ride.available_seats ?? 0);

  const isDriverOfRide = Boolean(user && Number(user.id) === Number(ride.driver_id));
  const isWomenOnlyBlocked = Boolean(user && ride.women_only && user.gender !== 'female');
  const isSegmentFull = minFreeSeatsOnSelection < 1;
  const isRideInactive = ride.status !== 'active';

  const handleBookingSubmit = async () => {
    setBookingError('');
    setCreatedBooking(null);

    if (!user) {
      navigate('/login');
      return;
    }
    if (isDriverOfRide) {
      setBookingError('Nu poți rezerva un loc pe propria ta cursă.');
      return;
    }
    if (isWomenOnlyBlocked) {
      setBookingError('Această cursă este destinată exclusiv femeilor.');
      return;
    }
    if (!pickupStop || !dropoffStop || pickupStop.stop_order >= dropoffStop.stop_order) {
      setBookingError('Selectează o oprire de urcare situată înaintea opririi de coborâre.');
      return;
    }
    if (isSegmentFull) {
      setBookingError('Nu mai sunt locuri disponibile pe segmentul selectat.');
      return;
    }

    setSubmittingBooking(true);
    try {
      const res = await ridesApi.createBooking(
        ride.id,
        {
          pickup_stop_id: Number(pickupStop.id),
          dropoff_stop_id: Number(dropoffStop.id),
        },
        { fetchFn },
      );
      setCreatedBooking(res.booking);
      emitNotificationsRefresh();
      await loadDetails(true);
    } catch (err) {
      if (err?.code === 'DUPLICATE_ACTIVE_BOOKING') {
        setBookingError('Ai deja o rezervare activă sau în așteptare pentru această cursă.');
      } else if (err?.code === 'WOMEN_ONLY_NOT_ALLOWED') {
        setBookingError('Această cursă este destinată exclusiv femeilor.');
      } else if (err?.code === 'NO_SEATS_AVAILABLE') {
        setBookingError('Locurile pe acest segment s-au ocupat între timp.');
      } else if (err?.code === 'TRIP_COST_CAP_EXCEEDED') {
        setBookingError('Această rezervare ar depăși plafonul costului declarat al cursei.');
      } else if (err?.code === 'SELF_BOOKING_NOT_ALLOWED') {
        setBookingError('Șoferul nu poate rezerva un loc la propria cursă.');
      } else {
        setBookingError(err?.message || 'Cererea de rezervare nu a putut fi trimisă.');
      }
    } finally {
      setSubmittingBooking(false);
    }
  };

  return (
    <div className="main-layout">
      <section className="results-column" aria-labelledby="ride-details-heading">
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.45rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
              <span className="badge badge-uni">Traseu pe segmente</span>
              <WomenOnlyBadge womenOnly={ride.women_only} />
              {ride.recurring_rule_id && <span className="badge badge-amber">Cursă recurentă</span>}
              {ride.status === 'cancelled' && <span className="badge badge-cancel">Cursă anulată</span>}
              {ride.status === 'completed' && <span className="badge badge-uni">Cursă finalizată</span>}
            </div>
            {user && (
              <Link to={`/rides/${ride.id}/chat`} className="btn">
                Deschide chatul cursei
              </Link>
            )}
          </div>

          <h1
            id="ride-details-heading"
            style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-2xl)', letterSpacing: '-0.02em' }}
          >
            {stops.map((s) => s.city_name).join(' → ')}
          </h1>

          <p className="tabular" style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
            {formatBucharestDate(ride.departure_time)} · Plecare {formatBucharestTime(ride.departure_time)} · Sosire
            estimată {formatBucharestTime(ride.estimated_arrival_time)} · {totalDistKm} km total · Cost declarat:{' '}
            <strong>{ride.declared_trip_cost} lei</strong> ·{' '}
            {ride.luggage_allowed ? 'Bagaj acceptat' : 'Fără bagaj'} ·{' '}
            {ride.pets_allowed ? 'Animale acceptate' : 'Fără animale'} ·{' '}
            {ride.smoking_allowed ? 'Fumat permis' : 'Fără fumat'}
          </p>

          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-xl)' }}>
            Cronologie opriri &amp; disponibilitate pe segmente
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
            {stops.map((stop, idx) => {
              const seg = segments[idx];
              const isTerminal = idx === 0 || idx === stops.length - 1;
              return (
                <React.Fragment key={stop.id}>
                  <div
                    className="tabular"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '64px 18px 1fr auto',
                      alignItems: 'center',
                      gap: 'var(--space-sm)',
                      padding: '0.6rem 0.75rem',
                      background: 'var(--color-bg)',
                      border: '1px solid var(--color-border-subtle)',
                      borderRadius: 'var(--radius-md)',
                    }}
                  >
                    <strong>{formatBucharestTime(stop.estimated_arrival_time)}</strong>
                    <span className={isTerminal ? 'stop-dot key' : 'stop-dot'} />
                    <div>
                      <strong>{stop.city_name}</strong> · {stop.location_name}
                    </div>
                    <span className="badge badge-uni">{stop.distance_from_origin_km} km</span>
                  </div>

                  {seg && (
                    <div
                      className="tabular"
                      style={{
                        marginLeft: '72px',
                        padding: '0.4rem 0.75rem',
                        borderLeft: '2px dashed var(--color-primary)',
                        fontSize: 'var(--font-size-xs)',
                        color: 'var(--color-text-muted)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '0.5rem',
                      }}
                    >
                      <span>
                        Segment {idx + 1}: {stop.city_name} → {stops[idx + 1]?.city_name} ({seg.distance_km} km)
                      </span>
                      <span>
                        <strong style={{ color: 'var(--color-primary-ink)' }}>{seg.price_lei} lei</strong> ·{' '}
                        <strong style={{ color: seg.free_seats > 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
                          {seg.free_seats} locuri libere din {ride.available_seats}
                        </strong>
                      </span>
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        <section className="card" aria-labelledby="pax-heading">
          <h2 id="pax-heading" style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-lg)' }}>
            Pasageri confirmați pe segmente ({passengers.length})
          </h2>
          {passengers.length === 0 ? (
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginTop: '0.35rem' }}>
              Niciun pasager confirmat încă pe această cursă. Toate locurile sunt disponibile.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
              {passengers.map((p, i) => (
                <li
                  key={`${p.full_name}-${i}`}
                  style={{
                    padding: '0.55rem 0.75rem',
                    background: 'var(--color-bg)',
                    border: '1px solid var(--color-border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '0.5rem',
                    fontSize: 'var(--font-size-sm)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                    <strong>{p.full_name}</strong>
                    <UniversityBadge hasBadge={p.has_university_badge} />
                  </div>
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                    {p.pickup_stop_name} → {p.dropoff_stop_name}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>

      <aside className="map-column" aria-label="Reputație șofer și selector segment">
        <section className="card" aria-labelledby="driver-rep-heading" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <h2 id="driver-rep-heading" style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-lg)' }}>
            Reputație șofer
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 'var(--font-size-base)' }}>{driver?.full_name}</strong>
            <UniversityBadge hasBadge={driver?.has_university_badge} />
            <RecentCancellationBadge hasRecentCancellation={driver?.has_recent_cancellation_badge} />
          </div>
          <ReputationRow
            ratingAverage={driver?.rating_average}
            ratingCount={driver?.rating_count}
            seriousnessScore={driver?.seriousness_score}
          />
          <Link
            to={`/profile/${driver?.id}`}
            style={{ color: 'var(--color-primary-ink)', fontSize: 'var(--font-size-xs)', fontWeight: 700 }}
          >
            Vezi profilul public și recenziile ({driver?.rating_count || 0}) →
          </Link>
        </section>

        <section className="card" aria-labelledby="segment-selector-heading" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <h2 id="segment-selector-heading" style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-lg)' }}>
            Selectează segmentul tău
          </h2>

          <div className="field">
            <label htmlFor="pickup-select">Oprire de urcare</label>
            <select
              id="pickup-select"
              className="select"
              value={pickupStopId ?? ''}
              onChange={(e) => {
                const nextPickupId = Number(e.target.value);
                setPickupStopId(nextPickupId);
                const nextPickup = stops.find((s) => s.id === nextPickupId);
                if (nextPickup && dropoffStop && dropoffStop.stop_order <= nextPickup.stop_order) {
                  const firstValidDropoff = stops.find((s) => s.stop_order > nextPickup.stop_order);
                  if (firstValidDropoff) {
                    setDropoffStopId(firstValidDropoff.id);
                  }
                }
              }}
            >
              {stops.slice(0, -1).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.city_name} · {s.location_name} ({s.distance_from_origin_km} km)
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="dropoff-select">Oprire de coborâre</label>
            <select
              id="dropoff-select"
              className="select"
              value={dropoffStopId ?? ''}
              onChange={(e) => setDropoffStopId(Number(e.target.value))}
            >
              {stops.map((s) => (
                <option
                  key={s.id}
                  value={s.id}
                  disabled={pickupStop && s.stop_order <= pickupStop.stop_order}
                >
                  {s.city_name} · {s.location_name} ({s.distance_from_origin_km} km)
                </option>
              ))}
            </select>
          </div>

          <div className="tabular" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
              Preț proporțional segment (1 loc):
            </span>
            <strong style={{ fontSize: '1.75rem', color: 'var(--color-primary-ink)' }}>{dynamicPriceLei} lei</strong>
          </div>

          <div className="tabular" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
            Disponibilitate pe intervalul selectat:{' '}
            <strong style={{ color: minFreeSeatsOnSelection > 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
              {minFreeSeatsOnSelection} {minFreeSeatsOnSelection === 1 ? 'loc liber' : 'locuri libere'}
            </strong>
          </div>

          {isDriverOfRide ? (
            <div className="status-banner warning" role="status">
              <span>Aceasta este cursa publicată de tine. Poți gestiona cererile și opririle din panoul tău.</span>
              <Link to="/dashboard" className="btn btn-primary">
                Cursele mele
              </Link>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={submittingBooking || isSegmentFull || isRideInactive || isWomenOnlyBlocked}
              onClick={handleBookingSubmit}
            >
              {submittingBooking
                ? 'Se trimite cererea...'
                : isRideInactive
                  ? 'Cursa nu mai este activă'
                  : isSegmentFull
                    ? 'Niciun loc liber pe acest segment'
                    : 'Solicită rezervare pe acest segment (1 loc)'}
            </button>
          )}

          {!bookingError && isWomenOnlyBlocked && (
            <div className="status-banner warning" role="status">
              <span>Această cursă este destinată exclusiv femeilor.</span>
            </div>
          )}

          {bookingError && (
            <div className="status-banner error" role="alert">
              <span>
                <strong>Eroare:</strong> {bookingError}
              </span>
            </div>
          )}

          {createdBooking && (
            <div className="status-banner success" role="status" aria-live="polite">
              <div>
                <strong>Cerere trimisă!</strong> Rezervarea ta pe segmentul{' '}
                <strong>
                  {createdBooking.pickup_stop_name || pickupStop?.location_name} →{' '}
                  {createdBooking.dropoff_stop_name || dropoffStop?.location_name}
                </strong>{' '}
                (preț blocat <strong>{createdBooking.price_lei} lei</strong>) așteaptă confirmarea șoferului.
              </div>
              <Link to="/dashboard" className="btn">
                Vezi rezervările mele
              </Link>
            </div>
          )}
        </section>

        <RouteMap
          title={`${ride.origin_name} → ${ride.destination_name}`}
          subtitle={`${totalDistKm} km · ${stops.length} opriri`}
          radiusKm={1}
          stops={stops}
        />
      </aside>
    </div>
  );
}
