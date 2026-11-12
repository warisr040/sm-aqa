/* ==========================================================================
   v4 engine · turn, phases, timing windows, Hold / pass   (requirements_v4 §3, §10, §20.5; step B2)

   Turn = Draw → Active → Main → Charge → Discard (Revise#041 / #042):
     Draw      Remove X is paid first (pay X power cards, or the character returns to the Active Area),
               then draw 1 ± Draw X (the first player skips the draw on turn 1; Solo "go second" draws).
               Goes on to the Active Phase by itself.
     Active    faction check in faction order: each ▼ Active Character attacks the turn player (no cost),
               each faction checked when the check reaches it (B4 runs the battles). Then the turn player: Next.
     Main      Project / Attack timing for the turn player; Fast timing for everyone. Next.
     Charge    the turn player sets power cards (hand → character, deck top → character up to the Charge total,
               ≤ Mental per character). Next: one character per faction party with power ≥ Mental is
               dominated → Control Area (Back). Goes on to the Discard Phase.
     Discard   discard down to the hand limit (a choice when over), then the turn ends by itself.
   Phase Rules as data (Revise#043): modifiers {key: "phase", op: "skip", value: "<phase>"} skip a phase of
   that player; {key: "extraTurn"} gives that player another turn after this one.

   Timing (Revise#060 / #025 / #026 / #027) — AA4.timing(S, db, seat, kind) is the one check:
     fast     Active / Main Phase of any player, nothing resolving (the engine is between two resolutions)
     project  turn player, own Main Phase, Resolve list empty, no attack going on
     attack   as project
     guard    the attacked player, in the Guard step
   Resolve (Revise#034): every seat in needPass() passes → the newest item resolves → passes reset → …
   Hold ON (default): every player must pass. All Hold OFF: only the turn player. Solo: you.
   Priority (Revise#035, strict since Q#27 / Revise#079): while a declaration or a battle waits for answers, only
   AA4.priorityNow() may act — answer (Fast timing) or pass — then the next player in AA4.priorityOrder(), and so on.
   With nothing waiting, only the turn player declares; the others answer what the turn player declares.
   Players with Hold OFF are skipped (they never have to pass, and so never get to answer).
   ========================================================================== */
