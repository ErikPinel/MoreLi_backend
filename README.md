# Morali backend

## Single Public Sitemap

`GET /api/seo/sitemap.xml` is an anonymous XML `urlset` containing the canonical
public pages and published tutor URLs on `https://morehli.co.il`. The client
exposes it at `/sitemap.xml`, before static filesystem routing. There is no sitemap
index or separate teacher/page sitemap. Deploy this endpoint before the client.
Keep `PUBLIC_PAGE_PATHS` in the SEO service in sync with the client's public
sitemap manifest and page metadata.

Only `published` teacher profiles are queried, using stable ID pagination in
500-row batches; no contact records, drafts or private account URLs are exported.
Slugs are URL-encoded and no unreliable `lastmod` dates are fabricated. Responses
may be CDN-cached for five minutes. Database errors are surfaced instead of
returning an empty or partial successful sitemap. The protocol's 50,000-URL limit
includes both public pages and tutors; exceeding it explicitly fails with 503.

Public business support defaults to `morehlisrael@gmail.com` / `0503939008`.
Update existing `SUPPORT_EMAIL`/`SUPPORT_PHONE` production overrides accordingly.
Admin notification recipients and the verified Resend sender are separate settings
and are not changed by public contact updates.

Current manual-access product scope, outbox operations, deployment configuration, verified
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
profile-backed role policies. A `teacher` profile is added on top of a student
account, so student endpoints (favorites, requests, matching, inquiry creation,
student reviews) accept both `student` and `teacher`; teacher-only actions stay
teacher-only. Self-use is blocked: favorites rejects your own teacher profile,
matching excludes it, `create_inquiry` rejects self-inquiries, and the review-author
guard independently rejects self-ratings.

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
| `TRUST_PROXY` | Set `true` on Vercel or behind one trusted reverse proxy; keep `false` for direct local access |
| `RATE_LIMIT_WINDOW_MS` | Global rate-limit window |
| `RATE_LIMIT_MAX` | Requests allowed per IP/window |
| `CLERK_ISSUER` | Trusted Clerk JWT issuer |
| `CLERK_SECRET_KEY` | Server-only key for verified primary email and account deletion |
| `CLERK_ALLOW_DEVELOPMENT_INSTANCE` | Explicit hosted-MVP opt-in for a development issuer/test secret; defaults to `false` |
| `SUPABASE_URL` | Hosted project API URL |
| `SUPABASE_PUBLISHABLE_KEY` | Public key used by Auth clients/tests |
| `SUPABASE_SECRET_KEY` | Server-only service key |
| `PUBLIC_APP_URL` | Public React origin used in transactional links |
| `RESEND_API_KEY` | Server-only Resend API key; never use a `VITE_*` variable |
| `RESEND_FROM_EMAIL` | Sender on your own verified Resend domain; required in production |
| `RESEND_FROM_NAME` | Transactional sender display name, default MoreLi |
| `RESEND_WEBHOOK_SECRET` | Resend signing secret for verified delivery receipts; required in production |
| `SUPPORT_EMAIL`, `SUPPORT_PHONE` | Public support/Bit contact; defaults morehlisrael@gmail.com and 0503939008. Update existing production overrides when changing public contact details. |
| `ADMIN_NOTIFICATION_EMAIL` | Recipient for tutor-review notices |
| `EMAIL_APPROVAL_SECRET` | Random 32+ character secret used to sign expiring approval links |

`SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`, and
`SUPABASE_DB_PASSWORD` are provisioning-only values. Never expose the secret
key, access token, or database password to React.

Resend email is optional in development and logs a warning when disabled.
Production startup rejects incomplete email configuration. Enter secrets directly
in the deployment secret store, verify the sender/domain in Resend, and never put
the API key or approval secret in a client environment variable.

### Initial Vercel MVP With The Existing Clerk Instance

Keep the existing backend Clerk secret, Supabase credentials, and Resend settings.
For the stable frontend deployment, set these backend Vercel runtime variables:

```dotenv
PUBLIC_APP_URL=https://moreli-client.vercel.app
CORS_ORIGIN=https://moreli-client.vercel.app
TRUST_PROXY=true
CLERK_ISSUER=https://noted-caribou-6267.clerk.accounts.dev
CLERK_ALLOW_DEVELOPMENT_INSTANCE=true
```

Keep `NODE_ENV=production`. The explicit opt-in permits a public HTTPS Clerk
development issuer with its `sk_test_` secret. It does not relax the application,
Supabase, or CORS HTTPS checks, email requirements, JWT verification, or access
control. Use the stable frontend URL, not an individual deployment URL: allowed
origins also restrict the Clerk token's authorized party. Redeploy the backend
after updating its environment; `/api/health` must succeed before integration
is considered working.

