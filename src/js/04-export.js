/* ==========================================================================
   Modal dialogs: Export (image / text), Import, How to use.
   Deck list text format (one line per card):  "4 x A3-01 0035  財巫女"
   under "[Character] 24"-style category headers.
   ========================================================================== */

let lastFocus = null;
function openModal(title, html, wide) {
  lastFocus = document.activeElement;
  $("modal").classList.toggle("wide", !!wide);
  $("m-title").textContent = title;
  $("mbody").innerHTML = html;
  $("sheet").hidden = true;
  $("modal").hidden = $("scrim").hidden = false;
  $("modal").scrollTop = 0;
  $("mclose").focus();
}
function closeAll() {
  document.body.classList.remove("sheetover");
  $("sheet").hidden = $("modal").hidden = $("scrim").hidden = true;
  jpgJob++;   // cancel an image export still in progress
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}

const fileName = (d = deck) => (d.name || "deck").replace(/[\\/:*?"<>|]+/g, "_").trim() || "deck";
function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

/* ---------- deck list text ---------- */
const DECK_SEP = "# ==========";
/** Decks in the slots that hold cards: [{i, d}] (the open deck is current). */
const filledSlots = () => deckSlots.map((d, i) => ({ i, d: i === deckSlot ? deck : d })).filter(x => slotTotal(x.d));
function deckText(d = deck) {
  const L = ["# Aquarian Age Thailand Fan-site deck list", `# Deck: ${d.name}`, `# Total: ${slotTotal(d)}`, "# Format: count x series card-no  name", ""];
  for (const C of CATS) {
    L.push(`[${C.id}] ${d.cols[C.id].reduce((n, e) => n + e.n, 0)}`);
    d.cols[C.id].forEach(e => L.push(`${e.n} x ${e.k}  ${card(e.k).jp}`));
    L.push("");
  }
  return L.join("\n");
}

/** Parse a deck list. Enforces the 4-copy (per name) and 60-card limits. */
function parseDeck(txt) {
  const d = emptyDeck(), bad = [], notes = [], perName = {};
  let cat = "Character", total = 0;
  for (const raw of String(txt).split(/\r?\n/)) {
    const line = raw.trim();
    let m;
    if (!line) continue;
    if ((m = line.match(/^#\s*Deck:\s*(.+)$/i))) { d.name = m[1].trim().slice(0, 60); continue; }
    if (line.startsWith("#")) continue;
    if ((m = line.match(/^\[([^\]]+)\]/))) {
      const n = m[1].trim().toLowerCase();
      const C = CATS.find(X => X.id.toLowerCase() === n || X.short.toLowerCase() === n);
      if (C) cat = C.id; else bad.push(line);
      continue;
    }
    if ((m = line.match(/^(\d+)\s*[x×*]?\s*(\S+)\s+(\S+)/i))) {
      const c = card(m[2] + " " + m[3]);
      if (!c) { bad.push(line); continue; }
      const want = +m[1];
      const n = want;   // no 4-per-name / 60-card limit (Pack, Revise#211)
      if (n < want) notes.push(`${c.jp}: kept ${Math.max(n, 0)} of ${want}`);
      if (n <= 0) continue;
      let existing = null;
      for (const C of CATS) { existing = d.cols[C.id].find(e => e.k === c.k); if (existing) break; }
      if (existing) existing.n += n; else d.cols[cat].push({ k: c.k, n });
      perName[c.jp] = (perName[c.jp] || 0) + n;
      total += n;
      continue;
    }
    bad.push(line);
  }
  return { deck: d, bad, notes, total };
}

/* ---------- Export ---------- */
let jpgURL = null, jpgJob = 0;
let exportAll = false;
const allText = (list = filledSlots()) => list.map(x => `# Slot: ${x.i + 1}\n` + deckText(x.d)).join(`\n${DECK_SEP}\n\n`);
/* Export from another source (Revise#314, the Account page): {list: [{i, d}], cur: deck, label} — null = the Deck Builder itself. */
let exportSrc = null;
function openExport(src) {
  if (src === undefined || (src && src.target)) exportSrc = null; else if (src) exportSrc = src;   // a click event = the Deck Builder's own button
  const list = exportSrc ? exportSrc.list : filledSlots(), cur = exportSrc ? exportSrc.cur : deck;
  const nAll = list.length;
  openModal(exportSrc && exportSrc.label ? "Export · " + exportSrc.label : "Export deck", `
    <div class="seg" role="group" aria-label="Which decks"><button type="button" data-scope="one" aria-pressed="${!exportAll}">This deck</button><button type="button" data-scope="all" aria-pressed="${exportAll}"${nAll ? "" : " disabled"}>All decks (${nAll})</button></div>
    <div class="seg" role="group" aria-label="Format"><button type="button" data-fmt="jpg" aria-pressed="true">Image (.jpg)</button><button type="button" data-fmt="txt" aria-pressed="false">List (text)</button><button type="button" data-fmt="print" aria-pressed="false"${exportAll || !cur || !slotTotal(cur) ? " disabled" : ""} title="Cards at real size on A4 pages (this deck) — for logged-in players">Print Preview</button></div>
    <div id="fx-jpg" class="fx">
      <div class="prev" id="prev"><span class="note">Drawing the deck image…</span></div>
      <p class="note" id="jstat"></p>
      <div class="actions"><button class="btn primary" id="dlJpg" type="button" disabled>Download .jpg</button></div>
    </div>
    <div id="fx-txt" class="fx" hidden>
      <textarea id="txtOut" rows="14" readonly aria-label="Deck list"></textarea>
      <div class="actions"><button class="btn primary" id="copyTxt" type="button">Copy</button><button class="btn" id="dlTxt" type="button">Download .txt</button></div>
      <p class="note">Paste this list into Import to rebuild the deck later.</p>
    </div>
    <div id="fx-print" class="fx" hidden></div>`);
  if (!cur && !exportAll && nAll) exportAll = true;
  $("txtOut").value = exportAll ? allText(list) : cur ? deckText(cur) : "";
  $("mbody").querySelectorAll("[data-scope]").forEach(b => (b.onclick = () => { exportAll = b.dataset.scope === "all"; const fmt = $("fx-txt").hidden ? "jpg" : "txt"; openExport(null); if (fmt === "txt") $("mbody").querySelector('[data-fmt="txt"]').click(); }));
  $("mbody").querySelectorAll("[data-fmt]").forEach(b => (b.onclick = () => {
    $("mbody").querySelectorAll("[data-fmt]").forEach(x => x.setAttribute("aria-pressed", x === b));
    $("fx-jpg").hidden = b.dataset.fmt !== "jpg";
    $("fx-txt").hidden = b.dataset.fmt !== "txt";
    $("fx-print").hidden = b.dataset.fmt !== "print";
    if (b.dataset.fmt === "print") openPrint(cur || deck);
  }));
  $("copyTxt").onclick = async e => {
    const b = e.currentTarget;
    try { await navigator.clipboard.writeText($("txtOut").value); b.textContent = "Copied"; }
    catch (err) { $("txtOut").select(); b.textContent = "Press Ctrl+C to copy"; }
  };
  $("dlTxt").onclick = () => download(new Blob([exportAll ? allText(list) : cur ? deckText(cur) : ""], { type: "text/plain;charset=utf-8" }), exportAll ? "aquarian-age-decks.txt" : fileName(cur || deck) + ".txt");
  if (exportAll) makeAllJpg(list); else makeJpg(cur || deck);
}

async function makeJpg(d = deck) {
  const job = ++jpgJob;
  if (!slotTotal(d)) { $("prev").innerHTML = `<span class="note">Add cards to the deck first.</span>`; return; }
  const keep = deck; deck = d;   // drawn as the open deck while it draws (as makeAllJpg does)
  let res; try { res = await drawDeckImage(p => { if (job === jpgJob && $("jstat")) $("jstat").textContent = `Loading card images… ${p}`; }); } finally { deck = keep; }
  const { canvas, missing } = res;
  if (job !== jpgJob || $("modal").hidden) return;
  let blob = null;
  try { blob = await new Promise(r => canvas.toBlob(r, "image/jpeg", 0.92)); } catch (e) { /* tainted canvas */ }
  if (!blob) { $("jstat").textContent = "The browser blocked the image export. Use List (text) instead."; return; }
  if (jpgURL) URL.revokeObjectURL(jpgURL);
  jpgURL = URL.createObjectURL(blob);
  $("prev").innerHTML = `<img src="${jpgURL}" alt="Deck image preview">`;
  $("jstat").textContent = `${canvas.width} × ${canvas.height} px` + (missing ? ` · ${missing} card image(s) couldn't be loaded from Drive and show as name tiles.` : "");
  $("dlJpg").disabled = false;
  $("dlJpg").onclick = () => download(blob, fileName(d) + ".jpg");
}

/* ---------- Print Preview (Pack, Revise#424): the chosen cards at real size (59 × 86 mm) on A4 pages, as .pdf or .png ---------- */
const PRINT = { cw: 59, ch: 86, gap: 1, a4: [210, 297], pick: null, layout: "p", dpi: 300, pages: [], job: 0 };
const printLayouts = () => {   // portrait 3 × 3 = 9 a page, 1 mm between the cards (Revise#426); landscape 5 × 2 needs 299 mm with the gaps — wider than A4 — so it is gone
  const g = PRINT.gap, f = n => Math.round(n * 100) / 100, mk = (id, W, H, cols, rows) => ({ id, W, H, cols, rows, per: cols * rows, mx: f((W - cols * PRINT.cw - (cols - 1) * g) / 2), my: f((H - rows * PRINT.ch - (rows - 1) * g) / 2) });
  return { p: mk("p", PRINT.a4[0], PRINT.a4[1], 3, 3) };
};
const printEntries = d => CATS.flatMap(C => d.cols[C.id].map(e => ({ k: e.k, n: e.n, cat: C.id }))).filter(e => card(e.k));
/* Print Preview is for logged-in players only (Pack, Revise#425) */
const printState = () => (window.AAAccount && AAAccount.state ? AAAccount.state() : "out");
function openPrint(d, tries) {
  const box = $("fx-print"), ents = printEntries(d), L = printLayouts();
  if (!box) return;
  const st = printState();
  if (st !== "in") {
    PRINT.job++;
    if (st === "wait" && (tries || 0) < 40) {   // a remembered login is being checked: wait for the answer (up to 10 s)
      box.innerHTML = `<p class="note" id="prGate">Checking your login…</p>`;
      setTimeout(() => { if ($("fx-print") === box && !box.hidden) openPrint(d, (tries || 0) + 1); }, 250);
      return;
    }
    box.innerHTML = `<div class="prgate" id="prGate"><p><b>Log in to use Print Preview.</b></p><p class="note">Print Preview is for players with an account. Your deck stays as it is — log in, then open Export again.</p><div class="actions"><button class="btn primary" type="button" id="prLogin">Log in</button></div></div>`;
    $("prLogin").onclick = () => { closeAll(); if (window.AAAccount) AAAccount.open(); };
    return;
  }
  if (!PRINT.pick || PRINT.deckRef !== d) { PRINT.pick = new Set(ents.map(e => e.k)); PRINT.deckRef = d; PRINT.pages = []; }
  const total = () => ents.filter(e => PRINT.pick.has(e.k)).reduce((n, e) => n + e.n, 0);
  const draw = () => {
    const n = total(), lay = L.p, pages = Math.ceil(n / lay.per);
    box.innerHTML = `<p class="note">Choose the cards to print. Each card is printed as many times as it is in the deck, at real size: ${PRINT.cw} × ${PRINT.ch} mm, ${PRINT.gap} mm apart, on A4 pages with cut lines. The whole picture is printed — nothing is cropped. Print at 100% (“Actual size”), not “Fit to page”.</p>
      <div class="prow"><button class="btn sm" type="button" id="prAll">All</button><button class="btn sm" type="button" id="prNone">None</button><b id="prSum">${n} card${n === 1 ? "" : "s"} · ${pages} A4 page${pages === 1 ? "" : "s"}</b></div>
      <div class="prlist" id="prList">${ents.map(e => { const c = card(e.k); return `<label class="pritem${PRINT.pick.has(e.k) ? " on" : ""}"><input type="checkbox" data-k="${esc(e.k)}"${PRINT.pick.has(e.k) ? " checked" : ""}><span class="prn">${e.n} ×</span><span class="prk">${esc(c.s.code)} · ${esc(c.id)}</span><span class="prj">${esc(c.jp)}</span></label>`; }).join("")}</div>
      <div class="prow"><span class="note" id="prLayNote">${L.p.per} cards a page · ${PRINT.gap} mm between cards · margins ${L.p.mx} / ${L.p.my} mm</span>
        <label>Quality <select id="prDpi"><option value="300"${PRINT.dpi === 300 ? " selected" : ""}>300 dpi (best)</option><option value="200"${PRINT.dpi === 200 ? " selected" : ""}>200 dpi (smaller file)</option></select></label></div>
      <div class="actions"><button class="btn primary" id="prMake" type="button"${n ? "" : " disabled"}>Make the pages</button><button class="btn" id="prPdf" type="button" disabled>Download .pdf</button><button class="btn" id="prPng" type="button" disabled>Download .png (every page)</button></div>
      <p class="note" id="prStat"></p><div class="prpages" id="prPages"></div>`;
    box.querySelectorAll("#prList input").forEach(x => (x.onchange = () => { if (x.checked) PRINT.pick.add(x.dataset.k); else PRINT.pick.delete(x.dataset.k); PRINT.pages = []; draw(); }));
    $("prAll").onclick = () => { PRINT.pick = new Set(ents.map(e => e.k)); PRINT.pages = []; draw(); };
    $("prNone").onclick = () => { PRINT.pick = new Set(); PRINT.pages = []; draw(); };
    $("prDpi").onchange = e => { PRINT.dpi = +e.target.value; PRINT.pages = []; draw(); };
    $("prMake").onclick = () => makePrintPages(d, ents.filter(e => PRINT.pick.has(e.k)), L.p);
    if (PRINT.pages.length) showPrintPages(d);
  };
  draw();
}
/** Card art for printing: the large picture, usable in a canvas (CORS). */
function loadPrintImage(fid) {
  const tryUrl = u => new Promise(res => { const im = new Image(); im.crossOrigin = "anonymous"; const t = setTimeout(() => res(null), 20000); im.onload = () => { clearTimeout(t); res(im); }; im.onerror = () => { clearTimeout(t); res(null); }; im.src = u; });
  return (IMG_BASE ? tryUrl(IMG.cdn(fid, 1000)) : Promise.resolve(null)).then(im => im || tryUrl(IMG.lh3(fid, 1000))).then(im => im || tryUrl(IMG.drive(fid, 1000)));
}
async function makePrintPages(d, ents, lay) {
  if (printState() !== "in") return openPrint(d);
  const job = ++PRINT.job, stat = t => { if (job === PRINT.job && $("prStat")) $("prStat").textContent = t; };
  const px = mm => Math.round(mm / 25.4 * PRINT.dpi), list = ents.flatMap(e => Array(e.n).fill(e.k)), fids = [...new Set(list.map(k => card(k).fid))], art = new Map();
  $("prMake").disabled = true; $("prPdf").disabled = $("prPng").disabled = true; PRINT.pages = [];
  let done = 0, missing = 0;
  for (let i = 0; i < fids.length; i += 6) {   // six pictures at a time
    await Promise.all(fids.slice(i, i + 6).map(async f => { const im = await loadPrintImage(f); if (im) art.set(f, im); else missing++; done++; stat(`Loading card pictures… ${done} / ${fids.length}`); }));
    if (job !== PRINT.job || $("modal").hidden) return;
  }
  const W = px(lay.W), H = px(lay.H), cw = px(PRINT.cw), ch = px(PRINT.ch), gp = px(PRINT.gap), x0 = Math.round((W - lay.cols * cw - (lay.cols - 1) * gp) / 2), y0 = Math.round((H - lay.rows * ch - (lay.rows - 1) * gp) / 2), nPages = Math.ceil(list.length / lay.per);
  for (let p = 0; p < nPages; p++) {
    stat(`Drawing page ${p + 1} / ${nPages}…`); await new Promise(r => setTimeout(r, 0));
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const x = cv.getContext("2d");
    x.fillStyle = "#fff"; x.fillRect(0, 0, W, H); x.imageSmoothingQuality = "high";
    const part = list.slice(p * lay.per, (p + 1) * lay.per);
    part.forEach((k, i) => {
      const c = card(k), X = x0 + (i % lay.cols) * (cw + gp), Y = y0 + Math.floor(i / lay.cols) * (ch + gp), im = art.get(c.fid);
      if (im) {
        const land = im.naturalWidth > im.naturalHeight * 1.05, iw = land ? im.naturalHeight : im.naturalWidth, ih = land ? im.naturalWidth : im.naturalHeight, sc = Math.min(cw / iw, ch / ih);   // the whole picture inside the 59 × 86 box, never cropped (Revise#426); a landscape picture is turned
        x.save(); x.beginPath(); x.rect(X, Y, cw, ch); x.clip(); x.translate(X + cw / 2, Y + ch / 2); if (land) x.rotate(Math.PI / 2);
        x.drawImage(im, -im.naturalWidth * sc / 2, -im.naturalHeight * sc / 2, im.naturalWidth * sc, im.naturalHeight * sc); x.restore();
      } else {
        x.fillStyle = "#eef0f6"; x.fillRect(X, Y, cw, ch); x.fillStyle = "#222"; x.textAlign = "center";
        x.font = `700 ${Math.round(cw / 14)}px sans-serif`; x.fillText(`${c.s.code} · ${c.id}`, X + cw / 2, Y + ch / 2 - cw / 14, cw * 0.9);
        x.font = `${Math.round(cw / 16)}px sans-serif`; x.fillText(c.jp, X + cw / 2, Y + ch / 2 + cw / 16, cw * 0.9); x.fillText("(no picture)", X + cw / 2, Y + ch / 2 + cw / 5, cw * 0.9);
      }
    });
    // cut lines: each card's own outline (the cards are 1 mm apart), and marks out into the margins
    const rowsUsed = Math.ceil(part.length / lay.cols), lw = Math.max(1, Math.round(PRINT.dpi / 300)), mark = px(4);
    x.strokeStyle = "rgba(0,0,0,.55)"; x.lineWidth = lw; x.beginPath();
    part.forEach((k, i) => x.rect(x0 + (i % lay.cols) * (cw + gp) + lw / 2, y0 + Math.floor(i / lay.cols) * (ch + gp) + lw / 2, cw - lw, ch - lw));
    const yEnd = y0 + rowsUsed * ch + (rowsUsed - 1) * gp, xEnd = x0 + lay.cols * cw + (lay.cols - 1) * gp;
    for (let c2 = 0; c2 < lay.cols; c2++) for (const X of [x0 + c2 * (cw + gp) + lw / 2, x0 + c2 * (cw + gp) + cw - lw / 2]) { x.moveTo(X, Math.max(0, y0 - mark)); x.lineTo(X, y0); x.moveTo(X, yEnd); x.lineTo(X, Math.min(H, yEnd + mark)); }
    for (let r = 0; r < rowsUsed; r++) for (const Y of [y0 + r * (ch + gp) + lw / 2, y0 + r * (ch + gp) + ch - lw / 2]) { x.moveTo(Math.max(0, x0 - mark), Y); x.lineTo(x0, Y); x.moveTo(xEnd, Y); x.lineTo(Math.min(W, xEnd + mark), Y); }
    x.stroke();
    let png = null, jpg = null;
    try { png = await pngWithDpi(await new Promise(r => cv.toBlob(r, "image/png")), PRINT.dpi); jpg = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.92)); } catch (e) { /* tainted canvas */ }
    if (!png || !jpg) { stat("The browser blocked the picture export."); $("prMake").disabled = false; return; }
    if (job !== PRINT.job || $("modal").hidden) return;
    PRINT.pages.push({ png, jpg, W, H, land: lay.id === "l" });
  }
  PRINT.missing = missing; $("prMake").disabled = false;
  showPrintPages(d);
}
function showPrintPages(d) {
  const P = PRINT.pages; if (!P.length || !$("prPages")) return;
  (PRINT.urls || []).forEach(u => URL.revokeObjectURL(u)); PRINT.urls = P.map(pg => URL.createObjectURL(pg.jpg));
  $("prPages").innerHTML = P.map((pg, i) => `<figure class="prpage"><img src="${PRINT.urls[i]}" alt="Page ${i + 1}"><figcaption>Page ${i + 1} / ${P.length} <button class="btn sm" type="button" data-prpng="${i}">.png</button></figcaption></figure>`).join("");
  $("prStat").textContent = `${P.length} page${P.length === 1 ? "" : "s"} · A4 · ${P[0].W} × ${P[0].H} px at ${PRINT.dpi} dpi` + (PRINT.missing ? ` · ${PRINT.missing} picture(s) could not be loaded and show as name tiles.` : "");
  const name = fileName(d) + "-print";
  $("prPages").querySelectorAll("[data-prpng]").forEach(b => (b.onclick = () => download(P[+b.dataset.prpng].png, `${name}-${+b.dataset.prpng + 1}.png`)));
  $("prPdf").disabled = $("prPng").disabled = false;
  $("prPdf").onclick = async () => download(await printPdf(P), name + ".pdf");
  $("prPng").onclick = () => P.forEach((pg, i) => setTimeout(() => download(pg.png, `${name}-${i + 1}.png`), i * 400));
}
/** The PNG with its print size written in (a pHYs chunk: pixels per metre), so a print program knows it is A4 at that dpi. */
async function pngWithDpi(blob, dpi) {
  const b = new Uint8Array(await blob.arrayBuffer()), ppm = Math.round(dpi / 0.0254), ch = new Uint8Array(21), dv = new DataView(ch.buffer);
  if (b.length < 33 || b[12] !== 73 || b[13] !== 72) return blob;   // not "IHDR" where it must be
  dv.setUint32(0, 9); ch.set([112, 72, 89, 115], 4); dv.setUint32(8, ppm); dv.setUint32(12, ppm); ch[16] = 1;
  let c = ~0; for (let i = 4; i < 17; i++) { c ^= ch[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
  dv.setUint32(17, ~c >>> 0);
  return new Blob([b.slice(0, 33), ch, b.slice(33)], { type: "image/png" });
}
/** A PDF with one A4 page per picture (JPEG inside, no library). */
async function printPdf(pages) {
  const enc = new TextEncoder(), parts = [], offs = []; let len = 0;
  const put = x => { const b = typeof x === "string" ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const obj = (n, body) => { offs[n] = len; put(`${n} 0 obj\n`); body(); put(`\nendobj\n`); };
  put("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  const N = pages.length, kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ");
  obj(1, () => put(`<< /Type /Catalog /Pages 2 0 R >>`));
  obj(2, () => put(`<< /Type /Pages /Count ${N} /Kids [${kids}] >>`));
  for (let i = 0; i < N; i++) {
    const pg = pages[i], w = pg.land ? 841.89 : 595.28, h = pg.land ? 595.28 : 841.89, jpg = new Uint8Array(await pg.jpg.arrayBuffer()), cs = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    obj(3 + i * 3, () => put(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${5 + i * 3} 0 R >> >> /Contents ${4 + i * 3} 0 R >>`));
    obj(4 + i * 3, () => put(`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`));
    obj(5 + i * 3, () => { put(`<< /Type /XObject /Subtype /Image /Width ${pg.W} /Height ${pg.H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`); put(jpg); put(`\nendstream`); });
  }
  const xref = len, count = 3 + N * 3;
  put(`xref\n0 ${count}\n0000000000 65535 f \n` + Array.from({ length: count - 1 }, (_, k) => String(offs[k + 1]).padStart(10, "0") + " 00000 n \n").join(""));
  put(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: "application/pdf" });
}

/** All decks as images: drawn one after another (the open deck is swapped in while drawing). */
async function makeAllJpg(list = filledSlots()) {
  const job = ++jpgJob, out = [];
  const keep = deck;
  for (const [n, x] of list.entries()) {
    if (job !== jpgJob) break;
    $("jstat").textContent = `Drawing deck ${n + 1} of ${list.length}: ${x.d.name}…`;
    deck = x.d;
    let res;
    try { res = await drawDeckImage(() => {}); } finally { deck = keep; }
    let blob = null;
    try { blob = await new Promise(r => res.canvas.toBlob(r, "image/jpeg", 0.9)); } catch (e) { /* tainted */ }
    if (blob) out.push({ blob, name: `${String(x.i + 1).padStart(2, "0")} - ${fileName(x.d)}.jpg`, url: URL.createObjectURL(blob) });
  }
  if (job !== jpgJob || $("modal").hidden) return;
  if (!out.length) { $("jstat").textContent = "The browser blocked the image export. Use List (text) instead."; return; }
  $("prev").innerHTML = `<div class="prevs">${out.map(o => `<figure><img src="${o.url}" alt=""><figcaption>${esc(o.name)}</figcaption></figure>`).join("")}</div>`;
  $("jstat").textContent = `${out.length} deck images. Your browser may ask once to allow several downloads.`;
  $("dlJpg").textContent = `Download ${out.length} .jpg files`;
  $("dlJpg").disabled = false;
  $("dlJpg").onclick = async () => { for (const o of out) { download(o.blob, o.name); await new Promise(r => setTimeout(r, 400)); } };
}

/* ---------- Import ---------- */
function openImport() {
  openModal("Import deck", `
    <p class="note">Paste a list made with Export → List (text), or choose a saved .txt file. A single deck replaces the open slot; an “All decks” file fills the slots it was exported from.</p>
    <textarea id="txtIn" rows="12" aria-label="Deck list to import" placeholder="[Character] 24&#10;4 x A3-01 0035  財巫女&#10;3 x A3-02 0110  …"></textarea>
    <div class="actions"><label class="btn" for="fileIn">Choose .txt file</label><input id="fileIn" type="file" accept=".txt,text/plain" hidden><button class="btn primary" id="doImport" type="button">Import</button></div>
    <label class="impchk"><input type="checkbox" id="impCheck"${store.get("aa-imp-check", true) ? " checked" : ""}> Empty Check — ask before overwriting a slot that has cards</label>
    <div id="impAsk" class="impask" hidden></div>
    <p class="note" id="impMsg"></p>`);
  $("impCheck").onchange = e => store.set("aa-imp-check", e.target.checked);
  $("fileIn").onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => ($("txtIn").value = r.result);
    r.readAsText(f);
  };
  /** Empty Check (Pack, Revise#219): the slots (1–10) this import would fill that already have cards → "Would you like to overwrite slot number 1, 7 and 10?" — Yes / No */
  const slotsOf = blocks => blocks.length > 1
    ? blocks.map((b, k) => { const m = b.match(/^#\s*Slot:\s*(\d+)/m); return parseDeck(b).total ? (m ? Math.min(DECK_SLOTS, Math.max(1, +m[1])) - 1 : k) : -1; }).filter(i => i >= 0 && i < DECK_SLOTS)
    : [deckSlot];
  const fullSlots = idx => [...new Set(idx)].filter(i => slotTotal(i === deckSlot ? deck : deckSlots[i]) > 0).sort((x, y) => x - y);
  const slotList = ns => (ns.length === 1 ? String(ns[0]) : ns.slice(0, -1).join(", ") + " and " + ns[ns.length - 1]);
  $("doImport").onclick = () => {
    const blocks = $("txtIn").value.split(DECK_SEP).filter(b => b.trim());
    if (!blocks.length) { $("impMsg").textContent = "Paste a deck list first."; return; }
    const full = $("impCheck").checked ? fullSlots(slotsOf(blocks)) : [];
    if (!full.length) { doImportNow(); return; }
    const ask = $("impAsk");
    ask.hidden = false;
    ask.innerHTML = `<p>Would you like to overwrite slot number ${slotList(full.map(i => i + 1))}?</p><div class="actions"><button class="btn primary" id="impYes" type="button">Yes</button><button class="btn" id="impNo" type="button">No</button></div>`;
    $("impYes").onclick = () => { ask.hidden = true; doImportNow(); };
    $("impNo").onclick = () => { ask.hidden = true; ask.innerHTML = ""; $("impMsg").textContent = "Not imported — nothing was overwritten."; };
  };
  const doImportNow = () => {
    const blocks = $("txtIn").value.split(DECK_SEP).filter(b => b.trim());
    if (blocks.length > 1) {   // a file made with Export → All decks: fill the slots it names
      let n = 0;
      saveSlots();
      blocks.forEach((b, k) => {
        const m = b.match(/^#\s*Slot:\s*(\d+)/m), i = m ? Math.min(DECK_SLOTS, Math.max(1, +m[1])) - 1 : k;
        const r = parseDeck(b);
        if (r.total && i < DECK_SLOTS) { deckSlots[i] = r.deck; n++; }
      });
      deck = deckSlots[deckSlot] || emptyDeck(`Deck ${deckSlot + 1}`);
      deckChanged(); closeAll(); toast(`Imported ${n} decks into their slots`);
      return;
    }
    const r = parseDeck($("txtIn").value);
    if (!r.total) {
      $("impMsg").textContent = r.bad.length ? `No cards recognised. Check these lines: ${r.bad.slice(0, 3).join(" / ")}` : "Paste a deck list first.";
      return;
    }
    deck = r.deck; deckChanged(); toast(`Imported ${r.total} cards`);
    const extra = [...r.notes, r.bad.length ? `${r.bad.length} line(s) skipped: ${r.bad.slice(0, 4).join(" / ")}` : ""].filter(Boolean);
    if (extra.length) $("impMsg").textContent = `Imported ${r.total} cards. ` + extra.join(" · ");
    else closeAll();
  };
}

/* ---------- How to use (Deck Builder) ---------- */
function openHelp() {
  openModal("", "", true);
  $("m-title").innerHTML = '<small>How to use</small>วิธีใช้ Deck Builder';
  $("mbody").appendChild($("helpTpl").content.cloneNode(true));
  $("mbody").querySelectorAll("[data-hjump]").forEach(a => (a.onclick = e => {
    e.preventDefault(); scrollToEl($("mbody").querySelector(a.getAttribute("href")));
  }));
}

/* ---------- deck image (canvas) ---------- */
function roundRect(x, X, Y, w, h, r) {
  x.beginPath(); x.moveTo(X + r, Y);
  x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r);
  x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath();
}
function hexA(h, a) { const n = parseInt(h.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
function fitText(x, t, X, Y, maxW) {
  let s = t;
  if (x.measureText(s).width <= maxW) { x.fillText(s, X, Y); return; }
  while (s.length > 1 && x.measureText(s + "…").width > maxW) s = s.slice(0, -1);
  x.fillText(s + "…", X, Y);
}
function wrapText(x, t, X, Y, maxW, lineH, maxLines) {
  let line = "", n = 0;
  for (const ch of t) {
    if (x.measureText(line + ch).width > maxW) { x.fillText(line, X, Y + n * lineH); line = ch; if (++n >= maxLines) return; }
    else line += ch;
  }
  if (line) x.fillText(line, X, Y + n * lineH);
}
/** Card art must come with CORS headers to be drawn into an exportable canvas. */
function loadCorsImage(fid) {
  const tryUrl = u => new Promise(res => {
    const im = new Image(); im.crossOrigin = "anonymous";
    const t = setTimeout(() => res(null), 15000);
    im.onload = () => { clearTimeout(t); res(im); };
    im.onerror = () => { clearTimeout(t); res(null); };
    im.src = u;
  });
  return (IMG_BASE ? tryUrl(IMG.cdn(fid, 320)) : Promise.resolve(null)).then(im => im || tryUrl(IMG.lh3(fid, 320))).then(im => im || tryUrl(IMG.drive(fid, 320)));
}

async function drawDeckImage(progress) {
  try { await document.fonts.ready; } catch (e) { /* fonts optional */ }
  const CW = 150, CH = 210, QW = 66, PAD = 40, GAP = 18, COLW = CW + QW + 24, HEAD = 200, COLH = 46, ROWH = CH + 14;
  const FONT = "'Zen Kaku Gothic New',sans-serif", MONO = "'IBM Plex Mono',monospace";
  // the same columns and order as the board: Character · main factor / other factors, then Break / Fast / Project / Permanent (Pack, Revise#161)
  arrangeDeck();
  const COLS = boardCols(), NC = COLS.length;
  const W = PAD * 2 + NC * COLW + (NC - 1) * GAP;
  const rows = Math.max(1, ...COLS.map(C => C.list.length));
  const H = PAD + HEAD + COLH + rows * ROWH + 14 + PAD + 20;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const x = canvas.getContext("2d");

  // night sky
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#060828"); g.addColorStop(0.45, "#121866"); g.addColorStop(1, "#060828");
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  for (const [cx, cy, r, c] of [[W * 0.8, H * 0.1, W * 0.45, "rgba(90,72,212,.45)"], [W * 0.15, H * 0.6, W * 0.4, "rgba(82,182,255,.16)"], [W * 0.55, H * 0.95, W * 0.5, "rgba(90,72,212,.3)"]]) {
    const rg = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    rg.addColorStop(0, c); rg.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = rg; x.fillRect(0, 0, W, H);
  }
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  x.fillStyle = "#fff";
  for (let i = 0; i < (W * H) / 2000; i++) {
    x.globalAlpha = 0.25 + rnd() * 0.7;
    x.beginPath(); x.arc(rnd() * W, rnd() * H, rnd() < 0.06 ? 1.6 : 0.4 + rnd() * 0.8, 0, 6.283); x.fill();
  }
  x.globalAlpha = 1;

  // header: banner, deck name, totals, category pills
  const banner = $("banner"), bh = HEAD - 44, bw = banner && banner.naturalWidth ? (bh * banner.naturalWidth) / banner.naturalHeight : (bh * 970) / 299;
  if (banner && banner.complete && banner.naturalWidth) {
    x.save(); roundRect(x, PAD, PAD, bw, bh, 12); x.clip(); x.drawImage(banner, PAD, PAD, bw, bh); x.restore();
  }
  const tx = PAD + bw + 32, t = deckTotal();
  x.fillStyle = "#f1f3ff"; x.font = `700 34px ${FONT}`; fitText(x, deck.name || "Deck", tx, PAD + 40, W - PAD - tx);
  x.font = `700 26px ${MONO}`; x.fillStyle = t >= LIMITS.min && t <= LIMITS.deck ? "#4fe3a6" : "#ffd447";
  x.fillText(`${t} / ${LIMITS.deck} cards`, tx, PAD + 82);
  x.font = `700 16px ${FONT}`;
  let sx = tx, sy = PAD + 124;
  for (const C of CATS) {
    const label = `${C.id}  ${catTotal(C.id)}`, w = x.measureText(label).width + 36;
    if (sx + w > W - PAD) { sx = tx; sy += 40; }
    roundRect(x, sx, sy - 21, w, 30, 15);
    x.fillStyle = hexA(C.color, 0.16); x.fill(); x.strokeStyle = hexA(C.color, 0.6); x.lineWidth = 1.5; x.stroke();
    x.fillStyle = C.color; x.beginPath(); x.arc(sx + 15, sy - 6, 5, 0, 6.283); x.fill();
    x.fillStyle = "#f1f3ff"; x.fillText(label, sx + 27, sy);
    sx += w + 8;
  }

  // card art
  const fids = [...new Set(CATS.flatMap(C => deck.cols[C.id].map(e => card(e.k).fid)))];
  const art = new Map(); let done = 0;
  progress(`0/${fids.length}`);
  await Promise.all(fids.map(async f => { art.set(f, await loadCorsImage(f)); progress(`${++done}/${fids.length}`); }));
  const missing = fids.filter(f => !art.get(f)).length;

  // columns
  COLS.forEach((C, ci) => {
    const cx = PAD + ci * (COLW + GAP), cy = PAD + HEAD, ch = H - cy - PAD - 20;
    roundRect(x, cx, cy, COLW, ch, 12);
    x.fillStyle = "rgba(6,8,40,.6)"; x.fill(); x.strokeStyle = "rgba(170,182,255,.25)"; x.lineWidth = 1; x.stroke();
    x.fillStyle = C.color; x.fillRect(cx + 10, cy, COLW - 20, 3);
    x.font = `700 18px ${FONT}`; fitText(x, C.cat === "Character" ? C.short.replace(/^Char/, "Character") : C.label, cx + 14, cy + 31, COLW - 64);
    x.textAlign = "right"; x.fillStyle = "#f1f3ff"; x.font = `700 18px ${MONO}`;
    x.fillText(String(listTotal(C.list)), cx + COLW - 14, cy + 31); x.textAlign = "left";
    C.list.forEach((e, j) => {
      const c = card(e.k), ix = cx + 12, iy = cy + COLH + j * ROWH, im = art.get(c.fid);
      x.save(); roundRect(x, ix, iy, CW, CH, 8); x.clip();
      if (im) {
        const s = Math.max(CW / im.width, CH / im.height), dw = im.width * s, dh = im.height * s;
        x.drawImage(im, ix + (CW - dw) / 2, iy + (CH - dh) / 2, dw, dh);
      } else {   // name tile
        x.fillStyle = "#0a0d38"; x.fillRect(ix, iy, CW, CH);
        x.fillStyle = "rgba(255,212,71,.5)"; x.font = "40px sans-serif"; x.textAlign = "center"; x.fillText("★", ix + CW / 2, iy + 70); x.textAlign = "left";
        x.fillStyle = "#f1f3ff"; x.font = `700 15px ${FONT}`; wrapText(x, c.jp, ix + 10, iy + 110, CW - 20, 20, 4);
        x.fillStyle = "#ffd447"; x.font = `500 12px ${MONO}`; x.fillText(c.k, ix + 10, iy + CH - 12);
      }
      x.restore();
      roundRect(x, ix, iy, CW, CH, 8); x.strokeStyle = "rgba(255,212,71,.85)"; x.lineWidth = 2; x.stroke();
      x.fillStyle = "#ffd447"; x.font = `700 28px ${MONO}`; x.fillText(`x ${e.n}`, ix + CW + 10, iy + CH / 2 + 10);
    });
  });
  x.textAlign = "right"; x.fillStyle = "rgba(170,178,230,.8)"; x.font = `500 14px ${FONT}`;
  x.fillText("Aquarian Age Thailand Fan-site", W - PAD, H - 16); x.textAlign = "left";
  return { canvas, missing };
}

function bindModalEvents() {
  $("btnExport").addEventListener("click", openExport);
  $("btnImport").addEventListener("click", openImport);
  $("btnHelp").addEventListener("click", openHelp);
  $("scrim").addEventListener("click", () => (document.body.classList.contains("sheetover") && !$("sheet").hidden ? closeSheet() : closeAll()));
  $("mclose").addEventListener("click", closeAll);
}
