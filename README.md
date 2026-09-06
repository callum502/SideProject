# SideProj

A local React climbing field guide with a Node server and durable disk storage.

## Run

    npm install
    npm run dev

Open http://127.0.0.1:5173. Source edits rebuild and refresh the page automatically. The project uses a Vite build watcher to work with the installed Node 20 environment.

## Use

1. Create a location with a name, optional region, latitude/longitude, and approach notes.
2. Add boulders and route notes inside each location.
3. Open a boulder and upload JPEG, PNG, or WebP photos (8 MB per photo).
4. Open a photo and add red lines, boxes, or freehand marks. Undo or clear marks, then save. You can also focus the photo and use arrow keys and Enter to draw.
5. Export guide downloads a standalone HTML file containing the selected location, boulders, photos, and annotations. Send that file to another person; it opens in their browser without this server. Map links require internet access.

Copy local link links to the selected record on this computer. The app is not publicly hosted and does not include accounts or online collaboration.

## Storage

Records are saved in data/guide.json. Original photos are saved in data/uploads/. Back up the entire data folder together. These files are ignored by Git. Saves use revision checks to avoid overwriting a change from another browser tab. If a conflict is reported, reload before saving again.

## Validate and preview

    npm test
    npm run build
    npm run preview

Stop the development server before starting preview, as both use port 5173. Set PORT to choose a different port. The server binds only to 127.0.0.1. A hosted multi-user version will need authentication and managed storage.
