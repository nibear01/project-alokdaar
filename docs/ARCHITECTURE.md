# Architecture — Alokdaar

| Field | Value |
|---|---|
| Project | Alokdaar — Education Aid Disbursement System |
| Stack | PERN (PostgreSQL, Express, React, Node) + TailwindCSS |
| Version | 1.0 |
| Date | 2026-11-02 |

## 1. High-level diagram

```text
┌─────────────────────────────────────────────────────────────────┐
│  Clients                                                        │
│  React SPA (Vercel)  ·  Bangla/EN via react-i18next             │
│  Landing / Public shell · Student shell · Provider · Admin      │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTPS + JWT (Authorization)
┌────────────────────────────▼────────────────────────────────────┐
│  API Gateway — Express (Render)                                 │
│  routes/ → controllers/ → services/ → repositories/             │
│  auth middleware · role guard · validation · rate limit          │
└──┬──────────┬──────────┬──────────┬──────────┬──────────┬───────┘
   │          │          │          │          │          │
   ▼          ▼          ▼          ▼          ▼          ▼
PostgreSQL  Cloudinary  G. Vision  SSLCommerz  SendGrid   G. Calendar
(Render)    (docs)      (OCR)      (IPN)       SMS        Meet events
                                            BulkSMSBD/
                                            Twilio
   │
   ▼
Google Gemini (assistant + statement summary) · Google Maps / Leaflet (impact)
```

## 2. Application shells (from shared Figma context)

| Shell | Audience | Nav |
|---|---|---|
| Landing & public | Anonymous / donors | Scholarships, Donate, Impact map, For providers, Help; বাংলা/EN, Sign in, Apply now |
| Student app | Students | Dashboard, Find scholarships, My applications, Document vault, Notifications, AI assistant, Ledger |
| Provider app | Providers | Programme review, weights, interviews, waitlist, disbursements, donations received, impact map |
| Admin app | Admins | Overview, Document verification, Help desk, Programs, Providers, Impact map, Ledger, Settings |

Design tokens shared across shells: cream background, dark green sidebars, amber primary CTA, soft green success panels.

## 3. Backend structure (suggested)

```text
server/
  src/
    config/          # env, db pool, third-party clients
    middleware/      # authJwt, requireRole, errorHandler, upload
    modules/
      auth/          # register, login, refresh, password reset
      programs/      # program CRUD, lifecycle, eligibility rules
      applications/  # wizard, status timeline, edit/withdraw
      ranking/       # weights, score breakdown, re-rank jobs
      interviews/    # slots, calendar sync, SMS notify
      documents/     # vault, OCR pipeline, verification queue
      donations/     # campaigns, checkout, IPN webhook, receipts
      disbursements/ # installments, ledger chain, award PDF+QR
      notifications/ # in-app, email, SMS, preferences, STATUS shortcode
      tickets/       # help desk threads, AI suggest-before-ticket
      analytics/     # charts, report configs, PDF/CSV export
      impact/        # district/upazila aggregates, map tiles data
      dropout/       # risk scoring, follow-up notes
    jobs/            # node-cron: deadline close, reminders, re-rank
    routes/
  tests/
```

## 4. Core data model (entities)

```text
users (id, role, name, email, phone, locale, ...)
students (user_id, institution, ...) 
providers (user_id, org_name, ...)
admins (user_id, ...)

academic_records (student_id, term, cgpa, attendance, institution, ...)
household_records (student_id, family_size, earners, monthly_income, source, ...)

programs (provider_id, title, criteria jsonb, fund, per_student, seats,
          required_docs, deadline, schedule, status: draft|open|paused|closed)
program_weights (program_id, merit, need, attendance)  -- must sum 100

applications (program_id, student_id, statement, status, score, rank, ...)
application_events (application_id, from, to, actor, at, note)

documents (student_id, kind, cloudinary_id, status, ocr_fields jsonb,
           mismatch jsonb, reject_reason, ...)

donations (donor_id, program_id|null, amount, recurring, gateway_ref,
           status: pending|confirmed|failed, ipn_payload, ...)
receipts (donation_id, pdf_url, ...)

installments (application_id, amount, due_date, status)
disbursements (installment_id, method, ref, prev_hash, hash, voided, ...)
award_letters (application_id, pdf_url, qr_payload)

interviews (application_id, slot_start, interviewer, meet_link, calendar_event_id, status)
waitlist (program_id, application_id, position)

tickets (user_id, category, status, ...)
ticket_messages (ticket_id, author, body, attachments)
notifications (user_id, channel, body, read_at, ...)
report_configs (owner, name, filters jsonb)
dropout_cases (student_id, level, notes...)
```

