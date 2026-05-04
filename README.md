# Congress API

A full-stack application for exploring U.S. congressional activity. Pairs a Node.js/Express backend that proxies and caches Congress.gov data with a vanilla-JavaScript dashboard frontend ("Legal Ease") for browsing bills, tracking representatives, and asking questions about legislation through LLMs.

## Components

- **`backend/`** — Node.js/Express API server. Proxies Congress.gov, persists data in PostgreSQL, exposes a multi-provider LLM chat layer (OpenAI / Anthropic / Google / Ollama), and serves Swagger/OpenAPI docs at `/api-docs`.
- **`frontend-v2/`** — Vanilla-JS dashboard. Three-column layout: Learn modules + upcoming hearings, bill detail viewer, and tracking / representatives / all-bills browser. Pure HTML + CSS + ES2017 JavaScript with no build step.
- **`sync-service/`** — Background ingestion jobs that pull from Congress.gov and populate the database (bills, members, committee reports, hearings, the Congressional Record).
- **`mcp-server/`** — Model Context Protocol server that exposes the database to LLM tools.
- **`migrations/`** + **`backend/migrations/`** — SQL migrations for the database schema.

## Tech stack

- **Runtime:** Node.js 18+ (see `.nvmrc`)
- **Database:** PostgreSQL 14+
- **Backend libs:** Express, `pg`, `bcrypt`, `jsonwebtoken`, `helmet`, `winston`, `joi`
- **LLM SDKs:** `openai`, `@anthropic-ai/sdk`, `@google/generative-ai`, `ollama`
- **Frontend libs (CDN):** DOMPurify, Marked
- **Tests:** Jest + Supertest

## Prerequisites

- Node.js ≥ 18
- npm
- PostgreSQL ≥ 14
- A Congress.gov API key — request one at https://api.congress.gov/sign-up/
- (Optional) API keys for any of: OpenAI, Anthropic, Google Generative AI, Ollama

## Getting started

### 1. Clone and install

```bash
git clone <this-repo>
cd congress-api
(cd backend && npm install)
(cd sync-service && npm install)
(cd mcp-server && npm install)
```

### 2. Configure environment

```bash
cp backend/.env.example backend/.env
# edit backend/.env and set:
#   CONGRESS_API_KEY=<your key>
#   DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
#   JWT_SECRET=<a long random string>
#   OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY (optional)
```

### 3. Initialize the database

```bash
createdb congress_api
psql -d congress_api -f schema.sql
```

`schema.sql` is the canonical, generated-from-production schema. It supersedes
the historical migration files in `backend/migrations/`, `migrations/`, and
`database/migrations/` — those are kept for reference but are not the recommended
setup path.

If you want the multi-role security model (separate `congress_admin`,
`congress_sync_writer`, `congress_api_backend` Postgres users), follow
`migrations/README.md` after the schema is loaded. Otherwise, a single user
with full access to the `congress_api` database is sufficient.

### 4. Run the backend

```bash
cd backend
npm run dev          # nodemon, port 3000 by default
# or: npm start       (production)
```

### 5. Serve the frontend

The frontend is static HTML/CSS/JS — any web server will do. For local development:

```bash
cd frontend-v2
python3 serve.py     # serves on http://localhost:8000
```

The frontend assumes the backend is reachable at `/api/...`. In dev, configure your web server to proxy `/api` to `http://localhost:3000` (see `congress-api.conf.example` for an Apache vhost example, or use any reverse proxy).

### 6. (Optional) Start the sync service

```bash
cd sync-service
npm start
```

## Project layout

```
.
├── backend/                # Node.js/Express API server
│   ├── routes/             # HTTP route handlers
│   ├── services/           # Database, Congress.gov client, chat orchestration
│   ├── middleware/         # Auth, validation, rate limiting
│   ├── migrations/         # Schema migrations + runner
│   └── tests/
├── frontend-v2/            # Static dashboard frontend
│   ├── css/
│   ├── js/
│   │   ├── components/     # UI components (one file per component)
│   │   ├── pages/          # Page-level controllers
│   │   ├── services/       # Frontend service layer
│   │   └── utils/
│   └── index.html
├── sync-service/           # Background data ingestion
│   ├── syncers/            # Per-resource sync logic
│   └── lib/
├── mcp-server/             # MCP tool server for LLMs
├── migrations/             # Cross-cutting database migrations
├── database/               # Schema dumps and DB utility scripts
├── scripts/                # Operational scripts
└── docs/                   # Public-facing documentation
```

## Development

```bash
cd backend
npm test                 # run the Jest test suite
npm run lint             # ESLint
npm run format           # Prettier
```

Backend deploy templates:

- `congress-api.conf.example` — Apache vhost for frontend + `/api` proxy
- `backend/congress-api-backend.service.example` — systemd unit for the Node.js process

Copy each `.example` file, edit the paths and user/group, and place where your distro expects.

## Security

- Never commit `.env` files. The `.gitignore` excludes them, including environment-specific variants (`.env.production`, `.env.local`, etc.).
- Rotate API keys if you suspect a leak.
- The backend uses `helmet`, parameterized SQL, JWT auth, and per-route rate limiting — keep these in place when extending.

## License

See [LICENSE](LICENSE).
