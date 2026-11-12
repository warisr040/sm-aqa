/* ==========================================================================
   v4 engine · projection (requirements_v4 §20.1)

   What one viewer may see. The UI only ever draws a projection, never the raw
   state, so hidden information is decided in one place:
     - a card's key is shown only when it is face up or the viewer is in visibleTo
       (hand → its owner; deck → nobody, not even its owner — Revise#066;
        power cards from hand → their owner unless powerFaceUp; from the deck → nobody)
     - deck ORDER is hidden: every deck is listed as hidden card ids; COUNTS stay visible (Revise#066)
     - the random seed is removed (it would reveal every future shuffle on screen)
     - a pending choice shows its options only to the player who chooses
   viewer = a seat number, or -1 for a spectator (sees face-up cards only).
   Solo two-deck (Q#16): the UI passes the seat whose turn it is.

   Not cheat-proof (§20.11): the full log is on every device; this hides on screen only.
   ========================================================================== */
(function (G) {
  "use strict";
  const AA4 = G.AA4;

  AA4.canSee = (S, viewer, id) => { const c = S.cards[id]; return !!c && (c.faceUp || c.visibleTo.includes(viewer)); };

  AA4.project = (S, viewer, db) => {
    const V = AA4.clone(S);
    V.viewer = viewer;
    delete V.seed; V.rng = { n: S.rng.n };
    const seesPower = !!(db && viewer >= 0 && S.players[viewer] && AA4.playerStats && AA4.playerStats(S, db, viewer).powerVisible);   // an effect that shows power cards to this player
    const openMods = db && AA4.allMods ? AA4.allMods(S, db).filter(m => m.key === "handsOpen" && (!m.cond || AA4.checkCond(S, db, m.cond, { seat: m.src && m.src.seat, src: m.src }))) : [];
    const openSeats = new Set(S.players.map(p => p.seat).filter(seat => openMods.some(m => AA4.modAppliesToSeat(S, m, seat))));   // whose hands are shown (Revise#128: "あなた以外のプレイヤー全て")   // "≪プレイヤー全て≫は、手札全てをプレイヤー全てに見せてプレイする" (Revise#118)
    const outD = !!(S.rules && S.rules.outlawDiscard), outP = !!(S.rules && S.rules.outlawPower);   // Outlaw (Revise#155): Discard Piles / power cards face up for everyone
    const flipDn = !!(S.rules && S.rules.powerFlipDown) && !outP;   // Game options "Flip down all power cards" (Pack, Revise#206): a power card is face down even for its owner (an effect that shows power cards still does)
    for (const c of Object.values(V.cards)) if (flipDn && c.place.z === "char" && c.place.role === "power" && !c.faceUp && !seesPower) c.key = null;
    else if (!(c.faceUp || c.visibleTo.includes(viewer) || (outD && c.place.z === "discard") || (outP && c.place.z === "char" && c.place.role === "power") || (seesPower && c.place.z === "char" && c.place.role === "power") || (c.place.z === "hand" && openSeats.has(c.owner)))) c.key = null;
    V.deckTop = S.decksFlipped ? Object.fromEntries(S.players.filter(p => p.zones.deck.length).map(p => [p.seat, S.cards[p.zones.deck[p.zones.deck.length - 1]].key])) : null;   // turned-over decks: the top card is face up (Revise#132)
    for (const p of V.players) p.zones.deck = p.zones.deck.map(() => "?");   // count only
    V.queue = [];
    // choices (Event System): only the chooser sees the options; others see "waiting for …" (Revise#037)
    V.decisions = V.decisions.map(d => {
      const out = Object.assign({}, d); delete out.then;
      if (d.seat !== viewer) { out.options = d.options.length; delete out.labels; }
      return out;
    });
    return V;
  };

  /** Game events as one viewer may see them (card keys hidden when the viewer couldn't see the card). */
  AA4.projectEvents = (events, viewer) => events.map(ev => {
    if (ev.e !== "moved" || ev.seen.includes(viewer)) return ev;
    return Object.assign({}, ev, { key: null });
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
