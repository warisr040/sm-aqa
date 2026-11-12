/* ==========================================================================
   v4 engine · invariants (requirements_v4 §20.2)

   Checked after every intent (debug: true) or after every single operation
   (debug: "ops") in tests / debug mode. Any problem throws AA4.InvariantError,
   so a rules bug shows up at the step that caused it, not many turns later.

   1. every card is in exactly one container, and its `place` points there
   2. every player still owns exactly the cards of the deck they joined with
   3. cards in piles (deck / hand / discard / damage / removed) are in their OWNER's piles
   4. every character has at least one card in its stack (no character without a base card),
      is listed in exactly one area of its owner, and its `at` matches that list
   5. visibility fields are well formed; turn / seat data is consistent; the random counter is sane
   ========================================================================== */
(function (G) {
  "use strict";
  const AA4 = G.AA4;

  AA4.invariants = (S, db) => {
    const bad = [], seen = new Map();   // card id → where it was found
    const note = (id, where) => {
      if (seen.has(id)) bad.push(`card ${id} is in two places (${seen.get(id)} and ${where})`);
      else seen.set(id, where);
    };
    const seats = S.players.map(p => p.seat);
    S.players.forEach((p, i) => { if (p.seat !== i) bad.push(`player ${i} has seat ${p.seat}`); });

    // 1 + 3: piles and holders
    for (const p of S.players) {
      for (const z of AA4.ZONES) {
        const list = p.zones[z];
        if (!Array.isArray(list)) { bad.push(`seat ${p.seat} has no ${z}`); continue; }
        for (const id of list) {
          note(id, `${z} of seat ${p.seat}`);
          const c = S.cards[id];
          if (!c) { bad.push(`${z} of seat ${p.seat} lists unknown card ${id}`); continue; }
          if (c.place.z !== z || c.place.seat !== p.seat) bad.push(`card ${id} says ${JSON.stringify(c.place)} but is in ${z} of seat ${p.seat}`);
          if (AA4.PILES.includes(z) && c.owner !== p.seat) bad.push(`card ${id} of seat ${c.owner} is in the ${z} of seat ${p.seat}`);
        }
      }
    }
    // 4: characters
    const listed = new Map();
    for (const p of S.players) {
      for (const area of AA4.AREAS) {
        const lists = area === "active" ? AA4.SLOTS.map(s => [s, p.areas.active[s]]) : [[undefined, p.areas[area]]];
        for (const [slot, list] of lists) {
          if (!Array.isArray(list)) { bad.push(`seat ${p.seat} has no ${area}${slot ? " " + slot : ""}`); continue; }
          for (const chId of list) {
            if (listed.has(chId)) bad.push(`character ${chId} is listed twice`);
            listed.set(chId, true);
            const ch = S.chars[chId];
            if (!ch) { bad.push(`${area} of seat ${p.seat} lists unknown character ${chId}`); continue; }
            if (ch.owner !== p.seat) bad.push(`character ${chId} of seat ${ch.owner} is in the area of seat ${p.seat}`);
            if (ch.at.area !== area || (area === "active" && ch.at.slot !== slot)) bad.push(`character ${chId} says ${JSON.stringify(ch.at)} but is in ${area}${slot ? " " + slot : ""}`);
          }
        }
      }
    }
    for (const ch of Object.values(S.chars)) {
      if (!listed.has(ch.id)) bad.push(`character ${ch.id} is in no area`);
      if (!ch.stack.length) bad.push(`character ${ch.id} has no card`);
      for (const role of AA4.ROLES) for (const id of ch[role]) {
        note(id, `${role} of ${ch.id}`);
        const c = S.cards[id];
        if (!c) { bad.push(`${ch.id} lists unknown card ${id}`); continue; }
        if (c.place.z !== "char" || c.place.ch !== ch.id || c.place.role !== role) bad.push(`card ${id} says ${JSON.stringify(c.place)} but is in ${role} of ${ch.id}`);
      }
    }
    // 1 + 2: every card somewhere; card counts match the decks
    const count = {};
    for (const c of Object.values(S.cards)) {
      if (!seen.has(c.id)) bad.push(`card ${c.id} is nowhere`);
      count[c.owner] = (count[c.owner] || 0) + 1;
      if (typeof c.faceUp !== "boolean" || !Array.isArray(c.visibleTo) || c.visibleTo.some(s => !seats.includes(s))) bad.push(`card ${c.id} has bad visibility`);
      if (db && !db.card(c.key)) bad.push(`card ${c.id} has unknown key ${c.key}`);
    }
    for (const id of seen.keys()) if (!S.cards[id]) bad.push(`unknown card ${id}`);
    for (const p of S.players) if ((count[p.seat] || 0) !== p.deckSize) bad.push(`seat ${p.seat} has ${count[p.seat] || 0} cards, joined with ${p.deckSize}`);
    // 5: turn and random
    if (!AA4.isInt(S.rng.n) || S.rng.n < 0) bad.push("random counter is broken");
    if (S.stage === "mulligan" || S.stage === "play") {
      const order = S.turn.order;
      if (order.length !== S.players.length || [...new Set(order)].length !== order.length || order.some(s => !seats.includes(s))) bad.push(`turn order ${JSON.stringify(order)} doesn't match the seats`);
    }
    if (S.stage === "play") {
      if (!S.turn.order.includes(S.turn.player)) bad.push(`turn player ${S.turn.player} is not in the turn order`);
      if (!AA4.PHASES.includes(S.turn.phase)) bad.push(`unknown phase ${S.turn.phase}`);
    }
    return bad;
  };

  AA4.assertInvariants = (S, db, where) => {
    const bad = AA4.invariants(S, db);
    if (bad.length) throw new AA4.InvariantError(bad, where);
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
