// Moderation reports & admin suspension cascade service:
// - POST /api/reports (createReport)
// - GET /api/admin/reports (listReports)
// - PATCH /api/admin/reports/:reportId (resolveOrDismissReport)
// - GET /api/admin/users (listUsersForModeration)
// - POST /api/admin/users/:userId/suspend (suspendUser)
// - POST /api/admin/users/:userId/unsuspend (unsuspendUser)
// - POST /api/admin/rides/:rideId/cancel (moderateCancelRide)
// - PATCH /api/admin/users/:userId/role (changeUserRole)
// - GET /api/admin/stats (getPlatformStats)
// (D-003, D-011, D-013, D-014, D-016)
import { ApiError } from '../errors.js';
import { UNIVERSITY_BADGE_NOTE } from '../domain/universityDomains.js';
import { computeSeriousnessScore, hasRecentCancellationBadge } from '../domain/seriousnessScore.js';
import { reconcileRideBookings } from './bookingAcceptanceService.js';

const badge = (domain) => ({
  has_university_badge: Boolean(domain),
  university_badge_note: domain ? UNIVERSITY_BADGE_NOTE : null,
});

function formatReport(row) {
  return {
    id: row.id,
    reporter_id: row.reporter_id ?? null,
    reported_user_id: row.reported_user_id ?? null,
    ride_id: row.ride_id ?? null,
    message_id: row.message_id ?? null,
    reason: row.reason,
    details: row.details ?? null,
    status: row.status,
    resolved_by: row.resolved_by ?? null,
    resolved_at: row.resolved_at ?? null,
    created_at: row.created_at,
  };
}

function formatModerationUser(u, { ratingAverage, ratingCount, seriousnessScore, infractionCount, hasBadge }) {
  return {
    id: u.id,
    email: u.email,
    full_name: u.full_name,
    phone: u.phone ?? null,
    university_domain: u.university_domain ?? null,
    ...badge(u.university_domain),
    role: u.role,
    gender: u.gender,
    is_suspended: Boolean(u.is_suspended),
    rating_average: ratingAverage,
    rating_count: ratingCount,
    seriousness_score: seriousnessScore,
    infraction_count: infractionCount,
    has_recent_cancellation_badge: hasBadge,
    created_at: u.created_at,
  };
}

/**
 * Pure Guardrail 2 helper: validates that a report specifies at least one target
 * (`reported_user_id`, `ride_id`, or `message_id`) and does not self-report.
 */
export function validateReportTargetInput({
  reporterId,
  reported_user_id: reportedUserId = null,
  ride_id: rideId = null,
  message_id: messageId = null,
}) {
  if (reportedUserId == null && rideId == null && messageId == null) {
    throw new ApiError(
      400,
      'REPORT_TARGET_REQUIRED',
      'At least one report target (reported_user_id, ride_id, or message_id) must be provided',
    );
  }
  if (reportedUserId != null && reportedUserId === reporterId) {
    throw new ApiError(400, 'SELF_REPORT_NOT_ALLOWED', 'Self-reporting is not allowed');
  }
  return true;
}

/**
 * Pure D-013 role hierarchy guard for account suspension/unsuspension:
 * - No user can suspend/unsuspend themselves (400 SELF_MODERATION_NOT_ALLOWED).
 * - A `moderator` can only suspend/unsuspend accounts with `role === 'user'` (403 INSUFFICIENT_ROLE_HIERARCHY).
 * - An `admin` can suspend/unsuspend `user` or `moderator` accounts, and never another `admin`.
 */
export function canModerateTargetUser({ actor, target }) {
  if (!actor || !target) {
    throw new ApiError(400, 'INVALID_INPUT', 'Actor and target are required');
  }
  if (actor.id === target.id) {
    throw new ApiError(400, 'SELF_MODERATION_NOT_ALLOWED', 'Self-moderation is not allowed');
  }
  if (actor.role === 'moderator' && target.role !== 'user') {
    throw new ApiError(
      403,
      'INSUFFICIENT_ROLE_HIERARCHY',
      'Insufficient role hierarchy permission: moderators may only suspend or unsuspend standard user accounts',
    );
  }
  if (actor.role === 'admin' && target.role === 'admin') {
    throw new ApiError(
      403,
      'INSUFFICIENT_ROLE_HIERARCHY',
      'Insufficient role hierarchy permission: admin accounts cannot be suspended',
    );
  }
  return true;
}

