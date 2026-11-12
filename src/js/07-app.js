/* ==========================================================================
   App shell: tabs, phone Deck Builder switch, Rules language, keyboard,
   image fallback, starry background, start-up.
   ========================================================================== */

/** Game Table (v4): table.html in a frame, loaded the first time the tab opens (it has its own scripts and
    data; same site, so it shares the Deck Builder slots). Invite link: #table/ROOMCODE. */
function showTableTab(code) {
  const f = $("tableFrame");
  if (!f.src || code) f.src = f.dataset.src + (code ? "#" + code : "");
}
function setTab(t) {
  const tableCode = (/^table\/(.+)$/i.exec(t) || [])[1];
  if (tableCode) t = "table";
  if (/^(play|solo)(\/|$)/i.test(t)) t = "table";   // the old v3 Solo Test / Play Online tabs are gone: the Game Table replaces them
  const admin = t === "addoge";   // Revise#302: the owner's page — no tab, only the link
  if (!TABS.includes(t) && !admin) t = "home";
  UI.tab = t;
  document.body.dataset.tab = t;
  document.querySelectorAll(".tabs [data-tab]").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === t));
  const nav = document.querySelector(".tabs"), active = nav.querySelector(`[data-tab="${t}"]`);
  if (active) nav.scrollLeft = Math.max(0, active.offsetLeft - nav.clientWidth / 2 + active.offsetWidth / 2);   // keep it visible on phones
  TABS.forEach(id => ($("p-" + id).hidden = id !== t));
  if ($("p-addoge")) $("p-addoge").hidden = !admin;
  if (location.hash.slice(1) !== t && !(t === "table" && tableCode)) history.replaceState(null, "", "#" + t);
  if (t === "table") showTableTab(tableCode);
  if (sideOpen) toggleFilters(false);
  if (t !== "deck") closeDeckSearch();
  if (SEARCH_TABS.includes(t)) { classPanelOpen = skillPanelOpen = factionPanelOpen = false; syncFilterUI(); search(); }
  if (t === "deck") requestAnimationFrame(sizeDeckCards);
  saveUI();
}

/** A tab change with a short fade between the screens (Pack, Revise#286): the View Transitions API where the browser has it. */
function goTab(t) {
  let calm = false; try { calm = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
  if (t === UI.tab || calm || !document.startViewTransition) return setTab(t);
  try { document.startViewTransition(() => setTab(t)); } catch (e) { setTab(t); }
}

function setView(v) {   // phones: "pick" (Select cards) or "deck"
  UI.view = v;
  document.body.dataset.view = v;
  document.querySelectorAll(".deckbar [data-view]").forEach(b => b.setAttribute("aria-pressed", b.dataset.view === v));
  requestAnimationFrame(sizeDeckCards);
  saveUI();
}

function setRulesLang(v) {
  UI.rlang = v;
  document.body.dataset.rlang = v;
  document.querySelectorAll("button[data-rlang]").forEach(b => b.setAttribute("aria-pressed", b.dataset.rlang === v));
  saveUI();
}

function bindShellEvents() {
  document.querySelectorAll(".tabs [data-tab]").forEach(b => b.addEventListener("click", () => goTab(b.dataset.tab)));
  document.querySelectorAll("[data-cltab]").forEach(b => b.addEventListener("click", () => {   // Changelog: Changes / Bug reports (Pack, Revise#329)
    const bugs = b.dataset.cltab === "bugs";
    document.querySelectorAll("[data-cltab]").forEach(x => x.setAttribute("aria-selected", x === b));
    $("clChanges").hidden = bugs; $("clBugs").hidden = !bugs;
  }));
  if ($("openReports")) $("openReports").onclick = () => window.AAReport && AAReport.list();   // Revise#295
  if ($("openRooms")) $("openRooms").onclick = () => window.AAReport && AAReport.rooms();   // Revise#301
  if ($("openCampaign")) $("openCampaign").onclick = () => window.AACampaign && AACampaign.manage();   // Revise#379
  document.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => { goTab(b.dataset.go); scrollTo({ top: 0 }); }));   // Home page buttons
  document.querySelectorAll(".deckbar [data-view]").forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));
  document.querySelectorAll("button[data-rlang]").forEach(b => b.addEventListener("click", () => setRulesLang(b.dataset.rlang)));
  document.querySelectorAll("[data-rjump]").forEach(a => a.addEventListener("click", e => {
    e.preventDefault(); scrollToEl(document.querySelector(a.getAttribute("href")));
  }));
  addEventListener("hashchange", () => setTab(location.hash.slice(1)));

  let resizing;
  addEventListener("resize", () => { clearTimeout(resizing); resizing = setTimeout(sizeDeckCards, 80); });
  if (window.ResizeObserver) {   // sticky offsets below the header
    new ResizeObserver(() => document.documentElement.style.setProperty("--hh", $("hdr").offsetHeight + "px")).observe($("hdr"));
  }

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !$("sheet").hidden && document.body.classList.contains("sheetover")) closeSheet();   // details over a dialog: back to the dialog
    else if (e.key === "Escape" && (!$("sheet").hidden || !$("modal").hidden)) closeAll();
    else if (e.key === "Escape" && sideOpen) toggleFilters(false);
    else if (e.key === "Escape" && deckSearchOpen()) closeDeckSearch();
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !typing && !$("sheet").hidden && typeof sheetNav === "function") { e.preventDefault(); sheetNav(e.key === "ArrowRight" ? 1 : -1); }   // Revise#291: page through the cards
    if (e.key === "/" && !typing && SEARCH_TABS.includes(UI.tab)) { e.preventDefault(); $("q").focus(); }
  });

  // Drive image fallback: thumbnail endpoint → lh3 → placeholder
  document.addEventListener("error", e => {
    const img = e.target;
    if (img.tagName !== "IMG" || !img.dataset.fid) return;
    if (IMG_BASE && !img.dataset.cdn && String(img.getAttribute("src") || "").startsWith(IMG_BASE)) { img.dataset.cdn = 1; img.src = IMG.drive(img.dataset.fid, img.classList.contains("big") ? 1000 : 320); }   // not on the pictures site → Drive
    else if (!img.dataset.tried) { img.dataset.tried = 1; img.src = IMG.lh3(img.dataset.fid, img.classList.contains("big") ? 1000 : 320); }
    else if (!img.dataset.dead) { img.dataset.dead = 1; img.title = "Image not available"; img.src = IMG.none; }
  }, true);
}

