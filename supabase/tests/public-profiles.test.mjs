import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
test('public profiles expose only selected details and that users climbs',async()=>{
 const db=new PGlite();const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
 try {
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA private;CREATE TABLE profiles(id uuid PRIMARY KEY,display_name text,email text);INSERT INTO profiles VALUES('${a}','Alice','private@example.com'),('${b}','Bob','secret@example.com');
 CREATE TABLE private.account_details(user_id uuid,height_cm integer,ape_index_inches integer);INSERT INTO private.account_details VALUES('${a}',180,2);
 CREATE TABLE problems(id uuid,boulder_id uuid,name text,grade text);CREATE TABLE boulders(id uuid,location_id uuid,name text);CREATE TABLE locations(id uuid,name text);
 CREATE TABLE private.problem_logs(entry_id uuid DEFAULT gen_random_uuid(),user_id uuid,problem_id uuid,location_id uuid,boulder_id uuid,problem_name text,grade text,boulder_name text,location_name text,logged_at timestamptz DEFAULT now());
 INSERT INTO private.problem_logs(user_id,problem_name,grade) VALUES('${a}','Deleted climb','V3'),('${b}','Other climb','V1');`);
 await db.exec(await readFile(new URL('../migrations/20261010000100_public_profiles.sql',import.meta.url),'utf8'));
 await db.exec('SET ROLE anon;');
 const data=(await db.query('SELECT read_public_profile($1) AS profile',[a])).rows[0].profile;
 assert.deepEqual(Object.keys(data).sort(),['apeIndex','entries','height','id','name']);
 assert.equal(data.name,'Alice');assert.equal(data.height,180);assert.equal(data.apeIndex,2);
 assert.equal(data.entries.length,1);assert.equal(data.entries[0].problem_name,'Deleted climb');
 assert.ok(!JSON.stringify(data).includes('email'));assert.ok(!Object.hasOwn(data.entries[0],'user_id'));
 await assert.rejects(db.query('SELECT * FROM private.account_details'));
 await assert.rejects(db.query('SELECT * FROM private.problem_logs'));
 assert.equal((await db.query("SELECT read_public_profile('33333333-3333-4333-8333-333333333333') AS profile")).rows[0].profile,null);
 }finally{await db.close();}
});
