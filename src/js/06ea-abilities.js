/* ==========================================================================
   Ability System — card text that is not a skill, an effect ("1：…") or a condition line.

   Every such line of a Character / Break / Permanent card becomes c.abil[k]:
     { text, kind: "trigger" | "during" | "continuous", timing (TRIGGERS id), when (condition text),
       rule (CONDITION_RULES id, for "…場合" continuous lines), steps (Effect System steps of the action),
       type, scope: "self" | "field" | "player", auto, short }
   - trigger:    "…した場合、…" at a moment of the game (attack, guard declared, battle start / end, set …).
                 It waits in S.trig until its owner runs it (target chosen like an effect) or skips it.
   - during:     "…バトルする際、攻撃力に+2して判定する" — counts only while the character is in battle.
   - continuous: always on while the card is on the field (or while its condition holds).
                 scope "self" → this character; scope "field" → a Field effect on every character it names
                 (listed in the Field effects box as "from card abilities").
   Continuous stat changes and skills are applied automatically; other continuous abilities (can't …,
   not affected by …, cost changes) are shown as reminders. To support more, extend TRIGGERS or the
   actions in 06d-effects.js.
   ========================================================================== */
const TRIGGERS = [
  { id: "attack", label: "When it attacks", re: /(アタック宣言(した|する|された)(場合|時|際)|アタックした場合|アタックする際|アタック宣言時)/ },
  { id: "guard", label: "When guard is declared", re: /(ガード宣言(した|する|された)(場合|時|際)|ガードした場合|ガードする際|ガードされた場合)/ },
  { id: "battleStart", label: "Before battle", re: /(バトル開始時|バトルする際|バトルを行う際|バトル前)/ },
  { id: "battleEnd", label: "After battle", re: /(バトル終了時|バトル後|バトルに勝利した場合|バトル相手を捨て札にした場合)/ },
  { id: "dominated", label: "When it is dominated", re: /(このキャラクターを支配した(場合|時)|支配エリアにセットされた場合|支配された(場合|時))/ },
  { id: "enter", label: "When this card is set", re: /(このカードがセットされた(場合|時|際)|場に出た(場合|時))/ },
  { id: "break", label: "When it is broken", re: /(ブレイクする場合|ブレイクされた場合|ブレイクした場合)/ },
  { id: "leave", label: "When it leaves the field", re: /(捨て札(に)?な(った|る)場合|手札に戻(った|る)場合)/ },
  { id: "damaged", label: "When it takes / deals damage", re: /ダメージを(受けた|与えた)場合/ },
  { id: "turnStart", label: "At the start of a turn / phase", re: /(ターン開始時|フェイズ開始時)/ },
  { id: "turnEnd", label: "At the end of a turn / phase", re: /(ターン終了時[、に]|フェイズ終了時[、に])/ },
];
const TRIGGER = Object.fromEntries(TRIGGERS.map(t => [t.id, t]));
const AUTO_TRIGGERS = new Set(["attack", "guard", "battleStart", "battleEnd", "enter", "dominated"]);   // the table queues these by itself
const DURING_RE = /(して判定する|バトル中、|バトルしている(間|場合))/;
/** Is this character in the battle being resolved (attacker / guard / attacked own active character)? */
function pileInBattle(S, o, pid) {
  if (STAT_NOBATTLE) return false;   // "how would it be outside this battle?"
  const at = curAttack(S);
  if (!at || !["response", "start", "end"].includes(at.rec.step) && !at.rec.inBattle) return false;
  return (o === at.A && (pid === at.apid || pid === at.tpid)) || (o === at.G && pid === at.gpid);
}
/** "このカードが(あなたの)ダメージ置き場にある場合、…": the ability works while the card is in that zone, not on the field. */
const ZONE_RE = /このカードが(?:あなたの)?(ダメージ置き場|捨て札置き場|手札)に(?:ある|置かれている|存在する)(?:場合|間)、/;
const ZONE_OF = { "ダメージ置き場": "damage", "捨て札置き場": "discard", "手札": "hand" };
/** One ability line → ability, or null when the line is not an ability. */
function parseAbility(line) {
  const zm = line.match(ZONE_RE);
  if (zm) {   // the zone is the condition: parse the rest as an always-on ability of that zone
    const a = parseAbility(line.slice(zm.index + zm[0].length));
    if (!a) return null;
    const pre = line.slice(0, zm.index).trim();   // e.g. "あなたがこのカードの必要ファクターを満たした状態で、" → by hand
    return Object.assign(a, { text: line, zone: ZONE_OF[zm[1]], kind: "continuous", when: pre, rule: "", preByHand: !!pre,
      short: `While in your ${zm[1] === "手札" ? "hand" : zm[1] === "ダメージ置き場" ? "damage zone" : "discard pile"}: ${effectTypeLabel(a.type)}`,
      auto: !pre && zm[1] !== "手札" && (a.auto || /(を得る|を与え|[+\-−][0-9０-９]+(する|される)?。?$|手札にあるカードと同様に(使用|セット)宣言可能)/.test(line) && ["stat", "stat-one", "gain-skill", "gain-other", "timing", "other"].includes(a.type)) });
  }
  const text = line.replace(LEAD_SKILLS, "").trim();
  if (!text || !/。/.test(text) || /^「.*」$/.test(text) || /^【/.test(text) || /^[XＸ]は/.test(text)) return null;
  const during = DURING_RE.test(text), trig = during ? null : TRIGGERS.find(t => t.re.test(text));
  const cut = text.search(/(場合|際|時)、/), head = cut >= 0 ? text.slice(0, cut) : "", action = cut >= 0 ? text.slice(cut + 3) : text;
  let kind = trig ? "trigger" : during ? "during" : "continuous", rule = "", when = "";
  if (kind === "during" && /場合、/.test(text)) {   // "このキャラクターのパワーが0の場合、バトルの際、…": a condition on top of "in battle"
    when = text.slice(0, text.indexOf("場合、")).replace(/^.*?(この|あなた|場に|対戦)/, "$1");
    const r = CONDITION_RULES.find(x => x.re.test(when));
    rule = r ? r.id : "";
  }
  if (kind === "continuous" && head) {   // "…場合、…" without a trigger word: a continuous ability with a condition
    when = head.replace(/^.*?(この|あなた|場に|対戦)/, "$1");
    const r = CONDITION_RULES.find(x => x.re.test(when));
    rule = r ? r.id : "";
  }
  const ef = classifyEffect(action), st0 = ef.steps.find(s => s.target) || ef.steps[0];
  const aim = st0 ? stepAim(st0) : "none";
  const scope = aim === "self" || aim === "none" ? "self" : aim === "players" || aim === "player" || aim === "you" ? "player" : "field";
  const stat = ["stat", "stat-one"].includes(ef.type), grant = ["gain-skill"].includes(ef.type);
  const immune = kind === "continuous" && !head && /^≪この(キャラクター|カード)≫/.test(text) && /(精神ダメージを受けない|通常(攻撃による)?ダメージを受けない|バトルによる(通常)?ダメージを受けない)$|ダメージを受けない。$/.test(text)
    && /(精神ダメージ|通常(攻撃による)?ダメージ|(ブレイクしていない|ネームレベルでない|パワーがX以下の)キャラクターとのバトルによる|≫はバトルによる)/.test(text);
  const auto = kind === "trigger" ? AUTO_TRIGGERS.has(trig.id) && ef.auto
    : immune || ((stat || grant) && (!when || !!rule) && (kind === "during" || !head || !!rule));
  return { text, kind, timing: trig ? trig.id : kind === "during" ? "during" : "", when, rule, steps: ef.steps, type: ef.type, scope, auto, action,
    short: (trig ? trig.label + ": " : kind === "during" ? "During battle: " : "") + effectTypeLabel(ef.type) };
}
for (const c of CARDS) {
  c.abil = [];
  const lines = String(c.text || "").split("\n").map(l => l.trim()), enl = String(c.textEn || "").split("\n").map(l => l.trim());
  const withEn = (a, i) => { if (a) { a.en = enl[i] || ""; c.abil.push(a); } };   // the English line next to the Japanese one
  if (!["Character", "Break", "Permanent"].includes(c.t)) {   // Fast / Project: only "while this card is in your damage zone …"
    lines.forEach((l, i) => { if (ZONE_RE.test(l)) withEn(parseAbility(l), i); });
    continue;
  }
  let lastEf = -1;
  lines.forEach((l, i) => {
    if (!l) return;
    if (EFFECT_LINE.test(l)) { lastEf++; return; }
    if (/^[XＸ]は/.test(l)) {   // "Xは…に等しい。" belongs to the line before (effect or ability)
      const last = c.abil[c.abil.length - 1];
      if (lastEf >= 0 && c.effects[lastEf] && !c.effects[lastEf].xdef) c.effects[lastEf].xdef = l; else if (last) last.xdef = l;
      return;
    }
    if (c.conds.some(cd => cd.text === l && !cd.partial)) return;
    withEn(parseAbility(l), i);
  });
  // one "Xは…" line defines X for every effect / ability of the card that uses X
  const xd = lines.find(l => /^[XＸ]は/.test(l));
  if (xd) for (const e of allEffects(c).concat(c.abil)) if (!e.xdef && /[XＸ]/.test(e.jp || e.text || "")) e.xdef = xd;
}
/* Fast / Project cards: their text (without flavour text and damage-zone lines) is what the card does when it resolves. */
for (const c of CARDS) {
  if (c.t !== "Fast" && c.t !== "Project") continue;
  const lines = String(c.text || "").split("\n").map(l => l.trim()).filter(l => l && !/^「.*」$/.test(l) && !ZONE_RE.test(l) && !/^【/.test(l));
  c.play = classifyEffect(lines.filter(l => !/^[XＸ]は/.test(l)).join(""));
  c.play.jp = lines.join(""); c.play.xdef = lines.find(l => /^[XＸ]は/.test(l)) || null;
}
/** Value of X: from the "Xは…に等しい" line, else the given fallback. */
function xValue(S, owner, pile, xdef, fallback, src) {
  const t = String(xdef || "");
  if (!t || !pile) return fallback;
  if (/構成する/.test(t)) {   // cards making up this character (the stack): with this card's name, or with a given “name”
    const nm = (t.match(/“([^”]+)”/) || [])[1], own = src ? cardName(src) : cardName(cardOf(S, pileTop(pile)));
    const pick = u => { const c = cardOf(S, u); return !c ? false : nm ? cardHasName(c, condName(nm)) : /同じネーム/.test(t) ? !!own && cardName(c) === own : true; };
    return pile.stack.filter(pick).length;
  }
  if (/パワー/.test(t) && /このキャラクター/.test(t)) return pile.power.length;
  if (/精神力/.test(t) && /このキャラクター/.test(t)) return statsOf(S, owner, pile).se || 0;
  if (/攻撃力/.test(t) && /このキャラクター/.test(t)) return statsOf(S, owner, pile).at || 0;
  if (/ダメージ置き場/.test(t) && /あなた/.test(t)) return owner.damage.length;
  if (/手札/.test(t) && /あなた/.test(t)) return owner.hand.length;
  return fallback;
}

