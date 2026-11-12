# Bilingual rules guide for Aquarian Age Helper.
# Written as a guide in our own words, organised by the chapters of the official
# rulebook (Ver1.1, ©BROCCOLI) and the Partner System trial rules Ver.1.1.
# Each section: (id, jp_title, en_title, page_ref, [blocks]); each block is (jp_html, en_html).
# A block whose jp starts with "!" is rendered as a highlighted key-rule box.

S = []
def sec(id, jp, en, pg, *blocks): S.append((id, jp, en, pg, list(blocks)))

sec("intro","はじめに","Introduction","p.2–6",
 ("<p>アクエリアンエイジは、カードを集めてデッキを作り、対戦相手と戦うトレーディングカードゲームです。プレイヤーは<b>マインドブレイカー</b>となり、味方にしたキャラクターと協力して相手のマインドブレイカーを倒します。</p>",
  "<p>Aquarian Age is a trading card game: you collect cards, build a deck and battle opponents. Each player is a <b>Mind Breaker</b> who recruits characters and fights alongside them to defeat the other Mind Breakers.</p>"),
 ("<p>世界には6つの勢力があります。東方の霊力者連盟<b>阿羅耶識</b>、西洋の魔術結社<b>WIZ-DOM</b>、異種族の軍団<b>ダークロア</b>、超能力者の新勢力<b>E.G.O.</b>、宇宙からの侵略者<b>イレイザー</b>、異次元から来た<b>極星帝国</b>です。</p>",
  "<p>The world has six factions: <b>Arayashiki</b> (Eastern spiritualists), <b>WIZ-DOM</b> (a Western society of magicians), <b>Darklore</b> (an army of ancient non-human races), <b>E.G.O.</b> (a new generation of psychics), <b>Eraser</b> (alien invaders) and the <b>Polestar Empire</b> (invaders from another dimension).</p>"),
 ("!ルールブックとカードの文章が食い違うときは、常にカードの文章が優先されます。",
  "!If the rulebook and a card's text disagree, the card's text always wins."),
)

sec("goal","ゲームの目的・準備・勝敗","Goal, setup and winning","Chapter 3 · p.7",
 ("<p><b>必要なもの：</b>対戦相手（2人以上で遊ぶゲームです。1人用のソロプレイルールもあります）と、1人40〜60枚のデッキ。</p>",
  "<p><b>You need:</b> at least one opponent (the game is for 2 or more players; there is also a solo mode) and a deck of 40–60 cards each.</p>"),
 ("!同じ名称のカードは、1つのデッキに4枚までしか入れられません。",
  "!A deck may contain at most 4 cards with the same name."),
 ("<p><b>敗北条件</b>（どちらかを満たすとゲームから除外されます）</p><ol><li>ダメージ置き場のカードが10枚以上になった。</li><li>デッキが0枚の状態で、デッキからカードを引かなければならなくなった。</li></ol><p>最後まで残ったプレイヤーの勝ちです。全員が同時に除外された場合は引き分けです。</p>",
  "<p><b>How you lose</b> (meeting either condition removes you from the game)</p><ol><li>Your damage zone holds 10 or more cards.</li><li>You have to draw from your deck while it is empty.</li></ol><p>The last player remaining wins. If everyone is removed at the same time, the game is a draw.</p>"),
)

sec("space","ゲームスペース","The play area","p.8–9",
 ("<dl class='terms'><dt>勢力エリア</dt><dd>まだ仲間になっていないキャラクター（勢力キャラクター）を置く場所。ここのキャラクターを支配すると味方になります。</dd><dt>支配エリア</dt><dd>味方になったキャラクター（支配キャラクター）を置く場所。</dd><dt>プロジェクト・ファストカード置き場</dt><dd>使い捨てのカードを効果が終わるまで一時的に置く場所。</dd><dt>テリトリー</dt><dd>上の3つ（勢力エリア・支配エリア・P/F置き場）をまとめた呼び名。</dd><dt>場</dt><dd>全プレイヤーのテリトリーを合わせたもの。ダメージ置き場・デッキ置き場・捨て札置き場・手札は場に含まれません。</dd><dt>ダメージ置き場</dt><dd>ダメージを受けたときにカードを置く場所。枚数がダメージ量です。</dd><dt>デッキ置き場</dt><dd>デッキを置く場所。</dd><dt>捨て札置き場</dt><dd>使い終わったカードを表向きに重ねる場所。</dd><dt>手札</dt><dd>デッキから引いたカード。相手に見えないように持ちます。</dd></dl>",
  "<dl class='terms'><dt>Faction area</dt><dd>Holds characters not yet on your side (faction characters). Dominating one brings it over to you.</dd><dt>Dominion area</dt><dd>Holds characters fighting for you (dominated characters).</dd><dt>Project / Fast card zone</dt><dd>Where one-shot cards sit while their effect lasts.</dd><dt>Territory</dt><dd>Your faction area, dominion area and Project/Fast zone together.</dd><dt>Field</dt><dd>All players' territories together. The damage zone, deck, discard pile and hand are <em>not</em> on the field.</dd><dt>Damage zone</dt><dd>Cards placed here when you take damage; the number of cards is your damage.</dd><dt>Deck zone</dt><dd>Where your deck sits.</dd><dt>Discard pile</dt><dd>Used cards go here face up, on top.</dd><dt>Hand</dt><dd>Cards drawn from your deck, kept hidden from opponents.</dd></dl>"),
)

