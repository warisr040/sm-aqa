/* ==========================================================================
   Search & filters (Card List and Deck Builder each keep their own set)

   Faceted filtering: every filter's option list and counts are recomputed
   from the cards that match all the OTHER active filters (plus the search
   text). Options with no matching cards are hidden, except the one that is
   currently selected. Example: Category = Character → Mental (精神力) only offers
   values that characters actually have.

   - buildFilterControls: static structure (once)
   - search: filter + facet counts + sort, then refresh controls and list
   ========================================================================== */

let classPanelOpen = false, skillPanelOpen = false, factionPanelOpen = false;

const optionHTML = (value, label, n, cur) =>
  `<option value="${esc(value)}"${value === cur ? " selected" : ""}>${esc(label)}${n != null ? ` (${n.toLocaleString()})` : ""}</option>`;

function buildFilterControls() {
  $("statrow").innerHTML = STATS.map(X => `<div class="stcell">
      <select id="st-${X.k}" data-st="${X.k}" aria-label="${X.label} filter"></select>
      <button type="button" class="sbtn" data-sort="${X.k}" aria-label="Sort by ${X.label}"></button>
    </div>`).join("") +
    `<p class="sorthint">⇅ = sort. 1st tap: Small → Large ↑ · 2nd tap: Large → Small ↓ · 3rd tap: off. You can sort by several stats; the small number is the priority (1 is applied first). Lists only show values found in the cards that match your other filters.</p>`;

  $("fpanel").innerHTML = `<div class="fgrid" id="fgrid"></div>`;

  $("kpanel").innerHTML = `<div class="khead">
      <div class="seg" role="group" aria-label="Class icon match mode">
        <button type="button" data-km="all" title="Characters that have every checked icon">Multi-icon in one character</button>
        <button type="button" data-km="any" title="Characters that have at least one checked icon">Any checked icon</button>
      </div>
      <button type="button" class="linkbtn" id="kclear">Clear icons</button>
      <button type="button" class="linkbtn" id="kdone" style="margin-left:auto">Done</button>
    </div>
    <div class="kgrid" id="kgrid"></div>`;

  $("skpanel").innerHTML = `<div class="khead">
      <div class="seg" role="group" aria-label="Skill match mode">
        <button type="button" data-skm="all" title="Cards that have every checked skill">Has all checked skills</button>
        <button type="button" data-skm="any" title="Cards that have at least one checked skill">Any checked skill</button>
      </div>
      <button type="button" class="linkbtn" id="skclear">Clear skills</button>
      <button type="button" class="linkbtn" id="skdone" style="margin-left:auto">Done</button>
    </div>
    <div class="kgrid skgrid" id="skgrid"></div>`;

  // sort by skill value: same ⇅ cycle as the stats, shares the same priority list
  $("sksorts").innerHTML = `<span class="rowlabel">Sort</span>` + VALUED_SKILLS.map(k =>
    `<button type="button" class="sbtn sklbl" data-sort="sk:${k}" data-label="${k}" aria-label="Sort by ${k} value"></button>`).join("");
}

/** Sort keys share one priority list: stat keys (fa, co …) and skill keys (sk:Charge …). */
const sortLabel = k => (k.startsWith("sk:") ? k.slice(3) : STATS.find(x => x.k === k).label);
const sortValue = (c, k) => (k.startsWith("sk:") ? c.sk[k.slice(3)] : k === "ra" ? (c.rarity ? String(rarityRank(c.rarity)) : "") : c.st[k]);

/* ---------- matching + facet counts ---------- */
const eqOrNone = (want, have) => !want || (want === "__none" ? !have : have === want);

/** Active filters as [dimension, test] pairs (search text is handled separately). */
function filterTests(F) {
  const T = [];
  if (F.s !== "") { const series = SERIES[+F.s]; T.push(["s", c => c.s === series]); }
  if (F.f) T.push(["f", c => eqOrNone(F.f, c.f)]);
  if (F.t) T.push(["t", c => eqOrNone(F.t, c.t)]);
  if (F.br) T.push(["br", c => c.br]);
  if (F.nm) T.push(["nm", c => c.named === (F.nm === "yes")]);   // Name: Yes / No
  if (F.ks.length) T.push(["k", F.km === "all" ? c => F.ks.every(t => c.cls.includes(t)) : c => F.ks.some(t => c.cls.includes(t))]);
  if (F.sks.length) T.push(["sk", F.skm === "all" ? c => F.sks.every(t => c.skills.includes(t)) : c => F.sks.some(t => c.skills.includes(t))]);
  for (const k of STAT_KEYS) if (F.st[k]) T.push([k, k === "ef" ? c => statVals(c, k).includes(F.st[k]) : c => eqOrNone(F.st[k], c.st[k])]);
  return T;
}

