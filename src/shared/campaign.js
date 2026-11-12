/* ==========================================================================
   Campaign Mode (Pack, Revise#379) — the list of bot decks by difficulty, proposals, and the admin's manager.

   Active decks  = window.AA_CAMPAIGN.decks (shared/campaign-data.js, built into the site): {id, name, difficulty,
                   winRate, deck: [card keys], playstyle}. The admin can move a deck to another difficulty; that is
                   saved in Firebase at campaign/moves/<id> and read by every player's lobby.
   Pending decks = proposals from "Campaign Design" on the Game Table: campaign/pending/<pushId> =
                   {name, at, ver, difficulty, deckName, deck: [keys], list: [{k, n, name, type}], playstyle}.
                   The admin reads them at #addoge → Campaign Bot Management, exports the ones he approves and
                   sends the file to Claude, who builds the deck and its bot into the site. Then he deletes them.
   Shared by the site (assets/app.js: the admin page) and the game table (assets/table.js: the lobby).
   ========================================================================== */
(() => {
  "use strict";
  if (window.AACampaign) return;
  const DIFFS = [["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"], ["hell", "Hell"]];
  const DIFF_IDS = DIFFS.map(d => d[0]);
  const STRATEGIES = [
    ["default", "Default (Use Common Bot)", "The common bot: it builds first, charges, and attacks when the attack is safe."],
    ["leader", "Supportive Leader", "Its Name-level Break cards support by their effects and abilities. It sets every Main Supporter first (with the Permanent card when “Wait for permanent?” is ticked) and makes no attack before that. Then it attacks once it has enough Charge and Draw (Charge more than 3, Draw more than 2). A Main Supporter itself attacks only when it is sure to survive. Below the Critical number it attacks without these conditions."],
    ["hero", "Hero Frontal Attack", "It sets its Main Attacker (and the Special Priority cards) first. It does not attack until a Main Attacker is set (with its Permanent card when “Wait for permanent?” is ticked) and charged. When its deck goes below the Critical number, it attacks without that condition."],
  ];
  const R = () => window.AAReport || {};
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const builtIn = () => ((window.AA_CAMPAIGN && window.AA_CAMPAIGN.decks) || []).map(d => Object.assign({}, d));
  const ready = () => !!(window.AA_FIREBASE && window.AA_FIREBASE.databaseURL && R()._db);
  let moves = null, movesP = null;
  /** The Active decks with the admin's moves applied (the moves known so far; load() fetches them). */
  const list = () => builtIn().map(d => (moves && DIFF_IDS.includes(moves[d.id]) ? Object.assign(d, { difficulty: moves[d.id], moved: true }) : d));
  /** Fetch the admin's moves once; cb() when they changed what list() returns. Without Firebase: the built-in list. */
  const load = cb => {
    if (!ready()) return Promise.resolve(list());
    movesP = movesP || R()._db().then(d => d.ref("campaign/moves").once("value")).then(s => { moves = s.val() || {}; if (cb && Object.keys(moves).length) cb(); return list(); }).catch(() => { movesP = null; return list(); });
    return movesP;
  };
  const byDiff = diff => list().filter(d => d.difficulty === diff);
  /** A new, empty playstyle (the Campaign Design form starts from it). */
  const blankStyle = () => ({ strategy: "default", mainFactor: null, mainBreak: null, attackers: { mode: "none", list: [] }, supporters: { mode: "none", list: [] }, disablers: { mode: "none", list: [] }, special: { mode: "none", list: [] }, critical: { mode: "default", n: 15 } });
  /** The playstyle as the bot reads it (src/engine/20-bot.js, opts.style). */
  const botStyle = ps => {
    if (ps && ps.bot && ps.bot.custom) {   // a hand-made bot for one deck, whatever the Strategy says (Revise#388: Dina)
      const b = ps.bot, all = g => ((ps[g] && ps[g].mode === "select" && ps[g].list) || []).map(x => x.key);
      return { strategy: "hero", attackersMode: (b.need || []).length ? "select" : "none", attackers: (b.need || []).map(key => ({ key, perm: null, wait: false })), all: true, only: false, safe: false, stack: !!b.stack, top: !!b.top,
        keep: all("attackers").concat(all("supporters"), all("disablers"), all("special")), shy: b.shy || [], first: b.first || null, useIf: b.useIf || null, special: [], mainBreak: ps.mainBreak || null,
        critical: ps.critical && ps.critical.mode === "specific" ? Math.max(0, Math.min(60, +ps.critical.n || 0)) : 15 };
    }
    if (!ps || (ps.strategy !== "hero" && ps.strategy !== "leader")) return null;
    const pick = g => (g && g.mode === "select" ? (g.list || []).map(x => ({ key: x.key, perm: x.perm || null, wait: !!(x.perm && x.wait) })) : []);
    const crit = ps.critical && ps.critical.mode === "specific" ? Math.max(0, Math.min(60, +ps.critical.n || 0)) : 15, spec = ((ps.special && ps.special.mode === "select" && ps.special.list) || []).map(x => x.key);
    if (ps.strategy === "leader") return { strategy: "leader", attackersMode: (ps.supporters && ps.supporters.mode) || "none", attackers: pick(ps.supporters), all: true, safe: true, only: false, stack: !!(ps.bot && ps.bot.stack),
      chargeMin: 4, drawMin: 3, special: spec, mainBreak: ps.mainBreak || null, critical: crit };   // Supportive Leader (Revise#384): Charge > 3, Draw > 2
    return { only: !!(ps.bot && ps.bot.only), safe: !!(ps.bot && ps.bot.safe), stack: !!(ps.bot && ps.bot.stack), top: !!(ps.bot && ps.bot.top),   // hand-made for one deck (Revise#383)
      strategy: "hero", attackersMode: (ps.attackers && ps.attackers.mode) || "none", attackers: pick(ps.attackers), special: ((ps.special && ps.special.mode === "select" && ps.special.list) || []).map(x => x.key), mainBreak: ps.mainBreak || null,
      critical: ps.critical && ps.critical.mode === "specific" ? Math.max(0, Math.min(60, +ps.critical.n || 0)) : 15 };
  };
  /** Send a proposal (Campaign Design → the admin's Pending page). */
  const propose = p => {
    if (!ready()) return Promise.reject(new Error("Firebase is not set up on this copy of the site — use Export and send the file instead"));
    const rec = Object.assign({}, p, { at: Date.now(), ver: window.AA_SITE_VER || "" });
    return R()._db().then(d => d.ref("campaign/pending").push(rec)).then(ref => ref.key);
  };
  const exportText = p => JSON.stringify(Object.assign({ kind: "aa-campaign-proposal" }, p), null, 1);
  const download = (name, text) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "application/json" })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); };
  const styleLine = ps => { const s = (STRATEGIES.find(x => x[0] === (ps && ps.strategy)) || STRATEGIES[0])[1], g = k => (ps && ps[k] ? (ps[k].mode === "select" ? (ps[k].list || []).length + " chosen" : ps[k].mode) : "none");
    return `${s} · Main Factor ${(ps && ps.mainFactor) || "—"} · attacker ${g("attackers")} · supporter ${g("supporters")} · disabler ${g("disablers")} · special ${g("special")} · critical ${ps && ps.critical && ps.critical.mode === "specific" ? ps.critical.n : 15}`; };

  /* ---------- #addoge → Campaign Bot Management ---------- */
  const CSS = `.aacp-tabs{display:flex;gap:6px;margin:8px 0}.aacp-tabs button[aria-selected=true]{background:#52b6ff;color:#06123a;border-color:#52b6ff}
.aacp-row{border:1px solid rgba(140,206,255,.3);border-radius:10px;padding:8px 10px;margin:6px 0;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 10px;align-items:center}
.aacp-row b{font-size:15px}.aacp-row small{display:block;font-size:12px;opacity:.85;overflow-wrap:anywhere}.aacp-row .aacp-acts{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;align-items:center}
.aacp-row select,.aacp-f select{font:14px system-ui;padding:6px 8px;border-radius:8px;border:1px solid rgba(140,206,255,.55);background:rgba(6,8,40,.75);color:#fff}
.aacp-f{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px;margin:4px 0}.aacp-pill{display:inline-block;font:700 11px system-ui;padding:1px 8px;border-radius:999px;border:1px solid rgba(140,206,255,.5);margin-left:6px}
.aarp .aacp-row button{padding:6px 10px;font-size:13px}`;
  const manage = () => {
    const A = R(); if (!A._box) return;
    if (!document.getElementById("aacpCss")) { const s = document.createElement("style"); s.id = "aacpCss"; s.textContent = CSS; document.head.appendChild(s); }
    const b = A._box(`<div class="aarp-lh"><h3>Campaign Bot Management</h3><span class="aarp-who" id="aacpWho"></span></div>
      <div class="aacp-tabs" role="tablist"><button type="button" role="tab" data-tab="active">Active</button><button type="button" role="tab" data-tab="pending">Pending</button></div>
      <div class="aacp-f"><label>Difficulty <select id="aacpF"><option value="">All</option>${DIFFS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></label><span id="aacpN"></span></div>
      <div class="aarp-msg" id="aacpM"></div><div id="aacpL"></div><div class="aarp-row aarp-bar" id="aacpBar"></div>`);
    b.el.classList.add("aarp-wide");
    const $ = id => b.el.querySelector("#" + id), msg = $("aacpM"), L = $("aacpL"), bar = $("aacpBar"), who = $("aacpWho");
    let tab = "active", filter = "", user = null, pending = null, sure = null;
    const say = (t, err) => { msg.className = "aarp-msg" + (err ? " err" : ""); msg.textContent = t || ""; };
    const fail = what => e => say(`${what}: ${(e && (e.code || e.message)) || e}\nThe Firebase rules must have “campaign” (docs, Revise#379), and moving or deleting needs the owner's sign-in.`, true);
    const diffSel = (cur, attr) => `<select ${attr} aria-label="Difficulty">${DIFFS.map(([v, l]) => `<option value="${v}"${v === cur ? " selected" : ""}>${l}</option>`).join("")}</select>`;
    const loadPending = () => { if (!ready()) { pending = []; say("Firebase is not set up on this copy of the site: proposals cannot be read here.", true); render(); return; }
      A._db().then(d => d.ref("campaign/pending").limitToLast(200).once("value")).then(s => { pending = []; s.forEach(c => { pending.push(Object.assign({ id: c.key }, c.val())); }); pending.sort((x, y) => (y.at || 0) - (x.at || 0)); render(); }).catch(fail("Could not read the proposals")); };
    const render = () => {
      b.el.querySelectorAll("[data-tab]").forEach(t => t.setAttribute("aria-selected", t.dataset.tab === tab ? "true" : "false"));
      who.innerHTML = user ? `${esc(user.email || "")} · <a href="#" id="aacpOut">sign out</a>` : `<a href="#" id="aacpIn">Owner sign-in (to move or delete)</a>`;
      const all = tab === "active" ? list() : pending || [], rows = all.filter(d => !filter || (d.difficulty || "medium") === filter);
      $("aacpN").textContent = `${rows.length} of ${all.length} deck${all.length === 1 ? "" : "s"}`;
      if (tab === "active") L.innerHTML = rows.map(d => `<div class="aacp-row"><div><b>${esc(d.name)}</b><span class="aacp-pill">${d.winRate != null ? "win rate " + d.winRate + "%" : "no win rate yet"}</span>${d.moved ? `<span class="aacp-pill">moved</span>` : ""}<small>Deck: ${(d.deck || []).length} cards · Playstyle: ${esc(styleLine(d.playstyle))}</small></div>
          <div class="aacp-acts">${diffSel(d.difficulty, `data-move="${esc(d.id)}"`)}</div></div>`).join("") || `<p class="aarp-msg">No deck in this difficulty.</p>`;
      else L.innerHTML = pending == null ? `<p class="aarp-msg">Loading…</p>` : rows.map(d => `<div class="aacp-row"><div><b>${esc(d.name || d.deckName || "(no name)")}</b><span class="aacp-pill">${A._when ? A._when(d.at || 0) : ""}</span><small>Deck: ${esc(d.deckName || "")} · ${(d.deck || []).length} cards · Playstyle: ${esc(styleLine(d.playstyle))}</small>${d.note ? `<small>Note: ${esc(d.note)}</small>` : ""}</div>
          <div class="aacp-acts">${diffSel(d.difficulty || "medium", `data-pdiff="${esc(d.id)}"`)}<button type="button" data-copy="${esc(d.id)}">Copy for Claude</button><button type="button" data-dl="${esc(d.id)}">Export</button><button type="button" class="aarp-send" data-del="${esc(d.id)}">${sure === d.id ? "Sure? Delete" : "✕ Delete"}</button></div></div>`).join("") || `<p class="aarp-msg">No proposal waiting${filter ? " in this difficulty" : ""}.</p>`;
      bar.innerHTML = (tab === "pending" && pending && pending.length ? `<button type="button" id="aacpAll">Export all (${pending.length})</button><button type="button" id="aacpRe">Reload</button>` : "") + `<button type="button" id="aacpOk">Close</button>`;
      const on = (sel, ev, f) => b.el.querySelectorAll(sel).forEach(e => e.addEventListener(ev, x => { x.preventDefault(); f(e); }));
      on("[data-move]", "change", e => { A._db().then(d => d.ref("campaign/moves/" + e.dataset.move).set(e.value)).then(() => { moves = Object.assign({}, moves, { [e.dataset.move]: e.value }); say(`Moved to ${e.options[e.selectedIndex].text}. Players see it the next time they open the Game Table.`); render(); }).catch(x => { fail("Could not move the deck")(x); render(); }); });
      on("[data-pdiff]", "change", e => { A._db().then(d => d.ref(`campaign/pending/${e.dataset.pdiff}/difficulty`).set(e.value)).then(() => { const p = pending.find(x => x.id === e.dataset.pdiff); if (p) p.difficulty = e.value; say("Difficulty saved with the proposal."); render(); }).catch(x => { fail("Could not save")(x); render(); }); });
      const get = id => { const p = pending.find(x => x.id === id), o = Object.assign({}, p); delete o.id; return o; };
      on("[data-copy]", "click", e => A._copy(exportText(get(e.dataset.copy))).then(() => { e.textContent = "Copied ✓"; }));
      on("[data-dl]", "click", e => download(`aa-campaign-${String(get(e.dataset.dl).name || "deck").replace(/[^\w\-]+/g, "_").slice(0, 40)}.json`, exportText(get(e.dataset.dl))));
      on("[data-del]", "click", e => { const id = e.dataset.del; if (sure !== id) { sure = id; render(); return; }
        A._db().then(d => d.ref("campaign/pending/" + id).remove()).then(() => { pending = pending.filter(x => x.id !== id); sure = null; say("Deleted."); render(); }).catch(x => { sure = null; fail("Could not delete")(x); render(); }); });
      const one = (id, f) => { const e = $(id); if (e) e.onclick = x => { x.preventDefault(); f(e); }; };
      one("aacpAll", () => download(`aa-campaign-pending-${Date.now()}.json`, JSON.stringify({ kind: "aa-campaign-proposals", proposals: pending.map(p => get(p.id)) }, null, 1)));
      one("aacpRe", () => { pending = null; render(); loadPending(); });
      one("aacpOk", b.close);
      one("aacpIn", () => A._auth().then(a => a.signInWithPopup(new window.firebase.auth.GoogleAuthProvider())).catch(fail("Sign-in failed")));
      one("aacpOut", () => A._auth().then(a => a.signOut()));
    };
    b.el.querySelectorAll("[data-tab]").forEach(t => (t.onclick = () => { tab = t.dataset.tab; sure = null; say(""); render(); if (tab === "pending" && pending == null) loadPending(); }));
    $("aacpF").onchange = e => { filter = e.target.value; render(); };
    render();
    load(() => document.body.contains(b.w) && render());
    if (ready()) A._auth().then(a => a.onAuthStateChanged(u => { user = u; if (document.body.contains(b.w)) render(); })).catch(() => {});
    else say("Firebase is not set up on this copy of the site: the built-in list is shown; moving decks and the Pending page need it.", true);
  };

  window.AACampaign = { DIFFS, STRATEGIES, list, load, byDiff, blankStyle, botStyle, propose, exportText, download, styleLine, manage, ready };
})();
