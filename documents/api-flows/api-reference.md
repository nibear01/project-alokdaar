# API Reference — All Endpoints (so far)

Base URL: `http://localhost:4000`  
Content type: `application/json` (except where noted)

**Auth summary**

| Token | Where | Lifetime |
|---|---|---|
| Access token | Header `Authorization: Bearer <accessToken>` | 15 min |
| Refresh token | Cookie `refreshToken` (httpOnly, auto-sent) | 7 days |

**Error shape** (all non-2xx):
```json
{ "error": "message", "code": "ERROR_CODE", "details": { "field": ["msg"] } }
```
`details` only present on `VALIDATION_ERROR`.

---

## 1. Health

```http
GET /api/health
```
No auth. No body.

**200**
```json
{ "ok": true, "db": "up", "service": "Alokdaar" }
```
**503** if DB down: `{ "ok": false, "db": "down", "error": "..." }`

---

## 2. API index

```http
GET /api
```
No auth. Lists available endpoints.

---

## 3. Register

```http
POST /api/auth/register
Content-Type: application/json
```

### Body fields

| Field | Type | Required | Rules | Example |
|---|---|---|---|---|
| `name` | string | **yes** | 2–120 chars, trimmed | `"Naved Abrar Nibir"` |
| `email` | string | **yes** | valid email, lowercased, unique | `"naved@example.com"` |
| `password` | string | **yes** | 8–128 chars | `"SecurePass123!"` |
| `role` | string | **yes** | only `student` or `provider` (not `admin`) | `"student"` |
| `phone` | string | no | 7–20 chars, digits/`+`/`-`/`()` | `"+8801712345678"` |
| `locale` | string | no | `en` \| `bn`, default `en` | `"en"` |

### Example body
```json
{
  "name": "Naved Abrar Nibir",
  "email": "naved@example.com",
  "password": "SecurePass123!",
  "role": "student",
  "phone": "+8801712345678",
  "locale": "en"
}
```

### Responses

| Status | `code` | When |
|---|---|---|
| **201** | — | Registered; OTP emailed (or logged in dev) |
| 400 | `VALIDATION_ERROR` | Missing/invalid field — see `details` |
| 409 | `EMAIL_TAKEN` | Email already registered |
| 429 | `RATE_LIMITED` | >30 requests / 15 min / IP |

**201 body**
```json
{
  "message": "Registered — check your email for the verification code",
  "user": {
    "id": "7",
    "role": "student",
    "name": "Naved Abrar Nibir",
    "email": "naved@example.com",
    "phone": "+8801712345678",
    "locale": "en",
    "email_verified": false,
    "created_at": "2026-11-13T09:00:00.000Z",
    "updated_at": "2026-11-13T09:00:00.000Z"
  }
}
```

---

## 4. Verify OTP

```http
POST /api/auth/verify-otp
Content-Type: application/json
```

### Body fields

| Field | Type | Required | Rules | Example |
|---|---|---|---|---|
| `email` | string | **yes** | the registered email | `"naved@example.com"` |
| `otp` | string | **yes** | exactly 6 digits | `"633410"` |

### Example body
```json
{ "email": "naved@example.com", "otp": "633410" }
```

### Responses

| Status | `code` | When |
|---|---|---|
| **200** | — | Verified (`alreadyVerified: true` if already done) |
| 400 | `VALIDATION_ERROR` | Bad email/OTP format |
| 400 | `OTP_NOT_FOUND` | No pending OTP — request resend |
| 400 | `OTP_EXPIRED` | Older than 10 minutes |
| 400 | `OTP_INVALID` | Wrong code (5 attempts max) |
| 404 | `USER_NOT_FOUND` | Email not registered |
| 429 | `OTP_LOCKED` | Too many wrong attempts |
| 429 | `RATE_LIMITED` | >30 / 15 min / IP |

**200 body**
```json
{
  "message": "Email verified",
  "alreadyVerified": false,
  "user": { "id": "7", "email": "naved@example.com", "email_verified": true, ... }
}
```

---

## 5. Resend OTP

```http
POST /api/auth/resend-otp
Content-Type: application/json
```

### Body fields

| Field | Type | Required | Example |
|---|---|---|---|
| `email` | string | **yes** | `"naved@example.com"` |

### Example body
```json
{ "email": "naved@example.com" }
```

### Responses

| Status | `code` | When |
|---|---|---|
| **200** | — | Always (even if email unknown — no enumeration) |
| 400 | `ALREADY_VERIFIED` | Account already verified |
| 400 | `VALIDATION_ERROR` | Bad email |
| 429 | `RATE_LIMITED` | >10 / 15 min / IP |

**200 body**
```json
{ "message": "If an unverified account exists, a code was sent", "sent": true }
```

---

## 6. Login

```http
POST /api/auth/login
Content-Type: application/json
```

### Body fields

| Field | Type | Required | Example |
|---|---|---|---|
| `email` | string | **yes** | `"naved@example.com"` |
| `password` | string | **yes** | `"SecurePass123!"` |

### Example body
```json
{ "email": "naved@example.com", "password": "SecurePass123!" }
```

### Responses

| Status | `code` | When |
|---|---|---|
| **200** | — | Success — sets `refreshToken` cookie |
| 400 | `VALIDATION_ERROR` | Missing fields |
| 401 | `INVALID_CREDENTIALS` | Wrong email or password |
| 403 | `EMAIL_NOT_VERIFIED` | Need OTP verification first |
| 429 | `RATE_LIMITED` | >30 / 15 min / IP |

