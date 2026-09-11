# Morali backend

Production-MVP NestJS API for the Morali teacher marketplace. React owns the
Supabase Auth UI and session lifecycle; this API verifies Supabase access
tokens and owns application authorization, business logic, PostgreSQL access,
and private Storage operations.

## Architecture

```text
React -> Supabase Auth -> Bearer token -> NestJS -> Supabase Data/Auth/Storage
```

The API is protected by default. `@Public()` is limited to health, taxonomy,
published teacher discovery, public teacher media, reviews, availability, and
anonymous match preview. Student, teacher, and admin mutations have explicit
profile-backed role policies.

Application modules follow:

```text
Controller -> Service / policy -> Repository -> Supabase
```

Multi-row invariants are implemented in PostgreSQL functions and deferred
triggers. Browser database roles have no grants on application tables or
business RPCs; only the NestJS service client accesses them.

## Requirements

- Node.js 24 or a compatible current LTS release
- npm
- A linked Supabase project
- Docker Desktop only when running the local Supabase stack

## Configuration

Create `.env` from `.env.example` and set:

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port, default `3000` |
| `CORS_ORIGIN` | Comma-separated allowed React origins |
| `TRUST_PROXY` | Set `true` behind a trusted reverse proxy |
| `RATE_LIMIT_WINDOW_MS` | Global rate-limit window |
| `RATE_LIMIT_MAX` | Requests allowed per IP/window |
| `SUPABASE_URL` | Hosted project API URL |
| `SUPABASE_PUBLISHABLE_KEY` | Public key used by Auth clients/tests |
| `SUPABASE_SECRET_KEY` | Server-only service key |

`SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`, and
`SUPABASE_DB_PASSWORD` are provisioning-only values. Never expose the secret
key, access token, or database password to React.

## Install And Run

```bash
npm install
npm run start:dev
```

The API listens at `http://localhost:3000/api` by default. Production startup:

```bash
npm run build
npm run start:prod
```

Runtime hardening includes Helmet headers, request IDs, global rate limiting,
structured HTTP logs, validated DTOs/environment values, database health
checks, CORS allowlisting, and graceful shutdown hooks.

## API Surface

Public routes include:

```text
GET  /api/health
GET  /api/subjects
GET  /api/levels
GET  /api/cities
GET  /api/teachers
GET  /api/teachers/:slug
GET  /api/teachers/:slug/availability
GET  /api/teachers/:slug/reviews
GET  /api/storage/teachers/:slug/avatar-url
POST /api/matching/preview
```

Authenticated areas include user profiles and deletion, teacher onboarding and
publication, availability, requests and persisted matches, inquiries,
favorites, verified reviews, notifications, private Storage URLs, and admin
teacher/review moderation. See `BACKEND_PLAN.md` for the complete route list
and `SUPABASE.md` for database contracts and operations.

## Validation

```bash
npm run build
npm run lint
npm test
npm run test:e2e
npm audit
```

`test/marketplace.e2e-spec.ts` uses disposable hosted Supabase Auth users and
exercises role separation, teacher claim/consent, private Storage, onboarding,
publication, matching, inquiry response, review aggregates, notifications,
admin visibility, and account deletion. It requires valid hosted credentials
in `.env` and changes disposable hosted data.

Run the hosted schema verification query with:

```powershell
Get-Content .\supabase\verify.sql -Raw |
  npx supabase db query --linked --project-ref $env:SUPABASE_PROJECT_REF
```

The expected deployment has 15 application tables, eight enums, 15 business
RPCs, nine business triggers, two private buckets, no browser-role table/RPC
grants, and ten recorded migrations.

## Database Changes

SQL files under `supabase/migrations/` are the source of truth. Add only
forward migrations; never edit an already-applied migration. After applying a
change, run `supabase/verify.sql`, regenerate `src/database/database.types.ts`,
and execute the complete validation commands above.

See `SUPABASE.md` for local and hosted migration workflows, the Management API
fallback used when PostgreSQL ports are unavailable, security rules, and
recovery procedures.