/** Twinkling stars and one faint constellation, like the card back.
    Throttled to ~30 fps; still when the viewer prefers reduced motion. */
function startSky() {
  const cv = $("stars"), ctx = cv.getContext("2d"), still = reduceMotion();
  const CONSTELLATION = [[0.62, 0.10], [0.74, 0.20], [0.80, 0.32], [0.77, 0.42], [0.88, 0.40], [0.84, 0.62], [0.80, 0.88]];
  let W, H, stars = [], points = [], last = 0;
  function setup() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    stars = Array.from({ length: Math.round((W * H) / 2600) }, () => {
      const big = Math.random() < 0.06;
      return { x: Math.random() * W, y: Math.random() * H, r: big ? 1.2 + Math.random() * 1.1 : 0.3 + Math.random() * 0.8,
               a: 0.35 + Math.random() * 0.65, p: Math.random() * 6.28, s: 0.4 + Math.random() * 1.4, big };
    });
    points = CONSTELLATION.map(([x, y]) => [x * W, y * H]);
  }
  function draw(t) {
    if (!still) { requestAnimationFrame(draw); if (t - last < 33) return; last = t; }
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = 1; ctx.strokeStyle = "rgba(190,205,255,.22)"; ctx.lineWidth = 1;
    ctx.beginPath(); points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    for (const s of stars) {
      const a = still ? s.a : s.a * (0.55 + 0.45 * Math.sin((t / 1000) * s.s + s.p));
      ctx.globalAlpha = a; ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.28); ctx.fill();
      if (s.big) { ctx.globalAlpha = a * 0.35; ctx.fillStyle = "#9fd4ff"; ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 3.2, 0, 6.28); ctx.fill(); }
    }
    ctx.globalAlpha = 0.9;
    for (const [x, y] of points) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, 10);
      g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.25, "rgba(200,225,255,.6)"); g.addColorStop(1, "rgba(160,190,255,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 10, 0, 6.28); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  setup();
  addEventListener("resize", () => { setup(); if (still) draw(0); });
  still ? draw(0) : requestAnimationFrame(draw);
}

/* ---------- start ---------- */
buildFilterControls();
bindFilterEvents();
bindDeckEvents();
bindModalEvents();
bindTemplateEvents();
bindCardClicks();
bindShellEvents();
applyFilterLayout();
renderSlotSelect();
renderDeck();
setRulesLang(UI.rlang);
setView(UI.view);
setTab(location.hash.length > 1 ? location.hash.slice(1) : "home");   // opening the site without a #tab shows the Home page
startSky();
