const test = require('node:test');
const assert = require('node:assert');
const { diffState } = require('../api/_lib/diff');

// Minimal state shaped like def() in index.html: 8 players, 2 groups, 2 qualifiers → 4-player bracket.
const base = () => ({
  v: 1, title: 'Cup', sub: 'Sub',
  players: Array.from({ length: 8 }, (_, i) => ({ id: 'p' + i, name: 'Player ' + (i + 1), g: i % 2 })),
  ng: 2, q: 2, third: true, sc: {}, man: {}, ko: { res: {}, draw: null }, ann: false, hist: [], tid: 't1',
});
const clone = o => JSON.parse(JSON.stringify(o));
const M = 'G0R1_p0_p2'; // Group A: Player 1 v Player 3

test('no changes', () => {
  const d = diffState(base(), base());
  assert.equal(d.action, 'state_update');
  assert.equal(d.changes.length, 0);
  assert.equal(d.summary, 'No visible changes');
});

test('score added', () => {
  const n = base(); n.sc[M] = [2, 1];
  const d = diffState(base(), n);
  assert.equal(d.action, 'state_update');
  assert.deepEqual(d.changes.map(c => c.type), ['score_set']);
  assert.equal(d.summary, 'Group A: Player 1 2–1 Player 3');
});

test('score changed', () => {
  const o = base(); o.sc[M] = [1, 1];
  const n = clone(o); n.sc[M] = [3, 1];
  const d = diffState(o, n);
  assert.equal(d.changes[0].type, 'score_changed');
  assert.equal(d.summary, 'Group A: Player 1 3–1 Player 3 (was 1–1)');
  assert.deepEqual(d.changes[0].from, [1, 1]);
  assert.deepEqual(d.changes[0].to, [3, 1]);
});

test('score cleared', () => {
  const o = base(); o.sc[M] = [2, 0];
  const n = clone(o); delete n.sc[M];
  const d = diffState(o, n);
  assert.equal(d.changes[0].type, 'score_cleared');
  assert.equal(d.summary, 'Group A: Player 1 v Player 3 cleared (was 2–0)');
});

test('knockout result set and changed', () => {
  const o = base(); o.ko.draw = [['p0', 'p3'], ['p1', 'p2']];
  const n = clone(o); n.ko.res['1-0'] = { s: [2, 2], w: 'p1', m: 'Extra time / penalties' };
  let d = diffState(o, n);
  assert.equal(d.changes[0].type, 'ko_set');
  assert.equal(d.summary, 'Final: Player 2 won 2–2 (Extra time / penalties)');

  const n2 = clone(n); n2.ko.res['1-0'] = { s: [3, 1], w: 'p0', m: 'Regulation' };
  d = diffState(n, n2);
  assert.equal(d.changes[0].type, 'ko_changed');
  assert.equal(d.summary, 'Final: Player 1 won 3–1 (was Player 2 won 2–2 (Extra time / penalties))');

  const n3 = clone(o); n3.ko.res['0-1'] = { s: [1, 0], w: 'p2', m: 'Regulation' };
  assert.equal(diffState(o, n3).summary, 'Semi-finals match 2: Player 3 won 1–0');
});

test('knockout draw generated', () => {
  const n = base(); n.ko.draw = [['p0', 'p3'], ['p1', 'p2']];
  assert.equal(diffState(base(), n).summary, 'Knockout draw generated');
});

test('player renamed and moved', () => {
  const n = base(); n.players[0].name = 'Messi'; n.players[1].g = 0;
  const d = diffState(base(), n);
  assert.deepEqual(d.changes.map(c => c.type), ['player_renamed', 'player_moved']);
  assert.equal(d.changes[0].text, 'Player renamed: Player 1 → Messi');
  assert.equal(d.changes[1].text, 'Player 2 moved from Group B to Group A');
});

test('settings changed', () => {
  const n = base(); n.title = 'Big Cup'; n.third = false;
  const d = diffState(base(), n);
  assert.deepEqual(d.changes.map(c => c.key), ['title', 'third']);
  assert.equal(d.summary, 'Title changed: "Cup" → "Big Cup"; Third-place match changed: "Enabled" → "Disabled"');
});

