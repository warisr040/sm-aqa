/* ==========================================================================
   v4 engine · effect primitives and always-on abilities   (requirements_v4 §12, §20.8; step B6)

   Effect (compiled at build time, Revise#045): { target: spec | null, x: {power: "self"} | null,
     steps: [ { a: action, to: ref, …params } ] }
   ref: "t" (the declared target(s), checked again now — invalid ones are skipped, Revise#032) · "self" (this
        character) · "card" (this card) · "you" · "opp" (every other player) · "players" (everyone) ·
        {all: selector} (every character it matches) · "battleOpp" (this character's battle opponent)
   n: a number or "X" (the X paid / defined).  until: "battle" | "main" | "turn".
   Actions (each is one small function; "manual" shows the text as ✋ do by hand, as before):
     damage {n, mental}      stat {key, n, op?}       skill {id, x?, remove?}     icon {value}
     discard                 bounce (to owner's hand) toDeck {pos}  remove (from the game)
     draw {n}                handDiscard {n}          mill {n, zone}              shuffle
     powerDiscard {n}        powerFromDeck {n}        powerSteal                  makeActive   dominate
     untap                   cancelBattle {which}     cancelItem                  ban {decl, type?, name?}
     noDamage {value}        untargetable             field {mod}                 search {sel}
     pickZone {zone, n}      extraTurn                skipPhase {phase}           retarget
     costTo {to}  (handled when the cost is paid)     manual {text}
   Always-on abilities {kind: "always", mod: {to: "self" | selector, key, op, value}, cond} become static
   modifiers while their card is on the field (top card of a character, or a permanent).
   ========================================================================== */
(function (G) {
  "use strict";
  const AA4 = G.AA4, OPS = AA4.OPS;
  const A = (AA4.EFFECT_ACTIONS = {});

  AA4.runEffect = (ctx, effect, e) => {
    if (!effect) return;
    const S = ctx.S, ectx = Object.assign({ targets: [] }, e, { eid: (S.effSeq = (S.effSeq || 0) + 1) });   // eid: the steps of one run share it (Revise#172: X set later reaches every step even after the state was copied)
    if (effect.target) ectx.spec = effect.target;
    if (effect.x) ectx.x = xValue(ctx, effect.x, ectx);
    if (effect.x == null && e.x != null) ectx.x = e.x;
    ctx.emit({ e: "effect", seat: ectx.seat, card: ectx.card || null, ch: ectx.ch || null, status: effect.status || "auto" });
    AA4.enqueue(S, (effect.steps || []).map(s => ({ op: "effStep", s, e: ectx })), true);
  };
  OPS.effStep = (ctx, op) => {
    const fn = A[op.s.a] || A.manual;
    if (op.s.ifLast && !ctx.S.effLast) return;
    if (op.s.ifNotLast && ctx.S.effLast) return;   // the other branch (2983, Revise#364)
    if (op.s.ifXGeT) { const t = (op.e.targets || []).find(x => x.ch && ctx.S.chars[x.ch]), v = t ? AA4.charStats(ctx.S, ctx.db, t.ch)[op.s.ifXGeT] : null;   // 0388 (Revise#228): "Xが目標のキャラクターの精神力以上でなければ、このカードは効果を発揮しない"
      if (v == null || !((op.e.x || 0) >= v)) { if (!op.e._xgNote) { op.e._xgNote = 1; ctx.emit({ e: "note", text: `No effect: X (${op.e.x || 0}) is less than the target's ${{ se: "mental", at: "attack", de: "defense" }[op.s.ifXGeT]} (${v == null ? "—" : v})` }); } return; } }
    if (op.s.if && !AA4.checkCond(ctx.S, ctx.db, op.s.if, { seat: op.e.seat, ch: op.e.ch, card: op.e.card })) return;
    if (op.s.ifTOwnNamed) { const t = (op.e.targets || []).find(x => x.ch && ctx.S.chars[x.ch]); if (!t || ctx.S.chars[t.ch].owner !== op.e.seat || !AA4.charStats(ctx.S, ctx.db, t.ch).named) return; }   // "目標があなたのパートナーだった場合" read as your Name-level character (A4-05 0922)
    if (op.s.ifXGe != null && !((+op.e.x || 0) >= op.s.ifXGe)) return;   // "Xが4以上の場合、さらに、…" (A4-EP EP404, Revise#310)   // "<condition>場合、…" (Revise#166)
    { const tOk = q => { const t = (op.e.targets || []).find(x => x.ch && ctx.S.chars[x.ch]), st = t && AA4.charStats(ctx.S, ctx.db, t.ch); return !!st && (st.name === q.ifTName || (st.alsoNames || []).includes(q.ifTName)) && (!q.ifTOwn || (ctx.S.chars[t.ch].owner === op.e.seat && AA4.isControlled(ctx.S.chars[t.ch]))) && (!q.ifTBroken || st.broken); };
      if (op.s.ifTNot && tOk(op.s.ifTNot)) return;   // "目標が“X”の場合、代わりに、…": not for that target (Revise#200)
      const paidBy = q => { const it = op.e.item; if (q.sel) { const sel = Object.assign({}, q); delete sel.sel; delete sel.one; const pc = (it && it.payChs) || []; return pc.length > 0 && (!q.one || pc.length === 1) && pc.every(id => ctx.S.chars[id] && AA4.matchChar(ctx.S, ctx.db, sel, id, { seat: op.e.seat })); }   // "…キャラクターからのみ支払われていた場合" (EX0473, Revise#208)
        const ch = it && (it.payChs || []).length === 1 && ctx.S.chars[it.payChs[0]]; if (!ch) return false; const st = AA4.charStats(ctx.S, ctx.db, ch.id); return (st.name === q.name || (st.alsoNames || []).includes(q.name)) && (!q.broken || st.broken); };
      if (op.s.ifPaidBy && !paidBy(op.s.ifPaidBy)) return;   // "このカードのコストがブレイクしている“X”からのみ支払われていた場合" (Revise#200)
      if (op.s.ifNotPaidBy && paidBy(op.s.ifNotPaidBy)) return; }
    if (op.s.ifTNotSel) { const t = (op.e.targets || []).find(x => x.ch && ctx.S.chars[x.ch]); if (t && AA4.matchChar(ctx.S, ctx.db, op.s.ifTNotSel, t.ch, { seat: op.e.seat })) return; }   // "目標が…を持つキャラクターの場合、代わりに、…": not for that target (Revise#339)
    if (op.s.ifTSel || op.s.ifTJp) { const t = (op.e.targets || []).find(x => x.ch && ctx.S.chars[x.ch]); if (!t) return;   // "目標が…シリーズのキャラクターの場合" / "目標が「card name」の場合" (Revise#208)
      if (op.s.ifTSel && !AA4.matchChar(ctx.S, ctx.db, op.s.ifTSel, t.ch, { seat: op.e.seat })) return;
      if (op.s.ifTJp && !ctx.S.chars[t.ch].stack.some(id => String((ctx.db.card(ctx.S.cards[id].key) || {}).jp || "").replace(/\s+/g, "") === op.s.ifTJp)) return; }
    if (op.s.ifTNames || op.s.ifNotTNames) {   // "対象が“A”と“B”の場合、代わりに…" (EX900, Revise#360): the targets are exactly those two
      const want = op.s.ifTNames || op.s.ifNotTNames, ns = (op.e.targets || []).filter(x => x.ch && ctx.S.chars[x.ch]).map(x => AA4.charStats(ctx.S, ctx.db, x.ch).name), all = ns.length === want.length && want.every(n => ns.includes(n));
      if (op.s.ifTNames ? !all : all) return;
    }
    if (op.s.ifTPileMin != null) { const ts = (op.e.targets || []).find(x => x.seat != null); if (!ts || !(ctx.S.players[ts.seat].zones.damage.length >= op.s.ifTPileMin)) return; }   // "目標のダメージ置き場のカード枚数が8枚以上の場合" (EX0167, Revise#363)
    if (op.s.ifTNotName) { const t = (op.e.targets || []).find(x => x.ch && ctx.S.chars[x.ch]), st = t && AA4.charStats(ctx.S, ctx.db, t.ch); if (st && (st.name === op.s.ifTNotName || (st.alsoNames || []).includes(op.s.ifTNotName))) return; }   // the other half of "…“X”に効果を発揮している場合、代わりに…" (EX0306, Revise#358)
    if (op.s.ifTName) { const t = (op.e.targets || []).find(x => x.ch && ctx.S.chars[x.ch]); const st = t && AA4.charStats(ctx.S, ctx.db, t.ch); if (!st || !(st.name === op.s.ifTName || (st.alsoNames || []).includes(op.s.ifTName)) || (op.s.ifTOwn && !(ctx.S.chars[t.ch].owner === op.e.seat && AA4.isControlled(ctx.S.chars[t.ch]))) || (op.s.ifTBroken && !st.broken)) return; }   // "目標が“X”の場合、…" (M3g, Revise#192)
    if (op.s.ifPaidOnlyT) { const it = op.e.item, t = (op.e.targets || []).find(x => x.ch); if (!it || !t || (it.payChs || []).length !== 1 || it.payChs[0] !== t.ch) return; }   // 2259 (Revise#179): "このカードのコストが目標からのみ支払われていた場合"
    if (op.s.ifProj != null && !!(op.e.item && op.e.item.projTiming) !== op.s.ifProj) return;   // 2973 (Revise#152): "このエフェクトをあなたのターンのプロジェクトカードのタイミングで使用した場合、代わりに…"
    if (AA4.stepNullified(ctx.S, ctx.db, op.s)) { ctx.emit({ e: "note", text: "Nullified: it acts on cards in a Damage / Discard Pile or a deck (2448)" }); return; }   // "…しなければ、このエフェクトは効果を発揮しない" (Revise#143): only if the earlier step did it
    let r = refs(ctx, op.e, op.s.to);
    if (r.some(x => x.seat != null && x.seat !== op.e.seat)) r = r.filter(x => x.seat == null || x.seat === op.e.seat || !AA4.allMods(ctx.S, ctx.db).some(m => m.key === "playerImmune" && m.value && m.value.byOpp && AA4.modAppliesToSeat(ctx.S, m, x.seat) && (!m.cond || AA4.checkCond(ctx.S, ctx.db, m.cond, { seat: m.src ? m.src.seat : x.seat, src: m.src }))));   // 3264 (Revise#152): "≪あなた…≫は、あなたの対戦相手のカードの効果を受けない"
    if (r.some(x => x.seat != null) && op.e.card && ctx.S.cards[op.e.card] && !op.e.effect && !op.e.ch) {   // "≪プレイヤー全て≫は、プロジェクトカード・ファストカードの効果を受けない" (Revise#128)
      const ty = (ctx.db.card(ctx.S.cards[op.e.card].key) || {}).type;
      if (ty === "Project" || ty === "Fast") r = r.filter(x => x.seat == null || !AA4.allMods(ctx.S, ctx.db).some(m => m.key === "playerImmune" && !(m.value && m.value.byOpp) && AA4.modAppliesToSeat(ctx.S, m, x.seat) && (!m.value || !m.value.types || m.value.types.includes(ty))));
    }
    if (op.s.to && typeof op.s.to === "object" && op.s.to.all && !op.e.effect && !op.e.ch && op.e.card && ctx.S.cards[op.e.card] && ["Project", "Fast"].includes((ctx.db.card(ctx.S.cards[op.e.card].key) || {}).type) && r.some(x => x.ch)) {   // 0233 (Revise#152): "≪キャラクターを対象とする、範囲のプロジェクトカード・ファストカード≫は、このキャラクターにのみ効果を発揮する"
      const rod = Object.keys(ctx.S.chars).find(id => AA4.isControlled(ctx.S.chars[id]) && AA4.charStats(ctx.S, ctx.db, id).areaRod);
      if (rod) r = r.filter(x => !x.ch).concat([{ ch: rod }]);
    }
    if (op.s.ifSel) r = r.filter(x => x.ch && ctx.S.chars[x.ch] && AA4.matchChar(ctx.S, ctx.db, op.s.ifSel, x.ch, { seat: op.e.seat, self: op.e.ch, x: op.e.x }));   // only if it (still) matches
    if (op.s.ifSel && !r.length) return;
    return fn(ctx, op.s, op.e, r);
  };
  /** X defined by the card text (Revise#045): this character's power, the target's cost / Mental, your Damage Pile … (AA4.xOf) */
  function xValue(ctx, x, e) { return AA4.xOf(ctx.S, ctx.db, x, { ch: e.ch, seat: e.seat, card: e.card, evSeat: e.evSeat, evStat: e.evStat, evCard: e.evCard }, e.targets); }
  const nOf = (s, e) => (s.n === "X" ? +e.x || 0 : +s.n || 0) + (+s.nPlus || 0);   // nPlus: "1+Xダメージ" (Revise#203)
  const srcLabel = (ctx, e) => { const c = e.card && ctx.S.cards[e.card], inf = c && ctx.db.card(c.key); return inf ? AA4.cardName(inf) : "an effect"; };

  /** What a ref means now → [{ch} | {seat} | {card} | {item}]. */
  function refs(ctx, e, to) {
    const S = ctx.S, db = ctx.db;
    if (to == null) return [];
    const tm = typeof to === "string" && /^t(\d*)$/.exec(to);
    if (tm) {
      const t = e.targets || [];
      if (!e.spec || e.spec.kind === "break" || e.spec.kind === "perm") return t.filter(x => (x.ch ? S.chars[x.ch] : true));
      let spec = e.spec, part = t;
      if (spec.kind === "multi") {   // t / t0 = the first chosen part, t1 = the second … (Revise#081)
        const k = tm[1] ? +tm[1] : 0;
        let from = 0;
        for (let i = 0; i < k; i++) from += AA4.specCount(spec.parts[i], e);
        spec = spec.parts[k]; part = t.slice(from, from + AA4.specCount(spec, e));
        if (!spec) return [];
      }
      if (spec.count === "all") return AA4.targetCandidates(S, db, spec, e);
      const ok = AA4.targetCandidates(S, db, spec, e).map(x => JSON.stringify(x));
      return part.filter(x => ok.includes(JSON.stringify(x)));   // Revise#032: checked again at resolution
    }
    if (to === "tOwner" && !(e.targets || []).length && !e.spec && e.evSeat != null && S.players[e.evSeat]) return [{ seat: e.evSeat }];   // "≪そのキャラクターのオーナー≫" of a trigger (EP365, Revise#157)
    if (to === "tOwner") return [...new Set(refs(ctx, e, "t").map(x => (x.ch && S.chars[x.ch] ? S.chars[x.ch].owner : x.card ? S.cards[x.card].owner : x.seat)).filter(s => s != null))].map(seat => ({ seat }));
    if (to === "self") return S.chars[e.ch] ? [{ ch: e.ch }] : [];
    if (to === "battleTarget") { const b = S.battle; return !b || !b.target ? [] : b.target.ch != null ? (S.chars[b.target.ch] ? [{ ch: b.target.ch }] : []) : [{ seat: b.target.seat }]; }   // "本来のアタック目標" (Revise#129)
    if (to === "battleAttacker") { const b = S.battle; return b && b.attacker && S.chars[b.attacker] ? [{ ch: b.attacker }] : []; }   // EP378 (Revise#367)
    if (to === "evBy") return e.evBy && S.chars[e.evBy] ? [{ ch: e.evBy }] : [];   // the character that defeated this one in battle (Revise#126)
    if (to === "tControlled") return refs(ctx, e, "t").filter(x => x.seat != null).flatMap(x => AA4.controlledOf(S, x.seat)).map(ch => ({ ch }));   // "≪そのプレイヤーの支配キャラクター全て≫" of a chosen player (Revise#164)
    if (to === "evHit") return e.evHit != null && S.players[e.evHit] ? [{ seat: e.evHit }] : [];   // "アタックを受けたプレイヤー" (A3-09 1418, Revise#250)
    if (to === "evOwner") { const o = e.evCh && S.chars[e.evCh] ? S.chars[e.evCh].owner : e.evSeat; return o != null && S.players[o] && !S.players[o].lost ? [{ seat: o }] : []; }   // A3-20 2871 (Revise#164)
    if (to === "evCh") return e.evCh && S.chars[e.evCh] ? [{ ch: e.evCh }] : [];   // the character that made the event (attacked / guarded)
    if (to && to.both) return to.both.flatMap(x => refs(ctx, e, x));   // "≪キャラクター全てとあなた≫"
    if (to === "card") return e.card ? [{ card: e.card }] : [];
    if (to === "you") return [{ seat: e.seat }];
    if (to === "opp") return AA4.living(S).filter(s => s !== e.seat).map(seat => ({ seat }));
    if (to === "players") return AA4.living(S).map(seat => ({ seat }));
    if (to === "turnPlayer") return [{ seat: S.turn.player }];
    if (to === "evActor") return e.evActor != null && S.players[e.evActor] && !S.players[e.evActor].lost ? [{ seat: e.evActor }] : [];   // the player who did it ("…でブレイクしたプレイヤー", EX820, Revise#343)
    if (to === "evPlayer") return e.evSeat != null && S.players[e.evSeat] && !S.players[e.evSeat].lost ? [{ seat: e.evSeat }] : [];   // "そのプレイヤー" of a phase trigger
    if (to === "battleOppPower") return refs(ctx, e, "battleOpp").flatMap(x => S.chars[x.ch].power.map(card => ({ card })));
    if (to === "yourDeck") return [{ seat: e.seat }];
    if (to === "selfPowerCards") return S.chars[e.ch] ? S.chars[e.ch].power.map(card => ({ card })) : [];
    if (to === "tBattleOpp") return [...new Set((e.targets || []).filter(x => x.ch && S.chars[x.ch]).flatMap(x => AA4.battleOppsOf(S, x.ch)))].map(ch => ({ ch }));   // "目標のバトル相手" (EX0319, Revise#210)
    if (to === "battleOppOwner") return [...new Set(refs(ctx, e, "battleOpp").map(x => S.chars[x.ch].owner))].map(seat => ({ seat }));
    if (to === "attackedPlayer") return S.battle && S.battle.defender != null ? [{ seat: S.battle.defender }] : [];
    if (to.allCards) return AA4.fieldCards(S, db, to.allCards, e).map(card => ({ card }));
    if (to.powerOf) return Object.keys(S.chars).filter(id => AA4.matchChar(S, db, to.powerOf, id, { seat: e.seat, self: e.ch, x: e.x })).flatMap(id => S.chars[id].power.map(card => ({ card })));   // "≪…キャラクターにセットされているパワーカード全て≫"
    if (to.battleOppSel) return refs(ctx, e, "battleOpp").filter(x => AA4.matchChar(S, db, to.battleOppSel, x.ch, { seat: e.seat, self: e.ch, x: e.x }));   // "…ガード宣言された、ブレイクしていないキャラクター"
    if (to === "battleOpp") {
      const b = S.battle;
      if (!b) return [];
      const mineA = [b.attacker].concat(b.joined.att).includes(e.ch);
      const other = mineA ? [b.guard || (b.target && b.target.ch)].concat(b.joined.grd) : [b.attacker].concat(b.joined.att);
      return other.filter(id => id && S.chars[id]).map(ch => ({ ch }));
    }
    if (to.all && S.effIcon && JSON.stringify(to.all).includes("@icon")) to = { all: JSON.parse(JSON.stringify(to.all).replace(/"@icon"/g, JSON.stringify(S.effIcon))) };   // "あなたの任意の分類1つを持つ…" (Revise#168)
    if (to.all) {
      const out = Object.keys(S.chars).filter(id => AA4.matchChar(S, db, to.all, id, { seat: e.seat, self: e.ch, x: e.x }) && AA4.targetable(S, db, id, Object.assign({}, e, { area: true }))).map(ch => ({ ch }));   // area: "範囲の…" (Revise#131)
      const srcType = !e.effect && e.card && S.cards[e.card] ? (db.card(S.cards[e.card].key) || {}).type : null;
      const d = out.length && (srcType === "Project" || srcType === "Fast") ? AA4.decoyOf(S, db, null) : null;   // 百式改: an area Project / Fast card hits it alone
      return d ? [{ ch: d }] : out;
    }
    return [];
  }
  AA4.effectRefs = refs;
  const chars = r => r.filter(x => x.ch).map(x => x.ch);
  const seats = r => r.filter(x => x.seat != null).map(x => x.seat);
  // a lasting result of a character's effect / ability ends when that character is no longer on the field (Pack, Revise#099)
  /** The Japanese line that is running (an effect, an ability, or the whole Project / Fast card) — for the Field effects list (Revise#182). */
  const srcTextJp = (ctx, e) => {
    const c = e.card && ctx.S.cards[e.card], inf = c && c.key ? ctx.db.card(c.key) : null;
    if (!inf) return null;
    if (e.abText) return e.abText;
    if (e.item && e.item.kind === "effect") return ((inf.effects || [])[e.item.i] || {}).text || null;
    if (e.item && e.item.kind === "set") return String(inf.text || "").split("\n").filter(l => /≪/.test(l)).length === 1 ? String(inf.text).split("\n").find(l => /≪/.test(l)) : inf.text || null;
    return null;
  };
  const mod = (ctx, e, m) => AA4.addMod(ctx, Object.assign({ src: { card: e.card, seat: e.seat, ch: e.ch, label: srcLabel(ctx, e), eid: e.eid || undefined, textJp: srcTextJp(ctx, e) || undefined }, fromChar: !!(e.ch && ctx.S.chars[e.ch]) }, m));

  A.damage = (ctx, s, e, r) => {
    const up = e.item && e.item.kind === "set" && e.card && ctx.S.cards[e.card] && (ctx.db.card(ctx.S.cards[e.card].key) || {}).type === "Project" ? AA4.allMods(ctx.S, ctx.db).filter(m => m.key === "projDmgUp" && AA4.modAppliesToSeat(ctx.S, m, e.seat)).reduce((k, m) => k + (+(m.value && m.value.n) || 1), 0) : 0;   // EP260 (Revise#157)
    const up2 = e.item && e.item.kind === "effect" && e.ch && ctx.S.chars[e.ch] ? +AA4.charStats(ctx.S, ctx.db, e.ch).effDmgUp || 0 : 0;   // EX0728 (Revise#347)
    const n = (s.n === "last" ? +ctx.S.effLast || 0 : nOf(s, e)) + up + up2, d = s.mental ? { normal: 0, mental: n } : { normal: n, mental: 0 };
    for (const ch of chars(r)) if (ctx.S.chars[ch]) AA4.damageChar(ctx, ch, Object.assign({ from: e.ch, fromSeat: e.seat }, d));
    for (const seat of seats(r)) AA4.damagePlayer(ctx, seat, d, { from: e.ch, fromSeat: e.seat });
  };
  A.stat = (ctx, s, e, r) => { for (const ch of chars(r)) mod(ctx, e, { to: { ch }, key: s.key, op: s.op || "add", value: s.n === "X" ? nOf(s, e) * (s.sign || 1) : s.n, until: s.until || "turn" }); };
  A.skill = (ctx, s, e, r) => { for (const ch of chars(r)) mod(ctx, e, { to: { ch }, key: "skill", op: s.remove ? "remove" : "grant", value: { id: s.id, x: s.x == null ? true : s.x }, until: s.until || "turn" }); };
  /** Any modifier for a time (C1: "ターン終了時まで、目標は…を得る / の効果を受けない / …できない"). */
  A.pickStat = (ctx, s, e) => { ctx.S.effStat = null; return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: ["se", "at", "de"], labels: ["Mental", "Attack", "Defense"], auto: false, reason: "Choose a stat", then: [{ op: "pickStatSet" }] }); };   // A3-19 2525 (Revise#171)
  OPS.pickStatSet = (ctx, op) => { const k = (op.answer || [])[0]; ctx.S.effStat = k || null; if (k) ctx.emit({ e: "note", text: "Stat chosen: " + { se: "Mental", at: "Attack", de: "Defense" }[k] }); };
  A.mod = (ctx, s, e, r) => {
    if (s.mod && s.mod.key === "@stat") s = Object.assign({}, s, { mod: Object.assign({}, s.mod, { key: ctx.S.effStat || "at" }) });   // "このカードの使用宣言時に指定した能力値" (Revise#171)
    let m = s.mod, v0 = m.value && typeof m.value === "object" && m.value.xvar ? (m.value.sign || 1) * (+e.x || 0) : m.value && typeof m.value === "object" && m.value.xlast ? (m.value.sign || 1) * (+ctx.S.effLast || 0) : m.value && typeof m.value === "object" && m.value.xlastAt ? (m.value.sign || 1) * (+ctx.S.effLastAt || 0) : m.value;   // xlastAt: "この効果で捨て札したキャラクターの攻撃力" (A3-22 3161, Revise#199)
    if (s.resolveStats && v0 && v0.stats) v0 = Object.assign({}, v0, { stats: Object.fromEntries(Object.entries(v0.stats).map(([k, n]) => [k, typeof n === "string" ? (+e.x || 0) * (n.endsWith("-1") ? -1 : 1) : n])) });   // "X+1" / "X-1": ±X now
    if (m.key === "dmgReduce" && v0 && (v0.mental === "X" || v0.normal === "X")) v0 = Object.assign({}, v0, v0.mental === "X" ? { mental: +e.x || 0 } : {}, v0.normal === "X" ? { normal: +e.x || 0 } : {});   // A3-14 1922 (Revise#172)
    if (v0 && typeof v0 === "object" && v0.effCostMax === "X") v0 = Object.assign({}, v0, { effCostMax: +e.x || 0 });   // A3-25 3733 (Revise#170)
    if (s.resolveSkillX && v0 && (v0.x === "X" || v0.x === "-X")) v0 = Object.assign({}, v0, { x: (v0.x === "-X" ? -1 : 1) * (+e.x || 0) });   // "キャパシティ-X" (A3-07 1105, Revise#199)   // "ブーストXを与え" (Revise#166)
    const v = s.resolveX ? JSON.parse(JSON.stringify(v0).replace(/"n":"X"/g, `"n":${+e.x || 0}`)) : v0;   // "精神力X以下のキャラクター": X fixed now
    if (s.to && typeof s.to === "object" && s.to.allCards) { mod(ctx, e, { to: { allCards: s.to.allCards, seat: e.seat }, key: m.key, op: m.op || "add", value: v, until: s.until || "turn" }); return; }   // "≪パーマネントカード全て≫にパーマネント+1を与える" (A3-11 1660, Pack Revise#231): every such card, also ones set later — it was never applied
    for (const x of r) {
      if (x.ch) mod(ctx, e, Object.assign({ to: { ch: x.ch }, key: m.key, op: m.op || "add", value: v, until: s.until || "turn" }, s.cond ? { cond: s.cond.self === "inBattle" ? { inBattleCh: x.ch } : s.cond.self === "attacking" ? { attackingCh: x.ch } : s.cond.self === "attackingPlayer" ? { attackingPlayerCh: x.ch } : s.cond.battleVs ? { battleVsCh: { ch: x.ch, sel: s.cond.battleVs === "@t" ? { onlyCh: ((e.targets || []).find(y => y.ch) || {}).ch || "__none__" } : s.cond.battleVs } } : s.cond } : {}));   // cond: "バトルの際、…して判定する"
      else if (x.seat != null) mod(ctx, e, { to: { seat: x.seat }, key: m.key, op: m.op || "add", value: v, until: s.until || "turn" });
    }
  };
  /** "メインフェイズ終了時に、…": the step waits until then (S.delayed). */
  A.delayed = (ctx, s, e) => {
    const S = ctx.S;
    S.delayed = S.delayed || [];
    const targets = refs(ctx, e, s.step.to);   // fixed now: the targets chosen at declaration
    S.delayed.push({ at: s.at, step: Object.assign({}, s.step, { to: s.step.to === "card" ? "card" : "t" }), e: Object.assign({}, e, { spec: null, targets }) });
  };
  /** Delayed steps due now → ops (so a "…可能" step can ask, and the phase / turn ends after them). */
  AA4.delayedOps = (S, at) => {
    const due = (S.delayed || []).filter(d => d.at === at);
    if (!due.length) return [];
    S.delayed = S.delayed.filter(d => d.at !== at);
    return due.map(d => ({ op: "delayedRun", d }));
  };
  AA4.runDelayed = (ctx, at) => { AA4.enqueue(ctx.S, AA4.delayedOps(ctx.S, at), true); };
  OPS.delayedRun = (ctx, op) => {
    const S = ctx.S, d = op.d;
    if (d.step.optional && !op.answer) return AA4.ask(ctx, { seat: d.e.seat, kind: "yesno", reason: `${srcLabel(ctx, d.e)}: ${d.step.a === "toDamage" ? "put it into your Damage Pile?" : "do it?"}`, then: [{ op: "delayedRun", d }] });
    if (op.answer && op.answer[0] !== "yes") return;
    if (d.step.if && !AA4.checkCond(S, ctx.db, d.step.if, { seat: d.e.seat, ch: d.e.ch })) return;   // "ターン終了時に、…場合、…" (Revise#341)
    if (d.step.ifSelfPower != null && !(S.chars[d.e.ch] && S.chars[d.e.ch].power.length === d.step.ifSelfPower)) return;
    if (d.step.ifCond && !AA4.checkCond(S, ctx.db, d.step.ifCond, { seat: d.e.seat })) return;   // "…がいる場合、パワーカードフェイズ開始時に、…": checked then (A3-18 2466, Revise#214)
    if (d.step.xLive && d.e.card && S.cards[d.e.card]) { const inf = AA4.cardInfo(S, ctx.db, d.e.card), xd = inf && inf.play && inf.play.x; if (xd) d.e = Object.assign({}, d.e, { x: AA4.xOf(S, ctx.db, xd, { seat: d.e.seat }) }); }   // X counted then   // "…終了時にこのキャラクターのパワーが0の場合、…"
    let r = refs(ctx, d.e, d.step.to);
    if (d.step.ifSel) r = r.filter(x => x.ch && S.chars[x.ch] && AA4.matchChar(S, ctx.db, d.step.ifSel, x.ch, { seat: d.e.seat }));   // "…終了時に目標のパワーが0の場合、…"
    if (r.length || !d.step.ifSel) return (A[d.step.a] || A.manual)(ctx, d.step, d.e, r);
  };
  A.toDamage = (ctx, s, e, r) => {
    for (const ch of chars(r)) AA4.removeChar(ctx, ch, { to: "damage", allTo: !!s.all, why: `put into the Damage Pile by ${srcLabel(ctx, e)}` });
    for (const x of r.filter(y => y.card && ctx.S.cards[y.card])) AA4.moveCard(ctx, x.card, { z: "damage" });
  };
  /** "目標に、このエフェクトのコストをパワーカードとしてセットする": the held cost → the target's power cards. */
  A.costAsPower = (ctx, s, e, r) => {
    const S = ctx.S, ch = chars(r)[0], held = (e.item && e.item.held) || [];
    for (const id of held) if (S.cards[id].place.z === "cost") AA4.moveCard(ctx, id, ch && S.chars[ch] ? { z: "char", ch, role: "power" } : { z: "discard" });
  };
  A.icon = (ctx, s, e, r) => { for (const ch of chars(r)) mod(ctx, e, { to: { ch }, key: "icon", op: "grant", value: s.value, until: s.until || "turn" }); };
  A.noDamage = (ctx, s, e, r) => { for (const ch of chars(r)) mod(ctx, e, { to: { ch }, key: "noDamage", op: "grant", value: s.value || {}, until: s.until || "turn" }); };
  A.untargetable = (ctx, s, e, r) => { for (const ch of chars(r)) mod(ctx, e, { to: { ch }, key: "untargetable", op: "grant", value: s.value || {}, until: s.until || "turn" }); };
  /** EX0619 (Revise#207): "≪プレイヤー全て≫は、自分の支配エリアの…キャラクターにセットされているパワーカードを1枚選び、手札に戻す" — each player in turn order */
  A.eachPowerToHand = (ctx, s, e) => { AA4.enqueue(ctx.S, AA4.livingOrder(ctx.S).map(seat => ({ op: "eachPowerToHandAsk", seat, sel: s.sel || {}, n: s.n || 1 })), true); };
  OPS.eachPowerToHandAsk = (ctx, op) => {
    const S = ctx.S, opts = AA4.controlledOf(S, op.seat).filter(ch => AA4.matchChar(S, ctx.db, Object.assign({ seat: op.seat }, op.sel), ch, { seat: op.seat })).flatMap(ch => S.chars[ch].power);
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: opts, min: Math.min(op.n, opts.length), max: Math.min(op.n, opts.length), reason: `Choose ${op.n} power card${op.n === 1 ? "" : "s"} on your character${op.sel.named ? " (name level)" : ""} — back to your hand`, then: [{ op: "toHand" }] });
  };
  /** EP343 (Revise#207): each player draws 1 per Controlled Character without ▼, then discards 1 hand card per Controlled Character with ▼ */
  A.eachDrawDiscardAgg = (ctx, s, e) => {
    const S = ctx.S, ops = [];
    for (const seat of AA4.livingOrder(S)) {
      const ctl = AA4.controlledOf(S, seat), agg = ctl.filter(ch => AA4.charStats(S, ctx.db, ch).skills.aggressive).length, d = ctl.length - agg;
      if (d) ops.push({ op: "draw", seat, n: d });
      if (agg) ops.push({ op: "askDiscardLater", seat, n: agg });
    }
    AA4.enqueue(S, ops, true);
  };
  /** A3-24 3398 (Revise#209): each player discards 1 hand card per character with Capacity -X in their territory, then draws 1 per character with Capacity +X */
  A.eachDiscardDrawCap = (ctx, s, e) => {
    const S = ctx.S, ops = [];
    for (const seat of AA4.livingOrder(S)) {
      const cs = AA4.charsOf(S, seat).map(ch => (+AA4.charStats(S, ctx.db, ch).skills.capacity || 0));
      const neg = cs.filter(c => c < 0).length, pos = cs.filter(c => c > 0).length;
      if (neg) ops.push({ op: "askDiscardLater", seat, n: neg });
      if (pos) ops.push({ op: "draw", seat, n: pos });
    }
    AA4.enqueue(S, ops, true);
  };
  OPS.askDiscardLater = (ctx, op) => { const n = Math.min(op.n, ctx.S.players[op.seat].zones.hand.length); if (n) AA4.enqueue(ctx.S, [{ op: "askDiscard", seat: op.seat, n, types: null }], true); };
  /** EX0433 (Revise#207): "≪あなた≫は、あなたのデッキの一番上のカードN枚を見る" — shown to you only, nothing moves */
  A.peekTop = (ctx, s, e) => {
    const S = ctx.S, deck = S.players[e.seat] && S.players[e.seat].zones.deck, n = Math.min(nOf(s, e) || 1, deck ? deck.length : 0);
    if (!n) return;
    const top = deck.slice(-n).reverse();
    AA4.revealTo(S, top, e.seat);
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: top, min: 0, max: 0, auto: false, reason: `The top ${n === 1 ? "card" : n + " cards"} of your deck (only you see ${n === 1 ? "it" : "them"}) — OK`, then: [] });
  };
  /** EP336 (Revise#203): "≪あなたの手札の…のパーマネントカード1枚≫と≪このカード≫を入れ替える" */
  A.permSwapHand = (ctx, s, e) => {
    const S = ctx.S, c = e.card && S.cards[e.card];
    if (!c || c.place.z !== "char" || c.place.role !== "perm") return;
    const opts = S.players[e.seat].zones.hand.filter(id => { const i = ctx.db.card(S.cards[id].key) || {}; return i.type === "Permanent" && (!s.works || AA4.worksOf(i, s.works)); });
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 1, max: 1, reason: "Choose the Permanent card from your hand to take this card's place", then: [{ op: "permSwapGo", card: e.card, ch: c.place.ch, seat: e.seat }] });
  };
  OPS.permSwapGo = (ctx, op) => {
    const S = ctx.S, pick = (op.answer || [])[0];
    if (!pick || !S.chars[op.ch] || !S.cards[op.card] || S.cards[pick].place.z !== "hand") return;
    AA4.moveCard(ctx, op.card, { z: "hand", seat: S.cards[op.card].owner });
    AA4.moveCard(ctx, pick, { z: "char", ch: op.ch, role: "perm" });
  };
  /** PP207 (Revise#203): "指定したキャラクターにセットされているパワーカード全てを目標にセットする" */
  A.powerMoveAll = (ctx, s, e) => {
    const S = ctx.S, from = chars(refs(ctx, e, s.from)), to = chars(refs(ctx, e, s.to))[0];
    if (!to || !S.chars[to]) return;
    for (const ch of from) if (ch !== to && S.chars[ch]) for (const id of S.chars[ch].power.slice()) AA4.moveCard(ctx, id, { z: "char", ch: to, role: "power" });
  };
  /** EX0331 / 2405 (Revise#201): "≪プレイヤー全て≫は、自分の手札全て / ダメージ置き場のカード全てを…デッキに戻し、シャッフルする。その後、戻した枚数に等しい枚数ドローする / ダメージ置き場に置く" */
  A.pileRecycle = (ctx, s, e) => {
    const S = ctx.S, ops = [];
    for (const seat of AA4.living(S)) {
      const ids = S.players[seat].zones[s.from === "damage" ? "damage" : "hand"].slice();
      for (const id of ids) AA4.moveCard(ctx, id, { z: "deck", seat: S.cards[id].owner });
      OPS.shuffle(ctx, { seat });
      if (s.then === "draw" && ids.length) ops.push({ op: "draw", seat, n: ids.length });
      if (s.then === "damage") { const deck = S.players[seat].zones.deck; for (let i = 0; i < ids.length && deck.length; i++) AA4.moveCard(ctx, deck[deck.length - 1], { z: "damage", seat }); }
    }
    if (ops.length) AA4.enqueue(S, ops, true);
  };
  /** EX0486 (Revise#201): where this Fast / Project card goes when its lasting effect ends */
  A.cardEndTo = (ctx, s, e) => { if (e.card && ctx.S.cards[e.card]) ctx.S.cards[e.card].endTo = s.dest; };
  A.field = (ctx, s, e) => {
    const m = Object.assign({}, s.mod, { to: s.mod.to === "you" ? { seat: e.seat } : s.mod.to === "turnPlayer" ? { seat: ctx.S.turn.player } : s.mod.to === "opp" ? { players: "opponents" } : s.mod.to });
    if (s.storeX) m.value = Object.assign({}, m.value, { x: +e.x || 0 });
    if (s.resolveN && m.value && m.value.n === "X") m.value = Object.assign({}, m.value, { n: +e.x || 0 });   // X fixed now (Revise#138)   // "X:…終了時まで、…した場合、…X枚…": the X paid now
    if (m.value && m.value.name === "chosen") { if (!ctx.S.effName) return; m.value = Object.assign({}, m.value, { name: ctx.S.effName }); }   // "指定したネーム"
    mod(ctx, e, m);
  };
  A.ban = (ctx, s, e, r) => {
    const ss = seats(r);
    const name = s.name === "this" ? (ctx.db.card(ctx.S.cards[e.card].key) || {}).jp : s.name === "remembered" ? ctx.S.effRemember : s.name;
    if (s.name === "remembered" && !name) return;
    mod(ctx, e, { to: { seats: ss.length ? ss : [e.seat] }, key: "ban", op: "ban", value: { decl: s.decl || "any", type: s.type, name }, until: s.until || "turn" });
  };
  A.discard = (ctx, s, e, r) => {
    const S = ctx.S;
    for (const x of r) {
      if (x.ch && s.topBreakTo && S.chars[x.ch] && S.chars[x.ch].stack.length > 1) { const top = AA4.topOf(S.chars[x.ch]); if ((ctx.db.card(S.cards[top].key) || {}).type === "Break") AA4.moveCard(ctx, top, { z: s.topBreakTo }); }   // "その際、…一番上のブレイクカードをあなたのダメージ置き場に置く" (0339, Revise#348)
      if (x.ch) AA4.defeat(ctx, x.ch, Object.assign({ why: `discarded by ${srcLabel(ctx, e)}`, bySeat: e.seat }, s.noKeep ? { noKeep: true } : {}));   // "この効果で目標が捨て札される場合、目標を場に残す効果全てを無効化する" (Revise#166)
      else if (x.card && S.cards[x.card]) {
        const i = S.stack.findIndex(it => it.card === x.card);   // a declared card: its declaration goes away too
        if (i >= 0) { const [it] = S.stack.splice(i, 1); ctx.emit({ e: "itemCancelled", item: it.id, by: e.card }); }
        for (const m of S.modifiers.filter(m => m.src && m.src.card === x.card)) AA4.endMod(ctx, m.id);   // its lasting effect ends
        if (S.cards[x.card].place.z !== "discard") AA4.moveCard(ctx, x.card, { z: "discard" });
      }
    }
  };
  /** "目標を構成するカード全て(と…)をそのオーナーの手札に戻す" = the character → hand (power / permanents → Discard Pile, as bounce). */
  A.bounce = (ctx, s, e, r) => {
    const S = ctx.S;
    for (const ch of chars(r)) AA4.removeChar(ctx, ch, { to: "hand", why: `returned by ${srcLabel(ctx, e)}` });
    for (const x of r.filter(y => y.card && S.cards[y.card])) {
      const i = S.stack.findIndex(it => it.card === x.card);   // a declared card: its declaration goes away too
      if (i >= 0) { const [it] = S.stack.splice(i, 1); ctx.emit({ e: "itemCancelled", item: it.id, by: e.card }); }
      for (const m of S.modifiers.filter(m => m.src && m.src.card === x.card)) AA4.endMod(ctx, m.id);
      if (s.remember) S.effRemember = (ctx.db.card(S.cards[x.card].key) || {}).jp;   // "この効果で手札に戻ったカード"
      AA4.moveCard(ctx, x.card, { z: "hand" });
    }
  };
  A.toDeck = (ctx, s, e, r) => {
    for (const ch of chars(r)) AA4.removeChar(ctx, ch, Object.assign({ to: "deck", pos: s.pos, why: `put into the deck by ${srcLabel(ctx, e)}` }, s.allTo ? { allTo: true } : {}));   // allTo: "…と、そのキャラクターにセットされているカード全て" too (EP496, Revise#311)
    for (const x of r.filter(y => y.card && ctx.S.cards[y.card])) AA4.moveCard(ctx, x.card, { z: "deck", pos: s.pos });   // a Permanent / Project card → its owner's deck
    if (s.shuffle) for (const o of new Set(r.filter(y => y.card && ctx.S.cards[y.card]).map(y => ctx.S.cards[y.card].owner))) AA4.OPS.shuffle(ctx, { seat: o });   // "…をデッキに戻し、そのデッキをシャッフルする" (Revise#341)
  };
  A.remove = (ctx, s, e, r) => { for (const ch of chars(r)) AA4.removeChar(ctx, ch, { to: "removed", why: `removed by ${srcLabel(ctx, e)}` }); };
  A.draw = (ctx, s, e, r) => { const n = s.n === "last" ? +ctx.S.effLast || 0 : nOf(s, e); if (!n) return; for (const seat of seats(r).length ? seats(r) : [e.seat]) AA4.enqueue(ctx.S, [{ op: "draw", seat, n }], true); };   // "last": the number the step before left (Revise#207)
  /** EXPR016 (Revise#207): "≪プレイヤー全て≫はXドローする。Xはそのプレイヤーの支配エリアの…キャラクターの数に等しい" */
  A.eachDrawCount = (ctx, s, e) => { const S = ctx.S; AA4.enqueue(S, AA4.livingOrder(S).map(seat => ({ op: "draw", seat, n: AA4.controlledOf(S, seat).filter(ch => AA4.matchChar(S, ctx.db, Object.assign({ seat }, s.sel || {}), ch, { seat })).length })).filter(o => o.n > 0), true); };
  /** A4-03 0570 (Revise#341): "≪プレイヤー全て≫はデッキのカード全てを上から順番に公開し、公開されたキャラクターカードを、自身の勢力エリアにセットする" (then each deck is shuffled) */
  A.deckCharsToActive = (ctx, s, e) => {
    const S = ctx.S;
    for (const seat of AA4.livingOrder(S)) {
      const ids = S.players[seat].zones.deck.slice().reverse().filter(id => (ctx.db.card(S.cards[id].key) || {}).type === "Character");
      ctx.emit({ e: "note", text: `${S.players[seat].name || "Player " + (seat + 1)} reveals the whole deck: ${ids.length} Character card(s) go to the Active Area (${srcLabel(ctx, e)})` });
      for (const id of ids) { AA4.moveCard(ctx, id, { z: "active" }); const ch = AA4.charOfCard(S, id); ctx.emit({ e: "entered", card: id, seat, ch: ch && ch.id }); }
      AA4.OPS.shuffle(ctx, { seat });
    }
  };
  /** A4-02 0313 (Revise#342): "≪キャラクター全てにセットされているパワーカード1枚ずつ≫をオーナーのデッキに戻す。その後、そのデッキをシャッフルする" */
  A.eachPowerToDeck = (ctx, s, e) => {
    const S = ctx.S, owners = new Set();
    for (const ch of Object.values(S.chars)) if (ch.power.length) { const id = ch.power[ch.power.length - 1]; owners.add(S.cards[id].owner); AA4.moveCard(ctx, id, { z: "deck" }); }
    for (const seat of owners) AA4.OPS.shuffle(ctx, { seat });
  };
  /** A4-PP PP084 (Revise#346): every card on the field whose name is there twice or more goes back to its owner's deck, with the cards set on it */
  A.dupNameToDeck = (ctx, s, e) => {
    const S = ctx.S, jpOf = id => (ctx.db.card(S.cards[id].key) || {}).jp || "", count = {}, owners = new Set();
    const tops = Object.values(S.chars).map(ch => ({ ch: ch.id, id: AA4.topOf(ch) })), perms = [].concat(...Object.values(S.chars).map(ch => ch.perm.slice()));
    for (const id of tops.map(x => x.id).concat(perms)) count[jpOf(id)] = (count[jpOf(id)] || 0) + 1;
    for (const id of perms) if (S.cards[id] && count[jpOf(id)] >= 2) { owners.add(S.cards[id].owner); AA4.moveCard(ctx, id, { z: "deck" }); }
    for (const x of tops) if (S.chars[x.ch] && count[jpOf(x.id)] >= 2) { const ch = S.chars[x.ch]; for (const id of ch.stack.concat(ch.perm, ch.power)) owners.add(S.cards[id].owner); AA4.removeChar(ctx, x.ch, { to: "deck", allTo: true, why: `put into the deck by ${srcLabel(ctx, e)}` }); }
    for (const seat of owners) AA4.OPS.shuffle(ctx, { seat });
  };
  /** A4-04 0709 (Revise#346): "≪プレイヤー全て≫は、自分の支配エリアの各勢力のブレイクしていないキャラクターを1人ずつ選んで捨て札する" */
  A.eachFactionSac = (ctx, s, e) => {
    const S = ctx.S, ops = [];
    for (const seat of AA4.livingOrder(S)) {
      const by = {};
      for (const id of AA4.controlledOf(S, seat)) if (AA4.matchChar(S, ctx.db, s.sel || {}, id, { seat })) { const f = AA4.charStats(S, ctx.db, id).faction || "—"; (by[f] = by[f] || []).push(id); }
      for (const f of Object.keys(by)) ops.push({ op: "factionSacAsk", seat, faction: f, sel: s.sel || {} });
    }
    AA4.enqueue(S, ops, true);
  };
  OPS.factionSacAsk = (ctx, op) => {
    const S = ctx.S;
    if (op.answer) { const ch = op.answer[0] && AA4.charOfCard(S, op.answer[0]); if (ch) AA4.defeat(ctx, ch.id, { why: "discarded (one of each faction)" }); return; }
    const opts = AA4.controlledOf(S, op.seat).filter(id => AA4.matchChar(S, ctx.db, op.sel, id, { seat: op.seat }) && (AA4.charStats(S, ctx.db, id).faction || "—") === op.faction);
    if (!opts.length) return;
    if (opts.length === 1) return AA4.defeat(ctx, opts[0], { why: "discarded (one of each faction)" });
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 1, max: 1, auto: false, reason: `Choose one of your ${op.faction} characters: it is discarded`, then: [{ op: "factionSacAsk", seat: op.seat, faction: op.faction, sel: op.sel }] });
  };
  /** A4-01 0054 (Revise#346): "≪あなたの対戦相手1人のテリトリーの、あなたの任意の勢力1つのブレイクしていないキャラクター全て≫を捨て札する" */
  A.oppFactionSweep = (ctx, s, e) => {
    const S = ctx.S, opps = AA4.livingOrder(S).filter(x => x !== e.seat), order = AA4.FACTIONS.map(f => f.name), opts = [];
    for (const seat of opps) { const fs = [...new Set(AA4.charsOf(S, seat).filter(id => AA4.matchChar(S, ctx.db, s.sel || {}, id, { seat: e.seat })).map(id => AA4.charStats(S, ctx.db, id).faction).filter(Boolean))].sort((x, y) => order.indexOf(x) - order.indexOf(y)); for (const f of fs) opts.push(seat + "|" + f); }
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, labels: opts.map(o => { const [p, f] = o.split("|"); return `${S.players[+p].name}: ${f}`; }), auto: false, reason: "Choose a player and a faction: its matching characters are discarded", then: [{ op: "oppFactionSweepGo", sel: s.sel || {}, seat: e.seat }] });
  };
  OPS.oppFactionSweepGo = (ctx, op) => { const S = ctx.S, [p, f] = String((op.answer || [])[0] || "").split("|"); if (f == null) return; for (const id of AA4.charsOf(S, +p).filter(id => AA4.matchChar(S, ctx.db, op.sel, id, { seat: op.seat }) && AA4.charStats(S, ctx.db, id).faction === f)) AA4.defeat(ctx, id, { why: "discarded (its faction was chosen)" }); };
  /** A4-PP PP363 (Revise#348): "≪このキャラクター≫はインターセプトまたはイニシアチブを得" — the player picks one */
  A.skillPick = (ctx, s, e, r) => {
    const ch = (chars(r)[0]) || e.ch; if (!ch || !ctx.S.chars[ch]) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: s.ids.slice(), auto: false, reason: "Choose the skill it gains", then: [{ op: "skillPickGo", ch, until: s.until || "turn", e: { seat: e.seat, card: e.card, ch: e.ch } }] });
  };
  OPS.skillPickGo = (ctx, op) => { const id = (op.answer || [])[0]; if (!id || !ctx.S.chars[op.ch]) return; mod(ctx, op.e, { to: { ch: op.ch }, key: "skill", op: "grant", value: { id, x: true }, until: op.until }); };
  /** A4-05 0911 (Revise#348): every power card of the target moves to this character */
  A.powerMoveToSelf = (ctx, s, e, r) => { const S = ctx.S; if (!e.ch || !S.chars[e.ch]) return; for (const ch of chars(r)) if (S.chars[ch] && ch !== e.ch) for (const id of S.chars[ch].power.slice()) AA4.moveCard(ctx, id, { z: "char", ch: e.ch, role: "power" }); };
  /** A4-03 0535 (Revise#348): "あなたの支配エリアのアンデッド3体を捨て札する" — you choose them; effLast = 1 only when all N were discarded */
  A.ownSac = (ctx, s, e) => {
    const S = ctx.S, opts = AA4.controlledOf(S, e.seat).filter(id => AA4.matchChar(S, ctx.db, s.sel || {}, id, { seat: e.seat })), n = +s.n || 1;
    S.effLast = 0;
    if (opts.length < n) { ctx.emit({ e: "note", text: `Not enough characters to discard (${n} needed): nothing happens` }); return; }
    if (opts.length === n) { for (const id of opts) AA4.defeat(ctx, id, { why: `discarded for ${srcLabel(ctx, e)}`, bySeat: e.seat }); S.effLast = 1; return; }
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: n, max: n, auto: false, reason: `Choose ${n} of your characters: they are discarded`, then: [{ op: "ownSacGo", seat: e.seat }] });
  };
  OPS.ownSacGo = (ctx, op) => { const S = ctx.S; for (const id of op.answer || []) { const ch = AA4.charOfCard(S, id); if (ch) AA4.defeat(ctx, ch.id, { why: "discarded (chosen)", bySeat: op.seat }); } S.effLast = (op.answer || []).length ? 1 : 0; };
  /** A4-PP PP334 (Revise#349): the top N cards of an opponent's deck are shown; the Permanent cards go to that player's Damage Pile, the rest under the deck (in the order they were) */
  A.oppTopPermToDamage = (ctx, s, e) => {
    const S = ctx.S, opps = AA4.livingOrder(S).filter(x => x !== e.seat);
    if (!opps.length) return;
    if (opps.length > 1) return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opps.map(String), labels: opps.map(x => S.players[x].name), auto: false, reason: "Choose an opponent: the top cards of that deck are shown", then: [{ op: "oppTopPermGo", n: s.n, seat: e.seat }] });
    OPS.oppTopPermGo(ctx, { n: s.n, seat: e.seat, answer: [String(opps[0])] });
  };
  OPS.oppTopPermGo = (ctx, op) => {
    const S = ctx.S, who = +((op.answer || [])[0]), p = S.players[who]; if (!p) return;
    const top = p.zones.deck.slice(-Math.min(+op.n || 0, p.zones.deck.length)).reverse();
    ctx.emit({ e: "note", text: `${p.name || "Player " + (who + 1)} shows the top ${top.length} card(s): ${top.map(id => AA4.cardName(ctx.db.card(S.cards[id].key))).join(", ")}` });
    for (const id of top) { if ((ctx.db.card(S.cards[id].key) || {}).type === "Permanent") AA4.moveCard(ctx, id, { z: "damage", seat: who }); else AA4.moveCard(ctx, id, { z: "deck", pos: "bottom" }); }
  };
  /** A3-EX05 EX0622 (Revise#350): "コストを無視して≪このカード≫を使用宣言する" — the card where it lies (the Damage Pile) */
  A.selfDeclFree = (ctx, s, e) => { const S = ctx.S, c = e.card && S.cards[e.card]; if (!c) return; AA4.enqueue(S, [{ op: "effDeclPick", seat: e.seat, ch: null, zones: [c.place.z], types: [(ctx.db.card(c.key) || {}).type], onlyIds: [e.card], freeCost: !s.paid }], true); };   // paid: "…コストを支払って…セット可能" (3799, Revise#368)
  /** A4-03 0510 (Revise#350): power cards from its owner's deck until the target has as many as its Mental */
  A.fillPowerT = (ctx, s, e, r) => { const S = ctx.S; for (const id of chars(r)) { const ch = S.chars[id]; if (!ch) continue; const dk = S.players[ch.owner].zones.deck; for (let need = Math.max(0, (AA4.charStats(S, ctx.db, id).se || 0) - ch.power.length); need > 0 && dk.length; need--) AA4.moveCard(ctx, dk[dk.length - 1], { z: "char", ch: id, role: "power" }); } };
  /** A4-05 0811 (Revise#352): "その後、このカードをパワーカードとしてそのキャラクターにセット可能" — the card itself becomes a power card of the character of the event */
  A.thisCardPowerOn = (ctx, s, e) => {
    const S = ctx.S, c = e.card && S.cards[e.card], ch = e.evCh && S.chars[e.evCh];
    if (!c || !ch || c.place.z === "char") return;
    return AA4.ask(ctx, { seat: e.seat, kind: "yesno", reason: `Set ${AA4.cardName(ctx.db.card(c.key))} on that character as a power card?`, then: [{ op: "thisCardPowerGo", card: e.card, ch: e.evCh }] });
  };
  OPS.thisCardPowerGo = (ctx, op) => { const S = ctx.S; if ((op.answer || [])[0] !== "yes" || !S.cards[op.card] || !S.chars[op.ch]) return; for (const m of S.modifiers.filter(y => y.src && y.src.card === op.card)) AA4.endMod(ctx, m.id); AA4.moveCard(ctx, op.card, { z: "char", ch: op.ch, role: "power" }); };
  /** A4-05 0805 (Revise#352): "≪あなたが支払ったコストに含まれる“X”のネームを持つカード≫を、このカードの下に、このキャラクターを構成するカードとしてセット可能" */
  A.costUnder = (ctx, s, e) => {
    const S = ctx.S, c = e.card && S.cards[e.card], ch = c && AA4.charOfCard(S, e.card);
    if (!c || !ch || !ch.stack.includes(e.card)) return;
    const opts = (c.paidIds || []).filter(id => S.cards[id] && ["discard", "damage", "hand", "deck"].includes(S.cards[id].place.z) && String((ctx.db.card(S.cards[id].key) || {}).name || "").replace(/\s+/g, "") === s.name);
    delete c.paidIds;
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 0, max: opts.length, auto: false, reason: "Cards paid for it with that Name: choose the ones that go under this card", then: [{ op: "handUnderGo", ch: ch.id, card: e.card }] });
  };
  A.endOwnMods = (ctx, s, e) => { for (const m of ctx.S.modifiers.filter(y => y.src && y.src.card === e.card && y.key === s.key)) AA4.endMod(ctx, m.id); };   // a "next … only" permission is used up (0919, Revise#352)
  /** A4-03 0574 (Revise#353): every card of the target's stack except the top one becomes one of its power cards */
  A.stackToPower = (ctx, s, e, r) => { const S = ctx.S; for (const id of chars(r)) { const ch = S.chars[id]; if (!ch) continue; for (const c of ch.stack.slice(0, -1)) AA4.moveCard(ctx, c, { z: "char", ch: id, role: "power" }); } };
  A.shuffle = (ctx, s, e, r) => { for (const seat of seats(r).length ? seats(r) : [e.seat]) AA4.OPS.shuffle(ctx, { seat }); };
  A.mill = (ctx, s, e, r) => {
    for (const seat of seats(r).length ? seats(r) : [e.seat]) {
      if (ctx.S.players[seat].lost) continue;
      const deck = ctx.S.players[seat].zones.deck;
      const n = s.n === "last" ? +ctx.S.effLast || 0 : s.nx ? xValue(ctx, s.nx, e) : nOf(s, e);   // "last": "それと同じ枚数" (3805, Revise#361)   // nx: a number of its own ("このキャラクターの攻撃力に等しい枚数")
      for (let i = 0; i < n && deck.length; i++) AA4.moveCard(ctx, deck[deck.length - 1], { z: s.zone || "discard" });
    }
  };
  A.handDiscard = (ctx, s, e, r) => {
    const ops = [];
    for (const seat of seats(r).length ? seats(r) : [e.seat]) {
      const hand = ctx.S.players[seat].zones.hand.filter(id => !s.types || s.types.includes((ctx.db.card(ctx.S.cards[id].key) || {}).type)), n = Math.min(nOf(s, e), hand.length);
      if (n) ops.push({ op: "askDiscard", seat, n, types: s.types || null });
    }
    AA4.enqueue(ctx.S, ops, true);
  };
  OPS.askDiscard = (ctx, op) => AA4.ask(ctx, { seat: op.seat, kind: "cards", options: ctx.S.players[op.seat].zones.hand.filter(id => !op.types || op.types.includes((ctx.db.card(ctx.S.cards[id].key) || {}).type)), min: op.n, max: op.n, reason: `Discard ${op.n} from your hand`, then: [{ op: "discardChosen" }] });
  /** "≪P≫の手札から、あなたの任意のカードN枚(まで)を捨て札する / ダメージ置き場に置く", "≪P≫の手札全てを…" (Revise#109):
      you choose from that player's hand. */
  A.handTake = (ctx, s, e, r) => {
    const S = ctx.S, ops = [];
    for (const seat of seats(r)) {
      const hand = S.players[seat].zones.hand.slice();
      if (!hand.length) continue;
      if (s.all) { for (const id of hand) AA4.moveCard(ctx, id, { z: s.dest || "discard" }); continue; }
      let shown = null;
      if (s.see != null) {   // "手札からあなたの任意のX枚を見て" / "手札全てを見て": those cards are shown to you
        shown = s.see === "all" ? hand.slice() : AA4.shuffleInPlace(S, hand.slice()).slice(0, s.see === "X" ? +e.x || 0 : +s.see);
        for (const id of shown) if (!S.cards[id].visibleTo.includes(e.seat)) S.cards[id].visibleTo.push(e.seat);
      }
      const n = Math.min(nOf(s, e), (shown || hand).length);
      if (n) ops.push({ op: "askHandTake", by: e.seat, seat, n, upTo: !!s.upTo, dest: s.dest || "discard", only: shown });
    }
    AA4.enqueue(S, ops, true);
  };
  OPS.askHandTake = (ctx, op) => {
    const S = ctx.S;
    return AA4.ask(ctx, { seat: op.by, kind: "cards", options: S.players[op.seat].zones.hand.filter(id => !op.only || op.only.includes(id)), min: op.upTo ? 0 : op.n, max: op.n,
      reason: `Choose ${op.upTo ? "up to " : ""}${op.n} card${op.n === 1 ? "" : "s"} from ${S.players[op.seat].name}'s hand → ${op.dest === "damage" ? "their Damage Pile" : "Discard Pile"}`, then: [{ op: "handTakeGo", seat: op.seat, dest: op.dest }] });
  };
  OPS.handTakeGo = (ctx, op) => {
    const S = ctx.S;
    for (const id of op.answer || []) if (S.cards[id] && S.cards[id].place.z === "hand" && S.cards[id].owner === op.seat) AA4.moveCard(ctx, id, { z: op.dest });
  };
  /** Power cards / permanents of a character → hand / Discard Pile / Damage Pile: all, or N you choose (Revise#109). */
  /** "…の持つスキル1つを無効化する" (Revise#210): you choose one skill it has; that skill is off until the end of the turn / battle */
  A.skillOffPick = (ctx, s, e, r) => { AA4.enqueue(ctx.S, chars(r).map(ch => ({ op: "skillOffAsk", ch, by: e.seat, until: s.until || "turn", e: { seat: e.seat, card: e.card, ch: e.ch, eid: e.eid } })), true); };
  OPS.skillOffAsk = (ctx, op) => {
    const S = ctx.S; if (!S.chars[op.ch]) return;
    const sk = AA4.charStats(S, ctx.db, op.ch).skills, ids = Object.keys(sk).filter(k => sk[k] && AA4.SKILLS[k]);
    if (!ids.length) return;
    if (ids.length === 1) return OPS.skillOffGo(ctx, Object.assign({}, op, { answer: ids }));
    const lab = k => AA4.SKILLS[k].en + (typeof sk[k] === "number" ? " " + sk[k] : "");
    return AA4.ask(ctx, { seat: op.by, kind: "pick", options: ids, labels: ids.map(lab), auto: false, reason: "Choose 1 skill of " + AA4.cardName(ctx.db.card(S.cards[AA4.topOf(S.chars[op.ch])].key)) + " — it is negated", then: [{ op: "skillOffGo", ch: op.ch, until: op.until, e: op.e }] });
  };
  OPS.skillOffGo = (ctx, op) => { const id = (op.answer || [])[0]; if (!id || !ctx.S.chars[op.ch]) return; mod(ctx, op.e, { to: { ch: op.ch }, key: "skill", op: "remove", value: { id }, until: op.until }); ctx.emit({ e: "note", text: "Skill negated: " + AA4.SKILLS[id].en }); };
  /** A3-EP EP386 (Revise#215): "目標にセットされているパワーカード全てを、目標以外のあなたの任意のあなたの支配キャラクターX体に1枚ずつセットする" — choose X other Controlled Characters; one power card each (X = the target's power; fewer when there are fewer characters) */
  A.powerSpread = (ctx, s, e, r) => {
    const S = ctx.S, t = chars(r)[0]; if (!t || !S.chars[t]) return;
    const others = AA4.controlledOf(S, e.seat).filter(id => id !== t), n = Math.min(S.chars[t].power.length, others.length);
    if (!n) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: others.map(id => AA4.topOf(S.chars[id])), min: n, max: n, reason: `Choose ${n} other Controlled Character${n === 1 ? "" : "s"} of yours: each gets 1 of the target's power cards`, then: [{ op: "powerSpreadGo", from: t }] });
  };
  OPS.powerSpreadGo = (ctx, op) => {
    const S = ctx.S, from = S.chars[op.from]; if (!from) return;
    for (const top of op.answer || []) { const ch = S.cards[top] && S.cards[top].place.ch, pc = from.power[from.power.length - 1]; if (!ch || !S.chars[ch] || !pc) continue; AA4.moveCard(ctx, pc, { z: "char", ch, role: "power" }); }
  };
  /** "…にシールドまたはペネトレイトを与える" (EX0112, Revise#216): the player of the card chooses one of the skills */
  A.grantOneSkill = (ctx, s, e, r) => {
    const chs = chars(r); if (!chs.length || !(s.ids || []).length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: s.ids.slice(), labels: s.ids.map(id => (AA4.SKILLS[id] && AA4.SKILLS[id].en) || id), auto: false, reason: "Choose the skill to give", then: [{ op: "grantOneSkillGo", chs, until: s.until || "turn", e: { seat: e.seat, card: e.card, ch: e.ch, eid: e.eid } }] });
  };
  OPS.grantOneSkillGo = (ctx, op) => { const id = (op.answer || [])[0]; if (!id) return; for (const ch of op.chs) if (ctx.S.chars[ch]) mod(ctx, op.e, { to: { ch }, key: "skill", op: "grant", value: { id }, until: op.until }); };
  A.protectFromPile = (ctx, s, e, r) => {   // EX0594 (Revise#217)
    const S = ctx.S, f = new Set();
    for (const p of S.players) if (p.seat !== e.seat && !p.lost) for (const id of p.zones.damage) { const inf = ctx.db.card(S.cards[id].key) || {}; if (inf.type === "Project" && inf.faction) f.add(inf.faction); }
    if (!f.size) return;
    for (const ch of chars(r)) mod(ctx, e, { to: { ch }, key: "skill", op: "grant", value: { id: "protect", factions: [...f] }, until: s.until || "turn" });
  };
  /** A3-19 2579 (Revise#222): "≪あなたのダメージ置き場にあるプロジェクトカードとファストカード≫の中から、必要ファクターとコストの合計がX以下になるように任意の枚数選んで、あなたの手札に加える"
      — choose any of them; they are taken in the order picked while the total (factors + cost of each) stays within X */
  const factorCost = inf => Object.values((inf && inf.factor) || {}).reduce((n, v) => n + (+v || 0), 0) + (typeof (inf && inf.cost) === "number" ? inf.cost : 0);
  A.budgetPick = (ctx, s, e) => {
    const S = ctx.S, x = +e.x || 0, opts = S.players[e.seat].zones.damage.filter(id => { const i = ctx.db.card(S.cards[id].key) || {}; return (s.types || []).includes(i.type) && factorCost(i) <= x; });
    if (!opts.length) return;
    AA4.revealTo(S, opts, e.seat);
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 0, max: opts.length, auto: false, reason: `Choose cards whose factors + cost add up to ${x} or less (each card counts its required factors and its cost; picked in order — the ones over ${x} stay)`, then: [{ op: "budgetPickGo", x, seat: e.seat }] });
  };
  OPS.budgetPickGo = (ctx, op) => {
    const S = ctx.S; let left = op.x;
    for (const id of op.answer || []) { const n = factorCost(ctx.db.card(S.cards[id].key) || {}); if (n > left || S.cards[id].place.z !== "damage") continue; left -= n; AA4.moveCard(ctx, id, { z: "hand", seat: op.seat }); }
  };
  A.cardsOf = (ctx, s, e, r) => {
    const S = ctx.S, ops = [];
    for (const ch of chars(r)) {
      const c = S.chars[ch], list = c ? c[s.part === "perm" ? "perm" : "power"].slice() : [];
      if (!list.length) continue;
      const n = s.all ? list.length : Math.min(nOf(s, e), list.length);
      if (!n) continue;
      if (n >= list.length) { for (const id of list) AA4.moveCard(ctx, id, { z: s.dest || "discard" }); continue; }
      ops.push({ op: "askCardsOf", by: e.seat, ch, part: s.part, n, dest: s.dest || "discard" });
    }
    AA4.enqueue(S, ops, true);
  };
  OPS.askCardsOf = (ctx, op) => {
    const S = ctx.S, c = S.chars[op.ch];
    if (!c) return;
    const list = c[op.part === "perm" ? "perm" : "power"].slice();
    return AA4.ask(ctx, { seat: op.by, kind: "cards", options: list, min: Math.min(op.n, list.length), max: Math.min(op.n, list.length), auto: false,
      reason: `Choose ${op.n} ${op.part === "perm" ? "Permanent" : "power"} card${op.n === 1 ? "" : "s"} → ${({ hand: "owner's hand", damage: "Damage Pile", discard: "Discard Pile" })[op.dest]}`, then: [{ op: "cardsOfGo", ch: op.ch, dest: op.dest }] });
  };
  OPS.cardsOfGo = (ctx, op) => {
    const S = ctx.S, c = S.chars[op.ch];
    if (!c) return;
    for (const id of op.answer || []) if (c.power.includes(id) || c.perm.includes(id)) AA4.moveCard(ctx, id, { z: op.dest });
  };
  A.powerDiscard = (ctx, s, e, r) => {
    let n = 0;
    if (s.zeroNone && !nOf(s, e)) { ctx.S.effLast = 0; return; }   // X = 0: none (Revise#173)
    const wN = s.nWatchPower ? (ctx.S.chars[e.wCh] ? ctx.S.chars[e.wCh].power.length : 0) : null;   // "目標のパワーに等しい枚数" in a watcher (EX0613, Revise#216)
    if (wN === 0) { ctx.S.effLast = 0; return; }
    for (const ch of chars(r)) { const c = ctx.S.chars[ch]; for (const id of c.power.slice(-Math.min(wN || nOf(s, e) || c.power.length, c.power.length))) { AA4.moveCard(ctx, id, { z: "discard" }); n++; } }
    ctx.S.effLast = n;   // "Xは、このカードの効果で捨て札したパワーカードの枚数に等しい" (n: "last")
  };
  A.powerFromDeck = (ctx, s, e, r) => {
    for (const ch of chars(r)) {
      const owner = s.ownerDeck && ctx.S.chars[ch] ? ctx.S.chars[ch].owner : e.seat, deck = ctx.S.players[owner].zones.deck;   // "目標のオーナーのデッキの上から"
      const n = s.n === "last" ? ctx.S.effLast || 0 : s.n === "evN" ? (e.evStat && +e.evStat.n) || 0 : nOf(s, e);   // evN: "受けたダメージに等しい枚数" (EX865, Revise#368)
      for (let i = 0; i < n && deck.length; i++) AA4.moveCard(ctx, deck[deck.length - 1], { z: "char", ch, role: "power" });
    }
  };
  /** "≪あなたの任意のエリア1つのキャラクター全てにセットされているパワーカード1枚ずつ≫を捨て札する": choose a player's
      Active Area or Control Area; every character there discards its newest power card(s). */
  A.areaPowerDiscard = (ctx, s, e) => {
    const S = ctx.S, opts = [], labels = [];
    // one area of one player: that player's Active Area, or their Control Area (Front and Back together) — always asked (Pack)
    for (const seat of AA4.livingOrder(S)) for (const [area, name] of [["active", "Active Area"], ["control", "Control Area (Front + Back)"]]) {
      const chs = AA4.charsOf(S, seat).filter(id => (area === "control" ? AA4.isControlled(S.chars[id]) : S.chars[id].at.area === "active"));
      const n = chs.filter(id => S.chars[id].power.length).length;
      if (chs.length) { opts.push(seat + ":" + area); labels.push(`${S.players[seat].name}${seat === e.seat ? " (you)" : ""} · ${name} — ${n} of ${chs.length} character${chs.length === 1 ? "" : "s"} with power cards`); }
    }
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, labels, auto: false, reason: "Choose 1 area of 1 player: each character there discards " + (s.n || 1) + " power card", then: [{ op: "areaPowerGo", n: s.n || 1, by: e.seat }] });
  };
  /** A3-22 3311 (Pack, Revise#220): "≪あなたの任意のエリア1つ以外のエリアの、キャラクター全て≫にNダメージを与える" — you choose one area of one player
      (an Active Area, or a Control Area = Front + Back); every character elsewhere takes N damage. s.players: also every player but you (the “ミカエル” version). */
  A.areaSpareDamage = (ctx, s, e) => {
    const S = ctx.S, opts = [], labels = [];
    for (const seat of AA4.livingOrder(S)) for (const [area, name] of [["active", "Active Area"], ["control", "Control Area (Front + Back)"]]) {
      const chs = AA4.charsOf(S, seat).filter(id => (area === "control" ? AA4.isControlled(S.chars[id]) : S.chars[id].at.area === "active"));
      opts.push(seat + ":" + area); labels.push(`${S.players[seat].name}${seat === e.seat ? " (you)" : ""} · ${name} — ${chs.length} character${chs.length === 1 ? "" : "s"}`);
    }
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, labels, auto: false, reason: `Choose the 1 area that is spared: every character in the other areas takes ${s.n} damage${s.players ? ", and every other player too" : ""}`, then: [{ op: "areaSpareGo", n: s.n, players: !!s.players, e: { seat: e.seat, card: e.card, ch: e.ch, eid: e.eid } }] });
  };
  OPS.areaSpareGo = (ctx, op) => {
    const S = ctx.S, [seat, area] = String((op.answer || [])[0] || "").split(":");
    ctx.emit({ e: "areaChosen", seat: op.e.seat, owner: +seat, area });
    const r = Object.keys(S.chars).filter(id => !(S.chars[id].owner === +seat && (area === "control" ? AA4.isControlled(S.chars[id]) : S.chars[id].at.area === "active"))).map(ch => ({ ch }));
    if (op.players) for (const p of AA4.living(S)) if (p !== op.e.seat) r.push({ seat: p });
    return A.damage(ctx, { a: "damage", n: op.n, mental: false }, op.e, r);
  };
  OPS.areaPowerGo = (ctx, op) => {
    const S = ctx.S, [seat, area] = String((op.answer || [])[0] || "").split(":");
    ctx.emit({ e: "areaChosen", seat: op.by != null ? op.by : null, owner: +seat, area });
    for (const id of AA4.charsOf(S, +seat)) {
      const c = S.chars[id];
      if (!(area === "control" ? AA4.isControlled(c) : c.at.area === "active")) continue;
      for (const pid of c.power.slice(-op.n)) AA4.moveCard(ctx, pid, { z: "discard" });
    }
  };
  /** "≪全てのプレイヤー≫は、自分のダメージ置き場と捨て札置き場から1枚ずつ、…を持つカードを、自分の手札に加える":
      every player, in turn order, chooses up to n matching cards from each of those piles. */
  A.eachPick = (ctx, s) => {
    const ops = [];
    for (const seat of AA4.livingOrder(ctx.S)) for (const z of s.zones) ops.push({ op: "eachPickOne", seat, zone: z, n: s.n || 1, sel: s.sel || {}, must: !!s.must });
    AA4.enqueue(ctx.S, ops, true);
  };
  OPS.eachPickOne = (ctx, op) => {
    const S = ctx.S, db = ctx.db, opts = S.players[op.seat].zones[op.zone].filter(id => { const inf = db.card(S.cards[id].key) || {}; return !op.sel.icons || op.sel.icons.some(i => (inf.icons || []).includes(i)); });
    if (!opts.length) return;
    AA4.revealTo(ctx.S, opts, op.seat);
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: opts, min: op.must ? Math.min(op.n, opts.length) : 0, max: Math.min(op.n, opts.length), auto: false, reason: `Take ${op.must ? "" : "up to "}${op.n} from your ${op.zone === "damage" ? "Damage Pile" : "Discard Pile"} into your hand`, then: [{ op: "toHand" }] });
  };
  A.powerSteal = (ctx, s, e, r) => {
    if (!ctx.S.chars[e.ch]) return;
    for (const ch of chars(r)) for (const id of ctx.S.chars[ch].power.slice()) AA4.moveCard(ctx, id, { z: "char", ch: e.ch, role: "power" });
  };
  A.makeActive = (ctx, s, e, r) => { for (const ch of chars(r)) if (AA4.isControlled(ctx.S.chars[ch])) OPS.moveChar(ctx, { ch, to: { area: "active" } }); };
  A.dominate = (ctx, s, e, r) => { for (const ch of chars(r)) if (!AA4.isControlled(ctx.S.chars[ch])) { OPS.moveChar(ctx, { ch, to: { area: "back" } }); ctx.emit({ e: "dominated", ch, owner: ctx.S.chars[ch].owner }); } };
  /** "≪このキャラクター≫はガード宣言する" / "目標の≪…≫はガード宣言する" (Revise#109): it becomes the guard of the attack now
      (no guard cost) — only a Controlled Character of the attacked player, and only while the attack has no guard. */
  A.forceGuard = (ctx, s, e, r) => {
    const S = ctx.S, b = S.battle;
    for (const ch of chars(s.self ? [{ ch: e.ch }] : r)) {
      if (!b || b.guard || b.kind !== "attack" || b.target.ch != null || b.step === "end" || b.step === "after" || b.step === "before") return;
      const c = S.chars[ch];
      if (!c || ch === b.attacker || c.owner !== b.defender || !AA4.isControlled(c)) continue;
      b.guard = ch; b.step = "response"; S.passed = []; c.flags.tapped = true;
      ctx.emit({ e: "guarded", ch, seat: c.owner, attacker: b.attacker, forced: true });
      return;
    }
  };
  /** "あなたは≪P≫の手札全てを見ることができる" (Revise#109): the hand is shown to you (a choice with nothing to pick). */
  A.lookHand = (ctx, s, e, r) => {
    const S = ctx.S, ops = [];
    for (const x of r.filter(y => y.seat != null && y.seat !== e.seat)) ops.push({ op: "askLookHand", by: e.seat, seat: x.seat });
    if (s.pick) ops.splice(0, ops.length, { op: "askLookPick", by: e.seat });
    AA4.enqueue(S, ops, true);
  };
  OPS.askLookPick = (ctx, op) => {
    const S = ctx.S, opts = AA4.living(S).filter(s => s !== op.by).map(String);
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: op.by, kind: "pick", options: opts, labels: opts.map(s => S.players[+s].name), reason: "Choose a player: you see their hand", then: [{ op: "askLookHand", by: op.by }] });
  };
  OPS.askLookHand = (ctx, op) => {
    const S = ctx.S, seat = op.seat != null ? op.seat : +((op.answer || [])[0]);
    if (!S.players[seat]) return;
    const hand = S.players[seat].zones.hand.slice();
    for (const id of hand) if (!S.cards[id].visibleTo.includes(op.by)) S.cards[id].visibleTo.push(op.by);   // shown to the looking player
    ctx.emit({ e: "handSeen", seat, by: op.by, cards: hand });
    if (hand.length) return AA4.ask(ctx, { seat: op.by, kind: "cards", options: hand, min: 0, max: 0, auto: false, reason: `${S.players[seat].name}'s hand (look only)`, then: [] });
  };
  /** "このキャラクターに、≪あなたの手札の“X”を持つブレイクカード1枚≫をセットする" (Revise#109): broken by it, for free. */
  A.handBreakToSelf = (ctx, s, e) => {
    const S = ctx.S, ch = e.ch && S.chars[e.ch] ? e.ch : null;
    const opts = S.players[e.seat].zones.hand.filter(id => { const inf = ctx.db.card(S.cards[id].key) || {}; return inf.type === "Break" && (!s.name || inf.name === s.name); });
    if (!ch || !opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 1, max: 1, auto: false, reason: `${srcLabel(ctx, e)}: set a Break card from your hand on this character`, then: [{ op: "breakFromHandGo", ch, seat: e.seat }] });
  };
  OPS.breakFromHandGo = (ctx, op) => {
    const S = ctx.S, ch = S.chars[op.ch], id = (op.answer || [])[0];
    if (!ch || !id || !S.cards[id] || (!op.anyZone && S.cards[id].place.z !== "hand")) return;
    const inf = ctx.db.card(S.cards[id].key) || {};
    if (inf.name && AA4.nameOnField(S, ctx.db, inf.name, op.ch, inf)) { AA4.moveCard(ctx, id, { z: "damage" }); return ctx.emit({ e: "setFailed", card: id, seat: op.seat, why: `“${inf.name}” is already on the field` }); }
    const was = { prevTop: AA4.topOf(ch), wasControlled: AA4.isControlled(ch), hadPower: ch.power.length > 0, owner: ch.owner };
    AA4.moveCard(ctx, id, { z: "char", ch: op.ch, role: "stack" });
    if (ch.at.area !== "front") OPS.moveChar(ctx, { ch: op.ch, to: { area: "front" } });
    ctx.emit(Object.assign({ e: "broke", ch: op.ch, card: id, seat: op.seat }, was));
    ctx.emit({ e: "entered", card: id, seat: op.seat, ch: op.ch });
  };
  /** タミ (Revise#131): "あなたは、≪あなたの手札のコストX以下のブレイクカード1枚≫を、あなたの支配キャラクターにファクター・コストを無視してセットする。
      その後、あなたの対戦相手は、…同様にセットすることができる。どちらの場合も、分類・ネーム・ブレイク条件は満たしていなければならない" */
  A.freeBreakSet = (ctx, s, e) => {
    const S = ctx.S, x = s.anyCost ? null : +e.x || 0, ops = [{ op: "freeBreakAsk", seat: e.seat, x, optional: !!s.optional, icons: s.icons || null }];   // icons / anyCost (Revise#141): "…のいずれかを持つブレイクカード1枚を、必要ファクターとコストを無視してセット宣言可能"
    if (s.opponents) for (const o of AA4.living(S)) if (o !== e.seat) ops.push({ op: "freeBreakAsk", seat: o, x, optional: true });
    AA4.enqueue(S, ops, true);
  };
  const freeBreakTargets = (S, db, seat, id) => AA4.controlledOf(S, seat).filter(ch => !AA4.breakReason(S, db, seat, id, ch, false));   // class / name / Break condition still apply
  OPS.freeBreakAsk = (ctx, op) => {
    const S = ctx.S, db = ctx.db;
    const opts = S.players[op.seat].zones.hand.filter(id => { const inf = db.card(S.cards[id].key) || {}; const c = inf.cost === "X" ? 0 : +inf.cost; return inf.type === "Break" && !isNaN(c) && c <= (op.x == null ? Infinity : op.x) && (!op.icons || (inf.icons || []).some(i => op.icons.includes(i))) && freeBreakTargets(S, db, op.seat, id).length; });
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: opts, min: op.optional ? 0 : 1, max: 1, auto: false, reason: `Set a Break card${op.x == null || op.x === Infinity ? "" : ` with cost ≤ ${op.x}`}${op.icons ? ` (${op.icons.join(" / ")})` : ""} from your hand, ignoring factor and cost${op.optional ? " (you may)" : ""}`, then: [{ op: "freeBreakChar", seat: op.seat }] });
  };
  OPS.freeBreakChar = (ctx, op) => {
    const S = ctx.S, id = (op.answer || [])[0];
    if (!id || !S.cards[id]) return;
    const tg = freeBreakTargets(S, ctx.db, op.seat, id);
    if (!tg.length) return;
    if (tg.length === 1) return OPS.breakFromHandGo(ctx, { ch: tg[0], seat: op.seat, answer: [id] });
    return AA4.ask(ctx, { seat: op.seat, kind: "pick", options: tg, labels: tg.map(ch => AA4.cardName(ctx.db.card(S.cards[AA4.topOf(S.chars[ch])].key))), reason: "Choose the character it breaks", then: [{ op: "freeBreakGo", seat: op.seat, card: id }] });
  };
  OPS.freeBreakGo = (ctx, op) => { const ch = (op.answer || [])[0]; if (ch) return OPS.breakFromHandGo(ctx, { ch, seat: op.seat, answer: [op.card] }); };
  /** "…のキャラクターが捨て札になった場合、≪そのキャラクターを構成しているブレイクカード全て≫はオーナーの手札に戻る" with icons */
  /** "X:メインフェイズ終了時まで、スキルを持つ支配キャラクターがアタック宣言 / ガード宣言した場合、≪そのキャラクターのオーナー≫の…"
      (Revise#109): a player modifier {on, sel, effect, x}; runs when such a declaration is made. */
  AA4.runWatch = (ctx, on, chId) => {
    const S = ctx.S, ch = S.chars[chId];
    if (!ch) return;
    for (const m of S.modifiers.filter(x => x.key === "watch" && x.value && x.value.on === on))
      if ((!m.value.onlyCh || chId === m.value.onlyCh) && (!m.value.toPlayer || (S.battle && S.battle.target && S.battle.target.seat != null)) && (!m.value.vsSelf || (S.battle && m.src && S.battle.attacker === m.src.ch && S.chars[m.src.ch])) && (!m.value.selfAttacks || (m.src && chId === m.src.ch)) && (!m.value.selfGuards || (S.battle && m.src && S.battle.guard === m.src.ch && chId === m.src.ch && (!m.value.ctlOpp || (S.chars[S.battle.attacker] && AA4.isControlled(S.chars[S.battle.attacker]))))) && AA4.matchChar(S, ctx.db, m.value.sel || {}, chId, { seat: m.src ? m.src.seat : -1 })) AA4.runEffect(ctx, Object.assign({}, m.value.effect, { x: null }), { seat: m.src.seat, card: m.src.card, ch: null, evSeat: ch.owner, evCh: chId, x: m.value.x, name: m.value.name || null });
  };
  /** "…あなたのデッキの上からカードをN枚捨て札することで、≪このカード≫をオーナーの手札に戻すことが可能" */
  A.recall = (ctx, s, e) => { if (e.card) AA4.enqueue(ctx.S, [{ op: "recallAsk", card: e.card, seat: e.seat, n: s.n || 2 }], true); };
  A.leaveRecall = (ctx, s, e, r) => { for (const ch of chars(r)) mod(ctx, e, { to: { ch }, key: "leaveRecall", op: "grant", value: { card: e.card, n: s.n || 2 }, until: s.until || "turn" }); };
  OPS.recallAsk = (ctx, op) => {
    const S = ctx.S, c = S.cards[op.card];
    if (!c || !["special", "discard"].includes(c.place.z) || op.seat == null || S.players[op.seat].lost || S.players[op.seat].zones.deck.length < op.n) return;
    if (!op.answer) return AA4.ask(ctx, { seat: op.seat, kind: "yesno", reason: `${AA4.cardName(ctx.db.card(c.key))}: discard the top ${op.n} cards of your deck to return it to your hand?`, then: [Object.assign({}, op)] });
    if (op.answer[0] !== "yes") return;
    const deck = S.players[op.seat].zones.deck;
    for (let i = 0; i < op.n && deck.length; i++) AA4.moveCard(ctx, deck[deck.length - 1], { z: "discard" });
    for (const m of S.modifiers.filter(x => x.src && x.src.card === op.card && x.key !== "leaveRecall")) AA4.endMod(ctx, m.id);
    if (["special", "discard"].includes(S.cards[op.card].place.z)) AA4.moveCard(ctx, op.card, { z: "hand" });
  };
  /** "あなたは、目標の≪対戦相手1人のデッキ≫の内容を全て確認する。その後、そのデッキの中から、あなたの任意のカード1枚をそのデッキの任意の場所に移動させる" (MI6): no shuffle */
  A.deckPeekMove = (ctx, s, e, r) => {
    const S = ctx.S, seat = seats(r)[0];
    if (seat == null) return;
    const deck = S.players[seat].zones.deck;
    if (!deck.length) return;
    for (const id of deck) if (!S.cards[id].visibleTo.includes(e.seat)) S.cards[id].visibleTo.push(e.seat);
    ctx.emit({ e: "deckSeen", seat, by: e.seat, n: deck.length });
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: deck.slice().reverse(), min: 1, max: 1, auto: false, reason: `${S.players[seat].name}'s deck (top first): choose 1 card to move`, then: [{ op: "deckPeekPos", seat, by: e.seat }] });
  };
  OPS.deckPeekPos = (ctx, op) => {
    const S = ctx.S, id = (op.answer || [])[0], deck = S.players[op.seat].zones.deck;
    if (!id || !deck.includes(id)) return;
    const n = deck.length, opts = Array.from({ length: n }, (_, i) => String(i + 1));
    return AA4.ask(ctx, { seat: op.by, kind: "pick", options: opts, labels: opts.map(k => (k === "1" ? "1 (top)" : k === String(n) ? `${k} (bottom)` : k)), auto: false, reason: `Where in the deck? (1 = top, ${n} = bottom)`, then: [{ op: "deckPeekGo", seat: op.seat, card: id }] });
  };
  OPS.deckPeekGo = (ctx, op) => {
    const S = ctx.S, deck = S.players[op.seat].zones.deck, pos = +((op.answer || [])[0]) || 1, i = deck.indexOf(op.card);
    if (i < 0) return;
    deck.splice(i, 1); deck.splice(Math.max(0, deck.length - (pos - 1)), 0, op.card);   // the deck's last entry is its top
    for (const id of deck) S.cards[id].visibleTo = [];   // the order is hidden again
    AA4.touch(S);
    ctx.emit({ e: "deckOrdered", seat: op.seat, n: deck.length });
  };
  /** "あなたの任意の≪あなたの支配キャラクターX体≫を、あなたの勢力エリアに移動させる。その後、…勢力エリアのキャラクターX体≫を、あなたの支配エリアに移動させる" (軌道エレベーター) */
  A.pickMove = (ctx, s, e) => {
    const S = ctx.S, opts = AA4.charsOf(S, e.seat).filter(id => (s.from === "control" ? AA4.isControlled(S.chars[id]) : S.chars[id].at.area === "active"));
    const any = s.n === "any", k = Math.min(any ? opts.length : s.n === "last" ? +S.effLast || 0 : nOf(s, e), opts.length);
    if (any) S.effLast = 0;
    if (!k) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: any ? 0 : k, max: k, auto: false, reason: `Choose ${any ? "any number" : k}: ${s.from === "control" ? "Control Area → Active Area" : "Active Area → Control Area"}`, then: [{ op: "pickMoveGo", to: s.from === "control" ? "active" : "back", store: any }] });
  };
  OPS.pickMoveGo = (ctx, op) => {
    if (op.store) ctx.S.effLast = (op.answer || []).length;   // X: the same number for the second move
    for (const id of op.answer || []) {
      const ch = AA4.charOfCard(ctx.S, id);
      if (!ch) continue;
      OPS.moveChar(ctx, { ch: ch.id, to: { area: op.to } });
      if (op.to === "back") ctx.emit({ e: "dominated", ch: ch.id, owner: ch.owner });
    }
  };
  /** ドラグーン“ェデャエァス”: after the battle, the X it gave up → X damage to its target */
  A.pendingHit = (ctx, s, e, r) => {
    const S = ctx.S, m = S.modifiers.find(x => x.key === "pendingHit" && x.to && x.to.ch === e.ch);
    if (!m) return;
    const n = +m.value || 0;
    AA4.endMod(ctx, m.id);
    if (n > 0) A.damage(ctx, { n }, e, r);
  };
  A.eachStripNamed = (ctx, s, e) => {
    const S = ctx.S, n = nOf(s, e), ops = [];
    if (!n) return;
    for (const seat of AA4.livingOrder(S)) {
      const opts = AA4.controlledOf(S, seat).filter(id => AA4.charStats(S, ctx.db, id).named && (S.chars[id].power.length || S.chars[id].perm.length));
      if (opts.length) ops.push({ op: "askStrip", seat, n: Math.min(n, opts.length), opts });
    }
    AA4.enqueue(S, ops, true);
  };
  OPS.askStrip = (ctx, op) => {
    const S = ctx.S, opts = op.opts.filter(id => S.chars[id]);
    if (!opts.length) return;
    const k = Math.min(op.n, opts.length);
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: k, max: k, reason: `Choose ${k} of your named Controlled Characters: the cards set on them (power cards, permanents) go back to the hand`, then: [{ op: "stripGo" }] });
  };
  OPS.stripGo = (ctx, op) => { for (const id of op.answer || []) { const ch = AA4.charOfCard(ctx.S, id); if (ch) for (const c of ch.power.concat(ch.perm)) AA4.moveCard(ctx, c, { z: "hand" }); } };
  OPS.askTax = (ctx, op) => {
    const S = ctx.S, opts = op.opts.filter(id => S.chars[id]);
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 1, max: 1, reason: "Discard 1 of your Controlled Characters (the cost of this declaration)", then: [{ op: "taxGo" }] });
  };
  OPS.taxGo = (ctx, op) => { for (const id of op.answer || []) { const ch = AA4.charOfCard(ctx.S, id); if (ch) AA4.defeat(ctx, ch.id, { why: "discarded as a cost" }); } };
  /** "あなたの任意のあなたのテリトリーのキャラクターX体を捨て札する。その後、目標にXダメージを与える": X = as many as you choose */
  /** "あなたの任意のあなたの支配キャラクター1人を捨て札する。…Xは捨て札したキャラクターの通常攻撃力の数値に等しい" (A3-09 1451, Revise#166) */
  A.sacrificeOwn = (ctx, s, e) => {
    const S = ctx.S, opts = AA4.controlledOf(S, e.seat).filter(id => id !== e.ch);
    S.effLast = 0;
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 1, max: 1, reason: "Discard 1 of your Controlled Characters", then: [{ op: "sacrificeOwnGo", x: s.x || null }] });
  };
  OPS.sacrificeOwnGo = (ctx, op) => {
    const S = ctx.S, ch = AA4.charOfCard(S, (op.answer || [])[0]);
    if (!ch) return;
    const st = AA4.charStats(S, ctx.db, ch.id);
    S.effLast = op.x === "normalAt" ? (st.atMental ? 0 : Math.max(0, st.at || 0)) : 1;
    AA4.defeat(ctx, ch.id, { why: "discarded (its own effect)" });
  };
  A.handToDamageAnyX = (ctx, s, e) => {   // "≪あなたの任意のあなたの手札X枚≫をあなたのダメージ置き場に置く" (A3-09 1387, Revise#166): X = how many
    const S = ctx.S, hand = S.players[e.seat].zones.hand.filter(id => id !== e.card);
    S.effLast = 0;
    if (!hand.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: hand, min: 0, max: hand.length, auto: false, reason: "Put any number of cards from your hand into your Damage Pile (X = how many)", then: [{ op: "handToDamageGo" }] });
  };
  OPS.handToDamageGo = (ctx, op) => { const ids = (op.answer || []).filter(id => ctx.S.cards[id] && ctx.S.cards[id].place.z === "hand"); ctx.S.effLast = ids.length; for (const id of ids) AA4.moveCard(ctx, id, { z: "damage" }); };
  A.discardAnyX = (ctx, s, e) => {
    const S = ctx.S, opts = AA4.charsOf(S, e.seat).filter(id => id !== e.ch && (!s.controlled || AA4.isControlled(S.chars[id])) && (!s.sel || AA4.matchChar(S, ctx.db, s.sel, id, { seat: e.seat })));
    S.effLast = 0;
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 0, max: opts.length, auto: false, reason: "Discard any number of your characters (X = how many)", then: [{ op: "discardAnyGo" }] });
  };
  OPS.discardAnyGo = (ctx, op) => { ctx.S.effLast = (op.answer || []).length; for (const id of op.answer || []) { const ch = AA4.charOfCard(ctx.S, id); if (ch) AA4.defeat(ctx, ch.id, { why: "discarded (X)" }); } };
  /** "このエフェクトの使用宣言時に、あなたの任意のあなたの手札X枚を捨て札する": X = how many you discard (Revise#126) */
  A.discardHandAnyX = (ctx, s, e) => {
    const S = ctx.S, hand = S.players[e.seat].zones.hand.slice();
    S.effLast = 0;
    if (!hand.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: hand, min: 0, max: s.max ? Math.min(s.max, hand.length) : hand.length, auto: false, reason: s.max ? `You may discard ${s.max} card${s.max > 1 ? "s" : ""} from your hand` : "Discard any number of cards from your hand (X = how many)", then: [{ op: "discardHandAnyGo" }] });   // max: "あなたの手札1枚を捨て札することが可能" (EX0130, Revise#363)
  };
  OPS.discardHandAnyGo = (ctx, op) => { ctx.S.effLast = (op.answer || []).length; for (const id of op.answer || []) AA4.moveCard(ctx, id, { z: "discard" }); ctx.emit({ e: "xSet", seat: op.seat, x: ctx.S.effLast }); };
  /** "≪あなたの任意のエリア1つの▼を持つキャラクター全てと、精神力0のキャラクター全て≫を捨て札する" (Revise#126):
      you choose one player's Active Area or Control Area; its ▼ characters and every Mental 0 character are discarded. */
  A.areaSweep = (ctx, s, e) => {
    const S = ctx.S, opts = [], labels = [];
    for (const seat of AA4.living(S)) for (const [a, l] of [["active", "Active Area"], ["control", "Control Area"]]) { opts.push(seat + ":" + a); labels.push(`${S.players[seat].name} — ${l}`); }
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, labels, reason: "Choose one area: its ▼ characters are discarded (and every Mental 0 character)", then: [{ op: "areaSweepGo" }] });
  };
  /** "あなたの任意のエリア1つを指定する。≪指定したエリアのキャラクター全て≫にNダメージを与える" (A3-16 2176, Revise#168) */
  A.areaDamage = (ctx, s, e) => {
    const S = ctx.S, opts = [], labels = [];
    for (const seat of AA4.living(S)) for (const [a, l] of [["active", "Active Area"], ["control", "Control Area"]]) { opts.push(seat + ":" + a); labels.push(`${S.players[seat].name} — ${l}`); }
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, labels, auto: false, reason: `Choose one area: ${s.mental ? "(" + s.n + ")" : s.n} damage to every character there`, then: [{ op: "areaDamageGo", n: s.n, mental: !!s.mental, from: e.ch || null, fromSeat: e.seat }] });
  };
  OPS.areaDamageGo = (ctx, op) => {
    const S = ctx.S, [seat, a] = String((op.answer || [])[0] || "").split(":");
    for (const id of Object.keys(S.chars).filter(id => { const ch = S.chars[id]; return a && ch.owner === +seat && (a === "active" ? ch.at.area === "active" : AA4.isControlled(ch)); }))
      if (S.chars[id]) AA4.damageChar(ctx, id, { from: op.from, fromSeat: op.fromSeat, normal: op.mental ? 0 : op.n, mental: op.mental ? op.n : 0 });
  };
  OPS.areaSweepGo = (ctx, op) => {
    const S = ctx.S, [seat, a] = String((op.answer || [])[0] || "").split(":");
    const kill = Object.keys(S.chars).filter(id => {
      const ch = S.chars[id], st = AA4.charStats(S, ctx.db, id);
      const inArea = a && ch.owner === +seat && (a === "active" ? ch.at.area === "active" : AA4.isControlled(ch));
      return (inArea && st.skills.aggressive) || (st.se || 0) <= 0;
    });
    for (const id of kill) if (S.chars[id]) AA4.defeat(ctx, id, { why: "discarded" });
  };
  /** "≪このカード≫を、勢力なし、分類・…を持つ、a/b/cのあなたの支配キャラクター、“NAME”としてセットする" (Revise#174): this Project / Fast card
      becomes a Controlled Character (Control Area Back) with the token's stats. s: {name | options: [{name, stats, skills}], stats, icons, skills, noSet,
      power: "handX", payOnly: [kinds], altPayHandAttack, aura: {sel, skills}} */
  A.cardToken = (ctx, s, e) => {
    const S = ctx.S, c = e.card && S.cards[e.card];
    if (!c || !["special", "declared", "discard"].includes(c.place.z)) return;
    if (s.options && s.options.length > 1) return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: s.options.map(o => o.name), auto: false, reason: "Choose which character it becomes", then: [{ op: "cardTokenGo", s, e }] });
    OPS.cardTokenGo(ctx, { s, e, answer: s.options ? [s.options[0].name] : null });
  };
  OPS.tokenGuardAsk = (ctx, op) => {
    const S = ctx.S, b = S.battle;
    if (!b || b.guard || !b.target || b.target.seat !== op.seat || !S.chars[op.ch]) return;
    if (!op.answer) return AA4.ask(ctx, { seat: op.seat, kind: "yesno", reason: `Guard with ${op.name}?`, then: [Object.assign({}, op)] });
    if (op.answer[0] !== "yes") return;
    b.guard = op.ch; S.chars[op.ch].flags.tapped = true;
    ctx.emit({ e: "guarded", ch: op.ch, seat: op.seat, attacker: b.attacker });
  };
  OPS.cardTokenGo = (ctx, op) => {
    const S = ctx.S, e = op.e, base = op.s, pick = base.options ? base.options.find(o => o.name === (op.answer || [])[0]) || base.options[0] : {};
    const s = Object.assign({}, base, pick), c = e.card && S.cards[e.card];
    if (!c || !["special", "declared", "discard"].includes(c.place.z)) return;
    for (const m of S.modifiers.filter(y => y.src && y.src.card === e.card)) AA4.endMod(ctx, m.id);
    AA4.moveCard(ctx, e.card, { z: "back", seat: e.seat });
    const ch = AA4.charOfCard(S, e.card);
    if (!ch) return;
    const x = +e.x || 0, val = n => (n === "X" ? x : +n || 0);
    const stats = s.stats === "power" ? "power" : { se: val(s.stats.se), at: val(s.stats.at), de: val(s.stats.de) };
    const src = { seat: e.seat, card: e.card, ch: ch.id, label: s.name };
    AA4.addMod(ctx, { src, to: { ch: ch.id }, key: "token", op: "grant", value: { name: s.name, stats, atMental: !!s.atMental, icons: s.icons || [], faction: "", skills: s.skills || [], noSet: !!s.noSet }, until: s.until || "removed" });
    if (s.payOnly) AA4.addMod(ctx, { src, to: { ch: ch.id }, key: "noPay", op: "grant", value: { kinds: ["attack", "guard", "effect", "set"].filter(k => !s.payOnly.includes(k)) }, until: "removed" });
    if (s.altPayHandAttack) AA4.addMod(ctx, { src, to: { ch: ch.id }, key: "altPay", op: "grant", value: { kind: "hand", kinds: ["attack"] }, until: "removed" });
    if (s.aura) for (const sk of s.aura.skills) AA4.addMod(ctx, { src, fromChar: true, to: { all: s.aura.sel }, key: "skill", op: "grant", value: sk, until: "removed" });
    ctx.emit({ e: "tokenMade", ch: ch.id, seat: e.seat, name: s.name });
    for (const ef of s.effects || []) AA4.addMod(ctx, { src, to: { ch: ch.id }, key: "effect", op: "grant", value: ef, until: "removed" });   // 式神吽式 (A3-09 1353, Revise#256)
    if (s.power === "costAndHandX" && e.item && e.item.held) for (const id of e.item.held) if (S.cards[id] && S.cards[id].place.z === "cost") AA4.moveCard(ctx, id, { z: "char", ch: ch.id, role: "power" });
    if (s.power === "handAll") for (const id of S.players[e.seat].zones.hand.slice()) AA4.moveCard(ctx, id, { z: "char", ch: ch.id, role: "power" });   // 式神刹那式 (A3-04 0654 / 0657, Revise#256)
    if (s.dismissAt) A.delayed(ctx, { at: s.dismissAt, step: { a: "tokenDismiss", ch: ch.id, card: e.card } }, e);
    if (s.guardOnSet && S.battle && S.battle.target && S.battle.target.seat === e.seat && !S.battle.guard) AA4.enqueue(S, [{ op: "tokenGuardAsk", ch: ch.id, seat: e.seat, name: s.name }], true);   // "セットされた際にガード宣言可能な" (A4-02 0283, Revise#354)
    if ((s.power === "handX" || s.power === "costAndHandX") && x > 0) { const hand = S.players[e.seat].zones.hand; if (hand.length) return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: hand.slice(), min: Math.min(x, hand.length), max: Math.min(x, hand.length), auto: false, reason: `Choose ${x} hand card${x === 1 ? "" : "s"}: its power cards`, then: [{ op: "toPowerOn", ch: ch.id }] }); }
  };
  /** "≪あなたの任意の数のあなたの手札≫を、…の支配キャラクター、NAMEとしてセットしてもよい" (A3-12 1760, Revise#174): each chosen hand card becomes such a token */
  A.trimHandToLimit = (ctx, s, e, r) => {   // A3-02 0344 (Revise#175): you choose the cards over the limit → its owner's Damage Pile
    const S = ctx.S, seat = seats(r)[0];
    if (seat == null) return;
    const hand = S.players[seat].zones.hand, n = hand.length - AA4.playerStats(S, ctx.db, seat).handLimit;
    if (n <= 0) return;
    AA4.revealTo(S, hand, e.seat);
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: hand.slice(), min: n, max: n, auto: false, reason: `Choose ${n} card${n === 1 ? "" : "s"} of ${S.players[seat].name}'s hand → their Damage Pile`, then: [{ op: "trimHandGo" }] });
  };
  OPS.trimHandGo = (ctx, op) => { for (const id of op.answer || []) if (ctx.S.cards[id] && ctx.S.cards[id].place.z === "hand") AA4.moveCard(ctx, id, { z: "damage" }); };
  A.handTokens = (ctx, s, e) => {
    const hand = ctx.S.players[e.seat].zones.hand;
    if (!hand.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: hand.slice(), min: 0, max: hand.length, auto: false, reason: `Choose any number of hand cards: each becomes a ${s.name}`, then: [{ op: "handTokensGo", s, seat: e.seat, card: e.card }] });
  };
  OPS.handTokensGo = (ctx, op) => {
    const S = ctx.S, s = op.s, val = n => +n || 0;
    for (const id of (op.answer || []).filter(x => S.cards[x] && S.cards[x].place.z === "hand")) {
      AA4.moveCard(ctx, id, { z: "back", seat: op.seat });
      const ch = AA4.charOfCard(S, id); if (!ch) continue;
      AA4.addMod(ctx, { src: { seat: op.seat, card: op.card, label: s.name }, to: { ch: ch.id }, key: "token", op: "grant", value: { name: s.name, stats: s.stats === "power" ? "power" : { se: val(s.stats.se), at: val(s.stats.at), de: val(s.stats.de) }, icons: s.icons || [], faction: s.faction || "", skills: s.skills || [], noSet: !!s.noSet }, until: "removed" });
      ctx.emit({ e: "tokenMade", ch: ch.id, seat: op.seat, name: s.name });
    }
  };
  A.damageLast = (ctx, s, e, r) => A.damage(ctx, { n: +ctx.S.effLast || 0, mental: !!s.mental }, e, r);
  /** "≪このエフェクトのコスト≫を、勢力なし、…の支配キャラクター・<name>としてセットする" (Revise#119): the held cost cards
      become a Controlled Character (Control Area Back): the first card is the character, the others its power cards. */
  A.makeToken = (ctx, s, e) => {
    const S = ctx.S, held = ((e.item && e.item.held) || []).filter(id => S.cards[id] && S.cards[id].place.z === "cost");
    if (!held.length) return;
    if (e.item) e.item.held = [];
    if (s.each && held.length > 1) { for (const id of held) A.makeToken(ctx, Object.assign({}, s, { each: false }), Object.assign({}, e, { item: { held: [id] } })); return; }   // A3-EX02 EX0156: one token per cost card
    AA4.moveCard(ctx, held[0], { z: "back", seat: e.seat });
    const ch = AA4.charOfCard(S, held[0]);
    if (!ch) return;
    for (const id of held.slice(1)) AA4.moveCard(ctx, id, { z: "char", ch: ch.id, role: "power" });
    const x = +e.x || 0, val = n => (n === "X" ? x : +n || 0);
    const stats = s.stats === "power" ? "power" : { se: val(s.stats.se), at: val(s.stats.at), de: val(s.stats.de) };
    AA4.addMod(ctx, { src: { seat: e.seat, card: e.card, label: s.name }, to: { ch: ch.id }, key: "token", op: "grant", value: { name: s.name, stats, atMental: !!s.atMental, icons: s.icons || [], faction: s.faction || "", skills: s.skills || [], noSet: !!s.noSet, attackChars: !!s.attackChars }, until: "removed" });
    ctx.emit({ e: "tokenMade", ch: ch.id, seat: e.seat, name: s.name });
    if (s.raidIfProj && e.item && e.item.projTiming) AA4.enqueue(S, [{ op: "tokenRaidAsk", seat: e.seat, name: s.name }], true);   // 3226 (Revise#152)
  };
  /** "目標の≪…アストラル1人≫を、パワーカードとしてこのキャラクターにセットする": every card of it → power cards of this character */
  A.charToPower = (ctx, s, e, r) => {
    const S = ctx.S, me = e.ch && S.chars[e.ch];
    if (!me) return;
    for (const chId of chars(r)) {
      const c = S.chars[chId];
      if (!c || chId === e.ch) continue;
      for (const id of c.power.concat(c.perm).concat(c.stack.slice().reverse())) if (S.chars[e.ch]) AA4.moveCard(ctx, id, { z: "char", ch: e.ch, role: "power" });
    }
  };
  /** "目標の≪プレイヤーまたはキャラクター1人≫に対して効果を発揮しているプロジェクトカード・ファストカード全てを捨て札する" (金の針) */
  A.lastingOff = (ctx, s, e, r) => {
    const S = ctx.S, hit = m => r.some(x => (x.ch && m.to && m.to.ch === x.ch) || (x.seat != null && m.to && (m.to.seat === x.seat || (m.to.seats || []).includes(x.seat))));
    const cards = [...new Set(S.modifiers.filter(m => hit(m) && m.src && m.src.card && S.cards[m.src.card] && S.cards[m.src.card].place.z === "special").map(m => m.src.card))];
    for (const id of cards) { for (const m of S.modifiers.filter(x => x.src && x.src.card === id)) AA4.endMod(ctx, m.id); if (S.cards[id].place.z === "special") AA4.moveCard(ctx, id, { z: s.dest || "discard" }); }
  };
  A.discardOnAttack = (ctx, s, e, r) => { for (const ch of chars(r)) mod(ctx, e, { to: { ch }, key: "discardOnAttack", op: "grant", value: { card: e.card, dest: s.dest || "discard" }, until: s.until || "turn" }); };   // dest "hand": "…の場合、代わりに、手札に戻す" (EX888, Revise#339)
  /** "≪アタックを受けたプレイヤーの支配エリアのネームレベルキャラクター1人≫を捨て札する": you choose it now */
  A.pickDiscard = (ctx, s, e) => {
    const S = ctx.S, opts = Object.keys(S.chars).filter(id => AA4.matchChar(S, ctx.db, s.sel || {}, id, { seat: e.seat, self: e.ch, x: e.x }));
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: s.upTo ? 0 : 1, max: 1, reason: s.upTo ? "You may choose a character to discard" : "Choose the character to discard", then: [{ op: "pickDiscardGo", label: srcLabel(ctx, e) }] });
  };
  OPS.pickDiscardGo = (ctx, op) => { for (const id of op.answer || []) { const ch = AA4.charOfCard(ctx.S, id); if (ch) AA4.defeat(ctx, ch.id, { why: `discarded by ${op.label}` }); } };
  A.untap = (ctx, s, e, r) => { for (const ch of chars(r)) ctx.S.chars[ch].flags.tapped = false; };
  /** Cancel the attack / guard declaration of a character (Revise#045 "Battle"). */
  A.cancelCurrentAttack = ctx => { const b = ctx.S.battle; if (b && b.kind === "attack" && b.step !== "end") { b.step = "end"; ctx.emit({ e: "attackCancelled", ch: b.attacker }); } };   // A3-12 1774 (Revise#172)
  A.cancelBattle = (ctx, s, e, r) => {
    const S = ctx.S, b = S.battle;
    if (!b) return;
    if (s.all) {   // A3-14 2057 (Revise#199): the target's declaration and those of every character battling it — the whole battle is called off
      const inB = [b.attacker, b.guard].concat(b.joined.att, b.joined.grd).filter(Boolean);
      if (!chars(r).some(ch => inB.includes(ch))) return;
      if (b.guard) ctx.emit({ e: "guardCancelled", ch: b.guard });
      b.guard = null; b.joined.grd = []; b.step = "end"; ctx.emit({ e: "attackCancelled", ch: b.attacker });
      return;
    }
    for (const ch of chars(r)) {
      if (ch === b.attacker && s.which !== "guard") { b.step = "end"; ctx.emit({ e: "attackCancelled", ch }); }
      else if (ch === b.guard && s.which !== "attack") { b.guard = null; ctx.emit({ e: "guardCancelled", ch }); }
    }
  };
  /** "≪このキャラクター≫のアタック宣言またはガード宣言を取り消す。その後、≪このキャラクターと、アタック宣言またはガード宣言しているキャラクター全てを構成するカード全て≫を、そのオーナーの手札に戻す" (Revise#126) */
  A.battleBounce = (ctx, s, e) => {
    const S = ctx.S, b = S.battle;
    if (!b || !e.ch || (b.attacker !== e.ch && b.guard !== e.ch)) return;
    const all = [...new Set([b.attacker, b.guard, e.ch].filter(id => id && S.chars[id]))];
    A.cancelBattle(ctx, { which: "both" }, e, [{ ch: e.ch }]);
    for (const ch of all) if (S.chars[ch]) AA4.removeChar(ctx, ch, { to: "hand", why: `returned by ${srcLabel(ctx, e)}` });
  };
  /** "≪…キャラクターを構成するカード全てと、…にセットされているパワーカード全て≫を、そのオーナーのダメージ置き場に置く" (Revise#126) */
  A.charToDamage = (ctx, s, e, r) => {
    const S = ctx.S;
    for (const ch of chars(r)) {
      if (!S.chars[ch]) continue;
      for (const id of S.chars[ch].perm.slice()) AA4.moveCard(ctx, id, { z: "discard" });
      AA4.removeChar(ctx, ch, { to: "damage", allTo: true, why: `put into the Damage Pile by ${srcLabel(ctx, e)}` });
    }
  };
  /** "≪プレイヤー全ての手札全て≫を捨て札する" (女媧, Revise#126) */
  A.discardHands = (ctx, s, e) => { const S = ctx.S; for (const seat of AA4.living(S)) for (const id of S.players[seat].zones.hand.slice()) AA4.moveCard(ctx, id, { z: "discard" }); };
  /** "≪プレイヤー全ての捨て札置き場のカード全て≫を、そのオーナーのデッキに戻し、そのデッキをシャッフルする。その後、あなた以外のプレイヤーのデッキの一番上のカード1枚を、そのプレイヤーのダメージ置き場に置く" */
  A.discardsToDecks = (ctx, s, e) => {
    const S = ctx.S, ops = [];
    for (const seat of AA4.living(S)) { for (const id of S.players[seat].zones.discard.slice()) AA4.moveCard(ctx, id, { z: "deck", seat }); ops.push({ op: "shuffle", seat }); }
    for (const seat of AA4.living(S)) if (seat !== e.seat) ops.push({ op: "millTop", seat, n: s.mill || 0 });
    AA4.enqueue(S, ops, true);
  };
  OPS.millTop = (ctx, op) => { const d = ctx.S.players[op.seat].zones.deck; for (let i = 0; i < op.n && d.length; i++) AA4.moveCard(ctx, d[d.length - 1], { z: "damage" }); };
  /* ---------- attacks made by an effect (Revise#129) ---------- */
  /** "目標の≪アタック宣言しているあなたの支配キャラクター1人≫のアタック宣言を取り消す。その後、<this / your chosen> キャラクターを、目標がアタック宣言していた対象にアタック宣言させる。
      目標がガード宣言されていた場合、…ガード宣言の対象を、アタック宣言させるキャラクターに変更する": the new attacker takes the old one's place in this battle. */
  A.swapAttacker = (ctx, s, e) => {
    const S = ctx.S, b = S.battle, t = (e.targets || []).map(x => x.ch).find(Boolean);
    if (!b || b.kind !== "attack" || !t || b.attacker !== t || b.step === "end") return;
    if (s.who === "self") return OPS.swapAttackerGo(ctx, { seat: e.seat, old: t, answer: [e.ch] });
    const opts = AA4.controlledOf(S, e.seat).filter(id => id !== t && id !== b.guard && !AA4.charStats(S, ctx.db, id).noAttack).map(id => AA4.topOf(S.chars[id]));
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 1, max: 1, reason: "Choose your Controlled Character: it attacks instead", then: [{ op: "swapAttackerGo", seat: e.seat, old: t }] });
  };
  OPS.swapAttackerGo = (ctx, op) => {
    const S = ctx.S, b = S.battle, pick = (op.answer || [])[0], nc = pick && (S.chars[pick] ? pick : (AA4.charOfCard(S, pick) || {}).id);
    if (!b || !nc || !S.chars[nc] || b.attacker !== op.old) return;
    ctx.emit({ e: "attackCancelled", ch: op.old });
    b.attacker = nc; b.aSeat = S.chars[nc].owner;
    const ch = S.chars[nc]; ch.flags.attacks = (ch.flags.attacks || 0) + 1; ch.flags.tapped = true;
    ctx.emit({ e: "attacked", ch: nc, seat: op.seat, target: Object.assign({}, b.target), boost: 0, byEffect: true });
    if (b.guard) ctx.emit({ e: "guardMoved", ch: b.guard, to: nc });
  };
  /** "目標の≪ガード宣言しているあなたの支配キャラクター1人≫のガード宣言を取り消す。その後、あなたの任意のあなたの支配キャラクター1人を、目標がガード宣言していたキャラクターに対してガード宣言させる" */
  A.swapGuard = (ctx, s, e) => {
    const S = ctx.S, b = S.battle, t = (e.targets || []).map(x => x.ch).find(Boolean);
    if (!b || !t || b.guard !== t) return;
    const opts = AA4.controlledOf(S, e.seat).filter(id => id !== t && id !== b.attacker && !AA4.charStats(S, ctx.db, id).noGuard).map(id => AA4.topOf(S.chars[id]));
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 1, max: 1, reason: "Choose your Controlled Character: it guards instead", then: [{ op: "swapGuardGo", seat: e.seat, old: t }] });
  };
  OPS.swapGuardGo = (ctx, op) => {
    const S = ctx.S, b = S.battle, pick = (op.answer || [])[0], nc = pick && (AA4.charOfCard(S, pick) || {}).id;
    if (!b || !nc || b.guard !== op.old) return;
    ctx.emit({ e: "guardCancelled", ch: op.old });
    b.guard = nc; S.chars[nc].flags.tapped = true;
    ctx.emit({ e: "guarded", ch: nc, seat: op.seat, attacker: b.attacker, byEffect: true });
  };
  /** "目標の≪…あなたの支配キャラクター1人≫にアタック宣言させる" / "≪このキャラクター≫は、あなたの任意のあなたの対戦相手1人に対してアタック宣言する":
      a new attack without its Attack Cost; only when no battle is going on. You choose the player it attacks. */
  /** EX902 (Revise#358): "≪…キャラクター全て≫のあなたを目標にしたアタック宣言を取り消す" — the attack going on now */
  A.cancelAttackOnYou = (ctx, s, e) => { const S = ctx.S, b = S.battle; if (b && b.kind === "attack" && b.step !== "end" && b.target && b.target.seat === e.seat && b.target.ch == null && S.chars[b.attacker] && AA4.matchChar(S, ctx.db, s.sel || {}, b.attacker, { seat: e.seat })) A.cancelCurrentAttack(ctx); };
  /** 3657 (Revise#357): "≪あなたのデッキの一番上のカード1枚≫を、パワーカードとしてあなたのテリトリーのキャラクター1人にセットする" */
  A.deckTopPowerPick = (ctx, s, e) => {
    const S = ctx.S, opts = AA4.charsOf(S, e.seat); if (!opts.length || !S.players[e.seat].zones.deck.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 1, max: 1, reason: "Choose your character: the top card of your deck becomes its power card", then: [{ op: "deckTopPowerGo", seat: e.seat }] });
  };
  OPS.deckTopPowerGo = (ctx, op) => { const c = AA4.charOfCard(ctx.S, (op.answer || [])[0]); if (c) A.powerFromDeck(ctx, { n: 1 }, { seat: op.seat }, [{ ch: c.id }]); };
  /** PP183 (Revise#357): "その後、目標のオーナーの手札とデッキを確認し、目標と同じ名称のカード全てを捨て札する" */
  A.purgeSameNameT = (ctx, s, e, r) => {
    const S = ctx.S;
    for (const x of r.filter(y => y.card && S.cards[y.card])) {
      const owner = S.cards[x.card].owner, jp = (ctx.db.card(S.cards[x.card].key) || {}).jp; if (!jp) continue;
      const hit = ["hand", "deck"].flatMap(z => S.players[owner].zones[z].filter(id => (ctx.db.card(S.cards[id].key) || {}).jp === jp));
      for (const id of hit) AA4.moveCard(ctx, id, { z: "discard" });
      ctx.emit({ e: "note", text: `${hit.length} more card(s) with that name discarded from ${S.players[owner].name}'s hand and deck` });
    }
  };
  /** EX0735 (Revise#357): "≪プレイヤー全て≫は、自身のデッキの上から5枚を見て、自身の任意の順番でデッキの一番上に戻す。その後、≪三河を持つキャラクターを支配しているプレイヤー≫は1ドローする" */
  A.eachReorderTop = (ctx, s, e) => { AA4.enqueue(ctx.S, AA4.livingOrder(ctx.S).map(seat => ({ op: "reorderTopAsk", seat, n: s.n || 1 })), true); };
  OPS.reorderTopAsk = (ctx, op) => A.reorderTop(ctx, { n: op.n }, { seat: op.seat });
  A.drawSeatsCtl = (ctx, s, e) => { const S = ctx.S; AA4.enqueue(S, AA4.livingOrder(S).filter(seat => AA4.controlledOf(S, seat).some(id => AA4.matchChar(S, ctx.db, s.sel || {}, id, { seat }))).map(seat => ({ op: "draw", seat, n: s.n || 1 })), true); };
  /** 0573 (Revise#357): "≪あなたの支配キャラクター全て≫は、指定したキャラクターを目標にアタック宣言可能" */
  A.attackableT = (ctx, s, e, r) => { for (const ch of chars(r)) mod(ctx, e, { to: { all: { owner: "you", area: "controlled" } }, key: "attackChars", op: "grant", value: { onlyCh: ch }, until: s.until || "turn" }); };
  /** EX0752 (Revise#357): "目標の…から支払われたアタックコストはデッキの一番下に置かれる" */
  A.payDestT = (ctx, s, e, r) => { for (const ch of chars(r)) mod(ctx, e, { to: { seat: e.seat }, key: "dest", op: "dest", value: { cost: s.cost || "attack", paidBy: { onlyCh: ch }, to: s.dest || "hand" }, until: s.until || "turn" }); };
  /** 0909 / 0993 (Revise#361): "≪あなたの任意のあなたの支配キャラクターX体まで≫を、同時にアタック宣言・ガード宣言させる" — no battle: they attack one opponent together (each attack may be guarded);
      you are attacked and nobody guards yet: they guard together. No cost is paid. */
  A.massDeclarePick = (ctx, s, e) => {
    const S = ctx.S, b = S.battle, n = nOf(s, e);
    const guard = !!(b && b.kind === "attack" && !b.guard && b.target && b.target.seat === e.seat && b.target.ch == null);
    if (n <= 0 || (b && !guard)) return;
    const opts = AA4.controlledOf(S, e.seat).filter(id => !S.chars[id].flags.tapped && !(guard ? AA4.charStats(S, ctx.db, id).noGuard : AA4.charStats(S, ctx.db, id).noAttack));
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 0, max: Math.min(n, opts.length), auto: false, reason: guard ? `Choose up to ${Math.min(n, opts.length)} characters: they guard together` : `Choose up to ${Math.min(n, opts.length)} characters: they attack together`, then: [{ op: guard ? "massGuardGo" : "massAttackAsk", seat: e.seat }] });
  };
  OPS.massGuardGo = (ctx, op) => {
    const S = ctx.S, b = S.battle, l = (op.answer || []).map(id => AA4.charOfCard(S, id)).filter(Boolean).map(c => c.id);
    if (!b || b.guard || !l.length) return;
    b.guard = l[0]; b.joined.grd.push(...l.slice(1)); b.step = "response"; S.passed = [];
    for (const id of l) { S.chars[id].flags.tapped = true; ctx.emit({ e: "guarded", ch: id, seat: op.seat, attacker: b.attacker, forced: true }); }
  };
  OPS.massAttackAsk = (ctx, op) => {
    const S = ctx.S, cards = op.cards || op.answer || [];
    if (!cards.length || S.battle) return;
    const opps = AA4.living(S).filter(x => x !== op.seat);
    if (!opps.length) return;
    if (!op.cards && opps.length > 1) return AA4.ask(ctx, { seat: op.seat, kind: "pick", options: opps.map(String), labels: opps.map(x => S.players[x].name), reason: "Choose the player they attack", then: [{ op: "massAttackAsk", seat: op.seat, cards }] });
    const t = op.cards ? +((op.answer || [])[0]) : opps[0], l = cards.map(id => AA4.charOfCard(S, id)).filter(Boolean).map(c => c.id);
    if (!l.length || !S.players[t]) return;
    OPS.battleDeclared(ctx, { d: { kind: "attack", seat: op.seat, ch: l[0], target: { seat: t }, boost: 0, paid: 0, paidKeys: [] } });
    if (l.length > 1 && S.battle && !S.raid) OPS.raidGo(ctx, { seat: op.seat, ch: l[0], target: { seat: t }, free: true, answer: l.slice(1).map(id => AA4.topOf(S.chars[id])) });
  };
  /** 0377 / PR054 (Revise#364): "目標の≪プレイヤー1人≫に5ダメージを与える。そのダメージ判定で指定したカード名称のカードが出た場合、この手順をもう一度行う" (at most 10 times) */
  A.damageNameRepeat = (ctx, s, e, r) => {
    const S = ctx.S, seat = seats(r)[0], name = S.effName; if (seat == null) return;
    for (let k = 0; k < 10 && S.players[seat] && !S.players[seat].lost; k++) {
      const n = nOf(s, e), hit = !!name && S.players[seat].zones.deck.slice(-n).some(id => (ctx.db.card(S.cards[id].key) || {}).jp === name);
      AA4.damagePlayer(ctx, seat, { normal: n, mental: 0 }, { from: e.ch || null, fromSeat: e.seat });
      if (!hit) break;
      ctx.emit({ e: "note", text: "The named card came up: the damage is dealt again" });
    }
  };
  /** PP085 (Revise#365): "ターン終了時まで、≪あなたの任意の勢力1つの、アタック宣言またはガード宣言したキャラクター≫に(1)ダメージを与える" — the faction now, the damage at each declaration */
  A.factionWatchDamage = (ctx, s, e) => AA4.ask(ctx, { seat: e.seat, kind: "pick", options: ["E.G.O.", "Arayashiki", "WIZ-DOM", "Darklore", "Polestar Empire", "Eraser"], reason: "Choose a faction", then: [{ op: "factionWatchGo", s, e: { seat: e.seat, card: e.card, ch: e.ch } }] });
  OPS.factionWatchGo = (ctx, op) => {
    const f = (op.answer || [])[0], s = op.s; if (!f) return;
    for (const ev of ["attack", "guarded"]) mod(ctx, op.e, { to: { seat: op.e.seat }, key: "watchEv", op: "grant", value: { event: ev, when: {}, chSel: { faction: f }, effect: { steps: [{ a: "damage", to: "evCh", n: s.n || 1, mental: !!s.mental }], status: "auto" }, once: false, asOwner: false, x: null }, until: s.until || "turn" });
    ctx.emit({ e: "note", text: "Faction chosen: " + f });
  };
  /** PP054 (Revise#365): "あなたの手札X枚を、あなたのテリトリーのキャラクターにパワーカードとしてセットする" — one character gets them */
  A.handXToPower = (ctx, s, e) => {
    const S = ctx.S, h = S.players[e.seat].zones.hand, k = Math.min(nOf(s, e), h.length);
    if (k <= 0 || !AA4.charsOf(S, e.seat).length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: h.slice(), min: k, max: k, auto: false, reason: `Choose ${k} hand card${k > 1 ? "s" : ""}: they become power cards of one of your characters`, then: [{ op: "handXToPowerCh", seat: e.seat }] });
  };
  OPS.handXToPowerCh = (ctx, op) => {
    const S = ctx.S, cards = op.cards || op.answer || [], opts = AA4.charsOf(S, op.seat);
    if (!cards.length || !opts.length) return;
    if (!op.cards) return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 1, max: 1, reason: "Choose the character that gets them", then: [{ op: "handXToPowerCh", seat: op.seat, cards }] });
    const c = AA4.charOfCard(S, (op.answer || [])[0]); if (!c) return;
    for (const id of cards) if (S.cards[id] && S.cards[id].place.z === "hand") AA4.moveCard(ctx, id, { z: "char", ch: c.id, role: "power" });
  };
  A.rememberAreaT = (ctx, s, e, r) => { const t = chars(r)[0], c = t && ctx.S.chars[t]; ctx.S.effArea = c ? { seat: c.owner, ctl: AA4.isControlled(c) } : null; };   // 3694 (Revise#365)
  /** 0445 (Revise#366): "≪プレイヤー全て≫は、ダメージ置き場のカード全てを捨て札する。その後、捨て札置き場から、自分がこの効果で捨て札した枚数に等しい枚数のカードを選び、そのオーナーのダメージ置き場に置く" — each player, from the own Discard Pile */
  A.eachDamageSwap = (ctx, s, e) => {
    const S = ctx.S, ops = [];
    for (const seat of AA4.livingOrder(S)) {
      const dm = S.players[seat].zones.damage.slice();
      for (const id of dm) AA4.moveCard(ctx, id, { z: "discard" });
      if (dm.length) ops.push({ op: "damageSwapAsk", seat, n: dm.length });
    }
    AA4.enqueue(S, ops, true);
  };
  OPS.damageSwapAsk = (ctx, op) => {
    const S = ctx.S, opts = S.players[op.seat].zones.discard.slice(), k = Math.min(op.n, opts.length);
    if (!k) return;
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: opts, min: k, max: k, reason: `Choose ${k} card${k > 1 ? "s" : ""} of your Discard Pile: they go to your Damage Pile`, then: [{ op: "damageSwapGo" }] });
  };
  OPS.damageSwapGo = (ctx, op) => { for (const id of op.answer || []) if (ctx.S.cards[id] && ctx.S.cards[id].place.z === "discard") AA4.moveCard(ctx, id, { z: "damage" }); };
  /** 0342 (Revise#368): "…キャラクターを捨て札した場合、≪捨て札したキャラクターのオーナー、またはそのオーナーの支配キャラクター1人≫にXダメージを与える" — X = every card that character was made of or had set on it */
  A.killHitOwnerSide = (ctx, s, e) => {
    const S = ctx.S, n = (e.evAll || e.evStack || []).length, seat = e.evSeat;
    if (n <= 0 || seat == null || !S.players[seat] || S.players[seat].lost) return;
    const opts = ["p:" + seat].concat(AA4.controlledOf(S, seat).map(id => "c:" + id));
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, labels: opts.map(v => (v.startsWith("p:") ? `Player ${S.players[seat].name}` : AA4.cardName(ctx.db.card(S.cards[AA4.topOf(S.chars[v.slice(2)])].key)))), reason: `Choose who takes ${n} damage`, then: [{ op: "pickAnyDamageGo", n, mental: false, from: e.ch || null }] });
  };
  /** EX874 – EX876 (Revise#367): "あなたが武蔵を持つブレイクカードをセットした際、≪そのブレイクカードのコスト≫を手札に戻すことが可能" — the cards paid for it, wherever the cost went */
  A.paidToHandEv = (ctx, s, e) => {
    const S = ctx.S, c = e.evCard && S.cards[e.evCard]; if (!c) return;
    for (const id of (c.paidIds || []).filter(x => S.cards[x] && ["discard", "damage", "deck"].includes(S.cards[x].place.z))) AA4.moveCard(ctx, id, { z: "hand", seat: S.cards[id].owner });
    delete c.paidIds;
  };
  /** 0876 (Revise#367): "このカードがセットされた場合、自身以外のキャラクター1人を指定可能。≪指定されたキャラクター≫は…を得、+1/+1/+1される" — while this character is on the field */
  A.pickOtherBless = (ctx, s, e) => {
    const S = ctx.S, opts = Object.keys(S.chars).filter(id => id !== e.ch);
    if (!opts.length || !e.ch || !S.chars[e.ch]) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 0, max: 1, auto: false, reason: "You may name a character: it gets the bonus", then: [{ op: "pickOtherBlessGo", s, e: { seat: e.seat, card: e.card, ch: e.ch } }] });
  };
  OPS.pickOtherBlessGo = (ctx, op) => {
    const c = AA4.charOfCard(ctx.S, (op.answer || [])[0]), s = op.s; if (!c) return;
    const src = { seat: op.e.seat, ch: op.e.ch, card: op.e.card };
    for (const sk of s.skills || []) AA4.addMod(ctx, { src, fromChar: true, to: { ch: c.id }, key: "skill", op: "grant", value: { id: sk.id, x: sk.x }, until: "removed" });
    for (const [k, v] of Object.entries(s.stats || {})) if (v) AA4.addMod(ctx, { src, fromChar: true, to: { ch: c.id }, key: k, op: "add", value: v, until: "removed" });
  };
  /** EX866 (Revise#365): "目標の≪キャラクター1人≫に、そのキャラクターと同じエリアにあるあなたの任意のパーマネントカード1枚のコストに等しいダメージを与える" */
  A.damagePermCostPick = (ctx, s, e, r) => {
    const S = ctx.S, t = chars(r)[0]; if (!t || !S.chars[t]) return;
    const own = S.chars[t].owner, ctl = AA4.isControlled(S.chars[t]);
    const opts = Object.keys(S.chars).filter(id => S.chars[id].owner === own && AA4.isControlled(S.chars[id]) === ctl).flatMap(id => S.chars[id].perm).filter(id => S.cards[id].owner === e.seat);
    if (!opts.length) return ctx.emit({ e: "note", text: "No Permanent card of yours in that area: no damage" });
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 1, max: 1, reason: "Choose your Permanent card in that area: its cost is the damage", then: [{ op: "damagePermCostGo", ch: t, from: e.ch || null, seat: e.seat }] });
  };
  OPS.damagePermCostGo = (ctx, op) => {
    const S = ctx.S, id = (op.answer || [])[0], c = id && S.cards[id]; if (!c || !S.chars[op.ch]) return;
    const n = +((ctx.db.card(c.key) || {}).cost) || 0;
    if (n > 0) AA4.damageChar(ctx, op.ch, { normal: n, mental: 0, from: op.from, fromSeat: op.seat });
  };
  /** 0022 (Revise#365): "≪あなたの任意の勢力1つのブレイクしていないキャラクターX体≫にセットされているパワーカード全てを捨て札する" */
  A.factionStripPick = (ctx, s, e) => {
    const S = ctx.S, n = nOf(s, e); if (n <= 0) return;
    const fs = [...new Set(Object.keys(S.chars).filter(id => !AA4.charStats(S, ctx.db, id).broken).map(id => AA4.charStats(S, ctx.db, id).faction).filter(Boolean))];
    if (!fs.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: fs, reason: "Choose a faction", then: [{ op: "factionStripAsk", seat: e.seat, n }] });
  };
  OPS.factionStripAsk = (ctx, op) => {
    const S = ctx.S, f = (op.answer || [])[0], opts = Object.keys(S.chars).filter(id => { const st = AA4.charStats(S, ctx.db, id); return st.faction === f && !st.broken; });
    const k = Math.min(op.n, opts.length); if (!k) return;
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: k, max: k, reason: `Choose ${k} character${k > 1 ? "s" : ""}: every power card on them is discarded`, then: [{ op: "factionStripGo" }] });
  };
  OPS.factionStripGo = (ctx, op) => { const S = ctx.S; for (const id of op.answer || []) { const c = AA4.charOfCard(S, id); if (c) for (const p of c.power.slice()) AA4.moveCard(ctx, p, { z: "discard" }); } AA4.enqueue(S, [{ op: "mentalCheck" }]); };
  /** 0252 (Revise#364): "目標の≪…カード1枚≫のオーナーは追加の2コストを支払う。支払うことができなかった場合、目標を捨て札する" — power cards of the owner's Controlled Characters */
  A.payOrDiscardT = (ctx, s, e, r) => {
    const S = ctx.S, x = r.find(y => y.card && S.cards[y.card]); if (!x) return;
    const owner = S.cards[x.card].owner, n = nOf(s, e), opts = AA4.controlledOf(S, owner).filter(id => !AA4.charStats(S, ctx.db, id).noPay).flatMap(id => S.chars[id].power);
    if (opts.length < n) { ctx.emit({ e: "note", text: `${S.players[owner].name} can't pay ${n}: the card is discarded` }); return A.discard(ctx, {}, e, [{ card: x.card }]); }
    return AA4.ask(ctx, { seat: owner, kind: "cards", options: opts, min: n, max: n, auto: false, reason: `Pay ${n} more for your card (power cards of your Controlled Characters)`, then: [{ op: "discardChosen" }] });
  };
  /** EX887 (Revise#364): "…4ダメージを与える。このカードのコストが“X”からのみ支払われている場合、与えるダメージに+Xする。Xは…“X”の攻撃力の数値に等しい" */
  A.damagePayerAt = (ctx, s, e, r) => {
    const S = ctx.S, pc = (e.item && e.item.payChs) || [], at = pc.length === 1 && S.chars[pc[0]] ? +AA4.charStats(S, ctx.db, pc[0]).at || 0 : 0;
    for (const ch of chars(r)) if (S.chars[ch]) AA4.damageChar(ctx, ch, { normal: (+s.base || 0) + at, mental: 0, from: e.ch, fromSeat: e.seat });
  };
  /** EXPR043 (Revise#364): X (at least N) of your Controlled Characters — each gets a power card from your deck, the skills and +X Mental */
  A.blessPick = (ctx, s, e) => {
    const S = ctx.S, opts = AA4.controlledOf(S, e.seat), mn = Math.min(+s.min || 1, opts.length);
    if (!opts.length || opts.length < (+s.min || 1)) return ctx.emit({ e: "note", text: `It needs ${s.min} Controlled Characters: nothing happens` });
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: mn, max: opts.length, auto: false, reason: `Choose X characters (X = ${s.min} or more)`, then: [{ op: "blessGo", e: { seat: e.seat, card: e.card, ch: e.ch }, s }] });
  };
  OPS.blessGo = (ctx, op) => {
    const S = ctx.S, l = (op.answer || []).map(id => AA4.charOfCard(S, id)).filter(Boolean).map(c => c.id), x = l.length, s = op.s;
    ctx.emit({ e: "xSet", seat: op.e.seat, x });
    for (const id of l) {
      if (s.power) A.powerFromDeck(ctx, { n: s.power }, op.e, [{ ch: id }]);
      for (const sk of s.skills || []) mod(ctx, op.e, { to: { ch: id }, key: "skill", op: "grant", value: { id: sk.id, x: sk.x }, until: s.until || "turn" });
      if (s.stat) mod(ctx, op.e, { to: { ch: id }, key: s.stat, op: "add", value: x, until: s.until || "turn" });
    }
  };
  /** PP359 (Revise#355): "このカードがセットされた場合、≪あなたの支配キャラクター1人≫は、コストを支払わずにアタック宣言する" */
  A.pickMakeAttack = (ctx, s, e) => {
    const S = ctx.S; if (S.battle) return;
    const opts = AA4.controlledOf(S, e.seat).filter(id => !S.chars[id].flags.tapped && !AA4.charStats(S, ctx.db, id).noAttack);
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 1, max: 1, auto: false, reason: "Choose your character that attacks (no cost)", then: [{ op: "pickMakeAttackGo", e: { seat: e.seat, card: e.card, ch: e.ch } }] });
  };
  OPS.pickMakeAttackGo = (ctx, op) => { const c = AA4.charOfCard(ctx.S, (op.answer || [])[0]); if (c) return A.makeAttack(ctx, {}, op.e, [{ ch: c.id }]); };
  /** EP551 (Revise#355): "≪プレイヤー全て≫は、自身の対戦相手の手札を1枚選んで捨て札する" — face down, in turn order */
  A.eachOppHandDiscard = (ctx, s, e) => { AA4.enqueue(ctx.S, AA4.livingOrder(ctx.S).map(seat => ({ op: "oppHandBlindAsk", seat, n: s.n || 1 })), true); };
  OPS.oppHandBlindAsk = (ctx, op) => {
    const S = ctx.S, opts = [].concat(...AA4.living(S).filter(x => x !== op.seat).map(x => S.players[x].zones.hand));
    const n = Math.min(op.n, opts.length); if (n <= 0) return;
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: opts, min: n, max: n, auto: false, reason: `Choose ${n} card(s) of an opponent's hand (face down): discarded`, then: [{ op: "oppHandPickGo", seat: op.seat }] });
  };
  A.makeAttack = (ctx, s, e, r) => {
    const S = ctx.S, ch = s.self ? e.ch : chars(r)[0];
    if (!ch || !S.chars[ch] || S.battle || !AA4.isControlled(S.chars[ch]) || AA4.charStats(S, ctx.db, ch).noAttack) return;
    const opts = AA4.living(S).filter(x => x !== S.chars[ch].owner).map(String);
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: S.chars[ch].owner, kind: "pick", options: opts, labels: opts.map(x => S.players[+x].name), reason: "Choose the player it attacks", then: [{ op: "makeAttackGo", ch }] });
  };
  OPS.makeAttackGo = (ctx, op) => {
    const S = ctx.S, seat = +((op.answer || [])[0]), ch = S.chars[op.ch];
    if (!ch || S.battle || !S.players[seat]) return;
    return OPS.battleDeclared(ctx, { d: { kind: "attack", seat: ch.owner, ch: op.ch, target: { seat }, boost: 0, paid: 0, paidKeys: [] } });
  };
  /** "≪あなたの任意のあなたの対戦相手1人のダメージ置き場のカード全て≫を捨て札する" (Revise#129) */
  A.pileWipe = (ctx, s, e) => {
    const S = ctx.S, opts = AA4.living(S).filter(x => x !== e.seat && S.players[x].zones[s.zone || "damage"].length).map(String);
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, labels: opts.map(x => `${S.players[+x].name} (${S.players[+x].zones[s.zone || "damage"].length})`), reason: "Choose an opponent: every card of their Damage Pile is discarded", then: [{ op: "pileWipeGo", zone: s.zone || "damage" }] });
  };
  OPS.pileWipeGo = (ctx, op) => { const p = ctx.S.players[+((op.answer || [])[0])]; if (p) for (const id of p.zones[op.zone].slice()) AA4.moveCard(ctx, id, { z: "discard" }); };
  /** "目標のスキル全てを得る" (服部忍): the target's skills as they are, for a time */
  A.copySkills = (ctx, s, e, r) => { for (const ch of chars(r)) if (e.ch && ctx.S.chars[e.ch]) mod(ctx, e, { to: { ch: e.ch }, key: "copySkillsOf", op: "grant", value: ch, until: s.until || "turn" }); };
  /** "…精神力X以下のキャラクター≫をただちに捨て札する" in a watch: the guard (evCh) or the attacker it guards against */
  A.killIfSe = (ctx, s, e) => {
    const S = ctx.S, b = S.battle, id = s.who === "attacker" ? b && b.attacker : e.evCh;
    if (id && S.chars[id] && (AA4.charStats(S, ctx.db, id).se || 0) <= (+e.x || 0)) AA4.defeat(ctx, id, { why: `discarded by ${srcLabel(ctx, e)}` });
  };
  /** "≪このキャラクターと、あなたの捨て札置き場の上からX枚≫をあなたのデッキに戻し、そのデッキをシャッフルする" (大海, leaving) */
  A.leaveToDeckX = (ctx, s, e) => {
    const S = ctx.S, dp = S.players[e.seat].zones.discard, own = (e.evAll || []).filter(id => S.cards[id] && S.cards[id].place.z === "discard");
    const rest = dp.filter(id => !own.includes(id)), top = rest.slice(Math.max(0, rest.length - (+e.x || 0)));
    for (const id of own.concat(top)) AA4.moveCard(ctx, id, { z: "deck", seat: S.cards[id].owner });
    AA4.enqueue(S, [{ op: "shuffle", seat: e.seat }], true);
  };
  /** モリーアン: the target leaving discards this character; this one discarded in battle with a Controlled Character discards the target */
  A.fateLink = (ctx, s, e, r) => {
    for (const ch of chars(r)) if (e.ch && ctx.S.chars[e.ch] && ctx.S.chars[ch]) {
      mod(ctx, e, { to: { ch }, key: "fateLink", op: "grant", value: e.ch, until: s.until || "main" });
      mod(ctx, e, { to: { ch: e.ch }, key: "fateBattle", op: "grant", value: ch, until: s.until || "main" });
    }
  };
  /** "目標の≪プレイヤー1人≫の手札全てを捨て札する" (Revise#131) */
  A.handAll = (ctx, s, e, r) => { let n = 0; for (const seat of seats(r)) for (const id of ctx.S.players[seat].zones.hand.slice()) { AA4.moveCard(ctx, id, { z: s.dest || "discard" }); n++; } ctx.S.effLast = n; };
  /** "≪…キャラクターを構成するカード全てと、そのキャラクターにセットされているカード全て≫を(その)オーナーの手札に戻す" */
  A.bounceAll = (ctx, s, e, r) => { for (const ch of chars(r)) if (ctx.S.chars[ch]) AA4.removeChar(ctx, ch, { to: "hand", allTo: true, why: `returned by ${srcLabel(ctx, e)}` }); };
  /** モイライ: "≪あなたの支配キャラクター全て≫にセットされているパワーカード全てをあなたのデッキに戻し、デッキをシャッフルする。その後、あなたのターンを終了する。
      その後、対戦相手のターンをメインフェイズから行う" — only on your own turn */
  A.moiraiEnd = (ctx, s, e) => {
    const S = ctx.S;
    for (const ch of AA4.controlledOf(S, e.seat)) for (const id of S.chars[ch].power.slice()) AA4.moveCard(ctx, id, { z: "deck", seat: e.seat });
    AA4.OPS.shuffle(ctx, { seat: e.seat });
    if (S.turn.player !== e.seat) return;
    if (S.battle) { S.battle = null; AA4.expire(ctx, "battle"); }
    AA4.expire(ctx, "main");
    S.turn.nextFrom = "main"; S.turn.extraNext = []; S.turn.extraPhase = false;
    ctx.emit({ e: "turnCut", seat: e.seat });
    AA4.enqueue(S, [{ op: "endTurn" }]);
  };
  A.leaveHit = (ctx, s, e) => { if (e.ch && ctx.S.chars[e.ch]) mod(ctx, e, { to: { ch: e.ch }, key: "leaveHit", op: "grant", value: { x: +e.x || 0 }, until: s.until || "main" }); };
  /** 喜多村みかる (Revise#132): "≪このキャラクター≫はあなたの任意の勢力のファクターをX得る。メインフェイズ終了時まで、あなたが使用宣言した、その勢力の必要ファクターがX以下の
      プロジェクトカード・ファストカードのコストをあなたのデッキに戻し、そのデッキをシャッフルする" */
  A.factorPickX = (ctx, s, e) => {
    if (!e.ch || !ctx.S.chars[e.ch]) return;
    const opts = ["E.G.O.", "Arayashiki", "WIZ-DOM", "Darklore", "Polestar Empire", "Eraser"];
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, reason: `Choose a faction: this character gets ${+e.x || 0} factor of it`, then: [{ op: "factorPickGo", seat: e.seat, ch: e.ch, x: +e.x || 0, card: e.card }] });
  };
  OPS.factorPickGo = (ctx, op) => {
    const f = (op.answer || [])[0], e = { seat: op.seat, ch: op.ch, card: op.card };
    if (!f || !ctx.S.chars[op.ch]) return;
    mod(ctx, e, { to: { ch: op.ch }, key: "factor", op: "add", value: { faction: f, n: op.x }, until: "main" });
    mod(ctx, e, { to: { seat: op.seat }, key: "dest", op: "dest", value: { cost: "set", types: ["Project", "Fast"], factorMax: { faction: f, n: op.x }, to: "deckShuffle" }, until: "main" });
  };
  A.breakMinus = (ctx, s, e, r) => { for (const ch of chars(r)) if (ctx.S.chars[ch]) mod(ctx, e, { to: { ch }, key: "breakMinus", op: "grant", value: { x: +e.x || 0, top: AA4.topOf(ctx.S.chars[ch]) }, until: "main" }); };
  /** "≪全てのプレイヤーのデッキ≫を裏返す": every deck is turned over — its order reversed, and its top card is face up for everyone (Revise#132) */
  A.flipDecks = (ctx) => {
    const S = ctx.S;
    for (const p of S.players) p.zones.deck.reverse();
    S.decksFlipped = !S.decksFlipped;
    ctx.emit({ e: "decksFlipped", up: S.decksFlipped });
  };
  /** "目標の…のアタック宣言・ガード宣言・エフェクトの使用宣言全てを取り消す" */
  A.cancelAllOf = (ctx, s, e, r) => {
    const S = ctx.S;
    A.cancelBattle(ctx, { which: "both" }, e, r);
    for (const ch of chars(r)) for (const it of S.stack.filter(x => x.kind === "effect" && x.ch === ch)) { S.stack.splice(S.stack.indexOf(it), 1); ctx.emit({ e: "itemCancelled", item: it.id, by: e.card }); }
  };
  A.reimuMark = (ctx, s, e, r) => { for (const ch of chars(r)) { mod(ctx, e, { to: { ch }, key: "stackCharIcons", op: "grant", value: true, until: "main" }); mod(ctx, e, { to: { seat: ctx.S.chars[ch].owner }, key: "dest", op: "dest", value: { cost: "set", types: ["Break"], targetCh: ch, to: "hand" }, until: "main" }); } };
  /* ---------- a card from a pile set as a character, then … (Revise#133: シルヴァ, グレース・ディアディム) ---------- */
  const cardChars = (S, r) => r.map(x => x.ch || (x.card && S.cards[x.card] && (AA4.charOfCard(S, x.card) || {}).id)).filter(id => id && S.chars[id]);
  A.cardCharSkill = (ctx, s, e, r) => { for (const ch of cardChars(ctx.S, r)) mod(ctx, e, { to: { ch }, key: "skill", op: "grant", value: { id: s.id, x: true }, until: s.until || "turn" }); };
  A.cardCharDelayedDamage = (ctx, s, e, r) => {
    const S = ctx.S; S.delayed = S.delayed || [];
    for (const ch of cardChars(S, r)) S.delayed.push({ at: s.at || "charge", step: { a: "charToDamage", to: "t" }, e: Object.assign({}, e, { spec: null, targets: [{ ch }] }) });
  };
  A.cardCharGuard = (ctx, s, e, r) => A.forceGuard(ctx, {}, e, cardChars(ctx.S, r).map(ch => ({ ch })));
  A.cardCharBattleEnd = (ctx, s, e, r) => { for (const ch of cardChars(ctx.S, r)) mod(ctx, e, { to: { ch }, key: "battleEndToDamage", op: "grant", value: true, until: "main" }); };
  /** トラロック (Revise#134): "≪プレイヤー全て≫は自分のターンのメインフェイズ開始時に、自分の支配キャラクター1人を捨て札する。捨て札できなかった場合、
      ≪そのプレイヤーと、そのプレイヤーの支配キャラクター全て≫に(X)ダメージを与える" */
  A.tributeOrHurt = (ctx, s, e) => {
    const S = ctx.S, seat = S.turn.player, opts = AA4.controlledOf(S, seat);
    if (!opts.length) {
      const x = +e.x || 0;
      AA4.damagePlayer(ctx, seat, { normal: 0, mental: x }, { fromSeat: e.seat });
      for (const ch of AA4.controlledOf(S, seat)) AA4.damageChar(ctx, ch, { normal: 0, mental: x, from: e.ch });
      return;
    }
    return AA4.ask(ctx, { seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 1, max: 1, reason: "Discard 1 of your Controlled Characters (トラロック)", then: [{ op: "taxGo" }] });
  };
  /* ---------- Pack (Revise#135): 1053 / 1127 / 1143 / 1515 ---------- */
  /** 美作壱与 1053: "目標の≪あなたのデッキまたはあなたのダメージ置き場の、このキャラクターと同じネームを持つブレイクカード1枚≫を、このキャラクターを目標に使用宣言する。
      その後、このエフェクトのコストをこのキャラクターにパワーカードとしてセットする。…シャッフルする。Xは目標のコストに等しい" — you choose from the cards that match (cost = X paid) */
  A.sameNameBreakToSelf = (ctx, s, e) => {
    const S = ctx.S, db = ctx.db, ch = e.ch && S.chars[e.ch] ? e.ch : null;
    if (!ch) return;
    const nm = AA4.charStats(S, db, ch).name, x = +e.x || 0;
    const opts = S.players[e.seat].zones.deck.concat(S.players[e.seat].zones.damage).filter(id => { const inf = db.card(S.cards[id].key) || {}; return inf.type === "Break" && inf.name && inf.name === nm && (inf.cost === "X" ? true : +inf.cost === x) && !AA4.breakReason(S, db, e.seat, id, ch, false); });
    if (!opts.length) { ctx.emit({ e: "noneFound", seat: e.seat, why: `no “${nm}” Break card with cost ${x} in your deck or Damage Pile` }); return; }
    AA4.revealTo(S, opts, e.seat);
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 1, max: 1, auto: false, reason: `Choose a “${AA4.nameEn(db, nm)}” Break card (cost ${x}) from your deck or Damage Pile: it breaks this character`, then: [{ op: "sameNameBreakGo", ch, seat: e.seat }] });
  };
  OPS.sameNameBreakGo = (ctx, op) => {
    const S = ctx.S, id = (op.answer || [])[0];
    if (!id || !S.cards[id]) return;
    const fromDeck = S.cards[id].place.z === "deck";
    OPS.breakFromHandGo(ctx, { ch: op.ch, seat: op.seat, answer: [id], anyZone: true });
    if (fromDeck) AA4.OPS.shuffle(ctx, { seat: op.seat });
    else for (const c of S.players[op.seat].zones.deck) S.cards[c].visibleTo = [];
  };
  /** "あなたは、カード名称を1つ指定する": a card name of this match (every card in it), or "Other name" (matches none). */
  A.cardNameChoose = (ctx, s, e) => {
    const S = ctx.S, seen = new Map();
    for (const c of Object.values(S.cards)) { const inf = ctx.db.card(c.key) || {}; if (inf.jp && !seen.has(inf.jp)) seen.set(inf.jp, inf); }
    const opts = [...seen.keys()].sort((a, b) => AA4.cardName(seen.get(a)).localeCompare(AA4.cardName(seen.get(b)))).concat(["__other__"]);
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, labels: opts.map(n => (n === "__other__" ? "Other name (not a card of this match)" : `${AA4.cardName(seen.get(n))}${seen.get(n).en ? " — " + n : ""}`)), reason: "Name a card", then: [{ op: "nameSet" }] });
  };
  /** キャッツアイ: "≪アタックを受けたプレイヤー≫は手札全てをプレイヤー全てに見せる。見せた手札の中に指定した名称のカードがあった場合、そのプレイヤーの手札全てをそのプレイヤーのダメージ置き場に置く" */
  A.handNameCheck = (ctx, s, e) => {
    const S = ctx.S, seat = S.battle && S.battle.defender != null ? S.battle.defender : e.evSeat, p = S.players[seat];
    if (!p) return;
    const hand = p.zones.hand.slice(), keys = hand.map(id => S.cards[id].key);
    ctx.emit({ e: "handRevealed", seat, cards: hand, keys, to: "all" });
    const hit = e.name && e.name !== "__other__" && hand.some(id => (ctx.db.card(S.cards[id].key) || {}).jp === e.name);
    if (hit) for (const id of hand) AA4.moveCard(ctx, id, { z: "damage" });
  };
  /** 河原瑠璃子 1515: "≪このエフェクトのコスト≫を、あなたの任意のあなたの支配キャラクター1人に、パーマネントカード・糸としてセットする。
      糸をセットされているキャラクターは、精神力に-1され、分類・傀儡、インターセプトを持つ" — after the effect resolves; face down; only “糸” counts */
  A.threadPerm = (ctx, s, e) => {
    const S = ctx.S, held = ((e.item && e.item.held) || []).filter(id => S.cards[id] && S.cards[id].place.z === "cost"), opts = AA4.controlledOf(S, e.seat);
    if (!held.length || !opts.length) return;
    if (e.item) e.item.held = [];
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, labels: opts.map(id => AA4.cardName(ctx.db.card(S.cards[AA4.topOf(S.chars[id])].key))), reason: "Choose your Controlled Character: the cost is set on it as the Permanent “糸”", then: [{ op: "threadGo", cards: held, seat: e.seat }] });
  };
  OPS.threadGo = (ctx, op) => {
    const S = ctx.S, ch = (op.answer || [])[0];
    for (const id of op.cards) {
      if (!S.cards[id]) continue;
      if (!ch || !S.chars[ch]) { AA4.moveCard(ctx, id, { z: "discard" }); continue; }
      AA4.moveCard(ctx, id, { z: "char", ch, role: "perm" }, { faceUp: false, visibleTo: [S.cards[id].owner] });
      S.cards[id].thread = true;
      ctx.emit({ e: "threadSet", card: id, ch, seat: op.seat });
    }
    AA4.enqueue(S, [{ op: "permCheck" }]);
  };
  /** "≪ダメージ置き場に置かれているカード全て≫のテキストを無効化する" (Revise#136): a character on the field with it — checked from the printed cards, not modifiers */
  AA4.damageTextOff = (S, db) => Object.values(S.chars).some(ch => { const inf = db.card(S.cards[AA4.topOf(ch)].key) || {}; return (inf.abilities || []).some(ab => ab.mod && (ab.mod.key === "damageTextOff" || ab.mod.key === "pileTextOff")); });
  /** 2448 / 2453 (Q#46, Revise#146): "≪ダメージ置き場と捨て札置き場にあるカード全て≫のテキストを無効化する" and the texts acting on those cards / counting the Damage Pile / acting on deck cards in the Main Phase */
  AA4.pileTextOff = (S, db) => Object.values(S.chars).some(ch => { const inf = db.card(S.cards[AA4.topOf(ch)].key) || {}; return (inf.abilities || []).some(ab => ab.mod && ab.mod.key === "pileTextOff"); });
  AA4.pileImmuneSeat = (S, db, seat, bySeat) => seat !== bySeat && AA4.allMods(S, db).some(m => m.key === "pileImmune" && AA4.modAppliesToSeat(S, m, seat));   // 3264: "あなたのダメージ置き場と捨て札置き場にあるカード全て≫は、あなたの対戦相手のカードの効果を受けない"
  const PILE_RE = AA4.PILE_RE = /"zones?":(?:"(?:damage|discard)"|\[[^\]]*"(?:damage|discard)")|"pile":|"a":"(?:pileAllToHand|pickPileFactor|revealDiscardGo)"/, DECK_RE = /"zones?":(?:"deck"|\[[^\]]*"deck")|"deckTop":|"a":"(?:revealTopTake|revealUntilBreak|mill|millTop|deckTopToken|search|discardsToDecks|flipDecks)"/;
  AA4.stepNullified = (S, db, step) => { if (!AA4.pileTextOff(S, db)) return false; const j = JSON.stringify(step); return PILE_RE.test(j) || (S.turn.phase === "main" && DECK_RE.test(j)); };
  /** "このエフェクトの使用宣言時に、あなたの任意のエリア1つを指定する。≪指定したエリアのキャラクター全て≫にNダメージを与える" */
  A.areaDamage = (ctx, s, e) => {
    const S = ctx.S, opts = [], labels = [], n = s.n === "X" ? +e.x || 0 : s.n || 1;
    for (const seat of AA4.living(S)) for (const [a, l] of [["active", "Active Area"], ["control", "Control Area"]]) { opts.push(seat + ":" + a); labels.push(`${S.players[seat].name} — ${l}`); }
    const go = { op: "areaDamageGo", n, mental: !!s.mental, from: e.ch || null, players: s.players || null, seat: e.seat, multi: !!s.multi, picked: [], sel: s.sel || null };
    if (s.multi) return OPS.areaDamageMore(ctx, go);   // 3574 (Revise#152): "≪あなたの任意のエリアのキャラクター全てと、あなたの任意のプレイヤー全て≫"
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, labels, reason: `Choose one area: ${n} damage to every character there${s.players === "all" ? " (and to every player)" : ""}`, then: [go] });
  };
  OPS.areaDamageMore = (ctx, op) => {   // Pack (Revise#246): areas first (any number), then players (any number) — each chosen on the field
    const S = ctx.S, opts = [], labels = [], phase = op.phase || "area";
    if (phase === "area") {
      for (const seat of AA4.living(S)) for (const [a, l] of [["active", "Active Area"], ["control", "Control Area"]]) if (!op.picked.includes(seat + ":" + a)) { opts.push(seat + ":" + a); labels.push(`${S.players[seat].name} — ${l}`); }
      opts.push("__next__"); labels.push(op.picked.length ? "Next: choose players" : "No area — choose players");
    } else {
      for (const seat of AA4.living(S)) if (!op.picked.includes("p:" + seat)) { opts.push("p:" + seat); labels.push(`Player ${S.players[seat].name}`); }
      opts.push("__done__"); labels.push("Done — deal the damage");
    }
    const n = op.picked.filter(x => phase === "area" ? !x.startsWith("p:") : x.startsWith("p:")).length;
    return AA4.ask(ctx, { seat: op.seat, kind: "pick", options: opts, labels, fieldPicked: op.picked.slice(), reason: phase === "area" ? `Choose the areas whose characters take ${op.n} damage (any number; chosen: ${n})` : `Choose the players who take ${op.n} damage (any number; chosen: ${n})`, then: [Object.assign({}, op, { op: "areaDamageMoreGo", phase })] });
  };
  OPS.areaDamageMoreGo = (ctx, op) => {
    const a = (op.answer || [])[0];
    if (a === "__next__") return OPS.areaDamageMore(ctx, Object.assign({}, op, { phase: "player", answer: undefined }));
    if (a && a !== "__done__") return OPS.areaDamageMore(ctx, Object.assign({}, op, { picked: op.picked.concat([a]), answer: undefined }));
    const S = ctx.S, d = op.mental ? { normal: 0, mental: op.n, from: op.from } : { normal: op.n, mental: 0, from: op.from };
    for (const x of op.picked) {
      if (x.startsWith("p:")) { AA4.damagePlayer(ctx, +x.slice(2), { normal: d.normal, mental: d.mental }, { from: op.from }); continue; }
      const [seat, ar] = x.split(":");
      for (const id of Object.keys(S.chars).filter(id => S.chars[id].owner === +seat && (ar === "active" ? S.chars[id].at.area === "active" : AA4.isControlled(S.chars[id])))) if (S.chars[id]) AA4.damageChar(ctx, id, Object.assign({}, d));
    }
  };
  OPS.areaDamageGo = (ctx, op) => {
    const S = ctx.S, [seat, a] = String((op.answer || [])[0] || "").split(":");
    for (const id of Object.keys(S.chars).filter(id => S.chars[id].owner === +seat && (a === "active" ? S.chars[id].at.area === "active" : AA4.isControlled(S.chars[id])) && (!op.sel || AA4.matchChar(S, ctx.db, op.sel, id, { seat: op.seat })))) if (S.chars[id]) AA4.damageChar(ctx, id, op.mental ? { normal: 0, mental: op.n, from: op.from } : { normal: op.n, mental: 0, from: op.from });
    if (op.players === "all") for (const p of AA4.living(S)) AA4.damagePlayer(ctx, p, op.mental ? { normal: 0, mental: op.n } : { normal: op.n, mental: 0 }, { from: op.from });   // 3367: "…と、プレイヤー全て≫に"
  };
  /** レックス 1651: "デッキの一番上のカード1枚を引き、プレイヤー全てに見せる。ブレイクカードだった場合、手札に加える。以外だった場合、捨て札し、同じ手順を繰り返す" */
  A.revealUntilBreak = (ctx, s, e) => {
    const S = ctx.S, deck = S.players[e.seat].zones.deck, shown = [];
    while (deck.length) {
      const id = deck[deck.length - 1], inf = ctx.db.card(S.cards[id].key) || {};
      shown.push(S.cards[id].key);
      if (inf.type === "Break") { AA4.moveCard(ctx, id, { z: "hand" }); break; }
      AA4.moveCard(ctx, id, { z: "discard" }, { faceUp: true, visibleTo: [] });
    }
    ctx.emit({ e: "handRevealed", seat: e.seat, keys: shown, to: "all" });
  };
  /** "…目標のコストに等しい枚数ドローしてもよい" */
  A.mayDraw = (ctx, s, e) => { const n = s.n === "last" ? +ctx.S.effLast || 0 : nOf(s, e); if (n > 0) AA4.enqueue(ctx.S, [{ op: "mayDrawAsk", seat: e.seat, n, flagCard: s.elseEndToHand ? e.card : undefined }], true); else if (s.elseEndToHand && e.card && ctx.S.cards[e.card]) ctx.S.cards[e.card].endToHand = true; };
  OPS.mayDrawAsk = (ctx, op) => {
    if (!op.answer) return AA4.ask(ctx, { seat: op.seat, kind: "yesno", reason: `Draw ${op.n}?`, then: [Object.assign({}, op)] });
    if (op.answer[0] === "yes") AA4.OPS.draw(ctx, { seat: op.seat, n: op.n });
    else if (op.flagCard && ctx.S.cards[op.flagCard]) ctx.S.cards[op.flagCard].endToHand = true;   // 2911 (Revise#179): "このカードの効果で1ドローしていない場合"
  };
  /** 日之上舞香 (Revise#137): "あなたのデッキの一番上からカードX枚を引き、パワーカードとして≪あなたの任意のあなたのテリトリーのキャラクターX体≫に1枚ずつセットする" */
  A.spreadPower = (ctx, s, e) => {
    const S = ctx.S, opts = AA4.charsOf(S, e.seat), k = Math.min(+e.x || 0, opts.length, S.players[e.seat].zones.deck.length);
    if (!k) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: k, max: k, reason: `Choose ${k} of your characters: 1 power card from your deck on each`, then: [{ op: "spreadPowerGo", seat: e.seat }] });
  };
  OPS.spreadPowerGo = (ctx, op) => { const S = ctx.S, d = S.players[op.seat].zones.deck; for (const id of op.answer || []) { const ch = AA4.charOfCard(S, id); if (ch && d.length) AA4.moveCard(ctx, d[d.length - 1], { z: "char", ch: ch.id, role: "power" }); } };
  /** リッチ (Revise#142): "目標の≪アンデッド1人≫を捨て札する。…Xはこの効果で捨て札したキャラクターの攻撃力の数値に等しい" — X from its Attack before it leaves */
  A.discardStatX = (ctx, s, e, r) => {
    const S = ctx.S; let x = 0;
    for (const ch of chars(r)) if (S.chars[ch]) { x += AA4.charStats(S, ctx.db, ch)[s.stat || "at"] || 0; AA4.defeat(ctx, ch, { why: `discarded by ${srcLabel(ctx, e)}` }); }
    S.effLast = x; ctx.emit({ e: "xSet", x });
  };
  /** "≪あなたの任意のプレイヤーまたはキャラクター1人≫にNダメージを与える", chosen when it resolves */
  A.pickAnyDamage = (ctx, s, e) => {   // n "last": the number the step before stored
    const S = ctx.S, n = s.n === "last" ? +S.effLast || 0 : nOf(s, e);   // (n "X": e.x)
    if (n <= 0) return;
    const ps = s.only === "char" ? [] : AA4.living(S).map(x => "p:" + x), cs = s.only === "player" ? [] : Object.keys(S.chars).map(id => "c:" + id);   // only: "player" (2659, Revise#179)
    const labels = ps.map(v => S.players[+v.slice(2)].name).concat(cs.map(v => AA4.cardName(ctx.db.card(S.cards[AA4.topOf(S.chars[v.slice(2)])].key))));
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: ps.concat(cs), labels, reason: `Choose ${s.only === "player" ? "a player" : s.only === "char" ? "a character" : "a player or a character"}: ${s.mental ? "(" + n + ")" : n} damage`, then: [{ op: "pickAnyDamageGo", n, mental: !!s.mental, from: e.ch || null }] });
  };
  OPS.pickAnyDamageGo = (ctx, op) => {
    const v = String((op.answer || [])[0] || ""), d = op.mental ? { normal: 0, mental: op.n } : { normal: op.n, mental: 0 };
    if (v.startsWith("p:")) AA4.damagePlayer(ctx, +v.slice(2), d, { from: op.from });
    else if (v.startsWith("c:") && ctx.S.chars[v.slice(2)]) AA4.damageChar(ctx, v.slice(2), Object.assign({ from: op.from }, d));
  };
  /** ジェシカ (Revise#142): "≪あなたの任意のダメージ置き場にあるカード1枚≫を捨て札する。…Xはこの効果で捨て札したカードの必要ファクターに等しい" */
  A.pickPileFactor = (ctx, s, e) => {
    const S = ctx.S, opts = AA4.living(S).flatMap(x => S.players[x].zones[s.zone || "damage"]);
    S.effLast = 0;
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 1, max: 1, auto: false, reason: "Choose a card in a Damage Pile to discard (X = its factor)", then: [{ op: "discardTypeGo" }] });
  };
  /** アルゴ (Revise#142): "このエフェクトの使用宣言時にエリア1つを指定する。≪指定したエリアのキャラクター全て≫の耐久力にー6する" */
  A.areaMod = (ctx, s, e) => {
    const S = ctx.S, opts = [], labels = [];
    for (const seat of AA4.living(S)) for (const [a, l] of [["active", "Active Area"], ["control", "Control Area"]]) { opts.push(seat + ":" + a); labels.push(`${S.players[seat].name} — ${l}`); }
    const then = [{ op: "areaModGo", mod: s.mod || null, mods: s.mods || null, sel: s.sel || null, key: s.key, n: s.n, until: s.until || "turn", seat: e.seat, ch: e.ch, card: e.card }];
    if (s.multi) return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, labels, min: 0, max: opts.length, auto: false, reason: `Choose any areas: ${s.label || "the effect"}`, then });   // "あなたの任意のエリアの…キャラクター全て" (EX853, Revise#354)
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, labels, reason: s.mod || s.mods ? `Choose one area: ${s.label || "the effect"} for every character there` : `Choose one area: ${{ se: "Mental", at: "Attack", de: "Defense" }[s.key]} ${s.n > 0 ? "+" : ""}${s.n} to every character there`, then });
  };
  OPS.areaModGo = (ctx, op) => {
    const S = ctx.S;
    for (const ans of op.answer || []) {
      const [seat, a] = String(ans || "").split(":");
      for (const id of Object.keys(S.chars).filter(id => S.chars[id].owner === +seat && (a === "active" ? S.chars[id].at.area === "active" : AA4.isControlled(S.chars[id])) && (!op.sel || AA4.matchChar(S, ctx.db, op.sel, id, { seat: op.seat, self: op.ch }))))
        for (const m of op.mods || [op.mod ? op.mod : { key: op.key, op: "add", value: op.n }]) mod(ctx, { seat: op.seat, ch: op.ch, card: op.card }, Object.assign({ to: { ch: id }, until: op.until }, m));
    }
  };
  /** メイ・ウォーデン (Revise#142): "このエフェクトの使用宣言時に、あなたの手札X枚と…を…あなたのデッキに戻してシャッフルする。目標の≪精神力X以下のキャラクター1人≫を…そのオーナーのデッキに戻してシャッフルする" — X = how many you put back */
  A.handToDeckX = (ctx, s, e) => {
    const S = ctx.S, hand = S.players[e.seat].zones.hand.slice();
    S.effLast = 0;
    if (!hand.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: hand, min: 0, max: hand.length, auto: false, reason: "Put any number of hand cards back into your deck (X = how many)", then: [{ op: "handToDeckXGo", seat: e.seat }] });
  };
  OPS.handToDeckXGo = (ctx, op) => { const S = ctx.S, l = (op.answer || []).filter(id => S.cards[id] && S.cards[id].place.z === "hand"); for (const id of l) AA4.moveCard(ctx, id, { z: "deck" }); if (l.length) AA4.OPS.shuffle(ctx, { seat: op.seat }); S.effLast = l.length; ctx.emit({ e: "xSet", x: l.length }); };
  A.ifStatToDeck = (ctx, s, e, r) => {
    const S = ctx.S, x = +S.effLast || 0;
    for (const ch of chars(r)) if (S.chars[ch] && (AA4.charStats(S, ctx.db, ch)[s.stat || "se"] || 0) <= x) AA4.removeChar(ctx, ch, { to: "deck", allTo: true, shuffle: true, why: `returned to the deck by ${srcLabel(ctx, e)}` });
  };
  /** ギンガ・バン (Revise#142): "≪あなたの手札にある、あなたが必要ファクターを満たしているマシンまたはサイボーグ♂のブレイクカード1枚≫と、≪このカード≫を入れ替える" */
  A.swapWithHand = (ctx, s, e) => {
    const S = ctx.S, ch = e.ch && S.chars[e.ch];
    if (!ch || AA4.topOf(ch) !== e.card) return;
    const myName = AA4.charStats(S, ctx.db, e.ch).name;
    const opts = S.players[e.seat].zones.hand.filter(id => { const inf = ctx.db.card(S.cards[id].key) || {}; return inf.type === "Break" && (!s.sameName || (!!inf.name && inf.name === myName)) && (!s.icons || (inf.icons || []).some(i => s.icons.includes(i))) && AA4.factorOk(S, ctx.db, e.seat, inf); });
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 1, max: 1, auto: false, reason: "Choose the Break card from your hand that takes this card's place", then: [{ op: "swapWithHandGo", ch: e.ch, card: e.card, seat: e.seat }] });
  };
  OPS.swapWithHandGo = (ctx, op) => {
    const S = ctx.S, id = (op.answer || [])[0], ch = S.chars[op.ch];
    if (!id || !ch || AA4.topOf(ch) !== op.card || S.cards[id].place.z !== "hand") return;
    AA4.moveCard(ctx, id, { z: "char", ch: op.ch, role: "stack" });
    AA4.moveCard(ctx, op.card, { z: "hand" });
    ctx.emit({ e: "swapped", ch: op.ch, card: id, back: op.card, seat: op.seat });
  };
  A.guardHit = (ctx, s, e) => { if (e.ch && ctx.S.chars[e.ch]) mod(ctx, e, { to: { ch: e.ch }, key: "guardHit", op: "grant", value: { n: nOf(s, e) }, until: s.until || "main" }); };
  A.effDecl = (ctx, s, e) => { if ((e.ch && ctx.S.chars[e.ch]) || s.anyChar || (s.onto === "t" && (e.targets || []).some(x => x.ch && ctx.S.chars[x.ch]))) AA4.enqueue(ctx.S, [{ op: "effDeclPick", endMain: !!s.endMain, works: s.works || null, seat: e.seat, ch: s.onto === "t" ? ((e.targets || []).find(x => x.ch && ctx.S.chars[x.ch]) || {}).ch || null : !s.anyChar && (s.types || ["Permanent"]).includes("Permanent") ? e.ch : null, icons: s.icons || null, zones: s.zones || ["hand"], types: s.types || ["Permanent"], ignoreFactor: !!s.ignoreFactor, ignoreRule: !!s.ignoreRule, costTo: s.costTo || null, freeCost: !!s.freeCost, repeat: !!s.repeat, nameHas: s.nameHas || null, jpHas: s.jpHas || null, tag: s.tag || null, faction: s.faction || null, named: s.named == null ? null : !!s.named, costMax: s.costMax === "X" ? +e.x || 0 : s.costMax == null ? null : s.costMax, costEq: s.costEq === "X" ? +e.x || 0 : s.costEq == null ? null : s.costEq, anyChar: !!s.anyChar }]); };
  // ---- M2e batch 6 (Revise#151) ----
  /** 3759: "目標の≪デッキ≫の上からカードを10枚捨て札する。あなたのデッキ枚数が0枚でない場合、代わりに≪あなたのデッキ≫の上からカードを10枚捨て札する" */
  A.millInstead = (ctx, s, e, r) => {
    const S = ctx.S, mine = S.players[e.seat].zones.deck.length > 0;
    return A.mill(ctx, s, e, mine ? [{ seat: e.seat }] : r);
  };
  /** 3262: "あなたの手札を公開し、≪あなたのダメージ置き場と捨て札置き場と手札にある、このカードと同じネームを持つカード全て≫を、このカードの下にセット可能" */
  A.sameNameUnder = (ctx, s, e) => {
    const S = ctx.S, db = ctx.db, ch = e.ch && S.chars[e.ch], me = e.card && db.card(S.cards[e.card].key);
    if (!ch || !me || !me.name) return;
    const p = S.players[e.seat];
    AA4.revealTo(S, p.zones.hand.slice(), "all");
    const opts = ["damage", "discard", "hand"].flatMap(z => p.zones[z].filter(id => id !== e.card && (db.card(S.cards[id].key) || {}).name === me.name));
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "yesno", reason: `Put all ${opts.length} card(s) with the same name under this card?`, then: [{ op: "sameNameUnderGo", ch: e.ch, card: e.card, ids: opts }] });
  };
  OPS.sameNameUnderGo = (ctx, op) => {
    const S = ctx.S, yes = op.answer === true || (Array.isArray(op.answer) && op.answer[0] === "yes") || op.answer === "yes";
    if (!yes || !S.chars[op.ch]) return;
    for (const id of op.ids) if (S.cards[id] && S.cards[id].place.z !== "char") OPS.handUnderGo(ctx, { answer: [id], ch: op.ch, card: op.card });
  };
  /** 3117: "あなた以外のプレイヤーの支配キャラクター1人を指定する。メインフェイズ終了時まで、≪あなたの支配キャラクター全て≫は指定したキャラクターを目標にアタック宣言可能" */
  A.designateAttackable = (ctx, s, e) => {
    const S = ctx.S, opts = Object.keys(S.chars).filter(id => s.any ? id !== e.ch : S.chars[id].owner !== e.seat && AA4.isControlled(S.chars[id])), n = Math.min(s.n == null ? 1 : nOf(s, e), opts.length);
    if (!opts.length || n <= 0) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: n, max: n, reason: `Designate ${n} opponent's Controlled Character${n > 1 ? "s" : ""}: your characters may attack ${n > 1 ? "them" : "it"} this Main Phase${s.noGuard ? " (nobody else may guard)" : ""}`, then: [{ op: "designateAttackableGo", selfOnly: !!s.selfOnly, seat: e.seat, ch: e.ch, card: e.card, noGuard: !!s.noGuard }] });
  };
  OPS.designateAttackableGo = (ctx, op) => {
    const S = ctx.S;
    for (const id of op.answer || []) {
      const c = id && AA4.charOfCard(S, id);
      if (c) mod(ctx, { seat: op.seat, ch: op.ch, card: op.card }, { to: { ch: c.id }, key: "attackableBy", op: "grant", value: op.selfOnly ? { chIs: op.ch } : Object.assign({ area: "controlled", ownerSeat: op.seat }, op.noGuard ? { noGuard: true } : {}), until: "main" });
    }
    ctx.emit({ e: "note", text: "Designated: your characters may attack it this Main Phase" });
  };
  /** 3366: "このカードがあなたのダメージ置き場にある場合、…メインフェイズ開始時に、このカードをあなたの支配キャラクターとしてセット可能" */
  A.selfFromDamage = (ctx, s, e) => {
    const S = ctx.S, c = e.card && S.cards[e.card];
    if (!c || c.place.z !== "damage") return;
    if (!AA4.factorOk || !AA4.factorOk(S, ctx.db, e.seat, ctx.db.card(c.key) || {})) return ctx.emit({ e: "note", text: "The needed factors are not met" });
    OPS.toBack(ctx, { answer: [e.card] });
  };
  /** 3228: "≪手札上限を越える手札を持つプレイヤー全て≫は、手札上限に等しくなるまで、手札からあなたの任意のカードをダメージ置き場に置く" */
  A.overLimitToDamage = (ctx, s, e) => {
    const S = ctx.S, ops = [];
    for (const seat of AA4.living(S)) {
      const p = S.players[seat], k = p.zones.hand.length - AA4.playerStats(S, ctx.db, seat).handLimit;
      if (k > 0) ops.push({ op: "overLimitAsk", seat: e.seat, who: seat, n: k });
    }
    AA4.enqueue(S, ops, true);
  };
  OPS.overLimitAsk = (ctx, op) => {
    const S = ctx.S, hand = S.players[op.who].zones.hand.slice(), k = Math.min(op.n, hand.length);
    if (!k) return;
    AA4.revealTo(S, hand, op.seat);
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: hand, min: k, max: k, reason: `Choose ${k} card(s) of ${S.players[op.who].name}'s hand: they go to the ${op.dest === "discard" ? "Discard Pile" : "Damage Pile"}`, then: [{ op: op.dest === "discard" ? "toDiscard" : "toDamagePile" }] });
  };
  OPS.toDamagePile = (ctx, op) => { for (const id of op.answer || []) AA4.moveCard(ctx, id, { z: "damage" }); };
  /** 3044 / 2899 (Revise#152): "≪アタックを受けたプレイヤー≫の手札からあなたの任意の手札X枚を捨て札する。その後、≪あなた≫は捨て札した手札枚数に等しい枚数ドローする" (chosen face down) */
  A.oppHandPickDiscard = (ctx, s, e) => {
    const S = ctx.S, who = s.who === "evByOwner" ? (e.evBy && S.chars[e.evBy] ? S.chars[e.evBy].owner : null) : s.who === "attacked" ? (S.battle && S.battle.defender != null ? S.battle.defender : e.evSeat) : e.evSeat, p = who != null && S.players[who];
    if (!p || p.lost) return;
    const n = Math.min(nOf(s, e), p.zones.hand.length);
    if (n <= 0) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: p.zones.hand.slice(), min: n, max: n, auto: false, reason: `Choose ${n} card(s) of ${p.name}'s hand (face down): they are discarded`, then: [{ op: "oppHandPickGo", seat: e.seat, draw: !!s.drawSame }] });
  };
  OPS.oppHandPickGo = (ctx, op) => {
    let k = 0;
    for (const id of op.answer || []) if (ctx.S.cards[id] && ctx.S.cards[id].place.z === "hand") { AA4.moveCard(ctx, id, { z: "discard" }); k++; }
    if (op.draw && k) AA4.enqueue(ctx.S, [{ op: "draw", seat: op.seat, n: k }], true);
  };
  /** 2904 (Revise#152): "≪あなたの任意の分類1つを持つキャラクター全て≫に(1)ダメージを与える" */
  A.iconPickDamage = (ctx, s, e) => {
    const S = ctx.S, icons = [...new Set(Object.keys(S.chars).flatMap(id => AA4.charStats(S, ctx.db, id).icons))].sort();
    if (!icons.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: icons, reason: `Choose a class: ${s.mental ? "(" + nOf(s, e) + ")" : nOf(s, e)} damage to every character with it`, then: [{ op: "iconPickDamageGo", n: nOf(s, e), mental: !!s.mental, from: e.ch || null }] });
  };
  OPS.iconPickDamageGo = (ctx, op) => {
    const S = ctx.S, ic = (op.answer || [])[0];
    for (const id of Object.keys(S.chars).filter(id => AA4.charStats(S, ctx.db, id).icons.includes(ic))) if (S.chars[id]) AA4.damageChar(ctx, id, op.mental ? { normal: 0, mental: op.n, from: op.from } : { normal: op.n, mental: 0, from: op.from });
  };
  /** 2937 (Revise#152): "ターン終了時まで、目標の≪キャラクター1人≫は、あなたのダメージ置き場のブレイクカード・キャラクターカードの持つスキル全てを得る" */
  A.pileSkillsGrant = (ctx, s, e, r) => {
    const S = ctx.S, list = [];
    for (const id of S.players[e.seat].zones.damage) { const inf = ctx.db.card(S.cards[id].key) || {}; if (["Break", "Character"].includes(inf.type)) for (const [k, v] of Object.entries(inf.skills || {})) list.push({ id: k, x: v === true ? undefined : v }); }
    for (const ch of chars(r)) for (const v of list) mod(ctx, e, { to: { ch }, key: "skill", op: "grant", value: v, until: s.until || "turn" });
  };
  /** Token Permanents (Revise#152): 2977 "≪このエフェクトのコスト≫を、…のパーマネントカード・コントラクトリングとしてこのキャラクターにセットする",
      3302 "≪あなたのデッキの一番上のカード1枚≫を、+1/+1/+1するパーマネントカード・アームユニットとしてこのキャラクターにセットする" */
  const permTokenOn = (ctx, id, chId, tk) => { AA4.moveCard(ctx, id, { z: "char", ch: chId, role: "perm" }); ctx.S.cards[id].permToken = Object.assign({ name: tk.name, stats: tk.stats || {}, skills: tk.skills || [] }, tk.once ? { once: tk.once } : {}); ctx.emit({ e: "tokenMade", ch: chId, seat: ctx.S.chars[chId].owner, name: tk.name }); };
  A.costToPermToken = (ctx, s, e) => {
    const S = ctx.S, held = (e.item && e.item.held) || [];
    if (!e.ch || !S.chars[e.ch]) return;
    for (const id of held) if (S.cards[id] && S.cards[id].place.z === "cost") permTokenOn(ctx, id, e.ch, s.token);
  };
  /** PP212 (Revise#359): "≪あなた≫は、あなたの任意の数を1つ指定する。≪対戦相手全て≫は、指定した数のコストの…カードは使用宣言できない" — while this character is on the field */
  A.banCostPick = (ctx, s, e) => AA4.ask(ctx, { seat: e.seat, kind: "pick", options: Array.from({ length: 11 }, (_, i) => String(i)), auto: false, reason: "Name a cost: your opponents can't declare such cards", then: [{ op: "banCostGo", e: { seat: e.seat, ch: e.ch, card: e.card }, types: s.types || [] }] });
  OPS.banCostGo = (ctx, op) => {
    const n = +((op.answer || [])[0]) || 0;
    AA4.addMod(ctx, { src: { seat: op.e.seat, ch: op.e.ch, card: op.e.card }, fromChar: true, to: { players: "opponents" }, key: "ban", op: "ban", value: { decl: "set", types: op.types, costEq: n }, until: "removed" });
    ctx.emit({ e: "note", text: `Cost named: ${n}` });
  };
  /** 0211 / EP424 (Revise#359): "≪あなたの手札1枚≫を、パーマネントカード・Xとして裏向きでこのキャラクターにセットする" (the table has no face-down Permanents: it is shown as the token X) */
  A.handPermToken = (ctx, s, e) => {
    const S = ctx.S, hand = S.players[e.seat].zones.hand;
    if (!e.ch || !S.chars[e.ch] || !hand.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: hand.slice(), min: s.any ? 0 : 1, max: s.any ? hand.length : 1, auto: false, reason: s.any ? `Choose any cards of your hand: they are set on this character as ${s.token.name}` : `Choose a card of your hand: it is set on this character as ${s.token.name}`, then: [{ op: "handPermTokenGo", ch: e.ch, token: s.token }] });   // any: "あなたの手札を任意の枚数、…金としてセット可能" (EX806, Revise#364)
  };
  OPS.handPermTokenGo = (ctx, op) => { for (const id of op.answer || []) if (ctx.S.cards[id] && ctx.S.cards[id].place.z === "hand" && ctx.S.chars[op.ch]) permTokenOn(ctx, id, op.ch, op.token); };
  /** EX806 (Revise#364): "このキャラクターにセットされている金をX枚捨て札する" — X is chosen now (effLast) */
  A.permTokenDiscardAny = (ctx, s, e) => {
    const S = ctx.S, ch = e.ch && S.chars[e.ch], opts = ch ? ch.perm.filter(x => S.cards[x].permToken && S.cards[x].permToken.name === s.name) : [];
    S.effLast = 0;
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 0, max: opts.length, auto: false, reason: `Discard any number of ${s.name} (X = how many)`, then: [{ op: "discardHandAnyGo" }] });
  };
  /** PP270 (Revise#364): "≪あなたの任意の対戦相手のデッキ≫の上からカードX枚を捨て札する" */
  A.millPickOpp = (ctx, s, e) => {
    const S = ctx.S, n = nOf(s, e), opps = AA4.living(S).filter(x => x !== e.seat);
    if (n <= 0 || !opps.length) return;
    if (opps.length === 1) return A.mill(ctx, { n }, e, [{ seat: opps[0] }]);
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opps.map(String), labels: opps.map(x => S.players[x].name), reason: `Choose an opponent: the top ${n} cards of that deck are discarded`, then: [{ op: "millPickOppGo", n, e: { seat: e.seat, card: e.card, ch: e.ch } }] });
  };
  OPS.millPickOppGo = (ctx, op) => { const t = +((op.answer || [])[0]); if (ctx.S.players[t]) A.mill(ctx, { n: op.n }, op.e, [{ seat: t }]); };
  A.deckTopPermToken = (ctx, s, e) => {
    const S = ctx.S, deck = S.players[e.seat].zones.deck;
    if (!e.ch || !S.chars[e.ch] || !deck.length) return;
    permTokenOn(ctx, deck[deck.length - 1], e.ch, s.token);
  };
  /** 3302: "このエフェクトの使用宣言時に、このキャラクターにセットされているアームユニット1枚を捨て札する" (checked when it resolves: none → no effect) */
  A.permTokenDiscard = (ctx, s, e) => {
    const S = ctx.S, ch = e.ch && S.chars[e.ch], id = ch && ch.perm.find(x => S.cards[x].permToken && S.cards[x].permToken.name === s.name);
    S.effLast = id ? 1 : 0;
    if (id) AA4.moveCard(ctx, id, { z: "discard" }); else ctx.emit({ e: "note", text: `No ${s.name} to discard — no effect` });
  };
  /** 3794: "このエフェクトの使用宣言時に、あなたのデッキの上からカードをX枚捨て札しなければ、このエフェクトは効果を発揮しない" — you choose X */
  A.millChooseX = (ctx, s, e) => {
    const S = ctx.S, n = S.players[e.seat].zones.deck.length, opts = Array.from({ length: Math.min(n, 30) }, (_, i) => String(i + 1));
    S.effLast = 0;
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, reason: "Choose X: that many cards from the top of your deck are discarded (X damage)", then: [{ op: "millChooseGo", seat: e.seat }] });
  };
  OPS.millChooseGo = (ctx, op) => { const S = ctx.S, n = +((op.answer || [])[0]) || 0, deck = S.players[op.seat].zones.deck; let k = 0; for (; k < n && deck.length; k++) AA4.moveCard(ctx, deck[deck.length - 1], { z: "discard" }); S.effLast = k; };
  /** 3226 (Revise#152): "≪このエフェクトのコスト≫を、勢力ダークロア、ゴーストの1/6/4のあなたの支配キャラクター、霧の魔物としてセットする。霧の魔物があなたのターンのプロジェクトカードのタイミングでセットされた場合、
      あなたの任意の数の霧の魔物は、あなたの対戦相手1人を目標に、コストを支払わずにアタック宣言可能" */
  OPS.tokenRaidAsk = (ctx, op) => {
    const S = ctx.S, opps = AA4.living(S).filter(x => x !== op.seat), mine = AA4.controlledOf(S, op.seat).filter(id => AA4.charStats(S, ctx.db, id).name === op.name || AA4.charStats(S, ctx.db, id).tokenName === op.name || S.modifiers.some(m => m.key === "token" && m.to && m.to.ch === id && m.value && m.value.name === op.name)).filter(id => !S.chars[id].flags.tapped);
    if (!opps.length || !mine.length || S.battle) return;
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: mine.map(id => AA4.topOf(S.chars[id])), min: 0, max: mine.length, auto: false, reason: `Any number of your ${op.name} may attack one opponent (no cost)`, then: [{ op: "tokenRaidPick", seat: op.seat }] });
  };
  OPS.tokenRaidPick = (ctx, op) => {
    const S = ctx.S, picked = (op.answer || []).map(id => AA4.charOfCard(S, id)).filter(Boolean).map(c => c.id), opps = AA4.living(S).filter(x => x !== op.seat);
    if (!picked.length) return;
    if (opps.length === 1) return OPS.tokenRaidGo(ctx, { seat: op.seat, picked, answer: [String(opps[0])] });
    return AA4.ask(ctx, { seat: op.seat, kind: "pick", options: opps.map(String), labels: opps.map(x => S.players[x].name), reason: "Choose the opponent they attack", then: [{ op: "tokenRaidGo", seat: op.seat, picked }] });
  };
  OPS.tokenRaidGo = (ctx, op) => {
    const S = ctx.S, seat = +((op.answer || [])[0]), ids = op.picked.filter(id => S.chars[id]);
    if (!ids.length || !S.players[seat] || S.battle) return;
    OPS.battleDeclared(ctx, { d: { kind: "attack", seat: op.seat, ch: ids[0], target: { seat }, boost: 0, paid: 0, paidKeys: [] } });
    if (ids.length > 1) AA4.enqueue(S, [{ op: "raidGo", seat: op.seat, ch: ids[0], target: { seat }, free: true, answer: ids.slice(1).map(id => AA4.topOf(S.chars[id])) }], true);
  };
  /** 3430 (Revise#152): "≪このキャラクターのアタック目標またはガード宣言されたキャラクターのオーナー≫に" / "≪…ガード宣言するか、このキャラクターにガード宣言されたキャラクターのオーナー≫に" */
  A.battleSideOwnerHit = (ctx, s, e) => {
    const S = ctx.S, b = S.battle, n = nOf(s, e);
    if (!b || n <= 0) return;
    let seat = null;
    if (b.attacker === e.ch) { const other = s.mode === "guarded" ? b.guard : null; seat = other && S.chars[other] ? S.chars[other].owner : b.target && b.target.seat != null ? b.target.seat : b.target && b.target.ch && S.chars[b.target.ch] ? S.chars[b.target.ch].owner : null; }
    else if (b.guard === e.ch && S.chars[b.attacker]) seat = S.chars[b.attacker].owner;
    if (seat != null && seat !== e.seat) AA4.damagePlayer(ctx, seat, { normal: n, mental: 0 }, { from: e.ch, fromSeat: e.seat });
  };
  /** 3390 (Revise#152): "≪アタックを受けたプレイヤー≫の、手札全て、またはデッキ全て、またはそのプレイヤーの支配キャラクターにセットされているパワーカード全てを見て、その中からあなたの任意のカード1枚をダメージ置き場に置く" */
  A.peekPickToDamage = (ctx, s, e) => {
    const S = ctx.S, t = e.evSeat != null ? e.evSeat : S.battle && S.battle.defender;
    if (t == null || !S.players[t]) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: ["hand", "deck", "power"], labels: ["Their hand", "Their deck", "The power cards of their Controlled Characters"], reason: `Look at one group of ${S.players[t].name}'s cards: you put one of them into their Damage Pile`, then: [{ op: "peekPickGo", seat: e.seat, t }] });
  };
  OPS.peekPickGo = (ctx, op) => {
    const S = ctx.S, p = S.players[op.t], z = (op.answer || [])[0];
    const list = z === "power" ? AA4.controlledOf(S, op.t).flatMap(id => S.chars[id].power) : (p.zones[z] || []).slice();
    if (!list.length) return ctx.emit({ e: "note", text: "No card there" });
    AA4.revealTo(S, list, op.seat);
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: list, min: 1, max: 1, auto: false, reason: "Choose 1 card: it goes into that player's Damage Pile", then: [{ op: "toDamagePile" }].concat(z === "deck" ? [{ op: "shuffle", seat: op.t }] : []) });
  };
  /** 3498 (Revise#152): "≪このキャラクターを構成する、このカードと同じ名称のカード全て≫をオーナーの手札に戻す" */
  A.sameJpStackToHand = (ctx, s, e) => {
    const S = ctx.S, ch = e.ch && S.chars[e.ch], jp = e.card && (ctx.db.card(S.cards[e.card].key) || {}).jp;
    if (!ch || !jp) return;
    for (const id of ch.stack.slice()) if ((ctx.db.card(S.cards[id].key) || {}).jp === jp && S.cards[id].place.z === "char") AA4.moveCard(ctx, id, { z: "hand" });
  };
  /** 3153: "そうした場合、このカードがセットされた際に、≪指定したキャラクタ-1人≫を捨て札する" */
  A.kickDiscard = (ctx, s, e) => { const S = ctx.S, k = e.card && S.cards[e.card] && S.cards[e.card].kick; if (k && S.chars[k]) AA4.defeat(ctx, k, { why: "designated with the extra cost", by: e.ch, bySeat: e.seat }); if (e.card && S.cards[e.card]) delete S.cards[e.card].kick; };
  /** 3684: "あなたのデッキをコストがXに等しいプロジェクトカードが公開されるまで上から順に公開し、そのプロジェクトカードを、必要ファクターとコストを無視して使用宣言する。その後、そのデッキをシャッフルする" */
  A.kickProject = (ctx, s, e) => {
    const S = ctx.S, c = e.card && S.cards[e.card], x = c && c.kickX;
    if (c) delete c.kickX;
    if (x == null || !(x > 0)) return;
    const deck = S.players[e.seat].zones.deck, shown = [];
    let hit = null;
    for (let i = deck.length - 1; i >= 0; i--) { const inf = ctx.db.card(S.cards[deck[i]].key) || {}; shown.push(deck[i]); if (inf.type === "Project" && inf.cost === x) { hit = deck[i]; break; } }
    AA4.revealTo(S, shown, "all");
    ctx.emit({ e: "note", text: hit ? `Revealed ${shown.length} card(s): a cost-${x} Project card` : `Revealed the whole deck: no cost-${x} Project card` });
    const ops = [];
    if (hit) ops.push({ op: "effDeclPick", seat: e.seat, ch: null, zones: ["deck"], types: ["Project"], onlyIds: [hit], freeCost: true, ignoreFactor: true, must: true });
    ops.push({ op: "shuffle", seat: e.seat });
    AA4.enqueue(S, ops, true);
  };
  /** 2938 (Revise#152): "目標がアタックした場合、通常のダメージ判定を行わず、アタックを受けたプレイヤーのダメージ置き場にカードがX枚置かれるまでダメージ判定する" */
  A.grantPlayerHitUntil = (ctx, s, e, r) => {
    const n = +e.x || 0;
    for (const ch of chars(r)) mod(ctx, e, { to: { ch }, key: "playerHit", op: "grant", value: { effect: { steps: [{ a: "damageUntilPlaced", n }], status: "auto" }, replace: true }, until: s.until || "main" });
  };
  A.damageUntilPlaced = (ctx, s, e) => {
    const S = ctx.S, seat = e.evSeat != null ? e.evSeat : S.battle && S.battle.defender, p = seat != null && S.players[seat];
    if (!p) return;
    let placed = 0;
    for (let k = 0; k < 80 && placed < (+s.n || 0) && p.zones.deck.length && !p.lost; k++) { const b = p.zones.damage.length; AA4.damagePlayer(ctx, seat, { normal: 1, mental: 0 }, { from: e.ch, fromSeat: e.seat }); placed += Math.max(0, p.zones.damage.length - b); }
  };
  /** 3011 (Revise#152): "≪このキャラクターのバトル相手のオーナー≫は、キャラクターカードが勢力エリアにX枚セットされるまでダメージ判定を行う。このダメージ判定で出たキャラクターカード以外のカードは、ダメージ置き場に置かれずに捨て札される" */
  A.flipUntilChars = (ctx, s, e) => {
    const S = ctx.S, seat = e.evCh && S.chars[e.evCh] ? S.chars[e.evCh].owner : e.evSeat, p = seat != null && S.players[seat], n = nOf(s, e);
    if (!p || n <= 0) return;
    let got = 0;
    for (let k = 0; k < 200 && got < n; k++) {
      if (!p.zones.deck.length) { ctx.emit({ e: "deckOut", seat }); AA4.enqueue(S, [{ op: "lose", seat, why: "had to take a damage card from an empty deck" }], true); break; }
      const id = p.zones.deck[p.zones.deck.length - 1], inf = ctx.db.card(S.cards[id].key) || {};
      if (inf.type === "Character" && !(inf.name && AA4.nameOnField(S, ctx.db, inf.name))) { AA4.moveCard(ctx, id, { z: "active" }); const c = AA4.charOfCard(S, id); ctx.emit({ e: "entered", card: id, seat, ch: c && c.id, fromDamage: true }); got++; }
      else AA4.moveCard(ctx, id, { z: "discard" });
    }
  };
  /** 2940 (Revise#152): "…あなたの手札のドラグーンまたはドラグーン♂を持つカード1枚を捨て札可能。そうした場合、≪このキャラクター≫は捨て札したカードのスキル全てを持ち、そのカードの本来の能力値を合計して判定する" */
  A.discardMerge = (ctx, s, e) => {
    const S = ctx.S, ch = e.ch && S.chars[e.ch];
    if (!ch) return;
    const key = (S.battle ? S.battle.id : "t" + S.turn.number) + ":" + e.ch;
    S.mergeUsed = S.mergeUsed || {};
    if (S.mergeUsed[key]) return;
    const opts = S.players[e.seat].zones.hand.filter(id => ((ctx.db.card(S.cards[id].key) || {}).icons || []).some(i => (s.icons || []).includes(i)));
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 0, max: 1, auto: false, reason: "You may discard one of these: this character gets its skills and adds its printed stats", then: [{ op: "discardMergeGo", seat: e.seat, ch: e.ch, card: e.card, key }] });
  };
  OPS.discardMergeGo = (ctx, op) => {
    const S = ctx.S, id = (op.answer || [])[0];
    if (!id || !S.chars[op.ch]) return;
    S.mergeUsed[op.key] = true;
    const inf = ctx.db.card(S.cards[id].key) || {};
    AA4.moveCard(ctx, id, { z: "discard" });
    const src = { seat: op.seat, ch: op.ch, card: op.card };
    for (const k of ["se", "at", "de"]) if (+inf[k]) mod(ctx, src, { to: { ch: op.ch }, key: k, op: "add", value: +inf[k], until: S.battle ? "battle" : "turn" });
    for (const [k, v] of Object.entries(inf.skills || {})) mod(ctx, src, { to: { ch: op.ch }, key: "skill", op: "grant", value: { id: k, x: v === true ? undefined : v }, until: S.battle ? "battle" : "turn" });
  };
  /** 3049: "目標の≪キャラクタ-1人≫の攻撃力に+2する。または、シールド・オフェンシブ・イニシアチブのいずれか1つを与える" */
  A.choiceStatOrSkill = (ctx, s, e, r) => {
    const c = chars(r)[0];
    if (!c) return;
    const opts = ["at"].concat(s.skills || []), labels = [`Attack +${s.n}`].concat((s.skills || []).map(k => k[0].toUpperCase() + k.slice(1)));
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, labels, reason: "Choose: the Attack bonus, or one skill", then: [{ op: "choiceStatGo", seat: e.seat, ch: e.ch, card: e.card, t: c, n: s.n, until: s.until || "main" }] });
  };
  OPS.choiceStatGo = (ctx, op) => {
    const a = (op.answer || [])[0], src = { seat: op.seat, ch: op.ch, card: op.card };
    if (!a || !ctx.S.chars[op.t]) return;
    if (a === "at") mod(ctx, src, { to: { ch: op.t }, key: "at", op: "add", value: op.n, until: op.until });
    else mod(ctx, src, { to: { ch: op.t }, key: "skill", op: "grant", value: { id: a, x: true }, until: op.until });
  };
  /** 3049: "パワーカードが1枚以上セットされているあなたの支配キャラクター全てから、1コスト以上支払う … Xはこの効果で支払われたコスト" (paid when it resolves) */
  A.payFromEach = (ctx, s, e) => {
    const S = ctx.S, list = AA4.controlledOf(S, e.seat).filter(id => S.chars[id].power.length >= 1);
    S.effLast = 0;
    if (!list.length) return;
    AA4.enqueue(S, list.map(id => ({ op: "payFromEachAsk", seat: e.seat, ch: id })), true);
  };
  OPS.payFromEachAsk = (ctx, op) => {
    const S = ctx.S, c = S.chars[op.ch];
    if (!c || !c.power.length) return;
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: c.power.slice(), min: 1, max: c.power.length, auto: false, reason: `Pay 1 or more from ${AA4.cardName(ctx.db.card(S.cards[AA4.topOf(c)].key) || {})}`, then: [{ op: "payFromEachGo" }] });
  };
  OPS.payFromEachGo = (ctx, op) => { for (const id of op.answer || []) AA4.moveCard(ctx, id, { z: "discard" }); ctx.S.effLast = (+ctx.S.effLast || 0) + (op.answer || []).length; };
  /** 3122: "≪あなたの手札のパーマネントカード2枚まで≫をこのキャラクターにセット可能" (put on, no declaration) */
  A.handPermsOnto = (ctx, s, e) => {
    const S = ctx.S, opts = S.players[e.seat].zones.hand.filter(id => { const i = ctx.db.card(S.cards[id].key) || {}; return i.type === "Permanent" && (!s.aggRemove || !!(i.skills && (i.skills.remove || i.skills.aggressive))); });
    if (!e.ch || !S.chars[e.ch] || !opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 0, max: Math.min(s.n || 1, opts.length), auto: false, reason: `You may put up to ${s.n || 1} Permanent card(s) from your hand on this character`, then: [{ op: "handPermsGo", ch: e.ch }] });
  };
  OPS.handPermsGo = (ctx, op) => { for (const id of op.answer || []) if (ctx.S.chars[op.ch] && ctx.S.cards[id].place.z === "hand") AA4.moveCard(ctx, id, { z: "char", ch: op.ch, role: "perm" }); };
  /** 3122: "このキャラクターにセットされているパーマネントカード1枚を捨て札する … Xはこの効果で捨て札したパーマネントカードの必要ファクターに等しい" */
  A.ownPermDiscard = (ctx, s, e) => {
    const S = ctx.S, ch = e.ch && S.chars[e.ch];
    S.effLast = 0;
    if (!ch || !ch.perm.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: ch.perm.slice(), min: 1, max: 1, reason: "Discard one of its Permanent cards", then: [{ op: "ownPermDiscardGo" }] });
  };
  OPS.ownPermDiscardGo = (ctx, op) => { const S = ctx.S, id = (op.answer || [])[0]; if (!id) return; S.effLast = Object.values((ctx.db.card(S.cards[id].key) || {}).factor || {}).reduce((a, b) => a + (+b || 0), 0); AA4.moveCard(ctx, id, { z: "discard" }); };
  /** 3229 (Revise#152): "≪あなたの捨て札置き場にある、コストX以下の、分類鬼・鬼♂を持つか、カードテキストに分類鬼・鬼♂を含むカード全て≫を公開する。その後、その中のネームを持たないブレイクカード全てをあなたの支配キャラクターとしてセットし、残りのカード全てをあなたの手札に戻す" */
  A.oniRecall = (ctx, s, e) => {
    const S = ctx.S, max = s.costMax === "X" ? +e.x || 0 : +s.costMax || 0;
    const list = S.players[e.seat].zones.discard.filter(id => { const i = ctx.db.card(S.cards[id].key) || {}; return typeof i.cost === "number" && i.cost <= max && ((i.icons || []).some(x => (s.icons || []).includes(x)) || /鬼/.test(i.text || "")); });
    if (!list.length) return;
    AA4.revealTo(S, list, "all");
    for (const id of list) { const i = ctx.db.card(S.cards[id].key) || {}; if (i.type === "Break" && !i.name) OPS.toBack(ctx, { answer: [id] }); else AA4.moveCard(ctx, id, { z: "hand" }); }
  };
  /** 3572 (Revise#152): "このエフェクトの使用宣言時に、あなたの手札3枚を捨て札しなければ、このエフェクトは効果を発揮しない" (when it resolves) */
  A.discardHandN = (ctx, s, e) => {
    const S = ctx.S, h = S.players[e.seat].zones.hand, n = s.n || 1;
    S.effLast = 0;
    if (h.length < n) return ctx.emit({ e: "note", text: `Not ${n} cards in hand — no effect` });
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: h.slice(), min: n, max: n, reason: `Discard ${n} cards from your hand`, then: [{ op: "discardHandNGo" }] });
  };
  OPS.discardHandNGo = (ctx, op) => { for (const id of op.answer || []) AA4.moveCard(ctx, id, { z: "discard" }); ctx.S.effLast = (op.answer || []).length ? 1 : 0; };
  /** 3611 (Revise#152): "≪あなたのダメージ置き場または捨て札置き場にある、ネームを持たないマシンを持つキャラクターカード1枚またはあなたが必要ファクターを満たしている、ネームを持たないマシンを持つブレイクカード1枚≫を、あなたの支配キャラクターとしてセット可能" */
  A.pickRevive = (ctx, s, e) => {
    const S = ctx.S, p = S.players[e.seat];
    const opts = ["damage", "discard"].flatMap(z => p.zones[z]).filter(id => { const i = ctx.db.card(S.cards[id].key) || {}; return !i.name && (i.icons || []).some(x => (s.icons || []).includes(x)) && (i.type === "Character" || (i.type === "Break" && !AA4.factorOk(S, ctx.db, e.seat, i))); });
    if (!opts.length) return;
    AA4.revealTo(S, opts, e.seat);
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 0, max: 1, auto: false, reason: "You may set one of these as your Controlled Character", then: [{ op: "toBack", seat: e.seat }] });
  };
  /** 3613: "目標の≪デッキ≫からパーマネントカード1枚を選び、そのオーナーのダメージ置き場に置く" */
  A.deckPickToDamage = (ctx, s, e, r) => {
    const S = ctx.S, seat = seats(r)[0];
    if (seat == null) return;
    const opts = S.players[seat].zones.deck.filter(id => (s.types || []).includes((ctx.db.card(S.cards[id].key) || {}).type));
    AA4.revealTo(S, S.players[seat].zones.deck, e.seat);
    if (!opts.length) return ctx.emit({ e: "note", text: "No such card in that deck" });
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 1, max: 1, reason: "Choose a card: it goes into its owner's Damage Pile", then: [{ op: "toDamagePile" }, { op: "shuffle", seat }] });
  };
  /** 3613: "≪あなたの任意のダメージ置き場にあるパーマネントカード1枚≫を、そのオーナーのテリトリーのキャラクターにセットする。メインフェイズ終了時にそのパーマネントカードを捨て札し、≪そのパーマネントカードがセットされていたキャラクターとそのオーナー≫にXダメージ与える。Xはそのパーマネントカードの必要ファクターとコストの合計" */
  A.lendDamagePerm = (ctx, s, e) => {
    const S = ctx.S, opts = AA4.living(S).flatMap(x => S.players[x].zones.damage.filter(id => (ctx.db.card(S.cards[id].key) || {}).type === "Permanent" && Object.values(S.chars).some(c => c.owner === S.cards[id].owner)));
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 1, max: 1, reason: "Choose a Permanent card in a Damage Pile", then: [{ op: "lendPermChar", seat: e.seat, ch: e.ch, card: e.card }] });
  };
  OPS.lendPermChar = (ctx, op) => {
    const S = ctx.S, id = (op.answer || [])[0];
    if (!id) return;
    const owner = S.cards[id].owner, opts = Object.keys(S.chars).filter(c => S.chars[c].owner === owner);
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: opts.map(c => AA4.topOf(S.chars[c])), min: 1, max: 1, reason: "Choose a character of its owner: the Permanent is set on it until the end of the Main Phase", then: [{ op: "lendPermGo", seat: op.seat, ch: op.ch, card: op.card, perm: id }] });
  };
  OPS.lendPermGo = (ctx, op) => {
    const S = ctx.S, c = (op.answer || [])[0] && AA4.charOfCard(S, op.answer[0]);
    if (!c || S.cards[op.perm].place.z !== "damage") return;
    AA4.moveCard(ctx, op.perm, { z: "char", ch: c.id, role: "perm" });
    const inf = ctx.db.card(S.cards[op.perm].key) || {}, x = Object.values(inf.factor || {}).reduce((a, b) => a + (+b || 0), 0) + (typeof inf.cost === "number" ? inf.cost : 0);
    S.delayed = S.delayed || [];
    S.delayed.push({ at: "main", step: { a: "lendPermEnd", perm: op.perm, x }, e: { seat: op.seat, ch: op.ch, card: op.card, targets: [] } });
  };
  A.lendPermEnd = (ctx, s, e) => {
    const S = ctx.S, c = S.cards[s.perm];
    if (!c || c.place.z !== "char") return;
    const ch = c.place.ch, owner = S.chars[ch] ? S.chars[ch].owner : c.owner;
    AA4.moveCard(ctx, s.perm, { z: "discard" });
    if (s.x > 0) { if (S.chars[ch]) AA4.damageChar(ctx, ch, { normal: s.x, mental: 0, from: e.ch, fromSeat: e.seat }); AA4.damagePlayer(ctx, owner, { normal: s.x, mental: 0 }, { from: e.ch, fromSeat: e.seat }); }
  };
  /** 3721 (Revise#152): "あなたのデッキの上からカードを10枚引き、あなたのテリトリーのこのキャラクター以外のキャラクターに、パワーカードとしてセットする。その後、あなたのメインフェイズを終了する" */
  A.deckToOthersPower = (ctx, s, e) => {
    const not = s.all ? null : e.ch;   // all: "≪あなたの任意のあなたのテリトリーのキャラクター≫" (A4-01 0021, Revise#310)
    const S = ctx.S, deck = S.players[e.seat].zones.deck, n = Math.min(s.n || 1, deck.length), others = Object.keys(S.chars).filter(id => S.chars[id].owner === e.seat && id !== not);
    if (!n || !others.length) return;
    const cards = deck.slice(-n).reverse();
    for (const id of cards) AA4.moveCard(ctx, id, { z: "cost" });
    AA4.enqueue(S, cards.map(id => ({ op: "powerToOneAsk", seat: e.seat, card: id, not })), true);
  };
  OPS.powerToOneAsk = (ctx, op) => {
    const S = ctx.S, others = Object.keys(S.chars).filter(id => S.chars[id].owner === op.seat && id !== op.not);
    if (!S.cards[op.card] || S.cards[op.card].place.z !== "cost") return;
    if (!others.length) return AA4.moveCard(ctx, op.card, { z: "discard" });
    if (others.length === 1) return AA4.moveCard(ctx, op.card, { z: "char", ch: others[0], role: "power" });
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: others.map(id => AA4.topOf(S.chars[id])), min: 1, max: 1, reason: "Choose the character this card goes to as a power card", then: [{ op: "powerToOneGo", card: op.card }] });
  };
  OPS.powerToOneGo = (ctx, op) => { const c = (op.answer || [])[0] && AA4.charOfCard(ctx.S, op.answer[0]); if (c && ctx.S.cards[op.card].place.z === "cost") AA4.moveCard(ctx, op.card, { z: "char", ch: c.id, role: "power" }); };
  A.factionPowerToHand = (ctx, s, e) => {   // A3-25 3730 (Revise#175)
    const S = ctx.S, order = AA4.FACTIONS.map(f => f.name), facs = [...new Set(Object.keys(S.chars).filter(id => S.chars[id].power.length).map(id => AA4.charStats(S, ctx.db, id).faction).filter(Boolean))].sort((x, y) => order.indexOf(x) - order.indexOf(y));
    if (!facs.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: facs, auto: false, reason: "Choose a faction: the power cards on its characters go back to their owners' hands", then: [{ op: "factionPowerGo" }] });
  };
  OPS.factionPowerGo = (ctx, op) => { const S = ctx.S, f = (op.answer || [])[0]; for (const id of Object.keys(S.chars)) if (AA4.charStats(S, ctx.db, id).faction === f) for (const c of S.chars[id].power.slice()) AA4.moveCard(ctx, c, { z: "hand", seat: S.cards[c].owner }); };
  /** "≪あなたの支配キャラクター1人≫にセットされているパワーカード全てを、このキャラクターに、パワーカードとしてセットする" (A3-24 3505, Revise#176) */
  A.powerFromOwnToSelf = (ctx, s, e) => {
    const S = ctx.S, opts = AA4.controlledOf(S, e.seat).filter(id => id !== e.ch && S.chars[id].power.length);
    if (!e.ch || !S.chars[e.ch] || !opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 1, max: 1, auto: false, reason: "Choose your Controlled Character: its power cards move onto this character", then: [{ op: "powerMoveGo", to: e.ch }] });
  };
  OPS.powerMoveGo = (ctx, op) => { const S = ctx.S, ch = AA4.charOfCard(S, (op.answer || [])[0]); if (ch && S.chars[op.to]) for (const id of ch.power.slice()) AA4.moveCard(ctx, id, { z: "char", ch: op.to, role: "power" }); };
  /** "あなたの手札のあなたが必要ファクターを満たしているパーマネントカード1枚を、このキャラクターにセット可能" (A3-24 3541) */
  A.handPermFreeSelf = (ctx, s, e) => {
    const S = ctx.S, opts = S.players[e.seat].zones.hand.filter(id => { const i = ctx.db.card(S.cards[id].key) || {}; return i.type === "Permanent" && !AA4.factorOk(S, ctx.db, e.seat, i); });
    if (!e.ch || !S.chars[e.ch] || !opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 0, max: 1, auto: false, reason: "You may set 1 Permanent card from your hand on this character", then: [{ op: "toPermOn", ch: e.ch }] });
  };
  OPS.toPermOn = (ctx, op) => { for (const id of op.answer || []) if (ctx.S.chars[op.ch] && ctx.S.cards[id].place.z === "hand") { AA4.moveCard(ctx, id, { z: "char", ch: op.ch, role: "perm" }); ctx.emit({ e: "entered", card: id, seat: ctx.S.cards[id].owner, ch: op.ch }); } };
  /** "≪精神力X以下のキャラクター≫にセットされているパワーカード全てをそのオーナーのデッキに戻し、そのデッキをシャッフルする" (A3-16 2258, Revise#177) */
  A.rememberIconsT = (ctx, s, e, r) => { const t = chars(r)[0]; ctx.S.effIcons = t && ctx.S.chars[t] ? AA4.charStats(ctx.S, ctx.db, t).icons.slice() : null; ctx.S.effIconsOwner = t && ctx.S.chars[t] ? ctx.S.chars[t].owner : null; };
  /** 3544 (Revise#362): "≪そのキャラクターのオーナーのテリトリーの、…捨て札されたキャラクターと同じ分類を持つキャラクター全て≫に(1)ダメージを与える" */
  A.damageIconsOwner = (ctx, s, e) => {
    const S = ctx.S, ic = S.effIcons || [], ow = S.effIconsOwner; if (ow == null || !ic.length) return;
    for (const id of AA4.charsOf(S, ow)) if (S.chars[id] && AA4.charStats(S, ctx.db, id).icons.some(i => ic.includes(i))) AA4.damageChar(ctx, id, s.mental ? { normal: 0, mental: nOf(s, e), fromSeat: e.seat } : { normal: nOf(s, e), mental: 0, fromSeat: e.seat });
  };
  A.cancelItemsOnSelf = (ctx, s, e) => { const S = ctx.S; if (!e.ch) return; const r = S.stack.filter(it => it.id !== (e.item && e.item.id) && (it.targets || []).some(t => t.ch === e.ch)).map(it => ({ item: it.id })); if (r.length) A.cancelItem(ctx, s, e, r); };   // A3-12 1790 (Revise#177)
  /** "このキャラクターにセットされているパワーカード1枚を、あなたのダメージ置き場に置く。置けなかった場合、≪このキャラクター≫はオーナーの勢力エリアのアクティブキャラクターとなる" (A3-17 2373) */
  A.powerToDamageOrActive = (ctx, s, e) => { const S = ctx.S, ch = e.ch && S.chars[e.ch]; if (!ch) return; if (ch.power.length) AA4.moveCard(ctx, ch.power[ch.power.length - 1], { z: "damage" }); else if (AA4.isControlled(ch)) OPS.moveChar(ctx, { ch: ch.id, to: { area: "active" } }); };
  A.thisCardTo = (ctx, s, e) => { const c = e.card && ctx.S.cards[e.card]; if (c && ["special", "declared", "discard"].includes(c.place.z)) AA4.moveCard(ctx, e.card, { z: s.z || "discard" }); };   // "その後、≪このカード≫をあなたのダメージ置き場に置く" (A3-16 2258)
  A.powerToDecksSel = (ctx, s, e) => {
    const S = ctx.S, owners = new Set();
    for (const id of Object.keys(S.chars).filter(id => AA4.matchChar(S, ctx.db, s.sel || {}, id, { seat: e.seat, x: e.x }))) for (const c of S.chars[id].power.slice()) { owners.add(S.cards[c].owner); AA4.moveCard(ctx, c, { z: "deck", seat: S.cards[c].owner }); }
    for (const seat of owners) AA4.OPS.shuffle(ctx, { seat });
  };
  A.endMyMain = (ctx, s, e) => { const S = ctx.S; if (S.turn.player === e.seat && S.turn.phase === "main") S.turn.endMainSoon = true; };   // "その後、あなたのメインフェイズは終了する" (A3-09 1419 / A3-25 3730, Revise#175)
  A.effNameT = (ctx, s, e, r) => { const c = r.find(x => x.card && ctx.S.cards[x.card]); ctx.S.effName = c ? (ctx.db.card(ctx.S.cards[c.card].key) || {}).name || null : null; };   // "目標と同じネームを持つ" (A3-07 1102)
  /** "≪あなたの任意のキャラクターX体にセットされているカード全て≫をそのオーナーの手札に戻す" (A3-09 1419, Revise#175) */
  A.stripPickX = (ctx, s, e) => {
    const S = ctx.S, opts = Object.keys(S.chars).filter(id => S.chars[id].power.length || S.chars[id].perm.length), k = Math.min(+e.x || 0, opts.length);
    if (!k) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: k, max: k, auto: false, reason: `Choose ${k} character${k === 1 ? "" : "s"}: every card set on ${k === 1 ? "it goes" : "them goes"} back to the owner's hand`, then: [{ op: "stripPickGo" }] });
  };
  OPS.stripPickGo = (ctx, op) => { const S = ctx.S; for (const id of op.answer || []) { const ch = AA4.charOfCard(S, id); if (ch) for (const c of ch.power.concat(ch.perm)) AA4.moveCard(ctx, c, { z: "hand", seat: S.cards[c].owner }); } };
  A.endMyTurn = (ctx, s, e) => { const S = ctx.S; if (S.turn.player === e.seat && S.turn.phase === "main") { S.turn.endMainSoon = true; S.turn.endTurnSoon = true; } };   // "その後、あなたのターンは終了する" (Revise#159)
  A.endMyMain = (ctx, s, e) => { const S = ctx.S; if (S.turn.player === e.seat && S.turn.phase === "main") S.turn.endMainSoon = true; };
  /** 3810 (Revise#152): "このカードが場から捨て札になる場合、このカードをダメージ置き場に置く" */
  A.selfCardToDamage = (ctx, s, e) => { const c = e.card && ctx.S.cards[e.card]; if (c && ["discard", "char", "special"].includes(c.place.z)) AA4.moveCard(ctx, e.card, { z: "damage" }); };
  /** 3758 (Revise#152): "このカードがセットされた場合、♂の分類を持つカードのネームを1つ指定する" */
  A.nameMalePick = (ctx, s, e) => {
    const S = ctx.S, names = [...new Set(Object.values(S.cards).map(c => ctx.db.card(c.key) || {}).filter(i => i.name && (i.icons || []).some(x => /♂$/.test(x))).map(i => i.name))].sort();
    if (!names.length || !e.card) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: names, reason: "Name a name of a card with a ♂ class", then: [{ op: "nameMaleGo", card: e.card, seat: e.seat }] });
  };
  OPS.nameMaleGo = (ctx, op) => { const nm = (op.answer || [])[0]; if (nm && ctx.S.cards[op.card]) { ctx.S.cards[op.card].chosenName = nm; ctx.emit({ e: "named", seat: op.seat, name: nm }); } };
  /** 0373 (Revise#152): "目標の≪効果範囲が目標の、ダメージ置き場のプロジェクトカードまたはファストカード1枚≫を、このキャラクターを目標に使用する" */
  A.castOnSelf = (ctx, s, e, r) => {
    const S = ctx.S, id = (r.find(x => x.card) || {}).card, inf = id && ctx.db.card(S.cards[id].key);
    if (!inf || !inf.play || !e.ch || !S.chars[e.ch]) return;
    ctx.emit({ e: "note", text: `${AA4.cardName(inf)} is used on this character` });
    AA4.moveCard(ctx, id, { z: "special", seat: e.seat });
    AA4.runEffect(ctx, inf.play, { seat: e.seat, card: id, targets: [{ ch: e.ch }] });
    AA4.enqueue(S, [{ op: "castOnSelfEnd", card: id }]);
  };
  OPS.castOnSelfEnd = (ctx, op) => { const S = ctx.S, c = S.cards[op.card]; if (c && c.place.z === "special" && !S.modifiers.some(m => m.src && m.src.card === op.card)) AA4.moveCard(ctx, op.card, { z: "discard" }); };
  /** リバース・ゲート号 (Revise#143): "メインフェイズ終了時に、≪このカード≫をあなたのデッキに戻し、そのデッキをシャッフルする" */
  A.selfCardDiscard = (ctx, s, e) => { const c = e.card && ctx.S.cards[e.card]; if (c && c.place.z === "char") AA4.moveCard(ctx, e.card, { z: "discard" }); };   // "このカードを捨て札する" (this card only)
  A.selfCardToDeck = (ctx, s, e) => { const S = ctx.S, c = e.card && S.cards[e.card]; if (!c || c.place.z !== "char") return; AA4.moveCard(ctx, e.card, { z: "deck", seat: c.owner }); AA4.OPS.shuffle(ctx, { seat: c.owner }); };
  /** ォミーシス (Q#39): "目標の…の使用宣言を取り消す / 目標の…を捨て札する。その後、目標のオーナーにXダメージを与える" */
  A.cancelHitOwner = (ctx, s, e, r) => {
    const S = ctx.S, owners = r.filter(y => y.item).map(y => { const it = S.stack.find(z => z.id === y.item); return it ? it.seat : null; }).filter(x => x != null);
    for (const y of r.filter(y => y.item)) { const it = S.stack.find(z => z.id === y.item); if (it && it.kind === "set" && S.cards[it.card]) { A.cancelItem(ctx, s, e, [y]); if (S.cards[it.card].place.z !== "discard" && S.cards[it.card].place.z !== "char") AA4.moveCard(ctx, it.card, { z: "discard" }); } else A.cancelItem(ctx, s, e, [y]); }
    const n = nOf(s, e);
    if (n > 0) for (const seat of owners) AA4.damagePlayer(ctx, seat, { normal: n, mental: 0 }, { from: e.ch, fromSeat: e.seat });
  };
  /** G-ブレイブカイザー (Q#40, Revise#142): "このキャラクターがバトルする際、アタック宣言・ガード宣言していない、あなたの任意の数のこのキャラクター以外のマシンのあなたの支配キャラクターを指定してもよい。
      そうした場合、あなたのデッキの上から指定したキャラクターの数と等しい枚数捨て札し、指定したキャラクターの能力値を≪このキャラクター≫に合計して判定し、…スキル全てを得る。バトルの際のダメージは、≪指定したキャラクター≫にも同時に与えられる" */
  A.mergeMachines = (ctx, s, e) => {
    const S = ctx.S, me = e.ch && S.chars[e.ch], inB = S.battle ? [S.battle.attacker, S.battle.guard].concat((S.battle.joined && S.battle.joined.att) || [], (S.battle.joined && S.battle.joined.grd) || []) : [];
    if (!me) return;
    const opts = AA4.controlledOf(S, e.seat).filter(id => id !== e.ch && !inB.includes(id) && !S.chars[id].flags.tapped && AA4.matchChar(S, ctx.db, s.sel || {}, id, { seat: e.seat }));
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 0, max: opts.length, auto: false, reason: "You may choose Machines to merge: their stats and skills add to it (mill that many); battle damage hits each of them too", then: [{ op: "mergeGo", seat: e.seat, ch: e.ch, card: e.card }] });
  };
  OPS.mergeGo = (ctx, op) => {
    const S = ctx.S, chs = (op.answer || []).map(id => AA4.charOfCard(S, id)).filter(Boolean).map(c => c.id), deck = S.players[op.seat].zones.deck, e = { seat: op.seat, ch: op.ch, card: op.card };
    if (!chs.length || !S.chars[op.ch]) return;
    for (let k = 0; k < chs.length && deck.length; k++) AA4.moveCard(ctx, deck[deck.length - 1], { z: "discard" });
    const sum = { se: 0, at: 0, de: 0 }, skills = {};
    for (const c of chs) { const st = AA4.charStats(S, ctx.db, c); for (const k of ["se", "at", "de"]) sum[k] += st[k] || 0; for (const [id, v] of Object.entries(st.skills || {})) if (v) skills[id] = v; }
    for (const k of ["se", "at", "de"]) if (sum[k]) mod(ctx, e, { to: { ch: op.ch }, key: k, op: "add", value: sum[k], until: "battle" });
    for (const [id, v] of Object.entries(skills)) mod(ctx, e, { to: { ch: op.ch }, key: "skill", op: "grant", value: { id, x: v }, until: "battle" });
    mod(ctx, e, { to: { ch: op.ch }, key: "mergeDamage", op: "grant", value: { chs }, until: "battle" });
    ctx.emit({ e: "merged", ch: op.ch, chs, seat: op.seat });
  };
  /** 焔式 (Revise#143): "≪あなたの支配キャラクターの分類・式神を持つキャラクター1人を構成するカード全て≫を、このキャラクターにパワーカードとしてセットする" — chosen when it resolves */
  A.pickCharToPower = (ctx, s, e) => {
    const S = ctx.S, opts = AA4.controlledOf(S, e.seat).filter(id => id !== e.ch && AA4.matchChar(S, ctx.db, s.sel || {}, id, { seat: e.seat, self: e.ch }));
    if (!opts.length || !e.ch || !S.chars[e.ch]) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: s.multi ? 0 : 1, max: s.multi ? opts.length : 1, auto: s.multi ? false : undefined, reason: s.multi ? "Choose the characters whose cards become power cards of this one (any number)" : "Choose the character whose cards become power cards of this one", then: [{ op: "pickCharToPowerGo", ch: e.ch }] });   // multi: "あなたの任意の…を構成するカード全て" (0983, Revise#359)
  };
  OPS.pickCharToPowerGo = (ctx, op) => { for (const id of op.answer || []) { const c = AA4.charOfCard(ctx.S, id); if (c) A.charToPower(ctx, {}, { ch: op.ch }, [{ ch: c.id }]); } };
  /** "ターン終了時まで、≪このキャラクター≫はバインド1またはチャージ2を得る" (Revise#144): you choose one */
  A.choiceGrant = (ctx, s, e, r) => {
    const tc = s.to && r ? chars(r)[0] : null; if (tc) e = Object.assign({}, e, { ch: tc });   // EXPP064: to a target
    if (!e.ch || !ctx.S.chars[e.ch]) return;
    const opts = (s.options || []).map((o, i) => String(i));
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, labels: (s.options || []).map(o => o.label || o.id), reason: "Choose one", then: [{ op: "choiceGrantGo", seat: e.seat, ch: e.ch, card: e.card, options: s.options, until: s.until || "turn" }] });
  };
  OPS.choiceGrantGo = (ctx, op) => { const o = (op.options || [])[+((op.answer || [])[0])]; if (o && ctx.S.chars[op.ch]) mod(ctx, op, { to: { ch: op.ch }, key: "skill", op: "grant", value: { id: o.id, x: o.x == null ? true : o.x }, until: op.until }); };
  /** "その後、あなたのデッキの上からカードX枚を引いて、このキャラクターにパワーカードとしてセットする" — X from the step before */
  A.deckToPowerLast = (ctx, s, e) => { const S = ctx.S, deck = S.players[e.seat].zones.deck, n = +S.effLast || 0; for (let k = 0; k < n && deck.length && e.ch && S.chars[e.ch]; k++) AA4.moveCard(ctx, deck[deck.length - 1], { z: "char", ch: e.ch, role: "power" }); };
  /** バロール (Q#48, Revise#146): "メインフェイズ終了時まで、≪このキャラクター≫に次に与えられるダメージはあなたの任意のあなたの支配キャラクター1人に与えられる" — chosen now */
  A.redirectNext = (ctx, s, e) => {
    const S = ctx.S, opts = AA4.controlledOf(S, e.seat).filter(id => id !== e.ch);
    if (!e.ch || !S.chars[e.ch] || !opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 1, max: 1, reason: "Choose your Controlled Character: the next damage to this character goes to it", then: [{ op: "redirectNextGo", seat: e.seat, ch: e.ch, card: e.card, until: s.until || "main" }] });
  };
  OPS.redirectNextGo = (ctx, op) => { const c = (op.answer || [])[0] && AA4.charOfCard(ctx.S, op.answer[0]); if (c && ctx.S.chars[op.ch]) mod(ctx, op, { to: { ch: op.ch }, key: "redirectNext", op: "grant", value: { ch: c.id }, until: op.until }); };
  /** "目標の≪プロジェクトカードまたはファストカードまたはエフェクト1つ≫の目標を、あなたの任意の目標に変更する。変更する目標は適正なものでなくてはならない" */
  A.retargetItem = (ctx, s, e, r) => {
    const S = ctx.S, db = ctx.db, y = r.find(x => x.item), it = y && S.stack.find(z => z.id === y.item);
    if (!it) return;
    if (AA4.itemShielded(ctx, it, e)) return ctx.emit({ e: "note", text: "It is not affected (Fast cards and other effects)" });   // EP262
    const spec = it.kind === "effect" ? ((AA4.effectsOf(S, db, it.ch, it.card) || [])[it.i] || {}).target : it.kind === "set" ? ((AA4.cardInfo(S, db, it.card) || {}).play || {}).target : null;
    if (!spec || spec.count === "all") return ctx.emit({ e: "note", text: "It has no target to change" });
    const cur = JSON.stringify((it.targets || [])[0] || {}), cands = AA4.targetCandidates(S, db, spec, { seat: it.seat, ch: it.ch, card: it.card, x: it.x, effect: it.kind === "effect" }).filter(t => JSON.stringify(t) !== cur);
    if (!cands.length) return ctx.emit({ e: "note", text: "No other legal target" });
    const lab = t => t.ch && S.chars[t.ch] ? AA4.cardName(db.card(S.cards[AA4.topOf(S.chars[t.ch])].key)) : t.seat != null ? S.players[t.seat].name : t.card && S.cards[t.card] ? AA4.cardName(db.card(S.cards[t.card].key)) : t.item ? "a declaration" : "?";
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: cands.map((t, i) => String(i)), labels: cands.map(lab), reason: "Choose its new target (a legal one)", then: [{ op: "retargetItemGo", item: it.id, cands }] });
  };
  OPS.retargetItemGo = (ctx, op) => { const it = ctx.S.stack.find(z => z.id === op.item), t = op.cands[+((op.answer || [])[0])]; if (it && t) { it.targets = [t].concat((it.targets || []).slice(1)); ctx.emit({ e: "note", text: "The target was changed" }); } };
  A.puppet = (ctx, s, e, r) => { for (const ch of chars(r)) if (ctx.S.chars[ch] && e.ch && ctx.S.chars[e.ch]) mod(ctx, e, { to: { ch }, key: "puppet", op: "grant", value: { seat: e.seat, by: e.ch }, until: s.until || "main" }); };
  /** 2521 / 2528 (Q#49, Revise#146): "場またはダメージ置き場またはあなたの手札のブレイクカードまたはキャラクターカード1枚を指定する。≪このキャラクター≫は、指定したカードの持つ分類・スキル・エフェクト・アビリティ全てを持ち、
      そのカードの勢力のキャラクターとしても扱い、そのカードのファクターを1つ持つ。指定したカードが手札にある場合、常に公開され続ける。…ある限り、この効果は発揮され続ける" */
  A.copyCardPick = (ctx, s, e) => {
    const S = ctx.S, db = ctx.db, ok = id => ["Break", "Character"].includes((db.card(S.cards[id].key) || {}).type) && id !== e.card;
    if (!e.ch || !S.chars[e.ch]) return;
    const opts = Object.values(S.chars).flatMap(c => c.stack).concat(...S.players.map(p => p.zones.damage), S.players[e.seat].zones.hand).filter(ok);
    if (!opts.length) return;
    AA4.revealTo(S, opts, e.seat);
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 1, max: 1, auto: false, reason: "Name a Break / Character card: this character gets its classes, skills, effects and abilities", then: [{ op: "copyCardGo", seat: e.seat, ch: e.ch, card: e.card }] });
  };
  OPS.copyCardGo = (ctx, op) => {
    const S = ctx.S, id = (op.answer || [])[0], inf = id && ctx.db.card(S.cards[id].key);
    if (!inf || !S.chars[op.ch]) return;
    const cond = { cardIn: { card: id, seat: op.seat } }, e = { seat: op.seat, ch: op.ch, card: op.card };
    mod(ctx, e, { to: { ch: op.ch }, key: "inheritCard", op: "grant", value: id, until: "removed", cond });
    for (const ic of inf.icons || []) mod(ctx, e, { to: { ch: op.ch }, key: "icon", op: "grant", value: ic, until: "removed", cond });
    if (inf.faction) mod(ctx, e, { to: { ch: op.ch }, key: "factor", op: "add", value: { faction: inf.faction, n: 1 }, until: "removed", cond });
    if (S.cards[id].place.z === "hand") S.cards[id].visibleTo = S.players.map(p => p.seat);   // "指定したカードが手札にある場合、常に公開され続ける"
    ctx.emit({ e: "note", text: `Named: ${AA4.cardName(inf)}` });
  };
  /** "≪プレイヤー全て≫は、自分のデッキからプロジェクトカード1枚を選び、手札に加える" (Revise#147): each player in turn order chooses from their own zones */
  A.eachPlayerPick = (ctx, s, e) => {
    const S = ctx.S, order = (S.turn.order || []).filter(x => S.players[x] && !S.players[x].lost);
    const seats0 = order.length ? order.slice(order.indexOf(e.seat) >= 0 ? order.indexOf(e.seat) : 0).concat(order.slice(0, Math.max(0, order.indexOf(e.seat)))) : AA4.living(S);
    AA4.enqueue(S, seats0.map(seat => ({ op: "eachPickAsk", seat, zones: s.zones || ["deck"], sel: s.sel || {}, shuffle: (s.zones || ["deck"]).includes("deck") })), true);
  };
  OPS.eachPickAsk = (ctx, op) => {
    const S = ctx.S, p = S.players[op.seat];
    const wn = op.sel && op.sel.workNames ? ((AA4._workNames = AA4._workNames || {})[op.sel.workNames] = AA4._workNames[op.sel.workNames] || [...new Set(ctx.db.all().filter(c => c.name && AA4.worksOf(c, op.sel.workNames)).map(c => c.name))]) : null;   // "…に登場するネーム1つを指定し、…指定したネームを持つか、カードテキストに含むカード" (EX0480, Revise#369): any card that fits one of those names
    const opts = op.zones.flatMap(z => p.zones[z]).filter(id => { const inf = ctx.db.card(S.cards[id].key) || {}; return AA4.cardSelOk(inf, op.sel) && (!wn || (inf.name && wn.includes(inf.name)) || wn.some(n => String(inf.text || "").includes(n))); });
    if (!opts.length) { if (op.shuffle) AA4.OPS.shuffle(ctx, { seat: op.seat }); return; }
    AA4.revealTo(S, opts, op.seat);
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: opts, min: op.optional ? 0 : 1, max: 1, auto: false, reason: "Choose 1 card → your hand", then: [{ op: "toHand", seat: op.seat }].concat(op.shuffle ? [{ op: "shuffle", seat: op.seat }] : []) });
  };
  /** 2974 (Revise#147): "このカードがセットされた場合、≪あなたよりも多くの手札を持つプレイヤー全て≫は、あなたの手札枚数と等しくなるように自分の手札を選んで捨て札する" */
  A.handDownToMine = (ctx, s, e) => {
    const S = ctx.S, mine = S.players[e.seat].zones.hand.length;
    AA4.enqueue(S, AA4.living(S).filter(x => x !== e.seat && S.players[x].zones.hand.length > mine).map(seat => ({ op: "discardDownAsk", seat, n: S.players[seat].zones.hand.length - mine })), true);
  };
  OPS.discardDownAsk = (ctx, op) => { const h = ctx.S.players[op.seat].zones.hand; const n = Math.min(op.n, h.length); if (n > 0) return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: h.slice(), min: n, max: n, auto: false, reason: `Discard ${n} from your hand`, then: [{ op: "toDiscard", seat: op.seat }] }); };
  /** "メインフェイズ開始時に、≪あなたよりも多くのキャラクターを支配しているプレイヤー全て≫は、自分の支配キャラクター1人を捨て札する" */
  A.moreCharsDiscard = (ctx, s, e) => {
    const S = ctx.S, mine = AA4.controlledOf(S, e.seat).length;
    AA4.enqueue(S, AA4.living(S).filter(x => x !== e.seat && AA4.controlledOf(S, x).length > mine).map(seat => ({ op: "ownCharDiscardAsk", seat })), true);
  };
  OPS.ownCharDiscardAsk = (ctx, op) => { const S = ctx.S, l = AA4.controlledOf(S, op.seat); if (l.length) return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: l.map(id => AA4.topOf(S.chars[id])), min: 1, max: 1, reason: "Discard one of your Controlled Characters", then: [{ op: "discardOwnGo" }] }); };
  /** 3386 (Revise#147): "≪あなたの任意のプレイヤー1人≫の手札全てを見て、その中の極星帝国のカード1枚を捨て札可能" */
  A.peekHandDiscard = (ctx, s, e) => {
    const S = ctx.S, opts = AA4.living(S);
    if (s.who === "attacked") { const w = S.battle && S.battle.target && S.battle.target.seat; return w != null ? OPS.peekHandGo(ctx, { seat: e.seat, sel: s.sel || {}, answer: [String(w)] }) : undefined; }   // EP359
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts.map(String), labels: opts.map(x => S.players[x].name + (x === e.seat ? " (you)" : "")), reason: "Choose a player: you see their hand", then: [{ op: "peekHandGo", seat: e.seat, sel: s.sel || {} }] });
  };
  /** 0958 (Revise#360): "≪プレイヤー1人≫の手札を見て、ネームを持つカードをX枚まで捨て札する" — the player is a target */
  A.peekHandDiscardT = (ctx, s, e, r) => {
    const S = ctx.S, t = seats(r)[0], p = t != null && S.players[t]; if (!p) return;
    AA4.revealTo(S, p.zones.hand, e.seat);
    const n = nOf(s, e), opts = p.zones.hand.filter(id => { const inf = ctx.db.card(S.cards[id].key) || {}; return (s.sel && s.sel.named != null ? !!inf.name === s.sel.named : true); });
    if (n <= 0 || !opts.length) return ctx.emit({ e: "note", text: "No card to discard there" });
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 0, max: Math.min(n, opts.length), auto: false, reason: `You may discard up to ${Math.min(n, opts.length)} of these`, then: [{ op: "toDiscard", seat: t }] });
  };
  OPS.peekHandGo = (ctx, op) => {
    const S = ctx.S, t = +((op.answer || [])[0]), p = S.players[t];
    if (!p) return;
    AA4.revealTo(S, p.zones.hand, op.seat);
    const opts = p.zones.hand.filter(id => AA4.cardSelOk(ctx.db.card(S.cards[id].key) || {}, op.sel));
    if (!opts.length) return ctx.emit({ e: "note", text: "No card to discard there" });
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: opts, min: 0, max: 1, auto: false, reason: "You may discard one of these", then: [{ op: "toDiscard", seat: t }] });
  };
  /** 3261: "≪あなたのダメージ置き場と捨て札置き場にある、このカードと同じネームを持つカード全て≫をあなたの手札に戻す" */
  A.sameNamePilesToHand = (ctx, s, e) => {
    const S = ctx.S, nm = e.card && (ctx.db.card(S.cards[e.card].key) || {}).name;
    if (!nm) return;
    for (const z of ["damage", "discard"]) for (const id of S.players[e.seat].zones[z].slice()) if ((ctx.db.card(S.cards[id].key) || {}).name === nm) AA4.moveCard(ctx, id, { z: "hand" });
  };
  /** 3682 (Revise#148): "あなたは、目標の≪デッキ≫の上からカードを3枚見る。その後、そのカードの中からあなたの任意の枚数をそのデッキの一番下に置くことが可能" */
  A.peekTopBottom = (ctx, s, e, r) => {
    const S = ctx.S, seat = (seats(r)[0] != null ? seats(r)[0] : e.seat), d = S.players[seat] && S.players[seat].zones.deck;
    if (!d || !d.length) return;
    const k = s.n === "X" ? +e.x || 0 : s.n || 3; if (k <= 0) return;   // n "X" (EX0177, Revise#355)
    const top = d.slice(-k).reverse();
    AA4.revealTo(S, top, e.seat);
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: top, min: 0, max: top.length, auto: false, reason: "You may put any of them on the bottom of that deck (the rest stay on top)", then: [{ op: "peekBottomGo", seat, top, orderBy: s.thenOrder ? e.seat : null }] });
  };
  OPS.peekBottomGo = (ctx, op) => { const S = ctx.S, d = S.players[op.seat].zones.deck; for (const id of op.answer || []) { const i = d.indexOf(id); if (i >= 0) { d.splice(i, 1); d.unshift(id); } } for (const id of op.top) if (S.cards[id] && S.cards[id].place.z === "deck") S.cards[id].visibleTo = []; if (op.orderBy != null) AA4.enqueue(S, [{ op: "peekOrderRest", seat: op.seat, by: op.orderBy, top: op.top }], true); };
  OPS.peekOrderRest = (ctx, op) => {   // the cards left on top, in the order you like (EX0177)
    const S = ctx.S, d = S.players[op.seat].zones.deck, rest = op.top.filter(id => d.slice(-op.top.length).includes(id));
    if (!op.answer) { if (rest.length < 2) return; for (const id of rest) if (!S.cards[id].visibleTo.includes(op.by)) S.cards[id].visibleTo.push(op.by); return AA4.ask(ctx, { seat: op.by, kind: "order", options: rest, auto: false, reason: "Order the cards that stay on top (the first one ends up on top)", then: [Object.assign({}, op)] }); }
    const ord = (op.answer || []).filter(id => d.includes(id));
    for (const id of ord) d.splice(d.indexOf(id), 1);
    for (const id of ord.slice().reverse()) d.push(id);
    for (const id of op.top) if (S.cards[id] && S.cards[id].place.z === "deck") S.cards[id].visibleTo = [];
  };
  /** 0676 (Revise#355): "目標の≪パーマネントカード1枚≫を、目標のオーナーのテリトリーのブレイクしているキャラクター1人に、パワーカードとしてセットする" — you choose the character */
  A.permToPowerPick = (ctx, s, e, r) => {
    const S = ctx.S, x = r.find(y => y.card && S.cards[y.card] && S.cards[y.card].place.z === "char"); if (!x) return;
    const owner = S.cards[x.card].owner, opts = AA4.charsOf(S, owner).filter(id => AA4.charStats(S, ctx.db, id).broken);
    if (!opts.length) return ctx.emit({ e: "note", text: "No Broken character in that player's territory: nothing happens" });
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 1, max: 1, reason: "Choose the Broken character that gets it as a power card", then: [{ op: "permToPowerGo", card: x.card }] });
  };
  OPS.permToPowerGo = (ctx, op) => {
    const S = ctx.S, c = AA4.charOfCard(S, (op.answer || [])[0]), k = S.cards[op.card];
    if (!c || !k || k.place.z !== "char") return;
    for (const m of S.modifiers.filter(m => m.src && m.src.card === op.card)) AA4.endMod(ctx, m.id);
    AA4.moveCard(ctx, op.card, { z: "char", ch: c.id, role: "power" });
  };
  /** A3-24 3507: show as many cards from your deck top as you control characters with ▼ or Remove; the unnamed Character / Break cards with ▼ or
      Remove among them become your Controlled Characters, then one named Break card (no break condition, Factor met) with ▼ or Remove; shuffle */
  A.aggroReveal = (ctx, s, e) => {
    const S = ctx.S, has = sk => !!(sk && (sk.aggressive || sk.remove != null)), cardHas = inf => has(inf.skills) || !!inf.aggressive;
    const n = AA4.controlledOf(S, e.seat).filter(id => has(AA4.charStats(S, ctx.db, id).skills)).length, top = S.players[e.seat].zones.deck.slice(-n).reverse();
    ctx.emit({ e: "note", text: `Shown (${n}): ${top.map(id => AA4.cardName(ctx.db.card(S.cards[id].key) || {})).join(", ") || "nothing"}` });
    const named = [];
    for (const id of top) { const inf = ctx.db.card(S.cards[id].key) || {}; if (!cardHas(inf)) continue;
      if (!inf.name && (inf.type === "Character" || inf.type === "Break")) OPS.toBack(ctx, { answer: [id] });
      else if (inf.name && inf.type === "Break" && !inf.breakRule && !AA4.factorOk(S, ctx.db, e.seat, inf) && !AA4.nameOnField(S, ctx.db, inf.name)) named.push(id); }
    const ops = [{ op: "shuffle", seat: e.seat }];
    if (named.length === 1) OPS.toBack(ctx, { answer: named });
    else if (named.length > 1) ops.unshift({ op: "aggroRevealPick", seat: e.seat, opts: named });
    AA4.enqueue(S, ops, true);
  };
  OPS.aggroRevealPick = (ctx, op) => AA4.ask(ctx, { seat: op.seat, kind: "cards", options: op.opts.filter(id => ctx.S.cards[id].place.z === "deck"), min: 1, max: 1, auto: false, reason: "Choose one named Break card — it becomes your Controlled Character", then: [{ op: "toBack" }] });
  /** A4-03 0416: by the cards of that faction in your Discard Pile — 10+: any card of the faction from your deck to your hand;
      20+: a card of the faction in your hand may be declared without its Factor and cost */
  A.pileTiers = (ctx, s, e) => {
    const S = ctx.S, p = S.players[e.seat], isF = id => (ctx.db.card(S.cards[id].key) || {}).faction === s.faction, n = p.zones.discard.filter(isF).length, ops = [];
    ctx.emit({ e: "note", text: `${s.faction} cards in the Discard Pile: ${n}` });
    if (n >= 10) ops.push({ op: "pileTiersTutor", seat: e.seat, faction: s.faction });
    if (n >= 20) ops.push({ op: "pileTiersDecl", seat: e.seat, faction: s.faction, card: e.card });
    if (ops.length) AA4.enqueue(S, ops, true);
  };
  OPS.pileTiersTutor = (ctx, op) => { const S = ctx.S, opts = S.players[op.seat].zones.deck.filter(id => (ctx.db.card(S.cards[id].key) || {}).faction === op.faction); if (!opts.length) return; return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: opts, min: 1, max: 1, auto: false, reason: `Choose any ${op.faction} card of your deck — it goes to your hand`, then: [{ op: "toOwnerHand" }] }); };
  OPS.pileTiersDecl = (ctx, op) => { const S = ctx.S, ids = S.players[op.seat].zones.hand.filter(id => id !== op.card && (ctx.db.card(S.cards[id].key) || {}).faction === op.faction); if (ids.length) AA4.enqueue(S, [{ op: "effDeclPick", seat: op.seat, ch: null, zones: ["hand"], onlyIds: ids, freeCost: true, ignoreFactor: true }], true); };
  /** A4-03 0446: two name-level characters in one player's Control Area deal their Attack as damage to each other */
  A.mutualHit = (ctx, s, e) => {
    const S = ctx.S, seats = AA4.livingOrder(S).filter(x => namedCtl(S, ctx.db, x).length >= 2); if (!seats.length) return;
    if (seats.length > 1) return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: seats.map(String), labels: seats.map(x => S.players[x].name), reason: `${srcLabel(ctx, e)}: whose Control Area?`, then: [{ op: "mutualHit2", seat: e.seat }] });
    AA4.enqueue(S, [{ op: "mutualHit2", seat: e.seat, answer: [String(seats[0])] }], true);
  };
  OPS.mutualHit2 = (ctx, op) => { const S = ctx.S, opts = namedCtl(S, ctx.db, +(op.answer || [])[0]).map(id => AA4.topOf(S.chars[id])); if (opts.length < 2) return; return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: opts, min: 2, max: 2, auto: false, reason: "Choose two name-level characters: each deals its Attack as damage to the other", then: [{ op: "mutualHitGo" }] }); };
  OPS.mutualHitGo = (ctx, op) => {
    const S = ctx.S, ids = (op.answer || []).map(c => S.cards[c] && S.cards[c].place.z === "char" ? S.cards[c].place.ch : null).filter(Boolean); if (ids.length !== 2) return;
    const dmg = ids.map(id => { const st = AA4.charStats(S, ctx.db, id), n = +st.at || 0; return st.atMental ? { normal: 0, mental: n } : { normal: n, mental: 0 }; });
    AA4.damageChar(ctx, ids[1], Object.assign({ from: ids[0] }, dmg[0])); AA4.damageChar(ctx, ids[0], Object.assign({ from: ids[1] }, dmg[1]));
  };
  /** A3-EX03 EX0311: n damage to `base` characters of your choice, one more for every named card that makes up your “name” */
  A.pickDamagePlus = (ctx, s, e) => {
    const S = ctx.S, nm = x => String(x || "").replace(/\s+/g, "");
    const extra = AA4.controlledOf(S, e.seat).filter(id => nm(AA4.charStats(S, ctx.db, id).name) === nm(s.name)).reduce((k, id) => k + S.chars[id].stack.filter(c => !!(ctx.db.card(S.cards[c].key) || {}).name).length, 0);
    const opts = Object.keys(S.chars).map(id => AA4.topOf(S.chars[id])), lo = Math.min(s.base, opts.length), hi = Math.min(s.base + extra, opts.length); if (!hi) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: lo, max: hi, auto: false, reason: `${srcLabel(ctx, e)}: choose ${lo}${hi > lo ? " to " + hi : ""} characters — ${s.n} damage each`, then: [{ op: "pickDamageGo", n: s.n, from: e.ch || null }] });
  };
  /** A4-EX02 EX916: declared Project / Fast cards of your choice are discarded */
  A.cancelPicked = (ctx, s, e) => {
    const S = ctx.S, items = S.stack.filter(it => it.kind === "set" && it.card && S.cards[it.card] && (s.types || []).includes((ctx.db.card(S.cards[it.card].key) || {}).type)); if (!items.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: items.map(it => it.card), min: 0, max: items.length, auto: false, reason: `${srcLabel(ctx, e)}: choose the declared Project / Fast cards to discard (any number)`, then: [{ op: "cancelPickedGo", e: { seat: e.seat, card: e.card, ch: e.ch } }] });
  };
  OPS.cancelPickedGo = (ctx, op) => { const S = ctx.S, r = (op.answer || []).map(c => S.stack.find(it => it.card === c)).filter(Boolean).map(it => ({ item: it.id })); if (r.length) A.cancelItem(ctx, {}, op.e, r); };
  /** A4-04 0711: a class of the target is named — Intercept, ±0/+X/+X (X = your Controlled Characters with that class); X ≥ 10: Breakthrough, Initiative */
  A.classRally = (ctx, s, e, r) => {
    const S = ctx.S, id = chars(r)[0]; if (!id || !S.chars[id]) return;
    const icons = [...new Set(AA4.charStats(S, ctx.db, id).icons || [])]; if (!icons.length) return;
    const count = ic => AA4.controlledOf(S, e.seat).filter(c => (AA4.charStats(S, ctx.db, c).icons || []).includes(ic)).length;
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: icons, labels: icons.map(i => `${i} (X = ${count(i)})`), reason: `${srcLabel(ctx, e)}: name a class of the target`, then: [{ op: "classRallyGo", e: { seat: e.seat, card: e.card, ch: e.ch, eid: e.eid }, ch: id, until: s.until || "turn", big: s.big }] });
  };
  OPS.classRallyGo = (ctx, op) => {
    const S = ctx.S, ic = (op.answer || [])[0]; if (!ic || !S.chars[op.ch]) return;
    const x = AA4.controlledOf(S, op.e.seat).filter(c => (AA4.charStats(S, ctx.db, c).icons || []).includes(ic)).length, give = idk => mod(ctx, op.e, { to: { ch: op.ch }, key: "skill", op: "grant", value: { id: idk, x: true }, until: op.until });
    give("intercept"); for (const k of ["at", "de"]) mod(ctx, op.e, { to: { ch: op.ch }, key: k, op: "add", value: x, until: op.until });
    if (x >= op.big) { give("breakthrough"); give("initiative"); }
  };
  /** A4-04 0774: a Character card of the faction you control second most, from your deck, becomes your Controlled Character */
  A.secondFactionSet = (ctx, s, e) => {
    const S = ctx.S, n = {}; for (const id of AA4.controlledOf(S, e.seat)) { const f = AA4.charStats(S, ctx.db, id).faction; if (f) n[f] = (n[f] || 0) + 1; }
    const fs = Object.keys(n).sort((x, y) => n[y] - n[x]); if (fs.length < 2) { ctx.emit({ e: "note", text: "You control characters of one faction only — no second faction" }); return; }
    const second = fs.filter(f => n[f] === n[fs[1]]);
    const onlyIds = S.players[e.seat].zones.deck.filter(id => { const inf = ctx.db.card(S.cards[id].key) || {}; return inf.type === "Character" && second.includes(inf.faction); });
    if (!onlyIds.length) return;
    return A.pickZone(ctx, { a: "pickZone", to: "you", dest: "back", zones: ["deck"], owner: "you", sel: { onlyIds }, n: 1, upTo: false }, e);
  };
  /** A3-EX03 EX0326 / A3-EX04 EX0484: every player names a Name of that series and takes back one card from the Damage Pile and one from the Discard
      Pile that has that Name or has it in its text */
  const nmOf = x => String(x || "").replace(/\s+/g, "");
  const nameHit = (inf, name) => nmOf(inf.name) === name || nmOf(inf.text).includes(name);
  A.nameRetrieve = (ctx, s, e) => { const S = ctx.S, order = AA4.livingOrder(S), i = order.indexOf(e.seat), seats = i < 0 ? order : order.slice(i).concat(order.slice(0, i)); AA4.enqueue(S, seats.map(seat => ({ op: "nameRetrieveAsk", seat, works: s.works })), true); };
  OPS.nameRetrieveAsk = (ctx, op) => {
    const S = ctx.S, p = S.players[op.seat], pile = p.zones.damage.concat(p.zones.discard).map(id => ctx.db.card(S.cards[id].key) || {});
    if (!AA4._worksNames) AA4._worksNames = {};
    const all = AA4._worksNames[op.works] || (AA4._worksNames[op.works] = [...new Set(ctx.db.all().filter(c => c.name && AA4.worksOf(c, op.works)).map(c => nmOf(c.name)))]);
    const names = all.filter(n => pile.some(inf => nameHit(inf, n))); if (!names.length) return;
    return AA4.ask(ctx, { seat: op.seat, kind: "pick", options: names, labels: names, reason: "Name a character of that series: one card with that Name (or naming it) comes back from your Damage Pile and one from your Discard Pile", then: [{ op: "nameRetrieveGo", seat: op.seat }] });
  };
  OPS.nameRetrieveGo = (ctx, op) => {
    const S = ctx.S, name = (op.answer || [])[0], p = S.players[op.seat]; if (!name) return;
    const ops = ["damage", "discard"].map(z => ({ z, opts: p.zones[z].filter(id => nameHit(ctx.db.card(S.cards[id].key) || {}, name)) })).filter(x => x.opts.length).map(x => ({ op: "nameRetrievePick", seat: op.seat, opts: x.opts, z: x.z }));
    if (ops.length) AA4.enqueue(S, ops, true);
  };
  OPS.nameRetrievePick = (ctx, op) => AA4.ask(ctx, { seat: op.seat, kind: "cards", options: op.opts.filter(id => ctx.S.cards[id].place.z === op.z), min: 1, max: 1, reason: `Choose the card of your ${op.z === "damage" ? "Damage" : "Discard"} Pile to take back`, then: [{ op: "toOwnerHand" }] });
  A.discardUnlessIcon = (ctx, s, e, r) => { const S = ctx.S; for (const id of chars(r)) if (S.chars[id] && !(AA4.charStats(S, ctx.db, id).icons || []).some(i => s.icons.includes(i))) AA4.removeChar(ctx, id, { to: "discard", why: `discarded by ${srcLabel(ctx, e)}` }); };   // A4-04 0710
  A.discardTokens = (ctx, s, e) => { const S = ctx.S; for (const id of Object.keys(S.chars)) if (S.chars[id] && AA4.charStats(S, ctx.db, id).tokenName === s.name) AA4.removeChar(ctx, id, { to: "discard", why: `${s.name}: the Main Phase ends` }); };   // A3-EX02 EX0156
  /** A3-EX02 EX0131: +X/+X/+X, X = your Controlled Characters that share a class with the target */
  A.sameIconBoost = (ctx, s, e, r) => {
    const S = ctx.S;
    for (const id of chars(r)) { if (!S.chars[id]) continue; const ic = AA4.charStats(S, ctx.db, id).icons || [], x = AA4.controlledOf(S, e.seat).filter(c => (AA4.charStats(S, ctx.db, c).icons || []).some(i => ic.includes(i))).length;
      if (x > 0) for (const k of ["se", "at", "de"]) mod(ctx, e, { to: { ch: id }, key: k, op: "add", value: x, until: s.until || "main" }); }
  };
  /** A3-EX02 EX0184: "≪このカード以外の、このカードと同じ名称のカード≫は効果を発揮しない" — they cannot be declared */
  A.banSameJp = (ctx, s, e) => { const c = e.card && ctx.S.cards[e.card], jp = c ? (ctx.db.card(c.key) || {}).jp : null; if (jp) mod(ctx, e, { to: { players: "all" }, key: "ban", op: "grant", value: { decl: "set", name: jp }, until: s.until || "main" }); };
  /** A4-03 0413: unnamed characters −1 / −1 and +(1) / −1, never under 1; name-level characters +1 / +(1) / +1 — the characters on the field now */
  A.shiftFloor = (ctx, s, e) => {
    const S = ctx.S, until = s.until || "main";
    for (const id of Object.keys(S.chars)) { const st = AA4.charStats(S, ctx.db, id);
      if (st.named) { for (const k of ["se", "atm", "de"]) mod(ctx, e, { to: { ch: id }, key: k, op: "add", value: 1, until }); continue; }
      for (const k of ["se", "at", "de"]) { const cur = +st[k]; if (st[k] == null || !(cur > 1) || (k === "at" && st.atMental)) continue; mod(ctx, e, { to: { ch: id }, key: k, op: "add", value: -1, until }); }
      mod(ctx, e, { to: { ch: id }, key: "atm", op: "add", value: 1, until });
    }
  };
  /** A4-02 0248: a card type is named; the top n cards of your deck are shown — those of that type go to your hand, the deck is shuffled */
  A.typeReveal = (ctx, s, e) => { const types = ["Character", "Break", "Permanent", "Project", "Fast"]; return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: types, labels: types, reason: `${srcLabel(ctx, e)}: name a card type`, then: [{ op: "typeRevealGo", seat: e.seat, n: s.n }] }); };
  OPS.typeRevealGo = (ctx, op) => {
    const S = ctx.S, ty = (op.answer || [])[0], top = S.players[op.seat].zones.deck.slice(-op.n).reverse();
    ctx.emit({ e: "note", text: `Named: ${ty}. Shown: ${top.map(id => AA4.cardName(ctx.db.card(S.cards[id].key) || {})).join(", ") || "nothing"}` });
    for (const id of top) if ((ctx.db.card(S.cards[id].key) || {}).type === ty) AA4.moveCard(ctx, id, { z: "hand", seat: op.seat }, { faceUp: true });
    AA4.OPS.shuffle(ctx, { seat: op.seat });
  };
  /** A4-02 0312: discard any number of Break cards of your hand; for each, a Break card of your deck sharing a class with it comes to your hand */
  A.breakExchange = (ctx, s, e) => {
    const S = ctx.S, opts = S.players[e.seat].zones.hand.filter(id => (ctx.db.card(S.cards[id].key) || {}).type === "Break" && id !== e.card); if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 0, max: opts.length, auto: false, reason: `${srcLabel(ctx, e)}: discard any number of Break cards of your hand`, then: [{ op: "breakExchangeGo", seat: e.seat }] });
  };
  OPS.breakExchangeGo = (ctx, op) => {
    const S = ctx.S, ops = [];
    for (const id of op.answer || []) { if (!S.cards[id] || S.cards[id].place.z !== "hand") continue; const icons = ((ctx.db.card(S.cards[id].key) || {}).icons || []).slice(); AA4.moveCard(ctx, id, { z: "discard" }); ops.push({ op: "breakExchangePick", seat: op.seat, icons }); }
    if (ops.length) AA4.enqueue(S, ops.concat([{ op: "shuffle", seat: op.seat }]), true);
  };
  OPS.breakExchangePick = (ctx, op) => {
    const S = ctx.S, opts = S.players[op.seat].zones.deck.filter(id => { const inf = ctx.db.card(S.cards[id].key) || {}; return inf.type === "Break" && (inf.icons || []).some(i => op.icons.includes(i)); });
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: opts, min: 1, max: 1, auto: false, reason: `Choose a Break card of your deck with the class ${op.icons.join(" / ")}`, then: [{ op: "toOwnerHand" }] });
  };
  /** A4-EP EP511: the target's next attack on a player — after the damage check, the top card (2 for a シーフ系 character of Factor 5 or more) of that
      player's deck goes to the Damage Pile */
  A.nextHitMill = (ctx, s, e, r) => {
    const S = ctx.S;
    for (const id of chars(r)) { if (!S.chars[id]) continue; const top = ctx.db.card(S.cards[AA4.topOf(S.chars[id])].key) || {}, big = (top.tags || []).includes(s.tag) && Object.values(top.factor || {}).reduce((a, b) => a + b, 0) >= s.factorMin;
      mod(ctx, e, { to: { ch: id }, key: "playerHit", op: "grant", value: { once: true, effect: { steps: [{ a: "mill", to: "attackedPlayer", n: big ? s.alt : s.n, zone: "damage" }], status: "auto" } }, until: s.until || "turn" }); }
  };
  /** A4-02 0280: the power cards of a character that guards the target's attack go back to the hand; “name”: its battle opponent's skills are off too */
  A.guardStripT = (ctx, s, e, r) => {
    const S = ctx.S, nm = x => String(x || "").replace(/\s+/g, "");
    for (const id of chars(r)) { if (!S.chars[id]) continue; mod(ctx, e, { to: { ch: id }, key: "guardStrip", op: "grant", value: true, until: s.until || "turn" });
      if (nm(AA4.charStats(S, ctx.db, id).name) === nm(s.name) && A.battleOppOffT) A.battleOppOffT(ctx, { until: s.until || "turn" }, e, [{ ch: id }]); }
  };
  /** A3-24 3540: the top card of your deck is shown; a Character card or a Break card without a break condition becomes your Controlled Character —
      a named one then costs the top 5 cards of your deck and this card */
  A.revealSetTop = (ctx, s, e) => {
    const S = ctx.S, deck = S.players[e.seat].zones.deck; if (!deck.length) return;
    const id = deck[deck.length - 1], inf = ctx.db.card(S.cards[id].key) || {};
    ctx.emit({ e: "note", text: `The top card of the deck: ${AA4.cardName(inf)}` });
    if (!(inf.type === "Character" || (inf.type === "Break" && !inf.breakRule))) return;
    OPS.toBack(ctx, { answer: [id] });
    if (inf.name) { for (let k = 0; k < (s.mill || 0) && deck.length; k++) AA4.moveCard(ctx, deck[deck.length - 1], { z: "discard" }); if (e.card && S.cards[e.card] && S.cards[e.card].place.z === "char") AA4.moveCard(ctx, e.card, { z: "discard" }); }
  };
  /** A3-20 2693: you and one opponent each name a name-level character in the other's Control Area — its power cards return to the owner's hand;
      with no power cards, the Break cards that make it up are discarded */
  const brokenNamed = (S, db, seat) => AA4.controlledOf(S, seat).filter(id => S.chars[id].stack.length > 1 && !!AA4.charStats(S, db, id).named);
  const namedCtl = (S, db, seat) => AA4.controlledOf(S, seat).filter(id => !!AA4.charStats(S, db, id).named);
  A.duelStrip = (ctx, s, e) => {
    const S = ctx.S, opps = AA4.livingOrder(S).filter(x => x !== e.seat && brokenNamed(S, ctx.db, x).length);
    if (!opps.length || !brokenNamed(S, ctx.db, e.seat).length) { ctx.emit({ e: "note", text: "Both players need a broken name-level character — nothing happens" }); return; }
    if (opps.length > 1) return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opps.map(String), labels: opps.map(x => S.players[x].name), reason: `${srcLabel(ctx, e)}: choose the opponent`, then: [{ op: "duelStrip2", seat: e.seat }] });
    AA4.enqueue(S, [{ op: "duelStrip2", seat: e.seat, answer: [String(opps[0])] }], true);
  };
  OPS.duelStrip2 = (ctx, op) => {
    const S = ctx.S, opp = +(op.answer || [])[0], mk = (chooser, owner) => { const o = namedCtl(S, ctx.db, owner).map(id => AA4.topOf(S.chars[id])); return o.length ? { op: "duelStripAsk", seat: chooser, opts: o } : null; };
    AA4.enqueue(S, [mk(op.seat, opp), mk(opp, op.seat)].filter(Boolean), true);
  };
  OPS.duelStripAsk = (ctx, op) => { const opts = op.opts.filter(id => ctx.S.cards[id] && ctx.S.cards[id].place.z === "char"); if (!opts.length) return; return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: opts, min: 1, max: 1, auto: false, reason: "Choose a name-level character of the other player: its power cards go back to the hand (none: its Break cards are discarded)", then: [{ op: "duelStripGo" }] }); };
  OPS.duelStripGo = (ctx, op) => {
    const S = ctx.S, c = S.cards[(op.answer || [])[0]], ch = c && c.place.z === "char" ? S.chars[c.place.ch] : null; if (!ch) return;
    if (ch.power.length) { for (const id of ch.power.slice()) AA4.moveCard(ctx, id, { z: "hand", seat: S.cards[id].owner }); return; }
    for (const id of ch.stack.slice().reverse()) if (S.chars[ch.id] && ((ctx.db.card(S.cards[id].key) || {}).type === "Break" || S.cards[id].asBreak)) AA4.moveCard(ctx, id, { z: "discard" });
  };
  /** A3-20 2802: the named Controlled Characters of the designated player lose all their power cards and go to that player's Active Area */
  A.namedToActive = (ctx, s, e, r) => {
    const S = ctx.S, t = r.find(x => x.seat != null && S.players[x.seat]); if (!t) return;
    for (const id of namedCtl(S, ctx.db, t.seat)) { const ch = S.chars[id]; if (!ch) continue;
      for (const c of ch.power.slice()) AA4.moveCard(ctx, c, { z: "discard" });
      if (S.chars[id]) OPS.moveChar(ctx, { ch: id, to: { area: "active" } }); }
  };
  /** A3-24 3579: every player, you first and then in turn order, takes any card of their own deck into the hand (the deck is shuffled) */
  A.allTutor = (ctx, s, e) => { const S = ctx.S, order = AA4.livingOrder(S), i = order.indexOf(e.seat), seats = i < 0 ? order : order.slice(i).concat(order.slice(0, i)); AA4.enqueue(S, seats.map(seat => ({ op: "allTutorAsk", seat })), true); };
  OPS.allTutorAsk = (ctx, op) => { const deck = ctx.S.players[op.seat].zones.deck; if (!deck.length) return; return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: deck.slice(), min: 1, max: 1, auto: false, reason: "Choose any card of your deck — it goes to your hand", then: [{ op: "allTutorGo", seat: op.seat }] }); };
  OPS.allTutorGo = (ctx, op) => { const id = (op.answer || [])[0]; if (id && ctx.S.cards[id]) AA4.moveCard(ctx, id, { z: "hand", seat: op.seat }); AA4.OPS.shuffle(ctx, { seat: op.seat }); };
  /** A3-09 1352 / A3-14 2029 (M5a): the target Break card in your Damage / Discard Pile may be declared; when it is set, X cards from your deck top
      become its character's power cards. mill: X cards of your deck are discarded first (1352). */
  A.riseBreak = (ctx, s, e, r) => {
    const S = ctx.S, t = r.find(x => x.card), x = +e.x || 0, deck = S.players[e.seat].zones.deck;
    if (s.mill) for (let k = 0; k < x && deck.length; k++) AA4.moveCard(ctx, deck[deck.length - 1], { z: "discard" });
    if (t && S.cards[t.card] && ["damage", "discard"].includes(S.cards[t.card].place.z)) {
      if (x > 0) mod(ctx, e, { to: { seat: e.seat }, key: "onEnterPower", op: "grant", value: { card: t.card, n: x }, until: "turn" });
      AA4.enqueue(S, [{ op: "effDeclPick", seat: e.seat, ch: null, zones: ["damage", "discard"], types: ["Break"], onlyIds: [t.card] }]);
    }
  };
  /** A3-20 2877 (M5a), at the end of the Main Phase: the target is discarded and every character in its area takes X damage (X = the target's Attack) */
  A.blastArea = (ctx, s, e, r) => {
    const S = ctx.S;
    for (const id of chars(r)) { const ch = S.chars[id]; if (!ch) continue;
      const x = +AA4.charStats(S, ctx.db, id).at || 0, owner = ch.owner, ctl = AA4.isControlled(ch);
      AA4.removeChar(ctx, id, { to: "discard", why: `discarded by ${srcLabel(ctx, e)}` });
      if (x > 0) for (const o of AA4.charsOf(S, owner).filter(c => S.chars[c] && AA4.isControlled(S.chars[c]) === ctl)) AA4.damageChar(ctx, o, { normal: x, mental: 0, fromSeat: e.seat });
    }
  };
  /** A3-21 2914 (M5a): your Controlled Character returns to the hand; then a Break card of your hand (unnamed — or named when the character was broken)
      of the same faction, sharing a class with it, becomes your Controlled Character */
  A.swapForBreak = (ctx, s, e, r) => {
    const S = ctx.S, id = chars(r)[0]; if (!id || !S.chars[id]) return;
    const st = AA4.charStats(S, ctx.db, id), fac = st.faction, icons = (st.icons || []).slice(), broken = S.chars[id].stack.length > 1;
    AA4.removeChar(ctx, id, { to: "hand", why: `returned by ${srcLabel(ctx, e)}` });
    const opts = S.players[e.seat].zones.hand.filter(c => { const inf = ctx.db.card(S.cards[c].key) || {}; return inf.type === "Break" && !!inf.name === broken && inf.faction === fac && (inf.icons || []).some(i => icons.includes(i)); });
    if (!opts.length) { ctx.emit({ e: "note", text: `No ${broken ? "named" : "unnamed"} Break card of the same faction and class in the hand` }); return; }
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 1, max: 1, auto: false, reason: `${srcLabel(ctx, e)}: choose a Break card of your hand — it becomes your Controlled Character`, then: [{ op: "toBack" }] });
  };
  /** A3-22 3163 (M5a): a Break card without a break condition from your Damage / Discard Pile becomes your Controlled Character with 1 power card
      from your deck; it is discarded at the end of the Main Phase */
  A.reviveTemp = (ctx, s, e) => {
    const S = ctx.S, p = S.players[e.seat], opts = p.zones.damage.concat(p.zones.discard).filter(c => { const inf = ctx.db.card(S.cards[c].key) || {}; return inf.type === "Break" && !inf.breakRule && c !== e.card; });
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 1, max: 1, auto: false, reason: `${srcLabel(ctx, e)}: choose a Break card — your Controlled Character until the end of the Main Phase`, then: [{ op: "reviveTempGo", seat: e.seat, card: e.card }] });
  };
  OPS.reviveTempGo = (ctx, op) => {
    const S = ctx.S, id = (op.answer || [])[0]; if (!id || !S.cards[id]) return;
    OPS.toBack(ctx, { answer: [id] });
    const ch = AA4.charOfCard(S, id), deck = S.players[op.seat].zones.deck; if (!ch) return;
    if (deck.length) AA4.moveCard(ctx, deck[deck.length - 1], { z: "char", ch: ch.id, role: "power" });
    (S.delayed = S.delayed || []).push({ at: "main", step: { a: "discard", to: "t" }, e: { seat: op.seat, card: op.card, spec: null, targets: [{ ch: ch.id }] } });
  };
  /** A3-24 3400 (M5a): the characters with the class most characters on the field have take no battle damage, and guarding their attacks costs 1 more */
  A.mostIconShield = (ctx, s, e) => {
    const S = ctx.S, n = {}; for (const id of Object.keys(S.chars)) for (const i of new Set(AA4.charStats(S, ctx.db, id).icons || [])) n[i] = (n[i] || 0) + 1;
    const top = Math.max(0, ...Object.values(n)), icons = Object.keys(n).filter(i => n[i] === top); if (!top) return;
    ctx.emit({ e: "note", text: `The most common class: ${icons.join(" / ")} (${top})` });
    for (const id of Object.keys(S.chars)) if ((AA4.charStats(S, ctx.db, id).icons || []).some(i => icons.includes(i))) {
      mod(ctx, e, { to: { ch: id }, key: "noDamage", op: "grant", value: { battle: true }, until: s.until || "turn" });
      mod(ctx, e, { to: { ch: id }, key: "guardTaxVs", op: "add", value: 1, until: s.until || "turn" });
    }
  };
  /** A3-25 3731 (M5a), after pickIcon: battle — your Controlled Characters take no battle damage from characters of that class;
      effects — the characters of that class are not affected by Project cards and effects */
  A.iconShield = (ctx, s, e) => {
    const S = ctx.S, ic = S.effIcon; if (!ic) return;
    if (s.mode === "battle") mod(ctx, e, { to: { all: { owner: "you", area: "controlled" } }, key: "noDamage", op: "grant", value: { battle: true, fromSel: { icons: [ic] } }, until: s.until || "turn" });
    else for (const id of Object.keys(S.chars)) if ((AA4.charStats(S, ctx.db, id).icons || []).includes(ic)) mod(ctx, e, { to: { ch: id }, key: "untargetable", op: "grant", value: { from: ["Project", "Effect"] }, until: s.until || "turn" });
  };
  /** A3-20 2804 (M5a): "目標のパワーが0の場合、さらに、…目標はペネトレイトを得、±0/+X/+Xされる" */
  A.zeroPowerBoost = (ctx, s, e, r) => {
    const S = ctx.S, x = +e.x || 0;
    for (const id of chars(r)) if (S.chars[id] && !S.chars[id].power.length) {
      mod(ctx, e, { to: { ch: id }, key: "skill", op: "grant", value: { id: "penetrate", x: true }, until: s.until || "turn" });
      for (const k of ["at", "de"]) mod(ctx, e, { to: { ch: id }, key: k, op: "add", value: x, until: s.until || "turn" });
    }
  };
  /** A3-25 3766 (M5a): "≪プレイヤー全て≫に6ダメージを与える。その際、各プレイヤーは、自分の手札を1枚、または自分の支配キャラクター1人を捨て札するごとに、
      自分が受けるダメージを-1して判定することが可能。あなたのデッキ枚数が5枚以下の場合、≪あなた≫はこのカードによるダメージを受けない" — in turn order */
  A.dmgBuyDown = (ctx, s, e) => { AA4.enqueue(ctx.S, [{ op: "dmgBuyDownNext", seats: AA4.livingOrder(ctx.S).filter(x => !(x === e.seat && ctx.S.players[x].zones.deck.length <= (s.safeDeck == null ? -1 : s.safeDeck))), n: s.n, card: e.card, from: e.seat }], true); };
  OPS.dmgBuyDownNext = (ctx, op) => {
    const S = ctx.S, seat = op.seats[0]; if (seat == null) return;
    const rest = op.seats.slice(1), p = S.players[seat];
    if (rest.length) AA4.enqueue(S, [Object.assign({}, op, { seats: rest })]);
    if (!p || p.lost) return;
    const opts = p.zones.hand.concat(AA4.controlledOf(S, seat).map(id => AA4.topOf(S.chars[id])));
    if (!opts.length) { AA4.damagePlayer(ctx, seat, { normal: op.n, mental: 0 }, { fromSeat: op.from }); return; }
    return AA4.ask(ctx, { seat, kind: "cards", options: opts, min: 0, max: Math.min(op.n, opts.length), auto: false, reason: `${op.n} damage to you: each hand card or Controlled Character you discard now takes 1 off (choose none to take it all)`, then: [{ op: "dmgBuyDownGo", seat, n: op.n, from: op.from }] }, true);
  };
  OPS.dmgBuyDownGo = (ctx, op) => {
    const S = ctx.S; let k = 0;
    for (const id of op.answer || []) { const c = S.cards[id]; if (!c) continue;
      if (c.place.z === "hand") { AA4.moveCard(ctx, id, { z: "discard" }); k++; }
      else if (c.place.z === "char" && S.chars[c.place.ch]) { AA4.removeChar(ctx, c.place.ch, { to: "discard", why: "discarded to take less damage" }); k++; } }
    if (op.n - k > 0) AA4.damagePlayer(ctx, op.seat, { normal: op.n - k, mental: 0 }, { fromSeat: op.from });
  };
  /** A3-22 3167 (M5a): Defense +n; with a “name” card in your Control Area or Damage Pile: +alt and no mental damage */
  A.deUpNameAlt = (ctx, s, e, r) => {
    const S = ctx.S, nm = x => String(x || "").replace(/\s+/g, ""), has = AA4.controlledOf(S, e.seat).some(id => { const st = AA4.charStats(S, ctx.db, id); return nm(st.name) === s.name || (st.alsoNames || []).map(nm).includes(s.name); })
      || S.players[e.seat].zones.damage.some(id => nm((ctx.db.card(S.cards[id].key) || {}).name) === s.name);
    for (const ch of chars(r)) { mod(ctx, e, { to: { ch }, key: "de", op: "add", value: has ? s.alt : s.n, until: s.until }); if (has) mod(ctx, e, { to: { ch }, key: "noDamage", op: "grant", value: { mental: true }, until: s.until }); }
  };
  /** A3-18 2436 (M5a): a Project / Fast card in the target player's Damage or Discard Pile is named → X damage, X = its required Factor + its cost */
  A.pileCardDamage = (ctx, s, e, r) => {
    const S = ctx.S, t = r.find(x => x.seat != null && S.players[x.seat]); if (!t) return;
    const opts = ["damage", "discard"].flatMap(z => S.players[t.seat].zones[z]).filter(id => ["Project", "Fast"].includes((ctx.db.card(S.cards[id].key) || {}).type));
    if (!opts.length) { ctx.emit({ e: "note", text: "No Project or Fast card in that player's Damage or Discard Pile — no damage" }); return; }
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 1, max: 1, auto: false, reason: `${srcLabel(ctx, e)}: choose a Project or Fast card of ${S.players[t.seat].name} — damage = its required Factor + its cost`, then: [{ op: "pileCardDamageGo", seat: t.seat, from: e.seat }] }, true);
  };
  OPS.pileCardDamageGo = (ctx, op) => {
    const S = ctx.S, c = S.cards[(op.answer || [])[0]]; if (!c) return;
    const inf = ctx.db.card(c.key) || {}, x = Object.values(inf.factor || {}).reduce((a, b) => a + b, 0) + (typeof inf.cost === "number" ? inf.cost : 0);
    ctx.emit({ e: "note", text: `${AA4.cardName(inf)}: Factor + cost = ${x}` });
    if (x > 0) AA4.damagePlayer(ctx, op.seat, { normal: x, mental: 0 }, { fromSeat: op.from });
  };
  /** A3-20 2730 (M5a): the designated player names a faction and a card type; the top n cards of that player's deck are shown — the cards of that
      faction and type go to the owner's hand, the others to the Discard Pile */
  A.nameAndReveal = (ctx, s, e, r) => {
    const S = ctx.S, t = r.find(x => x.seat != null && S.players[x.seat]); if (!t) return;
    const facs = AA4.FACTIONS.map(f => f.name);
    return AA4.ask(ctx, { seat: t.seat, kind: "pick", options: facs, labels: facs, reason: `${srcLabel(ctx, e)}: name a faction`, then: [{ op: "nameAndReveal2", seat: t.seat, n: s.n }] }, true);
  };
  OPS.nameAndReveal2 = (ctx, op) => { const types = ["Character", "Break", "Permanent", "Project", "Fast"]; return AA4.ask(ctx, { seat: op.seat, kind: "pick", options: types, labels: types, reason: `Name a card type (faction: ${(op.answer || [])[0]})`, then: [{ op: "nameAndReveal3", seat: op.seat, n: op.n, fac: (op.answer || [])[0] }] }, true); };
  OPS.nameAndReveal3 = (ctx, op) => {
    const S = ctx.S, ty = (op.answer || [])[0], deck = S.players[op.seat].zones.deck, top = deck.slice(-op.n).reverse();
    ctx.emit({ e: "note", text: `${S.players[op.seat].name} names ${op.fac} · ${ty}. Shown: ${top.map(id => AA4.cardName(ctx.db.card(S.cards[id].key) || {})).join(", ") || "nothing"}` });
    for (const id of top) { const inf = ctx.db.card(S.cards[id].key) || {}; AA4.moveCard(ctx, id, inf.faction === op.fac && inf.type === ty ? { z: "hand", seat: op.seat } : { z: "discard" }, { faceUp: true }); }
  };
  /** A3-22 3308 (M5a): a Character card of your Discard Pile becomes your Controlled Character; with 30 cards or fewer in your deck an unnamed Break
      card whose Factor you meet may be chosen too; with 15 or fewer also a named Break card without a break condition */
  A.reviveByDeck = (ctx, s, e) => {
    const S = ctx.S, p = S.players[e.seat], n = p.zones.deck.length;
    const ok = id => { const inf = ctx.db.card(S.cards[id].key) || {}; if (inf.type === "Character") return true; if (inf.type !== "Break" || AA4.factorOk(S, ctx.db, e.seat, inf)) return false; return (!inf.name && n <= 30) || (!!inf.name && !inf.breakRule && n <= 15); };
    const onlyIds = p.zones.discard.filter(ok); if (!onlyIds.length) return;
    return A.pickZone(ctx, { a: "pickZone", to: "you", dest: "back", zones: ["discard"], owner: "you", sel: { onlyIds }, n: 1, upTo: false }, e);
  };
  /** A3-22 3131 (M5a): "目標の≪使用宣言中のカード1枚≫を、オーナーの手札に戻す" */
  A.itemToHand = (ctx, s, e, r) => {
    const S = ctx.S;
    for (const x of r.filter(y => y.item)) {
      const i = S.stack.findIndex(it => it.id === x.item);
      if (i < 0) continue;
      if (AA4.itemShielded(ctx, S.stack[i], e)) { ctx.emit({ e: "note", text: "It is not affected (シールド: Fast cards and other effects)" }); continue; }
      const it = S.stack[i], c = it.card && S.cards[it.card];
      if (!c || it.kind !== "set" || c.place.z === "char") continue;
      S.stack.splice(i, 1);
      AA4.moveCard(ctx, it.card, { z: "hand", seat: c.owner });
      ctx.emit({ e: "itemCancelled", item: it.id, by: e.card });
    }
  };
  /** Cards that grow with each copy on the same character (M5a). 3768: "攻撃力に+X … Xは目標に効果を発揮している、このカードと同じ名称のカードの枚数" —
      every copy's bonus = the number of copies. 2204: a flat bonus per copy, and more effects from 2 / 3 / 4 copies (tiers). */
  A.stackSame = (ctx, s, e, r) => {
    const S = ctx.S, jp = e.card && S.cards[e.card] ? (ctx.db.card(S.cards[e.card].key) || {}).jp : null; if (!jp) return;
    for (const ch of chars(r)) {
      if (!S.chars[ch]) continue;
      const old = S.modifiers.filter(m => m.stk === jp && m.to && m.to.ch === ch && !m.tier), n = old.length + 1;
      if (!s.flat) for (const m of old) m.value = n;
      mod(ctx, e, { to: { ch }, key: s.key, op: "add", value: s.flat || n, until: s.until || "turn", stk: jp });
      for (const [k, list] of Object.entries(s.tiers || {})) if (n >= +k && !S.modifiers.some(m => m.stk === jp && m.to && m.to.ch === ch && m.tier === +k))
        for (const t of list) mod(ctx, e, Object.assign({ to: { ch }, until: s.until || "turn", stk: jp, tier: +k }, t));
      AA4.touch(S);
    }
  };
  /** EX0159 (Revise#355): "目標の、≪対戦相手の使用宣言中の…カード1枚≫を、そのオーナーのデッキに戻し、そのデッキをシャッフルする。その後、目標のオーナーはXドローすることが可能。Xは目標のコストに等しい" */
  A.itemToDeck = (ctx, s, e, r) => {
    const S = ctx.S;
    for (const x of r.filter(y => y.item)) {
      const i = S.stack.findIndex(it => it.id === x.item);
      if (i < 0) continue;
      if (AA4.itemShielded(ctx, S.stack[i], e)) { ctx.emit({ e: "note", text: "It is not affected (シールド: Fast cards and other effects)" }); continue; }
      const [it] = S.stack.splice(i, 1), c = it.card && S.cards[it.card];
      if (!c || it.kind !== "set" || c.place.z === "char") continue;
      const inf = ctx.db.card(c.key) || {}, cost = typeof inf.cost === "number" ? inf.cost : +it.x || 0, owner = c.owner;
      AA4.moveCard(ctx, it.card, { z: "deck", seat: owner });
      ctx.emit({ e: "itemCancelled", item: it.id, by: e.card });
      OPS.shuffle(ctx, { seat: owner });
      if (s.drawCost && cost > 0) AA4.enqueue(S, [{ op: "mayDrawAsk", seat: owner, n: cost }], true);
    }
  };
  /** 3342: "≪あなたの任意のキャラクター1人≫に+2/+2/+2または-1/-1/-1する" — choose the character, then which */
  A.pickCharChoiceMod = (ctx, s, e) => {
    const S = ctx.S, opts = Object.keys(S.chars);
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 1, max: 1, reason: "Choose a character", then: [{ op: "pickCharChoiceGo", seat: e.seat, ch: e.ch, card: e.card, choices: s.choices, until: s.until || "turn" }] });
  };
  OPS.pickCharChoiceGo = (ctx, op) => {
    const c = (op.answer || [])[0] && AA4.charOfCard(ctx.S, op.answer[0]);
    if (!c) return;
    return AA4.ask(ctx, { seat: op.seat, kind: "pick", options: op.choices.map((x, i) => String(i)), labels: op.choices.map(x => x.map(n => (n >= 0 ? "+" : "") + n).join("/")), reason: "Choose", then: [{ op: "pickCharChoiceSet", seat: op.seat, ch: op.ch, card: op.card, target: c.id, choices: op.choices, until: op.until }] });
  };
  OPS.pickCharChoiceSet = (ctx, op) => { const v = op.choices[+((op.answer || [])[0])]; if (v && ctx.S.chars[op.target]) ["se", "at", "de"].forEach((k, i) => { if (v[i]) mod(ctx, op, { to: { ch: op.target }, key: k, op: "add", value: v[i], until: op.until }); }); };
  /** 3260: "≪プレイヤー全て≫のデッキの上から、カードをX枚捨て札する。Xはそれぞれのデッキ枚数の3分の1に等しい。その際、端数は切り捨てて判定する" */
  A.millThird = (ctx, s, e) => { const S = ctx.S; for (const seat of AA4.living(S)) { const d = S.players[seat].zones.deck, n = Math.floor(d.length / 3); for (let k = 0; k < n && d.length; k++) AA4.moveCard(ctx, d[d.length - 1], { z: "discard" }); } };
  /** 2972: "あなたのメインフェイズ開始時に、≪あなたのダメージ置き場のカードX枚と、あなたの手札のカードX枚≫を入れ替えることが可能" */
  A.swapDamageHand = (ctx, s, e) => {
    const S = ctx.S, p = S.players[e.seat];
    if (!p.zones.damage.length || !p.zones.hand.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: p.zones.damage.slice(), min: 0, max: Math.min(p.zones.damage.length, p.zones.hand.length), auto: false, reason: "You may choose Damage Pile cards to swap with as many hand cards", then: [{ op: "swapDHGo", seat: e.seat }] });
  };
  OPS.swapDHGo = (ctx, op) => {
    const S = ctx.S, p = S.players[op.seat], dm = (op.answer || []).filter(id => S.cards[id] && S.cards[id].place.z === "damage");
    if (!dm.length) return;
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: p.zones.hand.slice(), min: dm.length, max: dm.length, auto: false, reason: `Choose ${dm.length} hand card${dm.length === 1 ? "" : "s"} → your Damage Pile`, then: [{ op: "swapDHFin", seat: op.seat, dm }] });
  };
  OPS.swapDHFin = (ctx, op) => { const S = ctx.S; for (const id of op.answer || []) AA4.moveCard(ctx, id, { z: "damage" }); for (const id of op.dm) if (S.cards[id].place.z === "damage") AA4.moveCard(ctx, id, { z: "hand" }); };
  /** 3718: "このカードがセットされた場合、≪あなたの任意の勢力エリア1つのキャラクター全て≫を捨て札する" — one faction slot of your Active Area */
  A.factionAreaWipe = (ctx, s, e) => {
    const S = ctx.S, slots = [...new Set(AA4.charsOf(S, e.seat).filter(id => S.chars[id].at.area === "active").map(id => S.chars[id].at.slot))];
    if (!slots.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: slots.map(String), labels: slots.map(x => String(x)), reason: "Choose one of your faction areas: every character there is discarded", then: [{ op: "factionAreaGo", seat: e.seat }] });
  };
  OPS.factionAreaGo = (ctx, op) => { const S = ctx.S, sl = (op.answer || [])[0]; for (const id of AA4.charsOf(S, op.seat).filter(id => S.chars[id].at.area === "active" && String(S.chars[id].at.slot) === sl)) AA4.defeat(ctx, id, { why: "its faction area was wiped (3718)" }); };
  /** 3607 … (Revise#149): "このカードがセットされた際に、対戦相手のテリトリーに極星帝国のキャラクターがいる場合、≪あなたの任意の、そのプレイヤーの手札1枚≫を捨て札し、≪あなた≫は1ドロー可能" */
  A.factionOppHandHit = (ctx, s, e) => {
    const S = ctx.S, opps = AA4.living(S).filter(x => x !== e.seat && AA4.charsOf(S, x).some(id => AA4.charStats(S, ctx.db, id).faction === s.faction) && S.players[x].zones.hand.length);
    if (!opps.length) return;
    if (opps.length === 1) return OPS.factionHandGo(ctx, { seat: e.seat, answer: [String(opps[0])] });
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opps.map(String), labels: opps.map(x => S.players[x].name), reason: "Choose the player", then: [{ op: "factionHandGo", seat: e.seat }] });
  };
  OPS.factionHandGo = (ctx, op) => {
    const S = ctx.S, t = +((op.answer || [])[0]), h = S.players[t] && S.players[t].zones.hand;
    if (!h || !h.length) return;
    AA4.enqueue(S, [{ op: "askHandTake", by: op.seat, seat: t, n: 1, upTo: false, dest: "discard" }, { op: "mayDrawAsk", seat: op.seat, n: 1 }], true);   // the same as other "あなたの任意の…手札" picks
  };
  /** "≪あなたの任意の精神攻撃力を持つキャラクター1人にセットされているパワーカード全て≫を捨て札する" */
  A.pickCharPowerOff = (ctx, s, e) => {
    const S = ctx.S, opts = Object.keys(S.chars).filter(id => AA4.matchChar(S, ctx.db, s.sel || {}, id, { seat: e.seat, self: e.ch }) && S.chars[id].power.length);
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 1, max: 1, reason: "Choose a character: its power cards are discarded", then: [{ op: "pickCharPowerGo" }] });
  };
  OPS.pickCharPowerGo = (ctx, op) => { const c = (op.answer || [])[0] && AA4.charOfCard(ctx.S, op.answer[0]); if (c) for (const id of c.power.slice()) AA4.moveCard(ctx, id, { z: "discard" }); };
  /** 3463: "あなたのメインフェイズ開始時に、≪あなたの対戦相手の中でダメージ置き場の枚数が一番多いプレイヤー1人≫にXダメージを与える" (a tie: you choose) */
  A.hitMostDamage = (ctx, s, e) => {
    const S = ctx.S, opps = AA4.living(S).filter(x => x !== e.seat), max = Math.max(-1, ...opps.map(x => S.players[x].zones.damage.length)), top = opps.filter(x => S.players[x].zones.damage.length === max), n = nOf(s, e);
    if (!top.length || n <= 0) return;
    if (top.length === 1) return AA4.damagePlayer(ctx, top[0], { normal: n, mental: 0 }, { from: e.ch, fromSeat: e.seat });
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: top.map(String), labels: top.map(x => S.players[x].name), reason: `Choose the player: ${n} damage`, then: [{ op: "hitMostGo", n, ch: e.ch, seat: e.seat }] });
  };
  OPS.hitMostGo = (ctx, op) => { const t = +((op.answer || [])[0]); if (ctx.S.players[t]) AA4.damagePlayer(ctx, t, op.mental ? { normal: 0, mental: op.n } : { normal: op.n, mental: 0 }, { from: op.ch, fromSeat: op.seat }); };
  /** 3722: "≪あなたの任意の、対戦相手が使用したプロジェクトカードまたはファストカード1枚≫を、オーナーの手札に戻すことが可能" — one in the Special Area (lasting) */
  A.bounceOppLasting = (ctx, s, e) => {
    const S = ctx.S, opts = Object.values(S.cards).filter(c => c.place.z === "special" && c.owner !== e.seat && ["Project", "Fast"].includes((ctx.db.card(c.key) || {}).type)).map(c => c.id);
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 0, max: 1, auto: false, reason: "You may return an opponent's Project / Fast card to its owner's hand", then: [{ op: "bounceLastingGo" }] });
  };
  OPS.bounceLastingGo = (ctx, op) => { const S = ctx.S; for (const id of op.answer || []) { for (const m of S.modifiers.filter(x => x.src && x.src.card === id)) AA4.endMod(ctx, m.id); AA4.moveCard(ctx, id, { z: "hand" }); } };
  /** "≪あなたの手札の…カード1枚≫を、このカードの下に、このキャラクターを構成するカードとしてセットする" (Revise#151): it goes right under this card */
  A.handUnder = (ctx, s, e) => {
    const S = ctx.S, db = ctx.db, cardId = s.ev ? e.evCard : e.card, chId = s.ev ? (e.evCh && S.chars[e.evCh] ? e.evCh : ((cardId && AA4.charOfCard(S, cardId)) || {}).id) : e.ch;   // ev: the card that was just set (a watcher, Revise#352)
    const ch = chId && S.chars[chId], me = cardId && S.cards[cardId] && db.card(S.cards[cardId].key);
    if (!ch || !me) return;
    const opts = S.players[e.seat].zones.hand.filter(id => { const i = db.card(S.cards[id].key) || {}; return (!s.sameName || (i.name && i.name === me.name)) && (!s.unnamedBreak || (i.type === "Break" && !i.name)); });
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: s.any ? 0 : 1, max: s.any ? opts.length : 1, auto: false, reason: s.any ? "Choose any number of cards with the same Name: they go under that card" : "Choose the card that goes under this card", then: [{ op: "handUnderGo", ch: chId, card: cardId }] });
  };
  OPS.handUnderGo = (ctx, op) => {
    const S = ctx.S, ids = (op.answer || []).filter(x => S.cards[x]), ch = S.chars[op.ch];
    if (!ids.length || !ch) return;
    for (const id of ids) {
    AA4.moveCard(ctx, id, { z: "char", ch: op.ch, role: "stack" });
    const st = S.chars[op.ch].stack, i = st.indexOf(id), j = st.indexOf(op.card);
    if (i >= 0 && j >= 0 && i > j) { st.splice(i, 1); st.splice(j, 0, id); }
    }
    // (each goes under that card, not on top)
  };
  /** 3613: "≪あなたの任意の、パーマネントカードがセットされているキャラクター1人にセットされているパワーカード全て≫を、オーナーの手札に戻す" */
  A.pickCharPowerHand = (ctx, s, e) => {
    const S = ctx.S, opts = Object.keys(S.chars).filter(id => S.chars[id].perm.length && S.chars[id].power.length);
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 1, max: 1, reason: "Choose a character with a Permanent: its power cards go back to the hand", then: [{ op: "pickCharPowerHandGo" }] });
  };
  OPS.pickCharPowerHandGo = (ctx, op) => { const c = (op.answer || [])[0] && AA4.charOfCard(ctx.S, op.answer[0]); if (c) for (const id of c.power.slice()) AA4.moveCard(ctx, id, { z: "hand" }); };
  A.reflectNext = (ctx, s, e) => { if (e.ch && ctx.S.chars[e.ch]) mod(ctx, e, { to: { ch: e.ch }, key: "reflectNext", op: "grant", value: true, until: s.until || "turn" }); };
  /** 3296 (Revise#151): "…捨て札になる場合、≪あなた≫は1ドロー可能。捨て札になるキャラクターがネームを持っている場合、代わりに、≪あなたのデッキ≫からそのキャラクターと同じネームを持つカード1枚を選び、…手札に加え、そのデッキをシャッフルする" */
  A.drawOrSameName = (ctx, s, e) => {
    const S = ctx.S, nm = e.evStat && e.evName;
    if (e.evName) {
      const opts = S.players[e.seat].zones.deck.filter(id => (ctx.db.card(S.cards[id].key) || {}).name === e.evName);
      AA4.enqueue(S, [{ op: "shuffle", seat: e.seat }], true);
      if (!opts.length) return;
      AA4.revealTo(S, opts, e.seat);
      return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 0, max: 1, auto: false, reason: `You may take a “${e.evName}” card from your deck (shown to everyone)`, then: [{ op: "revealToHand", seat: e.seat }] });
    }
    AA4.enqueue(S, [{ op: "mayDrawAsk", seat: e.seat, n: 1 }], true);
  };
  OPS.revealToHand = (ctx, op) => { const S = ctx.S, l = op.answer || []; if (l.length) ctx.emit({ e: "handRevealed", seat: op.seat, keys: l.map(id => S.cards[id].key), to: "all" }); for (const id of l) AA4.moveCard(ctx, id, { z: "hand" }); AA4.OPS.shuffle(ctx, { seat: op.seat }); };
  /** 3227: "≪あなたの任意のあなたの対戦相手1人≫にXダメージを与える。Xは捨て札になるキャラクターを構成するカード枚数に等しい" */
  A.pickOppDamage = (ctx, s, e) => {
    const S = ctx.S, n = s.n === "evN" ? (e.evStat && e.evStat.n) || 0 : nOf(s, e), opps = AA4.living(S).filter(x => x !== e.seat);
    if (n <= 0 || !opps.length) return;
    if (opps.length === 1) return AA4.damagePlayer(ctx, opps[0], s.mental ? { normal: 0, mental: n } : { normal: n, mental: 0 }, { fromSeat: e.seat });   // mental: "(1)ダメージ" (EX835, Revise#354)
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opps.map(String), labels: opps.map(x => S.players[x].name), reason: `Choose an opponent: ${n} damage`, then: [{ op: "hitMostGo", n, mental: !!s.mental, ch: null, seat: e.seat }] });
  };
  /* ---------- Q#55 (Revise#150) ---------- */
  /** 2199: "目標の、≪あなたのダメージ置き場または捨て札置き場にある、コストXのゴーストを持つブレイクカード1枚≫をセット宣言する。その後、あなたのデッキからX枚を捨て札する。目標がセットされた場合、…X枚引き、…パワーカードとしてセットする" */
  /** A3-22 3128 (Revise#221): mill X (X = the target's cost), then you may declare the target Break card (paying its cost); when it is set, 1 card from the top of your deck becomes a power card of that character */
  A.machineRise = (ctx, s, e, r) => {
    const S = ctx.S, t = r.find(x => x.card), deck = S.players[e.seat].zones.deck, x = t && S.cards[t.card] ? +((ctx.db.card(S.cards[t.card].key) || {}).cost) || 0 : 0;
    for (let k = 0; k < x && deck.length; k++) AA4.moveCard(ctx, deck[deck.length - 1], { z: "discard" });
    if (t && S.cards[t.card] && ["damage", "discard"].includes(S.cards[t.card].place.z)) {
      mod(ctx, e, { to: { seat: e.seat }, key: "onEnterPower", op: "grant", value: { card: t.card, n: 1 }, until: "turn" });
      AA4.enqueue(S, [{ op: "effDeclPick", seat: e.seat, ch: null, zones: ["damage", "discard"], types: ["Break"], onlyIds: [t.card] }]);
    }
  };
  A.ghostRise = (ctx, s, e, r) => {
    const S = ctx.S, t = r.find(x => x.card), x = +e.x || 0, deck = S.players[e.seat].zones.deck;
    if (t && S.cards[t.card] && ["damage", "discard"].includes(S.cards[t.card].place.z)) {
      mod(ctx, e, { to: { seat: e.seat }, key: "onEnterPower", op: "grant", value: { card: t.card, n: x }, until: "turn" });
      AA4.enqueue(S, [{ op: "effDeclPick", seat: e.seat, ch: null, zones: ["damage", "discard"], types: ["Break"], onlyIds: [t.card] }]);
    }
    for (let k = 0; k < x && deck.length; k++) AA4.moveCard(ctx, deck[deck.length - 1], { z: "discard" });
  };
  /** 2253: "X:このキャラクターのアタック宣言に対してガード宣言が行われていない場合、目標の≪パワーX以下のキャラクター1人≫は、このキャラクターのアタック宣言に対してガード宣言する" */
  A.forceGuardT = (ctx, s, e, r) => {
    const S = ctx.S, b = S.battle, t = chars(r)[0];
    if (!b || (!s.any && b.attacker !== e.ch) || b.guard || !t || !S.chars[t] || S.chars[t].owner !== b.defender || !AA4.isControlled(S.chars[t])) return ctx.emit({ e: "note", text: "No forced guard (it needs an attack of this character with no guard yet, and a Controlled Character of the attacked player)" });
    b.guard = t; b.step = "response"; S.passed = []; S.chars[t].flags.tapped = true;
    ctx.emit({ e: "guarded", ch: t, seat: b.defender, attacker: b.attacker, forced: true });
  };
  /** 2279: "通常のダメージ判定を行わず、…手札がX枚以上の場合、その中からあなたの任意の対象の手札X枚を公開し、その中のキャラクターカード全てを捨て札し、残りは対象のダメージ置き場に置く。手札がX枚に満たない場合、その全てを同様の手順で処理し、Xから手札枚数を引いた数値に等しい枚数を対象のデッキの上から引いて、対象のダメージ置き場に置く" */
  A.handDamage = (ctx, s, e) => {
    const S = ctx.S, seat = e.evSeat, p = S.players[seat], x = +e.x || 0;
    if (!p || x <= 0) return;
    if (p.zones.hand.length >= x) return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: p.zones.hand.slice(), min: x, max: x, auto: false, reason: `Choose ${x} cards of ${p.name}'s hand (Character cards → Discard Pile, the rest → Damage Pile)`, then: [{ op: "handDamageGo", seat, rest: 0 }] });
    return OPS.handDamageGo(ctx, { seat, answer: p.zones.hand.slice(), rest: x - p.zones.hand.length });
  };
  OPS.handDamageGo = (ctx, op) => {
    const S = ctx.S, p = S.players[op.seat], list = (op.answer || []).filter(id => S.cards[id] && S.cards[id].place.z === "hand");
    ctx.emit({ e: "handRevealed", seat: op.seat, keys: list.map(id => S.cards[id].key), to: "all" });
    for (const id of list) AA4.moveCard(ctx, id, { z: (ctx.db.card(S.cards[id].key) || {}).type === "Character" ? "discard" : "damage" });
    for (let k = 0; k < (op.rest || 0) && p.zones.deck.length; k++) AA4.moveCard(ctx, p.zones.deck[p.zones.deck.length - 1], { z: "damage" });
  };
  /** 2277: "メインフェイズ終了時まで、≪このキャラクター≫は任意の分類1つを得る" */
  A.pickIconGrant = (ctx, s, e, r) => {
    const tc = s.to && r ? chars(r)[0] : null; if (tc) e = Object.assign({}, e, { ch: tc });   // EP241: to a target
    if (!e.ch || !ctx.S.chars[e.ch]) return;
    const all = [...new Set(ctx.db.all().flatMap(c => c.icons || []))].sort();
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: all, reason: "Choose a class", then: [{ op: "pickIconGo", seat: e.seat, ch: e.ch, card: e.card, until: s.until || "main" }] });
  };
  /** "あなたの任意の分類1つ": chosen when it resolves; later steps use it (e.icon, "@icon" in selectors) (Revise#168) */
  /** "≪このキャラクターのバトル相手にセットされているパワーカード1枚≫をそのオーナーの手札に戻す" (A4-03 0405, Revise#287) */
  A.battleOppPowerTo = (ctx, s, e) => {
    const S = ctx.S, self = e.ch && S.chars[e.ch] ? e.ch : null; if (!self) return;
    const opts = AA4.battleOppsOf(S, self).filter(id => S.chars[id]).flatMap(id => S.chars[id].power); if (!opts.length) return;
    const op = s.dest === "discard" ? "toDiscard" : "toHand";
    if (opts.length === 1) return AA4.enqueue(S, [{ op, answer: opts }], true);
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 1, max: 1, reason: "Choose 1 power card of the battle opponent: it goes back to its owner's hand", then: [{ op }] });
  };
  /** "≪このキャラクターにセットされているパーマネントカード1枚≫を手札に戻す" (A4-04 0673, Revise#288) */
  A.selfPermPick = (ctx, s, e) => {
    const S = ctx.S, ch = e.ch && S.chars[e.ch]; if (!ch || !ch.perm.length) return;
    const op = s.dest === "discard" ? "toDiscard" : "toHand";
    if (ch.perm.length === 1) return AA4.enqueue(S, [{ op, answer: ch.perm.slice() }], true);
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: ch.perm.slice(), min: 1, max: 1, reason: "Choose 1 Permanent card of this character", then: [{ op }] });
  };
  /** "≪あなた≫は、あなたの支配エリアのパワーカードの内容を全て確認し、その中の1枚を手札に戻す" (A4-EX02 EX909, Revise#294) */
  A.ownPowerPick = (ctx, s, e) => {
    const S = ctx.S, opts = (s.territory ? AA4.charsOf(S, e.seat) : AA4.controlledOf(S, e.seat)).flatMap(id => S.chars[id].power); if (!opts.length) return;   // territory: "あなたのテリトリーのパワーカード全て" (3657, Revise#357)
    AA4.revealTo(S, opts, e.seat);
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 1, max: 1, reason: "Choose 1 power card of your Controlled Characters: it goes back to your hand", then: [{ op: s.dest === "discard" ? "toDiscard" : "toHand" }] });
  };
  A.pickIcon = (ctx, s, e) => {
    ctx.S.effIcon = null;
    const all = [...new Set(ctx.db.all().flatMap(c => c.icons || []))].sort();
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: all, auto: false, reason: s.reason || "Choose a class", then: [{ op: "pickIconSet" }] });
  };
  OPS.pickIconSet = (ctx, op) => { const ic = (op.answer || [])[0]; ctx.S.effIcon = ic || null; if (ic) ctx.emit({ e: "note", text: "Class chosen: " + ic }); };
  A.iconT = (ctx, s, e, r) => { const ic = ctx.S.effIcon; if (!ic) return; for (const ch of chars(r)) mod(ctx, e, { to: { ch }, key: "icon", op: s.remove ? "remove" : "grant", value: ic, until: s.until || "main" }); };
  OPS.pickIconGo = (ctx, op) => { const ic = (op.answer || [])[0]; if (ic && ctx.S.chars[op.ch]) mod(ctx, op, { to: { ch: op.ch }, key: "icon", op: "grant", value: ic, until: op.until }); };
  /** 2418: "このカードの使用宣言時に、勢力を1つ指定する。≪このキャラクター≫は、…指定した勢力に対してのレジストを持つ" — named when it enters */
  A.nameFactionResist = (ctx, s, e) => {
    if (!e.ch || !ctx.S.chars[e.ch]) return;
    const opts = ["E.G.O.", "Arayashiki", "WIZ-DOM", "Darklore", "Polestar Empire", "Eraser"];
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, reason: "Name a faction: this character has Resist against it", then: [{ op: "nameFactionGo", seat: e.seat, ch: e.ch, card: e.card, until: s.until || null, nextBattle: !!s.nextBattle }] });
  };
  OPS.nameFactionGo = (ctx, op) => { const f = (op.answer || [])[0]; if (!f || !ctx.S.chars[op.ch]) return; if (!op.until) ctx.S.cards[op.card].namedFaction = f; mod(ctx, op, Object.assign({ to: { ch: op.ch }, key: "skill", op: "grant", value: { id: "resist", x: { factions: [f], icons: [] } }, until: op.until || "removed" }, op.nextBattle ? { nextBattle: true } : {})); };
  /** 2721: "≪あなたの手札全て≫を、あなたの任意の順番であなたのデッキの一番上に置く。その後、あなたのデッキの一番下から、この効果でデッキの上に置いた枚数と同じ枚数引いて手札に加える" */
  A.handTopDrawBottom = (ctx, s, e) => {
    const S = ctx.S, p = S.players[e.seat], hand = p.zones.hand.slice();
    for (const id of hand) AA4.moveCard(ctx, id, { z: "deck" });
    for (let k = 0; k < hand.length && p.zones.deck.length; k++) AA4.moveCard(ctx, p.zones.deck[0], { z: "hand" });
  };
  /** 2721: "あなたの手札の13枚の異なるネームを持つブレイクカードを捨て札する。その後、≪あなた以外のプレイヤー全て≫に32ダメージを与える。捨て札したカードと同じネームを持つキャラクターを支配している対象には、代わりに48ダメージを与える" */
  A.thirteenNames = (ctx, s, e) => {
    const S = ctx.S, db = ctx.db, h = S.players[e.seat].zones.hand.filter(id => { const i = db.card(S.cards[id].key) || {}; return i.type === "Break" && i.name; });
    if (new Set(h.map(id => db.card(S.cards[id].key).name)).size < 13) return ctx.emit({ e: "note", text: "13 Break cards with different names are needed" });
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: h, min: 13, max: 13, auto: false, reason: "Choose 13 Break cards with different names", then: [{ op: "thirteenGo", seat: e.seat, ch: e.ch }] });
  };
  OPS.thirteenGo = (ctx, op) => {
    const S = ctx.S, db = ctx.db, picked = op.answer || [], names = new Set(picked.map(id => db.card(S.cards[id].key).name));
    if (names.size !== 13) return ctx.emit({ e: "note", text: "The 13 cards must have different names" });
    for (const id of picked) AA4.moveCard(ctx, id, { z: "discard" });
    for (const t of AA4.living(S).filter(x => x !== op.seat)) AA4.damagePlayer(ctx, t, { normal: AA4.controlledOf(S, t).some(c => names.has(AA4.charStats(S, db, c).name)) ? 48 : 32, mental: 0 }, { from: op.ch, fromSeat: op.seat });
  };
  /** 2867: "0:あなたの支配エリアの、このキャラクター以外の、このエフェクトの効果で指定されていないマシン1人を指定し、あなたのデッキの一番上のカード1枚を捨て札する。メインフェイズ終了時まで、指定したキャラクターの本来の能力値を≪このキャラクター≫に合計して判定する。メインフェイズ終了時に、≪指定したキャラクター≫を捨て札する" */
  A.machineDesignate = (ctx, s, e) => {
    const S = ctx.S, db = ctx.db;
    if (!e.ch || !S.chars[e.ch]) return;
    const opts = AA4.controlledOf(S, e.seat).filter(id => id !== e.ch && AA4.charStats(S, db, id).icons.includes("マシン") && !S.modifiers.some(m => m.key === "designatedBy" && m.to && m.to.ch === id && m.value === e.ch));
    if (!opts.length) return ctx.emit({ e: "note", text: "No Machine left to designate" });
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 1, max: 1, reason: "Designate a Machine: its base stats add to this one until the end of the Main Phase (then it is discarded)", then: [{ op: "machineDesGo", seat: e.seat, ch: e.ch, card: e.card }] });
  };
  OPS.machineDesGo = (ctx, op) => {
    const S = ctx.S, c = (op.answer || [])[0] && AA4.charOfCard(S, op.answer[0]), deck = S.players[op.seat].zones.deck;
    if (!c || !S.chars[op.ch]) return;
    if (deck.length) AA4.moveCard(ctx, deck[deck.length - 1], { z: "discard" });
    const b = AA4.charStats(S, ctx.db, c.id).base || {};
    for (const k of ["se", "at", "de"]) if (+b[k]) mod(ctx, op, { to: { ch: op.ch }, key: k, op: "add", value: +b[k], until: "main" });
    mod(ctx, op, { to: { ch: c.id }, key: "designatedBy", op: "grant", value: op.ch, until: "turn" });
    mod(ctx, op, { to: { ch: c.id }, key: "doomMain", op: "grant", value: true, until: "removed" });
  };
  /** 宮村林檎 (Revise#141): "≪あなたのデッキの上から10枚≫を公開し、その中にあるプロジェクトカードまたはファストカード全てをあなたの手札に加える。それ以外のカードはデッキに戻し、そのデッキをシャッフルする" */
  A.revealTopTake = (ctx, s, e) => {
    const S = ctx.S, deck = S.players[e.seat].zones.deck, top = deck.slice(-(s.n || 10)).reverse();
    if (!top.length) return;
    ctx.emit({ e: "handRevealed", seat: e.seat, keys: top.map(id => S.cards[id].key), to: "all" });
    for (const id of top) { const inf = ctx.db.card(S.cards[id].key) || {}; if ((s.types || []).includes(inf.type) && (!s.icons || (inf.icons || []).some(i => s.icons.includes(i))) && (!s.unnamed || !inf.name)) AA4.moveCard(ctx, id, s.dest === "back" ? { z: "back", seat: e.seat } : { z: "hand" }); }   // dest back: 巨大艦隊 (Revise#142) "…全てを、あなたの支配キャラクターとしてセットし"
    AA4.OPS.shuffle(ctx, { seat: e.seat });
  };
  /** エルゼベート (Revise#141): the target discards its power cards when it attacks or guards */
  A.declDropPower = (ctx, s, e, r) => { for (const ch of chars(r)) if (ctx.S.chars[ch]) mod(ctx, e, { to: { ch }, key: "declDropPower", op: "grant", value: true, until: s.until || "main" }); };
  /** ギイェルミナ (Revise#141): "≪あなたの捨て札置き場にあるブレイクカード全て≫を、あなたの手札に加える" */
  A.pileAllToHand = (ctx, s, e) => { const S = ctx.S; for (const id of S.players[e.seat].zones[s.pile || "discard"].slice()) if (!s.type || (ctx.db.card(S.cards[id].key) || {}).type === s.type) AA4.moveCard(ctx, id, { z: "hand" }); };
  /** 水樹鏡花 (Revise#141): "このカードが場にセットされた場合、≪あなたの任意のプレイヤー1人≫の手札全てを公開し、その中のプロジェクトカード・ファストカード全てを捨て札する" */
  A.revealDiscardTypes = (ctx, s, e) => {
    const S = ctx.S, opts = AA4.living(S);
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts.map(String), labels: opts.map(x => S.players[x].name + (x === e.seat ? " (you)" : "")), reason: "Choose a player: their hand is shown and its Project / Fast cards are discarded", then: [{ op: "revealDiscardGo", types: s.types || ["Project", "Fast"] }] });
  };
  OPS.revealDiscardGo = (ctx, op) => {
    const S = ctx.S, seat = +((op.answer || [])[0]), p = S.players[seat];
    if (!p) return;
    const hand = p.zones.hand.slice();
    ctx.emit({ e: "handRevealed", seat, cards: hand, keys: hand.map(id => S.cards[id].key), to: "all" });
    for (const id of hand) if (op.types.includes((ctx.db.card(S.cards[id].key) || {}).type)) AA4.moveCard(ctx, id, { z: "discard" });
  };
  /** マッツィヤ (Revise#141): "各ターンの開始時に、あなたはプロジェクトカードまたはファストカードの名称1つを指定する。そのターン中、≪プレイヤー全て≫は、指定したカードと同じ名称のカードを使用宣言することができない" */
  A.banNamePick = (ctx, s, e) => {
    const S = ctx.S, seen = new Map(), types = s.types || ["Project", "Fast"];
    for (const c of Object.values(S.cards)) { const inf = ctx.db.card(c.key) || {}; if (inf.jp && types.includes(inf.type) && !seen.has(inf.jp)) seen.set(inf.jp, inf); }
    const opts = [...seen.keys()].sort((a, b) => AA4.cardName(seen.get(a)).localeCompare(AA4.cardName(seen.get(b)))).concat(["__other__"]);
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, labels: opts.map(n => (n === "__other__" ? "Other name (not a card of this match)" : `${AA4.cardName(seen.get(n))}${seen.get(n).en ? " — " + n : ""}`)), reason: s.until ? `Name a ${types.join(" / ")} card: nobody may declare it while this card is on the field` : "Name a Project / Fast card: nobody may declare it this turn", then: [{ op: "banNameGo", seat: e.seat, ch: e.ch, card: e.card, until: s.until || "turn" }] });
  };
  OPS.banNameGo = (ctx, op) => {
    const nm = (op.answer || [])[0];
    if (!nm || nm === "__other__") return;
    mod(ctx, { seat: op.seat, ch: op.ch, card: op.card }, { to: { players: "all" }, key: "ban", op: "ban", value: { decl: "set", name: nm }, until: op.until || "turn" });
    ctx.emit({ e: "named", seat: op.seat, name: nm });
  };
  /** DA (Revise#141): "ターン終了時にこのキャラクターのパワーが精神力未満だった場合、≪このキャラクターを構成するカード全てと、…セットされているカード全て≫をオーナーのデッキに戻し、そのデッキをシャッフルする" */
  A.selfToDeck = (ctx, s, e) => {
    const S = ctx.S, ch = e.ch && S.chars[e.ch];
    if (!ch) return;
    if (s.ifPowerLtMental && !(ch.power.length < (AA4.charStats(S, ctx.db, e.ch).se || 0))) return;
    AA4.removeChar(ctx, e.ch, { to: "deck", allTo: true, shuffle: true, why: `returned to the deck by ${srcLabel(ctx, e)}` });
  };
  /** ジャラ・スマルト (Revise#141): "あなたのターン開始時に、≪あなたのデッキの一番上のカード1枚≫を、勢力イレイザー、アンドロイドの、1/2/1のあなた支配キャラクター、トライアロイドとしてセットする" */
  A.deckTopToken = (ctx, s, e) => {
    const S = ctx.S, deck = S.players[e.seat].zones.deck;
    if (!deck.length) return;
    const top = deck[deck.length - 1];
    AA4.moveCard(ctx, top, { z: "back", seat: e.seat });
    const ch = AA4.charOfCard(S, top);
    if (!ch) return;
    AA4.addMod(ctx, { src: { seat: e.seat, card: e.card, label: s.name }, to: { ch: ch.id }, key: "token", op: "grant", value: { name: s.name, stats: s.stats, icons: s.icons || [], faction: s.faction || "", skills: s.skills || [], tags: s.tags || [], freeJoinWith: s.freeJoinWith || null }, until: "removed" });
    if (s.watch) AA4.addMod(ctx, { src: { seat: e.seat, card: top, ch: ch.id, label: s.name }, fromChar: true, to: { seat: e.seat }, key: "watch", op: "grant", value: Object.assign({ onlyCh: ch.id }, s.watch), until: "removed" });   // EP179: the token's own ability
    ctx.emit({ e: "tokenMade", ch: ch.id, seat: e.seat, name: s.name });
  };
  /** Works373 (Revise#137): "あなたの手札のプロジェクトカードまたはファストカード1枚を捨て札する。その後、…Xダメージ…Xはこの効果で捨て札したカードの必要ファクターに等しい" */
  A.discardTypeX = (ctx, s, e) => {
    const S = ctx.S, opts = S.players[e.seat].zones.hand.filter(id => (s.types || []).includes((ctx.db.card(S.cards[id].key) || {}).type));
    S.effLast = 0;
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: s.upTo ? 0 : 1, max: s.any ? opts.length : 1, auto: false, reason: s.any ? "Discard any number of Break cards from your hand (X = their factors)" : `Discard 1 card from your hand (X = its ${s.xCost ? "cost" : "factor"})`, then: [{ op: "discardTypeGo", xCost: !!s.xCost }] });
  };
  OPS.discardTypeGo = (ctx, op) => {
    const S = ctx.S; let x = 0;
    for (const id of op.answer || []) { const inf = ctx.db.card(S.cards[id].key) || {}; x += op.xCost ? (typeof inf.cost === "number" ? inf.cost : 0) : Object.values(inf.factor || {}).reduce((a, b) => a + (+b || 0), 0); AA4.moveCard(ctx, id, { z: "discard" }); }   // xCost: X = its cost (Q#53)
    S.effLast = x; ctx.emit({ e: "xSet", x });
  };
  /** 2048 (Revise#137): "≪このキャラクター≫は、本来の勢力に加え、あなたの任意の勢力1つのキャラクターとしても扱われる" — counted as 1 factor of that faction too */
  A.alsoFactionPick = (ctx, s, e) => {
    if (!e.ch || !ctx.S.chars[e.ch]) return;
    const opts = ["E.G.O.", "Arayashiki", "WIZ-DOM", "Darklore", "Polestar Empire", "Eraser"];
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, reason: "Choose a faction: this character also counts as a character of it", then: [{ op: "alsoFactionGo", seat: e.seat, ch: e.ch, card: e.card, until: s.until || "main" }] });
  };
  OPS.alsoFactionGo = (ctx, op) => { const f = (op.answer || [])[0]; if (f && ctx.S.chars[op.ch]) mod(ctx, { seat: op.seat, ch: op.ch, card: op.card }, { to: { ch: op.ch }, key: "factor", op: "add", value: { faction: f, n: 1 }, until: op.until }); };
  /** "このカードが場にセットされた場合、≪あなたの任意のあなたの手札のパーマネントカード1枚≫を、このキャラクター以外の、あなたの支配エリアのネームレベルキャラクター1人にセット可能" */
  A.handPermToChar = (ctx, s, e) => {
    const S = ctx.S, perms = S.players[e.seat].zones.hand.filter(id => { const i = ctx.db.card(S.cards[id].key) || {}; return i.type === "Permanent" && (!s.faction || i.faction === s.faction); });
    const chs = s.self ? (e.ch && S.chars[e.ch] ? [e.ch] : []) : AA4.controlledOf(S, e.seat).filter(id => id !== e.ch && AA4.matchChar(S, ctx.db, s.sel || {}, id, { seat: e.seat, self: e.ch }));
    if (!perms.length || !chs.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: perms, min: 0, max: 1, auto: false, reason: "You may set a Permanent from your hand", then: [{ op: "handPermPick", seat: e.seat, chs }] });
  };
  OPS.handPermPick = (ctx, op) => {
    const id = (op.answer || [])[0], chs = op.chs.filter(c => ctx.S.chars[c]);
    if (!id || !chs.length) return;
    if (chs.length === 1) return OPS.permFromHandGo(ctx, { ch: chs[0], seat: op.seat, answer: [id] });
    return AA4.ask(ctx, { seat: op.seat, kind: "pick", options: chs, labels: chs.map(c => AA4.cardName(ctx.db.card(ctx.S.cards[AA4.topOf(ctx.S.chars[c])].key))), reason: "Choose the character it is set on", then: [{ op: "handPermGo", seat: op.seat, card: id }] });
  };
  OPS.handPermGo = (ctx, op) => { const ch = (op.answer || [])[0]; if (ch) OPS.permFromHandGo(ctx, { ch, seat: op.seat, answer: [op.card] }); };
  /** 一色真純 (Revise#137): your unbroken Controlled Characters' power cards → this character; opponents' unbroken Controlled Characters' power cards → discarded */
  A.gatherPower = (ctx, s, e) => {
    const S = ctx.S;
    for (const ch of Object.values(S.chars)) {
      if (ch.id === e.ch || !AA4.isControlled(ch) || AA4.charStats(S, ctx.db, ch.id).broken) continue;
      for (const id of ch.power.slice()) { if (ch.owner === e.seat) { if (S.chars[e.ch]) AA4.moveCard(ctx, id, { z: "char", ch: e.ch, role: "power" }); } else AA4.moveCard(ctx, id, { z: "discard" }); }
      if (s.oppAll && ch.owner !== e.seat) for (const id of ch.perm.slice()) AA4.moveCard(ctx, id, { z: "discard" });
    }
  };
  A.toControl = (ctx, s, e, r) => { for (const ch of chars(r)) if (ctx.S.chars[ch] && ctx.S.chars[ch].at.area === "active") OPS.moveChar(ctx, { ch, to: { area: "back" } }); };   // "…を、そのオーナーの支配エリアに移動させる"
  /** 千場イリヤ: a Permanent on it → Discard Pile, then a Permanent from your hand with cost ≤ that one's on it (Revise#137) */
  A.permSwap = (ctx, s, e) => {
    const S = ctx.S, ch = e.ch && S.chars[e.ch];
    if (!ch || !ch.perm.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: ch.perm.slice(), min: 1, max: 1, reason: "Put a Permanent on it into your Discard Pile", then: [{ op: "permSwapGo", ch: e.ch, seat: e.seat }] });
  };
  OPS.permSwapGo = (ctx, op) => {
    const S = ctx.S, id = (op.answer || [])[0];
    if (!id || !S.cards[id]) return;
    const inf = ctx.db.card(S.cards[id].key) || {}, x = inf.cost === "X" ? 0 : +inf.cost || 0;
    AA4.moveCard(ctx, id, { z: "discard" });
    const opts = S.players[op.seat].zones.hand.filter(h => { const i = ctx.db.card(S.cards[h].key) || {}; return i.type === "Permanent" && (i.cost === "X" ? 0 : +i.cost || 0) <= x; });
    if (!opts.length || !S.chars[op.ch]) return;
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: opts, min: 0, max: 1, auto: false, reason: `You may set a Permanent with cost ≤ ${x} from your hand on it`, then: [{ op: "permFromHandGo", ch: op.ch, seat: op.seat }] });
  };
  /** "このカードがセットされたフェイズの終了時まで、…" (Revise#138): until the end of this phase (Main / Charge), else the turn */
  A.modPhase = (ctx, s, e, r) => { const ph = ctx.S.turn.phase, until = ph === "main" ? "main" : ph === "charge" ? "charge" : "turn"; for (const ch of chars(r)) mod(ctx, e, { to: { ch }, key: s.key, op: "add", value: s.n, until }); };
  /** 夜羽子 (Revise#139): "≪あなたの任意のキャラクター1人を構成するブレイクカード全て≫を捨て札可能" */
  A.stripBreaksPick = (ctx, s, e) => {
    const S = ctx.S, opts = Object.keys(S.chars).filter(id => S.chars[id].stack.some(c => (ctx.db.card(S.cards[c].key) || {}).type === "Break"));
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 0, max: 1, auto: false, reason: "You may choose a character: all its Break cards are discarded", then: [{ op: "stripBreaksGo" }] });
  };
  OPS.stripBreaksGo = (ctx, op) => { const S = ctx.S, ch = (op.answer || [])[0] && AA4.charOfCard(S, op.answer[0]); if (!ch) return; for (const id of ch.stack.slice().reverse()) if ((ctx.db.card(S.cards[id].key) || {}).type === "Break" && S.cards[id].place.z === "char") AA4.moveCard(ctx, id, { z: "discard" }); };
  /** レイナ (Revise#139): "≪あなたの手札またはダメージ置き場の「極星剣“ポラリス”」1枚≫をこのキャラクターにセット可能。その後、あなたの任意の≪あなたの対戦相手の支配キャラクター1人とそのオーナー≫に、このキャラクターの攻撃力に等しいダメージを与える" */
  A.namedPermToSelf = (ctx, s, e) => {
    const S = ctx.S, opts = S.players[e.seat].zones.hand.concat(S.players[e.seat].zones.damage).filter(id => (ctx.db.card(S.cards[id].key) || {}).jp === s.name);
    if (!opts.length || !e.ch || !S.chars[e.ch]) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 0, max: 1, auto: false, reason: `You may set ${s.name} on this character`, then: [{ op: "permFromHandGo", ch: e.ch, seat: e.seat }] });
  };
  A.oppCharOwnerDamage = (ctx, s, e) => {
    const S = ctx.S, opts = Object.keys(S.chars).filter(id => S.chars[id].owner !== e.seat && AA4.isControlled(S.chars[id]));
    if (!opts.length) return;
    const n = s.stat && e.ch && S.chars[e.ch] ? AA4.charStats(S, ctx.db, e.ch)[s.stat] || 0 : nOf(s, e);
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 1, max: 1, reason: `Choose an opponent's Controlled Character: ${n} damage to it and its owner`, then: [{ op: "oppCharOwnerGo", n, from: e.ch || null, seat: e.seat }] });
  };
  OPS.oppCharOwnerGo = (ctx, op) => { const S = ctx.S, ch = (op.answer || [])[0] && AA4.charOfCard(S, op.answer[0]); if (!ch) return; const o = ch.owner; AA4.damageChar(ctx, ch.id, { normal: op.n, mental: 0, from: op.from }); AA4.damagePlayer(ctx, o, { normal: op.n, mental: 0 }, { from: op.from, fromSeat: op.seat }); };
  /** "目標は本来の攻撃力を失い、目標のパワーに等しい精神攻撃力を得る" (Revise#140) */
  A.mentalAtkFromPower = (ctx, s, e, r) => { for (const ch of chars(r)) if (ctx.S.chars[ch]) { mod(ctx, e, { to: { ch }, key: "atMental", op: "set", value: true, until: s.until || "main" }); mod(ctx, e, { to: { ch }, key: "at", op: "set", value: ctx.S.chars[ch].power.length, until: s.until || "main" }); } };
  /** "目標の≪コストX以下の…≫を捨て札する" with X known only now (S.effLast) */
  A.discardIfCost = (ctx, s, e, r) => { const S = ctx.S, x = +S.effLast || 0; for (const t of r) { const id = t.card || (t.ch && S.chars[t.ch] && AA4.topOf(S.chars[t.ch])); const inf = id && S.cards[id] ? ctx.db.card(S.cards[id].key) || {} : null; if (inf && (inf.cost === "X" ? 0 : +inf.cost || 0) <= x) { if (t.ch) AA4.defeat(ctx, t.ch, { why: "discarded" }); else AA4.moveCard(ctx, id, { z: "discard" }); } } };
  /** "あなたの支配エリアのネームレベルキャラクター1人を捨て札する。その後、目標…" */
  A.discardOwnPick = (ctx, s, e) => {
    const S = ctx.S, opts = (s.anyArea ? AA4.charsOf(S, e.seat) : AA4.controlledOf(S, e.seat)).filter(id => AA4.matchChar(S, ctx.db, s.sel || {}, id, { seat: e.seat, self: e.ch }));
    S.effLast = 0;
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 1, max: 1, reason: "Discard one of your characters", then: [{ op: "discardOwnGo" }] });
  };
  OPS.discardOwnGo = (ctx, op) => { const ch = (op.answer || [])[0] && AA4.charOfCard(ctx.S, op.answer[0]); if (ch) { ctx.S.effLast = 1; ctx.S.effLastAt = Math.max(0, AA4.charStats(ctx.S, ctx.db, ch.id).at || 0); AA4.defeat(ctx, ch.id, { why: "discarded (cost of the effect)" }); } };
  A.ifLastDiscard = (ctx, s, e, r) => { if (!ctx.S.effLast) return; for (const t of r) if (t.ch && ctx.S.chars[t.ch]) AA4.defeat(ctx, t.ch, { why: "discarded" }); };
  A.pickCharDamage = (ctx, s, e) => {
    if (s.skipZero && !nOf(s, e)) return;   // 2659 (Revise#179): X = 0 does nothing
    const S = ctx.S, opts = Object.keys(S.chars).filter(id => AA4.matchChar(S, ctx.db, s.sel || {}, id, { seat: e.seat, self: e.ch, x: e.x }));
    if (!opts.length) return;
    const n = nOf(s, e);
    if (s.stat) return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: s.upTo ? 0 : 1, max: 1, reason: `Choose a character: ${{ se: "Mental", at: "Attack", de: "Defense" }[s.stat]} ${n >= 0 ? "+" : ""}${n * (s.sign || 1)}`, then: [{ op: "pickCharModGo", n: n * (s.sign || 1), key: s.stat, until: s.until || "main", seat: e.seat, ch: e.ch, card: e.card }] });   // 赤竜女王 (Revise#141): "…1人≫の耐久力に-Xする"
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: s.upTo ? 0 : 1, max: 1, reason: `Choose a character: ${s.mental ? "(" + n + ")" : n} damage`, then: [{ op: "pickCharDamageGo", n, mental: !!s.mental, from: e.ch || null }] });
  };
  OPS.pickCharModGo = (ctx, op) => { const ch = (op.answer || [])[0] && AA4.charOfCard(ctx.S, op.answer[0]); if (ch) mod(ctx, { seat: op.seat, ch: op.ch, card: op.card }, { to: { ch: ch.id }, key: op.key, op: "add", value: op.n, until: op.until }); };
  /** パニッシャー (Revise#141): "目標の≪キャラクター1人≫にXダメージを与える。この効果でネームレベルキャラクターを捨て札した場合、≪捨て札したキャラクターのオーナー≫にXダメージを与える" */
  A.damageKillHit = (ctx, s, e, r) => {
    const S = ctx.S, n = nOf(s, e);
    for (const ch of chars(r)) {
      if (!S.chars[ch]) continue;
      const owner = S.chars[ch].owner, named = !!AA4.charStats(S, ctx.db, ch).named, cards = S.chars[ch].stack.slice();
      AA4.damageChar(ctx, ch, { normal: n, mental: 0, from: e.ch || null });
      if (named) AA4.enqueue(S, [{ op: "killHitCheck", ch, owner, n, cards }]);
    }
  };
  OPS.killHitCheck = (ctx, op) => { const S = ctx.S; if (!S.chars[op.ch] && op.cards.some(id => S.cards[id] && ["discard", "damage"].includes(S.cards[id].place.z)) && !S.players[op.owner].lost) AA4.damagePlayer(ctx, op.owner, { normal: op.n, mental: 0 }, {}); };
  /** SARASA (Revise#141): "目標の≪キャラクター1人≫に、全てのプレイヤーのダメージ置き場にあるカードの勢力全てに対するレジスト・プロテクトを与える" */
  A.resistDamageFactions = (ctx, s, e, r) => {
    const S = ctx.S, fs = [...new Set(S.players.flatMap(p => p.zones.damage.map(id => (ctx.db.card(S.cards[id].key) || {}).faction).filter(Boolean)))];
    if (!fs.length) return;
    for (const ch of chars(r)) if (S.chars[ch]) {
      mod(ctx, e, { to: { ch }, key: "skill", op: "grant", value: { id: "resist", x: { factions: fs, icons: [] } }, until: s.until || "main" });
      mod(ctx, e, { to: { ch }, key: "skill", op: "grant", value: { id: "protect", x: { factions: fs } }, until: s.until || "main" });
    }
  };
  OPS.pickCharDamageGo = (ctx, op) => { const ch = (op.answer || [])[0] && AA4.charOfCard(ctx.S, op.answer[0]); if (ch) AA4.damageChar(ctx, ch.id, op.mental ? { normal: 0, mental: op.n, from: op.from } : { normal: op.n, mental: 0, from: op.from }); };
  A.cancelItem = (ctx, s, e, r) => {
    const S = ctx.S;
    for (const x of r.filter(y => y.item)) {
      const i = S.stack.findIndex(it => it.id === x.item);
      if (i < 0) continue;
      if (AA4.itemShielded(ctx, S.stack[i], e)) { ctx.emit({ e: "note", text: "It is not affected (シールド: Fast cards and other effects)" }); continue; }   // EP262
      const [it] = S.stack.splice(i, 1);
      if (it.kind === "set" && S.cards[it.card].place.z !== "char") AA4.moveCard(ctx, it.card, { z: "discard" });
      ctx.emit({ e: "itemCancelled", item: it.id, by: e.card });
    }
  };
  /* ---------- M2g batch 2 (Revise#157) ---------- */
  /** EP158: "キャラクター1人を指定する。≪指定したキャラクタ-1人に対して効果を発揮しているプロジェクトカード・ファストカード全て≫を捨て札する。その後、…Xダメージ…Xは…コストの合計" */
  A.lastingStripHit = (ctx, s, e) => {
    const S = ctx.S, opts = Object.keys(S.chars);
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 1, max: 1, reason: "Choose a character: discard every Project / Fast card working on it, then damage = their total cost", then: [{ op: "lastingStripHitGo", e }] });
  };
  OPS.lastingStripHitGo = (ctx, op) => {
    const S = ctx.S, c = AA4.charOfCard(S, (op.answer || [])[0]); if (!c) return;
    const ids = [...new Set(S.modifiers.filter(m => m.to && m.to.ch === c.id && m.src && m.src.card && S.cards[m.src.card] && S.cards[m.src.card].place.z === "special" && ["Project", "Fast"].includes((ctx.db.card(S.cards[m.src.card].key) || {}).type)).map(m => m.src.card))];
    let x = 0;
    for (const id of ids) { const inf = ctx.db.card(S.cards[id].key) || {}; x += typeof inf.cost === "number" ? inf.cost : 0; for (const m of S.modifiers.filter(y => y.src && y.src.card === id)) AA4.endMod(ctx, m.id); AA4.moveCard(ctx, id, { z: "discard" }); }
    if (x > 0 && S.chars[c.id]) AA4.damageChar(ctx, c.id, { normal: x, mental: 0, from: op.e.ch || null });
  };
  /** EP160: random hand card + top deck card → Discard Pile; same card type → +N Attack the next time it battles or attacks a player (until the end of the Main Phase) */
  A.matchTypeBoost = (ctx, s, e) => {
    const S = ctx.S, p = S.players[e.seat], hand = p.zones.hand, deck = p.zones.deck;
    if (!hand.length || !deck.length) { if (hand.length) AA4.moveCard(ctx, hand[AA4.randInt(S, hand.length)], { z: "discard" }); if (deck.length) AA4.moveCard(ctx, deck[deck.length - 1], { z: "discard" }); return; }
    const a = hand[AA4.randInt(S, hand.length)], b = deck[deck.length - 1];
    AA4.moveCard(ctx, a, { z: "discard" }); AA4.moveCard(ctx, b, { z: "discard" });
    const ta = (ctx.db.card(S.cards[a].key) || {}).type, tb = (ctx.db.card(S.cards[b].key) || {}).type;
    ctx.emit({ e: "note", text: `Discarded: ${ta} card and ${tb} card — ${ta === tb ? "same type" : "not the same type"}` });
    if (ta === tb && e.ch && S.chars[e.ch]) mod(ctx, e, { to: { ch: e.ch }, key: "at", op: "add", value: s.n || 5, until: "main", nextBattle: true, cond: { battleOrAttackPlayer: true } });
  };
  /** EP164: "目標の≪あなたの支配キャラクター1人≫に与えられるダメージは、このキャラクターが代わりに受ける" */
  A.takeForT = (ctx, s, e, r) => { if (!e.ch || !ctx.S.chars[e.ch]) return; for (const ch of chars(r)) if (ch !== e.ch) mod(ctx, e, { to: { ch: e.ch }, key: "takeFor", op: "grant", value: s.once ? { ch, once: true } : { ch }, until: s.until || "main" }); };
  /** EX0265: "ターン終了時まで、次にあなたに与えられるダメージは、≪このキャラクター≫が代わりに受ける" */
  A.takeForOwnerNext = (ctx, s, e) => { if (e.ch && ctx.S.chars[e.ch]) mod(ctx, e, { to: { ch: e.ch }, key: "takeForOwner", op: "grant", value: { once: true }, until: s.until || "turn" }); };
  /** EP167: name a card type, then you may discard the top card of your deck; that type → one more damage check */
  A.millTypeHitTwice = (ctx, s, e) => {
    if (!e.ch || !ctx.S.chars[e.ch] || !ctx.S.players[e.seat].zones.deck.length) return;
    const types = ["Character", "Break", "Permanent", "Project", "Fast"];
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: types, labels: types.map(t => t + " card"), reason: "Name a card type, then discard the top card of your deck", then: [{ op: "millTypeHitTwiceGo", e }] });
  };
  OPS.millTypeHitTwiceGo = (ctx, op) => {
    const S = ctx.S, e = op.e, deck = S.players[e.seat].zones.deck, t = (op.answer || [])[0];
    if (!t || !deck.length) return;
    const id = deck[deck.length - 1]; AA4.moveCard(ctx, id, { z: "discard" });
    const ok = (ctx.db.card(S.cards[id].key) || {}).type === t;
    ctx.emit({ e: "note", text: ok ? `Named ${t}: right — one more damage check` : `Named ${t}: wrong` });
    if (ok && S.chars[e.ch]) mod(ctx, e, { to: { ch: e.ch }, key: "hitTwice", op: "grant", value: true, until: "battle" });
  };
  /** EP169: "あなたの支配エリアの、このキャラクター以外の、カード名称に「X」を含むキャラクター全てを捨て札する。…攻撃力に+X…Xは…攻撃力の数値の合計" */
  A.sacrificeBoost = (ctx, s, e) => {
    const S = ctx.S; if (!e.ch || !S.chars[e.ch]) return;
    const ids = AA4.controlledOf(S, e.seat).filter(id => id !== e.ch && ((ctx.db.card(S.cards[AA4.topOf(S.chars[id])].key) || {}).jp || "").includes(s.nameHas));
    let x = 0;
    for (const id of ids) { x += Math.max(0, AA4.charStats(S, ctx.db, id).at || 0); AA4.defeat(ctx, id, { why: `discarded by ${srcLabel(ctx, e)}`, bySeat: e.seat }); }
    if (x && S.chars[e.ch]) mod(ctx, e, { to: { ch: e.ch }, key: "at", op: "add", value: x, until: s.until || "main" });
  };
  /** generic: discard the top card of your deck; if it is of these types, run the next step (EP170) */
  A.millThen = (ctx, s, e) => {
    const S = ctx.S, deck = S.players[e.seat].zones.deck; if (!deck.length) return;
    const id = deck[deck.length - 1]; AA4.moveCard(ctx, id, { z: "discard" });
    const inf = ctx.db.card(S.cards[id].key) || {};
    if ((!s.types || s.types.includes(inf.type)) && (!s.named || !!inf.name)) return (A[s.then.a] || A.manual)(ctx, s.then, e, refs(ctx, e, s.then.to));
  };
  /** EP176: "≪あなたの任意のプレイヤー1人の捨て札置き場にあるカードと同じ名称のキャラクター全て≫に、Nダメージを与える" */
  A.pileNameHit = (ctx, s, e) => {
    const S = ctx.S, opts = AA4.living(S).flatMap(x => S.players[x].zones.discard);
    if (!opts.length) return;
    AA4.revealTo(S, opts, e.seat);
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 1, max: 1, reason: `Choose a card in a Discard Pile: ${s.n} damage to every character with the same card name`, then: [{ op: "pileNameHitGo", n: s.n, from: e.ch || null }] });
  };
  OPS.pileNameHitGo = (ctx, op) => {
    const S = ctx.S, id = (op.answer || [])[0]; if (!id) return;
    const jp = ((ctx.db.card(S.cards[id].key) || {}).jp || "").replace(/\s+/g, "");
    for (const ch of Object.keys(S.chars).filter(c => ((ctx.db.card(S.cards[AA4.topOf(S.chars[c])].key) || {}).jp || "").replace(/\s+/g, "") === jp)) if (S.chars[ch]) AA4.damageChar(ctx, ch, { normal: op.n, mental: 0, from: op.from });
  };
  /** EP182: "このエフェクトの使用宣言時に、エリア1つを指定する。ターン終了時に、≪指定したエリアのキャラクター全て≫にNダメージを与える" */
  A.areaDamageLater = (ctx, s, e) => {
    const S = ctx.S, opts = [], labels = [];
    for (const seat of AA4.living(S)) for (const [a, l] of [["active", "Active Area"], ["control", "Control Area"]]) { opts.push(seat + ":" + a); labels.push(`${S.players[seat].name} — ${l}`); }
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, labels, reason: `Choose one area: at the end of the turn, ${s.n || 1} damage to every character there`, then: [{ op: "areaDamageLaterGo", n: s.n || 1, at: s.at || "turn", e }] });
  };
  OPS.areaDamageLaterGo = (ctx, op) => { const S = ctx.S; (S.delayed = S.delayed || []).push({ at: op.at, step: { a: "areaDamageNow", n: op.n, area: (op.answer || [])[0] }, e: Object.assign({}, op.e, { spec: null, targets: [] }) }); };
  A.areaDamageNow = (ctx, s, e) => OPS.areaDamageGo(ctx, { answer: [s.area], n: s.n, from: e.ch || null });
  /** EP184: you may name a series; reveal the top card of your deck — that series → hand, otherwise → Discard Pile */
  A.nameSeriesTop = (ctx, s, e) => {
    const S = ctx.S, deck = S.players[e.seat].zones.deck; if (!deck.length) return;
    const series = [...new Set(Object.values(S.cards).map(c => String(c.key).split(" ")[0]))].sort();
    const rar = [...new Set(Object.values(S.cards).map(c => (ctx.db.card(c.key) || {}).rarity).filter(Boolean))].sort();
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: ["__no__"].concat(series, rar.map(x => "R:" + x)), labels: ["Don't name"].concat(series, rar.map(x => "Rarity " + x)), reason: "You may name an expansion (series): reveal the top card of your deck — that series goes to your hand, otherwise it is discarded", then: [{ op: "nameSeriesTopGo", seat: e.seat }] });
  };
  OPS.nameSeriesTopGo = (ctx, op) => {
    const S = ctx.S, a = (op.answer || [])[0], deck = S.players[op.seat].zones.deck;
    if (!a || a === "__no__" || !deck.length) return;
    const id = deck[deck.length - 1]; AA4.revealTo(S, [id], "all");
    const ok = a.startsWith("R:") ? (ctx.db.card(S.cards[id].key) || {}).rarity === a.slice(2) : String(S.cards[id].key).split(" ")[0] === a;
    ctx.emit({ e: "note", text: `Named ${a}: ${AA4.cardName(ctx.db.card(S.cards[id].key) || {})} — ${ok ? "to the hand" : "discarded"}` });
    AA4.moveCard(ctx, id, { z: ok ? "hand" : "discard" });
  };
  /** EP179 token: "このキャラクターがプレイヤーにアタックした場合、アタックを受けたプレイヤーの支配キャラクター全てにセットされているパワーカードから、≪あなたの任意のパワーカード1枚ずつ≫を捨て札する" */
  A.attackedPowerStrip = (ctx, s, e) => {
    const S = ctx.S, seat = S.battle && S.battle.target && S.battle.target.seat; if (seat == null) return;
    const todo = AA4.controlledOf(S, seat).filter(id => S.chars[id].power.length);
    if (todo.length) return OPS.attackedPowerStripGo(ctx, { seat: e.seat, todo });
  };
  OPS.attackedPowerStripGo = (ctx, op) => {
    const S = ctx.S;
    for (const id of op.answer || []) if (S.cards[id] && S.cards[id].place.role === "power") AA4.moveCard(ctx, id, { z: "discard" });
    const todo = op.todo.filter(id => S.chars[id] && S.chars[id].power.length);
    if (!todo.length) return;
    const ch = todo[0], rest = todo.slice(1), pw = S.chars[ch].power.slice();
    if (pw.length === 1) return OPS.attackedPowerStripGo(ctx, { seat: op.seat, todo: rest, answer: pw });
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: pw, min: 1, max: 1, reason: "Choose a power card of this character to discard", then: [{ op: "attackedPowerStripGo", seat: op.seat, todo: rest }] });
  };
  /** EP188: "このキャラクター以外のあなたの支配キャラクターがアタック宣言した場合、≪このキャラクター≫はコストを支払わず、同じ目標に対してアタック宣言する" — it attacks right after that battle */
  A.followAttackQueue = (ctx, s, e) => {
    const S = ctx.S, me = e.card && AA4.charOfCard(S, e.card), b = S.battle;
    if (!me || !b || b.attacker === me.id || !b.target || b.target.seat == null || !AA4.isControlled(me)) return;
    (S.afterBattle = S.afterBattle || []).push({ op: "makeAttackGo", ch: me.id, answer: [String(b.target.seat)] });
  };
  /** EP262: the item is not affected by Fast cards or effects other than the one that shielded it */
  AA4.itemShielded = (ctx, it, e) => {
    if (!it || !it.shield || !e) return false;
    const src = e.item;
    if (!src) return false;
    if (src.kind === "effect") return !it.shield.fastOnly && !(it.shield.card === src.card && it.shield.i === src.i);   // fastOnly: A3-07 1029 "ファストカードの効果を受けない" (Revise#164)
    return src.kind === "set" && src.card && (ctx.db.card(ctx.S.cards[src.card].key) || {}).type === "Fast";
  };
  A.shieldItem = (ctx, s, e, r) => { for (const x of r.filter(y => y.item)) { const it = ctx.S.stack.find(z => z.id === x.item); if (it) it.shield = { card: e.card, i: e.item ? e.item.i : null }; } };
  /** EP222: "≪このキャラクターのバトル相手にセットされているパーマネントカード全て≫を捨て札する。…捨て札された場合、バトル終了時まで、…して判定する" */
  A.oppPermStripBoost = (ctx, s, e) => {
    const S = ctx.S; if (!e.ch || !S.chars[e.ch]) return;
    let n = 0;
    for (const o of AA4.battleOppsOf(S, e.ch)) if (S.chars[o]) for (const id of S.chars[o].perm.slice()) { AA4.moveCard(ctx, id, { z: "discard" }); n++; }
    if (n) for (const [k, v] of Object.entries(s.stats || {})) if (v) mod(ctx, e, { to: { ch: e.ch }, key: k, op: "add", value: v, until: "battle" });
  };
  /** "…の攻撃力または耐久力に+N する": one choice for all of them */
  A.statChoice = (ctx, s, e, r) => {
    const cs = chars(r); if (!cs.length) return;
    const keys = s.keys || ["at", "de"], L = { se: "Mental", at: "Attack", de: "Defense" };
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: keys, labels: keys.map(k => `${L[k]} +${s.n}`), reason: "Choose which stat goes up", then: [{ op: "statChoiceGo", e, cs, n: s.n, until: s.until || "turn" }] });
  };
  OPS.statChoiceGo = (ctx, op) => { const k = (op.answer || [])[0]; if (k) for (const ch of op.cs) if (ctx.S.chars[ch]) mod(ctx, op.e, { to: { ch }, key: k, op: "add", value: op.n, until: op.until }); };
  /** EP233: "≪…を使用宣言した、XまたはX♂を支配していないプレイヤー≫は、自身の手札1枚を捨て札する" */
  A.declarerNoIconDiscard = (ctx, s, e) => {
    const S = ctx.S, seat = e.evSeat; if (seat == null || !S.players[seat]) return;
    if (AA4.controlledOf(S, seat).some(id => AA4.charStats(S, ctx.db, id).icons.some(i => (s.icons || []).includes(i)))) return;
    const h = S.players[seat].zones.hand; if (!h.length) return;
    return AA4.ask(ctx, { seat, kind: "cards", options: h.slice(), min: 1, max: 1, reason: "Discard 1 card of your hand", then: [{ op: "toDiscard", seat }] });
  };
  /** EP244: "≪ネームを持つブレイクカードをセットしたプレイヤー≫は、1ドローする。その後、そのプレイヤーの任意のプレイヤー1人の手札1枚を選んで捨て札する" */
  A.namedBreakSetter = (ctx, s, e) => {
    const S = ctx.S, c = e.evCard && S.cards[e.evCard], seat = c ? c.owner : e.evSeat;
    if (seat == null || !S.players[seat] || S.players[seat].lost) return;
    AA4.enqueue(S, [{ op: "draw", seat, n: 1 }, { op: "handPickPlayer", seat }], true);
  };
  OPS.handPickPlayer = (ctx, op) => {
    const S = ctx.S, opts = AA4.living(S).filter(x => S.players[x].zones.hand.length).map(String);
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: op.seat, kind: "pick", options: opts, labels: opts.map(x => S.players[+x].name), reason: "Choose a player: pick 1 card of their hand to discard", then: [{ op: "handPickPlayerGo", seat: op.seat }] });
  };
  OPS.handPickPlayerGo = (ctx, op) => {
    const S = ctx.S, who = +((op.answer || [])[0]), h = S.players[who] && S.players[who].zones.hand; if (!h || !h.length) return;
    AA4.revealTo(S, h, op.seat);
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: h.slice(), min: 1, max: 1, reason: `Choose 1 card of ${S.players[who].name}'s hand to discard`, then: [{ op: "toDiscard", seat: op.seat }] });
  };
  /** EP246: power cards of the targets back to their owner's hand */
  A.powerAllToHand = (ctx, s, e, r) => { for (const ch of chars(r)) if (ctx.S.chars[ch]) for (const id of ctx.S.chars[ch].power.slice()) AA4.moveCard(ctx, id, { z: "hand", seat: ctx.S.cards[id].owner }); };
  /** EP247: "≪プレイヤー全て≫は、デッキの一番下から1ドローする" */
  A.drawBottomAll = (ctx, s, e) => { const S = ctx.S; for (const seat of AA4.living(S)) { const d = S.players[seat].zones.deck; for (let k = 0; k < (s.n || 1) && d.length; k++) AA4.moveCard(ctx, d[0], { z: "hand", seat }); } };
  /** EP247: every player names a card type; the X-th card from the bottom is revealed: that type → the bottom X cards to hand, otherwise only that card */
  A.bottomXGuess = (ctx, s, e) => { const x = +e.x || 0; if (x <= 0) return; AA4.enqueue(ctx.S, AA4.living(ctx.S).map(seat => ({ op: "bottomXGuessAsk", seat, x })), true); };
  OPS.bottomXGuessAsk = (ctx, op) => {
    const types = ["Character", "Break", "Permanent", "Project", "Fast"];
    if (!ctx.S.players[op.seat] || ctx.S.players[op.seat].zones.deck.length < 1) return;
    return AA4.ask(ctx, { seat: op.seat, kind: "pick", options: types, labels: types.map(t => t + " card"), reason: `Name a card type: the ${op.x}${op.x === 1 ? "st" : "th"} card from the bottom of your deck is revealed`, then: [{ op: "bottomXGuessGo", seat: op.seat, x: op.x }] });
  };
  OPS.bottomXGuessGo = (ctx, op) => {
    const S = ctx.S, d = S.players[op.seat].zones.deck, t = (op.answer || [])[0], x = Math.min(op.x, d.length); if (!x) return;
    const id = d[x - 1]; AA4.revealTo(S, [id], "all");
    const ok = (ctx.db.card(S.cards[id].key) || {}).type === t;
    ctx.emit({ e: "note", text: `${S.players[op.seat].name} named ${t}: ${AA4.cardName(ctx.db.card(S.cards[id].key) || {})} — ${ok ? `the bottom ${x} cards go to the hand` : "only that card goes to the hand"}` });
    for (const c of ok ? d.slice(0, x) : [id]) AA4.moveCard(ctx, c, { z: "hand", seat: op.seat });
  };
  /** EP248: "…このキャラクターから1コストを支払うことが可能。そうした場合、…" — one power card of this character to the Discard Pile, then the step */
  A.payThen = (ctx, s, e) => {
    const S = ctx.S; if (!e.ch || !S.chars[e.ch] || S.chars[e.ch].power.length < (s.n || 1)) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "yesno", reason: `${srcLabel(ctx, e)}: pay ${s.n || 1} from this character?`, then: [{ op: "payThenGo", s, e }] });
  };
  OPS.payThenGo = (ctx, op) => {
    const S = ctx.S, e = op.e, s = op.s; if ((op.answer || [])[0] !== "yes" || !S.chars[e.ch]) return;
    const pw = S.chars[e.ch].power, n = s.n || 1;
    for (let k = 0; k < n && pw.length; k++) AA4.moveCard(ctx, pw[pw.length - 1], { z: "discard" });
    return (A[s.then.a] || A.manual)(ctx, s.then, e, refs(ctx, e, s.then.to));
  };
  /** "目標が…を持っていた場合、代わりに、目標を捨て札する" (EP253): the rest is skipped when it does */
  A.discardIfSkill = (ctx, s, e, r) => {
    const S = ctx.S; S.effLast = 1;
    for (const ch of chars(r)) if (S.chars[ch] && AA4.charStats(S, ctx.db, ch).skills[s.skill]) { S.effLast = 0; AA4.defeat(ctx, ch, { why: `discarded by ${srcLabel(ctx, e)}`, bySeat: e.seat }); }
  };
  /** EP259: discard any hand card; +N (or +M if it was a Project / Fast card) to the targets */
  A.discardHandBoost = (ctx, s, e, r) => {
    const S = ctx.S, h = S.players[e.seat].zones.hand, cs = chars(r);
    if (!h.length) { for (const ch of cs) mod(ctx, e, { to: { ch }, key: s.key || "at", op: "add", value: s.n, until: s.until || "main" }); return; }
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: h.slice(), min: 1, max: 1, reason: "Discard 1 card of your hand", then: [{ op: "discardHandBoostGo", s, e, cs }] });
  };
  OPS.discardHandBoostGo = (ctx, op) => {
    const S = ctx.S, id = (op.answer || [])[0], s = op.s; let v = s.n;
    if (id) { const t = (ctx.db.card(S.cards[id].key) || {}).type; AA4.moveCard(ctx, id, { z: "discard" }); if ((s.ifTypes || []).includes(t)) v = s.alt; }
    for (const ch of op.cs) if (S.chars[ch]) mod(ctx, op.e, { to: { ch }, key: s.key || "at", op: "add", value: v, until: s.until || "main" });
  };
  /** EP228: "このエフェクトの効果でキャラクターを捨て札した場合、…" — the target is gone (or going) */
  A.ifTargetGone = (ctx, s, e) => {
    const S = ctx.S, ts = (e.targets || []).filter(t => t.ch);
    if (ts.some(t => !S.chars[t.ch] || S.chars[t.ch].flags.dying)) return (A[s.then.a] || A.manual)(ctx, s.then, e, refs(ctx, e, s.then.to));
  };
  /** EP356: "≪このカードとこのキャラクターにセットされているパーマネントカード全て≫を手札に戻す" (it left the field) */
  A.evSelfPermsToHand = (ctx, s, e) => { const S = ctx.S; for (const id of e.evAll || []) if (S.cards[id] && ["discard", "damage"].includes(S.cards[id].place.z) && (id === e.card || (ctx.db.card(S.cards[id].key) || {}).type === "Permanent")) AA4.moveCard(ctx, id, { z: "hand", seat: S.cards[id].owner }); };
  /** EP368: "あなたのデッキの一番上のカード1枚を≪このキャラクター≫にパワーカードとしてセット" */
  A.deckTopPowerSelf = (ctx, s, e) => { const S = ctx.S, d = S.players[e.seat].zones.deck; for (let k = 0, n = s.n === "X" ? +e.x || 0 : s.n || 1; k < n && d.length && e.ch && S.chars[e.ch]; k++) AA4.moveCard(ctx, d[d.length - 1], { z: "char", ch: e.ch, role: "power" }); };
  /** "あなたの任意の…キャラクターX体": choose n characters now, then modifiers on each (A3-02 0422 / A3-05 0871, Revise#161).
      s = {sel, n, mods: [{key, op?, value?, xSign?}], until} */
  A.pickCharsMods = (ctx, s, e) => {
    const S = ctx.S, opts = Object.keys(S.chars).filter(id => AA4.matchChar(S, ctx.db, s.sel || {}, id, { seat: e.seat, self: e.ch })), n = Math.min(nOf(s, e), opts.length);
    if (n <= 0) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: n, max: n, reason: `Choose ${n} character${n === 1 ? "" : "s"} for ${srcLabel(ctx, e)}`, then: [{ op: "pickCharsModsGo", s, e: { seat: e.seat, card: e.card, ch: e.ch, x: e.x } }] });
  };
  OPS.pickCharsModsGo = (ctx, op) => {
    const xv = +op.e.x || 0;
    for (const id of op.answer || []) { const c = AA4.charOfCard(ctx.S, id); if (c) for (const m of op.s.mods) mod(ctx, op.e, { to: { ch: c.id }, key: m.key, op: m.op || (m.xSign ? "add" : "grant"), value: m.xSign ? m.xSign * xv : m.value == null ? true : m.value, until: op.s.until || "turn" }); }
  };
  /** EX0384 (Revise#161): "バトル相手が捨て札されていない場合、≪このキャラクターのバトル相手全て≫にXダメージを与える" — once per battle */
  A.damageAliveOpps = (ctx, s, e) => {
    const S = ctx.S;
    if (!e.ch || !S.chars[e.ch] || !S.battle) return;
    S.battle.aliveHit = S.battle.aliveHit || {};
    if (S.battle.aliveHit[e.ch]) return;
    const opps = AA4.battleOppsOf(S, e.ch).filter(o => S.chars[o]);
    if (!opps.length) return;
    S.battle.aliveHit[e.ch] = true;
    const n = +e.x || 0;
    if (n > 0) for (const o of opps) AA4.damageChar(ctx, o, { from: e.ch, fromSeat: e.seat, normal: n, mental: 0 });
  };
  /** EP288: cancel every opponent's declared item that deals damage */
  A.cancelAllDamaging = (ctx, s, e) => {
    const S = ctx.S, db = ctx.db;
    const ids = S.stack.filter(it => it.seat !== e.seat && !(e.item && it.id === e.item.id) && AA4.dealsDamage(it.kind === "effect" ? (AA4.effectsOf(S, db, it.ch, it.card) || [])[it.i] : (db.card(S.cards[it.card].key) || {}).play)).map(it => ({ item: it.id }));
    if (ids.length) return A.cancelItem(ctx, s, e, ids);
  };
  /** EP374: "≪あなた≫はXドローする。Xは…の数が上限の、あなたの任意の数に等しい" */
  A.drawUpTo = (ctx, s, e) => {
    const S = ctx.S, max = AA4.xOf(S, ctx.db, s.max, { seat: e.seat, ch: e.ch, card: e.card }, []);
    if (max <= 0) return;
    const opts = Array.from({ length: max + 1 }, (_, i) => String(i));
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, reason: `Draw how many? (0 – ${max})`, then: [{ op: "drawUpToGo", seat: e.seat }] });
  };
  OPS.drawUpToGo = (ctx, op) => { const n = +((op.answer || [])[0]) || 0; if (n > 0) AA4.enqueue(ctx.S, [{ op: "draw", seat: op.seat, n }], true); };
  /** EX0045: "≪あなたの任意のキャラクタ-1人にセットされているパーマネントカード全て≫を捨て札する" */
  A.pickCharPermsDiscard = (ctx, s, e) => {
    const S = ctx.S, opts = Object.keys(S.chars).filter(id => S.chars[id].perm.length);
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 1, max: 1, reason: "Choose a character: all its Permanent cards are discarded", then: [{ op: "pickCharPermsDiscardGo" }] });
  };
  OPS.pickCharPermsDiscardGo = (ctx, op) => { const c = AA4.charOfCard(ctx.S, (op.answer || [])[0]); if (c) for (const id of c.perm.slice()) AA4.moveCard(ctx, id, { z: "discard" }); };
  /** EX0119: "≪あなたの任意のパワーカード1枚≫を捨て札する" — any power card on the field */
  A.anyPowerDiscard = (ctx, s, e) => {
    const S = ctx.S, opts = Object.values(S.chars).flatMap(c => c.power);
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 1, max: 1, reason: "Choose a power card to discard", then: [{ op: "toDiscard", seat: e.seat }] });
  };
  /** EX0182: "≪このキャラクター≫に次に与えられるダメージを無効化する" */
  A.negateNextDamage = (ctx, s, e) => { if (e.ch && ctx.S.chars[e.ch]) mod(ctx, e, { to: { ch: e.ch }, key: "negateNext", op: "grant", value: true, until: s.until || "main" }); };
  /** EX0146: "このキャラクターに「X」がセットされていない場合、≪あなたの手札の「X」1枚≫をこのキャラクターにセットする" */
  A.handJpOntoSelf = (ctx, s, e) => {
    const S = ctx.S, ch = e.ch && S.chars[e.ch], jp = x => ((ctx.db.card(S.cards[x].key) || {}).jp || "").replace(/\s+/g, "");
    if (!ch || ch.perm.some(id => jp(id) === s.jp)) return;
    const opts = S.players[e.seat].zones.hand.filter(id => jp(id) === s.jp);
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 1, max: 1, reason: "Set it on this character", then: [{ op: "handJpOntoSelfGo", ch: e.ch }] });
  };
  OPS.handJpOntoSelfGo = (ctx, op) => { const id = (op.answer || [])[0]; if (id && ctx.S.chars[op.ch] && ctx.S.cards[id].place.z === "hand") { AA4.moveCard(ctx, id, { z: "char", ch: op.ch, role: "perm" }); ctx.emit({ e: "entered", card: id, seat: ctx.S.cards[id].owner, ch: op.ch }); } };
  /** EX0359 / EX0360: "…あなたのデッキの上からカードをX枚捨て札することが可能。そうした場合、…+Xして判定する" (the trigger asks) */
  A.millBoost = (ctx, s, e) => {
    const S = ctx.S; if (!e.ch || !S.chars[e.ch]) return;
    const x = +e.x || 0, d = S.players[e.seat].zones.deck; if (x <= 0 || d.length < x) return;
    for (let k = 0; k < x; k++) AA4.moveCard(ctx, d[d.length - 1], { z: "discard" });
    for (const k of s.keys || ["at"]) mod(ctx, e, { to: { ch: e.ch }, key: k, op: "add", value: x, until: "battle" });
  };
  /** EX0277: "≪あなたのデッキの上から最大X枚まで≫を、…パーマネントカード・Nとしてこのキャラクターにセットする" */
  A.deckTopPermTokens = (ctx, s, e) => {
    const S = ctx.S, x = Math.min(+e.x || 0, S.players[e.seat].zones.deck.length); if (!e.ch || !S.chars[e.ch] || x <= 0) return;
    const opts = Array.from({ length: x + 1 }, (_, i) => String(i));
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, reason: `How many cards from the top of your deck become “${s.token.name}”? (0 – ${x})`, then: [{ op: "deckTopPermTokensGo", e, token: s.token }] });
  };
  OPS.deckTopPermTokensGo = (ctx, op) => { const S = ctx.S, n = +((op.answer || [])[0]) || 0, d = S.players[op.e.seat].zones.deck; for (let k = 0; k < n && d.length && S.chars[op.e.ch]; k++) permTokenOn(ctx, d[d.length - 1], op.e.ch, op.token); };
  /** EXPP044: "バトル開始時に≪精神力X以下のバトル相手全て≫を捨て札する" */
  A.battleOppKillIfSe = (ctx, s, e) => { const S = ctx.S, x = +e.x || 0; if (!e.ch || !S.chars[e.ch]) return; for (const o of AA4.battleOppsOf(S, e.ch)) if (S.chars[o] && (AA4.charStats(S, ctx.db, o).se || 0) <= x) AA4.defeat(ctx, o, { why: `discarded by ${srcLabel(ctx, e)}`, bySeat: e.seat }); };
  /** EXPR008: "≪このキャラクターのバトル相手のキャラクターにセットされている、あなたの任意のパーマネントカード1枚≫を捨て札する" */
  A.battleOppPermDiscard = (ctx, s, e) => {
    const S = ctx.S; if (!e.ch || !S.chars[e.ch]) return;
    const opts = AA4.battleOppsOf(S, e.ch).filter(o => S.chars[o]).flatMap(o => S.chars[o].perm);
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 1, max: 1, reason: "Choose a Permanent card of the battle opponent to discard", then: [{ op: "toDiscard", seat: e.seat }] });
  };
  /** EXPR052: name a card type, shuffle your deck, reveal its top card: that type → draw N */
  A.guessTopDraw = (ctx, s, e) => {
    const types = ["Character", "Break", "Permanent", "Project", "Fast"];
    if (!ctx.S.players[e.seat].zones.deck.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: types, labels: types.map(t => t + " card"), reason: "Name a card type: your deck is shuffled and its top card revealed", then: [{ op: "shuffle", seat: e.seat }, { op: "guessTopDrawGo", seat: e.seat, n: s.n || 2 }] });
  };
  OPS.guessTopDrawGo = (ctx, op) => {
    const S = ctx.S, t = (op.answer || [])[0], d = S.players[op.seat].zones.deck; if (!d.length) return;
    const id = d[d.length - 1]; AA4.revealTo(S, [id], "all");
    const ok = !!t && (ctx.db.card(S.cards[id].key) || {}).type === t;
    ctx.emit({ e: "note", text: `Named ${t}: ${AA4.cardName(ctx.db.card(S.cards[id].key) || {})} — ${ok ? `draw ${op.n}` : "no draw"}` });
    if (ok) AA4.enqueue(S, [{ op: "draw", seat: op.seat, n: op.n }], true);
  };
  A.takeForSel = (ctx, s, e) => { if (e.ch && ctx.S.chars[e.ch]) mod(ctx, e, { to: { ch: e.ch }, key: "takeFor", op: "grant", value: s.value || {}, until: s.until || "turn" }); };   // EXPR063
  /** PR335: "≪プレイヤー全て≫の手札X枚を無作為に選んで捨て札する" */
  A.randomHandDiscard = (ctx, s, e, r) => { const S = ctx.S, n = nOf(s, e); for (const seat of seats(r)) { const h = S.players[seat].zones.hand; for (let k = 0; k < n && h.length; k++) AA4.moveCard(ctx, h[AA4.randInt(S, h.length)], { z: "discard" }); } };
  /** EX0394: "…パワーが精神力と等しくなるか、あなたの手札がなくなるまで、あなたの手札をパワーカードとして、このキャラクターにセットする" */
  A.handToPowerUntilSe = (ctx, s, e) => {
    const S = ctx.S, ch = e.ch && S.chars[e.ch]; if (!ch) return;
    const need = (AA4.charStats(S, ctx.db, e.ch).se || 0) - ch.power.length, h = S.players[e.seat].zones.hand, n = Math.min(need, h.length);
    if (n <= 0) return;
    if (n === h.length) { for (const id of h.slice()) AA4.moveCard(ctx, id, { z: "char", ch: e.ch, role: "power" }); return; }
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: h.slice(), min: n, max: n, reason: `Choose ${n} hand card${n === 1 ? "" : "s"}: they become power cards of this character`, then: [{ op: "handToPowerGo", ch: e.ch }] });
  };
  OPS.handToPowerGo = (ctx, op) => { for (const id of op.answer || []) if (ctx.S.chars[op.ch] && ctx.S.cards[id].place.z === "hand") AA4.moveCard(ctx, id, { z: "char", ch: op.ch, role: "power" }); };
  /** PR334: "≪あなたの任意のキャラクタ-1人にセットされているパワーカードX枚≫を捨て札する" */
  A.pickCharPowerDiscardX = (ctx, s, e) => {
    const S = ctx.S, x = s.nFixed != null ? s.nFixed : +e.x || 0, opts = Object.keys(S.chars).filter(id => S.chars[id].power.length); if (!opts.length || x <= 0) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 1, max: 1, reason: `Choose a character: ${x} of its power cards are discarded`, then: [{ op: "pickCharPowerDiscardXGo", x, seat: e.seat }] });
  };
  OPS.pickCharPowerDiscardXGo = (ctx, op) => {
    const c = AA4.charOfCard(ctx.S, (op.answer || [])[0]); if (!c) return;
    if (c.power.length <= op.x) { for (const id of c.power.slice()) AA4.moveCard(ctx, id, { z: "discard" }); return; }
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: c.power.slice(), min: op.x, max: op.x, reason: `Choose ${op.x} power cards to discard`, then: [{ op: "toDiscard", seat: op.seat }] });
  };
  A.keepNextAlly = (ctx, s, e) => { mod(ctx, e, { to: { seat: e.seat }, key: "keepNext", op: "grant", value: true, until: s.until || "turn" }); };
  /** "次にこのキャラクターが…バトルする際、…" (EX0509 / EX0536): mods that last until that battle ends */
  A.nextBattleMods = (ctx, s, e) => { if (!e.ch || !ctx.S.chars[e.ch]) return; for (const m of s.mods || []) mod(ctx, e, Object.assign({ to: { ch: e.ch }, key: m.key, op: m.op || "add", value: m.value, until: s.until || "turn", nextBattle: true }, s.cond ? { cond: s.cond } : {})); };
  /* ---------- M3a (Revise#159) ---------- */
  /** A3-01 0091: "…ガード宣言された場合、≪ガード宣言したキャラクターのオーナー≫に、ただちに(X)ダメージ…X = この精神攻撃力 − ガードしたキャラクターのパワーカードの枚数" */
  A.guardOwnerHit = (ctx, s, e) => {
    const S = ctx.S, me = e.card && AA4.charOfCard(S, e.card), g = e.evCh && S.chars[e.evCh]; if (!me || !g) return;
    const st = AA4.charStats(S, ctx.db, me.id), x = Math.max(0, (st.atMental ? st.at || 0 : 0) - g.power.length);
    if (x > 0) AA4.damagePlayer(ctx, g.owner, { normal: 0, mental: x }, { from: me.id, fromSeat: e.seat });
  };
  A.thisCardFromDamage = (ctx, s, e) => { const c = e.card && ctx.S.cards[e.card]; if (c && c.place.z === "damage") AA4.moveCard(ctx, e.card, s.dest === "back" ? { z: "back", seat: c.owner } : { z: "hand", seat: c.owner }); };   // "あなたのダメージ置き場にあるこのカードを手札に戻す" (A4-05 0994, Revise#354); dest "back": "…あなたの支配キャラクターとして…セット宣言可能" (PP240, Revise#356)
  A.selfCardToHand = (ctx, s, e) => { const c = e.card && ctx.S.cards[e.card]; if (c && c.place.z === "char") AA4.moveCard(ctx, e.card, { z: "hand", seat: c.owner }); };
  A.cancelEvItem = (ctx, s, e) => { if (e.evItem) return A.cancelItem(ctx, s, e, [{ item: e.evItem }]); };
  /** A3-03 0556: "≪あなたの任意の、このキャラクターにセットされているパワーカード1枚≫をダメージ置き場に置く" */
  A.selfPowerToDamage = (ctx, s, e) => {
    const S = ctx.S, ch = e.ch && S.chars[e.ch]; if (!ch || !ch.power.length) return;
    const n = s.n === "all" ? ch.power.length : Math.min(s.n || 1, ch.power.length);
    if (n === ch.power.length) { for (const id of ch.power.slice()) AA4.moveCard(ctx, id, { z: "damage" }); return; }
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: ch.power.slice(), min: n, max: n, reason: "Choose the power card to put into the Damage Pile", then: [{ op: "toDamageCards" }] });
  };
  OPS.toDamageCards = (ctx, op) => { for (const id of op.answer || []) AA4.moveCard(ctx, id, { z: "damage" }); };
  /** A3-05 0728: "≪あなたのダメージ置き場のパーマネントカード全て≫を“X”にセットする" */
  A.damagePermsOntoSelf = (ctx, s, e) => { const S = ctx.S; if (!e.ch || !S.chars[e.ch]) return; for (const id of S.players[e.seat].zones.damage.filter(x => (ctx.db.card(S.cards[x].key) || {}).type === "Permanent")) AA4.moveCard(ctx, id, { z: "char", ch: e.ch, role: "perm" }); };
  /** A3-03 0480: "目標が捨て札になる場合、このキャラクターのパワーカード1枚を捨て札することで、目標を場に残す" */
  A.keepByPowerT = (ctx, s, e, r) => { if (!e.ch || !ctx.S.chars[e.ch]) return; for (const ch of chars(r)) mod(ctx, e, { to: { ch }, key: "keepByPower", op: "grant", value: true, until: s.until || "turn" }); };
  A.guardCancelByT = (ctx, s, e, r) => { if (!e.ch || !ctx.S.chars[e.ch]) return; for (const ch of chars(r)) mod(ctx, e, { to: { ch }, key: "guardCancelBy", op: "grant", value: { ch: e.ch }, until: s.until || "main" }); };   // A3-04 0676
  /** A3-01 0026: "…からコストが支払われた場合、そのキャラクターからパワーカードX枚を捨て札しなければ、そのキャラクターは捨て札される" */
  OPS.payDoomAsk = (ctx, op) => {
    const S = ctx.S, ch = S.chars[op.ch]; if (!ch) return;
    if (op.n <= 0) return;
    if (ch.power.length < op.n) return AA4.defeat(ctx, op.ch, { why: `${op.label}: could not discard ${op.n} power cards` });
    return AA4.ask(ctx, { seat: ch.owner, kind: "yesno", reason: `${op.label}: discard ${op.n} power card${op.n === 1 ? "" : "s"} of this character? (otherwise it is discarded)`, ref: { ch: op.ch }, then: [{ op: "payDoomGo", ch: op.ch, n: op.n, label: op.label }] });
  };
  OPS.payDoomGo = (ctx, op) => {
    const S = ctx.S, ch = S.chars[op.ch]; if (!ch) return;
    if ((op.answer || [])[0] !== "yes") return AA4.defeat(ctx, op.ch, { why: `${op.label}: did not discard power cards` });
    if (ch.power.length <= op.n) { for (const id of ch.power.slice()) AA4.moveCard(ctx, id, { z: "discard" }); return; }
    return AA4.ask(ctx, { seat: ch.owner, kind: "cards", options: ch.power.slice(), min: op.n, max: op.n, reason: `Choose ${op.n} power card${op.n === 1 ? "" : "s"} to discard`, then: [{ op: "toDiscard", seat: ch.owner }] });
  };
  /** A3-03 0449 …: "目標の≪…キャラクター1人≫にセットされているパワーカードから、あなたの任意のカードをN枚まで捨て札する" */
  A.powerPickDiscardT = (ctx, s, e, r) => {
    const S = ctx.S, c = chars(r)[0] && S.chars[chars(r)[0]]; if (!c || !c.power.length) return;
    const n = Math.min(nOf(s, e), c.power.length);
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: c.power.slice(), min: s.upTo ? 0 : n, max: n, reason: `Choose ${s.upTo ? "up to " : ""}${n} power card${n === 1 ? "" : "s"}${s.dest === "hand" ? " for their owner's hand" : s.dest === "damage" ? " for their owner's Damage Pile" : " to discard"}`, then: [{ op: s.dest === "hand" ? "toHand" : s.dest === "damage" ? "toDamageCards" : "toDiscard", seat: e.seat }] });
  };
  /** A3-02 0337: "≪あなたの任意のキャラクタ-X体にセットされている、あなたの任意のパワーカード1枚ずつ≫を捨て札する" / 0338: every character, one each → its owner's deck */
  A.charsPowerOneEach = (ctx, s, e) => {
    const S = ctx.S, opts = Object.keys(S.chars).filter(id => S.chars[id].power.length);
    if (!opts.length) return;
    if (s.all) return OPS.charsPowerOneGo(ctx, { seat: e.seat, todo: opts, dest: s.dest || "discard" });
    const n = Math.min(nOf(s, e), opts.length); if (n <= 0) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: n, max: n, reason: `Choose ${n} character${n === 1 ? "" : "s"}: one power card of each is discarded`, then: [{ op: "charsPowerOnePicked", seat: e.seat, dest: s.dest || "discard" }] });
  };
  OPS.charsPowerOnePicked = (ctx, op) => OPS.charsPowerOneGo(ctx, { seat: op.seat, dest: op.dest, todo: (op.answer || []).map(id => (AA4.charOfCard(ctx.S, id) || {}).id).filter(Boolean) });
  OPS.charsPowerOneGo = (ctx, op) => {
    const S = ctx.S, dest = op.dest;
    const put = id => { if (!S.cards[id] || S.cards[id].place.role !== "power") return; if (dest === "deckShuffle") { const o = S.cards[id].owner; AA4.moveCard(ctx, id, { z: "deck", seat: o }); AA4.enqueue(S, [{ op: "shuffle", seat: o }]); } else AA4.moveCard(ctx, id, { z: "discard" }); };
    for (const id of op.answer || []) put(id);
    const todo = (op.todo || []).filter(id => S.chars[id] && S.chars[id].power.length);
    if (!todo.length) return;
    const ch = todo[0], rest = todo.slice(1), pw = S.chars[ch].power.slice();
    if (pw.length === 1) return OPS.charsPowerOneGo(ctx, { seat: op.seat, dest, todo: rest, answer: pw });
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: pw, min: 1, max: 1, reason: "Choose one power card of this character", then: [{ op: "charsPowerOneGo", seat: op.seat, dest, todo: rest }] });
  };
  /** A3-02 0382: "≪あなたの対戦相手全てのダメージ置き場のカード全て≫を捨て札する" */
  A.oppPilesWipe = (ctx, s, e) => { const S = ctx.S; for (const x of AA4.living(S).filter(y => y !== e.seat)) for (const id of S.players[x].zones[s.zone || "damage"].slice()) AA4.moveCard(ctx, id, { z: "discard" }); };
  /** A3-03 0450: "≪あなたの任意の勢力1つの、精神力X以下のキャラクター全て≫の耐久力に-1する" */
  A.factionPickMod = (ctx, s, e) => {
    const opts = ["E.G.O.", "Arayashiki", "WIZ-DOM", "Darklore", "Polestar Empire", "Eraser"];
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, reason: "Choose a faction", then: [{ op: "factionPickModGo", s, e }] });
  };
  OPS.factionPickModGo = (ctx, op) => {
    const S = ctx.S, f = (op.answer || [])[0], s = op.s, e = op.e, x = +e.x || 0; if (!f) return;
    const sel = JSON.parse(JSON.stringify(s.sel || {}).replace(/"n":"X"/g, `"n":${x}`));
    for (const id of Object.keys(S.chars).filter(c => AA4.charStats(S, ctx.db, c).faction === f && AA4.matchChar(S, ctx.db, sel, c, { seat: e.seat }))) mod(ctx, e, { to: { ch: id }, key: s.key, op: "add", value: s.n, until: s.until || "main" });
  };
  /** A3-02 0416: "≪あなたの手札全てとあなたのテリトリーのキャラクター全て≫をあなたのデッキに戻し、そのデッキをシャッフルする" */
  A.handAndCharsToDeck = (ctx, s, e) => {
    const S = ctx.S, p = S.players[e.seat];
    for (const id of p.zones.hand.slice()) AA4.moveCard(ctx, id, { z: "deck", seat: e.seat });
    for (const ch of Object.keys(S.chars).filter(c => S.chars[c].owner === e.seat)) { const cs = S.chars[ch].stack.concat(S.chars[ch].perm, S.chars[ch].power); for (const id of cs) AA4.moveCard(ctx, id, { z: "deck", seat: S.cards[id].owner }); }
    AA4.enqueue(S, [{ op: "shuffle", seat: e.seat }], true);
  };
  /** A3-01 0093: "目標の≪あなたの捨て札置き場のブレイクカード1枚≫を、あなたのテリトリーのキャラクターにセットする。…その後、…X枚引き、…パワーカードとしてセットする (X = 目標のコスト)" */
  A.targetBreakSetPower = (ctx, s, e, r) => {
    const S = ctx.S, x = r.find(y => y.card && S.cards[y.card] && S.cards[y.card].place.z === "discard"); if (!x) return;
    const inf = ctx.db.card(S.cards[x.card].key) || {}, opts = AA4.breakTargets(S, ctx.db, e.seat, x.card, false, inf).filter(ch => S.chars[ch].owner === e.seat);
    if (!opts.length) return ctx.emit({ e: "note", text: "No character of yours it can break" });
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(ch => AA4.topOf(S.chars[ch])), min: 1, max: 1, reason: "Choose the character it is set on", then: [{ op: "targetBreakSetPowerGo", seat: e.seat, card: x.card, n: typeof inf.cost === "number" ? inf.cost : 0 }] });
  };
  OPS.targetBreakSetPowerGo = (ctx, op) => {
    const S = ctx.S, c = AA4.charOfCard(S, (op.answer || [])[0]); if (!c) return;
    OPS.breakFromHandGo(ctx, { ch: c.id, seat: op.seat, answer: [op.card], anyZone: true });
    const ch = AA4.charOfCard(S, op.card), d = S.players[op.seat].zones.deck;
    for (let k = 0; k < op.n && ch && d.length; k++) AA4.moveCard(ctx, d[d.length - 1], { z: "char", ch: ch.id, role: "power" });
  };
  /** A3-04 0640: "あなたの任意のあなたの手札X枚をパワーカードとしてセット" — any number */
  A.handToPowerAny = (ctx, s, e) => {
    const S = ctx.S, h = S.players[e.seat].zones.hand; if (!e.ch || !S.chars[e.ch] || !h.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: h.slice(), min: 0, max: h.length, auto: false, reason: "Choose any number of hand cards: they become power cards of this character", then: [{ op: "handToPowerGo", ch: e.ch }] });
  };
  A.allPowerToDecks = (ctx, s, e) => { const S = ctx.S, seats = new Set(); for (const ch of Object.values(S.chars)) for (const id of ch.power.slice()) { seats.add(S.cards[id].owner); AA4.moveCard(ctx, id, { z: "deck", seat: S.cards[id].owner }); } AA4.enqueue(S, [...seats].map(seat => ({ op: "shuffle", seat })), true); };   // A3-03 0559
  /** A3-04 0689: "目標の≪キャラクター1人≫は、あなたの任意の勢力1つのキャラクターにガードされない" */
  A.noGuardByFactionPick = (ctx, s, e, r) => {
    const cs = chars(r); if (!cs.length) return;
    const opts = ["E.G.O.", "Arayashiki", "WIZ-DOM", "Darklore", "Polestar Empire", "Eraser"];
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, reason: "Choose a faction: its characters can't guard against it", then: [{ op: "noGuardByFactionGo", e, cs, until: s.until || "main" }] });
  };
  OPS.noGuardByFactionGo = (ctx, op) => { const f = (op.answer || [])[0]; if (f) for (const ch of op.cs) if (ctx.S.chars[ch]) mod(ctx, op.e, { to: { ch }, key: "noGuardBy", op: "grant", value: { faction: f }, until: op.until }); };
  /** A3-05 0730: "≪あなたの任意の…キャラクタ-X体にセットされているパワーカード全て≫を捨て札する" */
  A.pickCharsPowerAll = (ctx, s, e) => {
    const S = ctx.S, opts = Object.keys(S.chars).filter(id => S.chars[id].power.length && AA4.matchChar(S, ctx.db, s.sel || {}, id, { seat: e.seat })), n = Math.min(nOf(s, e), opts.length);
    if (n <= 0) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: n, max: n, reason: `Choose ${n} character${n === 1 ? "" : "s"}: all their power cards are discarded`, then: [{ op: "pickCharsPowerAllGo" }] });
  };
  OPS.pickCharsPowerAllGo = (ctx, op) => { for (const id of op.answer || []) { const c = AA4.charOfCard(ctx.S, id); if (c) for (const p of c.power.slice()) AA4.moveCard(ctx, p, { z: "discard" }); } };
  /** A3-05 0731: "≪あなたの任意のあなたのテリトリーのキャラクター≫に、あなたの任意のあなたの手札X枚までを、パワーカードとしてセットできる" */
  A.handToOwnPowerUpTo = (ctx, s, e) => {
    const S = ctx.S, opts = Object.keys(S.chars).filter(id => S.chars[id].owner === e.seat), h = S.players[e.seat].zones.hand; if (!opts.length || !h.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 1, max: 1, reason: "Choose your character", then: [{ op: "handToOwnPowerUpToGo", seat: e.seat, n: Math.min(nOf(s, e), h.length) }] });
  };
  OPS.handToOwnPowerUpToGo = (ctx, op) => { const c = AA4.charOfCard(ctx.S, (op.answer || [])[0]); if (!c || op.n <= 0) return; return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: ctx.S.players[op.seat].zones.hand.slice(), min: 0, max: op.n, auto: false, reason: `Choose up to ${op.n} hand cards: they become its power cards`, then: [{ op: "handToPowerGo", ch: c.id }] }); };
  /** A3-05 0763: "目標の≪キャラクター1人≫と、目標にセットされているカード全てをオーナーのデッキに戻し、そのデッキをシャッフルする" */
  A.charAllToDeck = (ctx, s, e, r) => { const S = ctx.S; for (const ch of chars(r)) { const c = S.chars[ch]; if (!c) continue; const ids = c.stack.concat(c.perm, c.power), seats = new Set(ids.map(id => S.cards[id].owner)); for (const id of ids) AA4.moveCard(ctx, id, { z: "deck", seat: S.cards[id].owner }); AA4.enqueue(S, [...seats].map(seat => ({ op: "shuffle", seat })), true); } };
  /** A3-05 0764: "あなたの手札全てをデッキに戻し、デッキをシャッフルする" */
  A.handAllToDeck = (ctx, s, e) => { const S = ctx.S; for (const id of S.players[e.seat].zones.hand.slice()) AA4.moveCard(ctx, id, { z: "deck", seat: e.seat }); AA4.enqueue(S, [{ op: "shuffle", seat: e.seat }], true); };
  /** A3-05 0803: name a faction; look at the target player's hand; discard all cards of that faction there */
  A.nameFactionHandWipe = (ctx, s, e, r) => {
    const seat = seats(r)[0]; if (seat == null) return;
    const opts = ["E.G.O.", "Arayashiki", "WIZ-DOM", "Darklore", "Polestar Empire", "Eraser"];
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, reason: "Name a faction: every card of it in that player's hand is discarded", then: [{ op: "nameFactionHandWipeGo", seat, by: e.seat }] });
  };
  OPS.nameFactionHandWipeGo = (ctx, op) => { const S = ctx.S, f = (op.answer || [])[0], h = S.players[op.seat].zones.hand; AA4.revealTo(S, h, op.by); for (const id of h.filter(x => (ctx.db.card(S.cards[x].key) || {}).faction === f)) AA4.moveCard(ctx, id, { z: "discard" }); };
  /** A3-05 0839: "目標は自分の捨て札置き場、ダメージ置き場から、目標の任意のカード1枚ずつを手札に戻す" */
  A.pilesOneEachToHand = (ctx, s, e, r) => { const seat = seats(r)[0]; if (seat == null) return; AA4.enqueue(ctx.S, ["discard", "damage"].filter(z => ctx.S.players[seat].zones[z].length).map(z => ({ op: "pileOneToHand", seat, z })), true); };
  OPS.pileOneToHand = (ctx, op) => { const p = ctx.S.players[op.seat].zones[op.z]; if (!p.length) return; return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: p.slice(), min: 1, max: 1, reason: `Choose a card of your ${op.z === "damage" ? "Damage Pile" : "Discard Pile"} to return to your hand`, then: [{ op: "toHand", seat: op.seat }] }); };
  /* ---------- M3a Fast (Revise#159) ---------- */
  A.permHoldersStrip = (ctx, s, e) => { const S = ctx.S; for (const ch of Object.values(S.chars).filter(c => c.perm.length)) for (const id of ch.perm.concat(ch.power)) AA4.moveCard(ctx, id, { z: "discard" }); };   // A3-02 0310
  A.bounceItem = (ctx, s, e, r) => {   // A3-02 0345: "目標の≪使用宣言されているプロジェクトカード1枚≫をオーナーの手札に戻す"
    const S = ctx.S;
    for (const x of r.filter(y => y.item)) { const i = S.stack.findIndex(it => it.id === x.item); if (i < 0) continue; if (AA4.itemShielded(ctx, S.stack[i], e)) continue; const [it] = S.stack.splice(i, 1); for (const m of S.modifiers.filter(y => y.src && y.src.card === it.card)) AA4.endMod(ctx, m.id); if (it.card && S.cards[it.card]) AA4.moveCard(ctx, it.card, { z: "hand", seat: S.cards[it.card].owner }); ctx.emit({ e: "note", text: "A declared Project card goes back to its owner's hand" }); }
  };
  A.discardProjCostLe = (ctx, s, e) => { const S = ctx.S, x = +e.x || 0; for (const c of Object.values(S.cards).filter(c => c.place.z === "special" && (ctx.db.card(c.key) || {}).type === "Project" && typeof (ctx.db.card(c.key) || {}).cost === "number" && (ctx.db.card(c.key) || {}).cost <= x)) { for (const m of S.modifiers.filter(y => y.src && y.src.card === c.id)) AA4.endMod(ctx, m.id); AA4.moveCard(ctx, c.id, { z: "discard" }); } };   // A3-02 0385
  A.powerToOwnerHandT = (ctx, s, e, r) => { for (const ch of chars(r)) if (ctx.S.chars[ch]) for (const id of ctx.S.chars[ch].power.slice()) AA4.moveCard(ctx, id, { z: "hand", seat: ctx.S.cards[id].owner }); };
  A.watchOnTarget = (ctx, s, e, r) => { for (const ch of chars(r)) for (const on of s.on || ["attack"]) mod(ctx, e, { to: { seat: e.seat }, key: "watch", op: "grant", value: { on, onlyCh: ch, sel: {}, effect: s.effect }, until: s.until || "main" }); };   // A3-04 0642 (Revise#159)
  A.selfCardToHandAny = (ctx, s, e) => { const c = e.card && ctx.S.cards[e.card]; if (c && ["special", "discard", "char"].includes(c.place.z)) AA4.moveCard(ctx, e.card, { z: "hand", seat: c.owner }); };   // A3-05 0807
  /* ---------- M2g final (Revise#161) ---------- */
  /** EX0136: "目標の≪あなたの対戦相手の支配キャラクター1人≫はこのキャラクターとバトルを行う" — a battle at once: no attack cost, no guards, no player hit */
  A.forceBattle = (ctx, s, e, r) => {
    const S = ctx.S, t = chars(r)[0];
    if (!e.ch || !S.chars[e.ch] || !t || !S.chars[t] || S.battle) return;
    S.battle = { id: AA4.newId(S, "b"), kind: "attack", forced: true, attacker: e.ch, aSeat: S.chars[e.ch].owner, target: { ch: t }, paidKeys: { attack: [], guard: [] }, defender: S.chars[t].owner, guard: null, joined: { att: [], grd: [] }, boost: 0, payers: [], step: "response" };
    S.passed = [];
    ctx.emit({ e: "note", text: `${srcLabel(ctx, e)}: a battle with the target (not an attack)` });
  };
  /** EX0068 / EXPR001 (Revise#203): "≪あなたと指定されたプレイヤー≫は、ネームを持つ自分の支配キャラクター1人を指定する。その後、指定したキャラクター同士はバトルを行う" */
  A.duelPick = (ctx, s, e, r) => {
    const S = ctx.S, opp = seats(r)[0], named = seat => AA4.controlledOf(S, seat).filter(id => AA4.charStats(S, ctx.db, id).named);
    if (opp == null || S.battle || !named(e.seat).length || !named(opp).length) { ctx.emit({ e: "note", text: "No battle: a player has no Controlled name-level character" }); return; }
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: named(e.seat).map(id => AA4.topOf(S.chars[id])), min: 1, max: 1, reason: "Choose your name-level character for the battle", then: [{ op: "duelPickOpp", e, opp }] });
  };
  OPS.duelPickOpp = (ctx, op) => {
    const S = ctx.S, mine = AA4.charOfCard(S, (op.answer || [])[0]); if (!mine) return;
    const opts = AA4.controlledOf(S, op.opp).filter(id => AA4.charStats(S, ctx.db, id).named);
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: op.opp, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 1, max: 1, reason: "Choose your name-level character for the battle", then: [{ op: "duelGo", e: op.e, mine: mine.id }] });
  };
  OPS.duelGo = (ctx, op) => { const c = AA4.charOfCard(ctx.S, (op.answer || [])[0]); if (c && ctx.S.chars[op.mine]) A.forceBattle(ctx, {}, Object.assign({}, op.e, { ch: op.mine }), [{ ch: c.id }]); };
  /** EX0137: you choose one Controlled Character of the attacked player: it guards (no cost, even if it already acted) */
  A.forceGuardPick = (ctx, s, e) => {
    const S = ctx.S, b = S.battle; if (!b || b.attacker !== e.ch || b.guard || b.defender == null) return;
    const opts = AA4.controlledOf(S, b.defender); if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 1, max: 1, reason: "Choose the character that must guard against this attack", then: [{ op: "forceGuardPickGo", e }] });
  };
  OPS.forceGuardPickGo = (ctx, op) => { const c = AA4.charOfCard(ctx.S, (op.answer || [])[0]); if (c) A.forceGuardT(ctx, {}, op.e, [{ ch: c.id }]); };
  /** EX0192: "このキャラクターにセットされているインストール全て" → Discard Pile */
  A.permTokensDiscard = (ctx, s, e) => { const S = ctx.S, ch = e.ch && S.chars[e.ch]; if (!ch) return; for (const id of ch.perm.filter(x => S.cards[x].permToken && S.cards[x].permToken.name === s.name)) AA4.moveCard(ctx, id, { z: "discard" }); };
  /** EX0231: "≪このキャラクター≫は、ネームレベルキャラクター1人を目標に、コストを支払わずにアタック宣言可能" */
  A.attackNamedFree = (ctx, s, e) => {
    const S = ctx.S; if (!e.ch || !S.chars[e.ch] || S.battle || AA4.charStats(S, ctx.db, e.ch).noAttack) return;
    const opts = Object.keys(S.chars).filter(id => S.chars[id].owner !== e.seat && AA4.charStats(S, ctx.db, id).named);
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 0, max: 1, auto: false, reason: "You may attack a Named character with it (no cost)", then: [{ op: "attackNamedFreeGo", ch: e.ch }] });
  };
  OPS.attackNamedFreeGo = (ctx, op) => { const S = ctx.S, c = AA4.charOfCard(S, (op.answer || [])[0]), ch = S.chars[op.ch]; if (!c || !ch || S.battle) return; return OPS.battleDeclared(ctx, { d: { kind: "attack", seat: ch.owner, ch: op.ch, target: { ch: c.id }, boost: 0, paid: 0, paidKeys: [] } }); };
  /** EXPR037: "あなたの手札のカードを任意の枚数パワーカードとしてセット" */
  A.handToPowerAnySelf = (ctx, s, e) => A.handToPowerAny(ctx, s, e);
  /** EXPP024: after a Project / Fast card paid only from this character: pay 1 more from it → one such card from the Discard Pile to your hand */
  OPS.payBackAsk = (ctx, op) => {
    const S = ctx.S, ch = S.chars[op.ch]; if (!ch || !ch.power.length) return;
    const opts = S.players[op.seat].zones.discard.filter(id => { const inf = ctx.db.card(S.cards[id].key) || {}; return ["Project", "Fast"].includes(inf.type) && (inf.jp || "").includes(op.jpHas); });
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: opts, min: 0, max: 1, auto: false, reason: `Pay 1 more from ${AA4.cardName(ctx.db.card(S.cards[AA4.topOf(ch)].key) || {})} to return one of these to your hand?`, then: [{ op: "payBackGo", ch: op.ch, seat: op.seat }] });
  };
  OPS.payBackGo = (ctx, op) => { const S = ctx.S, id = (op.answer || [])[0], ch = S.chars[op.ch]; if (!id || !ch || !ch.power.length) return; AA4.moveCard(ctx, ch.power[ch.power.length - 1], { z: "discard" }); AA4.moveCard(ctx, id, { z: "hand", seat: op.seat }); };
  /** EX0250: after a targeted Project paid only from this character: pay 1 more per extra target (up to N) — it works again for each */
  OPS.extraTargetsAsk = (ctx, op) => {
    const S = ctx.S, db = ctx.db, ch = S.chars[op.ch]; if (!ch) return;
    const max = Math.min(op.max, ch.power.length); if (max <= 0) return;
    const opts = Array.from({ length: max + 1 }, (_, i) => String(i));
    return AA4.ask(ctx, { seat: op.seat, kind: "pick", options: opts, reason: `${AA4.cardName(db.card(S.cards[op.card].key) || {})}: pay more from this character to aim it at more targets? (1 each, up to ${max})`, then: [{ op: "extraTargetsGo", ch: op.ch, seat: op.seat, card: op.card, x: op.x, used: op.used }] });
  };
  OPS.extraTargetsGo = (ctx, op) => {
    const S = ctx.S, db = ctx.db, n = +((op.answer || [])[0]) || 0, ch = S.chars[op.ch]; if (!n || !ch) return;
    for (let k = 0; k < n && ch.power.length; k++) AA4.moveCard(ctx, ch.power[ch.power.length - 1], { z: "discard" });
    AA4.enqueue(S, Array.from({ length: n }, () => ({ op: "extraTargetPick", seat: op.seat, card: op.card, x: op.x })), true);
  };
  OPS.extraTargetPick = (ctx, op) => {
    const S = ctx.S, db = ctx.db, play = (AA4.cardInfo(S, db, op.card) || {}).play; if (!play || !play.target) return;
    const cands = AA4.targetCandidates(S, db, play.target, { seat: op.seat, card: op.card, x: op.x }).filter(t => t.ch && S.chars[t.ch] && S.chars[t.ch].owner !== op.seat);
    if (!cands.length) return;
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: cands.map(t => AA4.topOf(S.chars[t.ch])), min: 1, max: 1, reason: "Choose another target: the Project card works on it too", then: [{ op: "extraTargetGo", seat: op.seat, card: op.card, x: op.x }] });
  };
  OPS.extraTargetGo = (ctx, op) => { const S = ctx.S, c = AA4.charOfCard(S, (op.answer || [])[0]); if (!c) return; AA4.runEffect(ctx, (ctx.db.card(S.cards[op.card].key) || {}).play, { seat: op.seat, card: op.card, targets: [{ ch: c.id }], x: op.x }); };
  A.extraTurnLock = (ctx, s, e) => mod(ctx, e, { to: { seat: ctx.S.turn.player }, key: "extraTurn", op: "grant", value: { lock: e.ch }, until: "removed" });   // ザラーム 3756 (Q#60)
  A.extraTurn = (ctx, s, e, r) => { for (const seat of seats(r).length ? seats(r) : [e.seat]) mod(ctx, e, { to: { seat }, key: "extraTurn", op: "grant", value: true, until: "removed" }); };
  A.skipPhase = (ctx, s, e, r) => mod(ctx, e, { to: { seats: seats(r).length ? seats(r) : [e.seat] }, key: "phase", op: "skip", value: s.phase, until: s.until || "turn" });
  /** Search the deck (Event System): cards matching sel → hand, then shuffle. */
  A.search = (ctx, s, e) => AA4.enqueue(ctx.S, [{ op: "searchDeck", seat: e.seat, sel: s.sel || {}, n: nOf(s, e) || 1 }], true);
  OPS.searchDeck = (ctx, op) => {
    const S = ctx.S, deck = S.players[op.seat].zones.deck, opts = deck.filter(id => AA4.cardMatches(ctx.db.card(S.cards[id].key) || {}, op.sel)).sort();
    const n = Math.min(op.n, opts.length);
    AA4.revealTo(S, opts, op.seat);   // a search shows the chooser the cards it may take, face up (Pack, Revise#206); the shuffle after hides the deck again
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: opts, min: 0, max: n, auto: false, reason: `Search your deck${op.label ? " — " + op.label : ""}: choose up to ${n}`,
      then: [{ op: "searchTake", seat: op.seat, distinct: !!op.distinct }] });
  };
  OPS.searchTake = (ctx, op) => {
    if (op.distinct) { const seen = new Set(); op = Object.assign({}, op, { answer: (op.answer || []).filter(id => { const nm = (ctx.db.card(ctx.S.cards[id].key) || {}).name || id; if (seen.has(nm)) return false; seen.add(nm); return true; }) }); }   // 3118: "異なるネームを持つブレイクカード2枚"
    for (const id of op.answer || []) AA4.moveCard(ctx, id, { z: "hand" }, { faceUp: true, visibleTo: [] });   // shown, then in the hand
    for (const id of op.answer || []) { const c = ctx.S.cards[id]; c.faceUp = false; c.visibleTo = [c.owner]; }
    OPS.shuffle(ctx, { seat: op.seat });
  };
  /** Cards from a Damage / Discard Pile, chosen when it resolves (owner: you / opp / any) → hand or Discard Pile. */
  A.pickZone = (ctx, s, e) => {
    const S = ctx.S, zones = s.zones || [s.zone || "discard"], z = zones.join("/"), owners = (s.owner === "evOwner" ? [e.evCh && S.chars[e.evCh] ? S.chars[e.evCh].owner : e.evSeat].filter(x => x != null && S.players[x]) : s.owner === "t" ? (e.targets || []).filter(x => x.seat != null && S.players[x.seat]).map(x => x.seat) : s.owner === "any" ? AA4.living(S) : s.owner === "opp" ? AA4.living(S).filter(x => x !== e.seat) : [e.seat]).filter(x => zones.includes("deck") || !AA4.pileImmuneSeat(S, ctx.db, x, e.seat));   // owner "t": "目標の≪デッキ1つ≫を見て…" (PP270, Revise#364)
    if (s.sel && s.sel.icons === "@effIcons") s = Object.assign({}, s, { sel: Object.assign({}, s.sel, { icons: S.effIcons || ["__none__"] }) });   // "そのキャラクターと同じ分類を持つ" (A3-21 3018, Revise#177)
    const name = s.sel && s.sel.name === "chosen" ? S.effName : s.sel && s.sel.name;
    if (s.sel && s.sel.name === "chosen" && !name) return;
    const match = id => { const inf = ctx.db.card(S.cards[id].key) || {}, sel = s.sel || {}; return (!sel.types || sel.types.includes(inf.type)) && (!sel.faction || sel.faction === inf.faction) && AA4.cardMatches(inf, { name })
      && (!sel.orText || AA4.cardMatches(inf, { name, orText: true }))
      && (!sel.icons || sel.icons.some(i => (inf.icons || []).includes(i))) && (!sel.stat || inf[sel.stat.key] === sel.stat.n) && (!sel.anyOf || sel.anyOf.some(q => AA4.cardSelOk(inf, q))) && (!sel.noBreakRule || !inf.breakRule) && (sel.named == null || !!inf.name === sel.named) && (!sel.jpHas || (inf.jp || "").includes(sel.jpHas)) && (!sel.textHas || (inf.text || "").includes(sel.textHas)) && (!sel.nameHas || (inf.jp || "").includes(sel.nameHas)) && (!sel.jp || (inf.jp || "").replace(/\s+/g, "") === String(sel.jp).replace(/\s+/g, ""))
      && (!sel.onlyIds || sel.onlyIds.includes(id))
      && (!sel.sameJpAsSrc || (!!e.card && !!S.cards[e.card] && id !== e.card && inf.jp === (ctx.db.card(S.cards[e.card].key) || {}).jp))   // "このカードと同じ名称のカード" (3125, Revise#367)
      && (!sel.textRe || new RegExp(sel.textRe).test(String(inf.text || "")))   // "攻撃力と耐久力を同時に上昇させる効果を持つファストカード" (0907, Revise#359)
      && (!sel.factorMet || AA4.factorOk(S, ctx.db, e.seat, inf))   // "あなたが必要ファクターを満たしている" (EX895, Revise#356)
      && (!sel.factorUnmet || !AA4.factorOk(S, ctx.db, e.seat, inf))   // "あなたが必要ファクターを満たしていない" (2202, Revise#180)
      && (!sel.works || AA4.worksOf(inf, sel.works))   // "魔法戦記リリカルなのはForceの…" (Revise#192)
      && (!sel.names || sel.names.includes(String(inf.name || "").replace(/\s+/g, "")))   // "デッキから“A”、“B”、“C”を1枚ずつ" (Revise#201)
      && (!sel.costMaxEv || (e.evCard && S.cards[e.evCard] && typeof inf.cost === "number" && inf.cost <= (+(ctx.db.card(S.cards[e.evCard].key) || {}).cost || 0)))
      && (sel.factorMax == null || Object.values(inf.factor || {}).reduce((x, y) => x + y, 0) <= (sel.factorMax === "X" ? +e.x || 0 : +sel.factorMax)); };   // "必要ファクターがX以下の"
    const opts = owners.flatMap(o => zones.flatMap(zz => (zz === "deck" && s.topN ? S.players[o].zones[zz].slice(-s.topN) : S.players[o].zones[zz]).filter(match)));   // topN: "デッキの上から10枚を見て、その中に…" (EX0069, Revise#360)
    if (s.n === "X" && !(+e.x > 0)) return;   // X = 0: nothing to choose (Revise#166)
    const keyOf = id => { const inf = ctx.db.card(S.cards[id].key) || {}; return s.distinct === "faction" ? inf.faction || "" : inf.name || inf.jp; };   // "異なるネームを持つ / 異なる勢力の" (Revise#180)
    const n = s.n === "all" ? opts.length : Math.min(nOf(s, e) || 1, s.distinct ? new Set(opts.map(keyOf)).size : opts.length);
    if (!n) return;
    const onCh = s.dest === "powerT" ? ((e.targets || []).find(t => t.ch) || {}).ch : s.dest === "powerSelf" ? e.ch : null;   // "…をパワーカードとしてセットする" (Revise#164)
    if ((s.dest === "powerT" || s.dest === "powerSelf") && !(onCh && S.chars[onCh])) return;
    const then = onCh ? [{ op: "toPowerOn", ch: onCh }] : s.dest === "active" ? [{ op: "toActive" }] : s.dest === "perm" ? [{ op: "pickedPerm", seat: e.seat, opts: s.permOn === "evCh" ? [e.evCh].filter(x => x && S.chars[x]) : s.permOn === "self" ? [e.ch].filter(x => x && S.chars[x]) : null }] : [{ op: s.dest === "discard" ? "toDiscard" : s.dest === "back" ? "toBack" : s.dest === "deckTop" ? "toDeckTop" : s.dest === "deckBottom" ? "toDeckBottom" : s.dest === "deckShuffle" ? "toDeckShuffle" : "toHand", seat: e.seat }];
    if (s.n === "all") { AA4.enqueue(S, then.map(o => Object.assign({}, o, { answer: opts })), true); return; }
    if (s.storeFactor) then.unshift({ op: "factorLast" });   // EP199 (Revise#207): "Xはこの効果で捨て札したカードの必要ファクターに等しい"
    if (s.distinct) { const inner = then.slice(); then.length = 0; then.push({ op: "uniqThen", by: s.distinct, then: inner }); }
    AA4.revealTo(S, opts, e.seat);   // the cards it may choose are shown to the chooser
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: s.upTo ? 0 : n, max: n, reason: `Choose ${s.upTo ? "up to " : ""}${n} from ${s.owner === "you" || !s.owner ? "your" : "a"} ${zones.map(x => (x === "damage" ? "Damage Pile" : x === "deck" ? "Deck" : "Discard Pile")).join(" / ")}`, then });
  };
  /** Revise#180: keep one card per name / faction of the picked cards, then go on */
  OPS.uniqThen = (ctx, op) => {
    const S = ctx.S, seen = new Set(), keep = (op.answer || []).filter(id => { const inf = ctx.db.card(S.cards[id].key) || {}, k = op.by === "faction" ? inf.faction || "" : inf.name || inf.jp; if (seen.has(k)) return false; seen.add(k); return true; });
    if ((op.answer || []).length > keep.length) ctx.emit({ e: "note", text: `Only one card of each ${op.by === "faction" ? "faction" : "name"} — ${op.answer.length - keep.length} not taken` });
    AA4.enqueue(S, op.then.map(o => Object.assign({}, o, { answer: keep })), true);
  };
  /** "≪あなたの任意のキャラクター1人と、そのキャラクターにセットされているカード全て≫を、そのオーナーの手札に戻す / 捨て札する" (A3-11 1632 / A3-16 2231, Revise#164) */
  A.pickCharAll = (ctx, s, e) => {
    const S = ctx.S, opts = Object.keys(S.chars).filter(id => AA4.matchChar(S, ctx.db, s.sel || {}, id, { seat: e.seat, self: e.ch }));
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 1, max: 1, auto: false, reason: `Choose 1 character: it and every card set on it ${s.dest === "hand" ? "go back to the owner's hand" : "are discarded"}`, then: [{ op: "pickCharAllGo", dest: s.dest || "discard" }] });
  };
  OPS.pickCharAllGo = (ctx, op) => {
    const S = ctx.S, ch = AA4.charOfCard(S, (op.answer || [])[0]); if (!ch) return;
    if (op.dest !== "hand") return AA4.defeat(ctx, ch.id, { why: "discarded with every card set on it" });
    for (const id of ch.stack.concat(ch.power, ch.perm)) AA4.moveCard(ctx, id, { z: "hand", seat: S.cards[id].owner });
  };
  /** "≪あなたの任意のあなたの手札X枚≫をあなたのデッキに戻し、そのデッキをシャッフルする" (A3-11 1657): exactly n hand cards → dest */
  A.handPickTo = (ctx, s, e) => {
    const S = ctx.S, hand = S.players[e.seat].zones.hand.slice(), n = Math.min(nOf(s, e), hand.length);
    if (n <= 0) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: hand, min: n, max: n, reason: `Choose ${n} card${n === 1 ? "" : "s"} of your hand → ${s.dest === "damage" ? "your Damage Pile" : "your deck (shuffled)"}`, then: [{ op: s.dest === "damage" ? "toDamagePile" : "toDeckShuffle", seat: e.seat }] });
  };
  /** "≪あなたの任意のプレイヤー1人のテリトリーの、ブレイクしていないキャラクター全て≫を捨て札する" (A3-17 2344 / 2348) */
  A.playerPickSweep = (ctx, s, e) => {
    const S = ctx.S, seats0 = AA4.livingOrder(S);
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: seats0.map(String), labels: seats0.map(x => S.players[x].name + (x === e.seat ? " (you)" : "")), auto: false, reason: "Choose a player: their matching characters are discarded", then: [{ op: "playerPickSweepGo", sel: s.sel || {}, seat: e.seat }] });
  };
  OPS.playerPickSweepGo = (ctx, op) => { const S = ctx.S, who = +((op.answer || [])[0]); for (const id of AA4.charsOf(S, who).filter(id => AA4.matchChar(S, ctx.db, op.sel, id, { seat: op.seat }))) AA4.defeat(ctx, id, { why: "discarded (its player was chosen)" }); };
  /** A3-15 2074: "目標のオーナーのデッキの一番上のカード1枚を引き、目標にパワーカードとしてセットする" */
  A.deckTopPowerT = (ctx, s, e) => { const S = ctx.S, t = (e.targets || []).find(x => x.ch && S.chars[x.ch]); if (!t) return; const d = S.players[S.chars[t.ch].owner].zones.deck; if (d.length) AA4.moveCard(ctx, d[d.length - 1], { z: "char", ch: t.ch, role: "power" }); };
  OPS.permMoveAsk = (ctx, op) => {
    const S = ctx.S, c = S.cards[op.card]; if (!c || c.place.z !== "discard") return;
    const opts = AA4.controlledOf(S, c.owner).filter(id => id !== op.from);
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: c.owner, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 0, max: 1, auto: false, reason: `Move ${AA4.cardName(ctx.db.card(c.key))} to another of your Controlled Characters? (choose none to leave it discarded)`, then: [{ op: "permMoveGo", card: op.card }] });
  };
  OPS.permMoveGo = (ctx, op) => { const S = ctx.S, ch = AA4.charOfCard(S, (op.answer || [])[0]); if (ch && S.cards[op.card] && S.cards[op.card].place.z === "discard") AA4.moveCard(ctx, op.card, { z: "char", ch: ch.id, role: "perm" }); };
  /** "≪このカード≫を捨て札する" for this card wherever it is (hand, Damage Pile, field) (Revise#164) */
  A.thisCardDiscard = (ctx, s, e) => {
    const c = e.card && ctx.S.cards[e.card];
    if (!c || c.place.z === "discard") return;
    if (c.place.z === "special") for (const m of ctx.S.modifiers.filter(y => y.src && y.src.card === e.card)) AA4.endMod(ctx, m.id);   // a lasting Project / Fast card: its effect ends with it (Revise#166)
    AA4.moveCard(ctx, e.card, { z: "discard" });
  };
  /** "≪このカード≫を、あなたの任意のあなたの支配キャラクター1人にセットする" (a Permanent from the Damage Pile, A3-14 1999 / A3-16 2256) */
  A.thisCardPermOnto = (ctx, s, e) => {
    const S = ctx.S, c = e.card && S.cards[e.card]; if (!c) return;
    const opts = AA4.controlledOf(S, c.owner).filter(id => !s.sel || AA4.matchChar(S, ctx.db, s.sel, id, { seat: c.owner })); if (!opts.length) return;   // sel: "…あなたの支配エリアの“X”にセット可能" (EP372, Revise#369)
    return AA4.ask(ctx, { seat: c.owner, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 1, max: 1, reason: `Choose your Controlled Character: ${AA4.cardName(ctx.db.card(c.key))} is set on it`, then: [{ op: "thisCardPermGo", card: e.card }] });
  };
  OPS.thisCardPermGo = (ctx, op) => { const ch = AA4.charOfCard(ctx.S, (op.answer || [])[0]); if (ch && ctx.S.cards[op.card]) AA4.moveCard(ctx, op.card, { z: "char", ch: ch.id, role: "perm" }); };
  OPS.toActive = (ctx, op) => { for (const id of op.answer || []) { AA4.moveCard(ctx, id, { z: "active" }); const ch = AA4.charOfCard(ctx.S, id); ctx.emit({ e: "entered", card: id, seat: ctx.S.cards[id].owner, ch: ch && ch.id }); } };
  /** "≪プレイヤー全て≫は、そのプレイヤーの任意のそのプレイヤーの支配キャラクター1人を捨て札する" (A3-11 1714) */
  A.eachDiscardOwn = (ctx, s, e) => { const S = ctx.S; AA4.enqueue(S, AA4.livingOrder(S).filter(seat => (s.who !== "turn" || seat === S.turn.player) && AA4.controlledOf(S, seat).some(id => !s.sel || AA4.matchChar(S, ctx.db, s.sel, id, { seat }))).map(seat => ({ op: "eachDiscardOwnAsk", seat, sel: s.sel })), true); };
  OPS.eachDiscardOwnAsk = (ctx, op) => { const S = ctx.S, opts = AA4.controlledOf(S, op.seat).filter(id => !op.sel || AA4.matchChar(S, ctx.db, op.sel, id, { seat: op.seat })); if (!opts.length) return; return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 1, max: 1, reason: "Choose 1 of your Controlled Characters: it is discarded", then: [{ op: "eachDiscardOwnGo" }] }); };
  OPS.eachDiscardOwnGo = (ctx, op) => { const ch = AA4.charOfCard(ctx.S, (op.answer || [])[0]); if (ch) AA4.defeat(ctx, ch.id, { why: "discarded by its owner's choice" }); };
  /** "≪あなたの任意の、キャラクター1人にセットされているパワーカード2枚まで≫を、そのオーナーの手札に戻す" (A3-17 2330, Revise#165) */
  A.pickCharPowerUpTo = (ctx, s, e) => {
    const S = ctx.S, opts = Object.keys(S.chars).filter(id => S.chars[id].power.length);
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 1, max: 1, reason: `Choose a character: up to ${s.n || 1} of its power cards go back to the owner's hand`, then: [{ op: "pickCharPowerUpToGo", seat: e.seat, n: s.n || 1, dest: s.dest || "hand" }] });
  };
  OPS.pickCharPowerUpToGo = (ctx, op) => {
    const S = ctx.S, ch = AA4.charOfCard(S, (op.answer || [])[0]); if (!ch) return;
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: ch.power.slice(), min: 0, max: Math.min(op.n, ch.power.length), auto: false, reason: `Choose up to ${op.n} power card(s)`, then: [{ op: op.dest === "discard" ? "toDiscard" : "toOwnerHand" }] });
  };
  OPS.toOwnerHand = (ctx, op) => { for (const id of op.answer || []) if (ctx.S.cards[id]) AA4.moveCard(ctx, id, { z: "hand", seat: ctx.S.cards[id].owner }); };
  /** "目標の≪プレイヤー1人≫の手札から、あなたの任意の手札2枚を捨て札する": you look and choose (A3-21 3091, Revise#165) */
  A.handPickT = (ctx, s, e, r) => {
    const S = ctx.S, who = (seats(r)[0] != null ? seats(r)[0] : ((e.targets || []).find(t => t.seat != null) || {}).seat);
    if (who == null || !S.players[who]) return;
    const hand = S.players[who].zones.hand.slice(), n = Math.min(nOf(s, e), hand.length);
    if (!n) return;
    AA4.revealTo(S, hand, e.seat);
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: hand, min: n, max: n, reason: `Choose ${n} card(s) of ${S.players[who].name}'s hand: they are discarded`, then: [{ op: "toDiscard" }] });
  };
  /** "≪あなたの任意のキャラクター1人にセットされているカード全て≫を捨て札する" (power cards and Permanents; A3-21 3019) */
  A.pickCharSetCards = (ctx, s, e) => {
    const S = ctx.S, opts = Object.keys(S.chars).filter(id => S.chars[id].power.length || S.chars[id].perm.length);
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 1, max: 1, reason: "Choose a character: every card set on it (power cards and Permanents) is discarded", then: [{ op: "pickCharSetCardsGo" }] });
  };
  OPS.pickCharSetCardsGo = (ctx, op) => { const ch = AA4.charOfCard(ctx.S, (op.answer || [])[0]); if (ch) for (const id of ch.power.concat(ch.perm)) AA4.moveCard(ctx, id, { z: "discard" }); };
  /** Outlaw "Fool text" (Q#66, Revise#165): a real-world instruction of a joke card, shown to every player */
  A.foolNote = (ctx, s, e) => { ctx.emit({ e: "foolNote", card: e.card || null, seat: e.seat, text: s.text || "", targets: (e.targets || []).slice() }); };
  /** "目標の≪…ダメージ置き場または捨て札置き場の…カード1枚≫を、あなたの手札に戻す" (a card target in a pile, Revise#165) */
  A.pickToHandT = (ctx, s, e, r) => { for (const x of r) if (x.card && ctx.S.cards[x.card] && ["damage", "discard"].includes(ctx.S.cards[x.card].place.z)) AA4.moveCard(ctx, x.card, { z: "hand", seat: e.seat }); };
  A.xFromLast = (ctx, s, e) => { const x = +ctx.S.effLast || 0; e.x = x; for (const op of ctx.S.queue || []) if (op.e && op.e.eid === e.eid) op.e.x = x; };   // X = how many were discarded just before (Revise#165)
  /** "≪プレイヤー全て≫は、自分のダメージ置き場と捨て札置き場から1枚ずつ、Xを持つカードを、自分の手札に加える" / "…を3枚まで選んで" (A3-21 2909 / 3017 / 3089, Revise#166) */
  A.eachPilePick = (ctx, s, e) => {
    const S = ctx.S, n = nOf(s, e) || 1, ops = [];
    for (const seat of AA4.livingOrder(S)) for (const zs of s.perZone ? s.zones.map(z => [z]) : [s.zones]) ops.push({ op: "eachPilePickAsk", seat, zones: zs, sel: s.sel || {}, n, upTo: !!s.upTo });
    AA4.enqueue(S, ops, true);
  };
  OPS.eachPilePickAsk = (ctx, op) => {
    const S = ctx.S, p = S.players[op.seat]; if (!p || p.lost) return;
    const opts = op.zones.flatMap(z => p.zones[z]).filter(id => AA4.cardSelOk(ctx.db.card(S.cards[id].key) || {}, op.sel)), n = Math.min(op.n, opts.length);
    if (!n) return;
    AA4.revealTo(S, opts, op.seat);
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: opts, min: op.upTo ? 0 : n, max: n, auto: false, reason: `Choose ${op.upTo ? "up to " : ""}${n} card(s) from your ${op.zones.map(z => z === "damage" ? "Damage Pile" : "Discard Pile").join(" / ")} → your hand`, then: [{ op: "toHand", seat: op.seat }] });
  };
  /** "その後、≪このカード≫をあなたのダメージ置き場に置くことが可能" (Revise#166) */
  A.maySelfToDamage = (ctx, s, e) => { const c = e.card && ctx.S.cards[e.card]; if (c && ["special", "declared", "discard", "char"].includes(c.place.z)) AA4.enqueue(ctx.S, [{ op: "maySelfToDamageAsk", seat: e.seat, card: e.card }], true); };
  OPS.maySelfToDamageAsk = (ctx, op) => {
    if (!op.answer) return AA4.ask(ctx, { seat: op.seat, kind: "yesno", reason: `Put ${AA4.cardName(ctx.db.card(ctx.S.cards[op.card].key))} into your Damage Pile?`, then: [Object.assign({}, op)] });
    if (op.answer[0] === "yes" && ctx.S.cards[op.card]) AA4.moveCard(ctx, op.card, { z: "damage" });
  };
  /** a lasting watcher (see collectTriggers): bound to the target when s.to is given */
  A.watchEv = (ctx, s, e, r) => {
    const v = { event: s.event, when: s.when || {}, effect: s.effect, once: !!s.once, asOwner: !!s.asOwner, x: e.x != null ? +e.x || 0 : null };
    if (s.fromSel) v.fromSel = s.fromSel;
    if (s.cardSel) v.cardSel = s.cardSel;
    if (s.chSel) v.chSel = s.chSel;
    if (s.battleSel) v.battleSel = s.battleSel;
    if (s.useBound) v.useBound = true;
    if (s.oppOfBound) v.oppOfBound = true;
    if (s.evBy) v.evBy = true;
    if (s.evAttacker) v.evAttacker = true;
    if (s.attOwn) v.attOwn = true;
    if (s.attSel) v.attSel = s.attSel;
    if (s.optional) v.optional = true;
    if (s.bySrc) v.bySrc = true;
    if (s.keepTargets) v.targets = (e.targets || []).slice();   // "…した場合、≪あなたの任意のキャラクター1人≫に…": chosen when the effect was declared (EX0447, Revise#347)
    if (s.to) { for (const ch of chars(r)) mod(ctx, e, { to: { seat: e.seat }, key: "watchEv", op: "grant", value: Object.assign({ ch }, v), until: s.until || "main" }); }
    else mod(ctx, e, { to: { seat: e.seat }, key: "watchEv", op: "grant", value: v, until: s.until || "main" });
  };
  /** A3-09 1486 (Revise#250): "メインフェイズ終了時に、ダメージ置き場の、目標と同じ分類を持つカード全てをそのオーナーのデッキに戻し、そのデッキをシャッフルする" — the classes now, the cards then. */
  A.iconsToDeckLater = (ctx, s, e) => {
    const S = ctx.S, t = (e.targets || []).find(x => x.ch && S.chars[x.ch]); if (!t) return;
    const icons = AA4.charStats(S, ctx.db, t.ch).icons.slice(); if (!icons.length) return;
    return A.delayed(ctx, { at: s.at || "main", step: { a: "damageIconsToDeck", icons } }, e);
  };
  A.damageIconsToDeck = (ctx, s) => {
    const S = ctx.S, owners = new Set();
    for (const p of S.players) for (const id of p.zones.damage.slice()) { const i = ctx.db.card(S.cards[id].key) || {}; if ((i.icons || []).some(x => (s.icons || []).includes(x))) { AA4.moveCard(ctx, id, { z: "deck", seat: S.cards[id].owner }); owners.add(S.cards[id].owner); } }
    for (const seat of owners) OPS.shuffle(ctx, { seat });
  };
  /** A3-07 1071 (Revise#255): the target player shows the top 3 of their deck to your opponents, you put them back in any order, then you may have them shuffle. */
  A.reorderTopOf = (ctx, s, e, r) => {
    const S = ctx.S, seat = seats(r)[0]; if (seat == null) return;
    const deck = S.players[seat].zones.deck, top = deck.slice(-Math.min(nOf(s, e), deck.length));
    if (!top.length) return;
    for (const id of top) for (const o of AA4.living(S)) if (o !== e.seat && !S.cards[id].visibleTo.includes(o)) S.cards[id].visibleTo.push(o);
    ctx.emit({ e: "handRevealed", seat, keys: top.map(id => S.cards[id].key), to: "opps", by: e.seat });
    const then = [{ op: "rtoShuffleAsk", seat: e.seat, of: seat }];
    if (top.length < 2) return AA4.enqueue(S, then, true);
    return AA4.ask(ctx, { seat: e.seat, kind: "order", options: top.slice().reverse(), auto: false, reason: `${srcLabel(ctx, e)}: put them back on top of ${seat === e.seat ? "your" : S.players[seat].name + "'s"} deck in any order — the first one you pick ends on top`, then: [{ op: "reorderGo", seat: e.seat }].concat(then) });
  };
  OPS.rtoShuffleAsk = (ctx, op) => AA4.ask(ctx, { seat: op.seat, kind: "yesno", auto: false, reason: `Have ${op.seat === op.of ? "yourself" : ctx.S.players[op.of].name} shuffle that deck?`, then: [{ op: "rtoShuffleGo", of: op.of }] });
  OPS.rtoShuffleGo = (ctx, op) => { if ((op.answer || [])[0] === "yes") OPS.shuffle(ctx, { seat: op.of }); };
  /** A3-09 1384 (Revise#255): show the top card of your deck. A Break card may be set on a Controlled Character of yours, ignoring factor and cost
      (class / name / Break rule still apply) — then your Main Phase ends at once; not set → discarded. Not a Break card → your Damage Pile. */
  A.topBreakSetOrDamage = (ctx, s, e) => {
    const S = ctx.S, db = ctx.db, deck = S.players[e.seat].zones.deck; if (!deck.length) return;
    const id = deck[deck.length - 1], inf = db.card(S.cards[id].key) || {};
    S.cards[id].faceUp = true; ctx.emit({ e: "handRevealed", seat: e.seat, keys: [S.cards[id].key], to: "all" });
    if (inf.type !== "Break") { AA4.moveCard(ctx, id, { z: "damage" }); return; }
    const chs = freeBreakTargets(S, db, e.seat, id);
    if (!chs.length) { AA4.moveCard(ctx, id, { z: "discard" }); return ctx.emit({ e: "note", text: `「${AA4.cardName(inf)}」 cannot be set on any of your Controlled Characters — discarded` }); }
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: chs.concat(["skip"]), labels: chs.map(c => AA4.cardName(db.card(S.cards[AA4.topOf(S.chars[c])].key))).concat(["Don't set (discard it)"]), auto: false, reason: `Set 「${AA4.cardName(inf)}」 on a Controlled Character of yours, ignoring factor and cost? (if you do, your Main Phase ends)`, then: [{ op: "topBreakSetGo", seat: e.seat, card: id }] });
  };
  OPS.topBreakSetGo = (ctx, op) => {
    const S = ctx.S, ch = (op.answer || [])[0], c = S.cards[op.card]; if (!c || c.place.z !== "deck") return;
    if (!ch || ch === "skip" || !S.chars[ch]) { AA4.moveCard(ctx, op.card, { z: "discard" }); return; }
    OPS.breakFromHandGo(ctx, { ch, seat: op.seat, answer: [op.card], anyZone: true });
    if (S.turn.player === op.seat && S.turn.phase === "main") S.turn.endMainSoon = true;
  };
  /** A3-09 1484 (Revise#255): name a card type; the target player shows cards from the top of their deck until one of that type —
      it goes to their Damage Pile, the shown ones go back and the deck is shuffled. */
  A.revealUntilTypeDamage = (ctx, s, e, r) => {
    const seat = seats(r)[0]; if (seat == null) return;
    const types = ["Character", "Break", "Permanent", "Project", "Fast"];
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: types, labels: types.map(t => t + " card"), auto: false, reason: `${srcLabel(ctx, e)}: name a card type`, then: [{ op: "rutdGo", seat, by: e.seat }] });
  };
  OPS.rutdGo = (ctx, op) => {
    const S = ctx.S, type = (op.answer || [])[0], deck = S.players[op.seat].zones.deck, shown = [];
    let hit = null;
    for (let k = deck.length - 1; k >= 0; k--) { const id = deck[k]; shown.push(S.cards[id].key); if ((ctx.db.card(S.cards[id].key) || {}).type === type) { hit = id; break; } }
    ctx.emit({ e: "handRevealed", seat: op.seat, keys: shown, to: "all", named: type });
    if (hit) AA4.moveCard(ctx, hit, { z: "damage" });
    OPS.shuffle(ctx, { seat: op.seat });
  };
  /** A3-09 1319 (Revise#255): designate a character of your choice, discard 1 power card set on it; until the end of the Main Phase,
      a character sharing a class with it that pays a cost takes (1) damage. */
  A.designatePowerIconHit = (ctx, s, e) => {
    const S = ctx.S, opts = Object.keys(S.chars).filter(id => S.chars[id].owner === e.seat);
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, labels: opts.map(id => AA4.cardName(ctx.db.card(S.cards[AA4.topOf(S.chars[id])].key))), reason: `${srcLabel(ctx, e)}: designate one of your characters`, then: [{ op: "dpihGo", seat: e.seat, card: e.card }] });
  };
  OPS.dpihGo = (ctx, op) => {
    const S = ctx.S, chId = (op.answer || [])[0], ch = chId && S.chars[chId]; if (!ch) return;
    const icons = AA4.charStats(S, ctx.db, chId).icons.slice(), e = { seat: op.seat, card: op.card };
    if (icons.length) mod(ctx, e, { to: { seat: op.seat }, key: "watchEv", op: "grant", value: { event: "costPaid", when: {}, chSel: { icons }, effect: { steps: [{ a: "damage", to: "evCh", n: 1, mental: true }], status: "auto" } }, until: "main" });
    if (!ch.power.length) return;
    if (ch.power.length === 1) { AA4.moveCard(ctx, ch.power[0], { z: "discard" }); return; }
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: ch.power.slice(), min: 1, max: 1, reason: "Discard 1 power card set on it", then: [{ op: "dpihDiscard" }] });
  };
  OPS.dpihDiscard = (ctx, op) => { for (const id of op.answer || []) if (ctx.S.cards[id] && ctx.S.cards[id].place.z === "char") AA4.moveCard(ctx, id, { z: "discard" }); };
  /** 式神刹那式 (Revise#256): at the end of the turn its power cards go back to their owner's hand and the card is discarded */
  A.tokenDismiss = (ctx, s) => {
    const S = ctx.S, ch = S.chars[s.ch]; if (!ch || !ch.stack.includes(s.card)) return;
    for (const id of ch.power.slice().concat(ch.perm)) AA4.moveCard(ctx, id, { z: "hand", seat: S.cards[id].owner });
    AA4.removeChar(ctx, s.ch, { to: "discard", why: "the shikigami ends at the end of the turn" });
  };
  /** A3-07 1206 (Revise#256): name a faction; until the end of the Main Phase every character of it gets +X/+X/+X */
  A.factionAllStats = (ctx, s, e) => {
    const opts = ["E.G.O.", "Arayashiki", "WIZ-DOM", "Darklore", "Polestar Empire", "Eraser"];
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, auto: false, reason: `${srcLabel(ctx, e)}: name a faction — its characters get +${+e.x || 0} to every stat`, then: [{ op: "factionAllStatsGo", e, until: s.until || "main" }] });
  };
  OPS.factionAllStatsGo = (ctx, op) => { const f = (op.answer || [])[0], x = +op.e.x || 0; if (!f || !x) return; for (const key of ["se", "at", "de"]) mod(ctx, op.e, { to: { all: { faction: f } }, key, op: "add", value: x, until: op.until }); };
  /** A3-09 1488 (Revise#256): every player sets a card from the top of their deck as a power card on each of their attacking / guarding
      Controlled Characters; then every attack declaration is cancelled and every declared or lasting Project / Fast card goes back to its owner's hand. */
  A.battleRecall = (ctx, s, e) => {
    const S = ctx.S, b = S.battle;
    if (b) for (const ch of [b.attacker, b.guard].concat(b.joined ? b.joined.att.concat(b.joined.grd) : []).filter(id => id && S.chars[id] && AA4.isControlled(S.chars[id]))) {
      const deck = S.players[S.chars[ch].owner].zones.deck; if (deck.length) AA4.moveCard(ctx, deck[deck.length - 1], { z: "char", ch, role: "power" });
    }
    A.cancelCurrentAttack(ctx);
    for (const it of S.stack.slice()) { if (it.kind !== "set" || !it.card || !S.cards[it.card] || !["Project", "Fast"].includes((ctx.db.card(S.cards[it.card].key) || {}).type)) continue; S.stack.splice(S.stack.indexOf(it), 1); ctx.emit({ e: "itemCancelled", item: it.id, by: e.card }); AA4.moveCard(ctx, it.card, { z: "hand", seat: S.cards[it.card].owner }); }
    for (const c of Object.values(S.cards).filter(c => c.place.z === "special" && c.id !== e.card && ["Project", "Fast"].includes((ctx.db.card(c.key) || {}).type))) { for (const m of S.modifiers.filter(y => y.src && y.src.card === c.id)) AA4.endMod(ctx, m.id); AA4.moveCard(ctx, c.id, { z: "hand", seat: c.owner }); }
  };
  /** A3-07 1073 (Revise#256): "あなたはあなたの手札を1枚捨て札することで、このカードをあなたの手札に戻すことができる" — offered when it resolves */
  A.discardToReturn = (ctx, s, e) => {
    const S = ctx.S, hand = S.players[e.seat].zones.hand; if (!hand.length || !e.card || !S.cards[e.card]) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: hand.slice(), min: 0, max: 1, auto: false, reason: `${srcLabel(ctx, e)}: you may discard 1 hand card to return this card to your hand`, then: [{ op: "discardToReturnGo", card: e.card }] });
  };
  OPS.discardToReturnGo = (ctx, op) => { const id = (op.answer || [])[0], S = ctx.S; if (!id || !S.cards[id] || S.cards[id].place.z !== "hand") return; AA4.moveCard(ctx, id, { z: "discard" }); if (S.cards[op.card]) S.cards[op.card].endToHand = true; };
  /** A3-09 1322 (Revise#256): designate a Break card (cost ≤ X) of your hand and play it shown: until the end of the Main Phase the target adds
      its stats, until the end of the turn it has its skills; at the end of the turn the card goes back to your hand — discarded if the target is gone. */
  A.breakLend = (ctx, s, e) => {
    const S = ctx.S, x = +e.x || 0, t = (e.targets || []).find(y => y.ch && S.chars[y.ch]); if (!t) return;
    const opts = S.players[e.seat].zones.hand.filter(id => { const i = ctx.db.card(S.cards[id].key) || {}; return i.type === "Break" && (i.cost === "X" ? 0 : +i.cost || 0) <= x; });
    if (!opts.length) return ctx.emit({ e: "note", text: `No Break card with cost ≤ ${x} in your hand` });
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 1, max: 1, auto: false, reason: `Choose a Break card (cost ≤ ${x}) of your hand: the target adds its stats and gains its skills`, then: [{ op: "breakLendGo", e, ch: t.ch }] });
  };
  OPS.breakLendGo = (ctx, op) => {
    const S = ctx.S, id = (op.answer || [])[0], e = op.e; if (!id || !S.cards[id] || !S.chars[op.ch]) return;
    const inf = ctx.db.card(S.cards[id].key) || {};
    AA4.moveCard(ctx, id, { z: "special", seat: e.seat }, { faceUp: true });
    for (const key of ["se", "at", "de"]) if (+inf[key]) mod(ctx, e, { to: { ch: op.ch }, key, op: "add", value: +inf[key], until: "main" });
    for (const [k, v] of Object.entries(inf.skills || {})) mod(ctx, e, { to: { ch: op.ch }, key: "skill", op: "grant", value: { id: k, x: v === true ? undefined : v }, until: "turn" });
    A.delayed(ctx, { at: "turn", step: { a: "breakLendEnd", card: id, ch: op.ch } }, e);
  };
  A.breakLendEnd = (ctx, s) => { const S = ctx.S, c = S.cards[s.card]; if (!c || c.place.z !== "special") return; AA4.moveCard(ctx, s.card, S.chars[s.ch] ? { z: "hand", seat: c.owner } : { z: "discard" }); };
  /** A3-15 2150 (Revise#257): a character that guards against an attack of the designated player's Controlled Characters pays 1 less */
  A.guardLessVsT = (ctx, s, e, r) => { for (const seat of seats(r)) mod(ctx, e, { to: { players: "all" }, key: "guardTax", op: "grant", value: { att: { ownerSeat: seat, area: "controlled" }, grd: {}, n: -(s.n || 1) }, until: s.until || "main" }); };
  /** A3-14 2028 (Revise#257): designate a named Controlled Character of yours; your non-name-level Controlled Characters sharing a class with it
      get Attack +1 and its skills until the end of the Main Phase. */
  A.namedShareBoost = (ctx, s, e) => {
    const S = ctx.S, opts = AA4.controlledOf(S, e.seat).filter(id => AA4.charStats(S, ctx.db, id).named);
    if (!opts.length) return ctx.emit({ e: "note", text: "No named Controlled Character to designate" });
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, labels: opts.map(id => AA4.cardName(ctx.db.card(S.cards[AA4.topOf(S.chars[id])].key))), reason: `${srcLabel(ctx, e)}: designate a named Controlled Character of yours`, then: [{ op: "namedShareBoostGo", e, until: s.until || "main" }] });
  };
  OPS.namedShareBoostGo = (ctx, op) => {
    const S = ctx.S, id = (op.answer || [])[0]; if (!id || !S.chars[id]) return;
    const st = AA4.charStats(S, ctx.db, id), e = op.e; if (!st.icons.length) return;
    const sel = { owner: "you", area: "controlled", named: false, icons: st.icons.slice() };
    mod(ctx, e, { to: { all: sel }, key: "at", op: "add", value: 1, until: op.until });
    for (const [k, v] of Object.entries(st.skills || {})) mod(ctx, e, { to: { all: sel }, key: "skill", op: "grant", value: { id: k, x: v === true ? undefined : v }, until: op.until });
  };
  /** A3-11 1689 (Revise#257): −1/−1/−1 for each Permanent card set on the target (counted now) */
  A.minusPerPerm = (ctx, s, e, r) => { for (const ch of chars(r)) { const n = ctx.S.chars[ch] ? ctx.S.chars[ch].perm.length : 0; if (n) for (const key of ["se", "at", "de"]) mod(ctx, e, { to: { ch }, key, op: "add", value: -n, until: s.until || "main" }); } };
  /** A3-11 1743 (Revise#257): while the target battles, its battle opponent has no skills */
  A.battleOppOffT = (ctx, s, e, r) => { for (const ch of chars(r)) mod(ctx, e, { to: { players: "all" }, key: "battleOppSkillsOff", op: "grant", value: { of: ch }, until: s.until || "main" }); };
  /** A3-11 1741 (Revise#257): when the target attacks, every card set on it is discarded, it becomes an Active Character and this card is discarded */
  A.stripActiveEv = (ctx, s, e) => {
    const S = ctx.S, ch = e.evCh && S.chars[e.evCh]; if (!ch) return;
    for (const id of ch.power.concat(ch.perm)) AA4.moveCard(ctx, id, { z: "discard" });
    ctx.emit({ e: "note", text: `${srcLabel(ctx, e)}: every card set on it is discarded; it becomes an Active Character after the attack` });
    A.watchEv(ctx, { to: "ch", event: "battleEnd", when: { self: true }, useBound: true, once: true, effect: { steps: [{ a: "makeActive", to: "evCh" }], status: "auto" }, until: "main" }, e, [{ ch: e.evCh }]);
    A.thisCardDiscard(ctx, s, e);
  };
  /** "目標が勢力キャラクターだった場合、目標はあなたの支配エリアに移動し、あなたの任意のプレイヤー1人にアタック宣言する" */
  A.activeToAttack = (ctx, s, e, r) => { const S = ctx.S, ch = chars(r)[0]; if (!ch || !S.chars[ch] || S.chars[ch].at.area !== "active") return; OPS.moveChar(ctx, { ch, to: { area: "back" } }); return A.makeAttack(ctx, {}, e, [{ ch }]); };
  /** A3-20 2695 (Revise#258): "目標の≪あなたの支配キャラクター1人≫をアタック宣言またはガード宣言させる" — it guards an attack on you, else it attacks */
  A.attackOrGuard = (ctx, s, e, r) => {
    const S = ctx.S, b = S.battle, ch = chars(r)[0]; if (!ch || !S.chars[ch]) return;
    if (b && b.kind === "attack" && b.step !== "end" && !b.guard && S.chars[b.attacker] && S.chars[b.attacker].owner !== e.seat && b.target && (b.target.seat === e.seat || (b.target.ch && S.chars[b.target.ch] && S.chars[b.target.ch].owner === e.seat))) return A.forceGuard(ctx, {}, e, [{ ch }]);
    return A.makeAttack(ctx, {}, e, [{ ch }]);
  };
  /** A3-22 3129 (Revise#258): the attacking character becomes the target (a Controlled Character of the attacker's owner) */
  A.swapAttackerTo = (ctx, s, e, r) => { const S = ctx.S, b = S.battle, ch = chars(r)[0]; if (!b || b.kind !== "attack" || b.step === "end" || !ch || !S.chars[ch]) return; OPS.swapAttackerGo(ctx, { seat: S.chars[ch].owner, old: b.attacker, answer: [ch] }); };
  /** A3-25 3802 (Revise#258): every player shuffles hand, Discard Pile and Damage Pile into their deck, then draws 7 */
  A.resetAllDraw = (ctx, s, e) => {
    const S = ctx.S;
    for (const seat of AA4.livingOrder(S)) { const z = S.players[seat].zones; for (const id of z.hand.concat(z.discard, z.damage)) AA4.moveCard(ctx, id, { z: "deck", seat }); OPS.shuffle(ctx, { seat }); }
    AA4.enqueue(S, AA4.livingOrder(S).map(seat => ({ op: "draw", seat, n: s.n || 7 })), true);
  };
  /** A3-25 3696 (Revise#258): look at the target's hand; you may put one non-Character card of it on the bottom of its owner's deck — then they draw 1 */
  A.peekHandBottomDraw = (ctx, s, e, r) => {
    const S = ctx.S, seat = seats(r)[0]; if (seat == null) return;
    const hand = S.players[seat].zones.hand; AA4.revealTo(S, hand, e.seat);
    const opts = hand.filter(id => (ctx.db.card(S.cards[id].key) || {}).type !== "Character");
    ctx.emit({ e: "handRevealed", seat, keys: hand.map(id => S.cards[id].key), to: e.seat });
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 0, max: 1, auto: false, reason: `${S.players[seat].name}'s hand: you may put one non-Character card on the bottom of their deck (then they draw 1)`, then: [{ op: "peekHandBottomGo", seat }] });
  };
  OPS.peekHandBottomGo = (ctx, op) => { const S = ctx.S, id = (op.answer || [])[0]; if (!id || !S.cards[id] || S.cards[id].place.z !== "hand") return; AA4.moveCard(ctx, id, { z: "deck", seat: op.seat, pos: "bottom" }); AA4.enqueue(S, [{ op: "draw", seat: op.seat, n: 1 }], true); };
  /** A3-24 3435 (Revise#258): a target with Permanent −X gets Initiative and Penetrate; with Permanent −X totalling 2 or more, Attack +3 more */
  A.permMinusBoost = (ctx, s, e, r) => {
    const S = ctx.S;
    for (const ch of chars(r)) {
      const sk = AA4.charStats(S, ctx.db, ch).skills || {}, pm = typeof sk.permanent === "number" ? sk.permanent : 0;
      if (pm >= 0) continue;
      mod(ctx, e, { to: { ch }, key: "skill", op: "grant", value: { id: "initiative", x: true }, until: s.until || "turn" });
      mod(ctx, e, { to: { ch }, key: "skill", op: "grant", value: { id: "penetrate", x: true }, until: s.until || "turn" });
      if (-pm >= 2) mod(ctx, e, { to: { ch }, key: "at", op: "add", value: 3, until: s.until || "turn" });
    }
  };
  /** A3-23 3335 (Revise#258): you draw 1, then each opponent may draw 1 — again and again until a player says no */
  A.drawChain = (ctx, s, e) => { AA4.enqueue(ctx.S, [{ op: "draw", seat: e.seat, n: 1 }, { op: "drawChainAsk", seat: e.seat, order: AA4.livingOrder(ctx.S).filter(x => x !== e.seat), i: 0, round: 1 }], true); };
  OPS.drawChainAsk = (ctx, op) => {
    const S = ctx.S; if (op.round > 40) return;
    const all = op.order.concat([op.me != null ? op.me : op.seat]), who = op.i < op.order.length ? op.order[op.i] : op.seat;
    return AA4.ask(ctx, { seat: who, kind: "yesno", auto: false, reason: "Draw 1? (saying no ends it for everyone)", then: [{ op: "drawChainGo", seat: op.seat, order: op.order, i: op.i, round: op.round, who }] });
  };
  OPS.drawChainGo = (ctx, op) => {
    if ((op.answer || [])[0] !== "yes") return ctx.emit({ e: "note", text: `${ctx.S.players[op.who].name} said no: the draws end` });
    AA4.OPS.draw(ctx, { seat: op.who, n: 1 });
    const i = op.i + 1; AA4.enqueue(ctx.S, [{ op: "drawChainAsk", seat: op.seat, order: op.order, i: i > op.order.length ? 0 : i, round: i > op.order.length ? op.round + 1 : op.round }], true);
  };
  A.handAllPowerSelf = (ctx, s, e) => { const S = ctx.S, ch = e.ch && S.chars[e.ch]; if (!ch) return; for (const id of S.players[e.seat].zones.hand.slice()) AA4.moveCard(ctx, id, { z: "char", ch: e.ch, role: "power" }); };   // "≪あなたの手札全て≫をパワーカードとしてこのキャラクターにセットする" (Revise#260)
  A.nextBattleModsT = (ctx, s, e, r) => { for (const ch of chars(r)) for (const m of s.mods || []) mod(ctx, e, Object.assign({ to: { ch }, key: m.key, op: m.op || "add", value: m.value, until: s.until || "turn", nextBattle: true }, s.cond ? { cond: s.cond } : {})); };   // "目標の≪…≫が次にバトルによるダメージを与える場合、攻撃力に+Nして判定する" (Revise#262)
  /** A3-22 3130 (Revise#262): look at the designated player's hand and discard every non-Character card with the named card name */
  A.handNameDiscard = (ctx, s, e, r) => {
    const S = ctx.S, seat = seats(r)[0], nm = S.effName; if (seat == null) return;
    const hand = S.players[seat].zones.hand; AA4.revealTo(S, hand, e.seat); ctx.emit({ e: "handRevealed", seat, keys: hand.map(id => S.cards[id].key), to: e.seat });
    for (const id of hand.slice()) { const i = ctx.db.card(S.cards[id].key) || {}; if (nm && i.jp === nm && i.type !== "Character") AA4.moveCard(ctx, id, { z: "discard" }); }
  };
  /** A3-22 3309 (Revise#262): up to 3 cards of the target's hand (your choice) → top of their deck; then the same number of cards of that deck (your choice) → their hand; shuffle; you draw 1 */
  A.handSwapDeck = (ctx, s, e, r) => {
    const S = ctx.S, seat = seats(r)[0]; if (seat == null) return;
    const hand = S.players[seat].zones.hand; AA4.revealTo(S, hand, e.seat);
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: hand.slice(), min: 0, max: Math.min(3, hand.length), auto: false, reason: `Choose up to 3 cards of ${S.players[seat].name}'s hand: they go on top of their deck`, then: [{ op: "handSwapDeckGo", seat, by: e.seat }] });
  };
  OPS.handSwapDeckGo = (ctx, op) => {
    const S = ctx.S, ids = (op.answer || []).filter(id => S.cards[id] && S.cards[id].place.z === "hand");
    for (const id of ids) AA4.moveCard(ctx, id, { z: "deck", seat: op.seat, pos: "top" });
    const deck = S.players[op.seat].zones.deck;
    if (!ids.length || !deck.length) return OPS.handSwapDeckEnd(ctx, op);
    AA4.revealTo(S, deck, op.by);
    return AA4.ask(ctx, { seat: op.by, kind: "cards", options: deck.slice().reverse(), min: Math.min(ids.length, deck.length), max: Math.min(ids.length, deck.length), auto: false, reason: `Choose ${ids.length} card${ids.length === 1 ? "" : "s"} of that deck: they go to ${S.players[op.seat].name}'s hand`, then: [{ op: "handSwapDeckTake", seat: op.seat, by: op.by }] });
  };
  OPS.handSwapDeckTake = (ctx, op) => { const S = ctx.S; for (const id of op.answer || []) if (S.cards[id] && S.cards[id].place.z === "deck") AA4.moveCard(ctx, id, { z: "hand", seat: op.seat }); for (const id of S.players[op.seat].zones.deck) { const c = S.cards[id]; c.visibleTo = c.visibleTo.filter(x => x !== op.by); } OPS.handSwapDeckEnd(ctx, op); };
  OPS.handSwapDeckEnd = (ctx, op) => { OPS.shuffle(ctx, { seat: op.seat }); AA4.enqueue(ctx.S, [{ op: "draw", seat: op.by, n: 1 }], true); };
  /** A3-16 2177 (Revise#263): designate a Controlled Character of yours; your Controlled Characters may pay its Attack / effect costs */
  A.designatePayFor = (ctx, s, e) => {
    const S = ctx.S, opts = AA4.controlledOf(S, e.seat); if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, labels: opts.map(id => AA4.cardName(ctx.db.card(S.cards[AA4.topOf(S.chars[id])].key))), reason: `${srcLabel(ctx, e)}: designate a Controlled Character of yours`, then: [{ op: "designatePayForGo", e, until: s.until || "main" }] });
  };
  OPS.designatePayForGo = (ctx, op) => { const id = (op.answer || [])[0]; if (id && ctx.S.chars[id]) mod(ctx, op.e, { to: { all: { owner: "you", area: "controlled" } }, key: "payFor", op: "grant", value: { kinds: ["attack", "effect"], sel: { chIs: id } }, until: op.until }); };
  /** A3-19 2551 (Revise#263): designate up to X characters: no skills / effects, no attack / guard declarations, no costs paid from them, no factor */
  A.designateShutdown = (ctx, s, e) => {
    const S = ctx.S, x = +e.x || 0, opts = Object.keys(S.chars); if (!x || !opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 1, max: Math.min(x, opts.length), auto: false, reason: `${srcLabel(ctx, e)}: designate up to ${x} characters`, then: [{ op: "designateShutdownGo", e, until: s.until || "main" }] });
  };
  OPS.designateShutdownGo = (ctx, op) => {
    for (const ch of (op.answer || []).map(id => (AA4.charOfCard(ctx.S, id) || {}).id).filter(id => id && ctx.S.chars[id])) {
      mod(ctx, op.e, { to: { ch }, key: "negate", op: "grant", value: { skills: true, effects: true }, until: op.until });
      for (const key of ["noAttack", "noGuard", "noPay", "noFactor"]) mod(ctx, op.e, { to: { ch }, key, op: "grant", value: true, until: op.until });
    }
  };
  /** A4-04 0773 (Revise#267): the target player may discard N hand cards; if not, the top M cards of their deck are discarded */
  A.discardOrMill = (ctx, s, e, r) => {
    const S = ctx.S, seat = seats(r)[0]; if (seat == null) return;
    const hand = S.players[seat].zones.hand, n = s.n || 1;
    if (hand.length < n) return A.mill(ctx, { n: s.mill }, e, [{ seat }]);
    return AA4.ask(ctx, { seat, kind: "cards", options: hand.slice(), min: 0, max: n, auto: false, reason: `${srcLabel(ctx, e)}: discard ${n} card${n === 1 ? "" : "s"} of your hand? If not, the top ${s.mill} cards of your deck are discarded`, then: [{ op: "discardOrMillGo", seat, n, mill: s.mill }] });
  };
  OPS.discardOrMillGo = (ctx, op) => { const S = ctx.S, ids = (op.answer || []).filter(id => S.cards[id] && S.cards[id].place.z === "hand"); if (ids.length >= op.n) { for (const id of ids) AA4.moveCard(ctx, id, { z: "discard" }); return; } const deck = S.players[op.seat].zones.deck; for (let k = 0; k < op.mill && deck.length; k++) AA4.moveCard(ctx, deck[deck.length - 1], { z: "discard" }); };
  /** A4-04 0604 (Revise#274): look at the hand of this character's owner; you may discard up to N of it */
  A.lookHandTake = (ctx, s, e) => {
    const S = ctx.S, ch = e.ch && S.chars[e.ch], seat = ch ? ch.owner : e.seat, hand = S.players[seat].zones.hand; if (!hand.length) return;
    AA4.revealTo(S, hand, e.seat); ctx.emit({ e: "handRevealed", seat, keys: hand.map(id => S.cards[id].key), to: e.seat });
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: hand.slice(), min: s.upTo ? 0 : Math.min(s.n || 1, hand.length), max: Math.min(s.n || 1, hand.length), auto: false, reason: `${S.players[seat].name}'s hand: you may discard ${s.n || 1}`, then: [{ op: "toDiscard" }] });
  };
  /** A4-04 0700 (Revise#274): that player chooses N cards of their own hand and discards them */
  A.ownDiscardBy = (ctx, s, e, r) => {
    const S = ctx.S, seat = seats(r)[0]; if (seat == null) return;
    const hand = S.players[seat].zones.hand, n = Math.min(s.n || 1, hand.length); if (!n) return;
    return AA4.ask(ctx, { seat, kind: "cards", options: hand.slice(), min: n, max: n, auto: false, reason: `${srcLabel(ctx, e)}: discard ${n} card${n === 1 ? "" : "s"} of your hand`, then: [{ op: "toDiscard" }] });
  };
  A.revealHands = (ctx, s, e, r) => { const S = ctx.S; for (const seat of seats(r)) { const hand = S.players[seat].zones.hand; AA4.revealTo(S, hand, "all"); ctx.emit({ e: "handRevealed", seat, keys: hand.map(id => S.cards[id].key), to: "all" }); } };   // "≪対戦相手全て≫は手札の内容を公開する" (Revise#275)
  /** A3-09 1453 (Revise#253): every non-name-level Break card of your Damage Pile becomes a Controlled Character of yours —
      アンデッド and Intercept until the end of the turn, then back to your Damage Pile. */
  A.undeadRise = (ctx, s, e) => {
    const S = ctx.S, ids = S.players[e.seat].zones.damage.filter(id => { const i = ctx.db.card(S.cards[id].key) || {}; return i.type === "Break" && !i.name; });
    const chs = [];
    for (const id of ids) { AA4.moveCard(ctx, id, { z: "back" }); const ch = AA4.charOfCard(S, id); if (!ch) continue; chs.push(ch.id); ctx.emit({ e: "entered", card: id, seat: e.seat, ch: ch.id }); }
    for (const ch of chs) { mod(ctx, e, { to: { ch }, key: "icon", op: "grant", value: "アンデッド", until: "turn" }); mod(ctx, e, { to: { ch }, key: "skill", op: "grant", value: { id: "intercept", x: true }, until: "turn" }); }
    if (chs.length) A.delayed(ctx, { at: "turn", step: { a: "undeadBack", chs } }, e);
  };
  A.undeadBack = (ctx, s, e) => { for (const ch of s.chs || []) if (ctx.S.chars[ch]) AA4.removeChar(ctx, ch, { to: "damage", allTo: true, why: "back to the Damage Pile at the end of the turn (A3-09 1453)" }); };
  /** A3-09 1452 (Revise#252): "≪指定された分類を持つキャラクター≫が捨て札になった場合、…全ては、そのオーナーのダメージ置き場に置かれる" */
  A.iconLeaveToDamage = (ctx, s, e) => { const ic = ctx.S.effIcon; if (ic) mod(ctx, e, { to: { all: { icons: [ic] } }, key: "leaveToDamage", op: "grant", value: true, until: s.until || "main" }); };
  /** A3-07 1137 (Revise#251): the Guard cost paid against the target's attack returns to its owner's hand */
  A.destGuardVsT = (ctx, s, e) => { for (const t of e.targets || []) if (t.ch && ctx.S.chars[t.ch]) mod(ctx, e, { to: { players: "all" }, key: "dest", op: "dest", value: { cost: "guard", vsCh: t.ch, to: "hand" }, until: s.until || "main" }); };
  /** A3-09 1354 (Revise#251): "通常のダメージ判定を行わず、そのプレイヤーのダメージ置き場にカードが1枚置かれるまで、ダメージ判定する" */
  A.dmgUntilOne = (ctx, s, e) => {
    const S = ctx.S, seat = e.evHit != null ? e.evHit : e.evSeat, p = seat != null && S.players[seat]; if (!p) return;
    const n0 = p.zones.damage.length, want = s.n === "selfSe" ? Math.max(0, +(e.ch && S.chars[e.ch] ? AA4.charStats(S, ctx.db, e.ch).se : 0) || 0) : 1;   // n "selfSe": as many cards as this character's Mental (A3-23 3357, Revise#395)
    for (let k = 0; k < 120 && p.zones.damage.length < n0 + want && p.zones.deck.length && !p.lost && !S.decisions.length; k++) AA4.damagePlayer(ctx, seat, { normal: 1, mental: 0 }, {});
  };
  /** A3-11 1743 (Revise#395): "既にガード宣言しているキャラクターがいる場合、目標とそのキャラクターの…を合計して判定する" — the target joins the guard (as Synchro does). */
  A.forceGuardJoin = (ctx, s, e, r) => {
    const S = ctx.S, b = S.battle; if (!b || !b.guard || b.kind !== "attack" || ["end", "after"].includes(b.step)) return;
    for (const ch of chars(r)) { const c = S.chars[ch];
      if (!c || ch === b.guard || ch === b.attacker || c.owner !== b.defender || !AA4.isControlled(c) || b.joined.grd.includes(ch)) continue;
      b.joined.grd.push(ch); c.flags.tapped = true; S.passed = []; ctx.emit({ e: "joined", ch, seat: c.owner, side: "grd" }); return; }
  };
  /** A3-25 3691 グレイプニル (Revise#395): "このカードがセットされた場合、あなたはキャラクター1人を指定する。指定されたキャラクターの精神力がX未満の場合、…できない" —
      the chosen character gets the limits for as long as this card stays, while its Mental is below X (counted when asked). */
  A.bindWeak = (ctx, s, e) => {
    const S = ctx.S, opts = Object.keys(S.chars).filter(id => S.chars[id]); if (!opts.length || !e.card) return;
    AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 1, max: 1, auto: false, reason: `${srcLabel(ctx, e)}: choose a character (while its Mental is below X it cannot attack, guard, use effects or pay costs)`,
      then: [{ op: "bindWeakGo", card: e.card, seat: e.seat, ch: e.ch || null, x: s.x, keys: s.keys }] });
  };
  OPS.bindWeakGo = (ctx, op) => {
    const S = ctx.S, c = op.answer && S.cards[op.answer[0]], ch = c && c.place.z === "char" ? c.place.ch : null; if (!ch || !S.chars[ch]) return;
    for (const key of op.keys) AA4.addMod(ctx, { src: { card: op.card, seat: op.seat, ch: op.ch, label: AA4.cardName(ctx.db.card(S.cards[op.card].key) || {}) }, to: { ch }, key, op: "grant", value: true, until: "source", cond: { seBelowX: { ch, x: op.x, seat: op.seat } } });
    ctx.emit({ e: "note", text: `${AA4.cardName(ctx.db.card(S.cards[op.card].key) || {})}: ${AA4.cardName(ctx.db.card(S.cards[AA4.topOf(S.chars[ch])].key) || {})} is chosen` });
  };
  /** A3-22 3203 (Revise#401): in the Damage Pile, when its owner's deck reaches 0 — "あなたがこのカードの必要ファクターを満たしている場合、≪あなたの任意のキャラクターX体≫を捨て札する。
      その後、このカードを捨て札する。Xはあなたのダメージ置き場のカード枚数に等しい" */
  A.candleOut = (ctx, s, e) => {
    const S = ctx.S, c = e.card && S.cards[e.card]; if (!c || c.place.z !== "damage") return;
    const inf = ctx.db.card(c.key) || {}, name = AA4.cardName(inf);
    if (AA4.factorOk(S, ctx.db, e.seat, inf)) { ctx.emit({ e: "note", text: `${name}: its required Factor is not met — nothing happens` }); return; }
    const x = S.players[e.seat].zones.damage.length, opts = Object.keys(S.chars).filter(id => S.chars[id]), n = Math.min(x, opts.length);
    if (!n) { AA4.moveCard(ctx, e.card, { z: "discard" }); return; }
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: n, max: n, reason: `${name}: choose ${n} character${n === 1 ? "" : "s"} to discard (X = ${x}, the cards in your Damage Pile)`, then: [{ op: "candleOutGo", card: e.card, seat: e.seat }] });
  };
  OPS.candleOutGo = (ctx, op) => {
    const S = ctx.S, name = AA4.cardName(ctx.db.card(S.cards[op.card].key) || {});
    for (const id of op.answer || []) { const c = S.cards[id], ch = c && c.place.z === "char" ? c.place.ch : null; if (ch && S.chars[ch]) AA4.removeChar(ctx, ch, { to: "discard", why: `discarded by ${name}` }); }
    if (S.cards[op.card] && S.cards[op.card].place.z === "damage") AA4.moveCard(ctx, op.card, { z: "discard" });
  };
  /** A3-07 1103 (Revise#250): "あなたの任意のあなたの支配キャラクター1人をあなたのダメージ置き場に置く" — clicked on the field */
  A.ctlCharToDamage = (ctx, s, e) => {
    const S = ctx.S, opts = AA4.controlledOf(S, e.seat).filter(id => S.chars[id]);
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, labels: opts.map(id => AA4.cardName(ctx.db.card(S.cards[AA4.topOf(S.chars[id])].key))), reason: `${srcLabel(ctx, e)}: choose one of your Controlled Characters — it goes to your Damage Pile`, then: [{ op: "ctlCharToDamageGo", seat: e.seat }] });
  };
  OPS.ctlCharToDamageGo = (ctx, op) => { const ch = (op.answer || [])[0]; if (ch && ctx.S.chars[ch]) AA4.removeChar(ctx, ch, { to: "damage", allTo: true, why: "put into the Damage Pile (A3-07 1103)" }); };
  /** A3-09 1349 (Revise#250): "≪このカードと、このキャラクターにセットされているカード全て≫をあなたのダメージ置き場に置く" */
  A.selfAndSetToDamage = (ctx, s, e) => {
    const S = ctx.S, c = e.card && S.cards[e.card], ch = c && c.place.z === "char" ? S.chars[c.place.ch] : null; if (!ch) return;
    for (const id of ch.perm.concat(ch.power)) AA4.moveCard(ctx, id, { z: "damage", seat: e.seat });
  };
  /** A3-04 0690 (Revise#249): "…キャラクターにセットされているパワーカード≫から、あなたの任意のパワーカードX枚までを、そのオーナーの手札に戻す" — X in all until it ends. */
  A.powerBackBudget = (ctx, s, e) => {
    const S = ctx.S, ch = e.evCh && S.chars[e.evCh], key = String(e.card || "pb"), b = (S.turn.pbBudget = S.turn.pbBudget || {}), left = (+e.x || 0) - (b[key] || 0);
    if (!ch || !ch.power.length || left <= 0) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: ch.power.slice(), min: 0, max: Math.min(left, ch.power.length), auto: false, reason: `${srcLabel(ctx, e)}: return up to ${left} of its power cards to their owner's hand (${left} left)`, then: [{ op: "powerBackBudgetGo", key }] });
  };
  OPS.powerBackBudgetGo = (ctx, op) => { const S = ctx.S, ids = (op.answer || []).filter(id => S.cards[id] && S.cards[id].place.z === "char"); for (const id of ids) AA4.moveCard(ctx, id, { z: "hand", seat: S.cards[id].owner }); if (ids.length) { const b = (S.turn.pbBudget = S.turn.pbBudget || {}); b[op.key] = (b[op.key] || 0) + ids.length; } };
  /** A3-05 0843 (Revise#249): "目標を対象に使用宣言するブレイクカードの…コストはオーナーの手札に戻る" */
  A.destOnT = (ctx, s, e) => { for (const t of e.targets || []) if (t.ch && ctx.S.chars[t.ch]) mod(ctx, e, { to: { seat: e.seat }, key: "dest", op: "dest", value: { cost: "set", type: "Break", targetCh: t.ch, to: "hand" }, until: s.until || "main" }); };
  /** A3-04 0653 (Revise#245): the target's power cards and 1 card of your Damage Pile → your deck, shuffle, draw that many. */
  A.powerAndDamageToDeckDraw = (ctx, s, e) => {
    const S = ctx.S, t = (e.targets || []).find(x => x.ch && S.chars[x.ch]);
    let n = 0;
    if (t) for (const id of S.chars[t.ch].power.slice()) { AA4.moveCard(ctx, id, { z: "deck", seat: S.cards[id].owner }); n++; }
    const dmg = S.players[e.seat].zones.damage.slice();
    if (!dmg.length) return OPS.pdDeckDrawGo(ctx, { seat: e.seat, n, answer: [] });
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: dmg, min: 1, max: 1, reason: "Choose 1 card of your Damage Pile to put back into your deck", then: [{ op: "pdDeckDrawGo", seat: e.seat, n }] });
  };
  OPS.pdDeckDrawGo = (ctx, op) => {
    const S = ctx.S; let n = op.n || 0;
    for (const id of op.answer || []) if (S.cards[id] && S.cards[id].place.z === "damage") { AA4.moveCard(ctx, id, { z: "deck", seat: S.cards[id].owner }); n++; }
    OPS.shuffle(ctx, { seat: op.seat });
    if (n) AA4.enqueue(S, [{ op: "draw", seat: op.seat, n }], true);
  };
  /** A3-03 0593 (Revise#245): a Break card of total factor X from your Damage Pile, set on a power-0 Controlled Character of yours, ignoring name, class and Break rule. */
  A.damageBreakSetX = (ctx, s, e) => {
    const S = ctx.S, x = +e.x || 0, fsum = inf => Object.values(inf.factor || {}).reduce((a, b) => a + (+b || 0), 0);
    const opts = S.players[e.seat].zones.damage.filter(id => { const i = ctx.db.card(S.cards[id].key) || {}; return i.type === "Break" && fsum(i) === x; });
    const chs = AA4.controlledOf(S, e.seat).filter(id => S.chars[id].power.length === 0);
    if (!opts.length || !chs.length) { ctx.emit({ e: "note", text: !opts.length ? `No Break card with factor ${x} in your Damage Pile` : "No power-0 Controlled Character" }); return; }
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 1, max: 1, reason: `Choose a Break card (factor ${x}) from your Damage Pile`, then: [{ op: "damageBreakSetPick", seat: e.seat, chs }] });
  };
  OPS.damageBreakSetPick = (ctx, op) => {
    const id = (op.answer || [])[0], chs = op.chs.filter(c => ctx.S.chars[c] && ctx.S.chars[c].power.length === 0);
    if (!id || !chs.length) return;
    return AA4.ask(ctx, { seat: op.seat, kind: "pick", options: chs, labels: chs.map(c => AA4.cardName(ctx.db.card(ctx.S.cards[AA4.topOf(ctx.S.chars[c])].key))), reason: `Choose the power-0 Controlled Character to set 「${AA4.cardName(ctx.db.card(ctx.S.cards[id].key))}」 on`, then: [{ op: "damageBreakSetGo", seat: op.seat, card: id }] });
  };
  OPS.damageBreakSetGo = (ctx, op) => { const ch = (op.answer || [])[0]; if (ch && ctx.S.cards[op.card] && ctx.S.cards[op.card].place.z === "damage") OPS.breakFromHandGo(ctx, { ch, seat: op.seat, answer: [op.card], anyZone: true }); };
  /** "≪あなたの任意の対戦相手1人のテリトリーの、各勢力のキャラクター1人ずつ≫を捨て札する" (A3-24 3580, Revise#170) */
  A.eachFactionOne = (ctx, s, e) => {
    const S = ctx.S, opps = AA4.living(S).filter(x => x !== e.seat && AA4.charsOf(S, x).length);
    if (!opps.length) return;
    if (opps.length === 1) return OPS.efoNext(ctx, { seat: e.seat, opp: opps[0], picked: [], done: [] });
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opps.map(String), labels: opps.map(x => S.players[x].name), auto: false, reason: "Choose an opponent: one character of each faction in their territory is discarded", then: [{ op: "efoOpp", seat: e.seat }] });
  };
  OPS.efoOpp = (ctx, op) => { const o = +(op.answer || [])[0]; if (ctx.S.players[o]) OPS.efoNext(ctx, { seat: op.seat, opp: o, picked: [], done: [] }); };
  OPS.efoNext = (ctx, op) => {
    const S = ctx.S, chs = AA4.charsOf(S, op.opp), order = AA4.FACTIONS.map(f => f.name);
    if (op.answer) { const ch = AA4.charOfCard(S, op.answer[0]); if (ch) op.picked.push(ch.id); op.done.push(op.f); }
    const facs = [...new Set(chs.map(id => AA4.charStats(S, ctx.db, id).faction).filter(Boolean))].filter(f => !op.done.includes(f)).sort((x, y) => order.indexOf(x) - order.indexOf(y));
    if (!facs.length) { for (const id of op.picked) if (S.chars[id]) AA4.defeat(ctx, id, { why: "discarded (one of each faction)", bySeat: op.seat }); return; }
    const f = facs[0], opts = chs.filter(id => AA4.charStats(S, ctx.db, id).faction === f);
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 1, max: 1, reason: `Choose 1 ${f} character to discard`, then: [{ op: "efoNext", seat: op.seat, opp: op.opp, picked: op.picked.slice(), done: op.done.slice(), f }] });
  };
  A.permsOfT = (ctx, s, e, r) => { for (const ch of chars(r)) if (ctx.S.chars[ch]) for (const id of ctx.S.chars[ch].perm.slice()) AA4.moveCard(ctx, id, { z: s.dest || "discard" }); };   // A3-18 2467 (Revise#170)
  /** "Xは…が上限の、あなたの任意の数に等しい" (A3-19 2605, Revise#172): X is chosen now, 0 … max */
  A.chooseX = (ctx, s, e) => {
    const max = Math.max(0, AA4.xOf(ctx.S, ctx.db, s.max, { seat: e.seat, ch: e.ch, card: e.card }, e.targets) || 0), opts = Array.from({ length: max + 1 }, (_, i) => String(i));
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, auto: false, reason: `Choose X (0 … ${max})`, then: [{ op: "chooseXGo", eid: e.eid }] });
  };
  OPS.chooseXGo = (ctx, op) => { const x = +((op.answer || [])[0]) || 0; ctx.S.effLast = x; for (const q of ctx.S.queue || []) if (q.e && q.e.eid === op.eid) q.e.x = x; ctx.emit({ e: "note", text: "X = " + x }); };
  A.drawPerDamage = (ctx, s, e, r) => { for (const seat of seats(r)) { const n = ctx.S.players[seat].zones.damage.length; if (n) AA4.enqueue(ctx.S, [{ op: "draw", seat, n }], true); } };   // "…はXドローする。Xはそのプレイヤーのダメージ置き場のカード枚数" (A3-08 1220, Revise#170)
  A.thisCardPowerT = (ctx, s, e, r) => { const S = ctx.S, c = e.card && S.cards[e.card], t = r.find(x => x.ch && S.chars[x.ch]); if (c && t && ["special", "discard"].includes(c.place.z)) AA4.moveCard(ctx, e.card, { z: "char", ch: t.ch, role: "power" }); };   // A3-25 3624 (Revise#166)
  OPS.toPowerOn = (ctx, op) => { for (const id of op.answer || []) if (ctx.S.chars[op.ch]) AA4.moveCard(ctx, id, { z: "char", ch: op.ch, role: "power" }); };
  /** "≪…キャラクター全てと、そのキャラクターにセットされているカード全て≫を、そのオーナーのデッキに戻し、そのデッキをシャッフルする" (A3-06 0981, Revise#164) */
  A.charsToDeckSel = (ctx, s, e) => {
    const S = ctx.S, ids = Object.keys(S.chars).filter(id => AA4.matchChar(S, ctx.db, s.sel || {}, id, { seat: e.seat, self: e.ch, x: +e.x || 0 })), owners = new Set();
    for (const id of ids) { const ch = S.chars[id]; if (!ch) continue; owners.add(ch.owner); for (const c of ch.stack.concat(ch.power, ch.perm)) AA4.moveCard(ctx, c, { z: "deck" }); }
    for (const seat of owners) OPS.shuffle(ctx, { seat });
  };
  /** "≪全てのプレイヤー≫は、Xドローする。Xはそれぞれのダメージ置き場のカード枚数に等しい" (A3-07 1027) */
  A.drawEachDamage = (ctx, s, e) => { for (const seat of AA4.livingOrder(ctx.S)) { const n = s.what === "controlled" ? AA4.controlledOf(ctx.S, seat).filter(id => !s.sel || AA4.matchChar(ctx.S, ctx.db, s.sel, id, { seat })).length : ctx.S.players[seat].zones.damage.length; if (n) AA4.enqueue(ctx.S, [{ op: "draw", seat, n }]); } };
  /** A3-07 1031: "目標を、目標のオーナーの勢力エリアにある、目標の勢力の勢力パーティの一番下に移動させる" */
  A.toPartyBottom = (ctx, s, e, r) => {
    const S = ctx.S;
    for (const x of r) { const ch = x.ch && S.chars[x.ch]; if (!ch) continue; const inf = ctx.db.card(S.cards[ch.stack[0]].key) || {}; OPS.moveChar(ctx, { ch: ch.id, to: { area: "active", slot: AA4.slotOfFaction(inf.faction), index: 0 } }); }   // index 0 = the bottom of the party
  };
  OPS.toHand = (ctx, op) => { for (const id of op.answer || []) AA4.moveCard(ctx, id, { z: "hand" }); };
  OPS.toBack = (ctx, op) => { for (const id of op.answer || []) { AA4.moveCard(ctx, id, { z: "back" }); ctx.emit({ e: "entered", card: id, seat: ctx.S.cards[id].owner, ch: AA4.charOfCard(ctx.S, id).id }); } };   // "…をあなたの支配キャラクターとしてセットする"
  OPS.toDeckShuffle = (ctx, op) => { const owners = new Set(); for (const id of op.answer || []) { owners.add(ctx.S.cards[id].owner); AA4.moveCard(ctx, id, { z: "deck" }); } for (const seat of owners.size ? owners : [op.seat]) AA4.OPS.shuffle(ctx, { seat }); };   // Revise#134
  OPS.factorLast = (ctx, op) => { ctx.S.effLast = (op.answer || []).reduce((k, id) => k + Object.values((ctx.db.card(ctx.S.cards[id].key) || {}).factor || {}).reduce((a, b) => a + (+b || 0), 0), 0); };
  OPS.toDeckBottom = (ctx, op) => { for (const id of op.answer || []) AA4.moveCard(ctx, id, { z: "deck", pos: "bottom" }); };   // EX0096 (Revise#207)
  OPS.toDeckTop = (ctx, op) => { ctx.S.effLast = (op.answer || []).length; for (const id of op.answer || []) AA4.moveCard(ctx, id, { z: "deck", pos: "top" }); };
  A.millBottomLast = (ctx, s, e) => { const deck = ctx.S.players[e.seat].zones.deck; for (let k = 0, n = +ctx.S.effLast || 0; k < n && deck.length; k++) AA4.moveCard(ctx, deck[0], { z: "discard" }); };   // "デッキの下からこのカードの効果でデッキに戻した枚数に等しい枚数捨て札する" (A3-22 3273, Revise#173)
  OPS.toDiscard = (ctx, op) => { for (const id of op.answer || []) AA4.moveCard(ctx, id, { z: "discard" }); };
  A.retarget = (ctx, s, e, r) => {
    const S = ctx.S, it = S.stack.find(x => r.some(y => y.item === x.id));
    if (!it || !it.card) return;
    if (s.byChoice) { it.choiceBy = e.seat; ctx.emit({ e: "note", text: `${S.players[e.seat].name} makes the choices of ${AA4.cardName(AA4.cardInfo(S, ctx.db, it.card) || {})}` }); }   // A3-15 2105 (Pack, Revise#248): its choices at resolution are yours
    const inf = AA4.cardInfo(S, ctx.db, it.card) || {}, spec = it.kind === "effect" ? ((it.ch && ctx.S.chars[it.ch] ? AA4.effectsOf(ctx.S, ctx.db, it.ch, it.card) : inf.effects || [])[it.i] || {}).target : (inf.play || {}).target;
    if (!spec || (s.byChoice && !spec.byChoice) || !(it.targets || []).length) return;   // 2105: declared choices are changed now (on the field); the others are made by you when it resolves
    const cand = AA4.targetCandidates(S, ctx.db, Object.assign({}, spec, { sel: Object.assign({}, spec.sel, s.sel || {}) }), { seat: e.seat });
    if (!cand.length) return;
    // Event System (Pack, Revise#099): each option by name — "Character (owner, area)" / a player / a card
    const label = x => x.ch && S.chars[x.ch] ? `${AA4.cardName(ctx.db.card(S.cards[AA4.topOf(S.chars[x.ch])].key) || {})} — ${S.players[S.chars[x.ch].owner].name}, ${AA4.isControlled(S.chars[x.ch]) ? "Control Area" : "Active Area"}`
      : x.seat != null ? `Player: ${S.players[x.seat].name}` : x.card && S.cards[x.card] ? AA4.cardName(ctx.db.card(S.cards[x.card].key) || {}) : JSON.stringify(x);
    const need = Math.max(1, (it.targets || []).length || (typeof spec.count === "number" ? spec.count : 1));
    return OPS.retargetAsk(ctx, { seat: e.seat, item: it.id, need, picked: [], cand: cand.map(x => JSON.stringify(x)), labels: cand.map(x => label(x)), old: (it.targets || []).slice(), reason: `${srcLabel(ctx, e)}: choose the new ${need > 1 ? "objects" : "object"} of ${AA4.cardName(inf)}` });
  };
  /** Pack (Revise#248): the new objects are clicked on the field one by one, like when the card was declared — no list box. */
  OPS.retargetAsk = (ctx, op) => {
    const opts = op.cand.filter(o => !op.picked.includes(o)), labels = opts.map(o => op.labels[op.cand.indexOf(o)]);
    if (!opts.length) return OPS.setTarget(ctx, Object.assign({}, op, { answer: [] }));
    return AA4.ask(ctx, { seat: op.seat, kind: "pick", options: opts, labels, auto: false, onField: true, old: op.old, fieldPicked: op.picked.slice(), reason: op.need > 1 ? `${op.reason} (${op.picked.length + 1} of ${op.need})` : op.reason, then: [Object.assign({}, op, { op: "setTarget" })] });
  };
  OPS.setTarget = (ctx, op) => {
    const it = ctx.S.stack.find(x => x.id === op.item); if (!it) return;
    const picked = (op.picked || []).concat((op.answer || []).slice(0, 1));
    if (op.need && picked.length < op.need && op.cand && op.cand.some(o => !picked.includes(o))) return OPS.retargetAsk(ctx, Object.assign({}, op, { picked, answer: undefined }));
    if (!picked.length) return;
    it.targets = picked.map(o => JSON.parse(o)); ctx.emit({ e: "retargeted", item: it.id, card: it.card, to: it.targets[0], all: it.targets });
  };
  /** "≪あなたの任意の勢力N つのキャラクター全て≫を捨て札する": choose a faction; every character of it is discarded. */
  /** "≪あなたの任意の勢力パーティ1つのキャラクター全て≫にNダメージを与える" (Revise#109): one faction party of one player's Active Area. */
  A.partyDamage = (ctx, s, e) => {
    const S = ctx.S, opts = [], labels = [];
    for (const seat of AA4.livingOrder(S)) for (const slot of AA4.SLOTS) {
      const list = (S.players[seat].areas.active[slot] || []).filter(id => S.chars[id]);
      if (list.length) { opts.push(seat + ":" + slot); labels.push(`${S.players[seat].name}${seat === e.seat ? " (you)" : ""} · ${(AA4.FACTIONS.find(f => f.id === slot) || { name: "No faction" }).name} party — ${list.length} character${list.length === 1 ? "" : "s"}`); }
    }
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, labels, auto: false, reason: `Choose 1 faction party: each character there takes ${nOf(s, e)} damage`, then: [{ op: "partyDamageGo", n: nOf(s, e), mental: !!s.mental, from: e.ch || null }] });
  };
  OPS.partyDamageGo = (ctx, op) => {
    const S = ctx.S, [seat, slot] = String((op.answer || [])[0] || "").split(":");
    const list = ((S.players[+seat] || { areas: { active: {} } }).areas.active[slot] || []).slice();
    for (const id of list) if (S.chars[id]) AA4.damageChar(ctx, id, Object.assign({ from: op.from }, op.mental ? { normal: 0, mental: op.n } : { normal: op.n, mental: 0 }));
  };
  /** "目標の≪プレイヤー1人≫の手札を見て、その中の任意のカードをN枚までデッキに戻して、デッキをシャッフルする。その後、
      目標のプレイヤーはデッキに戻したカード枚数に等しい枚数ドローする" (Revise#109). */
  A.handToDeckDraw = (ctx, s, e, r) => {
    const S = ctx.S, seat = seats(r)[0];
    if (seat == null) return;
    const hand = S.players[seat].zones.hand.slice();
    for (const id of hand) if (!S.cards[id].visibleTo.includes(e.seat)) S.cards[id].visibleTo.push(e.seat);   // "手札を見て": the cards are shown to you
    ctx.emit({ e: "handSeen", seat, by: e.seat, cards: hand });
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: hand, min: 0, max: Math.min(nOf(s, e), hand.length), auto: false,
      reason: `${S.players[seat].name}'s hand: choose up to ${nOf(s, e)} to shuffle into their deck (they draw that many)`, then: [{ op: "handToDeckGo", seat }] });
  };
  OPS.handToDeckGo = (ctx, op) => {
    const S = ctx.S, ids = (op.answer || []).filter(id => S.cards[id] && S.cards[id].place.z === "hand" && S.cards[id].owner === op.seat);
    for (const id of ids) AA4.moveCard(ctx, id, { z: "deck", pos: "top" });
    OPS.shuffle(ctx, { seat: op.seat });
    if (ids.length) AA4.enqueue(S, [{ op: "draw", seat: op.seat, n: ids.length }], true);
  };
  /** "≪P≫は、自分の捨て札置き場のカード全てをシャッフルし、その中からランダムに選んだカードN枚を目標のデッキに戻し、デッキをシャッフルする". */
  A.discardRandomToDeck = (ctx, s, e, r) => {
    const S = ctx.S;
    for (const seat of seats(r)) {
      const pile = AA4.shuffleInPlace(S, S.players[seat].zones.discard.slice());
      for (const id of pile.slice(0, nOf(s, e))) AA4.moveCard(ctx, id, { z: "deck", pos: "top" });
      OPS.shuffle(ctx, { seat });
    }
  };
  A.factionDiscard = (ctx, s, e) => {
    const S = ctx.S, list = Object.keys(S.chars).filter(id => !s.own || (S.chars[id].owner === e.seat && AA4.isControlled(S.chars[id])));
    const order = AA4.FACTIONS.map(f => f.name), facs = [...new Set(list.map(id => AA4.charStats(S, ctx.db, id).faction).filter(Boolean))].sort((x, y) => order.indexOf(x) - order.indexOf(y));   // E.G.O. → … → Eraser
    if (!facs.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: facs, labels: facs.map(f => `${f} (${list.filter(id => AA4.charStats(S, ctx.db, id).faction === f).length} characters)`), reason: "Choose a faction: all its characters are discarded",
      then: [{ op: "factionGo", own: !!s.own, seat: e.seat, label: srcLabel(ctx, e) }] });
  };
  OPS.factionGo = (ctx, op) => {
    const S = ctx.S, f = (op.answer || [])[0];
    for (const id of Object.keys(S.chars)) if ((!op.own || (S.chars[id].owner === op.seat && AA4.isControlled(S.chars[id]))) && AA4.charStats(S, ctx.db, id).faction === f) AA4.defeat(ctx, id, { why: `discarded by ${op.label}` });
  };
  /** "目標の持つスキルまたはエフェクト1つを無効化する": the user picks one skill or effect line of the target. */
  A.negateOne = (ctx, s, e, r) => {
    const S = ctx.S, ch = chars(r)[0];
    if (!ch || !S.chars[ch]) return;
    const st = AA4.charStats(S, ctx.db, ch), opts = [], labels = [];
    if (s.only !== "effect") for (const k of Object.keys(st.skills)) { opts.push("s:" + k); labels.push("Skill: " + (AA4.SKILLS[k] ? AA4.SKILLS[k].en : k)); }
    if (s.only !== "skill") AA4.effectsOf(S, ctx.db, ch, AA4.topOf(S.chars[ch])).forEach(ef => { if (!ef.negated) { opts.push("e:" + ef.text); labels.push("Effect: " + ef.text); } });
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, labels, reason: "Choose the skill or effect to negate", then: [{ op: "negateGo", ch, until: s.until || "main", src: { card: e.card, seat: e.seat, ch: e.ch, label: srcLabel(ctx, e) } }] });
  };
  OPS.negateGo = (ctx, op) => {
    const v = String((op.answer || [])[0] || "");
    if (v.startsWith("s:")) AA4.addMod(ctx, { src: op.src, to: { ch: op.ch }, key: "skill", op: "remove", value: { id: v.slice(2) }, until: op.until });
    else if (v.startsWith("e:")) AA4.addMod(ctx, { src: op.src, to: { ch: op.ch }, key: "negateEffect", op: "grant", value: { text: v.slice(2) }, until: op.until });
  };
  A.permDiscard = (ctx, s, e, r) => { for (const ch of chars(r)) for (const id of ctx.S.chars[ch].perm.slice()) AA4.moveCard(ctx, id, { z: "discard" }); };
  /** "このカードの使用宣言時に、ネームを1つ指定する": a personal name (from Break cards you can see) for the steps after. */
  A.nameChoose = (ctx, s, e) => {
    const S = ctx.S, names = new Set();
    for (const c of Object.values(S.cards)) {
      if (!(c.owner === e.seat && ["hand", "damage", "discard"].includes(c.place.z)) && c.place.z !== "char") continue;
      const inf = ctx.db.card(c.key) || {};
      if (inf.type === "Break" && inf.name) names.add(inf.name);
    }
    const opts = [...names].sort();
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, labels: opts.map(n => AA4.nameEn(ctx.db, n)), reason: "Name a personal name", then: [{ op: "nameSet" }] });   // labels in English (Pack, Revise#122)
  };
  OPS.nameSet = (ctx, op) => { ctx.S.effName = (op.answer || [])[0] || null; ctx.emit({ e: "named", name: ctx.S.effName }); };
  /** "任意のプレイヤー1人の手札1枚を捨て札" (M1a): choose a player with cards in hand; that player discards (they choose which). */
  A.playerHandDiscard = (ctx, s, e) => {
    const S = ctx.S, opts = AA4.livingOrder(S).filter(seat => S.players[seat].zones.hand.length);
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts.map(String), labels: opts.map(seat => `${S.players[seat].name}${seat === e.seat ? " (you)" : ""} — ${S.players[seat].zones.hand.length} in hand`), auto: false,
      reason: `${srcLabel(ctx, e)}: choose a player — they discard ${s.n || 1} from their hand`, then: [{ op: "playerHandGo", n: s.n || 1 }] });
  };
  OPS.playerHandGo = (ctx, op) => {
    const seat = +((op.answer || [])[0]);
    if (!ctx.S.players[seat]) return;
    const n = Math.min(op.n, ctx.S.players[seat].zones.hand.length);
    if (n) AA4.enqueue(ctx.S, [{ op: "askDiscard", seat, n }], true);
  };
  /** "≪あなたのデッキ≫からキャラクターカードを1枚選び、勢力エリアにアクティブキャラクターとしてセット可能" (M1a): deck → Active Area, then shuffle. */
  A.deckToActive = (ctx, s, e) => {
    const S = ctx.S, deck = S.players[e.seat].zones.deck, opts = deck.filter(id => AA4.cardMatches(ctx.db.card(S.cards[id].key) || {}, s.sel || { type: "Character" })).sort();
    if (!opts.length) { OPS.shuffle(ctx, { seat: e.seat }); return; }
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 0, max: Math.min(s.n || 1, opts.length), auto: false,
      reason: `${srcLabel(ctx, e)}: choose up to ${s.n || 1} Character card from your deck — it is set in your Active Area`, then: [{ op: "deckToActiveGo", seat: e.seat }] });
  };
  OPS.deckToActiveGo = (ctx, op) => {
    const S = ctx.S;
    for (const id of op.answer || []) {
      const inf = ctx.db.card(S.cards[id].key) || {};
      if (inf.name && AA4.nameOnField(S, ctx.db, inf.name, undefined, inf)) {   // name rule: to the Damage Pile instead (as a Character Set Declaration)
        AA4.moveCard(ctx, id, { z: "damage" });
        ctx.emit({ e: "setFailed", card: id, seat: op.seat, why: `“${inf.name}” is already on the field` });
        continue;
      }
      AA4.moveCard(ctx, id, { z: "active" });
      ctx.emit({ e: "entered", card: id, seat: op.seat, ch: AA4.charOfCard(S, id).id });
    }
    OPS.shuffle(ctx, { seat: op.seat });
  };
  /** "≪あなたのテリトリーのパワーカード1枚≫を、このキャラクターにパワーカードとしてセット" (M1a). */
  A.powerToSelf = (ctx, s, e, r) => {
    const S = ctx.S;
    if (!S.chars[e.ch]) return;
    for (const x of r.filter(y => y.card && S.cards[y.card] && S.cards[y.card].place.role === "power" && S.cards[y.card].place.ch !== e.ch)) AA4.moveCard(ctx, x.card, { z: "char", ch: e.ch, role: "power" });
  };
  /** "あなたの任意のパワーカード1枚を捨て札" (M1b): one of your power cards, you choose (optional ability). */
  A.ownPowerDiscard = (ctx, s, e) => {
    const S = ctx.S, opts = (s.any ? Object.keys(S.chars) : AA4.charsOf(S, e.seat)).flatMap(ch => S.chars[ch].power), k = Math.min(s.n === "last" ? +S.effLast || 0 : s.n === "X" ? nOf(s, e) : s.n || 1, opts.length);
    if (!opts.length || !k) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: k, max: k, auto: false, reason: `${srcLabel(ctx, e)}: discard ${k} power card${k === 1 ? "" : "s"}${s.any ? "" : " of yours"}`, then: [{ op: "discardChosen" }] });
  };
  /** "≪このキャラクター≫はFまたはFのファクターを1つ得る" (M1c): the player chooses which. */
  A.factorPick = (ctx, s, e, r) => {
    const ch = chars(r)[0];
    if (!ch) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: s.factions.slice(), auto: false, reason: `${srcLabel(ctx, e)}: which factor?`, then: [{ op: "factorGo", ch, n: s.n || 1, until: s.until || "turn", src: { card: e.card, seat: e.seat, ch: e.ch, label: srcLabel(ctx, e) } }] });
  };
  OPS.factorGo = (ctx, op) => AA4.addMod(ctx, { src: op.src, fromChar: true, to: { ch: op.ch }, key: "factor", op: "add", value: { faction: (op.answer || [])[0], n: op.n }, until: op.until });
  /** "≪あなたのデッキ≫からFのパーマネントカード1枚を選び、このキャラクターにセット(可能)" (M1c): no cost; then shuffle. */
  A.deckPermToSelf = (ctx, s, e) => {
    const S = ctx.S, ch = e.ch && S.chars[e.ch] ? e.ch : null, opts = S.players[e.seat].zones.deck.filter(id => AA4.cardMatches(ctx.db.card(S.cards[id].key) || {}, s.sel)).sort();
    if (!ch || !opts.length) { OPS.shuffle(ctx, { seat: e.seat }); return; }
    AA4.revealTo(S, opts, e.seat);   // shown face up to the chooser (Revise#206)
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 0, max: Math.min(s.n || 1, opts.length), auto: false, reason: `${srcLabel(ctx, e)}: a Permanent card from your deck onto this character`, then: [{ op: "permFromDeckGo", ch, seat: e.seat }] });
  };
  OPS.permFromDeckGo = (ctx, op) => {
    for (const id of op.answer || []) if (ctx.S.chars[op.ch]) { AA4.moveCard(ctx, id, { z: "char", ch: op.ch, role: "perm" }); ctx.emit({ e: "entered", card: id, seat: op.seat, ch: op.ch }); }
    OPS.shuffle(ctx, { seat: op.seat });
    AA4.enqueue(ctx.S, [{ op: "permCheck" }]);
  };
  /** "≪あなたのデッキ≫の上からカード3枚を見て1枚を手札に加え、残りを捨て札する" (M1c). */
  A.lookTake = (ctx, s, e) => {
    const deck = ctx.S.players[e.seat].zones.deck, top = deck.slice(-(s.n || 3)).reverse();
    if (!top.length) return;
    for (const id of top) { const c = ctx.S.cards[id]; c.visibleTo = [e.seat]; }
    if (s.reveal) AA4.revealTo(ctx.S, top, "all");
    if (s.sel) {   // "≪あなたのデッキ≫のカードを上から5枚公開する。その中にある、プロジェクトカードまたはファストカード1枚をあなたの手札に加え、残りをデッキに戻す" (A4-03 0470, Revise#310)
      const ok = top.filter(id => AA4.cardSelOk(ctx.db.card(ctx.S.cards[id].key) || {}, s.sel)), k = Math.min(s.take || 1, ok.length);
      if (s.reveal) ctx.emit({ e: "revealed", seat: e.seat, cards: top.slice(), keys: top.map(id => ctx.S.cards[id].key) });
      if (!ok.length) return OPS.lookTakeGo(ctx, { cards: top, rest: s.rest || "discard", answer: [] });
      return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: ok, min: k, max: k, auto: false, reason: `${srcLabel(ctx, e)}: take ${k} into your hand — the rest go ${s.rest === "deck" ? "back into the deck" : "to the Discard Pile"}`, then: [{ op: "lookTakeGo", cards: top, rest: s.rest || "discard" }] });
    }
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: top, min: Math.min(s.take || 1, top.length), max: Math.min(s.take || 1, top.length), auto: false, reason: `${srcLabel(ctx, e)}: take ${s.take || 1} into your hand — the rest go to the Discard Pile`, then: [{ op: "lookTakeGo", cards: top, rest: s.rest || "discard" }] });
  };
  OPS.lookTakeGo = (ctx, op) => {
    for (const id of op.answer || []) AA4.moveCard(ctx, id, { z: "hand" });
    for (const id of op.cards) if (!(op.answer || []).includes(id) && ctx.S.cards[id].place.z === "deck") { if (op.rest === "deck") ctx.S.cards[id].visibleTo = []; else AA4.moveCard(ctx, id, { z: op.rest }); }
  };
  /** "目標の≪キャラクター1人≫にセットされているパワーカード全てを公開する。その中から▼または悪魔・悪魔♂を持つカード全てをそのオーナーのダメージ置き場に置く" (A4-02 0344, Revise#312). */
  A.powerRevealToDamage = (ctx, s, e, r) => {
    const S = ctx.S;
    for (const ch of chars(r)) {
      const c = S.chars[ch]; if (!c) continue;
      const pw = c.power.slice(); AA4.revealTo(S, pw, "all");
      ctx.emit({ e: "revealed", seat: e.seat, cards: pw, keys: pw.map(id => S.cards[id].key) });
      for (const id of pw) { const inf = ctx.db.card(S.cards[id].key) || {}; if ((s.aggressive && (inf.skills || {}).aggressive) || (s.icons || []).some(i => (inf.icons || []).includes(i))) AA4.moveCard(ctx, id, { z: "damage" }); }
    }
    AA4.enqueue(S, [{ op: "mentalCheck" }]);
  };
  /** "≪あなたの任意のキャラクター≫に、(X)ダメージを割り振って与える" (A4-05 0877, Revise#312): one point at a time, then all at once. */
  A.splitDamage = (ctx, s, e) => {
    const n = s.n === "last" ? +ctx.S.effLast || 0 : nOf(s, e), S = ctx.S, opts = Object.keys(S.chars).filter(id => !s.sel || AA4.matchChar(S, ctx.db, s.sel, id, { seat: e.seat }));   // n "last" / players: "任意の≪プレイヤーまたはキャラクター≫に(X)ダメージを割り振って与える" (1948, Revise#363)
    if (n <= 0 || (!opts.length && !s.players)) return;
    AA4.enqueue(S, [{ op: "splitDamageAsk", seat: e.seat, left: n, alloc: {}, mental: !!s.mental, players: !!s.players, area: s.area === "last" ? S.effArea || { seat: -1 } : null, from: e.ch || null, sel: s.sel || null, src: srcLabel(ctx, e) }], true);   // area "last": "そのキャラクターのいたエリアの任意のキャラクター" (3694, Revise#365)
  };
  OPS.splitDamageAsk = (ctx, op) => {
    const S = ctx.S, chs = Object.keys(S.chars).filter(id => (!op.sel || AA4.matchChar(S, ctx.db, op.sel, id, { seat: op.seat })) && (!op.area || (S.chars[id].owner === op.area.seat && AA4.isControlled(S.chars[id]) === op.area.ctl))), pls = op.players ? AA4.living(S).map(x => "p:" + x) : [], opts = pls.concat(chs);
    if (!opts.length) return;
    const nameOf = id => (/^p:/.test(id) ? S.players[+id.slice(2)].name : AA4.cardName(AA4.cardInfo(S, ctx.db, AA4.topOf(S.chars[id])) || {}));
    const given = Object.entries(op.alloc).filter(([id]) => /^p:/.test(id) || S.chars[id]).map(([id, k]) => `${nameOf(id)} ${op.mental ? "(" + k + ")" : k}`).join(", ");
    return AA4.ask(ctx, { seat: op.seat, kind: "pick", options: opts, labels: opts.map(id => (/^p:/.test(id) ? `Player ${nameOf(id)}` : `${S.players[S.chars[id].owner].name}: ${nameOf(id)}`) + (op.alloc[id] ? ` (+${op.alloc[id]})` : "")), onField: !op.players, auto: false,
      reason: `${op.src}: give 1 of the ${op.left} ${op.mental ? "mental " : ""}damage left to a ${op.players ? "player or " : ""}character${given ? " — so far: " + given : ""}`, then: [{ op: "splitDamageGo", seat: op.seat, left: op.left, alloc: op.alloc, mental: op.mental, players: op.players, area: op.area || null, from: op.from, sel: op.sel, src: op.src }] });
  };
  OPS.splitDamageGo = (ctx, op) => {
    const ch = (op.answer || [])[0], alloc = Object.assign({}, op.alloc), ok = ch && (ctx.S.chars[ch] || (op.players && /^p:/.test(ch)));
    if (ok) alloc[ch] = (alloc[ch] || 0) + 1;
    if (op.left > 1 && ok) return AA4.enqueue(ctx.S, [Object.assign({}, op, { op: "splitDamageAsk", left: op.left - 1, alloc, answer: undefined })], true);
    for (const [id, k] of Object.entries(alloc)) {
      const d = op.mental ? { normal: 0, mental: k } : { normal: k, mental: 0 };
      if (/^p:/.test(id)) { if (ctx.S.players[+id.slice(2)] && !ctx.S.players[+id.slice(2)].lost) AA4.damagePlayer(ctx, +id.slice(2), d, { from: op.from, fromSeat: op.seat }); }
      else if (ctx.S.chars[id]) AA4.damageChar(ctx, id, Object.assign({ from: op.from, fromSeat: op.seat }, d));
    }
  };
  /** 0708 (Revise#363): "場またはダメージ置き場のカードを1枚指定する。その後、≪あなたのデッキ≫から、指定したカードと同じ名称のカード1枚を選び、手札に加える" */
  A.deckSameAsPicked = (ctx, s, e) => {
    const S = ctx.S, opts = Object.values(S.chars).flatMap(c => c.stack.concat(c.perm)).concat(...AA4.living(S).map(x => S.players[x].zones.damage));
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 1, max: 1, auto: false, reason: "Name a card on the field or in a Damage Pile: you take a card with that name from your deck", then: [{ op: "deckSameAsGo", seat: e.seat }] });
  };
  OPS.deckSameAsGo = (ctx, op) => {
    const S = ctx.S, id = (op.answer || [])[0], jp = id && S.cards[id] ? (ctx.db.card(S.cards[id].key) || {}).jp : null; if (!jp) return;
    const opts = S.players[op.seat].zones.deck.filter(c => (ctx.db.card(S.cards[c].key) || {}).jp === jp);
    if (!opts.length) return ctx.emit({ e: "note", text: "No card with that name in the deck" });
    AA4.moveCard(ctx, opts[0], { z: "hand", seat: op.seat });
    ctx.emit({ e: "handRevealed", seat: op.seat, keys: [S.cards[opts[0]].key], to: "all" });
  };
  /** "≪キャラクターにセットされているカード全て≫を、オーナーの手札に戻す" (A4-05 0918, Revise#310): power cards and permanents. */
  A.allSetToHand = (ctx) => { for (const ch of Object.values(ctx.S.chars)) for (const id of ch.power.concat(ch.perm)) AA4.moveCard(ctx, id, { z: "hand" }); AA4.enqueue(ctx.S, [{ op: "permCheck" }]); };
  /** "≪プレイヤー全て≫は自分のデッキの中からカード1枚をダメージ置き場に置き、デッキをシャッフルする" (A4-03 0506, Revise#310): each player chooses, in turn order. */
  A.eachDeckToDamage = (ctx, s, e) => { AA4.enqueue(ctx.S, AA4.livingOrder(ctx.S).map(seat => ({ op: "deckToDamageAsk", seat, n: s.n || 1, src: srcLabel(ctx, e) })), true); };
  OPS.deckToDamageAsk = (ctx, op) => {
    const deck = ctx.S.players[op.seat].zones.deck.slice();
    if (!deck.length) return;
    AA4.revealTo(ctx.S, deck, op.seat);
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: deck.reverse(), min: Math.min(op.n, deck.length), max: Math.min(op.n, deck.length), auto: false, reason: `${op.src}: put ${op.n} card${op.n === 1 ? "" : "s"} of your deck into your Damage Pile (the deck is shuffled after)`, then: [{ op: "deckToDamageGo", seat: op.seat }] });
  };
  OPS.deckToDamageGo = (ctx, op) => { for (const id of op.answer || []) AA4.moveCard(ctx, id, { z: "damage" }); OPS.shuffle(ctx, { seat: op.seat }); };
  /** "あなたの手札のカードを1枚公開する。その後、≪あなたのデッキ≫の上から10枚を公開し、その中にある、公開した手札のカードと同じ名称のカード全てを手札に加える" (A4-04 0767, Revise#310). */
  A.handNameDig = (ctx, s, e) => {
    const hand = ctx.S.players[e.seat].zones.hand.slice();
    if (!hand.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: hand, min: 1, max: 1, auto: false, reason: `${srcLabel(ctx, e)}: show a card of your hand — the cards with the same name among the top ${s.n || 10} of your deck go to your hand`, then: [{ op: "handNameDigGo", seat: e.seat, n: s.n || 10 }] });
  };
  OPS.handNameDigGo = (ctx, op) => {
    const S = ctx.S, pick = (op.answer || [])[0];
    if (!pick || !S.cards[pick]) return;
    AA4.revealTo(S, [pick], "all");
    const jp = String((ctx.db.card(S.cards[pick].key) || {}).jp || "").replace(/\s+/g, ""), deck = S.players[op.seat].zones.deck, top = deck.slice(-op.n).reverse();
    AA4.revealTo(S, top, "all");
    ctx.emit({ e: "revealed", seat: op.seat, cards: [pick].concat(top), keys: [pick].concat(top).map(id => S.cards[id].key) });
    for (const id of top) if (String((ctx.db.card(S.cards[id].key) || {}).jp || "").replace(/\s+/g, "") === jp) AA4.moveCard(ctx, id, { z: "hand" });
    for (const id of top) if (S.cards[id].place.z === "deck") S.cards[id].visibleTo = [];
  };
  /** "≪あなたの手札のカード1枚≫をダメージ置き場に置く" (M1c): you choose. */
  A.handToDamage = (ctx, s, e) => {
    const hand = ctx.S.players[e.seat].zones.hand;
    if (!hand.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: hand.slice(), min: Math.min(s.n || 1, hand.length), max: Math.min(s.n || 1, hand.length), auto: false, reason: `${srcLabel(ctx, e)}: put ${s.n || 1} card${(s.n || 1) > 1 ? "s" : ""} of your hand into your Damage Pile`, then: [{ op: "toDamageChosen" }] });
  };
  OPS.toDamageChosen = (ctx, op) => { for (const id of op.answer || []) AA4.moveCard(ctx, id, { z: "damage" }); };
  /** Q#37 (Pack: set for free): a Permanent card from your hand whose name contains … → onto this character (no cost; the limit check still runs). */
  A.handPermToSelf = (ctx, s, e) => {
    const S = ctx.S, ch = e.ch && S.chars[e.ch] ? e.ch : null;
    const opts = S.players[e.seat].zones.hand.filter(id => { const inf = ctx.db.card(S.cards[id].key) || {}; return inf.type === "Permanent" && (!s.nameHas || (inf.name || inf.jp || "").includes(s.nameHas)) && (!s.faction || inf.faction === s.faction); });
    if (!ch || !opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: s.upTo ? 0 : Math.min(s.n || 1, opts.length), max: Math.min(s.n || 1, opts.length), auto: false, reason: `${srcLabel(ctx, e)}: set a Permanent from your hand on this character (free)`, then: [{ op: "permFromHandGo", ch, seat: e.seat }] });
  };
  /** "目標の≪…パーマネントカード1枚≫をこのキャラクターにセットする": the chosen card (hand / Discard Pile) onto this character. */
  A.permToSelf = (ctx, s, e, r) => {
    const S = ctx.S;
    if (!e.ch || !S.chars[e.ch]) return;
    for (const x of r.filter(y => y.card && S.cards[y.card] && ["hand", "discard", "damage"].includes(S.cards[y.card].place.z))) { AA4.moveCard(ctx, x.card, { z: "char", ch: e.ch, role: "perm" }); ctx.emit({ e: "entered", card: x.card, seat: e.seat, ch: e.ch }); }
    AA4.enqueue(S, [{ op: "permCheck" }]);
  };
  /** "目標の≪プレイヤー1人≫の、デッキの1番上のカード1枚を、目標のプレイヤーの任意の、…キャラクター1人にパワーカードとしてセットさせる" */
  A.deckTopToOwnChar = (ctx, s, e, r) => {
    const S = ctx.S, ops = [];
    for (const seat of seats(r)) {
      const opts = AA4.charsOf(S, seat);
      if (opts.length && S.players[seat].zones.deck.length) ops.push({ op: "askDeckTopChar", seat, opts });
    }
    AA4.enqueue(S, ops, true);
  };
  OPS.askDeckTopChar = (ctx, op) => {
    const S = ctx.S, opts = op.opts.filter(id => S.chars[id]);
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: op.seat, kind: "pick", options: opts, labels: opts.map(id => AA4.cardName(ctx.db.card(S.cards[AA4.topOf(S.chars[id])].key))), reason: "Choose your character: the top card of your deck goes onto it as a power card", then: [{ op: "deckTopCharGo", seat: op.seat }] });
  };
  OPS.deckTopCharGo = (ctx, op) => {
    const S = ctx.S, ch = (op.answer || [])[0], deck = S.players[op.seat].zones.deck;
    if (ch && S.chars[ch] && deck.length) AA4.moveCard(ctx, deck[deck.length - 1], { z: "char", ch, role: "power" });
  };
  /** "目標の≪あなたの捨て札置き場にあるブレイクカード1枚≫をあなたの支配キャラクターとしてセットする" */
  A.cardToBack = (ctx, s, e, r) => { const ids = r.filter(x => x.card && ctx.S.cards[x.card] && ["hand", "discard", "damage"].includes(ctx.S.cards[x.card].place.z)).map(x => x.card); if (ids.length) OPS.toBack(ctx, { answer: ids }); };
  /** "≪あなたの任意のキャラクターX体とあなた≫にXダメージを与える": you choose that many of your characters. */
  A.pickDamage = (ctx, s, e) => {
    const S = ctx.S, opts = Object.keys(S.chars).filter(id => AA4.matchChar(S, ctx.db, s.sel || {}, id, { seat: e.seat, self: e.ch, x: e.x }));
    const k = s.count === "any" ? opts.length : Math.min((s.count === "X" ? +e.x || 0 : +s.count || 0) + (+s.countPlus || 0), opts.length);   // "any": "X体 … Xは100以下のあなたの任意の数" (EX0455); countPlus: "1+X体" (EX0120, Revise#354)
    if (!k) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: s.count === "any" ? 0 : k, max: k, auto: s.count === "any" ? false : undefined, reason: s.count === "any" ? `Choose any number of characters: ${nOf(s, e)} damage each` : `Choose ${k} character${k > 1 ? "s" : ""}: ${nOf(s, e)} damage each`, then: [{ op: "pickDamageGo", n: nOf(s, e), from: e.ch || null }] });
  };
  /** "≪あなたの任意の…1人を構成するカード全て≫をあなたの手札に戻す" (chosen when it resolves) */
  A.pickBounce = (ctx, s, e) => {
    const S = ctx.S, opts = Object.keys(S.chars).filter(id => AA4.matchChar(S, ctx.db, s.sel || {}, id, { seat: e.seat, self: e.ch, x: e.x }));
    const k = Math.min(+s.count || 1, opts.length);
    if (!k) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: k, max: k, reason: `Choose ${k}: back to the hand`, then: [{ op: "pickBounceGo", label: srcLabel(ctx, e) }] });
  };
  OPS.pickBounceGo = (ctx, op) => { for (const id of op.answer || []) { const ch = AA4.charOfCard(ctx.S, id); if (ch) AA4.removeChar(ctx, ch.id, { to: "hand", why: `returned by ${op.label}` }); } };
  OPS.pickDamageGo = (ctx, op) => { for (const id of op.answer || []) { const ch = AA4.charOfCard(ctx.S, id); if (ch && ctx.S.chars[ch.id]) AA4.damageChar(ctx, ch.id, { normal: op.n, mental: 0, from: op.from }); } };
  /** "…パワーが精神力と等しくなるか、手札がなくなるまで、あなたの手札 / デッキの上からカードをパワーカードとして、このキャラクターにセットする" */
  /** A3-EP EP198 (Revise#222): "≪あなたの任意のあなたの支配キャラクターX体≫に、精神力に等しくなるまであなたのデッキからカードを引いて、パワーカードとしてセットする" */
  A.fillPowerPick = (ctx, s, e) => {
    const S = ctx.S, chs = AA4.controlledOf(S, e.seat), n = Math.min(nOf(s, e), chs.length);
    if (!n) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: chs.map(id => AA4.topOf(S.chars[id])), min: n, max: n, reason: `Choose ${n} of your Controlled Characters: each draws power cards from your deck up to its Mental`, then: [{ op: "fillPowerPickGo", e: { seat: e.seat } }] });
  };
  OPS.fillPowerPickGo = (ctx, op) => { for (const top of op.answer || []) { const ch = ctx.S.cards[top] && ctx.S.cards[top].place.ch; if (ch) A.fillPower(ctx, { from: "deck" }, Object.assign({}, op.e, { ch })); } };
  A.fillPower = (ctx, s, e) => {
    const S = ctx.S, ch = e.ch && S.chars[e.ch];
    if (!ch) return;
    const need = Math.max(0, (AA4.charStats(S, ctx.db, e.ch).se || 0) - ch.power.length), p = S.players[ch.owner];
    if (!need) return;
    if (s.from === "deck") { for (let i = 0; i < need && p.zones.deck.length; i++) AA4.moveCard(ctx, p.zones.deck[p.zones.deck.length - 1], { z: "char", ch: e.ch, role: "power" }); return; }
    const k = Math.min(need, p.zones.hand.length);
    if (!k) return;
    return AA4.ask(ctx, { seat: ch.owner, kind: "cards", options: p.zones.hand.slice(), min: k, max: k, reason: `${srcLabel(ctx, e)}: set ${k} card${k === 1 ? "" : "s"} from your hand as power cards on it`, then: [{ op: "fillPowerGo", ch: e.ch }] });
  };
  OPS.fillPowerGo = (ctx, op) => { for (const id of op.answer || []) if (ctx.S.chars[op.ch] && ctx.S.cards[id].place.z === "hand") AA4.moveCard(ctx, id, { z: "char", ch: op.ch, role: "power" }); };
  /** "≪このキャラクターを目標に効果を発揮しているプロジェクトカード全てとファストカード全て≫を、そのオーナーの手札に戻す" */
  A.lastingToHand = (ctx, s, e) => {
    const S = ctx.S, cards = [...new Set(S.modifiers.filter(m => m.to && m.to.ch === e.ch && m.src && m.src.card && S.cards[m.src.card] && S.cards[m.src.card].place.z === "special").map(m => m.src.card))];
    for (const id of cards) {
      for (const m of S.modifiers.filter(x => x.src && x.src.card === id)) AA4.endMod(ctx, m.id);
      if (S.cards[id].place.z === "special") AA4.moveCard(ctx, id, { z: "hand" });
    }
  };
  /** "…3種類の中からカード種類1つを指定する。その後、目標の≪プレイヤー1人≫の手札からあなたの任意のカード1枚を引く。引いたカードが
      指定した種類のカードだった場合、そのカードをダメージ置き場に置く。それ以外…手札に戻す": name a type, then a card of their hand at random. */
  A.guessType = (ctx, s, e, r) => {
    const seat = seats(r)[0];
    if (seat == null || !ctx.S.players[seat].zones.hand.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: s.types, labels: s.types.map(t => t + " card"), reason: "Name a card type, then draw a card of their hand at random", then: [{ op: "guessTypeGo", seat, by: e.seat }] });
  };
  OPS.guessTypeGo = (ctx, op) => {
    const S = ctx.S, hand = S.players[op.seat].zones.hand, type = (op.answer || [])[0];
    if (!hand.length) return;
    const id = hand[AA4.randInt(S, hand.length)], inf = ctx.db.card(S.cards[id].key) || {};
    ctx.emit({ e: "cardShown", card: id, seat: op.seat, by: op.by, named: type, hit: inf.type === type });
    if (inf.type === type) AA4.moveCard(ctx, id, { z: "damage" });
  };
  /** "あなたのデッキから3枚引き、任意の順番でデッキの上に戻す" */
  A.reorderTop = (ctx, s, e) => {
    const deck = ctx.S.players[e.seat].zones.deck, top = deck.slice(-Math.min(nOf(s, e), deck.length));
    if (top.length < 2) return;
    for (const id of top) if (!ctx.S.cards[id].visibleTo.includes(e.seat)) ctx.S.cards[id].visibleTo.push(e.seat);
    return AA4.ask(ctx, { seat: e.seat, kind: "order", options: top.slice().reverse(), reason: "Put them back on top of your deck: the first one you pick ends on top", then: [{ op: "reorderGo", seat: e.seat }] });
  };
  OPS.reorderGo = (ctx, op) => { const order = (op.answer || []).slice().reverse(); for (const id of order) AA4.moveCard(ctx, id, { z: "deck", pos: "top" }); };
  /** "あなたの任意のあなたの手札N枚を、あなたの任意の順番であなたのデッキの一番上に戻す" */
  A.handToDeckTop = (ctx, s, e) => {
    const hand = ctx.S.players[e.seat].zones.hand, n = Math.min(nOf(s, e), hand.length);
    if (!n) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: hand.slice(), min: n, max: n, auto: false, reason: `Put ${n} card${n === 1 ? "" : "s"} of your hand on top of your deck (the last one chosen ends on top)`, then: [{ op: "handTopGo" }] });
  };
  OPS.handTopGo = (ctx, op) => { for (const id of op.answer || []) if (ctx.S.cards[id].place.z === "hand") AA4.moveCard(ctx, id, { z: "deck", pos: "top" }); };
  /** "≪全てのプレイヤー≫は、ただちにドローフェイズの手順を行う": each player draws their Draw total. */
  A.drawStep = (ctx, s, e, r) => { for (const seat of seats(r).length ? seats(r) : AA4.living(ctx.S)) AA4.enqueue(ctx.S, [{ op: "draw", seat, n: AA4.playerStats(ctx.S, ctx.db, seat).draw }], true); };
  /** "目標の≪ダメージ置き場にあるカード1枚≫を、そのカードのオーナーのテリトリーの、あなたの任意のキャラクター1人にパワーカードとしてセットする" */
  A.cardToOwnerPower = (ctx, s, e, r) => {
    const S = ctx.S, x = r.find(y => y.card && S.cards[y.card]);
    if (!x) return;
    const opts = AA4.charsOf(S, S.cards[x.card].owner);
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, labels: opts.map(id => AA4.cardName(ctx.db.card(S.cards[AA4.topOf(S.chars[id])].key))), reason: "Choose the character: the card goes onto it as a power card", then: [{ op: "cardPowerGo", card: x.card }] });
  };
  OPS.cardPowerGo = (ctx, op) => { const ch = (op.answer || [])[0]; if (ch && ctx.S.chars[ch] && ctx.S.cards[op.card]) AA4.moveCard(ctx, op.card, { z: "char", ch, role: "power" }); };
  /** "≪あなたの手札の…キャラクターカード1枚≫を、あなたの支配キャラクターとしてセットする" / "目標の≪…パーマネントカード1枚≫を、あなたの任意のキャラクター1人に…セットする" */
  /** A3-16 2175 (Revise#221): a Break card from your hand (name containing s.nameHas) becomes your Controlled Character, then every Permanent card
      of s.permSel on your Controlled Characters moves onto it */
  A.handBreakToCtlPerms = (ctx, s, e) => {
    const S = ctx.S, opts = S.players[e.seat].zones.hand.filter(id => { const i = ctx.db.card(S.cards[id].key) || {}; return i.type === "Break" && String(i.name || "").includes(s.nameHas || ""); });
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 1, max: 1, auto: false, reason: "Choose the Break card: it is set as your Controlled Character, and the Permanent cards move onto it", then: [{ op: "handBreakToCtlGo", seat: e.seat, permSel: s.permSel || {} }] });
  };
  OPS.handBreakToCtlGo = (ctx, op) => {
    const S = ctx.S, id = (op.answer || [])[0]; if (!id || S.cards[id].place.z !== "hand") return;
    OPS.toBack(ctx, { answer: [id] });
    const nc = AA4.charOfCard(S, id); if (!nc) return;
    const k = op.permSel;
    for (const ch of AA4.controlledOf(S, op.seat)) if (ch !== nc.id) for (const pid of S.chars[ch].perm.slice()) { const i = ctx.db.card(S.cards[pid].key) || {}; if ((!k.faction || i.faction === k.faction) && (!k.nameHas || String(i.name || "").includes(k.nameHas))) AA4.moveCard(ctx, pid, { z: "char", ch: nc.id, role: "perm" }); }
  };
  A.handToBack = (ctx, s, e) => {
    const S = ctx.S, opts = S.players[e.seat].zones.hand.filter(id => AA4.cardMatches(ctx.db.card(S.cards[id].key) || {}, s.sel || {}));
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: opts, min: 1, max: 1, auto: false, reason: "Choose the card: it is set as a Controlled Character", then: [{ op: "toBack" }] });
  };
  A.permToChar = (ctx, s, e, r) => {
    const S = ctx.S, card = (r.find(x => x.card) || {}).card;
    if (!card) return;
    const opts = AA4.charsOf(S, e.seat).filter(id => !s.controlled || AA4.isControlled(S.chars[id]));
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: opts, labels: opts.map(id => AA4.cardName(ctx.db.card(S.cards[AA4.topOf(S.chars[id])].key))), reason: "Choose the character it is set on", then: [{ op: "permToCharGo", card, seat: e.seat }] });
  };
  /** a Permanent picked from your deck / Discard Pile → set on your Controlled Character you choose; the deck is shuffled when it came from there (Revise#129) */
  OPS.pickedPerm = (ctx, op) => {   // Pack (Revise#231): every chosen Permanent, one by one (only the first was set before)
    const S = ctx.S, cards = (op.answer || []).filter(id => S.cards[id]);
    if (!cards.length) return;
    const fromDeck = cards.some(id => S.cards[id].place.z === "deck");
    const ops = cards.map((card, i) => Object.assign({ op: "askPermChar", card, seat: op.seat, rest: cards.slice(i + 1) }, op.opts ? { opts: op.opts } : {}));   // opts: "そのキャラクターに…セット可能" (EX848, Revise#356)
    if (fromDeck) ops.push({ op: "shuffle", seat: op.seat });
    AA4.enqueue(S, ops, true);
  };
  OPS.askPermChar = (ctx, op) => {
    const S = ctx.S; if (!S.cards[op.card]) return;
    const opts = (op.opts || AA4.controlledOf(S, op.seat)).filter(id => S.chars[id]);
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: op.seat, kind: "pick", options: opts, labels: opts.map(id => AA4.cardName(ctx.db.card(S.cards[AA4.topOf(S.chars[id])].key))), reason: `Choose the character to set 「${AA4.cardName(ctx.db.card(S.cards[op.card].key))}」 on`, setCard: op.card, setRest: (op.rest || []).filter(id => S.cards[id]), then: [{ op: "permToCharGo", card: op.card, seat: op.seat }] });
  };
  OPS.permToCharGo = (ctx, op) => { const ch = (op.answer || [])[0]; if (ch && ctx.S.chars[ch] && ctx.S.cards[op.card]) { AA4.moveCard(ctx, op.card, { z: "char", ch, role: "perm" }); ctx.emit({ e: "entered", card: op.card, seat: op.seat, ch }); AA4.enqueue(ctx.S, [{ op: "permCheck" }]); } };
  A.gainChar = (ctx, s, e, r) => { for (const ch of chars(r)) if (e.ch && ctx.S.chars[e.ch] && ctx.S.chars[ch]) mod(ctx, e, { to: { ch: e.ch }, key: "inheritCard", op: "grant", value: AA4.topOf(ctx.S.chars[ch]), until: s.until || "turn" }); };   // "目標のスキル・エフェクト全てを得る"
  A.gainCard = (ctx, s, e, r) => { for (const x of r.filter(y => y.card)) if (e.ch && ctx.S.chars[e.ch]) mod(ctx, e, { to: { ch: e.ch }, key: "inheritCard", op: "grant", value: x.card, until: s.until || "turn" }); };
  OPS.permFromHandGo = (ctx, op) => {
    for (const id of op.answer || []) if (ctx.S.chars[op.ch]) { AA4.moveCard(ctx, id, { z: "char", ch: op.ch, role: "perm" }); ctx.emit({ e: "entered", card: id, seat: op.seat, ch: op.ch }); }
    AA4.enqueue(ctx.S, [{ op: "permCheck" }]);
  };
  /** "ブレイクしているキャラクターが捨て札された場合、≪そのキャラクターを構成しているブレイクカード全て≫を、そのオーナーの手札に戻す" */
  A.evAllToHand = (ctx, s, e) => { for (const id of e.evAll || []) if (ctx.S.cards[id] && ["discard", "damage"].includes(ctx.S.cards[id].place.z)) AA4.moveCard(ctx, id, { z: "hand" }); };   // "≪そのキャラクターを構成しているカード全て≫を、そのオーナーの手札に戻す"
  A.evBreakToHand = (ctx, s, e) => { for (const id of e.evCards || []) if (ctx.S.cards[id] && ["discard", "damage"].includes(ctx.S.cards[id].place.z)) AA4.moveCard(ctx, id, { z: "hand" }); };
  /** "≪あなたの任意のあなたの手札1枚≫をパワーカードとしてこのキャラクターにセット" */
  A.handToPower = (ctx, s, e) => {
    const hand = ctx.S.players[e.seat].zones.hand;
    if (!hand.length || !ctx.S.chars[e.ch]) return;
    return AA4.ask(ctx, { seat: e.seat, kind: "cards", options: hand.slice(), min: Math.min(s.n || 1, hand.length), max: Math.min(s.n || 1, hand.length), auto: false, reason: `${srcLabel(ctx, e)}: a hand card as a power card on this character`, then: [{ op: "handToPowerGo", ch: e.ch }] });
  };
  OPS.handToPowerGo = (ctx, op) => { for (const id of op.answer || []) if (ctx.S.chars[op.ch]) AA4.moveCard(ctx, id, { z: "char", ch: op.ch, role: "power" }); };
  /** "≪このキャラクター≫は任意の分類1つを得る" */
  A.iconPick = (ctx, s, e, r) => {
    const ch = chars(r)[0];
    if (!ch) return;
    const icons = [...new Set(ctx.db.all().flatMap(c => c.icons || []))].sort();
    return AA4.ask(ctx, { seat: e.seat, kind: "pick", options: icons, auto: false, reason: `${srcLabel(ctx, e)}: choose a class icon`, then: [{ op: "iconGo", ch, until: s.until || "turn", src: { card: e.card, seat: e.seat, ch: e.ch, label: srcLabel(ctx, e) } }] });
  };
  OPS.iconGo = (ctx, op) => AA4.addMod(ctx, { src: op.src, fromChar: true, to: { ch: op.ch }, key: "icon", op: "grant", value: (op.answer || [])[0], until: op.until });
  A.costTo = () => {};   // where this effect's cost goes is decided when it is paid (12-declare.js)
  A.manual = (ctx, s, e) => ctx.emit({ e: "manual", seat: e.seat, card: e.card || null, text: s.text || "" });

  /** Does card info match a card selector {name, faction, type, icon, skill}? (Search, pickZone) */
  AA4.cardMatches = (inf, sel) => {
    if (!sel) return true;
    if (sel.name && sel.orText && inf.name !== sel.name && !String(inf.jp || "").replace(/\s+/g, "").includes(sel.name) && !((inf.text || inf.jpText || "").includes(sel.name))) return false;   // or the card name has it (EX908, Revise#311)   // "指定したネームを持つか、カードテキストに指定したネームを含む" (A3-22 3271, Revise#177)
    if (sel.name && !sel.orText && inf.name !== sel.name) return false;
    if (sel.faction && inf.faction !== sel.faction) return false;
    if (sel.type && inf.type !== sel.type) return false;
    if (sel.icon && !(inf.icons || []).includes(sel.icon)) return false;
    if (sel.icons && !(inf.icons || []).some(i => sel.icons.includes(i))) return false;
    if (sel.skill && !(inf.skills || {})[sel.skill]) return false;
    if (sel.any) return sel.any.some(x => AA4.cardMatches(inf, x));
    if (sel.key && inf.key !== sel.key) return false;
    if (sel.jp && (inf.jp || "").replace(/\s+/g, "") !== String(sel.jp).replace(/\s+/g, "")) return false;   // a card name (Revise#157)
    return true;
  };

  /* ---------- always-on abilities → static modifiers ---------- */
  AA4.STATIC_SOURCES.push((S, db) => {
    const out = [];
    if (AA4.damageTextOff(S, db)) return out;
    for (const p of S.players) for (const id of p.zones.damage) {   // "このカードがあなたのダメージ置き場にある場合、…"
      const inf = db.card(S.cards[id].key);
      if (!inf || !inf.abilities) continue;
      inf.abilities.forEach((ab, i) => {
        if (ab.kind !== "always" || !ab.mod || ab.zone !== "damage") return;
        const m = ab.mod, to = m.to === "you" ? { seat: p.seat } : m.to === "opp" ? { players: "opponents" } : m.to;
        out.push({ id: `z-${id}-${i}`, src: { card: id, seat: p.seat, ch: null, label: AA4.cardName(inf), textJp: ab.text || null }, to, key: m.key, op: m.op || "add", value: m.value, until: "source", cond: ab.cond || null, static: true });
      });
    }
    for (const ch of Object.values(S.chars)) {
      const top = AA4.topOf(ch), lower = ch.stack.filter(id => id !== top);
      for (const id of [...new Set([top].concat(ch.perm, AA4.inheritedCards(S, db, ch), lower))]) {   // each card once: an inherited card is also one of the lower cards — its abilities were counted twice (Pack's report on A3-25 3809, Revise#389)
        if (S.cards[id].thread) continue;   // “糸”: only its own rule counts (Revise#135)
        const inf = db.card(S.cards[id].key);
        if (!inf || !inf.abilities) continue;
        const under = lower.includes(id) && !AA4.inheritedCards(S, db, ch).includes(id);
        inf.abilities.forEach((ab, i) => {
          if (ab.kind !== "always" || !ab.mod || ab.zone === "damage") return;
          if (under && !ab.anyLayer) return;   // a card below the top counts only for "≪このカードを構成するカードに含むキャラクター≫…"
          const m = ab.mod, to = m.to === "self" ? { ch: ch.id } : m.to === "you" ? { seat: ch.owner } : m.to === "opp" ? { players: "opponents" } : m.to;
          out.push({ id: `s-${id}-${i}`, src: { card: id, seat: ch.owner, ch: ch.id, label: AA4.cardName(inf), textJp: ab.text || null }, to, key: m.key, op: m.op || "add", value: m.value, until: "source", cond: ab.cond || null, static: true, xdef: m.xdef || null });
        });
      }
    }
    return out;
  });
})(typeof globalThis !== "undefined" ? globalThis : window);

(function (G) {   // 3721 (Revise#152): "その後、あなたのメインフェイズを終了する" — once everything waiting is done
  const AA4 = G.AA4;
  AA4.FLOW.push(ctx => {
    const S = ctx.S;
    if (!S.turn || !S.turn.endMainSoon) return false;
    if (S.turn.phase !== "main") { delete S.turn.endMainSoon; return false; }
    if (S.stack.length || S.draft || S.triggers.length || S.decisions.length || S.queue.length || S.battle) return false;
    delete S.turn.endMainSoon;
    if (S.turn.endTurnSoon) { delete S.turn.endTurnSoon; S.turn.rushEnd = true; }
    AA4.enqueue(S, [{ op: "endPhase" }]);
    return true;
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
