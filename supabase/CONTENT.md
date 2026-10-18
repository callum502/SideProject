# PostgreSQL content

Locations, boulders, problems, media metadata, image annotations and attachment links are stored in PostgreSQL. Uploaded file bytes are stored in Supabase Storage.

`read_content()` returns a consistent relational snapshot. The Node API maps it to the existing frontend model. The browser sends only the records it changed, each with the copy it started from (`guide-changes.mjs`). The API applies them to the latest guide, validates the result, and calls `save_content()` with only the changed rows and the authenticated user's token. RLS, constraints and immutable creator/parent checks enforce ownership. Related edits are transactional.

Conflicts are per record. A save fails with HTTP 409 only when a record it changes has changed since the user loaded it, or when it removes a parent that has gained children since. Saves to different records succeed concurrently. The API compares each changed record with the latest copy, and `save_content()` also requires each updated or deleted row to still have the `version` that was read. This catches changes made between the API's read and its write, including direct table edits.

Contributors can create records beneath other contributors' locations and boulders, but can edit only their own records. Admins can edit all content. Removing a parent requires permission to remove its descendants.

The application has no JSON fallback and does not read or write `data/guide.json`. Historical data imports and migration screens have been retired. Do not rerun old generated import SQL against the live project.

Each save still reads the full guide once so that ownership, post limit, media limit and validation checks run against the merged result. Moving those checks into SQL would remove that read; pagination can be introduced if the community grows. Database access uses the publishable key and verified user token, without a service-role key.
