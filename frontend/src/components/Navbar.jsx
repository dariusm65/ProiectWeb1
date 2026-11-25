import React, { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { notificationsApi, NOTIFY_REFRESH_EVENT } from '../api/client.js';

export function BrandMarkSvg() {
  return (
    <svg
      width="38"
      height="38"
      viewBox="0 0 44 44"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect width="44" height="44" rx="10" fill="var(--color-primary)" />
      <path d="M22 8.5L8 15L22 21.5L36 15L22 8.5Z" fill="var(--color-primary-contrast)" />
      <path
        d="M14.5 19.5V25L22 28.5L29.5 25V19.5L22 23L14.5 19.5Z"
        fill="var(--color-primary-contrast)"
      />
      <path
        d="M21 15.2L11.5 16.8V23.5"
        stroke="var(--color-primary)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M11.5 18.8V23.8"
        stroke="var(--color-primary-contrast)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M10.2 23.6H12.8L13.4 26.6H9.6L10.2 23.6Z" fill="var(--color-primary-contrast)" />
      <path
        d="M23.5 15.2C28.5 15.5 33.5 18.5 34 23.5C34 28.5 29 32.5 22.5 32.5C17 32.5 13.5 33.5 10.5 36.5"
        stroke="var(--color-route-dash)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="1.8 2.8"
      />
      <circle
        cx="34"
        cy="23.5"
        r="2.4"
        fill="var(--color-primary)"
        stroke="var(--color-primary-contrast)"
        strokeWidth="2"
      />
      <circle
        cx="22.5"
        cy="32.5"
        r="2.5"
        fill="var(--color-route-dash)"
        stroke="var(--color-primary-contrast)"
        strokeWidth="1.8"
      />
      <circle
        cx="10.5"
        cy="36.5"
        r="2.4"
        fill="var(--color-primary)"
        stroke="var(--color-primary-contrast)"
        strokeWidth="2"
      />
    </svg>
  );
}

export function Navbar() {
  const { theme, toggleTheme } = useTheme();
  const { user, token, fetchFn, logout } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!user || !token) {
      setUnreadCount(0);
      return undefined;
    }

    let activeController = null;

    const loadUnread = async () => {
      if (activeController) {
        activeController.abort();
      }
      const controller = new AbortController();
      activeController = controller;
      try {
        const data = await notificationsApi.list(
          { unreadOnly: true },
          { fetchFn, signal: controller.signal },
        );
        if (!controller.signal.aborted && typeof data?.unread_count === 'number') {
          setUnreadCount(data.unread_count);
        }
      } catch {
        // Ignore network/abort errors in navbar badge polling
      }
    };

    loadUnread();
    const intervalId = window.setInterval(loadUnread, 15000);
    window.addEventListener(NOTIFY_REFRESH_EVENT, loadUnread);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener(NOTIFY_REFRESH_EVENT, loadUnread);
      if (activeController) {
        activeController.abort();
      }
    };
  }, [user, token, fetchFn]);

  return (
    <header className="app-header">
      <div className="nav-container">
        <Link to="/" className="brand-link" aria-label="StudRide pagina principală">
          <BrandMarkSvg />
          <div className="brand-text">
            <span className="brand-title">
              <span className="stud">Stud</span>
              <span className="ride">Ride</span>
            </span>
            <span className="brand-subtitle">STUDENT CARPOOLING</span>
          </div>
        </Link>

        <nav className="nav-actions" aria-label="Navigație principală">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            Acasă
          </NavLink>
          <NavLink to="/rides" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            Caută cursă
          </NavLink>
          <NavLink to="/publish" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            + Publică cursă
          </NavLink>

          {user && (
            <>
              <NavLink
                to="/dashboard"
                className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              >
                Cursele mele
              </NavLink>
              <NavLink
                to="/notifications"
                className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
                aria-label={
                  unreadCount > 0
                    ? `Notificări (${unreadCount} necitite)`
                    : 'Notificări'
                }
              >
                Notificări
                {unreadCount > 0 && (
                  <span className="nav-badge" data-testid="navbar-unread-badge">
                    {unreadCount}
                  </span>
                )}
              </NavLink>
              {(user.role === 'moderator' || user.role === 'admin') && (
                <NavLink
                  to="/admin"
                  className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
                >
                  Moderare
                </NavLink>
              )}
            </>
          )}

          <button
            type="button"
            className="btn"
            onClick={toggleTheme}
            aria-label="Comută între tema luminoasă și tema întunecată"
          >
            {theme === 'dark' ? 'Temă: Întunecat' : 'Temă: Luminos'}
          </button>

          {user ? (
            <>
              <Link to={`/profile/${user.id}`} className="nav-link">
                {user.full_name}
              </Link>
              <button type="button" className="btn" onClick={logout}>
                Deconectare
              </button>
            </>
          ) : (
            <Link to="/login" className="btn btn-primary">
              Autentificare / Cont nou
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
