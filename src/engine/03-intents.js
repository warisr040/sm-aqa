/* ==========================================================================
   v4 engine · intents and the action pipeline (requirements_v4 §20.3)

   An intent is what a player asks for, as plain JSON:
     { t: "move", by: "<client id>", seat?: 0, card: "0-12", to: { z: "discard" } }
   by   = the client (browser) that sent it; seat = which of its seats (only needed in Solo two-deck).

   Pipeline:  intent → check() → apply (queue operations) → runQueue() → (state check: B4)
              → game events → (triggers: B5)
   check() is the ONLY answer to "may I do this?" — the UI asks legalActions()
   (built on check()) for highlights and greyed buttons with the reason, and
   the engine refuses the same intents online. A refused intent changes nothing.

   Intents of B1
     create   {seed, mode: online|solo1|solo2, seats, rules}   first entry of every log
     join     {name, deckName, deck: [card keys], sleeve}      take the next seat
     watch    {name}                                           spectator
     start    {}                                               creator starts with the players present (≥ 2)
     mulligan {} / keep {}                                     opening hand
     move     {card, to, vis?}                                 by hand: a card to a pile / Special Area / new character / onto a character
     moveChar {ch, to: {area, slot?, index?}}                  by hand: a whole character
     shuffle  {}  draw {n}                                     by hand
     chat     {text}  rename {name}
   Declarations, phases, battle … come in B2–B6 as more intents on the same pipeline.
   ========================================================================== */
