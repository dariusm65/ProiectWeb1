import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  bookingsApi,
  emitNotificationsRefresh,
  notificationsApi,
  recurringRidesApi,
  ridesApi,
} from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { UniversityBadge, WomenOnlyBadge } from '../components/Badges.jsx';
import { ReviewModal } from '../components/ReviewModal.jsx';
import {
  buildIsoTimestampFromDateAndTime,
  formatBucharestDate,
  formatBucharestTime,
} from '../domain/bucharestTime.js';
import { useDocumentMeta } from '../hooks/useDocumentMeta.js';

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

function isWithinFourHoursOfDeparture(departureIso) {
  if (!departureIso) return false;
  const depMs = new Date(departureIso).getTime();
  const nowMs = Date.now();
  const diff = depMs - nowMs;
  return diff > 0 && diff < FOUR_HOURS_MS;
}

function hasArrivalPassed(arrivalIso) {
  if (!arrivalIso) return false;
  return new Date(arrivalIso).getTime() <= Date.now();
}

function isSameBucharestDay(departureIso) {
  if (!departureIso) return false;
  return formatBucharestDate(departureIso) === formatBucharestDate(new Date().toISOString());
}

function formatBookingStatusBadge(booking) {
  const rideStatus = booking.ride?.status;
  const arrived = hasArrivalPassed(booking.ride?.estimated_arrival_time);

  if (booking.status === 'confirmed' && (rideStatus === 'completed' || (rideStatus !== 'cancelled' && arrived))) {
    return { label: 'Finalizată', className: 'badge badge-uni' };
  }
  switch (booking.status) {
    case 'pending':
      return { label: 'În așteptare', className: 'badge badge-amber' };
    case 'confirmed':
      return { label: 'Confirmată', className: 'badge badge-uni' };
    case 'pending_reconfirmation':
      return { label: 'Reconfirmare necesară', className: 'badge badge-amber' };
    case 'rejected':
      return { label: 'Respinsă', className: 'badge badge-cancel' };
    case 'cancelled':
      return { label: 'Anulată', className: 'badge badge-cancel' };
    case 'expired':
      return { label: 'Expirată', className: 'badge badge-cancel' };
    default:
      return { label: booking.status, className: 'badge' };
  }
}

