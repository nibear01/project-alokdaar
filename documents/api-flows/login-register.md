# API Flow — Login & Register

Auth module: `server/src/modules/auth/`. Base URL: `/api/auth`.

| Token | Lifetime | Where |
|---|---|---|
| Access (JWT) | 15 min | `Authorization: Bearer <token>` header |
| Refresh (JWT) | 7 days | `refreshToken` httpOnly cookie (`Path=/api/auth`) |

Roles: `student` · `provider` · `admin` (admin cannot self-register).

---

## 1. Register

```http
POST /api/auth/register
Content-Type: application/json

{
  "name": "Naved Abrar Nibir",
  "email": "naved@example.com",
  "password": "SecurePass123!",
  "role": "student",
  "phone": "+8801712345678",   // optional
  "locale": "en"                 // optional: en | bn
}
```

**201**
```json
{
  "message": "Registered — check your email for the verification code",
  "user": {
    "id": "5",
    "role": "student",
    "name": "Naved Abrar Nibir",
    "email": "naved@example.com",
    "email_verified": false,
    ...
  }
}
```

| Case | Status | `code` |
|---|---|---|
| Validation failed | 400 | `VALIDATION_ERROR` (with `details`) |
| Email already taken | 409 | `EMAIL_TAKEN` |
| Rate limited (30 / 15 min / IP) | 429 | `RATE_LIMITED` |

**What happens server-side**
1. Pre-check email (friendly 409) — DB unique constraint is the race-condition backstop.
2. Hash password (bcrypt, cost 12) → insert user (`email_verified = false`).
3. Generate 6-digit OTP → store **SHA-256 hash** + 10 min expiry.
4. Email OTP via SendGrid; if `SENDGRID_API_KEY` empty (dev), OTP is logged to console.

---

## 2. Verify OTP

```http
POST /api/auth/verify-otp
Content-Type: application/json

{ "email": "naved@example.com", "otp": "633410" }
```

**200**
```json
{ "message": "Email verified", "user": { "email_verified": true, ... } }
```

| Case | Status | `code` |
|---|---|---|
| Wrong code (max 5 tries) | 400 | `OTP_INVALID` (remaining attempts in message) |
| Expired (>10 min) | 400 | `OTP_EXPIRED` |
| Too many attempts | 429 | `OTP_LOCKED` |
| No pending OTP | 400 | `OTP_NOT_FOUND` |

OTP is single-use — cleared after success.

### Resend

```http
POST /api/auth/resend-otp
Content-Type: application/json

{ "email": "naved@example.com" }
```

Always returns `200 { "sent": true }` whether or not the account exists (no enumeration). Rate limit: 10 / 15 min / IP.

---

## 3. Login

```http
POST /api/auth/login
Content-Type: application/json

{ "email": "naved@example.com", "password": "SecurePass123!" }
```

**200**
```json
{
  "user": { "id": "5", "email": "naved@example.com", "role": "student", ... },
  "accessToken": "<jwt>",
  "expiresInSeconds": 900
}
```

Sets cookie:
```
Set-Cookie: refreshToken=<jwt>; HttpOnly; Path=/api/auth; SameSite=Lax; Max-Age=604800
# production also: Secure; SameSite=None
```

| Case | Status | `code` |
|---|---|---|
| Wrong email or password | 401 | `INVALID_CREDENTIALS` (same message both) |
| Email not verified | 403 | `EMAIL_NOT_VERIFIED` |
| Rate limited | 429 | `RATE_LIMITED` |

**What happens server-side**
1. Lookup by email → bcrypt compare (constant-style failure for unknown email).
2. Require `email_verified`.
3. Create session row: random UUID, hash of refresh JWT, user-agent, IP.
4. Sign access JWT + refresh JWT (refresh carries `sid` claim).

---

## 4. Use access token

```http
GET /api/auth/me
Authorization: Bearer <accessToken>
```

```json
{ "user": { "id": "5", "email": "naved@example.com", "role": "student", ... } }
```

| Case | Status | `code` |
|---|---|---|
| Missing/invalid token | 401 | `UNAUTHENTICATED` / `INVALID_TOKEN` |
| Expired access token | 401 | `INVALID_TOKEN` ("Access token expired") |

→ Call **refresh** (below) to get a new access token.

---

## 5. Refresh (automatic)

```http
POST /api/auth/refresh
# cookie sent automatically: refreshToken=...
```

**200**
```json
{ "accessToken": "<new-jwt>", "user": { ... }, "expiresInSeconds": 900 }
```

Sets a **new** refresh cookie (rotation).

