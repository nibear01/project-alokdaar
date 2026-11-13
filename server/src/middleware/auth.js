import { verifyAccessToken } from '../utils/tokens.js';

/** Attach req.user when a valid Authorization: Bearer <access> is present. */
export function authJwt(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next({
      status: 401,
      code: 'UNAUTHENTICATED',
      message: 'Missing access token',
    });
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = {
      id: Number(payload.sub),
      role: payload.role,
      name: payload.name,
    };
    next();
  } catch (err) {
    next({
      status: 401,
      code: 'INVALID_TOKEN',
      message: err.name === 'TokenExpiredError' ? 'Access token expired' : 'Invalid access token',
    });
  }
}

/** Role guard — use after authJwt. Accepts one role or a list. */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) {
      return next({ status: 401, code: 'UNAUTHENTICATED', message: 'Not authenticated' });
    }
    if (!roles.includes(req.user.role)) {
      return next({ status: 403, code: 'FORBIDDEN', message: 'Insufficient role' });
    }
    next();
  };
}
