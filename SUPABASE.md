# Supabase operations and server integration

This document is the operational reference for the Morali backend. It describes the deployed schema, CLI workflow, authentication, server connection, repository queries, Storage, and recovery rules.

## Architecture

```text
React
  |  sign in / refresh session
  v
Clerk
  |  access token
  v
React -- Authorization: Bearer <JWT> --> NestJS
                                           |
                                           | HTTPS with server secret key
                                           v
                                  Supabase Data API / Storage
                                           |
                                           v
                                       PostgreSQL
```

Rules:

- React uses Clerk for authentication and does not query application tables directly.
- React sends its Clerk session token to NestJS in the `Authorization` header.
- NestJS verifies the Clerk token, resolves its subject to an internal UUID profile, and owns authorization and business logic.
- Legacy Supabase access tokens remain accepted while existing users transition.
- NestJS repositories own all application database queries.
- The publishable key may be exposed to a browser. The secret key, personal access token, and database password must never be exposed or logged.
- Schema changes are SQL migrations. Supabase Studio is for inspection, not untracked production schema edits.

## Hosted project state

Project reference: `whzrmgntqsinkxfqymqz`.

Current release update (2026-09-12): migrations through
`20260912210000_no_payment_mvp_delivery` are applied and ledgered. This adds
private `email_outbox` and `teacher_review_audit`, review reasons, consent timestamp,
and leased delivery/admin decision functions. Outbox existence, claim RPC, and RLS
were verified after deployment. Existing consent timestamps remain null.
The active catalogs now contain 952 professions and 1,174 cities from local source
files; slug upserts preserve IDs and coordinates. The initial counts below are
historical baseline counts, not current inventory. Use
[the rollout](PRODUCTION_ROLLOUT.md) for current release/retention requirements.

The initial hosted deployment contained:

- 16 application tables
- 8 PostgreSQL enums
- 16 RLS-enabled application tables
- 0 table grants to `anon` or `authenticated`
- 2 `auth.users` profile lifecycle triggers
- 2 private Storage buckets
- 13 seeded subjects
- 6 seeded levels
- 13 seeded cities

The applied migration ledger contains:

| Version | Name |
| --- | --- |
| `202609110001` | `initial_schema` |
| `20260911230000` | `mvp_business_contracts` |
| `20260911231500` | `mvp_candidate_and_inquiry_contracts` |
| `20260911233000` | `production_lifecycle_hardening` |
| `20260911234500` | `admin_moderation_contracts` |
| `20260912000000` | `request_schedule` |
| `20260912001500` | `published_teacher_integrity` |
| `20260912003000` | `fix_published_teacher_integrity_ambiguity` |
| `20260912004500` | `fix_match_request_status_type` |
| `20260912010000` | `secure_review_aggregate_trigger` |
| `20260912011500` | `clerk_identity_bridge` |
| `20260912143000` | `teacher_search_v2` |
| `20260912180000` | `email_review_and_lesson_requests` |
| `20260912181000` | `remove_direct_teacher_publish` |
| `20260912183000` | `require_tutor_contact_and_city` |
| `20260912190000` | `replace_professions` |
| `20260912191000` | `fix_replace_professions_safe_update` |
| `20260912210000` | `no_payment_mvp_delivery` |

Business RPCs and invariant triggers are service-role-only. Browser roles have
no table grants and no execute grants on these functions. Use the migration files
and deployed schema for current object inventory rather than the old baseline counts.

## Environment variables

Runtime variables used by NestJS:

| Variable | Use | Secret |
| --- | --- | --- |
| `SUPABASE_URL` | Supabase project API origin | No |
| `SUPABASE_PUBLISHABLE_KEY` | Public/client API key | No |
| `SUPABASE_SECRET_KEY` | Server client with `service_role` access | Yes |
| `CORS_ORIGIN` | Comma-separated browser origins | No |
| `TRUST_PROXY` | Reverse-proxy trust toggle | No |
| `RATE_LIMIT_WINDOW_MS` | Global rate-limit window | No |
| `RATE_LIMIT_MAX` | Requests allowed per IP/window | No |
| `CLERK_ISSUER` | Trusted Clerk JWT issuer | No |
| `CLERK_SECRET_KEY` | Server-verified primary identity email and deletion | Yes |

