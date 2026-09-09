# Step 2: create the SideProj database structure

This folder prepares the SQL database. It does not switch the app away from JSON, import your content, create Storage buckets, or replace the demo login.

## Apply to your fresh Supabase development project

1. Back up the app's entire `data` folder.
2. Open your new project in the Supabase dashboard.
3. Open **SQL Editor** and create a new query.
4. Open `supabase/migrations/20260909000100_initial_schema.sql` in VS Code. Copy the whole file into the query.
5. Check that you selected the intended development project, then click **Run** once. The SQL uses a transaction: a failure rolls back the changes.
6. Open **Table Editor**. You should see `profiles`, `locations`, `boulders`, `problems`, `media`, and `problem_media` in the public schema.
7. Run the read-only checks in `supabase/verify.sql`. Every listed table should have row-level security enabled, and the policies should be present.

If a table already exists, stop and inspect it instead of dropping it or repeatedly rerunning this migration. This file targets a fresh project, not an existing schema with the same names.

Save this migration to Git. Once it has been applied, keep it unchanged: future schema changes go in a new timestamped SQL file.

### Migration tracking

Running SQL in the dashboard does not automatically register a Supabase CLI migration. For this first dashboard application, save the query as `20260909000100_initial_schema` and record the project and application date below.

- Project: __________________
- Applied on: _______________

If you later adopt the CLI, first verify this exact migration was successfully applied to the linked project, then reconcile its history with:

    npx supabase migration repair 20260909000100 --status applied

Do not run `db push` with this file marked pending against a database where you already applied it manually. Do not mark it applied if the SQL failed. For future work, choose the CLI migration workflow rather than mixing dashboard edits and untracked changes.

## What the tables contain

| Table | Purpose |
|---|---|
| profiles | Public display name, linked to a real Supabase Auth user |
| private.user_roles | Protected admin/contributor role; not publicly accessible |
| locations | Name, region, required coordinates, approach notes, creator |
| boulders | Parent location, name, finding directions, creator |
| problems | Parent boulder, name, grade, description, creator |
| media | Parent boulder, file metadata, storage reference, annotations, creator |
| problem_media | Links a problem to media belonging to the same boulder |

The schema uses UUIDs. The current app generates UUIDs, so valid existing IDs can be retained during import. User names such as `Admin` must be mapped to real Auth user UUIDs. Legacy locations without coordinates need real coordinates before import; do not invent them.

No passwords or email addresses are copied into public profiles. Signup creates a profile and contributor role. The supplied display name is optional; the fallback is `Climber`.

## Set your own account as admin later

First create a real account through Supabase Auth (not by inserting into `profiles`). Copy its UUID from **Authentication > Users**. In the SQL Editor, replace the placeholder before running:

    UPDATE private.user_roles
    SET role = 'admin'
    WHERE user_id = 'YOUR-AUTH-USER-UUID';

Verify exactly your intended account was updated. Users cannot promote themselves through the app or signup metadata. All existing Auth accounts present when this migration runs begin as contributors too.

## Permission rules

- Guests can read public climbing records and display names.
- Authenticated users can create their own records underneath anyone's location or boulder.
- Contributors update/delete only their own records; admins can update/delete any record.
- Creator and parent references cannot be reassigned by an ordinary update, even by an admin.
- Only the problem owner or an admin can add/remove its attachments.
- Deleting a problem removes its attachment links, but keeps the media.
- Deleting media clears its problem links, but does not delete the storage object. Object cleanup belongs in the future backend.
- Locations and boulders use restrictive foreign keys. Delete children in a transaction before deleting the parent. Row-level permissions prevent a contributor from silently deleting another user's descendants; administrators can delete the whole hierarchy explicitly.
- Account deletion is blocked while its profile/content remains referenced. A deliberate account-deletion/anonymisation workflow is needed before public launch.

## Connecting the Node backend comes next

The app still reads/writes JSON and uses demo sessions. This migration alone cannot change app behaviour.

For the later SQL integration, authenticated API requests need a verified Supabase user identity. The policies expect `auth.uid()` to identify that user. With direct SQL, use a dedicated restricted connection role, verify the user's JWT on the Node server, then set the database role and verified request claims locally inside a transaction. Never accept role/creator claims from unverified request bodies. Always reset context through transaction scoping and use a connection pool correctly.

Do not use the project `postgres` owner or a service-role key for ordinary user requests: privileged connections can bypass row-level security. This step deliberately does not create a login role, distribute credentials, or enable that connection yet.

Use parameterised queries. Updates should include `WHERE id = $1 AND version = $2`; no returned row means a conflict or denied access. The update trigger increments the version. Write related changes in one transaction.

Storage setup must separately enforce file ownership, MIME/signature validation, size limits, and bucket policies. This schema holds metadata only; it does not verify that an uploaded object exists. It permits 100 MB video metadata to match the app, but Supabase Free has a 50 MB per-file storage limit.

## JSON mapping for the later import

- `location.approach` -> `locations.approach_notes`
- `boulder.notes` -> `boulders.finding_notes`
- `createdBy` -> `created_by` after mapping demo names to real user UUIDs
- `images` and `videos` -> `media` with the appropriate `kind`
- Local `url` -> uploaded file's `storage_bucket` and `storage_path`
- `annotations` -> the same data in the `jsonb` annotations column
- `problem.imageIds` and `problem.videoIds` -> `problem_media` rows

## References

- https://supabase.com/docs/guides/deployment/database-migrations
- https://supabase.com/docs/guides/auth/managing-user-data
- https://supabase.com/docs/guides/database/postgres/row-level-security

## Local schema checks

The migration was executed against PGlite (an embedded PostgreSQL runtime) with a minimal Supabase Auth test fixture. Checks passed for schema creation, profile creation, public reads, guest write rejection, ownership, admin access, role protection, coordinate constraints, same-boulder media links, and deletion behaviour. This is not a hosted Supabase integration test; still run verify.sql on your project.

To rerun without connecting to Supabase or touching your data:

    npm install --prefix supabase/tests
    npm test --prefix supabase/tests

These test-only dependencies stay separate from the app dependencies. Tests run in memory.

