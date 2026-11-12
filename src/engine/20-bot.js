/* ==========================================================================
   v4 engine · Bot (Pack, Revise#308)

   A computer player that only ever plays legal moves: it asks AA4.candidates() for every move it may make,
   tries each one on a copy of the game (AA4.step) and keeps the move whose result scores best for it.
   The score is a weighted sum of plain features (damage piles, characters and their stats, power cards,
   hands, decks) plus a few move-kind hints (attack when it is safe, guard when the hit would hurt …).
   Every number lives in one weights object, so it can be tuned:
     - by self-play (tools/bot_train.js: bot vs bot, the winner's weights survive and are varied), and
     - from real games (tools/bot_learn.js: in each online room that finished, the winner's choices are the
       answers; the weights move so that the bot would have chosen what the winner chose).
   Hidden information: the bot never looks at the cards in another player's hand or deck (counts only).
   ========================================================================== */
(() => {
  "use strict";
  const AA4 = (typeof window !== "undefined" ? window : global).AA4;

  /** Default weights (tools/bot_train.js / bot_learn.js write tuned ones into AA4.BOT_WEIGHTS). */
  const DEFAULT = {
    dmgMe: -6, dmgOpp: 6, chars: 3, oppChars: -3, stats: 0.35, oppStats: -0.35, power: 1.1, oppPower: -0.9,
    hand: 0.5, oppHand: -0.15, deckLow: -1.5, broken: 1.2, oppBroken: -1.0,
    breakShort: -2.6, breakNoTarget: -1.2,   // Revise#332: power kept for the named Break card in the hand
    next: -0.4, pass: -0.2, cancel: -60, set: 1.4, effect: 0.4, charge: 0.9, trigger: 0.6,
    attack: 1.6, attackPlayer: 0.9, attackAt: 0.45, attackRisk: 2.2, attackKill: 2.0,
    guardSave: 0.9, guardKill: 1.6, guardLose: -1.4, noGuardHurt: -0.55,
    // Pack's plan (Revise#311): build first — Break cards, Controlled Characters, power — then fight when the attack is there.
    // "Early" features count only while the bot is not ready (×(1 − ready)); "Ready" ones only when it is (× ready).
    setEarly: 1.0, chargeEarly: 0.6, charsEarly: 2.0, powerEarly: 0.5, statsEarly: 0.15,
    attackEarly: -1.0, attackReady: 1.0, attackPlayerReady: 1.2, lethal: 4.0,
    // Pack (Revise#313): dominate first — power cards on Active Characters until their power reaches their Mental
    // (they move to the Control Area at the end of the Charge Phase); use the least useful hand cards as power and keep the key ones.
    // domReady stays below a Controlled Character (chars + charsEarly), so ending the Charge Phase — the domination — is a gain
    domReady: 1.8, domProg: 1.6, oppDomReady: -1.0, handValue: 0.9, domReadyEarly: 0,
    actives: 1.0, activesEarly: 0.8,   // a Character in the Active Area: something to dominate later
    // Pack (Revise#375): charge first. attackPowerMin = X: no attack while the power cards on its Controlled Characters are fewer than X
    // (a hit that can win is always allowed). attackLoss: paid for every card the attacker would lose (its stack + its power cards) when a
    // guard that can be declared would defeat it. attackStrike 1: such an attacker only goes in a strike that wins through the guards (botAttackOk); 0 = the rule before.
    // setActiveMax: Active Characters still to dominate at one time, besides the one Aggressive character (botSetCharOk).
    // Revise#376: X and the Charge limit come from the players' own games (tools/bot_stats.js, 71 attacks by players in Pack's 17 rooms):
    // a quarter of their attacks came with 3 or fewer power cards on the field (median 4), and 67 of 71 with Charge 3 or more (median 6).
    // attackChargeMin: no attack while its Charge total is below this. An attacker with Offensive is not held back by the two limits
    // (the players' Offensive attackers survived 24 of 25 attacks).
    // Revise#378: attackChargeMin is 0 (off) for now — the bot's own Charge total stays near 1.5 with several decks (Iaris, Cyborg Rider), so a limit
    // of 3 stopped it from attacking at all (under one attack per game). The parameter stays; a limit above 0 needs a bot that builds Charge first.
    // Revise#386 (Pack): "if there is not enough Charge or Draw, it is OK not to guard and let the damage go to the player" — while its Charge total is
    // below guardChargeMin or its Draw below guardDrawMin, it does not guard an attack on itself with a character that the attacker would defeat
    // (unless the hit would end the game for it).
    // Revise#396, from the players' turns (tools/bot_habits.js): setFirstTurn / setPerTurn = Character cards set on the first / a later turn;
    // reserveUntilDraw = a Character card is kept in the hand only while its Draw is below this; attackTurnMin = no attack before its Nth own turn
    // (the players: 0.0 attacks on their turns 1–2, 0.1 on turn 3, 0.5 on turn 4, then more).
    setFirstTurn: 3, setPerTurn: 2, reserveUntilDraw: 2, attackTurnMin: 4,
    attackPowerMin: 3, attackChargeMin: 0, attackLoss: -0.8, attackStrike: 1, setActiveMax: 1, activeMax: 2, guardChargeMin: 3, guardDrawMin: 2,
  };
  /** Limits, not scores: tools/bot_train.js leaves them alone. */
  AA4.BOT_LIMIT_KEYS = ["attackPowerMin", "attackChargeMin", "attackStrike", "setActiveMax", "activeMax", "guardChargeMin", "guardDrawMin", "setFirstTurn", "setPerTurn", "reserveUntilDraw", "attackTurnMin"];
  const W = () => Object.assign({}, DEFAULT, AA4.BOT_WEIGHTS || {});
  /* Campaign playstyle (Pack, Revise#379): botChoose(…, { style }) — style = AACampaign.botStyle(playstyle) or null (the common bot).
     "hero" = Hero Frontal Attack: {attackersMode: none|any|select, attackers: [{key, perm, wait}], special: [keys], mainBreak, critical}.
       - its Main Attacker cards, their Permanent cards, the Special Priority cards and the Main Break are not spent as power cards while another card can be;
       - the power cards are kept for the Main Attacker in its hand first (breakShort);
       - no attack until a Main Attacker is set (with its Permanent card when it waits for it) and has a power card — any Break card for "any";
       - with fewer deck cards than the Critical number it attacks by the common rules; a hit that can win is always allowed. */
  /* Hand-made additions for one deck (Revise#383, the first: "E.G.O. Mayumi" — "only Mayumi attacks unless at a critical situation;
     attack only when able to stay alive; break Fujimiya Mayumi as much as possible, 覚醒の乙女 stays on top"), flags of the style:
       only  — only a character built with a Main Attacker's Name attacks;
       safe  — and only when nobody who can guard (or the character it attacks) would defeat it;
       stack — Break cards with that Name go on the character that already has the Name; the Main Break is set last (while another
               one of the Name in the hand can be set now, it waits) and no Break card is set on top of it. */
  /* "leader" = Supportive Leader (Pack, Revise#384): the named Break cards support by their effects and abilities. The style arrives in the same
     shape — attackers = the Main Supporters, all (every one of them must be set), safe (a character with their Name attacks only when it surely
     survives), chargeMin 4 / drawMin 3 (no attack before Charge > 3 and Draw > 2). The other characters attack by the common rules once that holds. */
  let STYLE = null;
  const styled = st => !!st && (st.strategy === "hero" || st.strategy === "leader");
  const heroNames = (db, st) => (st._names = st._names || new Set((st.attackers || []).map(x => x.key).concat([st.mainBreak]).map(k => (k && db.card(k) ? db.card(k).name : null)).filter(Boolean)));
  const hasName = (S, db, chId, names) => !!S.chars[chId] && S.chars[chId].stack.some(c => names.has((db.card(S.cards[c].key) || {}).name));
  const heroKeys = st => new Set((st.attackers || []).flatMap(x => [x.key, x.perm]).concat(st.special || [], st.keep || [], [st.mainBreak, st.first]).filter(Boolean));
  AA4.botHeroReady = (S, db, seat, st) => {
    if (!styled(st) || st.attackersMode === "none") return true;
    const has = (ch, x) => ch.stack.some(c => S.cards[c].key === x.key) && (!(x.wait && x.perm) || (ch.perm || []).some(c => S.cards[c].key === x.perm));
    if (st.all && st.attackersMode === "select") return (st.attackers || []).every(x => AA4.controlledOf(S, seat).some(id => S.chars[id] && has(S.chars[id], x)));   // Supportive Leader: every Main Supporter is set (Revise#384)
    return AA4.controlledOf(S, seat).some(id => { const ch = S.chars[id]; if (!ch || !ch.power.length) return false;
      if (st.attackersMode === "any") return ch.stack.some(c => (db.card(S.cards[c].key) || {}).type === "Break");
      return (st.attackers || []).some(x => ch.stack.some(c => S.cards[c].key === x.key) && (!(x.wait && x.perm) || (ch.perm || []).some(c => S.cards[c].key === x.perm))); });
  };
  AA4.botWeights = W;

  /** Is the card's Factor met? AA4.factorOk returns the reason when it is NOT (null = met) — the bot read it the wrong way round until Revise#377. */
  const facOk = (S, db, seat, inf) => { try { return !AA4.factorOk(S, db, seat, inf); } catch (e) { return false; } };
  const statsOf = (S, db, id) => { try { return AA4.charStats(S, db, id); } catch (e) { return { se: 0, at: 0, de: 0 }; } };
  const dot = (w, f) => Object.entries(f).reduce((n, [k, v]) => n + (w[k] || 0) * v, 0);
  /** The board for `seat` as features {weight name: amount}; score = Σ weight × amount (no hidden cards are read). */
  AA4.botFeatures = (S, db, seat) => {
    const me = S.players[seat]; if (!me) return {};
    if (me.lost) return { _lost: 1 };
    const opps = AA4.living(S).filter(s => s !== seat);
    if (!opps.length) return { _won: 1 };
    const side = s => {
      const ctl = AA4.controlledOf(S, s);
      let stats = 0, broken = 0, power = 0;
      for (const id of ctl) { const st = statsOf(S, db, id); stats += (+st.se || 0) + (+st.at || 0) + (+st.de || 0); if (st.broken) broken++; }
      for (const id of AA4.charsOf(S, s)) power += S.chars[id].power.length;
      const p = S.players[s];
      // Active Characters: those whose power already reaches their Mental are dominated when the Charge Phase ends;
      // the others count by how close they are (squared: finishing one beats spreading power thin)
      let domReady = 0, domProg = 0, actives = 0;
      for (const id of AA4.charsOf(S, s)) {
        const ch = S.chars[id]; if (!ch || AA4.isControlled(ch)) continue;
        const se = Math.max(1, +statsOf(S, db, id).se || 0), pw = ch.power.length; actives++;
        if (pw >= se) domReady++; else domProg += (pw / se) * (0.5 + 0.5 * pw / se);   // closer counts more: finishing one beats spreading power thin
      }
      return { dmg: p.zones.damage.length, chars: ctl.length, stats, broken, power, hand: p.zones.hand.length, deck: p.zones.deck.length, domReady, domProg, actives, handValue: s === seat ? handValue(S, db, s) : 0 };
    };
    const a = side(seat), os = opps.map(side), sum = k => os.reduce((n, o) => n + o[k], 0) / os.length;
    const lim = AA4.LOSE_DAMAGE || 10, nb = nameBreakNeed(S, db, seat);
    return { breakShort: nb.short, breakNoTarget: nb.noTarget, actives: Math.min(a.actives, 6), domReady: a.domReady, domProg: a.domProg, oppDomReady: sum("domReady"), handValue: a.handValue, dmgMe: a.dmg * (1 + a.dmg / lim), dmgOpp: sum("dmg") * (1 + sum("dmg") / lim), chars: a.chars, oppChars: sum("chars"), stats: a.stats, oppStats: sum("stats"),
      power: a.power, oppPower: sum("power"), hand: Math.min(a.hand, 9), oppHand: sum("hand"), broken: a.broken, oppBroken: sum("broken"), deckLow: a.deck < 5 ? 5 - a.deck : 0 };
  };
  /** How ready the bot's side is to fight (0 … 1): the attack of its Controlled Characters against the damage still needed to win (Revise#311). */
  AA4.botReady = (S, db, seat) => {
    const opps = AA4.living(S).filter(s => s !== seat); if (!opps.length) return 1;
    const lim = AA4.LOSE_DAMAGE || 10, need = Math.max(1, Math.min(...opps.map(o => lim - S.players[o].zones.damage.length)));
    const atk = AA4.controlledOf(S, seat).reduce((n, id) => n + Math.max(0, +statsOf(S, db, id).at || 0), 0);
    return Math.max(0, Math.min(1, atk / Math.max(4, need)));
  };
  /** What the bot's own hand is worth (Revise#313; its own cards only): Break cards it can use soon count most, then
      Project / Fast cards, Permanents, and Character cards least (good power cards). A second copy of a name counts less. */
  const handValue = (S, db, seat) => {
    const seen = {};
    let v = 0;
    for (const id of S.players[seat].zones.hand) {
      const inf = db.card(S.cards[id].key) || {}, ok = facOk(S, db, seat, inf);
      const k = inf.jp || inf.key; seen[k] = (seen[k] || 0) + 1;
      let x = inf.type === "Break" ? 1.4 + (ok ? 0.6 : 0) : inf.type === "Project" || inf.type === "Fast" ? 0.9 + (ok ? 0.4 : 0) : inf.type === "Permanent" ? 0.7 + (ok ? 0.2 : 0) : 0.35;
      if (seen[k] > 1) x *= 0.6;
      v += x;
    }
    return v;
  };
  AA4.botHandValue = handValue;
  /* Pack (Revise#332): "analyze the Name-level cards before the start, and keep enough power cards on the field to break with them."
     botPlan reads the bot's own deck: its Break cards with a Name (the strongest bodies / effects), their cost and how much they are worth.
     In play, for the best named Break card in the hand: breakShort = the part of its cost the power cards on the field don't cover yet
     (spending power below that cost is paid for; charging up to it is rewarded), breakNoTarget = no character of its own it may break yet. */
  const nameWorth = inf => (+inf.se || 0) + (+inf.at || 0) + (+inf.de || 0) + 2 * ((inf.effects || []).length + (inf.abilities || []).length) + Object.keys(inf.skills || {}).length;
  /** The job of a named card (Pack, Revise#332): attacker (its Attack is its best number, or it has attack skills), supporter (it works by
      effects / abilities and hits little), defender (Defense first, Shield / Intercept), or allround. */
  AA4.botRole = inf => {
    const se = +inf.se || 0, at = +inf.at || 0, de = +inf.de || 0, sk = inf.skills || {}, fx = (inf.effects || []).length + (inf.abilities || []).length;
    const atkSk = ["penetrate", "initiative", "boost", "breakthrough", "offensive"].filter(k => sk[k] != null).length, defSk = ["shield", "intercept", "defensive"].filter(k => sk[k] != null).length;
    if (at >= 4 && at >= de && atkSk >= defSk) return "attacker";
    if (atkSk >= 2 && at >= 3) return "attacker";
    if (fx >= 1 && at <= 3) return "supporter";
    if (de > at && (de >= 4 || defSk)) return "defender";
    return fx >= 2 ? "supporter" : at >= 3 ? "attacker" : "allround";
  };
  AA4.botPlan = (S, db, seat) => {
    const seen = new Map();
    for (const c of Object.values(S.cards)) { if (c.owner !== seat || !c.key) continue; const inf = db.card(c.key) || {}; if (inf.type !== "Break" || !inf.name) continue;
      const e = seen.get(c.key) || { key: c.key, name: inf.name, jp: inf.jp, cost: typeof inf.cost === "number" ? inf.cost : +inf.cost || 0, factor: inf.factor || {}, worth: nameWorth(inf), role: AA4.botRole(inf), en: inf.en || inf.jp, copies: 0 }; e.copies++; seen.set(c.key, e); }
    return [...seen.values()].sort((a, b) => b.worth - a.worth);
  };
  const nameBreakNeed = (S, db, seat) => {
    let best = null;
    const d = S.draft && S.draft.seat === seat && S.draft.kind === "set" && S.draft.card ? S.draft : null;   // being declared: still counted (with what was paid), so declaring and cancelling gains nothing
    const early = AA4.botReady(S, db, seat) < 1;
    const hero = styled(STYLE) ? new Set((STYLE.attackers || []).map(x => x.key).concat([STYLE.mainBreak]).filter(Boolean)) : null;
    for (const id of S.players[seat].zones.hand.concat(d ? [d.card] : [])) { if (!S.cards[id]) continue; const inf = db.card(S.cards[id].key) || {}; if (inf.type !== "Break" || !(inf.name || (hero && hero.has(S.cards[id].key)))) continue;
      const w = nameWorth(inf) + (early && AA4.botRole(inf) === "attacker" ? 3 : 0) + (hero && hero.has(S.cards[id].key) ? 100 : 0);   // not ready to fight yet: the attacker first; a Campaign deck's Main Attacker before all
      if (!best || w > best.w) best = { id, inf, w }; }
    if (!best) return { short: 0, noTarget: 0 };
    const cost = typeof best.inf.cost === "number" ? best.inf.cost : +best.inf.cost || 0;
    const power = AA4.controlledOf(S, seat).reduce((n, id) => n + S.chars[id].power.length, 0) + (d && d.card === best.id ? (d.paid || []).length : 0);
    let targets = []; try { targets = AA4.breakTargets(S, db, seat, best.id, false, best.inf).filter(ch => S.chars[ch].owner === seat && AA4.isControlled(S.chars[ch])); } catch (e) { /* */ }
    return { short: cost > 0 ? Math.max(0, cost - power) / cost : 0, noTarget: targets.length ? 0 : 1 };
  };
  AA4.botNameBreakNeed = nameBreakNeed;
  AA4.botValue = (S, db, seat, w = W()) => { const f = AA4.botFeatures(S, db, seat); return f._lost ? -1000 : f._won ? 1000 : dot(w, f); };

  /** Hints for the kind of move (what one step of look-ahead can't see: a battle's outcome …), as features too. */
  const hintF = (S, db, seat, it) => {
    switch (it.t) {
      case "next": return { next: 1 };
      case "pass": return { pass: 1 };
      case "cancel": return { cancel: 1 };
      case "trigger": return it.run ? { trigger: 1 } : {};
      case "charge": return { charge: 1 };
      case "noGuard": {
        const b = S.battle, at = b && S.chars[b.attacker] ? +statsOf(S, db, b.attacker).at || 0 : 0;
        return { noGuardHurt: at * (1 + S.players[seat].zones.damage.length / 5) };
      }
    }
    if (it.t !== "declare") return {};
    if (it.kind === "set") return { set: 1 };
    if (it.kind === "effect") return { effect: 1 };
    if (it.kind === "guard" || it.kind === "join") {
      const b = S.battle; if (!b || !S.chars[b.attacker] || !S.chars[it.ch]) return {};
      const A = statsOf(S, db, b.attacker), G = statsOf(S, db, it.ch), f = {};
      if ((+G.de || 0) > (+A.at || 0)) f.guardSave = 1; else f.guardLose = 1;
      if ((+G.at || 0) >= (+A.de || 0)) f.guardKill = 1;
      return f;
    }
    if (it.kind === "attack") {
      const A = statsOf(S, db, it.ch), at = +A.at || 0, de = +A.de || 0, f = { attack: 1, attackAt: at };
      const opp = it.target && it.target.seat != null ? it.target.seat : it.target && S.chars[it.target.ch] ? S.chars[it.target.ch].owner : null;
      const guards = opp == null ? [] : AA4.controlledOf(S, opp).filter(id => !(S.chars[id].flags && S.chars[id].flags.tapped));
      if (guards.some(id => (+statsOf(S, db, id).at || 0) >= de)) { f.attackRisk = -1; f.attackLoss = S.chars[it.ch].stack.length + S.chars[it.ch].power.length; }   // what is lost with it (Revise#375)
      if (it.target && it.target.seat != null) f.attackPlayer = 1;
      if (it.target && it.target.ch && S.chars[it.target.ch] && at >= (+statsOf(S, db, it.target.ch).de || 0)) f.attackKill = 1;
      return f;
    }
    return {};
  };
  /* Pack (Revise#324): "1:≪このエフェクトのコスト≫をオーナーの手札に戻す" (a power card back to the hand) only when the bot wants that card
     to play: a Fast card while the opponent threatens (a declaration waiting, or an attack on the bot), or on its own Main Phase a Break /
     Project card it can then pay for and whose Factor it meets. Then it pays with that card. Never just because it's there. */
  const costBackOnly = (S, db, ch, card, i) => { try { const e = AA4.effectsOf(S, db, ch, card)[i]; return !!(e && e.costTo === "hand" && !(e.steps || []).length); } catch (x) { return false; } };
  AA4.botWantedBack = (S, db, seat, chId) => {
    const ch = S.chars[chId]; if (!ch || ch.owner !== seat) return [];
    const threat = (S.stack.length && S.stack[S.stack.length - 1].seat !== seat) || (S.battle && S.battle.aSeat !== seat && (S.battle.defender === seat || (S.battle.target && S.battle.target.ch && S.chars[S.battle.target.ch] && S.chars[S.battle.target.ch].owner === seat)));
    const mainFree = S.turn.player === seat && S.turn.phase === "main" && !S.stack.length && !S.battle;
    const power = AA4.controlledOf(S, seat).concat(Object.values(S.chars).filter(c => c.owner === seat && !AA4.isControlled(c)).map(c => c.id)).reduce((n, id) => n + ((S.chars[id] && S.chars[id].power.length) || 0), 0);
    // Pack (Revise#377): (1) on an opponent's turn, only when the Game Situation is Conflict or Engage (while it is Build or Interfere the power
    // cards stay); with the Game Situation off, as before. (2) First the power it needs by its next turn is set aside: the cost of the card it
    // takes back + the cost of the best named Break card in its hand that it can use (Factor met). The power left on the field must cover that.
    if (S.turn.player !== seat && AA4.situationOf && AA4.situationOf(S) && !["conflicting", "engaging"].includes(S.situation)) return [];
    const costOf = x => (typeof x.cost === "number" ? x.cost : +x.cost || 0);
    let plan = 0, planW = -1;   // the Break card in the hand to set this turn or the next: a named one first, the most valuable (nameWorth)
    for (const id of S.players[seat].zones.hand) { const b = db.card(S.cards[id].key) || {}; if (b.type !== "Break") continue; const ok = facOk(S, db, seat, b), wv = nameWorth(b) + (b.name ? 100 : 0); if (ok && wv > planW) { planW = wv; plan = costOf(b); } }
    return ch.power.filter(id => {
      const inf = db.card(S.cards[id].key) || {}, cost = costOf(inf);
      const fOk = facOk(S, db, seat, inf);
      if (!fOk) return false;
      const need = cost + (inf.type === "Break" ? Math.max(0, plan - cost) : plan);   // a Break card taken back is itself the plan
      if (inf.type === "Fast") return threat && power - 1 >= need;
      if (inf.type === "Break" || inf.type === "Project") return mainFree && power - 1 >= need;
      return false;
    });
  };
  /* Pack's rules for Character cards (Revise#330, rewritten in Revise#375: "the bot still places every character of its hand in the Active Area"):
     1. One Aggressive (▼) character is enough: with none in its Active Area, the Aggressive Character card with the highest Attack in the hand may be set.
     2. Besides that one, only one character at a time is in the Active Area to be moved to the Control Area — and only when the bot can charge it
        fully this turn: the hand cards it can spare (not this card, not the named Break cards it keeps) + what Charge still gives from the deck
        reach its Mental. If not, the card stays in the hand (or becomes a power card).
     3. The deck's Main Factor first: the faction that the Factors of its Name-level cards ask for most (counted from its own deck). A character of
        another faction waits while a Main Factor character in the hand could be set by rule 2.
     4. A Break card in the hand with no character of its own to break may overrule 1–3: a character of that Break card's faction may be set. */
  const isAggr = inf => !!(inf && (inf.aggressive || (inf.skills && inf.skills.aggressive)));
  const MAINF = new Map();
  AA4.botMainFactor = (S, db, seat) => {
    const k = S.seed + ":" + seat; if (MAINF.has(k)) return MAINF.get(k);
    const n = {};
    for (const c of Object.values(S.cards)) { if (c.owner !== seat || !c.key) continue; const inf = db.card(c.key) || {}; if (!inf.name) continue; for (const [f, v] of Object.entries(inf.factor || {})) n[f] = (n[f] || 0) + (+v || 0); }
    const best = Object.entries(n).sort((a, b) => b[1] - a[1])[0], out = best ? best[0] : null;
    if (MAINF.size > 200) MAINF.clear();
    MAINF.set(k, out); return out;
  };
  /* Pack (Revise#391): "the bot charges every Character card away, so it cannot play its second turn — keep at least 1 character in the hand
     to set next turn; the Main Factor first; at least 2 Charge and 2 Draw is the aim." The Character card of the hand that is kept (never
     charged as a power card): one with Draw while its Draw is under 2, one with Charge while its Charge is under 2, then any with Draw / Charge,
     then the Main Factor. except = a card about to be set now (the reserve is taken from the others). */
  AA4.botReserved = (S, db, seat, except) => {
    const p = S.players[seat]; let ps = {}; try { ps = AA4.playerStats(S, db, seat); } catch (e) { /* */ }
    if ((+ps.draw || 0) >= Math.round(W().reserveUntilDraw)) return null;   // Revise#396: the players keep no Character card back (none in the hand at the end of 7 turns of 10) — they draw 2 or more. The bot keeps one only until its Draw is 2.
    const main = AA4.botMainFactor(S, db, seat), needD = (+ps.draw || 0) < 2, needC = (+ps.charge || 0) < 2;
    let best = null, bestV = -1;
    for (const id of p.zones.hand) { if (id === except) continue; const x = db.card(S.cards[id].key) || {}; if (x.type !== "Character") continue;
      const d = skillOn(x, "draw"), c = skillOn(x, "charge"), v = (needD && d ? 4 : 0) + (needC && c ? 4 : 0) + (d || c ? 2 : 0) + (main && x.faction === main ? 1 : 0);
      if (v > bestV) { bestV = v; best = id; } }
    return best;
  };
  /* Pack (Revise#392): "the bot does not use Break, Project, Fast and Permanent cards of its hand to charge, so it cannot dominate its characters."
     Before, every named Break card and every card of a Campaign playstyle was kept while any other card was in the hand — with the reserved
     character there, nothing at all could be charged. Now: level 2 (never a power card) = the one Character card kept for the next turn and the
     one Break card the bot plans to set (the Main Break / Main Attacker of a playstyle, else its most valuable named Break card); level 1 (a power
     card only when no free card is left) = one copy of each other named Break card and of each playstyle card; every other card, and every
     second copy, is free. */
  AA4.botProtected = (S, db, seat, except) => {
    const out = new Map(), hand = S.players[seat].zones.hand, infOf = id => db.card(S.cards[id].key) || {};
    const res = AA4.botReserved(S, db, seat, except); if (res) out.set(res, 2);
    const keys = styled(STYLE) ? heroKeys(STYLE) : new Set(), planKeys = styled(STYLE) ? [STYLE.mainBreak].concat((STYLE.attackers || []).map(x => x.key)).filter(Boolean) : [];
    let plan = null, planV = -1;
    for (const id of hand) { const x = infOf(id); if (x.type !== "Break") continue; const k = S.cards[id].key, v = planKeys.includes(k) ? 1000 - planKeys.indexOf(k) : x.name ? nameWorth(x) : -1; if (v > planV) { planV = v; plan = id; } }
    if (plan && planV >= 0) out.set(plan, 2);
    const seen = new Set(plan ? [S.cards[plan].key] : []);
    for (const id of hand) { if (out.has(id)) continue; const x = infOf(id), k = S.cards[id].key; if (!(keys.has(k) || (x.type === "Break" && x.name)) || seen.has(k)) continue; seen.add(k); out.set(id, 1); }
    return out;
  };
  /** The Active Character that gets the power cards now (Revise#392): not the Aggressive ones that are there to attack (the oldest one — two on the
      first turn), but the character to bring to the Control Area — the one closest to its Mental, the newest among equals. When only the
      Aggressive ones wait, the closest of them. null = nobody waits. */
  AA4.botChargeTarget = (S, db, seat, legal) => {
    const num = id => +String(id).replace(/\D/g, "") || 0, short = id => Math.max(1, +statsOf(S, db, id).se || 0) - S.chars[id].power.length;
    const waiting = AA4.charsOf(S, seat).filter(id => { const ch = S.chars[id]; return ch && !AA4.isControlled(ch) && short(id) > 0 && (!legal || legal.has(id)); });
    if (!waiting.length) return null;
    return waiting.sort((x, y) => short(x) - short(y) || num(y) - num(x))[0];   // the one closest to its Mental (the players leave none waiting, Aggressive or not — Revise#396), then the newest
  };
  /** The bot's own turn number (1 = its first turn). */
  AA4.botOwnTurn = S => Math.max(1, Math.ceil((S.turn.number || 1) / Math.max(1, (S.turn.order || []).length)));
  /* Character cards, by what the players do (Revise#396 — tools/bot_habits.js over 35 rooms, 274 player turns; it replaces the fixed "one
     Aggressive + one to dominate" of Revise#375 / #391):
       - the players set 3 Character cards on their first turn (a quarter of them 4) and 1–2 on a later turn      → setFirstTurn 3, setPerTurn 2;
       - they bring them to the Control Area at once: after their first turn 2 are Controlled and 1 waits, from the second turn on none
         waits                                                                                                   → a card is only set when
         the power cards the bot can give this turn cover what its Active Characters still need — on its first turn one character may stay;
       - most of what they set is Aggressive (2.8 of 3.2 on the first turn)                                       → Aggressive first, then a
         character with Draw or Charge, then the Main Factor (Pack, Revise#385 / #392).
     A Break card in the hand with no character to break may still overrule this (Revise#375, rule 4). */
  AA4.botSetCharOk = (S, db, seat, card, w0) => {
    const inf = db.card(S.cards[card].key) || {};
    if (inf.type !== "Character") return true;
    const p = S.players[seat], w = w0 || W(), hand = p.zones.hand, infOf = id => db.card(S.cards[id].key) || {};
    if (Math.round(w.setActiveMax) >= 9) return true;   // the limits switched off (comparisons)
    // Pack (Revise#410): no new Character card while 2 or more of its characters are already in the Active Area
    if (AA4.charsOf(S, seat).filter(id => S.chars[id] && S.chars[id].at.area === "active").length >= Math.round(w.activeMax == null ? 2 : w.activeMax)) return false;
    // a Break card with nothing to break
    for (const id of hand) { const b = infOf(id); if (b.type !== "Break" || !(b.faction === inf.faction || (b.factor && b.factor[inf.faction]))) continue;
      let own = []; try { own = AA4.breakTargets(S, db, seat, id, false, b).filter(ch => S.chars[ch].owner === seat); } catch (x) { /* */ }
      if (!own.length && !AA4.charsOf(S, seat).some(c => infOf(AA4.topOf(S.chars[c])).faction === inf.faction)) return true; }
    // how many this turn
    const first = AA4.botOwnTurn(S) <= 1, u = p.usedTurn, setNow = u && u.turn === S.turn.number ? u.keys.filter(k => (db.card(k) || {}).type === "Character").length : 0;
    if (setNow >= Math.round(first ? w.setFirstTurn : w.setPerTurn)) return false;
    // can they be brought to the Control Area this turn?
    const short = id => Math.max(0, Math.max(1, +statsOf(S, db, id).se || 0) - S.chars[id].power.length);
    const waiting = AA4.charsOf(S, seat).filter(id => S.chars[id] && !AA4.isControlled(S.chars[id]) && short(id) > 0), needs = waiting.map(short).sort((x, y) => x - y);
    let charge = 0; try { charge = +AA4.playerStats(S, db, seat).charge || 0; } catch (x) { /* */ }
    const deckNow = Math.max(0, Math.min(p.zones.deck.length, charge - ((p.turnFlags && p.turnFlags.deckCharged) || 0)));
    const prot = AA4.botProtected(S, db, seat, card), keepers = hand.filter(id => id !== card && prot.get(id) === 2).length;   // the cards that never become power cards (Revise#392)
    const supply = Math.max(0, hand.length - 1 - keepers) + deckNow;
    const fits = x => { const all = needs.concat([Math.max(1, +x.se || 0)]).sort((a, b) => a - b); if (first && all.length > 1) all.pop(); return all.reduce((a, b) => a + b, 0) <= supply; };   // first turn: the one that needs most may wait
    if (!fits(inf)) return false;
    // the order: Aggressive, then Draw / Charge, then the Main Factor
    const main = AA4.botMainFactor(S, db, seat), rank = x => (isAggr(x) ? 4 : 0) + (skillOn(x, "draw") || skillOn(x, "charge") ? 2 : 0) + (main && x.faction === main ? 1 : 0), mine = rank(inf);
    if (hand.some(id => id !== card && (x => x.type === "Character" && fits(x) && rank(x) > mine)(infOf(id)))) return false;
    return true;
  };
  /* Pack's feedback (Revise#331): "I wait until the opponent cannot fight, or a suitable moment, to attack." An attack on a player is a bot
     move only when (a) no untapped Controlled Character of that player that can pay its guard cost would defeat the attacker, or
     (b) the bot is ready for the finishing strike (botReady = 1: its attack covers the damage still needed), or (c) this hit alone wins. */
  AA4.botAttackOk = (S, db, seat, it, w0, style) => {
    if (!S.chars[it.ch]) return true;
    const sty = style || STYLE;
    const w = w0 || W(), lim = AA4.LOSE_DAMAGE || 10;
    const A0 = statsOf(S, db, it.ch), at0 = (+A0.at || 0) + (+it.boost || 0);
    if (it.target && it.target.seat != null && at0 >= lim - S.players[it.target.seat].zones.damage.length) return true;   // this hit can win
    if (styled(sty) && S.players[seat].zones.deck.length >= (+sty.critical || 0)) {
      if (!AA4.botHeroReady(S, db, seat, sty)) return false;   // Hero Frontal Attack: wait for the Main Attacker (Revise#379)
      if (sty.chargeMin || sty.drawMin) { let ps = {}; try { ps = AA4.playerStats(S, db, seat); } catch (x) { /* */ } if ((+ps.charge || 0) < (+sty.chargeMin || 0) || (+ps.draw || 0) < (+sty.drawMin || 0)) return false; }   // Supportive Leader: enough Charge and Draw first
      const names = heroNames(db, sty), hero = hasName(S, db, it.ch, names);
      if (sty.only && !hero) return false;   // only the hero attacks (Revise#383)
      if (sty.shy && sty.shy.length) {   // Revise#388: these attack a player only when nobody there can guard
        const shy = new Set(sty.shy.map(k => (db.card(k) || {}).name).filter(Boolean)), oppS = it.target && it.target.seat != null ? it.target.seat : null;
        if (hasName(S, db, it.ch, shy) && (oppS == null || AA4.controlledOf(S, oppS).some(id => { const c = S.chars[id]; if (!c || (c.flags && c.flags.tapped)) return false; const g = statsOf(S, db, id); return g.guardFree || c.power.length >= (+g.guardCost || 0); }))) return false;
      }
      if (sty.safe && hero) {
        const de0 = +A0.de || 0, oppS = it.target && it.target.seat != null ? it.target.seat : null;
        const threats = it.target && it.target.ch ? [it.target.ch] : oppS == null ? [] : AA4.controlledOf(S, oppS).filter(id => { const c = S.chars[id]; if (!c || (c.flags && c.flags.tapped)) return false; const g = statsOf(S, db, id); return g.guardFree || c.power.length >= (+g.guardCost || 0); });
        if (threats.some(id => (+statsOf(S, db, id).at || 0) >= de0)) return false;   // it would not stay alive
      }
    }
    // Pack (Revise#375): charge first — no attack while the power on its Controlled Characters is below X (not when the deck is nearly gone: then it has to fight)
    const powerNow = AA4.controlledOf(S, seat).reduce((n, id) => n + S.chars[id].power.length, 0);
    let chargeNow = 0; try { chargeNow = +AA4.playerStats(S, db, seat).charge || 0; } catch (x) { /* */ }
    const offensive = A0.skills && A0.skills.offensive != null;
    if (!offensive && (powerNow < Math.round(w.attackPowerMin) || chargeNow < Math.round(w.attackChargeMin) || AA4.botOwnTurn(S) < Math.round(w.attackTurnMin)) && S.players[seat].zones.deck.length >= 10) return false;
    if (it.target && it.target.ch && S.chars[it.target.ch]) {   // an attack on a character: not when it defeats the attacker and survives
      const T = statsOf(S, db, it.target.ch);
      return !((+T.at || 0) >= (+A0.de || 0) && at0 < (+T.de || 0));
    }
    if (!(it.target && it.target.seat != null)) return true;
    const opp = it.target.seat, A = A0, at = at0, de = +A.de || 0;
    { const top = db.card(S.cards[AA4.topOf(S.chars[it.ch])].key) || {};   // Revise#332: a named supporter stays back (untapped: its effects, a guard) until the finishing strike
      if (top.name && AA4.botRole(top) === "supporter" && AA4.botReady(S, db, seat) < 1) return false; }
    const guards = AA4.controlledOf(S, opp).filter(id => { const c = S.chars[id]; if (!c || (c.flags && c.flags.tapped)) return false; const g = statsOf(S, db, id); return g.guardFree || c.power.length >= (+g.guardCost || 0) + (+it.boost || 0); });
    if (!guards.some(id => (+statsOf(S, db, id).at || 0) >= de)) return true;   // nobody there can defeat the attacker
    // Revise#375 (Pack: "the bot suicides by attacking and leaves no charge on the field"): an attacker that a guard would defeat only goes as part
    // of a strike that wins even so — the attacks left over after every guard there has taken the strongest ones still cover the damage needed
    if (!Math.round(w.attackStrike)) return AA4.botReady(S, db, seat) >= 1;
    const atks = AA4.controlledOf(S, seat).filter(id => !(S.chars[id].flags && S.chars[id].flags.tapped)).map(id => Math.max(0, +statsOf(S, db, id).at || 0)).sort((x, y) => y - x);
    return atks.slice(guards.length).reduce((n, v) => n + v, 0) >= lim - S.players[opp].zones.damage.length;
  };
  /* Pack (Revise#381): what a Break card WITHOUT a Name is for —
     (1) more Charge or Draw at once: such a card (it has Charge or Draw) goes on a character in the Active Area only;
     (2) more Factor before other cards are played: on a Controlled Character of ANOTHER faction only when that Factor is really needed —
         a card in the hand asks for more of the Break card's faction than the bot controls now.
     A plain one (neither) goes where it went before, but never on a Controlled Character of another faction without that need. */
  const skillOn = (inf, k) => { const v = inf.skills && inf.skills[k]; return v === true || (typeof v === "number" && v > 0) || !!(v && typeof v === "object"); };
  AA4.botFactorNeeded = (S, db, seat, faction, except) => {
    let have = {}; try { have = AA4.factorsHave(S, db, seat); } catch (e) { return false; }
    return S.players[seat].zones.hand.some(id => { if (id === except) return false; const x = db.card(S.cards[id].key) || {}; return (+(x.factor || {})[faction] || 0) > (+have[faction] || 0); });
  };
  AA4.botPlainBreakOk = (S, db, seat, card, chId) => {
    const inf = db.card(S.cards[card].key) || {}, ch = S.chars[chId];
    if (inf.type !== "Break" || inf.name || !ch || ch.owner !== seat) return true;
    const controlled = AA4.isControlled(ch), tf = statsOf(S, db, chId).faction;
    if (controlled && tf && inf.faction && tf !== inf.faction) return AA4.botFactorNeeded(S, db, seat, inf.faction, card);   // (2)
    if (skillOn(inf, "charge") || skillOn(inf, "draw")) return !controlled;   // (1)
    return true;
  };
  AA4.botGuardOk = (S, db, seat, it, w0) => {
    const b = S.battle, w = w0 || W();
    if (!b || !S.chars[b.attacker] || !S.chars[it.ch] || !(b.target && b.target.seat === seat)) return true;
    const A = statsOf(S, db, b.attacker), G = statsOf(S, db, it.ch), at = +A.at || 0;
    if (at < (+G.de || 0)) return true;   // the guard lives
    if (S.players[seat].zones.damage.length + at >= (AA4.LOSE_DAMAGE || 10)) return true;   // the hit would end the game: guard
    let ps = {}; try { ps = AA4.playerStats(S, db, seat); } catch (x) { /* */ }
    return !((+ps.charge || 0) < Math.round(w.guardChargeMin) || (+ps.draw || 0) < Math.round(w.guardDrawMin));
  };
  /* Pack (Revise#387): a Break card with a cost goes on a character with "このキャラクターをブレイクする場合、≪そのブレイクカードのコスト≫は手札に戻る" when it can —
     the cost comes back to the hand. A Name-level Break card whose Name is already on the bot's field is the exception: it belongs on that character. */
  AA4.botBreakBack = (S, db, chId) => { const ch = S.chars[chId]; if (!ch) return false; const inf = db.card(S.cards[AA4.topOf(ch)].key) || {};
    return (inf.abilities || []).some(a => a && a.mod && a.mod.key === "dest" && a.mod.value && a.mod.value.type === "Break" && a.mod.value.onTarget === "self" && a.mod.value.to === "hand"); };
  AA4.botBreakBackOk = (S, db, seat, card, chId) => {
    const b = db.card(S.cards[card].key) || {}, cost = typeof b.cost === "number" ? b.cost : +b.cost || 0;
    if (b.type !== "Break" || cost <= 0 || !S.chars[chId] || S.chars[chId].owner !== seat || AA4.botBreakBack(S, db, chId)) return true;
    if (b.name && AA4.charsOf(S, seat).some(id => S.chars[id].stack.some(c => (db.card(S.cards[c].key) || {}).name === b.name))) return true;   // its Name is on the field already
    let own = []; try { own = AA4.breakTargets(S, db, seat, card, false, b).filter(c => S.chars[c] && S.chars[c].owner === seat); } catch (e) { return true; }
    return !own.some(c => AA4.botBreakBack(S, db, c) && AA4.botPlainBreakOk(S, db, seat, card, c));   // such a character is there: this one is not the place
  };
  const tgtCh = t => (t && typeof t === "object" ? t.ch : t);
  /** Hand-made conditions for playing one card (Revise#388, STYLE.useIf[key]): nameOn — a character with that card's Name is on its field;
      oppNoSkillMin {skill, n} — at least n Controlled Characters of an opponent lack that skill; powerForBreak — after this card's cost, the
      power left pays a Break card in the hand whose Factor is met. */
  const useOk = (S, db, seat, card, cond) => {
    const power = AA4.controlledOf(S, seat).reduce((n, id) => n + S.chars[id].power.length, 0), costOf = x => (typeof x.cost === "number" ? x.cost : +x.cost || 0);
    if (cond.nameOn) { const nm = (db.card(cond.nameOn) || {}).name; if (!nm || !AA4.charsOf(S, seat).some(id => hasName(S, db, id, new Set([nm])))) return false; }
    if (cond.oppNoSkillMin) { const k = cond.oppNoSkillMin.skill, n = AA4.living(S).filter(s => s !== seat).reduce((m, o) => Math.max(m, AA4.controlledOf(S, o).filter(id => statsOf(S, db, id).skills && statsOf(S, db, id).skills[k] == null).length), 0); if (n < cond.oppNoSkillMin.n) return false; }
    if (cond.powerForBreak) { const left = power - costOf(db.card(S.cards[card].key) || {}); if (!S.players[seat].zones.hand.some(id => { const x = db.card(S.cards[id].key) || {}; return id !== card && x.type === "Break" && costOf(x) > 0 && facOk(S, db, seat, x) && left >= costOf(x); })) return false; }
    return true;
  };
  const keepMove = (S, db, seat, it, w) => {
    if (styled(STYLE) && it.t === "declare" && it.kind === "set" && it.card && S.cards[it.card] && S.cards[it.card].place.z === "hand") {   // Revise#388
      const key = S.cards[it.card].key, inf = db.card(key) || {};
      if (STYLE.useIf && STYLE.useIf[key] && !useOk(S, db, seat, it.card, STYLE.useIf[key])) return false;
      if (STYLE.first && key !== STYLE.first && inf.type === "Break" && !AA4.charsOf(S, seat).some(c => S.chars[c].stack.some(k => S.cards[k].key === STYLE.first))) {   // "this Break card is the first one to set"
        const power = AA4.controlledOf(S, seat).reduce((n, id) => n + S.chars[id].power.length, 0);
        if (S.players[seat].zones.hand.some(id => { const x = db.card(S.cards[id].key) || {}; return S.cards[id].key === STYLE.first && facOk(S, db, seat, x) && power >= (typeof x.cost === "number" ? x.cost : +x.cost || 0); })) return false;
      }
    }
    if (styled(STYLE) && STYLE.stack) {   // Revise#383
      const names = heroNames(db, STYLE), d0 = S.draft;
      if (it.t === "target" && d0 && d0.seat === seat && d0.kind === "set" && d0.card && S.cards[d0.card]) {
        const b = db.card(S.cards[d0.card].key) || {}, c = tgtCh((it.targets || [])[0]);
        if (b.type === "Break" && c && S.chars[c] && S.chars[c].owner === seat) {
          if (STYLE.top && STYLE.mainBreak && S.cards[AA4.topOf(S.chars[c])].key === STYLE.mainBreak) return false;   // the Main Break stays on top
          if (names.has(b.name)) { const one = new Set([b.name]), same = AA4.charsOf(S, seat).filter(id => hasName(S, db, id, one)); if (same.length && !same.includes(c)) return false; }   // onto the character that has this Name
        }
      }
      if (STYLE.top && it.t === "declare" && it.kind === "set" && it.card && S.cards[it.card] && S.cards[it.card].key === STYLE.mainBreak && S.cards[it.card].place.z === "hand") {
        const power = AA4.controlledOf(S, seat).reduce((n, id) => n + S.chars[id].power.length, 0);
        if (S.players[seat].zones.hand.some(id => { const x = db.card(S.cards[id].key) || {}; return S.cards[id].key !== STYLE.mainBreak && x.type === "Break" && names.has(x.name) && facOk(S, db, seat, x) && power >= (typeof x.cost === "number" ? x.cost : +x.cost || 0)
          && !AA4.charsOf(S, seat).some(c => S.chars[c].stack.some(k => S.cards[k].key === S.cards[id].key)); })) return false;   // another one of the Name goes under it first
      }
    }
    if (it.t === "target" && S.draft && S.draft.seat === seat && S.draft.kind === "set" && S.draft.card && S.cards[S.draft.card] && !(styled(STYLE) && heroKeys(STYLE).has(S.cards[S.draft.card].key))) {
      const c = tgtCh((it.targets || [])[0]);
      if (c && S.chars[c]) { if (!AA4.botPlainBreakOk(S, db, seat, S.draft.card, c)) return false; if (!AA4.botBreakBackOk(S, db, seat, S.draft.card, c)) return false; return true; }
    }
    if (it.t === "declare" && it.kind === "set" && it.card && !it.asFast && !it.asChar && S.cards[it.card] && S.cards[it.card].place.z === "hand") {   // no place it should go: the card waits in the hand
      const b = db.card(S.cards[it.card].key) || {};
      if (b.type === "Break" && !b.name && !(styled(STYLE) && heroKeys(STYLE).has(S.cards[it.card].key))) { let own = null; try { own = AA4.breakTargets(S, db, seat, it.card, false, b).filter(c => S.chars[c] && S.chars[c].owner === seat); } catch (e) { own = null; }
        if (own && own.length && !own.some(c => AA4.botPlainBreakOk(S, db, seat, it.card, c))) return false; }
    }
    if (it.t === "declare" && it.kind === "effect" && costBackOnly(S, db, it.ch, it.card, it.i)) return AA4.botWantedBack(S, db, seat, it.ch).length > 0;
    if (it.t === "declare" && it.kind === "set" && it.card && !it.asBreak && !it.asFast && S.cards[it.card] && S.cards[it.card].place.z === "hand") return AA4.botSetCharOk(S, db, seat, it.card, w);
    if (it.t === "declare" && it.kind === "attack") return AA4.botAttackOk(S, db, seat, it, w);
    if (it.t === "declare" && (it.kind === "guard" || it.kind === "join")) return AA4.botGuardOk(S, db, seat, it, w);
    if (it.t === "charge" && it.card && S.cards[it.card] && S.cards[it.card].place.z === "hand") {   // which hand cards may become power cards (Revise#332, #379, #391, #392)
      const prot = AA4.botProtected(S, db, seat), lv = prot.get(it.card) || 0;
      if (lv === 2) return false;
      if (lv === 1) return !S.players[seat].zones.hand.some(id => id !== it.card && !prot.get(id));   // only when no free card is left
    }
    const d = S.draft;
    if (it.t === "pay" && d && d.seat === seat && d.kind === "effect" && costBackOnly(S, db, d.ch, d.card, d.i)) { const want = AA4.botWantedBack(S, db, seat, d.ch); return !want.length || (it.cards || []).some(id => want.includes(id)); }
    return true;
  };
  /** Each legal move with its features (the change in the board after it + its hints); null features = could not be tried. */
  AA4.botScored = (S, db, seat, by, opts = {}) => {
    STYLE = opts.style || null;
    try { return botScored0(S, db, seat, by, opts); } finally { STYLE = null; }
  };
  const botScored0 = (S, db, seat, by, opts) => {
    let cands = AA4.candidates(S, db, by, seat, { manual: false }).filter(it => !["move", "moveChar", "draw", "shuffle", "search", "unCharge"].includes(it.t));   // unCharge: no going back and forth (Revise#313)
    { // one character is brought to the Control Area at a time (Revise#392): a power card for an Active Character goes to botChargeTarget.
      // (The list of legal moves offers every card on its first target only, so the move is pointed at the target instead of being dropped.)
      const tg = AA4.botChargeTarget(S, db, seat, new Set(cands.filter(it => it.t === "charge" && it.ch && S.chars[it.ch] && !AA4.isControlled(S.chars[it.ch])).map(it => it.ch)));
      if (tg) { const seen = new Set(); cands = cands.map(it => (it.t === "charge" && it.ch && S.chars[it.ch] && !AA4.isControlled(S.chars[it.ch]) && it.ch !== tg ? Object.assign({}, it, { ch: tg }) : it)).filter(it => { if (it.t !== "charge") return true; const k = JSON.stringify([it.ch, it.card || null, !!it.fromDeck]); if (seen.has(k)) return false; seen.add(k); return true; }); } }
    { const wk = Object.assign(W(), opts.weights || {}), kept = cands.filter(it => keepMove(S, db, seat, it, wk)); if (kept.length) cands = kept; }
    const max = opts.max || 70;
    if (cands.length > max) {   // too many to try: keep the moves that end a step, and a spread of the rest
      const keep = cands.filter(it => ["next", "pass", "noGuard"].includes(it.t)), rest = cands.filter(it => !keep.includes(it));
      const stepN = rest.length / (max - keep.length);
      cands = keep.concat(rest.filter((_, i) => Math.floor(i % stepN) === 0)).concat(opts.must ? [opts.must] : []);
    }
    const wk0 = Object.assign(W(), opts.weights || {});
    const f0 = AA4.botFeatures(S, db, seat), ready = AA4.botReady(S, db, seat), early = 1 - ready;
    const lim = AA4.LOSE_DAMAGE || 10, need = Math.max(1, Math.min(...AA4.living(S).filter(s => s !== seat).map(o => lim - S.players[o].zones.damage.length).concat([lim])));
    return cands.map(it => {
      try {
        const S2 = AA4.clone(S), r = AA4.step(S2, it, db);
        if (r && r.ok === false) return { it, f: null };
        if (r && (r.events || []).some(e => e.e === "declarationCancelled")) return { it, f: null };   // a declaration that cancels itself (no valid target) is not a move (Revise#332)
        // Pack's replays (Revise#394): 覚醒の乙女 could be declared with nothing to set it on (its cost depends on the target, and none could be paid) —
        // the only move left was Cancel, and the bot declared it again, for ever. A declaration that leaves only Cancel is not a move.
        if (it.t === "declare" && S2.draft && S2.draft.seat === seat && !S2.decisions.length) { let nx = []; try { nx = AA4.candidates(S2, db, by, seat, { manual: false }); } catch (e) { nx = [{ t: "?" }]; } if (nx.length && nx.every(x => x.t === "cancel" || !keepMove(S2, db, seat, x, wk0))) return { it, f: null }; }   // …or only moves its own rules refuse (the second replay: both targets were against its playstyle)
        const f1 = AA4.botFeatures(S2, db, seat), f = Object.assign({}, hintF(S, db, seat, it));
        if (f1._won) f._won = 1; else if (f1._lost) f._lost = 1;
        else for (const k of new Set(Object.keys(f1).concat(Object.keys(f0)))) if (k[0] !== "_") f[k] = (f[k] || 0) + (f1[k] || 0) - (f0[k] || 0);
        if (!f._won && !f._lost) {   // build first, fight when ready (Pack, Revise#311)
          if (f.set) f.setEarly = f.set * early;
          if (f.charge) f.chargeEarly = f.charge * early;
          if (f.chars) f.charsEarly = f.chars * early;
          if (f.domReady) f.domReadyEarly = f.domReady * early;
          if (f.actives) f.activesEarly = f.actives * early;
          if (f.power) f.powerEarly = f.power * early;
          if (f.stats) f.statsEarly = f.stats * early;
          if (f.attack) { f.attackEarly = early; f.attackReady = ready; }
          if (f.attackPlayer) { f.attackPlayerReady = ready; if (f.attackAt >= need) f.lethal = 1; }   // this hit can finish the opponent
        }
        return { it, f };
      } catch (e) { return { it, f: null }; }
    });
  };
  AA4.botScore = (w, f) => (f._won ? 1000 : f._lost ? -1000 : dot(w, f));

  /** The bot's move for `seat` (by = its player id), or null when it has nothing to do. */
  AA4.botChoose = (S, db, seat, by, opts = {}) => {
    const w = Object.assign(W(), opts.weights || {});
    if (S.stage === "mulligan") {
      const p = S.players[seat]; if (!p || p.ready) return null;
      // Pack (Revise#317): like a player, the opening hand goes through Auto Re-shuffle (it always re-shuffles at least once);
      // keep when it found a matching hand, or after a few runs that didn't
      const m = p.autoMsg;
      if (!m) return { by, seat, t: "autoMulligan" };
      return Object.assign({ by, seat }, m.ok || (m.runs || 0) >= 3 ? { t: "keep" } : { t: "autoMulligan" });
    }
    const list = AA4.botScored(S, db, seat, by, opts);
    let best = null, bestV = -Infinity;
    for (const { it, f } of list) {
      if (!f) continue;
      const v = AA4.botScore(w, f) + (opts.noise || 0) * (Math.random() - .5);
      if (v > bestV) { bestV = v; best = it; }
    }
    return best || (list[0] && list[0].it) || null;
  };

  /** Should the bot act now? Its own turn; or something waits for it (a choice, an ability, a guard, a response). */
  AA4.botTurn = (S, seat) => {
    if (!S || S.stage === "over" || S.stage === "lobby") return false;
    if (S.stage === "mulligan") return !!(S.players[seat] && !S.players[seat].ready);
    if (S.decisions.some(d => d.seat === seat) || S.triggers.some(t => t.seat === seat)) return true;
    if (S.decisions.length) return false;
    return S.turn.player === seat || S.stack.length > 0 || !!S.battle;
  };
  AA4.BOT_DEFAULT_WEIGHTS = DEFAULT;
})();
