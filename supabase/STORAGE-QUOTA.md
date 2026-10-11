# Per-account storage allowance

Apply `migrations/20261011000200_user_storage_limit.sql` in the Supabase SQL Editor, then restart/redeploy the app. Uploads fail closed until this migration is applied.

The allowance is 10 GB (10,000,000,000 bytes) per uploader, including profile photos, parking photos, boulder/problem media, and unattached files in `sideproj-media`. Existing objects are counted during migration. Existing accounts over their allowance retain their files but cannot increase their usage. The separate 50-media-per-location limit still applies.

The app checks capacity before sending bytes to Supabase. An atomic database counter on Storage object writes also checks the final stored size, including direct Storage API requests and concurrent uploads. Pending transfers can still consume temporary bandwidth; this is a stored-file quota, not a bandwidth or request-rate limit. Storage's permission probes roll back quota changes, and committed objects are counted once. Metadata without a known size conservatively counts as 100 MiB until Storage supplies its size.

Usage is attributed by the immutable uploader prefix in the object path, so removing account ownership does not reset the count. Only the signed-in user's usage is exposed by `my_storage_usage()`. Their profile displays their usage. There is no admin upload exemption.

Removing an attachment or media record does not delete the stored file or free quota. Unattached files and replaced avatars continue to count until physically removed. Automatic unused-file cleanup is not implemented in this migration. If an administrator removes an unused file, use the Supabase Storage UI/API, never SQL deletion of `storage.objects`; verify it is not referenced by any media or profile photo first. Successful Storage deletion automatically releases its allowance.

No bucket versioning is enabled by this feature. Reassess accounting before enabling versioning or introducing additional media buckets, since this counter tracks current objects in `sideproj-media`.
