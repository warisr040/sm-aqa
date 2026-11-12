/* ==========================================================================
   Card details panel (side sheet on desktop, bottom sheet on phones).
   ========================================================================== */

const row = (label, value, cls) => (value ? `<dt>${label}</dt><dd${cls ? ` class="${cls}"` : ""}>${value}</dd>` : "");

/** Card details (the side sheet). Opened from an open dialog (a template step), it lies over the dialog and
    closing it goes back to the dialog (Pack, 2026-11-07: "In deck builder, make it able to open card details"). */
/** Phone (Pack, Revise#290): pull the card sheet down from its top bar (or from the top when it is scrolled to the top) to close it. */
function sheetSwipe() {
  const sh = $("sheet");
  if (!sh || sh.dataset.swipe) return;
  sh.dataset.swipe = "1";
  let y0 = null, dy = 0, x0 = null, dx = 0, yA = 0;   // down: close; left / right: the next / previous card (Revise#291)
  sh.addEventListener("touchstart", e => { if (e.touches.length !== 1) { y0 = x0 = null; return; } const top = e.target.closest(".sheet-top"); y0 = top || sh.scrollTop <= 0 ? e.touches[0].clientY : null; x0 = e.touches[0].clientX; yA = e.touches[0].clientY; dy = dx = 0; }, { passive: true });
  sh.addEventListener("touchmove", e => {
    if (x0 != null) dx = e.touches[0].clientX - x0;
    const ady = e.touches[0].clientY - yA;
    if (y0 == null || Math.abs(dx) > Math.abs(ady)) return;
    dy = e.touches[0].clientY - y0; if (dy > 0) { sh.style.transition = "none"; sh.style.translate = `0 ${dy}px`; }
  }, { passive: true });
  const end = e => {
    const t = e && e.changedTouches && e.changedTouches[0], ady = t ? Math.abs(t.clientY - yA) : 99;
    if (x0 != null && Math.abs(dx) > 70 && Math.abs(dx) > ady * 1.5 && !(e && e.target && e.target.closest && e.target.closest(".statgrid, .skchips, .tgts, input, textarea"))) { x0 = y0 = null; sh.style.transition = ""; sh.style.translate = ""; sheetNav(dx < 0 ? 1 : -1); return; }
    x0 = null;
    if (y0 == null) return; y0 = null; sh.style.transition = ""; sh.style.translate = ""; if (dy > 90) closeSheet(); dy = 0; };
  sh.addEventListener("touchend", end); sh.addEventListener("touchcancel", end);
}

/** The cards the sheet can page through (Pack, Revise#291): the Card List results, or the Deck Builder search results. */
let sheetList = null;
function sheetListFor(c) {
  for (const k of ["cards", "deck"]) { const P = typeof PANES !== "undefined" && PANES[k]; if (P && P.res && P.res.includes(c) && (k === "cards" ? UI.tab === "cards" : UI.tab === "deck")) return P.res; }
  return null;
}
function sheetNav(d) {
  if (!sheetList || $("sheet").hidden) return;
  const cur = $("sheet").dataset.k, i = sheetList.findIndex(x => x.k === cur), n = sheetList[i + d];
  if (i < 0 || !n) return;
  openCard(n, sheetList);
  try { if (!matchMedia("(prefers-reduced-motion: reduce)").matches) $("sheet").animate([{ opacity: .35, translate: `${d * 36}px 0` }, { opacity: 1, translate: "0 0" }], { duration: 200, easing: "cubic-bezier(.2,.8,.2,1)" }); } catch (e) {}
}

