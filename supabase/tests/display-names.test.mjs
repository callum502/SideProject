import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
test('unique names ignore case and spaces; Google accounts get distinct placeholders',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA private;CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
 CREATE TABLE profiles(id uuid PRIMARY KEY,display_name text);
 CREATE TABLE private.user_roles(user_id uuid);
 CREATE TABLE private.account_details(user_id uuid,height_cm integer,ape_index_inches integer);
 CREATE TABLE auth.users(id uuid PRIMARY KEY,raw_app_meta_data jsonb,raw_user_meta_data jsonb);`);
 await db.exec(await readFile(new URL('../migrations/20260913000800_unique_display_names.sql',import.meta.url),'utf8'));
 await db.exec('CREATE TRIGGER signup AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION private.create_profile();');
 const a='11111111-1111-4111-8111-111111111111';
 await db.query(`INSERT INTO auth.users VALUES($1,'{"provider":"email"}','{"display_name":"Alice","height_cm":180}')`,[a]);
 assert.equal((await db.query("SELECT display_name_available(' ALICE ') AS available")).rows[0].available,false);
 await assert.rejects(db.query("INSERT INTO profiles VALUES(gen_random_uuid(),'alice')"));
 await db.exec(`SET test.uid='${a}';`);
 assert.equal((await db.query("SELECT display_name_available(' Alice ') AS available")).rows[0].available,true);
 await db.exec(`INSERT INTO profiles VALUES(gen_random_uuid(),'Bob');`);
 await assert.rejects(db.query(`UPDATE profiles SET display_name=' bob ' WHERE id='${a}'`));
 await db.exec(`INSERT INTO auth.users VALUES(gen_random_uuid(),'{"provider":"google"}','{"display_name":"Alice"}'),(gen_random_uuid(),'{"provider":"google"}','{}');`);
 assert.equal((await db.query("SELECT count(*)::integer AS n FROM profiles WHERE display_name LIKE 'Climber-%'")).rows[0].n,2);
 assert.equal((await db.query('SELECT count(*)::integer AS n FROM private.account_details')).rows[0].n,1);
 }finally{await db.close();}
});
