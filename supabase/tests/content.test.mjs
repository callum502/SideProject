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
    for (const name of ['20260909000100_initial_schema.sql','20260909000200_account_access.sql','20260910000100_content_api.sql','20260912000100_media_storage.sql','20260912000200_retire_local_storage.sql','20260912000300_problem_annotations.sql','20260912000400_boulder_notes.sql','20260913000100_location_photos.sql','20260913000200_remove_region.sql','20260913000300_location_links.sql','20260913000400_profile_details.sql']) await db.exec(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));
    await db.exec(`INSERT INTO auth.users(id) VALUES ('${a}'),('${b}'),('${admin}'); UPDATE private.user_roles SET role='admin' WHERE user_id='${admin}';`);
    await db.exec('BEGIN; SET LOCAL ROLE authenticated');
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[a]);
    await db.query('SELECT public.complete_profile($1,$2,$3)',['My name',180,2]);
    const details=(await db.query('SELECT * FROM public.current_account()')).rows[0];
    assert.equal(details.height_cm,180);assert.equal(details.ape_index_inches,2);assert.equal(details.profile_complete,true);assert.equal(details.role,'contributor');
    await db.exec('COMMIT');
    await db.exec('BEGIN; SET LOCAL ROLE authenticated');
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[b]);
    assert.equal((await db.query('SELECT * FROM public.current_account()')).rows[0].height_cm,null);
    await assert.rejects(db.query('SELECT * FROM private.account_details'),error=>error.code==='42501');
    await db.exec('ROLLBACK');
    await db.exec('BEGIN; SET LOCAL ROLE authenticated');
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[b]);
    await assert.rejects(db.query('SELECT public.complete_profile($1,$2,$3)',['Bad',180,9]),error=>error.code==='23514');
    await db.exec('ROLLBACK');
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
    assert.equal((await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='locations' AND column_name='region'")).rows.length,0);
    let guide=await store.read();
    guide.locations.push({id:locationId,name:'Crag',latitude:'51.5',longitude:'-1.1',approach:'Walk uphill',boulders:[]});
    guide=await store.save(guide,userA,a);
    assert.equal(guide.locations[0].createdBy,a);
    const stale=structuredClone(guide);
    guide.locations[0].boulders.push({id:boulderId,name:'Boulder',notes:'Beside the tree',otherNotes:'Granite; place mats below the lip',images:[],videos:[],problems:[]});
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
    const marks=[{type:'box',color:'green',x:10,y:20,x2:100,y2:120}];
    guide.locations[0].boulders[0].problems[0].photoAnnotations={[imageId]:marks};
    guide=await store.save(guide,userB,b);
    guide.locations[0].boulders[0].problems.push({id:'30000000-0000-4000-8000-000000000002',name:'Other line',grade:'6B',description:'Different holds',imageIds:[imageId],videoIds:[],photoAnnotations:{[imageId]:[{type:'arrow',color:'red',x:40,y:40,x2:200,y2:200}]}});
    guide=await store.save(guide,userA,a);
    assert.deepEqual(guide.locations[0].boulders[0].problems[0].photoAnnotations[imageId],marks);
    const forbidden=structuredClone(guide);forbidden.locations[0].boulders[0].problems[0].photoAnnotations={};
    await assert.rejects(store.save(forbidden,userA,a),error=>error.status===403);
    const snapshot=await rpc('read_content',{},a);
    await assert.rejects(rpc('save_content',{expected_revision:snapshot.revision,operations:[{table:'problems',action:'update',row:{...snapshot.problems[0],photo_annotations:{}}}]},a),error=>error.code==='42501');
    guide.locations[0].boulders[0].problems[1].photoAnnotations={};
    guide=await store.save(guide,userA,a);
    assert.deepEqual(guide.locations[0].boulders[0].problems[0].photoAnnotations[imageId],marks);
    assert.equal(guide.locations[0].boulders[0].otherNotes,'Granite; place mats below the lip');
    const emptyDirections=structuredClone(guide);emptyDirections.locations[0].boulders[0].notes='   ';
    await assert.rejects(store.save(emptyDirections,userB,b),error=>error.status===400);
    const parkingFile='50000000-0000-4000-8000-000000000009.png';
    await db.query("INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES ('sideproj-media',$1,$2,'{\"size\":8,\"mimetype\":\"image/png\"}')",[b+'/'+parkingFile,b]);
    guide.locations[0].photos.push({id:'40000000-0000-4000-8000-000000000009',name:'Parking',caption:'Park beside the gate',url:'/media/'+b+'/'+parkingFile,annotations:[]});
    guide=await store.save(guide,userB,b);
    assert.equal(guide.locations[0].photos[0].caption,'Park beside the gate');
    const stolenCaption=structuredClone(guide);stolenCaption.locations[0].photos[0].caption='Changed';
    await assert.rejects(store.save(stolenCaption,userA,a),error=>error.status===403);
    const parkingSnapshot=await rpc('read_content',{},a);
    const parkingRow=parkingSnapshot.media.find(m=>m.location_id===locationId);
    await assert.rejects(rpc('save_content',{expected_revision:parkingSnapshot.revision,operations:[{table:'media',action:'update',row:{...parkingRow,caption:'Forbidden'}}]},a),error=>error.code==='42501');
    guide.locations[0].links=[{label:'Local guidebook',url:'https://example.com/book'}];
    guide=await store.save(guide,userA,a);
    assert.equal(guide.locations[0].links[0].label,'Local guidebook');
    const unsafeLinks=structuredClone(guide);unsafeLinks.locations[0].links=[{label:'Unsafe',url:'javascript:alert(1)'}];
    await assert.rejects(store.save(unsafeLinks,userA,a),error=>error.status===400);
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
