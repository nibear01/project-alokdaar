import { pool } from '../config/db.js';

/**
 * Minimal migration runner.
 * Add SQL files in server/src/db/migrations/ named 001_init.sql, 002_....sql
 * They run once each, tracked in schema_migrations.
 */
async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const fs = await import('fs/promises');
  const path = await import('path');
  const { fileURLToPath } = await import('url');
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

  let files = [];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  } catch {
    console.log('[migrate] no migrations directory yet');
  }

  for (const file of files) {
    const { rows } = await pool.query('SELECT 1 FROM schema_migrations WHERE id = $1', [file]);
    if (rows.length) continue;
    const sql = await fs.readFile(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`[migrate] applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[migrate] failed ${file}`, err);
      process.exitCode = 1;
      break;
    } finally {
      client.release();
    }
  }

  await pool.end();
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