sec("cards","カードの種類と勢力","Card types and factions","Chapter 4 · p.10–15",
 ("<p>カードは5種類：<b>キャラクター</b>・<b>ブレイク</b>・<b>パーマネント</b>・<b>プロジェクト</b>・<b>ファスト</b>。それぞれ6つの勢力のどれかに属し、勢力ごとに色が決まっています（E.G.O.＝白、ダークロア＝緑、阿羅耶識＝赤、極星帝国＝黄、WIZ-DOM＝青、イレイザー＝黒）。</p>",
  "<p>There are five card types: <b>Character</b>, <b>Break</b>, <b>Permanent</b>, <b>Project</b> and <b>Fast</b>. Each card belongs to one of the six factions, shown by colour (E.G.O. white, Darklore green, Arayashiki red, Polestar Empire yellow, WIZ-DOM blue, Eraser black).</p>"),
 ("<p><b>キャラクターカード</b>：一緒に戦うキャラクター。<b>精神力</b>（セットできるパワーカードの上限）、<b>攻撃力</b>（与えるダメージ）、<b>耐久力</b>（耐えられるダメージ）を持ちます。手札から出すだけで使え、出したら基本的に場に残ります。</p>",
  "<p><b>Character card</b>: a character who fights with you. It has <b>Mental power</b> (精神力, the most power cards it can hold), <b>Attack</b> (damage it deals) and <b>Defense</b> (耐久力, damage it can withstand). Characters are played straight from hand and normally stay on the field.</p>"),
 ("<p><b>ブレイクカード</b>：キャラクターが成長・覚醒した姿。同じ<b>分類アイコン</b>を持つキャラクターの上に重ねて使います。重ねると元のキャラクターの能力はすべて消え、ブレイクカードのデータに置き換わります。何枚重ねても1人のキャラクターです。</p>",
  "<p><b>Break card</b>: a character grown or awakened. It is placed on top of a character that shares a <b>class icon</b>. The original character's abilities are all replaced by the Break card's. However many are stacked, it still counts as one character.</p>"),
 ("<p><b>パーマネントカード</b>：アイテムや特殊な状態。自分の支配エリアのキャラクターに装備させ、精神力・攻撃力・耐久力を修正します。<b>キャラクター1人につき1枚まで</b>。<br><b>プロジェクトカード</b>：大規模な儀式や作戦。自分のメインフェイズに使う使い捨てカード。<br><b>ファストカード</b>：魔法や超能力など。<b>誰のターンでも</b>メインフェイズと勢力フェイズに使える使い捨てカード。</p>",
  "<p><b>Permanent card</b>: an item or special state. Attach it to a character in your dominion area to modify its mental power, attack and defense. <b>One per character.</b><br><b>Project card</b>: a large ritual or operation; a one-shot card used in your own main phase.<br><b>Fast card</b>: magic, psychic powers and the like; a one-shot card usable in the main phase and faction phase of <b>any player's turn</b>.</p>"),
 ("<p><b>カードの読み方</b>：“ ”＝キャラクターの個人名（<b>ネーム</b>）／《 》＝効果の対象／【 】＝ブレイク条件／X＝状況やプレイヤーの選択で決まる数／パワー＝そのキャラクターにセットされたパワーカードの枚数。</p>",
  "<p><b>Reading card text</b>: “ ” = a character's personal <b>name</b> / 《 》 = what the effect targets / 【 】 = a break condition / X = a number set by the situation or chosen by the player / Power = how many power cards are set on that character.</p>"),
 ("<p><b>属性アイコン</b>（プロジェクト・ファスト）：左下が効果範囲（<b>目標</b>＝対象を1つ選ぶ／<b>範囲</b>＝条件に合う全てに効果）、右下が持続時間（<b>瞬間</b>＝すぐ終わって捨て札／<b>持続</b>＝決められた間続く）。「目標の〜」と書かれたテキストだけが目標を指定します。「目標にならない」ものは目標指定のテキストを受けませんが、目標を指定しない効果は受けます。</p>",
  "<p><b>Attribute icons</b> (Project and Fast): bottom-left shows scope (<b>Target</b> = pick one / <b>Area</b> = affects everything that qualifies), bottom-right shows duration (<b>Instant</b> = resolves and is discarded / <b>Continuous</b> = lasts a set time). Only text that says “target …” targets. Something that “cannot be targeted” ignores targeting text but is still hit by non-targeting effects.</p>"),
)

sec("power","パワーカードとカードの使い方","Power cards and paying for cards","p.16–18",
 ("<p><b>パワーカード</b>はキャラクターの精神力・エネルギーです。手札のどのカードでも<b>裏返して</b>キャラクターの下に重ねればパワーカードになります（これを<b>セット</b>といいます）。キャラクターがアタックしたり、他のカードを使うにはパワーカードを消費します。</p>",
  "<p><b>Power cards</b> are a character's mental energy. Any card from your hand becomes a power card when placed <b>face down</b> under a character (this is called <b>setting</b> it). Attacking and playing other cards spends power cards.</p>"),
 ("<p><b>コスト</b>：カードの左上か右上の丸数字。同じ枚数のパワーカードを<b>自分の支配エリアのキャラクター</b>から捨て札して支払います。複数のキャラクターから少しずつ払っても構いません。カードが使えなかった場合も、払ったコストは戻りません。</p>",
  "<p><b>Cost</b>: the circled number at the card's top left or right. Pay it by discarding that many power cards from <b>characters in your dominion area</b>; you may split it across several characters. Cost is not refunded even if the card fails.</p>"),
 ("<p><b>必要ファクター</b>：コストの横の勢力マーク。同じ勢力の支配キャラクターが、マークの数<b>以上</b>いれば条件を満たします。満たしていればカードの使用は成功、満たしていなければ失敗して効果を出さずに捨て札になります。必要ファクターは使うときだけ必要で、その後キャラクターが減っても出したカードは残ります。</p>",
  "<p><b>Required factor</b>: the faction marks next to the cost. You meet it if you dominate <b>at least</b> that many characters of that faction. If met, the card works; if not, it fails and is discarded with no effect. The factor is only checked when you play the card—losing characters later does not remove it.</p>"),
 ("<p><b>キャラクターカード</b>のセットにはコストも必要ファクターも不要です。まず勢力エリアに置き、パワーカードをセットして支配すると支配エリアに移ります。<br><b>ブレイク</b>：対象キャラクターが場にいて、ブレイクカードと同じ分類アイコンを持っていること。<b>パーマネント</b>：対象が自分の支配エリアにいること。</p>",
  "<p><b>Character cards</b> need no cost or factor. They go to your faction area first, then move to your dominion area once you dominate them with power cards.<br><b>Break</b> needs a target character on the field that shares a class icon with the Break card. <b>Permanent</b> needs a target in your own dominion area.</p>"),
 ("!「キャラクター」とは、1枚のキャラクターカードを土台にしたまとまり（重ねたブレイクカードを含む）のことです。パーマネントカードとパワーカードはキャラクターに含まれません。",
  "!A “character” is the stack built on one character card, including any Break cards on top. Permanent cards and power cards are not part of the character."),
)

