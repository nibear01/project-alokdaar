# PRD — Alokdaar: Education Aid Disbursement System

| Field | Value |
|---|---|
| Project | Alokdaar — Education Aid Disbursement System |
| Course | CSE471: System Analysis and Design (Lab Section 03, Fall 2026) |
| Group | 03 |
| Version | 1.0 |
| Date | 2026-11-02 |
| Status | Draft |

## 1. Overview

Alokdaar connects students in every district of Bangladesh with verified scholarships and lets donors see exactly where their taka goes. Providers run transparent, ranked selection; admins keep documents, tickets and ledgers clean.

**One-liner:** Education aid, made transparent.

## 2. Goals

- Let students discover scholarships they are actually eligible for and apply in one guided flow.
- Let providers review, rank, interview and decide applications with explainable scores and duplicate-aid guards.
- Let donors fund programmes (one-time or recurring) via SSLCommerz and see real impact.
- Make every disbursement tamper-evident (hash-chained ledger) and every document OCR-verified.
- Surface regional gaps so under-served districts get campaigns.

## 3. Non-goals (v1)

- Native mobile apps (responsive web only).
- Offline-first mode.
- Multi-country / multi-currency support (BDT only).
- Replacing bank payment rails (SSLCommerz is the gateway).

## 4. Users & roles

| Role | Primary needs |
|---|---|
| Student | Find scholarships, track eligibility, apply, vault documents, see aid received, interview join |
| Donor | Browse campaigns, donate, receipts, history, impact view |
| Provider | Program setup, review queue, ranking weights, interviews, waitlist, disbursements, donations received |
| Admin | Verification queue, help desk, program/provider oversight, ledger integrity, analytics |

## 5. Tech stack (from Assignment 1)

- **Frontend:** React.js + TailwindCSS, react-i18next (Bangla/English)
- **Backend:** Node.js + Express.js
- **DB:** PostgreSQL
- **Auth:** JWT
- **Deploy:** Vercel (FE), Render (BE + DB)
- **External APIs:** Cloudinary, Google Cloud Vision, SSLCommerz, Google Maps/Leaflet, Google Calendar, SendGrid, BulkSMSBD/Twilio, Google Gemini

## 6. Feature requirements

Assigned for Figma lab (each member designs 2 unique features; no login/signup/profile screens):

### 6.1 Feature 01 — Scholarship Discovery & Application *(Rafi, 22201075)*

**FR-DA-01** Search/filter open programmes by provider, district, amount, education level, deadline.  
**FR-DA-02** Show automatic eligibility per programme (eligible, or exact failed criterion).  
**FR-DA-03** Bookmark programmes; quick Apply/Remove.  
**FR-DA-04** Four-step application wizard: confirm details → attach documents (from Document Vault) → personal statement → review & submit; confirmation dialog + success screen with application ID.  
**FR-DA-05** Edit or withdraw before deadline; edit-locked after deadline (withdraw dialog).  
**FR-DA-06** My Applications with status tabs; application detail with status timeline (submitted → under review → shortlisted → approved / waitlisted / rejected), interview slot + Google Meet link.  
**FR-DA-07** Loading skeleton, empty state, English + Bangla discovery UI. Mobile key screens.

### 6.2 Feature 02 — Online Donations to Programs *(Rafi, 22201075)*

**FR-DN-01** Campaigns page: monthly impact summary, programme cards with funding progress, featured campaign, General fund.  
**FR-DN-02** Campaign detail: progress, where money goes, public ledger note, recent donations.  
**FR-DN-03** Checkout: one-time or monthly, amount selection, donor details, order summary, Pay with SSLCommerz.  
**FR-DN-04** Redirect + verifying screens (await IPN); success / pending / failed payment states.  
**FR-DN-05** Printable receipt (Download PDF).  
**FR-DN-06** My donations: totals, recurring (pause / change amount / cancel), history.  
**FR-DN-07** My impact: anonymized academic progress of funded students (e.g. avg CGPA 3.1 → 3.4).  
**FR-DN-08** Provider: Donations received — amount raised, donor list, recurring vs one-time, CSV export.  
**FR-DN-09** Fund increase only after SSLCommerz IPN confirmation.

### 6.3 Feature 03 — Application Review & Smart Selection *(Naved, 22201025)*

