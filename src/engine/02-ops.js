/* ==========================================================================
   v4 engine · operations (requirements_v4 §20.3)

   An operation is a small atomic step written as data: {op: "move", card, to}.
   An intent (03-intents.js) only queues operations; runQueue() runs them one by
   one. An operation may queue more operations (in front, "then …") or return
   PAUSE when a player must decide (B5) — the rest of the queue stays in
   S.queue, so a long action (battle, declaration) can stop and continue later
   with no special code. Each operation emits game events (§20.8) that the log,
   the UI and (later) triggers listen to.

   Game events of B1:
     {e:"created"} {e:"joined", seat} {e:"watching", cid} {e:"order", order}
     {e:"shuffled", seat, z} {e:"moved", card, key, from, to, seen} {e:"drew", seat, n, wanted}
     {e:"deckOut", seat} {e:"mulligan", seat, n} {e:"kept", seat} {e:"stage", stage}
     {e:"turn", player, number} {e:"phase", player, phase}
     {e:"charNew", ch, owner, at} {e:"charMoved", ch, from, to} {e:"charGone", ch}
     {e:"chat", seat, cid, text} {e:"renamed", seat, cid, from, name}
   ========================================================================== */
(function (G) {
  "use strict";
  const AA4 = G.AA4;
  const PAUSE = (AA4.PAUSE = { pause: true });
  const OPS = (AA4.OPS = {});

  /** Queue operations at the end (normal) or at the front ("then", run before what was waiting). */
  AA4.enqueue = (S, ops, front) => { if (front) S.queue.unshift(...ops); else S.queue.push(...ops); };

  /** Run the queue until it is empty or an operation pauses for a decision. */
  AA4.runQueue = ctx => {
    const S = ctx.S;
    let guard = 0;
    while (S.queue.length) {
      if (++guard > 100000) throw new Error("operation queue does not end");
      const op = S.queue.shift(), fn = OPS[op.op];
      if (!fn) throw new Error(`unknown operation ${op.op}`);
      const r = fn(ctx, op);
      AA4.touch(S);
      if (ctx.debug === "ops") AA4.assertInvariants(S, ctx.db, `op ${op.op}`);
      if (r === PAUSE) return PAUSE;
    }
    return null;
  };

  /* ---------- visibility ---------- */
  /** Seats that can see a card's face right now (all seats when face up). */
  AA4.seenBy = (S, c) => (c.faceUp ? S.players.map(p => p.seat) : c.visibleTo.slice());
  /** Default visibility when a card arrives somewhere (overridable per move). */
  function defaultVis(S, c, from, to) {
    if (to.z === "deck") return { faceUp: false, visibleTo: [] };
    if (to.z === "discard") return { faceUp: false, visibleTo: [] };   // the Discard Pile is seen by nobody, unless an effect shows it (Pack, Revise#112)
    if (to.z === "hand") return { faceUp: false, visibleTo: [c.owner] };
    if (to.z === "char" && to.role === "power") {
      if (from && from.z === "char" && from.role === "power") return { faceUp: c.faceUp, visibleTo: c.visibleTo.slice() };   // moved between characters: unchanged
      if (from && from.z === "deck") return { faceUp: false, visibleTo: [] };   // Charge: from the deck, unseen (Revise#044)
      return { faceUp: false, visibleTo: [c.owner] };   // from hand: only its owner sees it — other players never do, unless an effect lets them (Pack, Revise#112)
    }
    return { faceUp: true, visibleTo: [] };   // discard, damage, removed, special, cost, declared, character stack, permanents
  }

  /** An effect shows these cards to a player (choosing from a Discard Pile, looking at a hand …). */
  AA4.revealTo = (S, ids, seat) => { if (seat === "all") { for (const p of S.players) AA4.revealTo(S, ids, p.seat); return; } for (const id of ids) { const c = S.cards[id]; if (c && !c.faceUp && !c.visibleTo.includes(seat)) c.visibleTo.push(seat); } };

  /* ---------- card movement ---------- */
  function detach(S, c) {
    const list = AA4.containerOf(S, c.place), i = list ? list.indexOf(c.id) : -1;
    if (i < 0) throw new Error(`card ${c.id} is not where it should be`);
    list.splice(i, 1);
  }
  function attach(S, c, to) {
    const list = AA4.containerOf(S, to);
    if (!list) throw new Error(`no container for ${JSON.stringify(to)}`);
    const pos = to.pos;
    if (pos === "bottom") list.unshift(c.id);
    else if (AA4.isInt(pos)) list.splice(Math.max(0, Math.min(pos, list.length)), 0, c.id);
    else list.push(c.id);
    c.place = to.z === "char" ? { z: "char", ch: to.ch, role: to.role } : { z: to.z, seat: to.seat };
  }
  /** Normalise a destination: piles always belong to the card's owner. */
  function destOf(S, c, to) {
    if (to.z === "char") return { z: "char", ch: to.ch, role: to.role || "stack", pos: to.pos };
    if (AA4.AREAS.includes(to.z)) return Object.assign({}, to);
    return { z: to.z, seat: AA4.PILES.includes(to.z) || to.seat == null ? c.owner : to.seat, pos: to.pos };
  }

  /** Move one card (the only way a card changes place). Characters are created / dissolved here. */
  function moveCard(ctx, id, to0, vis) {
    const S = ctx.S, c = S.cards[id];
    if (!c) throw new Error(`no card ${id}`);
    const from = c.place, before = AA4.seenBy(S, c);
    let to = destOf(S, c, to0);
    if (S.stage === "play" && from.z === "hand" && to.z === "discard" && seatHas(S, ctx.db, from.seat != null ? from.seat : c.owner, "handDiscardToDamage")) to = destOf(S, c, { z: "damage" });   // 3228 (Revise#151): "手札からカードが捨て札された場合、≪捨て札されたカード≫は、そのオーナーのダメージ置き場に置かれる"
    detach(S, c);
    if (c.thread && !(to.z === "char" && to.role === "perm")) delete c.thread;
    if (c.permToken && !(to.z === "char" && to.role === "perm")) delete c.permToken;   // a token Permanent is a plain card again   // “糸” ends when the card leaves (Revise#135)
    if (c.asFast && !["special", "declared"].includes(to.z)) delete c.asFast;
    if (c.endTo && !["special", "declared"].includes(to.z)) delete c.endTo;
    if (c.mode != null && !["special", "declared"].includes(to.z)) delete c.mode;   // the chosen mode ends when the card leaves   // used as a Fast card: a Break card again once it leaves
    if (c.asBreak && !["char", "declared", "cost"].includes(to.z) && !AA4.AREAS.includes(to.z)) delete c.asBreak;   // a Character card used as a Break card is a Character card again
    if (AA4.AREAS.includes(to.z)) newChar(ctx, c, to);
    else attach(S, c, to);
    const v = Object.assign(defaultVis(S, c, from, to), vis || {});
    c.faceUp = !!v.faceUp; c.visibleTo = (v.visibleTo || []).slice();
    if (!vis && from.z === "deck" && to.z === "char" && to.role === "power" && seatHas(S, ctx.db, c.owner, "seeCharge")) c.visibleTo = [c.owner];   // "≪あなた≫は、あなたがチャージの効果でセットするカードの内容を見ることができる" (Revise#126)
    if (!ctx.byHand && S.stage === "play" && from.z === "hand" && c.place.z === "discard" && seatHas(S, ctx.db, from.seat != null ? from.seat : c.owner, "handDiscardHit")) { S.handHit = S.handHit || {}; const sk = from.seat != null ? from.seat : c.owner; S.handHit[sk] = (S.handHit[sk] || 0) + 1; }   // テミス (Q#47): "≪手札を捨て札したプレイヤー≫に、捨て札したカード枚数に等しいダメージを与える"
    if (!ctx.byHand && S.stage === "play" && (AA4.AREAS.includes(to.z) || (to.z === "char" && to.role === "stack")) && !["hand", "declared", "char"].includes(from.z) && ["Character", "Break"].includes((ctx.db && ctx.db.card(c.key) || {}).type) && seatHas(S, ctx.db, c.owner, "nonHandSetDiscard"))
      AA4.enqueue(S, [{ op: "move", card: id, to: { z: "discard" } }], true);   // 3718 (Revise#152): "≪手札以外からセットされたキャラクターカード・ブレイクカード≫を捨て札する"
    const seen = [...new Set(before.concat(AA4.seenBy(S, c)))].sort();
    ctx.emit(Object.assign({ e: "moved", card: id, key: c.key, from, to: c.place, seen }, S._dmgCheck && to.z === "damage" ? { byCheck: true } : {}));   // byCheck: placed by a damage check (Revise#164)
    if (from.z === "char" && from.role === "stack") {
      const ch = S.chars[from.ch];
      if (ch && !ch.stack.length) dissolve(ctx, ch);
    }
    if (S.stage === "play" && from.z === "deck" && c.place.z !== "deck" && S.players[from.seat] && !S.players[from.seat].zones.deck.length) ctx.emit({ e: "deckEmpty", seat: from.seat });   // "あなたのデッキが0枚になった際に" (A3-22 3203, Revise#401)
  }
  AA4.moveCard = moveCard;

  /** A new character with card c as its base, in an area (Active slot = the card's faction by default). */
  function newChar(ctx, c, to) {
    const S = ctx.S, info = ctx.db && ctx.db.card(c.key);
    const area = to.z, slot = area === "active" ? (to.slot || AA4.slotOfFaction(info && info.faction)) : undefined;
    const id = "ch" + S.next.ch++;
    const ch = { id, owner: c.owner, at: area === "active" ? { area, slot } : { area }, stack: [], power: [], perm: [], flags: { tapped: false, attacks: 0 } };
    S.chars[id] = ch;
    insertChar(S, ch, to.index);
    attach(S, c, { z: "char", ch: id, role: "stack" });
    ctx.emit({ e: "charNew", ch: id, owner: ch.owner, at: Object.assign({}, ch.at) });
    return id;
  }
  /** Control Front is shown as three sections (Pack, Revise#098): ch.at.sec "left" | "right" (none = centre). One list for the
      rules; an index given for the front counts inside the character's own section. */
  AA4.FRONT_SECS = ["left", "center", "right"];
  AA4.secOf = ch => (ch.at.area === "front" ? ch.at.sec || "center" : null);
  function insertChar(S, ch, index) {
    const list = AA4.charListOf(S, ch.owner, ch.at);
    if (ch.at.area === "front") {
      const sec = AA4.secOf(ch), same = list.filter(id => S.chars[id] && AA4.secOf(S.chars[id]) === sec);
      if (AA4.isInt(index) && index < same.length) list.splice(list.indexOf(same[Math.max(0, index)]), 0, ch.id);
      else if (same.length) list.splice(list.indexOf(same[same.length - 1]) + 1, 0, ch.id);
      else list.push(ch.id);
      return;
    }
    if (AA4.isInt(index)) list.splice(Math.max(0, Math.min(index, list.length)), 0, ch.id);
    else list.push(ch.id);
  }
  /** The last card of the stack left: power cards and permanents go to the owner's discard pile (B1 default;
      the Defeated System, B4, decides where cards go when a character is defeated). */
  function dissolve(ctx, ch) {
    const S = ctx.S;
    const movers = ctx.db ? ch.perm.filter(id => (ctx.db.card(S.cards[id].key) || {}).permMoveOnLeave) : [];
    for (const id of ch.perm.slice()) moveCard(ctx, id, { z: "discard" });
    for (const id of ch.power.slice()) moveCard(ctx, id, { z: "discard" });
    if (movers.length && AA4.enqueue) AA4.enqueue(S, movers.map(id => ({ op: "permMoveAsk", card: id, from: ch.id })));   // "このキャラクターが捨て札される場合、≪このカード≫をあなたの支配キャラクター1人に移動することが可能" (Revise#164)
    const list = AA4.charListOf(S, ch.owner, ch.at);
    list.splice(list.indexOf(ch.id), 1);
    delete S.chars[ch.id];
    ctx.emit({ e: "charGone", ch: ch.id });
  }

  /* ---------- operations ---------- */
  OPS.move = (ctx, op) => { ctx.byHand = !!op.byHand; try { return moveCard(ctx, op.card, op.to, op.vis); } finally { ctx.byHand = false; } };

  /** Move a whole character to another area / slot / position. */
  OPS.moveChar = (ctx, op) => {
    const S = ctx.S, ch = S.chars[op.ch];
    const from = Object.assign({}, ch.at), list = AA4.charListOf(S, ch.owner, ch.at);
    list.splice(list.indexOf(ch.id), 1);
    const top = ctx.db && ctx.db.card(S.cards[AA4.topOf(ch)].key);
    ch.at = op.to.area === "active" ? { area: "active", slot: op.to.slot || AA4.slotOfFaction(top && top.faction) } : { area: op.to.area };
    if (op.to.area === "front") { const sec = op.to.sec || (from.area === "front" ? from.sec : null); if (sec && sec !== "center") ch.at.sec = sec; }   // Front left / centre / right
    insertChar(S, ch, op.to.index);
    ctx.emit({ e: "charMoved", ch: ch.id, from, to: Object.assign({}, ch.at) });
  };

  /** Put the characters of one Control section in a new order (the Sort button, Revise#098): same characters, same places in the list. */
  OPS.sortChars = (ctx, op) => {
    const S = ctx.S, list = S.players[op.seat].areas[op.area], slots = op.order.map(id => list.indexOf(id)).sort((a, b) => a - b);
    slots.forEach((pos, k) => (list[pos] = op.order[k]));
    ctx.emit({ e: "charsSorted", seat: op.seat, area: op.area, sec: op.sec || null, order: op.order.slice() });
  };

  OPS.sortHand = (ctx, op) => {   // Revise#336: the same cards, a new order (the order is not put in the event: a hand is hidden)
    const hand = ctx.S.players[op.seat].zones.hand;
    if (op.order.length !== hand.length || op.order.some(id => !hand.includes(id))) return;
    hand.splice(0, hand.length, ...op.order);
    ctx.emit({ e: "handSorted", seat: op.seat });
  };

  OPS.shuffle = (ctx, op) => {
    const S = ctx.S, list = S.players[op.seat].zones[op.z || "deck"];
    AA4.shuffleInPlace(S, list);
    if ((op.z || "deck") === "deck") for (const id of list) { S.cards[id].faceUp = false; S.cards[id].visibleTo = []; }   // order known to nobody
    ctx.emit({ e: "shuffled", seat: op.seat, z: op.z || "deck" });
  };

  /** Draw n from the top of the deck. An empty deck stops the draw (lose check: B4). */
  const seatHas = (S, db, seat, key) => !!(db && AA4.allMods && AA4.allMods(S, db).some(m => m.key === key && AA4.modAppliesToSeat(S, m, seat)));
  AA4.seatHas = seatHas;
  OPS.draw = (ctx, op) => {
    const S = ctx.S, p = S.players[op.seat];
    if (!op.peeked && op.n > 0 && S.stage === "play" && p.zones.deck.length && seatHas(S, ctx.db, op.seat, "drawPeek")) {   // 趙鏡香 (Revise#137): "ドローする前に、≪あなたのデッキのカードを上からX枚≫見て、…デッキの上か下に置くことができる"
      const pk = AA4.allMods(S, ctx.db).find(m => m.key === "drawPeek" && AA4.modAppliesToSeat(S, m, op.seat)), cnt = pk && pk.value && pk.value.n ? pk.value.n : op.n;
      const top = p.zones.deck.slice(-cnt).reverse();
      AA4.revealTo(S, top, op.seat);
      return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: top, min: 0, max: top.length, auto: false, reason: `Before drawing: choose the cards that go to the bottom of your deck (the rest stay on top)`, then: [{ op: "drawPeekGo", seat: op.seat, n: op.n, chosen: op.chosen, top }] });
    }
    if (!op.chosen && op.n > 0 && S.stage === "play" && seatHas(S, ctx.db, op.seat, "mayNotDraw"))   // "≪あなた≫は、ドローしなければならない場合に、ドローしないことを選択できる" (Revise#126)
      return AA4.ask(ctx, { seat: op.seat, kind: "pick", options: ["draw", "skip"], labels: [`Draw ${op.n}`, "Don't draw"], reason: `You must draw ${op.n}: draw or not?`, then: [{ op: "drawChosen", seat: op.seat, n: op.n, peeked: !!op.peeked }] });
    if (!op.tutored && op.n > 0 && S.stage === "play" && p.zones.deck.length && seatHas(S, ctx.db, op.seat, "drawTutor"))   // 3723 (Revise#152): "あなたがドローをする場合、≪あなた≫は、ドローをする代わりにあなたのデッキからカード1枚を選び、手札に加えることが可能"
      return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: p.zones.deck.slice().sort(), min: 0, max: 1, auto: false, reason: `Instead of drawing: choose up to 1 card from your deck (face up). Choose 1 = take it and draw nothing; choose none = Draw ${op.n} as usual`, then: [{ op: "drawTutorGo", seat: op.seat, n: op.n, chosen: op.chosen, peeked: true }] });
    let got = 0; const drawn = [];
    for (let i = 0; i < op.n; i++) {
      if (!p.zones.deck.length) {   // Q#30: drawing from an empty deck loses the game (in play)
        ctx.emit({ e: "deckOut", seat: op.seat });
        if (S.stage === "play" && !seatHas(S, ctx.db, op.seat, "noDeckOut")) AA4.enqueue(S, [{ op: "lose", seat: op.seat, why: "had to draw from an empty deck" }], true);   // リルナ (Revise#141): "カードを引かなければならない状況で残りデッキ枚数が足りない場合でも敗北しない"
        break;
      }
      const dId = p.zones.deck[p.zones.deck.length - 1];
      moveCard(ctx, dId, { z: "hand" });
      for (const o of S.players) if (o.seat !== op.seat && !S.cards[dId].visibleTo.includes(o.seat) && seatHas(S, ctx.db, o.seat, "seeDraws")) S.cards[dId].visibleTo.push(o.seat);   // "≪プレイヤー全て≫は、ドローしたカードをあなたに見せる" (Revise#136)
      got++; drawn.push(dId);
    }
    if (S.stage === "play") for (const m of AA4.allMods(S, ctx.db).filter(x => x.key === "revealDraws" && AA4.modAppliesToSeat(S, x, op.seat))) for (const id of drawn) for (const o of S.players) if (!S.cards[id].visibleTo.includes(o.seat)) S.cards[id].visibleTo.push(o.seat);   // 3685: "≪対戦相手全て≫は、ドローしたカードを公開する"
    if (got && S.stage === "play") for (const m of AA4.allMods(S, ctx.db).filter(x => x.key === "overDrawDiscard" && AA4.modAppliesToSeat(S, x, op.seat) && x.src && x.src.seat != null)) {   // 3685: "≪手札の上限を超えてドローしたプレイヤー≫の手札から、手札の枚数が手札上限に等しくなるまで、あなたの任意のカードを捨て札する"
      const k = p.zones.hand.length - AA4.playerStats(S, ctx.db, op.seat).handLimit;
      if (k > 0) AA4.enqueue(S, [{ op: "overLimitAsk", seat: m.src.seat, who: op.seat, n: k, dest: "discard" }], true);
    }
    ctx.emit({ e: "drew", seat: op.seat, n: got, wanted: op.n });
    if (got && S.stage === "play" && seatHas(S, ctx.db, op.seat, "redraw"))   // 三ツ谷奏恵 (Revise#141): "≪あなた≫がドローした場合、その中の任意の枚数を自分のデッキに戻してシャッフルし、同じ枚数を手札に加えることが可能"
      return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: drawn, min: 0, max: drawn.length, auto: false, reason: "You may put any of the drawn cards back into your deck (shuffled) and take as many from it", then: [{ op: "redrawGo", seat: op.seat }] });
  };
  OPS.drawTutorGo = (ctx, op) => {
    const S = ctx.S, got = (op.answer || []).filter(id => S.cards[id] && S.cards[id].place.z === "deck");
    for (const id of got) moveCard(ctx, id, { z: "hand" });
    if (got.length) ctx.emit({ e: "note", text: `${got.length} card(s) chosen from the deck instead of drawing` });
    if (!got.length) return OPS.draw(ctx, { seat: op.seat, n: op.n, chosen: op.chosen, peeked: true, tutored: true });   // Pack (Revise#213): 1 card chosen = the whole draw is replaced; none = draw as usual
  };
  OPS.redrawGo = (ctx, op) => {
    const S = ctx.S, p = S.players[op.seat], back = (op.answer || []).filter(id => S.cards[id] && S.cards[id].place.z === "hand");
    if (!back.length) return;
    for (const id of back) moveCard(ctx, id, { z: "deck" });
    OPS.shuffle(ctx, { seat: op.seat });
    for (let i = 0; i < back.length && p.zones.deck.length; i++) moveCard(ctx, p.zones.deck[p.zones.deck.length - 1], { z: "hand" });
    ctx.emit({ e: "redrew", seat: op.seat, n: back.length });
  };

  OPS.drawPeekGo = (ctx, op) => {
    const S = ctx.S, d = S.players[op.seat].zones.deck;
    for (const id of op.answer || []) { const i = d.indexOf(id); if (i >= 0) { d.splice(i, 1); d.unshift(id); } }
    for (const id of op.top || []) if (S.cards[id] && S.cards[id].place.z === "deck") S.cards[id].visibleTo = [];
    return OPS.draw(ctx, { seat: op.seat, n: op.n, chosen: op.chosen, peeked: true });
  };
  OPS.drawChosen = (ctx, op) => { if (op.answer && op.answer[0] === "skip") { ctx.emit({ e: "drew", seat: op.seat, n: 0, wanted: op.n }); return; } return OPS.draw(ctx, { seat: op.seat, n: op.n, chosen: true, peeked: op.peeked }); };
  /** Coin toss for the turn order (Q#17), then every deck is shuffled and 7 cards are drawn. */
  OPS.startGame = ctx => {
    const S = ctx.S, seats = S.players.map(p => p.seat);
    const pick = S.mode === "solo2" && seats.includes(S.rules.firstSeat) ? S.rules.firstSeat : null;   // Solo with two decks / vs Bot: "Who goes first" is the player's choice, no coin toss (Pack, Revise#374)
    S.turn.order = S.mode === "solo1" ? seats : pick != null ? [pick].concat(seats.filter(s => s !== pick)) : AA4.shuffleInPlace(S, seats.slice());
    S.seatsWanted = S.players.length;
    ctx.emit(Object.assign({ e: "order", order: S.turn.order.slice() }, pick != null ? { chosen: true } : {}));
    S.stage = "mulligan";
    ctx.emit({ e: "stage", stage: "mulligan" });
    const ops = [];
    for (const seat of S.turn.order) ops.push({ op: "shuffle", seat }, { op: "draw", seat, n: AA4.START_HAND });
    AA4.enqueue(S, ops, true);
  };

  /** Opening hand back into the deck, shuffle, draw 7 again (prev: any number of times). */
  OPS.mulligan = (ctx, op) => {
    const S = ctx.S, p = S.players[op.seat];
    for (const id of p.zones.hand.slice()) moveCard(ctx, id, { z: "deck" });
    p.mulligans++;
    ctx.emit({ e: "mulligan", seat: op.seat, n: p.mulligans });
    AA4.enqueue(S, [{ op: "shuffle", seat: op.seat }, { op: "draw", seat: op.seat, n: AA4.START_HAND }], true);
  };

  /** Auto Re-shuffle (Pack, Revise#234): the hand wanted —
      Character cards ≥ 3 · a Character with Draw ≥ 1 · a Character with Charge and an effect "≪このエフェクトのコスト≫をオーナーの手札に戻す" ≥ 1. */
  const EFF_COST_BACK = /このエフェクトのコスト≫?を、?(?:その)?(?:オーナーの|あなたの)?手札に戻す/;   // "Return ≪this effect's cost≫ to its owner's hand" (Pack, Revise#234)
  AA4.AUTO_MULL_MAX = 10; AA4.AUTO_MULL_WARN = 3;
  /** The deck's Main Factor (Pack, Revise#375 / #380): the faction that the Factors of its Name-level cards ask for most, counted over the player's own cards. null = no named card. */
  AA4.mainFactorOf = (S, db, seat) => {
    const n = {};
    for (const c of Object.values(S.cards)) { if (c.owner !== seat || !c.key) continue; const inf = (db && db.card(c.key)) || {}; if (!inf.name) continue; for (const [f, v] of Object.entries(inf.factor || {})) n[f] = (n[f] || 0) + (+v || 0); }
    const best = Object.entries(n).sort((a, b) => b[1] - a[1])[0];
    return best ? best[0] : null;
  };
  AA4.openingHandCheck = (S, db, seat) => {
    const infs = S.players[seat].zones.hand.map(id => (db && db.card(S.cards[id].key)) || {}).filter(i => i.type === "Character");
    // Pack (Revise#380): a Character of the deck's Main Factor must be in the hand too. Only in games created with rules.mullMain (older logs replay as they were).
    const mainOn = !!(S.rules && S.rules.mullMain), main = mainOn ? AA4.mainFactorOf(S, db, seat) : null, mainN = main ? infs.filter(i => i.faction === main).length : 0;
    const sk = (i, k) => { const v = i.skills && i.skills[k]; return v === true || (typeof v === "number" && v > 0) || (v && typeof v === "object" && (v.x == null || v.x > 0)); };
    const chars = infs.length, draw = infs.filter(i => sk(i, "draw")).length, chargeBack = infs.filter(i => sk(i, "charge") && EFF_COST_BACK.test(String(i.text || "").replace(/\s+/g, ""))).length;   // Charge and an effect whose cost returns to the hand: 100 printings (65 names)
    return Object.assign({ chars, draw, chargeBack, ok: chars >= 3 && draw >= 1 && chargeBack >= 1 && (!main || mainN >= 1) }, mainOn ? { main, mainN } : {});
  };
  OPS.autoMulligan = (ctx, op) => {
    const S = ctx.S, p = S.players[op.seat];
    p.autoMulls = (p.autoMulls || 0) + 1;
    let tries = 0, c;
    do {   // Pack (Revise#304): it always re-shuffles at least once — the hand in front of you is never just kept
      for (const id of p.zones.hand.slice()) moveCard(ctx, id, { z: "deck" });
      p.mulligans++; tries++;
      OPS.shuffle(ctx, { seat: op.seat });
      OPS.draw(ctx, { seat: op.seat, n: AA4.START_HAND });
      c = AA4.openingHandCheck(S, ctx.db, op.seat);
    } while (!c.ok && tries < AA4.AUTO_MULL_MAX);
    const runs = p.autoMulls;
    if (c.ok) { p.mulligans = 0; p.autoMulls = 0; }
    const lines = c.ok ? [] : ["You are SCREWED!"].concat(runs >= AA4.AUTO_MULL_WARN ? ["Please re-adjust your deck..."] : []);
    p.autoMsg = { n: ((p.autoMsg && p.autoMsg.n) || 0) + 1, ok: c.ok, tries, runs, lines, check: Object.assign({ chars: c.chars, draw: c.draw, chargeBack: c.chargeBack }, c.main !== undefined ? { main: c.main, mainN: c.mainN } : {}) };
    ctx.emit({ e: "autoMulligan", seat: op.seat, ok: c.ok, tries, runs });
  };

  OPS.keep = (ctx, op) => {
    const S = ctx.S;
    S.players[op.seat].ready = true;
    ctx.emit({ e: "kept", seat: op.seat });
    if (S.players.every(p => p.ready)) {
      S.stage = "play";
      Object.assign(S.turn, { player: S.turn.order[0], phase: "draw", step: null, number: 0 });
      ctx.emit({ e: "stage", stage: "play" });
      AA4.enqueue(S, [{ op: "beginTurn", seat: S.turn.order[0] }], true);   // Turn 1 (11-turn.js)
    }
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
