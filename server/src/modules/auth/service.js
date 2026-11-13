import { randomUUID } from 'crypto';
import {
  findUserByEmail,
  findUserById,
  insertUser,
  setOtp,
  incrementOtpAttempts,
  clearOtpAndMarkVerified,
  clearOtp,
  createSession,
  findSessionById,
  touchSession,
  revokeSession,
  revokeAllUserSessions,
  listActiveSessions,
} from './repository.js';
import {
  hashPassword,
  verifyPassword,
  generateOtp,
  hashOtp,
  hashToken,
} from '../../utils/crypto.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../utils/tokens.js';
import { sendOtpEmail } from '../../services/email.js';

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

const COOKIE_NAME = 'refreshToken';

function cookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    // Vercel ↔ Render are cross-site in prod; localhost ports are same-site in dev.
    sameSite: isProd ? 'none' : 'lax',
    path: '/api/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

function publicUser(u) {
  if (!u) return null;
  const { password_hash, otp_hash, otp_expires_at, otp_attempts, ...rest } = u;
  return rest;
}

async function issueTokens(user, meta) {
  // Refresh token is a JWT carrying sid; we hash the JWT string for storage.
  // Pick the session id first so the JWT can reference it.
  const sessionId = randomUUID();
  const refreshToken = signRefreshToken(user.id, sessionId);
  await createSession({
    id: sessionId,
    userId: user.id,
    refreshTokenHash: hashToken(refreshToken),
    userAgent: meta?.userAgent,
    ip: meta?.ip,
  });

  return {
    accessToken: signAccessToken(user),
    refreshToken,
    sessionId,
    expiresInSeconds: 15 * 60,
  };
}

// --- register ---

export async function register(input, meta) {
  // Pre-check: friendly error + avoids a wasted insert on the common path.
  // DB unique constraint still guards the race.
  const existing = await findUserByEmail(input.email);
  if (existing) {
    const err = new Error('Email already registered');
    err.status = 409;
    err.code = 'EMAIL_TAKEN';
    throw err;
  }

  const passwordHash = await hashPassword(input.password);
  const user = await insertUser({
    name: input.name,
    email: input.email,
    passwordHash,
    role: input.role,
    phone: input.phone,
    locale: input.locale,
  });

  await issueOtp(user, meta);
  return { user: publicUser(user) };
}

// --- OTP ---

async function issueOtp(user, meta) {
  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  await setOtp(user.id, hashOtp(otp), expiresAt);

  const result = await sendOtpEmail({
    to: user.email,
    name: user.name,
    otp,
  });
  return result;
}

export async function verifyOtp({ email, otp }) {
  const user = await findUserByEmail(email);
  if (!user) {
    const err = new Error('No account found for this email');
    err.status = 404;
    err.code = 'USER_NOT_FOUND';
    throw err;
  }

  if (user.email_verified) {
    return { user: publicUser(user), alreadyVerified: true };
  }

  if (!user.otp_hash || !user.otp_expires_at) {
    const err = new Error('No pending verification — request a new code');
    err.status = 400;
    err.code = 'OTP_NOT_FOUND';
    throw err;
  }

  if (new Date(user.otp_expires_at) < new Date()) {
    await clearOtp(user.id);
    const err = new Error('OTP expired — request a new code');
    err.status = 400;
    err.code = 'OTP_EXPIRED';
    throw err;
  }

  if (user.otp_attempts >= MAX_OTP_ATTEMPTS) {
    await clearOtp(user.id);
    const err = new Error('Too many incorrect attempts — request a new code');
    err.status = 429;
    err.code = 'OTP_LOCKED';
    throw err;
  }

  if (hashOtp(otp) !== user.otp_hash) {
    await incrementOtpAttempts(user.id);
    const remaining = MAX_OTP_ATTEMPTS - (user.otp_attempts + 1);
    const err = new Error(
      remaining > 0 ? `Incorrect code — ${remaining} attempt(s) left` : 'Too many incorrect attempts',
    );
    err.status = 400;
    err.code = 'OTP_INVALID';
    throw err;
  }

  await clearOtpAndMarkVerified(user.id);
  const refreshed = await findUserById(user.id);
  return { user: publicUser(refreshed), alreadyVerified: false };
}

