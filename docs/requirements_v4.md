Aquarian Age Helper — Requirements v4 (rebuild from scratch)
==================================================================================================================
How to read this file
- Pack's text is kept as written. Lines starting with "→ {Revise#NNN}" are Claude's additions or clarifications.
- "{Q#NN}" = a question for Pack. Implementation of that part waits for the answer (all questions are also listed in section 19).
- "(prev)" = how the previous version (v3.36) did it; per Pack, kept the same unless Pack says otherwise.
- Rulebook references are to the Rules tab (src/rules_content.py, Aquarian Age rulebook).
- After this file is agreed, every change request is made here first (new Revise tag), then in the code.
==================================================================================================================
Requirements:
------------------------------------------------------------------------------------------------------------------
→ {Revise#058} Scope (Q#03): v4 rebuilds only the game table (Solo Play, Online Play and the systems below). Card List, Deck Builder, Discussions, Rules and Changelog tabs stay as they are; the table keeps reading decks from the Deck Builder's 10 slots.
0. Wording Definition: This section defines the wording which needs extra explanation.
	1. Difference "Character" and "Character Card"
	   "Character" means "Character Card" or "Character Card with Break Card" that is on the field.
	   "Character Card" is the Type of card.
	→ {Revise#001} Rulebook: Permanent cards and power cards set on a character are NOT part of the "Character".
	   The cards that make up a character = its Character Card + the Break Cards stacked on it ("stack").
	→ {Revise#002} More wording used below:
	   - "Active Character" = the top character of a faction party in the Active Area (rulebook: 勢力エリアのアクティブキャラクター).
	   - "Controlled Character" = a character in the owner's Control Area (Front or Back) (rulebook: 支配キャラクター).
	   - "Broken Character" = a character with at least one Break Card on it (a Break Card set directly to the field also counts as broken). {Q#01}
	   - "Name-level" = a card whose name has a personal name in “ ” (e.g. 女帝竜“ィアーリス”). Only one character with a given name can be on the field.
	   - "Territory" = all areas of one player (Active Area + Control Area + Special Area).
	   - "Declaration" = one of the 4 declarations in section 2. "Main Declaration" / "Sub Declaration" = section 6.
	   - "Turn player" = the player whose turn it is.
------------------------------------------------------------------------------------------------------------------
1. Field Components
	1. Deck *Make it the same as previous version
	→ {Revise#003} (prev) Face-down pile showing the sleeve and the card count. Click (own deck): Shuffle / Search the deck. In the Charge Phase, click = take the next card from the deck as a power card (limited by Charge). Also the target for "≪player≫" picks (click the Deck = that player). With 18.5 ("deck information hidden") see {Q#02}.
	→ {Revise#066} (Q#02) Hidden = nobody sees the cards or the order of another player's deck (your own deck only through Search / search effects). The deck COUNT of every player stays visible.
	2. Damage Pile *Make it the same as previous version
	→ {Revise#004} (prev) Face-up pile, top card shown, count badge; red warning at 8+; 10 or more = that player loses. Click = list of the cards.
	3. Discard Pile *Make it the same as previous version
	→ {Revise#005} (prev) Face-up pile, top card shown, count badge. Click = list of the cards. A "Removed" pile appears only when something is removed from the game.
	4. Area *Make it the same as previous version
		1. Active Area
		2. Control Area (Front)
		3. Control Area (Back)
		4. Special Area
	→ {Revise#006} (prev) Active Area = 6 faction slots in faction order E.G.O. → Arayashiki → WIZ-DOM → Darklore → Polestar Empire → Eraser, the faction party stacked in each slot (lower characters visible as strips).
	   Control Area (Front) = characters you set a Break card on; Control Area (Back) = characters dominated from the Active Area. Cards can be dragged / moved left-right and between Front and Back.
	   Three rows of equal height on a computer; on phones each row is only as tall as its cards (v3.36).
	   Damage / Deck / Discard stand in one column at the right edge, close together (one row under the areas on phones).
	→ {Revise#007} "Special Area" = the previous "Project / Fast" box at the right end of Control Area (Front). Fast and Project cards stay there while they are declared / their effect lasts, then go to the Discard Pile (section 2.1.4–5).
	5. Hand *Make it the same as previous version
	→ {Revise#008} (prev) Hand panel at the bottom (fixed card size, Fold button; draggable on a computer, docked on phones). Playable cards = thick pastel-yellow border. Left click = declare / choose / un-pick; right click or long press = card details. Hand limit = 7 ± Capacity (shown in the panel title).
	6. Resolve screen *Make it the same as previous version
	→ {Revise#009} (prev) "Resolve box" at the top of the right column: shows the Main Declaration and the Sub Declarations (newest on top), who has passed, the "No response (pass)" / "Resolve top" button, triggered abilities (Run / Skip), Event System picks, and characters waiting to be kept or defeated (section 14).
	7. Cost screen *Make it the same as previous version
	→ {Revise#010} (prev) "Cost window": the power cards just paid wait here; the player (or the system, section 4) sends them to Discard / Hand / Damage / Deck. The opponent sees the paid cards. A declaration can't be resolved while paid cost is still waiting.
	→ {Revise#011} Also kept from the previous version (part of the field, not listed above): Field effects box (section 8), log (foldable) + chat, phase / control panel (Undo / Redo, Next), card size Small / Middle / Large, highlights (playable = pastel yellow, valid target = running blue border, field-effect source = running pastel-orange border, character that would be defeated = red outline). {Q#03}
------------------------------------------------------------------------------------------------------------------
2. Declare System
	There are 4 types of declare as below. 
	When declaration is made, "Cost" must be paid first then "Target" must be defined.
	There is a card with effect that "specific declaration cannot be made".
	Ex. "Attack Declaration cannot be made" or "Fast Card Set Declaration cannot be made"
	→ {Revise#012} Order inside one declaration: (1) choose what to declare → (2) pay the cost (Cost System, section 4) → (3) choose the target (Targeting System, section 5) → (4) it enters the Resolve screen (section 6).
	   Note: previous version chose the target first, then the cost. Changing to cost-first as written. {Q#04}
	→ {Revise#059} (Q#04) If no valid target can be chosen after paying (or the player cancels at the target step), the declaration is cancelled and the paid power cards go back to the characters they came from (refund). The player is warned before paying when the system already knows there is no valid target.
	→ {Revise#013} "Declaration Ban" = one kind of Field Effect (section 8): {kind of declaration (+ card type / card name / faction / icon), which players, until when}. While it is active the declaration is not offered (button greyed with the reason) and an event of that kind is refused.
	   Covers e.g. "アタック宣言できない", "ファストカードを使用宣言できない", and the previous "Cast prevention" (A3-14 2058: cards with the same name can't be declared until end of Main Phase).
	1. Set Declaration: To set card from hand. There are 5 types of cards as below.
	   When "Resolved" of "Card Set Declaration", do determine the condition such as "Factor is enough or not". If "Factor is not enough", the card set is failed and the setting card goes to "Discard Pile".
	→ {Revise#014} Conditions checked at resolution (rulebook p.16–29); if one fails, the declaration is cancelled, the cost is NOT refunded, and the card goes to the Discard Pile:
	   - Required factor: at least N Controlled Characters of that faction (Character cards need no factor and no cost).
	   - The target still exists and is still valid (e.g. the character to break is gone or no longer shares an icon).
	   - Name rule: a name-level card can't enter if a character with that name is already on the field — it goes to its owner's Damage Pile instead (rulebook).
	   - Break restriction written on the card (【“X”のみブレイク可能】 etc., as in v3.35).
		1. Character Card
			1. Character Card will always set to active area.
	→ {Revise#015} It goes on top of its faction's party (it becomes the Active Character). Previous version placed characters at once (not through the Resolve screen); rulebook lets players respond to any card declaration, so in v4 a Character Set Declaration also goes through the Resolve screen. {Q#05}
	→ {Revise#067} (Q#05) Replaces the last sentence of Revise#015: a Character Set Declaration is placed at once (as before), not through the Resolve screen.
		2. Break Card
			1. Break Card will be set to character as default.
			2. With "Ability", "Effect" or "Field Effect", Break Card may be set to the field directly.
			   Please implement system to support such case.
	→ {Revise#016} Default (rulebook): target = any character (any character of a faction party, not only the top one) that shares at least one class icon; an opponent's character must have no power cards. Name-level characters can only be broken by a Break card with the same name.
	   Breaking your own Active Character moves it to your Control Area (Front). Breaking an opponent's character discards that character and everything on it; only your Break card goes to your Control Area (Front).
	   Stack shown in order 1 Character → 2 Break #1 → 3 Break #2 …; icon exception only with the player's confirmation (prev).
	→ {Revise#017} "Set to the field directly" = a Placement Rule (data in the Ability / Field Effect database) that adds a destination "the field (no character)" to the Break Set Declaration. The Break card then stands alone in the Control Area (Front) as a character. {Q#01}
	→ {Revise#065} (Q#01) A Break card set directly to the field goes to the Control Area (Front) and counts as a Broken Character (e.g. not a valid target for ≪ブレイクしていないキャラクター≫; Breakthrough treats it as broken).
	→ {Revise#071} (Q#26) It acts like any Controlled Character: it can attack, guard, hold power cards and permanents, and use its effects.
		3. Permanent Card
			1. Permanent Card will always be set to "Controlled Character" of owner.
	→ {Revise#018} One permanent per character by default; the skill Permanent ±X changes the limit (over the limit → owner discards down). Its effects count as that character's abilities (rulebook).
		4. Fast Card
			1. Fast Card will always be set to "Special Area"
		5. Project Card
			1. Project Card will always be set to "Special Area"
	→ {Revise#019} Fast / Project: shown in the Special Area from declaration; the card text runs when it resolves (Ability System, section 9); after that it goes to the Discard Pile unless its effect lasts ("until end of turn" etc.), then it is discarded when the effect ends.
	2. Attack Declaration *Make it the same as previous version
	→ {Revise#020} (prev) Main Phase only (Active Phase attacks are the ▼ faction-check attacks, section 10). An untapped Controlled Character pays the attack cost (1 + modifiers: Boost, field effects) from its own power cards. Target: another player, or an Active Character in your own Active Area (no guard → straight to battle). A character may attack many times in one turn if it can pay (prev v3.29). One attack at a time.
	3. Defense Declaration *Make it the same as previous version
	→ {Revise#021} (prev) "Guard". Only the attacked player, only as the direct answer to the attack (rulebook: answering the attack with anything else first loses the right to guard). A Controlled Character pays the guard cost (1 + modifiers: Intercept −1, Boost, field effects). Stealth / Breakthrough limit who may guard.
	4. Effect Usage Declaration *Make it the same as previous version
	→ {Revise#022} (prev) An effect line ("1：…", "X：…") of a Controlled Character (or granted by a condition / permanent). Cost paid from that same character. Choose X for X-cost effects. Target picked per the Targeting System. Goes to the Resolve screen.
------------------------------------------------------------------------------------------------------------------
3. Timing System
	The timing defines which "Declaration" can be made.
	1. Fast Timing: Can be make at any time. Can be make during resolving.
		1. Set Declaration : Fast Card
		2. Set Declaration : Break Card with "Ability" or "Field Effect"
		3. Set Declaration : Permanent Card with "Ability" or "Field Effect"
		3. Set Declaration : Project Card with "Ability" or "Field Effect"
		4. Effect Usage Declaration
	→ {Revise#023} "with Ability or Field Effect" = a card or field effect that says this card may be declared at Fast Timing (data: Timing Rule in the database).
	→ {Revise#024} Rulebook differences — please choose {Q#06}:
	   (a) Rulebook: Fast cards and effects are used in the Active (Faction) Phase and Main Phase of any player, not in Draw / Charge / Discard Phase.
	   (b) Rulebook: "Nothing new can be declared while resolving" — and v3.34 resolves one at a time, with a new response round before the next item. "Can be made during resolving" is read as: between two resolutions (after the top one resolves, before the next) — not in the middle of one item.
	→ {Revise#060} (Q#06) Follow the rulebook: Fast Timing = the Active Phase and Main Phase of any player (not Draw / Charge / Discard Phase). Nothing new is declared while an item is resolving; a new response round opens after each item resolves (one at a time, Revise#034).
	2. Project Timing: Can be make only in "Main Phase"
		1. Set Declaration : Character Card
		2. Set Declaration : Break Card
		3. Set Declaration : Permanent Card
		4. Set Declaration : Project Card
	→ {Revise#025} Only the turn player, only in their own Main Phase, and only when nothing is waiting in the Resolve screen (rulebook: these are not responses).
	3. Attack Timing: *Make it the same as previous version
	→ {Revise#026} (prev) Turn player, own Main Phase, nothing waiting in the Resolve screen, no other attack going on. Plus the ▼ faction-check attacks in the Active Phase (no cost).
	4. Defense Timing: *Make it the same as previous version
	→ {Revise#027} (prev) The attacked player, right after the Attack Declaration (Guard step), before any other response.
------------------------------------------------------------------------------------------------------------------
4. Cost System
	1. System that User must pay charged power card of character in Control Area.
	→ {Revise#028} Which character pays (rulebook): Set Declaration cost = any of your Controlled Characters (may be split over several); Attack cost = the attacker; Defense cost = the guarding character; Effect cost = the character whose effect it is. The player chooses which power cards (prev). Character cards cost nothing.
	2. Implement System to specify where will cost go to.
		1. Costs go to "Discard pile" as default.
		2. With "Skill", "Ability", "Effect", "Field Effect" with effect,
		   Cost may go to "Damage pile", "Hand" or "Deck" in special case.
			1. With "Skill" as below.
				1. Offensive: "Attack cost" will always goes to hand.
				2. Defensive: "Defense cost" will always goes to hand.
				3. Infinity: "Attck cost", "Defense cost", "Effect cost" will always go to hand.
			2. With "Abilty", any kind of "cost" may go to "Damage pile"
	→ {Revise#029} "Cost Destination Rule" (database): {which cost (set / attack / defense / effect, card type, icon…), where (Discard / Hand / Damage / Deck top / Deck bottom), who decides (automatic / owner may choose)}. Sources: skills, abilities, effects ("1: the cost returns to hand"), field effects ("Break cost of icon X returns to hand").
	   Default when a cost is paid: if exactly one rule applies it is applied automatically and logged; if several apply, the owner chooses; none → Discard Pile. The Cost screen still allows a manual change. {Q#07}
	→ {Revise#030} Rulebook wording of the skills (please confirm {Q#08}): Offensive = while controlled, the attack cost for attacking a PLAYER returns to hand. Defensive = while controlled, the guard cost when guarding against a controlled character's attack returns to hand. Infinity = attack, guard and effect costs return to hand after being shown.
	→ {Revise#061} (Q#08) Follow the rulebook wording of Revise#030 (Offensive: only when attacking a player; Defensive: only when guarding against a controlled character's attack; both only while controlled).
------------------------------------------------------------------------------------------------------------------
5. Targetting System
	1. It is written in "<< XXX >>".
		1. Target to Character
		2. Target to Player
		3. Target to Card on Hand
		4. Target to Area
		5. Target to Power Card
		6. Target to Whole Field
		7. Target to Specific Conditions, Please use "Event System" to choose the condition.
		X. If there is any others, please add.
	→ {Revise#031} Added target kinds (found in card text, all handled in the previous version):
		8. Target to Character or Player (≪キャラクターまたはプレイヤー≫: click a Deck = that player, or a character).
		9. Target to a Declaration in the Resolve screen (≪使用宣言中のカード≫, A3-14 2058 …).
		10. Target to a Faction / Faction party (≪任意の勢力1つの…全て≫, chosen through the Event System).
		11. Target to Cards in the Discard / Damage pile / Deck (picked through the Event System).
		12. Target to Permanent Card / Break Card on a character.
		13. Self (≪このキャラクター≫ / ≪このカード≫) and the cost (≪このエフェクトのコスト≫) — no choice needed.
	→ {Revise#032} Each ≪target≫ is parsed into: what × count (1 / up to X / X / all) × whose (yours / opponent's / any) × where (area) × conditions (unbroken, ▼, power 0, icon, faction, name, in battle …). Valid targets get the running blue border; the conditions are checked again at resolution (invalid → that part has no effect).
	2. When the "Declaration" has been made, the target must be made accordingly.
	3. Target may be changed by "Ability", "Effect" or "Fast Card"
	→ {Revise#033} Retarget = an effect action "change the target of declaration D to a new valid target" (e.g. A3-10 1502 "…の対象を、あなたの任意のキャラクター1人に変更する"). Was manual in v3; automated in v4.
------------------------------------------------------------------------------------------------------------------
6. Resolve System
	1. When "Declaration" is made, 
		1. Show the details of "Declaration". Make it "Main Declaration"
		2. Only "Declaration" of "Fast Timing" can be made in this timing before the "Main Declaration" is "Resolved".
		   Call it as "Sub Declaration".
			1. The latest "Declaration" made shall be resolved first.
	2. When "Resolved", execute declaration accordingly.
	→ {Revise#034} (prev v3.34) Every player who may respond (Hold rule, see {Q#09}) passes → only the newest declaration resolves → passes reset → everyone may respond again → … until the Main Declaration resolves.
	→ {Revise#035} Priority (rulebook): when several players want to respond at once, the player whose turn comes soonest goes first (except whoever made the declaration being answered); the target of an attack may answer first. Needed for 3–4 players (section 18).
	→ {Revise#036} Attack / Defense Declarations are also shown in the Resolve screen with their battle steps (Attack → Guard → responses → Before battle → Battle → After battle) as in the previous version.
------------------------------------------------------------------------------------------------------------------
7. Event System
	1. This system is used when specific target must be declared or defined.
	→ {Revise#037} One pop-up engine for every choice the board can't show by clicking: pick N cards from a pile (discard / damage / deck / hand), pick a faction, pick an area, pick a player, pick a declaration in the Resolve screen, pick a card type / name ("指定した…"), yes / no ("…してもよい"), choose X. Each choice is an event in the log (so Undo and online play work). Only the chooser sees the pop-up; others see "waiting for …".
------------------------------------------------------------------------------------------------------------------
8. Field Effect System
	* Same as previous version
	→ {Revise#038} (prev) Effects that work on many characters / players for a time: stat changes for a target spec (game / territory / area / party + icon / faction / condition), cost changes (attack / guard cost ±), "power cards visible" (both players agree), Declaration Bans (Revise#013), Cost Destination Rules from abilities (Revise#029).
	   Shown as a small count beside the field; click to open; "[icon]/[faction]/[name]" + only the stats that change ("+ Attack 2 / − Defense 1"); English text; + adds one by hand, − ends one; click = highlight the source (running pastel-orange border).
	   Ends: until end of battle / main phase / turn / while the source is on the field / until removed.
------------------------------------------------------------------------------------------------------------------
9. Ability System
	This is an effect which is implemented on each card.
	For effect of "Project Card" or "Fast Card", please implement using Ability system (Implement to "Ability Database")
	→ {Revise#039} Ability kinds (prev): Always-on (self or Field Effect), Trigger (when it attacks / is guarded / before battle / after battle / is dominated / enters / is broken / leaves / takes damage / turn start / turn end / declaration resolves), During battle, Replacement ("…場合、代わりに…", "…場に残す"), Zone ability (works in the Damage / Discard pile or hand).
	   Triggers wait in the Resolve screen for Run / Skip by their owner (automatic ones with no choice run at once).
	→ {Revise#040} Conditions ("…場合、≪このキャラクター≫は…を得る") were a separate Condition System in v3 (277 lines). In v4 they become Abilities with a condition. {Q#10}
------------------------------------------------------------------------------------------------------------------
10. Phase System
	1. In each turn, there are 5 phases with sequence as below as default.
		1. Draw Phase
		2. Active Phase
		3. Main Phase
		4. Charge Phase
		5. Discard Phase
	2. With special effect or ability
	→ {Revise#041} Names: Active Phase = rulebook 勢力フェイズ (previously "Faction phase"); Charge Phase = パワーカードフェイズ (previously "Power card phase"). The English names in the site change to these. 
	→ {Revise#042} Rules per phase (prev): Draw = draw 1 ± Draw X (first player skips turn 1; Solo "go second" draws). Active = faction check in faction order; each ▼ Active Character attacks the turn player (no cost), each checked when reached. Main = section 3.2 / 3.3. Charge = set hand cards (and deck cards up to the Charge total) as power cards, ≤ Mental per character; at the end, one character per faction party with power ≥ Mental is dominated → Control Area (Back). Discard = discard down to the hand limit. Remove X is paid at the start of the Draw Phase. Auto-skip phases with nothing to do (option, prev).
	→ {Revise#043} "With special effect or ability" = Phase Rule (database): skip a phase, add an extra phase / turn, change the draw count. {Q#11}
------------------------------------------------------------------------------------------------------------------
11. Skill System
	1. Implement all skill according to rule book. Please breakdown skill and its effect then rewrite to this section.
	→ {Revise#044} Skills (rulebook "特殊能力"; number of cards in the card list in brackets). Each skill = one entry in the Skill Database with its value X and the systems it hooks into.
	   | Skill | Effect | Hooks into |
	   | Draw ±X (1045) | While controlled: Draw Phase draws ±X (totals stack). | Phase |
	   | Charge X (2552) | While controlled: in the Charge Phase you may set up to X cards from the top of your deck (unseen) as power cards (total of all your Charge X). | Phase / Charge |
	   | Capacity ±X (445) | While controlled: hand limit ±X. | Phase / Discard |
	   | Permanent ±X (203) | This character may hold ±X more permanents; over the limit → owner discards down. | Set (Permanent) |
	   | Remove X (57) | While controlled: at the start of your Draw Phase pay X power cards, or it returns to the Active Area. | Phase / Cost |
	   | ▼ Aggressive (1850) | As an Active Character it attacks in the Active Phase (faction check). | Phase / Battle |
	   | Boost X (98) | When attacking, pay up to X extra; a guard must pay the same extra. | Cost / Battle |
	   | Stealth (8) | When it attacks, only a character of the same faction can guard. | Battle (Defense Timing) |
	   | Breakthrough (252) | Can't be guarded by an unbroken character. | Battle |
	   | Intercept (482) | Guard cost −1. | Cost |
	   | Offensive (248) / Defensive (77) / Infinity (6) | Cost goes to hand (Revise#030). | Cost destination |
	   | Initiative (336) | Deals battle damage first; if that defeats the opponent, takes none back. | Battle |
	   | Penetrate (165) | Excess normal damage over the guard's defense carries to the original target (player, or the characters below an Active Character). Not for mental damage or when guarding. | Battle / Damage |
	   | Synchro (203) | Joins another controlled character's attack or guard: attack values are added, each takes damage separately. | Battle (new in v4; was manual) |
	   | Shield (1162) | Takes no damage outside a battle; in a battle it takes damage as usual, from any character (Revise#085). | Damage |
	   | Resist ? (234) | Takes no battle damage from characters of faction / icon ?. | Damage |
	   | Protect ? (95) | Unaffected by Project cards of faction ?. | Targeting |
	   | Bind X (483) | When it would leave the field, put X of its power cards into the Damage Pile to keep it. | Defeated |
	   | Search "name / icon" (148) | (Revise#068, Q#23) Only at the start of your Main Phase (before any other declaration of that Main Phase), as many times as you have Search cards: discard this card from your hand to search your deck: an Event System pop-up shows only the deck cards that match the search condition (the name or class icon written with the skill); the chosen card goes to your hand; then the deck is shuffled. (Revise#062, Q#12) | Phase / Event |
	   | Dual (46) | When this Break card's Set Declaration resolves, it is set even if the required factor is not enough. (Revise#063, Q#12, Q#24: the cost is paid normally) | Set (Break) |
	   | Inherent (4) | Not implemented in v4 (Q#22) — shown as a skill label; on the To-do list (section 21). | — |
	   | Undead (granted by effects) | Not implemented in v4 (Revise#064, Q#12): shown as a skill label only. | — |
------------------------------------------------------------------------------------------------------------------
12. Effect System
	1. Implement all skill according to rule book. Please breakdown skill and its effect then rewrite to this section.
	→ {Revise#070} (Q#25) "Skill" in sections 11–12 means skills like Charge or Draw (section 11). The Effect System is a separate system from the Skill System: effects are card-text actions ("deal 2 damage", "discard 1 Break card"), listed below, with their own database (effects.json). Skills don't use effect entries; each skill has its own handler (20.8).
	→ {Revise#045} Effect System content: An Effect = an action with parameters, used by Effect lines ("1：…"), Abilities, Fast / Project text and Field Effects alike. Effect groups (from 2,049 effect lines + 4,558 ability lines + 1,343 Fast / Project texts in the card list):
	   - Cost: cost goes to hand / damage / deck (Revise#029).
	   - Stat: Mental / Attack / Defense ±X or set to X (for one, all with a condition, until …).
	   - Damage: X normal or (X) mental damage to a character / player / all (with conditions); area damage.
	   - Remove: discard / return to hand / to deck (top, bottom, shuffle) / remove from game — characters, power cards, permanents, Break cards, declarations.
	   - Power cards: move / steal / discard / add from deck or hand; make active / dominate.
	   - Battle: cancel the attack or guard, guard instead, attack again, untap.
	   - Skill: gain / lose a skill or class icon.
	   - Negate / Protect / Restrict: "does not take effect from Project cards", "no damage outside battle", Declaration Bans, cancel a declaration.
	   - Cards: draw, search the deck, pick from discard / damage pile, look at hand.
	   - Move: move / swap characters between areas, set a card directly (Break to the field, character from deck…).
	   - Replace: "instead of …" / "keep on the field by …" (section 14).
	   - Other: shown as "✋ do by hand" with the card text, logged (as before) until it gets its own action.
	   Each effect type: {id, group, parameters (X, target, until, condition), action}. Text → type matching is done once when the database is built, not in the browser (section 15).
------------------------------------------------------------------------------------------------------------------
13. Battle System
	→ {Revise#046} (prev + rulebook) Steps: Attack Declaration (cost) → Guard step (attacked player may guard; Stealth / Breakthrough) → Response (Fast Timing declarations, section 6) → Before battle (triggers) → Battle → After battle (triggers) → end (until-end-of-battle effects end).
	   Battle: both deal damage equal to their attack at the same time (Initiative first). Normal damage ≥ Defense → defeated. Mental damage: a controlled character discards that many power cards (can't → defeated); an Active Character is defeated if mental damage ≥ Mental. Each checked separately. Damage does not stay after the battle.
	   No guard: the player takes the damage (damage check: per point, top card of deck → Character card to the Active Area (named duplicate → Damage Pile), other cards → Damage Pile). Attack on an Active Character: no guard, straight to battle.
	   Shield, Resist, Penetrate, Synchro and "during battle" abilities apply.
------------------------------------------------------------------------------------------------------------------
14. Defeated System
	→ {Revise#047} (prev v3.35) A character is defeated when: battle / effect damage ≥ Defense, mental damage it can't pay, Defense ≤ 0 (checked after every action), or an effect discards it.
	   Before it leaves: if it has Bind X or a "…場合、…場に残す" ability, it waits in the Resolve screen (red outline); its owner chooses Keep (pays) or Let it go. Defense 0 only in battle → keeping works; Defense 0 that lasts (e.g. until end of turn) → it may pay but is defeated anyway.
	   Where the cards go: named cards (Character / Break with a “name”) → Damage Pile when defeated in battle; nameless cards, permanents, power cards → Discard Pile. {Q#14}
	   "Defeated outside battle" by hand stays in the character menu (prev).
------------------------------------------------------------------------------------------------------------------
15. Card Details
	No need to make them as excel file. Please use most efficient way to implement database.
	Read all cards to summarize in below steps.
	1. The database should be implemented from "Field Effect", "Effect" and "Ability" first.
	  Since many card has similar effect.
	  Example of implementation
	  Field Effect: "Break cost returns to hand", "Attack +-X with specific Icon", "Destroy Card with specific Factor"
	  Effect: "Effect cost returns to hand", "Deal X damage on <<1 character>>", "Discard <<1 Break Card>>"
	  Ability: "Mental +-X", "Attack +-(X)", "Attack +-X", "Defense +-X", "Apply field effect 'Break cost of specific icon returns to hand'", "Does not take effect from Project Card", "Does not take Damage outside battle"
	  Skill: Every skills as "Skill System"
	2. Implement all cards and utilize "Database" as written in '1.'
	   Since the amount are huge, design a milestone is OK.
	   Below is the example of implementation.
	   Example: 
		- Character with Skill "Charge 1" and "1: Effect cost return to hand", 
			- Character should use the reference to "Skill Database" where it is "Charge" with number 1. 
			- Link to "Effect cost returns to hand"
		- Break card with Ability "Attack +1 when attacking"
			- Link to "Ability Database" where it is "Attack +-X" with number of +1
		1. Character
		2. Break Card
		3. Fast Card
		4. Project Card
		5. Permanent Card
	→ {Revise#048} Format: one JSON database built by build.py from the card list (data/cardlist.xlsx stays the source, Pack keeps editing it — renamed from cardlist_v03.xlsx, Revise#073):
	   - skills.json: {id, name EN/JP, value type, hooks}.
	   - effects.json: {id, group, params, action, label EN} — the actions of section 12.
	   - abilities.json: {id, kind (always / trigger / during / replace / zone), timing, condition, effect id + params}.
	   - fieldeffects.json: {id, scope, effect id + params, until}.
	   - cards.json: per card {key, type, name, faction, icons, stats, cost, factor, skills: [[skill id, X]], effects: [[cost, effect id, params]], abilities: [[ability id, params]], text JP / EN, status: auto / partial / manual}.
	   Example: Charge 1 + "1: Effect cost returns to hand" → skills [["charge",1]], effects [[1,"cost-to-hand",{}]].
	   The browser only reads the links (no text parsing at play time) → faster, and every card's status can be listed.
	→ {Revise#049} Card list: 8,283 cards (6,103 different texts): Character 2,521 · Break 3,846 · Permanent 571 · Project 685 · Fast 658. Milestones:
	   M1 skills (all cards' skills) + Character / Break stats.
	   M2 Effect lines (2,049) — the common effect types first.
	   M3 Abilities on Characters / Breaks (4,558 lines).
	   M4 Fast / Project texts (1,343).
	   M5 Permanents + the remaining "manual" ones.
	   Each milestone: a status report (auto / partial / manual counts) shown on the site, not as Excel. {Q#15}
	→ {Revise#073} (Pack, 2026-11-04) One card list only: data/cardlist.xlsx (was cardlist_v03.xlsx). Removed: cardlist_classified.xlsx (its only use, the 3,052 old deck keys so old saved decks still import, is now data/old_keys.json), cardlist_completed.xlsx and the finished English-names tool (names/), cardlist_v03_before_skills_fix.xlsx (backup). This file is also published as docs/requirements_v4.html, made from this .md by python3 build.py (the .md stays the one that is edited).
------------------------------------------------------------------------------------------------------------------
16. Additional Explanation about Link between system.
	1. TBD
	→ {Revise#050} Proposed map (one direction = "uses"):
	   Phase System ──controls──▶ Timing System ──allows──▶ Declare System
	   Declare System ──1. pays──▶ Cost System ──destination──▶ Cost Destination Rules (Skill / Ability / Effect / Field Effect)
	   Declare System ──2. targets──▶ Targeting System ──hard choices──▶ Event System
	   Declare System ──3. pushes──▶ Resolve System ──Sub Declarations (Fast Timing)──▶ Declare System
	   Resolve System ──resolves Set──▶ Field (areas) │ ──resolves Effect / Fast / Project──▶ Effect System │ ──resolves Attack──▶ Battle System
	   Battle System ──damage──▶ Defeated System ◀── Effect System (damage / discard) ◀── state check (Defense ≤ 0)
	   Defeated System ──keep?──▶ Event System (Keep / Let it go) ──▶ Skill (Bind) / Ability (replace)
	   Ability System ──triggers on──▶ events of every system (attack, guard, battle, set, dominated, leave, phase…) ──runs──▶ Effect System
	   Field Effect System ──modifies──▶ Stats (Battle), Costs (Cost), Declaration Bans (Timing / Declare), Targets (Targeting)
	   Card Database ──links──▶ Skill / Effect / Ability / Field Effect databases (section 15)
	   Event log (every action is an event) ──replays──▶ the whole state (Undo / Redo, Online, Solo)
	   Optimisation: one event reducer; every rule is data looked up by id; stats / costs / bans computed by one function each from all sources; the state check (Defense ≤ 0, lose conditions) runs once after each event.
------------------------------------------------------------------------------------------------------------------
17. Solo Play
	1. One Deck or Two Deck is available.
	2. One Deck is the same as current version.
	   Two Deck is like Online Play but only with player
	→ {Revise#051} One Deck (prev): choose deck slot, name, go first / second, game rules; every turn is yours; End game / Rename.
	   Two Deck: choose two deck slots (Player 1 / Player 2) and names; one person plays both sides; turns alternate; the Resolve screen asks each side in turn. The view (and hidden information) follows the side whose turn it is, with a button to switch. {Q#16}
------------------------------------------------------------------------------------------------------------------
18. Online Play
	1. Minimum Player = 2 persons, Maximum Player = 4 persons
	2. The field must be separated to 4 quadrants.
		1. 1st quadrant = top right
		2. 2nd quadrant = top left
		3. 3rd quadrant = bottom left
		4. 4th quadrant = bottom right
	3. The order of who starts first must be decided right when the game is started.
	   Assign each player to below position according to who started first.
	   If no player is assigned, no need to show.
		1. 1st player
		2. 2nd player
		3. 3rd player
		4. 4th player
	4. Visualization
		1. Always consider that player is behind the field and look into the field.
		2. Position of player
			1. For 2 players
				1. Player take 3rd and 4th quadrant
				2. Opponent takes 1st quadrant and 2nd quadrant
			2. For 3 players
				1. Player takes 3rd and 4th quadrant
				2. 2nd player takes 2nd quadrant
				3. 3rd player takes 1st quadrant
			3. For 4 players
				1. If player is "1st player", Put "player" to bottom left, "2nd player" to the bottom right, "3rd player" to the top right, "4th player" to the top left.
				2. If player is "2nd player", Put "player" to bottom right, "1st player" to the bottom left, "3rd player" to the top right, "4th player" to the top left.
				3. If player is "3rd player", Put "player" to bottom left, "1st player" to the top right, "2nd player" to the top left, "4th player" to the bottom right.
				4. If player is "4th player", Put "player" to bottom right, "1st player" to the top left, "2nd player" to the top left, "4th player" to the bottom right.
	5. Deck information of every players must be hidden.
	6. Put background to each player's field with different color.
		1. Show color of each player by default but please make them selectable.
			1. The default color for Player is pastel blue. 
			2. The default color for all opponents is pastel red. 
	→ {Revise#052} Room: the creator chooses 2–4 seats; others join with the room code; the game starts when all seats are filled (or the creator starts with the players present, minimum 2). Turn order decided at start (random, or the creator sets it). {Q#17}
	→ {Revise#053} 3–4 players: attack target = any other player; damage, "opponent" and "all players" effects mean every other player; a player who loses (10 damage / empty deck) is removed, their cards leave the game, the last player wins (rulebook). Turn passes in seat order skipping removed players.
	→ {Revise#054} (Q#18) 4 players, you are the 4th player: you take the free bottom position = bottom left; 3rd player bottom right, 1st player top left, 2nd player top right. (Please say if you meant another arrangement.)
	→ {Revise#055} (Q#19) 3 players: you always take the whole bottom (3rd + 4th quadrant); the two opponents take top left and top right in turn order after you (next player → top left, the one after → top right).
	→ {Revise#056} (Q#20) Phones: the table keeps a fixed width (the four quadrants at normal size) and the player scrolls sideways / up-down to see the whole table. The hand panel and the Resolve / control panel stay on screen.
	→ {Revise#057} Colors: each player's field background (pastel blue = you, pastel red = opponents by default), changed in a small settings menu per player; saved on your device only (each player sees their own choice).
------------------------------------------------------------------------------------------------------------------
19. Questions for Pack (implementation of each part waits for the answer)
	Q#01 [ANSWERED → Revise#065] Break card set directly to the field: does it count as a "Broken Character"? Which area does it go to (Control Area Front?), and can it be dominated / attack like a character?
	Q#02 [ANSWERED → Revise#066 (only the cards are hidden; counts stay visible)] "Deck information hidden": hide only the cards (as now — nobody can look into another player's deck), or also the deck COUNT of other players?
	Q#03 [ANSWERED → Revise#058 (game table only)] Previous features NOT in this list — keep them all as they are? Please say "drop" for any you don't want:
	     (a) tabs Card List / Deck Builder (templates, 10 slots, sleeves, import / export) / Discussions / Rules / Changelog — or is v4 only the game table?
	     (b) Undo / Redo of your own last action; log + chat.
	     (c) Hold ON / OFF (both players agree before resolving vs. turn player alone).
	     (d) Game rule "power cards from hand face up / face down"; field effect "power cards visible".
	     (e) Mulligan: re-shuffle the opening hand any number of times (rulebook allows only once, only for players not going first).
	     (f) Auto-skip phases; card sizes S / M / L; draggable windows; phone layout.
	     (g) Manual tools: Adjust stats by hand, "+1 Normal / +1 Special" damage buttons, Area damage, "Defeated in battle / outside battle", "Other effect" by hand.
	     (h) "Test on this computer" rooms (two browser tabs) besides Firebase rooms.
	     (i) The Excel audit / report tools in tools/ (Pack says no Excel for the card database — remove the reports too?).
	Q#04 [ANSWERED → Revise#059 (refund)] Cost before target (as written) — the previous version picked the target first, so you never paid for a declaration with no valid target. OK to change? If there is no valid target after paying, should the declaration be cancelled with the cost refunded, or cost lost?
	Q#05 [ANSWERED → Revise#067 (placed at once, no Resolve screen)] Character Set Declaration through the Resolve screen (can be answered with Fast cards), or placed at once as before?
	Q#06 [ANSWERED → Revise#060 (rulebook)] Fast Timing: (a) any phase of any player, or only Active / Main Phase (rulebook)? (b) "during resolving" = between two resolutions (my reading), OK?
	Q#07 [ANSWERED → owner chooses (Revise#029)] Several cost-destination rules at once (e.g. Infinity + an ability that sends costs to the Damage pile): owner chooses, or a fixed priority?
	Q#08 [ANSWERED → Revise#061 (rulebook)] Offensive / Defensive: "always" (as written) or rulebook wording (Offensive only when attacking a player; Defensive only when guarding a controlled character's attack)?
	Q#09 [ANSWERED → Hold kept; with Hold every player passes (Revise#034)] Hold ON / OFF kept for who must pass in the Resolve screen? With 3–4 players: does every player have to pass, or only the turn player when Hold is OFF?
	Q#10 [ANSWERED → Revise#040] Conditions → Abilities with a condition (one system instead of two). OK?
	Q#11 [ANSWERED → Phase Rules as data, no special test cards] Phase Rule: are there cards you know that skip / add phases or turns (so I test with them)?
	Q#12 [ANSWERED → Revise#062–064 (Search, Dual, Undead); Inherent → Q#22] Skills Search (148 cards), Dual (46), Inherent (4) and the granted "Undead" are not in the rulebook skill list — what do they do (or should they be read from each card's text)?
	Q#13 [ANSWERED 2026-11-06: implement every skill (section 11) and every effect (section 12) — both] Section 12 says "Implement all skill" — I read it as "implement all effects". Correct?
	Q#14 [ANSWERED → only in battle (Revise#047)] Defeated outside battle (by an effect): do named cards also go to the Damage Pile, or only when defeated in battle?
	Q#15 [ANSWERED → the old version stays live until v4 matches it; milestones replaced by section 20.9] Milestones M1–M5 OK? During the rebuild the site would go live after M1 + the table (all old automation re-done on the new database by M4), or should the old version stay live until the rebuild reaches the same level?
	Q#16 [ANSWERED → the other side's hand is hidden while it isn't their turn] Two Deck solo: hide the other side's hand while it isn't their turn (pass-the-device style), or show both hands all the time?
	Q#17 [ANSWERED → coin toss (random) at start] Online 3–4 players: who decides the turn order — random at start, or the room creator?
	Q#18 [ANSWERED → Revise#054] 4-player, you are the 4th player: where do the 1st, 2nd and 3rd players go? (Text repeats "top left" and "4th player".) Suggested: you bottom right, 1st player top left, 2nd player top right, 3rd player bottom left.
	Q#19 [ANSWERED → Revise#055] 3 players: when you are the 2nd or 3rd player, who goes to the 2nd quadrant (top left) and who to the 1st (top right)? Suggested: next player after you → top left, the one after → top right.
	Q#20 [ANSWERED → Revise#056] Phones with 3–4 players: OK to show opponents as smaller strips on top (tap to enlarge) instead of four equal quadrants?
	Q#21 [ANSWERED → Partner / Styles left out] Partner System and Styles are in the rulebook (Rules tab) but were never part of the table — leave them out of v4?
	Q#22 [ANSWERED → not implemented, To-do list (section 21)] Skill Inherent (4 cards): what does it do?
	Q#23 [ANSWERED → Revise#068] Search: may it be used once per Main Phase per card, and only at the START of the Main Phase (before any other declaration), or any time in the Main Phase? Can it be answered (Fast cards) like other declarations?
	Q#24 [ANSWERED → cost paid normally, only the factor is ignored (Revise#063)] Dual: is the cost still paid normally (only the factor is ignored)?
	Q#25 [ANSWERED → Revise#070] (was Q#13, said more simply) Section 12 "Effect System" repeats the sentence of section 11: "Implement all skill according to rule book…". Did you mean: "Implement all EFFECTS (card text actions such as 'deal 2 damage', 'discard 1 Break card') and list them in this section"? Reply yes, or say what section 12 should contain.
	Q#26 [ANSWERED → Revise#071 (yes)] Break card set directly to the field (Revise#065): can it attack, guard and use effects like any Controlled Character? (Suggested: yes.)
	Q#27 [ANSWERED → Revise#079 (strict priority)] Priority (Revise#074): should players answer strictly in priority order (each one in turn: answer or pass), or — as built now — may anyone who is allowed declare while the window is open, with the priority order only shown as "who answers first"?
	Q#28 [ANSWERED → as built (Revise#076)] Synchro (Revise#076): what does joining an attack / guard cost? Built now: the joining character pays its own normal attack / guard cost.
	Q#29 [ANSWERED → Revise#079 (Resolve list)] Triggered abilities (Revise#077): run at once when the owner clicks Run (as in v3 and as built now), or go to the Resolve list so the other players can answer them?
	Q#30 [ANSWERED → Revise#079 (when a card must be taken)] Empty deck (Revise#076): lose as soon as the deck has 0 cards (as built now), or only when you would have to draw from an empty deck?
	Q#31 [ANSWERED → as built (Pack: current is correct)] A3-24 3373 レースクイーン etc. "任意のプレイヤー1人の手札1枚を捨て札": the player who broke it chooses the player — who chooses which hand card? Built: that player chooses their own card. Other options: the breaker picks blind (at random), or the breaker looks and picks.
	Q#32 [ANSWERED → yes, as built] A3-25 3603 ウェザーフォーキャスター "パワーカードをセットされているこのキャラクターをブレイクした": checked when the Break resolves (after its cost is paid). Built: if the Break's cost took this character's last power card, the breaker does not draw. OK?
	Q#33 [ANSWERED → yes, as built] A3-25 3593 etc. "…のネームレベルキャラクターと同じエリアにいる場合": built as the same player's same area — the Active Area, or the Control Area (Front and Back count as one area). OK?
	Q#34 [ANSWERED → yes, as built] A3-20 2676 編入生 etc. "E0のブレイクカードとして使用宣言可能": built as a Break card with factor E.G.O. 1 and cost 0 that keeps its own class icons and printed Mental / Attack / Defense, no name. It is declared at Project timing like a Break card; in the hand and in piles it is a Character card again. OK?
	Q#35 [ANSWERED → Revise#094 (a lower Permanent limit discards permanents; destination rules)] A3-22 3217 スズメ蜂 "パーマネント+Xを無効化し、パーマネント-1を与える": built as the battle opponent's Permanent limit 1 − 1 = 0 during the battle; permanents already on it stay (no discard). OK?
	Q#36 [ANSWERED → 宇 = Eraser (Pack, Revise#104)] A3-EP EP107 ルーンエンジェル隊 カルーア・“マジョラム”: "≪このカード≫は宇1のブレイクカードとして使用可能" — 宇 is not one of the six factor marks (E / 阿 / W / ダ / 極 / イ). Which factor is it (or is it a Galaxy Angel "宇宙" factor that needs a rule of its own)?
	Q#37 [ANSWERED → set for free (Pack, Revise#104)] A3-PR PR346: "このキャラクターにネームに「ブレイブカイザー」を含む…のブレイクカードがセットされた場合、≪あなたの手札のネームに「ブレイブ」を含む…のパーマネントカード1枚≫をこのキャラクターにセットする" — set the permanent for free (no cost, no Permanent limit check), and only if you have one? Built later once confirmed; by hand now.
	Q#38 [ANSWERED 2026-11-06: OK as proposed → Revise#142] A3-12 1756 / 1761 ソラ・エニシダ: "このカードがセットされた場合、≪あなたの任意のあなたの手札のパーマネントカード1枚≫を、コストを支払ってこのキャラクターにセット宣言可能。そのカードは必要ファクターを無視してセットされる" — a real declaration (it goes on the Resolve list, others may respond, you pay in the pay window), or set at once after paying?
	Q#39 [ANSWERED 2026-11-06: OK as proposed → Revise#142] A3-13 1890 / 1893: "このキャラクターに与えられたバトル以外のダメージは、≪そのダメージを与えたカードもしくはキャラクターのオーナー≫が代わりに受ける。その後、そのプレイヤーにXダメージを与える" and its effects on "バトル以外のダメージを与える効果を持つエフェクト / プロジェクトカード・ファストカード" — may "an effect that deals non-battle damage" be read from the card data (any effect whose text deals damage)? And is the X damage after the redirected damage in addition to it?
	Q#40 [ANSWERED 2026-11-06: OK as proposed → Revise#142] A3-14 1916 / 1925 G-ブレイブカイザー: the merge — when it battles, you choose any of your other Machine Controlled Characters that didn't declare an attack / guard, mill that many cards, add their Mental / Attack / Defense to it and it gets their skills; battle damage is also dealt to each chosen character. Is the same damage dealt to each of them in full (not split)?
	Q#41 [ANSWERED 2026-11-06: OK as proposed → Revise#142] A3-14 2025 / 2034 / 2063 エラキス: when an opponent's Controlled Character attacks you and you meet its factor, you may set it from your hand as a Controlled Character "paying its cost" — paid from your Controlled Characters as usual (the pay window)? Then every attack is cancelled and it battles all those attackers (like a guard), taking no battle damage. Right?
	Q#42 [ANSWERED 2026-11-06: OK as proposed → Revise#142] A3-15 2132 / 2137 / 2154 クレア・コラプサー: "≪あなたの対戦相手が使用した、このキャラクターを対象に含むプロジェクトカードまたはファストカード≫を捨て札する。その後、…X枚…パワーカードとして…" — automatic each time (the card is discarded instead of having its effect), or only sometimes? Lasting (持続) cards are those that stay on the field; instant (瞬間) ones go to the Discard Pile when they resolve — OK?
	Q#43 [ANSWERED 2026-11-06 → Revise#145: every attacker is declared first; the guards are resolved one by one; an event screen shows all attackers vs the characters that can guard; each character guards only once in the group] Several attacks at once — A3-16 2169 / 2179 (up to X of your Controlled Characters attack the same target with it, free), 2278 / 2288 / 2318 (any number attack or guard with it), A3-19 2655 / 2662 (Synchro joins in any number; that player's Mental-0 Controlled Characters must guard it): "アタック宣言されたプレイヤーは、それぞれのアタック宣言に対してガード宣言可能". Proposal: each extra character makes its own attack on the same target right after (one battle each, each with its own guard step); 2169's are free, 2278's pay their own Attack Cost.
	Q#44 [ANSWERED 2026-11-06: OK as proposed → Revise#145] A3-16 2250 / 2260: "≪このキャラクターを対象に含む、あなたが使用するプロジェクトカード・ファストカード・エフェクト≫のコストに+Xする" — here the target is chosen after paying. Proposal: when you choose it as a target, you pay X more power cards right then (or the target can't be chosen).
	Q#45 [ANSWERED 2026-11-06: OK as proposed → Revise#145] A3-19 2540: "≪バトル相手のキャラクター≫に3回同時にダメージを与える" — Proposal: its battle damage is dealt as 3 separate hits at the same time; each hit is checked against Defense on its own and each needs its own Bind / keep.
	Q#46 [ANSWERED 2026-11-06: OK as proposed → Revise#146] A3-18 2448 / 2453: nullify (1) the text of every card in Damage and Discard Piles, (2) texts that act on cards there, (3) texts that count the Damage Pile, (4) during the Main Phase, texts that act on cards in a deck. Proposal: (1) and (3) automatic (cards there have no text; "X = Damage Pile cards" counts 0); (2) / (4) = effects whose steps take from or look at those zones do nothing. Lose by 10+ Damage Pile cards still applies (a rule, not a text). OK?
	Q#47 [ANSWERED 2026-11-06: OK; discard down every time a hand grows; abilities don't count as the player's own effect → Revise#146] A3-18 2464 / 2469 テミス: players over the hand limit discard down at once; a player who adds cards to their hand with their own effect takes that much damage; a player who discards hand cards takes that much damage. Proposal: draws in the Draw Phase don't count as "own effect"; discarding down to the limit (this card or the Discard Phase) does count. OK?
	Q#48 [ANSWERED 2026-11-06: OK as proposed → Revise#146] A3-18 2480 / 2485 バロール: "≪このキャラクター≫に次に与えられるダメージは…支配キャラクター1人に与えられる" / change the target of a Project / Fast card or effect to another legal one / discard a card being declared. Proposal: the new target is chosen from the same kind of legal targets; "next damage" = the next damage event of any kind until the end of the Main Phase.
	Q#49 [ANSWERED 2026-11-06: OK as proposed → Revise#146] A3-19 2521 / 2528: name a Break / Character card on the field, in a Damage Pile or your hand; this character gets its classes, skills, effects and abilities, counts as its faction and gets 1 of its factor while that card stays there (a card in your hand stays shown). Proposal: as written; when the card moves anywhere else the copy ends.
	Q#50 [ANSWERED 2026-11-06: OK; the owner picks the name from a window of that player's non-Character cards → Revise#146] A3-20 2686: opponents declare non-Character cards face down after paying; you may name a card and pay 1 from this character: right → that card is discarded; wrong → (X) damage to this character (X = …) and it goes on normally. Proposal: a face-down step after paying, every time (the owner of 2686 is asked "Name it?").
	Q#51 [ANSWERED 2026-11-06: OK; the attack goes to one of 2757's opponents → Revise#146] A3-20 2757 / 2772 人形使い: the target is also treated as your Controlled Character until the end of the Main Phase; you may pay its Attack / Guard / effect costs only from this character; nothing can be set on it. Proposal: you may declare its attacks, guards and effects (its owner still owns it); its costs come from 人形使い.
	Q#52 [ANSWERED 2026-11-06: OK as proposed → Revise#146] A3-20 2759 メルキオール: Project cards at fast timing and Project cards from your Damage Pile, paying only from this character. Proposal: both declarations are offered with only this character in the pay list.
	Q#53 [ANSWERED 2026-11-06: OK as proposed → Revise#145] A3-20 2794 レイ・アルカード: "≪あなたの任意のブレイクカード1枚≫を捨て札可能" — which Break card: from your hand, or a Break card of one of your characters on the field? Proposal: from your hand.
	Q#54 [ANSWERED 2026-11-06: OK as proposed → Revise#146] A3-20 2864 / 2879 メアリー・ピュア: a Permanent among the cost paid from this character may be declared (factor ignored, paying its cost; that cost back to the hand) onto your Controlled Character. Proposal: offered right after the payment, as a real declaration (like Q#38).
	Q#55 [ANSWERED 2026-11-06: OK — build each as written → Revise#150] Long texts I'd like to confirm before building — A3-16 2199, 2253 (forced guard), 2277 / 2287, 2279 / 2289 (no damage check: hand cards revealed instead), A3-17 2356 / 2362 (no response if the cost came only from it), 2371 / 2377 (its abilities affect only others' characters), A3-18 2418 / 2423 (named faction), A3-20 2721 / 2736 (13 different named Break cards: 32 / 48 damage), 2865 (sets itself from the damage check), 2867 / 2880 (Machine skills, designations). Proposal: build each exactly as written, one by one, and report the readings in the notes. OK?
	Q#56 [ANSWERED 2026-11-06: count each Initiative given to the character — some cards print it twice (A3-17 2333) → Revise#155] A3-24 3394 / 3406 東海林光: "このキャラクターがイニシアチブを3つ以上持つ場合、≪このキャラクター≫はガードされない". The engine treats a skill as on/off, so it cannot count Initiatives. Proposal: count each source that gives this character Initiative — each card of it that prints Initiative (top, under-cards, Permanents) and each ability / effect that grants it. 3 or more → it can't be guarded. OK?
	Q#57 [ANSWERED 2026-11-06: OK → Revise#155] A3-24 3461 / 3462: "…このキャラクターは、そのキャラクターと同時にバトルすることが可能。その際、≪バトル相手とバトルするあなたの支配キャラクター全て≫は、スキルを共有し、攻撃力を合計して判定する。…耐久力を合計した数値未満の通常ダメージは無効化され、精神ダメージはそれぞれのキャラクターに与えられる". Proposal: when your other character guards (3461) / battles (3462), you are asked "join with 3461?" (no cost; mill 1). Both are on your side of the battle like Synchro: shared skills, Attack added; normal damage to them is cancelled unless it reaches their total Defense — then each of them takes it in full (as Synchro does); mental damage goes to each. OK?
	Q#58 [ANSWERED 2026-11-06: OK → Revise#155] A3-24 3537 ロュス・アルタイル: (a) "≪あなた≫は、プロジェクトカード・ファストカード・エフェクトが効果を発揮する際に、そのカードの対象を適正な対象に変更することが可能" and (b) "あなた、またはあなたの支配キャラクターを対象に含むプロジェクトカードが効果を発揮する際、≪その…あなたの任意のプレイヤー全てと、あなたの任意のキャラクター全て≫はそのカードの効果を受けない". Proposal: (a) whenever any Project / Fast card or effect with targets is about to resolve, its owner is asked "change the targets?" and may pick other valid targets (the usual target rules); (b) when a Project card that targets you or your Controlled Characters resolves, you pick which of those targets ignore it (default: all of yours if the card is an opponent's, none if it is yours). Each question is asked only while the condition (“ロュス・アルタイル” below) holds. OK?
	Q#59 [ANSWERED 2026-11-06: OK → Revise#155] A3-25 3616: "≪あなた以外のプレイヤー全て≫は、手札からカードを使用宣言する場合、追加でXコストを支払わなければならない。追加のコストを支払う場合、代わりに、そのカードの本来のコスト分、自分のデッキを捨て札することが可能". Built now: +X (its power) on every card the opponents declare. Proposal for the second sentence: at the pay step of such a card, a button "Mill N instead of the extra X" (N = the card's printed cost) replaces the extra X. OK?
	Q#60 [ANSWERED] A3-25 3756 ザラーム: during its extra turn (1) X is the live power of ザラーム (it changes with its power cards), (2) no card may be used from any hand, (3) every cost may be paid only by Named characters whose power ≥ X. Pack: "1. No, X changes depending on ザラーム's real time power card. 2. Yes 3. Yes". Done in Revise#157 (AA4.turnLock / AA4.lockNoPay).
	Q#61 [ANSWERED 2026-11-06: OK] A3-EP EP184 冒険者 ファーマー ♀: "レアリティまたはエキスパンション名を1つ指定" — the list has no expansion name for most cards, so the table offers the series (A3-EP, A3-17 …) and every rarity printed in the card list. Proposal: OK as built — or tell us the expansion names you want to choose from.
	Q#62 [ANSWERED 2026-11-06: as built — when it battles a character with Permanent cards, they are discarded; if any were, ±0/+(2)/+2 from the start of that battle to its end] A3-EP EP222: "≪このキャラクターのバトル相手にセットされているパーマネントカード全て≫を捨て札する。…バトル終了時まで、このキャラクターに±0/+(2)/+2して判定する" has no "…場合" — built as: when this character's battle starts. Proposal: OK as built.
	Q#63 [ANSWERED] M2g: 27 special-set Break cards are left to play by hand for now, because each needs a mechanism the table does not have yet — a card used as a Fast card from the hand (EX0223, EX0228, EX0232, EXPP023), forced battles / forced guards (EX0136, EX0137), tokens attacking together (EX0155), damage-replacement prompts (EX0164, EX0378), Install Permanents that change stats (EX0192), and single cards (EX0231, EX0238, EX0250, EX0256, EX0384, EX0389, EX0390, EX0402, EX0505, EX0515, EX0524, EXPP024, EXPP025, EXPR037, EXPR046, EXPR058, PP117). Proposal: go on with M3a now and come back to these 27 in a later clean-up batch. — Answer (Pack, 2026-11-07): "Go for M2g to complete first." Design confirmed — Q-A "Yes" (a card used "as a Fast card" pays its printed cost and needs its printed factor), Q-B "Yes" (the forced guard costs nothing, even after the character acted), single cards "follow Proposal. We may revise later.", Q-F1 "Yes" (EXPR037: on while any opponent's Project / Fast / effect result is in force), Q-F2 "Yes" (EXPR046: the effect costs exactly X = the number of Permanents and deals X), Q-F3 "No, just one time" (EXPR058), Q-F4 "No, only all of "Break Card" and "Character Card". Power Cards and Permanent should go to Discard Pile." (PP117). Built in Revise#161.
	Q#64 [ANSWERED] Revise#162: triggered abilities now run at once without a question, as asked. That includes the optional ones ("…することができる / …可能"), e.g. "あなたのデッキの上からカードを1枚引き、パワーカードとして≪このキャラクター≫にセット可能" now always sets the power card. Proposal: keep it so; if a few optional abilities should still ask Yes / No, name them (or say "all optional ones") and they will get a Yes / No event pop-up. — Answer (Pack, 2026-11-07): "Make a Player option to make it adjustable. By default you should ask." Built in Revise#165: an optional ability asks Run / Skip in an event pop-up; Player options → "Run optional abilities without asking" (OFF by default) runs them at once.
	Q#65 [ANSWERED] Mental damage and Bind (Pack's bug report, Revise#163). Now: mental damage on a Controlled Character discards that many of its power cards; if it has fewer, all of them are discarded and it is defeated; then Bind X may keep it by putting X power cards into the Damage Pile — but there are none left, so Bind can't be used (that is why A3-24 3465 could not Bind). An Active Character is defeated when mental damage ≥ its Mental. Pack's rule: if there are not enough power cards, none are removed and the character is defeated; a character with Bind is not defeated and loses no power card by mental damage. Proposal: (1) mental damage ≤ power → discard that many power cards; > power → discard none, defeated. (2) A character with Bind (any X) ignores mental damage: no power card lost, not defeated. (3) Bind X stays as it is for every other way of leaving the field (normal damage, effects): put X power cards into the Damage Pile to keep it. (4) Active Characters: as now (mental ≥ Mental → defeated), Bind protects them too. — Answer (Pack, 2026-11-07): "1. OK 2. Only in case it is defeated. 3. yes 4. yes" Built in Revise#165.
	Q#66 [ANSWERED] A3-23 has joke cards whose text can't be played by the table (e.g. 3336 "目標の≪プレイヤー1人≫にデコピンする", 3341 birthdays, 3344 / 3345 ages and clothes, 3350 sleeves made by Broccoli, 3351 colours). Proposal: they stay "by hand" for good and are not counted in M3f's "cards to do". — Answer (Pack, 2026-11-07): "Add outlaw option to activate it. make it automatic" Built in Revise#165: Outlaw → "Fool text".
	Q#67 [OPEN] 瞬間 (instant) Project / Fast cards that change a stat with no duration, e.g. A3-EX04 EX0454 "≪“トーマ・アヴェニール”以外のキャラクター全て≫に-X/-X/-Xする" and EX0469 "目標の耐久力に-1する": how long does the change last — until end of turn, until end of the Main Phase, or until the character leaves the field? (持続 cards are read as "while the card stays", Revise#208.) Until answered, these lines stay by hand.
	Q#68 [ANSWERED] (Pack: (a) — Kiriko had Penetrate from A4-01 0116; done in Revise#218) Penetrate in Pack's battle: “Chimera Beastman ‘Kiriko’” (Attack 15) attacked Player 2, and “Dragon Lord ‘Sophie Rastaban’” (Defense 7) guarded. Pack expected Player 2 to take 15 − 7 = 8. The table works this out only when the ATTACKER has Penetrate (rule book: “ガード側では働かない”). In the screenshot, Penetrate is on Sophie (the guard), not on Kiriko. A Revise#214 test shows that the attacker's Penetrate does send the extra damage to the attacked player. Question: should Kiriko have had Penetrate there (for example from her Permanent card)? Or should a guard's Penetrate also count? If so, against whom: its damage beyond the attacker's Defense to the attacker's player?
==================================================================================================================
20. Backbone design (priority before card details — Pack, 2026-11-04)
	→ {Revise#069} Goal: make the engine strong enough that adding or fixing a card is only DATA (database entries), never new engine code. Card coverage comes after the backbone.

	20.1 Layers (each one only talks to the one below it)
	   UI (render, input, highlights)
	     ↓ asks "what may I do?" / sends intents
	   Projection (what one viewer may see: hides other hands, deck order, face-down power cards)
	     ↓
	   Rules engine (pure functions, no screen, no network): state + intent → new state + game events
	     ↓ looks up
	   Rule database (skills / effects / abilities / field effects / selectors / cards — built by build.py)
	   Transport (Solo / test room / Firebase) only stores and replays the list of intents.
	   → The engine runs headless (in Node) for tests; today it only runs inside the page.

	20.2 State (one plain object, saved and replayed)
	   cards: every card instance {id, key, owner, place, faceUp, visibleTo}
	   piles per player: deck / hand / discard / damage / removed; areas: Active (6 slots) / Control Front / Control Back / Special
	   characters: {stack [card ids], power [card ids], permanents [card ids], row, flags (tapped, attacks this turn …)}
	   turn: {seat order, turn player, phase, step, turn number, removed players}
	   stack: the Resolve list (declarations, triggers); window: who may act now (20.5); decisions: pending choices (20.6)
	   modifiers: every continuous effect (20.4); rng: seed + counter (the same shuffle on every device)
	   → Invariant checked after every event in test / debug mode: each card is in exactly one place, card counts match the decks, no character without a base card.

	20.3 One pipeline for every action
	   Intent (from a player: declare / pay / target / pass / choose / move by hand) → check with legalActions() → apply → run the operation queue until a player must decide → state check (Defense ≤ 0, lose conditions) → game events → triggers → done.
	   legalActions(state, seat) is the ONLY answer to "can I do this?". The UI uses it for the yellow / blue highlights and greyed buttons (with the reason, e.g. "Attack banned by 「X」"); the engine uses it to refuse illegal intents online. (In v3 the UI and the engine checked separately — the cause of several past bugs.)
	   Operations = small atomic steps (move card, pay power, deal damage, open window, ask decision, resolve top …). A long action (a battle, a declaration) is a queue of operations, so it can pause for a choice and continue — no special code per case.

	20.4 Query pipeline (continuous effects)
	   Every value that can change is asked through one function: value(state, object, key) — Mental / Attack / Defense / skills / icons / faction / costs / hand limit / permanent limit / can-declare / can-be-targeted …
	   Order: printed card → top of the Break stack → permanents → modifiers in time order (add, set, grant, remove, ban) → limits (not below 0 …).
	   Modifier = {source, appliesTo (selector, 20.7), key, op, value, duration (instant / battle / main phase / turn / while the source is on the field / until removed), condition}.
	   Field effects, always-on abilities, conditions ("…場合") and Declaration Bans are all modifiers. Results are cached per state version (no recomputing on every redraw).

	20.5 Timing windows and priority
	   Window = {kinds allowed (Fast / Project / Attack / Defense / Search), who may act in priority order (rulebook: whose turn comes next first; the attacked player first), who has passed}.
	   Phase steps open windows; each resolution opens a new one; Hold ON / OFF decides who must pass. Fast / Project / Attack / Defense Timing (section 3) are only window rules — no timing checks spread through the code.

	20.6 Decisions (Event System)
	   When the engine needs a choice it adds a decision {who, kind (cards / target / faction / area / player / yes-no / number / order), options, min / max, reason} and pauses. One generic pop-up shows it; the answer is an intent. If there is only one option and "auto" is allowed, it is chosen automatically.
	   Used for: targets, cost payment, cost destination (several rules → owner chooses), Keep / Let it go, Search, "may" abilities, order of triggers that happen together.

	20.7 Selector language (one filter for everything)
	   {type, owner (you / opponent / any / N-th player), place / area, icons, faction, name, named?, broken?, controlled?, active?, stat compare (Mental ≤ 2 …), power count, in battle?, declaration kind …}
	   Used by: targets, field-effect scope, conditions, Break restrictions, Search conditions, Protect / Resist, ban scopes. Each ≪target≫ text is turned into a selector ONCE when the database is built.

	20.8 Effects, abilities, replacements as data
	   Effect = list of steps {action (about 30 primitives: damage, stat, move, pay, draw, search, ban, grant skill, retarget, cancel declaration …), selector, params (X, until), condition}.
	   Ability = {kind (always / trigger / during battle / replacement / zone), when (game event + selector), condition, effect}.
	   Game events from the engine (card moved, set, declared, resolved, attacked, guarded, battle start / end, damaged, defeated, dominated, phase start / end …) are what triggers listen to.
	   Replacement layer: before "leave the field", "take damage", "cost goes to discard" and "factor check" the engine asks the replacements (Bind, "場に残す", cost destinations, named → damage pile, Dual) — one place for every "instead" rule.
	   Skills (separate from effects, Revise#070) = handlers that create modifiers / replacements / window rules (e.g. Intercept = guard-cost modifier −1; Offensive = cost destination; Stealth = Defense-window rule; Search = a Main-Phase-start window action).

	20.9 Build order (replaces M1–M5 of Revise#049; the old site stays live until v4 matches it)
	   B1 State, intents, event log, seeded shuffle, piles / areas, invariants, headless test runner + scenario tests (a script of intents → expected state).
	   B2 Turn / phases / windows / priority / legalActions / declaration state machine (draft → paid → targeted → declared → resolved, or cancelled with refund) / Resolve list one at a time / Cost screen.
	   B3 Query pipeline + modifiers + field effects + Declaration Bans.
	   B4 Battle steps, damage, defeated, state check, replacement layer.
	   B5 Game events + triggers + decisions (Event System pop-up).
	   B6 Selector language + effect primitives + build-time compiler from the card list + Skill Database (all rulebook skills, Search, Dual).
	   B7 New table UI on the projection: Solo (one / two deck), Online 2–4 players, quadrant layout, colors, phones (fixed width, scroll).
	   Then card coverage: C1 effect lines, C2 abilities, C3 Fast / Project, C4 permanents and the rest — each with an on-site coverage report.
	→ {Revise#072} B1 done (2026-11-04). Where it is and what was decided while building it:
	   - Code: src/engine/*.js (namespace AA4; runs in the page and in Node). Not part of the site build yet — the v3.36 table stays live (Q#15); B7 switches the table over.
	   - Tests: node tests/engine/run.js — unit tests, scenario scripts (tests/engine/scenarios/*.json: intents → expected state), fuzz games for 2–4 players and Solo two-deck with invariants after every operation, replay check, one game with real cards from the card list.
	   - Room flow: create (seed, mode online / solo1 / solo2, seats 2–4) → join (seat = join order) → starts by itself when every seat is filled, or the creator starts early with ≥ 2 → coin toss for the turn order (Q#17) → every deck shuffled, 7 cards → keep / re-shuffle (as before: any player, any number of times) → Turn 1, Draw Phase of the 1st player.
	   - Seeded shuffle: the seed is in the first log entry; number n of the random sequence depends only on (seed, n), so every device gets the same shuffles and Undo just replays fewer of them.
	   - Card ids = seat + position in the joined deck list ("0-12"). Every container lists cards bottom → top (deck top = last).
	   - Active Area has a 7th slot "none" for a character without a faction (only shown when used, as in v3). All 8,283 cards in the list have a faction, so it is a safety net.
	   - The table only checks that deck cards exist and are playable types; deck-building rules (50–60 cards, 4 copies) stay in the Deck Builder.
	   - B1 by-hand tools (the base of Q#03 g): move a card (piles, Special Area, new character, Break / power card / permanent onto your character), move a character, shuffle, draw. If the last card of a character's stack leaves by hand, its power cards and permanents go to the Discard Pile (B4 replaces this with the Defeated System).
	   - Undo / Redo as before: your own latest action, while nobody else has acted since (chat doesn't count). Join, start, re-shuffle and keep can't be undone.
	   - Hidden information is decided in one place (projection): other hands, every deck (counts stay visible, Revise#066), power cards from the deck; the seed is not shown.
	→ {Revise#074} B2 done (2026-11-04) — turn, phases, timing, declarations, Resolve, Cost (src/engine/11-turn.js, 12-declare.js):
	   - Phases run by themselves where nobody has a choice: Draw (Remove X first, then the draw) → Active; the Discard Phase ends the turn by itself (a choice when over the hand limit). The turn player presses Next in the Active (after the faction check), Main and Charge Phase.
	   - Charge: hand card → power card of a Controlled Character or a top Active Character, ≤ Mental; deck top (unseen) up to the Charge total per turn; end of the phase: dominate (Revise#042).
	   - Declarations: declare → pay → target → Resolve list (Revise#012); Cancel before it enters = refund (Revise#059). "No valid target" / "not enough power" / the timing / a ban are told before anything is paid. Character cards are placed at once (Revise#067). Break on your own Control Area (Back) character also moves it to the Front (prev).
	   - Resolve: the newest item resolves when every player who must pass has passed; passes reset after every resolution (Revise#034). Hold ON is the default; all Hold OFF → only the turn player passes. Priority order (Revise#035) is worked out and shown, but not forced {Q#27}.
	   - Cost screen: paid cards are shown to everyone; when the declaration is complete they go where the Cost Destination Rules say (one rule → automatic, several → the owner chooses, none → Discard Pile).
	→ {Revise#075} B3 done — query pipeline (src/engine/10-query.js): every stat / skill / cost / limit / ban is asked through one function; modifiers last until end of battle / main phase / turn / while the source is on the field / until removed; a Fast / Project card with a lasting effect stays in the Special Area until its effect ends. Field effects by hand (+ / −) and Declaration Bans with the reason ("Banned by 「X」"). "Power cards visible" needs every player's agreement.
	→ {Revise#076} B4 done — battle, damage, Defeated System, state check (src/engine/14-battle.js):
	   - Battle steps as Revise#046; the attacked player's Guard step comes first (any other answer is only possible after it). In the Active Phase the turn player may guard the ▼ attacks.
	   - Mental damage to a player runs the damage check like normal damage (Revise#092; it went straight to the Damage Pile before). Penetrate also reaches the character below when you attack your own Active Character. Synchro: a character with Synchro joins its side during the response step and pays its own attack / guard cost {Q#28}.
	   - Keep / Let it go (Bind X and "…場に残す" abilities) is a choice for the owner; Defense 0 that lasts → defeated anyway.
	   - Lose: 10 cards in the Damage Pile or an empty deck, checked after every action {Q#30}. 3–4 players: the loser's cards leave the game, their declarations and battles end, turns skip them; the last player wins.
	→ {Revise#077} B5 done — events, triggers, decisions (src/engine/13-events.js): one choice engine for every pick (cards, yes / no, one of several, Keep, cost destination, discard down, Search …); only the chooser sees the options. Triggered abilities wait for Run / Skip by their owner (or run at once when there is nothing to choose) and run when Run is clicked {Q#29}. Moving a card by hand does not trigger "enters the field" abilities.
	→ {Revise#078} B6 done — selectors, effect primitives, compiler, Skill Database (src/engine/15–17, tools/rules_compile.py):
	   - build.py compiles every card once into dist/…/assets/rules.js (stats, factor, icons, name, skills, effect lines, Fast / Project text, Break restrictions, Keep and simple always-on abilities). The engine only reads these links.
	   - First coverage (python3 build.py prints it): effect lines 797 auto / 280 partial / 972 by hand; Fast / Project 117 / 329 / 897; Characters 1,953 of 2,521 fully automatic. What the compiler can't read yet stays "✋ do by hand" with the card text, as before. C1–C4 add patterns to the compiler only.
	   - All rulebook skills plus Search and Dual are handled (Inherent / Undead: labels only, section 21). Search shows only the deck cards with that personal name / faction + card type / skill.
	   - Tests: node tests/engine/run.js (88 tests since Revise#079, including random legal games for 1–4 players with the test cards and with real decks from the card list; invariants after every operation; replay check).
	→ {Revise#079} (Pack, 2026-11-04: Q#27–Q#30)
	   - Q#27 Strict priority: while a declaration or a battle waits for answers, only the player with priority may answer (Fast timing) or pass, in the order of Revise#035 (the attacked player first; the declarer of the newest item last). With nothing waiting, only the turn player declares; the others answer. Players with Hold OFF are skipped. Replaces "shown, but not forced" in Revise#074.
	   - Q#28 Synchro: as built — the joining character pays its own attack / guard cost.
	   - Q#29 A triggered ability that its owner Runs goes on the Resolve list, so the other players can answer it; it resolves like any declaration. Triggers that are not optional and need no choice still run at once (Revise#039).
	   - Q#30 An empty deck alone doesn't lose: a player loses when they must take a card from an empty deck (draw, damage check). Replaces "an empty deck" in Revise#076.
	→ {Revise#080} B7 first version (2026-11-04) — the new table screen: table.html (src/table4/, built into dist/…/table.html). index.html and its v3.36 table are not changed (Q#15); the new page sits next to them and uses the same Deck Builder slots, card images, sleeves and Firebase project.
	   - Lobby: Solo one deck (go first / second), Solo two decks (you play both sides; the view follows the side that has to act, "View" button to switch; the other side's hand is hidden, Q#16), Online room for 2–4 players (code starting with "4", Firebase rooms/<code>/log), Test room on this computer (two tabs), join / watch by code, continue the last solo game.
	   - The screen draws only the engine's projection; clickable things come from the engine's legal actions (pastel-yellow = playable, running blue = valid target, running orange = source of a field effect, red outline = waiting to be kept or defeated). Left click = declare / choose (a menu when there are several actions), right click / long press = card details with the by-hand tools.
	   - Quadrant layout: 2 players top / bottom, 3 players as Revise#055, 4 players as §18.4 + Revise#054; boards at the top are drawn with their Active Area towards the middle. Field colours per player (default pastel blue you / pastel red opponents), saved on this device (Revise#057).
	   - Right column: turn / phase / who acts, Resolve box (battle steps, Resolve list newest on top, who has passed and who answers now, Cost screen), pay / target / cancel, triggers Run / Skip, Next (greyed with the reason), Undo / Redo, Hold, card size S / M / L, Field effects (− ends one, + adds one by hand), log + chat. Choices open one pop-up (only the chooser sees the options).
	   - Phones (Revise#056): the table keeps its width and scrolls; the hand and the Resolve / controls stay docked at the bottom.
	   - Tests: node tests/table_ui.js (after python3 build.py) plays Solo, a two-tab room, a 4-player room, a phone screen and a full attack through the screen.
	   - Not in this first version yet: the auto-skip option, the v3 shortcut buttons for damage by hand (+1 Normal / +1 Special, area damage — field effects and card moves by hand are there), dragging cards on the board.
→ {Revise#081} Main site (Pack, 2026-11-04: "merge v4 table on the main site first") — the v4 table is tab "8. Game Table v4" on index.html. The tab shows table.html in a frame that loads only when the tab is first opened; invite links open as index.html#table/<room code>. Tabs 1–7 and the v3.36 table (Solo Test / Play Online) are not changed. table.html still works on its own.
→ {Revise#082} C1 / C2 first pass (2026-11-04) — the compiler reads more effect lines and Character / Break abilities:
   - Several targets in one line (e.g. "≪キャラクター1人≫と≪プレイヤー1人≫"): chosen in the order of the card text, one part after the other.
   - Battle words: the attacked player, the battle opponent and its owner, the guarding character, "アタック宣言またはガード宣言したキャラクター".
   - Damage Pile / Discard Pile picks ("あなたのダメージ置き場のカードN枚", "…全て", "まで"): the player chooses the cards when the effect resolves; they go to the hand or the Discard Pile.
   - Your deck: Search by name / faction / card type (the deck is shuffled after), the top N cards to the Discard Pile.
   - "このキャラクターにセットされているパワーカード全て", "パワー0のキャラクター", stat / power / cost with "X", "…までの間" lengths (battle / turn / Main Phase), delayed effects ("このターンの終了時"), extra turns, cost destinations, conditions (attacking, guarding, power, below a named card).
   - Coverage now: effect lines 1,082 auto / 312 partial / 655 by hand (B6: 797 / 280 / 972); Characters 2,218 of 2,521 fully automatic (B6: 1,953); Breaks 1,390 of 3,846.
   - Coverage page (Revise#049): coverage.html shows the numbers and every card with its status and the lines still done by hand, with search and filters. Linked from the table's lobby.
→ {Revise#083} Table fixes (Pack, 2026-11-04, 12 points):
   1. Auto-skip (table option, ON by default, button "Auto-skip" during the game): the Active Phase goes on to the Main Phase when the faction check is over and nothing waits; the Charge Phase ends when nothing more can be charged.
   2. Charge as v3: hand cards and Deck cards are picked into the Charge window, then set one by one (the first one in the window) on the character clicked. Every hand card can be picked. From the Deck: up to the Charge total of the Controlled Characters, shown on the Deck as ⚡ left / total. From the hand: face up (table option, ON by default); from the Deck: face down. Power cards are drawn as small cards under the character (hover to enlarge). Characters that can take a power card are highlighted in the Charge Phase.
   3. A Break card can't be declared without its factor (Dual excepted, Revise#063); the factor is checked again when it resolves — missing → Discard Pile.
   4. Areas are centred. An Active Area faction party is stacked: the characters below the top one peek out to the top right, each one can be clicked or targeted (hover shows it whole).
   5. Cost: exactly as many power cards as the cost → paid at once (table option "Auto-pay", ON by default); more → a pop-up shows the power cards to choose.
   6. Card structure: Character → Break #1 → Break #2 …, the newest Break card on top; the cards below peek out to the top right. Clicking the character → Card details with the structure, the power cards and the permanents (each one can be opened).
   7. Damage Pile / Discard Pile: click the pile to see its cards (newest first; click a card for its details).
   8. Undo / Redo (and Hold, Auto-skip, Auto-pay, card size) stay at the top of the right column.
   9. Clicking a character with actions shows them plus "Card details"; with none, the details open at once.
   10. By hand: one drop-down list with the actions grouped (The character · Hand / Deck · Piles and areas · Onto a character · As a new character), then "Do it".
   11. The log shows English card names (the Japanese name when a card has none).
   12. Battles are logged in detail (each side's Attack / Defense / power or Mental, Initiative, the damage and the result), with a "Last battle" box in the Resolve area. Damage that is not dealt says why — e.g. Shield: "takes no damage except battle damage from an opponent's character", so in a faction check (a ▼ character attacks its own player) or against your own Active Character, a Shield character takes no damage (A3-09 1466 Snakey vs A3-10 1570 Chimera: both have Shield → "No damage" on both sides).
   - Deck menu (click your Deck) → By hand: Shuffle, Draw 1, +1 Normal damage (damage check: a Character card → Active Area, others → Damage Pile), +1 Special damage (→ Damage Pile) — the v3 shortcut buttons (Pack, 2026-11-04). Solo Test (6) and Play Online (7) stay until v4 has everything they have (Q#15).
   - Also fixed: two log entries of one device sent in the same millisecond could be replayed in the wrong order (a join before the room was created).
→ {Revise#084} (Pack, 2026-11-04)
   - Gained effects: "<condition>、≪このキャラクター≫は<skills>を得、エフェクト「N:…」を得る。" is read by the compiler — the skills and the whole effect line are given to the character while the condition holds, and the effect can be declared like its own (menu: "Gained effect …"; Card details: "Gained effect"). E.g. A3-17 2400 女皇竜“ィアーリス” with 女帝竜“ィアーリス” under it: Infinity and "X: X damage to ≪1 character or player≫". "このカードの下に「X」がある場合" = X anywhere below this card in the structure. X effects can be declared with X up to the character's power cards.
   - Power cards under a character: one row; the more cards, the more they overlap.
   - Pay pop-up: smaller, and foldable (▾ Fold) to a bar at the top of the screen — the power cards can then be picked on the field; ▴ Show opens it again (remembered on this device).
   - Card names on the table screen and in the log are the English names everywhere (menus, Resolve list, pop-ups, card labels, field-effect labels); the Japanese name when a card has none, and in the tooltip / Card details. Quotes inside a name become ‘ ’.
→ {Revise#085} (Pack, 2026-11-04)
   - Shield: no damage outside a battle (effects, card text). In a battle it takes damage as usual — from any character, also in the faction check and against your own Active Character. Replaces the Shield line in Revise#083 item 12 (A3-09 1466 vs A3-10 1570 now deal battle damage to each other).
   - Right column: the phase is shown first and biggest, in its own colour (Draw blue · Active orange · Main yellow · Charge green · Discard violet) with the five phases under it; then the turn number and the turn player (in that player's field colour), then whose move it is.
→ {Revise#086} Cost X (Pack, 2026-11-04) — two kinds:
   1. X fixed by the card text ("Xは目標のコストに等しい", "…このキャラクターのパワーに等しい" …): the table works X out, then the player pays exactly X. When X comes from the target, the target is chosen first (a target X can't be paid for is refused with the reason), then X is shown and paid. If the text's target is only picked when the effect resolves (e.g. a card from your Discard Pile), X can't be known in advance → paid as kind 2.
   2. Free X: the player pays as many power cards as they want (at least 1); X = the number paid. No "X = …" menu any more.
   - Also: "…をデッキに戻す" now moves a targeted Permanent / Project card too (not only characters).
→ {Revise#087} Card coverage: Pack's decks first (Pack, 2026-11-04). Order after them: Character → Break → Permanent / Project / Fast, from Saga 3 series 1 on.
   - Pack's 4 decks (Astarte #1, Dina, Iaris, Mayumi; 78 different cards) and the first 4 slots (19 cards): every card fully automatic, each special rule tested with the real cards (tests/engine/run.js "Pack's decks"), plus random legal games with the 4 decks (2–4 players) and three full games in the browser.
   - New rules in the engine: power cards as targets; area / faction choices ("あなたの任意のエリア1つ…", "あなたの任意の勢力1つのキャラクター全て"); "…がバトルする際、…" for a time (battle hooks); "パワーカードフェイズ / メインフェイズ / ターン終了時に、…" (incl. "…可能" = asks); phase triggers of other players ("あなた以外のプレイヤーのメインフェイズ開始時"); "そのプレイヤー" refs; costs +N for opponents (cards, attack, guard, effect costs); "このカードのコストは、あなたのダメージ置き場のカード枚数分減少する"; every player picks from their piles; naming a name ("ネームを1つ指定する"); "スキルまたはエフェクト1つを無効化"; designating (not targeting) a character; returning a declared card (its declaration ends) and banning that name; changing an item's target; replacing the damage check ("通常のダメージ判定を行わず、…"); damage −N ("…に与えられるダメージにー(1)して判定する"); "バトル以外で捨て札されない"; abilities from the Damage Pile ("このカードがダメージ置き場にある場合、…"); inheriting the skills / effects / abilities of the other cards in the structure (覚醒の乙女); set ignoring cost on a name, or ignoring factor and cost under a condition.
   - Fixed: always-on abilities aimed at a group ("≪あなたの支配キャラクター全て≫に…", 201 cards) applied to every character on the table — the group is used now. The by-hand field effect "Applies to" had the same problem.
   - Coverage now: Characters 2,221 / Breaks 1,460 / Permanents 121 / Projects 80 / Fast 142 fully automatic; effect lines 1,151 auto (Revise#082: 1,082).
→ {Revise#088} (Pack, 2026-11-04)
   1. Power cards above Mental: after anything resolves (declaration, ability, battle), a character with more power cards than its Mental (an effect lowered it) must discard down to its Mental. Its owner picks the cards on the board — the character is outlined in red, its power cards are clicked as when paying — and confirms; they go to the Discard Pile. One character after the other. Moving cards by hand doesn't trigger it.
   2. The pay window can be dragged by its title (and still folded).
   3. A3-24 3500 神魔“アシュタルテー” gained effect: always asks for 1 area of 1 player — each player's Active Area and Control Area (Front + Back together) are separate choices; only the characters there lose 1 power card each. The log names the area.
   4. Card details and pile views close with a click outside.
   5. Online: joining from another device used the Deck Builder slot of THAT device; an empty slot made the joiner a spectator, so the room never filled. Now an empty deck is refused with a message, "Room not found" is shown for a wrong code, and the lobby has "Paste a deck list…" (the Deck Builder's text export) to join without building the deck on that device. Room entries were also checked against Firebase storing no empty lists / nulls: both devices reach the same state.
   - Hand panel: the Charge window has its own ▾ Fold / ▴ Show, separate from the hand's. Default: Charge window folded (its header still shows how many cards wait and which is next), hand shown. Both remembered on this device.
→ {Revise#089} (Pack, 2026-11-05)
   1. Declarations resolve, then their effect runs. An effect of a character that is no longer in the Control Area when it resolves (discarded, in the Damage Pile, back in the Active Area) fails: nothing happens.
      "Cost back to hand" ("このエフェクトのコストを手札に戻す"): the cost is paid to where the rules send it (Discard Pile; the hand with Infinity) at once; only when the declaration resolves successfully does it come back from the Discard Pile to the hand. If it fails, it stays.
      Attack: an attacker no longer in the Control Area when the battle comes → the attack is cancelled, no damage. Guard: a guard no longer in the Control Area → the guard is cancelled and the attacker's damage goes to the attack's own target without a battle. A guard never changes the attack's target: attacking a player and guarded → the battle is with the guard; guard cancelled → the player takes the damage.
   2. "Auto pick" in the pay window pays at once.
   3. Interference System: to be decided (Pack).
   4. Choosing a faction (Event window): E.G.O. → Arayashiki → WIZ-DOM → Darklore → Polestar Empire → Eraser, each with its mark and colour (pastel grey / orange / blue / mint / gold; Eraser dark slate).
   5. A Fast / Project card or an effect with nothing to target can't be declared; if its targets disappear while it is being declared (e.g. after paying), it is cancelled and the cost refunded.
   6. Controlled Characters can be dragged to another place in Control Area Front / Back (mouse, pen or finger on the card picture), as in v3. Permanents are shown as small cards under the character.
   7. Remove X not paid: the character's power cards go to the Discard Pile, then it returns to the Active Area.
   8. "このキャラクターのパワー1につき、+X/+X/+X" with X defined (A3-25 3615): +X for EACH power card (X = 4, 5 power cards → +20/+20/+20).
   9. By hand (Card details of a character): add a skill (stays, or for this turn); Mental / Attack / Defense ± for a time; charge 1 from the deck (face down); the newest power card → Discard Pile / Damage Pile / deck top / hand; damage X / (X) to the character. Deck menu: take damage X(X) (normal = damage check, (X) = straight to the Damage Pile).
   10. Lobby: Solo has Deck 1 and Deck 2 and fixed names Player 1 / Player 2; your name and deck are only in Online. The deck lists no longer jump back when changed.
       Online: the Realtime Database rules (from the v3 Play Online set-up) accept an entry only with string fields t and cid — v4 entries had no cid, so every write was refused and no room appeared. Every entry now carries cid; a refused write shows a lasting message; the first entries of a new room can't be lost any more if the database answers very fast.
→ {Revise#090} (Pack, 2026-11-05)
   - Card details: the current state in four highlighted boxes — Status now (Mental / Attack / Defense / Power, the change from the printed values in green / red, costs, where it is), Skills (gained ones marked, removed / negated ones struck), Effects (the lines it can use now, gained and negated ones marked), Abilities (always-on: on / not now; triggered; keep). Each line in English above the Japanese; the card text in English above the Japanese.
   - Main Phase: characters that can attack or use an effect now have a light-blue frame.
   - Under each Deck: two badges, icon + number only (Pack): ⚡N = Charge (max power cards from the deck per turn, gold) and ✋N = Draw (cards drawn in the Draw Phase, blue); the words are in the tooltip.
→ {Revise#091} Charge: pending power cards (Pack, 2026-11-05). A card charged in the Charge Phase (from the hand or the deck) is pending until the phase ends: shown on the character with a pastel-yellow highlight; a click takes it back (hand card → hand, deck card → top of the deck, and that deck charge is free again). When the Charge Phase ends, the pending cards are set, then domination is checked. Auto-skip doesn't end a Charge Phase that still has pending cards (Next ends it).
   - Hand panel header: ⚡ Power N = your power cards on Controlled Characters (they pay costs); "/ M in all" when some are on Active Characters; "· K pending" in the Charge Phase.
→ {Revise#092} (Pack, 2026-11-05) Mental damage to a player also runs the damage check: per point the top card of the deck — a Character card → Active Area (its name already on the field → Damage Pile), other cards → Damage Pile. Only the by-hand "+1 Special damage" still puts the card straight into the Damage Pile.
→ {Revise#093} Card milestone M1a (Pack, 2026-11-05: "Characters → Break → Permanent / Project / Fast, from Saga 3 1st series"; the milestone checklist was confirmed first). Every Character card of A3-01 … A3-25 (132 that were by hand) now runs by itself — 39 more Characters of later series became automatic on the way. New rules in the engine (data only from here on for cards of the same wording):
   - Card cost: "≪本来のコストが0のカード全て≫のコストは1上昇する" (printed cost), "≪<faction>のプロジェクトカード・ファストカード≫のコストは1上昇する".
   - Break rules on the target: "分類に関わらず、≪このキャラクター≫を(<faction>のブレイクカードで)ブレイク可能"; "≪あなた≫は、支配エリアのこのキャラクターを、ファストカードのタイミングでブレイク可能" (a Break card at fast timing, only onto that character).
   - A Character card used as a Break card: "≪このカード≫は、E0のブレイクカードとして使用宣言可能" — the hand menu shows "Declare … as a Break card" {Q#34}.
   - Look-back triggers: "このキャラクターがブレイクされた場合", "≪支配エリアの / パワーカードをセットされているこのキャラクターをブレイクしたプレイヤー≫は…" (the breaker decides / draws) {Q#31} {Q#32}, "このキャラクターがバトルの結果捨て札される場合".
   - Battle: "このキャラクターがバトルする際、≪このキャラクターのバトル相手≫の持つ<skill> / スキル全てを無効化する" (Bind X, Initiative, Penetrate, Resist, Permanent +X → −1 {Q#35}).
   - Skill value from the text: "バインドX Xはあなたの対戦相手全てのダメージ置き場のカード枚数の合計に等しい", "ドロー-X Xはあなたの手札枚数に等しい".
   - Conditions / effects: "…のネームレベルキャラクターと同じエリアにいる場合" {Q#33}; "…のファクターを1つ得る"; "≪このキャラクターから支払われた<class>のブレイクカードのコスト≫は、オーナーの手札に戻る" (only the cards paid from it); "自身の手札を1枚選んで捨て札する"; a deck card → hand ("≪あなたのデッキ≫から、…1枚を手札に加える"); a Character card from the deck → Active Area; a power card of yours → this character; "分類・式神を持つ" (gains a class icon); "▼「…」" lines are flavour text.
   - Tests: 18 new tests with the real cards, 200 random games with decks built from these cards (2–4 players, no errors).
→ {Revise#094} (Pack, 2026-11-05: answers to Q#31–Q#35) Q#31–Q#34 stay as built. Q#35 — Permanent set system: a character with no Permanent ± X skill holds 1 permanent; Permanent −X lowers that (Permanent +X raises it). When the limit becomes lower than the permanents on the character — after anything resolves, when a battle starts and when it ends (e.g. A3-22 3217 スズメ蜂 "パーマネント-1を与える" during its battle) — the owner chooses which permanents go, down to the limit. (Setting one permanent too many works the same way.)
   - Permanent Destination rules (Pack: "make discarded permanent move to hand, deck, damage or place on other character instead"): a modifier "permDest" {to: hand | deckTop | deckBottom | damage | char} sends such a permanent there instead of the Discard Pile; "char" = onto another of the owner's Controlled Characters that still has room (the owner chooses; none has room → Discard Pile). Several rules → the owner chooses one. Cards that say so are compiled to it; until then it can be added by hand (Field effect: "Permanents that must go → …").
→ {Revise#096} Site front page and tabs (Pack, 2026-11-05). A Home page (purpose of the site, 4 steps, one card per tab with how to use it and an Open button) is shown when the site is opened without a #tab. Tabs, without numbers, each in a light-blue frame: Home · Card List · Rulebook · Deck Builder · Game Table · Changelog. The v3 Solo Test and Play Online tabs are removed (their table, online and input code too; the v3 card-analysis code stays because the Card List's card details use it); the Discussions placeholder is not in the list and is removed. Old links #play/… and #solo open the Game Table. Site name (Pack, 2026-11-05): “Aquarian Age Thailand Fan-site” (アクエリアンエイジ タイ ファンサイト) in the page titles, Home page, app name and deck exports; Pack's new banner image (アクエリアンエイジ ファンサイト, 970×299) replaces the old one, shown at half the old height (up to 237 px; at least 110 px on phones) with its edges fading into the page; the deck image export keeps the new banner's proportions. (Pack, later: full width — the banner fills the page width at the same height, cropped top / bottom, kept a little low so the logo and the ribbon text stay whole.) Higher resolution (Pack): the 970×299 image upscaled 4× with the EDSR super-resolution model, then scaled to 2800×863 (assets/banner.jpg). Tab icons (Pack): Home = Pack's card-art picture (round), Card List = the card back, Rulebook = a book, Deck Builder = a card pile, Game Table = a chess pawn, Changelog = a scroll (small drawn icons, white outline).
→ {Revise#097} (Pack, 2026-11-05) Search: filter "Name: Yes / No" (Any / Yes = a personal name in “…” / No), with counts like the other filters. Deck Builder → Template: "Basic Deck #1" … "#4" at the bottom (Pack's Astarte, Dina, Iaris and Mayumi decks, src/data/basic_decks.txt — an "All decks" export, so more can be added the same way). Choosing one asks which deck slot; a slot with cards shows a warning that it will be replaced — OK replaces it, Cancel changes nothing. The deck is named "Basic Deck #N · <name>" and that slot is opened.
→ {Revise#098} (Pack, 2026-11-05) Game Table field: Control Front is shown as 3 sections with their own alignment — Left: aligned right · Centre: centred · Right: aligned left. Same attribute (one Control Front for every rule); only for a better view. A character's section is kept in its place (at.sec "left" / "right"; none = centre) and set by dragging it there (moveChar {area: "front", sec, index}); a character that comes to the Front without a section goes to the centre.
   - Sort button (small ↑↓ icon) on each Control section of your own board (each Front section and the Back, when it holds 2 or more characters). Order: Group 1 Draw X (highest Draw first) · Group 2 an effect whose cost returns to the hand · Group 3 Charge (not in a group above) · Group 4 everything else · Group 5 Break-cost return ("このキャラクターをブレイクする場合、そのブレイクカードのコストは手札に戻る"); inside each group Mental highest → lowest (then the order they were in). It is one intent (sortChars {area, sec, order}), so the other players see it and it can be undone. The explanation shows after the pointer rests on the button for 1 second, or after a 1-second touch (a long touch doesn't sort).
→ {Revise#099} (Pack, 2026-11-05)
   - Cost window: switch "Auto Pay after Cost Selection" (also a Player option; renamed by Pack): the payment is sent as soon as the picked power cards = the cost.
   - Effect System: the lasting result of a character's effect or ability ("until the end of the turn / Main Phase / battle", until removed) ends as soon as that character is no longer on the field (the modifier carries fromChar; a state check ends it, shown in the log).
   - Event System: changing a target (A3-15 2105 オルタレイション・マジック on e.g. A3-14 1975 悪魔払い) asks with each new target by name ("Character — owner, area" / "Player: …"), not as raw ids; the current target isn't offered; the log line names the new target. Choices of characters show names too.
   - Player options (menu button "⚙ Player options"): Auto-skip and Auto-pay (game rules) moved in; "Auto Pay after Cost Selection"; "Pick Max Charge" (OFF at first) — a click on your Deck in the Charge Phase picks as many deck charges as Charge allows, down to Deck = Draw (or Deck = 0 when "Charge exceeds Draw" is ON); "Charge exceeds Draw" (OFF at first) — OFF: a charge that would take the Deck below Draw shows "Deck <= Draw. Will you continue to charge?" with Charge (red: charge it) or Stop (green: not charged, and "Charge exceeds Draw" turns ON, shown red); ON: no warning. These three are kept on the device.
   - By hand ("Do it"): checked — by-hand actions (move, power card, field effect, damage) don't touch the Resolve list or the passes; waiting for Pack's exact steps where a resolution was skipped.
→ {Revise#100} Card milestone M1b (Pack, 2026-11-05: "continue to implement M1b to M2g"): Characters of the Saga 3 specials (BS2, EP, EX01–05, EXPP, EXPR, EXPV, PP, PR, SIGN) — 23 of the 25 that were by hand are automatic ({Q#36} {Q#37} stay by hand). New:
   - Source titles: each card keeps its title from 'エクスパンション or その他配布方法' (works: nanoha = 魔法少女リリカルなのは…シリーズ incl. ViVid and Force, nanohaForce, phantom = ファントムブレイカー), used by "分類に関わらず、≪このキャラクター≫を<title>の(ブレイク)カードでブレイク可能", "<title>のブレイクカードで…ファストカードのタイミングでブレイク可能", "≪このキャラクターを<title>のカードでブレイクしたプレイヤー≫は1ドローする", "このキャラクターが<title>のカードでブレイクされた場合".
   - "パワーカードフェイズ終了時の効果でこのキャラクターを支配した場合" (only the Charge Phase domination, not an effect's); "精神攻撃によるダメージを受けない"; "スキルを持つキャラクターとのバトルによるダメージを受けない"; "≪支配キャラクターが5体以下のキャラクター全て≫は、プロジェクトカード・ファストカードの効果を受けない"; "あなたの支配エリアに“X”がいる場合"; targets with a personal name ("あなたの支配エリアの“X”1人", every "…“X”"); "≪あなたの任意の対戦相手1人≫"; "あなたの任意のパワーカード1枚を捨て札可能"; "…のブレイクカードとして使用可能" with the faction written out; skill lines with a series label ("▼ ドロー+1 マーチャント系").
   - Tests with the real cards; 120 random games (2–4 players) with decks from these series, no errors.
→ {Revise#101} Card milestone M1c — Saga 4 Characters (A4-…): 97 of the 104 that were by hand are automatic. By hand for now (one card each, rare wordings): A4-02 0301 / its copy (cost +1 for Project / Fast cards that target this character), A4-EX02 EX811 (lower its own Mental in the Charge Phase), EX844 (show a 三征西班牙 card to set it), EX860 (Capacity cards in the Break cost back to the hand), A4-03 0465, A4-PP PP351. New:
   - Tags: a word after the skills or on its own line (武蔵, 英国, 三征西班牙, ソードマン系 …) is kept on the card; "武蔵を持つあなたの支配キャラクターが3体以上いる場合", "あなたが三征西班牙を持つキャラクターを(3体以上)支配している / していない場合 / 状態で".
   - "あなたがEEEを満たしている場合" (your Controlled Characters give that factor; 宇 = Eraser {Q#36}), "あなたが先攻でない場合", "このキャラクターが<faction / icons / ♂の分類を持つ>キャラクターとバトルする際", "このキャラクターのパワーがNの場合"; two conditions in one sentence; "≪<X>と同じエリアにいるこのキャラクター≫は…"; "≪このカードを構成するカードに含む(…)キャラクター≫…" (works from any card of the character).
   - Fast-timing breaks with a name ("“X”で") or when not going first; "分類に関わらず、Fのカードでブレイク可能"; Character cards as Break cards only when not first / at fast timing onto your own characters; "ブレイクスルーを持つキャラクターをガード可能"; "≪あなた≫が勢力キャラクターから受けるダメージの数値に-1"; "…から支払われたコストの中にあるプロジェクトカード / fortissimoシリーズ…のコスト≫は手札に戻る"; "≪“X”のネームを持つブレイクカード≫の必要ファクターは1減少する"; "FとFのファクターを1つずつ持つ", "FまたはFのファクターを1つ得る" (choose); "本来のコストが0のプロジェクトカード・ファストカード全て".
   - Triggers: "対戦相手にアタックした場合", "シンクロによるアタック宣言またはガード宣言を行った場合", "あなたがこのカードをセットした場合" (with "あなたのテリトリーにキャラクターがいない状態で"), "あなたがこのキャラクターを“X”でブレイクした場合"; effects: deck top → this character's power card, a Permanent from the deck onto it, look at 3 / take 1 / discard the rest, hand card → Damage Pile, a Discard Pile character → Control Area, search by name, "次のターンのターン終了時まで".
   - A trigger followed by more sentences ("その後、そのデッキをシャッフルする") now compiles.
   - Tests with the real cards; 120 random games with decks from the Saga 4 series, no errors.
→ {Revise#102} (Pack, 2026-11-05) Player option renamed "Auto Pay after Cost Selection" (also in the cost window). By hand → "Move to" onto a character: one entry per kind — "Move to: Break / Permanent / Power card" — then click the character on the field (the places it may go are shown in blue; Cancel in the hint).
→ {Revise#103} Card milestone M2a started (Break cards, A3-01 … A3-05): rules shared by many Break cards of every series — 50 more Break cards automatic in all (1,538 → 1,588):
   - "≪このキャラクターのバトル相手 / そのオーナー / アタック宣言またはガード宣言したキャラクター / ガード宣言したキャラクター≫に、ただちにX / (X)ダメージを与える" (when the attack is guarded / any attack or guard is declared; X from the text).
   - "≪このキャラクター≫は、<…>キャラクターにガードされない"; "≪ネームレベルでない / ネームを持つブレイクカードのコスト≫は、オーナーの手札に戻る"; "≪キャラクター全てとあなた / プレイヤー全て≫に…"; "このキャラクターが捨て札になる場合"; 【…】 Break rules over two lines and "【“A”“B”をブレイク可能】" (those names may be broken with it).
   - X: "…キャラクターの数に等しい" (any selector), every player's Damage Piles, the opponents' hands, the Break cards in all Damage Piles.
   - 100 random games with Saga 3 decks, no errors.
→ {Revise#104} (Pack, 2026-11-05) Q#36: 宇 is the Eraser mark (A3-EP EP107 宇1, A4-04 0753 宇宇宇). Q#37: A3-PR PR346 — when your Break card with 「ブレイブカイザー」 in its name (that faction) is set on it, a Permanent from your hand with 「ブレイブ」 in its name (that faction) is set on the character for free.
   - By hand during a choice (Pack's case: Discard Phase, deck 5, Draw 6 — a hand card put on the deck top while choosing the discards): the game ended and the player lost, because what waited behind the choice (the end of the phase, then the next turn's draw) ran when the by-hand action was done. Now an action taken while a choice waits runs on its own; the phase, Resolve list and timing wait for the answer, and a choice that depends on the hand (the discard down to the hand limit) is asked again with the cards now in hand.
→ {Revise#105} M2a continued: a skill "…+X" with "Xは…" on the next line; "バトル以外のダメージを受けない" written without a subject; "≪バトル相手≫のスキル全て(とエフェクト全て)を無効化する"; "このキャラクターを、ネームを無視してブレイク可能"; 【ブレイクしているキャラクターを、分類・ネームを無視してブレイク可能】; "パワーカードフェイズに≪このキャラクター≫にパワーカードをセットすることはできない"; "≪このカード≫の必要ファクターは、あなたのダメージ置き場のカード枚数分減少する"; "勢力 / メイン / パワーカードフェイズ終了時に(、このキャラクターのパワーがNの場合)、…" (every player's phase, as written); "オーナーのデッキの一番上のカード1枚を引き、パワーカードとして…"; "≪このカード≫はオーナーの手札に戻る". Break cards automatic: 1,607 (M2a: 21 of 167 so far). 100 random games, no errors.
→ {Revise#106} M2a continued: "バトル相手のパワー1につき、≪このキャラクター≫に+1/+1/+1 / の耐久力に+1して判定する"; "このキャラクターのパワーが0の場合、バトルの際、…"; "≪パワー0の(ネームレベルでない)キャラクター≫のアタック宣言・ガード宣言を取り消す" and "このキャラクターのパワーが0の場合、≪このキャラクターのアタック宣言・ガード宣言≫は取り消される" (they can't attack or guard); "X:目標の≪このキャラクターにガード宣言されている、パワーX以下のキャラクター≫のアタック / ガード宣言を取り消す"; "このキャラクターがガードした場合、≪あなたの手札1枚≫をパワーカードとしてこのキャラクターにセット可能"; "このエフェクトのコストをあなたのデッキの1番上に置く"; "任意の分類1つを得る" (choose); "ブレイクしているキャラクターが捨て札された場合、≪そのキャラクターを構成しているブレイクカード全て≫を手札に戻す"; "≪このキャラクターにセットされたパーマネントカードのコスト≫はオーナーの手札に戻る"; "…のスキル・エフェクトを無効化する", "≪精神力1以下のキャラクター≫のチャージ1を無効化する", "バトルによる精神ダメージを受けない", "±0/+3/+3され、インターセプトを得る", "…の精神力に-1し、…はチャージ1を得る"; story lines like "0720 ご朝食準備完了。" are flavour. Break cards automatic: 1,639 (M2a: 41 of 167).
→ {Revise#107} M2a continued: "目標の≪…キャラクター≫" written without a count is one target (e.g. A3-03 0612 / 0614 "X:目標の≪このキャラクターにガード宣言されている、パワーX以下のキャラクター≫のアタック宣言 / ガード宣言を取り消す"); "≪バトル相手≫の攻撃力にー(X)・-Xして判定する"; "≪ファストカードまたはエフェクトのコストを支払ったキャラクター≫に、ただちにXダメージを与える" (a cost-paid event per paying character); "…に、このエフェクトのコストに等しいダメージを与える". Break cards automatic: 1,643 (M2a: 45 of 167).
→ {Revise#108} M2a–M2c (Pack: "Go next until M2c is completed") — rules shared by many Break cards of A3-01 … A3-15: "≪…≫は<faction>のプロジェクトカード / ファストカードの効果を受けない", "≪…≫は<…>キャラクターのエフェクトの効果を受けない" (e.g. パワー0の / 極星帝国の); "≪このキャラクターから支払われた<faction>のブレイクカードのコスト≫" and "≪ブレイクカードのコスト≫は、オーナーの手札に戻る"; "≪…全て≫のアタックコスト・ガードコストはオーナーの手札に戻る"; "必要ファクターは、あなたのダメージ置き場の<faction>のカード枚数分減少する"; "ターン終了時に、…"; "メインフェイズ終了時まで、≪パーマネント / プロジェクトカードのコスト≫はオーナーの手札に戻る"; "≪プレイヤー全て / あなた≫にドロー+1 / キャパシティ±Nを与える"; an X defined anywhere on the card ("Xは…に等しい" at the end) also counts for its other abilities. Break cards automatic: 1,720. Still to do: M2a 115, M2b 170, M2c 168 — mostly one card per wording. 100 random games, no errors.
→ {Revise#109} M2a–M2c card by card (Pack: "Keep going card by card until M2c is done"). New rules the engine now runs:
  · an attack that hits a player: "通常のダメージ判定を行わず / の後、…" (mill the attacked player, their hand → Damage Pile, you choose cards of their hand);
  · "≪このキャラクターのアタック宣言に対してガード宣言するか、…キャラクター≫…": when that guard is declared (its power cards / permanents, damage, cancel, to the Damage Pile with everything on it);
  · "このキャラクターがバトルによって支配キャラクターを捨て札した場合" (X = that character's Defense); "このキャラクターがアタック宣言またはガード宣言した場合";
  · forced guard by an effect ("≪このキャラクター≫はガード宣言する" — in the response step, only when the attack has no guard; no guard cost);
  · attacking characters ("≪このキャラクター≫は、勢力エリアのキャラクター / 精神力X以下のキャラクターを目標にアタック宣言可能", with an extra cost too);
  · look at a hand (the cards are shown to you), hand → deck and draw that many, Discard Pile at random → deck, name a card type and draw at random from a hand;
  · one faction party takes damage; your characters you choose + you take damage; power up to Mental from hand / deck; a Permanent / Break card from hand or Discard Pile as the target;
  · player modifiers: can't set hand cards as power cards; Break cards with given class icons at fast timing; "X:…終了時まで、スキルを持つ支配キャラクターがアタック宣言 / ガード宣言した場合…";
  · character modifiers: can't pay costs from it; pays attack / guard costs of given classes; leaves to the hand with everything on it; battle damage goes to its owner instead; the battle opponent uses Mental as Defense and power as mental attack; spared in battle (to the top of its party); a Permanent in the Damage Pile makes the damage check go again; gains the skills / effects / abilities of a Break card in a Damage Pile or of a target character for a while; immune to costs ≤ its power;
  · cost rules: to the deck and shuffle; Project / Fast cards aimed at it → Damage Pile; this card's cost back on a named character.
  Break cards automatic: 1,903 (all series). Still to do: M2a 12, M2b 155, M2c 161. 60 random games, no errors.
→ {Revise#110} M2b (A3-06 … A3-10), card by card: attacks on a player without "通常のダメージ判定" (look at the hand and discard, then they draw); a second mill after the attack; the damage check repeated / skipped; "このキャラクターのアタック宣言に対して支配キャラクターがガード宣言した場合" and "このキャラクターが支配キャラクターのアタック宣言に対してガード宣言した場合"; "バトルの際、…して判定する" (for a while too); damage to this character taken by its owner; damage ≤ its power ignored; can't guard a broken attacker; "Project / Fast cards need +X factor"; "≪プレイヤー全て≫にチャージ1を与える"; a damage check at the start of every Main Phase; whoever breaks an opponent's character draws; a card that comes back to the hand when the damage check puts it into the Damage Pile; put 3 back in any order; every player does the Draw Phase now; hand cards on top of the deck in your order; a card in a Damage Pile → power card on a character of its owner; skill-only / effect-only negation; "+1/+1/+1 for each …" (Break cards in it, named Break cards in other Damage Piles, cards with a name in your Damage Pile); conditions "場に“X”がいる場合", "あなたの対戦相手全ての手札枚数の合計がN枚以上の場合"; Protect / Resist <faction> gained by an ability.
  Break cards automatic: 2,014 (all series). Still to do: M2a 12, M2b 103, M2c 156. 80 random games, no errors.
→ {Revise#111} M2c (A3-11 … A3-15), card by card: "-X・ー(X)" read as "−X attack, normal or mental"; "≪…≫は、バトルの際、+N/+N/+Nして判定する" for every character it names (only while that one battles); "…がバトルする際、攻撃力に-Xして判定する" on a target; "このキャラクターがバトルする際、≪…≫にXダメージを与える" (X = power difference); can't use effects / can't pay costs from it / no normal damage / no mental damage ≤ (X); the costs of Project / Fast cards and effects +X; Draw +X for every player; "このエフェクトはあなたのターン中にのみ使用宣言可能"; characters killed in battle with it go to the Damage Pile with everything on them; cancel the attack of the character it guards; "あなたの支配キャラクターがプレイヤーにアタックした場合"; Boost attacks; kills by any damage; kills by your Demon characters; ignore the factor of Break cards with given classes; "≪あなたの任意の…1人を構成するカード全て≫を手札に戻す"; Break cards with given classes from the Discard Pile; every player draws X then discards X at the start of their Main Phase.
  Break cards automatic: 2,116 (all series). Still to do: M2a 12, M2b 103, M2c 89. 80 random games, no errors.
→ {Revise#112} Pack's three decks (Iaris-Kuro, Edyaeas-Kuro, Tiamat-Kuro): every card in them runs by itself. New: Search given to Dragoon Break cards in your hand (龍貴婦人); immunity to two factions' cards (青竜女王“アズーリ”); power 0 while attacking / guarding → back to the hand (ブラックホール・ジェネレーター); the cost of an Eraser Break card set on it back to the hand, and 1 damage when you set a named Eraser Break card on it (黒のオーラ); give up X attack for X damage to another target after the battle (ドラグーン“ェデャエァス”); any number of Controlled ↔ Active characters (軌道エレベーター); no normal battle damage in that battle (番竜“ラドン”); no damage in battle except from characters that share a class (調和の女神“ハルモニア”); names in Damage Piles banned / negated for opponents, and a target with such a name discarded (大地母竜“ティアマト”); see an opponent's whole deck and move one card anywhere in it, no shuffle (MI6); discard 2 from your deck to get the card back when the target leaves or at the end of the turn (ミッドナイト・テラー); characters set by its damage check are discarded (神馬スレイプニル).
  Pack's rules: "このキャラクターがバトルする際" only in a real battle — an attacker against a guard or an attacked character; an unguarded attack on a player is not a battle (A3-BS2 1794). Fast cards and effects: any player, any time in the Active and Main Phase, in any player's turn (also in the Guard step). Responses: in priority order, or "Responses together" (a table setting: everyone answers at once; it resolves when all have passed). Hold OFF: the player is not waited for, but may still answer while the window is open. Undo: the other players with Hold ON must agree (in turn order, or together with that setting); Hold OFF players are not asked; one refusal cancels it. Power cards: other players always see them face down — only the owner sees the ones set from the hand (from the deck: nobody), unless an effect shows them; the face-up option is gone. The Discard Pile is face down for everyone; an effect that picks from it shows its cards to the chooser.
  Break cards automatic: 2,128 (all series). 40 random games with Pack's three decks, no errors.
→ {Revise#113} Pack: Hold OFF is never asked "pass or not" — not even the turn player; a declaration resolves when every player with Hold ON has passed (nobody with Hold ON: at once). The cost of a declaration stays visible to every player, as cards, under it in the Resolve list until it resolves (attack / guard costs in the battle box until the battle ends); the log shows the paid cards by name. Field: a character's details (stats, power cards, permanents, skills) are to the right of its card, and the highlight box (can act / targets / chosen / charging) goes around the card and its details together.
→ {Revise#114} Pack: a face-down card (a power card from the deck, a card in the Discard Pile …) opens with "By hand" for its owner — move it to the deck / hand / a pile / the field. Card sizes: S = the old M (66 px wide), M = twice that (132 px), L = the real card size (63 mm ≈ 238 px); the table starts at S.
→ {Revise#115} Pack's deck Sekhmet: every card runs by itself — 王の守護神“セクメト” (may be declared as a WWWWWW1 card without its Break condition; an attack / guard declared by any character but your aggressive Controlled ones → discarded; damage to you from anything else → X damage to that character's / card's owner), 愛の女神“フレイヤ” (X damage to another character with skills / effects that declares an effect, an attack or a guard; attack costs paid from Controlled Characters back to the hand; other players' Controlled Characters may attack it), ヴァルキリー“ランドグリーズ” (the Shield of the opponents' Controlled Characters negated), 秘密のお茶会 (every player returns the cards set on X of their named Controlled Characters), ゲイ・ボウ (keep-on-the-field effects don't work for characters its character discards; a character damaged by it in battle can't take power cards until the end of your next turn). Game Table: the Game ID and "Copy invite link" stay at the bottom of the side panel during the game (online).
→ {Revise#116} Pack — By hand, power cards: "Charge from your deck" asks how many (1 to the character's Mental, at most the cards in the deck) and sets that many from the top, face down; "Power cards → Discard Pile / Damage Pile / top of the deck / hand" opens a box with the character's power cards: choose them (or "Choose all"), then all the chosen ones move at once.
→ {Revise#117} Pack — Take control (online): every command carries the time it was sent; when the player the game waits for (a choice, a declaration in progress, a trigger, the guard, priority, else the turn player) has given no command for 30 s, watchers see "Take control of <name>". The first watcher who presses it gets that seat (the player before watches); the button is disabled after pressing; the 30 s count again from that moment, so a second watcher right after is refused.
→ {Revise#118} M2a: "攻撃力に-X・+(X)され" (X of the attack dealt as mental damage, 0757 / 0771); ファラオ“センウセルト” (Break cards of other characters whose power = Mental are discarded); open hands while power = Mental (0234 / 0247: every player's hand is shown to everyone); 宇宙怪獣 0616 (attack / guard only by discarding another Controlled Character of yours; 1: discard any number X of your characters, then X damage). Game Table: dragging a Controlled Character moves it in one drag — the browser's own image drag no longer swallows the release (before, the card only dropped on the next click).
  M2a still by hand (5): 0233 (area effects redirected to it), 0373 / 0390 (use a Project / Fast card from the Damage Pile on it), 0863 / 0877 (effect cost paid by discarding Controlled Characters), 0866 (several attackers at once).
→ {Revise#119} Tokens: "≪このエフェクトのコスト≫を、勢力なし、…の支配キャラクター・<name>としてセットする" — the paid cost cards become a Controlled Character (Control Area Back) with the name, classes, skills and Mental / Attack / Defense the text gives (アストラル / フレイム / 光弾: the cost cards are its power, stats = power; コウモリ 0/1/1; 炎 0/X/1; 死霊 0/(X)/1; 式神零式改 0/X/X); "…にカードをセットすることはできない"; "目標の≪…アストラル1人≫を、パワーカードとしてこのキャラクターにセットする"; costs paid for tokens / for characters of a class of their own; "Xは場のコウモリの数の合計に等しい". Also: draw X (= its cost) for whoever sets a Break / Permanent card, damage to whoever declares a Project / Fast card (0931 / 0935); a Machine Character card from your hand as a Controlled Character (1576); a Permanent from your hand / Damage Pile onto any of your characters ignoring factor and cost (1501).
  Fix (Pack): a Permanent's skills now belong to its character and show on it (メトセラ: Shield · Bind 1 · Draw -1 · Charge 1) — before, they were not counted at all.
→ {Revise#120} Pack: on the Game Table a card shows only its picture — the English name under it is gone (it still shows when the picture can't load).
→ {Revise#121} Pack: the hand has "⤢ Expand" — every card at once in rows, across the board (left of the side panel); "⤡ Shrink" goes back (remembered on this device). The hand keeps its scroll position when the table is drawn again (choosing hand cards for the Charge window no longer jumps back to the left end).
→ {Revise#122} Pack: boxes and the log in English — a triggered ability in the Resolve list and in the log, a "✋ By hand" step, and an effect in the action menu show the card's English line (the Japanese one only when the card has no English text); personal names to choose (e.g. A3-22 3199 パスハ "Name a personal name") show their English name.
→ {Revise#123} Pack — Deck Builder templates: only the cards already in the deck when a page (step) is opened go to the top of its lists; a card picked on that page stays where it is (it moves up the next time the page is opened).

	20.10 Quality tools
	   - Scenario tests for each rule (rulebook examples, e.g. the 邪印 → 孔雀明王法 → 十字祓 response example) and for each bug Pack reports.
	   - Replay check: any saved game log replays to the same state (catches online desync).
	   - "Why can't I?": every refusal from legalActions carries a reason shown to the player.
	   - Debug panel (hidden): current window, Resolve list, decisions, modifiers with their sources.

	20.11 Notes
	   - Online: every device knows the shuffled deck order (needed for replay); fine between friends, not cheat-proof. Hidden deck info (Revise#066) is hidden on screen only.
	   - Saved v3 games won't replay in v4; v4 rooms start fresh.
==================================================================================================================
21. To-do list (not in v4 for now)
	- Skill Inherent (Q#22).
	- Skill Undead (Revise#064).
	- Partner System and Styles (Q#21).
==================================================================================================================
22. Card milestones — what to order next (Pack, 2026-11-05)
	→ {Revise#095} (Pack: "add milestone to a sheet in Requirement so that I can check what to order next") Each milestone is one release for Pack to try before the next one. Agreed order: Characters → Break → Permanent / Project / Fast, from Saga 3 1st series. The counts below are worked out from the compiled card rules at every build ("Cards to do" = not fully automatic yet). The scope and status of each milestone are in docs/milestones.json; Pack may reorder or split them — tell Claude which one is next.
	@@MILESTONES@@
	   Every series × card type: cards still to do / cards in all (green 0 = done).
	@@SERIES_GRID@@
==================================================================================================================

Revise#124 — Pack's Deck 1: every card runs by itself.
- A3-25 3757 / 3770: copy the Break skills of an opponent's character (copyOppBreakSkills).
- A3-18 2477: free when an opponent controls an Eraser character; normal targeting.
- A3-PP PP279: may be played from the Damage Pile (mills 5), then gives its skill and stats.
- A4-04 0742: ends Lasting effects (lastingOff).
- A3-25 3764: no factor needed, Stealth; it is discarded when its character attacks, but effects it already gave stay.
- A3-18 2481 討伐令: until the end of the Main Phase, when your Controlled Character attacks a player you discard one named-level character from that player's Controlled Area; and non-named characters pay 1 more Guard Cost to guard a Polestar Empire named-level character's attack. No target is chosen when the card is declared.

Revise#125 — Card details and the turn order pop-up.
- Card details: beside "Rules: …" a mark shows whether the card runs by itself — "Implemented" in a blue frame (rules automatic) or "Not implemented" in a red frame (partly by hand or by hand).
- When the game starts, a "Turn order" pop-up shows every player from 1st to last, joined by animated arrows drawn in turn. Your own seat has a pastel yellow star in a pastel pink frame. It stays 3 s, then fades out over 1 s. It is not shown when you join or reload after turn 1.

Revise#126 — M2b (Break A3-06 … A3-10), batch 1: these now run by themselves.
- A3-07 1131 ガルム: discard any number X of hand cards, then ±0/+X/+X until the end of the Main Phase.
- A3-07 1061 / 1210: the Damage Pile loss limit of its controller is raised by this character's Mental.
- A3-07 1056: with 4+ cards in the opponents' hands, ±0/+1/+1 for each card over 3.
- A3-10 1563: every effect is negated (no effect can be declared); Project / Fast cards cost +X (X = your Damage Pile).
- A3-07 1096: you may choose not to draw whenever you must draw (asked each time).
- A3-10 1573: you see the cards your Charge puts on characters.
- A3-09 1443 / 1456: after Bind 1 is used, the top card of your Discard Pile goes on top of your deck.
- A3-07 1162 セギヌス: choose one player's Active Area or Control Area; its ▼ characters and every Mental 0 character are discarded.
- A3-09 1379 / 1391: at turn start you may discard X hand cards for Attack +(X) until the end of the Main Phase.
- A3-10 1504: set: X power cards from your deck (X = the paid cost); its effect cancels its declaration and returns it and the battling characters to their owners' hands.
- A3-10 1531: set: X power cards from the deck (X = named cards in your Damage Pile); battle-discarded: its battle opponent and its power cards go to the Damage Pile.
- A3-07 1128: guarded by / guarding a non-broken Controlled Character → the top card of your deck becomes its power card.
- A3-10 1565 女媧: set: every hand is discarded; discarded: every Discard Pile is shuffled back into its deck, then each other player puts their deck top into their Damage Pile.

Revise#127 — Pack's table fixes.
- Hand: at Size M the hand is wide enough for 8 cards; cards are centred; Fold / Expand are icon buttons at the top right.
- The face-down Discard Pile shows its sleeve in a bold grey frame.
- When another player's cost goes back to the hand (Offensive, Defensive, Infinity, "cost back to the hand"), a pop-up shows those power cards for 5 s and fades over 2 s; a new return adds to it and restarts the time; hover keeps it open, click a card to enlarge, × closes.
- Character sort: faction first (E.G.O. → … → Eraser → none), then the skill groups.
- A3-25 3770 also copies the skills an opponent's named Break character has gained on the field (e.g. Shield from A3-24 3465, Offensive / Defensive from A3-24 3459).
- Fix: a "look only" hand (A3-05 0719 …) could not be closed online — the room drops an empty choice; an empty choice is now accepted.

Revise#128 — Hand at Size M (Pack).
- When the hand is not expanded, 8 cards always fit in one row without scrolling: the hand sits over the table (no longer under the side panel) and the cards shrink a little when the window is narrow. The cards stay centred.
- Stuck log: when nothing has happened for 30 s, a ⚡ button appears at the top right of the hand (beside Fold / Expand). It opens a report of what the game is waiting for or still processing: pending choices, the declaration being made, triggered abilities waiting for Run / Skip, the response (priority, who must still pass, who passed), a pending undo, queued operations, the Resolve list, the battle, delayed steps, and the last log lines. Copy puts it on the clipboard for a bug report; Refresh rebuilds it.
- Take control moved to the right end of each other player's tab (online). It is dimmed until the game has waited 30 s for that player (the countdown shows on the button), then it can be pressed once — by a watcher or by another player. The button is disabled the moment it is pressed (no double click), and the 30 s start again after control is taken, so a second press right after is refused. A player who takes over plays both seats; the old player becomes a watcher.
- A3-25 3757 and 3770 (same text): checked again — both copy the skills an opponent's named Break character has now, gained ones included (from its own card, from other cards, or added later), plus the printed skills of named Break cards in opponents' Damage Piles. Test added for both cards.
- Nozomi (A3-05 0719 / 0722 / A3-PR PR087 …): the look-only hand closes with OK even though 0 cards can be chosen (fixed in Revise#127: the online room drops an empty choice, which is now accepted).

Revise#129 — M2b (Break A3-06 … A3-10), batch 2: 24 more cards run by themselves.
- Attacks made by an effect: A3-08 1230 / 1233 (your character with Mental ≤ X attacks a player you choose, without an Attack Cost; only when no battle is going on); A3-10 1562 / 1567 ジャンヌ・ダルク (set at your Project timing → it attacks an opponent you choose; in your Damage Pile: your non-▼, unbroken Controlled Characters get Attack +1 and Synchro).
- The attacker is replaced in the same battle (same target; a guard now guards against the new attacker): A3-06 0980 / 0984 (this character), A3-09 1444 / 1457 / 1493 (a Controlled Character you choose); their third effect replaces the guard the same way.
- Other ways to pay an Attack / Guard Cost: A3-06 0944 / 0948 (a hand card into your Damage Pile — the cost counts as paid) and A3-08 1218 / 1221 / 1284 (the same until the end of the Main Phase, after its effect: target −5/−5, itself +(5)/+5); A3-06 0920 / 0924 (a Permanent set on it is paid instead). The pay window shows these under "Or instead". 0944 also discards X hand cards when set (all if fewer).
- A3-07 1091 / 1093 / 1109: no player can declare a card with the name of a Project (/ Fast) card in any Damage Pile; the effect returns a Damage Pile card to its owner's hand, then that owner puts their deck top into their Damage Pile.
- A3-07 1195 K-100: until the end of the Main Phase, when its attack is guarded, X damage to the original target and to the guard (X = the cost paid).
- A3-10 1579 / 1582 ラファエル: guarded by a Controlled Character → you discard 1 card of the guard owner's Damage Pile; 1: every card of one opponent's Damage Pile is discarded.
- A3-09 1377 / 1390 須藤りのん: X: a Permanent with factor ≤ X from your deck or Discard Pile onto your Controlled Character (deck shuffled if it came from there).

Revise#130 — M2b batch 3: 13 more cards.
- A3-06 0979 / 0983 ラツィエル: set → X damage to you (X = your Damage Pile).
- A3-06 0932 / 0936: every player pays a cost from one character at a time; Project / Fast / Permanent costs can't be paid from unbroken characters.
- A3-07 1021 ヒルダ・ミナカミ: X: until the end of the Main Phase, a character with Mental ≤ X that guards against it, or whose attack it guards, is discarded at once.
- A3-07 1051 服部忍: 1: until the end of the Main Phase it has every skill the target has.
- A3-07 1062 大海: discarded → it and the top X cards of your Discard Pile go back into your deck, shuffled (X = its Mental when it left).
- A3-07 1095 クララ・クロオーネ: until the end of the Main Phase, if the target is removed, it and every card on it return to the owner's hand (read: removed in any way — the "by battle or another player's card / effect" limit is not checked).
- A3-07 1127 / 1143 キャッツアイ: when its attack's damage check puts no card into the Damage Pile, you may put your deck top on it as a power card (its "name a card" effect is still by hand).
- A3-07 1130 スフィンクス: until the end of the Main Phase, the target's damage check stops when a Break card goes into the Damage Pile.
- A3-09 1411 / 1424 モリーアン: until the end of the Main Phase, if the named target leaves, this character is discarded; if this one is discarded in battle with a Controlled Character, the target is discarded.

Revise#131 — M2b batch 4: 14 more cards.
- Extra phases: A3-07 1129 ウルド (every player: an extra Discard Phase after the Draw Phase, and an extra Draw Phase before the Discard Phase); A3-10 1549 / 1552 ベルダンディ (every player: an extra Active Phase after the Active Phase; 4: the turn player gets an extra Main Phase after the Charge Phase). The phase bar shows the phase being played; extra phases don't add more extra phases.
- A3-07 1020 外園今日子: not affected by area (≪…全て≫) Project / Fast cards, nor by effects.
- A3-08 1278 / 1281 タミ: X: you set a Break card with cost ≤ X from your hand on your Controlled Character, ignoring factor and cost (class, name and Break condition still apply); then each opponent may do the same.
- A3-10 1517 / 1522 鹿島栞: an attack on you by a mental attacker is −(X); a normal attacker with Attack ≥ X makes no damage check — you discard (Attack − X) cards from your deck instead (X = its power).
- A3-10 1544 飛: set → every Permanent is discarded, and power cards of broken characters whose power = Mental go back to their owners' hands; 4: one player's whole hand is discarded (Project timing).
- A3-10 1546 モルガン・ル・フェイ: set → you may put a Permanent from your Damage Pile on your Controlled Character; Permanents on power-0 characters are discarded; a character with Permanents that would be discarded may stay by putting all its Permanents into the Damage Pile.
- A3-10 1550 / 1553 / 1584 シルマリル: Project / Fast cards and effects don't affect it; in battle, its opponent loses every skill and effect and can't be affected by Project / Fast cards or effects.
- Partly: A3-09 1410 / 1423 (no Project / Fast / effect cost from it — its auto-guard line is still by hand); A3-10 1532 / 1537 (its power card keeps your 悪魔 / 悪魔♂ on the field — its X effect is still by hand).

Revise#132 — M2b batch 5: 11 more cards.
- A3-09 1313 クロス・フレイム“なつきとふぶき”: set → every なつき / ふぶき character goes back to its owner's hand with all its cards; cards with those names can't be declared. A3-09 1307 / 1308 なつき / ふぶき: when the other one is broken by クロス・フレイム, damage = its Mental to every character (1307) / every opponent (1308), then it goes back to the hand with all its cards.
- A3-07 1197 モイライ: 2 (Project timing): the power cards of all your Controlled Characters go into your deck (shuffled); your turn ends and the next player's turn starts at its Main Phase.
- A3-10 1533 / 1538 ミナ・アグリッパ: X: until the end of the Main Phase, a guard between it and a Controlled Character deals (X) to every character; if it is discarded (battle with a Controlled Character, or not in battle), you put up to X cards of each opponent's hand into their Damage Pile.
- A3-10 1516 百式“改”: Project / Fast cards and effects that target one character target it instead; area Project / Fast cards hit only it.
- A3-07 1023 喜多村みかる: X: it gets X factor of a faction you choose; until the end of the Main Phase, the costs of your Project / Fast cards needing ≤ X of that faction go back into your deck (shuffled).
- A3-08 1266 / 1269 カッサンドラ: set or removed → every deck is turned over (its order reverses and its top card is face up for everyone — the deck pile shows it); 1 (Active Phase only): if a Break card is set on the target, its Mental −X until the end of the Main Phase.
- A3-10 1500 皆川麗夢: broken characters have the skills of the Character cards under them; 1: the target gets their classes and Break cards declared on it return their cost to the hand; 2: the target's attack, guard and effect declarations are cancelled.

Revise#133 — M2b batch 6: 6 more cards.
- A3-09 1410 / 1423 リムノレイア: when an attack on you ends its responses without a guard, it guards by itself (+X/+X for that battle, X = your Damage Pile); no Project / Fast / effect cost can be paid from it.
- A3-10 1532 / 1537 真理亜・ファウスト: X: a 悪魔 / 悪魔♂ Break card without a Break condition from your Damage Pile becomes your Controlled Character (X = its cost); if it has a name, the cost goes to your Damage Pile.
- A3-10 1559 グレース・ディアディム: 3: a Break card from your Discard Pile whose factor you meet becomes your Controlled Character with Undead until the end of the Charge Phase, then all its cards go to your Damage Pile.
- A3-07 1164 シルヴァ: those it discards in battle go to the Damage Pile; 1: a non-named Break card from your Damage Pile becomes your Controlled Character and guards at once; it goes to the Damage Pile when the battle ends (or at the end of the Main Phase without a battle).
- Card targets in piles can now ask for classes, "no Break condition", named / not named and "factor met".
- Still by hand in A3-06 … A3-10: A3-07 1053 (a Break card from your deck as a target — the deck is hidden), A3-07 1127 / 1143 ("name a card" over every card name), A3-10 1515 (a cost card set as the Permanent “糸”).

Revise#134 — M2c (Break A3-11 … A3-15), batch 1: 10 cards.
- A3-11 1683 / 1692: every player has an extra Discard Phase after the Main Phase.
- A3-11 1627 / 1636 優鉢羅: set → X cards of your choice from your Discard Pile go back into your deck (shuffled; X = its power).
- A3-13 1870 オジマンディアス: after the damage check of its attack on a player, that player discards X cards from the deck top (X = its Attack).
- A3-14 2019: breaks any unbroken character regardless of class.
- A3-15 2118 / 2123 ニーズヘッグ: no effect can keep a discarded character on the field; when your Controlled Character is discarded in battle with a Controlled Character, your deck top goes on it as a power card.
- A3-15 2088 / 2093 トラロック: at the start of each player's Main Phase, that player discards one of their Controlled Characters — if they can't, (X) damage to them and each of their Controlled Characters; an opponent's character that declares an attack or guard takes X damage (X = its power).

Revise#135 — Pack: the last A3-06 … A3-10 cards.
- A3-07 1053 美作壱与: X: you pay any X; when it resolves you choose, from the matching cards only, a Break card with this character's name and cost X from your deck or Damage Pile — it breaks this character (its factor / cost are not paid again), then the effect's cost becomes its power cards; the deck is shuffled if the card came from it.
- A3-07 1127 / 1143 キャッツアイ: "Name a card" — a choice of every card name in this match, plus "Other name" (matches no card). Until the end of the Main Phase, when it attacks a player, that player's whole hand is shown in the log; if the named card is there, the whole hand goes into their Damage Pile.
- A3-10 1515 河原瑠璃子: 1: the effect resolves first, then its cost is set face down on your Controlled Character as the Permanent “糸” (only its owner sees the card). A character with 糸: Mental −1, class 傀儡, Intercept; the card's own text does nothing. When the card leaves, it is an ordinary card again. "分類・傀儡を持つ" selectors work (its third effect).

Revise#136 — M2c batch 2: 21 more cards (A3-11 … A3-13).
- A3-11 1602 / 1611 三重野まどか: every player's drawn cards are shown to you; you see your Charge cards; an attacked player shows you the hand and you put X of it into their Damage Pile; 1: look at X from your deck top, put back in any order, draw 1.
- A3-11 1651 レックス: reveal your deck top until a Break card — it goes to your hand, the others are discarded (all shown in the log).
- A3-12 1773 / 1778 伊雑あざか: discard a Project / Fast card, then you may draw its cost; discard one from a Damage Pile, then its owner takes damage = its factor.
- A3-12 1787 / 1792 / 1839: Talents with mental Attack also deal the same number as normal damage in battle.
- A3-12 1831 / 1836: the text of every card in Damage Piles does nothing.
- A3-13 1845: choose one area — 1 damage to every character there.
- A3-13 1860 ヘルマ: no cost can be paid from the target until the end of the Main Phase, or until it takes damage. A3-13 1869 / 1874 ケイト: 1 damage to a player, then you discard 1 card of their hand.
- A3-13 1872 / 1875 流菜 and 1879 / 1884 リーナ・スピカ: until the end of the Main Phase, a character damaged by it can't attack / guard and loses skills and effects (流菜) / gets Attack −1 (リーナ).
- A3-13 1881 ノーラン・トライアンフ: damage to your other Controlled Characters or to you is taken by it instead.
- A3-13 1889 / 1892: each Break card you set gives you Charge 1 until the end of the Charge Phase.

Revise#137 — M2c batch 3: 40 more cards (A3-11 … A3-15).
- New payments: discard Controlled Characters to pay (A3-11 1653: power ≥ 1, 1 cost each from it; A3-13 1896: for its effects), hand cards pay the Boost (A3-12 1757 / 1762), Bind X with discarded characters (A3-14 1998 / 2007). The pay window shows them under "Or discard …".
- A3-11 1656 / 1665 / 1747: named attackers / guards +X/+X, unbroken ones −X/−X/−X while the attack goes on; 1: a name is given until the end of the Main Phase (an unnamed character becomes named).
- A3-11 1734 / 1744 マシット: Permanents at fast timing onto it. A3-14 2049 / 2059 千場イリヤ: fast timing; swap a Permanent for one from your hand (cost ≤). A3-14 2052 / 2061: set → a Permanent from your hand on another named Controlled Character.
- A3-13 1850 趙鏡香: before you draw, look at that many cards and put any to the bottom.
- A3-14 1917 / 1926 一色真純, 1967 / 1968 / 1978 Works373, 2024 / 2033 ラユュー (breakable by “ラユュー”; opponents' effects with cost ≤ its power are negated), 2048, 2051 / 2060 ュルョラック.
- A3-15 2072 / 2077 (+6 at power 0), 2073 / 2078 (keeps your Students), 2086 / 2091, 2087 / 2092 日之上舞香, 2102 / 2107 (Boost +2 Attack each), 2103 / 2108 ヨハンナ, 2148 / 2153 ラドゥエリエル (Eraser cost cards become characters).
- Questions Q#38 – Q#42 for the 12 cards still by hand (1756, 1890, 1916, 2025, 2132 and their versions).

Revise#138 — M2d (Break A3-16 … A3-20), batch 1: 40 cards.
- A3-16: 2170 / 2180 (set → an E.G.O. Permanent from your hand on it), 2171 / 2181 (your own Project / Fast cards don't affect it), 2172 (all your Break cards at fast timing), 2197 / 2207 (breaks a mental-Attack character, any name / class), 2199 (draw peek 5; Damage Pile limit +10), 2223 / 2233 (+2/+2 until the end of the phase it was set in), 2252 / 2262 (X = Undead / Ghost cards in all Damage Piles).
- A3-17: 2339 / 2369 / 2384 (attack on another player: the Attack Cost back to the hand), 2342 (player damage 5 or more becomes 4), 2401 / 2407 (Eraser Break card costs back to the hand).
- A3-19: 2517 / 2543 (no battle damage from those factions), 2520 / 2527 (keeps a power-0 character), 2546 (keeps your 霊能者), 2542 / 2553, 2548 / 2555 (its battle opponent is discarded at the end of the battle; each turn start every deck top is discarded), 2568, 2571 (opponents' Fast cards cost X more), 2602 / 2609 (your Mermaids), 2621 (factor of every faction +X).
- A3-20: 2682 / 2698, 2684 / 2699, 2718 / 2734 (Permanent / Project / Fast factor and cost +1), 2720 / 2735 (damage to you −X, X = cards of this character), 2754 / 2770, 2793 (5 damage to everything), 2866.

Revise#139 — M2d batch 2: 9 more cards.
- A3-16 2226 (your Creature Break cards cost 1 less; your Creatures get Offensive / Defensive / Synchro and ±0/+1/+1), 2276 (counts as a faction you choose until the end of the Main Phase — read as "also").
- A3-17 2326 / 2332 一色真純 (set on ピュア・ブライトネス: opponents' hands discarded, you may draw that many), 2370 / 2376 夜羽子 (set on ヴァンパイア・ハイブリッド: you may discard all Break cards of one character), 2386 / 2392 / 2410 レイナ (set on 魔剣姫: you may set 極星剣“ポラリス” from hand / Damage Pile on it, then damage = its Attack to an opponent's Controlled Character and its owner; its guards get Defense −X until the end of the Main Phase).

Revise#140 — M2d batch 3: 35 more cards.
- A3-19 group bonuses 2519 / 2545 / 2570 / 2627 / 2653; 2516 (damage to your Students −X); 2572 (damage to a character you pick); 2573 (guarding against it costs more); 2596 / 2607 (X = factor of your Permanents); 2597 – 2601 / 2608 女神.
- A3-20 same-name fast break when its power equals its Mental: 2683 / 2719 / 2755 / 2791 / 2827 / 2863; 2623 / 2634, 2624, 2625, 2628 / 2635, 2629 / 2636, 2756 / 2771, 2760, 2792 / 2807.

Revise#141 — M2d batch 4: 31 more cards.
- A3-18: 2433 / 2438 三ツ谷奏恵 (after a draw, put any drawn cards back, shuffle, take as many), 2434 / 2439 宮村林檎 (guards Stealth; sees power cards; on set: top 10 shown, Project / Fast cards to the hand), 2435 / 2440 and A3-20 2723 (on set: you may set a Break card of those classes ignoring factor and cost), 2463 / 2468 マッツィヤ (each turn start: name a Project / Fast card of this match — or “Other name”; nobody may declare it this turn), 2478 / 2483 パニッシャー (X damage; a named character discarded by it → X damage to its owner), 2479 / 2484 ギイェルミナ (Break cards in your Damage Pile can be declared like hand cards; 5: Discard Pile Break cards to the hand), 2493 / 2498 ジャラ・スマルト (each of your turn starts: deck top → token トライアロイド, Eraser Android 1/2/1), 2495 / 2500 DA (turn end, power < Mental: all its cards back to the deck, shuffled).
- A3-19: 2547 / 2554 / 2664 水樹鏡花 (on set: a player's hand shown, its Project / Fast cards discarded; opponents can't declare Project / Fast cards with cost ≤ its power — a cost X card counts as 0), 2650 / 2661 SARASA (the effect cost to your Damage Pile; Resist / Protect against every faction in the Damage Piles), 2651 ロッソ (attack on a player: one of that player's Controlled Characters gets Defense −X until the end of the turn — the text gives no duration).
- A3-20: 2688 ブレイブベース (deck search for a “ブレイブ” E.G.O. card or ネオカイザーブレード; “ブレイブ” E.G.O. cards at fast timing; Charge X), 2722 晴明 (“式神” Arayashiki cards from hand or Damage Pile at fast timing; breaks any 式神), 2795 / 2808 エルゼベート (breakable by “エルジェベート・バートリ” whatever the name; the target drops its power cards when it attacks / guards), 2796 モンスターハウス (Ghost Break cards from your Damage Pile; Ghost Character cards in costs you pay become Active Characters), 2826 (no battle damage from Attack ≤ X), 2828 / 2842 リルナ (drawing from an empty deck doesn't lose — the damage check still does; Infinity at deck 0; at deck 0, Main Phase start: may take a Discard Pile card).
- 分類・式神 is now a known class.

Revise#142 — Q#38 – Q#42 answered (Pack: OK as proposed), a Synchro fix, and M2d batch 5. A3-11 … A3-15 (M2c) Break cards are now all automatic.
- Fix (Pack: “1562 does not work when she is in the Damage Pile”): a Synchro join (“Join the battle (Synchro)”) could never be declared — the declaration was not routed to the battle rules. 1562's +1 Attack / Synchro from the Damage Pile was already applied; the join itself now works for every Synchro character.
- Q#38 A3-12 1756 / 1761 ソラ・エニシダ, and A3-16 2252 / 2262: on set you may declare a Permanent (from the hand; 2252 / 2262: from your Discard Pile or Damage Pile) onto this character as a real declaration — pay window, Resolve list, others may respond; 1756 ignores the factor.
- Q#39 A3-13 1890 / 1893 ォミーシス: non-battle damage to it goes to the owner of the card / character that dealt it, then X more (X = its normal Attack). Its effects target a declared effect / Project / Fast card whose text deals damage (read from the card data), cancel it, then X damage to its owner.
- Q#40 A3-14 1916 / 1925 G-ブレイブカイザー: in a battle you may merge your other untapped Machine Controlled Characters (mill that many): their Mental / Attack / Defense and skills add to it; battle damage is dealt in full to each merged one too. With a “ブレイブ” E.G.O. Permanent on it, opponents' Project / Fast cards and effects don't affect it.
- Q#41 A3-14 2025 / 2034 / 2063 エラキス: when an opponent's Controlled Character attacks you (guard step), “Set … as your Controlled Character” from the hand — factor checked, cost paid in the pay window; it enters the Control Area and guards that attack at once (no Resolve list), taking no battle damage.
- Q#42 A3-15 2132 / 2137 / 2154 クレア・コラプサー: an opponent's Project / Fast card targeting it is always discarded when it resolves, and X (its cost) power cards from your deck go on it; +1/+1/+1 for each lasting card (one that stays in the Special Area) affecting it; an instant one that resolves on it gives 1 power card.
- M2d batch 5: A3-16 2195 不動明王 (your Controlled Characters ignore opponents' Project / Fast / effects with cost ≤ its power), 2280 アルゴ (paying from it discards its power cards; an area gets Defense −6 until the end of the turn — the area is chosen when it resolves), 2306 / 2316 (on set discard one of your Erasers; when discarded you may set a no-Break-rule Eraser Break card from hand / Damage Pile as a Controlled Character), 2307 巨大艦隊 (top 10: unnamed Machines become your Controlled Characters); A3-18 2420 / 2425 氷上純 (X: +X Attack; whoever guards it / it guards takes X, and so does its owner), 2449 / 2454 リッチ (discard an Undead: (X) to any player or character, X = its Attack), 2450 / 2455 ジェシカ (from the Damage Pile at Break timing; discard a Damage Pile card: +X/+X/+X, X = its factor); A3-19 2575 / 2582 メイ・ウォーデン (put X hand cards and the cost back into the deck; a target with Mental ≤ X goes back into its owner's deck), 2648 ギンガ・バン (swap with a Machine / Cyborg♂ Break card from the hand); A3-20 2685 (Student count X; not affected by other effects), 2831 / 2844 アルテルフ (your Undead discarded by an opponent's battle or card: (1) to any player or character).

Revise#143 — M2d batch 6: 18 more cards; questions Q#43 – Q#55 for the rest of A3-16 … A3-20.
- “このカードの下に「X」がある場合、≪このキャラクター≫はインフィニティを得、…”: A3-17 2341 / 2347 (not an effect target; your Arayashiki Controlled Characters take no mental / non-battle damage), 2385 / 2391 (all your Controlled Characters get Dragoon♂; your Dragoons +2/+2/+2), A3-20 2687 / 2700 / 2881 二階堂優芽 (Bind may be paid with hand cards → Damage Pile).
- A3-16 2198 / 2208 焔式 (a guard against / by a 式神 takes X; its cards to power; "discard a 式神 or nothing happens"), 2225 / 2235 (battle damage from your Controlled Character with mental Attack: (X) to the opponent's owner, X = mental Attack − its power cards), 2303 / 2304 / 2314 迦陵頻伽 (2304 as a Controlled Character while a 迦陵頻伽 is on the field; Break rule; discard another 迦陵頻伽 instead), A3-19 2544 (characters with mental Attack ≤ X lose their factor), A3-20 2829 / 2843 芦屋道満 (costs paid from it become the token 式神どうまんちゃん 1/1/1 of a faction you choose, only 道満's effects affect it), 2868 リバース・ゲート号 (on set: declare a hand Break card ignoring factor and Break rule; Main Phase end: back to the deck).
- 2864 / 2879: the Permanent cost back to the hand is automatic (the declaration part waits for Q#54).

Revise#144 — M2e (Break A3-21 … A3-25) begins: 13 cards fully automatic, and many single lines of the others.
- New rule pieces: "全ての分類を持つ" (every class), no battle damage while guarding / in a one-on-one battle / from characters whose power differs / from characters without a skill, no mental damage ≤ its Mental, "you choose Bind 1 or Charge 2", a card that ignores its cost at fast timing, players' Draw +N / Charge N, "the Attack Cost back to the hand", Attack +N against a kind of character, X = all hand cards / characters of a class on the field.
- Flavour lines in 『…』 and "≪プレイヤー全て≫は捨て札置き場の内容を確認可能" (the Discard Pile is open anyway) no longer count as "by hand".
- Cards: A3-21 3007, 3009, 3013 / 3025, 3043, 3082 / 3096, 3083, 3085; A3-22 3152; A3-23 3352 / 3353; A3-25 3724.

Revise#145 — Q#43, Q#44, Q#45 and Q#53 answered (Pack).
- Q#43 several attacks at once (A3-16 2169 / 2179: up to X more, free; 2278 / 2288 / 2318: any number, each pays its own Attack Cost): when it attacks, its player picks all the other attackers at once (they are tapped now). The attacks are then resolved one by one on the same target — each with its own guard step, response and battle. A character of the attacked player can guard only once in the group. Event screen “Several attacks”: every attacker (Resolving = gold, Resolved = dim, waiting) vs the attacked player's Controlled Characters (Can guard = green, Guarding = blue, Guarded already / can't = dim). 2278 as a guard: other Controlled Characters may guard the same attack with it (Synchro-style, each pays its Guard Cost). A3-19 2655 / 2662: the attacked player's Mental-0 Controlled Characters must guard it; that player may add other guards.
- Q#44 A3-16 2250 / 2260: choosing it as a target of your own Project / Fast card or effect costs X (its Mental) more — paid right after choosing the target (the target can't be chosen without the power cards).
- Q#45 A3-19 2540: its battle damage is dealt as 3 separate hits; each is checked against Defense and each must be kept (Bind etc.) on its own.
- Q#53 A3-20 2794 レイ・アルカード: on set you may discard a Break card from your hand; then X (its cost) cards from your deck become power cards on it.

Revise#146 — Q#46 – Q#54 answered (Pack); Q#55 later.
- Q#46 A3-18 2448 / 2453: while it is on the field, cards in Damage and Discard Piles have no text (no abilities there, nothing declared from there); steps that act on cards in those piles do nothing (and steps on deck cards in the Main Phase); "X = Damage Pile cards" counts 0. Losing by the Damage Pile count still applies.
- Q#47 A3-18 2464 / 2469 テミス: every time a player's hand is over the limit, that player discards down at once (asked each time a hand grows); a player who discards hand cards takes that much damage (moves by hand don't count); a player whose own Project / Fast card or effect added hand cards takes that much damage (abilities and Draw Phase draws don't count).
- Q#48 A3-18 2480 / 2485 バロール: 1: choose your Controlled Character now; the next damage to バロール until the end of the Main Phase goes to it. 2: a declared Project / Fast card or effect gets another legal target you choose. 4: a card being declared is discarded.
- Q#49 A3-19 2521 / 2528: when it enters, name a Break / Character card on the field, in a Damage Pile or your hand: it gets that card's classes, skills, effects and abilities, counts as its faction (1 factor) while the card stays there; a named hand card stays shown.
- Q#50 A3-20 2686: an opponent's non-Character card is declared face down after paying; the owner of 2686 gets a window with that player's non-Character card names (or "Don't name it") and pays 1 from 2686: right → the card is discarded; wrong → (X) damage to 2686 (X = the named card's cost) and the declaration goes on. Targets are chosen before (as usual on this table).
- Q#51 A3-20 2757 / 2772 人形使い: until the end of the Main Phase the target is also your character: you may declare its attacks (on your opponents), guards and effects, paying only from 人形使い; nothing can be set on it.
- Q#52 A3-20 2759 メルキオール: Project cards at fast timing and Project cards from your Damage Pile, paying only from it.
- Q#54 A3-20 2864 / 2879 メアリー・ピュア: a Permanent in a cost paid from it may be declared right away (factor ignored) onto your Controlled Character; that declaration's cost goes back to the hand.

Revise#147 — M2e batch 2: 21 more A3-21 … A3-25 Break cards, and more single lines.
- Every player picks a card from their own zones in turn order (A3-21 2901, A3-23 3358 / 3360); 2974 / 3098 (players with more hand cards discard down to yours; players with more Controlled Characters discard one each Main Phase start; characters that battled are discarded at the end of the battle); A3-22 3261 (same-name cards from your piles to the hand); A3-23 3368; A3-24 3386 (see a player's hand, may discard a Polestar card), 3466 (search a Creature at Main Phase start; Infinity for your Creatures with the card below), 3478, 3496; A3-25 3608 (Talent Break cards at fast timing), 3609 / 3645 / 3681 / 3717 / 3789 (with a broken named character in your territory), 3612, 3716 (your Monsters +1/+1/+1 when they battle), 3719, 3752.
- Single lines: 3364 / 3536 (onto a same-name character: cost back to the hand / fast timing), 3686 (the battle opponent's cards discarded at the end of the battle), 3614 (discard a ヒマワリ instead), 3365, 3364 (Bind 1 / Intercept / Initiative / Penetrate — choose one).

Revise#148 — M2e batch 3: 22 more A3-21 … A3-25 Break cards.
- A3-21 2936 / 2951 (characters with mental Attack can't attack, guard or use effects), 2972 (Main Phase start: swap Damage Pile cards with hand cards), 3046 (opponents can't declare area Project / Fast cards — cards with no target that act on "全て"); A3-22 3115 / 3151 / 3187 / 3223 / 3259 / 3295 (1: discard this card → a card of that faction from your Damage Pile to the hand), 3119 / 3134 (Draw Phase draws doubled; cost-X non-Break cards can't be declared), 3260 / 3276 (players mill a third of their decks, rounded down; Break cards at fast timing; …), A3-23 3354; A3-24 3392 (your E.G.O. cards factor and cost −1, cost not below 1), 3423, 3429, 3441, 3532 (attacks on a player: its owner draws 1), 3548; A3-25 3682 (look at a deck's top 3, put any on the bottom).
- Single lines: 3079 (attacks characters sharing a class; Infinity +10/+10/+10 when no other shares one), 3342, 3718, 3723, 3264, 3194 (mill a player 5; (1) to an area), 3759.

Revise#149 — M2e batch 4: 26 more A3-21 … A3-25 Break cards.
- A3-25 3607 / 3643 / 3679 / 3715 / 3751 / 3787 (on set, with that faction's character in an opponent's territory: you pick 1 card of that player's hand — face down — to discard, then you may draw 1), 3722 / 3735 (return an opponent's lasting Project / Fast card to the hand; …).
- A3-21 2935 (no battle damage from a character of ≤ 2 cards), 3079 (attacks characters sharing a class; …), 3081 / 3095 and A3-24 3391 (guarding against it costs 1 / 3 more); A3-22 3157 (a power-0 character in a battle with it is discarded), 3193 (discarding a Darklore character: may take a power card from the deck), 3194 (discarded at power 0; mill 5; (1) to an area), 3315; A3-24 3389 (after the damage check: discard 1 card of that player's hand), 3404, 3427, 3463 (Main Phase start: X to the opponent with the most Damage Pile cards; a tie — you choose), 3476, 3502, 3514, 3571 / 3584 (discard another Android instead).
- 3008: your Controlled Characters ignore Project / Fast / effects with cost ≤ its power (the player part is not checked yet).

Revise#150 — Q#55 answered (Pack: build each as written); Q#13 answered (every skill and every effect is implemented). A3-16 … A3-20 (M2d) Break cards are now all automatic.
- A3-16 2199 / 2208: X: target a cost-X Ghost Break card in your Damage / Discard Pile → you declare it (a real declaration, you pay its cost), then mill X; when it is set, X cards from your deck become power cards of that character.
- A3-16 2253: characters it discards in battle: their Break cards → the owner's hand, their Character cards → the owner's Damage Pile; X: with no guard, a target with power ≤ X of the attacked player must guard it.
- A3-16 2277 / 2287 楊戩: it has every effect of the other characters (their printed effects); in a battle +X Attack (X = the opponent's printed Attack) and the opponent's printed skills; 1: a class you choose; 1: a faction you choose.
- A3-16 2279 / 2289: its damage to a player: no damage check — you choose X of that player's hand cards (shown): Character cards → Discard Pile, the rest → Damage Pile; with fewer than X, all of them and X − hand cards from the deck top → Damage Pile.
- A3-17 2356 / 2362: with “サイレントウィッチ” below and a Project card's cost paid only from it, nobody can respond; a guard against it / the attacker it guards takes damage = its Attack.
- A3-17 2371 / 2377: power-0 and unbroken characters can't attack or guard (with “銀狼” below: only characters other than your Controlled Characters); Infinity with “銀狼” below.
- A3-18 2418 / 2423: names a faction when it enters (Resist against it); at fast timing while an attack is declared; with any card below: Intercept and “1: return this card to the hand”. Break rule read as "any character, class ignored" (the faction can only be named after it is declared).
- A3-20 2721 / 2736: Main Phase start: draw 1, then discard 1; 1: hand on top of the deck, as many from the bottom; 0: 13 Break cards with different names → 32 damage to the others (48 to one controlling a character of those names).
- A3-20 2865: put in your Damage Pile by a damage check while you meet its factor and can pay: it is set as your Controlled Character (paid automatically from the characters with the most power cards), the check ends, and X damage to the character that made the check and its owner; when discarded: X damage to every player.
- A3-20 2867 / 2880: the printed skills of your other Machines; each Main Phase start: discard one of your Machines; 0: designate a Machine, mill 1, add its base stats until the end of the Main Phase, then it is discarded.
- A3-05 0866 uses the Q#43 rule (any number of your Controlled Characters attack with it, each paying its Attack Cost).
- Fix: two of the new actions had the same names as older ones (バロール's target change and メイ・ウォーデン's hand-to-deck); renamed so the right one runs.

Revise#151 — M2e batches 5 and 6 (A3-21 … A3-25 Break cards), the Kicking Tiger freeze, Game Status and Pass All (Pack, 2026-11-06).
- Bug (Pack: “the game stopped after I chose the power card for Kicking Tiger”): a triggered ability's Run / Skip intent named its ability `id`, the same field a room uses for its own log entry. In a test room the entry was filed under the ability's id and replayed after later passes, which were then all refused without a message. In an online room the id was lost. The intent now names it `trigger` (`id` is still read for old logs).
- Game Status: when nobody has acted for 30 s, a small box shows what the game is waiting for (choices, declarations, triggered abilities, the response window — who has priority and who has passed — and queued operations). Copy log copies the status report together with every log entry, ready to paste into a bug report. Details opens the full stuck log. Skip moves the game one step on: it answers the oldest choice (the fewest options), drops stuck operations, skips the oldest triggered ability, cancels a declaration in progress (refund), declares no guard, or passes for the player with priority — in that order. Any seated player may use it; it is logged (“⏭ … used Skip”) and can be undone.
- Pass All (Resolve list): passes on every item that is on the Resolve list when you click it, each time you get priority. It stops when the list is empty or when a new declaration is added on top.
- Batch 5: 3084, 3097, 3224, 3227, 3241, 3265, 3296, 3312, 3364, 3388, 3460, 3538, 3649, 3753 run by themselves.
- Batch 6:
  - 3796: declared at your Project timing → after it is set it attacks a player you choose.
  - 3720: attacking an opponent → a no-name Character card from your deck becomes your Controlled Character, ±0/+2/+2.
  - 3759: Main Phase start: mill 10 (all if fewer). Choosing it as a target of anyone's Project / Fast card / effect costs +X (X = its power). Its effect mills the target's deck, or yours instead when yours is not empty.
  - 3116: an opponent's Break card targeting a character in your territory costs +X (X = its Mental).
  - 2902: until the end of the turn it ignores the opponents' Project / Fast cards / effects.
  - 3688: mental damage to it → mill that many instead (only with enough deck cards).
  - 3262: on set: show your hand and you may put every same-name card of your Damage / Discard Pile and hand under it.
  - 3156: Main Phase start: you may declare a Break card from your Discard Pile (paying); its cost goes back to your hand.
  - 3117: Main Phase start: designate an opponent's Controlled Character; your characters may attack it this Main Phase.
  - 3366: in your Damage Pile while you meet its factor: Main Phase start: you may set it as your Controlled Character.
  - 3791: with a lasting Project / Fast card on it, same-name Break cards may be set on it at Fast timing.
  - 3646: on set: name a Permanent, a Project and a Fast card; nobody may declare those while it is on the field.
  - 3154: its attack on a player: no damage check — that many cards from the top of that player's deck go to the Damage Pile.
  - 3228: a card discarded from a hand goes to its owner's Damage Pile instead.
  - 3228 (its attack / guard): players over the hand limit put cards you choose from their hand into the Damage Pile.
  - 3121: guarded by a character whose Attack ≥ its Defense → the attack is called off and the guard's owner takes 1 damage.
  - 3501: its cost goes back to the hand and same-name cards of your piles go to your hand; with the named card below: Main Phase end, power up to Mental from the deck.
  - 3536: onto a same-name character it may be declared at Fast timing without its factor.
- Fix: 2418's “1: return this card to the hand” effect is granted to the character again (wrong modifier key).
- Still left in A3-21 … A3-25: 118 Break cards (3154's alternative cost, 3611 and others) — next batches.

Revise#152 — M2e (A3-20 … A3-22) Break cards are all automatic; M2f (A3-23 … A3-25) all but the Q#56 – Q#60 cards (Pack: "Continue M2e and M2f until done"). Also A3-02 0233 / 0373 / 0390.
- How a few new things work:
  - Area choices: "≪あなたの任意のエリア1つのキャラクター全て≫" picks one Active / Control Area; "…と、プレイヤー全て" damages every player too; 3574's "任意のエリアのキャラクター全てと、あなたの任意のプレイヤー全て" picks areas and players one at a time until Done.
  - Token Permanents: 2977 (コントラクトリング from this effect's cost) and 3302 (アームユニット from the deck top) are cards set as Permanents with the printed modifiers; they are plain cards again when they leave. Six rings: Bind 0 (the skill value is set, not added).
  - Extra costs at declaration (3153 / 3154 / 3168 / 3684 / 3698): after the normal cost, you are asked for the optional extra (designate a character and pay its power / pay X more).
  - "Decl-time" conditions ("このエフェクトの使用宣言時に、…しなければ、このエフェクトは効果を発揮しない": 3302, 3572, 3794) are checked when the effect resolves, as before.
  - Cards that change their character's battles: 3263 (+X Attack, discarded after the battle, for a character this one paid for), 3573 (guard cost +1), 3390 (boost guard tax doubled): the battle remembers who paid its costs.
  - Draws: 3723 / 3736 may take any card from the deck instead of each draw; 3685 makes the opponents' draws public and discards their cards over the hand limit (you choose).
  - 3718 discards Character / Break cards that are set from anywhere but a hand (tokens included); 3228-style replacement stays as Revise#151.
  - 3792 / 3806: the 「faction：bonus」 table counts this character's lasting Project / Fast cards of each faction (stats per card; skills with at least one; Infinity with all six factions). "攻撃力+(1)" is read as Attack +1.
  - 3810 / 3812: abilities are not switched off by "スキル・エフェクト・アビリティ全てを無効化" yet (skills and effects are).
  - 3616: only the extra X is built (Q#59).
- Cards: 2899, 2900 / 2915, 2904 / 2917, 2937 / 2952, 2938, 2940 / 2953, 2973 / 2988, 2977, 3008, 3011, 3012 / 3024, 3044, 3045 / 3059, 3048 / 3060, 3049 / 3061, 3118 / 3133, 3122, 3153 / 3154 / 3168, 3155 / 3169, 3190 / 3205, 3191 / 3206, 3192, 3226 / 3240, 3229, 3263, 3264 / 3278, 3266, 3302, 3342 / 3370, 3365, 3367, 3390, 3393 / 3405, 3424, 3428 / 3440, 3430 / 3442, 3464 / 3587, 3495, 3498, 3534, 3535 / 3549, 3572, 3573 / 3585, 3574 / 3586, 3610 / 3626, 3611, 3613, 3614 / 3627, 3647 / 3648, 3650 / 3663, 3651 / 3664, 3652, 3683, 3684 / 3698, 3685, 3686, 3718, 3721 / 3734, 3723 / 3736, 3754, 3758 / 3771, 3760, 3790, 3792 / 3806, 3793 / 3807, 3794, 3795, 3810 / 3812; A3-02 0233 (area Project / Fast cards hit only it), 0373 / 0390 (use a targeted Project / Fast card of a Damage Pile on itself).
- Fix: "このカードの下に“X”がある場合" compares the Name (not the card name) — 3501 too.
- New questions Q#56 – Q#60.

Revise#153 — Card size bar (Pack, 2026-11-06): "make it adjusting bar with 6 level. Lv 1 = Current S, Lv 4 = Current M, Lv 6 = Current L. For other level, please adjust proportionally".
- The S / M / L buttons are now a slider "Size Lv 1 … Lv 6". Card width: Lv 1 66 px (old S), Lv 2 88, Lv 3 110, Lv 4 132 (old M), Lv 5 185, Lv 6 238 (old L) — evenly spaced between the fixed levels.
- The table resizes live while dragging; the level is kept in the browser (an old S / M / L choice becomes Lv 1 / 4 / 6).
- Lv 4 – 5 use the old M hand layout (8 cards fit over the table), Lv 6 the old L one; card pictures load at the resolution of the nearest old size.

Revise#154 — Deck Builder (Pack, 2026-11-06).
- Characters are in two columns: "Character · <main factor>" (the faction with the most Character copies) and "Character · other factors". Drag between them keeps them Character cards.
- Search is a pop-up: "🔍 Search cards" opens the Card List search box, Filters & Sort and the Card List grid (picture, number, names, faction, stats) over the deck; each card has the category / −+ buttons; the picture opens the details. × or Escape closes it.
- Automatic order:
  - Character: Charge → Charge with "このキャラクターをブレイクする場合、≪そのブレイクカードのコスト≫は手札に戻る" → Draw → other; then Mental 0 → highest; then with ▼ before without.
  - Break: no name first — Mental 0 → highest, then Charge → Charge + cost to hand → Draw → other; then named ones by card number.
  - Fast / Project / Permanent keep the order you give them.

Revise#155 — Game Table: Q#56 – Q#59, Outlaw options, Pick card from deck (Pack, 2026-11-06).
- Q#56: a character counts every Initiative it has: each printed one (A3-17 2333 prints two), each card it inherits from, each Permanent, each grant. 3394 / 3406 can't be guarded with 3 or more.
- Q#57: 3461 / 3462: when your other character battles (3461: guards), you may add these to its side (mill 1 each); their Attack adds up, skills shared as in Synchro; normal damage below their total Defense is cancelled, otherwise each takes it; mental damage goes to each.
- Q#58: 3537 (with “ロュス・アルタイル” below): before a card / effect with one target resolves, you may change the target to another valid one; an opponent's Project card that targets you or your characters has no effect on those targets.
- Q#59: 3616: a card declared from the hand of 3616's opponent has the declare option "instead of the extra cost, N cards from your deck top → Discard Pile" (N = its printed cost).
- Player options → Outlaw: "Flip-up Discard Pile" and "Flip-up all Power Card" (table rules for everyone). Turning one on or off is written in the log with a red highlight (⚠ OUTLAW …), and the option is red while ON, like "Charge exceeds Draw".
- By hand → Deck → "Pick card from deck…": your deck is shown top → bottom, left → right, numbered 1 … from the top; choose cards and move them to your hand, Damage Pile or Discard Pile. "looks through their deck" is written in the log.

Revise#156 — Fix (Pack): A3-17 2385 (and 2391) "このカードの下に「ドラゴンマスター“ソフィー・ラスタバン”」がある場合、≪このキャラクター≫はインフィニティを得、≪あなたの支配キャラクター全て≫はドラグーン♂を得、≪あなたの支配キャラクターのドラグーン・ドラグーン♂全て≫に+2/+2/+2する".
- Characters that were not Dragoons got Dragoon♂ but not the +2/+2/+2: while a character's stats were being worked out, a selector that asked for its classes saw only the printed ones.
- Now granted classes are applied first, and a selector asking during that work sees them. This fixes every "…を得、≪…を持つ…全て≫に…" combination of a class grant and a class-based bonus.

Revise#157 — M2f done (Q#60 answered), M2g batches 1 – 3, Export Log (Pack, 2026-11-06).
- Q#60 answered (Pack: "1. No, X changes depending on ザラーム's real time power card. 2. Yes 3. Yes"): A3-25 3756 ザラーム runs by itself. With 5+ “ザラーム” it gives the turn player an extra turn; during it no card can be used from any hand, and only Named characters whose power is at least ザラーム's current power can pay any cost (cards, effects, attacks, guards). The lock ends if ザラーム leaves. M2f (A3-23 … A3-25) is complete.
- Log: an "Export .txt" button in the Log header downloads the whole log this viewer may see (numbered, with a header), not only the last 150 lines.
- Flavour text detection in the card text splitter is stricter (quoted lines that read like rules are kept as rules).
- M2g (A3 Saga 3 specials: A3-BS2, EP, EX01 – 05, EXPP, EXPR, EXPV, PP, PR, SIGN): about 95 more Break cards run by themselves (285 → 192 left). New engine parts: “X” lookups by drawn / placed cards, chosen-name selectors, "while battling X", player damage taken by a character instead (EP164 / EP227 / EX0265), extra and multiple damage checks (EP167 / EP187), next Project / Fast card free (EP175), draw when your side discards an opposing character (EP185), follow-up attacks (EP188), attack / guard costs into the Damage Pile for +2 (EP191), Project damage +1 (EP260), a stack item shielded from Fast cards and other effects (EP262), hand cards with a class paying effect costs (EP252), a Break free only onto an opponent's character (EP243), stat-or-stat choices, name-a-type guesses, delayed area damage, token with its own attack ability (EP179) and more.
- New questions Q#61 (EP184 expansion names) and Q#62 (EP222 timing) — both built with the proposal.

Revise#158 — M2g batches 4 – 9 (Pack: "continue … M2g, skip M2h, then M3a").
- About 165 more Saga 3 special-set Break cards run by themselves; 27 are left by hand (Q#63). M2g goes from 285 to 27 left (192 at Revise#157).
- A3-PR personality promos (PR326 – PR329): "…以外が使用する場合、このカードは「X」と同じカードとして扱う" — the card now plays as the card it names.
- New engine parts: extra Main + Power Card Phase (EP282), effects only in an extra phase / turn (EP313), once per turn (EX0021), only in your Main Phase, battle-start triggers for the attacking / guarding side (EP330 – EP335), "when your side's battle discards…" for any battle (EP365), owner damage taken by a character (EP227 / EX0121 / EXPR063, by name / class / tag), next damage negated (EX0182), name-a-type and name-a-series guesses (EP247 / EXPR052), Break onto a 「card name」 for free (EP313) or 3 less (EP397), a Break rule naming the cards a character is made of (PR336), tags such as フッケバイン / 戦闘機人 in selectors and cost changes, a card destroyed when “X” is on the field (EX0182), Permanents immune to Project / Fast cards (EX0039), costs back to hand / into the Damage Pile by more rules (EX0353, EX0358, EX0366, EX0424, EX0517, EX0573, EX0574, PR338), "next battle" boosts (EX0509 / EX0536), keep an ally once (EX0396), Synchro attack for free (EX0173), card text searches, token Permanents in numbers (EX0277 / EX0545) and more.
- New question Q#63.

Revise#159 — M3a (Permanent / Project / Fast · A3-01 … A3-05), first pass (M2h skipped as asked).
- About 95 of the 130 cards with rules text that still needed hands now run by themselves: Permanent 26 → 8 left, Project 53 → 9, Fast 51 → 18.
- A Permanent's own abilities work for the character it is set on ("このキャラクター" = that character): +X stats with an "Xは…" line, discard itself at power 0, return itself to the hand, damage for its owner, triggers on battles, guards and kills.
- New engine parts: "その後、あなたのターン / メインフェイズは終了する", "このカードは、使用宣言時から効果終了時まで、ファストカード・エフェクトの効果を受けない", costs that send each card type to a different place (0237), characters that can't pay by a rule (0061 / 0303), declarations that do nothing (0243 / 0489 / 0678), all effects negated (0766), cost up by factor (0240), damage to the player who resolves a Project / Fast (0629), draw instead of a damage check (0768), hits after an attack (0597), draws when opponents pay (0277), skills lost when paying (0242), "pay or be discarded" (0026), guard-triggered cancels (0676 / 0870 / 0874), Attack ↔ Defense swap (0485), cards back to hand / Damage Pile at the end of the Main Phase, and more.
- Selectors: "X以下の精神力の", "ネームレベルでなく", "AまたはBの" (two factions).
- Flavour lines in 『…』 are no longer read as rules.

Revise#160 — Replay (Pack, 2026-11-06: "Please add Replay function … make function to see log the same as show in game as separate functional for Replay").
- The game log is the list of player actions, so a replay builds the table again from the start, one action at a time — 1 s per action at 1×, speed 0.5× / 1× / 1.5× / 2× / 3×. Play / Pause, one step back / forward, to the start / end, and a slider to jump to any step.
- Log → "Replay": watch the current game again; the live game keeps running and is back as it is when you close the replay. Nothing can be sent during a replay.
- Log → "Save replay": a replay file (.json) with every action. It holds the hidden cards, so share it after the game. Lobby → Replay → "Open a replay file".
- View: any player's side; "All open" (every card face up) for a replay file, a solo game or a finished game only — in a live game you see only your own side.
- "Replay log": a separate log window with the same lines as the in-game log, numbered, up to the current step.
- Q#61 / Q#62 answered (both as built). Fix: a crash when an opponent paid a cost while 0277 was active.


Revise#161 — M2g complete; English ability / target explanations (Pack, 2026-11-07: "Go for M2g to complete first" · "For ability explanation and Target Explanation, can you make it English instead of Japanese?").
- The last 27 Saga 3 special-set Break cards run by themselves (Q#63 answered); M2g has no card left by hand.
- Used "as a Fast card" from the hand (EX0223, EX0228, EX0232, EXPP023): the hand shows "Use X as a Fast card"; it pays its printed cost, needs its printed factor and is played with the Fast card's text.
- Forced battle (EX0136: the target battles this character) and forced guard (EX0137: the attacked player chooses a character that must guard, at no cost; normal guards are not allowed).
- EX0155: every “蟲” token in your Control Area attacks the same target at the same time, for free; each attack can be guarded.
- Damage-replacement prompts: EX0164 (name a card, mill 5: if it is among them, no damage), EX0378 (discard a Permanent set on it: no damage).
- EX0192 Install: the effect's cost becomes a Permanent “インストール” on this character (+0/+1/+0 each; the first one also gives −1 Mental and Permanent 1); when this character deals damage, all of them are discarded.
- Single cards: EX0231 (set at Project timing → may attack a Named character for free), EX0238 / EX0524 (stats per your lasting Fast / Project results on it; power from the deck at Main start / end), EX0250 (pay more to add targets), EX0256 (with Initiative it deals damage at both timings), EX0384 (X more damage to a surviving battle opponent, once per battle), EX0389 (the first Nanoha Named Break each turn: factor and cost −1), EX0390 (free E.G.O. Nanoha Project at Main start, then the Main Phase ends), EX0402 (set only by 「融合(シグナム+アギト)」; its battle opponents ignore Project / Fast cards), EX0505 (back to the hand from the damage check when its factor is met), EX0515 (an opponent's Project / Fast that targets it hits that card's owner for this character's Attack), EXPP024 (pay 1 more to take back a 「高町なのは」 Project / Fast), EXPP025 (Fast timing while a character not under your control attacks), EXPR037 (a “…” Break set on it → hand cards as power; ±0/+X/+X in battle while an opponent's Project / Fast / effect result is in force), EXPR046 (costs exactly X = Permanents; deals X), EXPR058 (one-time rule; no card in the list names a 職業群), PP117 (a Break or Character card discarded by mental damage goes to its owner's hand; its power cards and Permanents go to the Discard Pile).
- English instead of Japanese (Pack): Card List details — Abilities show the English line (Japanese as the tooltip), Targets show the English ≪…≫ text (Japanese as the tooltip), Conditions show the English line. Table card details — Effects and Abilities show the English line only (Japanese as the tooltip); the Japanese line shows only when the card has no English line for it.

Revise#162 — Game Table requests of 2026-11-07, Deck image columns, M3a batch 4 (Pack, 2026-11-07).
- Log: every line caused by a by-hand action (moving a card or a character by hand, shuffle, draw, look at the deck, field effects added / ended, damage by hand) and every "✋ By hand" step has a pastel orange highlight, in the Log and the Replay log. The .txt export marks those lines with ✋.
- Deck Builder → Export → Image: the image now uses the board's columns and order (Revise#154): "Character · <main factor>", "Character · other", Break, Fast, Project, Permanent, each in the automatic order. "All decks" images follow it too.
- M3a: 6 more A3-01 … A3-05 cards run by themselves — 0098 (X = the target's power), 0591 (broken characters: no damage from unbroken ones, +X Attack in battle), 0735 (broken characters take no battle damage from Mental ≤ their own), 0837 (cost back to the hand onto a character with ピアスデモン), 0871 (choose X Erasers: −X/−X, no guard / effect), 0422 (choose X: no Project effects, no cards set on them until the end of the Power Card Phase).
- A3-05 0722 (Pack: "It should be only when "Yuki Nozomi" is set"): "このカードがセットされた場合" now fires only when that card itself is set (or the character itself enters), not when a Permanent or another card is set on the character later.
- A3-17 2325 (Pack: "All players should be able to see every other player's hand except the A3-17 2325's owner … click at player's field header to see hand anytime"): click any player's field header to look at their hand; the cards open to you are shown (✋ count gets 👁 when that hand is open to you), the rest stay hidden.
- Character frame: the Power Card section is pastel yellow, the Permanent section pastel light blue; Project / Fast cards that target the character are shown on it in pastel pink (while declared, and while their lasting result is on it) instead of in the Special Area.
- Pay screen: opens on the right side of the screen (it can still be dragged), so the field stays in view.
- Cost back to the hand pop-up: when the cost goes back by Offensive / Defensive / Infinity, the cards are shown face down.
- Undo: "Agree / Refuse" is an event pop-up now.
- Triggered abilities (Pack: "When Ability is run, do not confirm player. No need to put ability to Resolve"): an ability runs at once — no Run / Skip question and not on the Resolve list, so nobody answers it (this replaces Q#29). An ability that needs a target asks for it in an event pop-up; the target is clicked on the field. Also "…可能" abilities run without a question (Q#64).
- Battle (Pack: "After Attack and Guard are made, all of player should be able to use Fast timing without order"): from the response step on, every player may answer or pass in any order (Q#27's order stays outside battles).
- Resolve screen (Pack bug report): it no longer jumps to the top when the page redraws; the Pass / Next buttons are at the top; the newest declaration is at the top, the battle below; "Last battle" is removed. What it shows is what matters for resolving (Pack): a Set shows the card played; an effect whose cost goes back to the hand shows those cards (face down for others when by a skill); a battle shows the pictures of the attacker and the guard (or the target) with their Status and Skills now — not the attack / guard costs.
- Changing Target (A3-15 2105 オルタレイション・マジック): an event pop-up — the old target on the left, the new targets to choose on the right; they can also be clicked on the field (blue border), as when the card was declared.

Revise#163 — Pack bug report: A3-17 2325 vs A3-24 3465 with A3-20 2696 (2026-11-07).
- Fix: "スキル全ては無効化される" now removes every skill of the character, also the ones granted by modifiers added after it (before, a skill grant that came later in the list came back, and the Initiative count of the cards it is made of was still counted). A3-20 2696's negation runs when the battle starts (after the response step), so during the response step the Resolve screen still shows the skills.
- Mental damage and Bind: asked as Q#65 (the current rule is not Pack's rule).

Revise#164 — M3b … M3f, batch 1 (Pack, 2026-11-07: "continue card implementation until m3f").
- About 130 more Permanent / Project / Fast cards of A3-06 … A3-25 run by themselves (cards still by hand: M3b 101 → 67, M3c 67 → 49, M3d 70 → 47, M3e 128 → 87, M3f 112 → 96).
- "このカードの使用宣言時に、プレイヤー1人 / あなたの支配キャラクター1人を指定する": chosen when the card is declared, like a target (A3-16 2312 …).
- Cards with modes ("以下の効果から1つを選択して使用宣言する。「…」「…」"): the hand menu offers each effect ("Card — effect 1: …"); the chosen effect is the card's text until it leaves (targets, factor and cost). A mode only for a player who did not go first, and a mode with a lower factor, are supported (A3-20 2697).
- "≪このカード≫は、W4のファストカードとして使用宣言可能" (超 / W / ダ / 極 / イ / 阿): the card can be used as a Fast card with that factor (A3-20 2764 …).
- Permanents: "このキャラクターが捨て札される場合、≪このカード≫をあなたの支配キャラクター1人に移動することが可能" (asks the owner where to move it), "このキャラクターのパワーが0の場合、≪このカード≫を捨て札する", Permanents for one named character ("≪このカードをセットされている“X”≫は…", "このエフェクトのコストを“X”以外から支払うことはできない"), for a class ("このカードがタレント・タレント♂にセットされている場合" / "…以外にセットされている場合"), "this character gains a class" (スチューデント, ウォリアーウォリアー♂ …), immunities against "Fのキャラクター・X・X♂".
- Damage Pile triggers: "このカードが(ダメージ判定によって)ダメージ置き場に置かれた際に、このカードのオーナーがこのカードの必要ファクターを満たしていた場合、…" (A3-07 1205, A3-11 1714, A3-14 1999, A3-16 2256); "あなたのメインフェイズ開始時に、あなたの手札またはダメージ置き場にあるこのカードを捨て札することが可能…" (A3-19 2522 …).
- "あなたの手札からブレイクカードがセットされた場合、それがこのターンにあなたが最初にセットしたFのブレイクカードならば、…" (A3-25 3617 …).
- While it lasts: "メインフェイズ終了時まで、≪パワー0のキャラクター≫ / ≪パーマネントカード全て≫ / ≪アタック宣言したキャラクター全て≫を捨て札する".
- New rule pieces: deck searches by type / faction / name level, power cards onto a target from your Damage Pile or the top of a deck, characters returned with every card set on them, discard all unbroken characters of a player you choose, each player discards one of their Controlled Characters, cost-back for several card types, declaration bans by type, ▼ as a skill to give, selectors "Fのキャラクターまたは X", "▼またはインターセプトを持つ", "精神攻撃を持つ", X = "あなたとあなたの支配キャラクターの持つFのファクターの合計".
- New question Q#66 (joke cards of A3-23).

Revise#165 — Q#64 – Q#66 answered; M3b … M3f batch 2 (Pack, 2026-11-07: "go next").
- Q#64: an optional ability ("…可能") asks Run / Skip in an event pop-up again (mandatory ones still run at once, and a Run never goes to the Resolve list). Player options → "Run optional abilities without asking": OFF by default; ON runs them at once for you.
- Q#65 mental damage: if the mental damage is at most the power cards of a Controlled Character, that many power cards are discarded; if it is more, none are discarded and the character is defeated — but a character with Bind (any X above 0) is then not defeated and loses no power card ("only in case it is defeated"). An Active Character is defeated when the mental damage is at least its Mental; Bind protects it too. Bind X stays as it was for every other way of leaving the field.
- Q#66 A3-23 joke cards: the card text before "フールテキスト:" is the card's text (most now run by themselves). Outlaw → "Fool text" (table rule, written in the log) makes them play their フールテキスト instead; its real-world instructions (デコピン, birthdays, …) are shown to every player in the log automatically ("🃏 Fool text — …").
- M3b … M3f: about 40 more cards run by themselves (cards still by hand: M3b 67, M3c 44, M3d 39, M3e 79, M3f 88). "このカードはあなたの対戦相手のターンにのみ使用可能", "このカードの使用宣言時に、あなたの任意のあなたの手札X枚を捨て札する" (X = how many; asked when it resolves, when no target depends on X), cards in your piles with a class as targets, named / faction Break cost back.
- New rule pieces: A3-18's "Fのファストカードと、Fのキャラクターのエフェクトの効果を受けない" modes, "目標がアタック宣言している場合、目標に…して判定する", "≪あなたのデッキ≫から、コストX以下のブレイクカード1枚を、コストを支払わずにセット宣言する", "目標の≪プレイヤー1人≫の手札から、あなたの任意の手札2枚を捨て札する" (you look and choose), "本来の攻撃力を失い、(X)を得る", a battle-start discard of the target's opponent, no hand charging until the Power Card Phase ends, Break cost −1 by class, "Xは場に出ているこのカードと同じ名称のカードの枚数", cards in your Damage / Discard Pile set as Controlled Characters, selectors デュアル / 同じネームが2体以上 / 捨て札置き場と同じ名称 / パワーX以下のXまたはY.
Revise#166 — M3b … M3f batch 3 (Pack, 2026-11-07: "e" / "Continue").
- M3b … M3f: about 27 more cards run by themselves (cards still by hand: M3b 66, M3c 44, M3d 38, M3e 65, M3f 77).
- Lasting watchers: a Project / Fast card can now keep watching until its effect ends — "目標がバトルした場合、バトル終了時に≪このカード≫を捨て札する" (2950), "目標がダメージを与えた場合、≪このカード≫を捨て札する" (3057, its Bind 0 ends with it), "≪あなた以外のプレイヤーの、コストを支払った支配キャラクター全て≫を捨て札する" while it lasts (2982), "アンドロイドがダメージを与えた場合、≪そのキャラクター≫は捨て札される" (3089), "…の、ネームを持つブレイクカードがセットされた場合、≪そのカードのオーナー≫は…" (2981 / 3053), "目標がプレイヤーにアタックした場合、通常のダメージ判定の後、目標を捨て札する" (3330), "対象がプレイヤーにアタックした場合、このカードを捨て札する" and "対象が…バトル相手を捨て札した場合、…パワーカードとして…セットする" (3767). When such a card is discarded, its lasting effect ends.
- New rule pieces: "≪T≫は、Aず、Bず、Cない" read clause by clause (3624 / 3628: "プロジェクトカード・このカード以外のファストカード・エフェクト・アビリティの効果を受けず、アタック・ガードできず、コストを支払うことができず、カードをセットすることができない"), "メインフェイズ終了時に、このカードを目標にパワーカードとしてセットする", "目標の≪T≫に、あなたのデッキの上からカードを1枚引き、パワーカードとしてセットする", "≪あなた≫は全ての勢力のファクターをX得る" (2766), "そのキャラクターを場に残す効果を受けない" (3511), "この効果で目標が捨て札される場合、目標を場に残す効果全てを無効化する" (3200), "≪プレイヤー全て≫はXドローする。Xはそれぞれの支配キャラクターの数" (3436), "その後、あなたのデッキの上からカードを2枚捨て札することで、≪このカード≫をオーナーの手札に戻すことが可能" (3439), "ネームを持たないキャラクター" (3347), "ドロー-Xを持つキャラクター" (3578), "攻撃力全てを失う" (3660), "…はアタックできない" (3581), "このカードをダメージ置き場に置くことが可能" (2729 / 3623), the class-icon cost-back while it lasts, "カード名称に「X」を含む…" deck searches and more.

Revise#167 — Deck Builder red frame (Pack, 2026-11-07: "In Deck Builder, Could you put red frame to the card that has not been implemented or non-automatically."); M3b … M3f batch 4 (Pack: "Go next until all completed").
- Deck Builder: a card the Game Table can't run fully by itself (its rules are "partial" or "by hand" in tools/rules_compile.py) has a red frame on the deck board and in the Search cards pop-up; the summary bar shows "Red frame: N not automatic in the Game Table" when the deck has any. build.py writes the list into data.js ("na"), so it follows every rule update.
- M3b … M3f: about 16 more cards run by themselves (cards still by hand: M3a 26, M3b 52, M3c 43, M3d 37, M3e 65, M3f 77).
- New rule pieces: "このカードの使用宣言時に、あなたの任意のあなたの手札X枚を捨て札する" when the target needs X (discarded at the declaration, X = how many; 1170), "このエフェクトの使用宣言時に、あなたの任意のあなたの手札1枚を捨て札する" (at the declaration; 1232 / 1235), "<condition>場合、…" sentences (checked when it resolves; 2496), "対象は / 対象に / 対象の / 対象から…" (the characters of the sentence before; 1135 / 1351 / 1950), "ブーストXを与え、攻撃力に+Xする", "攻撃力に-X・+(X)する" / "+X・ー(X)する" (normal ↔ mental attack; 1244 / 1247), "≪このキャラクター≫からアタックコスト(・ガードコスト)を支払うことはできない" (1382 / 1449), "≪このキャラクターから支払われたアタックコスト / エフェクトのコスト≫は…" (Damage Pile, top of the deck, hand, back into the deck and shuffle; 1231 / 1244 / 1317 / 1349), Permanents for a named character whose text names it inside ≪…≫, "≪このキャラクターのアタック宣言に対してガード宣言した支配キャラクターのオーナー≫は、1ドローする", "≪…を持つブレイクカードのコスト≫は1減少する" for every player (1481), "ファクター全てを失い、…", "あなたの任意の、ブレイクしていないあなたの支配キャラクターX体を捨て札する" (1389), "≪あなたの任意のあなたの手札X枚≫をあなたのダメージ置き場に置く。その後、≪あなたのダメージ置き場のカードX枚≫を手札に戻す" (1387), "あなたの任意のあなたの支配キャラクター1人を捨て札する。…Xは捨て札したキャラクターの通常攻撃力" (1451), selectors "ネームを持たない" / "…-Xを持つ".

Revise#168 — Hold types (Pack, 2026-11-07: "For Hold functional, please separate "Hold"'s type. Make it adjustable … Please declare all type to be hold and confirm with me before implementation"; confirmed: 4 types with Permanent counted with Break, and an own Undo switch); M3 batch 5 (Pack: "please continue").
- Hold is split into types, each ON / OFF per player (all ON by default): Attack / Guard (a battle waiting for answers: after the guard, after "No guard", after an attack on a character, and ▼ faction attacks), Project (a Project card is declared), Fast / Effect (a Fast card or a character's effect is declared), Break / Permanent (a Break or Permanent card is declared onto a character), and Undo ("Another player's Undo waits until you agree" — replaces Hold ON for the undo agreement, Revise#112). The newest declaration on the Resolve list decides which type applies (a Fast card answering a Project uses Fast / Effect). A type that is OFF works like Hold OFF did: you are not waited for, and you may still answer while the window is open. The Hold button opens a menu with the five switches and "All ON" / "All OFF" (the four answer types) and shows "Hold ON", "Hold OFF" or "Hold 3/4"; Game status lists each player's types. Old logs with the one switch ({t:"hold", on}) set every type.
- M3 cards: about 10 more run by themselves (cards still by hand: M3a 26, M3b 50, M3c 43, M3d 35, M3e 62, M3f 77). A bug fix: several card selectors written after a comment in tools/rules_compile.py were never used ("パーマネントカードがセットされている", "アタック宣言した", …).
- New rule pieces: "あなたの任意のエリア1つを指定する。≪指定したエリアのキャラクター全て≫にNダメージ" (2176), "≪ガード宣言されたキャラクター≫のアタック宣言を取り消す" while it lasts (2374), "目標にガード宣言されたキャラクターのアタック宣言を取り消す" (1388), "あなたの任意の分類1つ" chosen when it resolves — to give, to lose, or in a selector (1320 / 3164 / 3239), "目標の精神力と耐久力を入れ替えて判定する" (1320).

Revise#169 — Game Situation (Pack, 2026-11-07: "Please add functional to adjust 'Hold' for every players according to "Game Situation" … should be Enabled / Disabled before the game started. The room creator can configure before "Create Room" … set as "Shared Setting". Anyone can declare the change of situation. When declared, Use event to show "[Player Name] declares [Game Situation]". Fade in 1s, countdown for 3s, Fade out 1s … No need to show "Hold" in this case, Just showing game situation and explain … when hold left cursor for more than 1s in each situation.").
- Lobby: "Game Situation" checkbox (off by default), chosen by the room creator before the room is created (table rule S.rules.situation; in the create intent).
- With it on, every player's Hold follows one shared situation (Skip = not waited for, Not Skip = waited for):
  | Situation | Attack/Guard | Project | Fast/Effect | Break/Permanent |
  | Building | Skip | Skip | Skip | Skip |
  | Interfering | Skip | Not Skip | Not Skip | Skip |
  | Conflicting | Skip | Not Skip | Not Skip | Not Skip |
  | Engaging | Not Skip | Not Skip | Not Skip | Not Skip |
  The game starts as Building. Any player may declare another situation at any time during the game ({t:"situation", value}; undoable); the log says "[Player Name] declares [Situation]" and every player sees an event pop-up: fade in 1 s, a 3-2-1 count down (3 s), fade out 1 s, with what the situation skips.
- The Hold menu is not shown then: the side panel shows the four situations (the current one highlighted); resting the cursor on one for 1 s shows what it skips. The Undo switch (Revise#168) stays per player, in Player options. Game status shows the situation.

Revise#170 — M3 batch 6 (Pack, 2026-11-07: "After this is completed, continue implement card.").
- About 24 more cards run by themselves (cards still by hand: M3a 26, M3b 44, M3c 41, M3d 30, M3e 59, M3f 71).
- New rule pieces: "このカードを捨て札することで、≪このキャラクター≫からアタックコストを支払ったものとして扱うことができる" (the pay window offers this Permanent; 1280 / 1283), "このカードが除去される場合、≪このカード≫をオーナーの手札に戻す" (2256), "このカードが捨て札になる場合、≪あなたの任意のあなたの手札1枚≫を捨て札する" (3267), "このカードが対戦相手の使用したカード・エフェクトの効果によって捨て札になる場合、≪あなた≫は3ドローする" (1101), "このカード以外に、このカードと同じ名称のカードがダメージ置き場に1枚以上ある場合、対象はインターセプトを得る" (1350 / 3319), "このキャラクターを構成するキャラクターカードの持つスキル全てを得る" (3305), "アタックを受けたプレイヤーの手札全てをダメージ置き場に置く。その後、…Xドロー (X = ダメージ置き場の枚数)" (1220 / 1223), "+(1)する" (3197), X = "あなたの支配エリアの…のネームレベルキャラクターの数" (3762), "目標が捨て札になる場合、このカードを捨て札することで目標を場に残す" (a keep option; 2003 / 2482), "目標のアタック宣言に対してガード宣言するキャラクターのガードコストは1上昇する" (1947), "目標にセットされているパーマネントカード全てを…ダメージ置き場に置く" (2467), "このカードは…を支配している場合にのみ使用可能" (2632), "≪このキャラクター≫は支配キャラクターを目標にアタック宣言可能。…ガードコストは1上昇する" (2309), "あなたの任意の対戦相手1人のテリトリーの、各勢力のキャラクター1人ずつを捨て札する" (3580), "あなた以外のプレイヤーにブレイクカードをセットされない" (3583), "アビリティを持つキャラクター" (3732), "目標の持つコストX以下のエフェクト全てを無効化する" (3733).

Revise#171 — M3 batch 7 (Pack: "continue implement card").
- About 10 more cards run by themselves (cards still by hand: M3a 26, M3b 42, M3c 39, M3d 28, M3e 58, M3f 70).
- New rule pieces: "目標の持つスキル・エフェクト全てと、目標のアタック宣言・ガード宣言を無効化する" (1454), "目標はファクター全てを失う", "≪このキャラクター≫は、ドラグーン・ドラグーン♂を目標にアタック宣言可能" with X = the opponents' Damage Pile Break cards of a class (1712), "あなたのダメージ置き場のカード枚数が7枚の場合、…+7する" (1775), "≪このキャラクターとのバトルによって捨て札されるブレイクしていないキャラクター…≫を、そのオーナーのダメージ置き場に置く" (1775), "このキャラクターがバトルした場合、バトル終了時に≪このカード≫を捨て札する" and "対戦相手が使用したプロジェクトカード・ファストカード・エフェクトの効果によって除去される場合、このカードをダメージ置き場に置き、…場に残す" (1199), "目標のオーナーは目標を構成するカード1枚を捨て札することで、目標を場に残すことが可能" with X = the target's Break cards (2913), "精神力、攻撃力、耐久力のいずれか1つを指定する" (chosen when it resolves; 2525), "≪ネームを持つブレイクカードの必要ファクター≫はX減少する" and Break cards with a name at Fast timing (2285), "目標の≪あなたの対戦相手の捨て札置き場のキャラクターカード1枚≫を、そのオーナーの支配エリアにセットする" (3341).

Revise#172 — M3 batch 8 (Pack: "Go next").
- About 17 more cards run by themselves (cards still by hand: M3a 26, M3b 36, M3c 36, M3d 26, M3e 56, M3f 69).
- Discount at the declaration: "このカードの必要ファクターとコストは、このカードの使用宣言時に、あなたの任意のあなたの手札(のFのカード)1枚を捨て札する / ダメージ置き場に置くごとに、1ずつ減少する" (1074 / 2733 / 2986 / 3804): when it is declared from the hand, the player first chooses any number of such hand cards; each one lowers the cost by 1 and the needed factor by 1 (the largest part, as for other factor reductions). It may be declared when it could be paid with the discount.
- New rule pieces: "“X”があなたの支配エリアにセットされている場合、捨て札になった≪このカード≫はオーナーの手札に戻る / ≪このカード≫をファストカードのタイミングでセット宣言可能" (1268 / 1271), "≪あなたのデッキ≫の、…を持つブレイクカード1枚をあなたの手札に加える" (1382), "本来の勢力に加え、あなたの任意の勢力1つのキャラクターとしても扱われ…" (1416), "分類を1種類だけ持つ" / "2種類以上の分類を持つ" (1421), "このカードがセットされた時にアタック宣言が行われている場合、…アタック宣言を取り消す" (1774), "このカード以外のファストカードの効果を受けない" (1976), "ガードコストを無視してガード宣言可能" (2727), "場のキャラクター全ては、分類に関わらず、≪…を持つブレイクカード≫でブレイク可能" (2232), "目標に与えられる精神ダメージにー(X)して判定する" (1922), "Xは…の数が上限の、あなたの任意の数に等しい" (X chosen when it resolves; 2605). X set by a step ("X = how many were discarded") now reaches the later steps even after the game state was copied.

Revise#173 — M3 batch 9 (Pack: "Go next").
- About 12 more cards run by themselves (cards still by hand: M3a 26, M3b 36, M3c 33, M3d 26, M3e 53, M3f 66).
- New rule pieces: "≪あなた≫は、あなたのデッキの上のカード2枚をあなたのダメージ置き場に置くことで、このキャラクターからアタックコスト・ガードコストを支払ったものとして扱う" (the pay window has a "Top 2 cards of your Deck → Damage Pile" button; 3269), "このキャラクターがバトルする際、≪バトル相手のパワーカードX枚≫を捨て札する (X = ネームを持つE.G.O.のブレイクカード)" (3397), "このキャラクターがバトルによるダメージを与えた場合、≪…ダメージを受けたキャラクターにセットされている、パワーカード全て≫を捨て札する" (3231), "このカードが…以外にセットされている場合、≪このカード≫はパーマネント-1を得る" (1835), "捨て札置き場のカード3枚までをデッキの上に戻す。その後、デッキの下から同じ枚数捨て札する" (3273), "プロジェクトカードの対象 / 目標になる場合、…プロテクト…を得る" (when a Project card is declared on it; 1603), "ガード宣言された場合、バトル終了時まで…レジスト…を得る" (1603), "このカードが捨て札された場合、≪このカード≫をオーナーの手札に戻す", "このカードが…キャラクターにセットされている場合、≪このキャラクター≫は…を得る", a Permanent "≪このカード≫は、プロジェクトカード・ファストカード・エフェクト / 対戦相手のカードの効果を受けない" (it can't be chosen by them; 2027), "≪このカード≫の必要ファクターとコストは、あなたの支配エリアの異なる勢力のキャラクター分減少する" (3619), "あなたのメインフェイズ開始時に、≪あなたの任意のあなたのダメージ置き場のカード1枚≫を、このキャラクターにパワーカードとしてセットする" (3763).

Revise#174 — M3 batch 10 (Pack: "Go next").
- 4 more cards run by themselves (cards still by hand: M3a 26, M3b 35, M3c 32, M3d 25, M3e 53, M3f 65).
- A Project / Fast card that becomes a character: "≪このカード≫を、勢力なし、分類・式神を持つ、4/3/4のあなたの支配キャラクター、“護法童子”としてセットする。“護法童子”はアビリティ「≪あなたの支配エリアの式神全て≫は、…を得る。」を持つ" (3661: the card goes to your Control Area Back as that character; its ability lasts while it is on the field), "“前鬼”または“後鬼”としてセットする" (choose which; 2552), "式神阿式" (X hand cards as its power cards, stats = power, only Guard Costs from it, its Attack Cost may be paid by putting a hand card into your Damage Pile; 1356).
- "このカードがセットされた場合、≪あなたの任意の数のあなたの手札≫を、…ミラーパネルとしてセットしてもよい" (each chosen hand card becomes a ミラーパネル; 1760), tokens "勢力なし、マシンの、チャージ1を持つ0/0/1の…" read part by part, X = "あなたの支配エリアのミラーパネルの数".

Revise#175 — M3 batch 11 (Pack: "Go next").
- About 10 more cards run by themselves (cards still by hand: M3a 21, M3b 32, M3c 32, M3d 25, M3e 53, M3f 64).
- New rule pieces: "ブレイクしているキャラクターが捨て札になる場合、…デッキに戻し、そのデッキをシャッフルする" while it lasts (0340), "手札上限を越える手札を持つプレイヤー1人の手札が手札上限に等しくなるまで、…あなたの任意のカードをオーナーのダメージ置き場に置く" (0344), "目標がバトルまたは、あなた以外のプレイヤーの…効果によって場から除去される場合、目標のパワーカード全てをオーナーの手札に戻す" (0419), "あなたのターン開始時に、≪このキャラクター≫に、あなたの任意のあなたの手札X枚をパワーカードとしてセット可能" (0640), "X人までの支配キャラクターで同時にアタック宣言 / ガード宣言可能" (0129, as the existing multi-attack), "支配キャラクターとのバトルによってバトル相手を捨て札したキャラクターのオーナーは、…パワーカードとして、そのキャラクターにセットする" while it lasts (1136), "目標と同じネームを持つカード1枚をあなたの手札に戻すことができる" (1102), "≪あなたの任意のキャラクターX体にセットされているカード全て≫をそのオーナーの手札に戻す" (1419), "≪あなたの任意の勢力1つのキャラクターにセットされているパワーカード全て≫を、オーナーの手札に戻す" (3730), "その後、あなたのメインフェイズは終了する".

Revise#176 — M3 batch 12 (Pack: "Go next").
- 7 more cards run by themselves (cards still by hand: M3a 21, M3b 31, M3c 32, M3d 25, M3e 53, M3f 58).
- New rule pieces: "あなたがこのキャラクターにネームを持つFのブレイクカードをセットした場合、…" (only your own named Break card of that faction; 3433 / 3469 / 3505 / 3541), "このカードがダメージ判定によってあなたのダメージ置き場に置かれた場合、≪このカード≫を、…キャラクター1人にセットする" (1317), "あなたのメインフェイズ終了時に、≪あなたの手札のゴーストを持つキャラクターカード1枚≫を、あなたの支配キャラクターとしてセット可能" (3432), "このカードがあなたのダメージ置き場にある場合、≪あなたのパーマネントカード全て≫は、対戦相手のカードの効果を受けない" (3655).

Revise#177 — M3 batch 13 (Pack: "Go next").
- 8 more cards run by themselves (cards still by hand: M3a 21, M3b 31, M3c 30, M3d 23, M3e 50, M3f 58).
- New rule pieces: "≪精神力X以下のキャラクター≫にセットされているパワーカード全てをそのオーナーのデッキに戻し、そのデッキをシャッフルする。その後、≪このカード≫をあなたのダメージ置き場に置く" (2258), "≪パワーがXに等しくないキャラクター≫からコストを支払うことができない" (1740), "その後、あなたのデッキから、そのキャラクターと同じ分類を持つブレイク条件のないブレイクカード1枚を選び、あなたの支配キャラクターとしてセットする" (the classes of the discarded target; 3018), "≪あなたのダメージ置き場にある、指定したネームを持つか、カードテキストに指定したネームを含むカード全て≫をあなたの手札に戻す" (3271), "使用宣言中の、≪このキャラクターを対象に含むプロジェクトカード・ファストカード・エフェクト全て≫を無効化する" (when the Permanent is set; 1790), "あなたのドローフェイズ開始時に、…パワーカード1枚を、あなたのダメージ置き場に置く。置けなかった場合、…アクティブキャラクターとなる" (2373), "メインフェイズ開始時に、このカードをオーナーの手札に戻すことが可能。そうした場合、…デッキからカード1枚を…手札に加え…" (your Main Phase; 2980).

Revise#178 — Player options side bar and Log header (Pack: "Change "Size", "Hold" and "Game Situation" to One tab in "Player Options". Make it a right side bar. At Log, Remove "Replay", "Export.txt", change "Save Replay" to right side of Log window.").
- The top bar keeps Undo / Redo, "⚙ Player options", View and Leave. The Size slider, the Hold button and the Game Situation bar are no longer in it.
- "⚙ Player options" opens a side bar at the right edge of the screen (full height; ✕, the button again or Escape closes it). The button shows a short summary: "Hold ON / OFF / 3/4", the current Game Situation, or the card size for a watcher.
- Tab "Size · Hold" (or "Size · Situation" when Game Situation is on): the card size slider, then the Hold switches (All ON / All OFF, the four answer types, Undo) — or, with Game Situation on, the four situation buttons (hover 1 s for what each skips, as before) and the "Undo — ask me to agree" switch.
- Tab "Options": Auto-skip, Auto-pay, Auto Pay after Cost Selection, Pick Max Charge, Charge exceeds Draw, Run optional abilities without asking, and the Outlaw table rules (unchanged).
- A watcher (no seat) or a game not yet started sees only the card size.
- Log: the "Replay" and "Export .txt" buttons are removed; "Save replay" sits at the right side of the Log header. A saved replay still opens from the lobby ("Replay").

Revise#179 — M3 batch 14 (Pack: "Go next").
- 10 more cards run by themselves: 1973, 2004, 2259, 2389, 2393, 2659, 2911, 3093, 3338, 3437.
- New rule pieces:
  - "≪このキャラクター≫の攻撃力に+(X)する。Xはこのキャラクターが持つ本来の精神攻撃力の数値に等しい" (a Permanent: the host's printed mental Attack; 0 when its printed Attack is normal; 1973).
  - "≪支配キャラクター全て≫のアタックコスト・ガードコストはX上昇する。Xはそのキャラクターのオーナーの手札枚数に等しい" (each character counts its own owner's hand, as it is now; 2004).
  - "このカードのコストが目標からのみ支払われていた場合、さらに、…目標に±0/+X/+Xする" (every paid power card came from the target; 2259).
  - "目標の≪▼を持つキャラクター1人≫を捨て札する。あなたの支配エリアに“A”と“B”が存在する場合、代わりに、目標の≪キャラクター1人≫を捨て札する" (with both names in your Control Area any character may be targeted; 2389 / 2393).
  - Four separate "≪あなたの任意の…1人≫" choices in one card (a player for X damage, a character for X, a character for (X), a character for −X Defense; each chosen when it resolves; X = 0 skips them; 2659). X "あなたの支配エリアのブレイクしているF・F♂のネームレベルキャラクターの数" now counts only name-level characters of both classes.
  - "このカードの効果で1ドローしていない場合、メインフェイズ終了時に、≪このカード≫をオーナーの手札に戻す" (answering No to the draw sends the card to its owner's hand instead of the Discard Pile when its effect ends; 2911).
  - "≪あなたのデッキ≫から、コストXのパーマネントカード1枚を、…支配キャラクター1人にセット宣言する。その後、デッキをシャッフルする" (cost exactly X; you pay its cost; 3093).
  - "≪プレイヤー全て≫はXドローする。Xはそれぞれのプレイヤーの支配エリアの、ネームを持つF・F♂の数" (each player counts their own; 3338).
  - "目標の≪キャラクター1人≫はシールド・ペネトレイトを得、X以下の数値のダメージを受けない。Xは目標の精神力" (the target's Mental, as it is when the damage comes; 3437).

Revise#180 — M3 batch 15 (Pack: "Go next").
- 5 more cards run by themselves: 2202, 3348, 3510, 3543, 3620.
- New rule pieces:
  - "≪あなたのデッキ≫から、異なるネームを持つブレイクカード10枚を、あなたの手札に加える" (3348) and "異なる勢力のキャラクターカードを6枚まで選び、あなたの勢力エリアのアクティブキャラクターとしてセットする" (3620). The choice offers at most as many cards as there are different names / factions. If two picked cards share a name / faction, only the first one is taken, and the log says so.
  - "このカードがセットされた場合、≪あなたの捨て札置き場にある、あなたが必要ファクターを満たしていない、…カード1枚≫を、あなたの手札に戻す" (needed factor checked as it is now; 2202).
  - "ターン終了時まで、あなた以外のプレイヤーが使用したカードの効果で、≪あなたの支配キャラクター≫が捨て札になる場合、あなたのデッキの上からカードを3枚捨て札することで、そのキャラクターを場に残す" (3510).
  - "ターン終了時まで、≪支配キャラクター全て≫は、支配キャラクターとのバトルによって捨て札になる場合、そのキャラクターのオーナーのデッキの一番上のカード1枚をそのオーナーのダメージ置き場に置くことで、そのキャラクターを場に残す" (3543).
  - Both appear as a "Keep" choice when the character would leave; it needs enough cards in that deck.

Revise#181 — Special Area position (Pack: "Move position of "Special Area" to most right of "Active Area"").
- Each board's Special Area (Project / Fast cards in use and declared cards) is now the last box of the Active Area row, at its right end. It was at the right of the Control Area (Front) row.
- The Control Area (Front) row keeps its three sections (Left · Centre · Right) across its full width.

Revise#182 — Field effects and the log speak the card's words (Pack: "Field Effect shows as original text is OK. [EFFECT TYPE] to [TARGET] Ex. Gain skill "Shield, Offensive, Defensive" to ≪all Dragoon and Dragoon♂ characters you control≫. For Log, make it the same way. … It should show only as "Dragon Lord "Sophie Rastaban" uses Effect "1: Until end of main phase, ≪all Dragoon and Dragoon♂ characters you control≫ gain Shield, Offensive, and Defensive."").
- Field effects list:
  - Each effect that ran has one row: the source card, then "[EFFECT TYPE] to [TARGET]", then how long it lasts. For example: “Dragon Lord ‘Sophie Rastaban’” Gain skill “Shield, Offensive, Defensive” to ≪all Dragoon and Dragoon♂ characters you control≫ — main phase.
  - The effect type puts the gained skills together ("Gain skill “A, B, C”"; "Lose skill" for lost ones) and the stats as +1/+1/+1. Other changes keep their short text, joined by ";".
  - The target is the ≪…≫ part of the card's English line that made it, when that line has exactly one ≪…≫. If that part is not "all …", the characters it reached follow in brackets. When there is no such ≪…≫, the row names the characters / players it reaches.
  - Hovering a row shows the full English line. "−" on a row ends every modifier of that row (the fieldEnd intent takes "mods": [ids]).
  - Field effects added by hand stay one row each, as before.
- Log:
  - Using a character's effect is now one line with the card's own English words: “Dragon Lord ‘Sophie Rastaban’” uses Effect “1: Until end of main phase, ≪all Dragoon and Dragoon♂ characters you control≫ gain Shield, Offensive, and Defensive.” Targets follow after "→", and "(answer)" is added when it answers another declaration.
  - The "Effect: <card name>" line that each of its modifiers printed is gone.
  - The cost line ("… pays N: …") and "Resolved: …" stay, so everyone still sees what was paid and when it resolved.
  - A field effect added by hand is still logged as "Effect: <label>".

Revise#183 — Hold: Aggressive (Pack: "Hold functional, Add "Aggressive" to handle only in "Active Phase". Position = above "Attack / Guard". Make "Attack / Guard" only handle in "Mainphase"").
- A new Hold switch, "Aggressive", sits above "Attack / Guard". It covers the battle windows of the Active Phase: a ▼ (Aggressive) character's attack, with its guard / "No guard" and the battle.
- "Attack / Guard" now covers only the battle windows of the Main Phase.
- When nothing is in Resolve, the battle window's type follows the phase: Active Phase → Aggressive, otherwise → Attack / Guard. A declaration on top still decides by its own type, as before.
- "All ON" / "All OFF" and the button summary count five answer types ("Hold 4/5").
- A game saved before this change: Aggressive follows that player's Attack / Guard switch.
- Game Situation: Aggressive is skipped or not skipped exactly as Attack / Guard (Building / Interfering / Conflicting: Skip; Engaging: Not Skip). The 1-second hover help lists it.

Revise#184 — Permanent cards need a free slot (Pack: "Permanent Card cannot be set on character which has no available permanent slot. Character which has been set with 1 permanent, it should not be able to set another permanent.").
- A Permanent card can be declared only onto one of your Controlled Characters with a free Permanent slot. That character must hold fewer Permanent cards than its Permanent limit (1, or more with the Permanent +X skill and other limit changes). A Permanent already in Resolve aimed at that character counts as set.
- When none of your characters (or none of the characters the card or effect allows) has a free slot, the card can't be declared: it is not highlighted in the hand, and the declaration is refused with "No character with a free Permanent slot". The same rule applies to the "you may set a Permanent from …" choices.
- When choosing the target, only characters with a free slot are offered.
- The "over the limit → choose which must go" step stays for a limit that drops later (for example A3-22 3217 Wasp).

Revise#185 — Lethal Damage warning (Pack: "When opponent player attacked with "Attack Power" + "Our Draw" >= Deck, Run Small Pop-up to warn "Lethal Damage" for 1s then fade away. Make it the same way as "Cost return to hand" do not interrupt player's action. Show as red background.").
- When another player's character declares an attack on you, the table checks the attacker's Attack (with Boost) + your Draw against the number of cards in your Deck.
- If Attack + Draw ≥ Deck, a small red pop-up appears near the top centre of the screen:
  - "⚠ Lethal Damage", with a line such as "Attack 3 + Draw 1 ≥ Deck 4" (mental Attack is shown as "(3)").
  - It stays 1 second, then fades away.
  - It never takes clicks, so whatever you were doing goes on.
- Only the attacked player's screen shows it. With two decks on one screen (solo), it names the attacked player.
- Not shown for an attack on a character, for a ▼ faction attack on its own player, or when you open, reload or undo into an older position.

Revise#186 — Card menu colours (Pack: "When clicking at card, please make background for each text. Effect : Pastel Yellow, Attack : Pastel Red, Defense : Pastel Blue, Card Details : Pastel Green").
- The menu that opens when you click a card or character gives each choice its own background:
  - Effect (an effect or a gained effect): pastel yellow.
  - Attack: pastel red.
  - Guard (Defense), and Join the battle (Synchro): pastel blue.
  - Card details: pastel green.
  - Other choices (set a card, Search …) keep the plain background.
- Text on these choices is dark, for contrast. Hover makes the colour a little stronger.
- An effect's choice now shows its whole English line (up to 160 characters; it was cut at 60, so two effects of one card could look the same).

Revise#187 — Battle steps in Resolve (Pack: "At Resolve screen of attack, show as below instead. Attack > Guard > Response > Resolved. Note: "After battle" is not needed. Please also add background. Attack: Pastel Red, Guard: Pastel Blue, Response: Pastel Yellow, Resolved: Pastel Green").
- The battle box in Resolve shows four steps: Attack › Guard › Response › Resolved. The old five (Guard › Response › Before battle › After battle › End) are gone.
- Backgrounds: Attack pastel red, Guard pastel blue, Response pastel yellow, Resolved pastel green, with dark text.
- Steps already done are in full colour. The current step is bold with a white ring. Steps still to come are faded.
- Attack is always done (the attack was declared). Guard is current while the defender chooses a guard. Response is current while players may answer. Resolved covers the battle itself and its end.
- The several-attacks pop-up names the step the same way.

Revise#188 — Breakthrough after the guard (Pack: "There is a case when after "Attack" is Declared and "Guard" is declared by "Character Type", then "Breakthrough" is given to "Attacker". For this case, "Defender" shall failed to guard. Battle will be skipped and Deal damage of "Attacker" to "Player" instead.").
- When the Response ends (everyone passed), the table checks the guard again. The guard fails when the attacker now has Breakthrough and the guarding character is unbroken (only Character cards), unless that character may guard Breakthrough ("ブレイクスルーを持つキャラクターをガード可能").
- A failed guard means:
  - The log says "…: the guard is cancelled (Breakthrough: an unbroken character can't guard it — no battle) — the attack goes on to its target".
  - There is no battle: neither character deals or takes battle damage, and no "before battle" effects run for that guard.
  - The attacker's damage goes to the attacked player (the damage check), as with no guard.
- The same check runs once more just before the damage, in case Breakthrough was given in the Before-battle step.

Revise#189 — A Permanent set at Fast timing waits in Resolve (Pack: "There is a case where "Permanent Card" is set as "Fast Timing". For this case, need to put "Set Declaration" to "Wait for Resolve" List.").
- A Permanent card's set declaration made at Fast timing now waits in the Resolve list for answers as a Fast card does. Fast timing means any time other than your own Project timing: in a battle, as an answer, or in another player's turn.
- Hold: it counts as the "Fast / Effect" answer type (it was "Break / Permanent"). Players with Fast / Effect ON are waited for even when their Break / Permanent switch is OFF. The same applies under Game Situation: Interfering and Conflicting wait for it, and Building skips it.
- A Permanent set at your own Project timing (your Main Phase, nothing in Resolve, no battle) is unchanged: "Break / Permanent".

Revise#190 — Game options and Global Undo/Redo (Pack: "Please make button "Game option" : "Global Undo/Redo" which makes "Undo/Redo can be made by any player for any player". Move "Game Situation" and "Outlaw" to under this Menu.").
- A new button, "⚑ Game options", sits beside "⚙ Player options" for the players in a game. It opens its own side bar at the right edge (✕, the button again, or Escape closes it; only one of the two side bars is open at a time). When a table rule is on, the button shows "Global Undo" and / or "Outlaw".
- Game options holds the table rules, which any player may change (each change is written in the log):
  - "Global Undo/Redo" (new, off by default): any player may Undo / Redo the latest action of any player, not only their own. The usual limits stay: only the latest action, only while nobody has acted since. An undo still waits for the agreement of the other players with Hold "Undo" ON. Watchers can't undo. Log: "⚠ … turned ON “Global Undo/Redo” (any player may undo / redo any player's action)".
  - Game Situation: the four situation buttons with the 1-second hover help (moved here from Player options). When the room was made without Game Situation, it says so.
  - Outlaw: Flip-up Discard Pile, Flip-up all Power Card, Fool text (moved here from Player options).
- Player options keeps "Size · Hold" (card size, Hold switches; with Game Situation on: the current situation, a link to Game options and the Undo switch) and "Options" (Auto-skip … Run optional abilities without asking).

Revise#191 — Attack and mental Attack shown apart (Pack: "When showing attack, show both "Attack" and "Mental Attack" separately as "X (X)"").
- Attack is now always written the same way: "8" for normal Attack only, "(8)" for mental Attack only, and "44 (1)" for a character with both. This applies to the character's stats on the board, the Status box of Card details, the battle box in Resolve, and the battle line of the log.
- "+(N)" on Attack is mental Attack. It was read as a plain +N, so "Open-Finger Gloves" (+(1)) made a 44 Attack character show 45.
  - On a character with normal Attack, "+(N)" now adds N mental Attack beside its Attack ("44 (1)"). In battle it deals 44 damage and (1) mental damage.
  - On a character with mental Attack, "+(N)" raises that mental Attack, as before.
  - "−(N)" takes away only mental Attack. A character with normal Attack only loses nothing from it.
- Where it applies: Permanent cards whose Attack box is "+(N)" / "+(X)"; card lines whose Attack changes are all written in brackets ("…の攻撃力に+(2)する", "+1/+(1)/+1"); and 魔眼 (A3-14 1973). Lines that change both Attack kinds at once, and lines about "精神攻撃力" / "通常攻撃力" / "本来の攻撃力", keep their own handling.
- Status box breakdown: each line now names the stat ("Attack +1", "Mental Attack (+1)", "Defense +3" …) instead of "at +1".

Revise#192 — M3g batch 1: Saga 3 specials (Pack: "Continue Card implementation on M3a to M3g").
- About 40 more Saga 3 special Permanent / Project / Fast cards run by themselves (BS2, EP, EX01–EX05, EXPP, EXPR, EXPV, PP).
- New rule pieces:
  - "このカードが“X”(または“Y”)以外にセットされている場合、≪このカード≫は捨て札される" (also written "“X”以外にセットされている場合、捨て札される"): a Permanent made for one character. When it is on any other character it goes to the Discard Pile, and the log says why (EP026 … EP073). The text of EP027 / EP071 writes “玖珂 なつき”; the character card is “玖我 なつき”, so that name is used.
  - "このカードがネームを持たないキャラクターにセットされている場合、≪このカード≫を捨て札する" (EXPV041). Also "このキャラクターのパワーが0の場合、≪このカード≫は捨て札される" (PP201).
  - "目標が“X”の場合、…": also written "目標があなたの支配キャラクター / 支配エリアの(ブレイクしている)“X”の場合、(さらに、)…" and "…だった場合". These steps run only when the target is that character (EX0050, EX0053, EX0072, EX0318 …).
  - "…に登場する" as a card selector: "≪魔法少女リリカルなのはシリーズに登場するネームレベルキャラクター全て≫" (EXPR015, EX0616).
  - Break cost back to the hand:
    - "≪このカードがセットされているキャラクターにセットする、“X”のブレイクカードのコスト≫は、手札に戻る" (only onto that character; EX0287, EX0293, EX0596, EX0598, EXPP045, EXPV018).
    - "ターン終了時まで、≪魔法少女リリカルなのはシリーズ / 魔法戦記リリカルなのはForceのブレイクカード(・パーマネントカード)のコスト≫は手札に戻る" (EX0328, EX0479, EXPV021).
    - "このカードを“X”にセット宣言する場合、≪このカードのコスト≫は手札に戻る" (EX0450).
  - "≪このカード≫はネーム“X”を持つ" (EX0442).
  - Deck searches: "≪あなたのデッキ≫から、魔法戦記リリカルなのはForceの、ネームを持つブレイクカード1枚を選び、手札に加える" (EXPR028); "パーマネントカードを1枚選び、手札に加える" (EXPV045).
  - "このカードがあなたのダメージ置き場に置かれている場合、…" is the same as "…にある場合" (EXPR024).
  - "ターン終了時まで、≪あなたのテリトリーのキャラクター全て≫は、あなた以外のプレイヤーの使用したプロジェクトカード・ファストカードの効果を受けない" (EX0621 / EX0633).
  - "次のターン終了時まで" (EP388).
  - "Xは、目標のキャラクターにセットされているパーマネントカードの必要ファクターの合計" (EP269).
  - "目標の≪キャラクター1人≫がバトルする場合、目標のバトル相手に2回同時にダメージを与える" (EX0609).
  - "ターン終了時まで、目標がバトルした場合、このカードを捨て札する": the card's effect ends after the target's battle (EX0607, EX0609 …).
  - Hand discard X, then X cards of any Damage Pile (EX0071); Damage Pile X → hand, then X damage to a player if “X” is yours (EX0095).

Revise#193 — M3g batch 2 (Pack: "Continue Card implementation on M3a to M3g").
- 9 more cards run by themselves: EP194, EP381, EXPV043, EX0452, PP030, PP048, PR067 (M3g) and A3-22 3202 (M3e).
- New rule pieces:
  - "カード名称に「X」を含む" in a card selector: "≪カード名称に「冒険者」を含むあなたの支配キャラクター全て≫" (EP194).
  - "その後、あなたの支配エリアに(ブレイクしている)“X”がいる場合、…": the steps run only while you control that character (broken if the card says so). "目標のオーナーにNダメージを与える" may be written without ≪≫ (EXPV043 / EX0452).
  - "その後、あなたのターンは終了する。この時、メインフェイズ、パワーカードフェイズ、ディスカードフェイズは終了したものとして扱う" — the turn ends at once (PP030 / PP048 / PR067).
  - An effect: "ターン終了時まで、このキャラクターがバトルする際、≪このキャラクターのバトル相手≫の持つスキル全てを無効化する" (EP381).
  - "メインフェイズ終了時まで、目標があなたの対戦相手にアタックした場合、あなたのダメージ置き場にあるブレイク条件のないブレイクカード1枚を、あなたの支配キャラクターとしてセット可能" — asked each time the target attacks an opponent while it lasts (3202).

Revise#194 — Deck Builder template Setup: default choices (Pack: "In Deck Builder, there is a functional to select "Main Icon", "Sub Icon", "Main Factor" and "Sub Factor". Please make default selection as below. Main Icon : First Most Common Icon of "Main Break". Sub Icon : None. Main Factor : First Most Common Factor of "Main Break". Sub Factor : Any (Not Main Factor)").
- When the Setup step of a template opens for the first time, the four fields are already filled:
  - Main icon: the class icon that appears on the most of your Main Break cards (each card name counted once). On a tie, the icon met first. Only icons that some Character card has are used.
  - Sub icon: None (main icon only).
  - Main factor: the faction of the most of your Main Break cards (ties: the one met first).
  - Sub factor: Any (any faction except the main factor).
- With no Break cards in the deck (Template "Character core" on an empty deck), main icon and main factor stay empty to choose; sub icon is None and sub factor is Any.
- Every field can still be changed (click it to open its list). Next works at once when all four are filled.

Revise#195 — Deck Builder: card details from the template steps (Pack: "In deck builder, make it able to open card details.").
- Every card picture in a template step (Draw / Charge characters, Break · Charge / Draw, Break-cost return characters, and the Permanent / Fast / Project / Main Break searches) is now a button with a small ⓘ. Clicking it opens the card details, the same side sheet as in the card list: picture, stats, text, abilities and the deck controls.
- Opened from the template, the details lie over the template dialog. ×, Escape or a click outside closes only the details, and the template stays where it was.
- The card list and the deck board open details as before (click the picture / a deck card).

Revise#196 — Resolve list layout (Pack: "At Resolve screen, It looks not good. Make information to show on another row from text.").
- Each declaration in the Resolve list shows its pieces of information as separate rows under the name: a label row ("CARD", "COST → HAND · “EYE ANGEL”", "COST → HAND WHEN IT RESOLVES"), then the cards on the row below. A thin dashed line separates the pieces.
- The labels no longer sit beside the cards, so they don't wrap around the pictures. The "Main" tag stays next to the player line.

Revise#197 — Charge X (Pack: "Charge X from A3-19 2656 does not appear." / "Charge X from A3-19 2650 does not work correctly.").
- A valued skill written "チャージX" (also ドロー / バインド / キャパシティ / パーマネント X) gets its X from the card's own "Xは…に等しい" line even when that line is not right under the skills. On A3-19 2656 it is the last line, after the effects. 2656 now has Charge X = the number of your controlled イレイザー / イレイザー♂ characters. Before, the skill was dropped.
- The board shows each character's valued skills with their value now ("Charge 6 · Bind 1 · Shield"), so a Charge X worked out from the game (2650: Break cards in every player's Damage Pile) can be checked at a glance. The deck's ⚡ badge is the sum over your Controlled Characters, as before.

Revise#198 — Card details: X (Pack: "Could you add "X" details of each card to "Card Details"? Add information : X = N, add "Count from ..." as detailed information").
- The Game Table's card details have a new box, "X", for every card that uses an X:
  - First, the card's own rule for X in English (its "X is equal to …" line).
  - Then one row per use of X: Charge X / Bind X / … (a skill), Stat +X (a Permanent), Effect N, Ability N, This card (a Project / Fast card), and Cost X.
  - Each row shows "X = N", worked out from the game as it is now, for the card's owner and character.
  - "Count from" lists what was counted: the characters (by card name) for "the number of … characters", or the cards with their player for "… cards in the Damage Pile / Discard Pile …" (up to 12, then "… N more"). For "this character's power" it gives the power cards on that character.
  - An X that depends on the target or on what happens when it is used shows "decided when it is used". Cost X shows "the cost you pay".

Revise#199 — M3 batch 16 (Pack: "Continue card implementation").
- About 12 more cards run by themselves:
  - M3a–M3f: 1105, 1482, 1483, 1608, 2057, 3161, 3361, 3506, 3547.
  - M3g: BS2 1608, PR262, EP310.
- New rule pieces:
  - "あなたのデッキの上からX枚を引き、対象にパワーカードとして1枚ずつセットする" — one card on each of the X targets (1608).
  - "≪あなた≫は、あなたが次に使用宣言するカードの必要ファクターを無視して使用宣言可能" (PR262, EP310).
    - The next card you declare doesn't need its factor, and that card uses up the rule even if you had the factor.
    - It is not checked again when it resolves.
  - "ターン終了時まで、≪キャラクター全て≫は、あなた、またはあなたの支配キャラクターを目標にアタック宣言する場合、追加で1コスト支払わなければアタック宣言できない" (3547): the Attack Cost is +1 for an attack on the card's player or on a character of theirs.
  - "目標の≪キャラクター1人≫にキャパシティ-X・チャージ1を与える" (X = the target's Mental; 1105).
  - X from the target: "Xは目標の攻撃力の数値に等しい" (1483). X from the character: "Xはこのキャラクターを構成するドラグーンまたはドラグーン♂を持つブレイクカードの枚数" (1482).
  - "≪このキャラクター≫の攻撃力に、この効果で捨て札したキャラクターの攻撃力を合計して判定する" (3161).
  - "ターン終了時まで、目標がアタックした場合、通常ダメージ判定を行わず、アタックを受けたプレイヤーのデッキから目標の攻撃力に等しい枚数のカードを捨て札する" (3506).
  - "目標の≪あなたの支配キャラクター1人≫のアタック宣言またはガード宣言を取り消す。その後、≪目標と…バトルしているキャラクター全て≫の…を取り消す": the whole battle is called off (2057).
  - "その後、≪あなた≫は、あなたの手札のブレイク条件を持たない“ベルダンディ”と“スクルド”を、あなたの支配キャラクターとしてセット可能" (3361).

Revise#200 — M3g batch 3: "代わりに" and "paid only from “X”" (Pack: "Continue card implementation").
- About 10 more Saga 3 special cards run by themselves: EX0113, EX0300, EX0316, EX0317, EX0334, EX0451, EX0453, EX0457, EX0459, EX0464.
- New rule pieces:
  - "…場合、代わりに、…": the line before runs only when the condition is not met, and the "代わりに" line runs only when it is. This works after:
    - "あなたの支配エリアに(ブレイクしている)“X”がいる場合" (EX0300: 2 damage, or 4 with a broken “高町ヴィヴィオ”; EX0113)
    - "目標が“X”の場合" (EX0334: +1/+1/+1, or +2/+2/+2 for “アインハルト・ストラトス”; EX0451)
    - "このカードのコストが…からのみ支払われていた場合"
  - "このカードのコストが(ブレイクしている)(Fを持つ)“X”からのみ支払われていた場合、…": every power card paid for this card came from that character (EX0316, EX0317, EX0453, EX0457, EX0464).
  - "あなたの支配エリアにブレイクしている“X”がいる場合、その後、目標のオーナーのデッキの上からカードX枚を捨て札する" (EX0459).
  - "≪あなたの支配エリアのネームレベルキャラクターのアタック宣言に対してガード宣言する際のガードコスト≫は1上昇する" (EX0317).

Revise#201 — M3g batch 4: name lists, lasting cards, Extra Pack works (Pack: "Continue card implementation").
- About 30 more Saga 3 special cards run by themselves, among them: EX0499, EX0500, EXPP004, EXPP005, EX0626, EX0638, EP155, EP154, EP195, EP340, EP341, EP348, EP351, EP369, EXPR009, EXPR014, EXPR059, EX0052, EX0062, EX0149, EX0197, EX0296, EX0298, EX0330, EX0331, EXPR025, EX0333, EX0436, EX0441, EXPP065, EX0448, EX0449, EX0458, EX0486, EX0623.
- New rule pieces:
  - Name lists: "≪“A”、“B”、“C”全て≫" / "“A”または“B”" as targets. "“A”または“B”のネームを持つブレイクカードのコスト≫は手札に戻る". "デッキから“A”、“B”、“C”を1枚ずつ選び、手札に加える".
  - "≪このカード≫は、フェイズ・ターンが終了しても効果を発揮し続ける": the card stays in the Special Area. Its "≪…全て≫" lines are field rules, so characters that come later get them too. "+1/+1/+1され" with no duration lasts while the card stays.
  - "場に…異なるネームを持つ…キャラクターが10体以上いる場合" (counts different names).
  - Works of the Extra Packs: えびてん, BLAZBLUE, トップをねらえ!, スマイル☆シューター, 世界樹の迷宮, 境界線上のホライゾン ("…に登場する", "エキストラパック…に収録されている").
  - "Xは…“A”、“B”、“C”の攻撃力の数値の合計に等しい".
  - "目標が“X”で、場に(場かダメージ置き場に)“Y”がいる(ある)場合".
  - "≪プレイヤー全て≫は、自分の手札全て(ダメージ置き場のカード全て)をデッキに戻し、シャッフルする。その後、戻した枚数ドローする(ダメージ置き場に置く)".
  - "ターン終了時に、≪このカード≫をあなたのダメージ置き場に置く".
  - "≪範囲のプロジェクトカードまたはファストカード1枚≫" (a card in use with no target).
  - "キャパシティ+X / キャパシティ-Xを持つキャラクター".
  - Permanents: "このカードが“X”にセットされている場合、≪このキャラクター≫は+1/+1/+1され、≪…のコスト≫は手札に戻る" (both parts). Effect costs and "カードテキストに“X”を含む…のコスト". Attack and Guard costs. "攻撃力に+(X)". "2回同時にダメージを与える".
  - "このカードを“X”にセットする場合、コストを無視して" for a Permanent (EX0062).
  - "このキャラクターがバトルする際、≪バトル相手を場に残す効果全て≫を無効化する" (EP351).
  - "あなたの支配キャラクターが…捨て札された場合、ターン終了時まで、≪このキャラクター≫に…" (EP369).

Revise#202 — Game table lobby: game rules as big boxes (Pack: "Please change these configuration to another section above game play. Make it a bigger box … Help Icon with "?" to the Top-Right of each box … ON OFF like other box in game … Pastel-Gradient").
- The four lobby options now sit in their own section, "Game rules", above the Solo / Online boxes: four big boxes in one row (two per row on a narrow screen).
  - Respond Together
  - Game Situation
  - Auto-Skip
  - Auto-Pay
- Each box has a short title and an ON / OFF chip like the in-game options. A click anywhere on the box switches it. An OFF box is shown dimmed.
- Each box has its own pastel gradient (pink→peach, lavender→sky, mint→lime, lemon→apricot) with dark text.
- A "?" button at the top-right of each box shows the explanation when it is hovered or tapped.
- Defaults and game behaviour are unchanged (Auto-Skip and Auto-Pay ON; the others OFF).

Revise#203 — M3 batch 5: designated characters, name-level duels, conditional free use (Pack: "Continue to implement").
- About 30 more cards run by themselves, among them: 1920, PP205, PP207, PP324, 1923, EX0068, EXPR001, EP336, EP337, EXPR033, EP393, EXPP015, EXPP020, EX0310, EX0338, EX0343, EXPR026, EXPR027, EX0460, 2421, PR232.
- New rule pieces:
  - "このカードの使用宣言時に、あなたの任意のあなたの支配キャラクター1人を指定する": the designated character is chosen when the card is declared, as the second part of its choice. It is not a target, so it can be one that cannot be targeted. "指定したキャラクターの攻撃力 / 精神力" is X. "指定したキャラクターにセットされているパワーカード全てを目標にセットする" (PP207).
  - "このカードの使用宣言時に、あなたの対戦相手1人を指定する。≪あなたと指定されたプレイヤー≫は、ネームを持つ自分の支配キャラクター1人を指定する。その後、指定したキャラクター同士はバトルを行う": you choose yours, then that player chooses theirs, then they battle. This is not an attack, so no player takes damage.
  - Permanent effects: "≪あなたの手札の…シリーズのパーマネントカード1枚≫と≪このカード≫を入れ替える". "このエフェクトのコストを“A”、“B”、“C”以外から支払うことはできない".
  - "…場合、≪あなた≫は、このカードを必要ファクター(とコスト)を無視して使用宣言可能" for Project / Fast cards. "…場合、≪このカード≫は、使用宣言時から効果終了時までファストカードの効果を受けない". New conditions: "あなたの支配エリアにブレイクしている“X”がいる場合", "ネームに「X」を含む…のキャラクターが存在する場合", "あなたのデッキ枚数が10枚以下の場合".
  - "ターン終了時まで、(…)キャラクターが、バトルの結果、対戦相手の支配キャラクターを捨て札した場合、≪捨て札されたキャラクターのオーナー≫に(1)ダメージを与える" (a watcher).
  - "≪プレイヤー全て≫はプロジェクトカード・ファストカードの使用宣言ができない". "≪キャラクター全て≫のアタック宣言・エフェクトの使用宣言は無効化される".
  - "≪キャラクター1人が目標のプロジェクトカードまたはファストカード1枚≫" and "≪あなたか、あなたがオーナーのカードを対象に含む、…≫".
  - "N+Xダメージ". "Xは…“X”にセットされているパーマネントカードの枚数に等しい".

Revise#204 — Side bars fold on a click outside (Pack: "Make Game option sidebar and Player option sidebar become folded when click outside of bar").
- When the Player options or Game options side bar is open, a click anywhere outside it closes it.
- That click does nothing else, so a stray click cannot declare or move anything.
- Clicks inside the bar, on its own button (which still toggles it), or in a pop-up menu or window opened from it do not close it. Escape still closes it too.

Revise#205 — Hold default, "?" help, Options categories, phases at the head of a field (Pack, 2026-11-07).
- **Hold default.** A player now starts with:
  - Aggressive OFF
  - Attack / Guard ON
  - Project ON
  - Fast / Effect ON
  - Break / Permanent OFF
  - Undo ON
  The new **Default** button, right of All ON / All OFF, puts every switch back to this. It is outlined while the switches are at the default.
- **All ON / All OFF** now switch Undo too. This is the new Hold type "every"; the old "all" (answer types only) is kept for old logs.
- **Hold switches.** The explanation line under each switch is removed. Each switch has a "?" at its right that shows the explanation on hover or tap, the same way as the lobby's Game rules.
- **Options tab.** Three categories, each switch with a "?" and no explanation line:
  - **Phase:** Auto-skip Phase (renamed from Auto-skip), Pick Max Charge, Charge exceeds Draw.
  - **Cost:** Auto-pay, Auto Pay after Cost Selection.
  - **Gameplay:** Run optional abilities without asking.
- **Auto-pay vs Auto Pay after Cost Selection.** These are not the same, so both stay, with clearer "?" text:
  - Auto-pay (a game rule) pays at once when the cost is exactly all the power cards that can pay it, so the cost window never opens.
  - Auto Pay after Cost Selection (this device only) works when the cost window does open (more cards than the cost). It pays as soon as enough cards are picked, without pressing Pay.
- **Fool text** is removed from Player options. It stays in Game options → Outlaw.
- **Game Situation.** What each situation skips is now one table under a "?" by the Game Situation heading. The 1 s hover tip on the situation buttons is removed.
- **Head of each field.** The turn player's head shows every phase (Draw · Active · Main · Charge · Discard): the current one bright, the others dim.
- **Timing chips.** Every player's head has a "Fast Timing" chip, bright while that player may declare a Fast card or an effect now. The turn player's head also has a "Project Timing" chip, bright while a Project card, a Break card or an attack may be declared now.

Revise#206 — Game Situation fix and row, Control · Back size, Size in the field head, Sort by type first, Undo skips option changes (Pack, 2026-11-07).
- **Hold / Game Situation in Solo (one deck).** Solo with one deck used to wait for the player at every declaration, whatever Hold or the Game Situation said ("even in Building, all actions are confirmed"). It now follows Hold and the Game Situation like every other mode. In Build nothing waits.
- **Game Situation in Game options.** It is now the first section of Game options: one row of tabs (scrolls sideways if narrow) with short words and a colour each:
  - Build: green
  - Interfere: yellow
  - Conflict: orange
  - Engage: red
  The "?" table, the pop-up and the Player options summary use the same words and colours.
- **Control · Back card size.** The row has its own card size: S = 0.5×, M = 0.8×, L = 1× of the card size (default L).
  - It is set with a vertical slider at the right end of your Control · Back row, 22 px wide like the Sort button.
  - It is saved on this device and applies to every player's Control · Back row.
- **Size bar.** The card Size bar moved from Player options to the top right of your own field head.
- **Sort button.** Sorting is now by type first, every faction together:
  1. Draw X (highest Draw first)
  2. Effect cost back to hand
  3. Charge
  4. Others
  5. Break-cost return
  Inside each type it sorts by faction (E.G.O. → … → none), then Mental high → low. So every Draw character stays leftmost.
- **Undo / Redo only for game actions** (Pack: "No need to Undo the Option changes"). Hold changes, table rules (Auto-skip, Auto-pay, Global Undo, Outlaw…) and Game Situation declarations are never undone. They no longer count as "the latest action": Undo goes to the latest game action even after option changes, and another player's option change does not block your Undo.
- **Cost window keeps its scroll** (Pack: "don't make the screen go back to the top when a card is selected"). Picking or unpicking a power card in the cost window no longer jumps its list back to the top. Other pop-up windows keep their scroll too.
- **"攻撃力に+N" on a mental-Attack character.** The +N is normal Attack beside the mental Attack: a (1) character with "Attack +2" shows **2 (1)**, not (3). The battle deals 2 normal and 1 mental damage. This mirrors Revise#191 ("攻撃力に+(N)" on a normal-Attack character is N mental Attack beside it).
- **Game options → Outlaw → "Flip down all power cards"** (Pack). Every power card is face down for everyone, even a card charged from the hand is hidden from its owner. An effect that shows power cards still shows them. It can't be ON together with "Flip-up all Power Card": turning one ON turns the other OFF. Both are in the log, and the Game options button shows "Power face down".
- **Card details, Status now: one row per source** (Pack: "If character got buff from the same source, merge them to 1 row"). For example: “Goddess Who Heralds Winter ‘Persephone’”: gains Breakthrough, Mental +1, Attack +1, Defense +1.
- **A search shows its cards face up** (Pack: A3-16 2305). "≪あなたのデッキ≫から…を選び" searches, and "a Permanent card from your deck onto this character", now show the chooser the cards they may take face up. Before, they were all card backs. The deck is shuffled after, so it is hidden again. Random picks stay face down.
- **Battle in Resolve.** Each side shows its card on the left and its information on the right:
  - Attacker: Name · Skill · Status, top to bottom.
  - Defender (Guard / Target): Status · Skill · Name, so the two Status lines meet in the middle.
  - Battle skills are highlighted in gold: Bind, Initiative, Breakthrough, Stealth, Penetrate, Synchro, Resist, Protect. Resist and Protect show their factions / classes, e.g. "Resist (E.G.O. / Darklore)".
- **Bind and mental damage** (Pack: "Bind cost still needs to be paid"). Mental damage over a Controlled Character's power cards (or ≥ an Active Character's Mental) now defeats it even with Bind. Bind X is then the way to keep it, by paying X power cards to the Damage Pile (the usual keep choice). Before, Bind stopped the mental damage for free ("Bind: not defeated by mental damage — survives").
- **A3-19 2650 bug.** "目標の≪ダメージ置き場のカード1枚≫を、そのオーナーの手札に戻す" did nothing (only the cost went to the Damage Pile). It now chooses a card from any Damage Pile and returns it to its owner's hand. The same fix applies to every "≪…置き場のカード…≫を…手札に戻す" compiled as a return.
- **Steps for every declaration in Resolve**, like the battle:
  - Effect (pastel orange) › Response (pastel yellow) › Resolve (pastel green)
  - Project / Fast (pastel blue) › Response › Resolve
  - Break / Permanent (pastel blue) › Response › Resolve
  The newest declaration is at Response while the window is open; older ones wait at their first step.
- **Log colours.** Each line has a background by kind:
  - Attack: pastel red
  - Guard / defense: pastel blue
  - Resolve (resolved, entered, broke): pastel green
  - Effect (declarations, effects, abilities, field effects): pastel yellow
  - Draw: pastel green
  - Charge: pastel orange
  - Damage dealt (and defeated): pastel red velvet
  - Others: pastel gray
  Warnings (notes, cancelled / failed declarations, deck out, lost…) start with "!". OUTLAW lines and by-hand lines keep their own look.
- **Game Status timing** (Pack). Game options has "Game Status pop-up": 30 s / 60 s / 120 s / 180 s (this device; default 30 s). It sets how long nothing must happen before the Game Status box (and ⚡ by the hand) appears.

Revise#207 — M3 batch 6 (Pack: "Continue card implementation").
- 13 more cards run by themselves: EP070, EP199, EP338, EP343, EX0096, EX0309, EX0433, EX0440, EX0444, EX0475, EX0619, EXPR016, A4-EX01 EX0730 (EX0320 got its condition).
- New rule pieces:
  - "このカードが“X”以外にセットされている場合、≪このカード≫は捨て札される" followed by an ability on the same line (EP070).
  - "このカードは、あなたの支配エリアに(カード名称に「ゴーレム」を含む / ブレイクしている“X”)キャラクターがいる場合にのみ使用可能".
  - "このカードのコストは(フッケバインを持つブレイクしている)キャラクターからのみ支払うことが可能".
  - "このエフェクトのコストを“A”がセットされている“B”以外から支払うことはできない".
  - "このエフェクトの使用宣言時にあなたの手札をX枚捨て札する" (EX0444).
  - "あなたのパワーカードフェイズ開始時に、≪あなた≫は、あなたのデッキの一番上のカード1枚を見る": the card is shown to you only, then OK.
  - "≪プレイヤー全て≫は、自分の支配エリアのネームレベルキャラクターにセットされているパワーカードを1枚選び、手札に戻す": each player in turn order.
  - "…▼を持たないキャラクター1人につき1ドローし、▼を持つキャラクター1人につき1枚…手札を捨て札する".
  - "≪プレイヤー全て≫は、自分のターン終了時に、自分の捨て札置き場の任意のカード1枚を、自分のデッキの一番下に置く": the turn player chooses.
  - "Xはこの効果で捨て札したカードの必要ファクターに等しい" (EP199). "≪プレイヤー全て≫はXドローする。Xはそのプレイヤーの支配エリアの…の数に等しい" (EXPR016).
  - "≪このキャラクター≫は、このキャラクターのパワー以下のコストの…の目標にならない".
- **Game Situation row moved** (Pack: "Move Game Situation here"). The coloured row (Build · Interfere · Conflict · Engage) and its "?" now sit in the side panel directly under the Player options / Game options buttons, not inside Game options. Game options only says where it is.
- **What each situation skips** (Pack). Attack / Guard and Fast / Effect are never skipped now (true = Not Skip, waited for):

  | Situation | Aggressive | Attack/Guard | Project | Fast/Effect | Break/Permanent |
  |---|---|---|---|---|---|
  | Build | Skip | Not Skip | Skip | Not Skip | Skip |
  | Interfere | Skip | Not Skip | Not Skip | Not Skip | Skip |
  | Conflict | Skip | Not Skip | Not Skip | Not Skip | Not Skip |
  | Engage | Not Skip | Not Skip | Not Skip | Not Skip | Not Skip |
- **"Resolve" button** (Pack: "By the final step of Resolve, change button from Pass to Resolve"). When your pass is the last one the window waits for (everyone else with Hold ON has passed), the Pass button says **Resolve** in pastel green, because pressing it resolves the newest declaration / the battle. Otherwise it still says "No response (pass)" / "Pass".
- **Choose target shows the card** (Pack). In Resolve, the "Choose N target(s) for …" hint now has the image of the card being declared beside it (for an effect, the character's card).
- **Initiative is one battle rule for every battle** (Pack). The side with Initiative deals its damage first. Every character of the other side that is still on the field afterwards then strikes back, whether it survived the damage or was kept by Bind or any other keep. Before, a guard kept by Bind dealt nothing back. The strike back waits on the battle until the After-battle step, so every "keep it?" choice from the first strike is answered before it. The log notes "… is still on the field — it strikes back (Initiative)". EX0256's second hit (Initiative timing and again at the normal timing) works the same way.
- **Hold: Fast and Effect are separate switches** (Pack). The Hold list is now:
  - Aggressive
  - Attack / Guard
  - Project
  - Fast (a Fast card is declared)
  - Effect (a character's effect is declared)
  - Break / Permanent
  - Undo
  Default: Fast ON, Effect ON. Every Game Situation waits for both (as for Fast / Effect before). In a state saved before this change, Effect follows the old Fast / Effect switch.
- **Battle in Resolve** (Pack). The defender's Status · Skill · Name start at the top beside its card, not at the bottom. "vs" sits on a pastel yellow line across the box.
- **A skill given more than once shows more than once** (Pack). In Card details and the battle box, a flag skill appears once for the card itself plus once per effect that gives it. Initiative appears as many times as its count, e.g. "Initiative · Initiative". The extra ones are marked "gained". Number skills (Bind 1, Charge 2…) keep their total.

Revise#208 — M3 batch 7 (Pack: "Continue implement card").
- 9 more cards run by themselves: EX0336, EX0473, EX0482, EX0599, EX0604, EX0615, EX0617, A4-EP EP441, EP442 (EXPR036 is partly automatic now).
- New rule pieces:
  - **持続 (lasting) Project / Fast cards.** A stat change written with no duration ("≪…≫に±0/+3/+3する") lasts while the card stays in the Special Area (EX0604). 瞬間 (instant) cards are unchanged: their no-duration stat changes stay by hand (asked as Q#67).
  - "目標が「card name」の場合、…" (a card name in 「」, EX0604).
  - "このカードは、勢力フェイズ中にのみ使用可能" (EX0336).
  - "このカードは、このターン中にあなたがカードの使用宣言を行っていない場合にのみ使用宣言可能" (EX0615).
  - "≪…≫に、あなたのデッキの上からカードをN枚引き、(それぞれに)パワーカードとしてセットする".
  - "このカードが効果を発揮した場合、あなたのデッキの一番上のカード1枚をパワーカードとして目標にセットする".
  - "その後、目標が…シリーズのキャラクターの場合、あなたは1ドロー可能".
  - "このカードのコストが(精神攻撃力を持つ)キャラクターからのみ支払われていた場合" (every payer matches).
  - "目標に、このカードのコストをパワーカードとしてセットする".
  - "このカードのコストはブレイクしている“X”からのみ支払うことが可能".
  - "≪このカード≫は、使用宣言時から効果終了時までファストカード・エフェクトの効果を受けない" without the comma.
  - Permanents: "このカードが(カード名称に「X」を含む / ブレイクしている)キャラクターにセットされている場合". "このキャラクターのバインドXのスキルを使用した場合、≪このカード≫を手札に戻す" (EX0599).
  - "≪あなたのデッキ≫から“A”のネームを持つブレイクカードと“B”のネームを持つブレイクカードを1枚ずつ手札に加える". "ターン終了時まで、≪あなたが使用する“A”または“B”のネームを持つブレイクカード全て≫は必要ファクターが1減少する" (EX0482).
  - "ターン終了時まで、≪“A”、“B”、“C”から支払われたカードのコスト≫は手札に戻る" (EXPR036).
- **Cost window card size** (Pack). The cost window has S / M / L buttons in its header: S = 0.5×, M = 0.8×, L = 1× of its card size. It is saved on this device.
- **Deck: Charge and Draw** (Pack). The ⚡ Charge and ✋ Draw badges now sit at the top inside the deck's frame, not below it.

Revise#209 — M3 batch 8 (Pack: "Continue implement card non-stop").
- 9 more cards run by themselves: A3-02 0421, A3-20 2727, A3-24 3398, A3-25 3659, A3-EP EP311, EP384, A3-EX03 EX0335, A3-EX04 EX0489, A3-PR PR263.
- New rule pieces:
  - "このカードの必要ファクターとコストは、あなたの支配エリアの(…)異なる勢力の(…)キャラクターの数だけ減少する" (EP311 / PR263): factor and cost both go down by the number of different factions.
  - "このカードの使用宣言時に、あなたの手札から(works)のカードを公開することが可能。そうした場合、このカードの必要ファクターを無視して使用宣言可能" (EP384): with such a card in your hand, the factor is ignored. The cost-back pattern for a works series now allows any card type.
  - "このカードの直前に使用宣言された(types)のコストを1コスト以上支払ったキャラクター" as a target, and "このカードは(types)の使用宣言が行われている場合にのみ使用宣言可能" (EX0489).
  - "(…)キャラクターからコストを支払って使用宣言されている、コストがN以上のカード" as a target on the stack (3659).
  - "目標が“X”の場合、このカードが効果を発揮した際に、あなたのデッキの上からカードを1枚引き、目標にパワーカードとしてセットする" (EX0335).
  - "≪プレイヤー全て≫は、自身のテリトリーのキャパシティ-Xを持つキャラクターの1人につき1枚、自身の手札を捨て札し、キャパシティ+Xを持つキャラクターの1人につき1ドローする" (3398): each player discards first, then draws.
  - "メインフェイズ終了時まで、≪プレイヤー全て≫は、ブレイク・プロジェクト・ファスト・パーマネントカードを使用する際、そのコストを1人のキャラクターから支払わなければならない" (0421). Break cards now count for this rule too.
  - "≪攻撃力の数値がX未満のキャラクター≫は、あなたに対してアタック宣言できない。Xは…" (2727): the attack on that player is refused while X is higher.
  - "通常のあなたのターン終了後、あなたは続けて追加のターンを行う".

Revise#210 — M3 batch 9 (Pack: "Continue implement card non-stop").
- 10 more cards run by themselves: A3-EP EP375, A3-EX01 EX0060, EX0063, A3-EX02 EX0147, EX0165, A3-EX03 EX0307, EX0319, A3-EX04 EX0439, EX0443, A4-05 0951.
- New rule pieces:
  - **Choose 1 skill to negate.** "…の持つスキル1つを無効化する": the player of the card chooses one skill the character has (a list of its skills); that skill is off until the end of the turn (or the battle, for "このキャラクターがバトルする際"). "目標のバトル相手" = the characters battling the target now (EX0319). Permanent: "このキャラクターがバトルする際、≪このキャラクターのバトル相手≫の持つスキル1つを無効化する" (EX0439).
  - "このカードがあなたのデッキから捨て札された場合、≪このカード≫をあなたの手札に戻す" (EX0165): only when it goes from the deck to the discard pile.
  - "≪このキャラクターからダメージを受けたキャラクター≫は、ターン終了時まで、そのキャラクターの持つスキル全てが無効化される" (EP375).
  - "“X”が描かれているブレイクカード" in a deck search is read as a card with the name X (EX0307).
  - "このキャラクターが(支配キャラクターと)バトルした場合、バトル終了時に≪このカード≫をオーナーの手札に戻す / 戻る" (EX0060 / EX0147). "支配キャラクターと" is decided when the battle starts, so it still counts if the other character was defeated.
  - Permanents for one named character: "このカードが“X”にセットされている場合、<a trigger or always line>" (EX0063), and "…場合、A。B。" where both sentences apply only while it is set on X (EX0060).
  - "このキャラクターがバトルする際、≪このキャラクターのバトル相手にセットされているパーマネントカードN枚≫を捨て札する(ことが可能)" (EX0443).

Revise#211 — Deck Builder: no card limit (Pack: "At Deck Builder, do not limit card anymore").
- The Deck Builder no longer stops you at 60 cards or at 4 copies of one name: "+" is never greyed out, the template steppers and "set copies" add any number, and importing a list keeps every copy.
- The official sizes stay as a guide only: the summary still says "Ready (50–60 cards)", and above 60 it shows "N over 60 (no limit)".
- The Game Table's sanity limit for a deck is raised from 100 to 1000 cards.
- Template steps that ask for a set number of cards ("this step takes N cards") are unchanged.

Revise#212 — Game Situation skip table, Skip in Game options, every explanation in a "?" (Pack).
- What each Game Situation skips (Pack's table). "Not Skip" means every player is waited for on that kind of declaration:

  | | Build | Interfere | Conflict | Engage |
  |---|---|---|---|---|
  | Aggressive | Skip | Skip | Skip | Not Skip |
  | Attack/Guard | Not Skip | Not Skip | Not Skip | Not Skip |
  | Project | Skip | Not Skip | Not Skip | Not Skip |
  | Fast | Not Skip | Not Skip | Not Skip | Not Skip |
  | Effect | Skip | Not Skip | Not Skip | Not Skip |
  | Break/Permanent | Skip | Skip | Not Skip | Not Skip |

  The only change from Revise#207 is Effect in Build, which is now Skip.
- **Skip in Game options.** When Game Situation is ON, Game options has a "Skip" section right before Outlaw. It shows this table, one row per type and one column per situation, with the situation now marked.
- The "?" of the situation row now shows the situation now and what it skips, and points to Game options → Skip for the full table.
- **Game options:** every explanation is now in a "?" button. This covers Global Undo/Redo, Game Situation, Skip, Outlaw and each Outlaw switch. No explanation text is shown under the switches any more.

Revise#213 — Search asked every time; A3-25 3723; deck cards face up while choosing (Pack).
- **Search offer** (Pack: "Search skill does not work … make player need to confirm every time"). At the start of your Main Phase, if a card in your hand has Search, you are asked every time. You can pick the card to Search with, or choose none to go on. Picking one discards it, and the deck search follows as before. You can still Search from the card by hand until you declare anything else. The question comes whether Auto-skip Phase is ON or OFF.
- **A3-25 3723** "あなたがドローをする場合、≪あなた≫は、ドローをする代わりにあなたのデッキからカード1枚を選び、手札に加えることが可能": when you draw, choose up to 1 card from your deck.
  - Choose 1: you take it and draw nothing; the whole draw is replaced.
  - Choose 0: you draw as usual.
  - (Before this, it replaced one card per card drawn.)
- **Choosing from a deck is always face up.** When a choice offers cards from a deck, the player who chooses sees them face up, unless the effect says "random". The cards left in the deck are hidden again afterwards. This applies to every card, not just 3723.


Revise#214 — The Player on the field; Player image; User → Target; A3-18 2466 (Pack).
- **The Player** sits at the bottom right of every field, below the Discard Pile, the same size as the Deck.
  - It is not a character: it is never counted or chosen as one.
  - It shows the Player image and name, the skills the player has (for example "Charge 5" from "≪あなた≫はチャージ5を得る") and ✦N, the number of effects that reach this player.
  - Click it to see Draw / Charge / Hand limit / Hand / Deck / Damage, the player's skills, and every effect on the player (source, text, how long).
  - When a player can be chosen as a target, clicking the Player chooses that player, like the Deck.
- **The Player's own skills count.** A skill given to a player (Charge / Draw / Capacity) now counts like a Controlled Character's. For A3-18 2466 this means Charge 5 for the Charge Phase.
- **Player image** (lobby, above Game rules).
  - Pick one of 6 default pictures (Pack's images, players/p1–p6.jpg), or upload your own: a file on PC, the photo library or camera on iPhone / iPad, the gallery on Android.
  - An upload is made small on the device (at most 320 × 440, JPEG, under 150 KB). It is saved on this device and sent with "join", so the other players see it.
  - Solo with two decks: Player 2 gets the next default picture.
- **Game table "?"**: the explanation under the title is now in a "?" right of "Game table". "Card rule coverage" is a small link on the same line.
- **User → Target** (Resolve): a character's effect or ability that targets something shows the user's card → the target's card. If the target is a player, it shows that player's image.
- **A3-18 2466** is now automatic. Line by line:
  - "パワーカードフェイズ終了時まで、≪あなた≫は、あなたがチャージの効果でセットするカードの内容を見ることができる": you see the cards you set with Charge, until the end of the Charge Phase.
  - "…がいる場合、パワーカードフェイズ開始時に、≪あなたの任意のあなたの捨て札置き場のカードX枚≫をあなたのデッキに戻し、そのデッキをシャッフルする": this waits for the start of the Charge Phase. The condition and X are both checked at that moment.
- Penetrate: a test now checks that the attacker's normal damage beyond the guard's Defense goes to the attacked player (asked as Q#68).

Revise#215 — M3 batch 10 (Pack: "continue on card implementation").
- More cards run by themselves: A3-11 1688, 1658, A3-PP PP271, PP090, A3-EX01 EX0059, A3-EP EP390, EP386, A3-EX03 EX0342.
- New rule pieces:
  - "目標は…このキャラクターと同じ分類を一種類以上持つキャラクターとのバトルによるダメージを受けない" (1688): "このキャラクター" is read as the target, as in the card's next line.
  - "このキャラクターを対象に含む、≪あなた以外のプレイヤーが使用したプロジェクトカードまたはファストカード≫を捨て札する。その後、≪このカード≫を捨て札する" (1658): when an opponent declares one aimed at this character.
  - "ネームを持つ帝のブレイクカード" (PP271) is read as a Polestar Empire (極星帝国) Break card with a name, as in its first line. A class works in a deck search too ("ネームを持つクリーチャーのブレイクカード").
  - "このカードが“X”にセットされた場合、代わりに、対象にNダメージを与える" (EX0059).
  - "…は精神力がX以上のキャラクターとのバトルによるダメージを受けず、精神力がX未満のキャラクターにガードされない" (EP390): X is fixed when the card resolves.
  - "目標にセットされているパワーカード全てを、目標以外のあなたの任意のあなたの支配キャラクターX体に1枚ずつセットする" (EP386): you choose X other Controlled Characters (fewer if there are fewer), and each gets one card.
  - "バトルの際、パワーが目標のパワー以下のキャラクターとのバトルによるダメージを受けない" (EX0342) uses the target's power at that moment. "目標のパワーが0の場合、目標のアタック宣言・ガード宣言は無効化される" is checked when the card resolves, for this turn.
  - "…はオーナーの手札に戻る" (without "その") for PP090.

Revise#216 — M3 batch 11 (Pack: "continue on card implementation").
- More cards run by themselves: A3-EX05 EX0605, EX0613, A3-EX03 EX0325, A3-EX04 EX0474, A3-EX02 EX0150. Partly automatic now: EX0112 (2 of 3 modes), EX0306, EX0322, 2799.
- New rule pieces:
  - "ターン終了時まで、目標がバトルによるダメージを与えた場合(際)、ダメージを受けたキャラクターにセットされているパワーカード全てを捨て札する" (EX0605): a watcher for the turn. EX0613 discards "目標のパワーに等しい枚数" instead, counted when the damage is dealt.
  - "ターン終了時まで、目標のバトル相手の持つバインドXのスキルを無効化する" (EX0613): the characters battling the target now.
  - "ターン終了時まで、目標がアタックした場合、目標にセットされているパワーカード全てを捨て札する" and "ターン終了時まで、アタックした目標からコストを支払うことはできない" (EX0325 / EX0474): both happen when the target attacks.
  - "目標がダメージを与えた場合、このカードを捨て札する" without ≪≫ (EX0112 / EX0306).
  - "…にシールドまたはペネトレイトを与える" (EX0112): the player of the card chooses one of the two skills.
  - Targets in either pile: "(あなたの)捨て札置き場またはダメージ置き場の(ブレイクカードまたはキャラクターカード / …を持つカード)N枚" (EX0322, 2799).
  - "メインフェイズ終了時まで、≪あなた以外のプレイヤー全て≫は、手札全てをプレイヤー全てに見せてプレイする" (EX0150): open hands for a while.
  - "目標がバトルまたはキャラクターにアタックした際に、目標の攻撃力に+Nして判定する" (EX0301 / EX0601): while it battles. Both cards are automatic now.
  - "目標は、アタックでない、バトル以外のダメージを受けない" (EX0303 / EXPV020, first line).

Revise#217 — M3 batch 12 (Pack: "Go next").
- More cards run by themselves: A3-14 1918, A3-EX02 EX0185, A3-EX05 EX0594, EX0600, EX0602, A3-EP EP387, EP202, A3-EXPR EXPR035, A3-EX04 EX0467, EX0468.
- New rule pieces:
  - "バトルの際、≪このキャラクターと、このキャラクターのバトル相手のキャラクター≫の攻撃力に、-1・-(1)して判定する" (1918): Attack −1 for both sides while it battles. A mental Attack is lowered by 1 the same way.
  - Item target "ダメージ置き場のカード枚数が8枚以上のあなたの対戦相手いずれか1人の、使用宣言中のカード1枚" (EX0185).
  - "…は対戦相手のダメージ置き場にあるプロジェクトカードの勢力全てに対するプロテクトを持つ" (EX0594): the factions are fixed when it resolves.
  - "このターン中に、あなたの支配キャラクターが対戦相手の支配キャラクターとのバトルによって捨て札されている場合" (EP387): the table now records it for each turn.
  - "メインフェイズ終了時まで、あなたの支配キャラクターが、プレイヤーまたはあなた以外のプレイヤーのテリトリーのキャラクターを目標にアタック宣言した場合、≪あなた≫は1ドロー可能" (EP202).
  - "ターン終了時まで、あなたの支配エリアのタレントのネームレベルキャラクターがバトルする際、≪そのキャラクターのバトル相手にセットされているパワーカード1枚≫を捨て札する" (EXPR035).
  - Watchers on the target's battles:
    - "目標がバトルする際、目標のバトル相手のパワーカードN枚を捨て札する" (EX0602).
    - "目標がバトルした場合、バトル終了時に目標のバトル相手をオーナーの手札に戻す" (EX0467).
    - "バトルの際、目標のバトル相手の持つスキル全て / 1つを無効化する" (EX0468 / EX0600).

Revise#218 — A4-01 0116 (Q#68), Auto-pick Player image, A3-18 2466 check (Pack).
- **A4-01 0116** "このキャラクターの攻撃力が10以上の場合、≪このキャラクター≫はペネトレイトを得る" (Pack's Kiriko, Q#68): the character has Penetrate while its Attack is 10 or more. The Attack used is the one worked out with every other change, including this card's own +X/+X. The battle then sends the damage beyond the guard's Defense to the attacked player.
- **Auto-pick Player image** (Pack): this is the first choice and the default.
  - It takes the picture of the faction with the most name-level Break cards in the deck you play: E.G.O. → 1, Arayashiki → 2, WIZ-DOM → 3, Darklore → 4, Polestar Empire → 5, Eraser → 6.
  - On a tie, the faction first in that order wins; a deck with none gets picture 1.
  - The tile previews the result for Solo deck 1. In a Solo game with two decks, each player gets their own deck's picture.
- **A3-18 2466** has been automatic since v4.31 (Revise#214). A test now runs the card from start to finish:
  - the player has Charge 5;
  - the charged cards are shown to you;
  - the step at the start of the Charge Phase waits for that moment.

Revise#219 — Deck Builder Import: Empty Check (Pack).
- The Import window has an **Empty Check** box. It is on by default, and the choice is saved on this device.
- With Empty Check on, Import first checks the slots it would fill: the open slot for a single deck, or every slot named in an "All decks" file. If any of them already has cards, the window asks "Would you like to overwrite slot number 1, 7 and 10?", with **Yes** / **No** buttons.
  - Yes imports.
  - No imports nothing and leaves every slot as it was.
- Empty slots are not mentioned. With the box off, Import overwrites without asking, as before.

Revise#220 — Template shows every printing; A3-11 1742; A3-22 3311 (Pack).
- **Template steps show every printing** (Pack). Each printing of a name that matches the step gets its own tile; before, there was one tile per name. The tile says "1 of N printings".
  - The +, −, ×4 buttons and the count on a tile are for that printing only.
  - The step's card count adds up every printing.
- **A3-22 3311** is now automatic.
  - Its cost goes down by the number of your Controlled name-level Eraser characters with イレイザー / イレイザー♂.
  - When it resolves, you choose 1 area of 1 player: an Active Area, or a Control Area (Front + Back). Every character in the other areas takes 5 damage.
  - With “ミカエル” in your Controlled Area, it is 10 damage instead, and every player but you takes 10 too.
- **A3-11 1742** (also A3-BS2 1742) is now automatic.
  - Target: a character in your territory.
  - When it resolves, you choose an Eraser (イレイザー / イレイザー♂) Break card from your hand whose cost equals the X you paid, and it is declared onto that target without paying again. Factor, name and break conditions must still be met.
  - A character broken this way goes to your Control Area as usual.

Revise#221 — A3-16 2175 and A3-22 3128 (Pack).
- **A3-16 2175** is now automatic.
  - "このカードがネームに「ブレイブ」を含むブレイクしているE.G.O.のキャラクターにセットされている場合、≪このキャラクター≫はブレイクスルーを得る".
  - Effect 0: it can be declared only when the Permanent cards on your Controlled Characters include 5 or more different “ブレイブ” E.G.O. names. You choose a “ブレイブカイザー” Break card in your hand; it becomes your Controlled Character. Then every “ブレイブ” E.G.O. Permanent card on your Controlled Characters moves onto it.
  - Effects can now have a "only when …" condition like this one.
- **A3-22 3128** is now automatic.
  - Target: a マシン Break card in your Damage or Discard Pile. Its cost X is the target's cost.
  - It mills X. Then you may declare the target, paying its cost as usual. When it is set, the top card of your deck becomes a power card of that character.
  - If the target is a “ブレイブ” E.G.O. card, this card can't be affected by Fast cards or effects from its declaration until it resolves.

Revise#222 — M3 batch 13 (Pack: "continue to implement card").
- More cards run by themselves: A3-EX03 EX0295, EX0297, EX0290, A3-08 1256, A3-19 2579, A3-EP EP342, EP198 (and others the compare lists).
- New rule pieces:
  - Triggers at the start of your / another player's Main Phase, at the start / end of your turn, and at "このキャラクターのバトル開始時" now also read the form written with "…時に、" (EX0295).
  - "≪このキャラクターと、(…)全て≫は+1/+1/+1される" (EX0297 / EX0290): this character, plus every other character that matches.
  - "≪あなたの使用する、カードテキストに「X」を含むカードのコスト≫は手札に戻る" (EX0290).
  - "≪このキャラクターのアタック宣言に対してガード宣言するか、このキャラクターにガード宣言されたキャラクター≫にセットされている、あなたの任意のパワーカード1枚を、そのオーナーの手札に戻す" (1256).
  - "…の中から、必要ファクターとコストの合計がX以下になるように任意の枚数選んで、あなたの手札に加える" (2579). Each card counts its required factors plus its cost. The cards are taken in the order picked, and any that would go over X stay where they are.
  - "このカードのコストが“A”、“B”、“C”全てから1コスト以上支払われている場合、≪このカードのコスト≫は手札に戻る" (EP342).
  - "≪あなたの任意のあなたの支配キャラクターX体≫に、精神力に等しくなるまであなたのデッキからカードを引いて、パワーカードとしてセットする" (EP198).

Revise#223 — Phase colours at the top of the panel (Pack).
- Your turn: 5 pastel blues, light → dark: Draw #dceFFF · Active #c3e2ff · Main #a9d3ff · Charge #8fc2f5 · Discard #76afe8.
- An opponent's turn: pastel red / orange / pink, light → dark: Draw #ffe3d8 (peach) · Active #ffcfae (orange) · Main #ffbccf (pink) · Charge #ffa8a8 (red) · Discard #f29191.
- The box stays light (the colour fades to white) with dark text, so it is easy to read. A watcher sees every turn in the opponent colours.
- Revise#222 also fixes A3-21 2972: its ability with an X line after it is automatic again.
- Log: every "By hand" line now starts with "!", like warnings (Pack). The pastel orange background stays.

Revise#224 — Card details Status table, effect text in Resolve, Charge window inside the hand, triggers after a choice (Pack).
- **Card details → Status now is a table.**
  - Columns: Source · Mental · Attack · Defense · Power · Skill.
  - The first row is the printed values. Then there is one row per card that changes the character, with its ±X in each column; a change to a mental Attack is shown as "(±X)". The Skill column lists only the skills that card gives. Cells with no change are left empty.
  - The last row, "Now", has the current values and Power / Mental.
  - The earlier boxes and text (costs, "Controlled", one line per source) moved into the "?" right of "Status now".
- **Resolve:** an Effect on the Resolve list shows its text under it (English, with the Japanese as the tooltip).
- **Hand:** the title bar is now the top of the hand window again, so you can drag it. The Charge window is part of the hand, at the bottom.
- **Charge window:** the cards you have already charged in this phase are listed under "Charged (pending)". A card is face up when you may see it — from the hand, or with "あなたがチャージの効果でセットするカードの内容を見ることができる" (A3-18 2466).
- **Bug (Pack): A3-20 2835 did not go back to the hand at the end of the turn.**
  - Cause: when the game had to ask a question on the way — in Pack's game, A3-25 3723 at the next player's Draw — the events before the question (here, "turn end") were not checked for abilities. The fix checks them before stopping for the question.
  - Pack's replay now returns 2835 to its owner's hand.
- **Pack's question: A3-18 2466 cost 3, not 2.** The opponent controlled A3-15 2096 (薬草戦士): "≪ダークロアのプロジェクトカード≫のコストは1上昇する". 2466 is a Darklore Project card, so 2 + 1 = 3 is correct. The first time in that game (cost 2) was before 2096 was on the field.

Revise#225 — Defaults, the Current column and one Player options page (Pack).
- **New defaults.**
  - Lobby: "Respond Together" and "Game Situation" are ON.
  - Game options: "Global Undo/Redo" is ON, and "Game Status pop-up" waits 60 s.
- **Game options → Skip (when Game Situation is ON):**
  - A new "Current" column shows what is skipped now. Click a cell to switch that row between Skip and Not Skip. The column header shows "Current*" while it differs from the situation.
  - Click a situation header (Build / Interfere / Conflict / Engage) to declare that situation. Current then follows it again.
  - The change is an option, not a game move, so Undo is not affected. It is written in the log ("… sets Effect to Not Skip").
- **Player options is one page:** Options first, then Card size. The "Size and Hold" tab is gone, and so is the Size bar at the head of your field.
- **Hold moved to Game options.** It shows in place of the Game Situation section when Game Situation is OFF. Hold Undo stays in the Undo section when Game Situation is ON.

Revise#226 — Deck Builder: a deck name at Finish, ▲ / ▼ beside the count (Pack).
- **Template Finish needs a deck name.**
  - The last step has a "Deck name" box. Finish does nothing while it is empty; the box turns red.
  - The default is the name-level name (the name in “…”) with the most copies in the deck. On a tie, the one that comes first in the deck wins. When the deck has no name-level card, the template's name is used.
  - The box keeps following the cards until you type in it.
- **Deck board:** each card has ▲ (one more) and ▼ (one less; at 1 it removes the card) around its "x N" count. The buttons do not start a drag and do not open the card panel.

Revise#227 — The other players' piles from across the table (Pack).
- The other players' fields are seen from the opposite side, like a real table: their piles are on the left. From the top they are Player · Discard · Deck · Damage (the reverse of yours: Damage · Deck · Discard · Player).

Revise#228 — M3 batch 14 (Pack: "Continue implement card").
- **A3-02 0388:** "Xが目標のキャラクターの精神力以上でなければ、このカードは効果を発揮しない" — when X is less than the target's Mental, nothing happens, and the log says so. The card is now automatic.
- **A4-EP EP425:** "X以上の数値の精神ダメージを受けない (X = this character's Mental)" — mental damage of X or more is not taken.
- **A4-EP EP436:** at the start of its battle, a battle opponent whose Mental is no more than this character's power count is discarded. In a joint battle it fires only when every opponent qualifies, and then discards them all.
- **A4-EP EP403:** at the end of your turn, your top deck card is set on it as a power card.
- **A4-EP EP437:**
  - Break rule: it can be broken only in a turn when a name-level character in your Control Area was discarded. The engine now records that for each turn.
  - Attack +2 while your Damage Pile holds a name-level Break card.

Revise#229 — M3 batch 15 (Pack: "Continue card implementation").
- **New works:** "ラグナロクオンライン(シリーズ)" (ragnarok) and "すーぱーそに子(シリーズ)" (sonico), taken from the card's expansion name.
- **EP466 / EP482 / EP515:** "このキャラクターに「ラグナロク ペコペコ」がセットされている場合、攻撃力に+X". The engine checks the card name of every card in that character.
- **EP522 / EP525 / EP528:** "≪あなたの“A”と“B”…≫のコストは1減少する". The reduction applies only to your own cards with those names.
- **EP541 / EP545:** "このカードはあなたが“ガンバスター”を支配している場合にのみ効果を発揮する". Without it in your Control Area, the card has no effect.
- **EP494 / EP555:** "ターン終了時まで、≪あなたが次に使用宣言する…のブレイクカードのコスト≫は手札に戻る". The rule is used up by the next matching Break card. A "next" cost rule now ends once a payment uses it.
- **EP603:** the cost of Super Sonico series Break cards returns to the hand until the end of the turn. It follows the existing work-series pattern, so like those cards it covers only your own Break cards. The text ("オーナーの手札") reads as every player's Break cards.
- **EP495 / EP554:** deck search for "ラグナロクオンラインシリーズのキャラクターカードまたはブレイクカード" and "トップをねらえ!シリーズのカード" (any card of the work).
- **EP590:** "≪プレイヤー全て≫はドロー+1を得る".
- **EP601:** "≪このキャラクター≫は分類・ワータイガーを得る".
- **EP485 / EP518:** at the end of your turn, if this character's power is less than its Mental, your top deck card is set on it as power.

Revise#230 — Wide-scale card abilities are Field Effects (Pack).
- Pack: "Please make the effect that take place on a 'wide scale' to 'Field Effect'. 'wide scale' means, affect all types as condition. Affect field, Affect player."
- **Field effects** now also lists every always-on ability of a card on the field (or in a Damage Pile) that reaches more than its own character. That covers players, every card of a kind ("≪ダークロアのプロジェクトカード≫のコストは1上昇する"), and every character that matches.
  - Each row shows the card, what it does ("Darklore Project cost + 1"), and whom it reaches. The card's text is shown under it.
  - The row says "while on the field". When its condition is not met now, the row is dimmed and says "not now (its condition)".
  - These rows have no "−" button: they end when the card leaves.
- An ability that changes only its own character (for example "≪このキャラクター≫は+1/+1/+1") stays in Card details, not in Field effects.
- The badge counts the rows. The old "+ N from cards" count is gone.
- Example (Pack's game): A3-15 2096 on the opponent's field now shows a row "Darklore Project cost + 1" — the reason A3-18 2466 cost 3.

Revise#231 — A3-11 1660 sets every chosen Permanent, one by one; "≪パーマネントカード全て≫にパーマネント+1" works (Pack bug).
- **Bug: only the first chosen Permanent was set.** "Up to X" Permanents chosen from a pile are now set one at a time.
- **The setting window (Pack's figure).**
  - The card being set is shown big, with its details beside it: name, type, cost and text.
  - The cards still to come are shown small below it.
  - Choose the character by clicking it on the field (blue border), the same way as Charge. The character names are also buttons in the window.
  - The window sits low on the screen, so the field stays clickable.
- **Bug: "メインフェイズ終了時まで、≪パーマネントカード全て≫にパーマネント+1を与える" did nothing.**
  - A skill given to cards ("≪…カード全て≫") was never applied. It is now one rule for every such card, including ones set later in that phase.
  - A character has the skills given to the Permanent cards on it, so Permanent +1 raises how many Permanents it can hold.
  - The source shows in the character's Status table.

Revise#232 — No summary on the option buttons (Pack).
- "⚙ Player options" and "⚑ Game options" no longer show "Build", "Hold 3/6", "Global Undo" and so on beside them. The Game Situation row and the side bars still show the settings.

Revise#233 — Game rules: "Response Timing" and the explanations (Pack).
- **"Respond Together" is now "Response Timing".**
  - Its box shows "1: By Sequence" (the old OFF) or "2: Anytime Interrupts" (the old ON) instead of OFF / ON. It still switches with one click, and the default is 2.
  - The rule is the same as before; only the name and the shown values changed.
- **New "?" explanations (Pack's words):**
  - **Response Timing:** "This setting changes how Response Timing works."
    - 1: By Sequence — The response is handled in sequence. The opposite side of the player who declares the action can respond first.
    - 2: Anytime Interrupts — The response is handled by anyone who declares a Response first.
  - **Game Situation:** "This setting enables a preset of the Hold function according to the game situation."
    - 1: Build — Used when all players have just started playing. Not much attention is needed.
    - 2: Interfere — Used when a player starts to interrupt another player. More responsive actions such as Project and Effect declarations should be attended.
    - 3: Conflict — Used when players start attacking each other. Break cards and Permanent sets should be attended.
    - 4: Engage — Used when players start a full-scale battle. All actions of the players should be attended.
  - **Auto-Skip:** "This setting changes how phasing works." A phase in which the player can take no action is skipped without asking for the player's attention.
  - **Auto-Pay:** "This setting changes how cost paying works." When the power cards that can be paid equal the cost, they are paid automatically, without the player needing to press "Pay".

Revise#234 — Auto Re-shuffle at the opening hand (Pack).
- A new **Auto Re-shuffle** button sits next to Keep hand / Re-shuffle.
- **What it looks for**, in the hand:
  - Character cards ≥ 3.
  - A Character with Draw ≥ 1.
  - A Character with Charge **and** an effect "Return ≪this effect's cost≫ to its owner's hand" (≪このエフェクトのコスト≫をオーナーの手札に戻す) ≥ 1 (Pack). 100 printings (65 card names) in the list have both.
- **One press:**
  - If the hand already matches, nothing is shuffled.
  - Otherwise the hand goes back, the deck is shuffled and 7 are drawn, up to 10 times, until it matches.
- **When it matches,** the "Re-shuffle" and "Auto Re-shuffle" counters go back to 0, and a short note says how many re-shuffles it took.
- **When 10 re-shuffles find no match,** a message box says "You are SCREWED!". From the third Auto Re-shuffle that fails, it also says "Please re-adjust your deck...".
- The buttons show their counters.
- Under the buttons, three marks show what the current hand has: Character x/3 · Draw x/1 · Charge + effect cost back x/1.
- The log says what happened.

Revise#235 — Skill values everywhere (Pack).
- Skills with a number show it with its sign: "Permanent +1", "Charge -1", "Charge +5", "Draw +1", "Capacity -1".
  - This applies in the Status table's Skill column, the Skills chips and the "?" details.
  - Other numbered skills show the number without a sign (Bind 1).
- In the Status table, the same skill twice from one source adds up. A3-11 1660 on two Permanents of one character shows "Permanent +2" instead of "Permanent, Permanent".

Revise#236 — Event screens can be dragged and folded (Pack).
- Every event screen can be dragged by its title bar. That covers choices, Set a Permanent, Changing Target, ability pop-ups, Undo requests, the Auto Re-shuffle message and the Pay window.
- A "▾" button at the right of the title folds the screen to its title bar; "▸" opens it again.
- Each kind of screen remembers where it was moved and whether it is folded, until the page is reloaded.

Revise#237 — Status table: the source card as its picture (Pack).
- The Source column of Card details → Status now shows the picture of the card that made each change, instead of its name. The picture is about two rows high. The name is in its tooltip.
- Click the picture to open that card's details.
- Rows with no card behind them (an effect added by hand, Intercept, the printed values) keep their text.
- The engine records, for every line of a character's status, which card made it. For a skill given to a card (A3-11 1660's Permanent +1), the line belongs to the card that gave it.

Revise#238 — Normal and mental Attack worked out separately; A3-08 1247 (Pack bug).
- **Bug:** A3-08 1247's two effects did not change the status.
  - The effects are "X: ≪このキャラクター≫の攻撃力に-X・+(X)する" and "X: …+X・-(X)する".
  - On a mental-Attack character, "-X・+(X)" was ignored. The split only ever used part of the Attack.
- **Now (Pack's rule):** a character's **Normal Attack** and **Mental Attack** are worked out on their own.
  - Printed Attack counts in its own kind: "2" is normal, "(2)" is mental.
  - "攻撃力に+N" (or −N) changes Normal Attack; "+(N)" changes Mental Attack.
  - "-X・+(X)" is Normal −X and Mental +X; "+X・-(X)" is Normal +X and Mental −X.
  - Each one is at least 0: a value worked out below 0 counts as 0. Attack is the two together.
  - Example: a 3 Attack character with "-5・+(5)" has Normal 0 and Mental 5.
- **Where it shows:**
  - Card details shows both ("1 (2)").
  - The Status table shows each change in its own row: Attack −X and (+X).
  - Battle damage uses the same two numbers.

Revise#239 — Too many Permanents are dealt with at once (Pack bug).
- **Bug:** A3-11 1660's Permanent +1 ended with the Main Phase, but the extra Permanent stayed until the character's next move. Only then did the Permanent discard screen appear.
- **Now:** whenever a character holds more Permanents than its limit, the owner chooses which ones go at once. That includes when "パーマネント±X" ends or changes, or the character loses a skill.
- Note: "≪パーマネントカード全て≫にパーマネント+1を与える" gives Permanent +1 to every Permanent card. A character with 2 Permanents therefore has Permanent +2 while it lasts.

Revise#240 — Auto-pick beside "Player image" (Pack).
- The Auto-pick button is now a small button right of the "Player image" title and its "?", instead of the first tile.
- It is still one choice with the pictures: choosing a picture turns Auto-pick off, and choosing Auto-pick clears the picture.

Revise#241 — The other players' piles back on the right; Player · Discard · Deck · Damage (Pack).
- The other players' piles are on the right of their field again, like yours (Pack: "Please move opponent player back to right side").
- From the top they read Player · Discard · Deck · Damage (Pack). A Removed pile, when there is one, comes right after the Player.
- Your own side is unchanged: Damage · Deck · Discard, and the Player at the bottom right.

Revise#242 — M3 batch 16: 境界線上のホライゾン (Pack: "implement card").
- **EX0682 / EX808:** "≪このキャラクター≫から、武蔵を持つあなたの支配キャラクターのアタックコスト・ガードコストを代わりに支払うことが可能". "Pay for" now also takes a selector (here, the 武蔵 tag).
- **EX0677 / EX826 / EX831:** a skill while "あなたの支配エリアに分類・マシンがいる", or while "英国を持つ(ブレイクしている)あなたの支配キャラクターが3体以上いる".
- **EX0678:** "≪このキャラクターから支払われた“地摺朱雀”のコスト≫は手札に戻る".
- **EX0683:** "≪このキャラクター≫は対戦相手の使用したプロジェクトカード・ファストカードの効果を受けない" until the end of the turn.
- **EX0745:** look at the target opponent's whole hand.
- **EX0763 / EX907:**
  - EX0763 returns a card from your Discard Pile to the deck.
  - EX907 returns a "境界線上のホライゾンシリーズのカード" from your Discard Pile to your hand.
  - Pile selectors now accept a work name.
- **EX826:** deck search for "英国とネームを持つブレイクカード" (tag + named).
- **EX882:** until the end of the turn, the cost of "英国とネームを持つブレイクカード" returns to the hand.
- **EX830:** "≪このキャラクター≫に次に与えられるバトルによるダメージを無効化する" — the next battle damage only.
- **EX827:** "≪あなた以外のプレイヤーの支配キャラクター≫は、アタックコストが1上昇する", and "目標のアタックコスト・ガードコスト・エフェクトコストは1上昇する".
- **EX829:** characters guarding against this character's attack pay 1 more Guard cost.
- **EX871:** "≪このキャラクター≫はガード宣言されない" until the end of the turn.
- **EX804:** "+5・+(5)" while in battle (Normal +5 and Mental +5, Revise#238).

Revise#243 — Permanents pile to the right like power cards (Pack).
- When a character holds several Permanent cards, they are shown in one row to the right of the character, overlapping like its power cards, instead of one under another.
- Hover over a Permanent to see it bigger.

Revise#244 — Status table: the source picture at the size of Structure; Permanent +1 credited to each Permanent (Pack).
- **The source picture** in Card details → Status is now the same small card as in Structure / Power cards. The dashed "source" frame that ran around it is gone. Click it to open that card's details.
- **A3-11 1660:** "≪パーマネントカード全て≫にパーマネント+1を与える" gives Permanent +1 to each Permanent card. The Status table now shows "Permanent +1" on the row of each Permanent card on the character, not on a row for 1660.
  - Example from Pack's replay: A3-25 3680 has A3-08 1247, A3-08 1246 and A4-03 0476 set on it. Each row shows Permanent +1, and its Permanent limit is 1 + 3 = 4.

Revise#245 — Choices on the field; M3a batch 1 (Pack).
- **Choices are made on the field (Pack: "When selection is needed, make selection on field as much as possible").**
  - A choice of players, characters or areas is now made by clicking them on the field. Examples: A3-24 3574 "≪あなたの任意のエリアのキャラクター全てと、あなたの任意のプレイヤー全て≫", "≪あなたの任意のキャラクターまたはプレイヤー1人≫" and "あなたの任意のエリア1つ".
  - What can be chosen gets the blue border: Players (the Player tile), characters, and areas (the Active Area row, or the Control Area rows).
  - A small bar at the bottom says what to choose and holds only the buttons that are not on the field ("Done — deal the damage" / "None").
- **A3-03 0518 バレンタインチョコ:**
  - With its cost not paid from the target, the card has no effect.
  - Its cost returns to its owner's hand.
  - Until the end of the Main Phase, when the target attacks a player, you take (X) (X = the target's power).
  - The rule "the cost must be paid from the target" is not enforced at payment; the card simply does nothing otherwise.
- **A3-03 0593 死霊術:**
  - Its cost goes to the Damage Pile.
  - Choose a Break card of total factor X in your Damage Pile, then a power-0 Controlled Character of yours; the card is set on it, ignoring name, class and Break rule.
- **A3-04 0653 手作り弁当:** the target's power cards and 1 card of your Damage Pile go back into your deck, which is shuffled. You draw that many, and your Main Phase ends.

Revise#246 — A3-24 3574: areas, then players; X when it is set (Pack bug).
- **Choosing areas, then players.** "≪あなたの任意のエリアのキャラクター全てと、あなたの任意のプレイヤー全て≫" is now chosen in two steps:
  - First the areas: only areas are highlighted on the field, and any number can be clicked one after another. A chosen area is marked yellow. "Next: choose players" ends this step.
  - Then the players: only the Players are highlighted, any number. "Done — deal the damage" ends it.
- **Bug: X was 0 when 3574 was set.**
  - "Xはこのキャラクターを構成する、このカードと同じネームを持つカードの枚数に等しい" was attached only to the last ability (when discarded).
  - Now one "Xは…" line of a card counts for every ability of that card that uses X. When 3574 is set, X = 1 (itself), or more with “ミカエル” under it.

Revise#247 — A3-11 1742: the Break card from the hand is set on the target (Pack bug).
- **Bug:** when A3-11 1742 resolved, no Break card could be chosen. "Set a card from the hand on the target" only ran when the effect had a source character. A Fast / Project card has none.
- **Now:** the step also runs when it sets onto the target.
  - You choose 1 Break card from your hand with イレイザー or イレイザー♂ whose cost equals X; factor, name and Break rule must still be met. It is set on the target.
  - Other cards that set a card from the hand onto their target are fixed the same way.

Revise#248 — A3-15 2105 オルタレイション・マジック, reworked (Pack).
- Pack: "This card can be casted when any card with text to select target as controller's choice is declared. When this card is resolved, select the controller's choice the same way as the target card (normally, click on field). No need to use event box."
- **What it can target:** a declared Project / Fast card or Effect whose text makes a "あなたの任意の…" choice (the controller's choice). A3-22 3311 "≪あなたの任意のエリア1つ以外のエリアの…≫" is one. A card whose objects are 目標 only can no longer be chosen.
- **When 2105 resolves:**
  - If that card's choice was already made when it was declared, the 2105 player chooses again now. Click the new one(s) on the field (blue border); a small bar names the old one. The "Old target → New target" box is gone.
  - Every choice that card makes when it resolves (for 3311, the area that is spared) is asked to the 2105 player instead of its controller, chosen on the field in the same way.
- Note: a yes / no question of that card ("…可能") stays with its controller.

Revise#249 — M3a batch 2 (Pack: "Continue implement card").
- **A3-03 0556 妖刀:** when a name-level character attacks this character's owner and this character doesn't guard (no guard, or another guards), every power card on it goes to its owner's Damage Pile.
- **A3-04 0676 パフューム, 2nd effect:** until the end of the Main Phase, when this character declares an attack, the target (Mental X or less) guards it at once. The rule that a normal guard is also possible is not modelled: the forced guard comes first.
- **A3-04 0690 呪舞:** until the end of the Main Phase, whenever a character declares an attack, a guard or an effect, you may return its power cards to their owner's hand — up to X in all for the whole phase.
- **A3-04 0702 コズミックラブ:** until the end of the Main Phase, any player may break the target at fast timing, even with power cards on it. When it is broken, its power cards go to their owners' Damage Piles.
- **A3-05 0843 メタモルフォシス (partial):**
  - Choose a class for the target.
  - You may break it at fast timing, and the cost of a Break card declared on it returns to the hand.
  - Still by hand: the factor −X of that Break card. The engine checks the factor before the target is chosen.
- **Engine:**
  - "May break at fast timing" can now name every player or one player.
  - The Break rule "an opponent's character with power cards can't be broken" can be lifted.
  - A step can mark its card "partial".

Revise#250 — M3b batch 1 (Pack: "continue next").
- **A3-07 1103:**
  - When it resolves, discard any number X of cards from your hand, then put one of your Controlled Characters (chosen on the field) into your Damage Pile, then deal (X) to the target.
  - The card says the discard is done "when it is declared"; here it happens when it resolves, like other cards of this kind (Revise#165).
- **A3-09 1418:** until the end of the Main Phase, after that character deals damage to a player, you discard up to X cards of your choice from that player's hand. Watchers now know which player was hit.
- **A3-09 1486:**
  - Until the end of the Main Phase, if the target is discarded, all its cards go back to their owners' decks, which are shuffled.
  - At the end of the Main Phase, every card in a Damage Pile with a class of the target goes back to its owner's deck, which is shuffled. The classes are taken when the card resolves.
- **A3-09 1349:**
  - At the end of your Main Phase, with 1 card or fewer in your Damage Pile, this card and the cards set on its character go to your Damage Pile.
  - At the end of the turn, you put 1 card of your Damage Pile into the Discard Pile.
- **Engine:** "…以下だった場合" conditions are supported.

Revise#251 — M3b batch 2 (Pack: "Continue implementation").
- **A3-07 1137:**
  - Until the end of the Main Phase, the Guard cost paid against the target's attack returns to its owner's hand.
  - When the target attacks a player and is not guarded, there is no damage check. Instead, up to as many cards as the target's Attack are chosen from that player's hand and go to its owner's Damage Pile. The choice is made by the attacker's controller.
- **A3-09 1354:**
  - Until the end of the Main Phase, when the target attacks a player, there is no normal damage check. The player is damage-checked one card at a time until one card lands in their Damage Pile.
  - When it attacks a player, its owner draws 1.
- **A3-09 1385:** declare a Project or Fast card of cost X or less from your deck, paying its cost, then shuffle. That card ignores its factor.
- **Engine:** a Guard-cost rule can apply only against one attacker. A "no damage check" effect knows which player was attacked.

Revise#252 — M3b batch 3 (Pack: "Continue").
- **A3-09 1417:** choose a Break card from your hand whose cost equals X. It is set on the target (one of your Controlled Characters), ignoring factor; it must share a class with the target, and name and Break rule must be met.
- **A3-09 1452:**
  - Choose a class. Until the end of the Main Phase, a character with that class that is discarded goes to its owner's Damage Pile instead, all its cards.
  - New rule key: "goes to the Damage Pile when discarded".
- **A3-09 1485:** X characters with イレイザー / イレイザー♂ get Attack +X until the end of the Main Phase, and may attack characters.

Revise#253 — M3b batch 4 (Pack: "continue next").
- **A3-09 1316:**
  - While it is set on a character, more than one character with that character's name may be on the field.
  - The cost of a Break card with that name returns to its owner's hand.
- **A3-09 1453:**
  - Every non-name-level Break card in your Damage Pile becomes a Controlled Character of yours, with アンデッド and Intercept until the end of the turn.
  - At the end of the turn they go back to your Damage Pile.
  - Its last sentence (if this card is removed) has nothing to do: a Fast card is not on the field.
- **A3-08 1255 / 1258:** when 胡桃 えいむ pays an Attack or Guard cost, the Pay window offers "Top card of your Discard Pile → top of your Deck" instead. After that, the Permanent goes back to your hand.

Revise#254 — Disclaimer on the Home page (Pack).
- At the bottom of the Home page, in its own box: "This is an unofficial, non-profit fan project created solely to preserve the memory of Aquarian Age TCG. All card art, logos, and character designs are intellectual property of Broccoli / original illustrators. Not affiliated with or endorsed by the copyright owners."

Revise#255 — M3b batch 5 (Pack: "Let's get back to implement card first").
- **A3-07 1071:** the target player shows the top 3 cards of their deck to your opponents. You put them back on top in any order, then you may have that player shuffle.
- **A3-09 1384:** show the top card of your deck.
  - A Break card may be set on one of your Controlled Characters, ignoring factor and cost (class, name and Break rule must be met). If you set it, your Main Phase ends at once; if not, it is discarded.
  - Any other card goes to your Damage Pile.
- **A3-09 1484:** name a card type. The target player shows cards from the top of their deck until one of that type appears; it goes to their Damage Pile, and the deck is shuffled.
- **A3-07 1106:** until the end of the Main Phase, when the target (a broken character) guards, you discard up to X cards of your choice from the hand of the guarded character's owner.
  - New watcher option: the guarded (attacking) character is the event character.
- **A3-09 1319:** designate one of your characters and discard 1 power card set on it. Until the end of the Main Phase, a character sharing a class with it takes (1) damage when a cost is paid from it.
- **Future plan (Pack):** built-in card images. Bundle about 8,300 thumbnails (160px WebP, about 65–90 MB) with the site instead of loading them from Google Drive. Check Netlify bandwidth and deploy credits first. Not started.

Revise#256 — M3a / M3b batch 6 (Pack: "continue implementation until all cards are completed").
- **A3-04 0654 / 0657 (式神刹那式):** the card becomes a Controlled Character (no faction, 式神) with your whole hand as power cards; stats come from its structure, like 式神阿式. It can pay only Guard costs. At the end of the turn its power cards go back to your hand and the card is discarded.
- **A3-09 1353 (式神吽式):** the card becomes a Controlled Character (no faction, 式神) whose power cards are this card's cost plus X cards of your hand. It has 「1: discard a target Project or Fast card」 and can pay only effect costs.
- **A3-07 1206:** X cards from the top of your deck go to your Damage Pile. Name a faction: until the end of the Main Phase, all its characters get +X to Mental, Attack and Defense.
- **A3-09 1488:**
  - Each attacking or guarding Controlled Character gets the top card of its owner's deck as a power card.
  - Then the attack is cancelled.
  - Then every declared or lasting Project / Fast card goes back to its owner's hand.
- **A3-07 1073:** when it resolves, you may discard 1 hand card to return this card to your hand at the end of the Main Phase. Defense +X works as before.
- **A3-09 1322:** choose a Break card from your hand with cost X or less; it is shown. Until the end of the Main Phase the target adds that card's stats, and until the end of the turn it has the card's skills. At the end of the turn the card goes back to your hand, or is discarded if the target is gone.
- **A3-07 1066:** new card abilities:
  - When you draw it: return 1 card of your Damage Pile to your hand.
  - When it goes to the Damage Pile by a damage check: discard the top card of your deck.
  - When you discard it in the Discard Phase: you draw 1 at the end of the turn.
- New trigger condition: "in this phase" (the Discard Phase).

Revise#257 — M3c / M3e batch 7 (Pack: "continue implementation until all cards are completed").
- **A3-14 1974:** when it resolves you discard X hand cards (X = how many). Until the end of the Main Phase, a character that guards the target's attack takes (X) damage. At the end of the Main Phase you draw X.
- **A3-15 2150:** a player is designated (not a target). Until the end of the Main Phase:
  - Their Controlled Characters pay +1 to guard.
  - A character guarding against their Controlled Characters' attacks pays 1 less.
- **A3-14 2028:** designate a named Controlled Character of yours. Until the end of the Main Phase, your non-name-level Controlled Characters that share a class with it get Attack +1 and its skills.
- **A3-11 1689:** −1/−1/−1 for each Permanent card set on the target (counted when it resolves). If the target would be discarded, you may discard one of its Permanent cards and this card to keep it on the field.
- **A3-11 1743:** while the target battles, its battle opponent has no skills (until the end of the Main Phase). The summed Attack / Defense with a guard that is already there is still by hand.
- **A3-11 1662:**
  - The player the target attacks discards their whole hand.
  - The target's battle opponent is discarded at the end of the battle.
  - This card goes to your Damage Pile instead of the Discard Pile.
- **A3-11 1741:**
  - The target gets Stealth. When it attacks, every card set on it is discarded, it becomes an Active Character after the battle, and this card is discarded.
  - A faction (Active Area) target moves to your Control Area and attacks a player of your choice.
- **A3-20 2695:** the target guards an attack on you if there is one; otherwise it attacks.
- **A3-22 3129:** the attacker is changed to the target, another Controlled Character of the attacker's owner.
- **A3-22 3235:** until the end of the Main Phase, a character that guards against an attack of your Controlled Characters takes 1 damage. X is the cost you pay; the cap (your Damage Pile count) is not checked.

Revise#258 — M3f batch 8.
- **A3-24 3473:** 3 cards from the top of your deck go to your Damage Pile. Then you draw 1 and return one card each from your Discard Pile and your Damage Pile to your hand.
- **A3-25 3802:** every player shuffles their hand, Discard Pile and Damage Pile into their deck, then draws 7.
- **A3-25 3696:** you look at the target player's hand. You may put one non-Character card from it on the bottom of their deck; if you do, they draw 1.
- **A3-24 3435:** the target (no Permanent card set on it) gets Attack +2.
  - If it has Permanent −X, it also gets Initiative and Penetrate.
  - If that −X totals 2 or more, it gets Attack +3 more.
- **A3-25 3800:** the target (a Controlled Character of yours) attacks; then you may put this card into your Damage Pile.
- **A3-23 3335:** you draw 1, then each opponent in turn is asked "draw 1?", then you again, and so on. The first "no" ends it for everyone.
- New selector: "a character with no Permanent card set on it".

Revise#259 — Saga 4 patterns that repeat across many cards.
- **Own factor / cost while in the hand:** a card's own "<condition>、≪このカード≫の必要ファクター / コストはN減少する" now works. Examples: "あなたが先攻でない場合" (not the first player), or "あなたの支配エリアにイレイザー(勢力)の分類・イレイザーが3体以上いる場合" (at least 3 Controlled Characters with that class).
- **Declaration-time draw:** "このカードの使用宣言時に、≪あなた≫はNドローする" draws at the declaration, after the cost is paid.
- **Also treated as a name:** "≪このカード≫は“N”としても扱う" gives the card that name too.
- **New X definitions:**
  - The number of cards in this character whose name contains a given text (e.g. 「フォルナ」).
  - The same count over every character on the field.
- **Saga 4 class targets:** "分類・A・B全て" / "分類・A1人" (and the short form "イレイザ-") read as characters with class A or B.

Revise#260 — Saga 4 patterns, batch 2.
- **"このキャラクターを構成する“N”k枚につき、≪このキャラクター≫は…":** for every k cards named N in this character, it gets the stats and also skill values (Charge, Bind …). It may have a condition before it (e.g. "このキャラクターのパワーが精神力に等しい場合").
- **"≪あなた≫は、“N”の必要ファクターを無視してセット宣言可能":** your cards with name N ignore their factor.
- **"このカードがダメージ置き場にある場合、≪このカード≫を手札にあるカードと同様にセット宣言可能":** it may be set from your Damage Pile.
- **"≪あなた以外のプレイヤー全て≫は、手札全てを公開してプレイする":** opponents' hands are open, the same as "…見せてプレイする".
- **"≪あなたのデッキ≫から<card>N枚を選び、捨て札する":** you choose them from your deck. "その後、そのデッキをシャッフルする" works as well.
- **"あなたが先攻の場合、≪このカード≫のコストはN上昇する":** the card's own cost goes up while you are the first player.
- **"このエフェクトは各ターンに1度しか使用宣言できない":** once per turn.
- **"≪あなたの手札全て≫をパワーカードとしてこのキャラクターにセットする":** your whole hand becomes its power cards.
- **New X definition:** "このキャラクターを構成する、このカードの下の“N”の枚数" (counted as cards named N in the character).

Revise#261 — Saga 4 patterns, batch 3.
- **"このキャラクターにセットされているパーマネントカード1枚につき、≪このキャラクター≫に…":** the stats count each Permanent card set on it.
- **"≪あなた≫は、あなたのダメージ置き場のブレイクカードを、手札にあるカードと同様にセット宣言可能":** your Damage Pile Break cards may be set.
- **New X definition:** "Xはあなたのダメージ置き場の枚数に等しい" (written without カード).

Revise#262 — batch 9.
- **A4-01 0117 / A4-PR PR021 (and "≪あなた≫の、ダメージ置き場のカード枚数による敗北条件に+N枚する" on a card on the field):** your Damage Pile loss limit goes up by N.
- **"目標の≪…≫が次にバトルによるダメージを与える場合、攻撃力に+Nして判定する":** the target's next battle damage counts its Attack +N. On A4-EP EP497 / EP503 / EP510, the extra "…系" sentence is still by hand.
- **A3-22 3130:** a player and a card name are designated. You look at that player's hand and discard every non-Character card with that name.
- **A3-22 3309:**
  - Up to 3 cards from the target's hand (your choice) go on top of their deck.
  - Then you choose the same number of cards from anywhere in that deck for their hand.
  - The deck is shuffled and you draw 1.

Revise#263 — batch 10.
- **A3-16 2177:** designate a Controlled Character of yours. Until the end of the Main Phase, any of your Controlled Characters may pay its Attack and effect costs.
- **A3-19 2551:** designate up to X characters. Until the end of the Main Phase they have no skills or effects, cannot attack or guard, cannot pay costs, and lose their factor.

Revise#264 — batch 11.
- **A3-EP EP071:** "…。(2):…" written right after a sentence is read as an effect line (cost 2).
- **A3-04 0652:** this Permanent card may pay 1 of the character's Attack or Guard cost as if it were a power card; it then goes to your Damage Pile.
- **A3-EX02 EX0168:** until the end of the Main Phase, each of your Controlled Characters that attacks a player gets Attack +3, and the battle opponents of those characters lose their skills.
- **A3-EX05 EX0622 / EX0634:**
  - Until the end of the turn, no character can attack, guard or declare effects.
  - The first card declared after that discards this card.
  - The "cast it from the Damage Pile" rule is still by hand.

Revise#265 — batch 12 (Saga 4).
- **"追加のNコストを支払うことで、あなたはこのカードを、ファストカードのタイミングで使用宣言可能":** at Fast timing (outside your own Project timing) the card costs N more. Applies to A4-01 0053, A4-PV PV077, A4-PP PP182 / PP188.
- **"≪…≫はアタック宣言・ガード宣言・コストの支払いができない":** cannot attack, guard or pay costs.

Revise#266 — batch 13.
- **"+X/+X・+(X)/+X":** the Attack written as "normal・(mental)" reads its first part, as in M3a batch 3. This now works in effects and in always-on abilities (A4-04 0614, A4-PP PP217 and others).
- **"このキャラクターがプレイヤーにアタックした場合、通常のダメージ判定の後、≪アタックを受けたプレイヤーのデッキ≫の上からカードをN枚捨て札する" (A4-04 0739 / A4-PR PR087):** after the damage check, the top N cards of the attacked player's deck are discarded.
- Triggered abilities now know which player was hit.

Revise#267 — batch 14.
- **A4-04 0773 / A4-PR PR092:** the target player may discard 1 card from their hand. If they don't, the top 5 cards of their deck are discarded.
- **A4-03 0447 (and similar):** "≪プレイヤー全て≫は自分のダメージ置き場または捨て札置き場の<class>N枚を、オーナーの手札に戻す" — each player returns N such cards to their hand.
- **A4-03 0543 (and similar):** "≪あなたの捨て札置き場にある<card>N枚≫を、あなたの支配キャラクターとしてセットする" — from your Discard Pile to your Control Area.
- **A4-02 0343 / A4-PV PV069:** "目標が<kind>の場合、さらに攻撃力に+Nする" — an extra Attack bonus for such a target.

Revise#268 — Saga 4 Break rules.
- 【分類に関わらず、A または B のキャラクターをブレイク可能】 (two factions)
- 【分類に関わらず、勢力キャラクターをブレイク可能】 (characters in the Active Area)
- 【分類に関わらず、あなたのテリトリーの▼を持つキャラクターをブレイク可能】
- 【A・B・C を分類を無視してブレイク可能】 (those classes)
- 【パワーNのキャラクターを、ネーム・分類を無視してブレイク可能】

Revise#269 — Saga 4 batch.
- **New triggers:**
  - "このキャラクターが支配キャラクターとのバトルによって捨て札される場合" (when this character is discarded by battle)
  - "このキャラクターがプレイヤーを目標にアタック宣言した場合" (when this character attacks a player)
- **New condition:** "あなたの対戦相手がネームレベルキャラクターを支配している場合" — an opponent has a name-level Controlled Character.
- **"≪このキャラクターにセット宣言するブレイクカードのコスト≫はオーナーの手札に戻る":** the cost of a Break card set onto this character returns to its owner's hand.

Revise#270 — Saga 4 タレント (Talent) cards (A4-04).
- **"あなたの支配エリアにこのカードと異なるネームを持つブレイクしているタレントがいる場合、≪このカード≫の必要ファクターはN減少し、≪このキャラクター≫は<skills>を得る":** while you have a broken タレント with a different name, the card's factor is N less and the character has those skills.
- **"あなたの支配エリアの、このキャラクター以外のネームを持つブレイクしているタレント1人につき、≪このキャラクター≫は+a/+b/+cされ、キャパシティ+Xの数値に+1される":** counted from your other broken name-level タレント.

Revise#271 — Saga 4 batch.
- **"このキャラクターが捨て札される場合、≪このキャラクターを構成する“N”全て≫をダメージ置き場に置く" (A4-03 0537 / 0552 / A4-PP PP141):** when it is discarded, its cards named N go to the Damage Pile instead of the Discard Pile.
- **"このキャラクターにパーマネントカードがセットされている場合、≪このキャラクター≫は<skills>を得、(プレイヤーにアタックした場合、)このキャラクターを構成する“N”k枚につき、攻撃力に+a…" (A4-01 0049 family / A4-05 0841 family):** with a Permanent set on it, it has those skills and gets Attack +a for each k cards named N; with "プレイヤーにアタックした場合", only while attacking a player.

Revise#272 — Saga 4 batch.
- **"<condition>、≪このカード≫の必要ファクターはN減少し、≪このキャラクター≫は<skills>を得る":** works with any known condition, e.g. "あなたが先攻でない場合" (A4-05 0797 / 0815).
- **New condition:** "このキャラクター以外のネームレベルキャラクターがいる場合" (A4-04 0702 / 0717).
- **"≪キャラクター全て≫は、分類に関わらずブレイク可能" (A4-05 0912 / 0930):** while it is on the field, Break cards may be set ignoring class.
- **"≪イニシアチブをNつ以上持つこのキャラクター≫はガードされない" (A4-05 0800 / 0818):** it cannot be guarded while it has N or more Initiatives.

Revise#273 — Saga 4 batch.
- **New X definition:** "Xはこのキャラクターの持つイニシアチブの数に等しい" (A4-05 0800 / 0818).
- **New condition:** "あなたのテリトリーのキャラクターの持つ分類の総数がN種類以上の場合" — counted from the printed classes of the cards in your characters (A4-05 0912 / 0930).

Revise#274 — Saga 4 batch.
- **"≪このキャラクターのアタック宣言に対してガード宣言したキャラクターのオーナー≫にXダメージを与える" (A4-05 0838 / 0856):** when this character's attack is guarded, the guarding character's owner takes X damage.
- **A4-04 0604 / 0619:** when it is set, you look at the hand of the owner of the character it was set on and may discard 1 of those cards.
- **A4-04 0700 / 0715:** when it discards an opponent's Controlled Character by battle, that character's owner discards 1 hand card of their choice and you draw 1.
- **"≪あなたの任意のエリア1つの、<kind>キャラクター全て≫にNダメージを与える" (A4-05 0947 / 0965):** you choose an area; only the matching characters there take the damage.

Revise#275 — Saga 4 (境界線上のホライゾン and others).
- **"≪あなた≫は、武蔵とネームを持つブレイクカードを、ファストカードのタイミングでセット宣言可能" (EX793):** your Break cards with that tag and a name may be set at Fast timing.
- **"“A”または“B”のネームを持つブレイクカードをファストカードのタイミングでセット宣言可能" (EX849):** the same, for those names.
- **"≪あなた≫は、このキャラクターに、ファストカードのタイミングでブレイクカードをセット宣言可能" (EX825):** Break cards may be set on this character at Fast timing.
- **"このキャラクターが捨て札される場合、≪このキャラクターにセットされているパーマネントカード1枚≫は手札に戻る" (EX0705):** one of its Permanent cards goes back to the hand.
- **"このカードがセットされた際、≪対戦相手全て≫は手札の内容を公開する" (EX799):** opponents show their hands.

Revise#276 — Saga 4 pairs.
- **A4-01 0114 / 0128:** this card goes back to the hand when the character is discarded as a result of battle.
- **A4-01 0143 / 0158:** when it is set, you may set 1 Permanent card from your hand on this character.
- **A4-02 0337 / 0352:** when its damage discards a character, you draw 1.
- **A4-02 0341 / 0356:** when it battles, its battle opponent loses all skills and effects until the end of the turn.
- **A4-02 0309 / 0324:** when it is set or attacks an opponent, return 1 card of your Damage Pile to your hand.
- **A4-03 0437 / 0452:** when it is set, its Attack Cost is 0 this turn.
- **New X definition:** "あなたのダメージ置き場に置かれているネームを持つカードの枚数" (A4-03 0441 / 0456).

Revise#277 — Saga 4 batch.
- **New condition:** "このキャラクターがアタック宣言またはガード宣言している場合" (also with "、バトルの際、"), e.g. A4-01 0048 / 0063: damage to your Controlled Characters −(2) while this one battles.
- **A4-PP PP020 / PP028:** when it is set, the other players show their hands.
- **A4-PP PP079 / PP087:** damage to you is taken by this character instead.

Revise#278 — Pack bug: A3-17 2388.
- **"キャパシティ+∞" / "パーマネント+∞" on a card were lost.** They are now kept as a value of 99, shown as "∞". The character gets them, together with Boost ∞, Shield, Infinity, Intercept, Breakthrough, Initiative and Penetrate.
- **The Status table now shows a row for every Permanent card that gives skills,** with its picture as the source, even when it changes no stats (Pack: A3-05 0860 with A3-17 2388).

Revise#279 — Pack bugs (phone).
- **Details screen on a phone:** the small card pictures (Status source, Structure, Permanents) showed only the left part of the card. The phone rule that sizes the main card picture (140px wide) was also hitting every picture inside the details. Now it applies to the main picture only.
- **Capacity +∞:** the hand limit and the Player stats show "∞" instead of 106.

Revise#280 — Pack: phone table layout (iPhone 15 Pro Max felt tight). Released alone as v4.61 so it can be reverted to v4.60.
- **Fit to width:** on screens up to 600px wide the field is zoomed down so both boards fit the screen width (no sideways scrolling). A "⤢ Fit" button in the toolbar turns this off and on; the choice is remembered.
- **Toolbar:** one row of icon buttons (Undo, Redo, Fit, Player options, Game options, View, Leave, Build) that stays at the top of the side panel. Labels are hidden on phones; each button keeps its tooltip.
- **Side panel:** at most 30% of the screen height and scrolls on its own; the phase banner is one line; when nothing is waiting, Resolve is one line (header, Next button, "Nothing is waiting."); the log is shorter.
- **Top tabs:** on the table screen only the selected tab shows its name; the others show their icon.
- **Hand:** one scrolling row of smaller cards; the expand button still opens the big hand.

Revise#281 — Saga 4 batch (A4-01 / A4-02).
- **"このカードが分類・Xにセットされた場合"** (0014 / 0029): the draw or the deck-top power card happens only when the character has that class.
- **First Project of the Main phase** (0079 / 0094): the cost paid from this character for your first Project card in each Main phase goes back to your hand.
- **"…キャラクター以外とのバトルによるダメージを受けない"** (0146 / 0160): no battle damage except from a character that matches (selector "notSel").
- **Turn start with power 0** (0175 / 0190): at the start of every turn, if this character has no power, the turn player discards one of their Controlled Characters.
- **Permanent 0180:** discarded when its character battles or attacks a player.
- **0380:** every player discards one of their own Controlled Characters with Mental 0.
- **0308 / 0323:** all Project cards cost X more (X = this character's power).

Revise#282 — Saga 4 batch (A4-02).
- **0242 / 0257 / 0243 / 0258:** "目標の≪ダメージ置き場（または捨て札置き場）のカード1枚≫を、そのオーナーのデッキに戻す。その後、そのデッキをシャッフルする" — that owner's deck is shuffled. "捨て札置場" is read as "捨て札置き場".
- **0243 / 0258 effect 2:** choose a card from your deck, shuffle, then put the chosen card on top.
- **0275 / 0290:** "目標の≪プレイヤー1人≫はアタック以外のダメージを受けない" — new player modifier playerNoDamage: damage from the attacking character in a battle still counts; damage entered by hand on the table is not blocked.
- **0277 / 0292:** search your deck for a card by its card title (「ハイドロプレッシャー」).
- **0315:** "ターン終了時に、目標を捨て札する" — at the end of the turn.
- **0316:** "Xコストの" is read as "コストXの".

Revise#283 — Pack bug: Permanent pictures squeezed / cut.
- Permanent cards are printed sideways (landscape), but the small pictures (Permanents on a character, the Status-table source, Structure / Power strips in the details) used a portrait box, so the picture was cut to its middle.
- Now the table learns from each loaded picture whether it is landscape (remembered in the browser): a landscape picture gets a landscape box (88:63) on the field and in the details, and any other box shows the whole picture (contain) instead of cutting it.

Revise#284 — Saga 4 batch (A4-03).
- **Permanents 0411 / 0443 / 0475 / 0507 / 0539 / 0571:** "あなたの対戦相手がXのキャラクターを3体以上支配している場合、…必要ファクターとコストを無視してセット宣言可能" — one opponent controls 3 or more of that faction. "freeIf" now also works for Permanent cards.
- **0442:** "A、またはBの場合" — either condition (cond "any"); "ダメージ置き場のカード枚数が" is read as "ダメージ置き場のカードが".
- **0410 / 0424:** "…の持つエフェクトの効果を受けない" = "…のエフェクトの効果を受けない".
- **0501 / 0516:** "分類に関らず" = "分類に関わらず"; "≪このキャラクターをブレイクしたプレイヤー≫は1ドローする".
- **Permanent 0508:** the Effect cost paid from this character goes back into its owner's deck, which is shuffled.

Revise#285 — Pack bug (iPhone): Permanent pictures still tall / cut after Revise#283.
- Pack's screenshots show the Permanent pictures are portrait, so Revise#283's landscape guess was not the cause (it stays: it only acts on a picture that really is landscape).
- Cause: the small picture boxes (Permanents on a character, the details' Status / Structure / Power pictures, power cards, cost cards) take their shape from aspect-ratio while the picture inside is sized by percentages; iPhone Safari then sizes the box from the picture (tall, narrow on the field) or draws the picture taller than the box (bottom cut in the details). The big cards never had this because their picture is laid over the box (position:absolute).
- Fix: every small box lays its picture over the box the same way, so the box keeps the card shape and the whole picture fills it.

Revise#286 — Pack: a more modern look with motion (all four areas, subtle). Released alone as v4.66 so it can be reverted to v4.65.
- **Screen changes:** switching tabs fades the old screen out (0.14 s, a little up) and the new one in (0.24 s, from a little below), using the browser's View Transitions; browsers without it switch at once.
- **Site pop-ups:** the card sheet slides in from the right, the window and toast fade / scale in, and all of them fade out when closed (CSS @starting-style and allow-discrete; older browsers simply show / hide).
- **Game table (src/table4/t4-motion.js):** the table is redrawn on every change, so motion is added around TB.render — a card that moves glides from its old place (by data-card, zoom-aware); a new card fades in (not when more than 10 appear at once, e.g. a new view); a card that leaves the field / hand fades out where it was; pop-ups and drawers fade + scale in when they open (matched by kind + title, so a pop-up that stays open is not animated again) and fade out when they close.
- **Look & feel:** buttons react to a press (shrink a little) and to hover (soft glow); cards on the field and in the hand light up on hover; table pop-ups are a frosted gradient panel.
- Everything is 0.1–0.25 s, never blocks a click, and is off when the device asks for reduced motion.

Revise#287 — Saga 4 batch (A4-03).
- **0405 / 0420:** at the start of a battle, one power card of this character's battle opponent goes back to its owner's hand (step battleOppPowerTo; asked only when there is more than one).
- **0440 / 0455:** when one of your Controlled Characters would be discarded, you may discard this character instead (modifier sacSelfKeep, offered with the other "stay on the field" choices).
- **0448:** "本来精神攻撃力を持つ" — the printed card has mental Attack (selector atMentalBase), not one that gained it.
- **0576:** "このカードの使用宣言時に、あなたは任意の分類1つを指定する" — the class is chosen when it resolves; "指定した分類を持つ" selects by it (icons "@effIcon").

Revise#288 — Saga 4 batch (A4-04).
- **0764 / 0779:** at the end of your Main phase, if this character did not declare an attack this turn, it is discarded.
- **Permanent 0706:** "≪アタック宣言しているこのキャラクター≫はイニシアチブを得る" — only while it is the attacker.
- **0672 / 0687:** "…場合、≪このカード≫の必要ファクターはN減少し、このカードがセットされた際、≪…≫…" — the factor is lower and, when it is set under that condition, its effect happens.
- **0673 / 0688:** "≪このキャラクターにセットされているパーマネントカード1枚≫を手札に戻す" (step selfPermPick; asked only when there is more than one).
- **0772:** "ターン終了時まで、≪アタック宣言またはガード宣言したネームレベルでないキャラクター≫を捨て札する" — two watchers (attack, guard) with a character selector.
- Tidy: a duplicated line in parse_body removed.

Revise#289 — Pack bug: A3-24 3541 (金のオーラ, a Permanent) did not work.
- "あなたがこのキャラクターにネームを持つ極星帝国のブレイクカードをセットした場合、≪あなた≫は、あなたの手札の…パーマネントカード1枚を、このキャラクターにセット可能" never ran: the trigger looked for the Break card that was on top before (it only fits a Break card), and a Permanent is never that card.
- Now, on a Permanent, it answers a Break card set on the character it is on (trigger brokenSelf with onChar). The same fix covers the other cards of this cycle: A3-24 3433 / 3469 / 3505.
- Its first line ("このキャラクターに極星帝国のブレイクカードをセットする場合、≪そのブレイクカードのコスト≫はオーナーの手札に戻る") was already working.

Revise#290 — Pack (phone): card details were hard to close, on the game table and in the card list.
- **Game table:** every pop-up that has a Close button (card details, piles, player info, field forms …) gets a ✕ in its title bar, which stays at the top while the pop-up scrolls; a tap outside the pop-up (on the dimmed table) closes it too.
- **Site:** the card sheet's top bar (number, ✕) stays at the top while it scrolls, with a bigger ✕; on a phone it shows a grab bar and can be pulled down to close (from the top bar, or anywhere when scrolled to the top). The window (export, templates …) keeps its title bar and ✕ at the top too.

Revise#291 — Pack: page left / right in the card details of the card list.
- The card sheet shows "‹ n / N ›" when it was opened from the Card List results (or the Deck Builder search results): ‹ › go to the previous / next card of that list; on a phone a swipe left / right does the same; on a computer the ← → keys.

Revise#292 — Saga 4 batch (A4-05).
- **0809:** "あなたが先攻でない場合、あなたはこのカードをファストカードのタイミングで使用宣言可能" (fastIfCond notFirst). **0886:** "あなたが先攻でない場合、このカードの必要ファクター（コスト）はN減少する".
- **0845:** "ターン終了時まで、目標がアタックした場合、あなたは1ドローする" (a watcher on the target).
- **0882:** "≪精神攻撃力を持たないキャラクター全て≫を捨て札する" (selector atMental false).
- **0921:** until the end of the turn, a character that declares an attack or a guard loses all its power cards.
- **Permanent 0808:** +2/+1/+1 while on an E.G.O. name-level character. **Permanent 0952:** when it is set, its character may attack an opponent without paying the cost this turn.

Revise#293 — Saga 4 batch (A4-EP).
- **EP501 / EP513:** "≪…全て≫はアタックコスト・ガードコストを支払うことができない" (noPay kinds attack / guard).
- **EP446:** until the end of the turn, an opponent's Controlled Character that declares an attack or a guard takes 3 damage.
- **EP556:** "≪あなたの任意のあなたのダメージ置き場の…シリーズのカード2枚≫を手札に戻す" (the wording "あなたの任意のあなたの…置き場" is read as "あなたの…置き場").
- **EP605:** "≪あなた≫のダメージ置き場の枚数による敗北条件に+1する" with "このカードは、フェイズ・ターンが終了しても効果を発揮し続ける".

Revise#294 — Saga 4 batch (A4-EX02).
- **EX791:** "≪このキャラクターから支払われた武蔵とネームを持つブレイクカードのコスト≫は手札に戻る".
- **EX820:** "≪このキャラクターを、英国とネームを持つカードでブレイクしたプレイヤー≫は1ドローする" (brokenSelf with a tag + name check on the new card).
- **EX822:** "≪あなた≫は、このキャラクターに、ファストカードのタイミングで英国を持つブレイクカードをセット宣言可能" (breakFast with a tag).
- **EX868:** "≪あなたの任意のエリア1つのキャラクター全て≫に、(1)ダメージを与える" (the comma before the damage is read as without it).
- **EX870:** "ターン終了時まで、目標の≪プレイヤー1人≫に与えられるダメージの数値に-1する".
- **EX909:** "≪あなた≫は、あなたの支配エリアのパワーカードの内容を全て確認し、その中の1枚を手札に戻す" (step ownPowerPick).

Revise#295 — Pack: "Report" on card details.
- A red **⚑ Report** button at the bottom right of card details — in the card list (and Deck Builder) and on the game table. It opens a box for the problem in the player's words: up to 250 characters, counted as characters (Thai, English, Japanese and their input methods work).
- **Sent** to the Firebase Realtime Database of Play Online, at reports/<id>: {v, at, ver (site version), page ("cards" / "table"), card {key, jp, en, type, status}, text, lang, device, game?}. On the game table, game = {mode, turn, phase, viewer, place of the card, its character's stats}.
- When it cannot be sent (no Firebase, offline, rules), the report is shown as text with **Copy report**.
- **Reading them:** Changelog page → **⚑ Card reports**: newest first; **Copy all** gives one plain-text block (header + one block per report: "#n date · vX · screen / card: code · names · type · rules status / problem: … / game: … / from: …") made to paste to Claude; **Download JSON** keeps them all.
- **Firebase rules** needed (Realtime Database → Rules), next to "rooms":
  "reports": { ".read": true, ".indexOn": ["at"], "$id": { ".write": "!data.exists()", ".validate": "newData.hasChildren(['card', 'text', 'at']) && newData.child('text').isString() && newData.child('text').val().length <= 600" } }
  (anyone can add a report but not change or delete one; 600 UTF-16 units leaves room for 250 Thai / Japanese characters).

Revise#296 — Pack report (first one from the Report button): A3-24 3471.
- "ターン終了時まで、≪あなたのテリトリーのキャラクター全て≫の攻撃力に+(1)する" gave +1 normal Attack. The "+(N) = mental Attack" pass (Revise#191) skipped the whole card because its other line mentions 精神攻撃力; now only a change written as "精神攻撃力に±…" / "通常攻撃力に±…" stops it.
- "≪精神攻撃力のみを持つキャラクター全て≫は、通常攻撃力のみを持つキャラクターとのバトルによるダメージを受けない" looked at the printed kind of Attack. Now "…攻撃力のみを持つ" looks at the character's Attack now (selector atOnly: only mental / only normal), so a character that gained +(1) still counts as mental-only, and an attacker that gained mental Attack no longer counts as normal-only.
- Other cards whose text also mentions 精神攻撃力 on another line get their "+(N)" as mental Attack too (see the change list of this release).

Revise#297 — Pack report: A3-24 3465 (ディーナ・ウィザースプーン).
- "1：ターン終了時まで、目標の≪キャラクター1人≫の攻撃力に-X・ー(X)する" lowered only normal Attack, and X was 0: the card's last line "Xは…" was attached to the last effect only.
- "攻撃力に-X・ー(X)" (and "ー(X)・-X") now lowers normal Attack by X and mental Attack by X (each stays ≥ 0) — a character with only one kind loses it from that kind, as before (Revise#111); one with both loses both. Every card with this wording follows.
- One "Xは…" line under several effects now defines X for each effect that uses X (not one whose cost is X).

Revise#298 — Pack: an easier way to see, copy and clear reports.
- Changelog → ⚑ Card reports is now a manager: each report has a tick box; Tick all / Copy (ticked or all, as the text block for Claude) / Download JSON (ticked or all).
- **Owner sign-in (to delete)** with Google: when signed in as the owner, Delete ticked / Delete all appear (with a "Yes, delete N" step).
- Firebase set-up: Authentication → Sign-in method → Google on; Authentication → Settings → Authorized domains: add the site's domain (aquarian-age-fs.netlify.app). Rules for reports/$id: ".write": "!data.exists() || (auth != null && auth.token.email === '<owner e-mail>' && auth.token.email_verified === true && !newData.exists())" — anyone adds, only the owner deletes, nobody edits.

Revise#299 — Pack (phone): characters on the table were hard to read.
- On screens up to 600px wide the skill line beside a character (Draw 1 · Aggressive …) is not shown (it stays in the card details).
- Its status sits on the card: Mental / Attack / Defense on the top-left corner of the top card, the power count (P n / mental) on its bottom-left corner. Power cards and Permanents stay beside the card.

Revise#300 — Pack (phone): card details on the game table could not be swiped closed; Resolve and Field effects on one row.
- A game-table pop-up that has a Close (card details, piles, player info …) can be pulled down to close — from its title bar (it shows a grab bar), or anywhere while it is scrolled to the top; the By hand menu and form fields don't start a pull.
- In the side panel, Resolve and the folded Field effects share one row; opened, Field effects takes the full width.

Revise#301 — Pack: clear old online rooms (they are never cleared by themselves; the free Firebase plan holds 1 GB).
- Changelog → 🗄 Online rooms (owner sign-in, the same Google sign-in as the report manager): every room with its moves, when it started and when it was last used (from the log's push keys, which hold their time), and the total size (about 0.2 KB a move).
- "Idle for N days or more → Tick them" (30 by default), tick by hand too; "Delete N ticked" with a "Yes, delete" step. Rooms in use stay unless ticked.
- It lists through the REST API with shallow=true (keys only), so it does not download the logs.

Revise#302 — Pack: the owner's tools on their own page, reached only by the link.
- ⚑ Card reports and 🗄 Online rooms moved from the Changelog page to an Admin page at index.html#addoge. No tab or button leads to it; it is not in the tab bar. Deleting still needs the owner's Google sign-in and the Firebase rules (the link alone only lets someone read the reports, as the rules already allow).

Revise#303 — Pack: Online rooms — "Tick all" / "Untick all" beside "Tick them".

Revise#304 — Pack: three small changes.
- Game Table card size: the default is Lv4 (a size already chosen in this browser stays).
- Phone: the card sheet's top bar (number, ‹ › and ✕) was half hidden under the top of the screen — it now sticks at the very top of the sheet, and the sheet's height uses the visible screen (dvh).
- Auto Re-shuffle always re-shuffles at least once, even when the hand already matches; then up to 10 times as before.

Revise#305 — Pack: A3-25 3627 (花使い“日向 葵”) / 3614.
- "このカードがセットされた場合、≪このカードのコストとして支払ったカード≫を、…0/0/1のあなたの支配キャラクター、ヒマワリとしてセットする": each paid card becomes its own ヒマワリ (Pack: "Each card = 1 Sunflower"; the English text says "characters"). Before, the first card became one ヒマワリ with the others as its power cards.
- Checked and unchanged: "≪あなたの支配キャラクター≫が捨て札される場合、あなたの支配エリアのヒマワリ1人を捨て札することで…場に残す" (offered with the other stay-on-the-field choices, never the character itself); "2：≪あなたのデッキの一番上のカード1枚≫を…ヒマワリとしてセットする。≪このエフェクトのコスト≫を手札に戻す".

Revise#306 — Pack: the factors a player controls, shown in the hand bar.
- After Power, one small faction icon per faction with its number (Controlled Characters of that faction, factor bonuses, and "全ての勢力のファクターをX得る"); "no factor" when there is none. The tooltip lists all six. The engine helper AA4.factorsHave is the same count factorOk uses.

Revise#307 — Pack: richer graphics (all four areas). Released alone as v4.76 so it can be reverted to v4.75.
- **Game table field:** each board is a night-sky play mat — star dust and a soft nebula in the player's colour, deeper frame shadow, a glow round the board whose turn it is; zone rows are glass panels with a top highlight; each Active Area slot shows its faction emblem faintly; cards have deeper shadows and a foil sheen when the pointer is over them.
- **Battles & effects:** while a battle is on, a glowing dashed arrow runs from the attacker to its target (red), or to the guard (blue); damage to a player pops "+N" in red over their Damage Pile with a red pulse; a Break card set on a character makes a gold burst on it.
- **Site pages:** a soft glow round the header art, a faint nebula behind each page, a foil sheen on card tiles when the pointer is over them, a deeper card sheet with a glowing card frame.
- **Pop-ups & buttons:** pop-ups have a gold-to-sky gradient frame (Decision pop-ups gold-to-amber); buttons have a light top sheen; the main buttons glow.
- All of it is CSS and small decorations; reduced-motion turns off the moving parts.

Revise#308 — Pack: a bot that learns ("bot first, remaining cards later"; "make sure bot learns from the winner"; "can I create decks for bots to learn from each other?").
- **Playing:** Game Table lobby → Solo → **🤖 vs Bot (the bot plays Deck 2)**. You play Deck 1; the computer plays Deck 2 (seat 2 is not yours: the View follows your seat). It moves after a short pause so you can follow it; "Continue the last solo game" keeps the bot.
- **How it plays (src/engine/20-bot.js):** it only plays legal moves — AA4.candidates lists them, each is tried on a copy of the game (AA4.step), and the move with the best score wins. Score = Σ weight × feature: the change in damage piles, characters, their stats, broken characters, power cards, hands, a low deck; plus move hints (attack: its Attack, safe or not, a kill; guard: survives / kills / dies; no guard: how much it hurts; set / effect / charge / next / pass). It never reads cards in another player's hand or deck.
- **Learning from each other (tools/bot_train.js):** bot vs bot with the training decks (Pack's decks, tests/engine/fixtures/pack_decks.json, plus any decks Pack adds); the champion's weights play varied copies; a copy that wins ≥ 60% becomes the champion — the winner's weights survive. Written to src/engine/21-bot-weights.js.
- **Learning from real games — winners only (tools/bot_learn.js):** Admin (#addoge) → Online rooms → **Download rooms (for the bot)**; Claude replays every room that finished with one winner; at each move the WINNER made, the weights move toward the winner's move whenever the bot would have chosen something else (losers' moves are not used). Written to the same weights file, shipped with the next release.
- Firebase rules: "rooms": { ".read": "auth != null && auth.token.email === '<owner>' && auth.token.email_verified === true", "$room": { ".write": "auth != null && auth.token.email === '<owner>' && auth.token.email_verified === true && !newData.exists()", … the room's rules as before … } }.

Revise#309 — Pack: "Can you keep auto-keep Solo Play's to log?"
- A Solo game (two decks, or vs Bot) that ends is copied once, automatically, to the online database: rooms/SOLO-xxxx (two decks) or rooms/SOLOBOT-xxxx (vs Bot; seat 2 = the bot). A toast says "This Solo game was saved to the game log". Unfinished games and games under 10 moves are not sent; each game is sent once (aa4-solo-sent, the last 50 codes); a failed send is tried again at the next end-of-game drawing.
- The entries get Firebase push keys in their order (so the Online rooms list shows their times); undo / redo links (ofId) are moved to the new keys.
- They appear in Admin → Online rooms like any room, and "Download rooms (for the bot)" includes them. tools/bot_learn.js learns from their winners too, except a vs Bot game the bot won (nothing new to learn from its own moves).
- Needs the Firebase settings (assets/firebase-config.js) and the usual rooms rules (anyone may write a room's log).

Revise#310 — Cards, batch (Pack: "continue card implement"). 67 cards gain automation (61 become fully automatic):
- The card compiler is ~40× faster (Python's regex cache was too small for its thousands of patterns: every card recompiled them); a full build takes ~15 s instead of minutes.
- Deck search: "…1枚を選び、あなたの手札に加える" with "プロジェクトカードまたはファストカード", 「card name」, "カードテキストに「…」を含む…", "“X”1枚", "E.G.O.のカードを1枚選び", "≪あなたのデッキ≫の中の任意のカード1枚"; a bare "デッキをシャッフルする".
- "このカードがセットされた場合、またはこのキャラクターが対戦相手にアタック宣言した場合、…" → two triggers with one body (A4-03 0471 / 0486); "このカードをセットした場合" is the set trigger too (PP210).
- At the declaration: "このエフェクトの使用宣言時にあなたのデッキの上からカード3枚を捨て札する" / "このカードの使用宣言時に、あなたのデッキを5枚捨て札する" (declMill), "このカードの使用宣言時に、あなたの手札を1枚捨て札する"; "このカードの使用宣言時に、≪このカードのコスト≫を手札に戻す".
- Reveal the top 5, take one Project / Fast card, the rest back (lookTake with a filter, A4-03 0470 / 0485); show a hand card and take the same-named cards among the top 10 (A4-04 0767 / 0782); each player puts a card of their own deck into the Damage Pile and shuffles (A4-03 0506). The log shows revealed cards.
- 冥 (Nether, A4-03): characters with the 冥 mark give a 冥 factor; "≪あなた≫は冥を1つ得る"; "あなたが冥冥冥を満たしている場合" conditions. Player-level factor gains ("≪あなた≫はE.G.O.のファクターを1つ得る") are now counted for factors (they were ignored before).
- "≪このキャラクター≫はバインド0を得、≪あなた≫の…敗北条件に+20枚する" (two clauses under one condition).
- "Xが4以上の場合、さらに、…" (ifXGe); "目標がアーチャー系を持つキャラクターの場合、さらに、目標はイニシアチブを得る" (Ragnarok classes are tags; "必要ファクター5以上の" too); "あなたのターン中の場合、効果発揮時に…".
- Granted effect lines inside an effect: "目標の≪キャラクター1人≫はチャージ1と、「1：…」を得る" (A4-04 0644).
- X: "捨て札したキャラクターの攻撃力" (the discarded target), "あなたの支配エリアの“X”の攻撃力 / パワー", "このキャラクターを構成するドラグーンのブレイクカード", "…キャパシティ+Xを持つカード", "WIZ-DOMの分類・イレイザーのネームレベルキャラクターの数".
- Smaller forms: "あなた以外のプレイヤー1人", "“X”以外のキャラクター全て", "≪キャラクターにセットされているカード全て≫を手札に戻す", "パワーカード2枚を、オーナーの手札に戻す", "≪プレイヤー全て≫はカードの必要ファクターを無視して使用宣言可能", "…のスキルを無効化する", "≪プレイヤー全て≫はデッキの上からカードをX枚を捨て札する", "≪プレイヤー全て≫は、ダメージ置き場のカード全てを捨て札する", "あなたの手札(のカード)N枚を捨て札する", hand card as a power card, "あなたに(1)ダメージを与える".
- Fix: "このカードがセットされた場合、≪このカードのコスト≫はオーナーの手札に戻る" on A3-08 1242 / 1245, A3-09 1379 / 1391, A3-21 2971 / 2987, A3-PR PR113 was compiled as an empty trigger (shown automatic, nothing happened): the cost now comes back (costBack).
- Also: "このカードのコストが“X”からのみ支払われている場合、さらに、目標の耐久力に+Xする" / "…、その後、このカードを手札に戻す" (EX0741 / EX896); turn-long watchers "≪アタック宣言またはガード宣言したネームレベルキャラクターのオーナー≫は1ドローする" (EXPR013), "キャラクターが(バトルによって)捨て札された場合、≪捨て札されたキャラクターのオーナー≫は1ダメージを受ける" (0247 / EX0734); "≪ブレイクしていないキャラクター≫はアタック宣言・ガード宣言・アタック・ガードできない" (PP025); "あなたのデッキの上からカード5枚を、≪あなたの任意のあなたのテリトリーのキャラクター≫にパワーカードとしてセットする" — one by one (0021 / PV011).

Revise#311 — Pack: "make bots play each other" (both: more self-play training, and a Bot vs Bot table) and "the bot who can deal 10 damages to the opponent is better. At the beginning, people build: add Controlled Characters and Break cards to build firepower as fast as possible; the conflict when ready".
- The bot's plan (src/engine/20-bot.js): AA4.botReady(S, db, seat) = the attack of its Controlled Characters ÷ the damage still needed to win (at least 4), 0 … 1. While not ready, setting Break cards, charging, gaining Controlled Characters, power and stats weigh more (setEarly, chargeEarly, charsEarly, powerEarly, statsEarly) and attacking weighs less (attackEarly); when ready, attacking and attacking a player weigh more (attackReady, attackPlayerReady), and a hit whose attack reaches the damage still needed is "lethal". Against the same weights without the plan it won 17 of 24 bot-vs-bot games.
- Training (tools/bot_train.js): a game that reaches the step limit counts for the side that dealt more damage (dealing the 10 damage is the goal). 60 rounds × 4 challengers × 8 games with Pack's decks (36 min): 47 new champions; the result beat the hand-made defaults 7 of 8 and the v4.79 bot 36 of 40 games.
- Bot vs Bot: Game Table lobby → Solo → "🤖 vs 🤖 Watch two bots" (Deck 1 and Deck 2). You only watch (spectator view). A bar at the bottom: ⏸ Pause / ▶ Play, speed 1× / 2× / 4×, and each bot's plan (build N% / attack). The finished game is saved to the game log as rooms/SOLOBVB-xxxx (like Solo games, Revise#309); tools/bot_learn.js learns from its winner too.
- Cards in the same release (15 more, 13 fully automatic): "このカードのセット宣言時に、(▼を持つ)キャラクター1人を指定する。このカードがセットされた場合、≪指定したキャラクター1人≫に2 / このキャラクターの攻撃力に等しいダメージを与える" (A4-02 0374 / 0388, A4-01 0145, PP138 / PP146, PR022, PV064: chosen when the ability runs); "≪あなたの支配エリアの“A”と“B”≫" (EX0753, EP529); "…ネームレベルキャラクター以外からダメージを受けない" (EP451: noDamage onlyFromSel, any damage); "≪あなたの任意のあなたの支配キャラクター1人と、そのキャラクターにセットされているカード全て≫をデッキに戻し…" (EP496: toDeck allTo); "≪あなたの任意のキャラクター1人と、そのキャラクターにセットされているカード全て≫は、プロジェクトカードの効果を受けない" (0219); "カード名称またはカードテキストに“X”を含むカード1枚を手札に戻す" (EX908); "ターン終了時まで、目標が…アタック宣言またはガード宣言した場合、目標にセットされているパワーカード全てを捨て札する" (PR131).
- Fix (bot driver, src/table4/t5-bot.js): in a response window both seats can be "due"; the bot now moves for the seat the game waits for (AA4.actingSeat), tries the other seat after two refused moves, and tries again after a refused move (before, a refused move drew nothing, so the bot stopped without a word).

Revise#312 — Pack: "Replay control screen covers the screen, can't see" (phone screenshot) · "send me the best log to replay" · "train about 2 hours".
- Replay controls on phones (≤ 700 px): a slim bar at the bottom (title, ▾, ⋯, ⏮ ◀ Play ▶| ⏭, the slider, the step). ⋯ shows Speed / View / Replay log / Close replay; ▾ folds the bar to a small ▶ / ⏸ button with the step (▴ opens it again). Wide screens keep the bar at the top as before.
- A replay file of a close bot-vs-bot game (v4.80 bot, Pack's decks: Mayumi beats Dina 10–7 in 14 turns) was sent to Pack — Game Table lobby → Open a replay file (.json).
- tools/bot_train.js: BOT_OUT (write the weights elsewhere), BOT_FROM (go on from another run's weights or a checkpoint), a checkpoint every 10 rounds (OUT.partial.json).
- Cards: split damage "≪あなたの任意のキャラクター≫に、(X)ダメージを割り振って与える" (splitDamage: one point at a time, then all at once — A4-05 0877 / 0895 / 1006 / 1012, with "その後、≪あなたの捨て札置き場のプロジェクトカード1枚≫を手札に戻すことが可能"); "あなたは、目標の≪デッキ≫の一番上のカードを見る。その後、そのカードをデッキの一番下に置くことが可能" (0804 / 0822); power cards revealed and ▼ / 悪魔 ones to the Damage Pile (0344); "このキャラクターがプレイヤーにアタックした場合、通常のダメージ判定の後、≪アタックを受けたプレイヤー≫は、デッキの上からカードを3枚捨て札する" (0273 / 0288); "…はシールドを得、あなたの対戦相手が使用したプロジェクトカード・ファストカード・エフェクトの効果を受けない" (EP606).

Revise#313 — Pack: "Current bot is not good. They should prioritize pulling characters from the Active Area to the Control Area. They should not just play any card from hand but consider how to use cards from hand as power cards so that they can put characters into the Control Area. They should know which cards in hand are important, to keep them for later."
- Found in a traced game: the v4.80 bot never put Character cards into the Active Area (a character there was worth nothing to it until dominated), so it had little to dominate.
- New features (src/engine/20-bot.js): actives (+ activesEarly) — its Active Characters, something to dominate; domProg — for each Active Character, how close its power is to its Mental (closer counts more, so it finishes one before spreading power thin); domReady — Active Characters whose power already reaches their Mental (dominated at the end of the Charge Phase; worth a little less than a Controlled Character, so ending the phase is a gain); oppDomReady; handValue — what its own hand is worth: Break cards it can use (factor met) most, then Project / Fast, Permanents, Character cards least, a second copy of a name less — so it charges with the least useful cards and keeps the key ones. unCharge (taking a pending power card back) is no longer a bot move.
- Result: Controlled Characters per player by turn 4 / 6 / 8: 2.1 / 3.4 / 3.9 (was 1.6 / 2.3 / 2.8); 18 of 24 games won against the v4.80 bot before training. Then trained ~2 hours (tools/bot_train.js, BOT_MINUTES time limit).

Revise#314 — Pack: "keep decks online with an ID / password login" — an Account page inside the Deck Builder (src/js/08-account.js; tests/account_ui.js with a stand-in Firebase).
- Pack chose: forgot password / change email by an emailed link from Firebase (no server, the zip deploy stays); login by ID (ids/<id> can be read one exact ID at a time, never listed).
- Accounts are made by the admin only: Admin (#addoge) → 👥 Users (owner's Google sign-in) → ID (3–20: a–z 0–9 _ -) and an optional email → the first password, 8 easy random characters (A–Z a–z 0–9 without 0 O o 1 l I), shown once with Copy. A second Firebase app makes the account, so the owner stays signed in. Per user: "Send reset link" (has an email) or "New password" (no email: a new login address with a new password; the decks move with it), and Delete (its data and ID; the login itself stays in Firebase Authentication without data).
- Login email: the user's real email, or <id>@users.example.com (a reserved domain: no mail goes there) for users without one.
- Not logged in: only the login form (ID, password) and "Forgot password?": with an email, Firebase sends a link to set a new password (the email is shown masked); without one: "please contact the admin".
- Logged in, Save / Load decks: a One deck / All decks switch (kept in the account). One deck: Save → account / Load ← account at the top; left "Current · Deck Builder" (10 slots), right "Saved data · Account" (10 slots); tap one slot on each side (tap again to un-pick); an empty source is refused; a full target asks "Overwrite [name (Current / Saved Data)] to [name (Saved Data / Current)] — Please confirm" OK / Cancel. All decks: Save or Load all 10 slots after a confirmation listing the decks. Export under each side (the Deck Builder's Export: this deck = the picked slot, or all decks of that side). A warning: an overwritten deck cannot be brought back.
- Profile: player image (the 6 Game Table pictures or an own picture, 128 px, also used at the Game Table on this device), email (add / change: Firebase sends a confirmation link to the new address; the next login by ID uses the new address), password (current + new twice). Log out.
- Firebase set-up (Pack, once): Authentication → Sign-in method → Email/Password: Enable. Realtime Database rules — add next to "rooms" / "reports" (owner = the same email as in the rooms rule):
  "ids": { "$id": { ".read": true, ".write": "auth != null && ((auth.token.email === '<owner>' && auth.token.email_verified === true) || data.child('uid').val() === auth.uid)", ".validate": "!newData.exists() || newData.child('uid').val() === data.child('uid').val() || (auth.token.email === '<owner>' && auth.token.email_verified === true)" } },
  "users": { ".read": "auth != null && auth.token.email === '<owner>' && auth.token.email_verified === true", "$uid": { ".read": "auth != null && auth.uid === $uid", ".write": "auth != null && ((auth.token.email === '<owner>' && auth.token.email_verified === true) || (auth.uid === $uid && data.exists() && newData.exists()))" } }
  (a user can only change the record the admin made, never make one, so a self-made Firebase login gets no decks.)
- Export (04-export.js) takes a source {list, cur, label}, so both sides of the Account page export like the Deck Builder.

Revise#315 — Pack: "a card without enough Factor can be declared. If a condition is not met — Factor, Cost and others as written in the text — it should not be declarable for set, unless a special text allows it (e.g. an effect like “The World”)."
- Before: Break cards were checked at the declaration; Project / Fast / Permanent cards only when they resolved (then discarded, the cost not refunded).
- Now (src/engine/12-declare.js, planDeclaration): Project / Fast / Permanent cards are refused at the declaration when the required Factor is not met ("Factor: N X needed, M controlled"), like Break cards. Not refused: Dual; "…必要ファクターを無視して…" (factorIgnore mods, “The World”-like effects, declared by an effect with ignoreFactor, freeIf, noFactorIf, factorFreeIf); the factor reductions of the card itself (not going first, a name on the field, a discount by discarding at the declaration — counted at its most). The check at resolution stays (a factor lost in between → discarded).
- Fix: AA4.factorOk counted factors on its own and missed a player's own factor gains ("≪あなた≫はE.G.O.のファクターを1つ得る") and 冥; it now uses AA4.factorsHave (one count everywhere).
- The cost was already checked at the declaration ("not enough power cards"); the bot only ever plays moves the engine allows, so it follows the same rule.

Revise#316 — Pack's replay (vs Bot, v4.82) · "A3-13 1896 works incorrectly" · "an attacking / guarding / effect-using character moved to the Active Area before the fight: the declaration is cancelled; break / fast / effect / permanent declarations: recheck the condition (factor or condition); A3-13 1896 pulling a character from the Control Area to the Active Area is a Factor Cut: the declaring player has less factor than at the declaration, and the card set resolves in failure."
- What happened in the replay: A3-13 1896's effect (2: make a power-0 character Active) may be paid by discarding Controlled Characters (1 cost each). With Auto-pay on and exactly 2 power cards on it, the table paid with them at once and never offered the discard; the next tap (on “Vampire Servant”) became the effect's target, so Pack's own character was made Active.
- Fix: Auto-pay waits when another way to pay exists (AA4.payExtras: Controlled Characters to discard, hand cards).
- Already so (Revise#089): an attacker that left the Control Area before the battle → the attack ends, no damage; a guard that left it → the guard is cancelled and the attack goes to its own target; an effect whose character left the Control Area → cancelled. Kept.
- When it resolves, again: set cards (Break / Project / Fast / Permanent) — the required factor with the card's own reductions (as at the declaration; AA4.cardSelfLess); not met → the card fails ("… — the factor dropped after it was declared (Factor Cut)"), the cost is not refunded. Effects — negated, "can't use effects", "…場合にのみ使用宣言可能" no longer met → cancelled.
- The replay also showed the v4.82 bot declaring three “Kamaitachi” and a “Flutter of Fresh Green” without their Darklore factor (they failed when resolving): v4.83 refuses those at the declaration, so the bot can't any more. A replay saved before v4.83 with such moves does not replay the same in v4.83+ (the declaration is now refused).
- Bot training (Pack: "train about 2 hours"): the 110-minute run (374 rounds) drifted — a challenger only had to win 5 of 8 against the last champion, so luck kept promoting worse weights; the result won 1 of 8 against its start. It was not released. tools/bot_train.js now also needs a new champion to win ≥ 55% against the weights the run started from (BOT_ANCHOR, on by default), with 12 games per match.

Revise#317 — Pack: "let the bot use my play style · the first turn should follow Auto Re-shuffle".
- Opening hand (src/engine/20-bot.js): the bot uses Auto Re-shuffle (autoMulligan — it always re-shuffles at least once, Revise#304) and keeps the hand when it matches; when it doesn't, it runs Auto Re-shuffle again, up to 3 runs, then keeps.
- Pack's style: tools/bot_learn.js reads a replay file too, and BOT_SEAT=<seat> learns from that seat's moves (winner or not, finished or not); undo / redo entries are mapped by id (as the table does); BOT_OUT writes elsewhere. On Pack's game (vs the v4.82 bot, he won): 36 of his moves were real choices; the bot agreed with 16, after learning with 19. Fully learned from one game the bot copies too much and weakens (14 of 40 against the bot before); the half-way mix (the weights between both) plays about even (19 of 40) and is the one used. Main shifts: fewer early attacks (attack / attackAt lower), setting cards higher.
- More of Pack's games (Solo vs Bot games are saved to the game log by themselves, Revise#309) → Admin → Online rooms → Download rooms → BOT_SEAT=0 learning gives a better picture of his style.

Revise#318 — Pack: "train about 2 hours and release a new bot version" (with "let the bot use my play style").
- tools/bot_train.js ran 100 minutes (84 rounds) with the anchor (a new champion must also win ≥55% against the starting weights, so it can't drift). Result: 12/12 against the defaults.
- Pack's style (Revise#317) kept: the new weights = trained + (v4.85 weights − the weights before Revise#317).
- Against the v4.85 bot (Pack's 4 decks, both seats, noise 0.15): trained alone 69/90, trained + Pack's style 67/90 (the same within chance) — the second is used. Damage dealt per game 5.8 against 4.0; 86% of games end by a win, not the step limit.

Revise#319 — Pack: "continue card implementation" (batch).
- Selectors: "英国を持たない" (notTag), "あなたの支配キャラクター以外の" (notYourCtl: not your Controlled Characters), "イレイザー以外の分類を持つ" (iconOther), "あなたを目標にアタック宣言した", "ガード宣言した" as a word, "Aキャラクター1人またはBキャラクター1人" (anyOf), 「name」 in a pile, "このキャラクターのアタック宣言に対してガード宣言しているキャラクター" (= the battle opponent).
- Abilities: a guard / attack trigger may take only some characters (when.chSel — PP170 / PP178 discard an unbroken ▼ guard); no battle damage while it joined by Synchro (noDamage whenSynchro, the battle remembers Synchro joins — 0538); "≪あなたを目標にアタック宣言したキャラクター≫に1ダメージ" (attack when atMe — EX836); "あなたがEEEEを満たした状態でこのカードをセットした場合" (PP208); "このカードがE.G.O.のキャラクターにセットされた場合" (PP328); "このカードがセットされたターンの終了時まで、≪あなた≫はブレイクカードをセット宣言できない" (a set ban — PP214 / PP222); "≪あなた≫は、パワーカードフェイズ終了時に1ドローする" (PR142); "≪…全て≫は分類・タレントを得る" (0018 / 0032); "≪ガード宣言しているこのキャラクター≫はイニシアチブを得る" (EX797); "≪このカードのコスト≫は手札に戻る" on a Permanent (3799); wording variants (0980 / 0998, PP215, "デッキの上からカードN枚をパワーカードとして" PP214).
- Effects: "…場合、このカード / このエフェクトは効果を発揮しない" (EX881, EX873); "…場合、あなたはこのカードのコストを無視して使用宣言可能" (EX0743); "その後、目標にセットされているパワーカードN枚を捨て札する" (EX797); "目標は分類・タレント、チャージ1を得る".
- X: "目標 / このキャラクターを構成するネームを持つカードの枚数", "目標の通常攻撃力", "あなたの支配エリアの悪魔・悪魔♂の数".

Revise#320 — Pack: "At the login page, make “Request for Registration” — the same way as the Admin's screen, but keep the information somewhere else, store only Username and Email. Make an “Approve Registration” admin screen. Until then, leave the registration pending."
- Login page → "Request an account": ID (3–20: a–z 0–9 _ -), an optional email and a password the requester chooses (twice, 8+; Pack, Revise#321: "can the registerer log in after approval even with no email?" — yes, with that password). A taken ID is refused; an ID already requested is refused (the rules allow a request to be made once). The password makes a Firebase login at once (in a second app, so this page stays signed out); Firebase keeps only a scrambled form of it. Saved to requests/<id> = {id, uid, email} or {id, uid, login: <id>.r…@users.example.com} — apart from the accounts. Until approved that login has no ids / users record, so it can't log in to the Account page or keep decks.
- Pending: logging in with that ID says "The request for “id” is waiting for the admin's approval" (only requests/<id>/id can be read by anyone; the email stays private).
- Admin → "✅ Approve registrations" (or the top of 👥 Users): the waiting requests with Approve / Reject. Approve = users/<uid> and ids/<id> are made for the requester's own login and the request is removed: "They can log in now with their ID and the password they chose" (nothing to hand over). Firebase can only send its fixed emails (password reset, email change) — a custom "your ID / password" email would need a mail service, and with a chosen password none is needed. Reject removes the request.
- Firebase rule to add (next to ids / users; OWNER = the owner's email, kept inside the single quotes):
  "requests": { ".read": "auth != null && auth.token.email === 'OWNER' && auth.token.email_verified === true", "$id": { ".write": "(!data.exists() && newData.exists() && auth != null && newData.child('uid').val() === auth.uid && !root.child('ids/' + $id).exists()) || (auth != null && auth.token.email === 'OWNER' && auth.token.email_verified === true)", ".validate": "newData.child('id').val() === $id && $id.matches(/^[a-z0-9_-]{3,20}$/)", "id": { ".read": true }, "uid": { ".validate": "newData.isString()" }, "email": { ".validate": "newData.isString() && newData.val().length < 100" }, "login": { ".validate": "newData.isString() && newData.val().endsWith('@users.example.com')" }, "$other": { ".validate": false } } }

Revise#322 — Pack: "add a Player Name for each account, used on the Game Table as default (they may change it as needed)" · "make Account the right of the header tabs, right of Changelog, with the small Player Image and Name — the same way as Gmail".
- users/<uid>.playerName (the admin's Make / Approve sets it to the ID). Profile → "Player name" (24 characters) → Save. A fresh login (and a save) writes it to the Game Table's name (aa-pname) and the account's picture to the Player image; the table can still change them for a game.
- Header: #hdrAcct at the end of the tabs (margin-left: auto): the small round picture + the player name, or a person icon + "Log in". Click → a menu card under it (like Gmail's account menu): the big picture with ✎ (→ Profile), the name, ID, email; "Manage your account" (→ Profile), "Save / Load decks", "Log out". Logged out: "Log in", "Request an account". It opens the Account page in the Deck Builder tab. A remembered login (aa-acct: id, name, picture) shows at once and is checked quietly (Firebase loads only then).

Revise#323 — Pack: "When Size = 4 (default) the hand hides the Control Area (Back). Make it possible to keep the hand at the very bottom and still see the Control Area (Back) fully."
- TB.handRoom (t2-render.js): when the hand sits at the bottom of the screen (not dragged up), the table's bottom padding = the height of the screen part it covers + 12 px (was a fixed 190 px), kept up to date with a ResizeObserver (expand / fold / Size / window). So the last row scrolls up above the hand at any size.

Revise#324 — Pack: "the bot uses the effect “cost return to hand” right after the turn passes. It should use it only when it wants a card to play — usually a Fast card when threatened by the opponent, or a Break / Project card."
- 20-bot.js: an effect whose only text is "≪このエフェクトのコスト≫をオーナーの手札に戻す" is a bot move only when a power card on that character is wanted: a Fast card whose Factor it meets and can pay for, while the opponent threatens (an opponent's declaration waiting, or an attack on the bot / its character); or on its own Main Phase (nothing waiting) a Break / Project card it meets the Factor of and can pay for after. Then it pays with that card.

Revise#325 — Pack card reports (aa-card-reports-2026-11-10-16-15.json, v4.78):
- A3-20 2673 "ブースト2 → only Boost 1": the legal-move list (18-legal.js) offered an attack with boost 1 only, so the table menu never showed Boost 2. Now every value 1 … N (N = the Boost skill, else the character's power) for each player target; the engine still checks the cost.
- A3-EP EP245 "the Break's cost doesn't come back": "≪ブレイクカードのコスト≫は、そのオーナーの手札に戻る" was only an ability of the character it makes, which starts after the card is on the field, when its own cost is already in the Discard Pile. A Break card with that line also gets costBack {to: hand} (its own cost).
- A3-07 1167 "+X does nothing": the Permanent's printed +X/+X/+X was known, but its "Xは全てのプレイヤーのダメージ置き場にある、このキャラクターと同じネームを持つカードの枚数の合計に等しい" sits on the line of the keep ability, so X was never defined (0). compile_card now finds a Permanent's X sentence anywhere in the text; new X dmgSameName (all / you): the cards in the Damage Piles with the Name of the character it is on.
- A3-07 1173 "can't be used as a Fast card from the Damage Pile": compiled and allowed by the engine (with 極極極), but the table had no way to declare from a pile — the pile window only opened the card details. The Damage / Discard Pile window marks a card you can declare now with "⚡ Use"; clicking it opens the same menu as a hand card.

Revise#326 — Pack: "I changed the URL from aquarian-age-fs.netlify.app to sm-aqa.netlify.app, so the players' decks were lost. Can they recover by themselves?"
- The Deck Builder slots live in the browser per web address (localStorage), so they are still in each player's browser under the old address — reachable only while the old address serves the site.
- src/js/00-move.js (runs first): on aquarian-age-fs.netlify.app a yellow bar "This site has moved… Move my decks to the new address": it opens https://sm-aqa.netlify.app/#move=<the decks, name and picture, base64 in the link> (no server). The new address reads it before the app changes the hash, asks before replacing decks already there, saves them and reloads.
- Pack: keep (or re-create) a Netlify site at the old name with this same build, so the old address works for the move. Firebase → Authentication → Authorized domains: add sm-aqa.netlify.app (owner Google sign-in, reports, rooms).
- tests/move_ui.js: both addresses served from dist.

Revise#327 — Pack: "this is my play data (aa-replay-20261110-1643.json), please use it to improve the bot".
- Learned with BOT_SEAT=0 from his 3 games where he is seat 0 (20261110-1643 and -1141 vs the bot, 20261108-1059 online): 196 real choices. The bot (v4.89) agreed with 69; fully learned about 105, but that one won only 13 of 40 against v4.89 (copies too closely). The half-way mix (v4.89 weights + ½ of the change) agrees with 96 and won 25 of 40 against v4.89 — used.

Revise#328 — Pack: "please change the interface as I designed" (Solo box sketch).
- Solo box (t2-render.js lobby): Deck 1 and Deck 2 selects at the top; "Who goes first" with a switch Deck 1 ⟷ Deck 2 (the old "Go second" checkbox #lSecond, now a switch: on = Deck 2 first; applies to every Solo mode); two framed groups side by side (one column on phones): "Play by yourself" — Player (one deck), Player #1 vs Player #2 (two decks); "Play with the bot" — Player vs Bot, Bot vs Bot. "Continue the last solo game" stays under them.

Revise#329 — Pack: "put the bug reports on the site, as a tab inside Changelog".
- src/tickets.json (one entry per card report: id AQ-NNN, status done / open, fixed version, card, report text in Thai + English, breakdown steps, cause, fix, check, captures) → build.py render_tickets → index.html #clBugs; captures in assets/tickets/ (copied to tickets/). The Changelog header has a Changes / Bug reports switch (the count of done / open on the button). Done tickets are closed and not analysed again unless Pack asks.

Revise#330 — Pack's feedback on his last game: "a player does not place more Character cards than benefit him: (1) to put the character into the Control Area; (2) an Aggressive character to deal damage to the player — it brings characters from the deck faster than drawing and charging; (3) otherwise they are used as power cards instead of going to the Active Area, where they change nothing."
- 20-bot.js AA4.botSetCharOk: setting a Character card from the hand is a bot move only if it is Aggressive (▼), or the power all its Active Characters still need (this one included, by Mental) ≤ the power cards it can give this turn and the next: the hand cards left + Charge X from the deck now + Charge X + 1 draw next turn. Otherwise the move is not considered, so the card stays to be charged as a power card.
- 20 games, the rule against the bot without it (13 decks): 13 wins of 20; Active Characters left undominated after the Charge Phase 3.5 on average against 4.45.

Revise#331 — Pack's feedback: "for attacking, a player looks for the way to win that suits the deck's play style — not only by attacking. See my last log: I wait until the opponent cannot fight, or a suitable moment, to attack."
- 20-bot.js AA4.botAttackOk: an attack on a player is a bot move only when no untapped Controlled Character of that player that can pay its guard cost (+ the Boost) has Attack ≥ the attacker's Defense; or botReady = 1 (the finishing strike); or this hit alone reaches the losing damage. Attacks on characters are not limited.
- 30 games, the rule against the bot without it (13 decks): 18 wins of 30.
- Still to learn from more of Pack's games: winning without attacks (taking the opponent's characters, damage by cards) follows the deck's cards; the bot only values those by the board they leave.

Revise#332 — Pack: "confirm how you keep enough power cards on the field to break with a named card, which has more status / effect. You may analyze the type of the name level before the start — for example attacker, supporter."
- Before: nothing kept power for it; the bot only valued Break cards in the hand (handValue) and power on the field in general.
- 20-bot.js: AA4.botPlan(S, db, seat) — the bot's own deck: every Break card with a Name: cost, factor, worth (stats + 2 per effect / ability + skills), copies, and its job AA4.botRole: attacker (Attack is its best number ≥ 4, or attack skills), supporter (effects / abilities, Attack ≤ 3), defender (Defense first, Shield / Intercept), allround.
- In play, for the best named Break card in the hand (while not ready to fight: an attacker counts +3): features breakShort = the share of its cost the power cards on the Controlled Characters don't cover (weight −2.6: spending power below the cost is paid for, charging up to it is rewarded) and breakNoTarget = no Controlled Character of its own it may break (−1.2). A card being declared still counts, with what was paid.
- Rules: a named Break card is not charged as a power card while another hand card can be; a named supporter does not attack a player before the finishing strike.
- Fix found on the way: a declaration that cancels itself ("no valid target") changed nothing but looked like a set, so the bot could repeat it — now not a move.
- 30 games with / without the two features (13 decks): 15 wins of 30; named Break cards set per game 0.43 against 0.30.
- Bot vs Bot bar: the plan text's tooltip lists each bot's named Break cards with job and cost.

Revise#333 — Pack: "I played Solo against the bot until the game ended, but the log does not show in my admin page."
- TB.keepSolo wrote the whole game with set() on rooms/<code>/log. The database rules give write access per entry (rooms/<code>/log/<entry>, as online rooms push them), so the write was refused — and only written to the browser console. Now update() with all the entries (each one checked on its own path), and a toast when saving fails. Games finished before this fix were not saved; "Save replay" files cover them.
- The UI test's stand-in database now refuses set() on the log.

Revise#334 — bot training (Pack: "yes, please train") and two more of his games (20261110-2018, -2058: he won both with the Michael deck).
- tools/bot_train.js, 90 min, anchored on the v4.90 weights, 13 decks (4 basic + the decks in Pack's replays): 35 rounds. With the v4.91 rules on: 38 of 58 against the v4.91 bot (14 decks, both seats) — used.
- Pack's style from his 6 games (414 choices): the bot agrees with 161; learning moves that to 166 at most and the half-way mix loses to the trained bot (22 of 59) — not used. The remaining difference is in card-specific plays (taking characters, when to use each effect), which the weights can't express; the rules of Revise#330–#332 carry his feedback instead.

Revise#335 — Pack: "the sizing at the top of the player's field to adjust the size still does not appear — please add it."
- The card size slider (Lv 1–6, the same as Player options → Card size; live while dragging) is now in your own field's header, at its right end (#sizeTop). Clicking it does not open the hand. The Control · Back S/M/L slider stays where it is.

Revise#336 — Pack: "add a Sort hand function beside the hide button, the same icon as the Control Area sort. Order: faction (the common order) → Mental low to high (no Mental = 0) → cost low to high (no cost = 0) → Factor low to high (none = 0) → card type Character → Break → Permanent → Fast → Project."
- Engine: intent sortHand {order: [card ids]} (your own hand's cards exactly; Play and the opening hand; undoable) → op sortHand → event handSorted {seat} (no order: the hand is hidden) → log "X sorts the hand".
- Table: the button in the hand's title bar, left of fold (shown with 2+ cards); TB.handSorted gives the order (cost X counts 0; a card without a faction goes last; ties keep their order).

Revise#337 — Pack: "can the admin have its own account? Link the admin to the account username sakhudoge — currently the admin cannot log in" (the Account page said "This sign-in has no deck account" for the owner's Google sign-in).
- 08-account.js: ADMIN_ID = "sakhudoge". A Google (owner) sign-in without a users/<uid> record takes the account sakhudoge: ids/sakhudoge exists → its users record (A.recUid; the owner may read and write it); otherwise users/<Google uid> = {id: sakhudoge, …} and ids/sakhudoge = {uid: Google uid, email} are made now (only the owner can, by the rules). Profile for a Google sign-in shows no email / password forms (they belong to the Google account).
- Login page: "Admin: sign in with Google". Account menu of sakhudoge: "🛠 Admin page" (→ #addoge).
- Users / Approve registrations also open for a sign-in whose uid is ids/sakhudoge/uid (an ID + password admin account); for that to pass the database, the owner conditions in the rules would need "|| root.child('ids/sakhudoge/uid').val() === auth.uid" — not needed while the admin signs in with Google.

Revise#339 — Pack: "next, let's continue card implementation" (batch, 17 cards).
- Sentences: "目標が(必要ファクターN以上の)X系 / 三征西班牙…を持つキャラクターの場合、さらに、… / 代わりに、…" → the extra steps carry ifTSel {tag[, factorGe]}; with 代わりに the steps before carry ifTNotSel (new step guard in 16-effects.js). After "次にバトルによるダメージを与える場合" the extra Attack is another nextBattleModsT; after "目標がアタックした場合、このカードを捨て札する" "代わりに、手札に戻す" is discardOnAttack {dest: hand}.
- "…場合、このカードは必要ファクターとコストを無視して使用宣言可能" (+ cond "あなたの対戦相手がキャラクターを支配している場合"); "目標はイニシアチブをNつ得る" (N grants: each counts); "目標は、エフェクト全てが無効化され、アタックできない".
- Abilities: "このキャラクターがアタック目標にアタックした場合、攻撃力に+Nして判定する" = always, cond self attackingUnguarded (attacker, no guard); "プレイヤーにアタックした場合、…" on a Permanent; "このカードがブレイクしてセットされた場合、≪…キャラクターのオーナー≫に、このキャラクターの攻撃力に等しいダメージ"; "このカードが““武蔵””にセットされている場合" (the Name keeps its own quote) and "このキャラクターに“「武蔵」”がセットされている場合" (cond selfHasCardName); "≪あなたの手札全て≫を、パワーカードとして…" (comma variant); "…置かれた際、あなたがこのカードの必要ファクターを満たしている場合、…" on a Project card (EP449).

Revise#340 — Pack: "please continue implement card until all done and also train bot until 06:45" (batch 1 of the night, 19 cards).
- X: "このキャラクターを構成する“A”または“B”の枚数" (selfNamedAny); "あなたの支配エリアの<勢力>の<分類>の数"; "≪このカード≫のコストはX減少する" with a countChars X → costLess. A single "Xは…に等しい" on a card also applies to its triggered abilities.
- Selector "構成するカードにネームを持つカードがN枚以上含まれている" (stackNamedMin). Triggers: broken {cardNamed, prevNamed}; damaged {byThisBattle, chSel power = 0} → discard; attack → mill evOwner; cardDeclared Break → mill evPlayer.
- "≪プレイヤー全て≫はブレイクしていないキャラクターからダメージを受けない" = playerNoDamageFrom {sel} (14-battle.js). factorIgnore {type Break, icons, firstInMain}.

Revise#341 — overnight batch 2 (33 cards).
- Steps: deckCharsToActive (all players; each deck shuffled after); delayed step guard `if` + toDeck {shuffle} ("ターン終了時に、…がいる場合、≪このカード≫をデッキに戻し、そのデッキをシャッフルする"); "このターン中に、あなたの支配エリアのネームレベルキャラクターが捨て札されている場合、代わりに、…" = cond namedGoneTurn (S.turn.namedGone).
- Selector attackingDmgMin; cond self "attackingBoost" {n}; x selfNamedPlusPower.
- Mods: permFactionGuard (Resist + Protect vs the factions of its Permanent cards); breakCostFree (the Break card's cost is decided after its target, as freeOn); payFor {sel name} with a namesCtl condition; playerImmune {byOpp} no longer blocks the player's own Project / Fast cards; cardCost −99 for "コストを無視してセット宣言可能" until the end of the turn.

Revise#342 — overnight batch 3 (23 cards).
- Selectors ownerAttacked, powerLeSelf. Mods: unguardedNextP (bound to the next battle whose target is a player; guardBlocked), zeroPowerCardDie (state check: the Permanent is discarded), noDamage {fromSrc}, keepByCard {battleOnly}.
- watchEv attSel ("<分類>のアタック宣言に対してガード宣言したキャラクター"); guarded watchers for 0612 / 0740. Step eachPowerToDeck.
- "…タレントがいる場合、≪このカード≫の必要ファクターはN減少し、≪このキャラクター≫は+a/+b/+cされる / 「effect」を得る" (talent_cond on both); gained_effect accepts 「N:…」を得る without the word エフェクト.
- "キャラクター1人を指定する。≪指定されたキャラクター≫は…を得る" = a chosen character, until the card leaves (until: source).
- Deviation noted: EX0340 keeps the target by discarding the card when asked (keepByCard), limited to battles.

Revise#343 — overnight batch 4 (21 cards).
- Card fields: altFactor (factorOk tries the printed Factor, then the other one); freeIf {cond}; onlyOnNames for "≪このカード≫は“X”にのみセット可能" (Permanent).
- A line of skills followed by series tags ("▼ K.P.A.Italia", "… チャージX 武蔵 英国") → tags + Skill X from the card's X line.
- Triggers: battleEnd {vsUnbrokenCtl}; brokenSelf newSel {name, otherJp}; damaged byThisAny → cardsOf perm; damaged byThisBattle → discard evCh + the card. Ref evActor (the player who did it).
- X: selfTopNamedBreakCost, drawPhase. factorLess sel.notFaction. dest {targetIcons, next} for "次に<分類>を目標にブレイクカードをセット宣言する場合".
- Three rules of Revise#294 had double-escaped patterns (never matched): fixed.

Revise#344 — overnight batch 5 (13 cards).
- Conds belowNamed, battleVsCh (a step mod with cond battleVs is bound to its target). The stack's top is its last card: "below" = lower indexes (selfTopNamedBreakCost of #343 corrected to read from the top).
- watchEv {optional}: asked each time until used (EP446). Mods playerNoDamageAll (cond checked where it is read; playerImmune byOpp reads its cond too); unguardedNextP {any}.
- "このカードのコストは、目標からのみ支払うことが可能" = payOnlySel of the target selector; "≪このカード≫のコストは…" read as "このカードのコストは…"; "目標の≪あなたの支配エリアの“X”≫" = one such character. Selectors: "キャパシティ+Xのスキルを持つ", "“X”以外の".
- "目標が“X”の場合、さらに、…" keeps the turn duration of the line before, as 代わりに already did.

Revise#345 — overnight batch 6 (16 cards).
- "このカードのコストが(必要ファクターがN以上の)<X系>を持つキャラクター1人からのみ支払われている場合、代わりに / さらに / その後、…" → ifPaidBy {sel, one, tag, factorGe} (one = exactly one payer); the pile-pick step keeps its guards. EP500: one target; without that payment only a ▼ character is hit (deviation: a non-▼ target may be chosen and nothing happens).
- "このエフェクトのコストを、ブレイクしている“X”以外から支払うことはできない" = declCond selfIs (an effect is paid by its own character). cond "このカードがブレイクしている“X”にセットされている場合".
- altFactor may be a list. Tag glued to the ability text ("シールド K.P.A.Italia≪…≫"). "<作品>シリーズの" as a selector. Selector ownerDmgMin.

Revise#346 — overnight batch 7 (16 cards).
- Steps eachFactionSac (ops factionSacAsk), oppFactionSweep, dupNameToDeck (top cards of characters and Permanent cards, by card name; the decks are shuffled).
- Mods baseSkills (skills of the Character cards in the stack); battleKillTo under a "このカードが…にセットされている場合" condition; fastIfCond {oppDeclaring}.
- X: factorSumAll, stackFastOnSelf, selfStackType, damageDiff; "N+Xドロー" (nPlus). "(\d)ダメージ与える" read as "ダメージを与える". capSign in "F のキャラクター・キャパシティ-Xを持つキャラクター…".
- EP504: the last sentence ("…ダメージを与えた場合、その後、このカードを捨て札する") adds nothing — the card leaves after its effect.

Revise#347 — overnight batch 8 (12 cards).
- Card field setCond (cond handHasTag) for "…を持つ手札を公開しない場合、このカードを手札からセット宣言できない". Selector baseStat (printed value of the top card). Mod effDmgUp (A.damage adds it for effects). multiHit under battleOrAttackPlayer.
- watchEv {bySrc, keepTargets} (targets chosen at declaration reach the watcher's effect); guarded watchers: damage / power cards / stat until the battle ends; anyDeclared watcher (0152).
- "≪あなたの手札の「X」1枚≫をこのキャラクターにセット可能" = pickZone hand → perm by card name (brackets as stored: half-width).

Revise#348 — overnight batch 9 (15 cards; 6 repaired, 1 demoted).
- Steps skillPick (op skillPickGo), powerMoveToSelf, ownSac (op ownSacGo; effLast = 1 only when all N were discarded → the next step carries ifLast), discard {topBreakTo}. dominate for "目標の≪あなたの勢力キャラクター1人≫を、あなたの支配キャラクターにする".
- breakFromDamage {faction, oncePerTurn}: the draft remembers fromDmg, draftDone stores p.dmgPlayTurn. fastExtra for a Break card ("…セット宣言可能") and for "追加の1コスト支払うことで" (を missing).
- parse_body: an automatic body whose step uses "t" without a target is now "partial" (guard). "目標の≪<pile card>≫を、あなたの手札に戻す / あなたの支配キャラクターとしてセットする" with a pile reference → pickZone (hand / back) — 0297, 0299, 0313, PR039, EX0141, 3201 never asked for the card before.

Revise#349 — overnight batch 10 (12 cards).
- Always abilities with zone "damage" for "このカードがあなたのダメージ置き場にある場合、…" (PP140) and "この効果は、このカードがダメージ置き場にある場合にも効果を発揮する" (PP241: both zones).
- ownBreakFirst {named} (any faction). Mod subPayBuff (applied in AA4.subPayBoost for attack and guard). noGuardBy {} under cond xAtLeast pileCount (PP334). dest {onTarget: self, to: damage} for costs of cards that target this character. X: pileCount with icons over all Damage Piles.
- Step oppTopPermToDamage (op oppTopPermGo): the other cards go under the deck in the order they were (the player is not asked for an order).

Revise#350 — overnight batch 11 (8 cards).
- Card field fastIfTName: allowed at fast timing while such a character exists; the target selector then also asks for that name. Steps fillPowerT, selfDeclFree (effDeclPick onlyIds, the card's own zone and type, free). endMyMain with ifTNot.
- X selfEffectsOnOpp {costMin}: distinct effect uses (src.eid) of this character on its battle opponents; the cost is read from the effect line ("N:").

Revise#351 — overnight batch 12 (4 cards) and bot weights.
- Target-dependent cost of a Project / Fast card with one character target and a printed cost: planDeclaration uses xdef {tCost {base, rules, type}} (xMode "def", cost null) when the card has tCost rules or a cardCostT modifier exists; after the target is chosen the cost is set and d.x is cleared (a note, no xSet event). xOf tCost: card rules {sel, free | add}; modifiers cardCostT {types, n, targetsSrc | targetSel, byOpp}. Cards with an X definition of their own are left out (0284 / PV052 stay partial).
- Bot: 21-bot-weights.js = train9 (anchored, 24 games per comparison, 110 min): 70 / 118 against the train7 weights. train8 (8 games per comparison, 90 min): 25 / 60 — not adopted.

Revise#352 — overnight batch 13 (11 cards).
- handUnder {ev, any}: the card of the event (a watcher) and any number of cards; handUnderGo takes several. Watcher on "broken" {own, cardNamed, cardFaction}, once. Steps thisCardPowerOn (asked), costUnder {name} (the set item's paidIds are kept on the card when it has costUnderName), endOwnMods {key}; pickDiscard {upTo}.
- Mod breakAnyIconCard {faction, named} in breakReason; it is ended by the watcher when that Break card is set (0919).
- Reading of 0805: "あなたが支払ったコスト" = the cost paid to set this Break card.

Revise#353 — overnight batch 14 (9 cards).
- Damage redirection: damageChar reads dmgToSource {mental, nonBattle} (→ damagePlayer of the source's owner) and dmgToOwner; damagePlayer reads ownerShield (→ damageChar on that character, then the Permanent is discarded). The flag redirected stops a second redirection.
- Effect body field costToIf {cond, to} (checked when the cost is paid). Step stackToPower. pickZone hand → perm by jpHas. X charStatSum over "…キャラクター全ての攻撃力の数値の合計".

Revise#354 — overnight batch 15 (14 cards).
- pickDamage: count "any" (0 … all; EX0455 "Xは100以下のあなたの任意の数") and countPlus ("1+X体", EX0120).
- cardToken: atMental, guardOnSet (op tokenGuardAsk: asked at once when you are being attacked and nobody guards yet). Cond attackDeclared. 0283 / PR048.
- Play sentences "このカードはあなたのターン中にのみ使用宣言可能" (declCond myTurn) and "…アタック宣言が行われている場合にのみ…".
- 0994: trigger with zones ["damage"] on broken {cardNamed, cardFaction}; step thisCardFromDamage.
- Card field fastPayOnlySel (EX0299): fast timing, but then only that character pays. costLessIf {fieldName} (EX877).
- Seat mod projFastNext (EP607): ended by the next Project card that player declares.
- areaMod: mods (list), sel, multi (EX894, EX853). pickOppDamage: mental (EX835, watchEv leave bound to the target).
- EX877 always shuffles the deck (also when the card came from the Discard Pile).

Revise#355 — overnight batch 16 (11 cards).
- Card selector setAny (a power card or a card in the Permanent role on any character). Step permToPowerPick (you choose the Broken character of the card's owner).
- Step itemToDeck {drawCost}: the declared card goes into its owner's deck, shuffle, the owner may draw its cost (an X cost = the X paid).
- Step eachOppHandDiscard (in turn order, face down; with more than two players the card may come from any opponent). Step pickMakeAttack.
- Mod copyBattleOppSkills (read in charStats while a battle is on). 0540: battleStart trigger, pickStat + "@stat" +N until the battle ends.
- 0771: fastBreak {icons} and factorLess 1 for those Break cards (the reduction is always on, not only at fast timing).
- peekTopBottom: n "X", thenOrder (the cards left on top are ordered by you). EX0736: delayed at the end of the Power Card Phase, X counted then.
- Fix: tokenGuardAsk (Revise#354) read the yes/no answer wrongly — "no" also guarded.

Revise#356 — overnight batch 17 (13 cards).
- deckTopToken: tags (matchChar sel.tag also reads a token's tags). EX850 = the step twice.
- Cond ownEffectsActive [names]: a modifier of yours whose source card has that name exists. EX0757–EX0759 check it when the card resolves (not continuously).
- thisCardFromDamage {dest: "back"} (PP240 / PP248: trigger with zones ["damage"] at every turn start, optional; the card is set directly, there is no declaration to respond to).
- permNoFactor {jpHas} (EX0645 / EX0774). pickZone dest perm + permOn "evCh" (EX848). pickZone sel.factorMet (EX895).
- factorLess {next}: ended by the first card it fits; that card is then set without a second Factor check (EX0696).
- EX903: rememberIconsT before the bounce, then a Character card with one of those classes from the hand.

Revise#357 — overnight batch 18 (11 cards).
- Char selector onlyCh. Step attackableT (attackChars {onlyCh}) for 0573; mod cond {battleVs: "@t"} = a battle with the designated target (EX0684); step payDestT (dest {paidBy: {onlyCh}}) + watchEv attack → cancelCurrentAttack (EX0752).
- 0509: "…1人を指定する。≪指定したキャラクターにセットされているパワーカード全て≫を捨て札する" = a designated target + powerDiscard.
- 0310: "このエフェクトの使用宣言時に、あなたの支配エリアのヴァンパイア1人を捨て札する" is done when the effect resolves (ownSac; the rest only then). powerMoveToSelf also for "…このキャラクターにセットする".
- Steps eachReorderTop, drawSeatsCtl (EX0735); ownPowerPick {territory}, deckTopPowerPick (3657); purgeSameNameT and card selector projIfCond (PP183 / PP189).
- Cond attackedYou (EP419). EX0723: the stand-alone "≪このキャラクターのバトル相手≫の攻撃力の数値に-Xして判定する" takes X = this character's power (written once, after the effect).

Revise#358 — overnight batch 19 (9 cards).
- Char selectors notSel (not matching another selector), notFactionCh; "<勢力>のファクターを持つ / 持たない" in parse_selector.
- Cond sameFactionCtl (EP385, play.factorFreeIf). Step field ifTNotName (EX0306: +2, or +4 on “リオ・ウェズリー”).
- EX902: step cancelAttackOnYou for the attack going on, and a watchEv on attack {atMe} for the rest of the turn; which characters = decided when the card resolves.
- EX867: "このカードのエフェクトは、あなたが…していなければ使用できない" → declCond on every effect of the card. Item target {kind: effect, aimsMine} + cancelItem.
- forceGuardT {any}: an attack of any character (0469 / 0484). The sentence about not being a direct response needs nothing: effects may be declared in any response.
- PP024: payFor {kinds: [attack], icons} for the turn.

Revise#359 — overnight batch 20 (12 cards).
- Step handPermToken {token: {name}} (0211 / 0226 at every turn end, EP424 as an effect). The table has no face-down Permanents: the card is shown as that token. X permTokens also for "…の数に等しい".
- Card field costCharsOnSet (PP299): matching paid cards go to the Control Area in the cost-destination step.
- pickZone sel.textRe (0907 / 0925): "攻撃力と耐久力を同時に上昇させる効果を持つファストカード" = a Fast card whose text has "/+N/+N" or "攻撃力と耐久力に+".
- 0407 / 0422: an enter trigger with the Factor condition (pickCharAll, power 0) and the gained effect as an always ability with the same condition.
- pickCharToPower {multi} (0983 / 1001). Step banCostPick → ban {decl: set, types, costEq} for the opponents while the character is on the field (PP212 / PP220; numbers 0–10).

Revise#360 — overnight batch 21 (9 cards).
- EP267: "目標の≪A1人、またはB1枚≫を…" = two modes (a character / a card).
- 0743: card fields costLessIf {sameJpDeclared} and declDrawIf (the draw is made in draftDone); cond sameJpDeclared (another declared card with this card's name; checkCond now gets the card).
- 0477: watchEv broken {oppTerritory} → damage to evActor (runWatchEv passes evActor = the seat of the event).
- 0465: enter {fromDamage, byAttackCtl} (the "entered" event of a damage check knows whether it came from the attacking character).
- Steps peekHandDiscardT (0958, the player is the second target part), pickZone {topN} (EX0069), costTo deckShuffle + pickZone X (3621).
- Step fields ifTNames / ifNotTNames (EX900: exactly those two targets). EX0322: one more card with ifPaidBy.

Revise#361 — overnight batch 22 (6 cards).
- Step massDeclarePick {n} (0909 / 0993): no battle → the chosen characters attack one opponent together (battleDeclared for the first, raidGo for the others, no cost); you are attacked and nobody guards → they guard together (guard + joined.grd). In any other moment the card does nothing.
- raid value: max {selfBoostPaid} (X = the Boost of the battle this character started), sel (0015 / 0030).
- mill n "last"; mod value {xlast, sign: 2} (3805 / 3808).

Revise#362 — overnight batch 23 (7 cards).
- Pseudo-step field _gateRest (parse_body): the steps after it get ifLast. Used by "このエフェクトの使用宣言時に、あなたの支配エリアの…N人を捨て札する" (fix for 0310 of Revise#357) — EP540 sets ifLast itself.
- EX898 = the two existing sentences joined (no declarations + no Factor). EX0483: the bind and the attack-cost rule (dest {paidBy: the same selector}) only with the named character, checked when the card resolves.
- EX906: watchEv leave {battle} with oppOfBound → powerDiscard + permsOfT on the battle opponent.
- EX0327: ifNotPaidBy / ifPaidBy {sel, named, broken, icons}. PR329: powerFromDeck X with X = targetCost (the card target).
- rememberIconsT also stores the owner; step damageIconsOwner (3544).

Revise#363 — overnight batch 24 (6 cards) + bot weights.
- splitDamage: n "last", players (options "p:<seat>" next to the characters; damagePlayer for those points). 1948: X = the power cards just discarded.
- Step field ifTPileMin (the target player's Damage Pile). EX0167: handAll, then damage "last" twice.
- Step deckSameAsPicked (0708): a card on the field (stack or Permanent) or in a Damage Pile is named; the first card with that name in your deck goes to your hand and is shown.
- discardHandAnyX {max} + thisCardPowerT ifLast (EX0130). Card field factorLessX countChars and payOnlySel {named, hasPermJpHas} (EX0756).
- src/engine/21-bot-weights.js = train10 (105 minutes, anchored, from the v5.07 weights; 24 games per comparison). Test: 8 blocks of 30 games against the v5.07 weights → 134 of 234 decided games won (57%).
- One weight was changed by hand after the test: "lethal" (a hit that can finish the opponent) came out at −0.161; it is kept at 0.246 as in v5.07, so the bot never values a finishing hit less than another hit (the engine test of Revise#311 asks for that).

Revise#364 — overnight batch 25 (10 cards).
- Step payOrDiscardT (0252): the owner of the target card pays N power cards of Controlled Characters, or the card is discarded when that is impossible.
- pickZone owner "t" (the target player's zones) + shuffle to t; step millPickOpp (PP270 / PP278).
- handPermToken {any}; step permTokenDiscardAny → damage "last" (EX806; 金 are token Permanents, shown face up).
- Step blessPick / blessGo (EXPR043): X = how many Controlled Characters you choose (at least 2).
- Step damagePayerAt (EX887). EP499: "…の場合、さらに、目標がバトルする際、目標は…を得る" = the mod with cond inBattle and ifTSel; "目標がバトルした場合、バトル終了時に、このカードを捨て札する" without a duration = endSrcOnBattle for the turn.
- Step damageNameRepeat (0377 / PR054): the top N cards of the deck are looked at before each damage check; the named card among them → once more (10 times at most).
- 2983: the two choices are one question — discard any number of hand cards and draw that many; none = draw 1 (step field ifNotLast).

Revise#365 — overnight batch 26 (9 cards).
- splitDamage {area: "last"} after rememberAreaT (3694 / PR340: the owner and the area of the character before it is discarded).
- Steps factionStripPick (0022), factionWatchDamage (PP085: two watchEv modifiers, attack and guarded, chSel {faction}), damagePermCostPick (EX866), handXToPower (PP054: one character gets all of them).
- Item selector aimsSelfCh (EX828): a declared Project / Fast card that targets this character, or one that works on a whole group.
- effDecl {jpHas} (EX0183). skills_list reads "∞" as 99 (2765: キャパシティ+∞).

Revise#366 — overnight batch 27 (10 cards).
- play.discount {from: "deck", to, factorOnly}: the question shows the top cards of your deck; how many you mark = how many go from the top to the Discard Pile (EX0472, Factor only) or the Damage Pile (2031 / PP277, Factor and cost). As for the hand discount, it is only offered when the card is declared from the hand.
- Card selector fastIfCond (2031: a Fast card may be the target only with a Named Polestar Empire character in your Control Area).
- Step eachDamageSwap (0445): in turn order; each player chooses from the own Discard Pile.
- Conds namesSameSide [A, B] and battleSideWith name (the top cards' names of the characters on one side of the battle: attacker + joined, or guard + joined). EX803: noDamage {battle} for both; EX0669 / EX0672: +1 for both; EX802: guardTaxVs with cond sameArea {name}.
- EX0595: enter → a Permanent with that name (name, or the card name contains it) from the deck; its effect: selfCardDiscard, then the named Permanent from the hand onto this character (pickZone permOn "self", factorMet).

Revise#367 — overnight batch 28 (9 cards).
- EX874 – EX876: seat mod keepPaid (the item's paidIds are kept on the Break card) + watchEv broken {own, cardTag}, optional and once → paidToHandEv, thisCardDiscard. A watcher that is optional and once is asked again the next time when the answer was no (also EP446).
- Seat mod projFastTurn (0876 / 0894): planDeclaration lets one Project card through at fast timing; the draft carries projFastTurn and draftDone notes the turn (players[seat].projFastTurn).
- Step pickOtherBless (mods with fromChar until removed). EX911: enter with cond all [selfIs name, selfPermSel jpHas] → fillPowerT self.
- EP378: attackChars {srcCh} (= {onlyCh: the source character}); guarded {attackOnSelf, guardOwn} → damage to the new ref battleAttacker.
- EX910: costLess countChars {tag}; enter (optional) → effDecl {hand, Break, tag, ignoreFactor, freeCost, repeat}. 3125: the wrong-class check is made when the Permanent is set (enter, cond not selfIs icons → selfCardDiscard); pickZone sel.sameJpAsSrc for its copy at the start of your Main Phase.

Revise#368 — overnight batch 29 (9 cards; 0787 has the text of 0785).
- The "damaged" event carries fromSeat; trigger flags nonBattle, byOppSeat, hurt; evStat {n} for damaged; powerFromDeck n "evN" (EX865).
- killed {namedVictim} (EX0058). Step killHitOwnerSide (0342: X = evAll, the stack and everything set on the discarded character).
- selfDeclFree {paid} (3799: declared from the Damage Pile with its cost; optional). 0785: freeOnName + enter with cond belowPName → pickCharDamage X.
- EP440: three stat mods with cond selfIs {name, baseStat se ≥ 5} and skill remove bind on battleOpp with cond all [that, inBattle].
- EX0292: broken {self, own, cardName} with cond myTurn → makeAttack self, optional (the Project-timing condition is read as "in your turn, no battle going on"). 2358: leave self with cond fieldName → a Break card without a break rule from the hand.

Revise#369 — overnight batch 30 (5 cards).
- EP372: trigger zones ["damage"], leave {own, controlled, oppCause} → thisCardPermOnto {sel} (optional).
- EX912: untargetable {from, byOpp, costMaxPower} and noDamage {battle, fromSel powerLeSelf}. EP423: one effect with untargetable {exceptCard}, noPay, noAttack, noGuard, noEffect until the end of the turn; X = this character's power.
- EX0480 / EX0498: eachPlayerPick with sel {workNames}: the player does not name first; every deck card that has one of the work's names, or one of them in its text, can be picked (same result).
- Sentence "あなたのデッキの上からN枚をあなたのダメージ置き場に置く" → mill to the Damage Pile.

Revise#370 — EX0485: mod steps on all named characters with value {x {battleOppPower, ofTo, div}} and cond inBattle. ofTo in modValue: X is counted for the character that carries the modifier, not for the source of the effect.

Revise#371 (Pack) — the hand keeps one height, and a fixed hand position.
- An empty hand shows a dashed placeholder card (.card.hempty) so the panel is as tall as with cards. On a computer the hand row always shows its scroll bar track (overflow-x: scroll, thin). The title line does not wrap (the Factor chips are cut instead).
- Fixed hand position: button 📌 (data-act handDock) left of Expand; ui.handDock, stored as aa4-handdock. On: class "dock" — the hand is a bar at the bottom edge, from the left edge to the side panel; it cannot be dragged and a saved drag position is ignored. Not shown at 900 px and narrower (the hand is already fixed there).
- Not changed: the expanded hand still grows by rows, and the Charge window still adds its line to the hand during the Charge Phase.

Revise#372 (Pack bug) — Bind X given more than once is not added up.
- charStats keeps bindList (every Bind X the character has); skills.bind is the largest. A "remove" or a "set" (バインド0を得る) clears the list.
- keepOptions offers one choice per different X that the power cards can pay ("Bind 1", "Bind 3"). The status line shows "Bind 1 / 3".
- Other numbered skills (Charge, Draw, Capacity, …) are still added up.

Revise#373 (Pack) — hand card size, as Control · Back: ui.handZ S / M / L (0.5× / 0.8× / 1×), stored as aa4-handz; class hz-S / hz-M / hz-L on the hand sets --cw from --cwb. Vertical slider (id handZ) at the right end of the hand; not shown while the hand is folded.

Revise#374 (Pack bug) — "Who goes first" in Solo with two decks / vs Bot / Bot vs Bot.
- The table sends rules.firstSeat (0 = Deck 1, 1 = Deck 2) for mode solo2; startGame then sets the turn order without the coin toss (event "order" with chosen: true, logged as "Turn order (chosen)").
- Logs without firstSeat (older games, replays, training) keep the coin toss. Online rooms keep the coin toss.

Revise#375 (Pack) — the bot: Character cards and attacks.
- botSetCharOk (rewritten; Pack's list): (1) with no Aggressive character waiting in its Active Area, the Aggressive Character card with the highest Attack in the hand may be set; (2) besides it, at most setActiveMax (1) character waits in the Active Area, and a card is only set when the hand cards it can spare (not itself, not the named Break cards) + the Charge still open from the deck this turn reach its Mental; (3) a character of another faction waits while a Main Factor character in the hand passes (2) — botMainFactor = the faction with the highest Factor sum over the named cards of its own deck; (4) a Break card in the hand with no character of its own to break lets a character of its faction be set anyway.
- botAttackOk: a hit that can win → yes. Otherwise no attack while the power cards on its Controlled Characters < attackPowerMin (3; ignored when fewer than 10 deck cards are left). An attack on a character that defeats the attacker and survives → no. An attack on a player where an able guard defeats the attacker → only when attackStrike (1) and the attacks left after every able guard has taken the strongest ones cover the damage needed. Before, "ready" (total attack ≥ damage needed) was enough, which ignored the guards: in Pack's game SOLOBOT-5GFW the bot made 5 such attacks; the new rule refuses all 5.
- Feature attackLoss (cards lost with the attacker: stack + power) with its weight. attackPowerMin, attackStrike, setActiveMax are limits: bot_train.js does not vary them (AA4.BOT_LIMIT_KEYS). The limits follow the weights of the player (opts.weights), so two settings can be compared in bot-vs-bot games.


Revise#376 (Pack) — the bot's attack limits from the players' statistics.
- tools/bot_stats.js rooms.json: for every attack declaration — power cards on the attacker's Controlled Characters, Charge total, Offensive, a guard that could defeat it, survived or not; players and the Bot apart.
- 17 rooms, 71 attacks by players: total power 25% = 3, median 4, 75% = 8; Charge 10% = 3, 25% = 3, median 6; survived 62 of 71; all 9 that died had attacked into a guard that could defeat them; with Offensive 25 attacks, 24 survived. The Bot (20 attacks, old rules): total power median 3, Charge median 3, survived 11.
- attackPowerMin = 3 and the new attackChargeMin = 3 (both the players' lower quarter); both are limits (not varied by training). An attacker with Offensive skips the two limits; the no-suicide rule still holds for it.


Revise#377 (Pack) — the bot and "1:≪このエフェクトのコスト≫をオーナーの手札に戻す" (botWantedBack).
- On an opponent's turn with the Game Situation on: only in Conflicting / Engaging; in Building / Interfering nothing is taken back. With the Game Situation off: as before (a threat is needed).
- Power kept: need = the cost of the card taken back + the cost of the best named Break card in the hand whose Factor is met (when the card taken back is that kind of card, the larger of the two). The card is only wanted when the power cards on the field − 1 ≥ need.
- The plan is the Break card in the hand to set this turn or the next: a named one first, then the most valuable (nameWorth); only cards whose Factor is met.
- Bug found on the way: AA4.factorOk returns the reason when the Factor is NOT met (null = met); 20-bot.js used the result as "met" in handValue and botWantedBack. New helper facOk. The weights in 21-bot-weights.js were trained with the wrong reading of handValue; the next training round corrects that.

Revise#378 — deck characteristics (Pack: "win rate may not measure much because every deck has its own character").
- Method: mirror games (the same deck on both sides, new rules vs the old attack style: limits off) take the deck out of the comparison; a deck-vs-deck table with the new rules on both sides shows the decks themselves. Script: tools/bot_deckstudy.js (mirror | matrix | info).
- 8 decks × 10 mirror games with v5.32: new 40, old 35. By deck — Dina 8:2, ブレイブ 8:2, Mayumi 6:3, Seraphiel 6:4, Iaris 5:5, Cyborg Rider 4:3, Astarte 2:8, Faris 1:8. With the new rules Faris made 0.7 attacks per game and Astarte 2.9 (old style 6.7 and 9.9).
- Cause: attackChargeMin = 3. The bot's Charge total in its Main Phases from turn 5: Iaris 1.5, Cyborg Rider 1.5, Mayumi 2.3, Dina 3.3 — the limit held Iaris back in 41 of 48 Main Phases. Players attack with Charge 6 (median) because they have more characters with Charge on the field.
- Change: attackChargeMin = 0 (the parameter stays). 8 decks × 6 mirror games after it: new 25, old 19 (Astarte 5:1, Iaris 4:2, Cyborg Rider 3:1, Faris 3:2, Mayumi 3:3, ブレイブ 3:2, Dina 2:4, Seraphiel 2:4).
- Deck-vs-deck (56 games, v5.32 on both sides): Mayumi 11–3, Seraphiel 9–4, Astarte 8–6, Dina 7–7, Faris 6–8, ブレイブ 5–9, Cyborg Rider 5–7, Iaris 3–10. Dina dealt 5.2 mental and 2.9 normal damage per game (every other deck: under 1 mental). Dina won 6 of 9 games with a Dina Break card set and 1 of 5 without; Cyborg Rider 3 of 4 with its main card and 2 of 10 without.

Revise#379 (Pack) — Campaign Mode (Beta), Campaign Design, Campaign Bot Management.
- Plan (Pack): a Common Bot with the common playstyle, and "fixed deck with fixed style" bots: Pack builds a deck and describes how it plays; Claude builds that bot.
- Lobby (Game Table): two columns — Solo + Campaign | Online + Replay. Campaign box (mark "Beta" at the top right): Your deck (a Deck Builder slot), Difficulty Easy / Medium (default) / Hard / Hell — a difficulty without a deck cannot be chosen — Random Opponent (ticked: one deck of that difficulty at random; unticked: a list of that difficulty's decks), Start. The game is Solo vs Bot with the campaign deck (TB.start opts botDeck, style, campaign, coin: the coin toss decides the first player).
- Data: src/shared/campaign-data.js = window.AA_CAMPAIGN {ver, decks: [{id, name, difficulty, winRate, games, deck: [keys], playstyle}]}. First list: the 8 decks of the deck study (Revise#378) with their win rate there; Easy < 70% ≤ Medium. src/shared/campaign.js = AACampaign (list, load, botStyle, propose, manage …), in both bundles.
- Playstyle = {strategy: "default" | "hero", mainFactor, mainBreak, attackers / supporters / disablers: {mode: none | any | select, list: [{key, desc ≤ 250, perm, wait}]}, special: {mode: none | select, list: [{key, desc}]}, critical: {mode: default (15) | specific, n: 0–60}}.
- Campaign Design (bottom of the Campaign box, a fold-out): tab Campaign Deck Builder — one deck, imported from a Deck Builder slot (another import replaces it and starts the playstyle again); tab Playstyle — the form above; chosen cards show their picture. Kept on the device (aa4-cdesign). "Send to the admin" → Firebase campaign/pending/<id> {name, note, difficulty, deckName, deck, list: [{k, n, name, type}], playstyle, at, ver}; "Export (.json)" gives the same as a file.
- Admin (#addoge): Campaign Bot Management — tabs Active / Pending, a Difficulty filter. Active: name, win rate, deck size, playstyle line, and a list to move the deck to another difficulty (Firebase campaign/moves/<deckId>; every lobby reads the moves). Pending: the proposals, a difficulty for each, Copy for Claude, Export, Delete (two clicks), Export all. Moving and deleting need the owner's sign-in.
- Bot: botChoose(…, {style}) — AACampaign.botStyle(playstyle); only "hero" changes the play (Hero Frontal Attack): the Main Attacker cards, their Permanent cards, the Special Priority cards and the Main Break are not charged away while another card can be; power is kept for the Main Attacker in the hand first; no attack until a Main Attacker is set (with its Permanent card when it waits for it) and holds a power card ("Any": any Break card) — unless the deck is below the Critical number or the hit can win. Supporter / Disabler / descriptions are stored for the hand-made bots; the engine does not read them yet. No Active deck uses "hero" yet.
- Firebase rules to add (OWNER = the owner's e-mail, inside the single quotes):
  "campaign": { "moves": { ".read": true, ".write": "auth != null && auth.token.email === 'OWNER' && auth.token.email_verified === true" }, "pending": { ".read": true, "$id": { ".write": "!data.exists() || (auth != null && auth.token.email === 'OWNER' && auth.token.email_verified === true)", ".validate": "!newData.exists() || newData.hasChildren(['deck', 'playstyle', 'at'])" } } }

Revise#380 (Pack) — Auto Re-shuffle: a Character of the Main Factor stays in the hand.
- AA4.mainFactorOf(S, db, seat): the faction with the highest Factor sum over the player's named cards (the same count as the bot's botMainFactor); null without named cards (then the condition is not asked).
- openingHandCheck: Character ≥ 3 · Draw ≥ 1 · Charge + effect cost back ≥ 1 · and, new, a Character whose faction is the Main Factor ≥ 1. Result fields main / mainN; the opening-hand line shows "Main Factor (faction) n/1".
- Only in games created with rules.mullMain (the table sends it; bot training too): an older log draws the same hands as before when it is replayed.

Revise#381 (Pack) — the common bot: the purpose of a Break card without a Name (botPlainBreakOk, in keepMove for the target choice and for the declaration).
- (1) Charge / Draw at once: a no-name Break card with Charge or Draw is set on a character in the Active Area only.
- (2) Factor before other cards: on a Controlled Character of another faction only when botFactorNeeded — some other hand card asks for more of the Break card's faction than factorsHave gives now. This comes first: with the need, a Charge / Draw Break card may go there too.
- A plain no-name Break card on its own faction, or on an Active Character: as before. When none of its own characters is an allowed place, the declaration is not a bot move (the card waits in the hand). Named Break cards and a Campaign deck's key cards (hero style) are not touched by this.
- Not measured in bot-vs-bot games yet.

Revise#382 (Pack) — Campaign Design as a page.
- table.html#campaigndesign (TB.designPageHTML; the lobby's Campaign box has the link; "← Game Table" goes back; hashchange draws again). Not shown while a game is open.
- Left: Campaign Deck Builder — import from a Deck Builder slot (the slot's own columns and order are kept: deck.cols), name, the deck picture as on the Deck Builder page: six columns (Character · main faction / Character · other / Break / Fast / Project / Permanent, the Deck Builder's colours), each card picture with × n. Read only.
- Right: the Playstyle sidebar (sticky, its own scrolling); the title bar folds it to a narrow tab (sideFold, kept with the draft). Under 900 px it goes below the deck.
- Choosing cards: "Choose from the deck…" opens a pop-up with the same deck picture; the cards that fit are buttons (Main Break: Break cards, one; Attacker / Supporter / Disabler: Character and Break cards; Special Priority: any card), the others are dimmed; Apply takes the choice (entries kept keep their description and Permanent card), Cancel / Esc / a click outside leaves it. The Permanent card of an entry stays a list.

Revise#383 (Pack) — the Campaign deck "E.G.O. Mayumi" (proposal file aa-campaign-E_G_O_Mayumi.json: the Mayumi basic deck, Hero Frontal Attack, Main Break 覚醒の乙女 A3-25 3809, Main Attackers 3615 and 3809 with Open-Finger Gloves, note "Only Mayumi attacks unless at critical situation").
- Added as id ego-mayumi (the common-bot "Mayumi" stays in Medium). playstyle.bot = {only, safe, stack}, read by AACampaign.botStyle → the engine style:
  only — only a character built with a Main Attacker's Name attacks; safe — and only when nobody who can guard, or the character attacked, would defeat it; stack — Break cards with that Name go on the character that already has the Name, the Main Break waits while another one of the Name in the hand can be set now, and no Break card is set on top of the Main Break. Below the Critical number (15) all of this is off.
- Measured (14 games against the other seven decks' common bots, both seats): 5 wins; the common bot with the same deck and seeds: 10 wins. Mayumi made 37 of the 41 attacks (common bot: 83 attacks). 覚醒の乙女 was set in 1 game of 14 with either bot — it needs Factor E.G.O. 6. So the deck is in Easy (under 70%).

Revise#384 (Pack) — strategy "Supportive Leader" (playstyle.strategy = "leader").
- Campaign Design: third entry of the Strategy list, with its description.
- AACampaign.botStyle → {strategy: "leader", attackersMode / attackers = the Main Supporter group, all: true, safe: true, chargeMin: 4, drawMin: 3, special, mainBreak, critical}. Engine (20-bot.js, styled()): the Main Supporter cards, their Permanent cards, the Special Priority cards and the Main Break stay in the hand (not charged away) and get the power first; botHeroReady with "all": every listed Main Supporter is on a Controlled Character (with its Permanent card when it waits for it) — "Any": a Break card is set, "None": no condition; no attack while not ready, or while Charge < 4 or Draw < 3; a character with a Main Supporter's Name attacks only when no character that can guard (or the one attacked) would defeat it. Below the Critical number: the common rules.
- "100% survive" is read from the Attack / Defense numbers on the table; cards the opponent may still play are not foreseen.

Revise#385 (Pack) — the common bot: characters with Draw or Charge go to the Control Area first.
- botSetCharOk rule 3: rank = 2 for a Character card with Draw or Charge + 1 for the Main Factor; a card is not set while another Character card in the hand with a higher rank could be set by rule 2 (it can be charged fully this turn). The one Aggressive character (rule 1) and the Break-card exception (rule 4) are unchanged.

Revise#386 (Pack) — the common bot: "if there is not enough Charge or Draw, it is OK not to guard and let the damage go to the player".
- botGuardOk (keepMove, guard / join declarations on an attack on the bot itself): not a bot move when the attacker's Attack ≥ the guard's Defense AND (Charge total < guardChargeMin 3 OR Draw < guardDrawMin 2) — unless the damage already taken + that Attack ≥ 10. Both numbers are limits (not varied by training). A guard that survives is always allowed.
- Draw is 1 without a Draw skill, so until the bot controls a Draw character it does not give characters away as guards.

Revise#387 (Pack) — the common bot: Break cards with a cost go on a "break-cost return" character.
- botBreakBack(ch): the character's top card has the ability "このキャラクターをブレイクする場合、≪そのブレイクカードのコスト≫は(オーナーの)手札に戻る" (always / dest {cost: set, type: Break, onTarget: self, to: hand}).
- botBreakBackOk, in keepMove for the target of a Break card with cost ≥ 1: another character is not chosen while one of the bot's own legal targets is such a character (and passes the no-name rules of Revise#381). Exception: a Name-level Break card whose Name is already on the bot's field — it goes on that character. A Campaign deck's key cards (styles) keep their own rules.

Revise#388 (Pack) — Campaign: the deck "Dina" (proposal file aa-campaign-Dina.json, Strategy Default, Main Supporters 3465 Dina / 3459 Selen Elsie / 3680 Grimoire Servant, four Special Priority cards with conditions) → Hard; "E.G.O. Mayumi" → Hard (Pack's placement, not the 70% rule).
- Added as id dina-hard, name "Dina · Witch of the White Heavens" (the common-bot "Dina" stays in Easy). playstyle.bot = {custom, need: [3459], shy: [3465], first: 3680, stack, useIf: {0517: {nameOn: 3465, oppNoSkillMin: {shield, 2}}, 3199: {powerForBreak}}} → AACampaign.botStyle builds the engine style from it whatever the Strategy field says:
  need — no attack until these cards are on Controlled Characters; shy — a character with that card's Name attacks a player only when no character there can guard; first — no other Break card is declared while this one is in the hand, can be set and is not on the field yet; stack — Break cards with a Name go on the character that has that Name (now per Name; "top" — the Main Break last and on top — is a separate flag, used by E.G.O. Mayumi only); keep — every card of the playstyle lists stays in the hand instead of being charged away; useIf — a card is only declared when its condition holds.
- From Pack's descriptions, not built yet: Dina's effects used to keep an attacker alive; the deck check when Selen Elsie's draw runs; Perfect Harmony (3695) and The Pen Is Mightier Than the Sword (3471) by situation — the bot plays these two by its common scoring.
- Measured: 9 wins in 18 games against the other decks' common bots (Dina attacked 6 times in 18 games; White Heavens was set in 10 of them).

Revise#389 — card reports of 2026-11-11 (4).
- A3-25 3809: fieldMods listed [top, perms, inherited cards, lower cards] — an inherited card is also a lower card, so its "always" abilities were added twice (same id). Each card is taken once now. Affects every "inherit" card.
- A3-03 0514: "このキャラクターがプレイヤーにアタックした場合、このカードはオーナーの手札に戻る" was a trigger on the attack declaration. New battle event reachedPlayer (the attack was not guarded, emitted once before the damage check) and trigger event reachPlayer {self}; 0514 uses it. Other "…プレイヤーにアタックした場合" rules are unchanged.
- A3-24 3549 (Bind 2 + Bind 1 shown as Bind 3, reported on v4.94): fixed by Revise#372.
- A3-PR PR254 (reported on v4.94: "a card that can order an attack in place of another cannot pay the power when that card has none"): not changed — the card in the report only gives Offensive / Defensive, and the engine pays an attack cost from the attacker itself; Pack is asked which card / rule is meant.

Revise#390 (Pack) — the decks are attached to the account (src/js/08-account.js).
- aa-sync = {uid, hash} on the device: it follows that account; hash = the 10 slots when device and account were last the same. "Linked" = logged in, aa-sync.uid is this account, no merge pending.
- Linked: saveSlots (every deck change) → after 1.2 s the 10 slots are written to users/<uid>/slots (also when the page is hidden); the Account page shows "Your decks are kept in your account" with the last result. Save / Load still work: saving a slot to another account slot also puts that deck in the device's slot.
- At a login (or opening the site with a remembered login): same decks → linked. Linked before and only the account changed → the account's decks replace the device's. Linked before and only the device changed → saved to the account. A device with no cards in any slot → the account's decks are loaded. Otherwise (a first login with different decks, or both changed) → merge: nothing is copied and nothing is saved by itself; the Account page shows the notice with "Use the account's decks…" / "Use this device's decks…" (each with a confirmation that lists the 10 slots and what is replaced); Save / Load one deck or all decks work as before to bring the decks together first. Away from the Account page a toast says to open it.
- The Game Table reads the device's slots as before (they mirror the account once linked). After logging out the decks stay on the device.
- No new Firebase rule: users/<uid>/slots was already the user's own.

Revise#391 (Pack) — the common bot: "it puts every Character card on as a power card, so it cannot play its 2nd turn".
- botSetCharOk rule 1: on the bot's first turn (turn number ≤ the number of players) two Aggressive characters may wait in the Active Area, later one.
- botReserved(S, db, seat, except): the Character card of the hand that is kept — value 4 for Draw while Draw < 2, 4 for Charge while Charge < 2, 2 for any Draw / Charge, 1 for the Main Factor; the highest is kept. keepMove: charging that card from the hand is not a bot move. Rule 2 of botSetCharOk counts it out of the power cards that can charge a new character.
- The aim "2 Charge and 2 Draw" is in the choice of the kept card (and in Revise#385 for the card that is set).

Revise#392 (Pack's replay aa-replay-20261111-1620: Player vs "Dina · Witch of the White Heavens", v5.42) — the bot could not charge.
- Found by replaying it: from turn 4 the bot's hand was its reserved Character card (Revise#391) and cards of the playstyle lists / named Break cards. Each of those was "kept while another card is in the hand", and the reserved card was always in the hand — so no hand card could be charged at all. Its Active Characters (most of them came from damage checks, not from its own sets) stayed at 0 power.
- botProtected(S, db, seat): level 2 (never charged) = the reserved Character card + one Break card it plans to set (playstyle: the Main Break, then the Main Attackers; else the named Break card with the highest worth); level 1 (charged only when no free card is left) = one copy of each other named Break card and of each playstyle card; everything else, and every second copy, is free. botSetCharOk rule 2 counts only level 2 out of its supply.
- botChargeTarget(S, db, seat, legal): the Active Character that gets the power — the Aggressive "slot" (the oldest Aggressive ones: 1, on the first turn 2) is left alone while another character waits; among the others the one closest to its Mental, then the newest. botScored points every charge move for an Active Character at that target (the engine's list of moves offers most cards on one target only) and drops duplicates.
- botSetCharOk: while an Aggressive character may still be set (rule 1) and one is in the hand, the character for the Control Area waits — Aggressive first.
- Measured (2 mirror games per deck, common bot, own Main Phases from turn 5): Charge total Iaris 1.7 → 2.3, Mayumi 2.3 → 3.2, Dina 2.7 → 3.5; power on the field 5.7 → 6.3, 4.2 → 7.7, 4.8 → 5.7.

Revise#393 (Pack) — signed in: replace the local decks with the account's; auto-sync every deck. Replaces the merge step of Revise#390.
- syncOnLogin: same decks → linked. A fresh login, or the account differs from the last synced state → the account's 10 slots replace the device's (toast "Your account's decks were loaded"). Opening the site with a remembered login when only the device differs from the last synced state (edits that had not reached the account yet) → they are saved to the account. An account with no cards in any slot and a device with decks → the device's decks are saved to the account (nothing to replace them with).
- The merge notice and its two buttons are no longer shown (A.merge stays false). Auto-save (1.2 s after a change, and when the page is hidden) is unchanged.

Revise#394 (Pack's replays aa-replay-20261111-2254 / -2301, "the bot is stuck") — both: the bot (E.G.O. Mayumi) declares A3-25 3809, cancels, declares it again.
- First replay: after the declaration the game offered only Cancel (the card's cost depends on the target; no target could be paid). Second: two targets were legal, but the bot's own rules refused both (its playstyle keeps Mayumi cards on the Mayumi character).
- botScored: a declaration is not a move when, after it, every move left is Cancel or a move keepMove refuses. Table (t5-bot.js): after three cancels in a row the bot takes next / pass / no guard instead.

Revise#395 — card reports of 2026-11-11 (the 9 new ones).
- A4-05 0950: "≪あなたのパートナーのこのキャラクター≫はバインド2・チャージXを得る" → two always abilities with cond selfIs {named} (no Partner in v4; Pack: "implement as this Name-level Break"): Bind 2 and Charge X, X = stackNamedCards.
- A3-23 3357: always playerHit {replace, effect dmgUntilOne n "selfSe"} — damage checks until as many cards as this character's Mental have gone to the Damage Pile.
- A3-25 3691: trigger enter {self} → bindWeak: the owner chooses a character; noAttack / noGuard / noEffect / noPay on it while this card stays (until "source") with cond seBelowX {ch, x factorSum WIZ-DOM} (X counted whenever it is asked).
- A3-11 1743: new step forceGuardJoin — when a character is guarding already, the target joins that guard (as a Synchro join: Attack is added; each takes its own damage — the card says Attack and Defense are added).
- A3-17 2345: pickZone deck {Break, Arayashiki, nameHas 明王} up to 3, shown → hand; shuffle; the chosen character: Defense +3, untargetable {Project, Fast, exceptCard}, noDamage {mental}, noDamage {outside} until the end of the turn.
- Not done: A3-25 3660 (its cost is ignored by a condition on the target), A3-22 3203 (works from the Damage Pile when the deck runs out), A3-11 1711 (every effect costs X more). A3-12 1763: Infinity is given with each of the four サイキック女子高生 printings below it (also with another Nina card between them); the report needs the replay.

Revise#396 (Pack: "analyze the rule of how players act, then add it as parameters / conditions for the bot") — tools/bot_habits.js rooms.json.
- 35 rooms, 41 player seats, 274 player turns. By the player's own turn (1 / 2 / 3 / 4 / 5–6 / 7+): Character cards set 3.2 / 1.0 / 1.6 / 1.6 / 1.0 / 0.6 (Aggressive 2.8 of the 3.2); Break cards 0 / 0.4 / 0.9 / 1.3 / 1.0 / 0.8; power cards from the hand 3.0 / 1.6 / 1.9 / 2.9 / 3.3 / 3.7 — of them Character about half, Break about a quarter to a third, Fast 5–19%, Permanent 4–11%, Project 4–8%; end of the turn: Controlled 2 / 4 / 5 / 7 / 8 / 8, waiting Active 1 / 0 / 0 / 0 / 0 / 0, power 3 / 4 / 6 / 9 / 11 / 13, Charge 1 / 2 / 4 / 5 / 6 / 7, Draw 2 / 2 / 3 / 3 / 3 / 2; no Character card left in the hand in about 7 turns of 10; attacks 0 / 0 / 0.1 / 0.5 / 0.8 / 1.4.
- Guards (attacked with a character that could guard, 120 times): a guard would have lived — guarded 59%; every guard would have been defeated — guarded 40%.
- Bot (20-bot.js): botSetCharOk rewritten — setFirstTurn 3 / setPerTurn 2 Character cards a turn (counted from usedTurn); a card is set only when the free hand cards + the Charge left this turn cover what the waiting Active Characters and this card need (first turn: the one that needs most may wait); order Aggressive → Draw / Charge → Main Factor; the Break-card exception stays. botChargeTarget: the waiting character closest to its Mental (no Aggressive slot any more). botReserved: only while Draw < reserveUntilDraw (2). botAttackOk: not before its attackTurnMin-th (4th) own turn (a hit that can win, an Offensive attacker and a nearly empty deck are exempt as before). All four are limits (not varied by training).
- The common bot after it (10 bot-vs-bot games, own turn 1 / 2 / 3 / 4 / 5–6): Controlled 1 / 2–3 / 5 / 6 / 6, power 1–2 / 4 / 6 / 7 / 7–9, Charge 1 / 1–2 / 2–3 / 3 / 3–4 — closer to the players, still behind them from turn 4.

Revise#397 (Pack: "go for 50. change to 10 slots with 5 page may be easier") — v5.46.
- 03-deck.js: DECK_SLOTS 50, SLOT_PAGE 10, SLOT_PAGES 5, pageOf(i). #deckPage select beside #deckSlot (which lists the 10 slots of the open slot's page); a page change opens page*10 + deckSlot%10. Storage unchanged (aa-decks array, now 50 long; old 10-long arrays are padded).
- 08-account.js: slotsOf / applyLocal over 50; pushNow sends only changed slots (ref.update of users/<uid>/slots); Save / Load page: A.page + .acpages buttons on both sides; confirmation lists only used slots with their numbers.
- 06b-play-engine.js deckSlotOptions and the table lobby opt(): <optgroup> per page; pages 2–5 list only slots with cards. TB.deckSlots() returns 50. 06-template.js: Basic Deck slot chooser has page headings.
- Firebase: no rule change needed unless the rules limit the slot index under users/<uid>/slots.

Revise#398 (Pack: "i will move to cloudflare, please provide me the script and method") — v5.47.
- tools/img_site/make_images.py (+ cards.txt written by build.py: file id, number, name): downloads each picture from Drive (lh3 w1600, then thumbnail), writes aqa-img/s/<fid>.webp (short side 400, q78) and aqa-img/l/<fid>.webp (short side 1000, q82), _headers (CORS + 1-year cache), index.html, robots.txt. Resumable; failed.txt. 8,274 pictures → 16,548 files (Pages Free: 20,000 files, wrangler upload).
- assets/img-config.js (project file assets/img-config.js, stub when absent): window.AA_IMG_BASE. 01-core.js IMG_BASE, IMG.cdn / IMG.drive; IMG.thumb → cdn when set (w > 500 → l, else s). 07-app.js error chain: pictures site → Drive thumbnail → lh3 → placeholder. 04-export.js loadCorsImage tries the pictures site first. t1-app.js TB.img → pictures site, TB.img2 → Drive thumbnail when set.
- Upload: npx wrangler pages project create aqa-img --production-branch main; npx wrangler pages deploy aqa-img --project-name aqa-img --branch main.

Revise#399 — v5.48: assets/img-config.js set to https://aqa-img.pages.dev (Pack uploaded the pictures; deployment eab45406).

Revise#400 — v5.49 (Pack: "new problems have not been updated to Bug reports"): src/tickets.json AQ-005…AQ-017 from the two report files of 2026-11-11 (8 done, 5 open). From now on every card report gets a ticket when it is handled.

Revise#401 (Pack: "for cards whose root cause was Not implemented, let's implement them") — v5.50.
- A3-25 3660: card line → tCost [{sel:{named:false}, free}, {atMaxX:{factorSum:"Arayashiki"}, free}]; 10-query.js tCost rules accept atMaxX (target's at ≤ X). Target first, then the cost.
- A3-11 1711: "≪エフェクト全て≫は、宣言時に…追加のXコストを支払わなければ効果を発揮しない" → always mod {to all, effectCost add {x:{power:"self"}}} (the effect cannot be declared without the extra cost).
- A3-22 3203: 02-ops.js moveCard emits {e:"deckEmpty", seat} when the last card leaves a deck (stage play); 13-events.js trigger deckEmpty {you}; ability zones ["damage"] → A.candleOut / OPS.candleOutGo (Factor check, ask X characters among all on the field, removeChar to discard, then the card to discard).
- Engine test "Revise#401" (370 tests). tickets.json AQ-012 / 014 / 017 done.

Revise#402 (Pack, AQ-006: "the problem is in the system: [A3-12 1833] … if the attacking character has no power from the beginning, it cannot attack") — not repeated on v5.51: planBattle, candidates, declare + pay from the payFor character all work for an attacker / guard with 0 power cards. Engine test "Revise#402" added. Ticket stays open until Pack retries.
Revise#403 (Pack: "Remove separation of control area (front) to left-mid-right. Merge them to 1 area") — v5.51.
- t2-render.js: the Front row is one .chars[data-area=front] (list order of p.areas.front); one Sort button. table.css: .fsecs / .fsec removed.
- The engine keeps ch.at.sec and the sec field of moveChar / sortChars so older replays still run; the table no longer sends sec. sortChars {area: front, no sec} accepts the whole Front list (or the centre alone, as before).

Revise#404 (Pack: "at search card page, no need to separate char / break / fast / proj / perm anymore. Just put [+ N −]") — v5.52. 03-deck.js deckControlsHTML: − / N / + for every card (N = 0 and − disabled when not in the deck); autoCat(c) = card type, else catMemo, else Character. The details panel keeps the category label, Move to and Remove all once the card is in the deck.

Revise#405 — v5.53 (Pack): AQ-016 closed, a misuse (A4-PP PP187 used instead of A3-01 0018). tickets.json status "closed" → "Closed · not a bug"; the counter shows done · closed · open.

Revise#406–409 (Pack: report file 2026-11-12 11:38 — "recheck new problems, skip old; is there an easy logic to check whether a problem is old?") — v5.54.
- #406 A3-24 3429: checkCond belowName matches a card below by full title OR by Name. A3-25 3619 Resist: works in the tested battle (guard with the Permanent vs a Darklore attacker); AQ-019 open.
- #407 A3-25 3686 (rule from Pack): 14-battle.js battleDeclared — target.ch of another player (not a raid part) → b.charGuard, defender = its owner, step "guard"; planBattle guard: only b.target.ch; resolution: charGuard && !guard → damageChar {battle:false} from the attacker's side. Applies to attackChars / attackableBy for every card.
- #408 A3-25 3700: tCost rule {aimsAtYours, free}; target kind "card" allowed for the target-first cost; xOf tCost: free when the stack item of the targeted card targets a Project / Fast card owned by the user.
- #409 old or new: tickets.json "rid" = the report's id; build.py window.AA_TICKETS {rid: [ticket, status]}; report.js manager shows [AQ-xxx · status] or [NEW], buttons Tick new / Tick handled; tools/new_reports.py file.json lists reports without a ticket.
- Engine tests Revise#406 / #407 / #408 (374 tests).

Revise#410 (Pack: "make the bot not set a character to the Active Area if 2 or more already exist there") — v5.55. 20-bot.js botSetCharOk: characters of the seat with at.area "active" >= activeMax (2, a limit key, not trained) → false, before every other rule (also the Break exception and the first turn). Engine test added (375).

Revise#411 — Card milestone M5a part 1 (Pack: "continue card implementation until done") — v5.56. 7,985 / 8,283 automatic.
- 1102 (target: named card in your Damage Pile), 3131 (item target, A.itemToHand, tCost {oppItemCost}), 3768 / 2204 (A.stackSame: mods tagged stk = card title; tiers), 3766 (A.dmgBuyDown, in turn order), 3167 (A.deUpNameAlt; zone damage abilities with cond cardFactorMet: dmgReduce {mental 1} on your Controlled Characters, playerDmgCut {mentalOnly}), 2178 (mod attackCheckNull, once; card prop dmgStop in the damage check), 2436 (A.pileCardDamage — the card is chosen at resolution), 2451 (mod nextCardLess {n, types}: cost and Factor, used up by the declaration), 2730 (A.nameAndReveal — named at resolution), 3308 (A.reviveByDeck; pickZone sel.onlyIds).
- Left in Saga 3 Standard Project / Fast: 55 texts (forced attacks 1921 / 2838 / 3362, token characters 1633 / 2286 / 2694 / 3769, copy effects 0810 / 2840, cards kept face down 0804 / 3729 / 2947, and others).

Revise#412 — Card milestone M5a part 2 — v5.57. 7,993 / 8,283 automatic.
- 1352 / 2029 (A.riseBreak: onEnterPower n = X, optional mill), 2877 (delayed A.blastArea), 2914 (A.swapForBreak), 3163 (A.reviveTemp + S.delayed discard), 3400 (A.mostIconShield: noDamage {battle} + guardTaxVs 1 on the characters found at resolution), 3731 (modes with a leading "分類1つを指定する" line; pickIcon + A.iconShield), 2804 (costToIfNotOwn, A.zeroPowerBoost, capacity −X / charge X / −X/+X/+X). fastBreakOk accepts breakFast {icons}.

Revise#413 — Card milestone M5 part 3 — v5.58. 8,001 / 8,283 automatic.
- 3396 (sel permSameJpAsSrc; costTo hold + costAsPower), 3540 (A.revealSetTop), 3504 (mod dmgCharToControl in the damage check), 2693 (playIf bothBrokenNamed; A.duelStrip and its asks), 2802 (psel namedCtlMin; A.namedToActive), 3579 (A.allTutor).

Revise#414 — Card milestone M5 part 4 — v5.59. 8,006 / 8,283 automatic.
- A4-03 0413 (A.shiftFloor, fixed set at resolution), A4-02 0248 (A.typeReveal), A4-02 0312 (A.breakExchange), A4-EP EP511 (A.nextHitMill: playerHit {once} — runHits ends once-mods), A4-02 0280 (mod guardStrip read in AA4.guardHit; A.guardStripT).

Revise#415 — Card milestone M5 part 5 — v5.60. 8,010 / 8,283 automatic.
- cond oppDamageMin; EX0148 (delayed discard with if), EX0131 (fastIfTName from "…ファストカードのタイミングで“X”を目標に使用宣言可能"; A.sameIconBoost), EX0184 (fillPowerT ifTName; A.banSameJp → ban {name}), EX0156 (token_body on "このカードのコスト" with each: true; A.discardTokens delayed at main). EX0184 selfShield with "あなたの対戦相手の使用した" read as the plain one.

Revise#416 — Card milestone M5 part 6 — v5.61. 8,013 / 8,283 automatic.
- 3507 (A.aggroReveal), EX0158 (banFastCost n 0; ban {decl set} on the opponents if “アラクネ” is controlled; Infinity with oppDamageMin 8), EX0166 (sel srcJpMin: characters with ≥ N cards of that title in effect).

Revise#417 — Card milestone M5 part 7 — v5.62. 8,019 / 8,283 automatic.
- PR114 (its second sentence is what the engine already does), 0922 / 0850 (Partner clauses: never true; 0850 costLessIf notFirst), 0710 (delayed A.discardUnlessIcon), PP337 (mod playerHit on all characters, damage to self n X = the attack's damage), PR151 (mod guardHit n X = the target's Attack).
- tests/table_ui.js: the motion check waits for the glide to end (up to 2.9 s) — it failed 3 times today on the slow test machine.

Revise#418 — Card milestone M5 part 8 — v5.63. 8,025 / 8,283 automatic. Partner = "your Name-level character" (Pack's reading for A4-05 0950) on every card:
- 0806 / 0842 / 0878 / 0914: the Bind 2 · Charge X line with its X sentence attached; 0914's "ファストカードのタイミングでブレイク可能" line with the X sentence attached.
- 0922: extra mods with ifTOwnNamed (16-effects runner); PP112 / PP120: Penetrate if selfIs named; 0850: costLessIf cond any [notFirst, a named Controlled Character].

Revise#419 — Card milestone M5 part 9 — v5.64. 8,031 / 8,283 automatic.
- 0711 (A.classRally / classRallyGo), 0774 (A.secondFactionSet), EX0326 / EX0484 (A.nameRetrieve: names of the series found in the player's piles; ViVid = works "nanoha"), EX810 (sel printedSkill + tag), PR140 (cond oppHandAtLimit → costLessIf; the ability returns [] as a card property).
- tools: $S/mansent.py lists every sentence still done by hand (495 on 2026-11-12), and the cards with only one such sentence.

Revise#420 — Card milestone M5 part 10 — v5.65. 8,035 / 8,283 automatic.
- 0446 (A.mutualHit), EX0311 (A.pickDamagePlus), EX916 (trigger enter → A.cancelPicked), 0609 (cond selfFighting; at +10 while attacking or in a battle, de −5 and the opponent's −5/−5/−5 only in a battle).
- Open question for Pack (Q): 0609's Defense −5 during the damage check of an attack on a player — the engine defeats a character at Defense 0.

Revise#421 — Card milestone M5 part 11 — v5.66. 8,040 / 8,283 automatic.
- EP421 (trigger killed {anyDamage, hadPower}; the defeated event carries stats.pw), EX0102 (trigger damaged byThisAny with cond selfIs name → noPay until main on evCh), 0284 / PV052 / 0814 (card prop tFactorLess {sel, n}: planDeclaration narrows the target spec when the Factor is only met with it; tCost add −2 for 0284; sel ownerMoreCtl).
- Fix: plan.fLess (nextCardLess n + tFactorLess n) is kept on the draft and the stack item; the Factor check at resolution subtracts it (2451 could fail there).

Revise#422 — Card milestone M5 part 12 — v5.67. 8,043 / 8,283 automatic.
- EXPR044 / 3622 part 1 (noDamage {battle, fromFactorLeSelf[, fromBroken]}: the top cards' required Factor totals), 3088 (untargetable from Project / Fast / Effect; other cards' abilities not blocked), 0416 (A.pileTiers: 10+ tutor, 20+ effDeclPick {freeCost, ignoreFactor} on the faction's hand cards).

Revise#423 (Pack: "Simplified cards: yes, go back to partly" · "A4-04 0609, calculate when the damage is already dealt in battle") — v5.68.
- rules_compile.py SIMPLIFIED: (a piece of the card text, what differs). compile_card turns an "auto" card that matches into "partial", with c.simplified and the note in manualText. 14 cards. Rule from now on: a card with a clause left out or a choice made later than printed stays "partial".
- 0609: no code change (at +10 while attacking or in a battle; de −5 and the opponent's −5/−5/−5 in a battle only).
- tests: the M5 status checks expect "partial" for cards with c.simplified.

Revise#424 (Pack: "at Export of Deck Builder, I want last function as Print Preview — select cards, arrange into actual A4, each card as many times as in the deck, 59 × 86 mm, optimise the size, print to .pdf or .png") — v5.69.
- 04-export.js: third format button "Print Preview" (this deck only) → #fx-print. PRINT {cw 59, ch 86, a4, pick, layout p | l, dpi 300 | 200}. printLayouts(): portrait 3 × 3, landscape 5 × 2. makePrintPages: pictures from the pictures site (l/…webp), lh3 or Drive (CORS), cover-fit, landscape pictures rotated; cut lines + marks; a name tile when a picture is missing. One canvas per page → PNG (pngWithDpi adds pHYs) and JPEG; printPdf() writes a PDF 1.4 with one DCTDecode image per A4 page (no library).
- tests/test_site.py: three checks (list, page count, PDF header / PNG pHYs).

Revise#425 (Pack: "please make print available for only person who logged-in") — v5.70.
- 08-account.js: AAAccount.state() → "in" | "out" | "wait" (remembered login still being checked).
- 04-export.js: openPrint shows a login notice (#prGate, #prLogin → Account page) unless state is "in"; "wait" is polled up to 10 s; makePrintPages refuses too. Client-side gate only.
- tests: test_site.py (notice, no pages without login), account_ui.js (state after login / logout).

Revise#426 (Pack: "print function, leave margin between card 1mm; also, don't crop the card picture" · "remove landscape") — v5.71.
- 04-export.js: PRINT.gap = 1 (mm). printLayouts() → portrait only, 3 × 3, margins 15.5 / 18.5 mm (5 × 2 landscape would need 299 mm). Pictures are contain-fitted (Math.min), not cover. Cut lines: one outline per card + margin marks. The Layout select is gone (#prLayNote shows the layout).
- tests/test_site.py: layout check.

Revise#427 (Pack: "Please build Manual into a Page. Make it accessible from Home Page") — v5.72.
- tools/manual/tpl.py (page template: bright starry sky, rulebook-style chapters, EN / TH switch) + tools/manual/manual.py (the text; make(out, ver, date)). build.py writes dist/…/manual.html and copies assets/manual/ (cover, contents picture, three screenshots) to manual/.
- src/index.html: Home → a#homeManual (href manual.html) under "How to use". css: .hmanual.
- tests/test_site.py: link, page, Thai switch, back link.

Revise#428 (Pack, report on A3-25 3686: "make it a menu like [targetting attack] and let user choose the card on field instead") — v5.72, ticket AQ-022.
- t3-input.js clickChar: attack candidates with target.ch are folded into one menu item "Targeting attack — choose a character on the field" → ui.sel = {kind: "atkChar", ch}. A click on a blue character sends that candidate (several Boost variants → a small menu). Other clicks keep the mode; Cancel = data-act unsel.
- t2-render.js ctx(): atkChar → r.tgt gets "ch:<id>" of every attackable character; hint #atkCharHint.
- UI only: the engine and the candidates are unchanged. tests/target_attack_ui.js.
