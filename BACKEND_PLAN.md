# Morali API implementation plan

## Architecture rule

React uses Supabase only for authentication. All application data access goes through this NestJS API:

```text
React -> HTTPS -> NestJS -> Supabase PostgreSQL / Auth / Storage
```

Keep the backend as a modular monolith. Each domain module should use this dependency direction:

```text
Controller -> Service -> Repository -> Supabase
```

- Controllers define HTTP contracts and use DTOs.
- Services own authorization and business rules.
- Repositories own Supabase queries.
- Repositories must not return Supabase query builders outside their module.
- The Supabase secret key and Management API token must never be sent to React.

## Current foundation

- [x] Global environment loading and Joi validation
- [x] Server-side Supabase client in `DatabaseModule`
- [x] Global DTO validation, `/api` prefix, and CORS
- [x] Supabase access-token verification with `auth.getClaims()`
- [x] `@Public()` and `@CurrentUser()` decorators
- [x] Profile-backed student, teacher, and admin role authorization
- [x] Initial domain module boundaries
- [x] Supabase database migration authored
- [x] Row Level Security and server-only grants authored
- [x] Private storage buckets authored
- [x] Subject, level, and city seed authored
- [x] Migration and seed applied to the hosted project
- [x] Hosted schema, RLS, grants, trigger, buckets, and seed counts verified
- [x] `database.types.ts` generated from the deployed schema
- [x] Public `GET /api/levels` controller, service, repository, logging, and unit coverage
- [x] Public subject, city, teacher discovery, availability, and review endpoints
- [x] Owned user profile and resumable teacher onboarding endpoints
- [x] Transactional teacher publication and collection replacement
- [x] Anonymous Smart Match preview and authenticated request persistence
- [x] Deterministic matching with hard filters, component scores, and exploration bonus
- [x] Owned inquiry lifecycle with transactional teacher response metrics
- [x] Accepted-inquiry review eligibility and transactional rating aggregates
- [x] Published-teacher favorites and owner-scoped private Storage URLs
- [x] Explicit teacher claim and terms consent
- [x] Requested-time, timezone-aware availability scoring
- [x] In-app notifications and stale-inquiry expiry
- [x] Admin teacher and review moderation
- [x] Self-service account and Storage deletion
- [x] Helmet, rate limiting, request IDs, structured HTTP logs, and health checks
- [x] Continuous published-profile integrity triggers
- [x] Real hosted authenticated marketplace acceptance coverage

## Environment setup

Copy values into `.env`. The file is ignored by Git; `.env.example` is the safe template.

| Variable | Purpose |
| --- | --- |
| `PORT` | Local NestJS port |
| `CORS_ORIGIN` | Comma-separated allowed React origins |
| `TRUST_PROXY` | Trust the first reverse proxy when deployed behind one |
| `RATE_LIMIT_WINDOW_MS` | Global rate-limit window |
| `RATE_LIMIT_MAX` | Maximum requests per IP per window |
| `SUPABASE_URL` | Project API URL |
| `SUPABASE_PUBLISHABLE_KEY` | Public project key; useful for user-scoped clients |
| `SUPABASE_SECRET_KEY` | Server-only key used by NestJS |
| `SUPABASE_PROJECT_REF` | Project identifier used in Management API URLs |
| `SUPABASE_ACCESS_TOKEN` | Personal access token used only for provisioning |
| `SUPABASE_DB_PASSWORD` | Database password used only by remote CLI migration commands |

Get project keys from **Supabase Dashboard -> Project Settings -> API**. Create a personal access token under **Account Settings -> Access Tokens**. Do not commit real values.

## Supabase operations

The hosted project is provisioned. Treat the SQL migration files as the database source of truth; do not make untracked schema changes in Supabase Studio.

For every schema change:

1. Create a new migration with `npx supabase migration new <name>`.
2. Put forward-only SQL in the new file. Never edit an already-applied migration.
3. Run a local reset with Docker when available.
4. Run a linked dry run, then push the migration.
5. Run `supabase/verify.sql` or a change-specific verification query.
6. Regenerate `src/database/database.types.ts`.
7. Build, lint, and test the NestJS application.

See `SUPABASE.md` for complete CLI commands, the Management API fallback, migration history, runtime connections, auth, repository CRUD examples, storage, and recovery procedures.

## Database resources

Create these enums first:

- `user_role`: `student`, `teacher`, `admin`
- `teacher_profile_status`: `draft`, `pending`, `published`, `suspended`
- `verification_status`: `unverified`, `pending`, `verified`
- `request_status`: `draft`, `open`, `matched`, `closed`, `cancelled`
- `match_status`: `suggested`, `viewed`, `contacted`, `dismissed`
- `inquiry_status`: `sent`, `viewed`, `accepted`, `declined`, `expired`
- `review_status`: `pending`, `published`, `rejected`
- `notification_type`: inquiry, review, verification, and suspension events

