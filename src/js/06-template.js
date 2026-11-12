/* ==========================================================================
   Deck templates (Deck Builder → Template). Each template is a list of steps;
   add more templates to TEMPLATES.

   Template #2 Characters Only — the 30-character core:
     Setup (main/sub icon, main/sub factor) → Draw · main (4) → Draw · sub (4)
     → Break return (optional 4–8: “▼ このキャラクターをブレイクする場合…コストは手札に戻る” characters, any icon / faction)
     → Charge · main (12) → Charge · sub (up to 10) → Done
   Template #1 Full Deck — non-characters first (28–32 cards), then the characters:
     Main Break (search) → Setup (icons / factors recommended from the Main Break cards)
     → Break · Charge → Break · Draw (main factor; main icon section, then sub icon; ≥3 each recommended)
     → Permanent → Fast → Project (search; main factor section, then sub factor; rarest first)
     → the four character steps → Done
   Sections are foldable <details>; Draw steps: main icon, then sub icon.

   Sub icon: "None" = main icon only; "Any" = main icon, then other icons.
   Sub factor: "Any" = any faction except the main one.
   Every card: 0–4 copies (quick "×4"). Recommendations come from the Break cards in the deck.
   ========================================================================== */

const CHARACTER_TARGET = 30;
const NONCHAR = { min: 28, max: 32 };   // Template #2: non-character cards

let tpl = null;    // wizard state while the Template dialog is open
const ANY = "*";   // "Any" choice for the sub icon / sub factor
const NONE = "-";  // "None" choice for the sub icon (main icon only)
const realIcon2 = () => tpl.icon2 && tpl.icon2 !== ANY && tpl.icon2 !== NONE;
const realSub = () => tpl.sub && tpl.sub !== ANY;

const subFaction = c => (tpl.sub === ANY ? c.f !== tpl.main : c.f === tpl.sub);
const factorLabel = v => (v === ANY ? "Any" : v);
const iconsLabel = () => classLabel(tpl.icon) + (realIcon2() ? " + " + classLabel(tpl.icon2) : tpl.icon2 === ANY ? " + Any" : "");

/** Character cards in the deck (the 30-character target). */
const deckCharacters = () => deck.cols.Character.reduce((n, e) => n + e.n, 0);
/** Non-character cards in the deck (Template #2: 28–32). */
const deckNonCharacters = () => deckTotal() - deckCharacters();

/** Set the copies of one card (no limit since Revise#211). Returns copies set. */
function setCopies(k, want) {
  const c = card(k), f = entryOf(k);
  const n = Math.max(0, want);   // no 4-per-name / 60-card limit (Pack, Revise#211)
  if (f) { if (n) f.e.n = n; else deck.cols[f.cat].splice(f.i, 1); }
  else if (n) deck.cols[CAT[c.t] ? c.t : "Character"].push({ k: c.k, n });
  deckChanged();
  return n;
}

/* ---------- steps ---------- */
const hasDraw = c => c.sk.Draw && !c.sk.Draw.startsWith("-");
const hasCharge = c => !!c.sk.Charge;
const S_SETUP = { kind: "setup", title: "Setup", short: "Setup" };
const S_DONE = { kind: "done", title: "Done", short: "Done" };
/* Characters whose cost-return ability makes them good Break targets (BREAK_RETURN, two wordings in the card list). */
const S_BREAKRET = { kind: "textchars", id: "breakret", title: "Break-cost return characters", short: "Break return", min: 4, limit: 8,
  test: c => c.br,
  help: "Optional: characters with “▼ このキャラクターをブレイクする場合、≪そのブレイクカードのコスト≫はオーナーの手札に戻る。” — when you break them, the Break card's cost goes back to your hand. Every icon and faction is listed: your main icon and sub icon first, then the rest by faction (main factor first). Add 4–8 cards, or skip this step." };
const CHAR_STEPS = [
  { kind: "chars", title: "Draw +X characters · main factor", short: "Draw · main", skill: "Draw", test: hasDraw, faction: "main", limit: 4,
    help: "Add 4 Draw +X characters. Set the copies for each card (0–4); ×4 adds a full set." },
  { kind: "chars", title: "Draw +X characters · sub factor", short: "Draw · sub", skill: "Draw", test: hasDraw, faction: "sub", limit: 4,
    help: "Add 4 Draw +X characters from your sub factor. Set the copies for each card (0–4)." },
  S_BREAKRET,
  { kind: "chars", title: "Charge +X characters · main factor", short: "Charge · main", skill: "Charge", test: hasCharge, faction: "main", limit: 12,
    help: "Add 12 Charge +X characters. Cards are grouped by icon: main + sub icon, main icon only, sub icon only." },
  { kind: "chars", title: "Charge +X characters · sub factor", short: "Charge · sub", skill: "Charge", test: hasCharge, faction: "sub", limit: 10,
    help: "Optional: add up to 10 Charge +X characters from your sub factor. Set the copies for each card (0–4)." },
];
const breakStep = (skill, test) => ({ kind: "break", id: "break" + skill, skill, test, title: `Break cards · ${skill}`, short: `Break · ${skill}`,
  help: `Break cards with ${skill} from your main factor. A Break card needs a character sharing a class icon, so cards with your main icon are listed first, then your sub icon. Recommended: at least 3 cards. Order: Factor 1 Cost 0 → Factor 1 Cost 1 → Factor 2 Cost 2.` });
