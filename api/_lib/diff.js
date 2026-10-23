// Server-side diff of two tournament states → one readable audit summary + structured changes.
// Pure module (no I/O) so it can be unit-tested. Mirrors the data model in index.html.

const HINTS = { reset: 'Tournament reset', reset_stats: 'Reset stats', new_season: 'New season started', import_backup: 'Backup imported' };
const SETTINGS = [['title', 'Title'], ['sub', 'Subtitle'], ['ng', 'Groups'], ['q', 'Qualifiers per group'], ['third', 'Third-place match']];

const GN = g => String.fromCharCode(65 + Number(g));
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const arr = v => (Array.isArray(v) ? v : []);
const keys = (a, b) => [...new Set([...Object.keys(obj(a)), ...Object.keys(obj(b))])];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const score = s => (Array.isArray(s) ? s[0] + '–' + s[1] : '');
const show = (k, v) => (k === 'third' ? (v ? 'Enabled' : 'Disabled') : String(v ?? ''));
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

// Same round naming as rname() in index.html.
function rname(N, k) {
  const c = N / 2 ** (k + 1);
  return c === 1 ? 'Final' : c === 2 ? 'Semi-finals' : c === 4 ? 'Quarter-finals' : 'Round of ' + c * 2;
}

function diffState(o, n, hint) {
  o = obj(o); n = obj(n);
  const changes = [];
  const add = (type, text, extra) => changes.push({ type, text, ...extra });
  const name = id => {
    const p = arr(n.players).find(x => x && x.id === id) || arr(o.players).find(x => x && x.id === id);
    return p ? String(p.name) : id ? String(id) : 'TBD';
  };

  // settings
  for (const [k, label] of SETTINGS) {
    if (!same(o[k], n[k])) add('setting', `${label} changed: "${show(k, o[k])}" → "${show(k, n[k])}"`, { key: k, from: o[k] ?? null, to: n[k] ?? null });
  }

  // players
  const op = new Map(arr(o.players).map(p => [p && p.id, p])), np = new Map(arr(n.players).map(p => [p && p.id, p]));
  for (const [id, p] of np) {
    const q = op.get(id);
    if (!q) { add('player_added', `Player added: ${p.name} (Group ${GN(p.g)})`, { id, name: p.name, group: p.g }); continue; }
    if (q.name !== p.name) add('player_renamed', `Player renamed: ${q.name} → ${p.name}`, { id, from: q.name, to: p.name });
    if (q.g !== p.g) add('player_moved', `${p.name} moved from Group ${GN(q.g)} to Group ${GN(p.g)}`, { id, from: q.g, to: p.g });
  }
  for (const [id, q] of op) if (!np.has(id)) add('player_removed', `Player removed: ${q.name}`, { id, name: q.name });

  // group scores; fixture id = G{g}R{r}_{a}_{b}
  const osc = obj(o.sc), nsc = obj(n.sc), scoreGroups = new Set();
  for (const id of keys(osc, nsc).sort()) {
    const a = osc[id], b = nsc[id];
    if (same(a, b)) continue;
    const m = /^G(\d+)R(\d+)_(.+)_(.+)$/.exec(id);
    const g = m ? Number(m[1]) : null, label = m ? `Group ${GN(g)}: ` : '';
    const pa = m ? name(m[3]) : '?', pb = m ? name(m[4]) : '?';
    if (g !== null) scoreGroups.add(g);
    const extra = { match: id, group: g, from: a || null, to: b || null };
    if (!a) add('score_set', `${label}${pa} ${score(b)} ${pb}`, extra);
    else if (!b) add('score_cleared', `${label}${pa} v ${pb} cleared (was ${score(a)})`, extra);
    else add('score_changed', `${label}${pa} ${score(b)} ${pb} (was ${score(a)})`, extra);
  }

  // manual ranking (tie-breaks) and swap locks
  const gOf = id => { const p = np.get(id) || op.get(id); return p ? p.g : null; };
  const oman = obj(o.man), nman = obj(n.man), rankGroups = new Set();
  for (const id of keys(oman, nman)) {
    if (oman[id] !== nman[id] && nman[id] != null) rankGroups.add(gOf(id));
  }
  for (const g of [...rankGroups].filter(g => g !== null).sort()) add('ranking', `Group ${GN(g)}: manual ranking updated`, { group: g });
  const olk = obj(o.lock), nlk = obj(n.lock);
  for (const g of keys(olk, nlk).sort()) {
    if (!!olk[g] === !!nlk[g]) continue;
    add(nlk[g] ? 'ranking_locked' : 'ranking_unlocked', `Group ${GN(g)}: ranking ${nlk[g] ? 'locked' : 'unlocked'}${!nlk[g] && scoreGroups.has(Number(g)) ? ' (results changed)' : ''}`, { group: Number(g) });
  }

  // knockout
  const oko = obj(o.ko), nko = obj(n.ko), N = Number(n.ng) * Number(n.q);
  if (!same(oko.draw ?? null, nko.draw ?? null)) {
    add('ko_draw', !oko.draw ? 'Knockout draw generated' : !nko.draw ? 'Knockout draw cleared' : 'Knockout draw regenerated');
  }
  const ores = obj(oko.res), nres = obj(nko.res);
  const kLabel = key => {
    if (key === 't') return 'Third-place match';
    const [k, i] = key.split('-').map(Number);
    const r = Number.isInteger(Math.log2(N)) ? rname(N, k) : 'Round ' + (k + 1);
    return r === 'Final' ? r : `${r} match ${i + 1}`;
  };
  const kText = r => `${name(r.w)} won ${score(r.s)}${r.m && r.m !== 'Regulation' ? ` (${r.m})` : ''}`;
  for (const key of keys(ores, nres).sort()) {
    const a = ores[key], b = nres[key];
    if (same(a, b)) continue;
    const extra = { key, from: a || null, to: b || null };
    if (!a) add('ko_set', `${kLabel(key)}: ${kText(b)}`, extra);
    else if (!b) add('ko_cleared', `${kLabel(key)}: result cleared (was ${kText(a)})`, extra);
    else add('ko_changed', `${kLabel(key)}: ${kText(b)} (was ${kText(a)})`, extra);
  }

  // hall of fame (ignore the auto-maintained entry for the current season, tagged with t)
  const manual = h => arr(h).filter(x => x && !x.t);
  if (!same(manual(o.hist), manual(n.hist))) add('hall_of_fame', 'Previous champions edited');
  if (!o.ann && n.ann) add('champion_reveal', 'Champion reveal dismissed');

  // action label: client hint is only a label; otherwise derived from the data
  let action = HINTS[hint] ? hint : null;
  if (!action) {
    const samePlayers = same(arr(o.players).map(p => p && p.id), arr(n.players).map(p => p && p.id));
    // "Wiped" needs at least 2 cleared items, so clearing a lone score isn't labelled a stats reset.
    const had = Object.keys(osc).length + Object.keys(ores).length + (oko.draw ? 1 : 0);
    const wiped = had >= 2 && !Object.keys(nsc).length && !Object.keys(nres).length && !nko.draw;
    // Removing every player is part of Reset stats, so it doesn't count as a structural edit.
    const structural = changes.some(c => c.type === 'setting' || (c.type.startsWith('player_') && !(c.type === 'player_removed' && !np.size)));
    if (o.tid !== undefined && o.tid !== n.tid) {
      const oc = arr(o.hist).find(h => h && h.t === o.tid);
      action = oc && arr(n.hist).some(h => h && !h.t && h.champ === oc.champ && h.season === oc.season) && samePlayers ? 'new_season' : 'reset';
    } else if (wiped && !structural) action = 'reset_stats';
    else action = 'state_update';
  }

  // counts and removed names come from the full list, before it is capped at 500 entries
  const counts = tally(changes);
  const removedPlayers = changes.filter(c => c.type === 'player_removed').map(c => c.name);
  return { action, summary: summarize(action, changes, counts), changes: changes.slice(0, 500), counts, removedPlayers };
}

