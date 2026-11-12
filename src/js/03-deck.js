/* ==========================================================================
   Deck Builder: deck model (no card limit — 50–60 / 4 per name shown as a guide, Revise#211), category
   controls in the picker and details panel, and the five-column deck board.
   ========================================================================== */

const emptyDeck = name => ({ name: name || "My Deck", cols: Object.fromEntries(CATS.map(c => [c.id, []])) });

/* Fifty deck slots (aa-decks) shown as 5 pages of 10 (Pack, Revise#397); the open one is `deck` (also kept in aa-deck for older pages). */
const DECK_SLOTS = 50, SLOT_PAGE = 10, SLOT_PAGES = DECK_SLOTS / SLOT_PAGE;
const pageOf = i => Math.floor(i / SLOT_PAGE);
const cleanDeck = d => {
  if (!d || !d.cols) return null;
  // drop unknown cards and upgrade old keys (card numbers changed in the completed list)
  CATS.forEach(C => {
    d.cols[C.id] = (d.cols[C.id] || []).filter(e => e && e.n > 0 && card(e.k)).map(e => ({ k: card(e.k).k, n: e.n }));
  });
  return d;
};
let deckSlots = (() => {
  const saved = store.get("aa-decks", null);
  const list = Array.from({ length: DECK_SLOTS }, (_, i) => cleanDeck(saved && saved[i]));
  if (!saved) list[0] = cleanDeck(store.get("aa-deck", null));   // first visit with slots: keep the current deck in slot 1
  return list;
})();
let deckSlot = Math.min(DECK_SLOTS - 1, Math.max(0, store.get("aa-slot", 0) | 0));
let deck = deckSlots[deckSlot] || emptyDeck(`Deck ${deckSlot + 1}`);
const slotTotal = d => (d ? CATS.reduce((a, C) => a + d.cols[C.id].reduce((n, e) => n + e.n, 0), 0) : 0);
function saveSlots() {
  deckSlots[deckSlot] = slotTotal(deck) || deck.name !== `Deck ${deckSlot + 1}` ? deck : null;
  store.set("aa-decks", deckSlots); store.set("aa-slot", deckSlot); store.set("aa-deck", deck);
}
function switchSlot(i) {
  saveSlots();
  deckSlot = i;
  deck = deckSlots[i] || emptyDeck(`Deck ${i + 1}`);
  store.set("aa-slot", deckSlot);
  deckChanged();
  toast(`Deck slot ${i + 1}: ${deck.name}`);
}
function renderSlotSelect() {
  const sel = $("deckSlot");
  if (!sel) return;
  const pg = pageOf(deckSlot), used = p => deckSlots.slice(p * SLOT_PAGE, (p + 1) * SLOT_PAGE).filter((d, k) => slotTotal(p * SLOT_PAGE + k === deckSlot ? deck : d)).length;
  sel.innerHTML = deckSlots.map((d, i) => {
    if (pageOf(i) !== pg) return "";
    const dd = i === deckSlot ? deck : d, n = slotTotal(dd);
    return `<option value="${i}"${i === deckSlot ? " selected" : ""}>${i + 1}. ${esc(dd ? dd.name : "(empty)")}${n ? ` · ${n}` : ""}</option>`;
  }).join("");
  const ps = $("deckPage");
  if (ps) ps.innerHTML = Array.from({ length: SLOT_PAGES }, (_, p) => `<option value="${p}"${p === pg ? " selected" : ""}>Page ${p + 1}${used(p) ? ` · ${used(p)}` : ""}</option>`).join("");
}
const catMemo = store.get("aa-cat", {});   // last category used per card name