### 5. Critical flows

### 5.1 Eligibility check (Discovery)

```text
program.criteria  ×  student.academic + household
  → eligible | list[failed_criterion]
Cache per (student, program) invalidated on record change.
```

### 5.2 Ranking (Smart selection)

```text
score = w_m merit(cgpa) + w_n need(income_per_member, earners, family_size)
      + w_a attendance
weights per program; validate Σw = 100%; re-rank on save.
Every rank stores score_breakdown for “Why this rank?”.
Pre-approve: duplicate_aid check → conflict modal if active scholarship.
```

### 5.3 Donation + IPN (money in)

```text
POST /donations/order → SSLCommerz session
  → redirect / verifying screen
  → SSLCommerz IPN webhook
      verify signature
      if VALID & PAID → mark confirmed → increment program.fund (or general fund)
      else → failed / pending
  → receipt generated only on confirmed
Recurring: schedule; pause / change / cancel from My donations.
```

**Rule:** never increase fund before IPN validation.

### 5.4 Document OCR

```text
upload → Cloudinary store → status=pending
  → Google Vision extract fields
  → compare to student-entered data
  → verified | rejected(reason) | mismatch flag → admin queue
Re-upload allowed after reject.
```

### 5.5 Disbursement ledger (tamper-evident)

```text
record payment → hash = H(prev_hash || row_payload)
void/edit only with reason; keeps trace of previous record
“Verify ledger integrity” walks chain; broken link = alert
PDF award letter + QR → public authenticity page
Each disbursement decrements program remaining fund real-time;
student confirms receipt.
```

### 5.6 Interview scheduling

```text
pick slot → create interview
  → Google Calendar event + Meet link
  → SMS student (BulkSMSBD/Twilio)
  → toast + weekly summary
Auto-promote next waitlist on approved-student withdrawal.
```

### 5.7 Notifications

Channels: in-app | email (SendGrid) | SMS (BulkSMSBD/Twilio).  
Events: status change, doc verification, deadlines, disbursements.  
Scheduled job: unfinished application reminders.  
Shortcode: `STATUS <application_id>` → SMS reply with current status.

### 5.8 AI surfaces

- **Assistant:** Gemini + live program retrieval → answer before ticket creation.
- **Reviewer:** summarize personal statement ≤3 lines; originality flag.
- **Dropout risk:** CGPA/attendance trend + household income → low/medium/high; provider/admin follow-up notes; recommend open programs to student.

## 6. Impact map data

- Aggregates: funds disbursed, students supported, districts reached, unfunded eligible — by district and upazila, filterable by program, provider, time range.
- **Design (Figma):** tile map, one tile per district, colour scale low→high.
- **Production options:**
  1. Google Maps JavaScript API + heatmap layer (per Assignment 1).
  2. Leaflet + GeoJSON choropleth (no API key cost).
  3. Ship tile map first (matches Figma, zero map dependency), add heatmap later.

## 7. Localization

- `react-i18next`; default toggleবাংলা | EN on landing and key app screens.
- Money: `৳` with en-BD formatting; dates locale-aware.

## 8. Security & compliance notes

- JWT access + refresh; httpOnly refresh cookie recommended.
- Role guards on every mutating route (student / provider / admin).
- Webhook: verify SSLCommerz IPN signature before DB writes; idempotency key on gateway_ref.
- Files: presigned Cloudinary uploads; scan before public URL exposure.
- PII: donor impact views anonymized; ledger public page shows confirmation only, not full PII.
- Secrets only in env (Render/Vercel); never committed.

## 9. Deployment

| Piece | Target |
|---|---|
| Frontend | Vercel |
| API | Render |
| DB | Render PostgreSQL |
| Cron | Render worker or in-process scheduler |
| Media | Cloudinary |

Environment groups: `DATABASE_URL`, `JWT_SECRET`, `CLOUDINARY_*`, `VISION_*`, `SSLCOMMERZ_*`, `SENDGRID_*`, `SMS_*`, `GEMINI_*`, `GOOGLE_MAPS_*`, `GOOGLE_CALENDAR_*`, `APP_URL`.
