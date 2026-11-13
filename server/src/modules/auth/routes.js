import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authJwt } from '../../middleware/auth.js';
import {
  registerSchema,
  verifyOtpSchema,
  resendOtpSchema,
  loginSchema,
  validate,
} from './schemas.js';
import * as authService from './service.js';

const router = Router();

// Tight limits on auth endpoints (per-IP).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, try again later', code: 'RATE_LIMITED' },
});

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many OTP requests, try again later', code: 'RATE_LIMITED' },
});

function requestMeta(req) {
  return {
    userAgent: req.headers['user-agent'] || null,
    ip: req.ip || null,
  };
}

function handle(serviceFn) {
  return async (req, res, next) => {
    try {
      await serviceFn(req, res);
    } catch (err) {
      next(err);
    }
  };
}

/**
 * POST /api/auth/register
 * Body: { name, email, password, role: student|provider, phone?, locale? }
 * Admin cannot self-register.
 */
router.post(
  '/register',
  authLimiter,
  handle(async (req, res) => {
    const data = validate(registerSchema, req.body);
    const result = await authService.register(data, requestMeta(req));
    res.status(201).json({
      message: 'Registered — check your email for the verification code',
      ...result,
    });
  }),
);

/** POST /api/auth/verify-otp — { email, otp } */
router.post(
  '/verify-otp',
  authLimiter,
  handle(async (req, res) => {
    const data = validate(verifyOtpSchema, req.body);
    const result = await authService.verifyOtp(data);
    res.json({
      message: result.alreadyVerified ? 'Email already verified' : 'Email verified',
      ...result,
    });
  }),
);

/** POST /api/auth/resend-otp — { email } */
router.post(
  '/resend-otp',
  otpLimiter,
  handle(async (req, res) => {
    const data = validate(resendOtpSchema, req.body);
    const result = await authService.resendOtp(data, requestMeta(req));
    res.json({ message: 'If an unverified account exists, a code was sent', ...result });
  }),
);

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Sets refresh token httpOnly cookie; returns access token + user.
 */
router.post(
  '/login',
  authLimiter,
  handle(async (req, res) => {
    const data = validate(loginSchema, req.body);
    const { user, accessToken, refreshToken, expiresInSeconds } = await authService.login(
      data,
      requestMeta(req),
    );
    authService.setRefreshCookie(res, refreshToken);
    res.json({ user, accessToken, expiresInSeconds });
  }),
);

/** GET /api/auth/me — requires Bearer access token */
router.get(
  '/me',
  authJwt,
  handle(async (req, res) => {
    const result = await authService.getMe(req.user.id);
    res.json(result);
  }),
);

/**
 * POST /api/auth/refresh
 * Reads refresh token from httpOnly cookie, rotates it, returns new access token.
 */
router.post(
  '/refresh',
  handle(async (req, res) => {
    const raw = authService.getRefreshCookie(req);
    const { accessToken, refreshToken, user, expiresInSeconds } = await authService.refresh(
      raw,
      requestMeta(req),
    );
    authService.setRefreshCookie(res, refreshToken);
    res.json({ accessToken, user, expiresInSeconds });
  }),
);

/** POST /api/auth/logout — revokes current session, clears cookie */
router.post(
  '/logout',
  handle(async (req, res) => {
    const raw = authService.getRefreshCookie(req);
    await authService.logout(raw);
    authService.clearRefreshCookie(res);
    res.json({ message: 'Signed out' });
  }),
);

/** POST /api/auth/logout-all — revokes every session for this user */
router.post(
  '/logout-all',
  authJwt,
  handle(async (req, res) => {
    const result = await authService.logoutAll(req.user.id);
    authService.clearRefreshCookie(res);
    res.json({ message: 'Signed out on all devices', ...result });
  }),
);

/** GET /api/auth/sessions — list active sessions (devices) */
router.get(
  '/sessions',
  authJwt,
  handle(async (req, res) => {
    const result = await authService.getSessions(req.user.id);
    res.json(result);
  }),
);

export default router;
