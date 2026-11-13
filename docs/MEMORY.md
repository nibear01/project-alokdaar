# MEMORY — Alokdaar

Persistent context for humans and AI agents. Update when decisions change; keep short and factual.

## What this project is

**Alokdaar — Education Aid Disbursement System.** CSE471 Lab Section 03, Fall 2026, Group 03.  
Scholarship discovery, provider selection, donations, disbursement ledger, OCR document vault, regional impact, AI help desk — for Bangladesh students. Tagline: *Education aid, made transparent.*

## People

| Name | ID | Figma features owned | FR focus |
|---|---|---|---|
| Md. Rafi Uddin Auntik | 22201075 | Discovery & Application; Online Donations | Academic/household, applications, disbursement, donations |
| Naved Abrar Nibir | 22201025 | Review & Smart Selection; Regional Impact Map | Program mgmt, ranking, map, analytics |
| Md. Hemel Uddin Chowdhury | 22299367 | Document Vault & OCR; AI Assistant & Help Desk | Vault/OCR, notifications, dropout, AI/tickets |

## Repo map

```text
project-alokdaar/
  package.json          # npm workspaces: server + client; npm run dev = both
  .gitignore            # ignores .env, node_modules, keys, uploads
  README.md             # setup: Neon DATABASE_URL, migrate, dev
  documents/            # source of truth: assignment docx + Figma board PNGs
    Assignment 1 _group 3.docx          # functional requirements (read this first)
    CSE471_Assignment_02_Figma_Rafi_22201075.docx
    CSE471_Assignment_02_Figma_Naved.docx
    CSE471_Assignment 02 Figma_Naved.docx   # blank template duplicate
    Alokdaar — Assignment 02 (CSE471 Figma)/  # 7 PNG boards
  docs/
    PRD.md ARCHITECTURE.md RULES.md DESIGN.md TASKS.md MEMORY.md
    jira/               # FR import CSV/JSON (12 stories) + README
  server/               # Express + pg; Neon-ready (SSL if neon.tech)
    .env.example        # DATABASE_URL (Neon pooled), JWT, all 3rd-party keys
    src/index.js        # helmet/cors/morgan + GET /api/health
    src/config/db.js    # pool loads server/.env explicitly
    src/db/migrate.js   # runs migrations/*.sql once (schema_migrations)
    src/db/migrations/001_init.sql  # users, programs, program_weights
  client/               # React + Vite + Tailwind (cream/forest/amber tokens)
    .env.example        # VITE_API_URL
```

## Canonical decisions

1. **Stack:** React + Tailwind (Vercel), Express + PostgreSQL (Render), JWT. PERN.
2. **Figma lab:** 2 unique features per member, same Figma file, no login/signup/forgot/profile screens, no duplicates across members.
3. **Palette:** cream bg, deep green chrome, amber primary CTA — shared across all shells (see DESIGN.md).
4. **Money:** BDT; donations gated on **SSLCommerz IPN** before fund increment; disbursement ledger is **hash-chained**, edits/voids only with reason.
5. **Ranking:** CGPA + need + attendance weights **sum to 100%**, per-program adjustable, always show breakdown.
6. **Map:** Figma shows **tile map** (one tile per district); production may add Google Maps heatmap or Leaflet later (ARCHITECTURE §6).
7. **i18n:** Bangla/English via react-i18next; toggle on landing + key screens.
8. **FR IDs** in PRD are stable identifiers — reference them in commits and tasks.

## External services (env keys)

| Service | Use |
|---|---|
| Cloudinary | Document storage |
| Google Cloud Vision | OCR field extract + mismatch |
| SSLCommerz | Donations (cards, bKash, Nagad) |
| Google Calendar | Interview events + Meet |
| SendGrid | Email notifications |
| BulkSMSBD / Twilio | SMS + STATUS shortcode |
| Google Gemini | Assistant + statement summary/originality |
| Google Maps / Leaflet | Impact heatmap (optional vs tile map) |

## Lab submission status (as of 2026-11-02)

- Feature boards PNGs present for all 6 features + shared shells.
- Rafi’s assignment docx: features written; **Figma/prototype link placeholders still empty**.
- Naved’s assignment docx (filled): links present → `https://www.figma.com/design/PKlGDIyM8jSBx5KEJGkbll/...` and matching `/proto/...`.
- Naved second docx is an **unfilled template** (ignore or delete before submit).
- Hemel: boards exist; check whether a filled assignment docx is required.

## Session state (2026-11-14 · Hemel)

**All six backend feature branches merged into `main`** (merge commits c1c67c7..d673399, in stack order: documents → notifications → donations → impact-dropout → discovery → disbursements). `main` now has migrations 001–013, 11 modules, the seed script, and all flow docs; everything below referring to feature branches is history. Backend remaining: third-party keys and client UI only — tickets + AI assistant landed 2026-11-14 (modules/tickets, modules/assistant, services/gemini.js with dev fallback, 014_tickets_ai.sql; flow doc tickets-ai.md). M6.12/15 stay in_progress until a real GEMINI_API_KEY is exercised.

