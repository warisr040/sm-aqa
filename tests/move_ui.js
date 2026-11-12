#!/usr/bin/env node
/* Site move (Revise#326): the old address offers "Move my decks"; the new one takes them from the link. Both addresses are served from dist. */
"use strict";
const fs = require("fs"), path = require("path"), { chromium } = require("playwright");
const ROOT = path.join(__dirname, "..", "dist", "aquarian-age-helper");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".webmanifest": "application/json" };
const fails = []; const check = (ok, msg) => { if (!ok) fails.push(msg); console.log((ok ? "  ✓ " : "  ✗ ") + msg); };
(async () => {
  const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.route(/drive\.google|googleusercontent|fonts\.|gstatic|cdnjs/, r => r.abort());
  await ctx.route(/^https:\/\/(aquarian-age-fs|sm-aqa)\.netlify\.app\//, r => {
    let f = path.join(ROOT, decodeURIComponent(new URL(r.request().url()).pathname)); if (f.endsWith("/")) f += "index.html";
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: "" });
    r.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || "application/octet-stream", body: fs.readFileSync(f) });
  });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", e => errs.push(String(e))); p.on("dialog", d => d.accept());
  await p.goto("https://aquarian-age-fs.netlify.app/");
  await p.evaluate(() => { const k = TB_KEY => TB_KEY; const d = { name: "Old deck", cols: { Character: [{ k: "A3-01 0001", n: 3 }], Break: [], Fast: [], Project: [], Permanent: [] } }; localStorage.setItem("aa-decks", JSON.stringify([d, null, d])); localStorage.setItem("aa-pname", JSON.stringify("Pack")); });
  await p.reload(); await p.waitForTimeout(400);
  check(/moved to/.test(await p.textContent("#moveBar").catch(() => "")) && /2 decks/.test(await p.textContent("#moveBar")), "old address: the bar says the site moved, 2 decks can come");
  await p.click("#moveGo"); await p.waitForTimeout(1200);
  check(new URL(p.url()).hostname === "sm-aqa.netlify.app" && !/#move=/.test(p.url()), "the new address opened, the link cleaned");
  const got = await p.evaluate(() => ({ d: JSON.parse(localStorage.getItem("aa-decks") || "[]").filter(Boolean).map(x => x.name), n: JSON.parse(localStorage.getItem("aa-pname") || "null") }));
  check(got.d.length === 2 && got.d[0] === "Old deck" && got.n === "Pack", "new address: the decks and the name arrived " + JSON.stringify(got));
  check(!(await p.$("#moveBar")), "no bar on the new address");
  check(!errs.length, "no page errors " + errs.join(" | "));
  await b.close();
  console.log(fails.length ? fails.length + " failed" : "all passed"); process.exit(fails.length ? 1 : 0);
})();
