# AI Assistant & Help Desk — API Flows (M6.12–M6.15 · FR-AI-01..04)

Owner: Hemel (22299367). Gemini behind `services/gemini.js` (timeout, REST, key
`GEMINI_API_KEY`); without a key the assistant and reviewer produce deterministic
answers from the SAME live retrieval, so every flow runs in dev.

## Assistant (FR-AI-01, H2-1)

`POST /api/assistant/chat` (any role) — `{ message, history?, locale: en|bn }` →
`{ reply, provider: gemini|dev, programs: [cards], suggest_ticket }`.
Retrieval before answering: open programmes matching the question + the student's
own document/application counts ("answer before ticket creation", ARCH §5.8).

## Tickets (FR-AI-02/03, H2-2..H2-6)

| Endpoint | Role | Notes |
|---|---|---|
| `POST /api/tickets` | any | category/subject/body (+ priority, application_id, `chat_transcript` from the assistant, attachments) → 201, notify |
| `GET /api/tickets/mine?status` | any | H2-3 tabs |
| `GET /api/tickets/:id` | owner/admin | Thread; **internal notes hidden from the owner** |
| `POST /api/tickets/:id/messages` | owner/admin | `internal: true` admin-only; admin reply notifies; owner reply on `resolved` **reopens**; `closed` → 409 `TICKET_CLOSED` |
| `GET /api/tickets?status&category&priority&assignee=unassigned\|me` | admin | Inbox + `counts { open, in_progress, overdue(48h), avg_rating }` |
| `POST /api/tickets/:id/assign` | admin | Empty body = assign to me; open → in_progress |
| `POST /api/tickets/:id/status` | admin | resolve notifies + requests a rating |
| `POST /api/tickets/:id/rate` | owner | 1–5 + comment, only after resolve (409 `NOT_RATEABLE`) |

## Reviewer panel (FR-AI-04, H2-7 → N1-3)

`GET /api/applications/:id/ai-summary[?refresh=true]` (provider-own/admin) —
≤3-line summary + originality `{ flagged, confidence, note, advisory }`, cached in
`applications.ai_summary`. Dev heuristic: coaching-template phrase match + word
repetition. The advisory string repeats the RULES line: never reject on this alone.

## Migration

`014_tickets_ai.sql` — `tickets`, `ticket_messages` (internal flag), `applications.ai_summary`.

## Verified on Neon (2026-11-14, 7-stage E2E)

chat (dev provider, programme cards) → escalate with transcript → mine → admin
inbox/filters/assign-to-me → reply + internal note hidden from owner → resolve →
rate 4/5 → owner reply reopens → close blocks replies → reviewer summary generated,
cached on second read, 403 for students.
