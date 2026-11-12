/* ==========================================================================
   v4 engine · selector language and targets   (requirements_v4 §5, §20.7; step B6)

   Selector (one filter for everything — targets, field-effect scopes, conditions, ban scopes):
     { owner: "you" | "opp" | "any",            relative to the player using the effect (ctx.seat)
       area: "field" | "party" (anywhere in an Active Area) | "active" (top of a faction party = Active Character)
             | "controlled" | "front" | "back",
       icons: [JP icon names] (any of them), faction: name | [names], name: personal name, named: bool,
       broken: bool, power: {op, n}, stat: [{key: "se"|"at"|"de", op, n}], aggressive: bool,
       inBattle: bool, self: bool, notSelf: bool, skill: id }
     ops: "=", "<=", ">=", "<", ">"
   Target spec (from ≪…≫, compiled at build time): { kind: "char" | "player" | "charOrPlayer" | "item",
     sel, count: n | "all", upTo: bool }
   Target ref (in intents): {ch} | {seat} | {item}.
   Protect ? (Revise#044): unaffected by Project cards of that faction → not a target of them.
   Untargetable modifiers ({key: "untargetable", value: {from?: type}}) likewise.
   ========================================================================== */
(function (G) {
  "use strict";
  const AA4 = G.AA4;
  const cmp = (a, op, n) => (a == null ? false : op === "<=" ? a <= n : op === ">=" ? a >= n : op === "<" ? a < n : op === ">" ? a > n : op === "!=" ? a !== n : a === n);

  AA4.matchChar = (S, db, sel, chId, ctx = {}) => {
    const ch = S.chars[chId];
    if (!ch || !sel) return !!ch && !!sel;
    if (sel.self && chId !== ctx.self && chId !== ctx.ch) return false;
    if (sel.ifCond && !AA4.checkCond(S, db, sel.ifCond, ctx)) return false;   // 2389 (Revise#179): "…が存在する場合、代わりに、目標の≪キャラクター1人≫"
    if (sel.anyOf && !sel.anyOf.some(q => AA4.matchChar(S, db, q, chId, ctx))) return false;   // "▼またはインターセプトを持つ" (Revise#164)
    if (sel.notSelf && (chId === ctx.self || chId === ctx.ch)) return false;
    if (sel.notSel && AA4.matchChar(S, db, sel.notSel, chId, ctx)) return false;   // "…キャラクター以外" (A4-01 0146, Revise#281)
    if (sel.owner === "you" && ch.owner !== ctx.seat) return false;
    if (sel.owner === "opp" && ch.owner === ctx.seat) return false;
    if (sel.ownerSeat != null && ch.owner !== sel.ownerSeat) return false;
    if (sel.baseStat) { const i0 = AA4.cardInfo(S, db, AA4.topOf(ch)) || {}; for (const q of sel.baseStat) { const v = +i0[q.key] || 0; if (!(q.op === ">=" ? v >= q.n : q.op === "<=" ? v <= q.n : v === q.n)) return false; } }   // "本来の精神力がN以上の" (EP438, Revise#347): the printed value of its top card
    if (sel.ownerDmgMin != null && !(S.players[ch.owner] && S.players[ch.owner].zones.damage.length >= sel.ownerDmgMin)) return false;   // "ダメージ置き場のカード枚数がN枚以上の、あなたの対戦相手全ての支配キャラクター" (EX0104, Revise#345)
    if (sel.ownerAttacked && !(S.battle && S.battle.target && S.battle.target.seat === ch.owner)) return false;   // "アタックを受けたプレイヤーのテリトリーの" (Revise#342)
    if (sel.powerLeSelf && !((ctx.self || ctx.ch) && S.chars[ctx.self || ctx.ch] && ch.power.length <= S.chars[ctx.self || ctx.ch].power.length)) return false;   // "このキャラクターのパワー以下のパワーの"
    if (sel.tokenOrJp) { const st = AA4.charStats(S, db, chId), top = db.card(S.cards[AA4.topOf(ch)].key) || {}; if (!String(st.tokenName || "").includes(sel.tokenOrJp) && !(top.jp || "").includes(sel.tokenOrJp)) return false; }   // "カード名称に「ゴーレム」を含む" — a token's name counts (EX0244)
    if (sel.works || sel.notName || sel.hasFaction) { const st = AA4.charStats(S, db, chId), top = db.card(S.cards[AA4.topOf(ch)].key) || {};   // Revise#157
      if (sel.works && !AA4.worksOf(top, sel.works)) return false;
      if (sel.notName && (st.name === sel.notName || (st.alsoNames || []).includes(sel.notName))) return false;
      if (sel.hasFaction && !st.faction) return false; }
    if (sel.chIs && chId !== sel.chIs) return false;   // a fixed character (Revise#157)
    if (sel.notIcons && AA4.charStats(S, db, chId).icons.some(i => sel.notIcons.includes(i))) return false;   // "イレイザー・イレイザー♂を持たない" (Revise#152)   // 3117: a fixed player's characters
    if (AA4.isInt(sel.seat) && ch.owner !== sel.seat) return false;
    const area = sel.area || "field";
    if (area === "controlled" && !AA4.isControlled(ch)) return false;
    if ((area === "front" || area === "back") && ch.at.area !== area) return false;
    if (area === "party" && ch.at.area !== "active") return false;
    if (area === "active" && !(ch.at.area === "active" && AA4.activeCharOf(S, ch.owner, ch.at.slot) === chId)) return false;
    if (sel.notOwnCtl && ch.owner === ctx.seat && AA4.isControlled(ch)) return false;
    if (sel.dupName) { const jp = (db.card(S.cards[AA4.topOf(ch)].key) || {}).jp; if (Object.values(S.chars).filter(o => (db.card(S.cards[AA4.topOf(o)].key) || {}).jp === jp).length < 2) return false; }   // "同じ名称のカードが場に2体以上存在する"   // "あなたの支配キャラクター以外の" (Revise#140)
    if (sel.jpHas && !String((db.card(S.cards[AA4.topOf(ch)].key) || {}).jp || "").includes(sel.jpHas)) return false;   // "カード名称に「女神」を含む" (Revise#140)
    const needStats = sel.atOnly || sel.atMentalBase != null || sel.stackMax != null || sel.shareIconSelf || sel.noSkill || sel.powerNeSelf || sel.icons || sel.faction || sel.notFactionCh || sel.name || sel.names || sel.capSign || sel.paidTop || sel.anyName || sel.nameHas || sel.named != null || sel.broken != null || sel.stat || sel.aggressive != null || sel.skill || sel.atMental != null;
    if (needStats) {
      const st = AA4.charStats(S, db, chId);
      if (sel.icons && !(sel.icons === "@effIcon" ? [S.effIcon] : sel.icons).some(i => st.icons.includes(i))) return false;   // "@effIcon": "指定した分類を持つ" (Revise#287)
      if (sel.atMentalBase != null && !!((db.card(S.cards[AA4.topOf(ch)].key) || {}).atMental) !== sel.atMentalBase) return false;   // "本来精神攻撃力を持つ": the printed card (A4-03 0448, Revise#287)
      if (sel.faction && ![].concat(sel.faction).includes(st.faction)) return false;
      if (sel.notFactionCh && st.faction === sel.notFactionCh) return false;   // "WIZ-DOMのファクターを持たないキャラクター" (0679, Revise#358)
      if (sel.name && st.name !== sel.name && !st.alsoNames.includes(sel.name)) return false;
      if (sel.capSign && !((+st.skills.capacity || 0) * sel.capSign > 0)) return false;   // "キャパシティ+Xを持つ / キャパシティ-Xを持つ" (EX0149, Revise#201)
      if (sel.paidTop) { const top = S.stack[S.stack.length - 1]; if (!(top && top.kind === "set" && top.card && sel.paidTop.includes((AA4.cardInfo(S, db, top.card) || {}).type) && (top.payChs || []).includes(chId))) return false; }   // EX0489 (Revise#209)
      if (sel.names && !sel.names.some(n => st.name === n || st.alsoNames.includes(n))) return false;   // "“A”、“B”、“C”全て" (Revise#201)
      if (sel.anyName && !sel.anyName.some(n => st.name === n || st.alsoNames.includes(n))) return false;
      if (sel.nameHas && !String(st.name || "").includes(sel.nameHas)) return false;   // "ネームに「カストル」を含む"   // "“なつき”または“ふぶき”のネームを持つ" (Revise#132)
      if (sel.named != null && st.named !== sel.named) return false;
      if (sel.broken != null && st.broken !== sel.broken) return false;
      if (sel.aggressive != null && !!st.skills.aggressive !== sel.aggressive) return false;
      if (sel.skill && !st.skills[sel.skill]) return false;
      if (sel.noSkill && st.skills[sel.noSkill]) return false;
      if (sel.stackMax != null && ch.stack.length > sel.stackMax) return false;   // "…を構成するカードの枚数が2枚以下の場合"
      if (sel.shareIconSelf && !(ctx.self && S.chars[ctx.self] && AA4.charStats(S, db, ctx.self).icons.some(i => st.icons.includes(i)))) return false;   // "このキャラクターと同じ分類を持つキャラクター" (Revise#148)   // "イニシアチブを持つキャラクター以外" (Revise#144)
      if (sel.powerNeSelf && ctx.self && S.chars[ctx.self] && ch.power.length === S.chars[ctx.self].power.length) return false;   // "パワーがこのキャラクターのパワーと等しいキャラクター以外"
      if (sel.atMental != null && !!st.atMental !== sel.atMental) return false;
      if (sel.atOnly && !(sel.atOnly === "mental" ? (st.atM || 0) > 0 && !(st.atN || 0) : (st.atN || 0) > 0 && !(st.atM || 0))) return false;   // "精神攻撃力のみを持つ" / "通常攻撃力のみを持つ": its Attack now (Revise#296)   // "精神攻撃力(のみ)を持つ" / "通常攻撃力のみを持つ"
      for (const s of sel.stat || []) if (!cmp(st[s.key], s.op, s.n === "X" ? +ctx.x || 0 : s.n && typeof s.n === "object" && s.n.x ? AA4.xOf(S, db, s.n.x, { seat: ctx.seat, ch: ctx.self }) : s.n)) return false;   // n {x}: "攻撃力の数値がX以下の" (Revise#141)
    }
    const X = n => (n === "X" ? +ctx.x || 0 : n);
    if (sel.power && !cmp(ch.power.length, sel.power.op, X(sel.power.n))) return false;
    if (sel.attackingYou && !(S.battle && S.battle.attacker === chId && S.battle.target && S.battle.target.seat === ctx.seat)) return false;
    if (sel.hasEffect && !AA4.effectsOf(S, db, chId, AA4.topOf(ch)).length) return false;
    if (sel.tag && !(AA4.cardInfo(S, db, AA4.topOf(ch)).tags || []).includes(sel.tag) && !S.modifiers.some(m => m.key === "token" && m.to && m.to.ch === chId && m.value && (m.value.tags || []).includes(sel.tag))) return false;   // a token with that tag (EX850, Revise#356)   // "武蔵を持つ"
    if (sel.iconOther && !AA4.charStats(S, db, chId).icons.some(i => i !== sel.iconOther)) return false;   // "イレイザー以外の分類を持つ" (Revise#318)
    if (sel.stackNamedMin && ch.stack.filter(id => !!(db.card(S.cards[id].key) || {}).name).length < sel.stackNamedMin) return false;   // "構成するカードにネームを持つカードがN枚以上含まれている" (Revise#340)
    if (sel.notYourCtl && ch.owner === ctx.seat && AA4.isControlled(ch)) return false;   // "あなたの支配キャラクター以外の" (Revise#318)
    if (sel.notTag && (AA4.cardInfo(S, db, AA4.topOf(ch)).tags || []).includes(sel.notTag)) return false;   // "英国を持たない" (Revise#318)
    if (sel.factorGe != null && Object.values(AA4.cardInfo(S, db, AA4.topOf(ch)).factor || {}).reduce((a, b) => a + (+b || 0), 0) < sel.factorGe) return false;   // "必要ファクター5以上の…" (A4-EP EP505, Revise#310)
    if (sel.male && !AA4.charStats(S, db, chId).icons.some(i => /♂$/.test(i))) return false;   // "♂の分類を持つ"
    if (sel.chosenName) { const cid = ctx.srcCard || (ctx.self && S.chars[ctx.self] ? AA4.topOf(S.chars[ctx.self]) : null), nm = cid && S.cards[cid] && S.cards[cid].chosenName; if (!nm || AA4.charStats(S, db, chId).name !== nm) return false; }   // 3758 (Revise#152): "指定したネームと♂の分類を持つ"
    if (sel.hasPower && !ch.power.length) return false;
    if (sel.tokenName && AA4.charStats(S, db, chId).tokenName !== sel.tokenName) return false;   // "アストラル" …
    if (sel.notMineAggressiveCtl && ch.owner === ctx.seat && AA4.isControlled(ch) && AA4.charStats(S, db, chId).skills.aggressive) return false;   // "▼を持つあなたの支配キャラクター以外の"
    if (sel.skillOrEffect) { const st = AA4.charStats(S, db, chId); if (!Object.keys(st.skills).length && !AA4.effectsOf(S, db, chId, AA4.topOf(ch)).length) return false; }   // "スキルまたはエフェクトを持つ"
    if (sel.nameInDiscard) { const jp = (db.card(S.cards[AA4.topOf(ch)].key) || {}).jp; if (!S.players.some(p => p.zones.discard.some(id => (db.card(S.cards[id].key) || {}).jp === jp))) return false; }   // A3-20 2837 (Revise#165)
    if (sel.nameInDamage) { const jp = (db.card(S.cards[AA4.topOf(ch)].key) || {}).jp; if (!S.players.some(p => p.zones.damage.some(id => (db.card(S.cards[id].key) || {}).jp === jp))) return false; }   // "ダメージ置き場に置かれているカードと同じ名称の"
    if (sel.noSharedIcon && ctx.self && S.chars[ctx.self]) { const mine = AA4.charStats(S, db, ctx.self).icons; if (AA4.charStats(S, db, chId).icons.some(i => mine.includes(i))) return false; }   // "同じ分類を一種類以上持つキャラクター以外"
    if (sel.notBattleOppOfSelf && ctx.self && AA4.battleOppsOf(S, ctx.self).includes(chId)) return false;   // "このキャラクターのバトル相手以外の"
    if (sel.ownerAttacked && !(S.battle && S.battle.defender === ch.owner)) return false;   // "アタックを受けたプレイヤーの…"
    if (sel.hasPermJpHas && !ch.perm.some(id => String((db.card(S.cards[id].key) || {}).jp || "").replace(/\s+/g, "").includes(sel.hasPermJpHas))) return false;   // "“悲嘆の怠惰”がセットされている" (EX0756, Revise#363)
    if (sel.onlyCh && chId !== sel.onlyCh) return false;
    if (sel.notSel && AA4.matchChar(S, db, sel.notSel, chId, ctx)) return false;   // "英国を持つネームレベルキャラクター以外の" (EX880, Revise#358)   // one given character (0573 / EX0684 / EX0752, Revise#357)
    if (sel.powerEqMental && ch.power.length !== AA4.charStats(S, db, chId).se) return false;   // "パワーが精神力に等しい"
    if (sel.sameSide) {   // "このキャラクターと同時にアタック宣言またはガード宣言している…"
      const b = S.battle, me = ctx.self;
      if (!b || !me || chId === me) return false;
      const att = [b.attacker].concat(b.joined.att), grd = [b.guard].concat(b.joined.grd).filter(Boolean);
      if (!((att.includes(me) && att.includes(chId)) || (grd.includes(me) && grd.includes(chId)))) return false;
    }
    if (sel.hasPerm != null && !!ch.perm.length !== sel.hasPerm) return false;
    if (sel.ownerMoreCtl && !(AA4.controlledOf(S, ch.owner).length > AA4.controlledOf(S, ctx.seat).length)) return false;   // "支配キャラクターの総数が、あなたよりも多いプレイヤーの支配キャラクター" (A4-05 0814)
    if (sel.printedSkill && !((AA4.cardInfo(S, db, AA4.topOf(ch)).skills || {})[sel.printedSkill])) return false;   // "ドロー+1と武蔵を持つ": the skill printed on its top card, so the bonus does not feed itself (A4-EX02 EX810)
    if (sel.srcJpMin) { const n = new Set(S.modifiers.filter(m => m.to && m.to.ch === chId && m.src && m.src.card && S.cards[m.src.card] && (db.card(S.cards[m.src.card].key) || {}).jp === sel.srcJpMin.jp).map(m => m.src.card)).size; if (n < sel.srcJpMin.n) return false; }   // "「X」がN枚以上効果を発揮しているキャラクター" (A3-EX02 EX0166)
    if (sel.permSameJpAsSrc) { const sc = ctx.card && S.cards[ctx.card], jp = sc ? (db.card(sc.key) || {}).jp : null; if (!jp || !ch.perm.some(id => (db.card(S.cards[id].key) || {}).jp === jp)) return false; }   // "このカードと同じ名称のカードがセットされている" (A3-24 3396)   // "パーマネントカードをセットされていない"
    if (sel.oppOfSelf && !AA4.battleOppsOf(S, ctx.self || ctx.ch).includes(chId)) return false;   // "このキャラクターにガード宣言されている…"
    if (sel.sameAreaSelf) { const me = S.chars[ctx.self || ctx.ch]; const z = c => (c.at.area === "active" ? "active" : AA4.isControlled(c) ? "control" : c.at.area); if (!me || me.owner !== ch.owner || z(me) !== z(ch)) return false; }
    if (sel.hasSkill && !Object.keys(AA4.charStats(S, db, chId).skills).some(k => k !== "aggressive")) return false;   // "スキルを持つ"
    if (sel.iconCount) { const k = AA4.charStats(S, db, chId).icons.length; if (sel.iconCount.op === "=" ? k !== sel.iconCount.n : sel.iconCount.op === ">=" ? k < sel.iconCount.n : k > sel.iconCount.n) return false; }   // "分類を1種類だけ持つ" / "2種類以上の分類を持つ" (A3-09 1421, Revise#172)
    if (sel.hasAbility && !(S.chars[chId].stack.concat(S.chars[chId].perm).some(id => S.cards[id] && ((db.card(S.cards[id].key) || {}).abilities || []).length))) return false;   // "アビリティを持つ" (A3-25 3732, Revise#170)
    if (sel.ownerCtl && !cmp(AA4.controlledOf(S, ch.owner).length, sel.ownerCtl.op, sel.ownerCtl.n)) return false;   // "支配キャラクターがN体以下の"
    if (sel.attacking && !(S.battle && S.battle.attacker === chId)) return false;
    if (sel.attackingDmgMin && !(S.battle && S.battle.attacker === chId && S.battle.target && S.battle.target.seat != null && S.players[S.battle.target.seat] && S.players[S.battle.target.seat].zones.damage.length >= sel.attackingDmgMin)) return false;   // "ダメージ置き場のカード枚数がN枚以上のプレイヤーを目標にアタック宣言している" (Revise#341)
    if (sel.noPerm && S.chars[chId].perm.length) return false;   // "パーマネントカードがセットされていないキャラクター" (A3-24 3435, Revise#258)
    if (sel.attackerTeam && !(S.battle && S.battle.kind === "attack" && S.chars[S.battle.attacker] && S.battle.attacker !== chId && S.chars[S.battle.attacker].owner === S.chars[chId].owner)) return false;   // "アタック宣言しているキャラクターのオーナーの支配キャラクター" (A3-22 3129, Revise#258)
    if (sel.guarding && !(S.battle && S.battle.guard === chId)) return false;
    if (sel.inBattle != null) {
      const b = S.battle, inb = !!b && [b.attacker, b.guard, b.target && b.target.ch].concat(b.joined.att, b.joined.grd).includes(chId);
      if (inb !== sel.inBattle) return false;
    }
    return true;
  };
  AA4.matchSeat = (S, sel, seat, ctx = {}, db) => {
    const p = S.players[seat];
    if (!p || p.lost) return false;
    if (!sel) return true;
    if (sel.owner === "you" && seat !== ctx.seat) return false;
    if (sel.owner === "opp" && seat === ctx.seat) return false;
    if (sel.namedCtlMin && db && AA4.controlledOf(S, seat).filter(id => !!AA4.charStats(S, db, id).named).length < sel.namedCtlMin) return false;   // "ネームを持つキャラクターを2体以上支配しているプレイヤー" (A3-20 2802)
    if (sel.overLimit && db && !(p.zones.hand.length > AA4.playerStats(S, db, seat).handLimit)) return false;   // "手札上限を越える手札を持つプレイヤー" (A3-02 0344, Revise#175)
    return true;
  };

  /** Can the effect / card in ctx target this character? (Protect, untargetable) */
  function targetable(S, db, chId, ctx) {
    const st = AA4.charStats(S, db, chId), src = ctx.card && S.cards[ctx.card] ? db.card(S.cards[ctx.card].key) || {} : {};
    if (src.type === "Project" && st.skills.protect && (st.skills.protect.factions || []).includes(src.faction) && S.chars[chId].owner !== ctx.seat) return false;
    const kind = ctx.effect ? "Effect" : src.type;   // an effect line, or the type of the card
    const by = ctx.ch && S.chars[ctx.ch] ? ctx.ch : null;
    if (st.untargetable.some(u => (!u.from || [].concat(u.from).includes(kind)) && (!u.faction || [].concat(u.faction).includes(src.faction))
      && (!u.bySel || (by && AA4.matchChar(S, db, u.bySel, by, { seat: ctx.seat })))
      && (!u.byOpp || ctx.seat !== S.chars[chId].owner) && (!u.byOwn || ctx.seat === S.chars[chId].owner) && (!u.areaOnly || ctx.area)
      && (!u.costMaxPower || (ctx.effect ? +ctx.x || 0 : typeof src.cost === "number" ? src.cost : +ctx.x || 0) <= S.chars[chId].power.length)
      && (!u.costMaxSrcPower || (u.srcCh && S.chars[u.srcCh] && (ctx.effect ? +ctx.x || 0 : typeof src.cost === "number" ? src.cost : +ctx.x || 0) <= S.chars[u.srcCh].power.length))   // 不動明王 (Revise#142): "≪あなたの支配キャラクター全て≫は、このキャラクターのパワー以下のコストの…"
      && (!u.notSelfEffect || !(ctx.effect && by === chId))
      && (!u.exceptCardId || ctx.card !== u.exceptCardId)   // "このカード以外のファストカード…の効果を受けない" (Revise#166)
      && (!u.exceptName || !(by && AA4.charStats(S, db, by).name === u.exceptName)))) return false;   // "“芦屋 道満”以外のエフェクトの効果を受けない" (Revise#143)   // "このキャラクター以外のエフェクトの効果を受けない" (Revise#142)   // "…このキャラクターのパワー以下のコストの…の効果を受けない" (Revise#109)   // "…Fのファストカード / …キャラクターのエフェクトの効果を受けない"
    return true;
  }
  AA4.targetable = targetable;
  /** An effect / card text that deals damage (read from the card data, Q#39) */
  AA4.dealsDamage = body => !!body && /"a":"(damage|areaDamage|pickCharDamage|damageKillHit|pickAnyDamage|areaSweep|oppCharOwnerDamage|guardHit)"/.test(JSON.stringify(body.steps || []));
  /** Number of targets a spec asks for ("X" = the X paid). */
  AA4.specCount = (spec, ctx = {}) => (spec.count === "all" ? 0 : spec.count === "X" ? +ctx.x || 0 : spec.count || 1);

  /** Every ref that may be chosen for a spec now. */
  AA4.targetCandidates = (S, db, spec, ctx = {}) => {
    const out = [];
    const sel = spec.sel || {};
    if (spec.kind === "char" || spec.kind === "charOrPlayer")
      for (const chId of Object.keys(S.chars)) if (AA4.matchChar(S, db, sel, chId, ctx) && (spec.designate || targetable(S, db, chId, ctx))) out.push({ ch: chId });   // designated (not targeted): Protect etc. don't apply
    if (spec.kind === "player" || spec.kind === "charOrPlayer")
      for (const p of S.players) if (AA4.matchSeat(S, spec.psel || sel, p.seat, ctx, db)) out.push({ seat: p.seat });
    if (spec.kind === "item") for (const it of S.stack) {
      if (sel.kind && sel.kind !== it.kind) continue;
      if (sel.own && it.seat !== ctx.seat) continue;
      if (sel.notOwn && it.seat === ctx.seat) continue;   // EP287: "あなたにダメージを与える" — an opponent's   // EP262: "あなたが使用した…"
      if (sel.notSelf && ctx.card && it.card === ctx.card && it.kind === "effect") continue;
      const inf = it.card ? db.card(S.cards[it.card].key) || {} : {};
      if (sel.types && !(sel.types.includes(inf.type) || (sel.effects && it.kind === "effect"))) continue;
      if (sel.oneTarget && (it.targets || []).length !== 1) continue;
      if (sel.paidBySel && !(it.payChs || []).some(id => S.chars[id] && AA4.matchChar(S, db, sel.paidBySel, id, { seat: ctx.seat }))) continue;   // 3659 (Revise#209)
      if (sel.byOppDmgMin != null && !(it.seat !== ctx.seat && S.players[it.seat] && S.players[it.seat].zones.damage.length >= sel.byOppDmgMin)) continue;   // EX0185 (Revise#217)
      if (sel.costMin != null && !((typeof inf.cost === "number" ? inf.cost : +it.x || 0) >= sel.costMin)) continue;   // "キャラクター1人が目標の…" (EX0338, Revise#203)
      if (sel.aimsSelfCh && !(ctx.self && ((it.targets || []).some(t => t.ch === ctx.self) || (it.kind === "set" && inf.play && (!inf.play.target || inf.play.target.count === "all") && /"all":/.test(JSON.stringify(inf.play.steps || [])))))) continue;   // "このキャラクターを効果範囲に含む…カード" (EX828, Revise#365): it targets this character, or it works on a whole group
      if (sel.aimsMine && !(it.targets || []).some(t => t.seat === ctx.seat || (t.ch && S.chars[t.ch] && S.chars[t.ch].owner === ctx.seat) || (t.card && S.cards[t.card] && S.cards[t.card].owner === ctx.seat))) continue;   // "あなたか、あなたがオーナーのカードを対象に含む" (EX0185)
      if (sel.area && !(it.kind === "set" && !(inf.play && inf.play.target && inf.play.target.count !== "all"))) continue;   // "範囲のプロジェクトカードまたはファストカード" (EX0623, Revise#201)
      if (sel.byChoice) { const ef = it.kind === "effect" ? ((it.ch && S.chars[it.ch] ? AA4.effectsOf(S, db, it.ch, it.card) : inf.effects || [])[it.i] || {}) : null, sp = ef ? ef.target : (inf.play || {}).target;
        if (!((sp && sp.byChoice) || /任意/.test(ef ? ef.text || "" : inf.text || ""))) continue; }   // A3-15 2105 (Pack, Revise#248): a card with a "あなたの任意の…" choice   // A3-15 2105 (Pack, Revise#248): "任意の対象を指定する…"
      if (sel.aims && !sel.byChoice && !(it.targets || []).some(t => (sel.aims === "any" ? true : sel.aims === "char" ? t.ch : t.seat != null))) continue;
      if (sel.pileActs && !(AA4.PILE_RE && AA4.PILE_RE.test(JSON.stringify(it.kind === "effect" ? (AA4.effectsOf(S, db, it.ch, it.card) || [])[it.i] || {} : inf.play || {})))) continue;   // 3264: "ダメージ置き場または捨て札置き場、またはそれらにあるカードを対象とする…"
      if (sel.dealsDamage && !AA4.dealsDamage(it.kind === "effect" ? (AA4.effectsOf(S, db, it.ch, it.card) || [])[it.i] : inf.play)) continue;   // "バトル以外のダメージを与える効果を持つ…" (Q#39)
      out.push({ item: it.id });
    }
    if (spec.kind === "multi") return spec.parts.flatMap(p => AA4.targetCandidates(S, db, p, ctx));
    if (spec.kind === "card") for (const id of AA4.fieldCards(S, db, sel, ctx)) out.push({ card: id });
    if (spec.kind === "card" && sel.pileTargeted) for (const p of AA4.living(S)) for (const id of S.players[p].zones.damage) { const i = db.card(S.cards[id].key) || {}; if (["Project", "Fast"].includes(i.type) && i.play && i.play.target && i.play.target.kind === "char" && (i.play.target.count || 1) === 1 && i.play.status !== "manual") out.push({ card: id }); }   // 0373 (Revise#152)
    if (spec.kind === "card" && sel.alsoZones) for (const p of AA4.living(S)) for (const z of sel.alsoZones) for (const id of S.players[p].zones[z]) if (!sel.types || sel.types.includes((db.card(S.cards[id].key) || {}).type)) out.push({ card: id });   // 3192 (Revise#152): "このエフェクトはダメージ置き場のパーマネントカードを目標に使用宣言可能"
    return out;
  };
  /** Cards on the field a card selector matches: {types: [Fast|Project|Permanent|Break], owner}. Fast / Project = in use
      (Special Area); Permanent = on a character; Break = in a character's stack. */
  AA4.fieldCards = (S, db, sel, ctx = {}) => Object.values(S.cards).filter(c => {
    if (sel.power) {   // "≪パワーカード1枚≫": a power card on any character (owner of the card = owner of the character)
      if (!(c.place.z === "char" && c.place.role === "power")) return false;
      const ch = S.chars[c.place.ch];
      return !!ch && (sel.owner !== "you" || ch.owner === ctx.seat) && (sel.owner !== "opp" || ch.owner !== ctx.seat);
    }
    if (sel.setAny && c.place.z === "char" && c.place.role === "power") return !!S.chars[c.place.ch];   // "キャラクター1人にセットされているカード1枚" (0220, Revise#355): a power card or a Permanent card
    const inf = db.card(c.key) || {};
    if (sel.types && !sel.types.includes(inf.type)) return false;
    if (inf.type === "Permanent" && c.place.z === "char" && ctx.seat != null && ctx.seat !== c.owner && AA4.allMods(S, db).some(m => m.key === "permImmuneOpp" && AA4.modAppliesToSeat(S, m, c.owner))) return false;   // A3-25 3655 (Revise#176)
    if (inf.selfImmune && inf.selfImmune.oppOnly && c.place.z === "char" && ctx.seat != null && ctx.seat !== c.owner) return false;   // "≪このカード≫は対戦相手のカードの効果を受けない" (Revise#173)
    if (inf.selfImmune === true && c.place.z === "char" && ctx.card !== c.id && (ctx.effect || (ctx.card && S.cards[ctx.card] && ["Project", "Fast"].includes((db.card(S.cards[ctx.card].key) || {}).type)))) return false;   // "≪このカード≫は、プロジェクトカード・ファストカード・エフェクトの効果を受けない" (A3-14 2027, Revise#173)
    if (c.place.z === "char" && c.place.role === "perm" && S.chars[c.place.ch] && !ctx.effect && ctx.card && S.cards[ctx.card] && ["Project", "Fast"].includes((db.card(S.cards[ctx.card].key) || {}).type) && AA4.charStats(S, db, c.place.ch).permShield) return false;   // EX0039 (Revise#157)
    if (sel.owner === "you" && c.owner !== ctx.seat) return false;
    if (sel.owner === "opp" && c.owner === ctx.seat) return false;
    if (sel.icons && !(inf.icons || []).some(i => sel.icons.includes(i))) return false;   // Revise#133: card targets in piles
    if (sel.noBreakRule && inf.breakRule) return false;
    if (sel.costX && inf.cost !== (+ctx.x || 0)) return false;   // 2199: "コストXの…ブレイクカード"
    if (sel.named != null && !!inf.name !== sel.named) return false;
    if (sel.factorMet && AA4.factorOk(S, db, ctx.seat, inf)) return false;
    if (sel.factorGe != null && Object.values(inf.factor || {}).reduce((a, b) => a + (+b || 0), 0) < sel.factorGe) return false;   // "必要ファクター5以上の" (A4-EP EP505, Revise#310)   // "必要ファクターが満たされている"
    if (sel.zones) return sel.zones.includes(c.place.z) && c.id !== ctx.card;   // "目標の≪あなたの手札またはあなたの捨て札置き場のパーマネントカード1枚≫" (Revise#109)
    if (sel.projIfCond && inf.type === "Project" && !AA4.checkCond(S, db, sel.projIfCond, { seat: ctx.seat })) return false;
    if (sel.fastIfCond && inf.type === "Fast" && !AA4.checkCond(S, db, sel.fastIfCond, { seat: ctx.seat })) return false;   // "…場合、代わりに、目標の≪プロジェクトカード1枚またはファストカード1枚≫を…" (2031, Revise#366)   // "あなたがWWWWを満たしている場合、プロジェクトカード1枚を目標とすることが可能" (PP183, Revise#357)
    if (sel.setAny) return c.place.z === "char" && c.place.role === "perm";
    if (inf.type === "Fast" || inf.type === "Project") return c.place.z === "special" && c.id !== ctx.card;
    if (inf.type === "Permanent") return c.place.z === "char" && c.place.role === "perm";
    if (inf.type === "Break") return c.place.z === "char" && c.place.role === "stack";
    return false;
  }).map(c => c.id).sort();

  /** Are these the right targets for a spec? → null or the reason. */
  AA4.checkTargets = (S, db, spec, targets, ctx = {}) => {
    if (!Array.isArray(targets)) return "Choose a target";
    if (spec.kind === "multi") {   // several chosen targets, in the order of the card text (Revise#081)
      let k = 0;
      for (const part of spec.parts) {
        const n = AA4.specCount(part, ctx), slice = targets.slice(k, k + n);
        const why = AA4.checkTargets(S, db, part, slice, ctx);
        if (why) return why;
        k += n;
      }
      return k === targets.length ? null : "Too many targets";
    }
    const n = AA4.specCount(spec, ctx);
    if (spec.upTo ? targets.length > n : targets.length !== n) return spec.upTo ? `Choose up to ${n}` : `Choose ${n}`;
    const cand = AA4.targetCandidates(S, db, spec, ctx).map(x => JSON.stringify(x));
    const seen = new Set();
    for (const t of targets) {
      const k = JSON.stringify(t);
      if (!cand.includes(k)) return "Not a valid target";
      if (seen.has(k)) return "The same target twice";
      seen.add(k);
    }
    return null;
  };

  /** Conditions (abilities / modifiers with "…場合"). cond = {all: [...]} | {any: [...]} | one of:
      {self: "controlled"|"active"|"broken"|"inBattle"}, {myTurn: true}, {phase}, {count: {sel, op, n}},
      {damage: {op, n}} (your Damage Pile), {hand: {op, n}} */
  AA4.checkCond = (S, db, cond, ctx = {}) => {
    if (!cond) return true;
    if (cond.seBelowX) { const q = cond.seBelowX; return !!S.chars[q.ch] && (+AA4.charStats(S, db, q.ch).se || 0) < AA4.xOf(S, db, q.x, { seat: q.seat }); }   // A3-25 3691 (Revise#395)
    if (cond.all) return cond.all.every(c => AA4.checkCond(S, db, c, ctx));
    if (cond.any) return cond.any.some(c => AA4.checkCond(S, db, c, ctx));
    const self = ctx.ch || (ctx.src && ctx.src.ch);
    const seat = ctx.src && ctx.src.seat != null ? ctx.src.seat : ctx.seat;
    if (cond.selfPowerIs != null) return !!(self && S.chars[self] && S.chars[self].power.length === cond.selfPowerIs);   // "このキャラクターのパワーが0の状態で" (Revise#137)
    if (cond.oppEffectActive) { const ow = self && S.chars[self] ? S.chars[self].owner : seat; return S.modifiers.some(m => m.src && m.src.seat != null && m.src.seat !== ow); }   // EXPR037 (Revise#161, Pack Q-F1): any opponent's Project / Fast / effect result is active
    if (cond.selfHasCardName) { const ch = S.chars[self]; return !!ch && ch.perm.concat(ch.stack).some(id => String((db.card(S.cards[id].key) || {}).name || "").replace(/\s+/g, "") === cond.selfHasCardName); }   // "このキャラクターに“「武蔵」”がセットされている場合" (EX0694, Revise#339)
    if (cond.selfHasJp) { const ch = S.chars[self]; return !!ch && ch.stack.concat(ch.perm, ch.power).some(id => String((db.card(S.cards[id].key) || {}).jp || "").replace(/\s+/g, "") === cond.selfHasJp); }   // EP466 (Revise#229): "このキャラクターに「ラグナロク ペコペコ」がセットされている場合"
    if (cond.battleOppSeLePower) { const os = self ? AA4.battleOppsOf(S, self).filter(id => S.chars[id]) : [], pw = self && S.chars[self] ? S.chars[self].power.length : 0; return os.length > 0 && os.every(o => (AA4.charStats(S, db, o).se || 0) <= pw); }   // EP436 (Revise#228): "≪精神力X以下のバトル相手≫を捨て札する。Xはこのキャラクターのパワー"
    if (cond.oppSumHigher) { const os = self ? AA4.battleOppsOf(S, self).filter(id => S.chars[id]) : []; if (!os.length) return false; const st = AA4.charStats(S, db, self), mine = (st.at || 0) + (st.de || 0); return os.some(o => { const t = AA4.charStats(S, db, o); return (t.at || 0) + (t.de || 0) > mine; }); }   // EX0518
    if (cond.notPaidTurn) return !!self && !(S.turn.paidChars || {})[self];   // EX0504: "このターン中、このキャラクターからコストが支払われていない場合"
    if (cond.stackWorks) { const ch = S.chars[self]; return !!ch && ch.stack.some(id => AA4.worksOf(db.card(S.cards[id].key) || {}, cond.stackWorks)); }   // EX0408
    if (cond.sameNameOther) { const ch = S.chars[self]; if (!ch) return false; const top = db.card(S.cards[AA4.topOf(ch)].key) || {}; return ch.stack.some(id => id !== AA4.topOf(ch) && (db.card(S.cards[id].key) || {}).name === top.name && (db.card(S.cards[id].key) || {}).jp !== top.jp); }   // PR334
    if (cond.dmgCheckedTurn) { const ow = self && S.chars[self] ? S.chars[self].owner : seat; return !!(S.turn && S.turn.dmgChecked && S.turn.dmgChecked[ow]); }   // EP362: "このターン中に、あなたがダメージ判定を行っている場合"
    if (cond.iconKinds) return new Set(AA4.charsOf(S, seat).flatMap(id => S.chars[id].stack.flatMap(c => (db.card(S.cards[c].key) || {}).icons || []))).size >= cond.iconKinds;   // "あなたのテリトリーのキャラクターの持つ分類の総数がN種類以上" (Revise#273)
    if (cond.tAttackPlayer) { const b = S.battle; return !!(b && ctx.target && b.attacker === ctx.target && b.target && b.target.seat != null && !b.guard); }   // the character the modifier is on attacks a player (EX0168, Revise#264)
    if (cond.attackPlayer) { const b = S.battle; return !!(b && self && b.attacker === self && b.target && b.target.seat != null && !b.guard); }   // "このキャラクターがプレイヤーにアタックした場合" (Revise#157)
    if (cond.deLeBattleOpp) { const os = self ? AA4.battleOppsOf(S, self).filter(id => S.chars[id]) : []; if (!os.length) return false; const me = AA4.charStats(S, db, self).de || 0; return os.some(o => me <= (AA4.charStats(S, db, o).de || 0)); }   // EP181: "このキャラクターの耐久力がバトル相手の耐久力以下の場合"
    if (cond.permCountMin) { return !!S.chars[self] && S.chars[self].perm.length >= cond.permCountMin; }   // EP187
    if (cond.battleOrAttackPlayer) { const b = S.battle; return !!(b && self && ((b.attacker === self && b.target && b.target.seat != null) || AA4.battleOppsOf(S, self).length)); }
    if (cond.projDecl) { const c = S.cards[ctx.card || (ctx.src && ctx.src.card)]; return !!(c && c.projDecl); }   // "このカードをあなたのターンのプロジェクトカードのタイミングで使用宣言した場合" (Revise#129)
    if (cond.self) {
      const ch = S.chars[self];
      if (!ch) return false;
      if (cond.self === "controlled") return AA4.isControlled(ch);
      if (cond.self === "active") return ch.at.area === "active";
      if (cond.self === "broken") return AA4.charStats(S, db, self).broken;
      if (cond.self === "inBattle") return AA4.battleOppsOf(S, self).length > 0;   // "このキャラクターがバトルする際": only a real battle — an attacker and a guard (or an attacked character), not an unguarded attack on a player (Pack, Revise#112)
      const b = S.battle;
      if (cond.self === "attacking") return !!b && b.attacker === self;
      if (cond.self === "attackingBoost") return !!b && b.attacker === self && (b.boost || 0) >= (cond.n || 1);   // "ブーストのコストをNコスト以上支払ってアタック宣言している" (Revise#341)
      if (cond.self === "attackingUnguarded") return !!b && b.attacker === self && !b.guard;   // "アタック目標にアタックした場合": nobody guards (Revise#339)
      if (cond.self === "attackingPlayer") return !!b && b.attacker === self && b.target && b.target.seat != null;
      if (cond.self === "guarding") return !!b && b.guard === self;
      if (cond.self === "declaring") return !!b && (b.attacker === self || b.guard === self);   // "このキャラクターがアタック宣言またはガード宣言している場合" (Revise#128)
      if (cond.self === "battleVsControlled") {
        if (!b) return false;
        const other = b.attacker === self ? (b.guard || (b.target && b.target.ch)) : [b.guard, b.target && b.target.ch].concat(b.joined.grd).includes(self) ? b.attacker : null;
        return !!other && !!S.chars[other] && AA4.isControlled(S.chars[other]);
      }
    }
    if (cond.myTurn) return S.turn.player === seat;
    if (cond.ownEffectsActive) { const nz = x => String(x || "").replace(/[「」｢｣\s]/g, ""); return cond.ownEffectsActive.every(n => S.modifiers.some(m => m.src && m.src.seat === seat && m.src.card && S.cards[m.src.card] && nz((db.card(S.cards[m.src.card].key) || {}).jp) === nz(n))); }   // "あなたの「X」と「Y」が効果を発揮している場合" (EX0757, Revise#356)
    if (cond.sameFactionCtl) { const n = {}; for (const id of AA4.controlledOf(S, seat)) { const f = AA4.charStats(S, db, id).faction; if (f) n[f] = (n[f] || 0) + 1; } return Object.values(n).some(v => v >= cond.sameFactionCtl); }   // "あなたが同じ勢力のキャラクターを2体以上支配している場合" (EP385, Revise#358)
    if (cond.sameJpDeclared) { const cid = ctx.card || (ctx.src && ctx.src.card), jp = cid && S.cards[cid] ? (db.card(S.cards[cid].key) || {}).jp : null; return !!jp && (S.stack || []).some(it => it.kind === "set" && it.card && it.card !== cid && S.cards[it.card] && (db.card(S.cards[it.card].key) || {}).jp === jp); }   // "このカードと同じ名称のカードが使用宣言されている場合" (0743, Revise#360)
    if (cond.namesSameSide || cond.battleSideWith) {   // synchro partners in one battle (EX803 / EX0669 / EX0672, Revise#366)
      const b = S.battle; if (!b) return false;
      const sides = [[b.attacker].concat(b.joined ? b.joined.att : []), [b.guard || (b.target && b.target.ch)].concat(b.joined ? b.joined.grd : [])].map(l => l.filter(id => id && S.chars[id]));
      const nameOf = id => (AA4.cardInfo(S, db, AA4.topOf(S.chars[id])) || {}).name;   // the top card's name (no charStats here: this runs while stats are computed)
      if (cond.namesSameSide) return sides.some(l => cond.namesSameSide.every(n => l.some(id => nameOf(id) === n)));
      return sides.some(l => l.includes(self) && l.some(id => id !== self && nameOf(id) === cond.battleSideWith));
    }
    if (cond.attackedYou) return !!(S.battle && S.battle.kind === "attack" && S.battle.target && S.battle.target.seat === seat);   // "あなたを目標にアタック宣言が行われている状態で" (EP419, Revise#357)
    if (cond.attackDeclared) return !!S.battle;   // "アタック宣言が行われている場合にのみ" (A4-02 0283, Revise#354)
    if (cond.notMyTurn) return S.turn.player !== seat;   // Revise#140
    if (cond.namesCtl) return cond.namesCtl.every(n => Object.keys(S.chars).some(id => S.chars[id].owner === seat && AA4.isControlled(S.chars[id]) && (st => (st.name === n || st.alsoNames.includes(n)) && (!cond.broken || st.broken))(AA4.charStats(S, db, id))));   // broken: "ブレイクしている“X”がいる場合" (Revise#193)   // "あなたの支配エリアに“A”と“B”が存在する場合" (Revise#179)
    if (cond.namesOnField) return cond.namesOnField.every(n => Object.keys(S.chars).some(id => { const st = AA4.charStats(S, db, id); return st.name === n || st.alsoNames.includes(n); }));   // "“A”、“B”…が全て場に出ている場合"
    if (cond.countAtLeast) return Object.keys(S.chars).filter(id => AA4.matchChar(S, db, cond.countAtLeast.sel, id, { seat })).reduce((set, id) => set.add(AA4.charStats(S, db, id).name), new Set()).size >= cond.countAtLeast.n;   // "…異なるネームレベルのキャラクターが4人以上場に出ている場合"
    if (cond.fastDecl) { const c = S.cards[ctx.card || (ctx.src && ctx.src.card)]; return !!(c && c.fastDecl); }   // 3795: "この効果でセットされた場合"
    if (cond.inBattleVs) { const ch = S.chars[self]; return !!ch && !!S.battle && AA4.battleOppsOf(S, self).some(o => S.chars[o] && AA4.matchChar(S, db, cond.inBattleVs, o, { seat: ch.owner })); }   // "このキャラクターが…とバトルする場合" (Revise#157)
    if (cond.permTokenMin) { const ch = S.chars[ctx.self || ctx.ch]; return !!ch && ch.perm.filter(id => S.cards[id].permToken && S.cards[id].permToken.name === cond.permTokenMin.name).length >= cond.permTokenMin.n; }   // 2977: "このキャラクターにコントラクトリングが6枚以上セットされている場合"
    if (cond.notBelowName) return !AA4.checkCond(S, db, { belowName: cond.notBelowName }, ctx);   // 2371 (Q#55)
    if (cond.handHasTag) return !!S.players[seat] && S.players[seat].zones.hand.some(id => id !== (ctx.card || null) && ((db.card(S.cards[id].key) || {}).tags || []).includes(cond.handHasTag));   // "<tag>を持つ手札を公開しない場合、…セット宣言できない" (EX844, Revise#347)
    if (cond.oppDeclaring) return (S.stack || []).some(it => it.seat != null && it.seat !== seat);   // "対戦相手がカードの使用宣言をしている場合" (PP268, Revise#346)
    if (cond.belowNamed) { const card = ctx.card || (ctx.src && ctx.src.card), ch = S.chars[self], i = ch && card ? ch.stack.indexOf(card) : -1; return i > 0 && ch.stack.slice(0, i).some(id => !!(db.card(S.cards[id].key) || {}).name); }   // "このカードの下にネームを持つカードがある場合" (EX914, Revise#344)
    if (cond.battleVsCh) return !!S.chars[cond.battleVsCh.ch] && AA4.battleOppsOf(S, cond.battleVsCh.ch).some(o => AA4.matchChar(S, db, cond.battleVsCh.sel, o, { seat, self: cond.battleVsCh.ch }));   // "目標が…を持つキャラクターとバトルする際" (EX0732)
    if (cond.belowAny) { const card = ctx.card || (ctx.src && ctx.src.card), ch = S.chars[self]; return !!ch && !!card && ch.stack.indexOf(card) > 0; }   // 2418: "このカードの下にカードがある場合"
    if (cond.cardFactorMet) { const card = ctx.card || (ctx.src && ctx.src.card), c = card && S.cards[card]; return !!c && !AA4.factorOk(S, db, seat != null ? seat : c.owner, db.card(c.key) || {}); }   // "あなたがこのカードの必要ファクターを満たしている場合" (A3-22 3167, M5a)
    if (cond.belowName) {   // "このカードの下に「X」がある場合" / "このカードが「X」にセットされた場合"
      const card = ctx.card || (ctx.src && ctx.src.card), ch = S.chars[self];
      if (!ch || !card) return false;
      const i = ch.stack.indexOf(card);   // anywhere below this card in the structure
      return i > 0 && ch.stack.slice(0, i).some(id => { const inf = db.card(S.cards[id].key) || {}; return (inf.jp || "").replace(/\s+/g, "") === cond.belowName || String(inf.name || "").replace(/\s+/g, "") === cond.belowName; });   // the card's full title, or its Name (“各務 柊子” — A3-24 3429, Revise#406)
    }
    if (cond.belowPName) {   // "このカードの下に“X”がある場合": a card with that personal name below this card
      const card = ctx.card || (ctx.src && ctx.src.card), ch = S.chars[self];
      if (!ch || !card) return false;
      const i = ch.stack.indexOf(card);
      return i > 0 && ch.stack.slice(0, i).some(id => (db.card(S.cards[id].key) || {}).name === cond.belowPName);
    }
    if (cond.selfNamedCount) { const ch = S.chars[self]; return !!ch && ch.stack.filter(id => (db.card(S.cards[id].key) || {}).name === cond.selfNamedCount.name).length >= cond.selfNamedCount.n; }
    if (cond.selfPower) return !!S.chars[self] && cmp(S.chars[self].power.length, cond.selfPower.op, cond.selfPower.n);
    if (cond.selfPowerEqMental) { const ch = S.chars[self]; return !!ch && ch.power.length === AA4.charStats(S, db, self).se; }
    if (cond.sameArea) {   // "…と同じエリアにいる場合 / ≪…と同じエリアにいるこのキャラクター≫" (M1a / M1c): Active Area, or Control Area (Front + Back)
      const ch = S.chars[self];
      if (!ch) return false;
      const zone = c => (c.at.area === "active" ? "active" : AA4.isControlled(c) ? "control" : c.at.area), w = cond.sameArea;
      return Object.values(S.chars).some(o => {
        if (o.id === ch.id || o.owner !== ch.owner || zone(o) !== zone(ch)) return false;
        const top = AA4.cardInfo(S, db, AA4.topOf(o));
        return (!w.faction || top.faction === w.faction) && (!w.named || !!top.name) && (!w.name || top.name === w.name) && (!w.icons || w.icons.some(i => (top.icons || []).includes(i)));
      });
    }
    if (cond.namedGoneTurn) return !!(S.turn.namedGone && S.turn.namedGone.turn === S.turn.number && S.turn.namedGone.seats.includes(seat));   // "このターン中に、あなたの支配エリアのネームレベルキャラクターが捨て札されている場合" (Revise#341)
    if (cond.not) return !AA4.checkCond(S, db, cond.not, ctx);
    if (cond.selfHasMod) return S.modifiers.some(m => m.key === cond.selfHasMod && m.to && m.to.ch === self);
    if (cond.targetDeclared) { const b = S.battle; return !!b && b.step !== "end" && !!ctx.target && (b.attacker === ctx.target || b.guard === ctx.target || (b.joined && (b.joined.att.includes(ctx.target) || b.joined.grd.includes(ctx.target)))) && !(b.kind === "faction"); }   // "アタック宣言またはガード宣言した…は、…バトルするか、プレイヤーにアタックするまで" (Revise#137)
    if (cond.targetInBattle) return !!S.battle && !!ctx.target && AA4.battleOppsOf(S, ctx.target).length > 0;   // "≪…≫は、バトルの際、…して判定する" (each character it applies to)
    if (cond.selfHasPerm) return !!S.chars[self] && S.chars[self].perm.length > 0;
    if (cond.cardIn) return AA4.cardInOk(S, cond.cardIn);   // Q#49
    if (cond.selfStackMin) return !!S.chars[self] && S.chars[self].stack.length >= cond.selfStackMin;   // "このキャラクターを構成するカードが10枚以上ある場合" (Revise#151)
    if (cond.belowSameNameMin) return AA4.xOf(S, db, { belowSameName: true }, { ch: self, card: ctx.card || (ctx.src && ctx.src.card), seat }) >= cond.belowSameNameMin;
    if (cond.noOtherShareIcon) { const me = S.chars[self]; if (!me) return false; const ic = AA4.charStats(S, db, self).icons; return !Object.keys(S.chars).some(id => id !== self && AA4.charStats(S, db, id).icons.some(i => ic.includes(i))); }   // 3079
    if (cond.targetInBattle) return !!S.battle && !!ctx.target && [S.battle.attacker, S.battle.guard, S.battle.target && S.battle.target.ch].concat(S.battle.joined.att, S.battle.joined.grd).includes(ctx.target);   // "…がバトルする際、そのキャラクターに+1/+1/+1して判定する" (Revise#147)
    if (cond.selfPermSel) return !!S.chars[self] && S.chars[self].perm.some(id => AA4.cardSelOk(db.card(S.cards[id].key) || {}, cond.selfPermSel));   // "このキャラクターに、ネームに「ブレイブ」を含むE.G.O.のパーマネントがセットされている場合" (Q#40)
    if (cond.selfNoPerm) return !!S.chars[self] && S.chars[self].perm.length === 0;   // "≪パーマネントカードがセットされていないこのキャラクター≫に…" (Revise#141)
    if (cond.attackingCh) return !!S.battle && S.battle.attacker === cond.attackingCh;   // a target's "…がアタック宣言している場合" (Revise#165)
    if (cond.attackingPlayerCh) return !!S.battle && S.battle.attacker === cond.attackingPlayerCh && !!S.battle.target && S.battle.target.seat != null;
    if (cond.inBattleCh) return !!S.battle && AA4.battleOppsOf(S, cond.inBattleCh).length > 0;   // a target's "…がバトルする際"
    if (cond.xEq) return AA4.xOf(S, db, cond.xEq.x, { seat, ch: self, card: ctx.card }) === cond.xEq.n;   // "…が7枚の場合" (A3-12 1775, Revise#171)
    if (cond.stackTopTypes) { const top = S.stack[S.stack.length - 1]; return !!(top && top.kind === "set" && top.card && cond.stackTopTypes.includes((AA4.cardInfo(S, db, top.card) || {}).type)); }   // EX0489 (Revise#209)
    if (cond.handOther) return !!S.players[seat] && S.players[seat].zones.hand.some(id => id !== ctx.card && (i => (!cond.handOther.works || AA4.worksOf(i, cond.handOther.works)))(db.card(S.cards[id].key) || {}));   // "あなたの手札から…のカードを公開することが可能。そうした場合…" (EP384, Revise#209)
    if (cond.selfStatMin) { const st = self && S.chars[self] ? AA4.charStats(S, db, self) : null; return !!st && (st[cond.selfStatMin.key] || 0) >= cond.selfStatMin.n; }   // "このキャラクターの攻撃力が10以上の場合" (A4-01 0116, Revise#218)
    if (cond.tCardSel) { const k = cond.tCardSel; return (ctx.targets || []).some(t => { const c = t.card && S.cards[t.card], i = c ? db.card(c.key) || {} : null; return !!i && (!k.faction || i.faction === k.faction) && (!k.nameHas || String(i.name || "").includes(k.nameHas)); }); }   // "目標がネームに「ブレイブ」を含むE.G.O.のカードの場合" (A3-22 3128, Revise#221)
    if (cond.permKinds) { const k = cond.permKinds, names = new Set(); for (const ch of AA4.controlledOf(S, seat)) for (const id of S.chars[ch].perm) { const i = db.card(S.cards[id].key) || {}; if ((!k.faction || i.faction === k.faction) && (!k.nameHas || String(i.name || "").includes(k.nameHas))) names.add(i.name || i.jp); } return names.size >= k.n; }   // "…パーマネントカードが、合計5種類以上ある場合" (A3-16 2175, Revise#221)
    if (cond.lostBattleTurn) { const l = S.turn.lostBattle; return !!(l && l.turn === S.turn.number && l.seats.includes(seat)); }   // "このターン中に、あなたの支配キャラクターが対戦相手の支配キャラクターとのバトルによって捨て札されている場合" (EP387, Revise#217)
    if (cond.noDeclThisTurn) { const u = S.players[seat] && S.players[seat].usedTurn; return !(u && u.turn === S.turn.number && (u.keys || []).length); }   // "このターン中にあなたがカードの使用宣言を行っていない場合" (EX0615, Revise#208)
    if (cond.xAtMost) return AA4.xOf(S, db, cond.xAtMost.x, { seat, ch: self, card: ctx.card }) <= cond.xAtMost.n;   // "…が1枚以下だった場合" (A3-09 1349, Revise#250)
    if (cond.xAtLeast) return AA4.xOf(S, db, cond.xAtLeast.x, { seat, ch: self, card: ctx.card }) >= cond.xAtLeast.n;   // "あなたの対戦相手全ての手札枚数の合計が1枚以上の場合"
    if (cond.fieldOrDamageName) return AA4.nameOnField(S, db, cond.fieldOrDamageName) || Object.values(S.players).some(p => p.zones.damage.some(id => String((db.card(S.cards[id].key) || {}).name || "").replace(/\s+/g, "") === cond.fieldOrDamageName));   // "場かダメージ置き場に“X”がある場合" (EX0052, Revise#201)
    if (cond.fieldName) return AA4.nameOnField(S, db, cond.fieldName);   // "場に雷電神“鳴”がいる場合"
    if (cond.selfPowerEqMental) { const ch = S.chars[self]; return !!ch && ch.power.length === (AA4.charStats(S, db, self).se || 0); }
    if (cond.selfPowerLtMental) { const ch = S.chars[self]; return !!ch && ch.power.length < (AA4.charStats(S, db, self).se || 0); }
    if (cond.attackedPile) {   // "このキャラクターにアタック宣言されたプレイヤーのダメージ置き場にパーマネントカードがある場合" (Revise#109)
      const b = S.battle;
      if (!b || b.attacker !== self || b.defender == null) return false;
      return S.players[b.defender].zones[cond.attackedPile.zone].some(id => (db.card(S.cards[id].key) || {}).type === cond.attackedPile.type);
    }
    if (cond.selfFighting) return !!(self && S.battle && (S.battle.attacker === self || S.battle.guard === self || AA4.battleOppsOf(S, self).length > 0));   // "プレイヤーにアタックまたはバトルするこのキャラクター" (A4-04 0609)
    if (cond.oppHandAtLimit) return AA4.livingOrder(S).some(x => x !== seat && S.players[x].zones.hand.length >= AA4.playerStats(S, db, x).handLimit);   // "対戦相手の手札枚数が手札上限以上の場合" (A4-PR PR140)
    if (cond.oppDamageMin != null) return AA4.livingOrder(S).some(x => x !== seat && S.players[x].zones.damage.length >= cond.oppDamageMin);   // "あなたの対戦相手いずれか1人のダメージ置き場のカード枚数が8枚以上の場合" (M5)
    if (cond.notFirst) return !!S.turn.order.length && S.turn.order[0] !== seat;   // "あなたが先攻でない場合"
    if (cond.factor) {   // "あなたがEEEを満たしている場合": your Controlled Characters give that factor
      const have = AA4.factorsHave(S, db, seat);   // Revise#310: with player-level gains and 冥
      return Object.entries(cond.factor).every(([f, n]) => (have[f] || 0) >= n);
    }
    if (cond.battleVs) return !!S.chars[self] && AA4.battleOppsOf(S, self).some(o => AA4.matchChar(S, db, cond.battleVs, o, { seat, self }));   // "このキャラクターが…とバトルする際"
    if (cond.selfIs) return !!S.chars[self] && AA4.matchChar(S, db, cond.selfIs, self, { seat, self: null });
    if (cond.phase) return S.turn.phase === cond.phase;
    if (cond.count) { const n = Object.keys(S.chars).filter(id => AA4.matchChar(S, db, cond.count.sel, id, { seat, self })).length; return cmp(n, cond.count.op || ">=", cond.count.n); }
    if (cond.deckEmpty) return !!S.players[seat] && S.players[seat].zones.deck.length === 0;   // "あなたの残りデッキ枚数が0枚の場合" (Revise#141)
    if (cond.damage) return cmp(S.players[seat].zones.damage.length, cond.damage.op, cond.damage.n);
    if (cond.hand) return cmp(S.players[seat].zones.hand.length, cond.hand.op, cond.hand.n);
    if (cond.cardFactorMet) { const c = ctx.card && S.cards[ctx.card]; return !!c && AA4.factorOk(S, db, c.owner, db.card(c.key) || {}); }   // "このカードのオーナーがこのカードの必要ファクターを満たしていた場合" (Revise#164)
    if (cond.selfNoAttack) return !!S.chars[self] && !(S.chars[self].flags.attacks > 0);   // "このキャラクターがアタック宣言しなかった場合" (A3-22 3197, Revise#166)
    if (cond.oppHandZero) return AA4.living(S).some(s => s !== seat && !S.players[s].zones.hand.length);   // A3-07 1132 (Revise#164)
    if (cond.attackingZeroDamage) { const b = S.battle; return !!b && b.attacker === self && b.target && b.target.seat != null && !S.players[b.target.seat].zones.damage.length; }   // A3-07 1165
    return true;
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
