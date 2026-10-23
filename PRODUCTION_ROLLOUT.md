# Backend No-Payment MVP Launch

## Current Release Contract

Reviewed 2026-09-12. Governing scope: [source of truth](../PRODUCTION_MVP_PLAN.md).
This section replaces the historical rollout below. Payments, subscriptions,
commissions, invoices, and paid leads are excluded, not launch prerequisites.
Code is ready for staging verification, not certified for unrestricted public launch.

### Implemented And Tested

- Server-verified primary contact email, database-owned roles, private draft/pending
  tutors, authenticated admin approval, rejection reason and resubmission.
- Pending-only approval with actor audit; general moderation cannot bypass it.
  Legacy suspension changes still lack actor attribution.
- Future preferred-time inquiries require complete student contact and explicit
  sharing consent. Only the target tutor can respond; duplicate responses fail.
- Both sides omit contact email/phone unless accepted. Tutor students are queried
  through the same owner-scoped accepted-inquiry API.
- Transactional database outbox replaces direct lifecycle sends. Business actions
  and notification jobs commit or roll back together.
- Ordinary JSON mutations work alongside the larger catalog parser; request logs
  exclude query strings and approval tokens.

### Email Matrix And Operations

| Event | Users | Admin |
| --- | --- | --- |
| First verified profile email sync | Account owner | Yes |
| Tutor draft created or submitted | Tutor | Yes |
| Tutor approved, rejected, suspended | Tutor | Yes |
| Lesson request sent, accepted, declined | Student and tutor | Yes |

Account creation here means first application profile sync, not a Clerk signup
that never visits the app. Clerk sends identity verification email separately.
Pending/declined templates exclude contact details; accepted templates show each
participant only the other's contacts, and admin both. No marketing mail is added.

- On a continuously running host, the Nest API starts delivery after listening
  and checks again five seconds after each completed batch. It leases 10 jobs for
  five minutes, sends serially with 600ms spacing, and uses a ten-second provider
  timeout. Retryable failures use backoff; permanent failures or exhausted attempts
  become dead jobs, with an eight-attempt ceiling. See the Vercel exception below.
- Unique event keys prevent duplicate queue records. Resend receives
  `moreli/<outbox-id>` as the idempotency key, with the first rendered message
  persisted for retries. Delivery is not proven exactly once after a send-before-ack
  crash, and eventual submission depends on a processor running. Provider acceptance
  is not proof of inbox delivery.
- The delivery API lists the latest 100 jobs; `/admin` offers process/retry. API:
  `GET /api/admin/email-delivery`, `POST /api/admin/email-delivery/process`,
  `POST /api/admin/email-delivery/:id/retry`. All require DB admin role.
- Monitor dead jobs, delivery-loop failures, and pending age. The bounded UI list
  is not a complete queue metric. `POST /api/webhooks/resend` verifies signatures,
  records provider delivery events, and suppresses bounced/complaining recipients.
  Configure this URL and the signing secret in Resend; callbacks cannot send jobs
  that were never submitted to the provider.
- Worker purges sent/dead jobs older than 30 days. Provider logs/inboxes have
  independent retention. Retry dead jobs before that deadline.
- Never run a staging worker against production data or send test jobs to real users.

### Database And Hosting

`20260912210000_no_payment_mvp_delivery` is applied and ledgered in hosted project
`whzrmgntqsinkxfqymqz`; outbox, claim RPC, and RLS were verified. It adds review
audit/reasons and inquiry consent timestamp. Existing consent remains null; do not
invent historic consent. Never edit an applied migration or reset hosted production.
Active catalogs are 952 professions and 1,174 cities; upserts preserve IDs/coordinates.

1. The existing Git layout is two separate repositories, one for the backend and
   one for the client. Connect each to its own Vercel project, using that repository's
   root and existing configuration. Use Node 24.x, `npm ci`, and `npm run build`;
   the client publishes `dist`. An always-on backend alternatively runs
   `npm run start:prod` after building.
   The backend uses Vercel's native NestJS preset, which discovers `src/main.ts`;
   it does not need an `api` wrapper or rewrite. Do not add a `functions` override
   targeting `src/main.ts`: that override failed Vercel's function-pattern matching
   during deployment. Function duration now uses the platform/project default
   instead of the removed 60-second override. Leave the backend Output Directory
   unset rather than treating `dist` as a static website.
