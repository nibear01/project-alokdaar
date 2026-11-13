import { query } from '../../config/db.js';

const PUBLIC_USER_COLS = `
  id, role, name, email, phone, locale,
  email_verified, created_at, updated_at
`;

export async function findUserByEmail(email) {
  const { rows } = await query(
    `SELECT ${PUBLIC_USER_COLS}, password_hash, otp_hash, otp_expires_at, otp_attempts
     FROM users WHERE email = $1`,
    [email],
  );
  return rows[0] || null;
}

export async function findUserById(id) {
  const { rows } = await query(
    `SELECT ${PUBLIC_USER_COLS} FROM users WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

/**
 * Insert user. Unique-constraint violation (email) is rethrown as a
 * friendly error — pre-check in service handles the common race, this
 * is the safety net.
 */
export async function insertUser({ name, email, passwordHash, role, phone, locale }) {
  try {
    const { rows } = await query(
      `INSERT INTO users (role, name, email, phone, password_hash, locale)
       VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6)
       RETURNING ${PUBLIC_USER_COLS}`,
      [role, name, email, phone || null, passwordHash, locale || 'en'],
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') {
      const e = new Error('Email already registered');
      e.status = 409;
      e.code = 'EMAIL_TAKEN';
      throw e;
    }
    throw err;
  }
}

export async function setOtp(userId, otpHash, expiresAt) {
  await query(
    `UPDATE users
     SET otp_hash = $2, otp_expires_at = $3, otp_attempts = 0, updated_at = now()
     WHERE id = $1`,
    [userId, otpHash, expiresAt],
  );
}

export async function incrementOtpAttempts(userId) {
  await query(
    `UPDATE users SET otp_attempts = otp_attempts + 1, updated_at = now() WHERE id = $1`,
    [userId],
  );
}

export async function clearOtpAndMarkVerified(userId) {
  await query(
    `UPDATE users
     SET otp_hash = NULL, otp_expires_at = NULL, otp_attempts = 0,
         email_verified = TRUE, updated_at = now()
     WHERE id = $1`,
    [userId],
  );
}

export async function clearOtp(userId) {
  await query(
    `UPDATE users
     SET otp_hash = NULL, otp_expires_at = NULL, otp_attempts = 0, updated_at = now()
     WHERE id = $1`,
    [userId],
  );
}

// --- sessions ---

export async function createSession({ id, userId, refreshTokenHash, userAgent, ip }) {
  const { rows } = await query(
    `INSERT INTO auth_sessions (id, user_id, refresh_token_hash, user_agent, ip)
     VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5::inet)
     RETURNING id, created_at`,
    [id || null, userId, refreshTokenHash, userAgent || null, ip || null],
  );
  return rows[0];
}

export async function findSessionById(sessionId) {
  const { rows } = await query(
    `SELECT id, user_id, refresh_token_hash, revoked_at, created_at, last_used_at, user_agent, ip
     FROM auth_sessions WHERE id = $1`,
    [sessionId],
  );
  return rows[0] || null;
}

export async function touchSession(sessionId, refreshTokenHash) {
  await query(
    `UPDATE auth_sessions
     SET refresh_token_hash = $2, last_used_at = now()
     WHERE id = $1`,
    [sessionId, refreshTokenHash],
  );
}

export async function revokeSession(sessionId) {
  await query(
    `UPDATE auth_sessions SET revoked_at = now()
     WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId],
  );
}

export async function revokeAllUserSessions(userId) {
  const { rowCount } = await query(
    `UPDATE auth_sessions SET revoked_at = now()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
  return rowCount;
}

export async function listActiveSessions(userId) {
  const { rows } = await query(
    `SELECT id, user_agent, ip, created_at, last_used_at
     FROM auth_sessions
     WHERE user_id = $1 AND revoked_at IS NULL
     ORDER BY last_used_at DESC`,
    [userId],
  );
  return rows;
}
