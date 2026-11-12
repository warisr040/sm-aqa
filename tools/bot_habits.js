#!/usr/bin/env node
/* ==========================================================================
   How the players play, turn by turn (Pack, Revise#396) — the numbers behind the bot's building rules.
     node tools/bot_habits.js rooms.json
   rooms.json = Admin → Online rooms → "Download rooms (for the bot)". Every game is replayed; for each PLAYER seat
   (not the seat named "Bot…" in a SOLOBOT room) and each of its own turns: Character cards set (Aggressive or not),
   Break / Project / Fast / Permanent cards declared, power cards charged from the hand (by card type) and from the
   deck, Character cards left in the hand at the end of the turn, and the field at the end of the turn (Controlled
   Characters, waiting Active Characters, power cards, Charge, Draw). Guards: when the player was attacked and had a
   character that could guard — did it guard, and would that guard have been defeated?
   ========================================================================== */
const fs = require("fs"); const { AA4, DB } = require("./bot_lib.js");
const rooms = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const turns = [], guards = [];
const isAgg = i => !!(i && (i.aggressive || (i.skills && i.skills.aggressive)));
for (const [code, room] of Object.entries(rooms)) {
  const entries = Object.entries(room.log || {}).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, e]) => Object.assign({ id: k }, e));
  const index = new Map(entries.map((e, i) => [e.id, i])); for (let i = 0; i < entries.length; i++) { const e = entries[i]; if (["undo", "redo", "undoOk", "undoNo"].includes(e.t) && e.ofId) entries[i] = Object.assign({}, e, { of: index.has(e.ofId) ? index.get(e.ofId) : -1 }); }
  const L = new AA4.GameLog(DB, {}), bots = new Set(); let seatN = 0, cur = null; const own = {};
  const close = S => { if (!cur) return; const s = cur.seat, p = S.players[s]; if (!p) { cur = null; return; }
    const inf = id => DB.card(S.cards[id].key) || {};
    cur.handEnd = p.zones.hand.length; cur.handChars = p.zones.hand.filter(id => inf(id).type === "Character").length;
    cur.ctl = AA4.controlledOf(S, s).length; cur.waiting = AA4.charsOf(S, s).filter(id => !AA4.isControlled(S.chars[id])).length;
    cur.power = AA4.controlledOf(S, s).reduce((n, id) => n + S.chars[id].power.length, 0);
    try { const ps = AA4.playerStats(S, DB, s); cur.charge = +ps.charge || 0; cur.draw = +ps.draw || 0; } catch (e) { cur.charge = cur.draw = 0; }
    turns.push(cur); cur = null; };
  for (const e of entries) {
    if (e.t === "join") { if (code.startsWith("SOLOBOT") && /^Bot/.test(e.name || "")) bots.add(seatN); seatN++; }
    const S0 = L.state;
    if (S0.stage === "play" && (!cur || cur.turn !== S0.turn.number)) { close(S0); const s = S0.turn.player; if (!bots.has(s)) { own[s] = (own[s] || 0) + 1; cur = { code, seat: s, turn: S0.turn.number, n: own[s], setChar: 0, setAgg: 0, setBreak: 0, setNamed: 0, setOther: 0, chargeHand: { Character: 0, Break: 0, Project: 0, Fast: 0, Permanent: 0 }, chargeDeck: 0, attacks: 0 }; } }
    if (cur && e.seat === cur.seat && S0.turn.player === cur.seat) {
      const c = e.card && S0.cards[e.card], inf = c && c.key ? DB.card(c.key) || {} : {};
      if (e.t === "declare" && e.kind === "set" && c && c.place.z === "hand") { if (inf.type === "Character" && !e.asBreak) { cur.setChar++; if (isAgg(inf)) cur.setAgg++; } else if (inf.type === "Break") { cur.setBreak++; if (inf.name) cur.setNamed++; } else cur.setOther++; }
      if (e.t === "charge") { if (e.fromDeck) cur.chargeDeck++; else if (inf.type) cur.chargeHand[inf.type] = (cur.chargeHand[inf.type] || 0) + 1; }
      if (e.t === "declare" && e.kind === "attack") cur.attacks++;
    }
    if ((e.t === "noGuard" || (e.t === "declare" && e.kind === "guard")) && e.seat != null && !bots.has(e.seat) && S0.battle && S0.chars[S0.battle.attacker] && S0.battle.target && S0.battle.target.seat === e.seat) {
      const at = +AA4.charStats(S0, DB, S0.battle.attacker).at || 0;
      const able = AA4.controlledOf(S0, e.seat).filter(id => { const ch = S0.chars[id]; if (ch.flags && ch.flags.tapped) return false; const g = AA4.charStats(S0, DB, id); return g.guardFree || ch.power.length >= (+g.guardCost || 0); });
      if (able.length) { const lives = able.filter(id => (+AA4.charStats(S0, DB, id).de || 0) > at); let ps = {}; try { ps = AA4.playerStats(S0, DB, e.seat); } catch (x) { /* */ }
        guards.push({ guarded: e.t === "declare", couldLive: lives.length > 0, usedLive: e.t === "declare" ? (+AA4.charStats(S0, DB, e.ch).de || 0) > at : null, at, dmg: S0.players[e.seat].zones.damage.length, charge: +ps.charge || 0 }); }
    }
    const r = L.push(e); void r;
  }
  close(L.state);
}
const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : "-"; }, avg = a => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : "-");
const row = (name, R) => { if (!R.length) return; const f = k => R.map(k), ch = R.reduce((o, r) => { for (const [k, v] of Object.entries(r.chargeHand)) o[k] = (o[k] || 0) + v; return o; }, {}), tot = Object.values(ch).reduce((a, b) => a + b, 0) || 1;
  console.log(`${name} (${R.length} turns): Character cards set avg ${avg(f(r => r.setChar))} · median ${q(f(r => r.setChar), .5)} · 75% ${q(f(r => r.setChar), .75)} (Aggressive avg ${avg(f(r => r.setAgg))}) | Break set avg ${avg(f(r => r.setBreak))} (named ${avg(f(r => r.setNamed))}) | charged from the hand avg ${avg(f(r => Object.values(r.chargeHand).reduce((a, b) => a + b, 0)))} — ${Object.entries(ch).map(([k, v]) => k + " " + Math.round(100 * v / tot) + "%").join(", ")} · from the deck avg ${avg(f(r => r.chargeDeck))}
     end of turn: hand ${q(f(r => r.handEnd), .5)} (Character cards in it: avg ${avg(f(r => r.handChars))}, median ${q(f(r => r.handChars), .5)}, none in ${R.filter(r => !r.handChars).length}) | Controlled ${q(f(r => r.ctl), .5)} · waiting Active ${q(f(r => r.waiting), .5)} · power ${q(f(r => r.power), .5)} · Charge ${q(f(r => r.charge), .5)} · Draw ${q(f(r => r.draw), .5)} | attacks avg ${avg(f(r => r.attacks))}`); };