sec("flow","ゲームの進めかた","Playing the game","Chapter 5 · p.19–31",
 ("<p><b>準備</b>：①自分のデッキをシャッフルして相手に渡す ②渡されたデッキをシャッフルして返す ③デッキをデッキ置き場に置く ④ジャンケンなどで先攻を決める ⑤全員が7枚引く。<br><b>引き直し</b>：先攻ではないプレイヤーは1回だけ、手札を全てデッキに戻し、相手にシャッフルしてもらってから7枚引き直せます。</p>",
  "<p><b>Setup</b>: ① shuffle your deck and hand it to an opponent ② they shuffle and return it ③ place it in your deck zone ④ decide who goes first (rock-paper-scissors etc.) ⑤ everyone draws 7.<br><b>Mulligan</b>: any player who is not going first may, once, return their whole hand to the deck, have an opponent shuffle it, and draw 7 again.</p>"),
 ("<p><b>ターンの流れ</b>：ドロー → 勢力 → メイン → パワーカード → ディスカード の5フェイズ。決着がつくまで交互にターンを行います。</p>",
  "<p><b>Turn order</b>: Draw → Faction → Main → Power card → Discard. Players take turns until the game is decided.</p>"),
 ("<ol class='phase'><li><b>ドローフェイズ</b>：デッキの一番上から1枚引く。<b>先攻の最初のターンだけはドローしません。</b>「ドロー±X」を持つ支配キャラクターがいると枚数が増減します。</li><li><b>勢力フェイズ</b>：自分の勢力エリアのアクティブキャラクターが▼を持っていれば、あなたにアタックしてきます（詳しくは「勢力フェイズと勢力チェック」）。ファストカードとエフェクトも使えます。</li><li><b>メインフェイズ</b>：次の行動を好きな順番で何度でも：キャラクター／ブレイク／パーマネントのセット、プロジェクト・ファストカードの使用、エフェクトの使用、アタック。</li><li><b>パワーカードフェイズ</b>：手札をパワーカードとして、自分の支配キャラクターか、自分の勢力エリアのアクティブキャラクターにセットできます。1人あたり精神力の枚数まで。フェイズ終了時、精神力と同じ枚数のパワーカードを持つアクティブキャラクターは<b>支配</b>され、支配エリアに移ります（1ターンにつき1つの勢力パーティから1人まで）。</li><li><b>ディスカードフェイズ</b>：手札が手札上限（通常7枚）を超えていれば、上限になるまで捨てます。</li></ol>",
  "<ol class='phase'><li><b>Draw phase</b>: draw the top card of your deck. <b>The first player skips this on their very first turn.</b> Dominated characters with “Draw ±X” change the number.</li><li><b>Faction phase</b>: any active character in your faction area with ▼ attacks you (see “Faction phase and faction check”). You may also use Fast cards and effects.</li><li><b>Main phase</b>: do any of these, in any order, as often as you like: set a Character / Break / Permanent, use a Project or Fast card, use an effect, attack.</li><li><b>Power card phase</b>: set cards from hand as power cards on your dominated characters or on the active characters in your own faction area, up to each character's mental power. When the phase ends, an active character holding as many power cards as its mental power is <b>dominated</b> and moves to your dominion area (one per faction party per turn).</li><li><b>Discard phase</b>: if your hand is over the hand limit (normally 7), discard down to it.</li></ol>"),
 ("<p><b>相手のターンにできること</b>：自分を目標にしたアタックへの<b>ガード</b>、勢力フェイズとメインフェイズでの<b>ファストカード</b>と<b>エフェクト</b>の使用（割り込む場合はレスポンスとして）。</p>",
  "<p><b>On an opponent's turn</b> you can <b>guard</b> an attack aimed at you, and use <b>Fast cards</b> and <b>effects</b> during their faction and main phases (as a response if you are interrupting).</p>"),
 ("!精神力0のキャラクターは、すでに条件を満たしているものとして、パワーカードフェイズ終了時に支配されます。ただしパワーカードを払えないので、アタックもガードもできません。",
  "!A character with 0 mental power counts as already fully powered, so it is dominated at the end of the power card phase—but with no power cards it cannot attack or guard."),
)

sec("set","カードのセットと使用の詳細","Setting and using cards in detail","p.24–29",
 ("<p><b>キャラクターのセット</b>：自分の勢力エリアの、その勢力の場所に置きます。並び順は E.G.O.・阿羅耶識・WIZ-DOM・ダークロア・極星帝国・イレイザー。同じ勢力がすでにいれば、能力値と名前が見えるようにずらして上に重ねます。この山を<b>勢力パーティ</b>、一番上を<b>アクティブキャラクター</b>と呼びます。</p>",
  "<p><b>Setting a character</b>: place it in your faction area in its faction's slot, ordered E.G.O., Arayashiki, WIZ-DOM, Darklore, Polestar Empire, Eraser. If that faction already has characters, overlap the new one on top so stats and names stay visible. Each pile is a <b>faction party</b>; the top card is the <b>active character</b>.</p>"),
 ("<p><b>ブレイク</b>（ブレイクカードをセットすること）：対象は同じ分類アイコンを1つでも持つキャラクター。<b>相手のテリトリーのキャラクター</b>をブレイクする場合は、さらに<b>パワーカードが1枚もセットされていない</b>ことが条件です。元のデータが見えないよう完全に重ねます。自分の勢力エリアのキャラクターをブレイクすると支配エリアへ移動。相手のキャラクターをブレイクすると、そのキャラクターとセットされたカードは全て捨て札され、使ったブレイクカードだけが自分の支配エリアに置かれます。</p>",
  "<p><b>Breaking</b> (setting a Break card): the target must share at least one class icon. To break a character in <b>an opponent's territory</b> it must also have <b>no power cards</b>. Cover the original completely. Breaking a character in your own faction area moves it to your dominion area. Breaking an opponent's character discards it and everything set on it; only your Break card goes to your dominion area.</p>"),
 ("<p><b>ネームレベルキャラクター</b>：カード名に“ ”で囲まれた個人名（ネーム）があるキャラクター。</p><ul><li>同じネームのキャラクターは場に1人しか存在できません。後から出ようとしたカードは出せず、持ち主のダメージ置き場へ。</li><li>ネームレベルキャラクターをブレイクできるのは、同じネームを持つブレイクカードだけ。</li><li>バトルなどで捨て札になるとき、ネームを持つカードはダメージ置き場に置かれます（ネームのないカード・パーマネント・パワーカードは捨て札置き場へ）。</li></ul>",
  "<p><b>Name-level characters</b> have a personal name in “ ” in the card name.</p><ul><li>Only one character with a given name can exist on the field. A later card with that name cannot enter and goes to its owner's damage zone.</li><li>A name-level character can only be broken by a Break card with the same name.</li><li>When one is discarded (by battle etc.), its cards that carry a name go to the damage zone; nameless cards, permanents and power cards go to the discard pile.</li></ul>"),
 ("<p><b>パーマネントのセット</b>：コストと必要ファクターを満たせば自分の支配キャラクターにセット（1人1枚）。効果はそのキャラクターの能力として扱います。<br><b>プロジェクト／ファストの使用</b>：コストと必要ファクターを満たせば使用でき、効果時間が終わるまでP/F置き場に置き、その後捨て札します。</p>",
  "<p><b>Setting a permanent</b>: pay cost and factor, then attach it to one of your dominated characters (one each). Its effects count as that character's abilities.<br><b>Using Project / Fast cards</b>: pay cost and factor; the card sits in the Project/Fast zone until its effect ends, then is discarded.</p>"),
 ("<p><b>エフェクト</b>：丸数字やⓧで始まるテキスト。自分の支配キャラクターのエフェクトを、そのキャラクター自身から丸数字と同じ枚数のパワーカードを払って使います（エフェクトコスト）。自分と相手の勢力フェイズ・メインフェイズに使え、特に記述がなければ持続時間は瞬間です。</p>",
  "<p><b>Effects</b> are text starting with a circled number or circled X. Use one on your dominated character by paying that many power cards from <b>that same character</b> (the effect cost). Usable in your and your opponents' faction and main phases; unless stated otherwise an effect is instant.</p>"),
)

