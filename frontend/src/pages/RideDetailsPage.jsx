import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ridesApi } from '../api/client.js';
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
  const { user, fetchFn } = useAuth();

  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pickupStopId, setPickupStopId] = useState(null);
  const [dropoffStopId, setDropoffStopId] = useState(null);
  const [ctaNotice, setCtaNotice] = useState('');

  useDocumentMeta({
    title: details
      ? `StudRide · Cursă ${details.ride.origin_name} → ${details.ride.destination_name}`
      : 'StudRide · Detalii Cursă & Segmente',
    description:
      'Cronologia opririlor intermediare, disponibilitatea locurilor pe fiecare segment, prețul proporțional și reputația șoferului.',
  });

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const data = await ridesApi.getDetails(rideId, { fetchFn });
        if (!active) return;
        setDetails(data);
        if (data?.stops?.length >= 2) {
          setPickupStopId(data.stops[0].id);
          setDropoffStopId(data.stops[data.stops.length - 1].id);
        }
      } catch (err) {
        if (!active) return;
        setError(err.message || 'Cursa nu a putut fi încărcată.');
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [rideId, fetchFn]);

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

  const handleBookingCta = () => {
    if (!user) {
      setCtaNotice('Pentru a trimite o cerere de rezervare pe acest segment, autentifică-te în contul tău StudRide.');
      return;
    }
    if (ride.women_only && user.gender !== 'female') {
      setCtaNotice('Această cursă este marcată Women-only: doar conturile cu genul Femeie pot rezerva un loc.');
      return;
    }
    setCtaNotice(
      `Segment pregătit pentru rezervare (${pickupStop?.city_name} → ${dropoffStop?.city_name}, 1 loc, preț blocat ${dynamicPriceLei} lei). Rezervarea directă și chatul cursei vor fi disponibile în curând.`,
    );
  };

  return (
    <div className="main-layout">
      <section className="results-column" aria-labelledby="ride-details-heading">
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
            <span className="badge badge-uni">Traseu pe segmente</span>
            <WomenOnlyBadge womenOnly={ride.women_only} />
            {ride.recurring_rule_id && <span className="badge badge-amber">Cursă recurentă</span>}
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
            <strong>{ride.declared_trip_cost} lei</strong>
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
                        <strong style={{ color: 'var(--color-success)' }}>
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
                    <UniversityBadge hasBadge={p.has_university_badge} note={p.university_badge_note} />
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
            <UniversityBadge hasBadge={driver?.has_university_badge} note={driver?.university_badge_note} />
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
              onChange={(e) => setPickupStopId(Number(e.target.value))}
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

          <button type="button" className="btn btn-primary" onClick={handleBookingCta}>
            Solicită rezervare pe acest segment (1 loc)
          </button>

          {ctaNotice && (
            <div className="status-banner warning" role="status" aria-live="polite">
              <span>{ctaNotice}</span>
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
