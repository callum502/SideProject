import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
test('profile photos are publicly readable but only owners can set their own uploaded image',async()=>{
 const db=new PGlite();const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';const path=a+'/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg';
 try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA private;CREATE SCHEMA auth;CREATE SCHEMA storage;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
 CREATE TABLE profiles(id uuid PRIMARY KEY);INSERT INTO profiles VALUES('${a}'),('${b}');
 CREATE TABLE storage.objects(bucket_id text,name text,owner_id text,metadata jsonb);`);
 await db.query(`INSERT INTO storage.objects VALUES('sideproj-media',$1,$2,'{"size":100,"mimetype":"image/jpeg"}')`,[path,a]);
 await db.exec(await readFile(new URL('../migrations/20261010000200_profile_photos.sql',import.meta.url),'utf8'));
 await db.exec(`SET test.uid='${a}';SET ROLE authenticated;`);
 await db.query('SELECT set_profile_photo($1)',[path]);
 await assert.rejects(db.query('SELECT set_profile_photo($1)',[a+'/missing.jpg']));
 await db.exec(`RESET ROLE;SET test.uid='${b}';SET ROLE authenticated;`);
 await assert.rejects(db.query('SELECT set_profile_photo($1)',[path]));
 assert.equal((await db.query('SELECT profile_photo($1) AS path',[b])).rows[0].path,null);
 await db.exec('RESET ROLE;SET ROLE anon;');
 assert.equal((await db.query('SELECT profile_photo($1) AS path',[a])).rows[0].path,path);
 await assert.rejects(db.query('SELECT set_profile_photo(null)'));
 await assert.rejects(db.query('SELECT * FROM private.profile_photos'));
 }finally{await db.close();}
});