sec("battle","アタックとバトル","Attacks and battle","Chapter 6 · p.29–39",
 ("<p><b>アタック宣言</b>：自分の支配キャラクターを1人選び、そのキャラクターからパワーカード1枚（アタックコスト）を払います。目標は自分以外のプレイヤー1人か、自分の勢力エリアのアクティブキャラクターです。</p>",
  "<p><b>Declaring an attack</b>: choose one of your dominated characters and pay one power card from it (the attack cost). The target is another player, or an active character in your own faction area.</p>"),
 ("<p><b>ガード</b>：プレイヤーがアタックの目標になったら、自分の支配キャラクター1人からパワーカード1枚（ガードコスト）を払ってガード宣言できます。ガードするとバトル、しなければプレイヤーがダメージを受けます。アクティブキャラクターへのアタックはガードできず、そのままバトルになります。</p>",
  "<p><b>Guarding</b>: when you are the target, you may pay one power card from one of your dominated characters (the guard cost) to guard. A guard starts a battle; no guard means you take the damage. An attack on an active character cannot be guarded and goes straight to battle.</p>"),
 ("<p><b>バトル</b>：参加キャラクターは<b>同時に</b>、自分の攻撃力と同じダメージを相手に与えます。受けたダメージが<b>耐久力以上</b>のキャラクターは、セットされたカードごと捨て札されます。耐えたキャラクターのダメージはそのまま消えます（通常ダメージは累積しません）。</p>",
  "<p><b>Battle</b>: the characters deal damage equal to their attack <b>at the same time</b>. A character that takes damage <b>equal to or greater than its defense</b> is discarded along with everything set on it. If it survives, the damage simply goes away (normal damage does not build up).</p>"),
 ("<p><b>精神攻撃</b>：攻撃力が (2) のようにカッコ付きのキャラクター。相手の<b>パワーカードを減らす</b>攻撃です。精神ダメージを受けた支配キャラクターは同じ枚数のパワーカードを捨て札し、捨てきれなければキャラクター自身が捨て札になります。<b>勢力キャラクター</b>が精神ダメージを受けた場合は、精神ダメージと精神力を比べ、ダメージが<b>精神力以上</b>なら捨て札（パワーカードは減りません）。精神ダメージと通常ダメージを同時に受けた場合は別々に判定し、どちらか一方でも耐えられなければ捨て札です。</p>",
  "<p><b>Mental attack</b>: an attack value in brackets, like (2). It <b>strips power cards</b>. A dominated character hit by mental damage discards that many power cards; if it cannot discard enough, the character itself is discarded. A <b>faction character</b> instead compares the mental damage with its mental power and is discarded if the damage is <b>equal or greater</b> (its power cards are not removed). If a character takes mental and normal damage together, check each separately—failing either one discards it.</p>"),
 ("<p><b>プレイヤーへのダメージ（ダメージ判定）</b>：ダメージ1点ごとにデッキの一番上を1枚めくり、キャラクターカードなら勢力エリアにセット、それ以外ならダメージ置き場に置きます。ネームを持つキャラクターカードは、同じネームが場にいればダメージ置き場、いなければ勢力エリアへ。通常攻撃力と精神攻撃力を両方持つキャラクターからは、その合計のダメージを受けます。プレイヤーへの精神ダメージも同じく枚数分めくります。</p>",
  "<p><b>Damage to a player (damage check)</b>: for each point, reveal the top card of your deck. A character card is set in your faction area; anything else goes to your damage zone. A named character card goes to the damage zone if a character with that name is already on the field, otherwise to the faction area. An attacker with both normal and mental attack deals the total. Mental damage to a player is resolved the same way, one card per point.</p>"),
)

sec("faction","勢力フェイズと勢力チェック","Faction phase and faction check","Chapter 7 · p.40–41",
 ("<p>勢力フェイズでは、勢力パーティを<b>E.G.O. → 阿羅耶識 → WIZ-DOM → ダークロア → 極星帝国 → イレイザー</b>の順に1つずつ確認します（勢力チェック）。</p><ol><li>その勢力パーティのアクティブキャラクターを確認。</li><li>▼（アグレッシブ）を持っていれば、チェック終了後に<b>あなたを目標にアタック宣言</b>します。持っていなければアタックはありません。</li><li>アタックを解決（このアタックにアタックコストは不要）。あなたは支配キャラクターでガードできます。</li><li>次の勢力へ。</li></ol>",
  "<p>In the faction phase you check each faction party in the order <b>E.G.O. → Arayashiki → WIZ-DOM → Darklore → Polestar Empire → Eraser</b> (the faction check).</p><ol><li>Look at that party's active character.</li><li>If it has ▼ (Aggressive), it <b>declares an attack on you</b> after the check. Otherwise nothing happens.</li><li>Resolve the attack (no attack cost is paid). You may guard with a dominated character.</li><li>Move on to the next faction.</li></ol>"),
 ("!チェックが終わった勢力に、ダメージ判定などで新しいキャラクターが出ても、さかのぼってチェックすることはありません。",
  "!If damage puts a new character into a faction that has already been checked, you do not go back and check it again."),
)