**200 body**
```json
{
  "user": {
    "id": "7",
    "role": "student",
    "name": "Naved Abrar Nibir",
    "email": "naved@example.com",
    "phone": "+8801712345678",
    "locale": "en",
    "email_verified": true,
    "created_at": "...",
    "updated_at": "..."
  },
  "accessToken": "eyJhbGciOi...",
  "expiresInSeconds": 900
}
```

**Set-Cookie (response header)**
```
refreshToken=<jwt>; Max-Age=604800; Path=/api/auth; HttpOnly; SameSite=Lax
```
Postman: use **Cookies** tab (or let it auto-save) so `/refresh` and `/logout` send it.

---

## 7. Get current user

```http
GET /api/auth/me
Authorization: Bearer <accessToken>
```

No body.

### Responses

| Status | `code` |
|---|---|
| **200** | — |
| 401 | `UNAUTHENTICATED` (no/missing token) |
| 401 | `INVALID_TOKEN` (bad or expired) |

**200 body**
```json
{
  "user": {
    "id": "7",
    "role": "student",
    "name": "Naved Abrar Nibir",
    "email": "naved@example.com",
    "phone": "+8801712345678",
    "locale": "en",
    "email_verified": true,
    "created_at": "...",
    "updated_at": "..."
  }
}
```

---

## 8. Refresh access token

```http
POST /api/auth/refresh
```

No body. Uses **cookie** `refreshToken` (sent automatically if cookie jar enabled).

### Responses

| Status | `code` | When |
|---|---|---|
| **200** | — | New access token + rotated refresh cookie |
| 401 | `MISSING_REFRESH_TOKEN` | No cookie |
| 401 | `INVALID_REFRESH_TOKEN` | Bad/expired JWT or unknown session |
| 401 | `SESSION_REVOKED` | Logged out — sign in again |
| 401 | `TOKEN_REUSE` | Old token replayed — **all** sessions revoked |

**200 body**
```json
{
  "accessToken": "eyJhbGciOi... (new)",
  "user": { "id": "7", "email": "naved@example.com", "role": "student", ... },
  "expiresInSeconds": 900
}
```
Also sets a **new** `refreshToken` cookie (rotation).

---

## 9. Logout (current device)

```http
POST /api/auth/logout
```

No body. Uses `refreshToken` cookie if present. Always **200** (idempotent).

**200 body**
```json
{ "message": "Signed out" }
```
Clears the refresh cookie.

---

## 10. Logout all devices

```http
POST /api/auth/logout-all
Authorization: Bearer <accessToken>
```

No body.

### Responses

| Status | `code` |
|---|---|
| **200** | — |
| 401 | `UNAUTHENTICATED` / `INVALID_TOKEN` |

**200 body**
```json
{ "message": "Signed out on all devices", "revoked": 3 }
```

---

## 11. List active sessions

```http
GET /api/auth/sessions
Authorization: Bearer <accessToken>
```

No body.

### Responses

| Status | `code` |
|---|---|
| **200** | — |
| 401 | `UNAUTHENTICATED` / `INVALID_TOKEN` |

**200 body**
```json
{
  "sessions": [
    {
      "id": "3f2a…-uuid",
      "user_agent": "PostmanRuntime/7.x",
      "ip": "127.0.0.1",
      "created_at": "2026-11-13T09:00:00.000Z",
      "last_used_at": "2026-11-13T09:05:00.000Z"
    }
  ]
}
```
Only non-revoked sessions. Newest first.

---

## Happy-path order (for Postman)

1. `POST /api/auth/register` → 201  
2. Grab OTP (dev: server console / `server/dev-server.log`; prod: email)  
3. `POST /api/auth/verify-otp` → 200  
4. `POST /api/auth/login` → 200 → save `accessToken`, keep cookies  
5. `GET /api/auth/me` → 200 (Bearer)  
6. `POST /api/auth/refresh` → 200 (cookie) → new access token  
7. `GET /api/auth/sessions` → 200 (Bearer)  
8. `POST /api/auth/logout` → 200 (cookie)  
   — or `POST /api/auth/logout-all` → 200 (Bearer)

## Postman setup

1. **Base URL:** `http://localhost:4000`  
2. **Auth header** (where required):  
   - Type: `Bearer Token`  
   - Token: paste `accessToken` from login/refresh response  
3. **Cookies:** Postman → Cookies → add `refreshToken` for `localhost` (or use the same session/`cookie jar` for the folder). Path: `/api/auth`.  
4. **Body → raw → JSON** for all POST bodies above.  
5. Register/login/verify are **rate-limited** (30/15 min/IP) — don't spam the Send button.

## Error codes quick list

| `code` | Meaning |
|---|---|
| `VALIDATION_ERROR` | Bad request body (see `details`) |
| `EMAIL_TAKEN` | Register with existing email |
| `INVALID_CREDENTIALS` | Wrong email/password |
| `EMAIL_NOT_VERIFIED` | Login before OTP verify |
| `USER_NOT_FOUND` | OTP verify for unknown email |
| `OTP_INVALID` / `OTP_EXPIRED` / `OTP_NOT_FOUND` / `OTP_LOCKED` | OTP problems |
| `ALREADY_VERIFIED` | Resend on verified account |
| `UNAUTHENTICATED` / `INVALID_TOKEN` | Access token missing/bad |
| `MISSING_REFRESH_TOKEN` / `INVALID_REFRESH_TOKEN` / `SESSION_REVOKED` / `TOKEN_REUSE` | Refresh problems |
| `RATE_LIMITED` / `OTP_LOCKED` | Too many requests/attempts |
| `NOT_FOUND` | Unknown route |
| `INTERNAL` | Server error |
