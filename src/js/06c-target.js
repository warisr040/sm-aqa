/* ==========================================================================
   Targeting system.

   Card text marks targets with ≪…≫. Every target is read as
     WHAT × HOW MANY × WHOSE × WHERE × CONDITIONS
   (tools/targets.py does the same over the whole card list and writes the catalog).

   Field effects use the same pieces as a "target spec":
     { scope, seat, area, slot, icons[], faction, broken, aggressive, name, powerMax, mentalMax, battle }
   targetMatch(spec, S, owner, pile) says whether a character is affected.
   To add a new kind of scope or condition, add one entry to TARGET_SCOPES or TARGET_CONDS.
   ========================================================================== */

/* ---------- reading card text ---------- */
const T_ICONS = Object.keys(CLASS_EN);
const T_FACTIONS = { "E.G.O.": "E.G.O.", "阿羅耶識": "Arayashiki", "WIZ-DOM": "WIZ-DOM", "WIZーDOM": "WIZ-DOM", "ダークロア": "Darklore", "極星帝国": "Polestar Empire" };
const T_WHAT = [
  ["cost", "Cost", /コスト$/], ["power", "Power card", /パワーカード/], ["deck", "Deck", /デッキ/], ["discardpile", "Discard pile", /捨て札置き場/],
  ["damagepile", "Damage pile", /ダメージ置き場/], ["hand", "Hand", /手札/], ["party", "Faction party", /勢力パーティ|勢力1つ|の勢力の/], ["area", "Area", /エリア1つ|エリアの(?!キャラ)/],
  ["project", "Project card", /プロジェクトカード/], ["fast", "Fast card", /ファストカード/], ["permanent", "Permanent card", /パーマネント/], ["break", "Break card", /ブレイクカード/],
  ["player_or_char", "Player or character", /プレイヤーまたはキャラクタ|キャラクターまたはプレイヤ|アタック目標/],
  ["player", "Player", /プレイヤ|あなた$|^あなた(と|、)|オーナー|対戦相手(全て|1人)?$/], ["thiscard", "This card", /^このカード$/],
  ["character", "Character", new RegExp("キャラクタ|人$|体$|全て$|[1-9X]人|バトル相手|“|”|分類|" + T_ICONS.join("|"))], ["card", "Card", /カード/],
];
const T_COUNT = [["all", "all", /全て|全員/], ["upto", "up to X", /まで/], ["x", "X", /[XＸ][体枚人]/], ["one", "1", /1[人枚体つ]/], ["self", "this one", /^この(キャラクター|カード)$/]];
const T_WHOSE = [["notyou", "not yours", /あなた以外/], ["opp", "opponent's", /対戦相手/], ["yours", "your", /あなたの|あなたが/], ["choice", "any", /任意/]];
const T_WHERE = [["territory", "territory", /テリトリー/], ["control", "control area", /支配/], ["active", "active area", /勢力エリア|アクティブ/], ["field", "field", /場の|場に/]];
const T_CONDS = [
  ["self", "this", /^この(キャラクター|カード)/], ["battle", "in battle", /アタック|ガード|バトル/], ["broken", "broken", /ブレイクしている/],
  ["unbroken", "not broken", /ブレイクしていない/], ["aggressive", "▼", /▼/], ["power", "power", /パワ[ー-]\s*[0-9X]/], ["mental", "mental", /精神力/],
  ["name", "name", /ネーム|“/], ["chosen", "chosen", /指定|選んだ/],
];
/** ≪target≫ text → parts {what, count, whose, where, cond[], icons[], factions[], label}. */
function parseTarget(t) {
  t = String(t || "").trim();
  const pick = table => (table.find(([, , re]) => re.test(t)) || [])[0] || "";
  const what = pick(T_WHAT) || "other", lab = k => (T_WHAT.find(x => x[0] === k) || [k, "Other"])[1];
  const P = { text: t, what, count: pick(T_COUNT), whose: pick(T_WHOSE), where: pick(T_WHERE),
    cond: T_CONDS.filter(([, , re]) => re.test(t)).map(x => x[0]),
    icons: T_ICONS.flatMap(j => [t.replace(new RegExp(j + "♂", "g"), "").includes(j) ? j : "", t.includes(j + "♂") ? j + "♂" : ""]).filter(Boolean), factions: Object.keys(T_FACTIONS).filter(j => t.includes(j)).map(j => T_FACTIONS[j]) };
  const L = (k, table) => (table.find(x => x[0] === P[k]) || [, ""])[1];
  P.label = [L("count", T_COUNT), L("whose", T_WHOSE), P.icons.map(j => CLASS_EN[j.replace("♂", "")]).join("/"), P.factions.join("/"),
    P.cond.filter(c => !["self", "name"].includes(c)).map(c => T_CONDS.find(x => x[0] === c)[1]).join(", "), lab(what) + (P.count === "all" ? "s" : ""),
    P.where ? "in " + L("where", T_WHERE) : ""].filter(Boolean).join(" ");
  return P;
}
/** All targets of a card. */
const cardTargets = c => [...String(c && c.text || "").matchAll(/≪([^≫]+)≫/g)].map(m => parseTarget(m[1]));

