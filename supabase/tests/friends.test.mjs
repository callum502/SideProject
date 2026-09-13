import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
test('friend invites require recipient acceptance, restrict logbooks and compute mutual sends',async()=>{
 const db=new PGlite();
 const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',c='44444444-4444-4444-8444-444444444444',p='33333333-3333-4333-8333-333333333333';
 try {
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE SCHEMA private;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
 CREATE TABLE public.profiles(id uuid PRIMARY KEY,display_name text); CREATE TABLE public.locations(id uuid PRIMARY KEY,name text);
 CREATE TABLE public.boulders(id uuid PRIMARY KEY,location_id uuid,name text);
 CREATE TABLE public.problems(id uuid PRIMARY KEY,boulder_id uuid,name text,grade text);
 INSERT INTO profiles VALUES('${a}','Alice'),('${b}','Bob'),('${c}','Bob'); INSERT INTO locations VALUES('${a}','Location'); INSERT INTO boulders VALUES('${a}','${a}','Boulder'); INSERT INTO problems VALUES('${p}','${a}','Problem','V1');`);
 for(const file of ['20260913000600_logbook.sql','20260913000700_friends.sql'])await db.exec(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const user=async id=>db.exec(`RESET ROLE; SET test.uid='${id}'; SET ROLE authenticated;`);
 const action=async (act,target=null,name=null)=>(await db.query('SELECT public.friends_action($1,$2,$3) AS result',[act,target,name])).rows[0].result;
 await user(a);
 assert.equal((await action('search',null,' bob ')).length,2);
 await assert.rejects(action('request',a));
 await action('request',b);assert.equal((await action('request',b)).length,1);
 await action('accept',b);assert.equal((await action('list'))[0].status,'pending');
 await assert.rejects(action('logbook',b));
 await db.query(`SELECT * FROM set_problem_log('${p}',true)`);
 await user(c);assert.deepEqual(await action('list'),[]);await action('accept',a);await assert.rejects(action('logbook',a));
 await user(b);await action('request',a);assert.equal((await action('list'))[0].status,'pending');
 await action('accept',a);assert.equal((await action('logbook',a)).entries[0].mutual,false);
 await db.query(`SELECT * FROM set_problem_log('${p}',true)`);
 assert.equal((await action('logbook',a)).entries[0].mutual,true);
 await assert.rejects(db.query('SELECT * FROM private.friendships'));
 await action('remove',a);await assert.rejects(action('logbook',a));
 await user(a);await assert.rejects(action('logbook',b));await action('request',b);
 await user(b);await action('decline',a);assert.deepEqual(await action('list'),[]);
 await db.exec('RESET ROLE; SET ROLE anon;');await assert.rejects(action('list'));
 }finally{await db.close();}
});
