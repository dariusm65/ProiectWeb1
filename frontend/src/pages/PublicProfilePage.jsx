import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { usersApi } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import {
  UniversityBadge,
  RecentCancellationBadge,
  ReputationRow,
} from '../components/Badges.jsx';
import { formatBucharestDate } from '../domain/bucharestTime.js';
import { useDocumentMeta } from '../hooks/useDocumentMeta.js';

export function PublicProfilePage() {
  const { userId } = useParams();
  const { fetchFn } = useAuth();

  const [profile, setProfile] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useDocumentMeta({
    title: profile
      ? `StudRide · Profil Public ${profile.full_name} & Reputație`
      : 'StudRide · Profil Public Student & Reputație Dublă',
    description:
      'Profil public student StudRide cu rating 1–5 stele după sosire, scor de seriozitate 0%–100% și badge universitar validat pe domeniu.',
  });

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const data = await usersApi.getPublicProfileAndReviews(userId, { fetchFn });
        if (!active) return;
        setProfile(data.user);
        setReviews(Array.isArray(data.reviews) ? data.reviews : []);
      } catch (err) {
        if (!active) return;
        setError(err.message || 'Profilul nu a putut fi încărcat.');
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [userId, fetchFn]);

  if (loading) {
    return (
      <div className="main-layout">
        <div className="card">
          <h1>Se încarcă profilul public...</h1>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="main-layout">
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-xl)' }}>
            Profilul public nu este disponibil
          </h1>
          <div className="status-banner error" role="alert">
            <div>
              <strong>Eroare:</strong> {error || 'Utilizatorul nu a fost găsit.'}
            </div>
            <Link to="/rides" className="btn">
              Înapoi la curse
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1040px', width: '100%', margin: '0 auto', padding: 'var(--space-xl) var(--space-lg)', display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
      <section className="card" aria-labelledby="profile-heading" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
          <div>
            <h1 id="profile-heading" style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-2xl)' }}>
              {profile.full_name}
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
              <UniversityBadge hasBadge={profile.has_university_badge} />
              <RecentCancellationBadge hasRecentCancellation={profile.has_recent_cancellation_badge} />
            </div>
          </div>

          <div className="tabular" style={{ display: 'flex', gap: 'var(--space-xl)' }}>
            <div>
              <div style={{ fontSize: '1.65rem', fontWeight: 700, color: 'var(--color-accent)' }}>
                ★ {profile.rating_average !== null ? Number(profile.rating_average).toFixed(1) : '—'}
              </div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                {profile.rating_count} evaluări
              </div>
            </div>
            <div>
              <div style={{ fontSize: '1.65rem', fontWeight: 700, color: 'var(--color-success)' }}>
                {profile.seriousness_score}%
              </div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                Scor seriozitate
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="card" aria-labelledby="reviews-section-heading" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <h2 id="reviews-section-heading" style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-xl)' }}>
          Evaluări mutuale după finalizarea curselor ({reviews.length})
        </h2>

        {reviews.length === 0 ? (
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
            Acest student nu a primit încă evaluări după curse finalizate.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {reviews.map((rev) => (
              <article
                key={rev.id}
                style={{
                  padding: 'var(--space-md)',
                  background: 'var(--color-bg)',
                  border: '1px solid var(--color-border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.35rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                    <strong>{rev.reviewer?.full_name}</strong>
                    <UniversityBadge
                      hasBadge={rev.reviewer?.has_university_badge}
                    />
                  </div>
                  <span className="tabular" style={{ color: 'var(--color-accent)', fontWeight: 700, fontSize: 'var(--font-size-sm)' }}>
                    {'★'.repeat(rev.rating_stars)} ({rev.rating_stars}/5) · {formatBucharestDate(rev.created_at)}
                  </span>
                </div>
                {rev.comment && <p style={{ fontSize: 'var(--font-size-sm)' }}>{rev.comment}</p>}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