export function DashboardPage({ defaultTab = 'passenger' }) {
  const { user, fetchFn } = useAuth();
  const [activeTab, setActiveTab] = useState(defaultTab);

  const [myBookings, setMyBookings] = useState([]);
  const [myRides, setMyRides] = useState([]);
  const [myRules, setMyRules] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadOnlyFilter, setUnreadOnlyFilter] = useState(false);

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [actionBanner, setActionBanner] = useState(null);

  // Two-step confirmation states
  const [confirmCancelBookingId, setConfirmCancelBookingId] = useState(null);
  const [confirmCancelRideId, setConfirmCancelRideId] = useState(null);

  // Inline stop editor state for driver rides
  const [editingRideId, setEditingRideId] = useState(null);
  const [editDate, setEditDate] = useState('2026-12-04');
  const [editTime, setEditTime] = useState('16:00');
  const [editableStops, setEditableStops] = useState([]);

  // Recurring rule skip-date form state
  const [exceptionDatesByRule, setExceptionDatesByRule] = useState({});
  const [exceptionReasonsByRule, setExceptionReasonsByRule] = useState({});

  // Review modal target
  const [reviewTarget, setReviewTarget] = useState(null);

  useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab]);

  useDocumentMeta({
    title:
      defaultTab === 'notifications'
        ? 'StudRide · Notificările Mele în Aplicație'
        : 'StudRide · Cursele și Rezervările Mele',
    description:
      'Gestionează rezervările tale pe segmente, reconfirmările de traseu, cursele publicate ca șofer, excepțiile recurente și notificările din aplicație.',
  });

  const loadDashboardData = useCallback(
    async (signal) => {
      if (!user) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setErrorMsg('');
      try {
        const [bookingsRes, ridesRes, rulesRes, notifsRes] = await Promise.all([
          bookingsApi.listMine({ fetchFn, signal }),
          ridesApi.listMine({ fetchFn, signal }),
          recurringRidesApi.listMine({ fetchFn, signal }),
          notificationsApi.list({ unreadOnly: unreadOnlyFilter }, { fetchFn, signal }),
        ]);
        if (signal?.aborted) return;
        setMyBookings(Array.isArray(bookingsRes?.bookings) ? bookingsRes.bookings : []);
        setMyRides(Array.isArray(ridesRes?.rides) ? ridesRes.rides : []);
        setMyRules(Array.isArray(rulesRes?.rules) ? rulesRes.rules : []);
        setNotifications(Array.isArray(notifsRes?.notifications) ? notifsRes.notifications : []);
        setUnreadCount(typeof notifsRes?.unread_count === 'number' ? notifsRes.unread_count : 0);
      } catch (err) {
        if (signal?.aborted || err?.name === 'AbortError') return;
        setErrorMsg(err?.message || 'Datele panoului nu au putut fi încărcate.');
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [user, fetchFn, unreadOnlyFilter],
  );

  useEffect(() => {
    const controller = new AbortController();
    loadDashboardData(controller.signal);
    return () => {
      controller.abort();
    };
  }, [loadDashboardData]);

  if (!user) {
    return (
      <div className="dashboard-shell">
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <h1>Autentificare necesară pentru panoul curselor</h1>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
            Pentru a vedea rezervările tale, cursele publicate și notificările, autentifică-te în contul tău StudRide.
          </p>
          <div>
            <Link to="/login" className="btn btn-primary">
              Mergi la autentificare
            </Link>
          </div>
        </section>
      </div>
    );
  }

  const handleReconfirmBooking = async (bookingId) => {
    setActionBanner(null);
    try {
      await bookingsApi.reconfirm(bookingId, { fetchFn });
      setActionBanner({
        type: 'success',
        text: 'Rezervarea a fost reconfirmată cu succes! Prețul tău blocat a rămas neschimbat.',
      });
      emitNotificationsRefresh();
      await loadDashboardData();
    } catch (err) {
      setActionBanner({
        type: 'error',
        text: err?.message || 'Reconfirmarea rezervării a eșuat.',
      });
    }
  };

  const handleCancelBooking = async (bookingId) => {
    setActionBanner(null);
    try {
      const res = await bookingsApi.cancel(bookingId, { fetchFn });
      setConfirmCancelBookingId(null);
      const fee = res?.booking?.cancellation_fee_lei;
      setActionBanner({
        type: 'success',
        text:
          fee != null
            ? `Rezervarea a fost anulată. Taxă de anulare târzie înregistrată: ${fee} lei (de achitat direct șoferului).`
            : 'Rezervarea a fost anulată fără penalități.',
      });
      emitNotificationsRefresh();
      await loadDashboardData();
    } catch (err) {
      setActionBanner({
        type: 'error',
        text: err?.message || 'Anularea rezervării a eșuat.',
      });
    }
  };

  const handleAcceptBooking = async (bookingId) => {
    setActionBanner(null);
    try {
      const res = await bookingsApi.accept(bookingId, { fetchFn });
      const autoRejCount = Array.isArray(res?.auto_rejected_ids) ? res.auto_rejected_ids.length : 0;
      setActionBanner({
        type: 'success',
        text:
          autoRejCount > 0
            ? `Rezervare acceptată! ${autoRejCount} cereri concurente pe segmentele epuizate au fost respinse automat.`
            : 'Rezervarea pasagerului a fost acceptată!',
      });
      emitNotificationsRefresh();
      await loadDashboardData();
    } catch (err) {
      setActionBanner({
        type: 'error',
        text: err?.message || 'Acceptarea rezervării a eșuat.',
      });
    }
  };

  const handleRejectBooking = async (bookingId) => {
    setActionBanner(null);
    try {
      await bookingsApi.reject(bookingId, { fetchFn });
      setActionBanner({
        type: 'success',
        text: 'Cererea de rezervare a fost respinsă.',
      });
      emitNotificationsRefresh();
      await loadDashboardData();
    } catch (err) {
      setActionBanner({
        type: 'error',
        text: err?.message || 'Respingerea cererii a eșuat.',
      });
    }
  };

  const handleCancelRide = async (rideId) => {
    setActionBanner(null);
    try {
      const res = await ridesApi.cancel(rideId, { fetchFn });
      setConfirmCancelRideId(null);
      setActionBanner({
        type: 'success',
        text: res?.infraction_recorded
          ? 'Cursa a fost anulată. Deoarece plecarea avea loc astăzi și existau pasageri confirmați, a fost aplicată penalizarea de seriozitate (-5 pp) și restricția de publicare de 7 zile.'
          : 'Cursa a fost anulată și pasagerii au fost notificați.',
      });
      emitNotificationsRefresh();
      await loadDashboardData();
    } catch (err) {
      setActionBanner({
        type: 'error',
        text: err?.message || 'Anularea cursei a eșuat.',
      });
    }
  };

  const handleCompleteRide = async (rideId) => {
    setActionBanner(null);
    try {
      await ridesApi.complete(rideId, { fetchFn });
      setActionBanner({
        type: 'success',
        text: 'Cursa a fost marcată ca finalizată! Acum poți evalua pasagerii confirmați.',
      });
      await loadDashboardData();
    } catch (err) {
      setActionBanner({
        type: 'error',
        text: err?.message || 'Cursa poate fi marcată ca finalizată doar după ora estimată a sosirii.',
      });
    }
  };

  const openStopEditor = (rideItem) => {
    const depIso = rideItem.ride.departure_time;
    const depMs = new Date(depIso).getTime();
    const isoDate = new Date(depIso).toISOString().slice(0, 10);
    const buchTime = formatBucharestTime(depIso);

    setEditingRideId(rideItem.ride.id);
    setEditDate(isoDate);
    setEditTime(/^\d{2}:\d{2}$/.test(buchTime) ? buchTime : '16:00');
    setEditableStops(
      rideItem.stops.map((s, idx) => {
        const stopMs = new Date(s.estimated_arrival_time).getTime();
        const diffMin = idx === 0 ? 0 : Math.max(10, Math.round((stopMs - depMs) / 60000));
        return {
          id: s.id,
          city_name: s.city_name,
          location_name: s.location_name,
          latitude: s.latitude,
          longitude: s.longitude,
          distance_from_origin_km: idx === 0 ? 0 : s.distance_from_origin_km,
          offset_minutes: diffMin,
        };
      }),
    );
  };

  const handleEditStopField = (idx, field, val) => {
    setEditableStops((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, [field]: val } : s)),
    );
  };

  const handleAddEditorStop = () => {
    setEditableStops((prev) => {
      if (prev.length >= 20) return prev;
      const last = prev[prev.length - 1];
      const beforeLast = prev[prev.length - 2] || prev[0];
      const midKm = Math.max(
        Number(beforeLast.distance_from_origin_km) + 10,
        Math.round((Number(beforeLast.distance_from_origin_km) + Number(last.distance_from_origin_km)) / 2),
      );
      const midMin = Math.max(
        Number(beforeLast.offset_minutes) + 15,
        Math.round((Number(beforeLast.offset_minutes) + Number(last.offset_minutes)) / 2),
      );
      const bumpedLast = {
        ...last,
        distance_from_origin_km: Math.max(Number(last.distance_from_origin_km), midKm + 15),
        offset_minutes: Math.max(Number(last.offset_minutes), midMin + 20),
      };
      const newStop = {
        city_name: 'Sebeș',
        location_name: 'Centru Sebeș',
        latitude: 45.9597,
        longitude: 23.5681,
        distance_from_origin_km: midKm,
        offset_minutes: midMin,
      };
      return [...prev.slice(0, -1), newStop, bumpedLast];
    });
  };

  const handleRemoveEditorStop = (idx) => {
    setEditableStops((prev) => {
      if (prev.length <= 2) return prev;
      const next = prev.filter((_, i) => i !== idx);
      next[0] = { ...next[0], distance_from_origin_km: 0, offset_minutes: 0 };
      return next;
    });
  };

  const handleSaveEditedStops = async (rideId) => {
    setActionBanner(null);
    try {
      const payloadStops = editableStops.map((s, idx) => {
        const stopObj = {
          city_name: String(s.city_name).trim(),
          location_name: String(s.location_name).trim(),
          latitude: Number(s.latitude),
          longitude: Number(s.longitude),
          distance_from_origin_km: idx === 0 ? 0 : Number(s.distance_from_origin_km),
          estimated_arrival_time: buildIsoTimestampFromDateAndTime(
            editDate,
            editTime,
            idx === 0 ? 0 : Number(s.offset_minutes),
          ),
        };
        if (s.id != null) {
          stopObj.id = Number(s.id);
        }
        return stopObj;
      });

      await ridesApi.editStops(rideId, { stops: payloadStops }, { fetchFn });
      setEditingRideId(null);
      setActionBanner({
        type: 'success',
        text: 'Traseul și opririle au fost actualizate! Pasagerii confirmați afectați au fost notificați pentru reconfirmare (cu prețul lor blocat neschimbat).',
      });
      emitNotificationsRefresh();
      await loadDashboardData();
    } catch (err) {
      setActionBanner({
        type: 'error',
        text: err?.message || 'Actualizarea opririlor a eșuat.',
      });
    }
  };

  const handleAddRuleException = async (ruleId) => {
    setActionBanner(null);
    const exceptionDate = exceptionDatesByRule[ruleId] || '';
    const reason = exceptionReasonsByRule[ruleId] || '';
    if (!exceptionDate) {
      setActionBanner({
        type: 'error',
        text: 'Selectează data calendaristică pe care dorești să o omiți din regula recurentă.',
      });
      return;
    }
    try {
      await recurringRidesApi.addException(
        ruleId,
        {
          exception_date: exceptionDate,
          reason: reason.trim() || null,
        },
        { fetchFn },
      );
      setActionBanner({
        type: 'success',
        text: `Data ${exceptionDate} a fost exclusă din regula recurentă.`,
      });
      emitNotificationsRefresh();
      await loadDashboardData();
    } catch (err) {
      setActionBanner({
        type: 'error',
        text: err?.message || 'Excepția nu a putut fi adăugată.',
      });
    }
  };

  const handleMarkOneRead = async (notificationId) => {
    try {
      const res = await notificationsApi.markRead(notificationId, { fetchFn });
      setNotifications((prev) =>
        unreadOnlyFilter
          ? prev.filter((n) => n.id !== notificationId)
          : prev.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n)),
      );
      if (typeof res?.unread_count === 'number') {
        setUnreadCount(res.unread_count);
      }
      emitNotificationsRefresh();
    } catch (err) {
      setActionBanner({
        type: 'error',
        text: err?.message || 'Notificarea nu a putut fi marcată ca citită.',
      });
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await notificationsApi.markAllRead({ fetchFn });
      setNotifications((prev) =>
        unreadOnlyFilter ? [] : prev.map((n) => ({ ...n, is_read: true })),
      );
      setUnreadCount(0);
      emitNotificationsRefresh();
    } catch (err) {
      setActionBanner({
        type: 'error',
        text: err?.message || 'Notificările nu au putut fi marcate ca citite.',
      });
    }
  };

  return (
    <div className="dashboard-shell">
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-2xl)', letterSpacing: '-0.02em' }}>
              {defaultTab === 'notifications' ? 'Notificările mele' : 'Cursele și rezervările mele'}
            </h1>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
              Gestionează rezervările ca pasager, cursele publicate ca șofer, reconfirmările de traseu și alertele din aplicație.
            </p>
          </div>
          <Link to="/publish" className="btn btn-primary">
            + Publică o cursă nouă
          </Link>
        </div>

        <div className="tabs-three" role="tablist" aria-label="Secțiuni panou utilizator">
          <button
            id="tab-passenger"
            type="button"
            className="tab-btn"
            role="tab"
            aria-selected={activeTab === 'passenger'}
            aria-controls="panel-passenger"
            onClick={() => setActiveTab('passenger')}
          >
            Rezervările mele ca pasager ({myBookings.length})
          </button>
          <button
            id="tab-driver"
            type="button"
            className="tab-btn"
            role="tab"
            aria-selected={activeTab === 'driver'}
            aria-controls="panel-driver"
            onClick={() => setActiveTab('driver')}
          >
            Cursele publicate ca șofer ({myRides.length})
          </button>
          <button
            id="tab-notifications"
            type="button"
            className="tab-btn"
            role="tab"
            aria-selected={activeTab === 'notifications'}
            aria-controls="panel-notifications"
            onClick={() => setActiveTab('notifications')}
          >
            Notificări ({unreadCount} necitite)
          </button>
        </div>

        {errorMsg && (
          <div className="status-banner error" role="alert">
            <span>
              <strong>Eroare:</strong> {errorMsg}
            </span>
          </div>
        )}

        {actionBanner && (
          <div
            className={`status-banner ${actionBanner.type === 'error' ? 'error' : 'success'}`}
            role={actionBanner.type === 'error' ? 'alert' : 'status'}
          >
            <span>{actionBanner.text}</span>
          </div>
        )}
      </section>

      {loading && (
        <section className="card">
          <p>Se încarcă datele panoului...</p>
        </section>
      )}

      {!loading && activeTab === 'passenger' && (
        <section
          id="panel-passenger"
          role="tabpanel"
          aria-labelledby="tab-passenger"
          className="card"
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}
        >
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-xl)' }}>
            Rezervările mele ca pasager ({myBookings.length})
          </h2>

          {myBookings.length === 0 ? (
            <div className="dashboard-item">
              <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                Nu ai încă nicio rezervare ca pasager. Caută un traseu pe segmente pentru a rezerva un loc.
              </p>
              <div>
                <Link to="/rides" className="btn btn-primary">
                  Caută o cursă
                </Link>
              </div>
            </div>
          ) : (
            myBookings.map((booking) => {
              const statusBadge = formatBookingStatusBadge(booking);
              const isConfirmed = booking.status === 'confirmed';
              const isPending = booking.status === 'pending';
              const isPendingReconfirm = booking.status === 'pending_reconfirmation';
              const isCompletedTrip =
                isConfirmed &&
                booking.ride?.status !== 'cancelled' &&
                (booking.ride?.status === 'completed' || hasArrivalPassed(booking.ride?.estimated_arrival_time));
              const canAccessChat = isConfirmed || isPendingReconfirm;
              const canCancel =
                (isPending || isConfirmed || isPendingReconfirm) &&
                booking.ride?.status === 'active' &&
                !isCompletedTrip;
              const isLateCancel =
                isConfirmed && isWithinFourHoursOfDeparture(booking.ride?.departure_time);
              const stopWasRemoved = Boolean(
                booking.pickup_stop_removed || booking.dropoff_stop_removed,
              );

              return (
                <article key={booking.id} className="dashboard-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div>
                      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-lg)' }}>
                        {booking.ride?.origin_name} → {booking.ride?.destination_name} · Segment:{' '}
                        {booking.pickup_stop_name} → {booking.dropoff_stop_name}
                      </h3>
                      <p className="tabular" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                        <span>
                          {formatBucharestDate(booking.ride?.departure_time)} · Plecare{' '}
                          {formatBucharestTime(booking.ride?.departure_time)} · Sosire{' '}
                          {formatBucharestTime(booking.ride?.estimated_arrival_time)}
                        </span>
                        {booking.ride?.driver_name && (
                          <>
                            <span>· Șofer: <strong>{booking.ride.driver_name}</strong></span>
                            <UniversityBadge hasBadge={booking.ride.driver_has_university_badge} />
                          </>
                        )}
                        <WomenOnlyBadge womenOnly={booking.ride?.women_only} />
                      </p>
                    </div>

                    <div className="tabular" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span className={statusBadge.className}>{statusBadge.label}</span>
                      <strong style={{ color: 'var(--color-primary-ink)' }}>{booking.price_lei} lei (1 loc)</strong>
                    </div>
                  </div>

                  {booking.cancellation_fee_lei != null && (
                    <div className="status-banner error">
                      <span>
                        <strong>Taxă de anulare târzie datorată șoferului:</strong>{' '}
                        {booking.cancellation_fee_lei} lei (50% din prețul segmentului, plafonat la 20 lei, de achitat direct între studenți în afara aplicației).
                      </span>
                    </div>
                  )}

                  {isPendingReconfirm && (
                    <div className="status-banner warning">
                      <div>
                        <strong>Modificare traseu sau orar:</strong> Șoferul a modificat opririle cursei. Prețul tău blocat (
                        <strong>{booking.price_lei} lei</strong>) rămâne neschimbat.
                        {booking.reconfirm_deadline && (
                          <span>
                            {' '}
                            Termen limită reconfirmare:{' '}
                            <strong>
                              {formatBucharestDate(booking.reconfirm_deadline)}{' '}
                              {formatBucharestTime(booking.reconfirm_deadline)}
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
                          disabled={stopWasRemoved}
                          onClick={() => handleReconfirmBooking(booking.id)}
                        >
                          Reconfirmă locul ({booking.price_lei} lei)
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => handleCancelBooking(booking.id)}
                        >
                          Anulează gratuit
                        </button>
                      </div>
                    </div>
                  )}

                  {confirmCancelBookingId === booking.id && (
                    <div className="status-banner warning" role="alert">
                      <div>
                        {isLateCancel ? (
                          <span>
                            <strong>Atenție — anulare cu mai puțin de 4 ore înainte de plecare:</strong>{' '}
                            Anularea acestei rezervări confirmate va scădea scorul tău de seriozitate cu{' '}
                            <strong>3 puncte procentuale</strong> și va înregistra o taxă de anulare de{' '}
                            <strong>{Math.min(20, Math.round(booking.price_lei * 0.5))} lei</strong> (50% din prețul segmentului, maximum 20 lei), datorată direct șoferului.
                          </span>
                        ) : (
                          <span>
                            Confirmi anularea rezervării pentru segmentul{' '}
                            <strong>
                              {booking.pickup_stop_name} → {booking.dropoff_stop_name}
                            </strong>
                            ? Nu se aplică nicio penalizare.
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => handleCancelBooking(booking.id)}
                        >
                          Confirmă anularea
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => setConfirmCancelBookingId(null)}
                        >
                          Renunță
                        </button>
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <Link to={`/rides/${booking.ride_id}`} className="btn">
                      Detalii cursă
                    </Link>
                    {canAccessChat && (
                      <Link to={`/rides/${booking.ride_id}/chat`} className="btn">
                        Deschide chatul cursei
                      </Link>
                    )}
                    {canCancel && !isPendingReconfirm && confirmCancelBookingId !== booking.id && (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setConfirmCancelBookingId(booking.id)}
                      >
                        Anulează rezervarea
                      </button>
                    )}
                    {isCompletedTrip && (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() =>
                          setReviewTarget({
                            rideId: booking.ride_id,
                            reviewedUserId: booking.ride?.driver_id,
                            reviewedUserName: booking.ride?.driver_name || `Șofer #${booking.ride?.driver_id}`,
                            roleLabel: 'șoferul',
                          })
                        }
                      >
                        ★ Evaluează șoferul
                      </button>
                    )}
                  </div>
                </article>
              );
            })
          )}
        </section>
      )}

      {!loading && activeTab === 'driver' && (
        <section
          id="panel-driver"
          role="tabpanel"
          aria-labelledby="tab-driver"
          className="card"
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-xl)' }}>
              Cursele publicate ca șofer ({myRides.length})
            </h2>

            {myRides.length === 0 ? (
              <div className="dashboard-item">
                <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                  Nu ai publicat încă nicio cursă ca șofer.
                </p>
                <div>
                  <Link to="/publish" className="btn btn-primary">
                    Publică prima ta cursă
                  </Link>
                </div>
              </div>
            ) : (
              myRides.map((item) => {
                const { ride, stops = [], bookings = [] } = item;
                const isActive = ride.status === 'active';
                const isCompleted = ride.status === 'completed';
                const arrived = hasArrivalPassed(ride.estimated_arrival_time);
                const canReviewPassengers =
                  ride.status !== 'cancelled' && (isCompleted || arrived);
                const hasSeatHolders = bookings.some(
                  (b) => b.status === 'confirmed' || b.status === 'pending_reconfirmation',
                );
                const isSameDayCancelRisk = isSameBucharestDay(ride.departure_time) && hasSeatHolders;

                return (
                  <article key={ride.id} className="dashboard-item">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div>
                        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-lg)' }}>
                          {stops.length > 0
                            ? stops.map((s) => s.city_name).join(' → ')
                            : `${ride.origin_name} → ${ride.destination_name}`}
                        </h3>
                        <p className="tabular" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                          {formatBucharestDate(ride.departure_time)} · Plecare{' '}
                          {formatBucharestTime(ride.departure_time)} · Sosire{' '}
                          {formatBucharestTime(ride.estimated_arrival_time)} · {ride.available_seats} locuri pasageri · Cost declarat:{' '}
                          <strong>{ride.declared_trip_cost} lei</strong>
                        </p>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                        <span
                          className={
                            ride.status === 'cancelled'
                              ? 'badge badge-cancel'
                              : 'badge badge-uni'
                          }
                        >
                          {ride.status === 'active'
                            ? 'Activă'
                            : ride.status === 'completed'
                              ? 'Finalizată'
                              : 'Anulată'}
                        </span>
                        <WomenOnlyBadge womenOnly={ride.women_only} />
                        <Link to={`/rides/${ride.id}`} className="btn">
                          Detalii
                        </Link>
                        <Link to={`/rides/${ride.id}/chat`} className="btn">
                          Chat cursă
                        </Link>
                        {isActive && (
                          <>
                            <button
                              type="button"
                              className="btn"
                              onClick={() =>
                                editingRideId === ride.id
                                  ? setEditingRideId(null)
                                  : openStopEditor(item)
                              }
                            >
                              {editingRideId === ride.id ? 'Închide editorul' : 'Editează opririle'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-primary"
                              onClick={() => handleCompleteRide(ride.id)}
                            >
                              Marchează finalizată
                            </button>
                            <button
                              type="button"
                              className="btn"
                              onClick={() => setConfirmCancelRideId(ride.id)}
                            >
                              Anulează cursa
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {confirmCancelRideId === ride.id && (
                      <div className="status-banner warning" role="alert">
                        <div>
                          {isSameDayCancelRisk ? (
                            <span>
                              <strong>Atenție — anulare în ziua plecării cu pasageri confirmați:</strong>{' '}
                              Anularea acestei curse va scădea scorul tău de seriozitate cu{' '}
                              <strong>5 puncte procentuale</strong>, va afișa eticheta{' '}
                              <strong>„Anulare recentă”</strong> timp de 30 de zile și va bloca publicarea de curse noi timp de{' '}
                              <strong>7 zile</strong>.
                            </span>
                          ) : (
                            <span>
                              Confirmi anularea cursei{' '}
                              <strong>
                                {ride.origin_name} → {ride.destination_name}
                              </strong>
                              ? Toate rezervările active vor fi anulate și pasagerii vor fi notificați.
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => handleCancelRide(ride.id)}
                          >
                            Confirmă anularea cursei
                          </button>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => setConfirmCancelRideId(null)}
                          >
                            Renunță
                          </button>
                        </div>
                      </div>
                    )}

                    {editingRideId === ride.id && (
                      <div
                        style={{
                          padding: 'var(--space-md)',
                          background: 'var(--color-surface)',
                          border: '1px solid var(--color-border)',
                          borderRadius: 'var(--radius-md)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 'var(--space-sm)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                          <strong>Editor opriri și orar cursă</strong>
                          <button type="button" className="btn" onClick={handleAddEditorStop}>
                            + Adaugă oprire intermediară
                          </button>
                        </div>
                        <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                          Modificarea sau eliminarea unei opriri va solicita reconfirmarea pasagerilor confirmați pe segmentele afectate, păstrând neschimbat prețul blocat la rezervare.
                        </p>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)' }}>
                          <div className="field">
                            <label htmlFor={`edit-date-${ride.id}`}>Data plecării</label>
                            <input
                              id={`edit-date-${ride.id}`}
                              type="date"
                              className="input"
                              value={editDate}
                              onChange={(e) => setEditDate(e.target.value)}
                            />
                          </div>
                          <div className="field">
                            <label htmlFor={`edit-time-${ride.id}`}>Ora plecării (ora României)</label>
                            <input
                              id={`edit-time-${ride.id}`}
                              type="time"
                              className="input"
                              value={editTime}
                              onChange={(e) => setEditTime(e.target.value)}
                            />
                          </div>
                        </div>

                        {editableStops.map((st, idx) => (
                          <div
                            key={st.id || `new-${idx}`}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '1fr 1.2fr 100px 120px auto',
                              gap: 'var(--space-xs)',
                              alignItems: 'end',
                            }}
                          >
                            <div className="field">
                              <label htmlFor={`ed-city-${ride.id}-${idx}`}>Oraș #{idx + 1}</label>
                              <input
                                id={`ed-city-${ride.id}-${idx}`}
                                type="text"
                                className="input"
                                value={st.city_name}
                                onChange={(e) => handleEditStopField(idx, 'city_name', e.target.value)}
                              />
                            </div>
                            <div className="field">
                              <label htmlFor={`ed-loc-${ride.id}-${idx}`}>Punct întâlnire #{idx + 1}</label>
                              <input
                                id={`ed-loc-${ride.id}-${idx}`}
                                type="text"
                                className="input"
                                value={st.location_name}
                                onChange={(e) => handleEditStopField(idx, 'location_name', e.target.value)}
                              />
                            </div>
                            <div className="field">
                              <label htmlFor={`ed-km-${ride.id}-${idx}`}>Km</label>
                              <input
                                id={`ed-km-${ride.id}-${idx}`}
                                type="number"
                                min="0"
                                className="input"
                                disabled={idx === 0}
                                value={idx === 0 ? 0 : st.distance_from_origin_km}
                                onChange={(e) =>
                                  handleEditStopField(idx, 'distance_from_origin_km', Number(e.target.value))
                                }
                              />
                            </div>
                            <div className="field">
                              <label htmlFor={`ed-min-${ride.id}-${idx}`}>+ Minute</label>
                              <input
                                id={`ed-min-${ride.id}-${idx}`}
                                type="number"
                                min="0"
                                className="input"
                                disabled={idx === 0}
                                value={idx === 0 ? 0 : st.offset_minutes}
                                onChange={(e) =>
                                  handleEditStopField(idx, 'offset_minutes', Number(e.target.value))
                                }
                              />
                            </div>
                            <div>
                              {editableStops.length > 2 && idx > 0 && idx < editableStops.length - 1 && (
                                <button
                                  type="button"
                                  className="btn"
                                  aria-label={`Elimină oprirea ${idx + 1}`}
                                  onClick={() => handleRemoveEditorStop(idx)}
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          </div>
                        ))}

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => setEditingRideId(null)}
                          >
                            Anulează editarea
                          </button>
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => handleSaveEditedStops(ride.id)}
                          >
                            Salvează opririle actualizate
                          </button>
                        </div>
                      </div>
                    )}

                    <div
                      style={{
                        borderTop: '1px solid var(--color-border-subtle)',
                        paddingTop: '0.6rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.45rem',
                      }}
                    >
                      <strong style={{ fontSize: 'var(--font-size-xs)', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
                        Rezervări pasageri pe această cursă ({bookings.length})
                      </strong>

                      {bookings.length === 0 ? (
                        <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                          Nicio cerere de rezervare înregistrată încă pentru această cursă.
                        </p>
                      ) : (
                        bookings.map((b) => {
                          const bBadge = formatBookingStatusBadge({ ...b, ride });
                          return (
                            <div
                              key={b.id}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                flexWrap: 'wrap',
                                gap: '0.5rem',
                                padding: '0.45rem 0.65rem',
                                background: 'var(--color-surface)',
                                border: '1px solid var(--color-border-subtle)',
                                borderRadius: 'var(--radius-sm)',
                                fontSize: 'var(--font-size-sm)',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                                <Link
                                  to={`/profile/${b.passenger?.id}`}
                                  style={{ color: 'var(--color-text)', fontWeight: 700, textDecoration: 'none' }}
                                >
                                  {b.passenger?.full_name}
                                </Link>
                                <UniversityBadge hasBadge={b.passenger?.has_university_badge} />
                                <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)' }}>
                                  {b.pickup_stop_name} → {b.dropoff_stop_name}
                                </span>
                                <strong className="tabular">{b.price_lei} lei</strong>
                                <span className={bBadge.className}>{bBadge.label}</span>
                                {b.cancellation_fee_lei != null && (
                                  <span className="badge badge-cancel">
                                    Taxă anulare datorată: {b.cancellation_fee_lei} lei
                                  </span>
                                )}
                              </div>

                              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                                {isActive && b.status === 'pending' && (
                                  <>
                                    <button
                                      type="button"
                                      className="btn btn-primary"
                                      onClick={() => handleAcceptBooking(b.id)}
                                    >
                                      Acceptă
                                    </button>
                                    <button
                                      type="button"
                                      className="btn"
                                      onClick={() => handleRejectBooking(b.id)}
                                    >
                                      Respinge
                                    </button>
                                  </>
                                )}
                                {canReviewPassengers && b.status === 'confirmed' && (
                                  <button
                                    type="button"
                                    className="btn btn-primary"
                                    onClick={() =>
                                      setReviewTarget({
                                        rideId: ride.id,
                                        reviewedUserId: b.passenger_id,
                                        reviewedUserName: b.passenger?.full_name || `Pasager #${b.passenger_id}`,
                                        roleLabel: 'pasagerul',
                                      })
                                    }
                                  >
                                    ★ Evaluează pasagerul
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </article>
                );
              })
            )}
          </div>

          {myRules.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-md)' }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-xl)' }}>
                Reguli de curse recurente ({myRules.length})
              </h2>
              {myRules.map(({ rule, exceptions = [] }) => (
                <article key={rule.id} className="dashboard-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div>
                      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-lg)' }}>
                        {rule.origin_name} → {rule.destination_name} (Ora {String(rule.departure_time).slice(0, 5)})
                      </h3>
                      <p className="tabular" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                        Valabil: {rule.start_date} – {rule.end_date || 'nedeterminat'} · Zile:{' '}
                        {Array.isArray(rule.days_of_week) ? rule.days_of_week.join(', ') : ''} · {rule.available_seats} locuri · Cost: {rule.declared_trip_cost} lei
                      </p>
                    </div>
                  </div>

                  {exceptions.length > 0 && (
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                      Date excluse (excepții):{' '}
                      {exceptions.map((ex) => `${ex.exception_date}${ex.reason ? ` (${ex.reason})` : ''}`).join(', ')}
                    </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'end', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                    <div className="field">
                      <label htmlFor={`exc-date-${rule.id}`}>Omite o dată calendaristică</label>
                      <input
                        id={`exc-date-${rule.id}`}
                        type="date"
                        className="input"
                        value={exceptionDatesByRule[rule.id] || ''}
                        onChange={(e) =>
                          setExceptionDatesByRule((prev) => ({ ...prev, [rule.id]: e.target.value }))
                        }
                      />
                    </div>
                    <div className="field" style={{ flex: 1, minWidth: '180px' }}>
                      <label htmlFor={`exc-reason-${rule.id}`}>Motiv opțional</label>
                      <input
                        id={`exc-reason-${rule.id}`}
                        type="text"
                        className="input"
                        placeholder="Ex.: Vacanță / Sesiune"
                        value={exceptionReasonsByRule[rule.id] || ''}
                        onChange={(e) =>
                          setExceptionReasonsByRule((prev) => ({ ...prev, [rule.id]: e.target.value }))
                        }
                      />
                    </div>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => handleAddRuleException(rule.id)}
                    >
                      Adaugă excepție
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {!loading && activeTab === 'notifications' && (
        <section
          id="panel-notifications"
          role="tabpanel"
          aria-labelledby="tab-notifications"
          className="card"
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-xl)' }}>
              Notificări în aplicație ({unreadCount} necitite)
            </h2>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className={unreadOnlyFilter ? 'chip-btn active' : 'chip-btn'}
                aria-pressed={unreadOnlyFilter}
                onClick={() => setUnreadOnlyFilter((prev) => !prev)}
              >
                {unreadOnlyFilter ? 'Afișează toate notificările' : 'Doar necitite'}
              </button>
              <button
                type="button"
                className="btn"
                disabled={unreadCount === 0}
                onClick={handleMarkAllRead}
              >
                Marchează toate ca citite
              </button>
            </div>
          </div>

          {notifications.length === 0 ? (
            <div className="dashboard-item">
              <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                {unreadOnlyFilter
                  ? 'Nu ai nicio notificare necitită în acest moment.'
                  : 'Nu ai primit încă notificări în aplicație.'}
              </p>
            </div>
          ) : (
            notifications.map((notif) => (
              <article
                key={notif.id}
                className={notif.is_read ? 'dashboard-item' : 'dashboard-item unread'}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                    <strong>{notif.title}</strong>
                    {!notif.is_read ? (
                      <span className="badge badge-amber">Necitită</span>
                    ) : (
                      <span className="badge">Citită</span>
                    )}
                    <span className="tabular" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                      {formatBucharestDate(notif.created_at)} {formatBucharestTime(notif.created_at)}
                    </span>
                  </div>

                  {!notif.is_read && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => handleMarkOneRead(notif.id)}
                    >
                      Marchează citită
                    </button>
                  )}
                </div>
                <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>
                  {notif.message}
                </p>
              </article>
            ))
          )}
        </section>
      )}

      <ReviewModal
        isOpen={Boolean(reviewTarget)}
        onClose={() => setReviewTarget(null)}
        rideId={reviewTarget?.rideId}
        reviewedUserId={reviewTarget?.reviewedUserId}
        reviewedUserName={reviewTarget?.reviewedUserName}
        roleLabel={reviewTarget?.roleLabel}
        onReviewSubmitted={() => {
          emitNotificationsRefresh();
        }}
      />
    </div>
  );
}