2. **Accepted MVP limitation (2026-10-23):** keep the existing in-process email
   runner on Vercel, without a cron or new request-bound sending path. Email
   processing is best effort, with unbounded delays and possible manual recovery.
   This does not establish production delivery reliability.
3. [vercel.json](vercel.json) has no cron. A cold application start initiates one
   batch, but requests do not await it and completion is not guaranteed. Warm
   requests reuse the application and do not restart the runner. A startup batch
   may run before the current request enqueues email. Therefore, traffic or a
   future request alone does not guarantee sending pending jobs. Retries, five-minute
   lease recovery, and retention cleanup also require an active processing run.
   Monitor the queue and use authenticated admin process/retry actions if needed;
   those requests remain subject to function timeouts. Use an always-on worker or
   a durable trigger when timely automatic delivery becomes a requirement.
4. Configure the runtime variables below in Vercel's secret store, through the
   dashboard, CLI, or API. GitHub secrets alone are not injected by Git integration.
5. Deploy staging with separate Supabase/Clerk first; verify API routing,
   cold/warm email behavior, manual recovery, CORS, and inbox receipt before
   promoting. The Vercel deployment has not been verified here.

Native NestJS references: [Vercel framework guide](https://vercel.com/docs/frameworks/backend/nestjs),
[official example](https://github.com/vercel/vercel/tree/main/examples/nestjs),
and [official entrypoint discovery](https://github.com/vercel/vercel/blob/main/packages/nestjs/src/build.ts).
The guide was unreachable during this investigation; entrypoint support and the
example layout were verified against Vercel's public source.

| Runtime variable | Production requirement |
| --- | --- |
| `NODE_ENV` | `production` |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Dedicated project HTTPS API and public key |
| `SUPABASE_SECRET_KEY` | Server-only service key |
| `CLERK_ISSUER`, `CLERK_SECRET_KEY` | Production issuer and `sk_live_...`, or development `*.accounts.dev` issuer and `sk_test_...` with the explicit MVP opt-in |
| `CLERK_ALLOW_DEVELOPMENT_INSTANCE` | Defaults `false`; set `true` only for the initial hosted MVP using the existing development instance |
| `PUBLIC_APP_URL`, `CORS_ORIGIN` | Matching exact HTTPS client origin(s) |
| `TRUST_PROXY` | `true` only behind a trusted reverse proxy |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_FROM_NAME` | Server-only transactional key and verified sender/name |
| `RESEND_WEBHOOK_SECRET` | Signing secret for the registered Resend webhook endpoint |
| `ADMIN_NOTIFICATION_EMAIL` | Monitored admin inbox; defaults to Erik's configured address |
| `EMAIL_APPROVAL_SECRET` | Independent random 32+ characters for legacy approval links |
| `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX` | Defaults 60000 ms / 120 requests |

Clerk profile sync now needs `CLERK_SECRET_KEY` locally too. Production validation
rejects development URLs/keys by default, missing secrets, and inconsistent CORS.
The explicit Clerk opt-in does not relax other production requirements. For the
initial stable frontend, use `https://moreli-client.vercel.app` for both
`PUBLIC_APP_URL` and `CORS_ORIGIN`, keep the existing matching development Clerk
issuer/secret, and set `CLERK_ALLOW_DEVELOPMENT_INSTANCE=true`. Redeploy the backend
code and updated environment together, then verify `/api/health`. Keep
provisioning PATs/passwords out of runtime and every server secret out of `VITE_*`.

### Environment Management Without Dashboard Entry

Environment values must reach the correct Vercel project and deployment target
(`production`, `preview`, or `development`). The client needs build-time
`VITE_API_URL` and `VITE_CLERK_PUBLISHABLE_KEY`; the backend needs the runtime
variables above. `VITE_*` values are public browser-bundle content, not secrets.
Create a new deployment after changing project environment values.

- **Vercel CLI:** link each repository to its corresponding project with
  `npx vercel link`. `npx vercel env add NAME production` adds a project variable;
  it can read its value from standard input for scripted provisioning. For example,
  in PowerShell, with a secret already securely loaded into the process environment:

  ```powershell
  $env:RESEND_API_KEY | npx vercel env add RESEND_API_KEY production
  ```

  Repeat for the required variables and targets. Use the CLI's update command
  for existing values; do not print secrets or embed literal values in commands.
  The ignored `.vercel` directory contains local project linkage/environment files.

- **Vercel REST API:** a provisioning script can create/update project environment
  variables using a Vercel token. Keep the token and variable values in a secret
  manager or CI secret store, never in source control.

- **GitHub Actions:** repository/environment secrets are available to explicitly
  authorized workflows, not automatically to Vercel's Git deployment integration.
  A workflow can provision Vercel environment variables using the CLI/API or
  explicitly supply build/runtime values through a CLI deployment. Store a
  least-privilege `VERCEL_TOKEN` plus the project identifiers and required secrets
  in the appropriate GitHub repository/environment. Use protected environments
  for production, pass secrets through process environment/stdin, disable shell
  tracing, and do not send production secrets to untrusted pull-request workflows.
  Ensure provisioning finishes before triggering deployment; a Git-triggered
  deployment can otherwise start with old/missing values.

No environment-sync workflow or live secret provisioning was added by this
documentation update. Exact current CLI/API options should be confirmed against
the official documentation before scripting; Vercel documentation was unreachable
from this environment during this review.

References: [Vercel CLI environment management](https://vercel.com/docs/cli/env),
[project environment API](https://vercel.com/docs/rest-api/reference/endpoints/projects/create-one-or-more-environment-variables),
and [GitHub Actions secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).

### Remaining Public-Launch Gates

| Gate | Required action/proof |
| --- | --- |
| Identity/admin | Live Clerk origins/redirects/email verification, controlled DB admin provisioning, admin MFA, distinct role smoke tests |
| Deliverability | Verify sender, SPF/DKIM/DMARC, quotas and replies; receive all matrix events in three controlled inboxes |
| Delivery lifecycle | Observe automatic delivery, failure/retry, restart recovery, and graceful shutdown on the chosen host |
| Privacy/legal | Approved terms/privacy, operator/support identity, minor/guardian policy, contact consent, retention/deletion decisions |
| Abuse | Per-instance in-memory limiter is insufficient across serverless instances; configure WAF/distributed/per-action request-spam protection |
| Monitoring/recovery | Uptime/5xx/queue/worker alerts, PII-filtered telemetry, backup/PITR verification and a restore drill with named incident owner |
| Deletion reconciliation | Clerk and application deletion are not atomic; failure after Clerk deletion needs operator DB/storage cleanup. Add durable reconciliation before unattended scaling |
| PII erasure | Participant jobs cascade, but admin/counterparty snapshots can retain contacts until 30-day purge. Approve that policy or implement immediate entity-wide erasure |
| Provider-side deletion | Direct Clerk dashboard/account-widget deletion has no reconciliation webhook; reconcile orphan application profiles operationally until implemented |
| Load/security | Production-like load, action abuse tests, and review of remaining dependency advisories |

Deletion reconciliation and distributed abuse controls are **known engineering
gaps**, not claims that DNS configuration alone makes this production-ready.

### Verification And Rollback

2026-09-12: build passed; 51 unit tests in 15 files passed; four hosted E2E tests
in two files passed; lint passed with six `unicorn/no-thenable` warnings (Joi and
query fixture); production dependency audit found zero vulnerabilities. Hosted E2E
mocks email and uses Supabase test identities; it does not prove live Clerk/inboxes.

Run `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e`,
`npm audit --omit=dev`. E2E creates disposable hosted data: use staging.
Rollback to a compatible Vercel release, pause cron if needed, and retain additive
schema/queued jobs. Never restore a direct-email release while triggers also queue
the same events. Use forward migrations, and reconcile send-before-ack jobs before resend.

---

## Historical Pre-Outbox Notes (Superseded)

The material below is retained as historical context only. Its missing-feature
lists, test counts, public approval description, and monetization requirements are
not the current contract. Use the current sections above and the governing plan.

Last reviewed: 2026-09-12

## Purpose

This document summarizes the backend changes completed so far, the behavior
currently available, and the work still required before a public production
launch. The repository-wide roadmap remains in `../PRODUCTION_READINESS.md`.

## Architecture

```text
React client -> Clerk JWT -> NestJS API -> Supabase PostgreSQL/Storage
                                      -> Brevo transactional email
```

- Clerk owns sign-in, sessions, and user email credentials.
- NestJS verifies access tokens and owns authorization and business logic.
- Clerk subjects are mapped to internal UUID profiles.
- Supabase stores marketplace data and private teacher media.
- Browser database roles do not have direct application-table or business-RPC
  access. The API uses the server-only Supabase client.
- Brevo sends transactional email after database changes have succeeded.

## Recent Changes

### Tutor review and approval

- Saving a complete draft tutor profile automatically submits it as `pending`.
- First name, last name, synchronized email, phone, residential city, and avatar
  are enforced by the review-submission RPC.
- Later saves to `pending` or `published` profiles do not resubmit the profile or
  resend review emails.
- The old direct-publication PostgreSQL RPC was removed.
- The compatibility `POST /api/teachers/me/publish` route no longer publishes;
  it submits the profile for review.
- Erik receives a tutor-review email at the configured admin address, and the
  tutor receives an acknowledgement that the profile is under review.
- Approval links use an HMAC-SHA256 signature and expire after seven days.
- `GET /api/teacher-approvals/preview` only previews the tutor.
- `POST /api/teacher-approvals/approve` performs the approval, preventing email
  security scanners from approving a tutor merely by opening a link.
- Approval only transitions a `pending` profile to `published` and `verified`.
- The approved tutor receives an email and an in-app notification.

### Lesson requests and contact privacy

- Inquiries support a preferred start time, end time, lesson mode, and message.
- The API validates future dates, positive duration, a maximum four-hour
  duration, and complete scheduling fields.
- Student and tutor emails are attempted after the request is persisted.
- Tutors can mark requests viewed and accept or decline them.
- Response emails are attempted only after the response is persisted.
- Student email and phone are stripped from every non-accepted tutor response.
- Tutor contact details are also withheld from students until acceptance.
- Acceptance is the durable boundary where a future paid-lead entitlement check
  should be enforced atomically.

### Email infrastructure

- `@getbrevo/brevo` is installed and wrapped by a global NestJS email module.
- Implemented email events:

| Event                            | Recipients              |
| -------------------------------- | ----------------------- |
| Tutor submits profile for review | Admin address and tutor |
| Tutor profile is approved        | Tutor                   |
| Student creates a lesson request | Student and tutor       |
| Tutor accepts or declines        | Student and tutor       |

- Email failures are logged and do not roll back successful database changes.
- Development can run with email disabled when Brevo values are absent.
- Production configuration validation rejects missing required email settings.

### Database deployment

The following migrations are deployed to hosted Supabase, verified, and
recorded in the migration ledger:

- `20260912180000_email_review_and_lesson_requests`
- `20260912181000_remove_direct_teacher_publish`
- `20260912183000_require_tutor_contact_and_city`

The hosted database contains `profiles.contact_email`, `profiles.city_id`,
lesson-request schedule fields, tutor review submission and approval RPCs, and no
`publish_teacher(uuid, uuid)` function.

## Current Backend Capabilities

- Health and database readiness endpoints
- Clerk JWT verification and internal identity resolution
- Student, tutor, and admin role enforcement
- User profile updates and account deletion
- Public subject, level, and city taxonomies
- Public tutor discovery, filtering, sorting, pagination, profile details,
  reviews, media, and recurring availability
- Tutor profile claim, editing, subjects, levels, service areas, availability,
  private avatar storage, review submission, and approval
- Student requests, candidate matching, and persisted matches
- Scheduled lesson inquiries with accept/decline lifecycle
- Server-enforced contact redaction before acceptance
- Favorites, verified reviews, notifications, and admin moderation
- Structured request logging, request IDs, Helmet, CORS validation, DTO
  validation, rate limiting, and graceful shutdown

The current lesson flow is a preferred-time request. It is not yet a reserved
booking because it does not lock a calendar slot or prevent scheduling races.

## Required Configuration

Use `backend/.env.example` as the reference. Important runtime values include:

```text
PORT
CORS_ORIGIN
CLERK_ISSUER
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
PUBLIC_APP_URL
BREVO_API_KEY
BREVO_SENDER_EMAIL
BREVO_SENDER_NAME
ADMIN_NOTIFICATION_EMAIL
EMAIL_APPROVAL_SECRET
```

Production requirements:

- Store all secrets in the deployment provider's secret manager.
- Set `PUBLIC_APP_URL` to the deployed HTTPS client origin.
- Set `CORS_ORIGIN` to the exact deployed client origin.
- Verify the sender and sending domain in Brevo.
- Use a random `EMAIL_APPROVAL_SECRET` of at least 32 characters.
- Never expose Supabase server keys, Brevo keys, or approval secrets to Vite.

## Missing Before Production

### Launch blockers

- Configure the real Brevo API key and verified sender.
- Configure SPF, DKIM, and DMARC for the sending domain.
- Rotate any development or previously exposed Clerk/Supabase credentials.
- Configure production HTTPS origins for Clerk, CORS, and `PUBLIC_APP_URL`.
- Add legal consent text for contact disclosure and define lead-data retention
  and deletion rules.
- Run the complete test suite against a production-like staging environment.

### Reliability and abuse prevention

- Add an email outbox/queue with idempotency, bounded retries, and dead-letter
  handling.
- Process Brevo delivery, bounce, block, complaint, and unsubscribe webhooks.
- Add per-action rate limits and anti-spam controls for lesson requests and
  approval attempts.
- Persist approval audit events containing actor, timestamp, decision, and
  reason.
- Add tutor rejection and resubmission workflows with actionable reasons.
- Add centralized error monitoring, alerting, backup checks, and recovery
  drills.

### Scheduling and monetization

- Add availability exceptions, holidays, timezone ownership, and daylight
  saving handling.
- Add conflict detection and an atomic reservation transaction.
- Add reschedule, cancellation, completion, and no-show states.
- Add payment provider integration, invoices, refunds, and reconciliation.
- Enforce payment or entitlement in the same transaction that accepts a lead;
  a client-only paywall is not sufficient.

### Testing

- Expand integration tests for every email event and delivery failure path.
- Add explicit contact-redaction tests for sent, viewed, declined, expired, and
  accepted inquiries.
- Add approval expiry, replay, rejection, and audit tests.
- Add load tests for public tutor search and request creation.
- Regenerate `src/database/database.types.ts` from the final hosted schema.

## Current Validation Status

Verified on 2026-09-12:

- Backend build passes.
- Backend lint passes with three existing `unicorn/no-thenable` warnings in
  environment validation.
- Backend unit tests pass.
- Hosted marketplace end-to-end test passes (`1` file, `1` test), including
  pending review, signed approval, publication, inquiry acceptance, review,
  notifications, and cleanup.
- Public API responds at `http://localhost:5146/api` in development.

Run the full backend checks with:

```powershell
Set-Location C:\Users\erikp\Desktop\WorkSpace\MoreLi\backend
npm run lint
npm test
npm run build
npm run test:e2e
```

The end-to-end suite creates and removes disposable hosted Supabase data.

## Start The Backend

From the workspace root in PowerShell:

```powershell
Set-Location .\backend
npm install
npm run start:dev
```

The API is available at `http://localhost:5146/api` by default.

Production-style local start:

```powershell
Set-Location .\backend
npm install
npm run build
npm run start:prod
```

## Recommended Rollout Order

1. Rotate credentials and configure production Clerk, Supabase, and HTTPS URLs.
2. Verify the Brevo sender/domain and configure email secrets.
3. Deploy the backend to staging and run schema verification plus e2e tests.
4. Add email outbox/retry handling and delivery webhooks.
5. Complete legal consent, abuse controls, monitoring, and backup validation.
6. Release preferred-time lesson requests as requests, not confirmed bookings.
7. Build conflict-safe reservations before introducing booking guarantees.
8. Add payment enforcement atomically at the acceptance boundary.