/* ---------- field effect scopes ---------- */
const TARGET_SCOPES = [
  { id: "game", label: "Whole game — every character on the field", test: () => true },
  { id: "territory", label: "Territory — one player's characters (all their areas)", needSeat: true, test: () => true },
  { id: "area", label: "Specific area", test: () => true },   // the area itself is checked in targetMatch
  { id: "party", label: "Faction party — one faction slot of the Active area", test: (s, o, p) => p.area === "faction" && (!s.slot || p.slot === s.slot) },
];
const TARGET_AREAS = [
  ["active", "Active area (勢力エリア)", p => p.area === "faction"],
  ["active-top", "Active characters (top of each faction)", (p, o) => p.area === "faction" && isSlotTop(o, Object.keys(o.piles).find(k => o.piles[k] === p))],
  ["control", "Control area (支配エリア)", p => p.area === "dominion"],
  ["control-front", "Control area (Front)", p => p.area === "dominion" && p.row !== "back"],
  ["control-back", "Control area (Back)", p => p.area === "dominion" && p.row === "back"],
];
function areaMatch(area, pile, owner) { const a = TARGET_AREAS.find(x => x[0] === area); return !a || a[2](pile, owner); }
const TARGET_CONDS = [   // conditions on the character itself
  { id: "icons", label: "Class icon (any of)", test: (s, c) => !s.icons || !s.icons.length || s.icons.some(t => c.cls.includes(t)) },
  { id: "faction", label: "Faction", test: (s, c) => !s.faction || c.f === s.faction },
  { id: "broken", label: "Broken / not broken", test: (s, c, p) => !s.broken || (s.broken === "yes" ? p.stack.length > 1 : p.stack.length === 1) },
  { id: "aggressive", label: "Has ▼", test: (s, c) => !s.aggressive || isAggressive(c) },
  { id: "name", label: "Name contains", test: (s, c) => !s.name || c.jp.includes(s.name) || c.en.toLowerCase().includes(s.name.toLowerCase()) },
  { id: "powerMax", label: "Power ≤", test: (s, c, p) => s.powerMax == null || s.powerMax === "" || p.power.length <= +s.powerMax },
  { id: "mentalMax", label: "Mental ≤ (printed)", test: (s, c) => s.mentalMax == null || s.mentalMax === "" || (numOf(c.st.se) ?? 0) <= +s.mentalMax },
  { id: "battle", label: "In battle (attacking / guarding)", test: (s, c, p, S, o, pid) => !s.battle || inBattle(S, o, pid) },
];
function inBattle(S, owner, pid) {
  if (STAT_NOBATTLE) return false;
  const fc = S.fc;
  if (fc && S.turn === owner.seat && (fc.pid === pid || fc.guard === pid)) return true;
  return pileInBattle(S, owner, pid);
}
/** Is this character affected by a target spec? (old field effects: icon / faction / area / seat are read too) */
function targetMatch(spec, S, owner, pile) {
  const c = cardOf(S, pileTop(pile));
  if (!c || (c.t !== "Character" && c.t !== "Break") || pile.area === "pf") return false;
  const s = Object.assign({}, spec, spec.icon && !spec.icons ? { icons: [spec.icon] } : {});
  s.area = { faction: "active", dominion: "control" }[s.area] || s.area;   // older saved field effects
  if (s.area && !s.scope) s.scope = "area";
  const sc = TARGET_SCOPES.find(x => x.id === (s.scope || "game"));
  if (s.seat != null && s.seat !== "" && +s.seat !== owner.seat) return false;
  const pid = Object.keys(owner.piles).find(k => owner.piles[k] === pile);
  if (sc && !sc.test(s, owner, pile)) return false;
  if (s.area && !areaMatch(s.area, pile, owner)) return false;
  return TARGET_CONDS.every(x => x.test(s, c, pile, S, owner, pid));
}
/** Short description of a target spec ("Arayashiki party of Pack · Student · not broken"). */
function targetLabel(s, S) {
  const who = s.seat == null || s.seat === "" ? "" : (S && S.players[+s.seat] ? S.players[+s.seat].name + "'s " : "");
  const sc = { game: "whole game", territory: `${who || "each player's "}territory`, area: `${who}${(TARGET_AREAS.find(a => a[0] === s.area) || [, "any area"])[1]}`,
    party: `${who}${s.slot || "any"} faction party` }[s.scope || (s.area ? "area" : "game")];
  const cond = [s.icons && s.icons.length ? s.icons.map(classLabel).join(" / ") : s.icon ? classLabel(s.icon) : "", s.faction, s.broken === "yes" ? "broken" : s.broken === "no" ? "not broken" : "",
    s.aggressive ? "▼" : "", s.name ? `name “${s.name}”` : "", s.powerMax !== "" && s.powerMax != null ? `power ≤ ${s.powerMax}` : "",
    s.mentalMax !== "" && s.mentalMax != null ? `mental ≤ ${s.mentalMax}` : "", s.battle ? "in battle" : ""].filter(Boolean);
  return [sc, ...cond].join(" · ");
}
/** Characters a spec matches right now: [{owner, pid}]. */
const targetsNow = (spec, S) => S.players.flatMap(o => o.porder.filter(pid => targetMatch(spec, S, o, o.piles[pid])).map(pid => ({ o, pid })));
