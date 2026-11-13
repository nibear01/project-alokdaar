# Document Vault & OCR — API Flows (M3 · FR-DV-01..05)

Owner: Hemel (22299367). Implements ARCHITECTURE §5.4 with one refinement: an OCR
mismatch first goes back to the **student** (`action_required`, Figma H1-4 "Check what
we read") before it enters the admin queue.

**Status pipeline**

```text
upload → processing ──(OCR clean)──────────→ pending ──→ verified
                    └─(OCR mismatch)→ action_required ─┘      └──→ rejected(reason)
rejected → re-upload (replace: true) → new document row, old one superseded
```

- One **active** document per (student, kind); replace/re-upload supersedes, history kept.
- Kinds: `birth_certificate` · `transcript` · `income_certificate` · `institution_id`.
- Files: PDF/JPG/PNG/WebP, max **5 MB** (Figma H1-2).
- Every transition is appended to `document_events` (Figma "Verification history").
- Verify/reject notifies the student through the `notify()` fan-out (in-app + email).

**Dev fallbacks (no keys needed to run the flow)**

| Service | With env keys | Without |
|---|---|---|
| Cloudinary | `upload-sign` returns presigned POST fields | returns `{ dev: true }`; register accepts `file_url` directly (blocked in production) |
| Google Vision (`GOOGLE_VISION_API_KEY`) | REST `DOCUMENT_TEXT_DETECTION` + regex field parse | deterministic fields from the student's own profile — all values match, **unless the file name contains `mismatch`**, which perturbs one field so the confirm flow and admin mismatch queue can be demoed |

---

## Student endpoints (role `student`)

### 1. Vault list

```http
GET /api/documents
Authorization: Bearer <accessToken>
```

**200**
```json
{
  "documents": [ { "id": "1", "kind": "transcript", "status": "verified", "mismatch": [], ... } ],
  "missing_kinds": ["institution_id"],
  "progress": { "verified": 3, "total": 4 }
}
```

### 2. Pre-sign an upload

```http
POST /api/documents/upload-sign
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `kind` | enum | yes | one of the 4 kinds |
| `file_name` | string | yes | 1–255 chars |
| `mime_type` | enum | yes | `application/pdf` \| `image/jpeg` \| `image/png` \| `image/webp` |
| `file_size_bytes` | int | yes | 1 … 5 242 880 |

**200 (configured)** → `{ "dev": false, "uploadUrl": "https://api.cloudinary.com/v1_1/<cloud>/auto/upload", "fields": { "api_key", "timestamp", "folder", "public_id", "signature" } }` — client POSTs the file straight to Cloudinary with those fields.
**200 (dev)** → `{ "dev": true, "message": "…use file_url…" }`

### 3. Register the uploaded file (starts OCR)

```http
POST /api/documents
```

Body = upload-sign fields **plus** `cloudinary_public_id` (or `file_url` in dev) and
optional `replace: true`.

| Status | `code` | When |
|---|---|---|
| **201** | — | Row created, `status: "processing"`, OCR kicked off async |
| 400 | `VALIDATION_ERROR` | Bad body |
| 400 | `CLOUDINARY_REQUIRED` | `file_url` used while Cloudinary configured / in production |
| 409 | `DOCUMENT_EXISTS` | Active doc of this kind exists and `replace` not set (`details.existing_id`) |

OCR completes within seconds: document moves to `pending` (clean) or
`action_required` (mismatch) — poll `GET /api/documents/:id` or refresh the vault.
If the OCR provider errors, the document still moves to `pending` with an
`ocr_failed` event — admin reviews manually; the pipeline never sticks.

### 4. Document detail + history

```http
GET /api/documents/:id
```

**200**
```json
{
  "document": {
    "id": "5", "kind": "income_certificate", "status": "action_required",
    "ocr_provider": "dev",
    "ocr_fields": { "full_name": "Nusrat Jahan", "monthly_income": 9500 },
    "mismatch": [
      { "field": "monthly_income", "document_value": 9500, "profile_value": 7000, "resolution": null }
    ], ...
  },
  "events": [ { "from_status": null, "to_status": "processing", "note": "uploaded", ... } ]
}
```
404 `NOT_FOUND` · 403 `FORBIDDEN` (not yours). Admins get an extra `profile` object.

### 5. Confirm mismatches (H1-4)

```http
POST /api/documents/:id/confirm
{ "resolutions": { "monthly_income": "document" } }
```

Every mismatched field needs `"document"` or `"profile"`. Moves
`action_required → pending`. The profile is **never silently rewritten** — the choice
is recorded on the mismatch array and shown to the admin (RULES §2 Documents).

| Status | `code` | When |
|---|---|---|
| **200** | — | Now `pending` |
| 400 | `UNRESOLVED_FIELDS` | A mismatched field was left out (`details.fields`) |
| 409 | `INVALID_STATUS` | Document is not `action_required` |

### 6. Replace / re-upload after reject

Same as flow 2 + 3 with `replace: true`. Old row gets `superseded_at`, new row starts
at `processing`. Old Cloudinary asset is destroyed best-effort.

### 7. Delete

```http
DELETE /api/documents/:id
```
Soft delete (`deleted_at`); history and events remain. **200** `{ "deleted": true, "id": "5" }`.

---

## Admin endpoints (role `admin`)

### 8. Verification queue (H1-8)

```http
GET /api/documents/queue?status=pending&kind=transcript&mismatch=true&search=nusrat&sort=oldest&page=1&limit=20
```

All filters optional; default = `pending` + `action_required`, oldest first.

**200**
```json
{
  "items": [
    { "id": "5", "kind": "income_certificate", "status": "pending", "mismatch_count": 1,
      "student": { "id": "7", "name": "Nusrat Jahan", "email": "nusrat@example.com" },
      "created_at": "..." }
  ],
  "counts": { "pending": 24, "mismatched": 6, "overdue_48h": 3, "verified_today": 17 },
  "page": 1, "limit": 20, "total": 24
}
```

### 9. Verify / Reject (H1-9)

```http
POST /api/documents/:id/verify            → 200 { document }   (no body)
POST /api/documents/:id/reject            → 200 { document }
{ "reason": "Scan too dark to read the officer's seal." }
```

`reason` is **required** on reject (5–1000 chars). Both notify the student and append
an event. 409 `INVALID_STATUS` when the document is not `pending`/`action_required`.

---

## Happy-path order (Postman)

1. Login as **student** → Bearer token
2. `POST /api/documents/upload-sign` → (dev: `{dev:true}`)
3. `POST /api/documents` `{ kind, file_name: "income-mismatch.jpg", mime_type: "image/jpeg", file_size_bytes: 120000, file_url: "https://example.com/x.jpg" }` → 201 `processing`
4. `GET /api/documents/:id` → `action_required` with one mismatch (dev trick: file name contains `mismatch`)
5. `POST /api/documents/:id/confirm` `{ "resolutions": { "monthly_income": "document" } }` → `pending`
6. Login as **admin** → `GET /api/documents/queue` → see it with `mismatch_count: 1`
7. `POST /api/documents/:id/verify` → `verified`; student gets a notification
8. Repeat 3 with `replace: true` and a clean file name → straight to `pending`

## Error codes added by this module

| `code` | Meaning |
|---|---|
| `DOCUMENT_EXISTS` | Active document of that kind already in the vault (use `replace: true`) |
| `CLOUDINARY_REQUIRED` | Direct `file_url` outside dev fallback |
| `UNRESOLVED_FIELDS` | Confirm left a mismatched field without a resolution |
| `INVALID_STATUS` | Action not allowed from the document's current status |
