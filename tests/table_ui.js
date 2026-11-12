#!/usr/bin/env node
/* v4 game table · browser tests (Playwright, Chromium)

     python3 build.py && node tests/table_ui.js [screenshot folder]

   Serves dist/aquarian-age-helper on a local port, puts two decks from the real card list into the Deck
   Builder slots, then: Solo one deck (several turns by clicking), a two-tab test room, a 4-player test room
   (layout of Revise#054), Solo two decks on a phone, and a full attack (menu → pay → No guard → priority
   passes → damage), Undo across tabs and a field effect by hand. Fails on any page error. Card images are
   blocked (no network needed). */
"use strict";
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium, devices } = require("playwright");
const ROOT = path.join(__dirname, "..", "dist", "aquarian-age-helper");
const SHOTS = process.argv[2] || path.join(require("os").tmpdir(), "aa4-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg" };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
});
const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); console.log((ok ? "  ✓ " : "  ✗ ") + msg); };
server.listen(0, async () => {
  const URL = `http://localhost:${server.address().port}/table.html`;
  let errs = [];
  try {
    await (async () => {
      const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
      ctx.on("page", p => p.on("pageerror", e => errs.push(String(e))));
      await ctx.route(/drive\.google|googleusercontent|fonts\./, r => r.abort());
      const log = (...a) => console.log("   ", ...a);

  
  
  // block outside images (no network here): faster
  
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(String(e)));
  await p.goto(URL);
  // two decks from the real card list into the Deck Builder slots
  await p.evaluate(() => {
    const all = TB.db.all(), pick = (f, t, n) => all.filter(c => c.faction === f && c.type === t).slice(0, n);
    const mk = (name, f) => ({ name, cols: { Character: pick(f, "Character", 12).map(c => ({ k: c.key, n: 2 })), Break: pick(f, "Break", 6).map(c => ({ k: c.key, n: 2 })), Fast: pick(f, "Fast", 2).map(c => ({ k: c.key, n: 2 })), Project: pick(f, "Project", 2).map(c => ({ k: c.key, n: 1 })), Permanent: pick(f, "Permanent", 2).map(c => ({ k: c.key, n: 1 })) } });
    localStorage.setItem("aa-decks", JSON.stringify([mk("E.G.O. test", "E.G.O."), mk("Darklore test", "Darklore")]));
  });
  await p.reload(); await p.waitForTimeout(300);
  await p.screenshot({ path: SHOTS + '/1-lobby.png' });
  { // Revise#379: Campaign Mode under Solo (Beta), Replay under Online, Hard / Hell not selectable, Campaign Design
    const c = await p.evaluate(() => { const col = document.querySelectorAll('.lgrid.lcols > .lcol'), h = el => [...el.querySelectorAll(':scope > .lbox > h2')].map(x => x.textContent);
      return { left: col[0] ? h(col[0]) : [], right: col[1] ? h(col[1]) : [], beta: !!document.querySelector('.lcamp .cpbeta'), diffs: [...document.querySelectorAll('.cpdiff')].map(b => [b.dataset.cpdiff, b.disabled, b.classList.contains('on')]), random: document.getElementById('cpRandom').checked, opp: !!document.getElementById('cpOpp'), design: !!document.querySelector('.lcamp .cdentry a[href="#campaigndesign"]') }; });
    check(c.left.join() === "Solo,Campaign" && c.right.join() === "Online,Replay" && c.beta, "lobby: Campaign under Solo with a Beta mark, Replay under Online: " + JSON.stringify([c.left, c.right]));
    check(JSON.stringify(c.diffs) === JSON.stringify([["easy", false, false], ["medium", false, true], ["hard", false, false], ["hell", true, false]]), "Campaign: Medium by default; Hell (no deck yet) not selectable: " + JSON.stringify(c.diffs));
    check(c.random && !c.opp && c.design, "Campaign: Random Opponent ticked (no opponent list), the Campaign Design link at the bottom");
    await p.uncheck('#cpRandom'); await p.waitForTimeout(150);
    const o = await p.evaluate(() => [...document.querySelectorAll('#cpOpp option')].map(x => x.value));
    check(o.length >= 1, "Random Opponent off: the opponent list of that difficulty: " + o.join());
    await p.click('[data-cpdiff=easy]'); await p.waitForTimeout(150);
    const e = await p.evaluate(() => [...document.querySelectorAll('#cpOpp option')].length);
    check(e >= 2, "Easy: its own list (" + e + " decks)");
    await p.click('.cdentry a'); await p.waitForTimeout(250);   // Revise#382: Campaign Design is its own page, table.html#campaigndesign
    const pg = await p.evaluate(() => ({ hash: location.hash, page: !!document.querySelector('.cdpage'), lobby: !!document.querySelector('.lobby') }));
    check(pg.hash === "#campaigndesign" && pg.page && !pg.lobby, "Campaign Design opens as the page #campaigndesign: " + JSON.stringify(pg));
    await p.click('[data-cd=import]'); await p.waitForTimeout(200);
    const cols = await p.evaluate(() => [...document.querySelectorAll('.cdmain .cdcolhead span')].map(x => x.textContent));
    check(cols.length === 6 && /^Character · /.test(cols[0]) && cols[1] === "Character · other" && cols.slice(2).join() === "Break,Fast,Project,Permanent" && await p.$('.cdmain .cditem .card') !== null && /^× \d+$/.test(await p.textContent('.cdmain .cditem .cdn')), "the deck as the Deck Builder shows it: six columns of card pictures × n: " + cols.join(" | "));
    await p.selectOption('[data-cdf=strategy]', 'hero'); await p.waitForTimeout(100);
    await p.click('[data-cd=pick][data-g=mainBreak]'); await p.waitForTimeout(150);
    const pk = await p.evaluate(() => ({ on: document.querySelectorAll('.cdpick .cditem.pick:not(.off)').length, off: document.querySelectorAll('.cdpick .cditem.pick.off').length, breaks: document.querySelectorAll('.cdpick .cdcol:nth-child(3) .cditem.pick:not(.off)').length }));
    check(pk.on > 0 && pk.off > 0 && pk.on === pk.breaks, "Main Break: a pop-up of the deck picture, only the Break cards can be chosen: " + JSON.stringify(pk));
    await p.click('.cdpick .cditem.pick:not(.off)'); await p.waitForTimeout(80);
    check(await p.evaluate(() => JSON.parse(localStorage.getItem('aa4-cdesign')).style.mainBreak) === null, "nothing is taken before Apply");
    await p.click('[data-cd=pickapply]'); await p.waitForTimeout(150);
    await p.check('input[name=cdm-special][value=select]'); await p.waitForTimeout(100); await p.click('[data-cd=pick][data-g=special]'); await p.waitForTimeout(150);
    const sp = await p.$$('.cdpick .cditem.pick:not(.off)'); await sp[0].click(); await p.waitForTimeout(60); await (await p.$$('.cdpick .cditem.pick:not(.off)'))[sp.length - 1].click(); await p.waitForTimeout(60); await p.click('[data-cd=pickapply]'); await p.waitForTimeout(150);
    await p.check('input[name=cdm-attackers][value=select]'); await p.waitForTimeout(100); await p.click('[data-cd=pick][data-g=attackers]'); await p.waitForTimeout(150); await p.click('.cdpick .cditem.pick:not(.off)'); await p.click('[data-cd=pickapply]'); await p.waitForTimeout(150);
    const d = await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('aa4-cdesign')); return { n: s.deck.keys.length, st: s.style.strategy, mb: !!s.style.mainBreak, sp: s.style.special.list.length, at: s.style.attackers.list.length, pic: !!document.querySelector('.cdside .cdlist .cdpic .card'), perm: !!document.querySelector('.cdside .cdlist select[data-k=perm]'), wait: !!document.querySelector('.cdside .cdlist input[data-k=wait]'), crit: document.querySelectorAll('input[name=cdcrit]').length }; });
    check(d.n > 0 && d.st === "hero" && d.mb && d.sp === 2 && d.at === 1 && d.pic && d.perm && d.wait && d.crit === 2, "Playstyle in the sidebar: Main Break and Special Priority chosen from the deck (Apply), a Main Attacker with its picture, Permanent card, Wait for permanent?, Critical number: " + JSON.stringify(d));
    await p.screenshot({ path: SHOTS + '/45-campaign-design.png', fullPage: true });
    await p.click('[data-cd=fold]'); await p.waitForTimeout(150);
    const fw = await p.evaluate(() => [Math.round(document.querySelector('.cdside').getBoundingClientRect().width), !!document.querySelector('.cdsidebody')]);
    check(fw[0] < 60 && !fw[1], "the Playstyle sidebar folds away: " + fw[0] + " px");
    await p.click('[data-cd=fold]'); await p.waitForTimeout(100); await p.click('[data-cd=clear]'); await p.waitForTimeout(100);
    await p.click('[data-cd=back]'); await p.waitForTimeout(200);
    check(await p.$('.lobby') !== null && await p.evaluate(() => location.hash) === "", "← Game Table goes back to the lobby");
    await p.check('#cpRandom'); await p.waitForTimeout(100); }
  await p.uncheck('#lTogether'); await p.uncheck('#lSituation');   // the older checks below were written for these OFF (both ON by default since Revise#225)
  await p.click('[data-act=solo1]'); await p.waitForTimeout(300);
  await p.screenshot({ path: SHOTS + '/2-mulligan.png' });
  { check(await p.$('[data-act=autoMulligan]') !== null && await p.$('.hcheck') !== null, "opening hand: Auto Re-shuffle and what it looks for (Revise#234)");
    await p.click('[data-act=autoMulligan]'); await p.waitForTimeout(400);
    const am = await p.evaluate(() => { const S = TB.ui.log.state, me = TB.mySeats()[0], m = S.players[me].autoMsg, box = document.querySelector('.modal.automsg'); return { ok: m && m.ok, tries: m && m.tries, box: box ? box.textContent : null, hand: S.players[me].zones.hand.length, mull: S.players[me].mulligans, auto: S.players[me].autoMulls }; });
    check(am.hand === 7 && (am.ok ? !am.box && am.mull === 0 && am.auto === 0 : /You are SCREWED!/.test(am.box || "") && am.tries === 10), "Auto Re-shuffle: a match resets the counters, or after 10 a message box: " + JSON.stringify(am));
    if (am.box) { await p.screenshot({ path: SHOTS + '/28-auto-reshuffle.png' }); await p.click('.modal.automsg [data-act=autoMsgOk]'); await p.waitForTimeout(150); check(await p.$('.modal.automsg') === null, "OK closes it"); } }
  await p.click('[data-act=keep]'); await p.waitForTimeout(300);
  const st = await p.evaluate(() => [TB.ui.log.state.stage, TB.ui.log.state.turn.phase]);
  { const ph = await p.evaluate(() => { const t = document.querySelector('.tph'); return t ? { mine: t.classList.contains('tmine'), c: getComputedStyle(t).getPropertyValue('--phc').trim() } : null; });
    check(ph && ph.mine && /^#[0-9a-f]{6}$/i.test(ph.c), "phase box: your turn uses the blue set (Revise#223): " + JSON.stringify(ph)); }
  log('after keep', st);
  { // Revise#336: Sort hand, beside the fold button
    const before = await p.evaluate(() => TB.ui.log.state.players[TB.viewSeat()].zones.hand.slice());
    const pos = await p.evaluate(() => { const a = document.querySelector('#hand [data-act=handSort]'), f = document.querySelector('#hand [data-act=fold]'); return a && f ? Math.round(f.getBoundingClientRect().left - a.getBoundingClientRect().right) : null; });
    check(pos != null && pos >= 0 && pos < 16, "Sort hand button just left of the fold button: " + pos);
    await p.click('#hand [data-act=handSort]'); await p.waitForTimeout(250);
    const r = await p.evaluate(b => { const s = TB.ui.log.state, h = s.players[TB.viewSeat()].zones.hand, F = AA4.FACTIONS.map(x => x.name), T = ["Character", "Break", "Permanent", "Fast", "Project"];
      const k = id => { const i = TB.db.card(s.cards[id].key) || {}, n = v => (typeof v === "number" ? v : +v || 0); return [F.indexOf(i.faction) < 0 ? 99 : F.indexOf(i.faction), n(i.se), n(i.cost), Object.values(i.factor || {}).reduce((x, y) => x + y, 0), T.indexOf(i.type)]; };
      const cmp = (x, y) => { for (let j = 0; j < 5; j++) if (x[j] !== y[j]) return x[j] - y[j]; return 0; };
      return { same: h.slice().sort().join() === b.slice().sort().join(), sorted: h.every((id, j) => j === 0 || cmp(k(h[j - 1]), k(id)) <= 0), n: h.length }; }, before);
    check(r.same && r.sorted, "Sort hand: the same cards, by faction → Mental → cost → Factor → type: " + JSON.stringify(r));
    await p.screenshot({ path: SHOTS + '/42-hand-sort.png' }); }
  { // Revise#373: hand card size S / M / L, the same slider as Control · Back
    const w = () => p.evaluate(() => Math.round(document.querySelector('#hand .hc .card').getBoundingClientRect().width));
    const w0 = await w();
    await p.evaluate(() => { const el = document.getElementById('handZ'); el.value = "0"; el.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(200);
    const w1 = await w(), saved = await p.evaluate(() => [TB.ui.handZ, document.getElementById('hand').classList.contains('hz-S')]);
    check(w1 < w0 * .7 && saved[0] === "S" && saved[1], "hand size S: the cards are much smaller: " + w1 + " / " + w0);
    await p.screenshot({ path: SHOTS + '/44-hand-size.png' });
    await p.evaluate(() => { const el = document.getElementById('handZ'); el.value = "2"; el.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(200);
    check(await w() === w0, "hand size L: back to the card size"); }
  { // Revise#371: fixed hand position (the pin beside Expand) — a bar at the bottom of the field; an empty hand keeps its height
    const gap = await p.evaluate(() => { const a = document.querySelector('#hand [data-act=handDock]'), f = document.querySelector('#hand [data-act=handBig]'); return a && f ? Math.round(f.getBoundingClientRect().left - a.getBoundingClientRect().right) : null; });
    check(gap != null && gap >= 0 && gap < 16, "Fixed hand button just left of Expand: " + gap);
    const h0 = await p.evaluate(() => Math.round(document.getElementById('hand').getBoundingClientRect().height));
    await p.click('#hand [data-act=handDock]'); await p.waitForTimeout(200);
    const d = await p.evaluate(() => { const r = document.getElementById('hand').getBoundingClientRect(), tw = document.getElementById('tablewrap').getBoundingClientRect(); return { left: Math.round(r.left), bottom: Math.round(innerHeight - r.bottom), w: Math.round(r.width), tw: Math.round(tw.width), on: document.querySelector('#hand [data-act=handDock]').getAttribute('aria-pressed') }; });
    check(d.left === 0 && d.bottom === 0 && Math.abs(d.w - d.tw) <= 1 && d.on === "true", "Fixed hand: at the bottom of the field, as wide as the field: " + JSON.stringify(d));
    await p.screenshot({ path: SHOTS + '/43-hand-fixed.png' });
    await p.click('#hand [data-act=handDock]'); await p.waitForTimeout(200);
    const h1 = await p.evaluate(() => { const S = TB.ui.log.state, P = S.players[TB.viewSeat()], keep = P.zones.hand; P.zones.hand = []; TB.render(); const h = Math.round(document.getElementById('hand').getBoundingClientRect().height); P.zones.hand = keep; TB.render(); return h; });
    check(h1 === h0, "an empty hand is as tall as a full one: " + h1 + " / " + h0); }
  { // Revise#335: the card size slider at the top right of your own field
    const z0 = await p.evaluate(() => { const el = document.querySelector('.board.bottom .bh #sizeTop'), b = document.querySelector('.board.bottom .bh').getBoundingClientRect(), r = el && el.closest('.bhsize').getBoundingClientRect(); return el ? { v: +el.value, right: Math.round(b.right - r.right), n: document.querySelectorAll('#sizeTop').length } : null; });
    check(z0 && z0.right >= 0 && z0.right < 24 && z0.n === 1, "card size slider at the top right of your field (only yours): " + JSON.stringify(z0));
    await p.evaluate(() => { const el = document.getElementById('sizeTop'); el.value = "2"; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
    await p.waitForTimeout(200);
    check(await p.evaluate(() => TB.ui.size === 2 && document.getElementById('sizeTopLv').textContent === "Lv 2" && !TB.ui.modal), "moving it changes the card size (and does not open the hand)");
    await p.screenshot({ path: SHOTS + '/41-size-top.png' });
    await p.evaluate(z => { const el = document.getElementById('sizeTop'); el.value = String(z); el.dispatchEvent(new Event('change', { bubbles: true })); }, z0.v); await p.waitForTimeout(200); }
  { // Revise#323: an expanded hand at the bottom never hides the Control Area (Back): scrolled to the end, the last row is above the hand
    await p.click('[data-act=handBig]'); await p.waitForTimeout(250);
    const r = await p.evaluate(() => { const tw = document.getElementById('tablewrap'); tw.scrollTop = tw.scrollHeight; const rows = document.querySelectorAll('.board.bottom .row.back'), back = rows[rows.length - 1], h = document.getElementById('hand'); return back && h ? { back: Math.round(back.getBoundingClientRect().bottom), hand: Math.round(h.getBoundingClientRect().top) } : null; });
    check(r && r.back <= r.hand + 1, "expanded hand: Control (Back) fully visible above it when scrolled down: " + JSON.stringify(r));
    await p.screenshot({ path: SHOTS + '/40-hand-room.png' });
    await p.click('[data-act=handBig]'); await p.waitForTimeout(200); }
  { const hh = await p.evaluate(() => { const h = document.querySelector('#hand'), first = h && h.firstElementChild; return first ? first.id : null; });
    check(hh === "handHead", "the hand's title bar is at its top (drag it); the Charge window sits at the bottom of the hand (Revise#224): " + hh); }
  { const pt = await p.evaluate(() => { const b = document.querySelector('.board.bottom'), t = b && b.querySelector('.piles .pile.player'), d = b && b.querySelector('.piles .pile.deck .card'), last = b && b.querySelector('.piles').lastElementChild;
      return t ? { src: t.querySelector('img').getAttribute('src'), w: Math.round(t.querySelector('.card').getBoundingClientRect().width), dw: d ? Math.round(d.getBoundingClientRect().width) : 0, last: last && last.contains(t), name: t.querySelector('.pname').textContent, chars: Object.keys(TB.ui.log.state.chars).length } : null; });
    check(pt && /players\/p1\.jpg$/.test(pt.src) && pt.w === pt.dw && pt.last && pt.name.length > 0, "the Player at the bottom right of the field, the size of the Deck (Revise#214): " + JSON.stringify(pt));
    await p.click('.board.bottom .pile.player'); await p.waitForTimeout(200);
    check(await p.$('.modal.pmodal .pmstats') !== null && /Effects on this player/.test(await p.$eval('.modal.pmodal', m => m.textContent)), "clicking the Player shows its stats, skills and effects");
    await p.screenshot({ path: SHOTS + '/24-player-details.png' });
    await p.click('.modal.pmodal [data-act=close]'); await p.waitForTimeout(150); }
  if (await p.evaluate(() => TB.ui.log.state.turn.phase) === "active") { await p.click('[data-act=next]'); await p.waitForTimeout(200); }   // → Main
  // set a character from the hand by clicking it
  const played = await p.evaluate(() => document.querySelectorAll('#hand .card.play').length);
  log('playable in hand', played);
  for (let k = 0; k < 3; k++) {
    const c = await p.$('#hand .card.play'); if (!c) break;
    await c.click(); await p.waitForTimeout(150);
    if (await p.$('.menu')) { await p.click('.menu button:not([disabled])'); await p.waitForTimeout(150); }
  }
  await p.screenshot({ path: SHOTS + '/3-main.png' });
  log('chars on field', await p.evaluate(() => Object.keys(TB.ui.log.state.chars).length));
  // card details (right click)
  const ch = await p.$('.ch'); if (ch) { await ch.click({ button: 'right' }); await p.waitForTimeout(150); await p.screenshot({ path: SHOTS + '/4-details.png' });
    const tb = await p.evaluate(() => { const t = document.querySelector('.modal .cur-status table.stt'); return t ? { head: [...t.querySelectorAll('th')].map(x => x.textContent).join(","), first: t.querySelector('tbody tr').textContent.slice(0, 7), last: t.querySelector('tr.tot td').textContent, q: !!document.querySelector('.modal .cur-status .curh .lhelp') } : null; });
    check(tb && tb.head === "Source,Mental,Attack,Defense,Power,Skill" && tb.first === "Printed" && tb.last === "Now" && tb.q, "card details: Status as a table (Source · Mental · Attack · Defense · Power · Skill), the older text in a “?” (Revise#224): " + JSON.stringify(tb));
    await p.click('[data-act=close]'); }
  // play several turns through the buttons
  for (let k = 0; k < 40; k++) {
    const s = await p.evaluate(() => { const S = TB.ui.log.state; return [S.stage, S.turn.number, S.turn.phase, S.decisions.length, !!S.draft]; });
    if (s[0] === 'over' || s[1] > 5) break;
    if (s[3]) { const o = await p.$('.modal.dec [data-act=choose], .modal.dec [data-dopt]'); if (o) await o.click(); const ok = await p.$('.modal.dec [data-act=dconfirm]:not([disabled])'); if (ok) await ok.click(); await p.waitForTimeout(80); continue; }
    if (s[2] === 'charge') { const h = await p.$('#hand .card.play'); if (h) { await h.click(); await p.waitForTimeout(80); const t = await p.$('.ch.tgt'); if (t) { await t.click(); await p.waitForTimeout(80); continue; } } }
    const nb = await p.$('[data-act=next]:not([disabled])'), pb = await p.$('[data-act=pass]'), ng = await p.$('[data-act=noGuard]');
    if (ng) await ng.click(); else if (pb) await pb.click(); else if (nb) await nb.click(); else break;
    await p.waitForTimeout(80);
  }
  log('solo reached', await p.evaluate(() => { const S = TB.ui.log.state; return [S.stage, S.turn.number, S.turn.phase]; }));
  await p.screenshot({ path: SHOTS + '/5-later.png' });
  await p.click('[data-act=leave]'); await p.waitForTimeout(200);

  // Resolve list layout (Revise#196): a declared Break card waits in Resolve — its "Card" label on one row, the card below
  await p.uncheck('#lTogether'); await p.uncheck('#lSituation'); await p.click('[data-act=solo1]'); await p.waitForTimeout(300); await p.click('[data-act=keep]'); await p.waitForTimeout(300);
  if (await p.evaluate(() => TB.ui.log.state.turn.phase) === "active") { await p.click('[data-act=next]'); await p.waitForTimeout(200); }
  { const ok = await p.evaluate(() => {
      const S = () => TB.ui.log.state, me = TB.viewSeat(), P = () => S().players[me];
      const ch = P().zones.hand.concat(P().zones.deck).find(id => TB.db.card(S().cards[id].key).type === "Character");
      TB.send({ t: "move", seat: me, card: ch, to: { z: "front" } });
      const chId = AA4.charOfCard(S(), ch).id;
      for (let i = 0; i < 4; i++) { const d = P().zones.deck; TB.send({ t: "move", seat: me, card: d[d.length - 1], to: { z: "char", ch: chId, role: "power" } }); }
      const brk = P().zones.deck.concat(P().zones.hand).find(id => { const c = TB.db.card(S().cards[id].key); return c.type === "Break" && AA4.breakReason && !AA4.breakReason(S(), TB.db, me, id, chId) && typeof c.cost === "number" && c.cost <= 4; });
      if (!brk) return false;
      if (S().cards[brk].place.z !== "hand") TB.send({ t: "move", seat: me, card: brk, to: { z: "hand" } });
      if (!TB.send({ t: "declare", seat: me, kind: "set", card: brk })) return false;
      for (let k = 0; k < 4 && S().draft; k++) { const d = S().draft; if (d.step === "pay") TB.send({ t: "pay", seat: me, cards: d.payFrom.flatMap(c => S().chars[c].power).slice(0, d.cost) }); else if (d.step === "target") TB.send({ t: "target", seat: me, targets: [{ ch: chId }] }); else break; }
      return S().stack.length > 0;
    });
    await p.waitForTimeout(200);
    if (ok) {
      const lay = await p.$$eval('.stack .rinfo', xs => xs.map(x => { const l = x.querySelector('.rl').getBoundingClientRect(), c = x.querySelector('.rcards').getBoundingClientRect(); return c.top >= l.bottom - 1; }));
      check(lay.length > 0 && lay.every(Boolean), "Resolve: each label on its own row, its cards on the row below (Revise#196): " + JSON.stringify(lay));
      const stp = await p.$$eval('.stack li:first-child .ist .bsx', xs => xs.map(x => x.textContent + (x.classList.contains('on') ? "*" : "")));
      check(stp.join(">") === "Break>Response*>Resolve", "Resolve: a Break declaration shows Break › Response › Resolve, Response now (Revise#206): " + stp.join(">"));
      const lc = await p.$$eval('#logLines > div', ds => ds.map(d => d.className));
      check(lc.length && lc.every(c => /lc-|lgout/.test(c)), "log lines have a background by kind (Revise#206)");
      const rs = await p.$('.resolve'); if (rs) await rs.screenshot({ path: SHOTS + '/22-resolve-rows.png' });
    } else log('resolve layout: no Break card to declare in this deck — skipped');
  }
  await p.click('[data-act=leave]'); await p.waitForTimeout(200);

  // Lobby game rules (Revise#202): four big ON / OFF boxes above Solo / Online, each with a “?”
  { const info = await p.evaluate(() => { const g = document.querySelector('.loptgrid'), l = document.querySelector('.lgrid'); const bs = [...document.querySelectorAll('.lopt')];
      return { n: bs.length, above: !!g && !!l && g.getBoundingClientRect().bottom <= l.getBoundingClientRect().top, row: bs.length === 4 && bs.every(b => Math.abs(b.getBoundingClientRect().top - bs[0].getBoundingClientRect().top) < 2),
        sw: bs.map(b => { const v = [...b.querySelectorAll('.losw.lovals > span')].find(x => getComputedStyle(x).display !== 'none'); return v ? v.textContent : getComputedStyle(b.querySelector('.losw'), '::after').content; }), titles: bs.map(b => b.querySelector('.lotitle').textContent), help: bs.every(b => b.querySelector('.lhelp') && b.querySelector('.lhtxt').textContent.length > 20) }; });
    check(info.n === 4 && info.above && info.row && info.help, "lobby: 4 rule boxes in one row above Solo / Online, each with a “?” (Revise#202): " + JSON.stringify(info));
    check(JSON.stringify(info.sw) === JSON.stringify(['2: Anytime Interrupts', '"ON"', '"ON"', '"ON"']) && info.titles[0] === "Response Timing", "the boxes: Response Timing 1: By Sequence / 2: Anytime Interrupts (Pack, Revise#233), the others ON / OFF: " + JSON.stringify([info.titles, info.sw]));
    await p.click('.lo1'); await p.waitForTimeout(100);
    { const v = await p.evaluate(() => { const b = document.querySelector('.lo1'); return [b.querySelector('input').checked, [...b.querySelectorAll('.lovals > span')].find(x => getComputedStyle(x).display !== 'none').textContent]; });
      check(v[0] === false && v[1] === "1: By Sequence", "a click switches it to 1: By Sequence: " + JSON.stringify(v)); }
    await p.click('.lo1'); await p.waitForTimeout(100);
    check(await p.evaluate(() => /By Sequence/.test(document.querySelector('.lo1 .lhtxt').textContent) && /Build/.test(document.querySelector('.lo2 .lhtxt').textContent) && /Pay/.test(document.querySelector('.lo4 .lhtxt').textContent)), "the explanations (Revise#233)");
    await p.hover('.lo2 .lhelp'); await p.waitForTimeout(150);
    check(await p.$eval('.lo2 .lhtxt', x => getComputedStyle(x).display !== 'none'), "hovering “?” shows the explanation");
    await p.screenshot({ path: SHOTS + '/23-lobby-rules.png', clip: { x: 0, y: 0, width: 1280, height: 520 } });
    await p.click('.lo4'); check(!(await p.isChecked('#lPay')), "clicking a box turns it OFF"); await p.click('.lo4'); check(await p.isChecked('#lPay'), "…and ON again");
  }
  // Player image (Revise#214): 6 defaults + upload, above Game rules; the Game table explanation is in a “?”
  { const av = await p.evaluate(() => { const g = document.querySelector('.lavatar'), r = document.querySelector('.lopts');
      return { n: document.querySelectorAll('.avgrid .avpick[data-v]').length, auto: (() => { const f = document.querySelector('.lavatar h2 .avauto[data-v=auto]'), h = document.querySelector('.lavatar h2 .hq'); return !!f && f.classList.contains("on") && !!h && Math.abs(f.getBoundingClientRect().top - h.getBoundingClientRect().top) < 14 && f.getBoundingClientRect().left > h.getBoundingClientRect().left && !document.querySelector('.avgrid [data-v=auto]'); })(), up: !!document.querySelector('.avgrid .avup input[type=file][accept="image/*"]'), above: !!g && !!r && g.getBoundingClientRect().bottom <= r.getBoundingClientRect().top + 1, h1q: !!document.querySelector('.lobby h1 .hq .lhelp'), noP: [...document.querySelectorAll('.lobby > p.muted')].length }; });
    check(av.n === 6 && av.auto && av.up && av.above && av.h1q && av.noP === 0, "lobby: Player image (Auto-pick beside the title and on by default (Revise#240), 6 defaults, Upload) above Game rules; the Game table explanation is in a “?” (Revise#214): " + JSON.stringify(av));
    check(await p.evaluate(() => TB.autoAvatar(TB.db.all().filter(c => c.type === "Break" && c.name && c.faction === "Darklore").slice(0, 3).map(c => c.key).concat(TB.db.all().filter(c => c.type === "Break" && c.name && c.faction === "Eraser").slice(0, 2).map(c => c.key)))) === "p4", "Auto-pick: the faction with the most name-level Break cards (Darklore → p4) (Revise#218)");
    await p.click('.avpick[data-v=p3]'); await p.waitForTimeout(150);
    check(await p.evaluate(() => TB.myAvatarSel()) === "p3" && await p.$('.avpick.on[data-v=p3]') !== null, "choosing a default Player image");
    check(await p.$('.avauto.on') === null, "… Auto-pick is no longer chosen (one choice)");
    await p.click('.avauto[data-v=auto]'); await p.waitForTimeout(150);
    check(await p.evaluate(() => TB.myAvatarSel()) === "auto" && await p.$('.avpick.on') === null, "Auto-pick beside the title: chosen, no picture chosen");
    await p.click('.avpick[data-v=p3]'); await p.waitForTimeout(150);
    await p.setInputFiles('#avFile', path.join(__dirname, '..', 'assets', 'players', 'p5.jpg')); await p.waitForTimeout(800);
    const upv = await p.evaluate(() => [TB.myAvatarSel(), String(TB.avatarValue()).slice(0, 23), String(TB.avatarValue()).length]);
    check(upv[0] === "up" && upv[1] === "data:image/jpeg;base64," && upv[2] < 160000 && await p.$('.avpick.on[data-v=up]') !== null, "uploading a Player image: made small and chosen: " + JSON.stringify(upv));
    await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(150);
    const mob = await p.evaluate(() => { const t = [...document.querySelectorAll('.avgrid > *')]; return { w: Math.round(t[0].getBoundingClientRect().width), over: document.documentElement.scrollWidth > window.innerWidth + 1 }; });
    check(mob.w >= 60 && !mob.over, "phone width: the Player images fit, no sideways scroll: " + JSON.stringify(mob));
    await p.screenshot({ path: SHOTS + '/25-lobby-player-phone.png' });
    await p.setViewportSize({ width: 1440, height: 900 }); await p.waitForTimeout(150); }
  // Game Situation (Revise#169): table rule before the game; anyone declares; pop-up; 1 s hover → what it skips
  await p.check('#lSituation'); await p.click('[data-act=solo1]'); await p.waitForTimeout(300);
  await p.click('[data-act=keep]'); await p.waitForTimeout(300);
  check(await p.$('.drawer') === null && await p.$('.ctl.top .ctlsit .sitbar') !== null && await p.$('.ctl.top .sizebar') === null, "Player options (Revise#178 / #207): Size not in the top bar; Game Situation is its own row there — the top bar");
  check(await p.$('.optbtn .optsum') === null && (await p.$$eval('.optbtn', bs => bs.map(b => b.textContent.trim()))).join("|") === "⚙ Player options|⚑ Game options", "the option buttons carry no summary (Pack, Revise#232)");
  await p.click('[data-act=optsMenu]'); await p.waitForTimeout(450);
  { const box = await p.$eval('.drawer', d => { const r = d.getBoundingClientRect(); return [Math.round(r.right), document.documentElement.clientWidth, Math.round(r.top)]; });
    check(box[0] === box[1] && box[2] === 0, "Player options opens as a right side bar: " + box.join(","));
    check(await p.$('.drawer #sizeBar') !== null && await p.$('.bh .hsize #sizeBar') === null && await p.$('.drawer .sitbar') === null && await p.$('.drawer .drtabs') === null && await p.$('.drawer [data-act=holdUndo]') === null, "Player options (Revise#225): one page, Options then Card size; no tabs; Hold / Undo moved to Game options; the situation buttons moved to Game options (Revise#190)");
    await p.screenshot({ path: SHOTS + '/18-options-sidebar.png' }); }
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  await p.click('.ctl.top [data-act=gameMenu]'); await p.waitForTimeout(450);
  check(await p.$('#optDrawer') === null && await p.$('#gameDrawer .sitbar') === null && await p.$('#gameDrawer [data-act=globalUndo]') !== null && await p.$('#gameDrawer [data-act=outlawFool]') !== null, "Game options: Global Undo/Redo, Game Situation and Outlaw (Revise#190)");
  check(await p.evaluate(() => TB.ui.log.state.rules.globalUndo === true), "Global Undo/Redo is ON by default (Revise#225)");
  await p.click('#gameDrawer [data-act=globalUndo]'); await p.waitForTimeout(200);
  check(await p.evaluate(() => TB.ui.log.state.rules.globalUndo === false), "… a click turns it OFF");
  await p.click('#gameDrawer [data-act=globalUndo]'); await p.waitForTimeout(200);
  check(await p.evaluate(() => TB.ui.log.state.rules.globalUndo === true), "Global Undo/Redo turned ON again");
  await p.click('#gameDrawer [data-act=stuckSec][data-v="120"]'); await p.waitForTimeout(150);
  check(await p.evaluate(() => TB.stuckAfter()) === 120000 && await p.$eval('#gameDrawer [data-act=stuckSec].on', b => b.textContent) === "120 s", "Game options: Game Status pop-up after 30 / 60 / 120 / 180 s (Revise#206)");
  await p.click('#gameDrawer [data-act=stuckSec][data-v="30"]'); await p.waitForTimeout(150);
  { const gd = await p.evaluate(() => { const d = document.querySelector('#gameDrawer'), secs = [...d.querySelectorAll('.drsec')].map(x => (x.querySelector('h3') || {}).firstChild ? x.querySelector('h3').firstChild.textContent.trim() : ""), t = d.querySelector('.skiptab');
      return { secs, cols: t ? [...t.rows[0].cells].slice(1).map(c => c.textContent) : [], rows: t ? t.rows.length - 1 : 0, build: t ? [...t.rows].slice(1).map(r => r.cells[2].textContent) : [], curc: t ? [...t.rows].slice(1).map(r => r.cells[1].textContent) : [], hu: !!d.querySelector('[data-act=holdUndo]'), hm: !!d.querySelector('.holdmenu'), cur: t ? t.querySelectorAll('td.cur').length : 0, small: d.querySelectorAll('.optrow small, .drnote').length, q: d.querySelectorAll('.lhelp').length }; });
    check(gd.secs.indexOf("Skip") >= 0 && gd.secs.indexOf("Skip") === gd.secs.indexOf("Outlaw") - 1 && gd.cols.join() === "Current,Build,Interfere,Conflict,Engage" && gd.rows === 6 && gd.build.join() === "Skip,Not Skip,Skip,Not Skip,Skip,Skip" && gd.curc.join() === gd.build.join() && gd.cur === 6 && gd.hu && !gd.hm, "Game options: Skip table right before Outlaw, Current column = Build, Undo with Hold-Undo, no Hold menu while Game Situation is ON (Revise#212 / #225): " + JSON.stringify(gd));
    await p.click('#gameDrawer [data-act=sitHold][data-type=effect]'); await p.waitForTimeout(250);
    const c1 = await p.evaluate(() => { const S = TB.ui.log.state, t = document.querySelector('#gameDrawer .skiptab'), row = [...t.rows].find(r => /Effect/.test(r.cells[0].textContent)); return { h: S.sitHolds && S.sitHolds.effect, cur: row.cells[1].textContent, head: t.rows[0].cells[1].textContent, sit: S.situation }; });
    check(c1.h === true && c1.cur === "Not Skip" && c1.head === "Current*", "Current column: a click changes one row only (Revise#225): " + JSON.stringify(c1));
    await p.click('#gameDrawer .skiptab [data-act=situation][data-v=engaging]'); await p.waitForTimeout(250);
    const c2 = await p.evaluate(() => { const S = TB.ui.log.state, t = document.querySelector('#gameDrawer .skiptab'); return { h: S.sitHolds || null, sit: S.situation, cur: [...t.rows].slice(1).map(r => r.cells[1].textContent).join() }; });
    check(c2.h === null && c2.sit === "engaging" && c2.cur === "Not Skip,Not Skip,Not Skip,Not Skip,Not Skip,Not Skip", "clicking a situation header declares it; Current follows it (Revise#225): " + JSON.stringify(c2));
    await p.click('#gameDrawer .skiptab [data-act=situation][data-v=building]'); await p.waitForTimeout(1700);
    check(gd.small === 0 && gd.q >= 8, "Game options: every explanation is in a “?” (Revise#212): " + JSON.stringify([gd.small, gd.q])); }
  await p.screenshot({ path: SHOTS + '/21-game-options.png' });
  check(await p.$('.sitbar') !== null && await p.$('[data-act=holdMenu]') === null, "Game Situation: the situation bar replaces the Hold menu");
  check(await p.$eval('.sitbar .sit.on', b => b.textContent) === "Build", "starts as Build");
  { const sb = await p.$eval('.ctl.top .ctlsit .sitbar', b => { const r = [...b.children].map(x => x.getBoundingClientRect().top); return { words: [...b.children].map(x => x.textContent), oneRow: r.every(t => Math.abs(t - r[0]) < 2), first: (() => { const g = document.querySelector('.ctl.top [data-act=gameMenu]').getBoundingClientRect(); return b.getBoundingClientRect().top >= g.bottom - 1; })(), colors: [...b.children].map(x => getComputedStyle(x).color) }; });
    check(sb.words.join() === "Build,Interfere,Conflict,Engage" && sb.oneRow && sb.first && new Set(sb.colors).size === 4, "Game Situation (Revise#206 / #207): one row under the option buttons, short words, a colour each: " + JSON.stringify(sb)); }
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);   // the Game options side bar covers the panel (Revise#207: the situation row is in the panel)
  await p.click('.sitbar [data-v=interfering]'); await p.waitForTimeout(1600);
  const pop = await p.$eval('#sitPop', d => d.textContent).catch(() => "");
  check(/declares Interfere/.test(pop), "declared → pop-up “… declares Interfere”: " + pop.slice(0, 60));
  await p.screenshot({ path: SHOTS + '/16-situation-pop.png' });
  await p.waitForTimeout(3800);
  check(await p.$('#sitPop') === null, "pop-up gone after 5 s");
  await p.hover('.ctl.top .ctlsit .lhelp'); await p.waitForTimeout(200);
  const tip = await p.$eval('.ctl.top .ctlsit .lhtxt', d => getComputedStyle(d).display !== 'none' ? d.textContent : "").catch(() => "");
  check(/Interfering/.test(tip) && /Not Skip/.test(tip) && /Game options → Skip/.test(tip), "Game Situation “?” (Revise#212): the situation now; the full table is in Game options → Skip: " + tip.slice(0, 80));
  check(await p.$('.sittip') === null, "no more 1 s hover tip on the situation buttons");
  await p.screenshot({ path: SHOTS + '/17-situation-tip.png' });
  await p.mouse.move(5, 5);
  { const bz = async () => p.evaluate(() => { const row = document.querySelector('.board.bottom .row.back'), bar = row && row.querySelector('.bzbar'), sb = document.querySelector('.sortbtn');
      return row && bar ? { cw: getComputedStyle(row).getPropertyValue('--cw').trim(), base: getComputedStyle(document.body).getPropertyValue('--cwb').trim(), w: Math.round(bar.getBoundingClientRect().width), right: Math.round(row.getBoundingClientRect().right - bar.getBoundingClientRect().right) } : null; });
    const b0 = await bz();
    check(b0 && b0.w === 22 && b0.right <= 8, "Control · Back size slider at the right end of the row, 22 px wide like the Sort button (Revise#206): " + JSON.stringify(b0));
    await p.$eval('#backZ', el => { el.value = "0"; el.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(150);
    const b1 = await p.evaluate(() => { const row = document.querySelector('.board.bottom .row.back'), c = document.createElement('div'); c.style.width = 'var(--cw)'; row.appendChild(c); const w = c.getBoundingClientRect().width; c.remove();
      const d = document.createElement('div'); d.style.width = 'var(--cwb)'; document.body.appendChild(d); const base = d.getBoundingClientRect().width; d.remove(); return [w, base]; });
    check(Math.abs(b1[0] - b1[1] * 0.5) < 1, "S = 0.5× the card size: " + b1.join(" / "));
    await p.$eval('#backZ', el => { el.value = "2"; el.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(150); }
  { const dk = await p.evaluate(() => { const pile = document.querySelector('.board.bottom .pile.deck'), b = pile && pile.querySelector('.deckb'); if (!b) return null; const pr = pile.getBoundingClientRect(), br = b.getBoundingClientRect(); return { inside: br.top >= pr.top && br.bottom <= pr.bottom, top: br.top - pr.top < pr.height / 3 }; });
    check(dk && dk.inside && dk.top, "Charge / Draw sit at the top inside the deck's frame (Revise#208): " + JSON.stringify(dk)); }
  { const ph = await p.evaluate(() => { const S = TB.ui.log.state, bh = document.querySelector(`.bh[data-seat="${S.turn.player}"]`); if (!bh) return null;
      return { all: [...bh.querySelectorAll('.phs .ph')].map(x => x.textContent), on: [...bh.querySelectorAll('.phs .ph.on')].map(x => x.textContent), phase: S.turn.phase, tm: [...bh.querySelectorAll('.tmg')].map(x => x.textContent + (x.classList.contains('on') ? "+" : "-")) }; });
    check(ph && ph.all.join() === "Draw,Active,Main,Charge,Discard" && ph.on.length === 1 && ph.on[0].toLowerCase() === ph.phase && ph.tm.length === 2, "field head (Revise#205): every phase, the current one bright, and Fast / Project Timing: " + JSON.stringify(ph));
    const bh = await p.$('.board.bottom .bh'); if (bh) await bh.screenshot({ path: SHOTS + '/25-phase-head.png' }); }
  { const sp = await p.evaluate(() => { const row = document.querySelector('.board.bottom .row.act'), sp = row && row.querySelector(':scope > .special'), last = row && [...row.children].filter(x => !x.classList.contains('rl')).pop();
      return { inAct: !!sp, last: !!sp && sp === last, inFront: !!document.querySelector('.board.bottom .row.front .special') }; });
    check(sp.inAct && sp.last && !sp.inFront, "Special Area at the right end of the Active Area (Revise#181): " + JSON.stringify(sp)); }
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  await p.click('.ctl.top [data-act=optsMenu]'); await p.waitForTimeout(150);
  check(await p.$('.drawer [data-act=outlawDiscard]') === null, "Outlaw is no longer in Player options");
  check(await p.$('.drawer [data-act=autoSkip]') !== null && await p.$('.drawer #sizeBar') !== null, "Player options: the options and Card size (Revise#225)");
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  check(await p.$('.drawer') === null, "Escape closes the side bar");
  for (const which of ['optsMenu', 'gameMenu']) {   // Revise#204: a click outside folds it
    await p.click('.ctl.top [data-act=' + which + ']'); await p.waitForTimeout(450);
    const open = await p.$('.drawer') !== null;
    await p.mouse.click(60, 420); await p.waitForTimeout(150);
    check(open && await p.$('.drawer') === null, "a click outside folds the " + (which === 'optsMenu' ? "Player" : "Game") + " options side bar (Revise#204)");
  }
  { const lg = await p.$$eval('details.log summary button', bs => bs.map(b => b.dataset.act));
    check(lg.join() === "rpSave", "Log header: only Save replay (Replay / Export .txt removed): " + lg.join());
    const pos = await p.$eval('details.log summary', sm => { const b = sm.querySelector('.lgsave').getBoundingClientRect(), r = sm.getBoundingClientRect(); return Math.round(r.right - b.right); });
    check(pos < 20, "Save replay sits at the right side of the Log: " + pos + "px from the edge"); }
  await p.click('[data-act=leave]'); await p.waitForTimeout(200);

  // two-tab test room
  await p.uncheck('#lTogether'); await p.uncheck('#lSituation'); await p.click('[data-act=createTest]'); await p.waitForTimeout(300);
  const code = await p.evaluate(() => TB.ui.room);
  const p2 = await ctx.newPage(); p2.on('pageerror', e => errs.push(String(e)));
  await p2.goto(URL); await p2.waitForTimeout(200);
  await p2.selectOption('#lSlotO', '1'); await p2.fill('#lName', 'Friend'); await p2.fill('#lCode', code); await p2.click('[data-act=joinCode]'); await p2.waitForTimeout(500);
  log('room', code, await p.evaluate(() => [TB.ui.log.state.stage, TB.ui.log.state.players.length]), await p2.evaluate(() => [TB.ui.log.state.stage, TB.ui.log.state.players.length]));
  await p.click('[data-act=keep]'); await p2.click('[data-act=keep]'); await p.waitForTimeout(400);
  log('both tabs same state', await p.evaluate(() => JSON.stringify(TB.ui.log.state).length) === await p2.evaluate(() => JSON.stringify(TB.ui.log.state).length));
  await p.screenshot({ path: SHOTS + '/6-room-p1.png' }); await p2.screenshot({ path: SHOTS + '/6-room-p2.png' });
  { const op = await p.evaluate(() => { const b = document.querySelector('.board.top'); if (!b) return null; const y = k => { const e = b.querySelector('.piles .pile.' + k); return e ? Math.round(e.getBoundingClientRect().top) : null; };
      return { right: b.querySelector('.piles').getBoundingClientRect().left >= b.querySelector('.rows').getBoundingClientRect().right - 1, order: ["player", "discard", "deck", "damage"].map(y) }; });
    check(op && op.right && op.order.every((v, i, a) => v != null && (i === 0 || v > a[i - 1])), "the opponent's side: piles on the right, Player · Discard · Deck · Damage from the top (Pack, Revise#241): " + JSON.stringify(op));
  }


  // 4-player test room
  const ps = [await ctx.newPage(), await ctx.newPage(), await ctx.newPage(), await ctx.newPage()];
  for (const q of ps) { q.on('pageerror', e => errs.push(String(e))); await q.goto(URL); await q.waitForTimeout(100); }
  await ps[0].fill('#lName', 'Pack'); await ps[0].selectOption('#lSeats', '4'); await ps[0].uncheck('#lTogether'); await ps[0].uncheck('#lSituation'); await ps[0].click('[data-act=createTest]'); await ps[0].waitForTimeout(300);
  const c4 = await ps[0].evaluate(() => TB.ui.room);
  for (let i = 1; i < 4; i++) { await ps[i].fill('#lName', 'P' + (i + 1)); await ps[i].selectOption('#lSlotO', String(i % 2)); await ps[i].fill('#lCode', c4); await ps[i].click('[data-act=joinCode]'); await ps[i].waitForTimeout(300); }
  for (const q of ps) { for (let t = 0; t < 3; t++) { const k = await q.$('[data-act=keep]'); if (!k) break; try { await k.click({ timeout: 3000 }); break; } catch (e) { await q.waitForTimeout(200); } } await q.waitForTimeout(150); }   // the table may redraw between finding and clicking
  await ps[0].waitForTimeout(400);
  for (let i = 0; i < 4; i++) await ps[i].screenshot({ path: SHOTS + `/7-four-${i + 1}.png` });
  log('four', await ps[0].evaluate(() => [TB.ui.log.state.stage, TB.ui.log.state.turn.order, TB.positions(TB.ui.log.state, TB.viewSeat())]));
  // phone
  const ph = await b.newContext({ ...devices['iPhone 13'], reducedMotion: 'reduce' }); await ph.route(/drive\.google|googleusercontent|fonts\./, r => r.abort());
  const m = await ph.newPage(); m.on('pageerror', e => errs.push(String(e)));
  await m.goto(URL); await m.evaluate(d => localStorage.setItem("aa-decks", d), await p.evaluate(() => localStorage.getItem("aa-decks"))); await m.reload();
  await m.click('[data-act=solo2]'); await m.waitForTimeout(300); await m.click('[data-act=keep]'); await m.waitForTimeout(200); await m.click('[data-act=keep]'); await m.waitForTimeout(300);
  await m.screenshot({ path: SHOTS + '/8-phone.png' });
  log('phone body scrollWidth', await m.evaluate(() => [document.documentElement.scrollWidth, innerWidth]));
  {   // Revise#286: motion on (the other checks run with reduced motion) — a card that moves glides, a closed pop-up fades out and is cleaned up
    const mc = await b.newContext({ ...devices['iPhone 13'] }); await mc.route(/drive\.google|googleusercontent|fonts\./, r => r.abort());
    const q = await mc.newPage(); q.on('pageerror', e => errs.push(String(e)));
    await q.goto(URL); await q.evaluate(d => localStorage.setItem("aa-decks", d), await p.evaluate(() => localStorage.getItem("aa-decks"))); await q.reload();
    await q.click('[data-act=solo2]'); await q.waitForTimeout(300); await q.click('[data-act=keep]'); await q.waitForTimeout(200); await q.click('[data-act=keep]'); await q.waitForTimeout(300);
    const mo = await q.evaluate(async () => {
      const S = () => TB.ui.log.state, sleep = ms => new Promise(r => setTimeout(r, ms)), out = {}, js = () => document.getAnimations().filter(a => !(window.CSSAnimation && a instanceof CSSAnimation) && !(window.CSSTransition && a instanceof CSSTransition)).length;
      const me = TB.viewSeat ? TB.viewSeat() : 0, c = Object.values(S().cards).find(x => x.owner === me && x.place.z === "hand" && TB.db.card(x.key).type === "Character");
      TB.send({ t: "move", seat: me, card: c.id, to: { z: "front" } }); await sleep(250);
      const ch = Object.values(S().chars).find(x => x.stack.includes(c.id));
      TB.send({ t: "moveChar", seat: me, ch: ch.id, to: { area: "back" } }); await sleep(40); out.glide = js();
      await sleep(400); for (let k = 0; k < 25 && js() > 0; k++) await sleep(100); out.settled = js();   // a slow machine: wait for the glide to end (up to 2.9 s)
      const b0 = document.createElement('button'); b0.dataset.act = 'showc'; b0.dataset.id = c.id; document.body.appendChild(b0); b0.click(); await sleep(40); out.openAnim = js(); b0.remove();
      await sleep(300); const cl = document.querySelector('.modal.card-details [data-act=close]'); if (cl) cl.click(); await sleep(40); out.ghost = document.querySelectorAll('.mo-ghost').length;
      await sleep(450); out.ghostLater = document.querySelectorAll('.mo-ghost').length; out.modal = !!document.querySelector('#app .modal.card-details');
      return out;
    });
    check(mo.glide > 0 && mo.settled === 0, "motion: the moved card glides, then settles: " + JSON.stringify(mo));
    check(mo.openAnim > 0 && mo.ghost === 1 && mo.ghostLater === 0 && !mo.modal, "motion: the details pop-up eases in, fades out and is cleaned up");
    await mc.close();
  }
  {   // Revise#311: Bot vs Bot — both seats play by themselves; Pause stops them
    const bc = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' }); await bc.route(/drive\.google|googleusercontent|fonts\./, r => r.abort());
    const q = await bc.newPage(); q.on('pageerror', e => errs.push(String(e)));
    await q.goto(URL); await q.evaluate(d => localStorage.setItem("aa-decks", d), await p.evaluate(() => localStorage.getItem("aa-decks"))); await q.reload();
    await q.click('[data-act=botsWatch]'); await q.waitForTimeout(9000);
    const st = await q.evaluate(() => { const S = TB.ui.log.state, by = s => TB.ui.log.entries.filter(e => e.seat === s).length; return { seats: TB.botSeats(), mine: TB.mySeats(), stage: S.stage, turn: S.turn.number, m0: by(0), m1: by(1), bar: !!document.querySelector('#botBar [data-act=botPause]') }; });
    check(JSON.stringify(st.seats) === "[0,1]" && st.mine.length === 0 && st.stage === "play" && st.m0 > 0 && st.m1 > 0 && st.bar, "Bot vs Bot: both seats play, you watch: " + JSON.stringify(st));
    await q.click('#botBar [data-act=botPause]'); await q.waitForTimeout(800);
    const n1 = await q.evaluate(() => TB.ui.log.entries.length); await q.waitForTimeout(2500);
    const n2 = await q.evaluate(() => TB.ui.log.entries.length);
    check(n1 === n2, "Bot vs Bot: Pause stops the bots: " + n1 + " → " + n2);
    await q.click('#botBar [data-act=botPause]'); await q.waitForTimeout(2500);
    check(await q.evaluate(() => TB.ui.log.entries.length) > n2 || await q.evaluate(() => TB.ui.log.state.stage === "over"), "Bot vs Bot: Play goes on");
    await bc.close();
  }
  {   // Revise#308: vs Bot — the bot keeps its hand and plays its turns by itself
    const bc = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' }); await bc.route(/drive\.google|googleusercontent|fonts\./, r => r.abort());
    const q = await bc.newPage(); q.on('pageerror', e => errs.push(String(e)));
    await q.goto(URL); await q.evaluate(d => localStorage.setItem("aa-decks", d), await p.evaluate(() => localStorage.getItem("aa-decks"))); await q.reload();
    await q.click('[data-act=soloBot]');
    for (let t = 0; t < 30 && !(await q.evaluate(() => !!(TB.ui.log && TB.ui.log.state.players[1] && TB.ui.log.state.players[1].ready))); t++) await q.waitForTimeout(200);   // the bot keeps its hand (slower on a busy machine)
    const kept = await q.evaluate(() => [TB.botSeat(), TB.mySeats(), TB.ui.log.state.players.map(x => x.ready)]);
    if (await q.$('[data-act=keep]')) await q.click('[data-act=keep]');
    await q.waitForTimeout(500);
    for (let i = 0; i < 12; i++) { const nx = await q.$('[data-act=next], .resolve .btn.pri'); if (await q.evaluate(() => TB.ui.log.state.turn.player === 1 || TB.ui.log.state.turn.number > 1)) break; if (nx) await nx.click().catch(() => {}); await q.waitForTimeout(400); }
    await q.waitForTimeout(6000);
    const st = await q.evaluate(() => { const S = TB.ui.log.state; return { stage: S.stage, turn: S.turn.number, bot: S.players[1].ready, botMoves: TB.ui.log.entries.filter(e => e.seat === 1).length }; });
    check(kept[0] === 1 && JSON.stringify(kept[1]) === "[0]" && kept[2][1] === true, "vs Bot: seat 2 is the bot, it kept its hand: " + JSON.stringify(kept));
    check(st.stage === "play" && st.botMoves > 0, "vs Bot: the bot made its moves: " + JSON.stringify(st));
    // Revise#309: a finished Solo game is copied once to rooms/SOLOBOT-xxxx/log (a stand-in database here)
    const ks = await q.evaluate(async () => {
      const ui = TB.ui, saved = { log: ui.log, entries: ui.entries }, cfg = window.AA_FIREBASE, fb = window.firebase;
      let n = 0, paths = [], sets = [];
      window.AA_FIREBASE = { databaseURL: "https://x" };
      window.firebase = { apps: [1], database: () => ({ ref: p => { paths.push(p); return { push: () => ({ key: "k" + String(n++).padStart(3, "0") }), update: v => { sets.push(v); return Promise.resolve(); }, set: () => Promise.reject(new Error("PERMISSION_DENIED: the rules allow one entry at a time")) }; } }) };
      ui.entries = Array.from({ length: 12 }, (_, i) => ({ id: "L" + i, t: i === 11 ? "undo" : "next", by: "solo", ofId: i === 11 ? "L5" : undefined }));
      ui.log = { state: { stage: "over" } };
      TB.keepSolo(); await new Promise(r => setTimeout(r, 50)); TB.keepSolo(); await new Promise(r => setTimeout(r, 50));
      Object.assign(ui, saved); window.AA_FIREBASE = cfg; window.firebase = fb;
      const o = sets[0] || {};
      return { paths, sets: sets.length, keys: Object.keys(o).length, undoTo: o.k011 && o.k011.ofId, cid: o.k000 && o.k000.cid, id: o.k000 && o.k000.id };
    });
    check(ks.sets === 1 && /^rooms\/SOLOBOT-\w+\/log$/.test(ks.paths[0]) && ks.keys === 12 && ks.undoTo === "k005" && ks.cid === "solo" && ks.id === undefined, "Solo game kept in the log once, with push keys and undo links moved: " + JSON.stringify(ks));
    await bc.close();
  }
  
  
      await b.close();
    })();
    await (async () => {
      const log = (...a) => console.log("   ", ...a);

  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await ctx.route(/drive\.google|googleusercontent|fonts\./, r => r.abort());
  const pg = async () => { const q = await ctx.newPage(); q.on('pageerror', e => errs.push(String(e))); await q.goto(URL); return q; };
  const A = await pg();
  await A.evaluate(() => {
    const all = TB.db.all(), pick = (f, t, n) => all.filter(c => c.faction === f && c.type === t && (t !== "Character" || (c.se >= 1 && c.at >= 2 && !c.name))).slice(0, n);
    const mk = (name, f) => ({ name, cols: { Character: pick(f, "Character", 15).map(c => ({ k: c.key, n: 2 })), Break: pick(f, "Break", 5).map(c => ({ k: c.key, n: 2 })), Fast: [], Project: [], Permanent: [] } });
    localStorage.setItem("aa-decks", JSON.stringify([mk("E.G.O. test", "E.G.O."), mk("Darklore test", "Darklore")]));
  });
  await A.reload(); await A.fill('#lName', 'Pack'); await A.uncheck('#lTogether'); await A.uncheck('#lSituation'); await A.click('[data-act=createTest]'); await A.waitForTimeout(300);
  const code = await A.evaluate(() => TB.ui.room);
  const B = await pg(); await B.fill('#lName', 'Friend'); await B.selectOption('#lSlotO', '1'); await B.fill('#lCode', code); await B.click('[data-act=joinCode]'); await B.waitForTimeout(400);
  await A.click('[data-act=keep]'); await B.click('[data-act=keep]'); await A.waitForTimeout(300);
  const tpSeat = await A.evaluate(() => TB.ui.log.state.turn.player), aSeat = await A.evaluate(() => TB.viewSeat());
  const [T, O] = tpSeat === aSeat ? [A, B] : [B, A];
  // set-up by hand on the turn player's side: a Controlled Character with 2 power cards
  const ch = await T.evaluate(() => {
    const S = TB.ui.log.state, me = TB.viewSeat(), p = S.players[me];
    const c = p.zones.hand.find(id => TB.db.card(S.cards[id].key).type === "Character");
    TB.send({ t: "move", seat: me, card: c, to: { z: "front" } });
    const chId = AA4.charOfCard(TB.ui.log.state, c).id;
    for (let i = 0; i < 2; i++) { const d = TB.ui.log.state.players[me].zones.deck; TB.send({ t: "move", seat: me, card: d[d.length - 1], to: { z: "char", ch: chId, role: "power" } }); }
    return chId;
  });
  await T.waitForTimeout(200);
  if (await T.evaluate(() => TB.ui.log.state.turn.phase) === "active") { await T.click('[data-act=next]'); await T.waitForTimeout(200); }   // → Main (auto-skip may have done it)
  check(await T.evaluate(() => TB.ui.log.state.turn.phase) === "main", "auto-skip: the Active Phase went on to the Main Phase by itself");
  await T.click(`.ch[data-ch="${ch}"] .card.top`); await T.waitForTimeout(150);
  await T.screenshot({ path: SHOTS + '/9-menu.png' });
  const items = await T.$$eval('.menu button', bs => bs.map(b => b.textContent));
  log('menu', items);
  { const cls = await T.$$eval('.menu button', bs => bs.map(b => [b.textContent, b.className, getComputedStyle(b).backgroundColor]));
    const atk = cls.find(x => /^Attack → /.test(x[0])), det = cls.find(x => x[0] === "Card details");
    check(atk && atk[1] === "mi-atk" && atk[2] === "rgb(255, 194, 199)" && det && det[1] === "mi-det" && det[2] === "rgb(198, 241, 207)", "card menu colours: Attack pastel red, Card details pastel green (Revise#186): " + JSON.stringify(cls.map(x => x[1] + " " + x[2]))); }
  await T.click('.menu button:has-text("Attack → ")'); await T.waitForTimeout(150);
  await T.screenshot({ path: SHOTS + '/10-pay.png' });
  const payPop = await T.evaluate(() => { const d = TB.ui.log.state.draft; return d ? [d.step, d.cost, document.querySelectorAll('.modal.pay [data-paycard]').length] : null; });
  log('pay pop-up', payPop);
  if (payPop && payPop[0] === "pay") { check(payPop[2] > payPop[1], "pay pop-up lists the power cards when there are more than the cost"); { const w = async () => T.$eval('.modal.pay .payc', e => e.getBoundingClientRect().width); const wl = await w(); await T.click('.modal.pay [data-act=payZ][data-z=S]'); await T.waitForTimeout(100); const ws = await w(); check(Math.abs(ws - wl * 0.5) < 2, "cost window card size S = 0.5× of L (Revise#208): " + ws + " / " + wl); await T.click('.modal.pay [data-act=payZ][data-z=L]'); await T.waitForTimeout(100); } await T.click('.modal.pay [data-paycard]'); await T.click('[data-act=payAuto]');   // Auto pick pays at once (Revise#089)
    check(await T.evaluate(() => !TB.ui.log.state.draft || TB.ui.log.state.draft.step !== 'pay'), 'Auto pick pays at once'); await T.waitForTimeout(300); }
  await O.waitForTimeout(200);
  await O.screenshot({ path: SHOTS + '/11-guard.png' });
  { const st = await O.$$eval('.battle .bs .bsx', xs => xs.map(x => [x.textContent, x.classList.contains("on"), getComputedStyle(x).backgroundColor]));
    check(st.map(x => x[0]).join(">") === "Attack>Guard>Response>Resolved" && st[1][1], "battle steps Attack › Guard › Response › Resolved, Guard now (Revise#187): " + JSON.stringify(st));
    check(st.map(x => x[2]).join("|") === "rgb(255, 194, 199)|rgb(191, 224, 255)|rgb(255, 241, 168)|rgb(198, 241, 207)", "pastel red / blue / yellow / green");
    const lay = await O.$$eval('.battle .bside', xs => xs.map(x => { const p = x.querySelector('.bpic').getBoundingClientRect(), i = x.querySelector('.binfo').getBoundingClientRect(); return { right: i.left >= p.right - 1, order: [...x.querySelector('.binfo').children].map(c => c.className.split(" ")[0]) }; }));
    check(lay.length >= 1 && lay.every(l => l.right) && lay[0].order.join() === (lay[0].order.includes("bsk") ? "bnm,bsk,bst" : "bnm,bst") && (lay.length < 2 || lay[1].order[0] === "bst"), "Resolve battle (Revise#206): info right of the card; attacker Name · Skill · Status, defender Status · Skill · Name: " + JSON.stringify(lay));
    check(await O.evaluate(() => TB.skillTimes({ initCount: 2, parts: [] }, { initiative: true }, "initiative", true) === 2 && TB.skillTimes({ parts: [{ key: "skill", n: "infinity" }, { key: "skill", n: "infinity" }] }, { infinity: true }, "infinity", true) === 3 && TB.skillTimes({ parts: [] }, {}, "bind", 1) === 1), "a skill given more than once shows more than once (Revise#207)");
    const bt = await O.$('.battle'); if (bt) await bt.screenshot({ path: SHOTS + '/20-battle-steps.png' }); }
  log('defender sees', await O.$$eval('.acts button', bs => bs.map(b => b.textContent)));
  await O.click('[data-act=noGuard]'); await O.waitForTimeout(300);
  log('priority now', await O.evaluate(() => [AA4.priorityNow(TB.ui.log.state), TB.viewSeat()]));
  await O.click('[data-act=pass]'); await T.waitForTimeout(300);
  await T.screenshot({ path: SHOTS + '/12-response.png' });
  { const t = await T.$eval('[data-act=pass]', b => b.textContent).catch(() => ""); const need = await T.evaluate(() => { const S = TB.ui.log.state; return AA4.needPass(S).filter(x => !S.passed.includes(x)).length; });
    check(need !== 1 || t === "Resolve", "the last pass is a “Resolve” button (Revise#207): " + t + " · waiting for " + need); }
  await T.click('[data-act=pass]'); await T.waitForTimeout(300);
  log('after battle', await O.evaluate(() => { const S = TB.ui.log.state, me = TB.viewSeat(); return [S.battle, S.players[me].zones.damage.length, Object.values(S.chars).filter(c => c.owner === me).length]; }));
  // undo: set a character from the hand, then Undo
  const before = await T.evaluate(() => Object.keys(TB.ui.log.state.chars).length);
  const h = await T.$('#hand .card.play'); if (h) { await h.click(); await T.waitForTimeout(150); if (await T.$('.menu')) await T.click('.menu button:not([disabled])'); }
  await T.waitForTimeout(200);
  const mid = await T.evaluate(() => Object.keys(TB.ui.log.state.chars).length);
  await T.click('[data-act=undo]'); await T.waitForTimeout(300);
  { const pop = await O.$('.modal.undopop'); log('undo pop-up on the other tab', !!pop); if (pop) { await O.screenshot({ path: SHOTS + '/15-undo-pop.png' }); await O.click('.modal.undopop [data-act=undoYes]'); await T.waitForTimeout(300); } }
  const after = await T.evaluate(() => Object.keys(TB.ui.log.state.chars).length), afterO = await O.evaluate(() => Object.keys(TB.ui.log.state.chars).length);
  log('undo chars', before, mid, after, 'other tab', afterO);
  // field effect by hand
  await T.click('details.fx summary'); await T.click('[data-act=fieldAdd]'); await T.waitForTimeout(100);
  await T.selectOption('#fKind', 'at'); await T.fill('#fVal', '2'); await T.click('.ff .btn.pri'); await T.waitForTimeout(300);
  log('field effects', await O.evaluate(() => TB.ui.log.state.modifiers.map(m => AA4.modText(m) + " / " + m.src.label)));
  await T.screenshot({ path: SHOTS + '/13-field.png' });
  { const fp = await T.evaluate(() => { const S = TB.ui.log.state, me = TB.mySeats()[0], other = S.players.map(p => p.seat).find(x => x !== me);   // Pack (Revise#245): areas and players chosen on the field
      S.decisions.push({ id: "dfp", seat: me, kind: "pick", reason: "Choose the areas and players that take 1 damage", options: [me + ":active", other + ":control", other + ":active", "__next__"], labels: ["a", "b", "c", "Next"], fieldPicked: [me + ":control"], min: 1, max: 1, then: [] }); TB.render();
      const r = { bar: !!document.querySelector('.modal.fpick'), list: document.querySelectorAll('.modal.fpick [data-act=choose]').length, areas: [...document.querySelectorAll('.row.areatgt')].map(x => x.dataset.areakey).sort(), players: document.querySelectorAll('.pile.player.tgt').length, chosen: document.querySelectorAll('.row.fpicked').length };
      return r; });
    await T.screenshot({ path: SHOTS + '/29-field-pick.png' }).catch(() => {});
    await T.evaluate(() => { const S = TB.ui.log.state; S.decisions = S.decisions.filter(d => d.id !== "dfp"); TB.render(); });
    check(fp.bar && fp.list === 1 && fp.areas.length === 4 && fp.players === 0 && fp.chosen === 2, "choosing areas on the field: only areas marked (Players not), the chosen one shown as chosen, a Next button (Revise#245 / #246): " + JSON.stringify(fp)); }
  { const pr = await T.evaluate(() => { const S = TB.ui.log.state, ch = Object.values(S.chars)[0]; if (!ch) return null;   // Pack (Revise#243): Permanents pile to the right like power cards
      const ids = Object.values(S.cards).filter(c => c.place.z === "deck" && c.owner === ch.owner).slice(0, 3).map(c => c.id), old = ch.perm.slice(); ch.perm = old.concat(ids); TB.render();
      const r = [...document.querySelectorAll(`.ch[data-ch="${ch.id}"] .perms .permc`)].map(e => e.getBoundingClientRect()).map(b => [Math.round(b.left), Math.round(b.top), Math.round(b.width)]);
      ch.perm = old; TB.render(); return r; });
    if (pr) check(pr.length >= 3 && pr.every((b, i) => i === 0 || (Math.abs(b[1] - pr[0][1]) < 3 && b[0] > pr[i - 1][0] && b[0] < pr[i - 1][0] + pr[i - 1][2])), "Permanents on one character pile to the right, overlapping (Revise#243): " + JSON.stringify(pr));
    else log('permanent pile: no character on the field — skipped'); }
  { const sw = await T.evaluate(() => { const S = TB.ui.log.state, me = TB.mySeats()[0], hand = S.players[me].zones.hand, chs = Object.keys(S.chars).filter(id => S.chars[id].owner === me);
      S.decisions.push({ id: "dtest", seat: me, kind: "pick", reason: "Choose the character to set it on", options: chs, labels: chs.map(() => "X"), min: 1, max: 1, then: [], setCard: hand[0], setRest: hand.slice(1, 3) }); TB.render();
      const w = document.querySelector('.modal.setwin'), r = { win: !!w, big: !!(w && w.querySelector('.swcard .card')), next: w ? w.querySelectorAll('.swnext').length : 0, txt: !!(w && w.querySelector('.swinfo .swname')), tgt: chs.length ? !!document.querySelector('.board .tgt') : true, chs: chs.length };
      return r; });
    await T.screenshot({ path: SHOTS + '/26-set-permanent.png' });
    { const h = await T.$('.modal.setwin > .mh'), b0 = await h.boundingBox(), m0 = await (await T.$('.modal.setwin')).boundingBox();   // Pack (Revise#236): drag by the title, fold
      await T.mouse.move(b0.x + 30, b0.y + 10); await T.mouse.down(); await T.mouse.move(b0.x + 30 - 200, b0.y + 10 - 150, { steps: 6 }); await T.mouse.up(); await T.waitForTimeout(100);
      const b1 = await (await T.$('.modal.setwin')).boundingBox();
      await T.evaluate(() => TB.render()); await T.waitForTimeout(50);
      const b2 = await (await T.$('.modal.setwin')).boundingBox();
      check(Math.abs(b1.y - (m0.y - 150)) < 6 && Math.abs(b2.y - b1.y) < 2, "an event screen moves when its title is dragged, and stays there: " + JSON.stringify([m0.y, b1.y, b2.y]));
      await T.click('.modal.setwin .mfold'); await T.waitForTimeout(100);
      const f = await T.evaluate(() => { const m = document.querySelector('.modal.setwin'); return [m.classList.contains('folded'), getComputedStyle(m.querySelector('.swmain')).display, Math.round(m.getBoundingClientRect().height)]; });
      check(f[0] && f[1] === "none" && f[2] < 80, "▾ folds it to its title: " + JSON.stringify(f));
      await T.screenshot({ path: SHOTS + '/27-folded.png' });
      await T.click('.modal.setwin .mfold'); await T.waitForTimeout(100);
      check(await T.evaluate(() => !document.querySelector('.modal.setwin').classList.contains('folded')), "▸ unfolds it");
      await T.evaluate(() => { TB.ui.mPos = {}; }); }
    await T.evaluate(() => { const S = TB.ui.log.state; S.decisions = S.decisions.filter(d => d.id !== "dtest"); TB.render(); }); await T.waitForTimeout(100);
    check(sw.win && sw.big && sw.next === 2 && sw.txt && sw.tgt, "setting a Permanent: the card big with its details, the next ones small, its characters marked on the field (Revise#231): " + JSON.stringify(sw)); }
  log('log tail', await O.$$eval('#logLines div', ds => ds.slice(-10).map(d => d.textContent)));
  { await T.evaluate(() => { const d = document.querySelector('details.log'); if (d) d.open = true; }); await T.waitForTimeout(100);
    const hand = await T.$$eval('#logLines div.lghand', ds => ds.map(d => d.textContent));
    check(hand.length > 0, "by-hand log lines are highlighted (Revise#161): " + (hand.slice(-1)[0] || "none"));
    check(hand.length > 0 && hand.every(t => /^\d*\s*!/.test(t.replace(/^\s+/, "")) || t.includes("! ")), "by-hand log lines start with “!” (Revise#223): " + (hand.slice(-1)[0] || "none"));
    const lg = await T.$('details.log'); if (lg) await lg.screenshot({ path: SHOTS + '/14-log-byhand.png' }); }
  { const other = await T.evaluate(() => { const mine = TB.mySeats(); return TB.ui.log.state.players.map(p => p.seat).find(x => !mine.includes(x)); });
    await T.click(`.bh[data-seat="${other}"] b`); await T.waitForTimeout(150);
    const title = await T.$eval('.modal .mh', d => d.textContent).catch(() => "");
    check(/· Hand \(/.test(title), "clicking a player's field header opens their hand (Revise#162): " + title);
    await T.click('.modal [data-act=close]'); await T.waitForTimeout(100); }
  { await T.click('[data-act=gameMenu]'); await T.waitForTimeout(450);   // Hold types (Revise#168) — in Game options since Revise#225 (Game Situation OFF)
    if (await T.$('#gameDrawer [data-act=holdDefault]:not(.on)')) { await T.click('#gameDrawer [data-act=holdDefault]'); await T.waitForTimeout(200); }
    const rows = await T.$$eval('#gameDrawer .holdmenu .optrow', rs => rs.map(r => r.textContent.replace(/\s+/g, "")));
    check(rows.length === 7, "Hold: 7 switches (Aggressive, Attack/Guard, Project, Fast, Effect, Break/Permanent, Undo — Revise#207): " + rows.length);
    check(JSON.stringify(rows) === JSON.stringify(["OFFAggressive", "ONAttack/Guard", "ONProject", "ONFast", "ONEffect", "OFFBreak/Permanent", "ONUndo—askmetoagree"]), "Hold default (Revise#205): Aggressive OFF, Attack/Guard ON, Project ON, Fast/Effect ON, Break/Permanent OFF: " + rows.join(","));
    check(await T.$$eval('#gameDrawer .holdmenu .optline', ls => ls.every(l => l.querySelector('.lhelp') && !l.querySelector('.optrow small'))), "each Hold switch: no explanation line, a “?” instead");
    check(await T.$('#gameDrawer .holdmenu') !== null && await T.$('.bh .hsize #sizeBar') === null, "Hold is in Game options when Game Situation is OFF; Size is no longer at the field head (Revise#225)");
    await T.click('#gameDrawer .holdmenu [data-type=project]'); await T.waitForTimeout(200);
    check(await T.evaluate(() => { const S = TB.ui.log.state, me = TB.mySeats()[0]; return AA4.HOLD_ANSWER.filter(t => AA4.holdOn(S, me, t)).length; }) === 3, "Hold 3/6 after Project OFF");
    await T.click('#gameDrawer .holdmenu [data-act=holdAll][data-on="0"]'); await T.waitForTimeout(200);
    check(await T.evaluate(() => { const S = TB.ui.log.state, me = TB.mySeats()[0]; return AA4.HOLD_TYPES.every(([t]) => !AA4.holdOn(S, me, t)); }), "All OFF turns Undo OFF too");
    await T.click('#gameDrawer .holdmenu [data-act=holdDefault]'); await T.waitForTimeout(200);
    check(await T.evaluate(() => { const S = TB.ui.log.state, me = TB.mySeats()[0]; return AA4.HOLD_TYPES.every(([t]) => AA4.holdOn(S, me, t) === AA4.HOLD_DEFAULT[t]); }), "Default puts every switch back");
    const hm = await T.$('#gameDrawer'); if (hm) await hm.screenshot({ path: SHOTS + '/15-hold-types.png' });
    await T.click('#gameDrawer .holdmenu [data-act=holdAll][data-on="1"]'); await T.waitForTimeout(150);
    check(await T.evaluate(() => { const S = TB.ui.log.state, me = TB.mySeats()[0]; return AA4.HOLD_TYPES.every(([t]) => AA4.holdOn(S, me, t)); }), "All ON turns Undo ON too");
    await T.keyboard.press('Escape'); await T.waitForTimeout(150); await T.click('[data-act=optsMenu]'); await T.waitForTimeout(450);
    const op = await T.$$eval('.drawer .optmenu > *', xs => xs.map(x => x.classList.contains('opthead') ? "#" + x.textContent : (x.querySelector('.optrow b') || {}).textContent));
    check(JSON.stringify(op) === JSON.stringify(["#Phase", "Auto-skip Phase", "Pick Max Charge", "Charge exceeds Draw", "#Cost", "Auto-pay", "Auto Pay after Cost Selection", "#Gameplay", "Run optional abilities without asking"]), "Options tab (Revise#205): Phase / Cost / Gameplay, no Fool text: " + JSON.stringify(op));
    await T.hover('.drawer [data-act=autoPay] + .hq .lhelp'); await T.waitForTimeout(150);
    check(/cost window does not open/.test(await T.$eval('.drawer [data-act=autoPay] + .hq .lhtxt', d => getComputedStyle(d).display !== 'none' ? d.textContent : "")), "Auto-pay “?” says how it differs");
    await T.screenshot({ path: SHOTS + '/24-options-tab.png' });
    await T.click('.drawer .drh [data-act=optsMenu]'); await T.waitForTimeout(100);
    check(await T.$('.drawer') === null, "✕ closes the side bar"); }
  { const r = await O.evaluate(ch => {   // Lethal Damage warning (Revise#185): Attack + your Draw ≥ your Deck
      const S = TB.ui.log.state, me = TB.viewSeat();
      if (!S.chars[ch]) return null;
      const big = TB.lethalCheck(S, { e: "attacked", ch, target: { seat: me } });
      const S2 = JSON.parse(JSON.stringify(S)); S2.players[me].zones.deck = S2.players[me].zones.deck.slice(0, 1);
      const hit = TB.lethalCheck(S2, { e: "attacked", ch, target: { seat: me } });
      const own = TB.lethalCheck(S2, { e: "attacked", ch, target: { seat: S.chars[ch].owner } });
      if (hit) TB.lethalShow(S2, hit);
      const el = document.getElementById("lethalPop"), cs = el && getComputedStyle(el);
      return { big: !!big, hit: !!hit, own: !!own, shown: !!el, text: el ? el.textContent : "", pe: cs && cs.pointerEvents, bg: cs && cs.backgroundColor };
    }, ch);
    if (r) {
      check(!r.big && r.hit && !r.own, "Lethal: only when Attack + Draw ≥ Deck, and only for the attacked player: " + JSON.stringify(r));
      check(r.shown && /Lethal Damage/.test(r.text) && r.pe === "none" && /^rgb\(196, 18, 47/.test(r.bg), "Lethal pop-up: red, never blocks a click: " + r.text);
      await O.screenshot({ path: SHOTS + '/19-lethal.png' });
      await O.waitForTimeout(1900);
      check(await O.$('#lethalPop') === null, "Lethal pop-up gone after its 1 s + fade");
    } }
  
  
      await b.close();
      check(true, "two-player attack flow, Undo across tabs, field effect by hand ran");
    })();
  } catch (e) { fails.push(String(e && e.stack || e)); console.log(e); }
  check(errs.length === 0, "no page errors" + (errs.length ? ": " + errs.join(" | ") : ""));
  console.log(`\nscreenshots: ${SHOTS}\n${fails.length ? fails.length + " failed" : "all passed"}`);
  server.close(); process.exit(fails.length ? 1 : 0);
});
