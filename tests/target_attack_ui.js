#!/usr/bin/env node
/* v4 game table · "Targeting attack" (Pack, Revise#428 · report on A3-25 3686)

     python3 build.py && node tests/target_attack_ui.js [screenshot folder]

   A character that may attack characters shows ONE menu line, "Targeting attack"; the player then clicks the
   character to attack on the field (in blue). Solo two decks; the field is set up by hand. */
"use strict";
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const ROOT = path.join(__dirname, "..", "dist", "aquarian-age-helper");
const SHOTS = process.argv[2] || path.join(require("os").tmpdir(), "aa4-shots-ta");
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
  const errs = [];
  try {
    const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    await ctx.route(/drive\.google|googleusercontent|fonts\.|pages\.dev|firebase|gstatic/, r => r.abort());
    const p = await ctx.newPage(); p.on("pageerror", e => errs.push(String(e)));
    await p.goto(URL);
    await p.evaluate(() => {
      const all = TB.db.all(), pick = (f, t, n) => all.filter(c => c.faction === f && c.type === t).slice(0, n);
      const mk = (name, f, extra) => ({ name, cols: { Character: pick(f, "Character", 14).map(c => ({ k: c.key, n: 2 })), Break: (extra || []).map(k => ({ k, n: 4 })).concat(pick(f, "Break", 5).map(c => ({ k: c.key, n: 2 }))), Fast: pick(f, "Fast", 4).map(c => ({ k: c.key, n: 2 })), Project: pick(f, "Project", 2).map(c => ({ k: c.key, n: 2 })), Permanent: pick(f, "Permanent", 2).map(c => ({ k: c.key, n: 2 })) } });
      const twin = TB.db.card("A3-25 3686");
      localStorage.setItem("aa-decks", JSON.stringify([mk("Twin Angel test", twin.faction, ["A3-25 3686"]), mk("Darklore test", "Darklore")]));
      localStorage.setItem("aa-autoskip", "false");
    });
    await p.reload(); await p.waitForTimeout(300);
    await p.click("[data-act=solo2]"); await p.waitForTimeout(300); await p.click("[data-act=keep]"); await p.waitForTimeout(200); await p.click("[data-act=keep]"); await p.waitForTimeout(300);
    // by hand: my character with Twin Angel on it and 4 power cards; two characters on the other side
    const set = await p.evaluate(() => {
      const st = () => TB.ui.log.state, me = TB.viewSeat(), opp = 1 - me, isT = (id, t) => TB.db.card(st().cards[id].key).type === t;
      const from = (seat, f) => { const z = st().players[seat].zones; return z.hand.concat(z.deck).find(f); };
      const c = from(me, id => isT(id, "Character")); TB.send({ t: "move", seat: me, card: c, to: { z: "front" } });
      const ch = AA4.charOfCard(st(), c).id;
      const tw = from(me, id => st().cards[id].key === "A3-25 3686"); TB.send({ t: "move", seat: me, card: tw, to: { z: "char", ch, role: "stack" } });
      for (let i = 0; i < 4; i++) { const d = st().players[me].zones.deck; TB.send({ t: "move", seat: me, card: d[d.length - 1], to: { z: "char", ch, role: "power" } }); }
      const targets = [];
      for (let i = 0; i < 2; i++) { const o = from(opp, id => isT(id, "Character")); TB.send({ t: "move", seat: opp, card: o, to: { z: "front" } }); targets.push(AA4.charOfCard(st(), o).id); }
      return { me, ch, targets, top: st().cards[AA4.topOf(st().chars[ch])].key };
    });
    await p.waitForTimeout(250);
    check(set.top === "A3-25 3686", "set-up: Twin Angel is the top card of my character");
    for (let i = 0; i < 4 && await p.evaluate(() => TB.ui.log.state.turn.phase) !== "main"; i++) { await p.click("[data-act=next]"); await p.waitForTimeout(250); }
    check(await p.evaluate(() => TB.ui.log.state.turn.phase) === "main", "Main Phase");
    const nCand = await p.evaluate(ch => (TB.ctx().byCh.get(ch) || []).filter(c => c.kind === "attack" && c.target && c.target.ch != null).length, set.ch);
    check(nCand >= 2, "the engine offers an attack on each of the other player's characters: " + nCand);
    await p.click(`.ch[data-ch="${set.ch}"] .card.top`); await p.waitForTimeout(200);
    const items = await p.$$eval(".menu button", bs => bs.map(x => [x.textContent, x.className]));
    const ta = items.filter(x => /^Targeting attack/.test(x[0]));
    check(ta.length === 1 && /mi-atk/.test(ta[0][1]), "menu: one “Targeting attack” line, in the attack colour: " + JSON.stringify(items.map(x => x[0])));
    check(items.filter(x => /^Attack → /.test(x[0])).length === 1, "menu: “Attack →” is left only for the attack on the player");
    await p.screenshot({ path: SHOTS + "/1-menu.png" });
    await p.click('.menu button:has-text("Targeting attack")'); await p.waitForTimeout(200);
    const blue = await p.evaluate(() => [...TB.ctx().tgt].sort());
    check(await p.isVisible("#atkCharHint") && JSON.stringify(blue) === JSON.stringify(set.targets.map(t => "ch:" + t).sort()), "pick mode: a hint with Cancel, and exactly the other player's characters in blue: " + JSON.stringify(blue));
    await p.screenshot({ path: SHOTS + "/2-pick.png" });
    // Cancel leaves everything as it was
    await p.click("#atkCharHint [data-act=unsel]"); await p.waitForTimeout(150);
    check(!(await p.isVisible("#atkCharHint")) && await p.evaluate(() => TB.ctx().tgt.size === 0 && !TB.ui.log.state.draft && !TB.ui.log.state.battle), "Cancel: no pick mode, nothing declared");
    // again, and click the second character
    await p.click(`.ch[data-ch="${set.ch}"] .card.top`); await p.waitForTimeout(150);
    await p.click('.menu button:has-text("Targeting attack")'); await p.waitForTimeout(150);
    await p.click(`.ch[data-ch="${set.ch}"] .card.top`); await p.waitForTimeout(150);
    check(await p.isVisible("#atkCharHint"), "a click on a character that is not a target keeps the pick mode");
    await p.click(`.ch[data-ch="${set.targets[1]}"] .card.top`); await p.waitForTimeout(300);
    const dec = await p.evaluate(() => { const s = TB.ui.log.state, d = s.draft, bt = s.battle; return d ? { via: "draft", kind: d.kind, ch: d.ch, target: d.target } : bt ? { via: "battle", kind: "attack", ch: bt.attacker && bt.attacker.ch, target: bt.target } : null; });
    check(dec && dec.kind === "attack" && dec.target && dec.target.ch === set.targets[1], "the click on the field declares the attack on that character: " + JSON.stringify(dec));
    check(!(await p.isVisible("#atkCharHint")), "pick mode ended");
    await p.screenshot({ path: SHOTS + "/3-declared.png" });
    await b.close();
  } catch (e) { fails.push(String(e && e.stack || e)); console.log(e); }
  check(errs.length === 0, "no page errors" + (errs.length ? ": " + errs.join(" | ") : ""));
  console.log(`\nscreenshots: ${SHOTS}\n${fails.length ? fails.length + " failed" : "all passed"}`);
  server.close(); process.exit(fails.length ? 1 : 0);
});
