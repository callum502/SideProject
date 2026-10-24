import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('storage quota counts actual objects, enforces the boundary and cannot be cleared by changing ownership', async () => {
  const db = new PGlite(),
    a = '11111111-1111-4111-8111-111111111111',
    b = '22222222-2222-4222-8222-222222222222';
  const add = (name, size) =>
    db.query(
      `INSERT INTO storage.objects(bucket_id,name,metadata)
       VALUES('sideproj-media',$1,jsonb_build_object('size',$2::bigint))`,
      [name, size]
    );
  try {
    await db.exec(`
        CREATE ROLE anon;
        CREATE ROLE authenticated;
        CREATE SCHEMA private;
        CREATE SCHEMA auth;
        CREATE SCHEMA storage;
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql
          AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
        CREATE TABLE storage.objects(bucket_id text,name text,metadata jsonb,owner_id text,PRIMARY KEY(bucket_id,name));
      `);
    // Existing unlinked files are included at migration time.
    await add(a + '/old.mp4', 9999999900);
    await add(b + '/legacy.mp4', 11000000000);
    await db.exec(
      await readFile(new URL('../migrations/20261011000200_user_storage_limit.sql', import.meta.url), 'utf8')
    );
    await db.exec(`SET test.uid='${a}';`);
    const used = async () => Number((await db.query('SELECT my_storage_usage() AS usage')).rows[0].usage.usedBytes);
    assert.equal(await used(), 9999999900);
    // Storage authorization probes roll back, including quota changes.
    await db.exec('BEGIN');
    await add(a + '/probe.jpg', 100);
    await db.exec('ROLLBACK');
    assert.equal(await used(), 9999999900);
    await add(a + '/avatar.jpg', 100);
    await assert.rejects(add(a + '/extra.jpg', 1), e => e.code === 'PZ003');
    assert.equal(await used(), 10000000000);
    await db.query('UPDATE storage.objects SET owner_id=NULL WHERE name=$1', [a + '/avatar.jpg']);
    assert.equal(await used(), 10000000000);
    // ON CONFLICT updates must not count the same file twice.
    await db.query(
      `INSERT INTO storage.objects(bucket_id,name,metadata)
       VALUES('sideproj-media',$1,'{"size":100}')
       ON CONFLICT(bucket_id,name) DO UPDATE SET metadata=excluded.metadata`,
      [a + '/avatar.jpg']
    );
    assert.equal(await used(), 10000000000);
    await assert.rejects(
      db.query('UPDATE storage.objects SET metadata=\'{"size":101}\' WHERE name=$1', [a + '/avatar.jpg']),
      e => e.code === 'PZ003'
    );
    await db.query('DELETE FROM storage.objects WHERE name=$1', [a + '/avatar.jpg']);
    assert.equal(await used(), 9999999900);
    await add(a + '/replacement.jpg', 100);
    // Legacy over-quota objects can be edited or deleted, but not expanded.
    await assert.rejects(add(b + '/new.jpg', 1), e => e.code === 'PZ003');
    await db.query('UPDATE storage.objects SET owner_id=NULL WHERE name=$1', [b + '/legacy.mp4']);
    await db.query('DELETE FROM storage.objects WHERE name=$1', [b + '/legacy.mp4']);
    await add(b + '/new.jpg', 200);
    await db.exec('SET ROLE authenticated');
    assert.equal(await used(), 10000000000);
    await assert.rejects(db.query('SELECT * FROM private.user_storage_usage'));
    await assert.rejects(db.query('SELECT private.adjust_storage_quota($1,-100)', [a]));
    await db.exec('RESET ROLE;SET ROLE anon');
    await assert.rejects(db.query('SELECT my_storage_usage()'));
  } finally {
    await db.close();
  }
});