Provisioning-only variables:

| Variable | Use | Secret |
| --- | --- | --- |
| `SUPABASE_PROJECT_REF` | Selects the hosted project | No |
| `SUPABASE_ACCESS_TOKEN` | Supabase Management API/CLI account token | Yes |
| `SUPABASE_DB_PASSWORD` | Direct or pooled PostgreSQL CLI access | Yes |

Use `.env.example` as the template. Real values belong in `.env` or the deployment platform's secret store. `.env` is ignored by Git.

Rotate a secret immediately if it is committed, logged, pasted into chat, or otherwise disclosed.

## Two separate connections

### NestJS runtime connection

`DatabaseModule` is global and provides one `SupabaseService`. Its `SupabaseClient<Database>` is created from `SUPABASE_URL` and `SUPABASE_SECRET_KEY`.

This is an HTTPS connection to Supabase APIs, not a persistent raw PostgreSQL connection. The client disables browser session behavior:

```ts
createClient<Database>(url, secretKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});
```

The service is injected into repositories:

```ts
@Injectable()
export class LevelsRepository {
  constructor(private readonly supabase: SupabaseService) {}
}
```

The secret key maps to `service_role` and bypasses RLS. Therefore every repository query and service operation must enforce ownership and authorization explicitly. Never accept a user ID from a request body as proof of ownership; use the verified current user.

### CLI and migration connection

The Supabase CLI is a development/deployment tool. It is not used by the running NestJS server.

The CLI uses:

- A personal access token for Supabase Management API operations and project discovery.
- The database password for normal `db push`, `db pull`, and direct PostgreSQL operations.
- The project reference to select the hosted project.

The CLI is installed locally, so use `npx supabase ...` or an npm script. Bare `supabase ...` works only after a global installation and is not assumed by this repository.

## Authentication flow

1. React signs in through Clerk.
2. Clerk returns a session token.
3. React sends `Authorization: Bearer <session-token>` to NestJS.
4. The global `AuthGuard` checks for `@Public()`.
5. The guard verifies Clerk JWTs against the issuer's public JWKS, including issuer and authorized-party checks.
6. The service-role-only `resolve_external_identity` RPC maps the Clerk subject to an internal UUID, provisioning a profile on first use.
7. The internal UUID is attached to the Express request as `authUser.sub`.
8. `@CurrentUser()` returns that verified identity.
9. `RolesGuard` loads the authoritative application role from `profiles`.
10. Controllers pass the verified identity into services; services enforce permissions before repositories mutate data.

For transition compatibility, non-Clerk bearer tokens are verified with
`supabase.auth.getClaims()`. Their UUID subject is used directly, so existing
Supabase Auth users and hosted e2e tests continue to work.

Example protected endpoint:

```ts
@Get('me')
getMe(@CurrentUser() user: AuthUser) {
  return this.usersService.findById(user.sub);
}
```

Only health checks, public taxonomy reads, public teacher discovery, and intentionally anonymous entry points should use `@Public()`.

Application repositories use the server client and authorization remains in
NestJS and ownership-sensitive RPCs. Do not assume RLS protects a service-key query.

## MVP business contracts

Multi-row workflows are implemented as `security definer` PostgreSQL functions
that are executable only by `service_role`. NestJS still owns authorization and
passes only the verified JWT subject into ownership-sensitive functions.

