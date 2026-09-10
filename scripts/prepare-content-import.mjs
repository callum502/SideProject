import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { toRows } from '../content-store.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = path.join(root, 'data');
const source = path.join(dataDir, 'guide.json');
const guide = JSON.parse(await readFile(source, 'utf8'));
let owners = {};
try { owners = JSON.parse(await readFile(path.join(dataDir, 'owner-map.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const seen = new Set();
function visit(items) {
  for (const item of items || []) {
    if (!uuid.test(item.id) || seen.has(item.id)) throw new Error('Every imported record needs a unique UUID. Import stopped; source unchanged.');
    seen.add(item.id);
    item.createdBy = owners[item.createdBy || 'Admin'] || item.createdBy;
    if (!uuid.test(item.createdBy)) throw new Error('An author has no individual account ID. Add an explicit legacy-author-to-UUID mapping in data/owner-map.json. Import stopped.');
    for (const child of ['boulders','problems','images','videos']) visit(item[child]);
  }
}
visit(guide.locations);
const rows = await toRows(guide, dataDir);
const marker = '$import_' + randomUUID().replaceAll('-', '') + '$';
let sql = `-- PRIVATE CONTENT: generated from local data. Do not commit this file.\n-- Run in Supabase SQL Editor after the content API migration. Files remain local.\nBEGIN;\nSET LOCAL standard_conforming_strings = on;\nSELECT private.lock_content_revision(private.content_revision());\n`;
for (const [table, items] of Object.entries(rows)) {
  if (!items.length) continue;
  const columns = Object.keys(items[0]);
  const list = columns.join(', ');
  const selected = columns.map(c => 'r.'+c).join(', ');
  const predicate = table === 'problem_media' ? 't.problem_id = r.problem_id AND t.media_id = r.media_id' : 't.id = r.id';
  const equality = columns.map(c => `t.${c} IS NOT DISTINCT FROM r.${c}`).join(' AND ');
  const payload = marker + JSON.stringify(items) + marker;
  sql += `\nINSERT INTO public.${table} (${list}) SELECT ${selected} FROM jsonb_populate_recordset(NULL::public.${table},${payload}::jsonb) r ON CONFLICT DO NOTHING;\n`;
  sql += `DO $check$ BEGIN IF EXISTS (SELECT 1 FROM jsonb_populate_recordset(NULL::public.${table},${payload}::jsonb) r WHERE NOT EXISTS (SELECT 1 FROM public.${table} t WHERE ${predicate} AND ${equality})) THEN RAISE EXCEPTION 'Import conflicts with existing ${table}; no changes have been committed.'; END IF; END $check$;\n`;
}
sql += "\nCOMMIT;\nSELECT jsonb_array_length(public.read_content()->'locations') AS location_count;\n";
await mkdir(dataDir, {recursive:true});
try { await copyFile(source, path.join(dataDir,'guide.json.before-database-import.bak'), constants.COPYFILE_EXCL); } catch(error) { if(error.code !== 'EEXIST') throw error; }
await writeFile(path.join(dataDir, 'import-content.sql'), sql);
console.log('Prepared data/import-content.sql and preserved the JSON backup. Nothing has been sent to Supabase.');
console.log(Object.fromEntries(Object.entries(rows).map(([table,items]) => [table, items.length])));
