// MySQL connection pool (raw SQL via mysql2, no ORM — D-003).
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(root, '.env') });

/**
 * Parses a `mysql://user:password@host:port/database` URL (managed MySQL providers / Render,
 * D-021) into mysql2 connection fields. Returns null when the URL is absent.
 */
export function parseDatabaseUrl(url) {
  if (!url) return null;
  const parsed = new URL(url);
  if (parsed.protocol !== 'mysql:') {
    throw new Error('DATABASE_URL must use the mysql:// scheme');
  }
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    sslFromUrl: ['true', 'required', 'require'].includes(
      (parsed.searchParams.get('ssl') || parsed.searchParams.get('ssl-mode') || '').toLowerCase(),
    ),
  };
}

/** Connection options shared by the pool and the CLI scripts. DATABASE_URL wins over DB_*. */
export function dbConfig(overrides = {}) {
  const fromUrl = parseDatabaseUrl(process.env.DATABASE_URL);
  const useSsl = fromUrl?.sslFromUrl || ['1', 'true'].includes(String(process.env.DB_SSL || '').toLowerCase());
  return {
    host: fromUrl?.host || process.env.DB_HOST || '127.0.0.1',
    port: fromUrl?.port || Number(process.env.DB_PORT || 3306),
    user: fromUrl?.user || process.env.DB_USER,
    password: fromUrl ? fromUrl.password : process.env.DB_PASSWORD,
    database: fromUrl?.database || process.env.DB_NAME,
    charset: 'utf8mb4',
    timezone: 'Z',
    ...(useSsl ? { ssl: { rejectUnauthorized: true, minVersion: 'TLSv1.2' } } : {}),
    ...overrides,
  };
}

export function createPool() {
  return mysql.createPool({
    ...dbConfig(),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 50,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
  });
}
