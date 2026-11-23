import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { geocodingApi, ridesApi, recurringRidesApi } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { RouteMap } from '../components/RouteMap.jsx';
import { calculateSegmentPrice } from '../domain/segmentPricing.js';
import { buildIsoTimestampFromDateAndTime, KNOWN_SURVEY_PLACES } from '../domain/bucharestTime.js';
import { useDocumentMeta } from '../hooks/useDocumentMeta.js';

const WEEKDAYS = [
  { id: 'monday', label: 'Luni' },
  { id: 'tuesday', label: 'Marți' },
  { id: 'wednesday', label: 'Miercuri' },
  { id: 'thursday', label: 'Joi' },
  { id: 'friday', label: 'Vineri' },
  { id: 'saturday', label: 'Sâmbătă' },
  { id: 'sunday', label: 'Duminică' },
];

const INITIAL_STOPS = [
  {
    city_name: 'Cluj-Napoca',
    location_name: 'Gara Cluj',
    latitude: 46.77,
    longitude: 23.6,
    distance_from_origin_km: 0,
    offset_minutes: 0,
  },
  {
    city_name: 'Turda',
    location_name: 'Centru Turda',
    latitude: 46.57,
    longitude: 23.78,
    distance_from_origin_km: 32,
    offset_minutes: 35,
  },
  {
    city_name: 'Alba Iulia',
    location_name: 'Gara Alba Iulia',
    latitude: 46.07,
    longitude: 23.57,
    distance_from_origin_km: 100,
    offset_minutes: 110,
  },
  {
    city_name: 'Sibiu',
    location_name: 'Gara Sibiu',
    latitude: 45.79,
    longitude: 24.15,
    distance_from_origin_km: 160,
    offset_minutes: 180,
  },
];