function entryOf(k) {
  for (const C of CATS) {
    const i = deck.cols[C.id].findIndex(e => e.k === k);
    if (i >= 0) return { cat: C.id, i, e: deck.cols[C.id][i] };
  }
  return null;
}
const catTotal = id => deck.cols[id].reduce((a, e) => a + e.n, 0);
const naCount = () => CATS.reduce((a, C) => a + deck.cols[C.id].reduce((b, e) => b + (card(e.k) && card(e.k).na ? e.n : 0), 0), 0);   // Revise#167
const deckTotal = () => CATS.reduce((a, C) => a + catTotal(C.id), 0);
/** Copies of a card NAME across all printings (the 4-copy rule counts names). */
function nameCount(jp) {
  let n = 0;
  for (const C of CATS) for (const e of deck.cols[C.id]) if (card(e.k).jp === jp) n += e.n;
  return n;
}
function remember(jp, cat) { catMemo[jp] = cat; store.set("aa-cat", catMemo); }

function addCard(k, cat) {
  const c = card(k); if (!c) return;
  const f = entryOf(k);
  if (f) { f.e.n++; cat = f.cat; }
  else { deck.cols[cat].push({ k, n: 1 }); remember(c.jp, cat); }
  deckChanged();
  toast(`${c.jp} → ${cat} · ${deckTotal()}/${LIMITS.deck}`);
}
function removeOne(k) {
  const f = entryOf(k); if (!f) return;
  if (--f.e.n <= 0) deck.cols[f.cat].splice(f.i, 1);
  deckChanged();
}
function moveCard(k, cat) {
  const f = entryOf(k); if (!f || f.cat === cat) return;
  deck.cols[f.cat].splice(f.i, 1);
  deck.cols[cat].push(f.e);
  remember(card(k).jp, cat);
  deckChanged();
}
function removeAll(k) {
  const f = entryOf(k); if (!f) return;
  deck.cols[f.cat].splice(f.i, 1);
  deckChanged();
}
function deckChanged() {
  saveSlots();
  renderSlotSelect();
  renderDeck();
  refreshDeckControls();
  if ($("dbsDeck")) $("dbsDeck").textContent = `Deck ${deckTotal()} / ${LIMITS.deck}`;
}

/** − / count / + for every card (Pack, Revise#404): no category buttons — a new card goes to the category of its card type
    (an unclassified card: the category last used for that name, else Character). `full` (details panel) adds the category, Move and Remove. */
const autoCat = c => (CAT[c.t] ? c.t : CAT[catMemo[c.jp]] ? catMemo[c.jp] : CATS[0].id);
function deckControlsHTML(c, full) {
  const f = entryOf(c.k), k = esc(c.k), cat = f ? f.cat : autoCat(c), C = CAT[cat];
  let h = (full && f ? `<span class="incat" style="--c:${C.color}">${C.id}</span>` : "")
    + `<button class="step" type="button" data-act="dec" data-k="${k}" aria-label="Remove one copy"${f ? "" : " disabled"}>−</button>
      <b class="qtyn${f ? "" : " zero"}" aria-label="Copies">${f ? f.e.n : 0}</b>
      <button class="step" type="button" data-act="add" data-k="${k}" data-cat="${cat}" aria-label="Add one copy" title="${f ? "Add one copy" : "Add to the deck as " + C.id}">+</button>`;
  if (full && f) h += `<div class="moveto"><span>Move to</span>${CATS.filter(X => X.id !== f.cat)
      .map(X => `<button class="mini" type="button" style="--c:${X.color}" data-act="move" data-k="${k}" data-cat="${X.id}">${X.id}</button>`).join("")}
      <button class="mini rm" type="button" data-act="rm" data-k="${k}">Remove all</button></div>`;
  return h;
}
function refreshDeckControls() {
  document.querySelectorAll(".ctrl[data-k]").forEach(el => {
    const c = card(el.dataset.k);
    el.innerHTML = deckControlsHTML(c, el.dataset.full === "1");
    const row = el.closest(".row");
    if (row) row.classList.toggle("in", !!entryOf(c.k));
  });
}

/* ---------- automatic order (Pack, Revise#154) ----------
   Character: Charge → Charge with "▼ …ブレイクカードのコスト≫は手札に戻る" → Draw → other; then Mental 0 → highest; then Aggressive ▼ first.
   Break: no name first — by Mental, then Charge → Charge + cost to hand → Draw → other; named — by card number. */
