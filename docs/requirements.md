# Aquarian Age Helper — Requirements (consolidated, v3.28)

One list of everything asked for so far, grouped by area. Each line says **what** the site must do and **where** it lives in the code.
Rules quoted from the rulebook are in the Rules tab (`src/rules_content.py`).

## 1. Data

| # | Requirement | Where |
|---|---|---|
| D1 | Card database = `data/cardlist.xlsx` (sheet "Cards"); images from Google Drive. `build.py` turns it into `data.js`. | build.py |
| D2 | Skills come from the "Skills" / "Skill: X" columns. Skills written on the same line as an effect ("▼ チャージ1 1：…") must also be read — fixed in the sheet by `tools/skills_fix.py` (393 cards). | tools/skills_fix.py |
| D3 | Effects = text lines with a cost ("1：…", "X：…"), also after skills on the same line. | 01-core.js `parseEffects`, tools/effects_xlsx.py |
| D4 | Faction order everywhere: E.G.O. → Arayashiki → WIZ-DOM → Darklore → Polestar Empire → Eraser, with faction icons on pastel colours. English text before Japanese; 精神力 = "Mental". | 01-core.js |

## 2. Card List / search

| # | Requirement | Where |
|---|---|---|
| S1 | Filters: series, faction, category, class icons, skills, Break-cost return, and stats (Factor, Cost, Mental, Attack, Defense, Rarity, **Effect cost**). Options only show values that still have matches. | 02-filters.js |
| S2 | Sort by any stat / skill value, several keys with priority; 3 taps = ↑ ↓ off. Effect cost sorts by the lowest cost. | 02-filters.js |
| S3 | Filters fold; Inline or Sidebar layout; prominent red Reset. | 02-filters.js, app.css |

## 3. Deck Builder

| # | Requirement | Where |
|---|---|---|
| B1 | 10 deck slots; export one deck or all; import all. | 03-deck.js, 04-export.js |
| B2 | Deck sleeve: default card back; upload, zoom and position your own. | 03-deck.js |
| B3 | Templates #1 Full Deck and #2 Characters Only: step-by-step picks (main / sub icon and factor sections, Draw, Charge, Break·Charge / Break·Draw, Break-cost return, Permanent / Fast / Project), adjustable copies 0–4, picked cards move to the top, counts stay pinned. | 06-template.js |

## 4. Table (Solo Test and Play Online)

| # | Requirement | Where |
|---|---|---|
| T1 | Event-sourced game: every action is an event; both players replay the same log; Undo / Redo of your own last action. New events are applied incrementally; undo / redo / out-of-order events replay the log. | 06b-play-engine.js, 06f-play-net.js |
| T2 | Online vs a friend through Firebase (free tier) or "this computer" test rooms. Solo Test = tab 6, Play Online = tab 7. | 06f-play-net.js |
| T3 | Before the game: choose the first player (online), keep / re-shuffle the opening hand any number of times, **game rule: power cards from hand face up or face down** (locked once the game starts). | 06b-play-engine.js, 06g-play-ui.js |
| T4 | Solo Test: choose one of the 10 deck slots and your name; ■ End game returns to the start screen; ✎ Rename during the game (also online). | 06h-play-input.js |
| T5 | Phases: Draw (first player skips turn 1; Draw ±X) → Faction → Main → Power card → Discard. | 06b-play-engine.js |
| T6 | Layout: board with three rows of **equal height** — Active area ↔ Damage, Control (Front) ↔ Deck, Control (Back) ↔ Discard. Project / Fast cards in their own box at the right end of Control (Front). Right column: fixed-size Battle box (300 px) + control box (430 px) with phase, Undo / Redo, Next; then the log. Hand panel (fixed card size) under the field. | 06g-play-ui.js, app.css |
| T7 | Left click = play / choose / un-pick (click again); right click / long press = card details. | 06h-play-input.js |
| T8 | Highlights: playable hand cards = thick pastel yellow; clickable targets = running blue border; only characters whose power is below Mental take power cards. | app.css, 06g-play-ui.js |
| T9 | Active area: 6 faction slots, the characters underneath visible. Control area: Front / Back rows, drag or move left / right. A character dominated from the Active area goes to **Back**; a character you set a Break card on goes to **Front**. | 06b-play-engine.js |
| T10 | Break: on any character of a faction party (not only the top one); different icon = exception the player confirms; stack shown in order 1 Character → 2 Break #1 → 3 Break #2. | 06b-play-engine.js, 06g-play-ui.js |
| T11 | Paying costs: the player chooses which power cards pay (card play, attack, guard, effects); paid cards go to the Cost window → Discard / Hand / Damage / Deck. | 06b-play-engine.js, 06g-play-ui.js |
| T12 | Power card phase: pick from hand / deck into the Charge window, set one by one; power ≤ Mental; deck charging ≤ the sum of Charge +X. Hand limit = 7 ± **Capacity**. | 06b-play-engine.js |
| T13 | Card size Small / Middle / Large; foldable log; draggable windows. | 06g-play-ui.js |

