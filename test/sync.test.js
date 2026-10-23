const test = require('node:test');
const assert = require('node:assert');
const SYNC = require('../sync');
const { isPublicKey } = require('../api/_lib/keys');

const base = () => ({
  v: 1, title: 'Cup', sub: 'Sub',
  players: [{ id: 'p0', name: 'Ann', g: 0 }, { id: 'p1', name: 'Bob', g: 0 }, { id: 'p2', name: 'Cy', g: 1 }, { id: 'p3', name: 'Di', g: 1 }],
  ng: 2, q: 1, third: true, sc: {}, man: {}, ko: { res: {}, draw: null }, ann: false, hist: [], tid: 't1',
});
const clone = o => JSON.parse(JSON.stringify(o));

test('newer: applies only strictly newer revisions', () => {
  assert.equal(SYNC.newer(200, 100), true);
  assert.equal(SYNC.newer(100, 100), false, 'echo of my own save');
  assert.equal(SYNC.newer(99, 100), false, 'stale / out-of-order event');
  assert.equal(SYNC.newer(5, 0), true, 'first state ever');
  assert.equal(SYNC.newer(NaN, 0), false);
  assert.equal(SYNC.newer(undefined, 0), false);
  assert.equal(SYNC.newer(0, 0), false);
});

test('valid: rejects incomplete payloads', () => {
  assert.equal(SYNC.valid(base()), true);
  assert.equal(SYNC.valid(null), false);
  assert.equal(SYNC.valid(undefined), false);
  assert.equal(SYNC.valid({ v: 1 }), false);
  assert.equal(SYNC.valid({ v: 2, players: [] }), false);
  assert.equal(SYNC.valid('{"v":1,"players":[]}'), false, 'a string is not a state');
});

test('dirty: untouched draft is clean', () => {
  const s = base();
  assert.equal(SYNC.dirty(clone(s), s), false);
  assert.equal(SYNC.dirty(null, s), false);
});

test('dirty: every Settings field counts', () => {
  const s = base();
  const edits = [
    d => { d.title = 'New' }, d => { d.sub = 'x' }, d => { d.ng = 4 }, d => { d.q = 2 }, d => { d.third = false },
    d => { d.players[0].name = 'Anna' }, d => { d.players[0].g = 1 }, d => { d.players.push({ id: 'p9', name: 'New', g: 0 }) },
    d => { d.players.splice(1, 1) }, d => { d.hist.push({ season: 'S1', champ: 'Ann', ru: '' }) },
  ];
  for (const e of edits) { const d = clone(s); e(d); assert.equal(SYNC.dirty(d, s), true, e.toString()); }
});

test('dirty: scores, knockout and the auto champion entry are not Settings edits', () => {
  const s = base(), d = clone(s);
  d.sc.G0R1_p0_p1 = [1, 0]; d.ko.draw = [['p0', 'p2']]; d.man.p0 = 0; d.ann = true;
  d.hist.push({ t: 't1', season: 'Cup', champ: 'Ann' });
  assert.equal(SYNC.dirty(d, s), false);
});

test('merge: untouched fields come from the latest state, edited ones from the draft', () => {
  const b = base(), d = clone(b), cur = clone(b);
  d.title = 'My title';                                     // mine
  cur.sub = 'Their subtitle'; cur.sc.G0R1_p0_p1 = [3, 2];    // theirs
  const m = SYNC.merge(d, b, cur);
  assert.deepEqual(m.conflicts, []);
  assert.equal(m.data.title, 'My title');
  assert.equal(m.data.sub, 'Their subtitle');
  assert.deepEqual(m.data.sc, { G0R1_p0_p1: [3, 2] }, 'a score entered meanwhile is not wiped by Save Settings');
  assert.notStrictEqual(m.data.players, d.players, 'result does not alias the draft');
});

test('merge: same field changed on both sides is a conflict; identical change is not', () => {
  const b = base();
  const d = clone(b); d.players.push({ id: 'pA', name: 'Mine', g: 0 });
  const cur = clone(b); cur.players.push({ id: 'pB', name: 'Theirs', g: 1 });
  const m = SYNC.merge(d, b, cur);
  assert.deepEqual(m.conflicts, ['players']);
  assert.deepEqual(m.data.players.map(p => p.id), ['p0', 'p1', 'p2', 'p3', 'pA'], 'draft wins once confirmed');

  const d2 = clone(b), c2 = clone(b); d2.title = c2.title = 'Same';
  assert.deepEqual(SYNC.merge(d2, b, c2).conflicts, []);
});

test('merge: nothing edited returns the latest state unchanged', () => {
  const b = base(), cur = clone(b); cur.players[0].name = 'Renamed elsewhere';
  const m = SYNC.merge(clone(b), b, cur);
  assert.deepEqual(m.data, cur);
  assert.deepEqual(m.conflicts, []);
});

test('changed: match ids whose score differs', () => {
  assert.deepEqual(SYNC.changed({ a: [1, 0], b: [2, 2] }, { a: [1, 0], b: [2, 3], c: [0, 0] }).sort(), ['b', 'c']);
  assert.deepEqual(SYNC.changed({ a: [1, 0] }, {}), ['a']);
  assert.deepEqual(SYNC.changed(undefined, null), []);
});

test('due: toast at most once per 10 s', () => {
  assert.equal(SYNC.due(0, 1000), true);
  assert.equal(SYNC.due(1000, 5000), false);
  assert.equal(SYNC.due(1000, 11000), true);
});

const jwt = role => ['x', Buffer.from(JSON.stringify({ role })).toString('base64url'), 'sig'].join('.');

test('isPublicKey: only anon/publishable keys reach the browser', () => {
  assert.equal(isPublicKey(jwt('anon'), jwt('service_role')), true);
  assert.equal(isPublicKey('sb_publishable_abc', 'sb_secret_xyz'), true);
  assert.equal(isPublicKey(jwt('service_role'), 'other'), false);
  assert.equal(isPublicKey('sb_secret_xyz', ''), false);
  assert.equal(isPublicKey(jwt('anon'), jwt('anon')), false, 'same as the service key → refuse');
  assert.equal(isPublicKey('', 'x'), false);
  assert.equal(isPublicKey(undefined, 'x'), false);
  assert.equal(isPublicKey('not-a-key', 'x'), false);
});
