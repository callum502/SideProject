# Supabase Storage

Photos and videos are uploaded to the public `sideproj-media` bucket. The Node server validates file signatures and limits, then uploads using the signed-in user's token. Limits are 8 MB for images and 100 MB for videos. The global Supabase Storage limit must allow 100 MB as well as the bucket limit.

File paths are scoped to creator account IDs. SQL checks ensure object size/type and creator match the media record. Existing objects cannot be overwritten by the app. `/media/...` routes redirect to Storage for playback and downloads; `/uploads/...` local-file routes have been removed.

The Storage migration is complete. The one-time migration screen, endpoints, import scripts and verification-download code have been retired. Apply `migrations/20260912000200_retire_local_storage.sql` to remove the database migration function and reject local references too. Earlier migration files remain as schema history.

Removing media from the guide removes its database record and attachment links. Underlying objects are retained and remain accessible through their public URLs until an administrator removes them through Storage. Check references before deleting objects. Automated cleanup remains a separate follow-up.

New uploads use the Storage HTTP API with a three-minute request timeout. Failed uploads must be retried from the start. Storage and bandwidth usage count toward your Supabase plan. MOV playback depends on browser codec support; downloads retain the original file.

For production deployment, configure the Node server's host/origin checks, HTTPS cookies and session persistence. The development server still binds to localhost; cloud storage does not publish the app by itself.
