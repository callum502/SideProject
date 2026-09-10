# Move climbing content to PostgreSQL

The Node API now supports Supabase PostgreSQL for locations, boulders, problems, media metadata, annotations and attachment links. Accounts continue to use Supabase Auth. Photos/videos themselves still use `data/uploads/` until the Storage migration.

## Activate on your existing project

1. In Supabase SQL Editor, run all of `migrations/20260910000100_content_api.sql` once. The initial schema and account-access migrations must already be applied. Keep the migration files in Git and record their application when using the dashboard.
2. Stop the local dev server with Ctrl+C so no local edits happen while importing. Keep a copy of the entire `data/` folder, including uploads.
3. From the project directory run `npm run content:prepare-import`. This writes `data/import-content.sql` and preserves `data/guide.json.before-database-import.bak`. It does not connect to Supabase. Run it again if content has changed since the previous preparation.
4. Open `data/import-content.sql`, copy the whole file into a new Supabase SQL Editor query, and run it. The file contains your actual content and account IDs: it is ignored by Git and must remain private. All creator accounts must already exist in this Supabase project. The import is transactional, retains UUIDs and relationships, and can be rerun with the same data without duplicates. If a matching record has changed, it fails rather than replacing the change. On a failed transaction, run `ROLLBACK;` before retrying in the same SQL session.
5. In `.env.local`, change `CONTENT_STORE=json` to `CONTENT_STORE=supabase`. Your URL and publishable key stay the same. No database password or service-role key is needed.
6. Run `npm run dev`, refresh the page and log in. You should see the imported locations. Create or edit a record, then check the corresponding table in Supabase Table Editor. The local `guide.json` should no longer change.

The current checkout stays in JSON mode until step 5. A Supabase error never silently falls back to JSON. Changing back to JSON only shows the old local copy; database edits are not copied back. Keep one active source of truth and do not alternate modes after accepting shared edits.

If an old author is still named `Admin` or `Contributor`, the import helper stops. Identify the real owner and add an explicit mapping in ignored `data/owner-map.json`, for example `{"Contributor":"THE-CONFIRMED-USER-UUID"}`. Never guess ownership. Missing coordinates, invalid IDs or missing files must be repaired before preparing the import.

## How saves work

- `read_content()` returns a consistent database snapshot. The backend maps relational rows to the existing frontend model, keeping navigation and forms intact.
- The backend checks ownership, computes only the changed rows, and sends those changes to `save_content()` using the user's verified Supabase access token.
- `save_content()` runs with the caller's permissions; existing row-level policies and constraints remain active. It saves related rows in a single transaction and rejects denied or missing rows.
- A database revision lock prevents a stale snapshot from overwriting newer edits. Triggers also advance the revision for direct table edits, including profile display-name changes.
- Private helper functions only read/lock/increment the revision; they cannot edit climbing content or grant roles.
- Media records currently use `storage_bucket = 'local'` as a transitional marker and store a local filename, MIME type and size. This is not a Supabase Storage bucket. Removing media removes metadata/links, but retains the local file just as before.

Whole-guide reads and revision conflicts suit the current small community. Pagination and per-record editing can be added if the guide becomes large; reads currently load the full guide.

## Validation

`npm test` runs the existing API/auth checks in explicit legacy JSON mode. For the PostgreSQL integration checks:

```sh
npm install --prefix supabase/tests
npm test --prefix supabase/tests
```

The isolated PGlite PostgreSQL tests exercise database migrations, actual RLS roles, atomic rollback, cross-owner contributions, metadata/attachment round trips, stale writes, direct SQL edits, deletion and the Node HTTP routes in database mode. They do not connect to your live project. After activating, check with a real contributor and your admin account too.

## Next step before publishing

Move photo/video files to Supabase Storage, migrate the existing uploads and add Storage access policies. Only then can the app run independently of the files on this computer. Production hosting, HTTPS/cookie settings and the custom domain follow that step.