const deckSkillPos = v => !!v && !/^[-−]/.test(String(v));
const deckSkillGroup = c => { const ch = deckSkillPos(c.sk.Charge), br = BREAK_RETURN.test(c.text || ""); return ch && !br ? 0 : ch && br ? 1 : deckSkillPos(c.sk.Draw) ? 2 : 3; };
const deckMentalKey = c => { const n = parseInt(c.st.se, 10); return isNaN(n) ? 999 : n; };
const deckAggressive = c => c.skills.includes("Aggressive ▼") || /^\s*▼/.test(c.text || "");
const ARRANGE = {
  Character: c => [deckSkillGroup(c), deckMentalKey(c), deckAggressive(c) ? 0 : 1, c.i],
  Break: c => (c.named ? [1, c.i, 0, 0] : [0, deckMentalKey(c), deckSkillGroup(c), c.i]),
};
function arrangeDeck() {
  for (const [cat, key] of Object.entries(ARRANGE)) {
    const ks = new Map(deck.cols[cat].map(e => [e, key(card(e.k))]));
    deck.cols[cat].sort((a, b) => { const A = ks.get(a), B = ks.get(b); for (let j = 0; j < A.length; j++) if (A[j] !== B[j]) return A[j] - B[j]; return 0; });
  }
}
/** The deck's main factor: the faction with the most Character cards (copies counted). */
function mainFaction() {
  const n = {};
  for (const e of deck.cols.Character) { const f = card(e.k).f; if (f) n[f] = (n[f] || 0) + e.n; }
  return Object.keys(n).sort((a, b) => n[b] - n[a] || FACTS.indexOf(a) - FACTS.indexOf(b))[0] || "";
}
/** Board columns: Character is split in two — main factor / other factors (Revise#154). */
function boardCols() {
  const mf = mainFaction(), C = CAT.Character, ch = deck.cols.Character;
  const main = ch.filter(e => mf && card(e.k).f === mf), other = ch.filter(e => !(mf && card(e.k).f === mf));
  return [
    { cat: "Character", color: C.color, label: `Character · ${mf || "main factor"}`, short: `Char · ${mf ? (FACTION_META[mf] && FACTION_META[mf].short) || mf : "main"}`, list: main },
    { cat: "Character", color: C.color, label: "Character · other factors", short: "Char · other", list: other },
  ].concat(CATS.filter(X => X.id !== "Character").map(X => ({ cat: X.id, color: X.color, label: X.id, short: X.short, list: deck.cols[X.id] })));
}
const listTotal = l => l.reduce((a, e) => a + e.n, 0);

