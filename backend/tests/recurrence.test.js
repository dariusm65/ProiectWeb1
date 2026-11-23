// Unit tests for recurring-rule date matching and Europe/Bucharest wall-clock conversion
// (D-006, D-020).
import { describe, it, expect } from 'vitest';
import {
  dayOfWeekName,
  ruleAppliesOn,
  bucharestLocalToUtc,
  bucharestDateOf,
  bucharestDayBounds,
  buildInstanceTimes,
} from '../src/domain/recurrence.js';

const fridayRule = {
  days_of_week: ['friday'],
  start_date: '2026-12-01',
  end_date: '2026-12-31',
};

describe('dayOfWeekName', () => {
  it('maps calendar dates to lowercase weekday names', () => {
    expect(dayOfWeekName('2026-12-04')).toBe('friday');
    expect(dayOfWeekName('2026-12-01')).toBe('tuesday');
    expect(dayOfWeekName('2026-12-06')).toBe('sunday');
  });

  it('rejects malformed or impossible dates', () => {
    expect(() => dayOfWeekName('2026-02-30')).toThrow();
    expect(() => dayOfWeekName('04-12-2026')).toThrow();
  });
});

describe('ruleAppliesOn', () => {
  it('matches its weekday inside the range only', () => {
    expect(ruleAppliesOn(fridayRule, '2026-12-04')).toBe(true);
    expect(ruleAppliesOn(fridayRule, '2026-12-05')).toBe(false);
  });

  it('treats start_date and end_date as inclusive', () => {
    const rule = { days_of_week: ['tuesday'], start_date: '2026-12-01', end_date: '2026-12-08' };
    expect(ruleAppliesOn(rule, '2026-12-01')).toBe(true);
    expect(ruleAppliesOn(rule, '2026-12-08')).toBe(true);
    expect(ruleAppliesOn(rule, '2026-12-15')).toBe(false);
    expect(ruleAppliesOn(rule, '2026-11-24')).toBe(false);
  });

  it('supports a null end_date (open-ended)', () => {
    const rule = { days_of_week: ['friday'], start_date: '2026-12-01', end_date: null };
    expect(ruleAppliesOn(rule, '2030-01-04')).toBe(true);
  });

  it('skips exception dates', () => {
    expect(ruleAppliesOn(fridayRule, '2026-12-11', ['2026-12-11'])).toBe(false);
    expect(ruleAppliesOn(fridayRule, '2026-12-18', ['2026-12-11'])).toBe(true);
  });

  it('accepts Date objects (mysql2 DATE columns) and several weekdays', () => {
    const rule = {
      days_of_week: ['monday', 'friday'],
      start_date: new Date('2026-12-01T00:00:00Z'),
      end_date: new Date('2026-12-31T00:00:00Z'),
    };
    expect(ruleAppliesOn(rule, '2026-12-07')).toBe(true);
    expect(ruleAppliesOn(rule, '2026-12-04')).toBe(true);
    expect(ruleAppliesOn(rule, '2026-12-08')).toBe(false);
  });
});

describe('Europe/Bucharest wall-clock conversion (D-020)', () => {
  it('uses UTC+2 in winter and UTC+3 in summer', () => {
    expect(bucharestLocalToUtc('2026-12-04', '18:00:00').toISOString()).toBe('2026-12-04T16:00:00.000Z');
    expect(bucharestLocalToUtc('2026-07-10', '18:00:00').toISOString()).toBe('2026-07-10T15:00:00.000Z');
  });

  it('handles the spring-forward and fall-back days', () => {
    // 2026-03-29: clocks jump 03:00 -> 04:00; 12:00 local is already UTC+3
    expect(bucharestLocalToUtc('2026-03-29', '12:00:00').toISOString()).toBe('2026-03-29T09:00:00.000Z');
    // 2026-03-29 00:30 local is still UTC+2
    expect(bucharestLocalToUtc('2026-03-29', '00:30:00').toISOString()).toBe('2026-03-28T22:30:00.000Z');
    // 2026-03-29 03:30 local falls inside the non-existent spring-forward hour (03:00 -> 04:00):
    // resolves forward to 04:30 EEST (01:30Z), never backward to 02:30 EET (00:30Z)
    expect(bucharestLocalToUtc('2026-03-29', '03:30:00').toISOString()).toBe('2026-03-29T01:30:00.000Z');
    // 2026-10-25: clocks go back 04:00 -> 03:00; 12:00 local is UTC+2
    expect(bucharestLocalToUtc('2026-10-25', '12:00:00').toISOString()).toBe('2026-10-25T10:00:00.000Z');
  });

  it('bucharestDateOf returns the local calendar date of an instant', () => {
    expect(bucharestDateOf(new Date('2026-12-04T22:30:00Z'))).toBe('2026-12-05');
    expect(bucharestDateOf(new Date('2026-12-04T21:30:00Z'))).toBe('2026-12-04');
  });

  it('bucharestDayBounds is [local midnight, next local midnight) in UTC, DST-aware', () => {
    const winter = bucharestDayBounds('2026-12-04');
    expect(winter.start.toISOString()).toBe('2026-12-03T22:00:00.000Z');
    expect(winter.end.toISOString()).toBe('2026-12-04T22:00:00.000Z');
    const spring = bucharestDayBounds('2026-03-29');
    expect(spring.start.toISOString()).toBe('2026-03-28T22:00:00.000Z');
    expect(spring.end.toISOString()).toBe('2026-03-29T21:00:00.000Z'); // 23-hour day
  });
});

describe('buildInstanceTimes', () => {
  it('adds each stop offset to the local departure instant', () => {
    const rule = { departure_time: '17:30:00' };
    const stops = [
      { stop_order: 10, estimated_offset_minutes: 0 },
      { stop_order: 20, estimated_offset_minutes: 45 },
      { stop_order: 30, estimated_offset_minutes: 150 },
    ];
    const out = buildInstanceTimes(rule, stops, '2026-12-04');
    expect(out.departure.toISOString()).toBe('2026-12-04T15:30:00.000Z');
    expect(out.stops.map((s) => s.arrival.toISOString())).toEqual([
      '2026-12-04T15:30:00.000Z',
      '2026-12-04T16:15:00.000Z',
      '2026-12-04T18:00:00.000Z',
    ]);
    expect(out.arrival.toISOString()).toBe('2026-12-04T18:00:00.000Z');
  });
});