sec("response","レスポンス","Responses","Chapter 8 · p.42–46",
 ("<p>相手の行動に割り込んで先に行動することを<b>レスポンス</b>といいます。自分と相手の<b>勢力フェイズとメインフェイズ</b>に行えます。</p><p><b>レスポンスできる宣言</b>：カードの使用宣言、エフェクトの使用宣言、アタック宣言、ガード宣言、フェイズの終了宣言、アクティブキャラクターがアタックしない宣言。<br><b>レスポンスに使える行動</b>：ファストカードの使用、エフェクトの使用、ガード宣言。</p>",
  "<p>A <b>response</b> interrupts another action so yours happens first. Responses are allowed in your own and opponents' <b>faction and main phases</b>.</p><p><b>You can respond to</b>: declaring a card, declaring an effect, declaring an attack, declaring a guard, ending a phase, and an active character declaring it will not attack.<br><b>You can respond with</b>: a Fast card, an effect, or a guard.</p>"),
 ("<p><b>ガード宣言</b>は、自分を目標にしたアタック宣言への<b>直接の</b>レスポンスとしてのみ行えます。アタック宣言に対してガード以外のレスポンスをしてしまうと、もうガードはできません（ガードした後に他のレスポンスをするのは可）。</p>",
  "<p>A <b>guard</b> can only be the <b>direct</b> response to an attack on you. If you respond to an attack with anything else first, you can no longer guard it (guarding first and then responding further is fine).</p>"),
 ("<p><b>解決</b>：誰もレスポンスしなくなったら解決に入り、<b>最後に宣言されたものから順に</b>効果を出します（A→B→Cと宣言したら C→B→A）。条件を満たさなくなった宣言は打ち消され、払ったパワーカードは戻らず、使おうとしたカードは捨て札です。解決中は新たな宣言はできません。</p><p><b>優先権</b>：同時に宣言したい場合は、次に自分のターンが早く回ってくるプレイヤーが優先（レスポンスの対象を宣言した人は除く）。アタックの目標になったプレイヤーは、まず真っ先にレスポンスする権利を得ます。</p>",
  "<p><b>Resolving</b>: once nobody wants to respond, resolve <b>from the last declaration back</b> (declared A→B→C, resolve C→B→A). A declaration whose conditions are no longer met is cancelled—power cards spent on it are lost and the card is discarded. Nothing new can be declared while resolving.</p><p><b>Priority</b>: if several players want to respond at once, the player whose turn comes up soonest goes first (excluding whoever made the declaration being responded to). The target of an attack gets the first chance to respond to it.</p>"),
 ("<p><b>例</b>：あなたがプロジェクト「邪印」で相手のキャラクターを狙う → 相手がファスト「孔雀明王法」でレスポンス → あなたがファスト「十字祓」で「孔雀明王法」を狙ってレスポンス。解決は十字祓 → 孔雀明王法（すでに捨て札なので不発）→ 邪印 の順になり、邪印が通ります。</p>",
  "<p><b>Example</b>: you play the Project “邪印” on an opponent's character → they respond with the Fast card “孔雀明王法” → you respond with the Fast card “十字祓” aimed at “孔雀明王法”. Resolution runs 十字祓 → 孔雀明王法 (already discarded, so it fizzles) → 邪印, and your 邪印 goes through.</p>"),
)