| Contract | Database guarantee |
| --- | --- |
| `create_teacher_draft` | Changes the profile role and creates one resumable `draft` atomically. |
| `replace_teacher_subjects` | Replaces the full active-subject collection atomically. |
| `replace_teacher_levels` | Replaces the full active-level collection atomically. |
| `replace_teacher_service_areas` | Replaces the full active-city collection atomically. |
| `replace_teacher_availability` | Replaces all slots atomically; a trigger rejects active overlaps. |
| `submit_teacher_for_review` | Locks the owned profile, checks identity, contact email, avatar, biography, price, modes, subjects, levels, and service area, then moves it to `pending`. |
| `approve_teacher_review` | Publishes only a pending profile, marks it verified, and emits the approval notification. |
| `search_teacher_candidates` | Returns published teachers satisfying subject, level, mode/location, and budget hard filters. |
| `persist_matches` | Rechecks every hard filter, replaces ranks atomically, and moves `open` to `matched`. |
| `create_inquiry` | Locks a published teacher, verifies optional matched-request ownership, inserts the inquiry, and marks the match contacted. |
| `mark_inquiry_viewed` | Allows only the target teacher to move `sent` to `viewed`. |
| `respond_to_inquiry` | Allows only the target teacher to accept/decline and refreshes response metrics atomically. |
| `submit_verified_review` | Requires the student's accepted inquiry; the review trigger refreshes rating count/average in the same transaction. |
| `expire_stale_inquiries` | Expires unanswered inquiries and emits notifications. |
| `moderate_teacher` | Applies admin-owned verification/publication changes and emits notifications. |
| `moderate_review` | Applies valid admin review-moderation transitions. |

Deferred integrity triggers prevent a published teacher from becoming
incomplete after profile, taxonomy, availability, or avatar changes. Review
aggregate maintenance runs as a locked-down security-definer trigger so Auth
user deletion can safely cascade through reviews.

The API never accepts founder, verification, aggregate, publication-status, or
response-metric fields in teacher update DTOs. Founder status is permanent in
the MVP contract. Future paid promotion must be modeled separately and must not
replace hard eligibility or materially poor relevance. Imported/acquisition
profiles must remain `draft` until the teacher claims and explicitly publishes
the profile.

Smart Match uses the same hard-filter RPC for anonymous preview and saved
requests. The typed NestJS policy scores availability, location, budget,
response/review quality, and verification. New teachers with fewer than three
reviews receive a maximum three-point exploration bonus. Ties resolve by score,
rating, review count, then teacher UUID; persisted ranks are unique per request.

## Repository pattern

Use this dependency direction:

```text
Controller -> Service -> Repository -> SupabaseService -> Supabase API
```

- Controller: HTTP input/output, decorators, DTOs.
- Service: authorization, business rules, logging, orchestration.
- Repository: typed database queries and database-error translation.
- SupabaseService: client construction only.

Derive types from the generated `Database` type instead of duplicating database interfaces:

```ts
type LevelRow = Database['public']['Tables']['levels']['Row'];
type LevelInsert = Database['public']['Tables']['levels']['Insert'];
type LevelUpdate = Database['public']['Tables']['levels']['Update'];
```

### Read

The deployed example is `GET /api/levels`:

```ts
const { data, error } = await this.supabase.client
  .from('levels')
  .select('id, name_he, name_en, slug, sort_order')
  .eq('is_active', true)
  .order('sort_order')
  .order('id');

if (error) {
  throw new InternalServerErrorException('Failed to load levels');
}

return data;
```

Use `.single()` when exactly one row must exist and `.maybeSingle()` when no row is a valid result. Always use deterministic ordering for collections.

### Create

```ts
async create(input: LevelInsert): Promise<LevelRow> {
  const { data, error } = await this.supabase.client
    .from('levels')
    .insert(input)
    .select()
    .single();

  if (error) {
    throw new InternalServerErrorException('Failed to create level');
  }

  return data;
}
```

Validate HTTP JSON with a DTO before passing it to a service. Do not expose database `Insert` types as HTTP contracts.