## 5. Rules engine

| # | Requirement | Where |
|---|---|---|
| R1 | Stats = base + Permanents + changes + field effects + conditions (`STAT_SOURCES`, add a function to support a new source). | 06b-play-engine.js |
| R2 | Faction check: factions checked one by one in faction order, each when reached (a ▼ character set later attacks only if its faction is still ahead); Guard phase → Fast / effects → Resolve. | 06b-play-engine.js |
| R3 | **Attack** in the Main phase only: dominated, untapped character; target another player (opponent's Guard phase) or an active character in your own faction area (no guard). One attack at a time; Boost; Offensive / Defensive return the cost to hand. | 06b-play-engine.js |
| R4 | Attack / guard costs: 1 + `COST_SOURCES` (Intercept −1, Boost, field cost effects). | 06b-play-engine.js |
| R5 | Damage: normal / mental (X); Shield, Resist (`DAMAGE_RULES`); Initiative; damage to players (normal → Character to the Active area, else damage pile; special → damage pile; named duplicates → damage pile). | 06b-play-engine.js |
| R6 | Damage outside battle: one character, or **Area damage** — every character in a Control area, an Active area, a territory, a faction party or the whole game (with conditions). | 06b-play-engine.js `areadmg`, 06g-play-ui.js |
| R7 | Targeting: every ≪target≫ in card text parsed (what × count × whose × where × conditions); field effects use target specs (scope game / territory / area / party). | 06c-target.js |
| R8 | **Effect System**: 2,128 effects → 41 types in 11 groups (`src/data/effect_types.json`); automated actions for cost-to-hand, stat change, damage, discard, bounce, cancel attack / guard, gain skill, draw, power cards (incl. picking a single power card) …; the rest are logged as "✋ Do by hand". | 06d-effects.js |
| R9 | **Condition System**: "…場合、≪このキャラクター≫は…を得る / を持つ / ±N" lines (251 on 245 cards); while met, the character gets those skills, stats and effects; 228 checked automatically, the rest switched by the player. | 06e-conditions.js |
| R11 | **Battle System**: Attack → Guard → Response phase (each player passes; any action reopens it) → Before battle → Battle → After battle, for faction-check and main-phase attacks. | 06b-play-engine.js (`curAttack`, `enterResponse`, `maybeBattle`) |
| R12 | **Ability System**: every non-effect line read as trigger (attack, guard declared, before / after battle, set, dominated …), during battle, or always on (self or Field effect). Triggers wait for Run / Skip by their owner. | 06ea-abilities.js |
| R13 | **Resolve Box**: Break / Fast / Project cards and effects are declared, wait for responses (Fast / effects), and when everyone passes **only the latest one resolves**, then everyone may respond again before the next; Fast / Project text runs on resolution. | 06b-play-engine.js (`chainPush`, `resolveChain`), 06g-play-ui.js (`chainHTML`) |
| R15 | Resolve-box targets: “使用宣言中 / 使用した … カード1枚” picks a card declared earlier in the Resolve box; it leaves the box unresolved (hand / discard / deck). **Cast prevention** field effect (`S.castBans`) blocks declaring cards with that name for the listed players until it expires. | 06d-effects.js `chainTake`, `castban`; 06b-play-engine.js `castBanned` |
| R16 | Break restrictions 【…ブレイク可能】 on the card (name only, any icon for …, broken / territory / field conditions). | 06b-play-engine.js `breakRule`, `breakFits` |
| R17 | ≪キャラクターまたはプレイヤー≫ targets: Deck = player, field card = character. Target conditions checked at pick and at resolution. | 06d-effects.js `stepAim` "pc", `targetTextOK` |
| R18 | Defense ≤ 0 → defeated at once; Bind / "場に残す" save step (S.saves). A 0 only in battle can be saved; a lasting 0 defeats it anyway. | 06b-play-engine.js `checkDefense`, `defeatPile`, `saveOptions` |
| R14 | Defeated in battle: named Break cards go to the damage pile. | 06b-play-engine.js `dropPile` |
| R10 | Field effects: stat / cost changes for a target spec; "power cards visible" (both players agree). | 06b-play-engine.js |

## 6. Open questions

- Boost: does it also raise the attack value, or only the costs?
- Factor conditions ("あなたが冥冥冥を満たしている"): how factors are counted, and which factions 冥 and 宇 belong to.
- Older questions: トライ naming; family-name order; whether the default sleeve should be mirrored.
- Firebase: the Realtime Database rules must allow read / write on `rooms/` (see the report).
