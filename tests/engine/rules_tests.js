/* v4 engine · rules tests for B2–B6 (loaded by run.js). Positions are set up with the by-hand tools
   (move a card from the deck / hand straight to the field), then the rule is played through intents. */
"use strict";
module.exports = ({ AA4, test, assert, eq, FIXTURES, deckOf }) => {
  const FILL = ["T 001", "T 002", "T 003", "T 004", "T 005", "T 006", "T 007", "T 008", "T 009", "T 010", "T 011", "T 012",
    "T 101", "T 102", "T 103", "T 201", "T 301", "T 302", "T 401", "T 402"];

  /** A game past the opening hands. seats: 1 (solo1) or 2–4 (online). */
  function game({ seats = 2, seed = "rules", deck, hold, rules, db } = {}) {
    const mode = seats === 1 ? "solo1" : "online";
    const log = new AA4.GameLog(db || FIXTURES, { debug: "ops" });
    const S = () => log.state;
    const by = s => (mode === "online" ? "P" + s : "P0");
    const res = it => log.push(Object.assign({ by: by(it.seat == null ? 0 : it.seat) }, it));
    const ok = it => { const r = res(it); if (!r.ok) throw new Error(`${it.t}${it.kind ? " " + it.kind : ""} refused: ${r.reason}`); return r; };
    const no = (it, part) => { const r = res(it); assert(!r.ok, `${it.t} should be refused`); if (part) assert(String(r.reason).includes(part), `refused with "${r.reason}", expected "${part}"`); return r; };
    log.push({ t: "create", by: "P0", seed, mode, seats, rules });
    for (let s = 0; s < seats; s++) ok({ t: "join", seat: s, name: "Player " + (s + 1), deck: deck || deckOf(FILL, 60) });
    for (let s = 0; s < seats; s++) ok({ t: "keep", seat: s });
    if (hold === false) for (let s = 0; s < seats; s++) ok({ t: "hold", seat: s, on: false });
    const tp = () => S().turn.player, other = () => AA4.living(S()).find(s => s !== tp());
    /** A card of seat with this key from the hand or deck (not on the field). */
    const free = (seat, key) => {
      const id = Object.values(S().cards).filter(c => c.owner === seat && c.key === key && (c.place.z === "hand" || c.place.z === "deck")).map(c => c.id).sort()[0];
      if (!id) throw new Error(`no free ${key} for seat ${seat}`);
      return id;
    };
    const put = (seat, key, to) => { const id = free(seat, key); ok({ t: "move", seat, card: id, to }); return id; };
    const chOf = id => AA4.charOfCard(S(), id).id;
    const char = (seat, key, area = "front") => chOf(put(seat, key, { z: area }));
    const give = (ch, n) => { const seat = S().chars[ch].owner; for (let i = 0; i < n; i++) { const deck = S().players[seat].zones.deck; ok({ t: "move", seat, card: deck[deck.length - 1], to: { z: "char", ch, role: "power" } }); } };
    const toHand = (seat, key) => { const id = free(seat, key); if (S().cards[id].place.z !== "hand") ok({ t: "move", seat, card: id, to: { z: "hand" } }); return id; };
    /** Everyone who must pass passes once: the newest item resolves (or the battle step goes on). */
    const passAll = () => {
      const mark = JSON.stringify([S().stack.length, S().battle && S().battle.step, S().battle && S().battle.id]);
      for (let k = 0; k < 8; k++) {
        if (JSON.stringify([S().stack.length, S().battle && S().battle.step, S().battle && S().battle.id]) !== mark) return;
        const now = AA4.priorityNow(S());
        if (now == null) return;
        ok({ t: "pass", seat: now });
      }
    };
    const toPhase = phase => { for (let k = 0; k < 12 && S().turn.phase !== phase; k++) ok({ t: "next", seat: tp() }); eq(S().turn.phase, phase, "phase"); };
    const choose = (pick, seat) => { const d = S().decisions[0]; assert(d, "no decision waiting"); return ok({ t: "choose", seat: seat == null ? d.seat : seat, decision: d.id, pick }); };
    const events = () => log.events();
    const last = e => events().filter(x => x.e === e).pop();
    return { log, S, ok, no, tp, other, free, put, char, chOf, give, toHand, passAll, toPhase, choose, events, last, by };
  }
  /** Declare a set: declare → pay (first power cards) → target. */
  function declareSet(g, seat, card, target, extra = {}) {
    g.ok(Object.assign({ t: "declare", seat, kind: "set", card }, extra));
    const d = g.S().draft;
    if (d && d.step === "pay") g.ok({ t: "pay", seat, cards: d.payFrom.flatMap(ch => g.S().chars[ch].power).slice(0, d.cost) });
    if (g.S().draft && g.S().draft.step === "target") g.ok({ t: "target", seat, targets: [target] });
  }

  /* ---------------- B2: turn and phases ---------------- */
  test("B2 turn: Active → Main → Charge → Discard → next player's turn draws 1", () => {
    const g = game();
    const a = g.tp(), b = g.other();
    eq(g.S().turn.phase, "active"); eq(g.S().turn.step, "done");
    g.no({ t: "next", seat: b }, "Only the turn player");
    g.toPhase("main"); g.toPhase("charge");
    g.ok({ t: "next", seat: a });   // Charge → Discard (hand 7 ≤ 7) → turn ends by itself
    eq(g.S().turn.player, b); eq(g.S().turn.number, 2); eq(g.S().turn.phase, "active");
    eq(g.S().players[b].zones.hand.length, 8);   // second player draws on turn 2
    eq(g.S().players[a].zones.hand.length, 7);
  });
  test("B2 draw: Draw +1 on a Controlled Character draws 2; Capacity −1 lowers the hand limit", () => {
    const g = game();
    const a = g.tp(), b = g.other();
    g.char(b, "T 006", "back");   // Draw +1, Capacity −1
    eq(AA4.playerStats(g.S(), FIXTURES, b).draw, 2); eq(AA4.playerStats(g.S(), FIXTURES, b).handLimit, 6);
    g.toPhase("charge");
    const before = g.S().players[b].zones.hand.length;
    g.ok({ t: "next", seat: a });
    eq(g.S().players[b].zones.hand.length, before + 2, "drew 2");
  });
  test("B2 charge: power cards ≤ Mental; deck cards need Charge; dominate at the end", () => {
    const g = game();
    const a = g.tp();
    const act = g.char(a, "T 001", "active");   // Mental 2
    const mage = g.char(a, "T 003", "back");    // Charge 1, controlled
    g.toPhase("charge");
    const [h1, h2, h3] = g.S().players[a].zones.hand;
    g.ok({ t: "charge", seat: a, ch: act, card: h1 });
    g.ok({ t: "charge", seat: a, ch: act, fromDeck: true });            // Charge 1
    g.no({ t: "charge", seat: a, ch: mage, fromDeck: true }, "Charge 1");   // only 1 from the deck this turn
    g.no({ t: "charge", seat: a, ch: act, card: h2 }, "Mental");          // 2 power = Mental 2: full
    g.ok({ t: "charge", seat: a, ch: mage, card: h3 });
    eq(g.S().cards[g.S().chars[act].power[1]].visibleTo, [], "deck power card: unseen");
    eq(g.S().cards[h1].visibleTo, [a], "hand power card: only its owner");
    g.ok({ t: "next", seat: a });
    eq(g.S().chars[act].at, { area: "back" }, "dominated → Control Area (Back)");
    assert(g.events().some(e => e.e === "dominated" && e.ch === act));
  });
  test("B2 discard: over the hand limit → choose what to discard, then the turn ends", () => {
    const g = game();
    const a = g.tp(), b = g.other();
    g.ok({ t: "draw", seat: a, n: 2 });   // by hand: 9 cards
    g.toPhase("charge"); g.ok({ t: "next", seat: a });
    eq(g.S().turn.phase, "discard");
    const d = g.S().decisions[0];
    eq([d.kind, d.min, d.seat], ["cards", 2, a]);
    g.no({ t: "next", seat: a }, "Waiting for a choice");
    g.choose(d.options.slice(0, 2));
    eq(g.S().players[a].zones.hand.length, 7); eq(g.S().players[a].zones.discard.length, 2);
    eq(g.S().turn.player, b); eq(g.S().turn.number, 2);
  });

  /* ---------------- B2: declarations ---------------- */
  test("B2 Break: declare → pay → target → Resolve list → everyone passes → resolves; own Active Character moves to Front", () => {
    const g = game();
    const a = g.tp();
    g.toPhase("main");
    const payer = g.char(a, "T 001", "back"); g.give(payer, 2);   // E.G.O. factor 1, power to pay with
    const target = g.char(a, "T 001", "active");
    const br = g.toHand(a, "T 101");
    g.ok({ t: "declare", seat: a, kind: "set", card: br });
    eq(g.S().draft.step, "pay"); eq(g.S().draft.cost, 1);
    g.no({ t: "target", seat: a, targets: [{ ch: target }] }, "Nothing to choose a target for");
    const pc = g.S().chars[payer].power[0];
    g.ok({ t: "pay", seat: a, cards: [pc] });
    eq(g.S().cards[pc].place.z, "cost"); eq(g.S().cards[pc].faceUp, true, "the opponent sees the paid cards");
    eq(g.S().draft.step, "target");
    g.ok({ t: "target", seat: a, targets: [{ ch: target }] });
    eq(g.S().stack.length, 1); eq(g.S().cards[br].place.z, "declared"); eq(g.S().cards[pc].place.z, "discard", "cost → Discard Pile");
    g.no({ t: "pass", seat: a }, "answers first (priority)");   // strict priority (Q#27): the other player answers first
    g.ok({ t: "pass", seat: g.other() });
    eq(g.S().stack.length, 1, "Hold ON: the declarer passes too");
    g.ok({ t: "pass", seat: a });
    eq(g.S().stack.length, 0);
    eq(g.S().chars[target].stack, [g.S().chars[target].stack[0], br]); eq(g.S().chars[target].at, { area: "front" });
    eq(AA4.charStats(g.S(), FIXTURES, target).at, 3, "the Break card's stats");
  });
  test("B2 cancel: paid power cards go back to their character (refund)", () => {
    const g = game();
    const a = g.tp();
    g.toPhase("main");
    const payer = g.char(a, "T 001", "back"); g.give(payer, 1);
    g.char(a, "T 001", "active");
    const br = g.toHand(a, "T 101");
    g.ok({ t: "declare", seat: a, kind: "set", card: br });
    const pc = g.S().chars[payer].power[0];
    g.ok({ t: "pay", seat: a, cards: [pc] });
    g.ok({ t: "cancel", seat: a });
    eq(g.S().chars[payer].power, [pc]); eq(g.S().draft, null); eq(g.S().cards[br].place.z, "hand");
  });
  test("B2 declare refusals: no target / not enough power / timing / not turn player", () => {
    const g = game();
    const a = g.tp(), b = g.other();
    const br = g.toHand(a, "T 101");
    g.no({ t: "declare", seat: a, kind: "set", card: br }, "Only in your Main Phase");
    g.toPhase("main");
    g.no({ t: "declare", seat: a, kind: "set", card: br }, "not enough power");
    const payer = g.char(a, "T 005", "back"); g.give(payer, 1);   // Warrior (Polestar Empire): no icon in common with T 101
    g.no({ t: "declare", seat: a, kind: "set", card: br }, "Factor: 1 E.G.O. needed");   // a Break card needs its factor to be declared
    const ego = g.char(a, "T 001", "back");   // E.G.O. Student: the factor is there now — but break only itself (it shares an icon)
    g.ok({ t: "declare", seat: a, kind: "set", card: br });
    g.ok({ t: "cancel", seat: a });
    g.ok({ t: "moveChar", seat: a, ch: ego, to: { area: "active" } });   // no Controlled E.G.O. any more
    g.no({ t: "declare", seat: a, kind: "set", card: br }, "Factor");
    const bb = g.toHand(b, "T 101");
    g.no({ t: "declare", seat: b, kind: "set", card: bb }, "Only the turn player");
  });
  test("B2 Break on an opponent's character: it is discarded, the Break card becomes your character", () => {
    const g = game();
    const a = g.tp(), b = g.other();
    g.toPhase("main");
    const payer = g.char(a, "T 001", "back"); g.give(payer, 1);
    const victim = g.char(b, "T 001", "front");
    const vcard = g.S().chars[victim].stack[0];
    const br = g.toHand(a, "T 101");
    declareSet(g, a, br, { ch: victim });
    g.passAll();
    assert(!g.S().chars[victim], "the opponent's character is gone");
    eq(g.S().cards[vcard].place, { z: "discard", seat: b });
    const nc = g.chOf(br);
    eq(g.S().chars[nc].owner, a); eq(g.S().chars[nc].at, { area: "front" });
    eq(AA4.charStats(g.S(), FIXTURES, nc).broken, true, "a Break card on its own counts as broken (Revise#065)");
  });
  test("B2 opponent's character with power cards can't be broken", () => {
    const g = game();
    const a = g.tp(), b = g.other();
    g.toPhase("main");
    const payer = g.char(a, "T 001", "back"); g.give(payer, 1);
    const victim = g.char(b, "T 001", "front"); g.give(victim, 1);
    eq(AA4.breakReason(g.S(), FIXTURES, a, g.toHand(a, "T 101"), victim), "An opponent's character with power cards can't be broken");
  });
  test("Revise#184: a Permanent card can be set only on a character with a free Permanent slot", () => {
    const g = game(), S = g.S, a = g.tp();
    g.toPhase("main");
    const payer = g.char(a, "T 003", "back"); g.give(payer, 4);
    const host = g.char(a, "T 001", "front");
    const p1 = g.toHand(a, "T 201"); declareSet(g, a, p1, { ch: host }); g.passAll();
    eq(S().chars[host].perm, [p1], "the first Permanent is set");
    const p2 = g.toHand(a, "T 201");
    assert(!AA4.permRoom(S(), FIXTURES, host), "its one slot is used");
    const r = g.log.push({ by: g.by(a), t: "declare", seat: a, kind: "set", card: p2 });
    if (r.ok) {   // the payer still has a free slot: only it is offered
      const d = S().draft; if (d.step === "pay") g.ok({ t: "pay", seat: a, cards: d.payFrom.flatMap(ch => S().chars[ch].power).slice(0, d.cost) });
      eq(AA4.draftTargets(S(), FIXTURES, S().draft).map(x => x.ch), [payer], "only the character with a free slot");
      g.no({ t: "target", seat: a, targets: [{ ch: host }] }, "Not a valid target");
    }
    // a character with Permanent +1 holds two
    if (S().draft) g.ok({ t: "cancel", seat: a });
    g.log.state.modifiers.push({ id: "mtest", src: { seat: a, label: "Permanent +1" }, to: { ch: host }, key: "permLimit", op: "add", value: 1, until: "turn" }); AA4.touch(S());
    assert(AA4.permRoom(S(), FIXTURES, host), "Permanent +1: a second slot");
    S().modifiers.pop(); AA4.touch(S());
    const p3 = g.toHand(a, "T 201"); declareSet(g, a, p3, { ch: payer }); g.passAll();
    if (S().chars[payer].perm.length === 1) eq(AA4.planDeclaration(S(), FIXTURES, a, { kind: "set", card: g.toHand(a, "T 201") }).reason.includes("free Permanent slot"), true, "every character full: the Permanent can't be declared");
  });
  test("B2 resolution checks: factor not enough → Discard Pile, no refund; Dual ignores the factor", () => {
    const g = game();
    const a = g.tp();
    g.toPhase("main");
    const payer = g.char(a, "T 003", "back"); g.give(payer, 4);   // WIZ-DOM (factor for T 201 is WIZ-DOM 1: ok)
    const host = g.char(a, "T 001", "front");
    // Permanent: factor WIZ-DOM 1 is there → set
    const perm = g.toHand(a, "T 201");
    declareSet(g, a, perm, { ch: host }); g.passAll();
    eq(g.S().chars[host].perm, [perm]);
    eq(AA4.charStats(g.S(), FIXTURES, host).at, 3, "Permanent +1 attack"); eq(AA4.charStats(g.S(), FIXTURES, host).de, 3);
    // T 102 needs Darklore 2 (none) but has Dual → still set on the Student
    const dual = g.toHand(a, "T 102");
    declareSet(g, a, dual, { ch: host }); g.passAll();
    eq(AA4.topOf(g.S().chars[host]), dual);
  });
  test("B2 factor: not met → it can't be declared (Pack, Revise#315); lost before it resolves → discarded, the cost is not refunded", () => {
    const g = game();
    const a = g.tp();
    g.toPhase("main");
    const payer = g.char(a, "T 005", "back"); g.give(payer, 1);   // no WIZ-DOM
    const host = g.char(a, "T 001", "front");
    const perm = g.toHand(a, "T 201");
    g.no({ t: "declare", seat: a, kind: "set", card: perm }, "Factor");   // refused at the declaration
    // a WIZ-DOM factor for now (a player's factor gain), gone before it resolves
    const ctx0 = { S: g.S(), db: FIXTURES, events: [], emit: () => {} };
    const m = AA4.addMod(ctx0, { src: { seat: a }, to: { seat: a }, key: "factor", op: "add", value: { faction: "WIZ-DOM", n: 1 }, until: "turn" });
    declareSet(g, a, perm, { ch: host });
    g.S().modifiers = g.S().modifiers.filter(x => x.id !== m.id); AA4.touch(g.S());
    g.passAll();
    eq(g.S().cards[perm].place.z, "discard"); eq(g.S().chars[payer].power.length, 0);
    assert(g.last("setFailed").why.includes("Factor"));
  });
  test("B2 name rule: a second “テスト” goes to the Damage Pile; name-level only broken by the same name", () => {
    const g = game({ deck: deckOf(["T 007", "T 103", "T 101", "T 001", "T 005"], 40) });
    const a = g.tp();
    g.toPhase("main");
    const t1 = g.toHand(a, "T 007");
    g.ok({ t: "declare", seat: a, kind: "set", card: t1 });   // Character: placed at once
    const ch = g.chOf(t1);
    eq(g.S().chars[ch].at.area, "active");
    const t2 = g.toHand(a, "T 007");
    g.ok({ t: "declare", seat: a, kind: "set", card: t2 });
    eq(g.S().cards[t2].place.z, "damage");
    g.ok({ t: "moveChar", seat: a, ch, to: { area: "back" } });
    const payer = g.char(a, "T 001", "back"); g.give(payer, 2);
    eq(AA4.breakReason(g.S(), FIXTURES, a, g.toHand(a, "T 101"), ch), "“テスト” can only be broken by a Break card with the same name");
    const same = g.toHand(a, "T 103");
    eq(AA4.breakReason(g.S(), FIXTURES, a, same, ch), null);
    declareSet(g, a, same, { ch }); g.passAll();
    eq(AA4.topOf(g.S().chars[ch]), same, "same name: allowed (the name is not 'already on the field')");
  });
  test("B2 response: a Fast card answers a declaration; newest resolves first, then passes reset", () => {
    const g = game();
    const a = g.tp(), b = g.other();
    g.toPhase("main");
    const payer = g.char(a, "T 001", "back"); g.give(payer, 1);
    const target = g.char(a, "T 001", "active");
    const bpay = g.char(b, "T 001", "back"); g.give(bpay, 1);
    const br = g.toHand(a, "T 101");
    declareSet(g, a, br, { ch: target });
    const fast = g.toHand(b, "T 301");
    declareSet(g, b, fast, { ch: target }, {});   // 2 damage to the Student (Defense 2): defeated before the Break resolves
    eq(g.S().stack.length, 2); eq(g.S().cards[fast].place.z, "special");
    g.passAll();
    eq(g.S().stack.length, 1, "only the newest resolved");
    assert(!g.S().chars[target], "the target was defeated by the Fast card");
    eq(g.S().cards[fast].place.z, "discard", "the Fast card leaves the Special Area");
    g.passAll();
    eq(g.S().cards[br].place.z, "discard", "the Break's target is gone → discarded");
    eq(g.S().stack.length, 0);
  });
  test("B2 Hold OFF for everyone: nobody is asked to pass — it resolves at once (Pack, Revise#113)", () => {
    const g = game({ hold: false });
    const a = g.tp();
    g.toPhase("main");
    const payer = g.char(a, "T 001", "back"); g.give(payer, 1);
    const target = g.char(a, "T 001", "active");
    declareSet(g, a, g.toHand(a, "T 101"), { ch: target });
    eq(AA4.needPass(g.S()), []);
    eq(g.S().stack.length, 0, "resolved without a Pass step");
  });
  test("B2 timing: Fast cards only in the Active / Main Phase", () => {
    const g = game();
    const a = g.tp(), b = g.other();
    const bpay = g.char(b, "T 001", "back"); g.give(bpay, 1);
    g.char(a, "T 001", "front");
    const fast = g.toHand(b, "T 301");
    eq(AA4.check(g.S(), { t: "declare", by: g.by(b), seat: b, kind: "set", card: fast }, FIXTURES), null, "the other player too, with nothing to answer (Pack, Revise#112)");
    const apay = g.char(a, "T 001", "back"); g.give(apay, 1);
    const afast = g.toHand(a, "T 301");
    eq(AA4.check(g.S(), { t: "declare", by: g.by(a), seat: a, kind: "set", card: afast }, FIXTURES), null, "Active Phase, turn player: ok");
    g.toPhase("charge");
    g.no({ t: "declare", seat: a, kind: "set", card: afast }, "Fast timing is only in the Active and Main Phase");
  });
  test("B2 cost destination: Offensive attack on a player → the cost returns to the hand", () => {
    const g = game();
    const a = g.tp(), b = g.other();
    g.toPhase("main");
    const atk = g.char(a, "T 001", "front"); g.give(atk, 2);
    const br = g.toHand(a, "T 101");   // Offensive Break
    declareSet(g, a, br, { ch: atk }); g.passAll();
    const pc = g.S().chars[atk].power[0];
    g.ok({ t: "declare", seat: a, kind: "attack", ch: atk, target: { seat: b } });
    g.ok({ t: "pay", seat: a, cards: [pc] });
    eq(g.S().cards[pc].place.z, "hand"); assert(g.last("costSent").label === "Offensive");
  });

  /* ---------------- B3: query pipeline ---------------- */
  test("B3 always-on ability: +1 attack to your Controlled Characters while it is controlled", () => {
    const g = game();
    const a = g.tp();
    const x = g.char(a, "T 001", "front");
    const gen = g.char(a, "T 011", "active");
    eq(AA4.charStats(g.S(), FIXTURES, x).at, 2, "the General is not controlled yet");
    g.ok({ t: "moveChar", seat: a, ch: gen, to: { area: "back" } });
    eq(AA4.charStats(g.S(), FIXTURES, x).at, 3); eq(AA4.charStats(g.S(), FIXTURES, gen).at, 3);
  });
  test("B3 Project lasting until end of turn: stays in the Special Area, then goes to the Discard Pile", () => {
    const g = game();
    const a = g.tp();
    g.toPhase("main");
    const x = g.char(a, "T 005", "front"); g.give(x, 1);   // Polestar: Project faction (factor none)
    const pj = g.toHand(a, "T 401");
    declareSet(g, a, pj, { ch: x }); g.passAll();
    eq(AA4.charStats(g.S(), FIXTURES, x).at, 5); eq(g.S().cards[pj].place.z, "special");
    g.toPhase("charge"); g.ok({ t: "next", seat: a });
    eq(AA4.charStats(g.S(), FIXTURES, x).at, 3); eq(g.S().cards[pj].place.z, "discard");
  });
  test("B3 field effect by hand + Declaration Ban with its reason", () => {
    const g = game();
    const a = g.tp(), b = g.other();
    g.toPhase("main");
    const x = g.char(a, "T 001", "front"); g.give(x, 2);
    g.ok({ t: "field", seat: b, mod: { key: "ban", value: { decl: "attack" }, to: { seat: a }, label: "No attacks (test)", until: "turn" } });
    g.no({ t: "declare", seat: a, kind: "attack", ch: x, target: { seat: b } }, "Banned by No attacks (test)");
    g.ok({ t: "field", seat: a, mod: { key: "at", value: 2, to: { all: { owner: "you" } }, label: "+2 (test)" } });
    eq(AA4.charStats(g.S(), FIXTURES, x).at, 4);
    const ban = g.S().modifiers.find(m => m.key === "ban");
    g.ok({ t: "fieldEnd", seat: a, mod: ban.id });
    eq(AA4.check(g.S(), { t: "declare", by: g.by(a), seat: a, kind: "attack", ch: x, target: { seat: b } }, FIXTURES), null);
    g.no({ t: "field", seat: a, mod: { key: "powerVisible", to: { players: "all" } } }, "Every player has to agree");
  });
  test("B3 Project ban card: the opponents can't attack this turn", () => {
    const g = game();
    const a = g.tp(), b = g.other();
    g.toPhase("main");
    declareSet(g, a, g.toHand(a, "T 402"), null); g.passAll();
    assert(AA4.banOf(g.S(), FIXTURES, b, { kind: "attack" }), "opponent banned");
    assert(!AA4.banOf(g.S(), FIXTURES, a, { kind: "attack" }), "you are not");
  });

  /* ---------------- B4: battle ---------------- */
  test("B4 attack a player, no guard: damage check (Character → Active Area, others → Damage Pile)", () => {
    const g = game({ deck: deckOf(["T 001", "T 301", "T 005"], 40) });
    const a = g.tp(), b = g.other();
    g.toPhase("main");
    const x = g.char(a, "T 005", "front"); g.give(x, 1);   // Attack 3
    const top3 = g.S().players[b].zones.deck.slice(-3).map(id => g.S().cards[id].key);
    g.ok({ t: "declare", seat: a, kind: "attack", ch: x, target: { seat: b } });
    g.ok({ t: "pay", seat: a, cards: g.S().chars[x].power.slice(0, 1) });
    eq(g.S().battle.step, "guard");
    g.no({ t: "pass", seat: a }, "Waiting for the attacked player");
    g.ok({ t: "noGuard", seat: b });
    g.passAll();
    eq(g.S().battle, null);
    const chars = top3.filter(k => k === "T 001").length;
    eq(g.S().players[b].zones.damage.length, 3 - chars);
    eq(AA4.charsOf(g.S(), b).length, chars, "characters from the damage check go to the Active Area");
  });
  test("B4 guard: battle; damage ≥ Defense → defeated; Intercept guards for 0", () => {
    const g = game();
    const a = g.tp(), b = g.other();
    g.toPhase("main");
    const x = g.char(a, "T 001", "front"); g.give(x, 1);   // 2/2
    const knight = g.char(b, "T 005", "back");             // 3/3 Intercept: guard cost 0
    eq(AA4.charStats(g.S(), FIXTURES, knight).guardCost, 0);
    g.ok({ t: "declare", seat: a, kind: "attack", ch: x, target: { seat: b } });
    g.ok({ t: "pay", seat: a, cards: g.S().chars[x].power.slice() });
    g.ok({ t: "declare", seat: b, kind: "guard", ch: knight });   // cost 0: no pay step
    eq(g.S().battle.guard, knight); eq(g.S().battle.step, "response");
    g.passAll();
    assert(!g.S().chars[x], "the attacker (2/2) took 3 → defeated");
    assert(g.S().chars[knight], "the guard (Defense 3) took 2 → stays");
    eq(g.S().players[b].zones.damage.length, 0);
  });
  test("B4 Penetrate (Pack, Revise#214): the attacker's normal damage beyond the guard's Defense goes to the attacked player; a guard's Penetrate does nothing", () => {
    const g = game();
    const a = g.tp(), b = g.other();
    g.toPhase("main");
    const x = g.char(a, "T 007", "front"); g.give(x, 1);   // 4/4
    const knight = g.char(b, "T 008", "back"); g.give(knight, 1);   // Defense 2
    const ctx = { S: g.S(), db: FIXTURES, emit: () => {} };
    AA4.addMod(ctx, { src: { seat: a }, to: { ch: x }, key: "skill", op: "grant", value: { id: "penetrate" }, until: "turn" });
    AA4.addMod(ctx, { src: { seat: b }, to: { ch: knight }, key: "skill", op: "grant", value: { id: "penetrate" }, until: "turn" }); AA4.touch(g.S());
    const d0 = g.S().players[b].zones.damage.length, da = g.S().players[a].zones.damage.length;
    g.ok({ t: "declare", seat: a, kind: "attack", ch: x, target: { seat: b } });
    g.ok({ t: "pay", seat: a, cards: g.S().chars[x].power.slice() });
    g.ok({ t: "declare", seat: b, kind: "guard", ch: knight });
    if (g.S().draft && g.S().draft.step === "pay") g.ok({ t: "pay", seat: b, cards: g.S().chars[knight].power.slice() });
    g.passAll();
    void d0;
    eq(g.events().filter(e => e.e === "damaged" && e.seat === b).map(e => e.n), [2], "4 damage vs Defense 2 → 2 to the attacked player (each card of the damage check: Damage Pile, or a character)");
    eq(g.events().filter(e => e.e === "damaged" && e.seat === a).length, 0, "the guard's Penetrate does not hit the attacker's player");
    eq(g.S().players[a].zones.damage.length, da);
  });
  test("Revise#188: the attacker gets Breakthrough after an unbroken character guarded → the guard fails, no battle, damage to the player", () => {
    const g = game({ deck: deckOf(["T 001", "T 301", "T 005"], 40) });
    const a = g.tp(), b = g.other();
    g.toPhase("main");
    const x = g.char(a, "T 001", "front"); g.give(x, 1);   // 2/2
    const knight = g.char(b, "T 005", "back");             // unbroken, Intercept
    g.ok({ t: "declare", seat: a, kind: "attack", ch: x, target: { seat: b } });
    g.ok({ t: "pay", seat: a, cards: g.S().chars[x].power.slice() });
    g.ok({ t: "declare", seat: b, kind: "guard", ch: knight });
    eq(g.S().battle.guard, knight);
    g.ok({ t: "field", seat: a, mod: { to: { ch: x }, key: "skill", op: "grant", value: { id: "breakthrough", x: true }, until: "turn", label: "Breakthrough (test)" } });
    const deck0 = g.S().players[b].zones.deck.length;
    g.passAll();
    assert(g.events().some(e => e.e === "guardCancelled" && e.ch === knight && /Breakthrough/.test(e.why)), "the guard fails");
    assert(g.S().chars[x] && g.S().chars[knight], "no battle: both characters stay");
    eq(g.S().players[b].zones.deck.length, deck0 - 2, "the attacker's 2 damage goes to the player (damage check)");
  });
  test("Revise#215 (Pack): the attacker gets Stealth after a character of another faction guarded → the guard fails, no battle, the attack goes to the player", () => {
    const g = game({ deck: deckOf(["T 001", "T 301", "T 005"], 40) });
    const a = g.tp(), b = g.other();
    g.toPhase("main");
    const x = g.char(a, "T 001", "front"); g.give(x, 1);   // E.G.O. 2/2
    const knight = g.char(b, "T 005", "back");             // Polestar Empire
    g.ok({ t: "declare", seat: a, kind: "attack", ch: x, target: { seat: b } });
    g.ok({ t: "pay", seat: a, cards: g.S().chars[x].power.slice() });
    g.ok({ t: "declare", seat: b, kind: "guard", ch: knight });
    g.ok({ t: "field", seat: a, mod: { to: { ch: x }, key: "skill", op: "grant", value: { id: "stealth", x: true }, until: "turn", label: "Stealth (test)" } });
    const deck0 = g.S().players[b].zones.deck.length;
    g.passAll();
    assert(g.events().some(e => e.e === "guardCancelled" && e.ch === knight && /Stealth/.test(e.why)), "the guard fails");
    assert(!g.events().some(e => e.e === "battleStart" && e.chars.includes(knight)), "no battle");
    assert(g.S().chars[x] && g.S().chars[knight], "both characters stay");
    eq(g.S().players[b].zones.deck.length, deck0 - 2, "the attack goes through to the player");
  });
  test("B4 named character defeated in battle → Damage Pile; Bind keeps it if the owner chooses", () => {
    const g = game({ deck: deckOf(["T 007", "T 005", "T 001"], 40) });
    const a = g.tp(), b = g.other();
    g.toPhase("main");
    const x = g.char(a, "T 005", "front"); g.give(x, 1); g.ok({ t: "field", seat: a, mod: { key: "at", value: 2, to: { ch: x } } });   // 5 attack
    const named = g.char(b, "T 007", "back"); g.give(named, 2);   // 4/4, Bind 1
    g.ok({ t: "declare", seat: a, kind: "attack", ch: x, target: { seat: b } });
    g.ok({ t: "pay", seat: a, cards: g.S().chars[x].power.slice() });
    g.ok({ t: "declare", seat: b, kind: "guard", ch: named });
    g.ok({ t: "pay", seat: b, cards: g.S().chars[named].power.slice(0, 1) });
    g.passAll();
    const d = g.S().decisions[0];
    eq(d.seat, b); assert(d.labels.some(l => l.includes("Bind 1")));
    g.choose(["keep0"]);
    assert(g.S().chars[named], "kept by Bind");
    eq(g.S().players[b].zones.damage.length, 1, "the Bind power card");
  });
  test("B4 named card defeated in battle (let it go) → Damage Pile", () => {
    const g = game({ deck: deckOf(["T 007", "T 005", "T 001"], 40) });
    const a = g.tp(), b = g.other();
    g.toPhase("main");
    const x = g.char(a, "T 005", "front"); g.give(x, 1); g.ok({ t: "field", seat: a, mod: { key: "at", value: 2, to: { ch: x } } });
    const named = g.char(b, "T 007", "back"); g.give(named, 1);
    const card = g.S().chars[named].stack[0];
    g.ok({ t: "declare", seat: a, kind: "attack", ch: x, target: { seat: b } });
    g.ok({ t: "pay", seat: a, cards: g.S().chars[x].power.slice() });
    g.ok({ t: "declare", seat: b, kind: "guard", ch: named });
    g.ok({ t: "pay", seat: b, cards: g.S().chars[named].power.slice() });
    g.passAll();
    if (g.S().decisions.length) g.choose(["let"]);
    eq(g.S().cards[card].place.z, "damage");
  });
  test("B4 Breakthrough / Stealth limit who may guard", () => {
    const g = game({ deck: deckOf(["T 001", "T 102", "T 005", "T 004"], 40) });
    const a = g.tp(), b = g.other();
    g.toPhase("main");
    const x = g.char(a, "T 001", "front"); g.give(x, 2);
    g.ok({ t: "move", seat: a, card: g.free(a, "T 102"), to: { z: "char", ch: x, role: "stack" } });   // Breakthrough on top
    const guard = g.char(b, "T 005", "back"); g.give(guard, 1);
    g.ok({ t: "declare", seat: a, kind: "attack", ch: x, target: { seat: b } });
    g.ok({ t: "pay", seat: a, cards: g.S().chars[x].power.slice(0, 1) });
    g.no({ t: "declare", seat: b, kind: "guard", ch: guard }, "Breakthrough");
  });
  test("B4 Initiative strikes first: a defeated opponent deals nothing back", () => {
    const g = game({ deck: deckOf(["T 004", "T 001", "T 005"], 40) });
    const a = g.tp(), b = g.other();
    g.toPhase("main");
    const x = g.char(a, "T 001", "front"); g.give(x, 1);   // 2/2/2
    g.ok({ t: "field", seat: a, mod: { key: "skill", op: "grant", value: { id: "initiative" }, to: { ch: x }, label: "Initiative (test)" } });
    const y = g.char(b, "T 001", "back"); g.give(y, 1);    // 2/2/2
    g.ok({ t: "declare", seat: a, kind: "attack", ch: x, target: { seat: b } });
    g.ok({ t: "pay", seat: a, cards: g.S().chars[x].power.slice() });
    g.ok({ t: "declare", seat: b, kind: "guard", ch: y });
    g.ok({ t: "pay", seat: b, cards: g.S().chars[y].power.slice() });
    g.passAll();
    assert(!g.S().chars[y], "the guard is defeated first"); assert(g.S().chars[x], "so the attacker takes nothing back");
  });
  test("B4 Initiative (Revise#207): the guard kept by Bind is still there — it strikes back after the first strike", () => {
    const g = game({ deck: deckOf(["T 004", "T 001", "T 005"], 40) });
    const a = g.tp(), b = g.other();
    g.toPhase("main");
    const x = g.char(a, "T 001", "front"); g.give(x, 1);   // 2/2/2
    g.ok({ t: "field", seat: a, mod: { key: "skill", op: "grant", value: { id: "initiative" }, to: { ch: x }, label: "Initiative (test)" } });
    const y = g.char(b, "T 001", "back"); g.give(y, 2);    // 2/2/2
    g.ok({ t: "field", seat: b, mod: { key: "skill", op: "grant", value: { id: "bind", x: 1 }, to: { ch: y }, label: "Bind (test)" } });
    g.ok({ t: "declare", seat: a, kind: "attack", ch: x, target: { seat: b } });
    g.ok({ t: "pay", seat: a, cards: g.S().chars[x].power.slice() });
    g.ok({ t: "declare", seat: b, kind: "guard", ch: y });
    g.ok({ t: "pay", seat: b, cards: g.S().chars[y].power.slice(0, 1) });
    g.passAll();
    const d = g.S().decisions.find(z => z.seat === b);
    assert(d, "the guard: keep it?");
    const opt = (d.options || []).find(o => String(o).startsWith("keep"));
    g.ok({ t: "choose", seat: b, decision: d.id, pick: [opt] });
    assert(g.S().chars[y], "kept by Bind 1");
    assert(!g.S().chars[x] || g.S().chars[x].flags.dying || g.S().decisions.some(z => z.seat === a), "…then it strikes back at the attacker (2 damage ≥ Defense 2)");
  });
  test("B4 mental damage: a Controlled Character discards power cards; not enough → defeated", () => {
    const g = game();
    const a = g.tp(), b = g.other();
    const x = g.char(b, "T 001", "back"); g.give(x, 3);
    const ctx = AA4.makeCtx(g.S(), FIXTURES);
    AA4.damageChar(ctx, x, { normal: 0, mental: 2 });
    eq(g.S().chars[x].power.length, 1);
    AA4.damageChar(ctx, x, { normal: 0, mental: 2 });
    assert(!g.S().chars[x], "1 power card < 2 mental → defeated");
    void a;
  });
  test("B4 Shield: no damage except battle damage from an opposing character", () => {
    const g = game();
    const b = g.other();
    const k = g.char(b, "T 005", "back");
    const ctx = AA4.makeCtx(g.S(), FIXTURES);
    AA4.damageChar(ctx, k, { normal: 5, mental: 0 });
    assert(g.S().chars[k], "effect damage ignored");
  });
  test("B4 Active Phase: ▼ Active Characters attack the turn player, faction by faction", () => {
    const g = game({ deck: deckOf(["T 002", "T 004", "T 001", "T 301"], 40) });
    const a = g.tp(), b = g.other();
    g.toPhase("main"); g.toPhase("charge");
    g.char(b, "T 002", "active");   // Arayashiki ▼ 1/1/1
    g.char(b, "T 004", "active");   // Darklore ▼ (2)
    g.ok({ t: "next", seat: a });   // → b's turn: draw → Active Phase
    eq(g.S().turn.player, b); eq(g.S().turn.phase, "active");
    eq(g.S().battle && g.S().battle.kind, "faction");
    eq(g.S().battle.defender, b);
    const dmg0 = g.S().players[b].zones.damage.length;
    g.ok({ t: "noGuard", seat: b }); g.passAll();      // Arayashiki: 1 normal damage
    eq(g.S().battle && g.S().battle.kind, "faction", "then Darklore attacks");
    const top2 = g.S().players[b].zones.deck.slice(-2);
    g.ok({ t: "noGuard", seat: b }); g.passAll();      // Darklore: (2) mental → damage check too (Revise#092)
    eq(g.S().battle, null); eq(g.S().turn.step, "done");
    for (const id of top2) {
      const isChar = FIXTURES.card(g.S().cards[id].key).type === "Character", z = g.S().cards[id].place.z;
      assert(isChar ? z === "char" || z === "damage" : z === "damage", "mental damage runs the damage check: " + id + " → " + z);
    }
    void dmg0;
  });
  test("B4 attack your own Active Character: no guard, straight to battle", () => {
    const g = game();
    const a = g.tp();
    g.toPhase("main");
    const x = g.char(a, "T 005", "front"); g.give(x, 1);   // 3 attack
    const t = g.char(a, "T 001", "active");                // 2/2
    g.ok({ t: "declare", seat: a, kind: "attack", ch: x, target: { ch: t } });
    g.ok({ t: "pay", seat: a, cards: g.S().chars[x].power.slice() });
    eq(g.S().battle.step, "response");
    g.passAll();
    assert(!g.S().chars[t]);
  });
  test("B4 lose: 10 cards in the Damage Pile → the game is over, the other player wins", () => {
    const g = game();
    const a = g.tp(), b = g.other();
    for (let i = 0; i < 9; i++) { const deck = g.S().players[b].zones.deck; g.ok({ t: "move", seat: b, card: deck[deck.length - 1], to: { z: "damage" } }); }
    eq(g.S().stage, "play");
    const deck = g.S().players[b].zones.deck;
    g.ok({ t: "move", seat: b, card: deck[deck.length - 1], to: { z: "damage" } });
    eq(g.S().stage, "over"); eq(g.S().winner, a);
  });
  test("B4 3 players: the loser's cards leave the game and turns skip them", () => {
    const g = game({ seats: 3 });
    const order = g.S().turn.order, loser = order[1];
    g.char(loser, "T 001", "front");
    for (let i = 0; i < 10; i++) { const deck = g.S().players[loser].zones.deck; g.ok({ t: "move", seat: loser, card: deck[deck.length - 1], to: { z: "damage" } }); }
    eq(g.S().stage, "play"); assert(g.S().players[loser].lost);
    eq(AA4.charsOf(g.S(), loser).length, 0); eq(g.S().players[loser].zones.hand.length, 0);
    g.toPhase("charge"); g.ok({ t: "next", seat: g.tp() });
    eq(g.S().turn.player, order[2], "the lost player is skipped");
  });
  test("B4 Defense 0 → defeated at once (state check)", () => {
    const g = game();
    const a = g.tp();
    const x = g.char(a, "T 001", "front");
    g.ok({ t: "field", seat: a, mod: { key: "de", value: -2, to: { ch: x } } });
    assert(!g.S().chars[x]);
  });

  /* ---------------- B5: triggers, decisions ---------------- */
  test("B5 trigger: a character that enters draws 1 (automatic, no choice)", () => {
    const g = game({ deck: deckOf(["T 010", "T 001"], 40) });
    const a = g.tp();
    g.toPhase("main");
    const h = g.S().players[a].zones.hand.length;
    const c = g.toHand(a, "T 010");
    const h2 = g.S().players[a].zones.hand.length;
    g.ok({ t: "declare", seat: a, kind: "set", card: c });
    eq(g.S().players[a].zones.hand.length, h2 - 1 + 1, "set (−1) and drew (+1)");
    assert(g.events().some(e => e.e === "triggerRun"));
    void h;
  });
  test("B5 Remove 1 at the start of the Draw Phase: pay, or it returns to the Active Area", () => {
    const g = game({ deck: deckOf(["T 012", "T 001"], 40) });
    const a = g.tp(), b = g.other();
    const keep = g.char(b, "T 012", "back"); g.give(keep, 1);
    const back = g.char(b, "T 012", "back");
    g.toPhase("charge"); g.ok({ t: "next", seat: a });
    const d = g.S().decisions[0];
    eq([d.kind, d.seat], ["yesno", b]);
    g.choose(["yes"]);
    eq(g.S().chars[keep].at.area, "back"); eq(g.S().chars[keep].power.length, 0);
    eq(g.S().chars[back].at.area, "active", "no power cards: returns to the Active Area");
  });
  const noSearchOffer = g => { const d = g.S().decisions[0]; if (d && /^Search:/.test(d.reason || "")) g.choose([]); };   // Revise#213
  test("B5 Search offer (Pack, Revise#213): a Search card in hand at the start of the Main Phase is asked every time — pick it to search, or none", () => {
    const g = game({ deck: deckOf(["T 009", "T 007", "T 001"], 40) });
    const a = g.tp();
    const s = g.toHand(a, "T 009");
    g.toPhase("main");
    const d = g.S().decisions[0];
    assert(d && d.seat === a && d.options.includes(s) && d.min === 0 && d.max === 1, "asked: which Search card, or none");
    g.choose([s]);
    const d2 = g.S().decisions[0];
    assert(d2 && d2.options.every(id => g.S().cards[id].key === "T 007"), "then the deck search");
    eq(g.S().cards[s].place.z, "discard");
  });
  test("B5 Search: start of the Main Phase only; choose a matching card; the deck is shuffled", () => {
    const g = game({ deck: deckOf(["T 009", "T 007", "T 001"], 40) });
    const a = g.tp();
    g.toPhase("main"); noSearchOffer(g);
    const s = g.toHand(a, "T 009");
    g.ok({ t: "search", seat: a, card: s });
    const d = g.S().decisions[0];
    assert(d.options.length > 0 && d.options.every(id => g.S().cards[id].key === "T 007"), "only “テスト” cards");
    g.choose([d.options[0]]);
    eq(g.S().cards[d.options[0]].place.z, "hand"); eq(g.S().cards[s].place.z, "discard");
    const s2 = g.toHand(a, "T 009");
    g.ok({ t: "declare", seat: a, kind: "set", card: g.toHand(a, "T 001") });
    g.no({ t: "search", seat: a, card: s2 }, "before any other declaration");
  });
  test("B5 choose: wrong seat / not an option are refused", () => {
    const g = game();
    const a = g.tp(), b = g.other();
    g.ok({ t: "draw", seat: a, n: 1 });
    g.toPhase("charge"); g.ok({ t: "next", seat: a });
    const d = g.S().decisions[0];
    g.no({ t: "choose", seat: b, decision: d.id, pick: [d.options[0]] }, "another player");
    g.no({ t: "choose", seat: a, decision: d.id, pick: ["nope"] }, "Not one of the options");
    g.no({ t: "choose", seat: a, decision: d.id, pick: [] }, "Choose 1");
  });

  test("B5 after the attack and the guard step, everyone answers in any order (Pack, Revise#162; Q#27 order is kept outside battles)", () => {
    const g = game({ seats: 3 });
    const a = g.tp(), [b, c] = AA4.livingOrder(g.S()).slice(1);
    g.toPhase("main");
    const x = g.char(a, "T 005", "front"); g.give(x, 1);
    g.ok({ t: "declare", seat: a, kind: "attack", ch: x, target: { seat: c } });
    g.ok({ t: "pay", seat: a, cards: g.S().chars[x].power.slice() });
    g.ok({ t: "noGuard", seat: c });
    assert(AA4.freeOrder(g.S()), "no order after the guard step");
    g.ok({ t: "pass", seat: b }); g.ok({ t: "pass", seat: a }); g.ok({ t: "pass", seat: c });
    eq(g.S().battle, null);
  });
  test("B5 an optional ability asks Run / Skip (Q#64); Run runs it at once, not on the Resolve list (Revise#162 / #165)", () => {
    const g = game({ deck: deckOf(["T 013", "T 001"], 40) });
    const a = g.tp();
    g.toPhase("main");
    const card = g.toHand(a, "T 013"), h = g.S().players[a].zones.hand.length;
    g.ok({ t: "declare", seat: a, kind: "set", card });
    const tr = g.S().triggers[0]; eq(tr && tr.seat, a, "the optional ability waits for Run / Skip");
    g.ok({ t: "trigger", seat: a, id: tr.id, run: true });
    eq(g.S().stack.filter(x => x.kind === "trigger").length, 0, "not on the Resolve list");
    eq(g.S().players[a].zones.hand.length, h - 1 + 2, "ran at once: drew 2");
  });
  test("B4 empty deck (Q#30): 0 cards alone is fine; having to draw from it loses", () => {
    const g = game();
    const a = g.tp(), b = g.other();
    for (const id of g.S().players[b].zones.deck.slice()) g.ok({ t: "move", seat: b, card: id, to: { z: "removed" } });
    eq(g.S().players[b].zones.deck.length, 0); eq(g.S().stage, "play");
    g.toPhase("charge"); g.ok({ t: "next", seat: a });   // b's Draw Phase: draws from the empty deck
    eq(g.S().stage, "over"); eq(g.S().winner, a);
    assert(g.events().some(e => e.e === "lost" && e.seat === b && /empty deck/.test(e.why)));
  });
  test("B5 projection: another player's choice shows no options (e.g. the cards found by a Search)", () => {
    const g = game({ deck: deckOf(["T 009", "T 007", "T 001"], 40) });
    const a = g.tp(), b = g.other();
    g.toPhase("main"); noSearchOffer(g);
    g.ok({ t: "search", seat: a, card: g.toHand(a, "T 009") });
    const mine = AA4.project(g.S(), a).decisions[0], theirs = AA4.project(g.S(), b).decisions[0];
    assert(Array.isArray(mine.options) && mine.options.length > 0);
    assert(typeof theirs.options === "number" && !theirs.then, "options hidden from the other player");
  });

  /* ---------------- B6: effects ---------------- */
  test("B6 effect line: pay from the character, target, resolves (1 damage)", () => {
    const g = game({ deck: deckOf(["T 008", "T 002", "T 001"], 40) });
    const a = g.tp(), b = g.other();
    g.toPhase("main");
    const s = g.char(a, "T 008", "back"); g.give(s, 1);
    const t = g.char(b, "T 002", "front");   // Defense 1
    g.ok({ t: "declare", seat: a, kind: "effect", ch: s, card: g.S().chars[s].stack[0], i: 0 });
    g.ok({ t: "pay", seat: a, cards: g.S().chars[s].power.slice() });
    g.no({ t: "target", seat: a, targets: [{ seat: b }] }, "Not a valid target");
    g.ok({ t: "target", seat: a, targets: [{ ch: t }] });
    g.passAll();
    assert(!g.S().chars[t]);
  });
  test("B6 Fast card cancels an attack", () => {
    const g = game({ deck: deckOf(["T 302", "T 005", "T 001"], 40) });
    const a = g.tp(), b = g.other();
    g.toPhase("main");
    const x = g.char(a, "T 005", "front"); g.give(x, 1);
    g.ok({ t: "declare", seat: a, kind: "attack", ch: x, target: { seat: b } });
    g.ok({ t: "pay", seat: a, cards: g.S().chars[x].power.slice() });
    g.ok({ t: "noGuard", seat: b });
    const f = g.toHand(b, "T 302");
    declareSet(g, b, f, { ch: x });
    g.passAll();   // the Fast card resolves: the attack is cancelled
    g.passAll();
    eq(g.S().battle, null); eq(g.S().players[b].zones.damage.length, 0);
    assert(g.events().some(e => e.e === "attackCancelled"));
  });

  /* ---------------- fuzz: random legal games ---------------- */
  function playRandom(db, { seats, seed, steps, deck, rules }) {
    const mode = seats === 1 ? "solo1" : "online";
    const log = new AA4.GameLog(db, { debug: "ops" });
    log.push({ t: "create", by: "P0", seed, mode, seats, rules });
    const byOf = s => (mode === "online" ? "P" + s : "P0");
    for (let s = 0; s < seats; s++) log.push({ t: "join", by: byOf(s), name: "P" + s, deck: Array.isArray(deck[0]) ? deck[s % deck.length] : deck });   // one deck, or one per seat
    let x = AA4.seedOf("play" + seed);
    const r = () => (x = AA4.rand32(x, 3)) / 4294967296;
    let n = 0, kinds = {};
    for (let k = 0; k < steps && log.state.stage !== "over"; k++) {
      const S = log.state;
      const seatsNow = S.stage === "mulligan" ? S.players.filter(p => !p.ready).map(p => p.seat) : AA4.living(S);
      let all = [];
      for (const s of seatsNow) all = all.concat(AA4.candidates(S, db, byOf(s), s, { manual: r() < 0.05 }));
      if (!all.length) throw new Error(`stuck at step ${k}: nobody can act (phase ${S.turn.phase}, step ${S.turn.step}, battle ${S.battle && S.battle.step}, stack ${S.stack.length})`);
      // prefer progress: "next" sometimes, otherwise anything
      const nexts = all.filter(i => i.t === "next" || i.t === "pass" || i.t === "noGuard");
      const pick = nexts.length && r() < 0.35 ? nexts[Math.floor(r() * nexts.length)] : all[Math.floor(r() * all.length)];
      const res = log.push(pick);
      if (!res.ok) throw new Error(`a candidate was refused: ${JSON.stringify(pick)} — ${res.reason}`);
      kinds[pick.t + (pick.kind ? ":" + pick.kind : "")] = (kinds[pick.t + (pick.kind ? ":" + pick.kind : "")] || 0) + 1;
      n++;
    }
    const bad = AA4.replayCheck(log);
    if (bad) throw new Error(bad);
    return { log, n, kinds };
  }
  module.exports.playRandom = playRandom;
  const FUZZ_DECK = deckOf(["T 013", "T 001", "T 002", "T 003", "T 004", "T 005", "T 006", "T 007", "T 008", "T 009", "T 010", "T 011", "T 012", "T 101", "T 102", "T 103", "T 201", "T 301", "T 302", "T 401", "T 402"], 50);
  for (const seats of [1, 2, 3, 4]) test(`fuzz rules: random legal games, ${seats} player${seats > 1 ? "s" : ""} × 6 seeds`, () => {
    const total = {};
    let over = 0;
    for (let i = 0; i < 6; i++) {
      const { log, kinds } = playRandom(FIXTURES, { seats, seed: `rules-${seats}-${i}`, steps: 600, deck: FUZZ_DECK });
      if (log.state.stage === "over") over++;
      for (const [k, v] of Object.entries(kinds)) total[k] = (total[k] || 0) + v;
    }
    for (const k of ["next", "declare:set", "declare:attack", "pay"]) assert(total[k] > 0, `no ${k} in random games: ${JSON.stringify(total)}`);
  });
  /* ---------------- Revise#083: auto-skip, auto-pay, Break factor, charge ---------------- */
  test("Revise#083 auto-skip: Active Phase → Main by itself; Charge Phase ends when nothing more can be charged", () => {
    const g = game({ rules: { autoSkip: true } });
    const a = g.tp();
    eq(g.S().turn.phase, "main", "the Active Phase with nothing to do went on by itself");
    assert(g.events().some(e => e.e === "autoSkip" && e.phase === "active"), "autoSkip event");
    // no character at all: the Charge Phase has nothing to do → Discard → the next turn
    g.ok({ t: "next", seat: a });
    assert(g.S().turn.player !== a || g.S().turn.phase !== "charge", "the Charge Phase did not wait");
    const g2 = game();   // without the option nothing moves by itself
    eq(g2.S().turn.phase, "active");
    g2.ok({ t: "rules", seat: g2.tp(), key: "autoSkip", on: true });
    eq(g2.S().turn.phase, "main", "switching it on during the game moves on at once");
  });
  test("Revise#083 auto-pay: cost = all the power cards there are → paid without a choice; more → the pay step waits", () => {
    const g = game({ rules: { autoPay: true } });
    const a = g.tp(), b = g.other();
    g.toPhase("main");
    const att = g.char(a, "T 001", "front"); g.give(att, 1);
    g.ok({ t: "declare", seat: a, kind: "attack", ch: att, target: { seat: b } });
    assert(!g.S().draft || g.S().draft.step !== "pay", "paid at once");
    assert(g.events().some(e => e.e === "paid" && e.auto), "auto paid event");
    const g2 = game({ rules: { autoPay: true } });
    const a2 = g2.tp(), b2 = g2.other();
    g2.toPhase("main");
    const att2 = g2.char(a2, "T 001", "front"); g2.give(att2, 3);
    g2.ok({ t: "declare", seat: a2, kind: "attack", ch: att2, target: { seat: b2 } });
    eq(g2.S().draft.step, "pay", "3 power cards for a cost of 1: the player chooses");
  });
  test("Revise#083 charge: every hand card is a legal charge, not only the first ones", () => {
    const g = game();
    const a = g.tp();
    g.char(a, "T 001", "back");
    g.toPhase("charge");
    const hand = g.S().players[a].zones.hand;
    const cands = AA4.candidates(g.S(), FIXTURES, "P" + a, a).filter(c => c.t === "charge" && c.card);
    eq(new Set(cands.map(c => c.card)).size, hand.length, "one charge per hand card");
    g.ok({ t: "charge", seat: a, ch: Object.keys(g.S().chars)[0], card: hand[hand.length - 1] });
  });
  test("Revise#083 Break: the factor is checked at the declaration and again when it resolves (then → Discard Pile)", () => {
    const g = game();
    const a = g.tp(), b = g.other();
    g.toPhase("main");
    const payer = g.char(a, "T 005", "back"); g.give(payer, 1);
    const ego = g.char(a, "T 001", "back");
    const br = g.toHand(a, "T 101");
    declareSet(g, a, br, { ch: ego });
    eq(g.S().stack.length, 1, "declared");
    g.ok({ t: "moveChar", seat: a, ch: ego, to: { area: "active" } });   // the E.G.O. character leaves the Control Area before it resolves
    g.passAll();
    eq(g.S().cards[br].place.z, "discard", "factor missing at resolution → Discard Pile");
    assert(g.events().some(e => e.e === "setFailed" && /Factor/.test(e.why)), "setFailed with the factor reason");
    void b;
  });
  test("Revise#083 by hand from the Deck: +1 Normal (damage check) and +1 Special (→ Damage Pile), undoable", () => {
    const g = game();
    const a = g.tp(), P = () => g.S().players[a];
    const top = () => P().zones.deck[P().zones.deck.length - 1];
    const t1 = top(), dmg0 = P().zones.damage.length;
    g.ok({ t: "selfDamage", seat: a, kind: "special" });
    eq(g.S().cards[t1].place.z, "damage", "special: top card → Damage Pile");
    eq(P().zones.damage.length, dmg0 + 1);
    const t2 = top(), isChar = FIXTURES.card(g.S().cards[t2].key).type === "Character";
    g.ok({ t: "selfDamage", seat: a, kind: "normal" });
    eq(g.S().cards[t2].place.z, isChar ? "char" : "damage", "normal: damage check");
    g.no({ t: "selfDamage", seat: a, kind: "other" }, "Normal or special");
  });
  return { game, declareSet, playRandom };
};