### Update

```ts
async update(id: number, changes: LevelUpdate): Promise<LevelRow> {
  const { data, error } = await this.supabase.client
    .from('levels')
    .update(changes)
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) {
    throw new InternalServerErrorException('Failed to update level');
  }
  if (!data) {
    throw new NotFoundException('Level not found');
  }

  return data;
}
```

For user-owned records, include ownership in the mutation query:

```ts
.update(changes)
.eq('id', resourceId)
.eq('user_id', currentUserId)
```

This prevents a check-then-update race and is mandatory because the server client bypasses RLS.

### Delete

```ts
async remove(id: number): Promise<void> {
  const { error } = await this.supabase.client
    .from('levels')
    .delete()
    .eq('id', id);

  if (error) {
    throw new InternalServerErrorException('Failed to delete level');
  }
}
```

Prefer deactivation (`is_active = false`) for shared taxonomy rows referenced by other tables. Use hard deletes only when relationship behavior and audit requirements are understood.

### Error handling

Never ignore Supabase's `error` result. Translate expected cases to Nest exceptions:

- Missing row: `NotFoundException`
- Duplicate/unique conflict: `ConflictException`
- Invalid relation or check violation: `BadRequestException` when caused by valid user input
- Unexpected database/network failure: `InternalServerErrorException`

Do not return raw Supabase errors to clients; they can expose schema details. Log a safe error code and operation context on the server.

## Logging

`LevelsService` currently logs the fetched levels and returns them. This confirms the first end-to-end repository path.

Log:

- Operation name
- Resource ID when safe
- Number of rows
- Duration or Supabase error code when useful

Never log:

- Access or refresh tokens
- Secret/publishable keys
- Database passwords or connection strings
- Authorization headers
- Sensitive profile fields or full request bodies

For growing datasets, log `Fetched 6 levels` rather than serializing every row.

## Schema

### Identity and teacher profile

- `auth.users`: Supabase-owned identity table.
- `profiles`: application identity, role, names, phone, avatar path.
- `teacher_profiles`: teacher publication, price, teaching modes, verification, rating, and response metrics.

An `auth.users` insert trigger creates the matching `profiles` row. Metadata names are truncated to column limits so malformed metadata cannot break signup.

### Taxonomy and location

- `subjects`: self-referencing subject tree.
- `levels`: general educational levels.
- `cities`: service locations without PostGIS.
- `teacher_subjects`, `teacher_levels`, `teacher_service_areas`: many-to-many joins.

### Marketplace workflow

- `teacher_availability`: recurring weekly windows.
- `student_requests`: tutoring needs, including optional anonymous ownership.
- `matches`: persisted ranking and component scores.
- `inquiries`: student-to-teacher funnel and response state.
- `reviews`: moderated ratings.
- `favorites`: saved teachers.
- `notifications`: owner-scoped in-app lifecycle events.

`student_requests.desired_start_at` stores an optional requested lesson instant.
Matching compares that instant with active recurring teacher slots in each
slot's IANA timezone.

The initial migration contains checks, foreign keys, unique constraints, indexes, timestamp triggers, grants, RLS enablement, and Storage bucket setup.

## Storage

Buckets:

- `teacher-avatars`: private, 5 MiB limit, JPEG/PNG/WebP.
- `teacher-gallery`: private, 10 MiB limit, JPEG/PNG/WebP.

PostgreSQL stores object paths, not image bytes. Suggested paths:

```text
teacher-avatars/{userId}/avatar.webp
teacher-gallery/{userId}/01.webp
```

Uploads and signed download URLs should be mediated by `StorageModule`. Validate owner, MIME type, and size in NestJS. Do not expose the secret key to let React write directly.

## CLI setup

From Git Bash:

```bash
cd ~/Desktop/WorkSpace/MoreLi/backend
npx supabase login
npx supabase link --project-ref whzrmgntqsinkxfqymqz
```

