# API Flow — Review Queue & Applicant Detail (M4.2 + M4.4)

Modules: `server/src/modules/applications/` (queue mounted on programs routes) · FR-RS-01, FR-RS-03
Roles: queue = `provider` (own program) / `admin`; detail = those **or** the applicant student (own row only).

---

## 1. Review queue

```http
GET /api/programs/:id/applications
Authorization: Bearer <token>
```

| Query | Type | Default | Notes |
|---|---|---|---|
| `status` | `submitted\|under_review\|shortlisted\|approved\|waitlisted\|rejected\|withdrawn` | — | exact match |
| `search` | string ≤120 | — | matches student name / email (ILIKE) |
| `duplicate` | `true`\|`false` | — | filter by `duplicate_aid` flag |
| `sort` | `rank`\|`score`\|`submitted_at` | `rank` | rank ASC; score/submitted DESC |
| `page` | int ≥1 | `1` | |
| `limit` | int 1–100 | `25` | |

**200**
```json
{
  "total": 3,
  "page": 1,
  "limit": 25,
  "applications": [
    {
      "application_id": 1,
      "status": "submitted",
      "rank": 1,
      "score": 68.4,
      "duplicate_aid": false,
      "submitted_at": "2026-11-13T…",
      "student": { "id": "1", "name": "Test Student", "email": "test.student@example.com" },
      "breakdown": {
        "total": 68.4,
        "merit": { "raw": 95, "weight": 50, "points": 47.5 },
        "need":  { "raw": 60, "weight": 30, "points": 18.0 },
        "attendance": { "raw": 92, "weight": 20, "points": 18.4 }
      }
    }
  ]
}
```

| Case | Status | `code` |
|---|---|---|
| Bad filter | 400 | `VALIDATION_ERROR` |
| Not owner / student role | 403 | `FORBIDDEN` (`Not your program` / `Insufficient role`) |
| Program missing | 404 | `PROGRAM_NOT_FOUND` |

---

## 2. Applicant detail (FR-RS-03)

```http
GET /api/applications/:id
```

**200** — one payload with everything the detail screen needs:

```json
{
  "application": { "id": 1, "status": "shortlisted", "rank": 1, "score": 68.4,
                   "statement": "…", "submitted_at": "…", "decided_at": null },
  "student": { "id": "4", "name": "Rafi Auntik", "email": "rafi3@example.com", "phone": "…" },
  "program": { "id": 3, "title": "Ranking Test Program", "amount_per_student": 5000, "seats": 3 },
  "academic_trend": [
    { "term": "2026-spring", "cgpa": 3.80, "attendance": 92, "completed_credits": 45 }
  ],
  "household": { "family_size": 4, "earning_members": 1, "monthly_income": 12000, "district": "…" },
  "timeline": [
    { "from_status": "submitted", "to_status": "shortlisted",
      "actor_role": "provider", "actor_name": "Naved Provider",
      "note": null, "created_at": "…" }
  ],
  "score_explanation": {
    "total": 68.4,
    "weights": { "merit": 50, "need": 30, "attendance": 20 },
    "parts": { "merit": { "raw": 95, "weight": 50, "points": 47.5 }, "…": "…" }
  }
}
```

`academic_trend` comes from the `latest_academic` view (one row per term); `timeline` from `application_events` (FR-DA-06 audit).

| Case | Status | `code` |
|---|---|---|
| Not found | 404 | `APPLICATION_NOT_FOUND` |
| Student viewing someone else's | 403 | `FORBIDDEN` |
| Other provider | 403 | `FORBIDDEN` |

**Access rule:** `provider` must own the program · `admin` any · `student` only own application.

---

## 3. Bulk shortlist / reject (FR-RS-01)

```http
POST /api/programs/:id/bulk-decide
Content-Type: application/json

{
  "application_ids": [3, 4, 5],
  "decision": "reject",            // shortlist | reject only
  "remarks": "CGPA below threshold" // required when decision=reject (≥3 chars)
}
```

**200** — partial success is reported, not rolled back per-item:

```json
{
  "decision": "reject",
  "updated": [ { "id": 4, "status": "rejected", "...": "..." } ],
  "skipped": [
    { "id": 999999, "reason": "NOT_IN_PROGRAM" },
    { "id": 2, "reason": "INVALID_TRANSITION", "message": "Cannot reject …" }
  ],
  "counts": { "updated": 1, "skipped": 2 }
}
```

| Case | Status | `code` |
|---|---|---|
| Missing remarks on reject | 400 | `VALIDATION_ERROR` |
| Empty/too many ids | 400 | `VALIDATION_ERROR` (1–100) |
| Not owner | 403 | `FORBIDDEN` |

**Server-side notes**
- One DB transaction for the whole batch; each id validates its own transition (see `decisions.md`), failures land in `skipped`.
- Every applied change writes an `application_events` row (actor = caller).

See also: `decisions.md` (single decisions, withdraw, waitlist), `interviews.md`.
