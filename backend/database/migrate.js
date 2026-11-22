// Versioned SQL migration runner (D-003). Applies backend/database/migrations/*.sql in
// filename order and records each applied file in `schema_migrations`.
//
// Note: MySQL DDL causes an implicit commit, so a failed migration cannot be rolled back
// automatically. A version is recorded only after its whole file ran successfully, and the
// migration files use CREATE TABLE IF NOT EXISTS so a half-applied file can be re-run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { dbConfig } from '../src/db.js';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * @param {import('mysql2/promise').Connection} conn connection with multipleStatements: true
 * @returns {Promise<string[]>} versions applied by this call
 */
export async function migrate(conn) {
  await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    version VARCHAR(255) NOT NULL UNIQUE,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);
  const [done] = await conn.query('SELECT version FROM schema_migrations');
  const applied = new Set(done.map((r) => r.version));
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  const ran = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    await conn.query(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
    await conn.query('INSERT INTO schema_migrations (version) VALUES (?)', [file]);
    ran.push(file);
  }
  return ran;
}

// CLI: `npm run migrate`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const conn = await mysql.createConnection(dbConfig({ multipleStatements: true }));
  try {
    const ran = await migrate(conn);
    console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Database already up to date.');
  } finally {
    await conn.end();
  }
}