/** One pass over the cards: the result list, plus for each filter the counts of
    cards that pass every OTHER filter (a card failing exactly one filter still
    counts toward that filter's options). */
function filterAndCount(F) {
  const terms = F.q.trim().split(/\s+/).map(norm).filter(Boolean);
  const T = filterTests(F);
  const fc = { s: {}, f: {}, t: {}, nm: { yes: 0, no: 0 }, br: 0, k: {}, sk: {}, st: Object.fromEntries(STAT_KEYS.map(k => [k, {}])) };
  const add = (m, v) => (m[v] = (m[v] || 0) + 1);
  // "Multi-icon" mode: a checkbox count means "cards you'd get if you also tick this",
  // so the class test is NOT skipped for class counts. In "any" mode it is skipped.
  const classAll = F.km === "all" && F.ks.length > 0, skillAll = F.skm === "all" && F.sks.length > 0;
  const res = [];
  for (const c of CARDS) {
    if (terms.length && !terms.every(t => c.hay.includes(t))) continue;
    let fails = 0, failed = null;
    for (const [dim, test] of T) if (!test(c)) { failed = dim; if (++fails > 1) break; }
    if (fails > 1) continue;
    if (!fails) res.push(c);
    const counts = dim => !fails || failed === dim;
    if (counts("s")) add(fc.s, c.si);
    if (counts("f")) add(fc.f, c.f || "__none");
    if (counts("t")) add(fc.t, c.t || "__none");
    if (c.br && counts("br")) fc.br++;
    if (counts("nm")) fc.nm[c.named ? "yes" : "no"]++;
    if (classAll ? !fails : counts("k")) for (const t of new Set(c.cls)) add(fc.k, t);
    if (skillAll ? !fails : counts("sk")) for (const t of c.skills) add(fc.sk, t);
    for (const k of STAT_KEYS) if (counts(k)) for (const v of statVals(c, k)) add(fc.st[k], v);
  }
  return { res, fc };
}

/** Option list for one filter: values with matches, plus the selected one. */
const visible = (values, counts, cur) => values.filter(v => counts[v] || v === cur);

