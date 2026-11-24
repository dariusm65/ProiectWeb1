import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { reviewsApi } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

export function ReviewModal({
  isOpen,
  onClose,
  rideId,
  reviewedUserId,
  reviewedUserName,
  roleLabel = 'participant',
  onReviewSubmitted,
}) {
  const { fetchFn } = useAuth();
  const [ratingStars, setRatingStars] = useState(5);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [submittedReview, setSubmittedReview] = useState(null);

  const onCloseRef = useRef(onClose);
  const modalCardRef = useRef(null);
  const closeBtnRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Reset form state ONLY when target ride/user or open state changes (never when parent re-renders inline onClose)
  useEffect(() => {
    if (!isOpen) return;
    setRatingStars(5);
    setComment('');
    setErrorMsg('');
    setSubmittedReview(null);
  }, [isOpen, rideId, reviewedUserId]);

  // Focus management, Tab focus trapping, Escape key close, and focus restoration
  useEffect(() => {
    if (!isOpen) return undefined;

    previousFocusRef.current = document.activeElement;
    if (closeBtnRef.current) {
      closeBtnRef.current.focus();
    }

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (typeof onCloseRef.current === 'function') {
          onCloseRef.current();
        }
        return;
      }

      if (e.key === 'Tab' && modalCardRef.current) {
        const focusable = Array.from(
          modalCardRef.current.querySelectorAll(
            'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (
        previousFocusRef.current &&
        typeof previousFocusRef.current.focus === 'function' &&
        document.contains(previousFocusRef.current)
      ) {
        previousFocusRef.current.focus();
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSubmitting(true);
    try {
      const trimmedComment = comment.trim();
      const res = await reviewsApi.create(
        rideId,
        {
          reviewed_user_id: Number(reviewedUserId),
          rating_stars: Number(ratingStars),
          comment: trimmedComment.length > 0 ? trimmedComment : null,
        },
        { fetchFn },
      );
      setSubmittedReview(res.review);
      if (typeof onReviewSubmitted === 'function') {
        onReviewSubmitted(res.review);
      }
    } catch (err) {
      if (err?.code === 'DUPLICATE_REVIEW') {
        setErrorMsg('Ai trimis deja o evaluare pentru acest participant la această cursă.');
      } else if (err?.code === 'REVIEW_BEFORE_ARRIVAL') {
        setErrorMsg('Evaluările sunt disponibile exclusiv după ora estimată a sosirii.');
      } else if (err?.code === 'RIDE_CANCELLED') {
        setErrorMsg('Nu se pot acorda evaluări cu stele pentru cursele anulate.');
      } else {
        setErrorMsg(err?.message || 'Evaluarea nu a putut fi salvată.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-card" ref={modalCardRef}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)' }}>
          <h2
            id="review-modal-title"
            style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-xl)' }}
          >
            Evaluează {roleLabel}: {reviewedUserName}
          </h2>
          <button
            ref={closeBtnRef}
            type="button"
            className="btn"
            aria-label="Închide fereastra de evaluare"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
          Evaluările mutuale (1–5 stele) reflectă experiența călătoriei comune și sunt afișate pe profilul public.
        </p>

        {errorMsg && (
          <div className="status-banner error" role="alert">
            <span>
              <strong>Eroare:</strong> {errorMsg}
            </span>
          </div>
        )}

        {submittedReview ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            <div className="status-banner success" role="status" aria-live="polite">
              <span>
                Evaluarea ta de <strong>{submittedReview.rating_stars} stele</strong> pentru{' '}
                <strong>{reviewedUserName}</strong> a fost înregistrată!
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
              <Link
                to={`/profile/${reviewedUserId}`}
                className="btn"
                onClick={onClose}
              >
                Vezi profilul public actualizat →
              </Link>
              <button type="button" className="btn btn-primary" onClick={onClose}>
                Închide
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            <div className="field">
              <span className="field-label">Selectează calificativul (1–5 stele)</span>
              <div
                role="group"
                aria-label="Calificativ în stele"
                style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}
              >
                {[5, 4, 3, 2, 1].map((stars) => (
                  <button
                    key={stars}
                    type="button"
                    aria-pressed={ratingStars === stars}
                    className={ratingStars === stars ? 'chip-btn active' : 'chip-btn'}
                    onClick={() => setRatingStars(stars)}
                  >
                    {'★'.repeat(stars)} ({stars}/5)
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label htmlFor="review-comment-input">Comentariu opțional (max. 1000 caractere)</label>
              <textarea
                id="review-comment-input"
                className="input"
                rows={3}
                maxLength={1000}
                placeholder="Cum a decurs călătoria? (punctualitate, comunicare, confort)"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                style={{ minHeight: '84px', paddingTop: '0.6rem' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" className="btn" onClick={onClose} disabled={submitting}>
                Renunță
              </button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'Se trimite...' : 'Trimite evaluarea'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
