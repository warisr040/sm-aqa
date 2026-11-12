/* ==========================================================================
   Effect System.

   Every effect ("1：…") is split into sentences and each sentence gets one EFFECT TYPE from
   src/data/effect_types.json (EFFECT_RULES, put in by build.py; the first rule whose regex matches wins).
   Each type names an ACTION below. Using an effect at the table:
     1. choose a target when the effect needs one (character or player),
     2. choose the power cards that pay the cost,
     3. the "effect" event pays and runs the action of every sentence, in order.
   Types the table can't do by itself ("manual" / "note") are written to the log as a reminder,
   so the player finishes them with the usual tools (damage, stat change, deck / zone moves …).

   To support a new kind of effect: add a rule to effect_types.json, and if it can be automated,
   an entry in EFFECT_ACTIONS (and in EFFECT_TARGETED if it needs a target).
   ========================================================================== */
const EFFECT_RX = (EFFECT_RULES.rules || []).map(r => Object.assign({}, r, { rx: new RegExp(r.re) }));
const EFFECT_GROUPS = Object.fromEntries((EFFECT_RULES.groups || []).map(([id, l]) => [id, l]));
const EFFECT_TYPE = Object.fromEntries(EFFECT_RX.map(r => [r.id, r]));
const halfNum = t => String(t || "").replace(/[０-９ＸＮ＋－−]/g, ch => ({ "Ｘ": "X", "Ｎ": "N", "＋": "+", "－": "-", "−": "-" }[ch] || String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)));
const effectSentences = t => String(t || "").split(/(?<=。)/).map(x => x.trim()).filter(Boolean);
/** Effect text → {steps: [{type, text, target}], type (main type), auto (true when every step is automated)}. */
function classifyEffect(jp) {
  const steps = effectSentences(jp).map(text => {
    const r = EFFECT_RX.find(x => x.rx.test(text)) || EFFECT_TYPE.other;
    const m = text.match(/≪([^≫]+)≫/);
    return { type: r.id, text, target: m ? parseTarget(m[1]) : null, aim: /目標/.test(text) };
  });
  const main = steps.find(s => !["xdef", "timing", "note", "declare"].includes(s.type)) || steps[0] || { type: "other" };
  return { steps, type: main.type, auto: steps.every(s => EFFECT_TYPE[s.type] && !["manual"].includes(EFFECT_TYPE[s.type].action)) };
}
for (const c of CARDS) for (const ef of c.effects) Object.assign(ef, classifyEffect(ef.jp));
const effectTypeLabel = id => (EFFECT_TYPE[id] || EFFECT_TYPE.other || { label: id }).label;
const effectChipHTML = ef => `<span class="efty g-${esc((EFFECT_TYPE[ef.type] || {}).group || "other")}" title="${esc(ef.steps.map(s => effectTypeLabel(s.type)).join(" → "))}">${esc(effectTypeLabel(ef.type))}${ef.auto ? "" : " ✋"}</span>`;

/* ---------- reading values out of a sentence ---------- */
/** "+1/+(2)/-1" → {se, at, de, mentalAtk}; "攻撃力に+2" → {at: 2}; X → x. */
function effectStat(text, x) {
  const t = halfNum(text), v = s => (/X/.test(s) ? (/-/.test(s) ? -x : x) : (+String(s).replace(/[±()+]/g, "") || 0));
  const tri = t.match(/([±+\-]\(?[0-9X]+\)?)[/／]([±+\-]\(?[0-9X]+\)?)(?:・[±+\-]?\(?[0-9X]+\)?)?[/／]([±+\-]\(?[0-9X]+\)?)/);
  if (tri) return { se: v(tri[1]), at: v(tri[2]), de: v(tri[3]) };
  const out = {};
  for (const [jp, k] of [["精神力", "se"], ["攻撃力", "at"], ["耐久力", "de"]]) {
    const m = t.match(new RegExp(jp + "(?:に|を)、?([±+\\-]\\(?[0-9X]+\\)?)"));
    if (m) out[k] = v(m[1]);
  }
  return out;
}
const effectUntil = text => (/バトル終了時まで/.test(text) ? "battle" : /メインフェイズ終了時まで/.test(text) ? "main" : /ターン終了時まで|フェイズ終了時まで/.test(text) ? "turn" : "keep");
const effectN = (text, x) => { const m = halfNum(text).match(/\(?([0-9X]+)\)?(?:ダメージ|ドロー|枚)/); return m ? (m[1] === "X" ? x : +m[1]) : 1; };
const SKILL_JP = { "イニシアチブ": "Initiative", "シールド": "Shield", "インターセプト": "Intercept", "ペネトレイト": "Penetrate", "ステルス": "Stealth",
  "ブレイクスルー": "Breakthrough", "オフェンシブ": "Offensive", "ディフェンシブ": "Defensive", "インフィニティ": "Infinity", "シンクロ": "Synchro", "デュアル": "Dual" };