const games = new Set(turns.map(t => t.code + t.seat)).size;
console.log(`${Object.keys(rooms).length} rooms · ${games} player seats · ${turns.length} player turns`);
for (const [name, f] of [["own turn 1", r => r.n === 1], ["own turn 2", r => r.n === 2], ["own turn 3", r => r.n === 3], ["own turn 4", r => r.n === 4], ["own turns 5–6", r => r.n >= 5 && r.n <= 6], ["own turns 7+", r => r.n >= 7]]) row(name, turns.filter(f));
const G = guards, pct = (a, b) => (b ? Math.round(100 * a / b) + "%" : "-");
const gl = G.filter(g => g.couldLive), gd = G.filter(g => !g.couldLive);
console.log(`guards (attacked, with a character that could guard): ${G.length} · a guard would have lived: guarded ${gl.filter(g => g.guarded).length}/${gl.length} (${pct(gl.filter(g => g.guarded).length, gl.length)}) · every guard would have been defeated: guarded ${gd.filter(g => g.guarded).length}/${gd.length} (${pct(gd.filter(g => g.guarded).length, gd.length)})`);
console.log(`   guarded with a character that was then defeated: ${G.filter(g => g.guarded && g.usedLive === false).length} of ${G.filter(g => g.guarded).length} guards · not guarded: damage already taken median ${q(G.filter(g => !g.guarded).map(g => g.dmg), .5)}, the hit median ${q(G.filter(g => !g.guarded).map(g => g.at), .5)}`);
