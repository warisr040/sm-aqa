/* ==========================================================================
   v4 engine · legal actions   (requirements_v4 §20.3: "legalActions() is the ONLY answer to 'can I do this?'")

   AA4.candidates(S, db, by, seat, opts) → every concrete intent this seat could send now that the engine
   accepts (each one passed AA4.check). The UI uses it for highlights (playable cards = pastel yellow, valid
   targets = running blue) and greyed buttons; tests use it to play random legal games.
   AA4.explain(S, db, by, seat) → the main actions with ok / reason ("Attack banned by 「X」"), for buttons.
   opts.manual = include by-hand tools (move / moveChar / shuffle / draw); opts.limit = max per kind.
   ========================================================================== */
(function (G) {
  "use strict";
  const AA4 = G.AA4;

  function* combos(list, k, max = 6) {   // a few k-subsets of a list (first ones, then the last ones)
    if (k === 0) { yield []; return; }
    if (list.length < k) return;
    yield list.slice(0, k);
    if (list.length > k) yield list.slice(-k);
    let n = 2;
    for (let i = 0; i + k <= list.length && n < max; i++, n++) yield list.slice(i, i + k);
  }

  AA4.candidates = (S, db, by, seat, opts = {}) => {
    const out = [], base = { by, seat };
    const lim = opts.limit || 8;
    const add = it => { const x = Object.assign({}, base, it); if (!AA4.check(S, x, db)) out.push(x); };
    if (S.stage === "lobby" || S.stage === "over") return out;
    if (S.stage === "mulligan") { add({ t: "mulligan" }); add({ t: "keep" }); return out; }
    const p = S.players[seat];
    if (!p || p.lost) return out;
    // choices first: nothing else can happen while one waits
    for (const d of S.decisions.filter(x => x.seat === seat)) {
      if (d.kind === "order") { add({ t: "choose", decision: d.id, pick: d.options.slice() }); continue; }
      for (let k = d.min; k <= Math.min(d.max, d.min + 1); k++) for (const pick of combos(d.options, k, 3)) add({ t: "choose", decision: d.id, pick });
    }
    if (S.decisions.length) return out;
    for (const tr of S.triggers.filter(x => x.seat === seat)) {
      add({ t: "trigger", trigger: tr.id, run: false });
      const ab = db.card(S.cards[tr.card].key).abilities[tr.ability], spec = ab.effect && ab.effect.target;
      if (!spec || spec.count === "all") add({ t: "trigger", trigger: tr.id, run: true });
      else for (const t of combos(AA4.targetCandidates(S, db, spec, { seat, ch: tr.ch, card: tr.card }), spec.count || 1, 3)) add({ t: "trigger", trigger: tr.id, run: true, targets: t });
    }
    const d = S.draft;
    if (d) {
      if (d.seat !== seat) return out;
      add({ t: "cancel" });
      if (d.step === "pay") {
        const power = d.payFrom.flatMap(ch => S.chars[ch] ? S.chars[ch].power : []);
        if (d.cost == null) { for (let k = 1; k <= Math.min(3, power.length); k++) for (const cards of combos(power, k, 2)) add({ t: "pay", cards }); }
        else for (const cards of combos(power, d.cost, 3)) add({ t: "pay", cards });
      } else if (d.step === "target") {
        const n = AA4.draftCount(d);
        if (d.spec.kind === "multi") {   // pick part by part: first options, and last options
          for (const pickLast of [false, true]) {
            const got = [];
            for (let k = 0; k < n; k++) { const c = AA4.draftTargets(S, db, d, got); if (!c.length) break; got.push(pickLast ? c[c.length - 1] : c[0]); }
            add({ t: "target", targets: got });
          }
        } else {
          const cand = AA4.draftTargets(S, db, d);
          for (const t of combos(cand, n, lim)) add({ t: "target", targets: t });
          if (d.spec.upTo) for (let k = 1; k < n; k++) for (const t of combos(cand, k, 2)) add({ t: "target", targets: t });
        }
      }
      return out;
    }
    add({ t: "pass" }); add({ t: "noGuard" }); add({ t: "next" });
    // declarations
    for (const card of p.zones.hand) {
      const inf = db.card(S.cards[card].key) || {};
      if (inf.play && inf.play.modes) inf.play.modes.forEach((m, i) => add({ t: "declare", kind: "set", card, mode: i }));   // Revise#164
      else add({ t: "declare", kind: "set", card });
      if (inf.asBreak) add({ t: "declare", kind: "set", card, asBreak: true });
      if (inf.asFast) add({ t: "declare", kind: "set", card, asFast: true });
      if (inf.altMill) add({ t: "declare", kind: "set", card, alt: "mill" });
      if (AA4.millAltOffer && AA4.millAltOffer(S, db, seat, inf)) add({ t: "declare", kind: "set", card, alt: "millExtra" });   // Q#59
      if (inf.asCharIfName || (inf.type === "Break" && AA4.allMods(S, db).some(m => m.key === "breakAsChar" && AA4.modAppliesToSeat(S, m, seat)))) add({ t: "declare", kind: "set", card, asChar: true });   // 迦陵頻伽 (Revise#143)
      if (inf.guardFromHand && S.battle && S.battle.step === "guard" && S.battle.defender === seat) add({ t: "declare", kind: "set", card, guardSet: true });   // エラキス (Q#41)   // Revise#128   // "…のブレイクカードとして使用宣言可能"
      if (AA4.searchOf(S, db, seat, card)) add({ t: "search", card });
    }
    for (const card of p.zones.damage) if (AA4.dmgPlayable(S, db, seat, card)) add({ t: "declare", kind: "set", card });
    for (const ch of AA4.charsOf(S, seat).concat(AA4.puppetsOf ? AA4.puppetsOf(S, seat) : [])) {
      const c = S.chars[ch];
      for (const card of [AA4.topOf(c)].concat(c.perm)) AA4.effectsOf(S, db, ch, card).forEach((ef, i) => {
        add({ t: "declare", kind: "effect", ch, card, i });   // cost X: fixed by the text, or the player pays freely (Revise#086)
      });
      for (const s of AA4.living(S)) if (s !== seat) add({ t: "declare", kind: "attack", ch, target: { seat: s } });
      for (const slot of AA4.SLOTS) { const a = AA4.activeCharOf(S, seat, slot); if (a) add({ t: "declare", kind: "attack", ch, target: { ch: a } }); }
      if (AA4.charStats(S, db, ch).attackChars.length) for (const o of Object.keys(S.chars)) if (S.chars[o].owner !== seat) add({ t: "declare", kind: "attack", ch, target: { ch: o } });
      else for (const o of Object.keys(S.chars)) if (S.chars[o].owner !== seat && (AA4.charStats(S, db, o).attackableBy || []).length) add({ t: "declare", kind: "attack", ch, target: { ch: o } });   // "…キャラクターを目標にアタック宣言可能" (Revise#109)
      { const bs = AA4.charStats(S, db, ch).skills.boost, bmax = !bs ? 0 : typeof bs === "number" ? bs : Math.max(1, c.power.length);   // every Boost value, not only 1 (Pack report A3-20 2673 "ブースト2", Revise#325)
        for (let k = 1; k <= Math.min(bmax, 9); k++) for (const s of AA4.living(S)) if (s !== seat) add({ t: "declare", kind: "attack", ch, target: { seat: s }, boost: k }); }
      add({ t: "declare", kind: "guard", ch });
      add({ t: "declare", kind: "join", ch });
    }
    // Charge Phase
    if (S.turn.phase === "charge" && S.turn.player === seat) {   // every hand card can be charged (on the first character that takes one)
      const tg = AA4.chargeTargets(S, db, seat);
      for (const ch of tg.slice(0, lim)) add({ t: "charge", ch, fromDeck: true });
      if (tg.length) for (const card of p.zones.hand) add({ t: "charge", ch: tg[0], card });
      for (const ch of tg.slice(1, lim)) if (p.zones.hand.length) add({ t: "charge", ch, card: p.zones.hand[0] });
    }
    if (opts.manual) {
      add({ t: "shuffle" }); add({ t: "draw", n: 1 });
      for (const card of p.zones.hand.slice(0, 3)) for (const to of AA4.moveDestinations(S, db, seat, card).slice(0, 4)) add({ t: "move", card, to });
      for (const ch of AA4.charsOf(S, seat).slice(0, 3)) for (const to of AA4.charDestinations(S, db, seat, ch)) add({ t: "moveChar", ch, to });
    }
    return out;
  };

  /** Buttons with ok / reason (for "Why can't I?", §20.10). */
  AA4.explain = (S, db, by, seat) => ["next", "pass", "noGuard"].map(t => { const why = AA4.check(S, { t, by, seat }, db); return { t, ok: !why, reason: why || undefined }; });
})(typeof globalThis !== "undefined" ? globalThis : window);
