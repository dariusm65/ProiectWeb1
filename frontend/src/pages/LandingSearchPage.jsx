import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GeocodeAutocomplete } from '../components/GeocodeAutocomplete.jsx';
import { KNOWN_SURVEY_PLACES, resolveKnownSurveyPlace } from '../domain/bucharestTime.js';
import { useDocumentMeta } from '../hooks/useDocumentMeta.js';

const POPULAR_CORRIDORS = [
  {
    origin: KNOWN_SURVEY_PLACES[0], // Cluj-Napoca
    dest: KNOWN_SURVEY_PLACES[4], // Sibiu
    route: 'Cluj-Napoca → Sibiu',
    stops: 'Opriri: Turda · Alba Iulia · Sebeș',
    meta: '168 km · 2h 45m',
    price: '38 lei / segment',
  },
  {
    origin: KNOWN_SURVEY_PLACES[8], // Bacău
    dest: KNOWN_SURVEY_PLACES[12], // București
    route: 'Bacău → București',
    stops: 'Opriri: Adjud · Mărășești · Focșani · Buzău · Ploiești',
    meta: '298 km · 4h 50m',
    price: '65 lei / segment',
  },
  {
    origin: KNOWN_SURVEY_PLACES[6], // Timișoara
    dest: KNOWN_SURVEY_PLACES[4], // Sibiu
    route: 'Timișoara → Sibiu',
    stops: 'Opriri: Lugoj · Deva · Sebeș',
    meta: '272 km · 3h 40m',
    price: '59 lei / segment',
  },
];

