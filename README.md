SideProj - A platform used to share information around outdoor bouldering locations worldwide.

As someone who enjoys bouldering both indoors and outdoors, I have noticed that information on outdoor bouldering locations can be very vague and hard to find. In the past I've found myself sinking hours into creating a google doc to collate information on a bouldering location from several vaguely worded sources. I developed this platform for myself and my local community to use as a simpler alternative to existing sites, forums and books.

This platform allows for and encourages uploading images and provides tools to annotate them in place, making it much easier to highlight the holds used for a specific problem. Each location also requires a set of coordinates and a link to the location on google maps is automatically generated from these making it much easier to understand how to travel to the location.

https://github.com/user-attachments/assets/9119a983-bfc9-44ac-96bf-ada8451b3cb6

If you are curious about the name, a "project" is slang in bouldering communities meaning a climbing problem someone is working on. This is often shortened to "Proj". The name SideProj plays on this by referencing the fact that the platform is my personal side project while it collates information for the users bouldering projects.



## Development setup

Copy `.env.example` to `.env.local` and provide your Supabase URL and publishable key. Run `npm run dev` from this folder. Accounts, content and uploads always use Supabase. See [Supabase setup](supabase/README.md) for schema and account configuration. Run `npm test` and `npm run build` to check changes.

## Render deployment

Use a Node Web Service with build command `npm ci --include=dev && npm run build` and start command `npm run preview`.

In Render's Environment settings, set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` to the values from your local environment, and `NODE_ENV=production`. Do not commit `.env.local` or use a service-role/secret key. Set `APP_ORIGINS=https://sideproj.rocks,https://www.sideproj.rocks` when attaching those custom domains. Render's own HTTPS URL is allowed automatically; other hosts and cross-origin requests are rejected.

Set the health check path to `/healthz`. This checks the web server, not Supabase connectivity. Production listens on `0.0.0.0` using Render's `PORT` and sets Secure login cookies. Render terminates public HTTPS before forwarding requests to Node.

Keep one instance: sessions are currently stored in server memory, so restarts/deploys require signing in again. This deployment configuration does not add CAPTCHA, account/upload rate limits, per-user storage quotas or upload concurrency limits; those remain separate work before an unrestricted public launch.
