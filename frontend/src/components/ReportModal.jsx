import React, { useEffect, useRef, useState } from 'react';
import { reportsApi } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { REPORT_REASON_OPTIONS } from '../domain/reportReasons.js';

export function ReportModal({
  isOpen,
  onClose,
  reportedUserId = null,
  rideId = null,
  messageId = null,
  targetLabel = 'elementul selectat',
  onReportSubmitted,
}) {
  const { fetchFn } = useAuth();
  const [reason, setReason] = useState(REPORT_REASON_OPTIONS[0].value);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [submittedReport, setSubmittedReport] = useState(null);

  const onCloseRef = useRef(onClose);
  const modalCardRef = useRef(null);
  const closeBtnRef = useRef(null);
  const previousFocusRef = useRef(null);
  const submitControllerRef = useRef(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    setReason(REPORT_REASON_OPTIONS[0].value);
    setDetails('');
    setErrorMsg('');
    setSubmittedReport(null);
  }, [isOpen, reportedUserId, rideId, messageId]);

  useEffect(() => {
    return () => {
      if (submitControllerRef.current) {
        submitControllerRef.current.abort();
      }
    };
  }, []);

  // WAI-ARIA dialog focus management, Tab focus trap, Escape close, and focus restoration
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
    if (submitting) return;
    setErrorMsg('');
    setSubmitting(true);

    if (submitControllerRef.current) {
      submitControllerRef.current.abort();
    }
    const controller = new AbortController();
    submitControllerRef.current = controller;

    try {
      const trimmedDetails = details.trim();
      const payload = {
        reported_user_id: reportedUserId != null ? Number(reportedUserId) : null,
        ride_id: rideId != null ? Number(rideId) : null,
        message_id: messageId != null ? Number(messageId) : null,
        reason,
        details: trimmedDetails.length > 0 ? trimmedDetails : null,
      };
      const res = await reportsApi.create(payload, { fetchFn, signal: controller.signal });
      if (controller.signal.aborted) return;
      setSubmittedReport(res.report);
      if (typeof onReportSubmitted === 'function') {
        onReportSubmitted(res.report);
      }
    } catch (err) {
      if (controller.signal.aborted || err?.name === 'AbortError') return;
      if (err?.statusCode === 409 || err?.code === 'REPORT_ALREADY_PENDING') {
        setErrorMsg('Ai deja o raportare în așteptare pentru această țintă. Moderatorii o vor analiza în curând.');
      } else if (err?.code === 'SELF_REPORT_NOT_ALLOWED') {
        setErrorMsg('Nu poți raporta propriul cont, propria cursă sau propriul mesaj.');
      } else if (err?.statusCode === 429 || err?.code === 'RATE_LIMITED') {
        setErrorMsg('Ai trimis prea multe raportări într-un interval scurt. Încearcă din nou mai târziu.');
      } else {
        setErrorMsg(err?.message || 'Raportarea nu a putut fi trimisă.');
      }
    } finally {
      if (!controller.signal.aborted) {
        setSubmitting(false);
      }
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-card" ref={modalCardRef}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)' }}>
          <h2
            id="report-modal-title"
            style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-xl)' }}
          >
            Raportează {targetLabel}
          </h2>
          <button
            ref={closeBtnRef}
            type="button"
            className="btn"
            aria-label="Închide fereastra de raportare"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
          Raportările sunt analizate de echipa de moderare StudRide. Alege motivul principal și adaugă detalii relevante.
        </p>

        {errorMsg && (
          <div className="status-banner error" role="alert">
            <span>
              <strong>Eroare:</strong> {errorMsg}
            </span>
          </div>
        )}

        {submittedReport ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            <div className="status-banner success" role="status" aria-live="polite">
              <span>
                <strong>Raportare înregistrată!</strong> Sesizarea ta a fost trimisă în coada de moderare cu starea{' '}
                <strong>în așteptare</strong>.
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-primary" onClick={onClose}>
                Închide
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            <div className="field">
              <label htmlFor="report-reason-select">Motivul raportării</label>
              <select
                id="report-reason-select"
                className="select"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              >
                {REPORT_REASON_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="report-details-input">Detalii suplimentare (opțional, max. 2000 caractere)</label>
              <textarea
                id="report-details-input"
                className="input"
                rows={4}
                maxLength={2000}
                aria-describedby="report-details-counter"
                placeholder="Descrie pe scurt ce s-a întâmplat..."
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                style={{ minHeight: '92px', paddingTop: '0.6rem' }}
              />
              <span
                id="report-details-counter"
                className="tabular"
                style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', alignSelf: 'flex-end' }}
              >
                {details.length} / 2000 caractere
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" className="btn" onClick={onClose} disabled={submitting}>
                Renunță
              </button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'Se trimite...' : 'Trimite raportarea'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