Create these tables in dependency order:

1. `profiles`
2. `teacher_profiles`
3. `subjects`
4. `levels`
5. `cities`
6. `teacher_subjects`
7. `teacher_levels`
8. `teacher_service_areas`
9. `teacher_availability`
10. `student_requests`
11. `matches`
12. `inquiries`
13. `reviews`
14. `favorites`
15. `notifications`

Important constraints:

- Use UUID primary keys for user-owned/business records and identity columns for taxonomy records.
- Store money as integer minor units, never floating point.
- Add `CHECK (rating BETWEEN 1 AND 5)` to reviews.
- Add `CHECK (start_time < end_time)` and day-of-week bounds to availability.
- Add composite primary keys to all many-to-many tables.
- Add unique `(request_id, teacher_id)` to matches.
- Keep `student_requests.student_id` nullable for anonymous Smart Match drafts.
- Store object paths in PostgreSQL, not image bytes.

## Domain implementation order

### Phase 1: discovery data

- [x] Implement `LevelsModule` as `GET /api/levels`.
- [x] Implement `SubjectsModule` as public read-only endpoints.
- [x] Implement `LocationsModule` as public read-only endpoints.
- [x] Add deterministic pagination to teacher and review collections.

### Phase 2: identity and teacher profiles

- [x] Implement `UsersModule`, `TeachersModule`, `AvailabilityModule`, and `StorageModule`.
- [x] Derive mutation ownership exclusively from the verified JWT subject.
- [x] Return only published profiles from public teacher queries.

### Phase 3: marketplace loop

- [x] Implement requests, deterministic matching, inquiries, favorites, and reviews.
- [x] Keep matching weights in a typed policy and persist component scores.

### Phase 4: hardening

- [x] Add deterministic pagination and metadata to collection endpoints.
- [x] Add global rate limiting and security headers.
- [x] Add request IDs, structured request logs, and a database health check.
- [x] Add student/teacher/admin role policies.
- [x] Add notifications, moderation, account deletion, and lifecycle invariants.
- [x] Exercise the complete flow with disposable hosted Supabase Auth users.

## Planned HTTP API

All routes are prefixed with `/api`.

```text
GET    /users/me
PATCH  /users/me
DELETE /users/me

GET    /subjects
GET    /subjects/:slug
GET    /levels
GET    /cities

GET    /teachers
GET    /teachers/:slug
GET    /teachers/:slug/availability?at=<ISO timestamp>
GET    /teachers/:slug/reviews
GET    /teachers/me
POST   /teachers/me
PATCH  /teachers/me
PUT    /teachers/me/subjects
PUT    /teachers/me/levels
PUT    /teachers/me/service-areas
GET    /teachers/me/schedule
PUT    /teachers/me/availability
POST   /teachers/me/publish

POST   /requests
GET    /requests
GET    /requests/:id
PUT    /requests/:id
POST   /requests/:id/close
POST   /matching/preview
POST   /requests/:id/matches
GET    /requests/:id/matches

POST   /inquiries
GET    /inquiries?side=student|teacher
PATCH  /inquiries/:id/view
PATCH  /inquiries/:id/respond

GET    /favorites
POST   /favorites/:teacherId
DELETE /favorites/:teacherId

POST   /reviews
GET    /reviews/me

GET    /notifications
GET    /notifications/unread-count
PATCH  /notifications/:id/read
POST   /notifications/read-all

GET    /admin/teachers
PATCH  /admin/teachers/:id
GET    /admin/reviews
PATCH  /admin/reviews/:id

POST   /storage/upload-url
POST   /storage/read-url
DELETE /storage/object
GET    /storage/teachers/:slug/avatar-url
```

Mark only health checks, taxonomy reads, public teacher search/profile, and anonymous matching preview with `@Public()`. Every other endpoint is protected by the global `AuthGuard` by default, with role checks applied to student, teacher, and admin operations.

## Definition of backend v1

Backend v1 is complete when this flow works end to end and has integration coverage:

```text
Teacher signs in -> creates draft -> completes profile -> publishes profile
Student previews anonymously or saves a request -> sees ranked teachers
Student sends inquiry -> teacher views and accepts -> student submits review
```

This flow is covered by `test/marketplace.e2e-spec.ts` using disposable hosted
Supabase Auth users. It also covers role denial, onboarding hydration, private
Storage, notifications, admin visibility, aggregate refresh, and account
deletion.

Payments, subscriptions, chat, calendar integrations, queues, WebSockets, Elasticsearch, AI services, and microservices are outside v1.