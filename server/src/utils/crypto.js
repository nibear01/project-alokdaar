import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const BCRYPT_ROUNDS = 12;

export async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password, hash) {
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}

/** OTP is short-lived — fast hash with server pepper is enough. */
export function hashOtp(otp) {
  const pepper = process.env.JWT_SECRET || 'dev-pepper';
  return crypto.createHash('sha256').update(`${otp}:${pepper}`).digest('hex');
}

export function generateOtp() {
  // 6-digit numeric OTP
  return crypto.randomInt(100000, 1000000).toString();
}

/** Refresh tokens are opaque random strings; only the hash is stored. */
export function generateRefreshToken() {
  return crypto.randomBytes(48).toString('base64url');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
