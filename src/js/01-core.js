"use strict";
/* ==========================================================================
   Aquarian Age Helper · core
   Data model (cards, series, class icons, stats), small helpers, persistence.
   Every later module relies on the names defined here (classic scripts share
   one global scope, so the site also works when index.html is opened from disk).
   ========================================================================== */

const DATA = window.AA_DATA;
const NOT_AUTO = new Set(DATA.na || []);   // card keys whose rules are partial / by hand (build.py, Revise#167)

const LINKS = {
  folder: "https://drive.google.com/drive/folders/1q7VxU-Zev4TM2A0QghLu3xBMpoU8OPGW",
  sheet:  "https://docs.google.com/spreadsheets/d/12kfDbNjVC5azKD2y1KYzs_SSx4ZBJOUN/edit",
};
const LIMITS = { deck: 60, min: 50, copies: 4 };   // the official deck rules — shown as a guide only; the Deck Builder no longer limits cards (Pack, Revise#211)

/* Deck categories (the five playable card types), in board order. */
const CATS = [
  { id: "Character", short: "Char",  color: "#ffd447" },
  { id: "Break",     short: "Break", color: "#ff6b7a" },
  { id: "Fast",      short: "Fast",  color: "#52b6ff" },
  { id: "Project",   short: "Proj",  color: "#b994ff" },
  { id: "Permanent", short: "Perm",  color: "#4fe3a6" },
];
const CAT = Object.fromEntries(CATS.map(c => [c.id, c]));

/* Card stats, in the order used by filters, sort buttons and the details panel. */
const STATS = [
  { k: "fa", label: "Factor" },
  { k: "co", label: "Cost" },
  { k: "se", label: "Mental" },   // 精神力
  { k: "at", label: "Attack" },
  { k: "de", label: "Defense" },
  { k: "ra", label: "Rarity", noGrid: true },   // filter + sort only (shown in the details list)
  { k: "ef", label: "Effect cost", noGrid: true },   // cost of the card's effects (a card can have several: filter = any of them, sort = the lowest)
];

/** Rarity rank (higher = rarer): number of ★ first, then the letter prefix.
    ★ < U★ < ★★ < R★★ < ★★★ < SR★★★ < PF★★★★ < RPF★★★★ < SPF★★★★ < VF★★★★★ < SVF★★★★★ < WR. */
const RARITY_BARE = { C: 10, PF: 40, VF: 50, SF: 51, WR: 60 };
const RARITY_PREFIX = { "": 0, U: 1, R: 2, SR: 3, PF: 0, RPF: 2, SPF: 3, VF: 0, SVF: 3 };
function rarityRank(r) {
  if (!r) return 0;
  if (RARITY_BARE[r] != null) return RARITY_BARE[r];
  const stars = (r.match(/★/g) || []).length, pre = r.replace(/★/g, "");
  return stars * 10 + (RARITY_PREFIX[pre] != null ? RARITY_PREFIX[pre] : 5);
}
const STAT_KEYS = STATS.map(s => s.k);

/* Class icons (分類アイコン), rulebook p.13 order. English names chosen by Pack.
   Male (♂) versions are kept as separate entries. */
const CLASS_EN = {
  "スチューデント": "Student", "ワーカー": "Worker", "アスリート": "Athlete", "スカラー": "Scholar",
  "タレント": "Talent", "ゴースト": "Ghost", "霊能者": "Psychic", "クリーチャー": "Creature",
  "ミスティック": "Mystic", "ヴァンパイア": "Vampire", "鬼": "Ogre", "モンスター": "Monster",
  "悪魔": "Devil", "マーメイド": "Mermaid", "ワータイガー": "Weretiger", "ワーウルフ": "Werewolf",
  "アンドロイド": "Android", "イレイザー": "Eraser", "ドラグーン": "Dragoon", "サイボーグ": "Cyborg",
  "マシン": "Machine", "ウォリアー": "Warrior", "スキャナー": "Scanner", "アンデッド": "Undead",
  "トライ": "Three-Eyed",
};
const CLASS_ORDER = Object.keys(CLASS_EN);

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const scrollToEl = el => el && el.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });

/** Search normalisation: full-width → half-width, lower-case, katakana → hiragana,
    and drop spaces, quotes, dots and brackets. */
function norm(s) {
  return (s || "").normalize("NFKC").toLowerCase()
    .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s"'“”‘’「」『』・･.\-_()（）]/g, "");
}