/* ---------- triggered abilities ---------- */
/** Queue the abilities of these characters (top card + permanents) that trigger at `timing`. */
function queueTriggers(S, timing, chars, log, onlyUid) {
  if (!onlyUid && (timing === "attack" || timing === "guard")) queueWatchers(S, timing, chars, log);
  for (const { o, pid } of chars) {
    const pile = o && o.piles[pid];
    if (!pile) continue;
    for (const uid of [pileTop(pile), ...pile.perm]) {
      if (onlyUid && uid !== onlyUid) continue;
      const c = cardOf(S, uid);
      (c ? c.abil : []).forEach((a, k) => {
        if (a.kind !== "trigger" || a.timing !== timing) return;
        if (a.auto && !effectPick(a) && !/可能/.test(a.text)) {   // must happen and needs no choice: it happens now
          runAbility(S, o, { uid, k, pid, timing }, { id: `${S.log.length}-auto` }, log);
          return;
        }
        S.trig = S.trig || [];
        S.trig.push({ id: `${S.log.length}-${uid}-${k}`, seat: o.seat, pid, uid, k, timing });
        log(`⏵ 「${c.jp}」 — ${TRIGGER[timing].label}: ${a.text.slice(0, 80)}${a.text.length > 80 ? "…" : ""}`, uid);
      });
    }
  }
}
const abilityOf = (S, t) => { const c = cardOf(S, t.uid); return (c && c.abil[t.k]) || { short: "", steps: [] }; };
/** Run a triggered ability (no cost): the same actions as effects. */
function runAbility(S, p, t, e, log) {
  const pile = p.piles[t.pid], src = cardOf(S, t.uid), ab = abilityOf(S, t);
  log(`${p.name}: 「${src ? src.jp : "?"}」 — ${TRIGGER[t.timing] ? TRIGGER[t.timing].label : "ability"}: ${ab.text}`, t.uid);
  if (ab.special) { const sp = SPECIALS.find(y => y.id === ab.special); if (sp) sp.run(S, p, ab.sp, log); return; }
  if (!pile) { log("The character is gone — nothing happens"); return; }
  runEffect({ S, p, pid: t.pid, pile, src, tgt: e.tgt || null, x: xValue(S, p, pile, ab.xdef, +e.x || 0, src), paidNow: [], log, e }, ab);
}

