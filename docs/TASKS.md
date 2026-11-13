# Tasks — Alokdaar

Status legend: `todo` · `in_progress` · `review` · `done` · `blocked`

Owners: **Rafi** = 22201075 · **Naved** = 22201025 · **Hemel** = 22299367

---

## M0 — Lab submission (CSE471 Figma)

| ID | Task | Owner | Status |
|---|---|---|---|
| M0.1 | Feature 01 boards: Discovery & Application (desktop + mobile) | Rafi | done |
| M0.2 | Feature 02 boards: Online Donations (desktop + mobile) | Rafi | done |
| M0.3 | Feature 03 boards: Review & Smart Selection (desktop + mobile) | Naved | done |
| M0.4 | Feature 04 boards: Regional Impact Map (desktop + mobile) | Naved | done |
| M0.5 | Feature 05 boards: Document Vault & OCR (desktop + mobile) | Hemel | done |
| M0.6 | Feature 06 boards: AI Assistant & Help Desk (desktop + mobile) | Hemel | done |
| M0.7 | Shared context: public / admin / student shells | All | done |
| M0.8 | Paste Figma file + prototype links into each assignment doc | Rafi, Naved | review |
| M0.9 | Submit assignment docs (Rafi + Naved filled; Hemel to fill if required) | All | todo |

---

## M1 — Foundation

| ID | Task | Owner | Status |
|---|---|---|---|
| M1.1 | Monorepo layout: `client/` (React+Vite+Tailwind), `server/` (Express), `docs/` | Rafi | todo |
| M1.2 | Postgres schema v1 + migrations (users, programs, applications, documents, donations, ledger, tickets, …) | Rafi | todo |
| M1.3 | JWT auth: register/login/refresh, role middleware (student/provider/admin) | Rafi | todo |
| M1.4 | Design tokens in Tailwind matching DESIGN.md palette | Rafi | todo |
| M1.5 | App shells: landing, student, provider, admin routing + sidebar nav | Rafi | todo |
| M1.6 | react-i18next setup (bn/en) + locale files | Naved | todo |
| M1.7 | Error envelope, validation helper, global error boundary | Naved | todo |
| M1.8 | CI: lint + test on PR; GitHub branch protection | Hemel | todo |

---

## M2 — Students: discovery & applications (FR-DA / FR-M2-01 / FR-M1-03)

| ID | Task | FR | Owner | Status |
|---|---|---|---|---|
| M2.1 | Program search/filter API + UI (provider, district, amount, level, deadline) | FR-DA-01 | Rafi (API: Hemel) | in_progress |
| M2.2 | Eligibility engine + per-card badge (exact fail reason) | FR-DA-02 | Rafi (engine: Hemel) | in_progress |
| M2.3 | Bookmarks API + Bookmarked screen | FR-DA-03 | Rafi (API: Hemel) | in_progress |
| M2.4 | Programme detail page | FR-DA-05 | Rafi | todo |
| M2.5 | 4-step wizard (details → docs → statement → review) + confirm + success | FR-DA-04 | Rafi (API: Hemel) | in_progress |
| M2.6 | Edit/withdraw + deadline lock + withdraw dialog | FR-DA-05 | Rafi (API: Hemel) | in_progress |
| M2.7 | My Applications list + detail timeline + interview block | FR-DA-06 | Rafi (API: Hemel) | in_progress |
| M2.8 | Loading / empty / error states for discovery | FR-DA-07 | Rafi | todo |
| M2.9 | Academic & household records CRUD + history | FR-M1-03 | Rafi (API: Hemel) | in_progress |
| M2.10 | Renewal: semester upload → CGPA hold + provider notify | FR-M1-03 | Rafi (API: Hemel) | in_progress |
| M2.11 | Mobile responsive pass for all student screens | — | Rafi | todo |


**M2 notes (2026-11-13)** — backend APIs on `feature/discovery` (stacked on `feature/impact-dropout`): `012_discovery.sql` (`draft` status, nullable submitted_at, one live application per programme+student, `bookmarks`), `modules/discovery` (search with per-card eligibility + exact fail reasons, detail checklist, bookmarks, wizard draft→autosave→submit with server-side re-checks incl. vault docs, My Applications + timeline), `modules/records` (/api/me/records, /api/me/academic upsert with renewal provider notify, /api/me/household). Provider queue + ranking now exclude drafts; withdraw rejects drafts. Flow doc `documents/api-flows/discovery.md`. Remaining: all UI (Rafi), eligibility caching (ARCH §5.1 — computed live for now), M2.4/M2.8/M2.11 are UI-only.

