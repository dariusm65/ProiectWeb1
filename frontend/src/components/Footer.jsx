import React from 'react';

export function Footer() {
  return (
    <footer className="app-footer">
      <div className="footer-inner">
        <div>
          <strong>StudRide (P18)</strong> · Carpooling studențesc pe segmente intermediare · ULBS Tehnologii Web
        </div>
        <div>
          Badge universitar: <em>Validat pe domeniu (nu identitate verificată)</em> (D-004) · 1 loc / rezervare (D-019) ·{' '}
          <a href="/api/docs" style={{ color: 'var(--color-primary-ink)', fontWeight: 600 }}>
            OpenAPI Docs
          </a>
        </div>
      </div>
    </footer>
  );
}