/**
 * POST /api/reports (authenticated user):
 * Validates target inputs (Guardrail 2), verifies referenced entities exist (404 if missing),
 * and persists the report in `pending` status.
 */
export async function createReport(
  pool,
  user,
  { reported_user_id = null, ride_id = null, message_id = null, reason, details = null },
  now,
) {
  validateReportTargetInput({
    reporterId: user.id,
    reported_user_id,
    ride_id,
    message_id,
  });

  if (reported_user_id != null) {
    const [uRows] = await pool.query('SELECT id FROM users WHERE id = ?', [reported_user_id]);
    if (uRows.length === 0) {
      throw new ApiError(404, 'REPORTED_USER_NOT_FOUND', 'Reported user not found');
    }
  }
  if (ride_id != null) {
    const [rRows] = await pool.query('SELECT id FROM rides WHERE id = ?', [ride_id]);
    if (rRows.length === 0) {
      throw new ApiError(404, 'RIDE_NOT_FOUND', 'Reported ride not found');
    }
  }
  if (message_id != null) {
    const [mRows] = await pool.query('SELECT id FROM chat_messages WHERE id = ?', [message_id]);
    if (mRows.length === 0) {
      throw new ApiError(404, 'MESSAGE_NOT_FOUND', 'Reported chat message not found');
    }
  }

  const [res] = await pool.query(
    `INSERT INTO reports (reporter_id, reported_user_id, ride_id, message_id, reason, details, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [user.id, reported_user_id, ride_id, message_id, reason, details, now],
  );

  const [[created]] = await pool.query('SELECT * FROM reports WHERE id = ?', [res.insertId]);
  return formatReport(created);
}

/**
 * GET /api/admin/reports (moderator / admin):
 * Lists reports ordered newest-first with optional `status` filter (`pending`, `resolved`, `dismissed`).
 */
export async function listReports(pool, { status } = {}) {
  const conditions = [];
  const args = [];
  if (status) {
    conditions.push('status = ?');
    args.push(status);
  }
  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const [rows] = await pool.query(
    `SELECT * FROM reports ${whereSql} ORDER BY created_at DESC, id DESC`,
    args,
  );
  return rows.map(formatReport);
}

/**
 * PATCH /api/admin/reports/:reportId (moderator / admin):
 * Resolves or dismisses a report, recording `resolved_by` and `resolved_at`.
 */
export async function resolveOrDismissReport(pool, actor, reportId, { status }, now) {
  const [rows] = await pool.query('SELECT * FROM reports WHERE id = ?', [reportId]);
  if (rows.length === 0) {
    throw new ApiError(404, 'REPORT_NOT_FOUND', 'Report not found');
  }
  await pool.query(
    'UPDATE reports SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ?',
    [status, actor.id, now, reportId],
  );
  const [[updated]] = await pool.query('SELECT * FROM reports WHERE id = ?', [reportId]);
  return formatReport(updated);
}

/**
 * GET /api/admin/users (moderator / admin):
 * Returns users with computed `seriousness_score`, `infraction_count`, `rating_average`, `rating_count`,
 * and `is_suspended`. Includes `email` for moderation lookup, never `password_hash` (Guardrail 4).
 */
export async function listUsersForModeration(pool, now) {
  const [users] = await pool.query(
    `SELECT id, email, full_name, phone, university_domain, role, gender, is_suspended, created_at
     FROM users ORDER BY id ASC`,
  );
  if (users.length === 0) return [];

  const [ratings] = await pool.query(
    'SELECT reviewed_user_id, AVG(rating_stars) AS avg_stars, COUNT(*) AS n FROM reviews GROUP BY reviewed_user_id',
  );
  const ratingByUser = new Map(ratings.map((r) => [r.reviewed_user_id, r]));

  const [infractions] = await pool.query(
    'SELECT user_id, infraction_type, penalty_percentage_points, occurred_at FROM user_infractions',
  );
  const infractionsByUser = new Map();
  for (const inf of infractions) {
    if (!infractionsByUser.has(inf.user_id)) infractionsByUser.set(inf.user_id, []);
    infractionsByUser.get(inf.user_id).push(inf);
  }

  return users.map((u) => {
    const r = ratingByUser.get(u.id);
    const userInfs = infractionsByUser.get(u.id) || [];
    return formatModerationUser(u, {
      ratingAverage: r && r.n > 0 ? Math.round(Number(r.avg_stars) * 10) / 10 : null,
      ratingCount: r ? Number(r.n) : 0,
      seriousnessScore: computeSeriousnessScore(userInfs, now),
      infractionCount: userInfs.length,
      hasBadge: hasRecentCancellationBadge(userInfs, now),
    });
  });
}

async function getModerationUserById(pool, userId, now) {
  const [users] = await pool.query(
    `SELECT id, email, full_name, phone, university_domain, role, gender, is_suspended, created_at
     FROM users WHERE id = ?`,
    [userId],
  );
  if (users.length === 0) {
    throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
  }
  const u = users[0];
  const [[r]] = await pool.query(
    'SELECT AVG(rating_stars) AS avg_stars, COUNT(*) AS n FROM reviews WHERE reviewed_user_id = ?',
    [userId],
  );
  const [userInfs] = await pool.query(
    'SELECT infraction_type, penalty_percentage_points, occurred_at FROM user_infractions WHERE user_id = ?',
    [userId],
  );
  return formatModerationUser(u, {
    ratingAverage: r && r.n > 0 ? Math.round(Number(r.avg_stars) * 10) / 10 : null,
    ratingCount: r ? Number(r.n) : 0,
    seriousnessScore: computeSeriousnessScore(userInfs, now),
    infractionCount: userInfs.length,
    hasBadge: hasRecentCancellationBadge(userInfs, now),
  });
}

/**
 * POST /api/admin/users/:userId/suspend (moderator / admin, D-013, D-016, D-011):
 * Transactionally suspends an account (`is_suspended = TRUE`) and executes the D-016 cascade:
 * 1. Locks target `users` row (`FOR UPDATE`) and checks role hierarchy (`canModerateTargetUser`).
 * 2. Collects all active future rides (`status = 'active' AND departure_time > now`) where the user
 *    is EITHER the driver OR has a non-terminal booking (`pending`, `confirmed`, `pending_reconfirmation`).
 * 3. Iterates those rides in strictly ascending `ride.id` order, locking `rides` -> `bookings` (`FOR UPDATE`),
 *    running `reconcileRideBookings(conn, { rideId, ride, bookings, now })` first (Guardrail 1), and then:
 *    - If `ride.driver_id === targetUserId`: cancels the ride and all remaining non-terminal bookings,
 *      notifying affected passengers idempotently (`ride_cancelled_moderation`).
 *    - Else (target user is a passenger on another driver's active future ride): cancels the target user's
 *      remaining non-terminal bookings on that ride (freeing seats) and notifies the ride driver idempotently
 *      (`booking_cancelled_moderation`).
 * 4. Per D-016, administrative suspension cancellations NEVER record `user_infractions` or `cancellation_fee_lei`.
 */
export async function suspendUser(pool, actor, targetUserId, { reason = null } = {}, now) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [targetRows] = await conn.query(
      'SELECT id, email, full_name, role, is_suspended FROM users WHERE id = ? FOR UPDATE',
      [targetUserId],
    );
    if (targetRows.length === 0) {
      throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
    }
    const target = targetRows[0];

    canModerateTargetUser({ actor, target });

    await conn.query('UPDATE users SET is_suspended = TRUE WHERE id = ?', [targetUserId]);

    // Find all candidate active future rides where target is driver or has a non-terminal booking
    const [drivenRows] = await conn.query(
      "SELECT id FROM rides WHERE driver_id = ? AND status = 'active' AND departure_time > ?",
      [targetUserId, now],
    );
    const [bookedRideRows] = await conn.query(
      `SELECT DISTINCT r.id
       FROM rides r
       JOIN bookings b ON b.ride_id = r.id
       WHERE b.passenger_id = ?
         AND b.status IN ('pending', 'confirmed', 'pending_reconfirmation')
         AND r.status = 'active'
         AND r.departure_time > ?`,
      [targetUserId, now],
    );

    const affectedRideIds = [
      ...new Set([...drivenRows.map((r) => r.id), ...bookedRideRows.map((r) => r.id)]),
    ].sort((a, b) => a - b);

    let cancelledRidesCount = 0;
    let cancelledPassengerBookingsCount = 0;
    const nowIso = now.toISOString();

    for (const rideId of affectedRideIds) {
      const [rideRows] = await conn.query('SELECT * FROM rides WHERE id = ? FOR UPDATE', [rideId]);
      if (rideRows.length === 0) continue;
      const ride = rideRows[0];

      const [bookings] = await conn.query('SELECT * FROM bookings WHERE ride_id = ? FOR UPDATE', [rideId]);
      bookings.sort((a, b) => a.id - b.id);

      // Guardrail 1: lazily expire/lapse overdue bookings BEFORE cancelling non-terminal bookings
      await reconcileRideBookings(conn, { rideId, ride, bookings, now });

      if (ride.status !== 'active' || new Date(ride.departure_time).getTime() <= now.getTime()) {
        continue;
      }

      if (ride.driver_id === targetUserId) {
        const activeBookings = bookings.filter((b) =>
          ['pending', 'confirmed', 'pending_reconfirmation'].includes(b.status),
        );

        await conn.query("UPDATE rides SET status = 'cancelled' WHERE id = ?", [rideId]);
        cancelledRidesCount += 1;

        if (activeBookings.length > 0) {
          await conn.query(
            `UPDATE bookings
             SET status = 'cancelled', reconfirm_deadline = NULL
             WHERE ride_id = ? AND status IN ('pending', 'confirmed', 'pending_reconfirmation')`,
            [rideId],
          );
          await conn.query(
            `INSERT INTO notifications (user_id, type, title, message, idempotency_key)
             VALUES ?
             ON DUPLICATE KEY UPDATE id = id`,
            [
              activeBookings.map((b) => [
                b.passenger_id,
                'ride_cancelled_moderation',
                'Cursă anulată administrativ',
                `Cursa ${ride.origin_name} → ${ride.destination_name} a fost anulată în urma suspendării contului șoferului. Rezervarea ta a fost anulată fără penalități.`,
                `ride_cancelled_moderation:${rideId}:${b.id}`,
              ]),
            ],
          );
        }
      } else {
        // Target user is a passenger on another driver's active future ride
        const targetBookings = bookings.filter(
          (b) =>
            b.passenger_id === targetUserId &&
            ['pending', 'confirmed', 'pending_reconfirmation'].includes(b.status),
        );
        if (targetBookings.length > 0) {
          const targetBookingIds = targetBookings.map((b) => b.id);
          await conn.query(
            `UPDATE bookings
             SET status = 'cancelled', reconfirm_deadline = NULL, cancellation_fee_lei = NULL
             WHERE id IN (?)`,
            [targetBookingIds],
          );
          cancelledPassengerBookingsCount += targetBookings.length;

          await conn.query(
            `INSERT INTO notifications (user_id, type, title, message, idempotency_key)
             VALUES ?
             ON DUPLICATE KEY UPDATE id = id`,
            [
              targetBookings.map((b) => [
                ride.driver_id,
                'booking_cancelled_moderation',
                'Rezervare anulată administrativ',
                `Rezervarea pasagerului ${target.full_name} pentru cursa ${ride.origin_name} → ${ride.destination_name} a fost anulată în urma suspendării contului. Locul a fost eliberat.`,
                `booking_cancelled_moderation:${b.id}`,
              ]),
            ],
          );
        }
      }
    }

    const reasonSuffix = reason ? ` Motiv: ${reason}` : '';
    await conn.query(
      `INSERT INTO notifications (user_id, type, title, message, idempotency_key)
       VALUES (?, 'account_suspended', 'Cont suspendat de moderator', ?, ?)
       ON DUPLICATE KEY UPDATE id = id`,
      [
        targetUserId,
        `Contul tău a fost suspendat, iar cursele și rezervările viitoare au fost anulate.${reasonSuffix}`,
        `account_suspended:${targetUserId}:${nowIso}`,
      ],
    );

    await conn.commit();
    return {
      user: await getModerationUserById(pool, targetUserId, now),
      cancelled_rides: cancelledRidesCount,
      cancelled_passenger_bookings: cancelledPassengerBookingsCount,
    };
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      // preserve original error
    }
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * POST /api/admin/users/:userId/unsuspend (moderator / admin, D-013):
 * Restores `is_suspended = FALSE` subject to role hierarchy checks.
 */
export async function unsuspendUser(pool, actor, targetUserId, now) {
  const [targetRows] = await pool.query('SELECT id, role, is_suspended FROM users WHERE id = ?', [targetUserId]);
  if (targetRows.length === 0) {
    throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
  }
  const target = targetRows[0];

  canModerateTargetUser({ actor, target });

  await pool.query('UPDATE users SET is_suspended = FALSE WHERE id = ?', [targetUserId]);
  await pool.query(
    `INSERT INTO notifications (user_id, type, title, message, idempotency_key)
     VALUES (?, 'account_unsuspended', 'Cont reactivat', 'Contul tău StudRide a fost reactivat.', ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [targetUserId, `account_unsuspended:${targetUserId}:${now.toISOString()}`],
  );

  return {
    user: await getModerationUserById(pool, targetUserId, now),
  };
}

/**
 * POST /api/admin/rides/:rideId/cancel (moderator / admin, CONTEXT.md, D-013, D-016):
 * Moderators/admins can cancel an active ride without recording a `driver_late_cancel` infraction.
 * Runs `reconcileRideBookings` first inside the `FOR UPDATE` transaction (Guardrail 1).
 */
export async function moderateCancelRide(pool, _actor, rideId, { reason = null } = {}, now) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rideRows] = await conn.query('SELECT * FROM rides WHERE id = ? FOR UPDATE', [rideId]);
    if (rideRows.length === 0) {
      throw new ApiError(404, 'RIDE_NOT_FOUND', 'Ride not found');
    }
    const ride = rideRows[0];

    const [bookings] = await conn.query('SELECT * FROM bookings WHERE ride_id = ? FOR UPDATE', [rideId]);
    bookings.sort((a, b) => a.id - b.id);

    // Guardrail 1: reconcile lazy expirations/lapses before cancelling
    await reconcileRideBookings(conn, { rideId, ride, bookings, now });

    if (ride.status !== 'active') {
      throw new ApiError(409, 'RIDE_NOT_ACTIVE', `Ride is not active (status: ${ride.status})`);
    }

    const activeBookings = bookings.filter((b) =>
      ['pending', 'confirmed', 'pending_reconfirmation'].includes(b.status),
    );

    await conn.query("UPDATE rides SET status = 'cancelled' WHERE id = ?", [rideId]);
    if (activeBookings.length > 0) {
      await conn.query(
        `UPDATE bookings
         SET status = 'cancelled', reconfirm_deadline = NULL
         WHERE ride_id = ? AND status IN ('pending', 'confirmed', 'pending_reconfirmation')`,
        [rideId],
      );
    }

    const reasonSuffix = reason ? ` Motiv: ${reason}` : '';
    const notifRows = [
      [
        ride.driver_id,
        'ride_cancelled_moderation',
        'Cursă anulată de moderator',
        `Cursa ta ${ride.origin_name} → ${ride.destination_name} a fost anulată de un moderator.${reasonSuffix}`,
        `ride_cancelled_moderation_driver:${rideId}`,
      ],
      ...activeBookings.map((b) => [
        b.passenger_id,
        'ride_cancelled_moderation',
        'Cursă anulată de moderator',
        `Cursa ${ride.origin_name} → ${ride.destination_name} a fost anulată de un moderator. Rezervarea ta a fost anulată.${reasonSuffix}`,
        `ride_cancelled_moderation:${rideId}:${b.id}`,
      ]),
    ];

    await conn.query(
      `INSERT INTO notifications (user_id, type, title, message, idempotency_key)
       VALUES ?
       ON DUPLICATE KEY UPDATE id = id`,
      [notifRows],
    );

    await conn.commit();
    return {
      cancelled_ride_id: ride.id,
      cancelled_bookings: activeBookings.length,
      infraction_recorded: false,
    };
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      // preserve original error
    }
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * PATCH /api/admin/users/:userId/role (admin only, CONTEXT.md, D-013):
 * Promotes/demotes between `user` and `moderator`. Blocks self-role changes and modifying another `admin`.
 */
