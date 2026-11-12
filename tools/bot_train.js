#!/usr/bin/env node
/* ==========================================================================
   Bot self-play training (Pack, Revise#308).
     node tools/bot_train.js [generations=20] [gamesPerMatch=8] [decks.json]
   The champion weights (src/engine/21-bot-weights.js, or the defaults) play mutants in bot-vs-bot games with
   the training decks (tests/engine/fixtures/pack_decks.json, plus decks.json if given: [{name, cards:[keys]}]),
   both seats and every deck pair in turn. A mutant that wins clearly (≥ 60% of the games) becomes the champion —
   the winner's weights survive and are varied again. The result is written back to 21-bot-weights.js.
   ========================================================================== */
const fs = require("fs"), path = require("path");
const { AA4, PACK, playGame } = require("./bot_lib.js");
const OUT = process.env.BOT_OUT || path.join(__dirname, "..", "src", "engine", "21-bot-weights.js");   // BOT_OUT: write somewhere else (a long run, Revise#312)
const GENS = +(process.argv[2] || 20), GAMES = +(process.argv[3] || 8);
const decks = PACK.concat(process.argv[4] ? JSON.parse(fs.readFileSync(process.argv[4], "utf8")) : []).filter(d => d.cards && d.cards.length >= 40);
let champ = Object.assign({}, AA4.BOT_DEFAULT_WEIGHTS, AA4.BOT_WEIGHTS || {});
if (process.env.BOT_FROM) {   // go on from another run's weights (a weights .js file, or a checkpoint .json)
  const t = fs.readFileSync(process.env.BOT_FROM, "utf8"), j = t.trim().startsWith("{") ? JSON.parse(t).champ : JSON.parse(t.slice(t.indexOf("= {") + 2).replace(/;\s*$/, ""));
  champ = Object.assign(champ, j);
}
let seedN = 0;
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const mutate = w => { const m = {}; for (const [k, v] of Object.entries(w)) m[k] = k === "cancel" || (AA4.BOT_LIMIT_KEYS || []).includes(k) ? v : +(v * (1 + 0.18 * gauss()) + 0.05 * gauss()).toFixed(3); return m; };
const match = (wA, wB) => {   // wins of A over GAMES games (seats and decks rotate)
  let a = 0, played = 0;
  for (let g = 0; g < GAMES; g++) {
    const d1 = decks[g % decks.length], d2 = decks[(g + 1 + Math.floor(g / decks.length)) % decks.length], swap = g % 2 === 1;
    const r = playGame({ wA: swap ? wB : wA, wB: swap ? wA : wB, deckA: d1.cards, deckB: d2.cards, seed: "train-" + (seedN++), noise: 0.2 });
    // no winner (the step limit): the side that dealt more damage wins it (Pack, Revise#311: dealing the 10 damage is the goal)
    const w = r.winner != null ? r.winner : r.damage && r.damage[0] !== r.damage[1] ? (r.damage[0] > r.damage[1] ? 1 : 0) : null;
    if (w == null) continue;
    played++; if ((w === 0) !== swap) a++;
  }
  return { a, played };
};
console.log(`decks: ${decks.map(d => d.name).join(", ")} · ${GENS} generations × 4 mutants × ${GAMES} games`);
const t0 = Date.now();
const MINUTES = +(process.env.BOT_MINUTES || 0);
const ANCHOR = process.env.BOT_ANCHOR !== "0", START = Object.assign({}, champ);   // stop after this many minutes (0 = no limit)
for (let gen = 1; gen <= GENS; gen++) {
  if (MINUTES && Date.now() - t0 > MINUTES * 60000) { console.log(`time limit (${MINUTES} min) — stopping after ${gen - 1} rounds`); break; }
  let best = null;
  for (let k = 0; k < 4; k++) {
    const m = mutate(champ), r = match(m, champ);
    if (r.played >= Math.ceil(GAMES * .75) && r.a / r.played >= 0.6 && (!best || r.a / r.played > best.rate)) best = { w: m, rate: r.a / r.played, r };
  }
  // an anchor (Revise#316): a new champion must also beat the weights the run started from — no drifting by luck
  if (best && ANCHOR) { const r2 = match(best.w, START); if (!(r2.played && r2.a / r2.played >= 0.55)) { console.log(`   (challenger ${best.r.a}/${best.r.played} lost to the start weights ${r2.a}/${r2.played} — not taken)`); best = null; } }
  if (best) champ = best.w;
  if (gen % 10 === 0) fs.writeFileSync(OUT + ".partial.json", JSON.stringify({ gen, champ }, null, 1));   // a checkpoint every 10 rounds (a long run may be stopped)
  console.log(`gen ${gen}: ${best ? `new champion (${best.r.a}/${best.r.played})` : "champion kept"} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
// a last check against the hand-made defaults
const fin = match(champ, AA4.BOT_DEFAULT_WEIGHTS);
console.log(`trained vs defaults: ${fin.a}/${fin.played}`);
fs.writeFileSync(OUT, `/* Bot weights (Revise#308) — written by tools/bot_train.js / bot_learn.js on ${new Date().toISOString().slice(0, 10)}.\n   Trained vs the defaults: ${fin.a}/${fin.played} games won. Delete this file to go back to the defaults in 20-bot.js. */\n(typeof window !== "undefined" ? window : global).AA4.BOT_WEIGHTS = ${JSON.stringify(champ, null, 1)};\n`);
console.log("written", OUT);
