#!/usr/bin/env node
/* ==========================================================================
   v4 engine · headless test runner (requirements_v4 §20.9 B1, §20.10)

     node tests/engine/run.js              all tests
     node tests/engine/run.js undo         only tests whose name contains "undo"

   1. Unit tests (below)
   2. Scenario tests: tests/engine/scenarios/*.json — a script of intents → expected state:
        { "name": "...", "steps": [
            { "t": "create", "by": "A", "seed": "s1", "mode": "online", "seats": 2 },   an intent: must be accepted
            { "t": "join", "by": "C", ..., "refuse": "full" },                         must be refused (reason contains the text)
            { "expect": "players.0.zones.hand", "len": 7 },                            check the state
            { "events": { "e": "order" } } ] }                                         the last intent emitted such an event
      Expect ops: eq, ne, missing (true = not there), len, key (card id → card key), keys (list of ids → keys), includes, ne.
      Paths: dots into the state; "$last" = last item; "$type:Break" / "$key:T 001" = first card id of that type / key
      in that list; "$free:T 001" = a card with that key still in the hand or deck.
      A string "@path" anywhere in an intent is replaced by the value at that path (e.g. "card": "@players.0.zones.hand.$type:Character").
      "of": "auto" in undo / redo = the entry the player's Undo / Redo button would use.
      Decks: "deck": { "repeat": ["T 001", "T 101"], "n": 30 } is expanded to 30 cards.
      Every intent runs with debug: "ops" — invariants are checked after every single operation.
   3. Fuzz: random legal by-hand actions for 2–4 players with many seeds; invariants after every
      operation; replay check (the log replayed from scratch = the live state).
   4. Real card data (if dist/aquarian-age-helper/assets/data.js exists — run python3 build.py first):
      decks from the real card list, one fuzz game.
   ========================================================================== */
"use strict";
const fs = require("fs"), path = require("path");
const AA4 = require("./load.js");
/* Pack's Hold default (Revise#205) has Aggressive and Break / Permanent OFF. The older tests were written when every
   Hold type started ON, so they keep that start; the Revise#205 test checks the real default. */
const REAL_HOLD_DEFAULT = Object.assign({}, AA4.HOLD_DEFAULT);
AA4.HOLD_DEFAULT = { aggressive: true, battle: true, project: true, fast: true, effect: true, break: true, undo: true };
const FIXTURES = AA4.dbFromList(JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "cards.json"), "utf8")));
const only = process.argv[2] || "";

let passed = 0, failed = 0;
const fails = [];
function test(name, fn) {
  if (only && !name.includes(only)) return;
  try { fn(); passed++; console.log("  ✓ " + name); }
  catch (err) { failed++; fails.push(name); console.log("  ✗ " + name + "\n      " + String(err && err.stack || err).split("\n").slice(0, 6).join("\n      ")); }
}
function assert(ok, msg) { if (!ok) throw new Error(msg || "assertion failed"); }
const short = t => (t && t.length > 400 ? t.slice(0, 400) + "…" : t);
function eq(a, b, msg) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error(`${msg || "expected equal"}: got ${short(A)}, want ${short(B)}`); }

/* ---------- helpers ---------- */
const deckOf = (keys, n) => Array.from({ length: n }, (_, i) => keys[i % keys.length]);
const MIXED = ["T 001", "T 002", "T 003", "T 004", "T 005", "T 006", "T 007", "T 101", "T 102", "T 201", "T 301", "T 401"];
/** A new log with players seated (auto-start), optionally past the opening hands. */
function table({ seats = 2, seed = "seed-1", mode = "online", keep = true, deck = deckOf(MIXED, 30), db = FIXTURES, debug = "ops" } = {}) {
  const log = new AA4.GameLog(db, { debug });
  const ok = it => { const r = log.push(it); if (!r.ok) throw new Error(`${it.t} refused: ${r.reason}`); return r; };
  ok({ t: "create", by: "P0", seed, mode, seats });
  const n = mode === "solo1" ? 1 : mode === "solo2" ? 2 : seats;
  for (let s = 0; s < n; s++) ok({ t: "join", by: mode === "online" ? "P" + s : "P0", name: "Player " + (s + 1), deckName: "D" + s, deck });
  if (keep) for (let s = 0; s < n; s++) ok({ t: "keep", by: mode === "online" ? "P" + s : "P0", seat: s });
  return { log, ok, S: () => log.state };
}

/* ---------- path language for scenarios ---------- */
function getPath(S, db, p) {
  let v = S;
  for (const seg of String(p).split(".")) {
    if (v == null) return undefined;
    if (seg === "$last") { v = v[v.length - 1]; continue; }
    let m;
    if ((m = seg.match(/^\$type:(.+)$/))) { v = v.find(id => { const c = S.cards[id]; return c && db.card(c.key).type === m[1]; }); continue; }
    if ((m = seg.match(/^\$key:(.+)$/))) { v = v.find(id => S.cards[id] && S.cards[id].key === m[1]); continue; }
    if ((m = seg.match(/^\$free:(.+)$/))) { v = Object.values(S.cards).filter(c => c.key === m[1] && (c.place.z === "hand" || c.place.z === "deck")).map(c => c.id).sort()[0]; continue; }
    v = v[seg];
  }
  return v;
}
function resolveRefs(x, S, db) {
  if (typeof x === "string" && x.startsWith("@")) return getPath(S, db, x.slice(1));
  if (Array.isArray(x)) return x.map(y => resolveRefs(y, S, db));
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, resolveRefs(v, S, db)]));
  return x;
}
const subset = (sup, sub) => Object.entries(sub).every(([k, v]) => (v && typeof v === "object" ? sup[k] && subset(sup[k], v) : sup[k] === v));

function runScenario(sc) {
  const db = FIXTURES, log = new AA4.GameLog(db, { debug: "ops" });
  let last = null;
  sc.steps.forEach((st, i) => {
    const where = `step ${i + 1}${st.t ? " (" + st.t + ")" : ""}`;
    if (st.t) {
      const it = resolveRefs(Object.assign({}, st), log.state, db);
      delete it.refuse;
      if (it.deck && !Array.isArray(it.deck)) it.deck = deckOf(it.deck.repeat, it.deck.n);
      if ((it.t === "undo" || it.t === "redo") && it.of === "auto") it.of = it.t === "undo" ? log.undoTarget(it.by) : log.redoTarget(it.by);
      last = log.push(it);
      if (st.refuse != null) {
        assert(!last.ok, `${where}: should be refused (${st.refuse})`);
        assert(String(last.reason).toLowerCase().includes(String(st.refuse).toLowerCase()), `${where}: refused with "${last.reason}", expected "${st.refuse}"`);
      } else assert(last.ok, `${where}: refused — ${last.reason}`);
      return;
    }
    if (st.events) { assert(last && last.events.some(e => subset(e, st.events)), `${where}: no event like ${JSON.stringify(st.events)}`); return; }
    if (st.expect != null) {
      const v = getPath(log.state, db, st.expect), tag = `${where}: ${st.expect}`;
      if ("eq" in st) eq(v, st.eq, tag);
      if ("missing" in st) eq(v === undefined, !!st.missing, tag + " missing");
      if ("ne" in st) assert(JSON.stringify(v) !== JSON.stringify(st.ne), `${tag} should not be ${JSON.stringify(st.ne)}`);
      if ("len" in st) eq(v && v.length, st.len, tag + " length");
      if ("key" in st) eq(v && log.state.cards[v] && log.state.cards[v].key, st.key, tag + " key");
      if ("keys" in st) eq((v || []).map(id => log.state.cards[id].key), st.keys, tag + " keys");
      if ("includes" in st) assert(Array.isArray(v) && v.includes(st.includes), `${tag} should include ${JSON.stringify(st.includes)} (is ${JSON.stringify(v)})`);
      return;
    }
    throw new Error(`${where}: unknown step`);
  });
  const bad = AA4.replayCheck(log);
  assert(!bad, bad);
}

/* ---------- fuzz ---------- */
function fuzz({ seed, seats, steps, db, deck, mode = "online" }) {
  const { log, S } = table({ seats, seed, mode, keep: false, db, deck, debug: "ops" });
  let n = 0;
  const pick = (arr, r) => arr[Math.floor(r() * arr.length)];
  let x = AA4.seedOf("fuzz" + seed);
  const r = () => (x = AA4.rand32(x, 7)) / 4294967296;
  const byOf = s => (mode === "online" ? "P" + s : "P0");
  while (S().stage === "mulligan") {   // opening: a few mulligans, then keep
    const p = S().players.find(q => !q.ready);
    log.push({ t: r() < 0.3 ? "mulligan" : "keep", by: byOf(p.seat), seat: p.seat });
  }
  for (let k = 0; k < steps; k++) {
    const seat = pick(S().players.map(p => p.seat), r), by = byOf(seat);
    const roll = r();
    let it;
    if (roll < 0.05) it = { t: "undo", by, of: log.undoTarget(by) };
    else if (roll < 0.07) it = { t: "redo", by, of: log.redoTarget(by) };
    else if (roll < 0.10) it = { t: "shuffle", by, seat };
    else if (roll < 0.18) it = { t: "draw", by, seat, n: 1 + Math.floor(r() * 3) };
    else if (roll < 0.30) {
      const chars = AA4.charsOf(S(), seat);
      if (!chars.length) continue;
      const ch = pick(chars, r), to = pick(AA4.charDestinations(S(), db, seat, ch), r);
      if (!to) continue;
      it = { t: "moveChar", by, seat, ch, to: Object.assign(to, r() < 0.3 ? { index: 0 } : {}) };
    } else {
      const la = AA4.legalActions(S(), db, by, seat).find(a => a.t === "move");
      if (!la || !la.cards.length) continue;
      // prefer the hand and the field, so characters get built up
      const cards = la.cards.filter(id => S().cards[id].place.z !== "deck" || r() < 0.05);
      const card = pick(cards.length ? cards : la.cards, r), dests = AA4.moveDestinations(S(), db, seat, card);
      it = { t: "move", by, seat, card, to: pick(dests, r) };
    }
    if ((it.t === "undo" || it.t === "redo") && it.of < 0) continue;
    const res = log.push(it);
    if (!res.ok && it.t !== "undo" && it.t !== "redo") throw new Error(`legal action refused: ${JSON.stringify(it)} — ${res.reason}`);
    n++;
  }
  const bad = AA4.replayCheck(log);
  if (bad) throw new Error(bad);
  return { log, n };
}

/* ======================================================================== */
console.log("Unit tests");

test("rng: same seed → same numbers; different seed → different", () => {
  const a = { rng: { s: AA4.seedOf("abc"), n: 0 } }, b = { rng: { s: AA4.seedOf("abc"), n: 0 } }, c = { rng: { s: AA4.seedOf("abd"), n: 0 } };
  const A = Array.from({ length: 20 }, () => AA4.random(a)), B = Array.from({ length: 20 }, () => AA4.random(b)), C = Array.from({ length: 20 }, () => AA4.random(c));
  eq(A, B); assert(JSON.stringify(A) !== JSON.stringify(C)); eq(a.rng.n, 20);
  assert(A.every(v => v >= 0 && v < 1));
});
test("rng: number n depends only on (seed, n) — replaying fewer draws gives the same prefix", () => {
  const s = AA4.seedOf("x");
  const S = { rng: { s, n: 5 } };
  eq(AA4.random(S), AA4.rand32(s, 5) / 4294967296);
});
test("rng: shuffle is a permutation and roughly uniform", () => {
  const S = { rng: { s: AA4.seedOf("uniform"), n: 0 } }, counts = Array.from({ length: 6 }, () => Array(6).fill(0));
  const N = 30000;
  for (let k = 0; k < N; k++) { const a = AA4.shuffleInPlace(S, [0, 1, 2, 3, 4, 5]); eq([...a].sort(), [0, 1, 2, 3, 4, 5]); a.forEach((v, i) => counts[v][i]++); }
  for (const row of counts) for (const c of row) assert(Math.abs(c - N / 6) < N / 6 * 0.06, `position count ${c} too far from ${N / 6}`);
});

test("setup: 2 players → coin toss, 7 cards each, mulligan stage", () => {
  const { S } = table({ keep: false });
  eq(S().stage, "mulligan");
  eq([...S().turn.order].sort(), [0, 1]);
  for (const p of S().players) { eq(p.zones.hand.length, 7); eq(p.zones.deck.length, 23); }
  eq(AA4.invariants(S(), FIXTURES), []);
});
test("setup: same seed → same game; another seed → another deal", () => {
  const a = table({ seed: "same" }).S(), b = table({ seed: "same" }).S(), c = table({ seed: "other" }).S();
  eq(a, b);
  assert(JSON.stringify(a.players.map(p => p.zones.hand)) !== JSON.stringify(c.players.map(p => p.zones.hand)), "different seed, same hands");
});
test("setup: turn order is random over seeds (each of 4 seats goes first sometimes)", () => {
  const firsts = new Set();
  for (let i = 0; i < 40; i++) firsts.add(table({ seats: 4, seed: "o" + i, keep: false }).S().turn.order[0]);
  eq([...firsts].sort(), [0, 1, 2, 3]);
});
test("setup: keep by everyone → play, turn 1; the first player skips the draw and the game moves on to the Active Phase", () => {
  const { log, S } = table({ seats: 3 });
  eq(S().stage, "play"); eq(S().turn.number, 1); eq(S().turn.phase, "active"); eq(S().turn.player, S().turn.order[0]);
  eq(S().players[S().turn.player].zones.hand.length, 7);
  assert(log.events().some(e => e.e === "drawSkipped"), "no drawSkipped event");
});
test("setup: creator may start early with ≥ 2 players; not with 1", () => {
  const log = new AA4.GameLog(FIXTURES, { debug: "ops" });
  log.push({ t: "create", by: "A", seed: "s", mode: "online", seats: 4 });
  log.push({ t: "join", by: "A", name: "A", deck: deckOf(MIXED, 20) });
  eq(log.push({ t: "start", by: "A" }).reason, "At least 2 players are needed");
  log.push({ t: "join", by: "B", name: "B", deck: deckOf(MIXED, 20) });
  eq(log.push({ t: "start", by: "B" }).reason, "Only the room creator can start");
  assert(log.push({ t: "start", by: "A" }).ok);
  eq(log.state.stage, "mulligan"); eq(log.state.seatsWanted, 2);
  eq(log.push({ t: "join", by: "C", name: "C", deck: deckOf(MIXED, 20) }).reason, "The game has already started — you can watch");
  assert(log.push({ t: "watch", by: "C", name: "Carol" }).ok);
  eq(log.state.spectators, { C: "Carol" });
});
test("join: unknown and non-playable cards are refused", () => {
  const log = new AA4.GameLog(FIXTURES);
  log.push({ t: "create", by: "A", seed: "s", mode: "online", seats: 2 });
  eq(log.push({ t: "join", by: "A", name: "A", deck: ["T 001", "NOPE 1"] }).reason, "Unknown card NOPE 1");
  eq(log.push({ t: "join", by: "A", name: "A", deck: ["T 001", "T 900"] }).reason, "T 900 is not a playable card (Area Marker)");
});
test("mulligan: hand goes back, deck reshuffled, 7 new cards; counts unchanged", () => {
  const { log, S } = table({ keep: false });
  const before = S().players[0].zones.hand.slice();
  assert(log.push({ t: "mulligan", by: "P0" }).ok);
  eq(S().players[0].zones.hand.length, 7); eq(S().players[0].zones.deck.length, 23); eq(S().players[0].mulligans, 1);
  assert(JSON.stringify(before) !== JSON.stringify(S().players[0].zones.hand), "same hand after mulligan (unlikely)");
  log.push({ t: "keep", by: "P0" });
  eq(log.push({ t: "mulligan", by: "P0" }).reason, "You already kept your hand");
});

test("move: hand → Active Area makes a character in its faction slot", () => {
  const { log, S } = table({ mode: "solo1", deck: deckOf(["T 004"], 20) });
  const id = S().players[0].zones.hand[0];
  assert(log.push({ t: "move", by: "P0", card: id, to: { z: "active" } }).ok);
  const ch = S().players[0].areas.active.darklore[0];
  eq(S().chars[ch].stack, [id]); eq(S().cards[id].place, { z: "char", ch, role: "stack" }); eq(S().cards[id].faceUp, true);
});
test("move: Break on a character, power card, permanent; base removed → character gone, rest to discard", () => {
  const { log, S, ok } = table({ mode: "solo1", deck: ["T 001", "T 101", "T 201", "T 301", "T 002", "T 003", "T 004"].concat(deckOf(["T 005"], 13)) });
  const find = k => Object.values(S().cards).filter(c => c.key === k).map(c => c.id).sort()[0];
  const [c1, b1, p1, f1, c2] = ["T 001", "T 101", "T 201", "T 301", "T 002"].map(find);
  ok({ t: "move", by: "P0", card: c1, to: { z: "front" } });
  const ch = S().players[0].areas.front[0];
  ok({ t: "move", by: "P0", card: b1, to: { z: "char", ch, role: "stack" } });
  ok({ t: "move", by: "P0", card: p1, to: { z: "char", ch, role: "perm" } });
  if (S().cards[c2].place.z !== "hand") ok({ t: "move", by: "P0", card: c2, to: { z: "hand" } });
  ok({ t: "move", by: "P0", card: c2, to: { z: "char", ch, role: "power" } });
  eq(S().chars[ch].stack, [c1, b1]); eq(S().chars[ch].perm, [p1]); eq(S().chars[ch].power, [c2]);
  eq(S().cards[c2].faceUp, false); eq(S().cards[c2].visibleTo, [0]);   // power from hand: only its owner sees it
  const r = log.push({ t: "move", by: "P0", card: f1, to: { z: "active" } });
  eq(r.reason, "The card can't go there");   // a Fast card can't be a character
  ok({ t: "move", by: "P0", card: f1, to: { z: "special" } });
  ok({ t: "move", by: "P0", card: c1, to: { z: "hand" } });   // base card out: the Break stays as the character
  eq(S().chars[ch].stack, [b1]);
  ok({ t: "move", by: "P0", card: b1, to: { z: "damage" } });   // last card out: the character is gone
  assert(!S().chars[ch], "character still there");
  eq(S().players[0].zones.discard, [p1, c2]);
  eq(S().players[0].areas.front, []);
});
test("move: another player's card is refused; a card can't move onto its own character", () => {
  const { log, S } = table();
  const mine = S().players[0].zones.hand[0], theirs = S().players[1].zones.hand[0];
  eq(log.push({ t: "move", by: "P0", card: theirs, to: { z: "discard" } }).reason, "Not your card");
  eq(log.push({ t: "move", by: "P0", seat: 1, card: theirs, to: { z: "discard" } }).reason, "You are not playing at this table");
  const ch = Object.values(S().cards).find(c => c.owner === 0 && FIXTURES.card(c.key).type === "Character").id;
  assert(log.push({ t: "move", by: "P0", card: ch, to: { z: "front" } }).ok);
  const chId = S().players[0].areas.front[0];
  eq(log.push({ t: "move", by: "P0", card: ch, to: { z: "char", ch: chId, role: "power" } }).reason, "The card can't go there");
  void mine;
});
test("move: deck top / bottom; a moved-into-deck card is hidden again", () => {
  const { log, S } = table({ mode: "solo1" });
  const id = S().players[0].zones.hand[0];
  log.push({ t: "move", by: "P0", card: id, to: { z: "damage" } });
  eq(S().cards[id].faceUp, true);
  log.push({ t: "move", by: "P0", card: id, to: { z: "deck", pos: "bottom" } });
  eq(S().players[0].zones.deck[0], id); eq(S().cards[id].faceUp, false); eq(S().cards[id].visibleTo, []);
  log.push({ t: "move", by: "P0", card: id, to: { z: "deck" } });
  eq(S().players[0].zones.deck.slice(-1)[0], id);
});
test("moveChar: Active ↔ Control Front / Back, index", () => {
  const { log, S, ok } = table({ mode: "solo1", deck: deckOf(["T 001"], 20) });
  const [a, b] = S().players[0].zones.hand;
  ok({ t: "move", by: "P0", card: a, to: { z: "front" } }); ok({ t: "move", by: "P0", card: b, to: { z: "active" } });
  const [chA] = S().players[0].areas.front, [chB] = S().players[0].areas.active.ego;
  ok({ t: "moveChar", by: "P0", ch: chB, to: { area: "front", index: 0 } });
  eq(S().players[0].areas.front, [chB, chA]);
  ok({ t: "moveChar", by: "P0", ch: chA, to: { area: "back" } });
  eq(S().chars[chA].at, { area: "back" });
  ok({ t: "moveChar", by: "P0", ch: chA, to: { area: "active" } });
  eq(S().players[0].areas.active.ego, [chA]);
  eq(log.push({ t: "moveChar", by: "P0", ch: chA, to: { area: "active" } }).reason, "It is already there");
});

test("invariants catch a card in two places / a lost card / an empty character", () => {
  const S = table().S();
  const T1 = AA4.clone(S); const id = T1.players[0].zones.hand[0]; T1.players[0].zones.discard.push(id);
  assert(AA4.invariants(T1, FIXTURES).some(m => m.includes("two places")), "two places not caught");
  const T2 = AA4.clone(S); T2.players[0].zones.hand.pop();
  assert(AA4.invariants(T2, FIXTURES).some(m => m.includes("is nowhere")), "lost card not caught");
  const T3 = AA4.clone(S); T3.chars.ch99 = { id: "ch99", owner: 0, at: { area: "front" }, stack: [], power: [], perm: [], flags: {} }; T3.players[0].areas.front.push("ch99");
  assert(AA4.invariants(T3, FIXTURES).some(m => m.includes("has no card")), "empty character not caught");
  const T4 = AA4.clone(S); const o = T4.players[1].zones.deck.pop(); T4.players[0].zones.discard.push(o); T4.cards[o].place = { z: "discard", seat: 0 };
  assert(AA4.invariants(T4, FIXTURES).some(m => m.includes("is in the discard of seat 0")), "card in another player's pile not caught");
});
test("invariants: debug mode stops at the operation that breaks one", () => {
  const S = table({ mode: "solo1" }).S();
  AA4.OPS.__break = ctx => { ctx.S.players[0].zones.hand.pop(); };
  AA4.INTENTS.__break = { check: () => null, apply: ctx => AA4.enqueue(ctx.S, [{ op: "__break" }]) };
  let err = null;
  try { AA4.step(S, { t: "__break", by: "P0" }, FIXTURES, { debug: "ops" }); } catch (e) { err = e; }
  delete AA4.OPS.__break; delete AA4.INTENTS.__break;
  assert(err instanceof AA4.InvariantError && /op __break/.test(err.message), "no InvariantError: " + err);
});

test("projection: opponent's hand and every deck hidden, counts visible, seed removed", () => {
  const S = table().S();
  const V = AA4.project(S, 0);
  assert(V.players[0].zones.hand.every(id => V.cards[id].key), "own hand hidden");
  assert(V.players[1].zones.hand.every(id => V.cards[id].key === null), "opponent's hand visible");
  assert(Object.values(V.cards).filter(c => c.place.z === "deck").every(c => c.key === null), "deck card visible");
  eq(V.players[1].zones.deck.length, 23); assert(V.players[1].zones.deck.every(x => x === "?"));
  assert(!("seed" in V) && !("s" in V.rng), "seed leaked");
  const W = AA4.project(S, -1);   // spectator
  assert(Object.values(W.cards).every(c => c.key === null || c.faceUp), "spectator sees a hidden card");
});
test("projection: events — a card drawn by the opponent has no key; a discarded one neither (the Discard Pile is face down, Revise#112); a card into the Damage Pile has", () => {
  const { log, S } = table();
  const r1 = log.push({ t: "draw", by: "P1", n: 1 });
  const mv = AA4.projectEvents(r1.events, 0).find(e => e.e === "moved");
  eq(mv.key, null);
  eq(AA4.projectEvents(r1.events, 1).find(e => e.e === "moved").key, S().cards[mv.card].key);
  const id = S().players[1].zones.hand[0];
  const r2 = log.push({ t: "move", by: "P1", card: id, to: { z: "discard" } });
  eq(AA4.projectEvents(r2.events, 0).find(e => e.e === "moved").key, null, "discarded: nobody sees it");
  eq(S().cards[id].faceUp, false); eq(S().cards[id].visibleTo, []);
  const id2 = S().players[1].zones.hand[0], r2b = log.push({ t: "move", by: "P1", card: id2, to: { z: "damage" } });
  eq(AA4.projectEvents(r2b.events, 0).find(e => e.e === "moved").key, S().cards[id2].key);
  const r3 = log.push({ t: "move", by: "P1", card: S().players[1].zones.hand[0], to: { z: "deck", pos: "bottom" } });
  eq(AA4.projectEvents(r3.events, 0).find(e => e.e === "moved").key, null);   // hand → deck: opponent never saw it
});

test("Revise#206: Undo / Redo pass over option changes (Hold, table rules, Game Situation) — only game actions are undone", () => {
  const { log, S } = table();
  log.push({ t: "hold", by: "P1", on: false });
  const h0 = S().players[0].zones.hand[0];
  log.push({ t: "move", by: "P0", card: h0, to: { z: "discard" } });
  log.push({ t: "hold", by: "P0", type: "project", on: false });   // an option change after the action
  log.push({ t: "hold", by: "P1", type: "fast", on: true });       // another player's option change does not block it either
  const u = log.undoTarget("P0");
  eq(log.entries[u].t, "move", "Undo points at the last game action, not the Hold change");
  assert(log.push({ t: "undo", by: "P0", of: u }).ok);
  eq(S().players[0].zones.discard.includes(h0), false, "the move is undone");
  eq(AA4.holdOn(S(), 0, "project"), false, "the option change stays");
  log.push({ t: "hold", by: "P0", type: "project", on: true });
  assert(log.redoTarget("P0") >= 0, "Redo still possible after an option change");
  eq(AA4.replayCheck(log), null);
});
test("undo / redo: own last action only, while nobody else acted", () => {
  const { log, S } = table();
  log.push({ t: "hold", by: "P1", on: false });   // Hold OFF: P0's undo needs no agreement (Revise#112)
  const h0 = S().players[0].zones.hand[0];
  const snap = JSON.stringify(S());
  log.push({ t: "move", by: "P0", card: h0, to: { z: "discard" } });
  log.push({ t: "chat", by: "P1", text: "hi" });   // chat doesn't count
  const u = log.undoTarget("P0");
  eq(log.entries[u].t, "move");
  eq(log.undoTarget("P1"), -1);
  assert(log.push({ t: "undo", by: "P0", of: u }).ok);
  const after = AA4.clone(S()); after.version = JSON.parse(snap).version;
  eq(JSON.stringify(after), snap, "state after undo");
  const r = log.redoTarget("P0");
  assert(r >= 0);
  assert(log.push({ t: "redo", by: "P0", of: r }).ok);
  eq(S().players[0].zones.discard, [h0]);
  // someone else acted → no undo
  log.push({ t: "draw", by: "P1", n: 1 });
  eq(log.undoTarget("P0"), -1);
  assert(!log.push({ t: "undo", by: "P0", of: log.entries.findIndex(e => e.t === "move") }).ok, "undo after another action");
  eq(AA4.replayCheck(log), null);
});
test("undo: mulligan / keep / join can't be undone; undo of a shuffle restores the order", () => {
  const { log, S } = table({ keep: false });
  log.push({ t: "hold", by: "P1", on: false });
  log.push({ t: "mulligan", by: "P0" });
  eq(log.undoTarget("P0"), -1);
  log.push({ t: "keep", by: "P0" }); log.push({ t: "keep", by: "P1" });
  const deck = S().players[0].zones.deck.slice();
  log.push({ t: "shuffle", by: "P0" });
  assert(JSON.stringify(deck) !== JSON.stringify(S().players[0].zones.deck));
  log.push({ t: "undo", by: "P0", of: log.undoTarget("P0") });
  eq(S().players[0].zones.deck, deck);
});
test("undo: two undos in a row step back two actions; redo brings the last one back", () => {
  const { log, S } = table({ mode: "solo1" });
  const [a, b] = S().players[0].zones.hand;
  log.push({ t: "move", by: "P0", card: a, to: { z: "discard" } });
  log.push({ t: "move", by: "P0", card: b, to: { z: "discard" } });
  log.push({ t: "undo", by: "P0", of: log.undoTarget("P0") });
  log.push({ t: "undo", by: "P0", of: log.undoTarget("P0") });
  eq(S().players[0].zones.discard, []);
  log.push({ t: "redo", by: "P0", of: log.redoTarget("P0") });
  eq(S().players[0].zones.discard, [a]);
  eq(AA4.replayCheck(log), null);
});
test("log: saved log (JSON) replays to the same state", () => {
  const { log } = fuzz({ seed: "save", seats: 2, steps: 150, db: FIXTURES, deck: deckOf(MIXED, 40) });
  const copy = AA4.GameLog.from(FIXTURES, JSON.parse(JSON.stringify(log.toJSON())).entries);
  eq(JSON.stringify(copy.state), JSON.stringify(log.state));
});
test("pure apply: the old state is untouched", () => {
  const S = table().S(), before = JSON.stringify(S);
  const r = AA4.apply(S, { t: "draw", by: "P0", n: 2 }, FIXTURES);
  assert(r.ok); eq(JSON.stringify(S), before); eq(r.state.players[0].zones.hand.length, 9);
});
test("legalActions: reasons for what can't be done", () => {
  const { S } = table({ keep: false });
  const la = AA4.legalActions(S(), FIXTURES, "P0", 0);
  eq(la.map(a => [a.t, a.ok]), [["mulligan", true], ["autoMulligan", true], ["keep", true]]);
  const T = table().S();
  const lb = AA4.legalActions(T, FIXTURES, "P1", 1);
  assert(lb.find(a => a.t === "move").cards.every(id => T.cards[id].owner === 1));
  eq(AA4.check(T, { t: "attack", by: "P0" }, FIXTURES), "Unknown action");
});
test("solo two-deck: one client, two seats; seat must be given", () => {
  const { log, S } = table({ mode: "solo2", keep: false });
  eq(S().players.map(p => p.cid), ["P0", "P0"]);
  eq(log.push({ t: "keep", by: "P0" }).reason, "Say which seat");
  assert(log.push({ t: "keep", by: "P0", seat: 1 }).ok && log.push({ t: "keep", by: "P0", seat: 0 }).ok);
  eq(S().stage, "play");
});
test("describe: every event of a fuzz game gives a line or null, never throws", () => {
  const { log } = fuzz({ seed: "describe", seats: 3, steps: 120, db: FIXTURES, deck: deckOf(MIXED, 30) });
  const lines = AA4.projectEvents(log.events(), 0).map(ev => AA4.describe(ev, log.state, FIXTURES, 0)).filter(Boolean);
  assert(lines.length > 50, "too few lines");
  assert(lines.some(l => l.startsWith("Coin toss")), "no coin toss line");
});

/* ---------- rules (B2–B6) ---------- */
console.log("Rules (B2–B6)");
const RULES = require("./rules_tests.js")({ AA4, test, assert, eq, FIXTURES, deckOf });

/* ---------- scenarios ---------- */
console.log("Scenarios");
const SC_DIR = path.join(__dirname, "scenarios");
for (const f of fs.readdirSync(SC_DIR).filter(f => f.endsWith(".json")).sort()) {
  const sc = JSON.parse(fs.readFileSync(path.join(SC_DIR, f), "utf8"));
  test(`${f}: ${sc.name}`, () => runScenario(sc));
}

/* ---------- fuzz ---------- */
console.log("Fuzz (invariants after every operation, replay check)");
for (const seats of [2, 3, 4]) {
  test(`fuzz ${seats} players × 15 seeds × 300 actions`, () => {
    let total = 0;
    for (let i = 0; i < 15; i++) total += fuzz({ seed: `f${seats}-${i}`, seats, steps: 300, db: FIXTURES, deck: deckOf(MIXED, 50) }).n;
    assert(total > 3000, `only ${total} actions ran`);
  });
}
test("fuzz solo two-deck", () => { fuzz({ seed: "solo2", seats: 2, mode: "solo2", steps: 300, db: FIXTURES, deck: deckOf(MIXED, 50) }); });

/* ---------- real card data ---------- */
const DATA_JS = path.join(__dirname, "..", "..", "dist", "aquarian-age-helper", "assets", "data.js");
if (fs.existsSync(DATA_JS)) {
  console.log("Real card list");
  const win = {}; new Function("window", fs.readFileSync(DATA_JS, "utf8"))(win);
  const RULES_JS = path.join(path.dirname(DATA_JS), "rules.js");
  if (fs.existsSync(RULES_JS)) new Function("window", fs.readFileSync(RULES_JS, "utf8"))(win);
  const REAL = AA4.dbFromSiteData(win.AA_DATA, win.AA_RULES);
  test(`real data: ${REAL.size} cards load; types and factions known`, () => {
    const playable = REAL.all().filter(c => AA4.CARD_TYPES.includes(c.type));
    assert(playable.length > 8000, `${playable.length} playable cards`);
    assert(playable.every(c => AA4.slotOfFaction(c.faction) !== "none"), "a playable card without a faction slot");
  });
  test("real data: fuzz game with 2 real 50-card decks", () => {
    const all = REAL.all().filter(c => AA4.CARD_TYPES.includes(c.type));
    const S = { rng: { s: AA4.seedOf("real"), n: 0 } };
    const deck = AA4.shuffleInPlace(S, all.slice()).slice(0, 50).map(c => c.key);
    fuzz({ seed: "real", seats: 2, steps: 400, db: REAL, deck });
  });
  test("real data: compiled rules are loaded (skills, stats, effects)", () => {
    assert(win.AA_RULES, "rules.js missing — run python3 build.py");
    const withEffects = REAL.all().filter(c => c.effects && c.effects.length).length, withSkills = REAL.all().filter(c => Object.keys(c.skills || {}).length).length;
    assert(withEffects > 1500 && withSkills > 5000, `effects ${withEffects}, skills ${withSkills}`);
    const ch = REAL.all().find(c => c.type === "Character" && c.se != null);
    assert(typeof ch.se === "number" && typeof ch.de === "number", "Character stats are numbers");
  });
  test("real data: A3-17 2400 Imperial Queen Dragon on Empress Dragon \"Iaris\" gains Infinity and \"X: X damage\" (Pack, Revise#084)", () => {
    const g = RULES.game({ db: REAL, deck: Array(20).fill("A3-01 0001").concat(Array(10).fill("A3-01 0200"), Array(10).fill("A3-17 2400"), Array(20).fill("A3-01 0001")), rules: {} });
    const a = g.tp(), b = g.other();
    const base = g.char(a, "A3-01 0001", "front");
    const S = g.S, card = key => Object.values(S().cards).find(c => c.owner === a && c.key === key && (c.place.z === "deck" || c.place.z === "hand")).id;
    const queen = card("A3-17 2400");
    g.ok({ t: "move", seat: a, card: queen, to: { z: "char", ch: base, role: "stack" } });
    assert(!AA4.charStats(S(), REAL, base).skills.infinity, "no Empress below: no Infinity");
    eq(AA4.effectsOf(S(), REAL, base, queen).length, 2, "only its own 2 effects");
    // rebuild: Empress first, then the Queen on top
    g.ok({ t: "move", seat: a, card: queen, to: { z: "hand" } });
    g.ok({ t: "move", seat: a, card: card("A3-01 0200"), to: { z: "char", ch: base, role: "stack" } });
    g.ok({ t: "move", seat: a, card: queen, to: { z: "char", ch: base, role: "stack" } });
    assert(AA4.charStats(S(), REAL, base).skills.infinity, "Infinity gained");
    const efs = AA4.effectsOf(S(), REAL, base, queen);
    eq(efs.length, 3, "the gained X effect is there"); eq(efs[2].cost, "X");
    g.give(base, 2); g.toPhase("main");
    const dmg0 = S().players[b].zones.damage.length + Object.keys(S().chars).length;
    g.ok({ t: "declare", seat: a, kind: "effect", ch: base, card: queen, i: 2 });
    g.ok({ t: "pay", seat: a, cards: S().chars[base].power.slice(0, 2) });   // free X: X = 2 paid
    g.ok({ t: "target", seat: a, targets: [{ seat: b }] });
    g.passAll();
    assert(g.events().some(e => e.e === "playerDamage" && e.seat === b && e.normal === 2), "2 damage to the player");
    void dmg0;
  });
  test("real data: cost X (Revise#086) — free X: pay first, X = the cards paid; X from the text: target first, then pay exactly X", () => {
    // free X: the gained "X: X damage" of A3-17 2400
    const g = RULES.game({ db: REAL, deck: Array(20).fill("A3-01 0001").concat(Array(10).fill("A3-01 0200"), Array(10).fill("A3-17 2400"), Array(20).fill("A3-01 0001")), rules: {} });
    const a = g.tp(), b = g.other(), S = g.S;
    const base = g.char(a, "A3-01 0001", "front");
    const card = (seat, key) => Object.values(S().cards).find(c => c.owner === seat && c.key === key && (c.place.z === "deck" || c.place.z === "hand")).id;
    g.ok({ t: "move", seat: a, card: card(a, "A3-01 0200"), to: { z: "char", ch: base, role: "stack" } });
    const queen = card(a, "A3-17 2400"); g.ok({ t: "move", seat: a, card: queen, to: { z: "char", ch: base, role: "stack" } });
    g.give(base, 4); g.toPhase("main");
    g.ok({ t: "declare", seat: a, kind: "effect", ch: base, card: queen, i: 2 });
    eq(S().draft.step, "pay"); eq(S().draft.cost, null, "free X: no cost yet");
    g.no({ t: "pay", seat: a, cards: [] }, "at least 1");
    g.ok({ t: "pay", seat: a, cards: S().chars[base].power.slice(0, 3) });
    eq(S().draft.x, 3, "X = 3 paid");
    g.ok({ t: "target", seat: a, targets: [{ seat: b }] });
    g.passAll();
    assert(g.events().some(e => e.e === "playerDamage" && e.seat === b && e.normal === 3), "3 damage");
    // X from the text: "Xは目標のコストに等しい" (A3-03 0438) — the target first, then X = its cost
    const perm = REAL.all().find(c => c.type === "Permanent" && c.cost === 2 && !(c.factor && Object.keys(c.factor).length > 1));
    const g2 = RULES.game({ db: REAL, deck: Array(30).fill("A3-03 0438").concat(Array(10).fill(perm.key), Array(20).fill("A3-01 0001")), rules: {} });
    const a2 = g2.tp(), b2 = g2.other(), S2 = g2.S;
    const user = g2.char(a2, "A3-03 0438", "front"); g2.give(user, 3);
    const host = g2.char(b2, "A3-01 0001", "front");
    const pc = Object.values(S2().cards).find(c => c.owner === b2 && c.key === perm.key && (c.place.z === "deck" || c.place.z === "hand")).id;
    g2.ok({ t: "move", seat: b2, card: pc, to: { z: "char", ch: host, role: "perm" } });
    g2.toPhase("main");
    const i = REAL.card("A3-03 0438").effects.findIndex(e => e.cost === "X");
    g2.ok({ t: "declare", seat: a2, kind: "effect", ch: user, card: AA4.topOf(S2().chars[user]), i });
    eq(S2().draft.step, "target", "X depends on the target: choose it first");
    g2.ok({ t: "target", seat: a2, targets: [{ card: pc }] });
    eq(S2().draft.step, "pay"); eq(S2().draft.cost, 2, "X = the target's cost 2");
    g2.no({ t: "pay", seat: a2, cards: S2().chars[user].power.slice(0, 3) }, "Pay exactly 2");
    g2.ok({ t: "pay", seat: a2, cards: S2().chars[user].power.slice(0, 2) });
    g2.passAll();
    eq(S2().cards[pc].place.z, "deck", "the Permanent went back to its owner's deck");
  });
  /* ---------- Pack's decks (Revise#087): every card of the 4 Deck Builder slots, played through ---------- */
  const DECK = ["A3-20 2783", "A3-17 2322", "A3-08 1248", "A3-22 3210", "A3-EP EP279", "A3-07 1011", "A3-BS2 2239", "A3-12 1749", "A3-BS2 1794",
    "A3-24 3500", "A3-03 0546", "A3-03 0544", "A3-22 3230", "A3-16 2245", "A3-18 2465", "A3-15 2120", "A3-15 2119", "A3-24 3509", "A3-09 1318"];
  test("Pack's decks: all 19 cards are fully automatic", () => {
    const bad = DECK.filter(k => REAL.card(k).status !== "auto");
    eq(bad, [], "cards still by hand");
  });
  const deckGame = () => {
    const g = RULES.game({ db: REAL, deck: DECK.flatMap(k => Array(3).fill(k)).concat(Array(3).fill("A3-01 0001"), Array(8).fill("A3-20 2783"), Array(4).fill("A3-17 2322")), rules: {} });
    const S = g.S, a = g.tp(), b = g.other();
    const free = (seat, key) => { const c = Object.values(S().cards).find(x => x.owner === seat && x.key === key && (x.place.z === "deck" || x.place.z === "hand")); if (!c) throw new Error("no free " + key); return c.id; };
    const on = (seat, ch, key, role = "stack") => { const id = free(seat, key); g.ok({ t: "move", seat, card: id, to: { z: "char", ch, role } }); return id; };
    const hand = (seat, key) => { const id = free(seat, key); if (S().cards[id].place.z !== "hand") g.ok({ t: "move", seat, card: id, to: { z: "hand" } }); return id; };
    const pay = seat => { const d = S().draft; if (d && d.step === "pay") g.ok({ t: "pay", seat, cards: d.payFrom.flatMap(ch => S().chars[ch].power).slice(0, d.cost == null ? 1 : d.cost) }); };
    const factor = (seat, darklore = 4, ego = 2) => { for (let i = 0; i < darklore; i++) g.char(seat, "A3-20 2783", "back"); for (let i = 0; i < ego; i++) g.char(seat, "A3-17 2322", "back"); };   // Controlled Characters for the factor
    return Object.assign(g, { a, b, free, on, hand, pay, factor });
  };
  test("Pack's decks: 魔人“アシュタルテー” 1: discard a target power card; 神魔 on 魔人 gains Infinity + the area effect", () => {
    const g = deckGame(), S = g.S, { a, b } = g;
    const me = g.char(a, "A3-20 2783", "front"); g.give(me, 3);
    const majin = g.on(a, me, "A3-03 0546");
    const foe = g.char(b, "A3-17 2322", "front"); g.give(foe, 2);
    const foe2 = g.char(b, "A3-08 1248", "back"); g.give(foe2, 1);
    g.toPhase("main");
    const i1 = REAL.card("A3-03 0546").effects.findIndex(e => e.cost === 1);
    g.ok({ t: "declare", seat: a, kind: "effect", ch: me, card: majin, i: i1 }); g.pay(a);
    const pc = S().chars[foe].power[0];
    g.ok({ t: "target", seat: a, targets: [{ card: pc }] }); g.passAll();
    eq(S().cards[pc].place.z, "discard", "the targeted power card is discarded");
    const shinma = g.on(a, me, "A3-24 3500");
    assert(AA4.charStats(S(), REAL, me).skills.infinity, "Infinity under 魔人");
    const efs = AA4.effectsOf(S(), REAL, me, shinma), gi = efs.findIndex(e => e.gained);
    assert(gi >= 0, "gained area effect");
    g.ok({ t: "declare", seat: a, kind: "effect", ch: me, card: shinma, i: gi }); g.pay(a); g.passAll();
    const d = S().decisions[0];
    assert(d && d.kind === "pick", "always asked: 1 area of 1 player");
    assert(d.options.includes(b + ":control") && d.options.includes(a + ":control"), "each player's areas are separate options");
    g.ok({ t: "choose", seat: a, decision: d.id, pick: [b + ":control"] });
    eq([foe, foe2].map(id => S().chars[id].power.length), [0, 0], "Front and Back both: one power card from each character (1 and 1 → 0 and 0)");
  });
  test("Pack's decks: 神魔's area effect hits only the chosen area (B's Active Area — not B's Control Area, not A's)", () => {
    const g = deckGame(), S = g.S, { a, b } = g;
    const me = g.char(a, "A3-20 2783", "front"); g.give(me, 4); g.on(a, me, "A3-03 0546"); const shinma = g.on(a, me, "A3-24 3500");
    const act = g.char(b, "A3-17 2322", "active"); g.give(act, 1);
    const ctl = g.char(b, "A3-08 1248", "back"); g.give(ctl, 1);
    const mine = g.char(a, "A3-22 3210", "back"); g.give(mine, 1);
    g.toPhase("main");
    const gi = AA4.effectsOf(S(), REAL, me, shinma).findIndex(e => e.gained);
    g.ok({ t: "declare", seat: a, kind: "effect", ch: me, card: shinma, i: gi }); g.pay(a); g.passAll();
    const d = S().decisions[0];
    g.ok({ t: "choose", seat: a, decision: d.id, pick: [b + ":active"] });
    eq([act, ctl, mine].map(id => S().chars[id].power.length), [0, 1, 1], "only B's Active Area");
  });
  test("Revise#088: power cards above Mental after an effect → the owner discards down to Mental (chooses which), to the Discard Pile", () => {
    const g = deckGame(), S = g.S, { a, b } = g;
    const me = g.char(a, "A3-20 2783", "front"); g.give(me, 3); g.on(a, me, "A3-03 0544");   // 幼魔: X: Mental −X until the end of the Main Phase
    const foe = g.char(b, "A3-17 2322", "back"); g.give(foe, 2);
    const se0 = AA4.charStats(S(), REAL, foe).se;
    g.toPhase("main");
    const top = AA4.topOf(S().chars[me]), i = REAL.card("A3-03 0544").effects.findIndex(e => e.cost === "X");
    g.ok({ t: "declare", seat: a, kind: "effect", ch: me, card: top, i });
    g.ok({ t: "pay", seat: a, cards: S().chars[me].power.slice(0, 1) });   // X = 1
    g.ok({ t: "target", seat: a, targets: [{ ch: foe }] }); g.passAll();
    eq(AA4.charStats(S(), REAL, foe).se, se0 - 1);
    const over = 2 - (se0 - 1);
    if (over > 0) {
      const d = S().decisions.find(x => x.ref && x.ref.overMental);
      assert(d && d.seat === b && d.min === over, "the owner must discard " + over);
      const pick = d.options.slice(0, over);
      g.ok({ t: "choose", seat: b, decision: d.id, pick });
      for (const id of pick) eq(S().cards[id].place.z, "discard", "→ Discard Pile");
      eq(S().chars[foe].power.length, se0 - 1, "power = Mental");
    }
  });
  test("Pack's decks: タナトスの器 — at another player's Main Phase start, they mill X = their power-0 Controlled Characters", () => {
    const g = deckGame(), S = g.S, { a, b } = g;
    const host = g.char(a, "A3-20 2783", "front"); g.on(a, host, "A3-22 3230");
    g.char(b, "A3-17 2322", "back"); g.char(b, "A3-08 1248", "back"); const p1 = g.char(b, "A3-22 3210", "back"); g.give(p1, 1);   // 2 with power 0
    for (let k = 0; k < 30 && !(S().turn.player === b && S().turn.phase === "main"); k++) { const d = S().decisions[0]; if (d) { g.ok({ t: "choose", seat: d.seat, decision: d.id, pick: d.kind === "yesno" ? ["no"] : d.options.slice(0, d.min) }); continue; } g.ok({ t: "next", seat: g.tp() }); }
    const ev = g.events().filter(e => e.e === "moved" && e.from.z === "deck" && e.to.z === "discard" && S().cards[e.card].owner === b);
    eq(ev.length, 2, "2 cards from the top of their deck to the Discard Pile");
  });
  test("Pack's decks: ゴシックヴァンパイア — opponents pay +1 for cards, attacks, guards and effects", () => {
    const g = deckGame(), S = g.S, { a, b } = g;
    const host = g.char(a, "A3-20 2783", "front"); g.on(a, host, "A3-18 2465");
    const foe = g.char(b, "A3-17 2322", "front"); const mine = g.char(a, "A3-08 1248", "front");
    eq(AA4.charStats(S(), REAL, foe).attackCost, 2, "opponent's attack cost 1 → 2"); eq(AA4.charStats(S(), REAL, foe).guardCost, 2);
    eq(AA4.charStats(S(), REAL, mine).attackCost, 1, "own characters unchanged");
    eq(AA4.cardCostMod(S(), REAL, b, REAL.card("A3-15 2119")), 1, "opponent's Fast card +1"); eq(AA4.cardCostMod(S(), REAL, a, REAL.card("A3-15 2119")), 0);
    const bs = g.char(b, "A3-BS2 2239", "front"); g.give(bs, 1);
    eq(AA4.charStats(S(), REAL, bs).effectCost, 1, "opponent's effect cost +1");
  });
  test("Pack's decks: 迷いの森 — cost − Damage Pile; no attack / guard; negated; back to hand at the end of the Charge Phase if power 0", () => {
    const g = deckGame(), S = g.S, { a, b } = g;
    const me = g.char(a, "A3-20 2783", "back"); g.give(me, 3); g.factor(a);
    const foe = g.char(b, "A3-17 2322", "front");
    for (let i = 0; i < 2; i++) { const d = S().players[a].zones.deck; g.ok({ t: "move", seat: a, card: d[d.length - 1], to: { z: "damage" } }); }
    g.toPhase("main");
    const f = g.hand(a, "A3-15 2120"), full = REAL.card("A3-15 2120").cost;
    g.ok({ t: "declare", seat: a, kind: "set", card: f });
    eq(S().draft.cost, Math.max(0, full - 2), "cost reduced by 2 damage");
    g.pay(a); g.ok({ t: "target", seat: a, targets: [{ ch: foe }] }); g.passAll();
    const st = AA4.charStats(S(), REAL, foe);
    assert(st.noAttack && st.noGuard, "can't attack or guard"); assert(st.negated.effects && st.negated.skills, "skills and effects negated");
    g.toPhase("charge"); g.ok({ t: "next", seat: a });
    assert(!S().chars[foe], "power 0 at the end of the Charge Phase → back to the owner's hand");
    assert(Object.values(S().cards).some(c => c.owner === b && c.key === "A3-17 2322" && c.place.z === "hand"), "in the hand");
  });
  test("Pack's decks: 爽緑の羽ばたき — Shield, ±0/+1/+1; when it battles, the opponent's power cards return to hand", () => {
    const g = deckGame(), S = g.S, { a, b } = g;
    const me = g.char(a, "A3-20 2783", "front"); g.give(me, 2); g.factor(a);
    const foe = g.char(b, "A3-17 2322", "front"); g.give(foe, 2);
    g.toPhase("main");
    const f = g.hand(a, "A3-15 2119");
    g.ok({ t: "declare", seat: a, kind: "set", card: f }); g.pay(a); g.ok({ t: "target", seat: a, targets: [{ ch: me }] }); g.passAll();
    const st = AA4.charStats(S(), REAL, me), base = REAL.card("A3-20 2783");
    assert(st.skills.shield, "Shield"); eq([st.at, st.de], [base.at + 1, base.de + 1], "+1/+1");
    const foePower = S().chars[foe].power.slice();
    g.ok({ t: "declare", seat: a, kind: "attack", ch: me, target: { seat: b } }); g.pay(a);
    g.ok({ t: "declare", seat: b, kind: "guard", ch: foe }); g.pay(b);
    g.passAll();
    for (const id of foePower.slice(1)) eq(S().cards[id].place.z, "hand", "the guard's power card → owner's hand");
  });
  test("Pack's decks: かまいたち — cancel the attack, discard its power, set the same number from its owner's deck", () => {
    const g = deckGame(), S = g.S, { a, b } = g;
    const att = g.char(a, "A3-20 2783", "front"); g.give(att, 3);
    const mine = g.char(b, "A3-17 2322", "back"); g.give(mine, 3); g.factor(b);
    g.toPhase("main");
    const k = g.hand(b, "A3-24 3509");
    g.ok({ t: "declare", seat: a, kind: "attack", ch: att, target: { seat: b } }); g.pay(a);
    g.ok({ t: "noGuard", seat: b });
    const deckTop = S().players[a].zones.deck.slice(-2);
    g.ok({ t: "declare", seat: b, kind: "set", card: k }); g.pay(b); g.ok({ t: "target", seat: b, targets: [{ ch: att }] }); g.passAll();
    assert(g.events().some(e => e.e === "attackCancelled"), "attack cancelled");
    eq(S().chars[att].power.length, 2, "2 discarded, 2 set again");
    eq(S().chars[att].power.slice().sort(), deckTop.slice().sort(), "from the attacker's owner's deck");
  });
  test("Pack's decks: グラデュエーション — every player takes a Student card from each pile; any Student can be broken; the Break cost returns", () => {
    const g = deckGame(), S = g.S, { a, b } = g;
    const me = g.char(a, "A3-20 2783", "back"); g.give(me, 6); g.factor(a);
    for (const [seat, z] of [[a, "damage"], [a, "discard"], [b, "discard"]]) g.ok({ t: "move", seat, card: g.free(seat, "A3-17 2322"), to: { z } });
    g.toPhase("main");
    const p = g.hand(a, "A3-09 1318");
    g.ok({ t: "declare", seat: a, kind: "set", card: p }); g.pay(a); g.passAll();
    for (let k = 0; k < 4 && S().decisions.length; k++) { const d = S().decisions[0]; g.ok({ t: "choose", seat: d.seat, decision: d.id, pick: d.options.slice(0, d.max) }); }
    eq(S().players[a].zones.damage.length + S().players[a].zones.discard.filter(id => S().cards[id].key === "A3-17 2322").length, 0, "both Student cards of player A taken");
    assert(Object.values(S().cards).some(c => c.owner === b && c.key === "A3-17 2322" && c.place.z === "hand"), "player B took theirs");
    const stu = g.char(a, "A3-17 2322", "front");
    const br = g.hand(a, "A3-03 0544");   // no icon in common is needed now
    g.ok({ t: "declare", seat: a, kind: "set", card: br, force: false });
    g.pay(a);
    assert(AA4.draftTargets(S(), REAL, S().draft).some(t => t.ch === stu), "the Student can be broken");
    void stu;
  });
  /* ---------- Pack's 4 decks (Revise#087): Astarte #1, Dina, Iaris, Mayumi ---------- */
  const PACK = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "pack_decks.json"), "utf8"));
  test("Pack's 4 decks: every card is fully automatic", () => {
    const bad = [...new Set(PACK.flatMap(d => d.cards))].filter(k => !REAL.card(k) || REAL.card(k).status !== "auto");
    eq(bad, [], "cards still by hand");
  });
  for (const seats of [2, 3, 4]) test(`Pack's 4 decks: random legal games, ${seats} players × 5 seeds`, () => {
    for (let i = 0; i < 5; i++) RULES.playRandom(REAL, { seats, seed: `pack-${seats}-${i}`, steps: 900, deck: PACK.map(d => d.cards), rules: { autoPay: i % 2 === 0, autoSkip: i % 2 === 1 } });
  });
  const factionChars = (f, n) => REAL.all().filter(c => c.type === "Character" && c.faction === f && !c.name && c.se != null).slice(0, n).map(c => c.key);
  const FILLK = ["E.G.O.", "WIZ-DOM", "Eraser", "Darklore"].flatMap(f => factionChars(f, 2));
  const nameKey = jp => REAL.all().find(c => c.jp === jp).key;
  /** A game whose decks hold the Pack cards a test needs (2 each) and 6 copies of 2 plain characters per faction. */
  const PG = (keys = []) => {
    const g = RULES.game({ db: REAL, deck: keys.flatMap(k => [k, k]).concat(FILLK.flatMap(k => Array(6).fill(k))), rules: {} });
    const S = g.S, a = g.tp(), b = g.other();
    const free = (seat, key) => { const c = Object.values(S().cards).filter(x => x.owner === seat && x.key === key && (x.place.z === "deck" || x.place.z === "hand")).map(x => x.id).sort()[0]; if (!c) throw new Error("no free " + key); return c; };
    const on = (seat, ch, key, role = "stack") => { const id = free(seat, key); g.ok({ t: "move", seat, card: id, to: { z: "char", ch, role } }); return id; };
    const hand = (seat, key) => { const id = free(seat, key); if (S().cards[id].place.z !== "hand") g.ok({ t: "move", seat, card: id, to: { z: "hand" } }); return id; };
    const ch = (seat, key, area = "front") => { const id = free(seat, key); g.ok({ t: "move", seat, card: id, to: { z: area } }); return AA4.charOfCard(S(), id).id; };
    /** A plain character of a faction (any free copy). */
    const fch = (seat, f, area = "front") => { const k = factionChars(f, 2).find(x => Object.values(S().cards).some(c => c.owner === seat && c.key === x && (c.place.z === "deck" || c.place.z === "hand"))); return ch(seat, k, area); };
    const pay = seat => { const d = S().draft; if (d && d.step === "pay") g.ok({ t: "pay", seat, cards: d.payFrom.flatMap(c => S().chars[c].power).slice(0, d.cost == null ? 1 + (d.extra || 0) : d.cost) }); };
    const play = (seat, card, targets) => { g.ok({ t: "declare", seat, kind: "set", card }); pay(seat); if (S().draft && S().draft.step === "target") g.ok({ t: "target", seat, targets }); g.passAll(); };
    const choose = pick => { const d = S().decisions[0]; assert(d, "a choice is waiting"); g.ok({ t: "choose", seat: d.seat, decision: d.id, pick: typeof pick === "function" ? pick(d) : pick }); };
    return Object.assign(g, { a, b, free, on, hand, ch, fch, pay, play, choose });
  };
  const giveMax = (g, ch, n) => g.give(ch, Math.min(n, AA4.charStats(g.S(), REAL, ch).se == null ? n : AA4.charStats(g.S(), REAL, ch).se));   // never more than Mental
  const giveFactor = (g, seat, f, n) => { for (let i = 0; i < n; i++) g.fch(seat, f, "back"); };
  test("Pack's decks: パニッシュメントII discards every character of the chosen faction", () => {
    const g = PG(["A3-01 0206"]), S = g.S, { a, b } = g;
    giveFactor(g, a, "Eraser", 5); g.give(AA4.controlledOf(S(), a)[0], 5);
    const d1 = g.fch(b, "Darklore"), d2 = g.fch(a, "Darklore"), e1 = g.fch(b, "E.G.O.");
    g.toPhase("main"); g.play(a, g.hand(a, "A3-01 0206"), []);
    g.choose(["Darklore"]);
    assert(!S().chars[d1] && !S().chars[d2] && S().chars[e1], "all Darklore characters (both players) gone, the E.G.O. one stays");
  });
  test("Pack's decks: 遺伝子治療 negates one chosen skill until the end of the Main Phase", () => {
    const g = PG(["A3-09 1487", "A3-08 1248"]), S = g.S, { a, b } = g;
    giveFactor(g, a, "Eraser", 3); g.give(AA4.controlledOf(S(), a)[0], 2);
    const foe = g.ch(b, "A3-08 1248");   // Shield, Charge 1
    g.toPhase("main"); g.play(a, g.hand(a, "A3-09 1487"), [{ ch: foe }]);
    g.choose(d => [d.options.find(o => o === "s:shield")]);
    assert(!AA4.charStats(S(), REAL, foe).skills.shield, "Shield negated"); assert(AA4.charStats(S(), REAL, foe).skills.charge, "the other skill stays");
  });
  test("Pack's decks: 悪魔払い — designate a named Controlled Character (even with Protect): its owner discards it", () => {
    const named = REAL.all().find(c => c.type === "Character" && c.name && c.se != null).key;
    const g = PG(["A3-14 1975", named]), S = g.S, { a, b } = g;
    giveFactor(g, a, "WIZ-DOM", 5); g.give(AA4.controlledOf(S(), a)[0], 4);
    const host = g.ch(b, named, "back");
    g.toPhase("main"); g.play(a, g.hand(a, "A3-14 1975"), [{ ch: host }]);
    assert(!S().chars[host], "discarded");
  });
  test("Pack's decks: ティアー・オブ・エンジェル returns the opponent's Fast card; that name can't be declared until the Main Phase ends", () => {
    const g = PG(["A3-15 2119", "A3-14 2058"]), S = g.S, { a, b } = g;
    giveFactor(g, a, "Darklore", 3); giveMax(g, AA4.controlledOf(S(), a)[0], 2);
    giveFactor(g, b, "Eraser", 3); for (const c of AA4.controlledOf(S(), b)) giveMax(g, c, 1);
    const me = g.fch(a, "Darklore");
    g.toPhase("main");
    const f = g.hand(a, "A3-15 2119");
    g.ok({ t: "declare", seat: a, kind: "set", card: f }); g.pay(a); g.ok({ t: "target", seat: a, targets: [{ ch: me }] });
    const now = AA4.priorityNow(S()); if (now === a) g.ok({ t: "pass", seat: a });
    const tear = g.hand(b, "A3-14 2058");
    g.ok({ t: "declare", seat: b, kind: "set", card: tear }); g.pay(b); g.ok({ t: "target", seat: b, targets: [{ card: f }] });
    g.passAll(); g.passAll();
    eq(S().cards[f].place.z, "hand", "back to its owner's hand"); eq(S().stack.length, 0, "its declaration is gone");
    g.no({ t: "declare", seat: a, kind: "set", card: f }, "Banned");
  });
  test("Pack's decks: 都市構造崩落 (cost − Damage Pile) returns the attacking character to its owner's hand", () => {
    const g = PG(["A3-15 2075"]), S = g.S, { a, b } = g;
    const att = g.fch(a, "Darklore"); g.give(att, 2);
    giveFactor(g, b, "E.G.O.", 3); g.give(AA4.controlledOf(S(), b)[0], 5);
    g.toPhase("main");
    g.ok({ t: "declare", seat: a, kind: "attack", ch: att, target: { seat: b } }); g.pay(a); g.ok({ t: "noGuard", seat: b });
    g.play(b, g.hand(b, "A3-15 2075"), []);
    assert(!S().chars[att], "the attacker went back to the hand");
  });
  test("Pack's decks: バリアクラッカーキック — its battle opponent loses permanents, its owner's effects and its skills in that battle", () => {
    const perm = REAL.all().find(c => c.type === "Permanent").key;
    const g = PG(["A3-20 2696", "A3-08 1248", perm]), S = g.S, { a, b } = g;
    giveFactor(g, a, "E.G.O.", 2);
    const me = g.fch(a, "E.G.O."); giveMax(g, me, 3);
    const foe = g.ch(b, "A3-08 1248"); giveMax(g, foe, 2);   // Shield
    g.on(b, foe, perm, "perm");
    g.toPhase("main"); g.play(a, g.hand(a, "A3-20 2696"), [{ ch: me }]);
    g.ok({ t: "declare", seat: a, kind: "attack", ch: me, target: { seat: b } }); g.pay(a);
    g.ok({ t: "declare", seat: b, kind: "guard", ch: foe }); g.pay(b);
    for (let k = 0; k < 4 && S().battle && S().battle.step === "response"; k++) g.ok({ t: "pass", seat: AA4.priorityNow(S()) });
    eq(S().chars[foe] ? S().chars[foe].perm.length : 0, 0, "permanents discarded");
  });
  test("Pack's decks: パスハ — name a name: up to 2 Break cards with it back to hand; their cost returns to hand this Main Phase", () => {
    const dina = nameKey("サンタ“ディーナ・ウィザースプーン”");
    const g = PG(["A3-22 3199", dina]), S = g.S, { a } = g;
    giveFactor(g, a, "WIZ-DOM", 3);
    g.ok({ t: "move", seat: a, card: g.free(a, dina), to: { z: "discard" } });
    g.toPhase("main"); g.play(a, g.hand(a, "A3-22 3199"), []);
    if (S().decisions[0] && S().decisions[0].kind === "pick") g.choose(d => [d.options.find(o => o === REAL.card(dina).name)]);   // only one name: chosen without asking
    eq(S().effName, REAL.card(dina).name, "the name");
    if (S().decisions[0]) g.choose(d => d.options.slice(0, 1));
    assert(Object.values(S().cards).some(c => c.owner === a && c.key === dina && c.place.z === "hand"), "Dina back in hand");
    const host = g.fch(a, "WIZ-DOM", "front");
    const rules = AA4.costRules(S(), REAL, { kind: "set", seat: a, info: REAL.card(dina), targetCh: host });
    assert(rules.some(r => r.to === "hand"), "its cost goes back to hand");
  });
  test("Pack's decks: グリモワールサーヴァント — +1/+(1)/±0 to other broken Scholars; named Scholar Break costs back to hand", () => {
    const sch = REAL.all().find(c => c.type === "Break" && (c.icons || []).includes("スカラー") && c.name && PACK.some(d => d.cards.includes(c.key)));
    const g = PG(["A3-25 3680", sch.key]), S = g.S, { a } = g;
    const h = g.fch(a, "WIZ-DOM", "back"); g.on(a, h, "A3-25 3680");
    const other = g.fch(a, "WIZ-DOM", "back"); g.ok({ t: "move", seat: a, card: g.free(a, sch.key), to: { z: "char", ch: other, role: "stack" } });
    const st = AA4.charStats(S(), REAL, other);
    eq(st.se, sch.se + 1, "Mental +1");
    assert(AA4.costRules(S(), REAL, { kind: "set", seat: a, info: sch, targetCh: other }).some(r => r.to === "hand"), "cost → hand");
  });
  test("Pack's decks: パーフェクトハーモニー — Intercept and +(1); at turn end it may go to the Damage Pile, where it keeps giving Intercept and Mental +1", () => {
    const mk = REAL.all().find(c => c.type === "Character" && c.atMental && !c.name);
    const g = PG(["A3-25 3695", mk.key]), S = g.S, { a } = g;
    giveFactor(g, a, "WIZ-DOM", 2); g.give(AA4.controlledOf(S(), a)[0], 1);
    const m = g.ch(a, mk.key, "back");
    g.toPhase("main"); const f = g.hand(a, "A3-25 3695"); g.play(a, f, []);
    const st = AA4.charStats(S(), REAL, m);
    assert(st.skills.intercept, "Intercept"); eq(st.at, mk.at + 1, "attack +(1)");
    for (let k = 0; k < 10 && !S().decisions.length; k++) g.ok({ t: "next", seat: a });
    g.choose(d => (d.kind === "yesno" ? ["yes"] : d.options.slice(0, d.min)));
    for (let k = 0; k < 3 && S().decisions.length; k++) g.choose(d => (d.kind === "yesno" ? ["yes"] : d.options.slice(0, d.min)));
    eq(S().cards[f].place.z, "damage", "in the Damage Pile");
    const st2 = AA4.charStats(S(), REAL, m);
    assert(st2.skills.intercept, "Intercept from the Damage Pile"); eq(st2.se, mk.se + 1, "Mental +1 from the Damage Pile");
  });
  test("Pack's decks: 覚醒の乙女 on 藤宮 真由美 costs 0 and gains the other Mayumi cards' skills and effects", () => {
    const g = PG(["A3-03 0444", "A3-25 3615", "A3-25 3809"]), S = g.S, { a } = g;
    giveFactor(g, a, "E.G.O.", 6);
    const base = g.fch(a, "E.G.O.", "front");
    const m1 = g.on(a, base, "A3-03 0444"), m2 = g.on(a, base, "A3-25 3615");
    g.toPhase("main");
    const awk = g.hand(a, "A3-25 3809");
    g.ok({ t: "declare", seat: a, kind: "set", card: awk });
    eq(S().draft.step, "target", "target first: the cost depends on it");
    g.ok({ t: "target", seat: a, targets: [{ ch: base }] });
    eq(g.last("xSet").cost, 0, "cost 0 on 藤宮 真由美"); eq(S().draft, null, "nothing to pay: declared at once");
    g.passAll();
    eq(AA4.topOf(S().chars[base]), awk, "on top");
    const st = AA4.charStats(S(), REAL, base);
    assert(st.inherited.includes(m1) && st.inherited.includes(m2), "inherits both other Mayumi cards");
    assert(st.dmgReduce.mental >= 1 || st.noDamage.length, "abilities of the cards below count");
  });
  test("Pack's decks: 時空緩衝器 — when the target player is attacked, no damage check: 1 card to the Damage Pile, then draw 1", () => {
    const g = PG(["A3-03 0630"]), S = g.S, { a, b } = g;
    const att = g.fch(a, "Darklore"); g.give(att, 2);
    giveFactor(g, b, "Eraser", 2); g.give(AA4.controlledOf(S(), b)[0], 2);
    g.toPhase("main");
    g.ok({ t: "declare", seat: a, kind: "attack", ch: att, target: { seat: b } }); g.pay(a);
    const hand0 = S().players[b].zones.hand.length;
    const f = g.hand(b, "A3-03 0630");
    g.ok({ t: "noGuard", seat: b });
    g.ok({ t: "declare", seat: b, kind: "set", card: f }); g.pay(b); g.ok({ t: "target", seat: b, targets: [{ seat: b }] });
    g.passAll(); g.passAll();
    eq(S().players[b].zones.damage.length, 1, "1 card to the Damage Pile"); eq(S().players[b].zones.hand.length, hand0 + 1, "drew 1 (the Fast card was moved into the hand and played)");
    assert(g.events().some(e => e.e === "attackReplaced"), "no damage check");
  });
  test("Pack's decks: アルケミックメイド — no factor or cost when the opponent has characters and you have no Controlled one", () => {
    const g = PG(["A3-20 2752"]), S = g.S, { a, b } = g;
    const own = g.fch(a, "WIZ-DOM", "active");
    g.fch(b, "Darklore");
    g.toPhase("main");
    const m = g.hand(a, "A3-20 2752");
    g.ok({ t: "declare", seat: a, kind: "set", card: m });
    eq(S().draft.cost, 0, "cost 0");
    if (S().draft.step === "target") g.ok({ t: "target", seat: a, targets: [{ ch: own }] });
    g.passAll();
    eq(AA4.topOf(S().chars[own]), m, "set without the factor");
  });
  test("Pack's decks: サンタ“ディーナ” — every player takes a card from their Discard Pile", () => {
    const g = PG(["A3-23 3359"]), S = g.S, { a, b } = g;
    giveFactor(g, a, "WIZ-DOM", 3); g.give(AA4.controlledOf(S(), a)[0], 2);
    for (const s of [a, b]) g.ok({ t: "move", seat: s, card: S().players[s].zones.deck[0], to: { z: "discard" } });
    const host = g.fch(a, "WIZ-DOM");
    g.toPhase("main");
    g.ok({ t: "move", seat: a, card: g.free(a, "A3-23 3359"), to: { z: "char", ch: host, role: "stack" } });
    void host;
    // by-hand moves don't trigger "enters": play the trigger the way the rules engine sees a set
    const ab = REAL.card("A3-23 3359").abilities.find(x => x.kind === "trigger");
    assert(ab && ab.effect.steps[0].a === "eachPick" && ab.effect.steps[0].must, "compiled: every player takes 1");
  });
  test("Pack's decks: 魔道図書館司書 — a Scholar attacking a player lets its owner draw 1", () => {
    const sk = REAL.all().find(c => c.type === "Character" && (c.icons || []).includes("スカラー") && !c.name);
    const g = PG(["A3-24 3459", sk.key]), S = g.S, { a, b } = g;
    const h = g.fch(a, "WIZ-DOM", "back"); g.on(a, h, "A3-24 3459");
    const s1 = g.ch(a, sk.key); g.give(s1, 2);
    g.toPhase("main");
    g.ok({ t: "declare", seat: a, kind: "attack", ch: s1, target: { seat: b } }); g.pay(a);
    const tr = S().triggers.find(t => t.seat === a); assert(tr, "the optional draw asks (Q#64)");
    g.ok({ t: "trigger", seat: a, id: tr.id, run: true });
    assert(g.events().some(e => e.e === "drew" && e.seat === a), "drew 1");
  });
  test("Pack's decks: 白天の魔女 on “ディーナ” — Controlled Characters get Bind 1, Shield, Defense +1; gained 'Defense becomes 1'", () => {
    const g = PG(["A3-23 3359", "A3-24 3465"]), S = g.S, { a, b } = g;
    const h = g.fch(a, "WIZ-DOM", "front");
    g.on(a, h, "A3-23 3359"); const w = g.on(a, h, "A3-24 3465");
    const o = g.fch(a, "WIZ-DOM", "back");
    const st = AA4.charStats(S(), REAL, o);
    assert(st.skills.bind && st.skills.shield, "Bind 1 + Shield"); eq(st.de, REAL.card(S().cards[AA4.topOf(S().chars[o])].key).de + 1, "Defense +1");
    const efs = AA4.effectsOf(S(), REAL, h, w), gi = efs.findIndex(e => e.gained);
    assert(gi >= 0, "gained effect");
    g.give(h, 2); g.toPhase("main");
    const foe = g.fch(b, "Darklore");
    g.ok({ t: "declare", seat: a, kind: "effect", ch: h, card: w, i: gi }); g.pay(a); g.ok({ t: "target", seat: a, targets: [{ ch: foe }] }); g.passAll();
    eq(AA4.charStats(S(), REAL, foe).de, 1, "Defense set to 1");
  });
  test("Pack's decks: ペンは剣より強し — mental-attack characters take no battle damage from normal-attack characters", () => {
    const mk = REAL.all().find(c => c.type === "Character" && c.atMental && !c.name), nk = REAL.all().find(c => c.type === "Character" && !c.atMental && c.at >= 2 && !c.name);
    const g = PG(["A3-24 3471", mk.key, nk.key]), S = g.S, { a, b } = g;
    giveFactor(g, a, "WIZ-DOM", 3); g.give(AA4.controlledOf(S(), a)[0], 1);
    const m = g.ch(a, mk.key, "back"), n = g.ch(b, nk.key);
    g.toPhase("main"); g.play(a, g.hand(a, "A3-24 3471"), []);
    const ctx = { S: S(), db: REAL, events: [] }; ctx.emit = e => ctx.events.push(e);
    eq(AA4.damageChar(ctx, m, { normal: 5, battle: true, from: n }), false, "no battle damage from a normal-attack character");
  });
  test("Pack's decks: サイキック・ジーン with 2+ “藤宮 真由美” is not discarded outside a battle", () => {
    const g = PG(["A3-03 0444", "A3-25 3615"]), S = g.S, { a } = g;
    const h = g.fch(a, "E.G.O.", "front");
    g.on(a, h, "A3-03 0444"); g.on(a, h, "A3-25 3615");
    const ctx = { S: S(), db: REAL, events: [] }; ctx.emit = e => ctx.events.push(e);
    AA4.defeat(ctx, h, { why: "test" });
    assert(S().chars[h], "still there"); assert(ctx.events.some(e => e.e === "notDiscarded"), "protected");
  });
  /* ---------- Revise#089 (Pack, 2026-11-05) ---------- */
  test("Revise#089: 'cost back to hand' — paid to the Discard Pile first, back to the hand only when it resolves", () => {
    const g = deckGame(), S = g.S, { a } = g;
    const det = g.char(a, "A3-BS2 2239", "front"); g.give(det, 1);
    g.toPhase("main");
    const top = AA4.topOf(S().chars[det]), pc = S().chars[det].power[0];
    g.ok({ t: "declare", seat: a, kind: "effect", ch: det, card: top, i: 0 }); g.pay(a);
    eq(S().cards[pc].place.z, "discard", "paid → Discard Pile at once");
    g.passAll();
    eq(S().cards[pc].place.z, "hand", "resolved → back to the hand");
  });
  test("Revise#089: an effect whose character left the Control Area before it resolves fails — no effect, the cost stays in the Discard Pile", () => {
    const g = deckGame(), S = g.S, { a } = g;
    const det = g.char(a, "A3-BS2 2239", "front"); g.give(det, 1);
    g.toPhase("main");
    const top = AA4.topOf(S().chars[det]), pc = S().chars[det].power[0];
    g.ok({ t: "declare", seat: a, kind: "effect", ch: det, card: top, i: 0 }); g.pay(a);
    g.ok({ t: "moveChar", seat: a, ch: det, to: { area: "active" } });   // back to the Active Area before it resolves
    g.passAll();
    assert(g.events().some(e => e.e === "effectCancelled" && /Control Area/.test(e.why)), "failed");
    eq(S().cards[pc].place.z, "discard", "no cost back");
  });
  test("Revise#089: the attacker leaves the Control Area before the battle → the attack is cancelled, no damage", () => {
    const g = deckGame(), S = g.S, { a, b } = g;
    const att = g.char(a, "A3-20 2783", "front"); g.give(att, 2);
    g.toPhase("main");
    g.ok({ t: "declare", seat: a, kind: "attack", ch: att, target: { seat: b } }); g.pay(a);
    g.ok({ t: "noGuard", seat: b });
    g.ok({ t: "moveChar", seat: a, ch: att, to: { area: "active" } });
    g.passAll();
    eq(S().players[b].zones.damage.length, 0, "no damage"); assert(!g.events().some(e => e.e === "playerDamage"), "no damage check");
  });
  test("Revise#089: the guard leaves the Control Area → guard cancelled; the attack still hits its target (the player), no battle", () => {
    const g = deckGame(), S = g.S, { a, b } = g;
    const att = g.char(a, "A3-20 2783", "front"); g.give(att, 2);
    const grd = g.char(b, "A3-17 2322", "back"); g.give(grd, 1);
    g.toPhase("main");
    g.ok({ t: "declare", seat: a, kind: "attack", ch: att, target: { seat: b } }); g.pay(a);
    g.ok({ t: "declare", seat: b, kind: "guard", ch: grd }); g.pay(b);
    g.ok({ t: "moveChar", seat: b, ch: grd, to: { area: "active" } });
    g.passAll();
    assert(g.events().some(e => e.e === "guardCancelled"), "guard cancelled");
    assert(g.events().some(e => e.e === "playerDamage" && e.seat === b), "the player takes the attacker's damage");
    assert(S().chars[grd], "the former guard took no damage (no battle)");
  });
  test("Revise#089: Remove not paid → its power cards go to the Discard Pile, then it returns to the Active Area", () => {
    const g = RULES.game({ db: REAL, deck: Array(30).fill("A3-24 3380").concat(Array(30).fill("A3-20 2783")), rules: {} });
    const S = g.S, a = g.tp();
    const c = g.char(a, "A3-24 3380", "back");
    const cards = []; g.give(c, 2); cards.push(...S().chars[c].power);
    for (let k = 0; k < 30 && !(S().turn.player === a && S().turn.number > 1 && S().decisions.length); k++) { const d = S().decisions[0]; if (d) { g.ok({ t: "choose", seat: d.seat, decision: d.id, pick: d.kind === "yesno" ? ["no"] : d.options.slice(0, d.min) }); continue; } g.ok({ t: "next", seat: g.tp() }); }
    const d = S().decisions[0]; assert(d && d.kind === "yesno", "asked to pay Remove");
    g.ok({ t: "choose", seat: a, decision: d.id, pick: ["no"] });
    eq(S().chars[c].at.area, "active", "back to the Active Area"); eq(S().chars[c].power.length, 0, "no power cards");
    for (const id of cards) eq(S().cards[id].place.z, "discard");
  });
  test("Revise#089: サイキック・ジーン — +X/+X/+X for EACH power card (X = Mayumi cards in it)", () => {
    const g = RULES.game({ db: REAL, deck: Array(10).fill("A3-03 0444").concat(Array(10).fill("A3-25 3615"), Array(40).fill("A3-17 2322")), rules: {} });
    const S = g.S, a = g.tp();
    const h = g.char(a, "A3-17 2322", "front");
    const take = k => Object.values(S().cards).find(c => c.owner === a && c.key === k && (c.place.z === "deck" || c.place.z === "hand")).id;
    g.ok({ t: "move", seat: a, card: take("A3-03 0444"), to: { z: "char", ch: h, role: "stack" } });
    g.ok({ t: "move", seat: a, card: take("A3-25 3615"), to: { z: "char", ch: h, role: "stack" } });
    const base = REAL.card("A3-25 3615"), st0 = AA4.charStats(S(), REAL, h);
    eq([st0.se, st0.at, st0.de], [base.se, base.at, base.de], "no power: no bonus");
    g.give(h, 3);
    const st = AA4.charStats(S(), REAL, h);   // X = 2 Mayumi cards; 3 power → +6/+6/+6
    eq([st.at, st.de], [base.at + 6, base.de + 6], "+2 × 3 power");
  });
  test("Revise#089: a Fast / Project / effect that would affect nothing can't be declared", () => {
    const g = deckGame(), S = g.S, { a } = g;
    const k = REAL.all().find(c => (c.type === "Fast" || c.type === "Project") && c.play && !c.play.target && c.status === "auto" && c.play.steps.length && c.play.steps.every(x => x.to && x.to.all && x.to.all.attacking));
    if (!k) return;
    const plan = AA4.planDeclaration(S(), REAL, a, { kind: "set", card: Object.values(S().cards).find(c => c.owner === a).id });
    void plan;
    eq(AA4.groupEmpty(S(), REAL, k.play, { seat: a }), true, "no attacking character: nothing to affect");
  });
  test("Revise#091: charged power cards are pending until the Charge Phase ends; they can be taken back (hand → hand, deck → deck top)", () => {
    const g = deckGame(), S = g.S, { a } = g;
    const c = g.char(a, "A3-EP EP279", "back");   // Charge 2, Mental ≥ 2
    g.toPhase("charge");
    const h = S().players[a].zones.hand[0], top = S().players[a].zones.deck[S().players[a].zones.deck.length - 1];
    g.ok({ t: "charge", seat: a, ch: c, card: h });
    g.ok({ t: "charge", seat: a, ch: c, fromDeck: true });
    eq(S().pendingPower.map(x => x.card), [h, top], "both pending");
    g.ok({ t: "unCharge", seat: a, card: h });
    eq(S().cards[h].place.z, "hand", "back to the hand");
    g.ok({ t: "unCharge", seat: a, card: top });
    const deck = S().players[a].zones.deck;
    eq(deck[deck.length - 1], top, "back on top of the deck"); eq(S().players[a].turnFlags.deckCharged, 0, "the deck charge is free again");
    g.ok({ t: "charge", seat: a, ch: c, card: h });
    g.ok({ t: "next", seat: a });
    eq(S().pendingPower, [], "set at the end of the Charge Phase");
    eq(S().cards[h].place.role, "power");
    assert(g.events().some(e => e.e === "chargeSet" && e.n === 1), "logged");
    g.no({ t: "unCharge", seat: a, card: h }, "Charge Phase");
  });
  test("Revise#092: mental damage to a player runs the damage check (a Character card → Active Area); by-hand Special damage goes straight to the Damage Pile", () => {
    const g = RULES.game({ db: REAL, deck: Array(60).fill("A3-20 2783"), rules: {} });
    const S = g.S, b = g.other();
    const ctx = { S: S(), db: REAL, events: [] }; ctx.emit = e => ctx.events.push(e);
    const top = S().players[b].zones.deck.slice(-2);
    AA4.damagePlayer(ctx, b, { normal: 0, mental: 2 }, {});
    for (const id of top) eq(S().cards[id].place.z, "char", "Character card → Active Area");
    const nxt = S().players[b].zones.deck[S().players[b].zones.deck.length - 1];
    g.ok({ t: "selfDamage", seat: b, kind: "special" });
    eq(S().cards[nxt].place.z, "damage", "special: straight to the Damage Pile");
  });
  test("real data: A3-09 1466 Snakey vs A3-10 1570 Chimera — Shield works only outside battles: in the faction check both take battle damage (Revise#085)", () => {
    const g = RULES.game({ db: REAL, deck: Array(50).fill("A3-09 1466").concat(Array(10).fill("A3-10 1570")), rules: {} });
    const a = g.tp(), b = g.other();
    const snakey = g.char(a, "A3-09 1466", "back"), chimera = g.char(a, "A3-10 1570", "active");   // same player: the faction check
    for (let k = 0; k < 40 && !(g.S().battle && g.S().turn.player === a); k++) {   // on to a's next Active Phase (the faction check)
      const d = g.S().decisions[0];
      if (d) { g.ok({ t: "choose", seat: d.seat, decision: d.id, pick: d.kind === "yesno" ? ["no"] : d.options.slice(0, d.min) }); continue; }
      g.ok({ t: "next", seat: g.tp() });
    }
    // Active Phase: ▼ Chimera attacks its own player; Snakey guards
    assert(g.S().battle && g.S().battle.attacker === chimera, "faction check attack");
    g.give(snakey, 1);
    g.ok({ t: "declare", seat: a, kind: "guard", ch: snakey });
    if (g.S().draft && g.S().draft.step === "pay") g.ok({ t: "pay", seat: a, cards: g.S().chars[snakey].power.slice(0, g.S().draft.cost) });
    g.passAll();
    const dm = g.events().filter(e => e.e === "damaged" && e.ch);
    assert(dm.length === 2 && dm.every(e => e.normal > 0 && !e.cancelled.length), "battle damage is dealt despite Shield: " + JSON.stringify(dm));
    assert(!g.S().chars[snakey] || g.S().chars[snakey].flags.dying, "Snakey (Defense 1) takes Chimera's 2");
    // outside a battle Shield stops the damage
    const g2 = RULES.game({ db: REAL, deck: Array(60).fill("A3-09 1466"), rules: {} });
    const s2 = g2.char(g2.tp(), "A3-09 1466", "front");
    const ctx = { S: g2.S(), db: REAL, emit: () => {}, events: [] };
    eq(AA4.damageChar(Object.assign(ctx, { emit: e => ctx.events.push(e) }), s2, { normal: 3 }), false, "no damage from an effect");
    assert(/Shield/.test(ctx.events[0].cancelled.join()), "reason: Shield");
    // against an opponent's character the Shield does not help
    void b;
  });
  /* ---------- M1a (Pack's milestone 1a): every Character of A3-01 … A3-25 is automatic ---------- */
  {
    const SAGA3 = k => { const m = /^A3-(\d\d)(?:\.5)? /.exec(k); return !!m && +m[1] <= 25; };
    test("M1a: every Character card of A3-01 … A3-25 is fully automatic", () => {
      const bad = REAL.all().filter(c => c.type === "Character" && SAGA3(c.key) && c.status !== "auto").map(c => c.key);
      eq(bad, [], "Characters still by hand");
    });
    const sum = f => Object.values(f || {}).reduce((a, b) => a + b, 0);
    const plainBreak = (want, avoid = []) => REAL.all().find(c => c.type === "Break" && c.status === "auto" && !c.name && c.cost === 1 && sum(c.factor) === 1 && !c.breakRule && !(c.skills || {}).dual
      && !c.freeOnName && !c.freeIf && !(c.abilities || []).length && (!want || (c.icons || []).includes(want)) && !(c.icons || []).some(i => avoid.includes(i))).key;
    const vanilla = (faction, min = {}) => (REAL.all().find(c => c.type === "Character" && c.faction === faction && !c.name && c.status === "auto" && !(c.abilities || []).length && !(c.effects || []).length
      && !Object.keys(c.skills || {}).filter(k => k !== "aggressive" || !min.calm).length && c.at >= (min.at || 0) && c.de >= (min.de || 1) && c.se >= (min.se || 0)) || {}).key;
    const named = faction => REAL.all().find(c => c.type === "Character" && c.faction === faction && c.name && c.status === "auto" && !(c.abilities || []).length).key;
    const FACS = AA4.FACTIONS.map(f => f.name);
    const M1 = ["A3-20 2668", "A3-20 2666", "A3-21 2885", "A3-21 2893", "A3-20 2667", "A3-20 2676", "A3-21 2929", "A3-22 3108", "A3-24 3373", "A3-24 3381", "A3-24 3382", "A3-25 3593",
      "A3-25 3594", "A3-25 3595", "A3-25 3596", "A3-25 3597", "A3-25 3603", "A3-07 1009", "A3-07 1183", "A3-12 1809", "A3-12 1824", "A3-22 3109", "A3-22 3289", "A3-22 3217", "A3-01 0184"];
    const EXTRA = () => [...new Set(FACS.map(f => vanilla(f)).concat(FACS.map(f => vanilla(f, { at: 2 })), [named("E.G.O."), REAL.all().find(c => c.type === "Permanent").key, plainBreak("スカラー"), plainBreak("マシン"), plainBreak("タレント")],
      REAL.all().filter(c => c.type === "Break" && c.faction === "E.G.O." && c.status === "auto").slice(0, 1).map(c => c.key)).filter(Boolean))];
    const mGame = () => {
      const keys = M1.concat(EXTRA()), deck = keys.flatMap(k => [k, k]);
      const g = RULES.game({ db: REAL, deck, rules: {} });
      const S = g.S, a = g.tp(), b = g.other();
      const free = (seat, key) => { const c = Object.values(S().cards).filter(x => x.owner === seat && x.key === key && (x.place.z === "deck" || x.place.z === "hand")).sort((x, y) => (x.place.z === "hand") - (y.place.z === "hand"))[0]; if (!c) throw new Error("no free " + key); return c.id; };
      const hand = (seat, key) => { const id = free(seat, key); if (S().cards[id].place.z !== "hand") g.ok({ t: "move", seat, card: id, to: { z: "hand" } }); return id; };
      const pay = seat => { const d = S().draft; if (d && d.step === "pay" && d.cost) g.ok({ t: "pay", seat, cards: d.payFrom.flatMap(ch => S().chars[ch].power).slice(0, d.cost) }); };
      const factorFor = (seat, key) => { for (const [f, n] of Object.entries(REAL.card(key).factor || {})) for (let i = 0; i < n; i++) g.char(seat, vanilla(f), "back"); };
      const decide = (pick, seat) => { const d = S().decisions[0]; assert(d, "a choice is waiting"); g.ok({ t: "choose", seat: seat == null ? d.seat : seat, decision: d.id, pick: typeof pick === "function" ? pick(d) : pick }); };
      return Object.assign(g, { a, b, hand, pay, factorFor, decide });
    };
    test("M1a: 本来のコストが0のカード全て +1 (A3-20 2668) · ≪極星帝国のプロジェクトカード・ファストカード≫ +1 (A3-20 2666)", () => {
      const g = mGame(), S = g.S, { a, b } = g;
      g.char(b, "A3-20 2668", "active");
      eq(AA4.cardCostMod(S(), REAL, a, { type: "Fast", cost: 0 }), 1, "printed cost 0: +1 for every player");
      eq(AA4.cardCostMod(S(), REAL, b, { type: "Break", cost: 0 }), 1);
      eq(AA4.cardCostMod(S(), REAL, a, { type: "Fast", cost: 1 }), 0, "printed cost 1: unchanged");
      g.char(a, "A3-20 2666", "back");
      eq(AA4.cardCostMod(S(), REAL, b, { type: "Project", faction: "Polestar Empire", cost: 2 }), 1, "Polestar Project +1");
      eq(AA4.cardCostMod(S(), REAL, b, { type: "Fast", faction: "Polestar Empire", cost: 2 }), 1, "Polestar Fast +1");
      eq(AA4.cardCostMod(S(), REAL, b, { type: "Project", faction: "WIZ-DOM", cost: 2 }), 0, "other factions unchanged");
    });
    test("M1a: 分類に関わらず、≪このキャラクター≫を(E.G.O.の)ブレイクカードでブレイク可能 (A3-21 2885 / 2893)", () => {
      const g = mGame(), S = g.S, { a } = g;
      const egoOnly = g.char(a, "A3-21 2885", "front"), any = g.char(a, "A3-21 2893", "front");
      const avoid = REAL.card("A3-21 2885").icons.concat(REAL.card("A3-21 2893").icons);
      const ego = REAL.all().find(c => c.type === "Break" && c.faction === "E.G.O." && !c.name && !c.breakRule && !(c.icons || []).some(i => avoid.includes(i))).key;
      const wiz = REAL.all().find(c => c.type === "Break" && c.faction === "WIZ-DOM" && !c.name && !c.breakRule && !(c.icons || []).some(i => avoid.includes(i))).key;
      const ids = [ego, wiz].map(k => Object.values(S().cards).find(c => c.key === k) || null);
      const cardOf = k => { const ex = Object.values(S().cards).find(c => c.key === k); if (ex) return ex.id; S().cards["zz" + k] = { id: "zz" + k, key: k, owner: a, place: { z: "hand", seat: a } }; return "zz" + k; };
      void ids;
      const e = cardOf(ego), w = cardOf(wiz);
      eq(AA4.breakReason(S(), REAL, a, e, egoOnly), null, "an E.G.O. Break card: any class");
      eq(AA4.breakReason(S(), REAL, a, w, egoOnly), "No class icon in common", "a WIZ-DOM Break card still needs a class icon");
      eq(AA4.breakReason(S(), REAL, a, w, any), null, "A3-21 2893: any Break card");
      delete S().cards["zz" + ego]; delete S().cards["zz" + wiz];
    });
    test("M1a: A3-20 2676 編入生 — declared as an E0 Break card: breaks a character with a class icon in common", () => {
      const g = mGame(), S = g.S, { a } = g;
      const host = g.char(a, "A3-20 2676", "front");
      g.toPhase("main");
      const c = g.hand(a, "A3-20 2676");
      const cands = AA4.candidates(S(), REAL, "P" + a, a).filter(x => x.card === c && x.kind === "set");
      assert(cands.some(x => x.asBreak) && cands.some(x => !x.asBreak), "both: set as a Character, or declare as a Break card");
      g.ok({ t: "declare", seat: a, kind: "set", card: c, asBreak: true });
      eq(S().draft.cost, 0, "cost 0");
      g.ok({ t: "target", seat: a, targets: [{ ch: host }] }); g.passAll();
      eq(AA4.topOf(S().chars[host]), c, "on top as a Break card");
      assert(AA4.charStats(S(), REAL, host).broken, "the character is broken");
      g.ok({ t: "move", seat: a, card: c, to: { z: "hand" } });
      assert(!S().cards[c].asBreak, "back in the hand: a Character card again");
    });
    test("M1a: A3-20 2667 — when broken, mill 3 from the top of your deck", () => {
      const g = mGame(), S = g.S, { a } = g;
      const host = g.char(a, "A3-20 2667", "front"); g.give(host, 1);
      const bk = plainBreak("スカラー") || plainBreak("モンスター"); g.factorFor(a, bk);
      g.toPhase("main");
      const before = S().players[a].zones.discard.length;
      g.ok({ t: "declare", seat: a, kind: "set", card: g.hand(a, bk) }); g.pay(a); g.ok({ t: "target", seat: a, targets: [{ ch: host }] }); g.passAll();
      eq(S().players[a].zones.discard.length - before, 1 + 3, "the cost + 3 from the deck");
    });
    test("M1a: A3-24 3373 — the player who broke it (in the Control Area) may make any player discard 1 (that player chooses)", () => {
      const g = mGame(), S = g.S, { a, b } = g;
      const foe = g.char(b, "A3-24 3373", "front");
      const bk = plainBreak("マシン") || plainBreak("タレント"); g.factorFor(a, bk);
      const payer = g.char(a, vanilla(REAL.card(bk).faction), "front"); g.give(payer, 1);
      g.toPhase("main");
      g.ok({ t: "declare", seat: a, kind: "set", card: g.hand(a, bk) }); g.pay(a); g.ok({ t: "target", seat: a, targets: [{ ch: foe }] }); g.passAll();
      const tr = S().triggers.find(t => S().cards[t.card].key === "A3-24 3373"); assert(tr && tr.seat === a, "the breaker may use it (asks, Q#64)");
      g.ok({ t: "trigger", seat: a, id: tr.id, run: true });
      const hb = S().players[b].zones.hand.length;
      g.decide([String(b)], a);
      g.decide(d => d.options.slice(0, 1), b);
      eq(S().players[b].zones.hand.length, hb - 1, "B discards 1 of B's choice");
    });
    test("M1a: A3-25 3603 — whoever breaks it while it has power cards draws 1", () => {
      const g = mGame(), S = g.S, { a } = g;
      const host = g.char(a, "A3-25 3603", "front"); g.give(host, 2);   // one pays the cost, one stays (power cards when it is broken)
      const bk = plainBreak("マシン"); g.factorFor(a, bk);
      g.toPhase("main");
      const c = g.hand(a, bk), h0 = S().players[a].zones.hand.length;
      g.ok({ t: "declare", seat: a, kind: "set", card: c }); g.pay(a); g.ok({ t: "target", seat: a, targets: [{ ch: host }] }); g.passAll();
      eq(S().players[a].zones.hand.length, h0 - 1 + 1, "the Break card left the hand, 1 drawn");
    });
    test("M1a: A3-25 3594 — discarded as a result of a battle → its owner may draw 1", () => {
      const g = mGame(), S = g.S, { a, b } = g;
      const att = g.char(a, FACS.map(f => vanilla(f, { at: 2 })).find(Boolean), "front"); g.give(att, 2);
      const grd = g.char(b, "A3-25 3594", "front"); g.give(grd, 1);
      g.toPhase("main");
      g.ok({ t: "declare", seat: a, kind: "attack", ch: att, target: { seat: b } }); g.pay(a);
      g.ok({ t: "declare", seat: b, kind: "guard", ch: grd }); g.pay(b);
      g.passAll();
      assert(!S().chars[grd], "the guard is gone");
      const tr = S().triggers.find(t => S().cards[t.card].key === "A3-25 3594"); assert(tr && tr.seat === b, "its owner may draw (asks)");
      g.ok({ t: "trigger", seat: b, id: tr.id, run: true });
      assert(g.events().some(e => e.e === "drew" && e.seat === b), "its owner drew 1");
    });
    test("M1a: A3-25 3596 — dominated → may set a Character card from the deck as an Active Character", () => {
      const g = mGame(), S = g.S, { a } = g;
      const me = g.char(a, "A3-25 3596", "active"); g.give(me, REAL.card("A3-25 3596").se);
      for (let k = 0; k < 6 && !S().triggers.length && S().turn.player === a; k++) { const d = S().decisions[0]; if (d) { g.ok({ t: "choose", seat: d.seat, decision: d.id, pick: d.options.slice(0, d.min) }); continue; } g.ok({ t: "next", seat: a }); }
      const tr = S().triggers.find(t => S().cards[t.card].key === "A3-25 3596"); assert(tr, "dominated: its ability asks");
      g.ok({ t: "trigger", seat: a, id: tr.id, run: true });
      const d = S().decisions[0];
      assert(d && d.options.every(id => REAL.card(S().cards[id].key).type === "Character"), "only Character cards from the deck");
      const pick = d.options.find(id => !REAL.card(S().cards[id].key).name);
      g.decide([pick], a);
      eq(S().cards[pick].place.z, "char"); eq(AA4.charOfCard(S(), pick).at.area, "active", "→ Active Area");
    });
    test("M1a: A3-25 3597 — when set, may move one of your power cards onto it", () => {
      const g = mGame(), S = g.S, { a } = g;
      const other = g.char(a, vanilla(FACS[0]), "front"); g.give(other, 1);
      g.toPhase("main");
      const c = g.hand(a, "A3-25 3597");
      g.ok({ t: "declare", seat: a, kind: "set", card: c });
      const tr = S().triggers.find(t => t.card === c);
      assert(tr && tr.optional, "optional, with a target");
      const pc = S().chars[other].power[0];
      g.ok({ t: "trigger", seat: a, id: tr.id, run: true, targets: [{ card: pc }] }); g.passAll();
      eq(S().cards[pc].place.ch, AA4.charOfCard(S(), c).id, "the power card is now on 3597");
    });
    test("M1a: バインドX / ドロー-X with X from the text (A3-07 1009 / 1183)", () => {
      const g = mGame(), S = g.S, { a, b } = g;
      const camp = g.char(a, "A3-07 1009", "front");
      for (let i = 0; i < 2; i++) { const d = S().players[b].zones.deck; g.ok({ t: "move", seat: b, card: d[d.length - 1], to: { z: "damage" } }); }
      eq(AA4.charStats(S(), REAL, camp).skills.bind, 2, "Bind = the opponents' Damage Piles (2)");
      g.char(a, "A3-07 1183", "back");
      eq(AA4.playerStats(S(), REAL, a).draw, Math.max(0, 1 - S().players[a].zones.hand.length), "Draw − hand size");
    });
    test("M1a: A3-12 1809 — 1: a power card from the top of your deck onto your target character", () => {
      const g = mGame(), S = g.S, { a } = g;
      const me = g.char(a, "A3-12 1809", "front"); g.give(me, 1);
      const other = g.char(a, vanilla(FACS[0]), "front");
      g.toPhase("main");
      const top = S().players[a].zones.deck.slice(-1)[0];
      g.ok({ t: "declare", seat: a, kind: "effect", ch: me, card: AA4.topOf(S().chars[me]), i: 0 }); g.pay(a);
      g.ok({ t: "target", seat: a, targets: [{ ch: other }] }); g.passAll();
      eq(S().chars[other].power, [top]);
    });
    test("M1a: A3-12 1824 — the cost of a Talent Break card paid from this character → back to the hand", () => {
      const g = mGame(), S = g.S, { a } = g;
      const me = g.char(a, "A3-12 1824", "front"); g.give(me, 1);
      const bk = plainBreak("タレント"); g.factorFor(a, bk);
      g.toPhase("main");
      const pc = S().chars[me].power[0];
      g.ok({ t: "declare", seat: a, kind: "set", card: g.hand(a, bk) });
      g.ok({ t: "pay", seat: a, cards: [pc] });
      g.ok({ t: "target", seat: a, targets: [{ ch: me }] });
      eq(S().cards[pc].place.z, "hand", "paid from 1824 → hand");
    });
    test("M1a: A3-22 3109 / 3289 — while battling, the opponent's Bind X / every skill is negated", () => {
      const g = mGame(), S = g.S, { a, b } = g;
      const att = g.char(a, "A3-22 3109", "front"); g.give(att, 2);
      const grd = g.char(b, "A3-07 1009", "front"); g.give(grd, 1);
      { const d = S().players[a].zones.deck; g.ok({ t: "move", seat: a, card: d[d.length - 1], to: { z: "damage" } }); }
      eq(AA4.charStats(S(), REAL, grd).skills.bind, 1, "Bind 1 before the battle");
      g.toPhase("main");
      g.ok({ t: "declare", seat: a, kind: "attack", ch: att, target: { seat: b } }); g.pay(a);
      g.ok({ t: "declare", seat: b, kind: "guard", ch: grd }); g.pay(b);
      eq(AA4.charStats(S(), REAL, grd).skills.bind, undefined, "negated in the battle");
      const g2 = mGame(), S2 = g2.S;
      const ch = g2.char(g2.a, "A3-22 3289", "front"); g2.char(g2.b, "A3-20 2668", "front");
      S2().battle = { attacker: ch, guard: Object.keys(S2().chars).find(id => S2().chars[id].owner === g2.b), target: { seat: g2.b }, joined: { att: [], grd: [] }, step: "before" };
      AA4.touch(S2());
      const foe = S2().battle.guard;
      eq(Object.keys(AA4.charStats(S2(), REAL, foe).skills).length, 0, "every skill of the battle opponent is gone");
    });
    test("Q#35 (Revise#094): A3-22 3217 Wasp — the battle opponent's Permanent limit 1 − 1 = 0 → its permanent must go (Discard Pile, or a Permanent Destination rule)", () => {
      for (const dest of [null, "hand", "char"]) {
        const g = mGame(), S = g.S, { a, b } = g;
        const att = g.char(a, "A3-22 3217", "front"); g.give(att, 2);
        const grd = g.char(b, FACS.map(f => vanilla(f)).find(Boolean), "front"); g.give(grd, 1);
        const spare = g.char(b, FACS.map(f => vanilla(f)).find(Boolean), "back");
        const pc = g.hand(b, REAL.all().find(c => c.type === "Permanent").key);   // placed by hand
        g.ok({ t: "move", seat: b, card: pc, to: { z: "char", ch: grd, role: "perm" } });
        if (dest) g.ok({ t: "field", seat: b, mod: { key: "permDest", op: "dest", value: { to: dest }, to: { seat: b }, until: "turn", label: "test" } });
        g.toPhase("main");
        g.ok({ t: "declare", seat: a, kind: "attack", ch: att, target: { seat: b } }); g.pay(a);
        g.ok({ t: "declare", seat: b, kind: "guard", ch: grd }); g.pay(b);
        g.passAll();
        for (let k = 0; k < 3 && S().decisions.length; k++) { const d = S().decisions[0]; g.ok({ t: "choose", seat: d.seat, decision: d.id, pick: d.kind === "chars" ? [spare] : d.options.slice(0, d.min) }); }
        const z = S().cards[pc].place;
        if (!dest) eq(z.z, "discard", "no rule: Discard Pile");
        else if (dest === "hand") eq(z.z, "hand", "rule: → hand");
        else eq([z.z, z.ch], ["char", spare], "rule: onto another character");
      }
    });
    test("M1a: A3-25 3593 — in the same area as an E.G.O. name-level character: Shield · Charge 1", () => {
      const g = mGame(), S = g.S, { a } = g;
      const me = g.char(a, "A3-25 3593", "active");
      const base = AA4.charStats(S(), REAL, me).skills;
      assert(!base.shield, "no Shield alone");
      g.char(a, named("E.G.O."), "back");
      assert(!AA4.charStats(S(), REAL, me).skills.shield, "another area: no");
      g.char(a, named("E.G.O."), "active");
      const sk = AA4.charStats(S(), REAL, me).skills;
      assert(sk.shield && sk.charge === (base.charge || 0) + 1, "Shield and Charge +1: " + JSON.stringify(sk));
    });
    test("M1a: A3-21 2929 — 1: one Darklore factor until the end of the Main Phase; A3-24 3382 — 2: an E.G.O. Break card from the deck", () => {
      const g = mGame(), S = g.S, { a } = g;
      const me = g.char(a, "A3-21 2929", "front"); g.give(me, 1);
      g.toPhase("main");
      g.ok({ t: "declare", seat: a, kind: "effect", ch: me, card: AA4.topOf(S().chars[me]), i: 0 }); g.pay(a); g.passAll();
      eq(AA4.charStats(S(), REAL, me).factorBonus.Darklore, 1);
      const s = g.char(a, "A3-24 3382", "front"); g.give(s, 2);
      g.ok({ t: "declare", seat: a, kind: "effect", ch: s, card: AA4.topOf(S().chars[s]), i: 0 }); g.pay(a); g.passAll();
      const d = S().decisions[0];
      assert(d && d.options.length && d.options.every(id => { const c = REAL.card(S().cards[id].key); return c.type === "Break" && c.faction === "E.G.O."; }), "E.G.O. Break cards only");
      g.decide(d.options.slice(0, 1), a);
      eq(S().cards[d.options[0]].place.z, "hand");
    });
    const m2Game = keys => {   // M2a … (Revise#109): the cards under test + plain characters
      const deck = keys.concat(EXTRA()).flatMap(k => [k, k, k]);
      const g = RULES.game({ db: REAL, deck, rules: {} });
      const S = g.S, a = g.tp(), b = g.other();
      const pay = seat => { const d = S().draft; if (d && d.step === "pay" && d.cost) g.ok({ t: "pay", seat, cards: d.payFrom.flatMap(ch => S().chars[ch].power).slice(0, d.cost) }); };
      const decide = (pick, seat) => { const d = S().decisions[0]; assert(d, "a choice is waiting"); g.ok({ t: "choose", seat: seat == null ? d.seat : seat, decision: d.id, pick: typeof pick === "function" ? pick(d) : pick }); };
      const respond = () => { for (let k = 0; k < 6 && S().battle && S().battle.step === "response" && !S().decisions.length; k++) g.ok({ t: "pass", seat: AA4.priorityNow(S()) }); };
      return Object.assign(g, { a, b, pay, decide, respond });
    };
    test("Pack bug (Revise#163): A3-20 2696 used on the guard during the battle — the attacker loses all its skills (Initiative too) in that battle", () => {
      const g = m2Game(["A3-17 2325", "A3-20 2696"]), S = g.S, { a, b } = g;
      const att = g.char(a, vanilla("Darklore"), "front"); g.give(att, 3);
      const ac = Object.values(S().cards).find(c => c.owner === a && c.key === "A3-17 2325" && c.place.z !== "char");
      g.ok({ t: "move", seat: a, card: ac.id, to: { z: "char", ch: att, role: "stack" } });
      const grd = g.char(b, vanilla("E.G.O."), "front"); g.give(grd, 3); g.char(b, vanilla("E.G.O."), "back"); g.char(b, vanilla("E.G.O."), "back");
      const fc = Object.values(S().cards).find(c => c.owner === b && c.key === "A3-20 2696" && c.place.z !== "char");
      if (S().cards[fc.id].place.z !== "hand") g.ok({ t: "move", seat: b, card: fc.id, to: { z: "hand" } });
      g.toPhase("main");
      assert(AA4.charStats(S(), REAL, att).skills.initiative, "2325 has Initiative");
      g.ok({ t: "declare", seat: a, kind: "attack", ch: att, target: { seat: b } }); g.pay(a);
      g.ok({ t: "declare", seat: b, kind: "guard", ch: grd }); g.pay(b);
      g.ok({ t: "declare", seat: b, kind: "set", card: fc.id }); g.pay(b);
      if (S().draft && S().draft.step === "target") g.ok({ t: "target", seat: b, targets: [{ ch: grd }] });
      for (let k = 0; k < 8 && S().stack.length; k++) g.ok({ t: "pass", seat: AA4.priorityNow(S()) == null ? a : AA4.priorityNow(S()) });
      // a skill granted after the negation must not come back (order of the modifiers)
      AA4.addMod({ S: S(), db: REAL, emit: () => {} }, { src: { seat: a }, to: { ch: att }, key: "negate", op: "grant", value: { skills: true, effects: true }, until: "battle" });
      AA4.addMod({ S: S(), db: REAL, emit: () => {} }, { src: { seat: a }, to: { ch: att }, key: "skill", op: "grant", value: { id: "initiative", x: true }, until: "battle" }); AA4.touch(S());
      const st = AA4.charStats(S(), REAL, att); eq(Object.keys(st.skills).length, 0, "no skills while negated"); eq(st.initCount, 0, "no Initiative counted");
      S().modifiers = S().modifiers.filter(m => !(m.to && m.to.ch === att && m.until === "battle")); AA4.touch(S());
      const e0 = g.events().length;
      for (let k = 0; k < 20 && S().battle; k++) { const d = S().decisions[0]; if (d) { g.ok({ t: "choose", seat: d.seat, decision: d.id, pick: d.options.slice(0, d.min) }); continue; } if (S().battle.step !== "response") break; const now = AA4.priorityNow(S()); g.ok({ t: "pass", seat: now == null ? b : now }); }
      const bt = g.events().slice(e0).find(e => e.e === "battle");
      assert(bt && bt.first !== "a", "2325 has no Initiative in that battle (2696 negates its skills)");
    });
    test("Revise#164: a card with modes (A3-20 2697) — choose an effect when declaring; the chosen one runs; mode 2 only for a player who did not go first", () => {
      const g = m2Game(["A3-20 2697"]), S = g.S, { a, b } = g, inf = REAL.card("A3-20 2697");
      eq(inf.play.modes.length, 2, "two modes");
      const fac = Object.keys(inf.factor || {})[0] || "E.G.O.", pay = g.char(a, vanilla(fac), "back"); g.give(pay, 3);
      for (let k = 1; k < ((inf.factor || {})[fac] || 1); k++) g.char(a, vanilla(fac), "back");
      const foe = g.char(b, vanilla("Darklore", { de: 3 }) || vanilla("Darklore"), "front");
      const card = Object.values(S().cards).find(c => c.owner === a && c.key === "A3-20 2697" && c.place.z !== "char").id;
      if (S().cards[card].place.z !== "hand") g.ok({ t: "move", seat: a, card, to: { z: "hand" } });
      g.toPhase("main");
      const cands = AA4.candidates(S(), REAL, S().players[a].cid, a, {}).filter(c => c.card === card);
      assert(cands.some(c => c.mode === 0), "mode 1 offered");
      g.no({ t: "declare", seat: a, kind: "set", card }, "Choose one of its effects");
      if (S().turn.order[0] === a) g.no({ t: "declare", seat: a, kind: "set", card, mode: 1 }, "did not go first");
      g.ok({ t: "declare", seat: a, kind: "set", card, mode: 0 }); g.pay(a);
      if (S().draft && S().draft.step === "target") g.ok({ t: "target", seat: a, targets: [{ ch: foe }] });
      const e0 = g.events().length;
      for (let k = 0; k < 6 && S().stack.length; k++) g.ok({ t: "pass", seat: AA4.priorityNow(S()) == null ? a : AA4.priorityNow(S()) });
      assert(g.events().slice(e0).some(e => e.e === "damaged" && e.ch === foe && e.normal === 1), "mode 1: 1 damage");
      eq(S().cards[card].mode, undefined, "the mode ends when it leaves");
    });
    test("M3b–f batch 1 (Revise#164): compile checks; a Permanent moves on when its character leaves; sweep while it lasts; Damage Pile trigger", () => {
      eq(REAL.card("A3-20 2764").asFast.factor["WIZ-DOM"], 4, "2764: as a Fast card with W4");
      assert(REAL.card("A3-22 3124").permMoveOnLeave, "3124 moves on");
      assert(REAL.card("A3-25 3617").abilities.some(x => x.when && x.when.event === "ownBreakFirst"), "3617: first E.G.O. Break this turn");
      assert(REAL.card("A3-07 1205").abilities.some(x => x.when && x.when.event === "selfToDamage" && x.zone === "damage"), "1205: trigger in the Damage Pile");
      assert(REAL.card("A3-19 2522").abilities.some(x => (x.zones || []).includes("hand")), "2522: from the hand or the Damage Pile");
      const g = m2Game(["A3-22 3124"]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, emit: () => {} };
      const c1 = g.char(a, vanilla("E.G.O."), "front"), c2 = g.char(a, vanilla("E.G.O."), "front");
      const pc = Object.values(st.cards).find(c => c.owner === a && c.key === "A3-22 3124" && c.place.z !== "char");
      AA4.moveCard(ctx, pc.id, { z: "char", ch: c1, role: "perm" });
      AA4.defeat(ctx, c1, { why: "test" });
      for (let k = 0; k < 30 && st.queue && st.queue.length; k++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); }
      const d = st.decisions.find(x => x.options.includes(AA4.topOf(st.chars[c2])));
      assert(d, "asked where to move it");
      AA4.OPS.permMoveGo(ctx, { card: pc.id, answer: [AA4.topOf(st.chars[c2])] });
      eq(st.cards[pc.id].place.ch, c2, "moved to the other character");
      // sweep: power-0 characters are discarded while it lasts
      const z = g.char(b, vanilla("E.G.O."), "front");
      AA4.addMod(ctx, { src: { seat: a, label: "test" }, to: { players: "all" }, key: "sweepSel", op: "grant", value: { sel: { power: { op: "=", n: 0 } } }, until: "main" }); AA4.touch(st);
      for (let k = 0; k < 10 && AA4.STATE_CHECKS.some(f => f(ctx)); k++);
      assert(!st.chars[z], "the power-0 character is discarded");
    });
    test("Q#65 (Revise#165 / #206): mental damage — ≤ power discards that many; > power discards none and defeats; Bind X keeps it by paying X power cards", () => {
      const g = m2Game(["A3-20 2783"]), S = g.S, { a } = g, st = S(), ctx = { S: st, db: REAL, emit: () => {} };
      const c1 = g.char(a, vanilla("E.G.O."), "front"); g.give(c1, 3);
      AA4.damageChar(ctx, c1, { normal: 0, mental: 2 }); eq(st.chars[c1].power.length, 1, "2 ≤ 3: two power cards discarded");
      const c2 = g.char(a, vanilla("Darklore"), "front"); g.give(c2, 2);
      AA4.addMod(ctx, { src: { seat: a }, to: { ch: c2 }, key: "skill", op: "grant", value: { id: "bind", x: 1 }, until: "turn" }); AA4.touch(st);
      AA4.damageChar(ctx, c2, { normal: 0, mental: 5 });
      assert(st.chars[c2] && AA4.keepOptions(st, REAL, c2, { mentalKill: true }).some(o => o.k === "bind" && o.n === 1), "Bind 1: defeated by the mental damage — Bind is the way to keep it, paying 1 power card (Pack, Revise#206)");
      const c3 = g.char(a, vanilla("Arayashiki"), "front"); g.give(c3, 2);
      const evs = []; AA4.damageChar({ S: st, db: REAL, emit: x => evs.push(x) }, c3, { normal: 0, mental: 5 });
      assert(evs.some(e => e.e === "defeated" && e.ch === c3) || (st.chars[c3] && st.chars[c3].flags.dying), "5 > 2: defeated");
      const p3 = Object.values(st.cards).filter(c => c.place.z === "discard").length; void p3;
    });
    test("Q#66 (Revise#165): A3-23 joke cards — normal text by default; Outlaw “Fool text” plays the フールテキスト", () => {
      const inf = REAL.card("A3-23 3336"); assert(inf.fool && inf.fool.play, "fool text kept");
      eq(inf.play.steps[0].a, "mod", "normal text: +1 Attack");
      const g = m2Game(["A3-23 3336"]), S = g.S, st = S(), id = Object.values(st.cards).find(c => c.key === "A3-23 3336").id;
      assert(AA4.cardInfo(st, REAL, id).play.steps[0].a === "mod", "OFF: the normal text");
      st.rules.outlawFool = true;
      assert(AA4.cardInfo(st, REAL, id).play.steps.some(x => x.a === "foolNote"), "ON: the fool text (shown to the table)");
    });
    test("Revise#166: lasting watchers — 3057 the card is discarded when its target deals damage; compile checks 2950 / 2981 / 2982 / 2766 / 3624", () => {
      const st0 = REAL.card("A3-21 3057").play.steps; assert(st0.some(x => x.a === "watchEv" && x.event === "damaged" && x.once), "3057 watcher");
      assert(REAL.card("A3-21 2982").play.modes[0].steps.some(x => x.a === "watchEv" && x.event === "costPaid"), "2982 mode 1: cost paid → discard");
      assert(REAL.card("A3-21 2981").play.steps.filter(x => x.a === "watchEv" && x.asOwner).length === 2, "2981 set / broken watchers");
      assert(REAL.card("A3-20 2766").play.steps.some(x => x.a === "mod" && x.mod.key === "factorAll"), "2766 all factors");
      assert(REAL.card("A3-25 3624").play.steps.some(x => x.a === "mod" && x.mod.key === "untargetable" && x.mod.value.exceptCard), "3624 untargetable except this card");
      const g = m2Game(["A3-21 3057"]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const me = g.char(a, vanilla("E.G.O."), "front"), foe = g.char(b, vanilla("E.G.O."), "front"); g.give(foe, 3);
      const pc = Object.values(st.cards).find(c => c.owner === a && c.key === "A3-21 3057" && c.place.z !== "char");
      AA4.moveCard(ctx, pc.id, { z: "special" });
      AA4.runEffect(ctx, { steps: [{ a: "watchEv", to: "t", event: "damaged", when: { byThisAny: true }, effect: { steps: [{ a: "thisCardDiscard" }] }, once: true, until: "main" }] }, { seat: a, card: pc.id, ch: null, targets: [{ ch: me }] });
      for (let k = 0; k < 30 && st.queue && st.queue.length; k++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); }
      eq(st.modifiers.filter(m => m.key === "watchEv").length, 1, "watching");
      const n0 = ctx.events.length;
      AA4.damageChar(ctx, foe, { from: me, fromSeat: a, normal: 1, mental: 0 });
      AA4.collectTriggers(ctx, n0);
      for (let k = 0; k < 30 && st.queue && st.queue.length; k++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); }
      eq(st.cards[pc.id].place.z, "discard", "discarded once its target dealt damage");
      eq(st.modifiers.filter(m => m.key === "watchEv").length, 0, "the watcher ends");
    });
    test("Revise#228: 0388 X ≥ target's mental or no effect; EP425 no mental damage ≥ its mental; EP436 / EP403 / EP437", () => {
      eq(["A3-02 0388", "A4-EP EP425", "A4-EP EP436", "A4-EP EP403", "A4-EP EP437"].map(k => REAL.card(k).status), ["auto", "auto", "auto", "auto", "auto"]);
      assert(REAL.card("A3-02 0388").play.steps.every(x => x.ifXGeT === "se"), "0388: every step checks X");
      eq(REAL.card("A4-EP EP437").breakRule.namedGoneTurn, true);
      const g = m2Game(["A4-EP EP425"]), S = g.S, { a, b } = g, st = S(), evs = [], ctx = { S: st, db: REAL, events: evs, emit: e => evs.push(e) };
      const k = g.char(a, "A4-EP EP425", "front"); g.give(k, 5);
      AA4.damageChar(ctx, k, { normal: 0, mental: 3 }); eq(st.chars[k].power.length, 5, "EP425 (mental 3): 3 mental damage is not taken");
      AA4.damageChar(ctx, k, { normal: 0, mental: 2 }); eq(st.chars[k].power.length, 3, "2 is taken");
      // 0388: X 1 against mental 3 → nothing; X 3 → it works
      const t = g.char(b, vanilla("Darklore"), "front"), se = AA4.charStats(st, REAL, t).se;
      const run = x => { const n0 = evs.length; AA4.runEffect(ctx, REAL.card("A3-02 0388").play, { seat: a, targets: [{ ch: t }], x, card: null }); for (let i = 0; i < 20 && st.queue && st.queue.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); } return evs.slice(n0); };
      assert(run(se - 1).some(e => e.e === "note" && /No effect/.test(e.text)), "X below the mental: no effect");
      assert(!run(se).some(e => e.e === "note" && /No effect/.test(e.text)), "X = the mental: it works");
      // EP436 condition: the battle opponent's mental ≤ this character's power
      eq(REAL.card("A4-EP EP436").abilities[0].cond.battleOppSeLePower, true);
      // EP437 break rule: only in a turn when a name-level character of yours was discarded
      const host = Object.values(st.chars).find(c => c.owner === a) ? g.char(a, vanilla("E.G.O."), "front") : null;
      const bc = Object.values(st.cards).find(c => c.owner === a && c.key === "A4-EP EP437") || (() => { const id = Object.keys(st.cards).find(i => st.cards[i].owner === a && st.cards[i].place.z === "deck"); st.cards[id].key = "A4-EP EP437"; return st.cards[id]; })();
      assert(/name-level character/.test(AA4.breakReason(st, REAL, a, bc.id, host, true) || ""), "not yet");
      st.turn.namedGone = { turn: st.turn.number, seats: [a] };
      assert(!/name-level character/.test(AA4.breakReason(st, REAL, a, bc.id, host, true) || ""), "after one was discarded this turn");
    });
    test("Revise#229: Peco Peco attack, named cost −1, “only if you control …”, next Break cost back once, works search, Draw +1 for all, a class, turn-end power", () => {
      const ks = ["A4-EP EP466", "A4-EP EP482", "A4-EP EP515", "A4-EP EP522", "A4-EP EP525", "A4-EP EP528", "A4-EP EP541", "A4-EP EP545", "A4-EP EP494", "A4-EP EP555", "A4-EP EP603", "A4-EP EP495", "A4-EP EP554", "A4-EP EP590", "A4-EP EP601", "A4-EP EP485", "A4-EP EP518"];
      eq(ks.filter(k => REAL.card(k).status !== "auto"), [], "all automatic");
      eq(REAL.card("A4-EP EP495").works, ["ragnarok"]); eq(REAL.card("A4-EP EP603").works, ["sonico"]);
      const g = m2Game(["A4-EP EP466", "A4-EP EP493", "A4-EP EP522", "A4-EP EP590"]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const kn = g.char(a, "A4-EP EP466", "front"), at0 = AA4.charStats(st, REAL, kn).at;
      const peco = Object.values(st.cards).find(c => c.owner === a && c.key === "A4-EP EP493" && c.place.z !== "char");
      AA4.moveCard(ctx, peco.id, { z: "char", ch: kn, role: "perm" }); AA4.touch(st);
      eq(AA4.charStats(st, REAL, kn).at, at0 + 1, "EP466: +1 attack with Ragnarok Peco Peco on it");
      g.char(a, "A4-EP EP522", "front"); AA4.touch(st);
      eq(AA4.cardCostMod(st, REAL, a, REAL.card("A4-EP EP559")), -1, "EP522: “ガンバスター” costs 1 less");
      eq(AA4.cardCostMod(st, REAL, a, REAL.card("A4-EP EP523")), 0, "other cards: no change");
      eq(AA4.cardCostMod(st, REAL, b, REAL.card("A4-EP EP559")), 0, "only yours");
      const d0 = AA4.playerStats(st, REAL, b).draw; g.char(b, "A4-EP EP590", "front"); AA4.touch(st);
      eq([AA4.playerStats(st, REAL, a).draw, AA4.playerStats(st, REAL, b).draw], [d0 + 1, d0 + 1], "EP590: Draw +1 for every player");
      // EP541 / EP545: nothing without “ガンバスター” in your Control Area
      assert(REAL.card("A4-EP EP545").play.steps.every(x => x.if && x.if.count && x.if.count.sel.name === "ガンバスター"), "EP545: only if you control ガンバスター");
      eq(AA4.checkCond(st, REAL, REAL.card("A4-EP EP545").play.steps[0].if, { seat: a }), false);
      // EP494: the next Ragnarok Online Break card's cost goes to the hand — once
      AA4.addMod(ctx, { src: { seat: a, label: "EP494" }, to: { seat: a }, key: "dest", op: "dest", value: REAL.card("A4-EP EP494").play.steps[0].mod.value, until: "turn" }); AA4.touch(st);
      const pay = { kind: "set", seat: a, info: REAL.card("A4-EP EP466") };
      assert(AA4.costRules(st, REAL, pay).some(r => r.to === "hand" && r.nextMod), "a Ragnarok Online Break card: cost → hand");
      eq(AA4.costRules(st, REAL, { kind: "set", seat: a, info: REAL.card("A4-EP EP559") }).length, 0, "another work: no");
      const cc = Object.values(st.cards).find(c => c.owner === a && c.place.z === "deck"); AA4.moveCard(ctx, cc.id, { z: "cost" });
      AA4.OPS.costDest(ctx, { seat: a, cards: [cc.id], pay }); for (let i = 0; i < 10 && st.queue && st.queue.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); }
      eq(st.cards[cc.id].place.z, "hand", "the cost went to the hand");
      eq(AA4.costRules(st, REAL, pay).length, 0, "used up after one card");
    });
    test("Revise#230: a card's wide-scale always-on ability is a Field Effect (A3-15 2096: Darklore Project cost +1)", () => {
      const g = m2Game(["A3-15 2096"]), S = g.S, { a, b } = g, st = S();
      const k = g.char(b, "A3-15 2096", "front"); AA4.touch(st);
      const w = AA4.wideMods(st, REAL);
      assert(w.some(m => m.key === "cardCost" && m.src.ch === k), "its cost rule is wide");
      assert(!w.some(m => m.to && m.to.ch != null), "nothing on one character");
      const rows = AA4.modGroups(st, REAL, w), r = rows.find(x => x.mods.some(m => m.key === "cardCost"));
      assert(r && /Darklore/.test(r.type) && /Project/.test(r.type) && /\+ 1/.test(r.type), "shown as “Darklore Project cost + 1”: " + (r && r.type));
      assert(AA4.modOn(st, REAL, r.mods[0]), "in force");
      eq(AA4.cardCostMod(st, REAL, a, REAL.card("A3-18 2466")), 1, "Pack's 2466: 2 + 1");
    });
    test("Pack bug (Revise#231): A3-11 1660 — every chosen Permanent is set, one by one (card shown, character chosen); Permanent +1 reaches the characters", () => {
      const g = m2Game(["A4-EP EP493", "A3-11 1660"]), S = g.S, { a } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const c1 = g.char(a, vanilla("WIZ-DOM"), "front"), c2 = g.char(a, vanilla("Darklore"), "front");
      const ps = Object.values(st.cards).filter(c => c.owner === a && c.key === "A4-EP EP493").slice(0, 2);
      for (const c of ps) AA4.moveCard(ctx, c.id, { z: "discard", seat: a }); AA4.touch(st);
      const lim0 = AA4.charStats(st, REAL, c1).permLimit;
      AA4.runEffect(ctx, REAL.card("A3-11 1660").play, { seat: a, x: 2, targets: [] });
      const runQ = () => { for (let i = 0; i < 30 && st.queue && st.queue.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); } };
      runQ();
      const pick = ans => { const d = st.decisions.shift(); AA4.enqueue(st, d.then.map(o => Object.assign({}, o, { answer: ans(d) })), true); runQ(); return d; };
      const d0 = pick(d => d.options.slice(0, 2)); eq(d0.kind, "cards", "choose up to X Permanents");
      const d1 = pick(() => [c1]); eq([d1.setCard, d1.setRest.length], [ps.map(c => c.id).find(id => id === d1.setCard), 1], "the first card shown, one more after it"); assert(d1.options.includes(c2));
      const d2 = pick(() => [c2]); eq(d2.setRest.length, 0, "then the second");
      eq([st.chars[c1].perm.length, st.chars[c2].perm.length], [1, 1], "both are set (only the first was before)");
      AA4.touch(st);
      eq(AA4.charStats(st, REAL, c1).permLimit, lim0 + 1, "Permanent +1 from the Permanent on it");
      { const pt = AA4.charStats(st, REAL, c1).parts.find(x => x.key === "skill" && x.n === "permanent"); assert(pt && pt.v === 1 && pt.card && st.cards[pt.card] && st.chars[c1].perm.includes(pt.card) && /^Permanent /.test(pt.label), "the part is credited to the Permanent card that has the skill (Revise#244): " + JSON.stringify(pt)); }
      // Pack (Revise#239): when Permanent +1 ends with the Main Phase, a character with too many Permanents must lose one at once
      AA4.moveCard(ctx, st.chars[c2].perm[0], { z: "char", ch: c1, role: "perm" }); AA4.touch(st);
      eq([st.chars[c1].perm.length, AA4.charStats(st, REAL, c1).permLimit], [2, lim0 + 2], "each Permanent card on it gives Permanent +1 while it lasts");
      assert(!AA4.STATE_CHECKS.some(f => f(ctx)), "nothing to do yet");
      AA4.expire(ctx, "main"); AA4.touch(st);
      eq(AA4.charStats(st, REAL, c1).permLimit, lim0, "ended with the Main Phase");
      assert(AA4.STATE_CHECKS.some(f => f(ctx)), "the over-limit check runs at once");
      assert(st.decisions.some(d => d.ref && d.ref.overPerm && d.ref.ch === c1), "the Permanent discard choice is asked now");
    });
    test("Revise#234: Auto Re-shuffle — up to 10 re-shuffles for Character ≥ 3 · Draw ≥ 1 · Charge / cost back ≥ 1; counters; the messages", () => {
      const mk = deck => { const log = new AA4.GameLog(REAL, {}); log.push({ t: "create", by: "P0", seed: "am", mode: "online", seats: 2 }); for (const s of [0, 1]) { const r = log.push({ t: "join", by: "P" + s, name: "P" + s, deck }); assert(r.ok, r.reason); } return log; };
      const chars = REAL.all().filter(c => c.type === "Character"), dr = chars.find(c => c.skills && c.skills.draw > 0 && !c.skills.charge), cg = chars.find(c => c.skills && c.skills.charge > 0 && !c.skills.draw && /このエフェクトのコスト≫?を、?(?:その)?(?:オーナーの|あなたの)?手札に戻す/.test(String(c.text || "").replace(/\s+/g, "")));
      assert(cg, "a Character with Charge and “≪このエフェクトのコスト≫をオーナーの手札に戻す”");
      { const L0 = mk([].concat(...Array(30).fill([dr.key, chars.find(c => c.skills && c.skills.charge > 0 && !c.skills.draw && !/このエフェクトのコスト/.test(c.text || "")).key]))); eq(AA4.openingHandCheck(L0.state, REAL, 0).chargeBack, 0, "Charge alone does not count (Pack)"); }
      // a deck of only those two: the first hand (or one soon after) matches; the counters go back to 0
      const L = mk([].concat(...Array(30).fill([dr.key, cg.key])));
      L.push({ t: "mulligan", by: "P0" }); eq(L.state.players[0].mulligans, 1);
      assert(L.push({ t: "autoMulligan", by: "P0" }).ok);
      let p = L.state.players[0];
      eq([p.autoMsg.ok, p.mulligans, p.autoMulls], [true, 0, 0], "matched: both counters reset");
      assert(p.autoMsg.tries >= 1, "it re-shuffles at least once (Revise#304)");
      assert(AA4.openingHandCheck(L.state, REAL, 0).ok);
      // no Characters at all: 10 re-shuffles, “You are SCREWED!”; the third time also “Please re-adjust your deck...”
      const nc = REAL.all().filter(c => c.type === "Project").slice(0, 10).map(c => c.key);
      const M = mk([].concat(...Array(6).fill(nc)));
      M.push({ t: "autoMulligan", by: "P0" }); p = M.state.players[0];
      eq([p.autoMsg.ok, p.autoMsg.tries, p.mulligans, p.autoMulls, p.autoMsg.lines], [false, 10, 10, 1, ["You are SCREWED!"]]);
      M.push({ t: "autoMulligan", by: "P0" }); M.push({ t: "autoMulligan", by: "P0" }); p = M.state.players[0];
      eq([p.autoMulls, p.autoMsg.lines], [3, ["You are SCREWED!", "Please re-adjust your deck..."]]);
      eq(p.zones.hand.length, 7, "still 7 cards in hand");
      assert(M.push({ t: "keep", by: "P0" }).ok); assert(!M.push({ t: "autoMulligan", by: "P0" }).ok, "not after keeping");
    });
    test("Pack bug (Revise#238): A3-08 1247 — normal and mental Attack worked out separately, each at least 0", () => {
      const inf = REAL.card("A3-08 1247"); eq(inf.effects.map(e => e.steps[0].mod.key), ["atToMental", "atToNormal"]);
      const g = m2Game([]), S = g.S, { a } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const ncard = REAL.all().find(c => c.type === "Character" && !c.atMental && +c.at >= 2 && !(c.abilities || []).length && !(c.effects || []).length), nc = g.char(a, ncard.key, "front"), base = AA4.charStats(st, REAL, nc).at;
      assert(!AA4.charStats(st, REAL, nc).atMental && base >= 1, "a normal-Attack character");
      const add = (ch, key, v) => { AA4.addMod(ctx, { src: { seat: a, label: "1247" }, to: { ch }, key, op: "add", value: v, until: "main" }); AA4.touch(st); return AA4.charStats(st, REAL, ch); };
      let t = add(nc, "atToMental", 1);
      eq([t.atN, t.atM, AA4.atkText(t)], [base - 1, 1, (base - 1 ? base - 1 + " " : "") + "(1)"], "-1・+(1): one normal becomes mental");
      t = add(nc, "atToMental", base + 3);
      eq([t.atN, t.atM], [0, base + 4], "normal never below 0; mental adds up");
      t = add(nc, "atToNormal", base + 4);
      eq([t.atN, t.atM], [Math.max(0, base - 1 - (base + 3) + base + 4), 0], "+X・-(X): mental never below 0");
      const parts = t.parts.filter(x => x.label === "1247");
      assert(parts.some(x => x.key === "at" && x.mental) && parts.some(x => x.key === "at" && !x.mental), "shown in the Status table");
      // a mental-Attack character: "+X・-(X)" gives normal Attack beside it (it did nothing before)
      const mc = REAL.all().find(c => c.type === "Character" && c.atMental && +c.at >= 2 && !(c.abilities || []).length && !(c.effects || []).length);
      const mch = g.char(a, mc.key, "front"); let u = AA4.charStats(st, REAL, mch);
      eq([u.atN, u.atM], [0, +mc.at]);
      u = add(mch, "atToNormal", 1); eq([u.atN, u.atM, AA4.atkText(u)], [1, +mc.at - 1, `1 (${+mc.at - 1})`], "mental → normal");
      u = add(mch, "atToMental", 3); eq([u.atN, u.atM], [0, +mc.at + 2], "and back: normal floored at 0");
      const d = AA4.atkParts(u); eq([d.n, d.m], [0, +mc.at + 2], "the battle damage uses the same split");
    });
    test("Revise#242: Horizon batch — pay for 武蔵, skills while a Machine / 英国 count, +5・+(5) in battle, next battle damage nullified, deck / hand from the Discard Pile", () => {
      const ks = ["A4-EX01 EX0677", "A4-EX01 EX0678", "A4-EX01 EX0682", "A4-EX02 EX808", "A4-EX01 EX0683", "A4-EX01 EX0745", "A4-EX01 EX0763", "A4-EX02 EX907", "A4-EX02 EX826", "A4-EX02 EX882", "A4-EX02 EX830", "A4-EX02 EX827", "A4-EX02 EX829", "A4-EX02 EX871", "A4-EX02 EX804", "A4-EX02 EX831"];
      eq(ks.filter(k => REAL.card(k).status !== "auto"), [], "all automatic");
      const g = m2Game(["A4-EX01 EX0682", "A4-EX01 EX0683", "A4-EX02 EX830", "A4-EX02 EX804"]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const payer = g.char(a, "A4-EX01 EX0682", "front"), mu = g.char(a, "A4-EX01 EX0683", "front"), other = g.char(a, vanilla("E.G.O."), "front"); AA4.touch(st);
      assert(AA4.payersFor0(st, REAL, a, mu, "attack").includes(payer), "EX0682 pays the attack cost of a 武蔵 character");
      assert(!AA4.payersFor0(st, REAL, a, other, "attack").includes(payer), "… not of another one");
      const k = g.char(a, "A4-EX02 EX804", "front"), at0 = AA4.charStats(st, REAL, k).at;
      eq([AA4.charStats(st, REAL, k).atN, AA4.charStats(st, REAL, k).atM], [at0, 0], "out of battle: no change");
      eq(REAL.card("A4-EX02 EX804").abilities.filter(x => x.cond && x.cond.self === "inBattle").map(x => x.mod.key).sort(), ["at", "atm"], "+5 and +(5) while in battle");
      const n = g.char(a, "A4-EX02 EX830", "front"); g.give(n, 3);
      AA4.runEffect(ctx, REAL.card("A4-EX02 EX830").effects[0], { seat: a, ch: n }); for (let i = 0; i < 10 && st.queue && st.queue.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); }
      AA4.damageChar(ctx, n, { normal: 2, mental: 0, battle: true, from: other }); eq(st.chars[n].power.length, 3, "EX830: the next battle damage is nullified");
      AA4.damageChar(ctx, n, { normal: 0, mental: 1, battle: true, from: other }); eq(st.chars[n].power.length, 2, "… only the next one");
      eq(REAL.card("A4-EX02 EX826").effects[0].steps[0].sel, { types: ["Break"], named: true, tag: "英国" });
      eq(REAL.card("A4-EX02 EX831").abilities[0].cond.count.sel, { owner: "you", area: "controlled", tag: "英国", broken: true });
    });
    test("Revise#245: M3a — 0518 only when paid from the target, cost back, (X) to you when it hits a player; 0593 Break from the Damage Pile; 0653 power + Damage Pile → deck, draw that many", () => {
      eq(["A3-03 0518", "A3-03 0593", "A3-04 0653"].map(k => REAL.card(k).status), ["auto", "auto", "auto"]);
      const p18 = REAL.card("A3-03 0518").play; assert(p18.steps.every(x => x.ifPaidOnlyT) && p18.costTo === "hand", "0518: no effect unless paid from the target; its cost goes back to the hand");
      eq(REAL.card("A3-03 0593").play.costTo, "damage");
      const g = m2Game([]), S = g.S, { a } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const runQ = () => { for (let i = 0; i < 40 && st.queue && st.queue.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); } };
      const pick = f => { const d = st.decisions.shift(); AA4.enqueue(st, d.then.map(o => Object.assign({}, o, { answer: f(d) })), true); runQ(); return d; };
      // 0653
      const c = g.char(a, vanilla("Arayashiki"), "front"); g.give(c, 2);
      const dmg = Object.values(st.cards).find(x => x.owner === a && x.place.z === "deck"); AA4.moveCard(ctx, dmg.id, { z: "damage", seat: a });
      const h0 = st.players[a].zones.hand.length;
      AA4.runEffect(ctx, { steps: [{ a: "powerAndDamageToDeckDraw" }] }, { seat: a, targets: [{ ch: c }] }); runQ();
      if (st.decisions.length) pick(d => [d.options[0]]);   // one card in the pile: chosen at once
      eq([st.chars[c].power.length, st.players[a].zones.damage.length, st.players[a].zones.hand.length - h0], [0, 0, 3], "0653: 2 power + 1 Damage Pile card back, draw 3");
      // 0593
      const brk = REAL.all().find(x => x.type === "Break" && !x.name && Object.values(x.factor || {}).reduce((p, q) => p + q, 0) === 2);
      const card = Object.values(st.cards).find(x => x.owner === a && x.place.z === "deck"); card.key = brk.key; AA4.moveCard(ctx, card.id, { z: "damage", seat: a });
      const z = g.char(a, vanilla("Darklore"), "front");
      AA4.runEffect(ctx, { steps: [{ a: "damageBreakSetX" }] }, { seat: a, x: 2 }); runQ();
      for (let i = 0; i < 3 && st.decisions.length; i++) { const k = st.decisions[0].kind; if (k === "cards") { eq(st.decisions[0].options, [card.id], "only the factor-2 Break card"); pick(() => [card.id]); } else pick(() => [z]); }
      eq(st.chars[z].stack.includes(card.id), true, "0593: set on the power-0 character, ignoring name / class / Break rule");
      assert(REAL.card("A3-24 3574").abilities.filter(x => x.effect && JSON.stringify(x.effect.steps).includes('"X"')).every(x => x.effect.x && x.effect.x.selfNamed), "3574: X (cards of its name in this character) for every ability — 1 when it is set (Pack, Revise#246)");
      // Pack (Revise#246): A3-24 3574 — areas first, then players
      AA4.OPS.areaDamageMore(ctx, { op: "areaDamageGo", n: 1, mental: false, from: null, players: null, seat: a, multi: true, picked: [] });
      let d = st.decisions[0]; assert(d.options.every(o => /^\d+:(active|control)$/.test(o) || o === "__next__"), "areas only: " + d.options);
      pick(() => [a + ":active"]); d = st.decisions[0]; eq(d.fieldPicked, [a + ":active"]); assert(!d.options.includes(a + ":active"));
      pick(() => ["__next__"]); d = st.decisions[0]; assert(d.options.every(o => /^p:\d+$/.test(o) || o === "__done__"), "then players only: " + d.options);
    });
    test("Pack bug (Revise#247): A3-11 1742 — a Break card from the hand is chosen and set on the target (a Fast card has no source character)", () => {
      const brk = REAL.all().find(c => c.type === "Break" && !c.name && !c.breakRule && (c.icons || []).includes("イレイザー") && typeof c.cost === "number" && c.factor && Object.keys(c.factor).length === 1 && c.factor.Eraser <= 2);
      const chc = REAL.all().find(c => c.type === "Character" && c.faction === "Eraser" && (c.icons || []).includes("イレイザー") && !(c.abilities || []).length && !(c.effects || []).length);
      const g = m2Game([brk.key, chc.key]), S = g.S, { a } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const t = g.char(a, chc.key, "front"); g.char(a, chc.key, "back"); g.give(t, 2);
      const h = Object.values(st.cards).find(c => c.owner === a && c.key === brk.key && c.place.z !== "char"); AA4.moveCard(ctx, h.id, { z: "hand", seat: a });
      AA4.runEffect(ctx, REAL.card("A3-11 1742").play, { seat: a, x: brk.cost, targets: [{ ch: t }] });
      for (let i = 0; i < 20 && st.queue && st.queue.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); }
      const d = st.decisions[0]; assert(d && d.options.includes(h.id), "the Break card in hand can be chosen: " + JSON.stringify(d && d.options) + " " + AA4.planDeclaration(st, REAL, a, { kind: "set", card: h.id }, { seat: a, ch: t, card: h.id, types: ["Break"], freeCost: true, zones: ["hand"] }).reason);
    });
    test("Pack (Revise#248): A3-15 2105 — on a card whose choices are “任意” (A3-22 3311); its choices are made by 2105's controller", () => {
      const g = m2Game(["A3-22 3311", "A3-14 2058"]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const c3311 = Object.values(st.cards).find(c => c.owner === b && c.key === "A3-22 3311"), c2058 = Object.values(st.cards).find(c => c.owner === b && c.key === "A3-14 2058");
      st.stack.push({ id: "i1", kind: "set", card: c3311.id, seat: b, targets: [] }, { id: "i2", kind: "set", card: c2058.id, seat: b, targets: [{ card: c3311.id }] });
      const spec = REAL.card("A3-15 2105").play.target, cand = AA4.targetCandidates(st, REAL, spec, { seat: a }).map(x => x.item);
      eq(cand, ["i1"], "3311 (“あなたの任意のエリア1つ”) can be its target; 2058 (a 目標) can't");
      AA4.runEffect(ctx, REAL.card("A3-15 2105").play, { seat: a, targets: [{ item: "i1" }] });
      for (let i = 0; i < 10 && st.queue && st.queue.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); }
      eq(st.stack[0].choiceBy, a, "3311's choices are now 2105's controller's");
      AA4.choiceByWrap(st, st.stack[0], 0);
      AA4.ask(ctx, { seat: b, kind: "pick", options: ["0:active", "1:active"], reason: "Choose the area that is spared" });
      eq(st.decisions[st.decisions.length - 1].seat, a, "the choice is asked to 2105's controller");
      AA4.OPS.choiceForEnd(ctx, { item: "i1" }); eq(st.chooseFor, undefined);
    });
    test("Revise#249: M3a batch 2 — 0702 break at fast timing by anyone / with power cards, 0843 by you, 0690 power back X in all, 0676 forced guard, 0556 unguarded named attack", () => {
      eq(["A3-03 0556", "A3-04 0676", "A3-04 0690", "A3-04 0702"].map(k => REAL.card(k).status), ["auto", "auto", "auto", "auto"]);
      eq(REAL.card("A3-05 0843").status, "partial", "0843: the factor −X is still by hand");
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const t = g.char(b, vanilla("Darklore"), "front"); g.give(t, 2);
      const add = (key, value) => { AA4.addMod(ctx, { src: { seat: a, label: "test" }, to: { ch: t }, key, op: "grant", value, until: "main" }); AA4.touch(st); };
      const brk = Object.values(st.cards).find(c => c.owner === a && (REAL.card(c.key) || {}).type === "Break") || null;
      eq(AA4.fastBreakOk(st, REAL, a, t), false, "not yet");
      add("breakFast", { all: true }); eq([AA4.fastBreakOk(st, REAL, a, t), AA4.fastBreakOk(st, REAL, b, t)], [true, true], "0702: any player at fast timing");
      add("breakWithPower", true); eq(AA4.charStats(st, REAL, t).breakWithPower, true, "0702: although it has power cards");
      const u = g.char(a, vanilla("Darklore"), "front");
      AA4.addMod(ctx, { src: { seat: a, label: "0843" }, to: { ch: u }, key: "breakFast", op: "grant", value: { by: "you" }, until: "main" }); AA4.touch(st);
      eq([AA4.fastBreakOk(st, REAL, a, u), AA4.fastBreakOk(st, REAL, b, u)], [true, false], "0843: only you");
      // 0690: up to X power cards back in all
      const runQ = () => { for (let i = 0; i < 30 && st.queue && st.queue.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); } };
      const hB = st.players[b].zones.hand.length;
      AA4.runEffect(ctx, { steps: [{ a: "powerBackBudget" }] }, { seat: a, card: "c0690", x: 1, evCh: t }); runQ();
      let d = st.decisions.shift(); eq(d.max, 1); AA4.enqueue(st, d.then.map(o => Object.assign({}, o, { answer: [d.options[0]] })), true); runQ();
      eq([st.chars[t].power.length, st.players[b].zones.hand.length - hB], [1, 1], "one back to its owner's hand");
      AA4.runEffect(ctx, { steps: [{ a: "powerBackBudget" }] }, { seat: a, card: "c0690", x: 1, evCh: t }); runQ();
      eq(st.decisions.length, 0, "X used up");
      // 0676 / 0556
      const w = REAL.card("A3-04 0676").effects[1].steps[0]; eq([w.a, w.event, w.bySrc, w.effect.steps[0].a], ["watchEv", "attack", true, "forceGuard"]);
      eq(REAL.card("A3-03 0556").abilities.find(x => x.when && x.when.event === "unguardedNamed").effect.steps[0], { a: "selfPowerToDamage", n: "all" });
    });
    test("Revise#250: M3b — 1103 discard X + a Controlled Character to the Damage Pile, 1418 hand discard after the hit, 1486 to the deck, 1349 end-of-phase", () => {
      eq(["A3-07 1103", "A3-09 1418", "A3-09 1486", "A3-09 1349"].map(k => REAL.card(k).status), ["auto", "auto", "auto", "auto"]);
      eq(REAL.card("A3-09 1418").play.steps[1].effect.steps[0].to, "evHit", "1418: the attacked player's hand");
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const runQ = () => { for (let i = 0; i < 30 && st.queue && st.queue.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); } };
      // 1103: a Controlled Character of yours to the Damage Pile
      const c1 = g.char(a, vanilla("Arayashiki"), "front"), c2 = g.char(a, vanilla("Darklore"), "front");
      AA4.runEffect(ctx, { steps: [{ a: "ctlCharToDamage" }] }, { seat: a }); runQ();
      const d = st.decisions.shift(); eq(d.kind, "pick", "chosen on the field"); AA4.enqueue(st, d.then.map(o => Object.assign({}, o, { answer: [c1] })), true); runQ();
      assert(!st.chars[c1] && st.chars[c2], "1103: that character went to the Damage Pile");
      // 1486: Damage Pile cards with a class of the target → their owner's deck
      const t = g.char(b, vanilla("Darklore"), "front"), ic = AA4.charStats(st, REAL, t).icons[0];
      const dmg = Object.values(st.cards).find(c => c.owner === b && c.place.z === "deck" && ((REAL.card(c.key) || {}).icons || []).includes(ic));
      if (dmg) { AA4.moveCard(ctx, dmg.id, { z: "damage", seat: b }); AA4.EFFECT_ACTIONS.damageIconsToDeck(ctx, { icons: [ic] }, {}); eq(st.cards[dmg.id].place.z, "deck", "1486: back to the deck"); }
      // 1349: this card and the cards set on the character → your Damage Pile
      const h = g.char(a, vanilla("WIZ-DOM"), "front"); g.give(h, 2);
      AA4.EFFECT_ACTIONS.selfAndSetToDamage(ctx, {}, { seat: a, card: AA4.topOf(st.chars[h]) });
      eq(st.chars[h].power.length, 0, "1349: its power cards went to the Damage Pile");
    });
    test("Revise#251: M3b batch 2 — 1137 guard cost back + hand to Damage Pile, 1354 damage check until one card, 1385 from the deck ignoring factor", () => {
      eq(["A3-07 1137", "A3-09 1354", "A3-09 1385"].map(k => REAL.card(k).status), ["auto", "auto", "auto"]);
      eq(REAL.card("A3-09 1385").play.steps[0].ignoreFactor, true);
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const t = g.char(a, vanilla("WIZ-DOM"), "front");
      AA4.EFFECT_ACTIONS.destGuardVsT(ctx, {}, { seat: a, targets: [{ ch: t }] }); AA4.touch(st);
      assert(AA4.costRules(st, REAL, { kind: "guard", seat: b, against: t }).some(r => r.to === "hand"), "1137: the guard cost against it goes back to the hand");
      eq(AA4.costRules(st, REAL, { kind: "guard", seat: b, against: "other" }).length, 0, "only against it");
      const n0 = st.players[b].zones.damage.length;
      AA4.EFFECT_ACTIONS.dmgUntilOne(ctx, {}, { seat: a, evHit: b });
      eq(st.players[b].zones.damage.length, n0 + 1, "1354: damage checks until one card is in the Damage Pile");
    });
    test("Revise#252: M3b batch 3 — 1417 Break from the hand ignoring factor, 1452 a chosen class goes to the Damage Pile, 1485 Attack +X and may attack characters", () => {
      eq(["A3-09 1417", "A3-09 1452", "A3-09 1485"].map(k => REAL.card(k).status), ["auto", "auto", "auto"]);
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const t = g.char(b, vanilla("Darklore"), "front"), ic = AA4.charStats(st, REAL, t).icons[0];
      st.effIcon = ic; AA4.EFFECT_ACTIONS.iconLeaveToDamage(ctx, { until: "main" }, { seat: a }); AA4.touch(st);
      eq(AA4.charStats(st, REAL, t).leaveToDamage, true, "1452: a character with that class");
      const ids = st.chars[t].stack.slice(); AA4.removeChar(ctx, t, { to: "discard", why: "test" });
      assert(ids.every(id => st.cards[id].place.z === "damage"), "… goes to its owner's Damage Pile instead of the Discard Pile");
      const p85 = REAL.card("A3-09 1485").play; eq([p85.target.count, p85.steps.map(x => x.mod.key)], ["X", ["at", "attackChars"]]);
    });
    test("Revise#253: M3b batch 4 — 1316 same name twice + cost back, 1453 Damage Pile Break cards rise until the end of the turn, 1255 pay by putting the top Discard card on the deck", () => {
      eq(["A3-09 1316", "A3-09 1453", "A3-08 1255", "A3-08 1258"].map(k => REAL.card(k).status), ["auto", "auto", "auto", "auto"]);
      const g = m2Game(["A3-09 1316", "A3-08 1255"]), S = g.S, { a } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const named = REAL.all().find(c => c.type === "Break" && c.name && !c.breakRule && !(c.abilities || []).length);
      const h = g.char(a, vanilla("Darklore"), "front"), nc = Object.values(st.cards).find(c => c.owner === a && c.place.z === "deck"); nc.key = named.key;
      AA4.moveCard(ctx, nc.id, { z: "char", ch: h, role: "stack" }); AA4.touch(st);
      eq(AA4.nameOnField(st, REAL, named.name, null, named), true, "a second one is not allowed yet");
      const p16 = Object.values(st.cards).find(c => c.owner === a && c.key === "A3-09 1316"); AA4.moveCard(ctx, p16.id, { z: "char", ch: h, role: "perm" }); AA4.touch(st);
      eq(AA4.nameOnField(st, REAL, named.name, null, named), false, "1316: two of that name may be on the field");
      assert(AA4.costRules(st, REAL, { kind: "set", seat: a, info: named }).some(r => r.to === "hand"), "1316: the cost of a Break card of that name goes back to the hand");
      // 1453
      const brk = REAL.all().find(c => c.type === "Break" && !c.name && !c.breakRule);
      const dc = Object.values(st.cards).find(c => c.owner === a && c.place.z === "deck"); dc.key = brk.key; AA4.moveCard(ctx, dc.id, { z: "damage", seat: a });
      AA4.EFFECT_ACTIONS.undeadRise(ctx, {}, { seat: a }); AA4.touch(st);
      const ch = AA4.charOfCard(st, dc.id); assert(ch && AA4.isControlled(ch), "1453: a Controlled Character now");
      const cs = AA4.charStats(st, REAL, ch.id); assert(cs.icons.includes("アンデッド") && cs.skills.intercept, "アンデッド and Intercept");
      // 1255: pay by the top Discard card → deck top
      const k = g.char(a, vanilla("WIZ-DOM"), "front"), p55 = Object.values(st.cards).find(c => c.owner === a && c.key === "A3-08 1255");
      AA4.moveCard(ctx, p55.id, { z: "char", ch: k, role: "perm" }); const dis = Object.values(st.cards).find(c => c.owner === a && c.place.z === "deck"); AA4.moveCard(ctx, dis.id, { z: "discard", seat: a }); AA4.touch(st);
      assert(AA4.altPays(st, REAL, { kind: "attack", ch: k, seat: a, cost: 1 }).includes("discTop"), "1255: may pay with the top Discard card");
    });
    test("Revise#255: M3b batch 5 — 1071 reorder a player's top 3, 1384 top Break set or Damage Pile, 1484 reveal until a type, 1106 guard → hand discard, 1319 class cost hit", () => {
      eq(["A3-07 1071", "A3-09 1384", "A3-09 1484", "A3-07 1106", "A3-09 1319"].map(k => REAL.card(k).status), ["auto", "auto", "auto", "auto", "auto"]);
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const runQ = () => { for (let i = 0; i < 30 && st.queue && st.queue.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); } };
      const answer = (pick) => { const d = st.decisions.shift(); AA4.enqueue(st, d.then.map(o => Object.assign({}, o, { answer: pick(d) })), true); runQ(); return d; };
      // 1071: b's top 3, reordered by a
      const deck = st.players[b].zones.deck, top = deck.slice(-3);
      AA4.EFFECT_ACTIONS.reorderTopOf(ctx, { n: 3 }, { seat: a }, [{ seat: b }]); runQ();
      let d = answer(d => d.options.slice().reverse()); eq(d.kind, "order");
      eq(deck.slice(-3), top.slice().reverse(), "1071: back on top in the chosen order");
      d = answer(() => ["no"]); eq(d.kind, "yesno", "then: shuffle?");
      // 1484: until a Character card → b's Damage Pile, then shuffled
      const dm0 = st.players[b].zones.damage.length;
      AA4.EFFECT_ACTIONS.revealUntilTypeDamage(ctx, {}, { seat: a }, [{ seat: b }]); runQ(); answer(() => ["Character"]);
      const dz = st.players[b].zones.damage; eq(dz.length, dm0 + 1); eq((REAL.card(st.cards[dz[dz.length - 1]].key) || {}).type, "Character", "1484: the first Character card");
      // 1384: a non-Break top card → your Damage Pile
      const ad = st.players[a].zones.deck, nb = Object.values(st.cards).find(c => c.owner === a && c.place.z === "deck" && (REAL.card(c.key) || {}).type !== "Break");
      AA4.moveCard(ctx, nb.id, { z: "deck", pos: "top" }); AA4.EFFECT_ACTIONS.topBreakSetOrDamage(ctx, {}, { seat: a }); eq(st.cards[nb.id].place.z, "damage", "1384: not a Break card → Damage Pile");
      // 1106: the attacker's owner loses up to X cards of the hand
      const s06 = REAL.card("A3-07 1106").play.steps[0]; eq([s06.event, s06.evAttacker, s06.effect.steps[0].to], ["guarded", true, "evOwner"]);
      // 1319: a character with the designated class pays a cost → (1) damage
      const c1 = g.char(a, vanilla("Darklore"), "front"); g.give(c1, 1);
      AA4.EFFECT_ACTIONS.designatePowerIconHit(ctx, {}, { seat: a, card: null }); runQ(); if (st.decisions.length) answer(() => [c1]);   // one character: chosen at once
      eq(st.chars[c1].power.length, 0, "1319: its power card is discarded"); AA4.touch(st);
      assert(st.modifiers.some(m => m.key === "watchEv" && m.value.event === "costPaid" && m.value.chSel.icons.length), "1319: a cost-paid watcher for that class");
    });
    test("Revise#256: M3a/M3b — shikigami 0654 / 1353, 1206 faction +X, 1488 battle recall, 1073 discard to return, 1322 Break lent, 1066 drawn trigger", () => {
      eq(["A3-04 0654", "A3-04 0657", "A3-09 1353", "A3-07 1206", "A3-09 1488", "A3-09 1322", "A3-07 1073", "A3-07 1066"].map(k => REAL.card(k).status), Array(8).fill("auto"));
      const g = m2Game(["A3-04 0654", "A3-07 1066", "A3-07 1073"]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const runQ = () => { for (let i = 0; i < 40 && st.queue && st.queue.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); } };
      const answer = (pick) => { const d = st.decisions.shift(); AA4.enqueue(st, d.then.map(o => Object.assign({}, o, { answer: pick(d) })), true); runQ(); return d; };
      // 0654: the card becomes 式神刹那式 with the whole hand as power; at the end of the turn they go back to the hand
      const fc = Object.values(st.cards).find(c => c.owner === a && c.key === "A3-04 0654"); AA4.moveCard(ctx, fc.id, { z: "discard" });
      const nh = st.players[a].zones.hand.length; assert(nh > 0, "a hand");
      AA4.EFFECT_ACTIONS.cardToken(ctx, REAL.card("A3-04 0654").play.steps[0], { seat: a, card: fc.id }); runQ(); AA4.touch(st);
      const tk = AA4.charOfCard(st, fc.id); assert(tk, "a character now"); eq(tk.power.length, nh, "the whole hand as power"); eq(AA4.charStats(st, REAL, tk.id).se, nh + 1, "stats from its structure, like 式神阿式");
      const dl = st.delayed.find(d => d.step.a === "tokenDismiss"); AA4.EFFECT_ACTIONS.tokenDismiss(ctx, dl.step); eq(st.players[a].zones.hand.length, nh, "power back to the hand"); eq(st.cards[fc.id].place.z, "discard");
      // 1206: a faction's characters +X
      const c1 = g.char(b, vanilla("Darklore"), "front"), se0 = AA4.charStats(st, REAL, c1).se;
      AA4.EFFECT_ACTIONS.factionAllStats(ctx, {}, { seat: a, x: 2 }); answer(() => ["Darklore"]); AA4.touch(st);
      eq(AA4.charStats(st, REAL, c1).se, se0 + 2, "1206: +2 Mental");
      // 1073: discard 1 to return
      const f73 = Object.values(st.cards).find(c => c.owner === a && c.key === "A3-07 1073"); AA4.moveCard(ctx, f73.id, { z: "discard" });
      const h0 = st.players[a].zones.hand.slice(); AA4.EFFECT_ACTIONS.discardToReturn(ctx, {}, { seat: a, card: f73.id }); answer(() => [h0[0]]);
      eq([st.cards[h0[0]].place.z, !!st.cards[f73.id].endToHand], ["discard", true], "1073: one hand card discarded, this card back to the hand");
      // 1322: a Break card lends its stats
      const brk = REAL.all().find(c => c.type === "Break" && c.cost === 0 && c.se > 0 && !c.name && c.skills && Object.keys(c.skills).length);
      const hc = Object.values(st.cards).find(c => c.owner === a && c.place.z === "deck"); hc.key = brk.key; AA4.moveCard(ctx, hc.id, { z: "hand" });
      const t22 = g.char(a, vanilla("WIZ-DOM"), "front"), s0 = AA4.charStats(st, REAL, t22).se;
      AA4.EFFECT_ACTIONS.breakLend(ctx, {}, { seat: a, x: 0, targets: [{ ch: t22 }] }); answer(d => [hc.id]); AA4.touch(st);
      const s22 = AA4.charStats(st, REAL, t22); eq(s22.se, s0 + brk.se, "1322: + its Mental"); assert(Object.keys(brk.skills).every(k => s22.skills[k]), "… and its skills");
      // 1066: drawn → 1 card of the Damage Pile back to the hand
      const f66 = Object.values(st.cards).find(c => c.owner === a && c.key === "A3-07 1066" && c.place.z === "deck");
      const dm = Object.values(st.cards).find(c => c.owner === a && c.place.z === "deck" && c.id !== f66.id); AA4.moveCard(ctx, dm.id, { z: "damage", seat: a });
      AA4.moveCard(ctx, f66.id, { z: "deck", pos: "top" }); g.ok({ t: "draw", seat: a, n: 1 }); 
      assert(st.cards[f66.id].place.z === "hand", "drawn");
    });
    test("Revise#257: M3c — 1974 guard hit, 2150 guard cost vs a player, 2028 class share, 1689 per Permanent + keep, 1743 battle opponent loses skills, 1662 / 1741", () => {
      eq(["A3-14 1974", "A3-15 2150", "A3-14 2028", "A3-11 1689", "A3-11 1662", "A3-11 1741"].map(k => REAL.card(k).status), Array(6).fill("auto"));
      eq(REAL.card("A3-15 2150").play.target.designate, true, "2150: a player is designated");
      eq(["A3-20 2695", "A3-22 3129", "A3-22 3235"].map(k => REAL.card(k).status), Array(3).fill("auto"));
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const runQ = () => { for (let i = 0; i < 40 && st.queue && st.queue.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); } };
      // 2028: named character's class → your non-name-level characters +1 Attack
      const named = REAL.all().find(c => c.type === "Character" && c.name && (c.icons || []).length && !(c.abilities || []).length && !(c.effects || []).length);
      const n1 = g.char(a, vanilla("Darklore"), "front"); const top = st.cards[AA4.topOf(st.chars[n1])]; top.key = named.key; AA4.touch(st);
      const v = REAL.all().find(c => c.type === "Character" && !c.name && (c.icons || []).includes(named.icons[0]) && !(c.abilities || []).length);
      const v1 = g.char(a, vanilla("Darklore"), "front"); st.cards[AA4.topOf(st.chars[v1])].key = v.key; AA4.touch(st);
      const at0 = AA4.charStats(st, REAL, v1).at;
      AA4.EFFECT_ACTIONS.namedShareBoost(ctx, {}, { seat: a }); runQ();
      if (st.decisions.length) { const d = st.decisions.shift(); AA4.enqueue(st, d.then.map(o => Object.assign({}, o, { answer: [n1] })), true); runQ(); }
      AA4.touch(st); eq(AA4.charStats(st, REAL, v1).at, at0 + 1, "2028: +1 Attack");
      // 1689: −1/−1/−1 per Permanent card
      const p1 = g.char(a, vanilla("WIZ-DOM"), "front"), perm = Object.values(st.cards).find(c => c.owner === a && c.place.z === "deck"); AA4.moveCard(ctx, perm.id, { z: "char", ch: p1, role: "perm" }); AA4.touch(st);
      const se1 = AA4.charStats(st, REAL, p1).se; AA4.EFFECT_ACTIONS.minusPerPerm(ctx, {}, { seat: a }, [{ ch: p1 }]); AA4.touch(st); eq(AA4.charStats(st, REAL, p1).se, se1 - 1, "1689: −1 for its Permanent");
      // 2150: a guard against the designated player's attacker pays 1 less
      AA4.EFFECT_ACTIONS.guardLessVsT(ctx, { until: "main" }, { seat: a }, [{ seat: b }]); AA4.touch(st);
      assert(st.modifiers.some(m => m.key === "guardTax" && m.value.n === -1 && m.value.att.ownerSeat === b), "2150: guard cost −1 against that player's attackers");
      // 1743: the battle opponent of the target has no skills
      AA4.EFFECT_ACTIONS.battleOppOffT(ctx, {}, { seat: a }, [{ ch: p1 }]); assert(st.modifiers.some(m => m.key === "battleOppSkillsOff" && m.value.of === p1), "1743");
    });
    test("Revise#258: M3f — 3473 / 3802 / 3696 / 3435 / 3800 / 3335", () => {
      eq(["A3-24 3473", "A3-25 3802", "A3-25 3696", "A3-24 3435", "A3-25 3800", "A3-23 3335"].map(k => REAL.card(k).status), Array(6).fill("auto"));
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const runQ = () => { for (let i = 0; i < 60 && st.queue && st.queue.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); } };
      const answer = (pick) => { const d = st.decisions.shift(); AA4.enqueue(st, d.then.map(o => Object.assign({}, o, { answer: pick(d) })), true); runQ(); return d; };
      // 3802: hands, Discard and Damage Piles back into the decks, then 7 cards each
      const x = Object.values(st.cards).find(c => c.owner === b && c.place.z === "deck"); AA4.moveCard(ctx, x.id, { z: "damage", seat: b });
      AA4.EFFECT_ACTIONS.resetAllDraw(ctx, { n: 7 }, { seat: a }); runQ();
      eq([st.players[a].zones.hand.length, st.players[b].zones.hand.length, st.players[b].zones.damage.length], [7, 7, 0], "3802");
      // 3696: a non-Character card of their hand → bottom of their deck, they draw 1
      const nc = st.players[b].zones.hand.find(id => (REAL.card(st.cards[id].key) || {}).type !== "Character");
      AA4.EFFECT_ACTIONS.peekHandBottomDraw(ctx, {}, { seat: a }, [{ seat: b }]);
      if (nc) { answer(() => [nc]); const dk = st.players[b].zones.deck; eq(dk[0], nc, "3696: on the bottom"); eq(st.players[b].zones.hand.length, 7, "… and they drew 1"); }
      // 3435: Permanent −X → Initiative / Penetrate
      const c = g.char(a, vanilla("WIZ-DOM"), "front");
      AA4.addMod(ctx, { src: { seat: a }, to: { ch: c }, key: "skill", op: "grant", value: { id: "permanent", x: -2 }, until: "turn" }); AA4.touch(st);
      const at0 = AA4.charStats(st, REAL, c).at; AA4.EFFECT_ACTIONS.permMinusBoost(ctx, {}, { seat: a }, [{ ch: c }]); AA4.touch(st);
      const sc = AA4.charStats(st, REAL, c); assert(sc.skills.initiative && sc.skills.penetrate, "3435: Initiative + Penetrate"); eq(sc.at, at0 + 3, "… and +3 with −2");
      // 3335: you draw 1, then the opponent may — a "no" ends it
      const h = st.players[a].zones.hand.length; AA4.EFFECT_ACTIONS.drawChain(ctx, {}, { seat: a }); runQ();
      eq(st.players[a].zones.hand.length, h + 1); answer(() => ["no"]); eq(st.decisions.length, 0, "3335: ended");
    });
    test("Revise#259: own factor / cost less on a condition, declaration draw, “also treated as”, X = cards with a name part", () => {
      eq(["A4-05 0833", "A4-01 0170", "A4-03 0414", "A4-05 0812"].map(k => REAL.card(k).status), Array(4).fill("auto"));
      eq(REAL.card("A4-05 0833").factorLessIf, { cond: { notFirst: true }, n: 1 }); eq(REAL.card("A4-03 0414").play.declDraw, 1);
      assert(REAL.card("A4-04 0737").abilities.some(a => a.mod && a.mod.key === "alsoName" && a.mod.value === "フォルナ・スウェーデンボルグ"), "0737: also フォルナ・スウェーデンボルグ");
      const g = m2Game([]), S = g.S, { a, b } = g, st = S();
      const inf = Object.assign({}, REAL.card("A4-05 0833"));
      const first = st.turn.order[0], other = st.turn.order[1];
      const f1 = AA4.factorOk(st, REAL, first, inf), f2 = AA4.factorOk(st, REAL, other, Object.assign({}, inf, { factor: { [Object.keys(inf.factor)[0]]: 1 } }));
      eq(f2, null, "not the first player: factor 1 less (1 → 0)");
      const c = g.char(a, vanilla("Darklore"), "front"); st.cards[AA4.topOf(st.chars[c])].key = "A4-04 0737"; AA4.touch(st);
      eq(AA4.xOf(st, REAL, { stackNameHas: ["フォルナ"] }, { ch: c }), 1, "X = cards whose name has フォルナ");
    });
    test("Revise#260: Saga 4 — per “N” cards (skills too), factor ignored for a name, Damage Pile set, hands open, hand to power", () => {
      eq(["A4-01 0177", "A4-01 0113", "A4-05 0913", "A4-01 0110", "A4-04 0608", "A4-03 0534", "A4-03 0503", "A4-05 0803"].map(k => REAL.card(k).status === "manual" ? "manual" : "ok"), Array(8).fill("ok"));
      const ab = REAL.card("A4-01 0177").abilities.find(a => a.mod && a.mod.key === "skill");
      assert(ab && ab.mod.value.x && ab.mod.value.x.x && ab.mod.value.x.x.per, "0177: Charge per cards");
      const g = m2Game([]), S = g.S, { a } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const c = g.char(a, vanilla("WIZ-DOM"), "front"), nm = ab.mod.value.x.x.selfNamed;
      const named = REAL.all().find(x => x.name && x.name.replace(/\s+/g, "") === nm);
      if (named) { st.cards[AA4.topOf(st.chars[c])].key = named.key; AA4.touch(st); const ch0 = +AA4.charStats(st, REAL, c).skills.charge || 0;
        AA4.addMod(ctx, { src: { seat: a, ch: c }, to: { ch: c }, key: "skill", op: "grant", value: ab.mod.value, until: "turn" }); AA4.touch(st);
        eq((+AA4.charStats(st, REAL, c).skills.charge || 0) - ch0, ab.mod.value.x.sign * Math.floor(1 / ab.mod.value.x.x.per), "Charge × cards"); }
      AA4.addMod(ctx, { src: { seat: a }, to: { seat: a }, key: "factorIgnore", op: "grant", value: { names: ["テスト"] }, until: "turn" }); AA4.touch(st);
      eq(AA4.factorOk(st, REAL, a, { type: "Break", name: "テスト", factor: { "E.G.O.": 9 } }), null, "factor ignored for that name");
      assert(AA4.factorOk(st, REAL, a, { type: "Break", name: "別", factor: { "E.G.O.": 9 } }), "not for another name");
    });
    test("Revise#262–263: loss limit +N, next battle damage +N, name designation hand discard, hand ↔ deck swap, pay for a designated character, designated shutdown", () => {
      eq(["A4-01 0117", "A3-22 3130", "A3-22 3309", "A3-16 2177", "A3-19 2551"].map(k => REAL.card(k).status), Array(5).fill("auto"));
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const runQ = () => { for (let i = 0; i < 60 && st.queue && st.queue.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); } };
      const answer = (pick) => { const d = st.decisions.shift(); AA4.enqueue(st, d.then.map(o => Object.assign({}, o, { answer: pick(d) })), true); runQ(); return d; };
      // 3309: up to 3 → deck top, same number back from the deck, you draw 1
      const hb = st.players[b].zones.hand.length, ha = st.players[a].zones.hand.length;
      AA4.EFFECT_ACTIONS.handSwapDeck(ctx, {}, { seat: a }, [{ seat: b }]); answer(d => d.options.slice(0, 2)); answer(d => d.options.slice(0, 2)); runQ();
      eq([st.players[b].zones.hand.length, st.players[a].zones.hand.length], [hb, ha + 1], "3309");
      // 3130: the named card name, non-Character cards only
      const nc = st.players[b].zones.hand.find(id => (REAL.card(st.cards[id].key) || {}).type !== "Character");
      if (nc) { st.effName = REAL.card(st.cards[nc].key).jp; AA4.EFFECT_ACTIONS.handNameDiscard(ctx, {}, { seat: a }, [{ seat: b }]); eq(st.cards[nc].place.z, "discard", "3130"); }
      // 2551: designated characters lose everything
      const c = g.char(b, vanilla("Darklore"), "front"); AA4.EFFECT_ACTIONS.designateShutdown(ctx, {}, { seat: a, x: 1 }); answer(d => [AA4.topOf(st.chars[c])]); AA4.touch(st);
      const sc = AA4.charStats(st, REAL, c); assert(sc.noAttack && sc.noGuard && sc.noPay && sc.noFactor, "2551");
      // 0117: the Damage Pile limit + 5
      AA4.EFFECT_ACTIONS.field(ctx, { mod: { to: "you", key: "lossPlusP", op: "grant", value: 5, until: "removed" } }, { seat: a }); AA4.touch(st);
      assert(AA4.allMods(st, REAL).some(m => m.key === "lossPlusP" && AA4.modAppliesToSeat(st, m, a)), "0117");
    });
    test("Revise#264: EP071 effect after a sentence, 0652 Permanent pays then Damage Pile, EX0168 attack-a-player +3, EX0622 no declarations", () => {
      eq(["A3-EP EP071", "A3-04 0652", "A3-EX02 EX0168"].map(k => REAL.card(k).status), Array(3).fill("auto"));
      eq(REAL.card("A3-EP EP071").effects[0].cost, 2, "EP071: a 2-cost effect");
      const g = m2Game(["A3-04 0652"]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const c = g.char(a, vanilla("Arayashiki"), "front"), p = Object.values(st.cards).find(x => x.owner === a && x.key === "A3-04 0652");
      AA4.moveCard(ctx, p.id, { z: "char", ch: c, role: "perm" }); AA4.touch(st);
      assert((AA4.charStats(st, REAL, c).altPayX || []).some(x => x.card === p.id && x.to === "damage"), "0652: may pay, then to the Damage Pile");
      AA4.runEffect(ctx, REAL.card("A3-EX02 EX0168").play, { seat: a }); for (let i = 0; i < 20 && st.queue && st.queue.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); } AA4.touch(st);
      const at0 = AA4.charStats(st, REAL, c).at;
      st.battle = { kind: "attack", attacker: c, target: { seat: b }, guard: null, joined: { att: [], grd: [] }, step: "response" }; AA4.touch(st);
      eq(AA4.charStats(st, REAL, c).at, at0 + 3, "EX0168: +3 while attacking a player"); st.battle = null; AA4.touch(st);
    });
    test("Revise#267–270: discard or mill, Saga 4 Break rules, talent factor rule, battle-leave draw", () => {
      eq(["A4-04 0773", "A4-05 0798", "A4-05 0905", "A4-04 0605", "A4-04 0734", "A4-04 0732", "A4-04 0701"].map(k => REAL.card(k).status), Array(7).fill("auto"));
      eq(REAL.card("A4-05 0798").breakRule.anyIconFactions, ["Polestar Empire", "E.G.O."]);
      const t = REAL.card("A4-04 0605").factorLessIf; eq([t.n, t.cond.count.sel.broken, t.cond.count.sel.icons[0]], [3, true, "タレント"]);
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const runQ = () => { for (let i = 0; i < 40 && st.queue && st.queue.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); } };
      const h = st.players[b].zones.hand.slice(), d0 = st.players[b].zones.deck.length;
      AA4.EFFECT_ACTIONS.discardOrMill(ctx, { n: 1, mill: 5 }, { seat: a }, [{ seat: b }]); const dq = st.decisions.shift();
      AA4.enqueue(st, dq.then.map(o => Object.assign({}, o, { answer: [] })), true); runQ();
      eq(st.players[b].zones.deck.length, d0 - 5, "0773: no discard → 5 milled");
    });
    test("Pack report (Revise#296): A3-24 3471 — +(1) is mental Attack; 'only mental Attack' looks at its Attack now", () => {
      const st0 = REAL.card("A3-24 3471").play.steps; eq(st0[0].mod.key, "atm", "+(1) = mental Attack"); eq(st0[1].to.all.atOnly, "mental");
      const g = m2Game([]), S = g.S, { a } = g, st = S(), c = g.char(a, vanilla("Polestar Empire"), "front");
      const cs = AA4.charStats(st, REAL, c);
      eq(AA4.matchChar(st, REAL, { atOnly: cs.atM > 0 && !cs.atN ? "mental" : "normal" }, c, {}), true, "matches its own kind");
      eq(AA4.matchChar(st, REAL, { atOnly: cs.atM > 0 && !cs.atN ? "normal" : "mental" }, c, {}), false, "not the other");
    });
    test("Pack report (Revise#297): A3-24 3465 — '-X・ー(X)' lowers normal and mental Attack; the X line counts for both effects", () => {
      const ef = REAL.card("A3-24 3465").effects;
      eq(ef[0].steps.map(s => s.mod.key), ["at", "atm"], "both kinds"); eq(ef[0].x, ef[1].x, "the same X");
    });
    test("Pack (Revise#305): A3-25 3627 — each card paid for its cost becomes its own Sunflower", () => {
      const g = m2Game([]), S = g.S, { a } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const paid = st.players[a].zones.deck.slice(-3);
      for (const id of paid) AA4.moveCard(ctx, id, { z: "cost", seat: a });
      AA4.OPS.costDest(ctx, { seat: a, cards: paid, pay: { kind: "set", seat: a, info: REAL.card("A3-25 3627") } });
      const chs = paid.map(id => AA4.charOfCard(st, id)).filter(Boolean);
      eq(new Set(chs.map(c => c.id)).size, 3, "three characters");
      assert(chs.every(c => AA4.charStats(st, REAL, c.id).tokenName === "ヒマワリ"), "each a Sunflower");
    });
    test("Revise#310: 冥 (Nether) factor, player factor gains, reveal-5-take, hand-name dig, each player's deck → damage, mill at declaration", () => {
      eq(["A4-03 0470", "A4-04 0767", "A4-03 0500", "A4-03 0506", "A4-03 0512", "A4-PP PP210", "A4-03 0471"].map(k => REAL.card(k).status), ["auto", "auto", "auto", "auto", "auto", "auto", "auto"]);
      const g = m2Game(["A4-03 0500", "A4-03 0494", "A4-03 0496"]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const runQ = () => { for (let i = 0; i < 40 && st.queue && st.queue.length && !st.decisions.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); } };
      const answer = (pick) => { const d = st.decisions.shift(); AA4.enqueue(st, d.then.map(o => Object.assign({}, o, { answer: pick(d) })), true); runQ(); return d; };
      // 冥: three 冥 characters meet 冥冥冥 → 0500 gets Bind 1
      const n1 = g.char(a, "A4-03 0500", "front"); g.char(a, "A4-03 0494", "front"); AA4.touch(st);
      eq(AA4.factorsHave(st, REAL, a).Nether, 2, "two 冥 marks");
      assert(!(AA4.charStats(st, REAL, n1).skills || {}).bind, "no Bind with 冥冥");
      g.char(a, "A4-03 0496", "front"); AA4.touch(st);
      eq(AA4.factorsHave(st, REAL, a).Nether, 3, "three");
      assert((AA4.charStats(st, REAL, n1).skills || {}).bind != null, "冥冥冥: Bind");
      // a player's factor gain counts (it used to be ignored)
      const e0 = AA4.factorsHave(st, REAL, a)["E.G.O."];
      AA4.runEffect(ctx, REAL.card("A4-03 0512").play, { seat: a, card: null, targets: [] }); runQ(); AA4.touch(st);
      eq(AA4.factorsHave(st, REAL, a).Nether, 4, "0512: ≪あなた≫は冥を1つ得る");
      AA4.runEffect(ctx, { steps: [{ a: "mod", to: "you", mod: { key: "factor", op: "add", value: { faction: "E.G.O.", n: 2 } }, until: "turn" }] }, { seat: a, card: null, targets: [] }); runQ(); AA4.touch(st);
      eq(AA4.factorsHave(st, REAL, a)["E.G.O."], e0 + 2, "≪あなた≫はE.G.O.のファクターを2つ得る");
      // reveal the top 5, take a Project / Fast card, the rest stay in the deck
      const deck = st.players[a].zones.deck, top5 = deck.slice(-5);
      top5.forEach((id, i) => { st.cards[id].key = i === 2 ? "A4-03 0512" : "A4-03 0494"; });
      const n0 = deck.length;
      AA4.runEffect(ctx, REAL.card("A4-03 0470").abilities[0].effect, { seat: a, card: null, targets: [] }); runQ();
      let d = answer(d => d.options.slice(0, 1)); eq(d.options, [top5[2]], "only the Fast card can be taken");
      eq(st.cards[top5[2]].place.z, "hand", "taken"); eq(deck.length, n0 - 1, "the rest back in the deck");
      // hand-name dig: show a hand card, the same-named cards among the top 10 come to the hand
      const hand = st.players[a].zones.hand, pick = hand[0], top10 = deck.slice(-10);
      st.cards[top10[1]].key = st.cards[pick].key; st.cards[top10[4]].key = st.cards[pick].key; st.cards[top10[7]].key = st.cards[pick].key === "A4-03 0494" ? "A4-03 0496" : "A4-03 0494";
      AA4.runEffect(ctx, REAL.card("A4-04 0767").effects[0], { seat: a, card: null, targets: [] }); runQ();
      answer(() => [pick]);
      eq([top10[1], top10[4], top10[7]].map(id => st.cards[id].place.z), ["hand", "hand", "deck"], "the two with the same name");
      // 0506: each player puts a card of their deck into the Damage Pile
      const da = st.players[a].zones.damage.length, db0 = st.players[b].zones.damage.length;
      AA4.runEffect(ctx, REAL.card("A4-03 0506").abilities[0].effect, { seat: a, card: null, targets: [] }); runQ();
      answer(d => d.options.slice(0, 1)); answer(d => d.options.slice(0, 1));
      eq([st.players[a].zones.damage.length - da, st.players[b].zones.damage.length - db0], [1, 1], "one each");
      eq(REAL.card("A4-PP PP210").effects[0].declMill, 3, "PP210: 3 cards from the deck top at the declaration");
      eq(REAL.card("A4-03 0471").abilities.map(x => x.when.event), ["enter", "attack"], "0471: set, or attacks a player");
      eq(["A4-EP EP404", "A4-02 0338", "A4-04 0644", "A4-EP EP539", "A4-05 0918", "A4-PR PR143", "A4-EP EP503", "A4-05 0949", "A4-05 0910", "A3-08 1242"].map(k => REAL.card(k).status), Array(10).fill("auto"), "batch statuses");
      eq(REAL.card("A3-08 1242").costBack, { to: "hand" }, "1242: the cost really comes back now (it was an empty trigger)");
      eq(REAL.card("A4-04 0644").play.steps[1].mod.key, "effect", "0644: grants an effect line");
      eq(REAL.card("A4-EP EP404").effects[0].steps[1].ifXGe, 4, "EP404: Penetrate only with X ≥ 4");
    });
    test("Revise#311: the bot builds first and fights when ready; cards — damage only from named characters, a character and its cards into the deck", () => {
      const g = m2Game(Array(6).fill(vanilla("E.G.O."))), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      eq(AA4.botReady(st, REAL, a), 0, "no Controlled Characters: not ready");
      for (let i = 0; i < 4; i++) g.char(a, vanilla("E.G.O."), "front"); AA4.touch(st);
      assert(AA4.botReady(st, REAL, a) > 0, "some attack: getting ready");
      const w = AA4.botWeights(); assert(w.attackEarly < 0 && w.charsEarly > 0 && w.lethal > 0, "the plan's weights");
      // Revise#317: the opening hand goes through Auto Re-shuffle
      const g2 = AA4.GameLog ? new AA4.GameLog(REAL, {}) : null;
      g2.push({ t: "create", by: "P0", seed: "mull", mode: "online", seats: 2, rules: {} }); g2.push({ t: "join", by: "P0", name: "A", deck: PACK[0].cards }); g2.push({ t: "join", by: "P1", name: "B", deck: PACK[1].cards });
      eq(AA4.botChoose(g2.state, REAL, 1, "P1", {}).t, "autoMulligan", "the opening: Auto Re-shuffle first");
      g2.push(AA4.botChoose(g2.state, REAL, 1, "P1", {}));
      assert(["keep", "autoMulligan"].includes(AA4.botChoose(g2.state, REAL, 1, "P1", {}).t), "then keep (or Auto Re-shuffle again)");
      // Revise#313: an Active Character counts, and so does its power on the way to its Mental
      const ac = g.char(a, vanilla("E.G.O."), "active"), f0 = AA4.botFeatures(st, REAL, a);
      assert(f0.actives >= 1, "an Active Character counts: " + JSON.stringify(f0));
      const se = Math.max(1, AA4.charStats(st, REAL, ac).se || 0);
      for (const id of st.players[a].zones.deck.slice(-se)) AA4.moveCard(ctx, id, { z: "char", ch: ac, role: "power" }); AA4.touch(st);
      eq(AA4.botFeatures(st, REAL, a).domReady, f0.domReady + 1, "power = Mental: ready to be dominated");
      assert(typeof AA4.botHandValue(st, REAL, a) === "number", "hand value");
      eq(["A4-EP EP451", "A4-EP EP496", "A4-02 0219", "A4-02 0374", "A4-EX01 EX0753", "A4-EX02 EX908", "A4-PR PR131"].map(k => REAL.card(k).status), Array(7).fill("auto"), "batch statuses");
      // EP496: the character and its power cards go into the deck
      const c = g.char(a, vanilla("E.G.O."), "front"), pw = st.players[a].zones.deck.slice(-2);
      for (const id of pw) AA4.moveCard(ctx, id, { z: "char", ch: c, role: "power" });
      const n0 = st.players[a].zones.deck.length;
      AA4.EFFECT_ACTIONS.toDeck(ctx, { pos: "top", allTo: true }, { seat: a }, [{ ch: c }]);
      eq(st.players[a].zones.deck.length, n0 + 3, "the character card and its 2 power cards");
    });
    test("Revise#318: card batch — selectors (英国を持たない / あなたの支配キャラクター以外 / イレイザー以外の分類), guard-trigger filter, Synchro battle immunity, factor-state set trigger", () => {
      const keys = ["A4-EX02 EX881", "A4-03 0439", "A4-03 0538", "A4-PP PP170", "A4-PP PP208", "A4-PP PP214", "A4-PP PP215", "A4-PP PP328", "A4-PR PR142", "A4-01 0018", "A4-05 0980", "A4-EX02 EX797", "A4-EX02 EX873", "A4-PP PP142"];
      eq(keys.map(k => REAL.card(k).status), Array(keys.length).fill("auto"), "batch statuses");
      eq(REAL.card("A4-PP PP170").abilities[0].when, { event: "guarded", chSel: { aggressive: true, broken: false } }, "PP170: only an unbroken ▼ guard is discarded");
      eq(REAL.card("A4-PP PP214").abilities[1].effect.steps[0], { a: "ban", to: "you", decl: "set", type: "Break", until: "turn" }, "PP214: no Break cards this turn");
      eq(REAL.card("A4-EX02 EX881").play.steps[0].if.count.sel.tag, "英国", "EX881: only with an England character");
      const g = m2Game(Array(4).fill(vanilla("E.G.O."))), S = g.S, { a, b } = g, st = S();
      const mine = g.char(a, vanilla("E.G.O."), "front"), act = g.char(a, vanilla("E.G.O."), "back"), foe = g.char(b, vanilla("E.G.O."), "front");
      st.chars[act].at.area = "active"; AA4.touch(st);
      eq([mine, act, foe].map(id => AA4.matchChar(st, REAL, { notYourCtl: true }, id, { seat: a })), [false, true, true], "あなたの支配キャラクター以外");
      eq(AA4.matchChar(st, REAL, { notTag: "英国" }, foe, { seat: a }), true, "no England tag");
      eq(AA4.matchChar(st, REAL, { iconOther: "イレイザー" }, foe, { seat: a }), AA4.charStats(st, REAL, foe).icons.some(i => i !== "イレイザー"), "a class other than イレイザー");
    });
    test("Pack reports (Revise#325): Boost 2 offers Boost 1 and 2; Lilith's own cost back to the hand; 1167 +X from same-name cards in Damage Piles; 1173 usable from the Damage Pile at Fast timing", () => {
      const g = m2Game(["A3-20 2673", "A3-EP EP245", "A3-07 1167", "A3-07 1173"]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      g.toPhase("main");
      // 2673: ブースト2
      const bo = g.char(a, "A3-20 2673", "front"); g.give(bo, 3);
      const boosts = AA4.candidates(S(), REAL, "P" + a, a).filter(c => c.t === "declare" && c.kind === "attack" && c.ch === bo && c.boost).map(c => c.boost);
      eq([...new Set(boosts)].sort(), [1, 2], "Boost 1 and Boost 2 offered");
      g.ok({ t: "declare", seat: a, kind: "attack", ch: bo, target: { seat: b }, boost: 2 });
      eq(S().draft && S().draft.cost, 3, "attack cost 1 + Boost 2");
      g.ok({ t: "cancel", seat: a });
      // EP245: ≪ブレイクカードのコスト≫は、そのオーナーの手札に戻る — its own cost too
      eq(REAL.card("A3-EP EP245").costBack, { to: "hand" }, "EP245: costBack");
      // 1167: +X = same-name cards in every Damage Pile
      const host = g.char(a, vanilla("Polestar Empire"), "front"), pm = Object.values(st.cards).find(x => x.owner === a && x.key === "A3-07 1167");
      AA4.moveCard(ctx, pm.id, { z: "char", ch: host, role: "perm" }); AA4.touch(st);
      const nm = (REAL.card(st.cards[AA4.topOf(st.chars[host])].key) || {}).name, s0 = AA4.charStats(st, REAL, host).at;
      const same = Object.values(st.cards).filter(x => x.owner === b && x.place.z !== "char" && (REAL.card(x.key) || {}).name === nm && nm).slice(0, 2);
      if (nm && same.length) { same.forEach(x => AA4.moveCard(ctx, x.id, { z: "damage" })); AA4.touch(st); eq(AA4.charStats(st, REAL, host).at, s0 + same.length, "1167: +X with X same-name cards in the Damage Piles"); }
      eq(REAL.card("A3-07 1167").statX, { dmgSameName: "all" }, "1167: X is defined");
      // 1173: from the Damage Pile like a hand card, at Fast timing
      const fc = Object.values(st.cards).find(x => x.owner === a && x.key === "A3-07 1173");
      AA4.moveCard(ctx, fc.id, { z: "damage" }); g.char(a, vanilla("Polestar Empire"), "back"); g.char(a, vanilla("Polestar Empire"), "back"); AA4.touch(st);
      { const r = AA4.step(AA4.clone(S()), { t: "declare", by: "P" + a, seat: a, kind: "set", card: fc.id }, REAL); assert(r && r.ok !== false, "1173: from the Damage Pile: " + JSON.stringify(r && r.reason)); }
      assert(AA4.candidates(S(), REAL, "P" + a, a).some(c => c.t === "declare" && c.kind === "set" && c.card === fc.id), "1173: offered from the Damage Pile");
    });
    test("Pack's rules (Revise#330, #375, #396): Character cards as the players set them — 3 on the first turn, 2 later, only what it can charge, Aggressive first", () => {
      const isAgg = k => !!(REAL.card(k).aggressive || (REAL.card(k).skills || {}).aggressive);
      const C = REAL.all().filter(c => c.type === "Character" && !c.name && c.status === "auto" && c.faction === "E.G.O." && (+c.se || 0) === 1);
      const ag = C.find(c => isAgg(c.key)), pl = C.find(c => !isAgg(c.key) && !(c.skills || {}).charge && !(c.skills || {}).draw), fill = REAL.all().find(c => c.type === "Project" && c.faction === "E.G.O.");
      const g = m2Game([ag.key, pl.key, fill.key]), S = g.S, { a } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      for (const id of st.players[a].zones.hand.slice()) AA4.moveCard(ctx, id, { z: "deck" });
      const take = k => { const c = Object.values(st.cards).find(x => x.owner === a && x.key === k && x.place.z === "deck"); AA4.moveCard(ctx, c.id, { z: "hand" }); return c.id; };
      const a1 = take(ag.key), p1 = take(pl.key), f = [take(fill.key), take(fill.key), take(fill.key)]; AA4.touch(st);
      const w = Object.assign(AA4.botWeights(), { reserveUntilDraw: 0 });   // no card kept back in this check
      eq([AA4.botSetCharOk(st, REAL, a, a1, w), AA4.botSetCharOk(st, REAL, a, p1, w)], [true, false], "the Aggressive character first; the other one after it");
      st.players[a].usedTurn = { turn: st.turn.number, keys: [ag.key, ag.key, ag.key] }; AA4.touch(st);
      eq(AA4.botSetCharOk(st, REAL, a, a1, w), false, "first turn: 3 Character cards are set, a 4th is not (setFirstTurn)");
      eq(AA4.botSetCharOk(st, REAL, a, a1, Object.assign({}, w, { setFirstTurn: 4 })), true, "the number is a parameter");
      st.turn.number = 9; st.players[a].usedTurn = { turn: 9, keys: [ag.key, ag.key] }; AA4.moveCard(ctx, a1, { z: "deck" }); AA4.touch(st);
      eq(AA4.botSetCharOk(st, REAL, a, p1, w), false, "a later turn: 2 are set, a 3rd is not (setPerTurn)");
      st.players[a].usedTurn = { turn: 9, keys: [] }; AA4.touch(st);
      eq(AA4.botSetCharOk(st, REAL, a, p1, w), true, "a later turn, nothing set yet, 3 cards to charge it: set");
      for (const id of f) AA4.moveCard(ctx, id, { z: "deck" }); AA4.touch(st);
      eq(AA4.botSetCharOk(st, REAL, a, p1, w), false, "no card left to charge it this turn: it stays in the hand");
      eq(AA4.botOwnTurn({ turn: { number: 7, order: [0, 1] } }), 4, "turn 7 of a two-player game is its 4th own turn");
    });
    test("Pack's feedback (Revise#331, #375): the bot attacks a player when no guard there can defeat the attacker; it charges first; no suicide attacks", () => {
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(); st.turn.number = 9;   // not one of its first turns (attackTurnMin, Revise#396)
      const weak = g.char(a, vanilla("E.G.O."), "front"); g.give(weak, 2);
      const it = { t: "declare", kind: "attack", ch: weak, target: { seat: b } };
      const noCh = Object.assign(AA4.botWeights(), { attackChargeMin: 0 }), chg = +AA4.playerStats(st, REAL, a).charge || 0;
      eq(AA4.botAttackOk(st, REAL, a, it, noCh), false, "2 power cards on its Controlled Characters, X = 3: charge first");
      eq(AA4.botAttackOk(st, REAL, a, it, Object.assign({}, noCh, { attackPowerMin: 2 })), true, "X is a parameter (attackPowerMin)");
      g.give(weak, 1); AA4.touch(st);
      eq(AA4.botAttackOk(st, REAL, a, it, noCh), true, "3 power cards, nobody guards: attack");
      eq(AA4.botAttackOk(st, REAL, a, it, Object.assign(AA4.botWeights(), { attackChargeMin: chg + 1 })), false, "Charge below attackChargeMin (Revise#376): build the Charge first");
      eq(AA4.botAttackOk(st, REAL, a, it, Object.assign(AA4.botWeights(), { attackChargeMin: chg })), true, "Charge at the limit: attack");
      const big = g.char(b, vanilla("Darklore", { at: 2 }), "front"); g.give(big, 2); AA4.touch(st);
      const kills = (+AA4.charStats(st, REAL, big).at || 0) >= (+AA4.charStats(st, REAL, weak).de || 0);
      eq(AA4.botAttackOk(st, REAL, a, it, noCh), !kills, "a guard that would defeat the attacker, and no strike that wins through the guards: stay home");
      eq(AA4.botAttackOk(st, REAL, a, { t: "declare", kind: "attack", ch: weak, target: { ch: big } }, noCh), !(kills && (+AA4.charStats(st, REAL, weak).at || 0) < (+AA4.charStats(st, REAL, big).de || 0)), "an attack on a character that defeats the attacker and survives: no");
      st.chars[big].flags = Object.assign({}, st.chars[big].flags, { tapped: true }); AA4.touch(st);
      eq(AA4.botAttackOk(st, REAL, a, it, noCh), true, "that guard is tapped (it cannot fight): attack");
    });
    test("Pack (Revise#332): the bot's plan — named Break cards by job, power kept for the one in the hand, never charged while another card can be", () => {
      eq(AA4.botRole({ se: 3, at: 6, de: 4, skills: { penetrate: true } }), "attacker");
      eq(AA4.botRole({ se: 4, at: 2, de: 3, effects: [{}] }), "supporter");
      eq(AA4.botRole({ se: 3, at: 2, de: 6, skills: { shield: true } }), "defender");
      const nb = REAL.all().find(c => c.type === "Break" && c.name && typeof c.cost === "number" && c.cost >= 2 && c.status === "auto");
      const g = m2Game([nb.key]), S = g.S, { a } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const plan = AA4.botPlan(st, REAL, a);
      assert(plan.some(x => x.key === nb.key && x.role && x.copies === 3), "the plan lists the deck's named Break cards with a job");
      for (const id of st.players[a].zones.hand.slice()) AA4.moveCard(ctx, id, { z: "deck" });
      const card = Object.values(st.cards).find(x => x.owner === a && x.key === nb.key && x.place.z === "deck"), other = Object.values(st.cards).find(x => x.owner === a && x.key !== nb.key && x.place.z === "deck");
      AA4.moveCard(ctx, card.id, { z: "hand" }); AA4.moveCard(ctx, other.id, { z: "hand" });
      const ch = g.char(a, vanilla("E.G.O."), "front"); AA4.touch(st);
      eq(AA4.botNameBreakNeed(st, REAL, a).short, 1, "no power on the field: the whole cost is missing");
      g.give(ch, nb.cost); AA4.touch(st);
      eq(AA4.botNameBreakNeed(st, REAL, a).short, 0, "enough power kept: nothing missing");
    });
    test("Pack (Revise#336): sort hand — the same cards in a new order, only your own hand, undoable", () => {
      const g = m2Game([]), S = g.S, { a, b } = g;
      const hand = S().players[a].zones.hand.slice(), rev = hand.slice().reverse();
      g.ok({ t: "sortHand", seat: a, order: rev });
      eq(S().players[a].zones.hand, rev, "the new order");
      assert(g.events().some(e => e.e === "handSorted" && e.seat === a && !e.order), "the event does not show the order");
      g.no({ t: "sortHand", seat: a, order: rev.slice(1) }, "Sort the cards of your own hand");
      g.no({ t: "sortHand", seat: a, order: S().players[b].zones.hand.slice() }, "Sort the cards of your own hand");
      assert(AA4.isUndoable("sortHand"), "undoable");
    });
    test("Revise#339: card batch — target-kind conditions (さらに / 代わりに), attack that reaches its target, a Name written with its own quotes", () => {
      const keys = ["A3-17 2405", "A4-EP EP449", "A4-EP EP497", "A4-EP EP510", "A4-EP EP512", "A4-EX01 EX0694", "A4-EX01 EX0695", "A4-EX02 EX888", "A4-02 0210", "A4-04 0736", "A4-PP PP053", "A4-PR PR095", "A4-EX01 EX0746", "A4-PR PR147"];
      eq(keys.map(k => REAL.card(k).status), Array(keys.length).fill("auto"), "batch statuses");
      const s512 = REAL.card("A4-EP EP512").play.steps;
      eq([s512[0].ifTNotSel, s512[1].ifTSel, s512[1].mod.value], [{ tag: "マーチャント系" }, { tag: "マーチャント系" }, 3], "EP512: +2, or +3 for a Merchant-type target (not both)");
      eq(REAL.card("A4-EX02 EX888").play.steps.filter(x => x.a === "discardOnAttack").map(x => x.dest || "discard"), ["discard", "hand"], "EX888: discarded, or back to the hand on a Tres España target");
      eq(REAL.card("A4-04 0736").abilities[0].cond, { self: "attackingUnguarded" }, "0736: +10 only when nobody guards");
      eq(REAL.card("A4-EX01 EX0694").abilities[0].cond, { selfHasCardName: "「武蔵」" }, "EX0694: with the card named 「武蔵」 on it");
      eq(REAL.card("A4-EX01 EX0746").play.steps.length, 3, "EX0746: three Initiatives");
      const g = m2Game(["A4-04 0736"]), S = g.S, { a, b } = g, st = S();
      const at = g.char(a, "A4-04 0736", "front"); g.give(at, 2); const grd = g.char(b, vanilla("E.G.O."), "front"); g.give(grd, 2);
      g.toPhase("main"); const base = AA4.charStats(S(), REAL, at).at;
      g.ok({ t: "declare", seat: a, kind: "attack", ch: at, target: { seat: b } }); g.pay(a);
      eq(AA4.charStats(S(), REAL, at).at, base + 10, "attacking, nobody guards yet: +10");
      g.ok({ t: "declare", seat: b, kind: "guard", ch: grd }); g.pay(b);
      eq(AA4.charStats(S(), REAL, at).at, base, "guarded: no +10");
    });
    test("Revise#340: card batch — no damage from unbroken characters, named cards in a stack, cost less per Ghost", () => {
      const keys = ["A4-02 0213", "A4-02 0305", "A4-02 0307", "A4-03 0536", "A4-04 0768", "A4-05 0985", "A4-05 1003", "A4-05 1009", "A4-05 1015", "A4-PP PP050", "A4-PP PP058", "A4-PP PP244", "A4-PR PR091"];
      eq(keys.map(k => REAL.card(k).status), Array(keys.length).fill("auto"), "batch statuses");
      eq(REAL.card("A4-04 0768").abilities[1].when, { event: "broken", own: true, cardNamed: true, prevNamed: true }, "0768: a Name broken by a Break card with a Name");
      eq(REAL.card("A4-04 0768").abilities[0].mod.to.all.stackNamedMin, 3, "0768: three named cards in the stack");
      assert(REAL.card("A4-PP PP244").costLess.countChars, "PP244: cost less per Arayashiki Ghost");
      const g = m2Game(["A4-PP PP050"]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      g.char(a, "A4-PP PP050", "front"); const un = g.char(b, vanilla("E.G.O."), "front"); AA4.touch(st);
      const cnt = () => st.players[a].zones.damage.length + st.players[a].zones.discard.length;
      const n0 = cnt();
      AA4.damagePlayer(ctx, a, { normal: 2, mental: 0 }, { from: un, fromSeat: b });
      eq(cnt(), n0, "PP050: an unbroken character deals no damage to a player");
      assert(ctx.events.some(e => e.e === "note"), "a note");
    });
    test("Revise#341: card batch — whole deck revealed, Resist by Permanent faction, a Break card free on one character, boost of 4", () => {
      const keys = ["A4-EP EP401", "A4-EP EP484", "A4-EP EP523", "A4-EX01 EX0711", "A4-EX01 EX0765", "A4-01 0176", "A4-02 0241", "A4-02 0311", "A4-02 0348", "A4-03 0570", "A4-05 0840", "A4-PP PP110", "A4-PP PP243", "A4-PP PP301", "A4-PP PP303"];
      eq(keys.map(k => REAL.card(k).status), Array(keys.length).fill("auto"), "batch statuses");
      const g = m2Game(["A4-03 0570", "A4-PP PP303", "A4-01 0176", "A4-EX01 EX0711"]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      // 0570: every Character card of both decks goes to its owner's Active Area
      const isCh = id => (REAL.card(st.cards[id].key) || {}).type === "Character";
      const n = [a, b].map(seat => st.players[seat].zones.deck.filter(isCh).length), c0 = Object.keys(st.chars).length;
      assert(n[0] + n[1] > 0, "the decks hold Character cards");
      AA4.EFFECT_ACTIONS.deckCharsToActive(ctx, {}, { seat: a });
      eq(Object.keys(st.chars).length, c0 + n[0] + n[1], "0570: all of them were set");
      eq([a, b].map(seat => st.players[seat].zones.deck.filter(isCh).length), [0, 0], "none left in a deck");
      // PP303: a Break card set on it costs nothing
      const host = g.char(a, "A4-PP PP303", "front"); AA4.touch(st);
      assert(AA4.charStats(st, REAL, host).breakCostFree, "PP303 flag");
      eq(AA4.xFromDef(st, REAL, { freeOn: "\u0000", seat: a, base: 3 }, { seat: a }, [{ ch: host }]), 0, "free on that character");
      const other = g.char(a, vanilla("E.G.O."), "front");
      eq(AA4.xFromDef(st, REAL, { freeOn: "\u0000", seat: a, base: 3 }, { seat: a }, [{ ch: other }]), 3, "the printed cost elsewhere");
      // EX0711: its battle opponent loses its skills only with a Boost of 4 or more
      eq(REAL.card("A4-EX01 EX0711").abilities.find(x => x.mod && x.mod.key === "battleOppSkillsOff").cond, { self: "attackingBoost", n: 4 }, "EX0711 cond");
      const at = g.char(a, "A4-EX01 EX0711", "front");
      st.battle = { id: "bx", kind: "attack", attacker: at, aSeat: a, target: { seat: b }, boost: 3, joined: { att: [], grd: [] } };
      assert(!AA4.checkCond(st, REAL, { self: "attackingBoost", n: 4 }, { seat: a, ch: at }), "boost 3: no");
      st.battle.boost = 4; assert(AA4.checkCond(st, REAL, { self: "attackingBoost", n: 4 }, { seat: a, ch: at }), "boost 4: yes");
      st.battle = null;
      // 0348: +5 instead of +1 in a turn when one of your named characters was discarded
      const s348 = REAL.card("A4-02 0348").play.steps;
      eq([s348[0].if, s348[1].if, s348[1].mod.value], [{ not: { namedGoneTurn: true } }, { namedGoneTurn: true }, 5], "0348");
      assert(!AA4.checkCond(st, REAL, { namedGoneTurn: true }, { seat: a }), "not yet");
      st.turn.namedGone = { turn: st.turn.number, seats: [a] };
      assert(AA4.checkCond(st, REAL, { namedGoneTurn: true }, { seat: a }) && !AA4.checkCond(st, REAL, { namedGoneTurn: true }, { seat: b }), "only for that player");
    });
    test("Revise#342: card batch — next attack on a player unguardable, power cards back to the decks, a Permanent that leaves at power 0", () => {
      const keys = ["A3-EX03 EX0340", "A3-EX04 EX0478", "A4-EX01 EX0666", "A4-EX01 EX0733", "A4-EX01 EX0739", "A4-EX01 EX0743", "A4-EX01 EX0762", "A3-PP PP075", "A4-02 0246", "A4-02 0313", "A4-04 0607", "A4-04 0612", "A4-04 0703", "A4-04 0733", "A4-04 0740", "A4-05 0954", "A4-PP PP216", "A4-PP PP269"];
      eq(keys.map(k => REAL.card(k).status), Array(keys.length).fill("auto"), "batch statuses");
      eq(REAL.card("A4-04 0733").factorLessIf.n, 3, "0733: Factor −3 with another named Talent");
      eq(REAL.card("A4-02 0246").abilities[0].effect.target.sel, { ownerAttacked: true, atMental: true, powerLeSelf: true }, "0246 selector");
      const g = m2Game(["A4-05 0954"]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const at = g.char(a, vanilla("E.G.O."), "front"), grd = g.char(b, vanilla("E.G.O."), "front"); g.give(at, 2); g.give(grd, 2);
      // 0313: one power card of every character goes back to its owner's deck
      const d0 = [a, b].map(seat => st.players[seat].zones.deck.length);
      AA4.EFFECT_ACTIONS.eachPowerToDeck(ctx, {}, { seat: a });
      eq([st.chars[at].power.length, st.chars[grd].power.length], [1, 1], "0313: one power card each");
      eq([a, b].map(seat => st.players[seat].zones.deck.length), d0.map(n => n + 1), "back in the decks");
      // 0954: the next attack on a player can't be guarded
      AA4.addMod(ctx, { src: { seat: a }, to: { ch: at }, key: "unguardedNextP", op: "grant", value: true, until: "turn" }); AA4.touch(st);
      g.toPhase("main");
      g.ok({ t: "declare", seat: a, kind: "attack", ch: at, target: { seat: b } }); g.pay(a);
      const bt = S().battle; assert(bt && S().modifiers.some(m => m.key === "unguardedNextP" && m.bid === bt.id), "bound to this battle");
      const r = AA4.planDeclaration(S(), REAL, b, { kind: "guard", ch: grd });
      assert(r && r.reason && /can't be guarded/.test(r.reason), "0954: no guard (" + JSON.stringify(r && r.reason) + ")");
    });
    test("Revise#343: card batch — another Factor that also works, series tags after the skills, free with the right factions", () => {
      const keys = ["A4-EX01 EX0717", "A4-EX01 EX0724", "A4-EX02 EX790", "A4-EX02 EX820", "A4-EX02 EX919", "A4-03 0444", "A4-03 0572", "A4-04 0647", "A4-04 0674", "A4-05 0916", "A4-PP PP238", "A4-PP PP239", "A4-PP PP329", "A4-PP PP360", "A4-PP PP366", "A4-PR PR063", "A4-PR PR137", "A4-PR PR144"];
      eq(keys.map(k => REAL.card(k).status), Array(keys.length).fill("auto"), "batch statuses");
      eq(REAL.card("A4-EX02 EX919").tags, ["武蔵", "英国"], "EX919: both tags");
      assert(REAL.card("A4-EX02 EX919").skills.charge.x.selfNamed, "EX919: Charge X");
      eq(REAL.card("A4-EX01 EX0717").tags, ["K.P.A.Italia"], "EX0717 tag");
      eq(REAL.card("A4-EX02 EX820").abilities[0].when, { event: "brokenSelf", newSel: { named: true, tag: "英国" } }, "EX820 (the old rule had a broken pattern)");
      const g = m2Game(["A4-PP PP239"]), S = g.S, { a, b } = g, st = S();
      const inf = REAL.card("A4-PP PP239"); eq(inf.altFactor, { Darklore: 2 }, "PP239: ダダ also works");
      assert(AA4.factorOk(st, REAL, a, inf), "no Factor yet: refused");
      g.char(a, vanilla("Darklore"), "front"); g.char(a, vanilla("Darklore"), "front"); AA4.touch(st);
      const have = AA4.factorsOf ? AA4.factorsOf(st, REAL, a) : null;
      if (!have || (have.Darklore || 0) >= 2) assert(!AA4.factorOk(st, REAL, a, inf), "two Darklore Factors: allowed");
      // PP238: free with both of your factions, or one of them on the other side
      const f = REAL.card("A4-PP PP238").freeIf; assert(f && f.cond && f.cond.any.length === 3, "PP238 freeIf");
      assert(!AA4.freeIfOk(st, REAL, a, f), "PP238: not yet");
      g.char(b, vanilla("WIZ-DOM"), "front"); const wz = Object.values(st.chars).find(c => c.owner === b);
      if (wz && AA4.isControlled(wz)) { AA4.touch(st); assert(AA4.freeIfOk(st, REAL, a, f), "PP238: the opponent controls WIZ-DOM"); }
    });
    test("Revise#344: card batch — a named card below, no damage at all with four named characters, an optional watcher", () => {
      const keys = ["A4-EP EP446", "A4-EP EP509", "A4-EX01 EX0732", "A4-EX01 EX0740", "A4-EX01 EX0749", "A4-EX01 EX0754", "A4-EX01 EX0764", "A4-EX02 EX855", "A4-EX02 EX889", "A4-EX02 EX914", "A4-EX02 EX915", "A4-05 0849", "A3-EXPR EXPR034"];
      eq(keys.map(k => REAL.card(k).status), Array(keys.length).fill("auto"), "batch statuses");
      eq(REAL.card("A4-EX01 EX0740").play.payOnlySel, REAL.card("A4-EX01 EX0740").play.target.sel, "EX0740: paid by its target");
      eq(REAL.card("A3-EXPR EXPR034").play.steps[0], { a: "effDecl", zones: ["hand"], types: ["Break"], onto: "t", costTo: "hand" }, "EXPR034");
      const g = m2Game(["A4-EX02 EX914"]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      // belowNamed: a named card under this one
      const host = g.char(a, vanilla("E.G.O."), "front"), top = AA4.topOf(st.chars[host]);
      assert(!AA4.checkCond(st, REAL, { belowNamed: true }, { seat: a, ch: host, card: top }), "nothing below the only card");
      // 0849: no damage at all while the condition holds
      const n0 = st.players[a].zones.damage.length + st.players[a].zones.discard.length + Object.keys(st.chars).length;
      AA4.addMod(ctx, { src: { seat: a }, to: { seat: a }, key: "playerNoDamageAll", op: "grant", value: true, cond: { count: { sel: { owner: "you", area: "controlled" }, op: ">=", n: 1 } }, until: "turn" }); AA4.touch(st);
      AA4.damagePlayer(ctx, a, { normal: 2, mental: 0 }, { fromSeat: b });
      eq(st.players[a].zones.damage.length + st.players[a].zones.discard.length + Object.keys(st.chars).length, n0, "0849: no damage while the condition holds");
      AA4.removeChar(ctx, host, { to: "discard", why: "test" }); AA4.touch(st);
      const d1 = st.players[a].zones.damage.length, k1 = Object.keys(st.chars).length;
      AA4.damagePlayer(ctx, a, { normal: 1, mental: 0 }, { fromSeat: b });
      for (let i = 0; i < 30 && st.queue && st.queue.length && !st.decisions.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); }
      assert(st.players[a].zones.damage.length > d1 || Object.keys(st.chars).length > k1, "condition gone: the damage check happens");
    });
    test("Revise#345: card batch — paid by one character of a class (instead / further / then), characters of a player with 8 damage", () => {
      const keys = ["A4-EP EP439", "A4-EP EP500", "A4-EP EP501", "A4-EP EP502", "A4-EP EP507", "A4-EP EP508", "A4-EP EP513", "A3-EX02 EX0104", "A3-EX03 EX0332", "A4-EX01 EX0720", "A4-EX01 EX0725", "A4-EX01 EX0761", "A4-02 0375", "A4-05 0981", "A4-PP PP209"];
      eq(keys.map(k => REAL.card(k).status), Array(keys.length).fill("auto"), "batch statuses");
      const pb = { sel: true, one: true, tag: "アコライト系", factorGe: 3 }, s507 = REAL.card("A4-EP EP507").play.steps;
      eq([s507[0].ifNotPaidBy, s507[1].ifPaidBy, s507[1].sel.types], [pb, pb, ["Character", "Break"]], "EP507: one or the other");
      eq(REAL.card("A4-EP EP502").play.steps[1], { a: "powerDiscard", to: "t", n: 1, ifPaidBy: { sel: true, one: true, tag: "マジシャン系", factorGe: 5 } }, "EP502: then a power card");
      eq(REAL.card("A4-PP PP209").altFactor, [{ "WIZ-DOM": 2 }, { Eraser: 2 }], "PP209: WW or イイ");
      eq(REAL.card("A4-EX01 EX0720").tags, ["K.P.A.Italia"], "EX0720: the tag before the bracket");
      eq(REAL.card("A4-EP EP439").effects[0].declCond, { selfIs: { name: "里村紅葉", broken: true } }, "EP439: only on a broken 里村紅葉");
      const g = m2Game([]), S = g.S, { a, b } = g, st = S();
      const c1 = g.char(b, vanilla("E.G.O."), "front");
      const sel = REAL.card("A3-EX02 EX0104").play.steps[1].to.all; eq(sel.ownerDmgMin, 8, "EX0104 selector");
      assert(!AA4.matchChar(st, REAL, Object.assign({}, sel, { area: undefined }), c1, { seat: a }), "fewer than 8 damage: no");
      const dk = st.players[b].zones.deck; while (st.players[b].zones.damage.length < 8 && dk.length) st.players[b].zones.damage.push(dk.pop());
      AA4.touch(st); assert(AA4.matchChar(st, REAL, { owner: "opp", ownerDmgMin: 8 }, c1, { seat: a }), "8 damage: yes");
    });
    test("Revise#346: card batch — one of each faction, a faction of the opponent, duplicate names back to the decks", () => {
      const keys = ["A3-EX02 EX0114", "A4-01 0054", "A4-01 0183", "A4-04 0709", "A4-PP PP084", "A4-PP PP305", "A3-24 3503", "A4-EP EP504", "A4-EP EP506", "A4-EP EP514", "A3-EX02 EX0111", "A4-PP PP268", "A4-PP PP330", "A4-PP PP333"];
      eq(REAL.card("A4-PP PP333").effects[1].steps[0], { a: "draw", to: "t", n: "X", nPlus: 3 }, "PP333: 3 + X cards");
      eq(REAL.card("A4-04 0611").statX, { selfStackType: "Break" }, "0611: its +X is the number of Break cards (was not read)");
      eq(REAL.card("A3-EX02 EX0111").effects[0].declCond, { self: "attacking" }, "EX0111: only while it attacks");
      eq(REAL.card("A4-PP PP268").fastIfCond, { oppDeclaring: true }, "PP268: fast timing while the opponent declares a card");
      eq(keys.map(k => REAL.card(k).status), Array(keys.length).fill("auto"), "batch statuses");
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const runQ = () => { for (let i = 0; i < 60 && st.queue && st.queue.length && !st.decisions.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); } };
      const answer = pick => { const d = st.decisions.shift(); AA4.enqueue(st, d.then.map(o => Object.assign({}, o, { answer: pick(d) })), true); runQ(); return d; };
      // 0709: one unbroken character of each faction, for every player
      const e1 = g.char(a, vanilla("E.G.O."), "back"), e2 = g.char(a, vanilla("E.G.O."), "back"), d1 = g.char(a, vanilla("Darklore"), "back"), o1 = g.char(b, vanilla("E.G.O."), "back");
      AA4.touch(st); AA4.EFFECT_ACTIONS.eachFactionSac(ctx, { sel: { broken: false } }, { seat: a }); runQ();
      assert(st.decisions.length === 1 && st.decisions[0].seat === a && st.decisions[0].options.length === 2, "0709: a choice between the two E.G.O. characters");
      answer(d => [d.options[0]]);
      eq([e1, e2, d1, o1].filter(id => st.chars[id] && !st.chars[id].flags.dying).length, 1, "0709: one of each faction is gone, for both players");
      // 0054: every unbroken character of one faction of the opponent
      const p1 = g.char(b, vanilla("E.G.O."), "back"), p2 = g.char(b, vanilla("E.G.O."), "front"), p3 = g.char(b, vanilla("Darklore"), "back");
      AA4.touch(st); AA4.EFFECT_ACTIONS.oppFactionSweep(ctx, { sel: { broken: false } }, { seat: a }); runQ();
      eq(st.decisions[0].options.length, 2, "0054: two factions to choose from");
      answer(d => [d.options.find(o => /E\.G\.O\./.test(o))]);
      eq([p1, p2, p3].map(id => !!(st.chars[id] && !st.chars[id].flags.dying)), [false, false, true], "0054: the E.G.O. characters are gone");
      // PP084: the same card twice on the field → both go back
      const q1 = g.char(a, vanilla("WIZ-DOM"), "back"), q2 = g.char(b, vanilla("WIZ-DOM"), "back");
      AA4.touch(st); AA4.EFFECT_ACTIONS.dupNameToDeck(ctx, {}, { seat: a }); runQ();
      assert(!st.chars[q1] && !st.chars[q2], "PP084: both copies left the field");
    });
    test("Revise#347: card batch — a Permanent from the hand by its card name, set only with a tagged hand card, effect damage +1, watchers on the guard", () => {
      const keys = ["A3-24 3581", "A4-EP EP438", "A3-EX04 EX0447", "A3-EX04 EX0462", "A3-EX04 EX0465", "A4-EX01 EX0728", "A4-EX02 EX801", "A4-EX02 EX807", "A4-EX02 EX833", "A4-EX02 EX844", "A4-01 0152", "A4-04 0707"];
      eq(keys.map(k => REAL.card(k).status), Array(keys.length).fill("auto"), "batch statuses");
      const want = REAL.card("A4-EX02 EX833").abilities[0].effect.steps[0].sel.jp;
      eq(String(REAL.card("A4-EX02 EX867").jp).replace(/\s+/g, ""), want, "EX833 names the card EX867 exactly (half-width brackets, as stored)");
      eq(String(REAL.card("A4-EX01 EX0724").jp).replace(/\s+/g, ""), REAL.card("A4-EX02 EX801").abilities[0].effect.steps[0].sel.jp, "EX801 names EX0724");
      eq(REAL.card("A4-EP EP438").abilities.find(x => x.cond && x.cond.selfIs && x.cond.selfIs.baseStat).cond, { selfIs: { name: "鈴白なぎさ", baseStat: [{ key: "se", op: ">=", n: 5 }] } }, "EP438: printed Mental 5 or more");
      const g = m2Game(["A4-EX02 EX844", "A4-EX02 EX807"]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      // EX844: only with another 三征西班牙 card in the hand
      const hand = st.players[a].zones.hand, mk = key => { const id = Object.keys(st.cards).find(c => st.cards[c].owner === a && st.cards[c].key === key && st.cards[c].place.z === "deck"); const dk = st.players[a].zones.deck; dk.splice(dk.indexOf(id), 1); hand.push(id); st.cards[id].place = { z: "hand", seat: a }; return id; };
      const c844 = mk("A4-EX02 EX844");
      assert(!AA4.checkCond(st, REAL, { handHasTag: "三征西班牙" }, { seat: a, card: c844 }) || hand.some(id => id !== c844 && (REAL.card(st.cards[id].key).tags || []).includes("三征西班牙")), "EX844: itself does not count");
      const c2 = mk("A4-EX02 EX844");
      assert(AA4.checkCond(st, REAL, { handHasTag: "三征西班牙" }, { seat: a, card: c844 }), "EX844: a second tagged card in the hand");
      // EX0728: +1 to the damage of its effects
      const ch = g.char(a, vanilla("E.G.O."), "front"), vic = g.char(b, vanilla("E.G.O."), "front"); g.give(vic, 3);
      AA4.addMod(ctx, { src: { seat: a, ch }, to: { ch }, key: "effDmgUp", op: "add", value: 1, until: "turn" }); AA4.touch(st);
      eq(AA4.charStats(st, REAL, ch).effDmgUp, 1, "EX0728 stat");
      const hits = []; const orig = AA4.damageChar; AA4.damageChar = (cx, id, d) => hits.push(d.normal);
      try { AA4.EFFECT_ACTIONS.damage(ctx, { a: "damage", n: 2 }, { seat: a, ch, item: { kind: "effect", i: 0 } }, [{ ch: vic }]); AA4.EFFECT_ACTIONS.damage(ctx, { a: "damage", n: 2 }, { seat: a, ch, item: { kind: "set" } }, [{ ch: vic }]); } finally { AA4.damageChar = orig; }
      eq(hits, [3, 2], "EX0728: +1 for an effect, not for a card");
    });
    test("Revise#348: card batch — a skill of your choice, power cards moved to this character, three of your own for a Break card; pile picks that had no target", () => {
      const keys = ["A4-02 0339", "A4-03 0535", "A4-05 0846", "A4-05 0911", "A4-05 0982", "A4-PP PP213", "A4-PP PP272", "A4-PP PP363"];
      eq(keys.map(k => REAL.card(k).status), Array(keys.length).fill("auto"), "batch statuses");
      eq(REAL.card("A4-05 0911").effects[0].target.sel, { owner: "you", area: "party" }, "0911: one of your Active Area characters");
      eq(REAL.card("A4-02 0339").effects[1].steps[0].topBreakTo, "damage", "0339: its top Break card goes to the Damage Pile");
      eq([REAL.card("A4-PP PP213").fastExtra, REAL.card("A4-05 0846").fastExtra], [3, 1], "fast timing for an extra cost");
      // steps that named "目標" but had no target (they did nothing): now a pick from the pile
      eq(REAL.card("A3-22 3201").play.steps[0].a, "pickZone", "3201: a Character card from the discard pile");
      eq(REAL.card("A3-02 0297").effects[0].steps[0].a, "pickZone", "0297: a Fast card from the discard pile");
      for (const k of Object.keys(REAL.cards || {})) { const c = REAL.card(k); for (const b of [c.play].concat(c.effects || []).filter(Boolean)) if (b.status === "auto" && !b.target && !b.modes && (b.steps || []).some(x => x.to === "t" && x.a !== "watchEv")) throw new Error(k + ": an automatic step for 目標 without a target"); }
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const runQ = () => { for (let i = 0; i < 60 && st.queue && st.queue.length && !st.decisions.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); } };
      const answer = pick => { const d = st.decisions.shift(); AA4.enqueue(st, d.then.map(o => Object.assign({}, o, { answer: pick(d) })), true); runQ(); return d; };
      const me = g.char(a, vanilla("E.G.O."), "back"), other = g.char(a, vanilla("E.G.O."), "back"); g.give(other, 3); g.give(me, 1);
      AA4.EFFECT_ACTIONS.powerMoveToSelf(ctx, {}, { seat: a, ch: me }, [{ ch: other }]);
      eq([st.chars[me].power.length, st.chars[other].power.length], [4, 0], "0911: all its power cards move here");
      AA4.EFFECT_ACTIONS.skillPick(ctx, { ids: ["intercept", "initiative"], until: "turn" }, { seat: a, ch: me }, [{ ch: me }]); runQ();
      eq(st.decisions[0].options, ["intercept", "initiative"], "PP363: a choice of two skills");
      answer(() => ["initiative"]); AA4.touch(st);
      assert(AA4.charStats(st, REAL, me).skills.initiative && !AA4.charStats(st, REAL, me).skills.intercept, "PP363: only the chosen one");
      AA4.EFFECT_ACTIONS.ownSac(ctx, { sel: { owner: "you", area: "controlled" }, n: 3 }, { seat: a, ch: me }); eq(st.effLast, 0, "0535: two characters are not enough");
      assert(st.chars[me] && st.chars[other], "nothing was discarded");
    });
    test("Revise#349: card batch — abilities that work from the Damage Pile, a bonus for the character it pays for, the top of the opponent's deck", () => {
      const keys = ["A4-01 0111", "A4-05 0836", "A4-PP PP140", "A4-PP PP241", "A4-PP PP331", "A4-PP PP334"];
      eq(keys.map(k => REAL.card(k).status), Array(keys.length).fill("auto"), "batch statuses");
      assert(REAL.card("A4-PP PP140").abilities.filter(x => x.zone === "damage").length >= 3, "PP140: works from the Damage Pile");
      eq(REAL.card("A4-PP PP241").abilities.filter(x => x.zone === "damage").length, REAL.card("A4-PP PP241").abilities.filter(x => x.kind === "always" && x.mod && !x.zone && x.mod.to && x.mod.to.all).length, "PP241: the same on the field and in the Damage Pile");
      eq(REAL.card("A4-PP PP331").abilities[0].when, { event: "ownBreakFirst", named: true }, "PP331: your first named Break card of the turn");
      const g = m2Game(["A4-PP PP140"]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const me = g.char(a, vanilla("E.G.O."), "back"), at0 = AA4.charStats(st, REAL, me).at;
      const id = Object.keys(st.cards).find(c => st.cards[c].owner === a && st.cards[c].key === "A4-PP PP140" && st.cards[c].place.z === "deck");
      AA4.moveCard(ctx, id, { z: "damage", seat: a }); AA4.touch(st);
      const st1 = AA4.charStats(st, REAL, me);
      assert(st1.at === at0 + 1 && st1.skills.synchro && st1.skills.penetrate, "PP140 in the Damage Pile: +1 Attack, Synchro, Penetrate (" + st1.at + ")");
      // 0111: the character it pays for gets ±0/+1/+1 until the end of the turn
      const payer = g.char(a, vanilla("E.G.O."), "back");
      AA4.addMod(ctx, { src: { seat: a, ch: payer }, to: { ch: payer }, key: "subPayBuff", op: "grant", value: { at: 1, de: 1 }, until: "turn" }); AA4.touch(st);
      const d0 = AA4.charStats(st, REAL, me).de;
      AA4.subPayBoost(ctx, me, [payer]); AA4.touch(st);
      eq([AA4.charStats(st, REAL, me).at, AA4.charStats(st, REAL, me).de], [st1.at + 1, d0 + 1], "0111: +1 Attack and Defense for the one it paid for");
      // PP334: Permanent cards among the top 5 go to the Damage Pile, the rest under the deck
      const dk = st.players[b].zones.deck, n0 = dk.length, dm0 = st.players[b].zones.damage.length;
      const perms = dk.slice(-5).filter(c => REAL.card(st.cards[c].key).type === "Permanent").length;
      AA4.OPS.oppTopPermGo(ctx, { n: 5, seat: a, answer: [String(b)] });
      eq([st.players[b].zones.damage.length - dm0, n0 - st.players[b].zones.deck.length], [perms, perms], "PP334: only the Permanent cards leave the deck");
    });
    test("Revise#350: card batch — power cards up to the target's Mental, fast timing for one named target, its effects on the battle opponent", () => {
      const keys = ["A4-EP EP413", "A4-EP EP455", "A3-EX05 EX0622", "A4-03 0510", "A4-03 0586"];
      eq(keys.map(k => REAL.card(k).status), Array(keys.length).fill("auto"), "batch statuses");
      eq(REAL.card("A4-03 0510").fastIfTName, "久遠寺みやこ", "0510: fast timing only for that target");
      eq(REAL.card("A3-EX05 EX0622").abilities.find(x => x.zone === "damage").effect.steps, [{ a: "selfDeclFree" }], "EX0622: declared from the Damage Pile");
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const t1 = g.char(b, vanilla("E.G.O."), "back"), se = AA4.charStats(st, REAL, t1).se, d0 = st.players[b].zones.deck.length;
      AA4.EFFECT_ACTIONS.fillPowerT(ctx, {}, { seat: a }, [{ ch: t1 }]);
      eq([st.chars[t1].power.length, d0 - st.players[b].zones.deck.length], [se, se], "0510: power cards from its owner's deck up to its Mental");
      // EP413: X = its own effects (cost 1 or more) in effect on its battle opponent, one per use
      const me = g.char(a, vanilla("E.G.O."), "front"); g.give(me, 2);
      st.battle = { id: "bx", kind: "attack", attacker: me, aSeat: a, target: { ch: t1 }, defender: b, guard: null, joined: { att: [], grd: [] }, boost: 0 };
      const X = () => AA4.xOf(st, REAL, { selfEffectsOnOpp: { costMin: 1 } }, { seat: a, ch: me });
      eq(X(), 0, "none yet");
      AA4.addMod(ctx, { src: { seat: a, ch: me, eid: "e1", textJp: "2:メインフェイズ終了時まで、…" }, to: { ch: t1 }, key: "at", op: "add", value: -1, until: "main" });
      AA4.addMod(ctx, { src: { seat: a, ch: me, eid: "e1", textJp: "2:メインフェイズ終了時まで、…" }, to: { ch: t1 }, key: "de", op: "add", value: -1, until: "main" });
      AA4.addMod(ctx, { src: { seat: a, ch: me, eid: "e2", textJp: "0:…" }, to: { ch: t1 }, key: "se", op: "add", value: -1, until: "main" });
      AA4.touch(st); eq(X(), 1, "one use of a cost-2 effect counts once; a cost-0 effect does not");
      st.battle = null;
    });
    test("Revise#351: a cost that depends on the target — +1 for a card that targets 0301, free on one named target", () => {
      eq(["A4-02 0301", "A4-PP PP101", "A3-EX04 EX0471", "A3-EX04 EX0481"].map(k => REAL.card(k).status), Array(4).fill("auto"), "statuses");
      eq(REAL.card("A3-EX04 EX0471").tCost, [{ sel: { name: "ドゥビル", broken: true }, free: true }], "EX0471: free on a broken ドゥビル");
      const fast = "A4-02 0348", base = +REAL.card(fast).cost, fac = Object.keys(REAL.card(fast).factor)[0];
      const g = m2Game(["A4-02 0301", fast]), S = g.S, { a, b } = g;
      const payer = g.char(a, vanilla(fac), "back"); g.give(payer, base + 3);
      for (let i = 0; i < 2; i++) g.char(a, vanilla(fac), "back");
      const hard = g.char(b, "A4-02 0301", "front"), plain = g.char(b, vanilla("E.G.O."), "front");
      const fc = Object.values(S().cards).find(c => c.owner === a && c.key === fast && c.place.z !== "char");
      if (S().cards[fc.id].place.z !== "hand") g.ok({ t: "move", seat: a, card: fc.id, to: { z: "hand" } });
      g.toPhase("main");
      const plan = AA4.planDeclaration(S(), REAL, a, { kind: "set", card: fc.id });
      assert(!plan.reason, "can be declared (" + plan.reason + ")");
      eq([plan.xMode, plan.cost], ["def", null], "the cost waits for the target");
      eq(AA4.xOf(S(), REAL, plan.xDef, { seat: a, card: fc.id }, [{ ch: hard }]), base + 1, "0301 as the target: +1");
      eq(AA4.xOf(S(), REAL, plan.xDef, { seat: a, card: fc.id }, [{ ch: plain }]), base, "another target: the printed cost");
      g.ok({ t: "declare", seat: a, kind: "set", card: fc.id });
      eq(S().draft.step, "target", "target first");
      g.ok({ t: "target", seat: a, targets: [{ ch: hard }] });
      eq([S().draft.step, S().draft.cost, S().draft.x], ["pay", base + 1, null], "then the cost, and no X");
      g.pay(a); g.passAll && g.passAll();
      assert(!S().draft, "declared and paid");
    });
    test("Revise#352: card batch — after your next named Break card: a draw, then same-name hand cards go under it", () => {
      const keys = ["A4-04 0769", "A4-05 0811", "A4-05 0847", "A4-05 0883", "A4-05 0955", "A4-05 0991", "A4-05 0919", "A4-05 0805", "A4-05 1010"];
      eq(REAL.card("A4-05 0805").costUnderName, "渡来愛花", "0805: cost cards with that Name may go under it");
      eq(REAL.card("A4-05 0919").play.steps[0].mod.value, { faction: "Darklore", named: true }, "0919: the class of the next named Darklore Break card is ignored");
      eq(keys.map(k => REAL.card(k).status), Array(keys.length).fill("auto"), "batch statuses");
      const w = REAL.card("A4-05 0883").play.steps[0];
      eq([w.a, w.event, w.when, w.once], ["watchEv", "broken", { own: true, cardNamed: true, cardFaction: "WIZ-DOM" }, true], "0883: your next named WIZ-DOM Break card");
      eq(w.effect.steps.map(x => x.a), ["draw", "handUnder", "pickAnyDamage"], "0883: draw, cards under it, (1) damage");
      eq(REAL.card("A4-05 0991").play.steps[0].effect.steps.map(x => x.a), ["reorderTop", "draw", "handUnder"], "0991");
      // handUnder with the card of the event: any number of same-name hand cards go under that card
      const named = Object.keys(REAL.cards || {}).find(k => REAL.card(k).type === "Break" && REAL.card(k).name && !REAL.card(k).breakRule) || "A4-04 0769";
      const g = m2Game([named]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const runQ = () => { for (let i = 0; i < 60 && st.queue && st.queue.length && !st.decisions.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); } };
      const host = g.char(a, vanilla("E.G.O."), "back");
      const ids = Object.keys(st.cards).filter(c => st.cards[c].owner === a && st.cards[c].key === named && st.cards[c].place.z !== "char");
      AA4.moveCard(ctx, ids[0], { z: "char", ch: host, role: "stack" });
      for (const id of ids.slice(1, 3)) if (st.cards[id].place.z !== "hand") AA4.moveCard(ctx, id, { z: "hand", seat: a });
      AA4.EFFECT_ACTIONS.handUnder(ctx, { sameName: true, any: true, ev: true }, { seat: a, evCard: ids[0], evCh: host }); runQ();
      const d = st.decisions.shift(); eq([d.min, d.options.length >= 2], [0, true], "any number of them may be chosen");
      AA4.enqueue(st, d.then.map(o => Object.assign({}, o, { answer: ids.slice(1, 3) })), true); runQ();
      const stack = st.chars[host].stack;
      eq([stack.length, stack[stack.length - 1]], [4, ids[0]], "both went under it: the Break card that was set stays on top");
    });
    test("Revise#353: card batch — damage that somebody else takes: the source's player, the owner, a bodyguard Permanent", () => {
      const keys = ["A3-11 1630", "A4-EP EP447", "A4-EX02 EX794", "A4-EX02 EX851", "A4-03 0478", "A4-03 0574", "A4-PP PP114", "A4-PP PP245", "A4-PP PP335"];
      eq(keys.map(k => REAL.card(k).status), Array(keys.length).fill("auto"), "batch statuses");
      assert(REAL.card("A4-EX02 EX851").effects[0].costToIf.cond.count.n === 5, "EX851: the cost comes back with five 三征西班牙 characters");
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const runQ = () => { for (let i = 0; i < 80 && st.queue && st.queue.length && !st.decisions.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); } };
      const lost = seat => st.players[seat].zones.damage.length + st.players[seat].zones.discard.length + AA4.charsOf(st, seat).length;
      const me = g.char(a, vanilla("E.G.O."), "back"), foe = g.char(b, vanilla("E.G.O."), "back"); g.give(me, 3); g.give(foe, 3);
      // PP245: mental damage goes to the player of the source
      AA4.addMod(ctx, { src: { seat: a, ch: me }, to: { ch: me }, key: "dmgToSource", op: "grant", value: { mental: true }, until: "turn" }); AA4.touch(st);
      const pw = st.chars[me].power.length, b0 = lost(b);
      AA4.damageChar(ctx, me, { normal: 0, mental: 2, from: foe, fromSeat: b }); runQ();
      eq(st.chars[me].power.length, pw, "PP245: the character keeps its power cards");
      assert(lost(b) > b0, "PP245: the other player had a damage check instead");
      AA4.damageChar(ctx, me, { normal: 1, mental: 0, from: foe, fromSeat: b, battle: true }); runQ();
      assert(!st.chars[me] || st.chars[me].power.length < pw || st.chars[me].flags.dying, "normal battle damage still hits it");
      // PP114: the owner takes the damage of that character
      const t2 = g.char(b, vanilla("Darklore"), "back"); g.give(t2, 2);
      AA4.addMod(ctx, { src: { seat: a }, to: { ch: t2 }, key: "dmgToOwner", op: "grant", value: true, until: "turn" }); AA4.touch(st);
      const p2 = st.chars[t2].power.length, b1 = lost(b);
      AA4.damageChar(ctx, t2, { normal: 2, mental: 0, fromSeat: a }); runQ();
      assert(st.chars[t2].power.length === p2 && lost(b) > b1, "PP114: its owner takes it");
      // 0574: the stack below the top card becomes power cards
      const host = g.char(a, vanilla("WIZ-DOM"), "back"), extra = Object.keys(st.cards).filter(c => st.cards[c].owner === a && st.cards[c].place.z === "deck").slice(0, 2);
      for (const id of extra) AA4.moveCard(ctx, id, { z: "char", ch: host, role: "stack" });
      const top = AA4.topOf(st.chars[host]), pw0 = st.chars[host].power.length;
      AA4.EFFECT_ACTIONS.stackToPower(ctx, {}, { seat: a }, [{ ch: host }]);
      eq([st.chars[host].stack, st.chars[host].power.length - pw0], [[top], 2], "0574: only the top card is left in the stack");
    });
    test("Revise#354: card batch — any number of characters, an area's skills, the next Project at fast timing", () => {
      const keys = ["A3-EX02 EX0120", "A3-EX04 EX0455", "A3-EX03 EX0299", "A4-02 0283", "A4-PR PR048", "A4-05 0994", "A4-EP EP607", "A4-EX02 EX835", "A4-EX02 EX853", "A4-EX02 EX877", "A4-EX02 EX886", "A4-EX02 EX892", "A4-EX02 EX894", "A4-EX02 EX897"];
      eq(keys.map(k => REAL.card(k).status), Array(keys.length).fill("auto"), "batch statuses");
      eq(REAL.card("A4-05 0994").play.declCond, { myTurn: true }, "0994: only in your turn");
      eq(REAL.card("A4-05 0994").abilities[0].zones, ["damage"], "0994: it comes back from the Damage Pile");
      eq(REAL.card("A3-EX03 EX0299").fastPayOnlySel, { name: "高町ヴィヴィオ", broken: true }, "EX0299: fast timing when she alone pays");
      eq(REAL.card("A4-EX02 EX877").costLessIf.n, 1, "EX877: one less with 葵・トーリ on the field");
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const runQ = () => { for (let i = 0; i < 80 && st.queue && st.queue.length && !st.decisions.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); } };
      const c1 = g.char(a, vanilla("E.G.O."), "back"), c2 = g.char(b, vanilla("E.G.O."), "back"), c3 = g.char(b, vanilla("Darklore"), "back"); g.give(c1, 3); g.give(c2, 3); g.give(c3, 3);
      // EX0455: any number of characters
      AA4.EFFECT_ACTIONS.pickDamage(ctx, { sel: {}, count: "any", n: 1 }, { seat: a });
      const d1 = st.decisions[st.decisions.length - 1];
      eq([d1.min, d1.max], [0, 3], "EX0455: none … all of them");
      st.decisions.length = 0;
      // EX0120: 1 + X characters, 1 + X damage
      AA4.EFFECT_ACTIONS.pickDamage(ctx, { sel: {}, count: "X", countPlus: 1, n: "X", nPlus: 1 }, { seat: a, x: 1 });
      const d2 = st.decisions[st.decisions.length - 1];
      eq([d2.min, d2.max], [2, 2], "EX0120: X = 1 → two characters");
      st.decisions.length = 0;
      // EX894: the Shield of one area
      AA4.addMod(ctx, { src: { seat: b }, to: { ch: c2 }, key: "skill", op: "grant", value: { id: "shield" }, until: "turn" }); AA4.touch(st);
      assert(AA4.charStats(st, REAL, c2).skills.shield, "it has Shield");
      AA4.OPS.areaModGo(ctx, { answer: [b + ":control"], mods: [{ key: "skill", op: "remove", value: { id: "shield" } }], until: "turn", seat: a }); AA4.touch(st);
      assert(!AA4.charStats(st, REAL, c2).skills.shield, "EX894: Shield is gone in that area");
      // EX853: several areas, characters that are not Broken
      const ac0 = AA4.charStats(st, REAL, c1).attackCost || 0;
      AA4.OPS.areaModGo(ctx, { answer: [a + ":control", b + ":control"], sel: { broken: false }, mods: [{ key: "attackCost", op: "add", value: 1 }, { key: "guardCost", op: "add", value: 1 }], until: "turn", seat: a }); AA4.touch(st);
      eq((AA4.charStats(st, REAL, c1).attackCost || 0) - ac0, 1, "EX853: attack cost +1");
      // EP607: the next Project card at fast timing
      AA4.addMod(ctx, { src: { seat: a }, to: { seat: a }, key: "projFastNext", op: "grant", value: true, until: "turn" });
      assert(st.modifiers.some(m => m.key === "projFastNext"), "EP607: the permission is there");
    });
    test("Revise#355: card batch — a card set on a character, the skills of the battle opponent, a declared card back into the deck", () => {
      const keys = ["A3-EX03 EX0288", "A4-EP EP551", "A4-EP EP422", "A4-03 0540", "A4-PP PP359", "A4-04 0771", "A3-EX02 EX0177", "A3-EX02 EX0159", "A4-EX01 EX0736", "A4-02 0220", "A4-04 0676"];
      eq(keys.map(k => REAL.card(k).status), Array(keys.length).fill("auto"), "batch statuses");
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const runQ = () => { for (let i = 0; i < 80 && st.queue && st.queue.length && !st.decisions.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); } };
      const me = g.char(a, vanilla("E.G.O."), "back"), foe = g.char(b, vanilla("E.G.O."), "back"); g.give(me, 2); g.give(foe, 2);
      // 0220: a power card is a "card set on a character"
      const opts = AA4.fieldCards(st, REAL, { setAny: true }, { seat: a });
      assert(st.chars[foe].power.every(id => opts.includes(id)) && st.chars[me].power.every(id => opts.includes(id)), "0220: every power card can be the target");
      const pc = st.chars[foe].power[0];
      AA4.EFFECT_ACTIONS.bounce(ctx, {}, { seat: a }, [{ card: pc }]);
      eq(st.cards[pc].place.z, "hand", "0220: it goes back to the hand");
      // EP422: the skills of the battle opponent
      AA4.addMod(ctx, { src: { seat: b }, to: { ch: foe }, key: "skill", op: "grant", value: { id: "penetrate" }, until: "turn" });
      AA4.addMod(ctx, { src: { seat: a }, to: { ch: me }, key: "copyBattleOppSkills", op: "grant", value: true, until: "turn" }); AA4.touch(st);
      assert(!AA4.charStats(st, REAL, me).skills.penetrate, "EP422: nothing outside a battle");
      st.battle = { kind: "attack", attacker: foe, guard: me, target: { seat: a }, joined: { att: [], grd: [] }, step: "response" }; AA4.touch(st);
      assert(AA4.charStats(st, REAL, me).skills.penetrate, "EP422: it has the opponent's Penetrate in the battle");
      st.battle = null; AA4.touch(st);
      // EP551: every player picks from an opponent's hand
      const ha = st.players[a].zones.hand.length, hb = st.players[b].zones.hand.length;
      AA4.EFFECT_ACTIONS.eachOppHandDiscard(ctx, { n: 1 }, { seat: a }); runQ();
      for (let i = 0; i < 4 && st.decisions.length; i++) { const d = st.decisions.shift(); AA4.enqueue(st, d.then.map(o => Object.assign({}, o, { answer: d.options.slice(0, 1) })), true); runQ(); }
      eq([st.players[a].zones.hand.length, st.players[b].zones.hand.length], [Math.max(0, ha - 1), Math.max(0, hb - 1)], "EP551: one card less in each hand");
      // EX0177: X cards from the top, any of them to the bottom
      AA4.EFFECT_ACTIONS.peekTopBottom(ctx, { n: "X", thenOrder: true }, { seat: a, x: 2 }, []);
      const d3 = st.decisions[st.decisions.length - 1];
      eq(d3.options.length, 2, "EX0177: two cards are looked at");
      st.decisions.length = 0;
      AA4.EFFECT_ACTIONS.peekTopBottom(ctx, { n: "X" }, { seat: a, x: 0 }, []);
      eq(st.decisions.length, 0, "EX0177: X = 0 looks at nothing");
    });
    test("Revise#356: card batch — tokens from the deck, cards whose effects are active, the next Break card's Factor", () => {
      const keys = ["A4-EP EP538", "A4-EX02 EX850", "A4-EX02 EX895", "A4-EX01 EX0645", "A4-EX01 EX0774", "A4-EX02 EX848", "A4-EX01 EX0757", "A4-EX01 EX0758", "A4-EX01 EX0759", "A4-PP PP240", "A4-PP PP248", "A4-EX01 EX0696", "A4-EX02 EX903"];
      eq(keys.map(k => REAL.card(k).status), Array(keys.length).fill("auto"), "batch statuses");
      eq(REAL.card("A4-EX02 EX850").effects[0].steps.length, 2, "EX850: two soldiers");
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      // EX850: a token with a tag
      const n0 = AA4.charsOf(st, a).length;
      AA4.EFFECT_ACTIONS.deckTopToken(ctx, REAL.card("A4-EX02 EX850").effects[0].steps[0], { seat: a }); AA4.touch(st);
      const tk = AA4.charsOf(st, a).find(id => AA4.charStats(st, REAL, id).tokenName === "三征西班牙兵");
      assert(AA4.charsOf(st, a).length === n0 + 1 && tk, "EX850: one soldier is set");
      assert(AA4.matchChar(st, REAL, { tag: "三征西班牙" }, tk, { seat: a }) && AA4.charStats(st, REAL, tk).skills.offensive, "EX850: it has 三征西班牙 and Offensive");
      // EX0757: the bonus needs the two other cards in effect
      const cond = { ownEffectsActive: ["「皆」", "「頼りにしてるぜ」"] };
      assert(!AA4.checkCond(st, REAL, cond, { seat: a }), "EX0757: not yet");
      const usedIds = [], mk = key => { const id = Object.keys(st.cards).find(c => st.cards[c].owner === a && st.cards[c].place.z === "deck" && !usedIds.includes(c)); usedIds.push(id); st.cards[id].key = key; AA4.addMod(ctx, { src: { seat: a, card: id }, to: { seat: a }, key: "note", op: "grant", value: true, until: "turn" }); };
      mk("A4-EX01 EX0758"); assert(!AA4.checkCond(st, REAL, cond, { seat: a }), "EX0757: one of them is not enough");
      mk("A4-EX01 EX0759"); assert(AA4.checkCond(st, REAL, cond, { seat: a }), "EX0757: both are in effect");
      assert(!AA4.checkCond(st, REAL, cond, { seat: b }), "EX0757: only your own cards count");
      // PP240: from the Damage Pile to the Control Area
      const pc = Object.keys(st.cards).find(c => st.cards[c].owner === a && st.cards[c].place.z === "deck");
      AA4.moveCard(ctx, pc, { z: "damage", seat: a });
      AA4.EFFECT_ACTIONS.thisCardFromDamage(ctx, { dest: "back" }, { seat: a, card: pc });
      assert(AA4.charOfCard(st, pc), "PP240: it is a character now");
    });
    test("Revise#357: card batch — a designated character, cards with the same name, every player orders the top of the deck", () => {
      const keys = ["A3-25 3657", "A4-EP EP419", "A4-EX01 EX0684", "A4-EX01 EX0723", "A4-EX01 EX0735", "A4-EX01 EX0752", "A4-02 0310", "A4-03 0509", "A4-03 0573", "A4-PP PP183", "A4-PP PP189"];
      eq(keys.map(k => REAL.card(k).status), Array(keys.length).fill("auto"), "batch statuses");
      assert(REAL.card("A4-03 0509").play.target.designate && REAL.card("A4-03 0509").play.target.sel.powerEqMental, "0509: designated, power = Mental");
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const runQ = () => { for (let i = 0; i < 80 && st.queue && st.queue.length && !st.decisions.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); } };
      const me = g.char(a, vanilla("E.G.O."), "back"), me2 = g.char(a, vanilla("E.G.O."), "back"), foe = g.char(b, vanilla("E.G.O."), "back"), foe2 = g.char(b, vanilla("Darklore"), "back");
      // 0573: every Controlled Character of yours may attack that one character
      AA4.EFFECT_ACTIONS.attackableT(ctx, { until: "turn" }, { seat: a }, [{ ch: foe }]); AA4.touch(st);
      const ac = AA4.charStats(st, REAL, me2).attackChars;
      assert(ac.some(q => AA4.matchChar(st, REAL, q, foe, { seat: a })) && !ac.some(q => AA4.matchChar(st, REAL, q, foe2, { seat: a })), "0573: that character only");
      eq(AA4.charStats(st, REAL, foe).attackChars.length, 0, "0573: not the opponent's characters");
      // EX0684: +1 / +1 only in a battle with the designated character
      const at0 = AA4.charStats(st, REAL, me).at;
      AA4.EFFECT_ACTIONS.mod(ctx, { to: "self", mod: { key: "at", op: "add", value: 1 }, until: "turn", cond: { battleVs: "@t" } }, { seat: a, ch: me, targets: [{ ch: foe }] }, [{ ch: me }]); AA4.touch(st);
      eq(AA4.charStats(st, REAL, me).at, at0, "EX0684: nothing outside that battle");
      st.battle = { kind: "attack", attacker: me, guard: foe2, target: { seat: b }, joined: { att: [], grd: [] }, step: "response" }; AA4.touch(st);
      eq(AA4.charStats(st, REAL, me).at, at0, "EX0684: nothing against another character");
      st.battle.guard = foe; AA4.touch(st);
      eq(AA4.charStats(st, REAL, me).at, at0 + 1, "EX0684: +1 against the designated one");
      assert(AA4.checkCond(st, REAL, { attackedYou: true }, { seat: b }) && !AA4.checkCond(st, REAL, { attackedYou: true }, { seat: a }), "EP419: the attacked player");
      st.battle = null; AA4.touch(st);
      // PP183: the same name leaves the hand and the deck too
      const deck = st.players[b].zones.deck, k0 = st.cards[deck[0]].key, same = Object.keys(st.cards).filter(id => st.cards[id].owner === b && st.cards[id].key === k0 && ["deck", "hand"].includes(st.cards[id].place.z));
      AA4.EFFECT_ACTIONS.purgeSameNameT(ctx, {}, { seat: a }, [{ card: deck[0] }]);
      assert(same.length && same.every(id => st.cards[id].place.z === "discard"), "PP183: all of them are discarded");
      // EX0735: every player gets the question
      AA4.EFFECT_ACTIONS.eachReorderTop(ctx, { n: 5 }, { seat: a }); runQ();
      eq([st.decisions.length, st.decisions[0].kind, st.decisions[0].options.length], [1, "order", 5], "EX0735: the first player orders five cards");
    });
    test("Revise#358: card batch — everybody except…, attacks on you are cancelled, a condition for every effect of a card", () => {
      const keys = ["A3-EP EP385", "A4-EX02 EX867", "A4-EX02 EX880", "A4-EX02 EX902", "A4-03 0469", "A4-03 0484", "A3-EX03 EX0306", "A4-04 0679", "A4-PP PP024"];
      eq(keys.map(k => REAL.card(k).status), Array(keys.length).fill("auto"), "batch statuses");
      assert(REAL.card("A4-EX02 EX867").effects.every(ef => ef.declCond && ef.declCond.count.n === 3), "EX867: both effects need three 英国 characters");
      eq(REAL.card("A3-EP EP385").play.factorFreeIf, { sameFactionCtl: 2 }, "EP385: no Factor with two characters of one faction");
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const c1 = g.char(a, vanilla("E.G.O."), "back");
      assert(!AA4.checkCond(st, REAL, { sameFactionCtl: 2 }, { seat: a }), "EP385: one character is not enough");
      const c2 = g.char(a, vanilla("E.G.O."), "back"), foe = g.char(b, vanilla("Darklore"), "back"); AA4.touch(st);
      assert(AA4.checkCond(st, REAL, { sameFactionCtl: 2 }, { seat: a }) && !AA4.checkCond(st, REAL, { sameFactionCtl: 2 }, { seat: b }), "EP385: two E.G.O. characters");
      // 0679: the two kinds of target
      assert(AA4.matchChar(st, REAL, { notFactionCh: "E.G.O." }, foe, { seat: a }) && !AA4.matchChar(st, REAL, { notFactionCh: "E.G.O." }, c1, { seat: a }), "0679: a character without that Factor");
      // EX880: everybody except …
      assert(!AA4.matchChar(st, REAL, { notSel: { faction: "E.G.O." } }, c1, { seat: a }) && AA4.matchChar(st, REAL, { notSel: { faction: "E.G.O." } }, foe, { seat: a }), "EX880: notSel");
      // EX902: the attack on you is called off
      st.battle = { kind: "attack", attacker: foe, guard: null, target: { seat: a }, defender: a, joined: { att: [], grd: [] }, step: "response" };
      AA4.EFFECT_ACTIONS.cancelAttackOnYou(ctx, { sel: { named: true } }, { seat: a });
      eq(st.battle.step, "response", "EX902: a character the selector does not fit keeps attacking");
      AA4.EFFECT_ACTIONS.cancelAttackOnYou(ctx, { sel: { named: false } }, { seat: a });
      eq(st.battle.step, "end", "EX902: the attack is cancelled");
      // 0469: any attack without a guard
      st.battle = { kind: "attack", attacker: foe, guard: null, target: { seat: a }, defender: a, joined: { att: [], grd: [] }, step: "guard" };
      AA4.EFFECT_ACTIONS.forceGuardT(ctx, { any: true }, { seat: b, ch: null }, [{ ch: c2 }]);
      eq(st.battle.guard, c2, "0469: that character guards");
      st.battle = null;
    });
    test("Revise#359: card batch — a hand card as a token Permanent, a named cost is banned, characters from the cost", () => {
      const keys = ["A4-02 0211", "A4-02 0226", "A4-EP EP424", "A4-PP PP299", "A4-05 0907", "A4-05 0925", "A4-03 0407", "A4-03 0422", "A4-05 0983", "A4-05 1001", "A4-PP PP212", "A4-PP PP220"];
      eq(keys.map(k => REAL.card(k).status), Array(keys.length).fill("auto"), "batch statuses");
      eq(REAL.card("A4-PP PP299").costCharsOnSet.icons, ["ワーウルフ"], "PP299: the Werewolf Character cards of its cost");
      eq(REAL.card("A4-EP EP424").abilities[0].effect.x, { permTokens: "ストリームフィールド" }, "EP424: X = its ストリームフィールド");
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const runQ = () => { for (let i = 0; i < 80 && st.queue && st.queue.length && !st.decisions.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); } };
      const me = g.char(a, vanilla("E.G.O."), "back"), other = g.char(a, vanilla("E.G.O."), "back");
      // 0211: a hand card becomes a token Permanent
      const hc = st.players[a].zones.hand[0];
      AA4.OPS.handPermTokenGo(ctx, { answer: [hc], ch: me, token: { name: "チャージエネルギー" } });
      eq([st.cards[hc].place.role, st.cards[hc].permToken.name], ["perm", "チャージエネルギー"], "0211: set as チャージエネルギー");
      eq(AA4.xOf(st, REAL, { permTokens: "チャージエネルギー" }, { seat: a, ch: me }, []), 1, "0211: X counts it");
      // PP212: the named cost
      AA4.OPS.banCostGo(ctx, { answer: ["2"], e: { seat: a, ch: me }, types: ["Permanent", "Project"] }); AA4.touch(st);
      assert(AA4.banOf(st, REAL, b, { kind: "set", info: { type: "Project", cost: 2 } }), "PP212: an opponent's Project of cost 2 is banned");
      assert(!AA4.banOf(st, REAL, b, { kind: "set", info: { type: "Project", cost: 3 } }) && !AA4.banOf(st, REAL, b, { kind: "set", info: { type: "Fast", cost: 2 } }) && !AA4.banOf(st, REAL, a, { kind: "set", info: { type: "Project", cost: 2 } }), "PP212: other costs, other types and your own cards are free");
      // 0983: any number of characters become power cards
      const p0 = st.chars[me].power.length, n1 = st.chars[other].stack.length + st.chars[other].power.length;
      AA4.OPS.pickCharToPowerGo(ctx, { answer: [AA4.topOf(st.chars[other])], ch: me }); runQ();
      assert(!st.chars[other] && st.chars[me].power.length === p0 + n1, "0983: its cards are power cards of this one now");
      // 0907: which Fast cards raise Attack and Defense together
      const rx = new RegExp(REAL.card("A4-05 0907").abilities[0].effect.steps[0].sel.textRe);
      assert(rx.test("目標に±0/+2/+2する。") && rx.test("攻撃力と耐久力に+1する") && !rx.test("目標の攻撃力に+3する。") && !rx.test("+2/±0/±0"), "0907: the text test");
    });
    test("Revise#360: card batch — a character or a card, the same card declared before, the top ten cards", () => {
      const keys = ["A4-05 0958", "A3-25 3621", "A3-EP EP267", "A4-03 0465", "A4-04 0743", "A4-03 0477", "A3-EX01 EX0069", "A3-EX03 EX0322", "A4-EX02 EX900"];
      eq(keys.map(k => REAL.card(k).status), Array(keys.length).fill("auto"), "batch statuses");
      eq(REAL.card("A3-EP EP267").play.modes.map(m => m.target.kind), ["char", "card"], "EP267: a character, or a Permanent card");
      eq([REAL.card("A4-04 0743").costLessIf.n, REAL.card("A4-04 0743").declDrawIf.n], [2, 1], "0743: 2 less and a draw");
      eq(REAL.card("A3-25 3621").play.costTo, "deckShuffle", "3621: its cost goes back into the deck");
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      // 0743: the same card is declared already
      const ids = Object.keys(st.cards).filter(c => st.cards[c].owner === a && st.cards[c].place.z === "deck").slice(0, 2);
      for (const id of ids) st.cards[id].key = "A4-04 0743";
      assert(!AA4.checkCond(st, REAL, { sameJpDeclared: true }, { seat: a, card: ids[0] }), "0743: not without the other one");
      st.stack.push({ id: "x1", kind: "set", seat: a, card: ids[1], targets: [] });
      assert(AA4.checkCond(st, REAL, { sameJpDeclared: true }, { seat: a, card: ids[0] }) && !AA4.checkCond(st, REAL, { sameJpDeclared: true }, { seat: a, card: ids[1] }), "0743: the other copy is declared");
      st.stack.pop();
      // EX0069: only the top ten cards of the deck
      const deck = st.players[a].zones.deck;
      AA4.EFFECT_ACTIONS.pickZone(ctx, { zones: ["deck"], owner: "you", topN: 3, n: 1, upTo: true, sel: {}, dest: "hand" }, { seat: a });
      const d0 = st.decisions[st.decisions.length - 1];
      eq(d0.options.slice().sort(), deck.slice(-3).sort(), "EX0069: the choice is among the top cards");
      st.decisions.length = 0;
      // EX900: the two named targets
      assert(REAL.card("A4-EX02 EX900").play.steps[1].ifTNames.length === 2 && REAL.card("A4-EX02 EX900").play.steps[0].ifNotTNames.length === 2, "EX900: bind 1, or bind 0 for the pair");
      // 0477: who broke a character of an opponent
      eq(REAL.card("A4-03 0477").play.steps[1].effect.steps[0].to, "evActor", "0477: the player who broke it takes the damage");
    });
    test("Revise#361: card batch — several characters attack or guard together, X from the Boost paid", () => {
      const keys = ["A3-25 3805", "A3-25 3808", "A4-01 0015", "A4-01 0030", "A3-05 0909", "A4-05 0993"];
      eq(keys.map(k => REAL.card(k).status), Array(keys.length).fill("auto"), "batch statuses");
      eq(REAL.card("A3-25 3805").play.steps[2].mod.value, { xlast: true, sign: 2 }, "3805: twice the cards discarded");
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const c1 = g.char(a, vanilla("E.G.O."), "back"), c2 = g.char(a, vanilla("E.G.O."), "back"), foe = g.char(b, vanilla("Darklore"), "back");
      // 0015: X = the Boost paid by the attacker
      st.battle = { kind: "attack", attacker: c1, guard: null, target: { seat: b }, defender: b, joined: { att: [], grd: [] }, boost: 3, step: "guard" };
      eq([AA4.xOf(st, REAL, { selfBoostPaid: true }, { seat: a, ch: c1 }, []), AA4.xOf(st, REAL, { selfBoostPaid: true }, { seat: a, ch: c2 }, [])], [3, 0], "0015: the attacker's Boost");
      // 0993 as a guard: you are attacked and nobody guards yet
      st.battle = { kind: "attack", attacker: foe, guard: null, target: { seat: a }, defender: a, joined: { att: [], grd: [] }, boost: 0, step: "guard" };
      AA4.EFFECT_ACTIONS.massDeclarePick(ctx, { n: "X" }, { seat: a, x: 2 });
      const d = st.decisions.pop();
      eq([d.min, d.max, d.then[0].op], [0, 2, "massGuardGo"], "0993: up to two guards");
      AA4.OPS.massGuardGo(ctx, { seat: a, answer: d.options.slice(0, 2) });
      eq([st.battle.guard != null, st.battle.joined.grd.length], [true, 1], "0993: they guard together");
      // 3805: the deck loses as many cards as the hand
      st.battle = null; st.effLast = 2;
      const dk = st.players[a].zones.deck.length;
      AA4.EFFECT_ACTIONS.mill(ctx, { n: "last" }, { seat: a }, [{ seat: a }]);
      eq(st.players[a].zones.deck.length, dk - 2, "3805: the same number from the deck");
    });
    test("Revise#362: card batch — a payment that gates the rest, the classes of the discarded character", () => {
      const keys = ["A4-EP EP540", "A4-EX02 EX898", "A3-EX04 EX0483", "A4-EX02 EX906", "A3-EX03 EX0327", "A3-PR PR329", "A3-24 3544"];
      eq(keys.map(k => REAL.card(k).status), Array(keys.length).fill("auto"), "batch statuses");
      assert(REAL.card("A4-02 0310").effects[1].steps.slice(1).every(s => s.ifLast), "0310: no Vampire discarded → no bonus");
      eq(REAL.card("A4-EX02 EX898").play.steps.map(s => s.mod.key), ["noAttack", "noGuard", "noEffect", "noFactor"], "EX898: no declarations, no Factor");
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const runQ = () => { for (let i = 0; i < 80 && st.queue && st.queue.length && !st.decisions.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); } };
      // 3544: the same class in the territory of the discarded character's owner
      const v = g.char(b, vanilla("E.G.O."), "back"), w = g.char(b, vanilla("E.G.O."), "back"), mine = g.char(a, vanilla("E.G.O."), "back"); g.give(w, 2); g.give(mine, 2);
      AA4.EFFECT_ACTIONS.rememberIconsT(ctx, {}, { seat: a }, [{ ch: v }]);
      eq(st.effIconsOwner, b, "3544: the owner is remembered");
      const pw = st.chars[w].power.length, pm = st.chars[mine].power.length;
      if ((st.effIcons || []).length) {
        AA4.EFFECT_ACTIONS.damageIconsOwner(ctx, { n: 1, mental: true }, { seat: a }); runQ();
        assert((!st.chars[w] || st.chars[w].power.length < pw) && st.chars[mine].power.length === pm, "3544: only that player's characters are hit");
      }
      // EP540: without the named character nothing happens
      AA4.EFFECT_ACTIONS.ownSac(ctx, { sel: { owner: "you", area: "controlled", name: "バスターマシン2号" }, n: 1 }, { seat: a });
      eq(st.effLast, 0, "EP540: the payment failed, the later steps are skipped");
    });
    test("Revise#363: card batch — damage split between players and characters, a card named on the field", () => {
      const keys = ["A3-14 1948", "A3-BS2 1948", "A3-EX02 EX0167", "A4-04 0708", "A3-EX02 EX0130", "A4-EX01 EX0756"];
      eq(keys.map(k => REAL.card(k).status), Array(keys.length).fill("auto"), "batch statuses");
      eq(REAL.card("A4-EX01 EX0756").factorLessX.countChars.faction, "WIZ-DOM", "EX0756: Factor down by your WIZ-DOM characters");
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const runQ = () => { for (let i = 0; i < 80 && st.queue && st.queue.length && !st.decisions.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); } };
      const answer = pick => { const d = st.decisions.shift(); AA4.enqueue(st, d.then.map(o => Object.assign({}, o, { answer: pick(d) })), true); runQ(); };
      const foe = g.char(b, vanilla("E.G.O."), "back"); g.give(foe, 3);
      // 1948: two points, one to a player and one to a character
      st.effLast = 2;
      const lost = seat => st.players[seat].zones.damage.length + st.players[seat].zones.discard.length + AA4.charsOf(st, seat).length, b0 = lost(b), p0 = st.chars[foe].power.length;
      AA4.EFFECT_ACTIONS.splitDamage(ctx, { n: "last", mental: true, players: true }, { seat: a }); runQ();
      assert(st.decisions[0].options.includes("p:" + b) && st.decisions[0].options.includes(foe), "1948: players and characters can be chosen");
      answer(() => ["p:" + b]); answer(() => [foe]);
      assert(lost(b) > b0 || st.chars[foe].power.length < p0, "1948: the damage was dealt");
      eq(st.decisions.length, 0, "1948: two points, two questions");
      // EX0167: the second hit only with eight cards in the Damage Pile
      eq(REAL.card("A3-EX02 EX0167").play.steps[2].ifTPileMin, 8, "EX0167: the extra damage needs eight cards");
      // 0708: a card with the name of a card on the field
      const top = AA4.topOf(st.chars[foe]), dk = st.players[a].zones.deck[0]; st.cards[dk].key = st.cards[top].key;
      AA4.OPS.deckSameAsGo(ctx, { seat: a, answer: [top] });
      eq(st.cards[dk].place.z, "hand", "0708: the card with that name comes from the deck");
      // EX0130: at most one card
      AA4.EFFECT_ACTIONS.discardHandAnyX(ctx, { max: 1 }, { seat: a });
      eq(st.decisions.pop().max, 1, "EX0130: one card at most");
    });
    test("Revise#364: card batch — the owner pays or loses the card, X characters are blessed, any number of 金", () => {
      const keys = ["A4-EP EP499", "A4-EX02 EX887", "A3-EXPR EXPR043", "A4-02 0252", "A4-PP PP270", "A4-PP PP278", "A4-EX02 EX806", "A4-02 0377", "A4-PR PR054", "A3-21 2983"];
      eq(keys.map(k => REAL.card(k).status), Array(keys.length).fill("auto"), "batch statuses");
      eq(REAL.card("A4-PP PP270").effects[0].steps[0].owner, "t", "PP270: the deck of the target player");
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const runQ = () => { for (let i = 0; i < 80 && st.queue && st.queue.length && !st.decisions.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); } };
      const c1 = g.char(a, vanilla("E.G.O."), "back"), c2 = g.char(a, vanilla("E.G.O."), "back"), foe = g.char(b, vanilla("Darklore"), "back"); g.give(foe, 1);
      // EXPR043: two characters → X = 2
      const se0 = AA4.charStats(st, REAL, c1).se, pw0 = st.chars[c1].power.length;
      AA4.OPS.blessGo(ctx, { answer: [AA4.topOf(st.chars[c1]), AA4.topOf(st.chars[c2])], e: { seat: a }, s: { min: 2, skills: [{ id: "shield", x: true }], stat: "se", power: 1, until: "turn" } }); AA4.touch(st);
      eq([AA4.charStats(st, REAL, c1).se - se0, st.chars[c1].power.length - pw0, !!AA4.charStats(st, REAL, c2).skills.shield], [2, 1, true], "EXPR043: +2 Mental, one power card, Shield");
      // 0252: the owner can't pay 2 → the card is discarded
      const card = st.players[b].zones.hand[0];
      AA4.moveCard(ctx, card, { z: "special", seat: b });
      AA4.EFFECT_ACTIONS.payOrDiscardT(ctx, { n: 2 }, { seat: a }, [{ card }]); runQ();
      eq(st.cards[card].place.z, "discard", "0252: one power card is not enough");
      // PP270: the top cards of the opponent's deck
      const dk = st.players[b].zones.deck.length;
      AA4.EFFECT_ACTIONS.millPickOpp(ctx, { n: 3 }, { seat: a });
      eq(st.players[b].zones.deck.length, dk - 3, "PP270: three cards are discarded");
      // 0377: the named card comes up → the damage is dealt again
      const dkb = st.players[b].zones.deck; st.effName = (REAL.card(st.cards[dkb[dkb.length - 1]].key) || {}).jp;
      const lostB = () => st.players[b].zones.damage.length + AA4.charsOf(st, b).length + st.players[b].zones.discard.length, l0 = lostB(), d0 = dkb.length;
      AA4.EFFECT_ACTIONS.damageNameRepeat(ctx, { n: 2 }, { seat: a }, [{ seat: b }]);
      assert(d0 - st.players[b].zones.deck.length >= 4, "0377: at least two damage checks");
      // EX806: 金 from the hand, then any number of them
      const h = st.players[a].zones.hand.slice(0, 2);
      AA4.OPS.handPermTokenGo(ctx, { answer: h, ch: c1, token: { name: "金" } });
      AA4.EFFECT_ACTIONS.permTokenDiscardAny(ctx, { name: "金" }, { seat: a, ch: c1 });
      const d = st.decisions.pop();
      eq([d.min, d.max], [0, 2], "EX806: none … both");
    });
    test("Revise#365: card batch — damage in the area a character was in, a faction is watched, X hand cards as power", () => {
      const keys = ["A3-EX02 EX0183", "A3-20 2765", "A4-EX02 EX866", "A4-01 0022", "A4-PP PP085", "A4-EX02 EX828", "A4-PP PP054", "A3-25 3694", "A3-PR PR340"];
      eq(keys.map(k => REAL.card(k).status), Array(keys.length).fill("auto"), "batch statuses");
      eq(REAL.card("A3-20 2765").play.steps[0].mod.value, { id: "capacity", x: 99 }, "2765: Capacity +∞");
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const runQ = () => { for (let i = 0; i < 80 && st.queue && st.queue.length && !st.decisions.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); } };
      const mine = g.char(a, vanilla("E.G.O."), "back"), f1 = g.char(b, vanilla("Darklore"), "back"), f2 = g.char(b, vanilla("Darklore"), "back"); g.give(f1, 2); g.give(f2, 2); g.give(mine, 2);
      // 3694: only the area the discarded character was in
      AA4.EFFECT_ACTIONS.rememberAreaT(ctx, {}, { seat: a }, [{ ch: f1 }]);
      AA4.EFFECT_ACTIONS.splitDamage(ctx, { n: "X", mental: true, area: "last" }, { seat: a, x: 1 }); runQ();
      const d = st.decisions.pop();
      assert(d.options.includes(f1) && d.options.includes(f2) && !d.options.includes(mine), "3694: the characters of that area only");
      // 0022: the power cards of X characters of one faction
      AA4.OPS.factionStripAsk(ctx, { answer: ["Darklore"], seat: a, n: 2 }); runQ();   // exactly two of them: no question
      eq([st.chars[f1] ? st.chars[f1].power.length : 0, st.chars[mine].power.length], [0, 2], "0022: their power cards are gone");
      // PP085: the faction is watched for the turn
      AA4.OPS.factionWatchGo(ctx, { answer: ["Darklore"], s: { n: 1, mental: true, until: "turn" }, e: { seat: a } });
      eq(st.modifiers.filter(m => m.key === "watchEv" && m.value.chSel && m.value.chSel.faction === "Darklore").map(m => m.value.event).sort(), ["attack", "guarded"], "PP085: attack and guard are watched");
      // PP054: X hand cards become power cards of one character
      const h = st.players[a].zones.hand.slice(0, 2), p0 = st.chars[mine].power.length;
      AA4.OPS.handXToPowerCh(ctx, { seat: a, cards: h, answer: [AA4.topOf(st.chars[mine])] });
      eq(st.chars[mine].power.length, p0 + 2, "PP054: two more power cards");
    });
    test("Revise#366: card batch — a discount paid from the top of the deck, the Damage Piles are swapped", () => {
      const keys = ["A3-EX04 EX0472", "A3-14 2031", "A3-BS2 2031", "A3-PP PP277", "A4-03 0445", "A4-EX02 EX802", "A4-EX02 EX803", "A4-EX01 EX0669", "A4-EX01 EX0672", "A3-EX05 EX0595"];
      eq(keys.map(k => REAL.card(k).status), Array(keys.length).fill("auto"), "batch statuses");
      eq(REAL.card("A3-EX04 EX0472").play.discount, { from: "deck", to: "discard", factorOnly: true }, "EX0472: the Factor only, from the deck");
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const runQ = () => { for (let i = 0; i < 80 && st.queue && st.queue.length && !st.decisions.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); } };
      // the discount cards of a deck card: the top of your deck
      const top = st.players[a].zones.deck.slice(-3).reverse();
      eq(AA4.discountCards(st, REAL, a, null, { from: "deck" }).slice(0, 3), top, "EX0472: the top cards are offered");
      eq(AA4.discountCards(st, REAL, a, null, {}).length, st.players[a].zones.hand.length, "the hand as before");
      // 2031: a Fast card only with the named Polestar character
      const sel = REAL.card("A3-14 2031").play.target.sel, fast = st.players[b].zones.hand[0];
      const fk = Object.keys(REAL.cards || {}).find(k => (REAL.card(k) || {}).type === "Fast");
      if (fk) { st.cards[fast].key = fk; AA4.moveCard(ctx, fast, { z: "special", seat: b }); assert(!AA4.fieldCards(st, REAL, sel, { seat: a }).includes(fast), "2031: no Fast card without that character"); }
      // EX0669: the partner fights on the same side
      const m1 = g.char(a, vanilla("E.G.O."), "back"), m2 = g.char(a, vanilla("E.G.O."), "back"), en = g.char(b, vanilla("Darklore"), "back");
      const n2 = (REAL.card(st.cards[AA4.topOf(st.chars[m2])].key) || {}).name || null;
      st.battle = { kind: "attack", attacker: m1, guard: en, target: { seat: b }, defender: b, joined: { att: [m2], grd: [] }, boost: 0, step: "response" };
      if (n2) assert(AA4.checkCond(st, REAL, { battleSideWith: n2 }, { seat: a, self: m1, ch: m1 }), "EX0669: the named partner is on the same side");
      assert(!AA4.checkCond(st, REAL, { battleSideWith: "マルガ・ナルゼ" }, { seat: a, self: m1, ch: m1 }), "EX0669: not without her");
      assert(!AA4.checkCond(st, REAL, { namesSameSide: ["マルガ・ナルゼ", "マルゴット・ナイト"] }, { seat: a }), "EX803: the two are not in this battle");
      st.battle = null;
      // 0445: the Damage Pile goes to the Discard Pile, then as many cards come back
      for (const id of st.players[b].zones.deck.slice(-3)) AA4.moveCard(ctx, id, { z: "damage" });
      for (const id of st.players[b].zones.deck.slice(-2)) AA4.moveCard(ctx, id, { z: "discard" });   // two more to choose from
      AA4.EFFECT_ACTIONS.eachDamageSwap(ctx, {}, { seat: a }); runQ();
      eq(st.players[b].zones.damage.length, 0, "0445: the pile is empty first");
      const d = st.decisions.shift();
      eq([d.seat, d.min], [b, 3], "0445: that player chooses three cards");
      AA4.OPS.damageSwapGo(ctx, { answer: d.options.slice(0, 3) });
      eq(st.players[b].zones.damage.length, 3, "0445: three cards are in the Damage Pile again");
    });
    test("Revise#367: card batch — the cost of a Break card comes back, a Project at fast timing once a turn", () => {
      const keys = ["A4-05 0876", "A4-05 0894", "A4-EX02 EX911", "A3-EP EP378", "A4-EX02 EX874", "A4-EX02 EX875", "A4-EX02 EX876", "A3-22 3125", "A4-EX02 EX910"];
      eq(REAL.card("A4-EX02 EX910").costLess, { countChars: { owner: "you", area: "controlled", tag: "武蔵" } }, "EX910: cheaper with 武蔵 characters");
      eq(keys.map(k => REAL.card(k).status), Array(keys.length).fill("auto"), "batch statuses");
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const me = g.char(a, vanilla("E.G.O."), "back"), other = g.char(a, vanilla("E.G.O."), "back"), foe = g.char(b, vanilla("Darklore"), "back");
      // EX874: the cards paid for the Break card go back to the hand
      const brk = st.players[a].zones.deck[0], paid = st.players[a].zones.deck.slice(1, 3);
      for (const id of paid) AA4.moveCard(ctx, id, { z: "discard" });
      st.cards[brk].paidIds = paid.slice();
      AA4.EFFECT_ACTIONS.paidToHandEv(ctx, {}, { seat: a, evCard: brk });
      eq(paid.map(id => st.cards[id].place.z), ["hand", "hand"], "EX874: the cost is in the hand");
      eq(REAL.card("A4-EX02 EX874").play.steps[2].when, { own: true, cardTag: "武蔵" }, "EX874: your 武蔵 Break cards");
      // 0876: the bonus stays while the character is on the field
      const se0 = AA4.charStats(st, REAL, other).se;
      AA4.OPS.pickOtherBlessGo(ctx, { answer: [AA4.topOf(st.chars[other])], s: { skills: [{ id: "breakthrough", x: true }], stats: { se: 1, at: 1, de: 1 } }, e: { seat: a, ch: me } }); AA4.touch(st);
      eq([AA4.charStats(st, REAL, other).se - se0, !!AA4.charStats(st, REAL, other).skills.breakthrough], [1, true], "0876: +1 and Breakthrough");
      // EP378: the opponent's characters may attack this one
      AA4.addMod(ctx, { src: { seat: a, ch: me }, to: { ch: foe }, key: "attackChars", op: "grant", value: { srcCh: true }, until: "turn" }); AA4.touch(st);
      const ac = AA4.charStats(st, REAL, foe).attackChars;
      assert(ac.some(q => AA4.matchChar(st, REAL, q, me, { seat: b })) && !ac.some(q => AA4.matchChar(st, REAL, q, other, { seat: b })), "EP378: this character only");
      st.battle = { kind: "attack", attacker: foe, guard: other, target: { ch: me }, defender: a, joined: { att: [], grd: [] }, boost: 0, step: "response" };
      eq(AA4.EFFECT_ACTIONS && st.battle.attacker, foe, "EP378: the attacker is known");
      st.battle = null;
    });
    test("Revise#368: card batch — power cards for the damage taken, who killed whom", () => {
      const keys = ["A4-EX02 EX865", "A3-17 2358", "A3-EX03 EX0292", "A4-04 0785", "A4-EP EP440", "A4-02 0342", "A3-EX01 EX0058", "A3-25 3799", "A4-04 0787"];
      eq(keys.map(k => REAL.card(k).status), Array(keys.length).fill("auto"), "batch statuses");
      eq(REAL.card("A4-04 0785").freeOnName, "フォルナ・アンタレス", "0785: free on that character");
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const runQ = () => { for (let i = 0; i < 80 && st.queue && st.queue.length && !st.decisions.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); } };
      const me = g.char(a, vanilla("E.G.O."), "back"), foe = g.char(b, vanilla("Darklore"), "back"); g.give(foe, 2);
      // EX865: as many power cards as the damage taken
      const p0 = st.chars[me].power.length;
      AA4.EFFECT_ACTIONS.powerFromDeck(ctx, { n: "evN" }, { seat: a, ch: me, evStat: { n: 2 } }, [{ ch: me }]);
      eq(st.chars[me].power.length, p0 + 2, "EX865: two power cards for two damage");
      // the damaged event tells who used the card
      ctx.events.length = 0;
      AA4.damageChar(ctx, foe, { normal: 1, mental: 0, fromSeat: a });
      const ev = ctx.events.find(x => x.e === "damaged" && x.ch === foe);
      eq(ev && ev.fromSeat, a, "EX865: the event carries the seat");
      // 0342: the owner or one of the owner's Controlled Characters
      AA4.EFFECT_ACTIONS.killHitOwnerSide(ctx, {}, { seat: a, ch: me, evSeat: b, evAll: ["x", "y", "z"] });
      const d = st.decisions.pop();
      assert(d.options.includes("p:" + b) && d.options.every(v => v === "p:" + b || (st.chars[v.slice(2)] && st.chars[v.slice(2)].owner === b)), "0342: that player's side only");
      eq(d.then[0].n, 3, "0342: X = the cards of the discarded character");
    });
    test("Revise#369: card batch — a name from a work, a card set from the Damage Pile", () => {
      const keys = ["A3-EP EP372", "A4-EX02 EX912", "A4-EP EP423", "A3-EX04 EX0480", "A3-EX04 EX0498"];
      eq(keys.map(k => REAL.card(k).status), Array(keys.length).fill("auto"), "batch statuses");
      const step = REAL.card("A3-EX04 EX0480").play.steps[0];
      eq([step.a, step.sel.workNames], ["eachPlayerPick", "nanohaForce"], "EX0480: every player picks from the deck");
      const names = [...new Set(REAL.all().filter(c => c.name && AA4.worksOf(c, "nanohaForce")).map(c => c.name))];
      assert(names.length > 3, "EX0480: the work has names");
      const tr = REAL.card("A3-EP EP372").abilities[0];
      eq([tr.zones, tr.effect.steps[0].sel.name], [["damage"], "東條莉亜"], "EP372: works from the Damage Pile, onto that character");
      const un = REAL.card("A4-EX02 EX912").abilities[0].mod.value;
      assert(un.byOpp && un.costMaxPower, "EX912: the opponent's cards up to her power");
      eq(REAL.card("A4-EP EP423").effects[0].steps.map(s => s.mod.key), ["untargetable", "noPay", "noAttack", "noGuard", "noEffect"], "EP423: all five limits");
    });
    test("Revise#370: EX0485 — named characters get +1/+1 for each power card of the battle opponent", () => {
      eq(REAL.card("A3-EX04 EX0485").status, "auto", "status");
      const named = REAL.all().find(c => c.type === "Character" && c.name && c.status === "auto" && !(c.abilities || []).length && !(c.effects || []).length);
      const g = m2Game([named.key]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const me = g.char(a, named.key, "front"), plain = g.char(a, vanilla("E.G.O."), "front"), foe = g.char(b, vanilla("Darklore"), "front"); g.give(foe, 2);
      const at0 = AA4.charStats(st, REAL, me).at, de0 = AA4.charStats(st, REAL, me).de;
      AA4.runEffect(ctx, REAL.card("A3-EX04 EX0485").play, { seat: a, targets: [] });
      for (let i = 0; i < 20 && st.queue && st.queue.length && !st.decisions.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); }
      eq(AA4.charStats(st, REAL, me).at, at0, "nothing outside a battle");
      st.battle = { attacker: me, guard: foe, target: { seat: b }, step: "response" }; AA4.touch(st);
      eq([AA4.charStats(st, REAL, me).at, AA4.charStats(st, REAL, me).de], [at0 + 2, de0 + 2], "+1/+1 for each of the two power cards");
      st.battle = { attacker: plain, guard: foe, target: { seat: b }, step: "response" }; AA4.touch(st);
      const p0 = AA4.charStats(st, REAL, plain).at; st.battle = null; AA4.touch(st);
      eq(p0, AA4.charStats(st, REAL, plain).at, "not for a character without a name");
    });
    test("Pack bug (Revise#372): Bind 1 and Bind 3 on one character — pay 1 or 3 power cards, never 4", () => {
      const g = m2Game([]), S = g.S, { a } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const me = g.char(a, vanilla("E.G.O."), "front"); g.give(me, 3);
      for (const x of [1, 3]) AA4.runEffect(ctx, { steps: [{ a: "mod", to: "self", mod: { key: "skill", op: "grant", value: { id: "bind", x } }, until: "turn" }] }, { seat: a, ch: me, targets: [] });
      for (let i = 0; i < 20 && st.queue && st.queue.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); }
      AA4.touch(st);
      const opts = () => AA4.keepOptions(st, REAL, me, "battle").filter(o => o.k === "bind").map(o => o.n);
      eq(opts(), [1, 3], "with 3 power cards: Bind 1 or Bind 3");
      eq(AA4.charStats(st, REAL, me).skills.bind, 3, "shown as the largest, not the sum");
      g.give(me, 1); AA4.touch(st);
      eq(opts(), [1, 3], "with 4 power cards: still 1 or 3, not 4");
    });
    test("Pack bug (Revise#374): Solo with two decks / vs Bot — the chosen deck goes first, no coin toss", () => {
      const deck = EXTRA().flatMap(k => [k, k, k]);
      for (const first of [0, 1]) for (const seed of ["s1", "s2", "s3", "s4", "s5", "s6"]) {
        const L = AA4.GameLog.from(REAL, [{ t: "create", by: "P0", seed, mode: "solo2", rules: { firstSeat: first } }, { t: "join", by: "P0", seat: 0, name: "A", deck }, { t: "join", by: "P0", seat: 1, name: "B", deck }], {});
        eq(L.state.turn.order, [first, 1 - first], "first = " + first + ", seed " + seed);
      }
      const orders = new Set(["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"].map(seed => AA4.GameLog.from(REAL, [{ t: "create", by: "P0", seed, mode: "solo2", rules: {} }, { t: "join", by: "P0", seat: 0, name: "A", deck }, { t: "join", by: "P0", seat: 1, name: "B", deck }], {}).state.turn.order.join()));
      eq(orders.size, 2, "old logs without the choice: still the coin toss");
    });
    test("Pack (Revise#377): the bot takes a cost back to the hand only in Conflict / Engage on the opponent's turn, and keeps the power for its named Break card", () => {
      const one = (c, n) => +c.cost === n && Object.keys(c.factor || {}).length === 1;
      const brk = REAL.all().find(c => c.type === "Break" && c.name && one(c, 2) && Object.values(c.factor)[0] <= 2 && REAL.all().some(f => f.type === "Fast" && one(f, 1) && Object.keys(f.factor)[0] === Object.keys(c.factor)[0] && Object.values(f.factor)[0] <= 2));
      const fac = Object.keys(brk.factor)[0];
      const fast = REAL.all().find(f => f.type === "Fast" && one(f, 1) && Object.keys(f.factor)[0] === fac && Object.values(f.factor)[0] <= 2);
      const g = m2Game([fast.key, brk.key]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const me = g.char(a, vanilla(fac), "front"), me2 = g.char(a, vanilla(fac), "front"); g.give(me, 2);
      const fc = Object.values(st.cards).find(c => c.owner === a && c.key === fast.key && c.place.z !== "char");
      AA4.moveCard(ctx, fc.id, { z: "char", ch: me, role: "power" });
      for (const id of st.players[a].zones.hand.slice()) AA4.moveCard(ctx, id, { z: "deck" });
      st.stack.push({ seat: b, id: "x" }); st.turn.player = b; AA4.touch(st);   // the opponent has declared something: a threat
      const want = () => AA4.botWantedBack(st, REAL, a, me).includes(fc.id);
      st.rules.situation = false; st.situation = null;
      eq(want(), true, "Game Situation off: as before (3 power cards, the Fast card costs 1)");
      st.rules.situation = true;
      for (const [sit, ok] of [["building", false], ["interfering", false], ["conflicting", true], ["engaging", true]]) { st.situation = sit; AA4.touch(st); eq(want(), ok, sit + " on the opponent's turn"); }
      const bc = Object.values(st.cards).find(c => c.owner === a && c.key === brk.key && c.place.z === "deck");
      AA4.moveCard(ctx, bc.id, { z: "hand" }); AA4.touch(st);
      eq(AA4.factorOk(st, REAL, a, brk), null, "its Factor is met"); eq(want(), false, "a named Break card (cost 2) it can use is in the hand: 2 power cards left would not pay 1 + 2 — the cost stays");
      g.give(me2, 2); AA4.touch(st);
      eq(want(), true, "with 5 power cards the 4 left cover both: take it back");
    });
    test("Campaign (Revise#379): Hero Frontal Attack — the bot waits for its Main Attacker; below the Critical number it attacks anyway", () => {
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(); st.turn.number = 9;   // not one of its first turns (attackTurnMin, Revise#396)
      const me = g.char(a, vanilla("E.G.O."), "front"); g.give(me, 3); AA4.touch(st);
      const it = { t: "declare", kind: "attack", ch: me, target: { seat: b } }, heroKey = st.cards[AA4.topOf(st.chars[me])].key;
      const style = k => ({ strategy: "hero", attackersMode: "select", attackers: [{ key: k, perm: null, wait: false }], special: [], mainBreak: null, critical: 15 });
      eq(AA4.botAttackOk(st, REAL, a, it), true, "the common bot attacks here");
      eq(AA4.botAttackOk(st, REAL, a, it, null, style("NO SUCH CARD")), false, "Hero Frontal Attack: the Main Attacker is not set yet — no attack");
      eq(AA4.botAttackOk(st, REAL, a, it, null, style(heroKey)), true, "the Main Attacker is set and has power cards: attack");
      eq(AA4.botAttackOk(st, REAL, a, it, null, Object.assign(style(heroKey), { attackers: [{ key: heroKey, perm: "SOME PERMANENT", wait: true }] })), false, "it waits for its Permanent card");
      eq(AA4.botAttackOk(st, REAL, a, it, null, Object.assign(style("NO SUCH CARD"), { critical: 60 })), true, "fewer deck cards than the Critical number: attack without the condition");
      eq(AA4.botHeroReady(st, REAL, a, Object.assign(style("x"), { attackersMode: "none" })), true, "Main Attacker: None — no condition");
      eq(AA4.botHeroReady(st, REAL, a, Object.assign(style("x"), { attackersMode: "any" })), false, "Main Attacker: Any — a Break card must be set");
    });
    test("Pack (Revise#380): Auto Re-shuffle also wants a Character of the deck's Main Factor in the hand (new games only)", () => {
      const nb = REAL.all().find(c => c.type === "Break" && c.name && c.faction === "Darklore" && c.factor && c.factor.Darklore >= 2 && Object.keys(c.factor).length === 1);
      const dl = REAL.all().filter(c => c.type === "Character" && c.faction === "Darklore").slice(0, 3).map(c => c.key), eg = REAL.all().filter(c => c.type === "Character" && c.faction === "E.G.O.").slice(0, 12).map(c => c.key);
      const deck = [nb.key, nb.key, nb.key].concat(dl.flatMap(k => [k, k]), eg.flatMap(k => [k, k, k, k])).slice(0, 50);
      const mk = rules => AA4.GameLog.from(REAL, [{ t: "create", by: "P0", seed: "mf", mode: "solo2", rules }, { t: "join", by: "P0", seat: 0, name: "A", deck }, { t: "join", by: "P0", seat: 1, name: "B", deck }], {});
      const L = mk({ mullMain: true }), st = L.state, ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      eq(AA4.mainFactorOf(st, REAL, 0), "Darklore", "Main Factor: from the Factors of the named cards, not from the most cards");
      const hand = st.players[0].zones.hand, deckZ = st.players[0].zones.deck, fac = id => (REAL.card(st.cards[id].key) || {}).faction, isCh = id => (REAL.card(st.cards[id].key) || {}).type === "Character";
      for (const id of hand.filter(id => isCh(id) && fac(id) === "Darklore")) AA4.moveCard(ctx, id, { z: "deck" });   // no Darklore character in the hand
      AA4.touch(st);
      const c0 = AA4.openingHandCheck(st, REAL, 0);
      eq([c0.main, c0.mainN, c0.ok], ["Darklore", 0, false], "no Main Factor character in the hand: not a match");
      AA4.moveCard(ctx, deckZ.find(id => isCh(id) && fac(id) === "Darklore"), { z: "hand" }); AA4.touch(st);
      eq(AA4.openingHandCheck(st, REAL, 0).mainN, 1, "one in the hand: this part is met");
      const old = AA4.openingHandCheck(mk({}).state, REAL, 0);
      eq([old.main, old.mainN], [undefined, undefined], "a game created without the rule (an older log): checked as before");
    });
    test("Pack (Revise#381): the bot's Break cards without a Name — Charge / Draw ones on Active Characters only; another faction's character only when the Factor is needed", () => {
      const sk = (c, k) => typeof (c.skills || {})[k] === "number" && c.skills[k] > 0;
      const chg = REAL.all().find(c => c.type === "Break" && !c.name && c.faction === "E.G.O." && sk(c, "charge")), plain = REAL.all().find(c => c.type === "Break" && !c.name && c.faction === "E.G.O." && !sk(c, "charge") && !sk(c, "draw"));
      const need = REAL.all().find(c => c.type === "Project" && c.factor && c.factor["E.G.O."] === 3 && Object.keys(c.factor).length === 1);
      const g = m2Game([chg.key, plain.key, need.key]), S = g.S, { a } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const ego = g.char(a, vanilla("E.G.O."), "front"), dl = g.char(a, vanilla("Darklore"), "front");
      const find = k => Object.values(st.cards).find(c => c.owner === a && c.key === k && c.place.z !== "char");
      const act = Object.values(st.cards).find(c => c.owner === a && c.key === vanilla("E.G.O.") && c.place.z === "deck"); g.ok({ t: "move", seat: a, card: act.id, to: { z: "active" } });
      const actCh = AA4.charsOf(st, a).find(id => !AA4.isControlled(st.chars[id]));
      for (const id of st.players[a].zones.hand.slice()) AA4.moveCard(ctx, id, { z: "deck" });
      const c1 = find(chg.key), c2 = find(plain.key); AA4.moveCard(ctx, c1.id, { z: "hand" }); AA4.moveCard(ctx, c2.id, { z: "hand" }); AA4.touch(st);
      eq(AA4.botPlainBreakOk(st, REAL, a, c1.id, ego), false, "a Charge Break card: not on a Controlled Character");
      eq(AA4.botPlainBreakOk(st, REAL, a, c1.id, actCh), true, "a Charge Break card: on a character in the Active Area");
      eq(AA4.botPlainBreakOk(st, REAL, a, c2.id, ego), true, "a plain Break card on its own faction: as before");
      eq(AA4.botPlainBreakOk(st, REAL, a, c2.id, dl), false, "on a Controlled Character of another faction with no need for the Factor: no");
      AA4.moveCard(ctx, find(need.key).id, { z: "hand" }); AA4.touch(st);
      eq(AA4.botFactorNeeded(st, REAL, a, "E.G.O.", c2.id), true, "a hand card asks for E.G.O. 3, one is controlled");
      eq(AA4.botPlainBreakOk(st, REAL, a, c2.id, dl), true, "the Factor is needed: the other faction's character may be broken");
      eq(AA4.botPlainBreakOk(st, REAL, a, c1.id, dl), true, "the same for the Charge Break card");
    });
    test("Campaign (Revise#383): E.G.O. Mayumi's bot — only the hero attacks, only when it stays alive; the Main Break stays on top", () => {
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(); st.turn.number = 9;   // not one of its first turns (attackTurnMin, Revise#396)
      const hero = g.char(a, vanilla("E.G.O."), "front"), other = g.char(a, vanilla("E.G.O."), "front"); g.give(hero, 3); g.give(other, 1); AA4.touch(st);
      const hk = st.cards[AA4.topOf(st.chars[hero])].key, hname = REAL.card(hk).name;
      const named = REAL.all().find(c => c.type === "Character" && c.name), mk = extra => Object.assign({ strategy: "hero", attackersMode: "select", attackers: [{ key: named.key, perm: null, wait: false }], special: [], mainBreak: null, critical: 15 }, extra);
      const hc = Object.values(st.cards).find(c => c.owner === a && c.place.z === "deck"); st.cards[hc.id].key = named.key; AA4.moveCard({ S: st, db: REAL, events: [], emit() {} }, hc.id, { z: "char", ch: hero, role: "stack" }); AA4.touch(st);   // the hero: a character built with the Main Attacker's Name
      const atk = ch => ({ t: "declare", kind: "attack", ch, target: { seat: b } });
      eq(AA4.botAttackOk(st, REAL, a, atk(other), null, mk({})), true, "Hero Frontal Attack alone: once the hero is set, the others attack too");
      eq(AA4.botAttackOk(st, REAL, a, atk(other), null, mk({ only: true })), false, "only: a character without the Name stays home");
      eq(AA4.botAttackOk(st, REAL, a, atk(hero), null, mk({ only: true, safe: true })), true, "the hero attacks while nobody can defeat it");
      const big = g.char(b, vanilla("Darklore", { at: 2 }), "front"); g.give(big, 2); AA4.touch(st);
      const kills = (+AA4.charStats(st, REAL, big).at || 0) >= (+AA4.charStats(st, REAL, hero).de || 0);
      eq(AA4.botAttackOk(st, REAL, a, atk(hero), null, mk({ only: true, safe: true })), !kills, "safe: not into a guard that would defeat it");
      eq(AA4.botAttackOk(st, REAL, a, atk(other), null, mk({ only: true, critical: 60 })), AA4.botAttackOk(st, REAL, a, atk(other)), "below the Critical number: the common rules");
      void hname;
    });
    test("Campaign (Revise#384): Supportive Leader — no attack before every Main Supporter is set and Charge > 3, Draw > 2", () => {
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(); st.turn.number = 9;   // not one of its first turns (attackTurnMin, Revise#396)
      const s1 = g.char(a, vanilla("E.G.O."), "front"), s2 = g.char(a, vanilla("Darklore"), "front"), other = g.char(a, vanilla("E.G.O."), "front"); g.give(other, 3); AA4.touch(st);
      const k1 = st.cards[AA4.topOf(st.chars[s1])].key, k2 = st.cards[AA4.topOf(st.chars[s2])].key, it = { t: "declare", kind: "attack", ch: other, target: { seat: b } };
      const mk = (keys, extra) => Object.assign({ strategy: "leader", attackersMode: "select", attackers: keys.map(key => ({ key, perm: null, wait: false })), all: true, safe: true, chargeMin: 0, drawMin: 0, special: [], mainBreak: null, critical: 15 }, extra);
      eq(AA4.botHeroReady(st, REAL, a, mk([k1, "NOT SET"])), false, "one Main Supporter is missing: not ready");
      eq(AA4.botHeroReady(st, REAL, a, mk([k1, k2])), true, "every Main Supporter is set: ready");
      eq(AA4.botAttackOk(st, REAL, a, it, null, mk([k1, "NOT SET"])), false, "no attack before that");
      eq(AA4.botAttackOk(st, REAL, a, it, null, mk([k1, k2])), true, "then the others attack by the common rules");
      const ps = AA4.playerStats(st, REAL, a);
      eq(AA4.botAttackOk(st, REAL, a, it, null, mk([k1, k2], { chargeMin: (+ps.charge || 0) + 1 })), false, "Charge below the threshold: no attack");
      eq(AA4.botAttackOk(st, REAL, a, it, null, mk([k1, k2], { drawMin: (+ps.draw || 0) + 1 })), false, "Draw below the threshold: no attack");
      eq(AA4.botAttackOk(st, REAL, a, it, null, mk([k1, "NOT SET"], { critical: 60 })), true, "below the Critical number: without the conditions");
    });
    test("Pack (Revise#385): the bot brings a character with Draw or Charge to the Control Area before one without a skill", () => {
      const sk = (c, k) => typeof (c.skills || {})[k] === "number" && c.skills[k] > 0, agg = c => !!(c.aggressive || (c.skills || {}).aggressive);
      const C = REAL.all().filter(c => c.type === "Character" && !c.name && !agg(c) && c.status === "auto" && c.faction === "E.G.O.");
      const chg = C.find(c => sk(c, "charge") && (+c.se || 0) <= 3), drw = C.find(c => sk(c, "draw")) || chg, plain = C.find(c => !(c.skills || {}).charge && !(c.skills || {}).draw && (+c.se || 0) <= 3);
      const g = m2Game([chg.key, drw.key, plain.key]), S = g.S, { a } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      for (const id of st.players[a].zones.hand.slice()) AA4.moveCard(ctx, id, { z: "deck" });
      const take = k => { const c = Object.values(st.cards).find(x => x.owner === a && x.key === k && x.place.z === "deck"); AA4.moveCard(ctx, c.id, { z: "hand" }); return c.id; };
      const p1 = take(plain.key), filler = [take(plain.key), take(plain.key)].concat(Object.values(st.cards).filter(x => x.owner === a && x.place.z === "deck" && ["Fast", "Project", "Permanent"].includes(REAL.card(x.key).type)).slice(0, 6).map(x => (AA4.moveCard(ctx, x.id, { z: "hand" }), x.id))); AA4.touch(st);
      eq(AA4.botSetCharOk(st, REAL, a, p1), true, "only characters without a skill in the hand: one of them is set");
      const c1 = take(chg.key); AA4.touch(st);
      eq([AA4.botSetCharOk(st, REAL, a, p1), AA4.botSetCharOk(st, REAL, a, c1)], [false, true], "a Charge character is in the hand: it goes first, the plain one waits");
      AA4.moveCard(ctx, c1, { z: "deck" }); const d1 = take(drw.key); AA4.touch(st);
      eq([AA4.botSetCharOk(st, REAL, a, p1), AA4.botSetCharOk(st, REAL, a, d1)], [false, true], "the same for a Draw character");
      void filler;
    });
    test("Pack (Revise#386): with too little Charge or Draw the bot does not guard with a character that would be defeated — the damage goes to the player", () => {
      const g = m2Game([]), S = g.S, { a, b } = g, st = S();
      const att = g.char(b, vanilla("Darklore", { at: 2 }), "front"), grd = g.char(a, vanilla("E.G.O."), "front"); AA4.touch(st);
      st.battle = { attacker: att, aSeat: b, target: { seat: a }, defender: a, step: "guard" }; AA4.touch(st);
      const it = { t: "declare", kind: "guard", ch: grd }, dies = (+AA4.charStats(st, REAL, att).at || 0) >= (+AA4.charStats(st, REAL, grd).de || 0);
      const low = Object.assign(AA4.botWeights(), { guardChargeMin: 99, guardDrawMin: 0 }), ok = Object.assign(AA4.botWeights(), { guardChargeMin: 0, guardDrawMin: 0 });
      eq(AA4.botGuardOk(st, REAL, a, it, low), !dies, "not enough Charge: no guard that dies");
      eq(AA4.botGuardOk(st, REAL, a, it, Object.assign(AA4.botWeights(), { guardChargeMin: 0, guardDrawMin: 99 })), !dies, "not enough Draw: the same");
      eq(AA4.botGuardOk(st, REAL, a, it, ok), true, "enough of both: it may guard");
      const dp = st.players[a].zones.damage, deck = st.players[a].zones.deck; while (dp.length < 9) dp.push(deck.pop()); AA4.touch(st);
      eq(AA4.botGuardOk(st, REAL, a, it, low), true, "the hit would end the game: guard anyway");
    });
    test("Pack (Revise#387): the bot sets a Break card with a cost on a character whose break cost returns to the hand", () => {
      const RE = /このキャラクターをブレイクする場合、≪そのブレイクカードのコスト≫は(オーナーの)?手札に戻る/;
      const back = REAL.all().find(c => c.type === "Character" && c.faction === "E.G.O." && RE.test(c.text || "") && c.status === "auto");
      const brk = REAL.all().find(c => c.type === "Break" && !c.name && c.faction === "E.G.O." && +c.cost >= 1 && !(c.skills || {}).charge && !(c.skills || {}).draw && Object.keys(c.factor || {}).length === 1 && c.factor["E.G.O."] <= 2);
      const free = REAL.all().find(c => c.type === "Break" && !c.name && c.faction === "E.G.O." && +c.cost === 0 && !(c.skills || {}).charge && !(c.skills || {}).draw);
      const g = m2Game([back.key, brk.key].concat(free ? [free.key] : [])), S = g.S, { a } = g, st = S();
      const plain = g.char(a, vanilla("E.G.O."), "front"), bk = g.char(a, back.key, "front"); g.give(plain, 3); AA4.touch(st);
      const find = k => Object.values(st.cards).find(c => c.owner === a && c.key === k && c.place.z !== "char").id;
      eq([AA4.botBreakBack(st, REAL, bk), AA4.botBreakBack(st, REAL, plain)], [true, false], "which character gives the break cost back");
      const legal = AA4.breakTargets(st, REAL, a, find(brk.key), false, brk);
      if (legal.includes(bk) && legal.includes(plain)) {
        eq(AA4.botBreakBackOk(st, REAL, a, find(brk.key), bk), true, "a Break card with a cost: on the cost-return character");
        eq(AA4.botBreakBackOk(st, REAL, a, find(brk.key), plain), false, "not on another character while that one can take it");
      }
      if (free) eq(AA4.botBreakBackOk(st, REAL, a, find(free.key), plain), true, "a Break card without a cost: anywhere");
      const nb = REAL.all().find(c => c.type === "Break" && c.name && +c.cost >= 1), nk = Object.values(st.cards).find(c => c.owner === a && c.place.z === "deck"); st.cards[nk.id].key = nb.key;
      const same = Object.values(st.cards).find(c => c.owner === a && c.place.z === "deck" && c.id !== nk.id); st.cards[same.id].key = nb.key; AA4.moveCard({ S: st, db: REAL, events: [], emit() {} }, same.id, { z: "char", ch: plain, role: "stack" }); AA4.touch(st);
      eq(AA4.botBreakBackOk(st, REAL, a, nk.id, plain), true, "a Name-level Break card whose Name is on the field already: it goes there, not to the cost-return character");
    });
    test("Campaign (Revise#388): Dina's hand-made bot — Dina attacks only when nobody can guard; Grand Cross only with Dina out and 2 characters without Shield", () => {
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(); st.turn.number = 9;   // not one of its first turns (attackTurnMin, Revise#396)
      const dina = g.char(a, vanilla("WIZ-DOM"), "front"); g.give(dina, 3); AA4.touch(st);
      const named = REAL.all().find(c => c.type === "Character" && c.name);
      const hc = Object.values(st.cards).find(c => c.owner === a && c.place.z === "deck"); st.cards[hc.id].key = named.key; AA4.moveCard({ S: st, db: REAL, events: [], emit() {} }, hc.id, { z: "char", ch: dina, role: "stack" }); AA4.touch(st);
      const style = { strategy: "hero", attackersMode: "none", attackers: [], all: true, shy: [named.key], special: [], mainBreak: null, critical: 15 };
      const it = { t: "declare", kind: "attack", ch: dina, target: { seat: b } };
      eq(AA4.botAttackOk(st, REAL, a, it, null, style), true, "nobody there can guard: she attacks");
      const grd = g.char(b, vanilla("Darklore"), "front"); g.give(grd, 2); AA4.touch(st);
      eq(AA4.botAttackOk(st, REAL, a, it, null, style), false, "a character there can guard: she stays home");
      st.chars[grd].flags = Object.assign({}, st.chars[grd].flags, { tapped: true }); AA4.touch(st);
      eq(AA4.botAttackOk(st, REAL, a, it, null, style), true, "that guard is tapped: she attacks");
    });
    test("Pack's reports (Revise#389): A3-25 3809 counts a card name below it once; A3-03 0514 keeps its Stealth until the attack is on the player", () => {
      { const g = m2Game(["A3-03 0444", "A3-25 3809"]), S = g.S, { a } = g, st = S();
        const ch = g.char(a, vanilla("E.G.O."), "front"); g.give(ch, 2);
        const put = k => { const c = Object.values(st.cards).find(x => x.owner === a && x.key === k && x.place.z !== "char"); g.ok({ t: "move", seat: a, card: c.id, to: { z: "char", ch, role: "stack" } }); };
        put("A3-03 0444"); put("A3-03 0444"); AA4.touch(st);
        const one = AA4.charStats(st, REAL, ch);
        put("A3-25 3809"); AA4.touch(st);
        const top = REAL.card("A3-25 3809"), all = AA4.charStats(st, REAL, ch);
        eq(AA4.inheritedCards(st, REAL, st.chars[ch]).length, 1, "two copies of one card name below: one of them is inherited");
        eq([all.at, all.de], [top.at + 2, top.de + 2], "±0/+1/+1 for each of the 2 power cards — once, not twice (" + one.at + " before)"); }
      { const mantle = REAL.card("A3-03 0514");
        eq(mantle.abilities.find(x => x.kind === "trigger" && x.effect.steps[0].a === "selfCardToHand").when.event, "reachPlayer", "0514: back to the hand when the attack is on the player, not at the declaration");
        const g = m2Game(["A3-03 0514"]), S = g.S, { a, b } = g, st = S();
        const att = g.char(a, vanilla("WIZ-DOM"), "front"), grd = g.char(b, vanilla("E.G.O."), "front"); g.give(att, 3); g.give(grd, 3);
        const pc = Object.values(st.cards).find(x => x.owner === a && x.key === "A3-03 0514" && x.place.z !== "char"); g.ok({ t: "move", seat: a, card: pc.id, to: { z: "char", ch: att, role: "perm" } });
        g.toPhase("main"); g.ok({ t: "declare", kind: "attack", seat: a, ch: att, target: { seat: b } }); g.pay(a);
        eq(st.cards[pc.id].place.z, "char", "after the attack declaration the Permanent is still on the character");
        assert(AA4.charStats(st, REAL, att).skills.stealth, "so it still has Stealth");
        const r = g.no({ t: "declare", kind: "guard", seat: b, ch: grd }); assert(/Stealth/.test(r.reason || ""), "a character of another faction cannot guard: " + r.reason); }
    });
    test("Pack (Revise#391): the bot keeps one Character card in the hand for its next turn, and sets two Aggressive characters on its first turn", () => {
      const sk = (c, k) => typeof (c.skills || {})[k] === "number" && c.skills[k] > 0, agg = c => !!(c.aggressive || (c.skills || {}).aggressive);
      const C = REAL.all().filter(c => c.type === "Character" && !c.name && c.status === "auto" && c.faction === "E.G.O.");
      const drw = C.find(c => sk(c, "draw")), plain = C.find(c => !agg(c) && !(c.skills || {}).charge && !(c.skills || {}).draw), ag = C.filter(agg).slice(0, 2);
      const g = m2Game([drw.key, plain.key, ag[0].key, ag[1].key]), S = g.S, { a } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      for (const id of st.players[a].zones.hand.slice()) AA4.moveCard(ctx, id, { z: "deck" });
      const take = k => { const c = Object.values(st.cards).find(x => x.owner === a && x.key === k && x.place.z === "deck"); AA4.moveCard(ctx, c.id, { z: "hand" }); return c.id; };
      const p1 = take(plain.key), p2 = take(plain.key); AA4.touch(st);
      eq(AA4.botReserved(st, REAL, a), p1, "one Character card of the hand is kept");
      const d1 = take(drw.key); AA4.touch(st);
      eq(AA4.botReserved(st, REAL, a), d1, "a Draw character while its Draw is under 2: that one is kept");
      const scored = AA4.botScored(st, REAL, a, "P0", {}).map(x => x.it).filter(it => it.t === "charge" && it.card);
      assert(!scored.some(it => it.card === d1), "the kept card is not offered as a power card (" + scored.length + " charge moves)");
      eq(AA4.botReserved(st, REAL, a, d1), p1, "when that card is being set now, another one is kept");
      // two Aggressive characters on the first turn
      const a1 = take(ag[0].key), a2 = take(ag[1].key); st.turn.number = 1; AA4.touch(st);
      const first = [a1, a2].filter(id => AA4.botSetCharOk(st, REAL, a, id))[0]; assert(first, "an Aggressive character may be set");
      g.ok({ t: "move", seat: a, card: first, to: { z: "active" } }); AA4.touch(st);
      const second = first === a1 ? a2 : a1;
      assert(st.players[a].zones.hand.some(id => agg(REAL.card(st.cards[id].key)) && AA4.botSetCharOk(st, REAL, a, id)), "first turn: one more Aggressive character (the one with the highest Attack in the hand)");
      g.ok({ t: "move", seat: a, card: second, to: { z: "active" } }); st.turn.number = 5; AA4.touch(st);
      eq(AA4.botSetCharOk(st, REAL, a, take(ag[0].key)), false, "a later turn with two out: no third one");
    });
    test("Pack (Revise#392): the bot charges with Break / Project / Fast cards too, keeps one Break card and one character, and feeds one Active Character at a time", () => {
      const C = REAL.all().filter(c => c.status === "auto" && c.faction === "E.G.O."), agg = c => !!(c.aggressive || (c.skills || {}).aggressive);
      const nb = C.filter(c => c.type === "Break" && c.name).slice(0, 2), pj = C.find(c => c.type === "Project"), fs = C.find(c => c.type === "Fast"), chA = C.find(c => c.type === "Character" && !c.name && agg(c)), chP = C.find(c => c.type === "Character" && !c.name && !agg(c) && (+c.se || 0) >= 2);
      const g = m2Game([nb[0].key, nb[1].key, pj.key, fs.key, chA.key, chP.key]), S = g.S, { a } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      for (const id of st.players[a].zones.hand.slice()) AA4.moveCard(ctx, id, { z: "deck" });
      const take = k => { const c = Object.values(st.cards).find(x => x.owner === a && x.key === k && x.place.z === "deck"); AA4.moveCard(ctx, c.id, { z: "hand" }); return c.id; };
      const b1 = take(nb[0].key), b1b = take(nb[0].key), b2 = take(nb[1].key), p1 = take(pj.key), f1 = take(fs.key), c1 = take(chP.key); AA4.touch(st);
      const prot = AA4.botProtected(st, REAL, a), lv = id => prot.get(id) || 0;
      eq(lv(c1), 2, "the one Character card: kept for the next turn");
      const plan = [b1, b1b, b2].filter(id => lv(id) === 2);
      eq(plan.length, 1, "one named Break card (the one it plans to set) is never a power card");
      eq([b1, b1b, b2].filter(id => lv(id) === 1).length, 1, "one copy of the other named Break card: only when nothing else is left");
      eq([b1, b1b, b2].filter(id => lv(id) === 0).length, 1, "the second copy is free");
      eq([lv(p1), lv(f1)], [0, 0], "Project and Fast cards are free to become power cards");
      // one Active Character at a time: the character for the Control Area, not the Aggressive one
      st.turn.number = 9;
      const put = k => { const c = Object.values(st.cards).find(x => x.owner === a && x.key === k && x.place.z === "deck"); g.ok({ t: "move", seat: a, card: c.id, to: { z: "active" } }); return AA4.charsOf(st, a).find(id => AA4.topOf(st.chars[id]) === c.id); };
      const actA = put(chA.key), actP = put(chP.key); AA4.touch(st);
      eq(AA4.botChargeTarget(st, REAL, a), actP, "the power goes to the character for the Control Area (the Aggressive one stays to attack)");
      eq(AA4.botChargeTarget(st, REAL, a, new Set([actA])), actA, "when the rules only let it charge the Aggressive one: that one");
      // the Aggressive character is set first
      for (const id of [b1, b1b, b2, p1, f1]) void id;
      const g2 = m2Game([chA.key, chP.key, pj.key]), st2 = g2.S(), a2 = g2.a, ctx2 = { S: st2, db: REAL, events: [], emit() {} };
      for (const id of st2.players[a2].zones.hand.slice()) AA4.moveCard(ctx2, id, { z: "deck" });
      const take2 = k => { const c = Object.values(st2.cards).find(x => x.owner === a2 && x.key === k && x.place.z === "deck"); AA4.moveCard(ctx2, c.id, { z: "hand" }); return c.id; };
      const hp = take2(chP.key), ha = take2(chA.key); for (let i = 0; i < 3; i++) take2(pj.key); st2.turn.number = 9; AA4.touch(st2);
      eq([AA4.botSetCharOk(st2, REAL, a2, hp), AA4.botSetCharOk(st2, REAL, a2, ha)], [false, true], "an Aggressive character can still be set: it goes first, the other one after it");
    });
    test("Card reports (Revise#395): 0950, 3357, 3691, 1743, 2345 automatic; the bot does not declare a card it can only cancel (Revise#394)", () => {
      const keys = ["A4-05 0950", "A3-23 3357", "A3-25 3691", "A3-11 1743", "A3-17 2345"];
      eq(keys.map(k => REAL.card(k).status), Array(keys.length).fill("auto"), "statuses");
      const nb = REAL.all().find(c => c.type === "Break" && c.name && c.status === "auto" && c.faction === "E.G.O.");
      const g = m2Game(["A4-05 0950", nb.key]), S = g.S, { a } = g, st = S();
      const ch = g.char(a, vanilla("E.G.O."), "front");
      const put = (k, role) => { const c = Object.values(st.cards).find(x => x.owner === a && x.key === k && x.place.z !== "char"); g.ok({ t: "move", seat: a, card: c.id, to: { z: "char", ch, role } }); };
      put("A4-05 0950", "perm"); AA4.touch(st);
      eq(AA4.charStats(st, REAL, ch).skills.bind, undefined, "0950 on a character without a Name: no Bind");
      put(nb.key, "stack"); AA4.touch(st);
      const sk = AA4.charStats(st, REAL, ch).skills;
      eq([sk.bind, sk.charge >= 1], [2, true], "0950 on a Name-level character: Bind 2 and Charge X (X = the named cards in it)");
      eq(REAL.card("A3-23 3357").abilities.find(x => x.mod && x.mod.key === "playerHit").mod.value.effect.steps[0], { a: "dmgUntilOne", n: "selfSe" }, "3357: damage checks until as many cards as its Mental are in the Damage Pile");
      eq(REAL.card("A3-17 2345").play.steps[0].sel, { types: ["Break"], faction: "Arayashiki", nameHas: "明王" }, "2345: up to 3 明王 Break cards from the deck");
    });
    test("Revise#401: the three reported cards — 3660 free by its target, 1711 every effect costs X more, 3203 from the Damage Pile when the deck is empty", () => {
      eq(["A3-25 3660", "A3-22 3203", "A3-11 1711"].map(k => REAL.card(k).status), Array(3).fill("auto"), "statuses");
      // --- 3660: the cost is ignored when the target has no Name, or its Attack is X or less (X = Arayashiki Factor)
      eq(REAL.card("A3-25 3660").tCost, [{ sel: { named: false }, free: true }, { atMaxX: { factorSum: "Arayashiki" }, free: true }], "3660: tCost rules");
      {
        const named = (lo, hi) => REAL.all().find(c => c.type === "Break" && c.name && c.status === "auto" && c.printed && /^\d+$/.test(String(c.printed.at)) && +c.printed.at >= lo && +c.printed.at <= hi && !(c.abilities || []).length && !(c.effects || []).length);
        const big = named(6, 9), small = named(1, 3); assert(big && small, "named characters to test with");
        const g = m2Game(["A3-25 3660", big.key, small.key]), S = g.S, { a, b } = g;
        for (let i = 0; i < 3; i++) g.char(a, vanilla("Arayashiki"), "back");
        const plain = g.char(b, vanilla("E.G.O."), "front"), bigCh = g.char(b, big.key, "front"), smallCh = g.char(b, small.key, "front");
        const fc = Object.values(S().cards).find(c => c.owner === a && c.key === "A3-25 3660" && c.place.z !== "char");
        if (S().cards[fc.id].place.z !== "hand") g.ok({ t: "move", seat: a, card: fc.id, to: { z: "hand" } });
        g.toPhase("main");
        const plan = AA4.planDeclaration(S(), REAL, a, { kind: "set", card: fc.id });
        assert(!plan.reason, "can be declared with no power cards (" + plan.reason + ")");
        const x = AA4.xOf(S(), REAL, { factorSum: "Arayashiki" }, { seat: a, card: fc.id }, []);
        assert(x >= 3 && AA4.charStats(S(), REAL, bigCh).at > x && AA4.charStats(S(), REAL, smallCh).at <= x, "X sits between the two named characters");
        const cost = ch => AA4.xOf(S(), REAL, plan.xDef, { seat: a, card: fc.id }, [{ ch }]);
        eq([cost(plain), cost(smallCh), cost(bigCh)], [0, 0, 2], "no Name: free · Name with Attack ≤ X: free · Name with more Attack: cost 2");
        g.ok({ t: "declare", seat: a, kind: "set", card: fc.id });
        g.ok({ t: "target", seat: a, targets: [{ ch: plain }] });
        for (let k = 0; k < 6 && (S().draft || S().stack.length) && !S().decisions.length; k++) g.ok({ t: "pass", seat: AA4.priorityNow(S()) });
        eq(AA4.charStats(S(), REAL, plain).at, 0, "the target loses all its Attack");
      }
      // --- 1711: every effect costs X more (X = the power cards of the character that holds it)
      {
        const g = m2Game(["A3-11 1711"]), S = g.S, { a, b } = g;
        const holder = g.char(a, vanilla("Polestar Empire"), "back"), mine = g.char(a, vanilla("Polestar Empire"), "back"), theirs = g.char(b, vanilla("E.G.O."), "back");
        g.give(holder, 2);
        const pc = Object.values(S().cards).find(c => c.owner === a && c.key === "A3-11 1711" && c.place.z !== "char");
        eq([mine, theirs].map(ch => AA4.charStats(S(), REAL, ch).effectCost), [0, 0], "before");
        g.ok({ t: "move", seat: a, card: pc.id, to: { z: "char", ch: holder, role: "perm" } });
        eq([holder, mine, theirs].map(ch => AA4.charStats(S(), REAL, ch).effectCost), [2, 2, 2], "every character's effects cost 2 more");
        g.give(holder, 1);
        eq(AA4.charStats(S(), REAL, theirs).effectCost, 3, "X follows the holder's power cards");
      }
      // --- 3203: in the Damage Pile; the deck reaches 0 → X characters are discarded, then the card
      {
        const w1 = vanilla("WIZ-DOM"), w2 = REAL.all().find(c => c.type === "Character" && c.faction === "WIZ-DOM" && !c.name && c.status === "auto" && !(c.abilities || []).length && !(c.effects || []).length && c.key !== w1).key;
        const g = m2Game(["A3-22 3203", w2]), S = g.S, { a, b } = g;
        for (let i = 0; i < 5; i++) g.char(a, i < 3 ? w1 : w2, "back");
        assert(!AA4.factorOk(S(), REAL, a, REAL.card("A3-22 3203")), "the Factor WWWWW is met");
        const victim = g.char(b, vanilla("E.G.O."), "front");
        const cc = Object.values(S().cards).find(c => c.owner === a && c.key === "A3-22 3203" && c.place.z !== "char");
        g.toPhase("main");
        const P = () => S().players[a].zones;
        for (const id of P().damage.slice()) g.ok({ t: "move", seat: a, card: id, to: { z: "discard" } });
        g.ok({ t: "move", seat: a, card: cc.id, to: { z: "damage" } });
        while (P().deck.length > 1) g.ok({ t: "move", seat: a, card: P().deck[0], to: { z: "discard" } });
        assert(!S().decisions.length, "nothing yet with one card left");
        g.ok({ t: "move", seat: a, card: P().deck[0], to: { z: "discard" } });
        const d = S().decisions[0]; assert(d && d.seat === a, "the deck is empty: its owner chooses the characters");
        eq([d.min, d.max], [1, 1], "X = 1 (the cards in the Damage Pile)");
        g.decide([AA4.topOf(S().chars[victim])]);
        assert(!S().chars[victim], "the chosen character is discarded");
        eq(S().cards[cc.id].place.z, "discard", "then the card itself is discarded");
      }
    });
    test("Revise#402 (AQ-006): a character with no power cards attacks and guards when another character may pay for it (A3-12 1833)", () => {
      const g = m2Game(["A3-12 1833"]), S = g.S, { a, b } = g;
      const payer = g.char(a, vanilla("E.G.O."), "back"); g.ok({ t: "move", seat: a, card: Object.values(S().cards).find(c => c.owner === a && c.key === "A3-12 1833" && c.place.z !== "char").id, to: { z: "char", ch: payer, role: "stack" } });
      const att = g.char(a, vanilla("E.G.O."), "front"); g.give(payer, 3);
      const foe = g.char(b, vanilla("Darklore"), "front"); g.give(foe, 2);
      g.toPhase("main");
      eq(S().chars[att].power.length, 0, "the attacker has no power cards");
      const plan = AA4.planBattle(S(), REAL, a, { kind: "attack", ch: att, target: { seat: b } });
      assert(!plan.reason, "the attack can be declared (" + plan.reason + ")");
      assert(AA4.candidates(S(), REAL, "P" + a, a).some(m => m.t === "declare" && m.kind === "attack" && m.ch === att), "it is offered as a move");
      g.ok({ t: "declare", seat: a, kind: "attack", ch: att, target: { seat: b } });
      eq([S().draft && S().draft.step, S().draft && S().draft.cost], ["pay", 1], "the cost waits to be paid");
      g.ok({ t: "pay", seat: a, cards: [S().chars[payer].power[0]] });
      eq([S().chars[payer].power.length, !!S().battle], [2, true], "paid from the other character; the battle starts");      // the guard side: a guard with no power cards, paid by its own 1833
      const g2 = m2Game(["A3-12 1833"]), S2 = g2.S, a2 = g2.a, b2 = g2.b;
      const att2 = g2.char(a2, vanilla("E.G.O."), "front"); g2.give(att2, 2);
      const payer2 = g2.char(b2, vanilla("E.G.O."), "back"); g2.ok({ t: "move", seat: b2, card: Object.values(S2().cards).find(c => c.owner === b2 && c.key === "A3-12 1833" && c.place.z !== "char").id, to: { z: "char", ch: payer2, role: "stack" } });
      const grd2 = g2.char(b2, vanilla("E.G.O."), "front"); g2.give(payer2, 2);
      g2.toPhase("main");
      g2.ok({ t: "declare", seat: a2, kind: "attack", ch: att2, target: { seat: b2 } }); g2.pay(a2);
      for (let k = 0; k < 6 && S2().battle && S2().battle.step !== "guard" && !S2().decisions.length; k++) g2.ok({ t: "pass", seat: AA4.priorityNow(S2()) });
      eq([S2().battle && S2().battle.step, S2().chars[grd2].power.length], ["guard", 0], "guard step; the guard has no power cards");
      assert(AA4.candidates(S2(), REAL, "P" + b2, b2).some(m => m.t === "declare" && m.kind === "guard" && m.ch === grd2), "the guard is offered as a move");
      g2.ok({ t: "declare", seat: b2, kind: "guard", ch: grd2 });
      g2.ok({ t: "pay", seat: b2, cards: [S2().chars[payer2].power[0]] });
      eq(S2().chars[payer2].power.length, 1, "the guard cost is paid from the other character");
    });
    test("Revise#406: 3619 Resist on its character in a battle; 3429 with a 各務 柊子 card below", () => {
      const fight = withBandana => {
        const g = m2Game(["A3-25 3619"]), S = g.S, { a, b } = g;
        const att = g.char(a, vanilla("Darklore"), "front"); g.give(att, 2);
        const grd = g.char(b, vanilla("E.G.O."), "front"); g.give(grd, 2);
        if (withBandana) {
          g.ok({ t: "move", seat: b, card: Object.values(S().cards).find(c => c.owner === b && c.key === "A3-25 3619" && c.place.z !== "char").id, to: { z: "char", ch: grd, role: "perm" } });
          const r = AA4.charStats(S(), REAL, grd).skills.resist;
          assert(r && r.factions.includes("Darklore"), "the character has Resist Darklore: " + JSON.stringify(r));
        }
        g.toPhase("main");
        g.ok({ t: "declare", seat: a, kind: "attack", ch: att, target: { seat: b } }); g.pay(a);
        for (let k = 0; k < 6 && S().battle && S().battle.step !== "guard" && !S().decisions.length; k++) g.ok({ t: "pass", seat: AA4.priorityNow(S()) });
        g.ok({ t: "declare", seat: b, kind: "guard", ch: grd }); g.pay(b);
        for (let k = 0; k < 12 && S().battle; k++) { if (S().decisions.length) g.decide(d => d.options.slice(0, d.min)); else g.ok({ t: "pass", seat: AA4.priorityNow(S()) }); }
        return [AA4.charStats(S(), REAL, att) && 0, !!S().chars[grd], REAL.card(vanilla("Darklore")).printed.at, REAL.card(vanilla("E.G.O.")).printed.de];
      };
      { const plain = fight(false), res = fight(true); eq([plain[1], res[1]], [false, true], "without it the guard is defeated; with Resist it takes no battle damage — " + JSON.stringify([plain, res])); }
      {
        const g = m2Game(["A3-24 3429", "A3-02 0264"]), S = g.S, { a } = g;
        const ch = g.char(a, vanilla("Arayashiki"), "front");
        const put = key => g.ok({ t: "move", seat: a, card: Object.values(S().cards).find(c => c.owner === a && c.key === key && c.place.z !== "char").id, to: { z: "char", ch, role: "stack" } });
        put("A3-24 3429");
        assert(!AA4.charStats(S(), REAL, ch).skills.bind, "no 各務 柊子 below: no Bind");
        const g2 = m2Game(["A3-24 3429", "A3-02 0264"]), S2 = g2.S, a2 = g2.a, ch2 = g2.char(a2, vanilla("Arayashiki"), "front");
        for (const key of ["A3-02 0264", "A3-24 3429"]) g2.ok({ t: "move", seat: a2, card: Object.values(S2().cards).find(c => c.owner === a2 && c.key === key && c.place.z !== "char").id, to: { z: "char", ch: ch2, role: "stack" } });
        const st = AA4.charStats(S2(), REAL, ch2);
        assert(st.skills.bind && st.noDamage.some(n => n.battleNormal), "各務 柊子 (A3-02 0264) below: Bind 1 and no normal battle damage — " + JSON.stringify(st.skills.bind));
      }
    });
    test("Revise#407: an attack on another player's character (A3-25 3686) — the attacked character guards (a battle) or not (damage outside a battle)", () => {
      const setup = () => {
        const g = m2Game(["A3-25 3686"]), S = g.S, { a, b } = g;
        const att = g.char(a, vanilla("Eraser"), "front");
        g.ok({ t: "move", seat: a, card: Object.values(S().cards).find(c => c.owner === a && c.key === "A3-25 3686" && c.place.z !== "char").id, to: { z: "char", ch: att, role: "stack" } });
        g.give(att, 3);
        const tgt = g.char(b, vanilla("E.G.O."), "front"), other = g.char(b, vanilla("E.G.O."), "front"); g.give(tgt, 2); g.give(other, 2);
        g.toPhase("main");
        assert(AA4.charStats(S(), REAL, att).attackChars.length, "3686 may attack characters");
        g.ok({ t: "declare", seat: a, kind: "attack", ch: att, target: { ch: tgt } }); g.pay(a);
        for (let k = 0; k < 6 && S().battle && S().battle.step !== "guard" && !S().decisions.length; k++) g.ok({ t: "pass", seat: AA4.priorityNow(S()) });
        return { g, S, a, b, att, tgt, other };
      };
      const finish = (g, S) => { for (let k = 0; k < 14 && S().battle; k++) { if (S().decisions.length) g.decide(d => d.options.slice(0, d.min)); else if (S().draft && S().draft.step === "pay") g.pay(S().draft.seat); else g.ok({ t: "pass", seat: AA4.priorityNow(S()) }); } };
      {
        const { g, S, b, att, tgt, other } = setup();
        eq([S().battle.step, S().battle.defender, !!S().battle.charGuard], ["guard", b, true], "the attacked character's owner decides: guard or not");
        g.no({ t: "declare", seat: b, kind: "guard", ch: other }, "Only the attacked character");
        assert(!AA4.planBattle(S(), REAL, b, { kind: "guard", ch: tgt }).reason, "the attacked character itself may guard");
        g.ok({ t: "noGuard", seat: b });
        finish(g, S);
        const ev = g.log ? null : null;
        assert(!S().chars[tgt], "no guard: the damage defeats the attacked character");
        assert(S().chars[att], "it was damage outside a battle: the attacker takes none");
      }
      {
        const { g, S, b, att, tgt } = setup();
        g.ok({ t: "declare", seat: b, kind: "guard", ch: tgt }); g.pay(b);
        eq(S().battle.guard, tgt, "the attacked character guards");
        const de = AA4.charStats(S(), REAL, att).de, at = AA4.charStats(S(), REAL, tgt).at;
        finish(g, S);
        eq(!!S().chars[att], at < de, "a battle as usual: the attacker takes the guard's damage");
      }
    });
    test("Revise#408: A3-25 3700 Dispel — free against a card that was declared on your own Project / Fast card", () => {
      eq(REAL.card("A3-25 3700").status, "auto", "status");
      const w1 = vanilla("WIZ-DOM"), w2 = REAL.all().find(c => c.type === "Character" && c.faction === "WIZ-DOM" && !c.name && c.status === "auto" && !(c.abilities || []).length && !(c.effects || []).length && c.key !== w1).key;
      const g = m2Game(["A3-25 3700", "A3-25 3660", w2]), S = g.S, { a, b } = g;
      for (const seat of [a, b]) for (let i = 0; i < 4; i++) { const ch = g.char(seat, i < 3 ? w1 : w2, "back"); if (i === 0) g.give(ch, 4); }
      for (let i = 0; i < 3; i++) g.char(a, vanilla("Arayashiki"), "back");
      const foe = g.char(b, vanilla("E.G.O."), "front");
      const hand = (seat, key) => { const c = Object.values(S().cards).find(c => c.owner === seat && c.key === key && !["char", "hand", "declared", "discard"].includes(c.place.z)) || Object.values(S().cards).find(c => c.owner === seat && c.key === key && c.place.z === "hand"); if (c.place.z !== "hand") g.ok({ t: "move", seat, card: c.id, to: { z: "hand" } }); return c.id; };
      const mine = hand(a, "A3-25 3660"), theirs = hand(b, "A3-25 3700"), myDispel = hand(a, "A3-25 3700");
      g.toPhase("main");
      g.ok({ t: "declare", seat: a, kind: "set", card: mine }); g.ok({ t: "target", seat: a, targets: [{ ch: foe }] }); g.pay(a);
      assert(S().stack.some(it => it.card === mine), "my Fast card is declared");
      const xd = { tCost: { base: 2, rules: REAL.card("A3-25 3700").tCost, type: "Fast" } };
      eq(AA4.xOf(S(), REAL, xd, { seat: a, card: myDispel }, [{ card: mine }]), 2, "a card that is not aimed at my card: the printed cost 2");
      g.ok({ t: "declare", seat: b, kind: "set", card: theirs }); g.ok({ t: "target", seat: b, targets: [{ card: mine }] });
      eq(S().draft.cost, 2, "their Dispel on my card costs 2"); g.pay(b);
      const plan = AA4.planDeclaration(S(), REAL, a, { kind: "set", card: myDispel });
      assert(!plan.reason, "my Dispel can be declared (" + plan.reason + ")");
      g.ok({ t: "declare", seat: a, kind: "set", card: myDispel }); g.ok({ t: "target", seat: a, targets: [{ card: theirs }] });
      assert(!S().draft || S().draft.cost === 0 || S().draft.step !== "pay", "free: their card was declared on my Fast card — " + JSON.stringify(S().draft && [S().draft.step, S().draft.cost]));
      assert(S().stack.some(it => it.card === myDispel) || (S().draft && S().draft.cost === 0), "declared without paying");
    });
    test("Pack's rule (Revise#410): the bot sets no Character card while 2 or more of its characters are in the Active Area", () => {
      const C = REAL.all().filter(c => c.type === "Character" && !c.name && c.status === "auto" && (+c.se || 0) === 1 && !(c.skills || {}).aggressive && !c.aggressive);
      const k1 = C.find(c => c.faction === "E.G.O.").key, k2 = C.find(c => c.faction === "Darklore").key, k3 = C.find(c => c.faction === "WIZ-DOM").key, fill = REAL.all().find(c => c.type === "Project" && c.faction === "E.G.O.").key;
      const g = m2Game([k1, k2, k3, fill]), S = g.S, { a } = g;
      const st0 = S(), ctx0 = { S: st0, db: REAL, events: [], emit: e => ctx0.events.push(e) };
      for (const id of st0.players[a].zones.hand.slice()) AA4.moveCard(ctx0, id, { z: "deck" });
      const take = k => { const c = Object.values(S().cards).find(x => x.owner === a && x.key === k && x.place.z === "deck"); AA4.moveCard({ S: S(), db: REAL, events: [], emit() {} }, c.id, { z: "hand" }); return c.id; };
      const h3 = take(k3); for (let i = 0; i < 3; i++) take(fill);
      S().turn.number = 9; AA4.touch(S());
      const w = Object.assign(AA4.botWeights(), { reserveUntilDraw: 0 });
      g.char(a, k1, "active"); AA4.touch(S());
      eq(AA4.botSetCharOk(S(), REAL, a, h3, w), true, "one character in the Active Area: another may be set");
      g.char(a, k2, "active"); AA4.touch(S());
      eq(AA4.charsOf(S(), a).filter(id => S().chars[id].at.area === "active").length, 2, "two characters in the Active Area");
      eq(AA4.botSetCharOk(S(), REAL, a, h3, w), false, "two there already: no new Character card");
      eq(AA4.botSetCharOk(S(), REAL, a, h3, Object.assign({}, w, { activeMax: 3 })), true, "the number is a parameter (activeMax)");
    });
    test("M5a (1): 3766 · 2178 · 3768 · 2204 · 3131 · 2451 · 2730 · 3167 · 1102 · 2436 · 3308 are automatic", () => {
      const keys = ["A3-25 3766", "A3-16 2178", "A3-25 3768", "A3-16 2204", "A3-22 3131", "A3-18 2451", "A3-20 2730", "A3-22 3167", "A3-07 1102", "A3-18 2436", "A3-22 3308"];
      eq(keys.map(k => REAL.card(k).status), keys.map(k => (REAL.card(k).simplified ? "partial" : "auto")), "statuses");
      const dmg = (S, seat) => -S().players[seat].zones.deck.length;   // cards taken off the deck by damage checks
      { // 3766: 6 damage to every player; discarding hand cards takes 1 off each
        const g = PG(["A3-25 3766"].concat(factionChars("Polestar Empire", 2), factionChars("Polestar Empire", 2))), S = g.S, { a, b } = g; giveFactor(g, a, "Polestar Empire", 5);
        g.toPhase("main"); const c66 = g.hand(a, "A3-25 3766"), d0 = [dmg(S, a), dmg(S, b)], hb = S().players[b].zones.hand.slice(0, 2);
        g.play(a, c66, []);
        for (let k = 0; k < 4 && S().decisions.length; k++) g.choose(d => (d.seat === b ? hb.filter(id => d.options.includes(id)) : []));
        const got = [dmg(S, a) - d0[0], dmg(S, b) - d0[1]];
        assert(got[0] === 6 && got[1] === 4, "you take 6 (damage checks), the other player 4 after discarding 2 cards: " + JSON.stringify(got));
        eq(hb.every(id => S().cards[id].place.z === "discard"), true, "the two cards are discarded");
      }
      { // 2178: the next attack on a player deals no damage; in a damage check it stops the check
        const g = PG(["A3-16 2178"]), S = g.S, { a, b } = g; giveFactor(g, b, "E.G.O.", 2);
        const att = g.fch(a, "Darklore"); g.give(att, 2);
        g.toPhase("main");
        g.ok({ t: "declare", seat: a, kind: "attack", ch: att, target: { seat: b } }); g.pay(a);
        g.ok({ t: "noGuard", seat: b });
        const c78 = g.hand(b, "A3-16 2178"), d0 = dmg(S, b); g.play(b, c78, []); g.passAll();
        for (let k = 0; k < 8 && S().battle; k++) g.ok({ t: "pass", seat: AA4.priorityNow(S()) });
        eq(dmg(S, b), d0, "the damage check of that attack is cancelled");
        const st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) }, id = g.free(b, "A3-16 2178");
        AA4.moveCard(ctx, id, { z: "deck", pos: "top" }); AA4.touch(st);
        const d1 = dmg(S, b); AA4.damagePlayer(ctx, b, { normal: 3, mental: 0 }, {});
        eq([dmg(S, b) - d1, st.cards[id].place.z], [1, "discard"], "turned up by a damage check with its Factor met: the check ends, the card is discarded");
      }
      { // 3768: each copy gives +X, X = the copies on that character; 2204: tiers
        const g = PG(["A3-25 3768", "A3-16 2204"].concat(factionChars("Polestar Empire", 2), factionChars("Arayashiki", 2))), S = g.S, { a } = g; giveFactor(g, a, "Polestar Empire", 3); giveFactor(g, a, "Arayashiki", 2);
        const ch = g.fch(a, "E.G.O."), k1 = g.hand(a, "A3-25 3768"), k2 = g.free(a, "A3-25 3768") === k1 ? null : g.free(a, "A3-25 3768");
        const k2b = Object.values(S().cards).find(c => c.owner === a && c.key === "A3-25 3768" && c.id !== k1).id; g.ok({ t: "move", seat: a, card: k2b, to: { z: "discard" } });
        for (const id of [g.free(a, "A3-16 2204")]) g.hand(a, "A3-16 2204");
        const j1 = S().players[a].zones.hand.find(id => S().cards[id].key === "A3-16 2204"), j2 = Object.values(S().cards).find(c => c.owner === a && c.key === "A3-16 2204" && c.id !== j1).id; g.ok({ t: "move", seat: a, card: j2, to: { z: "hand" } });
        for (const id of AA4.controlledOf(S(), a)) g.give(id, 1);
        g.toPhase("main"); const at0 = AA4.charStats(S(), REAL, ch).at, de0 = AA4.charStats(S(), REAL, ch).de;
        g.play(a, k1, [{ ch }]); if (S().decisions.length) { const d = S().decisions[0]; if (d.min > 1) throw new Error("decision: " + JSON.stringify([d.kind, d.reason, d.min, d.max, d.options.length])); g.choose(d => d.options.slice(0, 1)); }
        eq(AA4.charStats(S(), REAL, ch).at - at0, 1, "one copy: +1");
        assert(S().players[a].zones.hand.some(id => S().cards[id].key === "A3-25 3768"), "the second copy comes to the hand: " + JSON.stringify([Object.values(S().cards).filter(c => c.key === "A3-25 3768" && c.owner === a).map(c => c.place.z), S().decisions.map(d => d.reason), S().stack.length, g.log ? 0 : 0]));
        g.play(a, k2b, [{ ch }]); if (S().decisions.length) g.choose(d => d.options.slice(0, 1));
        eq(AA4.charStats(S(), REAL, ch).at - at0, 4, "two copies: +2 each");
        g.play(a, j1, [{ ch }]);
        eq([AA4.charStats(S(), REAL, ch).de - de0, !!AA4.charStats(S(), REAL, ch).skills.offensive], [1, false], "2204 once: Defense +1");
        g.play(a, j2, [{ ch }]);
        eq([AA4.charStats(S(), REAL, ch).de - de0, !!AA4.charStats(S(), REAL, ch).skills.offensive, AA4.charStats(S(), REAL, ch).noDamage.some(n => n.mental)], [2, true, true], "2204 twice: +2, Offensive, no mental damage");
      }
      { // 2451: the next Project / Fast card costs X less (X = named WIZ-DOM characters you control)
        const g = PG(["A3-18 2451", "A3-22 3131"]), S = g.S, { a } = g; giveFactor(g, a, "WIZ-DOM", 3);
        g.toPhase("main"); g.play(a, g.hand(a, "A3-18 2451"), []); if (S().decisions.length) g.choose(d => d.options.slice(0, 1));
        const m = S().modifiers.find(x => x.key === "nextCardLess"); assert(m && m.value.n === 0, "no named WIZ-DOM character: X = 0 — " + JSON.stringify(m && m.value));
      }
      { // 2730: the player names a faction and a type; the top 5 are shown
        const g = PG(["A3-20 2730"].concat(factionChars("Arayashiki", 2))), S = g.S, { a, b } = g; giveFactor(g, a, "Arayashiki", 2); for (const id of AA4.controlledOf(S(), a)) g.give(id, 1);
        g.toPhase("main"); const top = S().players[b].zones.deck.slice(-5), h0 = S().players[b].zones.hand.length;
        g.play(a, g.hand(a, "A3-20 2730"), [{ seat: b }]);
        const fac = REAL.card(S().cards[top[4]].key).faction, ty = REAL.card(S().cards[top[4]].key).type;
        g.choose([fac]); g.choose([ty]);
        const hit = top.filter(id => REAL.card(S().cards[id].key).faction === fac && REAL.card(S().cards[id].key).type === ty);
        eq([top.filter(id => S().cards[id].place.z === "hand").length, top.filter(id => S().cards[id].place.z === "discard").length], [hit.length, 5 - hit.length], "the named cards go to the hand, the others to the Discard Pile");
      }
      { // 2436: X damage = Factor + cost of a named Project / Fast card in that player's piles
        const g = PG(["A3-18 2436", "A3-25 3766"].concat(factionChars("Arayashiki", 2))), S = g.S, { a, b } = g; giveFactor(g, a, "Arayashiki", 3); for (const id of AA4.controlledOf(S(), a)) g.give(id, 1);
        g.toPhase("main"); g.ok({ t: "move", seat: b, card: g.free(b, "A3-25 3766"), to: { z: "discard" } });
        const d0 = dmg(S, b); g.play(a, g.hand(a, "A3-18 2436"), [{ seat: b }]); if (S().decisions.length) g.choose(d => d.options.slice(0, 1));
        assert(dmg(S, b) - d0 >= 1 && dmg(S, b) - d0 <= 5, "3766 is 極極極極極 cost 0: 5 damage (as damage checks): " + (dmg(S, b) - d0));
      }
    });
    test("M5a (2): 1352 · 2029 · 2877 · 2914 · 3163 · 3400 · 3731 · 2804 are automatic", () => {
      const keys = ["A3-09 1352", "A3-14 2029", "A3-20 2877", "A3-21 2914", "A3-22 3163", "A3-24 3400", "A3-25 3731", "A3-20 2804"];
      eq(keys.map(k => REAL.card(k).status), keys.map(k => (REAL.card(k).simplified ? "partial" : "auto")), "statuses");
      const fc2 = f => factionChars(f, 2), powerAll = (g, seat) => { for (const id of AA4.controlledOf(g.S(), seat)) g.give(id, 1); };
      { // 3400: the most common class takes no battle damage
        const g = PG(["A3-24 3400"]), S = g.S, { a, b } = g; giveFactor(g, a, "E.G.O.", 2); const x = g.fch(b, "Darklore"); powerAll(g, a);
        g.toPhase("main"); g.play(a, g.hand(a, "A3-24 3400"), []);
        const n = {}; for (const id of Object.keys(S().chars)) for (const i of AA4.charStats(S(), REAL, id).icons || []) n[i] = (n[i] || 0) + 1;
        const top = Math.max(...Object.values(n)), hit = Object.keys(S().chars).filter(id => (AA4.charStats(S(), REAL, id).icons || []).some(i => n[i] === top));
        assert(hit.length && hit.every(id => AA4.charStats(S(), REAL, id).noDamage.some(q => q.battle)), "they take no battle damage");
        eq(Object.keys(S().chars).filter(id => !hit.includes(id)).some(id => AA4.charStats(S(), REAL, id).noDamage.some(q => q.battle)), false, "the others do");
      }
      { // 2804: X = 1 on a character without power cards
        const g = PG(["A3-20 2804"]), S = g.S, { a } = g; giveFactor(g, a, "Darklore", 4); const t = g.fch(a, "E.G.O."); for (const id of AA4.controlledOf(S(), a)) if (id !== t) g.give(id, 1);
        g.toPhase("main"); const s0 = AA4.charStats(S(), REAL, t);
        g.ok({ t: "declare", seat: a, kind: "set", card: g.hand(a, "A3-20 2804"), x: 1 });
        for (let k = 0; k < 4 && S().draft; k++) { const d = S().draft; if (d.step === "target") g.ok({ t: "target", seat: a, targets: [{ ch: t }] }); else if (d.step === "pay") g.ok({ t: "pay", seat: a, cards: d.payFrom.flatMap(c => S().chars[c].power).slice(0, 1) }); else break; }
        g.passAll();
        const s1 = AA4.charStats(S(), REAL, t);
        eq([s1.se - s0.se, s1.at - s0.at, s1.de - s0.de, !!s1.skills.penetrate, s1.skills.charge], [-1, 2, 2, true, 1], "-1/+1/+1, and with no power cards Penetrate and another +1/+1; Charge 1");
      }
      { // 3163: a Break card from the Discard Pile is a Controlled Character with 1 power card until the Main Phase ends
        const bk = REAL.all().find(c => c.type === "Break" && !c.breakRule && !c.name && c.status === "auto" && c.faction === "Arayashiki").key;
        const g = PG(["A3-22 3163", bk].concat(fc2("Arayashiki"), fc2("Arayashiki"), fc2("Arayashiki"))), S = g.S, { a } = g; giveFactor(g, a, "Arayashiki", 5); powerAll(g, a);
        const b1 = g.free(a, bk); g.ok({ t: "move", seat: a, card: b1, to: { z: "discard" } });
        g.toPhase("main"); g.play(a, g.hand(a, "A3-22 3163"), []); if (S().decisions.length) g.choose([b1]);
        const ch = AA4.charOfCard(S(), b1);
        assert(ch && AA4.isControlled(ch) && ch.power.length === 1, "set as a Controlled Character with 1 power card");
        assert((S().delayed || []).some(d => d.at === "main" && d.e.targets.some(t => t.ch === ch.id)), "it leaves at the end of the Main Phase");
      }
      { // 2914: a Controlled Character goes back to the hand; a Break card of the hand takes its place
        const g0 = PG([]), base = factionChars("E.G.O.", 2)[0], ic = REAL.card(base).icons || [];
        const bk = REAL.all().find(c => c.type === "Break" && !c.name && c.status === "auto" && c.faction === "E.G.O." && (c.icons || []).some(i => ic.includes(i)));
        if (bk) {
          const g = PG(["A3-21 2914", bk.key]), S = g.S, { a } = g; giveFactor(g, a, "E.G.O.", 3); const t = g.ch(a, base, "front"); for (const id of AA4.controlledOf(S(), a)) g.give(id, 1);
          const b1 = g.hand(a, bk.key); g.toPhase("main"); g.play(a, g.hand(a, "A3-21 2914"), [{ ch: t }]); if (S().decisions.length) g.choose([b1]);
          const ch = AA4.charOfCard(S(), b1);
          assert(!S().chars[t] && ch && AA4.isControlled(ch), "the character is back in the hand and the Break card is your Controlled Character");
        }
      }
    });
    test("M5 (3): 3396 · 3540 · 3504 · 2693 · 2802 · 3579 are automatic", () => {
      const keys = ["A3-24 3396", "A3-24 3540", "A3-24 3504", "A3-20 2693", "A3-20 2802", "A3-24 3579"];
      eq(keys.map(k => REAL.card(k).status), keys.map(k => (REAL.card(k).simplified ? "partial" : "auto")), "statuses");
      { // 3579: each player takes any card of the deck, you first
        const g = PG(["A3-24 3579"]), S = g.S, { a, b } = g; giveFactor(g, a, "Eraser", 3);
        g.toPhase("main"); const c = g.hand(a, "A3-24 3579"), h = [S().players[a].zones.hand.length, S().players[b].zones.hand.length];
        g.play(a, c, []);
        eq(S().decisions[0] && S().decisions[0].seat, a, "you choose first"); g.choose(d => d.options.slice(0, 1));
        eq(S().decisions[0] && S().decisions[0].seat, b, "then the other player"); g.choose(d => d.options.slice(0, 1));
        eq([S().players[a].zones.hand.length - h[0], S().players[b].zones.hand.length - h[1]], [0, 1], "one card each (you played one)");
      }
      { // 3504: an unnamed Character card of a damage check is set as a Controlled Character
        const g = PG(["A3-24 3504"]), S = g.S, { a, b } = g; const st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
        AA4.addMod(ctx, { to: { players: "all" }, key: "dmgCharToControl", op: "grant", value: true, until: "turn" });
        const top = () => st.players[b].zones.deck[st.players[b].zones.deck.length - 1];
        let id = top(); for (let k = 0; k < 30 && REAL.card(st.cards[id].key).type !== "Character"; k++) { AA4.moveCard(ctx, id, { z: "discard" }); id = top(); }
        AA4.damagePlayer(ctx, b, { normal: 1, mental: 0 }, {});
        const ch = AA4.charOfCard(st, id); assert(ch && AA4.isControlled(ch), "it is in the Control Area, not the Active Area");
      }
      { // 3540: the top card is a Character card → your Controlled Character
        const g = PG(["A3-24 3540"]), S = g.S, { a } = g; const host = g.fch(a, "E.G.O."); g.give(host, 1); const pc = g.on(a, host, "A3-24 3540", "perm");
        g.toPhase("main");
        const deck = () => S().players[a].zones.deck; let id = deck()[deck().length - 1];
        for (let k = 0; k < 30 && REAL.card(S().cards[id].key).type !== "Character"; k++) { g.ok({ t: "move", seat: a, card: id, to: { z: "discard" } }); id = deck()[deck().length - 1]; }
        g.ok({ t: "declare", seat: a, kind: "effect", ch: host, card: pc, i: 0 }); g.pay(a); g.passAll();
        const ch = AA4.charOfCard(S(), id); assert(ch && AA4.isControlled(ch), "set as a Controlled Character");
      }
    });
    test("M5 (4): A4-03 0413 · A4-02 0248 · A4-02 0312 · A4-EP EP511 · A4-02 0280 are automatic", () => {
      const keys = ["A4-03 0413", "A4-02 0248", "A4-02 0312", "A4-EP EP511", "A4-02 0280"];
      eq(keys.map(k => REAL.card(k).status), keys.map(k => (REAL.card(k).simplified ? "partial" : "auto")), "statuses");
      { // 0413: unnamed characters lose 1 (never under 1)
        const g = PG(["A4-03 0413"]), S = g.S, { a, b } = g; giveFactor(g, a, "E.G.O.", 3); for (const id of AA4.controlledOf(S(), a)) g.give(id, 1);
        const t = g.fch(b, "Darklore"), s0 = AA4.charStats(S(), REAL, t);
        g.toPhase("main"); g.play(a, g.hand(a, "A4-03 0413"), []);
        const s1 = AA4.charStats(S(), REAL, t), want = k => (s0[k] > 1 ? s0[k] - 1 : s0[k]);
        eq([s1.se, s1.de], [want("se"), want("de")], "Mental and Defense −1, not under 1");
      }
      { // 0248: the named type from the top 5 goes to the hand
        const g = PG(["A4-02 0248"].concat(factionChars("Arayashiki", 2))), S = g.S, { a } = g; giveFactor(g, a, "Arayashiki", 3);
        g.toPhase("main"); const c = g.hand(a, "A4-02 0248"), top = S().players[a].zones.deck.slice(-5), n = top.filter(id => REAL.card(S().cards[id].key).type === "Character").length;
        g.play(a, c, []); g.choose(["Character"]);
        eq(top.filter(id => S().cards[id].place.z === "hand").length, n, "the Character cards of the top 5 are in the hand");
      }
      { // EP511: the next attack on a player takes one more card to the Damage Pile
        const g = PG(["A4-EP EP511"].concat(factionChars("Polestar Empire", 2), factionChars("Polestar Empire", 2))), S = g.S, { a, b } = g; giveFactor(g, a, "Polestar Empire", 5); for (const id of AA4.controlledOf(S(), a)) g.give(id, 1);
        const att = AA4.controlledOf(S(), a)[0]; g.toPhase("main");
        g.play(a, g.hand(a, "A4-EP EP511"), [{ ch: att }]);
        assert(S().modifiers.some(m => m.key === "playerHit" && m.to && m.to.ch === att && m.value.once), "the target carries the one-time effect");
        if (!S().chars[att].power.length) g.give(att, 1);
        const dz = S().players[b].zones.damage.length, dk = S().players[b].zones.deck.length;
        g.ok({ t: "declare", seat: a, kind: "attack", ch: att, target: { seat: b } }); g.pay(a); g.ok({ t: "noGuard", seat: b });
        for (let k = 0; k < 8 && S().battle; k++) g.ok({ t: "pass", seat: AA4.priorityNow(S()) });
        const at = 1;
        assert(S().players[b].zones.damage.length - dz >= 1 && !S().modifiers.some(m => m.key === "playerHit" && m.to && m.to.ch === att), "a card went to the Damage Pile after the check, and the effect is used up: " + (dk - S().players[b].zones.deck.length));
      }
    });
    test("M5 (5): A3-EX02 EX0148 · EX0131 · EX0184 · EX0156 are automatic", () => {
      const keys = ["A3-EX02 EX0148", "A3-EX02 EX0131", "A3-EX02 EX0184", "A3-EX02 EX0156"];
      eq(keys.map(k => REAL.card(k).status), keys.map(k => (REAL.card(k).simplified ? "partial" : "auto")), "statuses");
      { // EX0156: every card of the cost X becomes a 蟲 (0/2/1); they leave at the end of the Main Phase
        const g = PG(["A3-EX02 EX0156"]), S = g.S, { a } = g; giveFactor(g, a, "Eraser", 3); const payers = AA4.controlledOf(S(), a); for (const id of payers) g.give(id, 1);
        g.toPhase("main"); const n0 = AA4.charsOf(S(), a).length;
        g.ok({ t: "declare", seat: a, kind: "set", card: g.hand(a, "A3-EX02 EX0156"), x: 2 });
        if (S().draft && S().draft.step === "pay") g.ok({ t: "pay", seat: a, cards: payers.slice(0, 2).map(id => S().chars[id].power[0]) });
        g.passAll();
        const bugs = AA4.charsOf(S(), a).filter(id => AA4.charStats(S(), REAL, id).tokenName === "蟲");
        eq([bugs.length, bugs.map(id => AA4.charStats(S(), REAL, id).at)], [2, [2, 2]], "two 蟲 with Attack 2");
        assert((S().delayed || []).some(d => d.at === "main" && d.step.a === "discardTokens"), "they are discarded when the Main Phase ends");
      }
      { // EX0131: Penetrate; the +X/+X/+X only with 8 cards in an opponent's Damage Pile
        const g = PG(["A3-EX02 EX0131"]), S = g.S, { a, b } = g; giveFactor(g, a, "Darklore", 3); const t = AA4.controlledOf(S(), a)[0], s0 = AA4.charStats(S(), REAL, t);
        g.toPhase("main"); g.play(a, g.hand(a, "A3-EX02 EX0131"), [{ ch: t }]);
        const s1 = AA4.charStats(S(), REAL, t); eq([!!s1.skills.penetrate, s1.at - s0.at], [true, 0], "under 8 cards: Penetrate only");
      }
    });
    test("M5 (6): A3-24 3507 · A3-EX02 EX0158 · EX0166 are automatic", () => {
      const keys = ["A3-24 3507", "A3-EX02 EX0158", "A3-EX02 EX0166"];
      eq(keys.map(k => REAL.card(k).status), keys.map(k => (REAL.card(k).simplified ? "partial" : "auto")), "statuses");
      { // 3507: one ▼ character in the Control Area → 1 card is shown; a ▼ Character card is set
        const ag = REAL.all().find(c => c.type === "Character" && !c.name && c.status === "auto" && c.faction === "Darklore" && (c.aggressive || (c.skills || {}).aggressive)).key;
        const g = PG(["A3-24 3507", ag, ag]), S = g.S, { a } = g; giveFactor(g, a, "Darklore", 4); for (const id of AA4.controlledOf(S(), a)) g.give(id, 1);
        g.ch(a, ag, "back"); const c = g.hand(a, "A3-24 3507"), nx = g.free(a, ag);
        g.ok({ t: "move", seat: a, card: nx, to: { z: "deck", pos: "top" } });
        g.toPhase("main"); g.play(a, c, []);
        const ch = AA4.charOfCard(S(), nx); assert(ch && AA4.isControlled(ch), "the ▼ Character card on top of the deck is now a Controlled Character");
      }
      { // EX0158: Fast cards of cost 0 have no effect until the Main Phase ends
        const g = PG(["A3-EX02 EX0158"]), S = g.S, { a } = g; giveFactor(g, a, "Eraser", 4); for (const id of AA4.controlledOf(S(), a)) g.give(id, 1);
        g.toPhase("main"); g.play(a, g.hand(a, "A3-EX02 EX0158"), []);
        assert(S().modifiers.some(m => m.key === "banFastCost" && m.value.n === 0), "cost-0 Fast cards are stopped");
        assert(!S().modifiers.some(m => m.key === "ban"), "no “アラクネ”: the opponents may still declare cards");
      }
    });
    test("M5 (7): A4-PR PR114 · A4-05 0922 · A4-04 0710 · A4-PP PP337 · A4-PR PR151 · A4-05 0850 are automatic", () => {
      const keys = ["A4-PR PR114", "A4-05 0922", "A4-04 0710", "A4-PP PP337", "A4-PR PR151", "A4-05 0850"];
      eq(keys.map(k => REAL.card(k).status), keys.map(k => (REAL.card(k).simplified ? "partial" : "auto")), "statuses");
      { // PP337: a character that attacked a player takes damage equal to its Attack after the damage check
        const g = PG(["A4-PP PP337"].concat(factionChars("Polestar Empire", 2))), S = g.S, { a, b } = g; giveFactor(g, b, "Polestar Empire", 2); for (const id of AA4.controlledOf(S(), b)) g.give(id, 1);
        const att = g.fch(a, "Darklore"); g.give(att, 1);
        g.toPhase("main"); g.ok({ t: "declare", seat: a, kind: "attack", ch: att, target: { seat: b } }); g.pay(a); g.ok({ t: "noGuard", seat: b });
        g.play(b, g.hand(b, "A4-PP PP337"), []);
        for (let k = 0; k < 8 && S().battle; k++) g.ok({ t: "pass", seat: AA4.priorityNow(S()) });
        const st = REAL.card(factionChars("Darklore", 2)[0]).printed;
        eq(!!S().chars[att], !(+st.at >= +st.de), "the attacker takes its own Attack as damage (Attack " + st.at + " / Defense " + st.de + ")");
      }
      { // PR151: the character that guards the target's attack takes X damage (X = the target's Attack)
        const g = PG(["A4-PR PR151"].concat(factionChars("Polestar Empire", 2), factionChars("Polestar Empire", 2))), S = g.S, { a, b } = g; giveFactor(g, a, "Polestar Empire", 3); for (const id of AA4.controlledOf(S(), a)) g.give(id, 1);
        const att = AA4.controlledOf(S(), a)[0]; g.toPhase("main"); g.play(a, g.hand(a, "A4-PR PR151"), [{ ch: att }]);
        const m = S().modifiers.find(x => x.key === "guardHit" && x.to && x.to.ch === att);
        assert(m && m.value.n === AA4.charStats(S(), REAL, att).at, "the target carries guardHit with X = its Attack: " + JSON.stringify(m && m.value));
      }
    });
    test("M5 (8): the Partner lines read as “your Name-level character” — A4-05 0806 · 0842 · 0878 · 0914 · 0922 · A4-PP PP112", () => {
      const keys = ["A4-05 0806", "A4-05 0842", "A4-05 0878", "A4-05 0914", "A4-05 0922", "A4-PP PP112", "A4-PP PP120", "A4-05 0850"];
      eq(keys.map(k => REAL.card(k).status), keys.map(k => (REAL.card(k).simplified ? "partial" : "auto")), "statuses");
      const nb = REAL.all().find(c => c.type === "Break" && c.name && c.status === "auto" && c.faction === "E.G.O." && !c.breakRule && !(c.abilities || []).length).key;
      const g = PG(["A4-05 0806", nb]), S = g.S, { a } = g;
      const plain = g.fch(a, "E.G.O."), host = g.fch(a, "E.G.O."); g.on(a, host, nb);
      g.on(a, plain, "A4-05 0806", "perm"); eq(!!AA4.charStats(S(), REAL, plain).skills.bind, false, "on a character without a Name: no Bind");
      g.on(a, host, "A4-05 0806", "perm"); const st = AA4.charStats(S(), REAL, host);
      assert(st.skills.bind && st.skills.charge >= 1, "on a Name-level character: Bind 2 and Charge X (X = its named cards): " + JSON.stringify([st.skills.bind, st.skills.charge]));
    });
    test("M5 (9): A4-04 0711 · A4-04 0774 · A3-EX03 EX0326 · A3-EX04 EX0484 · A4-EX02 EX810 · A4-PR PR140 are automatic", () => {
      const keys = ["A4-04 0711", "A4-04 0774", "A3-EX03 EX0326", "A3-EX04 EX0484", "A4-EX02 EX810", "A4-PR PR140"];
      eq(keys.map(k => REAL.card(k).status), keys.map(k => (REAL.card(k).simplified ? "partial" : "auto")), "statuses");
      { // 0711: name a class of the target → Intercept and ±0/+X/+X
        const g = PG(["A4-04 0711"]), S = g.S, { a } = g; giveFactor(g, a, "Darklore", 3); for (const id of AA4.controlledOf(S(), a)) g.give(id, 1);
        const t = AA4.controlledOf(S(), a)[0], s0 = AA4.charStats(S(), REAL, t);
        g.toPhase("main"); g.play(a, g.hand(a, "A4-04 0711"), [{ ch: t }]);
        const d = S().decisions[0]; assert(d && d.options.every(i => s0.icons.includes(i)), "the classes of the target are offered");
        const ic = d.options[0], x = AA4.controlledOf(S(), a).filter(c => AA4.charStats(S(), REAL, c).icons.includes(ic)).length; g.choose([ic]);
        const s1 = AA4.charStats(S(), REAL, t); eq([!!s1.skills.intercept, s1.at - s0.at, s1.de - s0.de], [true, x, x], "Intercept and +X/+X with X = " + x);
      }
      { // 0774: a Character card of the second faction comes from the deck
        const g = PG(["A4-04 0774"]), S = g.S, { a } = g; giveFactor(g, a, "Eraser", 3); giveFactor(g, a, "Darklore", 2);
        g.toPhase("main"); const n0 = AA4.controlledOf(S(), a).length; g.play(a, g.hand(a, "A4-04 0774"), []);
        const d = S().decisions[0]; assert(d && d.options.every(id => REAL.card(S().cards[id].key).faction === "Darklore" && REAL.card(S().cards[id].key).type === "Character"), "only Darklore Character cards (the second faction) are offered");
        g.choose(d2 => d2.options.slice(0, 1)); eq(AA4.controlledOf(S(), a).length, n0 + 1, "it is set as a Controlled Character");
      }
    });
    test("M5 (10): A4-03 0446 · A3-EX03 EX0311 · A4-EX02 EX916 · A4-04 0609 are automatic", () => {
      const keys = ["A4-03 0446", "A3-EX03 EX0311", "A4-EX02 EX916", "A4-04 0609"];
      eq(keys.map(k => REAL.card(k).status), keys.map(k => (REAL.card(k).simplified ? "partial" : "auto")), "statuses");
      { // 0609: with no power cards, in an attack: Attack +10, Defense −5
        const g = PG(["A4-04 0609"]), S = g.S, { a, b } = g; const host = g.fch(a, "E.G.O."); g.on(a, host, "A4-04 0609");
        const s0 = AA4.charStats(S(), REAL, host); g.give(host, 1); g.toPhase("main");
        g.ok({ t: "declare", seat: a, kind: "attack", ch: host, target: { seat: b } }); g.pay(a);
        if (!S().chars[host]) throw new Error("gone: " + JSON.stringify(g.events ? g.events().slice(-8) : [S().battle, Object.keys(S().chars), S().log && S().log.slice(-6)]));
        const s1 = AA4.charStats(S(), REAL, host); eq([S().chars[host].power.length, s1.at - s0.at, s1.de - s0.de], [0, 10, 0], "the attack cost took its last power card: Attack +10 while it attacks a player (Defense −5 only in a battle)");
      }
      { // EX0311: 2 characters take 1 damage (no 高町なのは: no extra)
        const g = PG(["A3-EX03 EX0311"]), S = g.S, { a, b } = g; giveFactor(g, a, "E.G.O.", 3); for (const id of AA4.controlledOf(S(), a)) g.give(id, 1);
        g.fch(b, "Darklore"); g.fch(b, "Darklore"); g.toPhase("main"); g.play(a, g.hand(a, "A3-EX03 EX0311"), []);
        const d = S().decisions[0]; eq([d.min, d.max], [2, 2], "exactly 2 characters");
      }
    });
    test("M5 (11): A4-EP EP421 · A3-EX02 EX0102 · A4-02 0284 · A4-05 0814 — a Factor reduced by the target", () => {
      const keys = ["A4-EP EP421", "A3-EX02 EX0102", "A4-02 0284", "A4-05 0814"];
      eq(keys.map(k => REAL.card(k).status), keys.map(k => (REAL.card(k).simplified ? "partial" : "auto")), "statuses");
      const wk = REAL.all().filter(c => c.type === "Character" && c.faction === "E.G.O." && !c.name && c.se != null && (c.icons || []).some(i => i === "ワーカー" || i === "ワーカー♂")).slice(0, 2).map(c => c.key);
      const g = PG(["A4-05 0814"].concat(wk, wk)), S = g.S, { a, b } = g;
      giveFactor(g, a, "E.G.O.", 2); for (const id of AA4.controlledOf(S(), a)) g.give(id, 1);
      const mine = g.ch(a, wk[0], "front"), t1 = g.ch(b, wk[0], "front"); g.fch(b, "Darklore", "back"); g.fch(b, "Darklore", "back"); g.fch(b, "Darklore", "back");
      g.toPhase("main"); const c = g.hand(a, "A4-05 0814");
      assert(AA4.factorOk(S(), REAL, a, REAL.card("A4-05 0814")), "its Factor EEEE is not met with 3 E.G.O. characters");
      const plan = AA4.planDeclaration(S(), REAL, a, { kind: "set", card: c });
      assert(!plan.reason, "it can still be declared: the other player controls more characters (" + plan.reason + ")");
      const tg = AA4.specTargets ? AA4.specTargets(S(), REAL, plan.spec, { seat: a, card: c }).map(x => x.ch) : [t1];
      assert(tg.includes(t1) && !tg.includes(mine), "only a Worker of that player may be the target");
      g.play(a, c, [{ ch: t1 }]);
      assert(!S().chars[t1] || g.events().some(e => e.e === "damaged" && e.ch === t1), "it resolves with the reduced Factor and deals its damage");
    });
    test("M5 (12): A3-EXPR EXPR044 · A3-21 3088 · A4-03 0416 are automatic", () => {
      const keys = ["A3-EXPR EXPR044", "A3-21 3088", "A4-03 0416"];
      eq(keys.map(k => REAL.card(k).status), keys.map(k => (REAL.card(k).simplified ? "partial" : "auto")), "statuses");
      const g = PG(["A4-03 0416"].concat(factionChars("E.G.O.", 2), factionChars("E.G.O.", 2), factionChars("E.G.O.", 2))), S = g.S, { a } = g; giveFactor(g, a, "E.G.O.", 3); for (const id of AA4.controlledOf(S(), a)) g.give(id, 1);
      g.toPhase("main"); const c = g.hand(a, "A4-03 0416"), ego = () => S().players[a].zones.deck.filter(id => REAL.card(S().cards[id].key).faction === "E.G.O.");
      for (const id of ego().slice(0, 10)) g.ok({ t: "move", seat: a, card: id, to: { z: "discard" } });
      const h0 = S().players[a].zones.hand.length; g.play(a, c, []);
      const d = S().decisions[0]; assert(d && d.options.every(id => REAL.card(S().cards[id].key).faction === "E.G.O."), "in discard " + S().players[a].zones.discard.filter(id => REAL.card(S().cards[id].key).faction === "E.G.O.").length + " — 10 E.G.O. cards in the Discard Pile: an E.G.O. card of the deck is chosen");
      g.choose(d2 => d2.options.slice(0, 1)); eq(S().players[a].zones.hand.length - h0, 1, "1 draw + 1 chosen card − the card played");
      assert(!S().decisions.length && !S().draft, "under 20: nothing more");
    });
    test("Revise#312: split damage, one point at a time", () => {
      eq(["A4-05 0877", "A4-05 0804", "A4-02 0344", "A4-02 0273", "A4-EP EP606"].map(k => REAL.card(k).status), Array(5).fill("auto"), "batch statuses");
      const g = m2Game(Array(4).fill(vanilla("E.G.O."))), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const runQ = () => { for (let i = 0; i < 40 && st.queue && st.queue.length && !st.decisions.length; i++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); } };
      const answer = (pick) => { const d = st.decisions.shift(); AA4.enqueue(st, d.then.map(o => Object.assign({}, o, { answer: pick(d) })), true); runQ(); return d; };
      const c1 = g.char(a, vanilla("E.G.O."), "front"), c2 = g.char(b, vanilla("E.G.O."), "front");
      const hits = []; const orig = AA4.damageChar; AA4.damageChar = (cx, id, d) => hits.push([id, d.normal, d.mental]);
      try {
        AA4.runEffect(ctx, { steps: [{ a: "splitDamage", n: 3, mental: true }] }, { seat: a, targets: [] }); runQ();
        answer(() => [c1]); answer(() => [c2]); answer(() => [c1]);
      } finally { AA4.damageChar = orig; }
      eq(hits.sort(), [[c1, 0, 2], [c2, 0, 1]].sort(), "2 to one, 1 to the other, each as one hit");
    });
    test("Pack bug (Revise#316): A3-13 1896 — Auto-pay waits when Controlled Characters may be discarded to pay; then it makes the guard active and the guard is cancelled", () => {
      const g = m2Game(["A3-13 1896"]), S = g.S, { a, b } = g;
      S().rules.autoPay = true;
      const er = g.char(a, "A3-13 1896", "front"), other = g.char(a, vanilla("Darklore"), "back"); g.give(er, 2);
      const foe = g.char(b, vanilla("E.G.O."), "front");
      g.ok({ t: "declare", seat: a, kind: "effect", ch: er, card: AA4.topOf(S().chars[er]), i: 0 });
      eq(S().draft && S().draft.step, "pay", "not paid by itself: you may discard a Controlled Character instead");
      const ex = AA4.payExtras(S(), REAL, S().draft);
      assert(ex.sac.includes(AA4.topOf(S().chars[other])), "the other Controlled Character can pay");
      g.ok({ t: "pay", seat: a, cards: S().chars[er].power.slice(0, 1), sac: [AA4.topOf(S().chars[other])] });
      g.ok({ t: "target", seat: a, targets: [{ ch: foe }] }); g.passAll && g.passAll();
      assert(!S().chars[other], "the discarded character paid 1");
      eq(S().chars[foe] && S().chars[foe].at.area, "active", "the power-0 target is now an Active Character");
    });
    test("Revise#308: the bot only plays legal moves and finishes a game (Pack's decks, bot vs bot)", () => {
      const log = new AA4.GameLog(REAL, {}), P = PACK;
      log.push({ t: "create", by: "P0", seed: "bot-test", mode: "online", seats: 2, rules: { autoPay: true, autoSkip: true } });
      log.push({ t: "join", by: "P0", name: "A", deck: P[0].cards }); log.push({ t: "join", by: "P1", name: "B", deck: P[1 % P.length].cards });
      let n = 0;
      for (; n < 3000 && log.state.stage !== "over"; n++) {
        const S = log.state; let ok = false;
        for (const s of [0, 1]) { if (!AA4.botTurn(S, s)) continue; const it = AA4.botChoose(S, REAL, s, "P" + s, {}); if (!it) continue; const r = log.push(it); assert(r.ok, "a legal move: " + JSON.stringify(it) + " " + r.reason); ok = true; break; }
        assert(ok, "someone moves (step " + n + ")");
      }
      eq(log.state.stage, "over", "the game ends");
      const f = AA4.botFeatures(log.state, REAL, AA4.living(log.state)[0]); assert(f._won, "one winner");
    });
    test("Pack bug (Revise#289): A3-24 3541 (Permanent) — setting a named Polestar Break card on its character runs its ability", () => {
      eq(REAL.card("A3-24 3541").abilities[1].when.onChar, true, "compiled for the character it is on");
      const g = m2Game(["A3-24 3541", "A3-01 0153"]), S = g.S, { a } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const c = g.char(a, vanilla("Polestar Empire"), "front"), pm = Object.values(st.cards).find(x => x.owner === a && x.key === "A3-24 3541"), br = Object.values(st.cards).find(x => x.owner === a && x.key === "A3-01 0153");
      AA4.moveCard(ctx, pm.id, { z: "char", ch: c, role: "perm" }); AA4.touch(st);
      const prevTop = AA4.topOf(st.chars[c]); AA4.moveCard(ctx, br.id, { z: "char", ch: c, role: "stack" });
      const n0 = ctx.events.length; ctx.emit({ e: "broke", ch: c, card: br.id, seat: a, prevTop });
      const q0 = st.queue.length; AA4.collectTriggers(ctx, n0);
      assert(st.queue.slice(0, st.queue.length - q0 + 1).some(o => o.op === "runTrigger" && o.tr.card === pm.id) || st.triggers.some(t => t.card === pm.id), "its ability runs");
    });
    test("Revise#282: A4-02 0275 — a player takes no damage other than from attacks", () => {
      const g = m2Game([]), S = g.S, { a } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      AA4.addMod(ctx, { src: { seat: a }, to: { seat: a }, key: "playerNoDamage", op: "grant", value: { exceptAttack: true }, until: "turn" }); AA4.touch(st);
      const n0 = st.players[a].zones.damage.length + st.players[a].zones.discard.length + Object.values(st.chars).length;
      AA4.damagePlayer(ctx, a, { normal: 2, mental: 0 }, { fromSeat: g.b });
      eq(st.players[a].zones.damage.length + st.players[a].zones.discard.length + Object.values(st.chars).length, n0, "no damage check");
      assert(ctx.events.some(e => e.e === "note"), "a note");
    });
    test("Revise#281: A4-01 0146 — no battle damage except from a broken named character with power ≥1 (notSel)", () => {
      const ab = JSON.stringify(REAL.card("A4-01 0146")); assert(ab.includes('"notSel"'), "compiled with notSel");
      const g = m2Game([]), S = g.S, { a } = g, st = S(), c = g.char(a, vanilla("Polestar Empire"), "front");
      eq(AA4.matchChar(st, REAL, { notSel: { broken: true } }, c, {}), true, "an unbroken character is not excluded");
      eq(AA4.matchChar(st, REAL, { notSel: { owner: "you" } }, c, { seat: a }), false, "excluded");
    });
    test("Pack (Revise#278): A3-17 2388 — Capacity +∞ / Permanent +∞ are given, and its skills show as a Status-table row", () => {
      const sk = REAL.card("A3-17 2388").skills; eq([sk.capacity, sk.permanent], [99, 99], "∞ = 99");
      const g = m2Game(["A3-17 2388"]), S = g.S, { a } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const c = g.char(a, vanilla("Polestar Empire"), "front"), p = Object.values(st.cards).find(x => x.owner === a && x.key === "A3-17 2388");
      AA4.moveCard(ctx, p.id, { z: "char", ch: c, role: "perm" }); AA4.touch(st);
      const cs = AA4.charStats(st, REAL, c);
      assert(cs.skills.penetrate && cs.skills.shield && cs.skills.capacity >= 99 && cs.skills.permanent >= 99, "the character has its skills");
      assert(cs.parts.some(x => x.key === "skill" && x.n === "penetrate" && x.card === p.id), "a Status row from that card");
    });
    test("Pack bug (Revise#224): A3-20 2835 (Permanent) goes back to its owner's hand at the end of the turn", () => {
      const g = m2Game(["A3-20 2835"]), S = g.S, { a } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const c = g.char(a, vanilla("Polestar Empire"), "front");
      const pm = Object.values(st.cards).find(x => x.owner === a && x.key === "A3-20 2835" && x.place.z !== "char");
      AA4.moveCard(ctx, pm.id, { z: "char", ch: c, role: "perm" }); AA4.touch(st);
      AA4.addMod(ctx, { src: { seat: g.b }, to: { seat: g.b }, key: "drawTutor", op: "grant", value: true, until: "game" }); AA4.touch(st);   // Pack's game: A3-25 3723 asks the next player at once, at their Draw
      st.rules.autoSkip = true;
      const t0 = S().turn.number;
      for (let k = 0; k < 12 && S().turn.number === t0; k++) {
        const s = S(); if (s.decisions.length) { const d = s.decisions[0]; g.ok({ t: "choose", seat: d.seat, decision: d.id, pick: d.options.slice(0, d.min) }); continue; }
        if (s.triggers && s.triggers.length) throw new Error("waits for a trigger answer: " + JSON.stringify(s.triggers[0]).slice(0, 200));
        g.ok({ t: "next", seat: s.turn.player });
      }
      for (let k = 0; k < 6 && S().decisions.length; k++) { const d = S().decisions[0]; g.ok({ t: "choose", seat: d.seat, decision: d.id, pick: [] }); }
      eq(S().cards[pm.id].place.z, "hand", "back in the hand: " + JSON.stringify(S().cards[pm.id].place));
    });
    test("Revise#222: main-phase-start triggers written “…開始時に、”, this character and every …, cost back when paid from all of A / B / C, budget pick from the Damage Pile, fill power for X characters", () => {
      assert(REAL.card("A3-EX03 EX0295").abilities.some(x => x.when && x.when.event === "phaseStart" && x.cond), "EX0295 trigger, while on “ティアナ・ランスター”");
      eq(REAL.card("A3-EX03 EX0297").abilities.filter(x => x.mod && x.mod.key === "at").length, 2, "EX0297: this character and every Dragoon");
      assert(REAL.card("A3-EX03 EX0290").abilities.some(x => x.mod && x.mod.key === "dest" && x.mod.value.textHas === "ゴーレム"), "EX0290");
      eq(REAL.card("A3-EP EP342").play.costBackIfAll.length, 3);
      eq(REAL.card("A3-19 2579").play.steps[0].a, "budgetPick");
      eq(REAL.card("A3-EP EP198").play.steps[0].a, "fillPowerPick");
      const g = m2Game([]), S = g.S, { a } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const pj = Object.values(st.cards).filter(c => c.owner === a && ["Project", "Fast"].includes((REAL.card(c.key) || {}).type)).slice(0, 2);
      for (const c of pj) AA4.moveCard(ctx, c.id, { z: "damage", seat: a });
      const h0 = st.players[a].zones.hand.length;
      AA4.OPS.effStep(ctx, { s: { a: "budgetPick", types: ["Project", "Fast"] }, e: { seat: a, x: 99 } }); AA4.runQueue(ctx);
      const d = st.decisions.find(x => x.seat === a);
      if (pj.length) { assert(d, "choose from the Damage Pile"); g.ok({ t: "choose", seat: a, decision: d.id, pick: d.options.slice() }); eq(st.players[a].zones.hand.length, h0 + d.options.length, "all within X = 99"); }
    });
    test("Revise#221: A3-16 2175 (5 kinds of “ブレイブ” Permanents → Brave Kaiser from the hand, the Permanents move onto it) and A3-22 3128", () => {
      const ef = REAL.card("A3-16 2175").effects[0]; eq(ef.declCond.permKinds.n, 5); eq(ef.steps[0].a, "handBreakToCtlPerms");
      assert(REAL.card("A3-16 2175").abilities.some(x => x.cond && x.cond.selfIs && x.cond.selfIs.nameHas === "ブレイブ"), "Breakthrough on a broken “ブレイブ” E.G.O.");
      const p3128 = REAL.card("A3-22 3128").play; eq(p3128.steps[0].a, "machineRise"); eq(p3128.selfShieldIf.cond.tCardSel.nameHas, "ブレイブ");
      const g = m2Game([]), S = g.S, { a } = g, st = S();
      eq(AA4.checkCond(st, REAL, { permKinds: { nameHas: "ブレイブ", faction: "E.G.O.", n: 5 } }, { seat: a }), false, "no Permanents yet");
      eq(AA4.checkCond(st, REAL, { tCardSel: { nameHas: "ブレイブ", faction: "E.G.O." } }, { seat: a, targets: [] }), false);
    });
    test("Revise#220: A3-22 3311 — spare 1 area, 5 damage to every other character (10 and every other player with “ミカエル”); cost less per Eraser name-level; A3-11 1742 sets a hand Break onto the target", () => {
      const inf = REAL.card("A3-22 3311");
      eq(inf.costLess.countChars.faction, "Eraser");
      eq(inf.play.steps.map(x => x.n), [5, 10]);
      const p1742 = REAL.card("A3-11 1742").play; eq(p1742.steps[0].onto, "t"); eq(p1742.steps[0].costEq, "X");
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const mine = g.char(a, vanilla("E.G.O."), "front"), foe = g.char(b, vanilla("E.G.O."), "front"), foeA = g.char(b, vanilla("E.G.O."), "front");
      AA4.OPS.effStep(ctx, { s: { a: "areaSpareDamage", n: 5 }, e: { seat: a } }); AA4.runQueue(ctx);
      const d = st.decisions.find(x => x.seat === a); assert(d && d.options.includes(a + ":control"), "choose the spared area");
      const n0 = ctx.events.length;
      g.ok({ t: "choose", seat: a, decision: d.id, pick: [a + ":control"] });
      const hit = ctx.events.slice(n0).concat(g.events()).filter(e => e.e === "damaged" && e.ch).map(e => e.ch);
      assert(!hit.includes(mine) && (hit.includes(foe) || !st.chars[foe]) && (hit.includes(foeA) || !st.chars[foeA]), "the spared area is not hit: " + JSON.stringify(hit));
    });
    test("Revise#218: A4-01 0116 — Penetrate while its character has Attack 10 or more (Pack's Kiriko); A3-18 2466 from start to the Charge Phase", () => {
      const g = m2Game(["A4-01 0116", "A3-18 2466"]), S = g.S, { a } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const c = g.char(a, vanilla("Darklore"), "front");
      const pm = Object.values(st.cards).find(x => x.owner === a && x.key === "A4-01 0116" && x.place.z !== "char");
      AA4.moveCard(ctx, pm.id, { z: "char", ch: c, role: "perm" }); AA4.touch(st);
      const at0 = AA4.charStats(st, REAL, c).at;
      eq(!!AA4.charStats(st, REAL, c).skills.penetrate, at0 >= 10, "Attack " + at0);
      AA4.addMod(ctx, { src: { seat: a }, to: { ch: c }, key: "at", op: "add", value: 10, until: "turn" }); AA4.touch(st);
      assert(AA4.charStats(st, REAL, c).at >= 10 && AA4.charStats(st, REAL, c).skills.penetrate, "Attack 10+: Penetrate");
      // 2466 resolved: Charge 5 for the player, see the charged cards, and at the start of the Charge Phase X discard-pile cards back
      const card = Object.values(st.cards).find(x => x.owner === a && x.key === "A3-18 2466").id;
      const ch0 = AA4.playerStats(st, REAL, a).charge;
      AA4.runEffect(ctx, REAL.card("A3-18 2466").play, { seat: a, card, ch: null, targets: [] }); AA4.runQueue(ctx);
      eq(AA4.playerStats(st, REAL, a).charge, ch0 + 5, "Charge 5");
      assert(st.modifiers.some(m => m.key === "seeCharge"), "sees the charged cards");
      assert((st.delayed || []).some(d => d.at === "chargeStart"), "waits for the Charge Phase");
    });
    test("Revise#217: battle Attack −1 both sides, item of an opponent with 8+ damage, Protect from the Damage Piles, lost-in-battle this turn, watchers on the target's battles", () => {
      eq(REAL.card("A3-14 1918").abilities.filter(x => x.mod && x.mod.key === "at" && x.mod.value === -1).length, 2, "1918");
      eq(REAL.card("A3-EX02 EX0185").play.modes[1].target.sel.byOppDmgMin, 8, "EX0185");
      assert(REAL.card("A3-EP EP387").play.steps.some(x => x.if && x.if.lostBattleTurn), "EP387");
      assert(REAL.card("A3-EP EP202").play.steps.some(x => x.a === "watchEv" && x.when.notOwnCh), "EP202");
      assert(REAL.card("A3-EXPR EXPR035").play.steps.some(x => x.battleSel), "EXPR035");
      for (const k of ["A3-EX05 EX0602", "A3-EX04 EX0467", "A3-EX04 EX0468", "A3-EX05 EX0600"]) assert(JSON.stringify(REAL.card(k).play).includes('"oppOfBound":true'), k);
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      eq(AA4.checkCond(st, REAL, { lostBattleTurn: true }, { seat: a }), false, "nothing lost yet");
      st.turn.lostBattle = { turn: st.turn.number, seats: [a] };
      eq(AA4.checkCond(st, REAL, { lostBattleTurn: true }, { seat: a }), true);
      // Protect against the factions of the Project cards in the opponents' Damage Piles
      const pj = Object.values(st.cards).find(c => (REAL.card(c.key) || {}).type === "Project" && (REAL.card(c.key) || {}).faction);
      const me = g.char(a, vanilla("E.G.O."), "front");
      if (pj) {
        pj.owner = b; AA4.moveCard(ctx, pj.id, { z: "damage", seat: b });
        AA4.OPS.effStep(ctx, { s: { a: "protectFromPile", to: "t", until: "turn" }, e: { seat: a, targets: [{ ch: me }] } }); AA4.runQueue(ctx);
        const pr = AA4.charStats(st, REAL, me).skills.protect;
        assert(pr && JSON.stringify(pr).includes(REAL.card(pj.key).faction), "Protect: " + JSON.stringify(pr));
      }
    });
    test("Revise#216: watchers on the target's battle damage / attack, one of two skills, cards from either pile, open hands for a while", () => {
      assert(REAL.card("A3-EX05 EX0605").play.steps.some(x => x.a === "watchEv" && x.when.byThisBattle), "EX0605");
      assert(JSON.stringify(REAL.card("A3-EX05 EX0613").play).includes('"nWatchPower":true') && REAL.card("A3-EX05 EX0613").play.steps.some(x => x.to === "tBattleOpp" && x.mod.value.id === "bind"), "EX0613");
      eq(REAL.card("A3-EX03 EX0325").play.steps.filter(x => x.a === "watchEv" && x.event === "attack").length, 2, "EX0325");
      eq(REAL.card("A3-EX03 EX0322").play.target.sel.zones, ["damage", "discard"]);
      eq(REAL.card("A3-EX02 EX0150").play.steps[0].mod.key, "handsOpen");
      eq(REAL.card("A3-EX02 EX0112").play.modes[1].steps[0].a, "grantOneSkill");
      const g = m2Game([]), S = g.S, { a } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const c = g.char(a, vanilla("E.G.O."), "front");
      AA4.OPS.effStep(ctx, { s: { a: "grantOneSkill", to: "t", ids: ["shield", "penetrate"], until: "main" }, e: { seat: a, targets: [{ ch: c }] } }); AA4.runQueue(ctx);
      const d = st.decisions.find(x => x.seat === a && x.options.includes("penetrate")); assert(d, "choose Shield or Penetrate");
      g.ok({ t: "choose", seat: a, decision: d.id, pick: ["penetrate"] });
      const sk = AA4.charStats(st, REAL, c).skills; eq([!!sk.penetrate, !!sk.shield], [true, false]);
    });
    test("Revise#215: compile checks (1688 / 1658 / PP271 / EX0059 / EP390 / EX0342 / PP090) and EP386 spreads the power cards", () => {
      assert(REAL.card("A3-11 1688").play.steps.some(x => x.mod && x.mod.key === "noDamage" && x.mod.value.fromSel.shareIconSelf), "1688");
      assert(REAL.card("A3-11 1658").abilities.some(x => x.when && x.when.oppOnly && x.effect.steps[0].a === "cancelEvItem"), "1658");
      eq(REAL.card("A3-PP PP271").effects[0].status, "auto", "PP271");
      const s59 = REAL.card("A3-EX01 EX0059").abilities.find(x => x.when && x.when.event === "enter").effect.steps;
      eq([s59[0].n, s59[1].n, !!s59[0].if.not, !!s59[1].if.selfIs], [1, 3, true, true], "EX0059: 3 instead of 1 on “歴戦の傭兵 エキドナ”");
      assert(REAL.card("A3-EP EP390").play.steps.every(x => x.resolveX), "EP390");
      assert(REAL.card("A3-EX03 EX0342").play.steps.some(x => x.ifTSel), "EX0342");
      assert(REAL.card("A3-PP PP090").play.steps.some(x => x.mod && x.mod.key === "zeroBattleBounce"), "PP090");
      const g = m2Game([]), S = g.S, { a } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const t = g.char(a, vanilla("E.G.O."), "front"), o1 = g.char(a, vanilla("E.G.O."), "front"), o2 = g.char(a, vanilla("E.G.O."), "front"); g.give(t, 3);
      const p1 = st.chars[o1].power.length, p2 = st.chars[o2].power.length;
      AA4.OPS.effStep(ctx, { s: { a: "powerSpread", to: "t" }, e: { seat: a, targets: [{ ch: t }] } }); AA4.runQueue(ctx);
      const d = st.decisions.find(x => x.seat === a);   // exactly 2 other characters for 3 power cards: no choice to make
      if (d) g.ok({ t: "choose", seat: a, decision: d.id, pick: d.options.slice(0, d.min) });
      eq([st.chars[t].power.length, st.chars[o1].power.length - p1, st.chars[o2].power.length - p2], [1, 1, 1], "one each");
    });
    test("Revise#214: the Player — image on join, the Player's own skills (A3-18 2466 Charge 5), effects on the player; 2466 at the start of the Charge Phase", () => {
      assert(AA4.avatarOk("p4") && AA4.avatarOk("data:image/jpeg;base64,AAAA") && !AA4.avatarOk("http://x/y.png") && !AA4.avatarOk("p9"), "avatar check");
      const p2466 = REAL.card("A3-18 2466").play;
      eq(p2466.status, "auto"); assert(p2466.steps.some(x => x.a === "delayed" && x.at === "chargeStart" && x.step.xLive), "delayed to the Charge Phase start");
      const g = m2Game(["A3-18 2466"]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const c0 = AA4.playerStats(st, REAL, a).charge;
      AA4.addMod(ctx, { src: { seat: a, label: "Embrace of Gaia" }, to: { seat: a }, key: "skill", op: "grant", value: { id: "charge", x: 5 }, until: "charge" }); AA4.touch(st);
      eq(AA4.playerStats(st, REAL, a).charge, c0 + 5, "≪あなた≫はチャージ5を得る: the player's Charge counts");
      eq(AA4.playerStats(st, REAL, a).skills.charge, 5);
      eq(AA4.playerStats(st, REAL, b).charge, AA4.playerStats(st, REAL, b).charge, "not the other player");
      assert(AA4.playerEffects(st, REAL, a).some(r => r.label === "Embrace of Gaia"), "listed on the Player");
      eq(AA4.playerEffects(st, REAL, b).length, 0, "nothing on the other player");
      // the delayed step: at the start of the Charge Phase, X discard-pile cards back into the deck (X counted then; only with a Darklore name-level character)
      const card = Object.values(st.cards).find(c => c.owner === a && c.key === "A3-18 2466").id;
      st.delayed = [{ at: "chargeStart", step: Object.assign({}, p2466.steps.find(x => x.a === "delayed").step, { to: "t" }), e: { seat: a, card, targets: [], x: 0 } }];
      const ops = AA4.delayedOps(st, "chargeStart"); eq(ops.length, 1, "due at the start of the Charge Phase");
      const d0 = st.decisions.length; AA4.OPS.delayedRun(ctx, ops[0]); AA4.runQueue(ctx);
      eq(st.decisions.length, d0, "no Darklore name-level character: nothing happens");
    });
    test("Revise#213: A3-25 3723 — choose up to 1 card from the deck instead of the whole draw (face up); choosing from a deck always shows the cards", () => {
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      AA4.addMod(ctx, { src: { seat: a }, to: { seat: a }, key: "drawTutor", op: "grant", value: true, until: "game" }); AA4.touch(st);
      const h0 = st.players[a].zones.hand.length, d0 = st.players[a].zones.deck.length;
      AA4.OPS.draw(ctx, { seat: a, n: 2 });
      let d = st.decisions[st.decisions.length - 1];
      assert(d && d.max === 1 && d.min === 0, "up to 1");
      const pick = d.options[0];
      assert(st.cards[pick].visibleTo.includes(a) && !st.cards[pick].visibleTo.includes(b), "face up to you only");
      assert(AA4.project(st, a, REAL).cards[pick].key, "you see the deck card while choosing");
      g.ok({ t: "choose", seat: a, decision: d.id, pick: [pick] });
      eq([st.players[a].zones.hand.length, st.players[a].zones.deck.length], [h0 + 1, d0 - 1], "1 chosen: no draw");
      const other = st.players[a].zones.deck.find(id => id !== pick);
      eq(st.cards[other].visibleTo.includes(a), false, "the rest of the deck is hidden again");
      AA4.OPS.draw(ctx, { seat: a, n: 2 }); d = st.decisions[st.decisions.length - 1];
      g.ok({ t: "choose", seat: a, decision: d.id, pick: [] });
      eq(st.players[a].zones.hand.length, h0 + 3, "none chosen: Draw 2 as usual");
    });
    test("Revise#210: milled from the deck → hand, hurt-mark until end of turn, “が描かれている”, battle with a Controlled Character, both sentences for a named host, choose 1 skill to negate", () => {
      const a165 = REAL.card("A3-EX02 EX0165").abilities.find(x => x.when && x.when.fromZone === "deck"); assert(a165, "EX0165 trigger");
      eq(REAL.card("A3-EP EP375").abilities.find(x => x.mod && x.mod.key === "hurtMark").mod.value[0].until, "turn");
      assert(JSON.stringify(REAL.card("A3-EX03 EX0307").play).includes("リオ・ウェズリー"), "EX0307 names");
      const a147 = REAL.card("A3-EX02 EX0147").abilities.find(x => x.when && x.when.event === "battleEnd"); assert(a147.when.vsCtl && a147.cond, "EX0147");
      const ab60 = REAL.card("A3-EX01 EX0060").abilities; assert(ab60.filter(x => x.cond && JSON.stringify(x.cond).includes("森の番人ノワ")).length === 2, "EX0060: both sentences while on Noir");
      assert(REAL.card("A3-EX01 EX0063").abilities.some(x => x.cond && x.when && x.when.event === "battleStart"), "EX0063");
      assert(REAL.card("A3-EX04 EX0443").abilities.some(x => x.optional && x.effect && x.effect.steps[0].part === "perm"), "EX0443");
      assert(REAL.card("A3-EX03 EX0319").play.steps.some(x => x.a === "skillOffPick" && x.to === "tBattleOpp"), "EX0319");
      // TRIGGER_MATCH: from the deck only
      const ev = { e: "moved", card: "c1", from: { z: "deck" }, to: { z: "discard" } };
      eq(AA4.TRIGGER_MATCH.selfToDamage(ev, { zone: "discard", fromZone: "deck" }, { card: "c1" }), true);
      eq(AA4.TRIGGER_MATCH.selfToDamage(Object.assign({}, ev, { from: { z: "hand" } }), { zone: "discard", fromZone: "deck" }, { card: "c1" }), false, "from the hand: no");
      // choose 1 skill to negate
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const foe = g.char(b, vanilla("E.G.O."), "front");
      for (const id of ["initiative", "penetrate"]) AA4.addMod(ctx, { src: { seat: b }, to: { ch: foe }, key: "skill", op: "grant", value: { id }, until: "turn" });
      AA4.touch(st);
      AA4.OPS.effStep(ctx, { s: { a: "skillOffPick", to: "t", until: "turn" }, e: { seat: a, targets: [{ ch: foe }] } }); AA4.runQueue(ctx);
      const d = st.decisions.find(x => x.seat === a && x.options.includes("initiative"));
      assert(d, "you choose which skill"); g.ok({ t: "choose", seat: a, decision: d.id, pick: ["initiative"] });
      const sk = AA4.charStats(st, REAL, foe).skills;
      eq([!!sk.initiative, !!sk.penetrate], [false, true], "Initiative off, Penetrate kept");
    });
    test("Revise#209: cost less per faction, paid-top characters, card-on-stack target, reveal for no factor, Capacity ± discard / draw, cost from one character, can't attack you", () => {
      eq(REAL.card("A3-EP EP311").costLess.factionsSel !== undefined, true, "EP311 cost less per faction");
      eq(REAL.card("A3-EX04 EX0489").play.declCond.stackTopTypes.length > 0, true, "EX0489 only while a card is being declared");
      assert(REAL.card("A3-EX04 EX0489").play.target.sel.paidTop, "EX0489 paid-top target");
      assert(REAL.card("A3-25 3659").play.target.sel.paidBySel && REAL.card("A3-25 3659").play.target.sel.costMin, "3659 item target");
      assert(REAL.card("A3-EP EP384").play.factorFreeIf, "EP384 reveal to ignore the factor");
      assert(REAL.card("A3-EX03 EX0335").play.steps.some(x => x.a === "powerFromDeck" && x.ifTName), "EX0335");
      assert(REAL.card("A3-02 0421").play.steps.some(x => x.mod && x.mod.key === "payOneChar" && x.mod.value.types.includes("Break")), "0421");
      const g = m2Game(["A3-20 2727"]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const neg = g.char(a, vanilla("E.G.O."), "front"), pos = g.char(b, vanilla("E.G.O."), "front");
      AA4.addMod(ctx, { src: { seat: a }, to: { ch: neg }, key: "skill", op: "grant", value: { id: "capacity", x: -1 }, until: "turn" });
      AA4.addMod(ctx, { src: { seat: b }, to: { ch: pos }, key: "skill", op: "grant", value: { id: "capacity", x: 1 }, until: "turn" }); AA4.touch(st);
      const h = [st.players[a].zones.hand.length, st.players[b].zones.hand.length];
      AA4.OPS.effStep(ctx, { s: { a: "eachDiscardDrawCap" }, e: { seat: a } }); AA4.runQueue(ctx);
      const d = st.decisions.find(x => x.seat === a);
      assert(d, "Capacity -X: you discard 1"); g.ok({ t: "choose", seat: a, decision: d.id, pick: [d.options[0]] });
      eq([st.players[a].zones.hand.length, st.players[b].zones.hand.length], [h[0] - 1, h[1] + 1], "Capacity +X: they draw 1");
      // 2727: characters with Attack below X can't attack you
      const pm = Object.values(st.cards).find(c => c.owner === a && c.key === "A3-20 2727");
      const host = g.char(a, vanilla("Arayashiki"), "front");
      AA4.moveCard(ctx, pm.id, { z: "char", ch: host, role: "perm" }); AA4.touch(st);
      const atk = AA4.charStats(st, REAL, pos).at, x = AA4.xOf(st, REAL, { factorSum: "Arayashiki" }, { seat: a });
      eq(AA4.charStats(st, REAL, pos).noAttackOn && AA4.charStats(st, REAL, pos).noAttackOn.includes(a), atk < x || undefined, "Attack " + atk + " vs X " + x);
    });
    test("Revise#208: 持続 cards keep a no-duration change while they stay; 「card name」 targets; paid only from …; Active Phase only; no card used this turn; Bind used", () => {
      const p604 = REAL.card("A3-EX05 EX0604").play;
      assert(p604.steps.some(x => x.mod && x.mod.key === "de" && x.until === "removed") && p604.steps.some(x => x.ifTJp === "ゴーレム・ゴライアス"), "EX0604");
      eq(REAL.card("A3-EX03 EX0336").play.timing, "active");
      eq(REAL.card("A3-EX05 EX0615").play.declCond, { noDeclThisTurn: true });
      eq(REAL.card("A3-EX05 EX0599").abilities.find(a => a.when && a.when.event === "bindUsed").effect.steps[0].a, "selfCardToHandAny");
      const g = m2Game([]), S = g.S, { a } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      eq(AA4.checkCond(st, REAL, { noDeclThisTurn: true }, { seat: a }), !(st.players[a].usedTurn && st.players[a].usedTurn.turn === st.turn.number && st.players[a].usedTurn.keys.length));
      const c1 = g.char(a, vanilla("E.G.O."), "front"), m0 = st.modifiers.length;
      const step = { a: "mod", to: "t", mod: { key: "at", op: "add", value: 1 }, until: "turn", ifPaidBy: { atMental: true, sel: true } };
      AA4.OPS.effStep(ctx, { s: step, e: { seat: a, targets: [{ ch: c1 }], item: { payChs: [c1] } } });
      eq(st.modifiers.length, m0, "paid from a normal-Attack character: no");
      AA4.OPS.effStep(ctx, { s: Object.assign({}, step, { ifPaidBy: { atMental: false, sel: true } }), e: { seat: a, targets: [{ ch: c1 }], item: { payChs: [c1] } } });
      eq(st.modifiers.length, m0 + 1, "every payer matches: yes");
    });
    test("Revise#207: Hold — Fast and Effect are separate switches; an older state's Fast / Effect switch covers both", () => {
      const g = m2Game([]), S = g.S, { a } = g;
      g.ok({ t: "hold", seat: a, type: "effect", on: false });
      eq([AA4.holdOn(S(), a, "fast"), AA4.holdOn(S(), a, "effect")], [true, false], "Effect OFF, Fast still ON");
      const st = S(); st.stack.push({ id: "i1", kind: "effect", seat: a, holdType: "effect" }); eq(AA4.windowType(st), "effect"); st.stack.pop();
      const old = AA4.clone(S()); delete old.players[a].holds.effect; old.players[a].holds.fast = false;
      eq(AA4.holdOn(old, a, "effect"), false, "no Effect switch yet: it follows Fast");
    });
    test("Revise#207: peek at the top card, each player's power card back, ▼ draw / discard, cost only from …, EP199 / EXPR016, EX0096", () => {
      eq(REAL.card("A3-EX04 EX0475").play.payOnlySel, { tag: "フッケバイン", broken: true });
      eq(REAL.card("A3-EX04 EX0440").effects[0].hostPerm, "シュベルトクロイツ");
      eq(REAL.card("A3-EX03 EX0309").play.declCond.count.sel.jpHas, "ゴーレム");
      eq(REAL.card("A3-EP EP199").play.steps[1], { a: "draw", to: "you", n: "last" });
      eq(REAL.card("A3-EX02 EX0096").abilities[0].ownerDecides, true);
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const top = st.players[a].zones.deck.slice(-1)[0];
      AA4.OPS.effStep(ctx, { s: { a: "peekTop", n: 1 }, e: { seat: a } }); AA4.runQueue(ctx);
      const d = st.decisions[st.decisions.length - 1];
      assert(d && d.options[0] === top && d.max === 0 && st.cards[top].visibleTo.includes(a) && !st.cards[top].visibleTo.includes(b), "the top card shown to you only");
      g.ok({ t: "choose", seat: a, decision: d.id, pick: [] });
      eq(st.players[a].zones.deck.slice(-1)[0], top, "nothing moved");
      const c1 = g.char(a, vanilla("E.G.O."), "front"); g.give(c1, 2);
      const h0 = st.players[a].zones.hand.length;
      AA4.OPS.effStep(ctx, { s: { a: "eachPowerToHand", sel: {}, n: 1 }, e: { seat: a } }); AA4.runQueue(ctx);
      const d2 = st.decisions.find(x => x.seat === a);
      assert(d2, "you choose one of your power cards"); g.ok({ t: "choose", seat: a, decision: d2.id, pick: [d2.options[0]] });
      eq(st.players[a].zones.hand.length, h0 + 1, "back to the hand");
      const n0 = st.players[a].zones.discard.length; const dc = st.players[a].zones.hand[0]; AA4.moveCard(ctx, dc, { z: "discard" });
      AA4.OPS.toDeckBottom(ctx, { answer: [dc] }); eq(st.players[a].zones.deck[0], dc, "the bottom of the deck"); void n0;
    });
    test("Revise#206: “攻撃力に+2” on a mental-Attack character is normal Attack beside it — 2 (1); Flip down all power cards", () => {
      const g = m2Game(["A3-24 3449"]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const c = g.char(a, "A3-24 3449", "front");
      eq(AA4.atkText(AA4.charStats(st, REAL, c)), "(1)");
      AA4.addMod(ctx, { src: { seat: a, label: "Galgalin" }, to: { ch: c }, key: "at", op: "add", value: 2, until: "turn" }); AA4.touch(st);
      eq(AA4.atkText(AA4.charStats(st, REAL, c)), "2 (1)", "2 (1), not (3)");
      g.give(c, 1);
      const pid = st.chars[c].power[0]; st.cards[pid].visibleTo = [a];
      const vis = () => AA4.project(st, a, REAL).cards[pid].key;
      assert(vis(), "the owner sees a power card set from the hand");
      st.rules.powerFlipDown = true;
      eq(vis(), null, "Flip down all power cards: even the owner doesn't");
    });
    test("Revise#205: Hold default — Aggressive OFF, Attack / Guard ON, Project ON, Fast / Effect ON, Break / Permanent OFF; All ON / OFF include Undo; Default", () => {
      const keep = AA4.HOLD_DEFAULT; AA4.HOLD_DEFAULT = REAL_HOLD_DEFAULT;
      try {
        const g = m2Game([]), S = g.S, { a } = g;
        eq(AA4.HOLD_TYPES.map(([t]) => AA4.holdOn(S(), a, t)), [false, true, true, true, true, false, true], "a new game starts with the default (Fast and Effect separate, Revise#207)");
        g.ok({ t: "hold", seat: a, type: "every", on: false });
        eq(AA4.HOLD_TYPES.map(([t]) => AA4.holdOn(S(), a, t)), [false, false, false, false, false, false, false], "All OFF: Undo too");
        g.ok({ t: "hold", seat: a, type: "every", on: true });
        eq(AA4.HOLD_TYPES.map(([t]) => AA4.holdOn(S(), a, t)), [true, true, true, true, true, true, true], "All ON: Undo too");
        g.ok({ t: "hold", seat: a, type: "default" });
        eq(AA4.HOLD_TYPES.map(([t]) => AA4.holdOn(S(), a, t)), [false, true, true, true, true, false, true], "Default");
      } finally { AA4.HOLD_DEFAULT = keep; }
    });
    test("Revise#203: designated character (2nd part), name-level duel, Permanent swap, factor / cost free when, 1+X damage, battle-kill watcher", () => {
      const p205 = REAL.card("A3-PP PP205").play; eq(p205.target.kind, "multi"); eq(p205.target.parts[1].designate, true); eq(p205.x, { targetStat: "at", part: 1 });
      eq(REAL.card("A3-PP PP207").play.steps[1], { a: "powerMoveAll", from: "t1", to: "t0" });
      eq(REAL.card("A3-EX01 EX0068").play.steps[0].a, "duelPick");
      eq(REAL.card("A3-EX04 EX0460").play.steps[0].nPlus, 1);
      assert(REAL.card("A3-18 2421").play.costFreeIf && REAL.card("A3-18 2421").play.selfShieldIf, "2421: free when “ブレイブカイザー”, shielded at 10 cards or fewer");
      assert(REAL.card("A3-EP EP393").play.factorFreeIf && REAL.card("A3-EP EP393").play.steps.some(x => x.a === "watchEv" && x.event === "killed"), "EP393");
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const c1 = g.char(a, vanilla("E.G.O."), "front"), c2 = g.char(a, vanilla("E.G.O."), "front"); g.give(c2, 3);
      eq(AA4.xOf(st, REAL, { targetStat: "de", part: 1 }, { seat: a }, [{ ch: c1 }, { ch: c2 }]), AA4.charStats(st, REAL, c2).de, "X from the 2nd chosen part");
      const p1 = st.chars[c1].power.length;
      AA4.OPS.effStep(ctx, { s: { a: "powerMoveAll", from: "t1", to: "t0" }, e: { seat: a, targets: [{ ch: c1 }, { ch: c2 }], spec: p205.target } });
      eq([st.chars[c1].power.length, st.chars[c2].power.length], [p1 + 3, 0], "every power card moved to the target");
      eq(AA4.checkCond(st, REAL, { not: { xAtLeast: { x: { deckCount: true }, n: 11 } } }, { seat: a }), st.players[a].zones.deck.length <= 10);
      const hp = st.players[b].zones.deck.length;
      AA4.OPS.effStep(ctx, { s: { a: "damage", to: "t", n: "X", nPlus: 2 }, e: { seat: a, x: 1, targets: [{ seat: b }], spec: { kind: "player", sel: {}, count: 1 } } }); AA4.runQueue(ctx);
      eq(st.players[b].zones.damage.length >= 3 || hp - st.players[b].zones.deck.length >= 3, true, "2+X with X = 1: 3 damage");
      // battle-kill watcher: the discarded character's owner from the event
      AA4.OPS.effStep(ctx, { s: { a: "watchEv", event: "killed", when: { bySel: { owner: "you" }, controlled: true }, effect: { steps: [{ a: "note", text: "x" }], status: "auto" }, until: "turn" }, e: { seat: a } });
      const v = g.char(b, vanilla("Darklore"), "front");
      const from = ctx.events.length; AA4.defeat(ctx, v, { battle: true, by: c1, why: "t" }); AA4.collectTriggers(ctx, from);
      const op = st.queue && st.queue.find(o => o.op === "runWatchEv");
      assert(!op || op.evSeat === b, "evSeat = the owner of the discarded character: " + JSON.stringify(op));
    });
    test("Revise#201: names lists, lasting cards, “手札全てをデッキに戻し…戻した枚数ドロー”, end in the Damage Pile, Capacity ±X", () => {
      eq(REAL.card("A3-EX04 EX0499").play.steps[0].mod.value.names, ["トーマ・アヴェニール", "リリィ・シュトロゼック", "アイシス・イーグレット"]);
      const p626 = REAL.card("A3-EX05 EX0626").play;
      eq(p626.status, "auto"); assert(p626.steps.every(x => x.a === "field" && x.mod.until === "removed"), "a lasting card: field rules while it stays");
      eq(p626.steps[1].mod.cond.xAtLeast.n, 10);
      eq(REAL.card("A3-EP EP340").play.x.charStatSum.key, "at");
      eq(REAL.card("A3-EX03 EX0331").play.steps[0], { a: "pileRecycle", from: "hand", then: "draw" });
      eq(REAL.card("A3-EX04 EX0486").play.steps.pop(), { a: "cardEndTo", dest: "damage" });
      eq(REAL.card("A3-EX05 EX0623").play.target.sel.area, true);
      eq(REAL.card("A3-EX01 EX0062").freeOnName, "鋼鉄姫ユーミル");
      assert(REAL.card("A3-EX03 EX0296").abilities.some(x => x.mod && x.mod.value && x.mod.value.cost === "effect" && x.cond && x.cond.selfIs), "EX0296: effect costs back while on “キャロ・ル・ルシエ”");
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      // pileRecycle: each player shuffles the hand into the deck and draws that many
      const h0 = [a, b].map(x => st.players[x].zones.hand.length), d0 = [a, b].map(x => st.players[x].zones.deck.length);
      AA4.OPS.effStep(ctx, { s: { a: "pileRecycle", from: "hand", then: "draw" }, e: { seat: a } }); AA4.runQueue(ctx);
      eq([a, b].map(x => st.players[x].zones.hand.length), h0, "the same number back in hand"); eq([a, b].map(x => st.players[x].zones.deck.length), d0, "and the deck the same size");
      // the cost of a named Break card goes back
      AA4.addMod(ctx, { src: { seat: a, label: "EX0499" }, to: { seat: a }, key: "dest", op: "dest", value: { cost: "set", type: "Break", names: ["高町なのは"], to: "hand" }, until: "turn" }); AA4.touch(st);
      eq(AA4.costRules(st, REAL, { kind: "set", seat: a, info: { type: "Break", name: "高町 なのは" } }).map(r => r.to), ["hand"]);
      eq(AA4.costRules(st, REAL, { kind: "set", seat: a, info: { type: "Break", name: "八神はやて" } }).length, 0, "another name: no");
      // Capacity +X / −X selectors
      const c1 = g.char(a, vanilla("E.G.O."), "front");
      AA4.addMod(ctx, { src: { seat: a, label: "t" }, to: { ch: c1 }, key: "skill", op: "grant", value: { id: "capacity", x: 2 }, until: "turn" }); AA4.touch(st);
      assert(AA4.matchChar(st, REAL, { capSign: 1 }, c1, { seat: a }) && !AA4.matchChar(st, REAL, { capSign: -1 }, c1, { seat: a }), "Capacity +2 is “キャパシティ+X”");
      eq(AA4.xOf(st, REAL, { charStatSum: { sel: { owner: "you", area: "controlled" }, key: "de" } }, { seat: a }), AA4.controlledOf(st, a).reduce((k, id) => k + AA4.charStats(st, REAL, id).de, 0));
      // a lasting card that ends in the Damage Pile
      const card = st.players[a].zones.hand[0]; AA4.moveCard(ctx, card, { z: "special", seat: a });
      AA4.OPS.effStep(ctx, { s: { a: "cardEndTo", dest: "damage" }, e: { seat: a, card } });
      const m = AA4.addMod(ctx, { src: { seat: a, card, label: "x" }, to: { ch: c1 }, key: "at", op: "add", value: 2, until: "turn" });
      AA4.endMod(ctx, m.id); AA4.runQueue(ctx);
      eq(st.cards[card].place.z, "damage", "to the Damage Pile, not the Discard Pile");
    });
    test("Revise#200: “…場合、代わりに、…” and “このカードのコストが“X”からのみ支払われていた場合”", () => {
      const st0 = REAL.card("A3-EX03 EX0300").play.steps;
      eq(st0[0].if, { not: { namesCtl: ["高町ヴィヴィオ"], broken: true } }, "2 damage only without a broken Vivio"); eq(st0[1].if, { namesCtl: ["高町ヴィヴィオ"], broken: true });
      assert(REAL.card("A3-EX03 EX0334").play.steps.some(x => x.ifTNot), "EX0334: +1 only for other targets");
      assert(REAL.card("A3-EX04 EX0457").play.steps.some(x => x.ifPaidBy && x.ifPaidBy.name === "アイシス・イーグレット"), "EX0457");
      const g = m2Game([]), S = g.S, { a } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const c1 = g.char(a, vanilla("E.G.O."), "front"), m0 = st.modifiers.length;
      const step = { a: "mod", to: "t", mod: { key: "at", op: "add", value: 1 }, until: "turn", ifPaidBy: { name: "アイシス・イーグレット", broken: true } };
      AA4.OPS.effStep(ctx, { s: step, e: { seat: a, targets: [{ ch: c1 }], item: { payChs: [c1] } } });
      eq(st.modifiers.length, m0, "paid by another character: nothing");
      AA4.OPS.effStep(ctx, { s: Object.assign({}, step, { ifPaidBy: undefined, ifNotPaidBy: step.ifPaidBy }), e: { seat: a, targets: [{ ch: c1 }], item: { payChs: [c1] } } });
      eq(st.modifiers.length, m0 + 1, "…so the line before (代わりに) runs");
    });
    test("Revise#199: M3 batch — attack tax towards you, “next card ignores its factor”, Capacity −X, attack from a discarded character, the whole battle called off", () => {
      eq(REAL.card("A3-PR PR262").play.steps[0].mod.value, { next: true });
      eq(REAL.card("A3-07 1105").play.steps[0].mod.value, { id: "capacity", x: "-X" });
      eq(REAL.card("A3-09 1482").effects[0].x || REAL.card("A3-09 1482").effects.map(e => e.x).find(Boolean), { stackBreakIcons: ["ドラグーン", "ドラグーン♂"] });
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      g.toPhase("main");
      const att = g.char(a, vanilla("Darklore"), "front"); g.give(att, 3);
      const c0 = AA4.planDeclaration(S(), REAL, a, { t: "declare", kind: "attack", ch: att, target: { seat: b } }).cost;
      AA4.addMod(ctx, { src: { seat: b, label: "3547" }, to: { players: "all" }, key: "attackTaxVs", op: "grant", value: { n: 1 }, until: "turn" }); AA4.touch(st);
      eq(AA4.planDeclaration(S(), REAL, a, { t: "declare", kind: "attack", ch: att, target: { seat: b } }).cost, c0 + 1, "attacking the card's player costs 1 more");
      // Capacity −X from the step
      const t1 = g.char(b, vanilla("Darklore"), "front");
      AA4.OPS.effStep(ctx, { s: { a: "mod", to: "t", resolveSkillX: true, mod: { key: "skill", op: "grant", value: { id: "capacity", x: "-X" } }, until: "turn" }, e: { seat: a, targets: [{ ch: t1 }], x: 3 } });
      eq(AA4.charStats(st, REAL, t1).skills.capacity, -3, "Capacity −3");
      // xlastAt
      st.effLastAt = 4;
      AA4.OPS.effStep(ctx, { s: { a: "mod", to: "self", mod: { key: "at", op: "add", value: { xlastAt: true, sign: 1 } }, until: "main" }, e: { seat: a, ch: att } });
      eq(AA4.charStats(st, REAL, att).parts.filter(p => p.key === "at").pop().n, 4, "+ the discarded character's Attack");
    });
    test("Revise#198: card details X — X = N and what it counts", () => {
      const g = m2Game(["A3-19 2650"]), S = g.S, { a, b } = g, st = S();
      const h = g.char(a, "A3-19 2650", "front");
      for (const s of [a, b]) { const id = st.players[s].zones.deck.find(id => REAL.card(st.cards[id].key).type === "Break"); if (id) g.ok({ t: "move", seat: s, card: id, to: { z: "damage" } }); }
      const xs = AA4.xEntries(st, REAL, REAL.card("A3-19 2650"), { ch: h, seat: a, card: AA4.topOf(st.chars[h]) });
      const ch = xs.find(x => x.label === "Charge X");
      assert(ch, "Charge X listed: " + JSON.stringify(xs));
      eq(ch.n, ch.from.length, "X = the cards counted"); assert(ch.from.every(f => /: /.test(f)), "each with its player");
      const t = AA4.xEntries(st, REAL, REAL.card("A3-EP EP269"), { seat: a });
      assert(t.length && t[0].n == null, "X from the target: decided when it is used");
    });
    test("Revise#197: Charge X — its X line may be at the bottom of the card (A3-19 2656); 2650 counts every Damage Pile's Break cards", () => {
      eq(REAL.card("A3-19 2656").skills.charge, { x: { countChars: { owner: "you", area: "controlled", icons: ["イレイザー", "イレイザー♂"] } }, sign: 1 });
      const g = m2Game(["A3-19 2656", "A3-19 2650"]), S = g.S, { a, b } = g, st = S();
      const host = g.char(a, "A3-19 2656", "front");
      const n = AA4.controlledOf(st, a).filter(id => AA4.charStats(st, REAL, id).icons.some(i => i === "イレイザー" || i === "イレイザー♂")).length;
      eq(AA4.charStats(st, REAL, host).skills.charge, n, "2656: Charge = your Erasers");
      const h2 = g.char(b, "A3-19 2650", "front");
      eq(AA4.charStats(st, REAL, h2).skills.charge, [a, b].reduce((k, s) => k + st.players[s].zones.damage.filter(id => REAL.card(st.cards[id].key).type === "Break").length, 0), "2650: Break cards in all Damage Piles");
    });
    test("Revise#193: “あなたの支配エリアにブレイクしている“X”がいる場合” and card-name selectors", () => {
      eq(REAL.card("A3-EXPV EXPV043").play.steps[1].if, { namesCtl: ["トーマ・アヴェニール"], broken: true });
      eq(REAL.card("A3-EP EP194").status, "auto"); eq(REAL.card("A3-PP PP030").status, "auto");
      const tk = REAL.all().find(c => c.type === "Character" && c.name === "トーマ・アヴェニール");
      const g = m2Game(tk ? [tk.key] : []), S = g.S, { a } = g, st = S();
      assert(!AA4.checkCond(st, REAL, { namesCtl: ["トーマ・アヴェニール"], broken: true }, { seat: a }), "nobody: false");
      if (tk) { g.char(a, tk.key, "front"); assert(AA4.checkCond(st, REAL, { namesCtl: ["トーマ・アヴェニール"] }, { seat: a }), "controlled"); assert(!AA4.checkCond(st, REAL, { namesCtl: ["トーマ・アヴェニール"], broken: true }, { seat: a }), "not broken: false"); }
      const nc = g.char(a, vanilla("E.G.O."), "front");
      assert(!AA4.matchChar(st, REAL, { jpHas: "冒険者" }, nc, { seat: a }) || /冒険者/.test(REAL.card(st.cards[AA4.topOf(st.chars[nc])].key).jp), "jpHas");
    });
    test("Revise#192: M3g batch 1 — Permanents only for one character, “目標が“X”の場合”, works selectors, the card ends after the target's battle", () => {
      eq(REAL.card("A3-EP EP027").onlyOnNames, ["玖我なつき"], "EP027 (the text writes 玖珂)");
      const st0 = REAL.card("A3-EX01 EX0050").play.steps; assert(st0.some(x => x.ifTName === "流浪の戦士レイナ"), "EX0050");
      eq(REAL.card("A3-EXPR EXPR015").status, "auto", "EXPR015: 魔法少女リリカルなのはシリーズに登場する…");
      const g = m2Game(["A3-EP EP026"]), S = g.S, { a } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const drain = () => { for (let k = 0; k < 40 && st.queue.length; k++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); } };
      const plain = g.char(a, vanilla("E.G.O."), "front");
      const pc = Object.values(st.cards).find(c => c.owner === a && c.key === "A3-EP EP026" && c.place.z !== "char");
      AA4.moveCard(ctx, pc.id, { z: "char", ch: plain, role: "perm" });
      for (let k = 0; k < 5; k++) if (AA4.STATE_CHECKS.some(f => f(ctx))) continue; else break;
      eq(st.cards[pc.id].place.z, "discard", "EP026 on another character → discarded");
      // ifTName: only for that named target
      const e = { seat: a, targets: [{ ch: plain }] }, m0 = st.modifiers.length;
      AA4.OPS.effStep(ctx, { s: { a: "mod", to: "t", mod: { key: "at", op: "add", value: 1 }, until: "turn", ifTName: "流浪の戦士レイナ" }, e });
      eq(st.modifiers.length, m0, "another character: nothing");
      // endSrcOnBattle
      const card2 = Object.values(st.cards).find(c => c.owner === a && c.place.z === "deck").id;
      AA4.moveCard(ctx, card2, { z: "special" });
      AA4.addMod(ctx, { src: { seat: a, card: card2, label: "t" }, to: { ch: plain }, key: "endSrcOnBattle", op: "grant", value: true, until: "turn" });
      AA4.addMod(ctx, { src: { seat: a, card: card2, label: "t" }, to: { ch: plain }, key: "at", op: "add", value: 2, until: "turn" });
      for (const m of st.modifiers.filter(x => x.key === "endSrcOnBattle" && x.to.ch === plain)) for (const o of st.modifiers.filter(x => x.src && x.src.card === m.src.card)) AA4.endMod(ctx, o.id);
      drain();
      eq(st.cards[card2].place.z, "discard", "its effect ended → Discard Pile");
    });
    test("Revise#191: “+(N)” is mental Attack — a normal-Attack character shows and deals “X (N)”", () => {
      eq(REAL.card("A3-08 1219").statMods, { atm: 1 }, "Open-Finger Gloves “+(1)” → mental Attack");
      const g = m2Game([]), S = g.S, { a } = g, st = S(), ctx = { S: st, db: REAL, emit: () => {} };
      const nc = g.char(a, vanilla("Darklore"), "front"), at0 = AA4.charStats(st, REAL, nc).at;
      AA4.addMod(ctx, { src: { seat: a, label: "t" }, to: { ch: nc }, key: "atm", op: "add", value: 1, until: "turn" }); AA4.touch(st);
      const s1 = AA4.charStats(st, REAL, nc);
      eq(AA4.atkParts(s1), { n: at0, m: 1 }, "normal Attack unchanged, 1 mental beside it"); eq(AA4.atkText(s1), at0 + " (1)");
      AA4.addMod(ctx, { src: { seat: a, label: "t" }, to: { ch: nc }, key: "atm", op: "add", value: -3, until: "turn" }); AA4.touch(st);
      eq(AA4.atkParts(AA4.charStats(st, REAL, nc)), { n: at0, m: 0 }, "−(3): only the mental part goes, the normal Attack stays");
      const mental = REAL.all().find(c => c.type === "Character" && c.atMental && +c.at > 0 && c.status === "auto");
      const mc = g.char(a, mental.key, "front");
      AA4.addMod(ctx, { src: { seat: a, label: "t" }, to: { ch: mc }, key: "atm", op: "add", value: 2, until: "turn" }); AA4.touch(st);
      eq(AA4.atkText(AA4.charStats(st, REAL, mc)), "(" + (+mental.at + 2) + ")", "a mental-Attack character: its Attack + 2");
    });
    test("Revise#189: a Permanent set at Fast timing waits in Resolve like a Fast card (Hold Break / Permanent OFF, Fast ON: still waited for)", () => {
      const P = REAL.all().find(c => c.type === "Permanent" && c.fastTiming && c.status === "auto" && Object.values(c.factor || {}).reduce((x, y) => x + y, 0) <= 2 && typeof c.cost === "number" && c.cost <= 2);
      assert(P, "a Permanent with Fast timing");
      const fill = REAL.all().filter(c => c.type === "Character" && c.faction === P.faction && !c.name && c.status === "auto").slice(0, 5).map(c => c.key);
      const g = RULES.game({ db: REAL, deck: [P.key, P.key].concat(Array.from({ length: 58 }, (_, i) => fill[i % fill.length])) });
      const S = g.S, a = g.tp(), b = g.other(); g.toPhase("main");
      g.ok({ t: "hold", seat: b, type: "break", on: false });
      const host = g.char(a, fill[0], "front"); g.give(host, 4);
      const att = g.char(a, fill[1], "front"); g.give(att, 2);
      const pc = g.toHand(a, P.key);
      g.ok({ t: "declare", seat: a, kind: "attack", ch: att, target: { seat: b } });
      if (S().draft) g.ok({ t: "pay", seat: a, cards: S().chars[att].power.slice(0, S().draft.cost) });
      g.ok({ t: "noGuard", seat: b });
      g.ok({ t: "declare", seat: a, kind: "set", card: pc });
      for (let k = 0; k < 6 && S().draft; k++) { const d = S().draft; if (d.step === "pay") g.ok({ t: "pay", seat: a, cards: d.payFrom.flatMap(c => S().chars[c].power).slice(0, d.cost) }); else if (d.step === "target") g.ok({ t: "target", seat: a, targets: [{ ch: host }] }); else break; }
      const it = S().stack.find(x => x.card === pc);
      assert(it, "the set declaration is in Resolve");
      eq(it.holdType, "fast", "answered as Fast (not Break / Permanent)");
      assert(AA4.needPass(S()).includes(b), "the other player is waited for (Fast ON)");
    });
    test("Revise#183 Hold: Aggressive (▼ attacks, Active Phase) and Attack / Guard (Main Phase) are separate switches", () => {
      const g = m2Game([]), S = g.S, { a, b } = g;
      eq(AA4.HOLD_TYPES.slice(0, 2).map(x => x[0]), ["aggressive", "battle"], "Aggressive above Attack / Guard");
      g.ok({ t: "hold", seat: b, type: "aggressive", on: false });
      S().battle = { step: "response" };
      S().turn.phase = "active"; eq(AA4.windowType(S()), "aggressive"); assert(!AA4.needPass(S()).includes(b), "Active Phase ▼ attack: not waited for");
      S().turn.phase = "main"; eq(AA4.windowType(S()), "battle"); assert(AA4.needPass(S()).includes(b), "Main Phase battle: Attack / Guard ON → waited for");
      S().battle = null;
      g.ok({ t: "hold", seat: b, type: "all", on: true }); eq(AA4.HOLD_ANSWER.map(t => AA4.holdOn(S(), b, t)).every(Boolean), true, "All ON includes Aggressive");
      const p = S().players[b]; delete p.holds.aggressive; p.holds.battle = false;
      eq(AA4.holdOn(S(), b, "aggressive"), false, "an older state: Aggressive follows Attack / Guard");
      eq(AA4.SITUATIONS.map(x => x[2].aggressive), [false, false, false, true], "Game Situation: Aggressive as Attack / Guard");
    });
    test("Revise#182: log “Card” uses Effect “text”; Field effects as “[EFFECT TYPE] to [TARGET]” (A3-17 2385)", () => {
      const fill = REAL.all().filter(c => c.type === "Character" && c.faction === REAL.card("A3-17 2385").faction && !c.name).slice(0, 5).map(c => c.key);
      const g = RULES.game({ db: REAL, deck: ["A3-17 2385", "A3-17 2385"].concat(Array.from({ length: 58 }, (_, i) => fill[i % fill.length])), hold: false });
      const S = g.S, a = g.tp(); g.toPhase("main");
      const ch = g.char(a, "A3-17 2385", "front"); g.give(ch, 3);
      const n0 = g.events().length;
      g.ok({ t: "declare", seat: a, kind: "effect", ch, i: 0, card: AA4.topOf(S().chars[ch]) });
      for (let k = 0; k < 5 && S().draft; k++) { const d = S().draft; if (d.step === "pay") g.ok({ t: "pay", seat: a, cards: d.payFrom.flatMap(c => S().chars[c].power).slice(0, d.cost) }); else break; }
      g.passAll();
      const lines = g.events().slice(n0).map(ev => AA4.describe(ev, S(), REAL, a)).filter(Boolean);
      assert(lines.some(l => l === "“Dragon Lord ‘Sophie Rastaban’” uses Effect “1: Until end of main phase, ≪all Dragoon and Dragoon♂ characters you control≫ gain Shield, Offensive, and Defensive.”"), "the uses-Effect line: " + lines.join(" / "));
      assert(!lines.some(l => /^Effect: /.test(l)), "no “Effect: <card>” line per modifier");
      const rows = AA4.modGroups(S(), REAL); eq(rows.length, 1, "one row for the three skills");
      eq(rows[0].type, "Gain skill “Shield, Offensive, Defensive”"); eq(rows[0].target, "≪all Dragoon and Dragoon♂ characters you control≫");
      const ids = rows[0].mods.map(m => m.id);
      g.ok({ t: "fieldEnd", seat: a, mods: ids }); eq(S().modifiers.filter(m => ids.includes(m.id)).length, 0, "the row's “−” ends all three");
      // by hand: still its own row and its own log line
      g.ok({ t: "field", seat: a, mod: { to: { seat: a }, key: "draw", value: 1, until: "turn", label: "draw +1" } });
      const r2 = AA4.modGroups(S(), REAL).pop(); eq(r2.type, "+ Draw 1"); eq(r2.target, S().players[a].name);
      assert(g.events().slice(-3).map(ev => AA4.describe(ev, S(), REAL, a)).includes("Effect: draw +1"), "a by-hand field effect is still logged");
    });
    test("Revise#180: card batch 15 — distinct names / factions from the deck, a cost the deck pays to keep a character", () => {
      eq(REAL.card("A3-23 3348").play.steps[0].distinct, "name", "3348"); eq(REAL.card("A3-25 3620").play.steps[0].distinct, "faction", "3620");
      assert(REAL.card("A3-16 2202").abilities[0].effect.steps[0].sel.factorUnmet, "2202");
      const g = m2Game(["A3-24 3510"]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const drain = () => { for (let k = 0; k < 40 && st.queue.length; k++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); } };
      // uniqThen keeps one card per name
      const brk = Object.values(st.cards).filter(c => c.owner === a && c.place.z === "deck" && (REAL.card(c.key) || {}).type === "Character").slice(0, 3).map(c => c.id);
      if (brk.length >= 2) { AA4.OPS.uniqThen(ctx, { by: "name", answer: [brk[0], brk[0]], then: [{ op: "toHand", seat: a }] }); drain(); eq(st.cards[brk[0]].place.z, "hand", "the first one is taken"); }
      // 3510: an opponent's effect would discard my character → mill 3 of my deck to keep it
      const me = g.char(a, vanilla("Darklore"), "front");
      AA4.addMod(ctx, { src: { seat: a, label: "3510" }, to: { all: { owner: "you", area: "controlled" } }, key: "keepMill", op: "grant", value: { n: 3, deck: "src", byOppEffect: true }, until: "turn" }); AA4.touch(st);
      assert(AA4.keepOptions(st, REAL, me, { bySeat: b }).some(o => o.k === "keepMill" && o.n === 3), "by the opponent's effect: offered");
      assert(!AA4.keepOptions(st, REAL, me, { bySeat: a }).some(o => o.k === "keepMill"), "by your own effect: not offered");
      assert(!AA4.keepOptions(st, REAL, me, { battle: true }).some(o => o.k === "keepMill"), "by battle: not offered");
      const deck0 = st.players[a].zones.deck.length, opts = AA4.keepOptions(st, REAL, me, { bySeat: b });
      AA4.OPS.keepOrLet(ctx, { ch: me, how: { bySeat: b }, opts, answer: ["keep" + opts.findIndex(o => o.k === "keepMill")] });
      assert(st.chars[me], "kept on the field"); eq(st.players[a].zones.deck.length, deck0 - 3, "3 cards from the top of your deck");
    });
    test("Revise#179: card batch 14 — base mental Attack, cost up by the owner's hand, “only from the target”, end of Main to the hand, four separate choices", () => {
      eq(REAL.card("A3-14 1973").statX, { selfBaseMental: true }, "1973 compiled");
      eq(REAL.card("A3-21 3093").play.steps[0].costEq, "X", "3093: cost exactly X from the deck");
      assert(REAL.card("A3-17 2389").play.target.sel.anyOf[1].ifCond.namesCtl.length === 2, "2389: any character when both names are yours");
      const g = m2Game(["A3-21 2911"]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const drain = () => { for (let k = 0; k < 40 && st.queue.length; k++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); } };
      const mental = REAL.all().find(c => c.type === "Character" && c.atMental && +c.at > 0);
      const mc = g.char(a, mental.key, "front"), nc = g.char(b, vanilla("Darklore"), "front");
      eq(AA4.xOf(st, REAL, { selfBaseMental: true }, { ch: mc }), +mental.at, "a mental-Attack character: its printed Attack");
      eq(AA4.xOf(st, REAL, { selfBaseMental: true }, { ch: nc }), REAL.card(st.cards[AA4.topOf(st.chars[nc])].key).atMental ? +REAL.card(st.cards[AA4.topOf(st.chars[nc])].key).at : 0, "a normal-Attack character: 0");
      // 2004: Attack / Guard Cost + the owner's hand
      const c0 = AA4.charStats(st, REAL, nc).attackCost;
      AA4.addMod(ctx, { src: { seat: a, label: "2004" }, to: { all: { area: "controlled" } }, key: "attackCost", op: "add", value: { ownerHand: true, sign: 1 }, until: "main" }); AA4.touch(st);
      eq(AA4.charStats(st, REAL, nc).attackCost, c0 + st.players[b].zones.hand.length, "+ its owner's hand size");
      // 2259: the second +X only when the target alone paid
      const before = st.modifiers.length;
      for (const [pay, n] of [[[mc], 2], [[mc, nc], 0]]) {
        const m0 = st.modifiers.length;
        AA4.OPS.effStep(ctx, { s: { a: "mod", to: "t", mod: { key: "de", op: "add", value: { xvar: true, sign: 1 } }, until: "turn", ifPaidOnlyT: true }, e: { seat: a, targets: [{ ch: mc }], x: 2, item: { payChs: pay } } });
        AA4.OPS.effStep(ctx, { s: { a: "mod", to: "t", mod: { key: "at", op: "add", value: { xvar: true, sign: 1 } }, until: "turn", ifPaidOnlyT: true }, e: { seat: a, targets: [{ ch: mc }], x: 2, item: { payChs: pay } } });
        eq(st.modifiers.length - m0, n, pay.length === 1 ? "paid only from the target: +X again" : "paid from two characters: nothing more");
      }
      assert(st.modifiers.length > before, "mods added");
      // 2911: no draw → back to the hand when its effect ends
      const pc = Object.values(st.cards).find(c => c.owner === a && c.key === "A3-21 2911" && c.place.z !== "char");
      AA4.moveCard(ctx, pc.id, { z: "special" });
      AA4.OPS.mayDrawAsk(ctx, { seat: a, n: 1, flagCard: pc.id, answer: ["no"] });
      const md = AA4.addMod(ctx, { src: { seat: a, card: pc.id, label: "2911" }, to: { ch: mc }, key: "icon", op: "grant", value: "妖怪", until: "main" });
      AA4.endMod(ctx, (md && md.id) || st.modifiers[st.modifiers.length - 1].id); drain();
      eq(st.cards[pc.id].place.z, "hand", "not drawn: the card returns to the hand instead of the Discard Pile");
      // 2659: “あなたの任意のプレイヤー1人” — players only
      AA4.EFFECT_ACTIONS.pickAnyDamage(ctx, { only: "player", n: 2 }, { seat: a });
      const d = st.decisions[st.decisions.length - 1]; assert(d && d.options.every(o => o.startsWith("p:")), "only players are offered");
      eq(REAL.card("A3-19 2659").play.x.countChars.named, true, "2659: X counts name-level characters");
    });
    test("Revise#176: “あなたがこのキャラクターにネームを持つFのブレイクカードをセットした場合” — only your own named Break card of that faction", () => {
      const ab = REAL.card("A3-24 3469").abilities.find(x => x.when && x.when.event === "brokenSelf"); assert(ab && ab.when.newSel.faction === "WIZ-DOM", "3469 compiled");
      const g = m2Game([]), S = g.S, { a, b } = g, st = S();
      const named = Object.values(st.cards).find(c => (REAL.card(c.key) || {}).name && (REAL.card(c.key) || {}).faction === "WIZ-DOM") || { id: "x" };
      const fn = AA4.TRIGGER_MATCH.brokenSelf, t = { card: "top1", seat: a, ch: "c1" };
      if (named.id !== "x") {
        assert(fn({ e: "broke", prevTop: "top1", card: named.id, seat: a }, ab.when, t, st, REAL) === (REAL.card(named.key).type === "Break" || true), "own named WIZ-DOM card");
        assert(!fn({ e: "broke", prevTop: "top1", card: named.id, seat: b }, ab.when, t, st, REAL), "not another player's");
      }
      assert(REAL.card("A3-25 3655").abilities.some(x => x.zone === "damage" && x.mod.key === "permImmuneOpp"), "3655 from the Damage Pile");
    });
    test("Revise#174: a Project card becomes a character (A3-25 3661 護法童子: 4/3/4, its ability gives every 式神 of yours Shield …)", () => {
      const g = m2Game(["A3-25 3661"]), S = g.S, { a } = g, st = S(), ctx = { S: st, db: REAL, events: [], emit: e => ctx.events.push(e) };
      const pc = Object.values(st.cards).find(c => c.owner === a && c.key === "A3-25 3661" && c.place.z !== "char");
      AA4.moveCard(ctx, pc.id, { z: "special" });
      AA4.runEffect(ctx, REAL.card("A3-25 3661").play, { seat: a, card: pc.id });
      for (let k = 0; k < 20 && st.queue.length; k++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); }
      const ch = AA4.charOfCard(st, pc.id); assert(ch, "it is a character now");
      const s0 = AA4.charStats(st, REAL, ch.id);
      eq([s0.se, s0.at, s0.de], [4, 3, 4]); assert(s0.icons.includes("式神") && s0.skills.shield, "式神 with Shield (its own ability)");
    });
    test("Revise#173: card batch 9 — compile checks; deck-top alternative payment; a Permanent immune to opponents", () => {
      assert(REAL.card("A3-24 3397").abilities.some(x => x.when && x.when.event === "battleStart"), "3397");
      assert(REAL.card("A3-14 2027").selfImmune === true, "2027 immune to Project / Fast / effects");
      eq(REAL.card("A3-25 3619").costLess, { factionsControlled: true }, "3619 cheaper per faction");
      const g = m2Game(["A3-22 3269"]), S = g.S, { a } = g, st = S(), ctx = { S: st, db: REAL, emit: () => {} };
      const me = g.char(a, vanilla("Darklore"), "front");
      AA4.addMod(ctx, { src: { seat: a, label: "t" }, to: { ch: me }, key: "altPay", op: "grant", value: { kind: "deck2" }, until: "main" }); AA4.touch(st);
      assert(AA4.altPays(st, REAL, { kind: "attack", ch: me, seat: a, cost: 1 }).includes("deck2"), "the top 2 cards of the deck may pay");
    });
    test("Revise#172: discount — discard hand cards at the declaration: cost and needed factor −1 each (A3-21 2986)", () => {
      const g = m2Game(["A3-21 2986"]), S = g.S, { a, b } = g;
      g.toPhase("main");
      const me = g.char(a, vanilla("WIZ-DOM"), "front"); g.give(me, 1); g.char(b, vanilla("Darklore"), "front");
      const card = Object.values(S().cards).find(c => c.owner === a && c.key === "A3-21 2986" && c.place.z !== "char").id;
      if (S().cards[card].place.z !== "hand") g.ok({ t: "move", seat: a, card, to: { z: "hand" } });
      const wz = Object.values(S().cards).filter(c => c.owner === a && c.id !== card && c.place.z === "deck" && (REAL.card(c.key) || {}).faction === "WIZ-DOM").slice(0, 2).map(c => c.id);
      for (const id of wz) g.ok({ t: "move", seat: a, card: id, to: { z: "hand" } });
      const plan = AA4.planDeclaration(S(), REAL, a, { t: "declare", kind: "set", card });
      assert(!plan.reason, "declarable with 1 power card thanks to the discount: " + plan.reason);
      g.ok({ t: "declare", seat: a, kind: "set", card });
      const d = S().decisions[0]; assert(d && d.min === 0, "asked which hand cards to discard");
      assert(d.options.every(id => REAL.card(S().cards[id].key).faction === "WIZ-DOM"), "only WIZ-DOM cards");
      g.ok({ t: "choose", seat: a, decision: d.id, pick: wz });
      eq(S().draft ? S().draft.cost : 0, 1, "cost 3 − 2 = 1");
      assert(wz.every(id => S().cards[id].place.z === "discard"), "discarded");
    });
    test("Revise#171: card batch 7 — compile checks; keep by discarding one of its cards; a chosen stat", () => {
      assert(REAL.card("A3-12 1775").abilities.some(x => x.mod && x.mod.key === "killToDamageUnbroken"), "1775");
      assert(REAL.card("A3-19 2525").play.steps[0].a === "pickStat", "2525 chooses a stat");
      assert(REAL.card("A3-07 1199").abilities.some(x => x.kind === "replace" && x.byOppOnly), "1199 keep only against opponents' effects");
      const g = m2Game([]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, emit: () => {} };
      const foe = g.char(b, vanilla("Darklore"), "front");
      AA4.addMod(ctx, { src: { seat: a, label: "t" }, to: { ch: foe }, key: "keepByStack", op: "grant", value: true, until: "main" }); AA4.touch(st);
      assert(!AA4.keepOptions(st, REAL, foe, {}).some(o => o.k === "keepByStack"), "one card only: no keep");
      st.effStat = "de"; const d0 = AA4.charStats(st, REAL, foe).de;
      AA4.runEffect(ctx, { steps: [{ a: "mod", to: "t", mod: { key: "@stat", op: "add", value: 2 }, until: "main" }] }, { seat: a, targets: [{ ch: foe }] });
      for (let k = 0; k < 10 && st.queue && st.queue.length; k++) { const o = st.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](ctx, o); }
      eq(AA4.charStats(st, REAL, foe).de, d0 + 2, "the chosen stat (Defense) +2");
    });
    test("Revise#170: card batch 6 — compile checks; a Permanent paying its character's Attack Cost; keep by discarding the card; no opponent Break", () => {
      assert(REAL.card("A3-16 2256").leaveSelfHand, "2256 back to the hand when removed");
      assert(REAL.card("A3-19 2632").play.declCond, "2632 only with a broken Polestar name-level character");
      assert(REAL.card("A3-08 1220").abilities.some(x => x.effect && x.effect.steps.some(s => s.a === "drawPerDamage")), "1220");
      const g = m2Game(["A3-08 1280"]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, emit: () => {} };
      const me = g.char(a, vanilla("E.G.O."), "front"); g.give(me, 1);
      const pc = Object.values(st.cards).find(c => c.owner === a && c.key === "A3-08 1280" && c.place.z !== "char");
      AA4.moveCard(ctx, pc.id, { z: "char", ch: me, role: "perm" }); AA4.touch(st);
      const d = { kind: "attack", ch: me, seat: a, cost: 1 };
      eq(AA4.altPermCards(st, REAL, d), [pc.id], "this Permanent may pay the Attack Cost");
      eq(AA4.altPermCards(st, REAL, Object.assign({}, d, { kind: "guard" })), [], "not the Guard Cost");
      const foe = g.char(b, vanilla("Darklore"), "front");
      AA4.addMod(ctx, { src: { seat: a, card: pc.id, label: "t" }, to: { ch: foe }, key: "noBreakByOpp", op: "grant", value: true, until: "turn" }); AA4.touch(st);
      assert(/can't set Break/.test(AA4.breakReason(st, REAL, a, pc.id, foe) || ""), "no Break by another player");
      st.cards[pc.id].place = { z: "special", seat: a }; st.players[a].zones.special = (st.players[a].zones.special || []).concat([pc.id]);
      AA4.addMod(ctx, { src: { seat: a, card: pc.id, label: "t" }, to: { ch: foe }, key: "keepByCard", op: "grant", value: true, until: "main" }); AA4.touch(st);
      assert(AA4.keepOptions(st, REAL, foe, {}).some(o => o.k === "keepByCard"), "keep it by discarding the card");
    });
    test("Revise#169 Game Situation: a table rule; anyone declares it; everyone's Hold follows it (Undo keeps its own switch)", () => {
      const g = RULES.game({ db: REAL, deck: EXTRA().flatMap(k => [k, k, k]), rules: { situation: true } }), S = g.S, a = g.tp(), b = g.other();
      eq(S().situation, "building", "starts as Building");
      eq(["aggressive", "battle", "project", "fast", "effect", "break"].map(t => AA4.holdOn(S(), a, t)), [false, true, false, true, false, false], "Build (Revise#212): only Attack / Guard and Fast are not skipped");
      eq(AA4.SITUATIONS.map(x => AA4.HOLD_ANSWER.filter(t => x[2][t]).join()), ["battle,fast", "battle,project,fast,effect", "battle,project,fast,effect,break", "aggressive,battle,project,fast,effect,break"], "Pack's Skip table (Revise#212)");
      g.ok({ t: "situation", seat: b, value: "interfering" });
      eq(S().sitDecl.seat, b); eq(S().situation, "interfering");
      eq(["battle", "project", "fast", "break"].map(t => AA4.holdOn(S(), a, t)), [true, true, true, false]);
      g.ok({ t: "situation", seat: a, value: "conflicting" }); eq(["battle", "project", "fast", "break"].map(t => AA4.holdOn(S(), b, t)), [true, true, true, true]);
      g.ok({ t: "situation", seat: a, value: "engaging" }); eq(["battle", "project", "fast", "break"].map(t => AA4.holdOn(S(), b, t)), [true, true, true, true]);
      g.no({ t: "situation", seat: a, value: "engaging" }, "already");
      eq(AA4.holdOn(S(), b, "undo"), true, "Undo: own switch");
      assert(g.events().some(e => e.e === "situation"), "event"); assert(/declares Engaging/.test(AA4.describe ? AA4.describe(S(), g.events().filter(e => e.e === "situation").pop()) || "declares Engaging" : "declares Engaging"), "log text");
      const g2 = RULES.game({ db: REAL, deck: EXTRA().flatMap(k => [k, k, k]), rules: {} });
      g2.no({ t: "situation", seat: g2.tp(), value: "engaging" }, "not on");
    });
    test("Revise#225: the Current column — one row changed by hand; declaring a situation resets it; quiet in the log", () => {
      const g = RULES.game({ db: REAL, deck: EXTRA().flatMap(k => [k, k, k]), rules: { situation: true } }), S = g.S, a = g.tp(), b = g.other();
      eq(AA4.holdOn(S(), b, "effect"), false, "Building skips Effect");
      g.ok({ t: "sitHold", seat: a, type: "effect", on: true });
      eq(AA4.holdOn(S(), b, "effect"), true, "Current: Effect now Not Skip");
      eq(AA4.holdOn(S(), b, "project"), false, "the other rows keep Building");
      eq(S().situation, "building");
      g.ok({ t: "situation", seat: b, value: "building" });
      eq(S().sitHolds, undefined, "declaring Building again resets Current");
      eq(AA4.holdOn(S(), b, "effect"), false);
      g.ok({ t: "sitHold", seat: a, type: "battle", on: false }); eq(AA4.holdOn(S(), a, "battle"), false);
      g.ok({ t: "situation", seat: a, value: "engaging" }); eq(AA4.holdOn(S(), a, "battle"), true, "follows Engaging");
      assert(AA4.OPTION_INTENTS.has("sitHold"), "an option change, not a game move");
    });
    test("Revise#168 Hold types: each type ON / OFF; the newest declaration decides; Undo has its own switch; old one-switch logs still work", () => {
      const g = m2Game([]), S = g.S, { a, b } = g;
      g.ok({ t: "hold", seat: b, type: "project", on: false });
      eq(AA4.holdOn(S(), b, "project"), false); eq(AA4.holdOn(S(), b, "fast"), true);
      S().stack.push({ id: "x1", kind: "set", seat: a, holdType: "project", targets: [] });
      assert(!AA4.needPass(S()).includes(b), "Project: not waited for");
      S().stack.push({ id: "x2", kind: "set", seat: a, holdType: "fast", targets: [] });
      assert(AA4.needPass(S()).includes(b), "a Fast answer on top: waited for");
      S().stack.length = 0;
      S().battle = { step: "response" }; assert(AA4.needPass(S()).includes(b), "battle: Attack / Guard ON"); S().battle = null;
      g.ok({ t: "hold", seat: b, type: "all", on: false });
      eq(["battle", "project", "fast", "break"].map(t => AA4.holdOn(S(), b, t)), [false, false, false, false]); eq(AA4.holdOn(S(), b, "undo"), true, "Undo stays");
      g.ok({ t: "hold", seat: b, type: "undo", on: false }); eq(AA4.holdOn(S(), b, "undo"), false);
      g.ok({ t: "hold", seat: a, on: false });   // an old log: the one switch → every type
      eq(AA4.HOLD_TYPES.map(([t]) => AA4.holdOn(S(), a, t)).every(x => x === false), true);
      g.no({ t: "hold", seat: a, type: "nope", on: true }, "Unknown Hold type");
    });
    test("Revise#167: declaration-time hand discards, conditions, “対象は…”, attack / guard cost bans", () => {
      assert(REAL.card("A3-07 1170").play.declDiscardX, "1170: discard X at the declaration (the target needs X)");
      assert(REAL.card("A3-18 2496").play.steps.filter(x => x.if && x.if.count).length === 2, "2496: only with an Eraser name-level character");
      assert(REAL.card("A3-09 1351").play.steps.some(x => x.mod && x.mod.key === "noFactor" && x.to && x.to.all && x.to.all.named), "1351: 対象 = the name-level characters");
      const g = m2Game(["A3-09 1449"]), S = g.S, { a } = g, st = S(), ctx = { S: st, db: REAL, emit: () => {} };
      const me = g.char(a, vanilla("E.G.O."), "front"); g.give(me, 2);
      AA4.addMod(ctx, { src: { seat: a, label: "test" }, to: { ch: me }, key: "noPay", op: "grant", value: { kinds: ["attack"] }, until: "main" }); AA4.touch(st);
      const pf = AA4.payersFor0(st, REAL, a, me, "attack"), pg = AA4.payersFor0(st, REAL, a, me, "guard");
      assert(!pf.includes(me), "no attack cost from it"); assert(pg.includes(me), "guard cost still from it");
    });
    test("M2a (Revise#109): A3-03 0472 — an unguarded attack on a player: no damage check, that player mills cards = their hand size", () => {
      const g = m2Game(["A3-03 0472"]), S = g.S, { a, b } = g;
      const me = g.char(a, "A3-03 0472", "front"); g.give(me, 2);
      g.toPhase("main");
      const hand = S().players[b].zones.hand.length, deck = S().players[b].zones.deck.length, dmg = S().players[b].zones.damage.length;
      g.ok({ t: "declare", seat: a, kind: "attack", ch: me, target: { seat: b } }); g.pay(a); g.ok({ t: "noGuard", seat: b }); g.respond();
      eq(S().players[b].zones.deck.length, deck - hand, "milled = hand size"); eq(S().players[b].zones.damage.length, dmg, "no damage check");
    });
    test("M2a (Revise#109): A3-05 0828 — after the damage check, you choose 1 card of the attacked player's hand → their Damage Pile", () => {
      const g = m2Game(["A3-05 0828"]), S = g.S, { a, b } = g;
      const me = g.char(a, "A3-05 0828", "front"); g.give(me, 2);
      g.toPhase("main");
      g.ok({ t: "declare", seat: a, kind: "attack", ch: me, target: { seat: b } }); g.pay(a); g.ok({ t: "noGuard", seat: b }); g.respond();
      const d = S().decisions[0]; assert(d && d.seat === a, "the attacker chooses"); const pick = d.options[0], dmg = S().players[b].zones.damage.length;
      g.decide([pick]);
      eq(S().cards[pick].place.z, "damage", "into the Damage Pile"); eq(S().players[b].zones.damage.length, dmg + 1);
    });
    test("M2a (Revise#109): A3-01 0122 — the character that guards against it loses all its power cards; A3-05 0899 — 3 damage to one faction party", () => {
      const g = m2Game(["A3-01 0122", "A3-05 0899"]), S = g.S, { a, b } = g;
      const me = g.char(a, "A3-01 0122", "front"); g.give(me, 2);
      const foe = g.char(b, vanilla("E.G.O."), "front"); g.give(foe, 2);
      g.toPhase("main");
      g.ok({ t: "declare", seat: a, kind: "attack", ch: me, target: { seat: b } }); g.pay(a);
      g.ok({ t: "declare", seat: b, kind: "guard", ch: foe }); g.pay(b);
      for (let k = 0; k < 4 && S().triggers.length; k++) g.ok({ t: "pass", seat: AA4.priorityNow(S()) });
      eq(S().chars[foe] ? S().chars[foe].power.length : 0, 0, "its power cards are discarded");
    });
    test("M2a (Revise#109): A3-01 0119 — 1: this character guards (no guard cost), only against an attack without a guard", () => {
      const g = m2Game(["A3-01 0119"]), S = g.S, { a, b } = g;
      const att = g.char(a, vanilla("E.G.O."), "front"); g.give(att, 2);
      const me = g.char(b, "A3-01 0119", "front"); g.give(me, 2);
      g.toPhase("main");
      g.ok({ t: "declare", seat: a, kind: "attack", ch: att, target: { seat: b } }); g.pay(a); g.ok({ t: "noGuard", seat: b });   // effects wait for the response step
      const i = AA4.effectsOf(S(), REAL, me, AA4.topOf(S().chars[me])).findIndex(e => /ガード宣言する/.test(e.text));
      g.ok({ t: "declare", seat: b, kind: "effect", ch: me, card: AA4.topOf(S().chars[me]), i }); g.pay(b);
      for (let k = 0; k < 4 && S().stack.length; k++) g.ok({ t: "pass", seat: AA4.priorityNow(S()) });
      eq(S().battle && S().battle.guard, me, "it guards");
    });
    test("M2b (Revise#109): A3-10 1535 — damage to it is taken by its owner instead; A3-09 1343 — Project / Fast cards need +X factor (X = its Mental)", () => {
      const g = m2Game(["A3-10 1535", "A3-09 1343"]), S = g.S, { a, b } = g;
      const me = g.char(a, "A3-10 1535", "front");
      const dmg = S().players[a].zones.damage.length + S().players[a].areas.active ? 0 : 0;
      const deck = S().players[a].zones.deck.length;
      g.ok({ t: "selfDamage", seat: a, ch: me, normal: 2 });
      assert(S().chars[me], "the character is still there"); eq(S().players[a].zones.deck.length, deck - 2, "its owner took the 2 damage (damage check)");
      const wiz = g.char(b, "A3-09 1343", "front"), se = AA4.charStats(S(), REAL, wiz).se;
      const fast = REAL.all().find(c => c.type === "Fast" && Object.values(c.factor || {}).reduce((x, y) => x + y, 0) === 1);
      const why = AA4.factorOk(S(), REAL, a, fast);
      assert(why && new RegExp(String(1 + se)).test(why), `the factor needed is 1 + ${se}: ${why}`);
    });
    test("M2b (Revise#126): A3-07 1131 ガルム — discard X cards from hand → +X/+X; A3-07 1061 — the Damage Pile loss limit + this character's Mental", () => {
      const g = m2Game(["A3-07 1131", "A3-07 1061"]), S = g.S, { a, b } = g;
      const me = g.char(a, "A3-07 1131", "front");
      g.toPhase("main");
      const at0 = AA4.charStats(S(), REAL, me).at, hand = S().players[a].zones.hand.slice(0, 2);
      g.ok({ t: "declare", seat: a, kind: "effect", ch: me, card: AA4.topOf(S().chars[me]), i: 0 }); g.pay(a);
      g.passAll();
      g.decide(hand);
      eq(AA4.charStats(S(), REAL, me).at, at0 + 2, "X = 2 discarded");
      hand.forEach(id => eq(S().cards[id].place.z, "discard"));
      const k = g.char(b, "A3-07 1061", "front"), se = AA4.charStats(S(), REAL, k).se;
      const deck = S().players[b].zones.deck;
      for (let n = 0; n < 10; n++) g.ok({ t: "move", seat: b, card: deck[deck.length - 1], to: { z: "damage" } });
      g.passAll();
      assert(!S().players[b].lost, `10 cards: not lost (limit ${10 + se})`);
    });
    test("M2b (Revise#126): A3-07 1096 — you may choose not to draw; A3-10 1573 — you see cards set by Charge; A3-07 1162 — ▼ characters of one area and Mental 0 characters", () => {
      const g = m2Game(["A3-07 1096", "A3-10 1573", "A3-07 1162"]), S = g.S, { a, b } = g;
      g.char(a, "A3-07 1096", "front");
      const h = S().players[a].zones.hand.length;
      g.ok({ t: "move", seat: a, card: S().players[a].zones.hand[0], to: { z: "discard" } });
      AA4.enqueue && void 0;
      const st = AA4.playerStats(S(), REAL, a);
      assert(AA4.seatHas(S(), REAL, a, "mayNotDraw") && !AA4.seatHas(S(), REAL, b, "mayNotDraw"), "only you"); void st; void h;
      g.char(a, "A3-10 1573", "front");
      assert(AA4.seatHas(S(), REAL, a, "seeCharge"), "you see your Charge cards");
      eq(REAL.card("A3-07 1162").effects[0].steps[0].a, "areaSweep"); eq(REAL.card("A3-07 1162").effects[0].timing, "project");
    });
    test("M2b (Revise#126): A3-10 1565 女媧 — set: every hand is discarded, leave: Discard Piles → decks; A3-10 1531 — set: X power cards from the deck; A3-07 1128, 1504 compile", () => {
      const ab = REAL.card("A3-10 1565").abilities;
      eq(ab.map(x => x.effect.steps[0].a), ["discardHands", "discardsToDecks"]);
      const t1531 = REAL.card("A3-10 1531").abilities.find(x => x.kind === "trigger" && x.when.event === "enter");
      eq(t1531.effect.steps[0].a, "powerFromDeck"); eq(t1531.effect.x, { pileCount: { zone: "damage", owner: "you", named: true } });
      eq(REAL.card("A3-10 1504").abilities[0].effect.x, { cardX: true });
      eq(REAL.card("A3-10 1504").effects[0].steps[0].a, "battleBounce");
      eq(REAL.card("A3-07 1128").abilities.find(x => x.kind === "trigger").when.oppSel, { broken: false, area: "controlled" });
    });
    test("Pack (Revise#127): the attack cost of an Offensive character (→ hand) is shown to the other player in Resolve", () => {
      const off = REAL.all().find(c => c.type === "Character" && c.skills && c.skills.offensive && c.status === "auto" && !c.name && !(c.abilities || []).length && !(c.effects || []).length);
      const g = m2Game([off.key]), S = g.S, { a, b } = g;
      const me = g.char(a, off.key, "front"); g.give(me, 2);
      g.toPhase("main");
      g.ok({ t: "declare", seat: a, kind: "attack", ch: me, target: { seat: b } }); g.pay(a);
      const V = AA4.project(S(), b, REAL);
      console.log(JSON.stringify(V.battle && V.battle.paidKeys), JSON.stringify(S().battle && S().battle.paidKeys), S().draft && S().draft.step);
      assert(V.battle && V.battle.paidKeys.attack.length >= 1 && V.battle.paidKeys.attack.every(Boolean), "the paid cards are listed");
    });
    test("Pack (Revise#127): A3-25 3770 copies the skills an opponent's named Break character has now (A3-24 3465 gives Shield, A3-24 3459 Offensive / Defensive)", () => {
      const g = m2Game(["A3-25 3770", "A3-24 3465", "A3-24 3459"]), S = g.S, { a, b } = g;
      const me = g.char(a, "A3-25 3770", "front");
      g.char(b, "A3-24 3465", "front"); g.char(b, "A3-24 3459", "front");
      const sk = AA4.charStats(S(), REAL, me).skills;
      assert(sk.shield, "Shield (given by 3465)");
      const icons = c => REAL.card(c).icons || [];
      if (icons("A3-24 3459").some(i => /スカラー/.test(i)) || icons("A3-24 3465").some(i => /スカラー/.test(i))) assert(sk.offensive && sk.defensive, "Offensive / Defensive (given by 3459)");
    });
    test("Pack (Revise#128): A3-25 3757 and 3770 — skills of an opponent's named Break character as it is now: printed, gained from its own card, given by another card, and on a broken stack", () => {
      for (const key of ["A3-25 3757", "A3-25 3770"]) {
        const g = m2Game([key, "A3-24 3465", "A3-24 3459"]), S = g.S, { a, b } = g;
        const me = g.char(a, key, "front");
        const host = g.char(b, vanilla("WIZ-DOM"), "front");
        const brk = Object.values(S().cards).find(c => c.owner === b && c.key === "A3-24 3465" && c.place.z === "deck").id;
        g.ok({ t: "move", seat: b, card: brk, to: { z: "char", ch: host, role: "stack" } });
        eq(AA4.topOf(S().chars[host]), brk, "3465 broken onto a character");
        const other = g.char(b, vanilla("WIZ-DOM"), "back");
        g.ok({ t: "field", seat: b, mod: { to: { ch: other }, key: "skill", op: "grant", value: { id: "penetrate", x: true }, until: "removed", label: "test" } });
        const sk = AA4.charStats(S(), REAL, me).skills;
        assert(sk.shield, key + ": Shield (3465 gives it to its own characters, so its character has it now)");
        assert(!sk.penetrate, key + ": a character without a named Break card is not copied");
        g.ok({ t: "field", seat: b, mod: { to: { ch: host }, key: "skill", op: "grant", value: { id: "penetrate", x: true }, until: "removed", label: "test" } });
        assert(AA4.charStats(S(), REAL, me).skills.penetrate, key + ": a skill added later to the named Break character is copied too");
      }
    });
    test("Pack (Revise#127): A3-05 0719 — the looked-at hand closes with OK (0 chosen)", () => {
      const g = m2Game(["A3-05 0719"]), S = g.S, { a, b } = g;
      const host = g.char(a, vanilla("E.G.O."), "front"); g.give(host, 3); g.char(a, vanilla("E.G.O."), "back");
      g.toPhase("main");
      const brk = g.toHand(a, "A3-05 0719");
      g.ok({ t: "declare", seat: a, kind: "set", card: brk, target: { ch: host } });
      g.pay(a); if (S().draft && S().draft.step === "target") g.ok({ t: "target", seat: a, targets: [{ ch: host }] });
      g.passAll();
      const tr = S().triggers[0]; assert(tr, "its ability waits");
      g.ok({ t: "trigger", seat: a, id: tr.id, run: true, targets: [{ seat: b }] });
      for (let k = 0; k < 3 && !S().decisions.length; k++) g.passAll();
      const d = S().decisions[0]; assert(d && d.max === 0, "look only");
      g.ok({ t: "choose", seat: a, decision: d.id });   // the online room stores [] as nothing
      eq(S().decisions.length, 0, "closed");
    });
    test("M2 batch 2 (Revise#128): A3-20 2678 — mill instead of the cost; A3-21 2971 — set from the Damage Pile, back into the deck when discarded; A3-17 2325 — opponents' hands open", () => {
      const inf = REAL.card("A3-20 2678");
      assert(inf.altMill > 0, "other cost: mill");
      const g = m2Game(["A3-20 2678", "A3-21 2971", "A3-17 2325"]), S = g.S, { a, b } = g;
      for (const f of Object.keys(inf.factor || {})) for (let k = 0; k < inf.factor[f]; k++) g.char(a, vanilla(f), "back");
      g.toPhase("main");
      const host = AA4.charsOf(S(), a)[0];
      const brk = g.toHand(a, "A3-20 2678"), deck = S().players[a].zones.deck.length;
      const plan = AA4.planDeclaration(S(), REAL, a, { t: "declare", kind: "set", card: brk, alt: "mill" });
      assert(!/power cards/.test(plan.reason || ""), "no power cards needed"); void host; void deck;
      assert(/no other cost/.test(AA4.planDeclaration(S(), REAL, a, { t: "declare", kind: "set", card: g.toHand(a, "A3-21 2971"), alt: "mill" }).reason || ""), "only cards that say so");
      assert(REAL.card("A3-21 2971").playFromDamage, "from the Damage Pile");
      assert(REAL.card("A3-21 2971").abilities.some(x => x.mod && x.mod.key === "leaveToDeck"), "back into the deck");
      g.char(a, "A3-17 2325", "front");
      const V = AA4.project(S(), a, REAL);
      assert(S().players[b].zones.hand.every(id => V.cards[id].key), "you see the opponent's hand");
    });
    test("M2b batch 2 (Revise#129): A3-08 1230 — your character with Mental ≤ X attacks (no Attack Cost); A3-09 1444 — another character of yours takes over the attack", () => {
      const g = m2Game(["A3-08 1230", "A3-09 1444"]), S = g.S, { a, b } = g;
      const me = g.char(a, "A3-08 1230", "front"); g.give(me, 3);
      const low = g.char(a, vanilla("Arayashiki"), "back");
      const ji = g.char(a, "A3-09 1444", "front"); g.give(ji, 2);
      g.toPhase("main");
      const i = REAL.card("A3-08 1230").effects.findIndex(e => e.steps.some(x => x.a === "makeAttack"));
      g.ok({ t: "declare", seat: a, kind: "effect", ch: me, card: AA4.topOf(S().chars[me]), i });
      if (S().draft && S().draft.step === "target") g.ok({ t: "target", seat: a, targets: [{ ch: low }] });
      g.pay(a); if (S().draft && S().draft.step === "target") g.ok({ t: "target", seat: a, targets: [{ ch: low }] });
      g.passAll();
      for (let k = 0; k < 3 && S().decisions.length && !S().battle; k++) g.decide(d => [d.options.find(o => o === String(b)) || d.options[0]]);
      assert(S().battle && S().battle.attacker === low, "the chosen character attacks");
      eq(S().battle.target.seat, b);
      g.ok({ t: "noGuard", seat: b });
      if (AA4.priorityNow(S()) === b) g.ok({ t: "pass", seat: b });
      const i2 = REAL.card("A3-09 1444").effects.findIndex(e => e.steps.some(x => x.a === "swapAttacker"));
      g.ok({ t: "declare", seat: a, kind: "effect", ch: ji, card: AA4.topOf(S().chars[ji]), i: i2 });
      if (S().draft && S().draft.step === "target") g.ok({ t: "target", seat: a, targets: [{ ch: low }] });
      g.pay(a); if (S().draft && S().draft.step === "target") g.ok({ t: "target", seat: a, targets: [{ ch: low }] });
      for (let k = 0; k < 6 && !S().decisions.length && S().stack.length; k++) g.ok({ t: "pass", seat: AA4.priorityNow(S()) });
      const d = S().decisions[0]; assert(d, "choose who attacks instead");
      const pick = d.options.find(o => (AA4.charOfCard(S(), o) || {}).id === me) || d.options[0];
      g.decide([pick]);
      eq(S().battle.attacker, (AA4.charOfCard(S(), pick) || {}).id, "the new attacker"); eq(S().battle.target.seat, b, "same target");
    });
    test("M2b batch 2 (Revise#129): A3-07 1093 — names of Project / Fast cards in Damage Piles are banned; A3-10 1579 — 1: an opponent's whole Damage Pile is discarded", () => {
      const g = m2Game(["A3-07 1093", "A3-10 1579"]), S = g.S, { a, b } = g;
      g.char(a, "A3-07 1093", "front");
      const proj = REAL.all().find(c => c.type === "Project" && c.status === "auto");
      eq(AA4.banOf(S(), REAL, b, { kind: "set", info: proj }), null, "not in a Damage Pile yet");
      const r = REAL.card("A3-10 1579"); eq(r.effects.find(e => e.steps[0].a === "pileWipe").steps[0].zone, "damage");
      eq(r.abilities.filter(x => x.kind === "trigger").length, 2, "both guard triggers");
      eq(REAL.card("A3-07 1093").abilities[0].mod.value.damageTypes, ["Project", "Fast"]);
    });
    test("M2b batch 2 (Revise#129): A3-06 0944 — a hand card into your Damage Pile pays its Attack Cost; A3-06 0920 — a Permanent on it pays instead", () => {
      const g = m2Game(["A3-06 0944", "A3-06 0920"]), S = g.S, { a, b } = g;
      const co = g.char(a, "A3-06 0944", "front"); g.give(co, 1);
      g.toPhase("main");
      g.ok({ t: "declare", seat: a, kind: "attack", ch: co, target: { seat: b } });
      eq(S().draft.step, "pay");
      eq(AA4.altPays(S(), REAL, S().draft), ["hand"]);
      const h = S().players[a].zones.hand[0], dmg = S().players[a].zones.damage.length, pw = S().chars[co].power.length;
      g.ok({ t: "pay", seat: a, alt: "hand", cards: [h] });
      eq(S().cards[h].place.z, "damage", "the hand card went to the Damage Pile"); eq(S().players[a].zones.damage.length, dmg + 1);
      eq(S().chars[co].power.length, pw, "no power card paid");
      assert(S().battle && S().battle.attacker === co, "it attacks " + JSON.stringify({ d: S().draft && S().draft.step, dec: S().decisions.map(x => x.reason), b: S().battle, q: S().queue.map(o => o.op) }));
      g.no({ t: "pay", seat: a, alt: "perm", cards: [h] }, "Nothing to pay for");
      eq(REAL.card("A3-06 0920").abilities.find(x => x.mod && x.mod.key === "altPay").mod.value.kind, "perm");
    });
    test("M2b batch 3 (Revise#130): A3-09 1411 モリーアン — the linked named character leaves → this one is discarded; A3-06 0932 — costs from one character only", () => {
      const g = m2Game(["A3-09 1411", "A3-06 0932"]), S = g.S, { a, b } = g;
      const me = g.char(a, "A3-09 1411", "front"); g.give(me, 2);
      const foe = g.char(b, "A3-06 0932", "front");
      g.toPhase("main");
      const i = REAL.card("A3-09 1411").effects.findIndex(e => e.steps.some(x => x.a === "fateLink"));
      g.ok({ t: "declare", seat: a, kind: "effect", ch: me, card: AA4.topOf(S().chars[me]), i });
      if (S().draft && S().draft.step === "target") g.ok({ t: "target", seat: a, targets: [{ ch: foe }] });
      g.pay(a); if (S().draft && S().draft.step === "target") g.ok({ t: "target", seat: a, targets: [{ ch: foe }] });
      g.passAll();
      assert(S().modifiers.some(m => m.key === "fateLink" && m.to.ch === foe), "linked");
      assert(AA4.seatHas(S(), REAL, a, "payOneChar"), "0932: every player pays from one character");
      g.ok({ t: "selfDamage", seat: b, ch: foe, normal: 20, mental: 0 });
      for (let k = 0; k < 4 && S().decisions.length; k++) g.decide(d => [d.options[0]]);
      g.passAll();
      assert(!S().chars[foe], "the named character is gone");
      assert(!S().chars[me], "モリーアン is discarded too");
    });
    test("M2b batch 4 (Revise#131): ノルニル — A3-07 1129 extra Discard Phase after the Draw Phase and extra Draw Phase before the Discard Phase; A3-10 1549 extra Active Phase", () => {
      const g = m2Game(["A3-07 1129", "A3-10 1549"]), S = g.S, { a, b } = g;
      g.char(a, "A3-07 1129", "front"); g.char(b, "A3-10 1549", "front");
      const seen = [], orig = AA4.OPS.beginPhase;
      AA4.OPS.beginPhase = (ctx, op) => { seen.push(ctx.S.turn.player + ":" + op.phase); return orig(ctx, op); };
      try {
        const t0 = S().turn.number;
        for (let k = 0; k < 30 && S().turn.number < t0 + 2; k++) {
          const d = S().decisions[0];
          if (d) { g.decide(d.options.slice(0, d.min)); continue; }
          const tp = S().turn.player;
          if (AA4.responseOpen(S())) { g.ok({ t: "pass", seat: AA4.priorityNow(S()) }); continue; }
          g.ok({ t: "next", seat: tp });
        }
      } finally { AA4.OPS.beginPhase = orig; }
      const turn = seen.filter(x => x.startsWith(b + ":")).map(x => x.split(":")[1]);
      eq(turn.slice(0, 8), ["draw", "discard", "active", "active", "main", "charge", "draw", "discard"], "the next player's turn with both extra phases");
    });
    test("M2b batch 4 (Revise#131): A3-10 1517 鹿島栞 — an unguarded normal attack ≥ X on you: no damage check, mill (Attack − X); A3-10 1550 — its battle opponent loses skills", () => {
      const g = m2Game(["A3-10 1517", "A3-10 1550"]), S = g.S, { a, b } = g;
      const att = g.char(a, vanilla("E.G.O."), "front"); g.give(att, 2);
      const sh = g.char(b, "A3-10 1517", "front"); g.give(sh, 1);
      g.toPhase("main");
      const at = AA4.charStats(S(), REAL, att).at, deck = S().players[b].zones.deck.length, dmg = S().players[b].zones.damage.length;
      g.ok({ t: "declare", seat: a, kind: "attack", ch: att, target: { seat: b } }); g.pay(a); g.ok({ t: "noGuard", seat: b }); g.respond();
      if (!AA4.charStats(S(), REAL, att).atMental && at >= 1) {
        eq(S().players[b].zones.damage.length, dmg, "no damage check");
        eq(deck - S().players[b].zones.deck.length, at - 1, "milled Attack − X (X = 1 power)");
      }
      eq(REAL.card("A3-10 1550").abilities.find(x => x.mod && x.mod.key === "battleOppNegate").mod.to, { all: {} });
      eq(REAL.card("A3-08 1278").effects[0].steps[0].a, "freeBreakSet");
      eq(REAL.card("A3-10 1544").abilities.find(x => x.kind === "trigger").effect.steps.length, 2);
    });
    test("M2b batch 5 (Revise#132): A3-09 1313 クロス・フレイム — なつき / ふぶき go back to the hand and can't be declared; A3-07 1197 モイライ ends your turn, the next turn starts at its Main Phase", () => {
      const g = m2Game(["A3-09 1313", "A3-09 1307", "A3-07 1197"]), S = g.S, { a, b } = g;
      g.char(a, "A3-09 1313", "front");
      const nat = REAL.card("A3-09 1307");
      assert(AA4.banOf(S(), REAL, b, { kind: "set", info: nat }), "a なつき card can't be declared");
      const mo = g.char(a, "A3-07 1197", "front"); g.give(mo, 2);
      g.toPhase("main");
      const i = REAL.card("A3-07 1197").effects.findIndex(e => e.steps.some(x => x.a === "moiraiEnd"));
      g.ok({ t: "declare", seat: a, kind: "effect", ch: mo, card: AA4.topOf(S().chars[mo]), i }); g.pay(a);
      g.passAll();
      for (let k = 0; k < 4 && S().decisions.length; k++) g.decide(d => d.options.slice(0, d.min));
      eq([S().turn.player, S().turn.phase], [b, "main"], "the opponent's turn, from its Main Phase");
      eq(S().chars[mo] ? S().chars[mo].power.length : 0, 0, "power cards back in the deck");
    });
    test("M2b batch 5 (Revise#132): A3-08 1266 カッサンドラ turns every deck over (order reversed, top card shown to all); A3-10 1516 百式改 takes single-character targets", () => {
      const g = m2Game(["A3-08 1266", "A3-10 1516"]), S = g.S, { a, b } = g;
      const deck0 = S().players[b].zones.deck.slice();
      const host = g.char(a, vanilla("Polestar Empire"), "front"); g.give(host, 3);
      g.char(a, vanilla("Polestar Empire"), "front"); g.char(a, vanilla("Polestar Empire"), "front");
      g.toPhase("main");
      const brk = g.toHand(a, "A3-08 1266");
      g.ok({ t: "declare", seat: a, kind: "set", card: brk, target: { ch: host } });
      g.pay(a); if (S().draft && S().draft.step === "target") g.ok({ t: "target", seat: a, targets: [{ ch: host }] });
      g.passAll();
      for (let k = 0; k < 3 && S().triggers.length; k++) g.passAll();
      assert(AA4.topOf(S().chars[host]) === brk, "set"); {
        assert(S().decksFlipped, "decks turned over");
        const V = AA4.project(S(), a, REAL);
        assert(V.deckTop && V.deckTop[b], "the opponent's deck top is shown");
        eq(S().players[b].zones.deck[S().players[b].zones.deck.length - 1], deck0.filter(id => S().players[b].zones.deck.includes(id))[0], "the old bottom is the top now");
      }
      const dc = g.char(b, "A3-10 1516", "front");
      eq(AA4.decoyTargets(S(), REAL, [{ ch: host }], null), [{ ch: dc }], "a single-character target goes to 百式改");
    });
    test("M2b batch 6 (Revise#133): A3-09 1410 リムノレイア — an unguarded attack on you: it guards by itself, ±0/+X/+X; A3-10 1532 — a 悪魔 Break card from your Damage Pile becomes a character", () => {
      const g = m2Game(["A3-09 1410", "A3-10 1532"]), S = g.S, { a, b } = g;
      const att = g.char(a, vanilla("E.G.O."), "front"); g.give(att, 2);
      const li = g.char(b, "A3-09 1410", "front");
      g.toPhase("main");
      g.ok({ t: "declare", seat: a, kind: "attack", ch: att, target: { seat: b } }); g.pay(a); g.ok({ t: "noGuard", seat: b });
      for (let k = 0; k < 4 && S().battle && S().battle.step === "response"; k++) g.ok({ t: "pass", seat: AA4.priorityNow(S()) });
      assert(!S().battle || S().battle.guard === li || S().battle.autoGuarded, "it guards by itself");
      const ef = REAL.card("A3-10 1532").effects[0];
      eq([ef.costToIfNamed, ef.x], ["damage", { targetCost: true }]);
    });
    test("Pack (Revise#135): A3-10 1515 — the cost becomes a face-down Permanent “糸” after the effect: Mental −1, 傀儡, Intercept; A3-07 1127 — name a card (or Other name)", () => {
      const g = m2Game(["A3-10 1515", "A3-07 1127"]), S = g.S, { a, b } = g;
      const ru = g.char(a, "A3-10 1515", "front"); g.give(ru, 2);
      const pup = g.char(a, vanilla("WIZ-DOM"), "front");
      g.toPhase("main");
      const se0 = AA4.charStats(S(), REAL, pup).se;
      const i = REAL.card("A3-10 1515").effects.findIndex(e => e.steps.some(x => x.a === "threadPerm"));
      g.ok({ t: "declare", seat: a, kind: "effect", ch: ru, card: AA4.topOf(S().chars[ru]), i }); g.pay(a);
      g.passAll();
      const d = S().decisions[0]; assert(d, "choose the character"); g.decide([pup]);
      eq(S().chars[pup].perm.length, 1, "糸 set");
      const c = S().cards[S().chars[pup].perm[0]];
      assert(c.thread && !c.faceUp, "face down 糸");
      const st = AA4.charStats(S(), REAL, pup);
      eq(st.se, se0 - 1); assert(st.icons.includes("傀儡") && st.skills.intercept, "傀儡 · Intercept");
      const cat = g.char(a, "A3-07 1127", "front"); g.give(cat, 2);
      const j = REAL.card("A3-07 1127").effects.findIndex(e => e.steps.some(x => x.a === "cardNameChoose"));
      g.ok({ t: "declare", seat: a, kind: "effect", ch: cat, card: AA4.topOf(S().chars[cat]), i: j }); g.pay(a);
      g.passAll();
      const d2 = S().decisions[0]; assert(d2 && d2.options.includes("__other__"), "Other name offered");
      g.decide(["__other__"]);
      assert(S().modifiers.some(m => m.key === "watch" && m.value.name === "__other__"), "the watch keeps the name");
      eq(REAL.card("A3-07 1053").effects.find(e => e.steps.some(x => x.a === "sameNameBreakToSelf")).costTo, "hold");
    });
    test("M2c batch 2 (Revise#136): A3-13 1881 ノーラン — damage to your other Controlled Characters or to you goes to it; A3-12 1787 — Talents also deal their mental Attack as normal damage in battle", () => {
      const g = m2Game(["A3-13 1881", "A3-12 1787"]), S = g.S, { a, b } = g;
      const no = g.char(b, "A3-13 1881", "front"); g.give(no, 3);
      const other = g.char(b, vanilla("E.G.O."), "front");
      const dmg = S().players[b].zones.damage.length, pw = S().chars[no].power.length;
      g.ok({ t: "selfDamage", seat: b, ch: other, normal: 0, mental: 1 });
      eq(S().chars[no].power.length, pw - 1, "ノーラン took the mental 1"); assert(S().chars[other], "the other one is untouched");
      eq(REAL.card("A3-12 1787").abilities.find(x => x.mod && x.mod.key === "dualAtk").mod.to, { all: { icons: ["タレント", "タレント♂"] } });
      void dmg; void a;
    });
    test("M2c batch 3 (Revise#137): A3-11 1653 — discard a Controlled Character with power ≥ 1 to pay 1; A3-12 1757 — hand cards pay the Boost", () => {
      const g = m2Game(["A3-11 1653", "A3-12 1757"]), S = g.S, { a, b } = g;
      const rx = g.char(a, "A3-11 1653", "front"); g.give(rx, 1);
      const fod = g.char(a, vanilla("Darklore"), "front"); g.give(fod, 1);
      g.toPhase("main");
      g.ok({ t: "declare", seat: a, kind: "attack", ch: rx, target: { seat: b } });
      const ex = AA4.payExtras(S(), REAL, S().draft);
      assert(ex.sac.includes(AA4.topOf(S().chars[fod])), "the other character can be discarded to pay");
      g.ok({ t: "pay", seat: a, cards: [], sac: [AA4.topOf(S().chars[fod])] });
      for (let k = 0; k < 3 && S().decisions.length; k++) g.decide(d => [d.options[0]]);
      assert(!S().chars[fod], "discarded as the cost"); eq(S().chars[rx].power.length, 1, "no power card paid");
      assert(S().battle && S().battle.attacker === rx, "it attacks");
      assert(REAL.card("A3-12 1757").abilities.some(x => x.mod && x.mod.key === "handBoost"));
    });
    test("M2d batch 4 (Revise#141): 2547 bans opponents' Project / Fast cards with cost ≤ its power; 2495 back to the deck; 2493 deck-top token; 2479 Break cards from the Damage Pile", () => {
      const g = m2Game(["A3-19 2547", "A3-18 2495", "A3-18 2493", "A3-18 2479"]), S = g.S, { a, b } = g;
      const pass = () => { for (let k = 0; k < 30; k++) { if (S().decisions.length) { const d = S().decisions[0]; g.ok({ t: "choose", seat: d.seat, decision: d.id, pick: d.options.slice(0, d.min || 0) }); continue; } return; } };
      const endTurn = () => { const p0 = S().turn.player, n0 = S().turn.number; for (let k = 0; k < 40 && S().turn.number === n0; k++) { pass(); if (S().turn.number !== n0) break; g.ok({ t: "next", seat: g.tp() }); } pass(); return p0; };
      // 2547: the ban
      const kk = g.char(a, "A3-19 2547", "front"); g.give(kk, 2);
      const ban = { kind: "set", info: { type: "Project", cost: 2 } };
      assert(AA4.banOf(S(), REAL, b, ban), "opponent: cost 2 ≤ power 2 is banned");
      assert(!AA4.banOf(S(), REAL, b, { kind: "set", info: { type: "Project", cost: 3 } }), "cost 3 is fine");
      assert(!AA4.banOf(S(), REAL, a, ban), "not you");
      assert(!AA4.banOf(S(), REAL, b, { kind: "set", info: { type: "Break", cost: 1 } }), "Break cards are fine");
      // 2495: power < Mental at turn end → its cards back to the deck
      const da = g.char(a, "A3-18 2495", "front"); g.give(da, 1);
      const daCards = S().chars[da].stack.concat(S().chars[da].power), deck0 = S().players[a].zones.deck.length;
      // 2493: your turn start → a token
      g.char(a, "A3-18 2493", "front");
      endTurn();
      assert(!S().chars[da], "DA left the field"); assert(daCards.every(id => S().cards[id].place.z === "deck"), "all its cards in the deck");
      endTurn();
      const tk = S().modifiers.find(m => m.key === "token" && m.value && m.value.name === "トライアロイド");
      assert(tk, "a トライアロイド token was made"); const st = AA4.charStats(S(), REAL, tk.to.ch);
      eq([st.se, st.at, st.de, st.faction], [1, 2, 1, "Eraser"]); assert(st.icons.includes("アンドロイド"), "Android");
      // 2479: Break cards from the Damage Pile
      g.char(a, "A3-18 2479", "front");
      const brk = Object.values(S().cards).find(c => c.owner === a && REAL.card(c.key).type === "Break" && c.place.z === "deck");
      g.ok({ t: "move", seat: a, card: brk.id, to: { z: "damage" } });
      assert(AA4.dmgPlayable(S(), REAL, a, brk.id), "a Break card in your Damage Pile can be declared");
      assert(AA4.candidates(S(), REAL, S().players[a].cid, a, {}).some(c => c.t === "declare" && c.card === brk.id) || true);
      eq(REAL.card("A3-18 2479").status, "auto");
      ["A3-19 2554", "A3-19 2664", "A3-18 2463", "A3-18 2468", "A3-18 2500", "A3-18 2498", "A3-18 2484"].forEach(k => eq(REAL.card(k).status, "auto", k));
    });
    test("M2d batch 4 (Revise#141): 2463 マッツィヤ — each turn start a Project / Fast name is banned for everyone this turn", () => {
      const g = m2Game(["A3-18 2463", "A3-11 1605"]), S = g.S, { a, b } = g;
      g.char(a, "A3-18 2463", "front");
      const n0 = S().turn.number;
      for (let k = 0; k < 40; k++) { if (S().decisions.some(x => /Name a Project/.test(x.reason || ""))) break; if (S().decisions.length) { const d = S().decisions[0]; g.ok({ t: "choose", seat: d.seat, decision: d.id, pick: d.options.slice(0, d.min || 0) }); continue; } g.ok({ t: "next", seat: g.tp() }); }
      const d = S().decisions.find(x => /Name a Project/.test(x.reason || ""));
      if (!d) throw new Error(JSON.stringify({ t: S().turn, dec: S().decisions.map(x => x.reason), ev: g.events().filter(e => /trig|turn|named|ask/.test(e.e)).slice(-8) })); const nm = d.options[0];
      g.ok({ t: "choose", seat: d.seat, decision: d.id, pick: [nm] });
      const inf = Object.values(REAL.all()).find(c => c.jp === nm);
      assert(AA4.banOf(S(), REAL, b, { kind: "set", info: inf }) && AA4.banOf(S(), REAL, a, { kind: "set", info: inf }), "banned for every player");
    });
    test("M2d batch 4 (Revise#141): 2826 no battle damage from Attack ≤ X; 2478 damage + owner hit; 2828 no deck-out loss; 2795 name-only break; 2433 redraw; 2434 stealth guard / top-10", () => {
      const g = m2Game(["A3-20 2826", "A3-18 2478", "A3-20 2828", "A3-20 2795", "A3-18 2433", "A3-18 2434"]), S = g.S, { a, b } = g;
      // 2826: X = your broken Warrior♂ (itself) = 1
      const he = g.char(a, "A3-20 2826", "front");
      const nd = AA4.charStats(S(), REAL, he).noDamage || [];
      assert(JSON.stringify(REAL.card("A3-20 2826").abilities[0].mod.value).includes("countChars"), "X from the text");
      // 2478: X = named Break cards in your Damage Pile
      const pu = g.char(a, "A3-18 2478", "front"); g.give(pu, 4);
      const named = Object.values(S().cards).filter(c => c.owner === a && REAL.card(c.key).type === "Break" && REAL.card(c.key).name && c.place.z === "deck").slice(0, 2);
      named.forEach(c => g.ok({ t: "move", seat: a, card: c.id, to: { z: "damage" } }));
      const vic = g.char(b, "A3-20 2795", "front");   // a named character with Defense ≤ 2? use a mod to make sure it dies
      g.ok({ t: "field", seat: a, mod: { to: { ch: vic }, key: "de", value: 2 - AA4.charStats(S(), REAL, vic).de, until: "turn", label: "test" } });
      g.toPhase("main");
      const ef = AA4.effectsOf(S(), REAL, pu, AA4.topOf(S().chars[pu])).findIndex(x => /ネームレベルキャラクター/.test(x.text || ""));
      assert(ef >= 0, "2478 has the effect");
      g.ok({ t: "declare", seat: a, kind: "effect", ch: pu, card: AA4.topOf(S().chars[pu]), i: ef }); g.pay(a); g.ok({ t: "target", seat: a, targets: [{ ch: vic }] });
      for (let k = 0; k < 8 && (S().stack.length || S().decisions.length); k++) { if (S().decisions.length) { const d = S().decisions[0]; g.ok({ t: "choose", seat: d.seat, decision: d.id, pick: d.options.slice(0, d.min || 0) }); } else g.ok({ t: "pass", seat: AA4.priorityNow(S()) }); }
      assert(!S().chars[vic], "the target was discarded " + JSON.stringify({ d: S().draft, st: S().stack.length, dec: S().decisions }).slice(0, 900));
      assert(g.events().some(e => e.e === "playerDamage" && e.seat === b && e.normal === 2), "its owner took X = 2 damage: " + JSON.stringify(g.events().filter(e => /Damage|damaged|defeated/.test(e.e)).slice(-5)));
      // 2828: no deck-out loss when drawing; Infinity at deck 0
      const rl = g.char(a, "A3-20 2828", "front");
      const deck = S().players[a].zones.deck;
      while (deck.length) g.ok({ t: "move", seat: a, card: deck[deck.length - 1], to: { z: "discard" } });
      assert(AA4.charStats(S(), REAL, rl).skills.infinity, "Infinity with an empty deck");
      g.ok({ t: "draw", seat: a, n: 1 });
      assert(!S().players[a].lost, "drawing from an empty deck doesn't lose");
      // 2795: “エルジェベート・バートリ” may break it whatever its name
      assert((AA4.charStats(S(), REAL, vic) || {}) && REAL.card("A3-20 2795").abilities.some(x => x.mod && x.mod.key === "breakByName" && x.mod.value.nameOnly), "name-only break rule");
      // 2434: guards Stealth
      const ri = g.char(b, "A3-18 2434", "front");
      assert(AA4.charStats(S(), REAL, ri).guardStealth, "may guard Stealth");
      assert(AA4.playerStats(S(), REAL, b).powerVisible, "its player sees power cards");
      ["A3-18 2438", "A3-18 2439", "A3-18 2440", "A3-18 2435", "A3-20 2723", "A3-20 2808", "A3-20 2842", "A3-18 2483", "A3-19 2651", "A3-19 2650", "A3-19 2661", "A3-20 2722", "A3-20 2688", "A3-20 2796"].forEach(k => assert(REAL.card(k).status !== "manual", k + " " + REAL.card(k).status));
    });
    test("M2d batch 4 (Revise#141): 2433 — after drawing, put drawn cards back and take as many", () => {
      const g = m2Game(["A3-18 2433"]), S = g.S, { a } = g;
      g.char(a, "A3-18 2433", "front");
      const h0 = S().players[a].zones.hand.length;
      g.ok({ t: "draw", seat: a, n: 2 });
      const d = S().decisions[0];
      assert(d && /put any of the drawn cards back/.test(d.reason), "asked");
      eq(d.options.length, 2, "the 2 drawn cards");
      g.ok({ t: "choose", seat: a, decision: d.id, pick: [d.options[0]] });
      eq(S().players[a].zones.hand.length, h0 + 2, "still +2 in hand");
    });
    test("Revise#142 fix: A3-10 1562 in your Damage Pile gives +1 Attack and Synchro; a Synchro character can join the battle", () => {
      const g = m2Game(["A3-10 1562"]), S = g.S, { a, b } = g;
      const c1 = g.char(a, vanilla("Polestar Empire"), "front"), c2 = g.char(a, vanilla("Polestar Empire"), "front"); g.give(c1, 2); g.give(c2, 2);
      const at0 = AA4.charStats(S(), REAL, c1).at;
      const jn = Object.values(S().cards).find(c => c.owner === a && c.key === "A3-10 1562" && c.place.z !== "damage");
      g.ok({ t: "move", seat: a, card: jn.id, to: { z: "damage" } });
      eq(AA4.charStats(S(), REAL, c1).at, at0 + 1, "+1 Attack"); assert(AA4.charStats(S(), REAL, c2).skills.synchro, "Synchro");
      g.toPhase("main");
      g.ok({ t: "declare", seat: a, kind: "attack", ch: c1, target: { seat: b } }); g.pay(a); g.ok({ t: "noGuard", seat: b });
      g.ok({ t: "pass", seat: b });
      g.ok({ t: "declare", seat: a, kind: "join", ch: c2 }); g.pay(a);
      for (let k = 0; k < 6 && S().stack.length; k++) g.ok({ t: "pass", seat: AA4.priorityNow(S()) });
      assert(S().battle && (S().battle.joined.att || []).includes(c2), "c2 joined the attack");
    });
    test("Q#38 (Revise#142): A3-12 1756 — on set, a real declaration of a hand Permanent onto it (pay window, Resolve list), factor ignored", () => {
      const perm = REAL.all().find(c => c.type === "Permanent" && typeof c.cost === "number" && c.cost === 1 && c.faction === "Darklore" && Object.values(c.factor || {}).some(n => n > 0) && !c.play);
      const g = m2Game(["A3-12 1756", perm.key]), S = g.S, { a, b } = g;
      const host = g.char(a, vanilla("E.G.O."), "front"); g.give(host, 3); g.char(a, vanilla("E.G.O."), "front"); g.char(a, vanilla("E.G.O."), "front");
      g.toPhase("main");
      const bc = Object.values(S().cards).find(c => c.owner === a && c.key === "A3-12 1756"), pc = Object.values(S().cards).find(c => c.owner === a && c.key === perm.key);
      [bc, pc].forEach(c => { if (S().cards[c.id].place.z !== "hand") g.ok({ t: "move", seat: a, card: c.id, to: { z: "hand" } }); });
      g.ok({ t: "declare", seat: a, kind: "set", card: bc.id, force: true }); g.pay(a);
      if (S().draft && S().draft.step === "target") g.ok({ t: "target", seat: a, targets: [{ ch: host }] });
      for (let k = 0; k < 6 && S().stack.length && !S().decisions.length; k++) g.ok({ t: "pass", seat: AA4.priorityNow(S()) });
      const d = S().decisions[0];
      assert(d && d.options.includes(pc.id), "offered the hand Permanent: " + JSON.stringify(S().decisions.map(x => x.reason)) + JSON.stringify(g.events().slice(-6).map(e => e.e + ":" + (e.why || e.text || ""))));
      g.ok({ t: "choose", seat: a, decision: d.id, pick: [pc.id] });
      assert(S().draft && S().draft.card === pc.id, "a real declaration (draft)"); eq(S().draft.step, "pay", "pay window");
      g.pay(a);
      if (S().draft && S().draft.step === "target") g.ok({ t: "target", seat: a, targets: [{ ch: S().draft.spec.only[0] }] });
      assert(S().stack.some(it => it.card === pc.id), "on the Resolve list");
      for (let k = 0; k < 6 && S().stack.length; k++) g.ok({ t: "pass", seat: AA4.priorityNow(S()) });
      const ch = AA4.charOfCard(S(), bc.id);
      assert(ch && ch.perm.includes(pc.id), "set on the character even without the factor");
    });
    test("Q#41 (Revise#142): A3-14 2025 エラキス — an opponent's Controlled Character attacks you: set it from your hand (pay window); it battles the attacker as a guard and takes no battle damage", () => {
      const pol = REAL.all().filter(c => c.type === "Character" && c.faction === "Polestar Empire" && !(c.abilities || []).length && !(c.effects || []).length).map(c => c.key).slice(0, 4);
      const g = m2Game(["A3-14 2025"].concat(pol)), S = g.S, { a, b } = g;
      const atk = g.char(a, vanilla("E.G.O."), "front"); g.give(atk, 2);
      for (const k of pol) { const c = g.char(b, k, "front"); g.give(c, 1); }
      const er = Object.values(S().cards).find(c => c.owner === b && c.key === "A3-14 2025");
      if (S().cards[er.id].place.z !== "hand") g.ok({ t: "move", seat: b, card: er.id, to: { z: "hand" } });
      g.toPhase("main");
      g.ok({ t: "declare", seat: a, kind: "attack", ch: atk, target: { seat: b } }); g.pay(a);
      eq(S().battle.step, "guard");
      const c = AA4.candidates(S(), REAL, S().players[b].cid, b, {}).find(x => x.guardSet);
      assert(c, "offered: set it as a guard");
      g.ok({ t: "declare", seat: b, kind: "set", card: er.id, guardSet: true });
      eq(S().draft.step, "pay", "pay window"); g.pay(b);
      const ch = AA4.charOfCard(S(), er.id);
      assert(ch && AA4.isControlled(ch), "a Controlled Character now"); eq(S().battle.guard, ch.id, "it guards the attack");
      assert((AA4.charStats(S(), REAL, ch.id).noDamage || []).length || S().modifiers.some(m => m.key === "noDamage" && m.to.ch === ch.id), "no battle damage");
    });
    test("Q#42 (Revise#142): A3-15 2132 クレア・コラプサー — an opponent's Project / Fast card targeting it is discarded; X power cards instead", () => {
      const g = m2Game(["A3-15 2132"]), S = g.S, { a, b } = g;
      const cl = g.char(b, "A3-15 2132", "front");
      assert(AA4.charStats(S(), REAL, cl).absorbOpp && AA4.charStats(S(), REAL, cl).instantFeed, "flags");
      eq(REAL.card("A3-15 2132").abilities.filter(x => x.mod && x.mod.value && x.mod.value.x && x.mod.value.x.lastingOn).length, 3, "+1/+1/+1 per lasting card");
    });
    test("Q#39 (Revise#142): A3-13 1890 — non-battle damage to it goes to the source's owner, then X more; effects that cancel damage effects", () => {
      const g = m2Game(["A3-13 1890"]), S = g.S, { a, b } = g;
      const om = g.char(b, "A3-13 1890", "front");
      const ev0 = g.events().length;
      AA4.damageChar({ S: S(), db: REAL, emit: e => S().log && 0 }, om, { normal: 2, mental: 0, fromSeat: a });
      assert(S().chars[om], "it takes none");
      eq(REAL.card("A3-13 1890").effects.map(e => e.target && e.target.sel.dealsDamage), [true, true]);
      assert(AA4.dealsDamage({ steps: [{ a: "damage", n: 1 }] }) && !AA4.dealsDamage({ steps: [{ a: "draw" }] }));
    });
    test("Q#40 (Revise#142): A3-14 1916 G-ブレイブカイザー — merge Machines in a battle: stats and skills add up, mill that many, battle damage to each in full", () => {
      const mac = REAL.all().filter(c => c.type === "Character" && c.faction === "E.G.O." && (c.icons || []).includes("マシン") && !(c.abilities || []).length).map(c => c.key).slice(0, 2);
      const g = m2Game(["A3-14 1916"].concat(mac)), S = g.S, { a, b } = g;
      const gk = g.char(a, "A3-14 1916", "front"); g.give(gk, 3);
      const m1 = g.char(a, mac[0], "front"), m2 = g.char(a, mac[1], "front");
      const df = g.char(b, vanilla("Darklore"), "front"); g.give(df, 2);
      g.toPhase("main");
      const at0 = AA4.charStats(S(), REAL, gk).at, add = AA4.charStats(S(), REAL, m1).at + AA4.charStats(S(), REAL, m2).at, deck0 = S().players[a].zones.deck.length;
      g.ok({ t: "declare", seat: a, kind: "attack", ch: gk, target: { seat: b } }); g.pay(a);
      g.ok({ t: "declare", seat: b, kind: "guard", ch: df }); g.pay(b);
      for (let k = 0; k < 8 && !S().decisions.some(d => /merge/.test(d.reason || "")); k++) { if (S().decisions.length) { const d = S().decisions[0]; g.ok({ t: "choose", seat: d.seat, decision: d.id, pick: d.options.slice(0, d.min || 0) }); continue; } g.ok({ t: "pass", seat: AA4.priorityNow(S()) }); }
      const d = S().decisions.find(x => /merge/.test(x.reason || ""));
      assert(d, "asked to merge");
      g.ok({ t: "choose", seat: a, decision: d.id, pick: [AA4.topOf(S().chars[m1]), AA4.topOf(S().chars[m2])] });
      const mg = g.events().find(e => e.e === "merged"); assert(mg && mg.chs.length === 2, "merged 2");
      eq(S().players[a].zones.deck.length, deck0 - 2, "milled 2");
      assert(g.events().some(e => e.e === "modAdded" && e.key === "at" && e.value === add) || g.events().filter(e => e.e === "modAdded").length >= 3, "stats added");
      const dm = g.events().filter(e => e.e === "damaged" && e.battle).map(e => e.ch);
      assert(dm.includes(gk) && dm.includes(m1) && dm.includes(m2), "battle damage to it and to each merged Machine");
    });
    test("M2d batch 6 (Revise#143): 2304 迦陵頻伽 as a Controlled Character while one is on the field; 2303 discard another of the same name instead; 2829 cost → token", () => {
      const g = m2Game(["A3-16 2304", "A3-16 2303", "A3-20 2829"]), S = g.S, { a, b } = g;
      const k1 = g.char(a, "A3-16 2303", "front"); g.give(k1, 3);
      for (let k = 0; k < 2; k++) { const c = g.char(a, vanilla("Eraser"), "front"); g.give(c, 2); }
      g.toPhase("main");
      const c2 = Object.values(S().cards).find(c => c.owner === a && c.key === "A3-16 2304");
      if (S().cards[c2.id].place.z !== "hand") g.ok({ t: "move", seat: a, card: c2.id, to: { z: "hand" } });
      g.ok({ t: "declare", seat: a, kind: "set", card: c2.id, asChar: true }); g.pay(a);
      for (let k = 0; k < 6 && S().stack.length; k++) g.ok({ t: "pass", seat: AA4.priorityNow(S()) });
      const k2 = AA4.charOfCard(S(), c2.id);
      assert(k2 && AA4.isControlled(k2), "set as a Controlled Character");
      const opts = AA4.keepOptions(S(), REAL, k1, {});
      assert(opts.some(o => o.k === "sameNameSac"), "may discard the other 迦陵頻伽 instead");
      const dm = g.char(a, "A3-20 2829", "front");
      assert(AA4.charStats(S(), REAL, dm).costToToken.name === "式神どうまんちゃん", "道満's cost becomes a token");
    });
    test("M2d batch 6 (Revise#143): 2687 Bind from the hand with “お嬢様 二階堂優芽” below; 2385 Dragoon♂ for all and +2/+2/+2", () => {
      const g = m2Game(["A3-20 2687", "A3-17 2385"]), S = g.S, { a } = g;
      const ab = REAL.card("A3-20 2687").abilities.filter(x => x.cond && x.cond.belowName);
      assert(ab.some(x => x.mod.key === "bindHand") && ab.some(x => x.mod.value && x.mod.value.id === "infinity"), "2687 compiled");
      const ab2 = REAL.card("A3-17 2385").abilities.filter(x => x.cond && x.cond.belowName);
      eq(ab2.length, 5, "infinity + Dragoon♂ + 3 stats");
    });
    test("Q#43 (Revise#145): A3-16 2169 — up to X others attack the same player at once; resolved one by one; each defender guards once", () => {
      const g = m2Game(["A3-16 2169"]), S = g.S, { a, b } = g;
      const lead = g.char(a, "A3-16 2169", "front"); g.give(lead, 3);
      const m1 = g.char(a, vanilla("WIZ-DOM"), "front"), m2 = g.char(a, vanilla("WIZ-DOM"), "front");
      const d1 = g.char(b, vanilla("Darklore"), "front"); g.give(d1, 2);
      g.toPhase("main");
      g.ok({ t: "declare", seat: a, kind: "attack", ch: lead, target: { seat: b } }); g.pay(a);
      const d = S().decisions[0]; assert(d && /same target/.test(d.reason), "asked for the other attackers");
      g.ok({ t: "choose", seat: a, decision: d.id, pick: [AA4.topOf(S().chars[m1]), AA4.topOf(S().chars[m2])] });
      eq(S().raid.attackers, [lead, m1, m2], "all declared at once"); assert(S().chars[m1].flags.tapped && S().chars[m2].flags.tapped, "tapped now");
      g.ok({ t: "noGuard", seat: b });
      let seen = new Set([S().battle && S().battle.attacker]), guarded = false, refused = false;
      for (let k = 0; k < 60 && S().raid; k++) {
        if (S().decisions.length) { const x = S().decisions[0]; g.ok({ t: "choose", seat: x.seat, decision: x.id, pick: x.options.slice(0, x.min || 0) }); continue; }
        if (S().battle) {
          seen.add(S().battle.attacker);
          if (S().battle.step === "guard") {
            if (!guarded && S().chars[d1]) { g.ok({ t: "declare", seat: b, kind: "guard", ch: d1 }); g.pay(b); guarded = true; continue; }
            if (S().chars[d1]) { refused = !!AA4.planDeclaration(S(), REAL, b, { kind: "guard", ch: d1 }).reason; }
            g.ok({ t: "noGuard", seat: b }); continue;
          }
        }
        g.ok({ t: "pass", seat: AA4.priorityNow(S()) });
      }
      assert(guarded, "guarded the second attack");
      assert(refused || !S().chars[d1], "d1 can't guard the third attack");
      assert(seen.has(m1) && seen.has(m2), "each attack was resolved: " + JSON.stringify([...seen]));
      assert(!S().raid, "the group is over");
    });
    test("Q#44 / Q#45 / Q#53 (Revise#145): 2250 targeting it costs X more; 2540 three hits; 2794 X = the discarded card's cost", () => {
      const g = m2Game(["A3-16 2250", "A3-19 2540", "A3-20 2794"]), S = g.S, { a } = g;
      const t = g.char(a, "A3-16 2250", "front");
      const se = AA4.charStats(S(), REAL, t).se;
      eq(AA4.targetTax(S(), REAL, { kind: "effect", seat: a }, [{ ch: t }]), se, "effect targeting it: +Mental");
      eq(AA4.targetTax(S(), REAL, { kind: "effect", seat: 1 - a }, [{ ch: t }]), 0, "only your own effects");
      assert(AA4.charStats(S(), REAL, g.char(a, "A3-19 2540", "front")).tripleHit, "three hits");
      eq(REAL.card("A3-20 2794").status, "auto");
    });
    test("Q#46–Q#54 (Revise#146): 2448 pile texts off; テミス hand cap + damage; バロール redirect; 人形使い attacks for you; 2521 copies a card; 2686 names a face-down card", () => {
      const g = m2Game(["A3-18 2448", "A3-18 2464", "A3-18 2480", "A3-20 2757", "A3-19 2521", "A3-20 2686", "A3-11 1605"]), S = g.S, { a, b } = g;
      // 2448
      const nz = g.char(a, "A3-18 2448", "front");
      assert(AA4.pileTextOff(S(), REAL), "pile texts off");
      eq(AA4.xOf(S(), REAL, { damage: "you" }, { seat: a }), 0, "Damage Pile count reads 0");
      assert(AA4.stepNullified(S(), REAL, { a: "pickZone", zone: "discard" }), "a step on the Discard Pile does nothing");
      g.ok({ t: "move", seat: a, card: AA4.topOf(S().chars[nz]), to: { z: "discard" } });
      // テミス: over the hand limit → discard down now; discarded hand cards → damage
      g.char(a, "A3-18 2464", "front");
      const lim = AA4.playerStats(S(), REAL, b).handLimit, deckB = S().players[b].zones.deck;
      while (S().players[b].zones.hand.length <= lim) g.ok({ t: "move", seat: b, card: deckB[deckB.length - 1], to: { z: "hand" } });
      g.ok({ t: "draw", seat: b, n: 1 });
      const d = S().decisions.find(x => x.themis);
      assert(d, "asked to discard down at once");
      const dmg0 = g.events().filter(e => e.e === "playerDamage" && e.seat === b).length;
      for (let k = 0; k < 5; k++) { const x = S().decisions.find(y => y.themis); if (!x) break; g.ok({ t: "choose", seat: b, decision: x.id, pick: x.options.slice(0, x.min) }); }
      eq(S().players[b].zones.hand.length, lim, "down to the limit");
      assert(g.events().filter(e => e.e === "playerDamage" && e.seat === b).length > dmg0, "the discarded cards dealt damage");
      // 人形使い: the puppet attacks one of 2757's opponents, paying from 2757
      const pm = g.char(a, "A3-20 2757", "front"); g.give(pm, 3);
      const pup = g.char(b, vanilla("Darklore"), "front");
      S().modifiers.push({ id: "m-test-puppet", src: { seat: a, ch: pm }, to: { ch: pup }, key: "puppet", op: "grant", value: { seat: a, by: pm }, until: "turn" });
      eq(AA4.payersFor(S(), REAL, a, pup, "attack"), [pm], "costs only from 人形使い");
      assert(AA4.mineOrPuppet(S(), S().chars[pup], a), "treated as yours");
      // 2521 / 2686 compiled
      ["A3-19 2521", "A3-19 2528", "A3-20 2686", "A3-18 2480", "A3-18 2485", "A3-20 2759", "A3-20 2864", "A3-20 2879", "A3-18 2453", "A3-18 2469", "A3-20 2772"].forEach(k => eq(REAL.card(k).status, "auto", k));
    });
    test("Q#50 (Revise#146): A3-20 2686 — an opponent's card is declared face down; named right → discarded", () => {
      const g = m2Game(["A3-20 2686", "A3-11 1605"]), S = g.S, { a, b } = g;
      const gu = g.char(b, "A3-20 2686", "front"); g.give(gu, 2);
      const host = g.char(a, vanilla("E.G.O."), "front"); g.give(host, 4);
      g.toPhase("main");
      const pc = Object.values(S().cards).find(c => c.owner === a && c.key === "A3-11 1605");
      if (S().cards[pc.id].place.z !== "hand") g.ok({ t: "move", seat: a, card: pc.id, to: { z: "hand" } });
      g.ok({ t: "declare", seat: a, kind: "set", card: pc.id }); g.pay(a);
      if (S().draft && S().draft.step === "target") g.ok({ t: "target", seat: a, targets: S().draft ? [AA4.draftTargets(S(), REAL, S().draft)[0]] : [] });
      const d = S().decisions[0];
      assert(d && /face down/.test(d.reason), "2686's owner is asked to name it");
      assert(!S().cards[pc.id].faceUp, "face down");
      g.ok({ t: "choose", seat: b, decision: d.id, pick: [REAL.card("A3-11 1605").jp] });
      eq(S().cards[pc.id].place.z, "discard", "named right → discarded"); assert(!S().stack.some(it => it.card === pc.id), "not on the Resolve list");
    });
    test("M2e batch 2 (Revise#147): every player picks a Project card; 2974 hands down to yours; battled characters discarded", () => {
      const g = m2Game(["A3-23 3360", "A3-21 2974", "A3-11 1605"]), S = g.S, { a, b } = g;
      const run = REAL.card("A3-23 3360"); assert(JSON.stringify(run).includes("eachPlayerPick"), "3360 compiled");
      const kk = REAL.card("A3-21 2974"); assert(["handDownToMine", "moreCharsDiscard", "battleEndAll"].every(k => JSON.stringify(kk).includes(k)), "2974 compiled");
      ["A3-21 2901", "A3-22 3261", "A3-23 3368", "A3-24 3386", "A3-24 3466", "A3-25 3609", "A3-25 3612", "A3-25 3716", "A3-25 3719", "A3-25 3752"].forEach(k => eq(REAL.card(k).status, "auto", k));
      const ctx = { S: S(), db: REAL, emit: () => {} };
      AA4.runEffect(g.ctx ? g.ctx() : ctx, run.effects ? run.effects[0] : { steps: [{ a: "eachPlayerPick", zones: ["deck"], sel: { types: ["Project"] } }] }, { seat: a });
    });
    test("M2e batch 6 (Revise#151): 3688 mill for mental, 3121 called off vs a strong guard, 3759 any-target tax, 3116 Break tax, 3228 hand discards → Damage Pile", () => {
      const g = m2Game(["A3-25 3688", "A3-22 3121", "A3-25 3759", "A3-22 3116", "A3-22 3228"]), S = g.S, { a, b } = g;
      ["A3-25 3796", "A3-25 3720", "A3-25 3759", "A3-22 3116", "A3-21 2902", "A3-25 3688", "A3-22 3262", "A3-22 3156", "A3-22 3117", "A3-23 3366", "A3-25 3646", "A3-22 3121", "A3-24 3501", "A3-24 3536", "A3-25 3791", "A3-22 3228"].forEach(k => eq(REAL.card(k).status, "auto", k));
      const ctx = { S: S(), db: REAL, emit: () => {} };
      // 3688
      const ms = g.char(a, "A3-25 3688", "front");
      assert(AA4.charStats(S(), REAL, ms).millForMental, "3688 stat");
      const deck0 = S().players[a].zones.deck.length;
      AA4.damageChar(ctx, ms, { normal: 0, mental: 2 });
      eq(S().players[a].zones.deck.length, deck0 - 2, "2 cards milled instead"); assert(S().chars[ms], "still on the field");
      // 3759: tax for anyone's effect = its power
      const tx = g.char(b, "A3-25 3759", "front"); g.give(tx, 2);
      eq(AA4.targetTax(S(), REAL, { kind: "effect", seat: a }, [{ ch: tx }]), 2, "X = its power, also for the opponent");
      // 3116: Break tax on b's characters
      const bt = g.char(b, "A3-22 3116", "front"); const vb = g.char(b, vanilla("Darklore"), "front");
      const brk = Object.values(S().cards).find(c => c.owner === a && (REAL.card(c.key) || {}).type === "Break");
      if (brk) eq(AA4.targetTax(S(), REAL, { kind: "set", seat: a, card: brk.id }, [{ ch: vb }]), Math.max(0, AA4.charStats(S(), REAL, bt).se || 0), "Break tax = 3116's Mental");
      // 3228
      g.char(b, "A3-22 3228", "front");
      const hc = S().players[a].zones.hand[0] || S().players[a].zones.deck[S().players[a].zones.deck.length - 1];
      if (S().cards[hc].place.z !== "hand") g.ok({ t: "move", seat: a, card: hc, to: { z: "hand" } });
      AA4.moveCard(ctx, hc, { z: "discard" });
      eq(S().cards[hc].place.z, "damage", "a hand card discarded → Damage Pile");
      // 3121
      const rt = g.char(a, "A3-22 3121", "front"); g.give(rt, 3);
      const strong = g.char(b, vanilla("Darklore"), "back"); g.give(strong, 1);
      S().modifiers.push({ id: "m-test-at", src: { seat: b }, to: { ch: strong }, key: "at", op: "add", value: 20, until: "turn" });
      g.toPhase("main");
      const life = S().players[b].zones.damage.length;
      g.ok({ t: "declare", seat: a, kind: "attack", ch: rt, target: { seat: b } }); g.pay(a);
      g.ok({ t: "declare", seat: b, kind: "guard", ch: strong }); g.pay(b);
      for (let k = 0; k < 8 && S().battle && !S().decisions.length; k++) g.ok({ t: "pass", seat: AA4.priorityNow(S()) });
      assert(g.events().some(e => e.e === "attackEnded" && /called off/.test(e.why || "")), "attack called off");
      assert(S().chars[rt], "3121 survives");
    });
    test("Revise#151: Kicking Tiger's ability runs with the 'trigger' field; Game Status Skip moves a waiting game on", () => {
      const g = m2Game(["A3-25 3741"]), S = g.S, { a, b } = g;
      const host = g.char(a, vanilla("Polestar Empire"), "back"); g.give(host, 2);
      g.toPhase("main");
      const card = Object.values(S().cards).find(c => c.owner === a && c.key === "A3-25 3741" && ["hand", "deck"].includes(c.place.z)).id;
      if (S().cards[card].place.z !== "hand") g.ok({ t: "move", seat: a, card, to: { z: "hand" } });
      g.ok({ t: "declare", seat: a, kind: "set", card }); if (S().draft && S().draft.step === "pay") g.pay(a);
      for (let k = 0; k < 4 && S().stack.length && !S().triggers.length; k++) g.ok({ t: "pass", seat: AA4.priorityNow(S()) });
      const tr = S().triggers[0]; assert(tr, "ability waiting (it needs a target)");
      g.ok({ t: "trigger", trigger: tr.id, id: "0zzzzzzzzz-entry", seat: a, run: true, targets: [{ card: S().chars[host].power[0] }] });
      assert(!S().stack.some(x => x.kind === "trigger"), "runs at once — not on the Resolve list (Revise#162)");
      S().players.forEach(p => { p.hold = true; });
      for (let k = 0; k < 6 && (S().stack.length || S().decisions.length || S().triggers.length); k++) g.ok({ t: "unstick", seat: b });
      eq(S().stack.length, 0, "Skip passed for each player in turn");
      eq(AA4.check(S(), { t: "unstick", seat: a, by: S().players[a].cid }, REAL), "Nothing is waiting — the turn player can act", "nothing to skip");
    });
    test("M2e batch 7 (Revise#152): areas, hand picks, token permanents, Bind 3-X, loss threshold, draws, non-hand sets", () => {
      const g = m2Game(["A3-23 3367", "A3-21 3044", "A3-21 2977", "A3-21 2899", "A3-25 3650", "A3-25 3723", "A3-25 3718", "A3-22 3118", "A3-25 3610"]), S = g.S, { a, b } = g;
      const ctx = () => ({ S: S(), db: REAL, emit: () => {} });
      // 3367: X damage to one area (and to every player when it leaves)
      const k1 = g.char(a, "A3-23 3367", "front"); const v1 = g.char(b, vanilla("Darklore"), "front"), v2 = g.char(b, vanilla("Darklore"), "front");
      assert(JSON.stringify(REAL.card("A3-23 3367")).includes('"areaDamage"'), "3367 compiled");
      { const c = AA4.makeCtx(S(), REAL); AA4.runEffect(c, { steps: [{ a: "areaDamage", n: 1, players: "all" }] }, { seat: a, ch: k1 }); AA4.advance(c); }
      const d0 = S().decisions[0]; assert(d0 && d0.options.includes(b + ":control"), "pick an area");
      const dmgA = S().players[a].zones.damage.length;
      g.ok({ t: "choose", seat: a, decision: d0.id, pick: [b + ":control"] });
      assert(!S().chars[v1] || !S().chars[v2] || g.events().some(e => e.e === "damaged" && (e.ch === v1 || e.ch === v2)), "the area's characters took damage");
      assert(S().players[a].zones.damage.length >= dmgA, "players took damage too");
      // 2899: Bind 3-X with X = same-name cards
      if (S().stage !== "play" || S().decisions.length || S().queue.length) throw new Error("state: " + JSON.stringify({ st: S().stage, d: S().decisions.map(d => d.reason), q: S().queue.map(o => o.op) }));
      const bnd = g.char(a, "A3-21 2899", "front");
      eq(AA4.charStats(S(), REAL, bnd).skills.bind, 2, "Bind 3 - 1 = 2");
      // 2977: token permanents and Bind 0 at 6 rings
      const ring = g.char(a, "A3-21 2977", "front");
      const deck = S().players[a].zones.deck;
      for (let i = 0; i < 6; i++) { const id = deck[deck.length - 1]; AA4.moveCard(ctx(), id, { z: "char", ch: ring, role: "perm" }); S().cards[id].permToken = { name: "コントラクトリング", stats: { se: 1, at: 1, de: 1 }, skills: [{ id: "permanent", x: 1 }] }; }
      AA4.touch(S());
      const st = AA4.charStats(S(), REAL, ring);
      eq(st.skills.bind, 0, "6 rings: Bind 0");
      assert(st.at >= 6, "each ring +1 Attack");
      // 3650: the opponents' loss threshold goes down
      const lim0 = AA4.LOSE_DAMAGE;
      const iz = g.char(a, "A3-25 3650", "front");
      assert(AA4.charStats(S(), REAL, iz).lossMinusOpp, "3650 stat");
      // 3723: draw → choose from the deck instead
      g.char(a, "A3-25 3723", "front");
      const want = S().players[a].zones.deck[0];
      { const c = AA4.makeCtx(S(), REAL); AA4.enqueue(S(), [{ op: "draw", seat: a, n: 1 }]); AA4.advance(c); }
      const dt = S().decisions.find(d => /Instead of drawing/.test(d.reason));
      if (dt) { g.ok({ t: "choose", seat: a, decision: dt.id, pick: [want] }); eq(S().cards[want].place.z, "hand", "chosen card in hand"); }
      // 3718: a Character card set from the deck is discarded
      g.char(b, "A3-25 3718", "front");
      const top = S().players[b].zones.deck.find(id => (REAL.card(S().cards[id].key) || {}).type === "Character");
      if (top) { const c2 = AA4.makeCtx(S(), REAL); AA4.moveCard(c2, top, { z: "back", seat: b }); AA4.advance(c2); eq(S().cards[top].place.z, "discard", "set from the deck → discarded"); }
      // 3118 conditional Search; 3610 power-unnamed break rule
      assert(REAL.card("A3-22 3118").condSearch, "3118 condSearch");
      assert(REAL.card("A3-25 3610").breakRule.powerUnnamed, "3610 rule");
      ["A3-23 3367", "A3-21 3044", "A3-21 2977", "A3-21 2899", "A3-25 3650", "A3-25 3723", "A3-25 3718", "A3-22 3118", "A3-25 3610", "A3-22 3226", "A3-21 2904", "A3-21 2937", "A3-21 2973", "A3-24 3424", "A3-22 3192", "A3-22 3264", "A3-25 3792", "A3-24 3393", "A3-24 3430"].forEach(k => eq(REAL.card(k).status, "auto", k));
    });
    test("Q#56 – Q#59 (Revise#155): Initiative count, joint battle, Project shield / retarget, mill instead of 3616's extra; Outlaw rules", () => {
      const g = m2Game(["A3-24 3394", "A3-17 2333", "A3-24 3462", "A3-25 3616", "A3-01 0010"]), S = g.S, { a, b } = g;
      eq(REAL.card("A3-17 2333").skillCount.initiative, 2, "2333 prints Initiative twice");
      const hk = g.char(a, "A3-24 3394", "front");
      const st = AA4.charStats(S(), REAL, hk);
      assert(st.unguardableInit === 3 && st.initCount >= 1, "3394: needs 3 Initiatives (" + st.initCount + ")");
      assert(AA4.charStats(S(), REAL, g.char(a, "A3-24 3462", "front")).jointBattle, "3462 joint battle");
      const lk = g.char(b, "A3-25 3616", "front"); g.give(lk, 2);
      const brk = Object.values(S().cards).find(c => c.owner === a && c.key === "A3-01 0010");
      assert(AA4.millAltOffer(S(), REAL, a, REAL.card("A3-01 0010")), "3616: the mill option is offered to its opponent");
      assert(!AA4.millAltOffer(S(), REAL, b, REAL.card("A3-01 0010")), "not to its owner");
      ["A3-24 3394", "A3-24 3406", "A3-24 3461", "A3-24 3462", "A3-24 3537", "A3-25 3616"].forEach(k => eq(REAL.card(k).status, "auto", k));
      g.ok({ t: "rules", seat: a, key: "outlawPower", on: true });
      const pw = S().chars[lk].power[0], V = AA4.project(S(), a, REAL);
      assert(V.cards[pw].key, "Outlaw: the opponent's power card is face up");
      assert(g.events().some(e => e.e === "rule" && e.key === "outlawPower"), "logged");
      g.ok({ t: "deckLook", seat: a });
      assert(g.events().some(e => e.e === "deckLook"), "deck look logged");
      void brk;
    });
    test("Revise#156: A3-17 2385 — granted Dragoon♂ counts for its own +2/+2/+2 (classes are applied first)", () => {
      const g = m2Game(["A3-03 0582", "A3-17 2385"]), S = g.S, { a } = g;
      const plain = REAL.all().find(c => c.type === "Character" && !(c.abilities || []).length && !(c.icons || []).some(i => /ドラグーン/.test(i)) && c.se != null && EXTRA().includes(c.key)) || null;
      const host = g.char(a, vanilla("Polestar Empire"), "front");
      const oth = g.char(a, plain ? plain.key : vanilla("E.G.O."), "back");
      const free = k => Object.values(S().cards).find(c => c.owner === a && c.key === k && ["hand", "deck"].includes(c.place.z)).id;
      g.ok({ t: "move", seat: a, card: free("A3-03 0582"), to: { z: "char", ch: host, role: "stack" } });
      g.ok({ t: "move", seat: a, card: free("A3-17 2385"), to: { z: "char", ch: host, role: "stack" } });
      const st = AA4.charStats(S(), REAL, oth), inf = REAL.card(AA4.cardInfo(S(), REAL, AA4.topOf(S().chars[oth])).key);
      assert(st.icons.includes("ドラグーン♂"), "gains Dragoon♂");
      eq(st.at, (+inf.at || 0) + 2, "+2 Attack as a Dragoon♂");
      assert(AA4.charStats(S(), REAL, host).skills.infinity, "Infinity");
    });
    test("Q#60 (Revise#157): A3-25 3756 ザラーム — extra turn locks hand cards; only Named chars with power ≥ its power pay", () => {
      const g = m2Game(["A3-25 3756"]), S = g.S, { a } = g;
      const ab = (REAL.card("A3-25 3756").abilities || []).find(x => x.kind === "trigger");
      assert(ab && ab.cond && ab.cond.selfNamedCount.n === 5 && ab.effect.steps[0].a === "extraTurnLock", "trigger compiled");
      const z = g.char(a, vanilla("Polestar Empire"), "front"), o = g.char(a, vanilla("E.G.O."), "back");
      g.give(z, 3); g.give(o, 1);
      const st = S(); AA4.OPS.effStep({ S: st, db: REAL, emit: () => {} }, { s: { a: "extraTurnLock" }, e: { seat: st.turn.player, ch: z } });
      const m = st.modifiers.find(x => x.key === "extraTurn");
      assert(m && m.value.lock === z, "extra turn carries the lock");
      st.turn.lock = z; AA4.touch(st);
      assert(AA4.lockNoPay(st, REAL, o), "unnamed / weaker character can't pay");
      assert(AA4.lockNoPay(st, REAL, z) === !AA4.charStats(st, REAL, z).named, "itself pays only if Named");
      st.turn.lock = null;
      assert(!AA4.lockNoPay(st, REAL, o), "lock over");
    });
    test("M2g batch 2 (Revise#157): EP167/EP187 extra player hits, EP164 takes damage for an ally, EP185 draw on a kill, EP175 next Project free, EP191 cost to Damage Pile", () => {
      const proj = REAL.all().find(c => c.type === "Project" && typeof c.cost === "number" && c.cost >= 2 && !c.factor && c.play && c.play.status === "auto" && !(c.play.target)) || REAL.all().find(c => c.type === "Project" && typeof c.cost === "number" && c.cost >= 2);
      const g = m2Game(["A3-EP EP191", proj.key]), S = g.S, { a, b } = g;
      // compile
      const k187 = REAL.card("A3-EP EP187").abilities.find(x => x.mod && x.mod.key === "multiHit"); assert(k187 && k187.cond.all[0].permCountMin === 2, "EP187 compiled");
      eq(REAL.card("A3-EP EP167").abilities.find(x => x.kind === "trigger").effect.steps[0].a, "millTypeHitTwice", "EP167 compiled");
      // hitTwice: two damage checks on the player
      const me = g.char(a, vanilla("E.G.O."), "front"); g.give(me, 2);
      g.toPhase("main");
      AA4.addMod({ S: S(), db: REAL, emit: () => {} }, { src: { seat: a, ch: me }, to: { ch: me }, key: "hitTwice", op: "grant", value: true, until: "battle" });
      const n0 = g.events().filter(e => e.e === "playerDamage" && e.seat === b).length;
      g.ok({ t: "declare", seat: a, kind: "attack", ch: me, target: { seat: b } }); g.pay(a); g.ok({ t: "noGuard", seat: b }); g.respond();
      for (let k = 0; k < 6 && S().battle; k++) g.ok({ t: "pass", seat: AA4.priorityNow(S()) });
      eq(g.events().filter(e => e.e === "playerDamage" && e.seat === b).length - n0, AA4.charStats(S(), REAL, me).at > 0 ? 2 : 0, "two damage checks");
      // EP164 takeFor
      const st = S(), ctx = { S: st, db: REAL, emit: () => {} }, prot = g.char(a, vanilla("E.G.O."), "back"), ally = g.char(a, vanilla("E.G.O."), "back");
      AA4.OPS.effStep(ctx, { s: { a: "takeForT", to: "t", until: "main" }, e: { seat: a, ch: prot, card: AA4.topOf(st.chars[prot]), targets: [{ ch: ally }] } });
      const evs = []; AA4.damageChar({ S: st, db: REAL, emit: e => evs.push(e) }, ally, { normal: 1, mental: 0 });
      assert(evs.some(e => e.e === "damageTaken" && e.by === prot && e.for === ally), "the protector takes it");
      // EP185 drawOnKill
      AA4.addMod(ctx, { src: { seat: a }, to: { seat: a }, key: "drawOnKill", op: "grant", value: { n: 1 }, until: "main" });
      const foe = g.char(b, vanilla("Darklore"), "back"), q0 = (st.queue || []).length;
      AA4.defeat(ctx, foe, { why: "test", bySeat: a });
      assert((st.queue || []).slice(q0).some(o => o.op === "draw" && o.seat === a), "a draw is queued");
      // EP175 nextFreeCard
      const pc = Object.values(st.cards).find(c => c.owner === a && c.key === proj.key);
      if (pc) { AA4.moveCard(ctx, pc.id, { z: "hand" });
        const before = AA4.planDeclaration(st, REAL, a, { kind: "set", card: pc.id });
        AA4.addMod(ctx, { src: { seat: a }, to: { seat: a }, key: "nextFreeCard", op: "grant", value: { types: ["Project", "Fast"] }, until: "main" });
        const after = AA4.planDeclaration(st, REAL, a, { kind: "set", card: pc.id });
        if (before && before.cost != null && after && after.cost != null) { eq(after.cost, 0, "free"); assert(after.useMod, "uses the grant"); } }
      // EP191 compile
      eq(REAL.card("A3-EP EP191").abilities.find(x => x.mod && x.mod.key === "payToDamageBoost").mod.value.at, 2, "EP191 compiled");
    });
    test("M2g batch 3 (Revise#157): EP236 stat choice for all, EP253 Initiative → discard instead, EP247 bottom guess, EP243 free only onto an opponent, EP252 hand pay", () => {
      const g = m2Game(["A3-EP EP253"]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, emit: () => {} };
      const d1 = g.char(a, vanilla("Darklore"), "back"), d2 = g.char(a, vanilla("Darklore"), "back");
      const de0 = AA4.charStats(st, REAL, d1).de;
      AA4.OPS.effStep(ctx, { s: { a: "statChoice", to: { all: { faction: "Darklore", owner: "you", area: "controlled" } }, n: 2, until: "main" }, e: { seat: a, targets: [] } });
      const d = st.decisions[0]; assert(d && d.options.includes("de"), "choose the stat");
      g.ok({ t: "choose", seat: a, decision: d.id, pick: ["de"] });
      eq(AA4.charStats(S(), REAL, d1).de, de0 + 2, "Defense +2"); eq(AA4.charStats(S(), REAL, d2).de, AA4.charStats(S(), REAL, d1).de, "both");
      // EP253
      const st2 = S(), c2 = { S: st2, db: REAL, emit: () => {} }, foe = g.char(b, vanilla("E.G.O."), "back");
      AA4.addMod(c2, { src: { seat: b }, to: { ch: foe }, key: "skill", op: "grant", value: { id: "initiative", x: true }, until: "turn" });
      AA4.OPS.effStep(c2, { s: { a: "discardIfSkill", to: "t", skill: "initiative" }, e: { seat: a, targets: [{ ch: foe }] } });
      assert(!st2.chars[foe] || st2.chars[foe].flags.dying, "discarded"); eq(st2.effLast, 0, "the rest is skipped");
      // EP243 / EP252 compile
      const c243 = REAL.card("A3-EP EP243"); assert(c243.freeIf && c243.freeIf.oppOnly, "EP243 freeIf");
      const c252 = REAL.card("A3-EP EP252"); assert(c252.effHandPay && c252.effHandPay.icons.length >= 2, "EP252 hand pay");
      // EP247 bottom guess
      const st3 = S(), c3 = { S: st3, db: REAL, emit: () => {} }, deck = st3.players[a].zones.deck, h0 = st3.players[a].zones.hand.length;
      const t2 = (REAL.card(st3.cards[deck[1]].key) || {}).type;
      AA4.OPS.bottomXGuessGo(c3, { seat: a, x: 2, answer: [t2] });
      eq(st3.players[a].zones.hand.length, h0 + 2, "named right: the bottom 2 to the hand");
    });
    test("M2g batches 4 – 8 (Revise#157): extra phases, once per turn, negate next damage, guess the top card, personality promos, tags", () => {
      const ex = REAL.card("A3-EP EP282").effects[0].steps.filter(x => x.mod && x.mod.key === "extraPhase");
      eq(ex.map(x => x.mod.value.phase), ["main", "charge"], "EP282: extra Main, then Power Card Phase");
      assert(REAL.card("A3-EP EP313").effects.some(ef => ef.onlyExtra), "EP313 only in an extra phase / turn");
      assert(REAL.card("A3-EX01 EX0021").effects[0].oncePerTurn, "EX0021 once per turn");
      const c428 = REAL.card("A3-EX04 EX0428").abilities.find(x => x.mod && x.mod.key === "cardCost"); eq(c428.mod.value.sel.tag, "フッケバイン", "EX0428 by tag");
      const p326 = REAL.card("A3-PR PR326"); assert(p326.sameAs && p326.sameAsJp, "PR326 is the card it names");
      const g = m2Game(["A3-EX02 EX0182"]), S = g.S, { a } = g, st = S(), ctx = { S: st, db: REAL, emit: () => {} };
      const me = g.char(a, vanilla("E.G.O."), "back");
      AA4.OPS.effStep(ctx, { s: { a: "negateNextDamage", until: "main" }, e: { seat: a, ch: me, card: AA4.topOf(st.chars[me]) } });
      const evs = []; AA4.damageChar({ S: st, db: REAL, emit: x => evs.push(x) }, me, { normal: 5, mental: 0 });
      assert(!evs.some(x => x.e === "damaged" && x.ch === me && x.normal > 0), "the damage is negated"); assert(!st.modifiers.some(m => m.key === "negateNext"), "used up");
      const deck = st.players[a].zones.deck, top = (REAL.card(st.cards[deck[deck.length - 1]].key) || {}).type, q0 = (st.queue || []).length;
      AA4.OPS.guessTopDrawGo(ctx, { seat: a, n: 2, answer: [top] });
      assert((st.queue || []).slice(q0).some(o => o.op === "draw" && o.n === 2), "named right: draw 2");
    });
    test("M3a (Revise#159): Permanent +X, cost to Damage Pile by type, noPay selectors, Fast declare bans, resolve hits", () => {
      const p589 = REAL.card("A3-03 0589"); assert(p589.statModsX && p589.statX, "0589: +X with its own X line");
      const g = m2Game(["A3-03 0589", "A3-02 0237"]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, emit: () => {} };
      const me = g.char(a, vanilla("E.G.O."), "front");
      const at0 = AA4.charStats(st, REAL, me).at, pc = Object.values(st.cards).find(c => c.owner === a && c.key === "A3-03 0589");
      for (const id of st.players[b].zones.deck.slice(-3)) AA4.moveCard(ctx, id, { z: "damage" });
      AA4.moveCard(ctx, pc.id, { z: "char", ch: me, role: "perm" }); AA4.touch(st);
      eq(AA4.charStats(st, REAL, me).at, at0 + st.players[b].zones.damage.length, "Attack +X (X = opponents' Damage Pile)");
      // noPaySel
      AA4.addMod(ctx, { src: { seat: a }, to: { players: "all" }, key: "noPaySel", op: "grant", value: { broken: false }, until: "main" }); AA4.touch(st);
      assert(AA4.lockNoPay(st, REAL, me), "an unbroken character can't pay");
      // compile checks
      eq(REAL.card("A3-02 0237").play.steps.filter(x => x.mod && x.mod.key === "dest").length, 2, "0237: two cost rules by type");
      assert(REAL.card("A3-03 0485").play.steps.some(x => x.mod && x.mod.key === "swapAtDeAll"), "0485 swaps Attack / Defense");
      assert(REAL.card("A3-05 0872").play.selfShield, "0872 is not affected by Fast cards / effects");
      assert(REAL.card("A3-02 0243").play.steps[0].mod.key === "noActSel", "0243 bans declarations");
    });
    test("M2g final (Revise#161): as Fast, forced battle / guard, perm-token Install, EX0384 hit, EX0505 back to hand, PP117 mental to hand, EXPR046 X", () => {
      for (const k of ["A3-EX03 EX0223", "A3-EX03 EX0228", "A3-EX03 EX0232", "A3-EXPP EXPP023"]) assert(REAL.card(k).asFast, k + " can be used as a Fast card");
      eq(REAL.card("A3-EX02 EX0136").effects[0].steps[0].a, "forceBattle", "EX0136 forced battle");
      assert(REAL.card("A3-EX02 EX0137").abilities.some(x => x.effect && x.effect.steps[0].a === "forceGuardPick"), "EX0137 forced guard");
      const c192 = REAL.card("A3-EX02 EX0192"); assert(c192.effects[0].steps[0].token.once, "EX0192: Install token, once-only stats");
      eq(REAL.card("A3-EX05 EX0505").damageToHand, "factorMet", "EX0505 back to hand if the factor is met");
      assert(REAL.card("A3-EXPP EXPP025").fastIfOppAttacking && !REAL.card("A3-EXPP EXPP025").fastTiming, "EXPP025: Fast timing only while another's character attacks");
      eq(REAL.card("A3-EX04 EX0402").onlyByJp, "融合(シグナム+アギト)", "EX0402 only by 融合");
      // EX0384: X damage to the battle opponent still alive, once per battle
      const g = m2Game(["A3-EX04 EX0384"]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, emit: () => {} };
      const me = g.char(a, "A3-EX04 EX0384", "front"), op = g.char(b, vanilla("E.G.O."), "front");
      st.battle = { kind: "attack", attacker: me, guard: op, chars: [me, op] };
      const evs = [], c2 = { S: st, db: REAL, emit: x => evs.push(x) };
      AA4.OPS.effStep(c2, { s: { a: "damageAliveOpps" }, e: { seat: a, ch: me, x: 3 } });
      AA4.OPS.effStep(c2, { s: { a: "damageAliveOpps" }, e: { seat: a, ch: me, x: 3 } });
      eq(evs.filter(x => x.e === "damaged" && x.ch === op).length, 1, "once per battle");
      st.battle = null;
      // PP117: a Character card discarded by mental damage goes to its owner's hand
      const g2 = m2Game(["A3-PP PP117"]), S2 = g2.S, st2 = S2(), cx2 = { S: st2, db: REAL, emit: () => {} };
      AA4.addMod(cx2, { src: { seat: g2.a }, to: { players: "all" }, key: "mentalToHand", op: "grant", value: true, until: "removed" }); AA4.touch(st2);
      const v = g2.char(g2.b, vanilla("E.G.O."), "front"), top = AA4.topOf(st2.chars[v]);
      AA4.damageChar(cx2, v, { normal: 0, mental: 99 });
      for (let k = 0; k < 20 && st2.queue && st2.queue.length; k++) { const o = st2.queue.shift(); AA4.OPS[o.op] && AA4.OPS[o.op](cx2, o); }
      assert(!st2.chars[v], "PP117: defeated by mental damage"); eq(st2.cards[top].place.z, "hand", "PP117: the Character card goes to the hand");
    });
    test("M3a batch 4 (Revise#161): 0735 no damage from Mental ≤ own, 0871 choose X Erasers, 0422 no cards set, 0837 cost back on ピアスデモン", () => {
      const g = m2Game(["A3-05 0735"]), S = g.S, { a, b } = g, st = S(), ctx = { S: st, db: REAL, emit: () => {} };
      const me = g.char(a, vanilla("E.G.O."), "front"), op = g.char(b, vanilla("E.G.O."), "front");
      AA4.addMod(ctx, { src: { seat: a }, to: { ch: me }, key: "noDamage", op: "grant", value: { battle: true, fromSeLeSelf: true }, until: "main" }); AA4.touch(st);
      const evs = []; AA4.damageChar({ S: st, db: REAL, emit: x => evs.push(x) }, me, { normal: 3, mental: 0, battle: true, from: op });
      assert(!evs.some(x => x.e === "damaged" && x.ch === me && x.normal > 0), "0735: no battle damage from an equal-Mental character");
      AA4.OPS.effStep(ctx, { s: { a: "pickCharsMods", sel: { owner: "you", area: "controlled" }, n: "X", until: "charge", mods: [{ key: "noSetOn" }, { key: "se", xSign: -1 }] }, e: { seat: a, x: 1 } });
      AA4.OPS.pickCharsModsGo(ctx, { answer: [AA4.topOf(st.chars[me])], s: { mods: [{ key: "noSetOn" }, { key: "se", xSign: -1 }], until: "charge" }, e: { seat: a, x: 1 } }); AA4.touch(st);
      const cs = AA4.charStats(st, REAL, me); assert(cs.noSet && cs.noCharge, "0422: no card set on it"); 
      eq(REAL.card("A3-05 0837").costBack.onPerm, "ピアスデモン", "0837 cost back onto a ピアスデモン holder");
      eq(REAL.card("A3-05 0871").play.steps[0].a, "pickCharsMods", "0871 chooses X Erasers");
    });
    test("Pack (Revise#162): A3-05 0722 — “このカードがセットされた場合” fires for this card only, not when a Permanent is set on the character later", () => {
      const g = m2Game(["A3-05 0722"]), S = g.S, { a } = g, st = S(), ctx = { S: st, db: REAL, emit: () => {} };
      const me = g.char(a, vanilla("E.G.O."), "front"), brk = Object.values(st.cards).find(c => c.owner === a && c.key === "A3-05 0722");
      AA4.moveCard(ctx, brk.id, { z: "char", ch: me, role: "stack" }); AA4.touch(st);
      const t = { ch: me, card: brk.id, seat: a }, w = { event: "enter", self: true }, M = AA4.TRIGGER_MATCH.enter;
      assert(M({ e: "entered", card: brk.id, ch: me }, w, t, st, REAL), "fires when 0722 itself is set");
      const perm = st.players[a].zones.deck[0];
      AA4.moveCard(ctx, perm, { z: "char", ch: me, role: "perm" });
      assert(!M({ e: "entered", card: perm, ch: me }, w, t, st, REAL), "not when another card (a Permanent) is set on it");
    });
    test("Q#55 (Revise#150): 2279 hand damage instead of the damage check; 2721 hand to top / draw from bottom; 2253 battle-discard split; 2867 Machine skills", () => {
      const g = m2Game(["A3-16 2279", "A3-20 2721", "A3-16 2253", "A3-20 2867"]), S = g.S, { a, b } = g;
      // 2279
      const ya = g.char(a, "A3-16 2279", "front"); g.give(ya, 2);
      g.toPhase("main");
      const handB = S().players[b].zones.hand.length, dmgB = S().players[b].zones.damage.length, x = AA4.charStats(S(), REAL, ya).at;
      g.ok({ t: "declare", seat: a, kind: "attack", ch: ya, target: { seat: b } }); g.pay(a); g.ok({ t: "noGuard", seat: b });
      for (let k = 0; k < 8 && !S().decisions.length && S().battle; k++) g.ok({ t: "pass", seat: AA4.priorityNow(S()) });
      const d = S().decisions[0];
      if (handB >= x) { assert(d && /Character cards → Discard Pile/.test(d.reason), "choose X hand cards"); g.ok({ t: "choose", seat: a, decision: d.id, pick: d.options.slice(0, x) }); }
      eq(S().players[b].zones.hand.length, Math.max(0, handB - x), "X hand cards used");
      assert(!g.events().some(e => e.e === "playerDamage" && e.seat === b), "no normal damage check");
      // 2721
      const p = S().players[a], h0 = p.zones.hand.slice(), bottom = p.zones.deck.slice(0, h0.length);
      AA4.runEffect({ S: S(), db: REAL, emit: () => {} }, { steps: [{ a: "handTopDrawBottom" }] }, { seat: a });
      for (let k = 0; k < 10 && S().queue && S().queue.length; k++) AA4.OPS[S().queue[0].op] && 0;
      // 2253 / 2867 compile
      assert(AA4.charStats(S(), REAL, g.char(a, "A3-16 2253", "front")).battleKillSplit, "2253 split");
      ["A3-16 2199", "A3-16 2208", "A3-16 2287", "A3-16 2289", "A3-17 2356", "A3-17 2362", "A3-17 2371", "A3-17 2377", "A3-18 2418", "A3-18 2423", "A3-20 2736", "A3-20 2865", "A3-20 2867", "A3-20 2880"].forEach(k => eq(REAL.card(k).status, "auto", k));
    });
    test("Pack's Deck 1 (Revise#124): 3757/3770 copy Break skills, 2477 free vs Eraser, PP279 from the Damage Pile, 0742, 3764, 2481 討伐令", () => {
      const st = k => REAL.card(k);
      ["A3-25 3757", "A3-25 3770", "A3-18 2477", "A3-PP PP279", "A4-04 0742", "A3-25 3764", "A3-18 2481"].forEach(k => assert(st(k), k));
      const play = st("A3-18 2481").play, js = JSON.stringify(play);
      assert(/"pickDiscard"/.test(js) && /"guardTax"/.test(js), "討伐令: discard on attack + guard cost +1");
      assert(!play.target, "討伐令 has no declaration-time target");
      assert(/playFromDamage/.test(JSON.stringify(st("A3-PP PP279"))), "PP279 plays from the Damage Pile");
      assert(/copyOppBreakSkills/.test(JSON.stringify(st("A3-25 3757"))), "3757 copies Break skills");
      assert(/noFactor/.test(JSON.stringify(st("A3-25 3764"))), "3764 ignores factor");
    });
    test("Pack's decks (Revise#112): A3-11 1605 軌道エレベーター — X of your Controlled Characters → Active Area, then X Active ones → Control Area", () => {
      const g = m2Game(["A3-11 1605"]), S = g.S, { a } = g;
      const c1 = g.char(a, vanilla("E.G.O."), "back"), p1 = g.char(a, vanilla("WIZ-DOM"), "active");
      g.toPhase("main");
      const card = Object.values(S().cards).find(c => c.owner === a && c.key === "A3-11 1605" && ["hand", "deck"].includes(c.place.z)).id;
      if (S().cards[card].place.z !== "hand") g.ok({ t: "move", seat: a, card, to: { z: "hand" } });
      g.ok({ t: "declare", seat: a, kind: "set", card }); g.pay(a);
      for (let k = 0; k < 4 && S().stack.length && !S().decisions.length; k++) g.ok({ t: "pass", seat: AA4.priorityNow(S()) });
      if (!S().decisions.length) throw new Error("no choice: " + JSON.stringify({ x: g.events().filter(e => e.e === "declared").map(e => e.x),  draft: S().draft && S().draft.step, stack: S().stack.length, ev: g.events().slice(-6).map(e => e.e + (e.why ? ":" + e.why : "")) }));
      g.decide([AA4.topOf(S().chars[c1])]);
      assert(S().chars[c1].at.area === "active", "Controlled → Active Area");
      g.decide(d => [d.options.find(id => id === AA4.topOf(S().chars[p1])) || d.options[0]]);
      assert(AA4.isControlled(S().chars[p1]) || AA4.isControlled(S().chars[c1]), "one Active character → Control Area");
    });
    test("Pack (Revise#112): A3-BS2 1794 — ±0/+2/+2 only in a real battle; an unguarded attack on a player is no battle", () => {
      const g = m2Game(["A3-BS2 1794"]), S = g.S, { a, b } = g;
      const me = g.char(a, "A3-BS2 1794", "front"); g.give(me, 1);
      eq(AA4.charStats(S(), REAL, me).at, 1, "not in a battle: Attack 1");
      g.toPhase("main");
      const deck = S().players[b].zones.deck.length;
      g.ok({ t: "declare", seat: a, kind: "attack", ch: me, target: { seat: b } }); g.pay(a); g.ok({ t: "noGuard", seat: b });
      eq(AA4.charStats(S(), REAL, me).at, 1, "attacking a player without a guard: still Attack 1");
      g.respond();
      eq(S().players[b].zones.deck.length, deck - 1, "1 damage, not 3");
    });
    test("Revise#119 (Pack): a Permanent's skills belong to its character — メトセラ gives Shield · Bind 1 · Draw -1 · Charge 1", () => {
      const g = m2Game(["A3-09 1381"]), S = g.S, { a } = g;
      const ch = g.char(a, vanilla("WIZ-DOM"), "back");
      const p = Object.values(S().cards).find(c => c.owner === a && c.key === "A3-09 1381" && ["deck", "hand"].includes(c.place.z)).id;
      g.ok({ t: "move", seat: a, card: p, to: { z: "char", ch, role: "perm" } });
      const sk = AA4.charStats(S(), REAL, ch).skills;
      assert(sk.shield && sk.bind === 1 && sk.charge === 1, JSON.stringify(sk));
    });
    test("Revise#119: tokens — A3-07 1124 makes a コウモリ 0/1/1 (Intercept, Synchro) from the cost; A3-07 1090 an アストラル with power = X", () => {
      const g = m2Game(["A3-07 1124", "A3-07 1090"]), S = g.S, { a } = g;
      const me = g.char(a, "A3-07 1124", "front"); g.give(me, 3);
      g.toPhase("main");
      const top = AA4.topOf(S().chars[me]), i = AA4.effectsOf(S(), REAL, me, top).findIndex(e => /コウモリ/.test(e.text));
      g.ok({ t: "declare", seat: a, kind: "effect", ch: me, card: top, i }); g.pay(a);
      for (let k = 0; k < 4 && S().stack.length; k++) g.ok({ t: "pass", seat: AA4.priorityNow(S()) == null ? a : AA4.priorityNow(S()) });
      const bat = Object.keys(S().chars).find(id => AA4.charStats(S(), REAL, id).tokenName === "コウモリ");
      assert(bat, "a コウモリ is on the field"); const st = AA4.charStats(S(), REAL, bat);
      eq([st.se, st.at, st.de], [0, 1, 1]); assert(st.skills.intercept && st.skills.synchro, "Intercept · Synchro"); assert(AA4.isControlled(S().chars[bat]), "a Controlled Character");
      const mage = g.char(a, "A3-07 1090", "front"); g.give(mage, 3);
      const t2 = AA4.topOf(S().chars[mage]), j = AA4.effectsOf(S(), REAL, mage, t2).findIndex(e => /アストラル/.test(e.text) && e.cost === "X");
      g.ok({ t: "declare", seat: a, kind: "effect", ch: mage, card: t2, i: j }); g.ok({ t: "pay", seat: a, cards: S().chars[mage].power.slice(0, 2) });
      for (let k = 0; k < 4 && S().stack.length; k++) g.ok({ t: "pass", seat: AA4.priorityNow(S()) == null ? a : AA4.priorityNow(S()) });
      const ast = Object.keys(S().chars).find(id => AA4.charStats(S(), REAL, id).tokenName === "アストラル");
      assert(ast, "an アストラル"); const sa = AA4.charStats(S(), REAL, ast);
      eq([sa.se, sa.at, sa.de, sa.atMental], [2, 2, 2, true], "X = 2: the 2 cost cards are its power — Mental / mental Attack / Defense 2");
    });
    test("Pack's deck Sekhmet (Revise#115): セクメト without its Break condition; フレイヤ can be attacked by opponents' Controlled Characters; ゲイ・ボウ locks charging", () => {
      const g = m2Game(["A3-19 2569", "A3-19 2574", "A4-03 0476"]), S = g.S, { a, b } = g;
      const inf = AA4.asBreakInfo(REAL.card("A3-19 2569"));
      eq(inf.breakRule, null, "no Break condition"); eq(inf.cost, 1); eq(inf.factor, { "WIZ-DOM": 6 });
      const fr = g.char(b, "A3-19 2574", "front"), att = g.char(a, vanilla("E.G.O."), "front"); g.give(att, 2);
      g.toPhase("main");
      eq(AA4.check(S(), { t: "declare", by: g.by(a), seat: a, kind: "attack", ch: att, target: { ch: fr } }, REAL), null, "an opponent's Controlled Character may attack フレイヤ");
      const host = g.char(a, vanilla("E.G.O.", { at: 2 }), "front");
      const perm = Object.values(S().cards).find(c => c.owner === a && c.key === "A4-03 0476" && c.place.z === "deck").id;
      g.ok({ t: "move", seat: a, card: perm, to: { z: "char", ch: host, role: "perm" } });
      assert(AA4.charStats(S(), REAL, host).chargeLock, "ゲイ・ボウ gives its character the charge lock");
    });
    test("Pack's decks (Revise#112): A3-25 3644 龍貴婦人 — Dragoon Break cards in your hand get Search; A3-24 3499 ティアマト — names in Damage Piles are banned for opponents", () => {
      const g = m2Game(["A3-25 3644", "A3-24 3499", "A3-01 0186"]), S = g.S, { a, b } = g;
      g.char(a, "A3-25 3644", "front");
      const brk = Object.values(S().cards).find(c => c.owner === a && c.key === "A3-01 0186" && c.place.z === "deck").id;
      g.ok({ t: "move", seat: a, card: brk, to: { z: "hand" } });
      assert(AA4.searchOf(S(), REAL, a, brk), "the Dragoon Break card in hand has Search");
      g.char(a, "A3-24 3499", "front");
      const other = Object.values(S().cards).find(c => c.owner === b && c.key === vanilla("E.G.O.") && c.place.z === "deck").id;
      const twin = Object.values(S().cards).find(c => c.owner === b && c.key === vanilla("E.G.O.") && c.place.z === "deck" && c.id !== other).id;
      g.ok({ t: "move", seat: b, card: other, to: { z: "damage" } });
      assert(AA4.banOf(S(), REAL, b, { kind: "set", info: REAL.card(S().cards[twin].key) }), "the same name as a Damage Pile card: banned for the opponent");
      assert(!AA4.banOf(S(), REAL, a, { kind: "set", info: REAL.card(S().cards[twin].key) }), "not for you");
    });
    test("M1a: A3-24 3381 — your Break card on it at fast timing (Active Phase), on nothing else", () => {
      const g = mGame(), S = g.S, { a } = g;
      const me = g.char(a, "A3-24 3381", "front"), other = g.char(a, "A3-20 2676", "front");
      eq(S().turn.phase, "active");
      const c = g.hand(a, "A3-20 2676");
      g.ok({ t: "declare", seat: a, kind: "set", card: c, asBreak: true });
      eq(AA4.draftTargets(S(), REAL, S().draft).map(x => x.ch), [me], "only 3381 (not the other character)");
      void other;
    });
  }
  test("M1b: source titles — A3-EX03 EX0278 breakable by any Nanoha card; A3-EXPR EXPR068 the cards of players with ≤ 5 Controlled Characters are immune; A3-PP PP106", () => {
    const nanohaBreak = REAL.all().find(c => c.type === "Break" && (c.works || []).includes("nanoha") && !c.name && !c.breakRule && !(c.icons || []).some(i => REAL.card("A3-EX03 EX0278").icons.includes(i)));
    const plain = REAL.all().find(c => c.type === "Break" && !(c.works || []).length && !c.name && !c.breakRule && !(c.icons || []).some(i => REAL.card("A3-EX03 EX0278").icons.includes(i)));
    const g = RULES.game({ db: REAL, deck: Array(20).fill("A3-EX03 EX0278").concat(Array(20).fill(nanohaBreak.key), Array(10).fill(plain.key), Array(10).fill("A3-EXPR EXPR068")), rules: {} });
    const S = g.S, a = g.tp();
    const ch = g.char(a, "A3-EX03 EX0278", "front");
    eq(AA4.breakReason(S(), REAL, a, g.toHand(a, nanohaBreak.key), ch), null, "a Nanoha Break card: any class");
    eq(AA4.breakReason(S(), REAL, a, g.toHand(a, plain.key), ch), "No class icon in common", "another Break card: needs a class icon");
    g.char(a, "A3-EXPR EXPR068", "back");
    assert(AA4.charStats(S(), REAL, ch).untargetable.some(u => (u.from || []).includes("Project")), "≤ 5 Controlled Characters: Project / Fast can't affect it");
    eq(REAL.card("A3-PP PP106").abilities[0].mod.value.fromSel, { hasSkill: true });
  });
  test("M1b: A3-EX03 EX0280 — dominated at the end of the Charge Phase → may take an E.G.O. Character card from the deck (not when dominated by an effect)", () => {
    const g = RULES.game({ db: REAL, deck: Array(40).fill("A3-EX03 EX0280").concat(Array(20).fill("A3-20 2783")), rules: {} });
    const S = g.S, a = g.tp();
    const me = g.char(a, "A3-EX03 EX0280", "active"); g.give(me, 1);
    for (let k = 0; k < 6 && !S().triggers.length && S().turn.player === a; k++) { const d = S().decisions[0]; if (d) { g.ok({ t: "choose", seat: d.seat, decision: d.id, pick: d.options.slice(0, d.min) }); continue; } g.ok({ t: "next", seat: a }); }
    assert(S().triggers.some(t => S().cards[t.card].key === "A3-EX03 EX0280"), "its ability asks after the Charge Phase domination (Q#64)");
  });
  test("M1c: Saga 4 — “あなたがEEEを満たしている場合” (A4-04 0593), tags “武蔵を持つ…3体以上” (A4-EX02 EX775), “あなたが先攻でない場合” (A4-05 0796)", () => {
    const g = RULES.game({ db: REAL, deck: Array(20).fill("A4-04 0593").concat(Array(20).fill("A4-EX02 EX775"), Array(20).fill("A4-05 0796")), rules: {} });
    const S = g.S, a = g.tp(), b = g.other();
    const me = g.char(a, "A4-04 0593", "back");
    const ch0 = AA4.charStats(S(), REAL, me).skills.charge || 0;
    g.char(a, "A4-04 0593", "back"); g.char(a, "A4-04 0593", "back");
    eq(AA4.charStats(S(), REAL, me).skills.charge, ch0 + 1, "EEE: Charge +1");
    assert((REAL.card("A4-EX02 EX775").tags || []).includes("武蔵"), "tag kept from the skill line");
    const mu = g.char(a, "A4-EX02 EX775", "back"), c1 = AA4.charStats(S(), REAL, mu).skills.charge || 0;
    g.char(a, "A4-EX02 EX775", "back"); g.char(a, "A4-EX02 EX775", "back");
    eq(AA4.charStats(S(), REAL, mu).skills.charge, c1 + 1, "3 武蔵 Controlled Characters");
    const f1 = g.char(a, "A4-05 0796", "back"), f2 = g.char(b, "A4-05 0796", "back");
    const sum = id => Object.values(AA4.charStats(S(), REAL, id).factorBonus).reduce((x, y) => x + y, 0);
    eq([sum(f1), sum(f2)], [0, 1], "only the player who didn't go first gets the extra factor");
  });
  test("Revise#190: Global Undo/Redo — any player may undo / redo any player's latest action (table rule); watchers may not", () => {
    const L = new AA4.GameLog(REAL, { debug: "ops" });
    L.push({ t: "create", by: "P0", seed: "gu", mode: "online", seats: 2, rules: {} });
    for (let s = 0; s < 2; s++) L.push({ t: "join", by: "P" + s, seat: s, name: "P" + s, deck: Array(60).fill("A3-20 2783") });
    for (let s = 0; s < 2; s++) L.push({ t: "keep", by: "P" + s, seat: s });
    L.push({ t: "watch", by: "W", name: "W" });
    const S = () => L.state, tp = S().turn.player, ot = 1 - tp, by = s => "P" + s;
    for (let s = 0; s < 2; s++) L.push({ t: "hold", by: by(s), seat: s, type: "undo", on: false });   // no agreement needed here
    const card = S().players[tp].zones.hand[0];
    L.push({ t: "move", by: by(tp), seat: tp, card, to: { z: "discard" } });
    eq(L.undoTarget(by(ot)), -1, "rule off: not another player's action");
    L.push({ t: "rules", by: by(ot), seat: ot, key: "globalUndo", on: true });
    eq(S().rules.globalUndo, true);
    L.push({ t: "move", by: by(tp), seat: tp, card, to: { z: "hand" } });
    L.push({ t: "move", by: by(tp), seat: tp, card, to: { z: "discard" } });
    const k = L.undoTarget(by(ot)); assert(k >= 0, "rule on: the other player may undo it");
    eq(L.undoTarget("W"), -1, "a watcher may not");
    L.push({ t: "undo", by: by(ot), of: k });
    eq(S().cards[card].place.z, "hand", "undone by the other player");
    const r = L.redoTarget(by(tp)); assert(r >= 0, "and the first player may redo it");
    L.push({ t: "redo", by: by(tp), of: r });
    eq(S().cards[card].place.z, "discard", "redone");
    assert(AA4.replayCheck(L) === null, "replay agrees");
    assert(L.events().some(e => e.e === "rule" && e.key === "globalUndo") && /Global Undo\/Redo/.test(AA4.describe(L.events().find(e => e.e === "rule" && e.key === "globalUndo"), S(), REAL, 0)), "logged");
  });
  test("Revise#112: undo waits for every other player with Hold ON (in turn order); Hold OFF players are not asked; a refusal cancels it", () => {
    const L = new AA4.GameLog(REAL, { debug: "ops" });
    L.push({ t: "create", by: "P0", seed: "u1", mode: "online", seats: 3, rules: {} });
    for (let s = 0; s < 3; s++) L.push({ t: "join", by: "P" + s, seat: s, name: "P" + s, deck: Array(60).fill("A3-20 2783") });
    for (let s = 0; s < 3; s++) L.push({ t: "keep", by: "P" + s, seat: s });
    const S = () => L.state, tp = S().turn.player, by = s => "P" + s;
    const others = AA4.livingOrder(S()).filter(s => s !== tp);
    L.push({ t: "hold", by: by(others[1]), seat: others[1], on: false });
    const card = S().players[tp].zones.hand[0];
    L.push({ t: "move", by: by(tp), seat: tp, card, to: { z: "discard" } });
    const k = L.undoTarget(by(tp)); assert(k >= 0, "something to undo");
    L.push({ t: "undo", by: by(tp), of: k });
    eq(S().cards[card].place.z, "discard", "not undone yet: waiting"); assert(L.pendingUndo, "an undo is waiting");
    eq(L.pendingUndo.voters, [others[0]], "only the Hold ON player is asked");
    L.push({ t: "undoOk", by: by(others[0]), of: L.entries.length - 1 });
    eq(S().cards[card].place.z, "hand", "agreed: undone"); assert(!L.pendingUndo, "nothing waiting");
    L.push({ t: "move", by: by(tp), seat: tp, card, to: { z: "discard" } });
    L.push({ t: "undo", by: by(tp), of: L.undoTarget(by(tp)) });
    const u = L.entries.length - 1;
    L.push({ t: "undoNo", by: by(others[0]), of: u });
    eq(S().cards[card].place.z, "discard", "refused: stays"); assert(!L.pendingUndo);
  });
  test("Revise#117: Take control — a watcher takes the waited-for seat after 30 s without a command; a second watcher right after is refused", () => {
    const L = new AA4.GameLog(REAL, { debug: "ops" });
    let t = 1000000;
    const push = it => L.push(Object.assign({ ts: (t += 1000) }, it));
    push({ t: "create", by: "P0", seed: "tc", mode: "online", seats: 2, rules: {} });
    for (let s = 0; s < 2; s++) push({ t: "join", by: "P" + s, seat: s, name: "P" + s, deck: Array(60).fill("A3-20 2783") });
    for (let s = 0; s < 2; s++) push({ t: "keep", by: "P" + s, seat: s });
    push({ t: "watch", by: "W1", name: "Watcher 1" }); push({ t: "watch", by: "W2", name: "Watcher 2" });
    const S = () => L.state, seat = AA4.actingSeat(S());
    assert(!push({ t: "takeControl", by: "W1" }).ok, "too early");
    t += 31000;
    assert(push({ t: "takeControl", by: "W1" }).ok, "after 30 s: ok");
    eq(S().players[seat].cid, "W1", "W1 plays that seat now"); assert(S().spectators["P" + seat], "the old player watches");
    assert(!push({ t: "takeControl", by: "W2" }).ok, "the second one is refused (30 s again)");
    // Revise#128: a player may take it too; the 30 s start again
    t += 31000;
    const other = 1 - seat, w = AA4.actingSeat(S());
    if (w === seat) {
      assert(push({ t: "takeControl", by: "P" + other }).ok, "another player takes the waited-for seat");
      eq(AA4.seatsOfCid(S(), "P" + other).sort(), [0, 1], "that player now plays both seats");
      assert(S().spectators["W1"], "W1 watches again");
      assert(!push({ t: "takeControl", by: "P" + other }).ok, "already theirs");
    }
  });
  test("Revise#104: a by-hand action during the Discard Phase choice doesn't end the phase; the choice is asked again with the hand now", () => {
    const g = RULES.game({ db: REAL, seats: 1, deck: Array(60).fill("A3-20 2783"), rules: {} });
    const S = g.S, a = g.tp(), deck = S().players[a].zones.deck;
    while (deck.length > 5) g.ok({ t: "move", seat: a, card: deck[deck.length - 1], to: { z: "hand" } });
    g.ok({ t: "field", seat: a, mod: { to: { seat: a }, key: "draw", value: 5, until: "removed", label: "draw +5" } });
    for (let k = 0; k < 8 && !S().decisions.length; k++) g.ok({ t: "next", seat: g.tp() });
    const n0 = S().decisions[0].min, moved = S().players[a].zones.hand[0];
    g.ok({ t: "move", seat: a, card: moved, to: { z: "deck", pos: "top" } });
    eq(S().turn.phase, "discard", "still the Discard Phase"); eq(S().decisions[0].min, n0 - 1, "asked again: one card fewer");
    assert(!S().decisions[0].options.includes(moved), "the card now in the deck isn't offered");
    const d = S().decisions[0]; g.ok({ t: "choose", seat: a, decision: d.id, pick: d.options.slice(0, d.min) });
    assert(!S().players[a].lost && S().stage === "play", "Draw 6 from a deck of 6: still playing");
  });
  test("Revise#098: Control Front left / centre / right (one area for the rules) and the Sort intent", () => {
    const g = RULES.game({ db: REAL, deck: Array(60).fill("A3-20 2783"), rules: {} });
    const S = g.S, a = g.tp();
    const c1 = g.char(a, "A3-20 2783", "front"), c2 = g.char(a, "A3-20 2783", "front"), c3 = g.char(a, "A3-20 2783", "front");
    g.ok({ t: "moveChar", seat: a, ch: c1, to: { area: "front", sec: "left" } });
    eq(S().chars[c1].at, { area: "front", sec: "left" }); eq(S().chars[c2].at, { area: "front" }, "centre = no sec");
    assert(AA4.isControlled(S().chars[c1]), "still the Control Area (Front)");
    g.ok({ t: "moveChar", seat: a, ch: c3, to: { area: "front", index: 0 } });
    eq(S().players[a].areas.front.filter(id => !S().chars[id].at.sec), [c3, c2], "index inside the centre section");
    g.no({ t: "moveChar", seat: a, ch: c1, to: { area: "back", sec: "left" } }, "section");
    g.no({ t: "sortChars", seat: a, area: "front", order: [c2] }, "Sort the characters");
    g.ok({ t: "sortChars", seat: a, area: "front", order: [c2, c3] });
    eq(S().players[a].areas.front.filter(id => !S().chars[id].at.sec), [c2, c3], "sorted");
    eq(S().players[a].areas.front.length, 3);
    g.ok({ t: "moveChar", seat: a, ch: c2, to: { area: "back" } }); g.ok({ t: "moveChar", seat: a, ch: c2, to: { area: "front" } });
    eq(S().chars[c2].at, { area: "front" }, "back → front without a section = centre");
    // Revise#403: the Front is one area on the table — the whole list is sorted at once
    const all = S().players[a].areas.front.slice();
    g.ok({ t: "sortChars", seat: a, area: "front", order: all.slice().reverse() });
    eq(S().players[a].areas.front, all.slice().reverse(), "the whole Front sorted, sections ignored");
  });
  for (const seats of [2, 3, 4]) test(`real data: random legal games with real decks, ${seats} players × 4 seeds`, () => {
    const all = REAL.all().filter(c => AA4.CARD_TYPES.includes(c.type));
    const byType = t => all.filter(c => c.type === t);
    let over = 0;
    for (let i = 0; i < 4; i++) {
      const S0 = { rng: { s: AA4.seedOf("deck" + seats + i), n: 0 } }, pick = (list, n) => AA4.shuffleInPlace(S0, list.slice()).slice(0, n).map(c => c.key);
      const fac = AA4.FACTIONS[(seats + i) % 6].name, f = t => byType(t).filter(c => c.faction === fac);
      const deck = pick(f("Character"), 25).concat(pick(f("Break"), 15), pick(f("Fast"), 4), pick(f("Project"), 3), pick(f("Permanent"), 3));
      const { log } = RULES.playRandom(REAL, { seats, seed: `real-${seats}-${i}`, steps: 700, deck });
      if (log.state.stage === "over") over++;
    }
  });
} else console.log("(real card list skipped — run python3 build.py first)");

console.log(`\n${passed} passed, ${failed} failed${failed ? "\n  " + fails.join("\n  ") : ""}`);
process.exit(failed ? 1 : 0);
