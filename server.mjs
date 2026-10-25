// Starts SideProj: `npm run dev` rebuilds the front end on change with live reload; `npm run preview` (--preview)
// serves the build. The server itself is in server/app.mjs.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, build } from 'vite';
import { createGuideServer, fullGuideOption } from './server/app.mjs';
import { createRequestLimits, testLimitOptions } from './server/request-limits.mjs';
import { deploymentConfig } from './server/deployment.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const live = !process.argv.includes('--preview');
const deployment = deploymentConfig();
const env = { ...loadEnv('development', process.cwd(), ''), ...process.env };
const app = await createGuideServer({
  live,
  deployment,
  requestLimits: createRequestLimits(testLimitOptions(env)),
  fullGuide: fullGuideOption(env),
});
if (live) {
  const watcher = await build({ root, resolve: { preserveSymlinks: true }, build: { watch: {}, minify: false } });
  await new Promise((resolve, reject) => {
    watcher.on('event', event => {
      if (event.code === 'END') {
        app.reload();
        resolve();
      }
      if (event.code === 'ERROR') {
        console.error(event.error);
        reject(event.error);
      }
    });
  });
}
const port = Number(process.env.PORT || 5173);
app.server.listen(port, deployment.host, () => console.log(`SideProj running at http://${deployment.host}:${port}/`));