function tally(changes) {
  const count = t => changes.filter(c => t.includes(c.type)).length;
  return {
    playersRemoved: count(['player_removed']), playersAdded: count(['player_added']), playerChanges: count(['player_renamed', 'player_moved']),
    scoresCleared: count(['score_cleared']), scoresSet: count(['score_set', 'score_changed']),
    koCleared: count(['ko_cleared']), koSet: count(['ko_set', 'ko_changed']), settings: count(['setting']),
  };
}

function summarize(action, changes, n) {
  if (HINTS[action]) {
    const parts = [];
    if (n.playersRemoved) parts.push('removed ' + plural(n.playersRemoved, 'player'));
    if (n.playersAdded) parts.push('added ' + plural(n.playersAdded, 'player'));
    if (n.scoresCleared) parts.push('cleared ' + plural(n.scoresCleared, 'score'));
    if (n.scoresSet) parts.push('set ' + plural(n.scoresSet, 'score'));
    if (n.koCleared) parts.push('cleared ' + plural(n.koCleared, 'knockout result'));
    if (n.koSet) parts.push('set ' + plural(n.koSet, 'knockout result'));
    if (n.playerChanges) parts.push(plural(n.playerChanges, 'player change'));
    if (n.settings) parts.push(plural(n.settings, 'setting change'));
    return `${HINTS[action]}: ${parts.join(', ') || 'no data changes'}`;
  }
  if (!changes.length) return 'No visible changes';
  return changes.slice(0, 3).map(c => c.text).join('; ') + (changes.length > 3 ? ` (+${changes.length - 3} more)` : '');
}

module.exports = { diffState, rname };
