/* ==========================================================================
   Card reports (Pack, Revise#295): a red "Report" button on card details (card list and game table).
   The player writes up to 250 characters (Thai / English / Japanese); the report is saved with the card's
   code, name, type and rules status (and, on the game table, the game situation) to the Firebase Realtime
   Database at reports/<id>. The Changelog page lists them and copies them as one plain-text block.
   Shared by the site (assets/app.js) and the game table (assets/table.js); build.py adds it to both.
   ========================================================================== */
(() => {
  "use strict";
  if (window.AAReport) return;
  const MAX = 250, SDK = ["https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js", "https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js"];
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const len = s => Array.from(String(s || "")).length;   // characters, not UTF-16 units (Thai, Japanese, emoji)
  const cut = s => Array.from(String(s || "")).slice(0, MAX).join("");
  const pad = n => String(n).padStart(2, "0");
  const when = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

  /* ---------- Firebase (loaded only when a report is sent or read) ---------- */
  let fbP = null;
  const loadScript = src => new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => no(new Error("Could not load " + src)); document.head.appendChild(s); });
  const db = () => {
    if (!(window.AA_FIREBASE && window.AA_FIREBASE.databaseURL)) return Promise.reject(new Error("Firebase is not set up (assets/firebase-config.js)"));
    if (!fbP) fbP = (window.firebase && window.firebase.database ? Promise.resolve() : SDK.reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve()))
      .then(() => { const fb = window.firebase; if (!fb.apps.length) fb.initializeApp(window.AA_FIREBASE); return fb.database(); })
      .catch(e => { fbP = null; throw e; });
    return fbP;
  };

  /* ---------- the text block for Claude (and for people) ---------- */
  const format = (r, i) => {
    const c = r.card || {}, g = r.game;
    const head = `#${i == null ? 1 : i} ${when(r.at || Date.now())} · v${r.ver || "?"} · ${r.page === "table" ? "Game Table" : "Card list"}`;
    const card = `card: ${c.key || "?"} · ${c.jp || ""}${c.en ? " / " + c.en : ""} · ${c.type || "?"}${c.status ? " · rules " + c.status : ""}`;
    const lines = [head, card, `problem: ${r.text || ""}`];
    if (g) lines.push(`game: ${[g.mode, g.turn != null ? "turn " + g.turn : "", g.phase, g.viewer, g.place, g.stats].filter(Boolean).join(" · ")}`);
    lines.push(`from: ${[r.lang, r.device].filter(Boolean).join(" · ")}`);
    return lines.join("\n");
  };
  const formatAll = list => `AQUARIAN AGE CARD REPORTS — ${list.length} report${list.length === 1 ? "" : "s"}, exported ${when(Date.now())}\n` +
    "Each report: when · site version · screen / card: code · Japanese / English name · type · rules status / problem (player's words) / game situation / language · device\n\n" +
    list.map((r, i) => format(r, i + 1)).join("\n\n");

  /* ---------- UI ---------- */
  const CSS = `
.aarp-scrim{position:fixed;inset:0;z-index:2000;background:rgba(2,3,20,.6);display:grid;place-items:center;padding:16px}
.aarp{width:min(460px,100%);max-height:calc(100dvh - 32px);overflow:auto;background:#121a6e;color:#eef2ff;border:1px solid rgba(140,206,255,.55);border-radius:14px;padding:16px;box-shadow:0 20px 60px rgba(0,0,20,.7);font:15px/1.5 system-ui,-apple-system,"Segoe UI","Noto Sans Thai","Noto Sans JP","Hiragino Sans",sans-serif}
.aarp h3{margin:0 0 4px;font-size:17px}.aarp .aarp-card{font-size:13px;opacity:.85;margin-bottom:10px;overflow-wrap:anywhere}
.aarp textarea{width:100%;box-sizing:border-box;min-height:120px;resize:vertical;border-radius:10px;border:1px solid rgba(140,206,255,.55);background:rgba(6,8,40,.75);color:#fff;padding:10px;font:16px/1.5 system-ui,-apple-system,"Segoe UI","Noto Sans Thai","Noto Sans JP","Hiragino Sans",sans-serif}
.aarp .aarp-n{text-align:right;font-size:12px;opacity:.75;margin:4px 0 10px}.aarp .aarp-n.full{color:#ff9aa8;opacity:1}
.aarp .aarp-row{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
.aarp button{font:700 14px system-ui,sans-serif;border-radius:10px;padding:9px 16px;border:1px solid rgba(140,206,255,.55);background:rgba(82,182,255,.12);color:#eef2ff;cursor:pointer}
.aarp button.aarp-send{background:#d92a3f;border-color:#ff6b7c;color:#fff}.aarp button:disabled{opacity:.45;cursor:default}
.aarp .aarp-msg{font-size:13px;margin:8px 0;white-space:pre-wrap}.aarp .aarp-msg.err{color:#ffb3bd}
.aarp pre{white-space:pre-wrap;word-break:break-word;font:12px/1.45 ui-monospace,Menlo,monospace;background:rgba(0,0,0,.3);border:1px solid rgba(140,206,255,.3);border-radius:8px;padding:10px;max-height:50vh;overflow:auto}
.aarp-btn{position:fixed;right:max(16px,env(safe-area-inset-right,0px));bottom:max(16px,env(safe-area-inset-bottom,0px));z-index:30;display:inline-flex;align-items:center;gap:6px;background:#d92a3f;color:#fff;border:1px solid #ff6b7c;border-radius:999px;padding:9px 16px;font:700 14px system-ui,sans-serif;box-shadow:0 6px 18px rgba(0,0,20,.55);cursor:pointer}
.aarp-btn:active{scale:.96}
.aarp.aarp-wide{width:min(720px,100%)}.aarp-lh{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}.aarp-who{font-size:12px;opacity:.85;margin-left:auto}.aarp-who a{color:#9fd4ff}
.aarp-it{display:flex;gap:8px;align-items:flex-start;margin:6px 0;cursor:pointer}.aarp-it input{margin-top:12px;width:18px;height:18px;flex:none}.aarp-it pre{flex:1;margin:0;max-height:none}.aarp-it.on pre{border-color:#ff8a98;background:rgba(217,42,63,.12)}
.aarp-rm span{font-size:13px;line-height:1.5;padding-top:8px}.aarp-idle{display:inline-flex;align-items:center;gap:6px;font-size:13px;margin-right:auto}.aarp-idle input{width:64px;font:15px system-ui;padding:6px;border-radius:8px;border:1px solid rgba(140,206,255,.55);background:rgba(6,8,40,.75);color:#fff}
.aarp-bar{position:sticky;bottom:-16px;background:#121a6e;padding:10px 0 4px;margin-top:6px}
@media (hover:hover){.aarp-btn:hover{background:#ef3a50}}`;
  const style = () => { if (document.getElementById("aarpCss")) return; const s = document.createElement("style"); s.id = "aarpCss"; s.textContent = CSS; document.head.appendChild(s); };
  const box = html => { style(); const w = document.createElement("div"); w.className = "aarp-scrim"; w.innerHTML = `<div class="aarp" role="dialog" aria-modal="true">${html}</div>`; document.body.appendChild(w); const close = () => w.remove(); w.addEventListener("click", e => { if (e.target === w) close(); }); const k = e => { if (e.key === "Escape") { close(); removeEventListener("keydown", k, true); e.stopPropagation(); } }; addEventListener("keydown", k, true); return { w, el: w.firstChild, close }; };
  const copy = t => (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(t) : Promise.reject()).catch(() => { const a = document.createElement("textarea"); a.value = t; document.body.appendChild(a); a.select(); try { document.execCommand("copy"); } catch (e) {} a.remove(); });

  /** The red button's HTML (the page adds it to its card details). */
  const buttonHTML = (attrs = "") => (style(), `<button type="button" class="aarp-btn" ${attrs} title="Report a problem with this card">⚑ Report</button>`);

  /** Open the report form. info = {page: "cards"|"table", card: {key, jp, en, type, status}, game?: {...}} */
  const open = info => {
    const c = info.card || {};
    const b = box(`<h3>⚑ Report a problem</h3><div class="aarp-card">${esc(c.key || "")} · ${esc(c.jp || "")}${c.en ? " / " + esc(c.en) : ""}</div>
      <label for="aarpT" style="font-size:13px">What went wrong? (ไทย / English / 日本語, up to ${MAX} characters)</label>
      <textarea id="aarpT" maxlength="${MAX * 2}" lang="" placeholder="e.g. Its ability did not happen when I set a Break card on it."></textarea>
      <div class="aarp-n" id="aarpN">0 / ${MAX}</div><div class="aarp-msg" id="aarpM"></div>
      <div class="aarp-row"><button type="button" id="aarpC">Cancel</button><button type="button" class="aarp-send" id="aarpS" disabled>Send report</button></div>`);
    const t = b.el.querySelector("#aarpT"), n = b.el.querySelector("#aarpN"), s = b.el.querySelector("#aarpS"), msg = b.el.querySelector("#aarpM");
    const upd = () => { if (len(t.value) > MAX && !t._comp) { const p = t.selectionStart; t.value = cut(t.value); try { t.setSelectionRange(Math.min(p, t.value.length), Math.min(p, t.value.length)); } catch (e) {} } const k = len(t.value); n.textContent = `${k} / ${MAX}`; n.classList.toggle("full", k >= MAX); s.disabled = !t.value.trim(); };
    t.addEventListener("compositionstart", () => { t._comp = true; }); t.addEventListener("compositionend", () => { t._comp = false; upd(); });   // Japanese / Thai input methods
    t.addEventListener("input", upd);
    b.el.querySelector("#aarpC").onclick = b.close;
    s.onclick = () => {
      const r = { v: 1, at: Date.now(), ver: window.AA_SITE_VER || "", page: info.page || "cards", card: { key: c.key || "", jp: c.jp || "", en: c.en || "", type: c.type || "", status: c.status || "" }, text: cut(t.value.trim()), lang: navigator.language || "", device: `${innerWidth}×${innerHeight} ${/iPhone|iPad|Android/.exec(navigator.userAgent) ? /iPhone|iPad|Android/.exec(navigator.userAgent)[0] : "desktop"}` };
      if (info.game) r.game = info.game;
      s.disabled = true; msg.className = "aarp-msg"; msg.textContent = "Sending…";
      db().then(d => d.ref("reports").push(r)).then(() => {
        msg.textContent = "Thank you — the report was sent.";
        b.el.querySelector(".aarp-row").innerHTML = `<button type="button" id="aarpOk">Close</button>`; b.el.querySelector("#aarpOk").onclick = b.close;
      }).catch(e => {
        const txt = format(r);
        msg.className = "aarp-msg err"; msg.textContent = "Could not send it (" + (e && (e.code || e.message) || e) + "). Copy it and send it to the site owner instead:";
        msg.insertAdjacentHTML("afterend", `<pre>${esc(txt)}</pre>`);
        b.el.querySelector(".aarp-row").innerHTML = `<button type="button" id="aarpCp">Copy report</button><button type="button" id="aarpOk">Close</button>`;
        b.el.querySelector("#aarpCp").onclick = () => copy(txt).then(() => { b.el.querySelector("#aarpCp").textContent = "Copied ✓"; });
        b.el.querySelector("#aarpOk").onclick = b.close;
      });
    };
    setTimeout(() => t.focus(), 50);
  };

  /* ---------- the owner's report manager (Pack, Revise#298): see, pick, copy, delete ---------- */
  const AUTH_SDK = "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js";
  let authP = null;
  const auth = () => (authP = authP || db().then(() => (window.firebase.auth ? null : loadScript(AUTH_SDK))).then(() => window.firebase.auth()).catch(e => { authP = null; throw e; }));
  const list = () => {
    style();
    const b = box(`<div class="aarp-lh"><h3>Card reports</h3><span class="aarp-who" id="aarpWho"></span></div><div class="aarp-msg" id="aarpM">Loading…</div><div id="aarpL"></div><div class="aarp-row aarp-bar" id="aarpBar"></div>`);
    b.el.classList.add("aarp-wide");
    const msg = b.el.querySelector("#aarpM"), L = b.el.querySelector("#aarpL"), bar = b.el.querySelector("#aarpBar"), who = b.el.querySelector("#aarpWho");
    let all = [], user = null, sel = new Set(), confirmDel = false, loaded = false;
    const picked = () => all.filter(r => sel.has(r.id));
    const render = () => {
      msg.className = "aarp-msg";
      const TK = window.AA_TICKETS || {}, fresh = all.filter(r => !TK[r.id]);
      msg.textContent = all.length ? `${all.length} report${all.length === 1 ? "" : "s"}, newest first — ${fresh.length} new (no ticket yet). Tick some to copy or delete just those.` : "No reports yet.";
      L.innerHTML = all.map((r, i) => `<label class="aarp-it${sel.has(r.id) ? " on" : ""}"><input type="checkbox" data-id="${esc(r.id)}"${sel.has(r.id) ? " checked" : ""}><pre>${TK[r.id] ? `[${esc(TK[r.id][0])} · ${esc(TK[r.id][1])}]` : "[NEW]"} ${esc(format(r, i + 1))}</pre></label>`).join("");
      const n = sel.size, owner = !!user;
      who.innerHTML = owner ? `${esc(user.email || "")} · <a href="#" id="aarpOut">sign out</a>` : `<a href="#" id="aarpIn">Owner sign-in (to delete)</a>`;
      bar.innerHTML = (all.length ? `<button type="button" id="aarpAll">${n === all.length ? "Untick all" : "Tick all"}</button><button type="button" id="aarpNew" title="Tick the reports that have no ticket yet">Tick new (${fresh.length})</button><button type="button" id="aarpOld" title="Tick the reports whose ticket is done or closed">Tick handled</button><button type="button" id="aarpCp">${n ? `Copy ${n} ticked` : "Copy all"}</button><button type="button" id="aarpJs">Download JSON</button>` : "")
        + (owner && all.length ? (confirmDel ? `<button type="button" class="aarp-send" id="aarpDelY">Yes, delete ${n || all.length}</button><button type="button" id="aarpDelN">Keep them</button>` : `<button type="button" class="aarp-send" id="aarpDel">${n ? `Delete ${n} ticked` : "Delete all"}</button>`) : "")
        + `<button type="button" id="aarpOk">Close</button>`;
      L.querySelectorAll("input[data-id]").forEach(x => (x.onchange = () => { if (x.checked) sel.add(x.dataset.id); else sel.delete(x.dataset.id); confirmDel = false; render(); }));
      const on = (id, f) => { const e = b.el.querySelector("#" + id); if (e) e.onclick = ev => { ev.preventDefault(); f(e); }; };
      on("aarpNew", () => { sel = new Set(fresh.map(r => r.id)); confirmDel = false; render(); });   // Revise#409
      on("aarpOld", () => { sel = new Set(all.filter(r => TK[r.id] && TK[r.id][1] !== "open").map(r => r.id)); confirmDel = false; render(); });
      on("aarpAll", () => { sel = sel.size === all.length ? new Set() : new Set(all.map(r => r.id)); confirmDel = false; render(); });
      on("aarpCp", e => { const l = picked().length ? picked() : all; copy(formatAll(l)).then(() => { e.textContent = "Copied ✓"; }); });
      on("aarpJs", () => { const l = picked().length ? picked() : all, a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(l, null, 1)], { type: "application/json" })); a.download = `aa-card-reports-${when(Date.now()).replace(/[: ]/g, "-")}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); });
      on("aarpDel", () => { confirmDel = true; render(); });
      on("aarpDelN", () => { confirmDel = false; render(); });
      on("aarpDelY", () => {
        const l = picked().length ? picked() : all.slice();
        msg.textContent = `Deleting ${l.length}…`;
        db().then(d => Promise.all(l.map(r => d.ref("reports/" + r.id).remove()))).then(() => { const gone = new Set(l.map(r => r.id)); all = all.filter(r => !gone.has(r.id)); sel = new Set(); confirmDel = false; render(); msg.textContent = `Deleted ${gone.size}. ` + msg.textContent; })
          .catch(e => { confirmDel = false; render(); msg.className = "aarp-msg err"; msg.textContent = "Could not delete: " + (e && (e.code || e.message) || e) + "\nThe Firebase rules must let your e-mail delete reports (docs, Revise#298)."; });
      });
      on("aarpIn", () => auth().then(a => a.signInWithPopup(new window.firebase.auth.GoogleAuthProvider())).catch(e => { msg.className = "aarp-msg err"; msg.textContent = "Sign-in failed: " + (e && (e.code || e.message) || e) + (e && e.code === "auth/unauthorized-domain" ? "\nAdd this site's domain in Firebase → Authentication → Settings → Authorized domains." : "") + (e && e.code === "auth/operation-not-allowed" ? "\nTurn on Google in Firebase → Authentication → Sign-in method." : ""); }));
      on("aarpOut", () => auth().then(a => a.signOut()));
      on("aarpOk", b.close);
    };
    if (window.AA_FIREBASE && window.AA_FIREBASE.databaseURL) auth().then(a => a.onAuthStateChanged(u => { user = u; if (loaded && document.body.contains(b.w)) render(); })).catch(() => {});
    db().then(d => d.ref("reports").limitToLast(500).once("value")).then(snap => {
      snap.forEach(ch => { all.push(Object.assign({ id: ch.key }, ch.val())); });
      all.sort((a, b2) => (b2.at || 0) - (a.at || 0));
      loaded = true; render();
    }).catch(e => { msg.className = "aarp-msg err"; msg.textContent = "Could not read the reports: " + (e && (e.code || e.message) || e) + "\nIn Firebase → Realtime Database → Rules, “reports” must allow read (see the docs, Revise#295)."; });
  };

  /* ---------- the owner's room cleaner (Pack, Revise#301): online game rooms are never cleared by themselves ---------- */
  const PUSH = "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";
  const keyTime = k => { let t = 0; for (let i = 0; i < 8 && k && i < k.length; i++) t = t * 64 + PUSH.indexOf(k[i]); return t > 0 ? t : 0; };   // a push key starts with its time
  const rooms = () => {
    style();
    const b = box(`<div class="aarp-lh"><h3>Online rooms</h3><span class="aarp-who" id="aarpWho"></span></div><div class="aarp-msg" id="aarpM">Sign in as the owner to see the rooms.</div><div id="aarpL"></div><div class="aarp-row aarp-bar" id="aarpBar"></div>`);
    b.el.classList.add("aarp-wide");
    const msg = b.el.querySelector("#aarpM"), L = b.el.querySelector("#aarpL"), bar = b.el.querySelector("#aarpBar"), who = b.el.querySelector("#aarpWho");
    let user = null, list = null, sel = new Set(), confirmDel = false, days = 30, busy = false;
    const base = () => String(window.AA_FIREBASE.databaseURL).replace(/\/$/, "");
    const rest = (path, q) => user.getIdToken().then(tok => fetch(`${base()}/${path}.json?${q ? q + "&" : ""}auth=${encodeURIComponent(tok)}`)).then(r => r.ok ? r.json() : r.text().then(t => { throw new Error(r.status + " " + t.slice(0, 120)); }));
    const load = () => {
      busy = true; msg.className = "aarp-msg"; msg.textContent = "Loading the rooms…"; render();
      rest("rooms", "shallow=true").then(top => {
        const codes = Object.keys(top || {});
        return Promise.all(codes.map(code => rest(`rooms/${code}/log`, "shallow=true").then(keys => { const ks = Object.keys(keys || {}).sort(); return { code, n: ks.length, first: keyTime(ks[0]), last: keyTime(ks[ks.length - 1]) }; }).catch(() => ({ code, n: 0, first: 0, last: 0 }))));
      }).then(rs => { list = rs.sort((a, b2) => (b2.last || 0) - (a.last || 0)); busy = false; render(); })
        .catch(e => { busy = false; list = null; render(); msg.className = "aarp-msg err"; msg.textContent = "Could not list the rooms: " + (e && e.message || e) + "\nThe Firebase rules must let your e-mail read “rooms” (docs, Revise#301)."; });
    };
    const idle = r => r.last ? Math.floor((Date.now() - r.last) / 86400000) : 9999;
    const render = () => {
      who.innerHTML = user ? `${esc(user.email || "")} · <a href="#" id="aarpOut">sign out</a>` : `<a href="#" id="aarpIn">Owner sign-in</a>`;
      if (list && !busy) {
        const moves = list.reduce((a, r) => a + r.n, 0);
        msg.className = "aarp-msg"; msg.textContent = `${list.length} room${list.length === 1 ? "" : "s"}, ${moves} moves saved in all (about ${(moves * 0.2 / 1024).toFixed(1)} MB). Most recently used first.`;
        L.innerHTML = list.map(r => `<label class="aarp-it aarp-rm${sel.has(r.code) ? " on" : ""}"><input type="checkbox" data-id="${esc(r.code)}"${sel.has(r.code) ? " checked" : ""}><span><b>${esc(r.code)}</b> · ${r.n} moves · last used ${r.last ? when(r.last) + ` (${idle(r)} day${idle(r) === 1 ? "" : "s"} ago)` : "unknown"}${r.first ? ` · started ${when(r.first)}` : ""}</span></label>`).join("");
      } else if (!list) L.innerHTML = "";
      const n = sel.size;
      bar.innerHTML = (user && list && list.length ? `<span class="aarp-idle">Idle for <input type="number" id="aarpD" min="0" value="${days}"> days or more</span><button type="button" id="aarpTick">Tick them</button><button type="button" id="aarpRAll">${sel.size === list.length ? "Untick all" : "Tick all"}</button>`
        + (n ? (confirmDel ? `<button type="button" class="aarp-send" id="aarpDelY">Yes, delete ${n} room${n === 1 ? "" : "s"}</button><button type="button" id="aarpDelN">Keep them</button>` : `<button type="button" class="aarp-send" id="aarpDel">Delete ${n} ticked</button>`) : "") : "")
        + (user && list && list.length ? `<button type="button" id="aarpDl" title="Every room with its moves, for the bot to learn from the winners (send the file to Claude)">Download rooms (for the bot)</button>` : "")
        + (user ? `<button type="button" id="aarpRe">Reload</button>` : "") + `<button type="button" id="aarpOk">Close</button>`;
      L.querySelectorAll("input[data-id]").forEach(x => (x.onchange = () => { if (x.checked) sel.add(x.dataset.id); else sel.delete(x.dataset.id); confirmDel = false; render(); }));
      const on = (id, f) => { const e = b.el.querySelector("#" + id); if (e) e.onclick = ev => { ev.preventDefault(); f(e); }; };
      const d = b.el.querySelector("#aarpD"); if (d) d.onchange = () => { days = Math.max(0, +d.value || 0); };
      on("aarpTick", () => { const dd = b.el.querySelector("#aarpD"); days = Math.max(0, +(dd && dd.value) || 0); sel = new Set(list.filter(r => idle(r) >= days).map(r => r.code)); confirmDel = false; render(); });
      on("aarpRAll", () => { sel = sel.size === list.length ? new Set() : new Set(list.map(r => r.code)); confirmDel = false; render(); });   // Revise#303
      on("aarpDel", () => { confirmDel = true; render(); });
      on("aarpDelN", () => { confirmDel = false; render(); });
      on("aarpDelY", () => {
        const codes = [...sel]; msg.textContent = `Deleting ${codes.length}…`;
        db().then(dbx => Promise.all(codes.map(c => dbx.ref("rooms/" + c).remove()))).then(() => { const gone = new Set(codes); list = list.filter(r => !gone.has(r.code)); sel = new Set(); confirmDel = false; render(); msg.textContent = `Deleted ${gone.size} room${gone.size === 1 ? "" : "s"}. ` + msg.textContent; })
          .catch(e => { confirmDel = false; render(); msg.className = "aarp-msg err"; msg.textContent = "Could not delete: " + (e && (e.code || e.message) || e) + "\nThe Firebase rules must let your e-mail delete rooms (docs, Revise#301)."; });
      });
      on("aarpRe", load);
      on("aarpDl", e => { e.textContent = "Downloading…"; rest("rooms").then(all => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(all || {})], { type: "application/json" })); a.download = `aa-rooms-${when(Date.now()).replace(/[: ]/g, "-")}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); e.textContent = "Downloaded ✓"; }).catch(x => { e.textContent = "Download failed"; msg.className = "aarp-msg err"; msg.textContent = "Could not download: " + (x && x.message || x); }); });   // Revise#308: for tools/bot_learn.js
      on("aarpIn", () => auth().then(a => a.signInWithPopup(new window.firebase.auth.GoogleAuthProvider())).catch(e => { msg.className = "aarp-msg err"; msg.textContent = "Sign-in failed: " + (e && (e.code || e.message) || e); }));
      on("aarpOut", () => auth().then(a => a.signOut()));
      on("aarpOk", b.close);
    };
    render();
    auth().then(a => a.onAuthStateChanged(u => { user = u; if (!document.body.contains(b.w)) return; if (u) load(); else { list = null; render(); msg.className = "aarp-msg"; msg.textContent = "Sign in as the owner to see the rooms."; } }))
      .catch(e => { msg.className = "aarp-msg err"; msg.textContent = "Firebase is not reachable: " + (e && e.message || e); });
  };

  window.AAReport = { open, list, rooms, buttonHTML, format, formatAll, MAX, _db: db, _auth: auth, _box: box, _copy: copy, _when: when, _esc: esc };   // _…: shared with shared/campaign.js (Revise#379)
})();