(function (G) {
  "use strict";
  const AA4 = G.AA4;
  const INTENTS = (AA4.INTENTS = {});

  /** Context passed to checks / operations. */
  AA4.makeCtx = (S, db, opts = {}) => {
    const events = [];
    return { S, db, debug: opts.debug || false, events, emit: e => events.push(e) };
  };

  /** Who acts: the seat, or a reason why the client can't act for a seat. */
  function actor(S, it) {
    if (typeof it.by !== "string" || !it.by) return { why: "No player id" };
    const seat = AA4.seatFor(S, it);
    if (seat == null) return { why: AA4.seatsOfCid(S, it.by).length > 1 ? "Say which seat" : "You are not playing at this table" };
    return { seat, p: S.players[seat] };
  }
  const playing = S => (S.stage === "play" ? null : S.stage === "over" ? "The game is over" : "The game has not started yet");
  /** Player image (Pack, Revise#214): one of the 6 defaults ("p1" … "p6"), or an image the player uploaded, made small on their device. */
  AA4.AVATARS = ["p1", "p2", "p3", "p4", "p5", "p6"];
  AA4.avatarOk = v => typeof v === "string" && (AA4.AVATARS.includes(v) || (v.length <= 160000 && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v)));
  const cleanName = v => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, 20);

  /* ---------- room ---------- */
  INTENTS.create = {
    check(ctx, it) {
      const S = ctx.S;
      if (S.mode) return "The room already exists";
      if (typeof it.seed !== "string" || !it.seed || it.seed.length > 64) return "A seed (1–64 characters) is needed";
      if (!["online", "solo1", "solo2"].includes(it.mode)) return "Unknown mode";
      const seats = it.mode === "solo1" ? 1 : it.mode === "solo2" ? 2 : it.seats;
      if (it.mode === "online" && !(AA4.isInt(seats) && seats >= AA4.MIN_SEATS && seats <= AA4.MAX_SEATS)) return "Seats: 2 to 4";
      return null;
    },
    apply(ctx, it) {
      const S = ctx.S, r = it.rules || {};
      S.mode = it.mode; S.creator = it.by; S.seed = it.seed;
      S.seatsWanted = it.mode === "solo1" ? 1 : it.mode === "solo2" ? 2 : it.seats;
      S.rng = { s: AA4.seedOf(it.seed), n: 0 };
      S.rules = { powerFaceUp: false, respond: r.respond === "together" ? "together" : "order", goSecond: it.mode === "solo1" && !!r.goSecond, mullMain: !!r.mullMain, firstSeat: it.mode === "solo2" && (r.firstSeat === 0 || r.firstSeat === 1) ? r.firstSeat : null, autoSkip: !!r.autoSkip, autoPay: !!r.autoPay, situation: !!r.situation, globalUndo: !!r.globalUndo };   // the table sends it ON by default (Pack, Revise#225)
      S.situation = r.situation ? "building" : null;   // Game Situation (Pack, Revise#169): a shared Hold setting, chosen before the room is created
      ctx.emit({ e: "created", mode: S.mode, seats: S.seatsWanted });
    },
  };

  INTENTS.join = {
    check(ctx, it) {
      const S = ctx.S;
      if (!S.mode) return "No room yet";
      if (S.stage !== "lobby") return "The game has already started — you can watch";
      if (typeof it.by !== "string" || !it.by) return "No player id";
      if (S.mode !== "online" && it.by !== S.creator) return "Only the creator plays in Solo";
      if (S.mode === "online" && AA4.seatsOfCid(S, it.by).length) return "You already have a seat";
      if (S.players.length >= S.seatsWanted) return "The table is full — you can watch";
      if (!cleanName(it.name)) return "A name is needed";
      if (!Array.isArray(it.deck) || !it.deck.length) return "Choose a deck with cards in it";
      if (it.avatar != null && !AA4.avatarOk(it.avatar)) return "The Player image is not usable (a default one, or a JPEG / PNG up to 120 KB)";
      if (it.deck.length > AA4.MAX_DECK) return `A deck can't have more than ${AA4.MAX_DECK} cards`;
      for (const k of it.deck) {
        const c = ctx.db && ctx.db.card(k);
        if (!c) return `Unknown card ${k}`;
        if (!AA4.CARD_TYPES.includes(c.type)) return `${k} is not a playable card (${c.type})`;
      }
      return null;
    },
    apply(ctx, it) {
      const S = ctx.S, seat = S.players.length;
      const p = AA4.newPlayer(seat, it.by, cleanName(it.name), String(it.deckName || "").slice(0, 40),
        it.sleeve && typeof it.sleeve === "object" ? it.sleeve : null);
      if (it.avatar != null && AA4.avatarOk(it.avatar)) p.avatar = it.avatar;   // the Player image (Pack, Revise#214): "p1" … "p6" or a small data URL
      S.players.push(p);
      it.deck.forEach((k, i) => {
        const id = `${seat}-${i}`;
        S.cards[id] = { id, key: ctx.db.card(k).key, owner: seat, place: { z: "deck", seat }, faceUp: false, visibleTo: [] };
        p.zones.deck.push(id);
      });
      p.deckSize = it.deck.length;
      delete S.spectators[it.by];
      ctx.emit({ e: "joined", seat, cid: it.by, name: p.name, deckName: p.deckName, cards: p.deckSize });
      if (S.players.length === S.seatsWanted) AA4.enqueue(S, [{ op: "startGame" }]);   // all seats filled → start (Revise#052)
    },
  };

  /** When an intent was sent: its ts, or the time in its entry id (base 36 ms). */
  AA4.tsOf = it => (typeof it.ts === "number" ? it.ts : typeof it.id === "string" && it.id.length >= 9 ? parseInt(it.id.slice(0, 9), 36) || null : null);
  AA4.TAKE_AFTER = 30000;
  /** The seat the game waits for now (a choice, a declaration in progress, a trigger, the guard, priority, else the turn player). */
  AA4.actingSeat = S => {
    if (S.decisions.length) return S.decisions[0].seat;
    if (S.draft) return S.draft.seat;
    if (S.triggers.length) return S.triggers[0].seat;
    if (S.battle && S.battle.step === "guard") return S.battle.defender;
    const now = AA4.priorityNow ? AA4.priorityNow(S) : null;
    return now != null ? now : S.turn.player;
  };
  /** Take control (Pack, Revise#117): a watcher takes the seat of the player the game has waited for 30 s or more.
      The first one wins; the 30 s start again from it, so a second watcher right after is refused. */
  INTENTS.takeControl = {
    check(ctx, it) {
      const S = ctx.S, ts = AA4.tsOf(it);
      if (S.mode !== "online") return "Only in an online game";
      if (S.stage !== "play") return "The game is not running";
      if (typeof it.by !== "string" || !it.by) return "No player id";
      const seat = AA4.actingSeat(S);
      if (seat == null || !S.players[seat] || S.players[seat].lost) return "Nobody to take over";
      if (S.players[seat].cid === it.by) return "You already control that player";   // a watcher or another player may take it (Pack, Revise#128)
      if (it.seat != null && it.seat !== seat) return "That player is not the one the game waits for";
      if (ts == null || S.lastTs == null || ts - S.lastTs < AA4.TAKE_AFTER) return `Only after ${AA4.TAKE_AFTER / 1000} s without a command`;
      return null;
    },
    apply(ctx, it) {
      const S = ctx.S, seat = AA4.actingSeat(S), p = S.players[seat], old = p.cid;
      const nm = S.spectators[it.by] || (S.players.find(q => q.cid === it.by) || {}).name;
      p.cid = it.by;
      if (!AA4.seatsOfCid(S, old).length) S.spectators[old] = p.name;   // the old player watches (unless they still play another seat)
      delete S.spectators[it.by];
      ctx.emit({ e: "tookControl", seat, cid: it.by, from: old, name: nm || "A watcher" });
    },
  };
  INTENTS.watch = {
    check(ctx, it) {
      if (typeof it.by !== "string" || !it.by) return "No player id";
      if (AA4.seatsOfCid(ctx.S, it.by).length) return "You are playing";
      return null;
    },
    apply(ctx, it) { ctx.S.spectators[it.by] = cleanName(it.name) || "Someone"; ctx.emit({ e: "watching", cid: it.by, name: ctx.S.spectators[it.by] }); },
  };

  INTENTS.start = {
    check(ctx, it) {
      const S = ctx.S;
      if (S.stage !== "lobby" || !S.mode) return "Nothing to start";
      if (it.by !== S.creator) return "Only the room creator can start";
      if (S.players.length < (S.mode === "online" ? AA4.MIN_SEATS : S.seatsWanted)) return `At least ${S.mode === "online" ? AA4.MIN_SEATS : S.seatsWanted} players are needed`;
      return null;
    },
    apply(ctx) { AA4.enqueue(ctx.S, [{ op: "startGame" }]); },
  };

  /* ---------- opening hand ---------- */
  const opening = (ctx, it) => {
    if (ctx.S.stage !== "mulligan") return "Only before the first turn";
    const a = actor(ctx.S, it);
    if (a.why) return a.why;
    return a.p.ready ? "You already kept your hand" : null;
  };
  INTENTS.mulligan = { check: opening, apply(ctx, it) { AA4.enqueue(ctx.S, [{ op: "mulligan", seat: AA4.seatFor(ctx.S, it) }]); } };
  INTENTS.autoMulligan = { check: opening, apply(ctx, it) { AA4.enqueue(ctx.S, [{ op: "autoMulligan", seat: AA4.seatFor(ctx.S, it) }]); } };   // Pack (Revise#234)
  INTENTS.keep = { check: opening, apply(ctx, it) { AA4.enqueue(ctx.S, [{ op: "keep", seat: AA4.seatFor(ctx.S, it) }]); } };

  /* ---------- by-hand tools ---------- */
  /** May this seat move this card by hand? Own cards only, not inside another player's character. */
  function ownCard(S, seat, id) {
    const c = S.cards[id];
    if (!c) return "No such card";
    if (c.owner !== seat) return "Not your card";
    if (c.place.z === "char" && S.chars[c.place.ch].owner !== seat) return "That card is on another player's character";
    if (c.place.z === "cost" || c.place.z === "declared") return "That card is being used — finish the declaration first";
    return null;
  }

  /** Where a card may be moved by hand. Each entry is a ready `to` for a move intent. */
  AA4.moveDestinations = (S, db, seat, id) => {
    if (ownCard(S, seat, id)) return [];
    const c = S.cards[id], info = db.card(c.key), type = info ? info.type : "", out = [];
    const here = c.place;
    for (const z of AA4.PILES) {
      if (z === "deck") { out.push({ z: "deck" }, { z: "deck", pos: "bottom" }); continue; }
      if (here.z !== z) out.push({ z });
    }
    if ((type === "Fast" || type === "Project") && here.z !== "special") out.push({ z: "special" });
    const soleBase = here.z === "char" && here.role === "stack" && S.chars[here.ch].stack.length === 1;
    if (!soleBase) {
      if (type === "Character") out.push({ z: "active" }, { z: "front" }, { z: "back" });
      if (type === "Break") out.push({ z: "front" });   // Break set directly to the field (Revise#017 / #065)
    }
    for (const chId of AA4.charsOf(S, seat)) {
      if (here.z === "char" && here.ch === chId) continue;
      if (type === "Break") out.push({ z: "char", ch: chId, role: "stack" });
      if (type === "Permanent") out.push({ z: "char", ch: chId, role: "perm" });
      out.push({ z: "char", ch: chId, role: "power" });
    }
    return out;
  };
  /** Same destination (position inside a pile and slot / index inside an area are checked separately). */
  const sameTo = (a, b) => a.z === b.z && (a.ch || null) === (b.ch || null) && (a.role || null) === (b.role || null);

  INTENTS.move = {
    undoable: true,
    check(ctx, it) {
      const S = ctx.S, why = playing(S);
      if (why) return why;
      const a = actor(S, it);
      if (a.why) return a.why;
      const own = ownCard(S, a.seat, it.card);
      if (own) return own;
      const to = it.to || {};
      if (to.z === "active" && to.slot != null && !AA4.SLOTS.includes(to.slot)) return "Unknown faction slot";
      if (to.pos != null && to.pos !== "top" && to.pos !== "bottom" && !AA4.isInt(to.pos)) return "Unknown position";
      if (to.index != null && !AA4.isInt(to.index)) return "Unknown position";
      return AA4.moveDestinations(S, ctx.db, a.seat, it.card).some(d => sameTo(d, to)) ? null : "The card can't go there";
    },
    apply(ctx, it) {
      const to = Object.assign({}, it.to);
      const vis = it.vis && typeof it.vis === "object" ? { faceUp: !!it.vis.faceUp, visibleTo: Array.isArray(it.vis.visibleTo) ? it.vis.visibleTo.filter(AA4.isInt) : [] } : undefined;
      AA4.enqueue(ctx.S, [{ op: "move", card: it.card, to, vis, byHand: true }]);
    },
  };

  /** Where a character may be moved by hand. */
  AA4.charDestinations = (S, db, seat, chId) => {
    const ch = S.chars[chId];
    if (!ch || ch.owner !== seat) return [];
    const out = [];
    if (ch.at.area !== "active") out.push({ area: "active" });
    if (ch.at.area !== "front") out.push({ area: "front" });
    if (ch.at.area !== "back") out.push({ area: "back" });
    return out;
  };
  INTENTS.moveChar = {
    undoable: true,
    check(ctx, it) {
      const S = ctx.S, why = playing(S);
      if (why) return why;
      const a = actor(S, it);
      if (a.why) return a.why;
      const ch = S.chars[it.ch];
      if (!ch) return "No such character";
      if (ch.owner !== a.seat) return "Not your character";
      const to = it.to || {};
      if (!AA4.AREAS.includes(to.area)) return "Unknown area";
      if (to.slot != null && (to.area !== "active" || !AA4.SLOTS.includes(to.slot))) return "Unknown faction slot";
      if (to.index != null && !AA4.isInt(to.index)) return "Unknown position";
      if (to.sec != null && (to.area !== "front" || !AA4.FRONT_SECS.includes(to.sec))) return "Unknown Control Front section";
      if (to.area === ch.at.area && to.area === "active" && (to.slot == null || to.slot === ch.at.slot)) return "It is already there";
      return null;
    },
    apply(ctx, it) { AA4.enqueue(ctx.S, [{ op: "moveChar", ch: it.ch, to: Object.assign({}, it.to) }]); },
  };

  /** Sort hand (Pack, Revise#336): {order: [card ids]} — exactly the cards of your own hand, in a new order. Nothing is revealed. */
  INTENTS.sortHand = {
    undoable: true,
    check(ctx, it) {
      const S = ctx.S;
      if (S.stage !== "play" && S.stage !== "mulligan") return S.stage === "over" ? "The game is over" : "The game has not started yet";
      const a = actor(S, it);
      if (a.why) return a.why;
      const want = S.players[a.seat].zones.hand, got = Array.isArray(it.order) ? it.order : [];
      if (got.length !== want.length || new Set(got).size !== got.length || got.some(id => !want.includes(id))) return "Sort the cards of your own hand";
      return null;
    },
    apply(ctx, it) { const seat = AA4.seatFor(ctx.S, it); AA4.enqueue(ctx.S, [{ op: "sortHand", seat, order: it.order.slice() }]); },
  };

  /** Sort button (Revise#098): {area: "front" | "back", sec?, order: [character ids]} — exactly that section's characters, any order. */
  INTENTS.sortChars = {
    undoable: true,
    check(ctx, it) {
      const S = ctx.S, why = playing(S);
      if (why) return why;
      const a = actor(S, it);
      if (a.why) return a.why;
      if (!["front", "back"].includes(it.area)) return "Sort works in the Control Area";
      if (it.sec != null && (it.area !== "front" || !AA4.FRONT_SECS.includes(it.sec))) return "Unknown Control Front section";
      const whole = S.players[a.seat].areas[it.area].filter(id => S.chars[id]);
      let want = whole.filter(id => it.area !== "front" || AA4.secOf(S.chars[id]) === (it.sec || "center"));
      const got = Array.isArray(it.order) ? it.order : [];
      if (it.area === "front" && it.sec == null && got.length === whole.length) want = whole;   // Revise#403: the Front is one area — its whole list may be sorted (the centre alone still works for older games)
      if (got.length !== want.length || new Set(got).size !== got.length || got.some(id => !want.includes(id))) return "Sort the characters of that section";
      return null;
    },
    apply(ctx, it) { const seat = AA4.seatFor(ctx.S, it); AA4.enqueue(ctx.S, [{ op: "sortChars", seat, area: it.area, sec: it.sec || null, order: it.order.slice() }]); },
  };

  INTENTS.shuffle = {
    undoable: true,
    check(ctx, it) { const why = playing(ctx.S); if (why) return why; const a = actor(ctx.S, it); return a.why || null; },
    apply(ctx, it) { AA4.enqueue(ctx.S, [{ op: "shuffle", seat: AA4.seatFor(ctx.S, it) }]); },
  };
  INTENTS.draw = {
    undoable: true,
    check(ctx, it) {
      const why = playing(ctx.S); if (why) return why;
      const a = actor(ctx.S, it); if (a.why) return a.why;
      const n = it.n == null ? 1 : it.n;
      return AA4.isInt(n) && n >= 1 && n <= 20 ? null : "Draw 1 to 20 cards";
    },
    apply(ctx, it) { AA4.enqueue(ctx.S, [{ op: "draw", seat: AA4.seatFor(ctx.S, it), n: it.n == null ? 1 : it.n }]); },
  };

  /* ---------- talk ---------- */
  INTENTS.chat = {
    check(ctx, it) {
      if (typeof it.by !== "string" || !it.by) return "No player id";
      return String(it.text || "").trim() ? null : "Nothing to say";
    },
    apply(ctx, it) {
      const seat = AA4.seatFor(ctx.S, it);
      ctx.emit({ e: "chat", seat: seat == null ? -1 : seat, cid: it.by, text: String(it.text).trim().slice(0, 300) });
    },
  };
  INTENTS.rename = {
    check(ctx, it) {
      const a = actor(ctx.S, it); if (a.why) return a.why;
      const nm = cleanName(it.name);
      return !nm ? "A name is needed" : nm === a.p.name ? "That is already the name" : null;
    },
    apply(ctx, it) {
      const p = ctx.S.players[AA4.seatFor(ctx.S, it)], from = p.name;
      p.name = cleanName(it.name);
      ctx.emit({ e: "renamed", seat: p.seat, cid: it.by, from, name: p.name });
    },
  };

  /* ---------- pipeline ---------- */
  /** May this intent be done now? null = yes, otherwise the reason shown to the player. */
  AA4.check = (S, intent, db) => {
    const h = intent && INTENTS[intent.t];
    if (!h) return "Unknown action";
    return h.check(AA4.makeCtx(S, db), intent);
  };

  /** Apply one intent to S IN PLACE. Returns {ok, reason?, events}. (Use AA4.apply for a pure version.) */
  AA4.step = (S, intent, db, opts = {}) => {
    const h = intent && INTENTS[intent.t];
    if (!h) return { ok: false, reason: "Unknown action", events: [] };
    const ctx = AA4.makeCtx(S, db, opts);
    AA4.touch(S);
    const why = h.check(ctx, intent);
    if (why) return { ok: false, reason: why, events: [] };
    // A choice is waiting (e.g. the Discard Phase discard): what was queued behind it (end of the phase …) must wait for the
    // answer — another action meanwhile (by hand, Pack) runs on its own and leaves the phase, Resolve list and timing as they are.
    const held = intent.t !== "choose" && S.decisions.length ? S.queue.splice(0) : null;
    h.apply(ctx, intent);
    AA4.touch(S);
    AA4.advance(ctx);
    if (held) {
      S.queue = S.queue.concat(held);
      // a choice that depends on what changed (the discard down to the hand limit): asked again with the cards now in hand
      const redo = S.decisions.filter(d => d.ref && d.ref.redo);
      if (redo.length) {
        S.decisions = S.decisions.filter(d => !redo.includes(d));
        S.queue = redo.map(d => ({ op: d.ref.redo })).concat(S.queue);
        AA4.touch(S); AA4.advance(ctx);
      }
    }
    const ts = AA4.tsOf(intent);
    if (ts != null && !["chat", "watch"].includes(intent.t)) S.lastTs = ts;   // the last command (Take control counts 30 s from it — Pack, Revise#117)
    S.version++;
    if (opts.debug) AA4.assertInvariants(S, db, `intent ${intent.t}`);
    return { ok: true, events: ctx.events };
  };
  /** Pure: state + intent → {state (new object), ok, reason, events}. */
  AA4.apply = (S, intent, db, opts) => { const N = AA4.clone(S); const r = AA4.step(N, intent, db, opts); return Object.assign({ state: r.ok ? N : S }, r); };

  /** Undo is allowed for these (only your own latest action, while nobody else has acted since — 04-log.js). */
  AA4.isUndoable = t => !!(INTENTS[t] && INTENTS[t].undoable);

  /** What one seat (of client `by`) may do now: [{t, ok, reason?, ...}]. Card / character moves list what can move. */
  AA4.legalActions = (S, db, by, seat) => {
    const base = { by, seat }, out = [];
    const add = (t, extra = {}) => { const it = Object.assign({ t }, base, extra), why = AA4.check(S, it, db); out.push(Object.assign({ t, ok: !why }, why ? { reason: why } : {}, extra)); };
    if (S.stage === "lobby") { add("start"); return out; }
    if (S.stage === "mulligan") { add("mulligan"); add("autoMulligan"); add("keep"); return out; }
    if (S.stage !== "play") return out;
    add("shuffle"); add("draw", { n: 1 });
    const cards = Object.values(S.cards).filter(c => !ownCard(S, seat, c.id) && AA4.moveDestinations(S, db, seat, c.id).length).map(c => c.id);
    out.push({ t: "move", ok: cards.length > 0, cards });
    const chars = AA4.charsOf(S, seat).filter(ch => AA4.charDestinations(S, db, seat, ch).length);
    out.push({ t: "moveChar", ok: chars.length > 0, chars });
    return out;
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
