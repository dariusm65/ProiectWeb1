import React from 'react';

const UNIVERSITY_BADGE_TOOLTIP_RO =
  'Validat pe baza domeniului de email universitar — nu implică verificarea identității';

export function UniversityBadge({ hasBadge }) {
  if (!hasBadge) return null;
  return (
    <span
      className="badge badge-uni"
      title={UNIVERSITY_BADGE_TOOLTIP_RO}
      aria-label={`Email universitar — ${UNIVERSITY_BADGE_TOOLTIP_RO}`}
    >
      ✓ Email universitar
    </span>
  );
}

export function WomenOnlyBadge({ womenOnly }) {
  if (!womenOnly) return null;
  return (
    <span className="badge badge-women" title="Cursă destinată exclusiv femeilor">
      Women-only
    </span>
  );
}

export function RecentCancellationBadge({ hasRecentCancellation }) {
  if (!hasRecentCancellation) return null;
  return (
    <span
      className="badge badge-cancel"
      title="Șoferul a anulat o cursă în ziua plecării în ultimele 30 de zile"
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
