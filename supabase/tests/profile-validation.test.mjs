import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
test('profile repair accepts current height bounds and unknown ape index for old accounts',async()=>{
 const db=new PGlite();
 try {
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE SCHEMA private;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '11111111-1111-4111-8111-111111111111'::uuid $$;
 CREATE TABLE public.profiles(id uuid PRIMARY KEY,display_name text);
 INSERT INTO profiles VALUES(auth.uid(),'Old account');
 CREATE TABLE private.account_details(user_id uuid PRIMARY KEY,height_cm integer CHECK(height_cm BETWEEN 100 AND 230),ape_index_inches integer CHECK(ape_index_inches BETWEEN -8 AND 8));`);
 await db.exec(await readFile(new URL('../migrations/20260913000900_profile_validation.sql',import.meta.url),'utf8'));
 await db.exec('SET ROLE authenticated;');
 for(const height of [30,180,333]) await db.query('SELECT complete_profile($1,$2,$3)',['Old account',height,null]);
 await assert.rejects(db.query("SELECT complete_profile('Old account',334,null)"));
 await assert.rejects(db.query("SELECT complete_profile('Old account',180,9)"));
 await db.exec('RESET ROLE;');
 const row=(await db.query('SELECT * FROM private.account_details')).rows[0];
 assert.equal(row.height_cm,333);assert.equal(row.ape_index_inches,null);
 }finally{await db.close();}
});
