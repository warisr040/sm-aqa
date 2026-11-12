/* ==========================================================================
   Condition System — "when X, this character gains …" abilities.

   e.g. A3-24 3500 神魔“アシュタルテー”:
     このカードの下に「魔人“アシュタルテー”」がある場合、≪このキャラクター≫はインフィニティを得、
     エフェクト「2：…」を持つ。
   Each such line of a Character / Break card is read into
     c.conds[k] = { text, when (the condition text), rule (CONDITION_RULES id or ""), args,
                    skills: ["Infinity"], stat: {se, at, de} | null, effects: [{cost, jp, en, steps…}] }
   While the condition holds, the character has those skills (pileHasSkill, Charge / Draw sums),
   the stat change (STAT_SOURCES) and the effects (effect menu, "effect" event).

   A condition the table can't check by itself (rule "") is set by the player in the character's menu
   ("Condition met"), stored per character in pile.cond[uid:k] = true / false.
   To support a new kind of condition, add an entry to CONDITION_RULES.
   ========================================================================== */
const CQ = "[「“”\"'』『」]";
const condName = s => String(s || "").replace(new RegExp(CQ, "g"), "").replace(/\s+/g, "");
const cardHasName = (c, n) => !!c && condName(c.jp).includes(n);
const halfInt = s => +halfNum(s);
/** Characters on the field: [{o, pid, pile, c}] */
const fieldChars = (S, pred) => S.players.flatMap(o => o.porder.map(pid => ({ o, pid, pile: o.piles[pid], c: cardOf(S, pileTop(o.piles[pid])) })))
  .filter(x => x.c && (x.c.t === "Character" || x.c.t === "Break") && x.pile.area !== "pf" && (!pred || pred(x)));
