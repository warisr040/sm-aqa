/* ==========================================================================
   v4 engine · query pipeline, modifiers, field effects, Declaration Bans
   (requirements_v4 §20.4, §8, Revise#013 / #038; step B3)

   Every value that can change is asked through one place:
     AA4.charStats(S, db, ch)    → { se, at, atMental, de, icons, faction, skills, name, named, broken,
                                    controlled, active, power, attackCost, guardCost, permLimit, parts }
     AA4.playerStats(S, db, seat) → { handLimit, draw, charge }
     AA4.banOf(S, db, seat, decl) → the modifier that bans this declaration, or null
     AA4.costRules(S, db, pay)    → where paid cost may go (Cost Destination Rules, Revise#029)
   Order (§20.4): printed top card → permanents → modifiers in time order (static ones from cards first,
   then S.modifiers by creation) → limits (Mental / Attack / Defense not below 0).

   Modifier = { id, src: {card?, seat?, label}, to: selector (15-selectors.js) | {ch} | {seat} | {seats},
                key, op: "add" | "set" | "grant" | "remove" | "ban" | "dest", value, until, cond? }
     keys on characters: se, at, de, atMental, skill ({id, x}), icon, attackCost, guardCost, permLimit,
                         noDamage ({battle?, mental?, normal?, outside?}), untargetable ({from})
     keys on players:    handLimit, draw, charge, ban ({decl, type?, name?, faction?, icon?}), dest ({cost, to, label}),
                         powerVisible
     until: "battle" | "main" | "turn" | "source" (while the source card is on the field) | "removed" (until ended by hand)
   Static modifiers (skills, permanents, always-on abilities) are not stored: AA4.STATIC_SOURCES make
   them from the cards on the field each time (cached per state revision).
   ========================================================================== */