/* ---------- continuous abilities ---------- */
/** Continuous abilities on the table that are on now: [{o, pid, uid, c, a}] */
function liveAbilities(S, kinds = ["continuous", "during"]) {
  const out = [];
  for (const o of S.players) for (const pid of o.porder) {
    const pile = o.piles[pid];
    if (pile.area === "pf") continue;
    for (const uid of [pileTop(pile), ...pile.perm]) {
      const c = cardOf(S, uid);
      (c ? c.abil : []).forEach(a => {
        if (!kinds.includes(a.kind) || a.zone) return;
        if (a.kind === "during" && !pileInBattle(S, o, pid)) return;
        if (a.when && !(a.rule && condTest(S, o, pile, c, a))) return;
        out.push({ o, pid, pile, uid, c, a });
      });
    }
  }
  // cards in a damage zone / discard pile / hand whose ability works there ("このカードがあなたのダメージ置き場にある場合、…")
  if (kinds.includes("continuous")) for (const o of S.players) for (const zone of ["damage", "discard", "hand"]) for (const uid of o[zone]) {
    const c = cardOf(S, uid);
    (c ? c.abil : []).forEach(a => { if (a.zone === zone && !a.preByHand && zone !== "hand") out.push({ o, pid: null, pile: null, uid, c, a, zone }); });
  }
  return out;
}
/** Valued skills a player gets from abilities ("≪あなた≫はドロー+1を得る"), e.g. Draw / Charge / Capacity. */
function playerSkill(S, p, skill) {
  const jp = { Draw: "ドロー", Charge: "チャージ", Capacity: "キャパシティ" }[skill];
  if (!jp) return 0;
  let n = 0;
  for (const x of liveAbilities(S, ["continuous"])) {
    if (x.o !== p || x.a.scope !== "player") continue;
    const m = halfNum(x.a.text).match(new RegExp(jp + "([+\\-]?[0-9]+)を得"));
    if (m) n += +m[1];
  }
  return n;
}
/** Cards that may be used from the damage zone like from the hand. */
const usableFromDamage = c => !!c && c.abil.some(a => a.zone === "damage" && !a.preByHand && /^このカードが(あなたの)?ダメージ置き場に(ある|置かれている)場合、(あなたは)?(≪このカード≫を|このカードを、?)/.test(a.text) && /手札にあるカードと同様に(使用|セット)宣言可能/.test(a.text));
function condTest(S, o, pile, c, a) { const r = CONDITION_RULE[a.rule]; try { return !!r.test(S, o, pile, c, a.when.match(r.re)); } catch (err) { return false; } }
/** The characters a continuous ability reaches (self, or every character its target names). */
function abilityTargets(S, x) {
  const st = x.a.steps.find(s => s.target) || x.a.steps[0];
  if (st && st.target && /バトル相手/.test(st.target.text)) {   // the character it battles
    const at = curAttack(S), pairs = at ? battlePairs(S, at) : [], me = pairs.findIndex(t => t.o === x.o && t.pid === x.pid);
    return me < 0 ? [] : pairs.filter((_, i) => i !== me);
  }
  if (x.a.scope === "self" || !st) return x.pile ? [{ o: x.o, pid: x.pid }] : [];
  const aim = stepAim(st);
  if (aim === "all") return effectAll(S, x.o.seat, st).filter(t => !(/このキャラクター以外/.test(st.target.text) && t.o === x.o && t.pid === x.pid));
  return [];
}
let ABIL_LIVE = null;   // cache for one stats pass
STAT_SOURCES.push(Object.assign((S, owner, pile) => {
  const out = [];
  for (const x of liveAbilities(S)) {
    if (!["stat", "stat-one"].includes(x.a.type)) continue;
    const pid = Object.keys(owner.piles).find(k => owner.piles[k] === pile);
    if (!abilityTargets(S, x).some(t => t.o === owner && t.pid === pid)) continue;
    const step = x.a.steps.find(s => ["stat", "stat-one"].includes(s.type));
    const d = effectStat(step.text, xValue(S, x.o, x.pile, x.a.xdef, 0, x.c));
    out.push({ label: `${x.a.kind === "during" ? "In battle" : "Ability"}: 「${x.c.jp}」`, se: d.se || 0, at: d.at || 0, de: d.de || 0 });
  }
  return out;
}, { deep: true }));
/** Skills given by continuous abilities to this character. */
function abilitySkills(S, owner, pile) {
  const pid = Object.keys(owner.piles).find(k => owner.piles[k] === pile), out = [];
  for (const x of liveAbilities(S)) {
    const grants = x.a.steps.flatMap(s => effectGrants(s.text));
    if (!grants.length) continue;
    if (abilityTargets(S, x).some(t => t.o === owner && t.pid === pid)) out.push(...grants);
  }
  return out;
}
/* ---------- Cost returns to hand ("≪…ブレイクカードのコスト≫は手札に戻る") ----------
   An always-on ability that sends the cost paid for matching cards back to the hand:
     field     ≪(スカラー・スカラー♂の)(ネームを持つ)(極星帝国の)ブレイクカードのコスト≫ — cards played while it is on the field
     fromThis  ≪このキャラクターから支払われた…ブレイクカードのコスト≫ — only cost paid from this character
     breakOn   このキャラクターをブレイクする場合 / このキャラクターに…ブレイクカードをセットする場合 — Break cards set on this character
     permOn    ≪このキャラクターにセットされたパーマネントカードのコスト≫ — Permanent cards set on this character
     self      このカードがセットされた場合、≪このカードのコスト≫ — this card itself
   Other wordings (extra conditions) stay reminders. */
