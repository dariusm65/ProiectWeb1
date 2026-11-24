// Idempotent demo data seed for local browsing/QA (`npm run seed:demo --prefix backend`).
// Kept strictly separate from `backend/database/seed.js` so schema/integration tests remain untouched.
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { dbConfig } from '../db.js';
import { matchUniversityDomain } from '../domain/universityDomains.js';
import { bucharestLocalToUtc } from '../domain/recurrence.js';

const DEMO_PASSWORD =
  process.env.DEMO_USER_PASSWORD || crypto.randomBytes(16).toString('base64url');

const DEMO_USERS = [
  {
    email: 'ioana.popescu@ulbsibiu.ro',
    full_name: 'Ioana Popescu',
    phone: '0722111222',
    gender: 'female',
  },
  {
    email: 'andrei.munteanu@stud.ubbcluj.ro',
    full_name: 'Andrei Munteanu',
    phone: '0744333444',
    gender: 'male',
  },
  {
    email: 'darius.ionescu@stud.acs.upb.ro',
    full_name: 'Darius Ionescu',
    phone: '0755666777',
    gender: 'male',
  },
  {
    email: 'elena.radu@student.upt.ro',
    full_name: 'Elena Radu',
    phone: '0766888999',
    gender: 'female',
  },
];

function futureBucharestDate(daysFromNow) {
  const d = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bucharest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const byType = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function buildDemoRides() {
  const day1 = futureBucharestDate(1);
  const day2 = futureBucharestDate(2);
  const day3 = futureBucharestDate(3);
  const day4 = futureBucharestDate(4);

  return [
    {
      driverEmail: 'ioana.popescu@ulbsibiu.ro',
      date: day1,
      departureTime: '08:00',
      available_seats: 3,
      declared_trip_cost: 152,
      luggage_allowed: true,
      pets_allowed: false,
      smoking_allowed: false,
      women_only: true,
      stops: [
        { city: 'Sibiu', loc: 'Gara Mare Sibiu', lat: 45.7983, lng: 24.1256, km: 0, min: 0 },
        { city: 'Sebeș', loc: 'Centru Sebeș', lat: 45.9597, lng: 23.5681, km: 56, min: 45 },
        { city: 'Alba Iulia', loc: 'Gara Alba Iulia', lat: 46.0667, lng: 23.5833, km: 72, min: 65 },
        { city: 'Turda', loc: 'Centru Turda', lat: 46.5667, lng: 23.7833, km: 136, min: 120 },
        { city: 'Cluj-Napoca', loc: 'Campus Hașdeu', lat: 46.7646, lng: 23.5801, km: 168, min: 165 },
      ],
    },
    {
      driverEmail: 'andrei.munteanu@stud.ubbcluj.ro',
      date: day1,
      departureTime: '16:30',
      available_seats: 3,
      declared_trip_cost: 160,
      luggage_allowed: true,
      pets_allowed: true,
      smoking_allowed: false,
      women_only: false,
      stops: [
        { city: 'Cluj-Napoca', loc: 'Campus Hașdeu', lat: 46.7646, lng: 23.5801, km: 0, min: 0 },
        { city: 'Turda', loc: 'Centru Turda', lat: 46.5667, lng: 23.7833, km: 32, min: 35 },
        { city: 'Alba Iulia', loc: 'Gara Alba Iulia', lat: 46.0667, lng: 23.5833, km: 96, min: 95 },
        { city: 'Sibiu', loc: 'Gara Mare Sibiu', lat: 45.7983, lng: 24.1256, km: 168, min: 165 },
      ],
    },
    {
      driverEmail: 'darius.ionescu@stud.acs.upb.ro',
      date: day2,
      departureTime: '09:00',
      available_seats: 3,
      declared_trip_cost: 240,
      luggage_allowed: true,
      pets_allowed: false,
      smoking_allowed: false,
      women_only: false,
      stops: [
        { city: 'Sibiu', loc: 'Gara Mare Sibiu', lat: 45.7983, lng: 24.1256, km: 0, min: 0 },
        { city: 'Brașov', loc: 'Gara Brașov', lat: 45.6604, lng: 25.6137, km: 142, min: 125 },
        { city: 'Ploiești', loc: 'Ploiești Nord', lat: 44.95, lng: 26.0167, km: 252, min: 225 },
        { city: 'București', loc: 'Piața Romană / UPB', lat: 44.445, lng: 26.097, km: 312, min: 280 },
      ],
    },
    {
      driverEmail: 'elena.radu@student.upt.ro',
      date: day3,
      departureTime: '14:00',
      available_seats: 2,
      declared_trip_cost: 195,
      luggage_allowed: true,
      pets_allowed: false,
      smoking_allowed: false,
      women_only: false,
      stops: [
        { city: 'Timișoara', loc: 'Complexul Studențesc', lat: 45.7489, lng: 21.2417, km: 0, min: 0 },
        { city: 'Deva', loc: 'Gara Deva', lat: 45.8833, lng: 22.9, km: 155, min: 120 },
        { city: 'Sebeș', loc: 'Centru Sebeș', lat: 45.9597, lng: 23.5681, km: 220, min: 170 },
        { city: 'Sibiu', loc: 'Gara Mare Sibiu', lat: 45.7983, lng: 24.1256, km: 272, min: 215 },
      ],
    },
    {
      driverEmail: 'darius.ionescu@stud.acs.upb.ro',
      date: day4,
      departureTime: '17:00',
      available_seats: 3,
      declared_trip_cost: 132,
      luggage_allowed: true,
      pets_allowed: false,
      smoking_allowed: false,
      women_only: false,
      stops: [
        { city: 'Brașov', loc: 'Gara Brașov', lat: 45.6604, lng: 25.6137, km: 0, min: 0 },
        { city: 'Ploiești', loc: 'Ploiești Nord', lat: 44.95, lng: 26.0167, km: 110, min: 100 },
        { city: 'București', loc: 'Piața Romană / UPB', lat: 44.445, lng: 26.097, km: 170, min: 155 },
      ],
    },
  ];
}

export async function seedDemo(conn) {
  await conn.beginTransaction();
  try {
    const userIdsByEmail = new Map();

    // 1. Seed demo student drivers idempotently
    for (const u of DEMO_USERS) {
      const [existing] = await conn.query('SELECT id FROM users WHERE email = ? LIMIT 1', [u.email]);
      if (existing.length > 0) {
        userIdsByEmail.set(u.email, existing[0].id);
        continue;
      }
      const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
      const universityDomain = matchUniversityDomain(u.email);
      const [res] = await conn.query(
        `INSERT INTO users (email, password_hash, full_name, phone, university_domain, role, gender)
         VALUES (?, ?, ?, ?, ?, 'user', ?)`,
        [u.email, passwordHash, u.full_name, u.phone, universityDomain, u.gender],
      );
      userIdsByEmail.set(u.email, res.insertId);
    }

    // 2. Seed upcoming demo rides idempotently (keyed by driver + origin + dest + departure_time)
    const demoRides = buildDemoRides();
    let ridesInserted = 0;

    for (const r of demoRides) {
      const driverId = userIdsByEmail.get(r.driverEmail);
      const departureUtc = bucharestLocalToUtc(r.date, r.departureTime);
      const lastStop = r.stops[r.stops.length - 1];
      const arrivalUtc = new Date(departureUtc.getTime() + lastStop.min * 60 * 1000);

      const [existingRide] = await conn.query(
        `SELECT id FROM rides
         WHERE driver_id = ? AND origin_name = ? AND destination_name = ? AND departure_time = ?
         LIMIT 1`,
        [driverId, r.stops[0].city, lastStop.city, departureUtc],
      );
      if (existingRide.length > 0) continue;

      const [rideRes] = await conn.query(
        `INSERT INTO rides (
           driver_id, origin_name, destination_name, departure_time, estimated_arrival_time,
           available_seats, declared_trip_cost, luggage_allowed, pets_allowed, smoking_allowed, women_only, status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
        [
          driverId,
          r.stops[0].city,
          lastStop.city,
          departureUtc,
          arrivalUtc,
          r.available_seats,
          r.declared_trip_cost,
          r.luggage_allowed,
          r.pets_allowed,
          r.smoking_allowed,
          r.women_only,
        ],
      );
      const rideId = rideRes.insertId;
      await conn.query(
        `INSERT INTO ride_stops (
           ride_id, stop_order, city_name, location_name, latitude, longitude,
           distance_from_origin_km, estimated_arrival_time
         ) VALUES ?`,
        [
          r.stops.map((s, idx) => [
            rideId,
            (idx + 1) * 10,
            s.city,
            s.loc,
            s.lat,
            s.lng,
            s.km,
            new Date(departureUtc.getTime() + s.min * 60 * 1000),
          ]),
        ],
      );
      ridesInserted += 1;
    }

    // 3. Seed one past completed ride + sample mutual reviews idempotently so public profiles show ratings
    const pastDep = new Date('2026-11-10T08:00:00Z');
    const pastArr = new Date('2026-11-10T10:45:00Z');
    const ioanaId = userIdsByEmail.get('ioana.popescu@ulbsibiu.ro');
    const andreiId = userIdsByEmail.get('andrei.munteanu@stud.ubbcluj.ro');
    const elenaId = userIdsByEmail.get('elena.radu@student.upt.ro');

    let completedRideId;
    const [existingCompleted] = await conn.query(
      `SELECT id FROM rides WHERE driver_id = ? AND departure_time = ? LIMIT 1`,
      [ioanaId, pastDep],
    );
    if (existingCompleted.length > 0) {
      completedRideId = existingCompleted[0].id;
    } else {
      const [cr] = await conn.query(
        `INSERT INTO rides (
           driver_id, origin_name, destination_name, departure_time, estimated_arrival_time,
           available_seats, declared_trip_cost, luggage_allowed, pets_allowed, smoking_allowed, women_only, status
         ) VALUES (?, 'Sibiu', 'Cluj-Napoca', ?, ?, 3, 152, TRUE, FALSE, FALSE, FALSE, 'completed')`,
        [ioanaId, pastDep, pastArr],
      );
      completedRideId = cr.insertId;
      await conn.query(
        `INSERT INTO ride_stops (
           ride_id, stop_order, city_name, location_name, latitude, longitude,
           distance_from_origin_km, estimated_arrival_time
         ) VALUES
           (?, 10, 'Sibiu', 'Gara Mare Sibiu', 45.7983, 24.1256, 0, ?),
           (?, 20, 'Cluj-Napoca', 'Campus Hașdeu', 46.7646, 23.5801, 168, ?)`,
        [completedRideId, pastDep, completedRideId, pastArr],
      );
    }

    const sampleReviews = [
      [completedRideId, andreiId, ioanaId, 5, 'Punctuală la plecarea din Sibiu și drum foarte plăcut spre Cluj!'],
      [completedRideId, elenaId, ioanaId, 5, 'Comunicare excelentă și împărțire corectă a costului.'],
      [completedRideId, ioanaId, andreiId, 5, 'Pasager serios, a ajuns la timp la punctul de întâlnire.'],
    ];

    for (const [rideId, reviewerId, reviewedUserId, stars, comment] of sampleReviews) {
      await conn.query(
        `INSERT INTO reviews (ride_id, reviewer_id, reviewed_user_id, rating_stars, comment)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE id = id`,
        [rideId, reviewerId, reviewedUserId, stars, comment],
      );
    }

    await conn.commit();
    return { usersCount: DEMO_USERS.length, ridesInserted };
  } catch (err) {
    await conn.rollback();
    throw err;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const conn = await mysql.createConnection(dbConfig());
  try {
    const result = await seedDemo(conn);
    console.log(
      `Demo seed complete (${result.usersCount} demo student drivers ensured, ${result.ridesInserted} new upcoming rides inserted).`,
    );
  } finally {
    await conn.end();
  }
}
