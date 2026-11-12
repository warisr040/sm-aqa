/* ==========================================================================
   v4 engine · Declare System, Cost System, Resolve System   (requirements_v4 §2, §4, §6; step B2)

   A declaration goes through one state machine (Revise#012 / #059):
     declare {kind, …}  → S.draft (step "pay")   — the reason is given if it can't be declared at all
     pay {cards}        → paid power cards wait in the Cost screen (zone "cost")   (skipped when the cost is 0)
     target {targets}   → (skipped when nothing has to be chosen)
     → it enters the Resolve list (S.stack) — or, for attack / guard, the battle goes on (14-battle.js)
     cancel             → at any step before it enters: paid power cards go back to their characters (refund)
   Kinds:
     set     {card, x?}            Character: placed at once, no cost (Revise#067). Break / Permanent / Fast / Project:
                                    cost from any of your Controlled Characters; Fast / Project go to the Special Area.
     effect  {ch, card, i, x?}      effect line i of that card (the top card or a permanent of ch); cost from ch.
     attack  {ch, target, boost?}   target {seat} (another player) or {ch} (an Active Character in your Active Area).
     guard   {ch}                   the attacked player, Guard step.
   Cost destination (Revise#029): when the declaration is complete, the paid cards go where the Cost Destination
   Rules say — one rule → automatically, several → the owner chooses, none → Discard Pile.
   Resolution (Revise#014): only the newest item, when everyone in needPass() passed. Set: required factor,
   target still valid, name rule, Break restriction — a failed one goes to the Discard Pile (no refund).
   ========================================================================== */
