import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002',admin='00000000-0000-4000-8000-000000000003';
const file='10000000-0000-4000-8000-000000000001.png';
test('Storage policies and media references enforce ownership, size, immutable files and admin migration',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,raw_user_meta_data jsonb DEFAULT '{}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon,authenticated;GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,owner_id text DEFAULT auth.uid()::text,metadata jsonb DEFAULT '{}',UNIQUE(bucket_id,name));
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA storage TO anon,authenticated;GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;`);
  for(const m of ['20260909000100_initial_schema.sql','20260909000200_account_access.sql','20260910000100_content_api.sql','20260912000100_media_storage.sql'])await db.exec(await readFile(new URL('../migrations/'+m,import.meta.url),'utf8'));
  await db.exec(`INSERT INTO auth.users(id) VALUES ('${a}'),('${b}'),('${admin}');UPDATE private.user_roles SET role='admin' WHERE user_id='${admin}';`);
  async function as(user,sql,params=[]){await db.exec('BEGIN');try{await db.exec('SET LOCAL ROLE '+(user?'authenticated':'anon'));await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[user||'']);const result=await db.query(sql,params);await db.exec('COMMIT');return result;}catch(error){await db.exec('ROLLBACK');throw error;}}
  const l=(await as(a,"INSERT INTO public.locations(name,latitude,longitude) VALUES ('Crag',0,0) RETURNING id")).rows[0].id;
  const rock=(await as(a,"INSERT INTO public.boulders(location_id,name) VALUES ($1,'Rock') RETURNING id",[l])).rows[0].id;
  const media=(await as(a,"INSERT INTO public.media(boulder_id,name,kind,storage_bucket,storage_path,mime_type,size_bytes) VALUES ($1,'Photo','image','local',$2,'image/png',8) RETURNING *",[rock,file])).rows[0];
  const problem=(await as(a,"INSERT INTO public.problems(boulder_id,name,grade,description) VALUES ($1,'Line','6A','Edge') RETURNING id",[rock])).rows[0].id;
  await as(a,'INSERT INTO public.problem_media VALUES ($1,$2,$3)',[problem,media.id,rock]);
  async function upload(user,p,size=8){return as(user,"INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ('sideproj-media',$1,jsonb_build_object('size',$2::bigint,'mimetype','image/png'))",[p,size]);}
  await assert.rejects(upload(b,a+'/'+file),error=>error.code==='42501');
  await upload(admin,a+'/'+file);
  await assert.rejects(as(a,'SELECT public.migrate_media($1,$2,$3)',[media.id,media.version,a+'/'+file]),error=>error.code==='42501');
  await assert.rejects(as(null,'SELECT public.migrate_media($1,$2,$3)',[media.id,media.version,a+'/'+file]),error=>error.code==='42501');
  await as(admin,'SELECT public.migrate_media($1,$2,$3)',[media.id,media.version,a+'/'+file]);
  const saved=(await as(a,'SELECT * FROM public.media WHERE id=$1',[media.id])).rows[0];assert.equal(saved.created_by,a);assert.equal(saved.storage_bucket,'sideproj-media');
  assert.equal((await as(a,'SELECT * FROM public.problem_media')).rows.length,1);
  await assert.rejects(as(admin,'SELECT public.migrate_media($1,$2,$3)',[media.id,media.version,a+'/'+file]),error=>error.code==='40001');
  await as(a,"UPDATE public.media SET annotations='[{\"type\":\"line\",\"x\":0,\"y\":0,\"x2\":100,\"y2\":100}]' WHERE id=$1",[media.id]);
  await assert.rejects(as(admin,"UPDATE public.media SET storage_bucket='local',storage_path=$1 WHERE id=$2",[file,media.id]),error=>error.code==='42501');
  assert.equal((await as(b,'SELECT * FROM storage.objects')).rows.length,0);
  assert.equal((await as(admin,'DELETE FROM storage.objects RETURNING id')).rows.length,0,'no app role can remove underlying objects');
  assert.equal((await as(admin,"UPDATE storage.objects SET metadata='{}' RETURNING id")).rows.length,0);
  const otherFile='20000000-0000-4000-8000-000000000001.png';await upload(b,b+'/'+otherFile);
  const insert="INSERT INTO public.media(boulder_id,name,kind,storage_bucket,storage_path,mime_type,size_bytes) VALUES ($1,'New','image','sideproj-media',$2,'image/png',$3)";
  await assert.rejects(as(a,insert,[rock,b+'/'+otherFile,8]),error=>error.code==='42501');
  await assert.rejects(as(b,insert,[rock,b+'/'+otherFile,9]),error=>error.code==='23514');
  await as(b,insert,[rock,b+'/'+otherFile,8]);
  assert.equal((await as(a,'SELECT * FROM public.media')).rows.length,2);
  await db.exec(await readFile(new URL('../migrations/20260912000200_retire_local_storage.sql',import.meta.url),'utf8'));
  await assert.rejects(as(admin,'SELECT public.migrate_media($1,$2,$3)',[media.id,media.version,a+'/'+file]),error=>error.code==='42883');
  await assert.rejects(as(a,"INSERT INTO public.media(boulder_id,name,kind,storage_bucket,storage_path,mime_type,size_bytes) VALUES ($1,'Old','image','local',$2,'image/png',8)",[rock,file]),error=>['23514','42501'].includes(error.code));
  assert.equal((await db.query("SELECT file_size_limit FROM storage.buckets WHERE id='sideproj-media'")).rows[0].file_size_limit,104857600);
 }finally{await db.close();}
});
