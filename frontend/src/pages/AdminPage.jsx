import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, emitNotificationsRefresh } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import {
  UniversityBadge,
  RecentCancellationBadge,
} from '../components/Badges.jsx';
import { formatBucharestDate, formatBucharestTime } from '../domain/bucharestTime.js';
import { formatReportReasonLabel } from '../domain/reportReasons.js';
import { useDocumentMeta } from '../hooks/useDocumentMeta.js';

const REPORT_STATUS_LABELS = {
  pending: 'În așteptare',
  resolved: 'Rezolvat',
  dismissed: 'Respins',
};

const ROLE_LABELS = {
  user: 'Student',
  moderator: 'Moderator',
  admin: 'Administrator',
};

export function AdminPage() {
  const { user, status: authStatus, fetchFn } = useAuth();

  const isModeratorOrAdmin = Boolean(user && (user.role === 'moderator' || user.role === 'admin'));
  const isAdmin = Boolean(user && user.role === 'admin');

  const [activeTab, setActiveTab] = useState('reports');
  const [reportStatusFilter, setReportStatusFilter] = useState('pending');
  const [reports, setReports] = useState([]);
  const [loadingReports, setLoadingReports] = useState(false);

  const [userSearchInput, setUserSearchInput] = useState('');
  const [appliedUserSearch, setAppliedUserSearch] = useState('');
  const [usersList, setUsersList] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(false);

  const [errorMsg, setErrorMsg] = useState('');
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [busyActionKey, setBusyActionKey] = useState('');

  // Confirm modal state for destructive moderation actions:
  // { type: 'suspend' | 'cancel_ride', targetId, title, description, defaultReason }
  const [confirmAction, setConfirmAction] = useState(null);
  const [confirmReason, setConfirmReason] = useState('');

  const reportsControllerRef = useRef(null);
  const usersControllerRef = useRef(null);
  const statsControllerRef = useRef(null);
  const confirmModalRef = useRef(null);
  const confirmCloseRef = useRef(null);
  const previousFocusRef = useRef(null);

  useDocumentMeta({
    title: 'StudRide · Panou Moderare & Administrare',
    description:
      'Panou de moderare și administrare StudRide pentru gestionarea raportărilor, suspendarea conturilor cu anulare în cascadă și statisticile platformei.',
  });

  const loadReports = useCallback(
    async (statusFilter) => {
      if (!isModeratorOrAdmin) return;
      if (reportsControllerRef.current) {
        reportsControllerRef.current.abort();
      }
      const controller = new AbortController();
      reportsControllerRef.current = controller;
      const { signal } = controller;

      setLoadingReports(true);
      setErrorMsg('');
      try {
        const res = await adminApi.listReports(
          { status: statusFilter || '', limit: 100 },
          { fetchFn, signal },
        );
        if (signal.aborted) return;
        setReports(Array.isArray(res?.reports) ? res.reports : []);
      } catch (err) {
        if (signal.aborted || err?.name === 'AbortError') return;
        setErrorMsg(err?.message || 'Coada de raportări nu a putut fi încărcată.');
      } finally {
        if (!signal.aborted) {
          setLoadingReports(false);
        }
      }
    },
    [isModeratorOrAdmin, fetchFn],
  );

  const loadUsers = useCallback(
    async (qFilter) => {
      if (!isModeratorOrAdmin) return;
      if (usersControllerRef.current) {
        usersControllerRef.current.abort();
      }
      const controller = new AbortController();
      usersControllerRef.current = controller;
      const { signal } = controller;

      setLoadingUsers(true);
      setErrorMsg('');
      try {
        const res = await adminApi.listUsers(
          { q: qFilter || '', limit: 100 },
          { fetchFn, signal },
        );
        if (signal.aborted) return;
        setUsersList(Array.isArray(res?.users) ? res.users : []);
      } catch (err) {
        if (signal.aborted || err?.name === 'AbortError') return;
        setErrorMsg(err?.message || 'Lista de utilizatori nu a putut fi încărcată.');
      } finally {
        if (!signal.aborted) {
          setLoadingUsers(false);
        }
      }
    },
    [isModeratorOrAdmin, fetchFn],
  );

  const loadStats = useCallback(async () => {
    // Only admin role may call GET /api/admin/stats (moderators never trigger a 403)
    if (!isAdmin) return;
    if (statsControllerRef.current) {
      statsControllerRef.current.abort();
    }
    const controller = new AbortController();
    statsControllerRef.current = controller;
    const { signal } = controller;

    setLoadingStats(true);
    try {
      const res = await adminApi.getStats({ fetchFn, signal });
      if (signal.aborted) return;
      setStats(res?.stats ?? res ?? null);
    } catch (err) {
      if (signal.aborted || err?.name === 'AbortError') return;
    } finally {
      if (!signal.aborted) {
        setLoadingStats(false);
      }
    }
  }, [isAdmin, fetchFn]);

  useEffect(() => {
    if (!isModeratorOrAdmin) return undefined;
    loadReports(reportStatusFilter);
    return () => {
      if (reportsControllerRef.current) {
        reportsControllerRef.current.abort();
      }
    };
  }, [isModeratorOrAdmin, reportStatusFilter, loadReports]);

  useEffect(() => {
    if (!isModeratorOrAdmin || activeTab !== 'users') return undefined;
    loadUsers(appliedUserSearch);
    return () => {
      if (usersControllerRef.current) {
        usersControllerRef.current.abort();
      }
    };
  }, [isModeratorOrAdmin, activeTab, appliedUserSearch, loadUsers]);

  useEffect(() => {
    if (!isAdmin) return undefined;
    loadStats();
    return () => {
      if (statsControllerRef.current) {
        statsControllerRef.current.abort();
      }
    };
  }, [isAdmin, loadStats]);

  // WAI-ARIA dialog focus management, Tab focus trap, Escape close, and focus restoration
  useEffect(() => {
    if (!confirmAction) return undefined;
    previousFocusRef.current = document.activeElement;
    if (confirmCloseRef.current) {
      confirmCloseRef.current.focus();
    }
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setConfirmAction(null);
        return;
      }
      if (e.key === 'Tab' && confirmModalRef.current) {
        const focusable = Array.from(
          confirmModalRef.current.querySelectorAll(
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
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (
        previousFocusRef.current &&
        typeof previousFocusRef.current.focus === 'function' &&
        document.contains(previousFocusRef.current)
      ) {
        previousFocusRef.current.focus();
      }
    };
  }, [confirmAction]);

  if (authStatus === 'loading') {
    return (
      <div className="dashboard-shell">
        <section className="card" role="status" aria-live="polite">
          <h1>Se verifică permisiunile contului...</h1>
        </section>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="dashboard-shell">
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-xl)' }}>
            Autentificare necesară pentru panoul de moderare
          </h1>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
            Panoul de moderare și administrare este accesibil exclusiv conturilor cu rol de moderator sau administrator.
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

  if (!isModeratorOrAdmin) {
    return (
      <div className="dashboard-shell">
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-xl)' }}>
            Acces interzis (403)
          </h1>
          <div className="status-banner error" role="alert">
            <span>
              <strong>Permisiuni insuficiente:</strong> Acest panou este restricționat moderatorilor și administratorilor
              StudRide.
            </span>
          </div>
          <div>
            <Link to="/dashboard" className="btn">
              Înapoi la cursele mele
            </Link>
          </div>
        </section>
      </div>
    );
  }

  const selectTab = (nextTab) => {
    setErrorMsg('');
    setFeedbackMsg('');
    setActiveTab(nextTab);
  };

  const handleTabListKeyDown = (e) => {
    const tabOrder = ['reports', 'users'];
    const currentIdx = tabOrder.indexOf(activeTab);
    if (currentIdx === -1) return;
    let nextIdx = -1;
    if (e.key === 'ArrowRight') {
      nextIdx = (currentIdx + 1) % tabOrder.length;
    } else if (e.key === 'ArrowLeft') {
      nextIdx = (currentIdx - 1 + tabOrder.length) % tabOrder.length;
    } else if (e.key === 'Home') {
      nextIdx = 0;
    } else if (e.key === 'End') {
      nextIdx = tabOrder.length - 1;
    }
    if (nextIdx !== -1) {
      e.preventDefault();
      const nextTab = tabOrder[nextIdx];
      selectTab(nextTab);
      const nextBtn = document.getElementById(`tab-admin-${nextTab}`);
      if (nextBtn) nextBtn.focus();
    }
  };

  const handleResolveOrDismiss = async (reportId, nextStatus) => {
    if (busyActionKey) return;
    const key = `report:${reportId}:${nextStatus}`;
    setBusyActionKey(key);
    setErrorMsg('');
    setFeedbackMsg('');
    try {
      await adminApi.resolveReport(reportId, { status: nextStatus }, { fetchFn });
      setFeedbackMsg(
        nextStatus === 'resolved'
          ? `Raportarea #${reportId} a fost marcată ca rezolvată.`
          : `Raportarea #${reportId} a fost respinsă.`,
      );
      await loadReports(reportStatusFilter);
      if (isAdmin) await loadStats();
    } catch (err) {
      setErrorMsg(err?.message || 'Starea raportării nu a putut fi actualizată.');
    } finally {
      setBusyActionKey('');
    }
  };

  const handleUnsuspend = async (targetUser) => {
    if (busyActionKey) return;
    const key = `unsuspend:${targetUser.id}`;
    setBusyActionKey(key);
    setErrorMsg('');
    setFeedbackMsg('');
    try {
      await adminApi.unsuspendUser(targetUser.id, { fetchFn });
      setFeedbackMsg(`Contul lui ${targetUser.full_name} a fost reactivat.`);
      emitNotificationsRefresh();
      if (activeTab === 'users') {
        await loadUsers(appliedUserSearch);
      } else {
        await loadReports(reportStatusFilter);
      }
      if (isAdmin) await loadStats();
    } catch (err) {
      setErrorMsg(err?.message || 'Contul nu a putut fi reactivat.');
    } finally {
      setBusyActionKey('');
    }
  };

  const handleRoleChange = async (targetUser, nextRole) => {
    if (busyActionKey) return;
    const key = `role:${targetUser.id}:${nextRole}`;
    setBusyActionKey(key);
    setErrorMsg('');
    setFeedbackMsg('');
    try {
      await adminApi.changeUserRole(targetUser.id, { role: nextRole }, { fetchFn });
      setFeedbackMsg(
        `Rolul utilizatorului ${targetUser.full_name} a fost schimbat în ${ROLE_LABELS[nextRole] || nextRole}.`,
      );
      await loadUsers(appliedUserSearch);
    } catch (err) {
      setErrorMsg(err?.message || 'Rolul utilizatorului nu a putut fi modificat.');
    } finally {
      setBusyActionKey('');
    }
  };

  const handleExecuteConfirmAction = async (e) => {
    e.preventDefault();
    if (!confirmAction || busyActionKey) return;
    const { type, targetId, targetName } = confirmAction;
    const key = `${type}:${targetId}`;
    setBusyActionKey(key);
    setErrorMsg('');
    setFeedbackMsg('');

    try {
      const trimmedReason = confirmReason.trim() || null;
      if (type === 'suspend') {
        const res = await adminApi.suspendUser(
          targetId,
          trimmedReason ? { reason: trimmedReason } : {},
          { fetchFn },
        );
        setFeedbackMsg(
          `Contul ${targetName} a fost suspendat (curse viitoare anulate: ${res.cancelled_rides ?? 0}, rezervări pasager anulate: ${res.cancelled_passenger_bookings ?? 0}).`,
        );
      } else if (type === 'cancel_ride') {
        const res = await adminApi.cancelRide(
          targetId,
          trimmedReason ? { reason: trimmedReason } : {},
          { fetchFn },
        );
        setFeedbackMsg(
          `Cursa ${targetName} a fost anulată administrativ (${res.cancelled_bookings ?? 0} rezervări active anulate, fără penalizare de seriozitate).`,
        );
      }
      setConfirmAction(null);
      setConfirmReason('');
      emitNotificationsRefresh();
      await loadReports(reportStatusFilter);
      if (activeTab === 'users') {
        await loadUsers(appliedUserSearch);
      }
      if (isAdmin) await loadStats();
    } catch (err) {
      setErrorMsg(err?.message || 'Acțiunea de moderare a eșuat.');
    } finally {
      setBusyActionKey('');
    }
  };

  const canActorSuspendTarget = (targetRole, targetId) => {
    if (!targetId || Number(targetId) === Number(user.id)) return false;
    if (targetRole === 'admin') return false;
    if (user.role === 'moderator' && targetRole !== 'user') return false;
    return true;
  };

  return (
    <div className="dashboard-shell">
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span className="badge badge-uni">
                Rol activ: {ROLE_LABELS[user.role] || user.role}
              </span>
              <span className="badge badge-amber">Control acces verificat pe server</span>
            </div>
            <h1
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--font-size-2xl)',
                marginTop: '0.35rem',
              }}
            >
              Panou de Moderare &amp; Administrare
            </h1>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
              Gestionează raportările comunității, anulează cursele problematice și suspendă conturile abuzive cu anulare
              automată în cascadă a curselor și rezervărilor viitoare.
            </p>
          </div>

          <button
            type="button"
            className="btn"
            onClick={() => {
              loadReports(reportStatusFilter);
              if (activeTab === 'users') loadUsers(appliedUserSearch);
              if (isAdmin) loadStats();
            }}
          >
            Reîmprospătează datele
          </button>
        </div>

        {isAdmin && stats && (
          <div className="admin-metrics-grid" aria-label="Statistici globale platformă">
            <div className="admin-metric-card tabular">
              <span className="admin-metric-label">Raportări în așteptare</span>
              <strong className="admin-metric-value" style={{ color: stats.pending_reports > 0 ? 'var(--color-warning)' : 'var(--color-success)' }}>
                {stats.pending_reports}
              </strong>
              <span className="admin-metric-sub">din {stats.total_reports} raportări totale</span>
            </div>
            <div className="admin-metric-card tabular">
              <span className="admin-metric-label">Utilizatori înregistrați</span>
              <strong className="admin-metric-value">{stats.total_users}</strong>
              <span className="admin-metric-sub">
                {stats.university_validated_users} cu domeniu universitar · {stats.suspended_users} suspendați
              </span>
            </div>
            <div className="admin-metric-card tabular">
              <span className="admin-metric-label">Curse publicate</span>
              <strong className="admin-metric-value">{stats.total_rides}</strong>
              <span className="admin-metric-sub">
                {stats.active_rides} active · {stats.cancelled_rides} anulate
              </span>
            </div>
            <div className="admin-metric-card tabular">
              <span className="admin-metric-label">Rezervări &amp; Evaluări</span>
              <strong className="admin-metric-value">{stats.confirmed_bookings}</strong>
              <span className="admin-metric-sub">
                din {stats.total_bookings} rezervări · {stats.total_reviews} recenzii
              </span>
            </div>
          </div>
        )}
        {isAdmin && loadingStats && !stats && (
          <p role="status" aria-live="polite" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
            Se încarcă statisticile platformei...
          </p>
        )}

        {errorMsg && (
          <div className="status-banner error" role="alert">
            <span>
              <strong>Eroare:</strong> {errorMsg}
            </span>
          </div>
        )}

        {feedbackMsg && (
          <div className="status-banner success" role="status" aria-live="polite">
            <span>{feedbackMsg}</span>
          </div>
        )}

        <div className="tabs" role="tablist" aria-label="Secțiuni moderare" onKeyDown={handleTabListKeyDown}>
          <button
            type="button"
            role="tab"
            id="tab-admin-reports"
            tabIndex={activeTab === 'reports' ? 0 : -1}
            aria-selected={activeTab === 'reports'}
            aria-controls="panel-admin-reports"
            className="tab-btn"
            onClick={() => selectTab('reports')}
          >
            Coada de raportări ({reports.length})
          </button>
          <button
            type="button"
            role="tab"
            id="tab-admin-users"
            tabIndex={activeTab === 'users' ? 0 : -1}
            aria-selected={activeTab === 'users'}
            aria-controls="panel-admin-users"
            className="tab-btn"
            onClick={() => selectTab('users')}
          >
            Utilizatori &amp; Roluri
          </button>
        </div>
      </section>

      {activeTab === 'reports' && (
        <section
          id="panel-admin-reports"
          role="tabpanel"
          aria-labelledby="tab-admin-reports"
          className="card"
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-xl)' }}>
              Raportări primite
            </h2>
            <div role="group" aria-label="Filtru stare raportări" style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
              {[
                { value: 'pending', label: 'În așteptare' },
                { value: 'resolved', label: 'Rezolvate' },
                { value: 'dismissed', label: 'Respinse' },
                { value: '', label: 'Toate' },
              ].map((f) => (
                <button
                  key={f.value || 'all'}
                  type="button"
                  aria-pressed={reportStatusFilter === f.value}
                  className={reportStatusFilter === f.value ? 'chip-btn active' : 'chip-btn'}
                  onClick={() => setReportStatusFilter(f.value)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {loadingReports ? (
            <p role="status">Se încarcă raportările...</p>
          ) : reports.length === 0 ? (
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
              Nu există nicio raportare pentru filtrul selectat.
            </p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <caption className="sr-only">Tabel cu raportările de moderare și acțiunile disponibile</caption>
                <thead>
                  <tr>
                    <th scope="col">Dată &amp; Stare</th>
                    <th scope="col">Motiv &amp; Detalii</th>
                    <th scope="col">Țintă raportată (Utilizator / Cursă / Mesaj)</th>
                    <th scope="col">Raportat de</th>
                    <th scope="col">Acțiuni moderare</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((rep) => {
                    const targetUser = rep.reported_user;
                    const targetRide = rep.ride;
                    const targetMessage = rep.message;
                    const canSuspendReportedUser =
                      targetUser &&
                      !targetUser.is_suspended &&
                      canActorSuspendTarget(targetUser.role, targetUser.id);

                    return (
                      <tr key={rep.id}>
                        <td className="tabular">
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', alignItems: 'flex-start' }}>
                            <span
                              className={
                                rep.status === 'pending'
                                  ? 'badge badge-amber'
                                  : rep.status === 'resolved'
                                    ? 'badge badge-uni'
                                    : 'badge'
                              }
                            >
                              {REPORT_STATUS_LABELS[rep.status] || rep.status}
                            </span>
                            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                              {formatBucharestDate(rep.created_at)} {formatBucharestTime(rep.created_at)}
                            </span>
                            {rep.resolved_by_name && (
                              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                                Soluționat de: {rep.resolved_by_name}
                              </span>
                            )}
                          </div>
                        </td>

                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                            <strong>{formatReportReasonLabel(rep.reason)}</strong>
                            {rep.details ? (
                              <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', whiteSpace: 'pre-wrap' }}>
                                {rep.details}
                              </p>
                            ) : (
                              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                                Fără detalii suplimentare
                              </span>
                            )}
                          </div>
                        </td>

                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: 'var(--font-size-xs)' }}>
                            {targetUser && (
                              <div>
                                <strong>Utilizator: </strong>
                                <Link to={`/profile/${targetUser.id}`} style={{ color: 'var(--color-primary-ink)', fontWeight: 700 }}>
                                  {targetUser.full_name}
                                </Link>{' '}
                                ({ROLE_LABELS[targetUser.role] || targetUser.role})
                                {targetUser.is_suspended && (
                                  <span className="badge badge-cancel" style={{ marginLeft: '0.35rem' }}>
                                    Cont suspendat
                                  </span>
                                )}
                              </div>
                            )}
                            {targetRide && (
                              <div>
                                <strong>Cursă: </strong>
                                <Link to={`/rides/${targetRide.id}`} style={{ color: 'var(--color-primary-ink)', fontWeight: 700 }}>
                                  {targetRide.origin_name} → {targetRide.destination_name}
                                </Link>{' '}
                                ({formatBucharestDate(targetRide.departure_time)} ·{' '}
                                {targetRide.status === 'active' ? 'Activă' : 'Anulată'})
                              </div>
                            )}
                            {targetMessage && (
                              <div
                                style={{
                                  padding: '0.35rem 0.5rem',
                                  background: 'var(--color-surface-subtle)',
                                  borderRadius: 'var(--radius-sm)',
                                  border: '1px solid var(--color-border-subtle)',
                                }}
                              >
                                <strong>Mesaj în chat ({targetMessage.sender_name || 'participant'}):</strong>{' '}
                                <span>„{targetMessage.excerpt}”</span>
                              </div>
                            )}
                          </div>
                        </td>

                        <td style={{ fontSize: 'var(--font-size-xs)' }}>
                          {rep.reporter ? (
                            <Link to={`/profile/${rep.reporter.id}`} style={{ color: 'var(--color-primary-ink)', fontWeight: 600 }}>
                              {rep.reporter.full_name}
                            </Link>
                          ) : (
                            <span style={{ color: 'var(--color-text-muted)' }}>Cont șters</span>
                          )}
                        </td>

                        <td>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                            {rep.status === 'pending' && (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-primary"
                                  disabled={Boolean(busyActionKey)}
                                  onClick={() => handleResolveOrDismiss(rep.id, 'resolved')}
                                >
                                  Rezolvă
                                </button>
                                <button
                                  type="button"
                                  className="btn"
                                  disabled={Boolean(busyActionKey)}
                                  onClick={() => handleResolveOrDismiss(rep.id, 'dismissed')}
                                >
                                  Respinge
                                </button>
                              </>
                            )}

                            {targetRide && targetRide.status === 'active' && (
                              <button
                                type="button"
                                className="btn"
                                disabled={Boolean(busyActionKey)}
                                onClick={() => {
                                  setConfirmReason('');
                                  setConfirmAction({
                                    type: 'cancel_ride',
                                    targetId: targetRide.id,
                                    targetName: `${targetRide.origin_name} → ${targetRide.destination_name}`,
                                    title: `Anulează administrativ cursa ${targetRide.origin_name} → ${targetRide.destination_name}`,
                                    description:
                                      'Toate rezervările active de pe această cursă vor fi anulate și pasagerii vor fi notificați. Anularea de către moderator nu înregistrează penalizare de seriozitate șoferului.',
                                  });
                                }}
                              >
                                Anulează cursa
                              </button>
                            )}

                            {canSuspendReportedUser && (
                              <button
                                type="button"
                                className="btn"
                                disabled={Boolean(busyActionKey)}
                                onClick={() => {
                                  setConfirmReason('');
                                  setConfirmAction({
                                    type: 'suspend',
                                    targetId: targetUser.id,
                                    targetName: targetUser.full_name,
                                    title: `Suspendă contul lui ${targetUser.full_name}`,
                                    description:
                                      'Suspendarea blochează imediat autentificarea și anulează în cascadă toate cursele viitoare conduse de acest utilizator, precum și rezervările sale viitoare ca pasager (eliberând locurile și notificând participanții, fără taxă sau penalizare de seriozitate).',
                                  });
                                }}
                              >
                                Suspendă utilizatorul
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {activeTab === 'users' && (
        <section
          id="panel-admin-users"
          role="tabpanel"
          aria-labelledby="tab-admin-users"
          className="card"
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
            <div>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-xl)' }}>
                Utilizatori, Reputație &amp; Control Conturi
              </h2>
              <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                Caută după nume sau adresa de e-mail universitară. Suspendarea execută cascada tranzacțională pe cursele
                și rezervările viitoare.
              </p>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                setAppliedUserSearch(userSearchInput.trim());
              }}
              style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}
            >
              <div className="field" style={{ minWidth: '240px' }}>
                <label htmlFor="admin-user-search">Caută utilizator (nume sau e-mail)</label>
                <input
                  id="admin-user-search"
                  type="search"
                  className="input"
                  maxLength={100}
                  placeholder="ex. Tudor sau @ulbsibiu.ro"
                  value={userSearchInput}
                  onChange={(e) => setUserSearchInput(e.target.value)}
                />
              </div>
              <button type="submit" className="btn btn-primary">
                Filtrează
              </button>
              {appliedUserSearch && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setUserSearchInput('');
                    setAppliedUserSearch('');
                  }}
                >
                  Resetează
                </button>
              )}
            </form>
          </div>

          {loadingUsers ? (
            <p role="status">Se încarcă utilizatorii...</p>
          ) : usersList.length === 0 ? (
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
              Niciun utilizator găsit pentru criteriul introdus.
            </p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <caption className="sr-only">Tabel cu utilizatorii platformei, reputația dublă și acțiunile de moderare</caption>
                <thead>
                  <tr>
                    <th scope="col">Utilizator &amp; E-mail</th>
                    <th scope="col">Rol &amp; Stare</th>
                    <th scope="col">Reputație dublă</th>
                    <th scope="col">Acțiuni cont</th>
                  </tr>
                </thead>
                <tbody>
                  {usersList.map((u) => {
                    const isSelf = Number(u.id) === Number(user.id);
                    const canModerateThisUser = canActorSuspendTarget(u.role, u.id);
                    const canChangeRole = isAdmin && !isSelf && u.role !== 'admin';

                    return (
                      <tr key={u.id}>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                              <Link to={`/profile/${u.id}`} style={{ color: 'var(--color-primary-ink)', fontWeight: 700 }}>
                                {u.full_name}
                              </Link>
                              <UniversityBadge hasBadge={u.has_university_badge} />
                              <RecentCancellationBadge hasRecentCancellation={u.has_recent_cancellation_badge} />
                            </div>
                            <span className="tabular" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                              {u.email}
                            </span>
                          </div>
                        </td>

                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                            <span className="badge badge-uni">{ROLE_LABELS[u.role] || u.role}</span>
                            {u.is_suspended ? (
                              <span className="badge badge-cancel">Suspendat</span>
                            ) : (
                              <span className="badge">Activ</span>
                            )}
                          </div>
                        </td>

                        <td className="tabular" style={{ fontSize: 'var(--font-size-xs)' }}>
                          <div>
                            <strong>Seriozitate: {u.seriousness_score}%</strong> ({u.infraction_count} penalizări)
                          </div>
                          <div style={{ color: 'var(--color-text-muted)' }}>
                            ★ {u.rating_average !== null ? Number(u.rating_average).toFixed(1) : '—'} ({u.rating_count}{' '}
                            evaluări)
                          </div>
                        </td>

                        <td>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                            {canModerateThisUser && !u.is_suspended && (
                              <button
                                type="button"
                                className="btn"
                                disabled={Boolean(busyActionKey)}
                                onClick={() => {
                                  setConfirmReason('');
                                  setConfirmAction({
                                    type: 'suspend',
                                    targetId: u.id,
                                    targetName: u.full_name,
                                    title: `Suspendă contul lui ${u.full_name}`,
                                    description:
                                      'Suspendarea blochează imediat autentificarea și anulează în cascadă toate cursele viitoare conduse de acest utilizator, precum și rezervările sale viitoare ca pasager (eliberând locurile și notificând participanții, fără taxă sau penalizare de seriozitate).',
                                  });
                                }}
                              >
                                Suspendă
                              </button>
                            )}

                            {canModerateThisUser && u.is_suspended && (
                              <button
                                type="button"
                                className="btn btn-primary"
                                disabled={Boolean(busyActionKey)}
                                onClick={() => handleUnsuspend(u)}
                              >
                                Reactivează contul
                              </button>
                            )}

                            {canChangeRole && u.role === 'user' && (
                              <button
                                type="button"
                                className="btn"
                                disabled={Boolean(busyActionKey)}
                                onClick={() => handleRoleChange(u, 'moderator')}
                              >
                                Promovează moderator
                              </button>
                            )}

                            {canChangeRole && u.role === 'moderator' && (
                              <button
                                type="button"
                                className="btn"
                                disabled={Boolean(busyActionKey)}
                                onClick={() => handleRoleChange(u, 'user')}
                              >
                                Retrogradează la student
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {confirmAction && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-confirm-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmAction(null);
          }}
        >
          <div className="modal-card" ref={confirmModalRef}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-sm)' }}>
              <h2
                id="admin-confirm-title"
                style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-xl)' }}
              >
                {confirmAction.title}
              </h2>
              <button
                ref={confirmCloseRef}
                type="button"
                className="btn"
                aria-label="Închide confirmarea"
                onClick={() => setConfirmAction(null)}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
              {confirmAction.description}
            </p>

            <form onSubmit={handleExecuteConfirmAction} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              <div className="field">
                <label htmlFor="admin-confirm-reason">Motiv transmis în notificare (opțional, max. 255 caractere)</label>
                <input
                  id="admin-confirm-reason"
                  type="text"
                  className="input"
                  maxLength={255}
                  placeholder="ex. Încălcarea regulilor comunității StudRide"
                  value={confirmReason}
                  onChange={(e) => setConfirmReason(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setConfirmAction(null)}
                  disabled={Boolean(busyActionKey)}
                >
                  Renunță
                </button>
                <button type="submit" className="btn btn-primary" disabled={Boolean(busyActionKey)}>
                  {busyActionKey ? 'Se aplică...' : 'Confirmă acțiunea'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
