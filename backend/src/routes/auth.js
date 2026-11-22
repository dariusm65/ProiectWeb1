// Auth routes: POST /api/auth/register, POST /api/auth/login, GET /api/auth/me
// (D-004, D-013, D-014, D-018).
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { matchUniversityDomain } from '../domain/universityDomains.js';
import { validateBody } from '../middleware/validate.js';
import { formatSafeUser, signAccessToken, requireAuth } from '../middleware/auth.js';

const BCRYPT_ROUNDS = 10;
// Precomputed dummy hash to equalize timing when email is not found on login
const DUMMY_HASH = bcrypt.hashSync('studride-dummy-timing-password', BCRYPT_ROUNDS);

const withinBcryptByteLimit = (val) => Buffer.byteLength(val, 'utf8') <= 72;

const registerSchema = z.object({
  email: z.string().trim().email().max(255).transform((v) => v.toLowerCase()),
  password: z
    .string()
    .min(8)
    .refine(withinBcryptByteLimit, { message: 'Password must be at most 72 UTF-8 bytes' }),
  full_name: z.string().trim().min(2).max(150),
  phone: z.string().trim().max(50).optional().nullable(),
  gender: z.enum(['female', 'male', 'prefer_not_to_say']).optional().default('prefer_not_to_say'),
});

const loginSchema = z.object({
  email: z.string().trim().email().max(255).transform((v) => v.toLowerCase()),
  password: z
    .string()
    .min(1)
    .refine(withinBcryptByteLimit, { message: 'Password must be at most 72 UTF-8 bytes' }),
});

export function createAuthRouter({ pool, jwtSecret, extraUniversityDomains }) {
  const router = Router();

  router.post('/register', validateBody(registerSchema), async (req, res, next) => {
    try {
      const { email, password, full_name, phone = null, gender } = req.body;
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const universityDomain = matchUniversityDomain(email, extraUniversityDomains);

      let insertId;
      try {
        const [result] = await pool.query(
          `INSERT INTO users (email, password_hash, full_name, phone, university_domain, role, gender)
           VALUES (?, ?, ?, ?, ?, 'user', ?)`,
          [email, passwordHash, full_name, phone, universityDomain, gender],
        );
        insertId = result.insertId;
      } catch (err) {
        if (err && err.code === 'ER_DUP_ENTRY') {
          return res.status(409).json({
            error: 'EMAIL_ALREADY_EXISTS',
            message: 'An account with this email address already exists',
          });
        }
        throw err;
      }

      const [rows] = await pool.query(
        `SELECT id, email, full_name, phone, university_domain, role, gender, is_suspended, created_at
         FROM users WHERE id = ? LIMIT 1`,
        [insertId],
      );
      const safeUser = formatSafeUser(rows[0]);
      const token = signAccessToken(safeUser, jwtSecret);

      return res.status(201).json({ token, user: safeUser });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/login', validateBody(loginSchema), async (req, res, next) => {
    try {
      const { email, password } = req.body;
      const [rows] = await pool.query(
        `SELECT id, email, password_hash, full_name, phone, university_domain, role, gender, is_suspended, created_at
         FROM users WHERE email = ? LIMIT 1`,
        [email],
      );

      if (rows.length === 0) {
        await bcrypt.compare(password, DUMMY_HASH);
        return res.status(401).json({
          error: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
        });
      }

      const row = rows[0];
      const passwordMatches = await bcrypt.compare(password, row.password_hash);
      if (!passwordMatches) {
        return res.status(401).json({
          error: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
        });
      }

      if (row.is_suspended) {
        return res.status(403).json({
          error: 'ACCOUNT_SUSPENDED',
          message: 'Account is suspended',
        });
      }

      const safeUser = formatSafeUser(row);
      const token = signAccessToken(safeUser, jwtSecret);
      return res.status(200).json({ token, user: safeUser });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/me', requireAuth(pool, jwtSecret), (req, res) => {
    return res.status(200).json({ user: req.user });
  });

  return router;
}