SK = [
 ("ドロー±X","Draw ±X","支配中、ドローフェイズに引く枚数が±X。複数いれば合計。変化した枚数は必ず引く。","While dominated, change your draw-phase draw by ±X. Totals stack; you must draw the changed number."),
 ("チャージX","Charge X","支配中、パワーカードフェイズにデッキの上からX枚まで、中を見ずにパワーカードとして支配キャラクターか自分のアクティブキャラクターにセットできる。","While dominated, in your power card phase set up to X cards from the top of your deck, unseen, as power cards on your dominated or active characters."),
 ("ステルス","Stealth","アタック時、ガードできるのは同じ勢力のキャラクターだけ。","When it attacks, only a character of the same faction can guard."),
 ("プロテクト?","Protect ?","?の勢力のプロジェクトカードの効果を受けない。","Unaffected by Project cards of faction ?."),
 ("▼（アグレッシブ）","▼ Aggressive","勢力エリアのアクティブキャラクターなら、勢力フェイズにアタックしてくる。","As an active character in a faction area, it attacks in the faction phase."),
 ("ブーストX","Boost X","アタック宣言時にX枚まで追加アタックコストを払える。ガード側は同じ枚数を追加で払わないとガードできない。","When attacking, pay up to X extra; a guard must pay the same extra amount to guard."),
 ("パーマネント±X","Permanent ±X","セットできるパーマネントの上限が±X。上限を超えたら、持ち主が選んで超過分を捨てる。","Changes how many permanents it can hold by ±X; if over the limit, its owner discards down."),
 ("ペネトレイト","Penetrate","ガードされても、与えた通常ダメージからガードしたキャラクターの耐久力を引いた分を本来の目標にも与える。アクティブキャラクターへのアタックでは余りが下の勢力キャラクターへ。精神ダメージやガード側では働かない。","Even when guarded, normal damage beyond the guarder's defense carries through to the original target; against an active character the excess hits the characters beneath. Not for mental damage or when guarding."),
 ("イニシアチブ","Initiative","バトルで先にダメージを与える。それで相手を倒せば反撃を受けない。","Deals battle damage first; if that defeats the opponent, it takes none back."),
 ("インフィニティ","Infinity","アタック・ガード・エフェクトコストとして払ったカードは、相手に見せてから手札に戻る。","Cards paid for its attack, guard or effect costs return to hand after being shown."),
 ("ブレイクスルー","Breakthrough","ブレイクしていないキャラクターではガードできない。","Cannot be guarded by an unbroken character."),
 ("キャパシティ±X","Capacity ±X","支配中、手札上限が±X。","While dominated, hand limit ±X."),
 ("シンクロ","Synchro","味方の支配キャラクターのアタック／ガードに参加し、2人でバトルする（攻撃力合計、受けるダメージは各自）。","Joins another dominated character's attack or guard so two fight as one (attack is combined, each takes damage separately)."),
 ("レジスト?","Resist ?","?の勢力・分類のキャラクターからのバトルのダメージを受けない（バトル以外の効果は受ける）。","Takes no battle damage from characters of faction/class ? (other effects still apply)."),
 ("インターセプト","Intercept","ガードコストが1枚少なくなる。","Guard cost is reduced by 1."),
 ("リムーブX","Remove X","支配中、ドローフェイズ開始時にパワーカードX枚を払わないと勢力エリアに戻る。","While dominated, at the start of your draw phase pay X power cards or it returns to the faction area."),
 ("オフェンシブ","Offensive","支配中、プレイヤーへのアタックのアタックコストが手札に戻る。","While dominated, the attack cost for attacking a player returns to your hand."),
 ("ディフェンシブ","Defensive","支配中、支配キャラクターのアタックに対するガードのガードコストが手札に戻る。","While dominated, the guard cost for guarding against a dominated character's attack returns to your hand."),
 ("シールド","Shield","「バトルで相手キャラクターから受けるダメージ」以外のダメージを受けない。","Takes no damage except battle damage from an opposing character."),
 ("バインドX","Bind X","場から除去されるとき、パワーカードX枚をダメージ置き場に置けば場に残る。","When it would leave the field, put X of its power cards into the damage zone to keep it."),
]
sk_jp="".join(f"<tr><th>{a}</th><td>{c}</td></tr>" for a,b,c,d in SK)
sk_en="".join(f"<tr><th>{b}</th><td>{d}</td></tr>" for a,b,c,d in SK)
sec("abilities","特殊能力","Special abilities","Chapter 9 · p.47–51",
 ("<p>特殊能力は4種類：<b>スキル</b>（単語で表す一般的な能力、20種類）、<b>精神攻撃</b>（攻撃力のカッコ表記）、<b>エフェクト</b>（丸数字で始まりコストを払って使う）、<b>アビリティ</b>（それ以外の文章で書かれた能力）。【 】のブレイク条件と、別書体のフレーバーテキストはアビリティではありません。</p>",
  "<p>There are four kinds: <b>Skills</b> (one-word abilities, 20 in all), <b>Mental attack</b> (bracketed attack value), <b>Effects</b> (start with a circled number, paid for with power cards) and <b>Abilities</b> (any other rules text). Break conditions in 【 】 and flavour text in a different typeface are not abilities.</p>"),
 (f"<div class='tbl'><table class='skills'><thead><tr><th>スキル</th><th>内容（要約）</th></tr></thead><tbody>{sk_jp}</tbody></table></div>",
  f"<div class='tbl'><table class='skills'><thead><tr><th>Skill</th><th>What it does (summary)</th></tr></thead><tbody>{sk_en}</tbody></table></div>"),
)

sec("solo","ソロプレイルール","Solo play","Chapter 10 · p.52–53",
 ("<p>相手がいないときに1人で遊ぶルールです。自分側のゲームスペースだけを使います。</p><ul><li>デッキは40〜60枚、同名4枚まで。<b>▼を持つキャラクターカードを最低5枚</b>入れます。</li><li><b>準備</b>：デッキを1枚ずつめくり、キャラクターカードなら勢力エリアにセット、それ以外は捨て札。<b>▼持ちキャラクターが勢力エリアに合計5枚</b>出たら終了し、<b>手札0枚</b>でスタート。</li><li>自分のターンだけを繰り返します。1ターン目もドローできます。</li><li><b>勝利条件</b>：敗北条件を満たす前に、勢力エリアのキャラクターを0にすること。支配・バトル・ブレイク・プロジェクト/ファストで減らしていきましょう。</li></ul>",
  "<p>Rules for playing alone, using only your side of the play area.</p><ul><li>Deck of 40–60, max 4 per name, with <b>at least 5 character cards that have ▼</b>.</li><li><b>Setup</b>: reveal cards one at a time—characters go to your faction area, everything else is discarded—until <b>5 ▼ characters</b> are in the faction area. Start with <b>0 cards in hand</b>.</li><li>You only take your own turns, and you may draw on turn 1.</li><li><b>Win</b> by emptying your faction area before you meet a losing condition—dominate, battle, break, or use Project/Fast cards to clear it.</li></ul>"),
)

sec("styles","スタイル","Formats (styles)","Chapter 11 · p.54–55 (as of 2009-07-31)",
 ("<ul><li><b>スタンダード</b>：SagaⅡ・Saga3・アクエリアンエイジの指定エクスパンションと一部のプロモが使える（エクスパンションコンバートで随時変動）。</li><li><b>Saga3</b>：「逆襲の巨蟹宮」以降のSaga3カードのみ。</li><li><b>SagaⅡ</b>／<b>SagaⅠ</b>：それぞれのシリーズのカードのみ。</li><li><b>アルティメット</b>：SagaⅠからSaga3まで全てのカード。</li><li><b>シンプル</b>：対応リストに載ったテキストの簡単なカードのみ。</li></ul><p>最新の使用可能カードは公式情報を確認してください。</p>",
  "<ul><li><b>Standard</b>: listed Saga II, Saga 3 and Aquarian Age expansions plus some promos (changes as old sets rotate out).</li><li><b>Saga 3</b>: Saga 3 cards from “逆襲の巨蟹宮” onward.</li><li><b>Saga II</b> / <b>Saga I</b>: cards from that series only.</li><li><b>Ultimate</b>: every card from Saga I to Saga 3.</li><li><b>Simple</b>: only cards on the simple-text list.</li></ul><p>Check official information for the current card pool.</p>"),
)

