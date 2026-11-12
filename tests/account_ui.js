/* Account page (Revise#314) with a stand-in Firebase (no network): the admin makes an account, the player logs in,
   saves and loads one deck (with the overwrite warning), switches to all decks, changes the player image, logs out.
   node tests/account_ui.js  (serves dist/aquarian-age-helper) */
const { chromium } = require("playwright"); const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "dist", "aquarian-age-helper");
const server = http.createServer((req, res) => { const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0])); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { "content-type": f.endsWith(".js") ? "text/javascript" : f.endsWith(".css") ? "text/css" : f.endsWith(".html") ? "text/html" : "application/octet-stream" }); fs.createReadStream(f).pipe(res); });
const fails = []; const check = (ok, m) => { if (!ok) fails.push(m); console.log((ok ? "  ✓ " : "  ✗ ") + m); };
// the stand-in: firebase compat API, enough for 08-account.js
const MOCK = () => {
  const data = {}, users = {}, listeners = []; let cur = null, n = 0;
  const get = p => p.split("/").filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), data);
  const put = (p, v) => { const ks = p.split("/").filter(Boolean), last = ks.pop(); let o = data; for (const k of ks) o = o[k] = o[k] && typeof o[k] === "object" ? o[k] : {}; if (v == null) delete o[last]; else o[last] = JSON.parse(JSON.stringify(v)); };
  const ref = p => ({ once: () => Promise.resolve({ val: () => { const v = get(p); return v == null ? null : JSON.parse(JSON.stringify(v)); } }), set: v => (put(p, v), Promise.resolve()), remove: () => (put(p, null), Promise.resolve()),
    update: o => { for (const [k, v] of Object.entries(o)) put(p + "/" + k, v); return Promise.resolve(); } });
  const mkUser = (email, uid, google) => ({ uid, email, providerData: [{ providerId: google ? "google.com" : "password" }], reauthenticateWithCredential: c => (users[email] && users[email].pw === c.pw ? Promise.resolve() : Promise.reject({ code: "auth/invalid-credential" })),
    updatePassword: pw => { users[cur.email].pw = pw; return Promise.resolve(); }, verifyBeforeUpdateEmail: () => Promise.resolve() });
  const fire = () => listeners.forEach(f => f(cur));
  const authFor = isMain => ({ get currentUser() { return cur; }, onAuthStateChanged: f => { listeners.push(f); setTimeout(() => f(cur), 0); },
    signInWithEmailAndPassword: (e, pw) => users[e] && users[e].pw === pw ? (cur = mkUser(e, users[e].uid), fire(), Promise.resolve({ user: cur })) : Promise.reject({ code: "auth/invalid-credential" }),
    signInWithPopup: () => { cur = mkUser("owner@example.com", "OWNER", true); fire(); return Promise.resolve({ user: cur }); },
    signOut: () => { if (isMain) { cur = null; fire(); } return Promise.resolve(); },
    createUserWithEmailAndPassword: (e, pw) => { if (users[e]) return Promise.reject({ code: "auth/email-already-in-use" }); const uid = "U" + (++n); users[e] = { pw, uid }; return Promise.resolve({ user: { uid } }); },
    sendPasswordResetEmail: e => { window.__resetTo = e; return Promise.resolve(); } });
  const mainAuth = authFor(true);
  const auth = () => mainAuth; auth.EmailAuthProvider = { credential: (e, pw) => ({ e, pw }) }; auth.GoogleAuthProvider = function () {};
  window.firebase = { apps: [1], auth, database: () => ({ ref }), initializeApp: () => ({ auth: () => authFor(false), database: () => ({ ref }), delete: () => Promise.resolve() }) };
  window.__fbData = data; window.__fbUsers = users;
};
server.listen(0, async () => {
  const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  await ctx.route(/drive\.google|googleusercontent|fonts\.|gstatic|cdnjs/, r => r.abort());
  const q = await ctx.newPage(); const errs = []; q.on("pageerror", e => errs.push(String(e)));
  await q.addInitScript(MOCK);
  const base = `http://localhost:${server.address().port}/index.html`;
  try {
    await q.goto(base);
    await q.evaluate(() => { window.AA_FIREBASE = { databaseURL: "https://x" }; const all = Object.values(window.AA_DATA ? {} : {}); });
    // admin makes an account
    await q.evaluate(() => { location.hash = "#addoge"; }); await q.waitForTimeout(400);
    await q.click("#openUsers"); await q.waitForTimeout(300); await q.click("#acUIn"); await q.waitForTimeout(300);
    await q.fill("#acUId", "Pack1"); await q.click("#acUNew button[type=submit]"); await q.waitForTimeout(400);
    const cred = await q.textContent("#acUCred").catch(() => "");
    const pw = (cred.match(/Password: (\S+)/) || [])[1] || "";
    check(/ID: pack1/.test(cred) && /^[A-HJ-NP-Za-km-np-z2-9]{8}$/.test(pw), "admin: account made, first password = 8 easy characters: " + cred.replace(/\n/g, " "));
    check(await q.evaluate(() => !!window.__fbData.ids.pack1 && window.__fbData.ids.pack1.email === "pack1@users.example.com"), "ids/pack1 → its login email");
    await q.evaluate(() => firebase.auth().signOut()); await q.click("#mclose").catch(() => {});
    // the player: Deck Builder → Account → log in
    await q.evaluate(() => { location.hash = ""; }); await q.click('[data-tab="deck"]'); await q.waitForTimeout(300);
    await q.evaluate(() => { const ks = Object.keys(window.__cards || {}); });
    await q.click("#btnAccount"); await q.waitForTimeout(300);
    check(await q.isVisible("#acId") && await q.isVisible("#acPw") && await q.isHidden("#deckpane"), "not logged in: only the login form");
    await q.fill("#acId", "pack1"); await q.fill("#acPw", "wrong-pass"); await q.click('#acctPane form[data-form=login] button[type=submit]'); await q.waitForTimeout(300);
    check(/wrong/.test(await q.textContent("#acctPane .acmsg")), "a wrong password is refused");
    await q.click("#acctPane a[data-ac=forgotOn]"); await q.fill("#acFid", "pack1"); await q.click('#acctPane form[data-form=forgot] button[type=submit]'); await q.waitForTimeout(300);
    check(/contact the admin/.test(await q.textContent("#acctPane .acmsg")), "forgot password without an email: contact the admin");
    await q.click("#acctPane [data-ac=forgotOff]");
    await q.fill("#acId", "Pack1"); await q.fill("#acPw", pw); await q.click('#acctPane form[data-form=login] button[type=submit]'); await q.waitForTimeout(500);
    check(await q.isVisible("#acctPane [data-ac=goOne]"), "logged in: Save / Load decks");
    check(await q.evaluate(() => AAAccount.state()) === "in", "logged in: Print Preview is open to this player (Revise#425)");
    // save one: slot 1 (the open deck, made non-empty) → account slot 3
    await q.evaluate(() => { deck.name = "Test deck A"; const k = Object.keys(window.AA_DATA && window.AA_DATA.cards || {}); });
    await q.evaluate(() => { const c = CARDS.find(x => x.t === "Character") || null; if (c) deck.cols.Character = [{ k: c.k, n: 3 }]; deckChanged(); AAAccount.open(); });
    if (process.env.DBG) { console.log("sheet open?", await q.evaluate(() => !document.getElementById("sheet").hidden), await q.evaluate(() => document.body.className)); await q.screenshot({ path: "/tmp/claude-0/-home-claude/bbf477b9-e9c7-5878-afdd-fa8b5b238b42/scratchpad/acdbg.png" }); }
    await q.click('#acctPane [data-ac=pick][data-side=L][data-slot="0"]'); await q.click('#acctPane [data-ac=pick][data-side=R][data-slot="2"]');
    await q.click("#acctPane [data-ac=goOne]"); await q.waitForTimeout(300);
    const saved = await q.evaluate(() => { const u = Object.values(window.__fbData.users)[0]; return u.slots && u.slots[2] && u.slots[2].name; });
    check(saved === "Test deck A", "save: slot 1 → account slot 3 (empty: no warning): " + saved);
    // pick, then re-click: deselect
    await q.click('#acctPane [data-ac=pick][data-side=L][data-slot="4"]'); await q.click('#acctPane [data-ac=pick][data-side=L][data-slot="4"]');
    check(await q.evaluate(() => !document.querySelector('#acctPane .acslot.on')), "a second tap un-picks");
    // an empty slot can't be saved; then save again onto the full slot → the overwrite warning, Cancel keeps it
    await q.click('#acctPane [data-ac=pick][data-side=L][data-slot="1"]'); await q.click('#acctPane [data-ac=pick][data-side=R][data-slot="2"]'); await q.click("#acctPane [data-ac=goOne]"); await q.waitForTimeout(200);
    check(/empty/.test(await q.textContent("#acctPane .acmsg")), "an empty slot is not saved over a deck");
    await q.click('#acctPane [data-ac=pick][data-side=R][data-slot="2"]');
    await q.evaluate(() => { deckSlots[1] = JSON.parse(JSON.stringify(deck)); deckSlots[1].name = "Test deck B"; AAAccount.open(); });
    /* slot 2 (L) stays picked */ await q.click('#acctPane [data-ac=pick][data-side=R][data-slot="2"]'); await q.click("#acctPane [data-ac=goOne]"); await q.waitForTimeout(200);
    const warn = await q.textContent("#mbody");
    check(/Overwrite/.test(warn) && /Test deck B \(Current\)[\s\S]*to[\s\S]*Test deck A \(Saved Data\)/.test(warn), "overwrite warning names both decks: " + warn.replace(/\s+/g, " ").slice(0, 120));
    await q.click("#acCancel"); await q.waitForTimeout(100);
    check(await q.evaluate(() => Object.values(window.__fbData.users)[0].slots[2].name) === "Test deck A", "Cancel: nothing written");
    // load: account slot 3 → slot 5
    await q.click('#acctPane [data-ac=mode][data-mode=load]');
    await q.click('#acctPane [data-ac=pick][data-side=L][data-slot="4"]'); await q.click("#acctPane [data-ac=goOne]"); await q.waitForTimeout(200);   // account slot 3 is still picked
    check(await q.evaluate(() => deckSlots[4] && deckSlots[4].name) === "Test deck A", "load: account slot 3 → slot 5");
    // all decks: the switch is kept in the account, Save all asks first
    await q.click("#acctPane [data-ac=deckMode]"); await q.waitForTimeout(200);
    check(await q.evaluate(() => Object.values(window.__fbData.users)[0].deckMode) === "all", "the One / All switch is saved to the account");
    await q.click('#acctPane [data-ac=mode][data-mode=save]'); await q.click("#acctPane [data-ac=goAll]"); await q.waitForTimeout(200);
    check(/All 50 slots/.test(await q.textContent("#mbody")), "Save all: a confirmation with the decks");
    await q.click("#acOk"); await q.waitForTimeout(300);
    check(await q.evaluate(() => Object.keys(Object.values(window.__fbData.users)[0].slots || {}).length >= 2), "Save all: written");
    // export from the account side
    await q.click('#acctPane [data-ac=export][data-side=R]'); await q.waitForTimeout(300);
    check(/Export · Saved data/.test(await q.textContent("#m-title")), "Export from the saved side");
    await q.click("#mclose");
    // profile: player image; then log out
    await q.click('#acctPane [data-ac=tab][data-tab=profile]'); await q.click('#acctPane [data-ac=avatar][data-v="p3"]'); await q.waitForTimeout(200);
    check(await q.evaluate(() => Object.values(window.__fbData.users)[0].avatar === "p3" && JSON.parse(localStorage.getItem("aa4-avatar")) === "p3"), "player image saved (account and Game Table)");
    await q.click('#acctPane [data-ac=pwOn]'); await q.fill("#acPw0", pw); await q.fill("#acPw1", "newpass99"); await q.fill("#acPw2", "newpass99"); await q.click('#acctPane form[data-form=pw] button[type=submit]'); await q.waitForTimeout(200);
    check(await q.evaluate(() => window.__fbUsers["pack1@users.example.com"].pw) === "newpass99", "password changed");
    await q.click('#acctPane [data-ac=logout]'); await q.waitForTimeout(200);
    check(await q.isVisible("#acId"), "logged out: the login form again");
    check(await q.evaluate(() => AAAccount.state()) === "out", "logged out: Print Preview is closed again (Revise#425)");
    // phone width: two columns still fit
    await q.setViewportSize({ width: 390, height: 800 }); await q.fill("#acId", "pack1"); await q.fill("#acPw", "newpass99"); await q.click('#acctPane form[data-form=login] button[type=submit]'); await q.waitForTimeout(400);
    await q.click('#acctPane [data-ac=tab][data-tab=decks]').catch(() => {});
    const ov = await q.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(ov <= 1, "phone: no sideways scroll: " + ov);
    await q.screenshot({ path: path.join(require("os").tmpdir(), "aa-account-phone.png"), fullPage: false });
    // Revise#320: request an account from the login page; the admin approves one, rejects another
    await q.setViewportSize({ width: 1280, height: 900 });
    await q.click('#acctPane [data-ac=logout]'); await q.waitForTimeout(200);
    await q.click("#acctPane a[data-ac=regOn]"); await q.fill("#acRid", "pack1"); await q.fill("#acRp1", "mypass123"); await q.fill("#acRp2", "mypass123"); await q.click('#acctPane form[data-form=reg] button[type=submit]'); await q.waitForTimeout(200);
    check(/taken/.test(await q.textContent("#acctPane .acmsg")), "request: a taken ID is refused");
    await q.fill("#acRid", "Newbie"); await q.fill("#acRem", "newbie@mail.test"); await q.fill("#acRp1", "newbie123"); await q.fill("#acRp2", "newbie123"); await q.click('#acctPane form[data-form=reg] button[type=submit]'); await q.waitForTimeout(200);
    check(await q.evaluate(() => { const r = window.__fbData.requests.newbie; return r && r.id === "newbie" && r.email === "newbie@mail.test" && !!r.uid && Object.keys(r).length === 3; }), "request kept: the ID, the email and the login link only");
    await q.click("#acctPane a[data-ac=regOn]"); await q.fill("#acRid", "nomail1"); await q.fill("#acRp1", "nomail123"); await q.fill("#acRp2", "nomail123"); await q.click('#acctPane form[data-form=reg] button[type=submit]'); await q.waitForTimeout(200);
    check(await q.evaluate(() => /@users\.example\.com$/.test((window.__fbData.requests.nomail1 || {}).login || "")), "a request without email gets a hidden login address");
    await q.click("#acctPane a[data-ac=regOn]"); await q.fill("#acRid", "spam1"); await q.fill("#acRp1", "spampass1"); await q.fill("#acRp2", "spampass1"); await q.click('#acctPane form[data-form=reg] button[type=submit]'); await q.waitForTimeout(200);
    await q.fill("#acId", "spam1"); await q.fill("#acPw", "whatever1"); await q.click('#acctPane form[data-form=login] button[type=submit]'); await q.waitForTimeout(300);
    check(/waiting for the admin/.test(await q.textContent("#acctPane .acmsg")), "login while pending: says the request is waiting");
    await q.click("#acctPane [data-ac=back]").catch(() => {});
    await q.evaluate(() => { location.hash = "#addoge"; }); await q.waitForTimeout(400);
    await q.click("#openRegs"); await q.waitForTimeout(300); await q.click("#acUIn"); await q.waitForTimeout(400);
    check(/Registration requests \(3\)/.test(await q.textContent("#acUReq")), "admin: three requests waiting");
    await q.click('#acUReq [data-u=approve][data-rid=newbie]'); await q.waitForTimeout(400);
    check(await q.evaluate(() => { const d = window.__fbData, r = d.ids.newbie; return !!r && r.email === "newbie@mail.test" && !!d.users[r.uid] && !d.requests.newbie; }), "approve: the requester's own login gets the account, request removed");
    check(/can log in now/.test(await q.textContent("#acUOk").catch(() => "")), "approve: says they can log in with their own password");
    await q.click('#acUReq [data-u=approve][data-rid=nomail1]'); await q.waitForTimeout(400);
    await q.evaluate(() => firebase.auth().signOut()); await q.click("#mclose").catch(() => {});
    await q.evaluate(() => { location.hash = ""; }); await q.click('[data-tab="deck"]'); await q.waitForTimeout(300);
    await q.click("#btnAccount"); await q.waitForTimeout(300);
    await q.fill("#acId", "nomail1"); await q.fill("#acPw", "nomail123"); await q.click('#acctPane form[data-form=login] button[type=submit]'); await q.waitForTimeout(400);
    check(await q.isVisible("#acctPane [data-ac=tab]").catch(() => false), "approved without email: logs in with the chosen password");
    await q.click("#acctPane [data-ac=logout]").catch(() => {}); await q.waitForTimeout(200);
    await q.evaluate(() => { location.hash = "#addoge"; }); await q.waitForTimeout(400);
    await q.click("#openRegs"); await q.waitForTimeout(300); if (await q.isVisible("#acUIn").catch(() => false)) { await q.click("#acUIn"); await q.waitForTimeout(400); }
    q.once("dialog", d => d.accept());
    await q.click('#acUReq [data-u=reject][data-rid=spam1]'); await q.waitForTimeout(300);
    check(await q.evaluate(() => !(window.__fbData.requests || {}).spam1 && !window.__fbData.ids.spam1), "reject: request removed, no account");
    // Revise#322: the header chip (like Gmail's), the player name for the Game Table
    await q.evaluate(() => firebase.auth().signOut()); await q.click("#mclose").catch(() => {}); await q.evaluate(() => { location.hash = ""; }); await q.click('[data-tab="home"]'); await q.waitForTimeout(300);
    check(/Log in/.test(await q.textContent("#hdrAcct")), "header: “Log in” when logged out");
    await q.click("#hdrAcct"); await q.waitForTimeout(150);
    check(await q.isVisible("#acctPop [data-pop=reg]"), "menu (logged out): log in / request an account");
    await q.click("#acctPop [data-pop=login]"); await q.waitForTimeout(300);
    check(await q.isVisible("#acId") && await q.evaluate(() => document.body.dataset.tab === "deck"), "menu → the login page in the Deck Builder");
    await q.fill("#acId", "pack1"); await q.fill("#acPw", "newpass99"); await q.click('#acctPane form[data-form=login] button[type=submit]'); await q.waitForTimeout(500);
    check(/pack1/.test(await q.textContent("#hdrAcct")) && await q.isVisible("#hdrAcct img"), "header: the small picture and the name after login");
    check(await q.evaluate(() => JSON.parse(localStorage.getItem("aa-pname"))) === "pack1", "login: the Game Table name defaults to the account's player name");
    await q.click("#hdrAcct"); await q.waitForTimeout(150);
    await q.screenshot({ path: path.join(require("os").tmpdir(), "aa-account-menu.png") });
    await q.click("#acctPop [data-pop=profile]"); await q.waitForTimeout(300);
    await q.fill("#acPn", "Pack the Great"); await q.click('#acctPane form[data-form=pname] button[type=submit]'); await q.waitForTimeout(300);
    check(/Pack the Great/.test(await q.textContent("#hdrAcct")) && await q.evaluate(() => JSON.parse(localStorage.getItem("aa-pname")) === "Pack the Great" && Object.values(window.__fbData.users).some(u => u.playerName === "Pack the Great")), "player name saved: account, header and Game Table");
    await q.setViewportSize({ width: 390, height: 800 }); await q.waitForTimeout(150);
    await q.click("#hdrAcct"); await q.waitForTimeout(150);
    check(await q.evaluate(() => { const r = document.getElementById("acctPop").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }), "phone: the menu fits the screen");
    await q.screenshot({ path: path.join(require("os").tmpdir(), "aa-account-menu-phone.png") });
    await q.click("#acctPop [data-pop=out]"); await q.waitForTimeout(300);
    check(/Log in/.test(await q.textContent("#hdrAcct")), "log out from the menu");
    await q.setViewportSize({ width: 1280, height: 900 });
    // Revise#337: the owner's Google sign-in is the admin account "sakhudoge" (made for it the first time)
    await q.evaluate(() => firebase.auth().signOut()); await q.click("#mclose").catch(() => {});
    await q.evaluate(() => { location.hash = ""; }); await q.click('[data-tab="deck"]'); await q.waitForTimeout(300);
    await q.click("#hdrAcct"); await q.waitForTimeout(150); await q.click("#acctPop [data-pop=login]"); await q.waitForTimeout(300);
    await q.click("#acctPane a[data-ac=google]"); await q.waitForTimeout(600);
    check(/sakhudoge/.test(await q.textContent("#hdrAcct")) && await q.evaluate(() => { const d = window.__fbData; return d.ids.sakhudoge && d.ids.sakhudoge.uid === "OWNER" && d.users.OWNER && d.users.OWNER.id === "sakhudoge"; }), "owner Google sign-in = the account sakhudoge (no more “no deck account”)");
    check(await q.isVisible("#acctPane [data-ac=tab]"), "… with Save / Load decks and Profile");
    await q.click("#hdrAcct"); await q.waitForTimeout(150);
    check(await q.isVisible("#acctPop [data-pop=admin]"), "the admin account's menu has “Admin page”");
    await q.click("#acctPop [data-pop=admin]"); await q.waitForTimeout(400);
    check(await q.evaluate(() => document.body.dataset.tab === "addoge"), "… which opens the admin page");
    await q.click("#openUsers"); await q.waitForTimeout(500);
    check(/Accounts \(\d+\)/.test(await q.textContent("#acUBody")) && /Admin account: sakhudoge/.test(await q.textContent("#acUWho")), "Users opens for the admin account, without the Google sign-in");
    await q.click("#mclose").catch(() => {});
    await q.click("#hdrAcct"); await q.waitForTimeout(150); await q.click("#acctPop [data-pop=out]"); await q.waitForTimeout(300);
    await q.click("#hdrAcct"); await q.waitForTimeout(150); await q.click("#acctPop [data-pop=login]"); await q.waitForTimeout(300);
    await q.fill("#acId", "pack1"); await q.fill("#acPw", "newpass99"); await q.click('#acctPane form[data-form=login] button[type=submit]'); await q.waitForTimeout(500);
    await q.click("#hdrAcct"); await q.waitForTimeout(150);
    check(!(await q.isVisible("#acctPop [data-pop=admin]").catch(() => false)), "another account has no “Admin page”");
    await q.click("#acctPop [data-pop=close]"); await q.evaluate(() => { location.hash = "#addoge"; }); await q.waitForTimeout(300);
    await q.click("#openUsers"); await q.waitForTimeout(500);
    check(/Owner sign-in/.test(await q.textContent("#acUWho")), "… and Users stays closed to it");
    // ---- Revise#390: the decks belong to the account ----
    const ctx2 = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    await ctx2.route(/drive\.google|googleusercontent|fonts\.|gstatic|cdnjs/, r => r.abort());
    const s = await ctx2.newPage(); s.on("pageerror", e => errs.push(String(e)));
    await s.addInitScript(MOCK); await s.goto(base);
    await s.evaluate(() => { window.AA_FIREBASE = { databaseURL: "https://x" }; const em = "sync1@users.example.com", cols = n => ({ Character: [{ k: CARDS.find(c => c.cat === "Character" || c.type === "Character" || true).k, n }], Break: [], Fast: [], Project: [], Permanent: [] });
      window.__fbUsers[em] = { pw: "syncpass1", uid: "S1" }; window.__fbData.ids = { sync1: { uid: "S1", email: em } };
      window.__fbData.users = { S1: { id: "sync1", playerName: "sync1", email: em, avatar: "p1", deckMode: "one", created: 1, slots: { 0: { name: "Account deck", cols: cols(4) } } } }; window.__cols = cols; });
    const login = async () => { if (!(await s.isVisible("#acId").catch(() => false))) { await s.click('[data-tab="deck"]'); await s.waitForTimeout(200); await s.click("#btnAccount"); await s.waitForTimeout(200); } await s.fill("#acId", "sync1"); await s.fill("#acPw", "syncpass1"); await s.click('#acctPane form[data-form=login] button[type=submit]'); await s.waitForTimeout(500); };
    const logout = async () => { await s.evaluate(() => firebase.auth().signOut()); await s.waitForTimeout(300); };
    await login();
    check(await s.evaluate(() => deckSlots[0] && deckSlots[0].name === "Account deck" && deck.name === "Account deck"), "first login on a device without decks: the account's decks are loaded");
    check(/kept in your account/.test(await s.textContent("#acctPane .acsynced").catch(() => "")) && !(await s.$("#acctPane .acmerge")), "the Account page says the decks are kept in the account");
    await s.evaluate(() => { deck.name = "Renamed here"; saveSlots(); }); await s.waitForTimeout(1700);
    check(await s.evaluate(() => window.__fbData.users.S1.slots[0].name === "Renamed here"), "a change in the Deck Builder is saved to the account by itself");
    await logout();
    await s.evaluate(() => { window.__fbData.users.S1.slots[1] = { name: "From another device", cols: window.__cols(3) }; });   // only the account changed
    await login();
    check(await s.evaluate(() => deckSlots[1] && deckSlots[1].name === "From another device" && deckSlots[0].name === "Renamed here"), "only the account changed (another device): its decks come to this device");
    await logout();
    await s.evaluate(() => { deck.name = "Edited while logged out"; saveSlots(); }); await s.waitForTimeout(100);   // the device changed while logged out
    await login(); await s.waitForTimeout(300);
    const rp = await s.evaluate(() => ({ local: deckSlots[0].name, acc: window.__fbData.users.S1.slots[0].name, merge: !!document.querySelector("#acctPane .acmerge") }));
    check(rp.local === "Renamed here" && rp.acc === "Renamed here" && !rp.merge, "Revise#393: signed in → the device's decks are replaced by the account's, no merge step: " + JSON.stringify(rp));
    await logout();
    await s.evaluate(() => { deck.name = "Device version"; saveSlots(); window.__fbData.users.S1.slots[0].name = "Account version"; });   // both changed
    await login(); await s.waitForTimeout(300);
    const bt = await s.evaluate(() => ({ local: deckSlots[0].name, acc: window.__fbData.users.S1.slots[0].name, sync: (JSON.parse(localStorage.getItem("aa-sync") || "null") || {}).uid }));
    check(bt.local === "Account version" && bt.acc === "Account version" && bt.sync === "S1", "both changed: the account's decks win: " + JSON.stringify(bt));
    await s.evaluate(() => { deck.name = "New deck name"; saveSlots(); }); await s.waitForTimeout(1700);
    check(await s.evaluate(() => window.__fbData.users.S1.slots[0].name === "New deck name"), "and every change after it goes to the account by itself");
    await logout();
    await s.evaluate(() => { const em = "sync2@users.example.com"; window.__fbUsers[em] = { pw: "syncpass2", uid: "S2" }; window.__fbData.ids.sync2 = { uid: "S2", email: em }; window.__fbData.users.S2 = { id: "sync2", playerName: "sync2", email: em, avatar: "p1", deckMode: "one", created: 2 }; });
    if (!(await s.isVisible("#acId").catch(() => false))) { await s.click('[data-tab="deck"]'); await s.waitForTimeout(200); await s.click("#btnAccount"); await s.waitForTimeout(200); }
    await s.fill("#acId", "sync2"); await s.fill("#acPw", "syncpass2"); await s.click('#acctPane form[data-form=login] button[type=submit]'); await s.waitForTimeout(700);
    const nw = await s.evaluate(() => ({ local: deckSlots[0] && deckSlots[0].name, acc: ((window.__fbData.users.S2.slots || {})[0] || {}).name }));
    check(nw.local === "New deck name" && nw.acc === "New deck name", "an account that never held a deck: the device's decks are kept and saved to it: " + JSON.stringify(nw));
    await ctx2.close();
  } catch (e) { check(false, "error: " + (e && e.message || e)); }
  check(!errs.length, "no page errors " + errs.join(" | "));
  await b.close(); server.close();
  console.log(fails.length ? fails.length + " failed" : "all passed");
  process.exit(fails.length ? 1 : 0);
});