/* ---------- deck board ---------- */
let sortables = [];
function renderDeck() {
  arrangeDeck();
  const t = deckTotal(), ok = t >= LIMITS.min && t <= LIMITS.deck;
  $("tabDeck").textContent = t;
  $("segDeck").textContent = `Deck ${t} / ${LIMITS.deck}`;
  $("summary").innerHTML = `<div class="total ${ok ? "ok" : "low"}"><b>${t}</b><small>/ ${LIMITS.deck}</small>
      <span>${ok ? `Ready (${LIMITS.min}–${LIMITS.deck} cards)` : t > LIMITS.deck ? `${t - LIMITS.deck} over ${LIMITS.deck} (no limit)` : `Add ${LIMITS.min - t} more to reach ${LIMITS.min}`}</span></div>
    <div class="catsum">${CATS.map(C => `<span class="cpill" style="--c:${C.color}"><i></i><span class="full">${C.id}</span><span class="short">${C.short}</span><b>${catTotal(C.id)}</b></span>`).join("")}</div>${naCount() ? `<span class="nalegend" title="The Game Table can't run these cards fully by itself yet — use By hand for the rest">Red frame: ${naCount()} not automatic in the Game Table</span>` : ""}`;

  const w = UI.mode === "fit" ? 200 : 440;
  const cols = $("cols");
  cols.className = "cols " + UI.mode;
  cols.innerHTML = boardCols().map(C => `<div class="col" style="--c:${C.color}">
      <div class="colhead"><span><span class="full">${esc(C.label)}</span><span class="short">${esc(C.short)}</span></span><b>${listTotal(C.list)}</b></div>
      <div class="list" data-cat="${C.cat}">${C.list.map(e => {
        const c = card(e.k);
        return `<div class="item${c.na ? " na" : ""}" data-k="${esc(e.k)}" title="${esc(c.jp)} · ${esc(c.k)}${c.na ? " · not automatic in the Game Table" : ""}"><img alt="${esc(c.jp)}" src="${IMG.thumb(c.fid, w)}" data-fid="${c.fid}" draggable="false"><span class="qtyc"><button type="button" class="qbtn" data-act="inc" data-k="${esc(e.k)}" aria-label="One more ${esc(c.jp)}" title="One more">▲</button><span class="qty">x ${e.n}</span><button type="button" class="qbtn" data-act="dec" data-k="${esc(e.k)}" aria-label="One less ${esc(c.jp)}" title="${e.n > 1 ? "One less" : "Remove from the deck"}">▼</button></span></div>`;
      }).join("")}</div>
    </div>`).join("");

  sortables.forEach(s => s.destroy()); sortables = [];
  if (window.Sortable) cols.querySelectorAll(".list").forEach(l => sortables.push(Sortable.create(l, {
    group: "deck", animation: 150, delay: 180, delayOnTouchOnly: true, touchStartThreshold: 5,
    filter: ".qbtn", preventOnFilter: false,   // the ▲ / ▼ count buttons are not drag handles (Revise#226)
    ghostClass: "ghost", chosenClass: "chosen", onEnd: () => setTimeout(syncDeckFromBoard, 0),
  })));

  if (document.activeElement !== $("deckName")) $("deckName").value = deck.name;
  document.querySelectorAll("[data-mode]").forEach(b => b.setAttribute("aria-pressed", b.dataset.mode === UI.mode));
  sizeDeckCards();
}

/** After drag-and-drop: read the new order/columns back from the board. */
function syncDeckFromBoard() {
  const next = {};
  $("cols").querySelectorAll(".list").forEach(l => {
    next[l.dataset.cat] = (next[l.dataset.cat] || []).concat([...l.children].map(it => {
      const f = entryOf(it.dataset.k);
      if (f && f.cat !== l.dataset.cat) catMemo[card(f.e.k).jp] = l.dataset.cat;
      return f ? { k: f.e.k, n: f.e.n } : null;
    }).filter(Boolean));
  });
  CATS.forEach(C => (next[C.id] = next[C.id] || []));
  store.set("aa-cat", catMemo);
  deck.cols = next;
  deckChanged();
}

/** "Fit to width": size cards so all the columns (6: Character main / other, Break, Fast, Project, Permanent) fit the board width. */
function sizeDeckCards() {
  const cols = $("cols"), s = cols.style;
  if (UI.mode !== "fit") { ["--iw", "--gap", "--rg", "--qf", "--pad"].forEach(p => s.removeProperty(p)); return; }
  if (!cols.offsetParent) return;   // hidden
  const W = cols.clientWidth, narrow = W < 560;
  const gap = narrow ? 4 : 10, pad = narrow ? 3 : 8, rg = narrow ? 4 : 8, qtyW = narrow ? 24 : 40;
  const N = cols.children.length || 6, colW = (W - (N - 1) * gap) / N;
  const iw = Math.max(18, Math.floor(Math.min(colW - 2 * pad - 2 - qtyW - 5, 170)));
  s.setProperty("--iw", iw + "px"); s.setProperty("--gap", gap + "px"); s.setProperty("--rg", rg + "px");
  s.setProperty("--pad", pad + "px");
  s.setProperty("--qf", (narrow ? 10 : Math.max(12, Math.min(20, Math.round(iw * 0.16)))) + "px");
}

