SideProj - A platform used to share information around outdoor bouldering locations worldwide.

As someone who enjoys bouldering both indoors and outdoors, I have noticed that information on outdoor bouldering locations can be very vague and hard to find. In the past I've found myself sinking hours into creating a google doc to collate information on a bouldering location from several vaguely worded sources. I developed this platform for myself and my local community to use as a simpler alternative to existing sites, forums and books.

This platform allows for and encourages uploading images and provides tools to annotate them in place, making it much easier to highlight the holds used for a specific problem. Each location also requires a set of coordinates and a link to the location on google maps is automatically generated from these making it much easier to understand how to travel to the location.

https://github.com/user-attachments/assets/9119a983-bfc9-44ac-96bf-ada8451b3cb6

If you are curious about the name, a "project" is slang in bouldering communities meaning a climbing problem someone is working on. This is often shortened to "Proj". The name SideProj plays on this by referencing the fact that the platform is my personal side project while it collates information for the users bouldering projects.



## Local setup and database content

Run `npm run dev` from this folder. Supabase account setup is documented in [ACCOUNTS.md](supabase/ACCOUNTS.md). To move existing JSON climbing content into PostgreSQL, follow [CONTENT.md](supabase/CONTENT.md). Configure `.env.local` from `.env.example`; `CONTENT_STORE=supabase` selects the database API, while `json` is the legacy local mode. Photos and videos still live locally until the Storage migration.
