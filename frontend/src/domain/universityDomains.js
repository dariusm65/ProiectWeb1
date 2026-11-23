// Client-side mirror of accredited Romanian university email domain matcher (D-004, Q-002, Q-005).
// Provides instant live feedback on the Registration form (DS-003) while the server remains authoritative.

export const UNIVERSITY_BADGE_NOTE =
  'domain-validated (not identity-verified; mailbox ownership unverified)';

export const UNIVERSITY_BADGE_LABEL_RO =
  'Validat pe domeniu (nu identitate verificată)';

const STRICT_DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export const ROMANIAN_UNIVERSITY_ROOT_DOMAINS = Object.freeze([
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

export const UNIVERSITY_DISPLAY_NAMES = Object.freeze({
  'ulbsibiu.ro': 'ULBS Sibiu',
  'ubbcluj.ro': 'UBB Cluj-Napoca',
  'utcluj.ro': 'UTCN Cluj-Napoca',
  'upt.ro': 'UPT Timișoara',
  'uvt.ro': 'UVT Timișoara',
  'e-uvt.ro': 'UVT Timișoara',
  'upb.ro': 'UPB București',
  'unibuc.ro': 'Universitatea din București',
  'ase.ro': 'ASE București',
  'uaic.ro': 'UAIC Iași',
  'tuiasi.ro': 'TUIASI Iași',
  'unitbv.ro': 'UNITBV Brașov',
});

export function matchUniversityDomain(email) {
  if (typeof email !== 'string') return null;
  const trimmed = email.trim().toLowerCase();
  const parts = trimmed.split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  const domain = parts[1];
  if (domain.length > 100 || !STRICT_DOMAIN_RE.test(domain)) {
    return null;
  }

  for (const root of ROMANIAN_UNIVERSITY_ROOT_DOMAINS) {
    if (domain === root || domain.endsWith(`.${root}`)) {
      return {
        domain,
        root,
        universityName: UNIVERSITY_DISPLAY_NAMES[root] || root,
      };
    }
  }
  return null;
}