On Vercel, `TRUST_PROXY=true` configures Express to trust exactly one proxy hop,
not every forwarded address. This lets the rate limiter use the client address
from `X-Forwarded-For` rather than sharing an allowance across the proxy's users.
It also resolves the `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` and
`ERR_ERL_FORWARDED_HEADER` diagnostics when both proxy headers are present.
Keep it `false` on a directly exposed server; a different proxy topology needs
its own trust configuration. Rate-limit counters remain per application instance,
not shared across Vercel instances.

Invalid production URL errors identify the affected environment variable names
without logging their values. If the dashboard shows valid values but startup
still fails, check the current backend Production deployment: environment edits
do not update existing deployments, and changing a local template has no effect.

### Clerk Production Configuration

Create a production instance in the [Clerk Dashboard](https://dashboard.clerk.com)
following the [production deployment guide](https://clerk.com/docs/guides/development/deployment/production).
Clerk requires a domain you own, DNS configuration, and your own OAuth provider
credentials for any enabled social sign-in providers. Development keys cannot be
promoted by changing their prefixes.

- Client Vercel project: `VITE_CLERK_PUBLISHABLE_KEY=pk_live_...`.
- Backend Vercel project: matching `CLERK_SECRET_KEY=sk_live_...` and
  `CLERK_ISSUER` set to the production instance's actual issuer.
- Set `CLERK_ALLOW_DEVELOPMENT_INSTANCE=false` on both projects to remove the
  temporary development-instance opt-in.
- Backend `PUBLIC_APP_URL` and `CORS_ORIGIN`: the final frontend HTTPS URL/origin.
- Supabase credentials: backend only; the client does not require Supabase
  environment variables or a browser Supabase SDK.

Keep development credentials in local ignored files and production credentials
in the respective hosting secret stores. Redeploy both projects after updating
their settings, then verify sign-in/profile synchronization and provision the
intended production administrator. Do not assume development identities or
administrator permissions transfer automatically.

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

### Vercel Build Preflight

`npm run build` checks Nest compilation, but Vercel also performs its own
TypeScript/function-packaging step. Before deploying, authenticate with
`npx vercel@65.1.0 login` and link this repository to the existing backend project
with `npx vercel@65.1.0 link`. Then run:

```powershell
npx --yes vercel@65.1.0 pull --yes --environment=production
npx --yes vercel@65.1.0 build --prod
```

Use the CLI version shown in the deployment logs; 65.1.0 is the version used for
this investigation. These commands require working Vercel connectivity and
authentication. Pull downloads project settings and environment values into the
ignored `.vercel` directory; never log or commit those values. Build creates local
deployment output, not a live deployment. A successful local build still does not
prove hosted API behavior.

The middleware setup uses express-rate-limit's named export and a static Helmet
import so Vercel's dependency tracer includes the package. A typed factory handles
the function/namespace default-export shapes inferred by the local and Vercel
NodeNext checks. Do not replace the static import with `import = require`:
TypeScript emits a `createRequire` alias that Vercel's tracer omitted, producing
`Cannot find module 'helmet'` at runtime even though local compilation passed.

The entrypoint must not top-level await `bootstrap()`. Vercel's Node adapter
intercepts `Server.listen()` while importing the entrypoint and only starts the
captured server after that import completes. Awaiting Nest's listen promise at
module scope deadlocks startup. Bootstrap failures are explicitly logged and exit
the process. Shutdown hooks are registered before listening, and email delivery
starts once on the HTTP server's `listening` event: Vercel does not forward the
original Nest listen callback, so code after `await app.listen()` is not a reliable
hosted startup hook. Standalone Node operation keeps the same delivery timing.

The ignored local `.env` file is not deployed. Configure the required variables
from the configuration table in the backend Vercel project's Production environment
and redeploy. Production validation requires the Supabase URL/public/secret keys,
a production Clerk issuer and `sk_live_` secret (or the explicit initial-MVP
development-instance opt-in above), matching public HTTPS
`PUBLIC_APP_URL`/`CORS_ORIGIN`, Resend API key/verified sender/webhook secret,
and a random 32+ character `EMAIL_APPROVAL_SECRET`. Do not use the backend API
domain as `PUBLIC_APP_URL`: that value is the final frontend URL. Keep provisioning
tokens and database passwords out of the deployed runtime.

### Automatic Email Delivery

Starting the API with `npm run start:dev` or `npm run start:prod` also starts email
delivery. On a continuously running Node host, no cron, cron secret, or separate
worker command is required. Configure
`RESEND_API_KEY` and a verified `RESEND_FROM_EMAIL` in the server environment.

API mutations queue emails transactionally. The server processes a batch of up to
10 immediately on startup, then checks again five seconds after each batch finishes.
Messages are sent serially with 600ms spacing. The first rendered payload is stored
and reused with the stable `moreli/<outbox-id>` Resend idempotency key. Resend retains
idempotency keys for 24 hours; the database ledger remains the durable source of truth.
Existing pending messages are included. Database leases and retry backoff remain in
place; shutdown waits for the active batch. Missing development email configuration
disables processing without consuming delivery attempts. Logs contain counts only.

#### Vercel MVP: Best-Effort Delivery

MVP hosting decision (2026-10-23): retain the existing runner and transactional
outbox without adding a scheduler or changing the request handlers. Accept
unbounded email delays and possible manual intervention on Vercel. This is not a
guarantee that all queued emails will eventually send.

The runner starts once per application instance, not once per HTTP request.
Vercel can reuse a warm instance or suspend/terminate execution after a response.
A cold start initiates one batch of at most 10 eligible jobs, but that batch is
not awaited by the request and is not guaranteed to finish. It can also run before
the incoming request queues its new emails. Warm requests do not call `start()`
again, so neither the next request nor additional traffic guarantees queue progress.
Retries, expired-lease recovery, and retention cleanup depend on processing actually
running. Interrupted jobs may remain leased for five minutes before another
processor can claim them.

Business transactions still save their email jobs. Resend callbacks track messages
submitted to Resend; they cannot initiate sending jobs that never reached Resend.
Monitor pending/dead jobs and use the authenticated admin processing/retry actions
if necessary. Manual processing is also subject to the function execution limit.
Use an always-on worker or a durable trigger before requiring timely, automatic
delivery. Deployment and cold-start/warm-instance behavior must still be verified
on the hosted API; a successful build is not deployment certification.

See [hosting and environment management](PRODUCTION_ROLLOUT.md#database-and-hosting)
for the deployment settings and CLI/GitHub Actions options.

`ADMIN_NOTIFICATION_EMAIL` selects the admin alert inbox independently of support,
Clerk login, and the sender. Restart the API after changing it. Existing frozen
messages keep their original recipients; changing the setting does not resend them.
The inbox setting does not grant admin permissions: the recipient must sign in
with a verified account that has the `admin` role in `profiles`.

A payment report queues an admin review alert and a separate teacher acknowledgement.
The admin email includes the amount, Bit reference, report ID and Israel-time
submission date, with one link to the exact authenticated payment review. That screen
shows teacher contact details and requires explicit approval or a reason for denial.
Teacher reviews, support tickets and inquiry activity also have targeted admin links.
Billing support tickets from teachers show that teacher's payment reports inside the
admin ticket screen (`requester_teacher` on the admin ticket detail), so the admin
can approve or deny with a reason there instead of only replying in the thread.
For an appeal of a rejection, `POST /api/admin/support-tickets/:id/payments/:paymentId/reopen`
creates a linked pending reconsideration, retaining the original decision and
terms acceptance. It requires an admin and a billing ticket authored by the payment
owner. Retries reuse the successor; another pending report blocks reopening.
The existing review endpoint makes the final decision and sends its reason.
Apply `20261023140000_payment_reconsideration.sql`, followed by
`20261023160000_connected_support_cases.sql`, before deploying this flow, then
rebuild and restart the API. A process launched with `node dist/main.js` does not
reload when its source or compiled files change.

Connected support cases are synchronized by database triggers in the same transaction
as payment/profile decisions, including the existing email approval path. Actual
onboarding submission creates one case per teacher; resubmission reuses it. Each Bit
report creates a case, and reconsideration reuses the original linked conversation.
Approval records an automatic decision message and resolves the exact case; rejection
or return for correction records the reason and sets `waiting_customer`. Owner replies
return cases to `open`; they do not approve a payment or resubmit a draft profile.
Manual case closure never changes domain decisions. Decision emails/notifications
remain the existing domain events, avoiding duplicate decision email deliveries.

`GET /api/admin/support-tickets?view=actionable` includes only `open`/`in_progress`.
`status=waiting_customer` and the existing status filters expose other queues.
`POST /api/support/tickets` accepts an optional `reviewId`; the contextual RPC validates
review visibility/ownership atomically with ticket creation. Review target UUIDs survive
content deletion without retaining a copy of deleted content. Existing inquiry ownership
checks still apply to lesson complaints. Ordinary lessons/reviews do not create cases.
Automatic cases do not consume the five-per-day manual support quota.

The connected-cases migration backfills pending profiles/reports and existing linked
appeals without approving anything or queuing retrospective emails/notifications.
Active legacy cases with an already recorded payment decision are synchronized to that
decision without changing its access period, consent, reviewer or history.
No email link changes application state merely by being opened. Inquiry subjects
distinguish the student, teacher and admin messages. Review the pending queue before
enabling a sender: startup also processes earlier queued jobs.

`npm run email:check` remains a non-sending diagnostic after building. Standalone
worker commands are optional maintenance tools, not required for normal operation.
Application contexts used by tests and maintenance do not auto-start delivery.

Deploy this API as a continuously running Node process. Serverless platforms such as
Vercel do not guarantee background timers; the existing Vercel scaffold alone is not
a supported deployment for reliable automatic delivery. No Vercel Cron is configured.
`sent` means Resend accepted the request, not verified inbox delivery. Provider IDs,
receipt status, safe failure codes, retry/dead-letter states and readiness appear in
the admin email-delivery section. Missing sender configuration leaves jobs queued
without consuming attempts. Permanent provider errors stop retrying; rate-limit
hints are respected. Bounced/complained recipients are suppressed using hashed addresses.

### Resend Production Setup

For local owner-inbox testing only, `RESEND_FROM_EMAIL=onboarding@resend.dev` is
supported. Direct test sends are limited to `RESEND_TEST_RECIPIENT_EMAIL` (falling
back to `ADMIN_NOTIFICATION_EMAIL`), which must be the Resend account owner's
address. This does not change the normal admin recipient or reply-to. Automatic and manual transactional queue
processing are paused in this mode, preserving student/teacher jobs and attempts.
The admin screen labels test mode. This does not enable delivery to arbitrary users
and remains rejected when `NODE_ENV=production`.

1. Rotate any key previously present in the client. The removed
   `VITE_RESEND_API_KEY` setting must not be restored.
2. Add and verify your sending domain in Resend, including its DNS records. Set
   `RESEND_FROM_EMAIL` to a sender on that domain. `onboarding@resend.dev` is a test
   sender and is rejected by production validation.
3. Register `POST https://<api-domain>/api/webhooks/resend` in Resend for
   `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`,
   `email.complained`, `email.failed`, and `email.suppressed`.
4. Store the endpoint signing secret as server-only `RESEND_WEBHOOK_SECRET`.
   Verification uses the raw request body and Svix headers; tampered requests are
   rejected. Event IDs are deduplicated, older events cannot downgrade delivery,
   and database failures return an error so Resend can retry the receipt.
5. Review pending/dead jobs before enabling delivery. Send controlled test events
   to inboxes you own and verify both provider acceptance and delivery/bounce state.

On 2026-10-21, the configured Resend account returned no verified sending domains;
no production Resend delivery or inbox receipt was certified in this workspace.

### Teacher Access And Engagement Workflows

Persistent lessons use migration `20261023180000_persistent_lessons`. The
`lessons` table is canonical: one unique first lesson per accepted inquiry, then
multiple teacher-created lessons tied to an accepted student connection. Existing
accepted inquiries are backfilled without changing their dates, modes, lifecycle
decisions or confirmations and without retrospective mail/notifications. A short
inquiry write lock closes the backfill/trigger installation race.

Authenticated lesson APIs:
- `GET /api/lessons?side=student|teacher&view=upcoming|week|past|needs_action|completed|all`
  uses stable time/ID ordering, exact totals and pagination. Week ranges use exclusive
  `from`/`to` endpoints; upcoming includes ongoing lessons. Dashboards request `limit=5`.
- `GET /api/lessons/:id`, `GET /api/lessons/students/:id` and
  `GET /api/lessons/calendar` enforce participant/teacher ownership.
- `POST /api/lessons`, `PATCH /api/lessons/:id` and
  `PATCH /api/lessons/:id/state` schedule, reschedule or update attendance. Creation
  has an idempotency key; additional lessons require an accepted connection, not a
  new paid contact grant. Scheduling respects recurring availability, Shabbat and
  teacher/student conflicts. No student appointment-confirmation step is required.
- `GET /api/admin/lessons/:id` is administrator-only and read-only.

Teacher/student locks serialize conflicting bookings. Original inquiry lifecycle
RPCs delegate to the canonical first lesson and source fields are mirrored for old
deep links. Attendance still requires two explicit post-end confirmations. No-show
is a report, not proven attendance; support closure does not adjudicate it.
`lesson.changed` emails and `lesson_updated` in-app notifications target the other
participant and link to the correct lesson view. First acceptance reuses existing
inquiry delivery instead of adding duplicate lesson mail. New/unconfigured recurring
availability is Sunday–Thursday, 09:00–21:00; customized schedules, including empty
ones, remain unchanged.

Existing teacher edits use `PUT /api/teachers/me/profile` and the service-role-only
`save_teacher_profile` transaction. Identity/contact details, teaching details,
subjects, service areas and availability commit together or all roll back.
Incomplete private drafts remain supported; review submission validates completeness.
Migration `20261022190000_atomic_teacher_profile` was installed, ledgered and its
server/browser permissions verified.

### Subject Search And Retired Levels

The 2026-10-23 migrations `20261023110000_subject_category_search`,
`20261023111000_retire_teacher_levels` and
`20261023112000_migrate_legacy_subject_assignments` are applied and ledgered.

- Directory results, counts, matching preview and persisted matches share category
  semantics: `מתמטיקה - הכל` includes all active math subsubjects, as does every
  other ` - הכל` category. Specific subjects remain exact. Published status and
  other hard filters are preserved; multiple matching subjects do not duplicate a teacher.
- City results are split by the client into in-person teachers serving that city
  (`onlineOk=false`) and online teachers anywhere (`inPersonOk=false`, no city).
  Both queries use the existing paginated search endpoint.
- Level selection and requirements are retired throughout the active API/UI.
  Historical database rows remain untouched. Legacy search RPC signatures retain
  `p_level_id` for compatibility, but it no longer filters teachers. Registration,
  profile saves, review/publication checks and persisted matching do not require levels.
- The catalog replacement had left existing teacher links on inactive legacy subjects.
  The data migration remaps known legacy slugs to active equivalents, including
  math exam-unit specializations, merging duplicate links and preserving experience
  and descriptions. Existing student requests are remapped too.
- Run `supabase/verify-search.sql` for deployed category-count agreement, city
  filtering, RPC grants and remaining level requirements. Regression coverage is
  in `src/teachers/teacher-search.spec.ts` and `teacher-onboarding.spec.ts`.

- One lifetime free new-student acceptance per teacher. Existing accepted contacts
  are backfilled as grants and remain visible; repeated contact with an already
  accepted student does not consume another allowance.
- Afterward, accepting a new student requires an admin-approved ILS 60 monthly
  access period. Payment is external via Bit; a claim does not activate access.
  Teacher locks, unique pending claims/references and repeat-safe admin decisions
  prevent concurrent free-contact or payment-retry bypasses.
- Accepted times cannot overlap another accepted awaiting lesson. Completion is
  explicit and requires both participants after the selected end. Cancellation and
  no-show reports are distinct. Ratings no longer require an inquiry or confirmed lesson.
- `POST /api/reviews` accepts `teacherId`, a mandatory integer `rating` from 1–5,
  and optional `body` (maximum 3,000 characters). `submit_teacher_review` publishes
  the rating, refreshes aggregates and notifies the teacher transactionally.
  Empty/whitespace comments become null. Only signed-in student/teacher accounts
  may rate another published teacher, once per teacher. Existing author edits,
  deletion and moderation remain unchanged. Legacy `inquiryId` submissions remain
  supported, but callers must provide exactly one target. Migration
  `20261023190000_open_student_ratings` replaces only the completed-lesson insert
  guard; it does not modify existing reviews, lesson confirmations or averages.
- The public calendar uses Israel timezone, teacher weekly slots (09–21 defaults),
  accepted busy intervals and Hebcal location-based Shabbat boundaries. Missing
  coordinates are clearly labeled as a Jerusalem fallback. An explicitly empty
  teacher schedule stays closed.
- Support/bug/billing/report tickets have owner-scoped conversations, idempotent
  creation, bounded usage, admin status decisions, notifications and safe email links.
- Admin email buttons open authenticated event-specific screens. No GET request,
  link preview, or email scanner can approve a teacher, payment or support decision.

Required migrations, in order: `20261021220000`, `20261021220500`, `20261021221000`,
`20261021222000`, `20261021223000`, `20261021224000`, `20261021225000`.
The enum migration must commit before later migrations use its new values.

## API Surface

Public routes include:

```text
GET  /api/health
GET  /api/subjects
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