/* ---------- Search pop-up (Pack, Revise#154): the Card List search, filters and grid in a window over the deck ---------- */
let dbsHome = null;
function openDeckSearch() {
  const fh = $("fhome");
  if (!dbsHome) dbsHome = { parent: fh.parentNode, next: fh.nextSibling };
  $("dbsSearch").appendChild(fh);
  $("dbs").hidden = false;
  document.body.classList.add("dbsopen");
  $("dbsDeck").textContent = `Deck ${deckTotal()} / ${LIMITS.deck}`;
  search();
  const q = $("q"); if (q && innerWidth > 700) q.focus();
}
function closeDeckSearch() {
  if ($("dbs").hidden) return;
  if (typeof sideOpen !== "undefined" && sideOpen) toggleFilters(false);
  const fh = $("fhome");
  if (dbsHome) dbsHome.parent.insertBefore(fh, dbsHome.next);
  $("dbs").hidden = true;
  document.body.classList.remove("dbsopen");
}
const deckSearchOpen = () => !$("dbs").hidden;

function bindDeckEvents() {
  document.body.appendChild($("dbs"));   // over the header too (main is its own stacking layer)
  $("btnSearch").addEventListener("click", openDeckSearch);
  $("dbsClose").addEventListener("click", closeDeckSearch);
  $("dbs").addEventListener("click", e => { if (e.target === $("dbs")) closeDeckSearch(); });
  document.querySelectorAll("[data-mode]").forEach(b => b.addEventListener("click", () => {
    UI.mode = b.dataset.mode; saveUI(); renderDeck();
  }));
  $("deckName").addEventListener("input", e => { deck.name = e.target.value; saveSlots(); renderSlotSelect(); });
  $("deckSlot").addEventListener("change", e => switchSlot(+e.target.value));
  if ($("deckPage")) $("deckPage").addEventListener("change", e => switchSlot(+e.target.value * SLOT_PAGE + deckSlot % SLOT_PAGE));   // the same place on the other page
  $("btnSleeve").addEventListener("click", openSleeve);
  $("btnNew").addEventListener("click", e => {   // two taps to clear a non-empty deck
    const b = e.currentTarget;
    const reset = () => { delete b.dataset.arm; b.textContent = "Clear"; b.classList.remove("warn"); };
    if (b.dataset.arm || !deckTotal()) { deck = emptyDeck(`Deck ${deckSlot + 1}`); deckChanged(); reset(); toast("Deck cleared"); return; }
    b.dataset.arm = 1; b.textContent = "Tap again to clear"; b.classList.add("warn");
    setTimeout(reset, 3000);
  });
}

