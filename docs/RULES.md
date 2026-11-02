# Rules — Alokdaar

Repo, product and lab rules. Follow these unless a ticket says otherwise.

## 1. Lab assignment rules (CSE471 Figma)

1. Design interfaces for **exactly two assigned features** from the submitted requirement analysis.
2. All members work in the **same** Figma project.
3. **No duplicate** interfaces across group members.
4. **Forbidden screens:** login, sign up, forget password, profile management.
5. Reference: `Lab 03 : Figma Manual.docx`; sample file/prototype links in assignment docs.
6. Submission must include feature descriptions, screenshots (desktop + mobile where required), Figma file link and prototype link.

### Feature ownership (Figma)

| Member | ID | Feature 1 | Feature 2 |
|---|---|---|---|
| Rafi Uddin Auntik | 22201075 | Scholarship Discovery & Application | Online Donations to Programs |
| Naved Abrar Nibir | 22201025 | Application Review & Smart Selection | Regional Impact Map |
| Hemel Uddin Chowdhury | 22299367 | Document Vault with OCR Verification | AI Assistant & Help Desk |

## 2. Product / business rules

### Programs
- Status lifecycle: `draft → open → paused → closed`.
- Auto-close when **deadline passes** or **fund exhausted**.
- Eligibility criteria: min CGPA, max household income, eligible districts, education levels, required documents.

### Applications
- Edit/withdraw allowed **before** deadline; **edit-locked** after.
- Status timeline order: `submitted → under review → shortlisted → approved | waitlisted | rejected`.
- Four-step wizard only for eligible students; documents pulled from Document Vault (not free-upload on wizard).

### Ranking
- `merit + need + attendance` weights **must sum to 100%**; save blocked otherwise.
- Every displayed rank must have a stored score breakdown.
- Duplicate-aid: warn if student already holds active scholarship; force-approve requires a reason.

### Decisions
- **Approve:** show remaining seats + committed amount; optional student message.
- **Reject:** remarks **required** (quick-reason chips allowed).
- **Waitlist:** provider picks position.
- Withdrawal of approved student → **auto-promote** next waitlisted (manual promote/reorder also allowed).

### Money
- Donations: one-time or recurring monthly; specific programme or general fund.
- Gateway: SSLCommerz (cards, bKash, Nagad).
- **Fund increases only after IPN validation** — never on client redirect alone.
- Receipt only for confirmed donations; downloadable/printable.
- Disbursement edits/voids require reason; **never silent delete**; ledger hash chain preserved.
- Award letter PDF includes QR → public verification page.

### Documents
- Statuses: `pending | verified | rejected(reason)`.
- Re-upload allowed after reject.
- OCR mismatch flagged for human review (admin verification queue).

### Notifications
- Channels: in-app, email, SMS; user sets preferences.
- SMS shortcode: `STATUS <application_id>` → current status reply.
- Deadline reminder job for unfinished applications.

### Localization & money display
- Bangla/English toggle on public + key screens.
- Currency BDT (`৳`).

## 3. Engineering rules

### Git
- GitHub with **individual commit history** per member (no shared bot account).
- Conventional-ish messages: `feat:`, `fix:`, `docs:`, `chore:`.
- Never commit secrets, `.env`, or student PII dumps.
- PRs: describe FR IDs touched (e.g. `FR-DN-03`).

### Code
- JavaScript **ES6+**; React function components; Tailwind for styling.
- Backend: Express modules per domain (see ARCHITECTURE); no god-file routes.
- Validate request bodies; consistent JSON error shape: `{ error, code, details? }`.
- Auth: JWT; every non-public route checks role.
- i18n: no hardcoded user-facing English in student/donor UI — add keys to locale files.

### Database
- Migrations for all schema changes; no manual prod DDL.
- Money as integer **poisha** or `NUMERIC(12,2)` — never float.
- Ledger rows immutable except append-only void/adjust with reason + prev_hash.

### APIs / third parties
- Webhooks verify signature; idempotent processing.
- External calls behind service wrappers with timeouts + retries (idempotent retry only).
- Secrets from env only.

### Testing & quality
- Run lint + typecheck (if configured) before push.
- Critical paths to cover: eligibility calc, score weights sum, IPN handler, ledger verify, OCR mismatch compare.

## 4. Design rules (from Figma boards)

- Palette: cream `#F7F4EC`-style bg, deep green chrome/sidebar, amber primary buttons, soft green success, red destructive.
- Cards: rounded, subtle border, generous padding; status as pill badges.
- Desktop shells: left sidebar nav; public landing: top nav + hero + campaign cards + trust section.
- Always design **loading skeleton**, **empty**, and **error** states where data is fetched.
- Show **exact failure reasons** (eligibility criterion, OCR reject reason, validation totals).
- Mobile versions required for key screens per assignment.
- Trust cues: hash-chained ledger, OCR-verified docs, duplicate-aid detection, anonymised impact.

## 5. Docs rules

Six living docs in `docs/`:

| File | Purpose |
|---|---|
| `PRD.md` | Requirements, FR IDs, feature ownership |
| `ARCHITECTURE.md` | System design, flows, data model |
| `RULES.md` | This file — lab, product, eng, design rules |
| `DESIGN.md` | Visual system, screens inventory, tokens |
| `TASKS.md` | Task board / milestone plan |
| `MEMORY.md` | Persistent project context for agents & humans |

- Update `MEMORY.md` when decisions change.
- FR IDs are stable; never renumber — deprecate instead.
- New screens must appear in `DESIGN.md` inventory.
