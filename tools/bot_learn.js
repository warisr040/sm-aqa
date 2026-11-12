#!/usr/bin/env node
/* ==========================================================================
   Bot learning from real games — the winners only (Pack, Revise#308).
     node tools/bot_learn.js rooms.json [passes=3]
   rooms.json = Admin (#addoge) → Online rooms → "Download rooms (for the bot)": {code: {log: {pushKey: entry}}}.
   Each room that finished with one winner is replayed move by move. At every move the WINNER made, the bot
   lists the legal moves it could have made then and how it would score them; when its favourite is not the
   winner's move, the weights move toward the winner's move (a perceptron step). Losers' moves are not used.
   The result is written to src/engine/21-bot-weights.js (the weights the site's bot plays with).
   ========================================================================== */
const fs = require("fs"), path = require("path");
const { AA4, DB } = require("./bot_lib.js");
const OUT = process.env.BOT_OUT || path.join(__dirname, "..", "src", "engine", "21-bot-weights.js");   // BOT_OUT: write somewhere else (Revise#317)
const ONLY = process.env.BOT_SEAT != null ? +process.env.BOT_SEAT : null;   // learn from this seat's moves only (a player's style), winner or not
const file = process.argv[2], PASSES = +(process.argv[3] || 3), LR = 0.02;
if (!file) { console.log("usage: node tools/bot_learn.js rooms.json [passes]"); process.exit(1); }
let rooms = JSON.parse(fs.readFileSync(file, "utf8"));
if (rooms && rooms.kind === "aa4-replay") rooms = { [rooms.room || "replay"]: { log: Object.fromEntries(rooms.entries.map(e => [e.id, e])) } };   // a replay file (Revise#317)
const w = Object.assign({}, AA4.BOT_DEFAULT_WEIGHTS, AA4.BOT_WEIGHTS || {});
const same = (a, b) => { const k = x => JSON.stringify(Object.assign({}, x, { by: undefined, ts: undefined, seat: undefined, id: undefined, cid: undefined })); return k(a) === k(b); };
// 1. the finished games and their winners
const games = [];
for (const [code, room] of Object.entries(rooms)) {
  const entries0 = Object.entries((room && room.log) || {}).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, e]) => Object.assign({ id: k }, e));
  const index = new Map(entries0.map((e, i) => [e.id, i]));   // undo / redo point at an entry by its id → its index (as the table does)
  const entries = entries0.map(e => (["undo", "redo", "undoOk", "undoNo"].includes(e.t) && e.ofId ? Object.assign({}, e, { of: index.has(e.ofId) ? index.get(e.ofId) : -1 }) : e));
  if (entries.length < 10) continue;
  let L; try { L = AA4.GameLog.from(DB, entries, {}); } catch (e) { continue; }
  const S = L.state, alive = AA4.living(S);
  if (ONLY == null && (S.stage !== "over" || alive.length !== 1)) continue;   // a player's style (BOT_SEAT): every game counts
  if (/^SOLOBOT-/.test(code) && alive[0] === 1) continue;   // vs Bot won by the bot: nothing new to learn (Revise#309)
  // SOLOBVB- (Bot vs Bot, Revise#311): learned too — the winner's moves against the loser's
  games.push({ code, entries, winner: alive[0] });
}
console.log(`${Object.keys(rooms).length} rooms · ${games.length} finished with a winner`);
// 2. learn from the winners' moves
let agree = 0, total = 0;
for (let pass = 1; pass <= PASSES; pass++) {
  agree = 0; total = 0;
  for (const g of games) {
    const L = new AA4.GameLog(DB, {});
    for (const e of g.entries) {
      const S = L.state;
      let seat = null; try { seat = AA4.seatFor(S, e); } catch (x) {}
      if ((ONLY != null ? seat === ONLY : seat === g.winner) && S.stage === "play" && !["create", "join", "start", "undo", "redo", "undoOk", "undoNo", "chat", "watch"].includes(e.t)) {
        const list = AA4.botScored(S, DB, seat, e.by, { max: 90, must: e }).filter(x => x.f);
        const chosen = list.find(x => same(x.it, e));
        if (chosen && list.length > 1) {
          total++;
          let top = null, topV = -Infinity;
          for (const x of list) { const v = AA4.botScore(w, x.f); if (v > topV) { topV = v; top = x; } }
          if (top === chosen || same(top.it, chosen.it)) agree++;
          else for (const k of new Set(Object.keys(chosen.f).concat(Object.keys(top.f)))) if (k[0] !== "_" && k !== "cancel") w[k] = +((w[k] || 0) + LR * ((chosen.f[k] || 0) - (top.f[k] || 0))).toFixed(4);
        }
      }
      L.push(e);
    }
  }
  console.log(`pass ${pass}: the bot agreed with the winners in ${agree}/${total} moves`);
}
if (!total) { console.log("no winner moves to learn from — nothing written"); process.exit(0); }
fs.writeFileSync(OUT, `/* Bot weights (Revise#308) — written by tools/bot_learn.js on ${new Date().toISOString().slice(0, 10)} from ${games.length} finished online games (the winners' moves; agreement ${agree}/${total}).\n   Delete this file to go back to the defaults in 20-bot.js. */\n(typeof window !== "undefined" ? window : global).AA4.BOT_WEIGHTS = ${JSON.stringify(w, null, 1)};\n`);
console.log("written", OUT);
