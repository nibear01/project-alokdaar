# API Flow — Interviews (M4.7 + M4.8 + M4.10)

Module: `server/src/modules/interviews/` · FR-RS-06, FR-RS-07, FR-RS-09
Roles: scheduling/list/reschedule/outcomes = `provider` (own program) / `admin` · student = own interviews only.

Statuses: `scheduled → reschedule_requested → scheduled` (after provider reschedule) · outcomes: `completed | no_show | cancelled`.

---

## 1. Weekly slot templates (FR-RS-06 slot picker)

```http
GET  /api/programs/:id/slots
POST /api/programs/:id/slots
```

**POST body**
```json
{ "weekday": 5, "start_time": "10:00", "end_time": "12:00", "duration_minutes": 30 }
```

| Field | Type | Rules |
|---|---|---|
| `weekday` | int | 0–6 (0 = Sunday) |
| `start_time` / `end_time` | `"HH:MM"` or `"HH:MM:SS"` | end > start (400 otherwise) |
| `duration_minutes` | int | 5–480, default 30 |

**201** → `{ "slot": { … } }` · **200** GET → `{ "slots": [...] }`

```http
DELETE /api/slots/:id
```
**200** → `{ "deleted": true }` · 404 `SLOT_NOT_FOUND` · 403 not owner.

---

## 2. Expanded available datetimes

```http
GET /api/programs/:id/slots/available?from=2026-11-13T00:00:00Z&to=2026-11-21T00:00:00Z
```
Both ISO datetimes optional; default = now → now+14d.

**200**
```json
{ "slots": [
  { "slot_start": "2026-11-14T09:00:00Z", "duration_minutes": 30, "template_id": 2 },
  { "slot_start": "2026-11-20T10:00:00Z", "duration_minutes": 30, "template_id": 1 }
] }
```
Filters out: past datetimes and provider-side conflicts (overlapping scheduled interviews). Student conflicts are checked at schedule time.

---

## 3. Schedule interview (FR-RS-06)

```http
POST /api/applications/:id/interview
Content-Type: application/json

{
  "slot_start": "2026-11-14T09:30:00Z",   // ISO, future
  "duration_minutes": 30,                   // optional, default 30
  "mode": "online",                         // online | in_person | phone, default online
  "notes": "Intro round"                    // optional
}
```

**201**
```json
{
  "interview": { "id": 1, "status": "scheduled", "slot_start": "…",
                 "mode": "online", "meet_link": "https://meet.google.com/abc-defg-hij" },
  "meet_link": "https://meet.google.com/abc-defg-hij"
}
```

| Case | Status | `code` |
|---|---|---|
| Application not `shortlisted` | 409 | `INVALID_APPLICATION_STATUS` |
| Overlaps provider **or** student interview | 409 | `SLOT_CONFLICT` (+`details.conflicts[]`) |
| Past `slot_start` | 400 | `PAST_SLOT` |
| Not owner / student role | 403 | `FORBIDDEN` |

**Server-side (one tx):** conflict query (interval overlap, `scheduled|reschedule_requested` only) → insert interview → generate Meet stub link (`mode=online`) → fan-out notifications (`interview_scheduled`: in_app sent, email/sms skipped until creds).

> Google Calendar/Meet API and SMS gateway are **stubs** — link is generated locally; wire real integrations when credentials exist.

---

## 4. Interview for an application

```http
GET /api/applications/:id/interview
```
**200** → `{ "interviews": [ … ] }` — student may only read own application (403 otherwise).

---

## 5. Interviews list with buckets (FR-RS-07)

```http
GET /api/programs/:id/interviews?bucket=upcoming
```

| `bucket` | Rows |
|---|---|
| `upcoming` (default) | `status=scheduled` **and** `slot_start > now()` |
| `past` | time passed or `completed`/`cancelled`, not upcoming |
| `no_show` | `status=no_show` |
| `reschedule_requested` | student asked for another slot |

**200** → `{ "bucket": "upcoming", "interviews": [ { …, "student_id", "student_name", "student_email" } ] }`

**Student's own list (FR-RS-09 countdown source):**
```http
GET /api/interviews/mine
```
**200** → `{ "interviews": [ { …, "program_title", "application_id" } ] }` · 403 for non-students.

---

## 6. Provider reschedule (FR-RS-07)

```http
POST /api/interviews/:id/reschedule
Content-Type: application/json

{ "slot_start": "2026-11-16T14:00:00Z", "duration_minutes": 30, "mode": "online", "notes": "…" }
```

**200** → `{ "interview": { …, "status": "scheduled", "proposed_slot_start": null } }`

- Clears any student `reschedule_requested` + `proposed_slot_start`.
- Conflict check excludes the interview itself; back-to-back (14:00–14:30 then 14:30) is **not** a conflict — true overlap is.
- 409 `INVALID_TRANSITION` if status ∉ {scheduled, reschedule_requested} · 409 `SLOT_CONFLICT` · 400 `PAST_SLOT`.

---

## 7. Mark outcome (FR-RS-07)

```http
POST /api/interviews/:id/status
Content-Type: application/json

{ "status": "completed", "notes": "strong fit" }   // completed | no_show | cancelled
```

**200** → `{ "interview": { … } }` · 409 `INVALID_TRANSITION` unless currently scheduled/reschedule_requested.

---

## 8. Student requests another slot (FR-RS-09)

```http
POST /api/interviews/:id/request-slot
Authorization: Bearer <student token>
Content-Type: application/json

{ "proposed_slot_start": "2026-11-15T10:00:00Z", "note": "class clash" }
```

**200** → interview with `status: "reschedule_requested"`, `proposed_slot_start` set.
Provider sees it under `bucket=reschedule_requested` and answers via **reschedule**.

| Case | Status | `code` |
|---|---|---|
| Not the student's interview | 403 | `FORBIDDEN` |
| Status ≠ scheduled | 409 | `INVALID_TRANSITION` |

---

## Notification kinds written

| Kind | Trigger |
|---|---|
| `interview_scheduled` | schedule |
| `interview_rescheduled` | provider reschedule |

Channels per event: `in_app` = `sent`, `email` = `pending→sent/failed` (only if `SENDGRID_API_KEY`), `sms` = `skipped` (no gateway yet).

---

## Example flow (FR-RS-06 → 07)

```bash
POST /api/programs/3/slots                     { "weekday": 6, "start_time": "09:00", "end_time": "11:00" }
GET  /api/programs/3/slots/available           → pick 2026-11-14T09:30:00Z
POST /api/applications/3/interview             { "slot_start": "2026-11-14T09:30:00Z" }
GET  /api/programs/3/interviews?bucket=upcoming
# student: GET /api/interviews/mine → countdown; POST /interviews/1/request-slot if clash
# provider: POST /api/interviews/1/reschedule { "slot_start": "…" } → student notified
# provider: POST /api/interviews/1/status { "status": "completed" }
```
