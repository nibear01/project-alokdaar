# Alokdaar — Education Aid Disbursement System

CSE471 course project monorepo. Docs live in [`docs/`](docs/) — start with [`docs/PRD.md`](docs/PRD.md).

## Prerequisites

- Node.js 20+
- A [Neon](https://neon.tech) Postgres database

## Setup

```bash
# 1. install (root workspaces: server + client)
npm install

# 2. env files — copy examples and fill real values
copy server\.env.example server\.env     # Windows
copy client\.env.example client\.env
# macOS/Linux: cp server/.env.example server/.env && cp client/.env.example client/.env

# 3. set DATABASE_URL in server/.env to your Neon connection string
#    (use the pooled -pooler URL for the app)

# 4. run migrations against Neon
npm run db:migrate

# 5. start API (4000) + Vite (5173) together
npm run dev
```

| Command | What it does |
|---|---|
| `npm run dev` | server + client together (concurrently) |
| `npm run dev:server` | API only → http://localhost:4000 |
| `npm run dev:client` | Vite only → http://localhost:5173 |
| `npm run db:migrate` | apply `server/src/db/migrations/*.sql` once each |
| `npm run db:seed` | demo data (placeholder) |
| `npm run build` | build client (server runs from source) |

Health check: `GET http://localhost:4000/api/health` → `{ ok, db, service }`.

## Layout

```
/
├── package.json      # workspaces + concurrently
├── docs/             # PRD, ARCHITECTURE, RULES, DESIGN, TASKS, MEMORY
├── documents/        # assignment sources + Figma board exports
├── server/           # Express + pg (Neon)
│   ├── .env.example
│   └── src/
└── client/           # React + Vite + Tailwind
    ├── .env.example
    └── src/
```

## Rules for the team

- Never commit `.env` — only `*.env.example`.
- Use Neon **pooled** URL in `DATABASE_URL`.
- FR IDs and conventions: see [`docs/RULES.md`](docs/RULES.md).
