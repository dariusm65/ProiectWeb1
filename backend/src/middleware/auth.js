// JWT signing/verification and server-side RBAC middleware (D-004, D-013).
import jwt from 'jsonwebtoken';
import { UNIVERSITY_BADGE_NOTE } from '../domain/universityDomains.js';

export function formatSafeUser(row) {
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    phone: row.phone ?? null,
    university_domain: row.university_domain ?? null,
    has_university_badge: Boolean(row.university_domain),
    university_badge_note: row.university_domain ? UNIVERSITY_BADGE_NOTE : null,
    role: row.role,
    gender: row.gender,
    is_suspended: Boolean(row.is_suspended),
    created_at: row.created_at,
  };
}

export function signAccessToken(user, jwtSecret) {
  return jwt.sign(
    { sub: String(user.id), role: user.role },
    jwtSecret,
    { algorithm: 'HS256', expiresIn: '7d' },
  );
}

/**
 * Verify Bearer JWT and re-check live user role and suspension status in MySQL (D-013).
 */
export function requireAuth(pool, jwtSecret) {
  return async (req, res, next) => {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Missing or malformed Authorization header',
      });
    }

    const token = header.slice(7).trim();
    let payload;
    try {
      payload = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
    } catch {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Invalid or expired authentication token',
      });
    }

    const userId = Number(payload.sub);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Invalid token subject',
      });
    }

    const [rows] = await pool.query(
      `SELECT id, email, full_name, phone, university_domain, role, gender, is_suspended, created_at
       FROM users WHERE id = ? LIMIT 1`,
      [userId],
    );
    if (rows.length === 0) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Account not found',
      });
    }

    const user = rows[0];
    if (user.is_suspended) {
      return res.status(403).json({
        error: 'ACCOUNT_SUSPENDED',
        message: 'Account is suspended',
      });
    }

    req.user = formatSafeUser(user);
    return next();
  };
}

/**
 * Server-side RBAC guard checking live DB role populated by requireAuth (D-013).
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Insufficient permissions for this action',
      });
    }
    return next();
  };
}