(function (G) {
  "use strict";
  const AA4 = G.AA4, OPS = AA4.OPS, INTENTS = AA4.INTENTS;
  const NEXT_PHASE = { draw: "active", active: "main", main: "charge", charge: "discard", discard: null };

  /* ---------- who / when ---------- */
  AA4.living = S => S.players.filter(p => !p.lost).map(p => p.seat);
  /** Seats that must pass before the newest declaration resolves (or a battle step goes on). */
  /** Hold types (Pack, Revise#168): each player turns each one ON / OFF. Permanent cards count as Break. */
  /** Pack (Revise#205): the Hold a player starts with, and gets back with “Default” */
  AA4.HOLD_DEFAULT = { aggressive: false, battle: true, project: true, fast: true, effect: true, break: false, undo: true };
  AA4.HOLD_TYPES = [["aggressive", "Aggressive"], ["battle", "Attack / Guard"], ["project", "Project"], ["fast", "Fast"], ["effect", "Effect"], ["break", "Break / Permanent"], ["undo", "Undo — ask me to agree"]];
  /** The answer types (Revise#183: Aggressive = the ▼ attacks of the Active Phase; Attack / Guard = the Main Phase battles). */
  AA4.HOLD_ANSWER = ["aggressive", "battle", "project", "fast", "effect", "break"];   // Fast and Effect separate (Pack, Revise#207)
  /** Game Situation (Pack, Revise#169): with the table rule on, everyone's Hold follows the shared situation (true = Not Skip: waited for). */
  AA4.SITUATIONS = [
    // Pack (Revise#212): Attack / Guard and Fast are waited for in every situation; Effect from Interfere on
    ["building", "Building", { aggressive: false, battle: true, project: false, fast: true, effect: false, break: false }],
    ["interfering", "Interfering", { aggressive: false, battle: true, project: true, fast: true, effect: true, break: false }],
    ["conflicting", "Conflicting", { aggressive: false, battle: true, project: true, fast: true, effect: true, break: true }],
    ["engaging", "Engaging", { aggressive: true, battle: true, project: true, fast: true, effect: true, break: true }],
  ];
  AA4.situationOf = S => S.rules && S.rules.situation ? AA4.SITUATIONS.find(x => x[0] === S.situation) || AA4.SITUATIONS[0] : null;
  AA4.holdOn = (S, seat, type) => {
    const p = S.players[seat]; if (!p) return false;
    const sit = type !== "undo" && AA4.situationOf(S);
    if (sit) return (S.sitHolds && type in S.sitHolds ? S.sitHolds[type] : sit[2][type]) !== false;   // Current (Revise#225)
    if (type === "aggressive" && p.holds && !(type in p.holds) && "battle" in p.holds) return p.holds.battle !== false;
    if (type === "effect" && p.holds && !(type in p.holds) && "fast" in p.holds) return p.holds.fast !== false;   // a log from before Revise#207: Fast / Effect was one switch   // a log from before Revise#183: Attack / Guard covered the ▼ attacks too
    return p.holds && type in p.holds ? p.holds[type] !== false : p.hold !== false;
  };
  /** Which Hold type the open window is: the newest declaration decides; otherwise the battle. */
  AA4.windowType = S => {
    const top = S.stack[S.stack.length - 1];
    if (!top) return (S.battle && S.battle.kind === "faction") || (S.turn && S.turn.phase === "active") ? "aggressive" : "battle";   // ▼ attacks happen in the Active Phase (Revise#183)
    return top.holdType || (top.kind === "effect" ? "effect" : "fast");   // set when it was declared (12-declare pushItem)
  };
  AA4.needPass = S => {
    const live = AA4.livingOrder(S);
    // Solo (one deck) follows Hold / Game Situation too (Pack, Revise#206: "even in Building, all actions are confirmed")
    const ty = AA4.windowType(S);
    return live.filter(s => AA4.holdOn(S, s, ty));   // only the players with Hold ON — the turn player too is not asked "pass or not" with Hold OFF (Pack, Revise#113)
  };
  /** May seat answer the open response window now? Hold OFF players (not waited for) may answer any time it is open;
      the others in priority order — or all at once with the table rule "together" (Pack, Revise#112). */
  /** No answering order: the table rule "together", or a battle after the attack and the guard step (Pack, Revise#162: "After Attack and Guard are made, all of player should be able to use Fast timing without order"). */
  AA4.freeOrder = S => S.rules.respond === "together" || !!(S.battle && S.battle.step && S.battle.step !== "guard");
  AA4.mayRespond = (S, seat) => {
    if (!AA4.responseOpen(S)) return false;
    const need = AA4.needPass(S);
    if (!need.includes(seat)) return true;
    if (S.passed.includes(seat)) return false;
    return AA4.freeOrder(S) || AA4.priorityNow(S) === seat;
  };
  /** Priority (Revise#035): turn order from the turn player; the declarer of the newest item answers last;
      in a battle the attacked player answers first. */
  AA4.priorityOrder = S => {
    let o = AA4.livingOrder(S);
    const top = S.stack[S.stack.length - 1];
    if (top) o = o.filter(s => s !== top.seat).concat(o.includes(top.seat) ? [top.seat] : []);
    const b = S.battle;
    if (b && b.defender != null && o.includes(b.defender)) o = [b.defender].concat(o.filter(s => s !== b.defender));
    return o;
  };
  /** Is a response window open (a declaration waiting, or a battle in its response step)? */
  AA4.responseOpen = S => !!(S.stack.length || (S.battle && S.battle.step === "response"));
  /** The seat that may answer or pass now (strict priority, Q#27), or null when no response window is open. */
  AA4.priorityNow = S => {
    if (!AA4.responseOpen(S)) return null;
    const need = AA4.needPass(S);
    return AA4.priorityOrder(S).find(s => need.includes(s) && !S.passed.includes(s));
  };
  /** Something must happen before players may do anything else (a choice, a trigger, a declaration in progress). */
  AA4.busy = S => (S.decisions.length ? "Waiting for a choice" : S.queue.length ? "Busy" : null);

  /** Timing check (§3). → null or the reason. */
  AA4.timing = (S, db, seat, kind) => {
    if (S.stage !== "play") return S.stage === "over" ? "The game is over" : "The game has not started yet";
    if (S.players[seat].lost) return "You are out of the game";
    const busy = AA4.busy(S);
    if (busy) return busy;
    if (S.draft) return S.draft.seat === seat ? "Finish the declaration you started" : "Another player is declaring";
    const ph = S.turn.phase, mine = S.turn.player === seat, b = S.battle;
    if (kind === "guard") {
      if (!b || b.step !== "guard") return "Not in a Guard step";
      return b.defender === seat ? null : "Only the attacked player can guard";
    }
    if (b && b.step === "guard" && kind !== "fast") return "Waiting for the attacked player to guard or not";   // Fast cards / effects: any time in the Active and Main Phase (Pack, Revise#112)
    if (S.triggers.length && kind !== "fast") return "Triggered abilities are waiting";
    if (kind === "fast") {
      if (ph !== "active" && ph !== "main") return "Fast timing is only in the Active and Main Phase";
      if (S.stack.length && S.stack[S.stack.length - 1].noResponse) return "Nobody can respond to this declaration (ジリアン・マキャフリー)";   // 2356 (Q#55)
      if (AA4.responseOpen(S)) {
        if (AA4.mayRespond(S, seat)) return null;
        const now = AA4.priorityNow(S);
        return S.passed.includes(seat) ? "You already passed" : now == null ? "Everyone has passed" : `${S.players[now].name} answers first (priority)`;
      }
      return null;   // any player, in any player's turn (Pack, Revise#112)
    }
    // project / attack
    if (!mine) return "Only the turn player";
    if (ph !== "main") return "Only in your Main Phase";
    if (S.stack.length) return "Resolve the declarations first";
    if (b) return "Finish the attack first";
    return null;
  };

  /* ---------- turn and phase operations ---------- */
  OPS.beginTurn = (ctx, op) => {
    const S = ctx.S, p = S.players[op.seat];
    S.turn.lock = S.turn.lockNext || null; S.turn.lockNext = null; S.turn.isExtra = !!op.extra; S.turn.rushEnd = false; S.turn.dmgChecked = {}; S.turn.effUsed = {}; S.turn.paidChars = {};
    if (S.turn.lock) ctx.emit({ e: "turnLock", ch: S.turn.lock });
    S.turn.player = op.seat; S.turn.number++; S.turn.step = null; S.turn.extraNext = []; S.turn.extraPhase = false; S.turn.extraResume = null;
    p.turnFlags = { turn: S.turn.number, deckCharged: 0, searched: 0, declared: false };
    S.pendingPower = [];
    for (const chId of AA4.charsOf(S, op.seat)) S.chars[chId].flags = { tapped: false, attacks: 0 };
    ctx.emit({ e: "turn", player: op.seat, number: S.turn.number });
    const from = S.turn.nextFrom || "draw"; S.turn.nextFrom = null;   // "対戦相手のターンをメインフェイズから行う" (モイライ, Revise#132)
    AA4.enqueue(S, [{ op: "beginPhase", phase: from }], true);
  };

  /** A phase of the turn player skipped by a Phase Rule? */
  function skipped(ctx, phase) {
    const S = ctx.S;
    return AA4.allMods(S, ctx.db).some(m => m.key === "phase" && m.op === "skip" && m.value === phase && AA4.modAppliesToSeat(S, m, S.turn.player));
  }

  OPS.beginPhase = (ctx, op) => {
    const S = ctx.S, seat = S.turn.player;
    S.turn.phase = op.phase; S.turn.step = null; S.passed = [];
    ctx.emit({ e: "phase", player: seat, phase: op.phase });
    if (S.turn.rushEnd) { ctx.emit({ e: "phaseSkipped", player: seat, phase: op.phase }); AA4.enqueue(S, [{ op: "endPhase" }], true); return; }   // "あなたのターンは終了する" (M3a, Revise#159)
    if (skipped(ctx, op.phase)) { ctx.emit({ e: "phaseSkipped", player: seat, phase: op.phase }); AA4.enqueue(S, [{ op: "endPhase" }], true); return; }
    const ops = [];
    switch (op.phase) {
      case "draw": {
        for (const chId of AA4.charsOf(S, seat)) {
          const ch = S.chars[chId], x = AA4.isControlled(ch) ? AA4.charStats(S, ctx.db, chId).skills.remove : 0;
          if (typeof x === "number" && x > 0) ops.push({ op: "removeCheck", ch: chId, x });
        }
        const first = S.turn.number === 1 && !(S.mode === "solo1" && S.rules.goSecond);
        ops.push(first ? { op: "note", e: { e: "drawSkipped", seat } } : { op: "phaseDraw" });
        ops.push({ op: "endPhase" });
        break;
      }
      case "active": S.turn.step = "check"; S.turn.fcAt = 0; break;   // the flow (flowStep) runs the faction check
      case "main": S.turn.step = "open"; S.players[seat].turnFlags.mainDeclared = false; ops.push({ op: "searchOffer", seat }); break;   // Pack (Revise#213): a Search card in hand → asked every time
      case "charge": S.turn.step = "open"; if (AA4.delayedOps) ops.push(...AA4.delayedOps(S, "chargeStart")); break;   // "パワーカードフェイズ開始時に、…" (A3-18 2466, Revise#214)
      case "discard": ops.push({ op: "discardDown" }, { op: "endPhase" }); break;
    }
    AA4.enqueue(S, ops, true);
  };
  OPS.note = (ctx, op) => ctx.emit(op.e);
  OPS.phaseDraw = ctx => { const S = ctx.S, seat = S.turn.player; AA4.enqueue(S, [{ op: "draw", seat, n: AA4.playerStats(S, ctx.db, seat).draw }], true); };

  /** Remove X (Revise#044): pay X power cards, or the character returns to the Active Area. */
  OPS.removeCheck = (ctx, op) => {
    const S = ctx.S, ch = S.chars[op.ch];
    if (!ch || !AA4.isControlled(ch)) return;
    if (AA4.charStats(S, ctx.db, op.ch).removeByMill) {   // 3266 (Revise#152): "リムーブXのスキルの支払いは、あなたのデッキの上から、カードをリムーブXの数値に等しい枚数捨て札することで、支払ったものとして扱う"
      const deck = S.players[ch.owner].zones.deck;
      if (deck.length < op.x) { removeBack(ctx, op.ch, op.x); return; }
      return AA4.ask(ctx, { seat: ch.owner, kind: "yesno", reason: `Remove ${op.x}: discard ${op.x} card(s) from the top of your deck to keep it controlled?`, ref: { ch: op.ch }, then: [{ op: "removeMill", ch: op.ch, x: op.x }] });
    }
    if (ch.power.length < op.x) { removeBack(ctx, op.ch, op.x); return; }
    return AA4.ask(ctx, { seat: ch.owner, kind: "yesno", reason: `Remove ${op.x}: pay ${op.x} power card${op.x === 1 ? "" : "s"} to keep it controlled? (No = it returns to the Active Area)`,
      ref: { ch: op.ch }, then: [{ op: "removePay", ch: op.ch, x: op.x }] });
  };
  OPS.removeMill = (ctx, op) => {
    const S = ctx.S, ch = S.chars[op.ch];
    if (!ch) return;
    const deck = S.players[ch.owner].zones.deck;
    if (op.answer && op.answer[0] === "yes" && deck.length >= op.x) { for (let i = 0; i < op.x; i++) AA4.moveCard(ctx, deck[deck.length - 1], { z: "discard" }); ctx.emit({ e: "removePaid", ch: op.ch, x: op.x }); }
    else removeBack(ctx, op.ch, op.x);
  };
  OPS.removePay = (ctx, op) => {
    const S = ctx.S, ch = S.chars[op.ch];
    if (!ch) return;
    if (op.answer && op.answer[0] === "yes" && ch.power.length >= op.x) {
      for (const id of ch.power.slice(-op.x)) AA4.moveCard(ctx, id, { z: "discard" });
      ctx.emit({ e: "removePaid", ch: op.ch, x: op.x });
    } else removeBack(ctx, op.ch, op.x);
  };
  /** Remove not paid: its power cards → Discard Pile first, then the character returns to the Active Area (Pack, Revise#089). */
  function removeBack(ctx, chId, x) {
    const ch = ctx.S.chars[chId];
    if (AA4.charStats(ctx.S, ctx.db, chId).removeFailDump) {   // 3686 (Revise#152): "…リムーブXのスキルの支払いを行わなかった場合、勢力エリアに移動する代わりに、≪あなたの手札とあなたのデッキ全て≫を捨て札する"
      const p = ctx.S.players[ch.owner];
      for (const id of p.zones.hand.concat(p.zones.deck)) AA4.moveCard(ctx, id, { z: "discard" });
      return ctx.emit({ e: "note", text: "Remove not paid: the whole hand and deck are discarded instead" });
    }
    for (const id of ch.power.slice()) AA4.moveCard(ctx, id, { z: "discard" });
    OPS.moveChar(ctx, { ch: chId, to: { area: "active" } });
    ctx.emit({ e: "removeReturned", ch: chId, x });
  }

  /** End of a phase: main → "until end of main phase" ends; charge → dominate; then the next phase (or the end of the turn). */
  OPS.endPhase = (ctx, op = {}) => {
    const S = ctx.S, ph = S.turn.phase;
    if (!op.delayedDone && (ph === "main" || ph === "charge")) {   // "…終了時に、…" first (they may ask), then the phase ends
      const ops = AA4.delayedOps ? AA4.delayedOps(S, ph) : [];
      if (ops.length) { AA4.enqueue(S, ops.concat([{ op: "endPhase", delayedDone: true }]), true); return; }
    }
    if (ph === "main") AA4.expire(ctx, "main");
    if (ph === "charge") {   // the pending power cards are set now, then domination is checked
      const set = (S.pendingPower || []).filter(x => S.cards[x.card] && S.cards[x.card].place.z === "char" && S.cards[x.card].place.role === "power");
      if (set.length) ctx.emit({ e: "chargeSet", seat: S.turn.player, n: set.length, chars: [...new Set(set.map(x => x.ch))] });
      S.pendingPower = [];
      dominate(ctx); AA4.expire(ctx, "charge");
    }
    ctx.emit({ e: "phaseEnd", player: S.turn.player, phase: ph });
    // extra phases (ノルニル, Revise#131): "通常の勢力フェイズの後に、追加の勢力フェイズを行う" / "通常のディスカードフェイズの前に、追加のドローフェイズを行う"
    if (!S.turn.extraNext) S.turn.extraNext = [];
    if (!S.turn.extraPhase) {
      const mods = AA4.allMods(S, ctx.db).filter(m => m.key === "extraPhase" && m.value && AA4.modAppliesToSeat(S, m, S.turn.player));
      const n0 = NEXT_PHASE[ph];
      const add = mods.filter(m => m.value.after === ph).map(m => m.value.phase).concat(n0 ? mods.filter(m => m.value.before === n0).map(m => m.value.phase) : []);
      if (add.length) S.turn.extraNext = add.concat(S.turn.extraNext);
    }
    if (S.turn.extraNext.length) {
      const p = S.turn.extraNext.shift();
      S.turn.extraPhase = true; S.turn.extraResume = S.turn.extraResume || NEXT_PHASE[ph];
      ctx.emit({ e: "extraPhase", player: S.turn.player, phase: p });
      AA4.enqueue(S, [{ op: "beginPhase", phase: p }], true);
      return;
    }
    const next = S.turn.extraPhase ? S.turn.extraResume : NEXT_PHASE[ph];
    S.turn.extraPhase = false; S.turn.extraResume = null;
    AA4.enqueue(S, [next ? { op: "beginPhase", phase: next } : { op: "endTurn" }], true);
  };

  /** End of the Charge Phase (Revise#042): per faction party, the top character with power ≥ Mental is dominated. */
  function dominate(ctx) {
    const S = ctx.S, seat = S.turn.player;
    for (const slot of AA4.SLOTS) {
      const chId = AA4.activeCharOf(S, seat, slot);
      if (!chId) continue;
      const st = AA4.charStats(S, ctx.db, chId);
      if (st.se != null && S.chars[chId].power.length >= st.se) {
        OPS.moveChar(ctx, { ch: chId, to: { area: "back" } });
        ctx.emit({ e: "dominated", ch: chId, owner: seat, power: S.chars[chId].power.length, mental: st.se, phaseEnd: true });
      }
    }
  }

  OPS.discardDown = ctx => {
    const S = ctx.S, seat = S.turn.player, p = S.players[seat], limit = AA4.playerStats(S, ctx.db, seat).handLimit;
    const over = p.zones.hand.length - limit;
    if (over <= 0) return;
    return AA4.ask(ctx, { seat, kind: "cards", options: p.zones.hand.slice(), min: over, max: over, ref: { redo: "discardDown" },
      reason: `Discard ${over} card${over === 1 ? "" : "s"} (hand limit ${limit})`, then: [{ op: "discardChosen" }] });
  };
  OPS.discardChosen = (ctx, op) => { for (const id of op.answer || []) if (ctx.S.cards[id] && ctx.S.cards[id].place.z !== "discard") AA4.moveCard(ctx, id, { z: "discard" }); };

  /** ザラーム 3756 (Q#60): during its extra turn no card may be declared from a hand, and only Named characters
      whose power is at least that character's power (live value) may pay costs. Ends if the character is gone. */
  AA4.turnLock = S => S.turn && S.turn.lock && S.chars[S.turn.lock] ? S.turn.lock : null;
  AA4.lockNoPay = (S, db, id) => {
    if (S.chars[id] && AA4.allMods(S, db).some(m => m.key === "noPaySel" && AA4.matchChar(S, db, m.value || {}, id, { seat: m.src ? m.src.seat : -1 }))) return true;   // A3-01 0061 / A3-02 0303 (Revise#159)
    const L = AA4.turnLock(S); if (!L || !S.chars[id]) return false;
    return !(AA4.charStats(S, db, id).named && S.chars[id].power.length >= S.chars[L].power.length);
  };
  OPS.endTurn = (ctx, op = {}) => {
    const S = ctx.S, seat = S.turn.player;
    if (!op.delayedDone) { const ops = AA4.delayedOps ? AA4.delayedOps(S, "turn") : []; if (ops.length) { AA4.enqueue(S, ops.concat([{ op: "endTurn", delayedDone: true }]), true); return; } }   // "ターン終了時に、…"
    AA4.expire(ctx, "turn");
    ctx.emit({ e: "turnEnd", player: seat, number: S.turn.number });
    const extra = S.modifiers.find(m => m.key === "extraTurn" && AA4.modAppliesToSeat(S, m, seat));
    let next;
    if (extra) { AA4.endMod(ctx, extra.id); next = seat; }
    else { const o = AA4.livingOrder(S); next = S.players[seat].lost ? o[0] : o.length > 1 ? o[1] : o[0]; }
    S.turn.lockNext = extra && extra.value && extra.value.lock ? extra.value.lock : null;   // ザラーム 3756 (Q#60)
    AA4.enqueue(S, [{ op: "beginTurn", seat: next, extra: !!extra }], true);
  };

  /** Auto-skip (rules.autoSkip): a phase with nothing to do goes on by itself —
      Active Phase once the faction check is over and nothing waits; Charge Phase when nothing more can be charged. */
  AA4.canChargeMore = (S, db, seat) => {
    const p = S.players[seat];
    if (!AA4.chargeTargets(S, db, seat).length) return false;
    return p.zones.hand.length > 0 || (p.zones.deck.length > 0 && p.turnFlags.deckCharged < AA4.playerStats(S, db, seat).charge);
  };
  AA4.FLOW.push(ctx => {
    const S = ctx.S;
    if (!S.rules.autoSkip || S.stage !== "play") return false;
    if (S.stack.length || S.draft || S.battle || S.triggers.length || S.decisions.length || S.queue.length) return false;
    const ph = S.turn.phase;
    if (ph === "active" && S.turn.step === "done") { S.turn.step = "auto"; ctx.emit({ e: "autoSkip", phase: ph }); AA4.enqueue(S, [{ op: "endPhase" }]); return true; }
    if (ph === "charge" && S.turn.step === "open" && !AA4.canChargeMore(S, ctx.db, S.turn.player) && !(S.pendingPower || []).length) { S.turn.step = "auto"; ctx.emit({ e: "autoSkip", phase: ph }); AA4.enqueue(S, [{ op: "endPhase" }]); return true; }
    return false;
  });
  /** Table options any player may switch during the game: autoSkip, autoPay, powerFaceUp is fixed at the start. */
  /** By hand (Revise#155): "Pick card from deck" — the player looks through their own deck (only written in the log; the moves are by-hand moves) */
  INTENTS.deckLook = {
    undoable: true,
    check(ctx, it) { const seat = AA4.seatFor(ctx.S, it); if (seat == null) return "You are not playing at this table"; return ctx.S.stage === "play" ? null : "The game has not started yet"; },
    apply(ctx, it) { ctx.emit({ e: "deckLook", seat: AA4.seatFor(ctx.S, it) }); },
  };
  INTENTS.rules = {
    undoable: true,
    check(ctx, it) {
      if (AA4.seatFor(ctx.S, it) == null) return "You are not playing at this table";
      if (!["autoSkip", "autoPay", "outlawDiscard", "outlawPower", "outlawFool", "globalUndo", "powerFlipDown"].includes(it.key)) return "Unknown option";   // powerFlipDown: Revise#206   // globalUndo: Revise#190   // Outlaw (Revise#155)
      return ctx.S.rules[it.key] === !!it.on ? "Already set" : null;
    },
    apply(ctx, it) {
      ctx.S.rules[it.key] = !!it.on;
      if (it.on && it.key === "powerFlipDown") ctx.S.rules.outlawPower = false;   // face down and face up for everyone can't both hold
      if (it.on && it.key === "outlawPower") ctx.S.rules.powerFlipDown = false;
      ctx.emit({ e: "rule", key: it.key, on: !!it.on, seat: AA4.seatFor(ctx.S, it) });
    },
  };

  /* ---------- intents ---------- */
  INTENTS.next = {
    undoable: true,
    check(ctx, it) {
      const S = ctx.S, seat = AA4.seatFor(S, it);
      if (seat == null) return "You are not playing at this table";
      if (S.stage !== "play") return "The game has not started yet";
      if (S.turn.player !== seat) return "Only the turn player";
      const busy = AA4.busy(S); if (busy) return busy;
      if (S.draft) return "Finish the declaration first";
      if (S.stack.length) return "Resolve the declarations first";
      if (S.battle) return "Finish the attack first";
      if (S.triggers.length) return "Triggered abilities are waiting";
      if (!["active", "main", "charge"].includes(S.turn.phase)) return "This phase goes on by itself";
      if (S.turn.phase === "active" && S.turn.step === "check") return "The faction check is not finished";
      if (S.turn.step === "auto") return "The phase goes on by itself";
      return null;
    },
    apply(ctx) { AA4.enqueue(ctx.S, [{ op: "endPhase" }]); },
  };

  /** Charge Phase: a hand card (or the top of the deck, up to the Charge total) as a power card. */
  AA4.chargeTargets = (S, db, seat) => AA4.charsOf(S, seat).filter(chId => {
    const ch = S.chars[chId];
    if (!(AA4.isControlled(ch) || AA4.activeCharOf(S, seat, ch.at.slot) === chId)) return false;
    const st = AA4.charStats(S, db, chId);
    if (st.noCharge) return false;   // "…にパワーカードをセットすることはできない"
    return st.se == null || ch.power.length < st.se;   // power cards ≤ Mental
  });
  INTENTS.charge = {
    check(ctx, it) {
      const S = ctx.S, seat = AA4.seatFor(S, it);
      if (seat == null) return "You are not playing at this table";
      if (S.stage !== "play" || S.turn.phase !== "charge" || S.turn.player !== seat) return "Only in your Charge Phase";
      const busy = AA4.busy(S); if (busy) return busy;
      if (!AA4.chargeTargets(S, ctx.db, seat).includes(it.ch)) return S.chars[it.ch] ? "This character can't hold more power cards (Mental)" : "No such character";
      const p = S.players[seat];
      if (it.fromDeck) {
        if (!p.zones.deck.length) return "The deck is empty";
        const max = AA4.playerStats(S, ctx.db, seat).charge;
        return p.turnFlags.deckCharged < max ? null : max ? `Charge ${max}: no more cards from the deck this turn` : "No Charge: power cards from the deck need Charge X";
      }
      if (AA4.playerStats(S, ctx.db, seat).noHandCharge) return "You can't set cards from your hand as power cards now";
      return p.zones.hand.includes(it.card) ? null : "Choose a card from your hand";
    },
    apply(ctx, it) {
      const S = ctx.S, seat = AA4.seatFor(S, it), p = S.players[seat];
      const card = it.fromDeck ? p.zones.deck[p.zones.deck.length - 1] : it.card;
      if (it.fromDeck) p.turnFlags.deckCharged++;
      AA4.enqueue(S, [{ op: "move", card, to: { z: "char", ch: it.ch, role: "power" } }]);
      // pending until the end of the Charge Phase (Pack, Revise#091): it can still be taken back; set for real when the phase ends
      S.pendingPower = (S.pendingPower || []).concat([{ card, ch: it.ch, fromDeck: !!it.fromDeck, seat }]);
      AA4.enqueue(S, [{ op: "note", e: { e: "charged", seat, ch: it.ch, fromDeck: !!it.fromDeck, pending: true } }]);
    },
    undoable: true,
  };

  /** Take a pending power card back (Charge Phase): from the hand → hand, from the deck → top of the deck. */
  INTENTS.unCharge = {
    undoable: true,
    check(ctx, it) {
      const S = ctx.S, seat = AA4.seatFor(S, it);
      if (seat == null) return "You are not playing at this table";
      if (S.stage !== "play" || S.turn.phase !== "charge" || S.turn.player !== seat) return "Only in your Charge Phase";
      const pe = (S.pendingPower || []).find(x => x.card === it.card);
      if (!pe) return "That power card is already set";
      const c = S.cards[it.card];
      return c && c.place.z === "char" && c.place.role === "power" && c.place.ch === pe.ch ? null : "That power card is not there any more";
    },
    apply(ctx, it) {
      const S = ctx.S, pe = S.pendingPower.find(x => x.card === it.card);
      S.pendingPower = S.pendingPower.filter(x => x !== pe);
      if (pe.fromDeck) { S.players[pe.seat].turnFlags.deckCharged = Math.max(0, (S.players[pe.seat].turnFlags.deckCharged || 0) - 1); AA4.moveCard(ctx, it.card, { z: "deck" }); }
      else AA4.moveCard(ctx, it.card, { z: "hand" });
      ctx.emit({ e: "unCharged", seat: pe.seat, ch: pe.ch, fromDeck: pe.fromDeck });
    },
  };
  /** "[Player] declares [Game Situation]": anyone at the table, any time during the game (Pack, Revise#169). */
  INTENTS.situation = {
    undoable: true,
    check(ctx, it) {
      const S = ctx.S, seat = AA4.seatFor(S, it);
      if (seat == null) return "You are not playing at this table";
      if (!S.rules.situation) return "Game Situation is not on at this table";
      if (S.stage !== "play") return "The game has not started yet";
      if (!AA4.SITUATIONS.some(x => x[0] === it.value)) return "Unknown situation";
      return S.situation === it.value && !S.sitHolds ? "That is already the situation" : null;
    },
    apply(ctx, it) {
      const S = ctx.S, seat = AA4.seatFor(S, it);
      delete S.sitHolds;   // declaring a situation takes its whole column again (Pack, Revise#225)
      S.situation = it.value; S.sitDecl = { n: ((S.sitDecl && S.sitDecl.n) || 0) + 1, seat, value: it.value };
      ctx.emit({ e: "situation", seat, value: it.value });
    },
  };
  /** Game options → Skip → "Current" (Pack, Revise#225): any player switches one type of the shared situation now (Skip / Not Skip) */
  INTENTS.sitHold = {
    undoable: true,
    check(ctx, it) {
      const S = ctx.S, seat = AA4.seatFor(S, it);
      if (seat == null) return "You are not playing at this table";
      if (!S.rules.situation) return "Game Situation is not on at this table";
      if (S.stage !== "play") return "The game has not started yet";
      if (!AA4.HOLD_ANSWER.includes(it.type)) return "Unknown type";
      return null;
    },
    apply(ctx, it) {
      const S = ctx.S, seat = AA4.seatFor(S, it), sit = AA4.situationOf(S);
      S.sitHolds = Object.assign({}, sit ? sit[2] : {}, S.sitHolds || {}, { [it.type]: !!it.on });
      ctx.emit({ e: "sitHold", seat, type: it.type, on: !!it.on });
    },
  };
  /* "all": the answer types (old logs); "every": the answer types and Undo (All ON / All OFF, Pack, Revise#205); none: every type (old logs) */
  const holdTypesOf = it => it.type === "every" || !it.type ? AA4.HOLD_ANSWER.concat(["undo"]) : it.type === "all" ? AA4.HOLD_ANSWER.slice() : [it.type];
  INTENTS.hold = {
    undoable: true,
    /* {on, type}: type = one of AA4.HOLD_TYPES, or "all" (the four answer types), or none (old logs: every type, as the one switch was) */
    check(ctx, it) {
      const S = ctx.S, seat = AA4.seatFor(S, it);
      if (seat == null) return "You are not playing at this table";
      if (it.type === "default") return AA4.HOLD_TYPES.every(([t]) => AA4.holdOn(S, seat, t) === AA4.HOLD_DEFAULT[t]) ? "Hold is already the default" : null;   // Revise#205
      const types = holdTypesOf(it);
      if (!types.every(t => AA4.HOLD_TYPES.some(x => x[0] === t))) return "Unknown Hold type";
      return types.every(t => AA4.holdOn(S, seat, t) === !!it.on) ? `Hold is already ${it.on ? "ON" : "OFF"}` : null;
    },
    apply(ctx, it) {
      const S = ctx.S, p = S.players[AA4.seatFor(S, it)];
      if (!p.holds) p.holds = Object.fromEntries(AA4.HOLD_TYPES.map(([t]) => [t, p.hold !== false]));
      if (it.type === "default") Object.assign(p.holds, AA4.HOLD_DEFAULT);
      else for (const t of holdTypesOf(it)) p.holds[t] = !!it.on;
      if (!("aggressive" in p.holds)) p.holds.aggressive = p.holds.battle !== false;   // older state (Revise#183)
      p.hold = AA4.HOLD_ANSWER.some(t => p.holds[t]);   // "any type ON" (kept for old screens)
      ctx.emit({ e: "hold", seat: p.seat, on: !!it.on, type: it.type || null });
    },
  };

  /** Pass: nothing (more) to answer with. */
  INTENTS.pass = {
    undoable: true,
    check(ctx, it) {
      const S = ctx.S, seat = AA4.seatFor(S, it);
      if (seat == null) return "You are not playing at this table";
      if (S.stage !== "play") return "The game has not started yet";
      const busy = AA4.busy(S); if (busy) return busy;
      if (S.draft) return "Finish or cancel the declaration first";
      if (S.triggers.length) return "Run or skip the triggered abilities first";
      if (S.battle && S.battle.step === "guard") return "Waiting for the attacked player to guard or not";
      if (!(S.stack.length || (S.battle && S.battle.step === "response"))) return "Nothing to pass on";
      if (!AA4.needPass(S).includes(seat)) return "You don't need to pass (Hold OFF)";
      if (S.passed.includes(seat)) return "You already passed";
      if (AA4.freeOrder(S)) return null;
      const now = AA4.priorityNow(S);
      return now === seat ? null : `${S.players[now].name} answers first (priority)`;
    },
    apply(ctx, it) { const seat = AA4.seatFor(ctx.S, it); ctx.S.passed.push(seat); ctx.emit({ e: "passed", seat }); },
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
