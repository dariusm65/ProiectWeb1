// Unit tests for accredited Romanian university email domain matching (D-004, Q-002, Q-005).
import { describe, it, expect } from 'vitest';
import {
  ROMANIAN_UNIVERSITY_ROOT_DOMAINS,
  matchUniversityDomain,
} from '../src/domain/universityDomains.js';

describe('domain: universityDomains (D-004, Q-002, Q-005)', () => {
  it('exports a comprehensive list of accredited Romanian university root domains', () => {
    expect(ROMANIAN_UNIVERSITY_ROOT_DOMAINS).toContain('ulbsibiu.ro');
    expect(ROMANIAN_UNIVERSITY_ROOT_DOMAINS).toContain('upb.ro');
    expect(ROMANIAN_UNIVERSITY_ROOT_DOMAINS).toContain('ubbcluj.ro');
    expect(ROMANIAN_UNIVERSITY_ROOT_DOMAINS).toContain('utcluj.ro');
    expect(ROMANIAN_UNIVERSITY_ROOT_DOMAINS).toContain('upt.ro');
    expect(ROMANIAN_UNIVERSITY_ROOT_DOMAINS).toContain('uvt.ro');
    expect(ROMANIAN_UNIVERSITY_ROOT_DOMAINS).toContain('e-uvt.ro');
    expect(ROMANIAN_UNIVERSITY_ROOT_DOMAINS).toContain('unibuc.ro');
    expect(ROMANIAN_UNIVERSITY_ROOT_DOMAINS).toContain('ase.ro');
    expect(ROMANIAN_UNIVERSITY_ROOT_DOMAINS).toContain('uaic.ro');
  });

  it('matches exact accredited Romanian university root domains (case-insensitive)', () => {
    expect(matchUniversityDomain('ion.popescu@ulbsibiu.ro')).toBe('ulbsibiu.ro');
    expect(matchUniversityDomain('ANA.MARIA@UNIBUC.RO')).toBe('unibuc.ro');
    expect(matchUniversityDomain('  student@ase.ro  ')).toBe('ase.ro');
    expect(matchUniversityDomain('medic@umfcd.ro')).toBe('umfcd.ro');
    expect(matchUniversityDomain('student@e-uvt.ro')).toBe('e-uvt.ro');
  });

  it('matches any subdomain of an accredited Romanian university root domain', () => {
    expect(matchUniversityDomain('darius@stud.acs.upb.ro')).toBe('stud.acs.upb.ro');
    expect(matchUniversityDomain('ioana@stud.ubbcluj.ro')).toBe('stud.ubbcluj.ro');
    expect(matchUniversityDomain('alex@student.utcluj.ro')).toBe('student.utcluj.ro');
    expect(matchUniversityDomain('elena@student.upt.ro')).toBe('student.upt.ro');
    expect(matchUniversityDomain('radu@feaa.uaic.ro')).toBe('feaa.uaic.ro');
    expect(matchUniversityDomain('mihai@cs.unitbv.ro')).toBe('cs.unitbv.ro');
  });

  it('returns null for non-university, spoofed, or malformed emails', () => {
    expect(matchUniversityDomain('student@gmail.com')).toBeNull();
    expect(matchUniversityDomain('student@yahoo.ro')).toBeNull();
    // Spoofed prefix / suffix attacks must NOT match
    expect(matchUniversityDomain('attacker@evil-ulbsibiu.ro')).toBeNull();
    expect(matchUniversityDomain('attacker@ulbsibiu.ro.evil.com')).toBeNull();
    expect(matchUniversityDomain('attacker@fakeupb.ro')).toBeNull();
    // Strict DNS label syntax: reject leading/consecutive dots and hyphen-bounded labels
    expect(matchUniversityDomain('user@.ulbsibiu.ro')).toBeNull();
    expect(matchUniversityDomain('user@foo..ulbsibiu.ro')).toBeNull();
    expect(matchUniversityDomain('user@-sub.ulbsibiu.ro')).toBeNull();
    expect(matchUniversityDomain('user@sub-.ulbsibiu.ro')).toBeNull();
    // Malformed emails
    expect(matchUniversityDomain('')).toBeNull();
    expect(matchUniversityDomain('not-an-email')).toBeNull();
    expect(matchUniversityDomain('a@b@ulbsibiu.ro')).toBeNull();
    expect(matchUniversityDomain('@ulbsibiu.ro')).toBeNull();
  });

  it('supports optional comma-separated EXTRA_UNIVERSITY_DOMAINS (exact + subdomain)', () => {
    const extra = ' custom-uni.ro , @test-campus.edu.ro , ..ro , .bad.ro , -bad.ro ';
    expect(matchUniversityDomain('student@custom-uni.ro', extra)).toBe('custom-uni.ro');
    expect(matchUniversityDomain('student@cs.custom-uni.ro', extra)).toBe('cs.custom-uni.ro');
    expect(matchUniversityDomain('student@test-campus.edu.ro', extra)).toBe('test-campus.edu.ro');
    expect(matchUniversityDomain('attacker@evil-custom-uni.ro', extra)).toBeNull();
    expect(matchUniversityDomain('attacker@bad.ro', extra)).toBeNull();
  });
});
