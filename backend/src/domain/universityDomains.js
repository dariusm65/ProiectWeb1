// Accredited Romanian university email domain allowlist matcher (D-004, Q-002, Q-005).
// Matches exact root domains OR any subdomain of them (e.g. stud.acs.upb.ro -> upb.ro),
// while rejecting spoofed prefix/suffix domains (e.g. evil-ulbsibiu.ro).

export const UNIVERSITY_BADGE_NOTE = 'domain-validated (not identity-verified)';

export const ROMANIAN_UNIVERSITY_ROOT_DOMAINS = Object.freeze([
  // Major public & technical universities across Romania
  'ulbsibiu.ro',
  'upb.ro',
  'ubbcluj.ro',
  'utcluj.ro',
  'upt.ro',
  'uvt.ro',
  'e-uvt.ro',
  'unibuc.ro',
  'ase.ro',
  'uaic.ro',
  'tuiasi.ro',
  'unitbv.ro',
  'ucv.ro',
  'uoradea.ro',
  'utcb.ro',
  'usv.ro',
  'ugal.ro',
  'univ-ovidius.ro',
  'uab.ro',
  'ub.ro',
  'upit.ro',
  'valahia.ro',
  'utgjiu.ro',
  'upet.ro',
  'uav.ro',
  'upg-ploiesti.ro',
  'snspa.ro',
  'uauim.ro',
  // Medicine, Pharmacy & Life Sciences
  'umfcd.ro',
  'umfcluj.ro',
  'umft.ro',
  'umfst.ro',
  'umfiasi.ro',
  'umfcv.ro',
  'usamv.ro',
  'usamvcluj.ro',
  'usamvbt.ro',
  'uaiasi.ro',
  // Arts, Music, Defence & Accredited Private Universities
  'unarte.org',
  'unatc.ro',
  'unmb.ro',
  'anmb.ro',
  'mta.ro',
  'forteleterestre.ro',
  'afahc.ro',
  'academiadepolitie.ro',
  'ucdc.ro',
  'utm.ro',
  'rau.ro',
  'spiruharet.ro',
  'univ-danubius.ro',
  'emanuel.ro',
  'partium.ro',
  'sapientia.ro',
]);

function parseExtraDomains(extraDomainsCsv) {
  if (!extraDomainsCsv || typeof extraDomainsCsv !== 'string') return [];
  return extraDomainsCsv
    .split(',')
    .map((item) => item.trim().toLowerCase().replace(/^@/, ''))
    .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d));
}

/**
 * Check whether an email's domain matches an accredited Romanian university root domain
 * or any subdomain of it (plus optional comma-separated extra root domains).
 *
 * Returns the normalized email domain (e.g. "stud.acs.upb.ro") if matched, or null otherwise.
 */
export function matchUniversityDomain(email, extraDomainsCsv = process.env.EXTRA_UNIVERSITY_DOMAINS) {
  if (typeof email !== 'string') return null;
  const trimmed = email.trim().toLowerCase();
  const parts = trimmed.split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  const domain = parts[1];
  if (domain.length > 100 || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    return null;
  }

  const allowedRoots = extraDomainsCsv
    ? [...ROMANIAN_UNIVERSITY_ROOT_DOMAINS, ...parseExtraDomains(extraDomainsCsv)]
    : ROMANIAN_UNIVERSITY_ROOT_DOMAINS;

  for (const root of allowedRoots) {
    if (domain === root || domain.endsWith(`.${root}`)) {
      return domain;
    }
  }
  return null;
}
