/* ==========================================================================
   v4 engine · Battle System, damage, Defeated System, state check   (requirements_v4 §13, §14; step B4)

   S.battle = { id, kind: "attack" | "faction", attacker, aSeat, target: {seat} | {ch}, defender (seat | null),
                guard, joined: {att: [], grd: []}, boost, step }
   Steps (Revise#046): Attack Declaration (cost) → "guard" (attacked player: guard / no guard; Stealth,
   Breakthrough) → "response" (Fast timing; everyone in needPass() passes with nothing waiting) → "before"
   (game event battleStart → triggers) → battle → "after" (battleEnd → triggers) → end (until-end-of-battle
   effects end). Attack on an Active Character of your own Active Area: no guard, straight to the response.
   Active Phase (Revise#042): each ▼ Active Character attacks the turn player (no cost), faction by faction.

   Battle: both sides deal their attack at the same time; Initiative strikes first and, if that defeats every
   opponent, takes nothing back. "(N)" attack = mental damage. Synchro characters that joined add their attack;
   each character on the other side takes the total separately. Penetrate: normal damage beyond the guard's
   Defense goes on to the original target. No guard → the player takes the damage (damage check).
   Damage (AA4.damageChar): normal ≥ Defense → defeated; mental on a Controlled Character → discard that many
   power cards (not enough → defeated); mental on an Active Character → defeated if ≥ Mental. Shield: only battle
   damage (any battle, also against your own Active Character). Resist ?: no battle damage from that faction / icon. noDamage modifiers.
   Defeated (Revise#047): Bind X / "…場に残す" (replacement abilities) → the owner chooses Keep or Let it go
   (the character waits with flags.dying). Defense 0 that lasts beyond this battle → defeated anyway.
   Named cards go to the Damage Pile only when defeated in battle (Q#14); the rest → Discard Pile.
   State check after every action: Defense ≤ 0 → defeated; 10+ damage → that player loses. Having to draw or to take
   a damage-check card from an empty deck also loses (Q#30);
   3–4 players: the loser's cards leave the game, the last player wins (Revise#053).
   ========================================================================== */