From PowerShell:

```powershell
Set-Location C:\Users\erikp\Desktop\WorkSpace\MoreLi\backend
npx supabase login
npx supabase link --project-ref whzrmgntqsinkxfqymqz
```

Do not use an unescaped Windows path such as `cd C:\Users\...` in Git Bash. Use `/c/Users/...` or `~/Desktop/...`.

## Create a migration

```bash
npx supabase migration new add_example_column
```

Edit the generated file under `supabase/migrations/`. Use a descriptive snake-case name and forward-only SQL:

```sql
alter table public.example
  add column description text;

create index example_description_idx
  on public.example (description);
```

Rules:

- Never edit or rename a migration already applied to a shared/hosted database.
- Never create an empty migration and push it. Delete an accidental empty local file before deployment.
- Include grants/RLS implications for every new table, function, view, or sequence.
- Use explicit constraints and indexes for foreign keys and common filters.
- Put destructive changes in their own clearly named migration.

## Test migrations locally

Local Supabase requires Docker Desktop:

```bash
npx supabase start
npx supabase db reset --local
npx supabase db lint --local --level warning --fail-on error
```

`db reset --local` rebuilds the local database, applies every migration, and runs configured seed files. It is destructive only to the local Supabase database.

Never run `db reset --linked` against production. It drops user-created remote objects.

## Apply migrations remotely

Preferred workflow:

```bash
npx supabase db push --linked --dry-run
npx supabase db push --linked --include-seed
npx supabase db lint --linked --level warning --fail-on error
npm run supabase:types
npm run build
npm run lint
npm test
npm run test:e2e
```

`db push` reads local migration files, compares them with `supabase_migrations.schema_migrations`, applies only pending versions, and records successful versions. `--include-seed` also runs configured seed files and tracks their hashes.

The linked PostgreSQL connection may use the regional pooler. On this development network, the `eu-central-1` pooler timed out and the direct endpoint was not reachable. This is a network path limitation, not invalid project credentials.

## Management API SQL fallback

The authenticated CLI can execute SQL over the Supabase Management API when PostgreSQL ports are unreachable:

```bash
npx supabase db query \
  --linked \
  --project-ref whzrmgntqsinkxfqymqz \
  --file supabase/verify.sql
```

For a migration file:

```bash
npx supabase db query \
  --linked \
  --project-ref whzrmgntqsinkxfqymqz \
  --file supabase/migrations/<version>_<name>.sql
```

Use this only when normal `db push` is blocked. Requirements:

- The migration must be transaction-safe or contain its own `begin`/`commit`.
- Verify the hosted result immediately.
- Management API execution does not automatically update the CLI migration ledger.
- Record the applied version only after successful verification. Prefer `npx supabase migration repair <version> --status applied --linked` when the database connection works.
- If the pooler is unavailable, ledger repair itself must be executed carefully through Management API SQL using the CLI's exact current ledger schema. Do not guess or mark a failed migration as applied.

The initial Morali migration was applied through this fallback and then recorded as `202609110001 / initial_schema` after verification.

## Verification

Run the project verification query:

```bash
npx supabase db query \
  --linked \
  --project-ref whzrmgntqsinkxfqymqz \
  --file supabase/verify.sql
```

Expected baseline:

| Check | Expected |
| --- | ---: |
| Application tables | 15 |
| Application enums | 8 |
| Private buckets | 2 |
| RLS-enabled tables | 15 |
| Browser-role table grants | 0 |
| Auth profile trigger | 1 |
| Review inquiry link | 1 |
| Lifecycle columns | 3 |
| Business RPCs | 15 |
| Business triggers | 9 |
| Browser-role function grants | 0 |
| Recorded migrations | 10 |
| Subjects | 13 |
| Levels | 6 |
| Cities | 13 |

Add a change-specific read-only verification query for every migration rather than relying only on dashboard appearance.

## Update the schema