const CR_TYPES = { "ブレイクカード": "Break", "プロジェクトカード": "Project", "ファストカード": "Fast", "パーマネントカード": "Permanent" };
function parseCostReturn(text) {
  if (!/のコスト≫?は、?(その|あなたの)?(オーナーの)?手札に戻る/.test(text)) return null;
  const tg = (text.match(/≪([^≫]*のコスト)≫/) || [])[1] || "";
  const types = Object.keys(CR_TYPES).filter(j => tg.includes(j)).map(j => CR_TYPES[j]);
  const base = { icons: T_ICONS.filter(j => tg.includes(j)), faction: (Object.keys(T_FACTIONS).find(j => tg.includes(j)) && T_FACTIONS[Object.keys(T_FACTIONS).find(j => tg.includes(j))]) || (tg.includes("イレイザーの") ? "Eraser" : ""),
    named: /ネームを持つ/.test(tg) && !/同じネーム/.test(tg), notNamed: /ネームレベルでない/.test(tg), types };
  if (/^このカードがセットされた場合、≪このカードのコスト≫/.test(text)) return Object.assign(base, { mode: "self" });
  if (/^このキャラクターをブレイクする場合、≪そのブレイクカードのコスト≫/.test(text)) return Object.assign(base, { mode: "breakOn", types: ["Break"] });
  const m = text.match(/^このキャラクターに(.*?)ブレイクカードをセットする場合、≪そのブレイクカードのコスト≫/);
  if (m) return Object.assign(base, { mode: "breakOn", types: ["Break"], faction: T_FACTIONS[Object.keys(T_FACTIONS).find(j => m[1].includes(j))] || "" });
  if (/^≪このキャラクターにセットされたパーマネントカードのコスト≫/.test(text)) return Object.assign(base, { mode: "permOn", types: ["Permanent"] });
  if (!/^≪/.test(text) || !types.length || /同じネーム|このカードを|“/.test(tg)) return null;   // other wordings: by hand
  return Object.assign(base, { mode: /このキャラクターから支払われた/.test(tg) ? "fromThis" : "field", yours: /あなたが支払った|あなたの支払った/.test(tg) });
}
for (const c of CARDS) for (const a of c.abil) { const cr = parseCostReturn(a.text); if (cr) { a.costRet = cr; a.type = "cost-return"; a.auto = true; } }
const crMatch = (cr, c) => (!cr.types.length || cr.types.includes(c.t)) && (!cr.icons.length || cr.icons.some(j => c.cls.some(t => t.replace("♂", "") === j.replace("♂", ""))))
  && (!cr.faction || c.f === cr.faction) && (!cr.named || !!cardName(c)) && (!cr.notNamed || !cardName(c));
