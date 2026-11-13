# API Flow — Program Management (M4.1)

Module: `server/src/modules/programs/` · FR-M1-02
Base: `/api/programs` · Auth: Bearer access token · Roles: `provider` (own programs), `admin`

Lifecycle: `draft → open ⇄ paused → closed` — status changes **only** via the transition endpoints, never via PATCH.

---

## 1. Create program (draft)

```http
POST /api/programs
Authorization: Bearer <token>
Content-Type: application/json
```

| Field | Type | Required | Rules | Example |
|---|---|---|---|---|
| `title` | string | **yes** | 3–200 chars | `"Merit Scholarship 2026"` |
| `description` | string | no | ≤5000, default `""` | `"For high-CGPA students…"` |
| `criteria` | object | no | default `{}` — see below | |
| `total_fund` | number | no | ≥0, default `0` (BDT) | `500000` |
| `amount_per_student` | number | no | ≥0, default `0` | `5000` |
| `seats` | int | no | ≥0, default `0` | `25` |
| `required_docs` | string[] | no | default `[]` | `["ssc_cert","nid"]` |
| `deadline` | ISO datetime | no | nullable | `"2026-12-31T23:59:59Z"` |
| `location_district` | string | no | nullable | `"Cumilla"` |
| `education_level` | string | no | nullable | `"hsc"` |

`criteria` (all optional): `min_cgpa` (0–4), `max_household_income`, `districts: string[]`, `education_levels: string[]`.

**201** → `{ "program": { … } }`
**400** `VALIDATION_ERROR` · **401** · **403** (student)

---

## 2. List programs

```http
GET /api/programs?status=open&mine=true&page=1&limit=20
```

| Query | Type | Notes |
|---|---|---|
| `status` | `draft\|open\|paused\|closed` | optional filter |
| `mine` | boolean | `true` → only own (provider) / applied (student) |
| `page` / `limit` | int | default 1 / 20, limit ≤100 |

**200** → `{ "programs": [...], "total": n, "page": …, "limit": … }`

Visibility: `admin` = all; `provider` = own (or `mine`); `student` = non-draft only.

---

## 3. Get program

```http
GET /api/programs/:id
```

**200** → `{ "program": {...} }` · **403** `FORBIDDEN` if not visible to caller.

---

## 4. Update (draft only)

```http
PATCH /api/programs/:id
Content-Type: application/json
```

Body: same fields as create — **all optional** (partial). `status` is rejected if present (`z.never()`).

| Case | Status | `code` |
|---|---|---|
| Not draft | 409 | `NOT_DRAFT` (only drafts editable) |
| Not found | 404 | `PROGRAM_NOT_FOUND` |
| Not owner | 403 | `FORBIDDEN` |

---

## 5. Lifecycle transitions

```http
POST /api/programs/:id/publish     // draft → open
POST /api/programs/:id/pause       // open  → paused
POST /api/programs/:id/resume      // paused → open
POST /api/programs/:id/close       // open|paused → closed
```

No body. **200** → `{ "program": {...}, "transitioned": "publish" }`

**Publish preconditions** (else 409 `PUBLISH_BLOCKED` with `details.reason`):
- `seats > 0`
- `amount_per_student > 0`
- `deadline` set and in the future

| Illegal transition | Status | `code` |
|---|---|---|
| Wrong source state | 409 | `INVALID_TRANSITION` |
| Not owner | 403 | `FORBIDDEN` |

**Server-side notes**
- Editing is locked outside `draft`; status only moves through these four endpoints.
- Auto-close on deadline/fund exhaustion (cron) — **not yet built**; close manually until then.

---

## Example flow

```bash
# create → publish → pause → resume → close
POST /api/programs            { "title": "Test", "seats": 5, "amount_per_student": 5000, "deadline": "2026-12-31T23:59:59Z" }
POST /api/programs/1/publish
POST /api/programs/1/pause
POST /api/programs/1/resume
POST /api/programs/1/close
```