/* ---------- deck sleeve (card back shown on the Game Table) ---------- */
const SLEEVE_DEFAULT = "sleeve.jpg";   // the Aquarian Age card back
const CARD_RATIO = 88 / 63;
/** CSS for a card back: the sleeve image, zoomed and positioned to fill the card. */
function sleeveStyle(sl) {
  const img = sl && sl.img ? sl.img : SLEEVE_DEFAULT;
  const z = (sl && sl.zoom) || 100, x = sl && sl.x != null ? sl.x : 50, y = sl && sl.y != null ? sl.y : 50;
  return `background-image:url("${img}");background-size:${z}% auto;background-position:${x}% ${y}%`;
}
/** Smallest zoom (% of card width) that covers the whole card. */
const coverZoom = (w, h) => Math.max(100, Math.ceil(100 * CARD_RATIO * (w / h)));
function loadImage(src) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
}
/** Downscale (max 520 px) and optionally rotate an image; returns a JPEG data URL small enough for saving. */
function shrinkImage(im, rotate) {
  const k = Math.min(1, 520 / Math.max(im.width, im.height));
  const w = Math.round(im.width * k), h = Math.round(im.height * k);
  const cv = document.createElement("canvas");
  cv.width = rotate ? h : w; cv.height = rotate ? w : h;
  const ctx = cv.getContext("2d");
  if (rotate) { ctx.translate(h, 0); ctx.rotate(Math.PI / 2); }
  ctx.drawImage(im, 0, 0, w, h);
  return { img: cv.toDataURL("image/jpeg", 0.85), w: cv.width, h: cv.height };
}
function openSleeve() {
  const sl = deck.sleeve || {};
  const sample = CARDS.find(c => c.t === "Character");
  openModal("Deck sleeve", `
    <p class="note">The card back for this deck on the Game Table. Choose an image, then zoom and move it until it fills the card.</p>
    <div class="slv">
      <div class="slvprev"><span class="pback slvback" id="slvBack"></span>
        <img class="slvcard" alt="" src="${IMG.thumb(sample.fid, 300)}" data-fid="${sample.fid}"><span class="note">Card size</span></div>
      <div class="slvctl">
        <div class="actions"><label class="btn primary" for="slvFile">Choose image…</label><input id="slvFile" type="file" accept="image/*" hidden>
          <button class="btn" type="button" id="slvRot">Rotate 90°</button><button class="btn" type="button" id="slvFit">Fit to card</button><button class="btn" type="button" id="slvDef">Default sleeve</button></div>
        <label class="slvr">Size <input type="range" id="slvZoom" min="50" max="400" value="${sl.zoom || 100}"><b id="slvZv"></b></label>
        <label class="slvr">Left ↔ right <input type="range" id="slvX" min="0" max="100" value="${sl.x != null ? sl.x : 50}"></label>
        <label class="slvr">Up ↕ down <input type="range" id="slvY" min="0" max="100" value="${sl.y != null ? sl.y : 50}"></label>
        <p class="note" id="slvMsg">${sl.img ? "Your image" : "Default: Aquarian Age card back"}</p>
      </div>
    </div>`, true);
  const show = () => {
    const s2 = deck.sleeve || {};
    $("slvBack").setAttribute("style", sleeveStyle(s2));
    $("slvZv").textContent = ((s2.zoom || 100)) + "%";
  };
  const set = patch => { deck.sleeve = Object.assign({}, deck.sleeve || {}, patch); deckChanged(); show(); };
  $("slvZoom").oninput = e => set({ zoom: +e.target.value });
  $("slvX").oninput = e => set({ x: +e.target.value });
  $("slvY").oninput = e => set({ y: +e.target.value });
  const useImage = (r, msg) => {
    const z = coverZoom(r.w, r.h);
    set({ img: r.img, w: r.w, h: r.h, zoom: z, x: 50, y: 50 });
    $("slvZoom").value = z; $("slvX").value = 50; $("slvY").value = 50;
    $("slvMsg").textContent = msg;
  };
  $("slvFile").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
      useImage(shrinkImage(await loadImage(url), false), `Your image: ${f.name}`);
    } catch (err) { $("slvMsg").textContent = "This file could not be read as an image."; }
  };
  $("slvRot").onclick = async () => {
    const cur = deck.sleeve && deck.sleeve.img ? deck.sleeve.img : SLEEVE_DEFAULT;
    try { useImage(shrinkImage(await loadImage(cur), true), "Rotated"); } catch (err) { $("slvMsg").textContent = "Could not rotate this image."; }
  };
  $("slvFit").onclick = () => {
    const s2 = deck.sleeve || {};
    const z = s2.w ? coverZoom(s2.w, s2.h) : 100;
    set({ zoom: z, x: 50, y: 50 }); $("slvZoom").value = z; $("slvX").value = 50; $("slvY").value = 50;
  };
  $("slvDef").onclick = () => { deck.sleeve = null; deckChanged(); show(); $("slvZoom").value = 100; $("slvX").value = 50; $("slvY").value = 50; $("slvMsg").textContent = "Default: Aquarian Age card back"; };
  show();
}
