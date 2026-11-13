# API Flow — Decisions, Duplicate-Aid, Withdraw & Waitlist (M4.5 + M4.6 + M4.9)

Module: `server/src/modules/applications/` · FR-RS-04, FR-RS-05, FR-RS-08, FR-DA-05 (withdraw)
Roles: decisions = `provider` (own program) / `admin` · withdraw = owning `student` only.

## Application state machine

```
submitted ──▶ under_review ──▶ shortlisted ──▶ approved | waitlisted | rejected
     │              │                │                │            │
     └──────────────┴── rejected ◀───┘                │            │
                               withdraw (student) ────┴────────────┘──▶ withdrawn
```

Allowed transitions per decision:

| Decision | Allowed from | To |
|---|---|---|
| `shortlist` | submitted, under_review | shortlisted |
| `approve` | submitted, under_review, shortlisted, waitlisted | approved |
| `reject` | submitted, under_review, shortlisted, waitlisted | rejected |
| `waitlist` | submitted, under_review, shortlisted | waitlisted |
| `withdraw` | submitted, under_review, shortlisted, waitlisted, approved | withdrawn |

Illegal → **409** `INVALID_TRANSITION` (message lists allowed source states).

---

## 1. Pre-approve duplicate-aid check (FR-RS-04)

```http
POST /api/applications/:id/pre-approve-check
```
No body. Roles: provider/admin.

**200 — no conflict**
```json
{ "application_id": 1, "conflict": false, "existing": null,
  "seats_available": 3, "amount_per_student": "5000.00" }
```

**200 — conflict** (student holds an `approved` scholarship on another program)
```json
{ "application_id": 7, "conflict": true,
  "existing": { "application_id": 1, "program_id": 3,
                "program_title": "Ranking Test Program",
                "amount_per_student": "5000.00", "decided_at": "…" },
  "seats_available": 2, "amount_per_student": 5000 }
```

| Case | Status | `code` |
|---|---|---|
| Not found | 404 | `APPLICATION_NOT_FOUND` |
| Not owner | 403 | `FORBIDDEN` |

Frontend uses this for the conflict modal; approve without `force_reason` will fail anyway (live re-check).

---

## 2. Decide one application (FR-RS-05)

```http
POST /api/applications/:id/decide
Content-Type: application/json

{
  "decision": "approve",          // shortlist | approve | reject | waitlist
  "remarks": "…",                 // REQUIRED for reject (≥3 chars)
  "message": "Welcome aboard",    // approve: shown to student
  "force_reason": "…",            // approve: required if duplicate-aid conflict
  "position": 2,                  // waitlist: explicit position (default = next)
  "committed_amount": 5000        // approve: optional override, default amount_per_student
}
```

**200**
```json
{
  "application": { "id": 8, "status": "approved", "decided_at": "…", "decision_remarks": "…" },
  "seats_available": 0,
  "waitlist_position": null,
  "duplicate_aid_override": null
}
```

| Case | Status | `code` | Notes |
|---|---|---|---|
| Reject w/o remarks | 400 | `VALIDATION_ERROR` | `details.remarks` |
| Illegal transition | 409 | `INVALID_TRANSITION` | |
| Duplicate aid, no force | 409 | `DUPLICATE_AID` | `details.existing` = conflict record |
| No seats left on approve | 409 | `SEATS_EXHAUSTED` | use waitlist instead |
| Not owner / student | 403 | `FORBIDDEN` | |

**Server-side (single transaction)**
1. Transition validation → 2. (approve) live duplicate-aid query + seat decrement + waitlist cleanup → 3. (waitlist) insert/shift position (unique per program) → 4. UPDATE application → 5. INSERT `application_events` (from/to/actor/note).

`waitlist_position` returned only for `waitlist`; `seats_available` reflects post-decision count.

---

## 3. Bulk shortlist/reject

See `review-queue.md` §3 (`POST /api/programs/:id/bulk-decide`).

---

## 4. Withdraw (student, FR-DA-05 + auto-promote FR-RS-08)

```http
POST /api/applications/:id/withdraw
Authorization: Bearer <student token>
Content-Type: application/json

{ "reason": "accepted another offer" }   // optional, ≤1000 chars
```

**200**
```json
{
  "application": { "id": 7, "status": "withdrawn" },
  "promoted": { "id": 9, "status": "approved", "rank": 2 } | null,
  "seats_available": 0,
  "cancelled_interviews": 1
}
```

| Case | Status | `code` |
|---|---|---|
| Not owner / non-student | 403 | `FORBIDDEN` |
| Pre-decision status after deadline | 409 | `DEADLINE_PASSED` (+`details.deadline`) |
| Already rejected/withdrawn | 409 | `INVALID_TRANSITION` |

**Rules**
- **Deadline lock** applies to pre-decision states (`submitted|under_review|shortlisted`); `waitlisted`/`approved` may withdraw anytime so seat release stays available post-deadline.
- **Approved withdrawal** (in one tx): free seat → promote lowest-position waitlisted applicant (status→approved, event `actor_role: system`, notification `waitlist_promoted`) → consume the seat (net seat change = 0). Open interviews of the withdrawn app are cancelled.
- No waitlist → seat simply returns (`promoted: null`).

---

## 5. Waitlist view (FR-RS-08)

```http
GET /api/programs/:id/waitlist
```

**200**
```json
{
  "total": 2,
  "waitlist": [
    { "position": 1, "application_id": 9, "status": "waitlisted",
      "rank": 2, "score": 64.08, "duplicate_aid": false,
      "student_id": "4", "student_name": "Rafi Auntik", "student_email": "rafi3@example.com",
      "waitlisted_at": "…" }
  ]
}
```

---

## 6. Reorder waitlist

```http
PUT /api/programs/:id/waitlist/reorder
Content-Type: application/json

{ "application_ids": [9, 8] }   // exact current set, in the new order
```

**200** → `{ "waitlist": [ … ] }` (positions 1..n)

| Case | Status | `code` |
|---|---|---|
| Missing / extra / duplicate ids | 409 | `WAITLIST_MISMATCH` (+`details.expected/received`) |
| Not owner | 403 | `FORBIDDEN` |

Server applies positions via a +100000 offset swap so the unique `(program_id, position)` constraint never fires mid-update.

---

## 7. Manual promote

```http
POST /api/programs/:id/waitlist/:applicationId/promote
Content-Type: application/json

{ "force_reason": "Second aid allowed by policy", "message": "…" }
```
Body fields all optional (`remarks`, `message`, `force_reason`, `committed_amount`).

**200** — same shape as decide-approve (seats, events, duplicate-aid rules **all apply**).

| Case | Status | `code` |
|---|---|---|
| Not waitlisted | 409 | `INVALID_TRANSITION` |
| Wrong program | 404 | `NOT_IN_PROGRAM` |
| Duplicate aid w/o force | 409 | `DUPLICATE_AID` |
| No seats | 409 | `SEATS_EXHAUSTED` |

---

## Notification kinds written

| Kind | Trigger | Channels |
|---|---|---|
| `waitlist_promoted` | auto-promote on approved-withdrawal | in_app=`sent`, email/sms=`skipped` (until creds) |
