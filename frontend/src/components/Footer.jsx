import React from 'react';

export function Footer() {
  return (
    <footer className="app-footer">
      <div className="footer-inner">
        <div>
          <strong>StudRide</strong> · Carpooling studențesc pe segmente intermediare · ULBS Tehnologii Web
        </div>
        <div>
          Badge universitar: <em>Validat pe domeniu (nu identitate verificată)</em> · 1 loc / rezervare ·{' '}
          <a href="/api/docs" style={{ color: 'var(--color-primary-ink)', fontWeight: 600 }}>
            Documentație API
          </a>
        </div>
      </div>
    </footer>
  );
}