---

## M3 — Documents & OCR (FR-DV / FR-M1-01)

| ID | Task | FR | Owner | Status |
|---|---|---|---|---|
| M3.1 | Cloudinary upload API (replace/delete) | FR-DV-01 | Hemel | done |
| M3.2 | Google Vision extract + mismatch compare job | FR-DV-02 | Hemel | in_progress |
| M3.3 | Status pipeline pending/verified/rejected + re-upload | FR-DV-03 | Hemel | done |
| M3.4 | Vault UI: list, upload, processing, check-what-we-read, error states | FR-DV-04 | Hemel | todo |
| M3.5 | Admin verification queue + document detail actions | FR-DV-05 | Hemel | in_progress |
| M3.6 | Mobile vault screens | FR-DV-06 | Hemel | todo |

**M3 notes (2026-11-13)**
- **Backend APIs complete** for M3.1–M3.3 and M3.5 (queue + verify/reject) on `feature/documents` — see `documents/api-flows/documents.md`. Migration `008_documents.sql` (documents + document_events, one active doc per student×kind).
- Pipeline refinement vs ARCHITECTURE §5.4: OCR mismatch → `action_required` (student confirms, Figma H1-4) → `pending` (admin queue) → `verified | rejected`.
- Dev fallbacks: no Cloudinary keys → direct `file_url` register (dev only); no `GOOGLE_VISION_API_KEY` → deterministic OCR from the student's profile (file name containing `mismatch` forces one mismatch for demos).
- Remaining: real Vision call verification once `GOOGLE_VISION_API_KEY` exists (M3.2); admin UI + vault UI (M3.4–M3.6); DB smoke test pending shared Neon `DATABASE_URL` on this machine.

---

## M4 — Provider selection (FR-RS / FR-M1-02)

| ID | Task | FR | Owner | Status |
|---|---|---|---|---|
| M4.1 | Program management CRUD + lifecycle (draft/open/paused/closed + auto-close job) | FR-M1-02 | Naved | in_progress |
| M4.2 | Review queue API + UI (rank, breakdown bar, filters, bulk actions) | FR-RS-01 | Naved | in_progress |
| M4.3 | Ranking weights editor (Σ=100 validation, top-5 preview, re-rank) | FR-RS-02 | Naved | in_progress |
| M4.4 | Applicant detail + score explanation + AI summary hook | FR-RS-03 | Naved | in_progress |
| M4.5 | Duplicate-aid detection + conflict modal | FR-RS-04 | Naved | in_progress |
| M4.6 | Approve / Reject / Waitlist decision modals | FR-RS-05 | Naved | in_progress |
| M4.7 | Interview scheduling + Google Calendar/Meet + SMS | FR-RS-06 | Naved | in_progress |
| M4.8 | Interviews list (Join / Reschedule) | FR-RS-07 | Naved | in_progress |
| M4.9 | Waitlist + auto-promotion on withdrawal | FR-RS-08 | Naved | done |
| M4.10 | Student interview view (countdown, Join Meet) | FR-RS-09 | Naved | in_progress |

**M4 notes (2026-11-13)**
- **Backend APIs complete & smoke-tested** for M4.1–M4.10 — see `documents/api-flows/` (`programs.md`, `ranking.md`, `review-queue.md`, `decisions.md`, `interviews.md`).
- Remaining: auto-close job (M4.1); client UI screens for queue/weights/modals/interviews (M4.2–M4.10); real Google Calendar/Meet + SMS gateway (M4.7, needs credentials); AI summary hook (M4.4, needs Gemini key — pairs with M6.12).
- M4.9 fully done (list/reorder/promote/withdraw auto-promote, notifications).

---

## M5 — Donations & disbursement (FR-DN / FR-M3-01 / FR-M3-02)

| ID | Task | FR | Owner | Status |
|---|---|---|---|---|
| M5.1 | Campaigns list + detail APIs/UI (progress, general fund) | FR-DN-01/02 | Rafi (API: Hemel) | in_progress |
| M5.2 | Checkout + SSLCommerz session (one-time/monthly) | FR-DN-03 | Rafi (API: Hemel) | in_progress |
| M5.3 | IPN webhook: verify, idempotent confirm, fund increment | FR-DN-09 | Rafi (API: Hemel) | review |
| M5.4 | Redirect/verifying/success/pending/failed screens | FR-DN-04 | Rafi | todo |
| M5.5 | Receipt generation (print + PDF) | FR-DN-05 | Rafi (JSON: Hemel) | in_progress |
| M5.6 | My donations + recurring pause/change/cancel | FR-DN-06 | Rafi (API: Hemel) | in_progress |
| M5.7 | My impact anonymized CGPA view | FR-DN-07 | Rafi (API: Hemel) | in_progress |
| M5.8 | Provider donations received + CSV | FR-DN-08 | Rafi (API: Hemel) | in_progress |