export function LandingSearchPage() {
  useDocumentMeta({
    title: 'StudRide · Carpooling Studențesc pe Segmente în România',
    description:
      'Caută și rezervă exact segmentul de cursă studențească de care ai nevoie în România, cu rază implicită 1 km și cost împărțit fără profit.',
  });

  const navigate = useNavigate();
  const [originText, setOriginText] = useState('Sibiu (Gara Mare Sibiu)');
  const [originPlace, setOriginPlace] = useState(KNOWN_SURVEY_PLACES[4]);
  const [destText, setDestText] = useState('Cluj-Napoca (Campus Hașdeu)');
  const [destPlace, setDestPlace] = useState(KNOWN_SURVEY_PLACES[0]);
  const [date, setDate] = useState('');
  const [radiusKm, setRadiusKm] = useState(1);
  const [womenOnly, setWomenOnly] = useState(false);
  const [universityOnly, setUniversityOnly] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!originText.trim() || !destText.trim()) {
      setErrorMsg(
        'Selectează atât localitatea de plecare, cât și destinația pentru a potrivi segmentele disponibile.',
      );
      return;
    }
    setErrorMsg('');

    const resolvedOrigin = resolveKnownSurveyPlace(originText) || originPlace;
    const resolvedDest = resolveKnownSurveyPlace(destText) || destPlace;

    const params = new URLSearchParams({
      originLat: String(resolvedOrigin.latitude),
      originLng: String(resolvedOrigin.longitude),
      destLat: String(resolvedDest.latitude),
      destLng: String(resolvedDest.longitude),
      originLabel: originText.trim(),
      destLabel: destText.trim(),
      radiusKm: String(radiusKm),
    });
    if (date) params.set('date', date);
    if (womenOnly) params.set('womenOnly', 'true');
    if (universityOnly) params.set('universityOnly', 'true');
    navigate(`/rides?${params.toString()}`);
  };

  return (
    <>
      <section className="hero-section" aria-labelledby="hero-title">
        <div className="hero-copy">
          <span className="hero-kicker">România · Curse interurbane pe segmente</span>
          <h1 className="hero-headline" id="hero-title">
            Drumul spre casă, <em>împărțit corect</em> între studenți.
          </h1>
          <p className="hero-subcopy">
            Rezervă exact segmentul de care ai nevoie — cu opriri intermediare clare, cost de combustibil
            împărțit transparent și reputație dublă bazată pe seriozitate.
          </p>
          <div className="hero-metrics">
            <div className="metric-item">
              <span className="metric-val">1 km</span>
              <span className="metric-lbl">Rază implicită de preluare</span>
            </div>
            <div className="metric-item">
              <span className="metric-val">100%</span>
              <span className="metric-lbl">Cost împărțit fără profit</span>
            </div>
            <div className="metric-item">
              <span className="metric-val">1 loc</span>
              <span className="metric-lbl">Per rezervare de student</span>
            </div>
          </div>
        </div>

        <figure className="hero-visual">
          <svg
            className="hero-svg"
            viewBox="0 0 560 340"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            role="img"
            aria-label="Ilustrație drum prin pădurea carpatină cu traseu studențesc Sibiu – Cluj-Napoca"
          >
            <rect width="560" height="340" fill="var(--color-surface-subtle)" />
            <circle cx="430" cy="84" r="38" fill="var(--color-accent)" opacity="0.22" />
            <circle cx="430" cy="84" r="24" fill="var(--color-accent)" opacity="0.88" />
            <path
              d="M0 215 L95 135 L185 178 L295 102 L405 168 L495 122 L560 165 L560 340 L0 340 Z"
              fill="var(--color-primary)"
              opacity="0.28"
            />
            <path
              d="M0 245 L120 170 L230 220 L350 155 L465 210 L560 178 L560 340 L0 340 Z"
              fill="var(--color-primary)"
              opacity="0.58"
            />
            <path d="M0 270 Q 150 225 290 262 T 560 250 L560 340 L0 340 Z" fill="var(--color-primary)" />
            <path
              d="M225 340 C 235 292, 315 282, 318 250 C 321 224, 245 215, 255 188 C 262 170, 312 162, 338 148"
              stroke="var(--color-bg)"
              strokeWidth="20"
              strokeLinecap="round"
              opacity="0.92"
            />
            <path
              d="M225 340 C 235 292, 315 282, 318 250 C 321 224, 245 215, 255 188 C 262 170, 312 162, 338 148"
              stroke="var(--color-accent)"
              strokeWidth="2.5"
              strokeDasharray="6 7"
              strokeLinecap="round"
            />
            <g>
              <circle cx="242" cy="306" r="11" fill="var(--color-node-terminal-ring)" />
              <circle cx="242" cy="306" r="6" fill="var(--color-node-terminal)" stroke="var(--color-surface)" strokeWidth="2" />
              <rect x="118" y="293" width="110" height="24" rx="6" fill="var(--color-surface)" stroke="var(--color-border)" />
              <text x="128" y="309" fill="var(--color-text)" fontFamily="var(--font-sans)" fontSize="11" fontWeight="700">
                Sibiu (ULBS)
              </text>
            </g>
            <g>
              <circle cx="315" cy="248" r="5" fill="var(--color-node-intermediate)" stroke="var(--color-surface)" strokeWidth="2" />
              <rect x="330" y="236" width="90" height="22" rx="6" fill="var(--color-surface)" stroke="var(--color-border)" />
              <text x="340" y="251" fill="var(--color-text)" fontFamily="var(--font-sans)" fontSize="10.5" fontWeight="600">
                Alba Iulia
              </text>
            </g>
            <g>
              <circle cx="338" cy="148" r="11" fill="var(--color-node-terminal-ring)" />
              <circle cx="338" cy="148" r="6" fill="var(--color-node-terminal)" stroke="var(--color-surface)" strokeWidth="2" />
              <rect x="352" y="135" width="122" height="24" rx="6" fill="var(--color-surface)" stroke="var(--color-border)" />
              <text x="362" y="151" fill="var(--color-text)" fontFamily="var(--font-sans)" fontSize="11" fontWeight="700">
                Cluj-Napoca
              </text>
            </g>
          </svg>
          <figcaption className="visual-caption">
            <span>
              <strong>Coridor activ:</strong> Sibiu → Alba Iulia → Turda → Cluj-Napoca
            </span>
            <span>168 km · de la 38 lei / segment</span>
          </figcaption>
        </figure>
      </section>

      <section className="search-wrapper" aria-label="Căutare cursă pe segmente">
        <form className="search-card" onSubmit={handleSubmit}>
          {errorMsg && (
            <div className="status-banner error" role="alert">
              <span>
                <strong>Câmp incomplet:</strong> {errorMsg}
              </span>
              <button type="button" className="btn" onClick={() => setErrorMsg('')}>
                Închide
              </button>
            </div>
          )}

          <div className="search-grid">
            <GeocodeAutocomplete
              id="origin-input"
              label="Plecare (Origine)"
              value={originText}
              onChange={setOriginText}
              onSelectPlace={setOriginPlace}
            />
            <GeocodeAutocomplete
              id="dest-input"
              label="Destinație"
              value={destText}
              onChange={setDestText}
              onSelectPlace={setDestPlace}
            />
            <div className="field">
              <label htmlFor="date-input">Data plecării (opțional)</label>
              <input
                id="date-input"
                className="input"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <button type="submit" className="btn btn-primary" style={{ minHeight: '44px', padding: '0 1.4rem' }}>
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
        </form>
      </section>

      <section className="corridors-section" aria-labelledby="corridors-title">
        <h2 className="section-title" id="corridors-title">
          Rute frecvente din comunitatea studențească
        </h2>
        <div className="corridors-grid">
          {POPULAR_CORRIDORS.map((c) => (
            <article key={c.route} className="corridor-card">
              <h3 className="corridor-route">{c.route}</h3>
              <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{c.stops}</p>
              <div className="corridor-foot">
                <span>{c.meta}</span>
                <strong style={{ color: 'var(--color-primary-ink)', fontSize: 'var(--font-size-sm)' }}>
                  {c.price}
                </strong>
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
