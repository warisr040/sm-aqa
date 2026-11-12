/* ==========================================================================
   Play online: a virtual table for two players (plus spectators).

   Event-sourced: every action is one event in a shared log. Each browser keeps
   the log sorted by event id and replays it with applyEvent(), so both players
   always see the same table. Undo = an "undo" event that makes the replay skip
   your last action (only while nobody has acted since).

   Game flow (rulebook "Turn order"):
     Decide the first player → each player keeps or re-shuffles the opening hand (once)
     → turns: Draw (first player skips turn 1) → Faction → Main → Power card → Discard.
   The site does the bookkeeping for each phase; card text and rule checks are up to
   the players.

   Mouse: left click = play / choose, right click (long press on phones) = card details.

   Transports
   - Firebase Realtime Database (rooms/<CODE>/log), configured in
     assets/firebase-config.js (window.AA_FIREBASE).
   - "This computer" test rooms (TEST-xxxx): BroadcastChannel + localStorage,
     so two browser tabs can play each other without any setup.

   Not cheat-proof: the shared log holds every card (fine for friends).

   Files (joined in name order):
     06b-play-engine.js   constants, state, rules helpers (stats, damage, battle, costs, faction check,
                          attack), the event reducer applyEvent() and replay / undo
     06c-target.js        target specs (field effects, area damage)
     06d-effects.js       Effect System (effect types → actions)
     06e-conditions.js    Condition System ("…場合、…を得る")
     06f-play-net.js      transports and room lifecycle
     06g-play-ui.js       rendering and dialogs
     06h-play-input.js    input handling, Solo Test
   ========================================================================== */

const PHASES = ["Draw", "Faction", "Main", "Power card", "Discard"];
const PHASES_JP = ["ドロー", "勢力", "メイン", "パワーカード", "ディスカード"];
const LIST_ZONES = ["deck", "hand", "discard", "damage", "removed"];
const ZONE_LABEL = { deck: "deck", deckb: "deck (bottom)", hand: "hand", discard: "discard pile", damage: "damage zone", removed: "removed from game" };
const START_HAND = 7, HAND_LIMIT = 7, LOSE_DAMAGE = 10;
const NO_FACTION = "None";
const FIREBASE_SDK = ["https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
                      "https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js"];

const PLAY = {
  room: "", transport: null, events: [], ids: new Set(), S: null, seat: -1, ready: false, cid: "",
  name: store.get("aa-pname", ""),
  autoSkip: store.get("aa-autoskip", false),              // skip phases with nothing to do (your own preference)
  autoDone: new Set(),                                    // "turn:phase" already auto-skipped (so Undo is not skipped again)
  efx: null,    // using an effect: choosing its target {pid, src, i, n, x, pick, go}
  mode: null,   // playing a card: {uid, step: "pay"|"target", need, pays: [pid…], act}
  psel: null,   // power card phase selection: {hand: [uid…], deck: n, q: [{s: "h", u} | {s: "d"}]} — set one by one
  size: store.get("aa-psize", "s"),                       // card size: s (small) / m (fit) / l (large)
  logOpen: store.get("aa-plog", innerWidth > 900),        // game log unfolded
  ucp: store.get("aa-pucp", null),                        // User Control Panel position {x, y}
  ucpMin: store.get("aa-pucp-min", false),                // User Control Panel folded to its title bar
  wins: store.get("aa-pwins", null),                      // Charge / Cost window position {x, y}
  view: "play",                                           // which tab shows the table: "play" (online) or "solo"
  error: "",
};
/** Player id: one per device for online rooms (a reload keeps your seat); one per browser tab for
    test rooms, so two tabs on one computer are two players. */
function playerId(room) {
  const mk = () => Math.random().toString(36).slice(2, 10);
  if (isTestRoom(room)) {
    try { let c = sessionStorage.getItem("aa-cid-test"); if (!c) { c = mk(); sessionStorage.setItem("aa-cid-test", c); } return c; } catch (e) { return mk(); }
  }
  let c = store.get("aa-cid", "");
  if (!c) { c = mk(); store.set("aa-cid", c); }
  return c;
}
const onlineReady = () => !!(window.AA_FIREBASE && window.AA_FIREBASE.databaseURL);
const isSolo = code => /^SOLO-/.test(code || "");
const isTestRoom = code => /^(TEST|SOLO)-/.test(code || "");   // stored in this browser only

