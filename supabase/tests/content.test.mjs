import { PGlite } from '@electric-sql/pglite';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createContentStore } from '../../content-store.mjs';
import { createGuideServer } from '../../server.mjs';

const a='00000000-0000-4000-8000-000000000001', b='00000000-0000-4000-8000-000000000002', admin='00000000-0000-4000-8000-000000000003';
const locationId='10000000-0000-4000-8000-000000000001', boulderId='20000000-0000-4000-8000-000000000001', problemId='30000000-0000-4000-8000-000000000001', imageId='40000000-0000-4000-8000-000000000001';
test('PostgreSQL content API round-trips nested data, enforces RLS and rolls back failed batches', async () => {
  const db = new PGlite();
  const dataDir = await mkdtemp(path.join(os.tmpdir(),'sideproj-content-'));
  let server;
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
      CREATE TABLE auth.users(id uuid PRIMARY KEY, raw_user_meta_data jsonb DEFAULT '{}');
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      GRANT USAGE ON SCHEMA auth TO anon,authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;
      CREATE SCHEMA storage;
      CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb,UNIQUE(bucket_id,name));
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      GRANT USAGE ON SCHEMA storage TO authenticated;GRANT SELECT,INSERT ON storage.objects TO authenticated;`);
    for (const name of ['20260909000100_initial_schema.sql','20260909000200_account_access.sql','20260910000100_content_api.sql','20260912000100_media_storage.sql','20260912000200_retire_local_storage.sql']) await db.exec(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));
    await db.exec(`INSERT INTO auth.users(id) VALUES ('${a}'),('${b}'),('${admin}'); UPDATE private.user_roles SET role='admin' WHERE user_id='${admin}';`);
    // Simulate PostgREST's transaction and authenticated role, without external network calls.
    async function rpc(name, values, user) {
      await db.exec('BEGIN');
      try {
        await db.exec('SET LOCAL ROLE '+(user?'authenticated':'anon'));
        await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[user||'']);
        const result = name==='read_content' ? await db.query('SELECT public.read_content() AS result') : await db.query('SELECT public.save_content($1,$2::jsonb) AS result',[values.expected_revision,JSON.stringify(values.operations)]);
        await db.exec('COMMIT'); return result.rows[0].result;
      } catch(error) { await db.exec('ROLLBACK'); throw error; }
    }
    const storage={async stat(){return {size:8,mime:'image/png'};}};
    const store=createContentStore({storage,env:{SUPABASE_URL:'https://fixture.example',SUPABASE_PUBLISHABLE_KEY:'test'},fetchImpl:async(url,options)=>{
      try { return new Response(JSON.stringify(await rpc(url.split('/').pop(),JSON.parse(options.body),options.headers.Authorization?.slice(7))),{status:200}); }
      catch(error) { return new Response(JSON.stringify({code:error.code,message:error.message}),{status:error.code==='42501'?403:400}); }
    }});
    const userA={id:a,name:'Climber',role:'contributor'}, userB={id:b,name:'Climber',role:'contributor'}, userAdmin={id:admin,name:'Admin',role:'admin'};
    let guide=await store.read();
    guide.locations.push({id:locationId,name:'Crag',region:'Region',latitude:'51.5',longitude:'-1.1',approach:'Walk uphill',boulders:[]});
    guide=await store.save(guide,userA,a);
    assert.equal(guide.locations[0].createdBy,a);
    const stale=structuredClone(guide);
    guide.locations[0].boulders.push({id:boulderId,name:'Boulder',notes:'Beside the tree',images:[],videos:[],problems:[]});
    guide=await store.save(guide,userB,b);
    assert.equal(guide.locations[0].boulders[0].createdBy,b);
    await assert.rejects(store.save(stale,userA,a),error=>error.status===409);
    const otherEdit=structuredClone(guide);otherEdit.locations[0].name='Not yours';
    await assert.rejects(store.save(otherEdit,userB,b),error=>error.status===403);
    // Verify the DB itself prevents bypassing the Node ownership checks.
    const current=await rpc('read_content',{},a);
    const badOps=[{table:'locations',action:'update',row:{...current.locations[0],name:'Forbidden'}}];
    await assert.rejects(rpc('save_content',{expected_revision:current.revision,operations:badOps},b),error=>error.code==='42501');
    const loc2={...current.locations[0],id:'10000000-0000-4000-8000-000000000002',name:'Must roll back',created_by:b};
    await assert.rejects(rpc('save_content',{expected_revision:current.revision,operations:[{table:'locations',action:'insert',row:loc2},...badOps]},b));
    assert.deepEqual(await store.read(),guide,'earlier inserts and revision increments roll back on forbidden later operation');
    await assert.rejects(rpc('save_content',{expected_revision:current.revision,operations:[]},null));
    const rock=guide.locations[0].boulders[0];
    const filename='50000000-0000-4000-8000-000000000001.png';
    // Server creates uploads directory below; metadata is persisted in PostgreSQL.
    const auth={async resolve(s){return s.user;},async login(){return {user:userB,accessToken:b};},async logout(){}};
    ({server}=await createGuideServer({contentStore:store,storage,auth}));
    await db.query("INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES ('sideproj-media',$1,$2,'{\"size\":8,\"mimetype\":\"image/png\"}')",[b+'/'+filename,b]);
    rock.images.push({id:imageId,name:'Photo',url:'/media/'+b+'/'+filename,annotations:[{type:'line',x:0,y:0,x2:100,y2:100}]});
    rock.problems.push({id:problemId,name:'Arete',grade:'6A',description:'Climb the edge',imageIds:[imageId],videoIds:[]});
    guide=await store.save(guide,userB,b);
    assert.equal((await store.read()).locations[0].boulders[0].problems[0].imageIds[0],imageId);
    const after=await rpc('read_content',{},b);
    await assert.rejects(rpc('save_content',{expected_revision:after.revision,operations:[{table:'private.user_roles',action:'insert',row:{}}]},b));
    // A direct dashboard change must invalidate the app's previous snapshot.
    await db.exec(`UPDATE public.locations SET name='Dashboard edit' WHERE id='${locationId}'`);
    await assert.rejects(store.save(guide,userB,b),error=>error.status===409);
    guide=await store.read();
    // Exercise the real HTTP routes, not a JSON fallback.
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base='http://127.0.0.1:'+server.address().port;
    assert.deepEqual(await fetch(base+'/api/guide').then(r=>r.json()),guide);
    const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const cookie=login.headers.get('set-cookie').split(';')[0];
    guide.locations[0].boulders[0].notes='HTTP edit';
    const response=await fetch(base+'/api/guide',{method:'PUT',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(guide)});
    assert.equal(response.status,200);guide=await response.json();
    await assert.rejects(readFile(path.join(dataDir,'guide.json')),'database mode never creates a JSON guide');
    const remove=structuredClone(guide);remove.locations=[];
    await assert.rejects(store.save(remove,userA,a),error=>error.status===403);
    assert.deepEqual((await store.save(remove,userAdmin,admin)).locations,[]);
    const empty=await rpc('read_content',{},admin);
    for(const table of ['locations','boulders','problems','media','problem_media']) assert.equal(empty[table].length,0);
  } finally {
    if(server){server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));}
    await db.close();
    if(!path.resolve(dataDir).startsWith(path.resolve(os.tmpdir())+path.sep+'sideproj-content-'))throw new Error('Unsafe cleanup');
    await rm(dataDir,{recursive:true,force:true});
  }
});
