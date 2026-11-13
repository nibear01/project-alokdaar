/**
 * Demo/dev seed (M7.1): idempotent demo accounts so every teammate can log in
 * locally and smoke-test role-guarded flows without touching the auth API.
 * Refuses to run in production. Passwords are dev-only and documented in
 * README/API flow docs; override with SEED_PASSWORD.
 */
import { pool } from '../config/db.js';
import { hashPassword } from '../utils/crypto.js';

const PASSWORD = process.env.SEED_PASSWORD || 'Alokdaar123!dev';

const USERS = [
  { role: 'admin', name: 'Demo Admin', email: 'admin@alokdaar.local' },
  { role: 'provider', name: 'Demo Provider (Shikkha Trust)', email: 'provider@alokdaar.local' },
  { role: 'student', name: 'Demo Student (Nusrat Jahan)', email: 'student@alokdaar.local', phone: '+8801712345678' },
];

if (process.env.NODE_ENV === 'production') {
  console.error('[seed] refusing to run in production');
  process.exit(1);
}

const hash = await hashPassword(PASSWORD);
for (const u of USERS) {
  const { rows } = await pool.query(
    `INSERT INTO users (name, email, password_hash, role, phone, email_verified)
     VALUES ($1, $2, $3, $4, $5, TRUE)
     ON CONFLICT (email) DO NOTHING
     RETURNING id`,
    [u.name, u.email, hash, u.role, u.phone ?? null],
  );
  console.log(`[seed] ${u.role.padEnd(8)} ${u.email} ${rows.length ? `created (#${rows[0].id})` : 'already exists'}`);
}
console.log('[seed] password for all demo accounts: SEED_PASSWORD env (default documented in README)');
await pool.end();
