# API Flow — Ranking Weights & Scoring (M4.3)

Module: `server/src/modules/ranking/` · FR-RS-02
Base: `/api/programs/:id/weights` · Roles: `provider` (own), `admin`

**Formula** (config-driven, no hardcoded constants):

```
score = (w_merit · merit + w_need · need + w_attendance · attendance) / 100
```

- Weights are integers **summing to exactly 100** (zod + DB CHECK).
- Scoring params live per-program in `scoring_config` JSONB:
  - `max_cgpa` (default 4.0) — merit = cgpa / max_cgpa × 100
  - `need_reference_income` (default 30000) — need = clamp(1 − income/ref, 0, 1) × 100
  - `attendance_max` (default 100) — attendance = value / attendance_max × 100
- Every ranked row persists `score`, `rank`, `score_breakdown` (per-part raw, weight, points).

---

## 1. Get weights + scoring config

```http
GET /api/programs/:id/weights
```

**200**
```json
{
  "weights": { "merit": 50, "need": 30, "attendance": 20 },
  "scoring": { "max_cgpa": 4.0, "need_reference_income": 30000, "attendance_max": 100 }
}
```

| Case | Status | `code` |
|---|---|---|
| Not found | 404 | `PROGRAM_NOT_FOUND` |
| Not owner | 403 | `FORBIDDEN` |
| Student | 403 | `FORBIDDEN` |

---

## 2. Save weights + re-rank (PUT)

```http
PUT /api/programs/:id/weights
Content-Type: application/json

{
  "merit": 50,
  "need": 30,
  "attendance": 20,
  "scoring": {                    // optional; omit → keep current config
    "max_cgpa": 3.3,
    "need_reference_income": 25000,
    "attendance_max": 100
  }
}
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `merit` `need` `attendance` | int | **yes** | 0–100, **Σ = 100** |
| `scoring` | object | no | `.strict()` — unknown keys rejected; all members optional |

**200**
```json
{
  "weights": { "merit": 50, "need": 30, "attendance": 20 },
  "scoring": { "max_cgpa": 3.3, "...": "..." },
  "reranked": 3,
  "rankings": [
    { "application_id": 1, "rank": 1, "score": 68.4,
      "score_breakdown": {
        "total": 68.4,
        "merit": { "raw": 3.8, "weight": 50, "points": 47.5 },
        "need":  { "raw": 0.6, "weight": 30, "points": 18.0 },
        "attendance": { "raw": 92, "weight": 20, "points": 18.4 }
      }
    }
  ]
}
```

| Case | Status | `code` |
|---|---|---|
| Σ ≠ 100 | 400 | `WEIGHTS_SUM` |
| Validation (range/strict scoring) | 400 | `VALIDATION_ERROR` + `details` |
| Not owner | 403 | `FORBIDDEN` |

**Server-side notes**
- Save and re-rank run in **one transaction** — stored scores/breakdowns always match the weights that produced them (RULES: every displayed rank has a stored breakdown).
- Re-rank covers all non-withdrawn applications of the program; queue/`GET /:id/applications` reads these persisted values.

---

## Example: hand-check one score

merit=50, need=30, attendance=20; student cgpa 3.8 / max 4.0, income 12000 / ref 30000, attendance 92:

```
merit     = 3.8/4.0 × 100 = 95  → 95 × 0.50 = 47.5
need      = (1 − 12000/30000) = 0.6 → 60 × 0.30 = 18.0
attendance= 92/100 × 100 = 92    → 92 × 0.20 = 18.4
total     = 83.9
```