/** Sources that send the cost of this play back to the hand: [label]. pays = [{pid} | pid] the cost was paid from. */
function costReturnFor(S, p, c, uid, to, pays) {
  const out = [], fromPids = (pays || []).map(x => (typeof x === "string" ? x : x && x.pid));
  if (c.abil.some(a => a.costRet && a.costRet.mode === "self")) out.push(`「${c.jp}」`);
  for (const x of liveAbilities(S, ["continuous"])) {
    const cr = x.a.costRet;
    if (!cr || !crMatch(cr, c)) continue;
    const ok = cr.mode === "field" ? (!cr.yours || x.o === p)
      : cr.mode === "fromThis" ? x.o === p && fromPids.includes(x.pid)
      : cr.mode === "breakOn" ? c.t === "Break" && to.break === x.pid
      : cr.mode === "permOn" ? c.t === "Permanent" && to.perm === x.pid : false;
    if (ok) out.push(`「${x.c.jp}」`);
  }
  return out;
}

/* ---------- Special abilities (written for one wording each) ---------- */
const SPECIALS = [
  { // A3-24 3459: 支配エリアのスカラー・スカラー♂がプレイヤーに対してアタック宣言するか、支配キャラクターのアタック宣言に対してガード宣言した場合、≪そのキャラクターのオーナー≫は1ドロー可能。
    id: "icon-attack-guard-draw", label: "Special: draw when one of them attacks a player or guards a dominated character",
    re: /^支配エリアの(.+?)がプレイヤーに対してアタック宣言するか、支配キャラクターのアタック宣言に対してガード宣言した場合、≪そのキャラクターのオーナー≫は([0-9０-９])ドロー可能。/,
    read: m => ({ icons: T_ICONS.filter(j => m[1].includes(j)), n: halfInt(m[2]) }),
    // which characters set it off at this moment
    watch: (S, timing, chars, sp) => {
      const hasIcon = x => { const c = x.o.piles[x.pid] && cardOf(S, pileTop(x.o.piles[x.pid])); return !!c && x.o.piles[x.pid].area === "dominion" && c.cls.some(t => sp.icons.includes(t.replace("♂", "")) || sp.icons.includes(t)); };
      if (timing === "attack" && S.ma && !S.ma.target && maDefender(S)) return chars.filter(hasIcon);
      if (timing === "guard" && S.ma) return chars.slice(0, 1).filter(hasIcon);   // chars[0] = the guard
      return [];
    },
    run: (S, p, sp, log) => { let k = 0; for (; k < sp.n && p.deck.length; k++) p.hand.push(p.deck.shift()); log(`${p.name} draws ${k}`); },
  },
];
for (const c of CARDS) for (const a of c.abil) {
  const sp = SPECIALS.find(x => x.re.test(a.text));
  if (sp) Object.assign(a, { kind: "watch", type: "special", special: sp.id, sp: sp.read(a.text.match(sp.re)), auto: true, short: sp.label });
}
/** Field abilities that watch other characters (Specials): queue them for the characters that set them off. */
function queueWatchers(S, timing, chars, log) {
  for (const x of liveAbilities(S, ["watch"])) {
    const sp = SPECIALS.find(y => y.id === x.a.special);
    for (const t of sp ? sp.watch(S, timing, chars, x.a.sp) : []) {
      S.trig = S.trig || [];
      S.trig.push({ id: `${S.log.length}-${x.uid}-w${t.pid}`, seat: t.o.seat, pid: t.pid, uid: x.uid, k: x.c.abil.indexOf(x.a), timing });
      log(`⏵ 「${x.c.jp}」 — ${sp.label}: 「${nameOf(S, pileTop(t.o.piles[t.pid]))}」`, x.uid);
    }
  }
}
/** Damage protection from the character's own always-on abilities. Returns {normal, mental} to cancel, or null. */
const IMMUNE_RE = /(精神ダメージを受けない|通常(攻撃による)?ダメージを受けない|バトルによる(通常)?ダメージを受けない)/;
function abilityDamageRule(S, o, pile, d) {
  const out = {};
  for (const x of liveAbilities(S)) {
    if (x.pile !== pile || x.a.scope !== "self") continue;
    const t = x.a.text;
    if (/精神ダメージを受けない/.test(t) && d.mental) out.mental = 0;
    if (/通常(攻撃による)?ダメージを受けない/.test(t) && d.normal && (!/攻撃による/.test(t) || d.battle)) out.normal = 0;
    if (/バトルによる(通常)?ダメージを受けない/.test(t) && d.battle) {
      const fp = d.fromPile, fc = d.from;
      const ok = /ブレイクしていないキャラクターとの/.test(t) ? !!fp && fp.stack.length === 1
        : /ネームレベルでないキャラクターとの/.test(t) ? !!fc && !cardName(fc)
        : /パワーがX以下のキャラクターとの/.test(t) ? !!fp && fp.power.length <= xValue(S, o, pile, x.a.xdef, 0, x.c)
        : /キャラクターとの/.test(t) ? false : true;   // other qualifiers: by hand
      if (ok) { out.normal = 0; if (!/通常/.test(t)) out.mental = 0; }
    }
  }
  return Object.keys(out).length ? out : null;
}
/** Field effects box: continuous abilities that reach other characters or players. */
const fieldAbilities = S => liveAbilities(S, ["continuous"]).filter(x => x.a.scope !== "self");

/** Card details: the abilities of a card. */
const abilHTML = c => (c.abil && c.abil.length ? `<div class="effs abil"><span class="dlabel">Abilities · ${c.abil.length}</span>${c.abil.map(a => `<div class="eff"><span class="efc ab" title="Ability">${a.kind === "trigger" ? "⏵" : a.kind === "during" ? "⚔" : "∞"}</span><div>
  <b>${esc(a.kind === "watch" ? a.short : a.kind === "trigger" ? TRIGGER[a.timing].label : a.kind === "during" ? "During battle" : a.scope === "field" ? "Field effect (always on)" : a.scope === "player" ? "Players (always on)" : "This character (always on)")}</b>
  ${a.when && !(a.en || enLineOf(c, a.text)) ? `<span class="note">if ${esc(a.when)}</span>` : ""} ${effectChipHTML(a)}${a.auto ? "" : ` <span class="note">✋ by hand</span>`}${(en => en ? `<div lang="en" title="${esc(a.text)}">${esc(en)}</div>` : `<div lang="ja" class="note">${esc(a.text)}</div>`)(a.en || enLineOf(c, a.text))}</div></div>`).join("")}</div>` : "");