/* Card images live in Pack's Google Drive. thumbnail → lh3 → placeholder. */
/* Revise#398: with a pictures site (window.AA_IMG_BASE, assets/img-config.js) → <base>/s/<fid>.webp (400 px wide, for every size up to 400)
   or <base>/l/<fid>.webp (1000 px); a picture missing there falls back to Google Drive. */
const IMG_BASE = String((typeof window !== "undefined" && window.AA_IMG_BASE) || "").replace(/\/+$/, "");
const IMG = {
  cdn:   (fid, w) => `${IMG_BASE}/${w > 500 ? "l" : "s"}/${fid}.webp`,
  thumb: (fid, w) => (IMG_BASE ? IMG.cdn(fid, w) : IMG.drive(fid, w)),
  drive: (fid, w) => `https://drive.google.com/thumbnail?id=${fid}&sz=w${w}`,
  lh3:   (fid, w) => `https://lh3.googleusercontent.com/d/${fid}=w${w}`,
  file:  fid => `https://drive.google.com/file/d/${fid}/view`,
  none:  "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 63 88"><rect width="63" height="88" fill="#060828"/><path d="M31.5 30l2.6 6.4 6.9.5-5.3 4.4 1.7 6.7-5.9-3.7-5.9 3.7 1.7-6.7-5.3-4.4 6.9-.5z" fill="#ffd447" opacity=".55"/><text x="31.5" y="60" text-anchor="middle" font-family="sans-serif" font-size="5.5" fill="#aab2e6">No image</text></svg>'),
};

/** localStorage wrapper: never throws (private windows, blocked storage). */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
};

function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._t); t._t = setTimeout(() => (t.hidden = true), 1800);
}

/* ---------- reference data ---------- */
const SERIES = DATA.s.map(([code, en, jp, saga, page]) => ({ code, en, jp, saga, page }));
const SAGAS  = [...new Set(SERIES.map(s => s.saga))];
const FACTS  = DATA.f;
const TYPES  = DATA.t;
const NOTES  = DATA.n || [];
const POOL   = DATA.p || [];   // de-duplicated long strings (card text, illustrators, …)
const ALIAS  = DATA.a || {};   // old deck keys → current keys (card numbers changed in the completed list)
const pooled = i => (i >= 0 ? POOL[i] : "");

/** Split a raw 分類アイコン cell into known icons; tolerate spelling variants. */
function classTokens(raw) {
  if (!raw) return [];
  return raw.normalize("NFKC").split(/[\/／\n・,、]/).map(t => {
    t = t.replace(/\s+/g, "");
    const male = /♂/.test(t);
    let base = t.replace(/[♂♀]/g, "");
    if (/^ウォリア[-ｰ]?$/.test(base)) base = "ウォリアー";
    if (base === "霊能") base = "霊能者";
    return CLASS_EN[base] ? base + (male ? "♂" : "") : "";
  }).filter(Boolean);
}
/* Rulebook p.13: most class icons have separate female and male versions; these five don't. */
const CLASS_UNGENDERED = new Set(["ゴースト", "マーメイド", "アンドロイド", "マシン", "アンデッド"]);
const CLASS_GROUPS = [["female", "Female ♀"], ["male", "Male ♂"], ["other", "Other (no male/female version)"]];
/** "female" | "male" | "other". In the card list an icon without ♂ is the female version. */
const classGroup = t => (t.endsWith("♂") ? "male" : CLASS_UNGENDERED.has(t) ? "other" : "female");
const classLabel = t => CLASS_EN[t.replace("♂", "")] + ({ female: " ♀", male: " ♂", other: "" })[classGroup(t)];
/** Icon image cropped from the rulebook's class icon table (assets/icons). */
const classIcon = t => `icons/${CLASS_EN[t.replace("♂", "")].toLowerCase().replace(/[^a-z]+/g, "-")}${({ female: "-f", male: "-m", other: "" })[classGroup(t)]}.png`;
const classIconHTML = (t, cls = "kicon") => `<img class="${cls}" src="${classIcon(t)}" alt="" width="24" height="24" loading="lazy">`;