function renderFilterOptions(F, fc) {
  $("brN").textContent = fc.br.toLocaleString();
  const sel = (id, html) => { const el = $(id); if (el.innerHTML !== html) el.innerHTML = html; };

  sel("series", `<option value="">All series</option>` + SAGAS.map(g => {
    const opts = SERIES.map((s, i) => [String(i), s]).filter(([i, s]) => s.saga === g && (fc.s[i] || i === F.s))
      .map(([i, s]) => optionHTML(i, `${s.code} ${s.jp}`, fc.s[i] || 0, F.s)).join("");
    return opts ? `<optgroup label="${esc(g)}">${opts}</optgroup>` : "";
  }).join(""));

  // faction picker: chips with the rulebook mark on the faction's pastel colour
  const fchip = (v, inner, n, style) => `<button type="button" class="fchip${F.f === v ? " on" : ""}" data-f="${esc(v)}"${style ? ` style="${style}"` : ""}${n === 0 && F.f !== v ? " disabled" : ""}>${inner}<span class="kn">${n == null ? "" : n.toLocaleString()}</span></button>`;
  const total = Object.values(fc.f).reduce((a, b) => a + b, 0);
  sel("fgrid", fchip("", `<span class="fname">All factions</span>`, total) +
    FACTS.map(f => fchip(f, `${factionIconHTML(f, 30)}<span class="fname">${esc(f)}</span>`, fc.f[f] || 0, FACTION_META[f] ? `--fbg:${FACTION_META[f].bg}` : "")).join("") +
    (fc.f.__none || F.f === "__none" ? fchip("__none", `<span class="fname">No faction</span>`, fc.f.__none || 0) : ""));

  const typeOpts = list => visible(list, fc.t, F.t).map(t => optionHTML(t, t === "__none" ? "Unclassified" : t, fc.t[t] || 0, F.t)).join("");
  const playable = typeOpts(TYPES.filter(t => CAT[t])), other = typeOpts([...TYPES.filter(t => !CAT[t]), "__none"]);
  sel("ctype", `<option value="">All categories</option>` +
    (playable ? `<optgroup label="Deck categories">${playable}</optgroup>` : "") +
    (other ? `<optgroup label="Other">${other}</optgroup>` : ""));

  sel("cname", `<option value="">Name: Any</option>` + optionHTML("yes", "Name: Yes", fc.nm.yes, F.nm) + optionHTML("no", "Name: No", fc.nm.no, F.nm));

  for (const X of STATS) {
    const cur = F.st[X.k], counts = fc.st[X.k];
    sel("st-" + X.k, `<option value="">${X.label}: any</option>` +
      visible(STAT_VALUES[X.k], counts, cur).map(v => optionHTML(v, `${X.label} ${v}`, counts[v] || 0, cur)).join("") +
      (counts.__none || cur === "__none" ? optionHTML("__none", `${X.label}: none`, counts.__none || 0, cur) : ""));
  }

  const shown = CLASS_LIST.filter(t => fc.k[t] || F.ks.includes(t));
  sel("kgrid", CLASS_GROUPS.map(([g, title]) => {
    const items = shown.filter(t => classGroup(t) === g);
    return items.length ? `<h4 class="kgroup">${title}</h4>` + items.map(t =>
      `<label${F.ks.includes(t) ? ' class="on"' : ""}><input type="checkbox" value="${esc(t)}"${F.ks.includes(t) ? " checked" : ""}>${classIconHTML(t)}<span>${esc(CLASS_EN[t.replace("♂", "")])}</span><span class="kn">${(fc.k[t] || 0).toLocaleString()}</span></label>`
    ).join("") : "";
  }).join("") || `<p class="note">No class icons match the other filters.</p>`);

  const skillsShown = SKILL_LIST.filter(t => fc.sk[t] || F.sks.includes(t));
  const skillGroups = [...VALUED_SKILLS.map(k => [k, t => skillName(t) === k]), ["Other skills", t => !skillName(t)]];
  sel("skgrid", skillGroups.map(([title, inGroup]) => {
    const items = skillsShown.filter(inGroup);
    return items.length ? `<h4 class="kgroup">${esc(title)}</h4>` + items.map(t =>
      `<label${F.sks.includes(t) ? ' class="on"' : ""}><input type="checkbox" value="${esc(t)}"${F.sks.includes(t) ? " checked" : ""}><span>${esc(t)}</span><span class="kn">${(fc.sk[t] || 0).toLocaleString()}</span></label>`
    ).join("") : "";
  }).join("") || `<p class="note">No skills match the other filters.</p>`);
}

/** Number of active stat filters + sort keys (shown on the Stats / Sort button). */
/** Number of active filters + sorts (badge on the Filters button). */
const activeCount = F => (F.s ? 1 : 0) + (F.f ? 1 : 0) + (F.t ? 1 : 0) + (F.nm ? 1 : 0) + (F.br ? 1 : 0) + (F.ks.length ? 1 : 0) + (F.sks.length ? 1 : 0) +
  STAT_KEYS.filter(k => F.st[k]).length + F.sort.length;

/* ---------- filter layout: inline (foldable) or sidebar ---------- */
let sideOpen = false;
function applyFilterLayout() {
  const side = UI.fmode === "side", box = $("fbox");
  document.body.dataset.fmode = UI.fmode;
  // the header is a blurred sticky bar, which traps position:fixed children, so the sidebar lives in <body>
  if (side && box.parentNode !== document.body) document.body.appendChild(box);
  if (!side && box.parentNode !== $("fhome")) $("fhome").appendChild(box);
  const open = side ? sideOpen : UI.fOpen;
  box.hidden = !open;
  $("fscrim").hidden = !(side && sideOpen);
  document.body.classList.toggle("fside-open", side && sideOpen);
  $("fToggle").setAttribute("aria-expanded", open);
  document.querySelectorAll("[data-fmode]").forEach(b => b.setAttribute("aria-pressed", b.dataset.fmode === UI.fmode));
}
function toggleFilters(open) {
  if (UI.fmode === "side") sideOpen = open != null ? open : !sideOpen;
  else { UI.fOpen = open != null ? open : !UI.fOpen; saveUI(); }
  applyFilterLayout();
}
function setFilterMode(m) {
  UI.fmode = m; saveUI();
  sideOpen = m === "side";   // switching to the sidebar shows it straight away
  if (m === "inline") UI.fOpen = true;
  applyFilterLayout();
}

const statsActive = F => STAT_KEYS.filter(k => F.st[k]).length + F.sort.filter(x => STAT_KEYS.includes(x.k)).length;