export async function resendOtp({ email }, meta) {
  const user = await findUserByEmail(email);
  // Always look the same whether or not the email exists (no enumeration).
  if (!user) return { sent: true };

  if (user.email_verified) {
    const err = new Error('Email already verified');
    err.status = 400;
    err.code = 'ALREADY_VERIFIED';
    throw err;
  }

  await issueOtp(user, meta);
  return { sent: true };
}

// --- login ---

export async function login({ email, password }, meta) {
  const user = await findUserByEmail(email);

  // Same error for unknown email vs bad password — no user enumeration.
  const invalid = () => {
    const err = new Error('Invalid email or password');
    err.status = 401;
    err.code = 'INVALID_CREDENTIALS';
    throw err;
  };

  if (!user) invalid();

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) invalid();

  if (!user.email_verified) {
    const err = new Error('Email not verified — check your inbox for the code');
    err.status = 403;
    err.code = 'EMAIL_NOT_VERIFIED';
    throw err;
  }

  const tokens = await issueTokens(user, meta);
  return {
    user: publicUser(user),
    ...tokens,
  };
}

// --- refresh (with rotation + reuse detection) ---

export async function refresh(rawToken, meta) {
  if (!rawToken) {
    const err = new Error('Missing refresh token');
    err.status = 401;
    err.code = 'MISSING_REFRESH_TOKEN';
    throw err;
  }

  let payload;
  try {
    payload = verifyRefreshToken(rawToken);
  } catch {
    const err = new Error('Invalid or expired refresh token');
    err.status = 401;
    err.code = 'INVALID_REFRESH_TOKEN';
    throw err;
  }

  const session = await findSessionById(payload.sid);
  if (!session) {
    const err = new Error('Session not found');
    err.status = 401;
    err.code = 'INVALID_REFRESH_TOKEN';
    throw err;
  }

  // Reuse detection: an already-revoked session means the token was
  // stolen/leaked after logout or rotation — kill every session.
  if (session.revoked_at) {
    await revokeAllUserSessions(session.user_id);
    const err = new Error('Session revoked — please sign in again');
    err.status = 401;
    err.code = 'SESSION_REVOKED';
    throw err;
  }

  // Hash must match the current session hash (rotation invalidates old ones).
  if (session.refresh_token_hash !== hashToken(rawToken)) {
    await revokeSession(session.id);
    await revokeAllUserSessions(session.user_id);
    const err = new Error('Refresh token reuse detected — all sessions revoked');
    err.status = 401;
    err.code = 'TOKEN_REUSE';
    throw err;
  }

  const user = await findUserById(session.user_id);
  if (!user) {
    await revokeSession(session.id);
    const err = new Error('User no longer exists');
    err.status = 401;
    err.code = 'INVALID_REFRESH_TOKEN';
    throw err;
  }

  // Rotate: new refresh JWT, same session row.
  const newRefreshToken = signRefreshToken(session.user_id, session.id);
  await touchSession(session.id, hashToken(newRefreshToken));

  return {
    accessToken: signAccessToken(user),
    refreshToken: newRefreshToken,
    sessionId: session.id,
    user: publicUser(user),
    expiresInSeconds: 15 * 60,
  };
}

// --- logout ---

export async function logout(rawToken) {
  if (!rawToken) return { revoked: 0 };

  try {
    const payload = verifyRefreshToken(rawToken);
    await revokeSession(payload.sid);
  } catch {
    // Already invalid — treat as success so logout is idempotent.
  }
  return { revoked: 1 };
}

export async function logoutAll(userId) {
  const revoked = await revokeAllUserSessions(userId);
  return { revoked };
}

// --- helpers for routes ---

export function setRefreshCookie(res, token) {
  res.cookie(COOKIE_NAME, token, cookieOptions());
}

export function clearRefreshCookie(res) {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
}

export function getRefreshCookie(req) {
  return req.cookies?.[COOKIE_NAME];
}

export async function getMe(userId) {
  const user = await findUserById(userId);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    err.code = 'USER_NOT_FOUND';
    throw err;
  }
  return { user };
}

export async function getSessions(userId) {
  const sessions = await listActiveSessions(userId);
  return { sessions };
}