QA = [
 ("「ドロー−X」で引く枚数が0以下になったら？","“Draw −X” brings my draw to 0 or less?","ドローフェイズに引けないだけで、それ以外の効果はありません。","You simply draw nothing in the draw phase; there is no other effect."),
 ("プレイヤーが精神ダメージを受けたら？","A player takes mental damage?","通常ダメージと同じく、その数だけダメージ判定をします。","Same as normal damage: one damage check per point."),
 ("通常2と精神(1)を両方持つキャラクターにアタックされたら？","Attacked by a character with 2 normal and (1) mental?","それぞれの枚数を合計して、3回ダメージ判定します。","Add them up: three damage checks."),
 ("精神力が下がり、パワーカードが精神力より多くなったら？","Mental power drops below the number of power cards?","すぐに精神力と同じ枚数になるまで、自分で選んで捨てます（中身は見られません）。","Immediately discard down to the new value, choosing which ones (without looking at them)."),
 ("ダメージは累積する？","Does damage accumulate?","しません。カードの効果によるダメージも、受けた時点で捨て札になるか判定し、生き残ればすぐ消えます。","No. Card-effect damage is also checked on the spot; if the character survives, it is cleared."),
 ("自分の捨て札置き場を確認していい？","May I look through my discard pile?","できません。どのプレイヤーも枚数や中身を確認できません。","No. No player may count or look through any discard pile."),
 ("精神攻撃(1)に「攻撃力+1」を与えると(2)になる？","Does “Attack +1” turn (1) mental into (2)?","なりません。精神攻撃力(1)と通常攻撃力1になります。(2)にするには「攻撃力+(1)」が必要です。","No—it becomes (1) mental and 1 normal. You need “Attack +(1)” to make it (2)."),
 ("勢力フェイズに攻めてきたアクティブキャラクターが、ガードで耐久力以上のダメージを受けたら？","An aggressive active character takes lethal damage from my guard?","通常のバトルと同じく、バトル終了時に捨て札されます。","Same as a normal battle: it is discarded when the battle ends."),
 ("アタックコストを他のキャラクターから払える？","Can another character pay the attack cost?","できません。アタック・ガード・エフェクトのコストは、その行動をするキャラクターから払います。パーマネント・ブレイク・プロジェクト・ファストのコストはどの支配キャラクターからでも払えます。","No. Attack, guard and effect costs come from the acting character. Costs for permanents, breaks, projects and fasts can come from any dominated character."),
 ("支配エリアのキャラクター数に上限はある？","Is there a limit on dominated characters?","ありません。","No."),
 ("「場に同じネームは1人」の「場」は自分の場？","Does “one per name on the field” mean my side only?","場は全プレイヤーのテリトリーなので、相手が支配しているネームと同じネームのキャラクターは支配できません。ダメージ置き場・捨て札置き場は場に含まれません。","The field is every player's territory, so you cannot dominate a name your opponent already has. Damage zones and discard piles are not on the field."),
 ("支配キャラクターが減り、必要ファクターを満たさなくなったら？","Losing characters so a permanent's factor is no longer met?","捨て札になりません。必要ファクターは出すときだけ必要です。","Nothing happens; the factor is only needed when you play the card."),
 ("ブレイクに「勢力・なし」とあるのは？","A Break card says “faction: none”?","どの勢力にも属さないキャラクターです。ファクターを持たず、勢力エリアに移るとイレイザーの右に「勢力なし」のパーティを作ります。","It belongs to no faction and gives no factor. If it moves to a faction area it forms a no-faction party to the right of Eraser."),
]
qa_jp="".join(f"<details><summary>{a}</summary><p>{c}</p></details>" for a,b,c,d in QA)
qa_en="".join(f"<details><summary>{b}</summary><p>{d}</p></details>" for a,b,c,d in QA)
sec("qa","Q&A（抜粋）","Q&A (selected)","Chapter 12 · p.56–58",(qa_jp,qa_en))

sec("summary","ルールサマリーの要点","Rule summary highlights","Chapter 13 · p.59–78 (as of 2009-07-30)",
 ("<ul><li>サマリーは補助資料で、ルールやQ&Aより優先されるものではありません。</li><li>「場に出たとき」は手札だけでなく、ダメージ置き場や捨て札置き場から場にセットされた場合も含みます。レスポンス中で未解決のカードはまだ場に出ていません。</li><li>効果の発生源が場からなくなると、その効果も同時に失われます。</li><li>場のカードは、捨て札する効果がない限り捨て札できません。</li><li>同時処理で順番が必要なときは、効果を受けるカードのオーナーが順番を決めます。異なるプレイヤーの効果が同時なら、ターンプレイヤーの効果から順に処理します。</li><li>複数のキャラクターが同時にバトルしても、攻撃力は合計されません。複数のバトルが同時に起こったら、ガード宣言したプレイヤーが順番を決めます。</li></ul><p>全文は公式ルールブックを参照してください。</p>",
  "<ul><li>The summary is a reference aid and does not override the rules or the Q&A.</li><li>“When it enters the field” includes being set from the damage zone or discard pile, not just from hand. A card still waiting in a response chain has not entered the field yet.</li><li>If the source of an effect leaves the field, the effect ends at the same moment.</li><li>Cards on the field cannot be discarded unless an effect says so.</li><li>When simultaneous effects need an order, the owner of the affected card chooses. If they come from different players, the turn player's effects resolve first.</li><li>Characters battling simultaneously do not add their attacks together. If several battles happen at once, the guarding player decides the order.</li></ul><p>See the official rulebook for the full text.</p>"),
)

