# Impact Aggregates, Analytics & Dropout Risk — API Flows (M6.1/M6.8 base · M6.11 · FR-IM-01..06, FR-M3-05)

Owner: Hemel (22299367). M6.1/M6.8 are Naved's tasks on the board — these are the
backend APIs; coordinate before the map/analytics UI. Adds `student_profiles`
(district/upazila/level/institution), which also unblocks Rafi's M2.9.

## Student profile (role `student`)

| Endpoint | Notes |
|---|---|
| `GET /api/me/profile` | users + profile + latest academic/household snapshot |
| `PUT /api/me/profile` | Upsert any of `district`, `upazila`, `education_level`, `institution`; empty body → 400 |

## Impact (tile map data)

| Endpoint | Role | Notes |
|---|---|---|
| `GET /api/impact/public` | none | Landing headline: `funds_raised`, `funds_committed`, `students_supported`, `unfunded_eligible`, `districts_reached` |
| `GET /api/impact/summary?program_id&provider_id&from&to&format=csv` | provider/admin | `by_district` rows: students_supported, funds_committed, funds_raised, unfunded_eligible, donations. Providers are auto-scoped to their own programmes. `format=csv` downloads `impact-by-district.csv` |
| `GET /api/impact/districts/:district` | provider/admin | Upazila breakdown + programmes active in the district |
| `GET /api/analytics/overview` | provider/admin | Application status funnel, last-8-weeks donations, programme funding progress (M6.8 base; report configs + PDF later) |

**District resolution:** student's `student_profiles.district`, falling back to the
programme's `location_district`, else `Unknown`. **funds_disbursed** joins with the
M5.9 ledger; until then `funds_committed` (approved × amount_per_student) is the proxy —
labelled as such so the UI never claims money moved that didn't.

## Dropout risk (role `provider`/`admin`)

Scoring is pure (`modules/dropout/scoring.js`, unit-tested): CGPA drop between the
last two terms (≥0.3 → 35 pts, ≥0.15 → 20), latest attendance (<75% → 25, <85% → 10),
household income per member (<৳1,500 → 25, <৳3,000 → 15), latest CGPA <2.5 → 15.
Score ≥60 `high`, ≥30 `medium`, else `low`. Factors are stored on the case for the UI.

| Endpoint | Notes |
|---|---|
| `POST /api/dropout/recompute` `{ student_id? }` | Re-scores all students with academic records (or one); upserts one case per student. Returns `{ scored, high, medium, low }` |
| `GET /api/dropout/cases?level&status&page&limit` | Worst first |
| `GET /api/dropout/cases/:id` | Case + factors + academic trend + household + notes + `recommended_programs` (open, district-matched, not already applied) |
| `POST /api/dropout/cases/:id/notes` `{ body }` | Follow-up note (FR-M3-05) |
| `POST /api/dropout/cases/:id/status` `{ status: open\|monitoring\|resolved }` | |
| `POST /api/dropout/cases/:id/recommend` | Sends the student their open matches via notify() (72h dedup) |

## Migration

`011_impact_dropout.sql` — `student_profiles`, `dropout_cases` (one per student,
re-scored in place), `dropout_notes`.

## Happy path (once DB is up)

1. Student: `PUT /api/me/profile { district: "Kurigram", upazila: "Sadar" }`
2. Seed/enter 2+ academic terms with a CGPA drop → provider: `POST /api/dropout/recompute` → `{ high: 1, … }`
3. `GET /api/dropout/cases?level=high` → open the case → factors + trend + recommendations
4. `POST …/notes`, `POST …/recommend` (student gets in-app/email/SMS), `POST …/status { monitoring }`
5. `GET /api/impact/summary` → Kurigram row reflects the approved apps + confirmed donations; `format=csv` downloads
6. `GET /api/impact/public` without a token → headline numbers