/** Reflect the current tab's filter state in buttons, highlights and badges. */
function syncFilterUI() {
  const F = curF();
  if (!F) return;
  const nActive = activeCount(F);
  $("fN").textContent = nActive; $("fN").hidden = !nActive;
  if ($("q").value !== F.q) $("q").value = F.q;
  $("clear").hidden = !F.q.trim();
  const fb = $("factBtn"), fm = FACTION_META[F.f];
  fb.querySelector(".lbl").innerHTML = F.f ? `${factionIconHTML(F.f, 20)}${esc(F.f === "__none" ? "No faction" : F.f)}` : "All factions";
  fb.classList.toggle("on", !!F.f);
  fb.classList.toggle("tinted", !!fm);
  fb.style.setProperty("--fbg", fm ? fm.bg : "");
  fb.setAttribute("aria-expanded", factionPanelOpen);
  $("fpanel").hidden = !factionPanelOpen;

  [["series", "s"], ["ctype", "t"], ["cname", "nm"]].forEach(([id, key]) => {
    $(id).value = F[key];
    $(id).classList.toggle("on", !!F[key]);
  });

  const btn = $("klassBtn");
  btn.querySelector(".lbl").textContent = !F.ks.length ? "All class icons"
    : F.ks.length === 1 ? classLabel(F.ks[0])
    : `${F.ks.length} class icons · ${F.km === "all" ? "has all" : "has any"}`;
  btn.classList.toggle("on", F.ks.length > 0);
  btn.setAttribute("aria-expanded", classPanelOpen);
  $("kpanel").hidden = !classPanelOpen;
  $("kpanel").querySelectorAll("[data-km]").forEach(b => b.setAttribute("aria-pressed", b.dataset.km === F.km));
  $("kclear").hidden = !F.ks.length;

  const sb = $("skillBtn");
  sb.querySelector(".lbl").textContent = !F.sks.length ? "All skills"
    : F.sks.length === 1 ? F.sks[0] : `${F.sks.length} skills · ${F.skm === "all" ? "has all" : "has any"}`;
  sb.classList.toggle("on", F.sks.length > 0);
  sb.setAttribute("aria-expanded", skillPanelOpen);
  $("skpanel").hidden = !skillPanelOpen;
  $("skpanel").querySelectorAll("[data-skm]").forEach(b => b.setAttribute("aria-pressed", b.dataset.skm === F.skm));
  $("skclear").hidden = !F.sks.length;

  for (const X of STATS) {
    const el = $("st-" + X.k);
    el.value = F.st[X.k];
    el.classList.toggle("on", !!F.st[X.k]);
  }
  document.querySelectorAll(".sbtn").forEach(b => {
    const k = b.dataset.sort, label = sortLabel(k), prefix = b.dataset.label ? esc(b.dataset.label) + " " : "";
    const i = F.sort.findIndex(x => x.k === k);
    b.classList.toggle("on", i >= 0);
    if (i < 0) { b.innerHTML = prefix + "⇅"; b.title = `Sort by ${label}`; return; }
    const up = F.sort[i].d === 1;
    b.innerHTML = `${prefix}${up ? "↑" : "↓"}<small>${i + 1}</small>`;
    b.title = `${label}: ${up ? "Small → Large" : "Large → Small"} (priority ${i + 1})`;
  });
  const n = statsActive(F);
  if (n) UI.statsOpen = true;   // never hide active filters
  $("statsN").hidden = !n; $("statsN").textContent = n;
  $("statrow").hidden = !UI.statsOpen;
  $("statsToggle").setAttribute("aria-expanded", UI.statsOpen);

  const nAct = activeCount(F);
  $("resetF").hidden = $("resetTop").hidden = !nAct;
  $("resetN").textContent = $("resetTopN").textContent = nAct;
  $("brBtn").setAttribute("aria-pressed", F.br);
  $("brBtn").classList.toggle("on", F.br);
}

/* ---------- result lists ---------- */
/** Builds a highlighter that wraps every search term in <mark> in ONE pass,
    so a later term can never match inside markup added for an earlier one. */
