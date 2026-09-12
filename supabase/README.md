# Supabase setup

SideProj uses Supabase Auth, PostgreSQL content tables and Supabase Storage. There is no JSON storage mode or local media server.

For a new project, apply every file in `migrations/` in filename order using the Supabase SQL Editor, once each. The Storage migration creates a public `sideproj-media` bucket with a 100 MB file limit. Configure the project's global Storage limit accordingly. Copy `.env.example` to `.env.local` and provide the project URL and publishable key.

For the existing migrated project, only the new `20260912000200_retire_local_storage.sql` remains to apply. It refuses to run if any media still has a local reference, removes the one-time database migration function and enforces cloud-only media. It deletes no content or files.

Keep all historical migrations in Git unchanged: they reproduce the schema and permission history. Dashboard execution does not automatically register Supabase CLI migration history; reconcile applied versions before adopting `db push`.

- [Accounts and admin setup](ACCOUNTS.md)
- [Content API](CONTENT.md)
- [Storage](STORAGE.md)
- `verify.sql`: read-only schema/security checks.

Run application tests with `npm test`. Run isolated PostgreSQL/RLS tests with:

```sh
npm install --prefix supabase/tests
npm test --prefix supabase/tests
```

These tests use an in-memory PGlite database and Auth/Storage schema fixtures. They do not connect to the live Supabase project.
