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
    } else {
      console.warn(
        '[Startup Warning] ADMIN_PASSWORD or MODERATOR_PASSWORD is not set — skipping idempotent seed (known_places and system accounts).',
      );
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

  server.on('error', async (err) => {
    console.error('HTTP server error:', err.message);
    try {
      await pool.end();
    } catch {
      // ignore pool shutdown errors during startup failure
    }
    process.exit(1);
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;

    const forceTimer = setTimeout(() => {
      console.error('Graceful shutdown timed out; forcing exit.');
      process.exit(1);
    }, 10000);
    forceTimer.unref();

    server.close(async (closeErr) => {
      if (closeErr) console.error('Error closing HTTP server:', closeErr.message);
      try {
        await pool.end();
      } catch (poolErr) {
        console.error('Error closing MySQL pool:', poolErr.message);
      }
      process.exit(closeErr ? 1 : 0);
    });
    server.closeIdleConnections?.();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((err) => {
  console.error('Failed to start StudRide API:', err.message);
  process.exit(1);
});