const searchStep = (type, short, factions, help) => ({ kind: "search", id: type, type, title: `${type} cards`, short, factions, help });
const TEMPLATES = [
  { id: "full", name: "Template #1 Full Deck", tag: "#1",
    blurb: "Builds a whole deck: 28–32 non-character cards (Main Break cards, Charge Breaks, Draw Breaks, Permanent, Fast, Project), then the characters. Icons and factions are recommended from your Main Break cards.",
    steps: [
      { kind: "search", id: "mainbreak", type: "Break", title: "Main Break cards", short: "Main Break", factions: "all",
        help: "Search for the Break cards your deck is built around. Their class icons and factions are recommended in the next step." },
      S_SETUP,
      breakStep("Charge", hasCharge), breakStep("Draw", hasDraw),
      searchStep("Permanent", "Permanent", "mainsub", "Search Permanent cards. Your main factor is listed first, then your sub factor; rarest cards first."),
      searchStep("Fast", "Fast", "mainsub", "Search Fast cards. Your main factor is listed first, then your sub factor; rarest cards first."),
      searchStep("Project", "Project", "mainsub", "Search Project cards. Your main factor is listed first, then your sub factor; rarest cards first."),
      ...CHAR_STEPS, S_DONE] },
  { id: "char1", name: "Template #2 Characters Only", tag: "#2",
    blurb: "Builds the 30-character core around your class icons: Draw +X characters first, then Charge +X characters, from a main factor and a sub factor.",
    steps: [S_SETUP, ...CHAR_STEPS, S_DONE] },
];
const curT = () => TEMPLATES.find(t => t.id === tpl.id);
const curStep = () => curT().steps[tpl.step];

/* ---------- recommendations (from the Break cards in the deck) ---------- */
function recommendations() {
  const icons = {}, facs = {}, seen = new Set();
  for (const e of deck.cols.Break) {
    const c = card(e.k);
    if (seen.has(c.jp)) continue;
    seen.add(c.jp);
    c.cls.forEach(t => (icons[t] = (icons[t] || 0) + 1));
    if (c.f) facs[c.f] = (facs[c.f] || 0) + 1;
  }
  return { icons, facs, n: seen.size };
}
const recTag = n => `<span class="tpl-rec" title="Recommended: on ${n} of your Break cards">★${n > 1 ? n : ""}</span>`;

/** Main icon section, then sub icon section (None: main only; Any: then other icons). */
function iconGroups() {
  const m = tpl.icon, s2 = tpl.icon2;
  const main = { title: `Main icon · ${classLabel(m)}`, icons: [m], test: c => c.cls.includes(m) };
  if (s2 === NONE) return [main];
  if (s2 === ANY) return [main, { title: "Other icons", icons: [], test: c => !c.cls.includes(m) }];
  return [main, { title: `Sub icon · ${classLabel(s2)}`, icons: [s2], test: c => c.cls.includes(s2) }];
}
/** Icon groups for a character step. Draw: main icon → sub icon. Charge: main+sub → main → sub. */
function stepGroups(step) {
  const m = tpl.icon, s2 = tpl.icon2;
  if (step.skill === "Draw" || s2 === NONE || s2 === ANY) return iconGroups();
  return [
    { title: `${classLabel(m)} + ${classLabel(s2)}`, icons: [m, s2], test: c => c.cls.includes(m) && c.cls.includes(s2) },
    { title: `${classLabel(m)} only`, icons: [m], test: c => c.cls.includes(m) && !c.cls.includes(s2) },
    { title: `${classLabel(s2)} only`, icons: [s2], test: c => c.cls.includes(s2) && !c.cls.includes(m) },
  ];
}

/** Every printing that matches gets its own tile (Pack, Revise#220 — reprints used to collapse into one tile per name).
    printings: how many printings of that name match. */
function collapse(cards, groupOf) {
  const out = [], per = new Map();
  for (const c of cards) {
    const g = groupOf ? groupOf(c) : 0;
    if (g < 0) continue;
    out.push({ c, g });
    per.set(c.jp, (per.get(c.jp) || 0) + 1);
  }
  for (const x of out) x.printings = per.get(x.c.jp);
  return out;
}
/** Copies of this printing in the deck. */
const keyCount = k => { const f = entryOf(k); return f ? f.e.n : 0; };

/** Charge steps, inside each icon group: Charge 2+ → Charge 1 with "1：cost returns to hand" → Charge 1 with Shield → with Bind → with Synchro → other Charge 1. */
function chargeTier(c) {
  if ((numOf(c.sk.Charge) || 0) >= 2) return 0;
  if (c.effects.some(e => e.cost === "1" && e.steps && e.steps.some(st => st.type === "cost-to-hand"))) return 1;
  if (hasSkill(c, "Shield")) return 2;
  if (hasSkill(c, "Bind")) return 3;
  if (hasSkill(c, "Synchro")) return 4;
  return 5;
}
/** Character step: grouped by icon, best skill value first in each group (Charge: the order above). */
function stepCandidates(step) {
  const inFaction = step.faction === "main" ? (c => c.f === tpl.main) : subFaction;
  const groups = stepGroups(step), tier = step.skill === "Charge" ? chargeTier : () => 0;
  return collapse(CARDS.filter(c => c.t === "Character" && inFaction(c) && step.test(c)), c => groups.findIndex(G => G.test(c)))
    .sort((a, b) => a.g - b.g || tier(a.c) - tier(b.c) || sortKey(b.c.sk[step.skill])[1] - sortKey(a.c.sk[step.skill])[1] || sortKey(a.c.st.se)[1] - sortKey(b.c.st.se)[1] || a.c.i - b.c.i);
}

/** Break · Charge/Draw: priority F1 C0 → F1 C1 → F2 C2 → others, then the higher skill value. */
const breakPriority = c => (c.st.fa === "1" && c.st.co === "0" ? 0 : c.st.fa === "1" && c.st.co === "1" ? 1 : c.st.fa === "2" && c.st.co === "2" ? 2 : 3);
function breakCandidates(step) {
  const groups = iconGroups();
  const pool = CARDS.filter(c => c.t === "Break" && c.f === tpl.main && step.test(c));   // main factor only
  return collapse(pool, c => groups.findIndex(G => G.test(c))).sort((a, b) => a.g - b.g ||
    breakPriority(a.c) - breakPriority(b.c) || sortKey(b.c.sk[step.skill])[1] - sortKey(a.c.sk[step.skill])[1] || a.c.i - b.c.i);
}

