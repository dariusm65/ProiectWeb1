import React from 'react';
import { UNIVERSITY_BADGE_LABEL_RO, UNIVERSITY_BADGE_NOTE } from '../domain/universityDomains.js';

export function UniversityBadge({ hasBadge, note }) {
  if (!hasBadge) return null;
  return (
    <span className="badge badge-uni" title={note || UNIVERSITY_BADGE_NOTE}>
      ✓ {UNIVERSITY_BADGE_LABEL_RO}
    </span>
  );
}

export function WomenOnlyBadge({ womenOnly }) {
  if (!womenOnly) return null;
  return (
    <span className="badge badge-women" title="Eligibil exclusiv pentru conturi cu genul Femeie (D-018)">
      Women-only
    </span>
  );
}

export function RecentCancellationBadge({ hasRecentCancellation }) {
  if (!hasRecentCancellation) return null;
  return (
    <span
      className="badge badge-cancel"
      title="Șoferul a anulat o cursă în ziua plecării în ultimele 30 de zile (-5 pp · D-016)"
    >
      Anulare recentă
    </span>
  );
}

export function ReputationRow({ ratingAverage, ratingCount = 0, seriousnessScore = 100 }) {
  const formattedRating =
    ratingAverage !== null && ratingAverage !== undefined
      ? `★ ${Number(ratingAverage).toFixed(1)}`
      : '★ Fără evaluări';
  const scoreClass = Number(seriousnessScore) < 96 ? 'rep-score warn' : 'rep-score';

  return (
    <div className="rep-row">
      <span className="rep-stars">{formattedRating}</span>
      <span>({ratingCount} evaluări)</span>
      <span>·</span>
      <span className={scoreClass}>{seriousnessScore}% seriozitate</span>
    </div>
  );
}
