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
  documents/          # source of truth: assignment docx + Figma board PNGs
    Assignment 1 _group 3.docx          # functional requirements (read this first)
    CSE471_Assignment_02_Figma_Rafi_22201075.docx
    CSE471_Assignment_02_Figma_Naved.docx
    CSE471_Assignment 02 Figma_Naved.docx   # blank template duplicate
    Alokdaar — Assignment 02 (CSE471 Figma)/  # 7 PNG boards
  docs/
    PRD.md ARCHITECTURE.md RULES.md DESIGN.md TASKS.md MEMORY.md
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
