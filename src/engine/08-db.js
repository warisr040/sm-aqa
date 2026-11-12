/* ==========================================================================
   v4 engine · card database adapters

   The engine never parses card text at play time (Revise#048). It asks one
   object:  db.card(key) → { key, type, faction, jp, en, icons, stats } | null
   B6 adds the compiled rule links (skills / effects / abilities) to the same object.

   AA4.dbFromSiteData(window.AA_DATA, window.AA_RULES)  the site's data.js + rules.js (built by build.py)
   AA4.dbFromList([{key, type, faction, jp, …}])  small test fixtures
   ========================================================================== */
(function (G) {
  "use strict";
  const AA4 = G.AA4;
  const norm = k => String(k).toUpperCase().replace(/\s+/g, " ").trim();

  /** Defaults for every engine field, so a card with only {key, type} still works. */
  /** A card's name for the screen and the log: English, the Japanese one when the card has none (Pack). */
  /** The English line of a card's text for one of its Japanese lines (same line number in the printed text), or "" (Pack, Revise#122). */
  AA4.enText = (inf, jp) => {
    if (!inf || !jp) return "";
    const norm = t => String(t || "").replace(/[\s。]/g, "").replace(/[-ー−]/g, "ー").replace(/[：:]/g, ":");
    const jpL = String(inf.text || "").split("\n"), enL = String(inf.textEn || "").split("\n"), n = norm(jp);
    if (!n || enL.length !== jpL.length) return "";
    let i = jpL.findIndex(l => norm(l) && norm(l) === n);
    if (i < 0) i = jpL.findIndex(l => norm(l) && (norm(l).includes(n) || n.includes(norm(l))));
    if (i < 0) {   // a statement that runs over several printed lines: the English lines it covers
      const k = jpL.findIndex(l => norm(l) && n.startsWith(norm(l)));
      if (k >= 0) { let acc = "", j = k; while (j < jpL.length && acc.length < n.length) acc += norm(jpL[j++]); if (acc === n) return enL.slice(k, j).join(" "); }
      return "";
    }
    return enL[i] || "";
  };
  /** English for a personal name ("ディーナ・ウィザースプーン" → "Dina Witherspoon"), from a card whose English name quotes it. */
  const NAME_EN = new WeakMap();
  AA4.nameEn = (db, jp) => {
    if (!db || !jp) return jp;
    let map = NAME_EN.get(db);
    if (!map) {
      map = new Map();
      for (const c of db.all ? db.all() : []) if (c.name && c.en && !map.has(c.name)) { const q = /[“"]([^”"]+)[”"]/.exec(c.en); if (q) map.set(c.name, q[1]); }
      NAME_EN.set(db, map);
    }
    return map.get(jp) || jp;
  };
  AA4.cardName = inf => (inf ? (inf.en ? `“${String(inf.en).replace(/"([^"]*)"/g, "‘$1’").replace(/"/g, "’")}”` : `「${inf.jp}」`) : "a card");
  AA4.cardDefaults = c => Object.assign({ faction: "", jp: c.key, en: "", name: "", icons: [], se: null, at: null, atMental: false, de: null,
    cost: null, factor: {}, skills: {}, effects: [], abilities: [], play: null, statMods: null, breakRule: null, fastTiming: false, status: "auto" }, c);
  AA4.dbFromList = list => {
    const map = new Map(list.map(c => [norm(c.key), AA4.cardDefaults(Object.assign({}, c, { key: norm(c.key) }))]));
    return { size: map.size, card: k => map.get(norm(k)) || null, all: () => [...map.values()] };
  };

  /** data.js layout (build.py load_cards): c = [no, jp, en, drive id, series, faction, type, note, stats, extra, yomi, skills, values].
      R = window.AA_RULES (rules.js from tools/rules_compile.py): {cards: {key: compiled}, report}. */
  AA4.dbFromSiteData = (D, R) => {
    const rules = (R && R.cards) || {};
    const list = [], seen = new Set();
    for (const r of D.c) {
      let key = norm(D.s[r[4]][0] + " " + r[0]);
      if (seen.has(key)) key += "#2";
      seen.add(key);
      const st = r[8] || [];
      list.push(Object.assign({ key, type: D.t[r[6]] || "", faction: D.f[r[5]] || "", jp: r[1], en: r[2] }, rules[key] || {},
        { key, faction: D.f[r[5]] || "", jp: r[1], en: r[2], fid: r[3], text: r[9] && r[9][0] >= 0 ? D.p[r[9][0]] : "", textEn: r[9] && r[9][8] >= 0 ? D.p[r[9][8]] : "", rarity: r[9] && r[9][2] >= 0 ? D.p[r[9][2]] : "",
          printed: { fa: st[0], co: st[1], se: st[2], at: st[3], de: st[4] } }));
    }
    const db = AA4.dbFromList(list), alias = D.a || {};
    const get = db.card;
    db.card = k => get(k) || (alias[norm(k)] ? get(alias[norm(k)]) : null);   // old deck keys still resolve (as card() in 01-core.js)
    db.report = (R && R.report) || null;
    return db;
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
