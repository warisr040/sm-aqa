/* ==========================================================================
   Deck Builder · Account (Pack, Revise#314): keep decks online with an ID and a password.

   - Accounts are made by the admin only (Admin page #addoge → Users): an ID, an optional email, and a first
     password of 8 easy random characters (A–Z a–z 0–9, no look-alikes). The user changes it on the Profile tab.
   - Firebase Authentication (Email/Password) does the login. Each account has a login email: the user's real
     email, or ID@users.example.com (no mailbox) for users without one. ids/<id> = {uid, email[, pendingEmail]}
     turns the ID typed at login into that email (only one exact ID can be read, never the list).
   - Forgot password / change email: Firebase emails a one-time link (no server needed). Without an email:
     "please contact the admin".
   - Request an account (Pack, Revise#320/#321): on the login page anyone may ask for an ID with a password they choose
     (kept only by Firebase Authentication); requests/<id> = {id, uid, email | login}. The admin approves (users/ and
     ids/ are made for that login, the request is removed) or rejects it in Admin → Approve registrations (or Users).
   - users/<uid> = {id, email, avatar, deckMode, slots: {0…9: deck}, created}. Only the user and the admin
     can read or write it, and a user can only change a record the admin made (Firebase rules, docs Revise#314).
   ========================================================================== */