**M5.1–M5.8 notes (2026-11-13)** — backend APIs on `feature/donations` (branched off `feature/notifications`; merge in order): `010_donations.sql` (donations, receipts, `programs.fund_raised`), `services/sslcommerz.js` (session + validator with timeouts), `modules/donations/*` (campaigns, guest/signed-in checkout, idempotent IPN with server-side validation, dev-confirm fallback, status poll, mine + recurring pause/resume/cancel, receipt JSON, donor impact, provider received + CSV). Flow doc `documents/api-flows/donations.md`. Remaining: all UI screens (Rafi), SSLCommerz sandbox keys → real IPN test (M5.3 stays "review" until then), receipt PDF (M5.5/M5.11), recurring re-charge job (needs gateway agreement).
| M5.9 | Installment schedule + disbursement record (method, ref) | FR-M3-01 | Rafi (API: Hemel) | review |
| M5.10 | Hash-chained ledger + integrity verify | FR-M3-01 | Rafi (API: Hemel) | review |
| M5.11 | PDF award letter + QR → public verify page | FR-M3-01 | Rafi (API: Hemel) | in_progress |
| M5.12 | Student confirm receipt + payment history | FR-M3-01 | Rafi (API: Hemel) | review |

\* blocked on sandbox credentials


**M5.9–M5.12 notes (2026-11-14)** — backend on `feature/disbursements` (stacked on `feature/discovery`): `013_disbursements.sql` (installments, disbursements with one live payment per installment, append-only `ledger_entries`, `award_letters`, `programs.fund_disbursed`), `lib/ledger.js` (sha256 chain, unit-tested vs tamper/splice/re-hash), `modules/disbursements` (schedule, disburse under an advisory lock, void-with-reason, ledger views + verify, public PII-free ledger, award letter HTML+QR via new `qrcode` dep, public /verify/award/:code with initials only, student confirm-receipt + /api/me/payments). 8-stage E2E green on Neon incl. a live SQL-tamper detection (M7.3 ledger demo done; OCR mismatch demo covered by the 15-stage run). Remaining: UI (Rafi), server-side PDF if required (browser print of the HTML letter works for the demo).

---

## M6 — Impact, analytics, support (FR-IM / FR-M3-03/04/05/06 / FR-M2-03)

| ID | Task | FR | Owner | Status |
|---|---|---|---|---|
| M6.1 | Aggregate API: district/upazila funds, students, unfunded | FR-IM-01 | Naved (API: Hemel) | in_progress |
| M6.2 | Tile map UI + filters + top districts + create-campaign CTA | FR-IM-01 | Naved | todo |
| M6.3 | Bangla map + locale switch | FR-IM-02 | Naved | todo |
| M6.4 | District panel + upazila drill-down + CSV | FR-IM-03/04 | Naved | todo |
| M6.5 | Mobile map + public landing section | FR-IM-05/06 | Naved | todo |
| M6.6 | Map loading/empty/error states | FR-IM-07 | Naved | todo |
| M6.7 | Heatmap layer option (Google Maps or Leaflet) | FR-IM-08 | Naved | todo |
| M6.8 | Analytics dashboard + report configs + PDF/CSV export | FR-M3-04 | Naved (overview API + CSV: Hemel) | in_progress |
| M6.9 | Notification center (in-app/email/SMS) + preferences + STATUS shortcode | FR-M2-03 | Hemel | in_progress |
| M6.10 | Deadline reminder cron | FR-M2-03 | Hemel | done |
| M6.11 | Dropout risk scoring + follow-up notes + program suggestions | FR-M3-05 | Hemel | in_progress |
| M6.12 | Gemini assistant (live data) + suggest-before-ticket | FR-AI-01 | Hemel | in_progress |
| M6.13 | Tickets: create, thread, My tickets | FR-AI-02/03 | Hemel | review |
| M6.14 | Admin help desk queue + resolve/close | FR-AI-03 | Hemel | review |
| M6.15 | AI reviewer: 3-line summary + originality flag | FR-AI-04 | Hemel | in_progress |
| M6.16 | Mobile assistant/tickets screens | FR-AI-05 | Hemel | todo |

