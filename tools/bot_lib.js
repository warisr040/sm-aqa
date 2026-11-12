/* Bot tools (Revise#308): load the engine and the real card data in Node; play bot vs bot. */
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const AA4 = require(path.join(ROOT, "tests", "engine", "load.js"));
const win = {}; new Function("window", fs.readFileSync(path.join(ROOT, "dist", "aquarian-age-helper", "assets", "data.js"), "utf8"))(win);
new Function("window", fs.readFileSync(path.join(ROOT, "dist", "aquarian-age-helper", "assets", "rules.js"), "utf8"))(win);
const DB = AA4.dbFromSiteData(win.AA_DATA, win.AA_RULES);
const PACK = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "engine", "fixtures", "pack_decks.json"), "utf8"));

/** One game: seat 0 plays with weights wA and deckA, seat 1 with wB / deckB. Returns {winner, turns, steps, why}. */
function playGame({ wA, wB, deckA, deckB, seed, maxSteps = 3000, noise = 0.3 }) {
  const log = new AA4.GameLog(DB, {});
  log.push({ t: "create", by: "P0", seed, mode: "online", seats: 2, rules: { autoPay: true, autoSkip: true, mullMain: true } });
  log.push({ t: "join", by: "P0", name: "A", deck: deckA });
  log.push({ t: "join", by: "P1", name: "B", deck: deckB });
  let steps = 0, idle = 0;
  while (log.state.stage !== "over" && steps < maxSteps) {
    const S = log.state;
    let acted = false;
    for (const seat of [0, 1]) {
      if (!AA4.botTurn(S, seat) && S.stage !== "mulligan") continue;
      const it = AA4.botChoose(S, DB, seat, "P" + seat, { weights: seat === 0 ? wA : wB, noise });
      if (!it) continue;
      const r = log.push(it); steps++;
      if (r.ok) { acted = true; break; }
    }
    if (!acted) {   // nobody's own turn: whoever has a move (a response window …)
      for (const seat of [0, 1]) { const c = AA4.candidates(log.state, DB, "P" + seat, seat, {}).find(x => x.t === "pass" || x.t === "next" || x.t === "noGuard"); if (c && log.push(c).ok) { acted = true; steps++; break; } }
    }
    if (!acted && ++idle > 5) return { winner: null, turns: S.turn.number, steps, why: "stuck", damage: S.players.map(p => p.zones.damage.length) };
    if (acted) idle = 0;
  }
  const S = log.state, alive = AA4.living(S);
  return { winner: S.stage === "over" && alive.length === 1 ? alive[0] : null, turns: S.turn.number, steps, why: S.stage === "over" ? "over" : "steps", damage: S.players.map(p => p.zones.damage.length) };
}
module.exports = { AA4, DB, PACK, playGame };