/* Factions (勢力): rulebook p.6 marks and colours (white, red, blue, green, yellow, black), shown on pastel backgrounds. */
const FACTION_META = {
  "E.G.O.":          { icon: "ego",        bg: "#eef1fb", color: "White" },
  "Arayashiki":      { icon: "arayashiki", bg: "#ffd9d9", color: "Red" },
  "WIZ-DOM":         { icon: "wizdom",     bg: "#d6e5ff", color: "Blue" },
  "Darklore":        { icon: "darklore",   bg: "#d4f1d6", color: "Green" },
  "Polestar Empire": { icon: "polestar",   bg: "#fff1b5", color: "Yellow" },
  "Eraser":          { icon: "eraser",     bg: "#dcdce6", color: "Black" },
};
const factionIconHTML = (f, size = 22) => (FACTION_META[f]
  ? `<img class="ficon" src="factions/${FACTION_META[f].icon}.png" alt="" width="${size}" height="${size}" loading="lazy">` : "");
/** Pastel badge: faction mark + name. */
const factionBadge = f => (FACTION_META[f]
  ? `<span class="fbadge" style="--fbg:${FACTION_META[f].bg}">${factionIconHTML(f, 18)}${esc(f)}</span>` : `<span class="fbadge none">${esc(f || "No faction")}</span>`);

/* Break-cost return characters: "▼ このキャラクターをブレイクする場合、≪そのブレイクカードのコスト≫は(オーナーの)手札に戻る。" */
const BREAK_RETURN = /このキャラクターをブレイクする場合、≪そのブレイクカードのコスト≫は(オーナーの)?手札に戻る/;

/* Effects: card-text lines that start with a cost — "1：…", "X：…" (circled numbers in print).
   Returns [{cost: "1" | "X", jp, en}] in card order; English lines are matched by position. */
