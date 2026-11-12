/* ==========================================================================
   Aquarian Age Helper · v4 rules engine · base  (requirements_v4 §20, step B1)

   The v4 engine is headless: plain functions, no DOM, no network. It runs in
   the page (window.AA4) and in Node for tests (globalThis.AA4). Every file adds
   to the one namespace AA4 and keeps everything else private, so it can be
   joined with the other site scripts later without name clashes.

   Files (loaded in name order):
     00-base.js        namespace, constants, seeded random, small helpers
     01-state.js       the state object (§20.2), places, lookups
     02-ops.js         atomic operations + operation queue (§20.3)
     03-intents.js     intents (check + apply), legalActions(), step() pipeline
     04-log.js         GameLog: the list of intents, undo / redo, replay
     05-invariants.js  invariant checks (debug / test mode)
     06-projection.js  what one viewer may see (§20.1 Projection)
     07-describe.js    game event → English log line
     08-db.js          card database adapters (site data + compiled rules → engine card info)
     10-query.js       query pipeline, modifiers, field effects, Declaration Bans (B3)
     11-turn.js        turn, phases, timing, Hold / pass, charge, dominate, discard (B2)
     12-declare.js     Declare / Cost / Resolve Systems (B2)
     13-events.js      decisions (Event System), triggers, the flow loop (B5)
     14-battle.js      Battle / damage / Defeated Systems, state check, lose (B4)
     15-selectors.js   selector language, targets, conditions (B6)
     16-effects.js     effect primitives, always-on abilities (B6)
     17-skills.js      Skill Database, Search (B6)
   ========================================================================== */
(function (G) {
  "use strict";
  const AA4 = (G.AA4 = G.AA4 || {});
  AA4.VERSION = "4.0.0-b1";

  /* Factions in table order (Revise#006). Slot ids are short and path-safe. */
  AA4.FACTIONS = [
    { id: "ego", name: "E.G.O." }, { id: "arayashiki", name: "Arayashiki" }, { id: "wizdom", name: "WIZ-DOM" },
    { id: "darklore", name: "Darklore" }, { id: "polestar", name: "Polestar Empire" }, { id: "eraser", name: "Eraser" },
  ];
  /** Active Area slots: the 6 factions, then "none" (only shown when used, as in v3). */
  AA4.SLOTS = AA4.FACTIONS.map(f => f.id).concat(["none"]);
  AA4.slotOfFaction = name => { const f = AA4.FACTIONS.find(x => x.name === name || x.id === name); return f ? f.id : "none"; };

  AA4.CARD_TYPES = ["Character", "Break", "Permanent", "Fast", "Project"];
  /** Card piles of one player (always the OWNER's piles — a card never goes to another player's pile). */
  AA4.PILES = ["deck", "hand", "discard", "damage", "removed"];
  /** Other card containers of one player: Special Area (Fast / Project in use), Cost screen, declared cards. */
  AA4.HOLDERS = ["special", "cost", "declared"];
  AA4.ZONES = AA4.PILES.concat(AA4.HOLDERS);
  /** Character areas (Revise#006): Active (6 faction slots), Control Area Front / Back. */
  AA4.AREAS = ["active", "front", "back"];
  /** Parts of a character (Revise#001): stack = Character card + Break cards; power cards; permanents. */
  AA4.ROLES = ["stack", "power", "perm"];

  AA4.PHASES = ["draw", "active", "main", "charge", "discard"];
  AA4.PHASE_NAMES = { draw: "Draw Phase", active: "Active Phase", main: "Main Phase", charge: "Charge Phase", discard: "Discard Phase" };   // Revise#041

  AA4.START_HAND = 7;
  AA4.HAND_LIMIT = 7;
  AA4.LOSE_DAMAGE = 10;
  AA4.MIN_SEATS = 2;
  AA4.MAX_SEATS = 4;
  AA4.MAX_DECK = 1000;   // sanity limit only (Revise#211: the Deck Builder has no limit)

  /* ---------- seeded random (§20.2 "rng: seed + counter") ----------
     The state only holds {s, n}: a 32-bit seed and how many numbers were used.
     Number n is a pure function of (s, n), so every device gets the same
     shuffle from the same log, and undo simply replays fewer draws. */
  function mix32(a) {   // splitmix32 finaliser
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16); t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15; t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  }
  /** Text seed → 32-bit number (FNV-1a, then mixed). */
  AA4.seedOf = text => {
    let h = 0x811c9dc5;
    for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193); }
    return mix32(h >>> 0);
  };
  AA4.rand32 = (s, n) => mix32((mix32((s ^ Math.imul(n + 1, 0x85ebca6b)) >>> 0) ^ s) >>> 0);
  /** Next random number in [0, 1) from the state's generator (advances the counter). */
  AA4.random = S => AA4.rand32(S.rng.s, S.rng.n++) / 4294967296;
  AA4.randInt = (S, k) => Math.floor(AA4.random(S) * k);
  /** Fisher–Yates shuffle in place with the state's generator. */
  AA4.shuffleInPlace = (S, a) => {
    for (let i = a.length - 1; i > 0; i--) { const j = AA4.randInt(S, i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  };
  /** A fresh random seed for a new room (not part of the rules; only used when creating). */
  AA4.newSeed = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

  /* ---------- registries filled by the later files (13-events.js runs them) ---------- */
  AA4.FLOW = [];          // fn(ctx) → true when it queued something (resolve when all passed, battle steps, faction check)
  AA4.STATE_CHECKS = [];  // fn(ctx) → true when it queued something (Defense ≤ 0, lose conditions)

  /* ---------- helpers ---------- */
  AA4.clone = typeof structuredClone === "function" ? x => structuredClone(x) : x => JSON.parse(JSON.stringify(x));
  AA4.isInt = v => Number.isInteger(v);
  /** Error thrown in debug / test mode when an invariant breaks (see 05-invariants.js). */
  class InvariantError extends Error {
    constructor(problems, where) { super(`Invariant broken${where ? " after " + where : ""}: ` + problems.join("; ")); this.problems = problems; }
  }
  AA4.InvariantError = InvariantError;
})(typeof globalThis !== "undefined" ? globalThis : window);