const CONDITION_RULES = [
  { id: "under-n", label: "Card under this one (N or more)", re: /このカードの下に(.+?)が([0-9０-９]+)枚以上ある$/,
    test: (S, o, pile, c, m) => pile.stack.slice(0, -1).filter(u => cardHasName(cardOf(S, u), condName(m[1]))).length >= halfInt(m[2]) },
  { id: "under-same", label: "A card with the same name under this one", re: /このカードの下にこのカードと同じネームを持つカードがある$/,
    test: (S, o, pile, c) => { const n = cardName(c); return !!n && pile.stack.slice(0, -1).some(u => cardName(cardOf(S, u)) === n); } },
  { id: "under-named", label: "A named card under this one", re: /このカードの下にネームを持つカードがある$/,
    test: (S, o, pile) => pile.stack.slice(0, -1).some(u => !!cardName(cardOf(S, u))) },
  { id: "under-any", label: "Any card under this one", re: /このカードの下にカードがある$/, test: (S, o, pile) => pile.stack.length > 1 },
  { id: "under", label: "This card is set on a specific card", re: /このカードの下に(.+?)がある$/,
    test: (S, o, pile, c, m) => pile.stack.slice(0, -1).some(u => cardHasName(cardOf(S, u), condName(m[1]))) },
  { id: "power-mental", label: "Power = Mental", re: /このキャラクターのパワーが精神力に等しい$/,
    test: (S, o, pile) => { const m = statsOf(S, o, pile).se; return m != null && pile.power.length === m; } },
  { id: "power-min", label: "Power ≥ N", re: /このキャラクターのパワーが([0-9０-９]+)以上の?$/, test: (S, o, pile, c, m) => pile.power.length >= halfInt(m[1]) },
  { id: "power-eq", label: "Power = N", re: /このキャラクターのパワーが([0-9０-９]+)の?$/, test: (S, o, pile, c, m) => pile.power.length === halfInt(m[1]) },
  { id: "perm-set", label: "A permanent card is set on it", re: /このキャラクターにパーマネントカードがセットされている$/, test: (S, o, pile) => pile.perm.length > 0 },
  { id: "card-set", label: "A specific card is set on it", re: /このキャラクターに(.+?)がセットされている$/,
    test: (S, o, pile, c, m) => pile.perm.concat(pile.stack.slice(0, -1)).some(u => cardHasName(cardOf(S, u), condName(m[1]))) },
  { id: "in-control", label: "This character is in the Control area", re: /^このキャラクターが支配エリアに(セットされて)?いる$/, test: (S, o, pile) => pile.area === "dominion" },
  { id: "in-active", label: "This character is in the Active area", re: /^このキャラクターが勢力エリアに(セットされて)?いる$/, test: (S, o, pile) => pile.area === "faction" },
  { id: "in-battle", label: "This character is in battle", re: /^このキャラクターが(バトル中|バトルしている)$/,
    test: (S, o, pile) => { const pid = Object.keys(o.piles).find(k => o.piles[k] === pile); return pileInBattle(S, o, pid); } },
  { id: "attacking", label: "This character is attacking", re: /このキャラクターがアタック宣言している$/,
    test: (S, o, pile) => { const pid = Object.keys(o.piles).find(k => o.piles[k] === pile); return !!S.ma && S.ma.seat === o.seat && S.ma.pid === pid; } },
  { id: "control-name", label: "A named character in your control area", re: /あなたの支配エリアに(?:分類・)?(.+?)がいる$/,
    test: (S, o, pile, c, m) => { const n = condName(m[1]), ic = Object.keys(CLASS_EN).find(j => n === j);
      return fieldChars(S, x => x.o === o && x.pile.area === "dominion" && x.pile !== pile && (ic ? x.c.cls.some(t => t.replace("♂", "") === ic) : cardHasName(x.c, n))).length > 0; } },
  { id: "field-name", label: "A named character on the field", re: /^場に(.+?)がいる$/,
    test: (S, o, pile, c, m) => fieldChars(S, x => x.pile !== pile && cardHasName(x.c, condName(m[1]))).length > 0 },
  { id: "count-faction", label: "N or more of your dominated characters of a faction", re: /^(E\.G\.O\.|阿羅耶識|WIZ[ー-]DOM|ダークロア|極星帝国|イレイザー)のあなたの支配キャラクターが([0-9０-９]+)体以上いる$/,
    test: (S, o, pile, c, m) => fieldChars(S, x => x.o === o && x.pile.area === "dominion" && x.c.f === (T_FACTIONS[m[1]] || (m[1] === "イレイザー" ? "Eraser" : m[1]))).length >= halfInt(m[2]) },
  { id: "count-with", label: "N or more of your dominated characters with …", re: /^(.+?)を持つ(ブレイクしている)?あなたの支配キャラクターが([0-9０-９]+)体以上いる$/,
    test: (S, o, pile, c, m) => fieldChars(S, x => x.o === o && x.pile.area === "dominion" && (!m[2] || x.pile.stack.length > 1)
      && (x.c.cls.some(t => t.replace("♂", "") === m[1]) || String(x.c.classRaw || "").includes(m[1]) || x.c.text.includes(m[1]))).length >= halfInt(m[3]) },
  { id: "damage-min", label: "Your damage pile ≥ N", re: /^あなたのダメージ置き場のカード枚数が([0-9０-９]+)枚以上の?$/, test: (S, o, pile, c, m) => o.damage.length >= halfInt(m[1]) },
  { id: "deck-eq", label: "Your deck = N cards", re: /^あなたの残りデッキ枚数が([0-9０-９]+)枚の?$/, test: (S, o, pile, c, m) => o.deck.length === halfInt(m[1]) },
  { id: "opp-hand", label: "Opponents' hands ≥ N", re: /^あなたの対戦相手全ての手札枚数の合計が([0-9０-９]+)枚以上の?$/,
    test: (S, o, pile, c, m) => S.players.filter(x => x !== o).reduce((n, x) => n + x.hand.length, 0) >= halfInt(m[1]) },
  { id: "stack-min", label: "N or more cards make up this character", re: /^このキャラクターを構成するカードが([0-9０-９]+)枚以上ある$/,
    test: (S, o, pile, c, m) => pile.stack.length + pile.power.length + pile.perm.length >= halfInt(m[1]) },
  // name-level characters = characters with a name in “ ” (cardName)
  { id: "nl-broken-own", label: "A broken name-level character in your territory", re: /^あなたのテリトリーに、?ブレイクしているネームレベルキャラクターがいる$/,
    test: (S, o, pile) => fieldChars(S, x => x.o === o && x.pile !== pile && x.pile.stack.length > 1 && !!cardName(x.c)).length > 0 },
  { id: "nl-opp-territory", label: "A name-level character in an opponent's territory", re: /^対戦相手のテリトリーにネームレベルキャラクターがいる$/,
    test: (S, o) => fieldChars(S, x => x.o !== o && !!cardName(x.c)).length > 0 },
  { id: "nl-opp-control", label: "An opponent dominates a name-level character", re: /^あなたの対戦相手がネームレベルキャラクターを支配している$/,
    test: (S, o) => fieldChars(S, x => x.o !== o && x.pile.area === "dominion" && !!cardName(x.c)).length > 0 },
  { id: "nl-other", label: "Another name-level character on the field", re: /^このキャラクター以外のネームレベルキャラクターがいる$/,
    test: (S, o, pile) => fieldChars(S, x => x.pile !== pile && !!cardName(x.c)).length > 0 },
  { id: "nl-none-control", label: "No other name-level character in your control area", re: /^あなたの支配エリアに、?このキャラクター以外のネームレベルキャラクターが存在しない$/,
    test: (S, o, pile) => fieldChars(S, x => x.o === o && x.pile.area === "dominion" && x.pile !== pile && !!cardName(x.c)).length === 0 },
  { id: "same-area", label: "In the same area as a character of a faction", re: /^このキャラクターが(E\.G\.O\.|阿羅耶識|WIZ[ー-]DOM|ダークロア|極星帝国|イレイザー)の(ネームレベル)?キャラクターと同じエリアにいる$/,
    test: (S, o, pile, c, m) => { const f = T_FACTIONS[m[1]] || "Eraser";
      return fieldChars(S, x => x.o === o && x.pile !== pile && x.pile.area === pile.area && x.c.f === f && (!m[2] || !!cardName(x.c))).length > 0; } },
  { id: "not-first", label: "You are not the first player", re: /^あなたが先攻でない$/, test: (S, o) => isSecondPlayer(S, o) },
  { id: "dominate-n", label: "You dominate N or more characters with an icon", re: /^あなたが(.+?)を([0-9０-９]+)体以上支配している$/,
    test: (S, o, pile, c, m) => { const ic = Object.keys(CLASS_EN).find(j => m[1].includes(j));
      return fieldChars(S, x => x.o === o && x.pile.area === "dominion" && (ic ? x.c.cls.some(t => t.replace("♂", "") === ic) : x.c.text.includes(m[1]))).length >= halfInt(m[2]); } },
  { id: "opp-dominates", label: "An opponent dominates a character of a faction", re: /^対戦相手が(E\.G\.O\.|阿羅耶識|WIZ[ー-]DOM|ダークロア|極星帝国|イレイザー)のキャラクターを支配している$/,
    test: (S, o, pile, c, m) => fieldChars(S, x => x.o !== o && x.pile.area === "dominion" && x.c.f === (T_FACTIONS[m[1]] || "Eraser")).length > 0 },
  { id: "damage-or-deck", label: "Damage pile ≥ N or deck ≤ M", re: /^あなたのダメージ置き場のカード枚数が([0-9０-９]+)枚以上、またはあなたのデッキ枚数が([0-9０-９]+)枚以下の?$/,
    test: (S, o, pile, c, m) => o.damage.length >= halfInt(m[1]) || o.deck.length <= halfInt(m[2]) },
  { id: "no-same-icon", label: "No other character with the same icon on the field", re: /^このキャラクター以外の、このキャラクターと同じ分類を持つキャラクターが場に存在しない$/,
    test: (S, o, pile, c) => fieldChars(S, x => x.pile !== pile && x.c.cls.some(t => c.cls.includes(t))).length === 0 },
];
const CONDITION_RULE = Object.fromEntries(CONDITION_RULES.map(r => [r.id, r]));
const LEAD_SKILLS = /^(?:▼\s*|(?:チャージ|ドロー|バインド|ブースト|キャパシティ|パーマネント|リムーブ)[+\-−]?[0-9０-９XＸ]+\s+|(?:シールド|インターセプト|イニシアチブ|ブレイクスルー|オフェンシブ|ディフェンシブ|シンクロ|ペネトレイト|デュアル|ステルス|インフィニティ)\s+)+/;
const SKILL_VALUED_JP = { "チャージ": "Charge", "ドロー": "Draw", "バインド": "Bind", "ブースト": "Boost", "キャパシティ": "Capacity" };
/** One "…場合、≪このキャラクター≫は…" line → condition entry, or null. */
function parseCondLine(line, enLine) {
  let m = line.match(/^(.+?)場合、(?:≪?この(?:キャラクター|カード)≫?(?:は|に)、?)(.+)$/), partial = false;
  if (!m) {   // other characters first, then "≪このキャラクター≫は…": keep the part for this character (the rest is an ability)
    const k = line.match(/^(.+?)場合、.*?、≪この(?:キャラクター|カード)≫(?:は|に)、?(.+)$/);
    if (k) { m = k; partial = true; }
  }
  if (!m || /^[0-9０-９XＸ]+[:：]/.test(line)) return null;
  const when = m[1].replace(LEAD_SKILLS, "").trim(), what = m[2];
  const skills = [], wh = what.replace(/「[^」]*」/g, "");   // skills given outside the quoted effects
  if (/(を得|を持つ|を与え)/.test(wh)) for (const [j, en] of Object.entries(SKILL_JP)) if (wh.includes(j)) skills.push(en);
  for (const [j, en] of Object.entries(SKILL_VALUED_JP)) {
    const v = halfNum(wh).match(new RegExp(j + "([+\\-]?[0-9]+)"));
    if (v) skills.push(`${en} ${/^[+-]/.test(v[1]) ? v[1] : "+" + v[1]}`);
  }
  const st = effectStat(what.replace(/「[^」]*」/g, ""), 0), stat = st.se || st.at || st.de ? st : null;
  const ens = [...String(enLine || "").matchAll(/[“"]([0-9X]+):\s*([^”"]+)[”"]/g)];
  const effects = [...what.matchAll(/「([0-9０-９XＸ]+)\s*[:：]\s*([^」]+)」/g)].map((x, i) => Object.assign(
    { cost: halfNum(x[1]), jp: x[2].trim(), en: ens[i] ? ens[i][2].trim() : "" }, classifyEffect(x[2].trim())));
  if (!skills.length && !stat && !effects.length) return null;
  const rule = CONDITION_RULES.find(r => r.re.test(when));
  return { text: line, when, rule: rule ? rule.id : "", skills, stat, effects, partial };
}
for (const c of CARDS) {
  c.conds = [];
  if (c.t !== "Character" && c.t !== "Break") continue;
  const en = String(c.textEn || "").split("\n");
  String(c.text || "").split("\n").forEach((l, i) => { const x = parseCondLine(l.trim(), en[i]); if (x) c.conds.push(x); });
}
/** Every effect of a card: printed ones first, then the ones its conditions give (index = position in this list). */
const allEffects = c => (c ? c.effects.concat(c.conds.flatMap((cd, k) => cd.effects.map(e => Object.assign(e, { cond: k })))) : []);

/** Does condition k of card c (on this character) hold right now? Player's choice wins for conditions the table can't check. */
function condOn(S, owner, pile, uid, k) {
  const c = cardOf(S, uid), cd = c && c.conds[k];
  if (!cd) return false;
  const set = pile.cond && pile.cond[uid + ":" + k];
  if (set != null) return set;
  const r = CONDITION_RULE[cd.rule];
  if (!r) return false;
  try { return !!r.test(S, owner, pile, c, cd.when.match(r.re)); } catch (err) { return false; }
}
/** Conditions of the top card that hold now: [{k, cd}] */
const activeConds = (S, owner, pile) => { if (!S || !owner || !pile) return []; const u = pileTop(pile), c = cardOf(S, u);
  return c ? c.conds.map((cd, k) => ({ k, cd })).filter(x => condOn(S, owner, pile, u, x.k)) : []; };
/** Effects of the top card usable now (printed + from conditions that hold), with their index for the "effect" event. */
const usableEffects = (S, owner, pile, uid) => allEffects(cardOf(S, uid)).map((e, i) => ({ e, i }))
  .filter(({ e }) => e.cond == null || (uid === pileTop(pile) && condOn(S, owner, pile, uid, e.cond)));
const condSkills = (S, owner, pile) => activeConds(S, owner, pile).flatMap(x => x.cd.skills);
// stats from conditions (e.g. 場に“ウルド”がいる場合 +2/+2/+2)
STAT_SOURCES.push(Object.assign((S, owner, pile) => activeConds(S, owner, pile).filter(x => x.cd.stat).map(x => ({ label: `Condition: ${x.cd.when.slice(0, 30)}`, se: x.cd.stat.se || 0, at: x.cd.stat.at || 0, de: x.cd.stat.de || 0 })), { deep: true }));
const condLabel = cd => (CONDITION_RULE[cd.rule] ? CONDITION_RULE[cd.rule].label : "Checked by the player");
/** Card details: the conditions of a card. */
const condsHTML = c => (c.conds && c.conds.length ? `<div class="effs conds"><span class="dlabel">Conditions · ${c.conds.length}</span>${c.conds.map(cd => `<div class="eff"><span class="efc cond" title="Condition">◆</span><div>
  <b>${esc(condLabel(cd))}</b> ${(en => en ? `<span class="note" lang="en" title="${esc(cd.when)}">${esc(en)}</span>` : `<span class="note">${esc(cd.when)}</span>`)(enLineOf(c, cd.text))}<div>→ ${esc([cd.skills.join(", "), cd.stat ? statTxt(cd.stat) : "", cd.effects.map(e => `effect ${e.cost}：${e.en || e.jp}`).join(" · ")].filter(Boolean).join(" · "))}</div></div></div>`).join("")}</div>` : "");