function closeSheet() {
  if (!document.body.classList.contains("sheetover")) { closeAll(); return; }
  document.body.classList.remove("sheetover");
  $("sheet").hidden = true;
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}
function openCard(c, list) {
  if (!list || $("sheet").hidden) lastFocus = document.activeElement;
  sheetList = list || sheetListFor(c);
  const at = sheetList ? sheetList.indexOf(c) : -1;
  const over = !$("modal").hidden;
  document.body.classList.toggle("sheetover", over);
  const printings = CARDS.filter(x => x !== c && x.jp === c.jp);
  const GRID = STATS.filter(X => !X.noGrid);
  const hasStats = c.t === "Character" || c.factor || GRID.some(X => c.st[X.k]);
  $("sheet").innerHTML = `
    <div class="sheet-top"><span class="no">${esc(c.s.code)} · No. ${esc(c.id)}</span>${at >= 0 && sheetList.length > 1 ? `<span class="snav"><button type="button" class="snb" data-nav="-1" aria-label="Previous card" title="Previous card (←)"${at === 0 ? " disabled" : ""}>‹</button><span class="snp">${at + 1} / ${sheetList.length}</span><button type="button" class="snb" data-nav="1" aria-label="Next card" title="Next card (→)"${at === sheetList.length - 1 ? " disabled" : ""}>›</button></span>` : ""}<button class="close" type="button" id="sheetClose" aria-label="Close">×</button></div>
    <div class="bigframe"><img class="big" alt="${esc(c.jp)}" src="${IMG.thumb(c.fid, 1000)}" data-fid="${c.fid}"></div>
    <h2 id="d-jp">${esc(c.jp)}</h2>
    <div class="en-big">${esc(c.en)}</div>
    ${hasStats ? `<div class="statgrid">${GRID.map(X => `<div><span>${X.label}</span><b>${esc((X.k === "fa" ? c.factor : c.st[X.k]) || "–")}</b></div>`).join("")}</div>` : ""}
    ${c.skills.length ? `<div class="skchips">${c.skills.map(t => `<span>${esc(t)}</span>`).join("")}</div>` : ""}
    ${c.text || c.textEn ? `<div class="ctext">${c.textEn ? `<div class="ctext-en" lang="en">${esc(c.textEn)}</div>` : ""}${c.text ? `<div class="ctext-jp" lang="ja">${esc(c.text)}</div>` : ""}</div>` : ""}
    ${typeof condsHTML === "function" ? condsHTML(c) : ""}
    ${typeof abilHTML === "function" ? abilHTML(c) : ""}
    ${c.effects.length ? `<div class="effs"><span class="dlabel">Effects · ${c.effects.length}</span>${c.effects.map((e, i) => `<div class="eff">${effectCostHTML(e.cost)}<div><b>Effect ${i + 1}</b> · cost ${esc(e.cost)} ${typeof effectChipHTML === "function" && e.steps ? effectChipHTML(e) : ""}${e.en ? `<div lang="en">${esc(e.en)}</div>` : ""}<div lang="ja" class="note">${esc(e.jp)}</div></div></div>`).join("")}</div>` : ""}
    ${(tg => tg.length ? `<div class="tgts"><span class="dlabel">Targets · ${tg.length}</span>${(en => tg.map((t, i) => `<span class="tgt" title="${esc(t.text)}"><b>${esc(t.label)}</b><small${en[i] ? ' lang="en"' : ' lang="ja"'}>${esc(en[i] || t.text)}</small></span>`).join(""))(enTargetsOf(c))}</div>` : "")(cardTargets(c))}
    <div class="deckbox"><span class="dlabel">Deck · ${esc(deck.name || "My Deck")}</span><div class="ctrl" data-k="${esc(c.k)}" data-full="1">${deckControlsHTML(c, true)}</div></div>
    <dl>
      ${row("Number", `<span class="no">${esc(c.id)}</span>`)}
      ${row("Series", `${esc(c.s.code)} ${esc(c.s.jp)}<br><span class="note">${esc(c.s.en)}</span>`)}
      ${row("Faction", factionBadge(c.f))}
      ${row("Category", esc(c.t || "Unclassified"))}
      ${row("Class", c.classRaw && esc(c.classRaw) + (c.cls.length ? `<span class="clsicons">${c.cls.map(t => `<span>${classIconHTML(t)}${esc(classLabel(t))}</span>`).join("")}</span>` : ""))}
      ${row("Timing", esc([c.scope, c.timing].filter(Boolean).join(" / ")))}
      ${row("Rarity", esc(c.rarity))}
      ${row("Illustrator", esc(c.illustrator))}
      ${row("Variant", esc(c.variant))}
      ${row("Errata", esc(c.errata))}
      ${row("Saga", esc(c.s.saga))}
      ${row("Note", esc(c.note), "note")}
      ${row("Also in", printings.length && printings.slice(0, 8).map(x => `<a href="#" data-i="${x.i}">${esc(x.s.code)} · ${esc(x.id)}</a>`).join(", ") + (printings.length > 8 ? ` +${printings.length - 8} more` : ""))}
    </dl>
    <div class="actions">
      <a class="btn primary" href="${IMG.file(c.fid)}" target="_blank" rel="noopener">Open in Drive</a>
      <a class="btn" href="${LINKS.folder}" target="_blank" rel="noopener">📁 AA folder</a>
      ${c.s.page ? `<a class="btn" href="${esc(c.s.page)}" target="_blank" rel="noopener">Series page</a>` : ""}
      <button class="btn" type="button" id="copyName">Copy name</button>
    </div>
    ${window.AAReport ? AAReport.buttonHTML('id="sheetReport"') : ""}`;
  if (!over) $("modal").hidden = true;
  $("sheet").hidden = $("scrim").hidden = false;
  $("sheet").scrollTop = 0;
  $("sheetClose").focus();
  $("sheetClose").onclick = closeSheet;
  $("sheet").dataset.k = c.k;
  if ($("sheetReport")) $("sheetReport").onclick = () => AAReport.open({ page: "cards", card: { key: c.k, jp: c.jp, en: c.en, type: c.t || "", status: c.na ? "not automatic in the Game Table" : "" } });   // Revise#295
  $("sheet").querySelectorAll("[data-nav]").forEach(b => (b.onclick = () => sheetNav(+b.dataset.nav)));
  sheetSwipe();
  $("copyName").onclick = async e => {
    const b = e.currentTarget;
    try { await navigator.clipboard.writeText(c.jp); b.textContent = "Copied"; } catch (err) { b.textContent = c.jp; }
  };
}

/** One delegated click handler: deck actions, card details, deck board items. */
function bindCardClicks() {
  const actions = { add: (k, b) => addCard(k, b.dataset.cat), dec: removeOne, inc: k => { const f = entryOf(k); if (f) addCard(k, f.cat); }, move: (k, b) => moveCard(k, b.dataset.cat), rm: removeAll };
  document.addEventListener("click", e => {
    const a = e.target.closest("[data-act]");
    if (a) { e.preventDefault(); if (!a.disabled && actions[a.dataset.act]) actions[a.dataset.act](a.dataset.k, a); return; }
    const o = e.target.closest("[data-i]");
    if (o) { e.preventDefault(); openCard(CARDS[+o.dataset.i]); return; }
    const it = e.target.closest("#cols .item");
    if (it) { const c = card(it.dataset.k); if (c) openCard(c); }
  });
}