| Case | Status | `code` |
|---|---|---|
| No cookie | 401 | `MISSING_REFRESH_TOKEN` |
| Invalid/expired JWT | 401 | `INVALID_REFRESH_TOKEN` |
| Session revoked (logged out) | 401 | `SESSION_REVOKED` |
| **Old token replayed after rotation** | 401 | `TOKEN_REUSE` — **all** sessions revoked |

**Rotation + reuse detection**
1. Verify refresh JWT → read `sid`.
2. Load session; if revoked → `SESSION_REVOKED`.
3. If stored hash ≠ hash(cookie) → token was already rotated/stolen → revoke **every** session for the user.
4. Otherwise: issue new refresh JWT, update session hash, return new access token.

Client pattern: on `401` from any API call → `POST /refresh` once → retry original request. On `TOKEN_REUSE` / `SESSION_REVOKED` → redirect to login.

---

## 6. Logout

### Current device

```http
POST /api/auth/logout
# refresh cookie optional
```

```json
{ "message": "Signed out" }
```

- Revokes the session row (`revoked_at = now()`).
- Clears the refresh cookie.
- Idempotent — missing/invalid token still returns 200.

### All devices

```http
POST /api/auth/logout-all
Authorization: Bearer <accessToken>
```

```json
{ "message": "Signed out on all devices", "revoked": 3 }
```

Revokes every active session for the user.

---

## 7. List sessions (devices)

```http
GET /api/auth/sessions
Authorization: Bearer <accessToken>
```

```json
{
  "sessions": [
    {
      "id": "uuid",
      "user_agent": "Mozilla/5.0 ...",
      "ip": "103.21.244.1",
      "created_at": "...",
      "last_used_at": "..."
    }
  ]
}
```

---

## Sequence (happy path)

```text
Client                         API                         DB / Email
  │                             │                             │
  │ POST /register              │                             │
  │────────────────────────────►│ check email free            │
  │                             │ hash password (bcrypt)      │
  │                             │ insert user                 │──► users
  │                             │ hash OTP, set expiry        │
  │                             │ send email                  │──► SendGrid (or console)
  │◄──── 201 + user ────────────│                             │
  │                             │                             │
  │ POST /verify-otp            │                             │
  │────────────────────────────►│ hash OTP, compare, attempts │
  │                             │ clear OTP, verified=true    │──► users
  │◄──── 200 + user ────────────│                             │
  │                             │                             │
  │ POST /login                 │                             │
  │────────────────────────────►│ bcrypt verify               │
  │                             │ create session (hash ref)   │──► auth_sessions
  │                             │ sign access + refresh JWT   │
  │◄──── 200 + access ──────────│  Set-Cookie refresh ────────│
  │                             │                             │
  │ GET /me  Bearer access      │                             │
  │────────────────────────────►│ verify access JWT           │
  │◄──── 200 + user ────────────│                             │
  │                             │                             │
  │ POST /refresh  (cookie)     │                             │
  │────────────────────────────►│ verify ref JWT → sid        │
  │                             │ hash match? rotate          │──► auth_sessions
  │◄──── 200 + new access ──────│  Set-Cookie new refresh ────│
  │                             │                             │
  │ POST /logout  (cookie)      │                             │
  │────────────────────────────►│ revoke session, clear cookie│──► auth_sessions
  │◄──── 200 ───────────────────│                             │
```

---

## Security notes

- **Passwords:** bcrypt (12 rounds) — never SHA256/MD5 in production.
- **OTP:** SHA-256 + server pepper (`JWT_SECRET`); single-use; 10 min; 5 attempts.
- **Refresh tokens:** JWT with `sid`; only the SHA-256 hash is stored in `auth_sessions`.
- **Cookie flags:** `HttpOnly` (no JS access), `Path=/api/auth` (not sent to other routes), `SameSite=Lax` (dev) / `None` + `Secure` (prod cross-site Vercel↔Render).
- **Enumeration:** login and resend-otp return the same shape whether or not the account exists.
- **Rate limits:** register/login/verify 30 per 15 min/IP; resend 10 per 15 min/IP.
- **Admin:** role rejected at register (`role` enum is student|provider only).

## Related code

| Piece | Path |
|---|---|
| Routes | `server/src/modules/auth/routes.js` |
| Business logic | `server/src/modules/auth/service.js` |
| SQL / queries | `server/src/modules/auth/repository.js` |
| Zod schemas | `server/src/modules/auth/schemas.js` |
| `authJwt` / `requireRole` | `server/src/middleware/auth.js` |
| JWT sign/verify | `server/src/utils/tokens.js` |
| Password / OTP / token hashing | `server/src/utils/crypto.js` |
| Email (SendGrid + dev console) | `server/src/services/email.js` |
| Migration | `server/src/db/migrations/002_auth.sql` |
