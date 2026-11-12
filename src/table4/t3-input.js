/* ==========================================================================
   v4 game table · input (requirements_v4 Revise#008 / #037 / #038)

   Left click = declare / choose / un-pick (a menu when there is more than one legal action);
   right click or long press = card details (with the by-hand tools: move a card / a character).
   Every action is an intent sent through TB.send — the engine refuses anything illegal with the reason.
   ========================================================================== */
(function () {
  "use strict";
  const TB = window.TB, ui = TB.ui, esc = TB.esc, db = TB.db;
  const me = () => TB.viewSeat();
  const S = () => ui.log.state;
  const keyToRef = TB.keyToRef = k => { const [a, b] = k.split(":"); return a === "ch" ? { ch: b } : a === "seat" ? { seat: +b } : a === "card" ? { card: b } : a === "item" ? { item: b } : { field: true }; };
  const send = it => TB.send(Object.assign({ seat: me() }, it));
  const rerender = () => TB.render();

  /* ---------- menus ---------- */
  function openMenu(ev, title, items) {
    if (!items.length) return false;
    const x = Math.min(ev.clientX, innerWidth - 260), y = Math.min(ev.clientY, innerHeight - 40 - items.length * 34);
    ui.menu = { x, y: Math.max(8, y), title, items };
    rerender();
    return true;
  }
  /** Menu colours (Pack, Revise#186): Effect pastel yellow · Attack pastel red · Guard (Defense) pastel blue · Card details pastel green */
  const MENU_CLS = { effect: "mi-eff", attack: "mi-atk", guard: "mi-grd", join: "mi-grd" };
  /** Legal intents → menu items; X / Boost variants are listed one per value. */
  function itemsFor(cands) {
    return cands.map(c => ({ label: TB.intentLabel(c), cls: MENU_CLS[c.kind] || "", run: () => send(c) }));
  }

  /* ---------- clicks ---------- */
  function clickCard(ev, id) {
    const R = TB.ctx(), s = S(), c = s.cards[id];
    // a choice pop-up option
    const dopt = ev.target.closest("[data-dopt]");
    if (dopt) { toggleDecision(JSON.parse(dopt.dataset.dopt)); return; }
    // a pending power card (Charge Phase): take it back (Revise#091)
    if (c && c.place.role === "power" && (s.pendingPower || []).some(x => x.card === id) && R.charge.on) { send({ t: "unCharge", seat: s.chars[c.place.ch].owner, card: id }); return; }
    // a choice on the board (power cards above Mental): toggle the power card
    if (R.fieldDec && R.fieldDec.options.includes(id)) { toggleDecision(id); return; }
    // paying: toggle a power card (on the field or in the pay pop-up)
    if (R.pay.has(id) && ui.sel && ui.sel.kind === "pay") {
      const p = ui.sel.picked, i = p.indexOf(id);
      if (i >= 0) p.splice(i, 1); else if (s.draft.cost == null || p.length < s.draft.cost) p.push(id);
      if (ui.opts.payOnPick && s.draft.cost != null && s.draft.cost > 0 && p.length === s.draft.cost) { send({ t: "pay", cards: p.slice() }); return; }   // Player option: pay when selected = cost
      rerender(); return;
    }
    if (R.tgt.has("card:" + id)) { pickTarget("card:" + id); return; }
    // a card of a character → the character
    const ch = AA4.charOfCard(s, id);
    if (ch && c.place.role !== "power") { clickChar(ev, ch.id); return; }
    // hand
    if (c && c.place.z === "hand" && c.owner === me()) {
      // Charge Phase: the card goes into the Charge window (click again = take it back)
      if (R.charge.on) {
        const q = ui.charge.q, k = q.findIndex(x => x.card === id);
        if (k >= 0) q.splice(k, 1); else if (R.charge.targets.length) q.push({ s: "h", card: id }); else TB.toast("No character can take a power card now");
        rerender(); return;
      }
      const cands = (R.byCard.get(id) || []).filter(x => x.t !== "charge");
      const items = itemsFor(cands);
      if (items.length === 1 && !(cands[0] && cands[0].x != null)) { items[0].run(); return; }
      items.push({ label: "Card details", cls: "mi-det", run: () => showDetails(id) });
      if (items.length === 1) { showDetails(id); return; }
      openMenu(ev, TB.nameOf(id), items);
      return;
    }
    showDetails(id);
  }
  function clickChar(ev, chId) {
    const R = TB.ctx(), s = S();
    // Charge Phase: the next card of the Charge window goes onto this character
    if (R.charge.on && R.charge.q.length && R.chg.has(chId)) {
      const next = ui.charge.q[0];
      const ok = send(next.s === "h" ? { t: "charge", ch: chId, card: next.card } : { t: "charge", ch: chId, fromDeck: true });
      if (ok) { ui.charge.q.shift(); rerender(); }
      return;
    }
    if (ui.sel && ui.sel.kind === "atkChar") {   // "Targeting attack" (Pack, Revise#428): the character clicked is the target
      const list = (R.byCh.get(ui.sel.ch) || []).filter(c => c.t === "declare" && c.kind === "attack" && c.target && c.target.ch === chId);
      if (!list.length) { TB.toast("Click a character in blue — or Cancel"); return; }
      ui.sel = null;
      if (list.length === 1) { send(list[0]); return; }
      openMenu(ev, "Targeting attack → " + TB.nameOf(AA4.topOf(s.chars[chId])), itemsFor(list));   // Boost variants
      return;
    }
    if (ui.sel && ui.sel.kind === "bhPlace") {   // By hand "Move to: …": the character clicked is the place
      if (R.tgt.has("ch:" + chId)) { const sel = ui.sel; ui.sel = null; send({ t: "move", card: sel.card, to: { z: "char", ch: chId, role: sel.role } }); rerender(); }
      else TB.toast("Click a character in blue — or Cancel");
      return;
    }
    if (R.tgt.has("ch:" + chId)) { pickTarget("ch:" + chId); return; }
    const cands = R.byCh.get(chId) || [];
    // attacks on characters are one menu line, "Targeting attack": the target is then clicked on the field (Pack, Revise#428)
    const isTA = c => c.t === "declare" && c.kind === "attack" && c.target && c.target.ch != null, nTA = cands.filter(isTA).length;
    const items = itemsFor(cands.filter(c => !isTA(c)));
    if (nTA) { const at = items.reduce((n, it, i) => (it.cls === "mi-atk" ? i + 1 : n), 0);
      items.splice(at, 0, { label: "Targeting attack — choose a character on the field", cls: "mi-atk", run: () => { ui.sel = { kind: "atkChar", ch: chId }; TB.toast("Click the character to attack (in blue)"); rerender(); } }); }
    // guard step: a single legal guard goes at once
    if (cands.length === 1 && cands[0].kind === "guard") { items[0].run(); return; }
    const top = AA4.topOf(s.chars[chId]);
    if (!items.length) { showDetails(top, chId); return; }
    items.push({ label: "Card details", cls: "mi-det", run: () => showDetails(top, chId) });
    openMenu(ev, TB.nameOf(top), items);
  }
  function pickTarget(k) {
    const s = S(), R = TB.ctx();
    if (ui.sel && ui.sel.kind === "trig") { send({ t: "trigger", trigger: ui.sel.id, run: true, targets: [keyToRef(k)] }); return; }
    if (R && R.tgtDec && R.tgtDec.map.has(k)) { send({ t: "choose", seat: R.tgtDec.seat, decision: R.tgtDec.id, pick: [R.tgtDec.map.get(k)] }); return; }   // a new target, clicked on the field (Revise#162)
    const d = s.draft;
    if (!d || d.step !== "target") return;
    const n = AA4.draftCount(d);
    if (n === 1 && !d.spec.upTo) { send({ t: "target", targets: [keyToRef(k)] }); return; }
    const p = ui.sel.picked, i = p.indexOf(k);
    if (i >= 0) p.splice(i, 1); else if (p.length < n) p.push(k);
    if (d.spec.kind === "multi" && p.length === n) { send({ t: "target", targets: p.map(keyToRef) }); return; }
    void R; rerender();
  }
  function toggleDecision(o) {
    const d = S().decisions.find(x => TB.mySeats().includes(x.seat));
    if (!d) return;
    if (!ui.dpick || ui.dpick.id !== d.id) ui.dpick = { id: d.id, list: [] };
    const L = ui.dpick.list, k = L.findIndex(x => JSON.stringify(x) === JSON.stringify(o));
    if (k >= 0) L.splice(k, 1); else { if (d.max === 1) L.length = 0; if (L.length < d.max) L.push(o); }
    rerender();
  }

  /* ---------- details / piles ---------- */
  function showDetails(id, chId) { ui.modal = { kind: "card", id, ch: chId || null }; ui.menu = null; rerender(); }
  /** By hand: where a card of yours can be moved, grouped (Revise#083 / #114). */
  function moveGroups(s, id) {
    const out = [], dests = AA4.moveDestinations(s, db, me(), id).map((to, i) => ({ to, v: "m" + i, l: destLabel(s, to) }));
    const cat = to => (to.z === "char" ? "Onto a character" : ["active", "front", "back"].includes(to.z) ? "As a new character" : ["hand", "deck"].includes(to.z) ? "Hand / Deck" : "Piles and areas");
    // onto a character (Pack): one entry per kind — then click the character on the field
    const onto = ["stack", "perm", "power"].filter(role => dests.some(x => x.to.z === "char" && x.to.role === role))
      .map(role => ({ v: "place:" + role, l: { stack: "Move to: Break (on a character — click it)", perm: "Move to: Permanent (on a character — click it)", power: "Move to: Power card (on a character — click it)" }[role] }));
    for (const g of ["Hand / Deck", "Piles and areas", "Onto a character", "As a new character"]) { const list = g === "Onto a character" ? onto : dests.filter(x => cat(x.to) === g); if (list.length) out.push([g, list]); }
    return out;
  }
  TB.cardDetailsHTML = m => {
    const s = S(), R = TB.ctx(), c = R.V.cards[m.id];
    if (m.pile) return pileHTML(m);
    const inf = c && c.key ? db.card(c.key) : null;
    if (!inf) {   // a face-down card (a power card from the deck …): its owner can still move it by hand (Pack, Revise#114)
      const g = c && c.owner === me() ? moveGroups(s, m.id) : [];
      const bh = g.length ? `<div class="byhand"><div class="rl">By hand</div><div class="bhrow"><select id="bhSel"><option value="">Choose an action…</option>${g.map(([n, list]) => `<optgroup label="${esc(n)}">${list.map(x => `<option value="${x.v}"${m.form === x.v ? " selected" : ""}>${esc(x.l)}</option>`).join("")}</optgroup>`).join("")}</select><button class="btn sm pri" data-act="bhDo">Do it</button></div>${m.form ? byHandForm(m.form, m) : ""}</div>` : "";
      return `<div class="modal"><div class="mh">A hidden card</div><div class="muted">Face down${c && c.place.role === "power" ? " (a power card)" : ""}.</div>${bh}<div class="mf"><button class="btn" data-act="close">Close</button></div></div>`;
    }
    const chId = m.ch || (AA4.charOfCard(s, m.id) || {}).id;
    const st = chId ? AA4.charStats(s, db, chId) : null;
    const p = inf.printed || {};
    const skills = Object.entries(st ? st.skills : inf.skills || {}).map(([k, v]) => (AA4.SKILLS[k] ? AA4.SKILLS[k].en : k) + (typeof v === "number" ? " " + v : v && v.label ? ` (${v.label})` : v && v.factions ? ` ${[].concat(v.factions, v.icons || []).join("/")}` : "")).join(" · ");
    const status = { auto: "automatic", partial: "partly by hand", manual: "by hand" }[inf.status] || inf.status;
    const mine = c.owner === me();
    // By hand (Revise#083): one drop-down list, the actions grouped by category
    const groups = [];
    if (mine && chId) {
      groups.push(["The character", AA4.charDestinations(s, db, me(), chId).map((to, i) => ({ v: "c" + i, l: "Move to the " + { active: "Active Area", front: "Control Area (Front)", back: "Control Area (Back)" }[to.area] }))]);
      groups.push(["Skills and status", [{ v: "f:skillP", l: "Add a skill (stays)…" }, { v: "f:skillT", l: "Add a skill for this turn…" }, { v: "f:stat", l: "Mental / Attack / Defense ±…" }]]);
      const pw = s.chars[chId].power.length, deck = s.players[me()].zones.deck.length;
      groups.push(["Power cards", [{ v: "f:chg", l: `Charge from your deck (face down) — choose how many…${deck ? "" : " (deck empty)"}` }].concat(pw ? [["discard", "Discard Pile"], ["damage", "Damage Pile"], ["deck", "the top of the deck"], ["hand", "the hand"]].map(([z, l]) => ({ v: "f:pw:" + z, l: `Power cards → ${l} — choose them…` })) : [])]);   // Pack (Revise#116)
      groups.push(["Damage", [{ v: "f:dmg", l: "Deal damage X / (X) to it…" }]]);
    }
    if (mine) groups.push(...moveGroups(s, m.id));
    const byHand = groups.length ? `<div class="byhand"><div class="rl">By hand</div><div class="bhrow"><select id="bhSel"><option value="">Choose an action…</option>${groups.map(([g, list]) => `<optgroup label="${esc(g)}">${list.map(x => `<option value="${x.v}"${m.form === x.v ? " selected" : ""}>${esc(x.l)}</option>`).join("")}</optgroup>`).join("")}</select><button class="btn sm pri" data-act="bhDo">Do it</button></div>${m.form ? byHandForm(m.form, m) : ""}</div>` : "";
    const partTxt = x => x.key === "skill" ? `${x.op === "remove" ? "loses" : "gains"} ${skTxt(x.n, x.v)}` : x.key === "atm" || x.mental ? `Mental Attack (${x.n > 0 ? "+" : ""}${x.n})` : `${{ se: "Mental", at: "Attack", de: "Defense", attackCost: "Attack cost", guardCost: "Guard cost", effectCost: "Effect cost", permLimit: "Permanent limit" }[x.key] || x.key} ${x.n > 0 ? "+" : ""}${x.n}`;
    const pg = [];   // one row per source (Pack, Revise#206): "“Persephone”: gains Breakthrough, Mental +1, Attack +1, Defense +1"
    for (const x of (st && st.parts) || []) { const l = x.label || ""; let g = pg.find(y => y.l === l); if (!g) pg.push(g = { l, t: [] }); g.t.push(partTxt(x)); }
    const parts = pg.length ? `<div class="parts">${pg.map(g => `<div class="prow">${g.l ? `<b>${esc(g.l)}</b>: ` : ""}${esc(g.t.join(", "))}</div>`).join("")}</div>` : "";
    // the card structure of the character, bottom to top; its power cards and permanents — each one can be opened
    const chx = chId ? s.chars[chId] : null;
    const strip = (ids, label, tag) => ids.length ? `<div class="cstr"><div class="rl">${label}</div><div class="opts">${ids.map((x, i) => { const vc = R.V.cards[x], vi = vc && vc.key ? db.card(vc.key) : null; return `<button class="cs${x === m.id ? " on" : ""}" data-act="showc" data-id="${x}">${TB.thumb(x, "csi")}<span class="csl">${esc(tag(i))}</span><span class="csn">${esc(vi ? TB.EN(vi) : "face down")}</span></button>`; }).join("")}</div></div>` : "";
    const stack = chx ? strip(chx.stack, `Structure (bottom → top, ${chx.stack.length})`, i => (i ? `Break #${i}` : "Character") + (i === chx.stack.length - 1 ? " · top" : ""))
      + strip(chx.power, `Power cards (${chx.power.length})`, i => `${i + 1}`) + strip(chx.perm, "Permanents", () => "Permanent") : "";
    // the current state in four highlighted boxes (Pack): Status · Skill · Effect · Ability
    const cur = currentBoxes(s, inf, m.id, chId, st, skills, parts);
    return `<div class="modal card-details"><div class="mh">${esc(TB.EN(inf))} <span class="muted">${esc(inf.en ? inf.jp : "")}</span></div><div class="cd">
      <img src="${TB.img(inf.fid, 400)}" onerror="this.src='${TB.img2(inf.fid, 400)}'" alt="">
      <div><div>${esc(inf.type)} · ${esc(inf.faction || "")} · ${esc(c.key)}</div>
      <div class="muted">Printed: Factor ${esc(p.fa || "–")} · Cost ${esc(p.co || "–")} · Mental ${esc(p.se || "–")} · Attack ${esc(p.at || "–")} · Defense ${esc(p.de || "–")}</div>
      ${cur}${stack}
      ${inf.textEn ? `<pre class="txt en">${esc(inf.textEn)}</pre>` : ""}<pre class="txt jp">${esc(inf.text || "")}</pre>
      <div class="muted rulesrow">Rules: ${esc(status)} <span class="impl ${inf.status === "auto" ? "yes" : "no"}">${inf.status === "auto" ? "Implemented" : "Not implemented"}</span></div></div></div>
      ${byHand}
      <div class="mf">${m.back ? `<button class="btn" data-act="backPile">◂ Back to the pile</button>` : ""}<button class="btn" data-act="close">Close</button></div>${window.AAReport ? AAReport.buttonHTML(`data-act="report" data-id="${esc(m.id)}"`) : ""}</div>`;
  };
  /** Card details: the current Status, Skills, Effects and Abilities, each in its own highlighted box. */
  const SIGNED = new Set(["charge", "draw", "permanent", "capacity", "handLimit"]);   // Pack (Revise#235): "Permanent +1", "Charge -1", "Charge +5"
  const skTxt = TB.skTxt = (id, v) => `${((AA4.SKILLS || {})[id] || {}).en || id}${typeof v === "number" ? " " + (SIGNED.has(id) ? (v >= 0 ? "+" : "-") + (Math.abs(v) >= 99 ? "∞" : Math.abs(v)) : Math.abs(v) >= 99 ? "∞" : v) : ""}`;   // 99 = ∞ (Revise#278)
  function currentBoxes(s, inf, cardId, chId, st, skillsTxt, parts) {
    // English line of the card text for a Japanese line (same line number in the printed text), shown above it (Pack)
    const norm = t => String(t || "").replace(/[\s。]/g, "").replace(/[-ー−]/g, "ー");
    const jpL = String(inf.text || "").split("\n"), enL = String(inf.textEn || "").split("\n");
    const en = t => { const n = norm(t); const i = jpL.findIndex(l => norm(l) && (norm(l) === n || norm(l).includes(n) || n.includes(norm(l)))); return (i >= 0 && enL.length === jpL.length ? enL[i] : "") || AA4.enText(inf, t); };
    // English only, the Japanese line as its tooltip; Japanese only when the card has no English line for it (Pack, Revise#161)
    const two = (t, gained) => { let e = en(t); if (gained && e) { const q = /[“"]((?:\d+|X)\s*:[^”"]+)[”"]/.exec(e); e = q ? q[1] : e; } return e ? `<div class="len" title="${esc(t)}">${esc(e)}</div>` : `<div class="ljp">${esc(t)}</div>`; };
    const box = (cls, title, body) => (body ? `<div class="curb ${cls}"><div class="curh">${title}</div>${body}</div>` : "");
    const out = [];
    if (st) {   // Status: now vs printed (green = higher, red = lower)
      const b = st.base || {}, v = (k, n, lbl) => { const was = b[k] == null ? null : +b[k], d = n != null && was != null ? n - was : 0; return `<span class="cv${d > 0 ? " up" : d < 0 ? " down" : ""}"><small>${lbl}</small><b>${n == null ? "–" : k === "at" ? AA4.atkText(st) : n}</b>${d ? `<i>${d > 0 ? "+" : ""}${d}</i>` : ""}</span>`; };
      const ch = s.chars[chId];
      // Pack (Revise#224): a table — the printed row, one row per card that changes it (±X in each column, the skills it gives), then Now; the older text is in the “?”
      const rows = [];
      for (const x of st.parts || []) {
        const l = x.label || "(unknown)"; let r = rows.find(y => y.l === l); if (!r) rows.push(r = { l, se: 0, at: 0, atm: 0, de: 0, sk: [], skv: {}, card: null }); if (!r.card && x.card) r.card = x.card;
        if (x.key === "skill") { if (x.op !== "remove") { if (typeof x.v === "number" && x.n in r.skv) { r.skv[x.n] += x.v; continue; } r.skv[x.n] = typeof x.v === "number" ? x.v : null; r.sk.push(x.n); } continue; }   // the same skill twice from one source adds up: "Permanent +2"
        if (x.key === "atm" || (x.key === "at" && x.mental)) r.atm += +x.n || 0;
        else if (["se", "at", "de"].includes(x.key) && typeof x.n === "number") r[x.key] += x.n;
      }
      const sg = n => (n > 0 ? "+" + n : n < 0 ? "−" + -n : "");
      const cell = (n, cls) => `<td class="${cls || ""}${n > 0 ? " up" : n < 0 ? " down" : ""}">${sg(n)}</td>`;
      const shown = rows.filter(r => r.se || r.at || r.atm || r.de || r.sk.length);
      // Pack (Revise#237): the card that made the change, as its picture (two rows high); click it for its details
      const srcCell = r => r.card && S().cards[r.card] && S().cards[r.card].key ? `<button type="button" class="cs sttcs" data-act="showc" data-id="${esc(r.card)}" title="${esc(r.l)} — click for its details" aria-label="${esc(r.l)} — details">${TB.thumb(r.card, "csi")}</button>` : esc(r.l);   // the source card at the size of Structure / Power cards (Pack, Revise#244)
      const tbl = `<table class="stt"><thead><tr><th>Source</th><th>Mental</th><th>Attack</th><th>Defense</th><th>Power</th><th>Skill</th></tr></thead><tbody>`
        + `<tr class="base"><td>Printed</td><td>${b.se == null ? "–" : b.se}</td><td>${b.at == null ? "–" : st.atMental ? "(" + b.at + ")" : b.at}</td><td>${b.de == null ? "–" : b.de}</td><td></td><td></td></tr>`
        + shown.map(r => `<tr><td class="stsrc">${srcCell(r)}</td>${cell(r.se)}<td class="${r.at + r.atm > 0 ? "up" : r.at + r.atm < 0 ? "down" : ""}">${[sg(r.at), r.atm ? "(" + sg(r.atm) + ")" : ""].filter(Boolean).join(" ")}</td>${cell(r.de)}<td></td><td class="sk">${esc(r.sk.map(id => skTxt(id, r.skv[id])).join(", "))}</td></tr>`).join("")
        + `<tr class="tot"><td>Now</td><td>${st.se == null ? "–" : st.se}</td><td>${AA4.atkText(st)}</td><td>${st.de == null ? "–" : st.de}</td><td>${ch.power.length}${st.se != null ? "/" + st.se : ""}</td><td></td></tr></tbody></table>`;
      const older = `<div class="cvs">${v("se", st.se, "Mental")}${v("at", st.at, "Attack")}${v("de", st.de, "Defense")}<span class="cv"><small>Power</small><b>${ch.power.length}${st.se != null ? "/" + st.se : ""}</b></span></div>
        <div class="cmeta">Attack cost ${st.attackCost} · Guard cost ${st.guardCost}${st.effectCost ? ` · Effect cost +${st.effectCost}` : ""} · ${st.controlled ? "Controlled" : st.active ? "Active Character" : "in a faction party"}${st.broken ? " · broken" : ""}${st.noAttack ? " · can't attack" : ""}${st.noGuard ? " · can't guard" : ""}</div>${parts}`;
      out.push(`<div class="curb cur-status"><div class="curh hqh">Status now${TB.helpQ(older, "the status details")}</div>${tbl}</div>`);
    }
    // Skills: now (printed ones that were removed are struck through; gained ones are marked)
    const printed = (inf.skills) || {}, now = st ? st.skills : printed;
    const nm = (k, v) => typeof v === "number" ? skTxt(k, v) : (AA4.SKILLS[k] ? AA4.SKILLS[k].en : k) + (v && v.factions ? " " + [].concat(v.factions, v.icons || []).join("/") : "");
    const chips = Object.entries(now).flatMap(([k, v]) => Array.from({ length: TB.skillTimes(st, printed, k, v) }, (_, i) => `<span class="chip${printed[k] == null || i > 0 ? " gain" : ""}" title="${esc(AA4.SKILLS[k] ? AA4.SKILLS[k].jp : k)}">${esc(nm(k, v))}${printed[k] == null || i > 0 ? " <i>gained</i>" : ""}</span>`))   // a skill given more than once shows more than once (Pack, Revise#207)
      .concat(Object.keys(printed).filter(k => st && now[k] == null).map(k => `<span class="chip off" title="removed / negated">${esc(nm(k, printed[k]))}</span>`));
    out.push(box("cur-skill", st && st.negated.skills ? "Skills — negated" : "Skills", chips.join("") || ""));
    void skillsTxt;
    // Effects: the lines this card can use now (own + gained), negated ones struck
    const efs = chId && s.chars[chId] && (AA4.topOf(s.chars[chId]) === cardId || s.chars[chId].perm.includes(cardId)) ? AA4.effectsOf(s, db, chId, cardId) : inf.effects || [];
    const auto = { auto: "auto", partial: "partly by hand", manual: "by hand" };
    out.push(box("cur-effect", st && st.negated.effects ? "Effects — negated" : "Effects", efs.map(e => `<div class="cline${e.negated || (st && st.negated.effects) ? " off" : ""}"><span class="tag">${e.gained ? "gained" : "cost " + e.cost}</span><small class="${e.status}">${auto[e.status] || ""}</small>${two(e.text, e.gained)}</div>`).join("")));
    // X (Pack, Revise#198): "X = N" and "Count from …" for every X the card uses
    { const ow = s.cards[cardId] ? s.cards[cardId].owner : me(), xs = AA4.xEntries(s, db, inf, { ch: chId || null, seat: ow, card: cardId });
      if (xs.length) {
        const jpL = String(inf.text || "").split("\n").filter(l => /Xは/.test(l)), rule = [...new Set(jpL.map(l => { const t = (l.match(/Xは[^。]*。?/) || [l])[0]; return AA4.enText(inf, l) ? (AA4.enText(inf, l).match(/X is[^.]*\.?/) || [AA4.enText(inf, l)])[0] : t; }))];
        out.push(box("cur-x", "X", (rule.length ? `<div class="xrule">${rule.map(r => `<div>${esc(r)}</div>`).join("")}</div>` : "") + xs.map(x => `<div class="xrow"><span class="tag">${esc(x.label)}</span> <b class="xn">X = ${x.paid ? "the cost you pay" : x.n == null ? "decided when it is used (by its target or what happens)" : x.n}</b>`
          + (x.from ? `<div class="xfrom"><small>Count from${x.from.length ? "" : ": nothing yet"}</small>${x.from.length ? `<ul>${x.from.map(f => `<li>${esc(f)}</li>`).join("")}${x.more ? `<li class="muted">… ${x.more} more</li>` : ""}</ul>` : ""}</div>` : "") + `</div>`).join("")));
      } }
    // Abilities: always-on (is its condition met now?), triggered, keep-on-field
    const abl = (inf.abilities || []).map(a => {
      const on = a.kind === "always" ? (!a.cond || (chId && AA4.checkCond(s, db, a.cond, { seat: s.cards[cardId].owner, ch: chId, card: cardId }))) : null;
      const kind = a.kind === "always" ? (a.zone === "damage" ? "in the Damage Pile" : "always") : a.kind === "trigger" ? "when …" : a.kind === "replace" ? "keep" : a.kind;
      return { t: a.text || "", kind, on };
    }).filter((x, i, arr) => arr.findIndex(y => y.t === x.t) === i);
    out.push(box("cur-ability", "Abilities", abl.map(x => `<div class="cline${x.on === false ? " off" : ""}"><span class="tag">${esc(x.kind)}${x.on === false ? " · not now" : x.on ? " · on" : ""}</span>${two(x.t)}</div>`).join("") + (inf.manualText || []).map(t => `<div class="cline"><span class="tag hand">✋ by hand</span>${two(t)}</div>`).join("")));
    return out.join("");
  }
  /** The small forms of the By hand tools (Pack, Revise#089). */
  function byHandForm(f, m) {
    const s = S(), chId = m && (m.ch || (AA4.charOfCard(s, m.id) || {}).id), ch = chId && s.chars[chId];
    if (f === "f:chg" && ch) {   // Charge from the deck: 1 … Mental cards at once (Pack, Revise#116)
      const mental = Math.max(1, AA4.charStats(s, db, chId).se || 1), deck = s.players[me()].zones.deck.length, max = Math.max(1, Math.min(mental, deck));
      return `<div class="bhform"><label>How many power cards from the top of your deck (1 – ${max}) <input id="bhChg" type="number" value="1" min="1" max="${max}"></label><button class="btn sm pri" data-act="bhApply"${deck ? "" : " disabled"}>Charge</button></div>`;
    }
    if (f.startsWith("f:pw:") && ch) {   // power cards → somewhere: choose them in a box, then move them all at once (Pack, Revise#116)
      const pick = m.pwPick || (m.pwPick = []), to = { discard: "the Discard Pile", damage: "the Damage Pile", deck: "the top of the deck", hand: "the hand" }[f.slice(5)];
      const cards = ch.power.map(id => `<button class="cs${pick.includes(id) ? " on" : ""}" data-act="bhPwPick" data-id="${id}">${TB.thumb(id, "csi")}<span class="csn">${pick.includes(id) ? "✓ chosen" : ""}</span></button>`).join("");
      return `<div class="bhform bhpick"><div class="muted">Click the power cards to move to ${esc(to)} (${pick.length} chosen)</div><div class="opts">${cards}</div>
        <div class="bhrow"><button class="btn sm" data-act="bhPwAll">${pick.length === ch.power.length ? "Clear" : "Choose all"}</button><button class="btn sm pri" data-act="bhApply"${pick.length ? "" : " disabled"}>Move ${pick.length} → ${esc(to)}</button></div></div>`;
    }
    const until = (def) => `<label>For <select id="bhUntil">${[["turn", "this turn"], ["main", "this Main Phase"], ["battle", "this battle"], ["removed", "until removed (stays)"]].map(([v, l]) => `<option value="${v}"${v === def ? " selected" : ""}>${l}</option>`).join("")}</select></label>`;
    if (f === "f:skillP" || f === "f:skillT") {
      const list = Object.entries(AA4.SKILLS).filter(([, v]) => !v.todo).sort((x, y) => x[1].en.localeCompare(y[1].en));
      return `<div class="bhform"><label>Skill <select id="bhSkill">${list.map(([k, v]) => `<option value="${k}">${esc(v.en)} · ${esc(v.jp)}</option>`).join("")}</select></label><label>X (for Charge X, Bind X …) <input id="bhX" type="number" value="1" min="-9" max="9"></label>
        <input type="hidden" id="bhUntil" value="${f === "f:skillP" ? "removed" : "turn"}"><button class="btn sm pri" data-act="bhApply">Add the skill ${f === "f:skillP" ? "(stays until removed)" : "for this turn"}</button></div>`;
    }
    if (f === "f:stat") return `<div class="bhform"><label>Mental ± <input id="bhSe" type="number" value="0"></label><label>Attack ± <small>(normal or (mental) — whichever it has)</small> <input id="bhAt" type="number" value="0"></label><label>Defense ± <input id="bhDe" type="number" value="0"></label>${until("turn")}<button class="btn sm pri" data-act="bhApply">Apply ±</button></div>`;
    if (f === "f:dmg") return `<div class="bhform"><label>Damage X <input id="bhN" type="number" value="1" min="0"></label><label>Mental damage (X) <input id="bhM" type="number" value="0" min="0"></label><button class="btn sm pri" data-act="bhApply">Deal the damage</button></div>`;
    return "";
  }
  function destLabel(s, to) {
    if (to.z === "char") return `${{ stack: "Break onto", power: "Power card on", perm: "Permanent on" }[to.role]} ${TB.nameOf(AA4.topOf(s.chars[to.ch]))}`;
    return { deck: to.pos === "bottom" ? "Deck (bottom)" : "Deck (top)", hand: "Hand", discard: "Discard Pile", damage: "Damage Pile", removed: "Remove from the game", special: "Special Area", active: "New character: Active Area", front: "New character: Control Front", back: "New character: Control Back" }[to.z] || to.z;
  }
  /** A card in a pile that can be declared now (Pack report A3-07 1173: "このカードがあなたのダメージ置き場にある場合、…使用宣言可能", Revise#325). */
  const usable = (R, id) => (R.byCard.get(id) || []).some(x => x.t === "declare");
  function pileHTML(m) {
    const R = TB.ctx(), p = R.V.players[m.seat], list = p.zones[m.pile].slice().reverse();
    const mine = m.seat === me();
    const play = R.S.stage === "play";
    const tools = mine && m.pile === "deck" ? `<div class="byhand"><div class="rl">By hand</div><div class="bhrow"><button class="btn sm" data-act="shuffle">Shuffle</button><button class="btn sm" data-act="drawHand">Draw 1</button>${play && !m.deckPick ? `<button class="btn sm" data-act="deckPick" title="Look through your deck (written in the log) and move cards to your hand, Damage Pile or Discard Pile">Pick card from deck…</button>` : ""}`
      + (play ? `<button class="btn sm" data-act="dmgN" title="Normal damage: the top card of your deck → Active Area if it is a Character, otherwise the Damage Pile">+1 Normal damage</button><button class="btn sm" data-act="dmgS" title="Special damage: the top card of your deck → Damage Pile, even a Character card (no damage check)">+1 Special damage</button>` : "") + `</div>`
      + (play ? `<div class="bhrow"><label>Take damage X <input id="pdN" type="number" value="1" min="0" style="width:56px"></label><label>(X) <input id="pdM" type="number" value="0" min="0" style="width:56px"></label><button class="btn sm pri" data-act="dmgX">Take X(X)</button></div>` : "") + `</div>` : "";
    const deckIds = mine && m.pile === "deck" && m.deckPick ? R.S.players[m.seat].zones.deck.slice().reverse() : null;   // top first (Revise#155): the real cards, numbered 1 … from the top
    const pickBox = deckIds ? `<div class="muted">Your deck, top → bottom (1 = the top card). Click cards to choose them, then move them.</div><div class="opts cards dpick">${deckIds.map((id, i) => `<button class="cs dpc${m.deckPick.includes(id) ? " on" : ""}" data-act="dpCard" data-id="${id}"><span class="dpn">${i + 1}</span>${TB.faceKey(R.S.cards[id].key, "opt")}</button>`).join("") || `<span class="muted">Empty</span>`}</div>`
      + `<div class="bhrow dpto"><span class="muted">${m.deckPick.length} chosen →</span><button class="btn sm pri" data-act="dpTo" data-z="hand">To hand</button><button class="btn sm" data-act="dpTo" data-z="damage">To Damage Pile</button><button class="btn sm" data-act="dpTo" data-z="discard">To Discard Pile</button></div>` : "";
    const hand = m.pile === "hand", seen = hand ? list.filter(id => R.V.cards[id] && R.V.cards[id].key) : [];
    const cards = hand ? (seen.length ? `<div class="muted">${seen.length === list.length ? "Every card of this hand is open to you" : `${seen.length} of ${list.length} cards are open to you`} · click a card for its details</div><div class="opts cards">${seen.map(id => `<button class="cs" data-act="showc" data-id="${id}" data-back="hand">${TB.face(id, "opt")}</button>`).join("")}</div>${list.length > seen.length ? `<div class="muted">${list.length - seen.length} hidden</div>` : ""}` : `<div class="muted">${list.length} cards (hidden) — you see this hand only while a card shows it (e.g. “…手札全てをプレイヤー全てに見せてプレイする”)</div>`)
      : deckIds ? pickBox : m.pile === "deck" ? `<div class="muted">${list.length} cards (hidden)</div>` : `<div class="muted">Newest first · click a card for its details${mine && list.some(id => usable(R, id)) ? " · ⚡ = you can use it from here now" : ""}</div><div class="opts cards">${list.map(id => usable(R, id) && mine ? `<button class="cs pileuse" data-act="pileUse" data-id="${id}" title="Use this card from the ${m.pile === "damage" ? "Damage" : "Discard"} Pile">${TB.face(id, "opt")}<span class="pu">⚡ Use</span></button>` : `<button class="cs" data-act="showc" data-id="${id}" data-back="${m.pile}">${TB.face(id, "opt")}</button>`).join("") || `<span class="muted">Empty</span>`}</div>`;
    return `<div class="modal"><div class="mh">${esc(p.name)} · ${esc({ deck: "Deck", damage: "Damage Pile", discard: "Discard Pile", removed: "Removed from the game", hand: "Hand" }[m.pile])} (${list.length})</div>${cards}<div class="mf">${tools}<button class="btn" data-act="close">Close</button></div></div>`;
  }

  /* ---------- field effects by hand / colours ---------- */
  const FIELD_KINDS = [["at", "Attack ±", "char"], ["de", "Defense ±", "char"], ["se", "Mental ±", "char"], ["attackCost", "Attack cost ±", "char"], ["guardCost", "Guard cost ±", "char"],
    ["handLimit", "Hand limit ±", "player"], ["draw", "Draw ±", "player"], ["ban:attack", "Ban attacks", "player"], ["ban:set", "Ban Set declarations", "player"], ["ban:effect", "Ban effects", "player"],
    ["permDest:hand", "Permanents that must go → hand", "player"], ["permDest:deckTop", "Permanents that must go → deck top", "player"], ["permDest:deckBottom", "Permanents that must go → deck bottom", "player"],
    ["permDest:damage", "Permanents that must go → Damage Pile", "player"], ["permDest:char", "Permanents that must go → onto another character", "player"]];
  TB.fieldFormHTML = () => `<div class="modal"><div class="mh">Add a field effect by hand</div><form class="ff" data-act="fieldForm">
    <label>Effect <select id="fKind">${FIELD_KINDS.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></label>
    <label>Value <input id="fVal" type="number" value="1" step="1"></label>
    <label>Applies to <select id="fTo"><option value="you">You / your characters</option><option value="opp">Opponents / their characters</option><option value="all">Everyone / all characters</option></select></label>
    <label>Until <select id="fUntil"><option value="turn">end of turn</option><option value="main">end of main phase</option><option value="battle">end of battle</option><option value="removed">removed by hand</option></select></label>
    <label>Label <input id="fLabel" maxlength="60" placeholder="e.g. 「Card name」"></label>
    <div class="mf"><button class="btn pri">Add</button><button class="btn" type="button" data-act="close">Cancel</button></div></form></div>`;
  function submitField() {
    const kind = TB.$("fKind").value, val = parseInt(TB.$("fVal").value, 10) || 0, to = TB.$("fTo").value, until = TB.$("fUntil").value;
    const def = FIELD_KINDS.find(x => x[0] === kind), label = TB.$("fLabel").value.trim() || def[1] + (kind.startsWith("ban") || kind.startsWith("permDest") ? "" : ` ${val > 0 ? "+" : ""}${val}`);
    let mod;
    if (def[2] === "char") mod = { key: kind, value: val, to: { all: to === "all" ? {} : { owner: to } } };
    else if (kind.startsWith("ban:")) mod = { key: "ban", value: { decl: kind.slice(4) } };
    else if (kind.startsWith("permDest:")) mod = { key: "permDest", op: "dest", value: { to: kind.slice(9) } };   // Q#35: instead of the Discard Pile
    else mod = { key: kind, value: val };
    if (def[2] === "player") mod.to = to === "you" ? { seat: me() } : to === "opp" ? { players: "opponents" } : { players: "all" };
    Object.assign(mod, { until, label });
    if (send({ t: "field", mod })) ui.modal = null;
  }
  TB.colorFormHTML = m => {
    const k = ui.room + ":" + m.seat, cur = (ui.colors.seats || {})[k] || (m.seat === me() ? ui.colors.me : ui.colors.opp);
    return `<div class="modal"><div class="mh">Field colour · ${esc(S().players[m.seat].name)}</div>
      <label>Colour <input type="color" id="cPick" value="${esc(cur)}"></label>
      <div class="opts">${["#9cc8ff", "#ff9fae", "#a8e6b8", "#ffe08a", "#d4b8ff", "#ffc49b"].map(c => `<button class="sw" style="background:${c}" data-act="cSw" data-c="${c}"></button>`).join("")}</div>
      <div class="muted">Saved on this device only. Defaults: you pastel blue, opponents pastel red.</div>
      <div class="mf"><button class="btn pri" data-act="cSave" data-seat="${m.seat}">Save</button><button class="btn" data-act="cReset" data-seat="${m.seat}">Default</button><button class="btn" data-act="close">Cancel</button></div></div>`;
  };
  const saveColors = () => TB.store.set("aa4-colors", ui.colors);

  /* ---------- buttons ---------- */
  const ACT = {
    avatar: el => { TB.store.set("aa4-avatar", el.dataset.v); rerender(); },   // Player image (Pack, Revise#214)
    campaignStart: () => TB.campaignStart && TB.campaignStart(lobbyOpts("solo2")),   // Campaign Mode (Revise#379)
    solo1: () => TB.start(lobbyOpts("solo1")), solo2: () => TB.start(lobbyOpts("solo2")), soloBot: () => TB.start(Object.assign(lobbyOpts("solo2"), { bot: true, name2: "Bot" })), botsWatch: () => TB.start(Object.assign(lobbyOpts("solo2"), { bots: true, name: "Bot 1", name2: "Bot 2" })),   // Revise#311
    botPause: () => { TB.ui.botPaused = !TB.ui.botPaused; TB.render(); }, botSpeed: el => { TB.ui.botSpeed = +el.dataset.speed || 1; TB.render(); },   // Revise#308 resume: () => TB.resumeSolo(),
    create: () => TB.start(lobbyOpts("online")), createTest: () => TB.start(Object.assign(lobbyOpts("online"), { test: true })),
    joinCode: () => TB.join(TB.$("lCode").value, lobbyOpts("join")),
    invite: () => {   // inside the main site (8. Game Table): a link to that tab; on its own: table.html#CODE
      let url;
      try { url = window.parent !== window ? window.parent.location.href.split("#")[0] + "#table/" + ui.room : location.href.split("#")[0] + "#" + ui.room; } catch (e) { url = location.href.split("#")[0] + "#" + ui.room; }
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => TB.toast("Invite link copied"), () => TB.toast(url));
    },
    leave: () => TB.leave(), startNow: () => TB.send({ t: "start" }),
    keep: () => send({ t: "keep" }), mulligan: () => send({ t: "mulligan" }), autoMulligan: () => send({ t: "autoMulligan" }),
    srcCard: b => { if (b.dataset.card) showDetails(b.dataset.card); },   // Revise#237
    mfold: b => { ui.mFold = ui.mFold || {}; ui.mFold[b.dataset.k] = !ui.mFold[b.dataset.k]; TB.render(); },   // Revise#236
    autoMsgOk: () => { const S = TB.ui.log.state, me = TB.mySeats()[0], m = S.players[me] && S.players[me].autoMsg; if (m) TB.ui.autoMsgSeen = TB.ui.room + ":" + me + ":" + m.n; TB.render(); },
    next: () => send({ t: "next" }), pass: () => send({ t: "pass" }), noGuard: () => send({ t: "noGuard" }),
    cancel: () => send({ t: "cancel" }), unsel: () => { ui.sel = null; rerender(); },
    payAuto: () => {   // Pack: Auto pick pays at once
      const d = S().draft, cards = d.payFrom.flatMap(ch => S().chars[ch].power.slice().reverse()).slice(0, d.cost == null ? 1 + (d.extra || 0) : d.cost);
      send({ t: "pay", cards });
    },
    gameMenu: () => { ui.gameOpen = !ui.gameOpen; ui.optsOpen = false; if (ui.gameOpen) ui.drAnim = Date.now(); rerender(); },   // Game options side bar (Revise#190)
    globalUndo: () => send({ t: "rules", key: "globalUndo", on: !S().rules.globalUndo }),
    optsMenu: () => { ui.optsOpen = !ui.optsOpen; ui.gameOpen = false; if (ui.optsOpen) ui.drAnim = Date.now(); ui.holdOpen = false; rerender(); },   // the right side bar (Revise#178)
    optsTab: el => { ui.optsTab = el.dataset.tab === "options" ? "options" : "play"; rerender(); },
    optPayOnPick: () => setOpt("payOnPick", !ui.opts.payOnPick),
    payZ: el => { ui.payZ = el.dataset.z; TB.store.set("aa4-payz", ui.payZ); rerender(); },   // cost window card size (Revise#208)
    stuckSec: el => setOpt("stuckSec", +el.dataset.v),   // Game Status after 30 / 60 / 120 / 180 s (Revise#206)
    optPickMax: () => setOpt("pickMax", !ui.opts.pickMax),
    optExceed: () => setOpt("exceedDraw", !ui.opts.exceedDraw),
    cwCharge: () => { const m = ui.modal; ui.modal = null; for (let i = 0; i < m.n; i++) ui.charge.q.push({ s: "d" }); rerender(); },
    cwStop: () => { ui.modal = null; setOpt("exceedDraw", true); TB.toast("Stopped — “Charge exceeds Draw” is now ON"); },
    autoSkip: () => send({ t: "rules", key: "autoSkip", on: !S().rules.autoSkip }),
    outlawDiscard: () => send({ t: "rules", key: "outlawDiscard", on: !S().rules.outlawDiscard }),   // Revise#155
    outlawFool: () => send({ t: "rules", key: "outlawFool", on: !S().rules.outlawFool }),   // Q#66 (Revise#165)
    optAutoAbility: () => setOpt("autoAbility", !ui.opts.autoAbility),   // Q#64 (Revise#165)
    outlawPower: () => send({ t: "rules", key: "outlawPower", on: !S().rules.outlawPower }),
    powerFlipDown: () => send({ t: "rules", key: "powerFlipDown", on: !S().rules.powerFlipDown }),
    deckPick: () => { if (send({ t: "deckLook" })) { ui.modal = Object.assign({}, ui.modal, { deckPick: [] }); rerender(); } },
    dpCard: el => { const m = ui.modal, p = m.deckPick || (m.deckPick = []), i = p.indexOf(el.dataset.id); if (i >= 0) p.splice(i, 1); else p.push(el.dataset.id); rerender(); },
    dpTo: el => { const m = ui.modal, z = el.dataset.z, ids = (m.deckPick || []).slice(); if (!ids.length) { TB.toast("Choose cards from the deck first"); return; } for (const id of ids) send({ t: "move", card: id, to: { z } }); m.deckPick = []; rerender(); },
    autoPay: () => send({ t: "rules", key: "autoPay", on: !S().rules.autoPay }),
    cwClear: () => { if (ui.charge) ui.charge.q = []; rerender(); },
    pileUse: el => {   // Revise#325: use a card from the Damage / Discard Pile, like a hand card
      const R = TB.ctx(), id = el.dataset.id, cands = (R.byCard.get(id) || []).filter(x => x.t === "declare"), r = el.getBoundingClientRect();
      ui.modal = null;
      const items = itemsFor(cands); items.push({ label: "Card details", cls: "mi-det", run: () => showDetails(id) });
      if (!openMenu({ clientX: r.left + r.width / 2, clientY: r.top + 20 }, TB.nameOf(id), items)) rerender();
    },
    handSort: () => {   // Revise#336
      const s = S(), ids = s.players[me()].zones.hand.slice(), order = TB.handSorted(s, ids);
      if (order.every((id, k) => id === ids[k])) { TB.toast("The hand is already sorted"); return; }
      send({ t: "sortHand", order });
    },
    showc: el => { const m = ui.modal || {}; ui.modal = { kind: "card", id: el.dataset.id, ch: (AA4.charOfCard(S(), el.dataset.id) || {}).id || null, back: el.dataset.back ? { pile: el.dataset.back, seat: m.seat } : m.back || null }; rerender(); },
    bhPwPick: el => { const m = ui.modal, p = m.pwPick || (m.pwPick = []), i = p.indexOf(el.dataset.id); if (i >= 0) p.splice(i, 1); else p.push(el.dataset.id); rerender(); },
    bhPwAll: () => { const m = ui.modal, s = S(), chId = m.ch || (AA4.charOfCard(s, m.id) || {}).id, all = s.chars[chId].power; m.pwPick = (m.pwPick || []).length === all.length ? [] : all.slice(); rerender(); },
    bhApply: () => {
      const m = ui.modal, chId = m.ch || (AA4.charOfCard(S(), m.id) || {}).id, num = id => parseInt((TB.$(id) || {}).value, 10) || 0;
      const nm = TB.nameOf(AA4.topOf(S().chars[chId])), until = TB.$("bhUntil") ? TB.$("bhUntil").value : "turn";
      if (m.form === "f:skillP" || m.form === "f:skillT") {
        const id = TB.$("bhSkill").value, sk = AA4.SKILLS[id], x = sk && sk.value === "number" ? num("bhX") : true;
        if (send({ t: "field", mod: { to: { ch: chId }, key: "skill", op: "grant", value: { id, x }, until, label: `${sk.en}${x === true ? "" : " " + x} → ${nm} (by hand)` } })) { m.form = null; rerender(); }
        return;
      }
      if (m.form === "f:stat") {
        const parts = [["se", num("bhSe")], ["at", num("bhAt")], ["de", num("bhDe")]].filter(([, n]) => n);
        if (!parts.length) { TB.toast("Type a number other than 0"); return; }
        for (const [key, value] of parts) send({ t: "field", mod: { to: { ch: chId }, key, value, until, label: `${{ se: "Mental", at: "Attack", de: "Defense" }[key]} ${value > 0 ? "+" : ""}${value} → ${nm} (by hand)` } });
        m.form = null; rerender(); return;
      }
      if (m.form === "f:dmg") { if (send({ t: "selfDamage", ch: chId, normal: num("bhN"), mental: num("bhM") })) { ui.modal = null; } rerender(); }
      if (m.form === "f:chg") {   // the top N cards of the deck, each as a power card (face down)
        const deck = S().players[me()].zones.deck, n = Math.max(1, Math.min(num("bhChg") || 1, deck.length));
        for (let i = 0; i < n; i++) send({ t: "move", card: deck[deck.length - 1 - i], to: { z: "char", ch: chId, role: "power" } });
        m.form = null; rerender(); return;
      }
      if (m.form && m.form.startsWith("f:pw:")) {
        const z = m.form.slice(5), ids = (m.pwPick || []).filter(id => S().chars[chId] && S().chars[chId].power.includes(id));
        for (const id of ids) send({ t: "move", card: id, to: z === "deck" ? { z: "deck", pos: "top" } : { z } });
        m.form = null; m.pwPick = []; rerender(); return;
      }
    },
    dmgX: () => { const n = parseInt((TB.$("pdN") || {}).value, 10) || 0, mm = parseInt((TB.$("pdM") || {}).value, 10) || 0; send({ t: "selfDamage", normal: n, mental: mm }); rerender(); },
    backPile: () => { ui.modal = Object.assign({ kind: "card" }, ui.modal.back); rerender(); },
    bhDo: () => {
      const v = TB.$("bhSel") && TB.$("bhSel").value, m = ui.modal;
      if (!v) { TB.toast("Choose an action from the list"); return; }
      const chId = m.ch || (AA4.charOfCard(S(), m.id) || {}).id;
      if (v.startsWith("f:")) { m.form = v; m.pwPick = []; rerender(); return; }   // a small form first
      if (v.startsWith("place:")) { ui.sel = { kind: "bhPlace", card: m.id, role: v.slice(6) }; ui.modal = null; TB.toast("Click a character in blue"); rerender(); return; }
      if (v === "chg") { const deck = S().players[me()].zones.deck; if (!deck.length) { TB.toast("Your deck is empty"); return; } send({ t: "move", card: deck[deck.length - 1], to: { z: "char", ch: chId, role: "power" } }); rerender(); return; }
      if (v.startsWith("pw:")) { const c = S().chars[chId], id = c.power[c.power.length - 1], z = v.slice(3); send({ t: "move", card: id, to: z === "deck" ? { z: "deck", pos: "top" } : { z } }); rerender(); return; }
      const i = +v.slice(1);
      if (v[0] === "c") { const chId = m.ch || AA4.charOfCard(S(), m.id).id, to = AA4.charDestinations(S(), db, me(), chId)[i]; if (send({ t: "moveChar", ch: chId, to })) ui.modal = null; }
      else { const to = AA4.moveDestinations(S(), db, me(), m.id)[i]; if (send({ t: "move", card: m.id, to })) ui.modal = null; }
      rerender();
    },
    pay: () => send(Object.assign({ t: "pay", cards: ui.sel.picked.slice() }, (ui.sel.sac || []).length ? { sac: ui.sel.sac.slice() } : {}, (ui.sel.hb || []).length ? { hand: ui.sel.hb.slice() } : {})),
    paySac: el => { if (!ui.sel) return; const l = ui.sel.sac = ui.sel.sac || [], i = l.indexOf(el.dataset.id); if (i >= 0) l.splice(i, 1); else l.push(el.dataset.id); rerender(); },   // Revise#137
    payHand: el => { if (!ui.sel) return; const l = ui.sel.hb = ui.sel.hb || [], i = l.indexOf(el.dataset.id); if (i >= 0) l.splice(i, 1); else l.push(el.dataset.id); rerender(); },
    target: () => send({ t: "target", targets: ui.sel.picked.map(keyToRef) }),
    tfield: () => send({ t: "target", targets: [{ field: true }] }),
    trun: el => {
      const tr = S().triggers.find(x => x.id === el.dataset.id), ab = db.card(S().cards[tr.card].key).abilities[tr.ability];
      if (ab.effect && ab.effect.target && ab.effect.target.count !== "all") { ui.sel = { kind: "trig", id: tr.id, picked: [] }; rerender(); }
      else send({ t: "trigger", trigger: tr.id, run: true, seat: tr.seat });
    },
    tskip: el => { const tr = S().triggers.find(x => x.id === el.dataset.id); send({ t: "trigger", trigger: tr.id, run: false, seat: tr.seat }); },
    choose: el => { const d = S().decisions.find(x => TB.mySeats().includes(x.seat)); TB.send({ t: "choose", decision: d.id, seat: d.seat, pick: JSON.parse(el.dataset.pick) }); },
    dconfirm: () => { const d = S().decisions.find(x => TB.mySeats().includes(x.seat)); TB.send({ t: "choose", decision: d.id, seat: d.seat, pick: (ui.dpick && ui.dpick.id === d.id ? ui.dpick.list : []).slice() }); ui.dpick = null; },
    takeControl: el => { const S0 = S(); if (el.disabled || ui.tookAt === S0.lastTs) return; el.disabled = true; ui.tookAt = S0.lastTs; TB.send({ t: "takeControl", seat: +el.dataset.seat }); rerender(); },   // once only: disabled at once, no double click (Revise#117 / #128)
    handDock: () => { ui.handDock = !ui.handDock; TB.store.set("aa4-handdock", ui.handDock); rerender(); },   // fixed hand position: at the bottom of the field (Pack, Revise#371)
    handBig: () => { ui.handBig = !ui.handBig; TB.store.set("aa4-handbig", ui.handBig); rerender(); },   // expand the hand: every card at once (Revise#121)
    undo: () => TB.undo(), redo: () => TB.redo(), undoYes: () => TB.undoAnswer(true), undoNo: () => TB.undoAnswer(false),
    hold: () => send({ t: "hold", type: "all", on: !S().players[me()].hold }),
    situation: el => send({ t: "situation", value: el.dataset.v }),   // Game Situation (Revise#169)
    sitHold: el => send({ t: "sitHold", type: el.dataset.type, on: el.dataset.on === "1" }),   // Skip → Current (Pack, Revise#225)
    holdUndo: () => send({ t: "hold", type: "undo", on: !AA4.holdOn(S(), me(), "undo") }),
    holdMenu: () => { ui.holdOpen = !ui.holdOpen; ui.optsOpen = false; rerender(); },   // Hold types (Pack, Revise#168)
    holdSet: el => send({ t: "hold", type: el.dataset.type, on: el.dataset.on === "1" }),
    holdAll: el => send({ t: "hold", type: "every", on: el.dataset.on === "1" }),   // Undo too (Pack, Revise#205)
    holdDefault: () => send({ t: "hold", type: "default" }),
    size: el => { ui.size = TB.sizeLv({ S: 1, M: 4, L: 6 }[el.dataset.z] || el.dataset.z); TB.store.set("aa4-size3", ui.size); rerender(); },
    phoneFit: () => { ui.opts.phoneFit = ui.opts.phoneFit === false; try { TB.store && TB.store.set("aa4-opts", ui.opts); } catch (e) {} rerender(); },   // Revise#280
    view: () => { const mine = TB.mySeats(), v = me(); ui.view = mine[(mine.indexOf(v) + 1) % mine.length]; ui.viewLock = true; rerender(); },
    payAlt: el => { const d = S().draft; if (d) TB.send({ t: "pay", seat: d.seat, alt: el.dataset.alt, cards: el.dataset.alt === "deck2" || el.dataset.alt === "discTop" ? [] : [el.dataset.id] }); ui.sel = null; },   // Revise#129
    stuck: () => { ui.modal = { kind: "stuck" }; ui.menu = null; rerender(); },
    stuckRefresh: () => { ui.modal = { kind: "stuck" }; rerender(); },
    gsHide: () => { ui.gsHideAt = ui.lastActAt; rerender(); },
    rpStartLive: () => TB.replayStart(TB.ui.entries.slice()),
    rpSave: () => TB.replayFile(),
    rpMore: () => { TB.ui.rpMore = !TB.ui.rpMore; TB.render(); }, rpMin: () => { TB.ui.rpMin = !TB.ui.rpMin; TB.render(); },   // Revise#312: the replay bar on phones
    rpPlay: () => TB.replay.play(), rpPause: () => TB.replay.pause(),
    rpStep: el => TB.replay.step(+el.dataset.d), rpSeek: el => TB.replay.seek(+el.dataset.i),
    rpSpeed: el => TB.replay.speed(+el.dataset.v), rpView: el => TB.replay.view(el.dataset.v),
    rpLog: () => TB.replay.log(), rpClose: () => TB.replay.close(),
    logExport: () => {
      const t = TB.logText(), d = new Date(), pad = n => String(n).padStart(2, "0");
      const name = `aa-log-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.txt`;
      try { const url = URL.createObjectURL(new Blob([t], { type: "text/plain;charset=utf-8" })), a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); TB.toast("Log exported — " + name); }
      catch (e) { ui.modal = { kind: "stuck", text: t }; rerender(); }
    },
    gsCopy: () => { const t = TB.fullLog(); try { navigator.clipboard.writeText(t).then(() => TB.toast("Game log copied — paste it into your message to us"), () => { ui.modal = { kind: "stuck", text: t }; rerender(); }); } catch (e) { ui.modal = { kind: "stuck", text: t }; rerender(); } },
    gsSkip: () => { if (TB.send({ t: "unstick", seat: TB.mySeats()[0] })) ui.gsHideAt = null; },
    passAll: () => { ui.passAll = S().stack.map(it => it.id); rerender(); },
    passAllOff: () => { ui.passAll = null; rerender(); },
    stuckCopy: () => { const t = TB.fullLog(); try { navigator.clipboard.writeText(t).then(() => TB.toast("Stuck log copied"), () => TB.toast("Copy failed — select the text")); } catch (e) { TB.toast("Copy failed — select the text"); } },
    fold: () => { ui.handFold = !ui.handFold; TB.store.set("aa4-handfold", ui.handFold); rerender(); },
    chargeFold: () => { ui.chargeFold = ui.chargeFold === false; TB.store.set("aa4-chargefold", ui.chargeFold); rerender(); },
    payFold: () => { ui.payFold = !ui.payFold; TB.store.set("aa4-payfold", ui.payFold); rerender(); },
    close: () => { ui.modal = null; rerender(); },
    scrimClose: () => { ui.modal = null; rerender(); },
    report: el => {   // Revise#295: the card and the game situation go with the report
      const s = S(), id = el && el.dataset ? el.dataset.id : null, c = id && s.cards[id], inf = c && db.card(c.key); if (!inf || !window.AAReport) return;
      const ch = AA4.charOfCard(s, id), st = ch ? AA4.charStats(s, db, ch.id) : null, pl = c.place || {};
      const game = { mode: ui.replay ? "replay" : ui.kind || "", turn: s.turn ? s.turn.number : null, phase: s.turn ? s.turn.phase : "", viewer: (s.players[me()] || {}).name || "",
        place: [pl.z, pl.role, c.owner != null && s.players[c.owner] ? "owner " + s.players[c.owner].name : ""].filter(Boolean).join(" "),
        stats: st ? `${st.se}/${AA4.atkText ? AA4.atkText(st) : st.at}/${st.de} power ${ch.power.length}${ch.perm.length ? " perm " + ch.perm.length : ""}` : "" };
      AAReport.open({ page: "table", card: { key: c.key, jp: inf.jp || "", en: inf.en || "", type: inf.type || "", status: inf.status || "" }, game });
    },   // a tap outside a pop-up (Revise#290)
    fieldAdd: () => { ui.modal = { kind: "field" }; rerender(); },
    fieldEnd: el => { const ids = String(el.dataset.ids || el.dataset.id || "").split(",").filter(Boolean); send(ids.length > 1 ? { t: "fieldEnd", mods: ids } : { t: "fieldEnd", mod: ids[0] }); },   // one row = every modifier of that effect (Revise#182)
    color: el => { ui.modal = { kind: "color", seat: +el.dataset.seat }; rerender(); },
    cSw: el => { TB.$("cPick").value = el.dataset.c; },
    cSave: el => { ui.colors.seats = ui.colors.seats || {}; ui.colors.seats[ui.room + ":" + el.dataset.seat] = TB.$("cPick").value; saveColors(); ui.modal = null; rerender(); },
    cReset: el => { if (ui.colors.seats) delete ui.colors.seats[ui.room + ":" + el.dataset.seat]; saveColors(); ui.modal = null; rerender(); },
    mv: el => { const m = ui.modal, to = AA4.moveDestinations(S(), db, me(), m.id)[+el.dataset.i]; if (send({ t: "move", card: m.id, to })) ui.modal = null; rerender(); },
    mvc: el => { const m = ui.modal, chId = m.ch || AA4.charOfCard(S(), m.id).id, to = AA4.charDestinations(S(), db, me(), chId)[+el.dataset.i]; if (send({ t: "moveChar", ch: chId, to })) ui.modal = null; rerender(); },
    shuffle: () => { send({ t: "shuffle" }); ui.modal = null; },
    dmgN: () => { send({ t: "selfDamage", kind: "normal" }); rerender(); }, dmgS: () => { send({ t: "selfDamage", kind: "special" }); rerender(); }, drawHand: () => { send({ t: "draw", n: 1 }); ui.modal = null; },
  };
  function setOpt(k, v) { ui.opts[k] = v; TB.store.set("aa4-opts", ui.opts); rerender(); }
  /** Charge from the Deck (Revise#099): one card, or as many as allowed with "Pick Max Charge"; with "Charge exceeds Draw" OFF
      the Deck may not go below Draw without a warning ("Deck <= Draw. Will you continue to charge?"). */
  function chargeFromDeck(R, seat) {
    const s = S(), deckNow = s.players[seat].zones.deck.length - ui.charge.q.filter(x => x.s === "d").length, draw = AA4.playerStats(s, db, seat).draw;
    const want = ui.opts.pickMax ? R.charge.deckLeft : 1;
    const safe = ui.opts.exceedDraw ? want : Math.max(0, Math.min(want, deckNow - draw));
    for (let i = 0; i < safe; i++) ui.charge.q.push({ s: "d" });
    if (safe < want && !(ui.opts.pickMax && safe > 0)) ui.modal = { kind: "chargeWarn", n: ui.opts.pickMax ? Math.min(want, deckNow) - safe : 1, deck: deckNow - safe, draw };   // would go below Draw: ask
  }
  function lobbyOpts(mode) {
    const v = id => (TB.$(id) ? TB.$(id).value : ""), solo = mode === "solo1" || mode === "solo2";
    const so = v("lSlotO"), paste = !solo && so === "paste";
    const slot = solo ? +v("lSlot1") || 0 : paste ? -1 : +so || 0;
    if (!paste) TB.store.set("aa4-slot", slot);
    if (paste) ui.pasteText = v("lPaste");
    // Solo: the names are fixed (Pack): Player 1 / Player 2
    return { mode, slot, pasted: paste ? TB.parseDeckList(v("lPaste")) : null, slot2: +v("lSlot2") || 0, name: solo ? "Player 1" : v("lName") || "Player", name2: "Player 2", seats: +v("lSeats") || 2,
      powerFaceUp: false, together: !!(TB.$("lTogether") && TB.$("lTogether").checked), goSecond: TB.$("lSecond") && TB.$("lSecond").checked,
      situation: !!(TB.$("lSituation") && TB.$("lSituation").checked), autoSkip: !TB.$("lSkip") || TB.$("lSkip").checked, autoPay: !TB.$("lPay") || TB.$("lPay").checked };
  }

  /* Game Situation: what each situation skips is now under its “?” (Pack, Revise#205) — no more 1 s hover */
  document.addEventListener("click", ev => {
    const t = ev.target;
    // Player options / Game options side bar: a click outside folds it, and does nothing else (Pack, Revise#204)
    if ((ui.optsOpen || ui.gameOpen) && t.isConnected && !t.closest(".drawer,.menu,.modal,[data-act=optsMenu],[data-act=gameMenu]")) { ui.optsOpen = false; ui.gameOpen = false; ev.preventDefault(); rerender(); return; }
    if (ui.menu && !t.closest(".menu")) { ui.menu = null; if (!t.closest("[data-card],[data-ch]")) { rerender(); return; } }
    const mi = t.closest("[data-mi]");
    if (mi) { const it = ui.menu.items[+mi.dataset.mi]; ui.menu = null; it.run(); rerender(); return; }
    const act = t.closest("[data-act]");
    if (act && act.tagName !== "FORM" && !act.disabled && ACT[act.dataset.act]) { ev.preventDefault(); ACT[act.dataset.act](act); return; }
    if (!ui.log || !ui.ready) return;
    const dopt = t.closest("[data-dopt]");
    if (dopt) { toggleDecision(JSON.parse(dopt.dataset.dopt)); return; }
    // Card details / a pile: a click outside closes it (Pack)
    if (ui.modal && ui.modal.kind === "card" && !t.closest(".modal")) { ui.modal = null; rerender(); return; }
    const pc = t.closest("[data-paycard]");
    if (pc) { clickCard(ev, pc.dataset.paycard); return; }
    const cq = t.closest("[data-cq]");
    if (cq) { if (ui.charge) ui.charge.q.splice(+cq.dataset.cq, 1); rerender(); return; }
    if (t.closest(".modal")) return;
    const R = TB.ctx();
    const seatEl = t.closest("[data-seat]");
    const pileEl = t.closest("[data-pile]");
    if (pileEl) {   // a pile: target (the player), Charge from the deck, or look at the pile
      const seat = +pileEl.dataset.seat, z = pileEl.dataset.pile;
      if (R && R.tgt.has("seat:" + seat) && z === "deck") { pickTarget("seat:" + seat); return; }
      if (z === "deck" && R && R.charge.on && seat === R.viewer) {
        if (!R.charge.deckLeft) TB.toast(R.charge.deckMax ? `Charge ${R.charge.deckMax}: no more power cards from the deck this turn` : "No Charge: power cards from the deck need Charge X on a Controlled Character");
        else if (!R.charge.targets.length) TB.toast("No character can take a power card now");
        else chargeFromDeck(R, seat);
        rerender(); return;
      }
      ui.modal = { kind: "card", pile: z, seat }; rerender(); return;
    }
    const ark = t.closest("[data-areakey]");   // an area chosen on the field (Pack, Revise#245)
    if (ark && R && R.tgt.has(ark.dataset.areakey)) { pickTarget(ark.dataset.areakey); return; }
    const ptile = t.closest("[data-player]");   // the Player (Pack, Revise#214): choose this player as a target, or see the effects on the player
    if (ptile) { const seat = +ptile.dataset.player; if (R && R.tgt.has("seat:" + seat)) { pickTarget("seat:" + seat); return; } ui.modal = { kind: "player", seat }; rerender(); return; }
    const card = t.closest("[data-card]"), ch = t.closest("[data-ch]");
    if (card && !(ch && (card.classList.contains("top") || card.closest(".struct") || card.classList.contains("puc")))) { clickCard(ev, card.dataset.card); return; }
    if (ch) { clickChar(ev, ch.dataset.ch); return; }
    if (seatEl && R && R.tgt.has("seat:" + seatEl.dataset.seat)) { pickTarget("seat:" + seatEl.dataset.seat); return; }
    const bh = t.closest(".bh");   // a player's field header: look at that player's hand any time (open cards only — e.g. A3-17 2325, Pack, Revise#162)
    if (bh && !t.closest("button") && !t.closest(".bhsize") && R && R.V.players[+bh.dataset.seat]) { ui.modal = { kind: "card", pile: "hand", seat: +bh.dataset.seat }; rerender(); return; }
    const item = t.closest("[data-item]");
    if (item && R && R.tgt.has("item:" + item.dataset.item)) { pickTarget("item:" + item.dataset.item); return; }
    const fx = t.closest("[data-src]");
    if (fx) { ui.src = fx.dataset.src && ui.src !== fx.dataset.src ? fx.dataset.src : null; rerender(); }
  });
  document.addEventListener("input", ev => {   // lobby: keep what was typed when the lobby is drawn again
    if (ev.target.id === "lName") ui.name = ev.target.value.slice(0, 20);
    if (ev.target.id === "lCode") (ui.lobby = ui.lobby || {}).code = ev.target.value;
    if (ev.target.id === "lPaste") ui.pasteText = ev.target.value;
    if (ev.target.id === "sizeBar" || ev.target.id === "sizeTop") { const lv = TB.sizeLv(ev.target.value); TB.applySize(lv); for (const k of ["sizeLv", "sizeTopLv"]) { const l = TB.$(k); if (l) l.textContent = "Lv " + lv; } }   // live while dragging (Revise#153)
  });
  document.addEventListener("change", ev => {   // Replay (Revise#160): the step slider / a replay file
    if (ev.target.id === "rpSeek") TB.replay.seek(+ev.target.value);
    if (ev.target.id === "rpFile" && ev.target.files && ev.target.files[0]) TB.replayOpenFile(ev.target.files[0]);
  });
  /** Player image upload (Pack, Revise#214): any image the device offers (PC file, iPhone / iPad photo library or camera, Android gallery);
      made small here (≤ 320 × 440, JPEG) so it can be saved on this device and shown to the other players. */
  TB.fileToAvatar = file => new Promise((res, rej) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      try {
        const k = Math.min(1, 320 / im.naturalWidth, 440 / im.naturalHeight), c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
        const g = c.getContext("2d"); g.fillStyle = "#10165e"; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
        let q = 0.85, d = c.toDataURL("image/jpeg", q);
        while (d.length > 150000 && q > 0.35) { q -= 0.1; d = c.toDataURL("image/jpeg", q); }
        URL.revokeObjectURL(url); res(d);
      } catch (e) { URL.revokeObjectURL(url); rej(e); }
    };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error("not an image")); };
    im.src = url;
  });
  document.addEventListener("change", ev => {
    if (ev.target.id !== "avFile" || !ev.target.files || !ev.target.files[0]) return;
    TB.fileToAvatar(ev.target.files[0]).then(d => {
      if (!AA4.avatarOk(d)) throw new Error("too big");
      TB.store.set("aa4-avatar-up", d); TB.store.set("aa4-avatar", "up"); TB.toast("Player image uploaded"); rerender();
    }).catch(() => TB.toast("This image can't be used — try a JPEG or PNG photo"));
  });
  document.addEventListener("change", ev => { if (ev.target.id !== "handZ") return; ui.handZ = ["S", "M", "L"][+ev.target.value] || "L"; TB.store.set("aa4-handz", ui.handZ); TB.render(); });   // hand card size, as Control · Back (Pack, Revise#373)
  document.addEventListener("change", ev => { if (ev.target.id !== "backZ") return; ui.backZ = ["S", "M", "L"][+ev.target.value] || "L"; TB.store.set("aa4-backz", ui.backZ); TB.render(); });   // Control · Back size (Revise#206)
  document.addEventListener("change", ev => { if (ev.target.id !== "sizeBar" && ev.target.id !== "sizeTop") return; ui.size = TB.sizeLv(ev.target.value); TB.store.set("aa4-size3", ui.size); TB.render(); });
  document.addEventListener("change", ev => {   // lobby: keep what was picked (the lobby used to reset the deck lists when it was drawn again)
    const k = ev.target.dataset && ev.target.dataset.lobby;
    if (!k) return;
    ui.lobby = ui.lobby || {};
    const was = ui.lobby[k];
    ui.lobby[k] = ev.target.value === "paste" ? "paste" : +ev.target.value;
    if (k === "so" && (was === "paste") !== (ui.lobby[k] === "paste")) { const keep = TB.$("lPaste") ? TB.$("lPaste").value : ui.pasteText; ui.pasteText = keep; rerender(); }
  });
  document.addEventListener("toggle", ev => {
    if (ev.target.matches && ev.target.matches("details.log")) { ui.logOpen = ev.target.open; TB.store.set("aa4-log", ui.logOpen); }
    if (ev.target.matches && ev.target.matches("details.fx")) ui.fxOpen = ev.target.open;
  }, true);
  document.addEventListener("submit", ev => {
    ev.preventDefault();
    const f = ev.target;
    if (f.dataset.act === "chat") { const v = TB.$("chatIn").value.trim(); if (v) TB.send({ t: "chat", text: v }); return; }
    if (f.dataset.act === "fieldForm") submitField();
  });
  // right click / long press: card details
  document.addEventListener("contextmenu", ev => {
    const el = ev.target.closest("[data-card],[data-ch]");
    if (!el || !ui.log) return;
    ev.preventDefault();
    const chEl = ev.target.closest("[data-ch]");
    if (el.dataset.card && !(chEl && el.closest(".struct"))) showDetails(el.dataset.card);
    else { const chId = (chEl || el).dataset.ch; showDetails(el.dataset.card || AA4.topOf(S().chars[chId]), chId); }
  });
  let lp = null;
  document.addEventListener("touchstart", ev => {
    const el = ev.target.closest("[data-card],[data-ch]");
    if (!el) return;
    lp = setTimeout(() => { lp = "fired"; if (el.dataset.card) showDetails(el.dataset.card); else showDetails(AA4.topOf(S().chars[el.dataset.ch]), el.dataset.ch); }, 550);
  }, { passive: true });
  document.addEventListener("touchend", ev => { if (lp === "fired") ev.preventDefault(); clearTimeout(lp); lp = null; });
  document.addEventListener("touchmove", () => { clearTimeout(lp); lp = null; }, { passive: true });
  document.addEventListener("keydown", ev => { if (ev.key === "Escape") { if ((ui.optsOpen || ui.gameOpen) && !ui.menu && !ui.modal) { ui.optsOpen = false; ui.gameOpen = false; } ui.menu = null; ui.modal = null; if (ui.sel && ui.sel.kind !== "pay" && ui.sel.kind !== "target") ui.sel = null; rerender(); } });
  /* ---------- Control Area Sort button (Pack, Revise#098) ---------- */
  const SORT_TIP = `<b>Sort this section</b><div>First by type, every faction together:</div><ol><li>Draw X characters (highest Draw first)</li><li>Characters with an effect whose cost returns to the hand</li><li>Other characters with Charge</li><li>Everything else</li><li>Break-cost return characters (last)</li></ol>Inside each type: by faction (E.G.O. → Arayashiki → WIZ-DOM → Darklore → Polestar Empire → Eraser → none), then Mental from highest to lowest.`;
  TB.sortBtnHTML = (seat, area, sec) => `<button type="button" class="sortbtn" data-sort-area="${area}"${sec ? ` data-sort-sec="${sec}"` : ""} data-seat="${seat}" aria-label="Sort: Draw → cost back to hand → Charge → others → Break-cost return, then faction, then Mental high → low"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 13V3M2.5 5.5 5 3l2.5 2.5M11 3v10M8.5 10.5 11 13l2.5-2.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
  /** Sort group (1 … 5) of a character, as Pack listed them; the first group that matches (1, 2, 3, 5), else 4. */
  TB.sortGroup = (s, chId) => {
    const st = AA4.charStats(s, db, chId), top = AA4.topOf(s.chars[chId]), inf = db.card(s.cards[top].key) || {};
    if (typeof st.skills.draw === "number" && st.skills.draw > 0) return 1;
    if (AA4.effectsOf(s, db, chId, top).some(e => e.costTo === "hand" && !e.negated)) return 2;   // "このエフェクトのコストを手札に戻す"
    if (typeof st.skills.charge === "number" && st.skills.charge > 0) return 3;
    if ((inf.abilities || []).some(a => a.kind === "always" && a.mod && a.mod.key === "dest" && a.mod.value && a.mod.value.onTarget === "self" && a.mod.value.type === "Break")) return 5;   // ▼ Break-cost return
    return 4;
  };
  /** Faction order of a character (Pack, Revise#127: the faction is sorted before the skills). */
  const facOrder = (s, chId) => { const inf = db.card(s.cards[AA4.topOf(s.chars[chId])].key) || {}, i = AA4.FACTIONS.findIndex(f => f.name === inf.faction); return i < 0 ? AA4.FACTIONS.length : i; };
  TB.sortedOrder = (s, ids) => ids.map((id, i) => ({ id, i, f: facOrder(s, id), g: TB.sortGroup(s, id), st: AA4.charStats(s, db, id) }))
    .sort((a, b) => a.g - b.g || (a.g === 1 ? (b.st.skills.draw || 0) - (a.st.skills.draw || 0) : 0) || a.f - b.f || (b.st.se || 0) - (a.st.se || 0) || a.i - b.i).map(x => x.id);   // the group before the faction: every Draw character leftmost (Pack, Revise#206)
  /* Sort hand (Pack, Revise#336): faction (the common order) → Mental low → high → cost low → high → required Factor low → high →
     card type Character · Break · Permanent · Fast · Project. A card without a Mental / cost / Factor counts as 0. */
  const HAND_TYPES = ["Character", "Break", "Permanent", "Fast", "Project"];
  TB.handSorted = (s, ids) => ids.map((id, i) => {
    const inf = db.card(s.cards[id].key) || {}, f = AA4.FACTIONS.findIndex(x => x.name === inf.faction), num = v => (typeof v === "number" ? v : +v || 0), t = HAND_TYPES.indexOf(inf.type);
    return { id, i, f: f < 0 ? AA4.FACTIONS.length : f, se: num(inf.se), cost: num(inf.cost), fac: Object.values(inf.factor || {}).reduce((a, b) => a + (+b || 0), 0), t: t < 0 ? HAND_TYPES.length : t };
  }).sort((a, b) => a.f - b.f || a.se - b.se || a.cost - b.cost || a.fac - b.fac || a.t - b.t || a.i - b.i).map(x => x.id);
  function doSort(btn) {
    const s = S(), seat = +btn.dataset.seat, area = btn.dataset.sortArea, sec = btn.dataset.sortSec || null;
    const ids = s.players[seat].areas[area].filter(id => s.chars[id] && (area !== "front" || !sec || AA4.secOf(s.chars[id]) === sec));   // Revise#403: no section = the whole Front
    const order = TB.sortedOrder(s, ids);
    if (order.every((id, k) => id === ids[k])) { TB.toast("Already sorted"); return; }
    send({ t: "sortChars", seat, area, sec: sec || undefined, order });
  }
  let tipTimer = null, tipShown = false, tipLong = false;
  const tipEl = () => { let t = document.getElementById("sortTip"); if (!t) { t = document.createElement("div"); t.id = "sortTip"; t.className = "sorttip"; t.hidden = true; t.innerHTML = SORT_TIP; document.body.appendChild(t); } return t; };
  const showTip = btn => { const t = tipEl(), b = btn.getBoundingClientRect(); t.hidden = false; const w = t.offsetWidth, h = t.offsetHeight;
    t.style.left = Math.max(8, Math.min(innerWidth - w - 8, b.left + b.width / 2 - w / 2)) + "px"; t.style.top = (b.top - h - 8 > 8 ? b.top - h - 8 : b.bottom + 8) + "px"; tipShown = true; };
  const hideTip = () => { clearTimeout(tipTimer); tipTimer = null; if (tipShown) { tipEl().hidden = true; tipShown = false; } };
  document.addEventListener("pointerover", ev => {   // a mouse resting on the button for 1 second shows the explanation
    const b = ev.target.closest && ev.target.closest(".sortbtn");
    if (!b || ev.pointerType === "touch" || tipTimer) return;
    tipTimer = setTimeout(() => showTip(b), 1000);
  });
  document.addEventListener("pointerout", ev => { const b = ev.target.closest && ev.target.closest(".sortbtn"); if (b && ev.pointerType !== "touch" && !b.contains(ev.relatedTarget)) hideTip(); });
  document.addEventListener("pointerdown", ev => {   // touch: hold 1 second to see the explanation (then it doesn't sort)
    const b = ev.target.closest(".sortbtn");
    if (!b) { if (tipShown) hideTip(); return; }
    if (ev.pointerType !== "touch") return;
    tipLong = false; clearTimeout(tipTimer);
    tipTimer = setTimeout(() => { tipLong = true; showTip(b); }, 1000);
  }, true);
  document.addEventListener("pointerup", ev => { if (ev.pointerType === "touch" && tipTimer && !tipShown) { clearTimeout(tipTimer); tipTimer = null; } }, true);
  document.addEventListener("click", ev => {
    const b = ev.target.closest(".sortbtn");
    if (!b) return;
    ev.stopImmediatePropagation(); ev.preventDefault();
    if (tipLong) { tipLong = false; return; }   // it was a long press: only the explanation
    hideTip(); doSort(b);
  }, true);
  document.addEventListener("contextmenu", ev => { if (ev.target.closest && ev.target.closest(".sortbtn")) ev.preventDefault(); }, true);

  // Control Area: drag a character to another place in Front / Back (as v3) — moveChar {area, index}
  let dragJustEnded = false;
  document.addEventListener("pointerdown", ev => {
    const chEl = ev.target.closest(".ch.draggable");
    if (!chEl || ev.button > 0 || ev.target.closest("button") || !ui.log) return;
    const chId = chEl.dataset.ch, x0 = ev.clientX, y0 = ev.clientY;
    if (ev.pointerType === "mouse") ev.preventDefault();   // no native image drag / text selection: it swallowed the release, so the card only dropped on the next click (Pack, Revise#118)
    let ghost = null;
    const move = e => {
      if (!ghost && Math.hypot(e.clientX - x0, e.clientY - y0) < 8) return;
      if (!ghost) {
        ghost = chEl.cloneNode(true); ghost.classList.add("dragghost"); document.body.appendChild(ghost); chEl.classList.add("dragging");
        clearTimeout(lp); lp = null;
      }
      ghost.style.left = e.clientX - 30 + "px"; ghost.style.top = e.clientY - 40 + "px";
      document.querySelectorAll(".droprow").forEach(r => r.classList.remove("droprow"));
      const row = rowAt(e); if (row) row.classList.add("droprow");
    };
    const rowAt = e => {   // the drop zone: one of the three Control Front sections, or Control Back
      const el = document.elementFromPoint(e.clientX, e.clientY), row = el && (el.closest(".chars[data-area]") || (el.closest(".row.back") && el.closest(".row.back").querySelector(".chars[data-area]"))), board = row && row.closest("[data-board]");
      return row && board && +board.dataset.board === S().chars[chId].owner ? row : null;
    };
    const up = e => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up);
      if (!ghost) return;
      ghost.remove(); chEl.classList.remove("dragging");
      document.querySelectorAll(".droprow").forEach(r => r.classList.remove("droprow"));
      dragJustEnded = true; setTimeout(() => (dragJustEnded = false), 50);
      const row = rowAt(e);
      if (!row) return;
      const area = row.dataset.area, sec = row.dataset.sec;
      const others = [...row.children].filter(x => x.classList.contains("ch") && x.dataset.ch !== chId);
      let index = others.findIndex(x => { const b = x.getBoundingClientRect(); return e.clientX < b.left + b.width / 2; });
      if (index < 0) index = others.length;
      send({ t: "moveChar", seat: S().chars[chId].owner, ch: chId, to: Object.assign({ area, index }, sec ? { sec } : {}) });
    };
    addEventListener("pointermove", move); addEventListener("pointerup", up); addEventListener("pointercancel", up);
  });
  document.addEventListener("dragstart", ev => { if (ev.target.closest && ev.target.closest(".game")) ev.preventDefault(); });   // cards are never dragged as images
  document.addEventListener("click", ev => { if (dragJustEnded) { ev.stopImmediatePropagation(); ev.preventDefault(); } }, true);
  // pay window: drag by its title (Pack)
  document.addEventListener("pointerdown", ev => {
    const h = ev.target.closest("#payHead");
    if (!h || ev.target.closest("button")) return;
    const box = h.parentElement.getBoundingClientRect(), dx = ev.clientX - box.left, dy = ev.clientY - box.top;
    ev.preventDefault();
    const move = e => { ui.payPos = { x: Math.max(0, Math.min(innerWidth - 120, e.clientX - dx)), y: Math.max(0, Math.min(innerHeight - 40, e.clientY - dy)) }; Object.assign(h.parentElement.style, { left: ui.payPos.x + "px", top: ui.payPos.y + "px", transform: "none" }); };
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  });
  // every event screen: drag by its title (Pack, Revise#236); the Pay window has its own handler above
  document.addEventListener("pointerdown", ev => {
    const h = ev.target.closest(".modal > .mh.mdrag");
    if (!h || h.id === "payHead" || ev.target.closest("button, a, input, select")) return;
    const m = h.parentElement, key = m.dataset.mkey || "dec", box = m.getBoundingClientRect(), dx = ev.clientX - box.left, dy = ev.clientY - box.top;
    ev.preventDefault();
    const move = e => { ui.mPos = ui.mPos || {}; ui.mPos[key] = { x: Math.max(0, Math.min(innerWidth - 80, e.clientX - dx)), y: Math.max(0, Math.min(innerHeight - 40, e.clientY - dy)) }; Object.assign(m.style, { left: ui.mPos[key].x + "px", top: ui.mPos[key].y + "px", bottom: "auto", right: "auto", transform: "none" }); };
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  });
  // hand panel: drag by its title on a computer
  document.addEventListener("pointerdown", ev => {
    const h = ev.target.closest("#handHead");
    if (!h || ev.target.closest("button") || innerWidth <= 900 || ui.handDock) return;
    const box = TB.$("hand").getBoundingClientRect(), dx = ev.clientX - box.left, dy = ev.clientY - box.top;
    const move = e => { ui.handPos = { x: Math.max(0, Math.min(innerWidth - 120, e.clientX - dx)), y: Math.max(0, Math.min(innerHeight - 40, e.clientY - dy)) }; Object.assign(TB.$("hand").style, { left: ui.handPos.x + "px", top: ui.handPos.y + "px", bottom: "auto", transform: "none" }); };
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  });
  /* Phone (Pack, Revise#300): pull a pop-up that has a Close down — from its title bar, or anywhere when it is scrolled to the top — to close it. */
  { let sw = null;
    document.addEventListener("touchstart", e => {
      const m = e.target.closest && e.target.closest(".modal:not(.dec):not(.automsg)");
      sw = null;
      if (!m || e.touches.length !== 1 || !m.querySelector('[data-act="close"]') || e.target.closest("input, select, textarea, .byhand")) return;
      if (!(e.target.closest(".mh") || m.scrollTop <= 0)) return;
      sw = { m, x: e.touches[0].clientX, y: e.touches[0].clientY, dy: 0 };
    }, { passive: true });
    document.addEventListener("touchmove", e => {
      if (!sw) return;
      const dx = e.touches[0].clientX - sw.x, dy = e.touches[0].clientY - sw.y;
      if (dy <= 0 || Math.abs(dx) > dy) { sw.dy = 0; sw.m.style.translate = ""; return; }
      if (sw.m.scrollTop > 0 && !e.target.closest(".mh")) { sw = null; return; }
      sw.dy = dy; sw.m.style.transition = "none"; sw.m.style.translate = `0 ${dy}px`; sw.m.style.opacity = String(Math.max(.4, 1 - dy / 400));
    }, { passive: true });
    const end = () => {
      if (!sw) return; const { m, dy } = sw; sw = null;
      m.style.transition = ""; m.style.translate = ""; m.style.opacity = "";
      if (dy > 90 && ACT.close) ACT.close();
    };
    document.addEventListener("touchend", end); document.addEventListener("touchcancel", end); }
})();