## Session state (2026-11-13 · Hemel)

**Done**
- Cloned repo to this PC; reviewed Naved's merged work (auth, programs, review/decisions, ranking, interviews, waitlist).
- **M3 Document Vault backend** on `feature/documents`: migration `008_documents.sql`, `services/cloudinary.js` (presigned, no SDK) + `services/ocr.js` (Vision REST + dev fallback), `modules/documents/*`, wired in `index.js`. Flow doc: `documents/api-flows/documents.md`.
- Pipeline decision: `processing → action_required (student confirms mismatch) → pending → verified|rejected`; one active doc per (student, kind), replace supersedes.
- Smoke-tested without DB: route mount, 401/403 role guards, Zod validation, upload-sign dev fallback; pure-logic unit checks for OCR parse/compare + Cloudinary signature.

- **M6.9/M6.10 Notifications backend** on `feature/notifications`: `009_notifications_center.sql` (read_at, preferences, job_runs), `services/sms.js`, upgraded `lib/notify.js` (real recipient + preferences + dedupHours), notification center endpoints, public STATUS-shortcode webhook (`SMS_WEBHOOK_SECRET`), in-process jobs (auto-close programs — closes M4.1 leftover — deadline + re-upload reminders). Flow doc: `documents/api-flows/notifications.md`.

- **M5 Donations backend** on `feature/donations`: SSLCommerz session + validated idempotent IPN (fund increments only there), campaigns, receipts, recurring pause/resume/cancel, donor impact, provider CSV. Dev-confirm fallback without sandbox keys. `010_donations.sql`.
- **M6.1/M6.8/M6.11 backend** on `feature/impact-dropout`: `student_profiles` + /api/me/profile, per-district impact aggregates + CSV, analytics overview, dropout scoring/cases/notes/recommendations. `011_impact_dropout.sql`. Branch order: documents -> notifications -> donations -> impact-dropout.
- **M2 Discovery backend** on `feature/discovery`: eligibility engine (pure), search/detail/bookmarks, wizard with `draft` application status, records CRUD + renewal notify. Branch order now: documents -> notifications -> donations -> impact-dropout -> discovery.
- **M5.9–M5.12 Disbursements backend** on `feature/disbursements`: hash-chained ledger (advisory-locked appends, verify endpoint, live tamper demo passed), installments, void-with-reason, award letter HTML+QR (`qrcode` dep), public verify + public ledger (no PII), student confirm-receipt. Branch order: documents → notifications → donations → impact-dropout → discovery → disbursements.

**Waiting on**
- ~~Neon `DATABASE_URL`~~ — set 2026-11-13; migrations 008–012 applied, full 15-stage E2E green (see TASKS checklist). `npm run db:seed` creates demo admin/provider/student (`*@alokdaar.local`, password via SEED_PASSWORD, default in README).
- `GOOGLE_VISION_API_KEY` + `CLOUDINARY_*` for real OCR/storage (dev fallbacks in place).

## Session state (2026-11-02)

**Done**
- Read all documents (4 docx + 7 Figma PNGs); wrote six `docs/*.md`.
- Monorepo scaffolded: `npm install` at root; `npm run dev` → server :4000 + client :5173.
- `GET /api/health` verified (db down until real Neon URL set).
- Neon chosen for Postgres (user decision — realtime-friendly managed DB).
- Jira FR import ready in `docs/jira/`: 12 Stories, labels `rafi`/`naved`/`hemel`, epic name *Alokdaar Functional Requirements*.

**Blocked / waiting on user**
- Jira: need **existing project key** + three members’ **Jira usernames/emails** to rewrite CSV `Assignee` and JSON `"project": { "key": ... }`. User said project + team already exist — do not create a new Jira project.
- Neon: paste pooled `DATABASE_URL` into `server/.env`, then `npm run db:migrate`.
- SSLCommerz sandbox keys (IPN work).
- Rafi Figma/prototype links still placeholders in his assignment docx.

**How to import Jira once keys known**
- CSV: Jira → Create → Import from CSV → pick existing project → map columns (see `docs/jira/README.md`).
- JSON: `curl -X POST .../rest/api/3/issue/bulk` with API token after replacing `ALOK`.

## Gotchas

- Two Naved docx files — use the filled `CSE471_Assignment_02_Figma_Naved.docx`, not `CSE471_Assignment 02 Figma_Naved.docx`.
- Assignment 1 assigns FRs by bracketed ID `[22201075]` etc. — don’t reassign casually.
- Do not invent new common auth screens in Figma submissions.
- IPN handler must be idempotent (webhook retries).
- `STATUS <application_id>` SMS path is in requirements — don’t drop it.
- Public verify page for award QR must not leak full student PII.

## Quick links (in-repo)

- Requirements: `docs/PRD.md`
- Flows & schema: `docs/ARCHITECTURE.md`
- Do/don’t: `docs/RULES.md`
- Screens & tokens: `docs/DESIGN.md`
- Board: `docs/TASKS.md`
- Jira import: `docs/jira/README.md`
- Setup: `README.md` (root)