function makeHighlighter(terms) {
  if (!terms.length) return esc;
  const re = new RegExp(terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi");
  return text => {
    text = String(text);
    let out = "", last = 0;
    text.replace(re, (m, off) => { out += esc(text.slice(last, off)) + "<mark>" + esc(m) + "</mark>"; last = off + m.length; return m; });
    return out + esc(text.slice(last));
  };
}
let hl = esc;

function statLine(c) {
  const p = [];
  if (c.st.co) p.push("C" + c.st.co);
  if (c.st.fa) p.push("F" + c.st.fa);
  if (c.st.se) p.push("M" + c.st.se);
  if (c.st.at || c.st.de) p.push("攻" + (c.st.at || "–") + "/耐" + (c.st.de || "–"));
  return p.length ? `<span class="stl">${esc(p.join(" · "))}</span>` : "";
}
const tagLine = c => `<span class="tags">${c.f ? factionBadge(c.f) : esc("No faction")} · ${esc(c.t || "Unclassified")}</span>${statLine(c)}`;
const nameLines = c => `<span class="no">${esc(c.s.code)} · ${esc(c.id)}</span><span class="jp">${hl(c.jp)}</span><span class="en">${hl(c.en)}</span>${tagLine(c)}`;

const PANES = {
  cards: {
    list: $("grid"), more: $("more"), empty: $("empty"), page: 60, res: [], shown: 0,
    html: c => `<button class="card" type="button" data-i="${c.i}">
        <img class="thumb" loading="lazy" decoding="async" alt="${esc(c.jp)}" src="${IMG.thumb(c.fid, 320)}" data-fid="${c.fid}">
        <span class="meta">${nameLines(c)}</span></button>`,
  },
  deck: {   // Deck Builder search pop-up (Revise#154): the Card List tile + the deck buttons
    list: $("plist"), more: $("more2"), empty: $("empty2"), page: 40, res: [], shown: 0,
    html: c => `<div class="card dcard row${entryOf(c.k) ? " in" : ""}${c.na ? " na" : ""}"${c.na ? ' title="Not automatic in the Game Table yet"' : ""}>
        <button class="dthumb" type="button" data-i="${c.i}" aria-label="Details for ${esc(c.jp)}"><img class="thumb" loading="lazy" decoding="async" alt="${esc(c.jp)}" src="${IMG.thumb(c.fid, 320)}" data-fid="${c.fid}"></button>
        <span class="meta">${nameLines(c)}</span>
        <div class="ctrl" data-k="${esc(c.k)}">${deckControlsHTML(c)}</div></div>`,
  },
};

function sortResults(list, sort) {
  if (!sort.length) return list;
  const keys = new Map(list.map(c => [c, sort.map(x => sortKey(sortValue(c, x.k)))]));
  return list.slice().sort((a, b) => {
    const A = keys.get(a), B = keys.get(b);
    for (let j = 0; j < sort.length; j++) {
      if (A[j][0] !== B[j][0]) return A[j][0] - B[j][0];          // blanks last in both directions
      if (A[j][1] !== B[j][1]) return sort[j].d * (A[j][1] - B[j][1]);
    }
    return a.i - b.i;                                             // ties keep card-number order
  });
}

/** Filter, count, sort and render the current tab. Call after any filter change. */
function search() {
  const F = curF(), P = PANES[UI.tab];
  if (!F || !P) return;
  const { res, fc } = filterAndCount(F);
  renderFilterOptions(F, fc);
  syncFilterUI();
  hl = makeHighlighter(F.q.trim().split(/\s+/).filter(Boolean).map(t => t.normalize("NFKC")));
  P.res = sortResults(res, F.sort);
  P.shown = 0; P.list.innerHTML = ""; showMore(P);
  P.empty.hidden = P.res.length > 0;
  $("status").textContent = $("fcount").textContent = `${P.res.length.toLocaleString()} of ${CARDS.length.toLocaleString()} cards`;
  saveUI();
}

function showMore(P) {
  const slice = P.res.slice(P.shown, P.shown + P.page);
  P.list.insertAdjacentHTML("beforeend", slice.map(P.html).join(""));
  P.shown += slice.length;
  P.more.hidden = P.shown >= P.res.length;
  P.more.textContent = `Show more (${(P.res.length - P.shown).toLocaleString()} left)`;
}

/** Apply a change to the current tab's filters, then refresh everything. */
function updateFilters(fn) {
  const F = curF();
  if (!F) return;
  fn(F);
  search();
}

function bindFilterEvents() {
  let typing;
  $("q").addEventListener("input", e => {
    const F = curF(); if (!F) return;
    F.q = e.target.value;
    clearTimeout(typing); typing = setTimeout(search, 120);
  });
  $("clear").addEventListener("click", () => { updateFilters(F => (F.q = "")); $("q").focus(); });
  $("series").addEventListener("change", e => updateFilters(F => (F.s = e.target.value)));
  $("fToggle").addEventListener("click", () => toggleFilters());
  $("fClose").addEventListener("click", () => toggleFilters(false));
  $("fDone").addEventListener("click", () => toggleFilters(false));
  $("fscrim").addEventListener("click", () => toggleFilters(false));
  document.querySelectorAll("[data-fmode]").forEach(b => b.addEventListener("click", () => setFilterMode(b.dataset.fmode)));
  $("factBtn").addEventListener("click", () => { factionPanelOpen = !factionPanelOpen; classPanelOpen = skillPanelOpen = false; syncFilterUI(); });
  $("fpanel").addEventListener("click", e => {
    const b = e.target.closest("[data-f]");
    if (b && !b.disabled) { factionPanelOpen = false; updateFilters(F => (F.f = b.dataset.f)); }
  });
  $("ctype").addEventListener("change", e => updateFilters(F => (F.t = e.target.value)));
  $("cname").addEventListener("change", e => updateFilters(F => (F.nm = e.target.value)));
  const resetAll = () => { updateFilters(F => Object.assign(F, emptyFilters(), { q: F.q })); toast("Filters reset"); };
  $("resetF").addEventListener("click", resetAll);
  $("resetTop").addEventListener("click", resetAll);
  $("brBtn").addEventListener("click", () => updateFilters(F => (F.br = !F.br)));

  $("klassBtn").addEventListener("click", () => { classPanelOpen = !classPanelOpen; factionPanelOpen = false; syncFilterUI(); });
  $("kpanel").addEventListener("change", e => {
    if (e.target.type !== "checkbox") return;
    updateFilters(F => {
      const v = e.target.value, i = F.ks.indexOf(v);
      if (e.target.checked && i < 0) F.ks.push(v);
      if (!e.target.checked && i >= 0) F.ks.splice(i, 1);
    });
  });
  $("kpanel").addEventListener("click", e => {
    const mode = e.target.closest("[data-km]");
    if (mode) updateFilters(F => (F.km = mode.dataset.km));
    if (e.target.id === "kclear") updateFilters(F => (F.ks = []));
    if (e.target.id === "kdone") { classPanelOpen = false; syncFilterUI(); }
  });

  $("skillBtn").addEventListener("click", () => { skillPanelOpen = !skillPanelOpen; factionPanelOpen = false; syncFilterUI(); });
  $("skpanel").addEventListener("change", e => {
    if (e.target.type !== "checkbox") return;
    updateFilters(F => {
      const v = e.target.value, i = F.sks.indexOf(v);
      if (e.target.checked && i < 0) F.sks.push(v);
      if (!e.target.checked && i >= 0) F.sks.splice(i, 1);
    });
  });
  $("skpanel").addEventListener("click", e => {
    const mode = e.target.closest("[data-skm]");
    if (mode) updateFilters(F => (F.skm = mode.dataset.skm));
    if (e.target.id === "skclear") updateFilters(F => (F.sks = []));
    if (e.target.id === "skdone") { skillPanelOpen = false; syncFilterUI(); }
  });

  $("statsToggle").addEventListener("click", () => {
    const F = curF();
    if (UI.statsOpen && F && statsActive(F)) { toast("Reset the stats filters to hide them"); return; }
    UI.statsOpen = !UI.statsOpen; syncFilterUI(); saveUI();
  });
  $("statrow").addEventListener("change", e => {
    const k = e.target.dataset.st;
    if (k) updateFilters(F => (F.st[k] = e.target.value));
  });
  const cycleSort = e => {
    const b = e.target.closest(".sbtn"); if (!b) return;
    updateFilters(F => {   // cycle: off → ↑ → ↓ → off
      const k = b.dataset.sort, i = F.sort.findIndex(x => x.k === k);
      if (i < 0) F.sort.push({ k, d: 1 });
      else if (F.sort[i].d === 1) F.sort[i].d = -1;
      else F.sort.splice(i, 1);
    });
  };
  $("statrow").addEventListener("click", cycleSort);
  $("sksorts").addEventListener("click", cycleSort);

  for (const P of Object.values(PANES)) P.more.addEventListener("click", () => showMore(P));
  const io = new IntersectionObserver(entries => entries.forEach(en => {
    if (en.isIntersecting && !en.target.hidden) showMore(PANES[en.target.dataset.pane]);
  }), { rootMargin: "600px" });
  io.observe($("more")); io.observe($("more2"));
}
