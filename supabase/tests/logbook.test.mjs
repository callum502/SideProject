import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
test('logbook isolates accounts, deduplicates completions and retains deleted problems',async()=>{
 const db=new PGlite();
 const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',p='33333333-3333-4333-8333-333333333333';
 try {
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE SCHEMA private;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
 CREATE TABLE public.profiles(id uuid PRIMARY KEY); CREATE TABLE public.locations(id uuid PRIMARY KEY,name text);
 CREATE TABLE public.boulders(id uuid PRIMARY KEY,location_id uuid,name text);
 CREATE TABLE public.problems(id uuid PRIMARY KEY,boulder_id uuid,name text,grade text);
 INSERT INTO profiles VALUES('${a}'),('${b}'); INSERT INTO locations VALUES('${a}','Location'); INSERT INTO boulders VALUES('${a}','${a}','Boulder'); INSERT INTO problems VALUES('${p}','${a}','Problem','V1');`);
 await db.exec(await readFile(new URL('../migrations/20260913000600_logbook.sql',import.meta.url),'utf8'));
 const user=async id=>db.exec(`RESET ROLE; SET test.uid='${id}'; SET ROLE authenticated;`);
 await user(a);
 assert.equal((await db.query(`SELECT * FROM set_problem_log('${p}',true)`)).rows.length,1);
 assert.equal((await db.query(`SELECT * FROM set_problem_log('${p}',true)`)).rows.length,1);
 await assert.rejects(db.query('SELECT * FROM private.problem_logs'));
 await user(b);
 assert.equal((await db.query('SELECT * FROM read_logbook()')).rows.length,0);
 assert.equal((await db.query(`SELECT * FROM set_problem_log('${p}',false)`)).rows.length,0);
 await db.query(`SELECT * FROM set_problem_log('${p}',true)`);
 await user(a);
 assert.equal((await db.query(`SELECT * FROM set_problem_log('${p}',false)`)).rows.length,0);
 await user(b);
 assert.equal((await db.query('SELECT * FROM read_logbook()')).rows.length,1);
 await db.exec(`RESET ROLE; DELETE FROM problems;`);
 await user(b);
 const entry=(await db.query('SELECT * FROM read_logbook()')).rows[0];
 assert.equal(entry.problem_id,null);assert.equal(entry.problem_name,'Problem');
 assert.equal((await db.query(`SELECT * FROM set_problem_log('${entry.entry_id}',false)`)).rows.length,0);
 await db.exec('RESET ROLE; SET ROLE anon;');
 await assert.rejects(db.query('SELECT * FROM read_logbook()'));
 }finally{await db.close();}
});
