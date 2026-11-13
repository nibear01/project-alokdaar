import jwt from 'jsonwebtoken';

function accessSecret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.includes('change-me')) {
    throw new Error('JWT_SECRET is not set to a real secret');
  }
  return s;
}

function refreshSecret() {
  const s = process.env.JWT_REFRESH_SECRET;
  if (!s || s.includes('change-me')) {
    throw new Error('JWT_REFRESH_SECRET is not set to a real secret');
  }
  return s;
}

export function signAccessToken(user) {
  return jwt.sign(
    { sub: String(user.id), role: user.role, name: user.name },
    accessSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' },
  );
}

/** Refresh JWT carries sid = session id so we can revoke per-device. */
export function signRefreshToken(userId, sessionId) {
  return jwt.sign({ sub: String(userId), sid: sessionId }, refreshSecret(), {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, accessSecret());
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, refreshSecret());
}