/** Search steps: card type + search text + faction chips, rarest first. */
function searchFactions(step) {
  if (!tpl.sf[step.id]) tpl.sf[step.id] = step.factions === "mainsub" ? (realSub() ? [tpl.main, tpl.sub] : tpl.sub === ANY ? FACTS.slice() : [tpl.main]) : [];
  return tpl.sf[step.id];
}
/** Faction sections of a main/sub-factor search step: main factor, then sub factor (or the other factions). */
const factionGroups = () => [{ title: "Main factor", fac: tpl.main, test: c => c.f === tpl.main },
  realSub() ? { title: "Sub factor", fac: tpl.sub, test: c => c.f === tpl.sub } : { title: "Sub factor · other factions", test: c => c.f && c.f !== tpl.main }];
function searchCandidates(step) {
  const terms = (tpl.q[step.id] || "").trim().split(/\s+/).map(norm).filter(Boolean);
  const groups = step.factions === "mainsub" ? factionGroups() : null, fs = groups ? [] : searchFactions(step);
  return collapse(CARDS.filter(c => c.t === step.type && (!fs.length || fs.includes(c.f)) && terms.every(t => c.hay.includes(t))),
    groups ? c => groups.findIndex(G => G.test(c)) : null)
    .sort((a, b) => a.g - b.g || rarityRank(b.c.rarity) - rarityRank(a.c.rarity) || a.c.i - b.c.i);
}

/** Break-cost return characters: your main icon, then your sub icon, then the rest by faction
    (main factor, sub factor, the others). Icon sections only show when they have cards. */
function textGroups() {
  const icons = [{ title: `Main icon · ${classLabel(tpl.icon)}`, icons: [tpl.icon], test: c => c.cls.includes(tpl.icon), icon: true }]
    .concat(realIcon2() ? [{ title: `Sub icon · ${classLabel(tpl.icon2)}`, icons: [tpl.icon2], test: c => c.cls.includes(tpl.icon2), icon: true }] : []);
  const order = [tpl.main].concat(realSub() ? [tpl.sub] : [], FACTS.filter(f => f !== tpl.main && f !== tpl.sub));
  return icons.concat(order.map(f => ({ title: f === tpl.main ? "Main factor" : f === tpl.sub ? "Sub factor" : "", fac: f, test: c => c.f === f })));
}
function textCandidates(step) {
  const groups = textGroups();
  return collapse(CARDS.filter(step.test), c => groups.findIndex(G => G.test(c))).sort((a, b) => a.g - b.g || a.c.i - b.c.i);
}
/** The card list of any pick step (used for its card target). */
const stepList = step => (step.kind === "chars" ? stepCandidates(step) : step.kind === "break" ? breakCandidates(step)
  : step.kind === "textchars" ? textCandidates(step) : step.kind === "search" ? searchCandidates(step) : []);

/** Cards already in the deck when this page (step) was opened go to the top of their list; cards picked on this page stay
    where they are (Pack, Revise#123). Otherwise the order is kept. */
const pinnedNow = () => {
  if (!tpl.pin || tpl.pin.step !== tpl.step || tpl.pin.id !== tpl.id) tpl.pin = { step: tpl.step, id: tpl.id, names: new Set(CARDS.filter(c => nameCount(c.jp) > 0).map(c => c.jp)) };
  return tpl.pin.names;
};
const pickedFirst = items => { const pin = pinnedNow(); return items.slice().sort((a, b) => pin.has(b.c.jp) - pin.has(a.c.jp)); };
/** Copies in the deck of the cards listed in a step. */
const stepCopies = list => list.reduce((n, { c }) => n + keyCount(c.k), 0);

