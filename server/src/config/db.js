import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/.env — load explicitly so cwd does not matter
dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === 'production' ||
    (process.env.DATABASE_URL || '').includes('neon.tech')
      ? { rejectUnauthorized: false }
      : false,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  console.error('[db] unexpected pool error', err);
});

export async function query(text, params) {
  return pool.query(text, params);
}

export async function getClient() {
  return pool.connect();
}