const EFFECT_LINE = /^(?:▼|\s|(?:(?:チャージ|ドロー|バインド|パーマネント|キャパシティ|ブースト|リムーブ)[+\-−＋－]?[0-9０-９XＸ]+|シールド|インターセプト|イニシアチブ|ブレイクスルー|オフェンシブ|ディフェンシブ|シンクロ|ペネトレイト|デュアル|ステルス|インフィニティ|インヘレント|(?:レジスト|プロテクト)\S+|(?:Charge|Draw|Bind|Permanent|Capacity|Boost|Remove) ?[+\-]?[0-9X]+|Shield|Intercept|Initiative|Breakthrough|Offensive|Defensive|Synchro|Penetrate|Dual|Stealth|Infinity|Inherent|(?:Resist|Protect) \S+)(?=\s))*?([0-9０-９XＸ]+)\s*[:：]\s*(.+)$/;   // skills may come first on the line: "▼ チャージ1 1：…"
function parseEffects(jp, en) {
  const half = v => v.replace(/[０-９Ｘ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  const pick = t => String(t || "").split("\n").map(l => l.match(EFFECT_LINE)).filter(Boolean).map(m => ({ cost: half(m[1]), text: m[2].trim() }));
  const J = pick(jp), E = pick(en);
  return J.map((x, i) => ({ cost: x.cost, jp: x.text, en: E[i] && E[i].cost === x.cost ? E[i].text : "" }));
}
/** The English line of a card's text for one of its Japanese lines (same line number), or "" (Pack, Revise#161). */
function enLineOf(c, jp) {
  const nm = t => String(t || "").replace(/[\s。]/g, "").replace(/[-ー−]/g, "ー").replace(/[：:]/g, ":");
  const J = String(c && c.text || "").split("\n"), E = String(c && c.textEn || "").split("\n"), n = nm(jp);
  if (!n || J.length !== E.length) return "";
  let i = J.findIndex(l => nm(l) && nm(l) === n);
  if (i < 0) i = J.findIndex(l => nm(l) && (nm(l).includes(n) || n.includes(nm(l))));
  return i >= 0 ? E[i].trim() : "";
}
/** ≪…≫ number k of the English text, when the English text marks as many targets as the Japanese one (Pack, Revise#161). */
function enTargetsOf(c) {
  const j = [...String(c && c.text || "").matchAll(/≪([^≫]+)≫/g)], e = [...String(c && c.textEn || "").matchAll(/≪([^≫]+)≫/g)];
  return j.length === e.length ? e.map(m => m[1].trim()) : [];
}
const effectCostHTML = cost => `<span class="efc" title="Effect cost">${esc(cost)}</span>`;

/* ---------- cards ---------- */
const KEY = new Map();   // "SERIES NO" (upper case) → card
/* Skills. Valued skills carry a number (Charge +1, Draw +2, Capacity -1 …); the rest are on/off. */
const VALUED_SKILLS = DATA.vs || [];
const SKILL_SORT_KEYS = VALUED_SKILLS.map(k => "sk:" + k);   // sort keys used alongside the stat keys
const skillName = t => VALUED_SKILLS.find(k => t.startsWith(k + " ")) || "";

const CARDS = DATA.c.map(([id, jp, en, fid, si, fi, ti, ni, st, ex, yomi, skills, skillValues], i) => {
  const s = SERIES[si];
  let k = s.code + " " + id;
  if (KEY.has(k.toUpperCase())) k += "#2";   // a few signed reprints share series + number
  st = st || ["", "", "", "", ""];
  ex = ex || [];
  const c = {
    i, id, jp, en, fid, s, si, k, yomi: yomi || "",
    f: fi >= 0 ? FACTS[fi] : "",
    t: ti >= 0 ? TYPES[ti] : "",
    note: ni >= 0 && ni != null ? NOTES[ni] : "",
    factor: st[0],
    st: { fa: st[0] ? String([...st[0]].length) : "", co: st[1], se: st[2], at: st[3], de: st[4], ra: "" },
    text: pooled(ex[0]), classRaw: pooled(ex[1]), rarity: pooled(ex[2]), illustrator: pooled(ex[3]),
    scope: pooled(ex[4]), timing: pooled(ex[5]), variant: pooled(ex[6]), errata: pooled(ex[7]), textEn: pooled(ex[8]),
    skills: pooled(skills).split(";").filter(Boolean),                                   // e.g. ["Shield", "Charge +1"]
    sk: Object.fromEntries(VALUED_SKILLS.map((k, j) => [k, (skillValues || [])[j] || ""])), // e.g. {Charge: "+1", Draw: ""}
  };
  c.st.ra = c.rarity;
  c.na = NOT_AUTO.has(k);   // the Game Table can't run it fully by itself yet (Revise#167): red frame in Deck Builder
  c.br = c.t === "Character" && BREAK_RETURN.test(c.text);
  c.named = /“[^”]*\S[^”]*”/.test(jp);   // a name-level card: a personal name in “…”
  c.effects = parseEffects(c.text, c.textEn);
  c.efc = [...new Set(c.effects.map(e => e.cost))].sort((a, b) => (a === "X") - (b === "X") || a - b);   // effect costs, e.g. ["1", "3"]
  c.st.ef = c.efc[0] || "";
  c.cls = classTokens(c.classRaw);
  c.hay = [norm(jp), norm(en), norm(yomi), norm(s.code) + norm(id), norm(id)].join("|");
  KEY.set(k.toUpperCase(), c);
  return c;
});

/** Look up a card by deck key; old keys from earlier versions still resolve. */
function card(k) {
  const K = String(k).toUpperCase().replace(/\s+/g, " ");
  return KEY.get(K) || (ALIAS[K] && KEY.get(ALIAS[K]));
}

/* ---------- counts and option values (static, computed once) ---------- */
/** Values of one stat for filters and counts: one value, or every effect cost for "ef". */
const statVals = (c, k) => (k === "ef" ? (c.efc.length ? c.efc : ["__none"]) : [c.st[k] || "__none"]);
function countBy(fn) {
  const m = {};
  for (const c of CARDS) for (const v of [].concat(fn(c))) m[v] = (m[v] || 0) + 1;
  return m;
}
const COUNT = {
  f: countBy(c => c.f || "__none"),
  t: countBy(c => c.t || "__none"),
  k: countBy(c => [...new Set(c.cls)]),
  st: Object.fromEntries(STAT_KEYS.map(k => [k, countBy(c => statVals(c, k))])),
  sk: countBy(c => c.skills),
};
/** Skill checklist entries: each valued skill's values (sorted), then the other skills by frequency. */
const SKILL_LIST = [
  ...VALUED_SKILLS.flatMap(k => Object.keys(COUNT.sk).filter(t => skillName(t) === k)
    .sort((a, b) => { const A = sortKey(a.slice(k.length + 1)), B = sortKey(b.slice(k.length + 1)); return A[0] - B[0] || A[1] - B[1] || a.localeCompare(b); })),
  ...Object.keys(COUNT.sk).filter(t => !skillName(t)).sort((a, b) => COUNT.sk[b] - COUNT.sk[a]),
];
const CLASS_LIST = [];
CLASS_ORDER.forEach(b => { if (COUNT.k[b]) CLASS_LIST.push(b); if (COUNT.k[b + "♂"]) CLASS_LIST.push(b + "♂"); });

/** Order for stat option lists: numbers, X, +n, −n, (n), +(n). */
function optionOrder(v) {
  let m;
  if (/^-?\d+$/.test(v)) return [0, +v];
  if (v === "X") return [1, 0];
  if ((m = v.match(/^\+(\d+)$/))) return [2, +m[1]];
  if (v === "+X") return [2, 999];
  if ((m = v.match(/^-(\d+|X)$/))) return [3, m[1] === "X" ? 999 : +m[1]];
  if ((m = v.match(/^\((\d+|X)\)$/))) return [4, m[1] === "X" ? 999 : +m[1]];
  if ((m = v.match(/^\+\((\d+|X)\)$/))) return [5, m[1] === "X" ? 999 : +m[1]];
  return [9, 0];
}
const STAT_VALUES = Object.fromEntries(STAT_KEYS.map(k => [k,
  Object.keys(COUNT.st[k]).filter(v => v !== "__none").sort((a, b) => {
    if (k === "ra") return rarityRank(a) - rarityRank(b) || a.localeCompare(b);
    const A = optionOrder(a), B = optionOrder(b);
    return A[0] - B[0] || A[1] - B[1] || a.localeCompare(b);
  })]));

/** Sort key for a stat value: [group, number]. Blanks always last, X after numbers;
    (2) sorts as 2 and +1 as 1. */
function sortKey(v) {
  if (!v) return [2, 0];
  const m = v.match(/-?\d+/);
  return m ? [0, +m[0]] : [1, 0];
}

/* ---------- persisted UI state ---------- */
const TABS = ["home", "cards", "rules", "deck", "table", "changelog"];
const SEARCH_TABS = ["cards", "deck"];
const emptyStats = () => Object.fromEntries(STAT_KEYS.map(k => [k, ""]));
const emptyFilters = () => ({ q: "", s: "", f: "", t: "", nm: "", br: false, ks: [], km: "any", sks: [], skm: "any", st: emptyStats(), sort: [] });

/** Read a saved filter set, dropping anything that no longer exists in the data. */
function cleanFilters(u) {
  const F = emptyFilters();
  if (!u) return F;
  F.q = String(u.q || "");
  F.s = u.s !== "" && SERIES[+u.s] ? String(u.s) : "";
  F.f = u.f === "__none" || FACTS.includes(u.f) ? u.f : "";
  F.t = u.t === "__none" || TYPES.includes(u.t) ? u.t : "";
  F.br = u.br === true;
  F.nm = u.nm === "yes" || u.nm === "no" ? u.nm : "";
  F.ks = (Array.isArray(u.ks) ? u.ks : u.k ? [u.k] : []).filter(x => CLASS_LIST.includes(x));
  F.km = u.km === "all" ? "all" : "any";
  F.sks = (Array.isArray(u.sks) ? u.sks : []).filter(x => COUNT.sk[x]);
  F.skm = u.skm === "all" ? "all" : "any";
  for (const k of STAT_KEYS) {
    const v = u.st && u.st[k];
    F.st[k] = v === "__none" || (v && COUNT.st[k][v]) ? v : "";
  }
  F.sort = (Array.isArray(u.sort) ? u.sort : [])
    .filter(x => x && (STAT_KEYS.includes(x.k) || SKILL_SORT_KEYS.includes(x.k)))
    .map(x => ({ k: x.k, d: x.d === -1 ? -1 : 1 }));
  return F;
}

const UI = (() => {
  const u = store.get("aa-ui", {});
  return {
    tab: TABS.includes(u.tab) ? u.tab : "home",
    view: u.view === "deck" ? "deck" : "pick",              // phone-only Deck Builder pane
    mode: u.mode === "original" ? "original" : "fit",       // deck board card size
    rlang: ["ja", "en", "both"].includes(u.rlang) ? u.rlang : "both",
    statsOpen: !!u.statsOpen,
    fmode: u.fmode === "side" ? "side" : "inline",          // filters: inline (foldable) or sidebar
    fOpen: typeof u.fOpen === "boolean" ? u.fOpen : innerWidth > 700,   // inline filters unfolded (phones start folded)
    F: { cards: cleanFilters(u.S && u.S.cards), deck: cleanFilters(u.S && u.S.deck) },
  };
})();
function saveUI() {
  store.set("aa-ui", { tab: UI.tab, view: UI.view, mode: UI.mode, rlang: UI.rlang, statsOpen: UI.statsOpen, fmode: UI.fmode, fOpen: UI.fOpen, S: UI.F });
}
/** Filters for the current tab, or null on tabs without search. */
const curF = () => UI.F[UI.tab] || null;
