/* ==========================================================================
   v4 game table · rendering (requirements_v4 §1, §18; Revise#006–#011, #054–#057)

   Everything is drawn from AA4.project(state, viewer) — the UI never sees hidden cards.
   What may be clicked comes from AA4.candidates() (the engine's legal actions), so the highlights,
   menus and greyed buttons always agree with the rules:
     playable = thick pastel-yellow border · valid target = running blue border ·
     field-effect source = running pastel-orange border · would be defeated = red outline.
   Layout (§18): one board per player in quadrants — 2 players: you take the bottom half, the opponent the
   top; 3 players: you the bottom, the next player top-left, the one after top-right; 4 players: Revise#054.
   Each board: Active Area (6 faction slots, the party stacked, lower characters as strips) + Special Area at its right end ·
   Control Area (Front) · Control Area (Back) · Damage / Deck / Discard column at the outer edge.
   Boards at the top are drawn upside down in row order (their Active Area faces the middle).
   ========================================================================== */
(function () {
  "use strict";
  const TB = window.TB, ui = TB.ui, esc = TB.esc, db = TB.db;
  const PHASE = AA4.PHASE_NAMES;
  const FAC_NAME = Object.fromEntries(AA4.FACTIONS.map(f => [f.id, f.name])); FAC_NAME.none = "No faction";
  const FAC_FILE = { ego: "ego", arayashiki: "arayashiki", wizdom: "wizdom", darklore: "darklore", polestar: "polestar", eraser: "eraser" };
  const ORD = ["1st", "2nd", "3rd", "4th"];
  const FAC_OF_NAME = Object.fromEntries(AA4.FACTIONS.map(f => [f.name, f.id]));

  /** Replay "Everything open": every card face up (only for a replay file, a solo game or a finished game) */
  function replayOpen(S) { const S2 = AA4.clone(S); for (const c of Object.values(S2.cards)) c.faceUp = true; return AA4.project(S2, -1, db); }
  /* ---------- per-render context ---------- */
  let R = null;   // {S, V, viewer, cands, byCard, byCh, tgt: Set, pay: Set, picked: Set, src}
  function context() {
    const S = ui.log.state, viewer = TB.viewSeat(), V = ui.replay && ui.replay.view === "all" ? replayOpen(S) : AA4.project(S, viewer, db);
    const cands = viewer >= 0 && S.stage !== "lobby" && !ui.replay ? AA4.candidates(S, db, ui.cid, viewer, { maxX: 10 }).filter(c => !(c.t === "declare" && c.kind === "effect" && c.x === 0)) : [];
    const byCard = new Map(), byCh = new Map();
    for (const c of cands) {
      if (c.card) (byCard.get(c.card) || byCard.set(c.card, []).get(c.card)).push(c);
      if (c.ch && c.t !== "charge") (byCh.get(c.ch) || byCh.set(c.ch, []).get(c.ch)).push(c);
    }
    const r = { S, V, viewer, cands, byCard, byCh, tgt: new Set(), pay: new Set(), picked: new Set(), src: ui.src || null };
    // selections derived from the state: a declaration of mine in its pay / target step
    const d = S.draft;
    if (d && d.seat === viewer) {
      if (!ui.sel || ui.sel.draft !== d.id || ui.sel.step !== d.step) ui.sel = { kind: d.step === "pay" ? "pay" : "target", draft: d.id, step: d.step, picked: [] };
      if (d.step === "pay") { for (const ch of d.payFrom) for (const id of (S.chars[ch] || { power: [] }).power) r.pay.add(id); }
      if (d.step === "target") for (const t of AA4.draftTargets(S, db, d, (ui.sel && ui.sel.picked || []).map(TB.keyToRef))) r.tgt.add(refKey(t));
    } else if (ui.sel && (ui.sel.kind === "pay" || ui.sel.kind === "target")) ui.sel = null;
    r.charge = TB.chargeState(S, viewer);
    r.chg = new Set(r.charge.on ? r.charge.targets : []);
    if (r.charge.on && r.charge.q.length) for (const ch of r.charge.targets) r.tgt.add("ch:" + ch);
    if (ui.sel && ui.sel.kind === "trig") {
      const tr = S.triggers.find(x => x.id === ui.sel.id);
      const ab = tr && db.card(S.cards[tr.card].key).abilities[tr.ability];
      if (ab && ab.effect && ab.effect.target) for (const t of AA4.targetCandidates(S, db, ab.effect.target, { seat: tr.seat, ch: tr.ch, card: tr.card })) r.tgt.add(refKey(t));
      else ui.sel = null;
    }
    if (ui.sel && ui.sel.kind === "atkChar") {   // "Targeting attack" (Pack, Revise#428): the characters it may attack, in blue
      const ok = (byCh.get(ui.sel.ch) || []).filter(c => c.t === "declare" && c.kind === "attack" && c.target && c.target.ch != null).map(c => c.target.ch);
      if (!ok.length) ui.sel = null; else for (const ch of ok) r.tgt.add("ch:" + ch);
    }
    if (ui.sel && ui.sel.kind === "bhPlace") {   // By hand "Move to: Break / Permanent / Power card" (Pack): the places it can go, in blue
      const ok = AA4.moveDestinations(S, db, viewer, ui.sel.card).filter(to => to.z === "char" && to.role === ui.sel.role).map(to => to.ch);
      if (!ok.length || !S.cards[ui.sel.card]) ui.sel = null; else for (const ch of ok) r.tgt.add("ch:" + ch);
    }
    if (ui.sel && ui.sel.picked) for (const x of ui.sel.picked) r.picked.add(typeof x === "string" ? x : refKey(x));
    // a choice of a new target (Alteration Magic …): its options are clicked on the field like a declaration's targets (Pack, Revise#162)
    r.tgtDec = null;
    const od = S.decisions.find(x => x.onField && TB.mySeats().includes(x.seat) && Array.isArray(x.options));
    const sd = !od && S.decisions.find(x => x.setCard && TB.mySeats().includes(x.seat) && Array.isArray(x.options));   // a Permanent to set (Pack, Revise#231): its characters are clicked on the field, like Charge
    if (sd) { r.tgtDec = { id: sd.id, seat: sd.seat, map: new Map() }; for (const o of sd.options) { r.tgt.add("ch:" + o); r.tgtDec.map.set("ch:" + o, o); } }
    // Pack (Revise#245): a choice of players / characters / areas is made on the field — "p:1", "c:ch3", "0:active", a character id
    r.fieldPick = od ? { id: od.id, rest: [], picked: (od.fieldPicked || []).map(o => TB.fieldKeyOf(S, o)).filter(Boolean), retgt: true } : null;
    const fpd = !od && !sd && S.decisions.find(x => TB.mySeats().includes(x.seat) && x.kind === "pick" && Array.isArray(x.options));
    if (fpd) { const m = new Map(), rest = [];
      for (const o of fpd.options) { const k = TB.fieldKeyOf(S, o); if (k) m.set(k, o); else rest.push(o); }
      if (m.size && m.size >= fpd.options.length - 2) { r.tgtDec = { id: fpd.id, seat: fpd.seat, map: m }; for (const k of m.keys()) r.tgt.add(k); r.fieldPick = { id: fpd.id, rest, picked: (fpd.fieldPicked || []).map(o => TB.fieldKeyOf(S, o)).filter(Boolean) }; } }
    if (od) { r.tgtDec = { id: od.id, seat: od.seat, map: new Map() }; for (const o of od.options) { try { const k = refKey(JSON.parse(o)); r.tgt.add(k); r.tgtDec.map.set(k, o); } catch (e) { /* not a ref */ } } }
    // a choice made on the board (Revise#088: power cards above Mental): the character in red, its power cards clickable
    const fd = S.decisions.find(x => x.ref && x.ref.field && TB.mySeats().includes(x.seat) && Array.isArray(x.options));
    r.fieldDec = fd || null; r.fix = new Set();
    if (fd) {
      if (fd.ref.ch) r.fix.add(fd.ref.ch);
      for (const id of fd.options) r.pay.add(id);
      for (const id of (ui.dpick && ui.dpick.id === fd.id ? ui.dpick.list : [])) r.picked.add(id);
    }
    return r;
  }
  /** Charge Phase (as v3): picked hand cards and deck cards wait in the Charge window, then go one by one to the
      characters clicked. ui.charge = {key: turn:seat, q: [{s: "h", card} | {s: "d"}]} (not part of the game log). */
  TB.chargeState = (S, seat) => {
    const on = seat >= 0 && S.stage === "play" && S.turn.phase === "charge" && S.turn.player === seat && S.turn.step === "open" && !S.decisions.length && !S.draft;
    if (!on) { if (S.turn.phase !== "charge") ui.charge = null; return { on: false, q: [], targets: [], deckLeft: 0, deckMax: 0 }; }
    const key = S.turn.number + ":" + seat, p = S.players[seat];
    if (!ui.charge || ui.charge.key !== key) ui.charge = { key, q: [] };
    ui.charge.q = ui.charge.q.filter(x => x.s === "d" || p.zones.hand.includes(x.card));
    const q = ui.charge.q, deckMax = AA4.playerStats(S, db, seat).charge, used = p.turnFlags.deckCharged || 0, qd = q.filter(x => x.s === "d").length;
    return { on, q, targets: AA4.chargeTargets(S, db, seat), deckMax, deckUsed: used, deckLeft: Math.max(0, Math.min(deckMax - used - qd, p.zones.deck.length - qd)) };
  };
  /** An option of a choice → the thing on the field it names (Revise#245), or null. */
  TB.fieldKeyOf = (S, o) => { o = String(o); let m;
    if ((m = /^p:(\d+)$/.exec(o)) && S.players[+m[1]]) return "seat:" + m[1];
    if ((m = /^c:(.+)$/.exec(o)) && S.chars[m[1]]) return "ch:" + m[1];
    if ((m = /^(\d+):(active|control)$/.exec(o)) && S.players[+m[1]]) return "area:" + m[1] + ":" + m[2];
    if (S.chars[o]) return "ch:" + o;
    if (o[0] === "{") { try { const k = refKey(JSON.parse(o)); return k === "?" ? null : k; } catch (e) { return null; } }   // a ref (Changing Target, Revise#248)
    return null; };
  const refKey = t => (t.ch ? "ch:" + t.ch : t.seat != null ? "seat:" + t.seat : t.card ? "card:" + t.card : t.field ? "field" : t.item ? "item:" + t.item : "?");
  TB.refKey = refKey;
  TB.ctx = () => R;

  /* ---------- cards ---------- */
  const info = key => (key ? db.card(key) : null);
  const EN = inf => (inf ? inf.en || inf.jp : "?");   // English name on screen (Pack); the Japanese one when there is none
  const TIP = inf => (inf.en ? `${inf.en} · ${inf.jp}` : inf.jp);
  TB.EN = EN; TB.TIP = TIP;
  const nameOf = id => { const c = R.V.cards[id], inf = c && info(c.key); return inf ? EN(inf) : "a hidden card"; };
  TB.nameOf = id => nameOf(id);
  /** A card shown by its key only (the cost of a declaration, kept visible until it resolves). */
  TB.faceKey = (key, cls) => faceKey(key, cls);
  /** Landscape card pictures (Permanent cards are printed sideways — Pack, Revise#283): learnt from the loaded picture, remembered per card picture. */
  TB.land = TB.land || (() => { try { return new Set(JSON.parse(localStorage.getItem("aa4-land") || "[]")); } catch (e) { return new Set(); } })();
  TB.landCls = inf => (inf && TB.land.has(inf.fid) ? " land" : "");
  TB.landImg = (img, fid) => {
    if (!img || !fid || !(img.naturalWidth > img.naturalHeight * 1.05)) return;
    if (img.parentNode && !img.parentNode.classList.contains("land")) img.parentNode.classList.add("land");
    if (!TB.land.has(fid)) { TB.land.add(fid); try { localStorage.setItem("aa4-land", JSON.stringify([...TB.land].slice(-500))); } catch (e) {} }
  };
  function faceKey(key, cls = "") {
    const inf = key && info(key), w = ui.size >= 5 ? 480 : ui.size >= 3 ? 280 : 160;
    if (!inf) return `<div class="card back${cls ? " " + cls : ""}"></div>`;
    return `<div class="card${cls ? " " + cls : ""}${TB.landCls(inf)}" title="${esc(TIP(inf))}"><img loading="lazy" alt="" onload="TB.landImg(this,'${inf.fid}')" src="${TB.img(inf.fid, w)}" onerror="if(!this.dataset.f){this.dataset.f=1;this.src='${TB.img2(inf.fid, w)}'}else{this.remove()}"><span class="cname">${esc(EN(inf))}</span></div>`;
  }
  function face(id, cls = "", extra = "") {
    const c = R.V.cards[id], inf = c && info(c.key);
    const k = "card:" + id;
    const hl = (R.tgt.has(k) ? " tgt" : "") + (R.picked.has(k) || R.picked.has(id) ? " picked" : "") + (R.pay.has(id) ? " pay" : "") + (R.src === id ? " src" : "");
    if (!inf) {
      const owner = c ? c.owner : 0, sl = R.V.players[owner] && R.V.players[owner].sleeve;
      return `<div class="card back${cls ? " " + cls : ""}${hl}" data-card="${esc(id)}" style="${TB.sleeveStyle(sl)}" ${extra}></div>`;
    }
    const w = ui.size >= 5 ? 480 : ui.size >= 3 ? 280 : 160;
    return `<div class="card${cls ? " " + cls : ""}${hl}${TB.landCls(inf)}" data-card="${esc(id)}" title="${esc(TIP(inf))}" ${extra}>`
      + `<img loading="lazy" alt="" onload="TB.landImg(this,'${inf.fid}')" src="${TB.img(inf.fid, w)}" onerror="if(!this.dataset.f){this.dataset.f=1;this.src='${TB.img2(inf.fid, w)}'}else{this.remove()}">`
      + `<span class="cname">${esc(EN(inf))}</span></div>`;
  }
  TB.face = face;
  /** A small card picture (power cards, structure, party): the face when the viewer may see it, else the sleeve. */
  function thumb(id, cls, extra = "", style = "") {
    const c = R.V.cards[id], inf = c && info(c.key);
    if (!inf) { const sl = R.V.players[c ? c.owner : 0] && R.V.players[c ? c.owner : 0].sleeve; return `<span class="${cls} down" data-card="${esc(id)}" style="${TB.sleeveStyle(sl)};${style}" title="Face down" ${extra}></span>`; }
    return `<span class="${cls}${TB.landCls(inf)}" data-card="${esc(id)}" title="${esc(TIP(inf))}" style="${style}" ${extra}><img loading="lazy" alt="" onload="TB.landImg(this,'${inf.fid}')" src="${TB.img(inf.fid, 160)}" onerror="if(!this.dataset.f){this.dataset.f=1;this.src='${TB.img2(inf.fid, 160)}'}else{this.remove()}"><b>${esc(EN(inf))}</b></span>`;
  }
  TB.thumb = (id, cls, extra, style) => thumb(id, cls, extra, style);

  /* ---------- characters ---------- */
  function statTxt(st) {
    const b = st.base || {}, cls = (k, v) => (v != null && b[k] != null && +b[k] !== v ? (v > +b[k] ? " up" : " down") : "");
    const at = AA4.atkText(st);   // "44 (1)": Attack and mental Attack (Revise#191)
    return `<span class="st"><b class="se${cls("se", st.se)}">${st.se == null ? "–" : st.se}</b>/<b class="at${cls("at", st.at)}">${at}</b>/<b class="de${cls("de", st.de)}">${st.de == null ? "–" : st.de}</b></span>`;
  }
  /** Project / Fast cards shown on the character they target (Pack, Revise#162): while declared (before it resolves) and
      while their lasting result is on it — not in the Special Area, so the player sees which cards count for its numbers. */
  function onCharPF() {
    const S = R.S, out = new Map(), add = (ch, id) => { if (S.chars[ch]) { const l = out.get(ch) || out.set(ch, []).get(ch); if (!l.includes(id)) l.push(id); } };
    const pf = id => S.cards[id] && ["Project", "Fast"].includes((info(S.cards[id].key) || {}).type);
    for (const it of S.stack) if (it.kind === "set" && pf(it.card)) for (const t of it.targets || []) if (t.ch) add(t.ch, it.card);
    for (const p of S.players) for (const id of p.zones.special) if (pf(id)) for (const m of S.modifiers) if (m.src && m.src.card === id && m.to && m.to.ch) add(m.to.ch, id);
    return out;
  }
  function charHTML(chId, lower) {
    const S = R.S, ch = R.V.chars[chId];
    if (!ch) return "";
    const top = AA4.topOf(ch), st = AA4.charStats(S, db, chId), b = S.battle;
    const inBattle = b && [b.attacker, b.guard, b.target && b.target.ch].concat(b.joined.att, b.joined.grd).includes(chId);
    const hl = (R.tgt.has("ch:" + chId) ? " tgt" : "") + (R.picked.has("ch:" + chId) ? " picked" : "") + (S.chars[chId].flags.dying ? " dying" : "")
      + (inBattle ? " inbattle" : "") + ((R.byCh.get(chId) || []).length ? " can" : "") + (S.chars[chId].flags.tapped ? " tapped" : "") + (R.chg.has(chId) ? " chg" : "") + (R.fix.has(chId) ? " fix" : "")
      + (S.turn.phase === "main" && (R.byCh.get(chId) || []).some(c => c.t === "declare" && (c.kind === "attack" || c.kind === "effect")) ? " act" : "");   // Main Phase: can attack / use an effect (Pack)
    void lower;
    // power cards: from the hand face up (a small picture), from the deck face down (sleeve) — Revise#083
    const pend = new Set((S.pendingPower || []).map(x => x.card));   // charged this Charge Phase, not set yet (Revise#091): pastel yellow
    const power = ch.power.map(id => thumb(id, "pc" + (pend.has(id) ? " pend" : "") + (R.pay.has(id) ? " pay" : "") + (R.picked.has(id) || R.picked.has("card:" + id) ? " picked" : "") + (R.tgt.has("card:" + id) ? " tgt" : ""))).join("");   // a power card can be a target
    const perms = ch.perm.map(id => thumb(id, "permc" + (R.tgt.has("card:" + id) ? " tgt" : "") + (R.src === id ? " src" : ""))).join("");   // permanents as small cards (as v3)
    // card structure (Revise#083): Character → Break → Break …, the newest on top; the ones below peek out to the top right
    const under = ch.stack.slice(0, -1), n = under.length;
    const unders = under.map((id, i) => thumb(id, "und", "", `--d:${n - i};z-index:${i + 1}`)).join("");
    const brk = n ? `<span class="stk" title="${esc(ch.stack.map((id, i) => `${i + 1}. ${i ? "Break" : "Character"}: ${nameOf(id)}`).join("\n"))}">${ch.stack.length}</span>` : "";
    const skills = Object.keys(st.skills).filter(k => AA4.SKILLS[k] && !AA4.SKILLS[k].todo).map(k => AA4.SKILLS[k].en.replace("▼ ", "▼") + (k === "bind" && st.bindList && new Set(st.bindList).size > 1 ? " " + [...new Set(st.bindList)].sort((x, y) => x - y).join(" / ") : typeof st.skills[k] === "number" ? " " + st.skills[k] : "")).slice(0, 4).join(" · ");   // with the value now: "Charge 6" (Charge X worked out — Pack, 2026-11-07)
    const pw = ch.power.length, mental = st.se;
    const drag = AA4.isControlled(S.chars[chId]) && TB.mySeats().includes(S.chars[chId].owner) ? " draggable" : "";
    // the details (stats, power cards, permanents, skills) sit to the right of the card; the highlight box holds both (Pack, Revise#113)
    return `<div class="ch${hl}${drag}" data-ch="${chId}" style="--sn:${n}"><div class="struct" style="--n:${n}">${unders}${face(top, "top", `style="z-index:${n + 1}"`)}${brk}</div><div class="chd">${statTxt(st)}`
      + (pw || mental != null ? `<div class="pcount" title="Power cards / Mental">P${pw}${mental != null ? "/" + mental : ""}</div>` : "")
      + (pw ? `<div class="pws" style="--ov:${pw > 1 ? (Math.min(0.42, 1.1 / (pw - 1)) - 0.5).toFixed(3) : 0}">${power}</div>` : "") + (perms ? `<div class="perms">${perms}</div>` : "")
      + ((R.onPF && R.onPF.get(chId) || []).length ? `<div class="pfon" title="Project / Fast cards on this character">${R.onPF.get(chId).map(id => face(id, "permc pfc")).join("")}</div>` : "")
      + (skills ? `<div class="sk">${esc(skills)}</div>` : "") + `</div></div>`;
  }
  /** An Active Area faction party: the characters below the top one peek out to the top right, each one clickable. */
  function partyHTML(list) {
    if (!list.length) return `<div class="card empty"></div>`;
    const lower = list.slice(0, -1), n = lower.length, topCh = R.S.chars[list[list.length - 1]], sn = topCh ? topCh.stack.length - 1 : 0;
    const pu = lower.map((id, i) => {
      const c = R.V.chars[id], hl = (R.tgt.has("ch:" + id) ? " tgt" : "") + (R.picked.has("ch:" + id) ? " picked" : "") + (R.S.chars[id].flags.dying ? " dying" : "") + (R.chg.has(id) ? " chg" : "");
      const st = AA4.charStats(R.S, db, id);
      return `<div class="pu${hl}" data-ch="${id}" style="--d:${n - i};z-index:${i + 1}" title="${esc(nameOf(AA4.topOf(c)))} · ${st.se == null ? "–" : st.se}/${st.at == null ? "–" : st.at}/${st.de == null ? "–" : st.de} · power ${c.power.length}">${thumb(AA4.topOf(c), "puc")}</div>`;
    }).join("");
    return `<div class="party" style="--n:${n};--sn:${sn}">${pu}<div class="ptop">${charHTML(list[list.length - 1])}</div></div>`;
  }

  /* ---------- a board ---------- */
  function pile(seat, z, label) {
    const p = R.V.players[seat], list = p.zones[z], n = list.length;
    const top = z === "deck" ? null : list[n - 1];
    const tgt = z === "deck" && R.tgt.has("seat:" + seat) ? " tgt" : "";
    const warn = z === "damage" && n >= 8 ? " warn" : "";
    const hiddenTop = z === "discard" && n > 0 && !(top && R.V.cards[top] && R.V.cards[top].key);   // the Discard Pile is face down (Revise#112): its sleeve, in a bold grey frame (Pack, Revise#127)
    const flipTop = z === "deck" && R.V.deckTop && R.V.deckTop[seat] ? info(R.V.deckTop[seat]) : null;   // a turned-over deck shows its top card (Revise#132)
    const inner = flipTop ? `<div class="card" style="pointer-events:none" title="Turned over: ${esc(EN(flipTop))}"><img alt="" src="${TB.img(flipTop.fid, 160)}" onerror="this.remove()"></div>` : z === "deck" ? `<div class="card back" style="${TB.sleeveStyle(p.sleeve)}"></div>` : hiddenTop ? `<div class="card back dsl" style="${TB.sleeveStyle(p.sleeve)}"></div>` : top ? `<div class="card" style="pointer-events:none">${(() => { const inf = info(R.V.cards[top].key); return inf ? `<img alt="" src="${TB.img(inf.fid, 160)}" onerror="this.remove()"><span class="cname">${esc(EN(inf))}</span>` : ""; })()}</div>` : `<div class="card empty"></div>`;
    // Charge X (Revise#083): how many power cards may still come from this deck this turn
    let chg = "";
    if (z === "deck" && R.S.stage === "play") {   // Charge (power cards from the deck this turn) and Draw (cards drawn in the Draw Phase) — Pack
      const ps = AA4.playerStats(R.S, db, seat), total = ps.charge;
      // icon + the maximum only (Pack): ⚡ Charge, ✋ Draw — the words are in the tooltip
      const left = R.charge.on && seat === R.viewer ? ` — ${R.charge.deckLeft} left this turn` : "";
      chg = `<span class="deckb"><span class="dkb chg" title="Charge: up to ${total} power card${total === 1 ? "" : "s"} from the deck per turn${left}">⚡${total}</span><span class="dkb drw" title="Draw: ${ps.draw} card${ps.draw === 1 ? "" : "s"} in the Draw Phase">✋${ps.draw}</span></span>`;
    }
    const can = z === "deck" && R.charge.on && seat === R.viewer && R.charge.deckLeft ? " can" : "";
    return `<div class="pilew"><div class="pile ${z}${tgt}${warn}${can}" data-pile="${z}" data-seat="${seat}" title="${esc(label)}: ${n}${z === "deck" ? "" : " — click to look"}"><span class="pl">${label}</span>${inner}${chg}<span class="pn">${n}</span></div></div>`;   // Charge / Draw at the top inside the deck's frame (Pack, Revise#208)
  }
  /** The Player on the field (Pack, Revise#214): bottom right of the field, the size of the Deck; not a character.
      Shows the Player image, name, the skills the player has and how many effects reach the player; click → the details. */
  const playerSkills = ps => Object.entries(ps.skills || {}).map(([id, x]) => ((AA4.SKILLS[id] && AA4.SKILLS[id].en) || id) + (typeof x === "number" ? " " + x : ""));
  function playerTileHTML(seat) {
    const S = R.S, p = R.V.players[seat], ps = AA4.playerStats(S, db, seat), fx = AA4.playerEffects(S, db, seat), sk = playerSkills(ps);
    const tgt = R.tgt.has("seat:" + seat) ? " tgt" : "";
    return `<div class="pilew ptw"><div class="pile player${tgt}" data-player="${seat}" title="${esc(p.name)} — the Player (not a character)${fx.length ? " · " + fx.length + " effect" + (fx.length === 1 ? "" : "s") : ""}${tgt ? " — click to choose this player" : " — click for details"}"><span class="pl">Player</span>`
      + `<div class="card pcard"><img alt="" src="${esc(TB.avatarSrc(p.avatar || AA4.AVATARS[seat % AA4.AVATARS.length]))}" onerror="this.src='players/p1.jpg'"><span class="pname">${esc(p.name)}</span>${sk.length ? `<span class="psk">${sk.map(x => `<i>${esc(x)}</i>`).join("")}</span>` : ""}</div>`
      + `${fx.length ? `<span class="pn pfx" aria-label="${fx.length} effects on this player">✦ ${fx.length}</span>` : ""}</div></div>`;
  }
  TB.playerModalHTML = m => {
    const S = R.S, p = R.V.players[m.seat]; if (!p) return "";
    const ps = AA4.playerStats(S, db, m.seat), fx = AA4.playerEffects(S, db, m.seat), sk = playerSkills(ps);
    const UNTIL = { battle: "this battle", main: "main phase", turn: "this turn", removed: "until removed", source: "while its card stays", charge: "Charge Phase", nextTurn: "next turn", seatTurn: "their next turn", game: "this game" };
    const stat = (l, n) => `<span><small>${l}</small><b>${n}</b></span>`;
    return `<div class="modal pmodal"><div class="mh">${esc(p.name)} <span class="muted">· Player (not a character)</span></div><div class="pmb">`
      + `<img class="pmimg" alt="" src="${esc(TB.avatarSrc(p.avatar || AA4.AVATARS[m.seat % AA4.AVATARS.length]))}" onerror="this.src='players/p1.jpg'"><div class="pmi">`
      + `<div class="pmstats">${stat("Draw", ps.draw)}${stat("Charge", ps.charge)}${stat("Hand limit", ps.handLimit >= 99 ? "∞" : ps.handLimit)}${stat("Hand", p.zones.hand.length)}${stat("Deck", p.zones.deck.length)}${stat("Damage", p.zones.damage.length)}</div>`
      + `<h4>Skills</h4>${sk.length ? `<div class="pmsk">${sk.map(x => `<span class="chip">${esc(x)}</span>`).join("")}</div>` : `<p class="muted">None</p>`}`
      + `<h4>Effects on this player</h4>${fx.length ? `<ul class="pmfx">${fx.map(r => `<li><b>${esc(r.label)}</b> ${esc(r.text)}${UNTIL[r.until] ? `<i>${esc(UNTIL[r.until])}</i>` : ""}</li>`).join("")}</ul>` : `<p class="muted">None</p>`}`
      + `<p class="muted pmnote">Draw / Charge / Hand limit include the Controlled Characters' skills.</p></div></div><div class="mf"><button class="btn" data-act="close">Close</button></div></div>`;
  };
  function boardHTML(seat, pos) {
    const S = R.S, V = R.V, p = V.players[seat], mine = TB.mySeats().includes(seat);
    const idx = S.turn.order.indexOf(seat), color = (ui.colors.seats && ui.colors.seats[ui.room + ":" + seat]) || (seat === R.viewer || (R.viewer < 0 && idx === 0) ? ui.colors.me : ui.colors.opp);
    const active = AA4.SLOTS.filter(s => s !== "none" || p.areas.active.none.length).map(slot => {
      const list = p.areas.active[slot];
      return `<div class="slot" data-slot="${slot}"><div class="sl">${FAC_FILE[slot] ? `<img src="factions/${FAC_FILE[slot]}.png" alt="">` : ""}<span>${esc(FAC_NAME[slot])}</span>${list.length > 1 ? `<b class="pn2">${list.length}</b>` : ""}</div>${partyHTML(list)}</div>`;
    }).join("");
    const onPF = new Set([].concat(...[...(R.onPF || new Map()).values()]));
    const special = p.zones.special.filter(id => !onPF.has(id)).concat(p.zones.declared).map(id => face(id, "sp")).join("");
    const turn = S.turn.player === seat && S.stage === "play";
    const head = `<div class="bh${R.tgt.has("seat:" + seat) ? " tgt" : ""}" data-seat="${seat}"><b>${esc(p.name)}</b>${idx >= 0 ? `<span class="ord">${ORD[idx]} player</span>` : ""}`
      + (S.stage === "play" ? phaseStripHTML(S, seat, turn) : "") + (p.lost ? `<span class="lost">lost</span>` : "")
      + `<span class="hc${!mine && p.zones.hand.some(id => V.cards[id] && V.cards[id].key) ? " open" : ""}" title="Cards in hand — click the header to look at the hand${!mine && p.zones.hand.some(id => V.cards[id] && V.cards[id].key) ? " (open to you)" : ""}">✋ ${p.zones.hand.length}${!mine && p.zones.hand.some(id => V.cards[id] && V.cards[id].key) ? " 👁" : ""}</span>${p.hold ? "" : `<span class="hold">Hold OFF</span>`}`
      + (mine ? "" : `<span class="you">${esc(p.deckName || "")}</span>`) + "" + `<button class="mini col" data-act="color" data-seat="${seat}" title="Field colour">🎨</button>${takeBtn(seat)}`
      + (mine && seat === R.viewer ? `<label class="sizebar bhsize" title="Card size: Lv 1 (small) … Lv 6 (real card size)"><span>Size</span><input type="range" id="sizeTop" min="1" max="6" step="1" value="${ui.size}" aria-label="Card size level"><b id="sizeTopLv">Lv ${ui.size}</b></label>` : "") + `</div>`;   // Pack (Revise#335): the card size at the top right of your own field
    const rows = `<div class="row act"><span class="rl">Active</span>${active}<div class="special"><span class="rl">Special</span>${special}</div></div>`   // Special Area at the right end of the Active Area (Pack, Revise#181)
      + `<div class="row front"><span class="rl">Control · Front</span><div class="chars" data-area="front">${mine && p.areas.front.length > 1 ? TB.sortBtnHTML(seat, "front") : ""}${p.areas.front.filter(id => V.chars[id]).map(id => charHTML(id)).join("")}</div></div>`   // Pack (Revise#403): one area again — no left / centre / right
      + `<div class="row back bz-${ui.backZ || "L"}"><span class="rl">Control · Back</span>${mine && seat === R.viewer ? backSizeHTML() : ""}<div class="chars" data-area="back">${mine && p.areas.back.length > 1 ? TB.sortBtnHTML(seat, "back") : ""}${p.areas.back.map(id => charHTML(id)).join("")}</div></div>`;
    const ptile = S.stage === "play" || S.stage === "over" || S.stage === "mulligan" ? playerTileHTML(seat) : "", across = ["top", "q1", "q2"].includes(pos);
    const pl = `${pile(seat, "damage", "Damage")}${pile(seat, "deck", "Deck")}${pile(seat, "discard", "Discard")}${p.zones.removed.length ? pile(seat, "removed", "Removed") : ""}`;
    const plAcross = `${p.zones.removed.length ? pile(seat, "removed", "Removed") : ""}${pile(seat, "discard", "Discard")}${pile(seat, "deck", "Deck")}${pile(seat, "damage", "Damage")}`;
    const piles = `<div class="piles">${across ? ptile + plAcross : pl + ptile}</div>`;   // the other players (Pack, Revise#241): on the right, Player · Discard · Deck · Damage from the top
    return `<section class="board ${pos}${turn ? " isturn" : ""}${p.lost ? " out" : ""}" style="--pc:${esc(color)}" data-board="${seat}">${head}<div class="bb"><div class="rows">${rows}</div>${piles}</div></section>`;
  }
  /** Where each player's board goes (Revise#054 / #055). → [[seat, pos]] pos: "bottom" | "top" | "q1" … "q4" */
  TB.positions = (S, me) => {
    const order = S.turn.order.length ? S.turn.order : S.players.map(p => p.seat);
    const n = order.length;
    if (me < 0) me = order[0];
    const i = order.indexOf(me);
    if (n === 1) return [[me, "bottom"]];
    if (n === 2) return [[me, "bottom"], [order[1 - i], "top"]];
    if (n === 3) return [[me, "bottom"], [order[(i + 1) % 3], "q2"], [order[(i + 2) % 3], "q1"]];
    const M = [[["q3", 0], ["q4", 1], ["q1", 2], ["q2", 3]], [["q4", 1], ["q3", 0], ["q1", 2], ["q2", 3]], [["q3", 2], ["q1", 0], ["q2", 1], ["q4", 3]], [["q3", 3], ["q4", 2], ["q2", 0], ["q1", 1]]][i];
    return M.map(([q, k]) => [order[k], q]);
  };

  /* ---------- side panel ---------- */
  function intentLabel(c) {
    const S = R.S;
    const who = t => (t.ch ? nameOf(AA4.topOf(S.chars[t.ch])) : t.seat != null ? S.players[t.seat].name : "");
    switch (c.t) {
      case "declare":
        if (c.kind === "set" && c.asChar) return `Set ${EN(info(S.cards[c.card].key))} as your Controlled Character (pay its cost)`;
        if (c.kind === "set" && c.guardSet) return `Set ${EN(info(S.cards[c.card].key))} as your Controlled Character: it battles the attack (pay its cost)`;
        if (c.kind === "set") { const inf = info(S.cards[c.card].key); if (c.asFast) return `Use ${EN(inf)} as a Fast card`; if (AA4.isInt(c.mode) && inf.play && inf.play.modes) { const mt = inf.play.modes[c.mode].text || ""; const en = AA4.enText(inf, mt) || mt; return `${EN(inf)} — effect ${c.mode + 1}: ${en.length > 70 ? en.slice(0, 70) + "…" : en}`; } return c.asBreak ? (inf.asBreak && inf.asBreak.noRule ? `Declare ${EN(inf)} without its Break condition (${Object.entries(inf.asBreak.factor).map(([f, n]) => f + " " + n).join(", ")} · cost ${inf.asBreak.cost})` : `Declare ${EN(inf)} as a Break card`) : `${inf.type === "Character" ? "Set" : "Declare"} ${EN(inf)}${c.x != null ? ` (X = ${c.x})` : ""}${c.alt === "mill" ? ` — instead of its cost, ${inf.altMill} cards from your deck top → Discard Pile` : ""}${c.alt === "millExtra" ? ` — instead of the extra cost, ${inf.cost} cards from your deck top → Discard Pile (3616)` : ""}`; }
        if (c.kind === "effect") { const ef = AA4.effectsOf(S, db, c.ch, c.card)[c.i], en = AA4.enText(info(S.cards[c.card].key), ef.text); return `${ef.gained ? "Gained effect" : "Effect"} ${ef.cost}${c.x != null && ef.cost === "X" ? ` (X = ${c.x})` : ""}: ${((t => t.length > 160 ? t.slice(0, 159) + "…" : t)((en || ef.text).replace(/^[^:：]*[:：]/, "").trim()))}`; }   // the whole line (it was cut at 60 characters: two effects looked the same)
        if (c.kind === "attack") return `Attack → ${who(c.target)}${c.boost ? ` (Boost ${c.boost})` : ""}`;
        if (c.kind === "guard") return "Guard";
        if (c.kind === "join") return "Join the battle (Synchro)";
        return c.kind;
      case "charge": return c.fromDeck ? "Power card from the deck top" : "Set as a power card";
      case "search": return "Search";
      default: return c.t;
    }
  }
  TB.intentLabel = intentLabel;
  /** Q#43 (Pack, Revise#145): several attacks at once — every attacker vs the characters that may guard; who is resolving, who may still guard */
  /** The battle in four steps (Pack, Revise#187): Attack › Guard › Response › Resolved — pastel red / blue / yellow / green.
      Done = full colour, now = bold with a ring, still to come = faded. Before / after battle and the end count as Resolved. */
  const BSTEP = { guard: 1, response: 2, before: 3, after: 3, end: 3 };
  TB.battleStepsHTML = step => {
    const now = BSTEP[step] == null ? 1 : BSTEP[step];
    return `<div class="bs" role="list" aria-label="Battle steps">${[["atk", "Attack"], ["grd", "Guard"], ["rsp", "Response"], ["res", "Resolved"]].map(([c, l], i) => `<span role="listitem" class="bsx ${c}${i === now ? " on" : i < now ? " done" : ""}"${i === now ? ' aria-current="step"' : ""}>${l}</span>`).join(`<i class="bsa" aria-hidden="true">›</i>`)}</div>`;
  };
  /** Pack (Revise#206): steps for a declaration in Resolve, as the battle has — Effect (orange) / Project · Fast (blue) / Break (blue) › Response (yellow) › Resolve (green) */
  function itemStepsHTML(it, newest) {
    const ty = it.card ? (AA4.cardInfo(R.S, db, it.card) || {}).type : null;
    const first = it.kind === "effect" || it.kind === "ability" ? ["eff", "Effect"] : ty === "Break" || ty === "Permanent" ? ["brk", ty] : ["pf", ty === "Project" || ty === "Fast" ? ty : "Project / Fast"];
    const now = newest && AA4.responseOpen(R.S) ? 1 : 0;
    return `<div class="bs ist" role="list" aria-label="Steps">${[first, ["rsp", "Response"], ["res", "Resolve"]].map(([c, l], i) => `<span role="listitem" class="bsx ${c}${i === now ? " on" : i < now ? " done" : ""}"${i === now ? ' aria-current="step"' : ""}>${esc(l)}</span>`).join(`<i class="bsa" aria-hidden="true">›</i>`)}</div>`;
  }
  function raidHTML() {
    const S = R.S, r = S.raid;
    if (!r) return "";
    const b = S.battle, card = id => S.chars[id] ? AA4.topOf(S.chars[id]) : null;
    const tile = (id, cls, tag) => { const c = card(id); return c ? `<div class="rdc ${cls}">${face(c, "mini")}<span class="rdn">${esc(nameOf(c))}</span><span class="rdt">${esc(tag)}</span></div>` : ""; };
    const atk = r.attackers.map((id, i) => !S.chars[id] ? "" : i < r.current || (i === r.current && !b) ? tile(id, "done", "Resolved") : i === r.current ? tile(id, "now", "Resolving") : tile(id, "next", `Attack ${i + 1}`)).join("");
    const dSeat = r.target.seat != null ? r.target.seat : S.chars[r.target.ch] ? S.chars[r.target.ch].owner : null;
    const inNow = b ? [b.guard].concat(b.joined.grd).filter(Boolean) : [];
    const defs = dSeat == null ? "" : AA4.controlledOf(S, dSeat).map(id => inNow.includes(id) ? tile(id, "guarding", "Guarding") : r.guardsUsed.includes(id) ? tile(id, "used", "Guarded already") : S.chars[id].flags.tapped ? tile(id, "used", "Can't guard") : tile(id, "can", "Can guard")).join("");
    const tgt = r.target.seat != null ? S.players[r.target.seat].name : nameOf(card(r.target.ch));
    return `<div class="raidpop"><div class="rdh">⚔ Several attacks on <b>${esc(tgt)}</b> · ${Math.min(r.current + 1, r.attackers.length)} / ${r.attackers.length}${b ? ` · ${esc({ guard: "Guard", response: "Response", before: "Resolved", after: "Resolved", end: "Resolved" }[b.step] || b.step)}` : ""}</div>`
      + `<div class="rdrow"><div class="rdl">Attacking</div><div class="rdcs">${atk}</div></div><div class="rdvs">vs</div>`
      + `<div class="rdrow"><div class="rdl">${esc(dSeat != null ? S.players[dSeat].name : "")} — may guard once each</div><div class="rdcs">${defs || `<span class="muted">No Controlled Characters</span>`}</div></div></div>`;
  }
  /** What matters for resolving an item (Pack, Revise#162): the card played (Set), the cost cards that go back to the hand. */
  function resolveInfo(it) {
    const S = R.S, out = [];
    if (it.kind === "set" && it.card && S.cards[it.card]) out.push(`<div class="costw rinfo"><span class="rl">Card</span><div class="rcards">${face(it.card, "mini")}</div></div>`);
    if (it.kind === "effect" && it.card && S.cards[it.card]) {   // Pack (Revise#224): the effect's text in the Resolve list
      const inf = info(S.cards[it.card].key), ef = it.ch && S.chars[it.ch] ? (AA4.effectsOf(S, db, it.ch, it.card) || [])[it.i] : null, tj = ef && ef.text;
      if (tj) { const te = AA4.enText(inf, tj); out.push(`<div class="rinfo rtext" title="${esc(tj)}"><span class="rl">Effect</span><div>${esc(te || tj)}</div></div>`); }
    }
    if (it.kind !== "set" && it.ch && S.chars[it.ch] && (it.targets || []).some(t => (t.ch && S.chars[t.ch]) || (t.seat != null && S.players[t.seat]))) {   // Pack (Revise#214): a character's effect — User → Target (a character, or the Player)
      const ut = (img, nm) => `<div class="utc">${img}<small>${esc(nm)}</small></div>`;
      const tg = it.targets.map(t => t.ch && S.chars[t.ch] ? ut(face(AA4.topOf(S.chars[t.ch]), "mini"), nameOf(AA4.topOf(S.chars[t.ch])))
        : t.seat != null && S.players[t.seat] ? ut(`<div class="card mini utp"><img alt="" src="${esc(TB.avatarSrc(S.players[t.seat].avatar || AA4.AVATARS[t.seat % AA4.AVATARS.length]))}"><span class="pname">${esc(S.players[t.seat].name)}</span></div>`, "Player · " + S.players[t.seat].name) : "").join("");
      out.push(`<div class="costw rinfo utw"><span class="rl">User → Target</span><div class="utrow">${ut(face(AA4.topOf(S.chars[it.ch]), "mini"), nameOf(AA4.topOf(S.chars[it.ch])))}<span class="utarr" aria-label="targets">→</span><div class="utts">${tg}</div></div></div>`);
    }
    const back = (it.costTo || []).filter(x => x.to === "hand");
    for (const x of back) {
      const down = /^(Infinity|Offensive|Defensive)$/.test(x.label) && !TB.mySeats().includes(it.seat);   // a skill: face down for the others
      out.push(`<div class="costw paidk rinfo"><span class="rl">Cost → hand${x.label ? " · " + esc(x.label) : ""}</span><div class="rcards">${x.cards.map(id => (down ? `<div class="card back mini" style="${TB.sleeveStyle(S.players[it.seat] && S.players[it.seat].sleeve)}"></div>` : faceKey(S.cards[id] && S.cards[id].key, "mini"))).join("")}</div></div>`);
    }
    if (it.returnCost && it.returnCost.length && !back.length) out.push(`<div class="costw paidk rinfo"><span class="rl">Cost → hand when it resolves</span><div class="rcards">${it.returnCost.map(id => faceKey(S.cards[id] && S.cards[id].key, "mini")).join("")}</div></div>`);
    return out.join("");
  }
  function stackHTML() {
    const S = R.S, items = S.stack.slice().reverse();
    const rows = items.map((it, k) => {
      const nm = it.card ? nameOf(it.card) : it.kind;
      const tg = (it.targets || []).map(t => (t.ch && S.chars[t.ch] ? nameOf(AA4.topOf(S.chars[t.ch])) : t.seat != null ? S.players[t.seat].name : t.card ? nameOf(t.card) : t.field ? "the field" : "")).filter(Boolean).join(", ");
      return `<li class="${k === 0 ? "newest" : ""}${R.tgt.has("item:" + it.id) ? " tgt" : ""}" data-item="${it.id}"><span class="kd">${it.kind === "set" ? "Set" : it.kind === "effect" ? "Effect" : "Ability"}</span> <b>${esc(nm)}</b>`
        + `<span class="by">${esc(S.players[it.seat].name)}${tg ? " → " + esc(tg) : ""}</span>${k === items.length - 1 ? `<span class="main">Main</span>` : ""}${itemStepsHTML(it, k === 0)}${resolveInfo(it)}</li>`;
    }).join("");
    const b = S.battle;
    let battle = "";
    if (b) {
      const nm = id => (id && S.chars[id] ? nameOf(AA4.topOf(S.chars[id])) : "—");
      // Pack (Revise#206): card on the left, Name · Skill · Status on the right — the attacker top-down, the defender bottom-up (Status · Skill · Name); battle skills highlighted
      const BATTLE_SK = new Set(["bind", "initiative", "breakthrough", "stealth", "penetrate", "synchro", "resist", "protect"]);
      const skTxt = (k, v) => (AA4.SKILLS[k] ? AA4.SKILLS[k].en : k) + (typeof v === "number" ? " " + (Math.abs(v) >= 99 ? (v < 0 ? "-" : "+") + "∞" : v) : v && typeof v === "object" && (v.factions || v.icons) ? " (" + [].concat(v.factions || [], v.icons || []).join(" / ") + ")" : "");
      const side = (id, lbl, def) => {
        if (!id || !S.chars[id]) return "";
        const st = AA4.charStats(S, db, id), sks = Object.entries(st.skills || {});
        const name = `<div class="bnm"><small>${lbl}</small> ${esc(nm(id))}</div>`;
        const printed = (db.card(S.cards[AA4.topOf(S.chars[id])].key) || {}).skills || {};
        const skill = sks.length ? `<div class="bsk">${sks.flatMap(([k, v]) => Array.from({ length: TB.skillTimes(st, printed, k, v) }, () => `<span class="${BATTLE_SK.has(k) ? "bsx-on" : ""}">${esc(skTxt(k, v))}</span>`)).join("")}</div>` : "";
        const status = `<div class="bst"><b>${st.se == null ? "–" : st.se}/${AA4.atkText(st)}/${st.de}</b> <small>P${S.chars[id].power.length}</small></div>`;
        return `<div class="bside${def ? " def" : " att"}"><figure class="bpic">${face(AA4.topOf(S.chars[id]), "mini")}</figure><div class="binfo">${def ? status + skill + name : name + skill + status}</div></div>`;
      };
      battle = `<div class="battle"><div class="bt">⚔ ${esc(nm(b.attacker))} → ${esc(b.target.ch ? nm(b.target.ch) : S.players[b.target.seat].name)}${b.kind === "faction" ? " · faction check" : ""}${b.boost ? ` · Boost ${b.boost}` : ""}</div>`
        + TB.battleStepsHTML(b.step)
        + `<div class="bpics">${side(b.attacker, "Attacker", false)}${b.guard ? `<span class="bvs">vs</span>${side(b.guard, "Guard", true)}` : b.target.ch ? `<span class="bvs">vs</span>${side(b.target.ch, "Target", true)}` : ""}</div></div>`;   // the attacker and the guard, not the costs (Pack, Revise#162)
    }
    const now = AA4.priorityNow(S), need = AA4.needPass(S);
    const passInfo = AA4.responseOpen(S) ? `<div class="prio">${need.map(s => `<span class="${S.passed.includes(s) ? "done" : s === now ? "now" : ""}">${esc(S.players[s].name)}${S.passed.includes(s) ? " ✓" : s === now ? " …" : ""}</span>`).join("")}</div>` : "";
    const cost = S.players.flatMap(p => p.zones.cost.map(id => face(id, "mini"))).join("");
    // the newest at the top (Pack, Revise#162): the declarations answering the battle, newest first, then the battle itself
    return `${passInfo}${rows ? `<ol class="stack">${rows}</ol>` : battle ? "" : `<div class="muted">Nothing is waiting.</div>`}${battle}${cost ? `<div class="costw"><span class="rl">Cost screen</span>${cost}</div>` : ""}`;   // "Last battle" removed from Resolve (Pack, Revise#162)
  }
  function actionsHTML() {
    const S = R.S, me = R.viewer, out = [];
    if (me < 0) return `<div class="muted">Watching</div>`;
    const has = t => R.cands.find(c => c.t === t);
    const d = S.draft;
    if (d && d.seat === me) {
      const what = d.kind === "set" ? nameOf(d.card) : d.kind === "effect" ? `effect of ${nameOf(d.card)}` : d.kind;
      if (d.step === "pay") {
        const n = (ui.sel && ui.sel.picked || []).length;
        out.push(d.cost == null ? `<div class="hint">Cost <b>X</b> for ${esc(what)}: pay any number of power cards — X = the number paid (${n} chosen)</div>`
          : `<div class="hint">Pay <b>${d.cost}</b>${d.xMode === "def" ? ` (X = ${d.x})` : ""} for ${esc(what)}: choose the power cards in the pop-up or on the field (${n}/${d.cost})</div>`);
      } else if (d.step === "target") {
        const n = AA4.draftCount(d);
        const part = d.spec.kind === "multi" ? ` — target ${Math.min((ui.sel && ui.sel.picked || []).length + 1, n)} of ${n}` : "";
        out.push(`<div class="hint thint">${d.card && S.cards[d.card] ? face(d.card, "mini") : ""}<span>Choose ${d.spec.upTo ? "up to " : ""}${n} target${n > 1 ? "s" : ""} for ${esc(what)} (blue border)${part}${d.xMode === "def" && d.cost == null ? " — X comes from the target, then you pay X" : ""}</span></div>`);   // the card being declared beside it (Pack, Revise#207)
        if (R.tgt.has("field")) out.push(`<button class="btn" data-act="tfield">Set it directly to the field</button>`);
        if (n > 1) out.push(`<button class="btn pri" data-act="target">Choose (${(ui.sel && ui.sel.picked || []).length})</button>`);
      }
      out.push(`<button class="btn" data-act="cancel">Cancel (refund)</button>`);
      return out.join("");
    }
    if (ui.sel && ui.sel.kind === "atkChar" && R.S.chars[ui.sel.ch]) out.push(`<div class="hint" id="atkCharHint">Targeting attack: click the character that ${esc(nameOf(AA4.topOf(R.S.chars[ui.sel.ch])))} attacks (in blue) <button class="btn sm" data-act="unsel">Cancel</button></div>`);
    if (ui.sel && ui.sel.kind === "bhPlace") out.push(`<div class="hint">By hand: click the character to put ${esc(nameOf(ui.sel.card))} on as ${{ stack: "a Break card", perm: "a Permanent", power: "a power card" }[ui.sel.role]} <button class="btn sm" data-act="unsel">Cancel</button></div>`);
    if (R.charge.on) out.push(`<div class="hint">Charge Phase: pick cards from your hand or Deck (⚡ ${R.charge.deckLeft} left from the deck) — they wait in the Charge window — then click a highlighted character for each.</div>`);
    if (S.stage === "mulligan") {
      if (!S.players[me].ready) { const pm = S.players[me], hc = AA4.openingHandCheck(S, db, me);
        out.push(`<div class="hint">Opening hand</div><button class="btn pri" data-act="keep">Keep hand</button><button class="btn" data-act="mulligan">Re-shuffle${pm.mulligans ? ` <span class="badge">${pm.mulligans}</span>` : ""}</button>`
          + `<button class="btn amull" data-act="autoMulligan" title="Re-shuffle up to ${AA4.AUTO_MULL_MAX} times until the hand has: Character cards ≥ 3 · a Character with Draw · a Character with Charge and an effect that returns its cost to the hand">Auto Re-shuffle${pm.autoMulls ? ` <span class="badge">${pm.autoMulls}</span>` : ""}</button>`
          + `<div class="hcheck${hc.ok ? " ok" : ""}" title="What Auto Re-shuffle looks for"><span class="${hc.chars >= 3 ? "y" : "n"}">Character ${hc.chars}/3</span><span class="${hc.draw ? "y" : "n"}">Draw ${hc.draw}/1</span><span class="${hc.chargeBack ? "y" : "n"}">Charge + effect cost back ${hc.chargeBack}/1</span>${hc.main ? `<span class="${hc.mainN ? "y" : "n"}" title="The deck's Main Factor: the faction its Name-level cards ask for most">Main Factor (${esc(hc.main)}) ${hc.mainN}/1</span>` : ""}</div>`); }
      else out.push(`<div class="muted">Waiting for the other players' opening hands</div>`);
    }
    if (S.battle && S.battle.step === "guard" && S.battle.defender === me) out.push(`<div class="hint">You are attacked: click a Controlled Character to guard, or</div>`);
    if (has("noGuard")) out.push(`<button class="btn" data-act="noGuard">No guard</button>`);
    if (has("pass")) {   // the last pass the window waits for resolves it: the button says so (Pack, Revise#207)
      const need = AA4.needPass(S), mine = TB.mySeats(), last = need.filter(x => !S.passed.includes(x)).every(x => mine.includes(x)) && need.filter(x => !S.passed.includes(x)).length === 1;
      out.push(`<button class="btn pri${last ? " resolvebtn" : ""}" data-act="pass"${last ? ' title="You are the last to pass: the newest declaration resolves"' : ""}>${last ? "Resolve" : S.stack.length ? "No response (pass)" : "Pass"}</button>`);
    }
    if (S.stack.length && TB.mySeats().some(x => AA4.needPass(S).includes(x) && !S.passed.includes(x))) out.push(ui.passAll ? `<button class="btn" data-act="passAllOff" title="Stop passing automatically">Pass All: on (${S.stack.filter(it => ui.passAll.includes(it.id)).length} left) — stop</button>` : `<button class="btn" data-act="passAll" title="Pass on every item now on the Resolve list (stops when a new declaration is added)">Pass All (${S.stack.length})</button>`);
    if (S.stage === "play" && S.turn.player === me) {
      const why = AA4.check(S, { t: "next", by: ui.cid, seat: me }, db);
      out.push(`<button class="btn next" data-act="next"${why ? ` disabled title="${esc(why)}"` : ""}>Next ▸ ${esc(PHASE[{ active: "main", main: "charge", charge: "discard" }[S.turn.phase]] || "")}</button>`);
    }
    if (S.stage === "lobby" && ui.kind !== "solo") out.push(`<button class="btn sm" data-act="invite">Copy invite link</button>`);
    if (S.stage === "lobby" && S.creator === ui.cid && S.mode === "online") out.push(`<div class="hint">Room code <b class="code">${esc(ui.room)}</b> — ${S.players.length}/${S.seatsWanted} players</div><button class="btn" data-act="startNow"${S.players.length >= 2 ? "" : " disabled"}>Start with the players here</button>`);
    else if (S.stage === "lobby") out.push(`<div class="hint">Room <b class="code">${esc(ui.room)}</b>: waiting for players (${S.players.length}/${S.seatsWanted})</div>`);
    if (S.stage === "over") out.push(`<div class="hint big">${S.winner != null ? `🏆 ${esc(S.players[S.winner].name)} wins` : "The game is over"}</div>`);
    return out.join("");
  }
  function statusHTML() {
    const S = R.S, me = R.viewer;
    if (S.stage !== "play") return `<b>${{ lobby: "Waiting for players", mulligan: "Opening hands", over: "Game over" }[S.stage]}</b>`;
    const a = TB.actingSeat(S), tp = S.turn.player;
    const col = seat => (ui.colors.seats && ui.colors.seats[ui.room + ":" + seat]) || (seat === me || (me < 0 && S.turn.order.indexOf(seat) === 0) ? ui.colors.me : ui.colors.opp);
    // the phase first and biggest (Pack), then turn number and turn player, each in its own colour
    const steps = ["draw", "active", "main", "charge", "discard"].map(ph => `<span class="${ph === S.turn.phase ? "on" : ""}">${esc((PHASE[ph] || ph).replace(/ Phase$/, ""))}</span>`).join("");
    return `<div class="tph ph-${S.turn.phase} ${tp === me ? "tmine" : "topp"}"><span class="tphn">${esc(PHASE[S.turn.phase] || "")}</span><span class="tphs">${steps}</span></div>`
      + `<div class="tmeta"><span class="tno">Turn ${S.turn.number}</span><span class="tpl" style="--pc:${esc(col(tp))}">${esc(S.players[tp].name)}${tp === me ? " (you)" : ""}</span></div>`
      + `<div class="${a === me ? "yours" : "wait"}">${a === me ? "▶ Your move" : "Waiting for " + esc(S.players[a].name)}</div>`;
  }
  function fieldHTML() {
    const S = R.S, mods = S.modifiers;
    const UNTIL = { battle: "this battle", main: "main phase", turn: "this turn", removed: "until removed", source: "while on the field", charge: "Charge Phase", nextTurn: "next turn", seatTurn: "their next turn" };
    const list = AA4.modGroups(S, db).map(r => `<li data-src="${esc(r.src.card || "")}"${r.textEn ? ` title="${esc(r.textEn)}"` : ""}><span>${esc(r.src.label || "")}</span> ${esc(r.type)}${r.target ? ` <b class="fxto">to ${esc(r.target)}</b>` : ""}<i>${esc(UNTIL[r.until] || "")}</i><button class="mini" data-act="fieldEnd" data-ids="${esc(r.mods.map(m => m.id).join(","))}" title="End it">−</button></li>`).join("");   // "[EFFECT TYPE] to [TARGET]" (Pack, Revise#182)
    // Pack (Revise#230): wide-scale always-on abilities of cards on the field (players, every card of a kind, the field) are Field Effects too
    const wide = AA4.modGroups(S, db, AA4.wideMods(S, db)), on = r => r.mods.some(m => AA4.modOn(S, db, m));
    const wlist = wide.map(r => `<li class="fxcard${on(r) ? "" : " off"}" data-src="${esc(r.src.card || "")}"${r.textEn ? ` title="${esc(r.textEn)}"` : ""}><span>${esc(r.src.label || "")}</span> ${esc(r.type)}${r.target ? ` <b class="fxto">to ${esc(r.target)}</b>` : ""}<i>${on(r) ? "while on the field" : "not now (its condition)"}</i>${r.textEn ? `<small class="fxtxt">${esc(r.textEn)}</small>` : ""}</li>`).join("");
    const n = AA4.modGroups(S, db).length + wide.length;
    return `<details class="fx"${ui.fxOpen ? " open" : ""}><summary>Field effects <span class="badge">${n}</span></summary><ul>${list}${wlist}${list || wlist ? "" : `<li class="muted">None</li>`}</ul><button class="btn sm" data-act="fieldAdd">+ Add by hand</button></details>`;
  }
  /** Export Log (Pack, Revise#157): every log line this viewer may see, as plain text */
  /** Log lines {t, hand}: hand = done "By hand" (a by-hand intent, or a ✋ By hand step) — pastel orange in the log (Pack, Revise#161). */
  const BY_HAND = new Set(["move", "moveChar", "shuffle", "draw", "deckLook", "field", "fieldEnd", "selfDamage"]);
  /** Pack (Revise#206): a background per kind of log line — attack, defense, resolve, effect, draw, charge, damage, warning, others */
  const LOG_CAT = { attacked: "atk", battleStart: "atk", battle: "atk", battleEnd: "atk", battleOver: "atk", attackEnded: "atk", raidDeclared: "atk", raidOver: "atk", factionCheckDone: "atk",
    guarded: "def", noGuard: "def", joined: "def",
    resolving: "res", resolved: "res", entered: "res", broke: "res",
    effect: "eff", triggerRun: "eff", modAdded: "eff", modEnded: "eff", situation: "oth",
    drew: "drw", redrew: "drw",
    charged: "chg", chargeSet: "chg", unCharged: "chg",
    damaged: "dmg", playerDamage: "dmg", byHandDamage: "dmg", defeated: "dmg",
    note: "warn", setFailed: "warn", effectCancelled: "warn", declarationCancelled: "warn", attackCancelled: "warn", guardCancelled: "warn", itemCancelled: "warn", deckOut: "warn", lost: "warn", turnLock: "warn", unstuck: "warn", foolNote: "warn" };
  const logCat = ev => ev.e === "declared" ? (ev.kind === "attack" ? "atk" : ev.kind === "guard" ? "def" : "eff") : ev.e === "rule" && /^outlaw/.test(ev.key || "") ? "out" : LOG_CAT[ev.e] || "oth";
  function logLines() {
    const V = R.V, out = [], ents = ui.log.entries || [];
    for (const ev of AA4.projectEvents(ui.log.events(), R.viewer)) {
      const t = AA4.describe(ev, V, db, R.viewer);
      if (t) { const cat = logCat(ev), hand = /^✋ By hand/.test(t) || ev.e === "manual" || ev.e === "byHandDamage" || (ents[ev.ix] && BY_HAND.has(ents[ev.ix].t)); out.push({ t: (cat === "warn" || hand) && !/^[!⚠]/.test(t) ? "! " + t : t, cat, hand }); }   // "!" in front of warnings and of By hand lines (Pack, Revise#223)
    }
    return out;
  }
  const lineCls = l => (/^⚠ OUTLAW/.test(l.t) ? ' class="lgout"' : ` class="lc-${l.cat || "oth"}${l.hand ? " lghand" : ""}"${l.hand ? ' title="By hand"' : ""}`);
  TB.logText = () => {
    const out = logLines().map(l => (l.hand && !/^✋/.test(l.t) ? "✋ " : "") + l.t);
    const S = R.S, names = (S.players || []).map((p, i) => `P${i + 1} ${p.name || ""}`.trim()).join(" / ");
    return `Aquarian Age — Game Table log\nExported: ${new Date().toLocaleString()}\nPlayers: ${names}\nTurn: ${S.turn ? S.turn.number : "-"}\n\n` + out.map((l, i) => `${String(i + 1).padStart(4, " ")}  ${l}`).join("\n") + "\n";
  };
  /* ---------- Replay (Pack, Revise#160) ---------- */
  function replayBarHTML() {
    const R0 = ui.replay, S = R.S, n = R0.all.length, sp = [0.5, 1, 1.5, 2, 3];
    const seats = (R0.seats || S.players.map(p => p.seat)).filter(x => S.players[x]);
    const last = R0.i ? R0.all[R0.i - 1] : null, who = last && S.players.find(p => p.cid === last.by);
    // phones (Pack, Revise#312): a slim bar at the bottom — ⋯ opens Speed / View / Log / Close; ▾ folds it to a small button
    if (ui.rpMin) return `<div class="rpbar min" id="rpbar">${R0.playing ? `<button class="btn sm pri" data-act="rpPause">⏸</button>` : `<button class="btn sm pri" data-act="rpPlay">▶</button>`}<span class="rpn">${R0.i} / ${n}</span><button class="btn sm" data-act="rpMin" title="Show the replay controls">▴</button></div>`;
    return `<div class="rpbar${ui.rpMore ? " more" : ""}" id="rpbar"><b class="rpt">▶ Replay${R0.name ? " · " + esc(R0.name) : ""}</b><button class="btn sm rpfold" data-act="rpMin" title="Fold the replay controls">▾</button><button class="btn sm rpmorebtn${ui.rpMore ? " on" : ""}" data-act="rpMore" title="Speed, view, log, close">⋯</button>
      <span class="rpbtns"><button class="btn sm" data-act="rpSeek" data-i="0" title="From the start">⏮</button><button class="btn sm" data-act="rpStep" data-d="-1" title="One step back">◀</button>${R0.playing ? `<button class="btn sm pri" data-act="rpPause">⏸ Pause</button>` : `<button class="btn sm pri" data-act="rpPlay">▶ Play</button>`}<button class="btn sm" data-act="rpStep" data-d="1" title="One step">▶|</button><button class="btn sm" data-act="rpSeek" data-i="${n}" title="To the end">⏭</button></span>
      <input type="range" id="rpSeek" min="${R0.first || 0}" max="${n}" value="${R0.i}"><span class="rpn">Step ${R0.i} / ${n}${last ? ` · ${esc(who ? who.name : "")} ${esc(last.t)}` : ""}</span>
      <span class="rpsp rpx">Speed ${sp.map(v => `<button class="btn sm${R0.speed === v ? " on" : ""}" data-act="rpSpeed" data-v="${v}">${v}×</button>`).join("")}</span>
      <span class="rpvw rpx">View ${seats.map(x => `<button class="btn sm${R0.view === x ? " on" : ""}" data-act="rpView" data-v="${x}">${esc(S.players[x].name || "P" + (x + 1))}</button>`).join("")}${R0.allowAll ? `<button class="btn sm${R0.view === "all" ? " on" : ""}" data-act="rpView" data-v="all" title="Every card face up">All open</button>` : ""}</span>
      <span class="rpx"><button class="btn sm${R0.logOpen ? " on" : ""}" data-act="rpLog">Replay log</button><button class="btn sm" data-act="rpClose">Close replay</button></span></div>`;
  }
  function replayLogHTML() {
    const lines = logLines();
    return `<div class="rplog" id="rplog"><div class="rph"><b>Replay log</b> <span class="muted">${lines.length} lines · step ${ui.replay.i} / ${ui.replay.all.length}</span><button class="mini" data-act="rpLog" title="Close">✕</button></div>
      <div class="rplines" id="rpLines">${lines.map((l, i) => `<div${lineCls(l)}><i>${i + 1}</i> ${esc(l.t)}</div>`).join("")}</div></div>`;
  }
  function logHTML() {
    const S = R.S, lines = logLines();
    const last = lines.slice(-150);
    return `<details class="log"${ui.logOpen ? " open" : ""}><summary><span class="lgt">Log</span>${ui.replay ? "" : `<button class="mini lgexp lgsave" data-act="rpSave" title="Save a replay file (.json) — it holds the hidden cards, so share it after the game">Save replay</button>`}</summary><div class="lines" id="logLines">${last.map(l => `<div${lineCls(l)}>${esc(l.t)}</div>`).join("")}</div>`
      + `<form class="chat" data-act="chat"><input id="chatIn" maxlength="300" placeholder="Chat…" autocomplete="off"><button class="btn sm">Send</button></form></details>`;
    void S;
  }
  /** Take control (Pack, Revise#117): a watcher may take the seat of a player who gave no command for 30 s. */
  /** Take control (Pack, Revise#128): a button at the right of every other player's tab, dimmed until the game has waited
      30 s for that player; then anyone — watcher or player — may press it once. The 30 s start again after it is taken. */
  function takeBtn(seat) {
    const S = R.S;
    if (S.mode !== "online" || S.stage !== "play" || S.lastTs == null || !S.players[seat] || S.players[seat].lost || S.players[seat].cid === ui.cid) return "";
    const acting = AA4.actingSeat(S) === seat, left = Math.ceil((S.lastTs + AA4.TAKE_AFTER - Date.now()) / 1000);
    const can = acting && left <= 0 && ui.tookAt !== S.lastTs;
    const tip = can ? `Take control of ${S.players[seat].name}: you play this seat from now on` : acting ? `Waiting for ${S.players[seat].name} — Take control in ${Math.max(0, left)} s` : `Take control works when the game has waited 30 s for ${S.players[seat].name}`;
    return `<button class="mini takebtn${can ? " on" : ""}" data-act="takeControl" data-seat="${seat}"${can ? "" : " disabled"} title="${esc(tip)}">⇄ Take control${acting && !can && left > 0 ? ` <span class="tl">${left}s</span>` : ""}</button>`;
  }
  function takeHTML() { return ""; }   // moved to the player tabs (Revise#128)
  function controlsHTML() {
    const S = R.S, mine = TB.mySeats(), me = R.viewer;
    const u = ui.log.undoTarget(ui.cid) >= 0, r = ui.log.redoTarget(ui.cid) >= 0;
    const pu = ui.log.pendingUndo;
    let ask = "";
    if (pu) {   // an undo waiting for the other players (Pack, Revise#112)
      const who = AA4.seatFor(S, { by: pu.by }), left = pu.voters.filter(s => !pu.agreed.includes(s)), mayNow = S.rules.respond === "together" ? left : left.slice(0, 1);
      const name = s => esc(S.players[s] ? S.players[s].name : "?");
      ask = mayNow.includes(me) ? `<span class="undoask muted">Undo asked by ${name(who)} — answer in the pop-up</span>`   // the Agree / Refuse choice is an event pop-up now (Pack, Revise#162)
        : `<span class="undoask muted">Undo asked by ${name(who)} — waiting for ${left.map(name).join(", ")}</span>`;
    }
    return `<div class="ctl top"><button class="btn sm" data-act="undo"${u ? "" : " disabled"} title="Undo">↶<span class="bl"> Undo</span></button><button class="btn sm" data-act="redo"${r ? "" : " disabled"} title="Redo">↷<span class="bl"> Redo</span></button>${ask}`
      + `<button class="btn sm phonly${ui.opts.phoneFit === false ? "" : " on"}" data-act="phoneFit" title="Fit the field to the screen width (phone)" aria-pressed="${ui.opts.phoneFit !== false}">⤢<span class="bl"> Fit</span></button>`   // phone layout (Pack, Revise#280)
      + (() => {   // Player options (Pack, Revise#178): a right side bar — Size, Hold and Game Situation share one tab
          const playing = me >= 0 && S.stage === "play", sit = playing && AA4.situationOf(S);
          return `<button class="btn sm optbtn${ui.optsOpen ? " on" : ""}" data-act="optsMenu" aria-expanded="${!!ui.optsOpen}" aria-controls="optDrawer" title="Player options: card size, Hold / Game Situation and more">⚙<span class="bl"> Player options</span></button>`; })()   // no summary on the button (Pack, Revise#232)
      + (me >= 0 && S.stage === "play" ? `<button class="btn sm optbtn${ui.gameOpen ? " on" : ""}" data-act="gameMenu" aria-expanded="${!!ui.gameOpen}" aria-controls="gameDrawer" title="Game options: Global Undo/Redo, Game Situation, Outlaw (table rules)">⚑<span class="bl"> Game options</span></button>` : "")   // Revise#190
      + (mine.length > 1 ? `<button class="btn sm" data-act="view" title="Solo two decks: whose side is shown">View: ${esc(S.players[me].name)}</button>` : "")
      + `<button class="btn sm" data-act="leave" title="Leave">⏏<span class="bl"> Leave</span></button>`
      + (me >= 0 && S.stage === "play" && AA4.situationOf(S) ? `<div class="ctlsit" aria-label="Game Situation">${situationBarHTML(S)}${helpQ(sitHelp(S), "Game Situation")}</div>` : "") + `</div>`;   // Game Situation: one row under the option buttons (Pack, Revise#207)
  }

  /** Your power cards now (Pack): on Controlled Characters (they pay costs) — and all of them when some sit on Active Characters. */
  /** Pack (Revise#306): the factors this player controls, as faction icons with numbers (in the hand bar). */
  const FAC_IMG = { "E.G.O.": "ego", Arayashiki: "arayashiki", "WIZ-DOM": "wizdom", Darklore: "darklore", "Polestar Empire": "polestar", Eraser: "eraser" };
  function factorsNow(seat) {
    if (!AA4.factorsHave) return "";
    const f = AA4.factorsHave(R.S, db, seat), list = Object.entries(f).filter(([, n]) => n > 0);
    return `<span class="facnow" title="Factors you control now: ${esc(Object.entries(f).map(([k, n]) => k + " " + n).join(" · "))}">${list.length ? list.map(([k, n]) => `<span class="fn"><img src="factions/${FAC_IMG[k]}.png" alt="${esc(k)}"><b>${n}</b></span>`).join("") : `<span class="fn none">no factor</span>`}</span>`;
  }
  function powerNow(seat) {
    const S = R.S, chs = AA4.charsOf(S, seat), all = chs.reduce((n, id) => n + S.chars[id].power.length, 0);
    const usable = chs.filter(id => AA4.isControlled(S.chars[id])).reduce((n, id) => n + S.chars[id].power.length, 0);
    const pend = (S.pendingPower || []).filter(x => x.seat === seat).length;
    return `<span class="pwnow" title="Power cards on your Controlled Characters (they pay costs)${all !== usable ? ` · ${all} in all, with the Active Area` : ""}${pend ? ` · ${pend} pending` : ""}">⚡ Power <b>${usable}</b>${all !== usable ? `<small> / ${all} in all</small>` : ""}${pend ? `<small class="pendt"> · ${pend} pending</small>` : ""}</span>`;
  }

  /* ---------- hand ---------- */
  function handHTML() {
    const me = R.viewer;
    if (me < 0 || !R.V.players[me]) return "";
    const p = R.V.players[me], S = R.S, lim = S.stage === "play" ? AA4.playerStats(S, db, me).handLimit : AA4.HAND_LIMIT;
    const cards = p.zones.hand.map(id => {
      const can = (R.byCard.get(id) || []).length > 0 || (R.charge.on && R.charge.targets.length > 0);
      const sel = R.charge.on && R.charge.q.some(x => x.card === id);
      return face(id, (can ? "play" : "") + (sel ? " picked queued" : ""));
    }).join("");
    return `<div class="hand${ui.handFold ? " fold" : ""}${ui.handBig ? " big" : ""}${ui.handDock ? " dock" : ""} hz-${ui.handZ || "L"}" id="hand"><div class="hh" id="handHead"><b>Hand</b> ${p.zones.hand.length} / limit ${lim >= 99 ? "∞" : lim}${powerNow(me)}${factorsNow(me)}<span class="hbtns">${p.zones.hand.length > 1 && !ui.replay ? `<button class="mini ic hsort" data-act="handSort" title="Sort the hand: faction → Mental low to high → cost low to high → Factor low to high → Character · Break · Permanent · Fast · Project" aria-label="Sort the hand"><svg viewBox="0 0 16 16" aria-hidden="true" width="13" height="13"><path d="M5 13V3M2.5 5.5 5 3l2.5 2.5M11 3v10M8.5 10.5 11 13l2.5-2.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : ""}<button class="mini ic" data-act="fold" title="${ui.handFold ? "Show the hand" : "Fold the hand"}" aria-label="${ui.handFold ? "Show the hand" : "Fold the hand"}">${ui.handFold ? "▴" : "▾"}</button>${TB.stuckNow() ? `<button class="mini ic stuckbtn" data-act="stuck" title="Nothing has happened for 30 s — show the stuck log (what the game is waiting for)" aria-label="Show the stuck log">⚡</button>` : ""}<button class="mini ic hdock${ui.handDock ? " on" : ""}" data-act="handDock" aria-pressed="${ui.handDock ? "true" : "false"}" title="${ui.handDock ? "Fixed hand: ON — the hand stays at the bottom of the field. Click to let it float again" : "Fixed hand: keep the hand at the bottom of the field"}" aria-label="Fixed hand position">📌</button><button class="mini ic" data-act="handBig" title="${ui.handBig ? "Shrink the hand" : "Expand: show every card of the hand at once"}" aria-label="${ui.handBig ? "Shrink" : "Expand"}">${ui.handBig ? "⤡" : "⤢"}</button></span></div>${ui.handFold ? "" : `<div class="bzbar hzbar" title="Hand card size: S 0.5× · M 0.8× · L 1×"><b>L</b><input type="range" class="bzr" id="handZ" min="0" max="2" step="1" value="${["S", "M", "L"].indexOf(ui.handZ || "L")}" aria-label="Hand card size (S, M, L)" aria-valuetext="${ui.handZ || "L"}"><b>S</b><span class="bzv">${ui.handZ || "L"}</span></div>`}<div class="hc" id="handCards">${cards || `<span class="card hempty">No cards</span>`}</div>${chargeWindowHTML()}</div>`;   // Pack (Revise#224): the title bar is the top of the hand (drag it); the Charge window is part of the hand, at the bottom
  }

  /* ---------- Charge window (as v3) ---------- */
  function chargeWindowHTML() {
    const c = R.charge;
    if (!c.on) return "";
    const P = R.V.players[R.viewer];
    const cards = c.q.map((x, i) => x.s === "h"
      ? `<button class="cwc${i === 0 ? " next" : ""}" data-cq="${i}" title="From the hand: ${esc(nameOf(x.card))} — click to take it back">${thumb(x.card, "cwi")}<span>${i === 0 ? "Next · " : ""}Hand</span></button>`
      : `<button class="cwc${i === 0 ? " next" : ""}" data-cq="${i}" title="From the deck (face down) — click to take it back"><span class="cwi down" style="${TB.sleeveStyle(P.sleeve)}"></span><span>${i === 0 ? "Next · " : ""}Deck</span></button>`).join("");
    // its own fold, separate from the hand (Pack): collapsed by default — the header still shows what waits
    const fold = ui.chargeFold !== false;
    const head = `<div class="cwh">⚡ Charge window <span class="muted">${c.q.length} card${c.q.length === 1 ? "" : "s"}${c.q.length ? ` (next: ${c.q[0].s === "h" ? esc(nameOf(c.q[0].card)) : "from the deck"})` : ""} · Deck ⚡ ${c.deckLeft} left of ${c.deckMax}</span><button class="mini" data-act="chargeFold">${fold ? "▴ Show" : "▾ Fold"}</button></div>`;
    if (fold) return `<div class="chargew fold" id="chargew">${head}</div>`;
    // Pack (Revise#224): the cards already charged this phase, in the window too — face up when you may see them (from the hand, or "チャージの効果でセットするカードの内容を見ることができる", A3-18 2466)
    const done = (R.S.pendingPower || []).filter(x => x.seat === R.viewer);
    const doneRow = done.length ? `<div class="cwdone"><span class="rl">Charged (pending)</span>${done.map(x => `<span class="cwc done" title="${R.V.cards[x.card] && R.V.cards[x.card].key ? esc(nameOf(x.card)) : "Face down"} → ${esc(R.S.chars[x.ch] ? nameOf(AA4.topOf(R.S.chars[x.ch])) : "")}">${thumb(x.card, "cwi")}<span>${x.fromDeck ? "Deck" : "Hand"}</span></span>`).join("")}</div>` : "";
    return `<div class="chargew" id="chargew">${head}
      <div class="cwb">${cards || `<span class="muted">Click cards in your hand (face up) or your Deck (face down, up to the Charge total) to put them here.</span>`}</div>${doneRow}
      ${(R.S.pendingPower || []).length ? `<div class="muted cwn">${R.S.pendingPower.length} charged card${R.S.pendingPower.length === 1 ? " is" : "s are"} <b class="pendt">pending</b> (yellow) until the Charge Phase ends — click one to take it back.</div>` : ""}
      ${c.q.length ? `<div class="muted cwn">Click a highlighted character to set the <b>next</b> card. ${c.targets.length ? "" : "No character can take a power card now."}</div><div class="mf"><button class="btn sm" data-act="cwClear">Clear</button></div>` : ""}</div>`;
  }

  /* ---------- Pay pop-up (Revise#083): power cards to choose from when there are more than the cost ---------- */
  function payHTML() {
    const S = R.S, d = S.draft;
    if (!d || d.step !== "pay" || !TB.mySeats().includes(d.seat) || d.seat !== R.viewer) return "";
    const picked = new Set(ui.sel && ui.sel.picked || []), sacSel = (ui.sel && ui.sel.sac) || [], hbSel = (ui.sel && ui.sel.hb) || [], n = picked.size + sacSel.length + hbSel.length;
    const ex = AA4.payExtras(S, TB.db, d);   // Revise#137: discard characters / hand cards instead
    const exRow = (ex.sac.length ? `<div class="payalt"><div class="rl">Or discard Controlled Characters (1 cost each)</div><div class="opts">${ex.sac.map(id => thumb(id, "payc" + (sacSel.includes(id) ? " picked" : ""), `data-act="paySac" data-id="${id}"`)).join("")}</div></div>` : "")
      + (ex.hand ? `<div class="payalt"><div class="rl">${esc(ex.handLabel || "Or discard hand cards for the Boost")} (up to ${ex.hand})</div><div class="opts">${(ex.handIds || S.players[d.seat].zones.hand).map(id => thumb(id, "payc" + (hbSel.includes(id) ? " picked" : ""), `data-act="payHand" data-id="${id}"`)).join("")}</div></div>` : "");
    const what = d.kind === "set" ? nameOf(d.card) : d.kind === "effect" ? `the effect of ${nameOf(d.card)}` : d.kind === "attack" ? `the attack of ${nameOf(AA4.topOf(S.chars[d.ch]))}` : d.kind === "guard" ? `the guard of ${nameOf(AA4.topOf(S.chars[d.ch]))}` : d.kind;
    const groups = d.payFrom.filter(ch => S.chars[ch] && S.chars[ch].power.length).map(ch => `<div class="payg"><div class="rl">${esc(nameOf(AA4.topOf(S.chars[ch])))} · ${S.chars[ch].power.length} power</div><div class="opts">${S.chars[ch].power.map(id => thumb(id, "payc" + (picked.has(id) ? " picked" : ""), `data-paycard="${id}"`)).join("")}</div></div>`).join("");
    const free = d.cost == null, ok = free ? n >= 1 : n === d.cost;
    const alts = AA4.altPays(S, TB.db, d);   // Revise#129: pay with a hand card / a Permanent instead
    const altRow = alts.length ? `<div class="payalt"><div class="rl">Or instead</div>${alts.includes("hand") ? `<div class="opts">${S.players[d.seat].zones.hand.map(id => thumb(id, "payc", `data-act="payAlt" data-alt="hand" data-id="${id}" title="Put this hand card into your Damage Pile instead of paying"`)).join("")}</div><div class="muted">Click a hand card: it goes to your Damage Pile and the cost counts as paid.</div>` : ""}${alts.includes("deck2") ? `<div class="opts"><button class="btn sm" data-act="payAlt" data-alt="deck2" data-id="">Top 2 cards of your Deck → Damage Pile</button></div><div class="muted">Instead of paying: the top 2 cards of your Deck go to your Damage Pile.</div>` : ""}${alts.includes("discTop") ? `<div class="opts"><button class="btn sm" data-act="payAlt" data-alt="discTop" data-id="">Top card of your Discard Pile → top of your Deck</button></div><div class="muted">Instead of paying (A3-08 1255 / 1258): then that Permanent goes back to your hand.</div>` : ""}${alts.includes("perm") ? `<div class="opts">${AA4.altPermCards(S, TB.db, d).map(id => thumb(id, "payc", `data-act="payAlt" data-alt="perm" data-id="${id}" title="Pay with this Permanent instead"`)).join("")}</div><div class="muted">Click a Permanent on it: it is paid instead of the power cards.</div>` : ""}</div>` : "";
    const head = free ? `Pay X for ${esc(what)}` : `Pay ${d.cost}${d.xMode === "def" ? ` (X = ${d.x}, from the card text)` : ""} for ${esc(what)}`;
    const count = free ? `${n} chosen → X = ${n}` : `${n} / ${d.cost} chosen`;
    const btns = `<span><button class="btn sm sw2${ui.opts.payOnPick ? " on" : ""}" data-act="optPayOnPick" title="Pay as soon as the picked cards = the cost">Auto Pay after Cost Selection: ${ui.opts.payOnPick ? "ON" : "OFF"}</button>${free ? "" : `<button class="btn sm" data-act="payAuto">Auto pick</button>`}<button class="btn sm" data-act="cancel">Cancel (refund)</button><button class="btn sm pri" data-act="pay"${ok ? "" : " disabled"}>Pay${free && n ? ` (X = ${n})` : ""}</button></span>`;
    // folded (Pack): a small bar at the top; the power cards can still be clicked on the field
    if (ui.payFold) return `<div class="paybar"><b>${head}</b> · ${count} <span class="muted">(click power cards on the field)</span>${btns}<button class="mini" data-act="payFold" title="Show the cards">▴ Show</button></div>`;
    const pos = ui.payPos ? ` style="left:${ui.payPos.x}px;top:${ui.payPos.y}px;transform:none"` : "";
    const pz = ["S", "M", "L"].includes(ui.payZ) ? ui.payZ : "L";   // card size in the cost window: S 0.5× · M 0.8× · L 1× (Pack, Revise#208)
    return `<div class="modal dec pay pz-${pz}"${pos}><div class="mh" id="payHead" title="Drag to move"><span class="grip">⠿</span>${head}<span class="pzbar" role="radiogroup" aria-label="Card size in the cost window">${["S", "M", "L"].map(z => `<button class="mini${z === pz ? " on" : ""}" role="radio" aria-checked="${z === pz}" data-act="payZ" data-z="${z}" title="Card size ${z} (${{ S: "0.5", M: "0.8", L: "1" }[z]}×)">${z}</button>`).join("")}</span><button class="mini" data-act="payFold" title="Fold to a small bar">▾ Fold</button></div><div class="muted">${free ? "Cost X: choose as many power cards as you want to pay — X is the number you pay." : `Choose ${d.cost} power card${d.cost === 1 ? "" : "s"}.`} Face-down cards came from the deck.</div><div class="paygs">${groups}</div>${altRow}${exRow}
      <div class="dfoot">${count}${btns}</div></div>`;
  }

  /* ---------- modal / menu ---------- */
  /** A triggered ability that needs a target, as an event pop-up (Pack, Revise#162): the target is clicked on the field. */
  function trigAskHTML() {
    const S = R.S, me = R.viewer;
    if (ui.replay || me < 0 || S.decisions.length) return "";
    const tr = S.triggers.find(x => TB.mySeats().includes(x.seat));
    if (!tr) return "";
    const inf = info(S.cards[tr.card].key), ab = inf.abilities[tr.ability], txt = (ab && (AA4.enText(inf, ab.text) || ab.text)) || "ability";
    const picking = ui.sel && ui.sel.kind === "trig" && ui.sel.id === tr.id, needT = !!(ab && ab.effect && ab.effect.target && ab.effect.target.count !== "all");
    if (!needT) return `<div class="modal dec trigpop"><div class="mh">⚡ Ability · ${esc(nameOf(tr.card))}</div><p>${esc(txt)}</p><div class="mf"><button class="btn pri" data-act="trun" data-id="${tr.id}">Run</button><button class="btn" data-act="tskip" data-id="${tr.id}">Skip</button></div></div>`;   // an optional ability: Run or Skip (Q#64)
    return `<div class="modal dec trigpop"><div class="mh">⚡ Ability · ${esc(nameOf(tr.card))}</div><p>${esc(txt)}</p>`
      + (picking ? `<div class="hint">Click the target on the field (blue border)</div>` : "")
      + `<div class="mf">${picking ? `<button class="btn" data-act="unsel">Back</button>` : `<button class="btn pri" data-act="trun" data-id="${tr.id}">Choose the target</button>`}<button class="btn" data-act="tskip" data-id="${tr.id}"${tr.optional ? "" : " disabled"}>Skip</button></div></div>`;
  }
  /** An undo asked by another player, as an event pop-up for the players who must answer now (Pack, Revise#162). */
  /** Pack (Revise#236): every event screen can be dragged by its title and folded to its title (▾ / ▸); both are kept per kind of screen. */
  TB.decorateModals = root => {
    ui.mPos = ui.mPos || {}; ui.mFold = ui.mFold || {};
    for (const m of root.querySelectorAll(".modal:not(.dec):not(.automsg)")) {   // Pack (Revise#290): easy to close on a phone — a ✕ that stays at the top, and a tap outside
      if (!m.querySelector('[data-act="close"]')) continue;
      const h = m.querySelector(":scope > .mh");
      if (h && !h.querySelector(".mx")) { h.classList.add("mhx"); h.insertAdjacentHTML("beforeend", `<button type="button" class="mx" data-act="close" aria-label="Close" title="Close">✕</button>`); }
      const pv = m.previousElementSibling; if (!(pv && pv.classList.contains("mscrim"))) m.insertAdjacentHTML("beforebegin", `<div class="mscrim" data-act="scrimClose" aria-hidden="true"></div>`);
    }
    for (const m of root.querySelectorAll(".modal.dec, .modal.automsg")) {
      const key = [...m.classList].filter(c => c !== "modal" && c !== "dec" && c !== "folded" && !/^pz-/.test(c)).join(".") || "dec";
      const h = m.querySelector(":scope > .mh"); if (!h) continue;
      m.dataset.mkey = key; h.classList.add("mdrag"); if (!h.title) h.title = "Drag to move";
      const fold = !!ui.mFold[key];
      if (!h.querySelector(".mfold")) h.insertAdjacentHTML("beforeend", `<button type="button" class="mfold" data-act="mfold" data-k="${esc(key)}" aria-expanded="${!fold}" aria-label="${fold ? "Unfold" : "Fold"}" title="${fold ? "Unfold" : "Fold"}">${fold ? "▸" : "▾"}</button>`);
      m.classList.toggle("folded", fold);
      const p = ui.mPos[key];
      if (p && key !== "pay") Object.assign(m.style, { left: Math.min(p.x, innerWidth - 80) + "px", top: Math.min(p.y, innerHeight - 40) + "px", bottom: "auto", right: "auto", transform: "none" });
    }
  };
  /** Auto Re-shuffle result (Pack, Revise#234): a message box when no hand matched; a short note when one did. */
  function autoMsgHTML() {
    const S = R.S, me = R.viewer, p = me >= 0 && S.players[me], m = p && p.autoMsg;
    if (!m || S.stage !== "mulligan") return "";
    const key = ui.room + ":" + me + ":" + m.n;
    if (ui.autoMsgSeen === key) return "";
    if (m.ok) { ui.autoMsgSeen = key; setTimeout(() => TB.toast(m.tries ? `Auto Re-shuffle: the hand matches after ${m.tries} re-shuffle${m.tries === 1 ? "" : "s"} — counters reset to 0` : "Auto Re-shuffle: the hand already matches — counters reset to 0"), 0); return ""; }
    return `<div class="modal automsg" role="alertdialog" aria-label="Auto Re-shuffle"><div class="mh">Auto Re-shuffle</div>${m.lines.map((l, i) => `<p class="${i ? "amwarn" : "amscrewed"}">${esc(l)}</p>`).join("")}<p class="muted">${m.tries} re-shuffles, no hand matched (Auto Re-shuffle ×${m.runs}). Last hand: Character ${m.check.chars}/3 · Draw ${m.check.draw}/1 · Charge + effect cost back ${m.check.chargeBack}/1.</p><div class="opts"><button class="btn pri" data-act="autoMsgOk">OK</button></div></div>`;
  }
  function undoAskHTML() {
    const S = R.S, pu = ui.log.pendingUndo, me = R.viewer;
    if (!pu || ui.replay || me < 0) return "";
    const who = AA4.seatFor(S, { by: pu.by }), left = pu.voters.filter(s => !pu.agreed.includes(s)), mayNow = S.rules.respond === "together" ? left : left.slice(0, 1);
    if (!mayNow.includes(me)) return "";
    const nm = s => esc(S.players[s] ? S.players[s].name : "?");
    return `<div class="modal dec undopop"><div class="mh">↶ Undo · ${nm(who)} asks to undo their last action</div><p class="muted">${left.length > 1 ? `Waiting for ${left.map(nm).join(", ")}. ` : ""}Agree: the last action is taken back for everyone. Refuse: the game goes on as it is.</p><div class="mf"><button class="btn ok" data-act="undoYes">Agree</button><button class="btn danger" data-act="undoNo">Refuse</button></div></div>`;
  }
  function decisionHTML() {
    const S = R.S, d = S.decisions.find(x => TB.mySeats().includes(x.seat));
    if (!d) {
      const w = S.decisions[0];
      return w ? `<div class="waitbar">Waiting for ${esc(S.players[w.seat].name)}: ${esc(w.reason)}</div>` : "";
    }
    if (TB.mySeats().length > 1 && d.seat !== R.viewer && !ui.viewLock) return "";
    if (d.onField) {   // Changing Target (Pack, Revise#248): no list box — click the new object on the field; the old one is named in a small bar
      const nm = t => { const S = R.S; return t.ch && S.chars[t.ch] ? `${nameOf(AA4.topOf(S.chars[t.ch]))} (${S.players[S.chars[t.ch].owner].name})` : t.seat != null ? `Player ${S.players[t.seat].name}` : t.card && S.cards[t.card] ? nameOf(t.card) : "—"; };
      return `<div class="modal dec fpick" role="dialog" aria-label="${esc(d.reason)}"><div class="mh">${esc(S.players[d.seat].name)} · Choose on the field</div><div class="fpr">${esc(d.reason)}</div><div class="fph">Now: ${esc((d.old || []).map(nm).join(", ") || "—")} → click the new one on the field (blue border).</div></div>`;
    }
    if (R.fieldPick && R.fieldPick.id === d.id) {   // Pack (Revise#245): chosen on the field — a small bar, the field stays free
      const lab = o => { const i = d.options.indexOf(o); return (d.labels && d.labels[i]) || o; };
      return `<div class="modal dec fpick" role="dialog" aria-label="${esc(d.reason)}"><div class="mh">${esc(S.players[d.seat].name)} · Choose on the field</div><div class="fpr">${esc(d.reason)}</div><div class="fph">Click a highlighted player, character or area on the field (blue border).</div>${R.fieldPick.rest.length ? `<div class="opts">${R.fieldPick.rest.map(o => `<button class="btn${o === "__done__" ? " pri" : ""}" data-act="choose" data-pick='${esc(JSON.stringify([o]))}'>${esc(lab(o))}</button>`).join("")}</div>` : ""}</div>`;
    }
    if (d.setCard && S.cards[d.setCard]) {   // Pack (Revise#231): the card being set, big with its details; the ones after it small below; click the character on the field
      const c = S.cards[d.setCard], inf = info(c.key) || {}, rest = (d.setRest || []).filter(id => S.cards[id]);
      const chBtns = d.options.map((o, i) => `<button class="btn sm" data-act="choose" data-pick='${esc(JSON.stringify([o]))}'>${esc((d.labels && d.labels[i]) || o)}</button>`).join("");
      return `<div class="modal dec setwin" role="dialog" aria-label="${esc(d.reason)}"><div class="mh">${esc(S.players[d.seat].name)} · Set a Permanent${rest.length ? ` <span class="badge">${rest.length + 1} left</span>` : ""}</div>`
        + `<div class="swmain"><div class="swcard">${faceKey(c.key, "swc")}</div><div class="swinfo"><b class="swname">${esc(EN(inf))}</b><div class="swjp">${esc(inf.jp || "")}</div><div class="swmeta">${esc(inf.type || "")}${inf.cost != null ? ` · Cost ${esc(String(inf.cost))}` : ""}</div>${inf.textEn ? `<div class="swtxt">${esc(inf.textEn)}</div>` : inf.text ? `<div class="swtxt">${esc(inf.text)}</div>` : ""}</div></div>`
        + (rest.length ? `<div class="swrest"><span class="rl">Next</span>${rest.map(id => `<div class="swnext">${faceKey(S.cards[id].key, "swn")}</div>`).join("")}</div>` : "")
        + `<div class="swhow">Click the character to set it on — on the field (blue border), or here:</div><div class="swchs">${chBtns}</div></div>`;
    }
    if (d.ref && d.ref.field) {   // chosen on the board, like paying a cost: a bar instead of a pop-up
      const n = ui.dpick && ui.dpick.id === d.id ? ui.dpick.list.length : 0;
      return `<div class="paybar fixbar"><b>${esc(d.reason)}</b> · click the power cards of the character in red (${n} / ${d.min})<span><button class="btn sm pri" data-act="dconfirm"${n >= d.min && n <= d.max ? "" : " disabled"}>Discard</button></span></div>`;
    }
    const picked = new Set(ui.dpick && ui.dpick.id === d.id ? ui.dpick.list : []);
    let body;
    if (d.kind === "yesno") body = `<div class="opts"><button class="btn pri" data-act="choose" data-pick='["yes"]'>Yes</button><button class="btn" data-act="choose" data-pick='["no"]'>No</button></div>`;
    else if (d.kind === "pick" && d.options.every(o => FAC_OF_NAME[o])) {   // a faction (Pack): the fixed order, each with its mark and colour
      body = `<div class="opts facs">${d.options.map((o, i) => { const f = FAC_OF_NAME[o]; return `<button class="facb fac-${f}" data-act="choose" data-pick='${esc(JSON.stringify([o]))}'><img src="factions/${FAC_FILE[f]}.png" alt=""><span class="ft"><b>${esc(o)}</b><small>${esc(((d.labels && d.labels[i]) || "").replace(/^[^(]*\(|\)$/g, "").replace(/^1 characters$/, "1 character"))}</small></span></button>`; }).join("")}</div>`;
    }
    else if (d.kind === "pick") body = `<div class="opts col">${d.options.map((o, i) => `<button class="btn${i === 0 ? "" : ""}" data-act="choose" data-pick='${esc(JSON.stringify([o]))}'>${esc((d.labels && d.labels[i]) || o)}</button>`).join("")}</div>`;
    else {
      const isCard = d.options.every(o => typeof o === "string" && R.S.cards[o]), isChar = !isCard && d.options.every(o => typeof o === "string" && R.S.chars[o]);
      const optName = (o, i) => (d.labels && d.labels[i]) || (isChar ? `${nameOf(AA4.topOf(R.S.chars[o]))} — ${R.S.players[R.S.chars[o].owner].name}` : o);   // a character: by name, not its id
      body = `<div class="opts cards">${d.options.map((o, i) => isCard ? face(o, "opt" + (picked.has(o) ? " picked" : ""), `data-dopt='${esc(JSON.stringify(o))}'`) : `<button class="btn${picked.has(o) ? " on" : ""}" data-dopt='${esc(JSON.stringify(o))}'>${esc(optName(o, i))}</button>`).join("") || `<span class="muted">Nothing matches</span>`}</div>`
        + `<div class="dfoot">${picked.size} chosen (${d.min === d.max ? d.min : d.min + "–" + d.max})<button class="btn pri" data-act="dconfirm"${picked.size >= d.min && picked.size <= d.max ? "" : " disabled"}>OK</button></div>`;
    }
    return `<div class="modal dec"><div class="mh">${esc(S.players[d.seat].name)} · ${esc(d.reason)}</div>${body}</div>`;
  }
  /** Player options (Pack, Revise#099): game rules (Auto-skip / Auto-pay, shared) and this device's own choices. */
  /** Pack (Revise#205): a “?” that shows its explanation on hover / tap (as the lobby's Game rules), and an option row with one */
  const helpQ = TB.helpQ = (html, label) => `<span class="hq"><button type="button" class="lhelp" aria-label="${esc("What is " + (label || "this") + "?")}">?</button><span class="lhtxt" role="tooltip">${html}</span></span>`;
  const optLine = (act, on, title, help, red, extra) => `<div class="optline"><button class="optrow${on ? " on" : ""}${on && red ? " red" : ""}" data-act="${act}"${extra || ""}><span class="sw">${on ? "ON" : "OFF"}</span><span><b>${title}</b></span></button>${helpQ(help, title.replace(/<[^>]+>/g, ""))}</div>`;
  /** Game Situation (Pack, Revise#169): the shared Hold setting; its “?” shows what each situation skips (Revise#205). */
  /** Pack (Revise#206): short words and a colour per situation — Build green, Interfere yellow, Conflict orange, Engage red */
  const SIT_SHORT = { building: "Build", interfering: "Interfere", conflicting: "Conflict", engaging: "Engage" };
  TB.SIT_SHORT = SIT_SHORT;
  const SIT_LABEL = { aggressive: "Aggressive", battle: "Attack/Guard", project: "Project", fast: "Fast", effect: "Effect", break: "Break/Permanent" };
  const sitTip = v => { const s = AA4.SITUATIONS.find(x => x[0] === v); return s ? `<b>${esc(s[1])}</b>` + AA4.HOLD_ANSWER.map(t => `<div class="sr"><span>${SIT_LABEL[t]}</span><span class="${s[2][t] ? "sitns" : "sitsk"}">${s[2][t] ? "Not Skip" : "Skip"}</span></div>`).join("") : ""; };
  TB.sitTip = sitTip;
  const sitHelp = S => `<b>Game Situation</b><br>Declare one for everyone — Hold follows it. Now: <b>${esc((AA4.situationOf(S) || [, ""])[1])}</b>${sitTip((AA4.situationOf(S) || [""])[0]).replace(/^<b>[^<]*<\/b>/, "")}<br><small>Every situation: ⚑ Game options → Skip.</small>`;
  /** Pack (Revise#212): the Skip table in Game options — one row per Hold type, one column per situation; the situation now is marked */
  /* Pack (Revise#225): a "Current" column — the setting now, each cell clicks Skip ⇄ Not Skip; click a situation's name to declare it (Current follows it) */
  const skipTable = S => { const cur = AA4.situationOf(S), now = t => AA4.holdOn(S, TB.mySeats()[0] != null ? TB.mySeats()[0] : 0, t), custom = !!S.sitHolds;
    return `<table class="sittab skiptab"><tr><th></th><th class="curcol">Current${custom ? "*" : ""}</th>${AA4.SITUATIONS.map(([v, l]) => `<th class="sv-${v}${cur && cur[0] === v ? " cur" : ""}"><button type="button" class="sitpick" data-act="situation" data-v="${v}" title="Declare ${esc(l)} — Current follows it">${esc(SIT_SHORT[v] || l)}</button></th>`).join("")}</tr>`
      + AA4.HOLD_ANSWER.map(t => `<tr><th>${SIT_LABEL[t]}</th><td class="curcol"><button type="button" class="sitcur ${now(t) ? "sitns" : "sitsk"}" data-act="sitHold" data-type="${t}" data-on="${now(t) ? 0 : 1}" title="Click: ${now(t) ? "Skip" : "Not Skip"}">${now(t) ? "Not Skip" : "Skip"}</button></td>${AA4.SITUATIONS.map(([v, , h]) => `<td class="${h[t] ? "sitns" : "sitsk"}${cur && cur[0] === v ? " cur" : ""}">${h[t] ? "Not Skip" : "Skip"}</td>`).join("")}</tr>`).join("") + `</table>`; };
  function situationBarHTML(S) {
    const cur = AA4.situationOf(S);
    return `<span class="sitbar" role="tablist" aria-label="Game Situation">${AA4.SITUATIONS.map(([v, l]) => `<button class="btn sm sit sv-${v}${cur && cur[0] === v ? " on" : ""}" role="tab" data-act="situation" data-v="${v}" data-sit="${v}" aria-selected="${!!(cur && cur[0] === v)}" title="${esc(l)}">${esc(SIT_SHORT[v] || l)}</button>`).join("")}</span>`;
  }
  /** "[Player Name] declares [Game Situation]": fade in 1 s, count down 3 s, fade out 1 s (Pack, Revise#169). */
  const situationPop = S => {
    const d = S.sitDecl;
    if (!d) { ui.sitSeen = 0; ui.sitRoom = ui.room; return; }
    if (ui.sitSeen == null || ui.sitRoom !== ui.room) { ui.sitSeen = d.n; ui.sitRoom = ui.room; return; }   // opened / joined: nothing new to announce
    if (d.n <= ui.sitSeen) { ui.sitSeen = d.n; return; }   // undone
    ui.sitSeen = d.n;
    const old = document.getElementById("sitPop"); if (old) old.remove();
    const s = AA4.SITUATIONS.find(x => x[0] === d.value) || [0, d.value, {}];
    const el = document.createElement("div");
    el.id = "sitPop"; el.className = "sitpop"; el.setAttribute("role", "status");
    el.innerHTML = `<div class="spbox"><div class="spt"><b>${esc(S.players[d.seat] ? S.players[d.seat].name : "?")}</b> declares <b class="spv sv-${d.value}">${esc(SIT_SHORT[d.value] || s[1])}</b></div><div class="sptip">${sitTip(d.value)}</div><div class="spc">3</div></div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("in"));
    const c = el.querySelector(".spc");
    setTimeout(() => { c.textContent = "2"; }, 2000); setTimeout(() => { c.textContent = "1"; }, 3000);
    setTimeout(() => el.classList.remove("in"), 4000);
    setTimeout(() => el.remove(), 5000);
  };
  /** Player options side bar (Pack, Revise#178): opens at the right edge. Tab “Size · Hold”: card size, Hold (or the Game Situation); tab “Options”: the rest. */
  function drawerHTML() {
    if (!ui.optsOpen) return "";
    const S = R.S, me = R.viewer, playing = me >= 0 && S.stage === "play", sit = playing && AA4.situationOf(S);
    const tab = playing && ui.optsTab === "options" ? "options" : "play";
    const tb = (v, l) => `<button role="tab" class="drtab${tab === v ? " on" : ""}" data-act="optsTab" data-tab="${v}" aria-selected="${tab === v}">${l}</button>`;
    const size = `<section class="drsec"><h3>Card size</h3><label class="sizebar" title="Card size: Lv 1 (small) … Lv 6 (real card size)"><span>Size</span><input type="range" id="sizeBar" min="1" max="6" step="1" value="${ui.size}" aria-label="Card size level"><b id="sizeLv">Lv ${ui.size}</b></label></section>`;
    // Pack (Revise#225): one page — Options, then Card size; Hold moved to Game options
    const body = (playing ? optionsHTML() : "") + size;
    return `<aside class="drawer${Date.now() - (ui.drAnim || 0) < 400 ? " slide" : ""}" id="optDrawer" role="dialog" aria-label="Player options"><div class="drh"><b>⚙ Player options</b><button class="mini ic" data-act="optsMenu" title="Close" aria-label="Close player options">✕</button></div>`
      + `<div class="drbody" id="drBody">${body}</div></aside>`;
  }
  /** Game options side bar (Pack, Revise#190): table rules any player may change — Global Undo/Redo, Game Situation, Outlaw. Each change is in the log. */
  function gameDrawerHTML() {
    const S = R.S, me = R.viewer;
    if (!ui.gameOpen || !(me >= 0 && S.stage === "play")) return "";
    const sit = AA4.situationOf(S), row = (act, on, title, help, red) => optLine(act, on, title, help, red);   // every explanation in a “?” (Pack, Revise#212)
    const h3 = (title, small, help) => `<h3 class="hqh">${title}${small ? ` <small>${small}</small>` : ""}${help ? helpQ(help, title) : ""}</h3>`;
    const body = `<section class="drsec"><h3>Undo / Redo</h3><div class="optmenu">${sit ? optLine("holdUndo", AA4.holdOn(S, TB.mySeats()[0], "undo"), "Undo — ask me to agree", "Another player's Undo waits until you agree.") : ""}${row("globalUndo", S.rules.globalUndo, "Global Undo/Redo", "Any player may Undo / Redo any player's latest action (otherwise only your own). Players with Hold “Undo” ON are still asked to agree (table rule — shown in the log)")}</div></section>`
      + (sit ? "" : `<section class="drsec"><h3>Hold <small>${(n => n === AA4.HOLD_ANSWER.length ? "all ON" : n === 0 ? "all OFF" : n + " / " + AA4.HOLD_ANSWER.length + " ON")(AA4.HOLD_ANSWER.filter(t => AA4.holdOn(S, me, t)).length)}</small></h3>${holdHTML(me)}</section>`)   // Pack (Revise#225): Hold lives here; with Game Situation ON the situation takes its place
      + (sit ? `<section class="drsec">${h3("Game Situation", sit ? "shared — anyone may declare · now " + esc(SIT_SHORT[sit[0]] || sit[1]) : "off for this game", sit ? "Everyone's Hold follows one shared situation. Any player declares it in the coloured row under the option buttons (Build · Interfere · Conflict · Engage); “Skip” below shows what each one skips." : "The room creator turns Game Situation on before “Create Room”.")}</section>` : "")
      + `<section class="drsec"><h3 class="hqh">Game Status pop-up <small>this device</small>${helpQ("When nothing has happened for this long, a small Game Status box shows what the game is waiting for, with Copy log and Skip (and ⚡ beside the hand buttons).", "Game Status pop-up")}</h3><div class="stuckbar" role="radiogroup" aria-label="Show Game Status after">${TB.STUCK_CHOICES.map(n => `<button class="btn sm${TB.stuckAfter() === n * 1000 ? " on" : ""}" role="radio" aria-checked="${TB.stuckAfter() === n * 1000}" data-act="stuckSec" data-v="${n}">${n} s</button>`).join("")}</div></section>`
      + (sit ? `<section class="drsec skipsec">${h3("Skip", "Game Situation", "What each Game Situation skips: “Skip” = no one is waited for on that kind of declaration; “Not Skip” = every player gets the chance to answer. The column of the situation now is marked.")}${skipTable(S)}</section>` : "")
      + `<section class="drsec"><h3 class="outh hqh">Outlaw${helpQ("Table rules that bend the official rules. Each change is shown in the log.", "Outlaw")}</h3><div class="optmenu">`
      + row("outlawDiscard", S.rules.outlawDiscard, "Flip-up Discard Pile", "Every Discard Pile is face up for everyone (table rule — shown in the log)", true)
      + row("outlawPower", S.rules.outlawPower, "Flip-up all Power Card", "Every power card is face up for everyone (table rule — shown in the log)", true)
      + row("powerFlipDown", S.rules.powerFlipDown, "Flip down all power cards", "Every power card is face down — even a card charged from the hand is hidden from its owner too (an effect that shows power cards still shows them). Can't be ON with “Flip-up all Power Card” (table rule — shown in the log)", true)
      + row("outlawFool", S.rules.outlawFool, "Fool text", "A3-23 joke cards play their フールテキスト (fool text) instead of their normal text — automatic where it can be (table rule — shown in the log)", true)
      + `</div></section>`;
    return `<aside class="drawer${Date.now() - (ui.drAnim || 0) < 400 ? " slide" : ""}" id="gameDrawer" role="dialog" aria-label="Game options"><div class="drh"><b>⚑ Game options</b><button class="mini ic" data-act="gameMenu" title="Close" aria-label="Close game options">✕</button></div><div class="drbody" id="drBody">${body}</div></aside>`;
  }
  /** Hold types (Pack, Revise#168): one switch each; Permanent cards count as Break. */
  function holdHTML(me) {
    const S = R.S, help = { aggressive: "Active Phase only. Stop when a ▼ (Aggressive) character attacks: before the guard / “No guard” and before the battle resolves.", battle: "Main Phase only. Stop after the guard / “No guard”, or after an attack on a character.", project: "Stop when a Project card is declared.", fast: "Stop when a Fast card is declared.", effect: "Stop when a character's effect is declared (or a triggered ability waits in Resolve).", break: "Stop when a Break or Permanent card is declared onto a character.", undo: "Another player's Undo waits until you agree." };
    const def = AA4.HOLD_TYPES.every(([t]) => AA4.holdOn(S, me, t) === AA4.HOLD_DEFAULT[t]);
    return `<div class="optmenu holdmenu" role="menu"><div class="holdall"><button class="btn sm" data-act="holdAll" data-on="1" title="Every Hold type ON, Undo too">All ON</button><button class="btn sm" data-act="holdAll" data-on="0" title="Every Hold type OFF, Undo too">All OFF</button><button class="btn sm${def ? " on" : ""}" data-act="holdDefault" title="Aggressive OFF · Attack / Guard ON · Project ON · Fast ON · Effect ON · Break / Permanent OFF · Undo ON">Default</button></div>`
      + AA4.HOLD_TYPES.map(([t, label]) => { const on = AA4.holdOn(S, me, t); return (t === "undo" ? `<div class="opthead">Undo</div>` : "") + optLine("holdSet", on, esc(label), help[t], false, ` data-type="${t}" data-on="${on ? 0 : 1}"`); }).join("")
      + `</div>`;
  }
  function optionsHTML() {
    const S = R.S, o = ui.opts, h = t => `<div class="opthead cat">${t}</div>`;
    return `<div class="optmenu" role="menu">`
      + h("Phase")
      + optLine("autoSkip", S.rules.autoSkip, "Auto-skip Phase", "Phases with nothing to do end by themselves: the Active Phase goes on to the Main Phase when the faction check is over, and the Charge Phase ends when nothing more can be charged. (Game rule: the same for every player.)")
      + optLine("optPickMax", o.pickMax, "Pick Max Charge", "Charge Phase: clicking your Deck picks as many deck charges as you may at once — down to Deck = Draw (or down to 0 with “Charge exceeds Draw”). (This device only.)")
      + optLine("optExceed", o.exceedDraw, "Charge exceeds Draw", "OFF: a warning comes before a charge takes your Deck below your Draw. ON: charge without the warning. (This device only.)", true)
      + h("Cost")
      + optLine("autoPay", S.rules.autoPay, "Auto-pay", "When a cost is exactly all the power cards that can pay it, they are paid at once — the cost window does not open. (Game rule: the same for every player.)")
      + optLine("optPayOnPick", o.payOnPick, "Auto Pay after Cost Selection", "When the cost window does open (you have more power cards than the cost and choose which ones), it pays as soon as you have picked as many cards as the cost — no need to press Pay. (This device only.)")
      + h("Gameplay")
      + optLine("optAutoAbility", o.autoAbility, "Run optional abilities without asking", "OFF (default): an ability that says “…可能” (may) asks Run / Skip. ON: it runs at once without asking (Q#64). (This device only.)")
      + `</div>`;
  }
  TB.chargeWarnHTML = m => `<div class="modal dec cwarn"><div class="mh">⚠ Charge</div><p class="cwt">Deck &lt;= Draw. Will you continue to charge?</p><div class="muted">Deck ${m.deck} · Draw ${m.draw}</div>
    <div class="opts"><button class="btn cw-charge" data-act="cwCharge">Charge</button><button class="btn cw-stop" data-act="cwStop">Stop</button></div></div>`;
  /* ---------- stuck log (Pack, Revise#128): 30 s without any action → ⚡ beside the hand buttons ---------- */
  TB.STUCK_AFTER = 30000;   // the default; Game options can make it 60 / 120 / 180 s (Revise#206)
  TB.STUCK_CHOICES = [30, 60, 120, 180];   // seconds — Game options (Pack, Revise#206)
  TB.stuckAfter = () => (TB.STUCK_CHOICES.includes(+ui.opts.stuckSec) ? +ui.opts.stuckSec : 60) * 1000;   // 60 s by default (Pack, Revise#225)
  TB.stuckNow = () => { const S = ui.log && ui.log.state; return !!(S && S.stage === "play" && ui.lastActAt && Date.now() - ui.lastActAt >= TB.stuckAfter()); };
  /** Everything the game is waiting for or still processing, as plain text lines (also copied for a bug report). */
  TB.stuckReport = () => {
    const S = R.S, db = TB.db, out = [], P = s => (S.players[s] ? `${S.players[s].name} (seat ${s})` : `seat ${s}`);
    const cn = id => { const c = S.cards[id]; const inf = c && c.key ? db.card(c.key) : null; return inf ? TB.EN(inf) : id ? "a hidden card" : "–"; };
    const chn = id => (S.chars[id] ? cn(AA4.topOf(S.chars[id])) + ` [${id}]` : id ? `${id} (gone)` : "–");
    const ago = ui.lastActAt ? Math.round((Date.now() - ui.lastActAt) / 1000) : null;
    out.push(`Stuck log — ${new Date().toISOString()} · build ${(((document.querySelector('link[href*="table.css"]') || {}).href || "").split("v=")[1] || "?")}`);
    out.push(`Last action: ${ago == null ? "unknown" : ago + " s ago"} · log entries ${ui.log.entries ? ui.log.entries.length : "?"} · state version ${S.version}`);
    out.push(`Game: ${S.mode} · stage ${S.stage} · turn ${S.turn.number} · turn player ${S.turn.player >= 0 ? P(S.turn.player) : "–"} · phase ${S.turn.phase || "–"}${S.turn.step ? " / " + S.turn.step : ""}`);
    out.push(`This client: ${ui.cid || "?"} · my seats ${JSON.stringify(TB.mySeats())} · viewing ${R.viewer}${ui.error ? " · error: " + ui.error : ""}${ui.netError ? " · network: " + ui.netError : ""}`);
    if (AA4.situationOf(S)) out.push(`Game Situation: ${AA4.situationOf(S)[1]}`);
    else out.push(`Hold: ${S.players.map(p => `${p.name} ${AA4.HOLD_TYPES.filter(([t]) => t !== "undo").map(([t, l]) => `${l.split(" / ")[0]} ${AA4.holdOn(S, p.seat, t) ? "ON" : "OFF"}`).join(", ")}${p.lost ? " (lost)" : ""}`).join(" · ")}`);
    out.push("");
    out.push(`WAITING FOR`);
    let any = false;
    for (const d of S.decisions) { any = true; out.push(`  • choice for ${P(d.seat)}: “${d.reason}” (${d.kind}, choose ${d.min}–${d.max} of ${d.options.length})`); }
    if (S.draft) { any = true; out.push(`  • ${P(S.draft.seat)} is declaring: ${S.draft.kind}${S.draft.card ? " " + cn(S.draft.card) : ""}${S.draft.ch ? " by " + chn(S.draft.ch) : ""} — step “${S.draft.step}”${S.draft.cost != null ? ", cost " + S.draft.cost : ""}`); }
    for (const t of S.triggers || []) { any = true; out.push(`  • triggered ability of ${cn(t.card)} for ${P(t.seat)} — Run or Skip${t.optional ? " (optional)" : ""}`); }
    if (AA4.responseOpen(S)) {
      any = true;
      const now = AA4.priorityNow(S), need = AA4.needPass ? AA4.needPass(S) : [];
      out.push(`  • response: priority ${now == null || now < 0 ? "–" : P(now)} · must pass: ${need.map(P).join(", ") || "nobody"} · passed: ${(S.passed || []).map(P).join(", ") || "nobody"} · rule ${(S.rules && S.rules.respond) || "order"}`);
    }
    if (S.pendingUndo || (ui.log && ui.log.pendingUndo)) { any = true; out.push(`  • undo agreement pending: ${JSON.stringify(S.pendingUndo || ui.log.pendingUndo)}`); }
    if (S.queue && S.queue.length) { any = true; out.push(`  • ${S.queue.length} operation(s) still queued: ${S.queue.slice(0, 8).map(o => o.op).join(", ")}${S.queue.length > 8 ? " …" : ""}`); }
    if (!any) out.push(`  • nothing is pending — the turn player ${S.turn.player >= 0 ? P(S.turn.player) : ""} can act (Next ▸ ends the phase)`);
    out.push("");
    out.push(`RESOLVE LIST (newest last): ${S.stack.length ? "" : "empty"}`);
    S.stack.forEach((it, i) => out.push(`  ${i + 1}. ${it.kind} by ${P(it.seat)}${it.card ? " — " + cn(it.card) : ""}${it.ch ? " (" + chn(it.ch) + ")" : ""}${(it.targets || []).length ? " → " + it.targets.map(t => t.ch ? chn(t.ch) : t.seat != null ? P(t.seat) : t.card ? cn(t.card) : t.field ? "field" : "?").join(", ") : ""}`));
    if (S.battle) { const b = S.battle; out.push(`BATTLE: step ${b.step} · ${chn(b.attacker)} → ${b.target && b.target.ch ? chn(b.target.ch) : b.target ? P(b.target.seat) : "?"} · guard ${b.guard ? chn(b.guard) : "none"}${b.kind ? " · " + b.kind : ""}`); }
    if ((S.delayed || []).length) out.push(`DELAYED: ${S.delayed.map(d => d.at + ":" + d.step.a).join(", ")}`);
    out.push("");
    out.push("LAST LOG LINES");
    for (const li of Array.from(document.querySelectorAll("#logLines > *")).slice(-15)) out.push("  " + li.textContent.trim());
    return out.join("\n");
  };
  /** Pass All (Pack, Revise#151): pass on each item that was on the Resolve list when it was clicked; stops at a new item. */
  TB.passAllStep = S => {
    if (!ui.passAll) return;
    const top = S.stack[S.stack.length - 1];
    if (!top || !ui.passAll.includes(top.id) || S.stage !== "play") { ui.passAll = null; return; }
    if (S.decisions.length || S.queue.length || S.draft || S.triggers.length) return;
    const now = AA4.priorityNow(S);
    if (now == null || !TB.mySeats().includes(now)) return;
    if (ui.passAllBusy) return;
    ui.passAllBusy = true;
    setTimeout(() => { ui.passAllBusy = false; const S2 = ui.log && ui.log.state; if (!ui.passAll || !S2 || AA4.priorityNow(S2) !== now) return; if (!TB.send({ t: "pass", seat: now }, true)) { ui.passAll = null; TB.render(); } }, 250);
  };
  /** Game Status (Pack, Revise#151): 30 s (Game options: 30 / 60 / 120 / 180 s) without any action → a small box: what the game waits for, Copy log, Skip */
  TB.fullLog = () => TB.stuckReport() + "\n\nLOG ENTRIES (JSON)\n" + JSON.stringify((ui.entries || []).map(e => Object.assign({}, e)), null, 0).replace(/\},\{/g, "},\n{");
  function gameStatusHTML() {
    if (!TB.stuckNow() || ui.modal || ui.gsHideAt === ui.lastActAt) return "";
    const rep = TB.stuckReport().split("\n"), i = rep.indexOf("WAITING FOR"), lines = [];
    for (let k = i + 1; i >= 0 && k < rep.length && rep[k].trim(); k++) lines.push(rep[k].replace(/^\s*•\s*/, ""));
    const S = R.S, plan = AA4.unstickPlan(S), can = plan && TB.mySeats().length && !AA4.check(S, { t: "unstick", by: ui.cid, seat: TB.mySeats()[0] }, TB.db);
    return `<div class="gstat" role="status"><div class="gsh"><b>Game Status</b><span class="muted">no action for ${Math.round((Date.now() - ui.lastActAt) / 1000)} s</span><button class="mini ic" data-act="gsHide" title="Hide until something happens" aria-label="Hide">✕</button></div>
      <ul>${lines.slice(0, 5).map(l => `<li>${esc(l)}</li>`).join("")}</ul>
      <div class="gsb"><button class="btn sm" data-act="gsCopy">Copy log</button><button class="btn sm" data-act="stuck">Details</button>${plan ? `<button class="btn sm pri" data-act="gsSkip"${can ? "" : " disabled"} title="${esc("Skip: " + plan.what)}">Skip</button>` : ""}</div>
      ${plan ? `<div class="muted gsk">Skip will: ${esc(plan.what)}</div>` : ""}</div>`;
  }
  function stuckHTML(m) {
    const txt = m.text || TB.stuckReport();
    m.text = txt;
    return `<div class="modal stuck"><div class="mh">⚡ Stuck log</div><div class="muted">Nothing has happened for a while. This is what the game is waiting for or still processing — copy it and send it with your bug report.</div><pre class="stucktxt" id="stuckTxt">${esc(txt)}</pre><div class="mf"><button class="btn" data-act="stuckCopy">Copy</button><button class="btn" data-act="stuckRefresh">Refresh</button><button class="btn pri" data-act="close">Close</button></div></div>`;
  }
  function modalHTML() {
    const m = ui.modal;
    if (!m) return "";
    if (m.kind === "card") return TB.cardDetailsHTML(m);
    if (m.kind === "player") return TB.playerModalHTML(m);
    if (m.kind === "field") return TB.fieldFormHTML();
    if (m.kind === "color") return TB.colorFormHTML(m);
    if (m.kind === "chargeWarn") return TB.chargeWarnHTML(m);
    if (m.kind === "stuck") return stuckHTML(m);
    return "";
  }
  function menuHTML() {
    const m = ui.menu;
    if (!m) return "";
    return `<div class="menu" style="left:${Math.round(m.x)}px;top:${Math.round(m.y)}px">${m.title ? `<div class="mt">${esc(m.title)}</div>` : ""}${m.items.map((it, i) => `<button data-mi="${i}"${it.cls ? ` class="${it.cls}"` : ""}${it.why ? ` disabled title="${esc(it.why)}"` : ""}>${esc(it.label)}</button>`).join("")}</div>`;
  }

  /** Pack (Revise#205): the head of the turn player's field shows every phase (the current one bright, the others dim) and, for each player, whether Fast / Project timing is open now */
  function phaseStripHTML(S, seat, turn) {
    const fast = !S.players[seat].lost && AA4.timing(S, TB.db, seat, "fast") === null, proj = turn && AA4.timing(S, TB.db, seat, "project") === null;
    const tchip = (on, l, why) => `<span class="tmg${on ? " on" : ""}" title="${esc(why)}">${l}</span>`;
    const steps = turn ? `<span class="phs" aria-label="Phase: ${esc(PHASE[S.turn.phase] || "")}">${["draw", "active", "main", "charge", "discard"].map(ph => `<span class="ph${ph === S.turn.phase ? " on" : ""}">${esc((PHASE[ph] || ph).replace(/ Phase$/, ""))}</span>`).join("")}</span>` : "";
    return steps + tchip(fast, "Fast Timing", fast ? "This player may declare a Fast card or an effect now" : "Fast timing is not open for this player now")
      + (turn ? tchip(proj, "Project Timing", proj ? "The turn player may declare a Project card, a Break card or an attack now" : "Project timing is not open now") : "");
  }
  /** Pack (Revise#206): Control · Back has its own card size — S 0.5× / M 0.8× / L 1× of the card size — a vertical slider at the right end of the row */
  function backSizeHTML() {
    const z = ui.backZ || "L", i = ["S", "M", "L"].indexOf(z);
    return `<div class="bzbar" title="Control · Back card size: S 0.5× · M 0.8× · L 1×"><b>L</b><input type="range" class="bzr" id="backZ" min="0" max="2" step="1" value="${i}" aria-label="Control · Back card size (S, M, L)" aria-valuetext="${z}"><b>S</b><span class="bzv">${z}</span></div>`;
  }
  /* ---------- lobby ---------- */
  /** Pack (Revise#202): the game rules as big ON / OFF boxes above Solo / Online, each with a “?” explanation */
  const LOBBY_OPTS = [   // Pack (Revise#233): names, values and explanations
    { id: "lTogether", cls: "lo1", title: "Response Timing", on: true, vals: ["1: By Sequence", "2: Anytime Interrupts"],
      help: "This setting changes how “Response Timing” works.<ul><li><b>1: By Sequence</b> — The response is handled in sequence. The opposite side of the player who declares the action can respond first.</li><li><b>2: Anytime Interrupts</b> — The response is handled by anyone who declares a Response first.</li></ul>" },
    { id: "lSituation", cls: "lo2", title: "Game Situation", on: true,
      help: "This setting enables a preset of the “Hold” function according to the game situation, as below.<ul><li><b>1: Build</b> — Used when all players have just started playing. Not much attention is needed.</li><li><b>2: Interfere</b> — Used when a player starts to interrupt another player. More responsive actions such as Project and Effect declarations should be attended.</li><li><b>3: Conflict</b> — Used when players start attacking each other. Break cards and Permanent sets should be attended.</li><li><b>4: Engage</b> — Used when players start a full-scale battle. All actions of the players should be attended.</li></ul>" },
    { id: "lSkip", cls: "lo3", title: "Auto-Skip", on: true, help: "This setting changes how phasing works.<ul><li>A phase in which the player can take no action is skipped without asking for the player's attention.</li></ul>" },
    { id: "lPay", cls: "lo4", title: "Auto-Pay", on: true, help: "This setting changes how cost paying works.<ul><li>When the power cards that can be paid equal the cost, they are paid automatically, without the player needing to press “Pay”.</li></ul>" }
  ];
  /** Player image (Pack, Revise#214): 6 defaults or an image uploaded from this device (PC, iPhone / iPad, Android) — above Game rules */
  TB.avatarSrc = v => (!v ? "players/p1.jpg" : /^p[1-6]$/.test(v) ? `players/${v}.jpg` : v);
  TB.myAvatarSel = () => { const v = TB.store.get("aa4-avatar", "auto"); return v === "up" && !TB.store.get("aa4-avatar-up", null) ? "auto" : v; };
  /** Auto-pick (Pack, Revise#218, the default): the picture of the faction with the most name-level Break cards in the deck —
      p1 E.G.O. · p2 Arayashiki · p3 WIZ-DOM · p4 Darklore · p5 Polestar Empire · p6 Eraser */
  TB.AVATAR_FACTION = { "E.G.O.": "p1", Arayashiki: "p2", "WIZ-DOM": "p3", Darklore: "p4", "Polestar Empire": "p5", Eraser: "p6" };
  TB.autoAvatar = keys => {
    const n = {};
    for (const k of keys || []) { const c = TB.db.card(k); if (c && c.type === "Break" && c.name && TB.AVATAR_FACTION[c.faction]) n[c.faction] = (n[c.faction] || 0) + 1; }
    const best = Object.keys(TB.AVATAR_FACTION).reduce((b, f) => ((n[f] || 0) > (n[b] || 0) ? f : b), "E.G.O.");
    return TB.AVATAR_FACTION[best];
  };
  TB.avatarValue = keys => { const v = TB.myAvatarSel(); return v === "up" ? TB.store.get("aa4-avatar-up", null) || TB.autoAvatar(keys) : v === "auto" ? TB.autoAvatar(keys) : v; };
  function avatarPickHTML() {
    const cur = TB.myAvatarSel(), up = TB.store.get("aa4-avatar-up", null);
    const tile = (v, src, label) => `<button type="button" class="avpick${cur === v ? " on" : ""}" data-act="avatar" data-v="${v}" aria-pressed="${cur === v}" aria-label="${esc(label)}" title="${esc(label)}"><img src="${esc(src)}" alt="" loading="lazy"></button>`;
    return `<section class="lavatar" aria-label="Player image"><h2 class="hqh">Player image${helpQ("Your picture on the field: the Player sits at the bottom right of your field, the same size as your Deck. It is not a character. Effects on you (a skill like Charge, or a rule a card gives you) show on it — click it in a game to see them. Auto-pick (the default) takes the picture of the faction with the most name-level Break cards in your deck. Or choose one of the 6 pictures, or upload your own (it is made small on this device and shown to the other players).", "Player image")}${(() => { const sl = TB.deckSlots()[(ui.lobby && ui.lobby.s1 != null && ui.lobby.s1 !== "paste") ? +ui.lobby.s1 : 0], pv = TB.autoAvatar(sl ? sl.keys : []);   // Auto-pick beside the title (Pack, Revise#240): still one choice with the pictures
          return `<button type="button" class="avauto avhead${cur === "auto" ? " on" : ""}" data-act="avatar" data-v="auto" aria-pressed="${cur === "auto"}" aria-label="Auto-pick" title="Auto-pick: the picture of the faction with the most name-level Break cards in your deck"><img src="${esc(TB.avatarSrc(pv))}" alt="" loading="lazy"><span>Auto-pick</span></button>`; })()}</h2>`
      + `<div class="avgrid" role="group" aria-label="Choose your Player image">${AA4.AVATARS.map((v, i) => tile(v, TB.avatarSrc(v), "Player image " + (i + 1))).join("")}${up ? tile("up", up, "Your uploaded image") : ""}`
      + `<label class="avpick avup" title="Upload an image from this device"><input type="file" id="avFile" accept="image/*"><span aria-hidden="true">＋</span><small>${up ? "Change" : "Upload"}</small></label></div></section>`;
  }
  function lobbyHTML() {
    const slots = TB.deckSlots(), L = ui.lobby = ui.lobby || {}, saved = TB.store.get("aa4-slot", TB.store.get("aa-slot", 0) | 0), solo = TB.store.get("aa4-solo", null);
    const first = slots.find(s => s.keys.length), def = slots[saved] && slots[saved].keys.length ? saved : first ? first.i : 0;
    if (L.s1 == null) L.s1 = def; if (L.s2 == null) L.s2 = def; if (L.so == null) L.so = def;
    const opt = (sel, paste) => [0, 1, 2, 3, 4].map(p => { const rows = slots.slice(p * 10, p * 10 + 10).map(s => (!s.keys.length && p && String(s.i) !== String(sel) ? "" : `<option value="${s.i}"${String(s.i) === String(sel) ? " selected" : ""}${s.keys.length ? "" : " disabled"}>Slot ${s.i + 1} · ${esc(s.name)} · ${s.keys.length} cards</option>`)).join("");
      return rows ? `<optgroup label="Page ${p + 1}">${rows}</optgroup>` : ""; }).join("")
      + (paste ? `<option value="paste"${sel === "paste" ? " selected" : ""}>Paste a deck list…</option>` : "");
    const none = slots.every(s => !s.keys.length);
    return `<div class="lobby"><h1 class="lh1">Game table <span class="v4">v4 preview</span>${helpQ("The new table built on the v4 rules engine. Decks come from the Deck Builder's 50 slots on this device. The current table (Solo Test / Play Online on the main page) is unchanged.<br><br>Power cards are face down: only their owner sees the ones set from the hand (from the deck: nobody), unless an effect shows them. The Discard Pile is face down for everyone too (an effect that picks from it shows its cards to the chooser).", "Game table")}<a class="lcov" href="coverage.html" target="_blank" rel="noopener">Card rule coverage</a></h1>
      ${none ? `<div class="err">No deck on this device yet. Build one in 1. Deck Builder (decks are saved per device) — or, online, choose “Paste a deck list…”.</div>` : ""}
      ${avatarPickHTML()}
      <section class="lopts" aria-label="Game rules"><h2>Game rules</h2><div class="loptgrid">${LOBBY_OPTS.map(o => `
        <div class="lopt ${o.cls}"><input type="checkbox" id="${o.id}"${o.on ? " checked" : ""} aria-label="${o.title}">
          <span class="lotitle">${o.title}</span>${o.vals ? `<span class="losw lovals" aria-hidden="true"><span class="lv0">${o.vals[0]}</span><span class="lv1">${o.vals[1]}</span></span>` : `<span class="losw" aria-hidden="true"></span>`}
          <button type="button" class="lhelp" aria-label="What is ${o.title}?">?</button><div class="lhtxt" role="tooltip">${o.help}</div></div>`).join("")}
      </div></section>
      ${ui.error ? `<div class="err">${esc(ui.error)}</div>` : ""}
      <div class="lgrid lcols">
        <div class="lcol"><div class="lbox lsolo"><h2>Solo</h2>
          <label>Deck 1 <select id="lSlot1" data-lobby="s1">${opt(L.s1)}</select></label>
          <label>Deck 2 <select id="lSlot2" data-lobby="s2">${opt(L.s2)}</select></label>
          <div class="lfirst"><span class="lft">Who goes first</span>
            <label class="lsw"><span>Deck 1</span><input type="checkbox" id="lSecond" role="switch" aria-label="Deck 2 goes first"><i aria-hidden="true"></i><span>Deck 2</span></label></div>
          <div class="lmodes">
            <section class="lmode"><h3>Play by yourself</h3>
              <button class="btn pri" data-act="solo1" title="One deck: you play Deck 1 alone">Player</button>
              <button class="btn" data-act="solo2" title="Two decks: you play Player 1 (Deck 1) and Player 2 (Deck 2)">Player #1 vs Player #2</button></section>
            <section class="lmode"><h3>Play with the bot</h3>
              <button class="btn bot" data-act="soloBot" title="You play Deck 1; the bot plays Deck 2">🤖 Player vs Bot</button>
              <button class="btn bot" data-act="botsWatch" title="Two bots play Deck 1 and Deck 2; you watch. The finished game is saved to the game log for the bot to learn from">🤖 Bot vs Bot</button></section>
          </div>
          ${solo ? `<button class="btn" data-act="resume">Continue the last solo game</button>` : ""}</div>
        ${TB.campaignHTML ? TB.campaignHTML(slots, sel => opt(sel)) : ""}</div>
        <div class="lcol"><div class="lbox"><h2>Online</h2>
          <label>Your name <input id="lName" maxlength="20" value="${esc(ui.name)}"></label>
          <label>Deck <select id="lSlotO" data-lobby="so">${opt(L.so, true)}</select></label>
          ${L.so === "paste" ? `<label>Deck list (Deck Builder → Export → List (text), one deck) <textarea id="lPaste" rows="6" placeholder="4 x A3-20 2783  おばけ屋敷バイト">${esc(ui.pasteText || "")}</textarea></label>` : ""}
          <label>Players <select id="lSeats"><option>2</option><option>3</option><option>4</option></select></label>
          <button class="btn pri" data-act="create"${TB.onlineReady() ? "" : " disabled title=\"Firebase is not set up (assets/firebase-config.js)\""}>Create a room</button>
          <button class="btn" data-act="createTest" title="Two tabs of this browser play each other">Test room on this computer</button>
          <hr><label>Room code <input id="lCode" maxlength="9" placeholder="4ABCDE or TEST-ABCD" autocomplete="off" value="${esc(L.code || "")}"></label>
          <button class="btn" data-act="joinCode">Join / watch</button></div>
        <div class="lbox"><h2>Replay</h2><p class="muted">Watch a saved game again (a replay file from “Save replay” in the Log).</p>
          <label class="btn" style="display:inline-block">Open a replay file (.json)<input type="file" id="rpFile" accept=".json,application/json" hidden></label></div></div>
      </div></div>`;
  }

  /* ---------- render ---------- */
  /** Pack (Revise#127): when another player's cost goes back to the hand (Offensive / Defensive / Infinity,
      "このエフェクトのコストを手札に戻す" …), a pop-up shows those power cards: 5 s, then it fades for 2 s.
      Another return in the meantime adds its cards and starts the 5 s again. Hover keeps it open; click a card to enlarge it. */
  /** Lethal Damage warning (Pack, Revise#185): an opponent's character attacks you and its Attack + your Draw ≥ your Deck →
      a small red pop-up for 1 s, then it fades away. It never blocks a click (like the cost pop-up). */
  const lpop = { seen: null, room: null };
  TB.lethalCheck = (S, ev) => {
    if (ev.e !== "attacked" || !ev.target || ev.target.seat == null || ev.faction) return null;
    const def = ev.target.seat, ch = S.chars[ev.ch];
    if (!ch || ch.owner === def || !S.players[def] || !TB.mySeats().includes(def)) return null;
    const st = AA4.charStats(S, db, ev.ch), at = Math.max(0, +st.at || 0) + (+ev.boost || 0), draw = AA4.playerStats(S, db, def).draw, deck = S.players[def].zones.deck.length;
    return at + draw >= deck ? { seat: def, at, draw, deck, mental: !!st.atMental } : null;
  };
  const lethalPop = S => {
    const evs = ui.log.events();
    if (lpop.room !== ui.room || lpop.seen == null || lpop.seen > evs.length) { lpop.room = ui.room; lpop.seen = evs.length; return; }   // history (a reload, an undo): nothing
    const fresh = evs.slice(lpop.seen); lpop.seen = evs.length;
    let hit = null;
    for (const ev of fresh) hit = TB.lethalCheck(S, ev) || hit;
    if (hit) TB.lethalShow(S, hit);
  };
  TB.lethalShow = (S, hit) => {
    const old = document.getElementById("lethalPop"); if (old) old.remove();
    const el = document.createElement("div");
    el.id = "lethalPop"; el.className = "lethalpop"; el.setAttribute("role", "alert");
    el.innerHTML = `<b>⚠ Lethal Damage</b><small>Attack ${hit.mental ? "(" + hit.at + ")" : hit.at} + Draw ${hit.draw} ≥ Deck ${hit.deck}${S.players.filter(p => TB.mySeats().includes(p.seat)).length > 1 ? " · " + esc(S.players[hit.seat].name) : ""}</small>`;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add("fade"), 1000);
    setTimeout(() => el.remove(), 1700);
  };
  const cpop = { seen: null, room: null, items: [], t1: 0, t2: 0 };
  const costPop = S => {
    const evs = ui.log.events();
    if (cpop.room !== ui.room || cpop.seen == null || cpop.seen > evs.length) { cpop.room = ui.room; cpop.seen = evs.length; return; }   // history (a reload, an undo): no pop-up
    const fresh = evs.slice(cpop.seen); cpop.seen = evs.length;
    const mine = new Set(TB.mySeats());
    let added = false;
    for (const ev of fresh) {
      if (!((ev.e === "costSent" && ev.to === "hand") || ev.e === "costBack")) continue;
      const ids = (ev.cards || []).filter(id => S.cards[id]);
      if (!ids.length) continue;
      const owner = S.cards[ids[0]].owner;
      if (mine.has(owner)) continue;
      const down = ev.e === "costSent" && /^(Infinity|Offensive|Defensive)$/.test(ev.label || "");   // by a skill: face down (Pack, Revise#162)
      cpop.items.push({ seat: owner, down, label: ev.e === "costBack" ? "The cost comes back to the hand" : `${ev.label ? ev.label + ": " : ""}the cost goes back to the hand${down ? " (face down)" : ""}`, keys: ids.map(id => S.cards[id].key) });
      added = true;
    }
    if (added) showCostPop(S);
  };
  const showCostPop = S => {
    let el = document.getElementById("costPop");
    if (!el) {
      el = document.createElement("div"); el.id = "costPop"; el.className = "costpop"; el.setAttribute("role", "status");
      el.addEventListener("mouseenter", () => { el.classList.add("hold"); el.classList.remove("fade"); clearTimeout(cpop.t1); clearTimeout(cpop.t2); });
      el.addEventListener("mouseleave", () => { el.classList.remove("hold"); armCostPop(); });
      el.addEventListener("click", ev => {
        if (ev.target.closest("[data-cpx]")) { closeCostPop(); return; }
        const c = ev.target.closest("[data-cpk]");
        if (!c) return;
        const big = el.querySelector(".cpbig"), k = c.dataset.cpk, inf = info(k);
        if (!big || !inf) return;
        big.innerHTML = big.dataset.k === k ? "" : `<img alt="" src="${TB.img(inf.fid, 400)}" onerror="this.src='${TB.img2(inf.fid, 400)}'"><div class="cpbn">${esc(EN(inf))}</div>`;
        big.dataset.k = big.dataset.k === k ? "" : k;
      });
      document.body.appendChild(el);
    }
    el.innerHTML = `<div class="cph"><b>Cost back to the hand</b><button class="cpx" data-cpx title="Close" aria-label="Close">×</button></div>`
      + cpop.items.map(it => `<div class="cpi"><div class="cpw">${esc(S.players[it.seat] ? S.players[it.seat].name : "?")} · ${esc(it.label)}</div><div class="cpc">${it.down ? it.keys.map(() => `<span class="cpk"><div class="card back mini" style="${TB.sleeveStyle(S.players[it.seat] && S.players[it.seat].sleeve)}"></div></span>`).join("") : it.keys.map(k => `<button class="cpk" data-cpk="${esc(k)}" title="Click to enlarge">${faceKey(k, "mini")}</button>`).join("")}</div></div>`).join("")
      + `<div class="cpbig"></div>`;
    el.classList.remove("fade", "gone");
    armCostPop();
  };
  const armCostPop = () => {
    const el = document.getElementById("costPop");
    clearTimeout(cpop.t1); clearTimeout(cpop.t2);
    if (!el || el.classList.contains("hold")) return;
    cpop.t1 = setTimeout(() => { el.classList.add("fade"); cpop.t2 = setTimeout(closeCostPop, 2000); }, 5000);
  };
  const closeCostPop = () => { clearTimeout(cpop.t1); clearTimeout(cpop.t2); cpop.items = []; const el = document.getElementById("costPop"); if (el) el.remove(); };
  /** The turn order, once when the game starts (Pack, Revise#125): shown 3 s, then fades for 1 s.
     Your own seat has a pastel yellow star in a pastel pink frame; animated arrows run from the 1st to the last player. */
  const orderShown = {};
  const turnOrderPop = S => {
    const o = S.turn && S.turn.order || [];
    if (o.length < 2 || S.stage === "lobby" || S.stage === "over") return;
    const key = ui.room + ":" + (S.seed || "") + ":" + o.join(",");
    if (orderShown[key]) return;
    orderShown[key] = true;
    if (S.turn.number > 1) return;   // joined or reloaded mid-game: no pop-up
    const me = R.viewer, old = document.getElementById("orderPop"); if (old) old.remove();
    const ordn = i => ["1st", "2nd", "3rd", "4th", "5th", "6th"][i] || (i + 1) + "th";
    const el = document.createElement("div");
    el.id = "orderPop"; el.className = "orderpop"; el.setAttribute("role", "status");
    el.innerHTML = `<div class="opbox"><div class="opt">Turn order</div><div class="oprow">${o.map((seat, i) => (i ? `<span class="oparr" style="--d:${(i - 1) * 0.45}s"><i></i></span>` : "")
      + `<div class="opp${seat === me ? " me" : ""}" style="--d:${i * 0.45}s"><span class="opn">${ordn(i)}</span>${seat === me ? `<span class="opstar" title="You">★</span>` : ""}<b>${esc(S.players[seat] ? S.players[seat].name : "?")}</b>${seat === me ? `<span class="opyou">You</span>` : ""}</div>`).join("")}</div></div>`;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add("fade"), 3000);
    setTimeout(() => el.remove(), 4000);
  };
  /** Phone layout (Pack, Revise#280): the field is zoomed out to the screen width so both sides show without sideways scrolling */
  TB.fitPhone = () => {
    const t = document.querySelector(".tablewrap > .table"); if (!t) return;
    t.style.zoom = "";
    if (innerWidth > 600 || ui.opts.phoneFit === false) return;
    const avail = t.parentElement.clientWidth - 2, need = Math.max(t.scrollWidth, ...[...t.querySelectorAll(".row, .board")].map(r => r.scrollWidth));
    if (need > avail + 1) t.style.zoom = Math.max(0.35, avail / need).toFixed(3);
  };
  if (!TB._fitBound) { TB._fitBound = true; addEventListener("resize", () => TB.fitPhone && TB.fitPhone()); }
  TB.render = () => {
    const app = TB.$("app");
    if (!app) return;
    TB.applySize(ui.size);
    if (!ui.room || !ui.log) { app.innerHTML = location.hash === "#campaigndesign" && TB.designPageHTML ? TB.designPageHTML() : lobbyHTML(); return; }   // the Campaign Design page (Revise#382)
    if (!ui.ready) { app.innerHTML = `<div class="lobby"><p>${ui.error ? esc(ui.error) : "Opening the room…"}</p><button class="btn" data-act="leave">Back</button></div>`; return; }
    R = context();
    R.onPF = R.S.players.length ? onCharPF() : new Map();
    if (ui.lastVer !== R.S.version || ui.lastVerRoom !== ui.room) { ui.lastVer = R.S.version; ui.lastVerRoom = ui.room; ui.lastActAt = Date.now(); }   // stuck log: the last time anything happened
    const S = R.S, pos = S.players.length ? TB.positions(S, R.viewer) : [];
    const n = pos.length, layout = n <= 2 ? "two" : n === 3 ? "three" : "four";
    const keepScroll = TB.$("logLines") ? TB.$("logLines").scrollTop : null, logAtEnd = TB.$("logLines") ? TB.$("logLines").scrollHeight - TB.$("logLines").scrollTop - TB.$("logLines").clientHeight < 30 : true;
    const tw = TB.$("tablewrap"), sx = tw ? tw.scrollLeft : 0, sy = tw ? tw.scrollTop : 0;
    const sd0 = app.querySelector("aside.side"), sdy = sd0 ? sd0.scrollTop : 0, dr0 = TB.$("drBody"), dry = dr0 ? dr0.scrollTop : 0;   // the side panel keeps its scroll (Pack, Revise#162: it jumped to the top)
    const hc0 = TB.$("handCards"), hx = hc0 ? hc0.scrollLeft : 0, hy = hc0 ? hc0.scrollTop : 0;
    const keepEls = [".modal.pay .paygs", ".modal.pay", ".modal.dec .dopts", ".modal.det", ".modal.card"].map(q => { const el = app.querySelector(q); return [q, el ? el.scrollTop : null]; });   // the cost window / pop-ups keep their scroll when a card is picked (Pack, Revise#206)   // the hand stays where it was scrolled (Charge picks …)
    app.innerHTML = `<div class="game ${layout}">
      <div class="tablewrap" id="tablewrap"><div class="table">${pos.map(([seat, p]) => boardHTML(seat, p)).join("")}</div></div>
      <aside class="side">${controlsHTML()}${ui.netError ? `<div class="err neterr">${esc(ui.netError)}</div>` : ""}<div class="status">${statusHTML()}</div><div class="resolve"><div class="rh">Resolve</div><div class="acts">${actionsHTML()}</div>${stackHTML()}</div>
        ${takeHTML()}${fieldHTML()}${logHTML()}${ui.kind !== "solo" && !ui.replay ? `<div class="roominfo">Game ID <b class="code">${esc(ui.room)}</b><button class="btn sm" data-act="invite">Copy invite link</button></div>` : ""}</aside>
      ${ui.replay ? replayBarHTML() + (ui.replay.logOpen ? replayLogHTML() : "") : ""}${raidHTML()}${ui.replay ? "" : gameStatusHTML()}${handHTML()}${payHTML()}${decisionHTML()}${trigAskHTML()}${undoAskHTML()}${autoMsgHTML()}${drawerHTML()}${gameDrawerHTML()}${modalHTML()}${menuHTML()}</div>`;
    const rl = TB.$("rpLines"); if (rl) rl.scrollTop = rl.scrollHeight;
    const ll = TB.$("logLines");
    if (ll) ll.scrollTop = logAtEnd || keepScroll == null ? ll.scrollHeight : keepScroll;
    const tw2 = TB.$("tablewrap"); if (tw2) { tw2.scrollLeft = sx; tw2.scrollTop = sy; }
    const sd2 = app.querySelector("aside.side"); if (sd2) sd2.scrollTop = sdy;
    const dr2 = TB.$("drBody"); if (dr2) dr2.scrollTop = dry;
    const hc2 = TB.$("handCards"); if (hc2) { hc2.scrollLeft = hx; hc2.scrollTop = hy; }
    for (const [q, y] of keepEls) if (y) { const el = app.querySelector(q); if (el) el.scrollTop = y; }
    if (!ui.replay) { turnOrderPop(S); costPop(S); situationPop(S); lethalPop(S); }
    if (!ui.replay && ui.opts.autoAbility && !S.decisions.length) {   // "Run optional abilities without asking" (Q#64, Revise#165): this player's client runs them
      const tr = S.triggers.find(x => TB.mySeats().includes(x.seat) && x.optional && !(ui.autoRan || []).includes(x.id) && (ab => !(ab && ab.effect && ab.effect.target && ab.effect.target.count !== "all"))((info(S.cards[x.card].key).abilities || [])[x.ability]));
      if (tr) { (ui.autoRan = ui.autoRan || []).push(tr.id); setTimeout(() => TB.send({ t: "trigger", trigger: tr.id, run: true, seat: tr.seat }), 0); }
    }
    TB.passAllStep(S);
    TB.fitPhone();
    TB.decorateModals(app);
    { const Rc = TB.ctx && TB.ctx(); if (Rc && Rc.fieldPick) for (const k of Rc.fieldPick.picked) {   // already chosen (Revise#246): marked as chosen
        const m = /^area:(\d+):(active|control)$/.exec(k), sel = m ? `[data-board="${m[1]}"] ${m[2] === "active" ? ".row.act" : ".row.front, [data-board=\"" + m[1] + "\"] .row.back"}` : /^seat:(\d+)$/.test(k) ? `.pile.player[data-player="${k.slice(5)}"]` : /^ch:/.test(k) ? `.ch[data-ch="${k.slice(3)}"]` : null;
        if (sel) for (const el of app.querySelectorAll(sel)) el.classList.add("fpicked"); }
      if (Rc) for (const k of Rc.tgt) { const m = /^area:(\d+):(active|control)$/.exec(k); if (!m) continue;   // areas to click (Revise#245)
        for (const row of app.querySelectorAll(`[data-board="${m[1]}"] ${m[2] === "active" ? ".row.act" : ".row.front, [data-board=\"" + m[1] + "\"] .row.back"}`)) { row.classList.add("tgt", "areatgt"); row.dataset.areakey = k; row.title = "Click to choose this area"; } } }
    if (ui.handPos && innerWidth > 900 && !ui.handDock) { const h = TB.$("hand"); if (h) Object.assign(h.style, { left: ui.handPos.x + "px", top: ui.handPos.y + "px", bottom: "auto", transform: "none" }); }
    TB.handRoom();
  };
  /** Pack (Revise#323): a hand at the bottom of the screen (any Size, expanded or not) never hides the Control Area (Back) —
      the table gets room under it as tall as the part of the screen the hand covers, so the last row scrolls up above the hand. */
  TB.handRoom = () => {
    const tw = TB.$("tablewrap"), h = TB.$("hand");
    if (!tw) return;
    if (!h || innerWidth <= 900) { tw.style.paddingBottom = ""; return; }
    const r = h.getBoundingClientRect(), atBottom = r.bottom > innerHeight - 60;
    tw.style.paddingBottom = atBottom ? Math.max(24, Math.ceil(innerHeight - r.top) + 12) + "px" : "";
    if (!TB._handRO && window.ResizeObserver) { TB._handRO = new ResizeObserver(() => TB.handRoom()); }
    if (TB._handRO && TB._handRO._el !== h) { TB._handRO.disconnect(); TB._handRO.observe(h); TB._handRO._el = h; }
  };
  addEventListener("resize", () => TB.handRoom && TB.handRoom());
})();
