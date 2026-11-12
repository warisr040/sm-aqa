/* ==========================================================================
   v4 engine · game event → log line (English, with English card names; the Japanese name when a card has none)

   AA4.describe(ev, S, db, viewer) — S is the state the line is shown with
   (names of players), the card key comes from the event itself, already hidden
   by AA4.projectEvents when the viewer couldn't see it.
   ========================================================================== */
(function (G) {
  "use strict";
  const AA4 = G.AA4;
  const ZONE_TEXT = { deck: "deck", hand: "hand", discard: "Discard Pile", damage: "Damage Pile", removed: "removed from the game",
                      special: "Special Area", cost: "Cost screen", declared: "declaration" };
  const AREA_TEXT = { active: "Active Area", front: "Control Area (Front)", back: "Control Area (Back)" };
  const ROLE_TEXT = { stack: "on", power: "as a power card on", perm: "as a permanent on" };

  AA4.describe = (ev, S, db, viewer) => {
    const name = seat => (S.players[seat] ? S.players[seat].name : "Someone");
    const card = key => AA4.cardName(key && db && db.card(key));
    const chName = id => { const ch = S.chars[id]; const top = ch && S.cards[AA4.topOf(ch)]; return top && AA4.canSee(S, viewer, top.id) ? card(top.key) : "a character"; };
    const where = pl => {
      if (pl.z === "char") return `${ROLE_TEXT[pl.role]} ${chName(pl.ch)}`;
      if (AA4.AREAS.includes(pl.z)) return AREA_TEXT[pl.z];
      return ZONE_TEXT[pl.z] || pl.z;
    };
    switch (ev.e) {
      case "created": return ev.mode === "online" ? `Room created for ${ev.seats} players` : ev.mode === "solo1" ? "Solo play (one deck)" : "Solo play (two decks)";
      case "joined": return `${ev.name} sits down with “${ev.deckName || "a deck"}” (${ev.cards} cards)`;
      case "watching": return `${ev.name} is watching`;
      case "order": return (ev.chosen ? "Turn order (chosen): " : "Coin toss — turn order: ") + ev.order.map((s, i) => `${i + 1}. ${name(s)}`).join(", ");
      case "stage": return ev.stage === "mulligan" ? "Opening hands: keep or re-shuffle" : ev.stage === "play" ? "The game begins" : ev.stage === "over" ? "The game is over" : "";
      case "shuffled": return `${name(ev.seat)} shuffles the deck`;
      case "revealed": return `${name(ev.seat)} reveals ${(ev.keys || []).map(k => card(k)).join(", ") || "no cards"}`;   // Revise#310
      case "drew": return `${name(ev.seat)} draws ${ev.n}${ev.n < ev.wanted ? ` of ${ev.wanted} — the deck is empty` : ""}`;
      case "deckEmpty": return `${name(ev.seat)}'s deck has no cards left`;
      case "deckOut": return `${name(ev.seat)}'s deck is empty`;
      case "autoMulligan": return `${name(ev.seat)}: Auto Re-shuffle — ${ev.ok ? (ev.tries ? `the hand matches after ${ev.tries} re-shuffle${ev.tries === 1 ? "" : "s"}` : "the hand already matches") : `no match in ${ev.tries} re-shuffles (Auto Re-shuffle ×${ev.runs})`}`;
      case "mulligan": return `${name(ev.seat)} re-shuffles the hand into the deck${ev.n > 1 ? ` (×${ev.n})` : ""}`;
      case "kept": return `${name(ev.seat)} keeps the hand`;
      case "turn": return `Turn ${ev.number}: ${name(ev.player)}`;
      case "phase": return `${name(ev.player)} · ${AA4.PHASE_NAMES[ev.phase]}`;
      case "moved": {
        const owner = S.cards[ev.card] ? S.cards[ev.card].owner : -1;
        if (ev.to.z === "char" && ev.to.role === "stack" && ev.from.z !== "char" && S.chars[ev.to.ch] && S.chars[ev.to.ch].stack[0] === ev.card) return null;   // shown by charNew
        if (ev.from.z === "deck" && ev.to.z === "hand") return null;   // shown by "drew"
        if (ev.from.z === "hand" && ev.to.z === "deck" && S.stage === "mulligan") return null;
        if (["cost", "declared"].includes(ev.to.z) || ev.from.z === "cost" || (ev.to.z === "special" && ev.from.z === "hand")) return null;   // shown by paid / costSent / declared
        if (ev.from.z === "declared" || (ev.to.z === "char" && ev.to.role !== "power" && ev.from.z === "declared")) return null;
        const fromTxt = ev.from.z === ev.to.z ? "" : ` from ${ev.from.z === "char" ? where(ev.from).replace(/^(on|as a power card on|as a permanent on) /, "") : where(ev.from)}`;
        const toTxt = ev.to.z === "char" ? ` ${where(ev.to)}` : ` to ${ev.to.z === "deck" && ev.to.pos === "bottom" ? "the bottom of the deck" : where(ev.to)}`;
        return `${name(owner)}: ${card(ev.key)}${fromTxt}${toTxt}`;
      }
      case "charNew": { const ch = S.chars[ev.ch]; return `${name(ev.owner)} puts ${ch ? chName(ev.ch) : "a character"} into the ${AREA_TEXT[ev.at.area]}`; }
      case "charMoved": return `${chName(ev.ch)} moves to the ${AREA_TEXT[ev.to.area]}${ev.to.area === "front" && ev.to.sec ? ` (${ev.to.sec})` : ""}`;
      case "handSorted": return `${name(ev.seat)} sorts the hand`;
      case "charsSorted": return `Sorted ${ev.area === "front" ? `Control · Front${ev.sec && ev.sec !== "center" ? " " + ev.sec : ""}` : "Control · Back"}: ${ev.order.map(id => chName(id)).join(" → ")}`;
      case "charGone": return null;
      case "chat": return `${ev.seat >= 0 ? name(ev.seat) : (S.spectators[ev.cid] || "Someone")}: ${ev.text}`;
      case "renamed": return `${ev.from} is now called ${ev.name}`;
      // ---- B2: turn and declarations
      case "drawSkipped": return `${name(ev.seat)} skips the draw (first turn)`;
      case "phaseSkipped": return `${name(ev.player)} skips the ${AA4.PHASE_NAMES[ev.phase]}`;
      case "removePaid": return `${chName(ev.ch)}: Remove ${ev.x} paid`;
      case "removeReturned": return `${chName(ev.ch)}: Remove ${ev.x} not paid — back to the Active Area`;
      case "overPermanent": return `${chName(ev.ch)}: ${ev.perm} permanents, limit ${ev.limit}`;
      case "permMoved": return `Permanent ${card(S.cards[ev.card] && S.cards[ev.card].key)} → ${ev.to === "char" ? chName(ev.ch) : { hand: "hand", deckTop: "deck top", deckBottom: "deck bottom", damage: "Damage Pile", discard: "Discard Pile" }[ev.to] || ev.to}${ev.label ? ` (${ev.label})` : ""}${ev.why ? ` (${ev.why})` : ""}`;
      case "dominated": return `${chName(ev.ch)} is dominated${ev.power != null ? ` (power ${ev.power} / Mental ${ev.mental})` : ""} → Control Area (Back)`;
      case "charged": return `${name(ev.seat)} charges ${chName(ev.ch)}${ev.fromDeck ? " from the deck (face down)" : " from the hand"}${ev.pending ? " — pending until the end of the Charge Phase" : ""}`;
      case "unCharged": return `${name(ev.seat)} takes a pending power card back${ev.fromDeck ? " to the top of the deck" : " to the hand"}`;
      case "chargeSet": return `${name(ev.seat)}: ${ev.n} pending power card${ev.n === 1 ? " is" : "s are"} set`;
      case "sitHold": return `${name(ev.seat)} sets ${{ aggressive: "Aggressive", battle: "Attack/Guard", project: "Project", fast: "Fast", effect: "Effect", break: "Break/Permanent" }[ev.type] || ev.type} to ${ev.on ? "Not Skip" : "Skip"} (Game Situation · Current)`;
      case "situation": return `${name(ev.seat)} declares ${((AA4.SITUATIONS || []).find(x => x[0] === ev.value) || [0, ev.value])[1]}`;
      case "hold": if (ev.type === "default") return `${name(ev.seat)}: Hold back to the default`;   // Revise#205
        return `${name(ev.seat)}: Hold${ev.type && ev.type !== "all" && ev.type !== "every" ? " " + ((AA4.HOLD_TYPES || []).find(x => x[0] === ev.type) || [0, ev.type])[1] : ev.type === "all" ? " (all types)" : ev.type === "every" ? " (all, Undo too)" : ""} ${ev.on ? "ON" : "OFF"}`;
      case "passed": return `${name(ev.seat)} passes`;
      case "declaring": return null;
      case "paid": return `${name(ev.seat)} pays ${ev.cards.length}${ev.auto ? " (all the power cards there are)" : ""}: ${(ev.keys || ev.cards.map(id => S.cards[id] && S.cards[id].key)).map(k => card(k)).join(" ")}`;   // the cost as cards, for every player (Pack, Revise#113)
      case "byHandDamage":
        if (ev.ch) return `✋ By hand: ${chName(ev.ch)} takes ${[ev.normal && ev.normal + " damage", ev.mental && "(" + ev.mental + ") mental"].filter(Boolean).join(" + ")}`;
        if (ev.n == null) return `✋ By hand: ${name(ev.seat)} takes ${[ev.normal && ev.normal + " damage", ev.mental && "(" + ev.mental + ") mental"].filter(Boolean).join(" + ")} (damage check)`;
        return `✋ By hand: ${name(ev.seat)} takes +${ev.n} ${ev.kind === "normal" ? "normal damage (damage check)" : "special damage (→ Damage Pile)"}`;
      case "xSet": return `X = ${ev.x}${ev.free ? " (the power cards paid)" : " (from the card text)"}`;
      case "overMental": return `${chName(ev.ch)}: power ${ev.power} is more than its Mental ${ev.mental} — discard down to ${ev.mental}`;
      case "areaChosen": return `${name(ev.seat)} chooses ${name(ev.owner)}'s ${ev.area === "control" ? "Control Area (Front and Back)" : "Active Area"}`;
      case "autoSkip": return `Nothing more to do — the ${AA4.PHASE_NAMES[ev.phase]} ends (auto-skip)`;
      case "rule": if (ev.key === "powerFlipDown") return `⚠ ${name(ev.seat)} turned ${ev.on ? "ON" : "OFF"} “Flip down all power cards” (power cards are face down even for their owner)`;   // Revise#206
        return ev.key === "globalUndo" ? `⚠ ${name(ev.seat)} turned ${ev.on ? "ON" : "OFF"} “Global Undo/Redo” (any player may undo / redo any player’s action)` : ev.key === "outlawFool" ? `⚠ OUTLAW: ${name(ev.seat)} turned ${ev.on ? "ON" : "OFF"} “Fool text” (A3-23 joke cards play their フールテキスト)` : ev.key === "outlawDiscard" || ev.key === "outlawPower" ? `⚠ OUTLAW: ${name(ev.seat)} turned ${ev.on ? "ON" : "OFF"} “${ev.key === "outlawDiscard" ? "Flip-up Discard Pile" : "Flip-up all Power Card"}”` : `${name(ev.seat)}: ${{ autoSkip: "Auto-skip", autoPay: "Auto-pay" }[ev.key] || ev.key} ${ev.on ? "ON" : "OFF"}`;
      case "deckLook": return `✋ By hand: ${name(ev.seat)} looks through their deck`;
      case "declarationCancelled": return `${name(ev.seat)} cancels the declaration${ev.refunded ? ` (${ev.refunded} power card${ev.refunded === 1 ? "" : "s"} back)` : ""}`;
      case "declared": {
        if (ev.kind === "effect" && ev.i != null) {   // Pack (Revise#182): “Card” uses Effect “1: …” — the card's own words, in English
          const k = S.cards[ev.card] && S.cards[ev.card].key, inf = k && db && db.card(k), jp = inf && ((inf.effects || [])[ev.i] || {}).text;
          if (jp) {
            const tg0 = (ev.targets || []).map(t => (t.ch ? chName(t.ch) : t.seat != null ? name(t.seat) : t.card ? card(S.cards[t.card] && S.cards[t.card].key) : "")).filter(Boolean);
            return `${card(k)} uses Effect “${AA4.enText(inf, jp) || jp}”${tg0.length ? " → " + tg0.join(", ") : ""}${ev.main ? "" : " (answer)"}`;
          }
        }
        const what = ev.kind === "effect" ? `the effect of ${card(S.cards[ev.card] && S.cards[ev.card].key)}` : ev.kind === "trigger" ? `the ability of ${card(S.cards[ev.card] && S.cards[ev.card].key)}` : card(S.cards[ev.card] && S.cards[ev.card].key);
        const tg = (ev.targets || []).map(t => (t.ch ? chName(t.ch) : t.seat != null ? name(t.seat) : t.card ? card(S.cards[t.card] && S.cards[t.card].key) : t.field ? "the field" : "")).filter(Boolean);
        return `${name(ev.seat)} declares ${what}${tg.length ? " → " + tg.join(", ") : ""}${ev.main ? "" : " (answer)"}`;
      }
      case "altCost": return `${name(ev.seat)}: instead of the cost, ${ev.n} card${ev.n === 1 ? "" : "s"} from the deck top → the Discard Pile`;
      case "costSent": return ev.to === "discard" ? null : `${ev.label ? ev.label + ": " : ""}the cost goes to the ${{ hand: "hand", damage: "Damage Pile", deckTop: "top of the deck", deckBottom: "bottom of the deck" }[ev.to] || ev.to}`;
      case "setFailed": return `${card(S.cards[ev.card] && S.cards[ev.card].key)} fails: ${ev.why}`;
      case "entered": { const k = S.cards[ev.card] && S.cards[ev.card].key, inf = k && db.card(k); return ev.fromDamage || (inf && inf.type === "Character") ? null : `${card(k)} enters the field`; }   // a Character: shown by charNew
      case "resolving": return null;
      case "resolved": return ev.kind === "set" || ev.kind === "effect" || ev.kind === "trigger" ? `Resolved: ${card(S.cards[ev.card] && S.cards[ev.card].key)}` : null;
      case "effectCancelled": return `The effect is cancelled (${ev.why})`;
      case "broke": return `${card(S.cards[ev.card] && S.cards[ev.card].key)} breaks ${ev.from ? "an opponent's character" : chName(ev.ch)}`;
      // ---- B3
      case "modAdded": return ev.label && !ev.fromCard ? `Effect: ${ev.label}` : null;   // a card's effect: its “uses Effect” / “Resolved” line says it (Revise#182)
      case "modEnded": return null;
      // ---- B4: battle
      case "attacked": return `${chName(ev.ch)} attacks ${ev.target.ch ? chName(ev.target.ch) : name(ev.target.seat)}${ev.faction ? " (faction check)" : ""}${ev.boost ? ` · Boost ${ev.boost}` : ""}`;
      case "guarded": return `${chName(ev.ch)} guards`;
      case "noGuard": return `${name(ev.seat)}: no guard`;
      case "joined": return `${chName(ev.ch)} joins the battle (Synchro)`;
      case "factionCheckDone": return "Faction check finished";
      case "battleStart": return "Before battle";
      case "battle": {   // the battle in numbers: who hits whom with what
        const side = list => (list || []).map(x => `${card(S.cards[x.top] && S.cards[x.top].key)} (Attack ${x.atText || (x.atMental ? "(" + x.at + ")" : x.at)}, Defense ${x.de == null ? "–" : x.de}${x.controlled ? `, power ${x.power}` : `, Mental ${x.se == null ? "–" : x.se}`})`).join(" + ");
        if (!ev.sideA) return null;
        if (!(ev.sideB || []).length) return `Battle: ${side(ev.sideA)} → ${name(ev.player)} (no guard)`;
        return `Battle: ${side(ev.sideA)} vs ${side(ev.sideB)}${ev.first ? ` · ${ev.first === "a" ? "the attacker" : "the guard"} strikes first (Initiative)` : ""}`;
      }
      case "battleEnd": return "After battle";
      case "battleOver": return null;
      case "attackEnded": return `The attack ends (${ev.why})`;
      case "attackCancelled": return `${chName(ev.ch)}: the attack is cancelled`;
      case "guardCancelled": return `${chName(ev.ch)}: the guard is cancelled${ev.why ? ` (${ev.why})` : ""} — the attack goes on to its target`;
      case "costBack": return `${name(ev.seat)}: the cost goes back from the Discard Pile to the hand (resolved)`;
      case "playerDamage": if (ev.byHand) return null; return `${name(ev.seat)} takes ${[ev.normal && ev.normal + " damage", ev.mental && "(" + ev.mental + ") mental damage"].filter(Boolean).join(" + ") || "no damage"}`;
      case "damaged": {
        if (!ev.ch) return null;
        const asked = [ev.asked.normal && ev.asked.normal + " damage", ev.asked.mental && "(" + ev.asked.mental + ") mental damage"].filter(Boolean).join(" + ");
        if (ev.normal || ev.mental) return `${chName(ev.ch)} takes ${[ev.normal && ev.normal + " damage", ev.mental && "(" + ev.mental + ") mental"].filter(Boolean).join(" + ")}${ev.result && ev.result.length ? ` (${ev.result.join(", ")}${ev.survives ? " — survives" : ""})` : ""}${ev.cancelled && ev.cancelled.length ? ` · ${ev.cancelled.join("; ")}` : ""}`;
        if (ev.asked.normal || ev.asked.mental) return `${chName(ev.ch)}: no damage${asked ? ` from ${asked}` : ""}${ev.cancelled && ev.cancelled.length ? ` — ${ev.cancelled.join("; ")}` : ""}`;
        return `${chName(ev.ch)}: no damage (attack 0)`;
      }
      case "defeated": return `${card(ev.top && S.cards[ev.top] ? S.cards[ev.top].key : null)} leaves the field${ev.why ? ` (${ev.why})` : ""}`;
      case "wouldLeave": return `${chName(ev.ch)} would leave the field — keep it?`;
      case "keptOnField": return `${chName(ev.ch)} stays (${ev.how})`;
      case "keptAnyway": return `${chName(ev.ch)}: its Defense stays 0 — defeated anyway`;
      case "lost": return `${name(ev.seat)} loses (${ev.why})`;
      // ---- B5 / B6
      case "asked": return null;
      case "chosen": return null;
      case "triggerWaiting": return `${card(S.cards[ev.card] && S.cards[ev.card].key)}: ability waiting (Run / Skip)`;
      case "triggerRun": { const inf = S.cards[ev.card] && db && db.card(S.cards[ev.card].key); return `${card(S.cards[ev.card] && S.cards[ev.card].key)}: ability${ev.text ? " — " + (AA4.enText(inf, ev.text) || ev.text) : ""}`; }   // English (Pack, Revise#122)
      case "turnLock": return `${chName(ev.ch)}: extra turn — no cards from hand; only Named characters with power ≥ its power may pay costs`;
      case "unstuck": return `⏭ ${name(ev.seat)} used Skip (Game Status): ${ev.what}`;
      case "triggerSkipped": return `${name(ev.seat)} skips an ability`;
      case "effect": return null;
      case "foolNote": { const inf = ev.card && S.cards[ev.card] && db && db.card(S.cards[ev.card].key); const tg = (ev.targets || []).map(t => t.seat != null && S.players[t.seat] ? S.players[t.seat].name : t.ch && S.chars[t.ch] ? chName(t.ch) : "").filter(Boolean).join(", "); return `🃏 Fool text — ${card(S.cards[ev.card] && S.cards[ev.card].key)}${tg ? " → " + tg : ""}: ${(inf && AA4.enText(inf, ev.text)) || ev.text}`; }   // Q#66
      case "manual": { const inf = ev.card && S.cards[ev.card] && db && db.card(S.cards[ev.card].key); return `✋ By hand: ${(inf && AA4.enText(inf, ev.text)) || ev.text}`; }
      case "itemCancelled": return "A declaration is cancelled";
      case "retargeted": return `The target${ev.card && S.cards[ev.card] ? ` of ${card(S.cards[ev.card].key)}` : ""} is changed${ev.to ? ` → ${ev.to.ch ? chName(ev.to.ch) : ev.to.seat != null ? (S.players[ev.to.seat] || {}).name : ev.to.card && S.cards[ev.to.card] ? card(S.cards[ev.to.card].key) : "?"}` : ""}`;
      case "searched": return `${name(ev.seat)} uses Search`;
      case "undo": return ev.ok ? "Undo" : null;
      case "handRevealed": return `${name(ev.seat)} shows the whole hand: ${(ev.keys || []).map(k => { const i = db && db.card(k); return i ? AA4.cardName(i) : "?"; }).join(", ") || "no cards"}`;   // Revise#135
      case "threadSet": return `${name(ev.seat)} sets the cost as the Permanent “糸” (face down)`;
      case "noneFound": return `${name(ev.seat)}: ${ev.why}`;
      case "redrew": return `${name(ev.seat)} puts ${ev.n} drawn card${ev.n === 1 ? "" : "s"} back and takes ${ev.n} from the deck`;
      case "swapped": return `${name(ev.seat)} swaps a Break card from the hand with the top card`;
      case "note": return ev.text || "";
      case "absorbed": return `${card(S.cards[ev.card] && S.cards[ev.card].key)} is absorbed: discarded, ${ev.n} power card${ev.n === 1 ? "" : "s"} instead`;
      case "merged": return `${name(ev.seat)} merges ${ev.chs.length} Machine${ev.chs.length === 1 ? "" : "s"} into the battle`;
      case "raidDeclared": return `${name(ev.seat)} attacks with ${ev.attackers.length} characters at once — the attacks are resolved one by one`;
      case "raidOver": return `The group of attacks is over`;
      case "targetTax": return `${name(ev.seat)} pays ${ev.n} more for that target`;
      case "named": return ev.name === "__other__" ? "Named: another name (no card of this match)" : `Named: ${ev.name}`;
      case "tokenMade": return `${name(ev.seat)} sets a ${ev.name} (made from the cost)`;
      case "tookControl": return `${ev.name} takes control of ${name(ev.seat)}'s seat (no command for 30 s)`;
      case "undoAsked": return "Undo asked — the other players with Hold ON must agree";
      case "undoNo": return ev.ok ? "Undo refused" : null;
      case "redo": return ev.ok ? "Redo" : null;
      default: return null;
    }
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
