import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
test('account deletion retains content without ownership and removes personal data',async()=>{
 const db=new PGlite();const a='11111111-1111-4111-8111-111111111111';
 try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE SCHEMA private;CREATE SCHEMA storage;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '11111111-1111-4111-8111-111111111111'::uuid $$;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('${a}');
 CREATE TABLE profiles(id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,display_name text);INSERT INTO profiles VALUES('${a}','Alice');
 CREATE TABLE private.account_details(user_id uuid REFERENCES profiles(id) ON DELETE CASCADE);INSERT INTO private.account_details VALUES('${a}');
 CREATE TABLE private.problem_logs(user_id uuid REFERENCES profiles(id) ON DELETE CASCADE);INSERT INTO private.problem_logs VALUES('${a}');
 CREATE TABLE storage.objects(owner uuid REFERENCES auth.users(id),owner_id text,name text);INSERT INTO storage.objects VALUES('${a}','${a}','preserved.jpg');`);
 for(const t of ['locations','boulders','problems','media'])await db.exec(`CREATE TABLE ${t}(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),created_by uuid NOT NULL REFERENCES profiles(id),created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),version integer DEFAULT 1);INSERT INTO ${t}(created_by) VALUES('${a}');`);
 await db.exec(await readFile(new URL('../migrations/20261009000100_post_limits.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../migrations/20261010000400_delete_account.sql',import.meta.url),'utf8'));
 for(const t of ['locations','boulders','problems','media'])await db.exec(`CREATE TRIGGER protect_record BEFORE UPDATE ON ${t} FOR EACH ROW EXECUTE FUNCTION private.protect_record();`);
 await assert.rejects(db.exec('UPDATE locations SET created_by=NULL'));
 await db.exec('SET ROLE authenticated;');await assert.rejects(db.query('SELECT prepare_account_deletion($1)',[a]));await db.exec('RESET ROLE;SET ROLE service_role;');
 await db.query('SELECT prepare_account_deletion($1)',[a]);await db.exec('RESET ROLE;');
 await db.query('DELETE FROM auth.users WHERE id=$1',[a]);
 for(const t of ['locations','boulders','problems','media'])assert.equal((await db.query(`SELECT created_by FROM ${t}`)).rows[0].created_by,null);
 for(const t of ['profiles','private.account_details','private.problem_logs','private.post_counts'])assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n,0);
 assert.equal((await db.query('SELECT name FROM storage.objects')).rows[0].name,'preserved.jpg');
 assert.equal((await db.query('SELECT private.has_account() AS active')).rows[0].active,false);
 }finally{await db.close();}
});
