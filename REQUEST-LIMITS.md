# Request and upload protection

Restart the local server or redeploy to Render to activate these changes. No new SQL migration, external service or environment variable is needed.

| Limit | Scope |
| --- | --- |
| 300 requests per 60 seconds | Per IP, API requests, media redirects and Google callback combined |
| 240 requests per 60 seconds | Per signed-in account, across sessions and IPs |
| 20 authentication requests per 10 minutes | Per IP, login/signup/confirmation/recovery/password reset/Google start and callback combined; also per account if already signed in |
| 60 write requests per 60 seconds | Per IP and per account; non-authentication POST/PUT/DELETE requests combined |
| 20 upload attempts per 60 seconds | Per IP and per account; images and videos combined |
| 1 simultaneous upload | Per account |
| 2 simultaneous uploads | Per server process |
| 32 simultaneous handled requests | Per process, across the protected routes |

Limits overlap; an upload counts towards general, write and upload limits. Authentication attempts count whether they succeed or fail. Starting Google sign-in and its callback use two authentication requests. Fixed windows begin with the first request; their allowance resets when that window expires. People sharing a network also share its IP allowance. IPv6 addresses are grouped by /64 to reduce address-rotation bypasses.

IP and capacity checks happen before authentication/database work. Account limits use the account ID in a server-held session, not supplied user IDs. Upload slots are held through the Storage call and released on completion or failure. Limits reject rather than queue excess work. Rate rejections return HTTP 429, server-capacity rejections return 503, and both provide Retry-After in seconds. Clients show the error; they do not automatically retry uploads.

Upload bodies have a 5-minute total deadline and a 30-second no-data deadline. Other request bodies have a 30-second total deadline. Header receipt has a 15-second server timeout; the server's overall request-receipt timeout is 330 seconds. Supabase Storage calls retain their existing 180-second timeout, separate from receiving the file. Timeout/size rejections close incomplete requests rather than buffering the remaining upload. Health checks are exempt. Static assets are outside this app limiter.

Browser tests run their own local server with `E2E_RELAX_LIMITS=1`, which multiplies the counts above by 100 (and allows 8 simultaneous uploads), because every Playwright worker shares 127.0.0.1. The server refuses to start with it when `NODE_ENV=production`, on Render, or when `SUPABASE_URL` isn't local. Never set it anywhere else.

## Deployment scope

Counters and slots are in memory, bounded to 10,000 rate-limit keys, and reset on restart. They are appropriate for the current single-process service. Multiple Render instances/workers would each have their own allowances; use a shared limiter (for example Redis) before scaling horizontally. There is no new paid service for this implementation.

On Render only (`RENDER=true`), client IP uses the first X-Forwarded-For entry, following [Render's documented platform behaviour](https://feedback.render.com/features/p/send-the-correct-x-forwarded-for). Elsewhere it uses the socket peer and ignores forwarding headers. If changing hosting/proxy topology, revisit this trust boundary; never enable Render proxy trust on a publicly reachable untrusted origin. Verify client-IP behaviour against actual Render traffic when deploying.

These controls protect work performed by the Node server. They do not cover direct requests to Supabase Auth/Storage/database APIs, public Storage downloads, network floods, or all multi-account abuse. Keep provider DDoS protection and Supabase authentication protections enabled. Stored-file quotas remain independently enforced in SQL. This change does not add CAPTCHA or response caching.
