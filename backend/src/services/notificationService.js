// In-app notifications polling & read-state service:
// - GET /api/notifications (listMyNotifications)
// - PATCH /api/notifications/:notificationId/read (markNotificationRead)
// - POST /api/notifications/read-all (markAllNotificationsRead)
// (D-007, D-011, D-013, D-014)
import { ApiError } from '../errors.js';
import { reconcileRidesLazily } from './rideService.js';

function formatNotification(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    type: row.type,
    title: row.title,
    message: row.message,
    is_read: Boolean(row.is_read),
    created_at: row.created_at,
  };
}

/**
 * Reconcile any rides where the caller is the driver or has a pending / pending_reconfirmation
 * booking so lazy notifications (`booking_expired`, `reconfirm_lapsed`) are materialised on read (D-003, D-007).
 */
async function reconcileUserRidesLazily(pool, userId, now) {
  const [rows] = await pool.query(
    `SELECT DISTINCT r.id AS ride_id
     FROM rides r
     LEFT JOIN bookings b ON b.ride_id = r.id
     WHERE (r.driver_id = ? OR b.passenger_id = ?)
       AND b.status IN ('pending', 'pending_reconfirmation')`,
    [userId, userId],
  );
  if (rows.length > 0) {
    await reconcileRidesLazily(
      pool,
      rows.map((r) => r.ride_id),
      now,
    );
  }
}

async function getUnreadCount(pool, userId) {
  const [[row]] = await pool.query(
    'SELECT COUNT(*) AS unread_count FROM notifications WHERE user_id = ? AND is_read = FALSE',
    [userId],
  );
  return Number(row.unread_count);
}

/**
 * GET /api/notifications (authenticated):
 * Triggers lazy reconciliation on caller's rides first, then returns caller's notifications
 * newest-first (`created_at DESC, id DESC`), with optional `unreadOnly` filter and total `unread_count`.
 */
export async function listMyNotifications(pool, user, { unreadOnly = false } = {}, now) {
  await reconcileUserRidesLazily(pool, user.id, now);

  const conditions = ['user_id = ?'];
  const args = [user.id];
  if (unreadOnly) {
    conditions.push('is_read = FALSE');
  }

  const [rows] = await pool.query(
    `SELECT id, user_id, type, title, message, is_read, created_at
     FROM notifications
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC, id DESC`,
    args,
  );
  const unreadCount = await getUnreadCount(pool, user.id);

  return {
    notifications: rows.map(formatNotification),
    unread_count: unreadCount,
  };
}

/**
 * PATCH /api/notifications/:notificationId/read (authenticated owner only):
 * Marks a single notification belonging to the caller as read (`is_read = TRUE`).
 */
export async function markNotificationRead(pool, user, notificationId) {
  const [rows] = await pool.query(
    'SELECT id, user_id, type, title, message, is_read, created_at FROM notifications WHERE id = ?',
    [notificationId],
  );
  if (rows.length === 0) {
    throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
  }
  const notif = rows[0];
  if (notif.user_id !== user.id) {
    throw new ApiError(403, 'FORBIDDEN', 'You can only mark your own notifications as read');
  }

  if (!notif.is_read) {
    await pool.query('UPDATE notifications SET is_read = TRUE WHERE id = ?', [notificationId]);
    notif.is_read = true;
  }

  const unreadCount = await getUnreadCount(pool, user.id);
  return {
    notification: formatNotification(notif),
    unread_count: unreadCount,
  };
}

/**
 * POST /api/notifications/read-all (authenticated):
 * Marks all unread notifications belonging to the caller as read (`is_read = TRUE`).
 */
export async function markAllNotificationsRead(pool, user) {
  const [res] = await pool.query(
    'UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE',
    [user.id],
  );
  return {
    marked_read_count: res.affectedRows,
    unread_count: 0,
  };
}