sec("partner","パートナーシステム（試用版 Ver.1.1）","Partner System (trial rules Ver.1.1)","partnersystem_ver101 · updated 2013-03-22",
 ("<p>ネームレベルキャラクター1人を「パートナー」にして戦う対戦形式です。<b>Ver.1.0からの変更</b>：パートナー置き場に置くのは1枚。パートナーと同じネームのカードのコストは1減少。</p>",
  "<p>A match format where one name-level character is your “partner”. <b>Changes from Ver.1.0</b>: only one card goes to the partner zone, and cards sharing the partner's name cost 1 less.</p>"),
 ("<ol class='phase'><li>デッキは<b>60枚ちょうど</b>（40〜60枚ではない）。ネームを持つブレイクかキャラクターカードを必ず入れる。他の構築ルールは同じ。</li><li>デッキ内のネームを1つ指定する。それがあなたのパートナー。</li><li>先攻後攻を決める<b>前</b>に、そのネームを持つブレイクかキャラクターカードを<b>1枚だけ</b>デッキから抜き出す（60枚に含む）。</li><li>順番が決まったら全員同時に公開し、<b>パートナー置き場</b>に置く。常に公開状態で、パートナー置き場は場ではない。</li><li>残りをシャッフルして通常通りゲーム開始。</li><li>ドローの一部を、デッキの代わりにパートナー置き場から行える。ドローは同時に行うので、デッキから1枚見てから決めることはできない。ドローフェイズ以外のドローにも使える。手札に入った後は通常のカードと同じで、捨て札されてもパートナー置き場には戻らない。</li><li>パートナー置き場のカードと<b>同じネームのカードのコストは1減少</b>。パートナー置き場が空になったら減少しない。コスト0のブレイクは0のまま（マイナスにならない）。キャラクターカードにはコストがない。</li></ol>",
  "<ol class='phase'><li>Your deck is <b>exactly 60 cards</b> (not 40–60) and must include a Break or Character card that has a name. Other deck rules are unchanged.</li><li>Choose one name from your deck. That character is your partner.</li><li><b>Before</b> deciding turn order, take <b>one</b> Break or Character card with that name out of the deck (it still counts toward the 60).</li><li>Once turn order is set, everyone reveals at the same time and places it in their <b>partner zone</b>. It stays face up; the partner zone is not part of the field.</li><li>Shuffle the rest and start the game normally.</li><li>When you draw, you may take part of the draw from the partner zone instead of the deck. Draws happen all at once, so you cannot look at a deck card first and then decide. This works for any draw, not just the draw phase. Once in hand it is a normal card; if discarded it does not return to the partner zone.</li><li>Cards with <b>the same name as the card in your partner zone cost 1 less</b>. Once the partner zone is empty, there is no reduction. A 0-cost Break stays at 0 (never negative). Character cards have no cost.</li></ol>"),
)

GL = [
 ("アクティブキャラクター","Active character","勢力パーティの一番上のキャラクター"),("勢力パーティ","Faction party","勢力ごとにまとめた勢力キャラクターの山"),
 ("勢力エリア","Faction area","まだ仲間でないキャラクターの置き場"),("支配エリア","Dominion area","味方キャラクターの置き場"),
 ("支配","Dominate","勢力エリアのキャラクターを支配エリアに移すこと"),("マインドブレイカー","Mind Breaker","プレイヤーのこと"),
 ("精神力","Mental power","セットできるパワーカードの上限"),("攻撃力","Attack","与えるダメージ"),("耐久力","Defense","耐えられるダメージ"),
 ("精神攻撃","Mental attack","パワーカードを捨て札させる攻撃（カッコ付き）"),("パワーカード","Power card","キャラクターの下に裏向きでセットしたカード"),
 ("コスト","Cost","行動のために払うパワーカード"),("必要ファクター","Required factor","使用に必要な同勢力の支配キャラクター数"),
 ("ファクター","Factor","勢力の影響力。キャラクター1人につき1つ"),("分類アイコン","Class icon","キャラクターのタイプを表すマーク"),
 ("属性アイコン","Attribute icon","効果範囲（目標/範囲）と持続時間（瞬間/持続）"),("ネーム","Name","“ ”で囲まれた個人名"),
 ("ネームレベルキャラクター","Name-level character","ネームを持つキャラクター"),("セット","Set","キャラクター・ブレイク・パーマネント・パワーカードを場に出すこと"),
 ("ブレイク","Break","ブレイクカードをキャラクターにセットすること"),("エフェクト","Effect","丸数字で始まる、コストを払って使う能力"),
 ("アビリティ","Ability","スキル・エフェクト・精神攻撃以外の特殊能力"),("スキル","Skill","単語で表される能力（20種類）"),
 ("アタック","Attack (action)","キャラクターで攻撃をしかけること"),("ガード","Guard","アタックを妨害すること"),("バトル","Battle","キャラクター同士の戦闘"),
 ("レスポンス","Response","相手の行動宣言に割り込むこと"),("ダメージ判定","Damage check","ダメージ時にデッキをめくる処理"),
 ("ダメージ置き場","Damage zone","10枚以上で敗北"),("捨て札置き場","Discard pile","使い終わったカードの置き場"),
 ("テリトリー","Territory","1人の勢力エリア＋支配エリア（＋P/F置き場）"),("場","Field","全プレイヤーのテリトリー"),
 ("除去","Removal","場から場以外へ移動すること（手札・デッキ・ダメージ置き場・捨て札）"),("オーナー","Owner","そのカードが入っていたデッキのプレイヤー"),
 ("目標","Target","単体に効果を与える対象"),("範囲","Area","条件に合う全てに効果"),("瞬間","Instant","すぐ終わる効果"),("持続","Continuous","一定時間続く効果"),
 ("フレーバーテキスト","Flavour text","ゲームに関係しない設定・セリフ"),
]
gl_rows="".join(f"<tr><th lang='ja'>{a}</th><td>{b}</td><td lang='ja'>{c}</td></tr>" for a,b,c in GL)
GLOSSARY=f"<div class='tbl'><table class='gloss'><thead><tr><th>日本語</th><th>English</th><th>意味 / meaning</th></tr></thead><tbody>{gl_rows}</tbody></table></div>"

def render():
    toc="".join(f"<a href='#r-{i}' data-rjump><span lang='ja'>{jp}</span><span lang='en'>{en}</span></a>" for i,jp,en,pg,b in S)+"<a href='#r-glossary' data-rjump><span lang='ja'>用語集</span><span lang='en'>Glossary</span></a>"
    out=[]
    for i,jp,en,pg,blocks in S:
        bl=[]
        for j,e in blocks:
            if j.startswith("!"):
                bl.append(f"<div class='bi key'><div lang='ja'>{j[1:]}</div><div lang='en'>{e[1:]}</div></div>")
            else:
                bl.append(f"<div class='bi'><div lang='ja'>{j}</div><div lang='en'>{e}</div></div>")
        out.append(f"<section class='rsec' id='r-{i}'><header class='rhead'><h2><span lang='ja'>{jp}</span><span lang='en'>{en}</span></h2><span class='pg'>{pg}</span></header>{''.join(bl)}</section>")
    out.append(f"<section class='rsec' id='r-glossary'><header class='rhead'><h2><span lang='ja'>用語集</span><span lang='en'>Glossary</span></h2><span class='pg'>Chapter 14 · p.79–82</span></header>{GLOSSARY}</section>")
    return toc, "".join(out)