(function (G) {
  "use strict";
  const AA4 = G.AA4, OPS = AA4.OPS, INTENTS = AA4.INTENTS;
  const info = (ctx, id) => AA4.cardInfo(ctx.S, ctx.db, id);
  const CHAIN_TYPES = new Set(["Break", "Permanent", "Fast", "Project"]);

  /* ---------- helpers ---------- */
  /** Own Controlled Characters. */
  AA4.controlledOf = (S, seat) => AA4.charsOf(S, seat).filter(chId => AA4.isControlled(S.chars[chId]));
  const powerOf = (S, chs) => chs.reduce((n, chId) => n + S.chars[chId].power.length, 0);
  /** A name-level card's personal name already on the field (except on character `except`)? */
  AA4.nameOnField = (S, db, name, except, info) => !!name && !(info && info.multiName) && Object.values(S.chars).some(ch => ch.id !== except && ch.stack.some(id => (db.card(S.cards[id].key) || {}).name === name) && !(ch.perm.length && AA4.charStats(S, db, ch.id).sameNameMulti));   // A3-09 1316 (Revise#253): "…同じネームを持つキャラクターは、2体以上同時に場に存在できる"
  /** Required factor (Revise#014): at least N Controlled Characters of that faction, for each faction of the factor. */
  AA4.firstInMain = (S, seat, type) => S.turn.phase === "main" && !(S.players[seat].mainCount && S.players[seat].mainCount.turn === S.turn.number && S.players[seat].mainCount[type]);
  /** The factors a player has now, per faction (Pack, Revise#306 — shown in the hand bar): Controlled Characters of that faction + their factor bonuses + "全ての勢力のファクターをX得る". */
  AA4.factorsHave = (S, db, seat) => {
    const out = {}, allBonus = AA4.allMods(S, db).filter(m => m.key === "factorAll" && AA4.modAppliesToSeat(S, m, seat)).reduce((k, m) => k + (+AA4.modValue(S, db, m) || 0), 0);
    for (const f of ["E.G.O.", "Arayashiki", "WIZ-DOM", "Darklore", "Polestar Empire", "Eraser"]) out[f] = allBonus;
    out.Nether = 0;   // 冥 (A4-03, Revise#310): a factor of its own — characters with the 冥 mark, and "≪あなた≫は冥を1つ得る"
    for (const chId of AA4.controlledOf(S, seat)) {
      const st = AA4.charStats(S, db, chId); if (st.noFactor) continue;
      if (st.faction && out[st.faction] != null) out[st.faction]++;
      for (const [f, n] of Object.entries(st.factorBonus || {})) if (out[f] != null) out[f] += +n || 0;
      const top = S.chars[chId] && S.chars[chId].stack[0], inf = top != null && S.cards[top] ? db.card(S.cards[top].key) || {} : {};
      if ((inf.tags || []).includes("冥")) out.Nether++;
    }
    // "≪あなた≫はE.G.O.のファクターを1つ得る" (a player, not a character): counted too (Revise#310)
    for (const m of AA4.allMods(S, db)) if (m.key === "factor" && m.to && !m.to.ch && !m.to.all && AA4.modAppliesToSeat(S, m, seat) && m.value && out[m.value.faction] != null) out[m.value.faction] += +m.value.n || 0;
    return out;
  };
  AA4.factorOk = (S, db, seat, inf) => {
    if (inf.altFactor) { const r1 = AA4.factorOk(S, db, seat, Object.assign({}, inf, { altFactor: null })); return r1 && [].concat(inf.altFactor).every(f2 => AA4.factorOk(S, db, seat, Object.assign({}, inf, { factor: f2, altFactor: null }))) ? r1 : null; }   // "必要ファクターはダダでも満たすことが可能" (PP239, Revise#343)
    if (AA4.allMods(S, db).some(m => m.key === "factorIgnore" && AA4.modAppliesToSeat(S, m, seat) && (!m.value || !m.value.firstInMain || AA4.firstInMain(S, seat, inf.type)) && (!m.value || !m.value.type || m.value.type === inf.type) && (!m.value || !m.value.icons || (inf.icons || []).some(i => m.value.icons.includes(i))) && (!m.value || !m.value.jpHas || (inf.jp || "").includes(m.value.jpHas)) && (!m.value || !m.value.names || m.value.names.includes(String(inf.name || "").replace(/\s+/g, ""))))) return null;   // "≪あなた≫は、…を持つブレイクカードを必要ファクターを無視してセット可能" (Revise#111)
    const f = Object.assign({}, inf.factor || {});
    if (inf.factorLessIf && AA4.checkCond(S, db, inf.factorLessIf.cond, { seat })) inf = Object.assign({}, inf, { factorLessN: (inf.factorLessN || 0) + inf.factorLessIf.n, factorLessIf: null });   // Revise#259: "あなたが先攻でない場合、≪このカード≫の必要ファクターは1減少する"
    for (let k = 0; k < (inf.factorLessN || 0); k++) { const top = Object.keys(f).sort((a, b) => f[b] - f[a])[0]; if (top && f[top] > 0) f[top]--; }
    if (inf.factorLessX) for (let k = 0, n = AA4.xOf(S, db, inf.factorLessX, { seat }); k < n; k++) { const top = Object.keys(f).sort((a, b) => f[b] - f[a])[0]; if (top && f[top] > 0) f[top]--; }   // "このカードの必要ファクターは、あなたのダメージ置き場のカード枚数分減少する"
    // "≪“X”のネームを持つブレイクカード≫の必要ファクターは1減少する" (M1c): the largest part of the factor goes down
    for (const m of AA4.allMods(S, db)) if (m.key === "factorLess" && AA4.modAppliesToSeat(S, m, seat)) {
      const sel = (m.value && m.value.sel) || {};
      if (sel.types && !sel.types.includes(inf.type)) continue;
      if (sel.icons && !(inf.icons || []).some(i => sel.icons.includes(i))) continue;
      if (sel.tag && !(inf.tags || []).includes(sel.tag)) continue;   // EX0428 (Revise#157)
      if (sel.named != null && !!inf.name !== sel.named) continue;
      if (sel.works && !AA4.worksOf(inf, sel.works)) continue;
      if (sel.notFaction && inf.faction === sel.notFaction) continue;   // EX790 (Revise#343): "E.G.O.以外の…"
      if (sel.names && !sel.names.includes(String(inf.name || "").replace(/\s+/g, ""))) continue;   // "“A”または“B”のネームを持つブレイクカード" (EX0482, Revise#208)
      if (m.value && m.value.firstInTurn) { const u = S.players[seat].usedTurn; if (u && u.turn === S.turn.number && u.keys.some(k => { const i2 = db.card(k) || {}; return (!sel.types || sel.types.includes(i2.type)) && (sel.named == null || !!i2.name === sel.named) && (!sel.works || AA4.worksOf(i2, sel.works)); })) continue; }   // EX0389
      if (sel.name && inf.name !== sel.name) continue;
      for (let k = 0; k < (+(m.value && m.value.n) || 0); k++) { const top = Object.keys(f).sort((a, b) => f[b] - f[a])[0]; if (top && f[top] > 0) f[top]--; }
      if (m.value && m.value.up) { const up = typeof m.value.up === "object" ? AA4.xOf(S, db, m.value.up.x, m.src || {}) : +m.value.up || 0; const fa = inf.faction || Object.keys(f)[0]; if (fa && up > 0) f[fa] = (f[fa] || 0) + up; }   // "≪…プロジェクトカード・ファストカード≫の必要ファクターに+Xする" (Revise#109)
    }
    const haveAll = AA4.factorsHave(S, db, seat);   // one count for everything: Controlled Characters, "全ての勢力のファクターをX得る", a player's own factor gains, 冥 (Revise#315)
    for (const [faction, n] of Object.entries(f)) {
      const have = haveAll[faction] || 0;
      if (have < n) return `Factor: ${n} ${faction} needed, ${have} controlled`;
    }
    return null;
  };

  /** The card's own reductions of its factor and cost: "先攻以外のプレイヤーは、…Nずつ減少" / "場に“X”がいる場合、…1ずつ減少" (Revise#129 / #157; used at the declaration and again when it resolves, Revise#316). */
  AA4.cardSelfLess = (S, db, seat, inf) => (inf.notFirstLess && S.turn.order[0] !== seat ? inf.notFirstLess : 0) + (inf.lessIfName && Object.keys(S.chars).some(id => AA4.charStats(S, db, id).name === inf.lessIfName) ? 1 : 0);
  /** Can Break card `cardId` (of seat) break character chId? (Revise#016) → null or reason. force = icon exception confirmed by the player. */
  AA4.breakReason = (S, db, seat, cardId, chId, force, binf) => {
    if (S.chars[chId] && AA4.charStats(S, db, chId).noSet) return "No card can be set on it";   // a token: "…にカードをセットすることはできない"
    const ch = S.chars[chId];
    if (!ch) return "The character is gone";
    const b = binf || AA4.cardInfo(S, db, cardId), st = AA4.charStats(S, db, chId);
    if (st.noBreakByOpp && seat !== ch.owner) return "Other players can't set Break cards on it now";   // A3-24 3583 (Revise#170)
    const rule0 = S.cards[cardId] && S.cards[cardId].noRule ? {} : b.breakRule || {};
    if (ch.owner !== seat && ch.power.length && !(rule0.powerUnnamed && !st.named) && !st.breakWithPower) return "An opponent's character with power cards can't be broken";   // 3610 (Revise#152): "パワーカードのセットされているネームレベルでないキャラクターをブレイク可能"
    if (st.untargetable.some(u => !u.from || u.from === "Break")) return "It can't be chosen";
    const rule = S.cards[cardId] && S.cards[cardId].noRule ? {} : b.breakRule || {};   // noRule: "…ブレイク条件を無視して…セット宣言可能" (Revise#143)   // 【…のみブレイク可能】 etc., compiled by tools/rules_compile.py
    if (rule.onlyName && st.name !== rule.onlyName && !st.alsoNames.includes(rule.onlyName)) return `Only “${rule.onlyName}” can be broken with this card`;
    if (rule.onlyJp && !ch.stack.some(id => ((db.card(S.cards[id].key) || {}).jp || "").replace(/\s+/g, "") === rule.onlyJp)) return `Only “${rule.onlyJp}” can be broken with this card`;   // Revise#157: a card name
    if (rule.stackJp && !rule.stackJp.every(j => ch.stack.some(id => ((db.card(S.cards[id].key) || {}).jp || "").replace(/\s+/g, "") === j))) return `Only a character made of ${rule.stackJp.map(j => "「" + j + "」").join(" and ")}`;   // PR336 (Revise#157)
    if (rule.onlyNames && !rule.onlyNames.some(n => st.name === n || st.alsoNames.includes(n))) return `Only ${rule.onlyNames.map(n => "“" + n + "”").join(" / ")} can be broken with this card`;   // Revise#152
    if (rule.onlyBroken && !st.broken) return `Only a broken “${rule.onlyName || "character"}”`;
    if (rule.onlyMental && !st.atMental) return "Only a character with mental Attack";
    if (rule.onlyPower != null && ch.power.length !== rule.onlyPower) return `Only a character with power ${rule.onlyPower}`;   // Revise#268
    if (rule.namedGoneTurn && !(S.turn.namedGone && S.turn.namedGone.turn === S.turn.number && S.turn.namedGone.seats.includes(seat))) return "Only in a turn when a name-level character in your Control Area was discarded";   // EP437 (Revise#228)
    if (rule.ifNameOnField && !Object.values(S.chars).some(c2 => AA4.charStats(S, db, c2.id).name === rule.ifNameOnField)) return `Only while “${rule.ifNameOnField}” is on the field`;   // Revise#143   // Revise#138
    const byName = (st.breakByNames || []).includes(b.name);   // ラユュー (Revise#137): "ネーム・分類に関わらず、≪このキャラクター≫を“ラユュー”でブレイク可能"
    if (st.named && b.name !== st.name && !st.alsoNames.includes(b.name) && !rule.anyName && !(rule.names || []).includes(st.name) && !st.breakIgnoreName && !byName && !(st.breakNameOk || []).includes(b.name)) return `“${st.name}” can only be broken by a Break card with the same name`;
    if (rule.onlyOwn && ch.owner !== seat) return "Only your own characters";
    if (rule.onlyOthers && ch.owner === seat) return "Only other players' characters";
    const iconOk = rule.anyIcon || byName || (rule.anyIconGuarding && S.battle && S.battle.guard === chId) || st.icons.some(i => (b.icons || []).includes(i)) || (rule.anyIconFaction && rule.anyIconFaction === st.faction) || ((rule.anyIconFactions || []).includes(st.faction)) || (rule.anyIconActive && ch.at.area === "active") || (rule.anyIconOwnAggr && ch.owner === seat && !!st.skills.aggressive)
      || (rule.anyIconControlled && AA4.isControlled(ch)) || (rule.anyIconUnbroken && !st.broken) || !!rule.anyIconAnyFaction || (rule.anyIconOf && st.icons.some(i => rule.anyIconOf.includes(i)))
      || st.breakableAny.some(v => (!v.faction || v.faction === b.faction) && (!v.works || AA4.worksOf(b, v.works)))   // "分類に関わらず、≪このキャラクター≫を(E.G.O.のブレイクカードで)ブレイク可能"
      || AA4.allMods(S, db).some(m => m.key === "breakAnyIconCard" && AA4.modAppliesToSeat(S, m, seat) && (!m.value.faction || m.value.faction === b.faction) && (!m.value.named || !!b.name))   // "次にセット宣言する<勢力>のネームを持つブレイクカードの分類を無視することが可能" (0919, Revise#352)
      || AA4.allMods(S, db).some(m => m.key === "breakAnyIconAll")   // "≪キャラクター全て≫は、分類に関わらずブレイク可能" (Revise#272)
      || AA4.allMods(S, db).some(m => m.key === "breakAnyIcon" && AA4.modAppliesToSeat(S, m, seat) && (m.value.icons || []).some(i => st.icons.includes(i)))
      || AA4.allMods(S, db).some(m => m.key === "breakWithIcons" && (m.value.icons || []).some(i => (b.icons || []).includes(i)));   // "場のキャラクター全ては、分類に関わらず、≪…を持つブレイクカード≫でブレイク可能" (A3-16 2232, Revise#172)   // "分類に関わらず、≪スチューデント≫をブレイク可能"
    if (!iconOk && !force) return "No class icon in common";
    return null;
  };
  /** "あなたの対戦相手のテリトリーにキャラクターがいて、あなたの支配エリアにキャラクターがいない場合" */
  AA4.freeIfOk = (S, db, seat, f) => (!f.oppNamed || Object.values(S.chars).some(c => c.owner !== seat && AA4.charStats(S, db, c.id).named)) && (!f.oppBroken || Object.values(S.chars).some(c => c.owner !== seat && AA4.charStats(S, db, c.id).broken)) && (!f.oppHasChars || Object.values(S.chars).some(c => c.owner !== seat)) && (!f.youNoControlled || !AA4.controlledOf(S, seat).length) && (!f.cond || AA4.checkCond(S, db, f.cond, { seat }))
    && (!f.oppControls || AA4.living(S).filter(o => o !== seat).some(o => Object.values(S.chars).filter(c => c.owner === o && AA4.isControlled(c) && AA4.charStats(S, db, c.id).faction === f.oppControls.faction).length >= (f.oppControls.n || 1)));   // n: "…を3体以上支配している場合" (A4-03 0411, Revise#283): one opponent   // "あなたの対戦相手がイレイザーのキャラクターを支配している場合"
  AA4.breakTargets = (S, db, seat, cardId, force, binf) => Object.keys(S.chars).filter(chId => !AA4.breakReason(S, db, seat, cardId, chId, force, binf));
  /** May this Break card be set straight to the field (Revise#017)? From the card, or a Placement Rule modifier. */
  AA4.directBreak = (S, db, seat, cardId) => {
    const b = db.card(S.cards[cardId].key) || {};
    if (b.directField) return true;
    return AA4.allMods(S, db).some(m => m.key === "placement" && m.value === "breakToField" && AA4.modAppliesToSeat(S, m, seat));
  };

  /** Cost X (Pack, Revise#086): "def" = X is defined by the card text ("Xは…に等しい") → the table works X out
      (after the target when X depends on it) and the player pays exactly X; "free" = the player pays as many
      power cards as they like and X = the number paid. An explicit it.x (old logs) keeps a fixed X. */
  const X_FROM_TARGET = x => !!(x && (x.targetCost || x.targetFactor || x.targetStat || x.freeOn != null || x.tCost));
  AA4.xFromDef = (S, db, def, src, targets) => AA4.xOf(S, db, def, src, targets);
  /** Everything about a declaration before it is made: {cost, payFrom, spec (target kind), reason}. */
  AA4.planDeclaration = (S, db, seat, it, probeVia) => {
    if (probeVia) { const keep = S.effDecl; S.effDecl = { seat, card: probeVia.card, ch: probeVia.ch || null, zones: probeVia.zones || ["hand"], ignoreFactor: !!probeVia.ignoreFactor, freeCost: !!probeVia.freeCost }; try { return AA4.planDeclaration(S, db, seat, it); } finally { S.effDecl = keep; } }
    const p = S.players[seat];
    if (it.kind === "set") {
      const c = S.cards[it.card];
      const fromDmg = c && p.zones.damage.includes(it.card) && AA4.dmgPlayable(S, db, seat, it.card);   // "このカードがあなたのダメージ置き場にある場合、…手札にあるカードと同様に使用宣言可能" (Revise#124)
      const via = c && S.effDecl && S.effDecl.seat === seat && S.effDecl.card === it.card ? S.effDecl : null;   // declared by an effect (Q#38, Revise#142): "…を、コストを支払ってこのキャラクターにセット宣言可能"
      if (!c || !(p.zones.hand.includes(it.card) || fromDmg || (via && (via.zones || ["hand"]).includes(c.place.z)))) return { reason: "Choose a card from your hand" };
      let inf = db.card(c.key) || {};
      if (inf.onlyByJp && !(via && S.cards[via.card] && ((db.card(S.cards[via.card].key) || {}).jp || "").replace(/\s+/g, "") === inf.onlyByJp)) return { reason: `Only 「${inf.onlyByJp}」's effect can set this card` };   // EX0402 (Revise#161)
      if (inf.play && inf.play.oppTurnOnly && S.turn.player === seat) return { reason: "Only in an opponent's turn" };
      if (inf.play && inf.play.declCond && !AA4.checkCond(S, db, inf.play.declCond, { seat, card: it.card })) return { reason: "Its condition is not met (see the card text)" };
      if (inf.setCond && p.zones.hand.includes(it.card) && !AA4.checkCond(S, db, inf.setCond, { seat, card: it.card })) return { reason: "Its condition is not met (see the card text)" };   // EX844 (Revise#347)   // "…を支配している場合にのみ使用可能" (A3-19 2632, Revise#170)   // A3-14 1950 (Revise#165)
      if (inf.play && inf.play.modes) {   // modes (Revise#164): one effect is chosen when it is declared
        if (!AA4.isInt(it.mode) || !inf.play.modes[it.mode]) return { reason: "Choose one of its effects" };
        if (inf.play.modes[it.mode].notFirst && S.turn.order.length && S.turn.order[0] === seat) return { reason: "Only a player who did not go first may choose this effect" };
        inf = AA4.modeInfo(inf, it.mode);
      }
      if (it.asFast) {   // M2g (Revise#161): a Break card used from the hand as a Fast card
        if (!inf.asFast || !p.zones.hand.includes(it.card)) return { reason: "This card can't be used as a Fast card" };
        inf = AA4.asFastInfo(inf);
      } else if (it.asBreak) {   // "≪このカード≫は、E0のブレイクカードとして使用宣言可能" (M1a)
        if (!inf.asBreak) return { reason: "This card can't be declared as a Break card" };
        if (inf.asBreak.cond && !AA4.checkCond(S, db, inf.asBreak.cond, { seat })) return { reason: "Not now (the card says when it may be used as a Break card)" };
        inf = AA4.asBreakInfo(inf);
      }
      const fastBy = inf.type === "Break" && AA4.playerStats(S, db, seat).fastBreak.some(f => (!f.icons || (inf.icons || []).some(i => f.icons.includes(i))) && (f.named == null || !!inf.name === f.named) && (!f.tag || (inf.tags || []).includes(f.tag)) && (!f.names || f.names.includes(String(inf.name || "").replace(/\s+/g, ""))));   // tag / names (Revise#275)
      const fastIfNamed = inf.fastIfOppNamed && Object.values(S.chars).filter(c => c.owner !== seat && AA4.charStats(S, db, c.id).named).length >= inf.fastIfOppNamed && !!AA4.timing(S, db, seat, "project");   // 3795 (Revise#152): "対戦相手のテリトリーにネームレベルキャラクターが3体以上いる場合、…ファストカードのタイミングで…"
      let timing = AA4.timing(S, db, seat, inf.type === "Fast" || inf.fastTiming || fastIfNamed || fastBy || AA4.fastCardOk(S, db, seat, inf) || (inf.fastIfAttack && S.battle && S.battle.kind === "attack") || (inf.fastIfCond && AA4.checkCond(S, db, inf.fastIfCond, { seat, card: it.card })) || (inf.fastIfOppAttacking && S.battle && S.battle.kind === "attack" && !(S.chars[S.battle.attacker] && AA4.isControlled(S.chars[S.battle.attacker]) && S.chars[S.battle.attacker].owner === seat)) || (inf.fastIfGuardBreak && ((S.battle && S.battle.guard) || S.stack.some(x => x.kind === "set" && x.card && AA4.cardInfo(S, db, x.card).type === "Break"))) ? "fast" : "project"), fastOnly = false;   // fastIfAttack: 2418 "アタック宣言が行われている場合、≪このカード≫をファストカードのタイミングでセット宣言可能"
      let extraFast = 0; if (timing && inf.fastExtra && !AA4.timing(S, db, seat, "fast")) { timing = null; extraFast = inf.fastExtra; }
      let fastByT = null; if (timing && inf.fastIfTName && !AA4.timing(S, db, seat, "fast") && Object.keys(S.chars).some(id => (st => st.name === inf.fastIfTName || (st.alsoNames || []).includes(inf.fastIfTName))(AA4.charStats(S, db, id)))) { timing = null; fastByT = inf.fastIfTName; }   // "目標が“X”の場合、…ファストカードのタイミングで使用宣言可能" (0510, Revise#350)   // "追加の2コストを支払うことで、…ファストカードのタイミングで使用宣言可能" (Revise#265)
      // "≪あなた≫は、支配エリアのこのキャラクターを、ファストカードのタイミングでブレイク可能" (M1a): a Break card at fast timing, on such a character only
      if (timing && inf.type === "Break" && !AA4.timing(S, db, seat, "fast") && Object.keys(S.chars).some(ch => AA4.fastBreakOk(S, db, seat, ch, inf))) { timing = null; fastOnly = true; }   // any character that allows it (0702 / 0843, Revise#249)
      let permOnly = null;   // マシット (Revise#137): "≪あなた≫は、パーマネントカードをファストカードのタイミングで、このキャラクターにセット宣言可能"
      if (timing && inf.type === "Permanent" && !AA4.timing(S, db, seat, "fast")) { const l = AA4.controlledOf(S, seat).filter(ch => AA4.charStats(S, db, ch).fastPerm); if (l.length) { timing = null; permOnly = l; } }
      let payOnly = null;   // メルキオール (Q#52, Revise#146): "≪あなた≫は、このキャラクターからのみコストを支払って、プロジェクトカードをファストカードのタイミングで使用宣言可能"
      if (timing && inf.type === "Project" && !AA4.timing(S, db, seat, "fast")) { const l = AA4.controlledOf(S, seat).filter(ch => AA4.charStats(S, db, ch).projFast); if (l.length) { timing = null; payOnly = l; } }
      if (timing && inf.fastPayOnlySel && !AA4.timing(S, db, seat, "fast")) { const l = AA4.controlledOf(S, seat).filter(ch => AA4.matchChar(S, db, inf.fastPayOnlySel, ch, { seat })); if (l.length) { timing = null; payOnly = l; } }   // "このカードのコストが…“X”からのみ支払われる場合、…ファストカードのタイミングで使用宣言可能" (EX0299, Revise#354)
      if (timing && inf.type === "Project" && !AA4.timing(S, db, seat, "fast") && S.modifiers.some(m => m.key === "projFastNext" && m.src && m.src.seat === seat)) timing = null;
      let projFastTurn = false;   // "≪あなた≫は、各ターンに1度だけ、プロジェクトカードをファストカードのタイミングで使用宣言可能" (0876, Revise#367)
      if (timing && inf.type === "Project" && !AA4.timing(S, db, seat, "fast") && p.projFastTurn !== S.turn.number && AA4.allMods(S, db).some(m => m.key === "projFastTurn" && AA4.modAppliesToSeat(S, m, seat))) { timing = null; projFastTurn = true; }   // "次に使用するプロジェクトカードをファストカードのタイミングで使用宣言可能" (EP607, Revise#354)
      if (c && p.zones.damage.includes(it.card) && !(db.card(c.key) || {}).playFromDamage) {   // "…ダメージ置き場のプロジェクトカードを、このキャラクターからのみコストを支払って…使用宣言可能"
        const ms = AA4.allMods(S, db).filter(m => m.key === "breakFromDamage" && AA4.modAppliesToSeat(S, m, seat) && m.value && m.value.payOnlySrc && AA4.cardSelOk(inf, m.value));
        if (ms.length && !AA4.allMods(S, db).some(m => m.key === "breakFromDamage" && AA4.modAppliesToSeat(S, m, seat) && !(m.value && m.value.payOnlySrc) && AA4.cardSelOk(inf, m.value && typeof m.value === "object" ? m.value : { types: ["Break"] }))) payOnly = (payOnly || []).concat(ms.map(m => m.src && m.src.ch).filter(Boolean));
      }
      if (inf.play && inf.play.timing === "active" && S.turn.phase !== "active") return { reason: "Only in the Active Phase" };   // "このカードは、勢力フェイズ中にのみ使用可能" (EX0336, Revise#208)
      if (inf.play && inf.play.payOnlySel) { const l = AA4.controlledOf(S, seat).filter(ch => AA4.matchChar(S, db, inf.play.payOnlySel, ch, { seat })); payOnly = payOnly ? payOnly.filter(x => l.includes(x)) : l; }   // "このカードのコストは…キャラクターからのみ支払うことが可能" (EX0475, Revise#207)
      const B = S.battle, gset = !!it.guardSet && inf.type === "Break" && inf.guardFromHand && p.zones.hand.includes(it.card) && B && B.step === "guard" && B.defender === seat && !B.guard && B.target && B.target.seat === seat
        && !!S.chars[B.attacker] && S.chars[B.attacker].owner !== seat && AA4.isControlled(S.chars[B.attacker]);   // エラキス (Q#41, Revise#142): "あなたの対戦相手の支配キャラクターがあなたにアタックする場合、≪このカード≫をコストを支払ってあなたの支配キャラクターとしてセット可能"
      if (it.guardSet && !gset) return { reason: "Only when an opponent's Controlled Character attacks you (before guards)" };
      if (gset) timing = null;
      if (via) timing = null;
      if (timing) return { reason: timing };
      { const bf = AA4.allMods(S, db).find(m => m.key === "banFastCost" && inf.type === "Fast" && typeof inf.cost === "number" && inf.cost <= ((m.value && m.value.n) || 0)); if (bf) return { reason: `Fast cards of cost ${bf.value.n} or less have no effect now` }; }   // A3-02 0269 (Revise#159)
      if (p.zones.hand.includes(it.card) && AA4.allMods(S, db).some(m => m.key === "noHandUse" && AA4.modAppliesToSeat(S, m, seat))) return { reason: "No card can be used or set from a hand now" };   // A3-03 0626 (Revise#159)
      if (AA4.turnLock(S) && p.zones.hand.includes(it.card)) return { reason: "Cards in hand can't be used during this extra turn (ザラーム)" };
      const ban = AA4.banOf(S, db, seat, { kind: "set", info: inf });
      if (ban) return { reason: AA4.banReason(S, db, ban) };
      if (inf.type === "Character") return { cost: 0, payFrom: [], at: "once", info: inf };
      if (!CHAIN_TYPES.has(inf.type)) return { reason: "This card can't be declared" };
      const unbrokenBan = ["Project", "Fast", "Permanent"].includes(inf.type) && AA4.seatHas(S, db, seat, "noPayUnbroken");   // "ブレイクしていないキャラクターから、プロジェクトカード・ファストカード・パーマネントカードのコストを支払うことはできない" (Revise#130)
      const payFrom = AA4.controlledOf(S, seat).filter(id => !AA4.charStats(S, db, id).noPay && !(AA4.charStats(S, db, id).noPayKinds || []).includes("set") && !AA4.lockNoPay(S, db, id) && !(AA4.charStats(S, db, id).noPayFor || []).includes(inf.type) && (!unbrokenBan || AA4.charStats(S, db, id).broken));
      if (["Permanent", "Project", "Fast"].includes(inf.type) && AA4.seatHas(S, db, seat, "noPaySameFaction")) for (let k = payFrom.length - 1; k >= 0; k--) if (AA4.charStats(S, db, payFrom[k]).faction === inf.faction) payFrom.splice(k, 1);   // 3388 (Revise#151): "…そのカードと同じ勢力のキャラクターから支払うことができない"
      if (payOnly) for (let k = payFrom.length - 1; k >= 0; k--) if (!payOnly.includes(payFrom[k])) payFrom.splice(k, 1);
      let xdef = inf.play && inf.play.x, cost0, xMode = null;
      // "このカードを“X”にセット宣言する場合、コストを無視": the cost depends on the target → target first (as X from the target)
      if ((inf.type === "Break" || inf.type === "Permanent") && inf.freeOnName && inf.cost !== "X") xdef = { freeOn: inf.freeOnName, jp: !!inf.freeOnJp, base: +inf.cost || 0 };
      if (inf.type === "Break" && !xdef && inf.cost !== "X" && +inf.cost > 0 && AA4.controlledOf(S, seat).some(id => AA4.charStats(S, db, id).breakCostFree)) xdef = { freeOn: "\u0000", seat, base: +inf.cost || 0 };   // A4-PP PP303 (Revise#341): free on that character only → the target first
      if (["Project", "Fast"].includes(inf.type) && !xdef && inf.cost !== "X" && inf.play && inf.play.target && (inf.play.target.kind === "char" || (inf.play.target.kind === "card" && (inf.tCost || []).some(r => r.aimsAtYours)) || (inf.play.target.kind === "item" && (inf.tCost || []).some(r => r.oppItemCost))) && inf.play.target.count === 1 && (inf.tCost || AA4.allMods(S, db).some(m => m.key === "cardCostT" && (!m.value || !m.value.types || m.value.types.includes(inf.type))))) xdef = { tCost: { base: +inf.cost || 0, rules: inf.tCost || [], type: inf.type } };   // the cost depends on the chosen target (0301, EX0471, EX0481 — Revise#351): target first, as for X from the target
      const freeIf = (inf.type === "Break" || inf.type === "Permanent") && inf.freeIf && AA4.freeIfOk(S, db, seat, inf.freeIf);   // "…必要ファクターとコストを無視して…セット宣言可能"
      const declTarget = inf.type === "Break" || inf.type === "Permanent" || (inf.play && inf.play.target && inf.play.target.count !== "all");
      const altMill = it.alt === "mill" ? inf.altMill : 0;   // "あなたのデッキの上からカードをN枚捨て札することで、このカードのコストを無視してセット宣言可能" (Revise#128)
      if (it.alt === "mill" && !altMill) return { reason: "This card has no other cost" };
      if (inf.play && inf.play.playIf && inf.play.playIf.bothBrokenNamed) {   // A3-20 2693: "…ブレイクしているネームレベルキャラクターがそれぞれ1人以上いる場合にのみ使用宣言可能"
        const bn = s2 => AA4.controlledOf(S, s2).some(id => S.chars[id].stack.length > 1 && !!AA4.charStats(S, db, id).named);
        if (!bn(seat) || !AA4.livingOrder(S).some(s2 => s2 !== seat && bn(s2))) return { reason: "You and an opponent each need a broken name-level character in the Control Area" };
      }
      if (altMill && S.players[seat].zones.deck.length < altMill) return { reason: `Not enough cards in your deck (${altMill} needed)` };
      if (freeIf || altMill || inf.costFree || (inf.play && inf.play.costFreeIf && AA4.checkCond(S, db, inf.play.costFreeIf, { seat }))) cost0 = 0;   // costFreeIf: "…場合、このカードの必要ファクターとコストを無視して使用宣言可能" (2421, Revise#203)   // costFree: "このカードのコストを無視して…セット宣言可能" (Revise#144)
      else if (xdef && (xdef.freeOn != null || xdef.tCost)) { xMode = "def"; cost0 = null; }
      else if (inf.cost === "X" && xdef && X_FROM_TARGET(xdef) && !declTarget) { xMode = "free"; cost0 = null; }   // its target is only picked when it resolves: pay freely
      else if (inf.cost === "X" && xdef) { xMode = "def"; cost0 = X_FROM_TARGET(xdef) ? null : AA4.xFromDef(S, db, xdef, { seat, card: it.card }, []); }
      else if (inf.cost === "X" && it.x == null) { xMode = "free"; cost0 = null; }
      else cost0 = inf.cost === "X" ? it.x : +inf.cost || 0;
      if (cost0 != null && (!AA4.isInt(cost0) || cost0 < 0)) return { reason: "Choose X" };
      const notFirst = AA4.cardSelfLess(S, db, seat, inf);   // + EXPR038 (Revise#157): "場に“X”がいる場合、このカードの必要ファクターとコストは1ずつ減少する"   // "先攻以外のプレイヤーは、…必要ファクターとコストをNずつ減少させて" (Revise#129)
      const less = (inf.costLess ? AA4.xOf(S, db, inf.costLess, { seat, card: it.card }, []) : 0) + notFirst + (inf.costLessIf && AA4.checkCond(S, db, inf.costLessIf.cond, { seat, card: it.card }) ? inf.costLessIf.n : 0) - extraFast;   // Revise#259 / #265   // "このカードのコストは、あなたのダメージ置き場のカード枚数分減少する"
      const millX = it.alt === "millExtra" && p.zones.hand.includes(it.card) && AA4.millAltOffer(S, db, seat, inf) ? +inf.cost || 0 : 0;   // Q#59
      if (it.alt === "millExtra" && !millX) return { reason: "No extra cost to replace" };
      if (millX && S.players[seat].zones.deck.length < millX) return { reason: `Not enough cards in your deck (${millX} needed)` };
      const nextFree = ["Project", "Fast"].includes(inf.type) && inf.cost !== "X" && p.zones.hand.includes(it.card) ? S.modifiers.find(m => m.key === "nextFreeCard" && AA4.modAppliesToSeat(S, m, seat) && (!m.value || !m.value.types || m.value.types.includes(inf.type))) : null;   // EP175 (Revise#157)
      const nextLess = !nextFree && ["Project", "Fast"].includes(inf.type) && p.zones.hand.includes(it.card) ? S.modifiers.find(m => m.key === "nextCardLess" && AA4.modAppliesToSeat(S, m, seat) && (!m.value || !m.value.types || m.value.types.includes(inf.type)) && !(m.src && m.src.card === it.card)) : null, nlN = nextLess ? +(nextLess.value && nextLess.value.n) || 0 : 0;   // A3-18 2451 (M5a): "あなたが次に使用する…カードの必要ファクターとコストに-Xする"
      const cost = cost0 == null ? null : (via && via.freeCost) || nextFree ? 0 : Math.max(0, cost0 + AA4.cardCostMod(S, db, seat, inf, { skipMillAlt: !!millX }) - less - nlN);   // "…のコストはN上昇する"   // via.freeCost: "コストを無視して…セット宣言可能" (Revise#152)
      const dsc = inf.play && inf.play.discount && p.zones.hand.includes(it.card) ? { max: AA4.discountCards(S, db, seat, it.card, inf.play.discount).length, to: inf.play.discount.to || "discard", from: inf.play.discount.from || null, factorOnly: !!inf.play.discount.factorOnly } : null;   // "…手札の…のカード1枚を捨て札するごとに、1ずつ減少する" (Revise#172)
      if (cost != null && powerOf(S, payFrom) < cost - (dsc ? dsc.max : 0)) return { reason: `Cost ${cost}${xMode === "def" ? ` (X = ${cost0})` : ""}: not enough power cards on your Controlled Characters` };
      let spec = null, tNarrow = null, tLess = 0;
      if (gset) { const f = AA4.factorOk(S, db, seat, inf); if (f) return { reason: f }; return { cost, payFrom, spec: null, info: inf, guardSet: true }; }
      if (it.asChar) {   // 迦陵頻伽 2304 (Revise#143): "あなたがこのカードの必要ファクターを満たした状態で、“迦陵頻伽”が場に存在する場合、≪このカード≫をコストを支払ってあなたの支配キャラクターとしてセット可能"
        const bac = inf.type === "Break" && AA4.allMods(S, db).some(m => m.key === "breakAsChar" && AA4.modAppliesToSeat(S, m, seat) && (inf.icons || []).some(i => ((m.value && m.value.icons) || []).includes(i)));   // ラユュー (Revise#152): "手札の…のブレイクカードを、コストを支払ってあなたの支配キャラクターとしてセット宣言可能"
        if (!bac && (!inf.asCharIfName || !Object.values(S.chars).some(c2 => AA4.charStats(S, db, c2.id).name === inf.asCharIfName))) return { reason: `Only while “${inf.asCharIfName || "?"}” is on the field` };
        const f = AA4.factorOk(S, db, seat, inf); if (f) return { reason: f };
        return { cost, payFrom, spec: null, info: inf, asChar: true };
      }
      // Project / Fast / Permanent: the required Factor is checked at the declaration too (Pack, Revise#315: "if a condition is not met —
      // Factor, Cost, or as written in the text — it can't be declared, unless a text allows it"); it is checked again when it resolves
      if (["Project", "Fast", "Permanent"].includes(inf.type) && !(inf.skills && inf.skills.dual) && !freeIf && !(via && via.ignoreFactor) && !(inf.noFactorIf && AA4.freeIfOk(S, db, seat, inf.noFactorIf))
        && !(inf.play && inf.play.factorFreeIf && AA4.checkCond(S, db, inf.play.factorFreeIf, { seat, card: it.card }))) {
        const less = (dsc ? dsc.max : 0) + notFirst + nlN;   // a discount by discarding at the declaration may still make it
        let f = AA4.factorOk(S, db, seat, less ? Object.assign({}, inf, { factorLessN: (inf.factorLessN || 0) + less }) : inf);
        if (f && inf.tFactorLess && !AA4.factorOk(S, db, seat, Object.assign({}, inf, { factorLessN: (inf.factorLessN || 0) + less + inf.tFactorLess.n }))) { f = null; tNarrow = inf.tFactorLess.sel; tLess = inf.tFactorLess.n; }   // A4-02 0284 / A4-05 0814 (M5): the Factor is met only with the reduction for such a target → only such targets
        if (f) return { reason: f };
      }
      if (inf.type === "Break") {
        if (!(inf.skills && inf.skills.dual) && !freeIf && !(inf.noFactorIf && AA4.freeIfOk(S, db, seat, inf.noFactorIf)) && !(via && via.ignoreFactor) && !(fastOnly && inf.sameNameNoFactor)) { const f = AA4.factorOk(S, db, seat, notFirst ? Object.assign({}, inf, { factorLessN: notFirst }) : inf); if (f) return { reason: f }; }   // Dual may be declared without it (Revise#063)
        const fastOk = ch => !fastOnly || AA4.fastBreakOk(S, db, seat, ch, inf);
        const ownFree = freeIf && !inf.freeIf.normal;
        const ok = (ownFree ? AA4.breakTargets(S, db, seat, it.card, true, inf).filter(ch => S.chars[ch].owner === seat) : AA4.breakTargets(S, db, seat, it.card, it.force, inf)).filter(fastOk).length || (!fastOnly && AA4.directBreak(S, db, seat, it.card));
        if (!ok) return { reason: fastOnly ? "Only a Break onto your Controlled Character that allows fast timing now" : "No character this Break card can break" };
        spec = ownFree || inf.asBreakOwnOnly ? { kind: "break", ownOnly: true } : { kind: "break" };
        if (fastOnly) spec.fastOnly = true;   // freeIf: "あなたのテリトリーのキャラクターにセット宣言可能" (any icon)
        if (freeIf && inf.freeIf.faction) spec.faction = inf.freeIf.faction;
        if (freeIf && inf.freeIf.oppOnly) spec.oppOnly = true;   // EP243 (Revise#157): free only onto an opponent's character   // 3754 (Revise#152): "…必要ファクターとコストを無視して極星帝国のキャラクターにセット宣言可能"
        if (fastIfNamed) spec.unnamed = true;
        if (via && via.ch) { if (!AA4.breakTargets(S, db, seat, it.card, it.force, inf).includes(via.ch)) return { reason: "This Break card can't be set onto the target" }; spec.only = [via.ch]; }   // A3-11 1742 (Revise#220): onto the target only   // 3795: "ファストカードのタイミングでネームを持たないキャラクターにセット宣言可能"
      } else if (inf.type === "Permanent") {
        if (!payFrom.length) return { reason: "A Permanent needs one of your Controlled Characters" };
        spec = via && via.ch ? { kind: "perm", only: [via.ch] } : permOnly ? { kind: "perm", only: permOnly } : { kind: "perm" };
        if (!AA4.controlledOf(S, seat).some(ch => (!spec.only || spec.only.includes(ch)) && AA4.permRoom(S, db, ch))) return { reason: "No character with a free Permanent slot (each holds as many Permanent cards as its Permanent limit — 1, more with Permanent +X)" };   // Pack (Revise#184)
      } else if (inf.play && inf.play.target && inf.play.target.count !== "all") {
        spec = fastByT && inf.play.target.kind === "char" ? Object.assign({}, inf.play.target, { sel: Object.assign({}, inf.play.target.sel || {}, { name: fastByT }) }) : inf.play.target;
        if (tNarrow && spec.kind === "char") spec = Object.assign({}, spec, { sel: Object.assign({}, spec.sel || {}, tNarrow) });
        if (!AA4.specHasTargets(S, db, spec, { seat, card: it.card, x: cost == null ? powerOf(S, payFrom) : cost })) return { reason: "No valid target" };
      } else if (inf.play && !inf.play.target && AA4.groupEmpty(S, db, inf.play, { seat, card: it.card })) return { reason: "No valid target (nothing it would affect)" };
      return { projFastTurn, cost, payFrom, spec, info: inf, xMode, xDef: xMode === "def" ? xdef : null, x: xMode === "def" ? cost0 : null, free: !!freeIf || !!(via && via.ignoreFactor) || !!(inf.play && inf.play.factorFreeIf && AA4.checkCond(S, db, inf.play.factorFreeIf, { seat, card: it.card })), altMill: altMill || millX || 0, fLess: nlN + tLess, useMod: nextFree ? nextFree.id : nextLess ? nextLess.id : null, discount: dsc && dsc.max ? dsc : null };
    }
    if (it.kind === "effect") {
      const ch = S.chars[it.ch];
      if (!ch || !AA4.mineOrPuppet(S, ch, seat)) return { reason: "Not your character" };
      if (!AA4.isControlled(ch)) return { reason: "Only Controlled Characters use effects" };
      if (!(it.card === AA4.topOf(ch) || ch.perm.includes(it.card))) return { reason: "That card is not this character's top card or permanent" };
      const inf = db.card(S.cards[it.card].key) || {}, ef = AA4.effectsOf(S, db, it.ch, it.card)[it.i];
      if (!ef) return { reason: "No such effect" };
      if (ef.negated) return { reason: "This effect is negated" };
      if (AA4.charStats(S, db, it.ch).noEffect) return { reason: "This character can't use effects now" };
      if ((AA4.charStats(S, db, it.ch).noPayFor || []).includes("effect") && ef.cost !== 0) return { reason: "Effect costs can't be paid from this character" };
      { const cap = Object.keys(S.chars).find(id => S.chars[id].owner !== seat && AA4.isControlled(S.chars[id]) && AA4.charStats(S, db, id).effCostCap && typeof ef.cost === "number" && ef.cost <= S.chars[id].power.length);   // ラユュー: "≪あなたの対戦相手の支配キャラクター全て≫の、このキャラクターのパワー以下のコストのエフェクト全てを無効化する"
        if (cap && AA4.isControlled(ch)) return { reason: `Negated: effects with cost ≤ ${S.chars[cap].power.length} (${AA4.cardName(db.card(S.cards[AA4.topOf(S.chars[cap])].key))})` }; }   // リムノレイア (Revise#131)   // "エフェクトの使用宣言をすることができない" (Revise#111)
      if (ef.myTurn && S.turn.player !== seat) return { reason: "Only in your turn" };
      if (ef.mainOnly && S.turn.phase !== "main") return { reason: "Only in your Main Phase" };
      if (ef.hostName && (AA4.charStats(S, db, it.ch).name || "").replace(/\s+/g, "") !== ef.hostName) return { reason: `Only from “${ef.hostName}”` };
      if (ef.hostPerm && !S.chars[it.ch].perm.some(id => { const i = db.card(S.cards[id].key) || {}; return String(i.name || "").replace(/\s+/g, "") === ef.hostPerm || String(i.jp || "").replace(/\s+/g, "").includes(ef.hostPerm); })) return { reason: `Only from a character with “${ef.hostPerm}” set` };   // EX0440 (Revise#207)
      if (ef.hostNames && !ef.hostNames.includes((AA4.charStats(S, db, it.ch).name || "").replace(/\s+/g, ""))) return { reason: `Only from ${ef.hostNames.map(n => "“" + n + "”").join(" / ")}` };   // EP336 (Revise#203)   // "このエフェクトのコストを“X”以外から支払うことはできない" (Revise#164)
      if (ef.declCond && !AA4.checkCond(S, db, ef.declCond, { seat, ch: it.ch, card: it.card })) return { reason: "Its condition is not met (see the card text)" };   // A3-16 2175 (Revise#221)
      if (ef.oncePerTurn && S.turn.effUsed && S.turn.effUsed[it.card + "#" + it.i]) return { reason: "Only once per turn" };   // "このエフェクトは1ターンに1度しか使用宣言できない" (Revise#157)
      if (ef.onlyExtra && !S.turn.extraPhase && !S.turn.isExtra) return { reason: "Only during an extra phase or an extra turn" };   // EP313 (Revise#157)   // "このエフェクトはあなたのターン中にのみ使用宣言可能"
      const timing = ef.timing === "active" && S.turn.phase !== "active" ? "Only in the Active Phase" : AA4.timing(S, db, seat, ef.timing === "project" ? "project" : "fast");   // "…プロジェクトカードのタイミングでのみ使用宣言可能" / "このエフェクトは勢力フェイズにしか使用宣言できない" (Revise#132)
      if (timing) return { reason: timing };
      const ban = AA4.banOf(S, db, seat, { kind: "effect", info: inf });
      if (ban) return { reason: AA4.banReason(S, db, ban) };
      let cost, xMode = null;
      if (ef.cost === "X" && ef.x && X_FROM_TARGET(ef.x) && !(ef.target && ef.target.count !== "all")) { xMode = "free"; cost = null; }
      else if (ef.cost === "X" && ef.x) { xMode = "def"; cost = X_FROM_TARGET(ef.x) ? null : AA4.xFromDef(S, db, ef.x, { seat, ch: it.ch, card: it.card }, []); }
      else if (ef.cost === "X" && it.x == null) { xMode = "free"; cost = null; }
      else cost = ef.cost === "X" ? it.x : +ef.cost || 0;
      if (cost != null && (!AA4.isInt(cost) || cost < 0)) return { reason: "Choose X" };
      const extra = AA4.charStats(S, db, it.ch).effectCost;   // "…エフェクトコスト全ては1上昇する"
      if (cost != null) cost += extra;
      const hp = inf && inf.effHandPay ? S.players[seat].zones.hand.filter(id => ((db.card(S.cards[id].key) || {}).icons || []).some(i => (inf.effHandPay.icons || []).includes(i))).length : 0;   // EP252
      const effPayers = S.chars[it.ch].owner === seat ? AA4.controlledOf(S, seat).filter(id => id !== it.ch && AA4.charStats(S, db, id).payFor.some(p => p.kind === "effect") && !AA4.charStats(S, db, id).noPay) : [];   // EXPP064 (Revise#157): "…エフェクトコストを代わりに支払うことが可能"
      if (cost != null && ch.power.length + hp + effPayers.reduce((n, id) => n + S.chars[id].power.length, 0) < cost) return { reason: `Cost ${cost}${xMode === "def" ? ` (X = ${cost})` : ""}: not enough power cards on this character` };
      if (xMode === "free" && !ch.power.length) return { reason: "Cost X: no power cards on this character" };
      const spec = ef.target && ef.target.count !== "all" ? ef.target : null;
      if (AA4.charStats(S, db, it.ch).negated.effects) return { reason: "Its effects are negated" };
      { const cm = AA4.charStats(S, db, it.ch).negated.effCostMax; if (cm != null && typeof ef.cost === "number" && ef.cost <= cm) return { reason: `Its effects of cost ${cm} or less are negated` }; }   // A3-25 3733 (Revise#170)
      if (spec && !AA4.specHasTargets(S, db, spec, { seat, ch: it.ch, card: it.card, x: cost == null ? ch.power.length : cost, effect: true })) return { reason: "No valid target" };
      if (!spec && AA4.groupEmpty(S, db, ef, { seat, ch: it.ch, card: it.card })) return { reason: "No valid target (nothing it would affect)" };
      if ((AA4.charStats(S, db, it.ch).noPay || AA4.lockNoPay(S, db, it.ch)) && cost !== 0) return { reason: "Costs can't be paid from this character now" };
      return { cost, payFrom: S.chars[it.ch].owner !== seat ? [AA4.puppetBy(S, it.ch, seat)].filter(id => S.chars[id]) : [it.ch].concat(effPayers), spec, info: inf, ef, xMode, xDef: xMode === "def" ? ef.x : null, x: xMode === "def" && cost != null ? cost - extra : null, extra };
    }
    if (it.kind === "attack" || it.kind === "guard" || it.kind === "join") return AA4.planBattle ? AA4.planBattle(S, db, seat, it) : { reason: "Unknown declaration" };   // join: Synchro (Revise#142 fix — it was never routed)
    return { reason: "Unknown declaration" };
  };

  /** ソラ・エニシダ (Q#38, Revise#142): "このカードがセットされた場合、≪あなたの任意のあなたの手札のパーマネントカード1枚≫を、コストを支払ってこのキャラクターにセット宣言可能。
      そのカードは必要ファクターを無視してセットされる" — a real declaration: pay window, Resolve list, others may respond. */
  OPS.effDeclPick = (ctx, op) => {
    const S = ctx.S, db = ctx.db, p = S.players[op.seat];
    if (!p || (op.ch && !S.chars[op.ch])) return;
    const probe = id => { const had = S.cards[id].noRule; if (op.ignoreRule) S.cards[id].noRule = true; try { return !AA4.planDeclaration(S, db, op.seat, { kind: "set", card: id }, Object.assign({}, op, { card: id })).reason; } finally { if (!had) delete S.cards[id].noRule; } };
    const opts = (op.zones || ["hand"]).flatMap(z => p.zones[z]).filter(id => (!op.faction || (db.card(S.cards[id].key) || {}).faction === op.faction) && (op.named == null || !!(db.card(S.cards[id].key) || {}).name === op.named) && (!op.works || AA4.worksOf(db.card(S.cards[id].key) || {}, op.works)) && (!op.nameHas || ((db.card(S.cards[id].key) || {}).name || "").includes(op.nameHas)) && (!op.jpHas || String((db.card(S.cards[id].key) || {}).jp || "").includes(op.jpHas)) && (!op.tag || ((db.card(S.cards[id].key) || {}).tags || []).includes(op.tag)) && (!op.onlyIds || op.onlyIds.includes(id)) && !(op.used || []).includes(id) && (op.costMax == null || (typeof (db.card(S.cards[id].key) || {}).cost === "number" && (db.card(S.cards[id].key) || {}).cost <= op.costMax)) && (op.costEq == null || (db.card(S.cards[id].key) || {}).cost === op.costEq) && (!op.icons || ((db.card(S.cards[id].key) || {}).icons || []).some(i => op.icons.includes(i))) && (op.types || ["Permanent"]).includes((db.card(S.cards[id].key) || {}).type) && probe(id));
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: opts, min: 0, max: 1, auto: false, reason: op.freeCost ? "You may declare one of these without paying its cost" + (op.repeat ? " (one at a time — as many as you like)" : "") : op.ch && (op.types || ["Permanent"]).includes("Permanent") ? "You may declare one of these onto this character (you pay its cost)" : "You may declare one of these (you pay its cost)", then: [Object.assign({}, op, { op: "effDeclGo" })] });
  };
  OPS.effDeclGo = (ctx, op) => {
    const S = ctx.S, id = (op.answer || [])[0];
    if (!id || S.draft) return;
    S.effDecl = { endMain: !!op.endMain, seat: op.seat, card: id, ch: op.ch || null, zones: op.zones || ["hand"], ignoreFactor: !!op.ignoreFactor, costTo: op.costTo || null, freeCost: !!op.freeCost, again: op.repeat ? Object.assign({}, op, { op: "effDeclPick", answer: undefined, used: (op.used || []).concat([id]) }) : null };
    if (op.ignoreRule) S.cards[id].noRule = true;
    const plan = AA4.planDeclaration(S, ctx.db, op.seat, { kind: "set", card: id });
    if (plan.reason) { S.effDecl = null; ctx.emit({ e: "note", text: plan.reason }); return; }
    INTENTS.declare.apply(ctx, { t: "declare", seat: op.seat, kind: "set", card: id, by: S.players[op.seat].cid });
  };

  /* ---------- intents ---------- */
  INTENTS.declare = {
    undoable: true,
    check(ctx, it) {
      const S = ctx.S, seat = AA4.seatFor(S, it);
      if (seat == null) return "You are not playing at this table";
      const plan = AA4.planDeclaration(S, ctx.db, seat, it);
      return plan.reason || null;
    },
    apply(ctx, it) {
      const S = ctx.S, seat = AA4.seatFor(S, it), plan = AA4.planDeclaration(S, ctx.db, seat, it);
      if (plan.at === "once") { AA4.enqueue(S, [{ op: "setCharacter", seat, card: it.card }]); return; }
      if (it.asBreak) S.cards[it.card].asBreak = true;
      if (it.asFast) S.cards[it.card].asFast = true;
      if (AA4.isInt(it.mode)) S.cards[it.card].mode = it.mode;
      const pl0 = it.kind === "effect" ? plan.ef || {} : it.card && it.kind === "set" ? (AA4.cardInfo(S, ctx.db, it.card) || {}).play || {} : {};
      const declX = !!pl0.declDiscardX, declN = +pl0.declDiscard || 0;
   // a Character card used as a Break card (M1a): a Break card until it leaves the field
      S.draft = { id: AA4.newId(S, "x"), seat, kind: it.kind, card: it.card || null, ch: it.ch || null, i: it.i == null ? null : it.i, fromDmg: !!(it.card && S.players[seat].zones.damage.includes(it.card)),
        x: plan.xMode === "def" ? plan.x : it.x == null ? null : it.x, force: !!it.force || !!plan.free, target: it.target || null, boost: it.boost || 0,
        cost: plan.cost, payFrom: plan.payFrom, spec: plan.spec || null, paid: [], targets: [],
        xMode: plan.xMode || null, xDef: plan.xDef || null, useMod: plan.useMod || null, fLess: plan.fLess || 0, extra: plan.extra || 0, free: !!plan.free, altMill: plan.altMill || 0, guardSet: !!plan.guardSet, asChar: !!plan.asChar, step: plan.xMode === "def" && plan.cost == null ? "target" : "pay" };   // X from the target: target first
      if (declX) S.draft.declX = true;
      if (declN) S.draft.declN = declN;
      if (+pl0.declDraw) S.draft.declDraw = +pl0.declDraw;
      if (+pl0.declMill) S.draft.declMill = +pl0.declMill;   // "このエフェクトの使用宣言時にあなたのデッキの上からカード3枚を捨て札する" (Revise#310)   // "このカードの使用宣言時に、≪あなた≫は1ドローする" (Revise#259)
      if (plan.discount) S.draft.discount = plan.discount;
      if (plan.projFastTurn) S.draft.projFastTurn = true;
      ctx.emit({ e: "declaring", seat, kind: it.kind, card: it.card || null, ch: it.ch || null, cost: plan.cost });
      if (S.effDecl && S.effDecl.endMain && S.effDecl.card === it.card) S.draft.endMain = true;   // EX0390 (Revise#161)
      AA4.enqueue(S, [{ op: "draftNext" }]);
    },
  };

  OPS.declNGo = (ctx, op) => {
    const S = ctx.S, d = S.draft;
    if (!d) return;
    for (const id of (op.answer || []).filter(id => S.cards[id] && S.cards[id].place.z === "hand")) AA4.moveCard(ctx, id, { z: "discard" });
    d.declNdone = true;
    OPS.draftNext(ctx);
  };
  OPS.declXGo = (ctx, op) => {
    const S = ctx.S, d = S.draft;
    if (!d) return;
    const ids = (op.answer || []).filter(id => S.cards[id] && S.cards[id].place.z === "hand");
    for (const id of ids) AA4.moveCard(ctx, id, { z: "discard" });
    d.declXn = ids.length; d.x = ids.length;
    ctx.emit({ e: "xSet", seat: d.seat, x: d.x, cost: d.cost, card: d.card, free: true });
    OPS.draftNext(ctx);
  };
  /** The hand cards that may be discarded for the discount (Revise#172). */
  AA4.discountCards = (S, db, seat, cardId, dc) => dc.from === "deck" ? S.players[seat].zones.deck.slice(-12).reverse()   // "…デッキの上からカードを1枚捨て札するごとに、1ずつ減少する" (EX0472 / 2031, Revise#366): how many of the top cards
    : S.players[seat].zones.hand.filter(id => id !== cardId && (!dc.faction || (db.card(S.cards[id].key) || {}).faction === dc.faction));
  OPS.discountGo = (ctx, op) => {
    const S = ctx.S, d = S.draft;
    if (!d) return;
    const fromDeck = d.discount.from === "deck", ids = fromDeck ? S.players[d.seat].zones.deck.slice(-(op.answer || []).length || S.players[d.seat].zones.deck.length + 1).reverse() : (op.answer || []).filter(id => S.cards[id] && S.cards[id].place.z === "hand");
    for (const id of ids) AA4.moveCard(ctx, id, { z: d.discount.to === "damage" ? "damage" : "discard" });
    d.discountN = ids.length; if (!d.discount.factorOnly) d.cost = Math.max(0, (d.cost || 0) - ids.length);
    if (ids.length) ctx.emit({ e: "note", text: `${ids.length} ${fromDeck ? "card" : "hand card"}${ids.length === 1 ? "" : "s"}${fromDeck ? " from the top of the deck" : ""} for the discount: ${d.discount.factorOnly ? "" : "cost and "}needed factor −${ids.length}` });
    const f = AA4.factorOk(S, ctx.db, d.seat, Object.assign({}, AA4.cardInfo(S, ctx.db, d.card), { factorLessN: ids.length }));
    if (f) { AA4.enqueue(S, [{ op: "refund", why: f }], true); return; }
    OPS.draftNext(ctx);
  };
  /** Move the draft on: pay (if cost) → target (if any) → done. */
  OPS.draftNext = ctx => {
    const S = ctx.S, d = S.draft;
    if (!d) return;
    if (d.discount && d.discountN == null) {   // "このカードの必要ファクターとコストは、…手札…1枚を捨て札するごとに、1ずつ減少する" (Revise#172): choose first
      const opts = AA4.discountCards(S, ctx.db, d.seat, d.card, (AA4.cardInfo(S, ctx.db, d.card).play || {}).discount || {});
      if (!opts.length) d.discountN = 0;
      else return AA4.ask(ctx, { seat: d.seat, kind: "cards", options: opts, min: 0, max: Math.min(opts.length, Math.max(d.discount.factorOnly ? 0 : d.cost || 0, Object.values(AA4.cardInfo(S, ctx.db, d.card).factor || {}).reduce((a, b) => a + b, 0))), auto: false, reason: d.discount.from === "deck" ? `Discount: choose how many of the top cards of your deck go to your ${d.discount.to === "damage" ? "Damage Pile" : "Discard Pile"} (each: ${d.discount.factorOnly ? "" : "cost −1 and "}needed factor −1)` : `Discount: choose hand cards to ${d.discount.to === "damage" ? "put into your Damage Pile" : "discard"} (each: cost −1 and needed factor −1)`, then: [{ op: "discountGo" }] });
    }
    if (d.xMode === "def" && d.cost == null && d.step === "target" && (d.targets.length || !d.spec)) {   // X from the target: now X is known → pay it
      d.x = AA4.xFromDef(S, ctx.db, d.xDef, { seat: d.seat, ch: d.ch, card: d.card }, d.targets);
      d.cost = d.kind === "set" ? Math.max(0, d.x + AA4.cardCostMod(S, ctx.db, d.seat, ctx.db.card(S.cards[d.card].key) || {})) : d.x + (d.extra || 0);
      d.cost += d.taxAdd || 0;
      d.step = "pay";
      if (d.xDef && d.xDef.tCost) { d.x = null; ctx.emit({ e: "note", text: `Cost ${d.cost} for this target` }); }   // not an X: only the cost depended on the target (Revise#351)
      else ctx.emit({ e: "xSet", seat: d.seat, x: d.x, cost: d.cost, card: d.card });
    }
    const alt = d.step === "pay" && d.cost > 0 ? AA4.payExtras(S, ctx.db, d) : null;   // another way to pay (discard Controlled Characters / hand cards): a choice — no auto-pay (A3-13 1896, Pack, Revise#316)
    if (d.step === "pay" && d.cost > 0 && !d.paid.length && S.rules.autoPay && !(alt && (alt.sac.length || alt.hand))) {   // exactly as many power cards as the cost: no choice to make
      const all = d.payFrom.flatMap(ch => S.chars[ch] ? S.chars[ch].power : []);
      if (all.length === d.cost) {
        for (const id of all) { d.paid.push({ card: id, ch: S.cards[id].place.ch }); AA4.moveCard(ctx, id, { z: "cost", seat: d.seat }); }
        ctx.emit({ e: "paid", seat: d.seat, cards: all.slice(), keys: all.map(id => S.cards[id].key), auto: true });
      }
    }
    if (d.step === "pay" && d.cost != null && (d.cost === 0 || d.paid.length === d.cost || d.altPaid)) d.step = "target";
    if (d.step === "target" && d.declMill && !d.declMillDone) { d.declMillDone = true; const deck = S.players[d.seat].zones.deck; for (let k = 0; k < d.declMill && deck.length; k++) AA4.moveCard(ctx, deck[deck.length - 1], { z: "discard" }); }
    if (d.step === "target" && d.declDraw && !d.declDrawDone) { d.declDrawDone = true; AA4.OPS.draw(ctx, { seat: d.seat, n: d.declDraw }); }
    if (d.step === "target" && d.declN && !d.declNdone) {   // "このエフェクトの使用宣言時に、あなたの任意のあなたの手札1枚を捨て札する" (Revise#166)
      const hand = S.players[d.seat].zones.hand.filter(id => id !== d.card);
      if (hand.length < d.declN) { AA4.enqueue(S, [{ op: "refund", why: `discard ${d.declN} card(s) from your hand: not enough cards` }], true); return; }
      return AA4.ask(ctx, { seat: d.seat, kind: "cards", options: hand, min: d.declN, max: d.declN, auto: false, reason: `Discard ${d.declN} card${d.declN === 1 ? "" : "s"} from your hand (declaration)`, then: [{ op: "declNGo" }] });
    }
    if (d.step === "target" && d.declX && d.declXn == null) {   // "このカードの使用宣言時に、あなたの任意のあなたの手札X枚を捨て札する" with a target that needs X (Revise#166): discard now, X = how many
      const hand = S.players[d.seat].zones.hand.filter(id => id !== d.card);
      if (!hand.length) { d.declXn = 0; d.x = 0; }
      else return AA4.ask(ctx, { seat: d.seat, kind: "cards", options: hand, min: 0, max: hand.length, auto: false, reason: "Discard any number of cards from your hand (X = how many)", then: [{ op: "declXGo" }] });
    }
    if (d.step === "target" && d.spec && !d.targets.length && !AA4.draftTargets(S, ctx.db, d).length) {   // nothing to choose any more (Pack): refund and cancel
      AA4.enqueue(S, [{ op: "refund", why: "no valid target" }], true); return;
    }
    if (d.step === "target" && (!d.spec || d.targets.length)) d.step = "done";
    if (d.step === "done") AA4.enqueue(S, [{ op: "draftDone" }], true);
  };

  INTENTS.pay = {
    undoable: true,
    check(ctx, it) {
      const S = ctx.S, d = S.draft, seat = AA4.seatFor(S, it);
      if (!d || d.step !== "pay") return "Nothing to pay for";
      if (seat !== d.seat) return "Not your declaration";
      const cards = it.cards;
      if (it.alt) {   // "…の代わりに支払うことができる" / "手札1枚をダメージ置き場に置くことで、…支払ったものとして扱う" (Revise#129)
        if ((d.kind !== "attack" && d.kind !== "guard") || !S.chars[d.ch]) return "Only for an Attack Cost or Guard Cost";
        if (!AA4.altPays(S, ctx.db, d).includes(it.alt)) return "This character can't pay that way";
        if (it.alt === "deck2") return S.players[d.seat].zones.deck.length >= 2 ? null : "Not enough cards in your deck";   // A3-22 3269 (Revise#173)
        if (it.alt === "discTop") return S.players[d.seat].zones.discard.length ? null : "Your Discard Pile is empty";
        if (!Array.isArray(cards) || cards.length !== 1) return "Choose 1 card";
        const c = S.cards[cards[0]];
        if (it.alt === "hand" && !(c && c.place.z === "hand" && c.owner === d.seat)) return "Choose a card from your hand";
        if (it.alt === "perm" && !(c && c.place.z === "char" && c.place.role === "perm" && c.place.ch === d.ch && AA4.altPermCards(S, ctx.db, d).includes(cards[0]))) return "Choose a Permanent set on this character";
        return null;
      }
      if (!Array.isArray(cards) || new Set(cards).size !== cards.length) return "Choose power cards";
      const ex = AA4.payExtras(S, ctx.db, d), sac = it.sac || [], hb = it.hand || [];   // Revise#137: characters discarded / hand cards discarded instead of power cards
      if (sac.length || hb.length) {
        if (!Array.isArray(sac) || !Array.isArray(hb) || new Set(sac).size !== sac.length || new Set(hb).size !== hb.length) return "Choose cards";
        if (sac.some(id => !ex.sac.includes(id))) return "Those characters can't be discarded to pay";
        if (hb.length > ex.hand || hb.some(id => !(S.cards[id] && S.cards[id].place.z === "hand" && S.cards[id].owner === d.seat) || (ex.handIds && !ex.handIds.includes(id)))) return `Up to ${ex.hand} hand card${ex.hand === 1 ? "" : "s"} for the Boost`;
        if (d.cost == null || cards.length + sac.length + hb.length !== d.cost) return `Pay exactly ${d.cost}`;
        for (const id of cards) { const c = S.cards[id]; if (!c || c.place.z !== "char" || c.place.role !== "power" || !d.payFrom.includes(c.place.ch)) return "Pay with power cards of the right character"; }
        return null;
      }
      if (d.cost == null ? cards.length < 1 + (d.extra || 0) : cards.length !== d.cost) return d.cost == null ? `Cost X: pay at least ${1 + (d.extra || 0)} power card${d.extra ? "s" : ""} (X = the number paid${d.extra ? ` − ${d.extra}` : ""})` : `Pay exactly ${d.cost}`;
      for (const id of cards) {
        const c = S.cards[id];
        if (!c || c.place.z !== "char" || c.place.role !== "power" || !d.payFrom.includes(c.place.ch)) return "Pay with power cards of the right character";
      }
      if (new Set(cards.map(id => S.cards[id].place.ch)).size > 1 && AA4.allMods(S, ctx.db).some(m => m.key === "payOneChar" && AA4.modAppliesToSeat(S, m, d.seat) && (!m.value || !m.value.types || ((d.kind === "set" || d.kind === "break") && m.value.types.includes(AA4.cardInfo(S, ctx.db, d.card).type))))) return "Pay from one character only";   // "コストを支払う場合、一度に1人のキャラクターからしか支払えない" (Revise#130)
      return null;
    },
    apply(ctx, it) {
      const S = ctx.S, d = S.draft;
      if ((it.sac && it.sac.length) || (it.hand && it.hand.length)) {   // Revise#137
        d.altPaid = "mixed";
        for (const id of it.cards) { d.paid.push({ card: id, ch: S.cards[id].place.ch }); AA4.enqueue(S, [{ op: "move", card: id, to: { z: "cost", seat: d.seat } }]); }
        for (const id of it.hand || []) AA4.enqueue(S, [{ op: "move", card: id, to: { z: "discard" } }]);
        for (const id of it.sac || []) AA4.enqueue(S, [{ op: "sacPay", card: id }]);
        AA4.enqueue(S, [{ op: "note", e: { e: "paid", seat: d.seat, cards: it.cards.slice(), keys: it.cards.map(id => S.cards[id].key), sac: (it.sac || []).length, hand: (it.hand || []).length } }, { op: "draftNext" }]);
        return;
      }
      if (it.alt === "discTop") {   // A3-08 1255 / 1258 (Revise#253): "あなたの捨て札置き場の一番上のカード1枚をあなたのデッキの一番上に置くことで、…支払ったものとして扱う…その後、このカードをオーナーの手札に戻す"
        d.altPaid = "discTop";
        const dis = S.players[d.seat].zones.discard, top = dis[dis.length - 1];
        if (top) AA4.enqueue(S, [{ op: "move", card: top, to: { z: "deck", seat: d.seat, pos: "top" } }]);
        const st = AA4.charStats(S, ctx.db, d.ch), src = (st.altPaySrc || {}).discTop;
        if (src && S.cards[src] && S.cards[src].place.z === "char") AA4.enqueue(S, [{ op: "move", card: src, to: { z: "hand", seat: S.cards[src].owner } }]);
        AA4.enqueue(S, [{ op: "note", e: { e: "paid", seat: d.seat, cards: [], keys: [], alt: "discTop" } }, { op: "draftNext" }]);
        return;
      }
      if (it.alt === "deck2") {   // "あなたのデッキの上のカード2枚をあなたのダメージ置き場に置くことで、…支払ったものとして扱う"
        d.altPaid = "deck2";
        const deck = S.players[d.seat].zones.deck;
        for (const id of deck.slice(-2)) AA4.enqueue(S, [{ op: "move", card: id, to: { z: "damage", seat: d.seat } }]);
        AA4.enqueue(S, [{ op: "note", e: { e: "paid", seat: d.seat, cards: [], keys: [], alt: "deck2" } }, { op: "draftNext" }]);
        return;
      }
      if (it.alt) {
        const id = it.cards[0];
        d.altPaid = it.alt;
        if (it.alt === "hand") AA4.enqueue(S, [{ op: "move", card: id, to: { z: "damage", seat: d.seat } }]);
        else if (it.alt === "perm" && (AA4.charStats(S, ctx.db, d.ch).altPayX || []).some(x => x.card === id && x.to === "damage")) AA4.enqueue(S, [{ op: "move", card: id, to: { z: "damage", seat: S.cards[id].owner } }]);   // A3-04 0652 (Revise#264)
        else { d.paid.push({ card: id, ch: d.ch }); AA4.enqueue(S, [{ op: "move", card: id, to: { z: "cost", seat: d.seat } }]); }
        AA4.enqueue(S, [{ op: "note", e: { e: "paid", seat: d.seat, cards: [id], keys: [S.cards[id].key], alt: it.alt } }, { op: "draftNext" }]);
        return;
      }
      if (d.cost == null) { d.cost = it.cards.length; d.x = it.cards.length - (d.extra || 0); ctx.emit({ e: "xSet", seat: d.seat, x: d.x, cost: d.cost, card: d.card, free: true }); }   // free X: X = the number paid
      for (const id of it.cards) {
        d.paid.push({ card: id, ch: S.cards[id].place.ch });
        AA4.enqueue(S, [{ op: "move", card: id, to: { z: "cost", seat: d.seat } }]);
      }
      AA4.enqueue(S, [{ op: "note", e: { e: "paid", seat: d.seat, cards: it.cards.slice(), keys: it.cards.map(id => S.cards[id].key) } }, { op: "draftNext" }]);
    },
  };

  /** 百式改 (Revise#132): "≪キャラクター1人を目標とするプロジェクトカード・ファストカード・エフェクト≫の目標は、このキャラクターに変更される" /
      "≪キャラクターを対象とする、範囲のプロジェクトカード・ファストカード≫の対象は、このキャラクター1人に変更される" */
  AA4.decoyOf = (S, db, user) => Object.keys(S.chars).find(id => id !== user && AA4.charStats(S, db, id).decoy) || null;
  AA4.decoyTargets = (S, db, targets, user) => {
    const t = targets || [], d = t.length === 1 && t[0].ch && !t[0].card ? AA4.decoyOf(S, db, user) : null;
    return d && d !== t[0].ch ? [{ ch: d }] : t;
  };
  /** Revise#137: payments besides power cards — sac: Controlled Characters (their top card ids) that may be discarded for 1 cost each
      ("パワー1以上のあなたの支配キャラクター1人を捨て札することで、≪このキャラクター≫から1コストを支払ったものとして扱う" / "このキャラクターのエフェクトは、捨て札したあなたの支配キャラクター1人につき1コストを支払ったものとして使用宣言可能");
      hand: how many hand cards may pay the Boost ("あなたの任意のあなたの手札X枚を捨て札することで、≪このキャラクター≫からブーストのコストを支払ったものとして扱う"). */
  AA4.payExtras = (S, db, d) => {
    const out = { sac: [], hand: 0 };
    if (!d || d.step !== "pay" || !d.cost) return out;
    const users = (d.payFrom || []).filter(ch => S.chars[ch]);
    const rules = users.flatMap(ch => (AA4.charStats(S, db, ch).sacPay || []).map(v => Object.assign({ ch }, v))).filter(v => !v.kinds || (v.kinds.includes(d.kind) && d.ch === v.ch));
    if (rules.length) {
      const minP = Math.min(...rules.map(v => +v.minPower || 0));
      out.sac = AA4.controlledOf(S, d.seat).filter(ch => ch !== d.ch && !rules.every(v => v.ch === ch) && S.chars[ch].power.length >= minP).map(ch => AA4.topOf(S.chars[ch]));
    }
    if (d.kind === "attack" && d.boost && S.chars[d.ch] && AA4.charStats(S, db, d.ch).handBoost) out.hand = Math.min(d.boost, S.players[d.seat].zones.hand.length);
    { const hp = d.kind === "effect" && d.card && S.cards[d.card] ? (db.card(S.cards[d.card].key) || {}).effHandPay : null;   // EP252 (Revise#157): "このカードに書かれたエフェクトは、捨て札したあなたの手札の…を持つカード1枚につき1コストを支払ったものとして使用宣言可能"
      if (hp) { out.handIds = S.players[d.seat].zones.hand.filter(id => (db.card(S.cards[id].key) || {}).icons && db.card(S.cards[id].key).icons.some(i => (hp.icons || []).includes(i))); out.hand = Math.min(d.cost, out.handIds.length); out.handLabel = "Or discard hand cards with " + (hp.icons || []).join(" / ") + " (1 each)"; } }
    return out;
  };
  OPS.sacPay = (ctx, op) => { const ch = AA4.charOfCard(ctx.S, op.card); if (ch) AA4.defeat(ctx, ch.id, { why: "discarded as a cost" }); };
  /** Other ways to pay this Attack / Guard Cost: "hand" (a hand card → your Damage Pile), "perm" (a Permanent on it). */
  AA4.altPays = (S, db, d) => {
    if (!d || (d.kind !== "attack" && d.kind !== "guard") || !S.chars[d.ch] || !d.cost) return [];
    const st = AA4.charStats(S, db, d.ch), out = [];
    for (const k of st.altPay || []) {
      if (k === "hand" && S.players[d.seat].zones.hand.length && !out.includes(k)) out.push(k);
      if (k === "perm" && S.chars[d.ch].perm.length && !out.includes(k)) out.push(k);
      if (k === "deck2" && S.players[d.seat].zones.deck.length >= 2 && !out.includes(k)) out.push(k);
      if (k === "discTop" && S.players[d.seat].zones.discard.length && !out.includes(k)) out.push(k);   // A3-08 1255 / 1258 (Revise#253)
    }
    if (AA4.altPermCards(S, db, d).length && !out.includes("perm")) out.push("perm");
    if ((st.altPayX || []).some(x => x.kind === "hand" && (!x.kinds || x.kinds.includes(d.kind))) && S.players[d.seat].zones.hand.length && !out.includes("hand")) out.push("hand");   // Revise#174
    return out;
  };
  /** The Permanents on the character that may pay this cost instead (Revise#129 / #170). */
  AA4.altPermCards = (S, db, d) => {
    if (!d || !S.chars[d.ch]) return [];
    const st = AA4.charStats(S, db, d.ch), ch = S.chars[d.ch];
    if ((st.altPay || []).includes("perm")) return ch.perm.slice();
    return [...new Set((st.altPayX || []).filter(x => x.kind === "perm" && (!x.kinds || x.kinds.includes(d.kind)) && x.card && ch.perm.includes(x.card)).map(x => x.card))];
  };
  /** An effect without chosen targets whose every group step ("≪…全て≫") matches nothing now → nothing to do (Pack: can't be declared). */
  AA4.groupEmpty = (S, db, body, ctx) => {
    const groups = (body.steps || []).filter(s => s.to && typeof s.to === "object" && s.to.all);
    if (!groups.length || groups.length !== (body.steps || []).filter(s => s.a !== "manual").length) return false;
    return groups.every(s => !Object.keys(S.chars).some(id => AA4.matchChar(S, db, s.to.all, id, { seat: ctx.seat, self: ctx.ch, x: ctx.x })));
  };
  /** Does a spec have enough to choose from? (every part of a multi-target spec) */
  AA4.specHasTargets = (S, db, spec, ctx) => {
    const one = p => p.upTo || AA4.specCount(p, ctx) === 0 || AA4.targetCandidates(S, db, p, ctx).length >= AA4.specCount(p, ctx);
    return spec.kind === "multi" ? spec.parts.every(one) : one(spec);
  };
  AA4.draftCtx = d => ({ seat: d.seat, ch: d.ch, card: d.card, x: d.x == null ? d.cost : d.x, effect: d.kind === "effect" });
  /** How many targets the draft needs in all. */
  /** A free Permanent slot (Pack, Revise#184): fewer Permanent cards than its Permanent limit, counting the Permanents still in Resolve aimed at it. */
  AA4.permRoom = (S, db, chId) => {
    const ch = S.chars[chId]; if (!ch) return false;
    const coming = S.stack.filter(it => it.kind === "set" && it.card && S.cards[it.card] && (db.card(S.cards[it.card].key) || {}).type === "Permanent" && (it.targets || []).some(t => t.ch === chId)).length;
    return ch.perm.length + coming < AA4.charStats(S, db, chId).permLimit;
  };
  AA4.draftCount = d => (!d.spec ? 0 : d.spec.kind === "break" || d.spec.kind === "perm" ? 1 : d.spec.kind === "multi" ? d.spec.parts.reduce((a, p) => a + AA4.specCount(p, AA4.draftCtx(d)), 0) : AA4.specCount(d.spec, AA4.draftCtx(d)));
  /** Valid targets of the draft now (refs). picked = targets chosen so far (multi-target: the next part's candidates). */
  AA4.draftTargets = (S, db, d, picked = []) => {
    if (!d || !d.spec) return [];
    if (d.spec.kind === "break") {
      const out = AA4.breakTargets(S, db, d.seat, d.card, d.force).filter(ch => !d.spec.ownOnly || S.chars[ch].owner === d.seat).filter(ch => !d.spec.oppOnly || S.chars[ch].owner !== d.seat).filter(ch => !d.spec.faction || AA4.charStats(S, db, ch).faction === d.spec.faction).filter(ch => !d.spec.unnamed || !AA4.charStats(S, db, ch).named)
        .filter(ch => !d.spec.fastOnly || AA4.fastBreakOk(S, db, d.seat, ch, AA4.cardInfo(S, db, d.card))).filter(ch => !d.spec.only || d.spec.only.includes(ch)).map(ch => ({ ch }));
      if (AA4.directBreak(S, db, d.seat, d.card) && !d.spec.fastOnly && !d.spec.only) out.push({ field: true });
      return out;
    }
    if (d.spec.kind === "perm") return AA4.controlledOf(S, d.seat).filter(ch => (!d.spec.only || d.spec.only.includes(ch)) && AA4.permRoom(S, db, ch)).map(ch => ({ ch }));   // only a character with a free Permanent slot (Pack, Revise#184)
    const ctx = AA4.draftCtx(d);
    if (d.spec.kind === "multi") {
      let k = 0;
      for (const part of d.spec.parts) {
        const n = AA4.specCount(part, ctx);
        if (picked.length < k + n) { const got = picked.map(x => JSON.stringify(x)); return AA4.targetCandidates(S, db, part, ctx).filter(x => !got.includes(JSON.stringify(x))); }
        k += n;
      }
      return [];
    }
    return AA4.targetCandidates(S, db, d.spec, ctx);
  };
  INTENTS.target = {
    undoable: true,
    check(ctx, it) {
      const S = ctx.S, d = S.draft, seat = AA4.seatFor(S, it);
      if (!d || d.step !== "target") return "Nothing to choose a target for";
      if (seat !== d.seat) return "Not your declaration";
      const t = it.targets;
      if (!Array.isArray(t) || !t.length) return "Choose a target";
      if (d.xMode === "def" && d.cost == null) {   // X comes from this target: can it be paid?
        const x = AA4.xFromDef(S, ctx.db, d.xDef, { seat: d.seat, ch: d.ch, card: d.card }, t);
        const have = d.payFrom.reduce((n, ch) => n + (S.chars[ch] ? S.chars[ch].power.length : 0), 0);
        if (x > have) return `X = ${x} for this target: not enough power cards (${have})`;
      }
      if (d.spec.kind === "break" || d.spec.kind === "perm") {
        if (t.length !== 1) return "Choose one character";
        return AA4.draftTargets(S, ctx.db, d).some(x => JSON.stringify(x) === JSON.stringify(t[0])) ? null : "Not a valid target";
      }
      const tax = AA4.targetTax(S, ctx.db, d, t);
      if (tax > 0) { const have = d.payFrom.reduce((n, ch) => n + (S.chars[ch] ? S.chars[ch].power.length : 0), 0); if (tax > have) return `This target costs ${tax} more: not enough power cards (${have})`; }
      return AA4.checkTargets(S, ctx.db, d.spec, t, AA4.draftCtx(d));
    },
    apply(ctx, it) {
      const S = ctx.S, d = S.draft;
      d.targets = it.targets.map(x => Object.assign({}, x));
      const tax = AA4.targetTax(S, ctx.db, d, d.targets);   // Q#44 (Revise#145): "≪このキャラクターを対象に含む、あなたが使用する…≫のコストに+Xする" — paid now
      if (tax > 0 && !d.taxAdd) { d.taxAdd = tax; if (d.cost != null) { d.cost += tax; d.step = "pay"; } ctx.emit({ e: "targetTax", seat: d.seat, n: tax }); }
      else if (tax < 0 && !d.taxAdd && d.cost != null) {   // a discount for this target (3495): fewer to pay, or one paid card back
        d.taxAdd = tax; const was = d.cost; d.cost = Math.max(AA4.cardInfo(S, ctx.db, d.card).type === "Break" ? 0 : 1, d.cost + tax);
        for (let k = 0; k < was - d.cost && d.paid.length > d.cost; k++) { const x = d.paid.pop(); if (S.chars[x.ch]) AA4.moveCard(ctx, x.card, { z: "char", ch: x.ch, role: "power" }); }
      }
      AA4.enqueue(S, [{ op: "draftNext" }]);
    },
  };
  /** Q#44: extra cost for choosing these characters as targets of your own Project / Fast card or effect (X = its Mental) */
  AA4.targetTax = (S, db, d, targets) => {
    if (!d) return 0;
    const ty = d.kind === "set" ? AA4.cardInfo(S, db, d.card).type : null;
    if (d.kind === "set" && ty === "Break" && AA4.cardInfo(S, db, d.card).costLessOnto) {   // EP397 (Revise#157): "構成するカードに「X」を含むキャラクターにこのカードをセット宣言する場合、≪このカード≫のコストはN減少する"
      const cl = AA4.cardInfo(S, db, d.card).costLessOnto, t = (targets || [])[0];
      if (t && t.ch && S.chars[t.ch] && S.chars[t.ch].stack.some(id => ((db.card(S.cards[id].key) || {}).jp || "").replace(/\s+/g, "") === cl.jp)) return -Math.min(cl.n, d.cost || 0);
    }
    if (d.kind === "set" && ty === "Break") {   // 3116 (Revise#151): "あなたの対戦相手があなたのテリトリーのキャラクターを目標にブレイクカードをセット宣言する場合、…コストに+X (X = このキャラクターの精神力)"
      return (targets || []).reduce((n, t) => {
        if (!t.ch || !S.chars[t.ch] || S.chars[t.ch].owner === d.seat) return n;
        const own = S.chars[t.ch].owner;
        return n + Object.keys(S.chars).filter(id => S.chars[id].owner === own && AA4.charStats(S, db, id).breakTaxMine).reduce((k, id) => k + Math.max(0, AA4.charStats(S, db, id).se || 0), 0);
      }, 0);
    }
    if (d.kind === "set" && ty === "Permanent") {   // 3495 (Revise#152): "鬼・鬼♂にパーマネントカードをセット宣言する場合、そのカードのコストは1減少し…コストは1未満にはならない"
      const t = (targets || [])[0], ic = t && t.ch && S.chars[t.ch] ? AA4.charStats(S, db, t.ch).icons : [];
      const m = AA4.allMods(S, db).find(x => x.key === "permOntoDiscount" && AA4.modAppliesToSeat(S, x, d.seat) && ic.some(i => ((x.value && x.value.icons) || []).includes(i)));
      return m && d.cost != null && d.cost > 1 ? -1 : 0;
    }
    if (!(d.kind === "effect" || (d.kind === "set" && ["Project", "Fast"].includes(ty)))) return 0;
    return (targets || []).reduce((n, t) => {
      if (!t.ch || !S.chars[t.ch]) return n;
      const st = AA4.charStats(S, db, t.ch), tt = st.targetTax;
      if (!tt || (S.chars[t.ch].owner !== d.seat && !(tt && tt.any))) return n;
      return n + Math.max(0, tt.stat === "power" ? S.chars[t.ch].power.length : st.se || 0);   // 3759 (Revise#151): anyone's, X = its power
    }, 0);
  };

  INTENTS.cancel = {
    undoable: true,
    check(ctx, it) {
      const S = ctx.S, d = S.draft;
      if (!d) return "Nothing to cancel";
      return AA4.seatFor(S, it) === d.seat ? null : "Not your declaration";
    },
    apply(ctx) { AA4.enqueue(ctx.S, [{ op: "refund", why: "cancelled" }]); },
  };
  /** Cancel the draft: paid power cards go back to the characters they came from (Revise#059). */
  OPS.refund = (ctx, op) => {
    const S = ctx.S, d = S.draft;
    if (!d) return;
    for (const { card, ch } of d.paid) AA4.moveCard(ctx, card, S.chars[ch] ? { z: "char", ch, role: "power" } : { z: "discard" });
    if (d.card && S.cards[d.card] && S.cards[d.card].asBreak && S.cards[d.card].place.z === "hand") delete S.cards[d.card].asBreak;
    if (d.card && S.cards[d.card] && S.cards[d.card].asFast && S.cards[d.card].place.z === "hand") delete S.cards[d.card].asFast;
    if (d.card && S.cards[d.card] && S.cards[d.card].mode != null && S.cards[d.card].place.z === "hand") delete S.cards[d.card].mode;
    if (d.card && S.cards[d.card] && S.cards[d.card].noRule) delete S.cards[d.card].noRule;
    S.draft = null; S.effDecl = null;
    ctx.emit({ e: "declarationCancelled", seat: d.seat, kind: d.kind, card: d.card, why: op.why || "cancelled", refunded: d.paid.length });
  };

  /** The declaration is complete: card to the Special Area / aside, cost to its destination, item to the Resolve list. */
  OPS.draftDone = ctx => {
    const S = ctx.S, d = S.draft, via0 = S.effDecl && S.effDecl.card === d.card ? S.effDecl : null;
    S.draft = null; S.effDecl = null;
    const p = S.players[d.seat];
    p.turnFlags.declared = true;
    if (d.projFastTurn) p.projFastTurn = S.turn.number;   // 0876: once in each turn
    { const i5 = d.kind === "set" && d.card && S.cards[d.card] ? ctx.db.card(S.cards[d.card].key) || {} : {};   // "…使用宣言されている場合、…使用宣言時にあなたは1ドローする" (0743, Revise#360)
      if (i5.declDrawIf && AA4.checkCond(S, ctx.db, i5.declDrawIf.cond, { seat: d.seat, card: d.card })) AA4.enqueue(S, [{ op: "draw", seat: d.seat, n: i5.declDrawIf.n }], true); }
    if (S.turn.phase === "main" && S.turn.player === d.seat) p.turnFlags.mainDeclared = true;
    if (d.kind === "set" && d.card && d.fromDmg) p.dmgPlayTurn = S.turn.number;   // "各ターンに1度だけ、あなたのダメージ置き場にある…カードを…使用宣言可能" (0982, Revise#348)
    if (d.kind === "set" && d.card && (ctx.db.card(S.cards[d.card].key) || {}).type === "Project") for (const m of S.modifiers.filter(m => m.key === "projFastNext" && m.src && m.src.seat === d.seat)) AA4.endMod(ctx, m.id);   // EP607: the next Project card only
    if (d.kind === "set" && d.card) { if (!p.usedTurn || p.usedTurn.turn !== S.turn.number) p.usedTurn = { turn: S.turn.number, keys: [] }; p.usedTurn.keys.push(S.cards[d.card].key); }   // EX0389 (Revise#161): "各ターンの最初に使用する…"
    if (S.turn.phase === "main" && d.kind === "set" && d.card) {   // "各ターンのメインフェイズ中に、最初に使用する…" (Revise#140)
      if (!p.mainCount || p.mainCount.turn !== S.turn.number) p.mainCount = { turn: S.turn.number };
      const ty = (AA4.cardInfo(S, ctx.db, d.card) || {}).type; p.mainCount[ty] = (p.mainCount[ty] || 0) + 1;
    }
    const paid = d.paid.map(x => x.card);
    {   // who paid (for "ファストカードまたはエフェクトのコストを支払ったキャラクター"): one event per character
      const inf0 = d.card ? AA4.cardInfo(S, ctx.db, d.card) : {}, kind = d.kind === "effect" ? "effect" : d.kind === "set" ? inf0.type : d.kind;
      for (const ch of [...new Set(d.paid.map(x => x.ch))]) if (S.chars[ch]) {
        ctx.emit({ e: "costPaid", ch, seat: d.seat, kind, stats: { n: d.paid.filter(x => x.ch === ch).length } });
        (S.turn.paidChars = S.turn.paidChars || {})[ch] = true;   // EX0504 (Revise#157)
        for (const m of AA4.allMods(S, ctx.db).filter(x => x.key === "payNegateSkills")) AA4.addMod(ctx, { src: m.src, to: { ch }, key: "negate", op: "grant", value: { skills: true }, until: m.until || "charge" });   // A3-02 0242 (Revise#159)
        for (const m of AA4.allMods(S, ctx.db).filter(x => x.key === "drawOnOppPay" && x.src && S.chars[ch] && AA4.isControlled(S.chars[ch]) && S.chars[ch].owner !== x.src.seat)) { const n = d.paid.filter(x => x.ch === ch).length; if (n) AA4.enqueue(S, [{ op: "draw", seat: m.src.seat, n }]); }   // A3-02 0277
        for (const m of AA4.allMods(S, ctx.db).filter(x => x.key === "payDoom" && S.chars[ch] && AA4.isControlled(S.chars[ch]))) AA4.enqueue(S, [{ op: "payDoomAsk", ch, n: (m.value && m.value.n) || 0, label: (m.src && m.src.label) || "" }]);   // A3-01 0026 (Revise#159)
        // "…終了時まで、目標からコストが支払われた場合、目標に±0/-X/-Xする" (Revise#109): the hook adds its stat changes now
        for (const m of AA4.allMods(S, ctx.db).filter(x => x.key === "payHook" && AA4.modAppliesToChar(S, ctx.db, x, ch)))
          for (const [k, n] of Object.entries((m.value && m.value.stats) || {})) if (n) AA4.addMod(ctx, { src: m.src, to: { ch }, key: k, op: "add", value: n, until: m.until || "main" });
      }
    }
    const payInfo = { kind: d.kind === "attack" || d.kind === "guard" ? d.kind : d.kind, seat: d.seat, ch: d.kind === "set" ? null : d.ch,
      info: d.card ? AA4.cardInfo(S, ctx.db, d.card) : null, target: d.target, against: S.battle ? S.battle.attacker : null,
      from: Object.fromEntries(d.paid.map(x => [x.card, x.ch])) };   // which character each card was paid from ("このキャラクターから支払われた…のコスト")
    payInfo.targetCh = d.targets[0] && d.targets[0].ch ? d.targets[0].ch : null;
    const body = d.kind === "effect" ? AA4.effectsOf(S, ctx.db, d.ch, d.card)[d.i] : d.kind === "set" ? AA4.cardInfo(S, ctx.db, d.card).play : null;
    const hold = body && body.costTo === "hold";   // "目標に、このエフェクトのコストをパワーカードとしてセットする": the cost waits for the effect
    // "このエフェクトのコストを手札に戻す" (Pack, Revise#089): the cost goes where the rules say now (Discard Pile, or the hand with
    // Infinity); only when the declaration resolves successfully does it come back from the Discard Pile to the hand
    const allNames = body && body.costBackIfAll && body.costBackIfAll.every(n => d.paid.some(x => S.chars[x.ch] && (AA4.charStats(S, ctx.db, x.ch).name || "").replace(/\s+/g, "") === n));   // EP342 (Revise#222): "…全てから1コスト以上支払われている場合、≪このカードのコスト≫は手札に戻る"
    const backLater = body && (body.costTo === "hand" || allNames) && !hold;
    if (body && body.costTo && !hold && !backLater) payInfo.extra = [{ to: body.costTo, label: d.kind === "effect" ? "This effect" : "This card" }];
    if (body && body.costToIf && AA4.checkCond(S, ctx.db, body.costToIf.cond, { seat: d.seat, ch: d.ch, card: d.card })) payInfo.extra = (payInfo.extra || []).concat([{ to: body.costToIf.to, label: "Its condition is met" }]);   // "…が5体以上いる場合、その後、≪このエフェクトのコスト≫を手札に戻す" (EX851, Revise#353)
    if (body && body.costToIfNotOwn && (d.targets || []).some(t => t.ch && S.chars[t.ch] && S.chars[t.ch].owner !== d.seat)) payInfo.extra = (payInfo.extra || []).concat([{ to: body.costToIfNotOwn, label: "The target is not in your territory" }]);   // A3-20 2804 (M5a)
    if (body && body.costToIfNamed && (d.targets || []).some(t => t.card && S.cards[t.card] && (ctx.db.card(S.cards[t.card].key) || {}).name)) payInfo.extra = (payInfo.extra || []).concat([{ to: body.costToIfNamed, label: "The target has a name" }]);   // "目標がネームを持つ場合、このエフェクトのコストを…ダメージ置き場に置く" (Revise#133)
    { const pf0 = d.kind === "set" && d.card && S.cards[d.card] && S.cards[d.card].place.z === "damage" ? (ctx.db.card(S.cards[d.card].key) || {}).playFromDamage : null;   // "この効果でセット宣言した場合、≪このカードのコスト≫は、オーナーの手札に戻る" (Revise#128)
      if (pf0 && pf0.costTo) payInfo.extra = (payInfo.extra || []).concat([{ to: pf0.costTo, label: "Set from the Damage Pile" }]); }
    if (via0 && via0.costTo) payInfo.extra = (payInfo.extra || []).concat([{ to: via0.costTo, label: "その際に支払ったコスト" }]);   // メアリー・ピュア (Q#54)
    const ops = [];
    if (d.altMill) { const deck = S.players[d.seat].zones.deck; for (let k = 0; k < d.altMill && deck.length; k++) AA4.moveCard(ctx, deck[deck.length - 1], { z: "discard" }); ctx.emit({ e: "altCost", seat: d.seat, card: d.card, n: d.altMill }); }   // the other cost: N cards from the deck top
    if (d.kind === "set" && d.card && S.cards[d.card] && S.cards[d.card].place.z === "damage") {   // declared from the Damage Pile: its extra cost (mill N)
      const pf = (ctx.db.card(S.cards[d.card].key) || {}).playFromDamage, deck = S.players[d.seat].zones.deck;
      for (let k = 0; k < ((pf && pf.mill) || 0) && deck.length; k++) AA4.moveCard(ctx, deck[deck.length - 1], { z: "discard" });
    }
    if (d.kind === "set" || d.kind === "effect") {
      const inf = d.card ? AA4.cardInfo(S, ctx.db, d.card) : {};
      if (d.kind === "set" && S.cards[d.card]) S.cards[d.card].projDecl = S.turn.player === d.seat && S.turn.phase === "main" && !S.stack.length && !S.battle;
      if (d.kind === "set" && S.cards[d.card]) S.cards[d.card].fastDecl = !S.cards[d.card].projDecl;   // 3795 (Revise#152): "この効果でセットされた場合" (declared at Fast timing)   // declared at your Project timing (Revise#129)
      if (d.guardSet) ops.push({ op: "guardSetGo", card: d.card, seat: d.seat });   // Q#41: no Resolve list — it enters and guards at once
      else {
      if (d.kind === "set") ops.push({ op: "move", card: d.card, to: { z: inf.type === "Fast" || inf.type === "Project" ? "special" : "declared", seat: d.seat } });
      if (d.useMod && S.modifiers.some(m => m.id === d.useMod)) AA4.endMod(ctx, d.useMod);
      if (d.kind === "effect") (S.turn.effUsed = S.turn.effUsed || {})[d.card + "#" + d.i] = true;   // EP175: the free declaration is used up
      const fNext = d.kind === "set" && AA4.cardInfo(S, ctx.db, d.card).type !== "Character" ? S.modifiers.find(m => m.key === "factorIgnore" && m.value && m.value.next && AA4.modAppliesToSeat(S, m, d.seat)) : null;   // "あなたが次に使用宣言するカードの必要ファクターを無視して使用宣言可能" (PR262, Revise#199): used up by this card
      if (fNext) { AA4.endMod(ctx, fNext.id); d.free = true; }
      if (d.kind === "set") {   // "あなたが次に使用宣言する…ブレイクカードの必要ファクターはX減少する" (EX0696, Revise#356): used up by the first card it fits
        const i3 = AA4.cardInfo(S, ctx.db, d.card) || {}, fl = S.modifiers.filter(m => m.key === "factorLess" && m.value && m.value.next && AA4.modAppliesToSeat(S, m, d.seat) && (q => (!q.types || q.types.includes(i3.type)) && (q.named == null || !!i3.name === q.named) && (!q.works || AA4.worksOf(i3, q.works)) && (!q.notFaction || i3.faction !== q.notFaction))(m.value.sel || {}));
        if (fl.length) { for (const m of fl) AA4.endMod(ctx, m.id); d.free = true; }
      }
      const item = { payChs: [...new Set((d.paid || []).map(x => x.ch))], endMain: !!d.endMain, id: d.id, kind: d.kind, seat: d.seat, card: d.card, ch: d.ch, i: d.i, x: d.kind === "effect" || inf.cost === "X" ? (d.x == null ? d.cost : d.x) : d.declXn != null ? d.declXn : null, discountN: d.discountN || 0, fLess: d.fLess || 0,
        targets: d.targets, projTiming: S.turn.player === d.seat && S.turn.phase === "main" && !S.stack.length && !S.battle, asChar: d.asChar || undefined, paid: paid.length, paidKeys: paid.map(id => S.cards[id].key), paidIds: paid.slice(), force: d.force, held: hold ? paid : undefined, free: d.free || undefined, returnCost: backLater && paid.length ? paid : undefined };
      if (d.kind === "set" && inf.type === "Project" && d.paid.length) { const chs = [...new Set(d.paid.map(x => x.ch))]; if (chs.length === 1 && S.chars[chs[0]] && AA4.charStats(S, ctx.db, chs[0]).noRespIfOnly) item.noResponse = true; }   // 2356 (Q#55): "プロジェクトカードのコストがこのキャラクターからのみ支払われていた場合、≪プレイヤー全て≫は、…レスポンスを行うことができない"
      const guesser = d.kind === "set" && inf.type !== "Character" ? Object.keys(S.chars).find(id => S.chars[id].owner !== d.seat && AA4.isControlled(S.chars[id]) && AA4.charStats(S, ctx.db, id).guessName && S.chars[id].power.length >= 1) : null;   // 2686 (Q#50)
      if (d.kind === "set" && inf.kicker && d.fromHand !== false && S.cards[d.card]) { delete S.cards[d.card].kick; delete S.cards[d.card].kickX; ops.push({ op: "kickerAsk", seat: d.seat, card: d.card, kicker: inf.kicker }); }   // 3153 / 3684 (Revise#152): "このカードを（手札から）セット宣言する場合、…追加でXコスト支払うことが可能"
      if (guesser) ops.push({ op: "guessAsk", item, ch: guesser, seat: S.chars[guesser].owner });
      else ops.push({ op: "pushItem", item });
      }
    } else ops.push({ op: "battleDeclared", d: { kind: d.kind, seat: d.seat, ch: d.ch, target: d.target, boost: d.boost, paid: paid.length, paidKeys: paid.map(id => S.cards[id].key), payers: [...new Set(d.paid.map(x => x.ch))] } });   // payers: who paid it (Revise#152)   // the cost is shown until the battle ends (Pack, Revise#113)
    if (paid.length && !hold) ops.push({ op: "costDest", seat: d.seat, cards: paid, pay: payInfo });
    if (via0 && via0.again) ops.push(via0.again);   // 3535 (Revise#152): "任意の枚数の…を、コストを無視して…セット宣言可能": ask for the next one
    AA4.enqueue(S, ops, true);
  };
  OPS.retargetGo = (ctx, op) => {
    const S = ctx.S, it = S.stack.find(x => x.id === op.item), a = (op.answer || [])[0];
    if (it && a && a !== "__keep__") { it.targets = [JSON.parse(a)]; ctx.emit({ e: "note", text: "The target was changed (ロュス・アルタイル)" }); }
    AA4.enqueue(S, [{ op: "resolveTop" }], true);
  };
  OPS.bounceCardGo = (ctx, op) => { const c = ctx.S.cards[op.card]; if (c && c.place.z === "char") AA4.moveCard(ctx, op.card, { z: "hand" }); };
  OPS.costRescueAsk = (ctx, op) => {
    const S = ctx.S, c = S.cards[op.card], n = ((ctx.db.card(c.key) || {}).costRescue || {}).discard || 2;
    const pw = AA4.controlledOf(S, op.seat).flatMap(id => S.chars[id].power);
    if (!c || !["discard", "damage", "hand"].includes(c.place.z) || pw.length < n || S.draft) return;
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: pw, min: 0, max: n, auto: false, reason: `${AA4.cardName(ctx.db.card(c.key) || {})} was paid as a cost: discard ${n} power cards of your Controlled Characters to declare it without its cost (or choose none)`, then: [{ op: "costRescueGo", card: op.card, seat: op.seat, n }] });
  };
  OPS.costRescueGo = (ctx, op) => {
    const S = ctx.S, pick = (op.answer || []).filter(id => S.cards[id] && S.cards[id].place.z === "char");
    if (pick.length < op.n) return;
    for (const id of pick) AA4.moveCard(ctx, id, { z: "discard" });
    AA4.enqueue(S, [{ op: "effDeclPick", seat: op.seat, ch: null, zones: [S.cards[op.card].place.z], types: ["Break"], onlyIds: [op.card], freeCost: true }], true);
  };
  OPS.kickerAsk = (ctx, op) => {
    const S = ctx.S, db = ctx.db, have = AA4.controlledOf(S, op.seat).reduce((n, id) => n + S.chars[id].power.length, 0);
    if (op.kicker.designate) {
      const opts = Object.keys(S.chars).filter(id => (!op.kicker.unbroken || !AA4.charStats(S, db, id).broken) && S.chars[id].power.length <= have);
      if (!opts.length) return;
      return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 0, max: 1, auto: false, reason: "You may designate a character and pay X more (X = its power): it is discarded when this card is set", then: [{ op: "kickerPick", seat: op.seat, card: op.card }] });
    }
    const opts = ["0"].concat(Array.from({ length: Math.min(have, 15) }, (_, i) => String(i + 1)));
    return AA4.ask(ctx, { seat: op.seat, kind: "pick", options: opts, labels: opts.map(n => n === "0" ? "No extra cost" : `Pay ${n} more`), reason: "You may pay X more: when this card is set, you reveal your deck until a cost-X Project card and declare it", then: [{ op: "kickerPick", seat: op.seat, card: op.card, xOnly: true }] });
  };
  OPS.kickerPick = (ctx, op) => {
    const S = ctx.S, a = (op.answer || [])[0];
    if (a == null) return;
    let x, ch = null;
    if (op.xOnly) x = +a || 0; else { const c = AA4.charOfCard(S, a); if (!c) return; ch = c.id; x = c.power.length; }
    if (!op.xOnly) S.cards[op.card].kick = ch; else S.cards[op.card].kickX = x;
    if (x <= 0) return;
    const pw = AA4.controlledOf(S, op.seat).flatMap(id => S.chars[id].power);
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: pw, min: x, max: x, reason: `Pay the extra ${x}: choose ${x} power card(s) of your Controlled Characters`, then: [{ op: "toDiscard" }] });
  };
  /** エラキス (Q#41): set as your Controlled Character; every attack is cancelled and it battles them (as a guard), taking no battle damage */
  OPS.guardSetGo = (ctx, op) => {
    const S = ctx.S, B = S.battle;
    if (!S.cards[op.card] || S.cards[op.card].place.z !== "hand") return;
    AA4.moveCard(ctx, op.card, { z: "front", seat: op.seat });
    const ch = AA4.charOfCard(S, op.card);
    ctx.emit({ e: "entered", card: op.card, seat: op.seat, ch: ch && ch.id });
    if (!ch || !B || B.defender !== op.seat || B.guard) return;
    AA4.addMod(ctx, { src: { seat: op.seat, card: op.card, ch: ch.id, label: AA4.cardName(ctx.db.card(S.cards[op.card].key)) }, to: { ch: ch.id }, key: "noDamage", op: "grant", value: { battle: true }, until: "battle" });
    B.guard = ch.id; B.step = "response"; S.passed = [];
    ch.flags.tapped = true;
    ctx.emit({ e: "guarded", ch: ch.id, seat: op.seat, attacker: B.attacker, fromHand: true });
  };
  OPS.tokenFactionAsk = (ctx, op) => {
    if (!ctx.S.chars[op.ch]) return;
    const opts = ["E.G.O.", "Arayashiki", "WIZ-DOM", "Darklore", "Polestar Empire", "Eraser"];
    return AA4.ask(ctx, { seat: op.seat, kind: "pick", options: opts, reason: "Choose the token's faction", then: [{ op: "tokenFactionGo", ch: op.ch }] });
  };
  OPS.tokenFactionGo = (ctx, op) => { const m = ctx.S.modifiers.find(x => x.key === "token" && x.to && x.to.ch === op.ch); if (m && (op.answer || [])[0]) m.value = Object.assign({}, m.value, { faction: op.answer[0] }); };
  /** 2686 (Q#50, Revise#146): "≪あなたの対戦相手全て≫は、キャラクターカード以外のカードを使用宣言する場合、コストを支払った状態で、使用宣言するカードを裏向きにする。あなたは、カード名称を1つ指定し、このキャラクターから1コスト支払うことが可能。
      そうした場合、そのカードを表向きにし、指定したカード名称と同じだった場合、そのカードを捨て札する。指定したカード名称と異なっていた場合、≪このキャラクター≫に(X)ダメージを与え、…通常通りレスポンスの宣言を行う。Xは指定したカードのコストに等しい" */
  OPS.guessAsk = (ctx, op) => {
    const S = ctx.S, db = ctx.db, c = S.cards[op.item.card];
    if (!c || !S.chars[op.ch]) return OPS.pushItem(ctx, { item: op.item });
    c.faceUp = false; c.visibleTo = [c.owner];
    const seen = new Map();
    for (const x of Object.values(S.cards)) if (x.owner === op.item.seat) { const inf = db.card(x.key) || {}; if (inf.jp && inf.type !== "Character" && !seen.has(inf.jp)) seen.set(inf.jp, inf); }   // the names of that player's non-Character cards (Pack)
    const names = [...seen.keys()].sort((a, b) => AA4.cardName(seen.get(a)).localeCompare(AA4.cardName(seen.get(b))));
    ctx.emit({ e: "note", text: `${S.players[op.item.seat].name} declares a card face down` });
    return AA4.ask(ctx, { seat: op.seat, kind: "pick", options: ["__skip__"].concat(names), labels: ["Don't name it"].concat(names.map(n => `${AA4.cardName(seen.get(n))} (cost ${seen.get(n).cost})`)), reason: `${S.players[op.item.seat].name} declared a card face down: name it? (pay 1 from ${AA4.cardName(db.card(S.cards[AA4.topOf(S.chars[op.ch])].key))})`, then: [Object.assign({}, op, { op: "guessGo" })] });
  };
  OPS.guessGo = (ctx, op) => {
    const S = ctx.S, db = ctx.db, nm = (op.answer || [])[0], c = S.cards[op.item.card], me = S.chars[op.ch];
    if (c) { c.faceUp = true; c.visibleTo = []; }
    if (!nm || nm === "__skip__" || !me || !me.power.length || !c) return OPS.pushItem(ctx, { item: op.item });
    AA4.moveCard(ctx, me.power[me.power.length - 1], { z: "discard" });
    const inf = db.card(c.key) || {}, named = Object.values(S.cards).map(x => db.card(x.key) || {}).find(i => i.jp === nm) || {};
    if (inf.jp === nm) { AA4.moveCard(ctx, op.item.card, { z: "discard" }); ctx.emit({ e: "note", text: `Named right: ${AA4.cardName(inf)} is discarded` }); return; }
    ctx.emit({ e: "note", text: `Named wrong (${AA4.cardName(named)}): it goes on` });
    const x = typeof named.cost === "number" ? named.cost : 0;
    if (x > 0) AA4.damageChar(ctx, op.ch, { normal: 0, mental: x, from: null });
    return OPS.pushItem(ctx, { item: op.item });
  };
  OPS.enterPowerGo = (ctx, op) => { const S = ctx.S, ch = AA4.charOfCard(S, op.card), deck = S.players[op.seat].zones.deck; if (!ch || S.cards[op.card].place.z !== "char") return; for (let k = 0; k < op.n && deck.length; k++) AA4.moveCard(ctx, deck[deck.length - 1], { z: "char", ch: ch.id, role: "power" }); };
  OPS.pushItem = (ctx, op) => {
    const S = ctx.S;
    if (op.item.kind === "set" && op.item.card && S.cards[op.item.card] && (AA4.cardInfo(S, ctx.db, op.item.card).play || {}).selfShield) op.item.shield = Object.assign({ card: "__none__" }, (AA4.cardInfo(S, ctx.db, op.item.card).play || {}).selfShield === "fast" ? { fastOnly: true } : {});   // "このカードは、使用宣言時から効果終了時まで、ファストカード・エフェクトの効果を受けない" (Revise#159)
    { const si = op.item.kind === "set" && op.item.card && S.cards[op.item.card] && (AA4.cardInfo(S, ctx.db, op.item.card).play || {}).selfShieldIf;   // "…場合、≪このカード≫は、使用宣言時から効果終了時までファストカードの効果を受けない" (Revise#203)
      if (si && !op.item.shield && AA4.checkCond(S, ctx.db, si.cond, { seat: op.item.seat, targets: op.item.targets || [] })) op.item.shield = Object.assign({ card: "__none__" }, si.fast ? { fastOnly: true } : {}); }
    if (!op.item.holdType) {   // which Hold type answers it (Pack, Revise#168)
      const c = op.item.card && S.cards[op.item.card], ty = c ? (AA4.cardInfo(S, ctx.db, op.item.card) || {}).type : null;
      op.item.holdType = op.item.kind === "effect" ? "effect" : c && c.asFast ? "fast" : c && c.asBreak ? "break" : ty === "Project" ? "project" : ty === "Fast" ? "fast" : ty === "Permanent" && !op.item.projTiming ? "fast" : ty === "Break" || ty === "Permanent" ? "break" : "fast";   // a Permanent set at Fast timing waits in Resolve like a Fast card (Pack, Revise#189)
    }
    S.stack.push(op.item); S.passed = [];
    ctx.emit({ e: "declared", item: op.item.id, seat: op.item.seat, kind: op.item.kind, card: op.item.card, ch: op.item.ch, i: op.item.i, targets: op.item.targets, main: S.stack.length === 1 });
  };

  /* ---------- Cost screen → destination ---------- */
  const DEST = { hand: { z: "hand" }, damage: { z: "damage" }, deckTop: { z: "deck" }, deckBottom: { z: "deck", pos: "bottom" }, discard: { z: "discard" }, deckShuffle: { z: "deck" } };
  OPS.payToDamageGo = (ctx, op) => {
    const S = ctx.S, base = op.base, from = (base.pay && base.pay.from) || {};
    if ((op.answer || [])[0] === "yes" && S.chars[op.ch]) {
      const lift = base.cards.filter(id => from[id] === op.ch && S.cards[id] && S.cards[id].place.z === "cost");
      for (const id of lift) AA4.moveCard(ctx, id, { z: "damage" });
      const v = AA4.charStats(S, ctx.db, op.ch).payToDamageBoost || { at: 2 };
      AA4.addMod(ctx, { src: { seat: S.chars[op.ch].owner, ch: op.ch, card: AA4.topOf(S.chars[op.ch]), label: AA4.cardName(ctx.db.card(S.cards[AA4.topOf(S.chars[op.ch])].key) || {}) }, fromChar: true, to: { ch: op.ch }, key: "at", op: "add", value: v.at || 2, until: "main" });
      const rest = base.cards.filter(id => !lift.includes(id)); if (!rest.length) return;
      return OPS.costDest(ctx, Object.assign({}, base, { cards: rest }));
    }
    return OPS.costDest(ctx, base);
  };
  OPS.costDest = (ctx, op) => {
    { const S = ctx.S, pi = op.pay || {}, from = pi.from || {};   // EP353 (Revise#157): "≪このキャラクターから支払われたアタックコスト・ガードコスト・エフェクトコストの中にあるキャラクターカード全て≫は手札に戻る"
      if (["attack", "guard", "effect"].includes(pi.kind)) {
        const back = op.cards.filter(id => from[id] && S.chars[from[id]] && S.cards[id] && S.cards[id].place.z === "cost" && (ctx.db.card(S.cards[id].key) || {}).type === "Character" && AA4.charStats(S, ctx.db, from[id]).costCharsToHand);
        if (back.length) { for (const id of back) AA4.moveCard(ctx, id, { z: "hand", seat: S.cards[id].owner }); op = Object.assign({}, op, { cards: op.cards.filter(id => !back.includes(id)) }); if (!op.cards.length) return; }
      } }
    { const S = ctx.S, pi = op.pay || {}, from = pi.from || {};   // EP191 (Revise#157): "このキャラクターから支払われたアタックコスト・ガードコストを、…ダメージ置き場に置くことが可能。そうした場合、…攻撃力に+2する"
      if ((pi.kind === "attack" || pi.kind === "guard") && !op.ptdDone) {
        const ch = [...new Set(op.cards.filter(id => from[id] && S.chars[from[id]] && S.cards[id] && S.cards[id].place.z === "cost" && AA4.charStats(S, ctx.db, from[id]).payToDamageBoost).map(id => from[id]))][0];
        if (ch) return AA4.ask(ctx, { seat: S.chars[ch].owner, kind: "yesno", reason: `${AA4.cardName(ctx.db.card(S.cards[AA4.topOf(S.chars[ch])].key) || {})}: put the cost paid from it into your Damage Pile instead (Attack +2 until the end of the Main Phase)?`, then: [{ op: "payToDamageGo", ch, base: Object.assign({}, op, { ptdDone: true }) }] });
      } }
    { const S = ctx.S, pi = op.pay || {}, onto = pi.targetCh && S.chars[pi.targetCh], inf = pi.info || {};   // 3191 (Revise#152): "このカードを同じネームを持つカードにセットするか、このキャラクターに同じネームを持つカードをセットする場合、≪そのブレイクカードのコスト≫をこのキャラクターにパワーカードとしてセットする"
      if (onto && inf.type === "Break" && inf.name) {
        const topInf = ctx.db.card(S.cards[AA4.topOf(onto)].key) || {};
        if ((inf.sameNameCostPower || topInf.sameNameCostPower) && topInf.name === inf.name) {
          const lift = op.cards.filter(id => S.cards[id] && S.cards[id].place.z === "cost");
          for (const id of lift) AA4.moveCard(ctx, id, { z: "char", ch: onto.id, role: "power" });
          op = Object.assign({}, op, { cards: op.cards.filter(id => !lift.includes(id)) }); if (!op.cards.length) return;
        }
      } }
    { const S = ctx.S, pi = op.pay || {}, tk = pi.kind === "set" && pi.info && pi.info.costTokenOnSet;   // 3614 (Revise#152): "このカードがセットされた場合、≪このカードのコストとして支払ったカード≫を、…のあなたの支配キャラクター、ヒマワリとしてセットする"
      const held = tk ? op.cards.filter(id => S.cards[id] && S.cards[id].place.z === "cost") : [];
      if (held.length) {
        for (const id of held) {   // Pack (Revise#305): each paid card becomes its own token ("…0/0/1 characters", A3-25 3627)
          AA4.moveCard(ctx, id, { z: "back", seat: pi.seat });
          const nc = AA4.charOfCard(S, id);
          if (nc) { AA4.addMod(ctx, { src: { seat: pi.seat, label: tk.name }, to: { ch: nc.id }, key: "token", op: "grant", value: { name: tk.name, stats: tk.stats, icons: tk.icons || [], faction: "", skills: tk.skills || [] }, until: "removed" }); ctx.emit({ e: "tokenMade", ch: nc.id, seat: pi.seat, name: tk.name }); }
        }
        op = Object.assign({}, op, { cards: op.cards.filter(id => !held.includes(id)) }); if (!op.cards.length) return;
      } }
    { const S = ctx.S, rs = op.cards.filter(id => S.cards[id] && (ctx.db.card(S.cards[id].key) || {}).costRescue);   // 3342 (Revise#152): "支払ったコストの中にこのカードがあった場合、…パワーカードを2枚捨て札することで、このカードを、コストを無視して…セット宣言可能"
      if (rs.length) AA4.enqueue(S, rs.map(id => ({ op: "costRescueAsk", card: id, seat: S.cards[id].owner })), true); }
    { const S = ctx.S, from = (op.pay && op.pay.from) || {};   // ラドゥエリエル (Revise#137): "≪このキャラクターから支払われたコストの中にある、ネームを持たないイレイザーまたはイレイザー♂を持つブレイクカードまたはキャラクターカード≫を、あなたの支配キャラクターとしてセットする"
      const lift = op.cards.filter(id => { const ch = from[id], inf = ctx.db.card(S.cards[id].key) || {}; return ch && S.chars[ch] && AA4.charStats(S, ctx.db, ch).costToChars && S.cards[id].place.z === "cost" && !inf.name && ["Break", "Character"].includes(inf.type) && (inf.icons || []).some(i => i === "イレイザー" || i === "イレイザー♂"); });
      for (const id of lift) { AA4.moveCard(ctx, id, { z: "back", seat: S.cards[id].owner }); const c = AA4.charOfCard(S, id); ctx.emit({ e: "entered", card: id, seat: S.cards[id].owner, ch: c && c.id }); }
      if (lift.length) { op = Object.assign({}, op, { cards: op.cards.filter(id => !lift.includes(id)) }); if (!op.cards.length) return; } }
    { const S = ctx.S, from = (op.pay && op.pay.from) || {};   // メアリー・ピュア (Q#54, Revise#146): "≪このキャラクターから支払われたコストの中にあるパーマネントカード≫を、必要ファクターを無視して、コストを支払ってあなたの支配キャラクターにセット可能。≪その際に支払ったコスト≫は、オーナーの手札に戻る"
      const pc = op.cards.filter(id => { const ch = from[id]; return ch && S.chars[ch] && AA4.charStats(S, ctx.db, ch).permFromCost && (ctx.db.card(S.cards[id].key) || {}).type === "Permanent"; });
      if (pc.length) AA4.enqueue(S, [{ op: "effDeclPick", seat: S.chars[from[pc[0]]].owner, ch: null, zones: ["discard", "damage", "hand", "deck"], types: ["Permanent"], onlyIds: pc, ignoreFactor: true, costTo: "hand" }]); }
    { const S = ctx.S, from = (op.pay && op.pay.from) || {};   // 芦屋道満 (Revise#143): "≪このキャラクターから支払われたコスト≫を、あなたの任意の勢力の、分類・式神を持ち、…1/1/1のあなたの支配キャラクター、式神どうまんちゃんとしてセットする"
      const byCh = {};
      for (const id of op.cards) { const ch = from[id]; if (ch && S.chars[ch] && S.cards[id].place.z === "cost" && AA4.charStats(S, ctx.db, ch).costToToken && (!AA4.charStats(S, ctx.db, ch).costToToken.kinds || AA4.charStats(S, ctx.db, ch).costToToken.kinds.includes(op.pay && op.pay.kind))) (byCh[ch] = byCh[ch] || []).push(id); }   // kinds: "アタックコスト・ガードコスト" only (Revise#152)
      const lifted = [];
      for (const [ch, ids] of Object.entries(byCh)) {
        const tk = AA4.charStats(S, ctx.db, ch).costToToken, seat = S.chars[ch].owner;
        AA4.moveCard(ctx, ids[0], { z: "back", seat });
        const nc = AA4.charOfCard(S, ids[0]);
        if (!nc) continue;
        for (const id of ids.slice(1)) AA4.moveCard(ctx, id, { z: "char", ch: nc.id, role: "power" });
        AA4.addMod(ctx, { src: { seat, ch, card: AA4.topOf(S.chars[ch]), label: tk.name }, to: { ch: nc.id }, key: "token", op: "grant", value: { name: tk.name, stats: tk.stats, icons: tk.icons || [], faction: tk.faction || "", skills: tk.skills || [], noSet: !!tk.noSet }, until: "removed" });
        if (tk.immuneExcept) AA4.addMod(ctx, { src: { seat, ch, card: AA4.topOf(S.chars[ch]), label: tk.name }, to: { ch: nc.id }, key: "untargetable", op: "grant", value: { from: ["Effect"], exceptName: tk.immuneExcept }, until: "removed" });
        ctx.emit({ e: "tokenMade", ch: nc.id, seat, name: tk.name });
        if (!tk.faction && !tk.noFaction) AA4.enqueue(S, [{ op: "tokenFactionAsk", seat, ch: nc.id }]);
        lifted.push(...ids);
      }
      if (lifted.length) { op = Object.assign({}, op, { cards: op.cards.filter(id => !lifted.includes(id)) }); if (!op.cards.length) return; } }
    { const S = ctx.S, payer = op.pay && op.pay.seat;   // モンスターハウス (Revise#141): "≪支払ったコストの中にある、ゴーストを持つキャラクターカード≫を、そのオーナーの…アクティブキャラクターとしてセットする"
      const qs = payer == null ? [] : AA4.allMods(S, ctx.db).filter(m => m.key === "costToActive" && AA4.modAppliesToSeat(S, m, payer));
      const lift = qs.length ? op.cards.filter(id => S.cards[id] && S.cards[id].place.z === "cost" && qs.some(m => AA4.cardSelOk(ctx.db.card(S.cards[id].key) || {}, m.value || {}))) : [];
      for (const id of lift) { AA4.moveCard(ctx, id, { z: "active", seat: S.cards[id].owner }); const c = AA4.charOfCard(S, id); ctx.emit({ e: "entered", card: id, seat: S.cards[id].owner, ch: c && c.id }); }
      if (lift.length) { op = Object.assign({}, op, { cards: op.cards.filter(id => !lift.includes(id)) }); if (!op.cards.length) return; } }
    { const S = ctx.S, pi = op.pay || {}, q = pi.kind === "set" && pi.info && pi.info.costCharsOnSet;   // PP299 (Revise#359): "このカードがセットされた場合、≪このカードのコストの中にある…キャラクターカード≫を、あなたの支配キャラクターとしてセットする"
      const lift = q ? op.cards.filter(id => S.cards[id] && S.cards[id].place.z === "cost" && AA4.cardSelOk(ctx.db.card(S.cards[id].key) || {}, q)) : [];
      for (const id of lift) { AA4.moveCard(ctx, id, { z: "back", seat: pi.seat }); const c = AA4.charOfCard(S, id); ctx.emit({ e: "entered", card: id, seat: pi.seat, ch: c && c.id }); }
      if (lift.length) { op = Object.assign({}, op, { cards: op.cards.filter(id => !lift.includes(id)) }); if (!op.cards.length) return; } }
    const noTypes = !!(op.pay && op.pay.noTypes), all = AA4.costRules(ctx.S, ctx.db, op.pay).filter(r => DEST[r.to] && !(noTypes && r.paidTypes));
    for (const id of all.flatMap(r => [].concat(r.nextMod || [], r.nextMods || []))) if (ctx.S.modifiers.some(m => m.id === id)) AA4.endMod(ctx, id);   // "次に使用宣言する…のコスト≫は手札に戻る": used up (EP494, Revise#229)
    const only = all.filter(r => r.fromCh || r.paidTypes), from = (op.pay && op.pay.from) || {};   // + paidTypes alone (A3-02 0237, Revise#159)
    if (only.length) {   // "≪このキャラクターから支払われた…のコスト≫は、オーナーの手札に戻る": those cards go there, the rest by the other rules
      const ops = [];
      let rest = op.cards.slice();
      for (const r of only) {
        const mine = rest.filter(id => (!r.fromCh || from[id] === r.fromCh) && (!r.paidTypes || r.paidTypes.includes((ctx.db.card(ctx.S.cards[id].key) || {}).type)));   // "…から支払われたコストの中にあるプロジェクトカード"
        if (!mine.length) continue;
        rest = rest.filter(id => !mine.includes(id));
        ops.push({ op: "costSend", cards: mine, to: r.to, label: r.label });
      }
      if (rest.length) ops.push({ op: "costDest", seat: op.seat, cards: rest, pay: Object.assign({}, op.pay, { noFromCh: true, noTypes: true }) });
      AA4.enqueue(ctx.S, ops, true);
      return;
    }
    const rules = all;
    if (rules.length <= 1) { AA4.enqueue(ctx.S, [{ op: "costSend", cards: op.cards, to: rules[0] ? rules[0].to : "discard", label: rules[0] ? rules[0].label : "" }], true); return; }
    return AA4.ask(ctx, { seat: op.seat, kind: "pick", options: rules.map(r => r.to), labels: rules.map(r => `${r.label}: → ${r.to}`),
      reason: "Several rules say where the cost goes — choose one", then: [{ op: "costSend", cards: op.cards, label: "", labelOf: Object.fromEntries(rules.slice().reverse().map(r => [r.to, r.label])) }] });
  };
  OPS.costSend = (ctx, op) => {
    const to = op.to || (op.answer && op.answer[0]) || "discard";
    const owners = new Set();
    for (const id of op.cards) if (ctx.S.cards[id].place.z === "cost") { owners.add(ctx.S.cards[id].owner); AA4.moveCard(ctx, id, DEST[to]); }
    if (to === "deckShuffle") for (const seat of owners) AA4.OPS.shuffle(ctx, { seat });   // "…のコストは、あなたのデッキに戻し、デッキをシャッフルする"
    const label = op.label || (op.labelOf && op.labelOf[to]) || "";
    for (const it of ctx.S.stack) if ((it.paidIds || []).some(id => op.cards.includes(id))) (it.costTo = it.costTo || []).push({ to, label, cards: op.cards.filter(id => (it.paidIds || []).includes(id)) });   // where the cost went — shown on the Resolve list when it matters (Revise#162)
    ctx.emit({ e: "costSent", cards: op.cards.slice(), to, label });
  };

  /* ---------- Character Set Declaration: placed at once (Revise#067) ---------- */
  OPS.setCharacter = (ctx, op) => {
    const S = ctx.S, inf = info(ctx, op.card);
    if (inf.name && AA4.nameOnField(S, ctx.db, inf.name, undefined, inf)) {   // name rule (Revise#014): to the Damage Pile instead
      AA4.moveCard(ctx, op.card, { z: "damage" });
      ctx.emit({ e: "setFailed", card: op.card, seat: op.seat, why: `“${inf.name}” is already on the field` });
      return;
    }
    AA4.moveCard(ctx, op.card, { z: "active" });
    S.players[op.seat].turnFlags.declared = true;
    if (S.turn.phase === "main") S.players[op.seat].turnFlags.mainDeclared = true;
    ctx.emit({ e: "entered", card: op.card, seat: op.seat, ch: AA4.charOfCard(S, op.card).id });
  };

  /* ---------- resolution ---------- */
  AA4.FLOW.push(ctx => {
    const S = ctx.S;
    if (!S.stack.length || S.draft || S.triggers.length || S.decisions.length) return false;
    if (S.battle && S.battle.step === "guard") return false;
    if (!AA4.needPass(S).every(s => S.passed.includes(s))) return false;
    AA4.enqueue(S, [{ op: "resolveTop" }]);
    return true;
  });

  /** The target spec of a Resolve-list item (its card's play, or its effect line). */
  const itemSpec = (S, db, it) => it.kind === "effect" ? ((AA4.effectsOf(S, db, it.ch, it.card) || [])[it.i] || {}).target : it.kind === "set" && ["Project", "Fast"].includes(AA4.cardInfo(S, db, it.card).type) ? (AA4.cardInfo(S, db, it.card).play || {}).target : null;
  /** A3-15 2105 (Pack, Revise#248): another player makes this card's choices — its decisions while its steps run go to that player. */
  AA4.choiceByWrap = (S, it, n) => {
    if (it.choiceBy == null || it.choiceBy === it.seat) return;
    S.chooseFor = { from: it.seat, to: it.choiceBy, item: it.id };
    S.queue.splice(Math.max(0, n), 0, { op: "choiceForEnd", item: it.id });
  };
  OPS.choiceForEnd = (ctx, op) => { if (ctx.S.chooseFor && ctx.S.chooseFor.item === op.item) delete ctx.S.chooseFor; };
  OPS.resolveTop = ctx => {
    const S = ctx.S, db = ctx.db, top = S.stack[S.stack.length - 1];
    if (top && !top.retargetAsked && (top.targets || []).length === 1) {   // Q#58 (Revise#155): ロュス・アルタイル — "そのカードの対象を適正な対象に変更することが可能"
      const asker = AA4.living(S).find(seat => AA4.allMods(S, db).some(m => m.key === "retargetAny" && AA4.modAppliesToSeat(S, m, seat)));
      const spec = asker != null ? itemSpec(S, db, top) : null;
      if (spec && spec.kind !== "multi" && (spec.count || 1) === 1) {
        top.retargetAsked = true;
        const cur = JSON.stringify(top.targets[0]), opts = AA4.targetCandidates(S, db, spec, { seat: top.seat, ch: top.ch, card: top.card }).map(x => JSON.stringify(x)).filter(x => x !== cur);
        if (opts.length) {
          const lab = x => { const r = JSON.parse(x); return r.ch && S.chars[r.ch] ? AA4.cardName(db.card(S.cards[AA4.topOf(S.chars[r.ch])].key) || {}) : r.seat != null ? S.players[r.seat].name : r.card ? AA4.cardName(db.card(S.cards[r.card].key) || {}) : x; };
          return AA4.ask(ctx, { seat: asker, kind: "pick", options: ["__keep__"].concat(opts), labels: ["Keep the target (" + lab(cur) + ")"].concat(opts.map(lab)), reason: `${AA4.cardName(db.card(S.cards[top.card].key) || {})} is about to resolve: you may change its target`, then: [{ op: "retargetGo", item: top.id }] });
        }
      }
    }
    const it = S.stack.pop();
    S.passed = [];
    if (!it) return;
    if (it.kind === "set" && AA4.cardInfo(S, db, it.card).type === "Project" && (it.targets || []).length) {   // Q#58 (b): "あなた、またはあなたの支配キャラクターを対象に含むプロジェクトカードが効果を発揮する際、…あなたの任意の…はそのカードの効果を受けない" — an opponent's card: all of yours ignore it
      const shield = AA4.living(S).filter(seat => seat !== it.seat && AA4.allMods(S, db).some(m => m.key === "projShield" && AA4.modAppliesToSeat(S, m, seat)));
      if (shield.length) { const before = it.targets.length; it.targets = it.targets.filter(t => !((t.seat != null && shield.includes(t.seat)) || (t.ch && S.chars[t.ch] && shield.includes(S.chars[t.ch].owner)))); if (it.targets.length < before) ctx.emit({ e: "note", text: "Some targets ignore this Project card (ロュス・アルタイル)" }); }
    }
    ctx.emit({ e: "resolving", item: it.id, kind: it.kind, card: it.card });
    const gain = (it.kind === "effect" || (it.kind === "set" && ["Project", "Fast"].includes(AA4.cardInfo(S, ctx.db, it.card).type))) && S.players[it.seat] && AA4.seatHas(S, ctx.db, it.seat, "handGainHit") ? S.players[it.seat].zones.hand.length : null;
    const pf = it.kind === "effect" || (it.kind === "set" && ["Project", "Fast"].includes(AA4.cardInfo(S, ctx.db, it.card).type));
    if (pf && S.battle && (it.targets || []).some(t => t.ch && S.chars[t.ch] && AA4.battleOppsOf(S, t.ch).some(o => S.chars[o] && AA4.charStats(S, ctx.db, o).negateVsOpp))) {   // 3651 (Revise#152): "このキャラクターがバトルする際、≪このキャラクターのバトル相手を対象に含むプロジェクトカード・ファストカード・エフェクト≫を無効化する"
      it.failed = true; ctx.emit({ e: "effectCancelled", item: it.id, why: "negated: it targets the battle opponent of a character that negates it" });
      if (it.kind === "set" && S.cards[it.card] && ["special", "declared"].includes(S.cards[it.card].place.z)) AA4.moveCard(ctx, it.card, { z: "discard" });
      ctx.emit({ e: "resolved", item: it.id, kind: it.kind, card: it.card, seat: it.seat }); return;
    }
    if (it.kind === "set" && !it.failed && it.card && S.cards[it.card] && ["Project", "Fast"].includes((ctx.db.card(S.cards[it.card].key) || {}).type)) for (const m of AA4.allMods(S, ctx.db).filter(x => x.key === "resolveHit")) { const c0 = (ctx.db.card(S.cards[it.card].key) || {}).cost; const n = typeof c0 === "number" ? c0 : +it.x || 0; if (n > 0) AA4.enqueue(S, [{ op: "resolveHitGo", seat: it.seat, n, src: m.src }]); }   // A3-03 0629 (Revise#159)
    if (it.kind === "set") resolveSet(ctx, it);
    if (it.kind === "set" && !it.failed && it.card && S.cards[it.card]) {   // M2g (Revise#161): after a Project / Fast card resolves
      const inf0 = AA4.cardInfo(S, ctx.db, it.card), only = (it.payChs || []).length === 1 ? it.payChs[0] : null;
      if (it.endMain) AA4.OPS.effStep && (S.turn.player === it.seat && S.turn.phase === "main") && (S.turn.endMainSoon = true);   // EX0390: "そのプロジェクトカードが効果を発揮した場合、あなたのメインフェイズを終了する"
      if (only && S.chars[only] && ["Project", "Fast"].includes(inf0.type)) {
        const st = AA4.charStats(S, ctx.db, only);
        if (st.payBack && (inf0.jp || "").includes(st.payBack.jpHas)) AA4.enqueue(S, [{ op: "payBackAsk", ch: only, seat: it.seat, jpHas: st.payBack.jpHas }]);   // EXPP024
        if (st.extraTargets && inf0.type === "Project" && inf0.play && inf0.play.target && inf0.play.target.count === 1 && (it.targets || []).some(t => t.ch && S.chars[t.ch] && S.chars[t.ch].owner !== it.seat)) {   // EX0250
          const max = S.chars[only].stack.filter(id => (ctx.db.card(S.cards[id].key) || {}).name === st.extraTargets.name).length;
          if (max > 0) AA4.enqueue(S, [{ op: "extraTargetsAsk", ch: only, seat: it.seat, card: it.card, x: it.x, max }]);
        }
      }
      if (["Project", "Fast"].includes(inf0.type)) for (const t of it.targets || []) if (t.ch && S.chars[t.ch] && S.chars[t.ch].owner !== it.seat && AA4.charStats(S, ctx.db, t.ch).oppProjHit) { const n = Math.max(0, AA4.charStats(S, ctx.db, t.ch).at || 0); if (n) AA4.enqueue(S, [{ op: "resolveHitGo", seat: it.seat, n, src: { seat: S.chars[t.ch].owner } }]); }   // EX0515
    }
    if (it.kind === "set") {} else if (it.kind === "effect") { resolveEffect(ctx, it); if (!it.failed && it.card && S.cards[it.card] && (ctx.db.card(S.cards[it.card].key) || {}).bounceAfterEffect) AA4.enqueue(S, [{ op: "bounceCardGo", card: it.card }]); }   // 3721: "このカードに書かれたエフェクトが処理された場合、≪このカード≫を手札に戻す"
    if (gain != null) AA4.enqueue(S, [{ op: "handGainCheck", seat: it.seat, before: gain }]);   // テミス (Q#47)
    if (it.returnCost && !it.failed) AA4.enqueue(S, [{ op: "costBack", cards: it.returnCost, seat: it.seat }]);   // success: the cost comes back
    else if (it.kind === "trigger") AA4.OPS.runTrigger(ctx, { tr: it.tr, targets: it.targets });
    ctx.emit({ e: "resolved", item: it.id, kind: it.kind, card: it.card, seat: it.seat });
    AA4.enqueue(S, [{ op: "mentalCheck" }, { op: "permCheck" }]);   // after its steps (they were queued in front)
  };
  OPS.resolveHitGo = (ctx, op) => { if (ctx.S.players[op.seat] && !ctx.S.players[op.seat].lost) AA4.damagePlayer(ctx, op.seat, { normal: op.n, mental: 0 }, { fromSeat: op.src && op.src.seat }); };
  OPS.costBack = (ctx, op) => {
    const back = op.cards.filter(id => ctx.S.cards[id] && ctx.S.cards[id].place.z === "discard");
    for (const id of back) AA4.moveCard(ctx, id, { z: "hand" });
    if (back.length) ctx.emit({ e: "costBack", seat: op.seat, cards: back });
  };
  function fail(ctx, it, why) {
    it.failed = true;
    AA4.moveCard(ctx, it.card, { z: "discard" });
    ctx.emit({ e: "setFailed", card: it.card, seat: it.seat, why });
  }
  function resolveSet(ctx, it) {
    const S = ctx.S, db = ctx.db, inf = info(ctx, it.card);
    const pnf = inf.type === "Permanent" && it.targets[0] && it.targets[0].ch && S.chars[it.targets[0].ch] ? AA4.charStats(S, db, it.targets[0].ch).permNoFactor : null;   // 3652 / 3266 (Revise#152): "このキャラクターに、…必要ファクターを無視してパーマネントカードをセット宣言可能"
    const pnfOk = pnf && (!pnf.aggRemove || !!(inf.aggressive || (inf.skills && (inf.skills.remove || inf.skills.aggressive)))) && (!pnf.jpHas || String(inf.jp || "").includes(pnf.jpHas));   // jpHas: "カード名称に「大罪武装」を含むパーマネントカード" (EX0645, Revise#356)
    if (!(inf.type === "Break" && inf.skills && inf.skills.dual) && !it.free && !pnfOk) {   // Dual: set even if the factor is not enough (Revise#063); freeIf: no factor
      const less = (it.discountN || 0) + (it.fLess || 0) + AA4.cardSelfLess(S, db, it.seat, inf);   // the same reductions as at the declaration (Revise#316); fLess: "next card −X" (2451) and a reduction for its target (0284 / 0814)
      const f = AA4.factorOk(S, db, it.seat, less ? Object.assign({}, inf, { factorLessN: (inf.factorLessN || 0) + less }) : inf);
      if (f) return fail(ctx, it, `${f} — the factor dropped after it was declared (Factor Cut)`);
    }
    const t = it.targets[0] || {};
    if (inf.cost === "X" && it.x != null) S.cards[it.card].x = it.x;
    if (it.paidIds && it.paidIds.length && (inf.costUnderName || S.modifiers.some(m => m.key === "keepPaid" && m.src && m.src.seat === it.seat))) S.cards[it.card].paidIds = it.paidIds.slice();   // the cards paid for it (0805, Revise#352)
    if (inf.type === "Break") for (const m of S.modifiers.filter(x => x.key === "onEnterPower" && x.value && x.value.card === it.card)) { AA4.endMod(ctx, m.id); AA4.enqueue(S, [{ op: "enterPowerGo", card: it.card, n: m.value.n, seat: it.seat }]); }   // 2199 (Q#55): "目標がセットされた場合、あなたのデッキの上からX枚引き、目標をセットされたキャラクターにパワーカードとしてセットする"
    if (it.asChar) { AA4.moveCard(ctx, it.card, { z: "back", seat: it.seat }); const nc = AA4.charOfCard(S, it.card); return ctx.emit({ e: "entered", card: it.card, seat: it.seat, ch: nc && nc.id }); }   // remembered for "このカードがセットされた場合、…X枚…" (Revise#126)
    if (inf.type === "Break") {
      if (t.field) {
        if (inf.name && AA4.nameOnField(S, db, inf.name, undefined, inf)) { AA4.moveCard(ctx, it.card, { z: "damage" }); return ctx.emit({ e: "setFailed", card: it.card, seat: it.seat, why: `“${inf.name}” is already on the field` }); }
        AA4.moveCard(ctx, it.card, { z: "front" });
        return ctx.emit({ e: "entered", card: it.card, seat: it.seat, ch: AA4.charOfCard(S, it.card).id, direct: true });
      }
      const why = AA4.breakReason(S, db, it.seat, it.card, t.ch, it.force);
      if (why) return fail(ctx, it, `the target is no longer valid (${why})`);
      if (inf.name && AA4.nameOnField(S, db, inf.name, t.ch, inf)) { AA4.moveCard(ctx, it.card, { z: "damage" }); return ctx.emit({ e: "setFailed", card: it.card, seat: it.seat, why: `“${inf.name}” is already on the field` }); }
      const ch = S.chars[t.ch];
      // what the broken character was (its top card's "このキャラクターがブレイクされた場合…" abilities look back at it)
      const was = { prevTop: AA4.topOf(ch), wasControlled: AA4.isControlled(ch), hadPower: ch.power.length > 0, owner: ch.owner };
      if (ch.power.length && AA4.charStats(S, db, ch.id).breakPowerToDamage) for (const id of ch.power.slice()) AA4.moveCard(ctx, id, { z: "damage", seat: S.cards[id].owner });   // A3-04 0702 (Revise#249)
      if (ch.owner === it.seat) {
        AA4.moveCard(ctx, it.card, { z: "char", ch: ch.id, role: "stack" });
        if (ch.at.area !== "front") AA4.OPS.moveChar(ctx, { ch: ch.id, to: { area: "front" } });   // a broken character goes to Control Area (Front)
        ctx.emit(Object.assign({ e: "broke", ch: ch.id, card: it.card, seat: it.seat }, was));
        ctx.emit({ e: "entered", card: it.card, seat: it.seat, ch: ch.id });
      } else {
        AA4.removeChar(ctx, ch.id, { why: "broken" });   // the opponent's character and everything on it → Discard Pile
        AA4.moveCard(ctx, it.card, { z: "front" });
        const nc = AA4.charOfCard(S, it.card).id;
        ctx.emit(Object.assign({ e: "broke", ch: nc, card: it.card, seat: it.seat, from: t.ch }, was));
        ctx.emit({ e: "entered", card: it.card, seat: it.seat, ch: nc });
      }
      return;
    }
    if (inf.type === "Permanent") {
      const ch = S.chars[t.ch];
      if (!ch || ch.owner !== it.seat || !AA4.isControlled(ch)) return fail(ctx, it, "the character is gone");
      AA4.moveCard(ctx, it.card, { z: "char", ch: ch.id, role: "perm" });
      ctx.emit({ e: "entered", card: it.card, seat: it.seat, ch: ch.id });
      const limit = AA4.charStats(S, db, ch.id).permLimit;
      if (ch.perm.length > limit) {
        const n = ch.perm.length - limit;
        AA4.ask(ctx, { seat: it.seat, kind: "cards", options: ch.perm.slice(), min: n, max: n, reason: `Permanent limit ${limit}: ${n} must go`, then: [{ op: "permLeave", ch: ch.id }] });
      }
      return;
    }
    // Fast / Project: the card text runs now (16-effects.js); the card leaves the Special Area unless its effect lasts
    { const abs = (it.targets || []).map(t => t.ch).filter(ch => ch && S.chars[ch] && S.chars[ch].owner !== it.seat && AA4.charStats(S, db, ch).absorbOpp);   // クレア・コラプサー (Q#42, Revise#142): "≪あなたの対戦相手が使用した、このキャラクターを対象に含むプロジェクトカードまたはファストカード≫を捨て札する。その後、…X枚を引き、パワーカードとして…"
      if (abs.length) {
        const ch = abs[0], deck = S.players[S.chars[ch].owner].zones.deck, x = typeof inf.cost === "number" ? inf.cost : +it.x || 0;
        it.failed = true; AA4.moveCard(ctx, it.card, { z: "discard" });
        for (let k = 0; k < x && deck.length && S.chars[ch]; k++) AA4.moveCard(ctx, deck[deck.length - 1], { z: "char", ch, role: "power" });
        ctx.emit({ e: "absorbed", card: it.card, ch, n: x });
        if (it.held) AA4.enqueue(S, [{ op: "releaseHeld", cards: it.held }]);
        return;
      } }
    const qn0 = S.queue.length;
    if (AA4.runEffect) AA4.runEffect(ctx, inf.play || { steps: [{ a: "manual", text: inf.jp }] }, { seat: it.seat, card: it.card, targets: AA4.decoyTargets(S, db, it.targets, null), x: it.x, item: it });
    AA4.choiceByWrap(S, it, S.queue.length - qn0);
    AA4.enqueue(S, [{ op: "leaveSpecial", card: it.card }, { op: "instantFeed", card: it.card, chs: (it.targets || []).map(t => t.ch).filter(Boolean) }].concat(it.held ? [{ op: "releaseHeld", cards: it.held }] : []));
  }
  /** クレア・コラプサー: "このキャラクターを対象に含む、瞬間のプロジェクトカードまたはファストカードが効果を発揮した場合、あなたのデッキの一番上のカード1枚を引き、パワーカードとして≪このキャラクター≫にセットする" — instant = it went to the Discard Pile */
  OPS.instantFeed = (ctx, op) => {
    const S = ctx.S, c = S.cards[op.card];
    if (!c || c.place.z !== "discard") return;
    for (const ch of op.chs) if (S.chars[ch] && AA4.charStats(S, ctx.db, ch).instantFeed) { const deck = S.players[S.chars[ch].owner].zones.deck; if (deck.length) AA4.moveCard(ctx, deck[deck.length - 1], { z: "char", ch, role: "power" }); }
  };
  OPS.leaveSpecial = (ctx, op) => {
    const S = ctx.S, c = S.cards[op.card];
    if (!c || c.place.z !== "special") return;
    if (S.modifiers.some(m => m.src && m.src.card === op.card)) return;   // "until end of turn" etc.: stays until it ends
    if (c.endTo === "damage") { delete c.endTo; return AA4.moveCard(ctx, op.card, { z: "damage", seat: c.owner }); }   // A3-11 1662 (Revise#257)
    AA4.moveCard(ctx, op.card, { z: "discard" });
  };
  function resolveEffect(ctx, it) {
    const S = ctx.S, ch = S.chars[it.ch];
    // the character must still be in the Control Area (not discarded, in the Damage Pile or back in the Active Area — Pack, Revise#089)
    const why = !ch ? "the character is gone" : !AA4.isControlled(ch) ? "the character is no longer in the Control Area" : !(AA4.topOf(ch) === it.card || ch.perm.includes(it.card)) ? "that card is no longer on the character" : null;
    if (why) { it.failed = true; ctx.emit({ e: "effectCancelled", item: it.id, why }); if (it.held) OPS.releaseHeld(ctx, { cards: it.held }); return; }
    const ef = AA4.effectsOf(S, ctx.db, it.ch, it.card)[it.i];
    // its conditions again when it resolves (Pack, Revise#316): negated / can't use effects / "…場合にのみ使用宣言可能" no longer met
    const why2 = !ef ? "the effect is gone" : ef.negated ? "the effect was negated" : AA4.charStats(S, ctx.db, it.ch).noEffect ? "the character can't use effects now"
      : ef.declCond && !AA4.checkCond(S, ctx.db, ef.declCond, { seat: it.seat, ch: it.ch, card: it.card }) ? "its condition is no longer met" : null;
    if (why2) { it.failed = true; ctx.emit({ e: "effectCancelled", item: it.id, why: why2 }); if (it.held) OPS.releaseHeld(ctx, { cards: it.held }); return; }
    const qn0 = S.queue.length;
    if (AA4.runEffect) AA4.runEffect(ctx, ef, { seat: it.seat, ch: it.ch, card: it.card, targets: AA4.decoyTargets(S, ctx.db, it.targets, it.ch), x: it.x, item: it, effect: true });
    AA4.choiceByWrap(S, it, S.queue.length - qn0);
    if (it.held) AA4.enqueue(S, [{ op: "releaseHeld", cards: it.held }]);
  }
  /** A held cost the effect didn't use goes to the Discard Pile. */
  OPS.releaseHeld = (ctx, op) => { for (const id of op.cards) if (ctx.S.cards[id].place.z === "cost") AA4.moveCard(ctx, id, { z: "discard" }); };

  /** A character leaves the field: permanents, power cards, then the stack → their owners' piles.
      how = {battle?: true (named cards → Damage Pile, Revise#047), to?: "discard" | "hand" | "deck" | "removed", why} */
  AA4.removeChar = (ctx, chId, how = {}) => {
    const S = ctx.S, ch = S.chars[chId];
    if (!ch) return;
    for (const m of S.modifiers.filter(x => x.key === "leaveRecall" && x.to && x.to.ch === chId)) AA4.enqueue(S, [{ op: "recallAsk", card: m.value && m.value.card, seat: m.src && m.src.seat, n: (m.value && m.value.n) || 2 }]);   // "目標が捨て札される場合、…≪このカード≫をオーナーの手札に戻すことが可能"
    let to = how.to || "discard";
    if (to === "discard" && AA4.charStats(S, ctx.db, chId).broken && AA4.allMods(S, ctx.db).some(m => m.key === "brokenLeaveDeck")) { to = "deck"; how = Object.assign({}, how, { allTo: true, shuffle: true }); }   // A3-02 0340 (Revise#175)
    if (to === "discard" && how.battle && how.by && S.chars[how.by] && AA4.charStats(S, ctx.db, how.by).killToDamageUnbroken && !AA4.charStats(S, ctx.db, chId).broken) { to = "damage"; how = Object.assign({}, how, { allTo: true }); }   // A3-12 1775 (Revise#171)
    if (to === "discard" && AA4.charStats(S, ctx.db, chId).leaveToHand) { to = "hand"; how = Object.assign({}, how, { allTo: true, battle: false }); }   // "このキャラクターが捨て札になる場合、≪このカードと、…カード全て≫はオーナーの手札に戻る"
    let shuffleAfter = !!how.shuffle;
    if (to === "discard" && AA4.charStats(S, ctx.db, chId).leaveToDamage) { to = "damage"; how = Object.assign({}, how, { allTo: true }); }   // A3-09 1452 (Revise#252)
    if (to === "discard" && AA4.charStats(S, ctx.db, chId).leaveToDeck) { to = "deck"; shuffleAfter = true; how = Object.assign({}, how, { allTo: true, battle: false }); }   // "このキャラクターが捨て札される場合、≪…カード全て≫をオーナーのデッキに戻し、そのデッキをシャッフルする" (Revise#128)
    const owners = new Set(ch.stack.concat(ch.perm, ch.power).map(id => S.cards[id].owner));
    const st0 = AA4.charStats(S, ctx.db, chId);
    if (S.stage === "play" && AA4.allMods(S, ctx.db).some(m => m.key === "discardRecall") && (!how.to || how.to === "discard") && S.players[ch.owner].zones.damage.length) AA4.enqueue(S, [{ op: "effStep", s: { a: "pickZone", zones: ["damage"], owner: "you", sel: {}, n: 1, upTo: true, dest: "hand" }, e: { seat: ch.owner } }]);   // 3155 (Revise#152): "…が捨て札になった場合、≪そのキャラクターのオーナー≫は、自分のダメージ置き場のカード1枚を手札に戻すことが可能"
    if (how.battle && how.by && S.chars[how.by] && AA4.isControlled(ch)) { const kp = S.modifiers.find(m => m.key === "killPower" && m.to && m.to.ch === how.by); if (kp) { const d0 = S.players[S.chars[how.by].owner].zones.deck; if (d0.length) AA4.moveCard(ctx, d0[d0.length - 1], { z: "char", ch: how.by, role: "power" }); } }   // EX0536 (Revise#157)
    { const ks = how.battle && S.battle ? (S.battle.aSeat === ch.owner ? S.battle.defender : S.battle.aSeat) : how.bySeat;   // EP185 (Revise#157): "あなたの支配キャラクターがバトルまたはエフェクトの効果によって対戦相手の支配キャラクターを捨て札した場合、≪あなた≫は1ドローする"
      if (ks != null && ks !== ch.owner && AA4.isControlled(ch)) for (const m of S.modifiers.filter(x => x.key === "drawOnKill" && AA4.modAppliesToSeat(S, x, ks))) AA4.enqueue(S, [{ op: "draw", seat: ks, n: (m.value && m.value.n) || 1 }]); }
    if (how.battle && AA4.isControlled(ch) && how.by && S.chars[how.by] && S.chars[how.by].owner !== ch.owner && AA4.isControlled(S.chars[how.by])) (S.turn.lostBattle = S.turn.lostBattle && S.turn.lostBattle.turn === S.turn.number ? S.turn.lostBattle : { turn: S.turn.number, seats: [] }).seats.push(ch.owner);   // EP387 (Revise#217)
    if (to === "discard" && AA4.isControlled(ch) && st0.named) (S.turn.namedGone = S.turn.namedGone && S.turn.namedGone.turn === S.turn.number ? S.turn.namedGone : { turn: S.turn.number, seats: [] }).seats.push(ch.owner);   // EP437 (Revise#228): "あなたの支配エリアのネームレベルキャラクターが捨て札されたターンにのみ、ブレイク可能"
    ctx.emit({ e: "defeated", ch: chId, owner: ch.owner, top: AA4.topOf(ch), why: how.why || "", battle: !!how.battle, by: how.by || null, bySeat: how.bySeat != null ? how.bySeat : null, controlled: AA4.isControlled(ch), stats: { se: st0.se || 0, at: st0.at || 0, de: st0.de || 0, n: ch.stack.length, pw: ch.power.length }, icons: st0.icons || [], faction: st0.faction || "", named: !!st0.named, name: st0.name || "", cards: ch.stack.concat(ch.perm, ch.power), stack: ch.stack.slice(), broken: ch.stack.some(id => AA4.cardInfo(S, ctx.db, id).type === "Break"), breaks: ch.stack.filter(id => AA4.cardInfo(S, ctx.db, id).type === "Break") });
    if (st0.leavePermHand && ch.perm.length) for (const id of ch.perm.slice(-st0.leavePermHand)) AA4.moveCard(ctx, id, { z: "hand", seat: S.cards[id].owner });   // "≪このキャラクターにセットされているパーマネントカード1枚≫は手札に戻る" (A4-EX01 EX0705, Revise#275)
    const movers = ch.perm.filter(id => (ctx.db.card(S.cards[id].key) || {}).permMoveOnLeave && ch.owner === S.cards[id].owner);   // "…≪このカード≫をあなたの支配キャラクター1人に移動することが可能" (Revise#164)
    for (const id of ch.perm.slice()) AA4.moveCard(ctx, id, { z: how.allTo ? to : to === "hand" ? "discard" : to === "removed" ? "removed" : "discard" });
    if (movers.length) AA4.enqueue(S, movers.map(id => ({ op: "permMoveAsk", card: id, from: chId })));   // allTo: "…と、そのキャラクターにセットされているカード全て"
    const lph = S.modifiers.find(m => m.key === "leavePowerToHand" && m.to && m.to.ch === chId && (!m.value || !m.value.battleOrOpp || how.battle || (how.bySeat != null && m.src && how.bySeat !== m.src.seat)));   // A3-02 0419 (Revise#175)
    for (const id of ch.power.slice()) AA4.moveCard(ctx, id, lph ? { z: "hand", seat: S.cards[id].owner } : { z: how.allTo ? to : to === "removed" ? "removed" : "discard" });
    for (const id of ch.stack.slice().reverse()) {
      if (!S.chars[chId]) break;
      const named = !!(ctx.db.card(S.cards[id].key) || {}).name;
      const mth = how.mentalKill && to === "discard" && AA4.allMods(S, ctx.db).some(m => m.key === "mentalToHand") && ["Break", "Character"].includes((ctx.db.card(S.cards[id].key) || {}).type);   // PP117 (Revise#161, Pack Q-F4): only the Break / Character cards
      const lsh = (to === "discard" || to === "damage") && ((AA4.cardInfo(S, ctx.db, id) || {}).leaveSelfHand || (how.battle && (AA4.cardInfo(S, ctx.db, id) || {}).leaveSelfHandBattle));   // + battle only (A4-01 0114, Revise#276)   // "このカードが除去される場合、≪このカード≫をオーナーの手札に戻す" (A3-16 2256, Revise#170)
      const lnd = to === "discard" && (st0.leaveNamedDamage || []).includes(String((ctx.db.card(S.cards[id].key) || {}).name || "").replace(/\s+/g, ""));   // "このキャラクターが捨て札される場合、≪このキャラクターを構成する“N”全て≫をダメージ置き場に置く" (Revise#271)
      const dest = mth || lsh ? "hand" : lnd ? "damage" : how.split ? ((ctx.db.card(S.cards[id].key) || {}).type === "Break" ? "hand" : "damage") : to === "discard" && how.battle && named ? "damage" : to;
      AA4.moveCard(ctx, id, dest === "deck" ? { z: "deck", pos: how.pos } : { z: dest });
    }
    if (shuffleAfter) for (const seat of owners) AA4.OPS.shuffle(ctx, { seat });
    // ミナ・アグリッパ (Revise#132): "このキャラクターが支配キャラクターとのバトルまたはあなた以外のプレイヤーの使用した…効果によって捨て札になる場合、≪あなたの対戦相手全て≫の手札から、あなたの任意のX枚までを、そのオーナーのダメージ置き場に置く"
    if (to === "discard") for (const m of S.modifiers.filter(x => x.key === "leaveHit" && x.to && x.to.ch === chId)) {
      const byCtl = how.battle ? !!(how.by && S.chars[how.by] && AA4.isControlled(S.chars[how.by])) : true;
      AA4.endMod(ctx, m.id);
      if (byCtl && AA4.runEffect) AA4.runEffect(ctx, { steps: [{ a: "handTake", to: "opp", n: "X", upTo: true, dest: "damage" }] }, { seat: ch.owner, card: m.src && m.src.card, x: (m.value && m.value.x) || 0 });
    }
    // linked fates (モリーアン, Revise#130): "目標が除去された場合、このキャラクターを捨て札する" / "このキャラクターが支配キャラクターとのバトルによって捨て札される場合、目標を捨て札する"
    for (const m of S.modifiers.filter(x => x.key === "fateLink" && x.to && x.to.ch === chId)) { const o = m.value; AA4.endMod(ctx, m.id); if (o && S.chars[o]) AA4.enqueue(S, [{ op: "fateKill", ch: o, why: "its linked character left" }]); }
    if (how.battle && to === "discard") for (const m of S.modifiers.filter(x => x.key === "fateBattle" && x.to && x.to.ch === chId)) { const o = m.value; AA4.endMod(ctx, m.id); if (o && S.chars[o] && how.by && S.chars[how.by] && AA4.isControlled(S.chars[how.by])) AA4.enqueue(S, [{ op: "fateKill", ch: o, why: "discarded with its linked character" }]); }
  };
  /** "このカードがあなたのダメージ置き場にある場合、…手札にあるカードと同様に使用宣言可能" (Revise#124) or ギイェルミナ: "≪あなた≫は、あなたのダメージ置き場のブレイクカードを、手札にあるカードと同様に使用宣言可能" (Revise#141) */
  AA4.cardSelOk = (inf, q) => (!q.tag || (inf.tags || []).includes(q.tag)) && (!q.types || q.types.includes(inf.type)) && (!q.icons || (inf.icons || []).some(i => q.icons.includes(i))) && (!q.faction || inf.faction === q.faction) && (!q.jpHas || (inf.jp || "").includes(q.jpHas)) && (!q.nameHas || (inf.name || "").includes(q.nameHas)) && (!q.jp || String(inf.jp || "").replace(/\s+/g, "") === q.jp) && (!q.nameNone || !inf.name) && (!q.noRule || !inf.breakRule) && (!q.name || inf.name === q.name);
  AA4.dmgPlayable = (S, db, seat, card) => {
    const inf = db.card(S.cards[card].key) || {};
    if (AA4.pileTextOff && AA4.pileTextOff(S, db)) return false;   // Q#46: no text works in a Damage Pile
    if (inf.playFromDamage) return true;
    return AA4.allMods(S, db).some(m => m.key === "breakFromDamage" && AA4.modAppliesToSeat(S, m, seat) && !(m.value && m.value.oncePerTurn && S.players[seat].dmgPlayTurn === S.turn.number) && AA4.cardSelOk(inf, m.value && typeof m.value === "object" ? m.value : { types: ["Break"] }));   // value {types, icons, faction, jpHas}: "…ゴーストを持つブレイクカード" / "カード名称に「式神」を含む阿羅耶識のカード"
  };
  /** "≪あなた≫は、ネームに「ブレイブ」を含むE.G.O.のカードをファストカードのタイミングで使用宣言可能" (Revise#141) */
  AA4.fastCardOk = (S, db, seat, inf) => AA4.allMods(S, db).some(m => m.key === "fastCards" && AA4.modAppliesToSeat(S, m, seat) && AA4.cardSelOk(inf, m.value || {}));
  AA4.OPS.fateKill = (ctx, op) => { if (ctx.S.chars[op.ch]) AA4.defeat(ctx, op.ch, { why: op.why }); };
})(typeof globalThis !== "undefined" ? globalThis : window);
