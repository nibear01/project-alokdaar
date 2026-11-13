# Disbursements, Hash-Chained Ledger & Award Letters — API Flows (M5.9–M5.12 · FR-M3-01)

Owner: Hemel (22299367); feature is Rafi's on the board — backend APIs, coordinate
before UI. Implements ARCHITECTURE §5.5 and RULES §2 Money: **append-only** ledger,
voids only with a reason, fund decremented in real time, student confirms receipt.

## The chain

Every payment (and every void) appends a `ledger_entries` row:
`hash = sha256(prev_hash || canonical(payload))` with the full payload stored
(`lib/ledger.js`, pure + unit-tested against tamper / splice / re-hash attacks).
Appends are serialised with a Postgres advisory lock, so the chain never forks.
`GET /api/ledger/verify` re-walks the whole chain; any edited payload, rewritten
hash or removed row reports `{ ok: false, broken_at: <entry id> }`.

## Provider / admin

| Endpoint | Notes |
|---|---|
| `POST /api/applications/:id/installments` `{ months, amount?, start_date? }` or `{ custom: [{amount, due_date}] }` | Approved applications only (409 `NOT_APPROVED`); 409 `INSTALLMENTS_EXIST` on re-schedule; notifies the student |
| `GET /api/applications/:id/installments` | Schedule + live disbursement info + totals (student sees their own) |
| `POST /api/installments/:id/disburse` `{ method: bkash\|nagad\|bank\|cash, ref, amount?, note? }` | One transaction: disbursement row → ledger entry → installment `paid` → `programs.fund_disbursed += amount` → notify student. 409 `ALREADY_PAID` (one live payment per installment), 409 `FUND_EXHAUSTED` when `total_fund` would be exceeded |
| `POST /api/disbursements/:id/void` `{ reason }` | **Reason required.** Flags the row and APPENDS a `void` ledger entry — nothing is deleted; installment back to `scheduled`, fund restored, student notified |
| `GET /api/ledger?program_id&page` | Business view (providers scoped to their programmes) |
| `GET /api/ledger/verify` | Chain integrity: `{ ok, entries }` or `{ ok: false, broken_at, reason }` |
| `POST /api/applications/:id/award-letter` | Issue (idempotent — 201 first time, 200 after) for approved applications |

## Student

| Endpoint | Notes |
|---|---|
| `GET /api/me/payments` | Installments + payments across all applications, `totals.received` |
| `POST /api/disbursements/:id/confirm-receipt` | "I received it" (M5.12); idempotent |
| `GET /api/applications/:id/award-letter?format=html` | Printable letter with embedded **QR** (data-URI via `qrcode`) → browser Print / Save as PDF. `format=json` returns the record + `verify_url` |

## Public (no auth)

| Endpoint | Notes |
|---|---|
| `GET /api/verify/award/:code` | Authenticity page data: valid flag, programme, provider, amount, **student initials only** (never full PII — ARCH §8) |
| `GET /api/ledger/public` | Recent entries: programme, district, month, amount, `hash_prefix` — no names, no refs |

## Migration & deps

`013_disbursements.sql` — `installments`, `disbursements` (one live per
installment), `ledger_entries`, `award_letters`, `programs.fund_disbursed`.
New dependency: `qrcode` (award-letter QR). `programs` responses now also expose
`fund_raised` / `fund_disbursed` (COLS updated in Naved's repository).

## Verified on Neon (2026-11-14, 8-stage E2E)

approve (incl. duplicate-aid **force path**) → schedule 3 → disburse (double-pay
rejected, fund +3000 live) → verify ok → **SQL tamper demo: edited a stored amount,
verify reported `broken_at` that entry; restored, verify ok** (M7.3 audit demo) →
void (reason enforced, fund restored, chain still verifies) → re-disburse →
award letter (idempotent, QR in HTML, public verify shows initials only, bad code
invalid) → student confirm-receipt + history → public ledger PII-free.

## Known limits

- PDF is produced by printing the HTML letter (browser "Save as PDF"); a server-side
  PDF can come later if the course demo needs a downloadable file.
- Recurring donation charging and gateway-side payouts remain out of scope until
  SSLCommerz sandbox keys exist (see donations.md).