export async function changeUserRole(pool, actor, targetUserId, { role }, now) {
  if (actor.id === targetUserId) {
    throw new ApiError(400, 'SELF_MODERATION_NOT_ALLOWED', 'You cannot change your own role');
  }
  const [rows] = await pool.query('SELECT id, role FROM users WHERE id = ?', [targetUserId]);
  if (rows.length === 0) {
    throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
  }
  if (rows[0].role === 'admin') {
    throw new ApiError(403, 'INSUFFICIENT_ROLE_HIERARCHY', 'Cannot change the role of an admin account');
  }

  await pool.query('UPDATE users SET role = ? WHERE id = ?', [role, targetUserId]);
  return {
    user: await getModerationUserById(pool, targetUserId, now),
  };
}

/**
 * GET /api/admin/stats (admin only, CONTEXT.md, DS-009):
 * Platform statistics summary for the admin dashboard.
 */
export async function getPlatformStats(pool) {
  const [[usersRow]] = await pool.query(
    `SELECT COUNT(*) AS total_users,
            SUM(CASE WHEN is_suspended = TRUE THEN 1 ELSE 0 END) AS suspended_users,
            SUM(CASE WHEN university_domain IS NOT NULL THEN 1 ELSE 0 END) AS university_validated_users
     FROM users`,
  );
  const [[ridesRow]] = await pool.query(
    `SELECT COUNT(*) AS total_rides,
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_rides,
            SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_rides
     FROM rides`,
  );
  const [[bookingsRow]] = await pool.query(
    `SELECT COUNT(*) AS total_bookings,
            SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed_bookings
     FROM bookings`,
  );
  const [[reportsRow]] = await pool.query(
    `SELECT COUNT(*) AS total_reports,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_reports
     FROM reports`,
  );
  const [[reviewsRow]] = await pool.query('SELECT COUNT(*) AS total_reviews FROM reviews');

  return {
    total_users: Number(usersRow.total_users ?? 0),
    suspended_users: Number(usersRow.suspended_users ?? 0),
    university_validated_users: Number(usersRow.university_validated_users ?? 0),
    total_rides: Number(ridesRow.total_rides ?? 0),
    active_rides: Number(ridesRow.active_rides ?? 0),
    cancelled_rides: Number(ridesRow.cancelled_rides ?? 0),
    total_bookings: Number(bookingsRow.total_bookings ?? 0),
    confirmed_bookings: Number(bookingsRow.confirmed_bookings ?? 0),
    total_reports: Number(reportsRow.total_reports ?? 0),
    pending_reports: Number(reportsRow.pending_reports ?? 0),
    total_reviews: Number(reviewsRow.total_reviews ?? 0),
  };
}
