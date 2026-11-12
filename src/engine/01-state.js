/* ==========================================================================
   v4 engine · state (requirements_v4 §20.2)

   One plain JSON object, saved and replayed. Nothing else holds game data.

   S = {
     schema, version            schema number; version +1 after every accepted intent (cache key, §20.4)
     stage                      "lobby" → "mulligan" → "play" → "over"
     mode                       "online" | "solo1" (one deck, every turn yours) | "solo2" (two decks, one person)
     seatsWanted, creator       seats of the room (1–4), cid of whoever created it
     seed, rng: {s, n}          seeded random (00-base.js)
     rules                      game rules chosen when creating (powerFaceUp, goSecond, autoSkip, autoPay)
     players: [               one per seat, in join order
       { seat, cid, name, deckName, sleeve, deckSize, ready, mulligans, lost,
         zones: { deck, hand, discard, damage, removed, special, cost, declared },   arrays of card ids, LAST = TOP
         areas: { active: { ego: [], …, none: [] }, front: [], back: [] } } ]        arrays of character ids
     spectators: { cid: name }
     cards: { id: { id, key, owner, place, faceUp, visibleTo: [seats] } }
     chars: { id: { id, owner, at: {area, slot}, stack: [card ids], power: [], perm: [], flags: {tapped, attacks} } }
     next: { ch }               counter for character ids
     turn: { order: [seats], player, phase, step, number, removed: [seats] }
      stack: [items]             Resolve list, newest LAST (declarations: set / effect / guard …, triggered abilities)
     passed: [seats]            who passed since the Resolve list last changed (Resolve System, Revise#034)
     draft                      the declaration being made: choose → pay → target (11-declare.js)
     battle                     the attack going on (12-battle.js), or null
     triggers                   triggered abilities waiting for Run / Skip (13-events.js)
     decisions                  pending choices (Event System, 13-events.js)
     modifiers                  continuous effects (10-query.js)
     queue                      operations still to run (02-ops.js)
     losers, winner             players who lost (in order), the last player standing
   }

   A card's place (exactly one, mirrored by the container that lists it):
     { z: "deck"|"hand"|"discard"|"damage"|"removed"|"special"|"cost"|"declared", seat }
     { z: "char", ch, role: "stack"|"power"|"perm" }
   Order inside every container: index 0 = bottom, last = top (deck top = last).
   ========================================================================== */
(function (G) {
  "use strict";
  const AA4 = G.AA4;

  AA4.newState = () => ({
    schema: 1, version: 0, stage: "lobby", mode: null, seatsWanted: 0, creator: null,
    seed: "", rng: { s: 0, n: 0 }, rules: { powerFaceUp: false, respond: "order", goSecond: false, autoSkip: false, autoPay: false, situation: false }, situation: null, sitDecl: null,
    players: [], spectators: {}, cards: {}, chars: {}, next: { ch: 1 },
    turn: { order: [], player: -1, phase: null, step: null, number: 0, removed: [] },
    stack: [], passed: [], draft: null, battle: null, triggers: [], decisions: [], modifiers: [], queue: [],
    seq: 1, losers: [], winner: null, pendingPower: [],   // pendingPower: [{card, ch, fromDeck, seat}] charged this Charge Phase, set when it ends
  });

  AA4.newPlayer = (seat, cid, name, deckName, sleeve) => ({
    seat, cid, name, deckName: deckName || "", sleeve: sleeve || null, deckSize: 0, ready: false, mulligans: 0, lost: false,
    hold: true,                              // Hold ON: this player passes before anything resolves (Q#09)
    holds: Object.assign({ aggressive: false, battle: true, project: true, fast: true, effect: true, break: false, undo: true }, AA4.HOLD_DEFAULT || {}),   // per type (Pack, Revise#168): AA4.HOLD_TYPES; default = AA4.HOLD_DEFAULT (Pack, Revise#205)
    turnFlags: { turn: 0, deckCharged: 0, searched: 0, declared: false },   // reset at the start of each of this player's turns
    zones: Object.fromEntries(AA4.ZONES.map(z => [z, []])),
    areas: { active: Object.fromEntries(AA4.SLOTS.map(s => [s, []])), front: [], back: [] },
  });

  /* ---------- lookups ---------- */
  /** The array that holds a place (card container). */
  AA4.containerOf = (S, place) => {
    if (place.z === "char") { const ch = S.chars[place.ch]; return ch ? ch[place.role] : null; }
    const p = S.players[place.seat];
    return p ? p.zones[place.z] : null;
  };
  /** The array that holds a character (its area list / active slot). */
  AA4.charListOf = (S, owner, at) => {
    const p = S.players[owner];
    if (!p) return null;
    return at.area === "active" ? p.areas.active[at.slot] : p.areas[at.area];
  };
  AA4.samePlace = (a, b) => !!a && !!b && a.z === b.z && (a.z === "char" ? a.ch === b.ch && a.role === b.role : a.seat === b.seat);
  /** The seat a place belongs to (pile owner, or the owner of the character). */
  AA4.seatOfPlace = (S, place) => (place.z === "char" ? (S.chars[place.ch] || {}).owner : place.seat);
  /** Top card of a character = the card that gives it its name / stats. */
  AA4.topOf = ch => ch.stack[ch.stack.length - 1];
  AA4.baseOf = ch => ch.stack[0];
  /** All character ids of one player, in area order (active slots bottom → top, front, back). */
  AA4.charsOf = (S, seat) => {
    const p = S.players[seat];
    if (!p) return [];
    return AA4.SLOTS.flatMap(s => p.areas.active[s]).concat(p.areas.front, p.areas.back);
  };
  /** The Active Character of a faction slot (top of the party), or null. */
  AA4.activeCharOf = (S, seat, slot) => { const l = S.players[seat].areas.active[slot]; return l.length ? l[l.length - 1] : null; };
  AA4.isControlled = ch => ch.at.area === "front" || ch.at.area === "back";

  /** Seats a client controls (solo2: one client, two seats). */
  AA4.seatsOfCid = (S, cid) => S.players.filter(p => p.cid === cid).map(p => p.seat);
  /** The seat an intent acts for: intent.seat if given (must be controlled by intent.by), else the only seat of that client. */
  AA4.seatFor = (S, intent) => {
    const mine = AA4.seatsOfCid(S, intent.by);
    if (intent.seat != null) return mine.includes(intent.seat) ? intent.seat : null;
    return mine.length === 1 ? mine[0] : null;
  };

  /** A new id for stack items, decisions, modifiers (deterministic: a counter in the state). */
  AA4.newId = (S, prefix) => prefix + S.seq++;
  /** Seats still in the game, in turn order starting with the turn player. */
  AA4.livingOrder = S => {
    const o = S.turn.order, i = o.indexOf(S.turn.player);
    return (i < 0 ? o : o.slice(i).concat(o.slice(0, i))).filter(s => !S.players[s].lost);
  };
  /** The character a card is part of (stack / power / permanent), or null. */
  AA4.charOfCard = (S, id) => { const c = S.cards[id]; return c && c.place.z === "char" ? S.chars[c.place.ch] : null; };
  /** Is a card on the field (part of a character or in a Special Area)? */
  AA4.onField = (S, id) => { const c = S.cards[id]; return !!c && (c.place.z === "char" || c.place.z === "special"); };

  /** Card info from the injected database (08-db.js): {key, type, faction, jp, en}. */
  AA4.infoOf = (db, S, id) => { const c = S.cards[id]; return c && db ? db.card(c.key) : null; };
})(typeof globalThis !== "undefined" ? globalThis : window);
