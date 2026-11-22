// Production / development Express entry point (D-002, D-003).
import mysql from 'mysql2/promise';
import { dbConfig, createPool } from './db.js';
import { migrate } from '../database/migrate.js';
import { seed } from '../database/seed.js';
import { createApp } from './app.js';

const PORT = Number(process.env.PORT || 3001);

async function runStartupMigrationsAndSeed() {
  const conn = await mysql.createConnection({ ...dbConfig(), multipleStatements: true });
  try {
    await migrate(conn);
    if (process.env.ADMIN_PASSWORD && process.env.MODERATOR_PASSWORD) {
      await seed(conn);
    }
  } finally {
    await conn.end();
  }
}

async function start() {
  await runStartupMigrationsAndSeed();

  const pool = createPool();
  const app = createApp({ pool });

  const server = app.listen(PORT, () => {
    console.log(`StudRide API listening on http://127.0.0.1:${PORT} (docs: /api/docs)`);
  });

  const shutdown = async () => {
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((err) => {
  console.error('Failed to start StudRide API:', err.message);
  process.exit(1);
});
