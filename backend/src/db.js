// MySQL connection pool (raw SQL via mysql2, no ORM — D-003).
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(root, '.env') });

/** Connection options shared by the pool and the CLI scripts. */
export function dbConfig(overrides = {}) {
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
    ...overrides,
  };
}

export function createPool() {
  return mysql.createPool({ ...dbConfig(), waitForConnections: true, connectionLimit: 10 });
}