**FR-RS-01** Review queue per programme: ranked list, CGPA / attendance / need score, colour-coded breakdown bar, total score, status; tabs/filters; bulk shortlist/reject; duplicate-aid badge.  
**FR-RS-02** Ranking weights settings (merit / need / attendance), live top-5 preview, validation when ≠ 100%, reset/save → re-rank.  
**FR-RS-03** Applicant detail: score explanation (“Why this rank?”), academic trend, verified docs, AI statement summary + originality flag; Approve / Reject / Waitlist.  
**FR-RS-04** Duplicate-aid conflict modal before approval (existing programme, amount, ledger ref; reason required to force-approve).  
**FR-RS-05** Decision modals: Approve (seats, committed amount, message), Reject (required remarks + quick chips), Waitlist (position).  
**FR-RS-06** Interview scheduling: weekly slot picker, New interview form → Google Calendar event + Meet link + student SMS; confirmation toast.  
**FR-RS-07** Interviews list: upcoming / past / no-show; Join Meet, Reschedule.  
**FR-RS-08** Waitlist & auto-promotion: order, manual promote/reorder, banner after withdrawal.  
**FR-RS-09** Student interview view: timeline, countdown, Join Meet, request another slot, tips.

### 6.4 Feature 04 — Regional Impact Map *(Naved, 22201025)*

**FR-IM-01** Provider map: summary cards (funds disbursed, students supported, districts reached, unfunded eligible), metric tabs, filters (program / provider / date), district tile map (colour scale), Top districts, “Where the need is unmet” → create campaign.  
**FR-IM-02** Bangla version + language switch.  
**FR-IM-03** District detail panel (e.g. Kurigram): amounts, upazila chart/table, active programmes, drill-down / create campaign.  
**FR-IM-04** Upazila drill-down: tile map toggle (disbursed vs unfunded), breadcrumbs, breakdown table + CSV.  
**FR-IM-05** Mobile map layout.  
**FR-IM-06** Public landing impact section + Donate / Open full map CTAs.  
**FR-IM-07** Map states: loading, no data (reset / widen range), error (table fallback + retry + CSV).  
**FR-IM-08** Figma uses tile map; production may use Google Maps heatmap (Leaflet fallback).

### 6.5 Feature 05 — Document Vault with OCR Verification *(Hemel, 22299367)*

**FR-DV-01** Upload / view / replace / delete supporting docs (transcript, income cert, birth cert, institution ID) via Cloudinary.  
**FR-DV-02** Each upload scanned with Google Cloud Vision; extract key fields (e.g. birth cert no, CGPA); flag mismatch vs entered data.  
**FR-DV-03** Status: pending / verified / rejected-with-reason; re-upload allowed after reject.  
**FR-DV-04** “Check what we read” review UI; upload error states (no file, file too large, wrong type, processing fail).  
**FR-DV-05** Admin verification queue (pending / approved / rejected / mismatch counts) + document detail with reasons.  
**FR-DV-06** Mobile vault screens.

### 6.6 Feature 06 — AI Assistant & Help Desk *(Hemel, 22299367)*

**FR-AI-01** Google Gemini answers eligibility / deadline / apply questions from live programme data before ticket creation.  
**FR-AI-02** Support tickets: category, description, attachments, threaded replies until Admin resolves/closes.  
**FR-AI-03** My tickets (open / resolved / closed); Admin Help desk stats and queue.  
**FR-AI-04** Reviewer: 3-line statement summary + originality flag (AI-generated/copied).  
**FR-AI-05** Mobile assistant + ticket screens.

### 6.7 Remaining functional requirements (Assignment 1 — build scope beyond Figma lab)

| ID | Feature | Owner (FR assignee) |
|---|---|---|
| FR-M1-01 | Document Vault with OCR | 22299367 |
| FR-M1-02 | Scholarship Program Management (draft/open/paused/closed; auto-close) | 22201025 |
| FR-M1-03 | Academic & Household Records + renewal CGPA hold | 22201075 |
| FR-M2-01 | Scholarship Discovery & Application | 22201075 |
| FR-M2-02 | Application Review & Smart Selection | 22201025 |
| FR-M2-03 | Multi-channel Notification Center (in-app, SendGrid, SMS; STATUS SMS reply) | 22299367 |
| FR-M3-01 | Disbursement & Installment Tracking (ledger, PDF award letter + QR) | 22201075 |
| FR-M3-02 | Online Donations to Programs | 22201075 |
| FR-M3-03 | Regional Impact Map | 22201025 |
| FR-M3-04 | Analytics Dashboard & Report Export (PDF/CSV) | 22201025 |
| FR-M3-05 | Dropout Risk Early Warning + follow-up notes | 22299367 |
| FR-M3-06 | AI Assistant & Help Desk | 22299367 |

## 7. Success metrics (lab demo)

- All 6 Figma feature boards implemented in shared project file with prototype links.
- No duplicate interfaces across members; no common auth screens in lab submission.
- Eligibility, ranking breakdown, IPN-gated donations, OCR statuses and map filters demonstrable end-to-end.

## 8. Open questions

- Tile map vs Google Maps heatmap production choice (see ARCHITECTURE).
- Recurring donation dunning / failed renewal handling.
- Rate limits on Gemini assistant calls.
