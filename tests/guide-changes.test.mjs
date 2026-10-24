import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guideChanges, applyChanges } from '../guide-changes.mjs';

const problem = (id, extra = {}) => ({
  id,
  name: 'Arete',
  grade: '6A',
  description: 'Edge',
  photoAnnotations: {},
  imageIds: [],
  videoIds: [],
  createdBy: 'u1',
  createdByName: 'One',
  ...extra,
});
const boulder = (id, problems = []) => ({
  id,
  name: 'Rock',
  notes: 'By the tree',
  otherNotes: '',
  createdBy: 'u1',
  createdByName: 'One',
  images: [],
  videos: [],
  problems,
});
const guide = () => ({
  locations: [
    {
      id: 'l1',
      name: 'Crag',
      latitude: '51.5',
      longitude: '-1.1',
      approach: 'Walk',
      links: [],
      createdBy: 'u1',
      createdByName: 'One',
      photos: [],
      boulders: [boulder('b1', [problem('p1')])],
    },
  ],
});
const edit = (base, change) => {
  const next = structuredClone(base);
  change(next);
  return guideChanges(base, next);
};

test('only changed records are sent, with the copy each edit started from', () => {
  const base = guide();
  assert.deepEqual(guideChanges(base, structuredClone(base)), []);
  const changes = edit(base, g => {
    g.locations[0].boulders[0].problems[0].grade = '6B';
    g.locations[0].boulders.push(boulder('b2'));
  });
  assert.deepEqual(
    changes.map(c => [c.action, c.type, c.id, c.parentId]),
    [
      ['put', 'problem', 'p1', 'b1'],
      ['put', 'boulder', 'b2', 'l1'],
    ]
  );
  assert.equal(changes[0].base.grade, '6A');
  assert.equal(changes[0].value.grade, '6B');
  assert.equal(changes[1].base, null);
  assert.equal('problems' in changes[1].value, false, 'children are sent as their own records');
  assert.deepEqual(
    edit(base, g => {
      g.locations = [];
    }).map(c => [c.action, c.id]),
    [
      ['delete', 'l1'],
      ['delete', 'b1'],
      ['delete', 'p1'],
    ]
  );
  // jsonb reorders keys; key order alone is not an edit.
  assert.deepEqual(
    edit(base, g => {
      g.locations[0].boulders[0].problems[0] = { ...problem('p1'), photoAnnotations: {} };
      g.locations[0].boulders[0].problems[0] = Object.fromEntries(
        Object.entries(g.locations[0].boulders[0].problems[0]).reverse()
      );
    }),
    []
  );
});

test('changes apply on top of newer records and conflict only on records changed since', () => {
  const base = guide(),
    mine = edit(base, g => {
      g.locations[0].boulders[0].problems[0].grade = '6B';
    });
  const latest = structuredClone(base);
  latest.locations[0].boulders.push(boulder('b2'));
  latest.locations[0].name = 'Renamed crag';
  latest.locations[0].createdByName = 'Display name changed';
  const merged = applyChanges(latest, mine);
  assert.equal(merged.locations[0].boulders[0].problems[0].grade, '6B');
  assert.equal(merged.locations[0].name, 'Renamed crag');
  assert.deepEqual(
    merged.locations[0].boulders.map(b => b.id),
    ['b1', 'b2']
  );
  assert.deepEqual(latest.locations[0].boulders[0].problems[0].grade, '6A', 'the current guide is not mutated');
  const conflict = error => error.status === 409;
  assert.throws(
    () =>
      applyChanges(
        latest,
        edit(base, g => {
          g.locations[0].name = 'Mine';
        })
      ),
    conflict
  );
  latest.locations[0].boulders[0].problems[0].grade = '7A';
  assert.throws(() => applyChanges(latest, mine), conflict);
  assert.throws(() => applyChanges({ locations: [] }, mine), conflict, 'record removed since');
  assert.throws(
    () =>
      applyChanges(
        base,
        edit({ locations: [] }, g => {
          g.locations.push(guide().locations[0]);
        })
      ),
    conflict,
    'record already exists'
  );
  // Removing a parent without the children someone else added would orphan them.
  const unseen = structuredClone(base);
  unseen.locations[0].boulders = [];
  assert.throws(
    () =>
      applyChanges(
        latest,
        edit(unseen, g => {
          g.locations = [];
        })
      ),
    conflict
  );
  assert.deepEqual(
    applyChanges(
      base,
      edit(base, g => {
        g.locations = [];
      })
    ),
    { locations: [] }
  );
});

test('malformed changes are rejected before they touch the guide', () => {
  const invalid = error => error.status === 400;
  const valid = { action: 'put', type: 'boulder', id: 'b2', parentId: 'l1', base: null, value: { name: 'Rock' } };
  for (const change of [
    null,
    [],
    { ...valid, action: 'move' },
    { ...valid, type: '__proto__' },
    { ...valid, id: '' },
    { ...valid, id: 'x'.repeat(101) },
    { ...valid, parentId: null },
    { ...valid, type: 'location', parentId: 'l1' },
    { ...valid, base: undefined },
    { ...valid, base: [] },
    { ...valid, value: 'x' },
    { ...valid, action: 'delete' },
  ])
    assert.throws(() => applyChanges(guide(), [change]), invalid, JSON.stringify(change));
  assert.throws(() => applyChanges(guide(), [valid, valid]), invalid, 'duplicate ids');
  assert.throws(() => applyChanges(guide(), {}), invalid);
  const added = applyChanges(guide(), [
    { ...valid, value: { name: 'Rock', id: 'spoofed', problems: [problem('px')], createdByName: 'Spoofed' } },
  ]).locations[0].boulders[1];
  assert.deepEqual(
    added,
    { id: 'b2', name: 'Rock', images: [], videos: [], problems: [] },
    'only known fields are copied'
  );
});