const effectGrants = text => Object.keys(SKILL_JP).filter(j => text.includes(j) && /(を得|を与え)/.test(text)).map(j => SKILL_JP[j]);
/** Does a character have a skill, counting skills given by effects (pile.mods[].grant)? */
const pileHasSkill = (c, pile, name, S, owner) => hasSkill(c, name) || !!(pile && (pile.mods || []).some(m => (m.grant || []).includes(name)))
  || (S && owner ? condSkills(S, owner, pile).concat(abilitySkills(S, owner, pile)).some(t => t === name || t.startsWith(name + " ")) : false);   // skills from conditions (06e-conditions.js)

/* ---------- targets ---------- */
const EFFECT_TARGETED = new Set(["statset", "stat", "damage", "discard", "bounce", "todeck", "cancelbattle", "powersteal", "powerdiscard", "makeactive", "costpower", "grant", "mark", "pdmg", "draw", "powerdeck"]);
/** What a step aims at: "self" | "char" | "player" | "all" | "cost" | "none". */
function stepAim(st) {
  const t = st.target;
  if (!t) return st.type === "pdmg" ? "player" : "none";
  if (/^この(キャラクター|カード)(?!以外)/.test(t.text)) return "self";   // "このキャラクター以外の…" is everyone else
  if (/このエフェクトのコスト/.test(t.text)) return "cost";
  if (t.what === "player_or_char" && t.count !== "all" && !/全て/.test(t.text)) return "pc";   // ≪キャラクターまたはプレイヤー1人≫: click a character, or a player's Deck
  if (t.what === "player" || st.type === "dmg-player") return /全て/.test(t.text) ? "players" : /^あなた$/.test(t.text) ? "you" : "player";
  if (/(使用した|使用宣言中|使用宣言された|使用宣言した)/.test(t.text) && /(カード)[0-9０-９]枚/.test(t.text) && !/全て/.test(t.text)) return "chain";   // a card waiting in the Resolve box
  if (/エリア1つ/.test(t.text)) return "area";
  if (/任意の勢力(パーティ)?1つ/.test(t.text)) return "faction";   // ≪あなたの任意の勢力1つのキャラクター全て≫: the player picks a faction first   // ≪…任意のエリア1つのキャラクター全て…≫: the player picks one area first
  if (t.what === "power" && !/全て|ずつ/.test(t.text)) return "powercard";   // ≪パワーカード1枚≫: the player picks the power card itself
  if (t.count === "all") return "all";
  if (["character", "player_or_char", "other", "card"].includes(t.what)) return "char";
  return "none";
}
/** The step that needs the player to choose a target (first targeted step aiming at one character / player). */
function effectPick(ef) {
  const st = ef.steps.find(s => EFFECT_TARGETED.has((EFFECT_TYPE[s.type] || {}).action) && ["char", "pc", "player", "powercard", "area", "faction", "chain"].includes(stepAim(s)));
  if (!st) return null;
  const n = st.target && (halfNum(st.target.text).match(/パワーカード([0-9]+)枚/) || [])[1];
  // "あなたの任意の…" = "…of your choice", not "your …": read whose from the rest of the text
  const tt = st.target ? st.target.text : "", whose = /^あなたの任意の/.test(tt) ? parseTarget(tt.replace(/^あなたの任意の/, "")).whose : st.target ? st.target.whose : "";
  return { aim: stepAim(st), step: st, whose, n: n ? +n : 1 };
}
/** Can this character be the chosen target? (loose check: whose side; the player decides the rest) */
function effectTargetOK(S, me, owner, pid, pick) {
  const pile = owner.piles[pid], c = pile && cardOf(S, pileTop(pile));
  if (!c || (c.t !== "Character" && c.t !== "Break") || pile.area === "pf") return false;
  if ((pick.whose === "opp" || pick.whose === "notyou") && !(owner.seat !== me || S.solo)) return false;
  if (pick.whose === "yours" && owner.seat !== me) return false;
  return !pick.step || !pick.step.target || targetTextOK(S, owner, pid, pick.step.target);
}
/** The written conditions of a ≪target≫ (faction, area, class icons, ブレイクしていない, ▼を持つ …) for one character. */
function targetTextOK(S, o, pid, t) {
  const pile = o.piles[pid], c = pile && cardOf(S, pileTop(pile));
  if (!c) return false;
  if (t.factions && t.factions.length && !t.factions.includes(c.f)) return false;
  if (t.icons && t.icons.length && !t.icons.some(j => c.cls.includes(j) || c.cls.includes(j.replace("♂", "")))) return false;
  if (/支配/.test(t.text) && pile.area !== "dominion") return false;
  if (/勢力エリア|アクティブ/.test(t.text) && pile.area !== "faction") return false;
  for (const [re, ok] of TARGET_QUALIFIERS) if (re.test(t.text) && !ok(S, o, pile, c)) return false;
  return true;
}
/** A character that has a Break card set on it (or is itself a Break card) is "broken". */
const pileBroken = (S, p) => p.stack.length > 1 || (cardOf(S, pileTop(p)) || {}).t === "Break";
/** Power cards of this character can be the target (whose side, like characters; any area). */
function effectPowerOK(S, me, owner, pid, pick) {
  const pile = owner.piles[pid];
  if (!pile || !pile.power.length) return false;
  if (pick.whose === "opp" || pick.whose === "notyou") return owner.seat !== me || S.solo;
  if (pick.whose === "yours") return owner.seat === me;
  return true;
}
/** Characters an "all" step reaches: everyone's, yours or the opponents', filtered by the icons / factions in the target text. */
function effectAll(S, me, st) {
  const t0 = st.target, t = /^あなたの任意の/.test(t0.text) ? Object.assign({}, t0, { whose: parseTarget(t0.text.replace(/^あなたの任意の/, "")).whose }) : t0;   // "…of your choice" is not "your …"
  const spec = { icons: t.icons.map(j => j.replace("♂", "")).length ? t.icons : undefined };
  return targetsNow(spec, S).filter(({ o, pid }) => {
    const c = cardOf(S, pileTop(o.piles[pid]));
    if (t.whose === "opp" || t.whose === "notyou") { if (o.seat === me && !S.solo) return false; }
    else if (t.whose === "yours" && o.seat !== me) return false;
    return !!c && targetTextOK(S, o, pid, Object.assign({}, t, { icons: [] }));   // icons: already filtered by targetsNow
  });
}
/** "▼を持たない", "精神攻撃力を持つ", "ブレイクしていない" … in a target: [regex, test(S, owner, pile, card)]. Add more here. */
const TARGET_QUALIFIERS = [
  [/▼を持たない|▼を持たず/, (S, o, p, c) => !isAggressive(c)],
  [/▼を持つ/, (S, o, p, c) => isAggressive(c)],
  [/精神攻撃力を持つ/, (S, o, p, c) => /\(/.test(String(c.st.at || ""))],
  [/ブレイクしていない/, (S, o, p) => !pileBroken(S, p)],   // a Break card (or a character with one) is not a valid target
  [/(^|[^い])ブレイクしている/, (S, o, p) => pileBroken(S, p)],
  [/ネームレベルでない/, (S, o, p, c) => !cardName(c)],
  [/(^|[^で])ネームレベル(の)?キャラクター/, (S, o, p, c) => !!cardName(c)],
  [/パワーが精神力に等しい/, (S, o, p) => { const m = statsOf(S, o, p).se; return m != null && p.power.length === m; }],
  [/パワー0の/, (S, o, p) => p.power.length === 0],
];

/* ---------- actions (run inside the "effect" event, so Undo / online play work as usual) ----------
   ctx = {S, p (player using it), pid (character paying), pile, src (card with the effect), st (step), tgt ({pid} | {seat}),
          x (value of X), paidNow (power cards paid for this effect), log, e (the event)} */
const ctxTargets = ctx => {   // [{o, pid}] the step works on
  const aim = stepAim(ctx.st), S = ctx.S;
  if (aim === "self") return [{ o: ctx.p, pid: ctx.pid }];
  if (aim === "all") return effectAll(S, ctx.p.seat, ctx.st);
  if (aim === "faction") {   // every character the target names, of the chosen faction (faction party: in the Active area only)
    const f = ctx.tgt && ctx.tgt.faction;
    if (!f) return [];
    const party = /勢力パーティ/.test(ctx.st.target.text);
    return effectAll(S, ctx.p.seat, ctx.st).filter(({ o, pid }) => { const c = cardOf(S, pileTop(o.piles[pid])); return c && (c.f === f || (f === NO_FACTION && !c.f)) && (!party || (o.piles[pid].area === "faction" && o.piles[pid].slot === f)); });
  }
  if (aim === "area") {   // every character in the chosen area: {seat, area: "faction" | "dominion"}
    const a = ctx.tgt && ctx.tgt.area, o = a && S.players[a.seat];
    if (!/エリア1つのキャラクター全て(≫|に)/.test(ctx.st.target.text)) return [];   // more conditions (e.g. "▼を持つ…") → by hand
    return o ? o.porder.filter(pid => o.piles[pid].area === a.area && cardOf(S, pileTop(o.piles[pid]))).map(pid => ({ o, pid })) : [];
  }
  if ((aim === "char" || aim === "pc") && ctx.tgt && ctx.tgt.pid) {
    const f = findPile(S, ctx.tgt.pid);
    if (!f) return [];
    if (ctx.st.target && !targetTextOK(S, f.p, ctx.tgt.pid, ctx.st.target)) { ctx.log(`${pname(S, f.p, ctx.tgt.pid)} is no longer a valid target (≪${ctx.st.target.text}≫) — no effect`); return []; }
    return [{ o: f.p, pid: ctx.tgt.pid }];
  }
  if (aim === "none" && !ctx.st.target) return [{ o: ctx.p, pid: ctx.pid }];
  return [];
};
const ctxPlayers = ctx => {
  const aim = stepAim(ctx.st), S = ctx.S;
  if (aim === "you" || aim === "self" || aim === "none") return [ctx.p];
  if (aim === "players") return S.players.filter(o => o.seat !== ctx.p.seat || S.solo);
  if (ctx.tgt && ctx.tgt.seat != null && S.players[ctx.tgt.seat]) return [S.players[ctx.tgt.seat]];
  return S.players.filter(o => o.seat !== ctx.p.seat).slice(0, 1);
};
const pname = (S, o, pid) => `「${nameOf(S, pileTop(o.piles[pid]))}」`;
function returnPileToHand(S, o, pid) {
  const pile = o.piles[pid];
  pile.stack.forEach(u => S.players[seatOf(u)].hand.push(u));
  [...pile.power, ...pile.perm].forEach(u => S.players[seatOf(u)].discard.push(u));
  delete o.piles[pid]; o.porder = o.porder.filter(x => x !== pid);
}
const EFFECT_ACTIONS = {
  costto(ctx) {   // ≪このエフェクトのコスト≫をオーナーの手札に戻す (also deck / damage pile)
    const to = EFFECT_TYPE[ctx.st.type].to || "hand", p = ctx.p, cards = ctx.paidNow.filter(u => p.paid.includes(u));
    if (!cards.length) return false;
    p.paid = p.paid.filter(u => !cards.includes(u)); p.hidden = p.hidden.filter(u => !cards.includes(u));
    if (to === "deck") p.deck.unshift(...cards.slice().reverse()); else p[to].push(...cards);
    ctx.log(`The effect's cost (${cards.length} card${cards.length === 1 ? "" : "s"}) goes to ${p.name}'s ${{ hand: "hand", deck: "deck (top)", damage: "damage pile" }[to]}`);
  },
  costpower(ctx) {   // このエフェクトのコストをパワーカードとしてセットする
    const p = ctx.p, cards = ctx.paidNow.filter(u => p.paid.includes(u)), [t] = ctxTargets(ctx).concat(stepAim(ctx.st) === "char" ? [] : [{ o: p, pid: ctx.pid }]);
    if (!cards.length || !t) return false;
    p.paid = p.paid.filter(u => !cards.includes(u));
    t.o.piles[t.pid].power.push(...cards);
    ctx.log(`The effect's cost is set as ${cards.length} power card${cards.length === 1 ? "" : "s"} on ${pname(ctx.S, t.o, t.pid)}`);
  },
  stat(ctx) {   // ±N/±N/±N, 攻撃力に+N … (and skills given in the same sentence)
    const d = effectStat(ctx.st.text, ctx.x), grant = effectGrants(ctx.st.text), ts = ctxTargets(ctx);
    if (!ts.length || !(d.se || d.at || d.de || grant.length)) return false;
    for (const { o, pid } of ts) {
      const m = { label: `「${ctx.src.jp}」`, se: d.se || 0, at: d.at || 0, de: d.de || 0, until: effectUntil(ctx.st.text), grant };
      (o.piles[pid].mods = o.piles[pid].mods || []).push(m);
      ctx.log(`${pname(ctx.S, o, pid)} ${[statTxt(m), grant.join(", ")].filter(Boolean).join(" · ")}${m.until === "keep" ? "" : m.until === "main" ? " until end of main phase" : " until end of turn"}`);
    }
  },
  statset(ctx) {   // 耐久力を1にする: a change that brings the stat to N (until the effect ends)
    const t = halfNum(ctx.st.text), ts = ctxTargets(ctx), sets = [["精神力", "se"], ["攻撃力", "at"], ["耐久力", "de"]]
      .map(([j, k]) => { const m = t.match(new RegExp(j + "を([0-9X]+)にする")); return m ? [k, m[1] === "X" ? ctx.x : +m[1]] : null; }).filter(Boolean);
    if (!ts.length || !sets.length) return false;
    for (const { o, pid } of ts) {
      const cur = statsOf(ctx.S, o, o.piles[pid]), m = { label: `「${ctx.src.jp}」`, se: 0, at: 0, de: 0, until: effectUntil(ctx.st.text) };
      for (const [k, v] of sets) m[k] = v - (cur[k] || 0);
      (o.piles[pid].mods = o.piles[pid].mods || []).push(m);
      ctx.log(`${pname(ctx.S, o, pid)}: ${sets.map(([k, v]) => `${{ se: "Mental", at: "Attack", de: "Defense" }[k]} becomes ${v}`).join(", ")}${m.until === "main" ? " until end of main phase" : m.until === "turn" ? " until end of turn" : ""}`);
    }
  },
  grant(ctx) {   // …はイニシアチブを得る / 与える
    const grant = effectGrants(ctx.st.text), ts = ctxTargets(ctx);
    if (!ts.length) return false;
    for (const { o, pid } of ts) {
      (o.piles[pid].mods = o.piles[pid].mods || []).push({ label: `「${ctx.src.jp}」${grant.length ? "" : ": " + ctx.st.text.slice(0, 40)}`, se: 0, at: 0, de: 0, until: effectUntil(ctx.st.text), grant });
      ctx.log(`${pname(ctx.S, o, pid)} gains ${grant.join(", ") || "it (see the card text)"}`);
    }
  },
  mark(ctx) {   // negate / immune / restrictions: a reminder on the character until it ends
    const ts = ctxTargets(ctx);
    if (!ts.length) return false;
    for (const { o, pid } of ts) {
      (o.piles[pid].mods = o.piles[pid].mods || []).push({ label: `「${ctx.src.jp}」 ${effectTypeLabel(ctx.st.type)}`, se: 0, at: 0, de: 0, until: effectUntil(ctx.st.text), mark: ctx.st.type });
      ctx.log(`${pname(ctx.S, o, pid)}: ${effectTypeLabel(ctx.st.type)} — ${ctx.st.text}`);
    }
  },
  damage(ctx) {   // Nダメージ / (N)ダメージ を与える
    if (stepAim(ctx.st) === "pc" && ctx.tgt && ctx.tgt.seat != null) return EFFECT_ACTIONS.pdmg(Object.assign({}, ctx, { st: Object.assign({}, ctx.st, { pcPlayer: true }) }));   // a player was chosen
    const n = effectN(ctx.st.text, ctx.x), mental = /\([0-9XＸ０-９]+\)ダメージ/.test(ctx.st.text), ts = ctxTargets(ctx);
    if (!ts.length) return false;
    for (const { o, pid } of ts) damageCharacter(ctx.S, o, pid, { normal: mental ? 0 : n, mental: mental ? n : 0, label: ctx.src.jp }, ctx.log);
  },
  pdmg(ctx) {   // プレイヤーにNダメージ
    if (stepAim(ctx.st) === "pc" && ctx.tgt && ctx.tgt.pid) return EFFECT_ACTIONS.damage(ctx);   // ≪キャラクターまたはプレイヤー≫: a character was chosen
    const n = effectN(ctx.st.text, ctx.x);
    for (const o of ctxPlayers(ctx)) takeDamage(ctx.S, o, n, false, ctx.e.id + "-" + o.seat, ctx.log);
  },
  discard(ctx) {   // 目標の≪キャラクター≫を捨て札する
    if (stepAim(ctx.st) === "chain") return chainTake(ctx, "discard");   // a card in the Resolve box → discard pile
    const ts = ctxTargets(ctx);
    if (!ts.length || stepAim(ctx.st) === "self" && /このカード/.test(ctx.st.text)) return false;
    for (const { o, pid } of ts) defeatPile(ctx.S, o, pid, { why: `discarded by 「${ctx.src ? ctx.src.jp : "an effect"}」` }, ctx.log);   // Bind / "…場に残す" may keep it
  },
  bounce(ctx) {   // ≪キャラクター≫をオーナーの手札に戻す (power / permanent cards → discard pile)
    if (stepAim(ctx.st) === "chain") return chainTake(ctx, "hand");   // a card in the Resolve box → its owner's hand
    const ts = ctxTargets(ctx);
    if (!ts.length) return false;
    for (const { o, pid } of ts) { const n = pname(ctx.S, o, pid); returnPileToHand(ctx.S, o, pid); ctx.log(`${n} returns to ${o.name}'s hand`); }
  },
  todeck(ctx) {   // デッキに戻す (bottom; shuffle with the deck button when the text says so)
    if (stepAim(ctx.st) === "chain") return chainTake(ctx, "deck");   // a card in the Resolve box → its owner's deck
    const ts = ctxTargets(ctx);
    if (!ts.length) return false;
    for (const { o, pid } of ts) {
      const pile = o.piles[pid], n = pname(ctx.S, o, pid);
      pile.stack.forEach(u => S_deckPush(ctx.S, u, /一番上/.test(ctx.st.text)));
      [...pile.power, ...pile.perm].forEach(u => ctx.S.players[seatOf(u)].discard.push(u));
      delete o.piles[pid]; o.porder = o.porder.filter(x => x !== pid);
      ctx.log(`${n} goes back into ${o.name}'s deck${/シャッフル/.test(ctx.st.text) ? " — shuffle that deck (Deck → Shuffle)" : ""}`);
    }
  },
  cancelbattle(ctx) {   // アタック宣言 / ガード宣言 を取り消す
    const S = ctx.S, t = ctx.tgt && ctx.tgt.pid, guardOnly = /ガード宣言/.test(ctx.st.text) && !/アタック宣言/.test(ctx.st.text);
    if (S.ma) {
      if (S.ma.guard && (t === S.ma.guard || guardOnly)) { S.ma.guard = null; ctx.log("The guard is cancelled"); return; }
      if (guardOnly) return false;
      S.ma = null; ctx.log("The attack is cancelled"); return;
    }
    if (S.fc && S.phase === 1) {
      const A = S.players[S.turn];
      if (S.fc.guard && (t === S.fc.guard || guardOnly)) { S.fc.guard = null; ctx.log("The guard is cancelled"); return; }
      if (guardOnly) return false;
      ctx.log("The attack is cancelled"); nextAttack(S, A, ctx.log); return;
    }
    return false;
  },
  guardfor(ctx) {   // このキャラクターは、目標の≪キャラクター≫をガードする
    const S = ctx.S;
    if (S.ma && maDefender(S) === ctx.p) { S.ma.guard = ctx.pid; ctx.log(`${pname(S, ctx.p, ctx.pid)} guards instead`); if (S.ma.step === "guard") enterResponse(S, ctx.log); return; }
    if (S.fc && S.phase === 1 && S.turn === ctx.p.seat) { S.fc.guard = ctx.pid; ctx.log(`${pname(S, ctx.p, ctx.pid)} guards instead`); if (S.fc.step === "guard") enterResponse(S, ctx.log); return; }
    return false;
  },
  powersteal(ctx) {   // 目標のパワーカード全てを、このキャラクターにパワーカードとしてセットする
    const [t] = ctxTargets(ctx), me = ctx.pile;
    if (!t || t.pid === ctx.pid) return false;
    const from = t.o.piles[t.pid], n = from.power.length;
    me.power.push(...from.power.splice(0));
    ctx.log(`${n} power card${n === 1 ? "" : "s"} move from ${pname(ctx.S, t.o, t.pid)} to ${pname(ctx.S, ctx.p, ctx.pid)}`);
  },
  powerdeck(ctx) {   // デッキの一番上のカードN枚をパワーカードとしてセット
    const n = effectN(ctx.st.text, ctx.x), [t] = ctxTargets(ctx).concat([{ o: ctx.p, pid: ctx.pid }]), p = ctx.p;
    let k = 0;
    for (; k < n && p.deck.length; k++) { const u = p.deck.shift(); t.o.piles[t.pid].power.push(u); p.hidden.push(u); }
    ctx.log(`${k} card${k === 1 ? "" : "s"} from the top of the deck set as power on ${pname(ctx.S, t.o, t.pid)}`);
  },
  powerdiscard(ctx) {   // パワーカードN枚を捨て札する
    if (stepAim(ctx.st) === "powercard") {   // the chosen power card(s) → their owner's discard pile
      const uids = (ctx.tgt && ctx.tgt.uids) || [];
      let k = 0;
      for (const u of uids) {
        const f = ctx.S.players.map(o => ({ o, pid: o.porder.find(q => o.piles[q].power.includes(u)) })).find(x => x.pid);
        if (!f) continue;
        const pw = f.o.piles[f.pid].power; pw.splice(pw.indexOf(u), 1);
        const owner = ctx.S.players[seatOf(u)]; owner.discard.push(u); owner.hidden = owner.hidden.filter(x => x !== u);
        ctx.log(`Power card 「${nameOf(ctx.S, u)}」 on ${pname(ctx.S, f.o, f.pid)} goes to ${owner.name}'s discard pile`, u); k++;
      }
      return k ? undefined : false;
    }
    const all = /パワーカード全て/.test(ctx.st.text), n = effectN(ctx.st.text, ctx.x), ts = ctxTargets(ctx);   // "…キャラクター全てに…パワーカード1枚ずつ" = 1 each
    if (!ts.length) return false;
    for (const { o, pid } of ts) {
      const pw = o.piles[pid].power, k = all ? pw.length : Math.min(n, pw.length);
      for (let i = 0; i < k; i++) { const u = pw.pop(); ctx.S.players[seatOf(u)].discard.push(u); }
      ctx.log(`${pname(ctx.S, o, pid)} discards ${k} power card${k === 1 ? "" : "s"}`);
    }
  },
  makeactive(ctx) {   // 目標を、オーナーの勢力エリアのアクティブキャラクターにする
    const ts = ctxTargets(ctx);
    if (!ts.length) return false;
    for (const { o, pid } of ts) {
      const pile = o.piles[pid], c = cardOf(ctx.S, pileTop(pile));
      [...pile.power].forEach(u => o.discard.push(u)); pile.power = [];
      pile.area = "faction"; pile.slot = FACTS.includes(c.f) ? c.f : NO_FACTION; pile.rest = false;
      o.porder = o.porder.filter(x => x !== pid); o.porder.push(pid);
      ctx.log(`${pname(ctx.S, o, pid)} becomes an active character (${pile.slot})`);
    }
  },
  draw(ctx) {   // Nドローする
    const n = effectN(ctx.st.text, ctx.x);
    for (const o of ctxPlayers(ctx)) { let k = 0; for (; k < n && o.deck.length; k++) o.hand.push(o.deck.shift()); ctx.log(`${o.name} draws ${k}`); }
  },
  zonepick(ctx) {   // "≪プレイヤー全て≫は自分の捨て札置き場のカード1枚を手札に加える" → each player picks in a pop-up (Event System)
    const t = halfNum(ctx.st.text), S = ctx.S;
    const zones = [...t.matchAll(/(ダメージ置き場|捨て札置き場)/g)].map(m => (m[1] === "ダメージ置き場" ? "damage" : "discard")).filter((z, i, a) => a.indexOf(z) === i);
    const n = (t.match(/([0-9X]+)枚/) || [])[1], cnt = n === "X" ? ctx.x : +n || 1;
    const types = Object.entries({ "パーマネントカード": "Permanent", "プロジェクトカード": "Project", "ファストカード": "Fast", "ブレイクカード": "Break", "キャラクターカード": "Character" }).filter(([j]) => t.includes(j)).map(x => x[1]);
    const filter = { types, icons: T_ICONS.filter(j => t.includes(j)), named: /ネームを持つ/.test(t) };
    const everyone = /プレイヤー全て|全てのプレイヤー|各プレイヤー/.test(t), anyone = !/あなた|自分/.test(t) && !everyone;
    const pickers = everyone ? S.players.filter(o => !S.solo || o === ctx.p) : [ctx.p];
    let made = 0;
    for (const o of pickers) for (const zone of zones) {
      const owners = anyone ? S.players : [o];
      const cands = owners.flatMap(w => w[zone].filter(u => zonePickOK(S, u, filter)));
      if (!cands.length) { ctx.log(`${o.name}: no matching card in the ${zone === "damage" ? "damage pile" : "discard pile"} — skipped`); continue; }
      S.picks = S.picks || [];
      S.picks.push({ id: `${ctx.e.id || S.log.length}-${o.seat}-${zone}-${S.picks.length}`, seat: o.seat, zone, from: anyone ? null : o.seat, n: Math.min(cnt, cands.length), filter, src: ctx.src ? ctx.src.jp : "" });
      made++;
    }
    if (made) ctx.log(`Pick: ${made} choice${made === 1 ? "" : "s"} to make (${zones.map(z => (z === "damage" ? "damage pile" : "discard pile")).join(" then ")} → hand)`);
  },
  castban(ctx) {   // "…この効果で手札に戻ったカードと同じ名称のカードを使用宣言することができない": Cast prevention (field effect)
    const uid = ctx.memo && ctx.memo.returned, c = uid && cardOf(ctx.S, uid);
    if (!c) return false;
    const S = ctx.S, everyone = /プレイヤー全て|全てのプレイヤー/.test(ctx.st.text), seats = everyone ? S.players.map(o => o.seat) : /対戦相手/.test(ctx.st.text) ? S.players.filter(o => o !== ctx.p).map(o => o.seat) : [ctx.p.seat];
    S.castBans = S.castBans || [];
    S.castBans.push({ name: c.jp, seats, until: effectUntil(ctx.st.text), src: ctx.src ? ctx.src.jp : "" });
    ctx.log(`Cast prevention: 「${c.jp}」 can't be declared by ${everyone ? "any player" : seats.map(x => S.players[x].name).join(", ")} ${effectUntil(ctx.st.text) === "main" ? "until end of main phase" : effectUntil(ctx.st.text) === "turn" ? "until end of turn" : ""}`);
  },
  xdef: () => true, note: () => true,
  search: () => false, manual: () => false,
};
/** Can this card be picked by a zonepick (type / icon / name filters)? */
function zonePickOK(S, u, f) {
  const c = cardOf(S, u);
  if (!c) return false;
  if (f.types.length && !f.types.includes(c.t)) return false;
  if (f.icons.length && !c.cls.some(t => f.icons.includes(t) || f.icons.includes(t.replace("♂", "")))) return false;
  if (f.named && !cardName(c)) return false;
  return true;
}
/** Take a declared card out of the Resolve box (it doesn't resolve): to its owner's hand or discard pile. */
function chainTake(ctx, to) {
  const S = ctx.S, id = ctx.tgt && ctx.tgt.chain, i = (S.chain || []).findIndex(x => x.id === id);
  if (i < 0) return false;
  const it = S.chain.splice(i, 1)[0], uid = it.kind === "play" ? it.uid : null;
  if (!uid) { ctx.log("The effect is cancelled"); return; }
  const o = S.players[seatOf(uid)];
  if (to === "deck") { S_deckPush(S, uid, false); if (/シャッフル/.test(ctx.st.text)) ctx.log(`✋ ${o.name}: shuffle the deck (deck button)`); } else o[to].push(uid);
  ctx.memo.returned = uid;
  ctx.log(`「${nameOf(S, uid)}」 is taken out of the Resolve box → ${o.name}'s ${{ hand: "hand", discard: "discard pile", deck: "deck" }[to]} (it doesn't resolve)`, uid);
}
function S_deckPush(S, u, top) { const o = S.players[seatOf(u)]; if (top) o.deck.unshift(u); else o.deck.push(u); }
/** Run every sentence of an effect (called by the "effect" event after the cost is paid). */
function runEffect(ctx0, ef) {
  const todo = [];
  ctx0.memo = ctx0.memo || {};   // shared by the steps (e.g. the card returned by step 1, for step 2)
  for (const st of ef.steps) {
    const r = EFFECT_TYPE[st.type] || EFFECT_TYPE.other, act = EFFECT_ACTIONS[r.action] || EFFECT_ACTIONS.manual;
    let ok;
    try { ok = act(Object.assign({}, ctx0, { st })); } catch (err) { ok = false; }
    if (ok === false && !["note", "xdef"].includes(r.action)) todo.push(st.text);
  }
  if (todo.length) ctx0.log(`✋ Do by hand: ${todo.join(" ")}`);
}