/* ---------- rendering ---------- */
function openTemplates() {
  openModal("Templates", `<p class="note">A template guides you step by step through building a deck.</p>
    <label class="tpl-check tpl-fresh"><input type="checkbox" id="tplFresh"${deckTotal() ? "" : " checked"}> Start from an empty deck${deckTotal() ? ` <span class="note">(clears the current ${deckTotal()} cards)</span>` : ""}</label>
    <div class="tpl-list">${TEMPLATES.map(t => `<button type="button" class="tpl-pick" data-tpl="${t.id}"><b>${esc(t.name)}</b><span>${esc(t.blurb)}</span></button>`).join("")}</div>
    <h3 class="tpl-h">Basic decks</h3><p class="note">Ready-made 60-card decks. Choose one, then the deck slot to put it in.</p>
    <div class="tpl-list">${basicDecks().map((b, i) => `<button type="button" class="tpl-pick" data-basic="${i}"><b>Basic Deck #${i + 1} · ${esc(b.deck.name)}</b><span>${esc(basicBlurb(b.deck))}</span></button>`).join("")}</div>`, true);
}

/* ---------- Basic decks (Pack, 2026-11-05): src/data/basic_decks.txt, put into a deck slot the player chooses ---------- */
let BASIC = null;
const basicDecks = () => BASIC || (BASIC = (typeof BASIC_DECKS_TXT === "string" ? BASIC_DECKS_TXT : "").split(DECK_SEP).filter(b => b.trim()).map(b => parseDeck(b)).filter(r => r.total));
const basicBlurb = d => `${slotTotal(d)} cards: ` + CATS.map(C => [C, d.cols[C.id].reduce((n, e) => n + e.n, 0)]).filter(([, n]) => n).map(([C, n]) => `${n} ${C.id}`).join(" · ");
const slotDeck = i => (i === deckSlot ? deck : deckSlots[i]);
function chooseBasicSlot(bi) {
  const b = basicDecks()[bi];
  openModal(`Basic Deck #${bi + 1} · ${b.deck.name}`, `<p class="note">Which deck slot should this deck go into?</p>
    <div class="tpl-list">${Array.from({ length: DECK_SLOTS }, (_, i) => { const d = slotDeck(i), n = slotTotal(d);
      return (i % SLOT_PAGE ? "" : `<h4 class="tpl-page">Page ${pageOf(i) + 1}</h4>`) + `<button type="button" class="tpl-pick" data-bslot="${i}" data-basic-of="${bi}"><b>Slot ${i + 1}</b><span>${n ? `${esc(d.name)} · ${n} cards — will be replaced` : "Empty"}</span></button>`; }).join("")}</div>`, true);
}
function confirmBasicSlot(bi, i) {
  const d = slotDeck(i), n = slotTotal(d);
  if (!n) { putBasic(bi, i); return; }
  openModal("Replace this deck?", `<p class="tpl-warn">⚠ Slot ${i + 1} already holds “${esc(d.name)}” (${n} cards). It will be replaced by Basic Deck #${bi + 1} · ${esc(basicDecks()[bi].deck.name)}.</p>
    <div class="actions"><button type="button" class="btn" data-bcancel="1">Cancel</button><button type="button" class="btn primary" data-bok="${i}" data-basic-of="${bi}">OK, replace</button></div>`);
}
function putBasic(bi, i) {
  const src = basicDecks()[bi].deck, d = JSON.parse(JSON.stringify(src));
  d.name = `Basic Deck #${bi + 1} · ${src.name}`;
  saveSlots();
  deckSlots[i] = d;
  if (i === deckSlot) deck = d;
  closeAll();
  switchSlot(i);
  toast(`Basic Deck #${bi + 1} → slot ${i + 1}`);
}

function startTemplate(id) {
  if ($("tplFresh") && $("tplFresh").checked) { deck = emptyDeck(); deckChanged(); }
  tpl = { id, step: 0, icon: "", icon2: "", main: "", sub: "", open: "icon", q: {}, sf: {}, more: {}, closed: {} };
  if (id === "full") deck.name = "Template #2 · Full Deck";
  deckChanged();
  renderTemplate();
}

function meterHTML() {
  const step = curStep(), chars = deckCharacters(), non = deckNonCharacters();
  const bar = (label, n, target, txt, ok) => `<div class="tpl-meter${ok ? " ok" : ""}"><span>${label} <b>${n}</b> ${txt}</span><i style="--p:${Math.min(100, (n / target) * 100)}%"></i><span>Deck ${deckTotal()} / ${LIMITS.deck}</span></div>`;
  const nonBar = bar("Non-characters", non, NONCHAR.max, `/ ${NONCHAR.min}–${NONCHAR.max}`, non >= NONCHAR.min && non <= NONCHAR.max);
  const charBar = bar("Characters", chars, CHARACTER_TARGET, `/ ${CHARACTER_TARGET}`, chars >= CHARACTER_TARGET);
  if (tpl.id !== "full") return charBar;
  return step.kind === "chars" || step.kind === "textchars" ? charBar : step.kind === "done" ? nonBar + charBar : nonBar;
}

function renderTemplate() {
  const T = curT(), step = curStep();
  $("m-title").innerHTML = `<small>${esc(T.name)}</small>${esc(step.title)}`;
  // the card counts stay pinned under the dialog title while the card lists scroll
  const list = ["chars", "break", "textchars", "search"].includes(step.kind) ? stepList(step) : null;
  const here = list ? (step.kind === "search" ? deck.cols[step.type].reduce((n, e) => n + e.n, 0) : stepCopies(list)) : 0;
  const stepCount = list ? `<span class="tpl-here${step.limit && here >= step.limit ? " full" : ""}">This step <b>${here}</b>${step.limit ? ` / ${step.min ? step.min + "–" : ""}${step.limit}` : ""} cards</span>` : "";
  const head = `<ol class="tpl-steps">${T.steps.map((s, i) => `<li class="${i === tpl.step ? "now" : i < tpl.step ? "done" : ""}">${esc(s.short)}</li>`).join("")}</ol>` +
    `<div class="tpl-sticky">${meterHTML()}${stepCount}</div>`;
  const body = step.kind === "setup" ? setupHTML() : step.kind === "chars" ? pickHTML(step) : step.kind === "textchars" ? textHTML(step) : step.kind === "break" ? breakHTML(step)
    : step.kind === "search" ? searchHTML(step) : doneHTML();
  const canNext = step.kind !== "setup" || (tpl.icon && tpl.icon2 && tpl.main && tpl.sub && tpl.main !== tpl.sub);
  const last = tpl.step === T.steps.length - 1;
  const nav = `<div class="tpl-nav">
      ${tpl.step > 0 ? `<button type="button" class="btn" data-tnav="back">Back</button>` : ""}
      ${!last ? `<button type="button" class="btn primary" data-tnav="next"${canNext ? "" : " disabled"}>Next</button>`
        : `<button type="button" class="btn primary" data-tnav="finish">Finish</button>`}
    </div>`;
  $("mbody").innerHTML = head + body + nav;
  const mh = document.querySelector("#modal .mhead");
  if (mh) $("modal").style.setProperty("--mhh", mh.offsetHeight + "px");
}

/* ---------- setup ---------- */
/** A field button that opens its picker grid below the row. */
function fieldHTML(key, title, face, disabled) {
  return `<div class="tpl-fld"><span class="tpl-lbl">${title}</span>
    <button type="button" class="tpl-ibtn${tpl.open === key ? " open" : ""}${face.tint ? " tinted" : ""}" data-topen="${key}"${face.tint ? ` style="--fbg:${face.tint}"` : ""}${disabled ? " disabled" : ""} aria-expanded="${tpl.open === key}">${face.html}<span class="caret">▾</span></button></div>`;
}
const symbol = ch => `<span class="tpl-anyico">${ch}</span>`;
function iconFace(key) {
  const v = tpl[key];
  if (!v) return { html: `<span class="tpl-ph">${key === "icon" ? "Choose a class icon" : tpl.icon ? "Choose a sub icon" : "Pick main icon first"}</span>` };
  if (v === ANY) return { html: `${symbol("∗")}<span>Any icon</span>` };
  if (v === NONE) return { html: `${symbol("–")}<span>None</span>` };
  return { html: `${classIconHTML(v)}<span>${esc(classLabel(v))}</span>` };
}
function factorFace(key) {
  const v = tpl[key];
  if (!v) return { html: `<span class="tpl-ph">${key === "main" ? "Choose a faction" : tpl.main ? "Choose a faction" : "Pick main factor first"}</span>` };
  if (v === ANY) return { html: `${symbol("∗")}<span>${tpl.main ? `Any (not ${esc(tpl.main)})` : "Any"}</span>` };
  return { html: `${factionIconHTML(v, 28)}<span>${esc(v)}</span>`, tint: FACTION_META[v] && FACTION_META[v].bg };
}

const optBtn = (key, v, inner, n, style) => `<button type="button" class="tpl-iopt${tpl[key] === v ? " on" : ""}" data-tval="${key}" data-v="${esc(v)}"${style ? ` style="${style}"` : ""}>${inner}<span class="kn">${n == null ? "" : n.toLocaleString()}</span></button>`;

/** Icon grid: Recommended icons (from your Break cards) first, then every other icon.
    Sub icon: None / Any, then icons found together with the main icon. */
function iconGridHTML(key) {
  const counts = {}, rec = recommendations().icons;
  for (const c of CARDS) {
    if (c.t !== "Character") continue;
    if (key === "icon") c.cls.forEach(t => (counts[t] = (counts[t] || 0) + 1));
    else if (c.cls.includes(tpl.icon)) c.cls.forEach(t => { if (t !== tpl.icon) counts[t] = (counts[t] || 0) + 1; });
  }
  const opt = t => optBtn(key, t, `${classIconHTML(t)}<span>${esc(CLASS_EN[t.replace("♂", "")])}</span>${rec[t] ? recTag(rec[t]) : ""}`, counts[t]);
  let h = "";
  if (key === "icon2") {
    const mainN = CARDS.filter(c => c.t === "Character" && c.cls.includes(tpl.icon)).length;
    h += `<p class="note tpl-gnote">Characters with ${classIconHTML(tpl.icon)} <b>${esc(classLabel(tpl.icon))}</b> that also carry… (Draw steps always use the main icon only)</p>` +
      optBtn(key, NONE, `${symbol("–")}<span>None <small>· main icon only</small></span>`, mainN) +
      optBtn(key, ANY, `${symbol("∗")}<span>Any <small>· main icon, then other icons</small></span>`, null);
  }
  const recList = CLASS_LIST.filter(t => rec[t] && counts[t] && t !== tpl.icon).sort((a, b) => rec[b] - rec[a]);
  if (recList.length) h += `<h4 class="kgroup tpl-recg">★ Recommended · from your Break cards in the deck</h4>` + recList.map(opt).join("");
  h += CLASS_GROUPS.map(([g, title]) => {
    const items = CLASS_LIST.filter(t => classGroup(t) === g && counts[t] && !recList.includes(t));
    return items.length ? `<h4 class="kgroup">${title}</h4>` + items.map(opt).join("") : "";
  }).join("");
  return `<div class="tpl-igrid kgrid">${h}</div>`;
}

/** Factor grid: Recommended factions (from your Break cards) first; counts = characters with the main icon. */
function factorGridHTML(key) {
  const byF = {}, rec = recommendations().facs;
  CARDS.forEach(c => { if (c.t === "Character" && (!tpl.icon || c.cls.includes(tpl.icon))) byF[c.f] = (byF[c.f] || 0) + 1; });
  const opt = f => optBtn(key, f, `${factionIconHTML(f, 28)}<span class="fname">${esc(f)}</span>${rec[f] ? recTag(rec[f]) : ""}`, byF[f] || 0, `--fbg:${FACTION_META[f] ? FACTION_META[f].bg : "transparent"}`);
  const list = FACTS.filter(f => key === "main" || f !== tpl.main);
  const recList = list.filter(f => rec[f]).sort((a, b) => rec[b] - rec[a]), rest = list.filter(f => !rec[f]);
  let h = "";
  if (key === "sub") h += optBtn(key, ANY, `${symbol("∗")}<span class="fname">Any (not ${esc(tpl.main)})</span>`,
    FACTS.filter(f => f !== tpl.main).reduce((a, f) => a + (byF[f] || 0), 0));
  if (recList.length) h += `<h4 class="kgroup tpl-recg">★ Recommended · from your Break cards in the deck</h4>` + recList.map(opt).join("") + (rest.length ? `<h4 class="kgroup">Other factions</h4>` : "");
  h += rest.map(opt).join("");
  return `<div class="tpl-igrid tpl-fgrid">${tpl.icon ? `<p class="note tpl-gnote">Numbers: characters with ${classIconHTML(tpl.icon)} <b>${esc(classLabel(tpl.icon))}</b> in each faction.</p>` : ""}${h}</div>`;
}

/** Default choices when the Setup step first opens (Pack, 2026-11-07): main icon / main factor = the first most common one
    among your Main Break cards (ties: the one met first), sub icon = None, sub factor = Any (not the main factor). */
function setupDefaults() {
  if (tpl.defaulted) return;
  tpl.defaulted = true;
  const rec = recommendations(), first = obj => Object.keys(obj).reduce((best, k) => (best == null || obj[k] > obj[best] ? k : best), null);
  const charIcon = t => CARDS.some(c => c.t === "Character" && c.cls.includes(t));
  if (!tpl.icon) { const ic = {}; for (const [k, n] of Object.entries(rec.icons)) if (charIcon(k)) ic[k] = n; tpl.icon = first(ic) || ""; }
  if (!tpl.icon2) tpl.icon2 = NONE;
  if (!tpl.main) tpl.main = first(rec.facs) || "";
  if (!tpl.sub) tpl.sub = ANY;
  tpl.open = ["icon", "icon2", "main", "sub"].find(k => !tpl[k]) || null;
}
function setupHTML() {
  setupDefaults();
  const o = tpl.open, rec = recommendations();
  const iconPanel = (o === "icon" || (o === "icon2" && tpl.icon)) ? iconGridHTML(o) : "";
  const facPanel = (o === "main" || (o === "sub" && tpl.main)) ? factorGridHTML(o) : "";
  return `${rec.n ? `<p class="note tpl-recnote">★ Recommended icons and factions come from the ${rec.n} Break card${rec.n > 1 ? "s" : ""} in your deck.</p>` : ""}
    <div class="tpl-setup">
      <div class="tpl-row">${fieldHTML("icon", "Main icon", iconFace("icon"))}${fieldHTML("icon2", "Sub icon", iconFace("icon2"), !tpl.icon)}</div>
      ${iconPanel}
      <div class="tpl-row">${fieldHTML("main", "Main factor", factorFace("main"))}${fieldHTML("sub", "Sub factor", factorFace("sub"), !tpl.main)}</div>
      ${facPanel}
    </div>
    <p class="note">Characters: 4 Draw +X cards from the main factor → 4 Draw +X cards from the sub factor → optional 4–8 Break-cost return characters → 12 Charge +X cards from the main factor → up to 10 Charge +X cards from the sub factor (optional).
    Draw steps list the main icon first, then the sub icon. Charge steps list characters with main + sub icon first, then main icon only, then sub icon only.</p>`;
}

/* ---------- pick steps ---------- */
function tileHTML({ c, printings }, line) {
  const have = keyCount(c.k), k = esc(c.k);
  return `<div class="tpl-card${have ? " on" : ""}">
      <button type="button" class="tpl-dbtn" data-i="${c.i}" title="Card details" aria-label="Details for ${esc(c.jp)}"><img loading="lazy" alt="" src="${IMG.thumb(c.fid, 240)}" data-fid="${c.fid}"><span class="tpl-dic" aria-hidden="true">ⓘ</span></button>
      <div class="tpl-meta"><span class="no">${esc(c.s.code)} · ${esc(c.id)}${printings > 1 ? ` · 1 of ${printings} printings` : ""}</span>
        <span class="jp">${esc(c.jp)}</span><span class="en">${esc(c.en)}</span>
        ${line}${statLine(c)}</div>
      <div class="tpl-stepper"><button type="button" class="step" data-tcount="-1" data-k="${k}" aria-label="One fewer"${have ? "" : " disabled"}>−</button><b>${have}</b><button type="button" class="step" data-tcount="1" data-k="${k}" aria-label="One more">+</button>
        <button type="button" class="mini tpl-four" data-tfour="${k}"${have === LIMITS.copies ? " disabled" : ""}>×4</button></div></div>`;
}
const skillLine = (c, skill) => `<span class="tpl-sk">${esc(skill)} ${esc(c.sk[skill])}</span>`;
/** Foldable sections (<details>), with jump links when there are several. Fold state survives re-renders. */
function sectionsHTML(key, secs, emptyText) {
  const jump = secs.length > 1 ? `<nav class="tpl-jump">${secs.map((S, i) => `<a href="#" data-tjump="${i}">${(S.icons || []).map(t => classIconHTML(t)).join("")}${S.fac ? factionIconHTML(S.fac, 18) : ""}<span>${esc(S.title || S.fac)}</span><b>${S.n}</b></a>`).join("")}</nav>` : "";
  return jump + secs.map((S, i) => {
    const id = `${key}:${i}`;
    return `<details class="tpl-sec" data-sec="${esc(id)}"${tpl.closed[id] ? "" : " open"}>
      <summary class="tpl-ghead" id="tpl-g${i}">${(S.icons || []).map(t => classIconHTML(t)).join("")}${S.fac ? factionBadge(S.fac) : ""}<span>${esc(S.title)}</span><span class="kn">${S.n}</span><span class="tpl-fold" aria-hidden="true">▾</span></summary>
      ${S.body || `<p class="note tpl-none">${esc(emptyText)}</p>`}</details>`;
  }).join("");
}
const gridHTML = (items, line) => (items.length ? `<div class="tpl-grid">${items.map(x => tileHTML(x, line(x))).join("")}</div>` : "");

function pickHTML(step) {
  const list = stepCandidates(step), copies = stepCopies(list), groups = stepGroups(step);
  const faction = step.faction === "main" ? tpl.main : tpl.sub === ANY ? `Any (not ${tpl.main})` : tpl.sub;
  const full = step.limit && copies >= step.limit;
  const info = `<div class="tpl-info">${classIconHTML(tpl.icon)}${realIcon2() ? classIconHTML(tpl.icon2) : ""}<span>${esc(iconsLabel())}</span>${step.faction === "sub" && tpl.sub === ANY ? `<span>${esc(faction)}</span>` : factionBadge(faction)}<span>${esc(step.skill)} +X</span>
      <span class="tpl-count${full ? " full" : ""}">${step.limit ? `${copies} / ${step.limit} cards` : `${copies} cards`}</span></div>
    <p class="note">${esc(step.help)}</p>`;
  return info + sectionsHTML(step.short, groups.map((G, i) => {
    const items = pickedFirst(list.filter(x => x.g === i));
    return { title: G.title, icons: G.icons, n: items.length, body: gridHTML(items, x => skillLine(x.c, step.skill)) };
  }), `No ${step.skill} +X characters in this group.`);
}

function textHTML(step) {
  const list = textCandidates(step), n = stepCopies(list), groups = textGroups();
  const ok = n >= step.min && n <= step.limit;
  const info = `<div class="tpl-info"><span>Characters · every icon and faction</span>
      <span class="tpl-goals"><span class="tpl-goal${ok ? " ok" : ""}"><b>${n}</b> / ${step.min}–${step.limit} cards ${ok ? "✓" : ""}</span></span></div>
    <p class="note">${esc(step.help)}</p>`;
  const secs = groups.map((G, i) => {
    const items = pickedFirst(list.filter(x => x.g === i));
    return { title: G.title, icons: G.icons, fac: G.fac, n: items.length, keep: !G.icon && (G.fac === tpl.main || G.fac === tpl.sub),
      body: gridHTML(items, x => `<span class="tpl-tags">${G.icon ? factionBadge(x.c.f) : ""}${x.c.cls.map(t => classIconHTML(t)).join("")}</span>`) };
  }).filter(S => S.n || S.keep);   // hide empty sections (main/sub factor always shown)
  return info + sectionsHTML(step.id, secs, "No cards in this faction.");
}

function breakHTML(step) {
  const list = breakCandidates(step), n = stepCopies(list), groups = iconGroups();
  const info = `<div class="tpl-info">${factionBadge(tpl.main)}<span>${esc(step.skill)} +X</span>
      <span class="tpl-goals"><span class="tpl-goal${n >= 3 ? " ok" : ""}">${esc(step.skill)} <b>${n}</b> / 3+ ${n >= 3 ? "✓" : ""}</span></span></div>
    <p class="note">${esc(step.help)}</p>`;
  const tier = c => ["F1 · C0", "F1 · C1", "F2 · C2", ""][breakPriority(c)];
  return info + sectionsHTML(step.id, groups.map((G, i) => {
    const items = pickedFirst(list.filter(x => x.g === i));
    return { title: G.title, icons: G.icons, n: items.length, body: gridHTML(items, x =>
      `${skillLine(x.c, step.skill)}${tier(x.c) ? `<span class="tpl-tier">${tier(x.c)}</span>` : ""}<span class="tpl-tags">${factionBadge(x.c.f)}${x.c.cls.map(t => classIconHTML(t)).join("")}</span>`) };
  }), `No ${step.skill} Break cards in this group.`);
}

const SEARCH_PAGE = 48;
const searchLine = x => `<span class="tpl-tags">${factionBadge(x.c.f)}${x.c.rarity ? `<span class="tpl-rar">${esc(x.c.rarity)}</span>` : ""}${x.c.cls.map(t => classIconHTML(t)).join("")}</span>`;
function pagedGrid(items, moreKey) {
  const shown = tpl.more[moreKey] || SEARCH_PAGE;
  return gridHTML(items.slice(0, shown), searchLine) +
    (items.length > shown ? `<button type="button" class="btn tpl-more" data-tmore="${esc(moreKey)}">Show more (${(items.length - shown).toLocaleString()} left)</button>` : "");
}
function searchResultsHTML(step) {
  const list = searchCandidates(step);
  if (step.factions === "mainsub") return sectionsHTML(step.id, factionGroups().map((G, i) => {
    const items = pickedFirst(list.filter(x => x.g === i));
    return { title: G.title, fac: G.fac, n: items.length, body: items.length ? pagedGrid(items, `${step.id}:${i}`) : "" };
  }), "No cards here. Try other words.");
  if (!list.length) return `<p class="empty"><b>No cards</b>Try other words or turn on more factions.</p>`;
  return `<p class="note">${list.length.toLocaleString()} card names · picked first, then rarest</p>` + pagedGrid(pickedFirst(list), step.id);
}
function searchHTML(step) {
  const copies = deck.cols[step.type].reduce((n, e) => n + e.n, 0);
  let chips = "";
  if (step.factions !== "mainsub") {
    const fs = searchFactions(step);
    chips = `<div class="tpl-fchips" role="group" aria-label="Factions">${FACTS.map(f => `<button type="button" class="tpl-fchip${fs.includes(f) ? " on" : ""}" data-tfac="${esc(f)}" style="--fbg:${FACTION_META[f].bg}" aria-pressed="${fs.includes(f)}">${factionIconHTML(f, 20)}<span>${esc(f)}</span></button>`).join("")}<span class="note">${fs.length ? "" : "All factions"}</span></div>`;
  }
  return `<div class="tpl-info"><span>${esc(step.type)} cards in the deck</span><span class="tpl-count">${copies} cards</span></div>
    <p class="note">${esc(step.help)}</p>
    <div class="tpl-search"><input type="search" data-tq="${step.id}" value="${esc(tpl.q[step.id] || "")}" placeholder="Search ${esc(step.type)} cards: name, number, reading…" aria-label="Search ${esc(step.type)} cards" autocomplete="off"></div>
    ${chips}<div id="tpl-res">${searchResultsHTML(step)}</div>`;
}

/** Pack (Revise#226): the default deck name — the name-level name (“…”) with the most copies in the deck; a tie goes to the first one in the deck. */
function defaultDeckName(d = deck) {
  const n = new Map();
  for (const C of CATS) for (const e of d.cols[C.id]) { const c = card(e.k), m = c && c.named && c.jp.match(/“([^”]+)”/); if (m) { const nm = m[1].trim(); n.set(nm, (n.get(nm) || 0) + e.n); } }
  let best = "", top = 0;
  for (const [nm, k] of n) if (k > top) { best = nm; top = k; }
  return best;
}
function doneHTML() {
  if (!tpl.nameTyped) tpl.name = defaultDeckName() || deck.name || "";   // follows the cards until the player types a name
  const n = deckCharacters(), non = deckNonCharacters(), t = deckTotal();
  const per = CATS.map(C => `<span class="cpill" style="--c:${C.color}"><i></i><span>${C.id}</span><b>${catTotal(C.id)}</b></span>`).join("");
  const nonLine = tpl.id === "full" ? `<p>Non-characters: <b>${non}</b> ${non >= NONCHAR.min && non <= NONCHAR.max ? "✓ within 28–32" : `(target ${NONCHAR.min}–${NONCHAR.max})`}</p>` : "";
  const nameBox = `<label class="tpl-name"><span>Deck name <em>(needed)</em></span><input type="text" id="tplName" maxlength="60" required value="${esc(tpl.name)}" placeholder="Name your deck" autocomplete="off"></label>
    <p class="note">Suggested: the name-level card with the most copies in the deck${defaultDeckName() ? ` (“${esc(defaultDeckName())}”)` : " — the deck has none, so the template name is used"}.</p>`;
  return `<div class="tpl-done">${nameBox}<b>${t} / ${LIMITS.deck} cards</b>
    <div class="catsum">${per}</div>
    ${nonLine}<p>Characters: <b>${n}</b> / ${CHARACTER_TARGET}${n >= CHARACTER_TARGET ? " ✓" : ""}</p>
    <p>${t > LIMITS.deck ? `${t - LIMITS.deck} over the official 60 — the Deck Builder doesn't limit cards.` : t >= LIMITS.min ? "The deck has a legal size (50–60)." : `${LIMITS.min - t} more cards to reach 50. You can go back, or add cards from Select cards.`}</p>
    <p class="note">${tpl.id === "full" ? "A deck holds at most 60 cards: with 32 non-characters there is room for 28 characters. " : "The rest of the deck (Break, Fast, Project and Permanent cards) is yours to build. "}The deck is saved as you go.</p></div>`;
}

/* ---------- events ---------- */
/** Change copies from the template; enforces the step's card target and Template #2's 32 non-characters. */
function tplSetCopies(k, want) {
  const step = curStep(), c = card(k), have = keyCount(c.k);
  if (want > have && step.limit) {
    const room = step.limit - stepCopies(stepList(step));
    if (room <= 0) { toast(`This step is full: ${step.limit} cards`); return; }
    if (want - have > room) { want = have + room; toast(`Added ${room} — this step takes ${step.limit} cards`); }
  }
  if (want > have && tpl.id === "full" && c.t !== "Character") {
    const room = NONCHAR.max - deckNonCharacters();
    if (room <= 0) { toast(`Non-character cards are full: ${NONCHAR.max}`); return; }
    if (want - have > room) { want = have + room; toast(`Added ${room} — up to ${NONCHAR.max} non-character cards`); }
  }
  setCopies(c.k, want);
  renderTemplate();
}

function bindTemplateEvents() {
  $("btnTemplate").addEventListener("click", openTemplates);
  $("mbody").addEventListener("input", e => { if (e.target.id === "tplName" && tpl) { tpl.name = e.target.value; tpl.nameTyped = true; e.target.classList.toggle("bad", !e.target.value.trim()); } });
  $("mbody").addEventListener("click", e => {
    const pick = e.target.closest("[data-tpl]");
    if (pick) { startTemplate(pick.dataset.tpl); return; }
    const bp = e.target.closest("[data-basic]");
    if (bp) { chooseBasicSlot(+bp.dataset.basic); return; }
    const bs = e.target.closest("[data-bslot]");
    if (bs) { confirmBasicSlot(+bs.dataset.basicOf, +bs.dataset.bslot); return; }
    const bo = e.target.closest("[data-bok]");
    if (bo) { putBasic(+bo.dataset.basicOf, +bo.dataset.bok); return; }
    if (e.target.closest("[data-bcancel]")) { closeAll(); toast("Cancelled — nothing changed"); return; }
    if (!tpl) return;
    const nav = e.target.closest("[data-tnav]");
    if (nav && !nav.disabled) {
      if (nav.dataset.tnav === "finish") {
        const nm = ($("tplName") ? $("tplName").value : tpl.name || "").trim().slice(0, 60);
        if (!nm) { const i = $("tplName"); if (i) { i.classList.add("bad"); i.focus(); } toast("Please put the deck's name"); return; }
        deck.name = nm; deckChanged(); tpl = null; closeAll(); toast(`Template finished · ${nm}`); return; }
      if (nav.dataset.tnav === "next" && curStep().kind === "setup") {
        deck.name = `Template ${curT().tag} · ${iconsLabel()} · ${tpl.main} / ${factorLabel(tpl.sub)}`;
        deckChanged();
      }
      tpl.step += nav.dataset.tnav === "back" ? -1 : 1;
      renderTemplate(); $("modal").scrollTop = 0;
      return;
    }
    const op = e.target.closest("[data-topen]");
    if (op && !op.disabled) { tpl.open = tpl.open === op.dataset.topen ? null : op.dataset.topen; renderTemplate(); return; }
    const iv = e.target.closest("[data-tval]");
    if (iv) {
      const key = iv.dataset.tval;
      tpl[key] = iv.dataset.v;
      if (key === "icon" && realIcon2() && (tpl.icon2 === tpl.icon || !CARDS.some(c => c.t === "Character" && c.cls.includes(tpl.icon) && c.cls.includes(tpl.icon2)))) tpl.icon2 = "";
      if (key === "main" && tpl.sub === tpl.main) tpl.sub = "";
      if (key === "main" || key === "sub") tpl.sf = {};   // search steps restart from the new factors
      tpl.open = ["icon", "icon2", "main", "sub"].find(k => !tpl[k]) || null;   // open the next empty field
      renderTemplate(); return;
    }
    const fac = e.target.closest("[data-tfac]");
    if (fac) {
      const fs = searchFactions(curStep()), f = fac.dataset.tfac, i = fs.indexOf(f);
      i >= 0 ? fs.splice(i, 1) : fs.push(f);
      tpl.more[curStep().id] = 0;
      renderTemplate(); return;
    }
    const more = e.target.closest("[data-tmore]");
    if (more) { const id = more.dataset.tmore; tpl.more[id] = (tpl.more[id] || SEARCH_PAGE) + SEARCH_PAGE; $("tpl-res").innerHTML = searchResultsHTML(curStep()); return; }
    const jump = e.target.closest("[data-tjump]");
    if (jump) { e.preventDefault(); const h = $("tpl-g" + jump.dataset.tjump); if (h) h.parentNode.open = true;
      if (h) h.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" }); return; }
    const four = e.target.closest("[data-tfour]");
    if (four && !four.disabled) { tplKeepScroll(() => tplSetCopies(four.dataset.tfour, LIMITS.copies)); return; }
    const cnt = e.target.closest("[data-tcount]");
    if (cnt && !cnt.disabled) { const c = card(cnt.dataset.k); tplKeepScroll(() => tplSetCopies(c.k, keyCount(c.k) + +cnt.dataset.tcount)); }
  });
  // remember folded sections (toggle doesn't bubble, so listen in the capture phase)
  $("mbody").addEventListener("toggle", e => {
    if (tpl && e.target.dataset && e.target.dataset.sec) tpl.closed[e.target.dataset.sec] = !e.target.open;
  }, true);
  let typing;
  $("mbody").addEventListener("input", e => {
    const id = tpl && e.target.dataset.tq;
    if (!id) return;
    tpl.q[id] = e.target.value;
    Object.keys(tpl.more).forEach(k => { if (k === id || k.startsWith(id + ":")) delete tpl.more[k]; });
    clearTimeout(typing);
    typing = setTimeout(() => ($("tpl-res").innerHTML = searchResultsHTML(curStep())), 150);
  });
}
/** Re-rendering the dialog must not jump the list back to the top. */
function tplKeepScroll(fn) { const m = $("modal"), y = m.scrollTop; fn(); m.scrollTop = y; }
