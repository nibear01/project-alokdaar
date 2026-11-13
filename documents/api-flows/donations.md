# Online Donations — API Flows (M5.1–M5.8 · FR-DN-01..09)

Owner: Hemel (22299367), feature originally scoped to Rafi — coordinate before UI work.
Implements ARCHITECTURE §5.3. **Fund increments only after the IPN is validated
server-to-server** (RULES §2 Money); receipts exist only for confirmed donations;
IPN processing is idempotent on `tran_id`/`val_id`.

```text
POST /donations/order → pending + SSLCommerz session → gateway redirect
  → IPN webhook → validator API check (status, tran_id, amount)
      VALID → confirm (tx): status=confirmed · program.fund_raised += amount · receipt row · notify donor
      FAILED/CANCELLED → failed
Client "verifying" screen polls GET /donations/:id/status.
```

**Dev fallback** (no `SSLCOMMERZ_STORE_ID/PASSWORD`): `order` returns `{ dev: true }`
and `POST /api/donations/:id/dev-confirm` simulates a validated IPN through the
same confirm transaction. Blocked in production or once the gateway is configured.

## Public

| Endpoint | Notes |
|---|---|
| `GET /api/campaigns?closing_soon=true&page&limit` | Open programmes as campaign cards: `progress { raised, goal, pct, days_left }`, `donor_count`, + `general_fund` tile |
| `GET /api/campaigns/:id` | Detail + `recent_donations` (anonymised: "Sabrina C." or null for anonymous/guest) |
| `POST /api/donations/order` | Signed-in **or guest** (then `donor_name` + `donor_email` required → 400 `GUEST_DETAILS_REQUIRED`). Body: `program_id` (null = general fund), `amount` ≥ ৳10, `tip_amount`, `recurring`, `anonymous`. **201** `{ donation_id, tran_id, gateway_url | dev: true }` · 409 `CAMPAIGN_CLOSED` |
| `POST /api/donations/ipn` | Gateway webhook (form-encoded or JSON — `express.urlencoded` added). Never trusts the body: re-validates `val_id` against the validator API and checks `tran_id` + amount before confirming |
| `GET /api/donations/:id/status?tran_id=…` | Poll for the verifying screen; owner by token or guest by `tran_id` |

## Donor (any authenticated role)

| Endpoint | Notes |
|---|---|
| `GET /api/donations/mine` | History + active/paused `recurring` list |
| `POST /api/donations/:id/recurring/pause\|resume\|cancel` | Cancel is terminal; 404 when not an active recurring gift of yours |
| `GET /api/donations/:id/receipt` | Printable receipt JSON (no., donor, program, type, amounts, `tran_id`); 409 `NOT_CONFIRMED` before IPN |
| `GET /api/donations/impact` | Anonymised (FR-DN-07): `total_given`, `students_supported` (approved apps in funded programmes), `districts_reached`, `avg_cgpa_first_term → avg_cgpa_latest_term` |

## Provider / admin

`GET /api/providers/donations?program_id&from&to&format=json|csv` — summary
(`total_raised`, recurring vs one-time split) + rows (donor hidden when anonymous);
`format=csv` streams `donations.csv` (FR-DN-08).

## Known limits (deliberate)

- Recurring **charging** needs a gateway subscription agreement — out of sandbox
  scope. We store the monthly intent + pause/resume/cancel; the charge job joins
  the M5.9 disbursement work once sandbox keys exist (TASKS M5.3 note).
- Receipt is JSON for client-side print; PDF + QR belongs to M5.11.

## Migration

`010_donations.sql` — `donations`, `receipts`, `programs.fund_raised`.

## Happy path (dev, once DB is up)

1. `POST /api/donations/order` (guest, `amount: 5000, tip_amount: 250`) → 201 `dev: true`
2. `GET /api/donations/:id/status?tran_id=…` → `pending`
3. `POST /api/donations/:id/dev-confirm` → `{ confirmed: true, receipt_no }`; campaign `fund_raised` +5000 (tip excluded)
4. Repeat dev-confirm → `{ already: true }` (idempotency)
5. Signed-in donor: `mine`, `receipt`, `recurring/pause` → `resume` → `cancel`
6. Provider: `GET /api/providers/donations?format=csv`
