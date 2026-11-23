// Ride chat messages service:
// - GET /api/rides/:rideId/messages (listRideMessages)
// - POST /api/rides/:rideId/messages (postRideMessage)
// (D-002, D-011, D-013, D-014)
import { ApiError } from '../errors.js';
import { UNIVERSITY_BADGE_NOTE } from '../domain/universityDomains.js';
import { reconcileRidesLazily } from './rideService.js';

const CHAT_AUTHORIZED_BOOKING_STATUSES = new Set(['confirmed', 'pending_reconfirmation']);

const badge = (domain) => ({
  has_university_badge: Boolean(domain),
  university_badge_note: domain ? UNIVERSITY_BADGE_NOTE : null,
});

function formatChatMessage(row) {
  return {
    id: row.id,
    ride_id: row.ride_id,
    sender_id: row.sender_id,
    message_text: row.message_text,
    created_at: row.created_at,
    sender: {
      id: row.sender_id,
      full_name: row.sender_name,
      ...badge(row.sender_domain),
    },
  };
}

/**
 * Pure D-011 participant check: only the ride's driver or a passenger with a booking
 * currently in `confirmed` or `pending_reconfirmation` status is authorized.
 * Passengers with `pending`, `cancelled`, `rejected`, or `expired` bookings are revoked (403).
 */
export function isAuthorizedChatParticipant({ ride, bookings, userId }) {
  if (!ride || !Number.isInteger(userId)) return false;
  if (ride.driver_id === userId) return true;
  return bookings.some(
    (b) => b.passenger_id === userId && CHAT_AUTHORIZED_BOOKING_STATUSES.has(b.status),
  );
}

async function loadAndAuthorizeChatRide(pool, rideId, userId, now) {
  const [rideRows] = await pool.query('SELECT * FROM rides WHERE id = ?', [rideId]);
  if (rideRows.length === 0) {
    throw new ApiError(404, 'RIDE_NOT_FOUND', 'Ride not found');
  }

  // Lazily expire overdue pending_reconfirmation or departure-time pending bookings first (D-003, D-007, D-011)
  await reconcileRidesLazily(pool, [rideId], now);

  const [[ride]] = await pool.query('SELECT * FROM rides WHERE id = ?', [rideId]);
  const [bookings] = await pool.query(
    'SELECT id, passenger_id, status FROM bookings WHERE ride_id = ?',
    [rideId],
  );

  if (!isAuthorizedChatParticipant({ ride, bookings, userId })) {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Only the ride driver and passengers with confirmed or pending_reconfirmation bookings may access ride chat',
    );
  }

  return { ride, bookings };
}

/**
 * GET /api/rides/:rideId/messages (authenticated participant only, D-011):
 * Reconciles lazy expirations/lapses, enforces D-011 participant membership, and returns
 * messages ordered deterministically by `created_at ASC, id ASC` (Guardrail 3) with safe sender summary.
 */
export async function listRideMessages(pool, user, rideId, now) {
  await loadAndAuthorizeChatRide(pool, rideId, user.id, now);

  const [rows] = await pool.query(
    `SELECT m.id, m.ride_id, m.sender_id, m.message_text, m.created_at,
            u.full_name AS sender_name, u.university_domain AS sender_domain
     FROM chat_messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.ride_id = ?
     ORDER BY m.created_at ASC, m.id ASC`,
    [rideId],
  );

  return rows.map(formatChatMessage);
}

/**
 * POST /api/rides/:rideId/messages (authenticated participant only, D-011):
 * Reconciles lazy expirations/lapses, enforces D-011 participant membership, rejects posting
 * if the ride is cancelled (409 RIDE_NOT_ACTIVE), persists the message, and fans out idempotent
 * in-app notifications (`chat_message:<messageId>:<recipientId>`) to all other active chat participants.
 */
export async function postRideMessage(pool, user, rideId, { message_text: messageText }, now) {
  const { ride, bookings } = await loadAndAuthorizeChatRide(pool, rideId, user.id, now);

  if (ride.status === 'cancelled') {
    throw new ApiError(409, 'RIDE_NOT_ACTIVE', 'Cannot post messages to a cancelled ride');
  }

  const [res] = await pool.query(
    'INSERT INTO chat_messages (ride_id, sender_id, message_text, created_at) VALUES (?, ?, ?, ?)',
    [rideId, user.id, messageText, now],
  );
  const messageId = res.insertId;

  // Fan out notifications to all other active chat participants (driver + confirmed/pending_reconfirmation passengers, excluding sender)
  const recipientIds = new Set();
  if (ride.driver_id !== user.id) {
    recipientIds.add(ride.driver_id);
  }
  for (const b of bookings) {
    if (CHAT_AUTHORIZED_BOOKING_STATUSES.has(b.status) && b.passenger_id !== user.id) {
      recipientIds.add(b.passenger_id);
    }
  }

  if (recipientIds.size > 0) {
    const preview = messageText.length > 80 ? `${messageText.slice(0, 77)}...` : messageText;
    const notifRows = [...recipientIds].map((recipientId) => [
      recipientId,
      'chat_message',
      `Mesaj nou în cursa ${ride.origin_name} → ${ride.destination_name}`,
      `${user.full_name}: ${preview}`,
      `chat_message:${messageId}:${recipientId}`,
    ]);
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, idempotency_key)
       VALUES ?
       ON DUPLICATE KEY UPDATE id = id`,
      [notifRows],
    );
  }

  const [[created]] = await pool.query(
    `SELECT m.id, m.ride_id, m.sender_id, m.message_text, m.created_at,
            u.full_name AS sender_name, u.university_domain AS sender_domain
     FROM chat_messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.id = ?`,
    [messageId],
  );

  return formatChatMessage(created);
}
