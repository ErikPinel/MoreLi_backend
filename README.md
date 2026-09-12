# Morali backend

Current no-payment launch scope, outbox operations, Vercel configuration, verified
tests, and remaining gates are in [PRODUCTION_ROLLOUT.md](PRODUCTION_ROLLOUT.md)
and [the governing plan](../PRODUCTION_MVP_PLAN.md). Public launch is not yet certified.

Production-MVP NestJS API for the Morali teacher marketplace. React owns the
Clerk UI and session lifecycle; this API verifies Clerk access tokens, maps
external subjects to internal UUID profiles, and owns application authorization,
business logic, PostgreSQL access, and private Storage operations. Legacy
Supabase access tokens remain accepted during the transition.

## Architecture

```text
React -> Clerk -> Bearer token -> NestJS -> Supabase Data/Storage
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
| `PORT` | HTTP port, default `5146` |
| `CORS_ORIGIN` | Comma-separated allowed React origins |
| `TRUST_PROXY` | Set `true` behind a trusted reverse proxy |
| `RATE_LIMIT_WINDOW_MS` | Global rate-limit window |
| `RATE_LIMIT_MAX` | Requests allowed per IP/window |
| `CLERK_ISSUER` | Trusted Clerk JWT issuer |
| `CLERK_SECRET_KEY` | Server-only key for verified primary email and account deletion |
| `SUPABASE_URL` | Hosted project API URL |
| `SUPABASE_PUBLISHABLE_KEY` | Public key used by Auth clients/tests |
| `SUPABASE_SECRET_KEY` | Server-only service key |
| `PUBLIC_APP_URL` | Public React origin used in transactional links |
| `BREVO_API_KEY` | Server-only Brevo transactional email API key |
| `BREVO_SENDER_EMAIL` | Sender verified in Brevo; required in production |
| `BREVO_SENDER_NAME` | Transactional sender display name |
| `ADMIN_NOTIFICATION_EMAIL` | Recipient for tutor-review notices |
| `EMAIL_APPROVAL_SECRET` | Random 32+ character secret used to sign expiring approval links |

`SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`, and
`SUPABASE_DB_PASSWORD` are provisioning-only values. Never expose the secret
key, access token, or database password to React.

Brevo email is optional in development and logs a warning when disabled.
Production startup rejects incomplete email configuration. Enter secrets directly
in the deployment secret store, verify the sender/domain in Brevo, and never put
the API key or approval secret in a client environment variable.

## Install And Run

```bash
npm install
npm run start:dev
```

The API listens at `http://localhost:5146/api` by default. Production startup:

```bash
npm run build
npm run start:prod
```

Runtime hardening includes Helmet headers, request IDs, global rate limiting,
structured HTTP logs, validated DTOs/environment values, database health
checks, CORS allowlisting, and graceful shutdown hooks.

### Automatic Email Delivery

Starting the API with `npm run start:dev` or `npm run start:prod` also starts email
delivery. No cron, cron secret, or separate worker command is required. Configure
`BREVO_API_KEY` and a verified `BREVO_SENDER_EMAIL` in the server environment.

API mutations queue emails transactionally. The server processes a batch of up to
10 immediately on startup, then checks again five seconds after each batch finishes.
Existing pending messages are included. Database leases and retry backoff remain in
place; shutdown waits for the active batch. Missing development email configuration
disables processing without consuming delivery attempts. Logs contain counts only.

`npm run email:check` remains a non-sending diagnostic after building. Standalone
worker commands are optional maintenance tools, not required for normal operation.
Application contexts used by tests and maintenance do not auto-start delivery.

Deploy this API as a continuously running Node process. Serverless platforms such as
Vercel do not guarantee background timers; the existing Vercel scaffold alone is not
a supported deployment for reliable automatic delivery. No Vercel Cron is configured.
`sent` means Brevo accepted the request, not verified inbox delivery; verify delivery
and bounce events in Brevo as well.

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
GET  /api/teacher-approvals/preview
POST /api/matching/preview
```

Authenticated areas include user profiles and deletion, teacher onboarding and
admin-only `POST /api/teacher-approvals/approve`,
review submission, availability, requests and persisted matches, scheduled lesson inquiries,
favorites, verified reviews, notifications, private Storage URLs, and admin
teacher/review moderation. See `BACKEND_PLAN.md` for the complete route list
and `SUPABASE.md` for database contracts and operations.

Administrators can bulk upsert either catalog without a schema migration:

```http
POST /api/admin/professions/bulk
Authorization: Bearer <admin-clerk-token>
Content-Type: application/json

{
  "professions": [{ "name_he": "אדריכלות - אקדמיה", "slug": "profession-725fde80d0f590f3812cb36b71fa3777" }]
}
```

For cities, use `POST /api/admin/cities/bulk` with
`{"cities":[{"name_he":"ירושלים","slug":"jerusalem"}]}`.
Both routes require an authenticated administrator. The existing `/replace`
paths remain aliases, but now use these bulk-upsert semantics.
Catalog routes accept JSON bodies up to 2 MB; other routes retain the default limit.

Each body contains 1-2,000 items with only `name_he` and `slug`. Names and slugs
must be unique; slugs use lowercase ASCII letters, digits, and hyphens.
Supabase upserts by slug in one statement per catalog and returns
`{"updated_count":1174}` (the number of supplied items). Existing IDs and city
coordinates are preserved. Omitted rows are neither deleted nor deactivated.
Reuse existing slugs when changing display names to preserve references.

The client catalogs are `../client/src/data/cities.json` and
`../client/src/data/professions.json`. Regenerate them with `npm run catalogs:build`
in the client folder, using only the local city CSV and subject dump. Deploy
updated client JSON alongside any catalog changes.

Client selectors display `name_he` and submit `subjectSlug`, `citySlug`, or
`citySlugs` (tutor service areas). Tutor subjects use
`{"subjects":[{"subjectSlug":"..."}]}`. NestJS resolves slugs against active
Supabase rows before searches or writes; unknown/inactive slugs are rejected.
Database foreign keys remain numeric. Legacy ID-based callers remain supported,
but conflicting ID/slug values are rejected.

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

The expected deployment has 16 application tables, eight enums, 17 business
RPCs plus the Clerk identity resolver, nine business triggers, two private
buckets, no browser-role table/RPC grants, and 17 recorded migrations.

## Database Changes

SQL files under `supabase/migrations/` are the source of truth. Add only
forward migrations; never edit an already-applied migration. After applying a
change, run `supabase/verify.sql`, regenerate `src/database/database.types.ts`,
and execute the complete validation commands above.

See `SUPABASE.md` for local and hosted migration workflows, the Management API
fallback used when PostgreSQL ports are unavailable, security rules, and
recovery procedures.