(() => {
  "use strict";
  const SDK = ["https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js", "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js", "https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js"];
  const NOMAIL = "users.example.com";   // reserved domain: a login email for users without one (no mail is ever sent there)
  const ID_RE = /^[a-z0-9_-]{3,20}$/;
  const ADMIN_ID = "sakhudoge";   // Pack (Revise#337): this account is the admin too (the database rules name it the same way: ids/sakhudoge/uid)
  const PW_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";   // A–Z a–z 0–9 without 0 O o 1 l I
  const AVATARS = ["p1", "p2", "p3", "p4", "p5", "p6"];
  const avatarSrc = v => (!v ? "players/p1.jpg" : /^p[1-6]$/.test(v) ? `players/${v}.jpg` : v);
  const randomPw = () => { const a = new Uint32Array(8); crypto.getRandomValues(a); return Array.from(a, x => PW_CHARS[x % PW_CHARS.length]).join(""); };
  const realEmail = e => !!e && !String(e).endsWith("@" + NOMAIL);
  const maskEmail = e => { const [u, d] = String(e).split("@"); return (u.length <= 2 ? u[0] + "*" : u.slice(0, 2) + "*".repeat(Math.min(6, u.length - 2))) + "@" + d; };
  const errText = e => {
    const c = (e && e.code) || "";
    return ({ "auth/invalid-credential": "The ID or the password is wrong.", "auth/wrong-password": "The ID or the password is wrong.", "auth/user-not-found": "The ID or the password is wrong.",
      "auth/too-many-requests": "Too many tries. Wait a few minutes and try again.", "auth/network-request-failed": "No connection to the server. Check the internet connection.",
      "auth/requires-recent-login": "Please log out and log in again, then try once more.", "auth/weak-password": "The password is too short (8 characters or more).",
      "auth/email-already-in-use": "This email is used by another account.", "auth/invalid-email": "This email address is not valid.",
      "auth/operation-not-allowed": "Email/Password login is not turned on in Firebase (Authentication → Sign-in method).", "PERMISSION_DENIED": "Not allowed by the Firebase rules (see the set-up notes)." })[c]
      || (String(e && e.message || e).includes("PERMISSION_DENIED") ? "Not allowed by the Firebase rules (see the set-up notes)." : (e && e.message) || String(e));
  };

  /* ---------- Firebase (loaded when the Account page or Users is opened) ---------- */
  let fbP = null;
  const loadScript = src => new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => no(new Error("Could not load " + src)); document.head.appendChild(s); });
  const fb = () => {
    if (!(window.AA_FIREBASE && window.AA_FIREBASE.databaseURL)) return Promise.reject(new Error("Firebase is not set up (assets/firebase-config.js)"));
    if (!fbP) fbP = SDK.reduce((p, src) => p.then(() => {
      const f = window.firebase, need = src.includes("-app-") ? !f : src.includes("-auth-") ? !(f && f.auth) : !(f && f.database);
      return need ? loadScript(src) : null;
    }), Promise.resolve()).then(() => { const f = window.firebase; if (!f.apps.length) f.initializeApp(window.AA_FIREBASE); return f; }).catch(e => { fbP = null; throw e; });
    return fbP;
  };
  const dbRef = path => fb().then(f => f.database().ref(path));
  const lookup = id => dbRef("ids/" + id).then(r => r.once("value")).then(s => s.val());
  /** A new Firebase login made in a second app (the page's own sign-in is not touched); fn(app2, uid) runs signed in as it. */
  const withLogin = (email, pw, fn) => fb().then(f => { const app2 = f.initializeApp(window.AA_FIREBASE, "acct-make-" + Date.now()); const end = () => app2.auth().signOut().catch(() => {}).then(() => app2.delete());
    return app2.auth().createUserWithEmailAndPassword(email, pw).then(cr => Promise.resolve(fn && fn(app2, cr.user.uid)).then(() => cr.user.uid)).then(uid => end().then(() => uid), e => end().then(() => { throw e; })); });

  /* ---------- state ---------- */
  const A = { user: null, rec: null, tab: "decks", mode: "save", sel: { L: null, R: null }, busy: false, msg: "", err: false, ready: false, forgot: false, reg: false, emailForm: false, pwForm: false };
  const slotsOf = rec => Array.from({ length: DECK_SLOTS }, (_, i) => { const d = rec && rec.slots && rec.slots[i]; return d && d.cols ? cleanDeck({ name: d.name || `Deck ${i + 1}`, cols: Object.fromEntries(CATS.map(C => [C.id, (d.cols[C.id] || []).slice()])) }) : null; });
  const curSlots = () => deckSlots.map((d, i) => (i === deckSlot ? (slotTotal(deck) || deck.name !== `Deck ${i + 1}` ? deck : null) : d));
  const plain = d => (d ? JSON.parse(JSON.stringify({ name: d.name, cols: Object.fromEntries(CATS.map(C => [C.id, d.cols[C.id].map(e => ({ k: e.k, n: e.n }))])) })) : null);
  const dname = d => (d ? d.name || "(no name)" : "(empty)");
  const say = (msg, err) => { A.msg = msg || ""; A.err = !!err; render(); };

  /* ---------- the decks belong to the account (Pack, Revise#390) ----------
     While logged in on a device that follows the account ("linked"), the Deck Builder's 50 slots ARE the account's slots: every change is
     saved to the account by itself, and on opening the site the account's decks are loaded. aa-sync = {uid, hash}: this device follows
     that account; hash = the decks when the two were last the same.
       - log in / open the site, decks the same                        → linked;
       - linked, only the account changed (another device)             → the account's decks come to this device;
       - linked, only this device changed (edited while logged out)    → they are saved to the account;
       - both changed, or a first login with different decks on the two → MERGE: nothing is copied; the Save / Load page opens with a
         notice, and the player brings the decks together, then chooses "Use the account's decks" (or "Use this device's decks").
       - a first login on a device without decks                        → the account's decks are loaded. */
  const SYNC = "aa-sync";
  const hashOf = list => JSON.stringify(list.map(plain));
  const hasCards = list => list.some(d => d && slotTotal(d));
  const linked = () => { const s = store.get(SYNC, null); return !!(s && A.user && A.rec && !A.merge && s.uid === A.recUid); };
  const link = () => { store.set(SYNC, { uid: A.recUid, hash: hashOf(slotsOf(A.rec)) }); A.merge = false; };
  let syncTimer = null;
  const syncNote = (t, err) => { A.sync = { t, err: !!err, at: Date.now() }; const el = document.getElementById("acSync"); if (el) { el.textContent = t; el.classList.toggle("err", !!err); } };
  function pushNow() {
    clearTimeout(syncTimer); syncTimer = null;
    if (!linked()) return Promise.resolve();
    const cur = curSlots(), old = slotsOf(A.rec), slots = Object.fromEntries(cur.map((d, i) => [i, plain(d)]));
    if (hashOf(cur) === hashOf(old)) { link(); return Promise.resolve(); }
    // Revise#397: with 50 slots only the slots that changed are sent
    const diff = Object.fromEntries(cur.map((d, i) => [i, plain(d)]).filter(([i, d]) => JSON.stringify(d) !== JSON.stringify(plain(old[i]))));
    syncNote("Saving to your account…");
    return dbRef("users/" + A.recUid + "/slots").then(r => r.update(diff)).then(() => { A.rec.slots = slots; link(); syncNote("Saved to your account ✓"); })
      .catch(e => { syncNote("Not saved to your account: " + errText(e), true); toast("The decks could not be saved to your account"); });
  }
  const syncSoon = () => { if (!linked()) return; clearTimeout(syncTimer); syncTimer = setTimeout(pushNow, 1200); };
  { const save0 = saveSlots; saveSlots = function () { const r = save0.apply(this, arguments); try { syncSoon(); } catch (e) { /* */ } return r; }; }   // every change of the decks → the account
  addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && syncTimer) pushNow(); });
  function syncOnLogin() {   // Pack (Revise#393): signed in → the device's decks are replaced by the account's; no merge step
    const s = store.get(SYNC, null), cur = curSlots(), saved = slotsOf(A.rec), hc = hashOf(cur), hs = hashOf(saved), fresh = !!A.freshLogin;
    A.merge = false; A.freshLogin = false;
    if (hc === hs) return link();
    // edits made while signed in that had not reached the account yet (the page was closed too soon): they are saved, not thrown away
    if (!fresh && s && s.uid === A.recUid && s.hash === hs) { link(); return void pushNow(); }
    // an account that has never held a deck has nothing to replace them with: the device's decks become the account's
    if (!hasCards(saved) && hasCards(cur)) { link(); syncNote("Your decks were saved to your account"); return void pushNow(); }
    link(); applyLocal(saved); link(); syncNote("Your account's decks were loaded"); toast("Your account's decks were loaded");
  }

  /* ---------- the page ---------- */
  const CSS = `
.acct{max-width:980px;margin:0 auto;padding:4px 0 24px}
.acct .acbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 12px}
.acct .acbar h2{margin:0;font-size:20px;flex:1 1 auto}
.acct .acbox{background:rgba(10,16,70,.55);border:1px solid rgba(140,206,255,.35);border-radius:14px;padding:16px}
.acct .aclogin{max-width:380px;margin:12px auto}
.acct .acmerge{border:1.5px solid #ffd38a;background:rgba(255,211,138,.1);border-radius:12px;padding:12px 14px;margin:0 0 14px}.acct .acmerge p{margin:6px 0 10px;font-size:14px}
.acct .acsynced{border:1px solid rgba(79,227,166,.5);background:rgba(79,227,166,.08);border-radius:12px;padding:10px 14px;margin:0 0 14px;font-size:14px}.acct .acsynced .err{color:#ffb3bd}
.acct label.f{display:block;font-size:13px;margin:10px 0 4px;opacity:.9}
.acct input.t{width:100%;box-sizing:border-box;font:16px system-ui,sans-serif;padding:10px 12px;border-radius:10px;border:1px solid rgba(140,206,255,.5);background:rgba(4,8,40,.7);color:#fff}
.acct .acmsg{margin:10px 0;font-size:14px;white-space:pre-wrap}.acct .acmsg.err{color:#ffb3bd}
.acct .actabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
.acct .acwarn{font-size:13px;color:#ffd38a;margin:8px 0}
.acct .acmode{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.acct .acsw{display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:14px;user-select:none}
.acct .acsw i{position:relative;width:46px;height:26px;border-radius:13px;background:rgba(140,206,255,.25);border:1px solid rgba(140,206,255,.5);flex:none;transition:background .2s}
.acct .acsw i::after{content:"";position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#eef2ff;transition:transform .2s}
.acct .acsw.on i{background:#3d8bff}.acct .acsw.on i::after{transform:translateX(20px)}
.acct .accols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
.acct .acside{min-width:0}
.acct .acpages{display:flex;gap:6px;margin:0 0 8px}.acct .acpages button{flex:1;min-width:0;padding:6px 0;border-radius:8px;border:1px solid rgba(255,255,255,.22);background:transparent;color:inherit;font:600 13px var(--f-body);cursor:pointer}
.acct .acpages button[aria-pressed="true"]{background:var(--ribbon);color:#04122a;border-color:transparent}
.acall{margin:6px 0;padding-left:4px;list-style:none;max-height:40vh;overflow:auto}
@media (max-width:640px){.acct .accols{gap:8px}.acct .acbox{padding:12px}.acct .acslot{font-size:12px;padding:8px}}
.acct .acside h3{margin:0 0 2px;font-size:15px}.acct .acside .note{margin:0 0 8px;font-size:12px;opacity:.75}
.acct .acslot{display:block;width:100%;text-align:left;margin:0 0 6px;padding:9px 10px;border-radius:10px;border:1px solid rgba(140,206,255,.35);background:rgba(4,8,40,.5);color:#eef2ff;font:14px system-ui,sans-serif;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.acct .acslot.empty{opacity:.55}.acct .acslot.on{border-color:#ffd447;background:rgba(255,212,71,.16);box-shadow:0 0 0 2px rgba(255,212,71,.35)}
.acct .acslot b{font-weight:700}.acct .acslot small{opacity:.75}
.acct .acgo{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin:12px 0 4px}
.acct .acav{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0}
.acct .acav button{padding:0;border-radius:12px;border:2px solid transparent;background:none;cursor:pointer;width:64px;height:64px;overflow:hidden}
.acct .acav button.on{border-color:#ffd447}.acct .acav img{width:100%;height:100%;object-fit:cover;display:block}
.acct .acsec{margin:16px 0 0;padding-top:12px;border-top:1px solid rgba(140,206,255,.2)}
.acct .acsec h3{margin:0 0 6px;font-size:15px}
.acct a.lnk{color:#9fd4ff;cursor:pointer}
.tabs .tab-acct{margin-left:auto;max-width:200px}
.tabs .tab-acct .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:130px}
@media (max-width:520px){.tabs .tab-acct .nm{max-width:70px}}
.acpop{position:fixed;z-index:120;width:min(340px,calc(100vw - 16px));background:#0d1450;border:1px solid rgba(140,206,255,.45);border-radius:22px;padding:14px;box-shadow:0 12px 40px rgba(0,0,20,.6);color:#eef2ff;font:14px system-ui,sans-serif}
.acpop .x{position:absolute;top:8px;right:10px;border:0;background:none;color:#cfe3ff;font-size:22px;cursor:pointer;line-height:1}
.acpop .card{display:flex;gap:14px;align-items:center;background:rgba(82,182,255,.10);border-radius:16px;padding:14px;margin:18px 0 8px}
.acpop .big{position:relative;flex:none;width:64px;height:64px;border-radius:50%;padding:0;border:2px solid #8cceff;background:rgba(4,8,40,.6);overflow:visible;cursor:pointer}
.acpop .big img,.acpop .big svg{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block}
.acpop .big i{position:absolute;right:-2px;bottom:-2px;width:22px;height:22px;border-radius:50%;background:#1d2a7a;border:1px solid #8cceff;font-style:normal;font-size:12px;line-height:20px;text-align:center}
.acpop .who{min-width:0;display:flex;flex-direction:column;gap:2px}.acpop .who b{font-size:17px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.acpop .who span{font-size:13px;opacity:.75;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.acpop .row{display:block;width:100%;text-align:left;margin:6px 0 0;padding:12px 14px;border-radius:14px;border:0;background:rgba(82,182,255,.10);color:#eef2ff;font:600 14px system-ui,sans-serif;cursor:pointer}
.acpop .row:hover,.acpop .row:focus-visible{background:rgba(82,182,255,.24)}
.acconf pre{white-space:pre-wrap;font:14px/1.6 system-ui,sans-serif;background:rgba(0,0,0,.25);border-radius:10px;padding:10px 12px;margin:8px 0}
.acconf ol{margin:6px 0 6px 20px;padding:0;font-size:14px;line-height:1.6}
`;
  let styled = false;
  const style = () => { if (styled) return; styled = true; const s = document.createElement("style"); s.textContent = CSS; document.head.appendChild(s); };
  let root = null;
  const open = tab => {
    style();
    if (typeof tab === "string") A.tab = tab;
    if (typeof UI !== "undefined" && UI.tab !== "deck" && typeof setTab === "function") setTab("deck");
    if (!root) {
      root = document.createElement("div"); root.id = "acctPane"; root.className = "acct"; root.hidden = true;
      $("p-deck").appendChild(root);
      root.addEventListener("click", onClick);
      root.addEventListener("submit", e => { e.preventDefault(); onSubmit(e.target); });
    }
    $("deckpane").hidden = true; root.hidden = false;
    document.body.classList.add("acct-open");
    render();
    if (!A.ready) start();
  };
  const close = () => { if (root) root.hidden = true; $("deckpane").hidden = false; document.body.classList.remove("acct-open"); };
  /* Is a player logged in? "in" | "out" | "wait" (a remembered login still being checked) — for parts of the site kept for members (Revise#425) */
  const state = () => (A.ready ? (A.user && A.rec ? "in" : A.user ? "wait" : "out") : store.get("aa-acct", null) ? "wait" : "out");
  window.AAAccount = { open, close, state };

  /* ---------- header chip + menu, like Gmail's (Pack, Revise#322) ---------- */
  const nameOf = rec => (rec && (rec.playerName || rec.id)) || "";
  const cacheHdr = () => { if (A.user && A.rec) store.set("aa-acct", { id: A.rec.id, name: nameOf(A.rec), avatar: A.rec.avatar || "p1", email: realEmail(A.rec.email) ? A.rec.email : "" }); else if (A.ready && !A.user) { try { localStorage.removeItem("aa-acct"); } catch (e) { /* */ } } hdr(); };
  const hdrInfo = () => (A.user && A.rec ? { id: A.rec.id, name: nameOf(A.rec), avatar: A.rec.avatar || "p1", email: realEmail(A.rec.email) ? A.rec.email : "" } : A.ready ? null : store.get("aa-acct", null));
  function hdr() {
    const nav = document.querySelector("#hdr .tabs"); if (!nav) return;
    let b = $("hdrAcct");
    if (!b) { b = document.createElement("button"); b.type = "button"; b.id = "hdrAcct"; b.className = "tab-acct"; b.setAttribute("aria-haspopup", "dialog"); b.onclick = e => { e.stopPropagation(); menu(); }; nav.appendChild(b); }
    const h = hdrInfo();
    b.innerHTML = h ? `<img class="ti ti-img" alt="" src="${esc(avatarSrc(h.avatar))}" width="24" height="24"><span class="nm">${esc(h.name)}</span>`
      : `<svg class="ti" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.6" r="4" fill="#9fd4ff" stroke="#f4f7ff" stroke-width="1.3"/><path d="M4.6 20.2c.8-4 3.8-6.2 7.4-6.2s6.6 2.2 7.4 6.2" fill="#6fb8ff" stroke="#f4f7ff" stroke-width="1.3" stroke-linecap="round"/></svg><span class="nm">Log in</span>`;
    b.title = h ? `Account: ${h.name} (ID ${h.id})` : "Account — log in to keep your decks online";
    if ($("acctPop")) menu(true);
  }
  function menu(refresh) {
    style();
    let p = $("acctPop");
    if (p && !refresh) { p.remove(); return; }
    if (!p) {
      p = document.createElement("div"); p.id = "acctPop"; p.className = "acpop"; p.setAttribute("role", "dialog"); p.setAttribute("aria-label", "Account"); document.body.appendChild(p);
      setTimeout(() => document.addEventListener("click", function off(e) { if (!$("acctPop")) return document.removeEventListener("click", off); if (!p.contains(e.target)) { p.remove(); document.removeEventListener("click", off); } }), 0);
      p.addEventListener("click", e => { const t = e.target.closest("[data-pop]"); if (!t) return; const k = t.dataset.pop; p.remove();
        if (k === "out") return fb().then(f => f.auth().signOut()).then(() => { A.tab = "decks"; render(); });
        if (k === "close") return;
        if (k === "admin") { close(); if (typeof setTab === "function") setTab("addoge"); scrollTo({ top: 0 }); return; }
        if (k === "reg" || k === "login") { A.reg = k === "reg"; A.forgot = false; A.msg = ""; }
        open(k === "profile" ? "profile" : k === "decks" ? "decks" : undefined);
      });
    }
    const b = $("hdrAcct"), r = b.getBoundingClientRect();
    p.style.top = Math.round(r.bottom + 8) + "px"; p.style.right = Math.max(8, Math.round(innerWidth - r.right)) + "px";
    const h = hdrInfo();
    p.innerHTML = `<button class="x" type="button" data-pop="close" aria-label="Close">×</button>` + (h
      ? `<div class="card"><button class="big" type="button" data-pop="profile" title="Change the player image"><img alt="" src="${esc(avatarSrc(h.avatar))}"><i>✎</i></button>
          <div class="who"><b>${esc(h.name)}</b><span>ID: ${esc(h.id)}</span>${h.email ? `<span>${esc(h.email)}</span>` : ""}</div></div>
        <button class="row" type="button" data-pop="profile">⚙ Manage your account</button>
        <button class="row" type="button" data-pop="decks">🗂 Save / Load decks</button>
        ${h.id === ADMIN_ID ? `<button class="row" type="button" data-pop="admin">🛠 Admin page</button>` : ""}
        <button class="row" type="button" data-pop="out">↪ Log out</button>`
      : `<div class="card"><div class="big"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.6" r="4" fill="#9fd4ff"/><path d="M4.6 20.2c.8-4 3.8-6.2 7.4-6.2s6.6 2.2 7.4 6.2" fill="#6fb8ff"/></svg></div>
          <div class="who"><b>Not logged in</b><span>Keep your decks online with an ID.</span></div></div>
        <button class="row" type="button" data-pop="login">→ Log in</button>
        <button class="row" type="button" data-pop="reg">＋ Request an account</button>`);
  }

  let started = false;
  const start = () => {
    if (started) return; started = true;
    fb().then(f => f.auth().onAuthStateChanged(u => {
      A.user = u; A.rec = null; A.recUid = u ? u.uid : null; A.google = !!(u && u.providerData.some(p => p.providerId === "google.com")); A.ready = true; A.sel = { L: null, R: null };
      if (!u) { cacheHdr(); return render(); }
      return dbRef("users/" + u.uid).then(r => r.once("value")).then(s => {
        A.rec = s.val();
        // Pack (Revise#337): the owner's Google sign-in is the admin account "sakhudoge" — its record if the account exists,
        // otherwise it is made now for this sign-in (the rules let only the owner do that)
        if (!A.rec && A.google) return lookup(ADMIN_ID).then(rec => {
          if (rec && rec.uid) { A.recUid = rec.uid; return dbRef("users/" + rec.uid).then(r => r.once("value")).then(x => x.val()); }
          const nu = { id: ADMIN_ID, playerName: ADMIN_ID, email: u.email || "", avatar: "p1", deckMode: "one", created: Date.now() };
          return dbRef("users/" + u.uid).then(r => r.set(nu)).then(() => dbRef("ids/" + ADMIN_ID)).then(r => r.set({ uid: u.uid, email: u.email || "" })).then(() => nu);
        }).then(rec2 => { A.rec = rec2; });
      }).then(() => {
        if (!A.rec) { cacheHdr(); say("This sign-in has no deck account. Log out, then log in with your ID.", true); return; }
        if (A.justIn) { A.justIn = false; A.freshLogin = true; store.set("aa-pname", nameOf(A.rec)); if (/^p[1-6]$/.test(A.rec.avatar || "")) store.set("aa4-avatar", A.rec.avatar); else if (/^data:/.test(A.rec.avatar || "")) { store.set("aa4-avatar-up", A.rec.avatar); store.set("aa4-avatar", "up"); } }   // a fresh login: the Game Table takes this name and picture (it can still be changed there)
        A.mode = "save"; cacheHdr(); try { syncOnLogin(); } catch (e) { console.warn("deck sync", e); } render();
      }).catch(e => say(errText(e), true));
    })).catch(e => { started = false; A.ready = true; say(errText(e), true); });
  };

  const slotBtn = (side, i, d, on) => `<button type="button" class="acslot${d ? "" : " empty"}${on ? " on" : ""}" data-ac="pick" data-side="${side}" data-slot="${i}">${i + 1}. ${d ? `<b>${esc(d.name)}</b> <small>· ${slotTotal(d)} cards</small>` : "(empty)"}</button>`;
  function render() {
    if (!root || root.hidden) return;
    const msg = A.msg ? `<div class="acmsg${A.err ? " err" : ""}" role="status">${esc(A.msg)}</div>` : "";
    const head = `<div class="acbar"><button class="btn" type="button" data-ac="back">← Deck Builder</button><h2>Account</h2>${A.user && A.rec ? `<span class="note">ID: <b>${esc(A.rec.id)}</b></span>` : ""}</div>`;
    if (!A.ready) { root.innerHTML = head + `<div class="acbox"><p class="note">Connecting…</p>${msg}</div>`; return; }
    if (!A.user || !A.rec) {
      if (A.user && !A.rec) { root.innerHTML = head + `<div class="acbox aclogin">${msg}<button class="btn" type="button" data-ac="logout">Log out</button></div>`; return; }
      root.innerHTML = head + (A.reg
        ? `<form class="acbox aclogin" data-form="reg"><h3>Request an account</h3><p class="note">Choose an ID and a password. The admin checks the request; once it is approved, log in with them. Only the ID and the email are kept with the request (the password is kept by the login service, never readable).</p>
            <label class="f" for="acRid">ID (3–20: a–z 0–9 _ -)</label><input class="t" id="acRid" autocomplete="username" autocapitalize="none" spellcheck="false" required>
            <label class="f" for="acRem">Email (optional — “Forgot password” needs it)</label><input class="t" id="acRem" type="email" autocomplete="email">
            <label class="f" for="acRp1">Password (8 or more characters — you log in with it after the approval)</label><input class="t" id="acRp1" type="password" autocomplete="new-password" minlength="8" required>
            <label class="f" for="acRp2">Password again</label><input class="t" id="acRp2" type="password" autocomplete="new-password" minlength="8" required>
            ${msg}<div class="acgo"><button class="btn primary" type="submit"${A.busy ? " disabled" : ""}>Send the request</button><button class="btn" type="button" data-ac="regOff">Back to login</button></div></form>`
        : A.forgot
        ? `<form class="acbox aclogin" data-form="forgot"><h3>Forgot password</h3><p class="note">Type your ID. If your account has an email, we send a link there to set a new password.</p>
            <label class="f" for="acFid">ID</label><input class="t" id="acFid" autocomplete="username" autocapitalize="none" spellcheck="false" required>
            ${msg}<div class="acgo"><button class="btn primary" type="submit"${A.busy ? " disabled" : ""}>Send the link</button><button class="btn" type="button" data-ac="forgotOff">Back to login</button></div></form>`
        : `<form class="acbox aclogin" data-form="login"><h3>Log in</h3><p class="note">Keep your decks online. Accounts are made by the admin — request one below, or ask the admin for an ID.</p>
            <label class="f" for="acId">ID</label><input class="t" id="acId" autocomplete="username" autocapitalize="none" spellcheck="false" required>
            <label class="f" for="acPw">Password</label><input class="t" id="acPw" type="password" autocomplete="current-password" required>
            ${msg}<div class="acgo"><button class="btn primary" type="submit"${A.busy ? " disabled" : ""}>Log in</button></div>
            <p class="note" style="text-align:center"><a class="lnk" data-ac="forgotOn">Forgot password?</a> · <a class="lnk" data-ac="regOn">Request an account</a></p>
            <p class="note" style="text-align:center;opacity:.7"><a class="lnk" data-ac="google">Admin: sign in with Google</a></p></form>`);
      return;
    }
    const tabs = `<div class="actabs" role="tablist">${[["decks", "Save / Load decks"], ["profile", "Profile"]].map(([k, t]) => `<button class="btn${A.tab === k ? " primary" : ""}" type="button" role="tab" aria-selected="${A.tab === k}" data-ac="tab" data-tab="${k}">${t}</button>`).join("")}<button class="btn" type="button" data-ac="logout">Log out</button></div>`;
    root.innerHTML = head + tabs + `<div class="acbox">${A.tab === "profile" ? profileHTML() : decksHTML()}${msg}</div>`;
  }
  function decksHTML() {
    const all = (A.rec.deckMode || "one") === "all", cur = curSlots(), saved = slotsOf(A.rec);
    const sw = `<label class="acsw${all ? " on" : ""}" data-ac="deckMode" role="switch" aria-checked="${all}"><span>One deck</span><i></i><span>All decks</span></label>`;
    const mode = `<div class="seg" role="group" aria-label="Mode"><button type="button" data-ac="mode" data-mode="save" aria-pressed="${A.mode === "save"}">Save → account</button><button type="button" data-ac="mode" data-mode="load" aria-pressed="${A.mode === "load"}">Load ← account</button></div>`;
    const pgN = Math.min(SLOT_PAGES - 1, A.page || 0), onPage = i => pageOf(i) === pgN, cnt = (list, p) => list.filter((d, i) => pageOf(i) === p && d).length;
    const pager = `<div class="acpages" role="group" aria-label="Page">${Array.from({ length: SLOT_PAGES }, (_, p) => `<button type="button" data-ac="page" data-page="${p}" aria-pressed="${p === pgN}" title="Slots ${p * SLOT_PAGE + 1}–${(p + 1) * SLOT_PAGE}: ${cnt(cur, p)} here, ${cnt(saved, p)} in the account">${p + 1}</button>`).join("")}</div>`;
    const warn = `<p class="acwarn">⚠ An overwritten deck cannot be brought back. Export it first if you may need it.</p>`;
    const L = `<div class="acside"><h3>Current · Deck Builder</h3><p class="note">The decks on this device now</p>${pager}${cur.map((d, i) => !onPage(i) ? "" : all ? slotBtn("L", i, d, false).replace('data-ac="pick"', "disabled") : slotBtn("L", i, d, A.sel.L === i)).join("")}<button class="btn" type="button" data-ac="export" data-side="L">Export</button></div>`;
    const R = `<div class="acside"><h3>Saved data · Account</h3><p class="note">Kept online with your ID</p>${pager}${saved.map((d, i) => !onPage(i) ? "" : all ? slotBtn("R", i, d, false).replace('data-ac="pick"', "disabled") : slotBtn("R", i, d, A.sel.R === i)).join("")}<button class="btn" type="button" data-ac="export" data-side="R">Export</button></div>`;
    const go = all
      ? `<div class="acgo"><button class="btn primary" type="button" data-ac="goAll"${A.busy ? " disabled" : ""}>${A.mode === "save" ? "Save all 50 slots to the account…" : "Load all 50 slots from the account…"}</button></div>`
      : `<div class="acgo"><button class="btn primary" type="button" data-ac="goOne"${A.sel.L == null || A.sel.R == null || A.busy ? " disabled" : ""}>${A.sel.L == null || A.sel.R == null ? "Pick a slot on each side" : A.mode === "save" ? `Save slot ${A.sel.L + 1} → account slot ${A.sel.R + 1}` : `Load account slot ${A.sel.R + 1} → slot ${A.sel.L + 1}`}</button></div>`;
    const status = A.merge
      ? `<div class="acmerge" role="alert"><b>The decks on this device and the decks in your account are different.</b><p>Bring them together with Save / Load below (nothing has been copied yet). When one side has everything you want to keep, choose it. From then on the Deck Builder shows your account's decks and saves every change to the account.</p>
          <div class="acgo"><button class="btn primary" type="button" data-ac="mergeAcc"${A.busy ? " disabled" : ""}>Use the account's decks…</button><button class="btn" type="button" data-ac="mergeDev"${A.busy ? " disabled" : ""}>Use this device's decks…</button></div></div>`
      : `<div class="acsynced"><b>Your decks are kept in your account.</b> <span id="acSync" class="${A.sync && A.sync.err ? "err" : ""}">${esc((A.sync && A.sync.t) || "Every change in the Deck Builder is saved to your account.")}</span></div>`;
    return `${status}<div class="acmode">${sw}${mode}</div>${warn}${all ? `<p class="note">All decks: every slot is copied ${A.mode === "save" ? "from this device to the account" : "from the account to this device"}.</p>` : `<p class="note">Tap one slot on each side (tap again to un-pick).</p>`}<div class="accols">${L}${R}</div>${go}`;
  }
  function profileHTML() {
    const r = A.rec, em = realEmail(r.email) ? r.email : "";
    const av = r.avatar || "p1";
    return `<form class="acsec" style="border:0;margin:0 0 4px;padding:0" data-form="pname"><h3>Player name</h3><p class="note">Your name at the Game Table (you can still change it there for one game).</p>
        <div style="display:flex;gap:8px;max-width:420px"><input class="t" id="acPn" maxlength="24" value="${esc(nameOf(r))}" autocomplete="nickname" required><button class="btn primary" type="submit"${A.busy ? " disabled" : ""}>Save</button></div></form>
      <div class="acsec"><h3>Player image</h3><p class="note">Shown at the Game Table.</p>
        <div class="acav">${AVATARS.map(a => `<button type="button" class="${av === a ? "on" : ""}" data-ac="avatar" data-v="${a}" title="${a}"><img alt="" src="${avatarSrc(a)}"></button>`).join("")}${/^data:/.test(av) ? `<button type="button" class="on" title="Your picture"><img alt="" src="${esc(av)}"></button>` : ""}</div>
        <label class="btn" style="display:inline-block">Use my own picture…<input type="file" accept="image/*" data-ac="upload" hidden></label></div>
      ${A.google ? `<div class="acsec"><h3>Sign-in</h3><p class="note">Signed in with Google as the owner (${esc(A.user.email || "")}). The email and the password belong to the Google account.</p></div>` : `<div class="acsec"><h3>Email</h3><p>${em ? esc(em) : `<span class="note">No email — without one, “Forgot password” can't help; ask the admin.</span>`}${r.pendingEmail ? `<br><span class="note">Waiting for the link sent to ${esc(r.pendingEmail)}.</span>` : ""}</p>
        ${A.emailForm ? `<form data-form="email"><label class="f" for="acEm">New email</label><input class="t" id="acEm" type="email" autocomplete="email" required><label class="f" for="acEmPw">Your password (to confirm it's you)</label><input class="t" id="acEmPw" type="password" autocomplete="current-password" required>
          <div class="acgo"><button class="btn primary" type="submit"${A.busy ? " disabled" : ""}>Send the confirmation link</button><button class="btn" type="button" data-ac="emailOff">Cancel</button></div>
          <p class="note">We email a link to the new address. The email changes when you open that link; then log in again with your ID.</p></form>`
          : `<button class="btn" type="button" data-ac="emailOn">${em ? "Change email" : "Add an email"}</button>`}</div>
      <div class="acsec"><h3>Password</h3>${A.pwForm ? `<form data-form="pw"><label class="f" for="acPw0">Current password</label><input class="t" id="acPw0" type="password" autocomplete="current-password" required>
          <label class="f" for="acPw1">New password (8 or more characters)</label><input class="t" id="acPw1" type="password" autocomplete="new-password" minlength="8" required>
          <label class="f" for="acPw2">New password again</label><input class="t" id="acPw2" type="password" autocomplete="new-password" minlength="8" required>
          <div class="acgo"><button class="btn primary" type="submit"${A.busy ? " disabled" : ""}>Change password</button><button class="btn" type="button" data-ac="pwOff">Cancel</button></div></form>`
        : `<button class="btn" type="button" data-ac="pwOn">Change password</button>`}</div>`}`;
  }

  /* ---------- actions ---------- */
  const confirmBox = (title, html, ok) => {
    openModal(title, `<div class="acconf">${html}</div><div class="actions"><button class="btn primary" id="acOk" type="button">OK</button><button class="btn" id="acCancel" type="button">Cancel</button></div>`);
    $("acOk").onclick = () => { closeAll(); ok(); };
    $("acCancel").onclick = () => closeAll();
  };
  const saveRec = patch => dbRef("users/" + (A.recUid || A.user.uid)).then(r => r.update(patch)).then(() => { Object.assign(A.rec, patch); cacheHdr(); });
  function applyLocal(list) {   // the Deck Builder's slots ← list (null = empty)
    for (let i = 0; i < DECK_SLOTS; i++) deckSlots[i] = list[i] ? cleanDeck(JSON.parse(JSON.stringify(list[i]))) : null;
    deck = deckSlots[deckSlot] || emptyDeck(`Deck ${deckSlot + 1}`);
    store.set("aa-decks", deckSlots); store.set("aa-deck", deck);
    deckChanged();
  }
  function doOne() {
    const L = A.sel.L, R = A.sel.R, cur = curSlots(), saved = slotsOf(A.rec), save = A.mode === "save";
    const src = save ? cur[L] : saved[R], dst = save ? saved[R] : cur[L];
    const srcT = `${dname(src)} (${save ? "Current" : "Saved Data"})`, dstT = `${dname(dst)} (${save ? "Saved Data" : "Current"})`;
    if (!src || !slotTotal(src)) return say(`That ${save ? "Deck Builder" : "account"} slot is empty — pick a slot with a deck to ${save ? "save" : "load"}.`, true);
    const run = () => {
      A.busy = true; say(save ? "Saving…" : "Loading…");
      if (save) {
        saveRec({ ["slots/" + R]: plain(src) }).then(() => { A.rec.slots = Object.assign({}, A.rec.slots || {}, { [R]: plain(src) }); A.busy = false; A.sel = { L: null, R: null };
          if (linked() && R !== L) { const list = curSlots().slice(); list[R] = src; applyLocal(list); }   // this device follows the account: its slot R is that deck too
          say(`Saved: ${dname(src)} → account slot ${R + 1}.`); toast(`Saved to account slot ${R + 1}`); })
          .catch(e => { A.busy = false; say(errText(e), true); });
      } else {
        const list = cur.slice(); list[L] = src; applyLocal(list); A.busy = false; A.sel = { L: null, R: null }; say(`Loaded: account slot ${R + 1} → slot ${L + 1} (${dname(src)}).`); toast(`Loaded into slot ${L + 1}`);
      }
    };
    if (dst) confirmBox("Overwrite", `<p>Overwrite</p><pre>[${esc(srcT)}]</pre><p>to</p><pre>[${esc(dstT)}]</pre><p>Please confirm. The deck that is overwritten cannot be brought back.</p>`, run);
    else run();
  }
  function doAll() {
    const save = A.mode === "save", cur = curSlots(), saved = slotsOf(A.rec), src = save ? cur : saved, dst = save ? saved : cur;
    const row = (d, i) => `<li><b>${i + 1}.</b> ${esc(dname(d))}${d ? ` · ${slotTotal(d)} cards` : ""}${dst[i] ? ` <span class="note">(replaces “${esc(dname(dst[i]))}”)</span>` : ""}</li>`;
    confirmBox(save ? "Save all decks" : "Load all decks", `<p>${save ? "All 50 slots of this device go to your account:" : "All 50 slots of your account come to this device:"}</p><ul class="acall">${src.map((d, i) => (d || dst[i] ? row(d, i) : "")).join("") || "<li>(no decks)</li>"}</ul>
      <p class="acwarn" style="color:#ffd38a">⚠ Every slot on the ${save ? "account" : "device"} is replaced. Overwritten decks cannot be brought back.</p>`, () => {
      A.busy = true; say(save ? "Saving all…" : "Loading all…");
      if (save) {
        const slots = Object.fromEntries(cur.map((d, i) => [i, plain(d)]));
        dbRef("users/" + A.recUid + "/slots").then(r => r.set(slots)).then(() => { A.rec.slots = slots; A.busy = false; if (!A.merge) link(); say("Saved all 50 slots to your account."); toast("All decks saved"); }).catch(e => { A.busy = false; say(errText(e), true); });
      } else { applyLocal(saved); A.busy = false; say("Loaded all 50 slots from your account."); toast("All decks loaded"); }
    });
  }
  function exportSide(side) {
    const list = (side === "L" ? curSlots() : slotsOf(A.rec)).map((d, i) => ({ i, d })).filter(x => x.d && slotTotal(x.d));
    const pick = A.sel[side], one = pick != null ? (side === "L" ? curSlots() : slotsOf(A.rec))[pick] : null;
    if (!list.length) return toast("No decks with cards here");
    openExport({ list, cur: one && slotTotal(one) ? one : null, label: side === "L" ? "Current (Deck Builder)" : "Saved data (account)" });
  }
  function onClick(e) {
    const b = e.target.closest("[data-ac]"); if (!b || !root.contains(b)) return;
    const ac = b.dataset.ac;
    if (ac !== "upload") e.preventDefault();
    if (ac === "back") return close();
    if (ac === "forgotOn" || ac === "forgotOff") { A.forgot = ac === "forgotOn"; A.reg = false; A.msg = ""; return render(); }
    if (ac === "google") { A.justIn = true; return fb().then(f => f.auth().signInWithPopup(new f.auth.GoogleAuthProvider())).catch(err => say(errText(err), true)); }
    if (ac === "regOn" || ac === "regOff") { A.reg = ac === "regOn"; A.forgot = false; A.msg = ""; return render(); }
    if (ac === "logout") return fb().then(f => f.auth().signOut()).then(() => { A.msg = ""; A.tab = "decks"; render(); });
    if (ac === "tab") { A.tab = b.dataset.tab; A.msg = ""; return render(); }
    if (ac === "mode") { A.mode = b.dataset.mode; A.msg = ""; return render(); }
    if (ac === "deckMode") { const v = (A.rec.deckMode || "one") === "all" ? "one" : "all"; A.rec.deckMode = v; A.sel = { L: null, R: null }; render(); return saveRec({ deckMode: v }).catch(err => say(errText(err), true)); }
    if (ac === "page") { A.page = +b.dataset.page; return render(); }
    if (ac === "pick") { const s = b.dataset.side, i = +b.dataset.slot; A.sel[s] = A.sel[s] === i ? null : i; A.msg = ""; return render(); }
    if (ac === "mergeAcc" || ac === "mergeDev") { const acc = ac === "mergeAcc", cur = curSlots(), saved = slotsOf(A.rec), src = acc ? saved : cur, dst = acc ? cur : saved;
      const row = (d, i) => `<li><b>${i + 1}.</b> ${esc(dname(d))}${d ? ` · ${slotTotal(d)} cards` : ""}${dst[i] && hashOf([dst[i]]) !== hashOf([d]) ? ` <span class="note">(replaces “${esc(dname(dst[i]))}”)</span>` : ""}</li>`;
      return confirmBox(acc ? "Use the account's decks" : "Use this device's decks", `<p>${acc ? "The 50 slots of this device become the decks of your account:" : "The 50 slots of your account become the decks of this device:"}</p><ul class="acall">${src.map((d, i) => (d || dst[i] ? row(d, i) : "")).join("") || "<li>(no decks)</li>"}</ul>
        <p class="acwarn" style="color:#ffd38a">⚠ Every slot on the ${acc ? "device" : "account"} is replaced. Overwritten decks cannot be brought back.</p>`, () => {
        if (acc) { link(); applyLocal(saved); link(); say("This device now shows your account's decks. Every change is saved to your account."); return; }
        A.busy = true; say("Saving…"); const slots = Object.fromEntries(cur.map((d, i) => [i, plain(d)]));
        dbRef("users/" + A.recUid + "/slots").then(r => r.set(slots)).then(() => { A.rec.slots = slots; A.busy = false; link(); say("Your account now has this device's decks. Every change is saved to your account."); }).catch(err => { A.busy = false; say(errText(err), true); });
      }); }
    if (ac === "goOne") return doOne();
    if (ac === "goAll") return doAll();
    if (ac === "export") return exportSide(b.dataset.side);
    if (ac === "emailOn" || ac === "emailOff") { A.emailForm = ac === "emailOn"; A.msg = ""; return render(); }
    if (ac === "pwOn" || ac === "pwOff") { A.pwForm = ac === "pwOn"; A.msg = ""; return render(); }
    if (ac === "avatar") { const v = b.dataset.v; return saveRec({ avatar: v }).then(() => { store.set("aa4-avatar", v); say("Player image saved."); }).catch(err => say(errText(err), true)); }
  }
  document.addEventListener("change", e => {
    const inp = e.target; if (!inp || inp.dataset.ac !== "upload" || !root || !root.contains(inp) || !inp.files[0]) return;
    const fr = new FileReader();
    fr.onload = () => { const img = new Image(); img.onload = () => {   // a small square picture (so it fits in the account)
      const c = document.createElement("canvas"), S = 128, k = Math.min(img.width, img.height); c.width = c.height = S;
      c.getContext("2d").drawImage(img, (img.width - k) / 2, (img.height - k) / 2, k, k, 0, 0, S, S);
      const url = c.toDataURL("image/jpeg", 0.8);
      saveRec({ avatar: url }).then(() => { store.set("aa4-avatar-up", url); store.set("aa4-avatar", "up"); say("Player image saved."); }).catch(err => say(errText(err), true));
    }; img.src = fr.result; };
    fr.readAsDataURL(inp.files[0]);
  });
  function onSubmit(form) {
    const kind = form.dataset.form, v = id => (root.querySelector("#" + id) || {}).value || "";
    if (kind === "login") {
      const id = v("acId").trim().toLowerCase(), pw = v("acPw");
      if (!ID_RE.test(id)) return say("The ID is 3–20 letters, numbers, _ or -.", true);
      A.busy = true; A.justIn = true; say("Logging in…");
      return lookup(id).then(rec => {
        if (!rec || !rec.email) return dbRef("requests/" + id + "/id").then(r => r.once("value")).then(x => x.val(), () => null).then(p => { throw p ? new Error(`The request for “${id}” is waiting for the admin's approval. You can log in when it is approved.`) : { code: "auth/invalid-credential" }; });   // Revise#320: still pending
        return fb().then(f => f.auth().signInWithEmailAndPassword(rec.email, pw).catch(err => {
          if (!rec.pendingEmail) throw err;   // the email was changed by its link: the new one works now
          return f.auth().signInWithEmailAndPassword(rec.pendingEmail, pw).then(cr => dbRef("ids/" + id).then(r => r.update({ email: rec.pendingEmail, pendingEmail: null })).then(() => dbRef("users/" + cr.user.uid)).then(r => r.update({ email: rec.pendingEmail, pendingEmail: null })).then(() => cr));
        }));
      }).then(() => { A.busy = false; A.msg = ""; }).catch(e => { A.busy = false; say(errText(e), true); });
    }
    if (kind === "reg") {   // Revise#320/#321: a request the admin approves; the requester picks the password (kept only by Firebase Authentication)
      const id = v("acRid").trim().toLowerCase(), em = v("acRem").trim(), p1 = v("acRp1"), p2 = v("acRp2");
      if (!ID_RE.test(id)) return say("The ID is 3–20 letters (a–z), numbers, _ or -.", true);
      if (em && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return say("This email address is not valid.", true);
      if (p1.length < 8) return say("The password needs 8 or more characters.", true);
      if (p1 !== p2) return say("The two passwords are not the same.", true);
      A.busy = true; say("Sending…");
      const login = em || `${id}.r${Date.now().toString(36)}@${NOMAIL}`;
      return lookup(id).then(rec => {
        if (rec) throw new Error("This ID is taken. Choose another one.");
        return dbRef("requests/" + id + "/id").then(r => r.once("value")).then(x => { if (x.val()) throw new Error("This ID was already requested. Choose another ID, or wait for the admin."); });
      }).then(() => withLogin(login, p1, (app2, uid) => app2.database().ref("requests/" + id).set(Object.assign({ id, uid }, em ? { email: em } : { login }))))
        .then(() => { A.busy = false; A.reg = false; say(`Request sent for “${id}”. When the admin approves it, log in here with your ID and the password you chose.`); })
        .catch(e => { A.busy = false; say(String(e && e.message || e).includes("PERMISSION_DENIED") ? "This ID was already requested (or requests are not open). Choose another ID, or contact the admin." : errText(e), true); });
    }
    if (kind === "forgot") {
      const id = v("acFid").trim().toLowerCase();
      A.busy = true; say("Checking…");
      return lookup(id).then(rec => {
        if (!rec) throw new Error("There is no account with this ID.");
        if (!realEmail(rec.email)) throw new Error("This account has no email. Please contact the admin for a new password.");
        return fb().then(f => f.auth().sendPasswordResetEmail(rec.email)).then(() => { A.busy = false; say(`A link to set a new password was sent to ${maskEmail(rec.email)}. Open it, set the password, then log in with your ID.`); });
      }).catch(e => { A.busy = false; say(errText(e), true); });
    }
    if (kind === "pname") {   // Revise#322
      const nm = v("acPn").trim().replace(/\s+/g, " ").slice(0, 24);
      if (!nm) return say("Type a player name.", true);
      return saveRec({ playerName: nm }).then(() => { store.set("aa-pname", nm); say("Player name saved. The Game Table uses it."); }).catch(err => say(errText(err), true));
    }
    if (kind === "pw") {
      const p0 = v("acPw0"), p1 = v("acPw1"), p2 = v("acPw2");
      if (p1 !== p2) return say("The two new passwords are not the same.", true);
      if (p1.length < 8) return say("The new password needs 8 or more characters.", true);
      A.busy = true; say("Changing…");
      return fb().then(f => { const u = f.auth().currentUser; return u.reauthenticateWithCredential(f.auth.EmailAuthProvider.credential(u.email, p0)).then(() => u.updatePassword(p1)); })
        .then(() => { A.busy = false; A.pwForm = false; say("Your password is changed."); }).catch(e => { A.busy = false; say(errText(e), true); });
    }
    if (kind === "email") {
      const em = v("acEm").trim(), pw = v("acEmPw");
      A.busy = true; say("Sending…");
      return fb().then(f => { const u = f.auth().currentUser; return u.reauthenticateWithCredential(f.auth.EmailAuthProvider.credential(u.email, pw)).then(() => u.verifyBeforeUpdateEmail(em)); })
        .then(() => dbRef("ids/" + A.rec.id).then(r => r.update({ pendingEmail: em }))).then(() => saveRec({ pendingEmail: em }))
        .then(() => { A.busy = false; A.emailForm = false; say(`A confirmation link was sent to ${em}. Open it — then log in again with your ID.`); }).catch(e => { A.busy = false; say(errText(e), true); });
    }
  }

  /* ---------- Admin (#addoge) → Users: make accounts, new passwords, delete ---------- */
  const usersBox = opts => {
    style();
    openModal("Users", `<div class="acct" id="acUsers" style="padding:0"><p class="note" id="acUWho">Connecting…</p><div id="acUBody"></div></div>`, true);
    const body = () => $("acUBody"), who = () => $("acUWho");
    if (!body()) return;
    let list = [], reqs = [], created = null, me = null, focusReq = !!(opts && opts.requests);
    const draw = () => {
      if (!body()) return;
      if (!me) { who().innerHTML = `Log in with the admin account (👤 at the top right), or sign in as the owner (Google), to manage users. <a class="lnk" id="acUIn">Owner sign-in (Google)</a>`; body().innerHTML = ""; $("acUIn").onclick = () => fb().then(f => f.auth().signInWithPopup(new f.auth.GoogleAuthProvider())).catch(e => alert(errText(e))); return; }
      who().innerHTML = `${esc(A.rec && A.user && A.user.uid === me.uid ? "Admin account: " + A.rec.id : me.email || "")} · <a class="lnk" id="acUOut">sign out</a>`;
      $("acUOut").onclick = () => fb().then(f => f.auth().signOut());
      body().innerHTML = `<div class="acsec" id="acUReq"><h3>Registration requests (${reqs.length})</h3>${reqs.length ? reqs.map(q => `<div class="acslot" style="cursor:default;white-space:normal"><b>${esc(q.id)}</b> <small>· ${q.email ? esc(q.email) : "no email"}</small><br>
            <button class="btn primary" type="button" data-u="approve" data-rid="${esc(q.id)}">Approve</button> <button class="btn" type="button" data-u="reject" data-rid="${esc(q.id)}">Reject</button></div>`).join("") : reqErr ? `<p class="acmsg err">The requests could not be read: ${esc(reqErr)} Check the “requests” rule in Firebase: the owner's email must be in it (not the word OWNER).</p>` : `<p class="note">No requests waiting.</p>`}</div>
        <form class="acbox" id="acUNew"><h3 style="margin:0">New account</h3>
          <label class="f" for="acUId">ID (3–20: a–z 0–9 _ -)</label><input class="t" id="acUId" autocapitalize="none" spellcheck="false" required>
          <label class="f" for="acUEm">Email (optional — needed for “Forgot password”)</label><input class="t" id="acUEm" type="email">
          <div class="acgo"><button class="btn primary" type="submit">Make the account</button></div>
          ${created && created.approved ? `<div class="acmsg" id="acUOk"><b>Approved: ${esc(created.id)}.</b> They can log in now with their ID and the password they chose.</div>` : created ? `<div class="acmsg"><b>Made.</b> Give these to the player:<pre id="acUCred">ID: ${esc(created.id)}\nPassword: ${esc(created.pw)}</pre><button class="btn" type="button" id="acUCopy">Copy</button></div>` : ""}
          <div class="acmsg err" id="acUErr"></div></form>
        <div class="acsec"><h3>Accounts (${list.length})</h3>${list.length ? list.map(u => `<div class="acslot" style="cursor:default;white-space:normal"><b>${esc(u.id)}</b> <small>· ${realEmail(u.email) ? esc(u.email) : "no email"} · ${Object.values(u.slots || {}).filter(Boolean).length} decks</small><br>
            <button class="btn" type="button" data-u="pw" data-uid="${esc(u.uid)}">${realEmail(u.email) ? "Send reset link" : "New password"}</button> <button class="btn" type="button" data-u="del" data-uid="${esc(u.uid)}">Delete</button></div>`).join("") : `<p class="note">None yet.</p>`}</div>
        <p class="note">Firebase set-up: Authentication → Sign-in method → Email/Password ON; the database rules for ids / users (docs, Revise#314).</p>`;
      $("acUNew").onsubmit = ev => { ev.preventDefault(); make(); };
      if ($("acUCopy")) $("acUCopy").onclick = () => navigator.clipboard.writeText($("acUCred").textContent).then(() => toast("Copied"));
      body().querySelectorAll("[data-u]").forEach(btn => (btn.onclick = () => btn.dataset.rid ? request(btn.dataset.u, btn.dataset.rid) : act(btn.dataset.u, btn.dataset.uid)));
      if (focusReq && $("acUReq")) { $("acUReq").scrollIntoView({ block: "start" }); focusReq = false; }
    };
    let reqErr = "";   // why the requests could not be read (shown: a rules problem used to look like "no requests", Revise#338)
    const loadReqs = () => dbRef("requests").then(r => r.once("value")).then(s => { reqErr = ""; reqs = Object.values(s.val() || {}).filter(q => q && q.id).sort((a, b) => String(a.id).localeCompare(b.id)); }, e => { reqs = []; reqErr = errText(e); });
    const load = () => loadReqs().then(() => dbRef("users")).then(r => r.once("value")).then(s => { const v = s.val() || {}; list = Object.entries(v).map(([uid, u]) => Object.assign({ uid }, u)).sort((a, b) => String(a.id).localeCompare(b.id)); draw(); })
      .catch(e => { list = []; draw(); const el = $("acUErr"); if (el) el.textContent = "Could not list the users: " + errText(e); });
    // a second Firebase app makes the account, so the owner stays signed in here
    const createAuth = (email, pw) => fb().then(f => { const app2 = f.initializeApp(window.AA_FIREBASE, "acct-make-" + Date.now()); return app2.auth().createUserWithEmailAndPassword(email, pw).then(cr => { const uid = cr.user.uid; return app2.auth().signOut().then(() => app2.delete()).then(() => uid); }, e => app2.delete().then(() => { throw e; })); });
    const makeAccount = (id, em) => lookup(id).then(old => {
      if (old) throw new Error("This ID is taken.");
      const pw = randomPw(), login = em || `${id}@${NOMAIL}`;
      return createAuth(login, pw).then(uid => dbRef("users/" + uid).then(r => r.set({ id, playerName: id, email: login, avatar: "p1", deckMode: "one", created: Date.now() }))
        .then(() => dbRef("ids/" + id)).then(r => r.set({ uid, email: login })).then(() => ({ id, pw })));
    });
    const make = () => {
      const id = ($("acUId").value || "").trim().toLowerCase(), em = ($("acUEm").value || "").trim(), err = $("acUErr");
      if (!ID_RE.test(id)) { err.textContent = "The ID is 3–20 letters (a–z), numbers, _ or -."; return; }
      err.textContent = "Making…";
      makeAccount(id, em).then(c => { created = c; return load(); }).catch(e => { const el = $("acUErr"); if (el) el.textContent = errText(e); });
    };
    /** Revise#320: approve (make the account, send the set-password link to the email if there is one) or reject a request. */
    const request = (what, rid) => {
      const q = reqs.find(x => x.id === rid); if (!q) return;
      const drop = () => dbRef("requests/" + rid).then(r => r.remove());
      if (what === "reject") { if (!confirm(`Reject the request for “${rid}”?`)) return; return drop().then(load).catch(e => alert(errText(e))); }
      const err = $("acUErr"); if (err) err.textContent = "Approving…";
      const login = q.email || q.login;
      (q.uid && login ? lookup(rid).then(old => {   // Revise#321: the requester's own login (their password) gets the account
        if (old) throw new Error("This ID is taken.");
        return dbRef("users/" + q.uid).then(r => r.set({ id: rid, playerName: rid, email: login, avatar: "p1", deckMode: "one", created: Date.now() })).then(() => dbRef("ids/" + rid)).then(r => r.set({ uid: q.uid, email: login })).then(() => ({ id: rid, approved: true }));
      }) : makeAccount(rid, q.email || ""))   // an older request without a login: made like "Make the account"
        .then(c => drop().then(() => c)).then(c => { created = c; return load(); }).catch(e => { const el = $("acUErr"); if (el) el.textContent = `Request “${rid}”: ` + errText(e); });
    };
    const act = (what, uid) => {
      const u = list.find(x => x.uid === uid); if (!u) return;
      if (what === "del") {
        if (!confirm(`Delete the account “${u.id}” and its saved decks? This cannot be undone.`)) return;
        return dbRef("users/" + uid).then(r => r.remove()).then(() => dbRef("ids/" + u.id)).then(r => r.remove()).then(load).catch(e => alert(errText(e)));
      }
      if (realEmail(u.email)) return fb().then(f => f.auth().sendPasswordResetEmail(u.email)).then(() => alert(`A reset link was sent to ${u.email}.`)).catch(e => alert(errText(e)));
      // no email: a new login (a new number in the hidden address) with a new password; the decks move with it
      if (!confirm(`Give “${u.id}” a new password? The old password stops working.`)) return;
      const pw = randomPw(), n = ((String(u.email).match(/\.(\d+)@/) || [])[1] | 0) + 1, login = `${u.id}.${n}@${NOMAIL}`;
      createAuth(login, pw).then(nuid => dbRef("users/" + nuid).then(r => r.set(Object.assign({}, u, { uid: null, email: login }))).then(() => dbRef("ids/" + u.id)).then(r => r.set({ uid: nuid, email: login }))
        .then(() => dbRef("users/" + uid)).then(r => r.remove()).then(() => { created = { id: u.id, pw }; return load(); })).catch(e => alert(errText(e)));
    };
    fb().then(f => f.auth().onAuthStateChanged(u => {
      const set = ok => { me = ok ? u : null; if (!$("acUBody")) return; if (me) load(); else draw(); };
      if (!u) return set(false);
      if (u.providerData.some(p => p.providerId === "google.com")) return set(true);
      lookup(ADMIN_ID).then(rec => set(!!(rec && rec.uid === u.uid)), () => set(false));   // the admin account (Revise#337)
    })).catch(e => { if (who()) who().textContent = errText(e); });
  };
  window.AAAccount.users = usersBox;

  /* ---------- buttons ---------- */
  const addButtons = () => {
    const tools = document.querySelector("#deckpane .dtools");
    if (tools && !$("btnAccount")) { const b = document.createElement("button"); b.className = "btn"; b.id = "btnAccount"; b.type = "button"; b.textContent = "👤 Account"; b.title = "Keep your decks online (ID and password)"; b.onclick = open; tools.appendChild(b); }
    const adm = document.querySelector("#p-addoge .admgrid");
    if (adm && !$("openUsers")) { const b = document.createElement("button"); b.className = "btn admbtn"; b.type = "button"; b.id = "openUsers"; b.innerHTML = "<b>👥 Users</b><span>Make accounts (ID + first password), new passwords, delete.</span>"; b.onclick = () => usersBox(); adm.appendChild(b); }
    if (adm && !$("openRegs")) { const b = document.createElement("button"); b.className = "btn admbtn"; b.type = "button"; b.id = "openRegs"; b.innerHTML = "<b>✅ Approve registrations</b><span>Requests sent from the login page: approve (makes the account) or reject.</span>"; b.onclick = () => usersBox({ requests: true }); adm.appendChild(b); }
  };
  const boot = () => { addButtons(); style(); hdr(); if (store.get("aa-acct", null)) start(); };   // a remembered login: check it quietly (Firebase loads only then)
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
