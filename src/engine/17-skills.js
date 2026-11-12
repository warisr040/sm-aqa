/* ==========================================================================
   v4 engine · Skill Database   (requirements_v4 §11, Revise#044 / #062–#064 / #068 / #070; step B6)

   Each skill = one entry {id, en, jp, value, hooks}: what X means and which system uses it. The skill
   handlers live where the rule is applied (one place each):
     charge, draw, capacity      AA4.playerStats (10-query.js)          — Charge / Draw / Discard Phase
     permanent                   AA4.charStats permLimit                — Permanent set, over the limit → discard
     intercept                   AA4.charStats guardCost −1
     remove                      Draw Phase removeCheck (11-turn.js)
     aggressive                  Active Phase faction check (14-battle.js)
     boost, stealth, breakthrough, synchro, initiative, penetrate        AA4.planBattle / doBattle (14-battle.js)
     shield, resist              damage rules (14-battle.js)            bind   Keep options (14-battle.js)
     offensive, defensive, infinity                                     Cost Destination Rules (10-query.js)
     protect                     targets (15-selectors.js)              dual   factor check (12-declare.js)
     search                      the Search intent below (Revise#068)
     inherent, undead            shown as labels only (To-do list, section 21)
   ========================================================================== */
(function (G) {
  "use strict";
  const AA4 = G.AA4, INTENTS = AA4.INTENTS, OPS = AA4.OPS;

  AA4.SKILLS = {
    charge:       { en: "Charge",       jp: "チャージ",       value: "number", hooks: ["Phase", "Charge"] },
    draw:         { en: "Draw",         jp: "ドロー",         value: "number", hooks: ["Phase"] },
    capacity:     { en: "Capacity",     jp: "キャパシティ",   value: "number", hooks: ["Phase", "Discard"] },
    permanent:    { en: "Permanent",    jp: "パーマネント",   value: "number", hooks: ["Set (Permanent)"] },
    remove:       { en: "Remove",       jp: "リムーブ",       value: "number", hooks: ["Phase", "Cost"] },
    aggressive:   { en: "▼ Aggressive", jp: "▼",              value: "flag",   hooks: ["Phase", "Battle"] },
    boost:        { en: "Boost",        jp: "ブースト",       value: "number", hooks: ["Cost", "Battle"] },
    stealth:      { en: "Stealth",      jp: "ステルス",       value: "flag",   hooks: ["Battle (Defense Timing)"] },
    breakthrough: { en: "Breakthrough", jp: "ブレイクスルー", value: "flag",   hooks: ["Battle"] },
    intercept:    { en: "Intercept",    jp: "インターセプト", value: "flag",   hooks: ["Cost"] },
    offensive:    { en: "Offensive",    jp: "オフェンシブ",   value: "flag",   hooks: ["Cost destination"] },
    defensive:    { en: "Defensive",    jp: "ディフェンシブ", value: "flag",   hooks: ["Cost destination"] },
    infinity:     { en: "Infinity",     jp: "インフィニティ", value: "flag",   hooks: ["Cost destination"] },
    initiative:   { en: "Initiative",   jp: "イニシアチブ",   value: "flag",   hooks: ["Battle"] },
    penetrate:    { en: "Penetrate",    jp: "ペネトレイト",   value: "flag",   hooks: ["Battle", "Damage"] },
    synchro:      { en: "Synchro",      jp: "シンクロ",       value: "flag",   hooks: ["Battle"] },
    shield:       { en: "Shield",       jp: "シールド",       value: "flag",   hooks: ["Damage"] },
    resist:       { en: "Resist",       jp: "レジスト",       value: "factions / icons", hooks: ["Damage"] },
    protect:      { en: "Protect",      jp: "プロテクト",     value: "factions", hooks: ["Targeting"] },
    bind:         { en: "Bind",         jp: "バインド",       value: "number", hooks: ["Defeated"] },
    search:       { en: "Search",       jp: "サーチ",         value: "card selector", hooks: ["Phase", "Event"] },
    dual:         { en: "Dual",         jp: "デュアル",       value: "flag",   hooks: ["Set (Break)"] },
    inherent:     { en: "Inherent",     jp: "インヘレント",   value: "flag",   hooks: [], todo: true },
    undead:       { en: "Undead",       jp: "アンデッド",     value: "flag",   hooks: [], todo: true },
  };

  /** Search (Revise#068): at the start of your Main Phase, before any other declaration of that Main Phase,
      discard a Search card from your hand → choose a matching card from your deck → hand → shuffle. */
  /** Search of a hand card: its own, or one an ability gives ("≪あなたの手札にある…ブレイクカード全て≫は、サーチ(…)を得る", Pack's decks). */
  AA4.searchOf = (S, db, seat, cardId) => {
    const inf = db.card(S.cards[cardId].key) || {};
    if (inf.skills && inf.skills.search) return inf.skills.search;
    if (inf.condSearch && AA4.checkCond(S, db, inf.condSearch.cond, { seat })) return inf.condSearch.search;   // 3118 (Revise#152): "あなたの支配エリアに“X”がいる場合、≪手札のこのカード≫はサーチ(…)を持つ"
    const m = AA4.allMods(S, db).find(x => x.key === "handSearch" && AA4.modAppliesToSeat(S, x, seat) && AA4.cardMatches(inf, x.value && x.value.cards));
    return m ? m.value.search : null;
  };
  /** Pack (Revise#213): at the start of your Main Phase, if a card in your hand has Search, you are asked every time —
      pick the card to Search with, or none to go on. (Search by hand from the card stays possible until you declare.) */
  OPS.searchOffer = (ctx, op) => {
    const S = ctx.S, p = S.players[op.seat];
    if (!p || S.turn.player !== op.seat || S.turn.phase !== "main" || p.turnFlags.mainDeclared || !p.zones.deck.length) return;
    const cards = p.zones.hand.filter(id => AA4.searchOf(S, ctx.db, op.seat, id));
    if (!cards.length) return;
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: cards, min: 0, max: 1, auto: false, reason: `Search: discard ${cards.length === 1 ? "this card" : "one of these cards"} to take a matching card from your deck? Pick it to Search — or choose none to go on without searching`, then: [{ op: "searchOfferGo", seat: op.seat }] });
  };
  OPS.searchOfferGo = (ctx, op) => {
    const S = ctx.S, card = (op.answer || [])[0];
    if (!card) { ctx.emit({ e: "note", text: S.players[op.seat].name + " does not search" }); return; }
    const sr = AA4.searchOf(S, ctx.db, op.seat, card); if (!sr || !S.players[op.seat].zones.hand.includes(card)) return;
    S.players[op.seat].turnFlags.searched++;
    AA4.enqueue(S, [{ op: "move", card, to: { z: "discard" } }, { op: "note", e: { e: "searched", seat: op.seat, card } },
      { op: "searchDeck", seat: op.seat, sel: sr, n: sr.n || 1, distinct: !!sr.distinct, label: sr.label || "" }], true);
  };
  INTENTS.search = {
    undoable: true,
    check(ctx, it) {
      const S = ctx.S, seat = AA4.seatFor(S, it);
      if (seat == null) return "You are not playing at this table";
      if (S.stage !== "play" || S.turn.player !== seat || S.turn.phase !== "main") return "Only at the start of your Main Phase";
      const p = S.players[seat];
      if (p.turnFlags.mainDeclared) return "Only before any other declaration of this Main Phase";
      const busy = AA4.busy(S); if (busy) return busy;
      if (S.draft || S.stack.length || S.battle) return "Only before any other declaration of this Main Phase";
      if (!p.zones.hand.includes(it.card)) return "Choose a card from your hand";
      return AA4.searchOf(S, ctx.db, seat, it.card) ? null : "This card has no Search";
    },
    apply(ctx, it) {
      const S = ctx.S, seat = AA4.seatFor(S, it), sr = AA4.searchOf(S, ctx.db, seat, it.card);
      S.players[seat].turnFlags.searched++;
      AA4.enqueue(S, [{ op: "move", card: it.card, to: { z: "discard" } }, { op: "note", e: { e: "searched", seat, card: it.card } },
        { op: "searchDeck", seat, sel: sr, n: sr.n || 1, distinct: !!sr.distinct, label: sr.label || "" }]);
    },
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