---

## M7 — Hardening & demo

| ID | Task | Owner | Status |
|---|---|---|---|
| M7.1 | Seed script: demo programs, applications, donations, districts | All | in_progress |
| M7.2 | E2E happy paths: apply → review → approve; donate → IPN → receipt | All | todo |
| M7.3 | Ledger integrity audit demo + OCR mismatch demo | Rafi, Hemel | review |
| M7.4 | Performance pass (indexes on filters, map aggregates) | Naved | todo |
| M7.5 | Security pass (roles, webhook sig, PII in logs) | All | todo |
| M7.6 | Deploy Vercel + Render; staging env vars | Rafi | todo |
| M7.7 | Final screenshots vs Figma parity check | All | todo |

---

**M6.1/M6.8/M6.11 notes (2026-11-13)** — backend APIs on `feature/impact-dropout` (stacked on `feature/donations`): `011_impact_dropout.sql` (`student_profiles`, `dropout_cases`, `dropout_notes`), `modules/profiles` (GET/PUT /api/me/profile — also unblocks M2.9), `modules/impact` (public headline, per-district summary + CSV, district/upazila drill-down, analytics overview), `modules/dropout` (pure scoring, recompute, cases, notes, status, programme recommendations + notify). Flow doc `documents/api-flows/impact-dropout.md`. Remaining: map/analytics UI (Naved), report configs + PDF (M6.8), funds_disbursed once the M5.9 ledger exists, Bangla map strings (client).

## Deferred DB smoke tests — RUN 2026-11-13 ✅ (Neon URL now in server/.env; migrations 008–012 applied; 15-stage E2E all green)

- [x] Migrations 008–012 apply cleanly on the shared Neon DB
- [x] Documents happy path, steps 1–8 of `documents/api-flows/documents.md` (upload → dev-OCR mismatch → confirm → admin queue → verify; re-upload with `replace: true`)
- [x] `DOCUMENT_EXISTS` 409 on duplicate kind without `replace`
- [x] Notifications: list + unread badge, `:id/read`, `read-all`, preferences round-trip (`notifications.md` happy path)
- [x] `notify()` respects `sms_enabled=false` / `email_enabled=false` (rows logged `skipped`)
- [x] STATUS shortcode with a seeded application + matching phone; foreign phone gets the no-enumeration reply
- [x] Tickets/AI happy path (documents/api-flows/tickets-ai.md): chat → escalate with transcript → inbox/assign → internal note hidden → resolve → rate → reopen → reviewer summary cached + role-guarded
- [x] Disbursements happy path (documents/api-flows/disbursements.md): approve (duplicate-aid force) → schedule → disburse → ledger verify → SQL tamper detected + restored → void → award letter QR → public verify → confirm receipt
- [x] Jobs tick against real rows (auto-closed 1 stale past-deadline programme): auto-close past-deadline programme, 48h provider reminder, 24h re-upload nudge (dedup on second tick)
- [x] Discovery happy path (documents/api-flows/discovery.md): records + profile → search eligibility badge → bookmark → draft → autosave → submit blocked on missing docs → vault upload → submit → provider queue shows it (and never shows drafts)
- [x] Impact/dropout happy path (documents/api-flows/impact-dropout.md): profile PUT → recompute → high case → notes/recommend/status → impact summary + CSV → public headline
- [x] Donations happy path (double-confirm correctly rejected; fund incremented exactly once, tip excluded) (documents/api-flows/donations.md): order (guest + signed-in) → dev-confirm → fund_raised increment, tip excluded → receipt → idempotent re-confirm → recurring pause/resume/cancel → provider CSV

**M6.9/M6.10 notes (2026-11-13)** — backend complete on `feature/notifications`: migration `009_notifications_center.sql`, `services/sms.js` (BulkSMSBD/Twilio, dev fallback), `lib/notify.js` upgraded (real recipient, preferences, timeouts, `dedupHours`), `modules/notifications/*`, `jobs/scheduler.js` (also closes M4.1's auto-close job). Flow doc: `documents/api-flows/notifications.md`. Remaining for M6.9: client UI (center + prefs screens), real gateway keys.

## Dependency notes

- M2.5 needs M3.1 (vault) for document attach — mock vault list until M3 lands.
- M4.6 duplicate-aid needs active scholarship data from M5.9/M2 approvals.
- M5.3 IPN needs SSLCommerz sandbox keys (M7 deploy env).
- M6.12 Gemini needs API key + program search tool schema.