/* ---------- ids, codes, shuffling ---------- */
/** Time-sortable id (same idea as Firebase push keys), for test rooms. */
const newId = () => Date.now().toString(36).padStart(9, "0") + Math.random().toString(36).slice(2, 7);
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = n => Array.from({ length: n }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
function shuffled(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
/** The Deck Builder deck as a flat list of card keys (one per copy). */
const deckKeysOf = d => (d ? CATS.flatMap(C => d.cols[C.id].flatMap(e => Array(e.n).fill(e.k))) : []);
const deckKeys = () => deckKeysOf(deck);
/** Solo Test deck: the slot chosen on the Solo start screen (default: the deck open in the Deck Builder). */
const soloSlot = () => { const i = store.get("aa-solo-slot", null); return i == null || i < 0 || i >= DECK_SLOTS ? deckSlot : i; };
const soloDeck = () => (soloSlot() === deckSlot ? deck : deckSlots[soloSlot()]);
/** Play Online deck: the slot chosen in the lobby (default: the deck open in the Deck Builder), like Solo Test. */
const onlineSlot = () => { const i = store.get("aa-online-slot", null); return i == null || i < 0 || i >= DECK_SLOTS ? deckSlot : i; };
const onlineDeck = () => (onlineSlot() === deckSlot ? deck : deckSlots[onlineSlot()]);
/** <option>s for a deck-slot select (empty slots can't be chosen). */
const deckSlotOptions = cur => Array.from({ length: SLOT_PAGES }, (_, p) => { const rows = Array.from({ length: SLOT_PAGE }, (_, k) => { const i = p * SLOT_PAGE + k, x = i === deckSlot ? deck : deckSlots[i], c = deckKeysOf(x).length;
    return !c && i !== cur && p ? "" : `<option value="${i}"${i === cur ? " selected" : ""}${c ? "" : " disabled"}>Slot ${i + 1} · ${esc((x && x.name) || "(empty)")} · ${c} cards${i === deckSlot ? " (open in Deck Builder)" : ""}</option>`; }).join("");
  return rows ? `<optgroup label="Page ${p + 1}">${rows}</optgroup>` : ""; }).join("");
const numOf = v => { const m = String(v || "").match(/\d+/); return m ? +m[0] : null; };

/* ---------- game state: replay of the event log ---------- */
function newState() {
  return { players: [], spect: {}, stage: "first", first: 0, turn: 0, phase: 0, turnNo: 0, log: [],
           pview: { state: "off", by: -1 }, last: null, rules: { handUp: false } };   // power cards from hand: only their owner sees them (default)
}
const seatOf = uid => +uid.split("-")[0];
const keyOf = (S, uid) => { const p = S.players[seatOf(uid)]; return p && p.cards[uid]; };
const cardOf = (S, uid) => card(keyOf(S, uid));
const nameOf = (S, uid) => { const c = cardOf(S, uid); return c ? c.jp : "a card"; };
const pileTop = pile => pile.stack[pile.stack.length - 1];
/** Piles of one active-area slot (bottom → top). */
const slotPiles = (p, slot) => p.porder.filter(pid => p.piles[pid].area === "faction" && p.piles[pid].slot === slot);
const isSlotTop = (p, pid) => { const pile = p.piles[pid]; const list = slotPiles(p, pile.slot); return list[list.length - 1] === pid; };
const slotsOf = p => FACTS.concat(p.porder.some(pid => p.piles[pid].area === "faction" && p.piles[pid].slot === NO_FACTION) ? [NO_FACTION] : []);

function findPile(S, pid) {
  for (const p of S.players) if (p.piles[pid]) return { p, pile: p.piles[pid] };
  return null;
}
function dropPile(S, p, pid, opts = {}) {
  const pile = p.piles[pid];
  if (!pile) return;
  // defeated in battle: named Break cards (“name”) go to their owner's damage pile instead of the discard pile
  const toDamage = u => opts.battle && (cardOf(S, u) || {}).t === "Break" && !!cardName(cardOf(S, u));
  [...pile.stack, ...pile.power, ...pile.perm].forEach(u => S.players[seatOf(u)][pile.stack.includes(u) && toDamage(u) ? "damage" : "discard"].push(u));
  delete p.piles[pid];
  p.porder = p.porder.filter(x => x !== pid);
}
function newPile(p, pid, area, uid, slot) {
  p.piles[pid] = { area, slot: slot || "", row: "front", stack: [uid], power: [], perm: [], rest: false };
  p.porder.push(pid);
}
/** Take a card out of wherever it is (zones or the table). */
function takeOut(S, uid) {
  for (const p of S.players) {
    for (const z of LIST_ZONES) { const i = p[z].indexOf(uid); if (i >= 0) { p[z].splice(i, 1); return z; } }
    for (const pid of p.porder) {
      const pile = p.piles[pid];
      for (const slot of ["stack", "power", "perm"]) {
        const i = pile[slot].indexOf(uid);
        if (i < 0) continue;
        pile[slot].splice(i, 1);
        if (!pile.stack.length) dropPile(S, p, pid);
        return "table";
      }
    }
  }
  return null;
}
/** Paying a cost: power cards go to the Cost window (p.paid) until the player chooses where they go. */
/** pids: ["pid", …] (top power card of that character) or [{pid, uid}, …] (that exact power card). */
function payPower(S, p, pids) {
  let n = 0;
  for (const x of pids || []) {
    const pid = typeof x === "string" ? x : x && x.pid, pile = p.piles[pid];
    if (!pile || !pile.power.length) continue;
    const i = x && x.uid ? pile.power.indexOf(x.uid) : -1;
    p.paid.push(i >= 0 ? pile.power.splice(i, 1)[0] : pile.power.pop()); n++;
  }
  return n;
}
/** Pay n power cards from one character: the chosen ones (uids) when they are valid, else the top ones. */
function payFrom(S, p, pid, n, uids) {
  const pile = p.piles[pid], ok = Array.isArray(uids) && uids.length === n && new Set(uids).size === n && uids.every(u => pile.power.includes(u));
  return payPower(S, p, ok ? uids.map(uid => ({ pid, uid })) : Array(n).fill(pid));
}
/** Can the viewer see this power card's face? Deck-charged: never (unless the field effect is on). Hand-charged face down (game rule): only its owner. */
const isDownPower = (p, uid) => !!p && (p.down || []).includes(uid);
const powerFaceUp = (S, p, uid) => S.pview.state === "on" || (!isHiddenPower(p, uid) && !(isDownPower(p, uid) && PLAY.seat !== p.seat));
/** Power cards charged from the deck stay hidden (shown as the deck sleeve) even to their owner. */
const isHiddenPower = (p, uid) => !!p && p.hidden.includes(uid);
/** Breakable: shares a class icon (or the player confirmed an exception: force); in an opponent's territory
    it must have no power cards. In the Active area any character of a faction party can be broken, not only the top one. */
function canBreak(S, bc, owner, pid, me, force) {
  const pile = owner.piles[pid], top = pile && cardOf(S, pileTop(pile));
  if (!top || !bc || pile.area === "pf") return false;
  if (top.t !== "Character" && top.t !== "Break") return false;
  if (owner.seat !== me && pile.power.length) return false;
  const r = breakRule(bc), normal = () => !!force || sharesIcon(S, bc, owner, pid);
  if (!r) return normal();
  if (r.ifOnField) return r.names.some(n => S.players.some(o => o.porder.some(q => o.piles[q].area !== "pf" && o.piles[q].stack.some(u => brNameIs(cardOf(S, u), n))))) && normal();
  const fits = breakFits(S, r, owner, pile, me);
  if (r.only) return fits && (r.names.length || r.any ? true : normal());   // 【“X”のみブレイク可能】: only on that name (the name replaces the icon check; no exception)
  return fits || normal();   // 【分類に関わらず、…をブレイク可能】: those characters need no shared icon; others still do
}
/** Break restriction written on the card: 【“ィアーリス”のみブレイク可能】, 【分類に関わらず、ダークロアのキャラクターをブレイク可能】 … */
const BR_FACTIONS = [["E.G.O.", /E[.．]G[.．]O[.．]?/], ["Arayashiki", /阿羅耶識/], ["WIZ-DOM", /WIZ[-ー－]DOM/], ["Darklore", /ダークロア/], ["Polestar Empire", /極星帝国/], ["Eraser", /イレイザー/]];
let BR_ICONS = null;
function breakRule(c) {
  if (c._br !== undefined) return c._br;
  const m = (c.text || "").match(/【([^】]*ブレイク可能[^】]*)】/);
  if (!m) return (c._br = null);
  const t = m[1], bare = t.replace(/[“「][^”」]*[”」]/g, "");
  if (!BR_ICONS) BR_ICONS = [...new Set(CARDS.flatMap(x => x.cls || []))].filter(x => x.length > 1).sort((a, b) => b.length - a.length);
  return (c._br = {
    text: t, only: /のみ/.test(bare) && !/場に存在する場合のみ/.test(bare), ifOnField: /場に存在する場合のみ/.test(bare),
    names: [...t.matchAll(/[“「]([^”」]+)[”」]/g)].map(x => x[1]), any: /関わらず|無視して/.test(bare),
    broken: /ブレイクしている/.test(bare), unbroken: /ブレイクしていない/.test(bare),
    factions: BR_FACTIONS.filter(([, re]) => re.test(bare)).map(x => x[0]),
    icons: BR_ICONS.filter(i => bare.includes(i) && !/分類・ネーム|ネーム・分類/.test(i)),
    dominated: /支配キャラクター/.test(bare), active: /勢力キャラクター/.test(bare), down: /▼/.test(bare),
    mine: /あなたのテリトリー/.test(bare), others: /他のプレイヤーのテリトリー/.test(bare),
    power0: /パワー0/.test(bare), powered: /パワーカードのセットされている/.test(bare), notNamed: /ネームレベルでない/.test(bare),
    mental: /精神攻撃力/.test(bare), guard: /ガード宣言/.test(bare), declared: /使用宣言時に指定した勢力/.test(bare),
  });
}
/** Does this character meet what the Break restriction asks for? (every part written on the card) */
function breakFits(S, r, owner, pile, me) {
  const top = cardOf(S, pileTop(pile)), all = pile.stack.map(u => cardOf(S, u)).filter(Boolean), isBroken = pile.stack.length > 1 || top.t === "Break";
  if (r.names.length && !r.names.some(n => all.some(c => brNameIs(c, n)))) return false;
  if (r.broken && !isBroken) return false;
  if (r.unbroken && isBroken) return false;
  if (r.factions.length && !r.factions.includes(top.f)) return false;
  if (r.icons.length && !r.icons.some(i => top.cls.includes(i))) return false;
  if (r.dominated && pile.area !== "dominion") return false;
  if (r.active && pile.area !== "faction") return false;
  if (r.mine && owner.seat !== me) return false;
  if (r.others && owner.seat === me) return false;
  if (r.power0 && pile.power.length) return false;
  if (r.powered && !pile.power.length) return false;
  if (r.notNamed && cardName(top)) return false;
  if (r.down && !/▼/.test(top.text || "") && !(top.sk && Object.keys(top.sk).some(k => /▼/.test(k)))) return false;
  if (r.mental && !/^\(/.test(String(top.st.at || ""))) return false;
  if (r.guard) { const at = curAttack(S); if (!at || at.rec.guard !== pileId(owner, pile)) return false; }
  if (r.declared) return false;   // faction named when declaring: not recorded — use the icon exception
  return true;
}
const brName = t => t.replace(/[“”「」"\s]/g, "");
/** “ィアーリス” = a card with that name (the part in “”); 「女帝竜“ィアーリス”」 = that full card name. */
const brNameIs = (c, n) => !!c && (brName(c.jp) === brName(n) || cardName(c) === brName(n));
const pileId = (o, pile) => Object.keys(o.piles).find(k => o.piles[k] === pile);
const sharesIcon = (S, bc, owner, pid) => { const top = cardOf(S, pileTop(owner.piles[pid])); return !!top && top.cls.some(t => bc.cls.includes(t)); };
/** Sum of a valued skill (Draw ±X, Charge +X) over the top cards in a player's Control area. */
function skillSum(S, p, skill) {
  let n = 0;
  for (const pid of p.porder) {
    const pile = p.piles[pid];
    if (pile.area !== "dominion") continue;
    const c = cardOf(S, pileTop(pile)), m = c && String(c.sk[skill] || "").match(/^([+-]?)(\d+)$/);
    if (m) n += (m[1] === "-" ? -1 : 1) * +m[2];
    for (const t of condSkills(S, p, pile).concat(abilitySkills(S, p, pile))) { const x = t.match(new RegExp("^" + skill + " ([+-]?)(\\d+)$")); if (x) n += (x[1] === "-" ? -1 : 1) * +x[2]; }   // from conditions
  }
  n += playerSkill(S, p, skill);   // from abilities of cards in zones / always-on (≪あなた≫はドロー+1を得る)
  return n;
}
/** Cards drawn in the Draw phase: 1 + Draw ±X of dominated characters (none on the first player's first turn). */
/** The first player skips the draw on turn 1. Solo Test: "go second" draws on turn 1 too. */
const skipsFirstDraw = S => S.turnNo === 1 && !(S.solo && S.rules && S.rules.second);
const isSecondPlayer = (S, o) => (S.solo ? !!(S.rules && S.rules.second) : S.first !== o.seat);
const drawCount = (S, p) => (skipsFirstDraw(S) ? 0 : Math.max(0, 1 + skillSum(S, p, "Draw")));
/** Power cards that may come from the deck this turn: the sum of Charge +X in the Control area. */
/** Hand limit: 7 ± the Capacity of your dominated characters (e.g. Capacity -1 → 6). */
const handLimit = (S, p) => Math.max(0, HAND_LIMIT + skillSum(S, p, "Capacity"));
const deckPowerMax = (S, p) => Math.max(0, skillSum(S, p, "Charge"));
const deckPowerUsed = (S, p) => (p.deckPow && p.deckPow.turn === S.turnNo ? p.deckPow.n : 0);
/* ==========================================================================
   Stats: base stats of the top card + every modifier source below.
   To support a new kind of effect, add an entry to STAT_SOURCES — a function that
   returns [{label, se, at, de}] for one character (se = mental, at = attack, de = defense).
   ========================================================================== */
/** A printed modifier: "+1" → 1, "-2" → -2, "+(1)" → 1, "±0" → 0, "+X" → null (set by the player). */
const modNum = v => { const m = String(v || "").match(/^([+\-−±]?)\(?(\d+)\)?$/); return m ? (m[1] === "-" || m[1] === "−" ? -1 : 1) * +m[2] : null; };
const STAT_SOURCES = [
  // Permanent cards set on the character: their printed Mental / Attack / Defense modifiers
  (S, owner, pile) => pile.perm.map(u => { const c = cardOf(S, u); return c && { label: `Permanent 「${c.jp}」`, se: modNum(c.st.se), at: modNum(c.st.at), de: modNum(c.st.de) }; }).filter(Boolean),
  // Fast / Project / effect changes added to this character (Adjust stats…)
  (S, owner, pile) => (pile.mods || []).filter(m => !(STAT_NOBATTLE && m.until === "battle")).map(m => ({ label: m.label + (m.until === "turn" ? " (until end of turn)" : m.until === "main" ? " (until end of main phase)" : m.until === "battle" ? " (this battle)" : ""), se: m.se, at: m.at, de: m.de })),
  // Field effects: e.g. "all characters with the Student icon get Attack / Defense +2"
  (S, owner, pile) => (S.fieldMods || []).filter(f => targetMatch(f, S, owner, pile)).map(f => ({ label: `Field: ${f.label}`, se: f.se, at: f.at, de: f.de })),
];
/** Effective stats of a pile: {se, at, de, mental (attack in brackets), base, parts, changed}. */
const STAT_BUSY = new Set();
let STAT_NOBATTLE = false;   // true while working out the stats a character would have outside the current battle
function statsOf(S, owner, pile) {
  const c = cardOf(S, pileTop(pile));
  const base = { se: numOf(c && c.st.se), at: numOf(c && c.st.at), de: numOf(c && c.st.de) };
  const out = { ...base, mental: /^\(/.test(String(c && c.st.at || "")), base, parts: [], changed: false };
  // sources marked .deep (conditions, abilities) may ask for stats themselves (e.g. "power = mental"):
  // while a pile's stats are being worked out, a nested request for the same pile uses only the plain sources
  const busy = STAT_BUSY.has(pile);
  STAT_BUSY.add(pile);
  try {
    for (const src of STAT_SOURCES) {
      if (busy && src.deep) continue;
      for (const m of src(S, owner, pile)) {
        if (!m || !(m.se || m.at || m.de)) continue;
        out.parts.push(m);
        for (const k of ["se", "at", "de"]) if (m[k]) { out[k] = Math.max(0, (out[k] || 0) + m[k]); out.changed = true; }
      }
    }
  } finally { if (!busy) STAT_BUSY.delete(pile); }
  return out;
}
const pileOwner = (S, pile) => S.players.find(p => Object.values(p.piles).includes(pile));
/** Mental power (with modifiers) of a pile's top card (null when it has none / X). */
const mentalOf = (S, pile) => { const o = pileOwner(S, pile); return o ? statsOf(S, o, pile).se : null; };
/** Power cards may not exceed mental power. */
const powerFits = (S, pile, add) => { const m = mentalOf(S, pile); return m == null || pile.power.length + add <= m; };
const canPower = (p, pid) => { const pile = p.piles[pid]; return pile && (pile.area === "dominion" || (pile.area === "faction" && isSlotTop(p, pid))); };

/** End of the power card phase: a top active character with power ≥ mental power is dominated (one per faction party). */
function dominate(S, p, log) {
  for (const slot of slotsOf(p)) {
    const list = slotPiles(p, slot), pid = list[list.length - 1];
    if (!pid) continue;
    const pile = p.piles[pid], m = statsOf(S, p, pile).se;
    if (m != null && pile.power.length >= m) {
      pile.area = "dominion"; pile.slot = ""; pile.row = "back";   // Active → Control area: the Back row
      log(`「${nameOf(S, pileTop(pile))}」 is dominated (power ${pile.power.length} / mental ${m}) and moves to ${p.name}'s control area (Back)`, pileTop(pile));
      queueTriggers(S, "dominated", [{ o: p, pid }], log);
    }
  }
}
/** Damage to a player. Normal: a Character from the deck goes to the Active area, anything else to the damage pile.
    Special: always the damage pile. */
function takeDamage(S, p, n, special, eid, log) {
  const moved = [];
  for (let i = 0; i < n && p.deck.length; i++) {
    const u = p.deck.shift(), c = cardOf(S, u);
    if (!special && c && c.t === "Character" && !nameOnField(S, c)) {
      newPile(p, `${eid}-${i}`, "faction", u, FACTS.includes(c.f) ? c.f : NO_FACTION);
      moved.push(`「${c.jp}」 → active area`);
    } else { p.damage.push(u); moved.push(`「${nameOf(S, u)}」 → damage pile`); }
  }
  log(`${p.name} took ${moved.length} ${special ? "special " : ""}damage: ${moved.join(", ")} · damage pile ${p.damage.length}${p.damage.length >= LOSE_DAMAGE ? ` — ${LOSE_DAMAGE} or more: ${p.name} loses!` : ""}`);
}

/** A named character (“name”) goes to the damage pile instead when the same name is already on the field. */
const cardName = c => { const m = c && c.jp.match(/“([^”]+)”/); return m ? m[1].replace(/\s+/g, "") : ""; };
function nameOnField(S, c) {
  const n = cardName(c);
  return !!n && S.players.some(p => p.porder.some(pid => p.piles[pid].stack.some(u => cardName(cardOf(S, u)) === n)));
}

/* ==========================================================================
   Damage to characters — battles, effects, Fast / Project cards and abilities all use damageCharacter().
   d = {normal, mental, battle: true for battle damage, from: attacking card (for Resist), label}
   Rules (rulebook p.29–39 and Skills):
     normal ≥ Defense → discarded (normal damage does not build up)
     mental, Control area character → discard that many power cards; not enough → discarded
     mental, Active area character → mental ≥ Mental power → discarded (power cards stay)
     both at once → checked separately; failing either discards it
   DAMAGE_RULES can cancel or change damage first (add new ones here).
   ========================================================================== */
/** Resist ?: no battle damage from characters of that faction / class icon (read from the card text: レジスト極星帝国 …). */
function resists(c, from) {
  if (!c || !from) return false;
  return [...String(c.text || "").matchAll(/レジスト([^\s　≪]+)/g)].some(([, t]) =>
    Object.entries(T_FACTIONS).some(([j, f]) => t.includes(j) && from.f === f) || from.cls.some(ic => t.includes(ic.replace("♂", ""))));
}
const DAMAGE_RULES = [
  { id: "shield", label: "Shield", apply: (S, o, pile, c, d) => (!d.battle && pileHasSkill(c, pile, "Shield", S, o) ? { normal: 0, mental: 0 } : null) },
  { id: "resist", label: "Resist", apply: (S, o, pile, c, d) => (d.battle && d.from && resists(c, d.from) ? { normal: 0, mental: 0 } : null) },
  // stat changes can carry flags later, e.g. {noMental: true} from "精神ダメージを受けない" effects
  // abilities of the character itself: "精神ダメージを受けない", "通常ダメージを受けない", "(…との)バトルによるダメージを受けない"
  { id: "ability", label: "Ability", apply: (S, o, pile, c, d) => abilityDamageRule(S, o, pile, d) },
  { id: "nomental", label: "No mental damage", apply: (S, o, pile, c, d) => ((pile.mods || []).some(m => m.noMental) && d.mental ? { mental: 0 } : null) },
];
/** "2 damage + mental 1" */
const dmgTxt = d => [d.normal && d.normal + " damage", d.mental && "mental " + d.mental].filter(Boolean).join(" + ");
/** Deal damage to one character. Returns true when it is discarded. */
function damageCharacter(S, owner, pid, d, log) {
  const pile = owner.piles[pid];
  if (!pile) return false;
  const c = cardOf(S, pileTop(pile)), nm = c ? c.jp : "a character", st = statsOf(S, owner, pile);
  let normal = Math.max(0, +d.normal || 0), mental = Math.max(0, +d.mental || 0);
  for (const r of DAMAGE_RULES) {
    const x = r.apply(S, owner, pile, c, { ...d, normal, mental });
    if (x) { if (x.normal != null && normal) { normal = x.normal; log(`「${nm}」: ${r.label} — no damage`); } if (x.mental != null && mental) { mental = x.mental; if (r.id !== "shield" && r.id !== "resist") log(`「${nm}」: ${r.label}`); } }
  }
  const why = [];
  if (mental) {
    if (pile.area === "dominion") {
      const k = Math.min(mental, pile.power.length);
      for (let i = 0; i < k; i++) owner.discard.push(pile.power.pop());
      if (k < mental) why.push(`mental ${mental} > ${k} power cards`);
      else log(`「${nm}」 discards ${k} power card${k === 1 ? "" : "s"} (mental damage ${mental})`);
    } else if (mental >= (st.se || 0)) why.push(`mental ${mental} ≥ mental power ${st.se || 0}`);
    else log(`「${nm}」 takes mental damage ${mental} (mental power ${st.se}) and stays`);
  }
  if (normal) {
    if (normal >= (st.de || 0)) why.push(`damage ${normal} ≥ defense ${st.de || 0}`);
    else log(`「${nm}」 takes ${normal} damage (defense ${st.de}) and survives`);
  }
  if (!why.length) return false;
  defeatPile(S, owner, pid, { battle: !!d.battle, damage: !!normal, why: why.join(", ") }, log);
  return true;
}
/* ---------- Leaving the field: Bind X and "…場に残す" (Prevent dead) ----------
   A character that would be discarded first waits in S.saves; its owner may pay Bind X (power cards → damage pile)
   or a "捨て札になる場合、…で場に残す" ability of a card in it, or let it go.
   Defense ≤ 0: defeated at once. If the 0 lasts (it is still ≤ 0 outside this battle, e.g. "until end of turn"),
   a save may be paid but the character is defeated anyway; if it comes only from this battle, a save keeps it. */
function defeatPile(S, owner, pid, d, log) {
  const pile = owner.piles[pid];
  if (!pile) return false;
  const nm = nameOf(S, pileTop(pile));
  if (!pile.dying) {
    const opts = saveOptions(S, owner, pid, d);
    if (opts.length) {
      pile.dying = true;
      S.saves = S.saves || [];
      S.saves.push({ id: `sv${S.log.length}-${pid}`, seat: owner.seat, pid, why: d.why || "", battle: !!d.battle, lasting: !!d.lasting, opts });
      log(`「${nm}」 would be discarded (${d.why || ""}) — ${owner.name} may keep it: ${opts.map(o => o.label).join(" / ")}`, pileTop(pile));
      return true;
    }
  }
  const named = d.battle ? pile.stack.filter(u => (cardOf(S, u) || {}).t === "Break" && cardName(cardOf(S, u))) : [];
  dropPile(S, owner, pid, { battle: !!d.battle });
  if (S.saves) S.saves = S.saves.filter(x => !(x.seat === owner.seat && x.pid === pid));
  if (named.length) log(`Named Break card${named.length === 1 ? "" : "s"} ${named.map(u => `「${nameOf(S, u)}」`).join(", ")} → ${owner.name}'s damage pile`);
  log(`「${nm}」 is discarded${d.why ? ` (${d.why})` : ""}`);
  return true;
}
/** Bind X: from the printed skill or a skill gained ("Bind +1"). */
function bindOf(S, o, pile) {
  const c = cardOf(S, pileTop(pile));
  let n = c ? Math.abs(modNum(c.sk.Bind) || 0) : 0;
  for (const t of condSkills(S, o, pile).concat(abilitySkills(S, o, pile))) { const m = t.match(/^Bind \+?(\d+)$/); if (m) n = Math.max(n, +m[1]); }
  return n;
}
const KEEP_RE = /(このキャラクター|このカード(?:をセットされている[^が]*)?|≪このキャラクター≫)が(?:[^、。]*?)(?:捨て札(?:され|にな)る|除去される)場合、([^。]*?)場に残す/;
/** Ways to keep a character that would be discarded: [{k, label, n?, uid?, text?, cost?}]. */
function saveOptions(S, o, pid, d) {
  const pile = o.piles[pid], out = [];
  const b = bindOf(S, o, pile);
  if (b && pile.power.length >= b) out.push({ k: "bind", n: b, label: `Bind ${b} (put ${b} power card${b === 1 ? "" : "s"} into the damage pile)` });
  for (const u of [...pile.stack, ...pile.perm]) {
    const c = cardOf(S, u);
    if (!c) continue;
    for (const line of (c.text || "").split("\n")) {
      if (/^[0-9XＸ０-９]+[:：]/.test(line) || /目標/.test(line)) continue;   // an effect (used by hand) / for another character
      const m = line.match(KEEP_RE);
      if (!m) continue;
      if (/バトル以外/.test(line) && d.battle) continue;
      if (/バトルの結果|アタックを受けて/.test(line) && !d.battle) continue;
      if (/耐久力にダメージを受けて/.test(line) && !d.damage) continue;
      const how = m[2], cost = keepCost(S, o, pile, u, how);
      if (!cost) continue;
      out.push({ k: "keep", uid: u, text: line, cost, label: `「${c.jp}」: ${cost.label}` });
    }
  }
  return out;
}
/** What a "…することで場に残す" costs, when the table can pay it: {kind, n, label} (kind "hand" = paid by hand). */
function keepCost(S, o, pile, u, how) {
  const n = +((halfNum(how).match(/([0-9]+)枚/) || [])[1] || 1);
  if (/パワーカード[0-9]*枚?を(?:あなたの|オーナーの)?ダメージ置き場/.test(how)) return pile.power.length >= n ? { kind: "power-damage", n, label: `${n} power card${n === 1 ? "" : "s"} → damage pile` } : null;
  if (/パワーカード[0-9]*枚?を捨て札/.test(how)) return pile.power.length >= n ? { kind: "power-discard", n, label: `discard ${n} power card${n === 1 ? "" : "s"}` } : null;
  if (/パーマネントカード全て/.test(how)) return pile.perm.length ? { kind: "perm-all-damage", label: "all its permanent cards → damage pile" } : null;
  if (/パーマネントカード1枚を捨て札/.test(how)) return pile.perm.length ? { kind: "perm-discard", n: 1, label: "discard 1 permanent card" } : null;
  if (/このカードをオーナーの手札に戻/.test(how)) return pile.stack.length > 1 || pile.perm.includes(u) ? { kind: "self-hand", label: "this card returns to the hand" } : null;
  if (/このカードを捨て札/.test(how)) return pile.stack.length > 1 || pile.perm.includes(u) ? { kind: "self-discard", label: "discard this card" } : null;
  return { kind: "hand", label: "pay the cost written on the card (by hand)" };
}
function payKeep(S, o, pile, opt, log) {
  const c = opt.cost, nm = nameOf(S, pileTop(pile));
  const outOf = u => { pile.stack = pile.stack.filter(x => x !== u); pile.perm = pile.perm.filter(x => x !== u); };
  if (opt.k === "bind") { for (let i = 0; i < opt.n; i++) o.damage.push(pile.power.pop()); log(`「${nm}」: Bind ${opt.n} — ${opt.n} power card${opt.n === 1 ? "" : "s"} → ${o.name}'s damage pile`); return; }
  if (c.kind === "power-damage") for (let i = 0; i < c.n; i++) o.damage.push(pile.power.pop());
  else if (c.kind === "power-discard") for (let i = 0; i < c.n; i++) o.discard.push(pile.power.pop());
  else if (c.kind === "perm-all-damage") { pile.perm.forEach(u => S.players[seatOf(u)].damage.push(u)); pile.perm = []; }
  else if (c.kind === "perm-discard") { const u = pile.perm.pop(); S.players[seatOf(u)].discard.push(u); }
  else if (c.kind === "self-hand") { outOf(opt.uid); S.players[seatOf(opt.uid)].hand.push(opt.uid); }
  else if (c.kind === "self-discard") { outOf(opt.uid); S.players[seatOf(opt.uid)].discard.push(opt.uid); }
  log(`「${nm}」 uses 「${nameOf(S, opt.uid)}」: ${c.label}${c.kind === "hand" ? " — ✋ pay it by hand" : ""}`, opt.uid);
}
/** Defense ≤ 0 → defeated at once (checked after every event). */
function checkDefense(S, log) {
  if (S.stage !== "play") return;
  for (const o of S.players) for (const pid of [...o.porder]) {
    const pile = o.piles[pid];
    if (!pile || pile.dying || pile.area === "pf" || pile.zeroSafe) continue;
    const c = cardOf(S, pileTop(pile));
    if (!c || (c.t !== "Character" && c.t !== "Break") || numOf(c.st.de) == null) continue;
    const de = statsOf(S, o, pile).de;
    if (de == null || de > 0) continue;
    let lasting = true;
    STAT_NOBATTLE = true;
    try { const d2 = statsOf(S, o, pile).de; lasting = d2 != null && d2 <= 0; } finally { STAT_NOBATTLE = false; }
    defeatPile(S, o, pid, { why: `defense ${de}${lasting ? "" : " in this battle"}`, battle: !lasting, lasting }, log);
    const sv = (S.saves || []).find(x => x.seat === o.seat && x.pid === pid);
    if (sv && lasting) log(`Its defense stays ${de} after this — even if it is kept, it will be defeated anyway`);
  }
}
/** Damage a character deals: its attack as normal or mental damage. */
const damageOf = (S, owner, pile) => { const a = attackOf(S, owner, pile); return a.mental ? { normal: 0, mental: a.n } : { normal: a.n, mental: 0 }; };
/** A battle between two characters: simultaneous, or Initiative first (if that defeats the other, it takes no damage back). */
function battle(S, A, apid, G, gpid, log) {
  const ap = A.piles[apid], gp = G.piles[gpid], ac = cardOf(S, pileTop(ap)), gc = cardOf(S, pileTop(gp));
  const dA = { ...damageOf(S, A, ap), battle: true, from: ac, fromPile: ap }, dG = { ...damageOf(S, G, gp), battle: true, from: gc, fromPile: gp };
  const iA = pileHasSkill(ac, ap, "Initiative", S, A), iG = pileHasSkill(gc, gp, "Initiative", S, G);
  log(`Battle: 「${ac.jp}」 vs 「${gc.jp}」${iA !== iG ? ` — Initiative: 「${(iA ? ac : gc).jp}」 strikes first` : ""}`);
  if (iA && !iG) { if (!damageCharacter(S, G, gpid, dA, log)) damageCharacter(S, A, apid, dG, log); return; }
  if (iG && !iA) { if (!damageCharacter(S, A, apid, dG, log)) damageCharacter(S, G, gpid, dA, log); return; }
  damageCharacter(S, G, gpid, dA, log); damageCharacter(S, A, apid, dG, log);
}

/* ---------- faction check (Faction phase): ▼ Aggressive active characters attack their owner ---------- */
const isAggressive = c => !!c && c.skills.includes("Aggressive ▼");
/** Attack value of a card: {n, mental} — "(2)" is a mental attack. */
const attackOf = (S, owner, pile) => { const st = statsOf(S, owner, pile); return { n: st.at || 0, mental: st.mental, de: st.de || 0 }; };
/* Faction check order (rulebook p.40): E.G.O. → Arayashiki → WIZ-DOM → Darklore → Polestar Empire → Eraser.
   Each faction is looked at when the check reaches it, so a character that arrives later (e.g. from damage)
   attacks if its faction is still ahead in the order, and is skipped if its faction was already checked. */
const FACTION_ORDER = FACTS.concat([NO_FACTION]);
/** The attacking ▼ character of one faction slot right now (its top active character), or null. */
function slotAttacker(S, p, slot) {
  const list = slotPiles(p, slot), pid = list[list.length - 1];
  return pid && isAggressive(cardOf(S, pileTop(p.piles[pid]))) ? pid : null;
}
/** Continue the check from faction index `from`: the next faction with a ▼ attacker attacks, else the check ends. */
function checkFrom(S, p, from, log) {
  for (let i = from; i < FACTION_ORDER.length; i++) {
    const pid = slotAttacker(S, p, FACTION_ORDER[i]);
    if (!pid) continue;
    S.fc = { at: i, pid, step: "guard", guard: null, passed: [], n: ((S.fc && S.fc.n) || 0) + 1 };
    announceAttack(S, p, log);
    return;
  }
  log(S.fc ? "Faction check finished" : "Faction check: no ▼ characters attack");
  S.fc = null;
}
function startFactionCheck(S, p, log) { S.fc = null; checkFrom(S, p, 0, log); }
function announceAttack(S, p, log) {
  const pile = p.piles[S.fc.pid];
  if (!pile) return;
  const c = cardOf(S, pileTop(pile)), a = attackOf(S, p, pile);
  log(`Faction check · ${FACTION_ORDER[S.fc.at]}: ▼ 「${c.jp}」 attacks ${p.name} (attack ${a.mental ? "(" + a.n + ")" : a.n}) — Guard phase`, pileTop(pile));
  queueTriggers(S, "attack", [{ o: p, pid: S.fc.pid }], log);
}
/** After an attack: go on with the factions after this one (characters set meanwhile count only if their faction is still ahead). */
function nextAttack(S, p, log) { const fc = S.fc; checkFrom(S, p, fc.at + 1, log); }
/* ==========================================================================
   Attack / guard costs: base 1 power card + every source in COST_SOURCES.
   A source returns [{label, n}] (n = cards added, negative = cheaper) for one character.
   ctx.boost = the attacker's chosen Boost (the guard must pay the same extra).
   ========================================================================== */
const hasSkill = (c, name) => !!c && c.skills.some(t => t === name || t.startsWith(name + " "));
/** Highest Boost this character may use (Boost X / ∞ = as many power cards as it has). */
function boostMax(c, power) {
  const v = c && c.sk.Boost;
  if (!v) return 0;
  const n = numOf(v);
  return n == null ? Math.max(0, power - 1) : Math.min(n, Math.max(0, power - 1));
}
const COST_SOURCES = [
  // Intercept: guarding costs 1 less
  (S, kind, owner, pile) => (kind === "guard" && pileHasSkill(cardOf(S, pileTop(pile)), pile, "Intercept", S, owner) ? [{ label: "Intercept", n: -1 }] : []),
  // Boost: the attacker pays up to X extra; the guard must pay the same extra
  (S, kind, owner, pile, ctx) => (ctx.boost ? [{ label: `Boost +${ctx.boost}`, n: ctx.boost }] : []),
  // Field effects that change attack / guard costs (Field effect → cost change)
  (S, kind, owner, pile) => (S.costMods || []).filter(m => (m.kind === kind || m.kind === "both") && targetMatch(m, S, owner, pile))
    .map(m => ({ label: `Field: ${m.label}`, n: m.n })),
];
/** Cost to attack or guard with a character: {n, parts}. */
function battleCost(S, kind, owner, pile, ctx = {}) {
  const parts = [];
  for (const src of COST_SOURCES) for (const x of src(S, kind, owner, pile, ctx)) if (x && x.n) parts.push(x);
  return { n: Math.max(0, 1 + parts.reduce((a, x) => a + x.n, 0)), parts };
}
const costTxt = c => (c.parts.length ? ` — 1 ${c.parts.map(x => `${x.n > 0 ? "+" : "−"}${Math.abs(x.n)} ${x.label}`).join(" ")}` : "");
/** The attack the opponent's guard answers: a main-phase attack (with its Boost) or a faction-phase ▼ attack (no Boost). */
const pendingBoost = S => (S.ma ? S.ma.boost : S.lastAttack && S.lastAttack.boost) || 0;
/* ---------- main-phase attack: Attack → the opponent's Guard phase → Fast cards / effects → Resolve ----------
   S.ma = {seat (attacker), pid, boost, step: "guard" | "resolve", guard (defender's pid)} */
const maDefender = (S, seat = S.ma && S.ma.seat) => seat != null && !S.solo && S.players[1 - seat] ? S.players[1 - seat] : null;
/** Offensive / Defensive: the cost just paid goes back to the hand. */
function costBack(S, p, from, log, why) {
  const cards = p.paid.splice(from);
  p.hand.push(...cards); p.hidden = p.hidden.filter(u => !cards.includes(u));
  if (cards.length) log(`${why}: the cost (${cards.length} card${cards.length === 1 ? "" : "s"}) returns to ${p.name}'s hand`);
}
/* ==========================================================================
   Battle System (rulebook ch.6): one sequence for faction-check attacks (S.fc) and main-phase attacks (S.ma).
     Attack declared  → triggers "attack"
     Guard phase      → guard / no guard; triggers "guard" (when guard is declared)
     Response phase   → every player may use Fast / Project cards and effects; each player Passes.
                        Any action by a player cancels the passes (everyone gets to answer it).
     Battle start     → triggers "battleStart" (before battle)
     Battle           → damage (abilities "during battle" count while the characters are in battle)
     Battle end       → triggers "battleEnd" (after battle)
   Triggered abilities wait in S.trig until their owner runs or skips them (06ea-abilities.js); the
   sequence goes on by itself when none are left.
   ========================================================================== */
/** The attack being resolved: {rec, kind, A (attacker's owner), apid, D (defending player | null), G (guard owner), gpid, tpid (own active target)} */
function curAttack(S) {
  if (S.ma) { const A = S.players[S.ma.seat], D = maDefender(S); return { rec: S.ma, kind: "ma", A, apid: S.ma.pid, D, G: D, gpid: S.ma.guard, tpid: S.ma.target }; }
  if (S.fc && S.phase === 1) { const A = S.players[S.turn]; return { rec: S.fc, kind: "fc", A, apid: S.fc.pid, D: A, G: A, gpid: S.fc.guard, tpid: null }; }
  return null;
}
/** Seats that have to pass in the Response phase. */
/** Who has to agree before a Resolve / battle step goes on: Solo → you; online → both players while either has Hold ON,
    otherwise the turn player alone. */
const respSeats = S => (S.solo ? [0] : S.players.some(p => p.hold !== false) ? S.players.map(p => p.seat) : [S.turn]);
/** Guard decided (or no guard) → Response phase. */
function enterResponse(S, log) {
  const at = curAttack(S);
  if (!at) return;
  at.rec.step = "response"; at.rec.passed = [];
  if (at.gpid && at.G && at.G.piles[at.gpid]) queueTriggers(S, "guard", [{ o: at.G, pid: at.gpid }, { o: at.A, pid: at.apid }], log);
  log("Response phase — Fast / Project cards and effects, then each player passes");
}
/** Everyone passed and no trigger waits → Battle start. */
function maybeBattle(S, log) {
  const at = curAttack(S);
  if (!at || (S.trig && S.trig.length)) return;
  if (at.rec.step === "response" && respSeats(S).every(x => at.rec.passed.includes(x))) {
    at.rec.step = "start";
    const fights = battlePairs(S, at);
    if (fights.length) queueTriggers(S, "battleStart", fights, log);
  }
  if (S.trig && S.trig.length) return;
  if (at.rec.step === "start") doBattle(S, at, log);
  if (S.trig && S.trig.length) return;
  if (at.rec.step === "end") finishAttack(S, at, log);
}
/** The characters that battle: attacker + guard (or + the own active character attacked). */
function battlePairs(S, at) {
  const out = [], ap = at.A.piles[at.apid];
  if (!ap) return out;
  if (at.tpid && at.A.piles[at.tpid]) return [{ o: at.A, pid: at.apid }, { o: at.A, pid: at.tpid }];
  if (at.gpid && at.G && at.G.piles[at.gpid]) return [{ o: at.A, pid: at.apid }, { o: at.G, pid: at.gpid }];
  return out;
}
function doBattle(S, at, log) {
  const ap = at.A.piles[at.apid];
  at.rec.step = "end";
  if (!ap) { log("The attacker is gone — the attack ends"); return; }
  const ac = cardOf(S, pileTop(ap)), a = attackOf(S, at.A, ap), pairs = battlePairs(S, at);
  if (pairs.length) {
    at.rec.inBattle = true;
    battle(S, at.A, at.apid, pairs[1].o, pairs[1].pid, log);
    at.rec.inBattle = false;
    const left = pairs.filter(x => x.o.piles[x.pid]);
    if (left.length) queueTriggers(S, "battleEnd", left, log);
  } else if (at.tpid) log("The target is gone — the attack ends");
  else if (at.kind === "ma" && !at.D) log(`Solo test: 「${ac.jp}」 would deal ${a.n} ${a.mental ? "mental " : ""}damage to the opponent`);
  else if (a.n) takeDamage(S, at.D, a.n, false, `bt${S.log.length}`, log);
  else log(`「${ac.jp}」 deals no damage`);
}
function finishAttack(S, at, log) {
  expireMods(S, "battle");
  if (at.kind === "ma") { S.ma = null; log("The attack is over"); }
  else nextAttack(S, at.A, log);
}
/** An action during the Response phase: everyone may answer it, so the passes start again. */
function responseAction(S) { const at = curAttack(S); if (at && at.rec.step === "response") at.rec.passed = []; }
/** Who may guard right now: {seat, cost(pile)} or null. */
function guardOpen(S) {
  if (S.fc && S.fc.step === "guard" && S.phase === 1) return { seat: S.turn, kind: "fc" };
  if (S.ma && S.ma.step === "guard" && maDefender(S)) return { seat: maDefender(S).seat, kind: "ma" };
  return null;
}

const statTxt = m => [["se", "Mental"], ["at", "Attack"], ["de", "Defense"]].filter(([k]) => m[k]).map(([k, l]) => `${l} ${m[k] > 0 ? "+" : ""}${m[k]}`).join(", ");
/** Cast prevention (field effect): this player may not declare a card with this name now. */
const castBanned = (S, p, c) => !!c && (S.castBans || []).some(b => b.name === c.jp && b.seats.includes(p.seat));
/** Remove stat changes that last "until end of turn" / "until end of main phase" / "until end of battle". */
function expireMods(S, until) {
  if (until === "battle") for (const p of S.players) for (const pid of p.porder) delete p.piles[pid].zeroSafe;   // saved from a "this battle" 0 defense: checked again from now on
  if (S.castBans) S.castBans = S.castBans.filter(b => b.until !== until && !(until === "turn" && b.until === "main"));
  for (const p of S.players) for (const pid of p.porder) { const pile = p.piles[pid]; if (pile.mods) pile.mods = pile.mods.filter(m => m.until !== until); }
  if (S.fieldMods) S.fieldMods = S.fieldMods.filter(f => f.until !== until);
  if (S.costMods) S.costMods = S.costMods.filter(f => f.until !== until);
}
function startPlay(S) {
  S.stage = "play"; S.turn = S.first; S.phase = 0; S.turnNo = 1;
}

/** Put a played card where it goes (Break on a character, Permanent on a character, Project / Fast in use, Character in the Active area). */
function placeCard(S, p, c, e, costTxt, by, log) {
  const to = e.to || {};
      if (to.break) {
        const f = findPile(S, to.break);
        if (!f || !canBreak(S, c, f.p, to.break, p.seat, to.force)) return;
        const exc = to.force && !canBreak(S, c, f.p, to.break, p.seat) ? " — icon exception (confirmed by the player)" : "";
        takeOut(S, e.uid);
        const target = pileTop(f.pile), tname = nameOf(S, target);
        if (f.p === p) {
          f.pile.stack.push(e.uid);
          const moved = f.pile.area === "faction", toFront = !moved && f.pile.row === "back";
          f.pile.area = "dominion"; f.pile.slot = ""; f.pile.row = "front";   // a broken character always goes to the Control area (Front)
          if (moved || toFront) { p.porder.splice(p.porder.indexOf(to.break), 1); p.porder.push(to.break); }
          log(`${by} broke 「${tname}」 with 「${c.jp}」${costTxt}${exc}${moved ? " — it moves to the control area (Front)" : toFront ? " — it moves to the control area (Front)" : ""}`, e.uid);
          queueTriggers(S, "enter", [{ o: p, pid: to.break }], log, e.uid);
        } else {
          dropPile(S, f.p, to.break);
          newPile(p, e.id, "dominion", e.uid);
          log(`${by} broke ${f.p.name}'s 「${tname}」 with 「${c.jp}」${costTxt}${exc} — 「${tname}」 is discarded`, e.uid);
          queueTriggers(S, "enter", [{ o: p, pid: e.id }], log, e.uid);
        }
      } else if (to.perm) {
        const f = findPile(S, to.perm);
        if (!f || f.p !== p) return;
        takeOut(S, e.uid); f.pile.perm.push(e.uid);
        log(`${by} set 「${c.jp}」 on 「${nameOf(S, pileTop(f.pile))}」${costTxt}`, e.uid);
        queueTriggers(S, "enter", [{ o: p, pid: to.perm }], log, e.uid);
      } else if (to.pf) {
        takeOut(S, e.uid); newPile(p, e.id, "pf", e.uid);
        log(`${by} used 「${c.jp}」${costTxt}`, e.uid);
      } else {   // character → active area slot of its faction
        takeOut(S, e.uid);
        const slot = c && FACTS.includes(c.f) ? c.f : NO_FACTION;
        newPile(p, e.id, "faction", e.uid, slot);
        log(`${by} set 「${c ? c.jp : "a card"}」 in the active area (${slot})${costTxt}`, e.uid);
        queueTriggers(S, "enter", [{ o: p, pid: e.id }], log, e.uid);
      }
}
/* ==========================================================================
   Resolve Box — declarations and responses (rulebook "レスポンス"):
   Break / Fast / Project cards and effects are declared (cost paid, card put aside) onto S.chain.
   Every player may respond with Fast cards or effects (they go on top). When every player has passed
   with nothing new, the chain resolves from the last declaration back (A → B → C resolves C → B → A).
   A declaration whose target is gone is cancelled: the cost stays paid and the card is discarded.
   ========================================================================== */
const CHAIN_TYPES = new Set(["Break", "Fast", "Project"]);
const COST_STEP_TYPES = new Set(["cost-to-hand", "cost-as-power", "cost-to-deck", "cost-to-damage"]);   // effect steps that say where the cost goes
function chainPush(S, item, msg, log, uid) {
  S.chain = S.chain || [];
  S.chain.push(item);
  S.chainPassed = [];
  log(`${msg} — waiting for responses`, uid);
}
function resolveChain(S, log) {
  // One at a time: only the latest declaration resolves; then everyone may respond again before the next one.
  const it = S.chain.pop(), p = S.players[it.seat];
  try { resolveItem(S, p, it, log); } catch (err) { log("Could not resolve — do it by hand"); }
  if (S.chain.length) log(`${S.chain.length} more waiting in the Resolve box — respond or pass again`);
  S.chainPassed = [];
  responseAction(S);   // a battle's Response phase starts again (everyone may answer what just happened)
}
function resolveItem(S, p, it, log) {
  if (it.kind === "effect") {
    const f = findPile(S, it.pid), src = cardOf(S, it.src), ef = src && allEffects(src)[it.i];
    if (!f || !ef) { log(`「${src ? src.jp : "?"}」 effect ${it.i + 1}: the character is gone — cancelled`); return; }
    log(`Resolve: 「${src.jp}」 effect ${it.i + 1}`, it.src);
    runEffect({ S, p, pid: it.pid, pile: f.pile, src, tgt: it.tgt, x: ef.xdef ? xValue(S, p, f.pile, ef.xdef, it.cost, src) : it.cost, paidNow: it.paidNow, log, e: { id: it.id } },
      it.costDone ? { steps: ef.steps.filter(st => !COST_STEP_TYPES.has(st.type)) } : ef);
    return;
  }
  const c = cardOf(S, it.uid), to = it.to || {};
  const gone = (to.break && !(findPile(S, to.break) && canBreak(S, c, findPile(S, to.break).p, to.break, p.seat, to.force))) || (to.perm && !findPile(S, to.perm));
  if (gone) { p.discard.push(it.uid); log(`「${c.jp}」: its target is gone — cancelled, the card is discarded`, it.uid); return; }
  log(`Resolve: 「${c.jp}」`, it.uid);
  placeCard(S, p, c, { id: it.id, uid: it.uid, to }, it.paid ? ` (paid ${it.paid} power)` : "", p.name, log);
  if ((c.t === "Fast" || c.t === "Project") && c.play) {   // the card's text runs now (targets were chosen when it was declared)
    const pid = Object.keys(p.piles).find(k => p.piles[k].stack.includes(it.uid));
    runEffect({ S, p, pid, pile: pid ? p.piles[pid] : null, src: c, tgt: it.tgt, x: it.x, paidNow: it.paidNow, log, e: { id: it.id } }, c.play);
  }
}
const RESPONSE_ACTIONS = new Set(["play", "effect", "damage", "mod", "areadmg", "fieldmod", "pdmg"]);
function applyEvent(S, e) {
  applyEvent0(S, e);
  if (S.stage === "play" && S.players.length) {   // Defense ≤ 0 → defeated at once
    const who = S.players.find(p => p.cid === e.cid);
    checkDefense(S, (text, uid) => S.log.push({ id: e.id, t: e.t, seat: who ? who.seat : -1, text, k: uid ? keyOf(S, uid) : null }));
  }
}
function applyEvent0(S, e) {
  const who = S.players.find(p => p.cid === e.cid);
  const by = who ? who.name : (S.spect[e.cid] || "Someone");
  const log = (text, uid) => S.log.push({ id: e.id, t: e.t, seat: who ? who.seat : -1, text, k: uid ? keyOf(S, uid) : null });
  if (e.t === "join") {
    if (who) return;
    if (S.players.length >= 2 || !e.deck || !e.deck.length) { S.spect[e.cid] = e.name; log(`${e.name} is watching`); return; }
    const seat = S.players.length;
    const p = { cid: e.cid, name: e.name || `Player ${seat + 1}`, deckName: e.deckName || "", seat, cards: {},
      deck: [], hand: [], discard: [], damage: [], removed: [], piles: {}, porder: [], ready: false, mulled: false,
      paid: [], hidden: [], down: [], sleeve: e.sleeve && typeof e.sleeve === "object" ? e.sleeve : null };
    const uids = e.deck.map((k, i) => { p.cards[`${seat}-${i}`] = k; return `${seat}-${i}`; });
    p.deck = e.order && e.order.length === uids.length ? e.order.map(i => uids[i]) : uids;
    p.hand = p.deck.splice(0, START_HAND);
    S.players.push(p);
    if (seat === 0 && e.rules && typeof e.rules === "object") S.rules = Object.assign({}, S.rules, { handUp: !!e.rules.handUp, second: !!e.rules.second });
    log(`${p.name} joined with “${p.deckName}” (${uids.length} cards) and drew ${START_HAND}`);
    if (e.solo) { S.solo = true; S.first = 0; S.stage = "mulligan"; log("Solo test: you play every turn"); }
    return;
  }
  if (e.t === "chat") { log(`${by}: ${String(e.text || "").slice(0, 300)}`); return; }
  if (e.t === "rename") {   // a player changes their name during the game
    const nm = String(e.name || "").trim().slice(0, 20);
    if (who && nm && nm !== who.name) { log(`${who.name} is now called ${nm}`); who.name = nm; }
    return;
  }
  if (!who) return;   // spectators can only chat
  const p = who, opp = S.players[1 - p.seat];
  const active = S.stage === "play" && S.turn === p.seat;
  S.last = { id: e.id, seat: p.seat };
  if (RESPONSE_ACTIONS.has(e.t)) responseAction(S);   // an answer in the Response phase: everyone may answer it again
  switch (e.t) {
    case "pick": {   // Event System: a player picks the cards a "…を手札に加える" asked for (pop-up)
      const i = (S.picks || []).findIndex(x => x.id === e.of);
      if (i < 0 || S.picks[i].seat !== p.seat) return;
      const pk = S.picks[i], owners = pk.from == null ? S.players : [S.players[pk.from]];
      const uids = [...new Set(e.uids || [])].filter(u => owners.some(o => o[pk.zone].includes(u)) && zonePickOK(S, u, pk.filter));
      if (uids.length !== pk.n) return;
      S.picks.splice(i, 1);
      for (const u of uids) { const o = S.players[seatOf(u)]; o[pk.zone].splice(o[pk.zone].indexOf(u), 1); o.hand.push(u); }
      log(`${by} picks ${uids.map(u => `「${nameOf(S, u)}」`).join(", ")} from the ${pk.zone === "damage" ? "damage pile" : "discard pile"} into the hand`);
      return;
    }
    case "save": {   // a character that would be discarded: keep it (Bind / "…場に残す") or let it go
      const i = (S.saves || []).findIndex(x => x.id === e.of);
      if (i < 0 || S.saves[i].seat !== p.seat) return;
      const sv = S.saves[i], pile = p.piles[sv.pid], opt = e.k == null ? null : sv.opts[+e.k];
      S.saves.splice(i, 1);
      if (!pile) return;
      pile.dying = false;
      if (!opt) { log(`${by} lets it go`); defeatPile(S, p, sv.pid, { battle: sv.battle, why: sv.why }, log); return; }
      payKeep(S, p, pile, opt, log);
      if (sv.lasting) { log(`「${nameOf(S, pileTop(pile))}」: its defense is still 0 — defeated anyway`); pile.dying = true; defeatPile(S, p, sv.pid, { why: sv.why }, log); return; }
      if (/defense/.test(sv.why)) pile.zeroSafe = true;   // 0 only in this battle: it stays until the battle ends
      log(`「${nameOf(S, pileTop(pile))}」 stays on the field`, pileTop(pile));
      return;
    }
    case "unban": {   // end a Cast prevention by hand
      if (!S.castBans || !S.castBans[e.i]) return;
      log(`${by}: cast prevention on 「${S.castBans[e.i].name}」 ended`); S.castBans.splice(e.i, 1);
      return;
    }
    case "hold":    // Hold ON: you want to agree before anything resolves; OFF: the turn player may resolve alone
      p.hold = !!e.on;
      log(`${by}: Hold ${p.hold ? "ON — both players agree before resolving" : "OFF"}`);
      { const at = curAttack(S);   // a step that was only waiting for this player goes on
        if (S.chain && S.chain.length && respSeats(S).every(x => (S.chainPassed || []).includes(x))) resolveChain(S, log);
        else if (at && at.rec.step === "response") maybeBattle(S, log); }
      return;
    case "rules":   // game rules, chosen before the game starts
      if (S.stage === "play") return;
      if (e.second != null && S.solo) { S.rules = Object.assign({}, S.rules, { second: !!e.second }); log(`${by}: Solo Test — you go ${S.rules.second ? "second (you draw on turn 1)" : "first (no draw on turn 1)"}`); return; }
      S.rules = Object.assign({}, S.rules, { handUp: !!e.handUp });
      log(`${by}: game rule — power cards from hand are ${S.rules.handUp ? "open (both players see them)" : "seen by their owner only (the opponent sees the back)"}`);
      return;
    case "first":
      if (S.stage !== "first" || S.players.length < 2) return;
      S.first = e.seat === 1 ? 1 : 0; S.stage = "mulligan";
      log(`${by} decided${e.random ? " by coin toss" : ""}: ${S.players[S.first].name} goes first`);
      return;
    case "keep":
    case "mull":
      if (S.stage !== "mulligan" || p.ready) return;
      if (e.t === "mull") {
        p.deck.push(...p.hand); p.hand = [];
        const set = new Set(p.deck);
        p.deck = (e.order || []).filter(u => set.delete(u)).concat([...set]);
        p.hand = p.deck.splice(0, START_HAND);
        p.mulled = (p.mulled || 0) + 1;
        log(`${by} re-shuffled the hand into the deck and drew ${START_HAND}${p.mulled > 1 ? ` (×${p.mulled})` : ""}`);
        return;   // re-shuffle as often as you like — only "Keep hand" ends the opening hand
      }
      log(`${by} keeps the hand`);
      p.ready = true;
      if (S.players.every(x => x.ready)) { startPlay(S); log(`Turn 1: ${S.players[S.turn].name} · Draw phase`); }
      return;
    case "draw": {   // Draw phase
      if (!active || S.phase !== 0) return;
      const n = drawCount(S, p), bonus = skillSum(S, p, "Draw");
      let got = 0;
      for (let i = 0; i < n && p.deck.length; i++) { p.hand.push(p.deck.shift()); got++; }
      log(skipsFirstDraw(S) ? `${by} skips the draw (first turn)`
        : `${by} drew ${got}${bonus ? ` (1 ${bonus > 0 ? "+" : "−"} Draw ${Math.abs(bonus)})` : ""}${got < n ? " — the deck is empty!" : ""}`);
      S.phase = 1;
      startFactionCheck(S, p, log);
      return;
    }
    case "next": {
      if (!active || S.phase < 1 || S.phase > 3) return;
      if (S.phase === 1 && S.fc) return;   // resolve every faction attack first
      if (S.ma) return;                    // finish the attack first
      if (S.chain && S.chain.length) return;   // resolve what was declared first
      if (S.picks && S.picks.length) return;   // picks to make first
      if (S.saves && S.saves.length) return;   // a character waits: keep it or not
      if (S.phase === 2) { expireMods(S, "main"); S.lastAttack = null; }   // "until end of main phase"
      if (S.phase === 3) dominate(S, p, log);
      S.phase++;
      log(`${by} · ${PHASES[S.phase]} phase`);
      return;
    }
    case "end": {
      if (!active || S.phase !== 4 || S.ma || (S.chain && S.chain.length) || (S.picks && S.picks.length) || (S.saves && S.saves.length)) return;
      expireMods(S, "turn"); expireMods(S, "main"); expireMods(S, "battle"); S.lastAttack = null;
      if (S.trig && S.trig.length) { log(`${S.trig.length} triggered abilit${S.trig.length === 1 ? "y was" : "ies were"} not used`); S.trig = []; }
      if (!S.solo) S.turn = 1 - S.turn;
      S.turnNo++; S.phase = 0;
      const np = S.players[S.turn];
      np.porder.forEach(pid => { np.piles[pid].rest = false; np.piles[pid].atk = 0; });
      log(`Turn ${S.turnNo}: ${np.name} · Draw phase`);
      return;
    }
    case "play": {   // a card from hand (or from the damage zone, when the card allows it)
      if (!p.hand.includes(e.uid) && !(p.damage.includes(e.uid) && usableFromDamage(cardOf(S, e.uid)))) return;
      const c = cardOf(S, e.uid), to = e.to || {};
      if (castBanned(S, p, c)) return;   // Cast prevention: a card with this name can't be declared now
      if (to.break) { const f = findPile(S, to.break); if (!f || !canBreak(S, c, f.p, to.break, p.seat, to.force)) return; }
      if (to.perm) { const f = findPile(S, to.perm); if (!f || f.p !== p) return; }
      const paid0 = p.paid.length, paid = payPower(S, p, e.pays);
      const back = paid ? costReturnFor(S, p, c, e.uid, to, e.pays) : [];   // "≪…のコスト≫は手札に戻る": the cost goes straight back to the hand
      if (back.length) costBack(S, p, paid0, log, `Cost returns to hand (${back.join(", ")})`);
      if (CHAIN_TYPES.has(c.t)) {   // Break / Fast / Project: declared now, resolved when nobody responds any more
        takeOut(S, e.uid);
        chainPush(S, { id: e.id, seat: p.seat, kind: "play", uid: e.uid, to, tgt: e.tgt || null, x: +e.x || 0, paid, paidNow: p.paid.slice(paid0) },
          `${by} declares 「${c.jp}」${paid ? ` (paid ${paid} power)` : ""}${to.break ? ` on 「${nameOf(S, pileTop(findPile(S, to.break).pile))}」` : ""}`, log, e.uid);
        return;
      }
      placeCard(S, p, c, e, paid ? ` (paid ${paid} power)` : "", by, log);
      return;
    }
    case "power": {
      const f = findPile(S, e.pid);
      if (!active || S.phase !== 3 || !f || f.p !== p || !canPower(p, e.pid)) return;
      const hand = (e.hand || []).filter(u => p.hand.includes(u));
      if (!powerFits(S, f.pile, hand.length + Math.min(e.deck || 0, p.deck.length))) return;   // power exceeds mental
      if ((e.deck || 0) > deckPowerMax(S, p) - deckPowerUsed(S, p)) return;                    // over the Charge +X limit
      hand.forEach(u => { p.hand.splice(p.hand.indexOf(u), 1); f.pile.power.push(u); p.hidden = p.hidden.filter(x => x !== u);
        p.down = (p.down || []).filter(x => x !== u); if (S.rules && S.rules.handUp === false) p.down.push(u); });   // game rule: face down → only its owner sees it
      let fromDeck = 0;
      for (let i = 0; i < (e.deck || 0) && p.deck.length; i++) { const u = p.deck.shift(); f.pile.power.push(u); p.hidden.push(u); fromDeck++; }
      if (fromDeck) p.deckPow = { turn: S.turnNo, n: deckPowerUsed(S, p) + fromDeck };
      const m = numOf(cardOf(S, pileTop(f.pile)).st.se);
      log(`${by} set ${hand.length + fromDeck} power card${hand.length + fromDeck === 1 ? "" : "s"} on 「${nameOf(S, pileTop(f.pile))}」${fromDeck ? ` (${fromDeck} from the deck)` : ""} · power ${f.pile.power.length}${m != null ? ` / mental ${m}` : ""}`);
      return;
    }
    case "pay": {   // attack / guard (cost from COST_SOURCES) or "other effect" (1 power card)
      const f = findPile(S, e.pid);
      if (!f || f.p !== p) return;
      const c = cardOf(S, pileTop(f.pile));
      let cost = { n: e.why === "effect" ? Math.max(1, Math.min(+e.n || 1, f.pile.power.length)) : 1, parts: [] }, boost = 0;   // "Other effect": pay 1 or more
      if (e.why === "attack") { boost = Math.max(0, Math.min(+e.boost || 0, boostMax(c, f.pile.power.length))); cost = battleCost(S, "attack", p, f.pile, { boost }); }
      if (e.why === "guard") cost = battleCost(S, "guard", p, f.pile, { boost: pendingBoost(S) });
      if (e.why === "attack" && (S.ma || !active || S.phase !== 2 || f.pile.area !== "dominion")) return;   // one attack at a time, Control area character, own main phase (a character may attack again as long as it can pay)
      // attack target: another player (default) or an active character in your own faction area (no guard, straight to battle)
      const tgtPile = e.why === "attack" && e.tgt ? p.piles[e.tgt] : null;
      if (e.why === "attack" && e.tgt && !(tgtPile && tgtPile.area === "faction" && isSlotTop(p, e.tgt))) return;
      if (cost.n > f.pile.power.length) return;
      const paid0 = p.paid.length;
      payFrom(S, p, e.pid, cost.n, e.uids);
      if (e.why === "attack") {
        f.pile.atk = (f.pile.atk || 0) + 1; S.lastAttack = { seat: p.seat, pid: e.pid, boost };
        const D = tgtPile ? null : maDefender(S, p.seat);
        S.ma = { seat: p.seat, pid: e.pid, boost, step: "guard", guard: null, target: tgtPile ? e.tgt : null, passed: [] };
        queueTriggers(S, "attack", [{ o: p, pid: e.pid }], log);
        if (!tgtPile && pileHasSkill(c, f.pile, "Offensive", S, p)) costBack(S, p, paid0, log, "Offensive");
      }
      log(`${by}: 「${nameOf(S, pileTop(f.pile))}」 ${{ attack: "attacks", guard: "guards", effect: "uses an effect" }[e.why] || "pays"}${e.why === "attack" && tgtPile ? ` your active character 「${nameOf(S, pileTop(tgtPile))}」` : ""} (paid ${cost.n} power${costTxt(cost)})${e.why === "attack" && S.ma.step === "guard" && maDefender(S) && !tgtPile ? ` — ${maDefender(S).name}'s Guard phase` : ""}`);
      if (e.why === "attack" && (tgtPile || !maDefender(S))) enterResponse(S, log);   // no guard possible (own active target / Solo test)
      return;
    }
    case "costto": {   // Cost window: where the paid power cards go
      if (!p.paid.length || !["discard", "hand", "damage", "deck"].includes(e.to)) return;
      const n = p.paid.length, shown = p.paid.filter(u => !isHiddenPower(p, u)).map(u => `「${nameOf(S, u)}」`);
      if (e.to === "deck") p.deck.unshift(...p.paid.reverse()); else p[e.to].push(...p.paid);
      p.hidden = p.hidden.filter(u => !p.paid.includes(u));
      p.paid = [];
      log(`${by} put the paid cost (${n} card${n === 1 ? "" : "s"}${shown.length && e.to !== "hand" ? ": " + shown.join(", ") : ""}) into the ${{ discard: "discard pile", hand: "hand", damage: "damage pile", deck: "deck (top)" }[e.to]}`);
      return;
    }
    case "order": {   // Control area: move a card left / right, or drop it before another card (and into a row)
      const f = findPile(S, e.pid);
      if (!f || f.p !== p || f.pile.area === "faction") return;
      const rowKey = x => (x.area === "pf" || x.row !== "back" ? "front" : "back");
      if (f.pile.area === "dominion" && (e.row === "front" || e.row === "back")) f.pile.row = e.row;
      const list = p.porder.filter(id => p.piles[id].area !== "faction" && rowKey(p.piles[id]) === rowKey(f.pile));
      const i = list.indexOf(e.pid);
      let target;   // pid to place in front of (null = end of the row)
      if (e.before !== undefined) target = e.before && e.before !== e.pid && list.includes(e.before) ? e.before : null;
      else { const j = i + (e.dir < 0 ? -1 : 1); if (j < 0 || j >= list.length) return; target = e.dir < 0 ? list[j] : list[j + 1] || null; }
      p.porder.splice(p.porder.indexOf(e.pid), 1);
      if (target) p.porder.splice(p.porder.indexOf(target), 0, e.pid);
      else { const last = list.filter(x => x !== e.pid).pop(); p.porder.splice(last ? p.porder.indexOf(last) + 1 : p.porder.length, 0, e.pid); }
      log(`${by} moved 「${nameOf(S, pileTop(f.pile))}」 in the control area (${rowKey(f.pile)})`);
      return;
    }
    case "mod": {   // stat change on one character (Fast / Project / effect / other)
      const f = findPile(S, e.pid);
      if (!f) return;
      const m = { label: String(e.label || "Effect").slice(0, 60), se: +e.se || 0, at: +e.at || 0, de: +e.de || 0, until: ["turn", "main", "keep"].includes(e.until) ? e.until : "turn" };
      if (!(m.se || m.at || m.de)) return;
      (f.pile.mods = f.pile.mods || []).push(m);
      log(`${by}: 「${nameOf(S, pileTop(f.pile))}」 ${statTxt(m)} (${m.label})`);
      return;
    }
    case "unmod": {
      const f = findPile(S, e.pid);
      if (!f || !f.pile.mods || !f.pile.mods[e.i]) return;
      const m = f.pile.mods.splice(e.i, 1)[0];
      log(`${by} removed ${statTxt(m)} (${m.label}) from 「${nameOf(S, pileTop(f.pile))}」`);
      return;
    }
    case "fieldmod": {   // field effect: stat change, or attack / guard cost change — for every matching character
      S.fieldMods = S.fieldMods || []; S.costMods = S.costMods || [];
      if (e.op === "remove") { const L = e.cost ? S.costMods : S.fieldMods, m = L.splice(e.i, 1)[0]; if (m) log(`${by} ended the field effect: ${m.label}`); return; }
      const icons = (Array.isArray(e.icons) ? e.icons : e.icon ? [e.icon] : []).filter(t => CLASS_LIST.includes(t));
      const f = { label: String(e.label || "Field effect").slice(0, 60),
        scope: TARGET_SCOPES.some(x => x.id === e.scope) ? e.scope : e.area ? "area" : "game",
        seat: e.seat === 0 || e.seat === 1 ? e.seat : null,
        area: TARGET_AREAS.some(a => a[0] === e.area) ? e.area : e.area === "faction" ? "active" : e.area === "dominion" ? "control" : "",
        slot: FACTS.includes(e.slot) ? e.slot : "", icons, faction: FACTS.includes(e.faction) ? e.faction : "",
        broken: ["yes", "no"].includes(e.broken) ? e.broken : "", aggressive: !!e.aggressive, name: String(e.name || "").slice(0, 30),
        powerMax: e.powerMax === "" || e.powerMax == null ? "" : +e.powerMax, mentalMax: e.mentalMax === "" || e.mentalMax == null ? "" : +e.mentalMax, battle: !!e.battle,
        se: +e.se || 0, at: +e.at || 0, de: +e.de || 0, until: ["turn", "main", "keep"].includes(e.until) ? e.until : "turn" };
      if (["attack", "guard", "both"].includes(e.kind)) {
        f.kind = e.kind; f.n = Math.trunc(+e.n || 0);
        if (!f.n) return;
        S.costMods.push(f);
        log(`${by}: field effect — ${f.label} (${targetLabel(f, S)}): ${{ attack: "attack", guard: "guard", both: "attack and guard" }[f.kind]} cost ${f.n > 0 ? "+" : ""}${f.n}`);
        return;
      }
      if (!(f.se || f.at || f.de)) return;
      S.fieldMods.push(f);
      log(`${by}: field effect — ${f.label} (${targetLabel(f, S)}): ${statTxt(f)} · ${targetsNow(f, S).length} character(s) now`);
      return;
    }
    case "effect": {   // use an effect of the top card or of a permanent on it: pay its cost from this character
      const f = findPile(S, e.pid);
      if (!f || f.p !== p || f.pile.area !== "dominion") return;
      const src = cardOf(S, e.src), ef = src && allEffects(src)[e.i];
      if (ef && ef.cond != null && !(e.src === pileTop(f.pile) && condOn(S, p, f.pile, e.src, ef.cond))) return;   // an effect from a condition that doesn't hold
      if (!ef || !(e.src === pileTop(f.pile) || f.pile.perm.includes(e.src))) return;
      const cost = ef.cost === "X" ? Math.max(0, +e.x || 0) : +ef.cost;
      if (cost > f.pile.power.length) return;
      const paid0 = p.paid.length;
      payFrom(S, p, e.pid, cost, e.uids);
      const msg = `${by}: 「${nameOf(S, pileTop(f.pile))}」 declares effect ${e.i + 1}${e.src !== pileTop(f.pile) ? ` of 「${src.jp}」` : ""} (cost ${ef.cost === "X" ? "X=" + cost : cost}): ${ef.en || ef.jp}`;
      if (e.run === false) { log(msg, e.src); return; }   // paying only (tests / by hand)
      const item = { id: e.id, seat: p.seat, kind: "effect", pid: e.pid, src: e.src, i: e.i, tgt: e.tgt || null, cost, paidNow: p.paid.slice(paid0) };
      // where the cost goes is part of the effect ("≪このエフェクトのコスト≫を手札に戻す" …): place it now, before anything resolves
      const costSteps = ef.steps.filter(st => COST_STEP_TYPES.has(st.type));
      if (costSteps.length) { runEffect({ S, p, pid: e.pid, pile: f.pile, src, tgt: item.tgt, x: cost, paidNow: item.paidNow, log, e }, { steps: costSteps }); item.costDone = true; }
      chainPush(S, item, msg, log, e.src);
      return;
    }
    case "damage": {   // damage to a character without (or outside the automatic) battle: effects, Fast / Project cards, abilities
      const f = findPile(S, e.pid);
      if (!f) return;
      const from = e.from ? (findPile(S, e.from) || {}).pile : null;
      const d = { normal: Math.max(0, Math.min(99, +e.normal || 0)), mental: Math.max(0, Math.min(99, +e.mental || 0)), battle: !!e.battle,
        from: from ? cardOf(S, pileTop(from)) : null, label: String(e.label || "Effect").slice(0, 40) };
      if (!d.normal && !d.mental) return;
      log(`${by}: ${d.label} deals ${dmgTxt(d)} to 「${nameOf(S, pileTop(f.pile))}」${d.battle ? " (battle)" : ""}`);
      damageCharacter(S, f.p, e.pid, d, log);
      return;
    }
    case "areadmg": {   // damage to every character a target spec matches (Control area, Active area, territory, whole game …)
      const d = { normal: Math.max(0, Math.min(99, +e.normal || 0)), mental: Math.max(0, Math.min(99, +e.mental || 0)), label: String(e.label || "Effect").slice(0, 40) };
      if (!d.normal && !d.mental || !e.spec) return;
      const list = targetsNow(e.spec, S);   // fixed before any damage is dealt
      log(`${by}: ${d.label} deals ${dmgTxt(d)} to ${targetLabel(e.spec, S)} (${list.length} character${list.length === 1 ? "" : "s"})`);
      for (const { o, pid } of list) if (o.piles[pid]) damageCharacter(S, o, pid, d, log);
      return;
    }
    case "cond": {   // Condition System: the player says a condition is met / not met (null = back to automatic)
      const f = findPile(S, e.pid), c = f && cardOf(S, e.uid);
      if (!f || !c || !c.conds[e.k] || !f.pile.stack.includes(e.uid)) return;
      f.pile.cond = f.pile.cond || {};
      if (e.on == null) delete f.pile.cond[e.uid + ":" + e.k]; else f.pile.cond[e.uid + ":" + e.k] = !!e.on;
      log(`${by}: 「${c.jp}」 condition “${c.conds[e.k].when.slice(0, 40)}” ${e.on == null ? "is checked automatically again" : e.on ? "is met" : "is not met"}`);
      return;
    }
    case "battle": {   // battle between two characters (main-phase attack and guard)
      const a = findPile(S, e.a), g = findPile(S, e.g);
      if (!a || !g || e.a === e.g) return;
      battle(S, a.p, e.a, g.p, e.g, log);
      return;
    }
    case "pdmg": {   // damage to a player from an attack or effect: normal + mental points, each flips the top card
      const t = S.players[e.seat === 1 ? 1 : 0];
      const n = Math.max(0, Math.min(20, (+e.normal || 0) + (+e.mental || 0)));
      if (t && n) takeDamage(S, t, n, !!e.special, e.id, log);
      return;
    }
    case "row": {   // Control area: front row (main cards) ⇄ back row
      const f = findPile(S, e.pid);
      if (!f || f.p !== p || f.pile.area !== "dominion") return;
      const to = e.row === "front" || e.row === "back" ? e.row : f.pile.row === "back" ? "front" : "back";
      if (to === f.pile.row) return;
      f.pile.row = to;
      log(`${by} moved 「${nameOf(S, pileTop(f.pile))}」 to the control area (${f.pile.row})`);
      return;
    }
    case "defeat": {
      const f = findPile(S, e.pid);
      if (!f) return;
      const nm = nameOf(S, pileTop(f.pile)), named = e.battle ? f.pile.stack.filter(u => (cardOf(S, u) || {}).t === "Break" && cardName(cardOf(S, u))) : [];
      dropPile(S, f.p, e.pid, { battle: !!e.battle });
      log(`${by}: ${f.p === p ? "" : f.p.name + "'s "}「${nm}」 ${e.battle ? "is defeated in battle" : "is defeated"} — ${named.length ? `named Break card${named.length === 1 ? "" : "s"} ${named.map(u => `「${nameOf(S, u)}」`).join(", ")} → damage pile, ` : ""}the rest → discard pile`);
      return;
    }
    case "dmg": {
      // normal damage: a Character from the deck goes to the Active area, anything else to the damage pile
      // special damage: always the damage pile
      takeDamage(S, p, Math.max(1, Math.min(10, e.n || 1)), !!e.special, e.id, log);
      return;
    }
    case "guard": {   // Guard phase: guard with a Control area character (pays 1 power card) or take the attack
      if (S.ma && S.ma.step === "guard") {   // main-phase attack: the defender answers
        const D = maDefender(S);
        if (!D || D !== p) return;
        if (e.pid) {
          const g = p.piles[e.pid], cost = g && battleCost(S, "guard", p, g, { boost: S.ma.boost });
          if (!g || g.area !== "dominion" || cost.n > g.power.length) return;
          const paid0 = p.paid.length;
          payFrom(S, p, e.pid, cost.n, e.uids);
          if (pileHasSkill(cardOf(S, pileTop(g)), g, "Defensive", S, p)) costBack(S, p, paid0, log, "Defensive");   // guarding a dominated character's attack
          S.ma.guard = e.pid;
          log(`${by} guards with 「${nameOf(S, pileTop(g))}」 (paid ${cost.n} power${costTxt(cost)})`);
        } else log(`${by} does not guard`);
        enterResponse(S, log);
        return;
      }
      const fc = S.fc;
      if (!active || S.phase !== 1 || !fc || fc.step !== "guard") return;
      if (e.pid) {
        const g = p.piles[e.pid], cost = g && battleCost(S, "guard", p, g);
        if (!g || g.area !== "dominion" || cost.n > g.power.length) return;
        payFrom(S, p, e.pid, cost.n, e.uids);
        fc.guard = e.pid;
        log(`${by} guards with 「${nameOf(S, pileTop(g))}」 (paid ${cost.n} power${costTxt(cost)})`);
      } else log(`${by} does not guard`);
      enterResponse(S, log);
      return;
    }
    case "trigger": {   // a triggered ability waiting in S.trig: its owner runs it (with a target) or skips it
      const i = (S.trig || []).findIndex(t => t.id === e.of);
      if (i < 0 || S.trig[i].seat !== p.seat) return;
      const t = S.trig.splice(i, 1)[0];
      if (e.op === "run") { responseAction(S); runAbility(S, p, t, e, log); } else log(`${by} skips 「${nameOf(S, t.uid)}」: ${abilityOf(S, t).short}`);
      maybeBattle(S, log);
      return;
    }
    case "pass":      // Resolve box: this player has nothing more to answer with
    case "resolve": { // (older name) the active player resolves: everyone passes
      if (S.players.some(o => o.paid && o.paid.length)) return;   // a paid cost waits in a Cost window: decide where it goes first
      if (S.chain && S.chain.length) {   // something is waiting to resolve: when everyone passed, resolve it (last declared first)
        if (e.t === "resolve") S.chainPassed = respSeats(S).slice();
        else if (!S.chainPassed.includes(p.seat)) { S.chainPassed.push(p.seat); log(`${by} has no response`); }
        if (respSeats(S).every(x => S.chainPassed.includes(x))) resolveChain(S, log);
        return;
      }
      const at = curAttack(S);
      if (!at || at.rec.step !== "response") return;
      if (e.t === "resolve") { if (!(S.turn === p.seat || S.solo)) return; at.rec.passed = respSeats(S).slice(); log(`${by}: resolve`); }
      else if (!at.rec.passed.includes(p.seat)) { at.rec.passed.push(p.seat); log(`${by} passes`); }
      maybeBattle(S, log);
      return;
    }
    case "discard":
      if (!p.hand.includes(e.uid)) return;
      takeOut(S, e.uid); p.discard.push(e.uid);
      log(`${by} discarded 「${nameOf(S, e.uid)}」`, e.uid);
      return;
    case "zone": {   // effects: move a card between deck / hand / discard / damage / removed
      if (seatOf(e.uid) !== p.seat || !LIST_ZONES.concat("deckb").includes(e.to)) return;
      const from = takeOut(S, e.uid);
      if (!from) return;
      if (e.to === "deck") p.deck.unshift(e.uid); else if (e.to === "deckb") p.deck.push(e.uid); else p[e.to].push(e.uid);
      const hidden = ["hand", "deck"].includes(from) && ["hand", "deck", "deckb"].includes(e.to);
      log(`${by} moved ${hidden ? "a card" : `「${nameOf(S, e.uid)}」`} from the ${ZONE_LABEL[from] || "table"} to the ${ZONE_LABEL[e.to]}`, hidden ? null : e.uid);
      return;
    }
    case "shuffle": {
      const set = new Set(p.deck);
      p.deck = (e.order || []).filter(u => set.delete(u)).concat([...set]);
      log(`${by} shuffled the deck`);
      return;
    }
    case "pview": {   // field effect: power cards face up, only when both players agree
      const pv = S.pview;
      if (S.solo && e.op === "ask") { S.pview = { state: "on", by: p.seat }; log(`${by}: power cards are face up (field effect)`); }
      else if (e.op === "ask" && pv.state === "off") { S.pview = { state: "asked", by: p.seat }; log(`${by} asks to make power cards visible (field effect)`); }
      else if (e.op === "ok" && pv.state === "asked" && pv.by !== p.seat) { S.pview = { state: "on", by: pv.by }; log(`${by} agreed: power cards are visible to both players`); }
      else if (e.op === "end" && pv.state !== "off") { S.pview = { state: "off", by: -1 }; log(`${by}: power cards are hidden again`); }
      return;
    }
  }
}

const UNDOABLE = new Set(["save", "unban", "pick", "hold", "trigger", "pass", "areadmg", "cond", "draw", "next", "end", "play", "power", "pay", "costto", "order", "row", "guard", "resolve", "mod", "unmod", "fieldmod", "effect", "damage", "battle", "pdmg", "defeat", "dmg", "discard", "zone", "shuffle"]);
/** Replay the log, skipping undone events. */
function replay() {
  // undo = skip that action; redo = cancel an undo (in log order)
  const undone = new Set(), activeUndo = new Set();
  const byId = new Map(PLAY.events.map(e => [e.id, e]));
  for (const e of PLAY.events) {
    if (e.t === "undo") { const t = byId.get(e.of); if (t && t.cid === e.cid && UNDOABLE.has(t.t) && !undone.has(e.of)) { undone.add(e.of); activeUndo.add(e.id); } }
    else if (e.t === "redo") { const u = byId.get(e.of); if (u && u.cid === e.cid && activeUndo.has(e.of)) { activeUndo.delete(e.of); undone.delete(u.of); } }
  }
  const S = newState();
  for (const e of PLAY.events) {
    if (undone.has(e.id) || e.t === "undo" || e.t === "redo") continue;
    try { applyEvent(S, e); } catch (err) { console.warn("bad event", e, err); }
  }
  S.undone = undone; S.activeUndo = activeUndo;
  return S;
}
/** Your last action, if nobody else has acted since (chat doesn't count). */
function undoTarget() {
  const S = PLAY.S;
  for (let i = PLAY.events.length - 1; i >= 0; i--) {
    const e = PLAY.events[i];
    if (e.t === "chat" || e.t === "undo" || e.t === "redo" || S.undone.has(e.id)) continue;
    return e.cid === PLAY.cid && UNDOABLE.has(e.t) ? e : null;
  }
  return null;
}
/** Your latest undo that can be redone: only while undo / redo are the last things that happened. */
function redoTarget() {
  const S = PLAY.S;
  for (let i = PLAY.events.length - 1; i >= 0; i--) {
    const e = PLAY.events[i];
    if (e.t === "chat" || S.undone.has(e.id)) continue;
    if (e.t === "redo") continue;
    if (e.t === "undo") { if (e.cid === PLAY.cid && S.activeUndo.has(e.id)) return e; continue; }
    return null;
  }
  return null;
}

