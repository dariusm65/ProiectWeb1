// Idempotent seed (D-003): runs safely on local and live, any number of times.
//  - known_places from seeds/*.sql (survey localities only, coordinates NULL until filled)
//  - two system accounts; passwords come from ADMIN_PASSWORD / MODERATOR_PASSWORD (.env),
//    hashed with bcrypt at runtime. No password or hash is ever committed.
//  - no fake users, no fake rides.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { dbConfig } from '../src/db.js';

const seedsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'seeds');

// Passwords are read lazily (at seed time) from the environment, never from source.
const SYSTEM_ACCOUNTS = [
  { email: 'admin@studride.local', name: 'StudRide Admin', role: 'admin', envVar: 'ADMIN_PASSWORD',
    password: () => process.env.ADMIN_PASSWORD },
  { email: 'moderator@studride.local', name: 'StudRide Moderator', role: 'moderator', envVar: 'MODERATOR_PASSWORD',
    password: () => process.env.MODERATOR_PASSWORD },
];

/** @param {import('mysql2/promise').Connection} conn connection with multipleStatements: true */
export async function seed(conn) {
  // Validate secrets first so a missing one aborts before anything is written.
  for (const a of SYSTEM_ACCOUNTS) {
    if (!a.password()) throw new Error(`${a.envVar} is not set (see .env.example)`);
  }
  const files = fs.readdirSync(seedsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) await conn.query(fs.readFileSync(path.join(seedsDir, file), 'utf8'));

  for (const a of SYSTEM_ACCOUNTS) {
    const hash = await bcrypt.hash(a.password(), 10);
    // Existing accounts are left untouched (password changes are not re-applied by the seed).
    await conn.query(
      `INSERT INTO users (email, password_hash, full_name, role) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE email = email`,
      [a.email, hash, a.name, a.role]);
  }
}

// CLI: `npm run seed`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const conn = await mysql.createConnection(dbConfig({ multipleStatements: true }));
  try {
    await seed(conn);
    console.log('Seed complete.');
  } finally {
    await conn.end();
  }
}
