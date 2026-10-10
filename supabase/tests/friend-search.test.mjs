import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
test('friend suggestions match partial names literally, exclude self and require login',async()=>{
 const db=new PGlite();try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '11111111-1111-4111-8111-111111111111'::uuid $$;CREATE TABLE profiles(id uuid,display_name text);INSERT INTO profiles VALUES(auth.uid(),'Alice'),(gen_random_uuid(),'Alice Rocks'),(gen_random_uuid(),'AL'),(gen_random_uuid(),'Bob');`);
 await db.exec(await readFile(new URL('../migrations/20261010000300_friend_search.sql',import.meta.url),'utf8'));
 await db.exec('SET ROLE authenticated;');
 assert.deepEqual((await db.query("SELECT display_name FROM search_friend_profiles(' al ')")).rows.map(r=>r.display_name),['AL','Alice Rocks']);
 assert.equal((await db.query("SELECT * FROM search_friend_profiles('%')")).rows.length,0);
 assert.equal((await db.query("SELECT * FROM search_friend_profiles(' ')")).rows.length,0);
 await db.exec('RESET ROLE;SET ROLE anon;');await assert.rejects(db.query("SELECT * FROM search_friend_profiles('al')"));
 }finally{await db.close();}
});
