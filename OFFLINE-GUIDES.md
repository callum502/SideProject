# Offline location downloads

Use **Download location** in the location banner, then **Download ZIP**. Extract the complete archive and open `index.html` in a browser. Keep the `media` folder beside it. The ZIP also contains instructions and a JSON snapshot for reference.

The guide includes coordinates, approach notes, parking photos/captions, boulder directions and other notes, problem names/grades/descriptions, creator credits, photos, per-problem annotations, and all original videos. Shared media is stored only once. External links are retained and labelled as requiring internet; map tiles and external resources are not downloaded. Changes made on the website after downloading do not update an existing guide.

Videos keep their original format and quality. A browser that cannot play a codec can use the **Open video file** link and a compatible installed player. Mobile file preview apps, especially HTML previews, may not load sibling media or provide browser functionality; verify the extracted guide on the intended device before travelling. This is a portable archive, not an installed offline mobile app.

No SQL migration is required. Restart the server/redeploy after updating the app.

The endpoint `/api/location-download?id=LOCATION_UUID` streams a ZIP64 archive with backpressure and one media request at a time. It supports archives above 4 GB without keeping all video data in server memory. Downloads contain actual binary files rather than remote media URLs. A disconnected client cancels the active Storage fetch. A missing, truncated or oversized media response fails the download rather than delivering a seemingly complete guide with missing files. Restart failed downloads; resume is not supported.

There is one active export per process and two attempts per ten minutes per IP/account. Exports have a 30-minute overall deadline and each Storage request a three-minute deadline. Original videos can make archives several GB; downloads consume both Supabase egress and Render outbound transfer. These limits are separate from simultaneous-upload limits.

Validation: unit/HTTP tests cover guide content and escaping, attachment deduplication, annotations, ZIP directory structure, original media bytes, failed media and invalid locations. A generated ZIP was also read successfully using Windows .NET ZipArchive. Real iPhone/Android file-app compatibility has not been device-tested.
