# Notification Center, Preferences, STATUS Shortcode & Jobs (M6.9–M6.10 · FR-M2-03)

Owner: Hemel (22299367). Implements ARCHITECTURE §5.7. `lib/notify.js` now resolves the
real recipient (email/phone from `users`), honours `notification_preferences`
(in-app always on), uses SendGrid REST + BulkSMSBD/Twilio behind `services/sms.js`
with timeouts, and supports `dedupHours` so scheduled reminders never double-send.
Without gateway keys every external channel records `skipped` — fully runnable in dev.

## Endpoints (any authenticated role)

| Endpoint | Notes |
|---|---|
| `GET /api/notifications?unread=true&page=1&limit=20` | In-app center. **200** `{ items, unread, page, limit, total }` |
| `POST /api/notifications/:id/read` | **200** `{ id, read_at, unread }` · 404 `NOT_FOUND` |
| `POST /api/notifications/read-all` | **200** `{ marked, unread: 0 }` |
| `GET /api/notifications/preferences` | **200** `{ preferences: { email_enabled, sms_enabled } }` (defaults true) |
| `PUT /api/notifications/preferences` | Body: either/both booleans; empty body → 400 `VALIDATION_ERROR` |

## STATUS shortcode webhook (public — SMS gateway)

```http
POST /api/notifications/sms/inbound
x-webhook-secret: <SMS_WEBHOOK_SECRET>     # enforced only when the env var is set
{ "from": "01712345678", "text": "STATUS 4812" }    # aliases: sender/msisdn, message/body
```

- Non-shortcode text → **200** `{ "handled": false, "hint": "Expected: STATUS <application_id>" }`
- `STATUS <id>` → replies by SMS **only to the phone that owns the application**;
  unknown id and foreign phone get the same "not registered to this number" reply
  (no enumeration). Reply is logged as an `sms` notification row.
- Wrong secret → 401 `UNAUTHENTICATED`.

## Scheduled jobs (`jobs/scheduler.js`, every 15 min in-process; `JOBS_ENABLED=false` to disable)

| Job | What it does | Dedup |
|---|---|---|
| `autoClosePrograms` | `open` + deadline passed **or** seats exhausted → `closed`, notify provider (closes M4.1's remaining item) | 24 h |
| `programDeadlineReminders` | provider notified ~48 h before an open programme's deadline | 24 h |
| `rejectedDocumentReminders` | student nudged 24 h after a document rejection with no re-upload | 72 h |

Student-side "unfinished application" reminders join `tick()` once M2 adds
drafts/bookmarks. Last run per job is recorded in `job_runs`.

## Migration

`009_notifications_center.sql` — `notifications.read_at` + partial unread index,
`notification_preferences`, `job_runs`.

## Happy path (Postman, once DB is up)

1. Login → `GET /api/notifications` → rows from decisions/interviews/documents, `unread` badge
2. `POST /api/notifications/:id/read` → badge drops; `read-all` → 0
3. `PUT /api/notifications/preferences` `{ "sms_enabled": false }` → next `notify()` records sms `skipped`
4. `POST /api/notifications/sms/inbound` with a seeded application id + the student's phone → SMS reply logged
