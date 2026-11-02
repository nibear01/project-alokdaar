# Design — Alokdaar

Visual system and screen inventory derived from the Assignment 02 Figma boards in `documents/Alokdaar — Assignment 02 (CSE471 Figma)/`.

## 1. Brand

| Token | Value (approx) | Usage |
|---|---|---|
| `--bg` | Cream `#F6F3EA` | Page background |
| `--surface` | White `#FFFFFF` | Cards, panels |
| `--surface-dark` | Deep green `#1F2A22` | Sidebars, footer, dark cards |
| `--primary` | Amber `#F0B429` / `#F5C518` | Primary CTAs, highlights |
| `--primary-text` | Near-black on amber | Button labels |
| `--accent-green` | Sage `#8FBC8F` → `#5F8F5F` | Heroes, progress, map scale low→high |
| `--success` | Soft green panel | Eligible, verified, success |
| `--warning` | Amber tint | Pending, mismatch, deadline |
| `--danger` | Soft red | Reject, failed payment, conflicts |
| `--muted` | Warm grey | Secondary text, borders |
| Radius | 8–12px cards, full pill badges | |
| Font | Clean sans (Inter / system) | Bangla: system Bengali font |

**Voice:** calm, transparent, trustworthy. Tagline: *Education aid, made transparent.*

## 2. Shells

### 2.1 Landing & public
- Top bar: logo **Alokdaar**, nav — Scholarships, Donate, Impact map, For providers, Help; বাংলা/EN toggle; Sign in; **Apply now** (dark pill).
- Hero (green): badge “Education aid, made transparent.”; headline “Every deserving student, lit up by your support.”; subcopy; CTAs **Find a scholarship** (dark) + **Donate now** (amber); stats `12,480 students supported · ৳4.6cr disbursed · 64 districts`; floating “65% funded” chip.
- Section **Now we need your help**: campaign cards (image, location–provider eyebrow, title, raised progress, Donate) + dark **General fund** card with quick amounts ৳500 / ৳1,000 / ৳10,000.
- **Trust & transparency** (dark): Hash-chained ledger · OCR-verified documents · Duplicate-aid detection · Anonymised impact.
- Footer: address, support contact, Students / Donors link columns, newsletter.

### 2.2 Student shell
Sidebar: Dashboard, Find scholarships, My applications, Document vault, Notifications, AI assistant, Ledger; bottom Settings + profile completeness.  
Top: search, locale, avatar. Dashboard welcome + stat cards (applications, documents verified, aid received, next deadline).

### 2.3 Admin shell
Sidebar: Overview, Document verification, Help desk, Programs, Providers, Impact map, Ledger; Settings.  
Workspace cards: Pending documents, Open tickets (+ overdue), OCR mismatches.

### 2.4 Provider shell
Review queue, Ranking weights, Applicant detail, Interviews, Waitlist, Donations received, Impact map, Disbursements, Settings (as per feature boards).

## 3. Shared components

- **Stat card:** eyebrow label + big number + delta/context line.
- **Progress bar:** green fill; amount raised “of target”.
- **Status pill:** Eligible / Pending / Verified / Rejected / Shortlisted / Waitlist / Approved.
- **Eligibility badge:** green check *or* amber/red with **exact failed criterion**.
- **Score breakdown bar:** segmented colour (merit / need / attendance) + percentages.
- **Timeline:** vertical steps for application status; interview block with Meet link.
- **Dialogs:** title, body, optional warning icon, secondary + primary (amber or red) actions.
- **Toast:** success confirmation (e.g. interview scheduled, submitted).
- **Skeleton:** grey blocks for loading; empty state with illustration + action; error state with retry + table fallback where relevant.
- **Stepper:** 1 Confirm details → 2 Attach documents → 3 Personal statement → 4 Review & submit.
- **Data table:** header pills for tabs/filters; row actions; CSV export button.
- **Tile map:** district squares, green scale, tooltip/selection → side panel.

## 4. Screen inventory

### Shared context
| ID | Screen |
|---|---|
| S-00 | Landing & public shell |
| S-01 | Admin app shell / workspace |
| S-02 | Student app shell / dashboard |

### Feature 01 — Scholarship Discovery & Application (Rafi)
| ID | Screen |
|---|---|
| 1.1 | Find scholarships (Bangla) — cards + eligibility result |
| 1.2 | Loading skeleton + empty “No programmes match these filters” |
| 1.3 | Find scholarships (EN) — search, filters, eligibility badges |
| 1.4 | Bookmarked programmes — Apply / Remove |
| 1.5 | Programme detail — amount, seats, deadline, eligibility checklist, docs, timeline |
| 1.6 | App Step 1 — Confirm details |
| 1.7 | App Step 2 — Attach documents (verified / rejected / missing) |
| 1.8 | App Step 3 — Personal statement (counter, autosave, tips, error) |
| 1.9 | App Step 4 — Review & submit + confirm dialog |
| 1.10 | Submission success (application ID) |
| 1.11 | My applications — status tabs |
| 1.12 | Application detail — timeline, interview, Edit/Withdraw |
| 1.13 | Withdraw dialog + edit-locked after deadline |
| 1.14 | Mobile: Find, Step 1, My applications |

