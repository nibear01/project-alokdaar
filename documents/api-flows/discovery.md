# Scholarship Discovery & Application — API Flows (M2 · FR-DA-01..07, FR-M1-03)

Owner: Hemel (22299367); feature is Rafi's on the board — these are the backend APIs,
coordinate before UI work. All endpoints role `student`.

**Wizard state model:** `draft` (new `application_status` value; migration 012) →
`submitted` at step 4. Drafts are invisible to providers (queue + ranking exclude
them), are **deleted** rather than withdrawn, and `submitted_at` stays NULL until
submission. One live application per (programme, student) is enforced by a partial
unique index.

## Discovery

| Endpoint | Notes |
|---|---|
| `GET /api/discovery/programs?search&district&education_level&min_amount&deadline_within_days&eligible=true&sort=deadline\|amount\|newest&page&limit` | Open programmes with a per-card `eligibility` object and `days_left`; `matching_profile` powers "12 match your profile". `eligible=true` keeps only full matches |
| `GET /api/discovery/programs/:id` | Detail + eligibility checklist ✓/✗ with **exact fail reasons** ("CGPA 3.2 < 3.5"), required docs vs vault, `can_apply` |
| `GET /api/discovery/bookmarks` · `PUT`/`DELETE /api/discovery/bookmarks/:programId` | Saved list re-evaluates eligibility live (FR-DA-03) |

**Eligibility engine** (`modules/discovery/eligibility.js`, pure + unit-tested):
`criteria { min_cgpa, max_household_income, districts[], education_levels[] }` ×
student snapshot (latest academic + household + profile + vault kinds). Missing
student data fails the check with guidance ("Add your household record…") instead
of silently passing. Required docs count as present when an active vault document
of that kind is `pending` or `verified`.

## Application wizard (FR-DA-04/05)

| Step | Endpoint | Rules |
|---|---|---|
| Start | `POST /api/discovery/applications { program_id }` | Only when `can_apply`: open + eligible + before deadline + no live application → 201 draft · 403 `NOT_ELIGIBLE` (failed checks attached) · 409 `APPLICATION_EXISTS` |
| Autosave | `PATCH /api/discovery/applications/:id { statement }` | Drafts always; after submit only while `submitted/under_review` **and** before the deadline (409 `DEADLINE_PASSED` after — edit-locked, RULES §2) |
| Review+submit | `POST /api/discovery/applications/:id/submit` | Server re-checks: programme open, deadline, eligibility, **all required docs in vault** (409 `DOCUMENTS_MISSING`), statement ≥ 50 words. Writes the timeline event and notifies student + provider |
| Discard | `DELETE /api/discovery/applications/:id` | Drafts only; submitted applications use the existing `POST /api/applications/:id/withdraw` (deadline-locked, waitlist auto-promote) |

## My applications (FR-DA-06)

- `GET /api/discovery/applications?status=&page&limit` — tabs; rows carry programme,
  provider, rank (when published) and the interview block (`interview_at`, `meet_link`).
- `GET /api/discovery/applications/:id` — own detail: full `events` timeline,
  live eligibility, `can_edit` / `can_withdraw` flags, statement word count.

## Records (M2.9/M2.10 · FR-M1-03)

| Endpoint | Notes |
|---|---|
| `GET /api/me/records` | Full academic history + household snapshots |
| `POST /api/me/academic { term, cgpa, attendance_pct, institution }` | Upsert by (student, term). **Renewal hook:** providers of this student's `approved` applications get a notification (24h dedup) so they can review before the next installment |
| `POST /api/me/household { family_size, earners, monthly_income, source }` | Appends a snapshot; `latest_household` view feeds need scoring |

## Touched shared code

- `applications/repository.queueForProgram` + `ranking` scoring query now exclude `'draft'`.
- `applications/service.withdraw` rejects drafts (deleted instead).

## Migration

`012_discovery.sql` — `'draft'` enum value, nullable `submitted_at`, partial unique
`(program_id, student_id) WHERE status <> 'withdrawn'`, `bookmarks`.

## Happy path (once DB is up)

1. `PUT /api/me/profile` (district) → `POST /api/me/academic` → `POST /api/me/household`
2. `GET /api/discovery/programs` → eligible badge · `PUT bookmarks/:id`
3. `POST /api/discovery/applications` → draft · `PATCH` statement (autosave) · `submit` → 409 `DOCUMENTS_MISSING` until the vault has the required kinds → upload (documents.md flow) → submit → 200
4. Provider queue shows it (no drafts); decide/interview flows continue per Naved's docs
5. `GET /api/discovery/applications/:id` → timeline; after deadline PATCH → 409 `DEADLINE_PASSED`