Example: add a nullable teacher profile field safely.

```bash
npx supabase migration new add_teacher_intro_video
```

```sql
alter table public.teacher_profiles
  add column intro_video_path text;
```

Then test, dry-run, push, verify, regenerate types, and update repositories/DTOs. For a non-null column on a populated table, use a staged migration:

1. Add it nullable or with a safe default.
2. Backfill existing rows.
3. Verify no nulls remain.
4. Add `NOT NULL` in the same transaction or a follow-up migration.

## Delete or rename schema objects

Never delete an applied migration file to undo a schema change. Create a new migration.

Example drop:

```bash
npx supabase migration new remove_unused_teacher_field
```

```sql
alter table public.teacher_profiles
  drop column if exists unused_field;
```

Before destructive SQL:

1. Search server and client usage.
2. Back up or migrate data.
3. Remove runtime reads/writes in a compatible deployment order.
4. Apply the destructive migration only after old code is no longer running.
5. Regenerate types and compile.

For renames used by deployed code, prefer add/backfill/switch/drop over a one-step rename to support rolling deployments.

## Seed data

`supabase/seed.sql` uses conflict-aware upserts and is idempotent. It may be run through normal push or directly:

```bash
npx supabase db query \
  --linked \
  --project-ref whzrmgntqsinkxfqymqz \
  --file supabase/seed.sql
```

Seed only stable reference data. Do not place production user accounts, secrets, or environment-specific business records in seed files.

## Generate database types

After every deployed schema change:

```bash
npm run supabase:types
```

This replaces `src/database/database.types.ts` with the hosted schema. Review the generated diff and run the build. Do not manually maintain table definitions in this generated file.

Generating types from the hosted project means local code reflects the deployed schema. During local-first development, generate from local Supabase before deployment and regenerate from hosted after deployment verification.

## Data deletion from NestJS

Deleting rows is an application operation, not a schema migration. Perform it through a repository after authorization:

```ts
const { error } = await this.supabase.client
  .from('favorites')
  .delete()
  .eq('student_id', currentUserId)
  .eq('teacher_id', teacherId);
```

The ownership predicates are part of the delete. Do not issue broad `.delete()` calls without filters. Use database cascades only where the migration explicitly defines and intends them.

## Operational safety checklist

Before a hosted migration:

- Confirm the selected project reference.
- Confirm the migration file is non-empty and reviewed.
- Test locally when Docker is available.
- Run a remote dry run when the pooler is reachable.
- Take a backup before destructive or high-risk changes.
- Do not print environment variables or use shell tracing around secrets.

After a hosted migration:

- Run verification queries.
- Confirm migration history.
- Regenerate TypeScript types.
- Build, lint, and test the backend.
- Exercise the affected endpoint.
- Check Supabase database and API logs for unexpected errors.

## Runtime endpoint contracts

Public reads are limited to health, active taxonomies, published teacher
profiles, availability/reviews, public avatar URLs, and anonymous
`POST /api/matching/preview`. All write operations and all student/teacher-owned
collections require a verified Clerk token or a legacy Supabase access token.

The standard path remains:

```text
Controller
  -> Service / policy
  -> Repository
  -> Supabase Data API, Storage, or service-role RPC
```

Public teacher responses omit phone numbers and internal user IDs. Student-side
inquiry responses expose only public teacher fields; teacher-side responses
expose only the student's display identity. Signed Storage uploads and private
reads are restricted to paths beginning with the verified user's UUID. Teacher
avatar URLs are signed for one hour only after resolving a published profile.

Self-service account deletion first moves any teacher profile out of the
published state and removes the user's objects through the Storage API. For a
Clerk-linked account it deletes the internal profile and cascaded application
data; the Clerk identity is managed through Clerk's user controls. For a legacy
Supabase account it deletes the Supabase Auth identity, and database cascades
remove application-owned rows. The ordering supports safe retries.