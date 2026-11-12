/* ==========================================================================
   Aquarian Age Helper · v4 game table (requirements_v4 §20.9 B7) · app, rooms, transports

   table.html is a page of its own next to the site (the v3.36 table in index.html stays live until v4
   matches it, Q#15). It reads the same Deck Builder slots (localStorage "aa-decks"), card data (data.js)
   and the compiled rule database (rules.js), and draws ONLY the engine's projection (§20.1):
     UI (t2-render.js, t3-input.js) → intents → transport → GameLog (engine) → state → AA4.project → UI
   Transports only store and replay the list of intents:
     Solo        this browser (saved, so a reload continues the game)
     Test room   TEST-xxxx: two tabs of this browser (BroadcastChannel + localStorage)
     Online      Firebase Realtime Database rooms/<code>/log (codes start with "4" so v3 tables never open them)
   Every entry has an id; entries are kept sorted by id, so every device replays them in the same order.
   Undo / Redo name their target by id (ofId) — turned into a log index when replayed.
   ========================================================================== */
(function () {
  "use strict";
  const TB = (window.TB = window.TB || {});
  const store = TB.store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* */ } },
  };
  TB.$ = id => document.getElementById(id);
  TB.esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // entry ids sort in time order; the counter keeps two entries of one device sent in the same millisecond in order
  let idSeq = 0, idLast = 0;
  const newId = () => { const t = Date.now(); idSeq = t === idLast ? idSeq + 1 : 0; idLast = t; return t.toString(36).padStart(9, "0") + idSeq.toString(36).padStart(3, "0") + Math.random().toString(36).slice(2, 7); };
  const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const newCode = n => Array.from({ length: n }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
  TB.toast = msg => { const t = TB.$("toast"); if (!t) return; t.textContent = msg; t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => (t.hidden = true), 2200); };

  /* ---------- card data ---------- */
  TB.db = AA4.dbFromSiteData(window.AA_DATA, window.AA_RULES);
  const CATS = ["Character", "Break", "Fast", "Project", "Permanent"];
  /** Deck Builder slots → [{i, name, keys, sleeve}] (same storage as the Deck Builder: aa-decks / aa-slot). */
  TB.deckSlots = () => {
    const saved = store.get("aa-decks", null) || [store.get("aa-deck", null)];
    return Array.from({ length: 50 }, (_, i) => {   // Revise#397: 50 slots (5 pages of 10)
      const d = saved[i];
      if (!d || !d.cols) return { i, name: `Slot ${i + 1} (empty)`, keys: [], sleeve: null };
      const keys = CATS.flatMap(c => (d.cols[c] || []).flatMap(e => (e && e.n > 0 && TB.db.card(e.k) ? Array(e.n).fill(TB.db.card(e.k).key) : [])));
      return { i, name: d.name || `Deck ${i + 1}`, keys, sleeve: d.sleeve || null };
    });
  };
  /** Card size (Pack, Revise#153): a bar of 6 levels — Lv 1 = the old S, Lv 4 = the old M, Lv 6 = the old L, the others in proportion */
  TB.SIZE_CW = [66, 88, 110, 132, 185, 238];
  /** Pack (Revise#207): how many times a character has a flag skill — Initiative by its count; any other flag skill once for the card plus once per effect that gives it */
  TB.skillTimes = (st, printed, k, v) => {
    if (!st || typeof v === "number" || (v && typeof v === "object")) return 1;
    if (k === "initiative" && st.initCount > 1) return st.initCount;
    const gained = (st.parts || []).filter(x => x.key === "skill" && x.n === k && x.op !== "remove").length;
    return Math.max(1, (printed && printed[k] != null ? 1 : 0) + gained);
  };
  TB.sizeLv = v => Math.min(6, Math.max(1, Math.round(+v) || 1));
  TB.sizeClass = lv => (lv <= 3 ? "S" : lv <= 5 ? "M" : "L");   // the CSS / image rules of the old S / M / L
  TB.applySize = lv => { document.body.dataset.size = TB.sizeClass(lv); document.body.dataset.lv = lv; document.body.style.setProperty("--cw", TB.SIZE_CW[lv - 1] + "px"); document.body.style.setProperty("--cwb", TB.SIZE_CW[lv - 1] + "px"); };   // --cwb: the base for Control · Back (Revise#206)
  TB.sleeveStyle = sl => {
    const img = sl && sl.img ? sl.img : "sleeve.jpg", z = (sl && sl.zoom) || 100, x = sl && sl.x != null ? sl.x : 50, y = sl && sl.y != null ? sl.y : 50;
    return `background-image:url('${img}');background-size:${z}% auto;background-position:${x}% ${y}%`;
  };
  // Revise#398: pictures site first (assets/img-config.js), Google Drive when a picture is missing there
  TB.IMG_BASE = String(window.AA_IMG_BASE || "").replace(/\/+$/, "");
  TB.img = (fid, w) => (!fid ? "" : TB.IMG_BASE ? `${TB.IMG_BASE}/${w > 500 ? "l" : "s"}/${fid}.webp` : `https://drive.google.com/thumbnail?id=${fid}&sz=w${w}`);
  TB.img2 = (fid, w) => (!fid ? "" : TB.IMG_BASE ? `https://drive.google.com/thumbnail?id=${fid}&sz=w${w}` : `https://lh3.googleusercontent.com/d/${fid}=w${w}`);

  /* ---------- UI state ---------- */
  TB.ui = {
    opts: Object.assign({ payOnPick: false, pickMax: false, exceedDraw: false }, TB.store ? TB.store.get("aa4-opts", {}) : {}),   // Player options on this device (Revise#099)
    room: "", kind: "", cid: "", transport: null, entries: [], log: null, ready: false, error: "",
    view: null,          // seat the table is drawn for (Solo two-deck: the side that acts, or chosen)
    viewLock: false,     // Solo two-deck: true when the player picked a side by hand
    sel: null,           // a selection in progress: {kind: "pay"|"target"|"charge"|"trig", …}
    menu: null, modal: null,
    payZ: ["S", "M", "L"].includes(store.get("aa4-payz", "L")) ? store.get("aa4-payz", "L") : "L", backZ: ["S", "M", "L"].includes(store.get("aa4-backz", "L")) ? store.get("aa4-backz", "L") : "L", size: TB.sizeLv(store.get("aa4-size3", store.get("aa4-size2", null) ? ({ S: 1, M: 4, L: 6 }[store.get("aa4-size2", "S")] || 4) : 4))   /* default Lv4 (Pack, Revise#304) */, payFold: store.get("aa4-payfold", false), logOpen: store.get("aa4-log", true), handFold: store.get("aa4-handfold", false), handDock: !!store.get("aa4-handdock", false), handZ: ["S", "M", "L"].includes(store.get("aa4-handz", "L")) ? store.get("aa4-handz", "L") : "L", handBig: store.get("aa4-handbig", false), chargeFold: store.get("aa4-chargefold", true),
    colors: store.get("aa4-colors", { me: "#9cc8ff", opp: "#ff9fae", seats: {} }),
    name: store.get("aa-pname", "") || "Player",
  };
  const ui = TB.ui;

  /* ---------- transports ---------- */
  function localTransport(room, onEntry, onReady) {
    const key = "aa4-room-" + room, bc = "BroadcastChannel" in window ? new BroadcastChannel(key) : null;
    for (const e of store.get(key, [])) onEntry(e);
    if (bc) bc.onmessage = m => onEntry(m.data);
    const onStorage = ev => { if (ev.key === key) for (const e of store.get(key, [])) onEntry(e); };
    addEventListener("storage", onStorage);
    setTimeout(onReady, 0);
    return {
      send(e) { e = Object.assign({ id: newId() }, e); store.set(key, store.get(key, []).concat([e])); onEntry(e); if (bc) bc.postMessage(e); },
      close() { if (bc) bc.close(); removeEventListener("storage", onStorage); },
    };
  }
  const FIREBASE_SDK = ["https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js", "https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js"];
  function loadFirebase() {
    if (window.firebase && window.firebase.database) return Promise.resolve();
    return FIREBASE_SDK.reduce((p, src) => p.then(() => new Promise((res, rej) => {
      const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Could not load Firebase")); document.head.appendChild(s);
    })), Promise.resolve());
  }
  async function firebaseTransport(room, onEntry, onReady) {
    await loadFirebase();
    if (!firebase.apps.length) firebase.initializeApp(window.AA_FIREBASE);
    const ref = firebase.database().ref(`rooms/${room}/log`);
    ref.on("child_added", snap => onEntry(Object.assign({}, snap.val(), { id: snap.key })));
    // ready only after TB.enter has stored this transport (a fast answer used to run "create" before it was there — lost silently)
    ref.once("value").then(() => setTimeout(() => onReady(), 0), err => setTimeout(() => onReady(err || new Error("no access")), 0));
    // The database rules (published from the v3 Play Online tab) accept an entry only with string fields "t" and "cid":
    // v4 names the player "by", so "cid" is sent too (Pack: rooms never reached the database before this)
    const send = e => {
      const entry = JSON.parse(JSON.stringify(Object.assign({ cid: String(e.by || ui.cid || "") }, e)));
      ref.push(entry).catch(err => { ui.netError = "Not saved in the online room: " + (err && (err.code || err.message) || err) + ". Check the Realtime Database rules (Play Online tab → set-up)."; TB.render(); });
    };
    return { send, close: () => ref.off() };
  }
  TB.onlineReady = () => !!(window.AA_FIREBASE && window.AA_FIREBASE.databaseURL);
  /* Solo games into the log (Pack, Revise#309): a Solo game that ends is copied once to the online database as
     rooms/SOLO-xxxx (two decks) or rooms/SOLOBOT-xxxx (vs Bot, seat 2 = the bot), so "Download rooms (for the bot)"
     includes it and tools/bot_learn.js learns from its winner. The entries get push keys in their order (undo / redo
     links follow them); nothing is sent for an unfinished game, and each game is sent only once. */
  TB.keepSolo = () => {
    if (ui.kind !== "solo" || !ui.log || ui.log.state.stage !== "over" || !TB.onlineReady() || ui.entries.length < 10) return;
    const sent = store.get("aa4-solo-sent", []);
    if (sent.includes(ui.room)) return;
    store.set("aa4-solo-sent", sent.concat([ui.room]).slice(-50));
    const bot = store.get("aa4-bot", null), code = (bot && bot.room === ui.room ? (bot.seats ? "SOLOBVB-" : "SOLOBOT-") : "SOLO-") + ui.room.replace(/^SOLO-/, "");   // SOLOBVB: Bot vs Bot (Revise#311)
    loadFirebase().then(() => {
      if (!firebase.apps.length) firebase.initializeApp(window.AA_FIREBASE);
      const ref = firebase.database().ref(`rooms/${code}/log`), keyOf = new Map(), out = {};
      for (const e of ui.entries) keyOf.set(e.id, ref.push().key);
      for (const e of ui.entries) {
        const x = JSON.parse(JSON.stringify(Object.assign({ cid: String(e.by || "solo") }, e)));
        delete x.id; if (x.ofId) x.ofId = keyOf.get(x.ofId) || x.ofId;
        out[keyOf.get(e.id)] = x;
      }
      // update, not set (Pack: "the Solo log does not show in my admin page", Revise#333): the database rules allow adding one entry at a time
      // (rooms/<code>/log/<entry>), as online rooms do; set() on the whole log needs a rule on /log and was refused without a visible message
      return ref.update(out);
    }).then(() => TB.toast("This Solo game was saved to the game log (for the bot to learn from)"),
      err => { store.set("aa4-solo-sent", store.get("aa4-solo-sent", []).filter(r => r !== ui.room)); console.warn("keepSolo", err); TB.toast("This Solo game could not be saved to the game log: " + String(err && err.message || err).slice(0, 80)); });
  };

  /* ---------- the log ---------- */
  /** Entry (as stored) → intent for the engine (undo / redo: id → index). */
  function toIntent(e, index) {
    const it = Object.assign({}, e);
    if (["undo", "redo", "undoOk", "undoNo"].includes(it.t) && it.ofId) it.of = index.has(it.ofId) ? index.get(it.ofId) : -1;
    return it;
  }
  function rebuild() {
    const index = new Map(ui.entries.map((e, i) => [e.id, i]));
    ui.log = AA4.GameLog.from(TB.db, ui.entries.map(e => toIntent(e, index)));
  }
  let queued = false;
  function onEntry(e) {
    if (ui.replay && ui.replay.live) {   // a live game goes on while its replay is shown: keep its entries for later
      const L = ui.replay.live.entries;
      if (!e || !e.id || L.some(x => x.id === e.id)) return;
      let k = L.length; while (k > 0 && L[k - 1].id > e.id) k--; L.splice(k, 0, e);
      return;
    }
    if (!e || !e.id || ui.entries.some(x => x.id === e.id)) return;
    let i = ui.entries.length;
    while (i > 0 && ui.entries[i - 1].id > e.id) i--;
    ui.entries.splice(i, 0, e);
    if (!ui.log || i !== ui.entries.length - 1) rebuild();
    else {
      const index = new Map(ui.entries.map((x, k) => [x.id, k]));
      const r = ui.log.push(toIntent(e, index));
      if (!r.ok && e.by === ui.cid && !["undo", "redo", "undoOk", "undoNo"].includes(e.t)) TB.toast(r.reason);
    }
    if (ui.kind === "solo") store.set("aa4-solo", { room: ui.room, at: Date.now() });   // the entries themselves are in aa4-room-SOLO
    if (ui.kind === "solo" && ui.log.state.stage === "over") setTimeout(() => TB.keepSolo(), 0);   // Revise#309
    if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; TB.render(); }); }
  }
  /** Send an intent (from this player). The engine is asked first, so a refusal shows its reason at once. */
  /* ---------- Replay (Pack, Revise#160) ----------
     The log is a list of player actions: a replay builds the table again from the first action, one action at a
     time (1 s per action at 1×, 0.5× – 3×). It only reads — nothing is sent. A live game keeps running meanwhile. */
  const rp = { timer: 0 };
  const RP_SKIP = new Set(["chat", "watch"]);   // shown at once, no wait
  function rpBuild(i) {
    const R0 = ui.replay, index = new Map(R0.all.map((e, k) => [e.id, k]));
    ui.entries = R0.all.slice(0, i);
    ui.log = AA4.GameLog.from(TB.db, ui.entries.map(e => toIntent(e, index)));
    R0.i = i;
  }
  function rpStep() {
    const R0 = ui.replay; if (!R0 || R0.i >= R0.all.length) return false;
    const index = new Map(R0.all.map((e, k) => [e.id, k]));
    const e = R0.all[R0.i];
    ui.entries = ui.entries.concat([e]);
    ui.log.push(toIntent(e, index));
    R0.i++;
    return true;
  }
  function rpSchedule() {
    clearTimeout(rp.timer);
    const R0 = ui.replay; if (!R0 || !R0.playing) return;
    if (R0.i >= R0.all.length) { R0.playing = false; TB.render(); return; }
    const next = R0.all[R0.i], wait = RP_SKIP.has(next.t) ? 0 : 1000 / (R0.speed || 1);
    rp.timer = setTimeout(() => { if (!ui.replay || !ui.replay.playing) return; rpStep(); TB.render(); rpSchedule(); }, wait);
  }
  TB.replayStart = (entries, opts = {}) => {
    clearTimeout(rp.timer);
    const live = opts.fromFile ? null : { room: ui.room, kind: ui.kind, cid: ui.cid, entries: ui.entries, transport: ui.transport };
    const S0 = ui.log && ui.log.state, mine = opts.fromFile ? [] : TB.mySeats();
    const allowAll = !!opts.fromFile || ui.kind === "solo" || !!(S0 && S0.stage === "over");
    if (live && ui.transport && ui.kind !== "solo") { /* the live room keeps receiving into live.entries */ }
    Object.assign(ui, { room: "REPLAY", kind: "replay", cid: "__replay__", transport: null, ready: true, sel: null, menu: null, modal: null, view: null, viewLock: false });
    ui.replay = { all: entries.slice(), i: 0, speed: opts.speed || 1, playing: false, live, allowAll, seats: allowAll ? null : mine, view: allowAll ? (mine.length ? mine[0] : 0) : (mine[0] != null ? mine[0] : 0), logOpen: false, name: opts.name || "" };
    // start where the table is set (players seated, the game started): the steps before only open the room
    let k0 = 0; { const L = AA4.GameLog.from(TB.db, []), index = new Map(entries.map((e, k) => [e.id, k])); while (k0 < entries.length && (L.state.stage === "lobby" || !L.state.players.length)) { L.push(toIntent(entries[k0], index)); k0++; } }
    ui.replay.first = k0 >= entries.length ? 0 : k0;
    rpBuild(ui.replay.first);
    TB.render();
  };
  TB.replay = {
    play: () => { const R0 = ui.replay; if (!R0) return; if (R0.i >= R0.all.length) rpBuild(R0.first || 0); R0.playing = true; TB.render(); rpSchedule(); },
    pause: () => { if (!ui.replay) return; ui.replay.playing = false; clearTimeout(rp.timer); TB.render(); },
    step: d => { const R0 = ui.replay; if (!R0) return; R0.playing = false; clearTimeout(rp.timer); if (d > 0) { do { if (!rpStep()) break; } while (R0.i < R0.all.length && RP_SKIP.has(R0.all[R0.i - 1].t)); } else { let k = R0.i - 1; while (k > 0 && RP_SKIP.has(R0.all[k - 1].t)) k--; rpBuild(Math.max(R0.first || 0, k)); } TB.render(); },
    seek: i => { const R0 = ui.replay; if (!R0) return; R0.playing = false; clearTimeout(rp.timer); rpBuild(Math.max(R0.first || 0, Math.min(R0.all.length, i | 0))); TB.render(); },
    speed: v => { if (!ui.replay) return; ui.replay.speed = v; if (ui.replay.playing) rpSchedule(); TB.render(); },
    view: v => { if (!ui.replay) return; ui.replay.view = v === "all" ? "all" : +v; TB.render(); },
    log: () => { if (!ui.replay) return; ui.replay.logOpen = !ui.replay.logOpen; TB.render(); },
    close: () => {
      const R0 = ui.replay; if (!R0) return;
      clearTimeout(rp.timer); ui.replay = null;
      if (!R0.live) { TB.leave(); return; }
      const L = R0.live;
      Object.assign(ui, { room: L.room, kind: L.kind, cid: L.cid, entries: L.entries, transport: L.transport, ready: true, sel: null, menu: null, modal: null });
      rebuild(); TB.render();
    },
  };
  /** Save replay (.json): every action of this game, from the start — it holds the hidden cards, so share it after the game. */
  TB.replayFile = () => {
    const S = ui.log && ui.log.state, d = new Date(), pad = n => String(n).padStart(2, "0");
    const data = { kind: "aa4-replay", v: 1, exported: d.toISOString(), room: ui.room, players: S ? S.players.map(p => p.name) : [], entries: ui.entries };
    const name = `aa-replay-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" })), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    TB.toast("Replay saved — " + name);
  };
  TB.replayOpenFile = file => {
    const fr = new FileReader();
    fr.onload = () => {
      try { const d = JSON.parse(fr.result); if (!d || d.kind !== "aa4-replay" || !Array.isArray(d.entries)) throw new Error("not a replay file"); TB.leave(true); TB.replayStart(d.entries, { fromFile: true, name: file.name }); }
      catch (err) { TB.toast("Could not open it: " + (err.message || err)); }
    };
    fr.readAsText(file);
  };
  TB.send = (it, quiet) => {
    if (ui.replay) { if (!quiet) TB.toast("Replay — watching only"); return false; }
    if (!ui.transport) { if (!quiet) TB.toast("Not connected to the room yet — try again in a moment"); return false; }
    const intent = Object.assign({ by: ui.cid, ts: Date.now() }, it);
    if (!["undo", "redo", "undoOk", "undoNo", "create", "join", "watch"].includes(intent.t)) {
      const why = AA4.check(ui.log.state, intent, TB.db);
      if (why) { if (!quiet) TB.toast(why); return false; }
    }
    ui.sel = null; ui.menu = null;
    ui.transport.send(JSON.parse(JSON.stringify(intent)));
    return true;
  };
  TB.undo = () => { if (ui.replay) return; TB.undo0(); };
  TB.undo0 = () => { const k = ui.log.undoTarget(ui.cid); if (k >= 0) ui.transport.send({ t: "undo", by: ui.cid, ofId: ui.entries[k].id }); };
  /** Agree to / refuse the undo another player asked for (Pack, Revise#112). */
  TB.undoAnswer = yes => { if (ui.replay) return; TB.undoAnswer0(yes); };
  TB.undoAnswer0 = yes => { const p = ui.log.pendingUndo; if (p) ui.transport.send({ t: yes ? "undoOk" : "undoNo", by: ui.cid, ofId: ui.entries[p.at].id }); };
  TB.redo = () => { if (ui.replay) return; TB.redo0(); };
  TB.redo0 = () => { const k = ui.log.redoTarget(ui.cid); if (k >= 0) ui.transport.send({ t: "redo", by: ui.cid, ofId: ui.entries[k].id }); };

  /* ---------- rooms ---------- */
  /** Player id for a room: one per browser TAB (sessionStorage), so two tabs can play each other; a reload keeps it. */
  const memIds = {};
  function clientId(room) {
    let ids = {};
    try { ids = JSON.parse(sessionStorage.getItem("aa4-cid") || "{}"); } catch (e) { ids = memIds; }
    if (!ids[room]) { ids[room] = "c" + newId(); try { sessionStorage.setItem("aa4-cid", JSON.stringify(ids)); } catch (e) { Object.assign(memIds, ids); } }
    return ids[room];
  }
  TB.enter = async (room, kind, after) => {
    TB.leave(true);
    Object.assign(ui, { room, kind, cid: kind === "solo" ? "solo" : clientId(room), entries: [], log: new AA4.GameLog(TB.db), ready: false, error: "", netError: "", sel: null, menu: null, modal: null, view: null, viewLock: false });
    if (kind !== "solo") history.replaceState(null, "", "#" + room);
    const ready = err => {
      if (err) { ui.error = "Could not open the online room: " + (err.code || err.message || String(err)) + ". Check the internet connection and the Realtime Database rules."; TB.leave(true); TB.render(); return; }
      ui.ready = true;
      if (after) after();
      TB.render();
    };
    try {
      ui.transport = kind === "online" ? await firebaseTransport(room, onEntry, ready) : localTransport(kind === "solo" ? "SOLO" : room, onEntry, ready);
    } catch (err) { ui.error = err.message + ". Check the internet connection, or use a test room."; TB.render(); }
    TB.render();
  };
  TB.leave = quiet => {
    if (ui.replay) { const R0 = ui.replay; ui.replay = null; if (R0.live && R0.live.transport) R0.live.transport.close(); }
    if (ui.transport) ui.transport.close();
    Object.assign(ui, { transport: null, room: "", kind: "", entries: [], log: null, sel: null, menu: null, modal: null });
    if (!quiet) { history.replaceState(null, "", location.pathname + location.search); TB.render(); }
  };

  /** Start a game from the lobby form. */
  /** A deck list as the Deck Builder exports it ("4 x A3-20 2783  name" lines) → {name, keys, sleeve}. */
  TB.parseDeckList = txt => {
    const keys = [], bad = [];
    let name = "Pasted deck";
    for (const line of String(txt || "").split(/\r?\n/)) {
      const nm = /^#\s*Deck:\s*(.+)/.exec(line); if (nm) { name = nm[1].trim(); continue; }
      const m = /^\s*(\d+)\s*x\s*(\S+)\s+(\S+)/i.exec(line);
      if (!m) continue;
      const c = TB.db.card(m[2] + " " + m[3]);
      if (c) for (let i = 0; i < +m[1]; i++) keys.push(c.key); else bad.push(m[2] + " " + m[3]);
    }
    return { i: -1, name, keys, sleeve: null, bad };
  };
  const deckOf = (opts, which) => (which === 1 && opts.pasted ? opts.pasted : TB.deckSlots()[which === 1 ? opts.slot : opts.slot2 == null ? opts.slot : opts.slot2] || { keys: [] });
  TB.start = opts => {
    const slots = TB.deckSlots(), d1 = opts.pasted || slots[opts.slot], name = (opts.name || "Player").slice(0, 20);
    void deckOf;
    if (opts.mode === "online") { ui.name = name; store.set("aa-pname", name); }   // Solo names (Player 1 / 2) are not saved as your name
    const rules = { mullMain: true, powerFaceUp: false, respond: opts.together ? "together" : "order", goSecond: !!opts.goSecond, firstSeat: opts.mode === "solo2" && !opts.coin ? (opts.goSecond ? 1 : 0) : null, autoSkip: !!opts.autoSkip, autoPay: !!opts.autoPay, situation: !!opts.situation, globalUndo: true };   // Global Undo/Redo ON by default (Pack, Revise#225)
    if (opts.mode === "solo1" || opts.mode === "solo2") {
      if (!d1.keys.length) return TB.toast("Choose a deck slot with cards in it");
      const d2 = opts.botDeck ? { name: opts.botDeck.name, keys: opts.botDeck.keys, sleeve: null } : slots[opts.slot2 == null ? opts.slot : opts.slot2];   // Campaign (Revise#379): the bot's deck comes from the campaign list
      if (opts.mode === "solo2" && !d2.keys.length) return TB.toast("Choose a second deck slot with cards in it");
      store.del("aa4-room-SOLO"); store.del("aa4-solo");
      const soloCode = "SOLO-" + newCode(4);
      if (opts.bots) store.set("aa4-bot", { room: soloCode, seats: [0, 1] });   // Bot vs Bot (Revise#311): both seats, you watch
      else if (opts.bot) store.set("aa4-bot", Object.assign({ room: soloCode, seat: 1 }, opts.style ? { style: opts.style } : {}, opts.campaign ? { campaign: opts.campaign } : {})); else store.del("aa4-bot");   // vs Bot (Revise#308): seat 2 is the computer
      TB.enter(soloCode, "solo", () => {
        TB.send({ t: "create", seed: AA4.newSeed(), mode: opts.mode, rules });
        TB.send({ t: "join", name, deckName: d1.name, deck: d1.keys, sleeve: d1.sleeve, avatar: TB.avatarValue(d1.keys) });
        if (opts.mode === "solo2") TB.send({ t: "join", name: (opts.name2 || "Player 2").slice(0, 20), deckName: d2.name, deck: d2.keys, sleeve: d2.sleeve, avatar: TB.myAvatarSel() === "auto" ? TB.autoAvatar(d2.keys) : AA4.AVATARS[(AA4.AVATARS.indexOf(TB.myAvatarSel()) + 1) % AA4.AVATARS.length] });
      });
      return;
    }
    const code = opts.test ? "TEST-" + newCode(4) : "4" + newCode(5);
    if (!opts.test && !TB.onlineReady()) return TB.toast("Online play needs the Firebase settings (assets/firebase-config.js) — use a test room");
    if (!d1.keys.length) return TB.toast("Choose a deck slot with cards in it");
    TB.enter(code, opts.test ? "test" : "online", () => {
      TB.send({ t: "create", seed: AA4.newSeed(), mode: "online", seats: opts.seats || 2, rules });
      TB.send({ t: "join", name, deckName: d1.name, deck: d1.keys, sleeve: d1.sleeve, avatar: TB.avatarValue(d1.keys) });
    });
  };
  /** Join a room by code (or watch when it is full / started). */
  TB.join = (code, opts) => {
    code = String(code || "").trim().toUpperCase();
    if (!code) return TB.toast("Type the room code");
    const slots = TB.deckSlots(), d = opts.pasted || slots[opts.slot] || { keys: [] }, name = (opts.name || "Player").slice(0, 20);
    ui.name = name; store.set("aa-pname", name);
    if (d.bad && d.bad.length) TB.toast(`${d.bad.length} card${d.bad.length === 1 ? "" : "s"} not found: ${d.bad.slice(0, 3).join(", ")}`);
    TB.enter(code, /^TEST-/.test(code) ? "test" : "online", () => {
      const S = ui.log.state;
      if (AA4.seatsOfCid(S, ui.cid).length || S.spectators[ui.cid]) return;
      if (!S.mode) { ui.error = `Room ${code} was not found (or is not open yet). Check the code.`; TB.leave(true); TB.render(); return; }
      const open = S.stage === "lobby" && S.players.length < S.seatsWanted;
      if (open && d.keys.length) { TB.send({ t: "join", name, deckName: d.name, deck: d.keys, sleeve: d.sleeve, avatar: TB.avatarValue(d.keys) }); return; }
      if (open && !d.keys.length) {   // Pack: joining from another device with no deck in the slot used to make you a silent spectator
        ui.error = "The deck you chose is empty on this device (decks are saved per device). Choose a deck, or paste a deck list, then join again.";
        TB.leave(true); TB.render(); return;
      }
      TB.send({ t: "watch", name }); TB.toast("The game has started or is full — you are watching");
    });
  };
  TB.resumeSolo = () => {
    const s = store.get("aa4-solo", null);
    if (!s) return;
    TB.enter(s.room, "solo");
  };

  /* ---------- who acts / which side is drawn ---------- */
  TB.mySeats = () => { const s = ui.log ? AA4.seatsOfCid(ui.log.state, ui.cid) : []; const b = TB.botSeats ? TB.botSeats() : []; return b.length && s.length > 1 ? s.filter(x => !b.includes(x)) : s; };   // vs Bot: the bot's seat is not yours; Bot vs Bot: you only watch
  /** The seat that has to act now (for Solo two-deck the view follows it). */
  TB.actingSeat = S => {
    if (S.decisions.length) return S.decisions[0].seat;
    if (S.draft) return S.draft.seat;
    if (S.triggers.length) return S.triggers[0].seat;
    if (S.stage === "mulligan") { const p = S.players.find(x => !x.ready); return p ? p.seat : 0; }
    if (S.battle && S.battle.step === "guard") return S.battle.defender;
    const now = AA4.priorityNow(S);
    return now != null ? now : S.turn.player;
  };
  TB.viewSeat = () => {
    if (ui.replay) return ui.replay.view === "all" || !ui.log.state.players[ui.replay.view] ? -1 : ui.replay.view;
    const S = ui.log.state, mine = TB.mySeats();
    if (!mine.length) return -1;   // spectator
    if (mine.length === 1) return mine[0];
    if (ui.viewLock && ui.view != null && mine.includes(ui.view)) return ui.view;
    const a = S.stage === "lobby" ? mine[0] : TB.actingSeat(S);
    return mine.includes(a) ? a : mine[0];
  };

  /* ---------- start-up ---------- */
  addEventListener("DOMContentLoaded", () => {
    const code = location.hash.slice(1).toUpperCase();
    if (/^(TEST-[A-Z0-9]{4}|4[A-Z0-9]{5})$/.test(code)) TB.join(code, { slot: store.get("aa4-slot", store.get("aa-slot", 0) | 0), name: ui.name });
    TB.render();
    // a watcher sees the Take control countdown (Revise#117): redraw once a second while it runs, if no menu / pop-up is open
    setInterval(() => {
      const S = ui.log && ui.log.state;
      if (!S || S.mode !== "online" || S.stage !== "play" || ui.menu || ui.modal || S.lastTs == null) return;
      const w = AA4.actingSeat(S); if (w == null || (S.players[w] && S.players[w].cid === ui.cid)) return;   // the countdown on another player's Take control button (Revise#128)
      if (Date.now() - S.lastTs < AA4.TAKE_AFTER + 1500) TB.render();
    }, 1000);
    // stuck log (Revise#128): once 30 s pass without any action, redraw so the ⚡ button appears beside the hand buttons
    setInterval(() => {
      const on = TB.stuckNow && TB.stuckNow();
      if (on !== !!ui.stuckShown) { ui.stuckShown = on; if (!ui.menu && !(ui.modal && ui.modal.form)) TB.render(); }
    }, 1000);
  });
})();