const played = () => {
  const o = base();
  o.sc[M] = [2, 1]; o.sc['G1R1_p1_p3'] = [0, 0];
  o.ko.draw = [['p0', 'p3'], ['p1', 'p2']]; o.ko.res['0-0'] = { s: [1, 0], w: 'p0', m: 'Regulation' };
  return o;
};

test('reset stats: derived and via hint', () => {
  const o = played();
  const n = clone(o); n.sc = {}; n.man = {}; n.lock = {}; n.ko = { res: {}, draw: null };
  for (const d of [diffState(o, n), diffState(o, n, 'reset_stats')]) {
    assert.equal(d.action, 'reset_stats');
    assert.equal(d.summary, 'Reset stats: cleared 2 scores, cleared 1 knockout result');
  }
});

test('reset stats that removes players: summary, counts and removed names', () => {
  // 16 players in 4 groups of 4 → 6 matches per group → 24 scores, like def() in index.html
  const o = base();
  o.players = Array.from({ length: 16 }, (_, i) => ({ id: 'p' + i, name: 'Player ' + (i + 1), g: i % 4 }));
  o.ng = 4;
  for (let g = 0; g < 4; g++) {
    const ids = o.players.filter(p => p.g === g).map(p => p.id);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) o.sc[`G${g}R1_${ids[i]}_${ids[j]}`] = [1, 0];
  }
  o.hist = [{ season: 'Old Cup', champ: 'Someone' }];
  const n = clone(o);
  n.players = []; n.sc = {}; n.man = {}; n.lock = {}; n.ko = { res: {}, draw: null };

  for (const d of [diffState(o, n, 'reset_stats'), diffState(o, n)]) {
    assert.equal(d.action, 'reset_stats');
    assert.equal(d.summary, 'Reset stats: removed 16 players, cleared 24 scores');
    assert.equal(d.counts.playersRemoved, 16);
    assert.equal(d.counts.scoresCleared, 24);
    assert.equal(d.removedPlayers.length, 16);
    assert.deepEqual(d.removedPlayers.slice(0, 2), ['Player 1', 'Player 2']);
    assert.ok(!d.changes.some(c => c.type === 'setting' || c.type === 'hall_of_fame'), 'settings and past champions untouched');
  }
});

test('full reset: derived and via hint', () => {
  const o = played(); o.title = 'Old title';
  const n = base(); n.tid = 't2';
  assert.equal(diffState(o, n).action, 'reset');
  const d = diffState(o, n, 'reset');
  assert.equal(d.action, 'reset');
  assert.match(d.summary, /^Tournament reset: cleared 2 scores, cleared 1 knockout result, 1 setting change$/);
});

test('new season derived from champion moving to the hall of fame', () => {
  const o = played(); o.hist = [{ t: 't1', season: 'Cup', y: 2026, champ: 'Player 1', ru: 'Player 4', third: '' }];
  const n = base(); n.tid = 't2'; n.hist = [{ season: 'Cup', y: 2026, champ: 'Player 1', ru: 'Player 4', third: '' }];
  assert.equal(diffState(o, n).action, 'new_season');
});

test('unknown hint is ignored; import hint is a label only', () => {
  const n = base(); n.sc[M] = [1, 0];
  assert.equal(diffState(base(), n, 'drop_tables').action, 'state_update');
  const d = diffState(base(), n, 'import_backup');
  assert.equal(d.action, 'import_backup');
  assert.equal(d.summary, 'Backup imported: set 1 score');
  assert.equal(d.changes[0].type, 'score_set');
});

test('long change lists are collapsed in the summary', () => {
  const n = base();
  n.sc['G0R1_p0_p2'] = [1, 0]; n.sc['G0R1_p4_p6'] = [1, 0]; n.sc['G0R2_p0_p4'] = [1, 0]; n.sc['G0R2_p2_p6'] = [1, 0];
  assert.match(diffState(base(), n).summary, /\(\+1 more\)$/);
});

test('garbage input does not throw', () => {
  assert.doesNotThrow(() => diffState(null, { v: 1, players: [], sc: 5, ko: 'x', hist: {} }));
});
