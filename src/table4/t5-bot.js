/* ==========================================================================
   v4 game table · vs Bot (Pack, Revise#308) · Bot vs Bot (Pack, Revise#311)

   Solo "vs Bot": the player plays Deck 1 (seat 0); the computer plays Deck 2 (seat 1) with AA4.botChoose
   (src/engine/20-bot.js). "Watch two bots": the computer plays both seats and the player watches (with
   Pause / Play and a speed). After each drawing of the table, when it is a bot's turn or something waits for
   it (a choice, an ability, a guard, a response), it makes one move after a short pause, so the player can
   follow it; the table draws again and it goes on. The room code is remembered, so "Continue the last solo
   game" keeps the bot(s). A finished game goes to the game log (TB.keepSolo) for the bot to learn from.
   ========================================================================== */
(() => {
  "use strict";
  const TB = window.TB;
  if (!TB || !TB.render || TB._botWrap) return;
  TB._botWrap = true;
  const ui = TB.ui;
  let timer = null, lastKey = "", same = 0, cancels = 0;
  const conf = () => { try { const b = TB.store && TB.store.get("aa4-bot", null); return b && ui.room && b.room === ui.room && ui.kind === "solo" ? b : null; } catch (e) { return null; } };
  /** The bot seats of this Solo game: [] / [1] (vs Bot) / [0, 1] (Bot vs Bot). */
  TB.botSeats = () => { const b = conf(); return !b ? [] : Array.isArray(b.seats) ? b.seats.slice() : b.seat != null ? [b.seat] : []; };
  TB.botSeat = () => { const s = TB.botSeats(); return s.length ? s[0] : null; };
  TB.botsWatching = () => TB.botSeats().length > 1;
  // the seat the game waits for first (a response window: the one with priority); otherwise any bot seat with something to do
  const due = S => { const bots = TB.botSeats().filter(seat => AA4.botTurn(S, seat)); if (!bots.length) return null; const a = AA4.actingSeat ? AA4.actingSeat(S) : null; if (bots.includes(a) && same < 2) return a; return bots[same % bots.length]; };
  const delay = S => (S.stage === "mulligan" ? 300 : 650) / (TB.botsWatching() ? (ui.botSpeed || 1) : 1);
  const tick = () => {
    timer = null;
    if (!ui.log || ui.replay || (TB.botsWatching() && ui.botPaused)) return;
    const S = ui.log.state, seat = due(S); if (seat == null) return;
    // the same state again and again (a move the engine keeps refusing): stop instead of looping
    const key = S.version + ":" + S.stage + ":" + (S.turn && S.turn.phase);
    same = key === lastKey ? same + 1 : 0; lastKey = key;
    if (same > 6) { TB.toast(TB.botsWatching() ? "The bots can't find a move here — the game stops" : "The bot can't find a move here — play its turn by hand (View: Player 2)"); return; }
    let it = null;
    try { const b = conf(); it = AA4.botChoose(S, TB.db, seat, ui.cid, Object.assign({ noise: 0.15 }, b && b.style ? { style: b.style } : {})); } catch (e) { console.warn("bot", e); }   // style: the Campaign deck's playstyle (Revise#379)
    const v0 = S.version;
    // a safety net (Pack's replays, Revise#394): the bot declares, cancels, declares … — after three cancels in a row it moves on instead
    if (it && it.t === "cancel") cancels++; else if (it && !(it.t === "declare" && cancels)) cancels = 0;
    if (cancels >= 3 && !S.draft) { let alt = null; try { alt = AA4.candidates(S, TB.db, ui.cid, seat, { manual: false }).find(x => x.t === "next" || x.t === "pass" || x.t === "noGuard"); } catch (e) { /* */ } if (alt) { it = alt; cancels = 0; } }
    if (it) { delete it.by; TB.send(Object.assign({}, it, { seat }), true); }
    // refused (nothing changed, so the table is not drawn again): try again soon — the other seat after two tries
    setTimeout(() => { if (!timer && ui.log && ui.log.state.version === v0 && due(ui.log.state) != null) timer = setTimeout(tick, 200); }, 50);
  };
  /** Pause / Play and the speed, while two bots play (Revise#311). */
  const bar = () => {
    let el = document.getElementById("botBar");
    const on = TB.botsWatching() && ui.log && ui.log.state.stage !== "lobby" && !ui.replay;
    if (!on) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement("div"); el.id = "botBar"; el.className = "botbar"; document.body.appendChild(el); }
    const S = ui.log.state, sp = ui.botSpeed || 1, rd = s => { try { return Math.round(AA4.botReady(S, TB.db, s) * 100); } catch (e) { return 0; } };
    // the named Break cards each bot plans around, by job (Pack, Revise#332)
    const roles = S.players.map(p => { let l = []; try { l = AA4.botPlan(S, TB.db, p.seat).slice(0, 4); } catch (e) { /* */ } return `${p.name}: ` + (l.map(x => `${x.role} ${x.en} (cost ${x.cost})`).join(", ") || "no named Break cards"); }).join("\n");
    const plan = S.stage === "play" ? S.players.map(p => `${p.name}: ${rd(p.seat) >= 100 ? "attack" : "build " + rd(p.seat) + "%"}`).join(" · ") : "";
    el.innerHTML = `<b>🤖 vs 🤖</b><button class="btn sm" data-act="botPause">${ui.botPaused ? "▶ Play" : "⏸ Pause"}</button>`
      + [1, 2, 4].map(x => `<button class="btn sm${x === sp ? " pri" : ""}" data-act="botSpeed" data-speed="${x}">${x}×</button>`).join("")
      + (plan ? `<small title="${TB.esc("Build first, fight when the attack is there: ready = the attack of the Controlled Characters against the damage still needed.\n" + roles)}">${plan}</small>` : "");
  };
  const orig = TB.render;
  TB.render = function () {
    const r = orig.apply(this, arguments);
    try { bar(); } catch (e) { /* the bar is a helper only */ }
    if (ui.log && !timer && due(ui.log.state) != null && !(TB.botsWatching() && ui.botPaused)) timer = setTimeout(tick, delay(ui.log.state));
    return r;
  };
})();
