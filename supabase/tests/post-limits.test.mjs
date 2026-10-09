import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
test('database quotas enforce per-owner totals and release slots on deletion',async()=>{
 const db=new PGlite();const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
 try {
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA private;CREATE TABLE profiles(id uuid PRIMARY KEY);INSERT INTO profiles VALUES('${a}'),('${b}');`);
 for(const table of ['locations','boulders','problems'])await db.exec(`CREATE TABLE ${table}(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),created_by uuid NOT NULL REFERENCES profiles(id),parent_id uuid,name text);GRANT SELECT,INSERT,UPDATE,DELETE ON ${table} TO authenticated;`);
 // An existing location must be counted when applying the migration.
 await db.query('INSERT INTO locations(created_by) VALUES($1)',[a]);
 await db.exec(await readFile(new URL('../migrations/20261009000100_post_limits.sql',import.meta.url),'utf8'));
 await db.exec('SET ROLE authenticated;');
 for(const [table,limit] of [['locations',25],['boulders',50],['problems',250]]) {
  await db.query(`INSERT INTO ${table}(created_by,parent_id) SELECT $1,gen_random_uuid() FROM generate_series(1,$2::int)`,[a,table==='locations'?limit-1:limit]);
  await assert.rejects(db.query(`INSERT INTO ${table}(created_by) VALUES($1)`,[a]),e=>e.code==='PZ001'&&e.detail===table);
  await db.query(`UPDATE ${table} SET name='Edited' WHERE created_by=$1`,[a]);
  await db.query(`INSERT INTO ${table}(created_by) VALUES($1)`,[b]);
  await db.query(`DELETE FROM ${table} WHERE id=(SELECT id FROM ${table} WHERE created_by=$1 LIMIT 1)`,[a]);
  await db.query(`INSERT INTO ${table}(created_by) VALUES($1)`,[a]);
  await assert.rejects(db.query(`INSERT INTO ${table}(created_by) VALUES($1)`,[a]));
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE created_by=$1`,[a])).rows[0].n,limit);
 }
 await assert.rejects(db.query('UPDATE private.post_counts SET total=0'));
 }finally{await db.close();}
});
