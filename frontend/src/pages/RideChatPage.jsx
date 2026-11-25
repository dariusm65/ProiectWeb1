import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { bookingsApi, chatApi, emitNotificationsRefresh, ridesApi } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { UniversityBadge } from '../components/Badges.jsx';
import { ReviewModal } from '../components/ReviewModal.jsx';
import { ReportModal } from '../components/ReportModal.jsx';
import { formatBucharestDate, formatBucharestTime } from '../domain/bucharestTime.js';
import { useDocumentMeta } from '../hooks/useDocumentMeta.js';

export function RideChatPage() {
  const { rideId } = useParams();
  const { user, fetchFn } = useAuth();

  const [details, setDetails] = useState(null);
  const [messages, setMessages] = useState([]);
  const [myBookingOnRide, setMyBookingOnRide] = useState(null);
  const [loading, setLoading] = useState(true);
  const [accessError, setAccessError] = useState('');
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [bookingActionBusy, setBookingActionBusy] = useState(false);
  const [actionFeedback, setActionFeedback] = useState('');
  const [reviewTarget, setReviewTarget] = useState(null);
  const [reportTarget, setReportTarget] = useState(null);

  const activeControllerRef = useRef(null);

  useDocumentMeta({
    title: details?.ride
      ? `StudRide · Chat Cursă ${details.ride.origin_name} → ${details.ride.destination_name}`
      : 'StudRide · Chatul Cursei',
    description:
      'Grup de comunicare pentru șoferul și pasagerii confirmați ai cursei StudRide, cu reconfirmare rapidă și evaluare după sosire.',
  });

  const loadChatData = useCallback(
    async (isInitial = false) => {
      if (!user) {
        setLoading(false);
        return;
      }
      if (activeControllerRef.current) {
        activeControllerRef.current.abort();
      }
      const controller = new AbortController();
      activeControllerRef.current = controller;
      const { signal } = controller;

      if (isInitial) {
        setLoading(true);
      }
      try {
        const [rideRes, msgRes, myBookingsRes] = await Promise.all([
          ridesApi.getDetails(rideId, { fetchFn, signal }),
          chatApi.listMessages(rideId, { fetchFn, signal }),
          bookingsApi.listMine({ fetchFn, signal }).catch(() => ({ bookings: [] })),
        ]);
        if (signal.aborted) return;

        setDetails(rideRes);
        setMessages(Array.isArray(msgRes?.messages) ? msgRes.messages : []);
        const matchingBooking = (myBookingsRes?.bookings || []).find(
          (b) =>
            Number(b.ride_id) === Number(rideId) &&
            ['confirmed', 'pending_reconfirmation'].includes(b.status),
        );
        setMyBookingOnRide(matchingBooking || null);
        setAccessError('');
      } catch (err) {
        if (signal.aborted || err?.name === 'AbortError') return;
        if (err?.statusCode === 403) {
          setAccessError(
            'Accesul la chatul cursei este permis exclusiv șoferului și pasagerilor cu rezervare confirmată sau în curs de reconfirmare.',
          );
        } else {
          setAccessError(err?.message || 'Chatul cursei nu a putut fi încărcat.');
        }
      } finally {
        if (!signal.aborted) {
          setLoading(false);
        }
      }
    },
    [rideId, user, fetchFn],
  );

  // Lightweight 8s polling fetches ONLY messages (aborting any previous in-flight request)
  const pollMessagesOnly = useCallback(async () => {
    if (!user) return;
    if (activeControllerRef.current) {
      activeControllerRef.current.abort();
    }
    const controller = new AbortController();
    activeControllerRef.current = controller;
    const { signal } = controller;

    try {
      const msgRes = await chatApi.listMessages(rideId, { fetchFn, signal });
      if (signal.aborted) return;
      setMessages(Array.isArray(msgRes?.messages) ? msgRes.messages : []);
      setAccessError('');
    } catch (err) {
      if (signal.aborted || err?.name === 'AbortError') return;
      if (err?.statusCode === 403) {
        setAccessError(
          'Accesul la chatul cursei este permis exclusiv șoferului și pasagerilor cu rezervare confirmată sau în curs de reconfirmare.',
        );
      }
    }
  }, [rideId, user, fetchFn]);

  useEffect(() => {
    loadChatData(true);

    const intervalId = window.setInterval(() => {
      pollMessagesOnly();
    }, 8000);

    return () => {
      window.clearInterval(intervalId);
      if (activeControllerRef.current) {
        activeControllerRef.current.abort();
      }
    };
  }, [loadChatData, pollMessagesOnly]);

  if (!user) {
    return (
      <div className="dashboard-shell">
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <h1>Autentificare necesară pentru chatul cursei</h1>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
            Pentru a citi sau trimite mesaje în grupul cursei, autentifică-te în contul tău StudRide.
          </p>
          <div>
            <Link to="/login" className="btn btn-primary">
              Autentificare
            </Link>
          </div>
        </section>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="dashboard-shell">
        <section className="card" role="status" aria-live="polite">
          <h1>Se încarcă chatul cursei...</h1>
        </section>
      </div>
    );
  }

  if (accessError) {
    return (
      <div className="dashboard-shell">
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <h1>Chatul cursei nu este disponibil</h1>
          <div className="status-banner error" role="alert">
            <span>
              <strong>Acces restricționat:</strong> {accessError}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <Link to={`/rides/${rideId}`} className="btn">
              ← Înapoi la detaliile cursei
            </Link>
            <Link to="/dashboard" className="btn btn-primary">
              Mergi la cursele mele
            </Link>
          </div>
        </section>
      </div>
    );
  }

  const ride = details?.ride;
  const driver = details?.driver;
  const isDriver = Number(user.id) === Number(ride?.driver_id);
  const isRideCancelled = ride?.status === 'cancelled';
  const hasArrived =
    ride?.estimated_arrival_time &&
    new Date(ride.estimated_arrival_time).getTime() <= Date.now();
  const canReviewDriver =
    !isDriver &&
    !isRideCancelled &&
    myBookingOnRide?.status === 'confirmed' &&
    (ride?.status === 'completed' || hasArrived);
  const stopWasRemoved = Boolean(
    myBookingOnRide?.pickup_stop_removed || myBookingOnRide?.dropoff_stop_removed,
  );

  const handleSendMessage = async (e) => {
    e.preventDefault();
    setActionFeedback('');
    const trimmed = messageText.trim();
    if (!trimmed) return;

    setSending(true);
    try {
      const res = await chatApi.postMessage(
        rideId,
        { message_text: trimmed },
        { fetchFn },
      );
      if (res?.message) {
        setMessages((prev) => [...prev, res.message]);
      }
      setMessageText('');
      emitNotificationsRefresh();
    } catch (err) {
      setActionFeedback(err?.message || 'Mesajul nu a putut fi trimis.');
    } finally {
      setSending(false);
    }
  };

  const handleQuickReconfirm = async () => {
    if (!myBookingOnRide || bookingActionBusy) return;
    setBookingActionBusy(true);
    setActionFeedback('');
    try {
      await bookingsApi.reconfirm(myBookingOnRide.id, { fetchFn });
      setActionFeedback('Rezervarea ta a fost reconfirmată cu succes!');
      emitNotificationsRefresh();
      await loadChatData(false);
    } catch (err) {
      setActionFeedback(err?.message || 'Reconfirmarea a eșuat.');
    } finally {
      setBookingActionBusy(false);
    }
  };

  const handleQuickCancel = async () => {
    if (!myBookingOnRide || bookingActionBusy) return;
    setBookingActionBusy(true);
    setActionFeedback('');
    try {
      await bookingsApi.cancel(myBookingOnRide.id, { fetchFn });
      emitNotificationsRefresh();
      await loadChatData(false);
    } catch (err) {
      setActionFeedback(err?.message || 'Anularea rezervării a eșuat.');
    } finally {
      setBookingActionBusy(false);
    }
  };

  return (
    <div className="dashboard-shell">
      <section className="card" aria-labelledby="ride-chat-heading" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
          <div>
            <span className="badge badge-uni">Comunicare privată participanți confirmați</span>
            <h1
              id="ride-chat-heading"
              style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-2xl)', letterSpacing: '-0.02em', marginTop: '0.35rem' }}
            >
              Chat cursă: {ride?.origin_name} → {ride?.destination_name}
            </h1>
            <p className="tabular" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
              {formatBucharestDate(ride?.departure_time)} · Plecare {formatBucharestTime(ride?.departure_time)} · Sosire estimată{' '}
              {formatBucharestTime(ride?.estimated_arrival_time)} · Șofer: <strong>{driver?.full_name}</strong>
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn"
              onClick={() => pollMessagesOnly()}
            >
              Actualizează mesajele
            </button>
            <Link to={`/rides/${rideId}`} className="btn">
              Detalii cursă
            </Link>
            <Link to="/dashboard" className="btn">
              Cursele mele
            </Link>
            {canReviewDriver && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() =>
                  setReviewTarget({
                    rideId: ride.id,
                    reviewedUserId: ride.driver_id,
                    reviewedUserName: driver?.full_name || 'Șofer',
                    roleLabel: 'șoferul',
                  })
                }
              >
                ★ Evaluează șoferul
              </button>
            )}
          </div>
        </div>

        {myBookingOnRide?.status === 'pending_reconfirmation' && (
          <div className="status-banner warning" role="status">
            <div>
              <strong>Reconfirmare necesară:</strong> Șoferul a actualizat opririle traseului. Prețul tău blocat (
              <strong>{myBookingOnRide.price_lei} lei</strong>) nu s-a schimbat.
              {myBookingOnRide.reconfirm_deadline && (
                <span>
                  {' '}
                  Termen limită:{' '}
                  <strong>
                    {formatBucharestDate(myBookingOnRide.reconfirm_deadline)}{' '}
                    {formatBucharestTime(myBookingOnRide.reconfirm_deadline)}
                  </strong>
                  .
                </span>
              )}
              {stopWasRemoved && (
                <div style={{ color: 'var(--color-error)', marginTop: '0.25rem' }}>
                  Oprirea ta de urcare sau coborâre a fost eliminată de șofer. Te rugăm să anulezi rezervarea gratuit.
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={stopWasRemoved || bookingActionBusy}
                onClick={handleQuickReconfirm}
              >
                Reconfirmă locul ({myBookingOnRide.price_lei} lei)
              </button>
              <button
                type="button"
                className="btn"
                disabled={bookingActionBusy}
                onClick={handleQuickCancel}
              >
                Anulează gratuit
              </button>
            </div>
          </div>
        )}

        {actionFeedback && (
          <div className="status-banner warning" role="status">
            <span>{actionFeedback}</span>
          </div>
        )}

        <div className="chat-feed" role="log" aria-label="Istoric mesaje cursă">
          {messages.length === 0 ? (
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
              Niciun mesaj în această cursă încă. Salută participanții și stabilește detaliile întâlnirii!
            </p>
          ) : (
            messages.map((msg) => {
              const isOwn = Number(msg.sender_id) === Number(user.id);
              return (
                <article
                  key={msg.id}
                  className={isOwn ? 'chat-bubble own' : 'chat-bubble'}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: 'var(--font-size-xs)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <strong>{msg.sender?.full_name}</strong>
                      <UniversityBadge hasBadge={msg.sender?.has_university_badge} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span className="tabular" style={{ color: 'var(--color-text-muted)' }}>
                        {formatBucharestDate(msg.created_at)} {formatBucharestTime(msg.created_at)}
                      </span>
                      {!isOwn && (
                        <button
                          type="button"
                          className="chip-btn"
                          aria-label={`Raportează mesajul de la ${msg.sender?.full_name || 'participant'}`}
                          onClick={() =>
                            setReportTarget({
                              messageId: msg.id,
                              rideId: Number(rideId),
                              reportedUserId: msg.sender_id ?? null,
                              targetLabel: `mesajul lui ${msg.sender?.full_name || 'participant'}`,
                            })
                          }
                        >
                          Raportează
                        </button>
                      )}
                    </div>
                  </div>
                  <p style={{ fontSize: 'var(--font-size-sm)', whiteSpace: 'pre-wrap' }}>
                    {msg.message_text}
                  </p>
                </article>
              );
            })
          )}
        </div>

        {isRideCancelled ? (
          <div className="status-banner error" role="status">
            <span>Această cursă a fost anulată. Istoricul mesajelor rămâne vizibil, dar nu se mai pot trimite mesaje noi.</span>
          </div>
        ) : (
          <form onSubmit={handleSendMessage} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '220px' }}>
              <label htmlFor="chat-message-input" className="sr-only">
                Mesaj pentru participanții la cursă
              </label>
              <input
                id="chat-message-input"
                type="text"
                className="input"
                maxLength={2000}
                placeholder="Scrie un mesaj pentru participanții la cursă..."
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={sending || !messageText.trim()}
            >
              {sending ? 'Se trimite...' : 'Trimite mesajul'}
            </button>
          </form>
        )}
      </section>

      <ReviewModal
        isOpen={Boolean(reviewTarget)}
        onClose={() => setReviewTarget(null)}
        rideId={reviewTarget?.rideId}
        reviewedUserId={reviewTarget?.reviewedUserId}
        reviewedUserName={reviewTarget?.reviewedUserName}
        roleLabel={reviewTarget?.roleLabel}
      />

      <ReportModal
        isOpen={Boolean(reportTarget)}
        onClose={() => setReportTarget(null)}
        messageId={reportTarget?.messageId}
        rideId={reportTarget?.rideId}
        reportedUserId={reportTarget?.reportedUserId}
        targetLabel={reportTarget?.targetLabel}
      />
    </div>
  );
}
