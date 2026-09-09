import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY, raw_user_meta_data jsonb DEFAULT '{}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;`);
await db.exec(await readFile(new URL('../migrations/20260909000100_initial_schema.sql', import.meta.url), 'utf8'));
await db.exec(await readFile(new URL('../migrations/20260909000200_account_access.sql', import.meta.url), 'utf8'));
const a='00000000-0000-4000-8000-000000000001', b='00000000-0000-4000-8000-000000000002', admin='00000000-0000-4000-8000-000000000003';
await db.exec(`INSERT INTO auth.users(id) VALUES ('${a}'),('${b}'),('${admin}'); UPDATE private.user_roles SET role='admin' WHERE user_id='${admin}';`);
async function as(user, sql) {
  await db.exec('BEGIN');
  try {
    await db.exec('SET LOCAL ROLE ' + (user ? 'authenticated' : 'anon'));
    if (user) await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [user]);
    const result = await db.query(sql); await db.exec('COMMIT'); return result;
  } catch(e) { await db.exec('ROLLBACK'); throw e; }
}
assert.deepEqual((await as(a, 'SELECT * FROM public.current_account()')).rows, [{ id: a, display_name: 'Climber', role: 'contributor' }]);
assert.equal((await as(admin, 'SELECT * FROM public.current_account()')).rows[0].role, 'admin');
await assert.rejects(as(null, 'SELECT * FROM public.current_account()'));
const l=(await as(a,"INSERT INTO public.locations(name,latitude,longitude) VALUES ('Test',0,0) RETURNING id")).rows[0].id;
assert.equal((await as(null,'SELECT * FROM public.locations')).rows.length,1);
await assert.rejects(as(null,"INSERT INTO public.locations(name,latitude,longitude) VALUES ('Guest',0,0)"));
await assert.rejects(as(a,"INSERT INTO public.locations(name,latitude,longitude) VALUES ('Bad',91,0)"));
assert.equal((await as(b,`UPDATE public.locations SET name='Hacked' WHERE id='${l}' RETURNING id`)).rows.length,0);
assert.equal((await as(admin,`UPDATE public.locations SET name='Admin edit' WHERE id='${l}' RETURNING version`)).rows[0].version,2);
await assert.rejects(as(a,`UPDATE public.locations SET created_by='${b}' WHERE id='${l}'`));
await assert.rejects(as(a,`UPDATE private.user_roles SET role='admin' WHERE user_id='${a}'`));
const rock=(await as(b,`INSERT INTO public.boulders(location_id,name) VALUES ('${l}','Rock') RETURNING id`)).rows[0].id;
const rock2=(await as(a,`INSERT INTO public.boulders(location_id,name) VALUES ('${l}','Rock two') RETURNING id`)).rows[0].id;
const problem=(await as(a,`INSERT INTO public.problems(boulder_id,name,grade,description) VALUES ('${rock}','Line','6A','Climb') RETURNING id`)).rows[0].id;
const media=(await as(b,`INSERT INTO public.media(boulder_id,name,kind,storage_bucket,storage_path,mime_type,size_bytes) VALUES ('${rock}','photo','image','photos','one.jpg','image/jpeg',20) RETURNING id`)).rows[0].id;
const other=(await as(b,`INSERT INTO public.media(boulder_id,name,kind,storage_bucket,storage_path,mime_type,size_bytes) VALUES ('${rock2}','photo','image','photos','two.jpg','image/jpeg',20) RETURNING id`)).rows[0].id;
await assert.rejects(as(b,`INSERT INTO public.problem_media VALUES ('${problem}','${media}','${rock}')`));
await as(a,`INSERT INTO public.problem_media VALUES ('${problem}','${media}','${rock}')`);
await assert.rejects(as(a,`INSERT INTO public.problem_media VALUES ('${problem}','${other}','${rock}')`));
await assert.rejects(as(a,`DELETE FROM public.locations WHERE id='${l}'`));
await as(b,`DELETE FROM public.media WHERE id='${media}'`);
assert.equal((await as(null,'SELECT * FROM public.problem_media')).rows.length,0);
assert.equal((await as(null,'SELECT * FROM public.problems')).rows.length,1);
console.log('PASS: migration execution, signup profile, public reads, guest write rejection, coordinate range, ownership, admin edits, immutable creators, protected roles, cross-owner contributions, same-boulder attachments, restrictive parent deletion, media-link cleanup.');
await db.close();