(function (G) {
  "use strict";
  const AA4 = G.AA4;
  const CACHE = new WeakMap();   // state object → {rev, chars, players, mods}
  const REV = new WeakMap();     // state object → revision counter (kept outside the state: not game data)
  AA4.STATIC_SOURCES = [];       // fn(S, db) → modifiers (17-skills.js, 16-effects.js add to this)

  /** Call after anything that changes the state (runQueue does it after every operation). */
  AA4.touch = S => { REV.set(S, (REV.get(S) || 0) + 1); };
  function cache(S) {
    let c = CACHE.get(S);
    const rev = REV.get(S) || 0;
    if (!c || c.rev !== rev) { c = { rev, chars: new Map(), players: new Map(), mods: null, busy: new Set() }; CACHE.set(S, c); }
    return c;
  }

  /** Is a modifier still alive? ("source": while its source card is on the field). */
  function alive(S, m) {
    if (m.until === "source") return !!(m.src && m.src.card && AA4.onField(S, m.src.card));
    if (m.fromChar && m.src && m.src.ch && !S.chars[m.src.ch]) return false;   // its character left the field: the result is gone (Revise#099)
    return true;
  }
  /** Every modifier in force: static ones from the cards first, then S.modifiers in time order. */
  AA4.allMods = (S, db) => {
    const c = cache(S);
    if (c.mods) return c.mods;
    c.mods = [];   // (a static source that asks for stats meanwhile sees no modifiers instead of looping)
    const out = [];
    for (const src of AA4.STATIC_SOURCES) for (const m of src(S, db) || []) out.push(m);
    for (const m of S.modifiers) if (alive(S, m)) out.push(m);
    c.mods = out;
    c.chars.clear(); c.players.clear();   // anything worked out while the list was being made is out of date
    return out;
  };

  /** "…シリーズのカード" (M1b): does card info belong to a source title ("nanoha", "nanohaForce", "phantom")? */
  AA4.worksOf = (inf, w) => !!(inf && (inf.works || []).includes(w));
  /** May seat's Break card (info binf) be declared at fast timing onto chId? ("ファストカードのタイミングでブレイク可能") */
  AA4.fastBreakOk = (S, db, seat, chId, binf) => {
    const ch = S.chars[chId], bf = ch && AA4.charStats(S, db, chId).breakFast;
    if (binf && binf.fastOnSameName && ch && ch.owner === seat && binf.name && binf.name === AA4.charStats(S, db, chId).name) return true;   // 3536 (Revise#147): "このカードをこのカードと同じネームを持つキャラクターにセット宣言する場合、≪あなた≫はこのカードをファストカードのタイミングでセット宣言可能"
    if (bf && bf.tag && !(binf && (binf.tags || []).includes(bf.tag))) return false;
    if (bf && bf.icons && !(binf && (binf.icons || []).some(i => bf.icons.includes(i)))) return false;   // only Break cards of those classes (A3-25 3803)   // "…英国を持つブレイクカードを" (A4-EX02 EX822, Revise#294)
    return !!bf && (bf.all || (bf.by != null ? bf.by === seat : ch.owner === seat)) && (bf === true || bf.all || bf.by != null || ((!bf.works || AA4.worksOf(binf, bf.works)) && (!bf.name || (binf && binf.name === bf.name)) && (!bf.sameName || (binf && binf.name && binf.name === AA4.charStats(S, db, chId).name))));   // "このキャラクターと同じネームを持つブレイクカード" (Revise#140)   // {works} / {name}: only that Break card
  };
  /** A card's rules info as it is used now: a Character card declared as a Break card (M1a "≪このカード≫は、E0のブレイクカードとして
      使用宣言可能") is a Break card with that factor and cost while it is declared or on the field. */
  AA4.asBreakInfo = inf => Object.assign({}, inf, inf.asBreak.noRule ? { breakRule: null } : {}, { type: "Break", factor: Object.assign({}, inf.asBreak.factor), cost: inf.asBreak.cost, asBreakOf: "Character", fastTiming: !!inf.asBreak.fast || !!inf.fastTiming, asBreakOwnOnly: !!inf.asBreak.ownOnly });
  /** "このカードを「…」という効果の目標・持続のファストカードとして使用宣言可能" (M2g, Revise#161): a Fast card with that text,
      the printed cost and factor (Pack: Q-A) */
  AA4.asFastInfo = inf => Object.assign({}, inf, { type: "Fast", play: inf.asFast.play || inf.play, asFastOf: inf.type, breakRule: null, skills: {} }, inf.asFast.factor ? { factor: Object.assign({}, inf.asFast.factor) } : {});   // factor: "≪このカード≫は、W4のファストカードとして使用宣言可能" (Revise#164)
  /** Outlaw "Fool text" (Pack, Q#66 / Revise#165): an A3-23 joke card plays its フールテキスト instead */
  AA4.foolInfo = inf => Object.assign({}, inf, inf.fool, { foolOn: true });
  /** A card with modes ("以下の効果から1つを選択して使用宣言する", Revise#164): the info as the chosen mode */
  AA4.modeInfo = (inf, i) => Object.assign({}, inf, { play: inf.play.modes[i], mode: i }, inf.play.modes[i].factorLess ? { factor: AA4.factorMinus(inf.factor, inf.play.modes[i].factorLess) } : {});
  AA4.factorMinus = (f, n) => { const out = Object.assign({}, f || {}); let left = n; for (const k of Object.keys(out)) { while (left > 0 && out[k] > 0) { out[k]--; left--; } if (!out[k]) delete out[k]; } return out; };
  AA4.cardInfo = (S, db, id) => {
    const c = S.cards[id], infF = (c && db.card(c.key)) || {}, inf0 = infF.fool && S.rules && S.rules.outlawFool ? AA4.foolInfo(infF) : infF, inf = c && c.mode != null && inf0.play && inf0.play.modes && inf0.play.modes[c.mode] ? AA4.modeInfo(inf0, c.mode) : inf0;
    if (c && c.asFast && inf.asFast) return AA4.asFastInfo(inf);
    return c && c.asBreak && inf.asBreak ? AA4.asBreakInfo(inf) : inf;
  };
  /** The characters a character is in battle with now (attacker ↔ guard / attacked character, and Synchro joiners). */
  AA4.battleOppsOf = (S, chId) => {
    const b = S.battle;
    if (!b || !chId) return [];
    const att = [b.attacker].concat(b.joined ? b.joined.att : []), grd = [b.guard || (b.target && b.target.ch)].concat(b.joined ? b.joined.grd : []);
    const other = att.includes(chId) ? grd : grd.includes(chId) ? att : [];
    return other.filter(id => id && S.chars[id]);
  };
  /** Does a modifier apply to character chId / to player seat? */
  AA4.modAppliesToChar = (S, db, m, chId) => {
    const t = m.to || {};
    if (t.ch) return t.ch === chId;
    if (t === "battleOpp") return !!(m.src && m.src.ch) && AA4.battleOppsOf(S, m.src.ch).includes(chId);   // "≪このキャラクターのバトル相手≫の持つ…を無効化する"
    if (t.seat != null || t.seats || t.players) return false;
    // {all: selector} (compiled "≪…全て≫") or a bare selector — the selector must be used, not ignored (Revise#087 fix)
    const x = m.xdef ? AA4.xOf(S, db, m.xdef, m.src || {}) : undefined;   // "≪精神力X以下のキャラクター≫…Xはこのキャラクターのパワーに等しい"
    return AA4.matchChar ? AA4.matchChar(S, db, t.all || t, chId, { seat: m.src ? m.src.seat : -1, self: m.src && m.src.ch, x, srcCard: m.src && m.src.card }) : false;
  };
  AA4.modAppliesToSeat = (S, m, seat) => {
    const t = m.to || {};
    if (t.seats) return t.seats.includes(seat);
    if (t.seat != null) return t.seat === seat;
    if (t.players === "all") return true;
    if (t.players === "opponents") return m.src && m.src.seat !== seat;
    if (t.players === "you") return m.src && m.src.seat === seat;
    return false;
  };
  const condOk = (S, db, m, ctx) => !m.cond || !AA4.checkCond || AA4.checkCond(S, db, m.cond, ctx);

  /** Everything about one character right now. */
  AA4.charStats = (S, db, chId) => {
    const c = cache(S);
    if (c.chars.has(chId)) return c.chars.get(chId);
    const ch = S.chars[chId];
    if (!ch) return null;
    const top = AA4.cardInfo(S, db, AA4.topOf(ch));
    const base = { se: top.se, at: top.at, de: top.de };
    const out = {
      se: num(top.se), at: num(top.at), atMental: !!top.atMental, de: num(top.de),
      icons: (top.icons || []).slice(), faction: top.faction || "", skills: Object.assign({}, top.skills || {}),
      name: top.name || "", named: !!top.name, type: top.type, base,
      id: chId, broken: ch.stack.some(id => AA4.cardInfo(S, db, id).type === "Break"),
      controlled: AA4.isControlled(ch), active: ch.at.area === "active" && AA4.activeCharOf(S, ch.owner, ch.at.slot) === chId,
      inParty: ch.at.area === "active", power: ch.power.length, owner: ch.owner,
      attackCost: 1, guardCost: 1, effectCost: 0, permLimit: 1, noDamage: [], untargetable: [], parts: [],
      factorBonus: {}, alsoNames: [], payFor: [], noAttack: false, noGuard: false, noCharge: false, negated: { effects: false, skills: false }, gainedEffects: [],
      dmgReduce: { normal: 0, mental: 0 }, noDiscard: null, negatedEffects: [], duelNamed: null, inherited: [],
      breakableAny: [], breakFast: false, noGuardBy: [], attackChars: [],
      initCount: ((top.skillCount && top.skillCount.initiative) || (top.skills && top.skills.initiative ? 1 : 0)),   // Q#56 (Revise#155): how many Initiatives it has — each printed one, each card it inherits from, each Permanent, each grant
    };
    // a token made from an effect's cost (Revise#119: アストラル / コウモリ / 炎 / フレイム / 死霊 …): its own name, stats and skills
    const tk = S.modifiers.find(m => m.key === "token" && m.to && m.to.ch === chId);
    if (tk) {
      const v = tk.value || {}, pw = ch.power.length + (v.stats === "power" ? ch.stack.length : 0), st = v.stats === "power" ? { se: pw, at: pw, de: pw } : v.stats || {};
      Object.assign(out, { se: num(st.se), at: num(st.at), de: num(st.de), atMental: !!v.atMental, icons: (v.icons || []).slice(), faction: v.faction || "", name: v.name || "", named: false, tokenName: v.name || "", type: "Token",
        skills: Object.fromEntries((v.skills || []).map(x => [x.id, x.x == null ? true : x.x])), noSet: !!v.noSet, base: { se: st.se, at: st.at, de: st.de } });
      if (v.noSet) out.noCharge = true;
      if (v.attackChars) out.attackChars.push({});
      if (v.freeJoinWith) out.freeJoinWith = v.freeJoinWith;   // 3534 (Revise#152)
    }
    // "…異なるカード名称の“X”のスキル・エフェクト・アビリティ全てを得る" (Revise#087): skills and effect lines of those cards
    for (const id of AA4.inheritedCards(S, db, ch)) {
      const inf = db.card(S.cards[id].key) || {};
      for (const [k, v] of Object.entries(inf.skills || {})) out.skills[k] = mergeSkill(out.skills[k], v, k, out);
      out.initCount += ((inf.skillCount && inf.skillCount.initiative) || (inf.skills && inf.skills.initiative ? 1 : 0));
      for (const ef of inf.effects || []) if (!out.gainedEffects.some(e => e.text === ef.text)) out.gainedEffects.push(Object.assign({ gained: AA4.cardName(inf) }, ef));
      out.inherited.push(id);
    }
    if (c.busy.has(chId)) return (c.partial && c.partial.get(chId)) || out;   // a condition asked for this character's own stats: what is worked out so far (printed values + the classes granted first)
    c.busy.add(chId);
    (c.partial = c.partial || new Map()).set(chId, out);
    { const pp = out.parts, push0 = pp.push.bind(pp);   // each part knows the card that made it (Pack, Revise#237: the Status table shows its picture)
      Object.defineProperty(out, "_cur", { value: null, writable: true, enumerable: false });
      Object.defineProperty(pp, "push", { value: (...xs) => push0(...xs.map(x => x && x.card == null && out._cur ? Object.assign({ card: out._cur }, x) : x)), enumerable: false }); }
    try {
      const at0 = out.at;   // the printed Attack (or a token's), before any change — split later into normal and mental (Revise#238)
      // permanents: their printed Mental / Attack / Defense modifiers (e.g. "+1")
      const permDbl = ch.perm.length && AA4.allMods(S, db).some(m => m.key === "permDouble" && AA4.modAppliesToChar(S, db, m, chId));   // 3652 (Revise#152): "≪このキャラクターにセットされているパーマネントカード≫の精神力・攻撃力・耐久力の欄に書かれた修正値は2倍になる"
      for (const pid of ch.perm) {
        out._cur = pid;
        if (S.cards[pid].thread) { add(out, "se", -1); if (!out.icons.includes("傀儡")) out.icons.push("傀儡"); out.skills.intercept = mergeSkill(out.skills.intercept, true); out.parts.push({ label: "Permanent “糸”", key: "se", n: -1 }); continue; }   // 河原瑠璃子 (Revise#135)
        const ptk = S.cards[pid].permToken;
        if (ptk && ptk.once) { out._ptOnce = out._ptOnce || {}; if (!out._ptOnce[ptk.name]) { out._ptOnce[ptk.name] = true; for (const [k, v] of Object.entries(ptk.once.stats || {})) if (v) { add(out, k, v); out.parts.push({ label: `Permanent ${ptk.name}`, key: k, n: v }); } for (const v of ptk.once.skills || []) out.skills[v.id] = mergeSkill(out.skills[v.id], v.x, v.id, out); } }   // EX0192: once, however many   // 2977 / 3302 (Revise#152): a card set as a token Permanent ("コントラクトリング", "アームユニット")
        if (ptk) { for (const k of ["se", "at", "de"]) if (ptk.stats && ptk.stats[k]) { add(out, k, ptk.stats[k]); out.parts.push({ label: `Permanent ${ptk.name}`, key: k, n: ptk.stats[k] }); } for (const v of ptk.skills || []) out.skills[v.id] = mergeSkill(out.skills[v.id], v.x == null ? true : v.x, v.id, out); continue; }
        const pc = db.card(S.cards[pid].key) || {}, dbl = permDbl ? 2 : 1;
        if (pc.statModsX && pc.statX) { const xv = AA4.xOf(S, db, pc.statX, { ch: chId, seat: ch.owner, card: pid }, []) || 0; for (const [k, sg] of Object.entries(pc.statModsX)) if (xv) { add(out, k === "atm" ? "at" : k, sg * xv * dbl); if (k === "atm") out.atPlusM = (out.atPlusM || 0) + sg * xv * dbl; if (k === "at") out.atPlusN = (out.atPlusN || 0) + sg * xv * dbl; out.parts.push({ label: `Permanent ${AA4.cardName(pc)}`, key: k, n: sg * xv }); } }   // "+X" (M3a, Revise#159)
        for (const k of ["se", "at", "atm", "de"]) if (pc.statMods && pc.statMods[k]) { add(out, k === "atm" ? "at" : k, pc.statMods[k] * dbl); if (k === "atm") out.atPlusM = (out.atPlusM || 0) + pc.statMods[k] * dbl; if (k === "at") out.atPlusN = (out.atPlusN || 0) + pc.statMods[k] * dbl; out.parts.push({ label: `Permanent ${AA4.cardName(pc)}`, key: k, n: pc.statMods[k] }); }
        out.initCount += ((pc.skillCount && pc.skillCount.initiative) || (pc.skills && pc.skills.initiative ? 1 : 0));
        for (const m of AA4.allMods(S, db)) if (m.key === "skill" && m.op !== "remove" && m.value && m.value.id && m.to && (m.to.card === pid || (m.to.allCards && AA4.cardSelOk && AA4.cardSelOk(pc, m.to.allCards)))) { const x = typeof m.value.x === "number" ? m.value.x : true; out.skills[m.value.id] = mergeSkill(out.skills[m.value.id], x, m.value.id, out); out.parts.push(Object.assign({ label: `Permanent ${AA4.cardName(pc)}`, key: "skill", n: m.value.id, card: pid, via: (m.src && m.src.label) || null }, typeof x === "number" ? { v: x } : {})); }   // credited to the Permanent card that has the skill (Pack, Revise#244: A3-11 1660 gives it to each Permanent)   // a skill given to the permanent card (A3-11 1660, Revise#231): its character has it
        for (const [k, v] of Object.entries(pc.skills || {})) { out.skills[k] = mergeSkill(out.skills[k], v, k, out); out.parts.push({ label: `Permanent ${AA4.cardName(pc)}`, key: "skill", n: k, v: typeof v === "number" ? v : true }); }   // the permanent's skills belong to its character (Pack, Revise#119: メトセラ's Shield · Bind 1 · Draw -1 · Charge 1) — and show in the Status table (Pack, Revise#278)
      }
      out._cur = null;
      const mods = AA4.allMods(S, db);
      const ignoreOwn = mods.some(m => m.key === "ignoreOwn" && AA4.modAppliesToChar(S, db, m, chId));   // "そのキャラクターのオーナーが使用した…の効果を受けず"
      const ordered = mods.filter(m => m.key === "icon").concat(mods.filter(m => m.key !== "icon"));   // classes first: "≪…全て≫はドラグーン♂を得、≪…ドラグーン・ドラグーン♂全て≫に+2/+2/+2する" (A3-17 2385, Revise#156)
      const later = [];   // "このキャラクターの攻撃力が10以上の場合、…" (A4-01 0116, Revise#218): decided on the stats worked out so far
      for (const m of ordered) {
        if (ignoreOwn && !m.static && m.key !== "ignoreOwn" && m.src && m.src.seat === ch.owner) continue;
        if (m.cond && m.cond.selfStatMin && m.src && m.src.ch === chId) { if (AA4.modAppliesToChar(S, db, m, chId)) later.push(m); continue; }
        if (!AA4.modAppliesToChar(S, db, m, chId) || !condOk(S, db, m, { seat: m.src ? m.src.seat : ch.owner, ch: m.src && m.src.ch, src: m.src, target: chId })) continue;
        applyMod(out, m, S, db);
      }
      for (const m of later) { const k = m.cond.selfStatMin.key, cur = out[k] != null ? out[k] : 0; if (cur >= m.cond.selfStatMin.n) applyMod(out, m, S, db); }
      out._cur = null;
      // "バインドX Xは…に等しい" / "ドロー-X Xは…" (M1a): a skill value defined by the text → the number now
      if (out.perAggRemove) {   // 3266 (Revise#152): "このキャラクターの持つ▼またはリムーブXのスキル1つにつき、チャージ1・パーマネント+1を得る" — each card of it with ▼ or Remove counts
        const n = ch.stack.concat(ch.perm).filter(id => { const i = db.card(S.cards[id].key) || {}; return !!(i.aggressive || (i.skills && (i.skills.remove || i.skills.aggressive))); }).length;
        if (n) { out.skills.charge = (+out.skills.charge || 0) + n; out.skills.permanent = (+out.skills.permanent || 0) + n; }
      }
      for (const [k, v] of Object.entries(out.skills)) if (v && typeof v === "object" && v.x && typeof v.x === "object") out.skills[k] = Math.max(v.base != null ? 0 : -99, (v.base || 0) + (v.sign || 1) * AA4.xOf(S, db, v.x, { ch: chId, seat: ch.owner, card: AA4.topOf(ch) }));   // base: "バインド3-X"
      if (out.skills.permanent) out.permLimit += +out.skills.permanent || 0;
      if (out.skills.intercept) { out.guardCost -= 1; out.parts.push({ label: "Intercept", key: "guardCost", n: -1 }); }
      if (out.statSwap) { out.de = out.se; out.at = ch.power.length; out.atMental = true; }   // "…精神力を耐久力、本来の攻撃力の代わりに、パワーに等しい数値の精神攻撃力を持つものとして判定する" (Revise#109)
      for (const m of mods.filter(x => x.key === "negateSel" && x.value)) if (AA4.matchChar && AA4.matchChar(S, db, m.value.sel || {}, chId, { seat: m.src ? m.src.seat : -1 })) { out.negated.effects = true; if (!m.value.effectsOnly) { out.skills = {}; out.negated.skills = true; } }   // A3-04 0678 / A3-05 0766 (Revise#159)
      for (const m of mods.filter(x => x.key === "noActSel" && x.value)) if (AA4.matchChar && AA4.matchChar(S, db, m.value.sel || {}, chId, { seat: m.src ? m.src.seat : -1, x: m.value.x })) for (const k of m.value.kinds || ["noAttack", "noGuard", "noEffect"]) out[k] = true;   // A3-02 0243 / 0489 / A3-04 0678 (Revise#159): "…のアタック宣言・ガード宣言・エフェクトの使用宣言は無効化される"
      if (out.negated.skills) { out.skills = {}; out.initCount = 0; }
      if (out._swapSD) { const t = out.se; out.se = out.de; out.de = t; delete out._swapSD; }   // "目標の精神力と耐久力を入れ替えて判定する" (A3-09 1320, Revise#168)   // "スキル全ては無効化される": also the skills granted after it, whatever the order of the modifiers (Pack bug, Revise#163)
      if (out.swapAtDe || mods.some(m => m.key === "swapAtDeAll")) { const a = out.at; out.at = out.de; out.de = a; }   // A3-03 0485 (Revise#159): "攻撃力と耐久力の数値を入れ替える"
      // Normal and mental Attack worked out separately (Pack, Revise#238): printed in its own kind; "+N" normal; "+(N)" mental;
      // "-X・+(X)" X normal → mental; "+X・-(X)" X mental → normal. Each is at least 0; Attack = the two together.
      if (out.at != null) {
        let n, mm;
        if (out.statSwap || out._atSet || out.swapAtDe || mods.some(m => m.key === "swapAtDeAll")) { n = out.atMental ? 0 : out.at; mm = out.atMental ? out.at : 0; }
        else {
          const base = at0 == null ? 0 : +at0 || 0, plusM = out.atPlusM || 0, plusN = (out.at - base) - plusM, toM = out.atToMental || 0, toN = out.atToNormal || 0;
          n = (out.atMental ? 0 : base) + plusN - toM + toN;
          mm = (out.atMental ? base : 0) + plusM + toM - toN;
        }
        out.atN = Math.max(0, n); out.atM = Math.max(0, mm); out.at = out.atN + out.atM;
        Object.defineProperty(out, "_atSet", { value: undefined, enumerable: false, writable: true });
      }
      for (const k of ["se", "at", "de"]) if (out[k] != null) out[k] = Math.max(0, out[k]);
      out.effectCost = Math.max(0, out.effectCost); out.attackCost = Math.max(0, out.attackCost); out.guardCost = Math.max(0, out.guardCost); out.permLimit = Math.max(0, out.permLimit);
    } finally { c.busy.delete(chId); c.partial.delete(chId); }
    c.chars.set(chId, out);
    return out;
  };
  const num = v => (v == null || v === "" || isNaN(+v) ? null : +v);
  function add(out, k, n) { out[k] = (out[k] == null ? 0 : out[k]) + n; }
  /** A modifier value: a number, or {x: <definition>, sign} worked out now (C2: "…に+Xする。Xはこのキャラクターのパワーに等しい"). */
  AA4.modValue = (S, db, m) => {
    const v = m.value;
    if (v && typeof v === "object" && v.x && typeof v.x === "object") {
      const per = v.per ? (m.src && m.src.ch && S.chars[m.src.ch] ? Math.floor(S.chars[m.src.ch].power.length / v.per) : 0) : 1;   // "このキャラクターのパワー1につき"
      return (v.sign || 1) * AA4.xOf(S, db, v.x, v.x.ofTo && m.to && m.to.ch ? Object.assign({}, m.src, { ch: m.to.ch }) : m.src || {}) * per;   // ofTo: X is counted for the character that has the modifier (EX0485, Revise#370)
    }
    return v;
  };
  /** X definitions shared by effects and abilities. src = {ch, seat, card}; e.targets for target-based ones. */
  AA4.xOf = (S, db, x, src, targets) => {
    const ch = src.ch && S.chars[src.ch];
    const t = (targets || [])[(x && x.part) || 0] || {}, tTop = () => { const id = t.card || (t.ch && S.chars[t.ch] ? AA4.topOf(S.chars[t.ch]) : null); return id ? db.card(S.cards[id].key) || {} : {}; };
    if (x.stackSkill) return ch ? ch.stack.filter(id => ((db.card(S.cards[id].key) || {}).skills || {})[x.stackSkill] != null).length : 0;   // "キャパシティ+Xを持つカードの枚数" (EP596, Revise#310)
    if (x.nameCtl) return AA4.controlledOf(S, src.seat).filter(id => { const st = AA4.charStats(S, db, id); return st.name === x.nameCtl.name || (st.alsoNames || []).includes(x.nameCtl.name); }).reduce((n, id) => n + (x.nameCtl.stat === "power" ? S.chars[id].power.length : Math.max(0, +AA4.charStats(S, db, id)[x.nameCtl.stat] || 0)), 0);   // "あなたの支配エリアの“ガンバスター”の攻撃力" (Revise#310)
    if (x.const != null) return Math.min(+x.const || 0, x.capChars ? Object.keys(S.chars).length : Infinity);   // "Xは100以下のあなたの任意の数" (Revise#310)
    if (x.power === "self") return ch ? (x.div ? Math.floor(ch.power.length / x.div) : ch.power.length) : 0;
    if (x.sameNameChars) { const nm = ch ? (db.card(S.cards[AA4.topOf(ch)].key) || {}).name : null; return nm ? Object.values(S.chars).filter(o => o.id !== ch.id && o.stack.some(id => (db.card(S.cards[id].key) || {}).name === nm)).length : 0; }   // "このキャラクター以外の、場に出ている、このカードと同じネームを持つキャラクターの数"
    if (x.permFactor) return ch ? ch.perm.reduce((n, id) => n + Object.values((db.card(S.cards[id].key) || {}).factor || {}).reduce((a, b) => a + (+b || 0), 0), 0) : 0;   // "このキャラクターにセットされているパーマネントカードの必要ファクターの合計"
    if (x.stackCount) return ch ? ch.stack.length : 0;   // "このキャラクターを構成するカードの枚数" (Revise#138)
    if (x.cardX) return src.card && S.cards[src.card] ? +S.cards[src.card].x || 0 : 0;   // "X" of this card's cost, as paid (Revise#126)
    if (x.selfStat) return ch ? AA4.charStats(S, db, ch.id)[x.selfStat] || 0 : 0;
    if ((x.damage || (x.pileCount && x.pileCount.zone === "damage")) && AA4.pileTextOff && AA4.pileTextOff(S, db)) return 0;   // Q#46: "≪ダメージ置き場の枚数を参照するテキスト全て≫を無効化する"
    if (x.damage === "all") return AA4.living(S).reduce((n, s) => n + S.players[s].zones.damage.length, 0);
    if (x.hand === "attacked") return S.battle && S.battle.defender != null && S.players[S.battle.defender] ? S.players[S.battle.defender].zones.hand.length : 0;
    if (x.hand === "all") return AA4.living(S).reduce((n, s) => n + S.players[s].zones.hand.length, 0);
    if (x.hand === "opp") return Math.max(0, AA4.living(S).filter(s => s !== src.seat).reduce((n, s) => n + S.players[s].zones.hand.length, 0) - (x.over || 0));   // "3枚を超える1枚につき": over
    if (x.pileCount) { const p = x.pileCount; return AA4.living(S).filter(s => p.owner === "all" || (p.owner === "others" ? s !== src.seat : s === src.seat)).reduce((n, s) => n + S.players[s].zones[p.zone].filter(id => { const inf = db.card(S.cards[id].key) || {}; return (!p.type || inf.type === p.type) && (!p.icons || (inf.icons || []).some(i => p.icons.includes(i))) && (!p.faction || inf.faction === p.faction) && (!p.named || !!inf.name) && (!p.name || inf.name === p.name); }).length, 0); }
    if (x.stackBreaks) return ch ? ch.stack.filter(id => id !== src.card && (db.card(S.cards[id].key) || {}).type === "Break").length : 0;   // "このカード以外の、このキャラクターを構成するブレイクカード"
    if (x.damageDiff) return Math.max(0, (S.players[src.seat] ? S.players[src.seat].zones.damage.length : 0) - AA4.living(S).filter(s => s !== src.seat).reduce((n, s) => n + S.players[s].zones.damage.length, 0));   // A4-PP PP330 (Revise#346)
    if (x.damage === "opp") return AA4.living(S).filter(s => s !== src.seat).reduce((n, s) => n + S.players[s].zones.damage.length, 0);   // "あなたの対戦相手全てのダメージ置き場のカード枚数の合計"
    if (x.damage) return S.players[src.seat] ? S.players[src.seat].zones.damage.length : 0;
    if (x.hand) return S.players[src.seat] ? S.players[src.seat].zones.hand.length : 0;   // "あなたの手札枚数"
    if (x.permCount) return ch ? ch.perm.length : 0;
    if (x.atPlusInit) { if (!ch) return 0; const st = AA4.charStats(S, db, ch.id); return Math.max(0, st.at || 0) + (st.initCount || (st.skills.initiative ? 1 : 0)); }   // EX0384
    if (x.lastingOnly) { const ch0 = src.ch; return new Set(S.modifiers.filter(m => m.to && m.to.ch === ch0 && m.src && m.src.card && S.cards[m.src.card] && S.cards[m.src.card].place.z === "special" && ["Project", "Fast"].includes((db.card(S.cards[m.src.card].key) || {}).type) && !S.modifiers.some(o => o.src && o.src.card === m.src.card && !(o.to && o.to.ch === ch0))).map(m => m.src.card)).size; }   // EX0524: "このキャラクターにのみ効果を発揮している…"
    if (x.lastingMine) { const ch0 = src.ch; return new Set(S.modifiers.filter(m => m.to && m.to.ch === ch0 && m.src && m.src.card && m.src.seat === src.seat && S.cards[m.src.card] && S.cards[m.src.card].place.z === "special" && (x.lastingMine.types || ["Project", "Fast"]).includes((db.card(S.cards[m.src.card].key) || {}).type)).map(m => m.src.card)).size; }   // EX0238 / EX0524
    if (x.battleOppAtSum) return ch ? AA4.battleOppsOf(S, ch.id).filter(o => S.chars[o]).reduce((n, o) => n + (AA4.charStats(S, db, o).at || 0), 0) : 0;   // EX0509
    if (x.stackBreakIcons) return ch ? ch.stack.filter(id => { const i2 = db.card(S.cards[id].key) || {}; return i2.type === "Break" && (i2.icons || []).some(i => x.stackBreakIcons.includes(i)); }).length : 0;   // A3-09 1482 (Revise#199)
    if (x.selfBaseMental) { if (!ch) return 0; const inf = db.card(S.cards[AA4.topOf(ch)].key) || {}; return inf.atMental ? +inf.at || 0 : 0; }   // 1973 (Revise#179): "このキャラクターが持つ本来の精神攻撃力"
    if (x.selfBase) return ch ? +((db.card(S.cards[AA4.topOf(ch)].key) || {})[x.selfBase]) || 0 : 0;   // "本来の攻撃力" (EXPR047)
    if (x.targetPermFactor) { const t0 = (targets || []).find(t => t.ch && S.chars[t.ch]); return t0 ? S.chars[t0.ch].perm.reduce((n, id) => n + Object.values((db.card(S.cards[id].key) || {}).factor || {}).reduce((a, b) => a + (+b || 0), 0), 0) : 0; }   // A3-05 0807
    if (x.permAtSum) return ch ? ch.perm.reduce((n, id) => n + (+((db.card(S.cards[id].key) || {}).at) || 0), 0) : 0;   // EXPP054: "…パーマネントカードの攻撃力の欄に書かれた修正値の合計"
    if (x.initCount) return ch ? +AA4.charStats(S, db, ch.id).initCount || 0 : 0;   // Revise#273
    if (x.stackNameHas) return ch ? ch.stack.filter(id => x.stackNameHas.some(n => String((db.card(S.cards[id].key) || {}).name || "").includes(n))).length : 0;   // "このキャラクターを構成する、ネームに「フォルナ」を含むカードの枚数" (Revise#259)
    if (x.fieldNameHas) return Object.values(S.chars).reduce((k, c) => k + c.stack.filter(id => x.fieldNameHas.some(n => String((db.card(S.cards[id].key) || {}).name || "").includes(n))).length, 0);
    if (x.permTokens) return ch ? ch.perm.filter(id => S.cards[id].permToken && S.cards[id].permToken.name === x.permTokens).length : 0;   // EX0545 (Revise#157)
    if (x.selfNamed && !ch && src.evStack) { const nm = x.selfNamed === true ? (src.card && S.cards[src.card] ? (db.card(S.cards[src.card].key) || {}).name : null) : x.selfNamed; return nm ? src.evStack.filter(id => S.cards[id] && (db.card(S.cards[id].key) || {}).name === nm).length : 0; }   // the character is gone (a "捨て札される場合" trigger): its cards as they were (Revise#152)
    if (x.selfTopNamedBreakCost) { const id = ch ? ch.stack.slice().reverse().find(c => (i => i.type === "Break" && !!i.name)(db.card(S.cards[c].key) || {})) : null; return id ? +(db.card(S.cards[id].key) || {}).cost || 0 : 0; }   // A4-03 0572 (Revise#343)
    if (x.drawPhase) return Math.max(0, AA4.playerStats(S, db, src.seat).draw || 0);   // A4-04 0647: "あなたがドローフェイズにドローする枚数"
    if (x.factorSumAll) { const f = x.factorSumAll; return Object.keys(S.chars).filter(id => AA4.isControlled(S.chars[id])).reduce((k, id) => { const st = AA4.charStats(S, db, id); return k + (st.faction === f ? 1 : 0) + ((st.factorBonus || {})[f] || 0); }, 0); }   // A4-PP PP333 (Revise#346): every control area
    if (x.stackFastOnSelf) return (S.stack || []).filter(it => it.card && S.cards[it.card] && (db.card(S.cards[it.card].key) || {}).type === "Fast" && (it.targets || []).some(t => t.ch && t.ch === src.ch)).length;   // A3-EX02 EX0111
    if (x.selfStackType) return ch ? ch.stack.filter(id => (db.card(S.cards[id].key) || {}).type === x.selfStackType).length : 0;   // A3-21 2908
    if (x.selfEffectsOnOpp) {   // A4-EP EP413 (Revise#350): its own effects (cost N or more) that are in effect on its battle opponent — one per use
      const opps = src.ch ? AA4.battleOppsOf(S, src.ch) : [], seen = new Set();
      for (const m of S.modifiers) { if (!m.src || m.src.ch !== src.ch || !m.src.eid || !(m.to && opps.includes(m.to.ch))) continue; const cm = /^\s*(\d+)\s*[:：]/.exec(m.src.textJp || ""); if (!cm || +cm[1] < (x.selfEffectsOnOpp.costMin || 0)) continue; seen.add(m.src.eid); }
      return seen.size;
    }
    if (x.selfNamedPlusPower) return ch ? ch.stack.filter(id => String((db.card(S.cards[id].key) || {}).name || "").replace(/\s+/g, "") === x.selfNamedPlusPower).length + ch.power.length : 0;   // A4-PP PP301 (Revise#341)
    if (x.selfNamed) { if (!ch) return 0; const nm = x.selfNamed === true ? (db.card(S.cards[src.card].key) || {}).name : x.selfNamed; const n = Math.max(0, ch.stack.filter(id => (db.card(S.cards[id].key) || {}).name === nm && (!x.div || (db.card(S.cards[id].key) || {}).type === "Break")).length - (x.minus || 0)); return x.div ? Math.floor(n / x.div) : x.per ? Math.floor(n / x.per) : n; }   // "このカード以外の、…ブレイクカードN枚につき" (Revise#128); per: any card (Revise#260)
    if (x.battleOppPower) { const b = S.battle; if (!b || !ch) return 0; const opp = b.attacker === ch.id ? (b.guard || (b.target && b.target.ch)) : b.attacker; const n = opp && S.chars[opp] ? S.chars[opp].power.length : 0; return x.div ? Math.floor(n / x.div) : n; }
    if (x.selfBoostPaid) return S.battle && S.battle.attacker === src.ch ? +S.battle.boost || 0 : 0;   // "Xはこのキャラクターから支払われたブーストのコストに等しい" (0015, Revise#361)
    if (x.targetCost) { const c = tTop().cost; return typeof c === "number" ? c : 0; }
    if (x.targetFactor) return Object.values(tTop().factor || {}).reduce((a, b) => a + b, 0);
    if (x.tCost) {   // Revise#351: the printed cost, changed by what the target is
      const q = x.tCost, tch = t.ch && S.chars[t.ch] ? t.ch : null; let c = q.base;
      // A3-25 3700 (Revise#408): "目標が、あなたのプロジェクトカードまたはファストカードを目標に使用宣言されている場合、…コストを無視して使用宣言可能" — the target is a declared card
      if (t.item && (q.rules || []).some(r => r.oppItemCost)) { const it = S.stack.find(z => z.id === t.item), inf = it && it.card && S.cards[it.card] ? db.card(S.cards[it.card].key) || {} : {}; return q.base + (it && it.seat !== src.seat ? (typeof inf.cost === "number" ? inf.cost : +it.x || 0) : 0); }   // A3-22 3131 (M5a): an opponent's card → + its cost
      if (t.card && (q.rules || []).some(r => r.aimsAtYours) && S.stack.some(it => it.card === t.card && (it.targets || []).some(u => u.card && S.cards[u.card] && S.cards[u.card].owner === src.seat && ["Project", "Fast"].includes((db.card(S.cards[u.card].key) || {}).type)))) return 0;
      for (const r of q.rules || []) if (tch && !r.aimsAtYours && !r.oppItemCost && AA4.matchChar(S, db, r.sel || {}, tch, { seat: src.seat }) && (!r.atMaxX || AA4.charStats(S, db, tch).at <= AA4.xOf(S, db, r.atMaxX, { seat: src.seat, card: src.card }, []))) { if (r.free) return 0; c += +r.add || 0; }   // atMaxX: "攻撃力の数値がX以下の場合" (A3-25 3660, Revise#401)
      for (const m of AA4.allMods(S, db)) {
        if (m.key !== "cardCostT") continue; const v = m.value || {};
        if (v.types && !v.types.includes(q.type)) continue;
        if (v.byOpp && m.src && m.src.seat === src.seat) continue;   // only cards used by that player's opponents
        if (v.targetsSrc && !(tch && m.src && m.src.ch === tch)) continue;   // "このキャラクターを対象に含む…"
        if (v.targetSel && !(tch && AA4.matchChar(S, db, v.targetSel, tch, { seat: m.src && m.src.seat != null ? m.src.seat : src.seat }))) continue;
        c += +v.n || 0;
      }
      return Math.max(0, c);
    }
    if (x.freeOn) {   // "このカードを“X”にセット宣言する場合、このカードのコストを無視": 0 on that name, else the printed cost
      const tc = t.ch && S.chars[t.ch] ? AA4.charStats(S, db, t.ch) : null;
      if (x.jp) { const top = tc && db.card(S.cards[AA4.topOf(S.chars[t.ch])].key); return top && (top.jp || "").replace(/\s+/g, "") === x.freeOn ? 0 : x.base; }   // 「card name」 (EP313, Revise#157)
      if (tc && tc.breakCostFree && x.seat != null && S.chars[t.ch].owner === x.seat) return 0;   // A4-PP PP303 (Revise#341)
      return tc && (tc.name === x.freeOn || tc.alsoNames.includes(x.freeOn)) ? 0 : x.base;
    }
    if (x.lastingOn) { const ch0 = src.ch; return new Set(S.modifiers.filter(m => m.to && m.to.ch === ch0 && m.src && m.src.card && S.cards[m.src.card] && S.cards[m.src.card].place.z === "special" && ["Project", "Fast"].includes((db.card(S.cards[m.src.card].key) || {}).type)).map(m => m.src.card)).size; }   // "このキャラクターを対象に含む、効果を発揮している持続のプロジェクトカード・ファストカード1枚につき" (Q#42)
    if (x.iconCount) return ch ? AA4.charStats(S, db, ch.id).icons.length : 0;   // 2900: "Xはこのキャラクターが持つ分類の種類数に等しい"
    if (x.belowSameName) { if (!ch) return 0; const top = db.card(S.cards[src.card || AA4.topOf(ch)].key) || {}, i = ch.stack.indexOf(src.card || AA4.topOf(ch)); return ch.stack.slice(0, Math.max(0, i)).filter(id => (db.card(S.cards[id].key) || {}).name === top.name && top.name).reduce((n, id) => n + (x.belowSameName === "cost" ? +(db.card(S.cards[id].key) || {}).cost || 0 : x.belowSameName === "at" ? +(db.card(S.cards[id].key) || {}).at || 0 : 1), 0); }   // "このカードの下の、このカードと同じネームを持つカード" (count / cost / Attack)
    if (x.battleOppPower) return ch && S.battle ? AA4.battleOppsOf(S, ch.id).reduce((n, o) => n + (S.chars[o] ? S.chars[o].power.length : 0), 0) : 0;   // 3649: "Xはバトル相手のパワーに等しい"
    if (x.battleOppAt) return ch && S.battle ? AA4.battleOppsOf(S, ch.id).reduce((n, o) => n + (S.chars[o] ? (db.card(S.cards[AA4.topOf(S.chars[o])].key) || {}).at || 0 : 0), 0) : 0;   // 2277: "Xはこのキャラクターのバトル相手の攻撃力に等しい" (printed, no loops)
    if (x.ctlCards) {   // "Xはあなたの支配エリアのネームに「ブレイブ」を含むE.G.O.のカードの枚数の合計に等しい" (Revise#141): Break / Character / Permanent cards of your Controlled Characters
      const q = x.ctlCards;
      return AA4.controlledOf(S, src.seat).reduce((n, ch) => n + S.chars[ch].stack.concat(S.chars[ch].perm).filter(id => { const inf = db.card(S.cards[id].key) || {}; return (!q.nameHas || (inf.name || "").includes(q.nameHas)) && (!q.faction || inf.faction === q.faction); }).length, 0);
    }
    if (x.countChars) {   // "Xはそのプレイヤーの、パワー0の支配キャラクターの数に等しい"
      const seat = x.of === "evPlayer" ? src.evSeat : src.seat;
      return Object.keys(S.chars).filter(id => AA4.matchChar(S, db, Object.assign({ seat }, x.countChars), id, { seat, self: src.ch, ch: src.ch })).length;
    }
    if (x.atMinusOppDe) { const ch0 = src.ch && S.chars[src.ch]; if (!ch0) return 0; const o = AA4.battleOppsOf(S, ch0.id)[0], st = AA4.charStats(S, db, ch0.id); return Math.max(0, (st.atMental ? 0 : st.at || 0) - (o && S.chars[o] ? AA4.charStats(S, db, o).de || 0 : 0)); }   // "通常攻撃力の数値からバトル相手の耐久力の数値を引いた数値"
    if (x.powerDiff) { const ch0 = src.ch && S.chars[src.ch]; if (!ch0) return 0; const o = AA4.battleOppsOf(S, ch0.id)[0]; return Math.max(0, ch0.power.length - (o && S.chars[o] ? S.chars[o].power.length : 0)); }
    if (x.battleOppStat) { const ch0 = src.ch && S.chars[src.ch]; return ch0 ? AA4.battleOppsOf(S, ch0.id).reduce((k, o) => k + (S.chars[o] ? AA4.charStats(S, db, o)[x.battleOppStat] || 0 : 0), 0) : 0; }   // "Xはバトル相手の攻撃力の数値の合計に等しい"
    if (x.evStat) return src.evStat ? +src.evStat[x.evStat] || 0 : 0;   // "Xはそのキャラクターの耐久力に等しい" (the character of the event)
    if (x.targetStat) return t.ch && S.chars[t.ch] ? AA4.charStats(S, db, t.ch)[x.targetStat] || 0 : 0;
    if (x.factionsSel) return new Set(AA4.controlledOf(S, src.seat).filter(id => AA4.matchChar(S, db, Object.assign({ seat: src.seat }, x.factionsSel), id, { seat: src.seat })).map(id => AA4.charStats(S, db, id).faction).filter(Boolean)).size;   // "…ブレイクしている異なる勢力のネームレベルキャラクターの数" (EP311, Revise#209)
    if (x.factionsControlled) return new Set(AA4.controlledOf(S, src.seat).map(id => AA4.charStats(S, db, id).faction).filter(Boolean)).size;   // "あなたの支配エリアの異なる勢力のキャラクター分" (A3-25 3619, Revise#173)
    if (x.selfStackSel) { const c = src.ch && S.chars[src.ch]; return c ? c.stack.filter(id => { const i = db.card(S.cards[id].key) || {}; return (i.type === "Break" || S.cards[id].asBreak) && (!x.selfStackSel.faction || i.faction === x.selfStackSel.faction) && (x.selfStackSel.named == null || !!i.name === x.selfStackSel.named); }).length : 0; }   // A3-24 3397 (Revise#173)
    if (x.dmgSameName) { const nm = ch ? AA4.charStats(S, db, ch.id).name : null; if (!nm) return 0; return S.players.filter(p => x.dmgSameName === "all" || p.seat === src.seat).reduce((n, p) => n + p.zones.damage.filter(id => (db.card(S.cards[id].key) || {}).name === nm).length, 0); }   // "…ダメージ置き場にある、このキャラクターと同じネームを持つカードの枚数" (A3-07 1167, Revise#325)
    if (x.selfNamedAny) return ch ? ch.stack.filter(id => x.selfNamedAny.includes((db.card(S.cards[id].key) || {}).name)).length : 0;   // "このキャラクターを構成する“A”または“B”の枚数" (Revise#340)
    if (x.stackNamedCards) { const c0 = x.stackNamedCards === "target" ? ((targets || []).find(r => r.ch && S.chars[r.ch]) || {}).ch : ch && ch.id; const cc = c0 && S.chars[c0]; return cc ? cc.stack.filter(id => !!(db.card(S.cards[id].key) || {}).name).length : 0; }   // "…を構成するネームを持つカードの枚数" (Revise#318)
    if (x.targetStackBreaks) { const t = (targets || []).find(r => r.ch && S.chars[r.ch]); return t ? S.chars[t.ch].stack.filter(id => (db.card(S.cards[id].key) || {}).type === "Break" || (S.cards[id] && S.cards[id].asBreak)).length : 0; }   // A3-21 2913 (Revise#171)
    if (x.sameJpInDamage) { const jp = src.card && S.cards[src.card] ? (db.card(S.cards[src.card].key) || {}).jp : null; return jp ? S.players.reduce((k, p) => k + p.zones.damage.filter(id => (db.card(S.cards[id].key) || {}).jp === jp).length, 0) : 0; }   // A3-11 1686
    if (x.sameJpOnField) { const jp = src.card && S.cards[src.card] ? (db.card(S.cards[src.card].key) || {}).jp : null; return jp ? Object.values(S.chars).reduce((k, o) => k + o.stack.concat(o.perm, o.power).filter(id => (db.card(S.cards[id].key) || {}).jp === jp).length, 0) : 0; }   // "Xは場に出ているこのカードと同じ名称のカードの枚数に等しい" (Revise#164)
    if (x.targetOwnerHand) { const o = t.ch && S.chars[t.ch] ? S.chars[t.ch].owner : t.seat; return o != null && S.players[o] ? S.players[o].zones.hand.length : 0; }   // "Xは目標のオーナーの手札枚数に等しい" (Revise#164)
    if (x.factorSum) { const seat = src.seat, f = x.factorSum; return seat == null ? 0 : AA4.controlledOf(S, seat).reduce((k, id) => { const st = AA4.charStats(S, db, id); return k + (st.faction === f ? 1 : 0) + ((st.factorBonus || {})[f] || 0); }, 0); }   // "Xはあなたとあなたの支配キャラクターの持つ…のファクターの合計に等しい"
    if (x.evCardCost) { const c = src.evCard && S.cards[src.evCard]; const i = c && (db.card(c.key) || {}); return i && typeof i.cost === "number" ? i.cost : i && i.cost != null && !isNaN(+i.cost) ? +i.cost : 0; }   // A3-07 1166: "Xはそのカードのコストに等しい" (Revise#164)
    if (x.targetPower) return t.ch && S.chars[t.ch] ? S.chars[t.ch].power.length : 0;   // 2938 (Revise#152): "Xは目標のパワーに等しい"
    if (x.targetBase) return +tTop()[x.targetBase] || 0;   // 3760: "Xは目標の本来の攻撃力の数値に等しい" (printed)
    if (x.lastingFaction) { const ch0 = src.ch; return new Set(S.modifiers.filter(m => m.to && m.to.ch === ch0 && m.src && m.src.card && S.cards[m.src.card] && S.cards[m.src.card].place.z === "special" && ["Project", "Fast"].includes((db.card(S.cards[m.src.card].key) || {}).type) && (x.lastingFaction === "any" || (db.card(S.cards[m.src.card].key) || {}).faction === x.lastingFaction)).map(m => m.src.card)).size; }   // 3792 (Revise#152): lasting Project / Fast cards of that faction on it
    if (x.belowDrawn) { if (!ch) return 0; const cid = src.card || AA4.topOf(ch), i = ch.stack.indexOf(cid); return ch.stack.slice(0, Math.max(0, i)).filter(id => ((db.card(S.cards[id].key) || {}).jp || "").replace(/\s+/g, "").includes(x.belowDrawn)).length; }   // "このカードの下にある“X”が描かれているカード" (Revise#157)
    if (x.deckCount) return S.players[src.seat] ? S.players[src.seat].zones.deck.length : 0;   // "あなたのデッキ枚数が10枚以下の場合" (Revise#203)
    if (x.permCountSel) return Object.keys(S.chars).filter(id => AA4.matchChar(S, db, Object.assign({ seat: src.seat }, x.permCountSel), id, { seat: src.seat, self: src.ch })).reduce((k, id) => k + S.chars[id].perm.length, 0);   // EX0460
    if (x.charStatSum) return Object.keys(S.chars).filter(id => AA4.matchChar(S, db, Object.assign({ seat: src.seat }, x.charStatSum.sel), id, { seat: src.seat, self: src.ch })).reduce((k, id) => k + (+AA4.charStats(S, db, id)[x.charStatSum.key] || 0), 0);   // "Xはあなたの支配エリアの、ブレイクしている“A”、“B”の攻撃力の数値の合計に等しい" (EP340, Revise#201)
    if (x.distinctNames) return new Set(Object.keys(S.chars).filter(id => AA4.matchChar(S, db, x.distinctNames, id, { seat: src.seat })).map(id => AA4.charStats(S, db, id).name).filter(Boolean)).size;   // "場に…異なるネームを持つ…キャラクターが10体以上いる場合" (EX0626, Revise#201)
    if (x.capChars) return AA4.controlledOf(S, src.seat).filter(id => (AA4.charStats(S, db, id).skills.capacity || 0) >= 1).length;   // 3648: "あなたの支配エリアの、キャパシティ+1以上の…キャラクターの数"
    return 0;
  };
  /** The effect lines a card of a character can use: its own, and — for the top card — the ones the character gained
      ("…はエフェクト「X:…」を得る", Revise#084). Index i of a declaration counts own lines first. */
  AA4.effectsOf = (S, db, chId, cardId) => {
    if (S.cards[cardId] && S.cards[cardId].thread) return [];   // “糸” has no text of its own
    const own = ((db.card(S.cards[cardId].key) || {}).effects) || [];
    const ch = S.chars[chId];
    if (!ch) return own;
    const st = AA4.charStats(S, db, chId), off = st.negatedEffects;   // "…の持つエフェクト1つを無効化する": that line is gone (indexes stay)
    const list = AA4.topOf(ch) === cardId && st.gainedEffects.length ? own.concat(st.gainedEffects) : own;
    return off.length ? list.map(e => (off.includes(e.text) ? Object.assign({}, e, { negated: true }) : e)) : list;
  };
  /** Cards whose skills / effects / abilities a character gains from its structure (A3-25 3809 "覚醒の乙女"). */
  /** 2521 (Q#49): "指定したカードが場またはダメージ置き場またはあなたの手札にある限り" */
  AA4.cardInOk = (S, q) => { const c = S.cards[q.card]; return !!c && (c.place.z === "char" || c.place.z === "damage" || (c.place.z === "hand" && c.owner === q.seat)); };
  AA4.inheritedCards = (S, db, ch) => {
    const topId = AA4.topOf(ch), top = db.card(S.cards[topId].key) || {}, inh = top.inherit;
    const lent = S.modifiers.filter(m => m.key === "inheritCard" && m.to && m.to.ch === ch.id && S.cards[m.value] && (!m.cond || !m.cond.cardIn || AA4.cardInOk(S, m.cond.cardIn))).map(m => m.value);   // "目標の≪…ブレイクカード≫の持つ、スキル・エフェクト・アビリティ全てを得る" (Revise#109)
    if (lent.length) { const seen = new Set([top.jp]); return lent.filter(id => { const jp = (db.card(S.cards[id].key) || {}).jp; if (seen.has(jp)) return false; seen.add(jp); return true; }); }
    if (!inh) return [];
    if (inh.all) { const seen = new Set([top.jp]); return ch.stack.filter(id => { const jp = (db.card(S.cards[id].key) || {}).jp; if (id === topId || seen.has(jp)) return false; seen.add(jp); return true; }); }   // "このカードの下のキャラクターカード・ブレイクカードのスキル・エフェクト・アビリティ全てを持つ"
    const below = ch.stack.filter(id => id !== topId && (db.card(S.cards[id].key) || {}).name === inh.name);
    if (below.length < inh.min) return [];
    const seen = new Set([top.jp]), out = [];
    for (const id of below) { const jp = (db.card(S.cards[id].key) || {}).jp; if (!seen.has(jp)) { seen.add(jp); out.push(id); } }
    return out;
  };
  function applyMod(out, m, S, db) {
    const label = m.src && m.src.label;
    if (Object.prototype.hasOwnProperty.call(out, "_cur")) out._cur = (m.src && m.src.card) || null;
    switch (m.key) {
      case "atm": {   // "攻撃力に+(N)" — mental Attack (Pack, Revise#191): on a mental-Attack character it is its Attack; on a normal one, mental Attack beside it
        const v = +AA4.modValue(S, db, m) || 0;
        add(out, "at", v); out.atPlusM = (out.atPlusM || 0) + v;
        out.parts.push({ label, key: "at", op: "add", n: v, mental: true }); return;
      }
      case "se": case "at": case "de": {
        const v = +AA4.modValue(S, db, m) || 0;
        if (m.op === "set") { out[m.key] = v; if (m.key === "at") out._atSet = true; } else { add(out, m.key, v); if (m.key === "at") out.atPlusN = (out.atPlusN || 0) + v; }   // atPlusN: "攻撃力に+N" (Revise#206)
        out.parts.push({ label, key: m.key, op: m.op, n: v }); return;
      }
      case "factor": out.factorBonus[m.value.faction] = (out.factorBonus[m.value.faction] || 0) + (+m.value.n || 0); return;
      case "noAttack": out.noAttack = true; return;
      case "noAttackOnSrc": if (m.src && m.src.seat != null) out.noAttackOn = (out.noAttackOn || []).concat(m.src.seat); return;   // "≪攻撃力の数値がX未満のキャラクター≫は、あなたに対してアタック宣言できない" (A3-20 2727, Revise#209)
      case "breakableAny": out.breakableAny.push(m.value || {}); return;
      case "guardBreakthrough": out.guardBreakthrough = true; return;
      case "noGuardBy": out.noGuardBy.push(m.value || {}); return;
      case "attackChars": out.attackChars.push(m.value && m.value.srcCh ? { onlyCh: (m.src && m.src.ch) || "__none__" } : m.value || {}); return;   // srcCh: "…は、このキャラクターを目標にアタック宣言可能" (EP378, Revise#367)
      case "noGuardVs": (out.noGuardVs = out.noGuardVs || []).push(m.value || {}); return;   // "…キャラクターを目標にアタック宣言可能"
      case "breakIgnoreName": out.breakIgnoreName = true; return;   // "このキャラクターを、ネームを無視してブレイク可能"   // "分類に関わらず、≪このキャラクター≫を(…のブレイクカードで)ブレイク可能"
      case "breakFast": out.breakFast = m.value && (m.value.tag || m.value.works || m.value.sameName || m.value.name || m.value.all || m.value.by != null) ? (m.value.by === "you" ? Object.assign({}, m.value, { by: m.src ? m.src.seat : null }) : m.value) : true; return;   // {all}: any player (0702), {by}: that player (0843) — Revise#249   // {works}: only with a Break card of that title   // "支配エリアのこのキャラクターを、ファストカードのタイミングでブレイク可能"
      case "alsoName": out.alsoNames.push(m.value); if (m.value && !out.name) { out.name = m.value; out.named = true; } return;   // a character without a name gets it (Revise#137)
      case "payFor": out.payFor = out.payFor.concat((m.value.kinds || []).map(kind => ({ kind, icons: m.value.icons || null, tokenName: m.value.tokenName || null, nameHas: m.value.nameHas || null, sel: m.value.sel || null }))); return;
      case "noPay": if (m.value && typeof m.value === "object" && m.value.kinds) out.noPayKinds = (out.noPayKinds || []).concat(m.value.kinds); else out.noPay = true; return;   // kinds: "アタックコスト・ガードコストを支払うことはできない" (Revise#166)
      case "leaveToHand": out.leaveToHand = true; return;
      case "dmgToOwner": out.dmgToOwner = m.value && m.value.all ? "all" : out.dmgToOwner || true; return;
      case "statSwap": out.statSwap = true; return;
      case "redoOnPerm": out.redoOnPerm = true; return;
      case "noEffect": out.noEffect = true; return;
      case "killDamageChars": out.killDamageChars = true; return;
      case "noKeepVictims": out.noKeepVictims = m.value && m.value.battle && out.noKeepVictims !== true ? "battle" : true; return;   // {battle}: only its battle opponent (EP351, Revise#201)
      case "noKeep": out.noKeep = true; return;
      case "noBreakByOpp": out.noBreakByOpp = true; return;
      case "guardFree": out.guardFree = true; return;   // "ガードコストを無視してガード宣言可能" (A3-20 2727, Revise#172)
      case "killToDamageUnbroken": out.killToDamageUnbroken = true; return;
      case "swapSeDe": out._swapSD = !out._swapSD; return;   // "そのキャラクターを場に残す効果を受けない" (Revise#166)
      case "noFactor": out.noFactor = true; return;
      case "lossPlus": if (typeof m.value === "number") out.lossPlusN = (out.lossPlusN || 0) + m.value; else out.lossPlus = true; return;
      case "stopOnBreak": out.stopOnBreak = true; return;
      case "fateLink": case "fateBattle": case "permKeep": case "demonKeep": case "permZeroPower": case "shioriWard": case "leaveHit": case "battleEndToDamage": return;
      case "autoGuard": out.autoGuard = true; return;
      case "noKeepAll": case "damageTextOff": case "seeDraws": return;
      case "hurtMark": (out.hurtMark = out.hurtMark || []).push(...[].concat(m.value || [])); return;
      case "takeForAllies": out.takeForAllies = true; return;
      case "dualAtk": out.dualAtk = true; return;
      case "costToChars": out.costToChars = true; return;
      case "fastPerm": out.fastPerm = true; return;
      case "breakByName": if (m.value && m.value.nameOnly) (out.breakNameOk = out.breakNameOk || []).push(m.value.name); else (out.breakByNames = out.breakByNames || []).push(m.value && m.value.name); return;   // nameOnly: "ネームに関わらず、≪このキャラクター≫を“X”でブレイク可能" (Revise#141)
      case "guardStealth": out.guardStealth = true; return;   // "≪このキャラクター≫はステルスを持つキャラクターをガード可能" (Revise#141)
      case "declDropPower": case "guardHit": case "mergeDamage": return;
      case "absorbOpp": out.absorbOpp = true; return;   // Q#42
      case "dmgBackToSource": out.dmgBackToSource = true; return;   // Q#39
      case "bindHand": out.bindHand = true; return;
      case "raid": out.raid = m.value || {}; return;   // Q#43
      case "forceZeroGuard": out.forceZeroGuard = true; return;
      case "synchroAny": return;
      case "targetTax": out.targetTax = m.value && typeof m.value === "object" ? m.value : true; return;   // Q#44
      case "breakTaxMine": out.breakTaxMine = true; return;   // 3116
      case "guardTaxIfPaid": out.guardTaxIfPaid = true; return;   // 3573
      case "lossMinusOpp": out.lossMinusOpp = m.value; return;   // 3650
      case "removeFailDump": out.removeFailDump = true; return;   // 3686
      case "removeByMill": out.removeByMill = true; return;   // 3266
      case "permNoFactor": out.permNoFactor = m.value || {}; return;   // 3652 / 3266
      case "perAggRemove": out.perAggRemove = true; return;   // 3266
      case "permDouble": return;
      case "areaRod": out.areaRod = true; return;   // 0233
      case "retargetAny": case "projShield": return;
      case "jointBattle": out.jointBattle = m.value || {}; return;   // Q#57
      case "unguardableInit": out.unguardableInit = m.value || 3; return;   // Q#56 (3394)
      case "boostGuardTax": out.boostGuardTax = true; return;   // 3390
      case "subPayBoost": out.subPayBoost = true; return;   // 3263
      case "subPayDoom": case "breakAsChar": case "handDiscardToDamage": case "discardRecall": case "pileImmune": case "drawTutor": case "revealDraws": case "overDrawDiscard": case "nonHandSetDiscard": return;
      case "millForMental": out.millForMental = true; return;   // 3688
      case "retreatVsStrong": out.retreatVsStrong = true; return;   // 3121
      case "projFast": out.projFast = true; return;   // Q#52
      case "permFromCost": out.permFromCost = true; return;   // Q#54
      case "pileTextOff": case "redirectNext": return;
      case "breakWithPower": out.breakWithPower = true; return;
      case "leaveToDamage": out.leaveToDamage = true; return;
      case "leavePermHand": out.leavePermHand = (out.leavePermHand || 0) + (+m.value || 1); return;   // Revise#275
      case "leaveNamedDamage": (out.leaveNamedDamage = out.leaveNamedDamage || []).push(m.value); return;   // Revise#271
      case "sameNameMulti": out.sameNameMulti = true; return;   // A3-04 0702 (Revise#249): any player may break it although it has power cards
      case "breakPowerToDamage": out.breakPowerToDamage = true; return;   // … and its power cards go to their owners' Damage Piles then
      case "puppet": out.noSet = true; return;
      case "guessName": out.guessName = true; return;   // Q#50
      case "battleEndAll": case "tokenKeep": case "drawDouble": return;
      case "zeroPowerDie": out.zeroPowerDie = true; return;
      case "zeroPowerCardDie": if (m.src && m.src.card) (out.zeroPowerCards = out.zeroPowerCards || []).push(m.src.card); return;   // A3-PP PP075 (Revise#342)
      case "noRespIfOnly": out.noRespIfOnly = true; return;
      case "stackAllIcons": { const c = S.chars[out.id]; if (c) { const fs = new Set(); for (const id of c.stack) { if (id === AA4.topOf(c)) continue; const inf = db.card(S.cards[id].key) || {}; for (const i of inf.icons || []) if (!out.icons.includes(i)) out.icons.push(i); if (inf.faction) fs.add(inf.faction); } for (const f of fs) out.factorBonus[f] = (out.factorBonus[f] || 0) + 1; } return; }   // 2900 (Revise#151)
      case "battleOppSkillsOff": if ((m.value && m.value.ofSel) ? AA4.battleOppsOf(S, out.id).some(o => S.chars[o] && AA4.matchChar(S, db, m.value.ofSel, o, { seat: m.src && m.src.seat })) : (w => w && w !== out.id && S.chars[w] && AA4.battleOppsOf(S, w).includes(out.id))((m.value && m.value.of) || (m.src && m.src.ch))) { out.skills = {}; out.negated.skills = true; } return;   // 3753
      case "reflectNext": return;
      case "battleKillSplit": out.battleKillSplit = true; return;
      case "doomMain": case "onEnterPower": case "designatedBy": case "guardStrip": return;
      case "copyAllEffects": for (const o of Object.values(S.chars)) if (o.id !== chId) { const oi = db.card(S.cards[AA4.topOf(o)].key) || {}; for (const ef of oi.effects || []) if (!out.gainedEffects.some(e => e.text === ef.text)) out.gainedEffects.push(Object.assign({ gained: AA4.cardName(oi) }, ef)); } return;   // 2277: "このキャラクター以外のキャラクターの持つエフェクト全てを持つ"
      case "copyOppSkills": if (S.battle) for (const o of AA4.battleOppsOf(S, chId)) if (S.chars[o]) { const oi = db.card(S.cards[AA4.topOf(S.chars[o])].key) || {}; for (const [k, v] of Object.entries(oi.skills || {})) out.skills[k] = mergeSkill(out.skills[k], v, k, out); } return;   // "…バトル相手の持つスキル全てを得る" (printed skills)
      case "copyMachineSkills": for (const o of AA4.charsOf(S, ch.owner)) if (o !== chId) { const oi = db.card(S.cards[AA4.topOf(S.chars[o])].key) || {}; if ((oi.icons || []).includes("マシン")) for (const [k, v] of Object.entries(oi.skills || {})) out.skills[k] = mergeSkill(out.skills[k], v, k, out); } return;   // 2867: "このキャラクター以外のあなたのテリトリーのマシンの持つスキル全てを持つ" (printed skills)
      case "zeroGuardDie": out.zeroGuardDie = true; return;   // "目標にカードをセットすることはできない" (Q#51)
      case "tripleHit": out.tripleHit = true; return;
      case "multiHit": out.multiHit = Math.max(out.multiHit || 1, +AA4.modValue(S, db, m) || 1); return;   // EP187: "X回同時にダメージを与える"
      case "hitTwice": out.hitTwice = true; return;   // EP167: "通常のダメージ判定の後、追加でもう一度ダメージ判定を行う"
      case "takeForOwner": out.takeForOwner = true; return;   // EP227 / EX0265: "このキャラクターのオーナーに与えられたダメージは、≪このキャラクター≫が代わりに受ける"
      case "payToDamageBoost": out.payToDamageBoost = m.value || { at: 2 }; return;   // EP191
      case "followAttack": out.followAttack = true; return;   // EP188
      case "costCharsToHand": out.costCharsToHand = true; return;   // EP353
      case "permShield": out.permShield = true; return;   // EX0039
      case "permDamageShield": out.permDamageShield = true; return;   // EX0378
      case "nameMillShield": out.nameMillShield = true; return;   // EX0164
      case "dualTiming": out.dualTiming = true; return;   // EX0256
      case "payBack": out.payBack = m.value; return;   // EXPP024
      case "extraTargets": out.extraTargets = m.value; return;   // EX0250
      case "oppProjHit": out.oppProjHit = true; return;   // EX0515
      case "swapAtDe": out.swapAtDe = true; return;   // A3-03 0485
      case "payDoom": return;
      case "freeJoin": out.freeJoin = true; return;   // EX0173
      case "doomIfName": (out.doomIfName = out.doomIfName || []).push(m.value); return;   // EX0182   // Q#45
      case "costToToken": out.costToToken = m.value; return;
      case "sameNameKeep": return;   // 二階堂優芽 (Revise#143)
      case "instantFeed": out.instantFeed = true; return;
      case "effCostCap": out.effCostCap = true; return;
      case "sacPay": (out.sacPay = out.sacPay || []).push(m.value || {}); return;
      case "breakCostFree": out.breakCostFree = true; return;   // "このキャラクターにブレイクカードをセット宣言する場合、…コストを無視" (Revise#341)
      case "permFactionGuard": { const fs = [...new Set(((S.chars[out.id] || {}).perm || []).map(id => (db.card(S.cards[id].key) || {}).faction).filter(Boolean))]; if (fs.length) for (const id of ["resist", "protect"]) out.skills[id] = mergeSkill(out.skills[id], { factions: fs, icons: [] }, id, out); return; }   // A4-01 0176 (Revise#341): Resist / Protect against the factions of its Permanent cards
      case "baseSkills": { const c0 = S.chars[out.id]; for (const id of (c0 ? c0.stack : [])) { const i0 = db.card(S.cards[id].key) || {}; if (i0.type === "Character") for (const [k, v] of Object.entries(i0.skills || {})) out.skills[k] = mergeSkill(out.skills[k], v, k, out); } return; }   // A3-EX02 EX0114 (Revise#346): the skills of the Character cards in its stack
      case "effDmgUp": out.effDmgUp = (out.effDmgUp || 0) + (+m.value || 0); return;   // "エフェクトによって与えるダメージの数値に+N" (EX0728, Revise#347)
      case "subPayBuff": out.subPayBuff = m.value || null; return;   // A4-01 0111 (Revise#349)
      case "dmgToSource": out.dmgToSource = Object.assign({}, out.dmgToSource || {}, m.value || {}); return;   // PP245 / 1630 (Revise#353)
      case "dmgToOwner": out.dmgToOwner = true; return;   // PP114
      case "handBoost": out.handBoost = true; return;
      case "bindSac": out.bindSac = true; return;
      case "drawPeek": case "dmgCap4": return;
      case "battleEndKill": out.battleEndKill = true; return;
      case "factorAll": case "playerDmgCut": case "playerNoDamage": return;
      case "boostAtk": if (S.battle && S.battle.attacker === out.id && S.battle.boost) add(out, "at", (+(m.value && m.value.per) || 2) * S.battle.boost); return;   // "このキャラクターから支払われたブーストのコスト1につき、…攻撃力に+2して判定する" (Revise#137)
      case "decoy": out.decoy = true; return;
      case "stackCharSkills": case "stackCharIcons": {   // 皆川麗夢 (Revise#132): "そのキャラクターを構成するキャラクターカードのスキル全て / 分類全て"
        const c = S.chars[out.id];
        if (c) for (const id of c.stack) { const inf = db.card(S.cards[id].key) || {}; if (inf.type !== "Character") continue;
          if (m.key === "stackCharSkills") for (const [k, v] of Object.entries(inf.skills || {})) out.skills[k] = mergeSkill(out.skills[k], v, k, out);
          else for (const i of inf.icons || []) if (!out.icons.includes(i)) out.icons.push(i); }
        return;
      }
      case "breakMinus": { const c = S.chars[out.id]; if (c && m.value && AA4.topOf(c) !== m.value.top) add(out, "se", -(+m.value.x || 0)); return; }   // カッサンドラ: "目標にブレイクカードがセットされた場合、…目標の精神力に-Xする" (Revise#132)
      case "battleOppNegate":   // シルマリル (Revise#131): "このキャラクターがバトルする際、≪…バトル相手を対象に含む…と、このキャラクターのバトル相手のスキル・エフェクト全て≫を無効化する"
        if (m.src && m.src.ch && m.src.ch !== out.id && S.chars[m.src.ch] && AA4.battleOppsOf(S, m.src.ch).includes(out.id)) {
          out.skills = {}; out.negated.skills = true; out.negated.effects = true;
          out.untargetable.push({ label, from: ["Project", "Fast", "Effect"] });
          out.parts.push({ label, key: "negate", n: "skills and effects (battle)" });
        }
        return;
      case "noPayFor": (out.noPayFor = out.noPayFor || []).push(...[].concat((m.value && m.value.kinds) || [])); return;
      case "zeroDmgPower": out.zeroDmgPower = true; return;
      case "stackCharSkills": { const ch = S.chars[chId]; if (ch) for (const id of ch.stack) { const inf = S.cards[id] && db.card(S.cards[id].key); if (inf && inf.type === "Character" && inf.skills) for (const [k, v] of Object.entries(inf.skills)) out.skills[k] = mergeSkill(out.skills[k], v, k, out); } return; }   // A3-22 3305 (Revise#170)
      case "copyBattleOppSkills": { if (AA4._cbos) return; AA4._cbos = true; try { for (const w of AA4.battleOppsOf(S, out.id)) if (S.chars[w]) for (const [k, v] of Object.entries(AA4.charStats(S, db, w).skills || {})) out.skills[k] = mergeSkill(out.skills[k], v, k, out); } finally { AA4._cbos = false; } return; }   // "バトルする際、…バトル相手の持つスキル全てを得る" (EP422, Revise#355)
      case "copySkillsOf": { const o = m.value && S.chars[m.value] && !(m.to && m.to.ch === m.value) ? AA4.charStats(S, db, m.value) : null; if (o) for (const [k, v] of Object.entries(o.skills || {})) out.skills[k] = mergeSkill(out.skills[k], v, k, out); return; }   // "目標のスキル全てを得る" (Revise#130)
      case "altPay":
        if (m.value && (m.value.kinds || m.value.self)) { (out.altPayX = out.altPayX || []).push({ kind: m.value.kind, kinds: m.value.kinds || null, card: m.value.self && m.src ? m.src.card : null, to: m.value.to || null }); return; }   // + kind "hand" with kinds (Revise#174)   // "このカードを捨て札することで、≪このキャラクター≫からアタックコストを支払ったものとして扱う" (A3-08 1280, Revise#170)
        (out.altPay = out.altPay || []).push((m.value && m.value.kind) || "hand"); if (m.value && m.value.kind === "discTop" && m.src) (out.altPaySrc = out.altPaySrc || {}).discTop = m.src.card; return;
      case "leaveToDeck": out.leaveToDeck = true; return;
      case "bindRecycle": out.bindRecycle = true; return;
      case "copyOppBreakSkills": {   // "対戦相手のテリトリーと、対戦相手のダメージ置き場の、異なるカード名称の、ネームを持つブレイクカード全てのスキル全てを持つ"
        const me = S.chars[m.to && m.to.ch] ? S.chars[m.to.ch].owner : m.src && m.src.seat, seen = new Set();
        const take = id => { const inf = db.card(S.cards[id].key) || {}; if (inf.type !== "Break" || !inf.name || seen.has(inf.jp)) return; seen.add(inf.jp); for (const [k, v] of Object.entries(inf.skills || {})) out.skills[k] = mergeSkill(out.skills[k], v, k, out); };
        for (const o of Object.values(S.chars)) {
          if (o.owner === me) continue;
          const had = new Set(seen);
          o.stack.forEach(take);
          const named = o.stack.some(id => { const inf = db.card(S.cards[id].key) || {}; return inf.type === "Break" && inf.name && !had.has(inf.jp); });
          if (named && o.id !== (m.to && m.to.ch)) for (const [k, v] of Object.entries(AA4.charStats(S, db, o.id).skills || {})) out.skills[k] = mergeSkill(out.skills[k], v, k, out);   // the skills it has now, gained ones too (Pack, Revise#127)
        }
        for (const p of S.players) if (p.seat !== me) p.zones.damage.forEach(take);
        return;
      }
      case "chargeLock": out.chargeLock = true; return;
      case "token": return;
      case "atToMental": { const v = +AA4.modValue(S, db, m) || 0; out.atToMental = (out.atToMental || 0) + v; out.parts.push({ label, key: "at", n: -v }, { label, key: "at", n: v, mental: true }); return; }   // "攻撃力に-X・+(X)する" — in the Status table (Revise#238)
      case "atToNormal": { const v = +AA4.modValue(S, db, m) || 0; out.atToNormal = (out.atToNormal || 0) + v; out.parts.push({ label, key: "at", n: v }, { label, key: "at", n: -v, mental: true }); return; }   // "攻撃力に+X・-(X)する"
      case "battleTax": out.battleTax = Object.assign({}, out.battleTax || {}, m.value || {}); return;
      case "attackableBy": (out.attackableBy = out.attackableBy || []).push(m.value && m.value.srcSelf ? { chIs: m.src && m.src.ch } : m.value || {}); return;   // srcSelf: "≪このキャラクター≫は、“X”を目標にアタック宣言可能" (Revise#157)
      case "battleKillTo": out.battleKillTo = true; return;
      case "battleSpare": out.battleSpare = true; return;   // "目標からコストを支払うことはできない" (Revise#109)
      case "noGuard": out.noGuard = true; return;
      case "noCharge": out.noCharge = true; return;
      case "noSetOn": out.noSet = true; out.noCharge = true; return;   // A3-02 0422 (Revise#161): "カードをセットすることができない"
      case "negate":
        if (m.value && m.value.skills) out.skills = {};
        if (m.value && m.value.effCostMax != null) { out.negated.effCostMax = Math.max(out.negated.effCostMax == null ? -1 : out.negated.effCostMax, +m.value.effCostMax || 0); }
        else if (!m.value || m.value.effects) out.negated.effects = true;
        if (m.value && m.value.skills) out.negated.skills = true;
        out.parts.push({ label, key: "negate", n: m.value && m.value.skills ? (m.value.effects ? "skills and effects" : "skills") : "effects" }); return;
      case "atMental": out.atMental = !!m.value; return;
      case "skill":
        if (m.op !== "remove" && m.value && m.value.x && typeof m.value.x === "object" && m.value.x.x) { const xv = (m.value.x.sign || 1) * AA4.xOf(S, db, m.value.x.x, m.src || {}); if (!xv) return; m = Object.assign({}, m, { value: Object.assign({}, m.value, { x: xv }) }); }   // "…N枚につき、チャージ1を得" (Revise#260)
        if (m.op === "remove") { delete out.skills[m.value.id]; if (m.value.id === "bind") out.bindList = []; }
        else if (m.value.id === "initiative" && m.op !== "remove") { out.initCount++; out.skills.initiative = mergeSkill(out.skills.initiative, m.value.x); }
        else if (m.value.set) { out.skills[m.value.id] = m.value.x; if (m.value.id === "bind") out.bindList = []; }   // "バインド0を得る": the value becomes that (Revise#152)
        else out.skills[m.value.id] = mergeSkill(out.skills[m.value.id], m.value.x, m.value.id, out);
        out.parts.push(Object.assign({ label, key: "skill", op: m.op, n: m.value.id }, typeof m.value.x === "number" ? { v: m.value.x } : {})); return;   // v: "Permanent +1" (Pack, Revise#235)
      case "allIcons": { if (!AA4._allIcons) AA4._allIcons = [...new Set(db.all().flatMap(c => c.icons || []))]; for (const i of AA4._allIcons) if (!out.icons.includes(i)) out.icons.push(i); return; }   // "≪このキャラクター≫は、全ての分類を持つ" (Revise#144)
      case "icon":
        if (m.op === "remove") out.icons = out.icons.filter(i => i !== m.value); else if (!out.icons.includes(m.value)) out.icons.push(m.value);
        return;
      case "attackCost": case "guardCost": case "effectCost": case "permLimit": {
        const n = m.value && m.value.ownerHand ? (m.value.sign || 1) * ((S.players[out.owner] || { zones: { hand: [] } }).zones.hand.length) : +AA4.modValue(S, db, m) || 0;   // a number, or {x, sign} ("…のコストはX上昇する"); {ownerHand}: "Xはそのキャラクターのオーナーの手札枚数" (2004, Revise#179)
        out[m.key] += n; out.parts.push({ label, key: m.key, n }); return;
      }
      case "dmgReduce": { const v = m.value || {}, xv = v.x ? AA4.xOf(S, db, v.x, m.src || {}) : 0; out.dmgReduce.normal += (+v.normal || 0) + (v.x && v.which !== "mental" ? xv : 0); out.dmgReduce.mental += (+v.mental || 0) + (v.x && v.which !== "normal" ? xv : 0); return; }   // {x, which}: "…に与えられるダメージにー(X)して判定する" (Revise#140)
      case "guardTaxVs": out.guardTaxVs = (out.guardTaxVs || 0) + (+m.value || 0); return;
      case "noDiscard": out.noDiscard = Object.assign({}, out.noDiscard || {}, m.value || {}); return;
      case "negateEffect": if (m.value && m.value.text) out.negatedEffects.push(m.value.text); return;
      case "duelNamed": out.duelNamed = m.value || {}; return;
      case "ignoreOwn": return;
      case "noDamage": out.noDamage.push(Object.assign({ label }, m.value || {}, m.value && m.value.fromSrc ? { fromCh: m.src && m.src.ch } : {})); return;
      case "effect": if (m.value && !out.gainedEffects.some(e => e.text === m.value.text)) out.gainedEffects.push(Object.assign({ gained: label || true }, m.value)); return;   // "エフェクト「…」を得る"
      case "untargetable": out.untargetable.push(Object.assign({ label }, m.value || {}, m.value && m.value.costMaxSrcPower && m.src ? { srcCh: m.src.ch } : {}, m.value && m.value.exceptCard && m.src ? { exceptCardId: m.src.card } : {})); return;
      default: return;
    }
  }
  /** Two copies of a valued skill add up (Charge 1 + Charge 1 = 2); on / off skills stay true. */
  function mergeSkill(old, x, id, out) {
    if (x === true || x == null) return old || true;
    if (id === "bind" && typeof x === "number" && out) { (out.bindList = out.bindList || []).push(x); return Math.max(typeof old === "number" ? old : 0, x); }   // Pack (Revise#372): several Bind X are not added up — each one is its own way to pay (Bind 1 and Bind 3: 1 or 3 power cards, never 4)
    if (typeof x === "number") return (typeof old === "number" ? old : 0) + x;
    return x;   // structured skills (Resist / Protect / Search): the newest wins
  }

  /** Player values: hand limit (7 ± Capacity), draw (1 ± Draw), charge (sum of Charge X) — from controlled characters. */
  AA4.playerStats = (S, db, seat) => {
    const c = cache(S);
    if (c.players.has(seat)) return c.players.get(seat);
    const out = { handLimit: AA4.HAND_LIMIT, draw: 1, charge: 0, powerVisible: false, noHandCharge: false, fastBreak: [], skills: {} };
    for (const chId of AA4.charsOf(S, seat)) {
      if (!AA4.isControlled(S.chars[chId])) continue;
      const st = AA4.charStats(S, db, chId);
      if (typeof st.skills.capacity === "number") out.handLimit += st.skills.capacity;
      if (typeof st.skills.draw === "number") out.draw += st.skills.draw;
      if (typeof st.skills.charge === "number") out.charge += st.skills.charge;
    }
    for (const m of AA4.allMods(S, db)) {
      if (!AA4.modAppliesToSeat(S, m, seat) || !["handLimit", "draw", "charge", "powerVisible", "noHandCharge", "fastBreak"].includes(m.key)) continue;
      if (!condOk(S, db, m, { seat, src: m.src })) continue;
      if (m.key === "powerVisible") out.powerVisible = true;
      else if (m.key === "noHandCharge") out.noHandCharge = true;   // "…は、手札をパワーカードとしてセットすることはできない" (Revise#109)
      else if (m.key === "fastBreak") out.fastBreak.push(m.value || {});   // "≪あなた≫は、…を持つブレイクカードを、ファストカードのタイミングでセット宣言可能"
      else if (m.op === "set") out[m.key] = +m.value; else out[m.key] += +AA4.modValue(S, db, m);   // a number, or {x, sign} ("ドロー+X")
    }
    for (const m of AA4.allMods(S, db)) {   // the Player's own skills (Pack, Revise#214): "≪あなた≫はチャージ5を得る" (A3-18 2466) — Charge / Draw / Capacity count like a character's
      if (m.key !== "skill" || !m.value || !m.value.id || !AA4.modAppliesToSeat(S, m, seat) || !condOk(S, db, m, { seat, src: m.src })) continue;
      const id = m.value.id, x = typeof m.value.x === "number" ? m.value.x : null;
      if (m.op === "remove") { delete out.skills[id]; if (id === "bind") out.bindList = []; continue; }
      out.skills[id] = x != null ? (typeof out.skills[id] === "number" ? out.skills[id] + x : x) : true;
      if (x != null && id === "charge") out.charge += x;
      if (x != null && id === "draw") out.draw += x;
      if (x != null && id === "capacity") out.handLimit += x;
    }
    if (AA4.allMods(S, db).some(m => m.key === "drawDouble" && AA4.modAppliesToSeat(S, m, seat))) out.draw *= 2;   // 3119 (Revise#148): "ドローフェイズのドローの際に、本来の2倍ドローする"
    out.handLimit = Math.max(0, out.handLimit); out.draw = Math.max(0, out.draw); out.charge = Math.max(0, out.charge);
    c.players.set(seat, out);
    return out;
  };

  /** Declaration Ban (Revise#013): decl = {kind: "set"|"attack"|"guard"|"effect", info?: card info}. → banning modifier or null. */
  AA4.banOf = (S, db, seat, decl) => {
    for (const m of AA4.allMods(S, db)) {
      if (m.key !== "ban" || !AA4.modAppliesToSeat(S, m, seat)) continue;
      const b = m.value || {}, info = decl.info || {};
      if (b.decl && b.decl !== "any" && b.decl !== decl.kind) continue;
      if (b.type && b.type !== info.type) continue;
      if (b.types && !b.types.includes(info.type)) continue;   // Revise#141
      if (b.costMax && !((info.cost === "X" ? 0 : +info.cost || 0) <= AA4.xOf(S, db, b.costMax, m.src || {}))) continue;   // 水樹鏡花: "Xコスト以下のプロジェクトカード・ファストカードを使用宣言することができない"
      if (b.name && b.name !== info.jp && b.name !== info.name) continue;
      if (b.names && !b.names.includes(info.name)) continue;   // "“なつき”または“ふぶき”のネームを持つカードは使用宣言できない" (Revise#132)
      if (b.nameInDamage && (b.exceptType === info.type || !S.players.some(p => p.zones.damage.some(id => (db.card(S.cards[id].key) || {}).jp === info.jp)))) continue;   // "…ダメージ置き場に置かれているカードと同じ名称のカードを使用宣言できない"
      if (b.damageTypes && !S.players.some(p => p.zones.damage.some(id => { const i = db.card(S.cards[id].key) || {}; return b.damageTypes.includes(i.type) && i.jp === info.jp; }))) continue;   // "ダメージ置き場に置かれているプロジェクトカード・ファストカードと同じ名称のカード" (Revise#129)
      if (b.faction && b.faction !== info.faction) continue;
      if (b.icon && !(info.icons || []).includes(b.icon)) continue;
      if (b.areaTarget && !(info.play && (!info.play.target || info.play.target.count === "all") && /"all":/.test(JSON.stringify(info.play.steps || [])))) continue;   // 3046: "効果範囲目標のプロジェクトカード・ファストカード"
      if (b.costEq != null && info.cost !== b.costEq) continue;   // "指定した数のコストの…カードは使用宣言できない" (PP212, Revise#359)
      if (b.costIsX && info.cost !== "X") continue;   // 3119: "本来のコストがXの、Xを任意で指定する…カード"
      if (b.notType && info.type === b.notType) continue;
      if (!condOk(S, db, m, { seat, src: m.src })) continue;
      return m;
    }
    return null;
  };
  /** Card cost changes (C2: "≪極星帝国のプロジェクトカード≫のコストは1上昇する"). */
  /** Q#59 (Revise#155): 3616 "追加のコストを支払う場合、代わりに、そのカードの本来のコスト分、自分のデッキを捨て札することが可能" */
  AA4.millAltOffer = (S, db, seat, info) => typeof info.cost === "number" && AA4.allMods(S, db).some(m => m.key === "cardCost" && m.value && m.value.millAlt && AA4.modAppliesToSeat(S, m, seat));
  AA4.cardCostMod = (S, db, seat, info, opts) => {
    let n = 0;
    for (const m of AA4.allMods(S, db)) {
      if (m.key !== "cardCost" || !AA4.modAppliesToSeat(S, m, seat)) continue;
      const v = m.value || {}, sel = v.sel || {};
      if (opts && opts.skipMillAlt && v.millAlt) continue;   // Q#59: this extra is replaced by milling
      if (sel.types && !sel.types.includes(info.type)) continue;
      if (sel.faction && sel.faction !== info.faction) continue;
      if (sel.icons && !(info.icons || []).some(i => sel.icons.includes(i))) continue;   // Revise#139
      if (sel.tag && !(info.tags || []).includes(sel.tag)) continue;   // EX0428 (Revise#157)
      if (sel.named != null && !!info.name !== sel.named) continue;
      if (sel.works && !AA4.worksOf(info, sel.works)) continue;
      if (sel.names && !(info.name && sel.names.includes(String(info.name).replace(/\s+/g, "")))) continue;   // EP522 (Revise#229): "≪あなたの“バスターマシン1号”と“ガンバスター”≫のコスト"
      if (v.firstInTurn) { const u = S.players[seat].usedTurn; if (u && u.turn === S.turn.number && u.keys.some(k => { const i2 = db.card(k) || {}; return (!sel.types || sel.types.includes(i2.type)) && (sel.named == null || !!i2.name === sel.named) && (!sel.works || AA4.worksOf(i2, sel.works)); })) continue; }   // EX0389
      if (sel.iconsOrText && !((info.icons || []).some(i => sel.iconsOrText.includes(i)) || /鬼/.test(info.text || ""))) continue;   // 3229 (Revise#152): "分類鬼・鬼♂を持つか、カードテキストに分類鬼・鬼♂を含むカード"
      if (v.firstInMain && !AA4.firstInMain(S, seat, info.type)) continue;   // "最初に使用するプロジェクトカードのコストに-X" (Revise#140)
      if (sel.baseCost != null && info.cost !== sel.baseCost) continue;   // "≪本来のコストが0のカード全て≫のコストは1上昇する": the printed cost
      if (!condOk(S, db, m, { seat, src: m.src })) continue;
      { const k = v.byFactor ? Object.values(info.factor || {}).reduce((a, b) => a + (+b || 0), 0) : v.n && typeof v.n === "object" && v.n.x ? (v.n.sign || 1) * AA4.xOf(S, db, v.n.x, m.src || {}) : +v.n || 0;   // "…のコストはX上昇する。Xは…" / A3-02 0240: X = its factor
        n += v.minCost != null && typeof info.cost === "number" ? Math.max(k, Math.min(0, v.minCost - info.cost)) : k; }   // "この効果で、コストは1未満にはならない" (Revise#148)
    }
    return n;
  };
  AA4.banReason = (S, db, m) => `Banned by ${m.src && m.src.label ? m.src.label : "a field effect"}`;

  /** Cost Destination Rules (Revise#029 / #030 / #061) for one payment:
      pay = {kind: "set"|"attack"|"guard"|"effect", seat, ch (who paid), info (declared card), target: {seat}|{ch}, against: ch}
      → [{to: "hand"|"damage"|"deckTop"|"deckBottom"|"discard", label}] (empty = Discard Pile). */
  AA4.costRules = (S, db, pay) => {
    const out = [];
    const st = pay.ch && S.chars[pay.ch] ? AA4.charStats(S, db, pay.ch) : null;
    if (st && st.controlled) {
      if (st.skills.infinity && ["attack", "guard", "effect"].includes(pay.kind)) out.push({ to: "hand", label: "Infinity" });
      if (st.skills.offensive && pay.kind === "attack" && pay.target && pay.target.seat != null) out.push({ to: "hand", label: "Offensive" });
      if (st.skills.defensive && pay.kind === "guard" && pay.against && S.chars[pay.against] && AA4.isControlled(S.chars[pay.against])) out.push({ to: "hand", label: "Defensive" });
    }
    for (const r of pay.extra || []) out.push(r);   // the effect's own text ("このエフェクトのコストを手札に戻す")
    const tName = pay.targetCh && S.chars[pay.targetCh] ? AA4.charStats(S, db, pay.targetCh).name : "";
    if (pay.kind === "set" && pay.info && pay.info.costBack && (!pay.info.costBack.sameName || (pay.info.name && pay.info.name === tName)) && (!pay.info.costBack.onName || pay.info.costBack.onName === tName) && (!pay.info.costBack.onPerm || (pay.targetCh && S.chars[pay.targetCh] && S.chars[pay.targetCh].perm.some(id => ((db.card(S.cards[id].key) || {}).jp || "").replace(/\s+/g, "") === pay.info.costBack.onPerm))))   // onPerm: A3-05 0837 (Revise#161)
      out.push({ to: pay.info.costBack.to, label: "This card" });   // "このカードを同じネームを持つキャラクターにセット宣言…コストは手札に戻る"
    for (const m of AA4.allMods(S, db)) {
      if (m.key !== "dest" || !AA4.modAppliesToSeat(S, m, pay.seat)) continue;
      const v = m.value || {};
      if (v.cost && ![].concat(v.cost).includes(pay.kind)) continue;
      if (v.instead && (!m.src || !m.src.ch || pay.ch === m.src.ch)) continue;   // "≪このキャラクターが代わりに支払ったアタックコスト・ガードコスト≫" (Revise#129)
      if (v.type && (!pay.info || pay.info.type !== v.type)) continue;
      if (v.types && (!pay.info || !v.types.includes(pay.info.type))) continue;
      if (v.icon && (!pay.info || !(pay.info.icons || []).includes(v.icon))) continue;
      if (v.icons && (!pay.info || !(pay.info.icons || []).some(i => v.icons.includes(i)))) continue;   // "スカラー・スカラー♂のネームを持つブレイクカードのコスト"
      if (v.named === true && !(pay.info && pay.info.name)) continue;
      if (v.named === false && pay.info && pay.info.name) continue;   // "ネームレベルでないブレイクカードのコスト"
      if (v.name && !(pay.info && pay.info.name === v.name)) continue;
      if (v.names && !(pay.info && pay.info.name && v.names.includes(String(pay.info.name).replace(/\s+/g, "")))) continue;   // "“A”または“B”のネームを持つブレイクカードのコスト" (Revise#201)
      if (v.tag && !(pay.info && (pay.info.tags || []).includes(v.tag))) continue;
      if (v.textHas && !(pay.info && (pay.info.text || "").replace(/\s+/g, "").includes(String(v.textHas).replace(/\s+/g, "")))) continue;   // EX0574
      if (v.firstMain && !(S.turn.phase === "main" && pay.info && S.players[pay.seat].mainCount && S.players[pay.seat].mainCount.turn === S.turn.number && S.players[pay.seat].mainCount[pay.info.type] === 1)) continue;   // A4-01 0079 (Revise#281): "各ターンのメインフェイズ中に最初に使用宣言するプロジェクトカード" (counted at declaration, so it is 1 now)
      if (v.onlyFromSelf && !(m.src && m.src.ch && Object.values(pay.from || {}).length && Object.values(pay.from || {}).every(ch => ch === m.src.ch))) continue;   // "このキャラクターからのみコストを支払って…"(EX0517 / EX0574)   // EX0424: "フッケバインを持つ"
      if (v.notSameJp && pay.info && m.src && m.src.card && S.cards[m.src.card] && (pay.info.jp || "") === ((db.card(S.cards[m.src.card].key) || {}).jp || "")) continue;   // PR338: a card name other than this card's   // "指定したネームを持つブレイクカードのコスト"
      if (v.onTarget === "self" && !(m.src && m.src.ch && m.src.ch === pay.targetCh)) continue;
      if (v.targetCh && v.targetCh !== pay.targetCh) continue;
      if (v.vsCh && !(pay.kind === "guard" && pay.against === v.vsCh)) continue;
      if (v.nameOfSrcCh && !(pay.info && pay.info.name && m.src && m.src.ch && S.chars[m.src.ch] && pay.info.name === AA4.charStats(S, db, m.src.ch).name)) continue;   // A3-09 1316 (Revise#253): "このカードをセットされているキャラクターと同じネームを持つブレイクカードのコスト"   // "目標のアタック宣言に対するガード宣言のコスト" (A3-07 1137, Revise#251)   // "目標に対して使用宣言したブレイクカードのコスト" (Revise#132)
      if (v.works && !(pay.info && AA4.worksOf(pay.info, v.works))) continue;
      if (v.faction && !(pay.info && pay.info.faction === v.faction)) continue;   // "…から支払われたWIZ-DOMのブレイクカードのコスト"
      if (v.vsPlayer && !(pay.target && pay.target.seat != null && pay.target.seat !== pay.seat)) continue;   // "あなた以外のプレイヤーに対してアタック宣言した場合" (Revise#138)
      if (v.factorMax && !(pay.info && (+((pay.info.factor || {})[v.factorMax.faction]) || 0) > 0 && (+((pay.info.factor || {})[v.factorMax.faction]) || 0) <= v.factorMax.n)) continue;   // "その勢力の必要ファクターがX以下の…" (Revise#132)
      if (v.paidBy && !(pay.ch && S.chars[pay.ch] && (v.paidBy === "self" ? m.src && m.src.ch === pay.ch : AA4.matchChar(S, db, v.paidBy, pay.ch, { seat: m.src ? m.src.seat : pay.seat })))) continue;   // "≪…全て≫のアタックコスト・ガードコストは手札に戻る"   // "fortissimoシリーズに登場するネームを持つブレイクカードのコスト"
      if (v.fromSelf && (pay.noFromCh || !(m.src && m.src.ch) || !Object.values(pay.from || {}).includes(m.src.ch))) continue;   // only cards paid from this character   // "このキャラクターをブレイクする場合、…コストは手札に戻る"
      if (v.sameName && !(pay.info && pay.info.name && pay.info.name === tName)) continue;
      if (v.targetIcons && !(pay.targetCh && S.chars[pay.targetCh] && AA4.charStats(S, db, pay.targetCh).icons.some(i => v.targetIcons.includes(i)))) continue;   // "スチューデントを目標にしたブレイクカードのコストは手札に戻る"
      if (!condOk(S, db, m, { seat: pay.seat, src: m.src })) continue;
      out.push(Object.assign({ to: v.to, label: (m.src && m.src.label) || "Field effect" }, v.fromSelf ? { fromCh: m.src.ch } : {}, v.paidTypes ? { paidTypes: v.paidTypes } : {}, v.next ? { nextMod: m.id } : {}));   // next: "あなたが次に使用宣言する…のコスト" — once (EP494, Revise#229)
    }
    // the same destination from two rules is one choice
    const res = out.filter((r, i) => r.fromCh || out.findIndex(x => x.to === r.to && !x.fromCh) === i);
    for (const r of out) if (r.nextMod && !res.includes(r)) { const k = res.find(x => x.to === r.to); if (k) k.nextMods = (k.nextMods || []).concat(r.nextMod); }   // a merged "next" rule is still used up (Revise#229)
    return res;
  };

  /* ---------- modifiers: add / end / expire ---------- */
  AA4.addMod = (ctx, m) => {
    const S = ctx.S, mod = Object.assign({ id: AA4.newId(S, "m"), until: "turn" }, m);
    S.modifiers.push(mod);
    AA4.touch(S);
    ctx.emit({ e: "modAdded", mod: mod.id, key: mod.key, label: mod.src && mod.src.label, fromCard: !!(mod.src && mod.src.card && mod.src.eid) });   // fromCard: the card's own line already says it (Revise#182)
    return mod;
  };
  AA4.endMod = (ctx, id) => {
    const S = ctx.S, i = S.modifiers.findIndex(m => m.id === id);
    if (i < 0) return;
    const [m] = S.modifiers.splice(i, 1);
    AA4.touch(S);
    ctx.emit({ e: "modEnded", mod: id, label: m.src && m.src.label });
    AA4.releaseLasting(ctx, m);
  };
  /** End modifiers that last "until end of battle / main phase / turn". End of turn also ends main-phase ones. */
  AA4.expire = (ctx, until) => {
    const ends = until === "turn" ? ["turn", "main", "battle", "charge"] : until === "main" ? ["main"] : [until];
    if (until === "turn") for (const m of ctx.S.modifiers) if (m.until === "nextTurn") m.until = "turn";
    if (until === "turn") for (const m of ctx.S.modifiers.slice()) if (m.until === "seatTurn" && ctx.S.turn.player === m.untilSeat) { if (m.skip > 0) m.skip--; else AA4.endMod(ctx, m.id); }   // "次のあなたのターンの終了時まで"   // "次のターンのターン終了時まで": this turn end, then the next one
    if (ends.includes("main")) for (const m of ctx.S.modifiers.filter(x => x.key === "doomMain")) { AA4.endMod(ctx, m.id); if (m.to && ctx.S.chars[m.to.ch]) AA4.defeat(ctx, m.to.ch, { why: "designated: discarded at the end of the Main Phase" }); }   // 2867 (Q#55): "メインフェイズ終了時に、≪指定したキャラクター≫を捨て札する"
    for (const m of ctx.S.modifiers.slice()) if (ends.includes(m.until)) AA4.endMod(ctx, m.id);
    for (const m of ctx.S.modifiers.slice()) if (!alive(ctx.S, m)) AA4.endMod(ctx, m.id);
  };
  AA4.STATE_CHECKS.push(ctx => {   // "メインフェイズ終了時まで、≪パワー0のキャラクター≫ / ≪パーマネントカード全て≫を捨て札する" (A3-11 1687 / 1715, Revise#164): while it lasts
    const S = ctx.S, db = ctx.db, mods = AA4.allMods(S, db).filter(m => m.key === "sweepSel" || m.key === "sweepPerms");
    if (!mods.length) return false;
    for (const m of mods) {
      if (m.key === "sweepPerms") { for (const ch of Object.values(S.chars)) if (ch.perm.length) { AA4.moveCard(ctx, ch.perm[0], { z: "discard" }); return true; } continue; }
      const live = S.modifiers.find(x => x.id === m.id), seen = (live && (live.seen = live.seen || [])) || [];
      const id = Object.keys(S.chars).find(c => !S.chars[c].flags.dying && !seen.includes(c) && AA4.matchChar(S, db, m.value.sel || {}, c, { seat: m.src ? m.src.seat : -1 }));
      if (id) { seen.push(id); AA4.defeat(ctx, id, { why: "discarded while " + ((m.src && m.src.label) || "an effect") + " lasts" }); return true; }
    }
    return false;
  });
  AA4.STATE_CHECKS.push(ctx => {   // M3g (Revise#192): "このカードが“X”以外にセットされている場合、≪このカード≫は捨て札される"
    const S = ctx.S, db = ctx.db;
    for (const ch of Object.values(S.chars)) for (const id of ch.perm) {
      const inf0 = db.card(S.cards[id].key) || {}, only = inf0.onlyOnNames;
      if (inf0.onlyOnNamed && !AA4.charStats(S, db, ch.id).named) { AA4.moveCard(ctx, id, { z: "discard" }); ctx.emit({ e: "note", text: `${AA4.cardName(inf0)} is discarded: its character has no name` }); return true; }   // EXPV041
      if (!only) continue;
      const st = AA4.charStats(S, db, ch.id);
      if (!only.some(n => st.name === n || (st.alsoNames || []).includes(n))) { AA4.moveCard(ctx, id, { z: "discard" }); ctx.emit({ e: "note", text: `${AA4.cardName(db.card(S.cards[id].key))} is discarded: only for “${only.join("” / “")}”` }); return true; }
    }
    return false;
  });
  AA4.STATE_CHECKS.push(ctx => {   // A3-03 0447 (Revise#159): "このキャラクターのパワーが0の場合、このカードは捨て札される"
    const S = ctx.S, db = ctx.db;
    for (const ch of Object.values(S.chars)) if (!ch.power.length) for (const id of ch.perm) if ((db.card(S.cards[id].key) || {}).discardIfPower0) { AA4.moveCard(ctx, id, { z: "discard" }); return true; }
    return false;
  });
  AA4.STATE_CHECKS.push(ctx => {   // EX0182 (Revise#157): "“X”が場にいる場合、≪このキャラクターを構成するカード全てと、…≫を捨て札する"
    const S = ctx.S, db = ctx.db;
    for (const id of Object.keys(S.chars)) {
      const ch = S.chars[id]; if (!ch || ch.flags.dying) continue;
      const names = AA4.charStats(S, db, id).doomIfName; if (!names) continue;
      if (names.some(n => Object.keys(S.chars).some(o => o !== id && (AA4.charStats(S, db, o).name === n || (AA4.charStats(S, db, o).alsoNames || []).includes(n))))) { AA4.removeChar(ctx, id, { why: `“${names[0]}” is on the field` }); return true; }
    }
    return false;
  });
  AA4.STATE_CHECKS.push(ctx => {   // Revise#099: end the lasting results of a character that left the field
    const dead = ctx.S.modifiers.filter(m => m.fromChar && m.src && m.src.ch && !ctx.S.chars[m.src.ch]);
    for (const m of dead) AA4.endMod(ctx, m.id);
    return dead.length > 0;
  });
  /** A Fast / Project card that stayed in the Special Area because its effect lasts goes to the Discard Pile
      when its last modifier ends (Revise#019). */
  AA4.releaseLasting = (ctx, m) => {
    const S = ctx.S, card = m.src && m.src.card;
    if (!card || !S.cards[card] || S.cards[card].place.z !== "special") return;
    if (S.modifiers.some(x => x.src && x.src.card === card)) return;
    if (S.cards[card].endTo === "damage") { delete S.cards[card].endTo; AA4.enqueue(S, [{ op: "move", card, to: { z: "damage", seat: S.cards[card].owner } }], true); return; }   // EX0486 (Revise#201): "ターン終了時に、≪このカード≫をあなたのダメージ置き場に置く"
    if (S.cards[card].endToHand) { delete S.cards[card].endToHand; AA4.enqueue(S, [{ op: "move", card, to: { z: "hand", seat: S.cards[card].owner } }], true); return; }   // 2911 (Revise#179): "…場合、メインフェイズ終了時に、≪このカード≫をオーナーの手札に戻す"
    AA4.enqueue(S, [{ op: "move", card, to: { z: "discard" } }], true);
  };

  /* ---------- field effects by hand (Revise#038: "+ adds one by hand, − ends one") ---------- */
  const FIELD_KEYS = new Set(["attackReplace", "negateEffect", "ignoreOwn", "dmgReduce", "noDiscard", "duelNamed", "breakAnyIcon", "breakWithIcons", "battleHook", "effectCost", "permDest", "se", "at", "de", "attackCost", "guardCost", "handLimit", "draw", "charge", "ban", "dest", "skill", "icon", "powerVisible", "noDamage"]);
  AA4.INTENTS.field = {
    undoable: true,
    check(ctx, it) {
      const S = ctx.S;
      if (S.stage !== "play") return "The game has not started yet";
      const seat = AA4.seatFor(S, it);
      if (seat == null) return "You are not playing at this table";
      const m = it.mod || {};
      if (!FIELD_KEYS.has(m.key)) return "Unknown field effect";
      if (!["battle", "main", "turn", "removed"].includes(m.until || "turn")) return "Unknown duration";
      if (["se", "at", "de", "attackCost", "guardCost", "handLimit", "draw", "charge"].includes(m.key) && !AA4.isInt(m.value)) return "A number is needed";
      if (!m.to || typeof m.to !== "object") return "Say what it applies to";
      if (m.key === "powerVisible" && !(it.agreed && S.players.every(p => p.lost || it.agreed.includes(p.seat)))) return "Every player has to agree";
      return null;
    },
    apply(ctx, it) {
      const seat = AA4.seatFor(ctx.S, it), m = it.mod;
      AA4.addMod(ctx, { src: { seat, label: String(m.label || "Field effect (by hand)").slice(0, 80) }, to: m.to, key: m.key, op: m.op || (m.key === "ban" ? "ban" : m.key === "dest" ? "dest" : "add"), value: m.value, until: m.until || "turn" });
    },
  };
  AA4.INTENTS.fieldEnd = {
    undoable: true,
    check(ctx, it) {
      if (ctx.S.stage !== "play") return "The game has not started yet";
      if (AA4.seatFor(ctx.S, it) == null) return "You are not playing at this table";
      const ids = Array.isArray(it.mods) ? it.mods : [it.mod];   // mods: one row of the Field effects list (Revise#182)
      return ids.length && ids.every(id => ctx.S.modifiers.some(m => m.id === id)) ? null : "No such field effect";
    },
    apply(ctx, it) { for (const id of Array.isArray(it.mods) ? it.mods : [it.mod]) AA4.endMod(ctx, id); },
  };

  /** The Player on the field (Pack, Revise#214): every effect that reaches this player — [{label, text, until, card}] (one row per source and text). */
  AA4.playerEffects = (S, db, seat) => {
    const out = [], seen = new Set(), HIDE = new Set(["watchEv", "puppet"]);
    for (const m of AA4.allMods(S, db)) {
      if (HIDE.has(m.key) || !AA4.modAppliesToSeat(S, m, seat) || !condOk(S, db, m, { seat, src: m.src })) continue;
      const text = AA4.modText ? AA4.modText(m) : m.key, label = (m.src && m.src.label) || "Effect", k = label + "|" + text;
      if (seen.has(k)) continue; seen.add(k);
      out.push({ label, text, until: m.static ? "source" : m.until || "", card: (m.src && m.src.card) || null });
    }
    return out;
  };
  /** Field effects list (Pack, Revise#182): "[EFFECT TYPE] to [TARGET]" — one row for the modifiers one effect made. */
  /** Pack (Revise#230): a card's always-on ability that reaches more than its own character — players, every card of a kind, the field — is a Field Effect too. */
  AA4.wideMods = (S, db) => AA4.allMods(S, db).filter(m => m.static && !(m.to && m.to.ch != null));
  AA4.modOn = (S, db, m) => condOk(S, db, m, { seat: m.src ? m.src.seat : null, src: m.src || {} });
  AA4.modGroups = (S, db, list) => {
    const rows = [], byKey = new Map();
    for (const m of list || S.modifiers) {
      const k = m.static ? `st|${m.src && m.src.card}|${m.src && m.src.textJp}` : m.src && m.src.eid ? `${m.src.eid}|${m.until}` : "m|" + m.id;
      let r = byKey.get(k);
      if (!r) { r = { key: k, mods: [], src: m.src || {}, until: m.until }; byKey.set(k, r); rows.push(r); }
      r.mods.push(m);
    }
    for (const r of rows) {
      const skills = { grant: [], remove: [] }, stats = {}, other = [];
      for (const m of r.mods) {
        if (m.key === "skill" && m.value && m.value.id) { const sk = (AA4.SKILLS && AA4.SKILLS[m.value.id]) || {}, nm = (sk.en || m.value.id) + (typeof m.value.x === "number" ? " " + m.value.x : ""); const l = skills[m.op === "remove" ? "remove" : "grant"]; if (!l.includes(nm)) l.push(nm); continue; }
        if (["se", "at", "de"].includes(m.key) && m.op !== "set" && typeof m.value === "number") { const tk = JSON.stringify(m.to || {}); (stats[tk] = stats[tk] || { se: 0, at: 0, de: 0 })[m.key] += m.value; continue; }
        const t = AA4.modText(m); if (!other.includes(t)) other.push(t);
      }
      const parts = [];
      if (skills.grant.length) parts.push(`Gain skill “${skills.grant.join(", ")}”`);
      if (skills.remove.length) parts.push(`Lose skill “${skills.remove.join(", ")}”`);
      const sv = Object.values(stats)[0];
      if (sv) { const f = n => (n > 0 ? "+" + n : n < 0 ? "−" + -n : "±0"); parts.push(`${f(sv.se)}/${f(sv.at)}/${f(sv.de)}`); }
      r.type = parts.concat(other).join("; ");
      // the target: the ≪…≫ of the English line that made it, when that line has exactly one; else the characters / players it reaches
      const c = r.src.card && S.cards[r.src.card], inf = c && c.key && db ? db.card(c.key) : null;
      const en = inf && r.src.textJp ? (AA4.enText(inf, r.src.textJp) || "") : "";
      const segs = en.match(/≪[^≫]+≫/g) || [];
      r.textEn = en || null;
      const names = [];
      for (const m of r.mods) {
        const to = m.to || {};
        const nm = to.ch ? (S.chars[to.ch] ? AA4.cardName(db && db.card(S.cards[AA4.topOf(S.chars[to.ch])].key)) : null) : to.seat != null ? (S.players[to.seat] ? S.players[to.seat].name : null) : to.players === "all" ? "every player" : to.players === "opponents" ? "the opponents" : to.players === "you" && m.src && S.players[m.src.seat] ? S.players[m.src.seat].name : null;
        if (nm && !names.includes(nm)) names.push(nm);
      }
      const one = new Set(segs).size === 1 ? segs[0] : null;
      r.target = one ? one + (/\ball\b|全て/.test(one) || !names.length ? "" : ` (${names.join(", ")})`) : names.join(", ");
    }
    return rows;
  };
  /** Card details "X" (Pack, Revise#198: "add “X” details of each card — X = N, and “Count from …”"): every X the card uses,
      worked out now for src {ch, seat, card}. → [{label, n (null: decided by the target / when it is used), from: [names] | null, more}] */
  AA4.xEntries = (S, db, inf, src) => {
    const out = [], seen = new Set();
    const add = (label, x) => {
      if (!x || typeof x !== "object") return;
      const key = label + JSON.stringify(x); if (seen.has(key)) return; seen.add(key);
      const js = JSON.stringify(x), later = /"target|"ev[A-Z]|"last|"chosen|"cardX|"paid|xvar/.test(js);
      let n = null; if (!later) { try { n = AA4.xOf(S, db, x, src, []); } catch (e) { n = null; } }
      let from = null, more = 0;
      try {
        if (!later && x.countChars) { const seat = src.seat; from = Object.keys(S.chars).filter(id => AA4.matchChar(S, db, Object.assign({ seat }, x.countChars), id, { seat, self: src.ch, ch: src.ch })).map(id => AA4.cardName(db.card(S.cards[AA4.topOf(S.chars[id])].key))); }
        else if (!later && x.pileCount) { const p = x.pileCount; from = AA4.living(S).filter(s => p.owner === "all" || (p.owner === "others" ? s !== src.seat : s === src.seat)).flatMap(s => S.players[s].zones[p.zone].filter(id => { const i2 = db.card(S.cards[id].key) || {}; return (!p.type || i2.type === p.type) && (!p.icons || (i2.icons || []).some(i => p.icons.includes(i))) && (!p.faction || i2.faction === p.faction) && (!p.named || !!i2.name) && (!p.name || i2.name === p.name); }).map(id => (S.players[s] ? S.players[s].name + ": " : "") + AA4.cardName(db.card(S.cards[id].key)))); }
        else if (!later && x.power === "self" && src.ch && S.chars[src.ch]) from = [`${S.chars[src.ch].power.length} power card(s) on ${AA4.cardName(db.card(S.cards[AA4.topOf(S.chars[src.ch])].key))}`];
      } catch (e) { from = null; }
      if (from && from.length > 12) { more = from.length - 12; from = from.slice(0, 12); }
      out.push({ label, n, from, more });
    };
    for (const [k, v] of Object.entries(inf.skills || {})) if (v && typeof v === "object" && v.x && typeof v.x === "object") add(`${(AA4.SKILLS && AA4.SKILLS[k] && AA4.SKILLS[k].en) || k} X`, v.x);
    if (inf.statX) add("Stat +X", inf.statX);
    (inf.effects || []).forEach((e, i) => add(`Effect ${i + 1}`, e.x));
    if (inf.play) add(inf.type === "Fast" || inf.type === "Project" ? "This card" : "Its text", inf.play.x);
    (inf.abilities || []).forEach((a, i) => { if (a.effect) add(`Ability ${i + 1}`, a.effect.x); const v = a.mod && a.mod.value; if (v && typeof v === "object" && v.x && typeof v.x === "object") add(`Ability ${i + 1}`, v.x); });
    if (inf.cost === "X") out.push({ label: "Cost X", n: null, from: null, more: 0, paid: true });
    return out;
  };
  /** Attack split into normal and mental (Pack, Revise#191): {n, m} — the same split the battle damage uses (14-battle sideDamage). */
  AA4.atkParts = st => {
    const at = Math.max(0, +st.at || 0);
    if (st.atN != null || st.atM != null) return { n: (st.atN || 0) + (st.dualAtk ? st.atM || 0 : 0), m: st.atM || 0 };   // Revise#238
    if (st.atMental) return { n: st.dualAtk ? at : 0, m: at };
    return { n: at, m: 0 };
  };
  /** "8", "(8)" or both "44 (1)" (Pack, Revise#191: "show both Attack and Mental Attack separately as X (X)"). */
  AA4.atkText = st => { if (!st || st.at == null) return "–"; const p = AA4.atkParts(st); return p.n && p.m ? `${p.n} (${p.m})` : p.m ? `(${p.m})` : String(p.n); };
  /** Short English text for a modifier ("[Student] + Attack 2", "Attack banned"). */
  AA4.modText = m => {
    const v = m.value, sign = n => (n > 0 ? "+ " : "− ") + Math.abs(n);
    if (m.key === "atm") return `${+m.value >= 0 ? "+" : "−"} Mental Attack (${Math.abs(+m.value || 0)})`;
    const what = { se: "Mental", at: "Attack", de: "Defense", attackCost: "Attack cost", guardCost: "Guard cost", handLimit: "Hand limit", draw: "Draw", charge: "Charge" }[m.key];
    if (what) return m.op === "set" ? `${what} = ${v}` : `${sign(+v)} ${what}`.replace(/^([+−]) (\d+) (.*)$/, "$1 $3 $2");
    if (m.key === "ban") return `${v && v.decl && v.decl !== "any" ? v.decl[0].toUpperCase() + v.decl.slice(1) : "Declarations"} banned${v && v.name ? ` (「${v.name}」)` : v && v.type ? ` (${v.type})` : ""}`;
    if (m.key === "dest") return `${v.cost || "Any"} cost → ${v.to}`;
    if (m.key === "cardCost" && v) { const q = v.sel || {}, FN = { "E.G.O.": "E.G.O.", Arayashiki: "Arayashiki", "WIZ-DOM": "WIZ-DOM", Darklore: "Darklore", "Polestar Empire": "Polestar Empire", Eraser: "Eraser" };   // Revise#230: shown in Field effects
      const what = [q.names ? q.names.map(x => "“" + x + "”").join(" / ") : "", q.faction ? FN[q.faction] || q.faction : "", q.works ? q.works : "", q.icons ? q.icons.join("/") : "", q.tag || "", q.types ? q.types.join(" / ") : "", q.named === true ? "named" : ""].filter(Boolean).join(" ") || "Card";
      const n = typeof v.n === "number" ? v.n : null;
      return `${what} cost ${n == null ? "± X" : (n > 0 ? "+ " : "− ") + Math.abs(n)}`; }
    if (m.key === "icon") return `Gains class ${v}`;
    if (m.key === "skill") return `${m.op === "remove" ? "Loses" : "Gains"} ${v.id}${typeof v.x === "number" ? " " + v.x : ""}`;
    if (m.key === "powerVisible") return "Power cards face up";
    if (m.key === "permDest") return `Permanents that must go → ${({ hand: "hand", deckTop: "deck top", deckBottom: "deck bottom", damage: "Damage Pile", char: "another character" })[v && v.to] || "?"}`;
    return m.key;
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
