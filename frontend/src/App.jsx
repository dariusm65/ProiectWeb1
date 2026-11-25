import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { Navbar } from './components/Navbar.jsx';
import { Footer } from './components/Footer.jsx';
import { LandingSearchPage } from './pages/LandingSearchPage.jsx';
import { AuthPage } from './pages/AuthPage.jsx';
import { SearchResultsPage } from './pages/SearchResultsPage.jsx';
import { RideDetailsPage } from './pages/RideDetailsPage.jsx';
import { PublicProfilePage } from './pages/PublicProfilePage.jsx';
import { PublishRidePage } from './pages/PublishRidePage.jsx';
import { DashboardPage } from './pages/DashboardPage.jsx';
import { RideChatPage } from './pages/RideChatPage.jsx';
import { AdminPage } from './pages/AdminPage.jsx';

export function App() {
  return (
    <>
      <Navbar />
      <main id="top" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
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
      </main>
      <Footer />
    </>
  );
}
