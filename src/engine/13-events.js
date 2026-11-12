/* ==========================================================================
   v4 engine · decisions (Event System), triggers, and the flow loop
   (requirements_v4 §7, §9, §20.3, §20.6, §20.8; step B5)

   Decisions — every choice the board can't show by clicking:
     AA4.ask(ctx, {seat, kind, options, min, max, reason, ref?, then: [ops]})  → pauses the queue
     kinds: "cards" (pick N card ids) · "chars" · "yesno" ("yes" / "no") · "pick" (one of labelled options)
            · "number" (options = allowed numbers) · "order" (all options, in the order to use them)
     The answer is an intent {t: "choose", decision, pick: [...]}; the `then` operations run with op.answer = pick,
     before whatever was waiting in the queue. Only one option and min = max → chosen automatically.
     The projection shows a decision's options only to its chooser; others see "waiting for …".

   Triggers (Revise#039) — abilities {kind: "trigger", when: {event, self?, …}, optional?, effect} of cards on the
   field listen to game events. A matching one waits in S.triggers until its owner runs or skips it
   ({t: "trigger", trigger: id, run, targets?}). Run puts it on the Resolve list, so the other players can answer it (Q#29 /
   Revise#079); one that is not optional and needs no target runs at once (Revise#039).
   Events triggers listen to (from the engine):
     enter (a card / character enters the field) · attack · guarded · battleStart · battleEnd · dominated ·
     leave (a character leaves the field) · damaged · broken · turnStart · turnEnd · phaseStart · resolved

   Flow loop AA4.advance(ctx) — after every intent: run the queue → state check (B4) → collect triggers →
   flow steps (resolve the newest declaration when everyone passed, battle steps, faction check …) →
   repeat until a player has to act.
   ========================================================================== */
