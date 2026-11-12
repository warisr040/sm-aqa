/* ==========================================================================
   v4 game table · motion (Pack, Revise#286)

   The table is drawn again from scratch on every change (innerHTML), so motion is added around TB.render:
   - cards glide from where they were to where they are now (FLIP, by data-card), new cards fade in,
     cards that left the table / hand fade out where they were;
   - pop-ups (.modal) and drawers fade + scale in when they open and fade out when they close
     (matched across renders by kind + title, so a pop-up that stays open is not animated again).
   Subtle (150–240 ms), never blocks a click, and off when the device asks for reduced motion.
   ========================================================================== */
(() => {
  "use strict";
  const TB = window.TB;
  if (!TB || !TB.render || TB._motion) return;
  TB._motion = true;
  const reduce = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } };
  const EASE = "cubic-bezier(.2,.8,.2,1)";
  const CARD_SEL = "#tablewrap .card[data-card], #tablewrap .permc[data-card], #handCards .card[data-card]";
  const POP_SEL = ".modal, .drawer";
  const popKey = el => { const cls = [...el.classList].filter(c => !/^(slide|mo-in|pz-\w+)$/.test(c)).sort().join("."), h = el.querySelector(".mh, .drh"); return cls + "|" + (h ? h.textContent.trim().slice(0, 60) : ""); };
  const zoomOf = el => { const t = el.closest(".table"); return t && t.style.zoom ? parseFloat(t.style.zoom) || 1 : 1; };
  const snapCards = app => {
    const m = new Map(), dup = new Set();
    for (const el of app.querySelectorAll(CARD_SEL)) {
      const id = el.dataset.card; if (dup.has(id)) continue;
      if (m.has(id)) { m.delete(id); dup.add(id); continue; }
      const r = el.getBoundingClientRect(); if (!r.width) continue;
      m.set(id, { r, el });
    }
    return m;
  };
  const ghost = (el, r, cls) => {   // a picture of what left, at the place it was
    const g = el.cloneNode(true);
    g.removeAttribute("id"); g.querySelectorAll("[id]").forEach(x => x.removeAttribute("id"));
    g.setAttribute("aria-hidden", "true"); g.inert = true;
    g.classList.add("mo-ghost", cls);
    Object.assign(g.style, { position: "fixed", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px", margin: "0", pointerEvents: "none", zIndex: cls === "mo-pop" ? "60" : "35" });
    if (cls === "mo-pop") Object.assign(g.style, { transform: "none", maxHeight: "none" });
    document.body.appendChild(g);
    const a = g.animate([{ opacity: 1, scale: "1" }, { opacity: 0, scale: cls === "mo-pop" ? ".97" : ".85" }], { duration: cls === "mo-pop" ? 150 : 180, easing: "ease-in", fill: "forwards" });
    const done = () => g.remove(); a.onfinish = done; setTimeout(done, 400);
  };
  /* ---------- effects (Pack, Revise#307): battle line, damage pop, break burst ---------- */
  const snapFx = app => {
    const piles = {}, tops = {};
    for (const el of app.querySelectorAll('.pile[data-pile="damage"][data-seat], .pile[data-pile="discard"][data-seat]')) { const n = el.querySelector(".pn"); piles[el.dataset.pile + ":" + el.dataset.seat] = n ? +n.textContent || 0 : 0; }
    for (const ch of app.querySelectorAll("#tablewrap .ch[data-ch]")) { const t = ch.querySelector(".struct .top[data-card]"); if (t) tops[ch.dataset.ch] = t.dataset.card; }
    return { piles, tops };
  };
  const floatText = (el, text, cls) => {
    const r = el.getBoundingClientRect(); if (!r.width) return;
    const f = document.createElement("div"); f.className = "mo-float " + cls; f.textContent = text;
    Object.assign(f.style, { left: r.left + r.width / 2 + "px", top: r.top + r.height * .35 + "px" });
    document.body.appendChild(f);
    const a = f.animate([{ opacity: 0, translate: "-50% 6px", scale: ".7" }, { opacity: 1, translate: "-50% -14px", scale: "1.1", offset: .25 }, { opacity: 0, translate: "-50% -46px", scale: "1" }], { duration: 1100, easing: "ease-out", fill: "forwards" });
    const done = () => f.remove(); a.onfinish = done; setTimeout(done, 1500);
  };
  const playFx = (app, fx0) => {
    if (!fx0) return;
    for (const el of app.querySelectorAll('.pile[data-pile="damage"][data-seat]')) {   // damage taken: "+N" over the Damage Pile and a red pulse
      const k = "damage:" + el.dataset.seat, n = el.querySelector(".pn"), now = n ? +n.textContent || 0 : 0, was = fx0.piles[k];
      if (was != null && now > was) { floatText(el, "+" + (now - was), "dmg"); el.animate([{ boxShadow: "0 0 0 0 rgba(255,70,90,.0)" }, { boxShadow: "0 0 0 6px rgba(255,70,90,.55)" }, { boxShadow: "0 0 0 0 rgba(255,70,90,0)" }], { duration: 700, easing: "ease-out" }); }
    }
    for (const ch of app.querySelectorAll("#tablewrap .ch[data-ch]")) {   // a Break card set on it: a gold burst
      const t = ch.querySelector(".struct .top[data-card]"), was = fx0.tops[ch.dataset.ch];
      if (t && was && was !== t.dataset.card) {
        const r = document.createElement("div"); r.className = "mo-burst"; ch.querySelector(".struct").appendChild(r);
        const a = r.animate([{ opacity: .95, scale: ".6" }, { opacity: 0, scale: "1.6" }], { duration: 650, easing: "ease-out", fill: "forwards" }); a.onfinish = () => r.remove(); setTimeout(() => r.remove(), 900);
      }
    }
    battleLine(app);
  };
  /** The attack shown as a glowing arrow from the attacker to its target (or the guard) while a battle is on. */
  function battleLine(app) {
    let svg = document.getElementById("moBattle");
    const S = TB.ui && TB.ui.log && TB.ui.log.state, b = S && S.battle;
    const cen = el => { const r = el.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2, r } : null; };
    const from = b && app ? app.querySelector(`#tablewrap .ch[data-ch="${b.attacker}"] .struct`) : null;
    let to = null;
    if (b && app) to = (b.guard && app.querySelector(`#tablewrap .ch[data-ch="${b.guard}"] .struct`)) || (b.target && b.target.ch && app.querySelector(`#tablewrap .ch[data-ch="${b.target.ch}"] .struct`)) || (b.target && b.target.seat != null && app.querySelector(`.pile.player[data-player="${b.target.seat}"]`)) || null;
    const A = from && cen(from), B = to && cen(to);
    if (!A || !B || reduce()) { if (svg) svg.remove(); return; }
    if (!svg) { svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.id = "moBattle"; svg.setAttribute("aria-hidden", "true"); document.body.appendChild(svg); }
    const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1, bend = Math.min(80, len * .22);
    const cx = mx - dy / len * bend, cy = my + dx / len * bend, guard = !!b.guard;
    svg.innerHTML = `<defs><marker id="moArr" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${guard ? "#7ad1ff" : "#ff5a6e"}"/></marker></defs>`
      + `<path class="mo-bl-glow" d="M${A.x} ${A.y} Q${cx} ${cy} ${B.x} ${B.y}" stroke="${guard ? "#7ad1ff" : "#ff5a6e"}"/><path class="mo-bl" d="M${A.x} ${A.y} Q${cx} ${cy} ${B.x} ${B.y}" stroke="${guard ? "#bfe8ff" : "#ffd0d6"}" marker-end="url(#moArr)"/>`;
  }
  const orig = TB.render;
  TB.render = function () {
    const app = TB.$ && TB.$("app");
    if (!app || reduce() || !app.querySelector(".game")) { const r = orig.apply(this, arguments); TB._lastRoom = TB.ui && TB.ui.room; return r; }
    const sameRoom = TB._lastRoom === (TB.ui && TB.ui.room);
    const before = snapCards(app), fx0 = snapFx(app);
    const pops = new Map(); for (const el of app.querySelectorAll(POP_SEL)) pops.set(popKey(el), { el: el.cloneNode(true), r: el.getBoundingClientRect() });
    const res = orig.apply(this, arguments);
    TB._lastRoom = TB.ui && TB.ui.room;
    if (!sameRoom || !app.querySelector(".game")) return res;
    try {
      // pop-ups: in / out
      const now = new Set();
      for (const el of app.querySelectorAll(POP_SEL)) { const k = popKey(el); now.add(k); if (!pops.has(k) && !el.classList.contains("slide")) el.animate([{ opacity: 0, scale: ".96", translate: "0 6px" }, { opacity: 1, scale: "1", translate: "0 0" }], { duration: 200, easing: EASE }); }
      for (const [k, p] of pops) if (!now.has(k) && p.r.width) ghost(p.el, p.r, "mo-pop");
      // cards: glide / in / out
      const after = snapCards(app);
      if (before.size && after.size) {
        let fresh = 0; for (const id of after.keys()) if (!before.has(id)) fresh++;
        const bulk = fresh > 10;   // a new view / a reload: no "new card" motion
        for (const [id, { r, el }] of after) {
          const b = before.get(id);
          if (b) {
            const z = zoomOf(el), dx = (b.r.left - r.left) / z, dy = (b.r.top - r.top) / z, sx = b.r.width / r.width, sy = b.r.height / r.height;
            if (Math.abs(dx) + Math.abs(dy) < 2 && Math.abs(sx - 1) < .02) continue;
            if (Math.abs(dx) > innerWidth * 1.5 || Math.abs(dy) > innerHeight * 1.5) continue;
            el.animate([{ transformOrigin: "0 0", translate: `${dx}px ${dy}px`, scale: `${sx} ${sy}` }, { transformOrigin: "0 0", translate: "0 0", scale: "1 1" }], { duration: 240, easing: EASE });
          } else if (!bulk) el.animate([{ opacity: 0, scale: ".88" }, { opacity: 1, scale: "1" }], { duration: 200, easing: EASE });
        }
        let gone = 0; for (const id of before.keys()) if (!after.has(id)) gone++;
        if (gone <= 6) for (const [id, b] of before) if (!after.has(id)) ghost(b.el, b.r, "mo-card");
      }
      playFx(app, fx0);
    } catch (e) { /* motion is only decoration */ }
    return res;
  };
  if (!TB._battleLineBound) { TB._battleLineBound = true; addEventListener("resize", () => battleLine(TB.$ && TB.$("app"))); document.addEventListener("scroll", () => battleLine(TB.$ && TB.$("app")), true); }
})();
