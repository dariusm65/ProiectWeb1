import React, { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Navbar } from './components/Navbar.jsx';
import { Footer } from './components/Footer.jsx';
import { LandingSearchPage } from './pages/LandingSearchPage.jsx';

const AuthPage = lazy(() =>
  import('./pages/AuthPage.jsx').then((m) => ({ default: m.AuthPage })),
);
const SearchResultsPage = lazy(() =>
  import('./pages/SearchResultsPage.jsx').then((m) => ({ default: m.SearchResultsPage })),
);
const RideDetailsPage = lazy(() =>
  import('./pages/RideDetailsPage.jsx').then((m) => ({ default: m.RideDetailsPage })),
);
const PublicProfilePage = lazy(() =>
  import('./pages/PublicProfilePage.jsx').then((m) => ({ default: m.PublicProfilePage })),
);
const PublishRidePage = lazy(() =>
  import('./pages/PublishRidePage.jsx').then((m) => ({ default: m.PublishRidePage })),
);
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage.jsx').then((m) => ({ default: m.DashboardPage })),
);
const RideChatPage = lazy(() =>
  import('./pages/RideChatPage.jsx').then((m) => ({ default: m.RideChatPage })),
);
const AdminPage = lazy(() =>
  import('./pages/AdminPage.jsx').then((m) => ({ default: m.AdminPage })),
);

export function App() {
  return (
    <>
      <Navbar />
      <main id="top" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Suspense
          fallback={
            <div
              role="status"
              aria-live="polite"
              style={{
                maxWidth: '1240px',
                width: '100%',
                margin: '0 auto',
                padding: 'var(--space-xl) var(--space-lg)',
                color: 'var(--color-text-muted)',
              }}
            >
              Se încarcă pagina…
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<LandingSearchPage />} />
            <Route path="/login" element={<AuthPage />} />
            <Route path="/rides" element={<SearchResultsPage />} />
            <Route path="/rides/:rideId" element={<RideDetailsPage />} />
            <Route path="/rides/:rideId/chat" element={<RideChatPage />} />
            <Route path="/publish" element={<PublishRidePage />} />
            <Route path="/dashboard" element={<DashboardPage defaultTab="passenger" />} />
            <Route path="/notifications" element={<DashboardPage defaultTab="notifications" />} />
            <Route path="/profile/:userId" element={<PublicProfilePage />} />
            <Route path="/admin" element={<AdminPage />} />
          </Routes>
        </Suspense>
      </main>
      <Footer />
    </>
  );
}