(function (G) {
  "use strict";
  const AA4 = G.AA4, OPS = AA4.OPS, INTENTS = AA4.INTENTS;

  /* ---------- decisions ---------- */
  AA4.ask = (ctx, d) => {
    const S = ctx.S;
    if (S.chooseFor && d.seat === S.chooseFor.from && d.kind !== "yesno") d = Object.assign({}, d, { seat: S.chooseFor.to, reason: (d.reason || "") + " (your choice — A3-15 2105)" });   // Pack (Revise#248)
    const dec = { id: AA4.newId(S, "d"), seat: d.seat, kind: d.kind, reason: d.reason || "", ref: d.ref || null, then: d.then || [] };
    dec.options = d.kind === "yesno" ? ["yes", "no"] : (d.options || []).slice();
    dec.min = d.kind === "yesno" || d.kind === "pick" ? 1 : d.kind === "order" ? dec.options.length : d.min == null ? 1 : d.min;
    dec.max = d.kind === "yesno" || d.kind === "pick" ? 1 : d.kind === "order" ? dec.options.length : d.max == null ? dec.min : d.max;
    if (d.labels) dec.labels = d.labels;
    if (d.onField) { dec.onField = true; dec.old = d.old || []; }
    if (d.fieldPicked) dec.fieldPicked = d.fieldPicked.slice();   // already chosen in a one-at-a-time choice: shown as chosen on the field (Revise#246)
    if (d.setCard) { dec.setCard = d.setCard; dec.setRest = (d.setRest || []).slice(); }   // Pack (Revise#231): "which character is this card set on" — the card shown, the character clicked on the field   // chosen by clicking on the field (Revise#162)
    if (d.kind !== "yesno" && d.auto !== false && dec.options.length === dec.min && dec.min === dec.max && (dec.kind !== "order" || dec.options.length <= 1)) {
      AA4.enqueue(S, dec.then.map(o => Object.assign({}, o, { answer: dec.options.slice() })), true);   // only one way: chosen at once
      return null;
    }
    if (dec.kind === "cards" && !d.blind && AA4.isInt(dec.seat)) {   // Pack (Revise#213): choosing from a deck always shows those cards face up to the chooser; hidden again afterwards unless taken
      const shown = dec.options.filter(id => S.cards[id] && S.cards[id].place.z === "deck" && !S.cards[id].faceUp && !(S.cards[id].visibleTo || []).includes(dec.seat));
      if (shown.length) { AA4.revealTo(S, shown, dec.seat); dec.deckShown = shown; }
    }
    S.decisions.push(dec);
    ctx.emit({ e: "asked", decision: dec.id, seat: dec.seat, kind: dec.kind, reason: dec.reason });
    return AA4.PAUSE;
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  INTENTS.choose = {
    undoable: true,
    check(ctx, it) {
      const S = ctx.S, d = S.decisions.find(x => x.id === it.decision);
      if (!d) return "No such choice";
      if (AA4.seatFor(S, Object.assign({}, it, { seat: it.seat == null ? d.seat : it.seat })) !== d.seat) return "This choice is for another player";
      const pick = it.pick == null ? [] : it.pick;   // the online room drops empty arrays: no pick = [] (Pack, Revise#127: "look only" hands)
      if (!Array.isArray(pick)) return "Choose something";
      if (pick.length < d.min || pick.length > d.max) return d.min === d.max ? `Choose ${d.min}` : `Choose ${d.min} to ${d.max}`;
      if (pick.some(x => !d.options.some(o => same(o, x)))) return "Not one of the options";
      if (new Set(pick.map(x => JSON.stringify(x))).size !== pick.length) return "The same option twice";
      return null;
    },
    apply(ctx, it) {
      const S = ctx.S, i = S.decisions.findIndex(x => x.id === it.decision), d = S.decisions[i];
      S.decisions.splice(i, 1);
      const pick = it.pick == null ? [] : it.pick;
      for (const id of d.deckShown || []) { const c = S.cards[id]; if (c && c.place.z === "deck" && !pick.includes(id)) c.visibleTo = (c.visibleTo || []).filter(x => x !== d.seat); }   // Revise#213: the cards left in the deck are hidden again
      ctx.emit({ e: "chosen", decision: d.id, seat: d.seat, pick });
      AA4.enqueue(S, d.then.map(o => Object.assign({}, o, { answer: pick.slice() })), true);
    },
  };

  /* ---------- triggers ---------- */
  /** Does game event ev match an ability's `when`? self = the character the ability's card is part of. */
  AA4.TRIGGER_MATCH = {
    enter: (ev, w, t, S, db) => ev.e === "entered" && (!w.self || ev.card === t.card || (ev.ch === t.ch && !!S.chars[ev.ch] && S.chars[ev.ch].stack.length === 1 && S.chars[ev.ch].stack[0] === ev.card))   // "このカードがセットされた場合": this card, or the character itself entering — not a Permanent / Break set on it later (A3-05 0722, Pack, Revise#162) && (!w.fromDamage || ev.fromDamage) && (!w.byAttackCtl || ev.byAttackCtl)
      && (!w.anyNamedBreak || (!ev.fromDamage && !!S.cards[ev.card] && (db.card(S.cards[ev.card].key) || {}).type === "Break" && !!(db.card(S.cards[ev.card].key) || {}).name))   // EP244 (Revise#157)
      && (!w.ownBreak || (ev.seat === t.seat && !ev.fromDamage && !!S.cards[ev.card] && (db.card(S.cards[ev.card].key) || {}).type === "Break")),   // "あなたが使用宣言したブレイクカードがセットされた場合" (Revise#136)   // set / damage check / direct (not by-hand moves)
    attack: (ev, w, t, S) => ev.e === "attacked" && (!w.self || ev.ch === t.ch) && (!w.atMe || (ev.target && ev.target.seat === t.seat && ev.target.ch == null)) && (!w.boost || ev.boost > 0) && (!w.toPlayer || (ev.target && ev.target.seat != null)) && (!w.toChar || (ev.target && ev.target.ch != null)) && (!w.own || (ev.seat === t.seat && !ev.faction)) && (!w.notOwnCh || !(ev.target && ev.target.ch && S.chars[ev.target.ch] && S.chars[ev.target.ch].owner === t.seat)),   // notOwnCh: "プレイヤーまたはあなた以外のプレイヤーのテリトリーのキャラクターを目標に" (EP202, Revise#217)
    costPaid: (ev, w, t, S, db) => ev.e === "costPaid" && (!w.kinds || w.kinds.includes(ev.kind)) && (!w.self || ev.ch === t.ch)
      && (!w.kindNot || ev.kind !== w.kindNot) && (!w.unbroken || (!!S.chars[ev.ch] && !AA4.charStats(S, db, ev.ch).broken)) && (!w.sel || (!!S.chars[ev.ch] && AA4.matchChar(S, db, w.sel, ev.ch, { seat: t.seat }))),   // Revise#137 / #138
    battleDeclared: (ev, w, t, S, db) => (ev.e === "attacked" || ev.e === "guarded") && (!w.self || ev.ch === t.ch) && (!w.opp || (!!S.chars[ev.ch] && S.chars[ev.ch].owner !== t.seat && !(ev.e === "attacked" && ev.faction))) && (!w.sel || (!!S.chars[ev.ch] && AA4.matchChar(S, db, w.sel, ev.ch, { seat: t.seat }))),   // "アタック宣言またはガード宣言したキャラクター"
    joined: (ev, w, t) => ev.e === "joined" && (!w.self || ev.ch === t.ch),   // "シンクロによるアタック宣言またはガード宣言を行った場合"
    attacked: (ev, w, t) => ev.e === "attacked" && (!w.self || (ev.target && ev.target.ch === t.ch)),
    unguardedNamed: (ev, w, t, S, db) => (ev.e === "noGuard" || (ev.e === "guarded" && ev.ch !== t.ch)) && !!S.battle && S.battle.kind === "attack" && !!S.chars[t.ch] && S.battle.target && S.battle.target.seat === S.chars[t.ch].owner && !!S.chars[S.battle.attacker] && AA4.charStats(S, db, S.battle.attacker).named,   // A3-03 0556 (Revise#249): a name-level character attacks this character's owner and it doesn't guard
    guarded: (ev, w, t, S, db) => ev.e === "guarded" && (!w.self || (!w.asAttacker && ev.ch === t.ch) || (!w.asGuard && ev.attacker === t.ch)) && (!w.attackOnSelf || (!!S.battle && !!S.battle.target && S.battle.target.ch === t.ch)) && (!w.guardOwn || (!!S.chars[ev.ch] && S.chars[ev.ch].owner === t.seat)) && (!w.unbrokenOther || (() => { const o = ev.ch === t.ch ? ev.attacker : ev.ch; return !!S.chars[o] && !AA4.charStats(S, db, o).broken; })())
      && (!w.guardSel || (S.chars[ev.ch] && AA4.matchChar(S, db, w.guardSel, ev.ch, { seat: t.seat })))
      && (!w.oppSel || (o => !!S.chars[o] && AA4.matchChar(S, db, w.oppSel, o, { seat: t.seat }))(ev.ch === t.ch ? ev.attacker : ev.ch)),   // the other side of this guard (Revise#126)
    battleStart: (ev, w, t, S) => ev.e === "battleStart" && (!w.self || (ev.chars.includes(t.ch) && AA4.battleOppsOf(S, t.ch).length > 0)) && (!w.vsCtl || AA4.battleOppsOf(S, t.ch).some(o => S.chars[o] && AA4.isControlled(S.chars[o]) && S.chars[o].owner !== t.seat)) && (!w.asAttacker || (S.battle && S.battle.attacker === t.ch)) && (!w.asGuard || (S.battle && S.battle.guard === t.ch)),   // asAttacker / asGuard: "アタック宣言している / ガード宣言しているこのキャラクターが…" (Revise#157)   // a real battle only (Pack, Revise#112)
    deckEmpty: (ev, w, t) => ev.e === "deckEmpty" && (!w.you || ev.seat === t.seat),   // "あなたのデッキが0枚になった際に" (A3-22 3203, Revise#401)
    reachPlayer: (ev, w, t) => ev.e === "reachedPlayer" && (!w.self || ev.ch === t.ch),   // "このキャラクターがプレイヤーにアタックした場合" — the attack was not guarded (A3-03 0514, Revise#389)
    battleEnd: (ev, w, t, S) => ev.e === "battleEnd" && (!w.self || (ev.chars.includes(t.ch) && AA4.battleOppsOf(S, t.ch).length > 0)) && (!w.vsCtl || (ev.vsCtl || []).includes(t.ch)) && (!w.vsUnbrokenCtl || (ev.vsUnbrokenCtl || []).includes(t.ch)),
    dominated: (ev, w, t) => ev.e === "dominated" && (!w.self || ev.ch === t.ch) && (!w.phaseEnd || ev.phaseEnd),   // "パワーカードフェイズ終了時の効果でこのキャラクターを支配した場合"
    leave: (ev, w, t, S) => ev.e === "defeated" && (!w.self || ev.ch === t.ch || ev.top === t.card) && (!w.battle || ev.battle) && (!w.byOppEffect || (!ev.battle && ev.bySeat != null && ev.bySeat !== t.seat))
      && (!w.own || ev.owner === t.seat) && (!w.controlled || ev.controlled) && (!w.byCtl || (!!ev.by && !!S.chars[ev.by] && AA4.isControlled(S.chars[ev.by]))) && (!w.broken || ev.broken) && (!w.icons || (ev.icons || []).some(i => w.icons.includes(i)))
      && (!w.bySelf || ev.by === t.ch) && (!w.faction || ev.faction === w.faction)
      && (!w.oppCause || (ev.battle ? !!ev.by && !!S.chars[ev.by] && S.chars[ev.by].owner !== t.seat && AA4.isControlled(S.chars[ev.by]) : ev.bySeat != null && ev.bySeat !== t.seat)),   // own / controlled / byCtl: Revise#134; oppCause (Revise#142): "対戦相手の支配キャラクターとのバトル、または対戦相手の使用したカードの効果によって"
    // "このキャラクターがブレイクされた場合" / "≪支配エリアのこのキャラクターをブレイクしたプレイヤー≫は…" (M1a): the card that was on top
    // brokenSelf onChar: a Permanent's "このキャラクターに…ブレイクカードをセットした場合" — the character it is on (A3-24 3541, Pack bug, Revise#289)
    brokenSelf: (ev, w, t, S, db) => ev.e === "broke" && (ev.prevTop === t.card || (w.onChar && t.ch && ev.ch === t.ch && S.cards[t.card] && S.cards[t.card].place.role === "perm")) && (!w.wasControlled || ev.wasControlled) && (!w.hadPower || ev.hadPower) && (!w.own || ev.seat === t.seat)
      && (!w.newSel || (inf => (w.newSel.named == null || !!inf.name === w.newSel.named) && (!w.newSel.faction || inf.faction === w.newSel.faction) && (!w.newSel.tag || (inf.tags || []).includes(w.newSel.tag)) && (!w.newSel.name || String(inf.name || "").replace(/\s+/g, "") === w.newSel.name) && (!w.newSel.otherJp || inf.jp !== ((S.cards[t.card] && db.card(S.cards[t.card].key)) || {}).jp))((S.cards[ev.card] && db.card(S.cards[ev.card].key)) || {}))   // "あなたがこのキャラクターにネームを持つFのブレイクカードをセットした場合" (Revise#176)
      && (!w.works || (S.cards[ev.card] && AA4.worksOf(db.card(S.cards[ev.card].key), w.works)))
      && (!w.nameHas || (S.cards[ev.card] && ((db.card(S.cards[ev.card].key) || {}).name || "").includes(w.nameHas) && (!w.faction || (db.card(S.cards[ev.card].key) || {}).faction === w.faction)))
      && (!w.own || ev.seat === S.cards[t.card].owner) && (!w.byName || (S.cards[ev.card] && (db.card(S.cards[ev.card].key) || {}).name === w.byName)),   // "あなたがこのキャラクターを“X”でブレイクした場合"   // "…を魔法少女リリカルなのはシリーズのカードでブレイク…"
    ownLost: (ev, w, t) => ev.e === "defeated" && ev.controlled && ev.owner === t.seat && (ev.battle || (ev.bySeat != null && ev.bySeat !== t.seat)),   // EP368 (Revise#157)
    killed: (ev, w, t, S, db) => ev.e === "defeated" && (w.anyBattle ? (ev.battle && ev.controlled) : (ev.battle || w.anyDamage) && !!ev.by && (w.bySel ? !!S.chars[ev.by] && S.chars[ev.by].owner === t.seat && AA4.matchChar(S, db, w.bySel, ev.by, { seat: t.seat }) : ev.by === t.ch)) && (!w.controlled || ev.controlled) && (!w.namedVictim || !!ev.named) && (!w.hadPower || !!(ev.stats && ev.stats.pw > 0)),   // "このキャラクターがバトルによって支配キャラクターを捨て札した場合" (Revise#109)
    cardResolved: (ev, w, t, S, db) => ev.e === "resolved" && ev.kind === "set" && !!ev.card && S.cards[ev.card] && w.types.includes((db.card(S.cards[ev.card].key) || {}).type),   // "…カードをセットしたプレイヤー"
    toDamagePile: (ev, w, t, S, db) => ev.e === "moved" && ev.to && ev.to.z === (w.zone || "damage") && ev.from && ev.from.z !== (w.zone || "damage") && S.cards[ev.card] && (!w.types || w.types.includes((db.card(S.cards[ev.card].key) || {}).type)),   // 3424 (Revise#152): "≪ダメージ置き場にプロジェクトカードまたはファストカードが置かれたプレイヤー≫"
    cardDeclared: (ev, w, t, S, db) => ev.e === "declared" && ev.kind === "set" && !!ev.card && S.cards[ev.card] && w.types.includes((db.card(S.cards[ev.card].key) || {}).type) && (!w.targetsSelf || (ev.targets || []).some(x => x.ch === t.ch || (x.card && S.cards[x.card] && S.cards[x.card].place.ch === t.ch))) && (!w.oppOnly || ev.seat !== t.seat),   // "…カードの使用宣言をしたプレイヤー"
    anyDeclared: (ev, w, t) => ((ev.e === "declared" && ev.kind === "effect") || ev.e === "attacked" || ev.e === "guarded") && !!ev.ch && ev.ch !== t.ch && !(ev.e === "attacked" && ev.faction),   // "エフェクトの使用宣言またはアタック宣言またはガード宣言した、…このキャラクター以外のキャラクター"
    playerHurt: (ev, w, t) => ev.e === "playerDamage" && ev.seat === t.seat && (ev.normal + ev.mental) > 0 && !ev.byHand && ev.from !== t.ch && ev.fromSeat != null,   // "あなたがこのカードの効果以外でダメージを受けた場合"
    hitPlayer: (ev, w, t, S) => ev.e === "playerDamage" && !ev.byHand && !!S.battle && (w.by === "self" ? ev.from === t.ch : w.to === "you" ? ev.seat === t.seat : true),   // "目標がプレイヤーにアタックした場合、通常のダメージ判定の後" / "あなたがアタックを受けた場合、…" (Revise#166)
    damaged: (ev, w, t, S) => ev.e === "damaged" && (!w.self || ev.ch === t.ch) && (!w.nonBattle || !ev.battle) && (!w.byOppSeat || (ev.fromSeat != null && ev.fromSeat !== t.seat)) && (!w.hurt || ((ev.normal || 0) + (ev.mental || 0)) > 0) && (!w.byThisAny || (ev.from === t.ch && ((ev.normal || 0) + (ev.mental || 0)) > 0)) && (!w.byThisBattle || (ev.from === t.ch && ev.battle && ((ev.normal || 0) + (ev.mental || 0)) > 0)) && (!w.byThis || (ev.from === t.ch && ev.battle && ((ev.normal || 0) + (ev.mental || 0)) > 0 && !!S.chars[ev.ch] && AA4.isControlled(S.chars[ev.ch]))),   // byThis: 3011 (Revise#152)
    brokeBy: (ev, w, t, S, db) => ev.e === "broke" && ev.ch !== t.ch && !!S.cards[ev.card] && (db.card(S.cards[ev.card].key) || {}).name === w.byName
      && !!ev.prevTop && !!S.cards[ev.prevTop] && (db.card(S.cards[ev.prevTop].key) || {}).name === w.prevName,   // "”ふぶき”がクロス・フレイム“なつきとふぶき”にブレイクされる場合" (Revise#132)
    permOnto: (ev, w, t, S) => ev.e === "entered" && !!S.cards[ev.card] && S.cards[ev.card].place.z === "char" && S.cards[ev.card].place.role === "perm" && (!w.self || ev.ch === t.ch),   // "このキャラクターにパーマネントカードがセットされた場合" (Revise#166)
    selfToDamage: (ev, w, t, S) => (!w.phase || (S && S.turn.phase === w.phase)) && ev.e === "moved" && ev.card === t.card && ev.to && ev.to.z === (w.zone || "damage") && ev.from && ev.from.z !== (w.zone || "damage") && (!w.fromZone || ev.from.z === w.fromZone) && (!w.byCheck || !!ev.byCheck),   // "このカードが(ダメージ判定によって)ダメージ置き場に置かれた際" (Revise#164)
    ownBreakFirst: (ev, w, t, S, db) => ev.e === "broke" && ev.seat === t.seat && !!S.cards[ev.card] && (i => (!w.faction || i.faction === w.faction) && (!w.named || !!i.name) && i.type === "Break")(db.card(S.cards[ev.card].key) || {})
      && (u => !!u && u.turn === S.turn.number && u.keys.filter(k => (i2 => i2.type === "Break" && (!w.faction || i2.faction === w.faction) && (!w.named || !!i2.name))(db.card(k) || {})).length === 1)(S.players[t.seat].usedTurn),   // A3-25 3617 … (Revise#164): "それがこのターンにあなたが最初にセットしたFのブレイクカードならば"
    broken: (ev, w, t, S, db) => ev.e === "broke" && (!w.self || ev.ch === t.ch) && (!w.oppTerritory || (ev.seat != null && !!S.chars[ev.ch] && S.chars[ev.ch].owner !== ev.seat)) && (!w.cardNamed || (S.cards[ev.card] && !!(db.card(S.cards[ev.card].key) || {}).name)) && (!w.prevNamed || (ev.prevTop && S.cards[ev.prevTop] && !!(db.card(S.cards[ev.prevTop].key) || {}).name)) && (!w.cardName || (S.cards[ev.card] && (db.card(S.cards[ev.card].key) || {}).name === w.cardName)) && (!w.own || ev.seat === t.seat) && (!w.cardFaction || (S.cards[ev.card] && (db.card(S.cards[ev.card].key) || {}).faction === w.cardFaction)) && (!w.cardTag || (S.cards[ev.card] && ((db.card(S.cards[ev.card].key) || {}).tags || []).includes(w.cardTag))) && (!w.cardOtherJp || (S.cards[ev.card] && S.cards[t.card] && (db.card(S.cards[ev.card].key) || {}).jp !== (db.card(S.cards[t.card].key) || {}).jp))
      && (!w.cardSel || (S.cards[ev.card] && (i => (!w.cardSel.named || !!i.name) && (!w.cardSel.faction || i.faction === w.cardSel.faction))(db.card(S.cards[ev.card].key) || {}))) && (!w.oppChar || (ev.owner != null && ev.owner !== t.seat)),   // "≪対戦相手のテリトリーのキャラクターをブレイクしたプレイヤー≫は…"
    turnStart: (ev, w, t, S) => ev.e === "turn" && (!w.mine || ev.player === t.seat),
    bindUsed: (ev, w, t) => ev.e === "keptOnField" && ev.ch === t.ch && /^Bind/.test(String(ev.how || "")),   // "このキャラクターのバインドXのスキルを使用した場合" (EX0599, Revise#208)
    turnEnd: (ev, w, t, S) => ev.e === "turnEnd" && (!w.mine || ev.player === t.seat),
    phaseStart: (ev, w, t) => ev.e === "phase" && (!w.phase || ev.phase === w.phase) && (!w.mine || ev.player === t.seat) && (!w.others || ev.player !== t.seat),
    phaseEnd: (ev, w, t) => ev.e === "phaseEnd" && (!w.phase || ev.phase === w.phase) && (!w.mine || ev.player === t.seat),   // "…フェイズ終了時に"
    resolved: (ev, w, t) => ev.e === "resolved" && (!w.self || ev.card === t.card),
    // "支配エリアの<icons>がプレイヤーに対してアタック宣言するか、支配キャラクターのアタック宣言に対してガード宣言した場合"
    iconAct: (ev, w, t, S, db) => {
      const has = id => !!S.chars[id] && AA4.isControlled(S.chars[id]) && AA4.charStats(S, db, id).icons.some(i => w.icons.includes(i));
      if (ev.e === "attacked") return !ev.faction && ev.target && ev.target.seat != null && has(ev.ch);
      if (ev.e === "guarded") return has(ev.ch) && !!S.chars[ev.attacker] && AA4.isControlled(S.chars[ev.attacker]);
      return false;
    },
  };
  /** Cards on the field (and in other zones for zone abilities) with trigger abilities. */
  function triggerSources(S, db) {
    const out = [];
    for (const c of Object.values(S.cards)) {
      const info = c.thread ? null : db.card(c.key);   // “糸” (Revise#135)
      if (!info || !info.abilities || !info.abilities.length) continue;
      const ch = AA4.charOfCard(S, c.id);
      info.abilities.forEach((ab, i) => {
        if (ab.kind !== "trigger" || !ab.when) return;
        const zone = ab.zones ? (ab.zones.includes(c.place.z) ? c.place.z : "__no") : ab.zone || "field";   // zones: "あなたの手札またはダメージ置き場にあるこのカード" (Revise#164)
        if (zone === "__no") return;
        if (zone === "field") {
          if (!ch) return;
          if (c.place.role === "stack" && AA4.topOf(ch) !== c.id && !AA4.inheritedCards(S, db, ch).includes(c.id)) return;   // only the top card's abilities count (and inherited ones)
          if (c.place.role === "power") return;
        } else if (c.place.z !== zone || (zone === "damage" && AA4.damageTextOff && AA4.damageTextOff(S, db))) return;
        out.push({ card: c.id, ch: ch ? ch.id : null, seat: c.owner, ab, i });
      });
    }
    return out;
  }
  /** Cards that just left the top of a character (broken) or the field (defeated): their "when this character is broken /
      leaves" triggers still answer that one event (they look back at the card as it was). */
  const LOOKBACK = { broke: ["brokenSelf"], defeated: ["leave"] };
  function lookbackSources(S, db, ev, srcs) {
    const card = ev.e === "broke" ? ev.prevTop : ev.e === "defeated" ? ev.top : null;
    if (!card || !S.cards[card]) return [];
    const info = db.card(S.cards[card].key);
    if (!info || !info.abilities) return [];
    const out = [];
    info.abilities.forEach((ab, i) => {
      if (ab.kind !== "trigger" || !ab.when || !LOOKBACK[ev.e].includes(ab.when.event) || (ab.zone && ab.zone !== "field")) return;
      if (srcs.some(x => x.card === card && x.i === i)) return;
      const ch = AA4.charOfCard(S, card);
      out.push({ card, ch: ch ? ch.id : (S.chars[ev.ch] ? ev.ch : null), seat: S.cards[card].owner, ab, i, lookback: true });
    });
    return out;
  }
  /** Look at the events since `from` and add matching triggers. Returns true when something was added / queued. */
  AA4.collectTriggers = (ctx, from) => {
    const S = ctx.S, evs = ctx.events.slice(from);
    if (!evs.length || S.stage !== "play") return false;
    const srcs = triggerSources(S, ctx.db);
    let any = false;
    for (const ev of evs) for (const t of LOOKBACK[ev.e] ? srcs.concat(lookbackSources(S, ctx.db, ev, srcs)) : srcs) {
      const fn = AA4.TRIGGER_MATCH[t.ab.when.event];
      if (!fn || !fn(ev, t.ab.when, t, S, ctx.db)) continue;
      if (t.ab.when.chSel && !(ev.ch && S.chars[ev.ch] && AA4.matchChar(S, ctx.db, t.ab.when.chSel, ev.ch, { seat: t.seat }))) continue;   // "≪ガード宣言した▼を持つブレイクしていないキャラクター≫" (A4-PP PP170, Revise#318)
      if (t.lookback && t.ab.when.event === "brokenSelf" && ev.e !== "broke") continue;
      if (t.ab.cond && !AA4.checkCond(S, ctx.db, t.ab.cond, { seat: t.seat, ch: t.ch, card: t.card })) continue;   // "このカードが「X」にセットされた場合"
      const tr = { id: AA4.newId(S, "t"), seat: t.seat, card: t.card, ch: t.ch, ability: t.i, event: ev.e, evActor: ev.seat != null ? ev.seat : null, optional: !!t.ab.optional, evSeat: ev.e === "moved" ? (ev.to && ev.to.seat != null ? ev.to.seat : null) : ev.e === "resolved" || ev.e === "declared" ? ev.seat : ev.e === "playerDamage" ? ev.fromSeat : ev.e === "defeated" && ev.owner != null ? ev.owner : ev.player != null ? ev.player : ev.ch && S.chars[ev.ch] ? S.chars[ev.ch].owner : ev.seat != null ? ev.seat : null, evCh: ev.ch || null, evCard: ev.card || null, evItem: ev.item || null, evBy: ev.e === "defeated" ? ev.by || null : null, evCards: ev.breaks || null, evAll: ev.e === "defeated" ? ev.cards || null : null, evStack: ev.e === "defeated" ? ev.stack || null : null, evName: ev.e === "defeated" && ev.named ? ev.name : null, evHit: ev.e === "playerDamage" ? ev.seat : null, evStat: ev.stats || (ev.e === "damaged" && ev.ch ? { n: (ev.normal || 0) + (ev.mental || 0) } : null) || ((ev.e === "resolved" || ev.e === "declared") && ev.card && S.cards[ev.card] ? { cost: +((ctx.db.card(S.cards[ev.card].key) || {}).cost) || 0 } : null) };
      if (t.ab.ownerDecides && tr.evSeat != null) tr.seat = tr.evSeat;   // "≪そのキャラクターのオーナー≫は…可能": that player decides
      const needsTarget = t.ab.effect && t.ab.effect.target && t.ab.effect.target.count !== "all";
      if (!needsTarget && !tr.optional) { AA4.enqueue(S, [{ op: "runTrigger", tr }]); any = true; continue; }   // a mandatory ability runs at once (Revise#162); a "…可能" one asks (Pack, Q#64 / Revise#165 — a player option runs them without asking)
      S.triggers.push(tr);
      ctx.emit({ e: "triggerWaiting", trigger: tr.id, seat: tr.seat, card: tr.card });
      any = true;
    }
    /* Lasting watchers from a Project / Fast card (Revise#166): a modifier {key: "watchEv", value: {event, when, ch?, fromSel?, cardSel?, effect, once?, asOwner?}}
       — "目標がバトルした場合、バトル終了時に≪このカード≫を捨て札する", "メインフェイズ終了時まで、アンドロイドがダメージを与えた場合、≪そのキャラクター≫は捨て札される" … */
    for (const ev of evs) for (const m of S.modifiers.filter(x => x.key === "watchEv" && x.value && !x.done)) {
      const w = m.value, t = { seat: m.src ? m.src.seat : null, card: m.src ? m.src.card : null, ch: w.ch || null }, fn = AA4.TRIGGER_MATCH[w.event];
      if (!fn || !fn(ev, w.when || {}, t, S, ctx.db)) continue;
      let evCh = ev.ch || null;
      if (w.fromSel) { if (!(ev.e === "damaged" && ev.from && S.chars[ev.from] && ((ev.normal || 0) + (ev.mental || 0)) > 0 && AA4.matchChar(S, ctx.db, w.fromSel, ev.from, { seat: t.seat }))) continue; evCh = ev.from; }
      if (w.chSel && !(ev.ch && S.chars[ev.ch] && AA4.matchChar(S, ctx.db, w.chSel, ev.ch, { seat: t.seat }))) continue;
      if (w.battleSel) {   // "…キャラクターがバトルする際、≪そのキャラクターのバトル相手…≫" (EXPR035, Revise#217): evCh = that character's battle opponent
        const me = (ev.chars || []).find(id => S.chars[id] && AA4.matchChar(S, ctx.db, w.battleSel, id, { seat: t.seat }));
        const op0 = me ? AA4.battleOppsOf(S, me)[0] : null; if (!op0) continue; evCh = op0;
      }
      if (w.cardSel && !(ev.ch && S.chars[ev.ch] && S.chars[ev.ch].stack.includes(ev.card) && AA4.matchChar(S, ctx.db, w.cardSel, ev.ch, { seat: t.seat }))) continue;
      if (w.ch && !S.chars[w.ch]) continue;
      if (w.attSel && !(ev.attacker && S.chars[ev.attacker] && AA4.matchChar(S, ctx.db, w.attSel, ev.attacker, { seat: t.seat }))) continue;   // "<分類>のアタック宣言に対してガード宣言したキャラクター" (PP216, Revise#342)
      if (w.bySrc && !(ev.ch && m.src && ev.ch === m.src.ch)) continue;   // "このキャラクターのアタック宣言に対して…" (A3-04 0676, Revise#249)
      if (w.useBound) evCh = w.ch;
      if (w.oppOfBound) { const o = w.ch ? AA4.battleOppsOf(S, w.ch)[0] : null; if (!o) continue; evCh = o; }   // "目標がバトルする際、目標のバトル相手の…" (EX0602, Revise#217)
      if (w.evBy) evCh = ev.by || null;
      if (w.attOwn && !(ev.attacker && S.chars[ev.attacker] && S.chars[ev.attacker].owner === t.seat && AA4.isControlled(S.chars[ev.attacker]))) continue;   // "あなたの支配キャラクターのアタック宣言に対してガード宣言したキャラクター" (A3-22 3235, Revise#258)
      if (w.evAttacker) { evCh = ev.attacker || null; if (!evCh) continue; }   // "目標にガードされたキャラクター" (A3-07 1106, Revise#255)
      if (w.once) m.done = true;
      const owner = ev.card && S.cards[ev.card] ? S.cards[ev.card].owner : evCh && S.chars[evCh] ? S.chars[evCh].owner : ev.e === "defeated" && ev.owner != null ? ev.owner : null;   // a discarded character is gone: its owner from the event (Revise#203)
      AA4.enqueue(S, [{ op: "runWatchEv", mid: m.id, seat: w.asOwner && owner != null ? owner : t.seat, card: t.card, evCh, evSeat: owner, evActor: ev.seat != null ? ev.seat : null, evCard: ev.card || null, wCh: w.ch || null, evHit: ev.e === "playerDamage" ? ev.seat : null }]);
      any = true;
    }
    return any;
  };
  OPS.runWatchEv = (ctx, op) => {
    const S = ctx.S, m = S.modifiers.find(x => x.id === op.mid);
    if (!m || !m.value.effect) return;
    if (m.value.optional) {   // "…した場合、≪そのキャラクター≫に…ことが可能" (EP446, Revise#344): asked each time until it is used
      if (!op.answer) return AA4.ask(ctx, { seat: op.seat, kind: "yesno", reason: `${op.card && S.cards[op.card] ? AA4.cardName(ctx.db.card(S.cards[op.card].key)) : "Effect"}: use it now?`, then: [Object.assign({}, op)] });
      if (op.answer[0] !== "yes") { if (m.value.once) m.done = false; return; }   // not used: it may be used the next time (EX874, Revise#367)
    }
    if (m.value.once) AA4.endMod(ctx, m.id);
    AA4.runEffect(ctx, Object.assign({}, m.value.effect, { x: null }), { seat: op.seat, card: op.card, ch: null, evSeat: op.evSeat, evActor: op.evActor != null ? op.evActor : null, evCh: op.evCh, evCard: op.evCard, wCh: op.wCh || null, evHit: op.evHit != null ? op.evHit : null, x: m.value.x != null ? m.value.x : null, targets: m.value.targets || undefined });
    AA4.enqueue(S, [{ op: "mentalCheck" }, { op: "permCheck" }]);
  };
  OPS.runTrigger = (ctx, op) => {
    const S = ctx.S, tr = op.tr, c = S.cards[tr.card], info = c && ctx.db.card(c.key), ab = info && info.abilities[tr.ability];
    if (!ab) return;
    ctx.emit({ e: "triggerRun", card: tr.card, seat: tr.seat, text: ab.text || "" });
    if (AA4.runEffect) AA4.runEffect(ctx, ab.effect || { steps: [{ a: "manual", text: ab.text }] }, { seat: tr.seat, card: tr.card, ch: tr.ch, abText: ab.text || null, evSeat: tr.evSeat, evActor: tr.evActor != null ? tr.evActor : null, evHit: tr.evHit != null ? tr.evHit : null, evCh: tr.evCh, evCard: tr.evCard || null, evItem: tr.evItem || null, evBy: tr.evBy || null, evCards: tr.evCards, evAll: tr.evAll || null, evStack: tr.evStack || null, evStat: tr.evStat || null, evName: tr.evName || null, targets: op.targets || [] });
    AA4.enqueue(S, [{ op: "mentalCheck" }, { op: "permCheck" }]);
  };
  INTENTS.trigger = {
    undoable: true,
    check(ctx, it) {
      const S = ctx.S, tr = S.triggers.find(x => x.id === (it.trigger || it.id));   // "trigger": the ability's id ("id" is the log entry's own id in a room — Revise#151)
      if (!tr) return "No such triggered ability";
      if (AA4.seatFor(S, Object.assign({}, it, { seat: it.seat == null ? tr.seat : it.seat })) !== tr.seat) return "Not your ability";
      if (AA4.busy(S)) return AA4.busy(S);
      if (!it.run) return tr.optional ? null : "This ability is not optional";
      const c = S.cards[tr.card], ab = ctx.db.card(c.key).abilities[tr.ability];
      const spec = ab.effect && ab.effect.target;
      if (spec && spec.count !== "all" && AA4.checkTargets) return AA4.checkTargets(S, ctx.db, spec, it.targets || [], { seat: tr.seat, ch: tr.ch, card: tr.card });
      return null;
    },
    apply(ctx, it) {
      const S = ctx.S, i = S.triggers.findIndex(x => x.id === (it.trigger || it.id)), tr = S.triggers[i];
      S.triggers.splice(i, 1);
      if (it.run) AA4.enqueue(S, [{ op: "runTrigger", tr, targets: it.targets || [] }]);   // Pack (Revise#162): an ability runs at once — not put into Resolve, nobody answers it (was Q#29)
      else ctx.emit({ e: "triggerSkipped", trigger: tr.id, seat: tr.seat });
    },
  };

  /* ---------- Game Status → Skip (Pack, Revise#151): move a stuck game one step on ----------
     Any seated player may use it. One step per use, in this order: answer the oldest choice (the fewest options),
     drop operations that stay queued, skip the oldest triggered ability, cancel a declaration in progress (refund),
     "no guard" for the attacked player, or pass for the player with priority. Logged, and Undo works as usual. */
  AA4.unstickPlan = S => {
    const P = s => (S.players[s] ? S.players[s].name : "seat " + s);
    if (S.decisions.length) {
      const d = S.decisions[0], pick = d.kind === "order" ? d.options.slice() : d.kind === "yesno" && d.min >= 1 ? [d.options[d.options.length - 1]] : d.options.slice(0, d.min || 0);
      return { what: `answered “${d.reason || "a choice"}” for ${P(d.seat)}`, run: ctx => INTENTS.choose.apply(ctx, { decision: d.id, pick }) };
    }
    if (S.queue.length) return { what: `dropped ${S.queue.length} stuck operation(s)`, run: () => { S.queue.length = 0; } };
    if (S.triggers.length) { const tr = S.triggers[0]; return { what: `skipped a triggered ability of ${P(tr.seat)}`, run: ctx => INTENTS.trigger.apply(ctx, { trigger: tr.id, run: false }) }; }
    if (S.draft) return { what: `cancelled the declaration of ${P(S.draft.seat)} (refunded)`, run: () => AA4.enqueue(S, [{ op: "refund", why: "cancelled (Skip)" }]) };
    if (S.battle && S.battle.step === "guard" && S.battle.defender != null) return { what: `no guard for ${P(S.battle.defender)}`, run: ctx => { S.battle.step = "response"; S.passed = []; ctx.emit({ e: "noGuard", seat: S.battle.defender }); } };
    if (AA4.responseOpen(S)) {
      const now = AA4.priorityNow(S);
      if (now != null) return { what: `passed for ${P(now)}`, run: ctx => { S.passed.push(now); ctx.emit({ e: "passed", seat: now }); } };
    }
    return null;
  };
  INTENTS.unstick = {
    undoable: true,
    check(ctx, it) {
      const S = ctx.S;
      if (AA4.seatFor(S, it) == null) return "You are not playing at this table";
      if (S.stage !== "play") return "The game has not started yet";
      return AA4.unstickPlan(S) ? null : "Nothing is waiting — the turn player can act";
    },
    apply(ctx, it) {
      const plan = AA4.unstickPlan(ctx.S);
      ctx.emit({ e: "unstuck", seat: AA4.seatFor(ctx.S, it), what: plan.what });
      plan.run(ctx);
    },
  };

  /* ---------- the flow loop ---------- */
  AA4.advance = ctx => {
    const S = ctx.S;
    let seen = 0;
    for (let guard = 0; guard < 10000; guard++) {
      if (AA4.runQueue(ctx) === AA4.PAUSE) { if (ctx.events.length > seen) AA4.collectTriggers(ctx, seen); return; }   // Pack bug (Revise#224): a choice asked on the way (e.g. 3723 at the next Draw) used to drop the events before it — A3-20 2835's "ターン終了時に" never ran
      if (S.stage === "over") return;
      let did = false;
      for (const fn of AA4.STATE_CHECKS) if (fn(ctx)) { did = true; break; }
      if (did) continue;
      if (S.stage === "over") return;
      const n = ctx.events.length;
      if (n > seen) { const from = seen; seen = n; if (AA4.collectTriggers(ctx, from)) continue; }
      if (S.decisions.length) return;
      if (S.queue.length) continue;
      for (const fn of AA4.FLOW) if (fn(ctx)) { did = true; break; }
      if (!did) return;
    }
    throw new Error("the game does not settle (flow loop)");
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