### Feature 02 — Online Donations (Rafi)
| ID | Screen |
|---|---|
| 2.1 | Campaigns — impact summary, cards, featured, general fund |
| 2.2 | Campaign detail — progress, money use, ledger note, recent donations |
| 2.3 | Donation checkout — one-time/monthly, amounts, details, Pay SSLCommerz |
| 2.4 | SSLCommerz redirect + “Verifying your payment” |
| 2.5 | Payment results — success / pending / failed |
| 2.6 | Printable receipt + Download PDF |
| 2.7 | My donations — totals, recurring controls, history |
| 2.8 | My impact — anonymized CGPA progress (3.1 → 3.4) |
| 2.9 | Donations received (provider) — totals, donors, split, CSV |
| 2.10 | Mobile: Campaigns + checkout |

### Feature 03 — Application Review & Smart Selection (Naved)
| ID | Screen |
|---|---|
| 3.1 | Review queue (desktop) — rank, breakdown, filters, bulk actions, duplicate badge |
| 3.2 | Review queue (mobile) — stacked cards |
| 3.3 | Ranking weights — sliders, top-5 preview, ≠100% validation, reset/save |
| 3.4 | Applicant detail — “Why this rank?”, AI summary, actions |
| 3.5 | Duplicate aid conflict modal |
| 3.6 | Decision modals — Approve / Reject / Waitlist |
| 3.7 | Interview scheduling — weekly slots, new interview form, calendar+Meet |
| 3.8 | Interviews list — upcoming/past/no-show, Join/Reschedule |
| 3.9 | Waitlist & auto-promotion |
| 3.10 | Student interview view — countdown, Join Meet, request slot |

### Feature 04 — Regional Impact Map (Naved)
| ID | Screen |
|---|---|
| 4.1 | Impact map full view — cards, filters, tile map, top districts, unmet-need CTA |
| 4.2 | Bangla version |
| 4.3 | District detail panel (e.g. Kurigram) |
| 4.4 | Upazila drill-down + CSV |
| 4.5 | Mobile impact map |
| 4.6 | Public landing impact section |
| 4.7 | Map states — loading / no data / failed (table + retry + CSV) |

### Feature 05 — Document Vault & OCR (Hemel)
| ID | Screen |
|---|---|
| 5.1 | Document vault — stats, docs list, add document |
| 5.2 | Upload a document — type, file, notes |
| 5.3 | “Reading your document…” processing |
| 5.4 | Check what we read — extracted vs entered, mismatch callouts |
| 5.5 | Upload error states — no file / too large / wrong type / processing fail |
| 5.6 | Document preview + replace/delete |
| 5.7 | Rejected doc — why rejected + re-upload |
| 5.8 | Verification queue (admin) |
| 5.9 | Document detail (admin) — approve/reject |
| 5.10 | Mobile vault + upload + check + reject flows |

### Feature 06 — AI Assistant & Help Desk (Hemel)
| ID | Screen |
|---|---|
| 6.1 | AI assistant — chat, source cards, “Not the answer you needed → create a ticket” |
| 6.2 | Create a ticket — category, description, attachments |
| 6.3 | My tickets — open/resolved/closed |
| 6.4 | Ticket detail — thread, replies, resolution |
| 6.5 | Admin help desk — stats, queue |
| 6.6 | Admin ticket detail — reply, resolve/close |
| 6.7 | AI reviewer summary panel — 3-line summary + originality |
| 6.8 | Mobile: assistant, create ticket, tickets list, ticket detail |

## 5. Content patterns

- Eligibility fail copy: state the **rule**, not “ineligible” (e.g. “Household income exceeds ৳25,000”).
- Empty filters: “No programmes match these filters” + Reset.
- Payment pending: awaiting SSLCommerz confirmation — do not claim success early.
- Trust line on campaign detail: public ledger transparency note.

## 6. Responsive

- Desktop ≥1024: sidebar shells, multi-column.
- Tablet: collapse filters to drawers.
- Mobile <764: bottom-friendly CTAs, stacked cards (per 1.x/3.2/4.5/5.10/6.8 boards); key screens mandatory for lab.

## 7. Accessibility baseline

- Contrast: dark green/cream and amber/dark pairs per boards.
- Focus rings on interactive elements; keyboard reachable dialogs.
- Form errors adjacent to field + summary; don’t rely on colour alone (icon + text).
- `aria` labels on icon-only buttons; map tiles have district names in accessible list fallback.
