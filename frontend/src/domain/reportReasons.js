// Fixed moderation report reasons (CONTEXT.md "Report", C-002).
// Keep `REPORT_REASONS` identical to backend/src/domain/reportReasons.js.
export const REPORT_REASONS = Object.freeze([
  'spam',
  'harassment',
  'unsafe_driving',
  'no_show',
  'fake_profile',
  'inappropriate_content',
  'other',
]);

export const REPORT_REASON_OPTIONS = Object.freeze([
  { value: 'harassment', label: 'Hărțuire sau comportament abuziv' },
  { value: 'unsafe_driving', label: 'Condus imprudent sau nesigur' },
  { value: 'no_show', label: 'Neprezentare la punctul de întâlnire' },
  { value: 'inappropriate_content', label: 'Limbaj sau conținut neadecvat' },
  { value: 'spam', label: 'Spam sau reclamă' },
  { value: 'fake_profile', label: 'Profil fals sau date înșelătoare' },
  { value: 'other', label: 'Alt motiv (detaliază mai jos)' },
]);

const REASON_LABELS = new Map(REPORT_REASON_OPTIONS.map((o) => [o.value, o.label]));

export function formatReportReasonLabel(reason) {
  return REASON_LABELS.get(reason) || reason || 'Motiv nespecificat';
}