export function PublishRidePage() {
  useDocumentMeta({
    title: 'StudRide · Publică o Cursă Unică sau Recurentă',
    description:
      'Publică o cursă studențească pe segmente intermediare cu geocodare automată, plafon de cost împărțit echitabil, opțiune Women-only și program recurent.',
  });

  const navigate = useNavigate();
  const { user, fetchFn } = useAuth();

  const [mode, setMode] = useState('single'); // 'single' | 'recurring'
  const [stops, setStops] = useState(INITIAL_STOPS);
  const [departureDate, setDepartureDate] = useState('2026-12-04');
  const [departureTime, setDepartureTime] = useState('16:30');
  const [startDate, setStartDate] = useState('2026-12-01');
  const [endDate, setEndDate] = useState('2027-01-31');
  const [daysOfWeek, setDaysOfWeek] = useState(['friday']);

  const [availableSeats, setAvailableSeats] = useState(2);
  const [consumptionL100, setConsumptionL100] = useState(6.5);
  const [fuelPriceLei, setFuelPriceLei] = useState(7.5);
  const [declaredTripCost, setDeclaredTripCost] = useState(120);

  const [luggageAllowed, setLuggageAllowed] = useState(true);
  const [petsAllowed, setPetsAllowed] = useState(false);
  const [smokingAllowed, setSmokingAllowed] = useState(false);
  const [womenOnly, setWomenOnly] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const canPublishWomenOnly = user?.gender === 'female';
  const totalDistKm = stops.length > 0 ? Number(stops[stops.length - 1].distance_from_origin_km) || 0 : 0;

  const seatFullCapLei = calculateSegmentPrice({
    declaredTripCost,
    availableSeats: Number(availableSeats),
    pickupDistKm: 0,
    dropoffDistKm: Math.max(1, totalDistKm),
    totalDistKm: Math.max(1, totalDistKm),
  });

  const updateStopField = (index, field, value) => {
    setStops((prev) =>
      prev.map((s, i) => {
        if (i !== index) return s;
        if (field === 'city_name') {
          const matched = KNOWN_SURVEY_PLACES.find(
            (p) => p.city_name.toLowerCase() === String(value).trim().toLowerCase(),
          );
          if (matched) {
            return {
              ...s,
              city_name: value,
              location_name: matched.location_name,
              latitude: matched.latitude,
              longitude: matched.longitude,
            };
          }
        }
        return { ...s, [field]: value };
      }),
    );
  };

  const addIntermediateStop = () => {
    setStops((prev) => {
      if (prev.length >= 20) return prev;
      const last = prev[prev.length - 1];
      const beforeLast = prev[prev.length - 2] || prev[0];
      const midKm = Math.max(
        Number(beforeLast.distance_from_origin_km) + 10,
        Math.round((Number(beforeLast.distance_from_origin_km) + Number(last.distance_from_origin_km)) / 2),
      );
      const midOffset = Math.max(
        Number(beforeLast.offset_minutes) + 15,
        Math.round((Number(beforeLast.offset_minutes) + Number(last.offset_minutes)) / 2),
      );
      const bumpedLast = {
        ...last,
        distance_from_origin_km: Math.max(Number(last.distance_from_origin_km), midKm + 15),
        offset_minutes: Math.max(Number(last.offset_minutes), midOffset + 20),
      };
      const inserted = {
        city_name: 'Sebeș',
        location_name: 'Centru Sebeș',
        latitude: 45.9597,
        longitude: 23.5681,
        distance_from_origin_km: midKm,
        offset_minutes: midOffset,
      };
      return [...prev.slice(0, -1), inserted, bumpedLast];
    });
  };

  const removeStop = (index) => {
    setStops((prev) => {
      if (prev.length <= 2) return prev;
      const next = prev.filter((_, i) => i !== index);
      next[0] = { ...next[0], distance_from_origin_km: 0, offset_minutes: 0 };
      return next;
    });
  };

  const handleGeocodeStop = async (index) => {
    const s = stops[index];
    const q = `${s.city_name} ${s.location_name}`.trim();
    if (q.length < 2) return;
    try {
      const hit = await geocodingApi.search(q, { fetchFn });
      if (hit && Number.isFinite(hit.lat) && Number.isFinite(hit.lng)) {
        setStops((prev) =>
          prev.map((item, i) =>
            i === index
              ? { ...item, latitude: Number(hit.lat), longitude: Number(hit.lng), location_name: hit.display_name || item.location_name }
              : item,
          ),
        );
      }
    } catch {
      // keep existing coordinates if offline
    }
  };

  const handleMapClickReverseGeocode = async ({ lat, lng }) => {
    try {
      const hit = await geocodingApi.reverse(lat, lng, { fetchFn });
      const city = String(hit?.display_name || 'Oprire Hartă').split(',')[0].trim();
      setStops((prev) => {
        const last = prev[prev.length - 1];
        const newStop = {
          city_name: city || 'Oprire',
          location_name: hit?.display_name || `${lat}, ${lng}`,
          latitude: Number(hit?.lat ?? lat),
          longitude: Number(hit?.lng ?? lng),
          distance_from_origin_km: Number(last.distance_from_origin_km) + 25,
          offset_minutes: Number(last.offset_minutes) + 30,
        };
        return [...prev, newStop];
      });
    } catch {
      // ignore reverse failure
    }
  };

  const applyEstimatedFuelCost = () => {
    const estimated = Math.round(((totalDistKm * Number(consumptionL100)) / 100) * Number(fuelPriceLei));
    if (Number.isFinite(estimated) && estimated > 0) {
      setDeclaredTripCost(estimated);
    }
  };

  const toggleWeekday = (dayId) => {
    setDaysOfWeek((prev) =>
      prev.includes(dayId) ? prev.filter((d) => d !== dayId) : [...prev, dayId],
    );
  };

  const validateStops = () => {
    if (stops.length < 2) {
      return 'O cursă trebuie să conțină cel puțin 2 opriri (origine și destinație).';
    }
    if (Number(stops[0].distance_from_origin_km) !== 0) {
      return 'Prima oprire (originea) trebuie să aibă distanța 0 km.';
    }
    for (let i = 1; i < stops.length; i += 1) {
      if (Number(stops[i].distance_from_origin_km) <= Number(stops[i - 1].distance_from_origin_km)) {
        return 'Distanțele în km față de origine trebuie să fie strict crescătoare pentru fiecare oprire.';
      }
      if (Number(stops[i].offset_minutes) <= Number(stops[i - 1].offset_minutes)) {
        return 'Timpul / minutele de la plecare trebuie să fie strict crescătoare pentru fiecare oprire.';
      }
    }
    return '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    const stopErr = validateStops();
    if (stopErr) {
      setErrorMsg(stopErr);
      return;
    }

    const commonOptions = {
      available_seats: Number(availableSeats),
      declared_trip_cost: Number(declaredTripCost),
      luggage_allowed: Boolean(luggageAllowed),
      pets_allowed: Boolean(petsAllowed),
      smoking_allowed: Boolean(smokingAllowed),
      women_only: canPublishWomenOnly ? Boolean(womenOnly) : false,
    };

    setSubmitting(true);
    try {
      if (mode === 'single') {
        const payload = {
          ...commonOptions,
          stops: stops.map((s, idx) => ({
            city_name: s.city_name.trim(),
            location_name: s.location_name.trim(),
            latitude: Number(s.latitude),
            longitude: Number(s.longitude),
            distance_from_origin_km: idx === 0 ? 0 : Number(s.distance_from_origin_km),
            estimated_arrival_time: buildIsoTimestampFromDateAndTime(
              departureDate,
              departureTime,
              idx === 0 ? 0 : Number(s.offset_minutes),
            ),
          })),
        };
        const created = await ridesApi.publish(payload, { fetchFn });
        setSuccessMsg('Cursa a fost publicată cu succes!');
        if (created?.ride?.id) {
          navigate(`/rides/${created.ride.id}`);
        }
      } else {
        if (daysOfWeek.length === 0) {
          setErrorMsg('Selectează cel puțin o zi a săptămânii pentru regula recurentă.');
          setSubmitting(false);
          return;
        }
        const payload = {
          ...commonOptions,
          departure_time: departureTime,
          start_date: startDate,
          end_date: endDate || null,
          days_of_week: daysOfWeek,
          stops: stops.map((s, idx) => ({
            city_name: s.city_name.trim(),
            location_name: s.location_name.trim(),
            latitude: Number(s.latitude),
            longitude: Number(s.longitude),
            distance_from_origin_km: idx === 0 ? 0 : Number(s.distance_from_origin_km),
            estimated_offset_minutes: idx === 0 ? 0 : Number(s.offset_minutes),
          })),
        };
        await recurringRidesApi.createRule(payload, { fetchFn });
        setSuccessMsg('Regula de cursă recurentă a fost salvată! Instanțele vor fi generate automat la căutare.');
      }
    } catch (err) {
      setErrorMsg(err.message || 'Publicarea cursei a eșuat.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="main-layout">
      <section className="results-column" aria-labelledby="publish-heading">
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <h1
            id="publish-heading"
            style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-2xl)', letterSpacing: '-0.02em' }}
          >
            Publică o cursă studențească pe segmente
          </h1>

          {!user && (
            <div className="status-banner warning" role="status">
              <span>Pentru a publica o cursă este necesară autentificarea în contul tău StudRide.</span>
              <Link to="/login" className="btn btn-primary">
                Autentificare
              </Link>
            </div>
          )}

          <div className="tabs" role="tablist" aria-label="Mod publicare cursă">
            <button
              type="button"
              className="tab-btn"
              role="tab"
              aria-selected={mode === 'single'}
              onClick={() => setMode('single')}
            >
              Cursă unică
            </button>
            <button
              type="button"
              className="tab-btn"
              role="tab"
              aria-selected={mode === 'recurring'}
              onClick={() => setMode('recurring')}
            >
              Cursă recurentă
            </button>
          </div>

          {errorMsg && (
            <div className="status-banner error" role="alert">
              <span>
                <strong>Eroare:</strong> {errorMsg}
              </span>
            </div>
          )}

          {successMsg && (
            <div className="status-banner success" role="status" aria-live="polite">
              <span>{successMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
            <section aria-labelledby="schedule-heading" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              <h2 id="schedule-heading" style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-lg)' }}>
                1. Program plecare ({mode === 'single' ? 'Cursă unică' : 'Regulă săptămânală, ora României'})
              </h2>

              {mode === 'single' ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)' }}>
                  <div className="field">
                    <label htmlFor="pub-date">Data plecării</label>
                    <input
                      id="pub-date"
                      type="date"
                      className="input"
                      value={departureDate}
                      onChange={(e) => setDepartureDate(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="pub-time">Ora plecării (Origine)</label>
                    <input
                      id="pub-time"
                      type="time"
                      className="input"
                      value={departureTime}
                      onChange={(e) => setDepartureTime(e.target.value)}
                    />
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-sm)' }}>
                    <div className="field">
                      <label htmlFor="rec-time">Ora plecării (Europe/Bucharest)</label>
                      <input
                        id="rec-time"
                        type="time"
                        className="input"
                        value={departureTime}
                        onChange={(e) => setDepartureTime(e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="rec-start">Valabil de la (start_date)</label>
                      <input
                        id="rec-start"
                        type="date"
                        className="input"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="rec-end">Până la (end_date opțional)</label>
                      <input
                        id="rec-end"
                        type="date"
                        className="input"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                      />
                    </div>
                  </div>

                  <div role="group" aria-label="Zilele săptămânii" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                    {WEEKDAYS.map((day) => (
                      <button
                        key={day.id}
                        type="button"
                        className={daysOfWeek.includes(day.id) ? 'chip-btn active' : 'chip-btn'}
                        onClick={() => toggleWeekday(day.id)}
                      >
                        {day.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>

            <section aria-labelledby="stops-builder-heading" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                <h2 id="stops-builder-heading" style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-lg)' }}>
                  2. Constructor dinamic de opriri ({stops.length} opriri)
                </h2>
                <button type="button" className="btn" onClick={addIntermediateStop}>
                  + Adaugă oprire intermediară
                </button>
              </div>

              {stops.map((stop, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1.2fr 110px 130px auto',
                    gap: 'var(--space-xs)',
                    alignItems: 'end',
                    padding: '0.6rem',
                    background: 'var(--color-bg)',
                    border: '1px solid var(--color-border-subtle)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <div className="field">
                    <label htmlFor={`stop-city-${idx}`}>
                      {idx === 0 ? 'Origine' : idx === stops.length - 1 ? 'Destinație' : `Oprire #${idx + 1}`}
                    </label>
                    <input
                      id={`stop-city-${idx}`}
                      className="input"
                      type="text"
                      value={stop.city_name}
                      onChange={(e) => updateStopField(idx, 'city_name', e.target.value)}
                      onBlur={() => handleGeocodeStop(idx)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`stop-loc-${idx}`}>Punct de întâlnire</label>
                    <input
                      id={`stop-loc-${idx}`}
                      className="input"
                      type="text"
                      value={stop.location_name}
                      onChange={(e) => updateStopField(idx, 'location_name', e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`stop-km-${idx}`}>Distanță (km)</label>
                    <input
                      id={`stop-km-${idx}`}
                      className="input"
                      type="number"
                      min="0"
                      disabled={idx === 0}
                      value={idx === 0 ? 0 : stop.distance_from_origin_km}
                      onChange={(e) => updateStopField(idx, 'distance_from_origin_km', Number(e.target.value))}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`stop-min-${idx}`}>+ Minute de la start</label>
                    <input
                      id={`stop-min-${idx}`}
                      className="input"
                      type="number"
                      min="0"
                      disabled={idx === 0}
                      value={idx === 0 ? 0 : stop.offset_minutes}
                      onChange={(e) => updateStopField(idx, 'offset_minutes', Number(e.target.value))}
                    />
                  </div>
                  <div>
                    {stops.length > 2 && idx > 0 && idx < stops.length - 1 && (
                      <button
                        type="button"
                        className="btn"
                        aria-label={`Elimină oprirea ${idx + 1}`}
                        onClick={() => removeStop(idx)}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </section>

            <section aria-labelledby="cost-prefs-heading" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              <h2 id="cost-prefs-heading" style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-lg)' }}>
                3. Locuri pasageri, consum combustibil &amp; preferințe
              </h2>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-sm)', alignItems: 'end' }}>
                <div className="field">
                  <label htmlFor="pub-seats">Locuri disponibile (fără șofer)</label>
                  <input
                    id="pub-seats"
                    type="number"
                    min="1"
                    max="8"
                    className="input"
                    value={availableSeats}
                    onChange={(e) => setAvailableSeats(Number(e.target.value))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="pub-cons">Consum mediu (L/100km)</label>
                  <input
                    id="pub-cons"
                    type="number"
                    step="0.1"
                    min="1"
                    className="input"
                    value={consumptionL100}
                    onChange={(e) => setConsumptionL100(Number(e.target.value))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="pub-fuel-price">Preț combustibil (lei/L)</label>
                  <input
                    id="pub-fuel-price"
                    type="number"
                    step="0.1"
                    min="1"
                    className="input"
                    value={fuelPriceLei}
                    onChange={(e) => setFuelPriceLei(Number(e.target.value))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="pub-cost">Cost total declarat (lei)</label>
                  <input
                    id="pub-cost"
                    type="number"
                    min="0"
                    step="1"
                    className="input"
                    value={declaredTripCost}
                    onChange={(e) => setDeclaredTripCost(Number(e.target.value))}
                  />
                </div>
              </div>

              <div>
                <button type="button" className="chip-btn" onClick={applyEstimatedFuelCost}>
                  Calculează automat costul din consum ({totalDistKm} km × {consumptionL100} L/100km × {fuelPriceLei} lei/L)
                </button>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)', paddingTop: '0.4rem' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: 'var(--font-size-xs)', fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={luggageAllowed}
                    onChange={(e) => setLuggageAllowed(e.target.checked)}
                  />
                  <span>Bagaj permis</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: 'var(--font-size-xs)', fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={petsAllowed}
                    onChange={(e) => setPetsAllowed(e.target.checked)}
                  />
                  <span>Animale de companie permise</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: 'var(--font-size-xs)', fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={smokingAllowed}
                    onChange={(e) => setSmokingAllowed(e.target.checked)}
                  />
                  <span>Fumat permis</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: 'var(--font-size-xs)', fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    disabled={!canPublishWomenOnly}
                    checked={canPublishWomenOnly ? womenOnly : false}
                    onChange={(e) => setWomenOnly(e.target.checked)}
                  />
                  <span>Cursă exclusiv pentru femei (Women-only)</span>
                </label>
              </div>
              {!canPublishWomenOnly && (
                <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                  Notă: Opțiunea „Women-only” este activă exclusiv pentru șoferii cu genul auto-declarat „Femeie”.
                </p>
              )}
            </section>

            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting
                ? 'Se salvează...'
                : mode === 'single'
                  ? 'Publică cursa'
                  : 'Publică regula recurentă'}
            </button>
          </form>
        </div>
      </section>

      <aside className="map-column" aria-label="Previzualizare plafon cost și hartă">
        <section className="fuel-box" aria-labelledby="d010-preview-heading">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2
              id="d010-preview-heading"
              style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-base)', fontWeight: 700 }}
            >
              Previzualizare plafon cost
            </h2>
            <span className="badge badge-uni">Additivitate exactă</span>
          </div>

          <div className="fuel-row">
            <span>Cost declarat cursă</span>
            <strong>{declaredTripCost} lei</strong>
          </div>
          <div className="fuel-row">
            <span>Părți egale (locuri + șofer)</span>
            <strong>
              {availableSeats} + 1 = {Number(availableSeats) + 1} părți
            </strong>
          </div>
          <div className="fuel-row">
            <span>Plafon loc rută completă</span>
            <strong data-testid="d010-seat-cap" style={{ color: 'var(--color-primary-ink)' }}>
              {seatFullCapLei} lei / loc
            </strong>
          </div>

          {stops.slice(0, -1).map((s, idx) => {
            const next = stops[idx + 1];
            const segPrice = calculateSegmentPrice({
              declaredTripCost,
              availableSeats: Number(availableSeats),
              pickupDistKm: Number(s.distance_from_origin_km),
              dropoffDistKm: Number(next.distance_from_origin_km),
              totalDistKm: Math.max(1, totalDistKm),
            });
            return (
              <div key={idx} className="fuel-row">
                <span>
                  {s.city_name} → {next.city_name} ({Number(next.distance_from_origin_km) - Number(s.distance_from_origin_km)} km)
                </span>
                <strong>{segPrice} lei</strong>
              </div>
            );
          })}

          <div className="fuel-formula">
            Regula de împărțire echitabilă: Sub-segmentele se rotunjesc la leu întreg și însumează exact <strong>{seatFullCapLei} lei</strong>.
            Încasările totale nu depășesc niciodată costul declarat ({declaredTripCost} lei).
          </div>
        </section>

        <RouteMap
          title={`${stops[0]?.city_name || 'Origine'} → ${stops[stops.length - 1]?.city_name || 'Destinație'}`}
          subtitle={`${totalDistKm} km · Clic pe hartă pentru a adăuga o oprire`}
          radiusKm={1}
          stops={stops}
          onMapClickCoordinate={handleMapClickReverseGeocode}
        />
      </aside>
    </div>
  );
}
