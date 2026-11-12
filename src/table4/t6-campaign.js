/* ==========================================================================
   v4 game table · Campaign Mode and Campaign Design (Pack, Revise#379)

   Lobby box "Campaign" (under Solo): your deck, a difficulty (Easy / Medium / Hard / Hell), a random or a chosen
   opponent from that difficulty's list (shared/campaign.js), Start → a Solo game against the bot with that deck
   and its playstyle. At the bottom, a link to the page "Campaign Design" (table.html#campaigndesign, Revise#382):
   one deck imported from a Deck Builder slot, shown as the Deck Builder shows it (columns of card pictures × n);
   the Playstyle form in a sidebar on the right that folds away; cards are chosen in a pop-up of the same deck
   picture (Apply to take them). "Send to the admin" saves the proposal (Firebase campaign/pending), "Export"
   gives the file.
   ========================================================================== */
(() => {
  "use strict";
  const TB = window.TB;
  if (!TB || TB._campaign) return;
  TB._campaign = true;
  const ui = TB.ui, esc = TB.esc, C = () => window.AACampaign;
  const info = k => (k ? TB.db.card(k) : null), label = k => { const i = info(k); return i ? `${i.en || i.jp} · ${k}` : k; };
  const GROUPS = [["attackers", "Main Attacker"], ["supporters", "Main Supporter"], ["disablers", "Main Disabler"]];
  const MAXD = 250;

  /* ---------- state ---------- */
  const cp = () => { const L = (ui.lobby = ui.lobby || {}); return (L.cp = L.cp || { slot: null, diff: "medium", random: true, opp: null }); };
  const cd = () => {
    if (!ui.cd) { const s = TB.store.get("aa4-cdesign", null); ui.cd = s && typeof s === "object" ? s : { open: false, tab: "deck", name: "", note: "", deck: null, style: null }; }
    if (!ui.cd.style) ui.cd.style = C().blankStyle();
    for (const g of ["attackers", "supporters", "disablers", "special"]) if (!ui.cd.style[g]) ui.cd.style[g] = { mode: "none", list: [] };
    if (!ui.cd.style.critical) ui.cd.style.critical = { mode: "default", n: 15 };
    return ui.cd;
  };
  const save = () => { try { TB.store.set("aa4-cdesign", ui.cd); } catch (e) { /* */ } };
  const uniq = (keys, types) => { const seen = new Set(), out = []; for (const k of keys || []) { const i = info(k); if (!i || seen.has(i.key) || (types && !types.includes(i.type))) continue; seen.add(i.key); out.push(i.key); } return out; };
  const counted = keys => { const m = new Map(); for (const k of keys || []) m.set(k, (m.get(k) || 0) + 1); return [...m.entries()].map(([k, n]) => { const i = info(k) || {}; return { k, n, name: i.en || i.jp || k, type: i.type || "?" }; }); };

  /** Draw the lobby again and keep what the player had set in it (the rule switches and the lists without a saved state, the scroll position). */
  const lobbyDraw = () => {
    if (ui.room) return;
    const sc = [...document.querySelectorAll("[data-keepscroll]")].map(e => [e.dataset.keepscroll, e.scrollTop, e.scrollLeft]);
    const keep = [...document.querySelectorAll(".lobby input[id], .lobby select[id]")].filter(e => !e.closest(".lcamp") && !e.dataset.lobby && e.type !== "file").map(e => [e.id, e.type === "checkbox" ? e.checked : e.value, e.type === "checkbox"]);
    const y = window.scrollY, act = document.activeElement && document.activeElement.id;
    TB.render();
    for (const [id, v, chk] of keep) { const e = document.getElementById(id); if (!e) continue; if (chk) e.checked = v; else e.value = v; }
    for (const [k, top, left] of sc) { const e = document.querySelector(`[data-keepscroll="${k}"]`); if (e) { e.scrollTop = top; e.scrollLeft = left; } }
    window.scrollTo(0, y); if (act && document.getElementById(act)) { try { document.getElementById(act).focus({ preventScroll: true }); } catch (x) { /* */ } }
  };
  /* ---------- the Campaign box ---------- */
  let asked = false;
  TB.campaignHTML = (slots, optHTML) => {
    if (!C()) return "";
    if (!asked) { asked = true; C().load(() => lobbyDraw()); }
    const s = cp(), all = C().list(), mine = slots.filter(x => x.keys.length);
    if (s.slot == null || !slots[s.slot] || !slots[s.slot].keys.length) s.slot = mine.length ? mine[0].i : 0;
    const n = d => all.filter(x => x.difficulty === d).length;
    if (!n(s.diff)) s.diff = n("medium") ? "medium" : (C().DIFFS.find(([d]) => n(d)) || ["medium"])[0];
    const opps = all.filter(x => x.difficulty === s.diff);
    if (!opps.some(o => o.id === s.opp)) s.opp = opps.length ? opps[0].id : null;
    return `<div class="lbox lcamp"><span class="cpbeta" title="Campaign Mode is new: the decks, the difficulties and the bots will change">Beta</span><h2>Campaign</h2>
      <p class="muted">Play your deck against a bot deck. Choose how hard it should be.</p>
      <label>Your deck <select id="cpSlot" data-cp="slot">${optHTML(s.slot)}</select></label>
      <div class="cpdiffs" role="radiogroup" aria-label="Difficulty">${C().DIFFS.map(([d, l]) => `<button type="button" class="btn cpdiff${s.diff === d ? " on" : ""}" role="radio" aria-checked="${s.diff === d}" data-cpdiff="${d}"${n(d) ? "" : ` disabled title="No deck in ${l} yet"`}>${l}<small>${n(d) ? n(d) + (n(d) === 1 ? " deck" : " decks") : "none yet"}</small></button>`).join("")}</div>
      <label class="cprand"><input type="checkbox" id="cpRandom" data-cp="random"${s.random ? " checked" : ""}> <span>Random Opponent</span></label>
      ${s.random ? `<p class="muted cpnote">One of the ${opps.length} ${esc((C().DIFFS.find(x => x[0] === s.diff) || [])[1] || "")} deck${opps.length === 1 ? "" : "s"} is chosen for you.</p>` : `<label>Opponent <select id="cpOpp" data-cp="opp">${opps.map(o => `<option value="${esc(o.id)}"${o.id === s.opp ? " selected" : ""}>${esc(o.name)}</option>`).join("")}</select></label>`}
      <button class="btn pri cpstart" data-act="campaignStart"${opps.length && mine.length ? "" : " disabled"}>Start</button>
      <p class="muted cpnote">A coin toss decides who goes first.</p>
      <div class="cdentry"><a class="btn" href="#campaigndesign">Campaign Design</a><small>Propose a deck and how its bot should play.</small></div></div>`;
  };
  TB.campaignStart = base => {
    const s = cp(), opps = C().list().filter(x => x.difficulty === s.diff);
    if (!opps.length) return TB.toast("No deck in this difficulty yet");
    const o = s.random ? opps[Math.floor(Math.random() * opps.length)] : opps.find(x => x.id === s.opp) || opps[0];
    TB.start(Object.assign({}, base, { mode: "solo2", slot: s.slot, bot: true, coin: true, name: "Player 1", name2: ("Bot · " + o.name).slice(0, 20),
      botDeck: { name: o.name, keys: o.deck.slice() }, style: C().botStyle(o.playstyle), campaign: { id: o.id, difficulty: s.diff, random: !!s.random } }));
  };

  /* ---------- Campaign Design: the page table.html#campaigndesign (Revise#382) ---------- */
  const COLS = [["Character", "#ffd447"], ["Break", "#ff6b7a"], ["Fast", "#52b6ff"], ["Project", "#b994ff"], ["Permanent", "#4fe3a6"]];
  /** The deck as the Deck Builder keeps it: {Character: [{k, n}], Break: […], …} in the builder's own order. */
  const colsOf = d => {
    if (d.cols) return d.cols;
    const out = Object.fromEntries(COLS.map(([c]) => [c, []]));
    for (const x of counted(d.keys)) (out[x.type] || out.Character).push({ k: x.k, n: x.n });
    return out;
  };
  const boardCols = d => {
    const cols = colsOf(d), ch = cols.Character || [], n = {};
    for (const e of ch) { const f = (info(e.k) || {}).faction; if (f) n[f] = (n[f] || 0) + e.n; }
    const mf = Object.keys(n).sort((a, b) => n[b] - n[a])[0] || "";
    const isMain = e => !!mf && (info(e.k) || {}).faction === mf;
    return [{ label: `Character · ${mf || "main factor"}`, color: COLS[0][1], list: ch.filter(isMain) }, { label: "Character · other", color: COLS[0][1], list: ch.filter(e => !isMain(e)) }]
      .concat(COLS.slice(1).map(([c, color]) => ({ label: c, color, list: cols[c] || [] })));
  };
  /** The deck picture (as on the Deck Builder page). pick = {can(key), sel: Set}: the cards become buttons. */
  const boardHTML = (d, pick) => `<div class="cdboard${pick ? " picking" : ""}" data-keepscroll="${pick ? "pickboard" : "board"}">${boardCols(d).map(c => `<div class="cdcol" style="--c:${c.color}">
      <div class="cdcolhead"><span>${esc(c.label)}</span><b>${c.list.reduce((a, e) => a + e.n, 0)}</b></div>
      <div class="cdcollist">${c.list.map(e => { const i = info(e.k) || {}, name = i.en || i.jp || e.k;
        if (!pick) return `<div class="cditem" title="${esc(name)} · ${esc(e.k)}">${TB.faceKey(e.k, "cdcard")}<span class="cdn">× ${e.n}</span></div>`;
        const can = pick.can(e.k), on = pick.sel.has(e.k);
        return `<button type="button" class="cditem pick${on ? " sel" : ""}${can ? "" : " off"}" data-pk="${esc(e.k)}" aria-pressed="${on}"${can ? "" : " disabled"} title="${esc(name)} · ${esc(e.k)}">${TB.faceKey(e.k, "cdcard")}<span class="cdn">× ${e.n}</span></button>`; }).join("")}</div></div>`).join("")}</div>`;
  const PICKS = { mainBreak: { title: "Main Break", types: ["Break"], multi: false, hint: "Choose one Break card of the deck." }, attackers: { title: "Main Attacker", types: ["Character", "Break"], multi: true }, supporters: { title: "Main Supporter", types: ["Character", "Break"], multi: true },
    disablers: { title: "Main Disabler", types: ["Character", "Break"], multi: true }, special: { title: "Special Priority Condition", types: null, multi: true, hint: "Choose any cards of the deck." } };
  const pic = k => (k && info(k) ? `<span class="cdpic">${TB.faceKey(k, "cdimg")}</span>` : "");
  const groupHTML = (g, title, d, withPerm) => {
    const st = d.style[g], perms = uniq(d.deck.keys, ["Permanent"]);
    const modes = g === "special" ? [["none", "None"], ["select", "Select"]] : [["none", "None"], ["any", "Any"], ["select", "Select"]];
    return `<fieldset class="cdgroup"><legend>${title}</legend>
      <div class="cdmodes">${modes.map(([v, l]) => `<label><input type="radio" name="cdm-${g}" data-cdg="${g}" data-k="mode" value="${v}"${st.mode === v ? " checked" : ""}> ${l}</label>`).join("")}</div>
      ${st.mode !== "select" ? "" : `<div class="cdadd"><button type="button" class="btn sm" data-cd="pick" data-g="${g}">Choose from the deck…</button><span class="muted">${st.list.length} chosen</span></div>
        <ol class="cdlist">${st.list.map((x, i) => `<li>${pic(x.key)}<div class="cdit"><b>${esc(label(x.key))}</b>
          <textarea rows="2" maxlength="${MAXD}" data-cdg="${g}" data-i="${i}" data-k="desc" aria-label="Description" placeholder="What is this card for? (up to ${MAXD} characters)">${esc(x.desc || "")}</textarea>
          ${withPerm ? `<div class="cdperm"><label>Permanent card <select data-cdg="${g}" data-i="${i}" data-k="perm"><option value="">— none —</option>${perms.map(k => `<option value="${esc(k)}"${k === x.perm ? " selected" : ""}>${esc(label(k))}</option>`).join("")}</select></label>
            <label class="cdwait"><input type="checkbox" data-cdg="${g}" data-i="${i}" data-k="wait"${x.wait ? " checked" : ""}${x.perm ? "" : " disabled"}> Wait for permanent?</label>${x.perm ? pic(x.perm) : ""}</div>` : ""}</div>
          <button type="button" class="btn sm cdrm" data-cdrm="${g}" data-i="${i}" aria-label="Remove ${esc(label(x.key))}">✕</button></li>`).join("")}</ol>`}</fieldset>`;
  };
  const sideHTML = d => {
    if (!d.deck) return `<p class="muted">Import a deck first.</p>`;
    const st = d.style, S = C().STRATEGIES, facs = (window.AA4.FACTIONS || []).map(f => f.name), sd = (S.find(x => x[0] === st.strategy) || S[0])[2];
    return `<label>Strategy <select data-cdf="strategy">${S.map(([v, l]) => `<option value="${v}"${st.strategy === v ? " selected" : ""}>${l}</option>`).join("")}</select></label><p class="muted cdhint">${esc(sd)}</p>
      <label>Main Factor <select data-cdf="mainFactor"><option value="">— choose —</option>${facs.map(f => `<option${st.mainFactor === f ? " selected" : ""}>${esc(f)}</option>`).join("")}</select></label>
      <fieldset class="cdgroup"><legend>Main Break</legend><div class="cdmb">${pic(st.mainBreak)}<div><b>${st.mainBreak ? esc(label(st.mainBreak)) : "Not chosen"}</b>
        <div class="cdadd"><button type="button" class="btn sm" data-cd="pick" data-g="mainBreak">Choose from the deck…</button>${st.mainBreak ? `<button type="button" class="btn sm" data-cd="mbclear">Clear</button>` : ""}</div></div></div></fieldset>
      ${GROUPS.map(([g, t]) => groupHTML(g, t, d, true)).join("")}
      ${groupHTML("special", "Special Priority Condition", d, false)}
      <fieldset class="cdgroup"><legend>Critical number</legend><div class="cdmodes"><label><input type="radio" name="cdcrit" data-cdf="critMode" value="default"${st.critical.mode !== "specific" ? " checked" : ""}> Default: 15</label>
        <label><input type="radio" name="cdcrit" data-cdf="critMode" value="specific"${st.critical.mode === "specific" ? " checked" : ""}> Specific</label>
        ${st.critical.mode === "specific" ? `<input type="number" min="0" max="60" step="1" data-cdf="critN" value="${+st.critical.n || 0}" aria-label="Critical number (0 to 60)">` : ""}</div>
        <p class="muted cdhint">When the bot's deck has fewer cards than this, it starts attacking without its conditions.</p></fieldset>
      <label>Note for the admin (optional) <textarea rows="2" maxlength="${MAXD}" data-cdf="note" placeholder="Anything else about how this deck should play">${esc(d.note || "")}</textarea></label>
      <div class="cdsend"><button type="button" class="btn pri" data-cd="send">Send to the admin</button><button type="button" class="btn" data-cd="export">Export (.json)</button></div>
      <p class="cdmsg${d.msgErr ? " err" : ""}" role="status">${esc(d.msg || "")}</p>`;
  };
  const pickHTML = d => {
    const p = ui.cdPick; if (!p || !d.deck) return "";
    const P = PICKS[p.g], sel = new Set(p.sel), can = k => !P.types || P.types.includes((info(k) || {}).type);
    return `<div class="cdpickscrim" data-cd="pickcancel"><div class="cdpick" role="dialog" aria-modal="true" aria-label="${P.title}: choose from the deck">
      <div class="cdpickhead"><h2>${P.title}</h2><p class="muted">${esc(P.hint || "Choose Character or Break cards of the deck.")} ${P.multi ? "Click a card to tick it, click again to untick." : "Click a card to choose it."} Then press Apply.</p></div>
      ${boardHTML(d.deck, { can, sel })}
      <div class="cdpickbar"><span>${p.sel.length} chosen</span><button type="button" class="btn" data-cd="pickcancel">Cancel</button><button type="button" class="btn pri" data-cd="pickapply">Apply</button></div></div></div>`;
  };
  TB.designPageHTML = () => {
    if (!C()) return "";
    const d = cd(), slots = TB.deckSlots(), mine = slots.filter(x => x.keys.length), fold = !!d.sideFold;
    const list = d.deck ? counted(d.deck.keys) : [], by = t => list.filter(x => x.type === t).reduce((a, x) => a + x.n, 0);
    return `<div class="cdpage lcamp${fold ? " sidefold" : ""}">
      <header class="cdtop"><a class="btn" href="#" data-cd="back">← Game Table</a><h1>Campaign Design <span class="cpbeta inline">Beta</span></h1><p class="muted">Propose a deck and how its bot should play. The admin reads it under Campaign Bot Management → Pending.</p></header>
      <div class="cdrow"><section class="cdmain" aria-label="Campaign Deck Builder">
        <h2>Campaign Deck Builder</h2>
        <div class="cdimport"><label>Import from the Deck Builder <select id="cdSlot">${mine.map(x => `<option value="${x.i}">Slot ${x.i + 1} · ${esc(x.name)} · ${x.keys.length} cards</option>`).join("") || `<option value="">(no deck on this device)</option>`}</select></label>
          <button type="button" class="btn" data-cd="import"${mine.length ? "" : " disabled"}>${d.deck ? "Replace the deck" : "Import"}</button>
          ${d.deck ? `<label class="cdname">Name of this Campaign deck <input type="text" maxlength="40" data-cdf="name" value="${esc(d.name || "")}"></label><button type="button" class="btn sm" data-cd="clear">Remove the deck and the playstyle</button>` : ""}</div>
        ${d.deck ? `<p class="muted cdsum"><b>${d.deck.keys.length}</b> cards · ${COLS.map(([t]) => `${t} ${by(t)}`).join(" · ")}</p>${boardHTML(d.deck, null)}` : `<p class="muted">One deck at a time. Build it in the Deck Builder first, then import its slot here.</p>`}
      </section>
      <aside class="cdside" aria-label="Playstyle"><button type="button" class="cdfold" data-cd="fold" aria-expanded="${!fold}" title="${fold ? "Show the Playstyle" : "Fold the Playstyle away"}"><span>Playstyle</span><i aria-hidden="true">${fold ? "◂" : "▸"}</i></button>
        ${fold ? "" : `<div class="cdsidebody" data-keepscroll="side">${sideHTML(d)}</div>`}</aside></div>
      ${pickHTML(d)}</div>`;
  };
  const proposal = () => { const d = cd(); return { name: (d.name || d.deck.name || "Campaign deck").slice(0, 40), note: (d.note || "").slice(0, MAXD), difficulty: "medium", deckName: d.deck.name || "", deck: d.deck.keys.slice(), list: counted(d.deck.keys), playstyle: JSON.parse(JSON.stringify(d.style)) }; };
  addEventListener("hashchange", () => { if (!ui.room) { ui.cdPick = null; TB.render(); window.scrollTo(0, 0); } });

  /* ---------- input ---------- */
  const inCamp = t => t && t.closest && t.closest(".lcamp");
  const redraw = () => { save(); lobbyDraw(); };
  const field = (t, live) => {
    const d = cd(), st = d.style;
    if (t.dataset.cp) { const s = cp(), k = t.dataset.cp; s[k] = k === "random" ? t.checked : k === "slot" ? +t.value : t.value; if (!live) lobbyDraw(); return true; }
    if (t.dataset.cdf) { const k = t.dataset.cdf, v = t.value;
      if (k === "name") d.name = v.slice(0, 40); else if (k === "note") d.note = Array.from(v).slice(0, MAXD).join("");
      else if (k === "strategy") st.strategy = v; else if (k === "mainFactor") st.mainFactor = v || null;
      else if (k === "critMode") st.critical.mode = v === "specific" ? "specific" : "default";
      else if (k === "critN") st.critical.n = Math.max(0, Math.min(60, Math.round(+v || 0)));
      d.msg = ""; if (live || k === "name" || k === "note" || k === "critN") save(); else redraw(); return true; }
    if (t.dataset.cdg) { const g = st[t.dataset.cdg], k = t.dataset.k, x = t.dataset.i != null ? g.list[+t.dataset.i] : null;
      if (k === "mode") g.mode = t.value; else if (x && k === "desc") x.desc = Array.from(t.value).slice(0, MAXD).join(""); else if (x && k === "perm") { x.perm = t.value || null; if (!x.perm) x.wait = false; } else if (x && k === "wait") x.wait = t.checked;
      d.msg = ""; if (live || k === "desc") save(); else redraw(); return true; }
    return false;
  };
  document.addEventListener("input", ev => { const t = ev.target; if (!inCamp(t) || !(t.tagName === "TEXTAREA" || t.type === "text" || t.type === "number")) return; field(t, true); });
  document.addEventListener("change", ev => { const t = ev.target; if (!inCamp(t) || t.dataset.lobby) return; if (t.tagName === "TEXTAREA" || t.type === "text") return void field(t, true); field(t, false); });
  document.addEventListener("keydown", ev => { if (ev.key === "Escape" && ui.cdPick && !ui.room) { ui.cdPick = null; lobbyDraw(); } });
  document.addEventListener("click", ev => {
    const t = ev.target.closest && ev.target.closest("[data-cpdiff],[data-cd],[data-cdrm],[data-pk]"); if (!t || !inCamp(t) || t.disabled) return;
    const d = cd();
    if (t.dataset.cpdiff) { cp().diff = t.dataset.cpdiff; return lobbyDraw(); }
    if (t.dataset.pk) { const p = ui.cdPick; if (!p) return; const k = t.dataset.pk, P = PICKS[p.g]; ev.stopPropagation();
      p.sel = P.multi ? (p.sel.includes(k) ? p.sel.filter(x => x !== k) : p.sel.concat([k])) : (p.sel[0] === k ? [] : [k]); return lobbyDraw(); }
    if (t.dataset.cdrm) { d.style[t.dataset.cdrm].list.splice(+t.dataset.i, 1); return redraw(); }
    const a = t.dataset.cd;
    if (a === "pickcancel") { if (t.classList.contains("cdpickscrim") && ev.target !== t) return; ui.cdPick = null; return lobbyDraw(); }   // the scrim itself, or the Cancel button
    if (a === "back") { ev.preventDefault(); ui.cdPick = null; history.replaceState(null, "", location.pathname + location.search); TB.render(); return window.scrollTo(0, 0); }
    if (a === "fold") { d.sideFold = !d.sideFold; return redraw(); }
    if (a === "pick") { const g = t.dataset.g; ui.cdPick = { g, sel: g === "mainBreak" ? (d.style.mainBreak ? [d.style.mainBreak] : []) : d.style[g].list.map(x => x.key) }; return lobbyDraw(); }
    if (a === "pickapply") { const p = ui.cdPick; if (!p) return;
      if (p.g === "mainBreak") d.style.mainBreak = p.sel[0] || null;
      else { const g = d.style[p.g], old = new Map(g.list.map(x => [x.key, x])); g.list = p.sel.map(k => old.get(k) || { key: k, desc: "", perm: null, wait: false }); g.mode = "select"; }   // the cards kept keep their description and Permanent card
      ui.cdPick = null; d.msg = ""; return redraw(); }
    if (a === "mbclear") { d.style.mainBreak = null; return redraw(); }
    if (a === "import") { const i = +(document.getElementById("cdSlot") || {}).value, sl = TB.deckSlots()[i]; if (!sl || !sl.keys.length) return TB.toast("Choose a deck slot with cards in it");
      const saved = (TB.store.get("aa-decks", null) || [])[i], cols = {};
      for (const [c] of COLS) cols[c] = ((saved && saved.cols && saved.cols[c]) || []).filter(e => e && e.n > 0 && info(e.k)).map(e => ({ k: info(e.k).key, n: e.n }));
      const fresh = !d.deck; d.deck = { name: sl.name, keys: sl.keys.slice(), cols: saved && saved.cols ? cols : null }; d.name = sl.name; if (!fresh) d.style = C().blankStyle(); d.msg = ""; return redraw(); }   // another deck: its cards differ, so the playstyle starts again
    if (a === "clear") { ui.cd = { tab: "deck", name: "", note: "", deck: null, style: C().blankStyle(), sideFold: d.sideFold }; return redraw(); }
    if (a === "export") { const p = proposal(); C().download(`aa-campaign-${p.name.replace(/[^\w\-]+/g, "_")}.json`, C().exportText(p)); d.msg = "Exported. Send the file to the admin."; d.msgErr = false; return redraw(); }
    if (a === "send") { const p = proposal(); d.msg = "Sending…"; d.msgErr = false; redraw();
      C().propose(p).then(() => { d.msg = "Sent. The admin sees it under Campaign Bot Management → Pending."; d.msgErr = false; redraw(); })
        .catch(e => { d.msg = "Could not send: " + ((e && (e.code || e.message)) || e) + " — use Export and send the file instead."; d.msgErr = true; redraw(); }); }
  });
})();
