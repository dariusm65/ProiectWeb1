import React from 'react';
import { Link } from 'react-router-dom';

export function Footer() {
  return (
    <footer className="app-footer">
      <div className="footer-inner">
        <div>
          <strong>© 2026 StudRide</strong> · Carpooling studențesc în România
        </div>
        <nav aria-label="Navigație subsol" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
          <Link to="/rides" style={{ color: 'var(--color-primary-ink)', fontWeight: 600, textDecoration: 'none' }}>
            Caută curse
          </Link>
          <Link to="/publish" style={{ color: 'var(--color-primary-ink)', fontWeight: 600, textDecoration: 'none' }}>
            Publică o cursă
          </Link>
          <Link to="/login" style={{ color: 'var(--color-primary-ink)', fontWeight: 600, textDecoration: 'none' }}>
            Autentificare
          </Link>
        </nav>
      </div>
    </footer>
  );
}
