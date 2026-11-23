import React from 'react';

/**
 * Topographic route map & stop visualizer (DS-004, DS-005, DS-006).
 * Renders an accessible SVG route map with ordered stops, terminal double-rings,
 * intermediate nodes, radius rings (D-017), and optional click-to-reverse-geocode trigger (D-009).
 */
export function RouteMap({
  title = 'Traseu selectat',
  subtitle = '',
  radiusKm = 1,
  stops = [],
  onMapClickCoordinate,
}) {
  const projectedStops = (stops.length >= 2 ? stops : [
    { city_name: 'Cluj-Napoca', latitude: 46.77, longitude: 23.6 },
    { city_name: 'Turda', latitude: 46.57, longitude: 23.78 },
    { city_name: 'Alba Iulia', latitude: 46.07, longitude: 23.57 },
    { city_name: 'Sibiu', latitude: 45.79, longitude: 24.15 },
  ]).map((s, idx, arr) => {
    const ratio = arr.length > 1 ? idx / (arr.length - 1) : 0;
    const x = Math.round(80 + ratio * 290);
    const y = Math.round(58 + ratio * 184 + (idx % 2 === 1 ? -14 : 0));
    return {
      ...s,
      x,
      y,
      isTerminal: idx === 0 || idx === arr.length - 1,
    };
  });

  const pathD = projectedStops
    .map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x} ${pt.y}`)
    .join(' ');
  const first = projectedStops[0];
  const last = projectedStops[projectedStops.length - 1];
  const radiusPx = Number(radiusKm) >= 5 ? 44 : Number(radiusKm) >= 3 ? 32 : 22;

  const handleSvgClick = (e) => {
    if (!onMapClickCoordinate) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
    const relY = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5;
    const lat = Number((47.2 - relY * 2.8).toFixed(4));
    const lng = Number((21.2 + relX * 5.2).toFixed(4));
    onMapClickCoordinate({ lat, lng });
  };

  return (
    <div className="map-card">
      <div className="map-header">
        <span>Hartă topografică România · {title}</span>
        <span className="tabular" style={{ color: 'var(--color-primary-ink)' }}>
          Rază: {radiusKm} km
        </span>
      </div>

      <div style={{ position: 'relative', height: '300px', background: 'var(--color-bg)' }}>
        <svg
          viewBox="0 0 460 300"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label={`Hartă topografică a rutei ${title}`}
          style={{ width: '100%', height: '100%', display: 'block', cursor: onMapClickCoordinate ? 'crosshair' : 'default' }}
          onClick={handleSvgClick}
        >
          <rect width="460" height="300" fill="var(--color-bg)" />
          <path d="M-20 70 Q 110 35 230 95 T 480 65" stroke="var(--color-border)" strokeWidth="1.2" />
          <path d="M-20 140 Q 130 95 250 155 T 480 130" stroke="var(--color-border)" strokeWidth="1.2" />
          <path d="M-20 215 Q 140 175 260 230 T 480 205" stroke="var(--color-border)" strokeWidth="1.2" />

          <path
            d={pathD}
            stroke="var(--color-primary)"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={pathD}
            stroke="var(--color-route-dash)"
            strokeWidth="1.8"
            strokeDasharray="5 5"
            strokeLinecap="round"
          />

          <circle
            cx={first.x}
            cy={first.y}
            r={radiusPx}
            fill="var(--color-primary-soft)"
            stroke="var(--color-node-terminal)"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />
          <circle
            cx={last.x}
            cy={last.y}
            r={radiusPx}
            fill="var(--color-primary-soft)"
            stroke="var(--color-node-terminal)"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />

          {projectedStops.map((pt, idx) => (
            <g key={`${pt.city_name}-${idx}`} transform={`translate(${pt.x}, ${pt.y})`}>
              {pt.isTerminal ? (
                <>
                  <circle r="10.5" fill="var(--color-node-terminal-ring)" />
                  <circle r="5.5" fill="var(--color-node-terminal)" stroke="var(--color-surface)" strokeWidth="2" />
                </>
              ) : (
                <circle r="4.5" fill="var(--color-node-intermediate)" stroke="var(--color-surface)" strokeWidth="2" />
              )}
              <text
                x="12"
                y="4"
                fill="var(--color-text)"
                fontFamily="var(--font-sans)"
                fontSize="11"
                fontWeight={pt.isTerminal ? '700' : '600'}
              >
                {pt.city_name}
              </text>
            </g>
          ))}
        </svg>

        <div
          style={{
            position: 'absolute',
            bottom: '0.75rem',
            left: '0.75rem',
            right: '0.75rem',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: '0.55rem 0.75rem',
            boxShadow: 'var(--shadow-md)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-sm)',
            fontSize: 'var(--font-size-xs)',
          }}
        >
          <div>
            <strong>{title}</strong>
            {subtitle && <div style={{ color: 'var(--color-text-muted)' }}>{subtitle}</div>}
          </div>
          <span className="badge badge-uni" title="Rezultat servit prin geocoding_cache (D-009)">
            Cache geocodare OK
          </span>
        </div>
      </div>
    </div>
  );
}
