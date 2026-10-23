// Pure helpers for live updates, shared by index.html (window.SYNC) and the unit tests (require).
// No DOM, no I/O.
(function (root) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // The fields the Settings page edits. Everything else (scores, knockout, rankings) is never taken from the draft.
  const KEYS = ['title', 'sub', 'ng', 'q', 'third', 'players', 'hist'];
  const view = (k, o) => {
    const v = o ? o[k] : undefined;
    if (k === 'players') return (Array.isArray(v) ? v : []).map(p => [p && p.id, p && p.name, p && p.g]);
    // the auto-maintained current-season entry (tagged with t) is not something the admin edits
    if (k === 'hist') return (Array.isArray(v) ? v : []).filter(h => h && !h.t);
    return v ?? null;
  };

  // Is d a usable tournament state?
  const valid = d => !!d && typeof d === 'object' && d.v === 1 && Array.isArray(d.players);

  // Should an incoming revision replace what we have? Equal revs are our own save echoing back (or a duplicate).
  const newer = (rev, cur) => Number.isFinite(rev) && rev > 0 && rev > (Number(cur) || 0);

  // Settings keys where the draft differs from the state it was copied from.
  const edited = (draft, base) => KEYS.filter(k => !same(view(k, draft), view(k, base)));
  const dirty = (draft, base) => !!draft && edited(draft, base).length > 0;

  // Three-way merge for Save Settings: start from the latest state and take only the fields the admin edited.
  // conflicts = fields another admin also changed (differently) since the draft was made.
  function merge(draft, base, cur) {
    const data = JSON.parse(JSON.stringify(cur)), conflicts = [];
    for (const k of edited(draft, base)) {
      if (!same(view(k, cur), view(k, base)) && !same(view(k, cur), view(k, draft))) conflicts.push(k);
      data[k] = JSON.parse(JSON.stringify(draft[k]));
    }
    return { data, conflicts };
  }

  // Group-stage match ids whose score differs between two sc maps.
  function changed(a, b) {
    a = a || {}; b = b || {};
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(id => !same(a[id], b[id]));
  }

  // At most one "Updated by another admin" toast per gap.
  const due = (last, now, gap = 10e3) => !last || now - last >= gap;

  const SYNC = { KEYS, valid, newer, edited, dirty, merge, changed, due };
  if (typeof module === 'object' && module.exports) module.exports = SYNC;
  else root.SYNC = SYNC;
})(this);
