# PostgreSQL content

Locations, boulders, problems, media metadata, image annotations and attachment links are stored in PostgreSQL. Uploaded file bytes are stored in Supabase Storage.

`read_content()` returns a consistent relational snapshot. The Node API maps it to the existing frontend model. Saves compute only changed rows and call `save_content()` with the authenticated user's token. RLS, constraints and immutable creator/parent checks enforce ownership. Related edits are transactional; a database revision lock prevents stale clients from overwriting newer changes, including direct table edits.

Contributors can create records beneath other contributors' locations and boulders, but can edit only their own records. Admins can edit all content. Removing a parent requires permission to remove its descendants.

The application has no JSON fallback and does not read or write `data/guide.json`. Historical data imports and migration screens have been retired. Do not rerun old generated import SQL against the live project.

The API currently reads the full guide and uses one revision for the guide. Pagination and per-record conflict handling can be introduced if the community grows. Database access uses the publishable key and verified user token, without a service-role key.
