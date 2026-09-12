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

- The Nest API starts delivery automatically after listening. No cron or separate
  worker command is required. It checks again five seconds after each completed batch,
  leases 10 jobs for five minutes, delivers concurrently, uses an eight-second
  provider timeout, retries with exponential backoff, and marks dead after eight attempts.
- Unique event keys prevent duplicate queue records. Brevo receives the job ID as
  idempotency key. Delivery is **at least once**, not proven exactly once after a
  send-before-ack crash. Provider acceptance is not proof of inbox delivery.
- `/admin` shows the oldest 100 unsent jobs and offers process/retry. API:
  `GET /api/admin/email-delivery`, `POST /api/admin/email-delivery/process`,
  `POST /api/admin/email-delivery/:id/retry`. All require DB admin role.
- Alert on dead jobs, delivery-loop failures, and pending age over five minutes. The bounded
  UI list is not a complete queue metric. Inspect Brevo suppressions/bounces directly;
  provider delivery/bounce/complaint webhooks are not yet implemented.
- Worker purges sent/dead jobs older than 30 days. Provider logs/inboxes have
  independent retention. Retry dead jobs before that deadline.
- Never run a staging worker against production data or send test jobs to real users.

### Database And Hosting

`20260912210000_no_payment_mvp_delivery` is applied and ledgered in hosted project
`whzrmgntqsinkxfqymqz`; outbox, claim RPC, and RLS were verified. It adds review
audit/reasons and inquiry consent timestamp. Existing consent remains null; do not
invent historic consent. Never edit an applied migration or reset hosted production.
Active catalogs are 952 professions and 1,174 cities; upserts preserve IDs/coordinates.

1. Host `backend` as a continuously running Node 24.x service. Use `npm ci`,
  `npm run build`, and `npm run start:prod` with the committed lockfile.
2. Automatic email delivery runs in the API process; configure restart-on-failure
  and health monitoring. No cron secret or external scheduler is needed.
3. [vercel.json](vercel.json) remains a serverless scaffold with no cron. Serverless
  background timers are not reliable, so that scaffold alone is not a supported
  deployment for this delivery architecture. The client may still use Vercel.
4. Configure the runtime variables below directly in the deployment secret store.
5. Deploy staging with separate Supabase/Clerk first; verify API routing,
   automatic delivery, CORS, and inbox receipt before promoting. No Vercel project,
   Git commit, or live deployment was created in this task.

| Runtime variable | Production requirement |
| --- | --- |
| `NODE_ENV` | `production` |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Dedicated project HTTPS API and public key |
| `SUPABASE_SECRET_KEY` | Server-only service key |
| `CLERK_ISSUER`, `CLERK_SECRET_KEY` | Production issuer and matching `sk_live_...`; no `*.accounts.dev` |
| `PUBLIC_APP_URL`, `CORS_ORIGIN` | Matching exact HTTPS client origin(s) |
| `TRUST_PROXY` | `true` only behind a trusted reverse proxy |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` | Transactional key and verified sender/name |
| `ADMIN_NOTIFICATION_EMAIL` | Monitored admin inbox; defaults to Erik's configured address |
| `EMAIL_APPROVAL_SECRET` | Independent random 32+ characters for legacy approval links |
| `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX` | Defaults 60000 ms / 120 requests |

Clerk profile sync now needs `CLERK_SECRET_KEY` locally too. Production validation
rejects development URLs/keys, missing secrets, and inconsistent CORS. Keep
provisioning PATs/passwords out of runtime and every server secret out of `VITE_*`.

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