(function (G) {
  "use strict";
  const AA4 = G.AA4, OPS = AA4.OPS, INTENTS = AA4.INTENTS;

  /* ---------- planning attack / guard / join (used by declare, 12-declare.js) ---------- */
  function boostMax(st, power, base) {
    const b = st.skills.boost;
    if (!b) return 0;
    return Math.max(0, Math.min(typeof b === "number" ? b : Infinity, power - base));
  }
  /** Who may pay an attack / guard cost: the character itself, and your characters that pay for others
      (C2: "…から、あなたの支配キャラクターのアタックコスト・ガードコストを代わりに支払うことが可能"). */
  /** 人形使い (Q#51, Revise#146): "目標の≪キャラクター1人≫は、そのオーナーだけではなく、あなたの支配キャラクターとしても扱う。あなたは、目標のアタックコスト・ガードコスト・エフェクトコストを、このキャラクターからのみ支払うことが可能" */
  AA4.puppetBy = (S, chId, seat) => { const m = S.modifiers.find(x => x.key === "puppet" && x.to && x.to.ch === chId && x.value && x.value.seat === seat); return m ? m.value.by : null; };
  AA4.mineOrPuppet = (S, ch, seat) => ch.owner === seat || !!AA4.puppetBy(S, ch.id, seat);
  AA4.puppetsOf = (S, seat) => S.modifiers.filter(x => x.key === "puppet" && x.value && x.value.seat === seat && x.to && S.chars[x.to.ch] && S.chars[x.to.ch].owner !== seat).map(x => x.to.ch);
  AA4.payersFor = (S, db, seat, chId, kind) => AA4.payersFor0(S, db, seat, chId, kind).filter(id => !AA4.lockNoPay(S, db, id));
  AA4.payersFor0 = (S, db, seat, chId, kind) => S.chars[chId] && S.chars[chId].owner !== seat && AA4.puppetBy(S, chId, seat) ? [AA4.puppetBy(S, chId, seat)].filter(id => S.chars[id] && !AA4.charStats(S, db, id).noPay && !(AA4.charStats(S, db, id).noPayKinds || []).includes(kind)) : [chId].filter(id => !AA4.charStats(S, db, id).noPay && !(AA4.charStats(S, db, id).noPayKinds || []).includes(kind)).concat(AA4.charsOf(S, seat).filter(id => id !== chId && !AA4.charStats(S, db, id).noPay && AA4.charStats(S, db, id).payFor.some(p => p.kind === kind && (!p.icons || AA4.charStats(S, db, chId).icons.some(i => p.icons.includes(i))) && (!p.sel || AA4.matchChar(S, db, p.sel, chId, { seat })) && (!p.tokenName || AA4.charStats(S, db, chId).tokenName === p.tokenName) && (!p.nameHas || String(AA4.charStats(S, db, chId).tokenName || "").includes(p.nameHas) || AA4.cardName(db.card(S.cards[AA4.topOf(S.chars[chId])].key) || {}).includes(p.nameHas) || ((db.card(S.cards[AA4.topOf(S.chars[chId])].key) || {}).jp || "").includes(p.nameHas)))));   // payFor {kind, icons?}; noPay: "目標からコストを支払うことはできない"
  AA4.planBattle = (S, db, seat, it) => {
    const ch = S.chars[it.ch];
    if (it.kind === "attack") {
      const t = AA4.timing(S, db, seat, "attack");
      if (t) return { reason: t };
      if (!ch || !AA4.mineOrPuppet(S, ch, seat)) return { reason: "Not your character" };
      if (!AA4.isControlled(ch)) return { reason: "Only Controlled Characters attack" };
      if (AA4.charStats(S, db, it.ch).noAttack) return { reason: "This character can't attack" };
      if (AA4.charStats(S, db, it.ch).battleTax && !AA4.controlledOf(S, seat).some(id => id !== it.ch)) return { reason: "It needs another Controlled Character of yours to discard" };
      const ban = AA4.banOf(S, db, seat, { kind: "attack", info: db.card(S.cards[AA4.topOf(ch)].key) });
      if (ban) return { reason: AA4.banReason(S, db, ban) };
      const tg = it.target || {};
      if (tg.ch != null) {
        const tc = S.chars[tg.ch];
        const extra = tc && tc.owner !== seat && (AA4.charStats(S, db, it.ch).attackChars.some(sel => AA4.matchChar(S, db, sel, tg.ch, { seat, self: it.ch }))
          || (AA4.charStats(S, db, tg.ch).attackableBy || []).some(sel => AA4.matchChar(S, db, sel, it.ch, { seat: tc.owner, self: tg.ch })));   // "≪あなた以外のプレイヤーの支配キャラクター≫は、このキャラクターを目標にアタック宣言可能"   // "≪このキャラクター≫は、勢力エリアのキャラクターを目標にアタック宣言可能" (Revise#109)
        if (!extra && (!tc || tc.owner !== seat || AA4.activeCharOf(S, seat, tc.at.slot) !== tg.ch || tc.at.area !== "active")) return { reason: "Attack a player or an Active Character in your own Active Area" };
      } else if (!(AA4.isInt(tg.seat) && tg.seat !== seat && S.players[tg.seat] && !S.players[tg.seat].lost)) return { reason: "Choose another player (or an Active Character in your Active Area)" };
      if (tg.ch == null && (AA4.charStats(S, db, it.ch).noAttackOn || []).includes(tg.seat)) return { reason: "This character can't attack that player" };   // A3-20 2727 (Revise#209)
      const st = AA4.charStats(S, db, it.ch), boost = it.boost || 0;
      if (!AA4.isInt(boost) || boost < 0 || boost > boostMax(st, ch.power.length, st.attackCost)) return { reason: boost ? `Boost: up to ${boostMax(st, ch.power.length, st.attackCost)}` : "Unknown boost" };
      const xtra0 = tg.ch != null && S.chars[tg.ch] && S.chars[tg.ch].owner !== seat ? Math.min(...st.attackChars.filter(sel => AA4.matchChar(S, db, sel, tg.ch, { seat, self: it.ch })).map(sel => +sel.extraCost || 0).concat([99])) : 0;
      const xtra = xtra0 === 99 && tg.ch != null && (AA4.charStats(S, db, tg.ch).attackableBy || []).length ? 0 : xtra0;   // "追加のアタックコストとしてパワーカード1枚を支払うことで…"
      const tSeat = tg.ch != null ? (S.chars[tg.ch] ? S.chars[tg.ch].owner : null) : tg.seat;
      const tax = AA4.allMods(S, db).filter(m => m.key === "attackTaxVs" && m.src && m.src.seat === tSeat && tSeat !== seat).reduce((n, m) => n + (+(m.value && m.value.n) || 0), 0);   // A3-24 3547 (Revise#199): "あなた、またはあなたの支配キャラクターを目標にアタック宣言する場合、追加で1コスト支払わなければ…"
      const cost = st.attackCost + boost + (xtra === 99 ? 0 : xtra) + tax, payFrom = AA4.payersFor(S, db, seat, it.ch, "attack");
      if (payFrom.reduce((n, id) => n + S.chars[id].power.length, 0) < cost) return { reason: `Attack cost ${cost}: not enough power cards` };
      return { cost, payFrom, spec: null };
    }
    if (it.kind === "guard") {
      const t = AA4.timing(S, db, seat, "guard");
      if (t) return { reason: t };
      const b = S.battle;
      if (!ch || !AA4.mineOrPuppet(S, ch, seat)) return { reason: "Not your character" };
      if (!AA4.isControlled(ch)) return { reason: "Only Controlled Characters guard" };
      if (it.ch === b.attacker) return { reason: "The attacker can't guard" };
      if (b.charGuard && it.ch !== b.target.ch) return { reason: "Only the attacked character may guard this attack" };   // Pack (Revise#407)
      if (AA4.charStats(S, db, it.ch).noGuard) return { reason: "This character can't guard" };
      if (AA4.charStats(S, db, it.ch).battleTax && !AA4.controlledOf(S, seat).some(id => id !== it.ch)) return { reason: "It needs another Controlled Character of yours to discard" };
      const ban = AA4.banOf(S, db, seat, { kind: "guard", info: db.card(S.cards[AA4.topOf(ch)].key) });
      if (ban) return { reason: AA4.banReason(S, db, ban) };
      const why = guardBlocked(S, db, b, it.ch);
      if (why) return { reason: why };
      if (S.raid && S.raid.guardsUsed.includes(it.ch)) return { reason: "It has already guarded in this group of attacks" };   // Q#43
      const taxVs = S.chars[b.attacker] ? AA4.charStats(S, db, b.attacker).guardTaxVs || 0 : 0;   // "目標のアタック宣言に対してガード宣言するキャラクターは、…追加の1コスト" (Revise#140)
      const tax = taxVs + AA4.allMods(S, db).filter(m => m.key === "guardTax" && m.value && AA4.matchChar(S, db, m.value.att || {}, b.attacker, { seat: m.src && m.src.seat }) && AA4.matchChar(S, db, m.value.grd || {}, it.ch, { seat: m.src && m.src.seat })).reduce((n, m) => n + (+m.value.n || 0), 0);   // "…のアタック宣言に対してガード宣言する、…キャラクターのガードコストは1上昇する"
      const subTax = (b.payers || []).some(p => p !== b.attacker && S.chars[p] && AA4.charStats(S, db, p).guardTaxIfPaid) ? 1 : 0;   // 3573 (Revise#152): "このキャラクターが代わりにコストを支払って…アタック宣言させた場合、…ガードコストは1上昇する"
      const boostTax = S.chars[b.attacker] && (b.payers || []).includes(b.attacker) && AA4.charStats(S, db, b.attacker).boostGuardTax ? b.boost || 0 : 0;   // 3390: "このキャラクターから支払われたブーストのコスト1につき、…追加のガードコストは1上昇する"
      const cost = AA4.charStats(S, db, it.ch).guardFree ? 0 : AA4.charStats(S, db, it.ch).guardCost + (b.boost || 0) + tax + subTax + boostTax, payFrom = AA4.payersFor(S, db, seat, it.ch, "guard");
      if (payFrom.reduce((n, id) => n + S.chars[id].power.length, 0) < cost) return { reason: `Guard cost ${cost}: not enough power cards` };
      return { cost, payFrom, spec: null };
    }
    if (it.kind === "join") {   // Synchro (Revise#044): join your side of the battle, paying that side's cost
      const b = S.battle;
      if (!b || b.step !== "response") return { reason: "Only in a battle's response step" };
      const t = AA4.timing(S, db, seat, "fast");
      if (t) return { reason: t };
      if (!ch || ch.owner !== seat || !AA4.isControlled(ch)) return { reason: "Choose one of your Controlled Characters" };
      const st = AA4.charStats(S, db, it.ch);
      if (!st.skills.synchro) return { reason: "Only a character with Synchro can join" };
      if (inBattle(b).includes(it.ch)) return { reason: "It is already in this battle" };
      const side = seat === b.aSeat && b.kind === "attack" ? "att" : seat === b.defender && b.guard ? "grd" : null;
      if (!side) return { reason: "Your side has no character in this battle" };
      const cost = (st.freeJoin && side === "att") || st.freeJoinWith && inBattle(b).some(o => S.chars[o] && AA4.charStats(S, db, o).name === st.freeJoinWith) ? 0 : side === "att" ? st.attackCost : st.guardCost;   // 3534 (Revise#152): "“ユーウェイン”とシンクロする場合、アタックコスト・ガードコストを無視することが可能"
      if (ch.power.length < cost) return { reason: `Cost ${cost}: not enough power cards` };
      return { cost, payFrom: [it.ch], spec: null };
    }
    return { reason: "Unknown declaration" };
  };
  function guardBlocked(S, db, b, chId) {
    if (S.modifiers.some(m => m.key === "unguardedNextP" && m.to && m.to.ch === b.attacker && m.bid === b.id)) return "This attack can't be guarded";   // A4-05 0954 (Revise#342)
    const a = AA4.charStats(S, db, b.attacker), g = AA4.charStats(S, db, chId);
    if (a.unguardableInit && (a.initCount || 0) >= a.unguardableInit) return `It has ${a.initCount} Initiatives: it can't be guarded`;   // Q#56 (Revise#155): 3394 "このキャラクターがイニシアチブを3つ以上持つ場合、≪このキャラクター≫はガードされない"
    if (a.skills.stealth && g.faction !== a.faction && !g.guardStealth) return "Stealth: only a character of the same faction can guard";
    if (b.target && b.target.ch && S.chars[b.target.ch] && (AA4.charStats(S, db, b.target.ch).attackableBy || []).some(v => v.noGuard && AA4.matchChar(S, db, v, b.attacker, { seat: S.chars[b.target.ch].owner }))) return "Nobody can guard an attack on the designated character";   // 3118 (Revise#152)
    if ((a.noGuardBy || []).some(sel => AA4.matchChar(S, db, sel, chId, { seat: S.chars[b.attacker].owner, self: b.attacker }))) return "This attacker can't be guarded by that character";   // "…のキャラクターにガードされない"
    if ((g.noGuardVs || []).some(sel => AA4.matchChar(S, db, sel, b.attacker, { seat: S.chars[chId].owner }))) return "This character can't guard that attacker";   // "≪このキャラクター≫はブレイクしているキャラクターをガードできない"
    if (a.skills.breakthrough && !g.broken && !g.guardBreakthrough) return "Breakthrough: an unbroken character can't guard";   // "ブレイクスルーを持つキャラクターをガード可能" (M1c)
    return null;
  }
  /** Pack (Revise#188): a character guarded, then the attacker got Breakthrough (say, by a Fast card in the Response):
      an unbroken character (only Character cards) can't guard it, so the guard fails — no battle; the attacker's damage goes to its target. */
  AA4.breakthroughFail = (ctx, b) => {
    const S = ctx.S, db = ctx.db;
    if (!b || !b.guard || !S.chars[b.guard] || !S.chars[b.attacker]) return false;
    const a = AA4.charStats(S, db, b.attacker), g = AA4.charStats(S, db, b.guard);
    if (a.skills.stealth && g.faction !== a.faction && !g.guardStealth) {   // Pack (Revise#215): Stealth after the guard (given in Response) — a guard of another faction fails: no battle, the attack goes on to its target
      ctx.emit({ e: "guardCancelled", ch: b.guard, why: "Stealth: a character of another faction can't guard it — no battle, the attack goes through" });
      b.guard = null; b.joined.grd = []; b.guardLost = true;
      return true;
    }
    if (!a.skills.breakthrough || g.broken || g.guardBreakthrough) return false;
    ctx.emit({ e: "guardCancelled", ch: b.guard, why: "Breakthrough: an unbroken character can't guard it — no battle" });
    b.guard = null; b.joined.grd = []; b.guardLost = true;
    return true;
  };
  const inBattle = b => [b.attacker, b.guard, b.target && b.target.ch].concat(b.joined.att, b.joined.grd).filter(Boolean);

  /* ---------- several attacks at once (Q#43, Pack, Revise#145) ----------
     All the attackers are declared together when the first one attacks; then each attack is resolved in turn (its own guard step,
     response, battle). Each character of the attacked player can guard only once in the group. S.raid = {seat, target, attackers, current, guardsUsed}. */
  const raidCost = (S, db, id) => AA4.charStats(S, db, id).attackCost;
  OPS.raidAsk = (ctx, op) => {
    const S = ctx.S, db = ctx.db, r = AA4.charStats(S, db, op.ch).raid;
    if (!r || !S.chars[op.ch]) return;
    const max = r.max ? (r.max.n != null ? r.max.n : AA4.xOf(S, db, r.max, { seat: op.seat, ch: op.ch })) : 99;
    const opts = AA4.controlledOf(S, op.seat).filter(id => id !== op.ch && !S.chars[id].flags.tapped && !AA4.charStats(S, db, id).noAttack && (r.free || S.chars[id].power.length >= raidCost(S, db, id)) && (!r.tokenName || AA4.charStats(S, db, id).tokenName === r.tokenName) && (!r.sel || AA4.matchChar(S, db, r.sel, id, { seat: op.seat, self: op.ch })));   // sel: "分類・イレイザーX体まで" (0015, Revise#361)
    if (!opts.length || max <= 0) return;
    if (r.all) return OPS.raidGo(ctx, { seat: op.seat, ch: op.ch, target: op.target, free: !!r.free, answer: opts.map(id => AA4.topOf(S.chars[id])) });   // EX0155 (Revise#161): every 蟲 attacks too
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 0, max: Math.min(max, opts.length), auto: false,
      reason: `Choose the characters that attack the same target at the same time${r.free ? " (no cost)" : " (each pays its own Attack Cost)"}${max < 99 ? ` — up to ${max}` : ""}`, then: [{ op: "raidGo", seat: op.seat, ch: op.ch, target: op.target, free: !!r.free }] });
  };
  OPS.raidGo = (ctx, op) => {
    const S = ctx.S, db = ctx.db, picked = (op.answer || []).map(id => AA4.charOfCard(S, id)).filter(Boolean).map(c => c.id);
    if (!picked.length) return;
    for (const id of picked) {
      const ch = S.chars[id];
      if (!op.free) { const n = raidCost(S, db, id), paid = ch.power.slice(-n); for (const c of paid) AA4.moveCard(ctx, c, { z: "discard" }); }
      ch.flags.attacks = (ch.flags.attacks || 0) + 1; ch.flags.tapped = true;
    }
    S.raid = { id: AA4.newId(S, "r"), seat: op.seat, target: Object.assign({}, op.target), attackers: [op.ch].concat(picked), current: 0, guardsUsed: S.battle && S.battle.guard ? [S.battle.guard] : [] };
    ctx.emit({ e: "raidDeclared", seat: op.seat, attackers: S.raid.attackers.slice(), target: S.raid.target });
  };
  OPS.raidNext = ctx => {
    const S = ctx.S, r = S.raid;
    if (!r || S.battle) return;
    const tgtOk = r.target.seat != null ? S.players[r.target.seat] && !S.players[r.target.seat].lost : !!S.chars[r.target.ch];
    let i = r.current + 1;
    while (i < r.attackers.length && !(S.chars[r.attackers[i]] && AA4.isControlled(S.chars[r.attackers[i]]))) i++;
    if (!tgtOk || i >= r.attackers.length || S.stage !== "play") { S.raid = null; ctx.emit({ e: "raidOver", seat: r.seat }); return; }
    r.current = i;
    OPS.battleDeclared(ctx, { d: { kind: "attack", seat: r.seat, ch: r.attackers[i], target: Object.assign({}, r.target), boost: 0, paid: 0, paidKeys: [], raidPart: true } });
  };
  /** 2278 as a guard: other Controlled Characters of yours guard the same attack with it (each pays its own Guard Cost) */
  OPS.groupGuardAsk = (ctx, op) => {
    const S = ctx.S, db = ctx.db, b = S.battle;
    if (!b) return;
    const opts = AA4.controlledOf(S, op.seat).filter(id => id !== op.ch && id !== b.attacker && !S.chars[id].flags.tapped && !AA4.charStats(S, db, id).noGuard && !guardBlocked(S, db, b, id) && !(S.raid && S.raid.guardsUsed.includes(id)) && S.chars[id].power.length >= AA4.charStats(S, db, id).guardCost);
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 0, max: opts.length, auto: false, reason: "Choose other characters that guard this attack at the same time (each pays its own Guard Cost)", then: [{ op: "groupGuardGo", seat: op.seat }] });
  };
  OPS.groupGuardGo = (ctx, op) => {
    const S = ctx.S, b = S.battle;
    if (!b) return;
    for (const c of (op.answer || []).map(id => AA4.charOfCard(S, id)).filter(Boolean)) {
      const n = AA4.charStats(S, ctx.db, c.id).guardCost; for (const pc of c.power.slice(-n)) AA4.moveCard(ctx, pc, { z: "discard" });
      c.flags.tapped = true; b.joined.grd.push(c.id); if (S.raid) S.raid.guardsUsed.push(c.id);
      ctx.emit({ e: "joined", ch: c.id, seat: op.seat, side: "grd" });
    }
  };
  /** 2655: "≪このキャラクターのアタック目標となったプレイヤーの、精神力0の支配キャラクター全て≫は、このキャラクターのアタック宣言に対してガード宣言する。その際、そのプレイヤーはそれら以外のキャラクターでもガード宣言可能" */
  OPS.forceZeroGuard = (ctx, op) => {
    const S = ctx.S, db = ctx.db, b = S.battle;
    if (!b || b.guard || b.step !== "guard") return;
    const forced = AA4.controlledOf(S, op.seat).filter(id => !S.chars[id].flags.tapped && (AA4.charStats(S, db, id).se || 0) === 0 && !guardBlocked(S, db, b, id));
    if (!forced.length) return;
    b.guard = forced[0]; b.joined.grd.push(...forced.slice(1)); b.step = "response"; S.passed = [];
    for (const id of forced) { S.chars[id].flags.tapped = true; ctx.emit({ e: "guarded", ch: id, seat: op.seat, attacker: b.attacker, forced: true }); }
    const others = AA4.controlledOf(S, op.seat).filter(id => !forced.includes(id) && !S.chars[id].flags.tapped && !AA4.charStats(S, db, id).noGuard && !guardBlocked(S, db, b, id) && S.chars[id].power.length >= AA4.charStats(S, db, id).guardCost);
    if (others.length) return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: others.map(id => AA4.topOf(S.chars[id])), min: 0, max: others.length, auto: false, reason: "Your Mental-0 characters must guard; you may add other guards (each pays its own Guard Cost)", then: [{ op: "groupGuardGo", seat: op.seat }] });
  };
  /** 3263 (Revise#152): "このキャラクターが代わりにコストを支払ってアタック宣言またはガード宣言しているキャラクターがダメージを与える場合、≪そのキャラクター≫の攻撃力に+Xして判定する。その後、≪そのキャラクター≫を捨て札する" */
  AA4.subPayBoost = (ctx, chId, payers) => {
    const S = ctx.S;
    for (const p of payers || []) if (p !== chId && S.chars[p] && S.chars[chId] && S.chars[p].owner === S.chars[chId].owner) { const bf = AA4.charStats(S, ctx.db, p).subPayBuff; if (bf) for (const k of Object.keys(bf)) if (bf[k]) AA4.addMod(ctx, { src: { seat: S.chars[p].owner, ch: p, card: AA4.topOf(S.chars[p]) }, to: { ch: chId }, key: k, op: "add", value: bf[k], until: "turn" }); }   // A4-01 0111 (Revise#349): "このキャラクターから代わりにコストを支払って…した場合、ターン終了時まで、≪そのキャラクター≫は±0/+1/+1される"
    for (const p of payers || []) if (p !== chId && S.chars[p] && AA4.charStats(S, ctx.db, p).subPayBoost && S.chars[chId]) {
      const x = S.players[S.chars[p].owner].zones.damage.length;
      AA4.addMod(ctx, { src: { seat: S.chars[p].owner, ch: p, card: AA4.topOf(S.chars[p]) }, to: { ch: chId }, key: "at", op: "add", value: x, until: "battle" });
      AA4.addMod(ctx, { src: { seat: S.chars[p].owner, ch: p, card: AA4.topOf(S.chars[p]) }, to: { ch: chId }, key: "subPayDoom", op: "grant", value: true, until: "turn" });
    }
  };
  /** Q#57 (Revise#155): 3461 / 3462 — "このキャラクター以外のあなたの支配キャラクターが(ガードして)バトルする場合、≪このキャラクター≫は、そのキャラクターと同時にバトルすることが可能…このキャラクターがこのアビリティの効果でバトルする場合、あなたのデッキの上からカード1枚を捨て札する" */
  OPS.jointAsk = (ctx, op) => {
    const S = ctx.S, db = ctx.db, b = S.battle;
    if (!b || !S.chars[op.ch]) return;
    const inB = [b.attacker, b.guard].concat(b.joined.att, b.joined.grd).filter(Boolean);
    const opts = AA4.controlledOf(S, op.seat).filter(id => id !== op.ch && !inB.includes(id) && (v => v && (op.side === "grd" || !v.guardOnly))(AA4.charStats(S, db, id).jointBattle));
    if (!opts.length) return;
    return AA4.ask(ctx, { seat: op.seat, kind: "cards", options: opts.map(id => AA4.topOf(S.chars[id])), min: 0, max: opts.length, auto: false, reason: "It may battle together with this character (mill 1 each): shared skills, Attack added; normal damage below their total Defense is cancelled", then: [{ op: "jointGo", side: op.side, seat: op.seat }] });
  };
  OPS.jointGo = (ctx, op) => {
    const S = ctx.S, b = S.battle, deck = S.players[op.seat].zones.deck;
    if (!b) return;
    for (const id of (op.answer || []).map(x => AA4.charOfCard(S, x)).filter(Boolean).map(c => c.id)) {
      b.joined[op.side].push(id); (b.pool = b.pool || {})[op.side] = true;
      if (deck.length) AA4.moveCard(ctx, deck[deck.length - 1], { z: "discard" });
      ctx.emit({ e: "joined", ch: id, seat: op.seat, side: op.side });
    }
  };
  OPS.battleDeclared = (ctx, op) => {
    const S = ctx.S, d = op.d;
    if ((d.kind === "attack" || d.kind === "guard") && S.chars[d.ch] && AA4.charStats(S, ctx.db, d.ch).battleTax) {   // "あなたの任意のあなたの支配キャラクター1人を捨て札しなければ、…アタック宣言・ガード宣言できない"
      const opts = AA4.controlledOf(S, d.seat).filter(id => id !== d.ch);
      if (opts.length) AA4.enqueue(S, [{ op: "askTax", seat: d.seat, opts }], true);
    }
    if (d.kind === "attack") {
      const ch = S.chars[d.ch];
      if (!d.raidPart) { ch.flags.attacks = (ch.flags.attacks || 0) + 1; ch.flags.tapped = true; }
      S.battle = { id: AA4.newId(S, "b"), kind: "attack", attacker: d.ch, aSeat: d.seat, target: Object.assign({}, d.target), paidKeys: { attack: d.paidKeys || [], guard: [] },
        defender: d.target.seat != null ? d.target.seat : null, guard: null, joined: { att: [], grd: [] }, boost: d.boost || 0, payers: (d.payers || []).slice(),
        step: d.target.ch != null ? "response" : "guard" };
      // Pack (Revise#407): an attack on another player's character ("…は、キャラクターを目標にアタック宣言可能") — the attacked character itself guards or not.
      // Guard → a battle as usual; no guard → the damage is dealt to it as damage outside a battle. No other character may guard in its place.
      { const tc = d.target.ch != null ? S.chars[d.target.ch] : null; if (tc && tc.owner !== d.seat && !d.raidPart) { S.battle.charGuard = true; S.battle.defender = tc.owner; S.battle.step = "guard"; } }
      { const un = S.modifiers.find(m => m.key === "unguardedNextP" && m.to && m.to.ch === d.ch && !m.bid && (d.target.seat != null || (m.value && m.value.any))); if (un) un.bid = S.battle.id; }   // A4-05 0954 (Revise#342): its next attack on a player
      S.passed = [];
      ctx.emit({ e: "attacked", ch: d.ch, seat: d.seat, target: Object.assign({}, d.target), boost: d.boost || 0 });
      AA4.runWatch(ctx, "attack", d.ch);
      AA4.subPayBoost(ctx, d.ch, d.payers);
      AA4.enqueue(S, [{ op: "jointAsk", side: "att", seat: d.seat, ch: d.ch }]);
      AA4.declDropPower(ctx, d.ch);
      { const st = AA4.charStats(S, ctx.db, d.ch);   // Q#43 (Pack, Revise#145): the other attackers are declared now, all together
        if (st.raid && !d.raidPart && !S.raid) AA4.enqueue(S, [{ op: "raidAsk", seat: d.seat, ch: d.ch, target: Object.assign({}, d.target) }], true);
        if (st.forceZeroGuard && d.target.seat != null) AA4.enqueue(S, [{ op: "forceZeroGuard", seat: d.target.seat }], true); }
      for (const m of S.modifiers.filter(x => x.key === "discardOnAttack" && x.to && x.to.ch === d.ch)) { const card = m.value && m.value.card; AA4.endMod(ctx, m.id); if (card && S.cards[card] && S.cards[card].place.z === "special") AA4.moveCard(ctx, card, { z: m.value.dest === "hand" ? "hand" : "discard" }); }   // "目標がアタックした場合、このカードを捨て札する" (its effects stay for their time)
    } else if (d.kind === "guard") {
      S.battle.guard = d.ch; S.battle.step = "response"; S.passed = []; S.battle.gPayers = (d.payers || []).slice(); AA4.subPayBoost(ctx, d.ch, d.payers); AA4.enqueue(S, [{ op: "jointAsk", side: "grd", seat: d.seat, ch: d.ch }]);
      if (S.battle.paidKeys) S.battle.paidKeys.guard = d.paidKeys || [];
      S.chars[d.ch].flags.tapped = true;
      ctx.emit({ e: "guarded", ch: d.ch, seat: d.seat, attacker: S.battle.attacker });
      AA4.runWatch(ctx, "guard", d.ch);
      AA4.declDropPower(ctx, d.ch);
      AA4.guardHit(ctx, S.battle.attacker, d.ch);
      if (S.modifiers.some(m => (m.key === "cancelIfGuarded" && m.to && m.to.ch === S.battle.attacker) || m.key === "cancelGuardedAll" || (m.key === "cancelWhenGuards" && m.to && m.to.ch === d.ch))) { S.battle.step = "end"; ctx.emit({ e: "attackCancelled", ch: S.battle.attacker }); }   // A3-05 0874 (Revise#159); + "≪ガード宣言されたキャラクター≫のアタック宣言を取り消す" / "目標にガード宣言されたキャラクターのアタック宣言を取り消す" (Revise#168)
      if (S.modifiers.some(m => m.key === "guardCancelBy" && m.to && m.to.ch === S.battle.attacker && m.value && m.value.ch === d.ch)) { S.battle.step = "end"; ctx.emit({ e: "attackCancelled", ch: S.battle.attacker }); }   // A3-04 0676 (Revise#159)
      if (S.raid && !S.raid.guardsUsed.includes(d.ch)) S.raid.guardsUsed.push(d.ch);
      if (AA4.charStats(S, ctx.db, d.ch).raid && AA4.charStats(S, ctx.db, d.ch).raid.guards) AA4.enqueue(S, [{ op: "groupGuardAsk", seat: d.seat, ch: d.ch }], true);   // 2278: "…ガード宣言する場合、≪あなたの任意の数のあなたの支配キャラクター≫は、同じ目標に対して、同時に…ガード宣言可能"
    } else if (d.kind === "join") {
      const b = S.battle, side = d.seat === b.aSeat && b.kind === "attack" ? "att" : "grd";
      b.joined[side].push(d.ch); (b.synchro = b.synchro || []).push(d.ch); S.passed = [];
      ctx.emit({ e: "joined", ch: d.ch, seat: d.seat, side });
    }
  };
  INTENTS.noGuard = {
    undoable: true,
    check(ctx, it) { const t = AA4.timing(ctx.S, ctx.db, AA4.seatFor(ctx.S, it), "guard"); return AA4.seatFor(ctx.S, it) == null ? "You are not playing at this table" : t; },
    apply(ctx, it) { const S = ctx.S; S.battle.step = "response"; S.passed = []; ctx.emit({ e: "noGuard", seat: AA4.seatFor(S, it) }); },
  };

  /* ---------- the battle flow ---------- */
  const quiet = S => !S.stack.length && !S.draft && !S.triggers.length && !S.decisions.length && !S.queue.length;
  // Active Phase faction check
  AA4.FLOW.push(ctx => {
    const S = ctx.S;
    if (S.turn.phase !== "active" || S.turn.step !== "check" || S.battle || !quiet(S)) return false;
    const seat = S.turn.player;
    for (let i = S.turn.fcAt || 0; i < AA4.SLOTS.length; i++) {
      const chId = AA4.activeCharOf(S, seat, AA4.SLOTS[i]);
      if (!chId || !AA4.charStats(S, ctx.db, chId).skills.aggressive) continue;
      S.turn.fcAt = i + 1;
      S.battle = { id: AA4.newId(S, "b"), kind: "faction", attacker: chId, aSeat: seat, target: { seat }, defender: seat, guard: null, joined: { att: [], grd: [] }, boost: 0, step: "guard" };
      S.passed = [];
      ctx.emit({ e: "attacked", ch: chId, seat, target: { seat }, faction: AA4.SLOTS[i] });
      return true;
    }
    S.turn.step = "done";
    ctx.emit({ e: "factionCheckDone", seat });
    return true;
  });
  // battle steps
  AA4.FLOW.push(ctx => {
    const S = ctx.S, b = S.battle;
    if (!b || !quiet(S)) return false;
    if (b.step !== "end" && (!S.chars[b.attacker] || (b.kind === "attack" && !AA4.isControlled(S.chars[b.attacker])))) {   // Pack, Revise#089
      b.step = "end"; ctx.emit({ e: "attackEnded", why: S.chars[b.attacker] ? "the attacker is no longer in the Control Area — no damage" : "the attacker is gone — no damage" });
    }
    if (b.step === "response") {
      if (!AA4.needPass(S).every(s => S.passed.includes(s))) return false;
      AA4.breakthroughFail(ctx, b);   // Pack (Revise#188): Breakthrough given after an unbroken character guarded → the guard fails
      // リムノレイア (Revise#133): "あなたを目標としたアタック宣言に対してガード宣言が行われずにレスポンスの宣言が終了した場合、≪このキャラクター≫は、…キャラクター全てをガードする。
      // このアビリティの効果でガードした場合、≪このキャラクター≫に±0/+X/+Xして判定する" (X = your Damage Pile)
      if (b.kind === "attack" && !b.guard && b.target && b.target.seat != null && !b.autoGuarded) {
        b.autoGuarded = true;
        const g = AA4.controlledOf(S, b.target.seat).find(id => id !== b.attacker && AA4.charStats(S, ctx.db, id).autoGuard);
        if (g) {
          b.guard = g; S.chars[g].flags.tapped = true;
          const x = S.players[b.target.seat].zones.damage.length;
          for (const key of ["at", "de"]) AA4.addMod(ctx, { src: { ch: g, seat: b.target.seat, card: AA4.topOf(S.chars[g]), label: AA4.cardName(ctx.db.card(S.cards[AA4.topOf(S.chars[g])].key)) }, to: { ch: g }, key, op: "add", value: x, until: "battle" });
          ctx.emit({ e: "guarded", ch: g, seat: b.target.seat, attacker: b.attacker, auto: true });
        }
      }
      b.step = "before";
      b.vsUnbrokenCtl = inBattle(b).filter(id => S.chars[id] && AA4.battleOppsOf(S, id).some(o => AA4.isControlled(S.chars[o]) && !AA4.charStats(S, ctx.db, o).broken));   // A4-05 0916 (Revise#343)
      b.vsCtl = inBattle(b).filter(id => S.chars[id] && AA4.battleOppsOf(S, id).some(o => AA4.isControlled(S.chars[o])));   // "支配キャラクターとバトルした場合" — kept for the battle's end (EX0147, Revise#210)
      ctx.emit({ e: "battleStart", battle: b.id, chars: inBattle(b).filter(id => S.chars[id]) });
      AA4.enqueue(S, [{ op: "permCheck" }]);   // "バトルする際…パーマネント-1を与える" (Q#35)
      // "…終了時まで、目標がバトルする際、…" (modifier battleHook on a character): its steps run now, for that character
      for (const chId of inBattle(b).filter(id => S.chars[id])) for (const m of AA4.allMods(S, ctx.db).filter(x => x.key === "battleHook" && AA4.modAppliesToChar(S, ctx.db, x, chId)))
        AA4.runEffect(ctx, { steps: (m.value && m.value.steps) || [], status: "auto" }, { seat: m.src ? m.src.seat : S.chars[chId].owner, ch: chId, card: m.src && m.src.card });
      return true;
    }
    if (b.step === "before") { AA4.enqueue(S, [{ op: "doBattle" }]); b.step = "after"; return true; }
    if (b.step === "after" && b.initCounter) { const o = b.initCounter; delete b.initCounter; AA4.enqueue(S, [o]); return true; }   // Initiative: the strike back, once every "keep it?" of the first strike is answered (Revise#207)
    if (b.step === "after") {
      b.step = "end";
      ctx.emit({ e: "battleEnd", battle: b.id, chars: inBattle(b).filter(id => S.chars[id]), vsCtl: b.vsCtl || [], vsUnbrokenCtl: b.vsUnbrokenCtl || [] });
      for (const id of inBattle(b)) for (const m of S.modifiers.filter(x => x.key === "endSrcOnBattle" && x.to && x.to.ch === id && x.src && x.src.card)) for (const o of S.modifiers.filter(x => x.src && x.src.card === m.src.card)) AA4.endMod(ctx, o.id);   // "目標がバトルした場合、このカードを捨て札する" (Revise#192): its lasting effect ends → the card goes to the Discard Pile
      for (const id of [b.attacker, b.guard].filter(Boolean)) if (S.chars[id] && S.modifiers.some(m => m.key === "subPayDoom" && m.to && m.to.ch === id)) AA4.defeat(ctx, id, { why: "discarded after the battle (3263)" });
      for (const id of inBattle(b)) if (S.chars[id] && AA4.charStats(S, ctx.db, id).battleEndKill) for (const o of AA4.battleOppsOf(S, id)) if (S.chars[o]) AA4.defeat(ctx, o, { why: "discarded at the end of the battle" });   // "≪このキャラクターのバトル相手≫は、バトル終了時に捨て札される" (Revise#138)
      if (AA4.allMods(S, ctx.db).some(m => m.key === "battleEndAll")) for (const id of inBattle(b)) if (S.chars[id]) AA4.defeat(ctx, id, { why: "battled: discarded at the end of the battle (2974)" });   // "≪バトルしたキャラクター≫は、バトル終了時に捨て札される" (Revise#147)
      for (const id of inBattle(b)) if (S.chars[id] && S.modifiers.some(m => m.key === "battleEndToDamage" && m.to && m.to.ch === id)) AA4.removeChar(ctx, id, { to: "damage", why: "at the end of the battle (シルヴァ)" });   // "目標はバトル終了時にダメージ置き場に置かれる" (Revise#133)
      return true;
    }
    if (b.step === "end") {
      for (const m of S.modifiers.slice()) if (m.nextBattle && m.to && inBattle(b).includes(m.to.ch)) AA4.endMod(ctx, m.id);   // "次にこのキャラクターがバトルする際" (Revise#157)
      S.battle = null; S.passed = [];
      if ((S.afterBattle || []).length) { const ops = S.afterBattle; S.afterBattle = []; AA4.enqueue(S, ops); }   // EP188: the follow-up attack
      AA4.expire(ctx, "battle");
      for (const ch of Object.values(S.chars)) delete ch.flags.zeroSafe;
      ctx.emit({ e: "battleOver", battle: b.id });
      AA4.enqueue(S, [{ op: "mentalCheck" }, { op: "permCheck" }, { op: "raidNext" }]);
      return true;
    }
    return false;
  });

  /** Damage a side deals: total normal and mental attack of its characters. */
  function sideDamage(S, db, ids) {
    const d = { normal: 0, mental: 0 };
    for (const id of ids) {
      const st = AA4.charStats(S, db, id);
      { const pa = AA4.atkParts(st); d.mental += pa.m; d.normal += pa.n; }   // normal and mental Attack, each worked out on its own (Revise#238); "本来の攻撃力に加え…" (dualAtk) inside atkParts
    }
    return d;
  }
  OPS.playerHitAgain = (ctx, op) => { if (ctx.S.players[op.seat] && !ctx.S.players[op.seat].lost) { ctx.emit({ e: "damageAgain", seat: op.seat, by: op.from }); AA4.damagePlayer(ctx, op.seat, op.d, { from: op.from }); } };
  OPS.extraHit = (ctx, op) => { const ch = ctx.S.chars[op.ch]; if (ch && !ch.flags.dying) AA4.damageChar(ctx, op.ch, op.d); };
  /** One side's battle damage to the other side's characters (multi / triple hits too). → true when every target was defeated (or is being asked whether to keep it). */
  const battleHit = (ctx, targets, d, from) => { const S = ctx.S, db = ctx.db; return targets.filter(id => S.chars[id]).map(id => {
      { const mh = from && S.chars[from] ? (AA4.charStats(S, db, from).multiHit || 1) - 1 : 0; if (mh > 0 && (d.normal || d.mental)) AA4.enqueue(S, Array.from({ length: mh }, () => ({ op: "extraHit", ch: id, d: Object.assign({ battle: true, from }, d) }))); }   // EP187 (Revise#157)
      if (from && S.chars[from] && AA4.charStats(S, db, from).tripleHit && (d.normal || d.mental)) AA4.enqueue(S, [{ op: "extraHit", ch: id, d: Object.assign({ battle: true, from }, d) }, { op: "extraHit", ch: id, d: Object.assign({ battle: true, from }, d) }]);   // Q#45 (Revise#145): 3 separate hits — each checked on its own, each kept on its own
      return AA4.damageChar(ctx, id, Object.assign({ battle: true, from }, d));
    }).every(Boolean); };
  /** Initiative (Pack, Revise#207): after the first strike, every character of the other side still on the field — kept by Bind or any other way — strikes back.
      It waits on the battle (b.initCounter) until the After-battle step, so every "keep it?" choice of the first strike is answered first. */
  OPS.initCounter = (ctx, op) => {
    const S = ctx.S, db = ctx.db, b = S.battle;
    if (!b || b.id !== op.battle) return;
    const alive = op.from.filter(id => S.chars[id] && !S.chars[id].flags.dying && AA4.isControlled(S.chars[id]));
    if (!alive.length) return;
    const tg = op.to.filter(id => S.chars[id]);
    if (!tg.length) return;
    let d = sideDamage(S, db, alive);
    if (b.pool && b.pool[op.poolSide] && d.normal > 0 && d.normal < tg.reduce((n, id) => n + (AA4.charStats(S, db, id).de || 0), 0)) d = Object.assign({}, d, { normal: 0 });   // Q#57
    ctx.emit({ e: "note", text: `${AA4.cardName(db.card(S.cards[AA4.topOf(S.chars[alive[0]])].key))} is still on the field — it strikes back (Initiative)` });
    battleHit(ctx, tg, d, alive[0]);
    if (op.dual && alive.some(id => S.chars[id] && !S.chars[id].flags.dying)) battleHit(ctx, alive.filter(id => S.chars[id]), op.dualD, op.dualFrom);   // EX0256: the first striker hits again at the normal timing
  };
  OPS.doBattle = ctx => {
    const S = ctx.S, db = ctx.db, b = S.battle;
    if (!b || !S.chars[b.attacker]) return;
    if (b.kind === "attack" && !AA4.isControlled(S.chars[b.attacker])) { ctx.emit({ e: "attackEnded", why: "the attacker is no longer in the Control Area — no damage" }); return; }
    // a guard that left the Control Area: the guard is cancelled — the attack still has its own target (a player, or a character),
    // so the attacker's damage goes to that target without a battle (Pack: "Guard does not change the target")
    if (b.guard && (!S.chars[b.guard] || !AA4.isControlled(S.chars[b.guard]))) { ctx.emit({ e: "guardCancelled", ch: b.guard, why: "no longer in the Control Area" }); b.guard = null; b.joined.grd = []; b.guardLost = true; }
    AA4.breakthroughFail(ctx, b);   // Breakthrough given in the Before-battle step (Revise#188)
    if (b.guard && S.chars[b.guard] && AA4.charStats(S, db, b.attacker).retreatVsStrong && (AA4.charStats(S, db, b.guard).at || 0) >= (AA4.charStats(S, db, b.attacker).de || 0)) {   // 3121 (Revise#151): "ガード宣言しているキャラクターの攻撃力の数値が、このキャラクターの耐久力以上の場合、アタック宣言を取り消す。その後、ガード宣言していたキャラクターのオーナーに1ダメージ"
      ctx.emit({ e: "attackEnded", why: "the attack is called off (the guard is too strong)" });
      AA4.damagePlayer(ctx, S.chars[b.guard].owner, { normal: 1, mental: 0 }, { from: b.attacker });
      return;
    }
    b.joined.att = b.joined.att.filter(id => S.chars[id] && AA4.isControlled(S.chars[id]));
    if ((b.guardLost || (b.charGuard && !b.guard)) && b.target.ch && S.chars[b.target.ch]) {   // charGuard without a guard: damage outside a battle (Revise#407)
      const d = sideDamage(S, db, [b.attacker].concat(b.joined.att));
      AA4.damageChar(ctx, b.target.ch, Object.assign({ battle: false, from: b.attacker }, d));
      return;
    }
    const A = [b.attacker].concat(b.joined.att).filter(id => S.chars[id]);
    const B = (b.guard ? [b.guard].concat(b.joined.grd) : b.target.ch ? [b.target.ch] : []).filter(id => S.chars[id]);
    if (b.duel && S.chars[b.duel]) B.push(b.duel);   // "オープンフィンガーグローブ": the attacker battles a named character instead
    if (!B.length) {
      if ((b.guard && !b.guardLost) || b.target.ch) { ctx.emit({ e: "attackEnded", why: "the target is gone" }); return; }
      if (!b.reached) { b.reached = true; ctx.emit({ e: "reachedPlayer", ch: b.attacker, seat: b.defender }); }   // nobody guarded: the attack is on the player now (Revise#389)
      const ast = AA4.charStats(S, db, b.attacker);
      if (ast.duelNamed && !b.duelAsked && (ast.name === ast.duelNamed.host || ast.alsoNames.includes(ast.duelNamed.host))) {
        const opts = AA4.charsOf(S, b.defender).filter(id => AA4.charStats(S, db, id).named);
        if (opts.length) {
          b.duelAsked = true;
          return AA4.ask(ctx, { seat: b.aSeat, kind: "pick", options: ["normal"].concat(opts), labels: ["Normal damage check"].concat(opts.map(id => "Battle " + AA4.cardName(db.card(S.cards[AA4.topOf(S.chars[id])].key)))),
            reason: "No damage check: battle a named character of the attacked player instead?", then: [{ op: "duelGo" }] });
        }
      }
      const rep = AA4.allMods(S, db).find(m => m.key === "attackReplace" && AA4.modAppliesToSeat(S, m, b.defender));   // "時空緩衝器": no damage check — mill, then draw
      if (rep) {
        const v = rep.value || {}, deck = S.players[b.defender].zones.deck;
        ctx.emit({ e: "attackReplaced", seat: b.defender, by: rep.src && rep.src.label });
        for (let i = 0; i < (v.mill || 0) && deck.length; i++) AA4.moveCard(ctx, deck[deck.length - 1], { z: "damage" });
        if (v.draw) AA4.enqueue(S, [{ op: "draw", seat: b.defender, n: v.draw }], true);
        return;
      }
      // "このキャラクターがプレイヤーにアタックした場合、通常のダメージ判定を行わず / の後、…" (Revise#109)
      const hits = AA4.allMods(S, db).filter(m => m.key === "playerHit" && AA4.modAppliesToChar(S, db, m, b.attacker) && m.value && m.value.effect);
      const dmgX = (() => { const d0 = sideDamage(S, db, A); return (d0.normal || 0) + (d0.mental || 0); })();
      const runHits = list => { for (const m of list) { AA4.runEffect(ctx, m.value.effect, { seat: S.chars[b.attacker].owner, ch: b.attacker, card: m.src && m.src.card, x: dmgX, evSeat: b.defender, evHit: b.defender }); if (m.value.once && m.id && S.modifiers.some(q => q.id === m.id)) AA4.endMod(ctx, m.id); } };   // once: "次にプレイヤーにアタックした場合" (A4-EP EP511)   // x: the damage it would deal (2279)
      if (hits.some(m => m.value.replace)) {
        ctx.emit({ e: "attackReplaced", seat: b.defender, by: hits[0].src && hits[0].src.label });
        runHits(hits.filter(m => m.value.replace));
        return;
      }
      const d = sideDamage(S, db, A);
      ctx.emit({ e: "battle", battle: b.id, a: A, b: [], dA: d, dB: { normal: 0, mental: 0 }, first: null, kind: b.kind, player: b.defender,
        sideA: A.map(id => { const st = AA4.charStats(S, db, id); return { ch: id, top: AA4.topOf(S.chars[id]), at: st.at || 0, atMental: !!st.atMental, atText: AA4.atkText(st), de: st.de, se: st.se, power: S.chars[id].power.length, controlled: AA4.isControlled(S.chars[id]), owner: S.chars[id].owner }; }), sideB: [] });
      const di = S.chars[b.attacker] && AA4.isControlled(S.chars[b.attacker]) && AA4.allMods(S, db).find(m => m.key === "attackDrawInstead");   // A3-05 0768 (Revise#159): "…通常のダメージ判定を行わず、Xドローする (X = アタックしたキャラクターの攻撃力)"
      if (di) { const n = Math.max(0, AA4.charStats(S, db, b.attacker).at || 0); ctx.emit({ e: "note", text: `No damage check: ${S.players[b.defender].name} draws ${n}` }); if (n) AA4.enqueue(S, [{ op: "draw", seat: b.defender, n }]); }
      else AA4.damagePlayer(ctx, b.defender, d, { from: b.attacker });
      if (S.chars[b.attacker] && AA4.allMods(S, db).some(m => m.key === "selfHitAfterPlayer")) { const n = Math.max(0, AA4.charStats(S, db, b.attacker).at || 0); if (n) AA4.enqueue(S, [{ op: "extraHit", ch: b.attacker, d: { normal: n, mental: 0 } }]); }   // A3-03 0597
      { const st = S.chars[b.attacker] && AA4.charStats(S, db, b.attacker), reps = st ? (st.multiHit || 1) - 1 + (st.hitTwice ? 1 : 0) : 0;   // EP187 / EP167 (Revise#157)
        if (reps > 0 && (d.normal || d.mental)) AA4.enqueue(S, Array.from({ length: reps }, () => ({ op: "playerHitAgain", seat: b.defender, d, from: b.attacker })), true); }
      runHits(hits);
      return;
    }
    const dA = sideDamage(S, db, A), dB = sideDamage(S, db, B);
    const ini = ids => ids.some(id => AA4.charStats(S, db, id).skills.initiative);
    const iA = ini(A), iB = ini(B);
    const pool = (side, ids, d) => { if (!(b.pool && b.pool[side]) || !(d.normal > 0)) return d; const tot = ids.filter(id => S.chars[id]).reduce((n, id) => n + (AA4.charStats(S, db, id).de || 0), 0); return d.normal < tot ? Object.assign({}, d, { normal: 0 }) : d; };   // Q#57 (Revise#155): 3461 / 3462 — normal damage below their total Defense is cancelled
    const dAx = pool("grd", B, dA), dBx = pool("att", A, dB);
    const hit = (targets, d, from) => battleHit(ctx, targets, d, from);
    // Penetrate: normal damage beyond the (first) guard's Defense goes on (never when guarding)
    const pen = AA4.charStats(S, db, b.attacker).skills.penetrate ? Math.max(0, dA.normal - (AA4.charStats(S, db, B[0]).de || 0)) : 0;
    const card = id => { const st = AA4.charStats(S, db, id); return { ch: id, top: AA4.topOf(S.chars[id]), at: st.at || 0, atMental: !!st.atMental, atText: AA4.atkText(st), de: st.de, se: st.se, power: S.chars[id].power.length, controlled: AA4.isControlled(S.chars[id]), owner: S.chars[id].owner }; };
    ctx.emit({ e: "battle", battle: b.id, a: A, b: B, dA, dB, first: iA && !iB ? "a" : iB && !iA ? "b" : null, kind: b.kind, sideA: A.map(card), sideB: B.map(card) });
    const dual = ids => ids.some(id => S.chars[id] && AA4.charStats(S, db, id).dualTiming && AA4.charStats(S, db, id).skills.initiative);   // EX0256 (Revise#161): damage at the Initiative timing and again at the normal timing
    if (iA && !iB) { hit(B, dAx, b.attacker); b.initCounter = { op: "initCounter", battle: b.id, from: B.slice(), to: A.slice(), poolSide: "att", dual: dual(A), dualD: dAx, dualFrom: b.attacker }; }   // Initiative: first strike, then whoever is still there strikes back (Pack, Revise#207)
    else if (iB && !iA) { hit(A, dBx, B[0]); b.initCounter = { op: "initCounter", battle: b.id, from: A.slice(), to: B.slice(), poolSide: "grd", dual: dual(B), dualD: dBx, dualFrom: B[0] }; }
    else { hit(B, dAx, b.attacker); hit(A, dBx, B[0]); }
    if (pen) {
      if (b.guard && b.defender != null) AA4.damagePlayer(ctx, b.defender, { normal: pen, mental: 0 }, { from: b.attacker, penetrate: true });
      else if (b.target.ch) {   // the character below in the same faction party
        const tc = S.chars[b.target.ch] || null, list = tc ? AA4.charListOf(S, tc.owner, tc.at) : null;
        const below = list ? list[list.indexOf(b.target.ch) - 1] : null;
        if (below) AA4.damageChar(ctx, below, { normal: pen, mental: 0, battle: true, from: b.attacker, penetrate: true });
      }
    }
  };

  OPS.duelGo = (ctx, op) => {
    const S = ctx.S, b = S.battle, pick = (op.answer || [])[0];
    if (!b) return;
    if (pick && pick !== "normal" && S.chars[pick]) { b.duel = pick; ctx.emit({ e: "duel", ch: b.attacker, with: pick }); }
    AA4.enqueue(S, [{ op: "doBattle" }], true);
  };

  /* ---------- damage ---------- */
  /** Damage to a player (damage check, Revise#046): per point the top card of the deck — a Character card goes to
      the Active Area (a name already on the field → Damage Pile), any other card → Damage Pile.
      Mental damage runs the same damage check (Revise#092). how.direct (by-hand "special damage"): straight to the Damage Pile. */
  AA4.damagePlayer = (ctx, seat, d, how = {}) => {
    const S = ctx.S, p = S.players[seat];
    if (!p || p.lost) return;
    // "≪あなた≫が勢力キャラクターから受けるダメージの数値に-1して判定する" (M1c): damage from an Active Character
    const fromCh = how.from && S.chars[how.from];
    if (!how.redirected && (d.normal || 0) + (d.mental || 0) > 0) {   // "あなたに与えられるダメージは、≪このキャラクター≫が代わりに受ける。その後、このカードを捨て札する" (PP335, Revise#353)
      const sh = AA4.allMods(S, ctx.db).find(m => m.key === "ownerShield" && m.src && m.src.ch && S.chars[m.src.ch] && S.chars[m.src.ch].owner === seat && AA4.isControlled(S.chars[m.src.ch]) && !S.chars[m.src.ch].flags.dying);
      if (sh) { ctx.emit({ e: "note", text: `${AA4.cardName(ctx.db.card(S.cards[AA4.topOf(S.chars[sh.src.ch])].key))} takes that damage instead of its player` }); AA4.damageChar(ctx, sh.src.ch, { normal: d.normal || 0, mental: d.mental || 0, from: how.from, fromSeat: how.fromSeat, redirected: true }); if (sh.src.card && S.cards[sh.src.card] && S.cards[sh.src.card].place.z === "char") AA4.moveCard(ctx, sh.src.card, { z: "discard" }); return; }
    }
    { const na = AA4.allMods(S, ctx.db).find(m => m.key === "playerNoDamageAll" && AA4.modAppliesToSeat(S, m, seat) && (!m.cond || AA4.checkCond(S, ctx.db, m.cond, { seat: m.src ? m.src.seat : seat, src: m.src }))); if (na && (d.normal || 0) + (d.mental || 0) > 0) { ctx.emit({ e: "note", text: `${p.name || "Player " + (seat + 1)} takes no damage (${(na.src && na.src.label) || "a field effect"})` }); return; } }   // A4-05 0849 (Revise#344)
    if (!how.byHand && !(how.from && S.battle && S.battle.attacker === how.from)) { const nd = AA4.allMods(S, ctx.db).find(m => m.key === "playerNoDamage" && AA4.modAppliesToSeat(S, m, seat)); if (nd && (d.normal || 0) + (d.mental || 0) > 0) { ctx.emit({ e: "note", text: `${p.name || "Player " + (seat + 1)} takes no damage other than from attacks (${(nd.src && nd.src.label) || "a field effect"})` }); return; } }   // A4-02 0275 (Revise#282): "アタック以外のダメージを受けない"
    if (fromCh) { const nf = AA4.allMods(S, ctx.db).find(m => m.key === "playerNoDamageFrom" && AA4.modAppliesToSeat(S, m, seat) && m.value && AA4.matchChar(S, ctx.db, m.value.sel || {}, how.from, { seat })); if (nf && (d.normal || 0) + (d.mental || 0) > 0) { ctx.emit({ e: "note", text: `${p.name || "Player " + (seat + 1)} takes no damage from this character (${(nf.src && nf.src.label) || "a field effect"})` }); return; } }   // A4-PP PP050 (Revise#340): "≪プレイヤー全て≫はブレイクしていないキャラクターからダメージを受けない"
    if (fromCh && S.battle && S.battle.kind === "attack" && S.battle.attacker === how.from && (d.normal || 0) + (d.mental || 0) > 0) {   // A3-16 2178 (M5a): "キャラクターがプレイヤーにアタックした場合、そのダメージ判定を無効化する" — once
      const an = S.modifiers.find(m => m.key === "attackCheckNull");
      if (an) { ctx.emit({ e: "note", text: `${(an.src && an.src.label) || "A card"}: this damage check is cancelled` }); AA4.endMod(ctx, an.id); return; }
    }
    if (fromCh && fromCh.at.area === "active") for (const m of AA4.allMods(S, ctx.db)) if (m.key === "playerDmgReduce" && AA4.modAppliesToSeat(S, m, seat)) {
      const n = +(m.value && m.value.n) || 0;
      const cut = Math.min(n, d.normal || 0); d = Object.assign({}, d, { normal: (d.normal || 0) - cut, mental: Math.max(0, (d.mental || 0) - (n - cut)) });
    }
    // 鹿島栞 (Revise#131): "≪あなたにアタックしたキャラクター≫の攻撃力にー(X)して判定する" / "通常攻撃力の数値がX以上のキャラクターのアタックを受けた場合、
    // 通常のダメージ判定を行わず、…通常攻撃力の数値から-Xした数値に等しい枚数のカードを、あなたのデッキから捨て札する" (X = that character's power)
    if (fromCh && S.battle && S.battle.attacker === how.from) for (const m of AA4.allMods(S, ctx.db)) {
      if (m.key !== "shioriWard" || !AA4.modAppliesToSeat(S, m, seat) || !m.src || !S.chars[m.src.ch]) continue;
      const X = S.chars[m.src.ch].power.length;
      if (d.mental) d = Object.assign({}, d, { mental: Math.max(0, d.mental - X) });
      if ((d.normal || 0) > 0 && d.normal >= X) {
        const n = d.normal - X, deck = p.zones.deck;
        ctx.emit({ e: "damageReplaced", seat, by: m.src.ch, n });
        for (let i = 0; i < n && deck.length; i++) AA4.moveCard(ctx, deck[deck.length - 1], { z: "discard" });
        d = Object.assign({}, d, { normal: 0 });
      }
    }
    if (!how.guarded && (d.normal || 0) + (d.mental || 0) > 0) {   // EP227 / EX0265 (Revise#157): its owner's damage goes to it instead
      const g = AA4.controlledOf(S, seat).concat(Object.keys(S.chars).filter(id => S.chars[id].owner === seat)).find(id => S.chars[id] && AA4.charStats(S, ctx.db, id).takeForOwner);
      if (g) { const once = S.modifiers.find(m => m.key === "takeForOwner" && m.value && m.value.once && m.to && m.to.ch === g); if (once) AA4.endMod(ctx, once.id);
        const td = AA4.allMods(S, ctx.db).find(m => m.key === "takeForOwner" && m.value && m.value.thenDiscard && m.to && m.to.ch === g && m.src && m.src.card && S.cards[m.src.card] && S.cards[m.src.card].place.z === "char");   // A3-04 0688: "その後、≪このカード≫を捨て札する"
        if (td) AA4.enqueue(S, [{ op: "move", card: td.src.card, to: { z: "discard" } }]); ctx.emit({ e: "damageTaken", by: g, seat }); AA4.damageChar(ctx, g, { normal: d.normal || 0, mental: d.mental || 0, from: how.from, guarded: true }); return; }
    }
    if (!how.guarded && (d.normal || 0) + (d.mental || 0) > 0) { const g = AA4.guardianOf(S, ctx.db, seat, null); if (g) { ctx.emit({ e: "damageTaken", by: g, seat }); AA4.damageChar(ctx, g, { normal: d.normal || 0, mental: d.mental || 0, from: how.from, guarded: true }); return; } }   // ノーラン
    for (const m of AA4.allMods(S, ctx.db).filter(x => x.key === "playerDmgCut" && AA4.modAppliesToSeat(S, x, seat))) {   // "≪あなた≫に与えられるダメージに-X・ー(X)して判定する" (Revise#138)
      if (m.cond && !AA4.checkCond(S, ctx.db, m.cond, { seat: m.src ? m.src.seat : seat, src: m.src, card: m.src && m.src.card })) continue;
      if (m.value && m.value.mentalOnly) { d = Object.assign({}, d, { mental: Math.max(0, (d.mental || 0) - m.value.mentalOnly) }); continue; }   // "…に与えられるダメージにー(1)して判定する" (A3-22 3167, M5a)
      const x = +AA4.modValue(S, ctx.db, m) || 0;
      d = Object.assign({}, d, { normal: Math.max(0, (d.normal || 0) - x), mental: Math.max(0, (d.mental || 0) - x) });
    }
    if ((d.normal || 0) + (d.mental || 0) >= 5 && AA4.allMods(S, ctx.db).some(m => m.key === "dmgCap4")) {   // "≪プレイヤー全て≫の受ける5以上のダメージは4になる" (Revise#138)
      const cut = (d.normal || 0) + (d.mental || 0) - 4, cn = Math.min(cut, d.mental || 0);
      d = Object.assign({}, d, { mental: (d.mental || 0) - cn, normal: (d.normal || 0) - (cut - cn) });
    }
    const total = (d.normal || 0) + (d.mental || 0);
    if (total > 0 && S.turn) { (S.turn.dmgChecked = S.turn.dmgChecked || {})[seat] = true; AA4.touch && AA4.touch(S); }   // EP362 (Revise#157)
    ctx.emit({ e: "playerDamage", seat, normal: d.normal || 0, mental: d.mental || 0, from: how.from || null, byHand: !!how.byHand, fromSeat: how.fromSeat != null ? how.fromSeat : fromCh ? fromCh.owner : null });
    let placed = 0;
    const stopBreak = fromCh && AA4.charStats(S, ctx.db, how.from).stopOnBreak;
    for (let i = 0; i < total; i++) {
      if (!p.zones.deck.length) {   // Q#30: the damage check needs a card from an empty deck → loses
        ctx.emit({ e: "deckOut", seat });
        AA4.enqueue(S, [{ op: "lose", seat, why: "had to take a damage card from an empty deck" }], true);
        break;
      }
      const id = p.zones.deck[p.zones.deck.length - 1], inf = ctx.db.card(S.cards[id].key) || {};
      if (inf.type === "Permanent" && fromCh && AA4.charStats(S, ctx.db, how.from).redoOnPerm && (how.redo || 0) < 20) { how = Object.assign({}, how, { redo: (how.redo || 0) + 1 }); i--; ctx.emit({ e: "damageAgain", seat, by: how.from }); }   // "…ダメージ判定でパーマネントカードがダメージ置き場に置かれた場合、もう一度ダメージ判定する"
      // normal AND mental damage run the damage check (Pack, Revise#092); only "special damage" by hand goes straight to the Damage Pile
      if (!how.direct && inf.type === "Character" && !(inf.name && AA4.nameOnField(S, ctx.db, inf.name))) {
        AA4.moveCard(ctx, id, { z: !inf.name && S.modifiers.some(m => m.key === "dmgCharToControl") ? "back" : "active" });   // A3-24 3504: "…は、そのオーナーの支配キャラクターとしてセットされる"
        ctx.emit({ e: "entered", card: id, seat, ch: AA4.charOfCard(S, id).id, fromDamage: true, byAttackCtl: !!(fromCh && S.battle && S.battle.kind === "attack" && S.battle.attacker === how.from) });   // byAttackCtl: "支配キャラクターのアタックによるダメージ判定で…セットされた場合" (0465, Revise#360)
        if (fromCh && AA4.charStats(S, ctx.db, how.from).killDamageChars) (how.entered = how.entered || []).push(AA4.charOfCard(S, id).id);
      } else {
        S._dmgCheck = true; AA4.moveCard(ctx, id, { z: "damage" }); delete S._dmgCheck; placed++;
        if (inf.dmgStop && !AA4.factorOk(S, ctx.db, seat, inf)) { ctx.emit({ e: "damageStopped", seat, by: id }); AA4.moveCard(ctx, id, { z: "discard" }); break; }   // A3-16 2178 (M5a): "…ダメージ判定はそこで終了する。その後、このカードを捨て札する"
        if (inf.selfSetFromDamage && typeof inf.cost === "number" && !AA4.factorOk(S, ctx.db, seat, inf)) {   // 2865 (Q#55, Revise#150): "…このカードがダメージ判定の結果あなたのダメージ置き場に置かれた場合、≪このカード≫をコストを支払ってあなたの支配キャラクターとしてセットする。…その時点でダメージ判定を終了し、≪そのダメージ判定を行わせたキャラクターと、そのキャラクターまたはカードのオーナー≫にXダメージを与える"
          const payers = AA4.controlledOf(S, seat).sort((x, y) => S.chars[y].power.length - S.chars[x].power.length);
          if (payers.reduce((n, c) => n + S.chars[c].power.length, 0) >= inf.cost) {
            let left = inf.cost;
            for (const c of payers) while (left > 0 && S.chars[c] && S.chars[c].power.length) { AA4.moveCard(ctx, S.chars[c].power[S.chars[c].power.length - 1], { z: "discard" }); left--; }
            AA4.moveCard(ctx, id, { z: "back", seat });
            const nc = AA4.charOfCard(S, id);
            ctx.emit({ e: "entered", card: id, seat, ch: nc && nc.id, fromDamage: true });
            ctx.emit({ e: "damageStopped", seat, by: id });
            const x = nc ? AA4.charStats(S, ctx.db, nc.id).at || 0 : 0, srcSeat = how.fromSeat != null ? how.fromSeat : fromCh ? fromCh.owner : null;
            if (x > 0 && fromCh && S.chars[how.from]) AA4.enqueue(S, [{ op: "extraHit", ch: how.from, d: { normal: x, mental: 0, from: nc && nc.id } }]);
            if (x > 0 && srcSeat != null && srcSeat !== seat) AA4.enqueue(S, [{ op: "themisHit", seat: srcSeat, n: x }]);
            break;
          }
        }
        if (inf.damageToHand && (inf.damageToHand !== "factorMet" || (how.direct ? false : AA4.factorOk(S, ctx.db, seat, inf)))) { AA4.moveCard(ctx, id, { z: "hand" }); ctx.emit({ e: "returnedFromDamage", card: id, seat }); }   // "このカードがダメージ判定でダメージ置き場に置かれた場合、≪このカード≫はオーナーの手札に戻る"; "factorMet": EX0505 (Revise#161)
        if (stopBreak && inf.type === "Break") { ctx.emit({ e: "damageStopped", seat, by: how.from }); break; }   // "…ダメージ判定の手順で、ブレイクカードがダメージ置き場に置かれた場合、ダメージ判定の手順はそこで終了する" (Revise#130)
      }
    }
    if (total > 0 && !placed && fromCh && S.chars[how.from] && AA4.charStats(S, ctx.db, how.from).zeroDmgPower && S.players[fromCh.owner].zones.deck.length)   // "…ダメージ置き場にカードが1枚も置かれなかった場合、…デッキの一番上のカード1枚を引き、≪このキャラクター≫にパワーカードとしてセットすることができる"
      AA4.enqueue(S, [{ op: "zeroDmgAsk", ch: how.from, seat: fromCh.owner }]);
    ctx.emit({ e: "damaged", seat, n: total });
    for (const ch of how.entered || []) if (S.chars[ch]) AA4.defeat(ctx, ch, { why: "set by the damage check of 神馬スレイプニル's character" });   // "≪このキャラクターがプレイヤーに与えたダメージによるダメージ判定でセットされたキャラクター全て≫を捨て札する"
  };

  OPS.sameNameSacGo = (ctx, op) => { const c = (op.answer || [])[0] && AA4.charOfCard(ctx.S, op.answer[0]); if (c) AA4.defeat(ctx, c.id, { why: "discarded instead" }); };
  OPS.keepStackGo = (ctx, op) => { for (const id of op.answer || []) if (ctx.S.cards[id] && ctx.S.cards[id].place.z === "char") AA4.moveCard(ctx, id, { z: "discard" }); };
  OPS.bindHandGo = (ctx, op) => { for (const id of op.answer || []) if (ctx.S.cards[id] && ctx.S.cards[id].place.z === "hand") AA4.moveCard(ctx, id, { z: "damage" }); };
  OPS.bindSacGo = (ctx, op) => {
    const S = ctx.S;
    for (const id of op.answer || []) { const c = S.cards[id]; if (!c) continue; if (c.place.z === "char" && c.place.role === "power") AA4.moveCard(ctx, id, { z: "damage" }); else { const o = AA4.charOfCard(S, id); if (o && o.id !== op.ch) AA4.defeat(ctx, o.id, { why: "discarded for Bind" }); } }
  };
  OPS.zeroDmgAsk = (ctx, op) => {
    const S = ctx.S;
    if (!S.chars[op.ch] || !S.players[op.seat].zones.deck.length) return;
    if (!op.answer) return AA4.ask(ctx, { seat: op.seat, kind: "yesno", reason: "No card went into the Damage Pile: put the top card of your deck on it as a power card?", then: [Object.assign({}, op)] });
    if (op.answer[0] !== "yes") return;
    const d = S.players[op.seat].zones.deck; AA4.moveCard(ctx, d[d.length - 1], { z: "char", ch: op.ch, role: "power" });
  };
  /** By hand (as v3's +1 Normal / +1 Special): damage to yourself from the Deck menu.
      normal = damage check (a Character card → Active Area, others → Damage Pile); special = straight to the Damage Pile. */
  INTENTS.selfDamage = {
    undoable: true,
    check(ctx, it) {
      const S = ctx.S, seat = AA4.seatFor(S, it);
      if (seat == null) return "You are not playing at this table";
      if (S.stage !== "play") return "The game has not started yet";
      if (S.players[seat].lost) return "You are out of the game";
      if (it.ch != null) {   // by hand on a character: X normal and (X) mental damage (Pack, Revise#089)
        const c = S.chars[it.ch];
        if (!c) return "No such character";
        if (!(AA4.isInt(it.normal || 0) && AA4.isInt(it.mental || 0) && (it.normal || 0) >= 0 && (it.mental || 0) >= 0 && (it.normal || 0) + (it.mental || 0) >= 1 && (it.normal || 0) + (it.mental || 0) <= 20)) return "Damage 1 to 20";
        return null;
      }
      if (it.normal != null || it.mental != null) return AA4.isInt(it.normal || 0) && AA4.isInt(it.mental || 0) && (it.normal || 0) + (it.mental || 0) >= 1 && (it.normal || 0) + (it.mental || 0) <= 10 ? null : "1 to 10 damage";
      if (!["normal", "special"].includes(it.kind)) return "Normal or special damage";
      const n = it.n == null ? 1 : it.n;
      return AA4.isInt(n) && n >= 1 && n <= 10 ? null : "1 to 10 damage";
    },
    apply(ctx, it) {
      const seat = AA4.seatFor(ctx.S, it);
      if (it.ch != null) {
        ctx.emit({ e: "byHandDamage", seat, ch: it.ch, normal: it.normal || 0, mental: it.mental || 0 });
        AA4.damageChar(ctx, it.ch, { normal: it.normal || 0, mental: it.mental || 0, battle: false });
        return;
      }
      if (it.normal != null || it.mental != null) {   // X(X): X normal (damage check) + (X) mental (straight to the Damage Pile)
        ctx.emit({ e: "byHandDamage", seat, normal: it.normal || 0, mental: it.mental || 0 });
        AA4.damagePlayer(ctx, seat, { normal: it.normal || 0, mental: it.mental || 0 }, { byHand: true });
        return;
      }
      const n = it.n == null ? 1 : it.n;
      ctx.emit({ e: "byHandDamage", seat, kind: it.kind, n });
      AA4.damagePlayer(ctx, seat, { normal: n, mental: 0 }, { byHand: true, direct: it.kind === "special" });   // special: straight to the Damage Pile
    },
  };

  /** Which damage rules cancel this damage? → the reduced damage. */
  function filterDamage(S, db, chId, d) {
    const st = AA4.charStats(S, db, chId);
    let { normal = 0, mental = 0 } = d;
    const why = [], none = text => { if (normal || mental) why.push(text); normal = 0; mental = 0; };
    const from = d.from && S.chars[d.from] ? AA4.charStats(S, db, d.from) : null;
    if (st.skills.shield && !d.battle) none("Shield — no damage outside a battle");   // in a battle it takes damage as usual, from any character (Pack, Revise#085)
    if (d.battle && from && st.skills.resist) {
      const r = st.skills.resist;   // {factions: [], icons: []}
      if ((r.factions || []).includes(from.faction) || (r.icons || []).some(i => from.icons.includes(i))) none(`Resist ${[].concat(r.factions || [], r.icons || []).join("/")}`);
    }
    for (const n of st.noDamage) {
      const label = n.label ? `${n.label}` : "an effect";
      if (n.fromSrc) { if (d.from && d.from === n.fromCh) none(`no damage from this character (${label})`); continue; }   // "≪このキャラクター≫が▼を持たないキャラクターに与えるダメージは無効化される" (Revise#342)
      if (n.battleNormal) { if (d.battle && normal) { normal = 0; why.push(`no normal battle damage (${label})`); } continue; }   // "バトルによる通常ダメージを受けない"
      if (n.mentalMaxX) { const k = AA4.xOf(S, db, n.mentalMaxX, { ch: chId, seat: S.chars[chId].owner }); if (mental && mental <= k) { mental = 0; why.push(`mental damage ≤ (${k}) (${label})`); } continue; }   // "≪このキャラクター≫は(X)以下のダメージを受けない"
      if (n.mentalMinX) { const k = AA4.xOf(S, db, n.mentalMinX, { ch: chId, seat: S.chars[chId].owner }); if (mental && mental >= k) { mental = 0; why.push(`mental damage ≥ (${k}) (${label})`); } continue; }   // EP425 (Revise#228): "X以上の数値の精神ダメージを受けない"
      if (n.maxX) { const k = AA4.xOf(S, db, n.maxX, { ch: chId, seat: S.chars[chId].owner }); if ((normal || mental) && normal + mental <= k) none(`damage ≤ ${k} (${label})`); continue; }   // A3-05 0762 (Revise#159): "X以下の数値のダメージを受けない"
      if (n.maxPower) { if ((normal || mental) && normal + mental <= S.chars[chId].power.length) none(`damage ≤ its power (${label})`); continue; }   // "パワー以下の数値のダメージを受けない" (Revise#109)
      if (n.whenGuarding) { if (d.battle && S.battle && S.battle.guard === chId) none(`no battle damage while guarding (${label})`); continue; }   // "ガード時にバトルによるダメージを受けない" (Revise#144)
      if (n.whenSynchro) { if (d.battle && S.battle && (S.battle.synchro || []).includes(chId)) none(`no battle damage while in by Synchro (${label})`); continue; }   // "シンクロによるアタック宣言またはガード宣言を行っている場合" (A4-03 0538, Revise#318)
      if (n.oneOnOne) { if (d.battle && AA4.battleOppsOf(S, chId).length === 1) none(`no damage in a one-on-one battle (${label})`); continue; }   // "1人のキャラクターとのバトルによるダメージを受けない"
      if (n.fromFactorLeSelf) {   // "自身の必要ファクター以下の必要ファクターの(ブレイクしている)キャラクターとのバトルによるダメージを受けない" (A3-EXPR EXPR044 / A3-25 3622)
        const fc = id => Object.values((db.card(S.cards[AA4.topOf(S.chars[id])].key) || {}).factor || {}).reduce((a, b) => a + b, 0);
        if (d.battle && d.from && S.chars[d.from] && (!n.fromBroken || S.chars[d.from].stack.length > 1) && fc(d.from) <= fc(chId)) none(`no damage from a character with a required Factor ≤ its own (${label})`); continue; }
      if (n.fromSeLeSelf) { if (d.battle && d.from && S.chars[d.from] && (AA4.charStats(S, db, d.from).se || 0) <= (st.se || 0)) none(`no damage from a character with Mental ≤ its own (${label})`); continue; }   // A3-05 0735 (Revise#161)
      if (n.onlyFromSel) { if (!(d.from && S.chars[d.from] && AA4.matchChar(S, db, n.onlyFromSel, d.from, { seat: S.chars[chId].owner, self: chId }))) none(`damage only from ${n.onlyFromSel.named ? "named characters" : "some characters"} (${label})`); continue; }   // "ネームレベルキャラクター以外からダメージを受けない" (EP451, Revise#311)
      if (n.fromSel) {   // "…とのバトルによるダメージを受けない": only from characters the selector matches
        if (d.battle && d.from && S.chars[d.from] && AA4.matchChar(S, db, n.fromSel, d.from, { seat: S.chars[chId].owner, self: chId, x: S.chars[chId].power.length })) none(`no damage from this character (${label})`);
        continue;
      }
      if ((n.battle && d.battle) || (n.outside && !d.battle) || (!n.battle && !n.outside && !n.mental && !n.normal)) none(`takes no damage (${label})`);
      if (n.mental && mental) { mental = 0; why.push(`no mental damage (${label})`); }
      if (n.normal && normal) { normal = 0; why.push(`no normal damage (${label})`); }
    }
    if (st.dmgReduce.normal && normal) { const k = Math.min(normal, st.dmgReduce.normal); normal -= k; why.push(`${k} less damage`); }   // "…に与えられるダメージにー1して判定する"
    if (st.dmgReduce.mental && mental) { const k = Math.min(mental, st.dmgReduce.mental); mental -= k; why.push(`(${k}) less mental damage`); }
    return { normal, mental, why };
  }
  /** Deal damage to a character. Returns true when it is defeated (or waits to be kept). */
  /** ノーラン・トライアンフ (Revise#136): "このキャラクター以外のあなたの支配キャラクターか、このキャラクターのオーナーに与えられたダメージは、≪このキャラクター≫が代わりに受ける" */
  AA4.guardianOf = (S, db, seat, except) => AA4.controlledOf(S, seat).find(id => id !== except && AA4.charStats(S, db, id).takeForAllies) || null;
  /** エルゼベート (Revise#141): "メインフェイズ終了時まで、目標の≪キャラクター1人≫がアタック宣言またはガード宣言した場合、目標にセットされているパワーカード全てを捨て札する" */
  AA4.declDropPower = (ctx, chId) => {
    const S = ctx.S, ch = S.chars[chId];
    if (!ch || !S.modifiers.some(m => m.key === "declDropPower" && m.to && m.to.ch === chId)) return;
    for (const id of ch.power.slice()) AA4.moveCard(ctx, id, { z: "discard" });
  };
  /** 氷上純 (Revise#142): "メインフェイズ終了時まで、≪このキャラクターのアタック宣言に対してガード宣言するか、このキャラクターにガード宣言されたキャラクターとそのオーナー≫にXダメージを与える" */
  AA4.guardHit = (ctx, atk, grd) => {
    const S = ctx.S;
    if (S.chars[atk] && S.chars[grd] && S.modifiers.some(m => m.key === "guardStrip" && m.to && m.to.ch === atk)) for (const id of S.chars[grd].power.slice()) AA4.moveCard(ctx, id, { z: "hand", seat: S.cards[id].owner });   // A4-02 0280: the guard's power cards go back to the hand
    for (const [me, other] of [[atk, grd], [grd, atk]]) if (S.chars[me] && S.chars[other] && AA4.charStats(S, ctx.db, me).zeroGuardDie && !S.chars[other].power.length) AA4.defeat(ctx, other, { why: "power 0 in a battle with it (3157)" });   // "≪このキャラクターのアタック宣言に対してガード宣言しているか、このキャラクターにガード宣言されている、パワー0のキャラクター≫は捨て札される"
    for (const m of AA4.allMods(S, ctx.db).filter(x => x.key === "guardHitSel")) {   // 焔式 (Revise#143): "≪分類・式神を持つキャラクターのアタック宣言に対してガード宣言するか、分類・式神を持つキャラクターにガード宣言されたキャラクター≫にXダメージを与える"
      const v = m.value || {}, n = v.x ? AA4.xOf(S, ctx.db, v.x, m.src || {}) : +v.n || 0, has = id => S.chars[id] && AA4.charStats(S, ctx.db, id).icons.some(i => (v.icons || []).includes(i));
      if (n > 0 && has(atk) && S.chars[grd]) AA4.damageChar(ctx, grd, { normal: n, mental: 0, from: m.src && m.src.ch, fromSeat: m.src && m.src.seat });
      if (n > 0 && has(grd) && S.chars[atk]) AA4.damageChar(ctx, atk, { normal: n, mental: 0, from: m.src && m.src.ch, fromSeat: m.src && m.src.seat });
    }
    for (const [me, other] of [[atk, grd], [grd, atk]]) for (const m of AA4.allMods(S, ctx.db).filter(x => x.key === "guardHit" && x.to && x.to.ch === me)) {
      if (m.value && m.value.asAttacker && me !== atk) continue;   // A3-01 0205 (Revise#159)
      const n = m.value && m.value.selfAt ? (S.chars[me] ? AA4.charStats(S, ctx.db, me).at || 0 : 0) : m.value && m.value.x ? +AA4.modValue(S, ctx.db, m) || 0 : (m.value && m.value.n) || 0;
      if (!n || !S.chars[other]) continue;
      const owner = S.chars[other].owner;
      const mm = !!(m.value && m.value.mental);   // "(X)ダメージ" (A3-05 0808)
      AA4.damageChar(ctx, other, { normal: mm ? 0 : n, mental: mm ? n : 0, from: me, fromSeat: m.src && m.src.seat });
      if (!(m.value && m.value.noOwner)) AA4.damagePlayer(ctx, owner, { normal: mm ? 0 : n, mental: mm ? n : 0 }, { from: me, fromSeat: m.src && m.src.seat });
    }
  };
  AA4.damageChar = (ctx, chId, d) => {
    const S = ctx.S, db = ctx.db, ch = S.chars[chId];
    if (!ch) return true;
    if (!d.redirected && ((d.normal || 0) + (d.mental || 0)) > 0) {   // Revise#353: damage that somebody else takes instead
      const st0 = AA4.charStats(S, db, chId), src = d.from && S.chars[d.from] ? S.chars[d.from].owner : d.fromSeat != null ? d.fromSeat : null;
      const rf = st0.dmgToSource;   // {mental, nonBattle}: "…に与えられた精神ダメージ(またはバトル以外のダメージ)は、そのダメージを与えたカードのオーナーが代わりに受ける" (PP245, 1630)
      if (rf && src != null && S.players[src] && !S.players[src].lost) {
        const m = d.mental || 0, n = rf.nonBattle && !d.battle ? d.normal || 0 : 0;
        if (m + n > 0) { ctx.emit({ e: "note", text: `${S.players[src].name || "Player " + (src + 1)} takes that damage instead` }); AA4.damagePlayer(ctx, src, { normal: n, mental: m }, { fromSeat: ch.owner }); d = Object.assign({}, d, { mental: 0, normal: (d.normal || 0) - n }); if (!((d.normal || 0) + (d.mental || 0))) return true; }
      }
      if (st0.dmgToOwner) { ctx.emit({ e: "note", text: `${S.players[ch.owner].name || "Player " + (ch.owner + 1)} takes that damage instead of the character` }); AA4.damagePlayer(ctx, ch.owner, { normal: d.normal || 0, mental: d.mental || 0 }, { from: d.from, fromSeat: d.fromSeat }); return true; }   // PP114
    }
    if (!d.prompted && ((d.normal || 0) + (d.mental || 0)) > 0) {   // M2g (Revise#161): "…ダメージを与えられる場合、…ことが可能。そうした場合、…ダメージを受けない" — the owner is asked first
      const st0 = AA4.charStats(S, db, chId);
      if (st0.permDamageShield && ch.perm.length) { AA4.enqueue(S, [{ op: "dmgShieldAsk", ch: chId, d, kind: "perm" }], true); return true; }   // EX0378
      if (st0.nameMillShield && d.from && S.chars[d.from] && AA4.isControlled(S.chars[d.from]) && S.players[ch.owner].zones.deck.length) { AA4.enqueue(S, [{ op: "dmgShieldAsk", ch: chId, d, kind: "mill" }], true); return true; }   // EX0164
    }
    if (d.battle && !d.reflected) { const rf = S.modifiers.find(x => x.key === "reflectNext" && x.to && x.to.ch === chId);   // 3649 (Revise#151): "このキャラクターに次に与えられるバトルによるダメージを無効化し、そのダメージに等しいダメージを、≪このキャラクターのバトル相手≫に与える"
      if (rf && rf.value && rf.value.nullOnly && ((d.normal || 0) + (d.mental || 0)) > 0) { AA4.endMod(ctx, rf.id); ctx.emit({ e: "note", text: "The battle damage is nullified" }); return false; }   // EX830 (Revise#242): "次に与えられるバトルによるダメージを無効化する"
      if (rf && ((d.normal || 0) + (d.mental || 0)) > 0) { AA4.endMod(ctx, rf.id); ctx.emit({ e: "note", text: "The battle damage is reflected" }); for (const o of AA4.battleOppsOf(S, chId)) if (S.chars[o]) AA4.damageChar(ctx, o, Object.assign({}, d, { reflected: true, from: chId })); return false; } }
    { const rm = S.modifiers.find(x => x.key === "redirectNext" && x.to && x.to.ch === chId);   // バロール (Q#48): the next damage to it goes to the chosen character
      if (rm && ((d.normal || 0) + (d.mental || 0)) > 0) { AA4.endMod(ctx, rm.id); const t = rm.value && rm.value.ch; if (t && S.chars[t] && t !== chId) { ctx.emit({ e: "damageTaken", by: t, for: chId }); return AA4.damageChar(ctx, t, Object.assign({}, d, { guarded: true })); } } }
    if (d.battle && !d.merged && d.from && S.chars[d.from] && AA4.isControlled(S.chars[d.from])) for (const m of AA4.allMods(S, db).filter(x => x.key === "battleMentalHit" && AA4.modAppliesToSeat(S, x, S.chars[d.from].owner))) {   // 2225 (Revise#143): "あなたの支配キャラクターがバトルによるダメージを与える場合、≪バトル相手のオーナー≫に(X)ダメージを与える。Xはそのキャラクターの持つ精神攻撃力の数値から、バトル相手にセットされているパワーカードの枚数を引いた値"
      const st = AA4.charStats(S, db, d.from), x = (st.atMental ? st.at || 0 : 0) - ch.power.length;
      if (x > 0 && ch.owner !== S.chars[d.from].owner) AA4.damagePlayer(ctx, ch.owner, { normal: 0, mental: x }, { from: d.from });
    }
    if (d.battle && !d.merged) for (const m of S.modifiers.filter(x => x.key === "mergeDamage" && x.to && x.to.ch === chId)) for (const o of (m.value && m.value.chs) || []) if (S.chars[o]) AA4.damageChar(ctx, o, Object.assign({}, d, { merged: true }));   // G-ブレイブカイザー (Q#40): "バトルの際のダメージは、≪指定したキャラクター≫にも同時に与えられる" — in full to each
    if (((d.normal || 0) + (d.mental || 0)) > 0) { const nx = S.modifiers.find(m => m.key === "negateNext" && m.to && m.to.ch === chId); if (nx) { AA4.endMod(ctx, nx.id); ctx.emit({ e: "note", text: "The damage is negated" }); return true; } }   // EX0182 (Revise#157)
    if (!d.guarded && ((d.normal || 0) + (d.mental || 0)) > 0) { const tf = AA4.allMods(S, db).find(m => m.key === "takeFor" && m.value && m.to && m.to.ch !== chId && S.chars[m.to.ch] && (m.value.ch === chId || ((m.value.name || m.value.icons || m.value.tag) && S.chars[m.to.ch].owner === ch.owner && AA4.isControlled(ch) && (!m.value.name || AA4.charStats(S, db, chId).name === m.value.name) && (!m.value.icons || AA4.charStats(S, db, chId).icons.some(i => m.value.icons.includes(i))) && (!m.value.tag || (AA4.cardInfo(S, db, AA4.topOf(ch)).tags || []).includes(m.value.tag))))); if (tf) { if (tf.value.once && S.modifiers.includes(tf)) AA4.endMod(ctx, tf.id); ctx.emit({ e: "damageTaken", by: tf.to.ch, for: chId }); return AA4.damageChar(ctx, tf.to.ch, Object.assign({}, d, { guarded: true })); } }   // EP164 (Revise#157)
    if (!d.guarded && AA4.isControlled(ch) && ((d.normal || 0) + (d.mental || 0)) > 0) { const g = AA4.guardianOf(S, db, ch.owner, chId); if (g) { ctx.emit({ e: "damageTaken", by: g, for: chId }); return AA4.damageChar(ctx, g, Object.assign({}, d, { guarded: true })); } }
    { const st0 = AA4.charStats(S, db, chId);   // ォミーシス (Q#39, Revise#142): "このキャラクターに与えられたバトル以外のダメージは、≪そのダメージを与えたカードもしくはキャラクターのオーナー≫が代わりに受ける。その後、そのプレイヤーにXダメージを与える"
      const srcSeat = d.fromSeat != null ? d.fromSeat : d.from && S.chars[d.from] ? S.chars[d.from].owner : null;
      if (st0.dmgBackToSource && !d.battle && srcSeat != null && S.players[srcSeat] && ((d.normal || 0) + (d.mental || 0)) > 0) {
        ctx.emit({ e: "damageTaken", by: "player:" + srcSeat, for: chId });
        AA4.damagePlayer(ctx, srcSeat, { normal: d.normal || 0, mental: d.mental || 0 }, { from: chId });
        if (st0.at > 0) AA4.damagePlayer(ctx, srcSeat, { normal: st0.at, mental: 0 }, { from: chId });
        return false;
      } }
    if (AA4.charStats(S, db, chId).dmgToOwner === "all" && ((d.normal || 0) + (d.mental || 0)) > 0) {   // "このキャラクターに与えられたダメージは、≪あなた≫が代わりに受ける"
      AA4.damagePlayer(ctx, ch.owner, { normal: d.normal || 0, mental: d.mental || 0 }, { from: d.from });
      return false;
    }
    if (d.battle && (d.normal || 0) > 0 && AA4.charStats(S, db, chId).dmgToOwner) {   // "…にバトルによって与えられた通常ダメージは、目標のオーナーが代わりに受ける" (Revise#109)
      AA4.damagePlayer(ctx, ch.owner, { normal: d.normal, mental: 0 }, { from: d.from });
      d = Object.assign({}, d, { normal: 0 });
      if (!(d.mental || 0)) return false;
    }
    if ((d.mental || 0) > 0 && AA4.charStats(S, db, chId).millForMental) {   // 3688 (Revise#151): "精神ダメージが与えられる場合、その数値に等しい枚数のカードを、あなたのデッキの上から捨て札する。そうした場合、精神ダメージを受けない"
      const deck = S.players[ch.owner].zones.deck;
      if (deck.length >= d.mental) { for (let i = 0; i < d.mental; i++) AA4.moveCard(ctx, deck[deck.length - 1], { z: "discard" }); ctx.emit({ e: "note", text: `${d.mental} card(s) milled instead of the mental damage` }); d = Object.assign({}, d, { mental: 0 }); if (!(d.normal || 0)) return false; }
    }
    const { normal, mental, why: cancelled } = filterDamage(S, db, chId, d);
    if (d.battle && (normal || mental) && d.from && S.chars[d.from] && AA4.charStats(S, db, d.from).chargeLock) {   // ゲイ・ボウ: no power cards until the end of its owner's next turn
      const o = S.chars[d.from].owner;
      AA4.addMod(ctx, { src: { seat: o, ch: d.from, label: "ゲイ・ボウ" }, to: { ch: chId }, key: "noCharge", op: "grant", value: true, until: "seatTurn", untilSeat: o, skip: S.turn.player === o ? 1 : 0 });
    }
    if ((normal || mental) && d.from && S.chars[d.from]) for (const t of AA4.charStats(S, db, d.from).hurtMark || [])   // "メインフェイズ終了時まで、≪このキャラクターからダメージを受けたキャラクター≫は…" (Revise#136)
      AA4.addMod(ctx, { src: { seat: S.chars[d.from].owner, ch: d.from, card: AA4.topOf(S.chars[d.from]), label: AA4.cardName(db.card(S.cards[AA4.topOf(S.chars[d.from])].key)) }, to: { ch: chId }, key: t.key, op: t.op || "grant", value: t.value, until: t.until || "main" });
    if (normal || mental) for (const m of S.modifiers.filter(x => x.to && x.to.ch === chId && x.value && x.value.endOnDamage)) AA4.endMod(ctx, m.id);   // "目標がダメージを受けた場合、このエフェクトの効果は終了する"
    const st = AA4.charStats(S, db, chId), why = [];
    const result = [];
    if (mental) result.push(AA4.isControlled(ch) ? `mental ${mental} vs ${ch.power.length} power card${ch.power.length === 1 ? "" : "s"}` : `mental ${mental} vs Mental ${st.se || 0}`);
    if (normal) result.push(`damage ${normal} vs Defense ${st.de || 0}`);
    // Mental damage (Pack, Q#65 / Revise#165): ≤ power → that many power cards are discarded; > power → none are discarded and it is defeated.
    // A character with Bind is not defeated by mental damage and loses no power card in that case ("only in case it is defeated").
    // An Active Character: mental ≥ its Mental → defeated (Bind protects it too).
    // Pack (Revise#206): Bind does not stop mental damage by itself — the character is defeated, and Bind X is the way to keep it: pay X power cards to the Damage Pile (keepOptions)
    const hasBind = false, mentalKills = mental > 0 && (AA4.isControlled(ch) ? mental > ch.power.length : mental >= (st.se || 0));
    ctx.emit({ e: "damaged", ch: chId, from: d.from || null, fromSeat: d.fromSeat != null ? d.fromSeat : null, normal, mental, battle: !!d.battle, asked: { normal: d.normal || 0, mental: d.mental || 0 }, cancelled, result,
      survives: !((mentalKills && !hasBind) || (normal && normal >= (st.de || 0))) });
    if (mental) {
      if (AA4.isControlled(ch) && !mentalKills) { for (const id of ch.power.slice(-mental)) AA4.moveCard(ctx, id, { z: "discard" }); }
      else if (mentalKills && !hasBind) why.push(AA4.isControlled(ch) ? `mental ${mental} > ${ch.power.length} power cards` : `mental ${mental} ≥ Mental ${st.se || 0}`);
    }
    if (normal && normal >= (st.de || 0)) why.push(`damage ${normal} ≥ Defense ${st.de || 0}`);
    if (!why.length) return false;
    AA4.defeat(ctx, chId, { battle: !!d.battle, why: why.join(", "), by: d.from || null, bySeat: d.fromSeat != null ? d.fromSeat : null, mentalKill: why.some(w => w.startsWith("mental")) });
    return true;
  };

  /* ---------- defeated, with the replacement layer ---------- */
  /** Ways to keep a character that would leave (Bind X, replacement abilities from the card database). */
  AA4.keepOptions = (S, db, chId, how) => {
    const ch = S.chars[chId], st = AA4.charStats(S, db, chId), out = [];
    const bind = typeof st.skills.bind === "number" ? st.skills.bind : 0;
    for (const n of (bind ? [...new Set((st.bindList || []).filter(x => x > 0).concat(st.bindList && st.bindList.length ? [] : [bind]))].sort((x, y) => x - y) : [])) if (ch.power.length >= n) out.push({ k: "bind", n, label: `Bind ${n}: ${n} power card${n === 1 ? "" : "s"} → Damage Pile` });   // each Bind X by itself (Pack, Revise#372)
    for (const m of AA4.allMods(S, db).filter(x => x.key === "tokenKeep" && x.src && x.src.seat === ch.owner && AA4.isControlled(ch))) {   // 3614 (Revise#147): "≪あなたの支配キャラクター≫が捨て札される場合、あなたの支配エリアのヒマワリ1人を捨て札することで、そのキャラクターを場に残すことが可能"
      if (m.value.icons && !st.icons.some(i => m.value.icons.includes(i))) continue;
      const alt = AA4.controlledOf(S, ch.owner).filter(id => id !== chId && !S.chars[id].flags.dying && (m.value.name ? AA4.charStats(S, db, id).tokenName === m.value.name : AA4.charStats(S, db, id).icons.some(i => m.value.icons.includes(i))));
      if (alt.length && !out.some(o => o.k === "sameNameSac")) out.push({ k: "sameNameSac", alt, label: `Discard a ${m.value.name || m.value.icons.join(" / ")} instead` });
    }
    if (st.name && AA4.allMods(S, db).some(m => m.key === "sameNameKeep" && m.value && m.value.name === st.name)) {   // 迦陵頻伽 2303 (Revise#143): "≪このカードと同じネームを持つキャラクター≫が捨て札になる場合、…同じネームを持つ、別の自分の支配キャラクターを代わりに捨て札することで、そのキャラクターを場に残すことが可能"
      const alt = AA4.controlledOf(S, ch.owner).filter(id => id !== chId && !S.chars[id].flags.dying && AA4.charStats(S, db, id).name === st.name);
      if (alt.length) out.push({ k: "sameNameSac", alt, label: `Discard another “${st.name}” instead` });
    }
    if (bind && st.bindHand && S.players[ch.owner].zones.hand.length >= bind) out.push({ k: "bindHand", n: bind, label: `Bind ${bind}: ${bind} hand card${bind === 1 ? "" : "s"} → Damage Pile` });   // "このキャラクターのバインドの支払いをあなたの手札から行うことが可能" (Revise#143)
    if (bind && st.bindSac && ch.power.length + AA4.controlledOf(S, ch.owner).filter(id => id !== chId).length >= bind) out.push({ k: "bindSac", n: bind, label: `Bind ${bind}: power cards and / or your other Controlled Characters (discarded), ${bind} in all` });   // クローディア (Revise#137)
    for (const m of S.modifiers.filter(x => x.key === "keepByPower" && x.to && x.to.ch === chId && x.src && S.chars[x.src.ch] && S.chars[x.src.ch].power.length)) out.push({ k: "keepByPower", from: m.src.ch, label: "Discard a power card of " + ((m.src && m.src.label) || "that character") });   // A3-03 0480 (Revise#159)
    { const kn = AA4.isControlled(ch) && S.modifiers.find(m => m.key === "keepNext" && m.src && m.src.seat === ch.owner && m.src.ch !== chId);   // EX0396 (Revise#157): "次に≪このキャラクター以外のあなたの支配キャラクター≫が捨て札される場合、そのキャラクターを場に残す"
      if (kn) out.push({ k: "keepNext", mod: kn.id, label: "It stays (" + ((kn.src && kn.src.label) || "an effect") + ")" }); }
    for (const m of AA4.allMods(S, db).filter(x => x.key === "keepMill" && AA4.modAppliesToChar(S, db, x, chId))) {   // 3510 / 3543 (Revise#180): "デッキの上からカードをN枚捨て札する / ダメージ置き場に置くことで、そのキャラクターを場に残す"
      const v = m.value || {}, seat = v.deck === "src" && m.src && m.src.seat != null ? m.src.seat : ch.owner;
      if (v.byOppEffect && (how.battle || how.bySeat == null || how.bySeat === (m.src && m.src.seat != null ? m.src.seat : ch.owner))) continue;
      if (v.battleCtl && !(how.battle && ((how.by && S.chars[how.by] && AA4.isControlled(S.chars[how.by])) || AA4.battleOppsOf(S, chId).some(o => S.chars[o] && AA4.isControlled(S.chars[o]))))) continue;
      if (!S.players[seat] || S.players[seat].zones.deck.length < (v.n || 1)) continue;
      out.push({ k: "keepMill", seat, n: v.n || 1, dest: v.dest || "discard", label: `${v.n || 1} card${(v.n || 1) === 1 ? "" : "s"} from the top of ${S.players[seat].name}'s Deck → ${v.dest === "damage" ? "Damage Pile" : "Discard Pile"}` });
    }
    if (AA4.isControlled(ch)) for (const m of AA4.allMods(S, db).filter(x => x.key === "sacSelfKeep" && x.src && x.src.ch && x.src.ch !== chId && S.chars[x.src.ch] && !S.chars[x.src.ch].flags.dying && S.chars[x.src.ch].owner === ch.owner && AA4.modAppliesToSeat(S, x, ch.owner)))   // A4-03 0440 (Revise#287): "このキャラクターを捨て札することで、そのキャラクターを場に残す"
      out.push({ k: "sacSelfKeep", from: m.src.ch, label: `Discard ${AA4.cardName(db.card(S.cards[AA4.topOf(S.chars[m.src.ch])].key))} instead` });
    if (ch.stack.length > 1 && S.modifiers.some(x => x.key === "keepByStack" && x.to && x.to.ch === chId)) out.push({ k: "keepByStack", label: "Discard one of its cards instead" });
    for (const m of S.modifiers.filter(x => x.key === "keepByCard" && x.to && x.to.ch === chId && x.src && x.src.card && S.cards[x.src.card] && ["special", "declared"].includes(S.cards[x.src.card].place.z) && !(x.value && x.value.perm && !ch.perm.length) && !(x.value && x.value.battleOnly && !(how && how.battle))))   // "目標が捨て札になる場合、このカードを捨て札することで目標を場に残す" (A3-14 2003, Revise#170)
      out.push({ k: "keepByCard", card: m.src.card, perm: !!(m.value && m.value.perm), label: `Discard ${m.value && m.value.perm ? "a Permanent card of it and " : ""}${AA4.cardName(db.card(S.cards[m.src.card].key))} instead` });
    if (ch.perm.length && AA4.allMods(S, db).some(m => m.key === "permKeep")) out.push({ k: "permKeep", label: `its ${ch.perm.length} Permanent card${ch.perm.length === 1 ? "" : "s"} → Damage Pile` });   // モルガン・ル・フェイ (Revise#131)
    if (AA4.isControlled(ch)) for (const m of AA4.allMods(S, db).filter(x => x.key === "demonKeep" && x.src && x.src.ch && S.chars[x.src.ch] && x.src.ch !== chId && (S.chars[x.src.ch].owner === ch.owner || (x.value && x.value.power0)) && S.chars[x.src.ch].power.length)) {
      if (m.value && m.value.power0) { if (!ch.power.length) { out.push({ k: "demonKeep", from: m.src.ch, label: `1 power card of ${AA4.cardName(db.card(S.cards[AA4.topOf(S.chars[m.src.ch])].key))} → Damage Pile` }); break; } continue; }   // "≪パワー0のキャラクター≫が捨て札される場合…" (Revise#138)   // 真理亜・ファウスト: its power card pays for your 悪魔 / 悪魔♂
      if ((st.icons || []).some(i => ((m.value && m.value.icons) || ["悪魔", "悪魔♂"]).includes(i))) { out.push({ k: "demonKeep", from: m.src.ch, label: `1 power card of ${AA4.cardName(db.card(S.cards[AA4.topOf(S.chars[m.src.ch])].key))} → Damage Pile` }); break; }
    }
    for (const id of ch.stack.concat(ch.perm)) {
      if (ch.stack.includes(id) && AA4.topOf(ch) !== id) continue;
      const inf = db.card(S.cards[id].key) || {};
      (inf.abilities || []).forEach((ab, i) => {
        if (ab.kind !== "replace" || ab.when !== "leave") return;
        if (ab.battleOnly && !how.battle) return;
        if (ab.outsideOnly && how.battle) return;
        if (ab.byOppOnly && !(how.bySeat != null && how.bySeat !== ch.owner)) return;   // "対戦相手が使用した…の効果によって" (Revise#171)
        const pay = ab.pay || {};
        if (pay.power && ch.power.length < pay.power) return;
        if (pay.perm && !ch.perm.length) return;
        out.push({ k: "ability", card: id, i, label: `${AA4.cardName(inf)}: ${ab.label || ab.text || "keep it"}` });
      });
    }
    return out;
  };
  /** Defense of a character counting only effects that last beyond this battle. */
  function defenseOutsideBattle(S, db, chId) {
    const ch = S.chars[chId], top = db.card(S.cards[AA4.topOf(ch)].key) || {};
    let de = top.de == null ? null : +top.de;
    if (de == null) return null;
    for (const pid of ch.perm) { const pc = db.card(S.cards[pid].key) || {}; if (pc.statMods && pc.statMods.de) de += pc.statMods.de; }
    for (const m of AA4.allMods(S, db)) {
      if (m.key !== "de" || m.until === "battle" || !AA4.modAppliesToChar(S, db, m, chId)) continue;
      de = m.op === "set" ? +m.value : de + +m.value;
    }
    return de;
  }
  AA4.defeat = (ctx, chId, how = {}) => {
    const S = ctx.S, ch = S.chars[chId];
    if (!ch || ch.flags.dying) return;
    if (how.battle && how.to !== "damage" && AA4.battleOppsOf(S, chId).some(o => S.chars[o] && AA4.charStats(S, ctx.db, o).battleKillTo)) how = Object.assign({}, how, { to: "damage", allTo: true });
    if (how.battle && !how.split && AA4.battleOppsOf(S, chId).some(o => S.chars[o] && AA4.charStats(S, ctx.db, o).battleKillSplit)) how = Object.assign({}, how, { split: true });   // 2253 (Revise#150): its Break cards → the owner's hand, its Character cards → the owner's Damage Pile   // "≪このキャラクターとのバトルによって捨て札されるキャラクターを構成するカード全て≫を、そのオーナーのダメージ置き場に置く"
    if (how.battle && AA4.battleOppsOf(S, chId).some(o => S.chars[o] && AA4.charStats(S, ctx.db, o).battleSpare)) {   // "≪このキャラクターとのバトルによって捨て札になるキャラクター≫は、捨て札されず、…勢力パーティの一番上に移動する" (Revise#109)
      for (const id of ch.perm.concat(ch.power)) AA4.moveCard(ctx, id, { z: "discard" });
      ctx.emit({ e: "notDiscarded", ch: chId, why: "battle: to the top of its faction party instead" });
      if (S.chars[chId]) OPS.moveChar(ctx, { ch: chId, to: { area: "active" } });
      return;
    }
    const nd = AA4.charStats(S, ctx.db, chId).noDiscard;   // "≪このキャラクター≫はバトル以外で捨て札されない"
    if (nd && nd.outside && !how.battle) { ctx.emit({ e: "notDiscarded", ch: chId, why: how.why || "" }); return; }
    const opts = how.noKeep || AA4.charStats(S, ctx.db, chId).noKeep || (how.by && S.chars[how.by] && (v => v === true || (v === "battle" && how.battle))(AA4.charStats(S, ctx.db, how.by).noKeepVictims)) || AA4.allMods(S, ctx.db).some(m => m.key === "noKeepAll") ? [] : AA4.keepOptions(S, ctx.db, chId, how);   // ニーズヘッグ: "キャラクターが捨て札される場合、≪そのキャラクターを場に残す効果全て≫を無効化する" (Revise#134)   // "このキャラクターが与えるダメージによって捨て札されるキャラクターを場に残す効果全て≫を無効化する"
    if (!opts.length) { AA4.removeChar(ctx, chId, how); return; }
    ch.flags.dying = true;
    ctx.emit({ e: "wouldLeave", ch: chId, owner: ch.owner, why: how.why || "", options: opts.map(o => o.label) });
    AA4.ask(ctx, { seat: ch.owner, kind: "pick", options: ["let"].concat(opts.map((_, i) => "keep" + i)),
      labels: ["Let it go"].concat(opts.map(o => "Keep — " + o.label)), reason: `${how.why || "It would leave the field"}: keep it?`, ref: { ch: chId },
      then: [{ op: "keepOrLet", ch: chId, how, opts }] });
  };
  OPS.dmgShieldAsk = (ctx, op) => {
    const S = ctx.S, ch = S.chars[op.ch]; if (!ch) return;
    const go = Object.assign({}, op.d, { prompted: true });
    if (op.kind === "perm") {
      if (!ch.perm.length) return AA4.damageChar(ctx, op.ch, go);
      return AA4.ask(ctx, { seat: ch.owner, kind: "cards", options: ch.perm.slice(), min: 0, max: 1, auto: false, ref: { ch: op.ch }, reason: `${(op.d.normal || 0) + (op.d.mental || 0)} damage to it: you may discard one of its Permanent cards to take no damage`, then: [{ op: "dmgShieldGo", ch: op.ch, d: go, kind: "perm" }] });
    }
    const names = [...new Set(Object.values(S.cards).filter(c => c.owner === ch.owner).map(c => ((ctx.db.card(c.key) || {}).jp || "").replace(/\s+/g, "")).filter(Boolean))].sort();
    return AA4.ask(ctx, { seat: ch.owner, kind: "pick", options: ["__no__"].concat(names), labels: ["Don't name a card"].concat(names.map(n => { const inf = ctx.db.all().find(x => (x.jp || "").replace(/\s+/g, "") === n); return inf && inf.en ? `${inf.en} · ${n}` : n; })), ref: { ch: op.ch }, reason: "It takes damage from a Controlled Character: you may name a card — the top 5 cards of your deck are discarded; if the named card is among them, it takes no damage", then: [{ op: "dmgShieldGo", ch: op.ch, d: go, kind: "mill" }] });
  };
  OPS.dmgShieldGo = (ctx, op) => {
    const S = ctx.S, ch = S.chars[op.ch]; if (!ch) return;
    const a = (op.answer || [])[0];
    if (op.kind === "perm") { if (a && S.cards[a] && S.cards[a].place.ch === op.ch) { AA4.moveCard(ctx, a, { z: "discard" }); ctx.emit({ e: "note", text: "A Permanent card was discarded: no damage" }); return; } return AA4.damageChar(ctx, op.ch, op.d); }
    if (!a || a === "__no__") return AA4.damageChar(ctx, op.ch, op.d);
    const deck = S.players[ch.owner].zones.deck, gone = [];
    for (let k = 0; k < 5 && deck.length; k++) { const id = deck[deck.length - 1]; gone.push(id); AA4.moveCard(ctx, id, { z: "discard" }); }
    const hit = gone.some(id => ((ctx.db.card(S.cards[id].key) || {}).jp || "").replace(/\s+/g, "") === a);
    ctx.emit({ e: "note", text: hit ? "The named card was among them: no damage" : "The named card was not among them" });
    if (!hit) return AA4.damageChar(ctx, op.ch, op.d);
  };
  OPS.keepOrLet = (ctx, op) => {
    const S = ctx.S, ch = S.chars[op.ch];
    if (!ch) return;
    ch.flags.dying = false;
    const pick = op.answer && op.answer[0];
    if (!pick || pick === "let") { AA4.removeChar(ctx, op.ch, op.how); return; }
    const o = op.opts[+pick.slice(4)];
    if (o.k === "keepMill") { const deck = S.players[o.seat].zones.deck; for (let k = 0; k < o.n && deck.length; k++) AA4.moveCard(ctx, deck[deck.length - 1], { z: o.dest }); ctx.emit({ e: "keptOnField", ch: op.ch, how: o.label }); return; }   // Revise#180
    if (o.k === "bindSac") {
      const opts = ch.power.slice().concat(AA4.controlledOf(S, ch.owner).filter(id => id !== op.ch).map(id => AA4.topOf(S.chars[id])));
      ctx.emit({ e: "keptOnField", ch: op.ch, how: o.label });
      return AA4.ask(ctx, { seat: ch.owner, kind: "cards", options: opts, min: o.n, max: o.n, reason: `Bind ${o.n}: choose power cards (→ Damage Pile) and / or Controlled Characters (discarded)`, then: [{ op: "bindSacGo", ch: op.ch }] });
    }
    if (o.k === "sameNameSac") {
      const alt = o.alt.filter(id => S.chars[id]);
      ctx.emit({ e: "keptOnField", ch: op.ch, how: o.label });
      if (alt.length === 1) { AA4.defeat(ctx, alt[0], { why: "discarded instead" }); return; }
      return AA4.ask(ctx, { seat: ch.owner, kind: "cards", options: alt.map(id => AA4.topOf(S.chars[id])), min: 1, max: 1, reason: "Choose the character discarded instead", then: [{ op: "sameNameSacGo" }] });
    }
    if (o.k === "keepByStack") {   // "目標のオーナーは目標を構成するカード1枚を捨て札することで、目標を場に残す" (A3-21 2913, Revise#171)
      ctx.emit({ e: "keptOnField", ch: op.ch, how: o.label });
      const opts = ch.stack.filter(id => id !== AA4.topOf(ch));
      return AA4.ask(ctx, { seat: ch.owner, kind: "cards", options: opts, min: 1, max: 1, reason: "Choose a card of it to discard", then: [{ op: "keepStackGo" }] });
    }
    if (o.k === "bindHand") {
      ctx.emit({ e: "keptOnField", ch: op.ch, how: o.label });
      return AA4.ask(ctx, { seat: ch.owner, kind: "cards", options: S.players[ch.owner].zones.hand.slice(), min: o.n, max: o.n, auto: false, reason: `Bind ${o.n}: choose hand cards → your Damage Pile`, then: [{ op: "bindHandGo" }] });
    }
    if (o.k === "keepByCard") { if (o.perm && ch.perm.length) AA4.moveCard(ctx, ch.perm[ch.perm.length - 1], { z: "discard" }); if (S.cards[o.card] && ["special", "declared"].includes(S.cards[o.card].place.z)) { for (const m of S.modifiers.filter(y => y.src && y.src.card === o.card)) AA4.endMod(ctx, m.id); AA4.moveCard(ctx, o.card, { z: "discard" }); } }
    else if (o.k === "keepByPower") { const f = S.chars[o.from]; if (f && f.power.length) AA4.moveCard(ctx, f.power[f.power.length - 1], { z: "discard" }); }
    else if (o.k === "sacSelfKeep") { if (S.chars[o.from]) AA4.defeat(ctx, o.from, { why: "discarded to keep another character" }); }
    else if (o.k === "keepNext") { if (S.modifiers.some(m => m.id === o.mod)) AA4.endMod(ctx, o.mod); }
    else if (o.k === "permKeep") { for (const id of ch.perm.slice()) AA4.moveCard(ctx, id, { z: "damage" }); }
    else if (o.k === "demonKeep") { const f = S.chars[o.from]; if (f && f.power.length) AA4.moveCard(ctx, f.power[f.power.length - 1], { z: "damage" }); }
    else if (o.k === "bind") {
      for (const id of ch.power.slice(-o.n)) AA4.moveCard(ctx, id, { z: "damage" });
      if (o.n === 1 && AA4.charStats(S, ctx.db, op.ch).bindRecycle) {   // "このキャラクターのバインド1のスキルを使用した場合、≪あなたの捨て札置き場の一番上のカード1枚≫をあなたのデッキの一番上に置く" (Revise#126)
        const dp = S.players[ch.owner].zones.discard;
        if (dp.length) AA4.moveCard(ctx, dp[dp.length - 1], { z: "deck", seat: ch.owner });
      }
    } else {
      const inf = ctx.db.card(S.cards[o.card].key) || {}, ab = inf.abilities[o.i], pay = ab.pay || {};
      if (pay.power) for (const id of ch.power.slice(-pay.power)) AA4.moveCard(ctx, id, { z: pay.powerTo || "damage" });
      if (pay.perm) for (const id of ch.perm.slice(pay.perm === "all" ? 0 : -1)) AA4.moveCard(ctx, id, { z: pay.permTo || "discard" });
      if (pay.self && S.chars[op.ch]) AA4.moveCard(ctx, o.card, { z: pay.self });
      if (pay.manual) ctx.emit({ e: "manual", card: o.card, text: ab.text || "" });
    }
    ctx.emit({ e: "keptOnField", ch: op.ch, how: o.label });
    if (!S.chars[op.ch]) return;
    if (/Defense/.test(op.how.why || "") && op.how.defense0) {
      const de = defenseOutsideBattle(S, ctx.db, op.ch);
      if (de != null && de <= 0) { ctx.emit({ e: "keptAnyway", ch: op.ch }); AA4.removeChar(ctx, op.ch, op.how); return; }   // the 0 lasts: defeated anyway
      S.chars[op.ch].flags.zeroSafe = true;   // 0 only in this battle: safe until the battle ends
    }
  };

  /* ---------- state check ---------- */
  AA4.STATE_CHECKS.push(ctx => {   // 3194 (Revise#149): "このキャラクターのパワーが0の場合、≪このキャラクター≫を捨て札する"
    const S = ctx.S;
    if (S.stage !== "play") return false;
    for (const ch of Object.values(S.chars)) if (!ch.flags.dying && !ch.power.length && AA4.charStats(S, ctx.db, ch.id).zeroPowerDie) { AA4.defeat(ctx, ch.id, { why: "power 0" }); return true; }
    for (const ch of Object.values(S.chars)) if (!ch.flags.dying && !ch.power.length) { const id = (AA4.charStats(S, ctx.db, ch.id).zeroPowerCards || []).find(c => ch.perm.includes(c)); if (id) { ctx.emit({ e: "note", text: `${AA4.cardName(ctx.db.card(S.cards[id].key))} is discarded (power 0)` }); AA4.moveCard(ctx, id, { z: "discard" }); return true; } }   // A3-PP PP075 (Revise#342)
    return false;
  });
  AA4.STATE_CHECKS.push(ctx => {   // テミス (Q#47, Revise#146): hand cards discarded → that much damage; over the hand limit → discard down at once (checked every time a hand grows)
    const S = ctx.S, db = ctx.db;
    if (S.stage !== "play") return false;
    if (S.handHit) { const hh = S.handHit; S.handHit = null; let any = false; for (const [seat, n] of Object.entries(hh)) if (n > 0 && S.players[+seat] && !S.players[+seat].lost) { AA4.enqueue(S, [{ op: "themisHit", seat: +seat, n }]); any = true; } if (any) return true; }
    if (S.decisions.some(d => d.themis)) return false;
    for (const p of S.players) {
      if (p.lost || !AA4.seatHas(S, db, p.seat, "handCapNow")) continue;
      const lim = AA4.playerStats(S, db, p.seat).handLimit, n = p.zones.hand.length - lim;
      if (n > 0) { AA4.enqueue(S, [{ op: "themisCap", seat: p.seat, n }]); return true; }
    }
    return false;
  });
  OPS.themisHit = (ctx, op) => AA4.damagePlayer(ctx, op.seat, { normal: op.n, mental: 0 }, {});
  OPS.themisCap = (ctx, op) => {
    const p = ctx.S.players[op.seat], n = Math.min(op.n, p.zones.hand.length);
    if (n <= 0 || ctx.S.decisions.some(d => d.themis)) return;
    const d = AA4.ask(ctx, { seat: op.seat, kind: "cards", options: p.zones.hand.slice(), min: n, max: n, auto: false, reason: `Over the hand limit: discard ${n} (テミス)`, then: [{ op: "toDiscard", seat: op.seat }] });
    const last = ctx.S.decisions[ctx.S.decisions.length - 1]; if (last) last.themis = true;
    return d;
  };
  /** "≪自分の使用した効果で手札にカードを加えたプレイヤー≫に、増えた手札枚数に等しいダメージを与える" — a Project / Fast card or effect the player used (not an ability) */
  OPS.handGainCheck = (ctx, op) => { const p = ctx.S.players[op.seat]; if (!p || p.lost) return; const n = p.zones.hand.length - op.before; if (n > 0) AA4.damagePlayer(ctx, op.seat, { normal: n, mental: 0 }, {}); };
  AA4.STATE_CHECKS.push(ctx => {   // "≪パワー0でかつ、アタック宣言またはガード宣言している状態になったキャラクター≫は、そのオーナーの手札に戻る" (ブラックホール・ジェネレーター)
    const S = ctx.S, b = S.battle;
    if (!b || !S.modifiers.some(m => m.key === "zeroBattleBounce")) return false;
    const ids = [b.attacker, b.guard].concat(b.joined.att, b.joined.grd).filter(id => id && S.chars[id] && !S.chars[id].power.length);
    if (!ids.length) return false;
    for (const id of ids) AA4.removeChar(ctx, id, { to: "hand", why: "power 0 while attacking / guarding (ブラックホール・ジェネレーター)" });
    return true;
  });
  AA4.STATE_CHECKS.push(ctx => {   // "≪パワーが精神力に等しいキャラクターを構成するブレイクカード全て≫を捨て札する" (ファラオ“センウセルト”, Revise#118): not its own character
    const S = ctx.S, mods = AA4.allMods(S, ctx.db).filter(m => m.key === "breakStrip");
    if (!mods.length) return false;
    let any = false;
    for (const ch of Object.values(S.chars)) {
      if (mods.every(m => m.src && m.src.ch === ch.id)) continue;
      if (ch.power.length !== AA4.charStats(S, ctx.db, ch.id).se) continue;
      const brk = ch.stack.slice(1).filter(id => AA4.cardInfo(S, ctx.db, id).type === "Break");
      for (const id of brk.reverse()) if (S.chars[ch.id]) { AA4.moveCard(ctx, id, { z: "discard" }); any = true; }
    }
    return any;
  });
  AA4.STATE_CHECKS.push(ctx => {   // "≪パワー0のキャラクターにセットされているパーマネントカード全て≫を捨て札する" (Revise#131)
    const S = ctx.S;
    if (S.stage !== "play" || !AA4.allMods(S, ctx.db).some(m => m.key === "permZeroPower")) return false;
    let any = false;
    for (const ch of Object.values(S.chars)) if (!ch.power.length && ch.perm.length) { for (const id of ch.perm.slice()) AA4.moveCard(ctx, id, { z: "discard" }); any = true; }
    return any;
  });
  AA4.STATE_CHECKS.push(ctx => {   // lose conditions
    const S = ctx.S;
    if (S.stage !== "play") return false;
    for (const p of S.players) {
      if (p.lost) continue;
      const lim = AA4.LOSE_DAMAGE + AA4.allMods(S, ctx.db).filter(m => m.key === "lossPlusP" && AA4.modAppliesToSeat(S, m, p.seat)).reduce((n, m) => n + (+m.value || 0), 0) + AA4.charsOf(S, p.seat).reduce((n, id) => { const st = AA4.charStats(S, ctx.db, id); return n + (st.lossPlus ? Math.max(0, st.se || 0) : 0) + (st.lossPlusN || 0); }, 0)
        - Object.keys(S.chars).filter(id => S.chars[id].owner !== p.seat).reduce((n, id) => { const v = AA4.charStats(S, ctx.db, id).lossMinusOpp; return n + (v ? AA4.xOf(S, ctx.db, v, { seat: S.chars[id].owner, ch: id, card: AA4.topOf(S.chars[id]) }) : 0); }, 0);   // 3650 (Revise#152): "≪対戦相手全て≫のダメージ置き場のカード枚数による敗北条件に-X枚する"   // "…ダメージ置き場のカード枚数による敗北条件に+X枚する。Xはこのキャラクターの精神力" (Revise#126)
      const why = p.zones.damage.length >= lim ? `${p.zones.damage.length} cards in the Damage Pile` : null;   // empty deck: when a card must be taken (Q#30)
      if (why) { AA4.enqueue(S, [{ op: "lose", seat: p.seat, why }]); return true; }
    }
    return false;
  });
  /** After something resolves (and after a battle): power cards > Mental (an effect lowered Mental) → the owner
      discards down to Mental, choosing which, one character after the other (Pack, Revise#088). By-hand moves don't trigger it. */
  OPS.mentalCheck = ctx => {
    const S = ctx.S;
    if (S.stage !== "play") return;
    for (const ch of Object.values(S.chars)) {
      if (ch.flags.dying) continue;
      const st = AA4.charStats(S, ctx.db, ch.id);
      if (st.se == null || ch.power.length <= st.se) continue;
      const n = ch.power.length - st.se;
      ctx.emit({ e: "overMental", ch: ch.id, power: ch.power.length, mental: st.se });
      AA4.ask(ctx, { seat: ch.owner, kind: "cards", options: ch.power.slice(), min: n, max: n, auto: false, ref: { ch: ch.id, overMental: true, field: true },
        reason: `Power ${ch.power.length} > Mental ${st.se}: discard ${n} power card${n === 1 ? "" : "s"} of ${AA4.cardName(ctx.db.card(S.cards[AA4.topOf(ch)].key))}`, then: [{ op: "discardChosen" }, { op: "mentalCheck" }] });
    }
  };
  /** After something resolves, when a battle starts or ends: more permanents than the Permanent limit (1 ± Permanent X, e.g.
      "パーマネント-1を与える") → the owner chooses which go (Pack, Q#35 / Revise#094); each one goes to the Discard Pile, or where a
      Permanent Destination rule says instead (hand / deck top / deck bottom / Damage Pile / onto another character). */
  OPS.permCheck = ctx => {
    const S = ctx.S;
    if (S.stage !== "play") return;
    for (const ch of Object.values(S.chars)) {
      if (ch.flags.dying || !ch.perm.length) continue;
      const lim = AA4.charStats(S, ctx.db, ch.id).permLimit;
      if (ch.perm.length <= lim) continue;
      const n = ch.perm.length - lim;
      ctx.emit({ e: "overPermanent", ch: ch.id, perm: ch.perm.length, limit: lim });
      AA4.ask(ctx, { seat: ch.owner, kind: "cards", options: ch.perm.slice(), min: n, max: n, ref: { ch: ch.id, overPerm: true },
        reason: `Permanent limit ${lim}: ${n} permanent${n === 1 ? "" : "s"} of ${AA4.cardName(ctx.db.card(S.cards[AA4.topOf(ch)].key))} must go`, then: [{ op: "permLeave", ch: ch.id }] });
    }
  };
  /** Pack (Revise#239): whenever a character holds more Permanents than its limit — also when "パーマネント±X" ends or changes — it is
      dealt with at once, not at its next move. */
  AA4.STATE_CHECKS.push(ctx => {
    const S = ctx.S;
    if (S.stage !== "play" || S.decisions.some(d => d.ref && d.ref.overPerm)) return false;
    if (!Object.values(S.chars).some(ch => !ch.flags.dying && ch.perm.length && ch.perm.length > AA4.charStats(S, ctx.db, ch.id).permLimit)) return false;
    OPS.permCheck(ctx);
    return S.decisions.some(d => d.ref && d.ref.overPerm) || S.queue.length > 0;
  });
  /** Where a permanent that must leave goes: Permanent Destination rules (modifier key "permDest", value {to}) for its owner. */
  AA4.permDestRules = (S, db, seat) => {
    const out = [];
    for (const m of AA4.allMods(S, db)) {
      if (m.key !== "permDest" || !AA4.modAppliesToSeat(S, m, seat) || !m.value || !PERM_DEST[m.value.to]) continue;
      if (!out.some(r => r.to === m.value.to)) out.push({ to: m.value.to, label: (m.src && m.src.label) || "Field effect" });
    }
    return out;
  };
  const PERM_DEST = { hand: { z: "hand" }, deckTop: { z: "deck" }, deckBottom: { z: "deck", pos: "bottom" }, damage: { z: "damage" }, discard: { z: "discard" }, char: true };
  const PERM_LABEL = { hand: "Hand", deckTop: "Deck (top)", deckBottom: "Deck (bottom)", damage: "Damage Pile", discard: "Discard Pile", char: "Onto another character" };
  OPS.permLeave = (ctx, op) => {
    const S = ctx.S, cards = (op.answer || op.cards || []).filter(id => S.cards[id] && S.cards[id].place.role === "perm");
    if (!cards.length) return;
    const [id, ...rest] = cards, seat = S.cards[id].owner, rules = AA4.permDestRules(S, ctx.db, seat);
    const next = rest.length ? [{ op: "permLeave", cards: rest }] : [];
    if (!rules.length) { AA4.enqueue(S, [{ op: "permGo", card: id, to: "discard" }].concat(next), true); return; }
    if (rules.length === 1) { AA4.enqueue(S, [{ op: "permGo", card: id, to: rules[0].to, label: rules[0].label }].concat(next), true); return; }
    return AA4.ask(ctx, { seat, kind: "pick", options: rules.map(r => r.to), labels: rules.map(r => `${r.label}: → ${PERM_LABEL[r.to]}`), auto: false,
      reason: `Where does ${AA4.cardName(ctx.db.card(S.cards[id].key))} go?`, then: [{ op: "permGo", card: id }].concat(next) });
  };
  OPS.permGo = (ctx, op) => {
    const S = ctx.S, id = op.card, c = S.cards[id];
    if (!c || c.place.role !== "perm") return;
    const to = op.to || (op.answer && op.answer[0]) || "discard";
    if (to === "char") {   // onto another of the owner's Controlled Characters with room for it (none → Discard Pile)
      const from = c.place.ch, opts = AA4.controlledOf(S, c.owner).filter(ch => ch !== from && S.chars[ch].perm.length < AA4.charStats(S, ctx.db, ch).permLimit);
      if (!opts.length) { AA4.moveCard(ctx, id, { z: "discard" }); ctx.emit({ e: "permMoved", card: id, to: "discard", why: "no character has room" }); return; }
      return AA4.ask(ctx, { seat: c.owner, kind: "chars", options: opts, min: 1, max: 1, reason: `Put ${AA4.cardName(ctx.db.card(c.key))} on which character?`, then: [{ op: "permOnto", card: id }] });
    }
    AA4.moveCard(ctx, id, PERM_DEST[to] || { z: "discard" });
    ctx.emit({ e: "permMoved", card: id, to, label: op.label || "" });
  };
  OPS.permOnto = (ctx, op) => {
    const S = ctx.S, ch = (op.answer || [])[0];
    if (!S.cards[op.card] || S.cards[op.card].place.role !== "perm" || !S.chars[ch]) return;
    AA4.moveCard(ctx, op.card, { z: "char", ch, role: "perm" });
    ctx.emit({ e: "permMoved", card: op.card, to: "char", ch });
  };
  AA4.STATE_CHECKS.push(ctx => {   // Defense ≤ 0
    const S = ctx.S;
    if (S.stage !== "play") return false;
    for (const ch of Object.values(S.chars)) {
      if (ch.flags.dying || ch.flags.zeroSafe) continue;
      const st = AA4.charStats(S, ctx.db, ch.id);
      if (st.de == null || st.de > 0 || !["Character", "Break"].includes(st.type)) continue;
      if (st.noDiscard && st.noDiscard.outside && !(S.battle && [S.battle.attacker, S.battle.guard].includes(ch.id))) continue;   // can't be discarded outside battle
      AA4.defeat(ctx, ch.id, { why: `Defense ${st.de}`, defense0: true, battle: !!(S.battle && [S.battle.attacker, S.battle.guard].includes(ch.id)) });
      return true;
    }
    return false;
  });

  OPS.lose = (ctx, op) => {
    const S = ctx.S, p = S.players[op.seat];
    if (p.lost) return;
    p.lost = true; S.losers.push(op.seat);
    ctx.emit({ e: "lost", seat: op.seat, why: op.why });
    const left = AA4.living(S);
    if (left.length <= 1 || S.mode === "solo1") {
      S.stage = "over"; S.winner = left.length === 1 && S.mode !== "solo1" ? left[0] : null;
      S.queue = []; S.decisions = []; S.triggers = []; S.draft = null;
      ctx.emit({ e: "stage", stage: "over", winner: S.winner });
      return;
    }
    // 3–4 players: the loser's cards leave the game; their declarations, choices and battles go away
    if (S.draft && S.draft.seat === op.seat) OPS.refund(ctx, { why: "the player lost" });
    S.decisions = S.decisions.filter(d => d.seat !== op.seat);
    S.triggers = S.triggers.filter(t => t.seat !== op.seat);
    for (const it of S.stack.filter(x => x.seat === op.seat)) if (it.card && S.cards[it.card].owner === op.seat && S.cards[it.card].place.z !== "char") AA4.moveCard(ctx, it.card, { z: "removed" });
    S.stack = S.stack.filter(x => x.seat !== op.seat);
    if (S.battle && (S.battle.aSeat === op.seat || S.battle.defender === op.seat)) { S.battle = null; AA4.expire(ctx, "battle"); }
    for (const chId of AA4.charsOf(S, op.seat)) AA4.removeChar(ctx, chId, { to: "removed", why: "the player lost" });
    for (const z of ["hand", "special", "cost", "declared"]) for (const id of p.zones[z].slice()) AA4.moveCard(ctx, id, { z: "removed" });
    S.passed = S.passed.filter(s => s !== op.seat);
    if (S.turn.player === op.seat) { S.queue = []; AA4.enqueue(S, [{ op: "endTurn" }]); }
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
