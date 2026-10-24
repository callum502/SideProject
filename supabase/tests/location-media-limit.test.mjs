import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('SQL enforces combined media quota, rollback and deletion free slots, existing files survive', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE SCHEMA private;
      CREATE TABLE locations(id uuid PRIMARY KEY);
      CREATE TABLE boulders(id uuid PRIMARY KEY,location_id uuid REFERENCES locations);
      CREATE TABLE media(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        location_id uuid REFERENCES locations,
        boulder_id uuid REFERENCES boulders,
        kind text,
        name text
      );
      CREATE TABLE problem_media(problem_id uuid,media_id uuid REFERENCES media ON DELETE CASCADE);
      GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
    `);
    const loc = (await db.query('INSERT INTO locations VALUES(gen_random_uuid()) RETURNING id')).rows[0].id;
    const other = (await db.query('INSERT INTO locations VALUES(gen_random_uuid()) RETURNING id')).rows[0].id;
    const b1 = (await db.query('INSERT INTO boulders VALUES(gen_random_uuid(),$1) RETURNING id', [loc])).rows[0].id;
    const b2 = (await db.query('INSERT INTO boulders VALUES(gen_random_uuid(),$1) RETURNING id', [loc])).rows[0].id;
    await db.query("INSERT INTO media(location_id,kind) SELECT $1,'image' FROM generate_series(1,10)", [loc]);
    await db.exec(
      await readFile(new URL('../migrations/20261011000100_location_media_limit.sql', import.meta.url), 'utf8')
    );
    await db.exec('SET ROLE authenticated');
    await db.query("INSERT INTO media(boulder_id,kind) SELECT $1,'image' FROM generate_series(1,20)", [b1]);
    await db.query("INSERT INTO media(boulder_id,kind) SELECT $1,'video' FROM generate_series(1,20)", [b2]);
    for (const [column, id] of [
      ['location_id', loc],
      ['boulder_id', b1],
      ['boulder_id', b2],
    ])
      await assert.rejects(
        db.query(`INSERT INTO media(${column},kind) VALUES($1,'image')`, [id]),
        e => e.code === 'PZ002'
      );
    await db.exec("UPDATE media SET name='Edited'; INSERT INTO problem_media SELECT gen_random_uuid(),id FROM media;");
    await db.query("INSERT INTO media(location_id,kind) VALUES($1,'image')", [other]);
    await db.query('DELETE FROM media WHERE id=(SELECT id FROM media WHERE boulder_id=$1 LIMIT 1)', [b1]);
    await db.query("INSERT INTO media(location_id,kind) VALUES($1,'image')", [loc]);
    await assert.rejects(db.query('UPDATE private.location_media_counts SET total=0'));
    await db.exec('RESET ROLE');
    assert.equal(
      (await db.query('SELECT total FROM private.location_media_counts WHERE location_id=$1', [loc])).rows[0].total,
      50
    );
  } finally {
    await db.close();
  }
});
