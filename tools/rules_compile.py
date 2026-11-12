#!/usr/bin/env python3
"""Rule database compiler (requirements_v4 Revise#048, §20.9 B6): card list rows → engine data.

Run by build.py: every card of data/cardlist.xlsx is turned ONCE into links the engine reads at play time
(no text parsing in the browser):

  {type, faction, name, icons, se, at, atMental, de, cost, factor, skills, statMods,
   effects: [{cost, text, target, steps, costTo?, status}], play: {target, steps, status},
   abilities: [...], breakRule, fastTiming, status}

Steps use the effect primitives of src/engine/16-effects.js; targets use the selector language of
src/engine/15-selectors.js. Whatever the compiler can't read yet becomes {"a": "manual", "text": …}
(shown as "✋ do by hand", as in v3) and the card is marked "partial" / "manual" in the coverage report.
Card coverage grows by adding patterns here (C1–C4), never by changing the engine.

    python3 tools/rules_compile.py            prints the coverage report for data/cardlist.xlsx
"""
import json, re, sys, unicodedata
re._MAXCACHE = max(getattr(re, "_MAXCACHE", 512), 100000)   # the compiler uses thousands of patterns: keep them all compiled (10× faster)
from collections import Counter

N = lambda s: unicodedata.normalize("NFKC", str(s if s is not None else "")).strip()

FACTION_JP = {"E.G.O.": "E.G.O.", "阿羅耶識": "Arayashiki", "WIZ-DOM": "WIZ-DOM", "WIZーDOM": "WIZ-DOM", "ダークロア": "Darklore",
              "極星帝国": "Polestar Empire", "イレイザー": "Eraser"}
FACTION_EN = ["E.G.O.", "Arayashiki", "WIZ-DOM", "Darklore", "Polestar Empire", "Eraser"]
FACTOR_LETTER = {"E": "E.G.O.", "阿": "Arayashiki", "W": "WIZ-DOM", "ダ": "Darklore", "極": "Polestar Empire", "イ": "Eraser"}
TEXT_FACTOR = dict(FACTOR_LETTER, 宇="Eraser", 冥="Nether")   # in card texts 宇 is the Eraser mark too (every card using it is an Eraser card)
CLASS_EN = {"スチューデント": "Student", "ワーカー": "Worker", "アスリート": "Athlete", "スカラー": "Scholar", "タレント": "Talent",
            "ゴースト": "Ghost", "霊能者": "Psychic", "クリーチャー": "Creature", "ミスティック": "Mystic", "ヴァンパイア": "Vampire",
            "鬼": "Ogre", "モンスター": "Monster", "悪魔": "Devil", "マーメイド": "Mermaid", "ワータイガー": "Weretiger",
            "ワーウルフ": "Werewolf", "アンドロイド": "Android", "イレイザー": "Eraser", "ドラグーン": "Dragoon", "サイボーグ": "Cyborg",
            "マシン": "Machine", "ウォリアー": "Warrior", "スキャナー": "Scanner", "アンデッド": "Undead", "トライ": "Three-Eyed", "傀儡": "Puppet", "式神": "Shikigami"}
CLASS_FROM_EN = {v: k for k, v in CLASS_EN.items()}
CLASS_FROM_EN.update({"Oni": "鬼", "Demon": "悪魔"})
SKILL_JP = {"イニシアチブ": "initiative", "シールド": "shield", "インターセプト": "intercept", "ペネトレイト": "penetrate", "ステルス": "stealth",
            "ブレイクスルー": "breakthrough", "オフェンシブ": "offensive", "ディフェンシブ": "defensive", "シンクロ": "synchro",
            "インフィニティ": "infinity", "デュアル": "dual", "バインド": "bind", "ブースト": "boost", "チャージ": "charge", "ドロー": "draw",
            "キャパシティ": "capacity", "パーマネント": "permanent", "リムーブ": "remove"}
FLAG_SKILLS = {"Shield": "shield", "Intercept": "intercept", "Initiative": "initiative", "Breakthrough": "breakthrough",
               "Offensive": "offensive", "Defensive": "defensive", "Synchro": "synchro", "Penetrate": "penetrate", "Stealth": "stealth",
               "Infinity": "infinity", "Dual": "dual", "Inherent Skill": "inherent", "Inherent": "inherent"}
VALUED = ["Charge", "Draw", "Bind", "Permanent", "Capacity", "Boost", "Remove"]
# source titles (Pack's M1b): "…シリーズのカード" = a card whose 'エクスパンション or その他配布方法' names that title
WORKS_JP = {"fortissimoシリーズ": "fortissimo", "魔法少女リリカルなのはシリーズ": "nanoha", "魔法戦記リリカルなのはForce": "nanohaForce", "ファントムブレイカーシリーズ": "phantom", "ファントムブレイカー": "phantom",
            "えびてん": "ebiten", "BLAZBLUE": "blazblue", "BLAZBLUEシリーズ": "blazblue", "トップをねらえ!シリーズ": "gunbuster", "トップをねらえ!": "gunbuster", "スマイル☆シューターシリーズ": "smile", "スマイル☆シューター": "smile", "世界樹の迷宮": "sekaiju", "世界樹の迷宮シリーズ": "sekaiju", "境界線上のホライゾンシリーズ": "horizon", "境界線上のホライゾン": "horizon",
            "ラグナロクオンラインシリーズ": "ragnarok", "ラグナロクオンライン": "ragnarok", "すーぱーそに子シリーズ": "sonico", "すーぱーそに子": "sonico"}   # Revise#201: the works of the Extra Packs
WORKS_RE = {"nanoha": r"リリカル", "nanohaForce": r"リリカルなのはForce", "phantom": r"ファントムブレイカー", "fortissimo": r"fortissimo", "ebiten": r"えびてん", "blazblue": r"BLAZBLUE", "gunbuster": r"トップをねらえ", "smile": r"スマイル☆シューター", "sekaiju": r"世界樹の迷宮", "horizon": r"境界線上のホライゾン", "ragnarok": r"ラグナロクオンライン", "sonico": r"すーぱーそに子"}
WORK_ALT = "|".join(sorted(map(re.escape, WORKS_JP), key=len, reverse=True))
UNTIL = {"メインフェイズ終了時まで": "main", "ターン終了時まで": "turn", "バトル終了時まで": "battle", "次のターンのターン終了時まで": "nextTurn", "次のターン終了時まで": "nextTurn"}
STAT_JP = {"精神力": "se", "攻撃力": "at", "耐久力": "de"}

# same pattern as src/js/01-core.js EFFECT_LINE: skills may come first on the line ("▼ チャージ1 1：…")
EFFECT_LINE = re.compile(r"^(?:▼|\s|(?:(?:チャージ|ドロー|バインド|パーマネント|キャパシティ|ブースト|リムーブ)[+\-−]?[0-9X]+|シールド|インターセプト|イニシアチブ|"
                         r"ブレイクスルー|オフェンシブ|ディフェンシブ|シンクロ|ペネトレイト|デュアル|ステルス|インフィニティ|インヘレント|(?:レジスト|プロテクト)\S+)(?=\s))*?"
                         r"([0-9X]+)\s*:\s*(.+)$")


def class_tokens(raw):
    out = []
    for t in re.split(r"[/／\n・,、]", N(raw)):
        t = re.sub(r"\s+", "", t)
        male = "♂" in t
        base = t.replace("♂", "").replace("♀", "")
        if re.fullmatch(r"ウォリア[-ｰ]?", base): base = "ウォリアー"
        if base == "霊能": base = "霊能者"
        if base in CLASS_EN: out.append(base + ("♂" if male else ""))
    return out


def num(v):
    v = N(v)
    return int(v) if re.fullmatch(r"-?\d+", v) else None


def stat_mod(v):
    """Permanent stat text: "+1" → 1, "-1" → -1, "+(1)" → 1, "±0" → 0, "+X" → None."""
    m = re.fullmatch(r"([+\-−±]?)\(?(\d+)\)?", N(v))
    if not m: return None
    return (-1 if m.group(1) in ("-", "−") else 1) * int(m.group(2))


def personal_name(jp):
    m = re.search(r"“([^”]*)”", N(jp))
    return re.sub(r"\s+", "", m.group(1)) if m and m.group(1).strip() else ""


# ---------------------------------------------------------------- targets (≪…≫ → selector)
def parse_selector(prefix):
    """The words before キャラクター / プレイヤー → selector dict, or None when a word is not understood."""
    sel, p = {}, prefix
    rules = [
        (r"ダメージ置き場のカード枚数が(\d+)枚以上の、あなたの対戦相手全ての支配", "oppDmgMinCtl"),   # A3-EX02 EX0104 (Revise#345)
        (r"E\.G\.O\.のファクターを持つ", {"faction": FACTION_JP["E.G.O."]}), (r"E\.G\.O\.のファクターを持たない", {"notFactionCh": FACTION_JP["E.G.O."]}),   # A4-04 0679 (Revise#358)
        (r"阿羅耶識のファクターを持つ", {"faction": FACTION_JP["阿羅耶識"]}), (r"阿羅耶識のファクターを持たない", {"notFactionCh": FACTION_JP["阿羅耶識"]}),   # A4-04 0679 (Revise#358)
        (r"WIZ[-ー]DOMのファクターを持つ", {"faction": FACTION_JP["WIZ-DOM"]}), (r"WIZ[-ー]DOMのファクターを持たない", {"notFactionCh": FACTION_JP["WIZ-DOM"]}),   # A4-04 0679 (Revise#358)
        (r"ダークロアのファクターを持つ", {"faction": FACTION_JP["ダークロア"]}), (r"ダークロアのファクターを持たない", {"notFactionCh": FACTION_JP["ダークロア"]}),   # A4-04 0679 (Revise#358)
        (r"極星帝国のファクターを持つ", {"faction": FACTION_JP["極星帝国"]}), (r"極星帝国のファクターを持たない", {"notFactionCh": FACTION_JP["極星帝国"]}),   # A4-04 0679 (Revise#358)
        (r"イレイザーのファクターを持つ", {"faction": FACTION_JP["イレイザー"]}), (r"イレイザーのファクターを持たない", {"notFactionCh": FACTION_JP["イレイザー"]}),   # A4-04 0679 (Revise#358)
        (r"あなたの勢力(?!エリア|パーティ|フェイズ)", {"owner": "you", "area": "party"}),   # A4-05 0911 (Revise#348): "あなたの勢力キャラクター"
        (r"▼を持たず、?", {"aggressive": False}),   # A4-PP PP140 (Revise#349)
        (r"キャパシティ[+＋]Xのスキルを持つ", {"skill": "capacity"}), (r"[“\"]([^”\"]+)[”\"]以外の、?", "notNameQ"),   # A4-EX01 EX0754 / EX0749 (Revise#344)
        (r"アタックを受けたプレイヤーのテリトリーの、?", {"ownerAttacked": True}), (r"このキャラクターのパワー以下のパワーの", {"powerLeSelf": True}),   # A4-02 0246 (Revise#342)
        (r"ダメージ置き場のカード枚数が(\d+)枚以上のプレイヤーを目標にアタック宣言している", "attackingDmgMin"),   # A4-02 0311 (Revise#341)
        (r"構成するカードにネームを持つカードが(\d+)枚以上含まれている", "stackNamedMin"),   # A4-04 0768 (Revise#340)
        (r"あなたの支配キャラクター以外の", {"notYourCtl": True}),   # A4-PP PP274 (Revise#318)
        (r"あなたを目標にアタック宣言した", {"attacking": True, "attackingYou": True}),   # A4-EX02 EX836 (Revise#318)
        (r"イレイザー以外の分類を持つ、?", {"iconOther": "イレイザー"}),   # A4-05 0980 (Revise#318): a class other than イレイザー
        (r"このキャラクター以外の、?", {"notSelf": True}), (r"、", {}),
        (r"あなたの支配エリアの", {"owner": "you", "area": "controlled"}), (r"支配エリアの", {"area": "controlled"}),
        (r"1以上の数値の精神攻撃力を持つ", {"atMental": True, "stat": [{"key": "at", "op": ">=", "n": 1}]}),   # A3-09 1386 (Revise#164)
        (r"精神攻撃を持つ", {"atMental": True}), (r"♂の分類を持たない", {"male": False}), (r"スキルまたはエフェクトを持つ", {"skillOrEffect": True}),
        (r"同じ名称のカードが2枚以上場に存在する", {"dupName": True}), (r"同じネームを持つキャラクターが2体以上場に存在する", {"dupName": True}), (r"いずれかのプレイヤーの捨て札置き場にあるカードと同じ名称の", {"nameInDiscard": True}), (r"パーマネントカードがセットされている", {"hasPerm": True}), (r"アタック宣言した", {"attacking": True}),   # A3-21 2985 / A3-20 2837 (Revise#165); the rest of the line was inside this comment until Revise#168
        (r"精神攻撃力を持たない", {"atMental": False}),   # A4-05 0882 (Revise#292)
        (r"本来精神攻撃力を持つ", {"atMentalBase": True}), (r"指定した分類を持つ", {"icons": "@effIcon"}),   # A4-03 0448 / 0576 (Revise#287)
        (r"精神攻撃力のみを持つ", {"atOnly": "mental"}), (r"通常攻撃力のみを持つ", {"atOnly": "normal"}),   # Pack report (A3-24 3471, Revise#296): its Attack now, not the printed kind
        (r"精神攻撃力を持つ", {"atMental": True}), (r"通常攻撃力を持つ", {"atMental": False}),
        (r"あなたのテリトリーの", {"owner": "you"}), (r"あなたの任意の(?=あなたの)", {}), (r"あなたの任意の", {}), (r"あなたの", {"owner": "you"}),
        (r"(対戦相手|他のプレイヤー|あなた以外のプレイヤー)の(テリトリーの)?", {"owner": "opp"}),
        (r"勢力エリアの", {"area": "party"}), (r"アクティブ", {"area": "active"}),
        (r"ブレイクしていない", {"broken": False}), (r"ブレイクしている", {"broken": True}),
        (r"ネームレベルでな[いく]", {"named": False}), (r"ネームを持たない", {"named": False}), (r"(ネームを持つ|ネームレベル)", {"named": True}),
        (r"(X|\d+)以下の(精神力|攻撃力|耐久力)の", "statLe"),   # "X以下の精神力の" (M3a, Revise#159)
        (r"▼を持たない", {"aggressive": False}), (r"▼を持つ", {"aggressive": True}), (r"バトル中の", {"inBattle": True}),
        (r"(?:あなた|あなたの味方プレイヤー)を目標にアタック宣言している", {"attacking": True, "attackingYou": True}),
        (r"アタック宣言またはガード宣言している", {"inBattle": True}),
        (r"アタック宣言している", {"attacking": True}), (r"(ガード宣言している|このキャラクターのアタック宣言に対してガード宣言している)", {"guarding": True}),
        (r"エフェクトを持つ", {"hasEffect": True}), (r"支配キャラクターの", {"area": "controlled"}),
        (r"このターンにダメージを受けている", {"damagedThisTurn": True}),
        (r"スキルを持つ", {"hasSkill": True}), (r"アビリティを持つ", {"hasAbility": True}),
        (r"分類を1種類だけ持つ", {"iconCount": {"op": "=", "n": 1}}), (r"(\d)種類以上の分類を持つ", "iconMin"),   # A3-09 1421 (Revise#172)
        (r"(?:このキャラクターにガード宣言されている|このキャラクターのアタック宣言に対してガード宣言している)", {"oppOfSelf": True}),
        (r"(武蔵|英国|三征西班牙|K\.P\.A\.Italia|六護式仏蘭西|M\.H\.R\.R\.|P\.A\.Oda|上越露西亜|清武田|IZUMO|フッケバイン|戦闘機人)を持たない", "notTag"),   # A4-EX02 EX881 (Revise#318)
        (r"(武蔵|英国|三征西班牙|K\.P\.A\.Italia|六護式仏蘭西|M\.H\.R\.R\.|P\.A\.Oda|上越露西亜|清武田|IZUMO|フッケバイン|戦闘機人)を持つ", "tag"),
        (r"ガード宣言した", {"guarding": True}),   # A4-PP PP170 (Revise#318)
        (r"キャパシティ\+Xを持つ", {"capSign": 1}), (r"キャパシティ-Xを持つ", {"capSign": -1}),   # EX0149 (Revise#201)
        (r"♂の分類を持つ", {"male": True}), (r"アタックを受けたプレイヤーの", {"ownerAttacked": True}), (r"ガードした", {"guarding": True}), (r"パワーが精神力に等しい", {"powerEqMental": True}), (r"このキャラクターと同時にアタック宣言またはガード宣言している", {"sameSide": True}), (r"パーマネントカードをセットされていない", {"hasPerm": False}), (r"パーマネントカードをセットされている", {"hasPerm": True}),
        (r"“([^”]+)”", None),
        (r"任意の", {}), (r"目標の", {}), (r"テリトリーの", {}),
    ]
    changed = True
    while p and changed:
        changed = False
        for pat, add in rules:
            m = re.match(pat, p)
            if m and add == "iconMin": sel["iconCount"] = {"op": ">=", "n": int(m.group(1))}; p = p[m.end():]; changed = True; break
            if m and add == "statLe": sel.setdefault("stat", []).append({"key": STAT_JP[m.group(2)], "op": "<=", "n": "X" if m.group(1) == "X" else int(m.group(1))}); p = p[m.end():]; changed = True; break
            if m and add == "notTag": sel["notTag"] = m.group(1); p = p[m.end():]; changed = True; break
            if m and add == "oppDmgMinCtl": sel.update({"owner": "opp", "area": "controlled", "ownerDmgMin": int(m.group(1))}); p = p[m.end():]; changed = True; break
            if m and add == "notNameQ": sel["notName"] = re.sub(r"\s+", "", m.group(1)); p = p[m.end():]; changed = True; break
            if m and add == "attackingDmgMin": sel["attacking"] = True; sel["attackingDmgMin"] = int(m.group(1)); p = p[m.end():]; changed = True; break
            if m and add == "stackNamedMin": sel["stackNamedMin"] = int(m.group(1)); p = p[m.end():]; changed = True; break
            if m: sel.update({"tag": m.group(1)} if add == "tag" else add if add is not None else {"name": re.sub(r"\s+", "", m.group(1))}); p = p[m.end():]; changed = True; break
        if changed: continue
        m = re.match(r"カード名称に「([^」]+)」を含む", p)   # EP194 (Revise#193)
        if m: sel["jpHas"] = m.group(1); p = p[m.end():]; changed = True; continue
        m = re.match(r"(" + "|".join(re.escape(k) for k in WORKS_JP) + r")(?:に登場する|の)", p)   # "魔法少女リリカルなのはシリーズに登場する" (M3g, Revise#192)
        if m: sel["works"] = WORKS_JP[m.group(1)]; p = p[m.end():]; changed = True; continue
        m = re.match(r"支配キャラクターが(\d+)体(以下|以上)の", p)
        if m: sel["ownerCtl"] = {"op": "<=" if m.group(2) == "以下" else ">=", "n": int(m.group(1))}; p = p[m.end():]; changed = True; continue
        m = re.match(r"パワーが?(\d+|X)(以下|以上)?の", p)
        if m: sel["power"] = {"op": {"以下": "<=", "以上": ">="}.get(m.group(2), "="), "n": "X" if m.group(1) == "X" else int(m.group(1))}; p = p[m.end():]; changed = True; continue
        m = re.match(r"(精神力|攻撃力|耐久力)(?:の数値)?が?(\d+|X)(以下|以上)?の", p)
        if m: sel.setdefault("stat", []).append({"key": STAT_JP[m.group(1)], "op": {"以下": "<=", "以上": ">="}.get(m.group(3), "="), "n": "X" if m.group(2) == "X" else int(m.group(2))}); p = p[m.end():]; changed = True; continue
        m = re.match(r"コスト(\d+|X)(以下|以上)?の", p)
        if m: sel["cost"] = {"op": {"以下": "<=", "以上": ">="}.get(m.group(2), "="), "n": "X" if m.group(1) == "X" else int(m.group(1))}; p = p[m.end():]; changed = True; continue
        m = re.match(r"(デュアル|イニシアチブ|シールド|インターセプト|ペネトレイト|ステルス|ブレイクスルー|オフェンシブ|ディフェンシブ|シンクロ|バインド|ブースト|チャージ|ドロー)(?:[-+−ー]?(?:X|\d+))?を持つ", p)
        if m: sel["skill"] = SKILL_JP[m.group(1)]; p = p[m.end():]; changed = True; continue
        m = re.match(r"(?:勢力)?(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のキャラクターまたは([^のを]+?)$", p)   # "阿羅耶識のキャラクターまたはアスリート" (Revise#164)
        if m and class_tokens(m.group(2).replace("または", "・")) and len(class_tokens(m.group(2).replace("または", "・"))) == len(m.group(2).split("または")):
            sel["anyOf"] = [{"faction": FACTION_JP[m.group(1)]}, {"icons": class_tokens(m.group(2).replace("または", "・"))}]; p = ""; changed = True; continue
        m = re.match(r"(▼|イニシアチブ|シールド|インターセプト|ペネトレイト|ステルス|ブレイクスルー|シンクロ)または(イニシアチブ|シールド|インターセプト|ペネトレイト|ステルス|ブレイクスルー|シンクロ)を持つ", p)   # A3-07 1169 (Revise#164)
        if m: sel["anyOf"] = [{"aggressive": True} if g == "▼" else {"skill": SKILL_JP[g]} for g in (m.group(1), m.group(2))]; p = p[m.end():]; changed = True; continue
        m = re.match(r"(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)または(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)の", p)   # "極星帝国またはE.G.O.の" (Revise#159)
        if m: sel["faction"] = [FACTION_JP[m.group(1)], FACTION_JP[m.group(2)]]; p = p[m.end():]; changed = True; continue
        m = re.match(r"(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)の", p)
        if m: sel["faction"] = FACTION_JP[m.group(1)]; p = p[m.end():]; changed = True; continue
        m = re.match(r"((?:[^・を]+?)(?:・[^・を]+?)*)を持つ", p)
        if m:
            icons = class_tokens(m.group(1).replace("・", "/"))
            if icons and len(icons) == len(m.group(1).split("・")): sel["icons"] = icons; p = p[m.end():]; changed = True; continue
        if p.endswith("支配") and p == "支配": sel["area"] = "controlled"; p = ""; changed = True
    if p.endswith("支配"):
        rest = parse_selector(p[:-2])
        if rest is None: return None
        rest["area"] = "controlled"
        sel.update(rest); p = ""
    return sel if not p else None


SPECIAL_REFS = {"このキャラクター": "self", "このカード": "card", "あなた": "you", "プレイヤー全て": "players", "全てのプレイヤー": "players",
                "あなた以外のプレイヤー全て": "opp", "あなたの対戦相手全て": "opp", "対戦相手全て": "opp", "このキャラクターのバトル相手": "battleOpp",
                "バトル相手": "battleOpp", "このエフェクトのコスト": "cost", "このカードのコスト": "cost", "このターンのプレイヤー": "turnPlayer",
                "アタックを受けたプレイヤー": "attackedPlayer", "このキャラクターのアタックを受けたプレイヤー": "attackedPlayer",
                "このキャラクターのバトル相手のキャラクター": "battleOpp", "このキャラクターのアタック宣言に対してガード宣言したキャラクター": "battleOpp",
                "このキャラクターのアタック宣言に対してガード宣言するキャラクター": "battleOpp", "バトル相手のオーナー": "battleOppOwner",
                "このキャラクターのアタック宣言に対してガード宣言するか、このキャラクターにガード宣言されたキャラクターのオーナー": "battleOppOwner",
                "ガード宣言したキャラクターのオーナー": "battleOppOwner", "ガード宣言されたキャラクターのオーナー": "battleOppOwner",
                "このキャラクターにガード宣言されているキャラクター": "battleOpp", "このキャラクターのバトル相手のオーナー": "battleOppOwner", "捨て札されたキャラクターのオーナー": "evPlayer", "捨て札されたキャラクターのオーナーのデッキ": "evPlayerDeck", "このキャラクターにセットされているパワーカード全て": "selfPowerCards",
                "あなたのデッキ": "yourDeck", "デッキ": "yourDeck", "アタック宣言またはガード宣言したキャラクター": {"all": {"inBattle": True}}, "アタック宣言したキャラクター": {"all": {"attacking": True}}}
CARD_TYPES_JP = {"プロジェクト": "Project", "ファスト": "Fast", "パーマネント": "Permanent", "ブレイク": "Break"}


def parse_target(t):
    """≪t≫ → ("ref", value) for fixed refs / everything matching, or ("choice", spec). None = not understood."""
    t = re.sub(r"(?<=[でのい])(\d+|X)コストの", r"コスト\1の", t)
    t = re.sub(r"^あなたの任意のあなたの(ダメージ置き場|捨て札置き場)の", r"あなたの\1の", t)   # A4-EP EP556 (Revise#293)   # A4-02 0316 (Revise#282): "ネームレベルでないXコストのブレイクカード"
    t = t.replace("キャラクタ-", "キャラクター").replace("プレイヤ-", "プレイヤー").replace("パワ-", "パワー").replace("ワーカ-", "ワーカー").replace("スカラ-", "スカラー")
    mc = re.fullmatch(r"(.*?)分類・([^0-9X全≪≫、]+?)(全て|(?:\d+|X)(?:人|体)(?:まで)?)", re.sub(r"([ァ-ヶ])-(?=\d|X|人|体|全|・)", r"\1ー", t))   # Saga 4 "分類・イレイザー・イレイザー♂全て" / "分類・イレイザ-1人" (Revise#259)
    if mc and class_tokens(mc.group(2)) and len(class_tokens(mc.group(2))) == len(mc.group(2).split("・")): t = mc.group(1) + "・".join(class_tokens(mc.group(2))) + "を持つキャラクター" + mc.group(3)
    m = re.fullmatch(r"(あなたの)?(?:ダメージ置き場または捨て札置き場|捨て札置き場またはダメージ置き場)(?:に置かれている|にある|の)、?(.+?)(\d+)枚", t)   # EX0322 / 2799 (Revise#216): either pile, card types or classes
    if m:
        mid, sel0 = m.group(2), {"zones": ["damage", "discard"], "owner": "you" if m.group(1) else "any"}
        tm = re.fullmatch(r"((?:ブレイク|キャラクター|プロジェクト|ファスト|パーマネント)カード(?:または(?:ブレイク|キャラクター|プロジェクト|ファスト|パーマネント)カード)*)", mid)
        cm = re.fullmatch(r"([^、]+?)を持つカード", mid)
        if mid == "カード": return ("choice", {"kind": "card", "sel": sel0, "count": int(m.group(3))})   # A4-02 0243 (Revise#282)
        if tm: return ("choice", {"kind": "card", "sel": dict(sel0, types=[dict(CARD_TYPES_JP, キャラクター="Character")[x.replace("カード", "")] for x in tm.group(1).split("または")]), "count": int(m.group(3))})
        if cm and class_tokens(cm.group(1).replace("または", "・")) and len(class_tokens(cm.group(1).replace("または", "・"))) == len(cm.group(1).split("または")): return ("choice", {"kind": "card", "sel": dict(sel0, icons=class_tokens(cm.group(1).replace("または", "・"))), "count": int(m.group(3))})
    m = re.fullmatch(r"あなたのダメージ置き場または捨て札置き場(?:に置かれている|にある|の)、?([^、]+?)を持つカード(\d+)枚", t)   # A3-14 1999 (Revise#165)
    if m and class_tokens(m.group(1).replace("または", "・")) and len(class_tokens(m.group(1).replace("または", "・"))) == len(m.group(1).split("または")): return ("choice", {"kind": "card", "sel": {"zones": ["damage", "discard"], "owner": "you", "icons": class_tokens(m.group(1).replace("または", "・"))}, "count": int(m.group(2))})
    m = re.fullmatch(r"あなたのダメージ置き場または捨て札置き場にある、?(ネームを持たない|ネームを持つ|ブレイク条件のない)?ブレイクカード(\d+)枚", t)   # A3-25 3692 (Revise#165)
    if m: return ("choice", {"kind": "card", "sel": dict({"zones": ["damage", "discard"], "owner": "you", "types": ["Break"]}, **({"named": m.group(1) == "ネームを持つ"} if m.group(1) and "ネーム" in m.group(1) else {"noBreakRule": True} if m.group(1) else {})), "count": int(m.group(2))})
    m = re.fullmatch(r"パワー(X|\d+)以下の([^0-9]+?)(\d+)人", t)   # "パワーX以下のワーカーまたはワーカー♂1人" (A3-22 3127, Revise#165)
    if m and class_tokens(m.group(2).replace("または", "・")) and len(class_tokens(m.group(2).replace("または", "・"))) == len(m.group(2).split("または")):
        return ("choice", {"kind": "char", "sel": {"icons": class_tokens(m.group(2).replace("または", "・")), "power": {"op": "<=", "n": "X" if m.group(1) == "X" else int(m.group(1))}}, "count": int(m.group(3))})
    if t == "あなたのダメージ置き場のネームを持つカード1枚": return ("choice", {"kind": "card", "sel": {"zones": ["damage"], "owner": "you", "named": True}, "count": 1})   # A3-07 1102 (M5a)
    if t in SPECIAL_REFS: return ("ref", SPECIAL_REFS[t])
    if t == "このキャラクターのアタック宣言に対してガード宣言しているキャラクター": return ("ref", "battleOpp")   # A4-EX02 EX833 (Revise#318)
    m = re.fullmatch(r"(.*?)キャラクター(\d+)人または(.*?)キャラクター\2人", t)   # "精神攻撃力を持つキャラクター1人またはブレイクしていないキャラクター1人" (A4-03 0439, Revise#318)
    if m and m.group(1) and m.group(3) and parse_selector(m.group(1)) is not None and parse_selector(m.group(3)) is not None:
        return ("choice", {"kind": "char", "sel": {"anyOf": [parse_selector(m.group(1)), parse_selector(m.group(3))]}, "count": int(m.group(2))})
    m = re.fullmatch(r"(ガード宣言した|アタック宣言した)(.*?)キャラクター", t)   # "≪ガード宣言した▼を持つブレイクしていないキャラクター≫" (A4-PP PP170, Revise#318)
    if m and parse_selector(m.group(1) + m.group(2)) is not None: return ("ref", {"all": parse_selector(m.group(1) + m.group(2))})
    if t in ("そのプレイヤーの支配キャラクター全て", "指定したプレイヤーの支配キャラクター全て", "目標の支配キャラクター全て"): return ("ref", "tControlled")   # Revise#164
    if t.endswith("ネームレベルでないキャラクター") and t == "ネームレベルでないキャラクター": return ("ref", {"all": {"named": False}})   # A3-21 2982 (Revise#166)
    if t in ("ネームレベルキャラクター", "ネームを持つキャラクター"): return ("ref", {"all": {"named": True}})   # A3-09 1351
    m = re.fullmatch(r"(精神力|攻撃力|耐久力)(X|\d+)以下のキャラクター", t)   # A3-16 2258 (Revise#177)
    if m: return ("ref", {"all": {"stat": [{"key": STAT_JP[m.group(1)], "op": "<=", "n": "X" if m.group(2) == "X" else int(m.group(2))}]}})
    if t == "パワーがXに等しくないキャラクター": return ("ref", {"all": {"power": {"op": "!=", "n": "X"}}})   # A3-11 1740
    if t == "あなたの対戦相手の捨て札置き場のキャラクターカード1枚": return ("choice", {"kind": "card", "sel": {"zones": ["discard"], "owner": "opp", "types": ["Character"]}, "count": 1})   # A3-23 3341 (Revise#171)
    if t == "あなたの任意の分類1つを持つキャラクター全て": return ("ref", {"all": {"icons": ["@icon"]}})   # A3-22 3164 (Revise#168): the class is chosen when it resolves
    m = re.fullmatch(r"((?:勢力)?(?:E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のキャラクターまたは[^0-9X]+?)(\d+|X)(?:人|体)", t)   # "阿羅耶識のキャラクターまたはアスリート1人" (Revise#164)
    if m and parse_selector(m.group(1)) and "anyOf" in parse_selector(m.group(1)): return ("choice", {"kind": "char", "sel": parse_selector(m.group(1)), "count": "X" if m.group(2) == "X" else int(m.group(2))})
    m = re.fullmatch(r"(あなたの|対戦相手の|あなたの任意の)?パワーカード(\d+)枚", t)   # a power card on a character (Revise#087)
    if m: return ("choice", {"kind": "card", "sel": {"power": True, "owner": {"あなたの": "you", "対戦相手の": "opp"}.get(m.group(1) or "", "any")}, "count": int(m.group(2))})
    if t == "あなたの任意のエリア1つのキャラクター全てにセットされているパワーカード1枚ずつ": return ("ref", {"areaPower": 1})
    m = re.fullmatch(r"あなたの任意の(.*?)(\d+)人を構成するカード全て", t)
    if m:
        pp = parse_target(m.group(1) + m.group(2) + "人")
        if pp and pp[0] == "choice" and pp[1]["kind"] == "char": return ("ref", {"pickChars": dict(pp[1]["sel"], owner="you"), "n": int(m.group(2))})
    if t == "ダメージ置き場に置かれているカードと同じ名称のカード1枚": return ("choice", {"kind": "char", "sel": {"nameInDamage": True}, "count": 1})
    if t == "ダメージ置き場のカード枚数が8枚以上のあなたの対戦相手いずれか1人の、使用宣言中のカード1枚": return ("choice", {"kind": "item", "sel": {"kind": "set", "byOppDmgMin": 8}, "count": 1})   # A3-EX02 EX0185 (Revise#217)
    if t == "あなた以外のプレイヤー1人のダメージ置き場のカード1枚": return ("choice", {"kind": "card", "sel": {"zones": ["damage"], "owner": "opp"}, "count": 1})
    m = re.fullmatch(r"(.*?)キャラクター1人にセットされているパワーカード全て", t)   # "目標の≪キャラクター1人にセットされているパワーカード全て≫" (A3-08 1256, Revise#164)
    if m and parse_selector(m.group(1)) is not None: return ("choice", {"kind": "char", "sel": dict(parse_selector(m.group(1)), hasPower=True), "count": 1, "_powerAll": True})
    m = re.fullmatch(r"(.+?)キャラクターにセットされているパワーカード全て", t)
    if m and not m.group(1).startswith("この") and parse_selector(m.group(1)) is not None: return ("ref", {"powerOf": parse_selector(m.group(1))})
    m = re.fullmatch(r"(?:あなたの支配キャラクターの)?(" + "|".join(TOKEN_NAMES) + r")(1人|全て)", t)
    if m: return ("choice", {"kind": "char", "sel": {"owner": "you", "area": "controlled", "tokenName": m.group(1)}, "count": 1}) if m.group(2) == "1人" else ("ref", {"all": {"tokenName": m.group(1)}})
    if t == "アタックを受けたプレイヤーの支配エリアのネームレベルキャラクター1人": return ("ref", {"all": {"ownerAttacked": True, "area": "controlled", "named": True}})   # chosen when that attack happens (討伐令)
    if t == "あなたのダメージ置き場にある、ブレイク条件のない悪魔または悪魔♂のブレイクカード1枚": return ("choice", {"kind": "card", "sel": {"zones": ["damage"], "owner": "you", "types": ["Break"], "icons": ["悪魔", "悪魔♂"], "noBreakRule": True}, "count": 1})   # Revise#133
    if t == "あなたのダメージ置き場のネームレベルでないブレイクカード1枚": return ("choice", {"kind": "card", "sel": {"zones": ["damage"], "owner": "you", "types": ["Break"], "named": False}, "count": 1})
    if t == "必要ファクターが満たされている、あなたの捨て札置き場にあるブレイクカード1枚": return ("choice", {"kind": "card", "sel": {"zones": ["discard"], "owner": "you", "types": ["Break"], "factorMet": True}, "count": 1})
    if t == "ダメージ置き場にあるカード1枚": return ("choice", {"kind": "card", "sel": {"zones": ["damage"]}, "count": 1})
    if t == "ダメージ置き場にあるブレイクカード1枚": return ("choice", {"kind": "card", "sel": {"types": ["Break"], "zones": ["damage"]}, "count": 1})
    m = re.fullmatch(r"あなたの(手札|捨て札置き場|ダメージ置き場)(?:または(?:あなたの)?(手札|捨て札置き場|ダメージ置き場))?(?:の|にある)(パーマネント|ブレイク|プロジェクト|ファスト)カード(\d+)枚", t)
    if m: return ("choice", {"kind": "card", "sel": {"owner": "you", "types": [CARD_TYPES_JP[m.group(3)]], "zones": [{"手札": "hand", "捨て札置き場": "discard", "ダメージ置き場": "damage"}[g] for g in (m.group(1), m.group(2)) if g]}, "count": int(m.group(4))})
    if t == "そのプレイヤーのデッキ": return ("ref", "evPlayerDeck")
    if t == "バトル相手のキャラクターを構成するカード全てと、バトル相手にセットされているパワーカード全て": return ("ref", "evByAll")   # Revise#126
    if t == "目標のバトル相手にセットされているパワーカード全て": return ("ref", "battleOppPower")
    m = re.fullmatch(r"あなたの任意の勢力(\d+)つの(?:、あなたの支配)?キャラクター全て", t)
    if m: return ("ref", {"factionPick": int(m.group(1)), "own": "あなたの支配" in t})
    m = re.fullmatch(r"(.+?)を構成するカード全て", t)   # "…キャラクターを構成するカード全て" = that character (its cards go together)
    if m and not m.group(1).startswith("この"):
        p2 = parse_target(m.group(1) if m.group(1).endswith("全て") else m.group(1) + "全て")
        if p2 and p2[0] == "ref": return p2
    m = re.fullmatch(r"((?:[^・]+)(?:・[^・]+)*)のネームを持つブレイクカードのコスト", t)
    if m:
        icons = class_tokens(m.group(1).replace("・", "/"))
        if icons: return ("ref", {"costOf": {"type": "Break", "icons": icons, "named": True}})
    if t == "このキャラクターに与えられるダメージ": return ("ref", "selfDamage")
    if t in ("このキャラクターにガード宣言されたキャラクター", "このキャラクターにガード宣言したキャラクター"): return ("ref", "battleOpp")
    if t == "ファストカードまたはエフェクトのコストを支払ったキャラクター": return ("ref", {"all": {"paidFor": ["Fast", "effect"]}})
    if t == "このキャラクターにセットされたパーマネントカードのコスト": return ("ref", {"costOf": {"type": "Permanent", "onTarget": "self"}})
    m = re.fullmatch(r"このキャラクターから支払われた(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のブレイクカードのコスト", t)
    if m: return ("ref", {"costOf": {"type": "Break", "faction": FACTION_JP[m.group(1)], "fromSelf": True}})
    if t == "ブレイクカードのコスト": return ("ref", {"costOf": {"type": "Break"}})
    if t in ("あなた以外のプレイヤーの支配キャラクター", "あなた以外のプレイヤーの支配キャラクター全て"): return ("ref", {"all": {"owner": "opp", "area": "controlled"}})   # EX827 (Revise#242)
    m = re.fullmatch(r"このキャラクターから支払われた“([^”]+)”のコスト", t)   # EX0678 (Revise#242)
    if m: return ("ref", {"costOf": {"name": re.sub(r"\s+", "", m.group(1)), "fromSelf": True}})
    m = re.fullmatch(r"(武蔵|英国|三征西班牙|K\.P\.A\.Italia|六護式仏蘭西|M\.H\.R\.R\.|P\.A\.Oda|上越露西亜|清武田|IZUMO)とネームを持つブレイクカードのコスト", t)   # EX882 (Revise#242)
    if m: return ("ref", {"costOf": {"type": "Break", "tag": m.group(1), "named": True}})
    if t == "このキャラクターから支払われたブレイクカードのコスト": return ("ref", {"costOf": {"type": "Break", "fromSelf": True}})
    m = re.fullmatch(r"このキャラクターから支払われた(武蔵|英国|三征西班牙|K\.P\.A\.Italia|六護式仏蘭西|M\.H\.R\.R\.|P\.A\.Oda|上越露西亜|清武田|IZUMO)とネームを持つブレイクカードのコスト", t)   # A4-EX02 EX791 (Revise#294)
    if m: return ("ref", {"costOf": {"type": "Break", "tag": m.group(1), "named": True, "fromSelf": True}})
    m = re.fullmatch(r"このキャラクターから支払った(.+?)を持つブレイクカードのコスト", t)   # EX0424 (Revise#157)
    if m and class_tokens(m.group(1)): return ("ref", {"costOf": {"type": "Break", "icons": class_tokens(m.group(1)), "fromSelf": True}})
    if m and parse_selector(m.group(1) + "を持つ") and "tag" in parse_selector(m.group(1) + "を持つ"): return ("ref", {"costOf": {"type": "Break", "tag": parse_selector(m.group(1) + "を持つ")["tag"], "fromSelf": True}})
    m = re.fullmatch(r"あなたの使用する“([^”]+)”のネームを持つブレイクカードのコスト", t)   # EX0366 (Revise#157)
    if m: return ("ref", {"costOf": {"type": "Break", "name": re.sub(r"\s+", "", m.group(1))}})
    m = re.fullmatch(r"このキャラクターから支払われた((?:[^・]+?)(?:(?:・|または)[^・]+?)*)のブレイクカードのコスト", t)   # M1a: A3-12 1824
    if m:
        parts = re.split(r"・|または", m.group(1))
        icons = class_tokens("/".join(parts))
        if icons and len(icons) == len(parts): return ("ref", {"costOf": {"type": "Break", "icons": icons, "fromSelf": True}})
    m = re.fullmatch(r"(ネームレベルでない|ネームレベルの|ネームを持つ)ブレイクカードのコスト", t)
    if m: return ("ref", {"costOf": {"type": "Break", "named": m.group(1) != "ネームレベルでない"}})
    m = re.fullmatch(r"(.+?)全てと(あなた|プレイヤー全て)", t)   # "≪キャラクター全てとあなた≫" / "…とプレイヤー全て"
    if m:
        p1 = parse_target(m.group(1) + "全て")
        if p1 and p1[0] == "ref": return ("ref", {"both": [p1[1], "you" if m.group(2) == "あなた" else "players"]})
    m = re.fullmatch(r"本来のコストが(\d+)のカード全て", t)   # M1a: "≪本来のコストが0のカード全て≫のコストは1上昇する"
    if m: return ("ref", {"cards": {"baseCost": int(m.group(1))}})
    m = re.fullmatch(r"本来のコストが(\d+)の((?:プロジェクト|ファスト|パーマネント|ブレイク)カード(?:・(?:プロジェクト|ファスト|パーマネント|ブレイク)カード)*)全て", t)
    if m: return ("ref", {"cards": {"baseCost": int(m.group(1)), "types": [CARD_TYPES_JP[x] for x in re.findall(r"(プロジェクト|ファスト|パーマネント|ブレイク)カード", m.group(2))]}})
    m = re.fullmatch(r"このキャラクターから支払われた(fortissimoシリーズ)に登場するネームを持つブレイクカードのコスト", t)
    if m: return ("ref", {"costOf": {"type": "Break", "named": True, "works": WORKS_JP[m.group(1)], "fromSelf": True}})
    m = re.fullmatch(r"このキャラクターから支払われた((?:プロジェクト|ファスト|パーマネント|ブレイク)カード(?:・(?:プロジェクト|ファスト|パーマネント|ブレイク)カード)+)のコスト", t)
    if m: return ("ref", {"costOf": {"types": [CARD_TYPES_JP[x] for x in re.findall(r"(プロジェクト|ファスト|パーマネント|ブレイク)カード", m.group(1))], "fromSelf": True}})
    m = re.fullmatch(r"このキャラクターから支払われた、?カードテキストに“([^”]+)”を含む((?:プロジェクト|ファスト|パーマネント|ブレイク)カード(?:・(?:プロジェクト|ファスト|パーマネント|ブレイク)カード)*)のコスト", t)   # EX0296 / EX0436 (Revise#201)
    if m: return ("ref", {"costOf": {"types": [CARD_TYPES_JP[x] for x in re.findall(r"(プロジェクト|ファスト|パーマネント|ブレイク)カード", m.group(2))], "textHas": re.sub(r"\s+", "", m.group(1)), "fromSelf": True}})
    if t == "このキャラクターから支払われたコストの中にあるプロジェクトカード": return ("ref", {"costOf": {"paidTypes": ["Project"], "fromSelf": True}})
    m = re.fullmatch(r"あなたの(?:任意の)?(?:あなたの)?手札(?:のカード)?(\d+)枚", t)
    if m: return ("ref", {"handPick": int(m.group(1))})
    m = re.fullmatch(r"“([^”]+)”のネームを持つブレイクカード", t)
    if m: return ("ref", {"cards": {"types": ["Break"], "name": re.sub(r"\s+", "", m.group(1))}})
    if t == "このキャラクターと同じエリアにいる、パワーカードがセットされているキャラクター全て": return ("ref", {"all": {"sameAreaSelf": True, "hasPower": True}})
    m = re.fullmatch(r"あなたのテリトリーのパワーカード(\d+)枚", t)   # a power card on one of your characters
    if m: return ("choice", {"kind": "card", "sel": {"power": True, "owner": "you"}, "count": int(m.group(1))})
    if t in ("このキャラクターのオーナー", "このカードのオーナー"): return ("ref", "you")
    m = re.fullmatch(r"(あなたの支配エリアの)?((?:“[^”]+”)(?:と“[^”]+”)+)", t)   # "あなたの支配エリアの“マルゴット・ナイト”と“マルガ・ナルゼ”" (A4-EX01 EX0753, Revise#311): each of them
    if m: return ("ref", {"all": dict({"names": [re.sub(r"\s+", "", x) for x in re.findall(r"“([^”]+)”", m.group(2))]}, **({"owner": "you", "area": "controlled"} if m.group(1) else {}))})
    m = re.fullmatch(r"“([^”]+)”以外のキャラクター全て", t)   # A3-EX04 EX0454 (Revise#310)
    if m: return ("ref", {"all": {"notName": re.sub(r"\s+", "", m.group(1))}})
    m = re.fullmatch(r"(?:あなたの)?(?:任意の)?(?:対戦相手|あなた以外のプレイヤー)(\d+)人", t)   # "あなた以外のプレイヤー1人" (A4-PR PR095, Revise#310)
    if m: return ("choice", {"kind": "player", "sel": {"owner": "opp"}, "psel": {"owner": "opp"}, "count": int(m.group(1))})
    m = re.fullmatch(r"(.*?)“([^”]+)”(?:(\d+)人)?", t)   # "あなたの支配エリアの“高町 ヴィヴィオ”1人" / "…ブレイクしている“トーマ・アヴェニール”" (every one)
    if m:
        sel = parse_selector(m.group(1))
        if sel is not None:
            sel["name"] = re.sub(r"\s+", "", m.group(2))
            return ("choice", {"kind": "char", "sel": sel, "count": int(m.group(3))}) if m.group(3) else ("ref", {"all": sel})
    if t == "任意の対象を指定するプロジェクトカードまたはファストカードまたはエフェクト1つ":
        return ("choice", {"kind": "item", "sel": {"types": ["Project", "Fast"], "effects": True, "aims": "any", "byChoice": True}, "count": 1})   # A3-15 2105 (Pack, Revise#248): a card whose objects are the controller's choice
    m = re.fullmatch(r"(?:あなたの)?対戦相手が使用した((?:プロジェクト|ファスト)カード(?:または(?:プロジェクト|ファスト)カード)*)(\d+)枚", t)
    if m: return ("choice", {"kind": "card", "sel": {"owner": "opp", "types": [CARD_TYPES_JP[x] for x in re.findall(r"(プロジェクト|ファスト)カード", m.group(1))]}, "count": int(m.group(2))})
    if re.fullmatch(r"(?:スチューデント|スチューデント♂|ドラグーン|ドラグーン♂)(?:・(?:スチューデント|スチューデント♂|ドラグーン|ドラグーン♂))*", t): return ("ref", {"icons": t.split("・")})
    m = re.fullmatch(r"(あなたの対戦相手全て|対戦相手全て|プレイヤー全て|あなた)と、?(.+?)キャラクター全て", t)
    if m and parse_selector(m.group(2)) is not None: return ("ref", {"both": [{"あなた": "you", "プレイヤー全て": "players"}.get(m.group(1), "opp"), {"all": parse_selector(m.group(2))}]})
    m = re.fullmatch(r"(あなたの|あなたの任意の)(?:プレイヤー全て|全てのプレイヤー)", t)
    if m: return ("ref", "players")
    m = re.fullmatch(r"(あなたの|あなたの任意のあなたの対戦相手\d人の|対戦相手の)?(ダメージ置き場|捨て札置き場)(?:にある)?の?、?(?:あなたの任意の)?(.*?)(?:カード)?(\d+|X)枚(まで)?", t) or \
        re.fullmatch(r"(あなたの|対戦相手の)?(ダメージ置き場|捨て札置き場)の(.*?)カード(全て)", t)
    if m:   # cards in a pile, picked when it resolves (Event System)
        filt = (m.group(3) or "").lstrip("、")
        sel = {}
        wm0 = re.match(r"(" + WORK_ALT + r")の", filt)   # "境界線上のホライゾンシリーズのカード" (EX907, Revise#242)
        if wm0: sel["works"] = WORKS_JP[wm0.group(1)]; filt = filt[wm0.end():]
        im = re.match(r"((?:[^・、]+?)(?:(?:または|・)[^・、]+?)*)を持つ", filt)
        if im and class_tokens(re.sub(r"または|・", "/", im.group(1))): sel["icons"] = class_tokens(re.sub(r"または|・", "/", im.group(1))); filt = filt[im.end():]
        fx = re.match(r"必要ファクターが(X|\d+)以下の", filt)
        if fx: sel["factorMax"] = "X" if fx.group(1) == "X" else int(fx.group(1)); filt = filt[fx.end():]
        fm = re.fullmatch(r"(?:(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)の)?((?:プロジェクト|ファスト|パーマネント|ブレイク|キャラクター)(?:カード)?(?:または|・)?)*", filt)
        nm = re.fullmatch(r"[“「]([^”」]+)[”」]", filt)   # 「ディープ・ドーン」 (A4-03 0538, Revise#318)
        st0 = re.fullmatch(r"(精神力|攻撃力|耐久力)(\d+)の(.+?)のキャラクター", filt)
        if nm: sel = {"name": re.sub(r"\s+", "", nm.group(1))}; filt, fm = "", None
        elif st0 and class_tokens(st0.group(3)): sel = {"types": ["Character"], "stat": {"key": STAT_JP[st0.group(1)], "n": int(st0.group(2))}, "icons": class_tokens(st0.group(3))}; filt, fm = "", None
        if filt and fm:
            if fm.group(1): sel["faction"] = FACTION_JP[fm.group(1)]
            ts = re.findall(r"(プロジェクト|ファスト|パーマネント|ブレイク|キャラクター)", filt)
            if ts: sel["types"] = [CARD_TYPES_JP.get(x, "Character") for x in ts]
        elif filt: return None
        owner = "you" if (m.group(1) or "").startswith("あなたの") and "対戦相手" not in (m.group(1) or "") else "opp" if m.group(1) else "any"
        n = "all" if m.group(4) == "全て" else ("X" if m.group(4) == "X" else int(m.group(4)))
        return ("ref", {"pile": {"zone": "damage" if m.group(2) == "ダメージ置き場" else "discard", "owner": owner, "sel": sel, "n": n, "upTo": bool(m.lastindex >= 5 and m.group(5))}})
    if re.fullmatch(r"パワー0のキャラクター", t): return ("ref", {"all": {"power": {"op": "=", "n": 0}}})
    m = re.fullmatch(r"(あなたの|あなた以外のプレイヤー全ての)デッキの一番上のカード(\d+|X)枚", t)
    if m: return ("ref", {"deckTop": {"owner": "you" if m.group(1) == "あなたの" else "opp", "n": "X" if m.group(2) == "X" else int(m.group(2))}})
    m = re.fullmatch(r"(.*?)キャラクター(\d+)人またはプレイヤー\2人|(?:プレイヤーまたは)(.*?)キャラクター(\d+)人", t)
    if m:   # "キャラクター1人またはプレイヤー1人", "プレイヤーまたはパワー0のキャラクター1人"
        sel = parse_selector(m.group(1) if m.group(1) is not None else m.group(3) or "")
        if sel is not None: return ("choice", {"kind": "charOrPlayer", "sel": sel, "count": int(m.group(2) or m.group(4)), "psel": {}})
    if re.fullmatch(r"このキャラクターのアタック宣言に対してガード宣言(?:する|している)か、このキャラクターにガード宣言(?:された|されている)キャラクター(?:1人)?", t): return ("ref", "battleOpp")
    m = re.fullmatch(r"このキャラクターのアタック宣言に対してガード宣言(?:(?:する|している)か、このキャラクターにガード宣言(?:された|されている)|した)、?(.*?)キャラクター(?:全て)?(?:と、そのキャラクターにセットされているカード全て|を構成するカード全て)?", t)
    if m and parse_selector(m.group(1)) is not None: return ("ref", {"battleOppSel": parse_selector(m.group(1))} if m.group(1) else "battleOpp")   # Revise#109
    if t in ("そのキャラクターのオーナー", "目標のオーナー", "目標のキャラクターのオーナー"): return ("ref", "tOwner")
    if t in ("ガード宣言したキャラクター", "ガード宣言しているキャラクター"): return ("ref", {"all": {"guarding": True}})
    m = re.fullmatch(r"(?:(キャラクター|プレイヤー)\d人を目標とする、?)?(?:使用宣言中の、?(?:キャラクターを対象とする範囲の)?)?((?:プロジェクト|ファスト)カード(?:または(?:プロジェクト|ファスト)カード)?)(?:(\d+)枚)?(またはエフェクト\d+つ)?", t)
    if m and (m.group(1) or "使用宣言中" in t or m.group(4)):   # a declaration waiting in the Resolve list (Revise#031 #9)
        sel = {"types": [CARD_TYPES_JP[x] for x in re.findall(r"(プロジェクト|ファスト)カード", m.group(2))]}
        if m.group(1): sel["aims"] = "char" if m.group(1) == "キャラクター" else "player"
        if m.group(4): sel["effects"] = True
        return ("choice", {"kind": "item", "sel": sel, "count": int(m.group(3) or 1)})
    m = re.fullmatch(r"(キャラクター1人が目標の|あなたか、あなたがオーナーのカードを対象に含む、)((?:プロジェクト|ファスト)カード(?:または(?:プロジェクト|ファスト)カード)?)(\d+)枚", t)   # EX0338 / EX0185 (Revise#203)
    if m: return ("choice", {"kind": "item", "sel": dict({"types": [CARD_TYPES_JP[x] for x in re.findall(r"(プロジェクト|ファスト)カード", m.group(2))]}, **({"aims": "char", "oneTarget": True} if m.group(1).startswith("キャラクター") else {"aimsMine": True})), "count": int(m.group(3))})
    m = re.fullmatch(r"このカードの直前に使用宣言された((?:プロジェクト|ファスト|パーマネント)カード(?:または(?:プロジェクト|ファスト|パーマネント)カード)*)のコストを1コスト以上支払ったキャラクター(\d+)人", t)   # EX0489 (Revise#209)
    if m: return ("choice", {"kind": "char", "sel": {"paidTop": [CARD_TYPES_JP[x] for x in re.findall(r"(プロジェクト|ファスト|パーマネント)カード", m.group(1))]}, "count": int(m.group(2))})
    m = re.fullmatch(r"(.+?)キャラクターからコストを支払って使用宣言されている、コストが(\d+)以上のカード(\d+)枚", t)   # 3659 (Revise#209)
    if m and parse_selector(m.group(1)): return ("choice", {"kind": "item", "sel": {"kind": "set", "paidBySel": parse_selector(m.group(1)), "costMin": int(m.group(2))}, "count": int(m.group(3))})
    m = re.fullmatch(r"範囲の((?:プロジェクト|ファスト)カード(?:または(?:プロジェクト|ファスト)カード)?)(\d+)枚", t)   # EX0623 (Revise#201): a card in use whose range is not a target
    if m: return ("choice", {"kind": "item", "sel": {"types": [CARD_TYPES_JP[x] for x in re.findall(r"(プロジェクト|ファスト)カード", m.group(1))], "area": True}, "count": int(m.group(2))})
    m = re.fullmatch(r"(.*?)((?:“[^”]+”)(?:(?:、|または)“[^”]+”)+)(?:(\d+)(?:人|体)|全て)", t)   # "あなたの支配エリアの“A”、“B”、“C”全て" (Revise#201)
    if m and parse_selector(m.group(1)) is not None:
        sel = dict(parse_selector(m.group(1)), names=[re.sub(r"\s+", "", x) for x in re.findall(r"“([^”]+)”", m.group(2))])
        return ("ref", {"all": sel}) if m.group(3) is None else ("choice", {"kind": "char", "sel": sel, "count": int(m.group(3))})
    m = re.fullmatch(r"(.*?)“([^”]+)”全て", t)
    if m and parse_selector(m.group(1)) is not None: return ("ref", {"all": dict(parse_selector(m.group(1)), name=re.sub(r"\s+", "", m.group(2)))})
    m = re.fullmatch(r"(.*?)((?:[^・を]+?)(?:または[^・を]+?)+)(?:(\d+|X)(?:人|体)(まで)?|全て)", t)   # "クリーチャーまたはクリーチャー♂1人"
    if m:
        parts = m.group(2).split("または")
        icons = class_tokens("/".join(parts))
        sel = parse_selector(m.group(1))
        if icons and sel is not None and len(icons) == len(parts):
            sel["icons"] = icons
            if m.group(3) is None: return ("ref", {"all": sel})
            spec = {"kind": "char", "sel": sel, "count": "X" if m.group(3) == "X" else int(m.group(3))}
            if m.group(4): spec["upTo"] = True
            return ("choice", spec)
    m = re.fullmatch(r"(.*?)(プレイヤーまたはキャラクター|キャラクターまたはプレイヤー|キャラクター|プレイヤー)(?:(\d+|X)(?:人|体)(まで)?|全て)", t)
    if m:
        sel = parse_selector(m.group(1))
        if sel is None: return None
        kind = {"キャラクター": "char", "プレイヤー": "player"}.get(m.group(2), "charOrPlayer")
        if m.group(3) is None:   # 全て
            if kind == "char": return ("ref", {"all": sel})
            if kind == "player": return ("ref", "opp" if sel.get("owner") == "opp" else "players")
            return None
        spec = {"kind": kind, "sel": sel, "count": "X" if m.group(3) == "X" else int(m.group(3))}
        if kind != "char": spec["psel"] = {"owner": sel["owner"]} if "owner" in sel else {}
        if m.group(4): spec["upTo"] = True
        return ("choice", spec)
    m = re.fullmatch(r"(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)?の?((?:プロジェクト|ファスト|パーマネント|ブレイク)カード(?:(?:または|・)(?:プロジェクト|ファスト|パーマネント|ブレイク)カード)*)", t)
    if m and m.group(0) == t:   # a kind of card (for "…のコストはN上昇する")
        sel = {"types": [CARD_TYPES_JP[x] for x in re.findall(r"(プロジェクト|ファスト|パーマネント|ブレイク)カード", m.group(2))]}
        if m.group(1): sel["faction"] = FACTION_JP[m.group(1)]
        return ("ref", {"cards": sel})
    m = re.fullmatch(r"(.*?)((?:プロジェクト|ファスト|パーマネント|ブレイク)カード(?:または(?:プロジェクト|ファスト|パーマネント|ブレイク)カード)*)(?:(\d+)枚(まで)?|全て)", t)
    if m:   # a card on the field: a Fast / Project card in use, a Permanent or Break card on a character (Revise#031 #12)
        sel = parse_selector(m.group(1))
        if sel is None: return None
        sel["types"] = [CARD_TYPES_JP[x] for x in re.findall(r"(プロジェクト|ファスト|パーマネント|ブレイク)カード", m.group(2))]
        if m.group(3) is None: return ("ref", {"allCards": sel})
        spec = {"kind": "card", "sel": sel, "count": int(m.group(3))}
        if m.group(4): spec["upTo"] = True
        return ("choice", spec)
    m = re.fullmatch(r"(.*?)((?:[^・]+)(?:・[^・]+)*)(?:(\d+)人(まで)?|全て)", t)   # "イレイザー・イレイザー♂全て": icons as the noun
    if m:
        whole = m.group(1) + m.group(2)
        for i in range(len(whole)):   # the icon noun is the longest tail made only of class icons; the words before it are the selector
            pre, noun = whole[:i], whole[i:]
            icons = class_tokens(noun.replace("・", "/"))
            if icons and len(icons) == len(noun.split("・")) and parse_selector(pre) is not None: break
        else: icons, pre, noun = None, m.group(1), m.group(2)
        sel = parse_selector(pre)
        if icons and sel is not None and len(icons) == len(noun.split("・")):
            sel["icons"] = icons
            if m.group(3) is None: return ("ref", {"all": sel})
            spec = {"kind": "char", "sel": sel, "count": int(m.group(3))}
            if m.group(4): spec["upTo"] = True
            return ("choice", spec)
    return None


# ---------------------------------------------------------------- effects (sentences → steps)
SKILL_VAL = re.compile(r"([^\d∞]+?)([+\-−]?(?:\d+|∞)|X)?")   # "キャパシティ+∞" / "ブースト∞" = 99 (Revise#365)
def skills_list(text):
    """"シールド・バインド1・ドロー+1" → [{id, x}]."""
    out = []
    for part in text.split("・"):
        pm = re.fullmatch(r"(プロテクト|レジスト)(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)", part.strip())
        if pm: out.append({"id": "protect" if pm.group(1) == "プロテクト" else "resist", "x": dict({"factions": [FACTION_JP[pm.group(2)]]}, **({"icons": []} if pm.group(1) == "レジスト" else {}))}); continue   # "プロテクトWIZーDOM" (Revise#109)
        if part.strip() == "▼": out.append({"id": "aggressive", "x": True}); continue   # "▼・ブレイクスルーを与える" (A3-07 1171, Revise#164)
        m = SKILL_VAL.fullmatch(part.strip())
        if not m or m.group(1) not in SKILL_JP: return None
        v = m.group(2)
        out.append({"id": SKILL_JP[m.group(1)], "x": int(v.replace("−", "-").replace("∞", "99")) if v and v != "X" else True})
    return out


def sign_n(s):
    """"+2" → 2, "-1" → -1, "±0" → 0, "+(1)" → 1, "-X" → ("X", -1)."""
    m = re.fullmatch(r"([±+\-ー−])\(?(\d+|X)\)?", s)
    if not m: return None
    sign = -1 if m.group(1) in ("-", "ー", "−") else 1
    return ("X", sign) if m.group(2) == "X" else sign * int(m.group(2))


def stat_steps(until, ref, keys_vals):
    steps = []
    for key, v in keys_vals:
        if v is None: return None
        if isinstance(v, tuple): steps.append({"a": "stat", "to": ref, "key": key, "n": "X", "sign": v[1], "until": until})
        elif v: steps.append({"a": "stat", "to": ref, "key": key, "n": v, "until": until})
    return steps


IMMUNE_TYPES = {"プロジェクトカード": "Project", "ファストカード": "Fast", "エフェクト": "Effect"}


def clause_mods(s, R):
    """A "≪T≫ has / gets / doesn't …" clause shared by effects (with "…終了時まで") and always-on abilities
    → [(ref, mod)] or None. mod = {key, op, value}."""
    s2 = re.sub(r"(?<=/)([+\-ー±]\(?(?:\d+|X)\)?)・[+\-ー]\(?(?:\d+|X)\)?(?=/)", r"\1", s)   # "+X/+X・+(X)/+X" (Revise#266)
    if s2 != s:
        r2 = clause_mods(s2, R)
        if r2: return r2
    T = r"(?:目標の、?)?«(\d|t)»"
    m = re.fullmatch(T + r"の、?ダメージ置き場の(?:カード)?枚数による敗北条件に\+(\d+)枚する", s)   # A4-03 0506 (Revise#310): a player's loss limit
    if m and R(m.group(1)) == "you": return [("you", {"key": "lossPlusP", "op": "grant", "value": int(m.group(2))})]
    m = re.fullmatch(T + r"は、?([^«]+?)を得、(«.+)", s)   # "≪このキャラクター≫はバインド0を得、≪あなた≫の…敗北条件に+20枚する" (A4-03 0506, Revise#310): two clauses
    if m and skills_list(m.group(2)) and clause_mods(m.group(3), R):
        return [(R(m.group(1)), {"key": "skill", "op": "grant", "value": x}) for x in skills_list(m.group(2))] + clause_mods(m.group(3), R)
    m = re.fullmatch(T + r"は、?(.+?)を得、(精神力|攻撃力|耐久力)に、?([±+\-ー−]\(?[\dX]+\)?)(?:する|される)", s)
    if m:
        sk, v = skills_list(m.group(2)), sign_n(m.group(4))
        if sk and v is not None:
            return [(R(m.group(1)), {"key": "skill", "op": "grant", "value": x}) for x in sk] + [(R(m.group(1)), {"key": STAT_JP[m.group(3)], "op": "add", "value": {"xvar": True, "sign": v[1]} if isinstance(v, tuple) else v})]
    m = re.fullmatch(T + r"に(.+?)を与え、([±+\-ー−]\(?\d+\)?)/([±+\-ー−]\(?\d+\)?)/([±+\-ー−]\(?\d+\)?)する", s)   # A3-20 2691 (Revise#165)
    if m and skills_list(m.group(2)):
        return [(R(m.group(1)), {"key": "skill", "op": "grant", "value": x}) for x in skills_list(m.group(2))] + [(R(m.group(1)), {"key": k, "op": "add", "value": sign_n(m.group(g))}) for k, g in (("se", 3), ("at", 4), ("de", 5)) if sign_n(m.group(g))]
    m = re.fullmatch(T + r"は、?(.+?)を得、([±+\-ー−]\(?\d+\)?)/([±+\-ー−]\(?\d+\)?)/([±+\-ー−]\(?\d+\)?)される", s)   # A3-24 3508 (Revise#164)
    if m and skills_list(m.group(2)):
        return [(R(m.group(1)), {"key": "skill", "op": "grant", "value": x}) for x in skills_list(m.group(2))] + [(R(m.group(1)), {"key": k, "op": "add", "value": sign_n(m.group(g))}) for k, g in (("se", 3), ("at", 4), ("de", 5)) if sign_n(m.group(g))]
    m = re.fullmatch(T + r"は、?([±+\-ー−]\(?\d+\)?)/([±+\-ー−]\(?\d+\)?)/([±+\-ー−]\(?\d+\)?)され、(.+?)を得る", s)
    if m and skills_list(m.group(5)):
        return [(R(m.group(1)), {"key": k, "op": "add", "value": sign_n(m.group(g))}) for k, g in (("se", 2), ("at", 3), ("de", 4)) if sign_n(m.group(g))] + [(R(m.group(1)), {"key": "skill", "op": "grant", "value": x}) for x in skills_list(m.group(5))]
    m = re.fullmatch(T + r"の(?:持つ)?スキル・エフェクト(?:全て)?を無効化する", s)
    if m: return [(R(m.group(1)), {"key": "negate", "op": "grant", "value": {"skills": True, "effects": True}})]
    m = re.fullmatch(T + r"は、?バトルによる精神ダメージを受けない", s)
    if m: return [(R(m.group(1)), {"key": "noDamage", "op": "grant", "value": {"battle": True, "mental": True}})]
    m = re.fullmatch(T + r"は、?(精神力|攻撃力|耐久力)に、?([±+\-ー−]\(?[\dX]+\)?)される", s)
    if m and sign_n(m.group(3)) is not None and not isinstance(sign_n(m.group(3)), tuple): return [(R(m.group(1)), {"key": STAT_JP[m.group(2)], "op": "add", "value": sign_n(m.group(3))})]
    m = re.fullmatch(T + r"は、?([±+\-ー−]\(?[\dX]+\)?)/([±+\-ー−]\(?[\dX]+\)?)/([±+\-ー−]\(?[\dX]+\)?)される", s)
    if m:
        vs = [sign_n(m.group(g)) for g in (2, 3, 4)]
        if all(v is not None for v in vs): return [(R(m.group(1)), {"key": k, "op": "add", "value": {"xvar": True, "sign": v[1]} if isinstance(v, tuple) else v}) for k, v in zip(("se", "at", "de"), vs) if v]
    m = re.fullmatch(T + r"の(精神力|攻撃力|耐久力)を(\d+)にする", s)
    if m: return [(R(m.group(1)), {"key": STAT_JP[m.group(2)], "op": "set", "value": int(m.group(3))})]
    m = re.fullmatch(T + r"の攻撃力に(?:[\-ー−])X・[ー−\-]\(X\)(?:して判定)?する", s) or re.fullmatch(T + r"の攻撃力に[ー−\-]\(X\)・[\-ー−]X(?:して判定)?する", s)   # "-X・ー(X)" / "ー(X)・-X": normal or mental attack, whichever it has
    if m: return [(R(m.group(1)), {"key": "at", "op": "add", "value": {"xvar": True, "sign": -1}})]
    m = re.fullmatch(T + r"は、?アタック宣言・ガード宣言・コストの支払い(?:が)?できない", s)   # A4-01 0053 … (Revise#265)
    if m: return [(R(m.group(1)), {"key": "noAttack", "op": "grant", "value": True}), (R(m.group(1)), {"key": "noGuard", "op": "grant", "value": True}), (R(m.group(1)), {"key": "noPay", "op": "grant", "value": True})]
    m = re.fullmatch(T + r"は、?アタック宣言・ガード宣言・エフェクトの使用宣言(?:が)?できない", s)   # A3-EX05 EX0622 / EX0634 (Revise#264)
    if m: return [(R(m.group(1)), {"key": "noAttack", "op": "grant", "value": True}), (R(m.group(1)), {"key": "noGuard", "op": "grant", "value": True}), (R(m.group(1)), {"key": "noEffect", "op": "grant", "value": True})]
    m = re.fullmatch(T + r"は、?(?:アタック宣言・ガード宣言(?:が)?|アタック・ガード)できない", s)
    if m: return [(R(m.group(1)), {"key": "noAttack", "op": "grant", "value": True}), (R(m.group(1)), {"key": "noGuard", "op": "grant", "value": True})]
    m = re.fullmatch(T + r"の(精神力|攻撃力|耐久力)に、?([±+\-ー−]\(?[\dX]+\)?)(?:して判定)?(?:する|される)", s)
    if m:
        v = sign_n(m.group(3))
        if v is None: return None
        return [(R(m.group(1)), {"key": STAT_JP[m.group(2)], "op": "add", "value": {"xvar": True, "sign": v[1]} if isinstance(v, tuple) else v})]
    m = re.fullmatch(T + r"に([±+\-ー−]\(?[\dX]+\)?)/([±+\-ー−]\(?[\dX]+\)?)/([±+\-ー−]\(?[\dX]+\)?)(?:して判定)?する", s)
    if m:
        out = []
        for key, g in (("se", 2), ("at", 3), ("de", 4)):
            v = sign_n(m.group(g))
            if v is None: return None
            if v: out.append((R(m.group(1)), {"key": key, "op": "add", "value": {"xvar": True, "sign": v[1]} if isinstance(v, tuple) else v}))
        return out
    m = re.fullmatch(T + r"は、?(.+?)を得る", s) or re.fullmatch(T + r"に、?(.+?)を与える", s)
    if m:
        sk = skills_list(m.group(2))
        if sk: return [(R(m.group(1)), {"key": "skill", "op": "grant", "value": x}) for x in sk]
    m = re.fullmatch(T + r"は、?(?:精神ダメージ・バトル以外のダメージ|バトル以外のダメージ・精神ダメージ)を受けない", s)
    if m: return [(R(m.group(1)), {"key": "noDamage", "op": "grant", "value": {"mental": True}}), (R(m.group(1)), {"key": "noDamage", "op": "grant", "value": {"outside": True}})]
    m = re.fullmatch(T + r"は、?ネーム“([^”]+)”を持つ", s)   # Revise#157
    if m: return [(R(m.group(1)), {"key": "alsoName", "op": "grant", "value": re.sub(r"\s+", "", m.group(2))})]
    m = re.fullmatch(T + r"は、?“([^”]+)”としても扱う", s)
    if m: return [(R(m.group(1)), {"key": "alsoName", "op": "grant", "value": re.sub(r"\s+", "", m.group(2))})]
    m = re.fullmatch(T + r"から、?あなたの支配キャラクターの((?:アタック|ガード)コスト(?:・(?:アタック|ガード)コスト)?)を代わりに支払うこと(?:が可能|ができる)", s)
    if m: return [(R(m.group(1)), {"key": "payFor", "op": "grant", "value": {"kinds": ["attack" if "アタック" in x else "guard" for x in m.group(2).split("・")]}})]
    m = re.fullmatch(T + r"の必要ファクターは(\d+)減少する", s)
    if m: return [(R(m.group(1)), {"key": "factorLess", "op": "add", "value": int(m.group(2))})]
    m = re.fullmatch(T + r"が勢力キャラクターから受けるダメージの数値に[-ー−](\d+)して判定する", s)
    if m: return [(R(m.group(1)), {"key": "playerDmgReduce", "op": "add", "value": {"n": int(m.group(2)), "from": "active"}})]
    m = re.fullmatch(T + r"のコストは(\d+)(上昇|減少)する", s)
    if m: return [(R(m.group(1)), {"key": "cardCost", "op": "add", "value": int(m.group(2)) * (1 if m.group(3) == "上昇" else -1)})]
    if re.fullmatch(T + r"は、?ガード宣言されない", s): return [(R(re.match(T, s).group(1)), {"key": "noGuardBy", "op": "grant", "value": {}})]   # EX871 (Revise#242)
    m = re.fullmatch(T + r"は、?(?:あなたの)?対戦相手の使用した(プロジェクトカード・ファストカード(?:・エフェクト)?)の効果を受けない", s)   # EX0683 (Revise#242)
    if m: return [(R(m.group(1)), {"key": "untargetable", "op": "grant", "value": {"from": ["Project", "Fast"] + (["Effect"] if "エフェクト" in m.group(2) else []), "byOpp": True}})]
    m = re.fullmatch(T + r"は、?(アタック|ガード)コストが(\d+)(上昇|減少)する", s)   # EX827 (Revise#242)
    if m: return [(R(m.group(1)), {"key": "attackCost" if m.group(2) == "アタック" else "guardCost", "op": "add", "value": int(m.group(3)) * (1 if m.group(4) == "上昇" else -1)})]
    m = re.fullmatch(T + r"の(アタックコスト(?:・ガードコスト)?(?:・エフェクトコスト)?|ガードコスト|エフェクトコスト)は(\d+)(上昇|減少)する", s)   # EX827 #2 (Revise#242)
    if m: return [(R(m.group(1)), {"key": {"アタック": "attackCost", "ガード": "guardCost", "エフェクト": "effectCost"}[k], "op": "add", "value": int(m.group(3)) * (1 if m.group(4) == "上昇" else -1)}) for k in re.findall(r"(アタック|ガード|エフェクト)コスト", m.group(2))]
    m = re.fullmatch(T + r"は、?(.+?)キャラクターにガードされない", s)
    if m and parse_selector(m.group(2)) is not None: return [(R(m.group(1)), {"key": "noGuardBy", "op": "grant", "value": parse_selector(m.group(2))})]
    m = re.fullmatch(T + r"は、?ブレイクスルーを持つキャラクターをガード可能", s)
    if m: return [(R(m.group(1)), {"key": "guardBreakthrough", "op": "grant", "value": True})]
    m = re.fullmatch(T + r"は、?(?:精神ダメージ|精神攻撃によるダメージ)を受けない", s)
    if m: return [(R(m.group(1)), {"key": "noDamage", "op": "grant", "value": {"mental": True}})]
    m = re.fullmatch(T + r"は、?(バトル以外で|バトル以外の)ダメージを受けない", s)
    if m: return [(R(m.group(1)), {"key": "noDamage", "op": "grant", "value": {"outside": True}})]
    m = re.fullmatch(T + r"は、?アタック以外のダメージを受けない", s)   # A4-02 0275 / 0290 (Revise#282): a player
    if m: return [(R(m.group(1)), {"key": "playerNoDamage", "op": "grant", "value": {"exceptAttack": True}})]
    m = re.fullmatch(T + r"は、?(?:バトルによる)?ダメージを受けない", s)
    if m: return [(R(m.group(1)), {"key": "noDamage", "op": "grant", "value": {"battle": "バトル" in s} if "バトル" in s else {}})]
    m = re.fullmatch(T + r"は、?自身の必要ファクター以下の必要ファクターの(ブレイクしている)?キャラクターとのバトルによるダメージを受けない", s)   # A3-EXPR EXPR044 / A3-25 3622 (M5)
    if m: return [(R(m.group(1)), {"key": "noDamage", "op": "grant", "value": dict({"battle": True, "fromFactorLeSelf": True}, **({"fromBroken": True} if m.group(2) else {}))})]
    m = re.fullmatch(T + r"は、?そのキャラクターの精神力以下の精神力のキャラクターとのバトルによるダメージを受けない", s)   # A3-05 0735
    if m: return [(R(m.group(1)), {"key": "noDamage", "op": "grant", "value": {"battle": True, "fromSeLeSelf": True}})]
    m = re.fullmatch(T + r"は、?(.+?)キャラクター以外からダメージを受けない", s)   # A4-EP EP451 (Revise#311): damage only from such characters
    if m and parse_selector(m.group(2)): return [(R(m.group(1)), {"key": "noDamage", "op": "grant", "value": {"onlyFromSel": parse_selector(m.group(2))}})]
    m = re.fullmatch(T + r"は、?(.+?)キャラクター以外とのバトルによるダメージを受けない", re.sub(r"パワ[-ｰ](?=\d)", "パワー", s))   # A4-01 0146 / 0160 (Revise#281)
    if m and m.group(2) and parse_selector(m.group(2)): return [(R(m.group(1)), {"key": "noDamage", "op": "grant", "value": {"battle": True, "fromSel": {"notSel": parse_selector(m.group(2))}}})]
    m = re.fullmatch(T + r"は、?(.+?)とのバトルによるダメージを受けない", s)
    if m:
        src = re.sub(r"キャラクター$", "", m.group(2))
        sel = parse_selector(src) if src else {}
        if sel is not None: return [(R(m.group(1)), {"key": "noDamage", "op": "grant", "value": {"battle": True, "fromSel": sel}})]
    m = re.fullmatch(T + r"は、?(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)の((?:プロジェクト|ファスト)カード(?:・(?:プロジェクト|ファスト)カード)*)の(?:効果を受けない|目標にならない)", s)
    if m: return [(R(m.group(1)), {"key": "untargetable", "op": "grant", "value": {"from": [IMMUNE_TYPES[x] for x in m.group(3).split("・")], "faction": FACTION_JP[m.group(2)]}})]
    m = re.fullmatch(T + r"は、?(.*?)キャラクターのエフェクトの(?:効果を受けない|目標にならない)", s)
    if m and parse_selector(m.group(2)) is not None: return [(R(m.group(1)), {"key": "untargetable", "op": "grant", "value": {"from": ["Effect"], "bySel": parse_selector(m.group(2))}})]
    m = re.fullmatch(T + r"は、?((?:プロジェクトカード|ファストカード|エフェクト)(?:・(?:プロジェクトカード|ファストカード|エフェクト))*)の(?:効果を受けない|目標にならない)", s)
    if m: return [(R(m.group(1)), {"key": "untargetable", "op": "grant", "value": {"from": [IMMUNE_TYPES[x] for x in m.group(2).split("・")]}})]
    m = re.fullmatch(T + r"は(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のファクターを(\d+)つ持つ", s)
    if m: return [(R(m.group(1)), {"key": "factor", "op": "add", "value": {"faction": FACTION_JP[m.group(2)], "n": int(m.group(3))}})]
    m = re.fullmatch(T + r"は、?(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)と(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のファクターを(\d+)つずつ持つ", s)
    if m: return [(R(m.group(1)), {"key": "factor", "op": "add", "value": {"faction": FACTION_JP[g], "n": int(m.group(4))}}) for g in (m.group(2), m.group(3))]
    m = re.fullmatch(T + r"は、?(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のファクターを(\d+)つ(?:追加で)?(?:持つ|得る)", s)
    if m: return [(R(m.group(1)), {"key": "factor", "op": "add", "value": {"faction": FACTION_JP[m.group(2)], "n": int(m.group(3))}})]
    m = re.fullmatch(T + r"は、?([^、。«]+?)を得、あなたの対戦相手(?:が|の)使用した((?:プロジェクトカード|ファストカード|エフェクト)(?:・(?:プロジェクトカード|ファストカード|エフェクト))*)の効果を受けない", s)   # A4-EP EP606 (Revise#312)
    if m and skills_list(m.group(2)): return [(R(m.group(1)), {"key": "skill", "op": "grant", "value": x}) for x in skills_list(m.group(2))] + [(R(m.group(1)), {"key": "untargetable", "op": "grant", "value": {"from": [IMMUNE_TYPES[x] for x in m.group(3).split("・")], "byOpp": True}})]
    m = re.fullmatch(T + r"は、?エフェクト全てが無効化され、アタックできない", s)   # A4-PR PR147 (Revise#339)
    if m: return [(R(m.group(1)), {"key": "negate", "op": "grant", "value": {"effects": True, "skills": False}}), (R(m.group(1)), {"key": "noAttack", "op": "grant", "value": True})]
    m = re.fullmatch(T + r"は、?イニシアチブを(\d+)つ得る", s)   # A4-EX01 EX0746 (Revise#339): each one counts
    if m: return [(R(m.group(1)), {"key": "skill", "op": "grant", "value": {"id": "initiative", "x": True}})] * int(m.group(2))
    m = re.fullmatch(T + r"は冥を(\d+)つ得る", s)   # 冥 (A4-03 0512, Revise#310): a factor of its own
    if m: return [(R(m.group(1)), {"key": "factor", "op": "add", "value": {"faction": "Nether", "n": int(m.group(2))}})]
    m = re.fullmatch(T + r"は(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のファクターを(\d+)つ得る", s)
    if m: return [(R(m.group(1)), {"key": "factor", "op": "add", "value": {"faction": FACTION_JP[m.group(2)], "n": int(m.group(3))}})]
    m = re.fullmatch(T + r"の持つ((?:[^・の]+)(?:・[^・の]+)*)のスキル(?:全て)?を無効化する", s)   # "…のスキルを無効化する" (A4-PR PR029, Revise#310)
    if m and all(SKILL_JP.get(x) for x in m.group(2).split("・")): return [(R(m.group(1)), {"key": "skill", "op": "remove", "value": {"id": SKILL_JP[x]}}) for x in m.group(2).split("・")]
    m = re.fullmatch(T + r"の(?:持つ)?スキル全て(とエフェクト全て)?を無効化する", s)
    if m: return [(R(m.group(1)), {"key": "negate", "op": "grant", "value": {"skills": True, "effects": bool(m.group(2))}})]
    m = re.fullmatch(T + r"の(?:持つ)?((?:バインド|イニシアチブ|ペネトレイト|パーマネント|レジスト|チャージ|ドロー|シールド|インターセプト)[^を]*?)を無効化(?:する|し、(.+?)を与える)", s)
    if m:   # "≪バトル相手≫の持つバインドXを無効化する" / "…パーマネント+Xを無効化し、パーマネント-1を与える"
        ids = [dict(SKILL_JP, レジスト="resist", プロテクト="protect").get(re.sub(r"[+\-−]?(?:\d+|X|\?|？)$", "", x)) for x in m.group(2).split("・")]
        add = skills_list(m.group(3)) if m.group(3) else []
        if all(ids) and add is not None:
            return [(R(m.group(1)), {"key": "skill", "op": "remove", "value": {"id": i}}) for i in ids] + [(R(m.group(1)), {"key": "skill", "op": "grant", "value": x}) for x in add]
    m = re.fullmatch(T + r"は、?分類・?(.+?)を持つ", s)
    if m: return [(R(m.group(1)), {"key": "icon", "op": "grant", "value": re.sub(r"\s+", "", m.group(2))})]
    m = re.fullmatch(T + r"は、?(?:分類・)?([^、]+?)、(.+?)を得る", s)   # "ドラグーン♂、バインド0を得る" (A3-21 3021, Revise#165)
    if m and class_tokens(m.group(2)) and len(class_tokens(m.group(2))) == len(m.group(2).split("・")) and skills_list(m.group(3)):
        return [(R(m.group(1)), {"key": "icon", "op": "grant", "value": i}) for i in class_tokens(m.group(2))] + [(R(m.group(1)), {"key": "skill", "op": "grant", "value": dict(x, set=True) if x["id"] == "bind" and x["x"] == 0 else x}) for x in skills_list(m.group(3))]
    m = re.fullmatch(T + r"は、?(?:分類・)?(.+?)を得る", s)   # "≪このキャラクター≫はスチューデントを得る" (class icons; Revise#164)
    if m and not skills_list(m.group(2)):
        g2 = re.sub(r"^([^・♂]+?)\1♂$", r"\1・\1♂", re.sub(r"[\s　]+", "・", m.group(2).strip()))   # "ウォリアーウォリアー♂" / "ワーカー ワータイガー" = both
        ics = class_tokens(g2)
        if ics and len(ics) == len(re.split(r"[・/]", g2)): return [(R(m.group(1)), {"key": "icon", "op": "grant", "value": i}) for i in ics]
    m = re.fullmatch(T + r"は(アタック|ガード)宣言できない", s)
    if m: return [(R(m.group(1)), {"key": "noAttack" if m.group(2) == "アタック" else "noGuard", "op": "grant", "value": True})]
    m = re.fullmatch(T + r"の持つ(スキル・)?エフェクト全てを無効化する", s) or re.fullmatch(T + r"の(スキル・)?エフェクト全てを無効化する", s)
    if m: return [(R(m.group(1)), {"key": "negate", "op": "grant", "value": {"effects": True, "skills": bool(m.group(2))}})]
    m = re.fullmatch(T + r"にパワーカードをセットすることはできない", s)
    if m: return [(R(m.group(1)), {"key": "noCharge", "op": "grant", "value": True})]
    m = re.fullmatch(T + r"の((?:アタック|ガード|エフェクト)コスト(?:・(?:アタック|ガード|エフェクト)コスト)*)は(X|\d+)(上昇|減少)する", s)
    if m:
        sg = 1 if m.group(4) == "上昇" else -1
        return [(R(m.group(1)), {"key": {"アタックコスト": "attackCost", "ガードコスト": "guardCost", "エフェクトコスト": "effectCost"}[k], "op": "add", "value": {"xvar": True, "sign": sg} if m.group(3) == "X" else sg * int(m.group(3))}) for k in m.group(2).split("・")]
    m = re.fullmatch(T + r"は、?(精神力|攻撃力|耐久力)に([±+\-ー−]\d+)し、(.+?)を得る", s)
    if m and skills_list(m.group(4)): return [(R(m.group(1)), {"key": STAT_JP[m.group(2)], "op": "add", "value": sign_n(m.group(3))})] + [(R(m.group(1)), {"key": "skill", "op": "grant", "value": x}) for x in skills_list(m.group(4))]
    m = re.fullmatch(T + r"は、?((?:E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)(?:・(?:E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー))+)の((?:プロジェクトカード|ファストカード|エフェクト)(?:・(?:プロジェクトカード|ファストカード|エフェクト))*)の(?:効果を受けない|目標にならない)", s)
    if m: return [(R(m.group(1)), {"key": "untargetable", "op": "grant", "value": {"from": [IMMUNE_TYPES[x] for x in m.group(3).split("・")], "faction": [FACTION_JP[x] for x in m.group(2).split("・")]}})]
    m = re.fullmatch(T + r"は、?バトルによる通常ダメージを受けない", s)
    if m: return [(R(m.group(1)), {"key": "noDamage", "op": "grant", "value": {"battleNormal": True}})]
    m = re.fullmatch(T + r"は、?同じ分類を一種類以上持つキャラクター以外とのバトルによるダメージを受けない", s)
    if m: return [(R(m.group(1)), {"key": "noDamage", "op": "grant", "value": {"battle": True, "fromSel": {"noSharedIcon": True}}})]
    m = re.fullmatch(T + r"は、?攻撃力に-X・\+\(X\)され、(.+?)を得る", s)
    if m and skills_list(m.group(2)): return [(R(m.group(1)), {"key": "atToMental", "op": "add", "value": {"xvar": True, "sign": 1}})] + [(R(m.group(1)), {"key": "skill", "op": "grant", "value": x}) for x in skills_list(m.group(2))]
    m = re.fullmatch(T + r"は、?通常ダメージを受けない", s)
    if m: return [(R(m.group(1)), {"key": "noDamage", "op": "grant", "value": {"normal": True}})]
    m = re.fullmatch(T + r"は、?アタックできない", s)   # A3-24 3581 (Revise#166)
    if m: return [(R(m.group(1)), {"key": "noAttack", "op": "grant", "value": True})]
    m = re.fullmatch(T + r"の攻撃力に[-ー−]X・[+＋]\(X\)(?:して判定)?する", s)   # A3-08 1244 (Revise#166): X of its normal attack as mental
    if m: return [(R(m.group(1)), {"key": "atToMental", "op": "add", "value": {"xvar": True, "sign": 1}})]
    m = re.fullmatch(T + r"の攻撃力に[+＋]X・[-ー−]\(X\)(?:して判定)?する", s)   # X of its mental attack as normal
    if m: return [(R(m.group(1)), {"key": "atToNormal", "op": "add", "value": {"xvar": True, "sign": 1}})]
    m = re.fullmatch(T + r"は、?プロジェクトカード・このカード以外のファストカード・エフェクト(?:・アビリティ)?の効果を受けない", s)   # A3-25 3624 (Revise#166)
    if m: return [(R(m.group(1)), {"key": "untargetable", "op": "grant", "value": {"from": ["Project", "Fast", "Effect"], "exceptCard": "self"}})]
    m = re.fullmatch(T + r"の持つスキル・エフェクト全てと、?(?:目標|対象)のアタック宣言・ガード宣言を無効化する", s)   # A3-09 1454 (Revise#171)
    if m: return [(R(m.group(1)), {"key": "negate", "op": "grant", "value": {"skills": True, "effects": True}}), (R(m.group(1)), {"key": "noAttack", "op": "grant", "value": True}), (R(m.group(1)), {"key": "noGuard", "op": "grant", "value": True})]
    m = re.fullmatch(T + r"は、?ファクター全てを失う", s)   # A3-09 1454 (Revise#171)
    if m: return [(R(m.group(1)), {"key": "noFactor", "op": "grant", "value": True})]
    m = re.fullmatch(T + r"は、?(?:目標|«t»)と同じ分類を一種類以上持つキャラクターにガードされない", s)   # A3-11 1688: the attacker's own classes
    if m: return [(R(m.group(1)), {"key": "noGuardBy", "op": "grant", "value": {"shareIconSelf": True}})]
    m = re.fullmatch(T + r"の持つコスト(X|\d+)以下のエフェクト全てを無効化する", s)   # A3-25 3733 (Revise#170)
    if m: return [(R(m.group(1)), {"key": "negate", "op": "grant", "value": {"effCostMax": "X" if m.group(2) == "X" else int(m.group(2))}})]
    m = re.fullmatch(T + r"に与えられる(精神)?ダメージに[-ー−]\(?(X|\d+)\)?して判定する", s)   # A3-14 1922 (Revise#172)
    if m: return [(R(m.group(1)), {"key": "dmgReduce", "op": "add", "value": {("mental" if m.group(2) else "normal"): ("X" if m.group(3) == "X" else int(m.group(3)))}})]
    m = re.fullmatch(T + r"は、?ガードコストを無視してガード宣言可能", s)   # A3-20 2727 (Revise#172)
    if m: return [(R(m.group(1)), {"key": "guardFree", "op": "grant", "value": True})]
    m = re.fullmatch(T + r"は、?このカード以外のファストカードの効果を受けない", s)   # A3-14 1976
    if m: return [(R(m.group(1)), {"key": "untargetable", "op": "grant", "value": {"from": ["Fast"], "exceptCard": "self"}})]
    m = re.fullmatch(T + r"は、?あなた以外のプレイヤーにブレイクカードをセットされない", s)   # A3-24 3583 (Revise#170)
    if m: return [(R(m.group(1)), {"key": "noBreakByOpp", "op": "grant", "value": True})]
    m = re.fullmatch(T + r"の精神力と耐久力を入れ替えて判定する", s)   # A3-09 1320 (Revise#168)
    if m: return [(R(m.group(1)), {"key": "swapSeDe", "op": "grant", "value": True})]
    m = re.fullmatch(T + r"は、?そのキャラクターを場に残す効果を受けない", s)   # A3-24 3511 (Revise#166)
    if m: return [(R(m.group(1)), {"key": "noKeep", "op": "grant", "value": True})]
    m = re.fullmatch(T + r"は、?カードをセットすることができない", s)
    if m: return [(R(m.group(1)), {"key": "noSetOn", "op": "grant", "value": True})]
    m = re.fullmatch(T + r"は、?ファクター全てを失い、(.+)", s)   # A3-07 1135 (Revise#166)
    if m:
        sub = clause_mods("«" + m.group(1) + "»は、" + m.group(2), R)
        if sub: return [(R(m.group(1)), {"key": "noFactor", "op": "grant", "value": True})] + sub
    m = re.fullmatch(T + r"は、?((?:[^、]+?(?:ず|できず)、)+[^、]+?ない)", s)   # "≪T≫は、Aず、Bず、Cない" → each clause (Revise#166)
    if m and "ず、" in m.group(2):
        parts = m.group(2).split("ず、")
        out = []
        for i, p in enumerate(parts):
            sub = clause_mods("«" + m.group(1) + "»は、" + (p + "ない" if i < len(parts) - 1 else p), R)
            if not sub: out = None; break
            out += sub
        if out: return out
    m = re.fullmatch(T + r"から、?(?:は、?)?((?:アタック|ガード)コスト(?:・(?:アタック|ガード)コスト)?)を支払うことはできない", s)   # A3-09 1382 / 1449 (Revise#166)
    if m: return [(R(m.group(1)), {"key": "noPay", "op": "grant", "value": {"kinds": ["attack" if "アタック" in x else "guard" for x in m.group(2).split("・")]}})]
    m = re.fullmatch(T + r"は、?アタックコスト・ガードコストを支払うことができない", s)   # A4-EP EP501 / EP513 (Revise#293)
    if m: return [(R(m.group(1)), {"key": "noPay", "op": "grant", "value": {"kinds": ["attack", "guard"]}})]
    m = re.fullmatch(T + r"は、?コストを支払うことができない", s)   # A3-24 3434 (Revise#165)
    if m: return [(R(m.group(1)), {"key": "noPay", "op": "grant", "value": True})]
    m = re.fullmatch(T + r"から(?:は、?)?コストを支払うこと(?:は|が)できない", s)
    if m: return [(R(m.group(1)), {"key": "noPay", "op": "grant", "value": True})]
    m = re.fullmatch(T + r"は、?エフェクトの使用宣言をすることができない", s)
    if m: return [(R(m.group(1)), {"key": "noEffect", "op": "grant", "value": True})]
    m = re.fullmatch(T + r"に([±+\-ー−]\(?\d+\)?)/([±+\-ー−]\(?\d+\)?)/([±+\-ー−]\(?\d+\)?)し、(.+?)を与える", s)
    if m and skills_list(m.group(5)): return [(R(m.group(1)), {"key": k, "op": "add", "value": sign_n(m.group(g))}) for k, g in (("se", 2), ("at", 3), ("de", 4)) if sign_n(m.group(g))] + [(R(m.group(1)), {"key": "skill", "op": "grant", "value": x}) for x in skills_list(m.group(5))]
    m = re.fullmatch(T + r"の持つ(.+?)を無効化し、([±+\-ー−]\(?\d+\)?)/([±+\-ー−]\(?\d+\)?)/([±+\-ー−]\(?\d+\)?)して判定する", s)
    if m and skills_list(m.group(2)): return [(R(m.group(1)), {"key": "skill", "op": "remove", "value": {"id": x["id"]}}) for x in skills_list(m.group(2))] + [(R(m.group(1)), {"key": k, "op": "add", "value": sign_n(m.group(g))}) for k, g in (("se", 3), ("at", 4), ("de", 5)) if sign_n(m.group(g))]
    m = re.fullmatch(T + r"は、?\(X\)以下のダメージを受けない", s)
    if m: return [(R(m.group(1)), {"key": "noDamage", "op": "grant", "value": {"_mentalMaxX": True}})]
    m = re.fullmatch(T + r"は、?パワー以下の数値のダメージを受けない", s)
    if m: return [(R(m.group(1)), {"key": "noDamage", "op": "grant", "value": {"maxPower": True}})]
    m = re.fullmatch(T + r"は、?(.+?)キャラクターをガードできない", s)
    if m and parse_selector(m.group(2)) is not None: return [(R(m.group(1)), {"key": "noGuardVs", "op": "grant", "value": parse_selector(m.group(2))})]
    m = re.fullmatch(T + r"は、?手札をパワーカードとしてセットすることはできない", s)
    if m: return [(R(m.group(1)), {"key": "noHandCharge", "op": "grant", "value": True})]
    m = re.fullmatch(T + r"は、?アタック宣言・ガード宣言できず、" + T + r"からコストを支払うことはできない", s)
    if m: return [(R(m.group(1)), {"key": k, "op": "grant", "value": True}) for k in ("noAttack", "noGuard", "noPay")]
    m = re.fullmatch(T + r"を目標とする、?((?:プロジェクトカード|ファストカード|エフェクト)(?:または(?:プロジェクトカード|ファストカード|エフェクト))*)の使用宣言はできない", s)
    if m: return [(R(m.group(1)), {"key": "untargetable", "op": "grant", "value": {"from": [IMMUNE_TYPES[x] for x in m.group(2).split("または")]}})]
    m = re.fullmatch(T + r"から、?(?:あなたの支配キャラクターの(" + "|".join(TOKEN_NAMES) + r")|分類・(\S+?)を持つあなたの支配キャラクター)の((?:アタック|ガード|エフェクト)コスト(?:・(?:アタック|ガード|エフェクト)コスト)*)を代わりに支払うこと(?:が可能|ができる)", s)
    if m:
        kinds = [{"アタックコスト": "attack", "ガードコスト": "guard", "エフェクトコスト": "effect"}[x] for x in m.group(4).split("・")]
        return [(R(m.group(1)), {"key": "payFor", "op": "grant", "value": dict({"kinds": kinds}, **({"tokenName": m.group(2)} if m.group(2) else {"icons": class_tokens(m.group(3)) or [m.group(3)]}))})]
    m = re.fullmatch(T + r"から、?(?:カード名称に「([^」]+)」を含む)?あなたの支配キャラクターの((?:アタック|ガード)コスト(?:・(?:アタック|ガード)コスト)?)を代わりに支払うこと(?:が可能|ができる)", s)   # Revise#129
    if m: return [(R(m.group(1)), {"key": "payFor", "op": "grant", "value": dict({"kinds": ["attack" if "アタック" in x else "guard" for x in m.group(3).split("・")]}, **({"nameHas": m.group(2)} if m.group(2) else {}))})]
    m = re.fullmatch(T + r"から、?カード名称に「([^」]+)」を含むあなたの支配キャラクターの((?:アタック|ガード)コスト(?:・(?:アタック|ガード)コスト)?)を代わりに支払うこと(?:が可能|ができる)", s)
    if m: return [(R(m.group(1)), {"key": "payFor", "op": "grant", "value": {"kinds": ["attack" if "アタック" in x else "guard" for x in m.group(3).split("・")], "nameHas": m.group(2)}})]
    m = re.fullmatch(T + r"から、?あなたの支配キャラクターの((?:[^・]+?)(?:・[^・]+?)*)の((?:アタック|ガード)コスト(?:・(?:アタック|ガード)コスト)?)を代わりに支払うこと(?:が可能|ができる)", s)
    if m and class_tokens(m.group(2).replace("・", "/")) and len(class_tokens(m.group(2).replace("・", "/"))) == len(m.group(2).split("・")):
        return [(R(m.group(1)), {"key": "payFor", "op": "grant", "value": {"kinds": ["attack" if "アタック" in x else "guard" for x in m.group(3).split("・")], "icons": class_tokens(m.group(2).replace("・", "/"))}})]
    m = re.fullmatch(T + r"は、?(?:このカードの下の|このカード以外の、このキャラクターを構成する)キャラクターカード・ブレイクカードのスキル・エフェクト(?:・アビリティ)?全てを持つ", s)
    if m and R(m.group(1)) == "self": return [("self", {"key": "_inheritAll", "op": "grant", "value": True})]
    m = re.fullmatch(T + r"は、?追加のアタックコストとしてパワーカード(\d+)枚を支払うことで、?(.*?)キャラクターを目標にアタック宣言(?:可能|できる)", s)
    if m and parse_selector(m.group(3)) is not None: return [(R(m.group(1)), {"key": "attackChars", "op": "grant", "value": dict(parse_selector(m.group(3)), extraCost=int(m.group(2)))})]
    m = re.fullmatch(T + r"に、?バトルによって与えられた通常ダメージは、?目標のオーナーが代わりに受ける", s)
    if m: return [(R(m.group(1)), {"key": "dmgToOwner", "op": "grant", "value": True})]
    m = re.fullmatch(T + r"は、?(.*?)キャラクターを目標にアタック宣言(?:可能|できる)", s)
    if m and parse_selector(m.group(2)) is not None: return [(R(m.group(1)), {"key": "attackChars", "op": "grant", "value": parse_selector(m.group(2))})]
    m = re.fullmatch(T + r"は、?(.+?)(され|を得|を受けず|できず)、(.+)", s)   # two clauses for one ref: "≪T≫は+X/+X/+Xされ、バトル以外のダメージを受けない" (Revise#109)
    if m:
        a1 = clause_mods("«%s»は" % m.group(1) + m.group(2) + {"され": "される", "を得": "を得る", "を受けず": "を受けない", "できず": "できない"}[m.group(3)], R)
        a2 = clause_mods("«%s»は" % m.group(1) + m.group(4), R)
        if a1 and a2: return a1 + a2
    return None


def sentence_steps(s, ref_of):
    """One sentence (≪T≫ already replaced by «0», «1» …) → steps, or None."""
    s2 = re.sub(r"(?<=/)([+\-ー±]\(?(?:\d+|X)\)?)・[+\-ー]\(?(?:\d+|X)\)?(?=/)", r"\1", s)   # "+X/+X・+(X)/+X" → "+X/+X/+X": the first part counts (Revise#266, as in M3a batch 3)
    if s2 != s:
        r2 = sentence_steps(s2, ref_of)
        if r2 is not None: return r2
    T = r"(?:目標の、?)?«(\d|t)»"
    u = r"(次のターンのターン終了時まで|次のターン終了時まで|メインフェイズ終了時まで|ターン終了時まで|バトル終了時まで|パワーカードフェイズ終了時まで)、"
    def R(i): return "t" if i == "t" else ref_of(int(i))
    # ---- M5 part 7 ----
    if s == "この結果捨て札になったネームレベルのカードは、ダメージ置き場ではなく、捨て札置き場に置く": return []   # A4-PR PR114: the game already does so (named cards go to the Damage Pile only from a battle)
    if re.fullmatch(r"(?:目標|«t»)があなたのパートナーだった場合、さらに±0/\+X/\+Xする", s):   # A4-05 0922 — no Partner in v4: read as "your Name-level character" (Pack, as for 0950)
        return [{"a": "mod", "to": "t", "mod": {"key": k, "op": "add", "value": {"xvar": True, "sign": 1}}, "until": "turn", "ifTOwnNamed": True} for k in ("at", "de")]
    if s == "このキャラクターがあなたのパートナーだった場合、さらにペネトレイトを得る":   # A4-PP PP112 / PP120 — the same reading
        return [{"a": "mod", "to": "self", "mod": {"key": "skill", "op": "grant", "value": {"id": "penetrate", "x": True}}, "until": "turn", "if": {"selfIs": {"named": True}}}]
    if re.fullmatch(r"(?:目標|«t»)が分類タレント・タレント♂を持たない状態で、(?:目標|«t»)がバトル以外のダメージを与えるかメインフェイズが終了した場合、(?:目標|«t»)を捨て札する", s):   # A4-04 0710 (the end of the Main Phase; "deals damage outside a battle" is not built)
        return [{"a": "delayed", "at": "main", "step": {"a": "discardUnlessIcon", "to": "t", "icons": ["タレント", "タレント♂"]}}]
    # ---- M5 part 5 ----
    m = re.fullmatch(r"(あなたの対戦相手いずれか1人のダメージ置き場のカード枚数が\d+枚以上の状態で、このカードが効果を発揮している場合)、メインフェイズ終了時に、(?:目標|«t»)を捨て札する", s)   # A3-EX02 EX0148
    if m and cond_of(m.group(1)): return [{"a": "delayed", "at": "main", "step": {"a": "discard", "to": "t", "if": cond_of(m.group(1))}}]
    m = re.fullmatch(r"(あなたの対戦相手いずれか1人のダメージ置き場のカード枚数が\d+枚以上の場合)、メインフェイズ終了時まで、(?:目標|«t»)にさらに\+X/\+X/\+Xする", s)   # A3-EX02 EX0131 (X: the sentence after it)
    if m and cond_of(m.group(1)): return [{"a": "sameIconBoost", "to": "t", "until": "main", "if": cond_of(m.group(1))}]
    if s == "Xは目標と同じ分類を持つあなたの支配キャラクターの数の合計に等しい" or s == "Xは«t»と同じ分類を持つあなたの支配キャラクターの数の合計に等しい": return []   # EX0131: counted by sameIconBoost
    m = re.fullmatch(r"(?:目標|«t»)が[“\"]([^”\"]+)[”\"]の場合、このカードが効果発揮時に、(?:目標|«t»)のパワーと精神力が等しくなるまであなたのデッキの上からカードを引き、(?:目標|«t»)にパワーカードとしてセットする", s)   # A3-EX02 EX0184
    if m: return [{"a": "fillPowerT", "to": "t", "ifTName": re.sub(r"\s+", "", m.group(1))}]
    if re.fullmatch(r"メインフェイズ終了時まで、(?:«\d»|このカード以外の、このカードと同じ名称のカード)は効果を発揮しない", s): return [{"a": "banSameJp", "until": "main"}]   # A3-EX02 EX0184
    UNT = dict(UNTIL, **{"パワーカードフェイズ終了時まで": "charge"})
    # ---- Revise#318 ----
    m = re.fullmatch(r"(?:その後、)?目標にセットされているパワーカード(\d+)枚を捨て札する", s)   # A4-EX02 EX797
    if m: return [{"a": "powerDiscard", "to": "t", "n": int(m.group(1))}]
    # ---- M3 batch (Revise#199) ----
    m = re.fullmatch(r"(?:その後、)?«(\d)»は、?あなたの手札のブレイク条件を持たない[“\"]([^”\"]+)[”\"]と[“\"]([^”\"]+)[”\"]を、?あなたの支配キャラクターとしてセット可能", s)   # A3-23 3361
    if m and R(m.group(1)) == "you": return [{"a": "pickZone", "zones": ["hand"], "owner": "you", "n": 2, "upTo": True, "distinct": "name", "dest": "back", "sel": {"types": ["Break"], "noBreakRule": True, "anyOf": [{"name": re.sub(r"\s+", "", m.group(2))}, {"name": re.sub(r"\s+", "", m.group(3))}]}}]
    m = re.fullmatch(u + r"«(\d)»は、?あなた、またはあなたの支配キャラクターを目標にアタック宣言する場合、追加で(\d+)コスト支払わなければアタック宣言できない", s)   # A3-24 3547
    if m and raw_text_of(ref_of, m.group(2)) == "キャラクター全て": return [{"a": "field", "mod": {"to": {"players": "all"}, "key": "attackTaxVs", "op": "grant", "value": {"n": int(m.group(3))}, "until": UNT[m.group(1)]}}]
    m = re.fullmatch(u + r"(?:目標|«t»)がアタックした場合、?通常(?:の)?ダメージ判定を行わず、?アタックを受けたプレイヤーのデッキから(?:目標|«t»)の攻撃力に等しい枚数のカードを捨て札する", s)   # A3-24 3506
    if m: return [{"a": "mod", "to": "t", "mod": {"key": "playerHit", "op": "grant", "value": {"effect": {"steps": [{"a": "mill", "to": "evPlayer", "n": "X"}], "status": "auto"}, "replace": True}}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"«(\d)»の攻撃力に、?この効果で捨て札したキャラクターの攻撃力を合計して判定する", s)   # A3-22 3161
    if m and R(m.group(2)) == "self": return [{"a": "mod", "to": "self", "mod": {"key": "at", "op": "add", "value": {"xlastAt": True, "sign": 1}}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"(?:目標の)?«(\d|t)»にキャパシティ-X・チャージ(\d+)を与える", s)   # A3-07 1105: X from the target
    if m: return [{"a": "mod", "to": R(m.group(2)), "resolveSkillX": True, "mod": {"key": "skill", "op": "grant", "value": {"id": "capacity", "x": "-X"}}, "until": UNT[m.group(1)]}, {"a": "mod", "to": R(m.group(2)), "mod": {"key": "skill", "op": "grant", "value": {"id": "charge", "x": int(m.group(3))}}, "until": UNT[m.group(1)]}]
    if re.fullmatch(r"あなたのデッキの上からX枚を引き、(?:対象|目標|«t»)にパワーカードとして1枚ずつセットする", s): return [{"a": "powerFromDeck", "to": "t", "n": 1}]   # A3-11 1608 / BS2 1608: one card on each of the X targets
    m = re.fullmatch(u + r"«(\d)»は、?あなたが次に使用宣言するカードの必要ファクターを無視して使用宣言可能", s)   # PR262 / EP310
    if m and R(m.group(2)) == "you": return [{"a": "field", "mod": {"to": "you", "key": "factorIgnore", "op": "grant", "value": {"next": True}, "until": UNT[m.group(1)]}}]
    m = re.fullmatch(u + r"«(\d)»は、?カードの必要ファクターを無視して使用宣言可能", s)   # A4-PR PR143 (Revise#310): every card, this turn
    if m and R(m.group(2)) in ("players", "you"): return [{"a": "field", "mod": {"to": {"players": "all"} if R(m.group(2)) == "players" else "you", "key": "factorIgnore", "op": "grant", "value": {}, "until": UNT[m.group(1)]}}]
    # ---- M3g batch 2 (Revise#193) ----
    if re.fullmatch(r"この時、メインフェイズ、パワーカードフェイズ、ディスカードフェイズは終了したものとして扱う", s): return []
    m = re.fullmatch(u + r"このキャラクターがバトルする際、«(\d)»の持つスキル全てを無効化する", s)   # EP381 (an effect): until then, its battle opponent's skills are negated
    if m and raw_text_of(ref_of, m.group(2)) == "このキャラクターのバトル相手": return [{"a": "field", "mod": {"to": {"players": "all"}, "key": "battleOppSkillsOff", "op": "grant", "value": True, "until": UNT[m.group(1)]}}]
    m = re.fullmatch(u + r"«(\d)»は(\d+)上昇する", s)   # EX0317 (Revise#200)
    if m and raw_text_of(ref_of, m.group(2)) == "あなたの支配エリアのネームレベルキャラクターのアタック宣言に対してガード宣言する際のガードコスト":
        return [{"a": "mod", "to": {"all": {"owner": "you", "area": "controlled", "named": True}}, "mod": {"key": "guardTaxVs", "op": "add", "value": int(m.group(3))}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(r"(?:目標|«t»)のオーナーのデッキの上からカード(\d+|X)枚を捨て札する", s)   # EX0459 (Revise#200)
    if m: return [{"a": "mill", "to": "tOwner", "n": "X" if m.group(1) == "X" else int(m.group(1))}]
    m = re.fullmatch(r"(?:目標|«t»)のオーナーに(\(?)(\d+|X)\)?ダメージを与える", s)   # "目標のオーナーに3ダメージを与える" without ≪≫ (EXPV043)
    if m: return [{"a": "damage", "to": "tOwner", "n": "X" if m.group(2) == "X" else int(m.group(2)), "mental": bool(m.group(1))}]   # PP030 / PP048 / PR067: the turn ends at once (endMyTurn)
    # ---- Revise#341 ----
    m = re.fullmatch(r"ターン終了時に、あなたの支配エリアに(ブレイクしている)[“\"]([^”\"]+)[”\"]と(?:ブレイクしている)?[“\"]([^”\"]+)[”\"]がいる場合、«(\d)»をデッキに戻し、そのデッキをシャッフルする", s)   # A4-EX01 EX0765 / EXPR064
    if m and raw_text_of(ref_of, m.group(4)) == "このカード":
        return [{"a": "delayed", "at": "turn", "step": {"a": "toDeck", "to": "card", "shuffle": True, "if": {"namesCtl": [re.sub(r"\s+", "", m.group(2)), re.sub(r"\s+", "", m.group(3))], "broken": True}}}]
    m = re.fullmatch(r"«(\d)»はデッキのカード全てを上から順番に公開し、公開されたキャラクターカードを、自身の勢力エリアにセットする", s)   # A4-03 0570 / 0585 / PP171 / PP179
    if m and raw_text_of(ref_of, m.group(1)) == "プレイヤー全て": return [{"a": "deckCharsToActive"}]
    m = re.fullmatch(r"このターン中に、あなたの支配エリアのネームレベルキャラクターが捨て札されている場合、代わりに、?(.+)", s)   # A4-02 0348 / PV070
    if m:
        r2 = sentence_steps(m.group(1), ref_of)
        if r2 and not any(x.get("a") == "manual" for x in r2):
            out2 = [dict(x, **{"if": {"namedGoneTurn": True}}) for x in r2]; out2[0]["_instead"] = {"if": {"namedGoneTurn": True}}
            return out2
    m = re.fullmatch(r"このカードが[“\"]([^”\"]+)[”\"]にセットされた場合、代わりに、?(.+)", s)   # A3-EX01 EX0059 (Revise#215): on that named character, instead
    if m:
        dm = re.fullmatch(r"対象に(\(?)(\d+)\)?ダメージを与える", m.group(2))
        r2 = [{"a": "damage", "to": "_prevAny", "n": int(dm.group(2)), "mental": bool(dm.group(1))}] if dm else sentence_steps(m.group(2), ref_of)
        cond = cond_of("このカードが“" + m.group(1) + "”にセットされている場合")
        if r2 and cond and not any(x.get("a") == "manual" for x in r2):
            out2 = [dict(x, **{"if": cond}) for x in r2]; out2[0]["_instead"] = {"if": cond}
            return out2
    m = re.fullmatch(r"(?:その後、)?あなたの支配エリアに(ブレイクしている)?[“\"]([^”\"]+)[”\"]がいる場合、(代わりに、?)?(?:その後、)?(.+)", s)   # EXPV043 / EX0452; "代わりに" (EX0300 / EX0113, Revise#200)
    if m:
        r2 = sentence_steps(m.group(4), ref_of)
        if r2 and not any(x.get("a") == "manual" for x in r2):
            cond = {"namesCtl": [re.sub(r"\s+", "", m.group(2))], **({"broken": True} if m.group(1) else {})}
            out2 = [dict(x, **{"if": cond}) for x in r2]
            if m.group(3): out2[0]["_instead"] = {"if": cond}
            return out2
    m = re.fullmatch(r"(?:その後、)?このカードのコストが(ブレイクしている)?(?:([^“”\"]+?)を持つ(?:ブレイクしている)?)?[“\"”]([^”\"“]+)[”\"]からのみ支払われ(?:ていた|ている|る|た)場合、(代わりに、?)?(.+)", s)   # EX0316 / EX0453 / EX0457 / EX0464 (Revise#200)
    if m and m.group(5) and not m.group(5).startswith("あなたはこのカードを"):
        g5 = re.sub(r"^(?:さらに、|その後、)", "", m.group(5)).replace("このカードを手札に戻す", "«c»を手札に戻す"); r2 = sentence_steps(g5, ref_of) if "«c»" not in g5 else [{"a": "bounce", "to": "card"}]   # EX0741 / EX896 (Revise#310)
        if (not r2 or any(x.get("a") == "manual" for x in r2)) and re.match(r"(?:目標|«t»)の(?:精神力|攻撃力|耐久力)に", g5): r2 = sentence_steps("ターン終了時まで、" + g5, ref_of)   # "…場合、さらに、目標の耐久力に+Xする": as long as the sentence before
        if r2 and not any(x.get("a") == "manual" for x in r2):
            pb = dict({"name": re.sub(r"\s+", "", m.group(3))}, **({"broken": True} if m.group(1) or "ブレイクしている" in s else {}))
            out2 = [dict(x, ifPaidBy=pb) for x in r2]
            if m.group(4): out2[0]["_instead"] = {"paidBy": pb}
            return out2
    # ---- M3g (Revise#192): "目標が“X”の場合、…" — the steps run only for that named target ----
    m = re.fullmatch(r"(?:このカードの)?(?:目標|«t»)が(あなたの支配(?:キャラクター|エリア)の)?(ブレイクしている)?[“\"]([^”\"]+)[”\"]で、((?:場|場かダメージ置き場)に“[^”]+”が(?:いる|ある))場合、(.+)", s)   # EX0333 / EX0052 (Revise#201)
    if m and cond_of(m.group(4) + "場合"):
        r2 = sentence_steps(re.sub(r"^さらに、", "", m.group(5)), ref_of)
        if r2 and not any(x.get("a") == "manual" for x in r2):
            return [dict(x, ifTName=re.sub(r"\s+", "", m.group(3)), **({"ifTOwn": True} if m.group(1) else {}), **({"ifTBroken": True} if m.group(2) else {}), **{"if": cond_of(m.group(4) + "場合")}) for x in r2]
    m = re.fullmatch(r"(?:このカードの)?(?:目標|«t»)が「([^」]+)」の場合、(.+)", s)   # EX0604 (Revise#208): a card name
    if m:
        r2 = sentence_steps(m.group(2), ref_of)
        if r2 and not any(x.get("a") == "manual" for x in r2): return [dict(x, ifTJp=re.sub(r"\s+", "", m.group(1))) for x in r2]
    m = re.fullmatch(r"(?:このカードの)?(?:目標|«t»)が(あなたの支配(?:キャラクター|エリア)の)?(ブレイクしている)?[“\"]([^”\"]+)[”\"]\s*(?:の|だった)場合、(さらに、|代わりに、?)?(.+)", s)
    if m:
        r2 = sentence_steps(m.group(5), ref_of)
        if not r2 and m.group(4) and not re.match(r"(?:ターン|メインフェイズ)終了時まで", m.group(5)): r2 = sentence_steps("ターン終了時まで、" + m.group(5), ref_of)   # EX0334: "代わりに、目標に+2/+2/+2する" keeps the duration of the line before (ターン終了時まで)
        if r2 and not any(x.get("a") == "manual" for x in r2):
            tn = dict({"ifTName": re.sub(r"\s+", "", m.group(3))}, **({"ifTOwn": True} if m.group(1) else {}), **({"ifTBroken": True} if m.group(2) else {}))
            out2 = [dict(x, **tn) for x in r2]
            if m.group(4) and m.group(4).startswith("代わりに"): out2[0]["_instead"] = {"tName": tn}   # EX0334 / EX0451 (Revise#200)
            return out2
    m = re.fullmatch(u + r"(?:目標の)?«(\d|t)»がバトルする場合、?(?:目標|«t»)のバトル相手に(\d+)回同時にダメージを与える", s)   # EX0609 (Revise#192)
    if m: return [{"a": "mod", "to": R(m.group(2)), "mod": {"key": "multiHit", "op": "add", "value": int(m.group(3))}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"(?:目標|«t»)がバトルした場合、?(?:バトル終了時に)?(?:≪このカード≫|このカード)を捨て札する", s)   # EX0607 / EX0609 / EX0610 (Revise#192): the card's effect ends after the target's battle
    if m: return [{"a": "mod", "to": "t", "mod": {"key": "endSrcOnBattle", "op": "grant", "value": True}, "until": UNT[m.group(1)]}]
    # ---- M3b … (Revise#164) ----
    if s.startswith("このカードが効果を発揮した場合、") and len(s) > 16:
        r2 = sentence_steps(s[len("このカードが効果を発揮した場合、"):], ref_of)
        if r2: return r2
    m = re.fullmatch(r"«(\d)»は、?宣言時に(?:あなたの)?ダメージ置き場に置かれる", s)   # A3-22 3274
    if m and raw_text_of(ref_of, m.group(1)) == "このカードのコスト": return [{"a": "costTo", "to": "damage"}]
    m = re.fullmatch(r"(?:その後、)?あなたのデッキの上からカードを(X|\d+)枚捨て札する", s)   # A3-22 3165
    if m: return [{"a": "mill", "to": "you", "n": "X" if m.group(1) == "X" else int(m.group(1))}]
    m = re.fullmatch(r"«(\d)»は、?(.+?の)自分の支配キャラクタ.1人を捨て札する", s)   # A4-02 0380 (Revise#281): "精神力0の自分の支配キャラクター1人"
    if m and R(m.group(1)) == "players" and parse_selector(m.group(2)): return [{"a": "eachDiscardOwn", "sel": parse_selector(m.group(2))}]
    m = re.fullmatch(r"«(\d)»は、?(?:そのプレイヤーの任意のそのプレイヤーの|自分の)支配キャラクタ.1人を捨て札する", s)   # A3-11 1714; EX0197 (Revise#201)
    if m and R(m.group(1)) == "players": return [{"a": "eachDiscardOwn"}]
    m = re.fullmatch(r"«(\d)»は、?ドローフェイズの手順を行う", s)   # A3-23 3339
    if m and R(m.group(1)) == "players": return [{"a": "drawStep", "to": "players"}]
    if re.fullmatch(r"その後、?あなたのメインフェイズに戻る", s): return []
    m = re.fullmatch(r"«(\d)»にセットされているパワーカード全てを、?そのオーナーの手札に戻す", s)   # A3-16 2258 (Revise#165)
    if m and isinstance(R(m.group(1)), dict) and "all" in R(m.group(1)): return [{"a": "powerAllToHand", "to": R(m.group(1))}]
    m = re.fullmatch(r"«(\d)»は(\d+)ドローすることが可能", s)   # A3-21 2911
    if m and R(m.group(1)) == "you": return [{"a": "mayDraw", "n": int(m.group(2))}]
    if re.fullmatch(r"このカードは、?ファストカードのタイミングで使用宣言可能", s): return []   # card-level fastTiming (A3-20 2765)
    if re.fullmatch(r"このカードはあなたの対戦相手のターンにのみ使用可能", s): return [{"a": "_oppTurnOnly"}]   # A3-14 1950 (Revise#165)
    m = re.fullmatch(r"«(\d)»は、?自分の支配エリアの(.*?)キャラクターにセットされているパワーカードを(\d+)枚選び、?(?:自分の)?手札に戻す", s)   # EX0619 (Revise#207)
    if m and R(m.group(1)) == "players" and parse_selector(m.group(2)) is not None: return [{"a": "eachPowerToHand", "sel": parse_selector(m.group(2)), "n": int(m.group(3))}]
    m = re.fullmatch(r"«(\d)»は、?自身の支配エリアの▼を持たないキャラクター1人につき1ドローし、自身の支配エリアの▼を持つキャラクター1人につき1枚、自身の手札を捨て札する", s)   # EP343 (Revise#207)
    if m and R(m.group(1)) == "players": return [{"a": "eachDrawDiscardAgg"}]
    m = re.fullmatch(r"このカードのコストは、?(ブレイクしている)?“([^”]+)”からのみ支払うことが可能", s)   # EX0454 (Revise#208)
    if m: return [{"a": "_payOnlySel", "sel": dict({"name": re.sub(r"\s+", "", m.group(2))}, **({"broken": True} if m.group(1) else {}))}]
    m = re.fullmatch(r"(?:このカードの効果が発揮した場合、)?«(\d)»から“([^”]+)”のネームを持つブレイクカードと“([^”]+)”のネームを持つブレイクカードを1枚ずつ(?:あなたの)?手札に加える", s)   # EX0482 (Revise#208)
    if m and R(m.group(1)) == "yourDeck": return [{"a": "pickZone", "zones": ["deck"], "owner": "you", "n": 2, "upTo": True, "sel": {"types": ["Break"], "names": [re.sub(r"\s+", "", m.group(2)), re.sub(r"\s+", "", m.group(3))]}, "distinct": "name", "dest": "hand"}]
    m = re.fullmatch(u + r"«(\d)»は必要ファクターが(\d+)減少する", s)   # EX0482 (Revise#208)
    rm = m and re.fullmatch(r"あなたが使用する((?:“[^”]+”)(?:または“[^”]+”)*)のネームを持つブレイクカード全て", raw_text_of(ref_of, m.group(2)) or "")
    if rm: return [{"a": "field", "mod": {"to": "you", "key": "factorLess", "op": "add", "value": {"n": int(m.group(3)), "sel": {"types": ["Break"], "names": [re.sub(r"\s+", "", x) for x in re.findall(r"“([^”]+)”", rm.group(1))]}}, "until": UNT[m.group(1)]}}]
    if re.fullmatch(r"このカードの使用宣言時から効果終了時まで、あなたはあなたの手札を1枚捨て札することで、このカードをあなたの手札に戻すことができる", s): return [{"a": "discardToReturn"}]   # A3-07 1073 (Revise#256): offered when it resolves
    # ---- M3c (Revise#257) ----
    m = re.fullmatch(r"(?:目標の、?)?«(\d)»は、?自身の手札を(\d+)枚選び、捨て札する(?:ことが可能)?", s)   # A4-04 0773 / A4-PR PR092 (Revise#267)
    if m and R(m.group(1)) == "t": return [{"a": "_discardOrMill", "n": int(m.group(2))}]
    m = re.fullmatch(r"捨て札しなかった場合、目標のデッキの上からカードを(\d+)枚捨て札する", s)
    if m: return [{"a": "_discardOrMillElse", "mill": int(m.group(1))}]
    m = re.fullmatch(r"(?:このカードが効果を発揮した場合、)?«(\d)»は自分のダメージ置き場または捨て札置き場の(.+?)(\d+)枚を、オーナーの手札に戻す", s)   # A4-03 0447 … (Revise#267)
    if m and R(m.group(1)) == "players" and class_tokens(m.group(2)) == [m.group(2)]: return [{"a": "eachPilePick", "zones": ["damage", "discard"], "sel": {"icons": [m.group(2)]}, "n": int(m.group(3))}]
    m = re.fullmatch(r"(?:このカードが効果を発揮した場合、)?«(\d)»を、あなたの支配キャラクターとしてセットする", s)   # A4-03 0543 … (Revise#267)
    rm = m and re.fullmatch(r"あなたの捨て札置き場にある(.+?)(\d+)枚", raw_text_of(ref_of, m.group(1)) or "")
    if rm and deck_pick_sel(rm.group(1)) is not None: return [{"a": "pickZone", "zones": ["discard"], "owner": "you", "n": int(rm.group(2)), "sel": deck_pick_sel(rm.group(1)), "dest": "back"}]
    m = re.fullmatch(r"目標が(.+?)の場合、さらに攻撃力に\+(\d+)する", s)   # A4-02 0343 … (Revise#267)
    tsel = m and ({"ブレイクしているネームレベルキャラクター": {"broken": True, "named": True}, "ネームレベルキャラクター": {"named": True}, "ブレイクしているキャラクター": {"broken": True}}.get(m.group(1)) or parse_selector(m.group(1)))
    if m and tsel is not None: return [{"a": "mod", "to": "t", "mod": {"key": "at", "op": "add", "value": int(m.group(2))}, "until": "_prev", "ifTSel": tsel}]
    m = re.fullmatch(u + r"カードの使用宣言が行われた場合、このカードを捨て札する", s)   # A3-EX05 EX0622 / EX0634 (Revise#264)
    if m: return [{"a": "watchEv", "event": "cardDeclared", "when": {"types": ["Character", "Break", "Permanent", "Project", "Fast"]}, "once": True, "effect": {"steps": [{"a": "thisCardDiscard"}], "status": "auto"}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"«(\d)»がプレイヤーにアタックした場合、攻撃力に\+(\d+)して判定する", s)   # A3-EX02 EX0168 (Revise#264)
    if m and isinstance(R(m.group(2)), dict) and "all" in R(m.group(2)): return [{"a": "mod", "to": R(m.group(2)), "mod": {"key": "at", "op": "add", "value": int(m.group(3))}, "cond": {"self": "attackingPlayer"}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"対象のバトル相手の持つスキルを無効化する", s)
    if m: return [{"a": "_battleOppOffPrev", "until": UNT[m.group(1)]}]
    if re.fullmatch(r"このカードは、?フェイズ・ターンが終了しても効果を発揮し続ける", s): return []   # (its field effect lasts until it is removed) A4-EP EP605 (Revise#293)
    m = re.fullmatch(r"«(\d)»の、?ダメージ置き場の(?:カード)?枚数による敗北条件に\+(\d+)枚?する", s)   # A4-01 0117 … (Revise#262); EP605 (Revise#293)
    if m and R(m.group(1)) == "you": return [{"a": "field", "mod": {"to": "you", "key": "lossPlusP", "op": "grant", "value": int(m.group(2)), "until": "removed"}}]
    m = re.fullmatch(u + r"目標の«(\d)»が次にバトルによるダメージを与える場合、攻撃力に\+(\d+)して判定する", s)   # A4-EP EP497 … (Revise#262)
    if m and R(m.group(2)) == "t": return [{"a": "nextBattleModsT", "to": "t", "mods": [{"key": "at", "op": "add", "value": int(m.group(3))}], "cond": {"battleOrAttackPlayer": True}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(r"このカードの使用宣言時に、«(\d)»は(\d+)ドローする", s)   # A4-03 0414 / A4-05 0812 … (Revise#259): at the declaration
    if m and R(m.group(1)) == "you": return [{"a": "_declDraw", "n": int(m.group(2))}]
    m = re.fullmatch(T + r"をアタック宣言させる", s)   # A3-25 3800 (Revise#258)
    if m and R(m.group(1)) == "t": return [{"a": "makeAttack", "to": "t"}]
    if re.fullmatch(r"(?:その後、)?«(\d)»は1ドロー可能", s) and "対戦相手全て" in (raw_text_of(ref_of, re.search(r"«(\d)»", s).group(1)) or ""): return [{"a": "_drawChain"}]   # A3-23 3335 (Revise#258)
    if re.fullmatch(r"この手順を、いずれかのプレイヤ.1人が拒否するまで続ける", s): return []
    if re.fullmatch(r"Xはあなたのダメージ置き場のカード枚数が上限の、あなたの任意の数に等しい", s): return []   # A3-22 3235 (Revise#257): X is the cost you pay (the cap is not checked)
    m = re.fullmatch(u + r"«(\d)»に1ダメージを与える", s)   # A3-22 3235 (Revise#258)
    if m and raw_text_of(ref_of, m.group(2)) == "あなたの支配キャラクターのアタック宣言に対してガード宣言したキャラクター": return [{"a": "watchEv", "event": "guarded", "when": {}, "attOwn": True, "effect": {"steps": [{"a": "damage", "to": "evCh", "n": 1}], "status": "auto"}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"目標の«(\d)»のアタッ?ックを受けたプレイヤーの手札全てを捨て札する", s)   # A3-11 1662
    if m: return [{"a": "watchEv", "to": "t", "event": "hitPlayer", "when": {"by": "self"}, "useBound": True, "effect": {"steps": [{"a": "handTake", "to": "evHit", "all": True, "dest": "discard"}], "status": "auto"}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"目標のバトル相手のキャラクターを、バトル終了時に捨て札する", s)
    if m: return [{"a": "watchEv", "to": "t", "event": "battleEnd", "when": {"self": True}, "oppOfBound": True, "effect": {"steps": [{"a": "discard", "to": "evCh"}], "status": "auto"}, "until": UNT[m.group(1)]}]
    if re.fullmatch(r"このカードは捨て札置き場でなく、ダメージ置き場に置かれる", s): return [{"a": "cardEndTo", "dest": "damage"}]
    m = re.fullmatch(u + r"«(\d)»に\(X\)ダメージを与える", s)   # A3-14 1974
    if m and raw_text_of(ref_of, m.group(2)) == "目標のアタック宣言に対してガード宣言したキャラクター": return [{"a": "watchEv", "to": "t", "event": "guarded", "when": {"self": True, "asAttacker": True}, "effect": {"steps": [{"a": "damage", "to": "evCh", "n": "X", "mental": True}], "status": "auto"}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"«(\d)»のガードコストは1減少する", s)   # A3-15 2150
    if m and raw_text_of(ref_of, m.group(2)) == "指定したプレイヤーの支配キャラクターのアタック宣言に対してガード宣言するキャラクター全て": return [{"a": "guardLessVsT", "to": "t", "until": UNT[m.group(1)]}]
    if re.fullmatch(r"このカードの使用宣言時に、プレイヤ.1人を指定する", s): return [{"a": "_designatePlayer"}]
    m = re.fullmatch(u + r"目標にセットされているパーマネントカード1枚につき、目標に、-1/-1/-1する", s)   # A3-11 1689
    if m: return [{"a": "minusPerPerm", "to": "t", "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"目標が捨て札になる場合、目標にセットされているパーマネントカード1枚と、このカードを捨て札することで目標を場に残すことができる", s)
    if m: return [{"a": "mod", "to": "t", "mod": {"key": "keepByCard", "op": "grant", "value": {"perm": 1}}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"目標がバトルする際、«(\d)»のスキル全てを無効化する", s)   # A3-11 1743
    if m and raw_text_of(ref_of, m.group(2)) == "目標のバトル相手": return [{"a": "battleOppOffT", "to": "t", "until": UNT[m.group(1)]}]
    # ---- M3b batch 2 (Revise#251) ----
    m = re.fullmatch(u + r"目標の«(\d)»のアタック宣言に対するガード宣言のコストは、?そのオーナーの手札に戻る", s)   # A3-07 1137
    if m: return [{"a": "destGuardVsT", "until": UNT[m.group(1)]}]
    if re.fullmatch(r"目標のアタック宣言に対してガード宣言が行われずに目標がプレイヤーにアタックした場合、通常のダメージ判定を行わず、アタックを受けたプレイヤーの手札から、あなたの任意のカードを、目標の攻撃力に等しい枚数まで、そのオーナーのダメージ置き場に置く", s):
        return [{"a": "mod", "to": "t", "mod": {"key": "playerHit", "op": "grant", "value": {"replace": True, "effect": {"steps": [{"a": "handTake", "to": "evHit", "n": "X", "upTo": True, "dest": "damage"}], "status": "auto"}}}, "until": "main"}]
    m = re.fullmatch(u + r"目標の«(\d)»がプレイヤーにアタックした場合、アタックを受けたプレイヤーは通常のダメージ判定を行わず、そのプレイヤーのダメージ置き場にカードが1枚置かれるまで、ダメージ判定する", s)   # A3-09 1354
    if m: return [{"a": "mod", "to": "t", "mod": {"key": "playerHit", "op": "grant", "value": {"replace": True, "effect": {"steps": [{"a": "dmgUntilOne"}], "status": "auto"}}}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"目標がプレイヤーにアタックした場合、目標のオーナーは1ドローする", s)
    if m: return [{"a": "watchEv", "to": "t", "event": "attack", "when": {"self": True, "toPlayer": True}, "useBound": True, "effect": {"steps": [{"a": "draw", "to": "evOwner", "n": 1}], "status": "auto"}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(r"«(\d)»のコスト(X|\d+)以下の(プロジェクトカードまたはファストカード|プロジェクトカード|ファストカード)1枚を、コストを支払って使用宣言する", s)   # A3-09 1385
    if m and R(m.group(1)) == "yourDeck": return [{"a": "effDecl", "zones": ["deck"], "types": [CARD_TYPES_JP[x] for x in re.findall(r"(プロジェクト|ファスト)カード", m.group(3))], "costMax": "X" if m.group(2) == "X" else int(m.group(2)), "anyChar": True, "_ignoreFactorLater": True}]
    if re.fullmatch(r"メインフェイズ終了時まで、このカードの効果で使用宣言されたカードは必要ファクターを無視して効果を発揮する", s): return [{"a": "_effDeclIgnoreFactor"}]
    # ---- M3b (Revise#250) ----
    m = re.fullmatch(u + r"そのキャラクターがプレイヤーにアタックした場合、通常のダメージ判定の後、«(\d)»の手札から、あなたの任意のX枚までを捨て札する", s)   # A3-09 1418
    if m and raw_text_of(ref_of, m.group(2)) == "アタックを受けたプレイヤー": return [{"a": "watchEv", "to": "t", "event": "hitPlayer", "when": {"by": "self"}, "useBound": True, "effect": {"steps": [{"a": "handTake", "to": "evHit", "n": "X", "upTo": True, "dest": "discard"}], "status": "auto"}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"目標の«(\d)»が捨て札になる場合、目標を構成するカード全てをそのオーナーのデッキに戻し、そのデッキをシャッフルする", s)   # A3-09 1486
    if m: return [{"a": "mod", "to": "t", "mod": {"key": "leaveToDeck", "op": "grant", "value": True}, "until": UNT[m.group(1)]}]
    if re.fullmatch(r"メインフェイズ終了時に、ダメージ置き場の、目標と同じ分類を持つカード全てをそのオーナーのデッキに戻し、そのデッキをシャッフルする", s): return [{"a": "iconsToDeckLater", "at": "main"}]
    # ---- M3a batch 2 (Revise#249) ----
    m = re.fullmatch(u + r"目標の«(\d)»は、?このキャラクターのアタック宣言に対してガードする", s)   # A3-04 0676
    if m: return [{"a": "watchEv", "to": "t", "event": "attack", "when": {}, "bySrc": True, "useBound": True, "effect": {"steps": [{"a": "forceGuard", "to": "evCh"}], "status": "auto"}, "until": UNT[m.group(1)]}]
    if re.fullmatch(r"このアタック宣言に対して通常のガード宣言は可能", s): return []
    m = re.fullmatch(u + r"«(\d)»から、あなたの任意のパワーカードX枚までを、?そのオーナーの手札に戻す", s)   # A3-04 0690
    if m and raw_text_of(ref_of, m.group(2)) == "アタック宣言またはガード宣言またはエフェクトの使用宣言をしたキャラクターにセットされているパワーカード":
        return [{"a": "watchEv", "event": "anyDeclared", "when": {}, "effect": {"steps": [{"a": "powerBackBudget"}], "status": "auto"}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"目標の«(\d)»に対して、全てのプレイヤーはファストカードのタイミングでブレイクカードの使用宣言可能", s)   # A3-04 0702
    if m: return [{"a": "mod", "to": "t", "mod": {"key": "breakFast", "op": "grant", "value": {"all": True}}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"目標にパワーカードが1枚以上セットされていても、全てのプレイヤーがブレイク可能", s)
    if m: return [{"a": "mod", "to": "t", "mod": {"key": "breakWithPower", "op": "grant", "value": True}, "until": UNT[m.group(1)]}]
    if re.fullmatch(r"目標にブレイクカードがセットされた場合、目標にセットされていたパワーカード全ては、そのオーナーのダメージ置き場に置かれる", s): return [{"a": "mod", "to": "t", "mod": {"key": "breakPowerToDamage", "op": "grant", "value": True}, "until": "main"}]
    m = re.fullmatch(u + r"あなたは、?ファストカードのタイミングで、?目標を対象にブレイクカードのセット宣言可能", s)   # A3-05 0843
    if m: return [{"a": "mod", "to": "t", "mod": {"key": "breakFast", "op": "grant", "value": {"by": "you"}}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"目標を対象に使用宣言するブレイクカードの必要ファクターに[-ー−]Xし、そのブレイクカードのコストはオーナーの手札に戻る", s)
    if m: return [{"a": "destOnT", "until": UNT[m.group(1)]}, {"a": "manual", "text": "目標を対象に使用宣言するブレイクカードの必要ファクターに-Xする。"}, {"a": "_partial"}]   # the factor −X is still by hand
    # ---- M3a (Revise#245) ----
    if re.fullmatch(r"このカードのコストは、?目標から支払わなければならない", s): return []   # A3-03 0518: the next sentence makes it count
    if re.fullmatch(r"このカードのコストが目標から支払われていない場合、このカードは効果を発揮しない", s): return [{"a": "_onlyIfPaidT"}]
    m = re.fullmatch(r"(?:目標|«t»)が(?:必要ファクターが?(\d+)以上の)?([^の\s]+?系)を持つキャラクターの場合、さらに、(?:目標|«t»)がバトルする際、((?:目標|«t»)は.+を得る)", s)   # A4-EP EP499 (Revise#364): …in its battles
    if m:
        r2 = sentence_steps("ターン終了時まで、" + m.group(3), ref_of)
        if r2 and all(x["a"] == "mod" for x in r2): return [dict(x, cond={"self": "inBattle"}, ifTSel=dict({"tag": m.group(2)}, **({"factorGe": int(m.group(1))} if m.group(1) else {}))) for x in r2]
    if re.fullmatch(r"(?:目標|«t»)がバトルした場合、バトル終了時に、このカードを捨て札する", s): return [{"a": "mod", "to": "t", "mod": {"key": "endSrcOnBattle", "op": "grant", "value": True}, "until": "turn"}]   # A4-EP EP499 (Revise#364): no duration written = as long as the card works (the turn)
    m = re.fullmatch(r"(?:目標|«t»)が(?:必要ファクター(\d+)以上の)?([^の\s]+?系)を持つキャラクターの場合、さらに、((?:目標|«t»)は.+を得る)", s)   # A4-EP EP503 / EP505 (Revise#310): a Ragnarok class (a tag)
    if m:
        r2 = sentence_steps("ターン終了時まで、" + m.group(3), ref_of)
        if r2 and all(x["a"] == "mod" for x in r2): return [dict(x, ifTSel=dict({"tag": m.group(2)}, **({"factorGe": int(m.group(1))} if m.group(1) else {}))) for x in r2]
    m = re.fullmatch(r"(?:目標|«t»)が(?:必要ファクター(\d+)以上の)?([^の\s、]+?)を持つキャラクターの場合、(さらに、|代わりに、)(.+)", s)   # A4-EP EP497 / EP510 / EP512, A4-EX02 EX888 (Revise#339): for a target of that kind
    if m:
        w = m.group(2); ps = parse_selector(w + "を持つ") if not w.endswith("系") else None
        tsel = {"tag": w} if w.endswith("系") else ({"tag": ps["tag"]} if ps and set(ps) == {"tag"} else None)
        if tsel is not None:
            if m.group(1): tsel["factorGe"] = int(m.group(1))
            rest, r2 = m.group(4), None
            am = re.fullmatch(r"(?:(?:目標|«t»)の)?攻撃力に\+(\d+)して判定する", rest)
            if am: r2 = [{"a": "nextBattleModsT", "to": "t", "mods": [{"key": "at", "op": "add", "value": int(am.group(1))}], "cond": {"battleOrAttackPlayer": True}, "until": "turn"}]   # after "次にバトルによるダメージを与える場合、…"
            elif rest == "手札に戻す": r2 = [{"a": "discardOnAttack", "to": "t", "until": "turn", "dest": "hand"}]   # after "目標がアタックした場合、このカードを捨て札する"
            else:
                r2 = sentence_steps(rest, ref_of)
                if not r2 or any(x.get("a") == "manual" for x in r2): r2 = sentence_steps("ターン終了時まで、" + rest, ref_of)
            if r2 and not any(x.get("a") == "manual" or x.get("a", "").startswith("_") for x in r2):
                out2 = [dict(x, ifTSel=tsel) for x in r2]
                if m.group(3).startswith("代わりに"): out2[0]["_instead"] = {"tSel": tsel}
                return out2
    m = re.fullmatch(r"Xが(\d+)以上の場合、(?:さらに、)?(.+)", s)   # A4-EP EP404 (Revise#310): only with a large X
    if m:
        def _ref(i):
            try: return ref_of(i)
            except Exception: return None
        selfi = next((i for i in range(10) if _ref(i) == "self"), None)
        body2 = m.group(2).replace("対象は", "«%d»は" % selfi) if selfi is not None else m.group(2)
        r2 = None if "対象" in body2 else sentence_steps(body2, ref_of)
        if r2 and all(not x["a"].startswith("_") and x["a"] != "manual" for x in r2):
            if "まで" not in m.group(2): r2 = [dict(x, until="turn") if x.get("a") == "mod" and x.get("until") == "removed" else x for x in r2]   # "ターン終了時まで、…。Xが10以上の場合、目標は…を得る" (A4-04 0711): as long as the sentence before
            return [dict(x, ifXGe=int(m.group(1))) for x in r2]
    m = re.fullmatch(r"このカードの使用宣言時に、?«(\d)»を手札に戻す", s)   # A4-03 0512 / PR071 (Revise#310)
    if m and raw_text_of(ref_of, m.group(1)) == "このカードのコスト": return [{"a": "costTo", "to": "hand"}]
    if re.fullmatch(r"(?:«\d»|このカードのコスト)は、?(?:オーナーの)?手札に戻る", s) and ("«" not in s or raw_text_of(ref_of, re.search(r"«(\d)»", s).group(1)) == "このカードのコスト"): return [{"a": "costTo", "to": "hand"}]
    if re.fullmatch(r"«(\d)»は、?ダメージ置き場に置かれる", s) and raw_text_of(ref_of, re.search(r"«(\d)»", s).group(1)) == "このカードのコスト": return [{"a": "costTo", "to": "damage"}]   # A3-03 0593
    m = re.fullmatch(u + r"目標がプレイヤーにアタックした場合、«(\d)»は\(X\)ダメージを受ける", s)   # A3-03 0518
    if m and R(m.group(2)) == "you": return [{"a": "watchEv", "to": "t", "event": "hitPlayer", "when": {"by": "self"}, "useBound": True, "effect": {"steps": [{"a": "damage", "to": "you", "n": "X", "mental": True}], "status": "auto"}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(r"目標の«(\d)»を、ネーム・分類・ブレイク条件を無視して、パワー0の、あなたの支配キャラクタ[ー\-－]1人にセットする", s)   # A3-03 0593
    if m and re.fullmatch(r"あなたのダメージ置き場の必要ファクタ[ー\-－]Xのブレイクカード1枚", raw_text_of(ref_of, m.group(1)) or ""): return [{"a": "damageBreakSetX"}]
    m = re.fullmatch(r"(?:目標の)?«(\d|t)»を(?:オーナーの|あなたの)?デッキに戻す", s)   # EX0763 (Revise#242): cards from a pile
    if m and isinstance(R(m.group(1)), dict) and "pile" in R(m.group(1)):
        pl = R(m.group(1))["pile"]; return [dict({"a": "pickZone", "zones": [pl["zone"]], "owner": pl["owner"], "dest": "deckShuffle", "n": pl["n"], "upTo": pl.get("upTo", False)}, **({"sel": pl["sel"]} if pl.get("sel") else {}))]
    m = re.fullmatch(u + r"«(\d)»に次に与えられるバトルによるダメージを無効化する", s)   # EX830 (Revise#242)
    if m and R(m.group(2)) == "self": return [{"a": "mod", "to": "self", "mod": {"key": "reflectNext", "op": "grant", "value": {"nullOnly": True}}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(r"(?:目標の)?«(\d|t)»の手札全てを見る", s)   # EX0745 (Revise#242)
    if m and R(m.group(1)) in ("t", "players", "opp"): return [{"a": "lookHand", "to": R(m.group(1)) if R(m.group(1)) == "t" else "players"}]
    m = re.fullmatch(u + r"«(\d)»は、?(?:オーナーの)?手札に戻る", s)   # EX882 (Revise#242): "≪英国とネームを持つブレイクカードのコスト≫"
    cm = m and (lambda p0: p0[1]["costOf"] if p0 and p0[0] == "ref" and isinstance(p0[1], dict) and "costOf" in p0[1] else None)(parse_target(raw_text_of(ref_of, m.group(2)) or ""))
    if cm and cm.get("tag"): return [{"a": "field", "mod": {"to": "you", "key": "dest", "op": "dest", "value": dict({"cost": "set", "to": "hand"}, **{k: v for k, v in cm.items() if k in ("type", "named", "tag")}), "until": UNT[m.group(1)]}}]
    m = re.fullmatch(r"このカードは(.+?場合)にのみ効果を発揮する", s)   # EP541 / EP545 (Revise#229)
    if m and cond_of(m.group(1)): return [{"a": "_onlyIf", "cond": cond_of(m.group(1))}]
    m = re.fullmatch(r"(.+?場合)、このカードは必要ファクターとコストを無視して使用宣言可能", s)   # A3-17 2405 / A3-PR PR222 (Revise#339)
    if m and cond_of(m.group(1)): return [{"a": "_factorFreeIf", "cond": cond_of(m.group(1)), "cost": True}]
    m = re.fullmatch(r"(.+?場合)、あなたはこのカードのコストを無視して使用宣言可能", s)   # A4-EX01 EX0743 (Revise#318)
    if m and cond_of(m.group(1)): return [{"a": "_costFreeIf", "cond": cond_of(m.group(1))}]
    m = re.fullmatch(r"(.+?場合)、この(?:カード|エフェクト)は効果を発揮しない", s)   # "あなたが英国を持つキャラクターを支配していない場合、このカードは効果を発揮しない" (A4-EX02 EX881, Revise#318)
    if m and cond_of(m.group(1)): return [{"a": "_onlyIf", "cond": (lambda c0: c0["not"] if set(c0) == {"not"} else {"not": c0})(cond_of(m.group(1)))}]
    m = re.fullmatch(u + r"«(\d)»は、?(?:オーナーの)?手札に戻る", s)   # EP494 / EP555 / EP603 (Revise#229)
    nm = m and re.fullmatch(r"(あなたが次に使用宣言する|あなたの)?(" + WORK_ALT + r"|E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のブレイクカードのコスト", raw_text_of(ref_of, m.group(2)) or "")
    if nm:
        v = dict({"cost": "set", "type": "Break", "to": "hand"}, **({"works": WORKS_JP[nm.group(2)]} if nm.group(2) in WORKS_JP else {"faction": FACTION_JP[nm.group(2)]}), **({"next": True} if nm.group(1) == "あなたが次に使用宣言する" else {}))
        return [{"a": "field", "mod": {"to": "you" if nm.group(1) else {"players": "all"}, "key": "dest", "op": "dest", "value": v, "until": UNT[m.group(1)]}}]
    m = re.fullmatch(u + r"«(\d)»は(?:オーナーの)?手札に戻る", s)   # EXPR036 (Revise#208): "≪“A”、“B”、“C”から支払われたカードのコスト≫は手札に戻る"
    pm = m and re.fullmatch(r"((?:“[^”]+”)(?:、“[^”]+”)*)から支払われたカードのコスト", raw_text_of(ref_of, m.group(2)) or "")
    if pm: return [{"a": "field", "mod": {"to": "you", "key": "dest", "op": "dest", "value": {"cost": "set", "to": "hand", "paidBy": {"names": [re.sub(r"\s+", "", x) for x in re.findall(r"“([^”]+)”", pm.group(1))]}}, "until": UNT[m.group(1)]}}]
    m = re.fullmatch(r"このカードの使用宣言時に、?あなたの手札から(" + WORK_ALT + r")のカードを公開することが可能", s)   # EP384 (Revise#209): with such a card in hand, the factor is ignored (it is shown) …
    if m: return [{"a": "_factorFreeIf", "cond": {"handOther": {"works": WORKS_JP[m.group(1)]}}}]
    m = re.fullmatch(r"そうした場合、«(\d)»は、?このカードの必要ファクターを無視して使用宣言可能", s)   # … the sentence after it
    if m and R(m.group(1)) == "you": return []
    m = re.fullmatch(r"このカードは、?((?:プロジェクト|ファスト|パーマネント)カード(?:または(?:プロジェクト|ファスト|パーマネント)カード)*)の使用宣言が行われている場合にのみ使用宣言可能", s)   # EX0489 (Revise#209)
    if m: return [{"a": "_declCond", "cond": {"stackTopTypes": [CARD_TYPES_JP[x] for x in re.findall(r"(プロジェクト|ファスト|パーマネント)カード", m.group(1))]}}]
    m = re.fullmatch(r"«(\d)»に、?精神力に等しくなるまであなたのデッキからカードを引いて、?パワーカードとしてセットする", s)   # A3-EP EP198 (Revise#222)
    rm = m and re.fullmatch(r"あなたの任意のあなたの支配キャラクター(X|\d+)(?:体|人)", raw_text_of(ref_of, m.group(1)) or "")
    if rm: return [{"a": "fillPowerPick", "n": "X" if rm.group(1) == "X" else int(rm.group(1))}]
    m = re.fullmatch(r"このカードのコストが((?:[“\"][^”\"]+[”\"]、?)+)全てから1コスト以上支払われている場合、?«(\d)»は(?:オーナーの)?手札に戻る", s)   # A3-EP EP342 (Revise#222)
    if m and raw_text_of(ref_of, m.group(2)) == "このカードのコスト": return [{"a": "_costBackIfAll", "names": [re.sub(r"\s+", "", x) for x in re.findall(r"[“\"]([^”\"]+)[”\"]", m.group(1))]}]
    m = re.fullmatch(r"«(\d)»の中から、?必要ファクターとコストの合計がX以下になるように任意の枚数選んで、?あなたの手札に加える", s)   # A3-19 2579 (Revise#222)
    if m and raw_text_of(ref_of, m.group(1)) == "あなたのダメージ置き場にあるプロジェクトカードとファストカード": return [{"a": "budgetPick", "types": ["Project", "Fast"]}]
    m = re.fullmatch(T + r"にセットされている、?あなたの任意のパワーカード(\d+)枚を、?(?:その)?オーナーの手札に戻す", s)   # A3-08 1256 (Revise#222)
    if m and R(m.group(1)) is not None: return [{"a": "cardsOf", "to": R(m.group(1)), "part": "power", "n": int(m.group(2)), "dest": "hand"}]
    m = re.fullmatch(u + r"バトルの際、?(?:目標の|«t»の)?バトル相手の持つスキル(1つ|全て)を無効化する", s)   # A3-EX05 EX0600 (Revise#217): each battle of the target
    if m: return [{"a": "watchEv", "to": "t", "event": "battleStart", "when": {"self": True}, "oppOfBound": True, "effect": {"steps": [{"a": "skillOffPick", "to": "evCh", "until": "battle"} if m.group(2) == "1つ" else {"a": "mod", "to": "evCh", "mod": {"key": "negate", "op": "grant", "value": {"skills": True}}, "until": "battle"}], "status": "auto"}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(r"(ターン終了時まで|メインフェイズ終了時まで)、?(?:目標|«t»)の攻撃力に\+(\d+)し、?バトルの際、?(?:目標|«t»)のバトル相手の持つスキル全てを無効化する", s)   # A3-EX04 EX0468 (Revise#217)
    if m: return [{"a": "mod", "to": "t", "until": UNT[m.group(1)], "mod": {"key": "at", "op": "add", "value": int(m.group(2))}}, {"a": "watchEv", "to": "t", "event": "battleStart", "when": {"self": True}, "oppOfBound": True, "effect": {"steps": [{"a": "mod", "to": "evCh", "mod": {"key": "negate", "op": "grant", "value": {"skills": True}}, "until": "battle"}], "status": "auto"}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(r"(ターン終了時まで|メインフェイズ終了時まで)、?(?:目標|«t»)の攻撃力に\+(\d+)し、?(?:目標|«t»)がバトルした場合、?バトル終了時に(?:目標|«t»)のバトル相手を(?:その)?オーナーの手札に戻す", s)   # A3-EX04 EX0467 (Revise#217)
    if m: return [{"a": "mod", "to": "t", "until": UNT[m.group(1)], "mod": {"key": "at", "op": "add", "value": int(m.group(2))}}, {"a": "watchEv", "to": "t", "event": "battleEnd", "when": {"self": True}, "oppOfBound": True, "effect": {"steps": [{"a": "bounce", "to": "evCh"}], "status": "auto"}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"(?:目標|«t»)に([±+\-ー−]\(?\d+\)?)/([±+\-ー−]\(?\d+\)?)/([±+\-ー−]\(?\d+\)?)し、?(?:目標|«t»)がバトルする際、?(?:目標|«t»)のバトル相手のパワーカード(\d+)枚を捨て札する", s)   # A3-EX05 EX0602 (Revise#217)
    if m: return [{"a": "mod", "to": "t", "until": UNT[m.group(1)], "mod": {"key": k, "op": "add", "value": sign_n(m.group(g))}} for k, g in (("se", 2), ("at", 3), ("de", 4)) if sign_n(m.group(g))] + [{"a": "watchEv", "to": "t", "event": "battleStart", "when": {"self": True}, "oppOfBound": True, "effect": {"steps": [{"a": "cardsOf", "to": "evCh", "part": "power", "n": int(m.group(5)), "dest": "discard"}], "status": "auto"}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"あなたの支配エリアの([^のを]+?)の(ネームレベル)?キャラクターがバトルする際、?«(\d)»を捨て札する", s)   # A3-EXPR EXPR035 (Revise#217): ≪そのキャラクターのバトル相手にセットされているパワーカードN枚≫
    if m and class_tokens(m.group(2).replace("または", "・")) and re.fullmatch(r"そのキャラクターのバトル相手にセットされているパワーカード(\d+)枚", raw_text_of(ref_of, m.group(4)) or ""):
        n = int(re.fullmatch(r"そのキャラクターのバトル相手にセットされているパワーカード(\d+)枚", raw_text_of(ref_of, m.group(4))).group(1))
        return [{"a": "watchEv", "event": "battleStart", "when": {}, "battleSel": dict({"owner": "you", "area": "controlled", "icons": class_tokens(m.group(2).replace("または", "・"))}, **({"named": True} if m.group(3) else {})), "effect": {"steps": [{"a": "cardsOf", "to": "evCh", "part": "power", "n": n, "dest": "discard"}], "status": "auto"}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"あなたの支配キャラクターが、?プレイヤーまたはあなた以外のプレイヤーのテリトリーのキャラクターを目標にアタック宣言した場合、?«(\d)»は(\d+)ドロー(可能|する)", s)   # A3-EP EP202 (Revise#217)
    if m and R(m.group(2)) == "you": return [{"a": "watchEv", "event": "attack", "when": {"own": True, "notOwnCh": True}, "effect": {"steps": [{"a": "mayDraw" if m.group(4) == "可能" else "draw", "n": int(m.group(3)), **({} if m.group(4) == "可能" else {"to": "you"})}], "status": "auto"}, "until": UNT[m.group(1)]}]
    # ---- Revise#344 ----
    # ---- Revise#347 ----
    m = re.fullmatch(u + r"(?:目標|目標の«(?:t|\d)»)のアタック宣言に対してガード宣言したキャラクター(に、?(\(?)(X|\d+)\)?ダメージを与える|にセットされているパワーカードを(X|\d+)枚を?捨て札する|の(精神力|攻撃力|耐久力)に([+\-ー−])(\d+)する)", s)   # A3-EX04 EX0462 / EX0465 (Revise#347; A4-04 0612)
    if m:
        nx = lambda v: "X" if v == "X" else int(v)
        st = {"a": "damage", "to": "evCh", "n": nx(m.group(4)), "mental": bool(m.group(3))} if m.group(4) else {"a": "powerDiscard", "to": "evCh", "n": nx(m.group(5))} if m.group(5) else {"a": "mod", "to": "evCh", "mod": {"key": STAT_JP[m.group(6)], "op": "add", "value": int(m.group(8)) * (1 if m.group(7) == "+" else -1)}, "until": "battle"}
        return [{"a": "watchEv", "to": "t", "event": "guarded", "when": {"self": True, "asAttacker": True}, "effect": {"steps": [st], "status": "auto"}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"«(\d)»は、?オーナーの手札に戻る", s)   # A3-24 3581: the cost of Break cards of those classes
    cm = m and re.fullmatch(r"(.+?)のブレイクカードのコスト", raw_text_of(ref_of, m.group(2)) or "")
    if cm and class_tokens(cm.group(1)) and len(class_tokens(cm.group(1))) == len(cm.group(1).split("・")):
        return [{"a": "field", "mod": {"to": {"players": "all"}, "key": "dest", "op": "dest", "value": {"cost": "set", "type": "Break", "icons": class_tokens(cm.group(1)), "to": "hand"}, "until": UNT[m.group(1)]}}]
    m = re.fullmatch(u + r"次にこのキャラクターがアタック宣言またはガード宣言した場合、(?:目標の)?«(t|\d)»に(\(?)(\d+)\)?ダメージを与える", s)   # A3-EX04 EX0447
    if m and (m.group(2) == "t" or R(m.group(2)) == "t"): return [{"a": "watchEv", "event": "battleDeclared", "when": {}, "bySrc": True, "once": True, "keepTargets": True, "effect": {"steps": [{"a": "damage", "to": "t", "n": int(m.group(4)), "mental": bool(m.group(3))}], "status": "auto"}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"«(\d)»に(\(?)(X|\d+)\)?ダメージを与える", s)   # A4-01 0152
    if m and raw_text_of(ref_of, m.group(2)) == "アタック宣言・ガード宣言・エフェクトの使用宣言をしたキャラクター":
        return [{"a": "watchEv", "event": "anyDeclared", "when": {}, "effect": {"steps": [{"a": "damage", "to": "evCh", "n": "X" if m.group(4) == "X" else int(m.group(4)), "mental": bool(m.group(3))}], "status": "auto"}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"«(\d)»はパーマネント-(\d+)を得、アタック宣言・ガード宣言は無効化される", s)   # A4-EP EP447 (Revise#353)
    if m and isinstance(R(m.group(2)), dict) and "all" in R(m.group(2)):
        return [{"a": "mod", "to": R(m.group(2)), "mod": md, "until": UNT[m.group(1)]} for md in ({"key": "skill", "op": "grant", "value": {"id": "permanent", "x": -int(m.group(3))}}, {"key": "noAttack", "op": "grant", "value": True}, {"key": "noGuard", "op": "grant", "value": True})]
    if re.fullmatch(r"目標の«(?:t|\d)»を構成する、一番上のカード以外のカード全てを、目標にパワーカードとしてセットする", s): return [{"a": "stackToPower", "to": "t"}]   # A4-03 0574 (Revise#353)
    m = re.fullmatch(r"«(\d)»を、このキャラクターにセットする", s)   # A4-EX02 EX794
    hm = m and re.fullmatch(r"あなたの手札の、カード名称に「([^」]+)」を含むパーマネントカード(\d+)枚", raw_text_of(ref_of, m.group(1)) or "")
    if hm: return [{"a": "pickZone", "zones": ["hand"], "owner": "you", "sel": {"types": ["Permanent"], "jpHas": hm.group(1)}, "n": int(hm.group(2)), "dest": "perm"}]
    m = re.fullmatch(r"(.+?場合)、その後、«(\d)»を手札に戻す", s)   # A4-EX02 EX851
    if m and raw_text_of(ref_of, m.group(2)) == "このエフェクトのコスト" and cond_of(m.group(1)): return [{"a": "_costToIf", "cond": cond_of(m.group(1)), "to": "hand"}]
    # ---- Revise#353 ----
    m = re.fullmatch(u + r"目標の«(?:t|\d)»に与えられたダメージは、代わりに目標のオーナーに与えられる", s)   # A4-PP PP114 / PP122
    if m: return [{"a": "mod", "to": "t", "mod": {"key": "dmgToOwner", "op": "grant", "value": True}, "until": UNT[m.group(1)]}]
    # ---- Revise#351 ----
    m = re.fullmatch(u + r"«(\d)»のコストは(\d+)上昇する", s)   # A3-EX04 EX0481
    if m and raw_text_of(ref_of, m.group(2)) == "あなたの支配キャラクターを対象に含む対戦相手の使用するプロジェクトカード全て":
        return [{"a": "field", "mod": {"to": {"players": "all"}, "key": "cardCostT", "op": "add", "value": {"types": ["Project"], "n": int(m.group(3)), "targetSel": {"owner": "you", "area": "controlled"}, "byOpp": True}, "until": UNT[m.group(1)]}}]
    # ---- Revise#350 ----
    if re.fullmatch(r"目標の«(?:t|\d)»の精神力に等しくなるまで、そのオーナーのデッキからカードを引いて、パワーカードとしてセットする", s): return [{"a": "fillPowerT", "to": "t"}]   # A4-03 0510 / 0586
    m = re.fullmatch(r"目標が[“\"]([^”\"]+)[”\"]以外の場合、その後、あなたのメインフェイズを終了する", s)   # A4-03 0510
    if m: return [{"a": "endMyMain", "ifTNot": {"ifTName": re.sub(r"\s+", "", m.group(1))}}]
    # ---- Revise#349 ----
    m = re.fullmatch(r"«(\d)»の上からカード(\d+)枚を公開する", s)   # A4-PP PP334 / PP342 (with the next sentence)
    if m and raw_text_of(ref_of, m.group(1)) == "対戦相手1人のデッキ": return [{"a": "oppTopPermToDamage", "n": int(m.group(2))}]
    if re.fullmatch(r"その中にある、パーマネントカード全てをオーナーのダメージ置き場に置き、残りをデッキの一番下に任意の順番で置く", s): return []   # done by the step before
    # ---- Revise#348 ----
    if re.fullmatch(r"目標の«(?:t|\d)»を、あなたの支配キャラクターにする", s): return [{"a": "dominate", "to": "t"}]   # A4-05 0911 / 0929
    if re.fullmatch(r"目標の«(?:t|\d)»にセットされているパワーカード全てを、このキャラクター(?:のパワーカードとして|に)セットする", s): return [{"a": "powerMoveToSelf", "to": "t"}]   # A4-05 0911
    m = re.fullmatch(r"このエフェクトの使用宣言時に、あなたの支配エリアの(\S+?)(\d+)人を捨て札する", s)   # A4-02 0310 (Revise#357): discarded when it resolves; the rest only then
    if m and class_tokens(m.group(1)): return [{"a": "ownSac", "sel": {"owner": "you", "area": "controlled", "icons": class_tokens(m.group(1))}, "n": int(m.group(2)), "_gateRest": True}]
    m = re.fullmatch(r"あなたの支配エリアの(\S+?)(\d+)体を捨て札する", s)   # A4-03 0535 / 0550: the rest only when all of them were discarded
    if m and class_tokens(m.group(1)): return [{"a": "ownSac", "sel": {"owner": "you", "area": "controlled", "icons": class_tokens(m.group(1))}, "n": int(m.group(2))}]
    m = re.fullmatch(r"(?:その後、)?«(\d)»を、?あなたの支配キャラクターとしてセットする", s)   # A4-EX02 EX903 (Revise#356)
    if m and raw_text_of(ref_of, m.group(1)) == "そのキャラクターと共通の分類を持つあなたの手札のキャラクターカード1枚":
        return [{"a": "rememberIconsT", "to": "t", "_first": True}, {"a": "pickZone", "zones": ["hand"], "owner": "you", "dest": "back", "n": 1, "sel": {"types": ["Character"], "icons": "@effIcons"}}]
    m = re.fullmatch(r"(?:その後、)?«(\d)»をあなたの支配キャラクターとしてセットする", s)   # A4-03 0535
    pm = m and re.fullmatch(r"あなたの捨て札置き場にあるブレイク条件のないブレイクカード(\d+)枚", raw_text_of(ref_of, m.group(1)) or "")
    if pm: return [{"a": "pickZone", "zones": ["discard"], "owner": "you", "sel": {"types": ["Break"], "noBreakRule": True}, "n": int(pm.group(1)), "dest": "back", "ifLast": True}]
    if re.fullmatch(r"その際、そのキャラクターを構成する一番上のブレイクカードをあなたのダメージ置き場に置く", s): return [{"a": "_topBreakToDamage"}]   # A4-02 0339 / 0354
    m = re.fullmatch(u + r"«(\d)»は(インターセプト|イニシアチブ|ステルス|シールド|ペネトレイト)または(インターセプト|イニシアチブ|ステルス|シールド|ペネトレイト)を得、攻撃力に([+\-ー−])(\d+)される", s)   # A4-PP PP363 / PP371
    if m and R(m.group(2)) == "self":
        return [{"a": "skillPick", "to": "self", "ids": [SKILL_JP[m.group(3)], SKILL_JP[m.group(4)]], "until": UNT[m.group(1)]}, {"a": "mod", "to": "self", "mod": {"key": "at", "op": "add", "value": int(m.group(6)) * (1 if m.group(5) == "+" else -1)}, "until": UNT[m.group(1)]}]
    if re.fullmatch(r"このカードの効果でキャラクターにダメージを与えた場合、その後、このカードを捨て札する", s): return []   # A4-EP EP504 (Revise#346): it leaves after its effect anyway
    # ---- Revise#346 ----
    if re.fullmatch(r"このエフェクトは、このキャラクターがアタック宣言している場合にのみ使用宣言可能", s): return [{"a": "_declCond", "cond": {"self": "attacking"}}]   # A3-EX02 EX0111
    m = re.fullmatch(r"«(\d)»をオーナーのデッキに戻し、そのデッキをシャッフルする", s)   # A4-PP PP084
    if m and raw_text_of(ref_of, m.group(1)) == "同じカード名称のカードが2枚以上場に存在するカード全てと、それらにセットされているカード全て": return [{"a": "dupNameToDeck"}]
    m = re.fullmatch(r"«(\d)»は、自分の支配エリアの各勢力のブレイクしていないキャラクターを1人ずつ選んで捨て札する", s)   # A4-04 0709
    if m and raw_text_of(ref_of, m.group(1)) == "プレイヤー全て": return [{"a": "eachFactionSac", "sel": {"broken": False}}]
    m = re.fullmatch(r"«(\d)»を捨て札する", s)   # A4-01 0054
    if m and raw_text_of(ref_of, m.group(1)) == "あなたの対戦相手1人のテリトリーの、あなたの任意の勢力1つのブレイクしていないキャラクター全て": return [{"a": "oppFactionSweep", "sel": {"broken": False}}]
    # ---- Revise#345 ----
    m = re.fullmatch(r"このエフェクトのコストを、(ブレイクしている)?[“\"]([^”\"]+)[”\"]以外から支払うことはできない", s)   # A4-EP EP439: an effect is paid by its own character → usable only on that one
    if m: return [{"a": "_declCond", "cond": {"selfIs": dict({"name": re.sub(r"\s+", "", m.group(2))}, **({"broken": True} if m.group(1) else {}))}}]
    m = re.fullmatch(u + r"目標の«(?:t|\d)»がアタック宣言している場合、([±+\-ー−]\(?\d+\)?)/([±+\-ー−]\(?\d+\)?)/([±+\-ー−]\(?\d+\)?)する", s)   # A3-EX03 EX0332
    if m: return [{"a": "mod", "to": "t", "until": UNT[m.group(1)], "cond": {"self": "attacking"}, "mod": {"key": k, "op": "add", "value": sign_n(m.group(g))}} for k, g in (("se", 2), ("at", 3), ("de", 4)) if sign_n(m.group(g))]
    m = re.fullmatch(r"(?:その後、)?このカードのコストが(?:必要ファクターが(\d+)以上の)?(\S+?系)を持つキャラクター1人からのみ支払われている場合、(代わりに、?|さらに、|その後、)?(.+)", s)   # A4-EP EP501 / EP502 / EP507 / EP513
    if m:
        g4 = m.group(4); pb = dict({"sel": True, "one": True, "tag": m.group(2)}, **({"factorGe": int(m.group(1))} if m.group(1) else {}))
        pm = re.fullmatch(r"(?:目標|«t»)にセットされているパワーカードを(\d+)枚捨て札する", g4)
        r2 = [{"a": "powerDiscard", "to": "t", "n": int(pm.group(1))}] if pm else sentence_steps(g4, ref_of)
        if (not r2 or any(x.get("a") == "manual" for x in r2)) and not re.match(r"(?:ターン|メインフェイズ)終了時まで", g4): r2 = sentence_steps("ターン終了時まで、" + g4, ref_of)
        if r2 and not any(x.get("a") == "manual" for x in r2):
            out2 = [dict(x, ifPaidBy=pb) for x in r2]
            if m.group(3) and m.group(3).startswith("代わりに"): out2[0]["_instead"] = {"paidBy": pb}
            return out2
    m = re.fullmatch(u + r"«(\d)»が捨て札される場合、このカードを捨て札することで、そのキャラクターを場に残すことが可能", s)   # A4-02 0375
    ks = m and re.fullmatch(r"(.+?)キャラクター(?:全て)?", raw_text_of(ref_of, m.group(2)) or "")
    if ks and parse_selector(ks.group(1)): return [{"a": "mod", "to": {"all": parse_selector(ks.group(1))}, "mod": {"key": "keepByCard", "op": "grant", "value": True}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(r"«(\d)»に、あなたのデッキの上のカードを、1枚ずつパワーカードとしてセットする", s)   # A4-EX01 EX0761
    if m and isinstance(R(m.group(1)), dict) and "all" in R(m.group(1)): return [{"a": "powerFromDeck", "to": R(m.group(1)), "n": 1}]
    m = re.fullmatch(r"(.+?場合)、" + u + r"«(\d)»から、コストを支払うことはできない", s)   # A3-EX02 EX0104
    if m and cond_of(m.group(1)) and isinstance(R(m.group(3)), dict) and "all" in R(m.group(3)): return [{"a": "mod", "to": R(m.group(3)), "mod": {"key": "noPay", "op": "grant", "value": True}, "until": UNT[m.group(2)], "if": cond_of(m.group(1))}]
    if re.fullmatch(r"このカードのコストは、目標からのみ支払うことが可能", s): return [{"a": "_payOnlyTarget"}]   # A4-EX01 EX0740
    m = re.fullmatch(u + r"目標の«(?:t|\d)»がバトルする際、(±0|\+X|\+\d+)/(±0|\+X|\+\d+)/(±0|\+X|\+\d+)して判定する", s)   # A4-EX01 EX0740
    if m and "X" in m.group(0): return [{"a": "mod", "to": "t", "until": UNT[m.group(1)], "cond": {"self": "inBattle"}, "mod": {"key": k, "op": "add", "value": {"xvar": True, "sign": 1} if m.group(g) == "+X" else int(m.group(g)[1:])}} for k, g in (("se", 2), ("at", 3), ("de", 4)) if m.group(g) != "±0"]
    m = re.fullmatch(r"場に[“\"]([^”\"]+)[”\"]がいる場合、さらに、[“\"]\1[”\"]にセットされているパワーカード(X|\d+)枚を捨て札する", s)   # A4-EX01 EX0764
    if m: return [{"a": "powerDiscard", "to": {"all": {"name": re.sub(r"\s+", "", m.group(1))}}, "n": "X" if m.group(2) == "X" else int(m.group(2))}]
    m = re.fullmatch(u + r"目標の次のアタック宣言はガードされない", s)   # A4-EX02 EX889
    if m: return [{"a": "mod", "to": "t", "mod": {"key": "unguardedNextP", "op": "grant", "value": {"any": True}}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"目標の«(?:t|\d)»がキャパシティ\+Xを持つキャラクターとバトルする際、([±+\-ー−]\(?\d+\)?)/([±+\-ー−]\(?\d+\)?)/([±+\-ー−]\(?\d+\)?)して判定する", s)   # A4-EX01 EX0732
    if m: return [{"a": "mod", "to": "t", "until": UNT[m.group(1)], "cond": {"battleVs": {"skill": "capacity"}}, "mod": {"key": k, "op": "add", "value": sign_n(m.group(g))}} for k, g in (("se", 2), ("at", 3), ("de", 4)) if sign_n(m.group(g))]
    m = re.fullmatch(u + r"対戦相手の支配キャラクターがアタック宣言またはガード宣言した場合、«(\d)»に(\d+)ダメージを与えることが可能", s)   # A4-EP EP446
    if m and raw_text_of(ref_of, m.group(2)) == "そのキャラクター":
        return [{"a": "watchEv", "event": "battleDeclared", "when": {"opp": True, "sel": {"area": "controlled"}}, "once": True, "optional": True, "effect": {"steps": [{"a": "damage", "to": "evCh", "n": int(m.group(3)), "mental": False}, {"a": "thisCardDiscard"}], "status": "auto"}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"あなたがネームレベルキャラクターを(\d+)体以上支配している場合、«(\d)»は対戦相手の使用したカードの効果と、ダメージを受けない", s)   # A4-05 0849
    if m and R(m.group(3)) == "you":
        cd = {"count": {"sel": {"owner": "you", "area": "controlled", "named": True}, "op": ">=", "n": int(m.group(2))}}
        return [{"a": "field", "mod": {"to": "you", "key": "playerImmune", "op": "grant", "value": {"byOpp": True}, "cond": cd, "until": UNT[m.group(1)]}}, {"a": "field", "mod": {"to": "you", "key": "playerNoDamageAll", "op": "grant", "value": True, "cond": cd, "until": UNT[m.group(1)]}}]
    # ---- Revise#342 ----
    m = re.fullmatch(u + r"目標の«(?:t|\d)»のアタック宣言に対してガード宣言したキャラクターに、(\(?)(X|\d+)\)?ダメージを与える", s)   # A4-04 0612
    if m: return [{"a": "watchEv", "to": "t", "event": "guarded", "when": {"self": True, "asAttacker": True}, "effect": {"steps": [{"a": "damage", "to": "evCh", "n": "X" if m.group(3) == "X" else int(m.group(3)), "mental": bool(m.group(2))}], "status": "auto"}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"«(\d)»に(\(?)(X|\d+)\)?ダメージを与える", s)   # A4-PP PP216: the guard of an attack by one of those classes
    gm = m and re.fullmatch(r"(.+?)のアタック宣言に対してガード宣言したキャラクター", raw_text_of(ref_of, m.group(2)) or "")
    if gm and class_tokens(gm.group(1)) and len(class_tokens(gm.group(1))) == len(re.split(r"・|または", gm.group(1))):
        return [{"a": "watchEv", "event": "guarded", "when": {}, "attSel": {"icons": class_tokens(gm.group(1))}, "effect": {"steps": [{"a": "damage", "to": "evCh", "n": "X" if m.group(4) == "X" else int(m.group(4)), "mental": bool(m.group(3))}], "status": "auto"}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"«(\d)»の攻撃力に\+X(?:して判定)?する", s)   # A4-04 0740: every attacker that is guarded, from then on
    if m and raw_text_of(ref_of, m.group(2)) == "アタック宣言に対してガード宣言されたキャラクター":
        return [{"a": "watchEv", "event": "guarded", "when": {}, "evAttacker": True, "effect": {"steps": [{"a": "mod", "to": "evCh", "mod": {"key": "at", "op": "add", "value": {"xvar": True, "sign": 1}}, "until": UNT[m.group(1)]}], "status": "auto"}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"目標の«(?:t|\d)»は、プレイヤーを目標にした次のアタック宣言をガードされない", s)   # A4-05 0954
    if m: return [{"a": "mod", "to": "t", "mod": {"key": "unguardedNextP", "op": "grant", "value": True}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(r"«(\d)»をオーナーのデッキに戻す", s)   # A4-02 0313 (each deck is shuffled by the step)
    if m and raw_text_of(ref_of, m.group(1)) == "キャラクター全てにセットされているパワーカード1枚ずつ": return [{"a": "eachPowerToDeck"}]
    m = re.fullmatch(u + r"目標の«(?:t|\d)»は、バトルの際、\+X/\+X/\+Xして判定する", s)   # A4-EX01 EX0762
    if m: return [{"a": "mod", "to": "t", "until": UNT[m.group(1)], "cond": {"self": "inBattle"}, "mod": {"key": k, "op": "add", "value": {"xvar": True, "sign": 1}}} for k in ("se", "at", "de")]
    m = re.fullmatch(u + r"目標の«(?:t|\d)»がバトルする際、目標の持つスキル全てを無効化する", s)   # A4-EX01 EX0743
    if m: return [{"a": "mod", "to": "t", "until": UNT[m.group(1)], "cond": {"self": "inBattle"}, "mod": {"key": "negate", "op": "grant", "value": {"skills": True, "effects": False}}}]
    m = re.fullmatch(u + r"«(\d)»は、アタックした場合、攻撃力に\+(\d+)して判定する", s)   # A4-EX01 EX0739
    if m and isinstance(R(m.group(2)), dict) and "all" in R(m.group(2)): return [{"a": "mod", "to": R(m.group(2)), "until": UNT[m.group(1)], "cond": {"self": "attacking"}, "mod": {"key": "at", "op": "add", "value": int(m.group(3))}}]
    m = re.fullmatch(r"あなたの支配エリアにブレイクしている[“\"]([^”\"]+)[”\"]とブレイクしている[“\"]([^”\"]+)[”\"]がいない場合、«(\d)»を捨て札する", s)   # A4-EX01 EX0733
    if m and raw_text_of(ref_of, m.group(3)) == "このカード": return [{"a": "discard", "to": "card", "if": {"not": {"namesCtl": [re.sub(r"\s+", "", m.group(1)), re.sub(r"\s+", "", m.group(2))], "broken": True}}}]
    m = re.fullmatch(r"目標のパワーが(\d+)の場合、このカードを捨て札する", s)   # A3-EX04 EX0478
    if m: return [{"a": "discard", "to": "card", "ifTSel": {"power": {"op": "=", "n": int(m.group(1))}}}]
    m = re.fullmatch(u + r"(?:目標|«t»)がバトルする際、?(?:目標|«t»)に([±+\-ー−]\(?\d+\)?)/([±+\-ー−]\(?\d+\)?)/([±+\-ー−]\(?\d+\)?)して判定する", s)   # EP387 (Revise#217)
    if m: return [{"a": "mod", "to": "t", "until": UNT[m.group(1)], "cond": {"self": "inBattle"}, "mod": {"key": k, "op": "add", "value": sign_n(m.group(g))}} for k, g in (("se", 2), ("at", 3), ("de", 4)) if sign_n(m.group(g))]
    m = re.fullmatch(u + T + r"は対戦相手のダメージ置き場にあるプロジェクトカードの勢力全てに対するプロテクトを持つ", s)   # A3-EX05 EX0594 (Revise#217)
    if m and R(m.group(2)) is not None: return [{"a": "protectFromPile", "to": R(m.group(2)), "until": UNT[m.group(1)]}]
    m = re.fullmatch(r"このターン中に、?あなたの支配キャラクターが対戦相手の支配キャラクターとのバトルによって捨て札されている場合、(.+)", s)   # A3-EP EP387 (Revise#217)
    if m:
        r2 = sentence_steps(m.group(1), ref_of)
        if r2 and not any(x.get("a") == "manual" for x in r2): return [dict(x, **{"if": {"lostBattleTurn": True}}) for x in r2]
    m = re.fullmatch(u + T + r"は、?(?:アタックでない、)?バトル以外のダメージを受けない", s)   # EX0303 / EXPV020 (Revise#216)
    if m and R(m.group(2)) is not None: return [{"a": "mod", "to": R(m.group(2)), "mod": {"key": "noDamage", "op": "grant", "value": {"outside": True}}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"(?:目標|«t»)がバトルまたはキャラクターにアタックした際に、?(?:目標|«t»)の攻撃力に\+(\d+)して判定する", s)   # EX0301 / EX0601 (Revise#216): while it battles
    if m: return [{"a": "mod", "to": "t", "until": UNT[m.group(1)], "cond": {"self": "inBattle"}, "mod": {"key": "at", "op": "add", "value": int(m.group(2))}}]
    m = re.fullmatch(u + r"«(\d)»は、?手札全てをプレイヤー全てに見せてプレイする", s)   # A3-EX02 EX0150 (Revise#216): for a while
    if m and R(m.group(2)) in ("players", "opp"): return [{"a": "field", "mod": {"to": {"players": "all" if R(m.group(2)) == "players" else "opponents"}, "key": "handsOpen", "op": "grant", "value": True, "until": UNT[m.group(1)]}}]
    m = re.fullmatch(r"(あなたの支配エリアに[“\"][^”\"]+[”\"]がいる場合)、メインフェイズ終了時に、?(?:≪このカード≫|このカード|«\d»)をオーナーの手札に戻す", s)   # EX0150 (Revise#216)
    if m and cond_of(m.group(1)): return [{"a": "delayed", "at": "main", "step": {"a": "selfCardToHandAny", "ifCond": cond_of(m.group(1))}}]
    m = re.fullmatch(u + T + r"に、?([^、・を]+?)または([^、・を]+?)を与える", s)   # EX0112 (Revise#216): one of two skills, chosen
    if m and R(m.group(2)) is not None and SKILL_JP.get(m.group(3)) and SKILL_JP.get(m.group(4)): return [{"a": "grantOneSkill", "to": R(m.group(2)), "ids": [SKILL_JP[m.group(3)], SKILL_JP[m.group(4)]], "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"目標がバトルによるダメージを与えた(?:場合|際)、?ダメージを受けたキャラクターにセットされているパワーカード全てを捨て札する", s)   # A3-EX05 EX0605 / EX0613 (Revise#216)
    if m: return [{"a": "watchEv", "to": "t", "event": "damaged", "when": {"byThisBattle": True}, "effect": {"steps": [{"a": "powerDiscard", "to": "evCh"}], "status": "auto"}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"目標がバトルによるダメージを与えた(?:場合|際)、?ダメージを受けたキャラクターにセットされているパワーカードを、?目標のパワーに等しい枚数(?:を)?捨て札する", s)   # EX0613 (Revise#216): as many as the target's power then
    if m: return [{"a": "watchEv", "to": "t", "event": "damaged", "when": {"byThisBattle": True}, "effect": {"steps": [{"a": "powerDiscard", "to": "evCh", "nWatchPower": True}], "status": "auto"}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"目標のバトル相手の持つ(バインドX|バインド|イニシアチブ|ペネトレイト|シールド|インターセプト|ブレイクスルー|ステルス)のスキルを無効化する", s)   # EX0613 (Revise#216): the target's battle opponents now
    if m and SKILL_JP.get(re.sub(r"X$", "", m.group(2))): return [{"a": "mod", "to": "tBattleOpp", "mod": {"key": "skill", "op": "remove", "value": {"id": SKILL_JP[re.sub(r"X$", "", m.group(2))]}}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + T + r"は、?バトルの際、?パワーが目標のパワー以下のキャラクターとのバトルによるダメージを受けない", s)   # A3-EX03 EX0342 (Revise#215): the target's power now (live)
    if m and R(m.group(2)) is not None: return [{"a": "mod", "to": R(m.group(2)), "mod": {"key": "noDamage", "op": "grant", "value": {"battle": True, "fromSel": {"power": {"op": "<=", "n": "X"}}}}, "until": UNT[m.group(1)]}]
    if re.fullmatch(r"目標のパワーが0の場合、?目標のアタック宣言・ガード宣言は無効化される", s):   # EX0342 (Revise#215): checked when it resolves; for this turn
        return [{"a": "mod", "to": "t", "ifTSel": {"power": {"op": "=", "n": 0}}, "mod": {"key": k, "op": "grant", "value": True}, "until": "turn"} for k in ("noAttack", "noGuard")]
    m = re.fullmatch(T + r"にセットされているパワーカード全てを、?目標以外のあなたの任意のあなたの支配キャラクター(?:X|\d+)(?:体|人)に1枚ずつセットする", s)   # A3-EP EP386 (Revise#215)
    if m and R(m.group(1)) == "t": return [{"a": "powerSpread", "to": "t"}]
    m = re.fullmatch(u + T + r"は、?(精神力|攻撃力|耐久力)がX(以上|以下|未満|を超える)のキャラクターとのバトルによるダメージを受けず、(精神力|攻撃力|耐久力)がX(以上|以下|未満|を超える)のキャラクターにガードされない", s)   # A3-EP EP390 (Revise#215): X fixed when it resolves
    if m and R(m.group(2)) is not None:
        OPS_ = {"以上": ">=", "以下": "<=", "未満": "<", "を超える": ">"}
        return [{"a": "mod", "to": R(m.group(2)), "resolveX": True, "mod": {"key": "noDamage", "op": "grant", "value": {"battle": True, "fromSel": {"stat": [{"key": STAT_JP[m.group(3)], "op": OPS_[m.group(4)], "n": "X"}]}}}, "until": UNT[m.group(1)]},
                {"a": "mod", "to": R(m.group(2)), "resolveX": True, "mod": {"key": "noGuardBy", "op": "grant", "value": {"stat": [{"key": STAT_JP[m.group(5)], "op": OPS_[m.group(6)], "n": "X"}]}}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + T + r"は、?(?:このキャラクター|目標)と同じ分類を一種類以上持つキャラクターとのバトルによるダメージを受けない", s)   # A3-11 1688 (Revise#215): "このキャラクター" read as the target (as the next line)
    if m and R(m.group(2)) is not None: return [{"a": "mod", "to": R(m.group(2)), "mod": {"key": "noDamage", "op": "grant", "value": {"battle": True, "fromSel": {"shareIconSelf": True}}}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"«(\d)»は、?あなたがチャージの効果でセットするカードの内容を見ることができる", s)   # A3-18 2466 (Revise#214)
    if m and R(m.group(2)) == "you": return [{"a": "mod", "to": "you", "mod": {"key": "seeCharge", "op": "grant", "value": True}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(r"(あなたの支配エリアに.+?キャラクターがいる場合)、パワーカードフェイズ開始時に、«(\d)»をあなたのデッキに戻し、そのデッキをシャッフルする", s)   # A3-18 2466 (Revise#214)
    if m and cond_of(m.group(1)): return [{"a": "delayed", "at": "chargeStart", "step": {"a": "pickZone", "zones": ["discard"], "owner": "you", "n": "X", "dest": "deckShuffle", "sel": {}, "ifCond": cond_of(m.group(1)), "xLive": True}}]
    m = re.fullmatch(r"(?:" + u + r")?" + T + r"の持つスキル1つを無効化する", s)   # Revise#210: you choose 1 skill
    if m and R(m.group(2)) is not None: return [{"a": "skillOffPick", "to": R(m.group(2)), "until": UNT[m.group(1)] if m.group(1) else "turn"}]
    m = re.fullmatch(r"(?:" + u + r")?(?:目標|«t»)のバトル相手の持つスキル1つを無効化する", s)   # EX0319 (Revise#210)
    if m: return [{"a": "skillOffPick", "to": "tBattleOpp", "until": UNT[m.group(1)] if m.group(1) else "turn"}]
    m = re.fullmatch(u + r"«(\d)»は、?((?:(?:ブレイク|プロジェクト|ファスト|パーマネント)カード・?)+)を使用する際、?そのコストを、?1人のキャラクターから支払わなければならない", s)   # A3-02 0421 (Revise#209)
    if m and R(m.group(2)) in ("players", "you", "opp"): return [{"a": "mod", "to": R(m.group(2)), "mod": {"key": "payOneChar", "op": "grant", "value": {"types": [CARD_TYPES_JP[x] for x in re.findall(r"(ブレイク|プロジェクト|ファスト|パーマネント)カード", m.group(3))]}}, "until": UNT[m.group(1)]}]
    if re.fullmatch(r"このカードは、?勢力フェイズ中にのみ使用(?:宣言)?可能", s): return [{"a": "_activeOnly"}]   # EX0336 (Revise#208)
    m = re.fullmatch(r"(?:このカードが効果を発揮した場合、)?«(\d)»から、“([^”]+)”と“([^”]+)”のネームを持つブレイクカードを1枚ずつ選び、手札に加える", s)   # A4-EX02 EX886 (Revise#354)
    if m and raw_text_of(ref_of, m.group(1)) == "あなたのデッキ": return [{"a": "pickZone", "zones": ["deck"], "owner": "you", "n": 1, "sel": {"types": ["Break"], "names": [re.sub(r"\s+", "", m.group(k))]}, "dest": "hand"} for k in (2, 3)]
    m = re.fullmatch(r"あなたが(武蔵|英国|三征西班牙|K\.P\.A\.Italia|六護式仏蘭西|M\.H\.R\.R\.|P\.A\.Oda|上越露西亜|清武田|IZUMO|三河)を持つブレイクカードをセットした際、«(\d)»を手札に戻すことが可能", s)   # A4-EX02 EX874 / EX875 / EX876 (Revise#367): asked each time; using it discards this card
    if m and raw_text_of(ref_of, m.group(2)) == "そのブレイクカードのコスト":
        return [{"a": "mod", "to": "you", "mod": {"key": "keepPaid", "op": "grant", "value": True}, "until": "removed"}, {"a": "watchEv", "event": "broken", "when": {"own": True, "cardTag": m.group(1)}, "optional": True, "once": True, "effect": {"steps": [{"a": "paidToHandEv"}, {"a": "thisCardDiscard"}], "status": "auto"}, "until": "removed"}]
    if s == "この効果を使用した場合、このカードを捨て札する": return []   # EX874: part of the watcher above
    if re.fullmatch(r"(?:その後、)?あなたの手札X枚を、あなたのテリトリーのキャラクターにパワーカードとしてセットする", s): return [{"a": "handXToPower", "n": "X"}]   # A4-PP PP054 (Revise#365)
    m = re.fullmatch(r"(?:その後、)?«(\d)»に、?(\()?X\)?ダメージを割り振って与える", s)   # A3-25 3694 / A3-PR PR340 (Revise#365)
    if m and raw_text_of(ref_of, m.group(1)) == "そのキャラクターのいたエリアの任意のキャラクター": return [{"a": "rememberAreaT", "to": "t", "_first": True}, {"a": "splitDamage", "n": "X", "mental": bool(m.group(2)), "area": "last"}]
    m = re.fullmatch(r"(?:その後、)?あなたの手札から、カード名称に「([^」]+)」を含むブレイクカード1枚を、ファクターを無視してコストを支払ってセット宣言可能", s)   # A3-EX02 EX0183 (Revise#365)
    if m: return [{"a": "effDecl", "zones": ["hand"], "types": ["Break"], "ignoreFactor": True, "anyChar": True, "jpHas": m.group(1)}]
    m = re.fullmatch(r"(?:その後、)?任意の«(\d)»に(\()?X\)?ダメージを割り振って与える", s)   # A3-14 1948 (Revise#363): X = the power cards discarded just before
    if m and raw_text_of(ref_of, m.group(1)) == "プレイヤーまたはキャラクター": return [{"a": "splitDamage", "n": "last", "mental": bool(m.group(2)), "players": True}]
    if s == "Xは捨て札したパワーカード枚数に等しい": return []   # 1948: read by the step before ("last")
    m = re.fullmatch(r"(?:その後、)?あなたの手札(\d+)枚を捨て札することが可能", s)   # A3-EX02 EX0130 (Revise#363)
    if m: return [{"a": "discardHandAnyX", "max": int(m.group(1))}]
    if re.fullmatch(r"そうした場合、(?:«c»|«\d»|このカード)を目標にパワーカードとしてセットする", s): return [{"a": "thisCardPowerT", "to": "t", "ifLast": True}]   # EX0130
    m = re.fullmatch(r"(?:その後、)?«(\d)»に(\()?(\d+)\)?ダメージを与える", s)   # A3-24 3544 (Revise#362)
    if m and raw_text_of(ref_of, m.group(1)) == "そのキャラクターのオーナーのテリトリーの、このカードの効果で捨て札されたキャラクターと同じ分類を持つキャラクター全て":
        return [{"a": "rememberIconsT", "to": "t", "_first": True}, {"a": "damageIconsOwner", "n": int(m.group(3)), "mental": bool(m.group(2))}]
    m = re.fullmatch(r"あなたのデッキの上から(?:カードを)?(\d+)枚を?あなたのダメージ置き場に置く", s)   # A4-03 0505 (Revise#369)
    if m: return [{"a": "mill", "to": "you", "n": int(m.group(1)), "zone": "damage"}]
    m = re.fullmatch(r"(?:その後、)?捨て札したブレイクカードのコストに等しい枚数をあなたのデッキの上から引いて、パワーカードとして" + T + r"にセットする", s)   # A3-PR PR329 (Revise#362)
    if m: return [{"a": "powerFromDeck", "to": R(m.group(1)), "n": "X", "_x": {"targetCost": True}}]
    m = re.fullmatch(r"(?:このカードが効果を発揮した場合、)?" + T + r"の手札を見て、ネームを持つカードを(X|\d+)枚まで捨て札する", s)   # A4-05 0958 (Revise#360)
    if m: return [{"a": "peekHandDiscardT", "to": R(m.group(1)), "sel": {"named": True}, "n": "X" if m.group(2) == "X" else int(m.group(2))}]
    m = re.fullmatch(r"«(\d)»に、?(\()?(\d+)\)?ダメージを与える", s)   # A4-03 0477 (Revise#360): while the card stays
    if m and raw_text_of(ref_of, m.group(1)) == "対戦相手のテリトリーのキャラクターをブレイクしたプレイヤー": return [{"a": "watchEv", "event": "broken", "when": {"oppTerritory": True}, "effect": {"steps": [{"a": "damage", "to": "evActor", "n": int(m.group(3)), "mental": bool(m.group(2))}], "status": "auto"}, "until": "removed"}]
    m = re.fullmatch(r"«(\d)»の上から(\d+)枚を見て、その中に指定したネームを持つカードがあった場合、その中の1枚を手札に加えることが可能", s)   # A3-EX01 EX0069 (Revise#360)
    if m and raw_text_of(ref_of, m.group(1)) == "あなたのデッキ": return [{"a": "pickZone", "zones": ["deck"], "owner": "you", "topN": int(m.group(2)), "n": 1, "upTo": True, "sel": {"name": "chosen"}, "dest": "hand"}]
    m = re.fullmatch(r"«(\d)»をあなたのデッキに戻してシャッフルする", s)   # A3-25 3621 (Revise#360)
    if m and raw_text_of(ref_of, m.group(1)) == "このカードのコストと、あなたの捨て札置き場のあなたの任意のカードX枚": return [{"a": "costTo", "to": "deckShuffle"}, {"a": "pickZone", "zones": ["discard"], "owner": "you", "n": "X", "dest": "deckShuffle", "sel": {}}, {"a": "shuffle", "to": "you"}]
    if re.fullmatch(r"このカードはあなたのターン中にのみ使用宣言可能", s): return [{"a": "_declCond", "cond": {"myTurn": True}}]   # A4-05 0994 (Revise#354)
    if re.fullmatch(r"このカードはアタック宣言が行われている場合にのみ使用宣言可能", s): return [{"a": "_declCond", "cond": {"attackDeclared": True}}]   # A4-02 0283 (Revise#354)
    if re.fullmatch(r"このカードは、?このターン中にあなたがカードの使用宣言を行っていない場合にのみ使用宣言可能", s): return [{"a": "_declCond", "cond": {"noDeclThisTurn": True}}]   # EX0615 (Revise#208)
    m = re.fullmatch(r"(?:目標の)?«(\d|t)»に、?あなたのデッキの上からカードを(\d+)枚引き、?(?:それぞれに)?パワーカードとしてセットする", s)   # EX0336 / EX0615 (Revise#208)
    if m and R(m.group(1)) is not None: return [{"a": "powerFromDeck", "to": R(m.group(1)), "n": int(m.group(2))}]
    m = re.fullmatch(r"(?:このカードが効果を発揮した(?:際|場合)に?、)?あなたのデッキの上からカードを(\d+)枚引き、?(?:目標|«t»)にパワーカードとしてセットする", s)   # EX0335 (Revise#209)
    if m: return [{"a": "powerFromDeck", "to": "t", "n": int(m.group(1))}]
    m = re.fullmatch(r"このカードが効果を発揮した場合、?あなたのデッキの一番上のカード(\d+)枚をパワーカードとして(?:目標|«t»)にセットする", s)   # EX0617 (Revise#208)
    if m: return [{"a": "powerFromDeck", "to": "t", "n": int(m.group(1))}]
    m = re.fullmatch(r"(?:その後、)?(?:目標|«t»)が(" + WORK_ALT + r")のキャラクターの場合、?あなたは(\d+)ドロー(可能|する)", s)   # EX0617 (Revise#208)
    if m: return [dict({"a": "mayDraw" if m.group(3) == "可能" else "draw", "n": int(m.group(2))}, **({"to": "you"} if m.group(3) != "可能" else {}), ifTSel={"works": WORKS_JP[m.group(1)]})]
    m = re.fullmatch(r"(?:その後、)?このカードのコストが(.+?)キャラクターからのみ支払われていた場合、?あなたは(\d+)ドローする", s)   # EX0473 (Revise#208)
    if m and parse_selector(m.group(1)): return [{"a": "draw", "to": "you", "n": int(m.group(2)), "ifPaidBy": dict(parse_selector(m.group(1)), sel=True)}]
    m = re.fullmatch(r"このカードのコストは、?“([^”]+)”がセットされているネームレベルキャラクターからのみ支払うことが可能", s)   # A4-EX01 EX0756 (Revise#363)
    if m: return [{"a": "_payOnlySel", "sel": {"named": True, "hasPermJpHas": re.sub(r"\s+", "", m.group(1))}}]
    m = re.fullmatch(r"このカードのコストは、?(.+?)キャラクターからのみ支払うことが可能", s)   # EX0475 (Revise#207)
    if m and parse_selector(m.group(1)): return [{"a": "_payOnlySel", "sel": parse_selector(m.group(1))}]
    m = re.fullmatch(r"このカードは、?(あなたの支配エリアに.+?(?:がいる|が存在する)場合)にのみ使用(?:宣言)?可能", s)   # EX0309 / EX0320 (Revise#207)
    if m and cond_of(m.group(1)): return [{"a": "_declCond", "cond": cond_of(m.group(1))}]
    m = re.fullmatch(r"このカードはあなたが(.+?)キャラクターを支配している場合にのみ使用(?:宣言)?可能", s)   # A3-19 2632 (Revise#170)
    if m and parse_selector(m.group(1)) is not None: return [{"a": "_declCond", "cond": {"count": {"sel": dict(parse_selector(m.group(1)), owner="you", area="controlled"), "op": ">=", "n": 1}}}]
    m = re.fullmatch(r"(?:その後、)?(?:«(\d)»|このカード)を、?あなたのダメージ置き場に置くことが可能", s)   # A3-20 2729 / A3-25 3623 (Revise#166)
    if m and (m.group(1) is None or raw_text_of(ref_of, m.group(1)) == "このカード"): return [{"a": "maySelfToDamage"}]
    m = re.fullmatch(u + r"(?:目標の«\d»|目標|«t»)がプレイヤーにアタックした場合、?(?:目標の|«t»の)?攻撃力に([+\-]\d+)して判定する", s)   # A3-25 3656 / EX0072
    if m: return [{"a": "mod", "to": "t", "mod": {"key": "at", "op": "add", "value": sign_n(m.group(2))}, "cond": {"self": "attackingPlayer"}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(T + r"を、?(?:オーナーの)?手札に戻す", s)   # A4-04 0673 (Revise#288): "≪このキャラクターにセットされているパーマネントカード1枚≫を手札に戻す"
    if m and m.group(1) != "t" and raw_text_of(ref_of, m.group(1)) == "このキャラクターにセットされているパーマネントカード1枚": return [{"a": "selfPermPick", "dest": "hand"}]
    m = re.fullmatch(r"«(\d)»は、?あなたの支配エリアのパワーカードの内容を全て確認し、?その中の1枚を手札に戻す", s)   # A4-EX02 EX909 (Revise#294)
    if m and R(m.group(1)) == "you": return [{"a": "ownPowerPick", "dest": "hand"}]
    m = re.fullmatch(r"«(\d)»からカード1枚を選び、?あなたのデッキをシャッフルする", s)   # A4-02 0243 / 0258 (Revise#282): shuffle, the chosen card on top
    if m and R(m.group(1)) == "yourDeck": return [{"a": "shuffle", "to": "you"}, {"a": "pickZone", "zones": ["deck"], "owner": "you", "dest": "deckTop", "n": 1}]
    if re.fullmatch(r"(?:その後、)?選んだカードをあなたのデッキの一番上に置く", s): return []   # (the step above)
    m = re.fullmatch(r"«(\d)»から、?「([^」]+)」を1枚選び、?(?:あなたの)?手札に加える", s)   # A4-02 0277 / 0292 (Revise#282): by card title
    if m and R(m.group(1)) == "yourDeck": return [{"a": "pickZone", "zones": ["deck"], "owner": "you", "dest": "hand", "n": 1, "sel": {"anyOf": [{"jp": re.sub(r"\s+", "", m.group(2))}]}}]
    m = re.fullmatch(r"«(\d)»の、?([^、«]+?)を持つブレイクカード1枚をあなたの手札に加える", s)   # A3-09 1382 (Revise#172)
    if m and R(m.group(1)) == "yourDeck" and class_tokens(m.group(2).replace("または", "・")) and len(class_tokens(m.group(2).replace("または", "・"))) == len(m.group(2).split("または")):
        return [{"a": "pickZone", "zones": ["deck"], "owner": "you", "dest": "hand", "n": 1, "sel": {"types": ["Break"], "icons": class_tokens(m.group(2).replace("または", "・"))}}, {"a": "shuffle", "to": "you"}]
    if re.fullmatch(r"このカードの必要ファクターは、このカードの使用宣言時にあなたのデッキの上からカードを1枚捨て札するごとに、1ずつ減少する", s): return [{"a": "_discount", "v": {"from": "deck", "to": "discard", "factorOnly": True}}]   # A3-EX04 EX0472 (Revise#366)
    if re.fullmatch(r"このカードの必要ファクターとコストは、このカードの使用宣言時にあなたがあなたのデッキの上からカード1枚をあなたのダメージ置き場に置くごとに、1ずつ減少する", s): return [{"a": "_discount", "v": {"from": "deck", "to": "damage"}}]   # A3-14 2031 (Revise#366)
    m = re.fullmatch(r"このカードの必要ファクターとコストは、?このカードの使用宣言時に、?(?:あなたが)?あなたの任意のあなたの手札(?:の(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のカード)?1枚を(捨て札する|捨てる|あなたのダメージ置き場に置く)ごとに、?1ずつ減少する", s)   # A3-07 1074 / A3-20 2733 / A3-21 2986 / A3-25 3804 (Revise#172)
    if m: return [{"a": "_discount", "v": dict({"to": "damage" if "ダメージ" in m.group(2) else "discard"}, **({"faction": FACTION_JP[m.group(1)]} if m.group(1) else {}))}]
    m = re.fullmatch(r"このエフェクトの使用宣言時に、?あなたの任意のあなたの手札(\d+)枚を捨て札する", s)   # A3-08 1232 (Revise#166): at the declaration
    if m: return [{"a": "_declDiscard", "n": int(m.group(1))}]
    m = re.fullmatch(r"このカードの使用宣言時に、?あなたの手札を(\d+)枚捨て札する", s)   # A3-EX04 EX0465 (Revise#310)
    if m: return [{"a": "_declDiscard", "n": int(m.group(1))}]
    m = re.fullmatch(r"このカードの使用宣言時に、?あなたのデッキ(?:の上から)?(?:カード)?を?(\d+)枚捨て札する", s)   # A4-EP EP512 (Revise#310)
    if m: return [{"a": "_declMill", "n": int(m.group(1))}]
    m = re.fullmatch(r"このエフェクトの使用宣言時に、?あなたのデッキの上からカード(\d+)枚を捨て札する", s)   # A4-PP PP210 / PP218 (Revise#310): at the declaration
    if m: return [{"a": "_declMill", "n": int(m.group(1))}]
    # lasting watchers (Revise#166)
    m = re.fullmatch(r"目標がバトルした場合、?バトル終了時に«(\d)»を捨て札する", s)   # A3-21 2950
    if m and R(m.group(1)) == "card": return [{"a": "watchEv", "to": "t", "event": "battleEnd", "when": {"self": True}, "effect": {"steps": [{"a": "thisCardDiscard"}], "status": "auto"}, "once": True, "until": "main"}]
    m = re.fullmatch(u + r"対象が支配キャラクターとのバトルによってバトル相手を捨て札した場合、?あなたのデッキからカードを1枚引き、?パワーカードとして、?バトル相手を捨て札したキャラクターにセットする", s)   # A3-25 3767
    if m: return [{"a": "watchEv", "event": "killed", "when": {"bySel": {"_prevAll": True}, "controlled": True}, "evBy": True, "effect": {"steps": [{"a": "powerFromDeck", "to": "evCh", "n": 1}], "status": "auto"}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"(?:目標の)?«(\d)»があなたの対戦相手にアタックした場合、?あなたのダメージ置き場にあるブレイク条件のないブレイクカード1枚を、あなたの支配キャラクターとしてセット可能", s)   # A3-22 3202 (Revise#193)
    if m: return [{"a": "watchEv", "to": R(m.group(2)), "event": "attack", "when": {"self": True, "toPlayer": True}, "effect": {"steps": [{"a": "pickZone", "zones": ["damage"], "owner": "you", "dest": "back", "n": 1, "upTo": True, "sel": {"types": ["Break"], "noBreakRule": True}}], "status": "auto"}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"対象がプレイヤーにアタックした場合、?このカードを捨て札する", s)   # A3-25 3767
    if m: return [{"a": "watchEv", "event": "attack", "when": {"toPlayer": True}, "chSel": {"_prevAll": True}, "effect": {"steps": [{"a": "thisCardDiscard"}], "status": "auto"}, "once": True, "until": UNT[m.group(1)]}]
    if re.fullmatch(r"目標がプレイヤーにアタックした場合、?通常のダメージ判定の後、?目標を捨て札する", s):   # A3-23 3330
        return [{"a": "watchEv", "to": "t", "event": "hitPlayer", "when": {"by": "self"}, "useBound": True, "effect": {"steps": [{"a": "discard", "to": "evCh"}], "status": "auto"}, "once": True, "until": "main"}]
    if re.fullmatch(r"あなたがアタックを受けた場合、?通常のダメージ判定の後に?、?目標を捨て札する", s):
        return [{"a": "watchEv", "to": "t", "event": "hitPlayer", "when": {"to": "you"}, "useBound": True, "effect": {"steps": [{"a": "discard", "to": "evCh"}], "status": "auto"}, "once": True, "until": "main"}]
    if re.fullmatch(r"目標がダメージを与えた場合、?このカードを捨て札する", s): return [{"a": "watchEv", "to": "t", "event": "damaged", "when": {"byThisAny": True}, "effect": {"steps": [{"a": "thisCardDiscard"}], "status": "auto"}, "once": True, "until": "main"}]   # EX0112 / EX0306 (Revise#216)
    m = re.fullmatch(u + r"目標(?:の«(?:\d|t)»)?がアタックした場合、?目標にセットされているパワーカード全てを捨て札する", s)   # EX0325 / EX0474 (Revise#216)
    if m: return [{"a": "watchEv", "to": "t", "event": "attack", "when": {"self": True}, "useBound": True, "effect": {"steps": [{"a": "powerDiscard", "to": "evCh"}], "status": "auto"}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"アタックした目標からコストを支払うことはできない", s)   # EX0325 / EX0474 (Revise#216): once it has attacked
    if m: return [{"a": "watchEv", "to": "t", "event": "attack", "when": {"self": True}, "useBound": True, "once": True, "effect": {"steps": [{"a": "mod", "to": "evCh", "mod": {"key": "noPay", "op": "grant", "value": True}, "until": UNT[m.group(1)]}], "status": "auto"}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(r"目標がダメージを与えた場合、?«(\d)»を捨て札する", s)   # A3-21 3057
    if m and R(m.group(1)) == "card": return [{"a": "watchEv", "to": "t", "event": "damaged", "when": {"byThisAny": True}, "effect": {"steps": [{"a": "thisCardDiscard"}], "status": "auto"}, "once": True, "until": "main"}]
    m = re.fullmatch(u + r"([^、«]+?)がダメージを与えた場合、?«(\d)»は捨て札される", s)   # A3-21 3089
    if m and raw_text_of(ref_of, m.group(3)) == "そのキャラクター" and class_tokens(m.group(2).replace("または", "・")):
        return [{"a": "watchEv", "event": "damaged", "when": {}, "fromSel": {"icons": class_tokens(m.group(2).replace("または", "・"))}, "effect": {"steps": [{"a": "discard", "to": "evCh"}], "status": "auto"}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"([^、«]+?)の、?ネームを持つブレイクカードがセットされた場合、?«(\d)»は、?(.+)", s)   # A3-21 2981 / 3053
    if m and raw_text_of(ref_of, m.group(3)) == "そのカードのオーナー" and class_tokens(m.group(2).replace("または", "・")):
        rest, eff = m.group(4), None
        if re.fullmatch(r"任意のキャラクター1人に\(1\)ダメージを与える", rest): eff = [{"a": "pickCharDamage", "sel": {}, "n": 1, "mental": True}]
        mm = re.fullmatch(r"(\d+)ドローし、?手札(\d+)枚をデッキの上に戻す", rest)
        if mm: eff = [{"a": "draw", "to": "you", "n": int(mm.group(1))}, {"a": "handToDeckTop", "n": int(mm.group(2))}]
        if eff: return [{"a": "watchEv", "event": "broken", "when": {}, "cardSel": {"icons": class_tokens(m.group(2).replace("または", "・")), "named": True}, "asOwner": True, "effect": {"steps": eff, "status": "auto"}, "until": UNT[m.group(1)]}, {"a": "watchEv", "event": "enter", "when": {}, "cardSel": {"icons": class_tokens(m.group(2).replace("または", "・")), "named": True}, "asOwner": True, "effect": {"steps": eff, "status": "auto"}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"«(\d)»を捨て札する", s)   # A3-21 2982: "…≪あなた以外のプレイヤーの、コストを支払った支配キャラクター全て≫を捨て札する"
    if m and raw_text_of(ref_of, m.group(2)) in ("あなた以外のプレイヤーの、コストを支払った支配キャラクター全て", "あなたの対戦相手の、コストを支払った支配キャラクター全て"):
        return [{"a": "watchEv", "event": "costPaid", "when": {}, "chSel": {"owner": "opp", "area": "controlled"}, "effect": {"steps": [{"a": "discard", "to": "evCh"}], "status": "auto"}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"«(\d)»は全ての勢力のファクターを(X|\d+)得る", s)   # A3-20 2766
    if m and R(m.group(2)) == "you": return [{"a": "mod", "to": "you", "mod": {"key": "factorAll", "op": "add", "value": {"xvar": True, "sign": 1} if m.group(3) == "X" else int(m.group(3))}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(r"目標の«(t|\d)»に、?あなたのデッキの上からカードを1枚引き、?パワーカードとしてセットする", s)   # A3-25 3623 (Revise#166)
    if m: return [{"a": "deckTopPowerT"}]
    if re.fullmatch(r"このカードの使用宣言時に、?(?:あなたは)?(?:あなたの)?任意の分類1つを指定する", s): return [{"a": "pickIcon"}]   # A4-03 0576 (Revise#287): chosen when it resolves
    m = re.fullmatch(u + r"目標(?:の«(?:\d|t)»)?がアタックした場合、?あなたは(\d+)ドローする", s)   # A4-05 0845 (Revise#292)
    if m: return [{"a": "watchEv", "to": "t", "event": "attack", "when": {"self": True}, "useBound": True, "effect": {"steps": [{"a": "draw", "to": "you", "n": int(m.group(2))}], "status": "auto"}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"目標の«(t|\d)»に与えられるダメージの数値に[-ー−](\d+)する", s)   # A4-EX02 EX870 (Revise#294): a player
    if m and R(m.group(2)) == "t" and raw_text_of(ref_of, m.group(2)) and "プレイヤ" in (raw_text_of(ref_of, m.group(2)) or ""): return [{"a": "mod", "to": "t", "mod": {"key": "playerDmgCut", "op": "add", "value": int(m.group(3))}, "until": UNT[m.group(1)]}]
    if re.fullmatch(r"ターン終了時に、?目標を捨て札する", s): return [{"a": "delayed", "at": "turn", "step": {"a": "discard", "to": "t"}}]   # A4-02 0315 (Revise#282)
    if re.fullmatch(r"メインフェイズ終了時に、?このカードを目標にパワーカードとしてセットする", s): return [{"a": "delayed", "at": "main", "step": {"a": "thisCardPowerT", "to": "t"}}]   # A3-25 3624 / 3628
    m = re.fullmatch(u + r"目標の«(t|\d)»は攻撃力全てを失う", s)   # A3-25 3660
    if m: return [{"a": "mod", "to": "t", "mod": {"key": "at", "op": "set", "value": 0}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"«(\d)»は、?カード名称に「([^」]+)」を含むブレイクカードの必要ファクターを無視してセット宣言可能", s)   # A3-21 2909 (Revise#166)
    if m and R(m.group(2)) in ("players", "you"): return [{"a": "field", "mod": {"to": {"players": "all" if R(m.group(2)) == "players" else "you"}, "key": "factorIgnore", "op": "grant", "value": {"type": "Break", "jpHas": m.group(3)}, "until": UNT[m.group(1)]}}]
    m = re.fullmatch(r"(?:目標の)?«(\d|t)»のデッキの上から、?カードを(\d+)枚捨て札する", s)   # A3-22 3203 / A3-21 3058
    if m and R(m.group(1)) in ("players", "opp", "you", "t"): return [{"a": "mill", "to": R(m.group(1)), "n": int(m.group(2))}]
    m = re.fullmatch(r"(?:目標の)?«(\d|t)»は、?(?:自分の)?デッキの上から、?カード(?:を)?(\d+|X)枚(?:を)?捨て札する", s)   # A4-EX01 EX0764 (Revise#310)
    if m and R(m.group(1)) in ("players", "opp", "you", "t"): return [{"a": "mill", "to": R(m.group(1)), "n": "X" if m.group(2) == "X" else int(m.group(2))}]
    m = re.fullmatch(r"«(\d)»は、?(?:自分の)?ダメージ置き場のカード全てを捨て札する", s)   # A4-03 0445 (Revise#310)
    if m and R(m.group(1)) in ("players", "you"): return [{"a": "pickZone", "to": "you", "dest": "discard", "zone": "damage", "owner": "any" if R(m.group(1)) == "players" else "you", "sel": {}, "n": "all", "upTo": False}]
    m = re.fullmatch(r"(?:その後、)?«(\d)»を(?:あなたの)?ダメージ置き場に置く", s)
    if m and (R(m.group(1)) == "card" or raw_text_of(ref_of, m.group(1)) == "このカード"): return [{"a": "selfCardToDamage"}]
    if re.fullmatch(r"目標の«(t|\d)»を指定する", s): return []   # Revise#164: a designated character
    m = re.fullmatch(r"目標の«(t|\d)»に、?あなたのデッキの一番上のカード1枚を引いて、?パワーカードとしてセットする", s)   # A3-20 2839
    if m: return [{"a": "deckTopPowerT"}]
    m = re.fullmatch(r"(?:このカードが効果を発揮した場合、)?あなたの任意の、?あなたのダメージ置き場のカード(\d+)枚を、?(目標|«t»)にパワーカードとしてセットする", s)   # A3-06 0921
    if m: return [{"a": "pickZone", "zone": "damage", "owner": "you", "n": int(m.group(1)), "dest": "powerT"}]
    m = re.fullmatch(r"(?:その後、)?あなたのデッキの上からX枚を?引き、捨て札する", s)   # A3-07 1026 / 1070
    if m: return [{"a": "mill", "to": "you", "n": "X"}]
    if re.fullmatch(r"このカードは、?使用宣言時から、?効果終了時まで、ファストカードの効果を受けない", s): return [{"a": "_selfShield", "fast": True}]   # A3-07 1029
    if re.fullmatch(r"このカードのコストを(?:あなたの)?ダメージ置き場に置く", s): return [{"a": "costTo", "to": "damage"}]   # A3-07 1104
    if re.fullmatch(r"このカードのコストは、?宣言時に(?:あなたの)?ダメージ置き場に置かれる", s): return [{"a": "costTo", "to": "damage"}]   # A3-09 1355
    if re.fullmatch(r"このエフェクトのコストは、?使用宣言時に(?:オーナーの|あなたの)?ダメージ置き場に置く", s): return [{"a": "costTo", "to": "damage"}]   # A3-12 1805
    m = re.fullmatch(r"«(\d)»を、?そのオーナーの(手札に戻す|捨て札する|ダメージ置き場に置く)", s)
    if m and raw_text_of(ref_of, m.group(1)) == "あなたの任意のキャラクター1人と、そのキャラクターにセットされているカード全て": return [{"a": "pickCharAll", "dest": "hand" if "手札" in m.group(2) else "discard"}]   # A3-11 1632
    m = re.fullmatch(u + r"«(\d)»は、?パワーカードフェイズに手札からパワーカードをセットすることはできない", s)   # A3-17 2375 / 2378 (Revise#165)
    if m and R(m.group(2)) == "players": return [{"a": "field", "mod": {"to": {"players": "all"}, "key": "noHandCharge", "op": "grant", "value": True, "until": UNT[m.group(1)]}}]
    m = re.fullmatch(u + r"目標の«(t|\d)»は本来の攻撃力を失い、\(X\)を得る", s)   # A3-20 2769: mental Attack X
    if m: return [{"a": "mod", "to": "t", "mod": {"key": "at", "op": "set", "value": {"xvar": True, "sign": 1}}, "until": UNT[m.group(1)]}, {"a": "mod", "to": "t", "mod": {"key": "atMental", "op": "set", "value": True}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"目標は(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のファストカードと、\2のキャラクターのエフェクトの効果を受けない", s)   # A3-18 2422 … (Revise#165)
    if m: return [{"a": "mod", "to": "t", "mod": {"key": "untargetable", "op": "grant", "value": {"from": ["Fast"], "faction": FACTION_JP[m.group(2)]}}, "until": UNT[m.group(1)]}, {"a": "mod", "to": "t", "mod": {"key": "untargetable", "op": "grant", "value": {"from": ["Effect"], "bySel": {"faction": FACTION_JP[m.group(2)]}}}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"目標の«(t|\d)»のバトル相手のキャラクターを、?バトル開始時に捨て札する", s)   # A3-20 2801
    if m: return [{"a": "mod", "to": "t", "mod": {"key": "battleHook", "op": "grant", "value": {"steps": [{"a": "discard", "to": "battleOpp"}]}}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(r"«(\d)»を、?そのオーナーの手札に戻す", s)
    mm = m and re.fullmatch(r"あなたの任意の、?キャラクター1人にセットされているパワーカード(\d+)枚まで", raw_text_of(ref_of, m.group(1)) or "")
    if mm: return [{"a": "pickCharPowerUpTo", "n": int(mm.group(1)), "dest": "hand"}]   # A3-17 2330
    m = re.fullmatch(r"目標の«(t|\d)»を、?あなたの手札に戻す", s)   # A3-14 1999 (a card in a pile)
    if m and m.group(1) != "t" and isinstance(R(m.group(1)), dict) and isinstance(R(m.group(1)).get("pile"), dict) and "zone" in R(m.group(1))["pile"]: return (lambda pl, dest: [dict({"a": "pickZone", "to": "you", "dest": dest, "zones": [pl["zone"]]}, **{k: v for k, v in pl.items() if k != "zone"})])(R(m.group(1))["pile"], "hand")   # a card chosen from a pile when it resolves (Revise#348: the step had no target)
    if m: return [{"a": "pickToHandT", "to": "t"}]
    if re.fullmatch(r"(?:その後、)?あなたの手札全てを捨て札する", s): return [{"a": "handAll", "to": "you"}]   # A3-07 1170 (Revise#165)
    m = re.fullmatch(r"«(\d)»は、?自分のダメージ置き場と捨て札置き場から(X|\d+)枚ずつ、?(.+?)を持つカードを、?自分の手札に加える", s)   # A3-21 2909 / 3089 (Revise#166)
    if m and R(m.group(1)) == "players" and class_tokens(m.group(3).replace("または", "・")):
        return [{"a": "eachPilePick", "zones": ["damage", "discard"], "perZone": True, "n": "X" if m.group(2) == "X" else int(m.group(2)), "sel": {"icons": class_tokens(m.group(3).replace("または", "・"))}}]
    m = re.fullmatch(r"«(\d)»は、?自分のダメージ置き場にある(.+?)を持つカードを(\d+)枚まで選んで、?自分の手札に加える", s)   # A3-21 3017
    if m and R(m.group(1)) == "players" and class_tokens(m.group(2).replace("または", "・")):
        return [{"a": "eachPilePick", "zones": ["damage"], "n": int(m.group(3)), "upTo": True, "sel": {"icons": class_tokens(m.group(2).replace("または", "・"))}}]
    m = re.fullmatch(r"«(\d)»から、?(?:あなたの任意の)?(.+?)を(\d+)枚選び、?対戦相手に見せる", s)   # sentence-level deck search (A3-21 2945 …)
    if m and R(m.group(1)) in ("yourDeck",) and deck_pick_sel(m.group(2)) is not None: return [{"a": "pickZone", "zone": "deck", "owner": "you", "n": int(m.group(3)), "sel": deck_pick_sel(m.group(2)), "dest": "hand"}]
    if re.fullmatch(r"その後、?そのカードを(?:あなたの)?手札に加える", s): return []
    m = re.fullmatch(r"«(\d)»から、?(?:あなたの任意の)?(.+?)を?(\d+)枚を?選び、?(?:あなたの)?手札に加える", s)   # EXPR028 / EXPV045 (Revise#192)
    if m and R(m.group(1)) == "yourDeck" and deck_pick_sel(m.group(2)) is not None: return [{"a": "pickZone", "zone": "deck", "owner": "you", "n": int(m.group(3)), "sel": deck_pick_sel(m.group(2)), "dest": "hand"}]
    if re.fullmatch(r"その後、?(?:あなたの|その)?デッキをシャッフルする", s): return [{"a": "shuffle", "to": "you"}]   # "その後、そのデッキをシャッフルする" (Revise#260)
    m = re.fullmatch(r"«(\d)»から(.+?)(\d+)枚を選び、捨て札する", s)   # A4-03 0534 … (Revise#260)
    if m and R(m.group(1)) == "yourDeck" and deck_pick_sel(m.group(2)) is not None: return [{"a": "pickZone", "zone": "deck", "owner": "you", "n": int(m.group(3)), "sel": deck_pick_sel(m.group(2)), "dest": "discard"}]
    if re.fullmatch(r"このエフェクトは各ターンに1度しか使用宣言できない", s): return [{"a": "_oncePerTurn"}]   # Revise#260
    m = re.fullmatch(r"«(\d)»をパワーカードとしてこのキャラクターにセットする", s)   # A4-03 0503 … (Revise#260)
    if m and raw_text_of(ref_of, m.group(1)) == "あなたの手札全て": return [{"a": "handAllPowerSelf"}]
    m = re.fullmatch(r"メインフェイズ終了時に、«(\d)»は(X|\d+)ドローする", s)   # A3-14 1974
    if m and R(m.group(1)) == "you": return [{"a": "delayed", "at": "main", "step": {"a": "draw", "to": "you", "n": "X" if m.group(2) == "X" else int(m.group(2))}}]
    m = re.fullmatch(r"目標の«(t|\d)»を、?そのオーナーの支配エリアにセットする", s)   # A3-23 3341 (Revise#171)
    if m and m.groups() and m.group(1) != "t" and isinstance(R(m.group(1)), dict) and isinstance(R(m.group(1)).get("pile"), dict) and "zone" in R(m.group(1))["pile"]: return (lambda pl, dest: [dict({"a": "pickZone", "to": "you", "dest": dest, "zones": [pl["zone"]]}, **{k: v for k, v in pl.items() if k != "zone"})])(R(m.group(1))["pile"], "back")   # Revise#348
    if m: return [{"a": "cardToBack", "to": "t"}]
    m = re.fullmatch(r"目標の«(t|\d)»を、?あなたの支配キャラクターとしてセットする", s)   # A3-25 3692
    if m and m.groups() and m.group(1) != "t" and isinstance(R(m.group(1)), dict) and isinstance(R(m.group(1)).get("pile"), dict) and "zone" in R(m.group(1))["pile"]: return (lambda pl, dest: [dict({"a": "pickZone", "to": "you", "dest": dest, "zones": [pl["zone"]]}, **{k: v for k, v in pl.items() if k != "zone"})])(R(m.group(1))["pile"], "back")   # Revise#348
    if m: return [{"a": "cardToBack", "to": "t"}]
    m = re.fullmatch(r"«(\d)»を、?あなたの支配キャラクターにセットする", s)
    mm = m and re.fullmatch(r"必要ファクタ.X以下のパーマネントカードX枚まで", raw_text_of(ref_of, m.group(1)) or "")
    if mm: return [{"a": "pickZone", "zone": "discard", "owner": "you", "n": "X", "upTo": True, "sel": {"types": ["Permanent"], "factorMax": "X"}, "dest": "perm"}]   # A3-11 1660
    m = re.fullmatch(r"目標の«(\d)»を捨て札する", s)
    if m and re.fullmatch(r".*?キャラクター1人にセットされているパワーカード全て", raw_text_of(ref_of, m.group(1)) or ""): return [{"a": "powerDiscard", "to": "t"}]   # A3-08 1256
    m = re.fullmatch(r"«(\d)»を捨て札する", s)
    if m and raw_text_of(ref_of, m.group(1)) == "あなたの任意のキャラクター1人と、そのキャラクターにセットされているカード全て": return [{"a": "pickCharAll", "dest": "discard"}]   # A3-16 2231
    if m and re.fullmatch(r"あなたの任意のプレイヤー1人のテリトリーの、?ブレイクしていないキャラクター全て", raw_text_of(ref_of, m.group(1)) or ""): return [{"a": "playerPickSweep", "sel": {"broken": False}}]   # A3-17 2344 / 2348
    m = re.fullmatch(r"«(\d)»をあなたのデッキに戻し、?そのデッキをシャッフルする", s)
    if m and re.fullmatch(r"あなたの任意のあなたの手札(X|\d+)枚", raw_text_of(ref_of, m.group(1)) or ""): return [{"a": "handPickTo", "n": "X" if "X" in raw_text_of(ref_of, m.group(1)) else int(re.search(r"\d+", raw_text_of(ref_of, m.group(1))).group(0)), "dest": "deckShuffle"}]   # A3-11 1657
    m = re.fullmatch(u + r"«(\d)»を捨て札する", s)   # "メインフェイズ終了時まで、≪パワー0のキャラクター≫を捨て札する": while it lasts (A3-11 1687 / 1715)
    if m and raw_text_of(ref_of, m.group(2)) == "パーマネントカード全て": return [{"a": "field", "mod": {"to": {"players": "all"}, "key": "sweepPerms", "op": "grant", "value": True, "until": UNT[m.group(1)]}}]
    mm = m and re.fullmatch(r"(.+?)キャラクター(?:全て)?", raw_text_of(ref_of, m.group(2)) or "")
    msel = mm and (parse_selector(mm.group(1)) or parse_selector(mm.group(1).rstrip("の")))
    if msel:
        return [{"a": "field", "mod": {"to": {"players": "all"}, "key": "sweepSel", "op": "grant", "value": {"sel": msel}, "until": UNT[m.group(1)]}}]
    m = re.fullmatch(r"ターン終了時に、?目標の«(t|\d)»に(X|\d+)ダメージを与える", s)   # A3-12 1820
    if m: return [{"a": "delayed", "at": "turn", "step": {"a": "damage", "to": "t", "n": "X" if m.group(2) == "X" else int(m.group(2))}}]
    m = re.fullmatch(u + r"(?:目標の)?«(t|\d)»(?:に、?|は、?)あなたの任意の分類(?:アイコン)?1つを(与える|失う)", s)   # A3-09 1320 / A3-22 3239 (Revise#168)
    if m and R(m.group(2)) is not None: return [{"a": "pickIcon"}, {"a": "iconT", "to": R(m.group(2)), "until": UNT[m.group(1)], **({"remove": True} if m.group(3) == "失う" else {})}]
    m = re.fullmatch(u + r"(?:目標の)?«(\d|t)»はあなたの任意の分類1つを得る", s)   # A3-14 1919 / A3-21 2911
    if m and R(m.group(2)) == "self": return [{"a": "pickIconGrant", "until": UNT[m.group(1)]}]
    if m and R(m.group(2)) == "t": return [{"a": "pickIconGrant", "to": "t", "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"目標が(?:プレイヤーに)?アタック宣言している場合、目標に([±+\-]\d+|[±+]X)/([±+\-]\d+|[±+]X)/([±+\-]\d+|[±+]X)して判定する", s)   # A3-19 2606 (Revise#165)
    if m:
        cnd = {"self": "attackingPlayer" if "プレイヤーに" in s else "attacking"}
        out = []
        for k, g in (("se", 2), ("at", 3), ("de", 4)):
            v = m.group(g)
            if v in ("±0", "+0"): continue
            out.append({"a": "mod", "to": "t", "mod": {"key": k, "op": "add", "value": {"xvar": True, "sign": 1} if "X" in v else sign_n(v)}, "cond": cnd, "until": UNT[m.group(1)]})
        return out
    m = re.fullmatch(r"(?:その後、)?«(\d)»見て、?そのカード全てを、?あなたの任意の順番であなたのデッキの上に置く", s)   # A3-16 2205
    if m and re.fullmatch(r"あなたのデッキのカードを上から(\d+)枚", raw_text_of(ref_of, m.group(1)) or ""): return [{"a": "reorderTop", "n": int(re.search(r"\d+", raw_text_of(ref_of, m.group(1))).group(0))}]
    if re.fullmatch(r"(?:その後、)?あなたの支配キャラクター1人を捨て札する", s): return [{"a": "discardOwnPick"}]   # A3-16 2201
    m = re.fullmatch(r"このカードが効果を発揮した場合、?目標のオーナーのデッキの一番上のカード1枚を引き、目標にパワーカードとしてセットする", s)   # A3-15 2074
    if m: return [{"a": "deckTopPowerT"}]
    m = re.fullmatch(u + r"目標がイニシアチブを(\d+)つ以上持つ場合、目標はガードされない", s)   # A3-20 2732
    if m: return [{"a": "mod", "to": "t", "mod": {"key": "unguardableInit", "op": "grant", "value": int(m.group(2))}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"分類に関わらず、?目標の«(t|\d)»をブレイク可能", s)   # A3-09 1450 (a chosen target only)
    if m: return [{"a": "mod", "to": R(m.group(2)), "mod": {"key": "breakableAny", "op": "grant", "value": {}}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + T + r"に\+X/\+X・\+\(X\)/±0する", s)   # A3-07 1168: +X Mental, +X normal or mental Attack
    if m: return [{"a": "mod", "to": R(m.group(2)), "mod": {"key": k, "op": "add", "value": {"xvar": True, "sign": 1}}, "until": UNT[m.group(1)]} for k in ("se", "at")]
    m = re.fullmatch(u + r"(?:目標の)?«(\d|t)»は、?((?:プロジェクトカード|ファストカード|エフェクト)(?:・(?:プロジェクトカード|ファストカード|エフェクト))*)(?:の使用宣言をすること|を使用宣言すること)ができない", s)   # A3-07 1172 / A3-14 1949
    if m and R(m.group(2)) is not None:
        kinds = m.group(3).split("・"); types = [{"プロジェクトカード": "Project", "ファストカード": "Fast"}[k] for k in kinds if k != "エフェクト"]
        return ([{"a": "mod", "to": R(m.group(2)), "mod": {"key": "ban", "op": "ban", "value": {"decl": "set", "types": types}}, "until": UNT[m.group(1)]}] if types else []) + ([{"a": "mod", "to": R(m.group(2)), "mod": {"key": "ban", "op": "ban", "value": {"decl": "effect"}}, "until": UNT[m.group(1)]}] if "エフェクト" in kinds else [])
    m = re.fullmatch(T + r"に(X|\d+)ダメージを与える", s)   # EXPR046 (Revise#161)
    if m and raw_text_of(ref_of, m.group(1)) == "あなたの任意のエリア1つにいるキャラクター全て": return [{"a": "areaDamage", "n": "X" if m.group(2) == "X" else int(m.group(2))}]
    am = m and re.fullmatch(r"あなたの任意のエリア1つ(?:の|にいる)、?(.*?)キャラクター全て", raw_text_of(ref_of, m.group(1)) or "")   # A4-05 0947 / EX0313 … (Revise#274)
    if am and parse_selector(am.group(1)) is not None: return [dict({"a": "areaDamage", "n": "X" if m.group(2) == "X" else int(m.group(2))}, **({"sel": parse_selector(am.group(1))} if parse_selector(am.group(1)) else {}))]
    m = re.fullmatch(T + r"の手札(X|\d+)枚を無作為に選んで捨て札する", s)   # PR335 (Revise#157)
    if m and R(m.group(1)) == "players": return [{"a": "randomHandDiscard", "to": "players", "n": "X" if m.group(2) == "X" else int(m.group(2))}]
    m = re.fullmatch(T + r"に(\()?(X|\d+)\)?ダメージを与える", s)
    if m and raw_text_of(ref_of, m.group(1)) == "アタック目標": return [{"a": "damage", "to": "battleTarget", "n": "X" if m.group(3) == "X" else int(m.group(3)), "mental": bool(m.group(2))}]
    m = re.fullmatch("(?:" + u + ")?(«(?:\\d|t)»の(?:精神力|攻撃力|耐久力)に[±+\\-ー−]\\(?\\d+\\)?)し、(«.+)", s)   # "…の精神力に-1し、≪…≫はチャージ1を得る"
    if m:
        a1, a2 = sentence_steps((m.group(1) + "、" if m.group(1) else "") + m.group(2) + "する", ref_of), sentence_steps((m.group(1) + "、" if m.group(1) else "") + m.group(3), ref_of)
        if a1 and a2: return a1 + a2
    # "<condition>場合、…": the steps run only if it holds when the effect resolves (Revise#166)
    m = re.match(r"([^、«]+?場合)、(.+)", s)
    if m and not s.startswith(("目標", "このカードが効果を発揮した場合")) and cond_of(m.group(1)):
        r2 = sentence_steps(m.group(2), ref_of)
        if r2 and all(not x["a"].startswith("_") for x in r2): return [dict(x, **{"if": cond_of(m.group(1))}) for x in r2]
    # "対象は…": the characters of the sentence before (fixed up by parse_body, Revise#166)
    m = re.fullmatch("(?:" + u + ")?対象(は|に|の|から)(.+)", s)
    if m:
        cm = clause_mods("«9»" + m.group(2) + m.group(3), lambda i: "_prevTo" if str(i) == "9" else R(i))
        if cm and all(ref == "_prevTo" for ref, _ in cm): return [{"a": "mod", "to": "_prevTo", "mod": mod, "until": UNT.get(m.group(1) or "", "turn") if m.group(1) else "removed"} for ref, mod in cm]
    # "until end of …: ≪T≫ gets / has / can't …"
    m = re.fullmatch("(?:" + u + ")?(.+)", s)
    if m and m.group(2).startswith(("«", "目標の")):
        cm = clause_mods(m.group(2), R)
        if cm and all(ref is not None for ref, _ in cm) and not (not m.group(1) and cm[0][1]["key"] in ("se", "at", "de")):
            return [dict({"a": "mod", "to": ref, "mod": mod, "until": UNT.get(m.group(1) or "", "turn") if m.group(1) else "removed"}, **({"resolveX": True} if '"n": "X"' in json.dumps(mod) else {})) for ref, mod in cm]
    m = re.fullmatch(r"メインフェイズ終了時に、?«(\d)»を、?(?:その)?オーナーの手札に戻す", s)
    if m and raw_text_of(ref_of, m.group(1)) == "このキャラクターを目標に効果を発揮しているプロジェクトカード全てとファストカード全て": return [{"a": "delayed", "at": "main", "step": {"a": "lastingToHand", "to": "card"}}]
    m = re.fullmatch(T + r"を(?:、)?捨て札(?:に)?する", s)
    if m and isinstance(R(m.group(1)), dict) and "areaPower" in R(m.group(1)): return [{"a": "areaPowerDiscard", "n": R(m.group(1))["areaPower"]}]
    if m and isinstance(R(m.group(1)), dict) and "factionPick" in R(m.group(1)): return [{"a": "factionDiscard", "n": R(m.group(1))["factionPick"], "own": R(m.group(1))["own"]}]
    if m and R(m.group(1)) is not None and not (isinstance(R(m.group(1)), dict) and set(R(m.group(1))) - {"all", "allCards", "powerOf"}): return [{"a": "discard", "to": R(m.group(1))}]   # other refs (piles, deck top …): the patterns below
    # Revise#087 (Pack's decks): power cards of the target, delayed checks, battle hooks, every player picks
    m = re.fullmatch(T + r"を(?:、)?捨て札(?:に)?する", s)
    if m and isinstance(R(m.group(1)), dict) and "factionPick" in R(m.group(1)): return [{"a": "factionDiscard", "n": R(m.group(1))["factionPick"], "own": R(m.group(1))["own"]}]
    m = re.fullmatch(u + T + r"の(?:持つ)?(スキルまたはエフェクト|スキル|エフェクト)1つを無効化する", s)
    if m: return [dict({"a": "negateOne", "to": R(m.group(2)), "until": UNT[m.group(1)]}, **({"only": "skill"} if m.group(3) == "スキル" else {"only": "effect"} if m.group(3) == "エフェクト" else {}))]
    m = re.fullmatch(r"(?:このカードが効果を発揮した場合、)?" + T + r"を、?(?:その)?オーナーの手札に戻す", s)
    if m and R(m.group(1)) == "t": return [{"a": "bounce", "to": "t", "remember": True}]
    m = re.fullmatch(u + r"«(\d)»は、?この効果で手札に戻ったカードと同じ名称のカードを使用宣言することができない", s)
    if m and R(m.group(2)) == "players": return [{"a": "ban", "to": "players", "decl": "set", "name": "remembered", "until": UNT[m.group(1)]}]
    m = re.fullmatch(T + r"の対象を、?あなたの任意の対象に変更する", s)
    if m: return [{"a": "retarget", "to": R(m.group(1)), "byChoice": True}]   # A3-15 2105 (Pack, Revise#248): "任意の対象" — the controller's choice
    if re.fullmatch(r"変更する対象は適正なものでなくてはならない", s): return []
    m = re.fullmatch(u + T + r"がバトルする際、«t»のバトル相手にセットされているパーマネントカード全てを捨て札する", s)
    if m: return [{"a": "mod", "to": R(m.group(2)), "mod": {"key": "battleHook", "op": "grant", "value": {"steps": [{"a": "permDiscard", "to": "battleOpp"}]}}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"«t»とバトルするキャラクターは、?そのバトルの際、?そのキャラクターのオーナーが使用したプロジェクトカード・ファストカード・エフェクトの効果を受けず、?そのキャラクターの持つスキル・エフェクト全ては無効化される", s)
    if m: return [{"a": "mod", "to": "t", "mod": {"key": "battleHook", "op": "grant", "value": {"steps": [{"a": "mod", "to": "battleOpp", "mod": {"key": "negate", "op": "grant", "value": {"effects": True, "skills": True}}, "until": "battle"},
                                                                                             {"a": "mod", "to": "battleOpp", "mod": {"key": "ignoreOwn", "op": "grant", "value": True}, "until": "battle"}]}}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(r"«(\d)»は、?(自分の手札|ダメージ置き場のカード)全てを(?:自分の|そのオーナーの)デッキに戻(?:して|し)、?そのデッキをシャッフルする", s)   # EX0331 / EXPR025 / 2405 / PR222 (Revise#201)
    if m and R(m.group(1)) == "players": return [{"a": "pileRecycle", "from": "hand" if "手札" in m.group(2) else "damage"}]
    if re.fullmatch(r"(?:その後、)?自分がこの(?:カードの)?効果でデッキに戻した枚数に等しい枚数ドローする", s): return [{"a": "_patchPrev", "on": "pileRecycle", "set": {"then": "draw"}}]
    if re.fullmatch(r"(?:その後、)?そのデッキの一番上から、?自分がこの(?:カードの)?効果でデッキに戻した枚数に等しい枚数引き、?そのオーナーのダメージ置き場に置く", s): return [{"a": "_patchPrev", "on": "pileRecycle", "set": {"then": "damage"}}]
    m = re.fullmatch(r"ターン終了時に、?«(\d)»を(?:あなたの|オーナーの)?ダメージ置き場に置く", s)   # EX0486 (Revise#201): when its effect ends at the end of the turn
    if m and R(m.group(1)) == "card": return [{"a": "cardEndTo", "dest": "damage"}]
    m = re.fullmatch(r"«(\d)»は、?フェイズ・ターンが終了しても効果を発揮し続ける", s)   # a lasting Project / Fast card (Revise#201)
    if m and R(m.group(1)) == "card": return [{"a": "_lasting"}]
    m = re.fullmatch(r"場に(.+?)、異なるネームを持つ(.+?)キャラクターが(\d+)体以上いる場合、«(\d)»は(.+?)を得る", s)   # EX0626 / EX0638 (Revise#201)
    if m and parse_selector(m.group(1) + m.group(2)) is not None:
        inner = sentence_steps("«%s»は%sを得る" % (m.group(4), m.group(5)), ref_of)
        if inner and all(x.get("a") == "mod" and isinstance(x.get("to"), dict) and "all" in x["to"] for x in inner):
            cond = {"xAtLeast": {"x": {"distinctNames": parse_selector(m.group(1) + m.group(2))}, "n": int(m.group(3))}}
            return [{"a": "field", "mod": dict(x["mod"], to=x["to"], until="removed", cond=cond)} for x in inner]
    m = re.fullmatch(r"(?:このカードが効果を発揮した場合、)?«(\d)»は、?(?:自分の|あなたの)?デッキから、?(.+?カード)を(\d+)枚選(?:び|んで)、?(?:あなたの)?手札に加える", s)   # EP154 / EXPR014 (Revise#201)
    if m and R(m.group(1)) == "you" and deck_pick_sel(m.group(2)): return [{"a": "pickZone", "zones": ["deck"], "owner": "you", "n": int(m.group(3)), "sel": deck_pick_sel(m.group(2)), "dest": "hand"}]
    m = re.fullmatch(r"(?:このカードが効果を発揮した場合、)?«(\d)»は、?(?:あなたの)?デッキから((?:“[^”]+”)(?:、“[^”]+”)+)を1枚ずつ選び、?(?:あなたの)?手札に加える", s)   # EXPP004 (Revise#201)
    if m and R(m.group(1)) == "you":
        nm = [re.sub(r"\s+", "", x) for x in re.findall(r"“([^”]+)”", m.group(2))]
        return [{"a": "pickZone", "zones": ["deck"], "owner": "you", "n": len(nm), "upTo": True, "sel": {"names": nm}, "distinct": "name", "dest": "hand"}]
    m = re.fullmatch(r"このカードの使用宣言時に、?ネームを1つ指定する", s)
    if m: return [{"a": "nameChoose"}]
    m = re.fullmatch(r"«(\d)»をあなたの手札に戻す", s)   # A3-22 3271 (Revise#177)
    if m and raw_text_of(ref_of, m.group(1)) == "あなたのダメージ置き場にある、指定したネームを持つか、カードテキストに指定したネームを含むカード全て": return [{"a": "pickZone", "zones": ["damage"], "owner": "you", "dest": "hand", "n": "all", "sel": {"name": "chosen", "orText": True}}]
    m = re.fullmatch(r"(?:このカードが効果を発揮した場合、)?«(\d)»は、?あなたのダメージ置き場または捨て札置き場から、?指定したネームを持つブレイクカードを(\d+)枚まで手札に戻す", s)
    if m and R(m.group(1)) == "you": return [{"a": "pickZone", "zones": ["damage", "discard"], "owner": "you", "sel": {"types": ["Break"], "name": "chosen"}, "n": int(m.group(2)), "upTo": True, "dest": "hand"}]
    m = re.fullmatch(u + r"«(\d)»は、?(?:その|オーナーの)?手札に戻る", s)
    if m and raw_text_of(ref_of, m.group(2)) == "指定したネームを持つブレイクカードのコスト": return [{"a": "field", "mod": {"to": "you", "key": "dest", "op": "dest", "value": {"cost": "set", "type": "Break", "name": "chosen", "to": "hand"}, "until": UNT[m.group(1)]}}]
    kw = m and re.fullmatch(r"(" + WORK_ALT + r")(?:の|に登場する)(ネームを持つ)?(ブレイク|パーマネント|プロジェクト|ファスト)?カードのコスト", raw_text_of(ref_of, m.group(2)) or "")   # EP154 (Revise#201); any card type: EP384 (Revise#209)
    if kw: return [{"a": "field", "mod": {"to": "you", "key": "dest", "op": "dest", "value": dict({"cost": "set", "works": WORKS_JP[kw.group(1)], "to": "hand"}, **({"types": [CARD_TYPES_JP[kw.group(3)]]} if kw.group(3) else {}), **({"named": True} if kw.group(2) else {})), "until": UNT[m.group(1)]}}]
    kn = m and re.fullmatch(r"((?:“[^”]+”)(?:(?:、|または|と)“[^”]+”)*)のネームを持つブレイクカードのコスト", raw_text_of(ref_of, m.group(2)) or "")   # EX0499 / EX0500 / EXPP004 (Revise#201)
    if kn: return [{"a": "field", "mod": {"to": "you", "key": "dest", "op": "dest", "value": {"cost": "set", "type": "Break", "names": [re.sub(r"\s+", "", x) for x in re.findall(r"“([^”]+)”", kn.group(1))], "to": "hand"}, "until": UNT[m.group(1)]}}]
    ki = m and re.fullmatch(r"(.+?)を持つブレイクカードのコスト", raw_text_of(ref_of, m.group(2)) or "")   # A3-21 2909 / 2945 / 2981 (Revise#166)
    if ki and class_tokens(ki.group(1).replace("または", "・")) and len(class_tokens(ki.group(1).replace("または", "・"))) == len(ki.group(1).split("または")):
        return [{"a": "field", "mod": {"to": {"players": "all"}, "key": "dest", "op": "dest", "value": {"cost": "set", "type": "Break", "icons": class_tokens(ki.group(1).replace("または", "・")), "to": "hand"}, "until": UNT[m.group(1)]}}]
    km2 = m and re.fullmatch(r"((?:プロジェクト|ファスト|パーマネント|ブレイク)カード(?:・(?:プロジェクト|ファスト|パーマネント|ブレイク)カード)+)のコスト", raw_text_of(ref_of, m.group(2)) or "")   # A3-07 1202 (Revise#164)
    if km2: return [{"a": "field", "mod": {"to": {"players": "all"}, "key": "dest", "op": "dest", "value": {"cost": "set", "types": [CARD_TYPES_JP[k.replace("カード", "")] for k in km2.group(1).split("・")], "to": "hand"}, "until": UNT[m.group(1)]}}]
    km = m and re.fullmatch(r"(プロジェクト|ファスト|パーマネント|ブレイク)カードのコスト", raw_text_of(ref_of, m.group(2)) or "")
    if km: return [{"a": "field", "mod": {"to": "you", "key": "dest", "op": "dest", "value": {"cost": "set", "type": CARD_TYPES_JP[km.group(1)], "to": "hand"}, "until": UNT[m.group(1)]}}]   # "メインフェイズ終了時まで、≪パーマネントカードのコスト≫はそのオーナーの手札に戻る"
    m = re.fullmatch(u + T + r"がキャラクターのアタックを受けた場合、通常のダメージ判定を行わず、«t»のデッキの一番上のカード(\d+)枚をダメージ置き場に置く、その後、«t»は(\d+)ドローする", s)
    if m: return [{"a": "mod", "to": R(m.group(2)), "mod": {"key": "attackReplace", "op": "grant", "value": {"mill": int(m.group(3)), "draw": int(m.group(4))}}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(r"«(\d)»は、?自分の捨て札置き場のカード(\d+)枚を手札に加える", s)
    if m and R(m.group(1)) == "players": return [{"a": "eachPick", "zones": ["discard"], "n": int(m.group(2)), "sel": {}, "must": True}]
    m = re.fullmatch(r"(ターン|メインフェイズ)終了時に、?«(\d)»を、?あなたのダメージ置き場に置くことが可能", s)
    if m and R(m.group(2)) == "card": return [{"a": "delayed", "at": {"ターン": "turn", "メインフェイズ": "main"}[m.group(1)], "step": {"a": "toDamage", "to": "card", "optional": True}}]
    m = re.fullmatch(T + r"(?:にセットされている|の)パワーカード全てを捨て札する", s)
    if m: return [{"a": "powerDiscard", "to": R(m.group(1))}]
    # Revise#109: the power cards / permanents of a character, picked by you
    m = re.fullmatch(T + r"にセットされているパワーカード(X|\d+)枚とパーマネントカード全てを、?(?:その)?オーナーの手札に戻す", s)
    if m: return [{"a": "cardsOf", "to": R(m.group(1)), "part": "power", "n": "X" if m.group(2) == "X" else int(m.group(2)), "dest": "hand"}, {"a": "cardsOf", "to": R(m.group(1)), "part": "perm", "all": True, "dest": "hand"}]
    m = re.fullmatch(T + r"の手札を見て、その中の任意のカードを(X|\d+)枚までデッキに戻して、デッキをシャッフルする、その後、目標のプレイヤーはデッキに戻したカード枚数に等しい枚数ドローする", s)
    if m: return [{"a": "handToDeckDraw", "to": R(m.group(1)), "n": "X" if m.group(2) == "X" else int(m.group(2))}]
    m = re.fullmatch(T + r"は、?自分の捨て札置き場のカード全てをシャッフルし、その中からランダムに選んだカード(X|\d+)枚を目標のデッキに戻し、デッキをシャッフルする", s)
    if m: return [{"a": "discardRandomToDeck", "to": R(m.group(1)), "n": "X" if m.group(2) == "X" else int(m.group(2))}]
    if re.fullmatch(r"このエフェクトはあなたのターン中にのみ使用宣言可能", s): return [{"a": "_myTurn"}]
    if re.fullmatch(r"このエフェクトは追加のフェイズまたは追加のターン中にのみ使用宣言可能", s): return [{"a": "_onlyExtra"}]   # EP313 (Revise#157)
    if re.fullmatch(r"このエフェクトは1ターンに1度しか使用宣言できない", s): return [{"a": "_oncePerTurn"}]
    # ---- M3a (Revise#159) ----
    if re.fullmatch(r"(?:その後、)?あなたのターンは終了する", s): return [{"a": "endMyTurn"}]
    if re.fullmatch(r"この時、メインフェイズ、パワーカードフェイズ、ディスカードフェイズは同時に終了したものとして扱う", s): return []
    if re.fullmatch(r"(?:その後、)?あなたのメインフェイズは終了する", s): return [{"a": "endMyMain"}]
    if re.fullmatch(r"(?:«\d»|このカード)は、?使用宣言時から、?(?:効果終了時|メインフェイズ終了時)まで、?ファストカード・エフェクトの効果を受けない", s): return [{"a": "_selfShield"}]   # "まで、" or "まで" (EX0301 / EX0602, Revise#208)
    m = re.fullmatch(r"([^、«]+?場合)、(?:«\d»|このカード)は、?使用宣言時から、?効果終了時まで、?(?:あなたの対戦相手の使用した)?ファストカード(・エフェクト)?の効果を受けない", s)   # EX0310 / EX0461 / EX0463 (Revise#203)
    if m and cond_of(m.group(1)) and (not re.search(r"«(\d)»", s) or R(re.search(r"«(\d)»", s).group(1)) == "card"): return [dict({"a": "_selfShield", "cond": cond_of(m.group(1))}, **({} if m.group(2) else {"fast": True}))]
    m = re.fullmatch(r"([^、«]+?場合)、«(\d)»は、?このカード(を|の)必要ファクター(とコスト)?を無視して使用宣言可能", s)   # EP393 / EXPP015 / EXPP020; 2421 (Revise#203)
    if m and cond_of(m.group(1)) and R(m.group(2)) == "you": return [{"a": "_factorFreeIf", "cond": cond_of(m.group(1)), "cost": bool(m.group(4))}]
    m = re.fullmatch(r"Xが目標のキャラクターの(精神力|攻撃力|耐久力)以上でなければ、このカードは効果を発揮しない", s)   # A3-02 0388 (Revise#228)
    if m: return [{"a": "_xGeT", "stat": {"精神力": "se", "攻撃力": "at", "耐久力": "de"}[m.group(1)]}]
    if re.fullmatch(r"(?:その後、)?このカードを(?:オーナーの|あなたの)?ダメージ置き場に置く", s): return [{"a": "selfCardToDamage"}]
    m = re.fullmatch(r"あなたの任意のあなたの手札(X|\d+)枚を捨て札する", s)   # A3-03 0564
    if m: return [{"a": "pickZone", "zones": ["hand"], "owner": "you", "dest": "discard", "n": "X" if m.group(1) == "X" else int(m.group(1))}]
    m = re.fullmatch(r"ターン終了時に、あなたは(X|\d+)ドローする", s)
    if m: return [{"a": "delayed", "at": "turn", "step": {"a": "draw", "to": "you", "n": "X" if m.group(1) == "X" else int(m.group(1))}}]
    if re.fullmatch(r"このカードは、メインフェイズ終了時にオーナーの手札に戻る", s): return [{"a": "delayed", "at": "main", "step": {"a": "selfCardToHandAny", "to": "card"}}]   # A3-05 0807
    if re.fullmatch(r"あなたの任意の、あなたの支配しているネームレベルキャラクター1人を捨て札する", s): return [{"a": "discardOwnPick", "sel": {"named": True}}]
    m = re.fullmatch(r"«(\d)»をそのオーナーのデッキに戻し、そのデッキをシャッフルする", s)
    if m and raw_text_of(ref_of, m.group(1)) == "パワーカード全て": return [{"a": "allPowerToDecks"}]
    m = re.fullmatch(r"メインフェイズ終了時まで、«(\d)»は、手札の使用宣言およびキャラクターカードのセット宣言をすることができない", s)
    if m and R(m.group(1)) == "players": return [{"a": "field", "mod": {"to": {"players": "all"}, "key": "noHandUse", "op": "grant", "value": True, "until": "main"}}]
    m = re.fullmatch(r"メインフェイズ終了時まで、" + T + r"は、あなたの任意の勢力1つのキャラクターにガードされない", s)
    if m: return [{"a": "noGuardByFactionPick", "to": R(m.group(1)), "until": "main"}]
    m = re.fullmatch(r"«(\d)»を捨て札する", s)
    pm = m and re.fullmatch(r"あなたの任意の(.*?)キャラクタ.(X|\d+)体にセットされているパワーカード全て", raw_text_of(ref_of, m.group(1)))
    if pm and parse_selector(pm.group(1)) is not None: return [{"a": "pickCharsPowerAll", "sel": parse_selector(pm.group(1)), "n": "X" if pm.group(2) == "X" else int(pm.group(2))}]
    m = re.fullmatch(r"«(\d)»に、あなたの任意のあなたの手札(X|\d+)枚までを、パワーカードとしてセットできる", s)
    if m and raw_text_of(ref_of, m.group(1)) == "あなたの任意のあなたのテリトリーのキャラクター": return [{"a": "handToOwnPowerUpTo", "n": "X" if m.group(2) == "X" else int(m.group(2))}]
    if re.fullmatch(r"(?:その後、)?このカードのコストをあなたのデッキに戻し、デッキをシャッフルする", s): return [{"a": "costTo", "to": "deckShuffle"}]
    m = re.fullmatch(T + r"と、目標にセットされているカード全てをオーナーのデッキに戻し、そのデッキをシャッフルする", s)
    if m: return [{"a": "charAllToDeck", "to": R(m.group(1))}]
    m = re.fullmatch(r"«(\d)»は、あなたの手札全てをデッキに戻し、デッキをシャッフルする", s)
    if m and R(m.group(1)) == "you": return [{"a": "handAllToDeck"}]
    if re.fullmatch(r"(?:その後、)?あなたはドローフェイズの手順を行う", s): return [{"a": "drawStep", "to": "you"}]
    if re.fullmatch(r"(?:その後、)?あなたのメインフェイズに戻る", s): return []
    if re.fullmatch(r"あなたは、任意の勢力1つを指定する", s): return []
    m = re.fullmatch(r"(?:その後、)?あなたは" + T + r"の手札全てを見て、その中の指定した勢力のカード全てを捨て札する", s)
    if m: return [{"a": "nameFactionHandWipe", "to": R(m.group(1))}]
    if re.fullmatch(r"(?:その後、)?目標は自分の捨て札置き場、ダメージ置き場から、目標の任意のカード1枚ずつを手札に戻す", s): return [{"a": "pilesOneEachToHand", "to": "t"}]
    m = re.fullmatch(T + r"をあなたの対戦相手のプレイヤー1人を目標にアタック宣言させる", s)
    if m: return [{"a": "makeAttack", "to": R(m.group(1))}]
    if re.fullmatch(r"アタック宣言の目標になったプレイヤーは、このアタック宣言に対して支配キャラクターでガード宣言可能", s): return []
    if re.fullmatch(r"このエフェクトはあなたのターンのメインフェイズ中にのみ使用宣言可能", s): return [{"a": "_myMain"}]
    if re.fullmatch(r"この効果は、?先攻以外のプレイヤーのみ選択可能", s): return [{"a": "_notFirst"}]   # a mode (Revise#164)
    m = re.fullmatch(r"この効果で使用宣言する場合、?«(\d)»の必要ファクターは(\d+)減少する", s)
    if m and R(m.group(1)) == "card": return [{"a": "_factorLess", "n": int(m.group(2))}]
    m = re.fullmatch(r"このエフェクトのコストを[“”\"]([^“”\"]+)[”\"]がセットされている[“”\"]([^“”\"]+)[”\"]以外から支払うことはできない", s)   # EX0440 (Revise#207)
    if m: return [{"a": "_hostName", "name": re.sub(r"\s+", "", m.group(2)), "perm": re.sub(r"\s+", "", m.group(1))}]
    m = re.fullmatch(r"このエフェクトのコストを((?:“[^”]+”)(?:、“[^”]+”)+)以外から支払うことはできない", s)   # EP336 (Revise#203)
    if m: return [{"a": "_hostNames", "names": [re.sub(r"\s+", "", x) for x in re.findall(r"“([^”]+)”", m.group(1))]}]
    m = re.fullmatch(u + r"«(\d)»は、?((?:プロジェクト|ファスト)カード(?:・(?:プロジェクト|ファスト)カード)?)(?:の使用宣言ができない|を使用宣言(?:することが)?できない)", s)   # EX0343 / EXPR026 (Revise#203)
    if m and R(m.group(2)) in ("players", "opp", "you"):
        return [{"a": "field", "mod": {"to": {"players": {"players": "all", "opp": "opponents", "you": "you"}[R(m.group(2))]}, "key": "ban", "op": "ban", "value": {"decl": "set", "types": [CARD_TYPES_JP[x] for x in re.findall(r"(プロジェクト|ファスト)カード", m.group(3))]}, "until": UNT[m.group(1)]}}]
    m = re.fullmatch(u + r"«(\d)»の((?:アタック宣言|ガード宣言|エフェクトの使用宣言)(?:・(?:アタック宣言|ガード宣言|エフェクトの使用宣言))*)(?:は無効化される|を無効化する)", s)   # EX0343 (Revise#203)
    if m and isinstance(R(m.group(2)), dict) and "all" in R(m.group(2)):
        keys = [{"アタック宣言": "noAttack", "ガード宣言": "noGuard", "エフェクトの使用宣言": "noEffect"}[x] for x in m.group(3).split("・")]
        return [{"a": "field", "mod": {"to": R(m.group(2)), "key": k, "op": "grant", "value": True, "until": UNT[m.group(1)]}} for k in keys]
    m = re.fullmatch(r"(ターン|メインフェイズ)終了時まで、(.+?)キャラクターが、?バトルの結果、対戦相手の支配キャラクターを捨て札した場合、«(\d)»に(\()?(\d+)\)?ダメージを与える", s)   # EP393 / EXPP015 / EXPP020 (Revise#203)
    if m and parse_selector(m.group(2)) and raw_text_of(ref_of, m.group(3)) == "捨て札されたキャラクターのオーナー":
        return [{"a": "watchEv", "event": "killed", "when": {"bySel": parse_selector(m.group(2)), "controlled": True}, "effect": {"steps": [{"a": "damage", "to": "evOwner", "n": int(m.group(5)), "mental": bool(m.group(4))}], "status": "auto"}, "until": UNT[m.group(1) + "終了時まで"] if (m.group(1) + "終了時まで") in UNT else ("turn" if m.group(1) == "ターン" else "main")}]
    m = re.fullmatch(r"«(\d)»と«(\d)»を入れ替える", s)   # EP336 / EP337 / EP338 / EXPR033 (Revise#203): a Permanent in hand takes this card's place
    wm = m and R(m.group(2)) == "card" and re.fullmatch(r"あなたの手札の(" + WORK_ALT + r")のパーマネントカード1枚", raw_text_of(ref_of, m.group(1)) or "")
    if wm: return [{"a": "permSwapHand", "works": WORKS_JP[wm.group(1)]}]
    m = re.fullmatch(r"このエフェクトのコストを[“”\"]([^“”\"]+)[”\"]以外から支払うことはできない", s)   # A3-08 1243 / 1256 / 1267 (Revise#164)
    if m: return [{"a": "_hostName", "name": re.sub(r"\s+", "", m.group(1))}]
    m = re.fullmatch(r"メインフェイズ終了時に(?:、)?このカードは捨て札される", s)   # A3-08 1267: the Permanent itself
    if m: return [{"a": "delayed", "at": "main", "step": {"a": "selfCardDiscard", "to": "card"}}]
    m = re.fullmatch(r"このエフェクトのコストは、?(?:あなたの|オーナーの)?ダメージ置き場に置かれる", s) or re.fullmatch(r"このエフェクトのコストを、?(?:あなたの|オーナーの)?ダメージ置き場に置く", s)
    if m: return [{"a": "costTo", "to": "damage"}]
    m = re.fullmatch(T + r"を、?(?:あなたの|オーナーの)ダメージ置き場に置く", s)   # "≪このエフェクトのコスト≫をあなたのダメージ置き場に置く" (Revise#141)
    if m and R(m.group(1)) == "cost": return [{"a": "costTo", "to": "damage"}]
    m = re.fullmatch(T + r"に(\d+|X)ダメージを与える", s)
    if m and raw_text_of(ref_of, m.group(1)) == "あなたの任意の勢力パーティ1つのキャラクター全て": return [{"a": "partyDamage", "n": "X" if m.group(2) == "X" else int(m.group(2))}]
    m = re.fullmatch(T + r"のデッキの上から(X|\d+)枚(?:のカード)?を捨て札する", s)
    if m and R(m.group(1)) in ("evPlayer", "tOwner", "battleOppOwner", "attackedPlayer", "you", "opp", "players"): return [{"a": "mill", "to": R(m.group(1)), "n": "X" if m.group(2) == "X" else int(m.group(2))}]
    m = re.fullmatch(u + r"(.+?)キャラクターが(アタック|ガード)宣言した場合、«(\d)»の(手札からあなたの任意の(?:カード)?|デッキの上から)(X|\d+)枚を(捨て札する|そのオーナーのダメージ置き場に置く)", s)
    if m and parse_selector(m.group(2)) is not None and R(m.group(4)) == "tOwner":
        n = "X" if m.group(6) == "X" else int(m.group(6)); dest = "discard" if m.group(7) == "捨て札する" else "damage"
        step = {"a": "handTake", "to": "evPlayer", "n": n, "dest": dest} if m.group(5).startswith("手札") else {"a": "mill", "to": "evPlayer", "n": n, "zone": dest}
        return [{"a": "field", "storeX": True, "mod": {"to": "you", "key": "watch", "op": "grant", "until": UNT[m.group(1)], "value": {"on": "attack" if m.group(3) == "アタック" else "guard", "sel": parse_selector(m.group(2)), "effect": {"steps": [step], "status": "auto"}}}}]
    m = re.fullmatch(T + r"の手札から、?あなたの任意のカード(X|\d+)枚(まで)?を、?(捨て札する|そのプレイヤーのダメージ置き場に置く|そのオーナーのダメージ置き場に置く)", s)
    if m and R(m.group(1)) in ("battleOppOwner", "evPlayer", "tOwner", "attackedPlayer", "t", "opp", "players"): return [{"a": "handTake", "to": R(m.group(1)), "n": "X" if m.group(2) == "X" else int(m.group(2)), "upTo": bool(m.group(3)), "dest": "discard" if m.group(4) == "捨て札する" else "damage"}]
    m = re.fullmatch(T + r"にセットされているパワーカード全てを、?(?:その)?オーナーの手札に戻す", s)
    if m: return [{"a": "cardsOf", "to": R(m.group(1)), "part": "power", "all": True, "dest": "hand"}]
    m = re.fullmatch(u + r"«(\d)»は、?" + T + r"のスキル・エフェクト全てを得る", s)
    if m and R(m.group(2)) == "self" and R(m.group(3)) == "t": return [{"a": "gainChar", "to": "t", "until": UNT[m.group(1)]}]
    m = re.fullmatch(r"あなたは、?" + T + r"の手札(全て|からあなたの任意の(X|\d+)枚)を見て、その中からあなたの任意のカード(?:を)?(X|\d+)枚(まで)?(?:を)?捨て札する", s)
    if m: return [{"a": "handTake", "to": R(m.group(1)), "see": "all" if m.group(2) == "全て" else ("X" if m.group(3) == "X" else int(m.group(3))), "n": "X" if m.group(4) == "X" else int(m.group(4)), "upTo": bool(m.group(5)), "dest": "discard"}]
    m = re.fullmatch(r"そのプレイヤーは、?(X|\d+)ドローする", s)
    if m: return [{"a": "draw", "to": "_that", "n": "X" if m.group(1) == "X" else int(m.group(1))}]
    m = re.fullmatch(r"このキャラクターは、?" + T + r"に、?このキャラクターの(精神力|攻撃力|耐久力)に等しいダメージを与える", s)
    if m: return [{"a": "damage", "to": R(m.group(1)), "n": "X", "_x": {"selfStat": STAT_JP[m.group(2)]}}]
    m = re.fullmatch(T + r"を、?あなたのデッキの(?:1|一)番上に置く", s)
    if m and isinstance(R(m.group(1)), dict) and "pile" in R(m.group(1)): return [dict({"a": "pickZone", "to": "you", "dest": "deckTop"}, **R(m.group(1))["pile"])]
    m = re.fullmatch(r"(?:バトルの際、)?" + T + r"の(精神力|攻撃力|耐久力)に([±+\-ー−]\(?[\dX]+\)?)して判定する", s)
    if m and sign_n(m.group(3)) is not None:
        v = sign_n(m.group(3))
        return [{"a": "mod", "to": R(m.group(1)), "until": "battle", "mod": {"key": STAT_JP[m.group(2)], "op": "add", "value": {"xvar": True, "sign": v[1]} if isinstance(v, tuple) else v}}]
    m = re.fullmatch(u + r"バトルの際、" + T + r"に([±+\-ー−]\(?\d+\)?)/([±+\-ー−]\(?\d+\)?)/([±+\-ー−]\(?\d+\)?)して判定する", s)
    if m: return [{"a": "mod", "to": R(m.group(2)), "until": UNT[m.group(1)], "cond": {"self": "inBattle"}, "mod": {"key": k, "op": "add", "value": sign_n(m.group(g))}} for k, g in (("se", 3), ("at", 4), ("de", 5)) if sign_n(m.group(g))]
    m = re.fullmatch(T + r"は、?(?:あなたの|その|オーナーの)?手札に戻る", s)
    if m and isinstance(R(m.group(1)), dict) and "pile" in R(m.group(1)): return [dict({"a": "pickZone", "to": "you", "dest": "hand"}, **R(m.group(1))["pile"])]
    m = re.fullmatch(r"(?:その後、)?あなたのデッキ(?:の上)?から(\d+|X)枚引き、任意の順番でデッキの上に戻す", s)
    if m: return [{"a": "reorderTop", "n": "X" if m.group(1) == "X" else int(m.group(1))}]
    m = re.fullmatch(r"«(\d)»は、?あなたのデッキの上から(X|\d+)枚を見て、あなたの任意の順番でデッキの上に戻す", s)   # Revise#136
    if m and R(m.group(1)) == "you": return [{"a": "reorderTop", "n": "X" if m.group(2) == "X" else int(m.group(2))}]
    m = re.fullmatch(T + r"は、?ただちにドローフェイズの手順を行う", s)
    if m: return [{"a": "drawStep", "to": R(m.group(1))}]
    m = re.fullmatch(r"(?:その後、)?あなたの任意のあなたの手札(X|\d+)枚を、?あなたの任意の順番であなたのデッキの一番上に(?:戻す|置く)", s)
    if m: return [{"a": "handToDeckTop", "n": "X" if m.group(1) == "X" else int(m.group(1))}]
    m = re.fullmatch(r"(?:その後、)?あなたの任意のあなたの手札(\d+)枚を、?あなたのダメージ置き場に置く", s)
    if m: return [{"a": "handToDamage", "n": int(m.group(1))}]
    m = re.fullmatch(r"このエフェクトが効果を発揮した時、このエフェクトのコストをあなたの手札に戻す", s)
    if m: return [{"a": "costTo", "to": "hand"}]
    m = re.fullmatch(T + r"を、?そのカードのオーナーのテリトリーの、?あなたの任意のキャラクター1人にパワーカードとしてセットする", s)
    if m and R(m.group(1)) == "t": return [{"a": "cardToOwnerPower", "to": "t"}]
    m = re.fullmatch(r"あなたのデッキの(?:一|1)番上のカード(\d+|X)枚を、?" + T + r"にパワーカードとしてセットする", s)
    if m: return [{"a": "powerFromDeck", "to": R(m.group(2)), "n": "X" if m.group(1) == "X" else int(m.group(1))}]
    m = re.fullmatch(r"ターン終了時にこのカードをオーナーの手札に戻す", s)
    if m: return [{"a": "delayed", "at": "turn", "step": {"a": "bounce", "to": "card"}}]
    if re.fullmatch(r"あなたの任意のあなたのテリトリーのキャラクターX体を捨て札する", s): return [{"a": "discardAnyX"}]
    if s == "あなたの任意のあなたの支配キャラクター1人を捨て札する": return [{"a": "sacrificeOwn", "x": "normalAt"}, {"a": "xFromLast"}]   # A3-09 1451 (Revise#166)
    if s == "Xは捨て札したキャラクターの通常攻撃力の数値に等しい": return []
    m = re.fullmatch(r"あなたの任意の、?(.*?)あなたの支配キャラクターX体を捨て札する", s)   # A3-09 1389 (Revise#166)
    if m and parse_selector(m.group(1)) is not None: return [{"a": "discardAnyX", "controlled": True, "sel": parse_selector(m.group(1))}, {"a": "xFromLast"}]
    m = re.fullmatch(r"«(\d)»をあなたのダメージ置き場に置く", s)   # A3-09 1387
    if m and raw_text_of(ref_of, m.group(1)) == "あなたの任意のあなたの手札X枚": return [{"a": "handToDamageAnyX"}, {"a": "xFromLast"}]
    m = re.fullmatch(r"(?:その後、)?«(\d)»を手札に戻す", s)
    if m and raw_text_of(ref_of, m.group(1)) == "あなたのダメージ置き場のカードX枚": return [{"a": "pickZone", "zones": ["damage"], "owner": "you", "dest": "hand", "n": "X"}]
    m = re.fullmatch(r"その後、" + T + r"にXダメージを与える", s) or re.fullmatch(T + r"にXダメージを与える", s)
    if m and False: pass
    m = re.fullmatch(T + r"の、?デッキの1番上のカード1枚を、?目標のプレイヤーの任意の、?目標のプレイヤーのテリトリーのキャラクター1人にパワーカードとしてセットさせる", s)
    if m: return [{"a": "deckTopToOwnChar", "to": R(m.group(1))}]
    m = re.fullmatch(u + T + r"からコストが支払われた場合、«t»に([±+\-ー−]\(?[\dX]+\)?)/([±+\-ー−]\(?[\dX]+\)?)/([±+\-ー−]\(?[\dX]+\)?)する", s)
    if m:
        vs = {k: sign_n(m.group(g)) for k, g in (("se", 3), ("at", 4), ("de", 5))}
        if all(v is not None for v in vs.values()):
            return [{"a": "mod", "to": R(m.group(2)), "until": UNT[m.group(1)], "mod": {"key": "payHook", "op": "grant", "value": {"stats": {k: ("X%+d" % v[1]) if isinstance(v, tuple) else v for k, v in vs.items() if v}}}, "resolveStats": True}]
    m = re.fullmatch(T + r"を、?あなたの支配キャラクターとしてセットする", s)
    if m and R(m.group(1)) == "t": return [{"a": "cardToBack", "to": "t"}]
    m = re.fullmatch(r"あなたのデッキの上から(X|\d+)枚(?:のカード)?を捨て札する", s)
    if m: return [{"a": "mill", "to": "you", "n": "X" if m.group(1) == "X" else int(m.group(1))}]
    m = re.fullmatch(T + r"に(X|\d+)ダメージを与える", s)
    pm = m and re.fullmatch(r"あなたの任意の(.*?)キャラクター(X|\d+)体とあなた", raw_text_of(ref_of, m.group(1)))
    if pm and parse_selector(pm.group(1)) is not None:
        n = lambda g: "X" if g == "X" else int(g)
        return [{"a": "pickDamage", "sel": dict(parse_selector(pm.group(1)), owner="you"), "count": n(pm.group(2)), "n": n(m.group(2))}, {"a": "damage", "to": "you", "n": n(m.group(2))}]
    m = re.fullmatch(u + T + r"の持つ、?スキル・エフェクト・アビリティ全てを得る", s)
    if m and R(m.group(2)) == "t": return [{"a": "gainCard", "to": "t", "until": UNT[m.group(1)]}]
    if re.fullmatch(r"このエフェクトの効果で、?同じ名称のカードの持つスキル・エフェクト・アビリティを重複して得ることはできない", s): return []
    m = re.fullmatch(T + r"を、?パワーカードとして、?(?:このキャラクター|あなたの任意のあなたの支配キャラクターの(?:" + "|".join(TOKEN_NAMES) + r")1人)にセットする", s)
    if m and R(m.group(1)) == "t": return [{"a": "charToPower", "to": "t"}]
    m = re.fullmatch(r"«(\d)»を、?あなたの支配キャラクターとしてセットする", s)
    hm = m and re.fullmatch(r"あなたの手札の(.+?)を持つキャラクターカード1枚", raw_text_of(ref_of, m.group(1)))
    if hm and class_tokens(hm.group(1)) and len(class_tokens(hm.group(1))) == 1: return [{"a": "handToBack", "sel": {"type": "Character", "icon": class_tokens(hm.group(1))[0]}}]
    m = re.fullmatch(T + r"を、?あなたのテリトリーのあなたの任意のキャラクター1人に必要ファクター・コストを無視してセットする", s)
    if m and R(m.group(1)) == "t": return [{"a": "permToChar", "to": "t"}]
    m = re.fullmatch(T + r"をこのキャラクターにセットする", s)
    if m and R(m.group(1)) == "t": return [{"a": "permToSelf", "to": "t"}]
    m = re.fullmatch(r"このキャラクターに、?«(\d)»をセットする", s)
    bm = m and re.fullmatch(r"あなたの手札の[“”\"]([^“”\"]+)[”\"]を持つブレイクカード1枚", raw_text_of(ref_of, m.group(1)))
    if bm: return [{"a": "handBreakToSelf", "name": re.sub(r"\s+", "", bm.group(1))}]
    m = re.fullmatch(r"(?:このカードがセットされた場合、)?あなたは、?«(\d)»の手札全てを見ることができる", s)
    if m and R(m.group(1)) in ("players", "opp", "t"): return [{"a": "lookHand", "to": R(m.group(1)) if R(m.group(1)) == "t" else "players"}]
    if m and raw_text_of(ref_of, m.group(1)) == "あなたの任意のプレイヤー1人": return [{"a": "lookHand", "pick": True}]
    m = re.fullmatch(r"メインフェイズ終了時に、?このキャラクターのパワーが(\d+)の場合、«(\d)»は、?(?:その)?オーナーの手札に戻る", s)
    if m and R(m.group(2)) == "card": return [{"a": "delayed", "at": "main", "step": {"a": "bounce", "to": "card", "ifSelfPower": int(m.group(1))}}]
    m = re.fullmatch(r"メインフェイズ終了時に、?«t»を捨て札する", s)
    if m: return [{"a": "delayed", "at": "main", "step": {"a": "discard", "to": "t"}}]
    m = re.fullmatch(r"既にこのキャラクターのアタック宣言・ガード宣言が行われている場合、その宣言は取り消される", s)
    if m: return [{"a": "cancelBattle", "to": "self", "which": "both"}]
    m = re.fullmatch(u + T + r"がバトルする際、(精神力|攻撃力|耐久力)に([±+\-ー−]\(?[\dX]+\)?)して判定する", s)
    if m and sign_n(m.group(4)) is not None:
        v = sign_n(m.group(4))
        return [{"a": "mod", "to": R(m.group(2)), "until": UNT[m.group(1)], "cond": {"self": "inBattle"}, "mod": {"key": STAT_JP[m.group(3)], "op": "add", "value": {"xvar": True, "sign": v[1]} if isinstance(v, tuple) else v}}]
    m = re.fullmatch(r"そのバトルの際、" + T + r"はバトルによる通常ダメージを受けない", s)
    if m: return [{"a": "mod", "to": R(m.group(1)), "until": "battle", "mod": {"key": "noDamage", "op": "grant", "value": {"battleNormal": True}}}]
    m = re.fullmatch(u + r"«(\d)»は、?(?:その)?オーナーの手札に戻る", s)
    if m and raw_text_of(ref_of, m.group(2)) == "パワー0でかつ、アタック宣言またはガード宣言している状態になったキャラクター": return [{"a": "field", "mod": {"to": {"players": "all"}, "key": "zeroBattleBounce", "op": "grant", "value": True, "until": UNT[m.group(1)]}}]
    m = re.fullmatch(r"ターン終了時まで、«t»が捨て札される場合、あなたのデッキの上からカードを(\d+)枚捨て札することで、«(\d)»をオーナーの手札に戻すことが可能", s)
    if m and R(m.group(2)) == "card": return [{"a": "leaveRecall", "to": "t", "n": int(m.group(1)), "until": "turn"}]
    m = re.fullmatch(r"(?:その後、)?あなたのデッキの上からカードを(\d+)枚捨て札することで、«(\d)»をオーナーの手札に戻すことが可能", s)   # A3-24 3439 (Revise#166)
    if m and R(m.group(2)) == "card": return [{"a": "recall", "to": "card", "n": int(m.group(1))}]
    m = re.fullmatch(r"ターン終了時に、あなたのデッキの上からカードを(\d+)枚捨て札することで、«(\d)»をオーナーの手札に戻すことが可能", s)
    if m and R(m.group(2)) == "card": return [{"a": "delayed", "at": "turn", "step": {"a": "recall", "to": "card", "n": int(m.group(1))}}]
    m = re.fullmatch(u + T + r"に(.+?)を与え、(精神力|攻撃力|耐久力)に([±+\-]X)する", s)   # A3-18 2496 (Revise#166): "ブーストXを与え、攻撃力に+Xする"
    if m and skills_list(m.group(3)):
        sk = [dict(x, x="X") if re.search(r"X$", p.strip()) else x for x, p in zip(skills_list(m.group(3)), m.group(3).split("・"))]
        return [{"a": "mod", "to": R(m.group(2)), "until": UNT[m.group(1)], "resolveSkillX": True, "mod": {"key": "skill", "op": "grant", "value": x}} for x in sk] + [{"a": "mod", "to": R(m.group(2)), "until": UNT[m.group(1)], "mod": {"key": STAT_JP[m.group(4)], "op": "add", "value": {"xvar": True, "sign": -1 if m.group(5).startswith("-") else 1}}}]
    m = re.fullmatch(u + T + r"に(.+?)を与え、(精神力|攻撃力|耐久力)に([±+\-]\d+)する", s)
    if m and skills_list(m.group(3)): return [{"a": "mod", "to": R(m.group(2)), "until": UNT[m.group(1)], "mod": {"key": "skill", "op": "grant", "value": x}} for x in skills_list(m.group(3))] + [{"a": "mod", "to": R(m.group(2)), "until": UNT[m.group(1)], "mod": {"key": STAT_JP[m.group(4)], "op": "add", "value": sign_n(m.group(5))}}]
    m = re.fullmatch(T + r"に対して効果を発揮しているプロジェクトカード・ファストカード全てを捨て札する", s)
    if m: return [{"a": "lastingOff", "to": R(m.group(1))}]
    m = re.fullmatch(u + r"あなたの支配キャラクターがプレイヤーにアタックした場合、«(\d)»を捨て札する", s)
    if m and raw_text_of(ref_of, m.group(2)) == "アタックを受けたプレイヤーの支配エリアのネームレベルキャラクター1人":
        return [{"a": "field", "mod": {"to": "you", "key": "watch", "op": "grant", "until": UNT[m.group(1)], "value": {"on": "attack", "toPlayer": True, "sel": {"owner": "you", "area": "controlled"}, "effect": {"steps": [{"a": "pickDiscard", "sel": {"ownerAttacked": True, "area": "controlled", "named": True}}], "status": "auto"}}}}]
    m = re.fullmatch(u + r"«(\d)»のガードコストは(\d+)上昇する", s)
    gm = m and re.fullmatch(r"(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のネームレベルキャラクターのアタック宣言に対してガード宣言する、ネームレベルでないキャラクター", raw_text_of(ref_of, m.group(2)))
    if gm: return [{"a": "field", "mod": {"to": {"players": "all"}, "key": "guardTax", "op": "grant", "until": UNT[m.group(1)], "value": {"att": {"faction": FACTION_JP[gm.group(1)], "named": True}, "grd": {"named": False}, "n": int(m.group(3))}}}]
    if s in ("その後、あなたのデッキから、そのキャラクターと同じ分類を持つブレイク条件のないブレイクカード1枚を選び、あなたの支配キャラクターとしてセットする", "あなたのデッキから、そのキャラクターと同じ分類を持つブレイク条件のないブレイクカード1枚を選び、あなたの支配キャラクターとしてセットする"):   # A3-21 3018 (Revise#177)
        return [{"a": "rememberIconsT", "to": "t", "_first": True}, {"a": "pickZone", "zones": ["deck"], "owner": "you", "dest": "back", "n": 1, "sel": {"types": ["Break"], "noBreakRule": True, "icons": "@effIcons"}}]
    m = re.fullmatch(r"«(\d)»にセットされているパワーカード全てをそのオーナーのデッキに戻し、?そのデッキをシャッフルする", s)   # A3-16 2258 (Revise#177)
    if m and isinstance(R(m.group(1)), dict) and "all" in R(m.group(1)): return [{"a": "powerToDecksSel", "sel": R(m.group(1))["all"]}]
    if s == "その後、«" + "0" + "»をあなたのダメージ置き場に置く" and False: pass
    m = re.fullmatch(r"(?:その後、)?«(\d)»をあなたのダメージ置き場に置く", s)
    if m and R(m.group(1)) == "card": return [{"a": "thisCardTo", "z": "damage"}]
    if s in ("その後、あなたのメインフェイズは終了する", "その後、あなたのメインフェイズを終了する", "あなたのメインフェイズは終了する", "あなたのメインフェイズを終了する"): return [{"a": "endMyMain"}]
    m = re.fullmatch(r"«(\d)»を、?オーナーの手札に戻す", s)   # A3-25 3730 (Revise#175)
    if m and raw_text_of(ref_of, m.group(1)) == "あなたの任意の勢力1つのキャラクターにセットされているパワーカード全て": return [{"a": "factionPowerToHand"}]   # A3-09 1419 / A3-25 3730 (Revise#175)
    m = re.fullmatch(r"«(\d)»をそのオーナーの手札に戻す", s)
    if m and raw_text_of(ref_of, m.group(1)) == "あなたの任意のキャラクターX体にセットされているカード全て": return [{"a": "stripPickX"}]
    if re.fullmatch(r"(?:その後、)?あなたの捨て札置き場から、(?:目標|«t»)と同じネームを持つカード1枚をあなたの手札に戻すことができる", s): return [{"a": "effNameT", "to": "t"}, {"a": "pickZone", "zones": ["discard"], "owner": "you", "dest": "hand", "n": 1, "upTo": True, "sel": {"name": "chosen"}}]   # A3-07 1102
    m = re.fullmatch(u + r"«(\d)»のオーナーは、?自分のデッキの一番上のカード1枚を引き、?パワーカードとして、?そのキャラクターにセットする", s)   # A3-07 1136
    if m and raw_text_of(ref_of, m.group(2)) == "支配キャラクターとのバトルによってバトル相手を捨て札したキャラクター":
        return [{"a": "watchEv", "event": "killed", "when": {"anyBattle": True}, "evBy": True, "effect": {"steps": [{"a": "powerFromDeck", "to": "evCh", "n": 1, "ownerDeck": True}], "status": "auto"}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(r"«(\d)»を、?任意の順番であなたのデッキの上に戻す", s)   # A3-22 3273 (Revise#173)
    if m and raw_text_of(ref_of, m.group(1)) == "あなたの任意の、あなたの捨て札置き場のカード3枚まで": return [{"a": "pickZone", "zones": ["discard"], "owner": "you", "dest": "deckTop", "n": 3, "upTo": True}]
    if s == "その後、あなたのデッキの下からこのカードの効果でデッキに戻した枚数に等しい枚数捨て札する" or s == "あなたのデッキの下からこのカードの効果でデッキに戻した枚数に等しい枚数捨て札する": return [{"a": "millBottomLast"}]
    m = re.fullmatch(r"Xはあなたの支配エリアの(.+?)キャラクターの数が上限の、?あなたの任意の数に等しい", s)   # A3-19 2605 (Revise#172): X is chosen when it resolves
    if m and parse_selector(m.group(1)) is not None: return [{"a": "chooseX", "max": {"countChars": dict(parse_selector(m.group(1)), area="controlled", owner="you")}, "_first": True}]
    m = re.fullmatch(u + r"場のキャラクター全ては、?分類に関わらず、?«(\d)»でブレイク可能", s)   # A3-16 2232 (Revise#172)
    bm = m and re.fullmatch(r"(.+?)を持つブレイクカード", raw_text_of(ref_of, m.group(2)))
    if bm and class_tokens(bm.group(1).replace("または", "・")) and len(class_tokens(bm.group(1).replace("または", "・"))) == len(bm.group(1).split("または")):
        return [{"a": "field", "mod": {"to": {"players": "all"}, "key": "breakWithIcons", "op": "grant", "value": {"icons": class_tokens(bm.group(1).replace("または", "・"))}, "until": UNT[m.group(1)]}}]
    m = re.fullmatch(u + r"«(\d)»はネームを持つブレイクカードを、?ファストカードのタイミングでセット宣言可能", s)   # A3-16 2285 (Revise#171)
    if m and R(m.group(2)) == "you": return [{"a": "field", "mod": {"to": "you", "key": "fastBreak", "op": "grant", "value": {"named": True}, "until": UNT[m.group(1)]}}]
    m = re.fullmatch(u + r"«(\d)»は(X|\d+)減少する", s)
    if m and raw_text_of(ref_of, m.group(2)) == "ネームを持つブレイクカードの必要ファクター": return [{"a": "field", "resolveN": True, "mod": {"to": {"players": "all"}, "key": "factorLess", "op": "add", "value": {"n": "X" if m.group(3) == "X" else int(m.group(3)), "sel": {"types": ["Break"], "named": True}}, "until": UNT[m.group(1)]}}]
    if s == "このカードの使用宣言時に、精神力、攻撃力、耐久力のいずれか1つを指定する": return [{"a": "pickStat"}]   # A3-19 2525 (Revise#171): chosen when it resolves
    m = re.fullmatch(u + r"目標の«(t|\d)»の、?このカードの使用宣言時に指定した能力値に([+\-]X|[+\-]\d+)する", s)
    if m and R(m.group(2)) == "t": return [{"a": "mod", "to": "t", "mod": {"key": "@stat", "op": "add", "value": {"xvar": True, "sign": -1 if m.group(3).startswith("-") else 1} if m.group(3).endswith("X") else int(m.group(3))}, "until": UNT[m.group(1)]}]
    if re.fullmatch(r"(?:目標が|«t»が)捨て札になる場合、?目標のオーナーは目標を構成するカード1枚を捨て札することで、?目標を場に残すことが可能", s):   # A3-21 2913 (Revise#171)
        return [{"a": "mod", "to": "t", "mod": {"key": "keepByStack", "op": "grant", "value": True}, "until": "main"}]
    m = re.fullmatch(u + r"(?:目標が|目標の«(?:t|\d)»が)捨て札(?:に|さ)れ?(?:な)?る場合、?このカードを捨て札することで目標を場に残すこと(?:ができる|が可能)", s)   # A3-14 2003 / A3-18 2482 (Revise#170)
    if m: return [{"a": "mod", "to": "t", "mod": {"key": "keepByCard", "op": "grant", "value": True}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + r"目標の«(t|\d)»のアタック宣言に対してガード宣言するキャラクターのガードコストは(\d+)上昇する", s)   # A3-14 1947
    if m and R(m.group(2)) == "t": return [{"a": "mod", "to": "t", "mod": {"key": "guardTaxVs", "op": "add", "value": int(m.group(3))}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(r"«(\d)»を捨て札する", s)
    if m and raw_text_of(ref_of, m.group(1)) == "あなたの任意の対戦相手1人のテリトリーの、各勢力のキャラクター1人ずつ": return [{"a": "eachFactionOne"}]   # A3-24 3580 (Revise#170)
    m = re.fullmatch(u + r"目標の«(t|\d)»にセットされているパーマネントカード全てを、?そのオーナーのダメージ置き場に置く", s)   # A3-18 2467
    if m and R(m.group(2)) == "t": return [{"a": "permsOfT", "to": "t", "dest": "damage"}]
    m = re.fullmatch(u + r"対象はファクター全てを失う", s)   # A3-09 1351 (Revise#166): "対象" = the "≪…≫" of the sentence before
    if m: return [{"a": "mod", "to": "_prevTo", "until": UNT[m.group(1)], "mod": {"key": "noFactor", "op": "grant", "value": True}}]
    m = re.fullmatch(u + T + r"は、?ファクター全てを失い、(.+?)を得る", s)
    if m and skills_list(m.group(3)): return [{"a": "mod", "to": R(m.group(2)), "until": UNT[m.group(1)], "mod": {"key": "noFactor", "op": "grant", "value": True}}] + [{"a": "mod", "to": R(m.group(2)), "until": UNT[m.group(1)], "mod": {"key": "skill", "op": "grant", "value": x}} for x in skills_list(m.group(3))]
    if re.fullmatch(r"«t»がアタックした場合、このカードを捨て札する", s): return [{"a": "discardOnAttack", "to": "t", "until": "turn"}]
    m = re.fullmatch(r"目標のオーナーは、?(\d+|X)ドローする", s)
    if m: return [{"a": "draw", "to": "tOwner", "n": "X" if m.group(1) == "X" else int(m.group(1))}]
    m = re.fullmatch(r"(?:ガード宣言が行われていない場合、)?" + T + r"は(?:ガード宣言|ガード)する", s)
    if m: return [{"a": "forceGuard", "to": R(m.group(1))}]
    if re.fullmatch(r"既にガード宣言しているキャラクターがいる場合、(?:目標|«t»)とそのキャラクターの通常攻撃力・耐久力を合計して判定する", s): return [{"a": "forceGuardJoin", "to": "t"}]   # A3-11 1743 (Revise#395)
    m = re.fullmatch(r"(?:このキャラクターは、?)?" + T + r"をガードする", s)
    if m: return [{"a": "forceGuard", "to": "self"}]
    m = re.fullmatch(T + r"を、?あなたの支配エリアに移動(?:する|させる)", s)
    if m: return [{"a": "dominate", "to": R(m.group(1))}]
    m = re.fullmatch(r"«(\d)»を(?:取り消す|無効化する)", s)
    rw = raw_text_of(ref_of, m.group(1)) if m else ""
    wm = re.fullmatch(r"このキャラクターの(アタック宣言またはガード宣言|アタック宣言・ガード宣言|アタック宣言|ガード宣言)", rw)
    if wm: return [{"a": "cancelBattle", "to": "self", "which": {"アタック宣言": "attack", "ガード宣言": "guard"}.get(wm.group(1), "both")}]
    m = re.fullmatch(r"«(\d)»を捨て札する", s)
    if m and raw_text_of(ref_of, m.group(1)) == "このキャラクターにセットされているパーマネントカード全て": return [{"a": "cardsOf", "to": "self", "part": "perm", "all": True, "dest": "discard"}]
    m = re.fullmatch(T + r"から、?あなたの任意のパワーカード(\d+)枚とパーマネントカード(\d+)枚を捨て札する", s)
    if m: return [{"a": "cardsOf", "to": R(m.group(1)), "part": "power", "n": int(m.group(2)), "dest": "discard"}, {"a": "cardsOf", "to": R(m.group(1)), "part": "perm", "n": int(m.group(3)), "dest": "discard"}]
    m = re.fullmatch(T + r"にセットされているパーマネントカード全てを捨て札する", s)
    if m: return [{"a": "cardsOf", "to": R(m.group(1)), "part": "perm", "all": True, "dest": "discard"}]
    m = re.fullmatch(T + r"(?:にセットされているパワーカードから、あなたの任意のカード|のパワーカード)(X|\d+)枚を捨て札する", s)
    if m: return [{"a": "cardsOf", "to": R(m.group(1)), "part": "power", "n": "X" if m.group(2) == "X" else int(m.group(2)), "dest": "discard"}]
    m = re.fullmatch(T + r"に、?(?:ただちに、?)?このキャラクターの(精神攻撃力|攻撃力|通常攻撃力)(?:の数値)?に等しいダメージを与える", s)
    if m: return [{"a": "damage", "to": R(m.group(1)), "n": "X", "_x": {"selfStat": "at"}}]
    m = re.fullmatch(T + r"のオーナーのデッキの上からカード(?:X|\d+)枚を引き、" + T + r"にパワーカードとしてセットする", s)
    if m: return [{"a": "powerFromDeck", "to": R(m.group(2)), "ownerDeck": True, "n": "last"}]
    m = re.fullmatch(r"Xは、?このカードの効果で捨て札したパワーカードの枚数に等しい", s)
    if m: return []   # the step above uses the number discarded ("last")
    m = re.fullmatch(r"(パワーカードフェイズ|メインフェイズ|ターン)終了時に、?" + T + r"のパワーが(\d+)(以上|以下)?の場合、" + T + r"を構成するカード全てを、?(?:その)?オーナーの手札に戻す", s)
    if m: return [{"a": "delayed", "at": {"パワーカードフェイズ": "charge", "メインフェイズ": "main", "ターン": "turn"}[m.group(1)],
                   "step": {"a": "bounce", "to": R(m.group(5)), "ifSel": {"power": {"op": {"以上": ">=", "以下": "<="}.get(m.group(4), "="), "n": int(m.group(3))}}}}]
    m = re.fullmatch(u + T + r"がバトルする際、" + T + r"を、?(?:その)?オーナーの手札に戻す", s)
    if m and R(m.group(3)) == "battleOppPower": return [{"a": "mod", "to": R(m.group(2)), "mod": {"key": "battleHook", "op": "grant", "value": {"steps": [{"a": "bounce", "to": "battleOppPower"}]}}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(r"(?:このカードが効果を発揮した場合、)?«(\d)»は、?自分のダメージ置き場と捨て札置き場から1枚ずつ、(.+?)を持つカードを、?自分の手札に加える", s)
    if m and R(m.group(1)) == "players":
        icons = [x for x in re.split(r"または|・", m.group(2)) if x]
        return [{"a": "eachPick", "zones": ["damage", "discard"], "n": 1, "sel": {"icons": icons}}]
    m = re.fullmatch(u + r"分類に関わらず、«(\d)»をブレイク可能", s)
    if m:
        icons = [x for x in re.split(r"・", raw_text_of(ref_of, m.group(2))) if x]
        if icons: return [{"a": "field", "mod": {"to": "you", "key": "breakAnyIcon", "op": "grant", "value": {"icons": icons}, "until": UNT[m.group(1)]}}]
    m = re.fullmatch(u + r"((?:[^\s、。]+?)(?:または[^\s、。]+?)*)を目標にしたブレイクカードのコストは、?(?:その)?オーナーの手札に戻る", s)   # A4-PR PR144 (Revise#343)
    if m: return [{"a": "field", "mod": {"to": "you", "key": "dest", "op": "dest", "value": {"cost": "set", "type": "Break", "targetIcons": re.split(r"または", m.group(2)), "to": "hand"}, "until": UNT[m.group(1)]}}]
    m = re.fullmatch(u + r"あなたが次に(.+?)を目標にブレイクカードをセット宣言する場合、«(\d)»は(?:オーナーの)?手札に戻る", s)   # A4-PP PP366
    if m and raw_text_of(ref_of, m.group(3)) == "そのカードのコスト" and class_tokens(m.group(2)):
        return [{"a": "field", "mod": {"to": "you", "key": "dest", "op": "dest", "value": {"cost": "set", "type": "Break", "targetIcons": class_tokens(m.group(2)), "to": "hand", "next": True}, "until": UNT[m.group(1)]}}]
    m = re.fullmatch(r"((?:[^\s、。]+?)(?:または[^\s、。]+?)*)を目標にしたブレイクカードのコストは、?(?:その)?オーナーの手札に戻る", s)
    if m:
        icons = re.split(r"または", m.group(1))
        return [{"a": "field", "mod": {"to": "you", "key": "dest", "op": "dest", "value": {"cost": "set", "type": "Break", "targetIcons": icons, "to": "hand"}, "until": "main"}}]
    m = re.fullmatch(r"«(\d)»の上から(?:カードを)?(X|\d+)枚を?捨て札する", s)
    if m and R(m.group(1)) == "evPlayerDeck": return [{"a": "mill", "to": "evPlayer", "n": "X" if m.group(2) == "X" else int(m.group(2))}]
    m = re.fullmatch(r"このカードを捨て札する", s)
    if m: return [{"a": "discard", "to": "card"}]
    m = re.fullmatch(T + r"を、?(?:その|目標の)?(?:オーナーの|あなたの)?手札に戻す", s)
    if m and isinstance(R(m.group(1)), dict) and "pickChars" in R(m.group(1)): return [{"a": "pickBounce", "sel": R(m.group(1))["pickChars"], "count": R(m.group(1))["n"]}]
    if m:
        r = R(m.group(1))
        return [{"a": "costTo", "to": "hand"}] if r == "cost" else [{"a": "bounce", "to": r}]
    m = re.fullmatch(r"(?:«(\d)»|このエフェクトのコスト)は、?(?:その|オーナーの|あなたの)?手札に戻る", s)
    if m and (m.group(1) is None or R(m.group(1)) == "cost"): return [{"a": "costTo", "to": "hand"}]
    m = re.fullmatch(r"このエフェクトのコストを、?(?:その|オーナーの|あなたの)?手札に戻す", s)
    if m: return [{"a": "costTo", "to": "hand"}]
    m = re.fullmatch(r"このエフェクトのコストは、?(?:あなたの|オーナーの)?ダメージ置き場に置く", s)
    if m: return [{"a": "costTo", "to": "damage"}]
    m = re.fullmatch(T + r"に、?この(?:エフェクト|カード)のコストをパワーカードとしてセットする", s)   # "このカードのコスト" too (EX0473, Revise#208)
    if m: return [{"a": "costTo", "to": "hold"}, {"a": "costAsPower", "to": R(m.group(1))}]
    m = re.fullmatch(T + r"に、?このエフェクトのコストに等しい(精神)?ダメージを与える", s)
    if m: return [{"a": "damage", "to": R(m.group(1)), "n": "X", "mental": bool(m.group(2))}]
    m = re.fullmatch("(?:" + u + ")?" + T + r"に、?(?:ただちに)?(\()?(\d+|X)\)?ダメージを与える", s)
    if m: return [{"a": "damage", "to": R(m.group(2)), "n": "X" if m.group(4) == "X" else int(m.group(4)), "mental": bool(m.group(3))}]
    m = re.fullmatch(u + T + r"に([±+\-]\(?[\dX]+\)?)/([±+\-]\(?[\dX]+\)?)/([±+\-]\(?[\dX]+\)?)する", s)
    if m: return stat_steps(UNT[m.group(1)], R(m.group(2)), [("se", sign_n(m.group(3))), ("at", sign_n(m.group(4))), ("de", sign_n(m.group(5)))])
    m = re.fullmatch(u + T + r"の(精神力|攻撃力|耐久力)に([±+\-]\(?[\dX]+\)?)する", s)
    if m: return stat_steps(UNT[m.group(1)], R(m.group(2)), [(STAT_JP[m.group(3)], sign_n(m.group(4)))])
    m = re.fullmatch(T + r"は、?(\d+|X)ドローする", s)
    if m: return [{"a": "draw", "to": R(m.group(1)), "n": "X" if m.group(2) == "X" else int(m.group(2))}]
    m = re.fullmatch(r"(?:あなた|このキャラクターのオーナー|このカードのオーナー)は、?(\d+|X)ドローする", s)
    if m: return [{"a": "draw", "to": "you", "n": "X" if m.group(1) == "X" else int(m.group(1))}]
    m = re.fullmatch(T + r"の(アタック宣言またはガード宣言|アタック宣言・ガード宣言|アタック宣言|ガード宣言)を(?:取り消す|無効化する)", s)
    if m: return [{"a": "cancelBattle", "to": R(m.group(1)), "which": {"アタック宣言": "attack", "ガード宣言": "guard"}.get(m.group(2), "both")}]
    m = re.fullmatch(u + r"«(\d)»のアタック宣言を取り消す", s)   # A3-17 2374 (Revise#168)
    if m and raw_text_of(ref_of, m.group(2)) == "ガード宣言されたキャラクター": return [{"a": "field", "mod": {"to": {"players": "all"}, "key": "cancelGuardedAll", "op": "grant", "value": True, "until": UNT[m.group(1)]}}]
    m = re.fullmatch(u + r"目標にガード宣言されたキャラクターのアタック宣言を取り消す", s)   # A3-09 1388
    if m: return [{"a": "mod", "to": "t", "mod": {"key": "cancelWhenGuards", "op": "grant", "value": True}, "until": UNT[m.group(1)]}]
    m = re.fullmatch(u + T + r"のアタック宣言を無効化する", s)
    if m: return [{"a": "cancelBattle", "to": R(m.group(2)), "which": "attack"}]
    m = re.fullmatch(T + r"を、?(?:目標の)?(?:その)?オーナーの勢力エリアのアクティブキャラクターにする", s)
    if m: return [{"a": "makeActive", "to": R(m.group(1))}]
    if re.fullmatch(r"パワーカードフェイズ終了時まで、«t»はアンデッドを得る", s): return [{"a": "cardCharSkill", "to": "t", "id": "undead", "until": "charge"}]   # Revise#133
    if re.fullmatch(r"パワーカードフェイズ終了時に、このエフェクトの効果でセットされたキャラクターを構成するカード全ては、あなたのダメージ置き場に置かれる", s): return [{"a": "cardCharDelayedDamage", "to": "t", "at": "charge"}]
    if re.fullmatch(r"(?:その後、)?«t»はただちにガード宣言する", s): return [{"a": "cardCharGuard", "to": "t"}]
    if re.fullmatch(r"«t»はバトル終了時にダメージ置き場に置かれる", s): return [{"a": "cardCharBattleEnd", "to": "t"}]
    if re.fullmatch(r"メインフェイズ終了時までバトルが行われなかった場合、«t»はメインフェイズ終了時にダメージ置き場に置かれる", s): return [{"a": "cardCharDelayedDamage", "to": "t", "at": "main"}]
    if re.fullmatch(r"«t»がネームを持つ場合、このエフェクトのコストをあなたのダメージ置き場に置く", s): return [{"a": "costToIfNamed", "to": "damage"}]
    m = re.fullmatch(r"メインフェイズ終了時まで、«(\d)»はそのオーナーの手札に戻る", s)   # "≪パーマネントカードのコスト≫はそのオーナーの手札に戻る" (Revise#137)
    if m:
        rt = raw_text_of(ref_of, m.group(1))
        tm = re.fullmatch(r"(パーマネント|プロジェクト|ファスト|ブレイク)カードのコスト", rt or "")
        if tm: return [{"a": "field", "mod": {"to": {"players": "all"}, "key": "dest", "op": "dest", "until": "main", "value": {"cost": "set", "type": CARD_TYPES_JP[tm.group(1)], "to": "hand"}}}]
    m = re.fullmatch(r"«(\d)»は、?" + u + r"(精神力|攻撃力|耐久力)に([+\-ー])(X|\d+)される", s)   # "≪…≫は、メインフェイズ終了時まで、耐久力に-Xされる" (Revise#139)
    if m:
        sg = -1 if m.group(4) in "-ー" else 1
        return [{"a": "stat", "to": R(m.group(1)), "key": STAT_JP[m.group(3)], "n": "X" if m.group(5) == "X" else sg * int(m.group(5)), "sign": sg, "until": UNT.get(m.group(2), "turn")}]
    m = re.fullmatch(r"このキャラクターは«(\d)»に(X|\d+)ダメージを与える", s)   # Revise#130
    if m: return [{"a": "damage", "to": R(m.group(1)), "n": "X" if m.group(2) == "X" else int(m.group(2))}]
    if re.fullmatch(r"メインフェイズ終了時まで、あなたの任意のあなたの手札1枚をあなたのダメージ置き場に置くことで、«(\d)»からアタックコストまたはガードコストを支払ったものとして扱うことができる", s):   # Revise#129
        return [{"a": "mod", "to": "self", "mod": {"key": "altPay", "op": "grant", "value": {"kind": "hand"}}, "until": "main"}]
    m = re.fullmatch(r"(?:その後、)?そのオーナーのデッキの一番上のカード(\d+)枚を、?そのオーナーのダメージ置き場に置く", s)   # Revise#129
    if m: return [{"a": "mill", "to": "tOwner", "n": int(m.group(1)), "zone": "damage"}]
    m = re.fullmatch(T + r"を、?(?:その)?オーナーのダメージ置き場に置く", s)
    if m and R(m.group(1)) == "evByAll": return [{"a": "charToDamage", "to": "evBy"}]
    m = re.fullmatch(r"あなたのデッキの(?:一番)?上(?:から|のカード)(\d+|X)枚(?:を)?引き、" + T + r"に、?パワーカードとしてセットする", s)   # Revise#126
    if m: return [{"a": "powerFromDeck", "to": R(m.group(2)), "n": "X" if m.group(1) == "X" else int(m.group(1))}]
    m = re.fullmatch(T + r"に、?あなたのデッキの(?:一番)?上(?:から|のカード)(\d+|X)枚(?:のカード)?を、?パワーカードとしてセットする", s)
    if m: return [{"a": "powerFromDeck", "to": R(m.group(1)), "n": "X" if m.group(2) == "X" else int(m.group(2))}]
    m = re.fullmatch(r"«(\d)»は、?(?:その)?オーナーの手札に戻る", s)
    if m and R(m.group(1)) == "card": return [{"a": "bounce", "to": "card"}]
    m = re.fullmatch(r"オーナーのデッキの一番上のカード(\d+|X)枚を引き、パワーカードとして" + T + r"にセットする", s)
    if m: return [{"a": "powerFromDeck", "to": R(m.group(2)), "n": "X" if m.group(1) == "X" else int(m.group(1)), "ownerDeck": True}]
    m = re.fullmatch(r"あなたのデッキの一番上のカード(\d+|X)枚を引き、パワーカードとして" + T + r"にセットする", s)
    if m: return [{"a": "powerFromDeck", "to": R(m.group(2)), "n": "X" if m.group(1) == "X" else int(m.group(1))}]
    m = re.fullmatch(T + r"にセットされているパワーカード全てを、このキャラクターに、パワーカードとしてセットする", s)
    if m: return [{"a": "powerSteal", "to": R(m.group(1))}]
    m = re.fullmatch(T + r"をゲームから取り除く", s)
    if m: return [{"a": "remove", "to": R(m.group(1))}]
    m = re.fullmatch(T + r"を、?(?:その)?(?:オーナーの)?デッキの一番(上|下)に(?:置く|戻す)", s)
    if m: return [{"a": "toDeck", "to": R(m.group(1)), "pos": "bottom" if m.group(2) == "下" else "top"}]
    m = re.fullmatch(T + r"を、?(?:その)?(?:オーナーの)?デッキに戻し、(?:その)?デッキをシャッフルする", s)
    if m and isinstance(R(m.group(1)), dict) and "pile" in R(m.group(1)):   # A4-02 0242 (Revise#282): a card from a pile
        pl = R(m.group(1))["pile"]; return [dict({"a": "pickZone", "zones": [pl["zone"]], "owner": pl["owner"], "dest": "deckShuffle", "n": pl["n"], "upTo": pl.get("upTo", False)}, **({"sel": pl["sel"]} if pl.get("sel") else {}))]
    if m: return [{"a": "toDeck", "to": R(m.group(1)), "pos": "top"}, {"a": "shuffle", "to": "tOwner"}]
    m = re.fullmatch(T + r"を、?(?:その)?(?:オーナーの)?ダメージ置き場に置く", s)
    if m: return [dict({"a": "toDamage", "to": R(m.group(1))}, **({"all": True} if m.group(1) != "t" and re.search(r"(セットされているカード|構成するカード)全て$", raw_text_of(ref_of, m.group(1))) else {}))]
    m = re.fullmatch(u + T + r"は、?(?:(.+?)と、?)?(?:エフェクト)?「GRANT(\d+)」を得る", s)   # Revise#310
    if m and (not m.group(3) or skills_list(m.group(3))):
        un = UNT[m.group(1)]
        return [{"a": "mod", "to": R(m.group(2)), "mod": {"key": "skill", "op": "grant", "value": x}, "until": un} for x in (skills_list(m.group(3)) if m.group(3) else [])] + [{"a": "mod", "to": R(m.group(2)), "mod": {"key": "effect", "op": "grant", "value": _GRANTS[int(m.group(4))]}, "until": un}]
    m = re.fullmatch(r"あなたのターン中の場合、効果発揮時に(.+)", s)   # A4-05 0949 (Revise#310): only on your turn
    if m:
        r2 = sentence_steps(m.group(1), ref_of)
        if r2 and all(not x["a"].startswith("_") and x["a"] != "manual" for x in r2): return [dict(x, **{"if": {"myTurn": True}}) for x in r2]
    m = re.fullmatch(r"(?:その後、)?あなたの手札(\d+)枚を、?パワーカードとして«(\d)»にセットする", s)   # A4-05 0910 (Revise#310)
    if m and R(m.group(2)) == "self": return [{"a": "handToPower", "n": int(m.group(1))}]
    m = re.fullmatch(r"(?:その後、)?あなたの手札のカード(\d+)枚を、?パワーカードとして«(\d)»にセットする", s)   # A4-EP EP599 (Revise#310)
    if m and R(m.group(2)) == "self": return [{"a": "handToPower", "n": int(m.group(1))}]
    m = re.fullmatch(r"(?:その後、)?あなたに(\(?)(\d+)\)?ダメージを与える", s)   # A4-EX01 EX0742 (Revise#310)
    if m: return [{"a": "damage", "to": "you", "n": int(m.group(2)), "mental": bool(m.group(1))}]
    m = re.fullmatch(r"(?:その後、)?あなたの手札(?:のカード)?(\d+)枚を捨て札する", s)   # A4-EX01 EX0714 (Revise#310): you choose
    if m: return [{"a": "handDiscard", "to": "you", "n": int(m.group(1))}]
    m = re.fullmatch(r"«(\d)»は自分のデッキの中からカード(\d+)枚をダメージ置き場に置き、デッキをシャッフルする", s)   # A4-03 0506 (Revise#310)
    if m and R(m.group(1)) in ("players", "all"): return [{"a": "eachDeckToDamage", "n": int(m.group(2))}]
    m = re.fullmatch(r"(?:その|あなたの)?デッキをシャッフルする", s) or re.fullmatch(r"«(\d)»をシャッフルする", s)
    if m: return [{"a": "shuffle", "to": "you"}]
    pile = lambda i: (lambda r: r["pile"] if isinstance(r, dict) and "pile" in r else None)(R(i))
    m = re.fullmatch(T + r"を、?(?:その|あなたの)?(?:オーナーの)?手札に(?:戻す|加える)(?:ことが可能)?", s)
    if m and pile(m.group(1)): return [dict({"a": "pickZone", "to": "you", "dest": "hand"}, **pile(m.group(1)))]
    m = re.fullmatch(T + r"を、?あなたのデッキに戻し、そのデッキをシャッフルする", s)   # Revise#134
    if m and pile(m.group(1)): return [dict({"a": "pickZone", "to": "you", "dest": "deckShuffle"}, **pile(m.group(1)))]
    m = re.fullmatch(T + r"を捨て札する", s)
    if m and isinstance(R(m.group(1)), dict) and "deckTop" in R(m.group(1)):
        d = R(m.group(1))["deckTop"]; return [{"a": "mill", "to": "you" if d["owner"] == "you" else "opp", "n": d["n"]}]
    if m and pile(m.group(1)): return [dict({"a": "pickZone", "to": "you", "dest": "discard"}, **pile(m.group(1)))]
    m = re.fullmatch(r"«(\d)»から、?(.*?)(?:カード)?を?(\d+|X)枚を?選び、(?:対戦相手に見せ(?:る|、)|)(?:その後、)?(?:そのカードを)?(?:あなたの)?(?:手札に加える)?(?:ことが可能)?", s)
    if m and R(m.group(1)) == "yourDeck":   # deck search: matching cards → hand (the deck is shuffled after)
        sel = card_filter(m.group(2))
        if sel is not None: return [{"a": "search", "to": "you", "sel": sel, "n": "X" if m.group(3) == "X" else int(m.group(3))}]
        g2 = m.group(2).strip("、")
        sel = deck_pick_sel(g2 + "カード" if g2 and not g2.endswith("カード") and not g2.endswith("」") else g2)   # "プロジェクトカードまたはファストカード1枚を選び、あなたの手札に加える" (A4-03 0471, Revise#310)
        if sel is not None: return [{"a": "pickZone", "zones": ["deck"], "owner": "you", "n": "X" if m.group(3) == "X" else int(m.group(3)), "sel": sel, "dest": "hand"}]
    m = re.fullmatch(r"«(\d)»から、?(.*?)(?:カード)?(\d+|X)枚を手札に加える", s)
    if m and R(m.group(1)) == "yourDeck":   # "≪あなたのデッキ≫から、E.G.O.のブレイクカード1枚を手札に加える" (M1a)
        sel = card_filter(m.group(2))
        if sel is not None: return [{"a": "search", "to": "you", "sel": sel, "n": "X" if m.group(3) == "X" else int(m.group(3))}]
        sel = deck_pick_sel(m.group(2).strip("、") + "カード" if not m.group(2).endswith("カード") and m.group(2) else m.group(2).strip("、"))   # "魔法少女リリカルなのはシリーズに登場するネームを持つブレイクカード" (EX0330, Revise#201)
        if sel: return [{"a": "pickZone", "zones": ["deck"], "owner": "you", "n": "X" if m.group(3) == "X" else int(m.group(3)), "sel": sel, "dest": "hand"}]
    m = re.fullmatch(r"«(\d)»の中の任意のカード(\d+)枚を、?あなたの手札に加える", s)   # A3-14 1945 (Revise#310)
    if m and R(m.group(1)) == "yourDeck": return [{"a": "search", "to": "you", "sel": {}, "n": int(m.group(2))}]
    m = re.fullmatch(r"«(\d)»から“([^”]+)”を(\d+)枚手札に加える", s)
    if m and R(m.group(1)) == "yourDeck": return [{"a": "search", "to": "you", "sel": {"name": re.sub(r"\s+", "", m.group(2))}, "n": int(m.group(3))}]
    m = re.fullmatch(r"«(\d)»から(.+?)のパーマネントカード(\d+)枚を選び、このキャラクターにセットする", s)
    if m and R(m.group(1)) == "yourDeck" and m.group(2) in FACTION_JP: return [{"a": "deckPermToSelf", "sel": {"faction": FACTION_JP[m.group(2)], "type": "Permanent"}, "n": int(m.group(3))}]
    m = re.fullmatch(r"«(\d)»の上からカード(\d+)枚を見て(\d+)枚を手札に加え、残りを捨て札する", s)
    if m and R(m.group(1)) == "yourDeck": return [{"a": "lookTake", "n": int(m.group(2)), "take": int(m.group(3)), "rest": "discard"}]
    m = re.fullmatch(T + r"を、?パワーカードとして、?このキャラクターにセットする", s)
    if m and isinstance(R(m.group(1)), dict) and "handPick" in R(m.group(1)): return [{"a": "handToPower", "n": R(m.group(1))["handPick"]}]
    m = re.fullmatch(r"このエフェクトのコストを、?(?:あなたの)?デッキの(?:1|一)番上に置く", s)
    if m: return [{"a": "costTo", "to": "deckTop"}]
    m = re.fullmatch("(?:" + u + ")?" + T + r"は、?任意の分類(\d+)つを得る", s)
    if m: return [{"a": "iconPick", "to": R(m.group(2)), "until": UNT.get(m.group(1) or "", "turn") if m.group(1) else "turn"}]
    m = re.fullmatch(T + r"を、?(?:あなたの)?ダメージ置き場に置く", s)
    if m and isinstance(R(m.group(1)), dict) and "handPick" in R(m.group(1)): return [{"a": "handToDamage", "n": R(m.group(1))["handPick"]}]
    m = re.fullmatch(T + r"を、?あなたの支配キャラクターとしてセットする", s)
    if m and isinstance(R(m.group(1)), dict) and "pile" in R(m.group(1)): return [dict({"a": "pickZone", "to": "you", "dest": "back"}, **R(m.group(1))["pile"])]
    m = re.fullmatch(T + r"を、?このキャラクターにパワーカードとしてセットする", s)
    if m and isinstance(R(m.group(1)), dict) and "deckTop" in R(m.group(1)): return [{"a": "powerFromDeck", "to": "self", "n": R(m.group(1))["deckTop"]["n"]}]
    m = re.fullmatch("(?:" + u + ")?" + T + r"は(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)または(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のファクターを(\d+)つ得る", s)
    if m: return [{"a": "factorPick", "to": R(m.group(2)), "factions": [FACTION_JP[m.group(3)], FACTION_JP[m.group(4)]], "n": int(m.group(5)), "until": UNT.get(m.group(1) or "", "removed") if m.group(1) else "removed"}]
    m = re.fullmatch(r"«(\d)»から(.*?)カード(?:を)?(\d+)枚(?:を)?選び、(?:あなたの)?勢力エリアの?(?:に)?アクティブキャラクターとしてセット(?:する|可能)", s)   # "…セット可能" (A4-02 0215, Revise#311)
    if m and R(m.group(1)) == "yourDeck":   # "≪あなたのデッキ≫からキャラクターカードを1枚選び、勢力エリアにアクティブキャラクターとしてセット可能"
        sel = card_filter(m.group(2))
        if sel is not None and sel.get("type", "Character") == "Character": return [{"a": "deckToActive", "sel": dict(sel, type="Character"), "n": int(m.group(3))}]
    m = re.fullmatch(T + r"は、?(?:自身の|自分の)?手札を(\d+)枚(?:選んで)?捨て札する", s)
    if m: return [{"a": "handDiscard", "to": R(m.group(1)), "n": int(m.group(2))}]
    m = re.fullmatch(T + r"に、?あなたのデッキの一番上のカード(\d+|X)枚を引き、パワーカードとしてセットする", s)
    if m: return [{"a": "powerFromDeck", "to": R(m.group(1)), "n": "X" if m.group(2) == "X" else int(m.group(2))}]
    m = re.fullmatch(T + r"を、?このキャラクターにパワーカードとしてセットする", s)
    if m: return [{"a": "powerToSelf", "to": R(m.group(1))}]
    m = re.fullmatch(r"そのカードを、?あなたの手札に加える", s)
    if m: return []   # the search above already put it into the hand
    m = re.fullmatch(r"«(\d)»の上からカードを(\d+|X)枚捨て札する", s) or re.fullmatch(r"«(\d)»の一番上のカード(\d+|X)枚を捨て札する", s)
    if m and R(m.group(1)) in ("yourDeck",) or (m and raw_is_deck_top(s)): return [{"a": "mill", "to": "you", "n": "X" if m.group(2) == "X" else int(m.group(2))}]
    m = re.fullmatch(r"メインフェイズ終了時(?:に|まで)、" + T + r"(?:を、?(?:その)?オーナーの手札に戻す|は、?(?:その)?オーナーの手札に戻る)", s)
    if m: return [{"a": "delayed", "at": "main", "step": {"a": "bounce", "to": R(m.group(1))}}]
    m = re.fullmatch(r"通常のあなたのターン終了後、«(\d)»は、?続けて追加のターンを行う", s)   # EP311 (Revise#209)
    if m and R(m.group(1)) == "you": return [{"a": "extraTurn", "to": "you"}]
    m = re.fullmatch(T + r"は、?通常のターン終了後、続けて追加のターンを行う", s)
    if m: return [{"a": "extraTurn", "to": R(m.group(1))}]
    m = re.fullmatch(T + r"の(?:目標|対象)を、?あなたの任意の(?:適正な目標|(?:プレイヤー|キャラクター)\d人)に変更する", s)
    if m: return [{"a": "retarget", "to": R(m.group(1))}]
    m = re.fullmatch(r"あなたの手札の((?:プロジェクト|ファスト|パーマネント|ブレイク|キャラクター)カード(?:または(?:プロジェクト|ファスト|パーマネント|ブレイク|キャラクター)カード)*)(\d+)枚を捨て札する", s)
    if m: return [{"a": "handDiscard", "to": "you", "n": int(m.group(2)), "types": [CARD_TYPES_JP.get(x, "Character") for x in re.findall(r"(プロジェクト|ファスト|パーマネント|ブレイク|キャラクター)カード", m.group(1))]}]
    return None


def raw_is_deck_top(s):
    return False


def raw_text_of(ref_of, i):
    return "" if not str(i).isdigit() else getattr(ref_of, "raw", [""] * 99)[int(i)]   # «t»: no raw text (Revise#200)


def card_filter(text):
    """"“X”を持つ" / "E.G.O.のキャラクター" / "パーマネント" / "イレイザーの" → card selector, or None."""
    text = (text or "").strip("、")
    if not text: return {}
    m = re.fullmatch(r"“([^”]+)”を持つ", text)
    if m: return {"name": re.sub(r"\s+", "", m.group(1))}
    m = re.fullmatch(r"(.+?)を持つ", text)   # "スキャナーを持つ(カード)": a class icon
    if m and class_tokens(m.group(1)) and len(class_tokens(m.group(1))) == 1: return {"icon": class_tokens(m.group(1))[0]}
    m = re.fullmatch(r"(?:(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)の)?(プロジェクト|ファスト|パーマネント|ブレイク|キャラクター)?", text)
    if m and (m.group(1) or m.group(2)):
        sel = {}
        if m.group(1): sel["faction"] = FACTION_JP[m.group(1)]
        if m.group(2): sel["type"] = CARD_TYPES_JP.get(m.group(2), "Character")
        return sel
    return None


X_DEFS = [
    (r"Xは(?:、)?このキャラクターを構成する、?“([^”]+)”または“([^”]+)”の枚数に等しい", lambda m: {"selfNamedAny": [re.sub(r"\s+", "", m.group(1)), re.sub(r"\s+", "", m.group(2))]}),   # A4-05 0985 (Revise#340)
    (r"Xはあなたの支配エリアの(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)の([^の、。]+?)の数に等しい", lambda m: (lambda ic: {"countChars": {"owner": "you", "area": "controlled", "faction": FACTION_JP.get(m.group(1)) or FACTION_JP[m.group(1).replace("ー", "-")], "icons": ic}} if ic and len(ic) == len(re.split(r"・|または", m.group(2))) else None)(class_tokens(re.sub(r"・|または", "/", m.group(2))))),   # A4-PP PP244 (Revise#340)
    (r"Xは(全てのプレイヤー|あなた)のダメージ置き場にある、?このキャラクターと同じネームを持つカードの枚数(?:の合計)?に等しい", lambda m: {"dmgSameName": "all" if m.group(1) != "あなた" else "you"}),   # A3-07 1167 (Revise#325)
    (r"Xは(目標|このキャラクター)を構成する、?ネームを持つカードの枚数に等しい", lambda m: {"stackNamedCards": "target" if m.group(1) == "目標" else "self"}),   # A4-05 0922 / 0806 (Revise#318)
    (r"Xは(?:、)?目標の通常攻撃力に等しい", lambda m: {"targetStat": "at"}),   # A4-PR PR151 (Revise#318)
    (r"Xはあなたの支配エリアの((?:[^のを・]+)(?:(?:・|または)[^のを・]+)*)の数に等しい", lambda m: (lambda ic, n: {"countChars": {"owner": "you", "area": "controlled", "icons": ic}} if ic and len(ic) == n else None)(class_tokens(re.sub(r"・|または", "/", m.group(1))), len(re.split(r"・|または", m.group(1))))),   # A4-PR PR077 / EX0614 (Revise#318)
    (r"Xはあなたの支配エリアの、?([^、。]+?)のネームレベルキャラクターの数に等しい", lambda m: {"countChars": {"icons": class_tokens(m.group(1).replace("または", "・")), "named": True, "area": "controlled", "owner": "you"}} if class_tokens(m.group(1).replace("または", "・")) and len(class_tokens(m.group(1).replace("または", "・"))) == len(re.split("・|または", m.group(1))) else None),   # A3-25 3762 (Revise#170)
    (r"Xは(.+?)を持つあなたの支配キャラクターの数に等しい", lambda m: {"countChars": {"icons": class_tokens(m.group(1)), "area": "controlled", "owner": "you"}} if class_tokens(m.group(1)) else ({"countChars": dict(parse_selector(m.group(1) + "を持つ"), area="controlled", owner="you")} if parse_selector(m.group(1) + "を持つ") else None)),   # EX0416 (Revise#157)
    (r"Xはあなたの支配エリアの、?♂のネームレベルキャラクターの数に等しい", lambda m: {"countChars": {"male": True, "named": True, "area": "controlled", "owner": "you"}}),   # PR328
    (r"Xはこのキャラクターを構成する[“\"]([^”\"]+)[”\"]の(?:数|枚数)と、このキャラクターのパワーの合計に等しい", lambda m: {"selfNamedPlusPower": re.sub(r"\s+", "", m.group(1))}),   # A4-PP PP301 (Revise#341)
    (r"Xは全ての支配エリアのキャラクターの持つ(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のファクターの数に等しい", lambda m: {"factorSumAll": FACTION_JP.get(m.group(1)) or FACTION_JP[m.group(1).replace("ー", "-")]}),   # A4-PP PP333 (Revise#346)
    (r"Xは使用宣言中のこのキャラクターを目標にしているファストカードの枚数に等しい", lambda m: {"stackFastOnSelf": True}),   # A3-EX02 EX0111
    (r"Xはこのキャラクターを構成するブレイクカードの枚数に等しい", lambda m: {"selfStackType": "Break"}),   # A3-21 2908
    (r"Xはあなたのダメージ置き場の枚数から、対戦相手全てのダメージ置き場の枚数の合計を引いた数に等しい", lambda m: {"damageDiff": True}),   # A4-PP PP330 (Revise#346)
    (r"Xはプレイヤー全てのダメージ置き場の(.+?)の枚数の合計に等しい", lambda m: {"pileCount": {"zone": "damage", "owner": "all", "icons": class_tokens(m.group(1))}} if class_tokens(m.group(1)) and len(class_tokens(m.group(1))) == len(m.group(1).split("・")) else None),   # A4-05 0836 (Revise#349)
    (r"Xはバトル相手を目標に効果を発揮している、このキャラクターの持つコストが(\d+)以上のエフェクトの数に等しい", lambda m: {"selfEffectsOnOpp": {"costMin": int(m.group(1))}}),   # A4-EP EP413 / EP455 / EP458 (Revise#350)
    (r"Xは(あなたの支配エリアの.+?)キャラクター全ての(精神力|攻撃力|耐久力)の数値の合計に等しい", lambda m: {"charStatSum": {"sel": parse_selector(m.group(1)), "key": STAT_JP[m.group(2)]}} if parse_selector(m.group(1)) else None),   # A4-03 0478 (Revise#353)
    (r"Xはこのキャラクターを構成する一番上のネームを持つブレイクカードのコストに等しい", lambda m: {"selfTopNamedBreakCost": True}),   # A4-03 0572 (Revise#343)
    (r"Xはあなたがドローフェイズにドローする枚数に等しい", lambda m: {"drawPhase": "you"}),   # A4-04 0647
    (r"Xはこのキャラクターにセットされているパーマネントカードの攻撃力の欄に書かれた修正値の合計に等しい", lambda m: {"permAtSum": True}),   # EXPP054
    (r"Xは、?目標(?:のキャラクター)?にセットされているパーマネントカードの必要ファクターの合計に等しい", lambda m: {"targetPermFactor": True}),   # A3-05 0807 (Revise#159)
    (r"Xはこのキャラクターにセットされている([^。]+?)の(?:枚数|数)に等しい", lambda m: {"permTokens": m.group(1)} if m.group(1) not in ("パーマネントカード", "パワーカード") else None),   # EX0545: token Permanents
    (r"Xは(?:あなたの)?対戦相手(?:全て)?のダメージ置き場のカード枚数の合計に等しい", lambda m: {"damage": "opp"}),   # A3-03 0589 (Revise#159)
    (r"Xはプレイヤー全てのダメージ置き場(?:の|にある、?)(ブレイク|プロジェクト|ファスト|パーマネント)カードの枚数の合計に等しい", lambda m: {"pileCount": {"zone": "damage", "owner": "all", "type": CARD_TYPES_JP[m.group(1)]}}),   # PR327 / PR329
    (r"Xはこのキャラクターが持つ分類の種類数に等しい", lambda m: {"iconCount": True}),   # 2900
    (r"Xは(?:、)?目標の(?:キャラクターの)?パワーに等しい", lambda m: {"targetPower": True}),
    (r"Xは(?:、)?目標のオーナーの手札枚数に等しい", lambda m: {"targetOwnerHand": True}),   # A3-11 1716 (Revise#164)
    (r"Xは場に出ているこのカードと同じ名称のカードの枚数に等しい", lambda m: {"sameJpOnField": True}),
    (r"Xは全てのダメージ置き場の、?このカードと同じ名称のカードの枚数の合計に等しい", lambda m: {"sameJpInDamage": True}),
    (r"Xはあなたとあなたの支配キャラクターの持つ(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のファクターの合計に等しい", lambda m: {"factorSum": FACTION_JP[m.group(1)]}),   # Revise#152; A3-01 0098
    (r"Xは(?:、)?目標の本来の(精神力|攻撃力|耐久力)の数値に等しい", lambda m: {"targetBase": STAT_JP[m.group(1)]}),
    (r"Xは場のネームレベルキャラクターの数に等しい", lambda m: {"countChars": {"named": True}}),
    (r"Xはあなたの支配エリアの、キャパシティ\+1以上の数値のキャパシティのスキルを持つキャラクターの数に等しい", lambda m: {"capChars": True}),
    (r"Xは(?:、)?そのプレイヤーの、?パワー(\d+)の支配キャラクターの数に等しい", lambda m: {"countChars": {"area": "controlled", "power": {"op": "=", "n": int(m.group(1))}}, "of": "evPlayer"}),
    (r"Xは(?:、)?このキャラクターのパワー(?:カードの枚数)?に等しい", lambda m: {"power": "self"}),
    (r"Xは(?:、)?目標のコストに等しい", lambda m: {"targetCost": True}),
    (r"Xは(?:、)?目標の必要ファクターに等しい", lambda m: {"targetFactor": True}),
    (r"Xは(?:、)?あなたのダメージ置き場(?:にある|の)カード(?:の)?枚数に等しい", lambda m: {"damage": "you"}),
    (r"Xは(?:、)?あなたの対戦相手全てのダメージ置き場(?:にある|の)カード(?:の)?枚数の合計に等しい", lambda m: {"damage": "opp"}),
    (r"Xは(?:、)?全てのプレイヤーのダメージ置き場(?:にある|の)カード(?:の)?枚数の合計に等しい", lambda m: {"damage": "all"}),
    (r"Xは(?:、)?(?:あなたの)?対戦相手全ての手札(?:の)?枚数の合計に等しい", lambda m: {"hand": "opp"}),
    (r"Xはこのキャラクターを構成するカードの枚数に等しい", lambda m: {"stackCount": True}),
    (r"Xはあなたのダメージ置き場のネームを持つカードの枚数(?:の合計)?に等しい", lambda m: {"pileCount": {"zone": "damage", "owner": "you", "named": True}}),
    (r"Xはプレイヤー全ての手札枚数の合計に等しい", lambda m: {"hand": "all"}),   # Revise#144
    (r"Xは場の(.+?)の数(?:の合計)?に等しい", lambda m: {"countChars": {"icons": class_tokens(m.group(1))}} if class_tokens(m.group(1)) else None),
    (r"Xはあなたの支配エリアのネームに「([^」]+)」を含む(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のカードの枚数(?:の合計)?に等しい", lambda m: {"ctlCards": {"nameHas": m.group(1), "faction": FACTION_JP[m.group(2)]}}),   # Revise#141
    (r"Xはあなたのダメージ置き場のネームを持つブレイクカードの枚数(?:の合計)?に等しい", lambda m: {"pileCount": {"zone": "damage", "owner": "you", "named": True, "type": "Break"}}),   # Revise#141
    (r"Xはあなたの支配エリアの((?:[^のを]+)(?:・[^のを]+)*)の(?:数の)?合計に等しい", lambda m: {"countChars": {"owner": "you", "area": "controlled", "icons": class_tokens(m.group(1))}} if class_tokens(m.group(1)) and len(class_tokens(m.group(1))) == len(m.group(1).split("・")) else None),   # Revise#142
    (r"Xはあなたの支配エリアのブレイクしている(.+?)のネームレベルキャラクターの数に等しい", lambda m: {"countChars": {"owner": "you", "area": "controlled", "broken": True, "named": True, "icons": class_tokens(m.group(1))}} if class_tokens(m.group(1)) and len(class_tokens(m.group(1))) == len(re.split("・", m.group(1))) else None),   # A3-19 2659 (Revise#179)
    (r"Xはあなたの支配エリアのブレイクしている(.+?)の数(?:の合計)?に等しい", lambda m: {"countChars": {"owner": "you", "area": "controlled", "broken": True, "icons": class_tokens(m.group(1))}} if class_tokens(m.group(1)) else None),   # Revise#141
    (r"Xは全てのプレイヤーのダメージ置き場に置かれている(.+?)のカードの枚数の合計に等しい", lambda m: {"pileCount": {"zone": "damage", "owner": "all", "icons": class_tokens(m.group(1))}} if class_tokens(m.group(1)) else None),
    (r"Xはこのカードのコストに等しい", lambda m: {"cardX": True}),
    (r"Xは(?:、)?全てのプレイヤーのダメージ置き場にある、?ブレイクカードの枚数の合計に等しい", lambda m: {"pileCount": {"zone": "damage", "owner": "all", "type": "Break"}}),
    (r"Xは(?:、)?場の(" + "|".join(["アストラル", "コウモリ", "炎", "フレイム", "死霊", "式神零式改", "光弾"]) + r")の数の合計に等しい", lambda m: {"countChars": {"tokenName": m.group(1)}}),
    (r"Xは(?:、)?(.+?)キャラクターの数に等しい", lambda m: (lambda sel: {"countChars": sel} if sel is not None else None)(parse_selector(m.group(1)))),
    (r"Xは(?:、)?(.+?)の数の合計に等しい", lambda m: (lambda p: {"countChars": p[1]["all"]} if p and p[0] == "ref" and isinstance(p[1], dict) and "all" in p[1] else None)(parse_target(m.group(1) + "全て"))),
    (r"Xは(?:、)?あなたの手札(?:の)?枚数に等しい", lambda m: {"hand": "you"}),
    (r"Xは(?:、)?アタックを受けたプレイヤーの手札(?:の)?枚数に等しい", lambda m: {"hand": "attacked"}),
    (r"Xは(?:、)?そのキャラクターの(精神力|攻撃力|耐久力)に等しい", lambda m: {"evStat": STAT_JP[m.group(1)]}),
    (r"Xは(?:、)?全てのプレイヤーの手札(?:の)?枚数の合計に等しい", lambda m: {"hand": "all"}),
    (r"Xは(?:、)?目標の(精神力|攻撃力|耐久力)(?:の数値)?に等しい", lambda m: {"targetStat": STAT_JP[m.group(1)]}),
    (r"Xはあなたの支配エリアの“([^”]+)”の(精神力|攻撃力|耐久力|パワー)(?:の数値)?に等しい", lambda m: {"nameCtl": {"name": re.sub(r"\s+", "", m.group(1)), "stat": STAT_JP.get(m.group(2), "power")}}),   # A4-EP EP539 / EX0749 (Revise#310)
    (r"Xは(?:、)?捨て札した(?:キャラクター|目標)の(精神力|攻撃力|耐久力)に等しい", lambda m: {"targetStat": STAT_JP[m.group(1)]}),   # A4-02 0338 (Revise#310): the target that was discarded (X is worked out before)
    (r"Xはこのキャラクターを構成する([^、。を]+?)のブレイクカードの枚数(?:の合計)?に等しい", lambda m: {"stackBreakIcons": class_tokens(m.group(1).replace("または", "・"))} if class_tokens(m.group(1).replace("または", "・")) and len(class_tokens(m.group(1).replace("または", "・"))) == len(re.split("・|または", m.group(1))) else None),   # A4-PP PP362 / A4-05 0988 (Revise#310)
    (r"Xはこのキャラクターを構成する、?キャパシティ\+Xを持つカードの枚数に等しい", lambda m: {"stackSkill": "capacity"}),   # A4-EP EP596 (Revise#310)
    (r"Xはあなたの支配エリアの(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)の分類・([^の、。]+?)のネームレベルキャラクターの数に等しい", lambda m: {"countChars": {"faction": FACTION_JP[m.group(1)], "icons": class_tokens(m.group(2)), "named": True, "area": "controlled", "owner": "you"}} if class_tokens(m.group(2)) else None),   # A4-03 0473 (Revise#310)
    (r"Xはこのキャラクターを構成する(.+?)を持つブレイクカードの枚数(?:の合計)?に等しい", lambda m: {"stackBreakIcons": class_tokens(m.group(1).replace("または", "・"))} if class_tokens(m.group(1).replace("または", "・")) and len(class_tokens(m.group(1).replace("または", "・"))) == len(re.split("・|または", m.group(1))) else None),   # A3-09 1482
    (r"Xは(?:、)?このキャラクターの(?:通常|精神)?(精神力|攻撃力|耐久力)(?:の数値)?に等しい", lambda m: {"selfStat": STAT_JP[m.group(1)]}),
    (r"Xは(?:、)?このキャラクターのバトル相手のパワーに等しい", lambda m: {"battleOppPower": True}),
    (r"Xは(?:、)?バトル相手の(精神力|攻撃力|耐久力)(?:の数値)?の合計に等しい", lambda m: {"battleOppStat": STAT_JP[m.group(1)]}),
    (r"Xは(?:、)?このキャラクターのパワーカードの枚数から、?バトル相手のパワーカードの枚数を引いた数値に等しい", lambda m: {"powerDiff": True}),
    (r"Xは(?:、)?このキャラクターにセットされているパーマネントカードの枚数に等しい", lambda m: {"permCount": True}),
    (r"Xは(?:、)?あなたのダメージ置き場の(?:カード)?枚数に等しい", lambda m: {"damage": "you"}),   # Revise#261
    (r"Xはあなたのダメージ置き場に置かれているネームを持つカードの枚数に等しい", lambda m: {"pileCount": {"zone": "damage", "owner": "you", "named": True}}),   # A4-03 0441 (Revise#276)
    (r"Xは(?:、)?このキャラクターの持つイニシアチブの数に等しい", lambda m: {"initCount": "self"}),   # A4-05 0800 (Revise#273)
    (r"Xは(?:、)?このキャラクターを構成する、このカードの下の“([^”]+)”の枚数に等しい", lambda m: {"selfNamed": re.sub(r"\s+", "", m.group(1))}),   # A4-05 0803 (Revise#260)
    (r"Xは(?:、)?このキャラクターを構成する、ネームに「([^」]+)」(?:または「([^」]+)」)?を含むカードの枚数に等しい", lambda m: {"stackNameHas": [x for x in (m.group(1), m.group(2)) if x]}),   # A4 フォルナ (Revise#259)
    (r"Xは(?:、)?場のキャラクターを構成する、ネームに「([^」]+)」(?:または「([^」]+)」)?を含むカードの枚数に等しい", lambda m: {"fieldNameHas": [x for x in (m.group(1), m.group(2)) if x]}),
    (r"Xは(?:、)?このキャラクターを構成する、?(?:このカードと同じネームを持つカード|“([^”]+)”)の枚数に等しい", lambda m: {"selfNamed": re.sub(r"\s+", "", m.group(1)) if m.group(1) else True}),
    (r"Xはあなたの支配エリアの(.+?)キャラクターの数に等しい", lambda m: (lambda sel: {"countChars": dict(sel, area="controlled", owner="you")} if sel is not None and sel else None)(parse_selector(m.group(1)))),   # A3-19 2632 (Revise#170)
    (r"Xは(?:あなたの)?対戦相手(?:全て)?のダメージ置き場の(.+?)のブレイクカードの枚数(?:の合計)?に等しい", lambda m: (lambda ic: {"pileCount": {"zone": "damage", "owner": "others", "type": "Break", "icons": ic}} if ic and len(ic) == len(re.split("・|または", m.group(1))) else None)(class_tokens(m.group(1).replace("または", "・")))),   # A3-11 1712 (Revise#171)
    (r"Xは目標を構成するブレイクカードの枚数に等しい", lambda m: {"targetStackBreaks": True}),
    (r"Xはあなたの支配エリアの(.+?)にセットされているパーマネントカードの枚数(?:の合計)?に等しい", lambda m: (lambda p: {"permCountSel": p[1]["all"]} if p and p[0] == "ref" and isinstance(p[1], dict) and "all" in p[1] else None)(parse_target("あなたの支配エリアの" + m.group(1) + "全て"))),   # EX0460 (Revise#203)
    (r"Xはあなたの支配エリアの、?(.+?“[^”]+”)の(精神力|攻撃力|耐久力)(?:の数値)?(?:の合計)?に等しい", lambda m: (lambda p: {"charStatSum": {"sel": p[1]["all"], "key": STAT_JP[m.group(2)]}} if p and p[0] == "ref" and isinstance(p[1], dict) and "all" in p[1] else None)(parse_target("あなたの支配エリアの" + m.group(1) + "全て"))),   # EP340 / EX0458 (Revise#201)   # A3-21 2913 (Revise#171)
    (r"Xはあなたの支配エリアの(ミラーパネル)の数(?:の合計)?に等しい", lambda m: {"countChars": {"tokenName": m.group(1), "owner": "you", "area": "controlled"}}),   # A3-12 1760 (Revise#174)
]


def x_def(s):
    for pat, fn in X_DEFS:
        m = re.fullmatch(pat, s)
        if m:
            v = fn(m)
            if v is not None: return v
    return None


def norm_at(text):
    """"-X・ー(X)" / "ー(X)・-X" (normal or mental attack, whichever it has) → "-X" (Revise#111)."""
    text = re.sub(r"([\-ー−])(\d+|X)・[ー−\-]\(\2\)", r"-\2", text)
    return re.sub(r"[ー−\-]\((\d+|X)\)・([\-ー−])\1", r"-\1", text)


TOKEN_NAMES = ["アストラル", "コウモリ", "炎", "フレイム", "死霊", "式神零式改", "光弾"]
def token_body(text):
    """"≪このエフェクトのコスト≫を、勢力なし、分類なし、…の支配キャラクター・<name>としてセットする。…" → effect, or None (Revise#119)."""
    m = re.match(r"≪このエフェクトのコスト≫を、(.+?)(?:あなたの)?支配キャラクター[・、](\S+?)としてセットする。(.*)$", text)
    if not m: return None
    name, rest, tk = m.group(2), m.group(3), {"a": "makeToken", "icons": [], "skills": []}
    tk["name"] = name
    for part in [x for x in re.split(r"、", m.group(1)) if x]:
        part = part.strip()
        if re.fullmatch(r"勢力・?なし|分類・?なし", part): continue
        fm = re.fullmatch(r"勢力・?(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)", part)
        if fm: tk["faction"] = FACTION_JP[fm.group(1)]; continue   # Revise#152
        sm = re.fullmatch(r"(?:(.+?)の)?((?:\d+|X|\(X\)|\(\d+\)))/((?:\d+|X|\(X\)|\(\d+\)))/((?:\d+|X|\(X\)|\(\d+\)))の", part)
        if sm:
            if sm.group(1): tk["icons"] += class_tokens(sm.group(1)) or [sm.group(1)]
            g = lambda v: v.strip("()")
            tk["stats"] = {"se": g(sm.group(2)), "at": g(sm.group(3)), "de": g(sm.group(4))}
            if sm.group(3).startswith("("): tk["atMental"] = True
            continue
        im = re.fullmatch(r"分類・(.+?)(?:を持つ)?", part)
        if im: tk["icons"] += class_tokens(im.group(1)) or [im.group(1)]; continue   # a class of its own (炎, 式神 …)
        ksm = re.fullmatch(r"(.+?)を持つ(\d+)/(\d+)/(\d+)の", part)   # "チャージ1を持つ0/0/1の" (A3-12 1760, Revise#174)
        if ksm and skills_list(ksm.group(1)): tk["skills"] += skills_list(ksm.group(1)); tk["stats"] = {"se": ksm.group(2), "at": ksm.group(3), "de": ksm.group(4)}; continue
        if part.endswith("の") and class_tokens(part[:-1]) and len(class_tokens(part[:-1])) == len(part[:-1].split("・")): tk["icons"] += class_tokens(part[:-1]); continue   # "マシンの"
        km = re.fullmatch(r"(.+?)を持つ", part)
        if km and skills_list(km.group(1)): tk["skills"] += skills_list(km.group(1)); continue
        if class_tokens(part): tk["icons"] += class_tokens(part); continue   # "モンスター♂" (EX0155, Revise#161)
        return None
    xd = None
    for sent in [x for x in rest.split("。") if x.strip()]:
        sent = sent.strip()
        if re.fullmatch(re.escape(name) + r"は、?コストとして支払われたX枚のパワーカードをパワーとして持ち、パワーに等しい精神力・(精神攻撃力|攻撃力)・耐久力を持つ", sent):
            tk["stats"] = "power"; tk["atMental"] = sent.find("精神攻撃力") >= 0; continue
        if re.fullmatch(r"(?:あなたのターンに)?" + re.escape(name) + r"にカードをセットすることはできない", sent): tk["noSet"] = True; continue
        sm = re.fullmatch(re.escape(name) + r"は、?(.+?)を持つ", sent)
        if sm and skills_list(sm.group(1)): tk["skills"] += skills_list(sm.group(1)); continue
        if re.fullmatch(re.escape(name) + r"はキャラクターを目標にアタック宣言可能", sent): tk["attackChars"] = True; continue
        if re.fullmatch(re.escape(name) + r"はセットされた瞬間にガード宣言可能", sent): continue
        if re.fullmatch(re.escape(name) + r"があなたのターンのプロジェクトカードのタイミングでセットされた場合、あなたの任意の数の" + re.escape(name) + r"は、あなたの対戦相手1人を目標に、コストを支払わずにアタック宣言可能", sent): tk["raidIfProj"] = True; continue   # 3226 (Revise#152)   # it is set as a Controlled Character at once (it may guard)
        if x_def(sent): xd = x_def(sent); continue
        return None
    if "stats" not in tk: return None
    if isinstance(tk["stats"], dict) and "X" in tk["stats"].values() and not xd: return None
    out = {"steps": [{"a": "costTo", "to": "hold"}, tk], "costTo": "hold", "status": "auto"}
    out["steps"] = [tk]
    if xd: out["x"] = xd
    return out


_GRANTS = []   # effect lines granted by "「N:…」を得る" inside a body (Revise#310)


def parse_body(text):
    """Effect / Fast / Project text → {target, x, steps, costTo, status}. Several different chosen targets
    (≪キャラクター1人≫ … ≪プレイヤー1人≫) → target {kind: "multi", parts: [...]} with refs t0, t1 …"""
    text = re.sub(r"≪分類・(?=[^、。≫]+を持つ)", "≪", text)   # "≪分類・傀儡を持つ…≫" (Revise#135)
    text = re.sub(r"≪この[“”\"][^“”\"]+[”\"]≫", "≪このキャラクター≫", text)
    text = re.sub(r"(^|。)≪目標の", r"\1目標の≪", text)
    text = text.replace("シールド.・", "シールド・")   # a typo in A3-18 2497
    text = re.sub(r"≫を、?そのオーナーのデッキに戻す。その後、?そのデッキをシャッフルする", "≫を、そのオーナーのデッキに戻し、そのデッキをシャッフルする", text)   # A4-02 0242 (Revise#282): the owner's deck is shuffled
    text = text.replace("捨て札置場", "捨て札置き場")   # a typo in A4-02 0243
    text = text.replace("プロジェクトカード、このカード以外のファストカード、エフェクトの効果を受けない", "プロジェクトカード・このカード以外のファストカード・エフェクトの効果を受けない")   # A3-24 3581 (Revise#347)
    text = re.sub(r"(\d)ダメージ与える", r"\1ダメージを与える", text)   # A4-EP EP504 (Revise#346)
    text = re.sub(r"≪このカード≫のコストは、?(?=(?:ブレイクしている)?[“\"])", "このカードのコストは、", text)
    text = re.sub(r"目標の≪(あなたの支配エリアの[“\"][^”\"]+[”\"])≫", r"目標の≪\g<1>1人≫", text)   # EX0740 (Revise#344): one such character   # A4-EX01 EX0749 / EX0764 (Revise#344): same rule, written with brackets
    text = re.sub(r"≪([^≫]+)≫を目標にしたブレイクカードのコスト≫は、", lambda m: m.group(1).replace("・", "または") + "を目標にしたブレイクカードのコストは、", text)   # A4-PR PR144 (Revise#343): stray brackets
    text = re.sub(r"(^|。)場の、?すべてのキャラクターに", r"\1≪キャラクター全て≫に", text)   # A4-PR PR114 (Revise#310)
    text = text.replace("目標の ≪", "目標の≪").replace("目標のキャラクターひとりのスキル・エフェクトすべてを", "目標の≪キャラクター1人≫のスキル・エフェクト全てを")   # A4-PP PP276 / A4-PR PR115 (Revise#310)
    text = text.replace("ターン終了時まで≪このキャラクター≫に+", "ターン終了時まで、≪このキャラクター≫に+")   # A4-02 0310 (Revise#310)
    # "目標の≪…≫は(チャージ1と、)「1:…」を得る" (A4-04 0644, Revise#310): the granted effect line is compiled now and
    # stands in the sentence as 「GRANTn」, so the 。 inside it does not split the sentence
    def _grant(gm):
        line = gm.group(2).replace("：", ":")
        em = EFFECT_LINE.match(line)
        if not em: return gm.group(0)
        body = parse_body(em.group(2))
        if body["status"] != "auto": return gm.group(0)
        _GRANTS.append(dict({"cost": "X" if em.group(1) == "X" else int(em.group(1)), "text": line}, **body))
        return gm.group(1) + "「GRANT%d」を得" % (len(_GRANTS) - 1)
    text = re.sub(r"(は、?(?:[^「」≪≫。]+?と、?)?(?:エフェクト)?)「((?:\d+|X)[:：][^「」]+?)」を得", _grant, text)
    text = re.sub(r"(任意のエリア1つのキャラクター全て≫)に、(\(\d+\)ダメージ)", r"\1に\2", text)   # "≪…≫に、(1)ダメージを与える" (A4-EX02 EX868, Revise#294)
    m = re.fullmatch(r"(ターン終了時まで|メインフェイズ終了時まで)、対戦相手の支配キャラクターがアタック宣言またはガード宣言した場合、≪そのキャラクター≫に(\d+)ダメージを与える。?", text)   # A4-EP EP446 (Revise#293)
    if m: return {"steps": [{"a": "watchEv", "event": ev, "when": {}, "chSel": {"owner": "opp", "area": "controlled"}, "effect": {"steps": [{"a": "damage", "to": "evCh", "n": int(m.group(2))}], "status": "auto"}, "until": UNTIL[m.group(1)]} for ev in ("attack", "guarded")], "status": "auto"}
    m = re.fullmatch(r"(ターン終了時まで|メインフェイズ終了時まで)、≪アタック宣言・ガード宣言したキャラクター≫にセットされているパワーカード全てを捨て札する。?", text)   # A4-05 0921 (Revise#292)
    if m: return {"steps": [{"a": "watchEv", "event": ev, "when": {}, "effect": {"steps": [{"a": "powerDiscard", "to": "evCh"}], "status": "auto"}, "until": UNTIL[m.group(1)]} for ev in ("attack", "guarded")], "status": "auto"}
    m = re.fullmatch(r"(ターン終了時まで|メインフェイズ終了時まで)、≪アタック宣言またはガード宣言した(.*?)キャラクター≫を捨て札する。?", text)   # A4-04 0772 (Revise#288)
    if m and (m.group(2) == "" or parse_selector(m.group(2))):
        sel, un = parse_selector(m.group(2)) if m.group(2) else {}, UNTIL[m.group(1)]
        return {"steps": [dict({"a": "watchEv", "event": ev, "when": {}, "effect": {"steps": [{"a": "discard", "to": "evCh"}], "status": "auto"}, "until": un}, **({"chSel": sel} if sel else {})) for ev in ("attack", "guarded")], "status": "auto"}
    text = re.sub(r"≫を、?そのオーナーのデッキに戻す。その後、?そのデッキをシャッフルする", "≫を、そのオーナーのデッキに戻し、そのデッキをシャッフルする", text)   # A4-02 0242 (Revise#282): the owner's deck is shuffled
    text = re.sub(r"≫に、([±+\-ー−][\dX(（]?)", r"≫に\1", text)   # "≪…≫に、±0/+X/+Xする" (EP269)
    text = re.sub(r"≫([±+][\dX(（]+/[±+\-ー−][\dX(（)）]+/[±+\-ー−][\dX]+され)", r"≫は\1", text)
    text = re.sub(r"^このエフェクトの使用宣言時に、?あなたの手札をX枚捨て札する。", "このエフェクトの使用宣言時に、あなたの任意のあなたの手札X枚を捨て札する。", text)   # EX0444 (Revise#207)   # EXPP005: "≪…全て≫+1/+1/+1され" (the は is missing)
    text = text.replace("目標のキャラクターひとりに", "目標の≪キャラクター1人≫に").replace("アクティブキャラクターすべてに", "≪アクティブキャラクター全て≫に")   # EP027 / EP035 (Revise#192)
    t0 = norm_at(N(text).replace("キャラクタ-", "キャラクター").replace("プレイヤ-", "プレイヤー"))
    m = re.fullmatch(r"≪あなたの任意のプレイヤー1人≫にXダメージを与える。≪あなたの任意のキャラクター1人≫にXダメージを与える。≪あなたの任意のキャラクター1人≫に\(X\)ダメージを与える。≪あなたの任意のキャラクター1人≫の耐久力に-Xする。(Xは[^。]+に等しい)。?", t0)   # A3-19 2659 (Revise#179): four separate choices
    if m and x_def(m.group(1)):
        return {"steps": [{"a": "pickAnyDamage", "only": "player", "n": "X"}, {"a": "pickAnyDamage", "only": "char", "n": "X"}, {"a": "pickAnyDamage", "only": "char", "n": "X", "mental": True}, {"a": "pickCharDamage", "stat": "de", "sign": -1, "n": "X", "skipZero": True}], "x": x_def(m.group(1)), "status": "auto"}
    text = re.sub(r"(^|。|、)≪あなたの任意の(キャラクター1人)≫", r"\1目標の≪\2≫", text)   # A3-19 2659: one character you choose
    text = re.sub(r"^あなたの捨て札置き場にある、あなたの任意の≪(必要ファクタ.X以下のパーマネントカードX枚まで)≫", r"≪\1≫", text)   # A3-11 1660   # "≪目標のプロジェクトカードまたはファストカード1枚≫" (A3-09 1355)   # "≪この“サマエル”≫" on its Permanent = this character (Revise#164)
    text = norm_at(N(text).replace("キャラクタ-", "キャラクター").replace("プレイヤ-", "プレイヤー").replace("パワ-", "パワー"))
    # ---- Revise#312 ----
    m = re.fullmatch(r"目標の≪キャラクタ.1人≫にセットされているパワーカード全てを公開する。その中から(▼または)?([^、。]+?)を持つカード全てをそのオーナーのダメージ置き場に置く。?", text)   # A4-02 0344
    if m and class_tokens(m.group(2)):
        return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [dict({"a": "powerRevealToDamage", "to": "t", "icons": class_tokens(m.group(2))}, **({"aggressive": True} if m.group(1) else {}))], "status": "auto"}
    m = re.match(r"(.*?)(?:その後、)?≪あなたの捨て札置き場の(プロジェクト|ファスト|ブレイク|キャラクター|パーマネント)カード(\d+)枚≫を手札に戻すことが可能。(.*)", text)   # A4-05 0877: chosen when it resolves, may
    if m and m.group(1):
        a1, a2 = parse_body(m.group(1)), parse_body(m.group(4)) if m.group(4).strip() else {"steps": [], "status": "auto"}
        if a1["status"] == "auto" and a2["status"] == "auto" and "target" not in a2:
            st = {"a": "pickZone", "zones": ["discard"], "owner": "you", "n": int(m.group(3)), "upTo": True, "sel": {"types": [dict(CARD_TYPES_JP, キャラクター="Character")[m.group(2)]]}, "dest": "hand"}
            return dict(a1, **{k: v for k, v in a2.items() if k not in ("steps", "status")}, steps=a1["steps"] + [st] + a2["steps"], status="auto")
    m = re.match(r"≪あなたの任意の(.*?)キャラクター(?:全て)?≫に、?(\(?)(\d+|X)\)?ダメージを割り振って与える。(.*)", text)   # A4-05 0877 / 0895 / 1006 / 1012
    if m and (not m.group(1) or parse_selector(m.group(1)) is not None):
        rest = parse_body(m.group(4)) if m.group(4).strip() else {"steps": [], "status": "auto"}
        if rest["status"] != "manual":
            st = dict({"a": "splitDamage", "n": "X" if m.group(3) == "X" else int(m.group(3)), "mental": bool(m.group(2))}, **({"sel": parse_selector(m.group(1))} if m.group(1) else {}))
            return dict(rest, steps=[st] + rest["steps"], status=rest["status"])
    m = re.fullmatch(r"あなたは、目標の≪デッキ≫の一番上のカードを見る。その後、そのカードをデッキの一番下に置くことが可能。(.*)", text)   # A4-05 0804 / 0822: any player's deck
    rest = parse_body(m.group(1)) if m and m.group(1).strip() else {"steps": [], "status": "auto"}
    if m and rest["status"] == "auto" and "target" not in rest: return dict(rest, target={"kind": "player", "sel": {}, "count": 1}, steps=[{"a": "peekTopBottom", "to": "t", "n": 1}] + rest["steps"], status="auto")
    # ---- Revise#311 ----
    m = re.fullmatch(r"≪あなたの任意の(あなたの支配)?キャラクタ.1人と、そのキャラクターにセットされているカード全て≫を(?:そのオーナーの)?デッキに戻し、そのデッキをシャッフルする。(.*)", text)   # A4-EP EP496: the character and everything on it
    rest = parse_body(m.group(2)) if m and m.group(2).strip() else {"steps": [], "status": "auto"}
    if m and rest["status"] == "auto" and "target" not in rest:
        return dict(rest, target=dict({"kind": "char", "sel": {"owner": "you", "area": "controlled"} if m.group(1) else {}, "count": 1}, byChoice=True), steps=[{"a": "toDeck", "to": "t", "pos": "top", "allTo": True}, {"a": "shuffle", "to": "tOwner"}] + rest["steps"], status="auto")
    m = re.fullmatch(r"(ターン終了時まで|メインフェイズ終了時まで)、≪あなたの任意のキャラクタ.1人と、そのキャラクターにセットされているカード全て≫は、?((?:プロジェクトカード|ファストカード|エフェクト)(?:・(?:プロジェクトカード|ファストカード|エフェクト))*)の効果を受けない。?", text)   # A4-02 0219: the character (its cards are part of it)
    if m: return {"target": {"kind": "char", "sel": {}, "count": 1, "byChoice": True}, "steps": [{"a": "mod", "to": "t", "mod": {"key": "untargetable", "op": "grant", "value": {"from": [IMMUNE_TYPES[x] for x in m.group(2).split("・")]}}, "until": UNTIL[m.group(1)]}], "status": "auto"}
    m = re.fullmatch(r"≪あなたのダメージ置き場または捨て札置き場≫から、カード名称またはカードテキストに“([^”]+)”を含むカード(\d+)枚を手札に戻す。?", text)   # A4-EX02 EX908
    if m: return {"steps": [{"a": "pickZone", "zones": ["damage", "discard"], "owner": "you", "n": int(m.group(2)), "sel": {"name": re.sub(r"\s+", "", m.group(1)), "orText": True}, "dest": "hand"}], "status": "auto"}
    # ---- Revise#310 ----
    m = re.fullmatch(r"あなたのデッキの上からカード(\d+)枚を、≪あなたの任意のあなたのテリトリーのキャラクター≫にパワーカードとしてセットする。?(.*)", text)   # A4-01 0021 / A4-PV PV011: one by one, onto your characters
    rest = parse_body(m.group(2)) if m and m.group(2).strip() else {"steps": [], "status": "auto"}
    if m and rest["status"] == "auto": return dict(rest, steps=[{"a": "deckToOthersPower", "n": int(m.group(1)), "all": True}] + rest["steps"], status="auto")
    m = re.fullmatch(r"(ターン終了時まで|メインフェイズ終了時まで)、≪アタック宣言またはガード宣言した(ネームレベル)?キャラクターのオーナー≫は(\d+)ドローする。?(.*)", text)   # A3-EXPR EXPR013
    rest = parse_body(m.group(4)) if m and m.group(4).strip() else {"steps": [], "status": "auto"}
    if m and rest["status"] == "auto": return {"steps": rest["steps"] + [dict({"a": "watchEv", "event": ev, "when": {}, "effect": {"steps": [{"a": "draw", "to": "evOwner", "n": int(m.group(3))}], "status": "auto"}, "until": UNTIL[m.group(1)]}, **({"chSel": {"named": True}} if m.group(2) else {})) for ev in ("attack", "guarded")], "status": "auto", **{k: v for k, v in rest.items() if k not in ("steps", "status")}}
    m = re.fullmatch(r"(ターン終了時まで|メインフェイズ終了時まで)、キャラクターが(バトルによって)?捨て札された場合、≪捨て札されたキャラクターのオーナー≫は(\(?)(\d+)\)?ダメージを受ける。?", text)   # A4-02 0247 / A4-EX01 EX0734
    if m: return {"steps": [{"a": "watchEv", "event": "leave", "when": {"battle": True} if m.group(2) else {}, "effect": {"steps": [{"a": "damage", "to": "evOwner", "n": int(m.group(4)), "mental": bool(m.group(3))}], "status": "auto"}, "until": UNTIL[m.group(1)]}], "status": "auto"}
    m = re.fullmatch(r"(ターン終了時まで|メインフェイズ終了時まで)、≪ブレイクしていないキャラクター(?:全て)?≫はアタック宣言・ガード宣言・アタック・ガードできない。?", text)   # A4-PP PP025
    if m: return {"steps": [{"a": "mod", "to": {"all": {"broken": False}}, "mod": {"key": k, "op": "grant", "value": True}, "until": UNTIL[m.group(1)]} for k in ("noAttack", "noGuard")], "status": "auto"}
    if re.fullmatch(r"≪キャラクターにセットされているカード全て≫を、?(?:その)?オーナーの手札に戻す。?", text): return {"steps": [{"a": "allSetToHand"}], "status": "auto"}   # A4-05 0918
    m = re.fullmatch(r"このキャラクターを捨て札する。この効果でこのキャラクターが捨て札になる場合、(≪あなたの任意のキャラクタ.1人≫にXダメージを与える。)Xはこのキャラクターの攻撃力の数値の合計に等しい。?", text)   # A3-22 3303
    if m:
        b2 = parse_body(m.group(1) + "Xはこのキャラクターの攻撃力に等しい。")
        if b2["status"] == "auto": return dict(b2, steps=[{"a": "discard", "to": "self"}] + b2["steps"])
    m = re.match(r"あなたの手札のカードを1枚公開する。その後、≪あなたのデッキ≫の上から(\d+)枚を公開し、その中にある、公開した手札のカードと同じ名称のカード全てを手札に加える。(.*)", text)   # A4-04 0767 / 0782
    if m:
        rest = parse_body(m.group(2)) if m.group(2).strip() else {"steps": [], "status": "auto"}
        return dict(rest, steps=[{"a": "handNameDig", "n": int(m.group(1))}] + rest["steps"], status="auto" if rest["status"] == "auto" else "partial")
    m = re.match(r"≪あなたのデッキ≫のカードを上から(\d+)枚公開する。その中にある、(.+?)(\d+)枚をあなたの手札に加え、残りをデッキに戻す。(.*)", text)   # A4-03 0470 / 0485
    if m and deck_pick_sel(m.group(2)) is not None:
        rest = parse_body(m.group(4)) if m.group(4).strip() else {"steps": [], "status": "auto"}
        st = "auto" if rest["status"] == "auto" else "partial"
        return dict(rest, steps=[{"a": "lookTake", "n": int(m.group(1)), "take": int(m.group(3)), "sel": deck_pick_sel(m.group(2)), "rest": "deck", "reveal": True}] + rest["steps"], status=st)
    # ---- M3g batch 1 (Revise#192) ----
    if re.fullmatch(r"あなたの手札X枚を捨て札する。その後、≪あなたの任意のダメージ置き場のカードX枚≫を捨て札する。?", text):   # EX0071
        return {"steps": [{"a": "handDiscard", "to": "you", "n": "X"}, {"a": "pickZone", "zones": ["damage"], "owner": "any", "n": "X", "dest": "discard"}], "status": "auto"}
    if re.fullmatch(r"ターン終了時まで、≪あなたのテリトリーのキャラクター全て≫は、あなた以外のプレイヤーの使用したプロジェクトカード・ファストカードの効果を受けない。?", text):   # EX0621 / EX0633
        return {"steps": [{"a": "mod", "to": {"all": {"owner": "you"}}, "mod": {"key": "untargetable", "op": "grant", "value": {"from": ["Project", "Fast"], "byOpp": True}}, "until": "turn"}], "status": "auto"}
    m = re.fullmatch(r"(ターン|メインフェイズ)終了時まで、≪(" + "|".join(re.escape(k) for k in WORKS_JP) + r")の((?:プロジェクト|ファスト|パーマネント|ブレイク)カード(?:・(?:プロジェクト|ファスト|パーマネント|ブレイク)カード)*)≫のコストは(\d+)(減少|上昇)する。?", text)   # EXPR059 (Revise#201)
    if m: return {"steps": [{"a": "field", "mod": {"to": {"players": "all"}, "key": "cardCost", "op": "add", "value": {"n": int(m.group(4)) * (-1 if m.group(5) == "減少" else 1), "sel": {"types": [CARD_TYPES_JP[x] for x in re.findall(r"(プロジェクト|ファスト|パーマネント|ブレイク)カード", m.group(3))], "works": WORKS_JP[m.group(2)]}}, "until": "turn" if m.group(1) == "ターン" else "main"}}], "status": "auto"}
    m = re.fullmatch(r"(ターン|メインフェイズ)終了時まで、≪(" + "|".join(re.escape(k) for k in WORKS_JP) + r")(?:の|に登場する)(ネームを持つ)?((?:ブレイク|パーマネント)カード(?:・(?:ブレイク|パーマネント)カード)?)のコスト≫は、?(?:オーナーの)?手札に戻る。?", text)   # EX0328 / EX0479; EP154 / EP202 (Revise#201)
    if m: return {"steps": [{"a": "field", "mod": {"to": "you", "key": "dest", "op": "dest", "value": dict({"cost": "set", "types": ["Break" if "ブレイク" in x else "Permanent" for x in m.group(4).split("・")], "works": WORKS_JP[m.group(2)], "to": "hand"}, **({"named": True} if m.group(3) else {})), "until": "turn" if m.group(1) == "ターン" else "main"}}], "status": "auto"}
    m = re.fullmatch(r"≪あなたの任意の、あなたのダメージ置き場のカードX枚≫を、あなたの手札に加える。その後、あなたの支配エリアに[“\"]([^”\"]+)[”\"]がいる場合、≪あなたの任意のプレイヤー1人≫にXダメージを与える。?", text)   # EX0095
    if m: return {"steps": [{"a": "pickZone", "zones": ["damage"], "owner": "you", "n": "X", "dest": "hand"}, {"a": "pickAnyDamage", "only": "player", "n": "X", "if": {"namesCtl": [re.sub(r"\s+", "", m.group(1))]}}], "status": "auto"}
    # ---- M3 batch 15 (Revise#180) ----
    m = re.fullmatch(r"≪あなたのデッキ≫から、異なるネームを持つブレイクカード(\d+)枚を、あなたの手札に加える。?", text)   # A3-23 3348
    if m: return {"steps": [{"a": "pickZone", "zones": ["deck"], "owner": "you", "n": int(m.group(1)), "sel": {"types": ["Break"], "named": True}, "distinct": "name", "dest": "hand"}], "status": "auto"}
    m = re.fullmatch(r"≪あなたのデッキ≫から、異なる勢力のキャラクターカードを(\d+)枚まで選び、あなたの勢力エリアのアクティブキャラクターとしてセットする。?", text)   # A3-25 3620
    if m: return {"steps": [{"a": "pickZone", "zones": ["deck"], "owner": "you", "n": int(m.group(1)), "upTo": True, "sel": {"types": ["Character"]}, "distinct": "faction", "dest": "active"}], "status": "auto"}
    if re.fullmatch(r"ターン終了時まで、あなた以外のプレイヤーが使用したカードの効果で、≪あなたの支配キャラクター≫が捨て札になる場合、あなたのデッキの上からカードを(\d+)枚捨て札することで、そのキャラクターを場に残す。?", text):   # A3-24 3510
        return {"steps": [{"a": "mod", "to": {"all": {"owner": "you", "area": "controlled"}}, "mod": {"key": "keepMill", "op": "grant", "value": {"n": int(re.search(r"(\d+)枚", text).group(1)), "deck": "src", "byOppEffect": True}}, "until": "turn"}], "status": "auto"}
    m = re.fullmatch(r"ターン終了時まで、≪支配キャラクター全て≫は、支配キャラクターとのバトルによって捨て札になる場合、そのキャラクターのオーナーのデッキの一番上のカード1枚をそのオーナーのダメージ置き場に置くことで、そのキャラクターを場に残す。?", text)   # A3-24 3543
    if m: return {"steps": [{"a": "mod", "to": {"all": {"area": "controlled"}}, "mod": {"key": "keepMill", "op": "grant", "value": {"n": 1, "deck": "owner", "dest": "damage", "battleCtl": True}}, "until": "turn"}], "status": "auto"}
    if re.fullmatch(r"目標の≪あなたの支配キャラクター1人≫のアタック宣言またはガード宣言を取り消す。その後、≪目標のアタック宣言に対してガード宣言しているか、目標にガード宣言されているキャラクター全て≫のアタック宣言またはガード宣言を取り消す。?", text):   # A3-14 2057 (Revise#199)
        return {"target": {"kind": "char", "sel": {"owner": "you", "area": "controlled"}, "count": 1}, "steps": [{"a": "cancelBattle", "to": "t", "which": "both", "all": True}], "status": "auto"}
    # ---- M3 batch 14 (Revise#179) ----
    if re.fullmatch(r"メインフェイズ終了時まで、≪支配キャラクター全て≫のアタックコスト・ガードコストはX上昇する。Xはそのキャラクターのオーナーの手札枚数に等しい。?", text):   # A3-14 2004
        return {"steps": [{"a": "mod", "to": {"all": {"area": "controlled"}}, "mod": {"key": k, "op": "add", "value": {"ownerHand": True, "sign": 1}}, "until": "main"} for k in ("attackCost", "guardCost")], "status": "auto"}
    m = re.fullmatch(r"ターン終了時まで、目標の≪キャラクター1人≫は(.+?)を得、X以下の数値のダメージを受けない。Xは目標の精神力に等しい。?", text)   # A3-24 3437
    if m and skills_list(m.group(1)):
        return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "mod", "to": "t", "mod": {"key": "skill", "op": "grant", "value": x}, "until": "turn"} for x in skills_list(m.group(1))] + [{"a": "mod", "to": "t", "mod": {"key": "noDamage", "op": "grant", "value": {"maxX": {"selfStat": "se"}}}, "until": "turn"}], "status": "auto"}
    m = re.fullmatch(r"≪プレイヤー全て≫は、?Xドローする。Xはそれぞれのプレイヤーの支配エリアの、?(ネームを持つ)?(.+?)の数に等しい。?", text)   # A3-23 3338
    if m and class_tokens(m.group(2)) and len(class_tokens(m.group(2))) == len(re.split("・", m.group(2))):
        return {"steps": [{"a": "drawEachDamage", "what": "controlled", "sel": dict({"icons": class_tokens(m.group(2))}, **({"named": True} if m.group(1) else {}))}], "status": "auto"}
    m = re.fullmatch(r"目標の≪(.+?)を持つキャラクター1人≫を捨て札する。あなたの支配エリアに“([^”]+)”と“([^”]+)”が存在する場合、代わりに、目標の≪キャラクター1人≫を捨て札する。?", text)   # A3-17 2389 / 2393
    if m and parse_selector(m.group(1) + "を持つ") is not None:
        return {"target": {"kind": "char", "sel": {"anyOf": [parse_selector(m.group(1) + "を持つ"), {"ifCond": {"namesCtl": [re.sub(r"\s+", "", m.group(2)), re.sub(r"\s+", "", m.group(3))]}}]}, "count": 1}, "steps": [{"a": "discard", "to": "t"}], "status": "auto"}
    m = re.fullmatch(r"≪あなたのデッキ≫から、コスト(X|\d+)のパーマネントカード1枚を、あなたの任意のあなたの支配キャラクター1人にセット宣言する。その後、あなたのデッキをシャッフルする。?", text)   # A3-21 3093
    if m:
        return {"steps": [{"a": "effDecl", "zones": ["deck"], "types": ["Permanent"], "costEq": "X" if m.group(1) == "X" else int(m.group(1)), "anyChar": True}, {"a": "shuffle", "to": "you"}], "status": "auto"}
    if re.fullmatch(r"≪あなたの支配キャラクタ[ー\-－]1人にセットされているパワーカード全て≫と、≪あなたのダメージ置き場のあなたの任意のカード1枚≫を、あなたのデッキに戻し、デッキをシャッフルする。その後、あなたはXドローする。Xは、あなたのダメージ置き場と目標から、デッキに戻したカード枚数の合計に等しい。その後、あなたのメインフェイズは終了する。?", re.sub(r"\s+", "", text)):   # A3-04 0653 (Revise#245)
        return {"target": {"kind": "char", "sel": {"owner": "you", "area": "controlled", "hasPower": True}, "count": 1}, "steps": [{"a": "powerAndDamageToDeckDraw"}, {"a": "endMyMain"}], "status": "auto"}
    if re.fullmatch(r"このカードが効果を発揮した場合、≪あなた≫は1ドローすることが可能。このカードの効果で1ドローしていない場合、メインフェイズ終了時に、≪このカード≫をオーナーの手札に戻す。メインフェイズ終了時まで、目標の≪キャラクター1人≫はあなたの任意の分類1つを得る。?", text):   # A3-21 2911
        return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "mayDraw", "n": 1, "elseEndToHand": True}, {"a": "pickIconGrant", "to": "t", "until": "main"}], "status": "auto"}
    if re.fullmatch(r"ターン終了時まで、目標の≪あなたの支配キャラクター1人≫に±0/\+X/\+Xする。このカードのコストが目標からのみ支払われていた場合、さらに、ターン終了時まで、目標に±0/\+X/\+Xする。?", text):   # A3-16 2259
        return {"target": {"kind": "char", "sel": {"owner": "you", "area": "controlled"}, "count": 1}, "steps": [dict({"a": "mod", "to": "t", "mod": {"key": k, "op": "add", "value": {"xvar": True, "sign": 1}}, "until": "turn"}, **({"ifPaidOnlyT": True} if again else {})) for again in (False, True) for k in ("at", "de")], "status": "auto"}
    # this card becomes a character (Revise#174)
    m = re.fullmatch(r"≪このカード≫を、勢力なし、分類・(.+?)を持つ、(\d+)/(\d+)/(\d+)のあなたの支配キャラクター、[“”\"](.+?)[”\"]としてセットする。[“”\"]\5[”\"]はアビリティ「≪あなたの支配エリアの(.+?)全て≫は、(.+?)を得る。」を持つ。?", text)   # A3-25 3661
    if m and class_tokens(m.group(1)) and class_tokens(m.group(6)) and skills_list(m.group(7)):
        return {"steps": [{"a": "cardToken", "name": m.group(5), "stats": {"se": int(m.group(2)), "at": int(m.group(3)), "de": int(m.group(4))}, "icons": class_tokens(m.group(1)), "aura": {"sel": {"icons": class_tokens(m.group(6)), "owner": "you", "area": "controlled"}, "skills": skills_list(m.group(7))}}], "status": "auto"}
    m = re.fullmatch(r"≪このカード≫を、勢力なし、分類・(.+?)を持つあなたの支配キャラクター、“前鬼”または“後鬼”としてセットする。“前鬼”は▼、ペネトレイトを持つ4/X/4のキャラクターとして扱う。“後鬼”はインターセプトを持つ4/3/Xのキャラクターとして扱う。(Xは[^。]+に等しい)。?", text)   # A3-19 2552
    if m and x_def(m.group(2)) and class_tokens(m.group(1)):
        return {"steps": [{"a": "cardToken", "icons": class_tokens(m.group(1)), "options": [{"name": "前鬼", "stats": {"se": 4, "at": "X", "de": 4}, "skills": [{"id": "aggressive", "x": True}, {"id": "penetrate", "x": True}]}, {"name": "後鬼", "stats": {"se": 4, "at": 3, "de": "X"}, "skills": [{"id": "intercept", "x": True}]}]}], "x": x_def(m.group(2)), "status": "auto"}
    if re.fullmatch(r"≪このカード≫を、あなたの任意のあなたの手札X枚をパワーカードとして持つ、勢力なし、分類・式神を持つあなたの支配キャラクター、式神阿式としてセットする。式神阿式はパワーに等しい精神力・攻撃力・耐久力・インターセプトを持つ。式神阿式にカードをセットすることはできない。式神阿式からガードコスト以外のコストを支払うことはできない。あなたの手札1枚をあなたのダメージ置き場に置くことで、式神阿式からアタックコストを支払ったものとして扱うことができる。?", text):   # A3-09 1356
        return {"steps": [{"a": "cardToken", "name": "式神阿式", "stats": "power", "icons": ["式神"], "skills": [{"id": "intercept", "x": True}], "noSet": True, "power": "handX", "payOnly": ["guard"], "altPayHandAttack": True}], "status": "auto"}
    m = re.fullmatch(r"メインフェイズ終了時まで、≪あなた≫は、X人までの支配キャラクターで同時にアタック宣言可能。≪アタック宣言されたプレイヤー≫は、このアタック宣言に対して、X人までの支配キャラクターで同時にガード宣言可能。(Xは[^。]+に等しい)。?", text)   # A3-01 0129 (Revise#175)
    if m and x_def(m.group(1)): return {"steps": [{"a": "mod", "to": {"all": {"owner": "you", "area": "controlled"}}, "resolveX": True, "mod": {"key": "raid", "op": "grant", "value": {"max": {"n": "X"}, "free": False, "guards": True}}, "until": "main"}], "x": x_def(m.group(1)), "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、ブレイクしているキャラクターが捨て札になる場合、≪そのキャラクターを構成するカード全てと、そのキャラクターにセットされているカード全て≫をオーナーのデッキに戻し、そのデッキをシャッフルする。?", text):   # A3-02 0340 (Revise#175)
        return {"steps": [{"a": "field", "mod": {"to": {"players": "all"}, "key": "brokenLeaveDeck", "op": "grant", "value": True, "until": "main"}}], "status": "auto"}
    if re.fullmatch(r"目標の≪手札上限を越える手札を持つプレイヤー1人≫の手札が手札上限に等しくなるまで、目標の手札からあなたの任意のカードをオーナーのダメージ置き場に置く。?", text):   # A3-02 0344
        return {"target": {"kind": "player", "sel": {}, "psel": {"overLimit": True}, "count": 1}, "steps": [{"a": "trimHandToLimit", "to": "t"}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、目標の≪キャラクター1人≫がバトルまたは、あなた以外のプレイヤーの使用したカード・エフェクトの効果によって場から除去される場合、目標のキャラクターにセットされているパワーカード全てを、オーナーの手札に戻す。?", text):   # A3-02 0419
        return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "mod", "to": "t", "mod": {"key": "leavePowerToHand", "op": "grant", "value": {"battleOrOpp": True}}, "until": "main"}], "status": "auto"}
    if re.fullmatch(r"≪アタックを受けたプレイヤー≫の手札全てを、?そのプレイヤーのダメージ置き場に置く。その後、?アタックを受けたプレイヤーはXドローする。Xはアタックを受けたプレイヤーのダメージ置き場のカード枚数に等しい。?", text):   # A3-08 1220 / 1223 (Revise#170)
        return {"steps": [{"a": "handAll", "to": "attackedPlayer", "dest": "damage"}, {"a": "drawPerDamage", "to": "attackedPlayer"}], "status": "auto"}
    m = re.fullmatch(r"(?:メインフェイズ終了時まで、)?≪このキャラクター≫に([+＋]\(\d+\))する。?", text)   # A3-22 3197: "+(1)" (Revise#170)
    if m: return {"steps": [{"a": "mod", "to": "self", "mod": {"key": "at", "op": "add", "value": sign_n(m.group(1))}, "until": "main"}], "status": "auto"}
    m = re.fullmatch(r"このエフェクトの使用宣言時に、あなたの任意のエリア1つを指定する。≪指定したエリアのキャラクター全て≫に(\(?)(\d+)\)?ダメージを与える。?(このエフェクトはあなたのターンのプロジェクトカードのタイミングでのみ使用宣言可能。?)?", text)   # A3-16 2176 (Revise#168)
    if m: return dict({"steps": [{"a": "areaDamage", "n": int(m.group(2)), "mental": bool(m.group(1))}], "status": "auto"}, **({"timing": "project"} if m.group(3) else {}))
    if re.fullmatch(r"目標の≪キャラクター1人≫を捨て札する。この効果で目標が捨て札される場合、目標を場に残す効果全てを無効化する。?", text):   # A3-22 3200 (Revise#166)
        return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "discard", "to": "t", "noKeep": True}], "status": "auto"}
    if re.fullmatch(r"このカードの使用宣言時に、あなたの対戦相手1人を指定する。≪あなたと指定されたプレイヤー≫は、ネームを持つ自分の支配キャラクター1人を指定する。その後、指定したキャラクター同士はバトルを行う。?", text):   # EX0068 / EXPR001 (Revise#203)
        return {"target": {"kind": "player", "sel": {"owner": "opp"}, "count": 1, "psel": {"owner": "opp"}, "designate": True}, "steps": [{"a": "duelPick", "to": "t"}], "status": "auto"}
    if re.fullmatch(r"目標の≪ダメージ置き場のカード1枚≫を捨て札する。その後、あなたはXドローする。Xはこの効果で捨て札したカードの必要ファクターに等しい。?", text):   # EP199 (Revise#207)
        return {"steps": [{"a": "pickZone", "zones": ["damage"], "owner": "any", "n": 1, "dest": "discard", "storeFactor": True}, {"a": "draw", "to": "you", "n": "last"}], "status": "auto"}
    if re.fullmatch(r"≪プレイヤー全て≫は、自身のテリトリーのキャパシティ-Xを持つキャラクターの1人につき1枚、自身の手札を捨て札し、自身のテリトリーのキャパシティ\+Xを持つキャラクターの1人につき1ドローする。?", text):   # A3-24 3398 (Revise#209)
        return {"steps": [{"a": "eachDiscardDrawCap"}], "status": "auto"}
    m = re.fullmatch(r"≪プレイヤー全て≫はXドローする。Xはそのプレイヤーの支配エリアの(.*?)キャラクターの数に等しい。?", text)   # EXPR016 (Revise#207)
    if m and parse_selector(m.group(1)) is not None: return {"steps": [{"a": "eachDrawCount", "sel": parse_selector(m.group(1))}], "status": "auto"}
    DESIG = {"kind": "char", "sel": {"owner": "you", "area": "controlled"}, "count": 1, "designate": True}   # "このカードの使用宣言時に、あなたの任意のあなたの支配キャラクター1人を指定する" (Revise#203): chosen at declaration, as the 2nd part
    if re.fullmatch(r"このカードの使用宣言時に、(?:あなたの任意の)?あなたの支配キャラクター1人を指定する。目標の≪キャラクター1人≫にXダメージを与える。Xは指定したキャラクターの攻撃力に等しい。?", text):   # 1920 / PP205
        return {"target": {"kind": "multi", "parts": [{"kind": "char", "sel": {}, "count": 1}, DESIG]}, "steps": [{"a": "damage", "to": "t0", "n": "X", "mental": False}], "x": {"targetStat": "at", "part": 1}, "status": "auto"}
    if re.fullmatch(r"このカードの使用宣言時に、(?:あなたの任意の)?あなたの支配キャラクター1人を指定する。メインフェイズ終了時まで、目標の≪このカードの使用宣言時に指定した以外のあなたの支配キャラクター1人≫の精神力に\+Xする。Xは指定したキャラクターの精神力に等しい。このカードが効果を発揮した場合、指定したキャラクターにセットされているパワーカード全てを目標にセットする。?", text):   # PP207 / PP324 / 1923
        return {"target": {"kind": "multi", "parts": [{"kind": "char", "sel": {"owner": "you", "area": "controlled"}, "count": 1}, DESIG]}, "steps": [{"a": "mod", "to": "t0", "mod": {"key": "se", "op": "add", "value": {"xvar": True, "sign": 1}}, "until": "main"}, {"a": "powerMoveAll", "from": "t1", "to": "t0"}], "x": {"targetStat": "se", "part": 1}, "status": "auto"}
    # "このカードの使用宣言時に、プレイヤー1人 / あなたの支配キャラクター1人を指定する": chosen when it is declared, like a target (Revise#164)
    dm = re.match(r"このカードの使用宣言時に、(あなた以外の)?プレイヤー1人を指定する。(.+)", text)
    if dm and "≪指定したプレイヤー1人≫" in dm.group(2):
        text = dm.group(2).replace("≪指定したプレイヤー1人≫", "目標の≪" + (dm.group(1) or "") + "プレイヤー1人≫", 1).replace("≪指定したプレイヤー", "≪そのプレイヤー")
    dm = re.match(r"このカードの使用宣言時に、(?:あなたの任意の)?(あなたの支配キャラクター)1人を指定する。(.+)", text)
    if dm and "指定したキャラクター" in dm.group(2) and "≪" not in dm.group(2).split("指定したキャラクター")[0]:
        text = "目標の≪" + dm.group(1) + "1人≫を指定する。" + dm.group(2).replace("指定したキャラクター", "目標")
    text = re.sub(r"(^|。)あなたの任意の(≪[^≫]+1人≫)", r"\1\2", text)   # "あなたの任意の≪キャラクター1人≫に…" = one you choose
    text = re.sub(r"攻撃力に\+\((\d+|X)\)・\+\1する", r"攻撃力に+\1する", text)   # "+(N)・+N": +N to the attack, mental or normal (Revise#128)
    tok = token_body(text)
    if tok: return tok
    m = re.fullmatch(r"目標の≪キャラクター1人≫にブレイクカードがセットされた場合、メインフェイズ終了時まで、目標の精神力に-Xする。このエフェクトは勢力フェイズにしか使用宣言できない。(?:(Xは[^。]+に等しい)。?)?", text)   # カッサンドラ
    if m and m.group(1) and x_def(m.group(1)): return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "breakMinus", "to": "t"}], "x": x_def(m.group(1)), "timing": "active", "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、目標の≪ブレイクしているキャラクター1人≫は、そのキャラクターを構成するキャラクターカードの持つ分類全てを得る。メインフェイズ終了時まで、目標に対して使用宣言したブレイクカードのコストはオーナーの手札に戻る。?", text):
        return {"target": {"kind": "char", "sel": {"broken": True}, "count": 1}, "steps": [{"a": "reimuMark", "to": "t"}], "status": "auto"}
    m = re.fullmatch(r"目標の≪パワーX以下のキャラクター1人≫のアタック宣言・ガード宣言・エフェクトの使用宣言全てを取り消す。(?:(Xは[^。]+に等しい)。?)?", text)
    if m and m.group(1) and x_def(m.group(1)): return {"target": {"kind": "char", "sel": {"power": {"op": "<=", "n": "X"}}, "count": 1}, "steps": [{"a": "cancelAllOf", "to": "t"}], "x": x_def(m.group(1)), "status": "auto"}
    # ---- Pack (Revise#135) ----
    if re.fullmatch(r"メインフェイズ終了時まで、目標の≪キャラクター1人≫のアタック宣言に対してガード宣言するキャラクターは、通常のガードコストに加えて追加の1コストを支払わなければガード宣言(?:でき|すること(?:が|は)でき)ない。?", text):   # Revise#140
        return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "mod", "to": "t", "mod": {"key": "guardTaxVs", "op": "add", "value": 1}, "until": "main"}], "status": "auto"}
    m = re.fullmatch(r"このエフェクトの使用宣言時にあなたの支配キャラクターX体を捨て札する。目標の≪コストX以下のプロジェクトカードまたはファストカード1枚≫を捨て札する。?", text)   # Revise#140: X = how many you discard
    if m: return {"target": {"kind": "card", "sel": {"types": ["Project", "Fast"]}, "count": 1}, "steps": [{"a": "discardAnyX"}, {"a": "discardIfCost", "to": "t"}], "status": "auto"}
    m = re.fullmatch(r"あなたの支配エリアのネームレベルキャラクター1人を捨て札する。その後、目標の≪ネームレベルキャラクター1人≫を捨て札する。?(このエフェクトはあなたのターンのプロジェクトカードのタイミングでのみ使用宣言可能。?)?", text)
    if m: return dict({"target": {"kind": "char", "sel": {"named": True}, "count": 1}, "steps": [{"a": "discardOwnPick", "sel": {"named": True}}, {"a": "ifLastDiscard", "to": "t"}], "status": "auto"}, **({"timing": "project"} if m.group(1) else {}))
    if re.fullmatch(r"目標の、≪同じ名称のカードが場に2体以上存在するキャラクター1人≫を捨て札する。?", text):
        return {"target": {"kind": "char", "sel": {"dupName": True}, "count": 1}, "steps": [{"a": "discard", "to": "t"}], "status": "auto"}
    m = re.fullmatch(r"このエフェクトの使用宣言時に、あなたの手札X枚を捨て札する。≪あなたの任意のパワーカードX枚≫を捨て札する。?(このエフェクトはあなたのターンのプロジェクトカードのタイミングでのみ使用宣言可能。?)?", text)   # Revise#140: X = how many you discard
    if m: return dict({"steps": [{"a": "discardHandAnyX"}, {"a": "ownPowerDiscard", "n": "last", "any": True}], "status": "auto"}, **({"timing": "project"} if m.group(1) else {}))
    if re.fullmatch(r"メインフェイズ終了時まで、目標の≪キャラクター1人≫は本来の攻撃力を失い、目標のパワーに等しい精神攻撃力を得る。?", text):   # Revise#140
        return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "mentalAtkFromPower", "to": "t", "until": "main"}], "status": "auto"}
    m = re.fullmatch(r"メインフェイズ終了時まで、≪アタック宣言またはガード宣言した、あなたの支配キャラクター以外のキャラクター≫に(X|\d+)ダメージを与える。?(?:(Xは[^。]+に等しい)。?)?", text)
    if m:
        w = lambda on: {"a": "field", "storeX": True, "mod": {"to": "you", "key": "watch", "op": "grant", "until": "main", "value": {"on": on, "sel": {"notOwnCtl": True}, "effect": {"steps": [{"a": "damage", "to": "evCh", "n": "X" if m.group(1) == "X" else int(m.group(1))}], "status": "auto"}}}}
        return {"steps": [w("attack"), w("guard")], "status": "auto"}
    m = re.fullmatch(r"目標の≪キャラクタ[ー\-]1人≫にXダメージを与える。この効果でネームレベルキャラクターを捨て札した場合、≪捨て札したキャラクターのオーナー≫にXダメージを与える。(Xは[^。]+に等しい)。?", text)   # Revise#141
    if m and x_def(m.group(1)): return {"steps": [{"a": "damageKillHit", "to": "t", "n": "X"}], "target": {"kind": "char", "sel": {}, "count": 1}, "x": x_def(m.group(1)), "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、目標の≪キャラクタ[ー\-]1人≫に、全てのプレイヤーのダメージ置き場にあるカードの勢力全てに対するレジスト・プロテクトを与える。?", text):   # Revise#141
        return {"steps": [{"a": "resistDamageFactions", "to": "t", "until": "main"}], "target": {"kind": "char", "sel": {}, "count": 1}, "status": "auto"}
    m = re.fullmatch(r"メインフェイズ終了時まで、≪パーマネントカードがセットされていないこのキャラクター≫に\+(\d+)/\+(\d+)/\+(\d+)する。?", text)   # Revise#141: while it has no Permanent
    if m: return {"steps": [{"a": "mod", "to": "self", "mod": {"key": k, "op": "add", "value": int(m.group(i))}, "until": "main", "cond": {"selfNoPerm": True}} for k, i in (("se", 1), ("at", 2), ("de", 3))], "status": "auto"}
    m = re.fullmatch(r"(メインフェイズ終了時まで|ターン終了時まで)、目標の≪キャラクタ[ー\-]1人≫がアタック宣言またはガード宣言した場合、目標にセットされているパワーカード全てを捨て札する。?", text)   # Revise#141; A4-PR PR131 (Revise#311)
    if m: return {"steps": [{"a": "declDropPower", "to": "t", "until": UNTIL[m.group(1)]}], "target": {"kind": "char", "sel": {}, "count": 1}, "status": "auto"}
    m = re.fullmatch(r"≪あなたのデッキ≫から、ネームに「([^」]+)」を含む(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のカード1枚、または「([^」]+)」1枚を選び、対戦相手に見せる。その後、そのカードをあなたの手札に加える。その後、あなたのデッキをシャッフルする。?", text)   # Revise#141
    if m: return {"steps": [{"a": "pickZone", "to": "you", "dest": "hand", "zone": "deck", "owner": "you", "sel": {"anyOf": [{"nameHas": m.group(1), "faction": FACTION_JP[m.group(2)]}, {"jp": re.sub(r"\s+", "", m.group(3))}]}, "n": 1, "upTo": False}, {"a": "shuffle", "to": "you"}], "status": "auto"}
    m = re.fullmatch(r"目標の≪(.+?)1人≫を捨て札する。その後、≪あなたの任意のプレイヤーまたはキャラクタ.?1人≫に\(X\)ダメージを与える。Xはこの効果で捨て札したキャラクターの攻撃力の数値に等しい。(このエフェクトはあなたの(?:メインフェイズ|ターン)のプロジェクトカードのタイミングでのみ使用宣言可能。?)?", text)   # Revise#142
    if m and class_tokens(m.group(1)):
        return dict({"steps": [{"a": "discardStatX", "to": "t", "stat": "at"}, {"a": "pickAnyDamage", "n": "last", "mental": True}], "target": {"kind": "char", "sel": {"icons": class_tokens(m.group(1))}, "count": 1}, "status": "auto"}, **({"timing": "project"} if m.group(2) else {}))
    if re.fullmatch(r"≪あなたの任意のダメージ置き場にあるカード1枚≫を捨て札する。メインフェイズ終了時まで、≪このキャラクター≫に\+X/\+\(X\)/\+Xする。Xはこの効果で捨て札したカードの必要ファクターに等しい。?", text):   # Revise#142
        return {"steps": [{"a": "pickPileFactor", "zone": "damage"}] + [{"a": "mod", "to": "self", "mod": {"key": k, "op": "add", "value": {"xlast": True, "sign": 1}}, "until": "main"} for k in ("se", "at", "de")], "status": "auto"}
    m = re.fullmatch(r"このエフェクトの使用宣言時にエリア1つを指定する。≪指定したエリアのキャラクター全て≫の(精神力|攻撃力|耐久力)に[ー\-](\d+)する。(その後、≪このキャラクター≫を捨て札する。)?(このエフェクトはあなたのターンのプロジェクトカードのタイミングでのみ使用宣言可能。?)?", text)   # Revise#142
    if m: return dict({"steps": [{"a": "areaMod", "key": {"精神力": "se", "攻撃力": "at", "耐久力": "de"}[m.group(1)], "n": -int(m.group(2)), "until": "turn"}] + ([{"a": "discard", "to": "self"}] if m.group(3) else []), "status": "auto"}, **({"timing": "project"} if m.group(4) else {}))
    if re.fullmatch(r"このエフェクトの使用宣言時に、あなたの手札X枚とこのエフェクトのコストを、捨て札置き場に置かず、あなたのデッキに戻してシャッフルする。目標の≪精神力X以下のキャラクタ.?1人≫を構成するカード全てと、セットされているカード全てをそのオーナーのデッキに戻してシャッフルする。?", text):   # Revise#142
        return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "handToDeckX"}, {"a": "ifStatToDeck", "to": "t", "stat": "se"}], "costTo": "deckShuffle", "status": "auto"}
    m = re.fullmatch(r"≪あなたの手札にある、あなたが必要ファクターを満たしている(.+?)のブレイクカード1枚≫と、≪このカード≫を入れ替える。?", text)   # Revise#142
    if m and class_tokens(m.group(1).replace("または", "・")): return {"steps": [{"a": "swapWithHand", "icons": class_tokens(m.group(1).replace("または", "・"))}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、≪このキャラクター≫の攻撃力に\+Xする。メインフェイズ終了時まで、≪このキャラクターのアタック宣言に対してガード宣言するか、このキャラクターにガード宣言されたキャラクターとそのオーナー≫にXダメージを与える。?", text):   # Revise#142
        return {"steps": [{"a": "mod", "to": "self", "mod": {"key": "at", "op": "add", "value": {"xvar": True, "sign": 1}}, "until": "main"}, {"a": "guardHit", "n": "X", "until": "main"}], "status": "auto"}
    if re.fullmatch(r"目標の≪キャラクタ.?1人≫の、バトル以外のダメージを与える効果を持つエフェクト1つの使用宣言を取り消す。その後、目標のオーナーにXダメージを与える。?(?:Xはこのキャラクターの通常攻撃力の数値に等しい。?)?", text):   # Q#39 (X = its normal Attack, from the card's last line)
        return {"target": {"kind": "item", "sel": {"kind": "effect", "dealsDamage": True}, "count": 1}, "steps": [{"a": "cancelHitOwner", "to": "t", "n": "X"}], "x": {"selfStat": "at"}, "status": "auto"}
    if re.fullmatch(r"目標の、?≪バトル以外のダメージを与える効果を持つプロジェクトカードまたはファストカード1枚≫を捨て札する。その後、目標のオーナーにXダメージを与える。?(?:Xはこのキャラクターの通常攻撃力の数値に等しい。?)?", text):   # Q#39
        return {"target": {"kind": "item", "sel": {"types": ["Project", "Fast"], "dealsDamage": True}, "count": 1}, "steps": [{"a": "cancelHitOwner", "to": "t", "n": "X"}], "x": {"selfStat": "at"}, "status": "auto"}
    m = re.fullmatch(r"≪あなたの支配キャラクターの分類・(.+?)を持つキャラクタ.?1人を構成するカード全て≫を、このキャラクターにパワーカードとしてセットする。?", text)   # Revise#143
    if m and class_tokens(m.group(1)): return {"steps": [{"a": "pickCharToPower", "sel": {"icons": class_tokens(m.group(1))}}], "status": "auto"}
    m = re.fullmatch(r"このエフェクトの使用宣言時に、あなたの任意のあなたの支配エリアの分類・(.+?)を持つキャラクタ.?1体を捨て札しなければ、このエフェクトは効果を発揮しない。メインフェイズ終了時まで、目標の≪キャラクタ.?1人≫の(精神力|攻撃力|耐久力)に[ー\-](\d+)する。?", text)   # Revise#143
    if m and class_tokens(m.group(1)): return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "discardOwnPick", "sel": {"icons": class_tokens(m.group(1))}}, {"a": "stat", "to": "t", "key": {"精神力": "se", "攻撃力": "at", "耐久力": "de"}[m.group(2)], "n": -int(m.group(3)), "until": "main", "ifLast": True}], "status": "auto"}
    m = re.fullmatch(r"メインフェイズ終了時まで、≪あなたの支配エリアの分類・(.+?)を持つキャラクター全て≫に\+(\d+)/\+(\d+)/\+(\d+)する。?", text)   # Revise#143
    if m and class_tokens(m.group(1)): return {"steps": [{"a": "mod", "to": {"all": {"owner": "you", "area": "controlled", "icons": class_tokens(m.group(1))}}, "mod": {"key": k, "op": "add", "value": int(m.group(i))}, "until": "main"} for k, i in (("se", 2), ("at", 3), ("de", 4))], "status": "auto"}
    if text.rstrip("。") == "ターン終了時まで、≪このキャラクター≫はバインド1またはチャージ2を得る":   # Revise#144
        return {"steps": [{"a": "choiceGrant", "options": [{"id": "bind", "x": 1, "label": "Bind 1"}, {"id": "charge", "x": 2, "label": "Charge 2"}], "until": "turn"}], "status": "auto"}
    if text.rstrip("。") == "メインフェイズ終了時まで、≪このキャラクター≫の攻撃力に+1・+(1)する":   # Revise#144: Attack +1 (normal or mental, whichever it has)
        return {"steps": [{"a": "mod", "to": "self", "mod": {"key": "at", "op": "add", "value": 1}, "until": "main"}], "status": "auto"}
    if text.rstrip("。") == "メインフェイズ終了時まで、≪このキャラクター≫に次に与えられるダメージはあなたの任意のあなたの支配キャラクター1人に与えられる":   # Q#48
        return {"steps": [{"a": "redirectNext", "until": "main"}], "status": "auto"}
    if text.rstrip("。") == "目標の≪プロジェクトカードまたはファストカードまたはエフェクト1つ≫の目標を、あなたの任意の目標に変更する。変更する目標は適正なものでなくてはならない":
        return {"target": {"kind": "item", "sel": {"types": ["Project", "Fast"], "effects": True, "aims": "any"}, "count": 1}, "steps": [{"a": "retargetItem", "to": "t"}], "status": "auto"}
    if text.rstrip("。") == "目標の≪ダメージ置き場のカード枚数が8枚以上のあなたの対戦相手いずれか1人の、使用宣言中のカード1枚≫を捨て札する":   # A3-EX02 EX0185 mode 2 (Revise#217)
        return {"target": {"kind": "item", "sel": {"kind": "set", "byOppDmgMin": 8}, "count": 1}, "steps": [{"a": "cancelItem", "to": "t"}], "status": "auto"}
    if re.fullmatch(r"≪あなたの任意のエリア1つ以外のエリアの、キャラクター全て≫に5ダメージを与える。あなたの支配エリアに“ミカエル”がいる場合、代わりに、≪あなたの任意のエリア1つ以外のエリアのキャラクター全てと、あなた以外のプレイヤー全て≫に10ダメージを与える。?", text):   # A3-22 3311 (Revise#220)
        cnd = {"namesCtl": ["ミカエル"]}
        return {"steps": [{"a": "areaSpareDamage", "n": 5, "if": {"not": cnd}}, {"a": "areaSpareDamage", "n": 10, "players": True, "if": cnd}], "status": "auto"}
    if re.fullmatch(r"目標の、?≪あなたのテリトリーのキャラクター1人≫に、?あなたの任意のあなたの手札のイレイザーまたはイレイザー♂を持つブレイクカード1枚をセットする。必要ファクター・ネーム・ブレイク条件は満たしていなければならない。勢力エリアのキャラクターにセットした場合、その後、目標をあなたの支配エリアに移動させる。Xはセットするブレイクカードのコストに等しい。?", text):   # A3-11 1742 (Pack, Revise#220)
        return {"target": {"kind": "char", "sel": {"owner": "you"}, "count": 1}, "steps": [{"a": "effDecl", "zones": ["hand"], "types": ["Break"], "icons": ["イレイザー", "イレイザー♂"], "costEq": "X", "freeCost": True, "onto": "t"}], "status": "auto"}
    if re.fullmatch(r"≪あなたの手札のネームに「ブレイブカイザー」を含むブレイクカード1枚≫をあなたの支配キャラクターとしてセットし、≪あなたの支配キャラクターにセットされている、ネームに「ブレイブ」を含むE\.G\.O\.のパーマネントカード全て≫を、この効果でセットされたキャラクターにセットする。このエフェクトは、あなたの支配キャラクターにセットされている、ネームに「ブレイブ」を含むE\.G\.O\.のパーマネントカードが、合計5種類以上ある場合にのみ使用宣言可能。?", text):   # A3-16 2175 (Pack, Revise#221)
        return {"steps": [{"a": "handBreakToCtlPerms", "nameHas": "ブレイブカイザー", "permSel": {"nameHas": "ブレイブ", "faction": "E.G.O."}}], "declCond": {"permKinds": {"nameHas": "ブレイブ", "faction": "E.G.O.", "n": 5}}, "status": "auto"}
    if text.rstrip("。") == "あなたのデッキの上からカードをX枚捨て札する。目標の、≪あなたのダメージ置き場または捨て札置き場にあるマシンのブレイクカード1枚≫をセット宣言可能。目標がセットされた場合、あなたのデッキの一番上のカード1枚を引き、目標をセットされたキャラクターにパワーカードとしてセットする。目標がネームに「ブレイブ」を含むE.G.O.のカードの場合、≪このカード≫は、使用宣言時から効果終了時まで、ファストカード・エフェクトの効果を受けない。Xは目標のカードのコストに等しい":   # A3-22 3128 (Pack, Revise#221)
        return {"target": {"kind": "card", "sel": {"zones": ["damage", "discard"], "owner": "you", "types": ["Break"], "icons": ["マシン"]}, "count": 1}, "steps": [{"a": "machineRise", "to": "t"}], "x": {"targetCost": True}, "selfShieldIf": {"cond": {"tCardSel": {"nameHas": "ブレイブ", "faction": "E.G.O."}}, "fast": False}, "status": "auto"}
    # ---- M5 part 12 ----
    if re.fullmatch(r"≪あなた≫は1ドローする。その後、あなたの捨て札置き場にあるE\.G\.O\.のカードの枚数で以下の効果を上から順に発揮する。?", text):   # A4-03 0416
        return {"steps": [{"a": "draw", "to": "you", "n": 1}, {"a": "pileTiers", "faction": "E.G.O."}], "status": "auto"}
    # ---- M5 part 10 ----
    if re.fullmatch(r"≪あなたの任意のプレイヤー1人の支配エリアにいる、あなたの任意のネームレベルキャラクター2人≫は、自身以外の対象に自身の攻撃力に等しいダメージを与える。?", text):   # A4-03 0446
        return {"steps": [{"a": "mutualHit"}], "status": "auto"}
    if re.fullmatch(r"≪あなたの任意のキャラクター2体≫に1ダメージを与える。このカードの対象は、あなたの支配エリアの“高町なのは”を構成する、ネームを持つカード1枚につき1体追加で選ぶことが可能。?", text):   # A3-EX03 EX0311
        return {"steps": [{"a": "pickDamagePlus", "base": 2, "n": 1, "name": "高町なのは"}], "status": "auto"}
    # ---- M5 part 9 ----
    if re.fullmatch(r"このカードの使用宣言時に、分類を1つ指定する。ターン終了時まで、目標の≪指定した分類を持つあなたの支配キャラクター1人≫はインターセプトを得、±0/\+X/\+Xされる。Xが10以上の場合、目標はブレイクスルー・イニシアチブを得る。Xは指定した分類を持つあなたの支配キャラクターの数に等しい。?", text):   # A4-04 0711 (the class is one of the target's, named when it resolves)
        return {"target": {"kind": "char", "sel": {"owner": "you", "area": "controlled"}, "count": 1}, "steps": [{"a": "classRally", "to": "t", "until": "turn", "big": 10}], "status": "auto"}
    if re.fullmatch(r"≪あなたのデッキ≫から、あなたが二番目に多く支配している勢力のキャラクターカードを1枚選び、あなたの支配キャラクターとしてセットする。その後、(?:あなたの|その)デッキをシャッフルする。?", text):   # A4-04 0774
        return {"steps": [{"a": "secondFactionSet"}, {"a": "shuffle", "to": "you"}], "status": "auto"}
    m = re.fullmatch(r"≪プレイヤー全て≫は、(魔法少女リリカルなのはViVid|魔法戦記リリカルなのはＦｏｒｃｅ|魔法戦記リリカルなのはForce)に登場するネーム1つを指定し、自分のダメージ置き場と捨て札置き場から1枚ずつ、指定したネームを持つか、カードテキストに含むカードを手札に戻す。?", text)   # A3-EX03 EX0326 / A3-EX04 EX0484
    if m: return {"steps": [{"a": "nameRetrieve", "works": "nanohaForce" if "orce" in m.group(1) or "ｏｒｃｅ" in m.group(1) else "nanoha"}], "status": "auto"}
    # ---- M5 part 7 ----
    if re.fullmatch(r"ターン終了時まで、≪プレイヤーにアタックしたキャラクター≫に、ダメージ判定の後、そのキャラクターの攻撃力に等しいダメージを与える。?", text):   # A4-PP PP337
        return {"steps": [{"a": "mod", "to": {"all": {}}, "mod": {"key": "playerHit", "op": "grant", "value": {"effect": {"steps": [{"a": "damage", "to": "self", "n": "X", "mental": False}], "status": "auto"}}}, "until": "turn"}], "status": "auto"}
    if re.fullmatch(r"ターン終了時まで、目標の≪キャラクター1人≫は「≪このキャラクターのアタック宣言に対してガード宣言するか、このキャラクターにガード宣言されたキャラクター≫にXダメージを与える。Xは目標の通常攻撃力に等しい。」を得る。?", text):   # A4-PR PR151
        return {"target": {"kind": "char", "sel": {}, "count": 1}, "x": {"targetStat": "at"}, "steps": [{"a": "mod", "to": "t", "resolveX": True, "mod": {"key": "guardHit", "op": "grant", "value": {"n": "X"}}, "until": "turn"}], "status": "auto"}
    # ---- M5 part 6 ----
    if re.fullmatch(r"≪あなたのデッキ≫の上から、あなたの支配エリアの▼またはリムーブXを持つキャラクターの数に等しい枚数のカードを公開する。その後、≪公開されたカードの中にある、▼またはリムーブXを持つ、ネームを持たない、キャラクターカードとブレイクカード全て≫を、あなたの支配キャラクターとしてセットする。その後、≪公開されたカードの中にある、あなたが必要ファクターを満たした、▼またはリムーブXを持つ、ブレイク条件のない、ネームを持つブレイクカード1枚≫を、あなたの支配キャラクターとしてセットする。その後、そのデッキをシャッフルする。?", text):   # A3-24 3507
        return {"steps": [{"a": "aggroReveal"}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、≪コストが0のファストカード全て≫を無効化する。あなたの支配エリアに“アラクネ”がいる場合、メインフェイズ終了時まで、≪あなたの対戦相手全て≫は、手札の使用宣言およびキャラクターカードのセット宣言をすることができない。あなたの対戦相手いずれか1人のダメージ置き場のカード枚数が8枚以上の場合、ターン終了時まで、≪キャラクター全て≫はインフィニティを得る。?", text):   # A3-EX02 EX0158
        return {"steps": [{"a": "field", "mod": {"to": {"players": "all"}, "key": "banFastCost", "op": "grant", "value": {"n": 0}, "until": "main"}},
            {"a": "field", "mod": {"to": {"players": "opponents"}, "key": "ban", "op": "ban", "value": {"decl": "set"}, "until": "main"}, "if": cond_of("あなたの支配エリアに“アラクネ”がいる場合")},
            {"a": "mod", "to": {"all": {}}, "mod": {"key": "skill", "op": "grant", "value": {"id": "infinity", "x": True}}, "until": "turn", "if": {"oppDamageMin": 8}}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、目標の≪「バーニングハート」が4枚以上効果を発揮しているキャラクター1人≫は、ブレイクスルー・ブースト∞・イニシアチブを得、攻撃力に\+6される。目標が“シシガミ=バング”の場合、メインフェイズ終了時まで、目標はガードされない。?", text):   # A3-EX02 EX0166
        return {"target": {"kind": "char", "sel": {"srcJpMin": {"jp": "バーニングハート", "n": 4}}, "count": 1}, "steps": [{"a": "mod", "to": "t", "mod": {"key": "skill", "op": "grant", "value": x}, "until": "main"} for x in skills_list("ブレイクスルー・ブースト∞・イニシアチブ")]
            + [{"a": "mod", "to": "t", "mod": {"key": "at", "op": "add", "value": 6}, "until": "main"}, {"a": "mod", "to": "t", "mod": {"key": "noGuardBy", "op": "grant", "value": {}}, "until": "main", "ifTName": "シシガミ=バング"}], "status": "auto"}
    # ---- M5 part 5 ----
    m = re.fullmatch(r"(≪このカードのコスト≫を、.+?支配キャラクター[・、](\S+?)としてセットする。\2にカードをセットすることはできない。)メインフェイズ終了時に、≪\2全て≫を捨て札する。このカードが除去された場合、≪\2全て≫を捨て札する。?", text)   # A3-EX02 EX0156: one token for every card of the cost
    if m:
        tb = token_body(m.group(1).replace("≪このカードのコスト≫", "≪このエフェクトのコスト≫"))
        if tb: tb["steps"][0]["each"] = True; tb["steps"].append({"a": "delayed", "at": "main", "step": {"a": "discardTokens", "name": m.group(2)}}); return tb
    # ---- M5 part 4 ----
    if re.fullmatch(r"メインフェイズ終了時まで、≪ネームレベルでないキャラクター全て≫に-1.-1・\+\(1\).-1する。この効果で1未満の数値にはならない。メインフェイズ終了時まで、≪ネームレベルキャラクター全て≫に\+1.\+\(1\).\+1する。?", text):   # A4-03 0413 (the characters on the field when it resolves)
        return {"steps": [{"a": "shiftFloor", "until": "main"}], "status": "auto"}
    if re.fullmatch(r"このカードの使用宣言時に、カード種類を1つ指定する。≪あなたのデッキ≫のカードを上から5枚公開する。その中にある、指定したカード種類のカード全てをあなたの手札に加え、残りをデッキに戻す。その後、そのデッキをシャッフルする。?", text):   # A4-02 0248 (the type is named when it resolves)
        return {"steps": [{"a": "typeReveal", "n": 5}], "status": "auto"}
    if re.fullmatch(r"≪あなた≫は、あなたの手札のブレイクカードを任意の枚数捨て札する。その後、あなたのデッキから、このカードの効果で捨て札したブレイクカード1枚につき、そのブレイクカードと同じ分類を持つブレイクカードを1枚選び、手札に加える。その後、そのデッキをシャッフルする。?", text):   # A4-02 0312
        return {"steps": [{"a": "breakExchange"}], "status": "auto"}
    if re.fullmatch(r"ターン終了時まで、目標の≪キャラクター1人≫が次にプレイヤーにアタックした場合、通常のダメージ判定の後、アタックを受けたプレイヤーのデッキの一番上からカード1枚を、そのオーナーのダメージ置き場に置く。目標が必要ファクターが5以上のシーフ系を持つキャラクターの場合、代わりに、デッキの一番上からカード2枚を、そのオーナーのダメージ置き場に置く。?", text):   # A4-EP EP511
        return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "nextHitMill", "to": "t", "n": 1, "alt": 2, "tag": "シーフ系", "factorMin": 5, "until": "turn"}], "status": "auto"}
    if re.fullmatch(r"ターン終了時まで、目標の≪キャラクター1人≫は、アビリティ「≪このキャラクターのアタック宣言に対してガード宣言したキャラクター≫にセットされているパワーカード全てを、オーナーの手札に戻す。」を得る。目標が“ミーア・アクエリアス”の場合、ターン終了時まで、目標は、アビリティ「≪このキャラクターのバトル相手≫の持つスキル全てを無効化する。」を得る。?", text):   # A4-02 0280
        return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "guardStripT", "to": "t", "name": "ミーア・アクエリアス", "until": "turn"}], "status": "auto"}
    # ---- M5 part 3 ----
    if re.fullmatch(r"目標の≪このカードと同じ名称のカードがセットされている、あなたのテリトリーのキャラクター1人≫に、このエフェクトのコストをパワーカードとしてセットする。?", text):   # A3-24 3396
        return {"target": {"kind": "char", "sel": {"owner": "you", "permSameJpAsSrc": True}, "count": 1}, "costTo": "hold", "steps": [{"a": "costTo", "to": "hold"}, {"a": "costAsPower", "to": "t"}], "status": "auto"}
    if re.fullmatch(r"≪あなたのデッキ≫の一番上のカード1枚を公開する。公開したカードがキャラクターカード、またはブレイク条件を持たないブレイクカードだった場合、あなたの支配キャラクターとしてセットする。この効果でネームを持つカードがセットされた場合、あなたのデッキの上からカード5枚と、このカードを捨て札する。それ以外のカードだった場合、公開したカードを元に戻す。?", text):   # A3-24 3540
        return {"steps": [{"a": "revealSetTop", "mill": 5}], "status": "auto"}
    if re.fullmatch(r"ターン終了時まで、≪ダメージ判定の結果、勢力エリアにセットされるネームを持たないキャラクターカード全て≫は、そのオーナーの支配キャラクターとしてセットされる。?", text):   # A3-24 3504
        return {"steps": [{"a": "field", "mod": {"to": {"players": "all"}, "key": "dmgCharToControl", "op": "grant", "value": True, "until": "turn"}}], "status": "auto"}
    if re.fullmatch(r"このカードは、あなたとあなたの対戦相手いずれか1人の支配エリアに、ブレイクしているネームレベルキャラクターがそれぞれ1人以上いる場合にのみ使用宣言可能。≪あなたと、あなたの任意の、ブレイクしているネームレベルキャラクターを支配している対戦相手1人≫は、お互いに、相手の支配エリアのネームレベルキャラクター1人を指定する。≪指定されたキャラクターにセットされているパワーカード全て≫を、そのオーナーの手札に戻す。指定されたキャラクターのパワーが0だった場合、代わりに、≪そのキャラクターを構成するブレイクカード全て≫を捨て札する。?", text):   # A3-20 2693
        return {"steps": [{"a": "duelStrip"}], "playIf": {"bothBrokenNamed": True}, "status": "auto"}
    if re.fullmatch(r"このカードの使用宣言時に、ネームを持つキャラクターを2体以上支配しているプレイヤー1人を指定する。≪このカードの使用宣言時に指定したプレイヤー1人の、ネームを持つ支配キャラクター全て≫にセットされているパワーカード全てを捨て札し、対象を、そのプレイヤーの勢力エリアの、対象の勢力の勢力パーティの上に、あなたの任意の順番で移動させる。?", text):   # A3-20 2802 (their order is kept)
        return {"target": {"kind": "player", "sel": {}, "psel": {"namedCtlMin": 2}, "count": 1, "designate": True}, "steps": [{"a": "namedToActive", "to": "t"}], "status": "auto"}
    if re.fullmatch(r"このカードが効果を発揮した場合、このカードの効果終了時まで、プレイヤー全ては手札を公開し続ける。≪あなた≫は、あなたのデッキからあなたの任意のカード1枚を選び、手札に加える。その後、≪あなた以外のプレイヤー全て≫も同様の手順をターンの順番に行う。?", text):   # A3-24 3579 (the hands are not shown)
        return {"steps": [{"a": "allTutor"}], "status": "auto"}
    # ---- M5a part 2 ----
    if re.fullmatch(r"あなたのデッキからX枚を捨て札する。目標の、≪あなたのダメージ置き場または捨て札置き場にあるブレイクカード1枚≫をセット宣言可能。目標がセットされた場合、あなたのデッキの上からX枚引き、目標をセットされたキャラクターにパワーカードとしてセットする。Xは目標のカードのコストに等しい。?", text):   # A3-09 1352
        return {"target": {"kind": "card", "sel": {"zones": ["damage", "discard"], "owner": "you", "types": ["Break"]}, "count": 1}, "x": {"targetCost": True}, "steps": [{"a": "riseBreak", "to": "t", "mill": True}], "status": "auto"}
    if re.fullmatch(r"目標の、≪あなたのダメージ置き場または捨て札置き場にあるブレイクカード1枚≫を、あなたのテリトリーのキャラクター1人にセット宣言可能。目標がセットされた場合、あなたのデッキの上からX枚引き、目標をセットされたキャラクターにパワーカードとしてセットする。Xは目標の精神力に等しい。?", text):   # A3-14 2029
        return {"target": {"kind": "card", "sel": {"zones": ["damage", "discard"], "owner": "you", "types": ["Break"]}, "count": 1}, "x": {"targetStat": "se"}, "steps": [{"a": "riseBreak", "to": "t"}], "status": "auto"}
    if re.fullmatch(r"≪このカード≫は、あなたのテリトリーのキャラクターにのみ使用宣言可能。≪このカード≫は、使用宣言時から効果終了時まで、あなたの使用した、このカード以外のカードの効果を受けない。メインフェイズ終了時に、目標の≪キャラクター1人≫を捨て札し、目標と同じエリアにいるキャラクター全てにXダメージを与える。Xは目標の攻撃力に等しい。?", text):   # A3-20 2877 (its own-card immunity is not built)
        return {"target": {"kind": "char", "sel": {"owner": "you"}, "count": 1}, "steps": [{"a": "delayed", "at": "main", "step": {"a": "blastArea", "to": "t"}}], "status": "auto"}
    if re.fullmatch(r"目標の≪あなたの支配キャラクター1人≫を手札に戻す。その後、あなたの手札のネームを持たないブレイクカード1枚をあなたの支配キャラクターとしてセットする。目標がブレイクしているキャラクターの場合、代わりにあなたの手札のネームを持つブレイクカード1枚をあなたの支配キャラクターとしてセットする。この効果でセットするカードは、手札に戻したキャラクターと同じ勢力の、同じ分類を持つものでなければならない。?", text):   # A3-21 2914
        return {"target": {"kind": "char", "sel": {"owner": "you", "area": "controlled"}, "count": 1}, "steps": [{"a": "swapForBreak", "to": "t"}], "status": "auto"}
    if re.fullmatch(r"このカードが効果を発揮した場合、≪あなたのダメージ置き場または捨て札置き場にある、ブレイク条件のないブレイクカード1枚≫を、あなたの支配キャラクターとしてセットする。その後、あなたのデッキの一番上のカード1枚を引き、そのキャラクターにパワーカードとしてセットする。メインフェイズ終了時まで、このカードが除去される場合、≪このカードの効果でセットしたキャラクター≫を捨て札する。メインフェイズ終了時に、≪このカードと同じ名称のカードの効果でセットしたキャラクター全て≫を捨て札する。?", text):   # A3-22 3163
        return {"steps": [{"a": "reviveTemp"}], "status": "auto"}
    if re.fullmatch(r"ターン終了時まで、≪場で一番多い分類と同じ分類を持つキャラクター全て≫は、バトルによるダメージを受けない。ターン終了時まで、対象のアタック宣言に対してガード宣言するキャラクターのガードコストは1上昇する。?", text):   # A3-24 3400
        return {"steps": [{"a": "mostIconShield", "until": "turn"}], "status": "auto"}
    if re.fullmatch(r"ターン終了時まで、≪あなたの支配キャラクター全て≫は、指定した分類を持つキャラクターとのバトルによるダメージ受けない。?", text):   # A3-25 3731, mode 1 (the class is named when it resolves)
        return {"steps": [{"a": "pickIcon"}, {"a": "iconShield", "mode": "battle", "until": "turn"}], "status": "auto"}
    if re.fullmatch(r"ターン終了時まで、≪指定した分類を持つキャラクター全て≫は、プロジェクトカード・エフェクトの効果を受けない。?", text):   # A3-25 3731, mode 2
        return {"steps": [{"a": "pickIcon"}, {"a": "iconShield", "mode": "effects", "until": "turn"}], "status": "auto"}
    if re.fullmatch(r"ターン終了時まで、目標の≪キャラクター1人≫は、キャパシティ-X・チャージXを得、-X/\+X/\+Xされる。目標のパワーが0の場合、さらに、ターン終了時まで、目標はペネトレイトを得、±0/\+X/\+Xされる。?", text):   # A3-20 2804
        mv = lambda k, sg: {"a": "mod", "to": "t", "mod": {"key": k, "op": "add", "value": {"xvar": True, "sign": sg}}, "until": "turn"}
        return {"target": {"kind": "char", "sel": {}, "count": 1}, "costToIfNotOwn": "damage", "steps": [{"a": "zeroPowerBoost", "to": "t", "until": "turn"},
            {"a": "mod", "to": "t", "resolveSkillX": True, "mod": {"key": "skill", "op": "grant", "value": {"id": "capacity", "x": "-X"}}, "until": "turn"}, {"a": "mod", "to": "t", "resolveSkillX": True, "mod": {"key": "skill", "op": "grant", "value": {"id": "charge", "x": "X"}}, "until": "turn"}, mv("se", -1), mv("at", 1), mv("de", 1)], "status": "auto"}
    if re.fullmatch(r"≪プレイヤー全て≫に6ダメージを与える。その際、各プレイヤーは、自分の手札を1枚、または自分の支配キャラクター1人を捨て札するごとに、自分が受けるダメージを-1して判定することが可能。あなたのデッキ枚数が5枚以下の場合、≪あなた≫はこのカードによるダメージを受けない。?", text):   # A3-25 3766 (M5a)
        return {"steps": [{"a": "dmgBuyDown", "n": 6, "safeDeck": 5}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、目標の≪キャラクター1人≫の耐久力に\+2する。あなたの支配エリアまたはダメージ置き場に“厳島美鈴”のネームを持つカードがある場合、代わりに、メインフェイズ終了時まで、目標の耐久力に\+5し、精神ダメージを受けない。?", text):   # A3-22 3167 (M5a)
        return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "deUpNameAlt", "to": "t", "name": "厳島美鈴", "n": 2, "alt": 5, "until": "main"}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、≪キャラクターがプレイヤーにアタックした場合、そのダメージ判定≫を無効化する。その後、≪このカード≫を捨て札する。?", text):   # A3-16 2178 (M5a)
        return {"steps": [{"a": "field", "mod": {"to": {"players": "all"}, "key": "attackCheckNull", "op": "grant", "value": True, "until": "main"}}], "status": "auto"}
    if re.fullmatch(r"あなたの支配エリアに阿羅耶識のネームレベルキャラクターがいる場合、≪このカード≫は、使用宣言時から効果終了時まで、ファストカード・エフェクトの効果を受けない。このカードの使用宣言時に、あなたの任意のプレイヤー1人と、そのプレイヤーのダメージ置き場または捨て札置き場にあるプロジェクトカードまたはファストカード1枚を指定する。目標の、?≪このカードの使用宣言時に指定したプレイヤー1人≫にXダメージを与える。Xは指定したカードの必要ファクターとコストの合計に等しい。?", text):   # A3-18 2436 (M5a): the card is chosen when it resolves
        return {"target": {"kind": "player", "sel": {}, "psel": {}, "count": 1}, "steps": [{"a": "pileCardDamage", "to": "t"}], "selfShieldIf": {"cond": {"count": {"sel": {"faction": "Arayashiki", "named": True, "owner": "you", "area": "controlled"}, "op": ">=", "n": 1}}, "fast": False}, "status": "auto"}
    if re.fullmatch(r"≪あなたのデッキ≫から、プロジェクトカードまたはファストカード1枚を選び、対戦相手に見せる。その後、そのカードをあなたの手札に加える。その後、あなたのデッキをシャッフルする。メインフェイズ終了時まで、≪あなたが次に使用するプロジェクトカードまたはファストカードの必要ファクターとコスト≫に-Xする。Xはあなたの支配エリアの、WIZ[-ー]DOMのネームレベルキャラクターの数に等しい。メインフェイズ終了時に、≪このカード≫を捨て札する。?", text):   # A3-18 2451 (M5a)
        return {"steps": [{"a": "pickZone", "zones": ["deck"], "owner": "you", "n": 1, "sel": {"types": ["Project", "Fast"]}, "dest": "hand"}, {"a": "shuffle", "to": "you"}, {"a": "field", "resolveN": True, "mod": {"to": "you", "key": "nextCardLess", "op": "grant", "value": {"n": "X", "types": ["Project", "Fast"]}, "until": "main"}}],
                "x": {"countChars": {"owner": "you", "area": "controlled", "faction": "WIZ-DOM", "named": True}}, "status": "auto"}
    if re.fullmatch(r"このカードの使用宣言時に、プレイヤー1人を指定する。その後、指定されたプレイヤーは勢力1つとカード種類1つを指定する。≪このカードの使用宣言時に指定したプレイヤーのデッキ≫のカードを上から5枚公開する。この効果で公開されたカードの中に、このカードの使用宣言時に指定した勢力の、指定したカード種類のカードがあった場合、その全てをそのオーナーの手札に加え、残りを捨て札する。?", text):   # A3-20 2730 (M5a): the faction and the type are named when it resolves
        return {"target": {"kind": "player", "sel": {}, "psel": {}, "count": 1, "designate": True}, "steps": [{"a": "nameAndReveal", "to": "t", "n": 5}], "status": "auto"}
    if re.fullmatch(r"目標の≪あなたの捨て札置き場のキャラクターカード1枚≫を、あなたの支配キャラクターとしてセットする。あなたのデッキ枚数が30枚以下の場合、あなたの捨て札置き場の、あなたが必要ファクターを満たしている、ネームを持たないブレイクカードを、目標に含むことが可能。あなたのデッキ枚数が15枚以下の場合、あなたの捨て札置き場の、あなたが必要ファクターを満たしている、ブレイク条件のない、ネームを持つブレイクカードを、目標に含むことが可能。?", text):   # A3-22 3308 (M5a)
        return {"steps": [{"a": "reviveByDeck"}], "status": "auto"}
    if text.rstrip("。") == "目標の≪使用宣言中のカード1枚≫を、オーナーの手札に戻す":   # A3-22 3131 (M5a)
        return {"target": {"kind": "item", "sel": {"kind": "set"}, "count": 1}, "steps": [{"a": "itemToHand", "to": "t"}], "status": "auto"}
    if re.fullmatch(r"ターン終了時まで、目標の≪キャラクター1人≫の攻撃力に\+Xする。Xは目標に効果を発揮している、このカードと同じ名称のカードの枚数に等しい。このカードが効果を発揮した場合、≪あなたのデッキまたはダメージ置き場または捨て札置き場≫から、このカードと同じ名称のカード1枚を選び手札に加える。?", text):   # A3-25 3768 (M5a)
        return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "stackSame", "to": "t", "key": "at", "until": "turn"}, {"a": "pickZone", "zones": ["deck", "damage", "discard"], "owner": "you", "n": 1, "sel": {"sameJpAsSrc": True}, "dest": "hand"}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、目標の≪キャラクター1人≫の耐久力に\+1する。このカードが同じキャラクターに対して2枚以上効果を発揮している場合、メインフェイズ終了時まで、目標は精神ダメージを受けず、オフェンシブを得る。このカードが同じキャラクターに対して3枚以上効果を発揮している場合、メインフェイズ終了時まで、目標の攻撃力に\+1する。このカードが同じキャラクターに対して4枚以上効果を発揮している場合、メインフェイズ終了時まで、目標はガードされず、インフィニティを得る。メインフェイズ終了時に、≪このカード≫はオーナーの手札に戻る。?", text):   # A3-16 2204 (M5a)
        return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "stackSame", "to": "t", "key": "de", "until": "main", "flat": 1, "tiers": {"2": [{"key": "noDamage", "op": "grant", "value": {"mental": True}}, {"key": "skill", "op": "grant", "value": {"id": "offensive", "x": True}}], "3": [{"key": "at", "op": "add", "value": 1}], "4": [{"key": "noGuardBy", "op": "grant", "value": {}}, {"key": "skill", "op": "grant", "value": {"id": "infinity", "x": True}}]}},
            {"a": "delayed", "at": "main", "step": {"a": "selfCardToHandAny", "to": "card"}}], "status": "auto"}
    if text.rstrip("。") == "目標の≪使用宣言中のカード1枚≫を捨て札する":
        return {"target": {"kind": "item", "sel": {"kind": "set"}, "count": 1}, "steps": [{"a": "cancelItem", "to": "t"}], "status": "auto"}
    if text.rstrip("。") == "メインフェイズ終了時まで、目標の≪キャラクター1人≫は、そのオーナーだけではなく、あなたの支配キャラクターとしても扱う。あなたは、目標のアタックコスト・ガードコスト・エフェクトコストを、このキャラクターからのみ支払うことが可能。目標にカードをセットすることはできない。Xは目標の精神力に等しい。このエフェクトはあなたのターンのプロジェクトカードのタイミングでのみ使用宣言可能":   # Q#51
        return {"target": {"kind": "char", "sel": {}, "count": 1}, "x": {"targetStat": "se"}, "timing": "project", "steps": [{"a": "puppet", "to": "t", "until": "main"}], "status": "auto"}
    if text.rstrip("。") == "ターン終了時まで、≪このキャラクター≫はバインド1・インターセプト・イニシアチブ・ペネトレイトのいずれか1つを得る":   # Revise#147
        return {"steps": [{"a": "choiceGrant", "options": [{"id": "bind", "x": 1, "label": "Bind 1"}, {"id": "intercept", "label": "Intercept"}, {"id": "initiative", "label": "Initiative"}, {"id": "penetrate", "label": "Penetrate"}], "until": "turn"}], "status": "auto"}
    m = re.fullmatch(r"ターン終了時まで、≪あなた≫は(.+?)を持つブレイクカードを、ファストカードのタイミングでセット宣言可能。?", text)
    if m and class_tokens(m.group(1)): return {"steps": [{"a": "field", "mod": {"to": "you", "key": "fastBreak", "op": "grant", "value": {"icons": class_tokens(m.group(1))}, "until": "turn"}}], "status": "auto"}
    m = re.fullmatch(r"≪プレイヤー全て≫は、?自分のデッキから(プロジェクトカード|ブレイクカード|パーマネントカード|ファストカード)1枚を選び、手札に加える。?", text)   # Revise#147
    if m: return {"steps": [{"a": "eachPlayerPick", "zones": ["deck"], "sel": {"types": [CARD_TYPES_JP[m.group(1).replace("カード", "")]]}}], "status": "auto"}
    m = re.fullmatch(r"メインフェイズ終了時まで、≪(.+?)のブレイクカードのコスト≫は、オーナーの手札に戻る。?", text)   # Revise#147
    if m and class_tokens(m.group(1).replace("または", "・")): return {"steps": [{"a": "field", "mod": {"to": "you", "key": "dest", "op": "dest", "value": {"cost": "set", "type": "Break", "icons": class_tokens(m.group(1).replace("または", "・")), "to": "hand"}, "until": "main"}}], "status": "auto"}
    if text.rstrip("。") == "あなたは、目標の≪デッキ≫の上からカードを3枚見る。その後、そのカードの中からあなたの任意の枚数をそのデッキの一番下に置くことが可能。≪このエフェクトのコスト≫を手札に戻す":   # Revise#148
        return {"target": {"kind": "player", "sel": {}, "count": 1}, "steps": [{"a": "peekTopBottom", "to": "t", "n": 3}], "costTo": "hand", "status": "auto"}
    m = re.fullmatch(r"目標の≪(?:プレイヤ.?1人|デッキ)≫の(?:デッキの)?上から、?カードを(\d+)枚捨て札する。?", text)   # Revise#148
    if m: return {"target": {"kind": "player", "sel": {}, "count": 1}, "steps": [{"a": "mill", "to": "t", "n": int(m.group(1))}], "status": "auto"}
    if text.rstrip("。") == "≪プレイヤー全て≫のデッキの上から、カードをX枚捨て札する。Xはそれぞれのデッキ枚数の3分の1に等しい。その際、端数は切り捨てて判定する":
        return {"steps": [{"a": "millThird"}], "status": "auto"}
    m = re.fullmatch(r"≪あなたの任意のエリア1つのキャラクター全て≫に\((\d+)\)ダメージを与える。?(.*)", text)
    if m and (not m.group(2) or parse_body(m.group(2))["status"] == "auto"):   # + "このエフェクトはあなたのターンのプロジェクトカードのタイミングでのみ使用宣言可能" (EX868, Revise#310)
        rest = parse_body(m.group(2)) if m.group(2) else {"steps": []}
        return dict(rest, steps=[{"a": "areaDamage", "n": int(m.group(1)), "mental": True}] + rest["steps"], status="auto")
    if text.rstrip("。") == "メインフェイズ終了時まで、≪あなた≫はファストカードのタイミングでブレイクカードをセット宣言可能":
        return {"steps": [{"a": "field", "mod": {"to": "you", "key": "fastBreak", "op": "grant", "value": {}, "until": "main"}}], "status": "auto"}
    m = re.fullmatch(r"1?：?このカードを捨て札する。この効果でこのカードが捨て札になる場合、≪あなたのダメージ置き場の(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のカード1枚≫をあなたの手札に加える。?", text)
    if m: return {"steps": [{"a": "selfCardDiscard"}, {"a": "pickZone", "to": "you", "dest": "hand", "zone": "damage", "owner": "you", "sel": {"faction": FACTION_JP[m.group(1)]}, "n": 1, "upTo": False}], "status": "auto"}
    if text.rstrip("。") == "ターン終了時まで、目標の≪キャラクター1人≫はアタック宣言・ガード宣言・コストの支払いができない":   # Revise#149
        return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "mod", "to": "t", "mod": {"key": k, "op": "grant", "value": True}, "until": "turn"} for k in ("noAttack", "noGuard", "noPay")], "status": "auto"}
    m = re.fullmatch(r"≪あなたの任意の(精神攻撃力を持つ)?キャラクター1人にセットされているパワーカード全て≫を捨て札する。?", text)
    if m: return {"steps": [{"a": "pickCharPowerOff", "sel": {"atMental": True} if m.group(1) else {}}], "status": "auto"}
    if text.rstrip("。") == "≪このキャラクター以外の、このキャラクターと同じ分類を持つあなたのテリトリーのキャラクター全て≫を捨て札する":
        return {"steps": [{"a": "discard", "to": {"all": {"owner": "you", "shareIconSelf": True, "notSelf": True}}}], "status": "auto"}
    if text.startswith("目標の、≪あなたのダメージ置き場または捨て札置き場にある、コストXのゴーストを持つブレイクカード1枚≫をセット宣言する。その後、あなたのデッキからX枚を捨て札する。"):   # Q#55
        return {"target": {"kind": "card", "sel": {"types": ["Break"], "icons": ["ゴースト"], "zones": ["damage", "discard"], "owner": "you", "costX": True}, "count": 1}, "steps": [{"a": "ghostRise", "to": "t"}], "timing": "project", "status": "auto"}
    if text.rstrip("。") == "このキャラクターのアタック宣言に対してガード宣言が行われていない場合、目標の≪パワーX以下のキャラクター1人≫は、このキャラクターのアタック宣言に対してガード宣言する":
        return {"target": {"kind": "char", "sel": {"power": {"op": "<=", "n": "X"}}, "count": 1}, "steps": [{"a": "forceGuardT", "to": "t"}], "status": "auto"}
    if text.rstrip("。") == "メインフェイズ終了時まで、≪このキャラクター≫は任意の分類1つを得る":
        return {"steps": [{"a": "pickIconGrant", "until": "main"}], "status": "auto"}
    if text.rstrip("。") == "≪あなたの手札全て≫を、あなたの任意の順番であなたのデッキの一番上に置く。その後、あなたのデッキの一番下から、この効果でデッキの上に置いた枚数と同じ枚数引いて手札に加える":
        return {"steps": [{"a": "handTopDrawBottom"}], "status": "auto"}
    if text.rstrip("。") == "あなたの手札の13枚の異なるネームを持つブレイクカードを捨て札する。その後、≪あなた以外のプレイヤー全て≫に32ダメージを与える。捨て札したカードと同じネームを持つキャラクターを支配している対象には、代わりに48ダメージを与える":
        return {"steps": [{"a": "thirteenNames"}], "status": "auto"}
    if text.startswith("あなたの支配エリアの、このキャラクター以外の、このエフェクトの効果で指定されていないマシン1人を指定し、"):
        return {"steps": [{"a": "machineDesignate"}], "status": "auto"}
    if text.rstrip("。") == "≪あなたの手札のネームを持たないブレイクカード1枚≫を、このカードの下に、このキャラクターを構成するカードとしてセットする": return {"steps": [{"a": "handUnder", "unnamedBreak": True}], "status": "auto"}   # Revise#151
    if text.rstrip("。") == "≪あなたの手札にあるこのカードと同じネームを持つカード1枚≫を、このカードの下にセットする": return {"steps": [{"a": "handUnder", "sameName": True}], "status": "auto"}
    if text.rstrip("。") == "≪あなたの任意の、パーマネントカードがセットされているキャラクター1人にセットされているパワーカード全て≫を、オーナーの手札に戻す": return {"steps": [{"a": "pickCharPowerHand"}], "status": "auto"}
    if text.rstrip("。") == "ターン終了時まで、このキャラクターに次に与えられるバトルによるダメージを無効化し、そのダメージに等しいダメージを、≪このキャラクターのバトル相手≫に与える": return {"steps": [{"a": "reflectNext", "until": "turn"}], "status": "auto"}
    # ---- M2e batch 7 (Revise#152) ----
    def _xd(g): return {"x": x_def(g.rstrip("。"))} if g and x_def(g.rstrip("。")) else {}
    m = re.fullmatch(r"≪あなたの任意のエリア1つのキャラクター全て(と、プレイヤー全て)?≫に(\d+|X)ダメージを与える。?(Xは[^。]+に等しい。?)?", text)
    if m and (m.group(2) != "X" or _xd(m.group(3)) or not m.group(3)):
        return dict({"steps": [dict({"a": "areaDamage", "n": "X" if m.group(2) == "X" else int(m.group(2))}, **({"players": "all"} if m.group(1) else {}))], "status": "auto"}, **_xd(m.group(3)))
    m = re.fullmatch(r"≪あなたの任意のエリアのキャラクター全てと、あなたの任意のプレイヤー全て≫に(\d+|X)ダメージを与える。?(Xは[^。]+に等しい。?)?", text)
    if m: return dict({"steps": [{"a": "areaDamage", "n": "X" if m.group(1) == "X" else int(m.group(1)), "multi": True}], "status": "auto"}, **_xd(m.group(2)))
    m = re.fullmatch(r"≪アタックを受けたプレイヤー≫の手札から、?あなたの任意の手札(\d+|X)枚を捨て札する。(その後、≪あなた≫は捨て札した手札枚数に等しい枚数ドローする。)?(Xは[^。]+に等しい。?)?", text)
    if m: return dict({"steps": [{"a": "oppHandPickDiscard", "who": "attacked", "n": "X" if m.group(1) == "X" else int(m.group(1)), "drawSame": bool(m.group(2))}], "status": "auto"}, **_xd(m.group(3)))
    if text.rstrip("。") == "≪あなたの任意の、あなたのダメージ置き場または捨て札置き場にあるプロジェクトカード1枚≫を、あなたのデッキに戻す。その後、そのデッキをシャッフルする":
        return {"steps": [{"a": "pickZone", "zones": ["damage", "discard"], "owner": "you", "sel": {"types": ["Project"]}, "n": 1, "dest": "deckShuffle"}], "status": "auto"}
    m = re.fullmatch(r"ターン終了時まで、≪あなたの任意のエリア1つのキャラクター全て≫に(.+?)を与える。?(?:Xは[^。]+に等しい。?)?", text)
    if m and skills_list(m.group(1)): return {"steps": [{"a": "areaMod", "mod": {"key": "skill", "op": "grant", "value": skills_list(m.group(1))[0]}, "label": m.group(1), "until": "turn"}], "status": "auto"}
    m = re.fullmatch(r"≪あなた≫は、あなたの任意の枚数の、あなたの手札の(X|\d+)コスト以下のパーマネントカードを、コストを無視してあなたの支配キャラクターにセット宣言可能。?(Xは[^。]+に等しい。?)?", text)
    if m: return dict({"steps": [{"a": "effDecl", "zones": ["hand"], "types": ["Permanent"], "freeCost": True, "repeat": True, "anyChar": True, "costMax": "X" if m.group(1) == "X" else int(m.group(1))}], "status": "auto"}, **_xd(m.group(2)))
    m = re.fullmatch(r"≪あなたの任意の分類1つを持つキャラクター全て≫に(\()?(\d+)\)?ダメージを与える。?", text)   # 2904
    if m: return {"steps": [{"a": "iconPickDamage", "n": int(m.group(2)), "mental": bool(m.group(1))}], "status": "auto"}
    m = re.fullmatch(r"ターン終了時まで、目標の≪キャラクタ[ー\-]1人≫は、あなたのダメージ置き場のブレイクカード・キャラクターカードの持つスキル全てを得る。?", text)   # 2937
    if m: return {"target": parse_target("キャラクター1人")[1], "steps": [{"a": "pileSkillsGrant", "to": "t"}], "status": "auto"}
    m = re.fullmatch(r"目標の≪キャラクタ[ー\-]1人≫に(\d+)ダメージを与える。このエフェクトをあなたのターンのプロジェクトカードのタイミングで使用した場合、代わりに目標に(\d+)ダメージを与える。?", text)   # 2973
    if m: return {"target": parse_target("キャラクター1人")[1], "steps": [{"a": "damage", "to": "t", "n": int(m.group(1)), "ifProj": False}, {"a": "damage", "to": "t", "n": int(m.group(2)), "ifProj": True}], "status": "auto"}
    m = re.fullmatch(r"このエフェクトの使用宣言時に、あなたのデッキの一番上のカード1枚を、あなたのダメージ置き場に置く。≪このエフェクトのコスト≫を、(.+?)を持つ、\+(\d+)/\+\(?(\d+)\)?/\+(\d+)のパーマネントカード・(.+?)としてこのキャラクターにセットする。?", text)   # 2977
    if m and skills_list(m.group(1)): return {"costTo": "hold", "steps": [{"a": "mill", "to": "you", "n": 1, "zone": "damage"}, {"a": "costToPermToken", "token": {"name": m.group(5), "stats": {"se": int(m.group(2)), "at": int(m.group(3)), "de": int(m.group(4))}, "skills": skills_list(m.group(1))}}], "status": "auto"}
    m = re.fullmatch(r"このエフェクトの使用宣言時に、このキャラクターにセットされている(.+?)1枚を捨て札する。目標の≪プレイヤーまたはキャラクタ[ー\-]1人≫に(\d+)ダメージを与える。?", text)   # 3302
    if m: return {"steps": [{"a": "permTokenDiscard", "name": m.group(1)}, {"a": "pickAnyDamage", "n": int(m.group(2)), "ifLast": True}], "status": "auto"}
    m = re.fullmatch(r"このエフェクトの使用宣言時に、あなたのデッキの上からカードをX枚捨て札しなければ、このエフェクトは効果を発揮しない。目標の≪キャラクタ[ー\-]1人≫に、?Xダメージを与える。?(このエフェクトはあなたのターンのプロジェクトカードのタイミングでのみ使用宣言可能。?)?", text)   # 3794
    if m: return dict({"target": parse_target("キャラクター1人")[1], "steps": [{"a": "millChooseX"}, {"a": "damage", "to": "t", "n": "last", "ifLast": True}], "status": "auto"}, **({"timing": "project"} if m.group(1) else {}))
    if text.startswith("対戦終了時まで、"):   # "until the end of the game" (Revise#152)
        b2 = parse_body("ターン終了時まで、" + text[len("対戦終了時まで、"):])
        if b2["status"] == "auto" and all(x.get("until") == "turn" for x in b2["steps"] if x.get("a") == "mod"):
            return dict(b2, steps=[dict(x, until="removed") if x.get("a") == "mod" else x for x in b2["steps"]])
    m = re.fullmatch(r"ターン終了時まで、≪精神力(X|\d+)以下のキャラクター全て≫のアタック宣言・ガード宣言・エフェクトの使用宣言を無効化する。?(Xは[^。]+に等しい。?)?", text)   # 3428
    if m:
        sel = {"all": {"stat": [{"key": "se", "op": "<=", "n": "X" if m.group(1) == "X" else int(m.group(1))}]}}
        return dict({"steps": [{"a": "mod", "to": sel, "resolveX": True, "mod": {"key": k, "op": "grant", "value": True}, "until": "turn"} for k in ("noAttack", "noGuard", "noEffect")], "status": "auto"}, **({"x": x_def(m.group(2).rstrip("。"))} if m.group(2) else {}))
    # ---- Revise#354 ----
    m = re.fullmatch(r"≪あなたの任意のキャラクタ[ー\-]X体≫に(\d+)ダメージを与える。Xは100以下のあなたの任意の数に等しい。その後、このカードのコストがブレイクしている“([^”]+)”からのみ支払われていた場合、≪このカード≫を手札に戻す。?", text)   # A3-EX04 EX0455
    if m: return {"steps": [{"a": "pickDamage", "sel": {}, "count": "any", "n": int(m.group(1))}, {"a": "bounce", "to": "card", "ifPaidBy": {"name": re.sub(r"\s+", "", m.group(2)), "broken": True}}], "status": "auto"}
    m = re.fullmatch(r"≪あなたの任意のキャラクタ[ー\-]1\+X体≫に1\+Xダメージを与える。(Xは[^。]+に等しい)。?", text)   # A3-EX02 EX0120
    if m and x_def(m.group(1)): return {"steps": [{"a": "pickDamage", "sel": {}, "count": "X", "countPlus": 1, "n": "X", "nPlus": 1}], "x": x_def(m.group(1)), "status": "auto"}
    m = re.fullmatch(r"(?:“([^”]+)”が場にいる場合、このカードのコストは\d+減少する。)?≪あなたのデッキまたは捨て札置き場≫から、(.+?)1枚を選んで手札に加える。デッキから選んだ場合、その後、そのデッキをシャッフルする。?", text)   # A4-EX02 EX877
    if m and deck_pick_sel(m.group(2)) is not None: return {"steps": [{"a": "pickZone", "zones": ["deck", "discard"], "owner": "you", "n": 1, "sel": deck_pick_sel(m.group(2)), "dest": "hand"}, {"a": "shuffle", "to": "you"}], "status": "auto"}
    m = re.fullmatch(r"ターン終了時まで、≪あなた≫は、(武蔵|英国|三征西班牙|K\.P\.A\.Italia|六護式仏蘭西|M\.H\.R\.R\.|P\.A\.Oda|上越露西亜|清武田|IZUMO)を持つブレイクカードをファストカードのタイミングであなたのテリトリーのキャラクターにセット宣言可能。?", text)   # A4-EX02 EX897
    if m: return {"steps": [{"a": "field", "mod": {"to": "you", "key": "fastBreak", "op": "grant", "value": {"tag": m.group(1)}, "until": "turn"}}], "status": "auto"}
    if re.fullmatch(r"ターン終了時まで、あなたは、目標の≪あなたの支配キャラクタ.1人≫に、ファストカードのタイミングでパーマネントカードをセット宣言可能。?", text):   # A4-EX02 EX892
        return {"target": {"kind": "char", "sel": {"owner": "you", "area": "controlled"}, "count": 1}, "steps": [{"a": "mod", "to": "t", "mod": {"key": "fastPerm", "op": "grant", "value": True}, "until": "turn"}], "status": "auto"}
    if re.fullmatch(r"ターン終了時まで、≪あなた≫は、次に使用するプロジェクトカードをファストカードのタイミングで使用宣言可能。?", text):   # A4-EP EP607
        return {"steps": [{"a": "field", "mod": {"to": "you", "key": "projFastNext", "op": "grant", "value": True, "until": "turn"}}], "status": "auto"}
    m = re.fullmatch(r"ターン終了時まで、≪あなたの任意のエリア1つのキャラクター全て≫の持つ((?:[^・の]+)(?:・[^・の]+)*)のスキル全てを無効化する。?", text)   # A4-EX02 EX894
    if m and all(SKILL_JP.get(x) for x in m.group(1).split("・")): return {"steps": [{"a": "areaMod", "mods": [{"key": "skill", "op": "remove", "value": {"id": SKILL_JP[x]}} for x in m.group(1).split("・")], "label": "no " + " / ".join(SKILL_JP[x] for x in m.group(1).split("・")), "until": "turn"}], "status": "auto"}
    m = re.fullmatch(r"ターン終了時まで、≪あなたの任意のエリアのブレイクしていないキャラクター全て≫のアタックコスト・ガードコストを(\d+)上昇させる。?", text)   # A4-EX02 EX853
    if m: return {"steps": [{"a": "areaMod", "multi": True, "sel": {"broken": False}, "mods": [{"key": "attackCost", "op": "add", "value": int(m.group(1))}, {"key": "guardCost", "op": "add", "value": int(m.group(1))}], "label": "attack cost and guard cost +" + m.group(1) + " (characters that are not Broken)", "until": "turn"}], "status": "auto"}
    m = re.fullmatch(r"ターン終了時まで、目標の≪あなたの支配キャラクタ.1人≫が捨て札になる場合、あなたの対戦相手1人に(\()?(\d+)\)?ダメージを与える。?", text)   # A4-EX02 EX835
    if m: return {"target": {"kind": "char", "sel": {"owner": "you", "area": "controlled"}, "count": 1}, "steps": [{"a": "watchEv", "to": "t", "event": "leave", "when": {}, "once": True, "effect": {"steps": [{"a": "pickOppDamage", "n": int(m.group(2)), "mental": bool(m.group(1))}], "status": "auto"}, "until": "turn"}], "status": "auto"}
    m = re.fullmatch(r"(このカードはアタック宣言が行われている場合にのみ使用宣言可能。)?≪このカード≫を、勢力なし、分類・(.+?)、(.+?)を持つ、セットされた際にガード宣言可能な(\d+)/(\(?)(\d+)\)?/(\d+)のあなたの支配キャラクター、(.+?)としてセットする。?", text)   # A4-02 0283 / PR048
    if m and class_tokens(m.group(2)) and skills_list(m.group(3)):
        return dict({"steps": [{"a": "cardToken", "name": m.group(8), "stats": {"se": int(m.group(4)), "at": int(m.group(6)), "de": int(m.group(7))}, "atMental": bool(m.group(5)), "guardOnSet": True, "icons": class_tokens(m.group(2)), "skills": skills_list(m.group(3))}], "status": "auto"}, **({"declCond": {"attackDeclared": True}} if m.group(1) else {}))
    m = re.fullmatch(r"≪あなたの任意のキャラクタ[ー\-]またはプレイヤ[ー\-]1人≫に(\()?(X|\d+)\)?ダメージを与える。?(Xは[^。]+に等しい。?)?", text)   # 3574
    if m: return dict({"steps": [{"a": "pickAnyDamage", "n": "X" if m.group(2) == "X" else int(m.group(2)), "mental": bool(m.group(1))}], "status": "auto"}, **({"x": x_def(m.group(3).rstrip("。"))} if m.group(3) else {}))
    m = re.fullmatch(r"≪あなたの任意の▼を持つキャラクタ[ー\-]1人≫に(\()?(X|\d+)\)?ダメージを与える。?(Xは[^。]+に等しい。?)?", text)   # 3365
    if m: return dict({"steps": [{"a": "pickCharDamage", "sel": {"aggressive": True}, "n": "X" if m.group(2) == "X" else int(m.group(2)), "mental": bool(m.group(1))}], "status": "auto"}, **({"x": x_def(m.group(3).rstrip("。"))} if m.group(3) else {}))
    if text.rstrip("。") == "目標の≪ダメージ置き場または捨て札置き場、またはそれらにあるカードを対象とする、プロジェクトカードまたはファストカード1枚≫を捨て札する":   # 3264
        return {"target": {"kind": "item", "sel": {"types": ["Project", "Fast"], "pileActs": True}, "count": 1}, "steps": [{"a": "cancelItem", "to": "t"}, {"a": "discard", "to": "t"}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、あなたの任意のキャラクタ[ー\-]1人が捨て札になった場合、≪そのキャラクターのオーナー≫は、自分のダメージ置き場のカード1枚を手札に戻すことが可能。?", text):   # 3155
        return {"steps": [{"a": "field", "mod": {"to": {"players": "all"}, "key": "discardRecall", "op": "grant", "value": True, "until": "main"}}], "status": "auto"}
    m = re.fullmatch(r"メインフェイズ終了時まで、目標の≪キャラクタ[ー\-]1人≫の攻撃力に-X(?:・ー\(X\))?する。目標がアタックした場合、通常のダメージ判定を行わず、アタックを受けたプレイヤーのダメージ置き場にカードがX枚置かれるまでダメージ判定する。(Xは[^。]+に等しい)。?", text)   # 2938
    if m and x_def(m.group(1)): return {"target": parse_target("キャラクター1人")[1], "steps": [{"a": "stat", "to": "t", "key": "at", "n": "X", "sign": -1, "until": "main"}, {"a": "grantPlayerHitUntil", "to": "t", "until": "main"}], "x": x_def(m.group(1)), "status": "auto"}
    m = re.fullmatch(r"≪あなたのデッキ≫から、ネームに「([^」]+)」を含むブレイクカード1枚を選び、対戦相手に見せる。その後、あなたのデッキをシャッフルする。その後、そのカードをセット宣言する。?(このエフェクトはあなたのターンのプロジェクトカードのタイミングでのみ使用宣言可能。?)?", text)   # 3045
    if m: return dict({"steps": [{"a": "effDecl", "zones": ["deck"], "types": ["Break"], "nameHas": m.group(1), "anyChar": True}, {"a": "shuffle", "to": "you"}], "status": "auto"}, **({"timing": "project"} if m.group(2) else {}))
    m = re.fullmatch(r"メインフェイズ終了時まで、目標の≪キャラクタ[ー\-]1人≫の攻撃力に\+(\d+)する。または、(.+?)のいずれか1つを与える。?", text)   # 3049
    if m and skills_list(m.group(2)): return {"target": parse_target("キャラクター1人")[1], "steps": [{"a": "choiceStatOrSkill", "to": "t", "n": int(m.group(1)), "skills": [x["id"] for x in skills_list(m.group(2))], "until": "main"}], "status": "auto"}
    m = re.fullmatch(r"このエフェクトの使用宣言時に、パワーカードが1枚以上セットされているあなたの支配キャラクター全てから、1コスト以上支払う。目標の≪キャラクタ[ー\-]1人≫にXダメージを与える。Xはこの効果で支払われたコストに等しい。?(このエフェクトはあなたのターンのプロジェクトカードのタイミングでのみ使用宣言可能。?)?", text)   # 3049
    if m: return dict({"target": parse_target("キャラクター1人")[1], "steps": [{"a": "payFromEach"}, {"a": "damage", "to": "t", "n": "last", "ifLast": True}], "status": "auto"}, **({"timing": "project"} if m.group(1) else {}))
    m = re.fullmatch(r"このキャラクターにセットされているパーマネントカード1枚を捨て札する。その後、目標の≪プレイヤーまたはキャラクタ[ー\-]1人≫にXダメージを与える。Xはこの効果で捨て札したパーマネントカードの必要ファクターに等しい。?", text)   # 3122
    if m: return {"target": parse_target("プレイヤーまたはキャラクター1人")[1], "steps": [{"a": "ownPermDiscard"}, {"a": "damage", "to": "t", "n": "last", "ifLast": True}], "status": "auto"}
    m = re.fullmatch(r"≪あなたの手札またはデッキ≫から、ネームを持つ(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のブレイクカード1枚を、コストを支払わずにネームレベルでないキャラクターにセット宣言する。?", text)   # 3464
    if m: return {"steps": [{"a": "effDecl", "zones": ["hand", "deck"], "types": ["Break"], "faction": FACTION_JP[m.group(1)], "named": True, "freeCost": True, "anyChar": True}], "status": "auto"}
    m = re.fullmatch(r"目標の≪デッキ≫から(パーマネント|プロジェクト|ファスト|ブレイク|キャラクター)カード1枚を選び、そのオーナーのダメージ置き場に置く。?", text)   # 3613
    if m: return {"target": {"kind": "player", "sel": {}, "psel": {}, "count": 1}, "steps": [{"a": "deckPickToDamage", "to": "t", "types": [{"パーマネント": "Permanent", "プロジェクト": "Project", "ファスト": "Fast", "ブレイク": "Break", "キャラクター": "Character"}[m.group(1)]]}], "status": "auto"}
    if re.fullmatch(r"≪あなたの任意のダメージ置き場にあるパーマネントカード1枚≫を、そのオーナーのテリトリーのキャラクターにセットする。メインフェイズ終了時にそのパーマネントカードを捨て札し、≪そのパーマネントカードがセットされていたキャラクターとそのオーナー≫にXダメージ与える。Xはそのパーマネントカードの必要ファクターとコストの合計に等しい。?", text):   # 3613
        return {"steps": [{"a": "lendDamagePerm"}], "status": "auto"}
    m = re.fullmatch(r"≪あなたのデッキの一番上のカード1枚≫を、勢力なし、分類・(.+?)、(.+?)を持つ(\d+)/(\d+)/(\d+)のあなたの支配キャラクター、(.+?)としてセットする。≪このエフェクトのコスト≫を手札に戻す。?", text)   # 3614
    if m and skills_list(m.group(2)):
        return {"costTo": "hand", "steps": [{"a": "deckTopToken", "name": m.group(6), "icons": class_tokens(m.group(1)) or [m.group(1)], "skills": skills_list(m.group(2)), "stats": {"se": int(m.group(3)), "at": int(m.group(4)), "de": int(m.group(5))}}], "status": "auto"}
    if re.fullmatch(r"≪あなた≫は、あなたのデッキの上からカードを10枚引き、あなたのテリトリーのこのキャラクター以外のキャラクターに、パワーカードとしてセットする。その後、あなたのメインフェイズを終了する。?", text):   # 3721
        return {"steps": [{"a": "deckToOthersPower", "n": 10}, {"a": "endMyMain"}], "status": "auto"}
    m = re.fullmatch(r"このエフェクトの使用宣言時に、あなたの手札(\d+)枚を捨て札しなければ、このエフェクトは効果を発揮しない。目標の≪ガード宣言しているキャラクタ[ー\-]1人≫に、?(X|\d+)ダメージを与える。?(Xは、?[^。]+に等しい。?)?", text)   # 3572
    if m and (m.group(2) != "X" or (m.group(3) and x_def(m.group(3).rstrip("。")))):
        return dict({"target": {"kind": "char", "sel": {"guarding": True}, "count": 1}, "steps": [{"a": "discardHandN", "n": int(m.group(1))}, {"a": "damage", "to": "t", "n": "X" if m.group(2) == "X" else int(m.group(2)), "ifLast": True}], "status": "auto"}, **({"x": x_def(m.group(3).rstrip("。"))} if m.group(3) else {}))
    m = re.fullmatch(r"目標の≪効果範囲が目標の、ダメージ置き場のプロジェクトカードまたはファストカード1枚≫を、このキャラクターを目標に使用する。?(このエフェクトのコストはオーナーのダメージ置き場に置く。?)?", text)   # 0373
    if m: return dict({"costTo": "damage"} if m.group(1) else {}, **{"target": {"kind": "card", "sel": {"pileTargeted": True, "types": ["__none__"]}, "count": 1}, "steps": [{"a": "castOnSelf", "to": "t"}], "status": "auto"})
    # ---- M2g batch 2 (Revise#157) ----
    PT = r"(?:このエフェクトは、?あなたのターンのプロジェクトカードのタイミングでのみ使用宣言可能。?)?"
    m = re.fullmatch(r"メインフェイズ終了時まで、このキャラクターがプレイヤーにアタックした場合、≪このキャラクター≫の攻撃力に\+(\d+)して判定する。?", text)   # EP057
    if m: return {"steps": [{"a": "mod", "to": "self", "mod": {"key": "at", "op": "add", "value": int(m.group(1))}, "until": "main", "cond": {"attackPlayer": True}}], "status": "auto"}
    if re.fullmatch(r"このエフェクトの使用宣言時に、キャラクタ.1人を指定する。≪指定したキャラクタ.1人に対して効果を発揮しているプロジェクトカード・ファストカード全て≫を捨て札する。その後、≪指定したキャラクター≫にXダメージを与える。Xはこの効果で捨て札したプロジェクトカード・ファストカード全てのコストの合計に等しい。?", text):   # EP158
        return {"steps": [{"a": "lastingStripHit"}], "status": "auto"}
    m = re.fullmatch(r"あなたの手札からランダムに選んだカード1枚を捨て札し、あなたのデッキの一番上のカード1枚を捨て札する。この効果で捨て札したカードのカード種類が同じ場合、メインフェイズ終了時まで、≪このキャラクター≫が次にバトルまたはプレイヤーにアタックした際、攻撃力に\+(\d+)して判定する。?", text)   # EP160
    if m: return {"steps": [{"a": "matchTypeBoost", "n": int(m.group(1))}], "status": "auto"}
    if re.fullmatch(r"このエフェクトの使用宣言時に、あなたの任意の勢力1つを指定する。メインフェイズ終了時まで、次にこのキャラクターがバトルする際、≪このキャラクター≫は指定した勢力に対するレジストを得る。?", text):   # EP163
        return {"steps": [{"a": "nameFactionResist", "until": "main", "nextBattle": True}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、目標の≪あなたの支配キャラクタ.1人≫に与えられるダメージは、このキャラクターが代わりに受ける。?", text):   # EP164
        return {"target": {"kind": "char", "sel": {"owner": "you", "area": "controlled"}, "count": 1}, "steps": [{"a": "takeForT", "to": "t", "until": "main"}], "status": "auto"}
    m = re.fullmatch(r"≪あなたの手札のカード名称に「([^」]+)」を含むネームを持たないブレイクカードまたはキャラクターカード1枚≫を、あなたの支配キャラクターとしてセットする。?", text)   # EP169
    if m: return {"steps": [{"a": "pickZone", "zones": ["hand"], "owner": "you", "dest": "back", "n": 1, "sel": {"types": ["Break", "Character"], "named": False, "nameHas": m.group(1)}}], "status": "auto"}
    m = re.fullmatch(r"あなたの支配エリアの、このキャラクター以外の、カード名称に「([^」]+)」を含むキャラクター全てを捨て札する。メインフェイズ終了時まで、≪このキャラクター≫の攻撃力に\+Xする。Xはこの効果で捨て札したキャラクターの攻撃力の数値の合計に等しい。?", text)
    if m: return {"steps": [{"a": "sacrificeBoost", "nameHas": m.group(1), "until": "main"}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、≪あなた≫は、次に使用する、本来のコストがXコスト以外のプロジェクトカードまたはファストカードのコストを無視して使用宣言可能。?", text):   # EP175
        return {"steps": [{"a": "field", "mod": {"to": "you", "key": "nextFreeCard", "op": "grant", "value": {"types": ["Project", "Fast"]}, "until": "main"}}], "status": "auto"}
    m = re.fullmatch(r"≪あなたの任意のプレイヤ.1人の捨て札置き場にあるカードと同じ名称のキャラクター全て≫に、?(\d+)ダメージを与える。?(" + PT + ")", text)   # EP176
    if m: return dict({"steps": [{"a": "pileNameHit", "n": int(m.group(1))}], "status": "auto"}, **({"timing": "project"} if m.group(2) else {}))
    m = re.fullmatch(r"このエフェクトの使用宣言時に、エリア1つを指定する。ターン終了時に、≪指定したエリアのキャラクター全て≫に(\d+)ダメージを与える。?", text)   # EP182
    if m: return {"steps": [{"a": "areaDamageLater", "n": int(m.group(1)), "at": "turn"}], "status": "auto"}
    if re.fullmatch(r"≪あなた≫は1ドローする。その後、レアリティまたはエキスパンション名を1つ指定してもいいし、しなくてもよい。指定した場合、あなたのデッキの一番上のカードを公開する。この効果で公開されたカードが指定したレアリティまたはエキスパンション名に収録されているカードだった場合、そのカードを手札に加える。そうでない場合、そのカードを捨て札する。?", text):   # EP184 (Q#61: a series)
        return {"steps": [{"a": "draw", "to": "you", "n": 1}, {"a": "nameSeriesTop"}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、あなたの支配キャラクターがバトルまたはエフェクトの効果によって対戦相手の支配キャラクターを捨て札した場合、≪あなた≫は1ドローする。?", text):   # EP185
        return {"steps": [{"a": "field", "mod": {"to": "you", "key": "drawOnKill", "op": "grant", "value": {"n": 1}, "until": "main"}}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、このキャラクター以外のあなたの支配キャラクターがアタック宣言した場合、≪このキャラクター≫はコストを支払わず、同じ目標に対してアタック宣言する。アタック宣言されたプレイヤーは、このアタック宣言に対してガード宣言可能。?", text):   # EP188
        return {"steps": [{"a": "field", "mod": {"to": "you", "key": "watch", "op": "grant", "until": "main", "value": {"on": "attack", "sel": {"owner": "you"}, "effect": {"steps": [{"a": "followAttackQueue"}], "status": "auto"}}}}], "status": "auto"}
    m = re.fullmatch(r"≪あなたのデッキの一番上のカード1枚≫を、勢力(ダークロア|E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|極星帝国|イレイザー)、(.+?)の、アビリティ「このキャラクターがプレイヤーにアタックした場合、アタックを受けたプレイヤーの支配キャラクター全てにセットされているパワーカードから、≪あなたの任意のパワーカード1枚ずつ≫を捨て札する。?」を持つ(\d+)/(\d+)/(\d+)のあなたの支配キャラクター、(.+?)としてセットする。?", text)   # EP179
    if m: return {"steps": [{"a": "deckTopToken", "name": m.group(6), "faction": FACTION_JP[m.group(1)], "icons": class_tokens(m.group(2)) or [m.group(2)], "stats": {"se": int(m.group(3)), "at": int(m.group(4)), "de": int(m.group(5))}, "watch": {"on": "attack", "toPlayer": True, "effect": {"steps": [{"a": "attackedPowerStrip"}], "status": "auto"}}}], "status": "auto"}
    # ---- M2g batch 5 (Revise#157) ----
    m = re.fullmatch(r"このエフェクトの使用宣言時に、あなたの任意のキャラクタ.1人を指定する。メインフェイズ終了時まで、≪このキャラクター≫は指定したキャラクターの持つスキル、エフェクト全てを得る。?(このエフェクトは1ターンに1度しか使用宣言できない。?)?", text)   # EX0021
    if m: return dict({"target": {"kind": "char", "sel": {"notSelf": True}, "count": 1}, "steps": [{"a": "gainCard", "to": "t", "until": "main"}], "status": "auto"}, **({"oncePerTurn": True} if m.group(1) else {}))
    if re.fullmatch(r"メインフェイズ終了時まで、≪精神力X以下のブレイクしていないキャラクター全て≫のアタック宣言・ガード宣言を無効化する。?", text):   # EX0024
        sel = {"all": {"stat": [{"key": "se", "op": "<=", "n": "X"}], "broken": False}}
        return {"steps": [{"a": "mod", "to": sel, "resolveX": True, "mod": {"key": "noAttack", "op": "grant", "value": True}, "until": "main"}, {"a": "mod", "to": sel, "resolveX": True, "mod": {"key": "noGuard", "op": "grant", "value": True}, "until": "main"}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、目標の≪キャラクタ.1人≫は、アタック宣言・ガード宣言・エフェクトの使用宣言をすることができない。?", text):   # EX0101
        return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "mod", "to": "t", "mod": {"key": k, "op": "grant", "value": True}, "until": "main"} for k in ("noAttack", "noGuard", "noEffect")], "status": "auto"}
    m = re.fullmatch(r"目標の≪勢力キャラクタ.1人≫に、?(\d+)ダメージを与える。?", text)   # EX0188
    if m: return {"target": {"kind": "char", "sel": {"hasFaction": True}, "count": 1}, "steps": [{"a": "damage", "to": "t", "n": int(m.group(1)), "mental": False}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、このキャラクターは、≪あなたの任意のキャラクタ.1人≫を目標にアタック宣言可能。?", text):   # EX0195
        return {"steps": [{"a": "designateAttackable", "n": 1, "any": True, "selfOnly": True}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、≪このキャラクター≫に次に与えられるダメージを無効化する。?", text):   # EX0182
        return {"steps": [{"a": "negateNextDamage", "until": "main"}], "status": "auto"}
    m = re.fullmatch(r"このキャラクターに「([^」]+)」がセットされていない場合、≪あなたの手札の「\1」1枚≫をこのキャラクターにセットする。?", text)   # EX0146
    if m: return {"steps": [{"a": "handJpOntoSelf", "jp": re.sub(r"\s+", "", m.group(1))}], "status": "auto"}
    # ---- M3b … M3f (Revise#164) ----
    m = re.fullmatch(r"≪あなたのデッキ≫から、?((?:[^、。≪≫]+?)(?:・[^、。≪≫]+?)*)を持つカード(\d+)枚を選び、手札に加える。?", text)   # A3-25 3618 (Revise#164)
    if m and class_tokens(m.group(1)) and len(class_tokens(m.group(1))) == len(m.group(1).split("・")):
        return {"steps": [{"a": "pickZone", "zone": "deck", "owner": "you", "n": int(m.group(2)), "sel": {"icons": class_tokens(m.group(1))}, "dest": "hand"}, {"a": "shuffle", "to": "you"}], "status": "auto"}
    m = re.fullmatch(r"≪あなたのデッキ≫から、?コスト(X|\d+)以下のブレイクカード1枚を、?コストを支払わずにセット宣言する。?", text)   # A3-24 3399 (Revise#165)
    if m: return {"steps": [{"a": "effDecl", "zones": ["deck"], "types": ["Break"], "costMax": "X" if m.group(1) == "X" else int(m.group(1)), "freeCost": True, "anyChar": True}, {"a": "shuffle", "to": "you"}], "status": "auto"}
    m = re.fullmatch(r"目標の≪プレイヤ.1人≫の手札から、?あなたの任意の(?:カード|手札)(\d+)枚を捨て札する。?", text)   # A3-21 3091
    if m: return {"target": {"kind": "player", "sel": {}, "count": 1, "psel": {}}, "steps": [{"a": "handPickT", "to": "t", "n": int(m.group(1))}], "status": "auto"}
    if re.fullmatch(r"≪あなたの任意のキャラクタ.1人にセットされているカード全て≫を捨て札する。?", text): return {"steps": [{"a": "pickCharSetCards"}], "status": "auto"}   # A3-21 3019
    if re.fullmatch(r"≪キャラクター全てにセットされているパワーカード1枚ずつ≫を捨て札する。?", text):   # A3-21 3019 (Revise#165)
        return {"steps": [{"a": "charsPowerOneEach", "all": True}], "status": "auto"}
    if re.fullmatch(r"キャラクター全てにセットされているパワーカードから、≪あなたの任意のパワーカード1枚ずつ≫を、そのオーナーの手札に戻す。?", text):   # A3-24 3470
        return {"steps": [{"a": "charsPowerOneEach", "all": True, "dest": "hand"}], "status": "auto"}
    m = re.fullmatch(r"≪あなたのデッキ≫から、?(?:あなたの任意の)?(.+?)(\d+|X)枚を選び、対戦相手に見せる。その後、そのカード(?:全て)?を(?:あなたの)?手札に加える。その後、あなたのデッキをシャッフルする。?(Xは[^。]+に等しい。?)?", text)   # A3-06 0933 / A3-11 1635 / A3-19 2524
    if m and deck_pick_sel(m.group(1)) is not None and (m.group(2) != "X" or (m.group(3) and x_def(m.group(3).rstrip("。")))):
        return dict({"steps": [{"a": "pickZone", "zone": "deck", "owner": "you", "n": "X" if m.group(2) == "X" else int(m.group(2)), "sel": deck_pick_sel(m.group(1)), "dest": "hand"}, {"a": "shuffle", "to": "you"}], "status": "auto"}, **({"x": x_def(m.group(3).rstrip("。"))} if m.group(3) else {}))
    m = re.fullmatch(r"≪精神力X以下のキャラクター全てと、そのキャラクターにセットされているカード全て≫を、そのオーナーのデッキに戻し、そのデッキをシャッフルする。(Xは[^。]+に等しい)。?", text)   # A3-06 0981
    if m and x_def(m.group(1)): return {"steps": [{"a": "charsToDeckSel", "sel": {"stat": [{"key": "se", "op": "<=", "n": "X"}]}}], "x": x_def(m.group(1)), "status": "auto"}
    if re.fullmatch(r"≪全てのプレイヤー≫は、Xドローする。Xはそれぞれのダメージ置き場のカード枚数に等しい。?", text):   # A3-07 1027
        return {"steps": [{"a": "drawEachDamage"}], "status": "auto"}
    if re.fullmatch(r"≪(?:全てのプレイヤー|プレイヤー全て)≫は、?Xドローする。Xはそれぞれの支配キャラクターの数に等しい。?", text):   # A3-24 3436 (Revise#166)
        return {"steps": [{"a": "drawEachDamage", "what": "controlled"}], "status": "auto"}
    if re.fullmatch(r"≪パワーカードをセットされているキャラクター全て≫から、あなたの任意のパワーカード1枚ずつを捨て札する。?", text):   # A3-07 1028
        return {"steps": [{"a": "charsPowerOneEach", "all": True}], "status": "auto"}
    if re.fullmatch(r"目標の≪パワー0のキャラクター1人≫を、目標のオーナーの勢力エリアにある、目標の勢力の勢力パーティの一番下に移動させる。?", text):   # A3-07 1031
        return {"target": {"kind": "char", "sel": {"power": {"op": "=", "n": 0}}, "count": 1}, "steps": [{"a": "toPartyBottom", "to": "t"}], "status": "auto"}
    m = re.fullmatch(r"メインフェイズ終了時まで、目標の≪あなたの支配キャラクター1人≫に(.+?)を与える。メインフェイズ終了時まで、目標がアタックした場合、あなたは(\d+)ドローする。?", text)   # A3-07 1067
    if m and skills_list(m.group(1)):
        return {"target": {"kind": "char", "sel": {"owner": "you", "area": "controlled"}, "count": 1}, "steps": [{"a": "mod", "to": "t", "mod": {"key": "skill", "op": "grant", "value": x}, "until": "main"} for x in skills_list(m.group(1))]
                + [{"a": "watchOnTarget", "to": "t", "on": ["attack"], "effect": {"steps": [{"a": "draw", "to": "you", "n": int(m.group(2))}], "status": "auto"}, "until": "main"}], "status": "auto"}
    # ---- M3a batch 4 (Revise#161) ----
    if re.fullmatch(r"メインフェイズ終了時まで、≪ブレイクしているあなたの支配キャラクター全て≫は、ブレイクしていないキャラクターとのバトルによるダメージを受けない。メインフェイズ終了時まで、対象がバトルする際、対象の攻撃力に\+Xして判定する。?", text):   # A3-03 0591
        grp = {"all": {"broken": True, "owner": "you", "area": "controlled"}}
        return {"steps": [{"a": "mod", "to": grp, "mod": {"key": "noDamage", "op": "grant", "value": {"battle": True, "fromSel": {"broken": False}}}, "until": "main"},
                          {"a": "mod", "to": grp, "mod": {"key": "at", "op": "add", "value": {"xvar": True, "sign": 1}}, "cond": {"self": "inBattle"}, "until": "main"}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、≪あなたの任意のイレイザーのキャラクタ.X体≫に-X/-X/±0する。メインフェイズ終了時まで、対象はガード宣言・エフェクトの使用宣言をすることができない。?", text):   # A3-05 0871
        return {"steps": [{"a": "pickCharsMods", "sel": {"faction": "Eraser"}, "n": "X", "until": "main", "mods": [{"key": "se", "xSign": -1}, {"key": "at", "xSign": -1}, {"key": "noGuard"}, {"key": "noEffect"}]}], "status": "auto"}
    if re.fullmatch(r"パワーカードフェイズ終了時まで、≪あなたの任意のあなたの支配キャラクタ.X体≫はプロジェクトカードの効果を受けず、カードをセットすることができない。?", text):   # A3-02 0422
        return {"steps": [{"a": "pickCharsMods", "sel": {"owner": "you", "area": "controlled"}, "n": "X", "until": "charge", "mods": [{"key": "untargetable", "value": {"from": ["Project"]}}, {"key": "noSetOn"}]}], "status": "auto"}
    # ---- M2g final (Revise#161) ----
    if re.fullmatch(r"目標の≪あなたの対戦相手の支配キャラクタ.1人≫はこのキャラクターとバトルを行う。?(?:このエフェクトは、?あなたのターンのプロジェクトカードのタイミングでのみ使用宣言可能。?)?", text):   # EX0136
        return dict({"target": {"kind": "char", "sel": {"owner": "opp", "area": "controlled"}, "count": 1}, "steps": [{"a": "forceBattle", "to": "t"}], "status": "auto"}, **({"timing": "project"} if "プロジェクトカードのタイミング" in text else {}))
    m = re.fullmatch(r"≪このエフェクトのコスト≫を、このキャラクターに、パーマネントカード・(.+?)としてセットする。(.+?)をセットされているキャラクターは、([±+\-]\d+)/\+X/([±+\-]\d+)され、(.+?)を持つ。Xはこのキャラクターにセットされている\1の数に等しい。?", text)   # EX0192
    if m and skills_list(m.group(5)):
        once = {"stats": {k: v for k, v in (("se", sign_n(m.group(3))), ("de", sign_n(m.group(4)))) if v}, "skills": skills_list(m.group(5))}
        return {"steps": [{"a": "costToPermToken", "token": {"name": m.group(1), "stats": {"at": 1}, "skills": [], "once": once}}], "costTo": "hold", "status": "auto"}
    # ---- M3a batch 3: Fast A3-01 … A3-05 (Revise#159) ----
    XD = r"(?:(Xは[^。]+に等しい)。?)?"
    def _xd(g): return {"x": x_def(g)} if g and x_def(g) else {}
    STATS3 = r"([±+\-ー]\(?(?:\d+|X)\)?(?:・[+\-ー]\(?(?:\d+|X)\)?)?)/([±+\-ー]\(?(?:\d+|X)\)?(?:・[+\-ー]\(?(?:\d+|X)\)?)?)/([±+\-ー]\(?(?:\d+|X)\)?(?:・[+\-ー]\(?(?:\d+|X)\)?)?)"
    def _st(g):   # "+X・+(X)" → normal or mental: the first part counts; "-X" → ("X", -1)
        g = g.split("・")[0].replace("ー", "-")
        return sign_n(g)
    m = re.fullmatch(r"(ターン終了時まで|メインフェイズ終了時まで|パワーカードフェイズ終了時まで)、目標の(?:≪あなたの支配キャラクタ.1人≫|、あなたの≪支配キャラクタ.1人≫)に" + STATS3 + r"する。?" + XD, text)   # A3-01 0165 / A3-02 0239 / 0308
    if m:
        unt = {"ターン終了時まで": "turn", "メインフェイズ終了時まで": "main", "パワーカードフェイズ終了時まで": "charge"}[m.group(1)]
        st = []
        for k, i in (("se", 2), ("at", 3), ("de", 4)):
            v = _st(m.group(i))
            if v in (0, None): continue
            st.append({"a": "mod", "to": "t", "mod": {"key": k, "op": "add", "value": {"xvar": True, "sign": v[1]} if isinstance(v, tuple) else v}, "until": unt})
        return dict({"target": {"kind": "char", "sel": {"owner": "you", "area": "controlled"}, "count": 1}, "steps": st, "status": "auto"}, **_xd(m.group(5)))
    m = re.fullmatch(r"メインフェイズ終了時まで、≪プロジェクトカード・ファストカード・パーマネントカード≫のコストはX上昇する。Xはそのカードの必要ファクターに等しい。?", text)   # A3-02 0240
    if m: return {"steps": [{"a": "field", "mod": {"to": {"players": "all"}, "key": "cardCost", "op": "add", "value": {"byFactor": True, "sel": {"types": ["Project", "Fast", "Permanent"]}}, "until": "main"}}], "status": "auto"}
    if re.fullmatch(r"パワーカードフェイズ終了時まで、≪コストを支払ったキャラクター≫の持つスキル全てを無効化する。?", text):   # A3-02 0242
        return {"steps": [{"a": "field", "mod": {"to": {"players": "all"}, "key": "payNegateSkills", "op": "grant", "value": True, "until": "charge"}}], "status": "auto"}
    m = re.fullmatch(r"メインフェイズ終了時まで、≪(パワー0でない|精神力(X|\d+)以下の)キャラクター全て≫のアタック宣言・ガード宣言・エフェクトの使用宣言は無効化される。?(?:メインフェイズ終了時に、このカードはオーナーのダメージ置き場に置かれる。?)?" + XD, text)   # A3-02 0243 / A3-03 0489
    if m:
        sel = {"power": {"op": ">=", "n": 1}} if m.group(1).startswith("パワー") else {"stat": [{"key": "se", "op": "<=", "n": "X" if m.group(2) == "X" else int(m.group(2))}]}
        st = [{"a": "field", "storeX": True, "mod": {"to": {"players": "all"}, "key": "noActSel", "op": "grant", "value": {"sel": sel}, "until": "main"}}]
        if "このカードはオーナーのダメージ置き場に置かれる" in text: st.append({"a": "delayed", "at": "main", "step": {"a": "selfCardToDamage", "to": "card"}})
        return dict({"steps": st, "status": "auto"}, **_xd(m.group(3)))
    if re.fullmatch(r"メインフェイズ終了時まで、対戦相手の支配キャラクターからコストが支払われた場合、≪あなた≫はそのコストに等しい枚数をドローする。?", text):   # A3-02 0277
        return {"steps": [{"a": "field", "mod": {"to": "you", "key": "drawOnOppPay", "op": "grant", "value": True, "until": "main"}}], "status": "auto"}
    if re.fullmatch(r"≪パーマネントカードをセットされているキャラクター全てにセットされているカード全て≫を捨て札する。?", text):   # A3-02 0310
        return {"steps": [{"a": "permHoldersStrip"}], "status": "auto"}
    if re.fullmatch(r"目標の≪使用宣言されているプロジェクトカード1枚≫をオーナーの手札に戻す。?", text):   # A3-02 0345
        return {"target": {"kind": "item", "sel": {"types": ["Project"]}, "count": 1}, "steps": [{"a": "bounceItem", "to": "t"}], "status": "auto"}
    m = re.fullmatch(r"≪(X|\d+)以下のコストのプロジェクトカード全て≫を捨て札する。その後、あなたのデッキの上から(X|\d+)枚引き、捨て札する。?" + XD, text)   # A3-02 0385
    if m: return dict({"steps": [{"a": "discardProjCostLe"}, {"a": "mill", "to": "you", "n": "X" if m.group(2) == "X" else int(m.group(2))}], "status": "auto"}, **_xd(m.group(3)))
    m = re.fullmatch(r"メインフェイズ終了時まで、≪アタック宣言またはガード宣言したキャラクター全て≫に(X|\d+)ダメージを与える。?" + XD, text)   # A3-02 0386
    if m:
        w = lambda on: {"a": "field", "storeX": True, "mod": {"to": "you", "key": "watch", "op": "grant", "until": "main", "value": {"on": on, "sel": {}, "effect": {"steps": [{"a": "damage", "to": "evCh", "n": "X" if m.group(1) == "X" else int(m.group(1))}], "status": "auto"}}}}
        return dict({"steps": [w("attack"), w("guard")], "status": "auto"}, **_xd(m.group(2)))
    m = re.fullmatch(r"目標の≪([^≫]*?)キャラクタ.1人≫にセットされているパワーカード(\d+)枚を、?(?:その)?オーナーの手札に戻す。?", text)   # A4-PR PR149 (Revise#310)
    if m and (m.group(1) == "" or parse_selector(m.group(1)) is not None): return {"target": {"kind": "char", "sel": parse_selector(m.group(1)) if m.group(1) else {}, "count": 1}, "steps": [{"a": "powerPickDiscardT", "to": "t", "n": int(m.group(2)), "dest": "hand"}], "status": "auto"}
    m = re.fullmatch(r"目標の≪([^≫]+?)キャラクタ.1人≫にセットされているパワーカードから、あなたの任意の(\d+|X)枚を、?そのオーナーの(ダメージ置き場に置く|手札に戻す)。?" + XD, text)   # A3-03 0454 / A3-04 0666
    if m and parse_selector(m.group(1)) is not None: return dict({"target": {"kind": "char", "sel": parse_selector(m.group(1)), "count": 1}, "steps": [{"a": "powerPickDiscardT", "to": "t", "n": "X" if m.group(2) == "X" else int(m.group(2)), "dest": "damage" if "ダメージ" in m.group(3) else "hand"}], "status": "auto"}, **_xd(m.group(4)))
    if re.fullmatch(r"目標の≪キャラクタ.1人≫にセットされているパワーカードから、あなたの任意のX枚を、そのオーナーの手札に戻す。?", text):
        return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "powerPickDiscardT", "to": "t", "n": "X", "dest": "hand"}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、目標の≪あなたの支配キャラクタ.1人≫と、目標にセットされているカード全ては、プロジェクトカード・エフェクトの効果を受けない。メインフェイズ終了時まで、目標にシールドを与える。?", text):   # A3-03 0521
        return {"target": {"kind": "char", "sel": {"owner": "you", "area": "controlled"}, "count": 1}, "steps": [{"a": "mod", "to": "t", "mod": {"key": "untargetable", "op": "grant", "value": {"from": ["Project", "Effect"]}}, "until": "main"}, {"a": "mod", "to": "t", "mod": {"key": "skill", "op": "grant", "value": {"id": "shield", "x": True}}, "until": "main"}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、目標の≪あなたの支配キャラクタ.1人≫はバトルによるダメージを受けない。メインフェイズ終了時まで、目標にインターセプトを与える。メインフェイズ終了時に、目標は捨て札される。?", text):   # A3-03 0522
        return {"target": {"kind": "char", "sel": {"owner": "you", "area": "controlled"}, "count": 1}, "steps": [{"a": "mod", "to": "t", "mod": {"key": "noDamage", "op": "grant", "value": {"battle": True}}, "until": "main"}, {"a": "mod", "to": "t", "mod": {"key": "skill", "op": "grant", "value": {"id": "intercept", "x": True}}, "until": "main"}, {"a": "delayed", "at": "main", "step": {"a": "discard", "to": "t"}}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、目標の≪あなたの支配キャラクタ.1人≫に与えられたダメージは、目標の代わりにあなたが受ける。?", text):   # A3-03 0563
        return {"target": {"kind": "char", "sel": {"owner": "you", "area": "controlled"}, "count": 1}, "steps": [{"a": "mod", "to": "t", "mod": {"key": "dmgToOwner", "op": "grant", "value": {"all": True}}, "until": "main"}], "status": "auto"}
    m = re.fullmatch(r"あなたの任意のあなたの手札(X|\d+)枚を捨て札する。ターン終了時に、あなたは(X|\d+)ドローする。?" + XD, text)   # A3-03 0564
    if m: return dict({"steps": [{"a": "pickZone", "zones": ["hand"], "owner": "you", "dest": "discard", "n": "X" if m.group(1) == "X" else int(m.group(1))}, {"a": "delayed", "at": "turn", "step": {"a": "draw", "to": "you", "n": "X" if m.group(2) == "X" else int(m.group(2))}}], "status": "auto"}, **_xd(m.group(3)))
    if re.fullmatch(r"メインフェイズ終了時まで、≪プレイヤーにアタックしたキャラクター≫に、ダメージ判定の後、そのキャラクターの攻撃力に等しいダメージを与える。?", text):   # A3-03 0597
        return {"steps": [{"a": "field", "mod": {"to": {"players": "all"}, "key": "selfHitAfterPlayer", "op": "grant", "value": True, "until": "main"}}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、プロジェクトカードまたはファストカードが効果を発揮する場合、≪そのカードのオーナー≫にXダメージを与える。Xはそのカードのコストに等しい。?", text):   # A3-03 0629
        return {"steps": [{"a": "field", "mod": {"to": {"players": "all"}, "key": "resolveHit", "op": "grant", "value": True, "until": "main"}}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、目標の≪キャラクタ.1人≫がアタック宣言またはガード宣言した場合、目標にセットされているパワーカード全てを、そのオーナーの手札に戻す。?", text):   # A3-04 0642
        w = lambda on: {"a": "field", "mod": {"to": "you", "key": "watch", "op": "grant", "until": "main", "value": {"on": on, "sel": {"chIs": "TARGET"}, "effect": {"steps": [{"a": "powerToOwnerHandT", "to": "evCh"}], "status": "auto"}}}}
        return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "watchOnTarget", "on": ["attack", "guard"], "effect": {"steps": [{"a": "powerToOwnerHandT", "to": "evCh"}], "status": "auto"}, "until": "main"}], "status": "auto"}
    m = re.fullmatch(r"メインフェイズ終了時まで、≪パワー0のキャラクター≫のアタック宣言を取り消す。メインフェイズ終了時まで、≪パワー0のキャラクター≫のスキル全てとエフェクト全てを無効化する。?", text)   # A3-04 0678
    if m: return {"steps": [{"a": "field", "mod": {"to": {"players": "all"}, "key": "noActSel", "op": "grant", "value": {"sel": {"power": {"op": "=", "n": 0}}, "kinds": ["noAttack"]}, "until": "main"}}, {"a": "field", "mod": {"to": {"players": "all"}, "key": "negateSel", "op": "grant", "value": {"sel": {"power": {"op": "=", "n": 0}}}, "until": "main"}}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、≪キャラクター全てのエフェクト全て≫を無効化する。?", text):   # A3-05 0766
        return {"steps": [{"a": "field", "mod": {"to": {"players": "all"}, "key": "negateSel", "op": "grant", "value": {"sel": {}, "effectsOnly": True}, "until": "main"}}], "status": "auto"}
    m = re.fullmatch(r"メインフェイズ終了時まで、目標の≪キャラクタ.1人≫の攻撃力に-X(?:・ー\(X\))?する。(Xは[^。]+に等しい)。メインフェイズ終了時に、このカードをあなたのダメージ置き場に置く。?", text)   # A3-05 0767
    if m and x_def(m.group(1)): return {"target": {"kind": "char", "sel": {}, "count": 1}, "x": x_def(m.group(1)), "steps": [{"a": "mod", "to": "t", "mod": {"key": "at", "op": "add", "value": {"xvar": True, "sign": -1}}, "until": "main"}, {"a": "delayed", "at": "main", "step": {"a": "selfCardToDamage", "to": "card"}}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、プレイヤーが支配キャラクターのアタックを受けた場合、≪そのプレイヤー≫は、通常のダメージ判定を行わず、Xドローする。Xはアタックしたキャラクターの攻撃力の数値に等しい。?", text):   # A3-05 0768
        return {"steps": [{"a": "field", "mod": {"to": {"players": "all"}, "key": "attackDrawInstead", "op": "grant", "value": True, "until": "main"}}], "status": "auto"}
    m = re.fullmatch(r"メインフェイズ終了時まで、目標の≪キャラクタ.1人≫のアタック宣言に対してガード宣言するか、目標にガード宣言されたキャラクターに、ただちに\((X|\d+)\)ダメージを与える。" + XD, text)   # A3-05 0808
    if m: return dict({"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "mod", "to": "t", "resolveX": True, "mod": {"key": "guardHit", "op": "grant", "value": {"n": "X" if m.group(1) == "X" else int(m.group(1)), "noOwner": True, "mental": True}}, "until": "main"}], "status": "auto"}, **_xd(m.group(2)))
    if re.fullmatch(r"メインフェイズ終了時まで、≪アタック宣言またはガード宣言したキャラクター≫にセットされているパワーカード全てを捨て札する。?", text):   # A3-05 0842
        w = lambda on: {"a": "field", "mod": {"to": "you", "key": "watch", "op": "grant", "until": "main", "value": {"on": on, "sel": {}, "effect": {"steps": [{"a": "powerDiscard", "to": "evCh"}], "status": "auto"}}}}
        return {"steps": [w("attack"), w("guard")], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、目標の≪キャラクタ.1人≫が、アタック宣言に対してガード宣言された場合、目標のアタック宣言を取り消す。?", text):   # A3-05 0874
        return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "mod", "to": "t", "mod": {"key": "cancelIfGuarded", "op": "grant", "value": True}, "until": "main"}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、≪勢力キャラクター全て≫に▼・ステルスを与える。?", text):   # A3-02 0417
        return {"steps": [{"a": "mod", "to": {"all": {"hasFaction": True}}, "mod": {"key": "skill", "op": "grant", "value": {"id": k, "x": True}}, "until": "main"} for k in ("aggressive", "stealth")], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、目標の≪あなたの支配キャラクタ.1人≫は、X以下のダメージ・\(X\)以下のダメージを受けない。メインフェイズ終了時まで、目標は、X以下のコストのプロジェクトカードの効果を受けない。Xは目標のキャラクターのパワーに等しい。?", text):   # A3-01 0030
        return {"target": {"kind": "char", "sel": {"owner": "you", "area": "controlled"}, "count": 1}, "steps": [{"a": "mod", "to": "t", "mod": {"key": "noDamage", "op": "grant", "value": {"maxX": {"power": "self"}}}, "until": "main"}, {"a": "mod", "to": "t", "mod": {"key": "untargetable", "op": "grant", "value": {"from": ["Project"], "costMaxPower": True}}, "until": "main"}], "status": "auto"}
    # ---- M3a batch 2: Project A3-01 … A3-05 (Revise#159) ----
    XD = r"(?:(Xは[^。]+に等しい)。?)?"
    def _xd(g): return {"x": x_def(g)} if g and x_def(g) else {}
    m = re.fullmatch(r"メインフェイズ終了時まで、≪支配キャラクター≫からコストが支払われた場合、そのキャラクターからパワーカード(X|\d+)枚を捨て札しなければ、そのキャラクターは捨て札される。?" + XD, text)   # A3-01 0026
    if m: return dict({"steps": [{"a": "field", "resolveN": True, "mod": {"to": {"players": "all"}, "key": "payDoom", "op": "grant", "value": {"n": "X" if m.group(1) == "X" else int(m.group(1))}, "until": "main"}}], "status": "auto"}, **_xd(m.group(2)))
    m = re.fullmatch(r"メインフェイズ終了時まで、≪(パワーが精神力に等しい)キャラクター≫からコストを支払うことはできない。?", text)   # A3-01 0061
    if m: return {"steps": [{"a": "field", "mod": {"to": {"players": "all"}, "key": "noPaySel", "op": "grant", "value": {"powerEqMental": True}, "until": "main"}}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、≪プレイヤー全て≫は、ブレイクしていないキャラクターからコストを支払うことができない。?", text):   # A3-02 0303
        return {"steps": [{"a": "field", "mod": {"to": {"players": "all"}, "key": "noPaySel", "op": "grant", "value": {"broken": False}, "until": "main"}}], "status": "auto"}
    m = re.fullmatch(r"目標の≪あなたの捨て札置き場のブレイクカード1枚≫を、あなたのテリトリーのキャラクターにセットする。必要ファクター・分類・ネーム・ブレイク条件は満たしていなければならない。その後、あなたのデッキの上からX枚引き、目標のブレイクカードをセットしたキャラクターに、パワーカードとしてセットする。" + XD, text)   # A3-01 0093
    if m: return {"target": {"kind": "card", "sel": {"types": ["Break"], "zones": ["discard"], "owner": "you"}, "count": 1}, "steps": [{"a": "targetBreakSetPower", "to": "t"}], "status": "auto"}
    m = re.fullmatch(r"≪あなたの任意の、キャラクタ.1人にセットされているパワーカード(\d+)枚まで≫を捨て札する。?", text)   # A3-01 0128
    if m: return {"steps": [{"a": "pickCharPowerDiscardX", "nFixed": int(m.group(1))}], "status": "auto"}
    m = re.fullmatch(r"メインフェイズ終了時まで、≪(X|\d+)以下のコストのファストカード全て≫を無効化する。?" + XD, text)   # A3-02 0269
    if m: return dict({"steps": [{"a": "field", "resolveN": True, "mod": {"to": {"players": "all"}, "key": "banFastCost", "op": "grant", "value": {"n": "X" if m.group(1) == "X" else int(m.group(1))}, "until": "main"}}], "status": "auto"}, **_xd(m.group(2)))
    m = re.fullmatch(r"≪あなたの任意の、あなたのダメージ置き場のカード(X|\d+)枚≫をあなたの手札に戻す。その後、≪このカードのコスト≫をあなたのダメージ置き場に置く。?" + XD, text)   # A3-02 0305
    if m: return dict({"steps": [{"a": "pickZone", "zones": ["damage"], "owner": "you", "dest": "hand", "n": "X" if m.group(1) == "X" else int(m.group(1))}], "costTo": "damage", "status": "auto"}, **_xd(m.group(2)))
    m = re.fullmatch(r"≪あなたの任意のキャラクタ.(X|\d+)体にセットされている、あなたの任意のパワーカード1枚ずつ≫を捨て札する。?" + XD, text)   # A3-02 0337
    if m: return dict({"steps": [{"a": "charsPowerOneEach", "n": "X" if m.group(1) == "X" else int(m.group(1))}], "status": "auto"}, **_xd(m.group(2)))
    if re.fullmatch(r"パワーカードをセットされているキャラクター全てにセットされているパワーカードから、≪あなたの任意のパワーカード1枚ずつ≫を、そのオーナーのデッキに戻し、デッキをシャッフルする。?", text):   # A3-02 0338
        return {"steps": [{"a": "charsPowerOneEach", "all": True, "dest": "deckShuffle"}], "status": "auto"}
    m = re.fullmatch(r"このカードのコストをダメージ置き場に置く。その後、≪あなた≫は(X|\d+)ドローする。?" + XD, text)   # A3-02 0380
    if m: return dict({"steps": [{"a": "draw", "to": "you", "n": "X" if m.group(1) == "X" else int(m.group(1))}], "costTo": "damage", "status": "auto"}, **_xd(m.group(2)))
    if re.fullmatch(r"≪あなたの対戦相手全てのダメージ置き場のカード全て≫を捨て札する。?", text):   # A3-02 0382
        return {"steps": [{"a": "oppPilesWipe"}], "status": "auto"}
    m = re.fullmatch(r"≪あなたの手札全てとあなたのテリトリーのキャラクター全て≫をあなたのデッキに戻し、そのデッキをシャッフルする。その後、あなたは(X|\d+)ドローする。?" + XD, text)   # A3-02 0416
    if m: return dict({"steps": [{"a": "handAndCharsToDeck"}, {"a": "draw", "to": "you", "n": "X" if m.group(1) == "X" else int(m.group(1))}], "status": "auto"}, **_xd(m.group(2)))
    m = re.fullmatch(r"目標の≪([^≫]+?)キャラクタ.1人≫にセットされているパワーカードから、あなたの任意のカードを(\d+)枚まで捨て札する。?", text)   # A3-03 0449 / 0482 / 0515 / 0557
    if m and parse_selector(m.group(1)) is not None: return {"target": {"kind": "char", "sel": parse_selector(m.group(1)), "count": 1}, "steps": [{"a": "powerPickDiscardT", "to": "t", "n": int(m.group(2)), "upTo": True}], "status": "auto"}
    m = re.fullmatch(r"メインフェイズ終了時まで、≪あなたの任意の勢力1つの、精神力(X|\d+)以下のキャラクター全て≫の(精神力|攻撃力|耐久力)に([+\-]\d+)する。?" + XD, text)   # A3-03 0450
    if m: return dict({"steps": [{"a": "factionPickMod", "sel": {"stat": [{"key": "se", "op": "<=", "n": "X" if m.group(1) == "X" else int(m.group(1))}]}, "key": STAT_JP[m.group(2)], "n": sign_n(m.group(3)), "until": "main"}], "status": "auto"}, **_xd(m.group(4)))
    m = re.fullmatch(r"≪あなた≫は(\d+)ドローする。その後、あなたの手札からあなたの任意のカード(\d+)枚をあなたのデッキに戻し、そのデッキをシャッフルする。?", text)   # A3-03 0483
    if m: return {"steps": [{"a": "draw", "to": "you", "n": int(m.group(1))}, {"a": "pickZone", "zones": ["hand"], "owner": "you", "dest": "deckShuffle", "n": int(m.group(2))}], "status": "auto"}
    if re.fullmatch(r"≪全てのプレイヤー≫は、ドローフェイズの手順を行う。その後、あなたのメインフェイズに戻る。?", text):   # A3-03 0484
        return {"steps": [{"a": "drawStep", "to": "players"}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、≪キャラクター全て≫の攻撃力と耐久力の数値を入れ替える。メインフェイズ終了時に、このカードはオーナーのダメージ置き場に置かれる。?", text):   # A3-03 0485
        return {"steps": [{"a": "field", "mod": {"to": {"players": "all"}, "key": "swapAtDeAll", "op": "grant", "value": True, "until": "main"}}, {"a": "delayed", "at": "main", "step": {"a": "selfCardToDamage", "to": "card"}}], "status": "auto"}
    m = re.fullmatch(r"メインフェイズ終了時まで、目標の≪キャラクタ.1人≫のアタック宣言に対してガード宣言したキャラクターに、ただちにXダメージを与える。メインフェイズ終了時まで、目標の攻撃力に\+Xする。(Xは[^。]+に等しい)。?", text)   # A3-01 0205
    if m and x_def(m.group(1)): return {"target": {"kind": "char", "sel": {}, "count": 1}, "x": x_def(m.group(1)), "steps": [{"a": "mod", "to": "t", "resolveX": True, "mod": {"key": "guardHit", "op": "grant", "value": {"n": "X", "noOwner": True, "asAttacker": True}}, "until": "main"}, {"a": "mod", "to": "t", "mod": {"key": "at", "op": "add", "value": {"xvar": True, "sign": 1}}, "until": "main"}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、≪アタックコスト・ガードコストとして支払ったパワーカード≫がキャラクターカード・ブレイクカードの場合はオーナーの手札に戻し、パーマネントカードの場合はオーナーのダメージ置き場に置き、プロジェクトカード・ファストカードの場合は捨て札する。?", text):   # A3-02 0237
        return {"steps": [{"a": "field", "mod": {"to": {"players": "all"}, "key": "dest", "op": "dest", "value": {"cost": ["attack", "guard"], "paidTypes": ["Character", "Break"], "to": "hand"}, "until": "main"}}, {"a": "field", "mod": {"to": {"players": "all"}, "key": "dest", "op": "dest", "value": {"cost": ["attack", "guard"], "paidTypes": ["Permanent"], "to": "damage"}, "until": "main"}}], "status": "auto"}
    # ---- M3a batch 1 (Revise#159) ----
    if re.fullmatch(r"メインフェイズ終了時まで、このキャラクターのアタック宣言に対してガード宣言された場合、≪ガード宣言したキャラクターのオーナー≫に、ただちに\(X\)ダメージを与える。Xは、このキャラクターの精神攻撃力の数値から、ガード宣言したキャラクターにセットされているパワーカードの枚数を引いた値に等しい。?", text):   # A3-01 0091
        return {"steps": [{"a": "field", "mod": {"to": "you", "key": "watch", "op": "grant", "until": "main", "value": {"on": "guard", "vsSelf": True, "sel": {}, "effect": {"steps": [{"a": "guardOwnerHit"}], "status": "auto"}}}}], "status": "auto"}
    m = re.fullmatch(r"ターン終了時まで、≪あなた≫は、次にセット宣言する(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のネームを持つブレイクカードの分類を無視することが可能。そのカードをセットした場合、あなたは(\d+)ドローする。その後、あなたの手札の、そのカードと同じネームを持つカードを、そのカードの下に、任意の枚数、そのキャラクターを構成するカードとしてセット可能。?", text)   # A4-05 0919 / 0937 (Revise#352)
    if m:
        fac = FACTION_JP.get(m.group(1)) or FACTION_JP[m.group(1).replace("ー", "-")]
        return {"steps": [{"a": "field", "mod": {"to": "you", "key": "breakAnyIconCard", "op": "grant", "value": {"faction": fac, "named": True}, "until": "turn"}},
                          {"a": "watchEv", "event": "broken", "when": {"own": True, "cardNamed": True, "cardFaction": fac}, "once": True, "effect": {"steps": [{"a": "endOwnMods", "key": "breakAnyIconCard"}, {"a": "draw", "to": "you", "n": int(m.group(2))}, {"a": "handUnder", "sameName": True, "any": True, "ev": True}], "status": "auto"}, "until": "turn"}], "status": "auto"}
    m = re.fullmatch(r"ターン終了時まで、≪あなた≫が次に(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のネームを持つブレイクカードをセットした場合、(あなたのデッキを上から(\d+)枚見て、任意の順番で戻す。その後、)?あなたは(\d+)ドローする。(その後、あなたのダメージ置き場のカード(\d+)枚を手札に加えることが可能。)?その後、あなたの手札の、そのカードと同じネームを持つカードを、そのカードの下に、任意の枚数、そのキャラクターを構成するカードとしてセット可能。(?:その後、(このカードをパワーカードとしてそのキャラクターにセット可能|キャラクター1人に\((\d+)\)ダメージを与える|パワー0のキャラクター1人を捨て札可能)。)?", text)   # A4-05 0811 / 0847 / 0883 / 0955 / 0991 (Revise#352)
    if m:
        st = ([{"a": "reorderTop", "n": int(m.group(3))}] if m.group(2) else []) + [{"a": "draw", "to": "you", "n": int(m.group(4))}] + ([{"a": "pickZone", "zones": ["damage"], "owner": "you", "sel": {}, "n": int(m.group(6)), "upTo": True, "dest": "hand"}] if m.group(5) else []) + [{"a": "handUnder", "sameName": True, "any": True, "ev": True}]
        if m.group(7): st.append({"a": "thisCardPowerOn"} if m.group(7).startswith("このカード") else {"a": "pickAnyDamage", "only": "char", "n": int(m.group(8)), "mental": True} if m.group(8) else {"a": "pickDiscard", "sel": {"power": {"op": "=", "n": 0}}, "upTo": True})
        fac = FACTION_JP.get(m.group(1)) or FACTION_JP[m.group(1).replace("ー", "-")]
        return {"steps": [{"a": "watchEv", "event": "broken", "when": {"own": True, "cardNamed": True, "cardFaction": fac}, "once": True, "effect": {"steps": st, "status": "auto"}, "until": "turn"}], "status": "auto"}
    m = re.fullmatch(r"≪あなたの任意のダメージ置き場のカード(\d+)枚≫を、そのオーナーのデッキに戻す。このカードのコストが(\S+?系)を持つキャラクター1人からのみ支払われている場合、代わりに、≪あなたの任意のダメージ置き場のカード(\d+)枚≫を、そのオーナーのデッキに戻(?:す。その後、|し、)そのデッキをシャッフルする。?", text)   # A4-EP EP506 (Revise#346)
    if m:
        pb = {"sel": True, "one": True, "tag": m.group(2)}; pk = lambda n: {"a": "pickZone", "zones": ["damage"], "owner": "any", "dest": "deckShuffle", "n": n, "upTo": False}
        return {"steps": [dict(pk(int(m.group(1))), ifNotPaidBy=pb), dict(pk(int(m.group(3))), ifPaidBy=pb)], "status": "auto"}
    m = re.fullmatch(r"ターン終了時まで、目標の≪キャラクタ.1人≫が次にバトルする際、バトル相手にセットされているパーマネントカード(\d+)枚を捨て札する。目標が必要ファクターが(\d+)以上の(\S+?系)を持つキャラクターの場合、代わりに、バトル相手にセットされているパーマネントカード(\d+)枚を捨て札する。?", text)   # A4-EP EP514
    if m:
        ts = {"tag": m.group(3), "factorGe": int(m.group(2))}; w = lambda n: {"a": "watchEv", "to": "t", "event": "battleStart", "when": {"self": True}, "oppOfBound": True, "once": True, "effect": {"steps": [{"a": "cardsOf", "to": "evCh", "part": "perm", "n": n, "dest": "discard"}], "status": "auto"}, "until": "turn"}
        return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [dict(w(int(m.group(1))), ifTNotSel=ts), dict(w(int(m.group(4))), ifTSel=ts)], "status": "auto"}
    m = re.fullmatch(r"目標の≪▼を持つキャラクタ.1人≫に(\d+)ダメージを与える。このカードのコストが(\S+?系)を持つキャラクター1人からのみ支払われている場合、代わりに、目標の≪キャラクタ.1人≫に(\d+)ダメージを与える。?", text)   # A4-EP EP500 (Revise#345): one target; without that payment only a ▼ character is hit
    if m:
        pb = {"sel": True, "one": True, "tag": m.group(2)}
        return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "damage", "to": "t", "n": int(m.group(1)), "mental": False, "ifTSel": {"aggressive": True}, "ifNotPaidBy": pb}, {"a": "damage", "to": "t", "n": int(m.group(3)), "mental": False, "ifPaidBy": pb}], "status": "auto"}
    m = re.fullmatch(r"ターン終了時まで、≪あなたの支配キャラクター全て≫にシールドを与える。このカードのコストが必要ファクターが(\d+)以上の(\S+?系)を持つキャラクター1人からのみ支払われている場合、さらに、対象はプロジェクトカード・ファストカードの目標にならない。?", text)   # A4-EP EP508
    if m:
        grp = {"all": {"owner": "you", "area": "controlled"}}
        return {"steps": [{"a": "mod", "to": grp, "mod": {"key": "skill", "op": "grant", "value": {"id": "shield", "x": True}}, "until": "turn"}, {"a": "mod", "to": grp, "mod": {"key": "untargetable", "op": "grant", "value": {"from": ["Project", "Fast"]}}, "until": "turn", "ifPaidBy": {"sel": True, "one": True, "tag": m.group(2), "factorGe": int(m.group(1))}}], "status": "auto"}
    m = re.fullmatch(r"目標の≪あなたの支配キャラクタ.1人≫に、あなたの手札のブレイクカード1枚をコストを支払ってセット宣言する。その際、支払ったコストは手札に戻る。(?:その後、あなたのデッキの一番上のカード(\d+)枚を、目標にパワーカードとしてセットする。?)?", text)   # A3-EXPR EXPR034 (Revise#344)
    if m: return {"target": {"kind": "char", "sel": {"owner": "you", "area": "controlled"}, "count": 1}, "steps": [{"a": "effDecl", "zones": ["hand"], "types": ["Break"], "onto": "t", "costTo": "hand"}] + ([{"a": "powerFromDeck", "to": "t", "n": int(m.group(1))}] if m.group(1) else []), "status": "auto"}
    m = re.fullmatch(r"ターン終了時まで、目標の≪キャラクタ.1人≫が次に対戦相手にアタックした場合、あなたは(\d+)ドローする。目標が(\S+?系)を持つキャラクターの場合、その後、さらに、あなたは(\d+)ドローする。?", text)   # A4-EP EP509
    if m:
        w = lambda n: {"a": "watchEv", "to": "t", "event": "attack", "when": {"self": True, "toPlayer": True}, "once": True, "effect": {"steps": [{"a": "draw", "to": "you", "n": n}], "status": "auto"}, "until": "turn"}
        return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [w(int(m.group(1))), dict(w(int(m.group(3))), ifTSel={"tag": m.group(2)})], "status": "auto"}
    m = re.fullmatch(r"ターン終了時まで、目標の≪(.+?)キャラクタ.1人≫がバトルの結果またはアタックを受けて捨て札される場合、そのキャラクターを場に残す。その後、このカードを捨て札する。?", text)   # A3-EX03 EX0340 / EXPV023 (Revise#342)
    if m and parse_selector(m.group(1)) is not None:
        return {"target": {"kind": "char", "sel": parse_selector(m.group(1)), "count": 1}, "steps": [{"a": "mod", "to": "t", "mod": {"key": "keepByCard", "op": "grant", "value": {"battleOnly": True, "must": True}}, "until": "turn"}], "status": "auto"}
    if re.fullmatch(r"ターン終了時まで、目標の≪あなたの支配キャラクタ.1人≫が捨て札になる場合、このキャラクターのパワーカード1枚を捨て札することで、目標を場に残す。?", text):   # A3-03 0480
        return {"target": {"kind": "char", "sel": {"owner": "you", "area": "controlled"}, "count": 1}, "steps": [{"a": "keepByPowerT", "to": "t", "until": "turn"}], "status": "auto"}
    m = re.fullmatch(r"メインフェイズ終了時まで、目標の≪精神力X以下のキャラクタ.1人≫のアタック宣言に対して、このキャラクターでガード宣言した場合、目標のアタック宣言を取り消す。?", text)   # A3-04 0676
    if m: return {"target": {"kind": "char", "sel": {"stat": [{"key": "se", "op": "<=", "n": "X"}]}, "count": 1}, "steps": [{"a": "guardCancelByT", "to": "t", "until": "main"}], "status": "auto"}
    m = re.fullmatch(r"メインフェイズ終了時まで、≪アタック宣言またはガード宣言した、あなたの対戦相手の支配キャラクター≫に、ただちに\((X|\d+)\)ダメージを与える。?", text)   # A3-05 0868
    if m:
        w = lambda on: {"a": "field", "storeX": True, "mod": {"to": "you", "key": "watch", "op": "grant", "until": "main", "value": {"on": on, "sel": {"owner": "opp", "area": "controlled"}, "effect": {"steps": [{"a": "damage", "to": "evCh", "n": "X" if m.group(1) == "X" else int(m.group(1)), "mental": True}], "status": "auto"}}}}
        return {"steps": [w("attack"), w("guard")], "status": "auto"}
    # ---- M2g batch 9 (Revise#157) ----
    m = re.fullmatch(r"ターン終了時まで、次にこのキャラクターがガードしてバトルする際、≪このキャラクター≫の攻撃力に\+Xして判定し、このキャラクターはバトルによるダメージを受けない。Xはバトル相手の攻撃力の数値の合計に等しい。?", text)   # EX0509
    if m: return {"steps": [{"a": "nextBattleMods", "cond": {"self": "guarding"}, "mods": [{"key": "at", "op": "add", "value": {"x": {"battleOppAtSum": True}, "sign": 1}}, {"key": "noDamage", "op": "grant", "value": {"battle": True}}], "until": "turn"}], "status": "auto"}
    m = re.fullmatch(r"ターン終了時まで、次にこのキャラクターが対戦相手の支配キャラクターとバトルする際、 ?≪このキャラクター≫に([±+\-]\d+)/([±+\-]\d+)/([±+\-]\d+)して判定し、そのバトルの結果、バトル相手を捨て札した場合、あなたのデッキの一番上のカード1枚をパワーカードとしてこのキャラクターにセットする。?", text)   # EX0536
    if m: return {"steps": [{"a": "nextBattleMods", "cond": {"battleOrAttackPlayer": True}, "mods": [{"key": k, "op": "add", "value": sign_n(m.group(i))} for k, i in (("se", 1), ("at", 2), ("de", 3)) if sign_n(m.group(i))] + [{"key": "killPower", "op": "grant", "value": True}], "until": "turn"}], "status": "auto"}
    # ---- M2g batch 8 (Revise#157) ----
    m = re.fullmatch(r"≪プレイヤー全て≫の手札(X|\d+)枚を無作為に選んで捨て札する。?", text)   # PR335
    if m: return {"steps": [{"a": "randomHandDiscard", "to": "players", "n": "X" if m.group(1) == "X" else int(m.group(1))}], "status": "auto"}
    # ---- M2g batch 7 (Revise#157) ----
    m = re.fullmatch(r"このエフェクトの使用宣言時にあなたの手札を1枚捨て札する。目標の≪このキャラクターのアタック宣言に対してガード宣言しているか、このキャラクターにガード宣言されているキャラクタ.1人≫にXダメージ与える。(Xは[^。]+に等しい)。?", text)   # EXPP049
    if m and x_def(m.group(1)): return {"target": {"kind": "char", "sel": {"oppOfSelf": True}, "count": 1}, "steps": [{"a": "pickZone", "zones": ["hand"], "owner": "you", "dest": "discard", "n": 1}, {"a": "damage", "to": "t", "n": "X", "mental": False}], "x": x_def(m.group(1)), "status": "auto"}
    m = re.fullmatch(r"(?:このエフェクトの)?使用宣言時にこのキャラクターにセットされている(.+?)(?:を|-)?1枚を?捨て札する。目標の≪アタック宣言またはガード宣言しているキャラクタ.1人≫にXダメージを与える。(Xは[^。]+に等しい)。?", text)   # EX0545
    if m and x_def(m.group(2)): return {"target": {"kind": "char", "sel": {"inBattle": True}, "count": 1}, "x": x_def(m.group(2)), "steps": [{"a": "permTokenDiscard", "name": m.group(1) + ("ー" if (m.group(1) + "-1枚") in text else "")}, {"a": "damage", "to": "t", "n": "X", "mental": False, "ifLast": True}], "status": "auto"}
    m = re.fullmatch(r"≪あなたのデッキの一番上のカード1枚≫を、(.+?)を持つパーマネントカード・(.+?)としてこのキャラクターにセットする。?", text)   # EX0545
    if m and skills_list(m.group(1)): return {"steps": [{"a": "deckTopPermToken", "token": {"name": m.group(2), "stats": {}, "skills": skills_list(m.group(1))}}], "status": "auto"}
    m = re.fullmatch(r"ターン終了時まで、目標の≪あなたの支配キャラクタ.1人≫に、(.+?)のいずれか1つを与える。?", text)   # EXPP064
    if m and skills_list(m.group(1)) and len(skills_list(m.group(1))) >= 2:
        return {"target": {"kind": "char", "sel": {"owner": "you", "area": "controlled"}, "count": 1}, "steps": [{"a": "choiceGrant", "to": "t", "options": [dict(sk, label=sk["id"].capitalize() + ("" if sk["x"] is True else " " + str(sk["x"]))) for sk in skills_list(m.group(1))], "until": "turn"}], "status": "auto"}
    m = re.fullmatch(r"目標の≪このキャラクター以外の支配エリアのネームレベルキャラクタ.1人≫にバインド(\d+)を与え、([±+\-]\d+)/([±+\-]\d+)/([±+\-]\d+)する。?", text)   # EXPR049
    if m: return {"target": {"kind": "char", "sel": {"area": "controlled", "named": True, "notSelf": True}, "count": 1}, "steps": [{"a": "mod", "to": "t", "mod": {"key": "skill", "op": "grant", "value": {"id": "bind", "x": int(m.group(1))}}, "until": "turn"}] + [{"a": "mod", "to": "t", "mod": {"key": k, "op": "add", "value": sign_n(m.group(i))}, "until": "turn"} for k, i in (("se", 2), ("at", 3), ("de", 4)) if sign_n(m.group(i))], "status": "auto"}
    m = re.fullmatch(r"カード種類を1つ指定し、あなたのデッキをシャッフルする。その後、あなたのデッキの一番上のカード1枚を公開し、指定した種類のカードの場合、≪あなた≫は(\d+)ドローする。?", text)   # EXPR052
    if m: return {"steps": [{"a": "guessTopDraw", "n": int(m.group(1))}], "status": "auto"}
    m = re.fullmatch(r"ターン終了時まで、≪(.+?)を持つあなたの支配キャラクター≫に与えられるダメージは、代わりにこのキャラクターに与えられる。?", text)   # EXPR063
    if m and (class_tokens(m.group(1)) or (parse_selector(m.group(1) + "を持つ") or {}).get("tag")): return {"steps": [{"a": "takeForSel", "value": {"icons": class_tokens(m.group(1))} if class_tokens(m.group(1)) else {"tag": parse_selector(m.group(1) + "を持つ")["tag"]}, "until": "turn"}], "status": "auto"}
    m = re.fullmatch(r"≪あなたの任意のエリア1つにいるキャラクター全て≫にXダメージを与える。?(" + PT + ")", text)   # EXPR046
    if m: return dict({"steps": [{"a": "areaDamage", "n": "X"}], "status": "auto"}, **({"timing": "project"} if m.group(1) else {}))
    # ---- M2g batch 6 (Revise#157) ----
    m = re.fullmatch(r"≪あなたのデッキの一番上のカード1枚≫を、勢力なし、(.+?)の(\d+)/(\d+)/(\d+)のあなたの支配キャラクター、(.+?)としてセットする。?", text)   # EX0244
    if m and class_tokens(m.group(1)): return {"steps": [{"a": "deckTopToken", "name": m.group(5), "faction": "", "icons": class_tokens(m.group(1)), "stats": {"se": int(m.group(2)), "at": int(m.group(3)), "de": int(m.group(4))}}], "status": "auto"}
    m = re.fullmatch(r"ターン終了時まで、目標の≪カード名称に「([^」]+)」を含むあなたの支配キャラクタ.1人≫は(.+?)を得、([±+\-]\d+)/([±+\-]\d+)/([±+\-]\d+)される。?", text)   # EX0244
    if m and skills_list(m.group(2)):
        st = [{"a": "mod", "to": "t", "mod": {"key": "skill", "op": "grant", "value": {"id": sk["id"], "x": sk["x"]}}, "until": "turn"} for sk in skills_list(m.group(2))]
        st += [{"a": "mod", "to": "t", "mod": {"key": k, "op": "add", "value": sign_n(m.group(i))}, "until": "turn"} for k, i in (("se", 3), ("at", 4), ("de", 5)) if sign_n(m.group(i))]
        return {"target": {"kind": "char", "sel": {"tokenOrJp": m.group(1), "owner": "you", "area": "controlled"}, "count": 1}, "steps": st, "status": "auto"}
    if re.fullmatch(r"あなたは、≪あなたのテリトリーのパワーカード全て≫の内容を確認し、その中の1枚を手札に加える。その後、≪あなたのデッキの一番上のカード1枚≫を、パワーカードとしてあなたのテリトリーのキャラクタ.1人にセットする。?", text):   # A3-25 3657 (Revise#357)
        return {"steps": [{"a": "ownPowerPick", "territory": True}, {"a": "deckTopPowerPick"}], "status": "auto"}
    m = re.fullmatch(r"目標の≪パーマネントカード1枚≫を捨て札する。その後、目標のオーナーの手札とデッキを確認し、目標と同じ名称のカード全てを捨て札する。(あなたが[A-Z阿極]+を満たしている場合)、プロジェクトカード1枚を目標とすることが可能。?", text)   # A4-PP PP183 / PP189 (Revise#357)
    if m and cond_of(m.group(1)): return {"target": {"kind": "card", "sel": {"types": ["Permanent", "Project"], "projIfCond": cond_of(m.group(1))}, "count": 1}, "steps": [{"a": "discard", "to": "t"}, {"a": "purgeSameNameT", "to": "t"}], "status": "auto"}
    m = re.fullmatch(r"ターン終了時まで、≪対戦相手のブレイクしていない支配キャラクター全て≫は、バトルの際、攻撃力の数値に[-ー−]Xして判定する。(Xは[^。]+に等しい)。?", text)   # A4-EX01 EX0723 (Revise#357)
    if m and x_def(m.group(1)): return {"steps": [{"a": "mod", "to": {"all": {"owner": "opp", "broken": False, "area": "controlled"}}, "mod": {"key": "at", "op": "add", "value": {"xvar": True, "sign": -1}}, "until": "turn", "cond": {"self": "inBattle"}}], "x": x_def(m.group(1)), "status": "auto"}
    m = re.fullmatch(r"≪プレイヤー全て≫は、自身のデッキの上から(\d+)枚を見て、自身の任意の順番でデッキの一番上に戻す。その後、≪(武蔵|英国|三征西班牙|K\.P\.A\.Italia|六護式仏蘭西|M\.H\.R\.R\.|P\.A\.Oda|上越露西亜|清武田|IZUMO|三河)を持つキャラクターを支配しているプレイヤー≫は(\d+)ドローする。?", text)   # A4-EX01 EX0735 (Revise#357)
    if m: return {"steps": [{"a": "eachReorderTop", "n": int(m.group(1))}, {"a": "drawSeatsCtl", "sel": {"tag": m.group(2)}, "n": int(m.group(3))}], "status": "auto"}
    if re.fullmatch(r"≪あなたの任意のあなたの支配キャラクタ.X体まで≫を、同時にアタック宣言・ガード宣言させる。アタック宣言されたプレイヤーは、それぞれのアタック宣言に対してガード宣言可能。?", text):   # A3-05 0909 / A4-05 0993 (Revise#361)
        return {"steps": [{"a": "massDeclarePick", "n": "X"}], "status": "auto"}
    # ---- Revise#364 ----
    m = re.fullmatch(r"このカードを捨て札し、≪あなたの手札の必要ファクターを満たしている「(.+)」1枚≫をこのキャラクターにセットする。?", text)   # A3-EX05 EX0595 (Revise#366)
    if m: return {"steps": [{"a": "selfCardDiscard"}, {"a": "pickZone", "zones": ["hand"], "owner": "you", "n": 1, "sel": {"types": ["Permanent"], "jp": re.sub(r"\s+", "", m.group(1)), "factorMet": True}, "dest": "perm", "permOn": "self"}], "status": "auto"}
    m = re.fullmatch(r"ターン終了時まで、≪ネームレベルキャラクター全て≫は、バトルする際、バトル相手のパワ[ー-](\d+)につき([+\-±]\d+)/([+\-±]\d+)/([+\-±]\d+)する。?", text)   # A3-EX04 EX0485 (Revise#370)
    if m:
        steps = [{"a": "mod", "to": {"all": {"named": True}}, "mod": {"key": key, "op": "add", "value": {"x": {"battleOppPower": True, "ofTo": True, "div": int(m.group(1))}, "sign": sign_n(m.group(g))}}, "until": "turn", "cond": {"self": "inBattle"}} for key, g in (("se", 2), ("at", 3), ("de", 4)) if sign_n(m.group(g))]
        return {"steps": steps, "status": "auto"}
    m = re.fullmatch(r"このカードが効果を発揮した場合、≪あなたのデッキ≫からネームに「([^」]+)」を含む(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のブレイクカードを(\d+)枚まで選び、対戦相手に見せる。その後、そのカードをあなたの手札に加える。その後、あなたのデッキをシャッフルする。\s*ターン終了時まで、≪あなたの任意のキャラクタ.1人≫は耐久力に\+(\d+)され、プロジェクトカード・このカード以外のファストカードの効果・精神ダメージ・バトル以外のダメージを受けない。?", text)   # A3-17 2345 (Revise#395)
    if m:
        g = lambda key, value: {"a": "mod", "to": "t", "mod": {"key": key, "op": "grant", "value": value}, "until": "turn"}
        return {"steps": [{"a": "pickZone", "zones": ["deck"], "owner": "you", "n": int(m.group(3)), "upTo": True, "sel": {"types": ["Break"], "faction": FACTION_JP.get(m.group(2)) or FACTION_JP[m.group(2).replace("ー", "-")], "nameHas": m.group(1)}, "dest": "hand", "reveal": True},
                          {"a": "shuffle", "to": "you"}, {"a": "mod", "to": "t", "mod": {"key": "de", "op": "add", "value": int(m.group(4))}, "until": "turn"},
                          g("untargetable", {"from": ["Project", "Fast"], "exceptCard": True}), g("noDamage", {"mental": True}), g("noDamage", {"outside": True})],
                "target": {"kind": "char", "sel": {}, "count": 1, "byChoice": True}, "status": "auto"}
    m = re.fullmatch(r"≪プレイヤー全て≫は、(" + WORK_ALT + r")に登場するネーム1つを指定し、自分のデッキから指定したネームを持つか、カードテキストに含むカード1枚を手札に加える。?", text)   # A3-EX04 EX0480 / EX0498 (Revise#369)
    if m: return {"steps": [{"a": "eachPlayerPick", "zones": ["deck"], "sel": {"workNames": WORKS_JP[m.group(1)]}}], "status": "auto"}
    # ---- Revise#369 ----
    m = re.fullmatch(r"(ターン終了時まで、目標の≪[^≫]+≫)はプロジェクトカード・ファストカード・このエフェクト以外のエフェクトの効果を受けず、コストを支払うことができず、アタック宣言・ガード宣言・エフェクトの使用宣言ができない。(Xは[^。]+に等しい。?)?", text)   # A4-EP EP423
    if m:
        bs = [parse_body(m.group(1) + tail + (m.group(2) or "")) for tail in ("はプロジェクトカード・ファストカード・エフェクトの効果を受けない。", "はコストを支払うことができない。", "はアタック宣言・ガード宣言・エフェクトの使用宣言ができない。")]
        if all(b["status"] == "auto" for b in bs):
            st0 = [dict(x, mod=dict(x["mod"], value=dict(x["mod"]["value"], exceptCard=True))) for x in bs[0]["steps"]]
            return dict(bs[0], steps=st0 + bs[1]["steps"] + bs[2]["steps"])
    # ---- Revise#366 ----
    if re.fullmatch(r"≪プレイヤー全て≫は、ダメージ置き場のカード全てを捨て札する。その後、捨て札置き場から、自分がこの効果で捨て札した枚数に等しい枚数のカードを選び、そのオーナーのダメージ置き場に置く。?", text):   # A4-03 0445
        return {"steps": [{"a": "eachDamageSwap"}], "status": "auto"}
    m = re.fullmatch(r"(.*)(目標の≪プロジェクトカード1枚≫を捨て札する。)(あなたの支配エリアに.+?場合)、代わりに、目標の≪プロジェクトカード1枚またはファストカード1枚≫を捨て札する。?", text)   # A3-14 2031 / PP277
    if m and cond_of(m.group(3)):
        b0 = parse_body(m.group(1) + m.group(2))
        if b0["status"] == "auto" and b0.get("target", {}).get("kind") == "card": return dict(b0, target=dict(b0["target"], sel={"types": ["Project", "Fast"], "fastIfCond": cond_of(m.group(3))}))
    # ---- Revise#365 ----
    m = re.fullmatch(r"(ターン終了時まで|メインフェイズ終了時まで)、≪あなたの任意の勢力1つの、アタック宣言またはガード宣言したキャラクター≫に(\()?(\d+)\)?ダメージを与える。?", text)   # A4-PP PP085
    if m: return {"steps": [{"a": "factionWatchDamage", "n": int(m.group(3)), "mental": bool(m.group(2)), "until": UNTIL[m.group(1)]}], "status": "auto"}
    if re.fullmatch(r"目標の≪このキャラクターを効果範囲に含むプロジェクトカードまたはファストカード1枚≫を捨て札する。?", text):   # A4-EX02 EX828
        return {"target": {"kind": "item", "sel": {"kind": "set", "types": ["Project", "Fast"], "aimsSelfCh": True}, "count": 1}, "steps": [{"a": "cancelItem", "to": "t"}], "status": "auto"}
    if re.fullmatch(r"目標の≪キャラクタ.1人≫に、そのキャラクターと同じエリアにあるあなたの任意のパーマネントカード1枚のコストに等しいダメージを与える。?", text):   # A4-EX02 EX866
        return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "damagePermCostPick", "to": "t"}], "status": "auto"}
    if re.fullmatch(r"≪あなたの任意の勢力1つのブレイクしていないキャラクタ.X体≫にセットされているパワーカード全てを捨て札する。?", text):   # A4-01 0022
        return {"steps": [{"a": "factionStripPick", "n": "X"}], "status": "auto"}
    m = re.fullmatch(r"このカードの使用宣言時に、カード名称を1つ指定する。目標の≪プレイヤ.1人≫に(\d+)ダメージを与える。そのダメージ判定で指定したカード名称のカードが出た場合、この手順をもう一度行う。?", text)   # A4-02 0377 / A4-PR PR054 (Revise#364)
    if m: return {"target": {"kind": "player", "sel": {}, "psel": {}, "count": 1}, "steps": [{"a": "cardNameChoose"}, {"a": "damageNameRepeat", "to": "t", "n": int(m.group(1))}], "status": "auto"}
    m = re.fullmatch(r"≪あなた≫は、あなたのデッキの上からカードを(\d+)枚見て、そのままの順番でデッキの上に戻す。その後、以下の効果から1つを選択する。?", text)   # A3-21 2983 (Revise#364): its two choices are 「≪あなた≫は1ドローする。」 and 「あなたの手札X枚を捨て札する。その後、≪あなた≫はXドローする。」 — discarding none = the first one
    if m: return {"steps": [{"a": "peekTop", "n": int(m.group(1))}, {"a": "discardHandAnyX"}, {"a": "draw", "to": "you", "n": "last"}, {"a": "draw", "to": "you", "n": 1, "ifNotLast": True}], "status": "auto"}
    if re.fullmatch(r"目標の≪デッキ1つ≫を見て、あなたの任意のカード(\d+)枚を捨て札する。その後、そのデッキをシャッフルする。?", text):   # A4-PP PP270 / PP278
        n_ = int(re.search(r"カード(\d+)枚", text).group(1))
        return {"target": {"kind": "player", "sel": {}, "psel": {}, "count": 1}, "steps": [{"a": "pickZone", "zones": ["deck"], "owner": "t", "n": n_, "sel": {}, "dest": "discard"}, {"a": "shuffle", "to": "t"}], "status": "auto"}
    m = re.fullmatch(r"このキャラクターにセットされている(.+?)をX枚捨て札する。その後、目標の≪キャラクタ.1人≫にXダメージを与える。?(このエフェクトはあなたのターンのプロジェクトカードのタイミングでのみ使用宣言可能。?)?", text)   # A4-EX02 EX806
    if m: return dict({"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "permTokenDiscardAny", "name": m.group(1)}, {"a": "damage", "to": "t", "n": "last", "mental": False}], "status": "auto"}, **({"timing": "project"} if m.group(2) else {}))
    m = re.fullmatch(r"目標の≪プロジェクトカードまたはファストカード1枚≫のオーナーは追加の(\d+)コストを支払う。支払うことができなかった場合、目標を捨て札する。?", text)   # A4-02 0252
    if m: return {"target": {"kind": "card", "sel": {"types": ["Project", "Fast"]}, "count": 1}, "steps": [{"a": "payOrDiscardT", "to": "t", "n": int(m.group(1))}], "status": "auto"}
    m = re.fullmatch(r"目標の≪キャラクタ.1人≫に(\d+)ダメージを与える。このカードのコストが“([^”]+)”からのみ支払われている場合、与えるダメージに\+Xする。Xはこのカードのコストを支払った“\2”の攻撃力の数値に等しい。?", text)   # A4-EX02 EX887
    if m:
        pb = {"name": re.sub(r"\s+", "", m.group(2))}
        return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "damage", "to": "t", "n": int(m.group(1)), "mental": False, "ifNotPaidBy": pb}, {"a": "damagePayerAt", "to": "t", "base": int(m.group(1)), "ifPaidBy": pb}], "status": "auto"}
    m = re.fullmatch(r"このカードが効果を発揮した場合、あなたのデッキの上からカードをX枚引き、対象にパワーカードとして1枚ずつセットする。ターン終了時まで、≪あなたの任意のあなたの支配キャラクタ.X体≫は(.+?)を得、\+X/±0/±0される。Xは(\d+)以上のあなたの任意の数に等しい。?", text)   # A3-EXPR EXPR043
    if m and skills_list(m.group(1)): return {"steps": [{"a": "blessPick", "min": int(m.group(2)), "skills": skills_list(m.group(1)), "stat": "se", "power": 1, "until": "turn"}], "status": "auto"}
    # ---- Revise#363 ----
    m = re.fullmatch(r"(.*?)あなたの手札全てを捨て札する。その後、目標の≪プレイヤ.1人≫にXダメージを与える。その後、目標のダメージ置き場のカード枚数が(\d+)枚以上の場合、目標にXダメージを与える。Xはこのカードの効果であなたが捨てた手札の枚数に等しい。?", text)   # A3-EX02 EX0167
    if m:
        b0 = parse_body(m.group(1) + "目標の≪プレイヤー1人≫に1ダメージを与える。")
        if b0["status"] == "auto" and b0["steps"] and b0["steps"][-1].get("a") == "damage":
            return dict(b0, steps=b0["steps"][:-1] + [{"a": "handAll", "to": "you"}, {"a": "damage", "to": "t", "n": "last", "mental": False}, {"a": "damage", "to": "t", "n": "last", "mental": False, "ifTPileMin": int(m.group(2))}])
    if re.fullmatch(r"場またはダメージ置き場のカードを1枚指定する。その後、≪あなたのデッキ≫から、指定したカードと同じ名称のカード1枚を選び、手札に加える。その後、そのデッキをシャッフルする。?", text):   # A4-04 0708
        return {"steps": [{"a": "deckSameAsPicked"}, {"a": "shuffle", "to": "you"}], "status": "auto"}
    m = re.fullmatch(r"目標の≪キャラクタ.1人≫に(\d+)ダメージを与える。このカードのコストが、ネームを持つブレイクしている(.+?)から支払われていた場合、代わりに、目標に(\d+)ダメージを与え、目標にセットされているパワーカード(\d+)枚を捨て札する。?", text)   # A3-EX03 EX0327 (Revise#362)
    if m and class_tokens(m.group(2)):
        pb = {"sel": True, "named": True, "broken": True, "icons": class_tokens(m.group(2))}
        return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "damage", "to": "t", "n": int(m.group(1)), "mental": False, "ifNotPaidBy": pb}, {"a": "damage", "to": "t", "n": int(m.group(3)), "mental": False, "ifPaidBy": pb}, {"a": "powerDiscard", "to": "t", "n": int(m.group(4)), "ifPaidBy": pb}], "status": "auto"}
    m = re.fullmatch(r"(ターン終了時まで、目標の≪[^≫]+≫)はアタック宣言・ガード宣言・エフェクトの使用宣言が無効化され、ファクター全てを失う。?", text)   # A4-EX02 EX898 (Revise#362)
    if m:
        b1, b2 = parse_body(m.group(1) + "はアタック宣言・ガード宣言・エフェクトの使用宣言ができない。"), parse_body(m.group(1) + "はファクター全てを失う。")
        if b1["status"] == "auto" and b2["status"] == "auto": return dict(b1, steps=b1["steps"] + b2["steps"])
    m = re.fullmatch(r"(ターン終了時まで、≪[^≫]+全て≫は\+X/\+X/\+Xされる。)(あなたの支配エリアに.+?場合)、ターン終了時まで、対象はバインド(\d+)を得、対象から支払われたアタックコストは手札に戻る。?", text)   # A3-EX04 EX0483 (Revise#362)
    if m and cond_of(m.group(2)):
        b1 = parse_body(m.group(1))
        if b1["status"] == "auto" and isinstance(b1["steps"][0].get("to"), dict) and "all" in b1["steps"][0]["to"]:
            to_, cd = b1["steps"][0]["to"], cond_of(m.group(2))
            return dict(b1, steps=b1["steps"] + [{"a": "mod", "to": to_, "mod": {"key": "skill", "op": "grant", "value": {"id": "bind", "x": int(m.group(3))}}, "until": "turn", "if": cd}, {"a": "field", "mod": {"to": "you", "key": "dest", "op": "dest", "value": {"cost": "attack", "paidBy": to_["all"], "to": "hand"}, "until": "turn"}, "if": cd}])
    m = re.fullmatch(r"ターン終了時まで、目標の≪(.+?キャラクタ.)1人≫がバトルの結果捨て札になる場合、目標のバトル相手にセットされているカード全てを捨て札する。?", text)   # A4-EX02 EX906 (Revise#362)
    if m and parse_selector(m.group(1).replace("キャラクタ-", "キャラクター")[:-6]) is not None:
        return {"target": {"kind": "char", "sel": parse_selector(m.group(1).replace("キャラクタ-", "キャラクター")[:-6]), "count": 1}, "steps": [{"a": "watchEv", "to": "t", "event": "leave", "when": {"battle": True}, "oppOfBound": True, "once": True, "effect": {"steps": [{"a": "powerDiscard", "to": "evCh"}, {"a": "permsOfT", "to": "evCh"}], "status": "auto"}, "until": "turn"}], "status": "auto"}
    m = re.fullmatch(r"このカードとあなたの支配エリアの“([^”]+)”を捨て札し、≪あなたの手札の“([^”]+)”1枚≫をあなたの支配キャラクターとしてセットする。?", text)   # A4-EP EP540 (Revise#362)
    if m: return {"steps": [{"a": "ownSac", "sel": {"owner": "you", "area": "controlled", "name": re.sub(r"\s+", "", m.group(1))}, "n": 1}, {"a": "selfCardDiscard", "ifLast": True}, {"a": "pickZone", "zones": ["hand"], "owner": "you", "n": 1, "sel": {"names": [re.sub(r"\s+", "", m.group(2))]}, "dest": "back", "ifLast": True}], "status": "auto"}
    m = re.fullmatch(r"このカードが効果を発揮した場合、あなたの任意の枚数のあなたの手札を捨て札し、あなたのデッキの上からそれと同じ枚数のカードを捨て札する。ターン終了時まで、目標の≪あなたの支配キャラクタ.1人≫の攻撃力に\+Xする。Xはこのカードの効果で捨て札した手札枚数の(\d+)倍に等しい。?", text)   # A3-25 3805 / 3808 (Revise#361)
    if m: return {"target": {"kind": "char", "sel": {"owner": "you", "area": "controlled"}, "count": 1}, "steps": [{"a": "discardHandAnyX"}, {"a": "mill", "to": "you", "n": "last"}, {"a": "mod", "to": "t", "mod": {"key": "at", "op": "add", "value": {"xlast": True, "sign": int(m.group(1))}}, "until": "turn"}], "status": "auto"}
    m = re.fullmatch(r"(目標の≪あなたの捨て札置き場またはダメージ置き場のブレイクカードまたはキャラクターカード1枚≫を、そのオーナーの手札に戻す。)このカードのコストが“([^”]+)”からのみ支払われていた場合、追加で1枚手札に戻すことが可能。?", text)   # A3-EX03 EX0322 (Revise#360)
    if m:
        b0 = parse_body(m.group(1))
        if b0["status"] == "auto": return dict(b0, steps=b0["steps"] + [{"a": "pickZone", "zones": ["damage", "discard"], "owner": "you", "n": 1, "upTo": True, "sel": {"types": ["Break", "Character"]}, "dest": "hand", "ifPaidBy": {"name": re.sub(r"\s+", "", m.group(2))}}])
    m = re.fullmatch(r"(ターン終了時まで、≪あなたの任意のネームレベルキャラクター2体≫は)(.+?)(を得る。)対象が“([^”]+)”と“([^”]+)”の場合、代わりに、(.+?)を得る。?", text)   # A4-EX02 EX900 (Revise#360)
    if m:
        b1, b2 = parse_body(m.group(1) + m.group(2) + m.group(3)), parse_body(m.group(1) + m.group(6) + m.group(3))
        if b1["status"] == "auto" and b2["status"] == "auto":
            nn = [re.sub(r"\s+", "", m.group(4)), re.sub(r"\s+", "", m.group(5))]
            return dict(b1, steps=[dict(x, ifNotTNames=nn) for x in b1["steps"]] + [dict(x, ifTNames=nn) for x in b2["steps"]])
    m = re.fullmatch(r"目標の≪([^≫、]+?1人)、または([^≫、]+?1枚)≫を(捨て札する|オーナーの手札に戻す)。?", text)   # A3-EP EP267 (Revise#360): a character or a card — two ways to use it
    if m:
        ms_ = [parse_body("目標の≪" + g_ + "≫を" + m.group(3) + "。") for g_ in (m.group(1), m.group(2))]
        if all(x["status"] == "auto" for x in ms_): return {"modes": [dict(x, text="目標の≪" + g_ + "≫を" + m.group(3) + "。") for x, g_ in zip(ms_, (m.group(1), m.group(2)))], "steps": [], "status": "auto"}
    m = re.fullmatch(r"≪あなたの手札1枚≫を、パーマネントカード・(.+?)として裏向きでこのキャラクターにセットする。?", text)   # A4-EP EP424 (Revise#359)
    if m: return {"steps": [{"a": "handPermToken", "token": {"name": m.group(1)}}], "status": "auto"}
    # ---- Revise#358 ----
    m = re.fullmatch(r"(ターン終了時まで|メインフェイズ終了時まで)、目標の≪あなたの支配キャラクタ.1人≫がバトルまたはアタックによるダメージを与える場合、目標の攻撃力に\+(\d+)して判定する。このカードが“([^”]+)”に効果を発揮している場合、代わりに攻撃力に\+(\d+)して判定する。(.*)", text)   # A3-EX03 EX0306
    if m:
        b0 = parse_body(m.group(1) + "、目標の≪あなたの支配キャラクター1人≫の攻撃力に+" + m.group(2) + "する。" + m.group(5))
        if b0["status"] == "auto" and b0["steps"] and b0["steps"][0].get("a") == "mod":
            nm_ = re.sub(r"\s+", "", m.group(3))
            return dict(b0, steps=[dict(b0["steps"][0], ifTNotName=nm_), dict(b0["steps"][0], mod=dict(b0["steps"][0]["mod"], value=int(m.group(4))), ifTName=nm_)] + b0["steps"][1:])
    m = re.fullmatch(r"ターン終了時まで、≪ブレイクしている([^≫]+)≫は(.+?)を得る。ターン終了時まで、≪あなたの支配エリアの\1≫は、同じエリアの\1のアタックコストを代わりに支払うことが可能。?", text)   # A4-PP PP024
    if m and class_tokens(m.group(1)) and skills_list(m.group(2)):
        ic = class_tokens(m.group(1))
        return {"steps": [{"a": "mod", "to": {"all": {"broken": True, "icons": ic}}, "mod": {"key": "skill", "op": "grant", "value": {"id": sk["id"], "x": sk["x"]}}, "until": "turn"} for sk in skills_list(m.group(2))] + [{"a": "mod", "to": {"all": {"owner": "you", "area": "controlled", "icons": ic}}, "mod": {"key": "payFor", "op": "grant", "value": {"kinds": ["attack"], "icons": ic}}, "until": "turn"}], "status": "auto"}
    m = re.fullmatch(r"あなたが同じ勢力のキャラクターを(\d+)体以上支配している場合、≪あなた≫は、このカードの必要ファクターを無視して使用宣言可能。≪あなたのデッキ≫から(.+?)1枚を選び、あなたの支配キャラクターとしてセットする。?", text)   # A3-EP EP385
    if m and deck_pick_sel(m.group(2)) is not None: return {"factorFreeIf": {"sameFactionCtl": int(m.group(1))}, "steps": [{"a": "pickZone", "zones": ["deck"], "owner": "you", "n": 1, "sel": deck_pick_sel(m.group(2)), "dest": "back"}, {"a": "shuffle", "to": "you"}], "status": "auto"}
    m = re.fullmatch(r"ターン終了時まで、≪(武蔵|英国|三征西班牙|K\\.P\\.A\\.Italia|六護式仏蘭西|M\\.H\\.R\\.R\\.|P\\.A\\.Oda|上越露西亜|清武田|IZUMO|三河)を持つネームレベルキャラクター以外のキャラクター全て≫のエフェクトのコストは(\d+)上昇する。このカードが効果を発揮した場合、≪\1を持つネームレベルキャラクター以外のキャラクターにセットされているパーマネントカード全て≫を捨て札する。?", text)   # A4-EX02 EX880
    if m:
        sl = {"notSel": {"tag": m.group(1), "named": True}}
        return {"steps": [{"a": "mod", "to": {"all": sl}, "mod": {"key": "effectCost", "op": "add", "value": int(m.group(2))}, "until": "turn"}, {"a": "permsOfT", "to": {"all": sl}}], "status": "auto"}
    m = re.fullmatch(r"ターン終了時まで、≪ネームレベルでないキャラクター全て≫のあなたを目標にしたアタック宣言を取り消す。(あなたが.+?場合)、代わりに、≪キャラクター全て≫のあなたを目標にしたアタック宣言を取り消す。?", text)   # A4-EX02 EX902
    if m and cond_of(m.group(1)):
        cd, w = cond_of(m.group(1)), {"a": "watchEv", "event": "attack", "when": {"atMe": True}, "effect": {"steps": [{"a": "cancelCurrentAttack"}], "status": "auto"}, "until": "turn"}
        return {"steps": [{"a": "cancelAttackOnYou", "sel": {"named": False}, "if": {"not": cd}}, {"a": "cancelAttackOnYou", "sel": {}, "if": cd}, dict(w, chSel={"named": False}, **{"if": {"not": cd}}), dict(w, **{"if": cd})], "status": "auto"}
    if re.fullmatch(r"目標の≪あなたまたはあなたの支配キャラクターを対象に使用宣言されているエフェクト1つ≫の使用宣言を無効化する。?", text):   # A4-EX02 EX867
        return {"target": {"kind": "item", "sel": {"kind": "effect", "aimsMine": True}, "count": 1}, "steps": [{"a": "cancelItem", "to": "t"}], "status": "auto"}
    if re.fullmatch(r"キャラクターのアタック宣言に対してガード宣言が行われていない場合、目標の≪パワー0のブレイクしていないキャラクタ.1人≫をガード宣言させる。このエフェクトはアタック宣言に対する直接のレスポンスでない場合でも使用宣言可能。?", text):   # A4-03 0469 / 0484
        return {"target": {"kind": "char", "sel": {"power": {"op": "=", "n": 0}, "broken": False}, "count": 1}, "steps": [{"a": "forceGuardT", "to": "t", "any": True}], "status": "auto"}
    # ---- Revise#357 ----
    m = re.fullmatch(r"このカードの使用宣言時に、(.+?キャラクタ.)1人を指定する。≪指定したキャラクターにセットされているパワーカード全て≫を捨て札する。?", text)   # A4-03 0509
    if m:
        b0 = parse_body("目標の≪" + m.group(1) + "1人≫にセットされているパワーカード全てを捨て札する。")
        if b0["status"] == "auto" and "target" in b0: return dict(b0, target=dict(b0["target"], designate=True))
    if re.fullmatch(r"このカードの使用宣言時に、対戦相手の支配エリアのネームレベルキャラクタ.1人を指定する。ターン終了時まで、≪あなたの支配キャラクター全て≫は、指定したキャラクターを目標にアタック宣言可能。?", text):   # A4-03 0573
        return {"target": {"kind": "char", "sel": {"owner": "opp", "area": "controlled", "named": True}, "count": 1, "designate": True}, "steps": [{"a": "attackableT", "to": "t", "until": "turn"}], "status": "auto"}
    m = re.fullmatch(r"このエフェクトの使用宣言時に、対戦相手の支配キャラクタ.1人を指定する。ターン終了時まで、このキャラクターが指定したキャラクターとバトルする際、≪このキャラクター≫に±0/\+(\d+)/\+(\d+)して判定する。?(このエフェクトはあなたのターンのプロジェクトカードのタイミングでのみ使用宣言可能。?)?", text)   # A4-EX01 EX0684
    if m: return dict({"target": {"kind": "char", "sel": {"owner": "opp", "area": "controlled"}, "count": 1, "designate": True}, "steps": [{"a": "mod", "to": "self", "mod": {"key": k, "op": "add", "value": int(m.group(g))}, "until": "turn", "cond": {"battleVs": "@t"}} for k, g in (("at", 1), ("de", 2))], "status": "auto"}, **({"timing": "project"} if m.group(3) else {}))
    if re.fullmatch(r"ターン終了時まで、目標の≪あなたの支配キャラクタ.1人≫から支払われたアタックコストはデッキの一番下に置かれる。ターン終了時まで、目標がアタック宣言した場合、目標のアタック宣言を取り消す。?", text):   # A4-EX01 EX0752
        return {"target": {"kind": "char", "sel": {"owner": "you", "area": "controlled"}, "count": 1}, "steps": [{"a": "payDestT", "to": "t", "cost": "attack", "dest": "deckBottom", "until": "turn"}, {"a": "watchEv", "to": "t", "event": "attack", "when": {}, "effect": {"steps": [{"a": "cancelCurrentAttack"}], "status": "auto"}, "until": "turn"}], "status": "auto"}
    # ---- Revise#356 ----
    m = re.fullmatch(r"ターン終了時まで、≪あなたが次に使用宣言する、(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)以外の、(" + WORK_ALT + r")に登場するネームを持つブレイクカード≫の必要ファクターはX減少する。?", text)   # A4-EX01 EX0696
    if m: return {"steps": [{"a": "field", "resolveN": True, "mod": {"to": "you", "key": "factorLess", "op": "add", "value": {"n": "X", "sel": {"types": ["Break"], "named": True, "works": WORKS_JP[m.group(2)], "notFaction": FACTION_JP[m.group(1)]}, "next": True}, "until": "turn"}}], "status": "auto"}
    m = re.fullmatch(r"(ターン終了時まで、≪[^≫]+≫は[^。]+。)あなたの「(「[^」]+」)」と「(「[^」]+」)」が効果を発揮している場合、(≪[^≫]+≫は[^。]+を得る。?)", text)   # A4-EX01 EX0757 / EX0758 / EX0759
    if m:
        b1, b2 = parse_body(m.group(1)), parse_body("ターン終了時まで、" + m.group(4))
        if b1["status"] == "auto" and b2["status"] == "auto" and "target" not in b1 and "target" not in b2:
            return {"steps": b1["steps"] + [dict(x, **{"if": {"ownEffectsActive": [m.group(2), m.group(3)]}}) for x in b2["steps"]], "status": "auto"}
    m = re.fullmatch(r"≪あなたのデッキの一番上のカード1枚≫を、勢力・(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)、分類・(.+?)、(.+?)を持つ(\d+)/(\d+)/(\d+)のあなたの支配キャラクター、(.+?)としてセットする。?", text)   # A4-EP EP538
    if m and class_tokens(m.group(2)) and skills_list(m.group(3)):
        return {"steps": [{"a": "deckTopToken", "name": m.group(7), "faction": FACTION_JP[m.group(1)], "icons": class_tokens(m.group(2)), "skills": skills_list(m.group(3)), "stats": {"se": int(m.group(4)), "at": int(m.group(5)), "de": int(m.group(6))}}], "status": "auto"}
    m = re.fullmatch(r"≪あなたのデッキの一番上から引いた(\d+)枚≫を、それぞれ、勢力なし、(.+?)、(.+?)・(武蔵|英国|三征西班牙|K\.P\.A\.Italia|六護式仏蘭西|M\.H\.R\.R\.|P\.A\.Oda|上越露西亜|清武田|IZUMO|三河)を持つ(\d+)/(\d+)/(\d+)のあなたの支配キャラクター、(.+?)としてセットする。?", text)   # A4-EX02 EX850
    if m and class_tokens(m.group(2)) and skills_list(m.group(3)):
        return {"steps": [{"a": "deckTopToken", "name": m.group(8), "faction": "", "icons": class_tokens(m.group(2)), "skills": skills_list(m.group(3)), "tags": [m.group(4)], "stats": {"se": int(m.group(5)), "at": int(m.group(6)), "de": int(m.group(7))}}] * int(m.group(1)), "status": "auto"}
    m = re.fullmatch(r"≪あなたのデッキ≫から、あなたが必要ファクターを満たしている、(.+?)1枚を選び、手札に加える。その後、そのデッキをシャッフルする。?", text)   # A4-EX02 EX895
    if m and deck_pick_sel(m.group(1)) is not None: return {"steps": [{"a": "pickZone", "zones": ["deck"], "owner": "you", "n": 1, "sel": dict(deck_pick_sel(m.group(1)), factorMet=True), "dest": "hand"}, {"a": "shuffle", "to": "you"}], "status": "auto"}
    # ---- Revise#355 ----
    if re.fullmatch(r"このカードを捨て札する。この効果でこのカードが捨て札になる場合、≪あなたのダメージ置き場のカード1枚≫を手札に戻す。?", text):   # A3-EX03 EX0288
        return {"steps": [{"a": "selfCardDiscard"}, {"a": "pickZone", "zones": ["damage"], "owner": "you", "dest": "hand", "n": 1, "sel": {}}], "status": "auto"}
    if re.fullmatch(r"目標の、?≪対戦相手の使用宣言中のプロジェクトカードまたはファストカード1枚≫を、そのオーナーのデッキに戻し、そのデッキをシャッフルする。その後、目標のオーナーはXドローすることが可能。Xは目標のコストに等しい。?", text):   # A3-EX02 EX0159
        return {"target": {"kind": "item", "sel": {"kind": "set", "types": ["Project", "Fast"], "notOwn": True}, "count": 1}, "steps": [{"a": "itemToDeck", "to": "t", "drawCost": True}], "status": "auto"}
    m = re.fullmatch(r"パワーカードフェイズ終了時に、≪プレイヤー全て≫はXドローする。Xは場の(武蔵|英国|三征西班牙|K\.P\.A\.Italia|六護式仏蘭西|M\.H\.R\.R\.|P\.A\.Oda|上越露西亜|清武田|IZUMO|三河)を持つキャラクターの数に等しい。?", text)   # A4-EX01 EX0736
    if m: return {"steps": [{"a": "delayed", "at": "charge", "step": {"a": "draw", "to": "players", "n": "X", "xLive": True}}], "x": {"countChars": {"tag": m.group(1)}}, "status": "auto"}
    if re.fullmatch(r"目標の≪キャラクタ.1人にセットされているカード1枚≫を、そのオーナーの手札に戻す。?", text):   # A4-02 0220
        return {"target": {"kind": "card", "sel": {"setAny": True}, "count": 1}, "steps": [{"a": "bounce", "to": "t"}], "status": "auto"}
    if re.fullmatch(r"目標の≪パーマネントカード1枚≫を、目標のオーナーのテリトリーのブレイクしているキャラクタ.1人に、パワーカードとしてセットする。?", text):   # A4-04 0676
        return {"target": {"kind": "card", "sel": {"types": ["Permanent"]}, "count": 1}, "steps": [{"a": "permToPowerPick", "to": "t"}], "status": "auto"}
    if re.fullmatch(r"≪プレイヤー全て≫は、自身の対戦相手の手札を1枚選んで捨て札する。?", text):   # A4-EP EP551
        return {"steps": [{"a": "eachOppHandDiscard", "n": 1}], "status": "auto"}
    if re.fullmatch(r"このカードを捨て札する。この効果でこのカードが捨て札になる場合、≪あなたの捨て札置き場のブレイクカード1枚≫を手札に戻す。?", text):   # EX0264
        return {"steps": [{"a": "selfCardDiscard"}, {"a": "pickZone", "zones": ["discard"], "owner": "you", "dest": "hand", "n": 1, "sel": {"types": ["Break"]}}], "status": "auto"}
    if re.fullmatch(r"ターン終了時まで、目標の≪このキャラクター以外のあなたの支配キャラクタ.1人≫に次に与えられるダメージは、このキャラクターが代わりに受ける。?", text):   # EX0265
        return {"target": {"kind": "char", "sel": {"owner": "you", "area": "controlled", "notSelf": True}, "count": 1}, "steps": [{"a": "takeForT", "to": "t", "until": "turn", "once": True}], "status": "auto"}
    if re.fullmatch(r"ターン終了時まで、次にあなたに与えられるダメージは、≪このキャラクター≫が代わりに受ける。?", text):   # EX0265
        return {"steps": [{"a": "takeForOwnerNext", "until": "turn"}], "status": "auto"}
    m = re.fullmatch(r"目標の≪あなた、またはあなたの支配キャラクターを目標にアタック宣言しているキャラクタ.1人≫にXダメージを与える。(Xは[^。]+に等しい)。?", text)   # EX0271
    if m and x_def(m.group(1)): return {"target": {"kind": "char", "sel": {"attackingYou": True}, "count": 1}, "steps": [{"a": "damage", "to": "t", "n": "X", "mental": False}], "x": x_def(m.group(1)), "status": "auto"}
    m = re.fullmatch(r"このキャラクターにセットされている(.+?)を1枚捨て札する。その後、目標の≪プレイヤーまたはパワー0のキャラクタ.1人≫に(\d+)ダメージを与える。?", text)   # EX0277
    if m: return {"target": {"kind": "charOrPlayer", "sel": {"power": {"op": "=", "n": 0}}, "count": 1}, "steps": [{"a": "permTokenDiscard", "name": m.group(1)}, {"a": "damage", "to": "t", "n": int(m.group(2)), "mental": False, "ifLast": True}], "status": "auto"}
    # ---- M2g batch 4b (Revise#157) ----
    if re.fullmatch(r"≪このターンのプレイヤー≫は、通常のパワーカードフェイズの後に追加のメインフェイズ、パワーカードフェイズをこの順番で行う。?", text):   # EP282
        return {"steps": [{"a": "field", "mod": {"to": "turnPlayer", "key": "extraPhase", "op": "grant", "until": "turn", "value": {"after": "charge", "phase": "main"}}}, {"a": "field", "mod": {"to": "turnPlayer", "key": "extraPhase", "op": "grant", "until": "turn", "value": {"after": "charge", "phase": "charge"}}}], "status": "auto"}
    if re.fullmatch(r"目標の≪使用宣言中の、あなたにダメージを与えるプロジェクトカードまたはファストカードまたはエフェクト1つ≫を無効化する。?", text):   # EP287
        return {"target": {"kind": "item", "sel": {"types": ["Project", "Fast"], "effects": True, "dealsDamage": True, "notOwn": True}, "count": 1}, "steps": [{"a": "cancelItem", "to": "t"}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで≪使用宣言中の、あなたにダメージを与えるプロジェクトカード・ファストカード・エフェクト全て≫を無効化する。?", text):   # EP288
        return {"steps": [{"a": "cancelAllDamaging"}], "status": "auto"}
    m = re.fullmatch(r"メインフェイズ終了時まで、≪このキャラクター≫は(.+?)のいずれか1つを得る。?", text)   # EP292 / EP293
    if m and skills_list(m.group(1)) and len(skills_list(m.group(1))) >= 2:
        return {"steps": [{"a": "choiceGrant", "options": [dict(sk, label=sk["id"].capitalize() + ("" if sk["x"] is True else " " + str(sk["x"]))) for sk in skills_list(m.group(1))], "until": "main"}], "status": "auto"}
    m = re.fullmatch(r"メインフェイズ終了時まで、≪このキャラクター≫は(.+?)を得、攻撃力に\+Xされる。(Xは[^。]+に等しい)。?", text)   # EP303
    if m and skills_list(m.group(1)) and x_def(m.group(2)):
        return {"steps": [{"a": "mod", "to": "self", "mod": {"key": "skill", "op": "grant", "value": {"id": sk["id"], "x": sk["x"]}}, "until": "main"} for sk in skills_list(m.group(1))] + [{"a": "mod", "to": "self", "mod": {"key": "at", "op": "add", "value": {"xvar": True, "sign": 1}}, "until": "main"}], "x": x_def(m.group(2)), "status": "auto"}
    # ---- M2g batch 4 (Revise#157) ----
    if re.fullmatch(r"≪あなたの手札のこのキャラクターと同じネームを持つブレイクカード1枚≫と≪このカード≫を入れ替える。?", text):   # EP330 …
        return {"steps": [{"a": "swapWithHand", "sameName": True}], "status": "auto"}
    # ---- M2g batch 3 (Revise#157) ----
    FJ = r"(ダークロア|E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|極星帝国|イレイザー)"
    m = re.fullmatch(r"目標の≪キャラクタ.1人≫に(\d+)ダメージを与える。このエフェクトの効果でキャラクターを捨て札した場合、あなたの捨て札置き場にある、カードテキストに「([^」]+)」を含むプロジェクトカードまたはファストカード1枚を、あなたの手札に戻す。?(" + PT + ")", text)   # EP228
    if m: return dict({"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "damage", "to": "t", "n": int(m.group(1)), "mental": False}, {"a": "ifTargetGone", "then": {"a": "pickZone", "zones": ["discard"], "owner": "you", "dest": "hand", "n": 1, "sel": {"types": ["Project", "Fast"], "textHas": m.group(2)}}}], "status": "auto"}, **({"timing": "project"} if m.group(3) else {}))
    m = re.fullmatch(r"メインフェイズ終了時まで、目標の≪キャラクタ.1人≫は、" + FJ + r"のキャラクターとしても扱い、\1のファクターを1つ得る。?", text)   # EP232 / EP261
    if m: return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "mod", "to": "t", "mod": {"key": "factor", "op": "add", "value": {"faction": FACTION_JP[m.group(1)], "n": 1}}, "until": "main"}], "status": "auto"}
    m = re.fullmatch(r"メインフェイズ終了時まで、目標の≪([^≫]+?)1人≫の攻撃力または耐久力?に\+(\d+)する。?", text)   # EP234
    if m and class_tokens(m.group(1)): return {"target": {"kind": "char", "sel": {"icons": class_tokens(m.group(1))}, "count": 1}, "steps": [{"a": "statChoice", "to": "t", "n": int(m.group(2)), "until": "main"}], "status": "auto"}
    m = re.fullmatch(r"メインフェイズ終了時まで、≪あなたの支配エリアの(.+?)全て≫の攻撃力または耐久力?に\+(\d+)する。?", text)   # EP236 / EP257
    if m:
        g = m.group(1); fm = re.fullmatch(FJ + r"のキャラクター", g)
        sel = {"faction": FACTION_JP[fm.group(1)]} if fm else ({"icons": class_tokens(g)} if class_tokens(g) else None)
        if sel is not None: return {"steps": [{"a": "statChoice", "to": {"all": dict(sel, owner="you", area="controlled")}, "n": int(m.group(2)), "until": "main"}], "status": "auto"}
    m = re.fullmatch(r"目標の≪パーマネントカード1枚≫を捨て札する。その後、メインフェイズ終了時まで、あなたの任意のキャラクタ.1人に([±+\-]\d+)/([±+\-]\d+)/([±+\-]\d+)する。?", text)   # EP240
    if m: return {"target": {"kind": "card", "sel": {"types": ["Permanent"]}, "count": 1}, "steps": [{"a": "discard", "to": "t"}, {"a": "pickCharChoiceMod", "choices": [[sign_n(m.group(i)) for i in (1, 2, 3)]], "until": "main"}], "status": "auto"}
    m = re.fullmatch(r"このエフェクトの使用宣言時に、あなたの手札の(.+?)を持つカード1枚を捨て札する。メインフェイズ終了時まで、目標の≪キャラクタ.1人≫にあなたの任意の分類1つを与える。?", text)   # EP241
    if m and class_tokens(m.group(1)): return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "pickZone", "zones": ["hand"], "owner": "you", "dest": "discard", "n": 1, "sel": {"icons": class_tokens(m.group(1))}}, {"a": "pickIconGrant", "to": "t", "until": "main"}], "status": "auto"}
    if re.fullmatch(r"目標の≪キャラクタ.1人≫のアタック宣言を取り消す。その後、あなたのデッキの一番上のカード1枚を捨て札する。この効果で捨て札したカードがネームを持っていた場合、目標にセットされているパワーカード全てをオーナーの手札に戻す。?", text):   # EP246
        return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "cancelBattle", "to": "t", "which": "attack"}, {"a": "millThen", "named": True, "then": {"a": "powerAllToHand", "to": "t"}}], "status": "auto"}
    if re.fullmatch(r"≪プレイヤー全て≫は、デッキの一番下から1ドローする。?", text):   # EP247
        return {"steps": [{"a": "drawBottomAll", "n": 1}], "status": "auto"}
    m = re.fullmatch(r"≪プレイヤー全て≫は、カード種類1つを指定し、デッキの下からX枚目のカードを公開する。公開したカードが指定した種類のカードだった場合、デッキの下からX枚全てを手札に加える。指定したカードと違った場合、そのカードのみを手札に加える。(Xは[^。]+に等しい)。?", text)
    if m and x_def(m.group(1)): return {"steps": [{"a": "bottomXGuess"}], "x": x_def(m.group(1)), "status": "auto"}
    m = re.fullmatch(r"このエフェクトの使用宣言時に、あなたの任意のあなたの手札の" + FJ + r"のカード(\d+)枚を捨て札する。メインフェイズ終了時まで、≪このキャラクター≫に([±+\-]\d+)/([±+\-]\d+)/([±+\-]\d+)する。?", text)   # EP251
    if m: return {"steps": [{"a": "pickZone", "zones": ["hand"], "owner": "you", "dest": "discard", "n": int(m.group(2)), "sel": {"faction": FACTION_JP[m.group(1)]}}] + [{"a": "mod", "to": "self", "mod": {"key": k, "op": "add", "value": sign_n(m.group(i))}, "until": "main"} for k, i in (("se", 3), ("at", 4), ("de", 5)) if sign_n(m.group(i))], "status": "auto"}
    m = re.fullmatch(r"目標の≪キャラクタ.1人≫にXダメージを与える。その後、ターン終了時まで、目標の持つスキル・エフェクト全てを無効化する。目標がイニシアチブを持っていた場合、代わりに、目標を捨て札する。(Xは[^。]+に等しい)。?", text)   # EP253
    if m and x_def(m.group(1)): return {"target": {"kind": "char", "sel": {}, "count": 1}, "x": x_def(m.group(1)), "steps": [{"a": "discardIfSkill", "to": "t", "skill": "initiative"}, {"a": "damage", "to": "t", "n": "X", "mental": False, "ifLast": True}, {"a": "mod", "to": "t", "mod": {"key": "negate", "op": "grant", "value": {"effects": True, "skills": True}}, "until": "turn", "ifLast": True}], "status": "auto"}
    m = re.fullmatch(r"このエフェクトの使用宣言時に、あなたの任意のあなたの手札1枚を捨て札する。メインフェイズ終了時まで、目標の≪キャラクタ.1人≫の攻撃力に\+(\d+)する。このエフェクトの効果で捨て札したカードがプロジェクトカードまたはファストカードだった場合、代わりに、メインフェイズ終了時まで、目標の攻撃力に\+(\d+)する。?", text)   # EP259
    if m: return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "discardHandBoost", "to": "t", "key": "at", "n": int(m.group(1)), "alt": int(m.group(2)), "ifTypes": ["Project", "Fast"], "until": "main"}], "status": "auto"}
    m = re.fullmatch(r"メインフェイズ終了時まで、≪あなたが使用するプロジェクトカード≫が与えるダメージの数値に\+(\d+)する。?", text)   # EP260
    if m: return {"steps": [{"a": "field", "mod": {"to": "you", "key": "projDmgUp", "op": "grant", "value": {"n": int(m.group(1))}, "until": "main"}}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、目標の≪あなたが使用した、ダメージを与えるプロジェクトカード・ファストカード・エフェクト1つ≫は、ファストカード・このエフェクト以外のエフェクトの効果を受けない。?", text):   # EP262
        return {"target": {"kind": "item", "sel": {"own": True, "types": ["Project", "Fast"], "effects": True, "dealsDamage": True, "notSelf": True}, "count": 1}, "steps": [{"a": "shieldItem", "to": "t"}], "status": "auto"}
    if text.rstrip("。") == "目標の≪デッキ≫の上からカードを10枚捨て札する。あなたのデッキ枚数が0枚でない場合、代わりに≪あなたのデッキ≫の上からカードを10枚捨て札する":   # Revise#151
        return {"target": {"kind": "player", "sel": {}, "count": 1}, "steps": [{"a": "millInstead", "to": "t", "n": 10}], "status": "auto"}
    if text.rstrip("。") == "ターン終了時まで、≪このキャラクターと、このキャラクターにセットされているカード全て≫は、対戦相手の使用したプロジェクトカード・ファストカード・エフェクトの効果を受けない":
        return {"steps": [{"a": "mod", "to": "self", "mod": {"key": "untargetable", "op": "grant", "value": {"from": ["Project", "Fast", "Effect"], "byOpp": True}}, "until": "turn"}], "status": "auto"}
    if re.fullmatch(r"≪あなたの捨て札置き場にあるブレイクカード全て≫を、あなたの手札に加える。?", text): return {"steps": [{"a": "pileAllToHand", "pile": "discard", "type": "Break"}], "status": "auto"}   # Revise#141
    if re.fullmatch(r"≪あなたの任意のキャラクター1人を構成するブレイクカード全て≫を捨て札(?:可能|する)。?", text): return {"steps": [{"a": "stripBreaksPick"}], "status": "auto"}   # Revise#139
    m = re.fullmatch(r"≪あなたの手札またはダメージ置き場の「([^」]+)」1枚≫をこのキャラクターにセット(?:可能|する)。その後、あなたの任意の≪あなたの対戦相手の支配キャラクター1人とそのオーナー≫に、このキャラクターの攻撃力に等しいダメージを与える。?", text)
    if m: return {"steps": [{"a": "namedPermToSelf", "name": m.group(1)}, {"a": "oppCharOwnerDamage", "stat": "at"}], "status": "auto"}
    if re.fullmatch(r"≪あなたの対戦相手全ての手札全て≫を捨て札する。その後、≪あなた≫はXドロー可能。Xはこの効果で捨て札された手札枚数の合計に等しい。?", text):   # Revise#139
        return {"steps": [{"a": "handAll", "to": "opp", "dest": "discard"}, {"a": "mayDraw", "n": "last"}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、≪このキャラクター≫は、(?:本来の勢力に加え、)?あなたの任意の勢力1つのキャラクター(?:として|としても)扱われ(?:る|、その勢力のファクターを1つ得る)。?", text):   # + A3-09 1416 (Revise#172)
        return {"steps": [{"a": "alsoFactionPick", "until": "main"}], "status": "auto"}
    m = re.fullmatch(r"≪プレイヤー全てとキャラクター全て≫に(\d+)ダメージを与える。(このエフェクトはあなたのターンのプロジェクトカードのタイミングでのみ使用(?:宣言)?可能。?)?", text)   # Revise#138
    if m: return dict({"steps": [{"a": "damage", "to": "players", "n": int(m.group(1))}, {"a": "damage", "to": {"all": {}}, "n": int(m.group(1))}], "status": "auto"}, **({"timing": "project"} if m.group(2) else {}))
    if re.fullmatch(r"メインフェイズ終了時まで、≪このキャラクター≫は精神攻撃力を失い、攻撃力に\+Xされる。(?:Xは失った精神攻撃力の数値に等しい。?)?", text):
        return {"steps": [{"a": "mod", "to": "self", "mod": {"key": "atMental", "op": "set", "value": False}, "until": "main"}], "status": "auto"}
    m = re.fullmatch(r"メインフェイズ終了時まで、≪あなたの対戦相手全て≫は、ファストカードを使用宣言する場合、宣言時に追加の(X|\d+)コストを支払わなければならない。?(?:(Xは[^。]+に等しい)。?)?", text)   # エレクトラ (Revise#138)
    if m and (m.group(1) != "X" or (m.group(2) and x_def(m.group(2)))):
        return dict({"steps": [{"a": "field", "resolveN": True, "mod": {"to": "opp", "key": "cardCost", "op": "add", "until": "main", "value": {"n": "X" if m.group(1) == "X" else int(m.group(1)), "sel": {"types": ["Fast"]}}}}], "status": "auto"}, **({"x": x_def(m.group(2))} if m.group(1) == "X" else {}))
    if re.fullmatch(r"目標の≪勢力エリアのキャラクター1人≫を、そのオーナーの支配エリアに移動させる。?", text):   # Revise#137
        return {"target": {"kind": "char", "sel": {"area": "party"}, "count": 1}, "steps": [{"a": "toControl", "to": "t"}], "status": "auto"}
    m = re.fullmatch(r"メインフェイズ終了時まで、目標の、?≪(あなたの支配キャラクター|キャラクター)1人≫にネーム[”“\"]([^”\"]+)[”\"]を与える。?", text)   # ダニエル・ポーラン (Revise#137)
    if m: return {"target": {"kind": "char", "sel": {"owner": "you", "area": "controlled"} if m.group(1).startswith("あなた") else {}, "count": 1}, "steps": [{"a": "mod", "to": "t", "mod": {"key": "alsoName", "op": "grant", "value": m.group(2)}, "until": "main"}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、≪このキャラクター≫は、本来の勢力に加え、あなたの任意の勢力1つのキャラクターとしても扱われる。?", text):   # Revise#137
        return {"steps": [{"a": "alsoFactionPick", "until": "main"}], "status": "auto"}
    m = re.fullmatch(r"あなたの手札のプロジェクトカードまたはファストカード1枚を捨て札する。その後、目標の≪キャラクター1人≫に、Xダメージを与える。Xはこの効果で捨て札したカードの必要ファクターに等しい。?(このエフェクトはあなたのターンのプロジェクトカードのタイミングでのみ使用宣言可能。?)?", text)   # Works373 (Revise#137)
    if m: return dict({"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "discardTypeX", "types": ["Project", "Fast"]}, {"a": "damageLast", "to": "t"}], "status": "auto"}, **({"timing": "project"} if m.group(1) else {}))
    if re.fullmatch(r"メインフェイズ終了時まで、目標の≪キャラクター1人≫からコストを支払うことはできない。目標がダメージを受けた場合、このエフェクトの効果は終了する。?", text):   # ヘルマ (Revise#136)
        return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "mod", "to": "t", "mod": {"key": "noPay", "op": "grant", "value": {"endOnDamage": True}}, "until": "main"}], "status": "auto"}
    if re.fullmatch(r"目標の≪プレイヤー1人≫に(\d+)ダメージを与える。その後、この効果でダメージを受けた目標の手札から、あなたの任意のカード1枚を捨て札する。?", text):   # ケイト
        n = int(re.match(r"目標の≪プレイヤー1人≫に(\d+)", text).group(1))
        return {"target": {"kind": "player", "sel": {}, "psel": {}, "count": 1}, "steps": [{"a": "damage", "to": "t", "n": n}, {"a": "handTake", "to": "t", "n": 1, "dest": "discard"}], "status": "auto"}
    if re.fullmatch(r"≪あなた≫は、あなたのデッキの一番上のカード1枚を引き、プレイヤー全てに見せる。そのカードがブレイクカードだった場合、そのカードをあなたの手札に加える。そのカードがブレイクカード以外だった場合、そのカードを捨て札し、同じ手順を繰り返す。?", text):   # レックス (Revise#136)
        return {"steps": [{"a": "revealUntilBreak"}], "status": "auto"}
    m = re.fullmatch(r"目標の≪(ダメージ置き場の)?プロジェクトカードまたはファストカード1枚≫を捨て札する。その後、(?:このキャラクターのオーナーは目標のコストに等しい枚数ドローしてもよい|そのカードのオーナーに、目標の必要ファクターに等しいダメージを与える)。?", text)   # 伊雑あざか
    if m:
        tgt = {"kind": "card", "sel": dict({"types": ["Project", "Fast"]}, **({"zones": ["damage"]} if m.group(1) else {})), "count": 1}
        if "ドロー" in text: return {"target": tgt, "steps": [{"a": "discard", "to": "t"}, {"a": "mayDraw", "n": "X"}], "x": {"targetCost": True}, "status": "auto"}
        return {"target": tgt, "steps": [{"a": "discard", "to": "t"}, {"a": "damage", "to": "tOwner", "n": "X"}], "x": {"targetFactor": True}, "status": "auto"}
    m = re.fullmatch(r"このエフェクトの使用宣言時に、あなたの任意のエリア1つを指定する。≪指定したエリアのキャラクター全て≫に(\d+)ダメージを与える。?", text)   # Revise#136
    if m: return {"steps": [{"a": "areaDamage", "n": int(m.group(1))}], "status": "auto"}
    if re.fullmatch(r"目標の≪あなたのデッキまたはあなたのダメージ置き場の、このキャラクターと同じネームを持つブレイクカード1枚≫を、このキャラクターを目標に使用宣言する。その後、このエフェクトのコストをこのキャラクターにパワーカードとしてセットする。あなたのデッキのカードをこのエフェクトの対象としていた場合、そのデッキをシャッフルする。?(?:Xは目標のコストに等しい。?)?", text):   # 美作壱与
        return {"steps": [{"a": "costTo", "to": "hold"}, {"a": "sameNameBreakToSelf"}, {"a": "costAsPower", "to": "self"}], "costTo": "hold", "status": "auto"}
    m = re.fullmatch(r"あなたは、カード名称を1つ指定する。メインフェイズ終了時まで、このキャラクターがプレイヤーにアタックした場合、≪アタックを受けたプレイヤー≫は手札全てをプレイヤー全てに見せる。見せた手札の中に指定した名称のカードがあった場合、そのプレイヤーの手札全てをそのプレイヤーのダメージ置き場に置く。?", text)   # キャッツアイ
    if m: return {"steps": [{"a": "cardNameChoose"}, {"a": "field", "mod": {"to": "you", "key": "watch", "op": "grant", "until": "main", "value": {"on": "attack", "toPlayer": True, "selfAttacks": True, "name": "chosen", "sel": {}, "effect": {"steps": [{"a": "handNameCheck"}], "status": "auto"}}}}], "status": "auto"}
    if re.fullmatch(r"≪このエフェクトのコスト≫を、あなたの任意のあなたの支配キャラクター1人に、パーマネントカード・糸としてセットする。糸をセットされているキャラクターは、精神力に-1され、分類・傀儡、インターセプトを持つ。?", text):   # 河原瑠璃子
        return {"steps": [{"a": "costTo", "to": "hold"}, {"a": "threadPerm"}], "costTo": "hold", "status": "auto"}
    # ---- M2b batch 2 (Revise#129): attacks / guards made by an effect ----
    if re.fullmatch(r"メインフェイズ終了時まで、≪このキャラクター≫はあなたの任意の勢力のファクターをX得る。メインフェイズ終了時まで、あなたが使用宣言した、その勢力の必要ファクターがX以下のプロジェクトカード・ファストカードのコストをあなたのデッキに戻し、そのデッキをシャッフルする。?", text):   # 喜多村みかる
        return {"steps": [{"a": "factorPickX"}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、このキャラクターのアタック宣言に対して支配キャラクターがガード宣言するか、このキャラクターが支配キャラクターのアタック宣言に対してガード宣言した場合、≪キャラクター全て≫に\(X\)ダメージを与える。メインフェイズ終了時まで、このキャラクターが支配キャラクターとのバトルまたはあなた以外のプレイヤーの使用したプロジェクトカード・ファストカード・エフェクトの効果によって捨て札になる場合、≪あなたの対戦相手全て≫の手札から、あなたの任意のX枚までを、そのオーナーのダメージ置き場に置く。?", text):   # ミナ・アグリッパ (X = the cost paid)
        hit = {"steps": [{"a": "damage", "to": {"all": {}}, "n": "X", "mental": True}], "status": "auto"}
        w = lambda flag: {"a": "field", "storeX": True, "mod": {"to": "you", "key": "watch", "op": "grant", "until": "main", "value": {"on": "guard", flag: True, "sel": {"area": "controlled"} if flag == "vsSelf" else {}, "ctlOpp": True, "effect": hit}}}
        return {"steps": [w("vsSelf"), w("selfGuards"), {"a": "leaveHit", "until": "main"}], "status": "auto"}
    if re.fullmatch(r"≪あなたの支配キャラクター全て≫にセットされているパワーカード全てをあなたのデッキに戻し、デッキをシャッフルする。その後、あなたのターンを終了する。その後、対戦相手のターンをメインフェイズから行う。?(?:このエフェクトはあなたのメインフェイズのプロジェクトカードのタイミングでのみ使用宣言可能。?)?", text):   # モイライ
        return {"steps": [{"a": "moiraiEnd"}], "timing": "project", "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、このキャラクターのアタック宣言に対してガード宣言された場合、≪本来のアタック目標と、このキャラクターのアタック宣言に対してガード宣言したキャラクター≫に、ただちにXダメージを与える。?", text):   # K-100: X = the cost paid now
        return {"steps": [{"a": "field", "storeX": True, "mod": {"to": "you", "key": "watch", "op": "grant", "until": "main", "value": {"on": "guard", "vsSelf": True, "sel": {}, "effect": {"steps": [{"a": "damage", "to": "battleTarget", "n": "X"}, {"a": "damage", "to": "evCh", "n": "X"}], "status": "auto"}}}}], "status": "auto"}
    if re.fullmatch(r"≪このキャラクター≫は、目標の、?≪?アタック宣言しているあなたの支配キャラクター1人≫?と同じアタック目標に対してアタック宣言する。その後、目標のアタック宣言を取り消す。目標がガード宣言されていた場合、目標に対してガード宣言しているキャラクターのガード宣言の対象を、このキャラクターに変更する。?", text):
        return {"target": {"kind": "char", "sel": {"attacking": True, "owner": "you", "area": "controlled", "notSelf": True}, "count": 1}, "steps": [{"a": "swapAttacker", "who": "self"}], "status": "auto"}
    if re.fullmatch(r"目標の≪アタック宣言しているあなたの支配キャラクター1人≫のアタック宣言を取り消す。その後、あなたの任意のあなたの支配キャラクター1人を、目標がアタック宣言していた対象にアタック宣言させる。目標がガード宣言されていた場合、目標に対するガード宣言の対象を、アタック宣言させるキャラクターに変更する。?", text):
        return {"target": {"kind": "char", "sel": {"attacking": True, "owner": "you", "area": "controlled"}, "count": 1}, "steps": [{"a": "swapAttacker", "who": "pick"}], "status": "auto"}
    if re.fullmatch(r"目標の≪ガード宣言しているあなたの支配キャラクター1人≫のガード宣言を取り消す。その後、あなたの任意のあなたの支配キャラクター1人を、目標がガード宣言していたキャラクターに対してガード宣言させる。?", text):
        return {"target": {"kind": "char", "sel": {"guarding": True, "owner": "you", "area": "controlled"}, "count": 1}, "steps": [{"a": "swapGuard"}], "status": "auto"}
    m = re.fullmatch(r"目標の、≪精神力X以下のあなたの支配キャラクター1人≫にアタック宣言させる。(Xは[^。]+に等しい。?)?", text)
    if m:
        return dict({"target": {"kind": "char", "sel": {"stat": [{"key": "se", "op": "<=", "n": "X"}], "owner": "you", "area": "controlled"}, "count": 1}, "steps": [{"a": "makeAttack", "to": "t"}], "status": "auto"}, **({"x": x_def(m.group(1).rstrip("。"))} if m.group(1) and x_def(m.group(1).rstrip("。")) else {}))
    if re.fullmatch(r"あなたは、≪あなたの手札のコストX以下のブレイクカード1枚≫を、あなたの支配キャラクターにファクター・コストを無視してセットする。その後、あなたの対戦相手は、≪あなたの対戦相手の手札のコストX以下のブレイクカード1枚≫を、ファクター・コストを無視してあなたの対戦相手の支配キャラクターにセットすることができる。どちらの場合も、分類・ネーム・ブレイク条件は満たしていなければならない。?", text):   # タミ
        return {"steps": [{"a": "freeBreakSet", "opponents": True}], "status": "auto"}
    m = re.fullmatch(r"≪このターンのプレイヤー≫は、通常の(ドロー|勢力|メイン|パワーカード|ディスカード)フェイズの(後|前)に追加の(ドロー|勢力|メイン|パワーカード|ディスカード)フェイズを行う。?", text)   # ベルダンディ (Revise#131)
    if m:
        PH = {"ドロー": "draw", "勢力": "active", "メイン": "main", "パワーカード": "charge", "ディスカード": "discard"}
        return {"steps": [{"a": "field", "mod": {"to": "turnPlayer", "key": "extraPhase", "op": "grant", "until": "turn", "value": {("after" if m.group(2) == "後" else "before"): PH[m.group(1)], "phase": PH[m.group(3)]}}}], "status": "auto"}
    m = re.fullmatch(r"目標の≪プレイヤー1人≫の手札全てを捨て札する。?(このエフェクトはあなたのメインフェイズのプロジェクトカードのタイミングでのみ使用宣言可能。?)?", text)   # Revise#131
    if m: return dict({"target": {"kind": "player", "sel": {}, "psel": {}, "count": 1}, "steps": [{"a": "handAll", "to": "t", "dest": "discard"}], "status": "auto"}, **({"timing": "project"} if m.group(1) else {}))
    if re.fullmatch(r"≪あなたの任意のあなたの対戦相手1人のダメージ置き場のカード全て≫を捨て札する。?", text): return {"steps": [{"a": "pileWipe", "zone": "damage"}], "status": "auto"}
    if re.fullmatch(r"目標の、≪あなたのデッキまたはあなたの捨て札置き場≫の必要ファクタ[ー-]X以下のパーマネントカード1枚を、あなたの任意のあなたの支配エリアのキャラクター1人にセットする。このエフェクトの目標をあなたのデッキにした場合、その後、あなたのデッキをシャッフルする。?", text):   # 須藤りのん
        return {"steps": [{"a": "pickZone", "zones": ["deck", "discard"], "owner": "you", "sel": {"types": ["Permanent"], "factorMax": "X"}, "n": 1, "dest": "perm"}], "status": "auto"}
    m = re.fullmatch(r"≪あなたの任意のあなたの手札(X|\d+)枚≫を捨て札する。(?:X|\d+)枚を捨て札できない場合、あなたの手札全てを捨て札する。(?:(Xは[^。]+に等しい)。?)?", text)   # サン“コロナ”: as many as you can
    if m and (m.group(1) != "X" or (m.group(2) and x_def(m.group(2)))):
        return dict({"steps": [{"a": "handDiscard", "to": "you", "n": "X" if m.group(1) == "X" else int(m.group(1))}], "status": "auto"}, **({"x": x_def(m.group(2))} if m.group(1) == "X" else {}))
    m = re.fullmatch(r"ターン終了時まで、目標の≪キャラクター1人≫に±0/[ー\-]5(?:・[ー\-]\(5\))?/[ー\-]5し、このキャラクターに±0/\+\(5\)/\+5する。(.*)", text)   # 羽生美輝
    if m:
        rest = parse_body(m.group(1)) if m.group(1) else {"steps": [], "status": "auto"}
        if rest["status"] == "auto" and not rest.get("target"):
            return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "stat", "to": "t", "key": "at", "n": -5, "until": "turn"}, {"a": "stat", "to": "t", "key": "de", "n": -5, "until": "turn"}, {"a": "stat", "to": "self", "key": "at", "n": 5, "until": "turn"}, {"a": "stat", "to": "self", "key": "de", "n": 5, "until": "turn"}] + rest["steps"], "status": "auto"}
    # ---- M2b batch 3 (Revise#130) ----
    if re.fullmatch(r"メインフェイズ終了時まで、≪このキャラクター≫は、目標の≪キャラクター1人≫のスキル全てを得る。?", text):   # 服部忍
        return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "copySkills", "to": "t", "until": "main"}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、≪このキャラクターのアタック宣言に対してガード宣言するか、このキャラクターにガード宣言された、精神力X以下のキャラクター≫をただちに捨て札する。?", text):   # ヒルダ・ミナカミ: X = the cost paid
        w = lambda flag, who: {"a": "field", "storeX": True, "mod": {"to": "you", "key": "watch", "op": "grant", "until": "main", "value": {"on": "guard", flag: True, "sel": {}, "effect": {"steps": [{"a": "killIfSe", "who": who}], "status": "auto"}}}}
        return {"steps": [w("vsSelf", "guard"), w("selfGuards", "attacker")], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、目標の≪キャラクター1人≫のアタックによるダメージ判定の手順で、ブレイクカードがダメージ置き場に置かれた場合、ダメージ判定の手順はそこで終了する。?", text):   # スフィンクス
        return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "mod", "to": "t", "mod": {"key": "stopOnBreak", "op": "grant", "value": True}, "until": "main"}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、目標の≪ネームレベルキャラクター1人≫が除去された場合、このキャラクターを捨て札する。メインフェイズ終了時まで、このキャラクターが支配キャラクターとのバトルによって捨て札される場合、目標を捨て札する。?", text):   # モリーアン
        return {"target": {"kind": "char", "sel": {"named": True}, "count": 1}, "steps": [{"a": "fateLink", "to": "t", "until": "main"}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、目標の≪キャラクター1人≫がバトルまたはあなた以外のプレイヤーの使用したカード・エフェクトの効果によって除去される場合、目標と、目標にセットされているカード全てはオーナーの手札に戻る。?", text):   # クララ・クロオーネ
        return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "mod", "to": "t", "mod": {"key": "leaveToHand", "op": "grant", "value": True}, "until": "main"}], "status": "auto"}
    # ---- M2b (Revise#126) ----
    if re.fullmatch(r"≪このキャラクター≫のアタック宣言またはガード宣言を取り消す。その後、≪このキャラクターと、アタック宣言またはガード宣言しているキャラクター全てを構成するカード全て≫を、そのオーナーの手札に戻す。?", text):   # 千頭さとり
        return {"steps": [{"a": "battleBounce"}], "status": "auto"}
    t0 = re.sub(r"\s+", "", text)
    if re.fullmatch(r"目標の≪あなたの支配キャラクタ[ー\-－]1人≫に、目標と同じ分類を持つ、あなたの手札のあなたの任意のブレイクカード1枚を、ファクターを無視してセットする。ネーム・ブレイク条件は満たしていなければならない。Xはそのカードのコストに等しい。?", t0):   # A3-09 1417 (Revise#252)
        return {"target": {"kind": "char", "sel": {"owner": "you", "area": "controlled"}, "count": 1}, "steps": [{"a": "effDecl", "zones": ["hand"], "types": ["Break"], "costEq": "X", "freeCost": True, "ignoreFactor": True, "onto": "t"}], "status": "auto"}
    if re.fullmatch(r"目標の≪プレイヤ[ー\-－]1人≫は、自分のデッキの上から3枚をあなたの対戦相手全てに見せる。その後、その3枚をあなたの任意の順番でデッキの上に戻す。その後、目標にそのデッキをシャッフルさせることができる。?", t0):   # A3-07 1071 (Revise#255)
        return {"target": {"kind": "player", "sel": {}, "psel": {}, "count": 1}, "steps": [{"a": "reorderTopOf", "to": "t", "n": 3}], "status": "auto"}
    if re.fullmatch(r"≪あなたのデッキの一番上のカード1枚≫を全てのプレイヤーに見せる。目標がブレイクカードだった場合、あなたの任意のあなたの支配キャラクタ[ー\-－]1人に、目標をファクター・コストを無視してセット可能。分類・ネーム・ブレイク条件は満たしていなければならない。目標をセットした場合、あなたのメインフェイズをただちに終了する。目標をセットしなかった場合、目標を捨て札する。目標がブレイクカード以外だった場合、目標をあなたのダメージ置き場に置く。?", t0):   # A3-09 1384 (Revise#255)
        return {"steps": [{"a": "topBreakSetOrDamage"}], "status": "auto"}
    if re.fullmatch(r"あなたはカード種類1つを指定する。目標の≪プレイヤ[ー\-－]1人≫は、指定された種類のカードが出るまで、目標のデッキの上から1枚ずつプレイヤー全てに見せ、最初に出た指定された種類のカード1枚を目標のダメージ置き場に置く。その後、目標は見せたカードを目標のデッキに戻し、そのデッキをシャッフルする。指定された種類のカードが出る前にデッキを全て見せた場合、見せたカード全てをシャッフルして目標のデッキ置き場に戻す。?", t0):   # A3-09 1484 (Revise#255)
        return {"target": {"kind": "player", "sel": {}, "psel": {}, "count": 1}, "steps": [{"a": "revealUntilTypeDamage", "to": "t"}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、目標の≪ブレイクしているキャラクタ[ー\-－]1人≫がガードした場合、目標にガードされたキャラクターのオーナーの手札から、あなたの任意のカードをX枚まで捨て札する。?", t0):   # A3-07 1106 (Revise#255)
        return {"target": {"kind": "char", "sel": {"broken": True}, "count": 1}, "steps": [{"a": "watchEv", "to": "t", "event": "guarded", "when": {"self": True, "asGuard": True}, "useBound": True, "evAttacker": True, "effect": {"steps": [{"a": "handTake", "to": "evOwner", "n": "X", "upTo": True, "dest": "discard"}], "status": "auto"}, "until": "main"}], "status": "auto"}
    if re.fullmatch(r"このカードが効果を発揮した場合、あなたの任意のキャラクタ[ー\-－]1人を指定する。その後、≪指定したキャラクターにセットされているパワーカード1枚≫を捨て札する。メインフェイズ終了時まで、≪指定したキャラクターと同じ分類を持つキャラクター≫からコストが支払われた場合、そのキャラクターに\(1\)ダメージを与える。?", t0):   # A3-09 1319 (Revise#255)
        return {"steps": [{"a": "designatePowerIconHit"}], "status": "auto"}
    if re.fullmatch(r"ターン終了時まで、≪このカード≫を、勢力・なし、分類・式神の支配キャラクタ.・式神刹那式としてセットする。式神刹那式は、あなたの手札全てをパワーカードとして持ち、パワーに等しい精神力・攻撃力・耐久力を持つ。式神刹那式は、セットされた瞬間にガード宣言可能。式神刹那式にカードをセットすることはできない。式神刹那式からガードコスト以外のコストを支払うことはできない。パワーカードフェイズ終了時に、式神刹那式にセットされているカード全てはオーナーの手札に戻る。?", t0):   # A3-04 0654 / 0657 (Revise#256)
        return {"steps": [{"a": "cardToken", "name": "式神刹那式", "stats": "power", "icons": ["式神"], "skills": [], "noSet": True, "power": "handAll", "payOnly": ["guard"], "dismissAt": "turn"}], "status": "auto"}
    if re.fullmatch(r"≪このカード≫を、このカードのコストと、あなたの任意のあなたの手札X枚をパワーカードとして持つ、勢力なし、分類・式神を持つあなたの支配キャラクタ.、式神吽式としてセットする。式神吽式はパワーに等しい精神力・攻撃力・耐久力と、エフェクト「1:目標の≪プロジェクトカードまたはファストカード1枚≫を捨て札する。」を持つ。式神吽式にカードをセットすることはできない。式神吽式からエフェクトコスト以外のコストを支払うことはできない。?", t0.replace("：", ":")):   # A3-09 1353 (Revise#256)
        ef = dict({"cost": 1, "text": "1:目標の≪プロジェクトカードまたはファストカード1枚≫を捨て札する。"}, **parse_body("目標の≪プロジェクトカードまたはファストカード1枚≫を捨て札する。"))
        return {"costTo": "hold", "steps": [{"a": "costTo", "to": "hold"}, {"a": "cardToken", "name": "式神吽式", "stats": "power", "icons": ["式神"], "skills": [], "noSet": True, "power": "costAndHandX", "payOnly": ["effect"], "effects": [ef]}], "status": "auto"}
    if re.fullmatch(r"このカードの使用宣言時に、あなたは、任意の勢力1つを指定し、あなたのデッキの上からX枚をあなたのダメージ置き場に置く。メインフェイズ終了時まで、≪指定した勢力のキャラクター全て≫に\+X/\+X・\+\(X\)/\+Xする。?", t0):   # A3-07 1206 (Revise#256)
        return {"steps": [{"a": "mill", "to": "you", "n": "X", "zone": "damage"}, {"a": "factionAllStats", "until": "main"}], "status": "auto"}
    if re.fullmatch(r"≪プレイヤー全て≫は、自分のデッキの上からX枚引き、アタック宣言またはガード宣言している自分の支配キャラクタ.1人につき1枚ずつ、引いたカードをパワーカードとしてセットする。Xは対象それぞれの、アタック宣言またはガード宣言している支配キャラクターの数に等しい。その後、≪キャラクター全てのアタック宣言≫を取り消す。その後、≪使用宣言中のプロジェクトカード・ファストカードと、効果を発揮している持続のプロジェクトカード・ファストカード全て≫をオーナーの手札に戻す。?", t0):   # A3-09 1488 (Revise#256)
        return {"steps": [{"a": "battleRecall"}], "status": "auto"}
    if re.fullmatch(r"あなたの任意のあなたの手札の、コストX以下のブレイクカード1枚を指定する。ターン終了時まで、指定したカードを全てのプレイヤーに見せてプレイする。メインフェイズ終了時まで、目標の≪キャラクタ.1人≫と、指定したカードの能力値を合計して判定する。ターン終了時まで、目標は指定したカードの持つスキル全てを得る。ターン終了時までに目標が除去された場合、指定したカードは捨て札される。?", t0):   # A3-09 1322 (Revise#256)
        return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "breakLend"}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、目標の≪あなたのテリトリーのキャラクタ.1人≫にステルスを与える。メインフェイズ終了時まで、目標がアタックした場合、目標にセットされているカード全てを捨て札する。その後、目標をアクティブキャラクターにする。その後、このカードを捨て札する。目標が勢力キャラクターだった場合、目標はあなたの支配エリアに移動し、あなたの任意のプレイヤ.1人にアタック宣言する。アタック宣言の目標になったプレイヤーはガード宣言可能。?", t0):   # A3-11 1741 (Revise#257)
        return {"target": {"kind": "char", "sel": {"owner": "you"}, "count": 1}, "steps": [{"a": "mod", "to": "t", "mod": {"key": "skill", "op": "grant", "value": {"id": "stealth", "x": True}}, "until": "main"}, {"a": "watchEv", "to": "t", "event": "attack", "when": {"self": True}, "useBound": True, "effect": {"steps": [{"a": "stripActiveEv"}], "status": "auto"}, "until": "main"}, {"a": "activeToAttack", "to": "t"}], "status": "auto"}
    if re.fullmatch(r"目標の≪あなたの支配キャラクタ.1人≫をアタック宣言またはガード宣言させる。?(?:このカードは目標がアタック宣言またはガード宣言できるタイミングでのみ使用宣言可能。?)?", t0):   # A3-20 2695 (Revise#258); A4-01 0183 (Revise#346): the timing sentence adds nothing
        return {"target": {"kind": "char", "sel": {"owner": "you", "area": "controlled"}, "count": 1}, "steps": [{"a": "attackOrGuard", "to": "t"}], "status": "auto"}
    if re.fullmatch(r"アタック宣言しているキャラクターを、目標の≪アタック宣言しているキャラクターのオーナーの支配キャラクタ.1人≫に変更する。?", t0):   # A3-22 3129 (Revise#258)
        return {"target": {"kind": "char", "sel": {"area": "controlled", "attackerTeam": True}, "count": 1}, "steps": [{"a": "swapAttackerTo", "to": "t"}], "status": "auto"}
    if re.fullmatch(r"≪あなたのデッキ≫の上からカードを3枚ダメージ置き場に置く。その後、≪あなた≫は1ドローし、あなたの捨て札置き場、ダメージ置き場から、あなたの任意のカード1枚ずつを手札に戻す。?", t0):   # A3-24 3473 (Revise#258)
        return {"steps": [{"a": "mill", "to": "you", "n": 3, "zone": "damage"}, {"a": "draw", "to": "you", "n": 1}, {"a": "pilesOneEachToHand", "to": "you"}], "status": "auto"}
    if re.fullmatch(r"≪プレイヤー全て≫は、自分の手札、捨て札置き場、ダメージ置き場のカード全てを、そのオーナーのデッキに戻してシャッフルする。その後、対象は7ドローする。?", t0):   # A3-25 3802 (Revise#258)
        return {"steps": [{"a": "resetAllDraw", "n": 7}], "status": "auto"}
    if re.fullmatch(r"あなたは、目標の≪プレイヤ.1人≫の手札を見る。その中のキャラクターカード以外のカード1枚をオーナーのデッキの一番下に置くことが可能。そうした場合、目標は1ドローする。?", t0):   # A3-25 3696 (Revise#258)
        return {"target": {"kind": "player", "sel": {}, "psel": {}, "count": 1}, "steps": [{"a": "peekHandBottomDraw", "to": "t"}], "status": "auto"}
    if re.fullmatch(r"ターン終了時まで、目標の≪パーマネントカードがセットされていないキャラクタ.1人≫の攻撃力に\+2する。目標がパーマネント-Xのスキルを持つ場合、目標はイニシアチブ・ペネトレイトを得る。目標の持つパーマネント-Xのスキル全ての、Xの合計が2以上の場合、目標の攻撃力に\+3する。?", t0):   # A3-24 3435 (Revise#258)
        return {"target": {"kind": "char", "sel": {"noPerm": True}, "count": 1}, "steps": [{"a": "mod", "to": "t", "mod": {"key": "at", "op": "add", "value": 2}, "until": "turn"}, {"a": "permMinusBoost", "to": "t", "until": "turn"}], "status": "auto"}
    if re.fullmatch(r"このカードの使用宣言時に、カード名称1つと、プレイヤ.1人を指定する。あなたは、指定したプレイヤーの手札全てを見て、≪キャラクターカード以外の、指定したカード名称のカード全て≫を捨て札する。?", t0):   # A3-22 3130 (Revise#262)
        return {"target": {"kind": "player", "sel": {}, "psel": {}, "count": 1, "designate": True}, "steps": [{"a": "cardNameChoose"}, {"a": "handNameDiscard", "to": "t"}], "status": "auto"}
    if re.fullmatch(r"目標の≪プレイヤ.1人≫の手札から、あなたの任意のカード3枚までを、目標のデッキの上に戻す。その後、目標のデッキのあなたの任意の場所から、デッキの上に戻した枚数に等しい枚数選んで、目標の手札に加える。その後、そのデッキをシャッフルする。その後、あなたは1ドローする。?", t0):   # A3-22 3309 (Revise#262)
        return {"target": {"kind": "player", "sel": {}, "psel": {}, "count": 1}, "steps": [{"a": "handSwapDeck", "to": "t"}], "status": "auto"}
    if re.fullmatch(r"このカードの使用宣言時に、あなたの支配キャラクタ.1人を指定する。メインフェイズ終了時まで、≪あなたの支配キャラクター全て≫から、指定したキャラクターのアタックコスト・エフェクトコストを代わりに支払うことが可能。?", t0):   # A3-16 2177 (Revise#263)
        return {"steps": [{"a": "designatePayFor", "until": "main"}], "status": "auto"}
    m = re.fullmatch(r"このカードの使用宣言時に、あなたの任意のキャラクタ.X体を指定する。(Xは[^。]+に等しい)。メインフェイズ終了時まで、≪このカードの使用宣言時に指定したキャラクター全て≫の持つスキル・エフェクト全てと、アタック宣言・ガード宣言を無効化する。メインフェイズ終了時まで、対象からコストを支払うことはできない。メインフェイズ終了時まで、対象はファクター全てを失う。?", t0)   # A3-19 2551 (Revise#263)
    if m and x_def(m.group(1)): return {"steps": [{"a": "designateShutdown", "until": "main"}], "x": x_def(m.group(1)), "status": "auto"}
    if re.fullmatch(r"このカードの使用宣言時に、ネームを持つあなたの支配キャラクタ.1人を指定する。メインフェイズ終了時まで、≪指定したキャラクターと同じ分類を持つ、ネームレベルでないあなたの支配キャラクター全て≫の攻撃力に\+1する。メインフェイズ終了時まで、対象に指定したキャラクターの持つスキル全てを与える。?", t0):   # A3-14 2028 (Revise#257)
        return {"steps": [{"a": "namedShareBoost", "until": "main"}], "status": "auto"}
    if re.fullmatch(r"≪あなたのダメージ置き場にあるネームレベルでないブレイクカード全て≫を、あなたの支配キャラクターとしてセットする。ターン終了時まで、この効果でセットされたキャラクターはアンデッド・インターセプトを持ち、ターン終了時にあなたのダメージ置き場に置かれる。このカードが除去された場合、このカードの効果でセットされたキャラクター全てをあなたのダメージ置き場に置く。?", t0):   # A3-09 1453 (Revise#253): a Fast card is not on the field to be removed
        return {"steps": [{"a": "undeadRise"}], "status": "auto"}
    if re.fullmatch(r"分類1つを指定する。メインフェイズ終了時まで、≪指定された分類を持つキャラクター≫が捨て札になった場合、そのキャラクターを構成するカード全ては、そのオーナーのダメージ置き場に置かれる。?", t0):   # A3-09 1452 (Revise#252)
        return {"steps": [{"a": "pickIcon"}, {"a": "iconLeaveToDamage", "until": "main"}], "status": "auto"}
    if re.fullmatch(r"メインフェイズ終了時まで、≪イレイザー・イレイザー♂X体≫の攻撃力に\+Xする。メインフェイズ終了時まで、対象はキャラクターを目標にアタック宣言可能。?", t0):   # A3-09 1485 (Revise#252)
        return {"target": {"kind": "char", "sel": {"icons": ["イレイザー", "イレイザー♂"]}, "count": "X"}, "steps": [{"a": "mod", "to": "t", "mod": {"key": "at", "op": "add", "value": {"xvar": True, "sign": 1}}, "until": "main"}, {"a": "mod", "to": "t", "mod": {"key": "attackChars", "op": "grant", "value": {}}, "until": "main"}], "status": "auto"}
    if re.fullmatch(r"このカードの使用宣言時に、あなたの任意のあなたの手札X枚を捨て札し、あなたの任意のあなたの支配キャラクタ[ー\-－]1人をあなたのダメージ置き場に置く。目標の≪キャラクタ[ー\-－]1人≫に\(X\)ダメージを与える。?", re.sub(r"\s+", "", text)):   # A3-07 1103 (Revise#250)
        return {"target": {"kind": "char", "sel": {}, "count": 1}, "steps": [{"a": "discardHandAnyX"}, {"a": "xFromLast"}, {"a": "ctlCharToDamage"}, {"a": "damage", "to": "t", "n": "X", "mental": True}], "status": "auto"}
    m = re.fullmatch(r"このカードの使用宣言時に、あなたの任意のあなたの手札X枚を捨て札する。(.+)", text)   # A3-07 1170 / A3-14 1974 (Revise#165): X = how many you discard (asked when it resolves)
    if m and "Xは" not in m.group(1):
        rest = parse_body(m.group(1))
        if rest.get("status") == "auto" and '"X"' not in json.dumps(rest.get("target") or {}):   # a target that needs X can't wait for it
            return dict(rest, steps=[{"a": "discardHandAnyX"}, {"a": "xFromLast"}] + rest["steps"])
        if rest.get("status") == "auto" and not rest.get("x"):   # the target needs X: discard at the declaration (Revise#166)
            return dict(rest, declDiscardX=True)
    m = re.fullmatch(r"このエフェクトの使用宣言時に、あなたの任意のあなたの手札X枚を捨て札する。(.+)", text)   # ガルム: X = how many you discard
    if m:
        rest = parse_body(m.group(1))
        if rest["status"] == "auto" and not rest.get("target"):
            js = json.dumps(rest["steps"], ensure_ascii=False).replace('"xvar": true', '"xlast": true')
            return {"steps": [{"a": "discardHandAnyX"}] + json.loads(js), "status": "auto"}
    if re.fullmatch(r"≪あなたの任意のエリア1つの▼を持つキャラクター全てと、精神力0のキャラクター全て≫を捨て札する。?(?:このエフェクトは[^。]+のみ使用宣言可能。?)?", text):   # セギヌス
        return dict({"steps": [{"a": "areaSweep"}], "status": "auto"}, **({"timing": "project"} if "プロジェクトカードのタイミングでのみ" in text else {}))
    m = re.fullmatch(r"≪プレイヤー全て≫は、ネームを持つ自分の支配キャラクター(X|\d+)体にセットされているカード全てを、そのオーナーの手札に戻す。(?:(Xは[^。]+に等しい)。?)?", text)
    if m and (m.group(1) != "X" or (m.group(2) and x_def(m.group(2)))):   # 秘密のお茶会
        return dict({"steps": [{"a": "eachStripNamed", "n": "X" if m.group(1) == "X" else int(m.group(1))}], "status": "auto"}, **({"x": x_def(m.group(2))} if m.group(1) == "X" else {}))
    if re.fullmatch(r"あなたの任意の≪あなたの支配キャラクターX体≫を、あなたの勢力エリアに移動させる。その後、あなたの任意の≪あなたの勢力エリアのキャラクターX体≫を、あなたの支配エリアに移動させる。?", text):   # 軌道エレベーター
        return {"steps": [{"a": "pickMove", "from": "control", "n": "any"}, {"a": "pickMove", "from": "party", "n": "last"}], "status": "auto"}   # X = as many as you choose, the same number both ways
    if re.fullmatch(r"あなたは、目標の≪対戦相手1人のデッキ≫の内容を全て確認する。その後、そのデッキの中から、あなたの任意のカード1枚をそのデッキの任意の場所に移動させる。その後、≪あなた≫は1ドローする。(?:このカードの効果でデッキの内容を確認した際のデッキのシャッフルは行わない。?)?", text):   # MI6
        return {"target": {"kind": "player", "sel": {"owner": "opp"}, "psel": {"owner": "opp"}, "count": 1}, "steps": [{"a": "deckPeekMove", "to": "t"}, {"a": "draw", "to": "you", "n": 1}], "status": "auto"}
    if re.fullmatch(r"あなたは、パーマネントカード・プロジェクトカード・ファストカードの3種類の中からカード種類1つを指定する。その後、目標の≪プレイヤー1人≫の手札からあなたの任意のカード1枚を引く。引いたカードが指定した種類のカードだった場合、そのカードをダメージ置き場に置く。それ以外の種類のカードだった場合、オーナーの手札に戻す。?", text):
        return {"target": {"kind": "player", "sel": {}, "psel": {}, "count": 1}, "steps": [{"a": "guessType", "to": "t", "types": ["Permanent", "Project", "Fast"]}], "status": "auto"}   # Revise#109
    raw = re.findall(r"≪([^≫]+)≫", text)
    parsed = [parse_target(t) for t in raw]
    for i, t in enumerate(raw):   # "目標の≪…キャラクター≫" with no count = one target
        if parsed[i] is None and t.endswith("キャラクター") and "目標の≪" + t + "≫" in text:
            p1 = parse_target(t + "1人")
            if p1 and p1[0] == "choice": parsed[i] = p1
    specs, spec_texts = [], []
    for t, p in zip(raw, parsed):
        if p and p[0] == "choice" and t not in spec_texts and not (re.search("目標の≪" + re.escape(t) + "≫", text) and spec_texts and False):
            specs.append(dict(p[1], byChoice=True) if "任意" in t and ("目標の≪" + t + "≫") not in text and p[1].get("kind") != "item" else p[1]); spec_texts.append(t)   # "あなたの任意の…": the controller's choice, not a 目標 (Pack, Revise#248: A3-15 2105 may change it)
    idx = {}
    body = re.sub(r"≪([^≫]+)≫", lambda m: "«%d»" % idx.setdefault(len(idx), len(idx)), text)
    def ref_of(i):
        t, p = raw[i], parsed[i]
        if p is None: return None
        if p[0] == "ref": return p[1]
        k = spec_texts.index(t)
        return "t" if k == 0 else "t%d" % k
    ref_of.raw = raw
    body = re.sub(r"(通常のダメージ判定を行わず、[^。]+?置く)。その後、", r"\1、その後、", body)
    body = re.sub(r"(デッキをシャッフルする)。その後、(目標のプレイヤーはデッキに戻したカード枚数)", r"\1、その後、\2", body)
    # a bare "目標" (no ≪…≫ after it) means the one chosen target: «t» (Revise#087)
    if len(specs) == 1: body = re.sub(r"目標(?!の«)", "«t»", body)
    out = {"steps": []}
    if len(specs) == 1: out["target"] = specs[0]
    elif specs: out["target"] = {"kind": "multi", "parts": specs}
    good = 0
    prev_start = None   # where the sentence before put its steps ("代わりに", Revise#200)
    sentences = [x.strip() for x in re.split(r"。", body) if x.strip()]
    xplus = re.findall(r"(\d+)\+X(?=\(?ダメージ|ドロー)", body)   # "1+Xダメージ" (EX0460 / 2421, Revise#203)
    if len(xplus) == 1: body = re.sub(r"(\d+)\+X(?=\(?ダメージ|ドロー)", "X", body); sentences = [x.strip() for x in re.split(r"。", body) if x.strip()]
    lasting = any(re.fullmatch(r"«\d»は、?フェイズ・ターンが終了しても効果を発揮し続ける", x) and ref_of(int(re.search(r"\d", x).group())) == "card" for x in sentences)
    for s in sentences:
        s0 = s.replace("«t»", "目標")   # the sentence as written, for the patterns that spell out 目標
        xd = x_def(s0)
        if xd: out["x"] = xd; good += 1; continue
        if re.fullmatch(r"このエフェクトは(?:、)?あなたの(?:ターンの|メインフェイズの)プロジェクトカードのタイミングでのみ使用宣言可能", s0): out["timing"] = "project"; good += 1; continue
        if s0 == "このエフェクトはダメージ置き場のパーマネントカードを目標に使用宣言可能" and isinstance(out.get("target"), dict) and out["target"].get("kind") == "card":   # 3192 (Revise#152)
            out["target"] = dict(out["target"], sel=dict(out["target"].get("sel") or {}, alsoZones=["damage"])); good += 1; continue
        if s0 == "このエフェクトはアタック宣言またはガード宣言しているキャラクターに対してのみ使用宣言可能" and isinstance(out.get("target"), dict) and out["target"].get("kind") == "char":   # 3048 (Revise#152)
            out["target"] = dict(out["target"], sel=dict(out["target"].get("sel") or {}, inBattle=True)); good += 1; continue
        st = sentence_steps(re.sub(r"^その後、", "", s0), ref_of) if s0 != s else None
        bad = lambda st: st is None or any(x.get("to", "x") is None for x in st) or any(x.get("step", {}).get("to", "x") is None for x in st)
        if bad(st): st = sentence_steps(re.sub(r"^その後、", "", s), ref_of)
        if bad(st) and (lasting or _PERSIST[0]) and (s.startswith("«") or s.startswith("目標の«")):   # a 持続 card's "≪…≫に±0/+3/+3する" with no duration lasts while the card stays (EX0604, Revise#208)   # a lasting card (Revise#201): "≪…≫は+1/+1/+1され、…" with no duration lasts while the card does
            st2 = sentence_steps("ターン終了時まで、" + s, ref_of)
            if not bad(st2) and all(x.get("a") == "mod" and x.get("until") == "turn" for x in st2): st = [dict(x, until="removed") for x in st2]
        s = s0
        if st is None or any(x.get("to", "x") is None for x in st) or any(x.get("step", {}).get("to", "x") is None for x in st):
            out["steps"].append({"a": "manual", "text": re.sub(r"«(\d)»", lambda m: "≪%s≫" % raw[int(m.group(1))], s) + "。"})
            continue
        inst = next((x.pop("_instead") for x in st if "_instead" in x), None)   # "…場合、代わりに、…" (Revise#200): the sentence before runs only when the condition is not met
        if inst is not None and prev_start is not None:
            for y in out["steps"][prev_start:]:
                if "if" in inst: y["if"] = {"all": [y["if"], {"not": inst["if"]}]} if y.get("if") else {"not": inst["if"]}
                elif "tName" in inst: y["ifTNot"] = inst["tName"]
                elif "tSel" in inst: y["ifTNotSel"] = inst["tSel"]
                elif "paidBy" in inst: y["ifNotPaidBy"] = inst["paidBy"]
        prev_start = len(out["steps"])
        for x in st:
            if x.get("to") == "_that":   # "その後、そのプレイヤーは…": the player of the step before
                prev = next((y["to"] for y in reversed(out["steps"]) if y.get("to") in ("attackedPlayer", "evPlayer", "tOwner", "t", "battleOppOwner")), None)
                if prev is None: x["to"] = None
                else: x["to"] = prev
            if "_x" in x: out.setdefault("x", x.pop("_x"))
            if x.pop("_first", False): out["steps"].insert(0, x); continue
            if '"@icon"' in json.dumps(x) and not any(y.get("a") == "pickIcon" for y in out["steps"]): out["steps"].append({"a": "pickIcon"})   # choose the class first (Revise#168)
            if x.get("to") == "_prevAny": x["to"] = next((y.get("to") for y in reversed(out["steps"]) if y.get("to") not in (None, "card", "you")), None)   # "対象に…" = whom the sentence before reached (EX0059, Revise#215)
            if x.get("to") == "_prevTo":   # "対象は…": the same characters as the sentence before (Revise#166)
                prev = next((y.get("to") for y in reversed(out["steps"]) if isinstance(y.get("to"), dict) and isinstance(y["to"].get("all"), dict)), None)
                if prev is None:
                    pm = next((y["mod"]["to"] for y in reversed(out["steps"]) if y.get("a") == "field" and isinstance(y.get("mod", {}).get("to"), dict) and y["mod"]["to"].get("sel")), None)
                    prev = {"all": pm["sel"]} if pm else None
                if prev is None: x.clear(); x.update({"a": "manual", "text": re.sub(r"«(\d)»", lambda mm: "≪%s≫" % raw[int(mm.group(1))], s) + "。"}); good -= 1
                else: x["to"] = prev
            for hold, k in ((x, "chSel"), (x.get("when") or {}, "bySel")):
                if isinstance(hold.get(k), dict) and hold[k].get("_prevAll"):   # "対象が…": the "≪…全て≫" of the sentence before (Revise#166)
                    prev = next((y["to"]["all"] for y in reversed(out["steps"]) if isinstance(y.get("to"), dict) and isinstance(y["to"].get("all"), dict)), None)
                    if prev is None: x["to"] = None
                    else: hold[k] = prev
            if x["a"] == "_lasting": out["_lasting"] = True; continue
            if x["a"] == "_activeOnly": out["timing"] = "active"; continue
            if x["a"] == "_payOnlySel": out["payOnlySel"] = x["sel"]; continue
            if x["a"] == "_patchPrev":   # "その後、…戻した枚数に等しい枚数…" (Revise#201): finishes the step before
                prev = next((y for y in reversed(out["steps"]) if y.get("a") == x["on"]), None)
                if prev is None: out["steps"].append({"a": "manual", "text": re.sub(r"«(\d)»", lambda mm: "≪%s≫" % raw[int(mm.group(1))], s) + "。"}); good -= 1
                else: prev.update(x["set"])
                continue
            if x["a"] == "_myTurn": out["myTurn"] = True; continue
            if x["a"] == "_onlyExtra": out["onlyExtra"] = True; continue
            if x["a"] == "_payOnlyTarget":   # "このカードのコストは、目標からのみ支払うことが可能" (EX0740, Revise#344): the characters it can target
                if out.get("target", {}).get("kind") == "char" and out["target"].get("sel"): out["payOnlySel"] = out["target"]["sel"]; continue
                out["steps"].append({"a": "manual", "text": "このカードのコストは、目標からのみ支払うことが可能。"}); good -= 1; continue
            if x["a"] == "_topBreakToDamage":   # "その際、そのキャラクターを構成する一番上のブレイクカードをあなたのダメージ置き場に置く" (0339, Revise#348)
                if out["steps"] and out["steps"][-1].get("a") == "discard": out["steps"][-1]["topBreakTo"] = "damage"; continue
                out["steps"].append({"a": "manual"}); good -= 1; continue
            if x["a"] == "_costToIf": out["costToIf"] = {"cond": x["cond"], "to": x["to"]}; continue   # EX851 (Revise#353)
            if x["a"] == "_oncePerTurn": out["oncePerTurn"] = True; continue
            if x["a"] == "_costBackIfAll": out["costBackIfAll"] = x["names"]; continue
            if x["a"] == "_selfShield" and x.get("cond"): out["selfShieldIf"] = {"cond": x["cond"], "fast": bool(x.get("fast"))}; continue
            if x["a"] == "_costFreeIf": out["costFreeIf"] = x["cond"]; continue
            if x["a"] == "_factorFreeIf": out["factorFreeIf"] = x["cond"]; out.update({"costFreeIf": x["cond"]} if x.get("cost") else {}); continue
            if x["a"] == "_selfShield": out["selfShield"] = "fast" if x.get("fast") else True; continue
            if x["a"] == "_myMain": out["myTurn"] = True; out["mainOnly"] = True; continue
            if x["a"] == "_hostName": out["hostName"] = x["name"]; out.update({"hostPerm": x["perm"]} if x.get("perm") else {}); continue
            if x["a"] == "_hostNames": out["hostNames"] = x["names"]; continue
            if x["a"] == "_notFirst": out["notFirst"] = True; continue
            if x["a"] == "_declDiscard": out["declDiscard"] = x["n"]; continue
            if x["a"] == "_declCond": out["declCond"] = x["cond"]; continue
            if x["a"] == "_xGeT": out["_xGeT"] = x["stat"]; continue
            if x["a"] == "_onlyIf": out["_onlyIf"] = x["cond"]; continue
            if x["a"] == "_onlyIfPaidT": out["_onlyIfPaidT"] = True; continue
            if x["a"] == "_partial": out["_partial"] = True; continue
            if x["a"] == "_effDeclIgnoreFactor":   # A3-09 1385: the card declared by this one ignores its factor
                for y in out["steps"]:
                    if y.get("a") == "effDecl": y["ignoreFactor"] = True; y.pop("_ignoreFactorLater", None)
                continue
            if x["a"] == "_discount": out["discount"] = x["v"]; continue
            if x["a"] == "_oppTurnOnly": out["oppTurnOnly"] = True; continue
            if x["a"] == "_discardOrMill": out["steps"].append({"a": "discardOrMill", "to": "t", "n": x["n"], "mill": 0}); continue   # A4-04 0773 (Revise#267)
            if x["a"] == "_discardOrMillElse":
                pv = next((y for y in reversed(out["steps"]) if y.get("a") == "discardOrMill"), None)
                if pv is None: out["steps"].append({"a": "manual", "text": "捨て札しなかった場合、目標のデッキの上からカードを%d枚捨て札する。" % x["mill"]}); good -= 1
                else: pv["mill"] = x["mill"]
                continue
            if x.get("until") == "_prev": x = dict(x, until=next((y.get("until") for y in reversed(out["steps"]) if y.get("until")), "turn"))   # "さらに…" (Revise#267)
            if x["a"] == "_battleOppOffPrev":   # "対象のバトル相手の持つスキルを無効化する" (EX0168): the battle opponents of the group before
                pv = next((y for y in reversed(out["steps"]) if isinstance(y.get("to"), dict) and "all" in y["to"]), None)
                if pv is None: out["steps"].append({"a": "manual", "text": "対象のバトル相手の持つスキルを無効化する。"}); good -= 1; continue
                out["steps"].append({"a": "field", "mod": {"to": {"players": "all"}, "key": "battleOppSkillsOff", "op": "grant", "value": {"ofSel": pv["to"]["all"]}, "until": x["until"]}}); continue
            if x["a"] == "_declDraw": out["declDraw"] = x["n"]; continue
            if x["a"] == "_declMill": out["declMill"] = x["n"]; continue
            if x["a"] == "_drawChain": out["steps"] = [y for y in out["steps"] if not (y.get("a") == "draw" and y.get("to") == "you" and y.get("n") == 1)] + [{"a": "drawChain"}]; continue   # A3-23 3335
            if x["a"] == "_designatePlayer": out["target"] = {"kind": "player", "sel": {}, "psel": {}, "count": 1, "designate": True}; continue   # A3-15 2150 (Revise#257)
            if x["a"] == "_factorLess": out["factorLess"] = x["n"]; continue
            if x["a"] == "costTo": out["costTo"] = x["to"]
            elif x["a"] == "costToIfNamed": out["costToIfNamed"] = x["to"]
            else: out["steps"].append(x)
        good += 1
    out["steps"] = [dict({"a": "pickZone", "to": "you", "dest": "hand", "zones": [x["to"]["pile"]["zone"]]}, **{k: v for k, v in x["to"]["pile"].items() if k != "zone"}, **{k: v for k, v in x.items() if k.startswith("if")}) if x.get("a") == "bounce" and isinstance(x.get("to"), dict) and isinstance(x["to"].get("pile"), dict) else x for x in out["steps"]]   # "目標の≪ダメージ置き場のカード1枚≫を、そのオーナーの手札に戻す" (A3-19 2650 bug, Revise#206): a card from the pile
    if out.pop("_onlyIfPaidT", False):   # "このカードのコストが目標から支払われていない場合、このカードは効果を発揮しない" (A3-03 0518)
        for x in out["steps"]: x["ifPaidOnlyT"] = True
    if out.get("_onlyIf"):   # "このカードは…場合にのみ効果を発揮する": every step needs it
        oc = out.pop("_onlyIf")
        for x in out["steps"]: x["if"] = {"all": [x["if"], oc]} if x.get("if") else oc
    if out.get("_xGeT"):   # "Xが目標のキャラクターの精神力以上でなければ、このカードは効果を発揮しない": every step needs it
        st = out.pop("_xGeT")
        for x in out["steps"]: x["ifXGeT"] = st
    if len(xplus) == 1:
        for x in out["steps"]:
            if x.get("n") == "X" and x.get("a") in ("damage", "pickAnyDamage", "draw"): x["nPlus"] = int(xplus[0])   # "3+Xドロー" (PP333, Revise#346)
    if out.pop("_lasting", False):   # "≪このカード≫は、フェイズ・ターンが終了しても効果を発揮し続ける" (Revise#201): "≪…全て≫" stays a field rule, so characters that come later get it too
        out["steps"] = [{"a": "field", "mod": dict(x["mod"], to=x["to"], until="removed")} if x.get("a") == "mod" and x.get("until") == "removed" and isinstance(x.get("to"), dict) and "all" in x["to"] and not x.get("if") and not x.get("cond") and not x.get("resolveX") else x for x in out["steps"]]
    if any(x.get("a") == "discardAnyX" for x in out["steps"]):   # "…X体を捨て札する。その後、…にXダメージを与える": X = how many were discarded
        out["steps"] = [dict({"a": "damageLast", "to": x["to"]}, **({"mental": True} if x.get("mental") else {})) if x.get("a") == "damage" and x.get("n") == "X" else x for x in out["steps"]]
    for i_, x_ in enumerate(out["steps"]):   # A4-02 0310 (Revise#362): "…を捨て札する" at the declaration is a payment — without it nothing else happens
        if x_.pop("_gateRest", False):
            for y_ in out["steps"][i_ + 1:]: y_.setdefault("ifLast", True)
    out["status"] = "auto" if sentences and good == len(sentences) else "partial" if good else "manual"
    if out.pop("_partial", False) and out["status"] == "auto": out["status"] = "partial"
    if out["status"] == "auto" and not out.get("target") and any(x.get("to") == "t" and x.get("a") not in ("watchEv",) for x in out["steps"]): out["status"] = "partial"   # a step for "目標" without a target that was read (Revise#348)
    if out["status"] == "manual": out.pop("target", None)
    return out


# ---------------------------------------------------------------- abilities (C2)
TRIGGERS = [
    (r"このカードが(?:場に)?セットされた場合", {"event": "enter", "self": True}),
    (r"このキャラクターが場に(?:セットされた|出た)場合", {"event": "enter", "self": True}),
    (r"このキャラクターを支配した場合", {"event": "dominated", "self": True}),
    (r"このキャラクターがブレイクされた場合", {"event": "brokenSelf"}),
    (r"このキャラクターが捨て札(?:になる|される)場合", {"event": "leave", "self": True}),
    (r"このキャラクターが(?:あなたの)?対戦相手を目標にアタック宣言した場合", {"event": "attack", "self": True, "toPlayer": True}),   # Revise#152
    (r"このカードが捨て札(?:になる|される)場合", {"event": "leave", "self": True}),   # Revise#152
    (r"このキャラクターが(?:対戦相手|プレイヤー)にアタックした場合", {"event": "attack", "self": True, "toPlayer": True}),
    (r"(?:あなたの)?パワーカードフェイズの最初に", {"event": "phaseStart", "phase": "charge", "mine": True}),
    (r"このキャラクターがシンクロによるアタック宣言またはガード宣言を行った場合", {"event": "joined", "self": True}),
    (r"(?:あなたが)?このカードをセットした場合", {"event": "enter", "self": True}),   # PP210 (Revise#310)
    (r"このキャラクターが魔法少女リリカルなのはシリーズのカードでブレイクされた場合", {"event": "brokenSelf", "works": "nanoha"}),
    (r"パワーカードフェイズ終了時の効果でこのキャラクターを支配した場合", {"event": "dominated", "self": True, "phaseEnd": True}),
    (r"このキャラクターがバトルの結果捨て札される場合", {"event": "leave", "self": True, "battle": True}),
    (r"このキャラクターがバトルによって捨て札される場合", {"event": "leave", "self": True, "battle": True}),
    (r"このキャラクターが支配キャラクターとのバトルによって捨て札される場合", {"event": "leave", "self": True, "battle": True}),   # Saga 4 (Revise#269)
    (r"このキャラクターがプレイヤーを目標にアタック宣言した場合", {"event": "attack", "self": True, "toPlayer": True}),   # Saga 4 (Revise#269)
    (r"このキャラクターがアタック宣言またはガード宣言した場合", {"event": "battleDeclared", "self": True}),
    (r"このキャラクターのアタック宣言に対して支配キャラクターがガード宣言した場合", {"event": "guarded", "self": True, "asAttacker": True}),
    (r"このキャラクターが支配キャラクターのアタック宣言に対してガード宣言した場合", {"event": "guarded", "self": True, "asGuard": True}),
    (r"このキャラクターがブレイクしていない支配キャラクターにガード宣言されるか、ブレイクしていない支配キャラクターのアタック宣言に対してガード宣言した場合", {"event": "guarded", "self": True, "oppSel": {"broken": False, "area": "controlled"}}),
    (r"このキャラクターがブレイクしていない支配キャラクターにガード宣言された場合", {"event": "guarded", "self": True, "asAttacker": True, "guardSel": {"broken": False}}),
    (r"このキャラクターが(?:あなたの)?対戦相手に対してアタック宣言した場合", {"event": "attack", "self": True, "toPlayer": True}),
    (r"あなたの支配キャラクターがプレイヤーにアタックした場合", {"event": "attack", "own": True, "toPlayer": True}),
    (r"このキャラクターがバトルによって支配キャラクターを捨て札した場合", {"event": "killed", "controlled": True}),
    (r"このキャラクターがバトルの結果、(?:対戦相手の)?支配キャラクターを捨て札した場合", {"event": "killed", "controlled": True}),   # Revise#157
    (r"バトルの結果、支配キャラクターが捨て札された場合", {"event": "killed", "anyBattle": True}),
    (r"このキャラクターがバトルの結果、バトル相手を捨て札できなかった場合", {"event": "battleEnd", "self": True}),
    (r"アタック宣言しているこのキャラクターが対戦相手の支配キャラクターとバトルした場合、バトル開始時に?", {"event": "battleStart", "self": True, "vsCtl": True, "asAttacker": True}),
    (r"ガード宣言しているこのキャラクターが対戦相手の支配キャラクターとバトルした場合、バトル開始時に?", {"event": "battleStart", "self": True, "vsCtl": True, "asGuard": True}),
    (r"このキャラクターが対戦相手にアタックした場合", {"event": "attack", "self": True, "toPlayer": True}),
    (r"このキャラクターが与えたダメージによって支配キャラクターを捨て札した場合", {"event": "killed", "controlled": True, "anyDamage": True}),
    (r"このキャラクターがブースト1のスキルを使用してアタック宣言した場合", {"event": "attack", "self": True, "boost": True}),
    (r"このキャラクターがバトルによってキャラクターを捨て札した場合", {"event": "killed"}),
    (r"このキャラクターがアタック宣言した場合", {"event": "attack", "self": True}),
    (r"このキャラクターがガード(?:宣言)?した場合", {"event": "guarded", "self": True}),
    (r"このキャラクターが(?:アタック宣言を受けた|アタックされた)場合", {"event": "attacked", "self": True}),
    (r"このキャラクターのバトル終了時|このキャラクターがバトルした場合", {"event": "battleEnd", "self": True}),
    (r"このキャラクターのバトル開始時に?", {"event": "battleStart", "self": True}),
    (r"あなたのターン開始時に?", {"event": "turnStart", "mine": True}),
    (r"あなた以外のプレイヤーのメインフェイズ開始時に?", {"event": "phaseStart", "phase": "main", "others": True}),
    (r"あなたのメインフェイズ開始時に?", {"event": "phaseStart", "phase": "main", "mine": True}),
    (r"(?:あなたの)?ディスカードフェイズの最初に", {"event": "phaseStart", "phase": "discard", "mine": True}),
    (r"(?:あなたの)?ディスカードフェイズの最後に", {"event": "phaseEnd", "phase": "discard", "mine": True}),
    (r"あなたのターン終了時に?", {"event": "turnEnd", "mine": True}),
]
CONDS = [
    (r"あなたの対戦相手いずれか1人のダメージ置き場のカード枚数が(\d+)枚以上の(?:場合|状態で、このカードが効果を発揮している場合)", {"oppDamageMin": 8}),   # BLAZBLUE cards (M5)
    (r"あなたの対戦相手に、?手札が0枚のプレイヤーがいた場合", {"oppHandZero": True}),   # A3-07 1132 (Revise#164)
    (r"あなたの手札が0枚の場合", {"hand": {"op": "=", "n": 0}}),
    (r"このキャラクターが、?ダメージ置き場のカード枚数が0のプレイヤーにアタック宣言している場合", {"attackingZeroDamage": True}),   # A3-07 1165
    (r"このキャラクターがバトルする際", {"self": "inBattle"}),
    (r"このキャラクターが支配キャラクターとバトルする際", {"self": "battleVsControlled"}),
    (r"このキャラクターが(?:アタック宣言している|アタックする)(?:場合|際)", {"self": "attacking"}),
    (r"このキャラクターがプレイヤーにアタック(?:した|する)(?:場合|際)", {"self": "attackingPlayer"}),
    (r"このキャラクターが(?:ガード宣言している|ガードする)(?:場合|際)", {"self": "guarding"}),
    (r"このキャラクターが支配エリアにセットされている場合", {"self": "controlled"}),
    (r"このキャラクターが(?:勢力エリアの)?アクティブキャラクターの場合", {"self": "active"}),
    (r"このキャラクターがブレイクしている場合", {"self": "broken"}),
    (r"このキャラクターにパーマネントカードがセットされている場合", {"selfHasPerm": True}),
    (r"このキャラクターのパワーが精神力に等しい場合", {"selfPowerEqMental": True}),
    (r"あなたのターンの場合|あなたのターン中|あなたのターン中の場合", {"myTurn": True}),
]


def cond_of(text):
    for pat, c in CONDS:
        if re.fullmatch(pat, text): return dict(c)
    m = re.fullmatch(r"このキャラクターが(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)?の?(ネームレベル)?キャラクターと同じエリアにいる場合", text)
    if m and (m.group(1) or m.group(2)): return {"sameArea": dict({"faction": FACTION_JP[m.group(1)]} if m.group(1) else {}, **({"named": True} if m.group(2) else {}))}
    m = re.fullmatch(r"あなたが([EW阿ダ極イ宇冥]+)を満た(?:している場合|した状態|している状態)", text)   # "あなたがEEEを満たしている場合": that factor (冥: Revise#310)
    if m:
        from collections import Counter as _C
        return {"factor": dict(_C(TEXT_FACTOR[ch] for ch in m.group(1)))}
    if text == "あなたの対戦相手がキャラクターを支配している場合": return {"count": {"sel": {"owner": "opp", "area": "controlled"}, "op": ">=", "n": 1}}   # A3-17 2405 (Revise#339)
    if text == "あなたが先攻でない場合": return {"notFirst": True}
    if text == "あなたが先攻の場合": return {"not": {"notFirst": True}}   # A4-05 0804 (Revise#260)
    m = re.fullmatch(r"あなたのテリトリーのキャラクターの持つ分類の総数が(\d+)種類以上の場合", text)   # A4-05 0912 (Revise#273)
    if m: return {"iconKinds": int(m.group(1))}
    if text in ("このキャラクターがアタック宣言またはガード宣言している場合", "このキャラクターがバトルしている場合"): return {"self": "inBattle"}   # A4-01 0048 (Revise#277)
    if text == "このキャラクター以外のネームレベルキャラクターがいる場合": return {"count": {"sel": {"named": True, "notSelf": True}, "op": ">=", "n": 1}}   # A4-04 0702 (Revise#272)
    if text == "あなたの対戦相手がネームレベルキャラクターを支配している場合": return {"count": {"sel": {"owner": "opp", "area": "controlled", "named": True}, "op": ">=", "n": 1}}   # A4-04 0701 (Revise#269)
    m = re.fullmatch(r"あなたの支配エリアに(?:[^()（）]+[(（]勢力[)）]の分類・)?([^、。の()（）]+?)が(\d+)体以上いる場合", text)   # A4-01 0170 … (Revise#259): "イレイザー(勢力)の分類・イレイザーが3体以上"
    if m and class_tokens(m.group(1)) == [m.group(1)]: return {"count": {"sel": {"icons": [m.group(1)], "owner": "you", "area": "controlled"}, "op": ">=", "n": int(m.group(2))}}
    m = re.fullmatch(r"あなたの支配エリアに、?(.*?)キャラクターがいる場合", text)   # A3-18 2496 (Revise#166)
    if m and "“" not in m.group(1) and parse_selector(m.group(1)) is not None: return {"count": {"sel": dict(parse_selector(m.group(1)), owner="you", area="controlled"), "op": ">=", "n": 1}}
    m = re.fullmatch(r"このカードが(.+?)(以外)?にセットされている場合", text)   # A3-12 1759 / 1834 / 1835: a class icon host
    if m and class_tokens(m.group(1)) and len(class_tokens(m.group(1))) == len(m.group(1).split("・")):
        c0 = {"selfIs": {"icons": class_tokens(m.group(1))}}
        return {"not": c0} if m.group(2) else c0
    m = re.fullmatch(r"このカードがネームに「([^」]+)」を含む(ブレイクしている)?(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のキャラクターにセットされている場合", text)   # A3-16 2175 (Revise#221)
    if m: return {"selfIs": dict({"nameHas": m.group(1), "faction": FACTION_JP[m.group(3)]}, **({"broken": True} if m.group(2) else {}))}
    m = re.fullmatch(r"このカードが(.+?)キャラクターにセットされている場合", text)   # EX0599 "カード名称に「天瞳流」を含む" / EX0114 "ブレイクしている" (Revise#208)
    if m and parse_selector(m.group(1)) and "owner" not in parse_selector(m.group(1)): return {"selfIs": parse_selector(m.group(1))}
    m = re.fullmatch(r"このキャラクターの(精神力|攻撃力|耐久力)が(\d+)以上の場合", text)   # A4-01 0116 (Revise#218)
    if m: return {"selfStatMin": {"key": STAT_JP[m.group(1)], "n": int(m.group(2))}}
    m = re.fullmatch(r"このカードが(ブレイクしている)?[“”\"]([^“”\"]+)[”\"]にセットされている場合", text)   # A3-08 1268 (Revise#164); ブレイクしている: EP439 (Revise#345)
    if m: return {"selfIs": dict({"name": re.sub(r"\s+", "", m.group(2))}, **({"broken": True} if m.group(1) else {}))}
    m = re.fullmatch(r"[“”\"]([^“”\"]+)[”\"]があなたの支配エリアに(?:セットされている|いる)場合", text)
    if m: return {"count": {"sel": {"owner": "you", "area": "controlled", "name": re.sub(r"\s+", "", m.group(1))}, "op": ">=", "n": 1}}
    m = re.fullmatch(r"あなたの対戦相手全ての手札枚数の合計が(\d+)枚以上の場合", text)
    if m: return {"xAtLeast": {"x": {"hand": "opp"}, "n": int(m.group(1))}}
    m = re.fullmatch(r"あなたの支配エリアに(.+?)キャラクターが(?:いる|存在する)場合", text)   # EX0309 (Revise#207): "カード名称に「ゴーレム」を含む"
    if m and parse_selector(m.group(1)) and "owner" not in parse_selector(m.group(1)): return {"count": {"sel": dict(parse_selector(m.group(1)), owner="you", area="controlled"), "op": ">=", "n": 1}}
    m = re.fullmatch(r"あなたの支配エリアにネームに「([^」]+)」を含む(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のキャラクターが(?:存在する|いる)場合", text)   # 2421 / PR232 (Revise#203)
    if m: return {"count": {"sel": {"owner": "you", "area": "controlled", "nameHas": m.group(1), "faction": FACTION_JP[m.group(2)]}, "op": ">=", "n": 1}}
    m = re.fullmatch(r"あなたのデッキ枚数が(\d+)枚以下の場合", text)   # 2421 (Revise#203)
    if m: return {"not": {"xAtLeast": {"x": {"deckCount": True}, "n": int(m.group(1)) + 1}}}
    m = re.fullmatch(r"あなたの支配エリアにブレイクしている[“”\"]([^“”\"]+)[”\"]がいる場合", text)   # EX0310 (Revise#203)
    if m: return {"namesCtl": [re.sub(r"\s+", "", m.group(1))], "broken": True}
    m = re.fullmatch(r"場かダメージ置き場に[“”\"]([^“”\"]+)[”\"]がある場合", text)   # EX0052 (Revise#201)
    if m: return {"fieldOrDamageName": re.sub(r"\s+", "", m.group(1))}
    m = re.fullmatch(r"場に(?:[^“”\"]*?)[“”\"]([^“”\"]+)[”\"]がいる場合", text)
    if m: return {"fieldName": re.sub(r"\s+", "", m.group(1))}
    if text == "あなたの支配エリアに、このキャラクター以外のネームレベルキャラクターが存在しない場合": return {"count": {"sel": {"owner": "you", "area": "controlled", "named": True, "notSelf": True}, "op": "<=", "n": 0}}
    if text == "あなたのテリトリーにキャラクターがいない状態": return {"count": {"sel": {"owner": "you", "notSelf": True}, "op": "<=", "n": 0}}
    m = re.fullmatch(r"このキャラクターが(.+?)とバトルする際", text)   # "…Fのキャラクターと / 悪魔・悪魔♂・アンデットと / ♂の分類を持つキャラクターとバトルする際"
    if m:
        w = re.sub(r"キャラクター$", "", m.group(1)).replace("アンデット", "アンデッド")
        sel = parse_selector(w) if w else {}
        if sel is None:
            icons = class_tokens(w.replace("・", "/"))
            sel = {"icons": icons} if icons and len(icons) == len(w.split("・")) else None
        if sel is not None: return {"battleVs": sel}
    m = re.fullmatch(r"(?:あなたの支配エリアに|あなたが)?(.+?)(?:を持つ)?あなたの支配キャラクターが(\d+)体(以上|以下)いる(?:場合|状態)", text) or re.fullmatch(r"(.+?)のあなたの支配キャラクターが(\d+)体(以上|以下)いる(?:場合|状態)", text)
    if m:
        g1 = m.group(1)
        sel = parse_selector(g1 + ("を持つ" if re.fullmatch(r"(武蔵|英国|三征西班牙)", g1) else "" if g1.endswith("の") else "の"))
        if sel is not None: return {"count": {"sel": dict(sel, owner="you", area="controlled"), "op": ">=" if m.group(3) == "以上" else "<=", "n": int(m.group(2))}}
    m = re.fullmatch(r"あなたが(.+?)を(\d+)体以上支配(している|していない)(?:場合|状態)", text) or re.fullmatch(r"あなたが(.+?)を持つキャラクターを(?:(\d+)体以上)?支配(している|していない)(?:場合|状態)", text)
    if m:
        w = re.sub(r"を持つキャラクター$", "", m.group(1))
        fm = re.fullmatch(r"(.+?)\(勢力\)の(.+?)\(分類\)", w)
        sel = {"faction": FACTION_JP.get(fm.group(1)), "icons": class_tokens(fm.group(2))} if fm else parse_selector(w + "を持つ") if re.fullmatch(r"(武蔵|英国|三征西班牙)", w) else ({"icons": class_tokens(w)} if class_tokens(w) else None)
        if sel is not None:
            c0 = {"count": {"sel": dict(sel, owner="you", area="controlled"), "op": ">=", "n": int(m.group(2) or 1)}}
            return {"not": c0} if m.group(3) == "していない" else c0
    m = re.fullmatch(r"対戦相手が" + "(E\\.G\\.O\\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)" + r"のキャラクターを支配している場合", text)
    if m: return {"count": {"sel": {"owner": "opp", "area": "controlled", "faction": FACTION_JP[m.group(1)]}, "op": ">=", "n": 1}}
    m = re.fullmatch(r"このキャラクター(?:のパワーが|がパワー)(\d+)の場合", text)
    if m: return {"selfPower": {"op": "=", "n": int(m.group(1))}}
    m = re.fullmatch(r"あなたが“([^”]+)”を支配している場合", text)   # EP541 / EP545 (Revise#229)
    if m: return {"count": {"sel": {"owner": "you", "area": "controlled", "name": re.sub(r"\s+", "", m.group(1))}, "op": ">=", "n": 1}}
    m = re.fullmatch(r"このキャラクターに「([^」]+)」がセットされている場合", text)   # EP466 (Revise#229)
    if m: return {"selfHasJp": re.sub(r"\s+", "", m.group(1))}
    m = re.fullmatch(r"あなたの支配エリアに“([^”]+)”がいる場合", text)
    if m: return {"count": {"sel": {"owner": "you", "area": "controlled", "name": re.sub(r"\s+", "", m.group(1)), "notSelf": True}, "op": ">=", "n": 1}}
    m = re.fullmatch(r"このカードの下に「([^」]+)」がある場合", text)
    if m: return {"belowName": re.sub(r"\s+", "", m.group(1))}
    m = re.fullmatch(r"このキャラクターのパワーが(\d+)(以上|以下)?の場合", text)
    if m: return {"selfPower": {"op": {"以上": ">=", "以下": "<="}.get(m.group(2), "="), "n": int(m.group(1))}}
    if "、または" in text and text.endswith("場合"):   # A4-03 0442 (Revise#283): "Aの場合、またはBの場合" / "A、またはBの場合"
        parts = [p if p.endswith("場合") else p + "の場合" for p in text.split("、または")]
        cs = [cond_of(p) for p in parts]
        if all(cs): return {"any": cs}
    m = re.fullmatch(r"あなたのダメージ置き場のカード(?:枚数)?が(\d+)枚(以上|以下)の場合", text)
    if m: return {"damage": {"op": ">=" if m.group(2) == "以上" else "<=", "n": int(m.group(1))}}
    return None


def gained_effect(text):
    """A character that gains skills and / or a whole effect line, maybe under a condition → always-on mods, or None."""
    m = re.fullmatch(r"(?:(.+?)、)?≪(このキャラクター|このカードをセットされているキャラクター)≫は、?(?:(.+?)を得、)?(?:エフェクト)?「((?:\d+|X)[:：].+?)」を(?:得る|持つ)。?", text)
    if not m: return None
    cond = None
    if m.group(1):
        cond = cond_of(m.group(1))
        if cond is None: return None
    out = []
    if m.group(3):
        sk = skills_list(m.group(3))
        if not sk: return None
        out += [{"kind": "always", "text": text, "mod": {"to": "self", "key": "skill", "op": "grant", "value": {"id": x["id"], "x": x["x"]}}} for x in sk]
    line = m.group(4).replace("：", ":")
    em = EFFECT_LINE.match(line)
    if not em: return None
    body = parse_body(em.group(2))
    if body["status"] == "manual": return None
    ef = dict({"cost": "X" if em.group(1) == "X" else int(em.group(1)), "text": line}, **body)
    out.append({"kind": "always", "text": text, "mod": {"to": "self", "key": "effect", "op": "grant", "value": ef}, "status": body["status"]})
    if cond:
        for ab in out: ab["cond"] = cond
    return out


def player_hit(body, c):
    """The part after "通常のダメージ判定を行わず / の後、" → {effect: {steps, x?}} for the attacked player, or None."""
    P = r"≪(?:このキャラクターの)?アタックを受けたプレイヤー≫"
    body, xd = re.sub(r"。?$", "", body), None
    xm = re.search(r"。(Xは[^。]+に等しい)$", body)
    if xm: xd, body = x_def(xm.group(1)), body[:xm.start()]
    if xm and xd is None: return None
    if body.endswith("。その後、このカードを捨て札する"):   # A3-03 0513 (Revise#159): the Permanent goes after
        r = player_hit(body[:-len("。その後、このカードを捨て札する")] + ("。" + xm.group(1) if xm else ""), c)
        if r: r["effect"]["steps"] = r["effect"]["steps"] + [{"a": "selfCardDiscard"}]
        return r
    m = re.fullmatch(P + r"のデッキから(X|\d+)枚を、?そのオーナーのダメージ置き場に置く", body)   # A3-03 0588
    if m and (m.group(1) != "X" or xd): return {"effect": dict({"steps": [{"a": "mill", "to": "attackedPlayer", "n": "X" if m.group(1) == "X" else int(m.group(1)), "zone": "damage"}], "status": "auto"}, **({"x": xd} if xd else {}))}
    nx = lambda g: "X" if g == "X" else int(g)
    if re.fullmatch(r"あなたは" + P + r"の、手札全て、またはデッキ全て、またはそのプレイヤーの支配キャラクターにセットされているパワーカード全てを見て、その中からあなたの任意のカード1枚をダメージ置き場に置く", body):   # 3390 (Revise#152)
        return {"effect": {"steps": [{"a": "peekPickToDamage"}], "status": "auto"}}
    m = re.fullmatch(r"そのプレイヤーのデッキの一番上のカード(\d+)枚をダメージ置き場に置く", body)
    if m: return {"effect": {"steps": [{"a": "mill", "to": "attackedPlayer", "n": int(m.group(1)), "zone": "damage"}], "status": "auto"}}
    m = re.fullmatch(P + r"のデッキの上から(X|\d+)枚のカードを(、そのオーナーのダメージ置き場に置く|捨て札する)", body)
    if m: return {"effect": dict({"steps": [{"a": "mill", "to": "attackedPlayer", "n": nx(m.group(1)), "zone": "damage" if "ダメージ" in m.group(2) else "discard"}], "status": "auto"}, **({"x": xd} if xd else {}))}
    m = re.fullmatch(r"≪アタックを受けたプレイヤーのデッキ≫の上から、このキャラクターの攻撃力に等しい枚数のカードを捨て札する(?:。その後、そのプレイヤーのデッキの上から(X|\d+)枚を捨て札する)?", body)
    if m and m.group(1) and (m.group(1) != "X" or xd): return {"effect": dict({"steps": [{"a": "mill", "to": "attackedPlayer", "nx": {"selfStat": "at"}}, {"a": "mill", "to": "attackedPlayer", "n": nx(m.group(1))}], "status": "auto"}, **({"x": xd} if xd else {}))}
    if m and not m.group(1): return {"effect": {"steps": [{"a": "mill", "to": "attackedPlayer", "n": "X"}], "x": {"selfStat": "at"}, "status": "auto"}}
    m = re.fullmatch(r"≪アタックを受けたプレイヤーのデッキ≫の上から(X|\d+)枚(?:のカード)?を捨て札する", body)   # Revise#134
    if m and (m.group(1) != "X" or xd): return {"effect": dict({"steps": [{"a": "mill", "to": "attackedPlayer", "n": nx(m.group(1))}], "status": "auto"}, **({"x": xd} if xd else {}))}
    m = re.fullmatch(P + r"の手札全てをそのプレイヤーのダメージ置き場に置く", body)
    if m: return {"effect": {"steps": [{"a": "handTake", "to": "attackedPlayer", "all": True, "dest": "damage"}], "status": "auto"}}
    m = re.fullmatch(P + r"の手札から、あなたの任意のカード(?:を)?(X|\d+)枚(まで)?(?:を)?(捨て札する|そのプレイヤーのダメージ置き場に置く)", body)
    if m and (m.group(1) != "X" or xd): return {"effect": dict({"steps": [{"a": "handTake", "to": "attackedPlayer", "n": nx(m.group(1)), "upTo": bool(m.group(2)), "dest": "discard" if m.group(3) == "捨て札する" else "damage"}], "status": "auto"}, **({"x": xd} if xd else {}))}
    return None


def count_def(w):
    """"…1枚につき" → an X definition (a count), or None (Revise#109)."""
    if w == "このカード以外の、このキャラクターを構成するブレイクカード": return {"stackBreaks": True}
    m = re.fullmatch(r"(他のプレイヤー|あなた)のダメージ置き場に置かれている(?:(ネームを持つ)ブレイクカード|“([^”]+)”のネームを持つカード)", w)
    if m: return {"pileCount": dict({"zone": "damage", "owner": "others" if m.group(1) == "他のプレイヤー" else "you"}, **({"type": "Break", "named": True} if m.group(2) else {"name": re.sub(r"\s+", "", m.group(3))}))}
    return None


HOST_NAME = re.compile(r"(?:≪)?この(?:カードをセットされている|カードをセットされた)?[“”\"]([^“”\"]+)[”\"](?:≫)?")
def talent_cond(c):   # "あなたの支配エリアに(、)このカードと異なるネームを持つブレイクしているタレントがいる" (A4-04, Revise#270)
    return {"count": {"sel": dict({"owner": "you", "area": "controlled", "broken": True, "icons": ["タレント", "タレント♂"]}, **({"notName": c["name"]} if c.get("name") else {})), "op": ">=", "n": 1}}


def parse_ability(text, c):
    # ---- Revise#347 ----
    fw = lambda t: re.sub(r"\s+", "", t).replace("（", "(").replace("）", ")")   # card names are stored with half-width brackets
    m = re.fullmatch(r"このカードがセットされた場合、≪あなたの手札の「(.+?)」1枚≫をこのキャラクターにセット可能。?", text)   # A4-EX02 EX801 / EX833 / EX828 (Revise#347)
    if m: return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "pickZone", "zones": ["hand"], "owner": "you", "sel": {"types": ["Permanent"], "jp": fw(m.group(1))}, "n": 1, "dest": "perm"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このキャラクターに「(.+?)」がセットされている場合、≪このキャラクター≫は(.+?)を得、アタック宣言した際、ターン終了時まで攻撃力に\+(\d+)される。?", text)   # A4-EX02 EX801
    if m and skills_list(m.group(2)):
        cd = {"selfHasJp": fw(m.group(1))}
        return [{"kind": "always", "text": text, "cond": cd, "mod": {"to": "self", "key": "skill", "op": "grant", "value": {"id": x["id"], "x": x["x"]}}} for x in skills_list(m.group(2))] + [{"kind": "trigger", "when": {"event": "attack", "self": True}, "cond": cd, "optional": False, "text": text, "effect": {"steps": [{"a": "mod", "to": "self", "mod": {"key": "at", "op": "add", "value": int(m.group(3))}, "until": "turn"}], "status": "auto"}, "status": "auto"}]
    # ---- Revise#353 ----
    if re.fullmatch(r"≪このキャラクター≫に与えられた精神ダメージは、そのダメージを与えたカードのオーナーが代わりに受ける。?", text):   # A4-PP PP245 / PP253
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "dmgToSource", "op": "grant", "value": {"mental": True}}}]
    if re.fullmatch(r"このキャラクターに与えられた精神ダメージまたはバトル以外のダメージは、≪そのダメージを与えたカードもしくはキャラクターのオーナー≫が代わりに受ける。?", text):   # A3-11 1630
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "dmgToSource", "op": "grant", "value": {"mental": True, "nonBattle": True}}}]
    if re.fullmatch(r"あなたに与えられるダメージは、≪このキャラクター≫が代わりに受ける。その後、このカードを捨て札する。?", text) and c.get("type") == "Permanent":   # A4-PP PP335 / PP343
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "ownerShield", "op": "grant", "value": True}}]
    # ---- Revise#352 ----
    m = re.fullmatch(r"≪あなたが支払ったコストに含まれる[“\"]([^”\"]+)[”\"]のネームを持つカード≫を、このカードの下に、このキャラクターを構成するカードとしてセット可能。?", text)   # A4-05 0805 / 0823 / 1004 / 1010: the cost paid to set this card
    if m:
        c["costUnderName"] = re.sub(r"\s+", "", m.group(1))
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "costUnder", "name": c["costUnderName"]}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"このカードがセットされた場合、≪あなたの任意の枚数の、あなたの手札のこのカードと同じネームを持つカード≫を、このキャラクターを構成するカードとしてセットすることが可能。?", text):   # A4-04 0769 / 0784
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "handUnder", "sameName": True, "any": True}], "status": "auto"}, "status": "auto"}]
    # ---- Revise#351 ----
    m = re.fullmatch(r"≪このキャラクターを対象に含むプロジェクトカード・ファストカード全て≫はコストが(\d+)上昇する。?", text)   # A4-02 0301 / PP101
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "cardCostT", "op": "add", "value": {"types": ["Project", "Fast"], "n": int(m.group(1)), "targetsSrc": True}}}]
    # ---- Revise#349 ----
    m = re.fullmatch(r"このキャラクターから代わりにコストを支払ってあなたの支配キャラクターがアタック宣言またはガード宣言した場合、ターン終了時まで、≪そのキャラクター≫は([±+\-ー−]\d+)/([±+\-ー−]\d+)/([±+\-ー−]\d+)される。?", text)   # A4-01 0111 / 0126
    if m:
        sv = lambda v: 0 if v[0] == "±" else int(v[1:]) * (-1 if v[0] in "-ー−" else 1)
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "subPayBuff", "op": "grant", "value": {k: sv(m.group(g)) for k, g in (("se", 1), ("at", 2), ("de", 3)) if sv(m.group(g))}}}]
    if re.fullmatch(r"対戦相手のダメージ置き場にパーマネントカードがある場合、≪このキャラクター≫はガードされない。?", text):   # A4-PP PP334 / PP342
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "noGuardBy", "op": "grant", "value": {}}, "cond": {"xAtLeast": {"x": {"pileCount": {"zone": "damage", "owner": "others", "type": "Permanent"}}, "n": 1}}}]
    m = re.fullmatch(r"このキャラクターがバトルする際、≪このキャラクターのバトル相手≫の攻撃力に[-ー−]\(X\)・[-ー−]Xする。(Xは[^。]+に等しい)。?", text)   # A4-05 0836 / 0854
    if m and x_def(m.group(1)): return [{"kind": "always", "text": text, "mod": {"to": {"all": {"oppOfSelf": True}}, "key": k, "op": "add", "value": {"x": x_def(m.group(1)), "sign": -1}}} for k in ("at", "atm")]
    if re.fullmatch(r"≪このキャラクターを対象に含むプロジェクトカード・ファストカードのコスト≫は捨て札置き場に置かず、そのオーナーのダメージ置き場に置かれる。?", text):   # A4-05 0836 / 0854
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "dest", "op": "dest", "value": {"cost": "set", "types": ["Project", "Fast"], "onTarget": "self", "to": "damage"}}}]
    m = re.fullmatch(r"あなたが、各ターンの最初にネームを持つブレイクカードをセットした場合、ターン終了時まで、≪このキャラクター≫は(バインド|ドロー|チャージ)Xを得る。(Xは[^。]+に等しい)。?", text)   # A4-PP PP331 / PP339
    if m and x_def(m.group(2)): return [{"kind": "trigger", "when": {"event": "ownBreakFirst", "named": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "mod", "to": "self", "mod": {"key": "skill", "op": "grant", "value": {"id": SKILL_JP[m.group(1)], "x": {"x": x_def(m.group(2)), "sign": 1}}}, "until": "turn"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカードがあなたのダメージ置き場にある場合、≪(.+?)キャラクター全て≫の攻撃力に\+(\d+)し、(.+?)を与える。?", text)   # A4-PP PP140 / PP148: works from the Damage Pile
    if m and parse_selector(m.group(1)) and skills_list(m.group(3)):
        grp = {"all": parse_selector(m.group(1))}
        return [{"kind": "always", "zone": "damage", "text": text, "mod": {"to": grp, "key": "at", "op": "add", "value": int(m.group(2))}}] + [{"kind": "always", "zone": "damage", "text": text, "mod": {"to": grp, "key": "skill", "op": "grant", "value": {"id": x["id"], "x": x["x"]}}} for x in skills_list(m.group(3))]
    m = re.fullmatch(r"≪(.+?)キャラクター全て≫は、(.+?)を得、受けるダメージに[-ー−]\((\d+)\)する。この効果は、このカードがダメージ置き場にある場合にも効果を発揮する。?", text)   # A4-PP PP241 / PP249: on the field and from the Damage Pile
    if m and parse_selector(m.group(1)) and skills_list(m.group(2)):
        grp = {"all": parse_selector(m.group(1))}
        base = [{"kind": "always", "text": text, "mod": {"to": grp, "key": "skill", "op": "grant", "value": {"id": x["id"], "x": x["x"]}}} for x in skills_list(m.group(2))] + [{"kind": "always", "text": text, "mod": {"to": grp, "key": "dmgReduce", "op": "add", "value": {"mental": int(m.group(3))}}}]
        return base + [dict(x, zone="damage") for x in base]
    # ---- Revise#348 ----
    m = re.fullmatch(r"≪あなた≫は、各ターンに1度だけ、あなたのダメージ置き場にある(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)勢力のカードを手札にあるカードと同様に使用宣言可能。?", text)   # A4-05 0982 / 1000
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "breakFromDamage", "op": "grant", "value": {"faction": FACTION_JP.get(m.group(1)) or FACTION_JP[m.group(1).replace("ー", "-")], "oncePerTurn": True}}}]
    m = re.fullmatch(r"追加の(\d+)コストを?支払うことで、≪あなた≫は、このカードをファストカードのタイミングでセット宣言可能。?", text)   # A4-PP PP213 / PP221
    if m: c["fastExtra"] = int(m.group(1)); return []
    m = re.fullmatch(r"このカードがセットされた場合、メインフェイズ終了時まで、≪このキャラクター以外のキャラクター全て≫にパーマネント-Xを与え、精神力に-Xする。(Xは[^。]+に等しい)。?", text)   # A4-PP PP272 / PP280
    if m and x_def(m.group(1)):
        grp = {"all": {"notSelf": True}}; xd = x_def(m.group(1))
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "mod", "to": grp, "mod": {"key": "skill", "op": "grant", "value": {"id": "permanent", "x": {"x": xd, "sign": -1}}}, "until": "main"}, {"a": "mod", "to": grp, "mod": {"key": "se", "op": "add", "value": {"x": xd, "sign": -1}}, "until": "main"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪あなた≫は、(武蔵|英国|三征西班牙|K\.P\.A\.Italia)を持つ手札を公開しない場合、このカードを手札からセット宣言できない。?", text)   # A4-EX02 EX844 (Revise#347)
    if m: c["setCond"] = {"handHasTag": m.group(1)}; return []
    m = re.fullmatch(r"このカードが本来の精神力が(\d+)以上の[“\"]([^”\"]+)[”\"]にセットされている場合、(≪このキャラクター≫は.+)", text)   # A4-EP EP438
    if m:
        sub = parse_ability(m.group(3), c)
        if sub and all(x.get("kind") == "always" and "cond" not in x for x in sub):
            cd = {"selfIs": {"name": re.sub(r"\s+", "", m.group(2)), "baseStat": [{"key": "se", "op": ">=", "n": int(m.group(1))}]}}
            return [dict(x, text=text, cond=cd) for x in sub]
    m = re.fullmatch(r"(このカードが[“\"][^”\"]+[”\"]にセットされている場合)、≪このキャラクター≫がエフェクトによって与えるダメージの数値に\+(\d+)して判定する。?", text)   # A4-EX01 EX0728
    if m and cond_of(m.group(1)): return [{"kind": "always", "text": text, "cond": cond_of(m.group(1)), "mod": {"to": "self", "key": "effDmgUp", "op": "add", "value": int(m.group(2))}}]
    m = re.fullmatch(r"このキャラクターがバトルまたはアタックによるダメージを与える場合、≪バトル相手のキャラクターまたはアタック目標≫に(\d+)回同時にダメージを与える。?", text)   # A4-EX02 EX807
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "multiHit", "op": "grant", "value": int(m.group(1))}, "cond": {"battleOrAttackPlayer": True}}]
    m = re.fullmatch(r"≪このカードがセットされているブレイクしているキャラクター≫は(.+?)を得る。?", text)   # A4-04 0707
    if m and skills_list(m.group(1)): return [{"kind": "always", "text": text, "cond": {"selfIs": {"broken": True}}, "mod": {"to": "self", "key": "skill", "op": "grant", "value": {"id": x["id"], "x": x["x"]}}} for x in skills_list(m.group(1))]
    m = re.fullmatch(r"≪このキャラクター≫は分類(?!・)(\S+?)を得る。?", text)   # A4-04 0707: "分類悪魔を得る"
    if m and class_tokens(m.group(1)): return [dict(x, text=text) for x in parse_ability("≪このキャラクター≫は" + m.group(1) + "を得る。", c) or []] or None
    if re.fullmatch(r"≪捨て札されるこのカード≫は手札に戻る。?", text): return [dict(x, text=text) for x in parse_ability("このカードが捨て札になる場合、≪このカード≫を手札に戻す。", c)]   # A4-04 0707
    if re.search(r"(?:ターン|メインフェイズ)終了時まで≪", text): return parse_ability(re.sub(r"((?:ターン|メインフェイズ)終了時まで)≪", r"\1、≪", text), c)   # A4-PP PP268 (Revise#346): a missing comma
    if re.fullmatch(r"対戦相手がカードの使用宣言をしている場合、≪あなた≫は、このカードをファストカードのタイミングで、あなたの支配キャラクターにセット宣言可能。?", text): c["fastIfCond"] = {"oppDeclaring": True}; return []   # A4-PP PP268
    # ---- Revise#346 ----
    m = re.fullmatch(r"(このカードが.+?にセットされている場合)、≪このキャラクターとのバトルによって捨て札されるキャラクターを構成するカード全て≫を、オーナーのダメージ置き場に置く。?", text)   # A4-PP PP305
    if m and cond_of(m.group(1)): return [{"kind": "always", "text": text, "cond": cond_of(m.group(1)), "mod": {"to": "self", "key": "battleKillTo", "op": "grant", "value": True}}]
    if re.fullmatch(r"このカードがブレイクしているキャラクターにセットされている場合、≪このキャラクター≫は、このキャラクターを構成するキャラクターカードのスキル全てを持つ。?", text):   # A3-EX02 EX0114
        return [{"kind": "always", "text": text, "cond": {"selfIs": {"broken": True}}, "mod": {"to": "self", "key": "baseSkills", "op": "grant", "value": True}}]
    # ---- Revise#345 ----
    m = re.fullmatch(r"≪あなた≫は、((?:[“\"][^”\"]+[”\"]、?)+)を全て支配している場合、(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)勢力のカードをコストを無視して使用宣言可能。?", text)   # A4-05 0981 / 0999
    if m: return [{"kind": "always", "text": text, "cond": {"namesCtl": [re.sub(r"\s+", "", x) for x in re.findall(r"[“\"]([^”\"]+)[”\"]", m.group(1))]}, "mod": {"to": {"players": "you"}, "key": "cardCost", "op": "add", "value": {"n": -99, "sel": {"faction": FACTION_JP.get(m.group(2)) or FACTION_JP[m.group(2).replace("ー", "-")]}}}}]
    m = re.fullmatch(r"このカードが[“\"]([^”\"]+)[”\"]にセットされている場合、≪このキャラクターのアタック宣言に対してガード宣言したキャラクター≫にXダメージを与える。(Xは[^。]+に等しい)。?", text)   # A4-EX01 EX0725
    if m and x_def(m.group(2)): return [{"kind": "trigger", "when": {"event": "guarded", "self": True, "asAttacker": True}, "cond": cond_of("このカードが“" + m.group(1) + "”にセットされている場合"), "optional": False, "text": text, "effect": {"steps": [{"a": "damage", "to": "battleOpp", "n": "X", "mental": False}], "x": x_def(m.group(2)), "status": "auto"}, "status": "auto"}]
    # ---- Revise#344 ----
    if re.fullmatch(r"このカードの下にネームを持つカードがある場合、このキャラクターがバトルする際、≪バトル相手≫の持つスキル全てを無効化する。?", text):   # A4-EX02 EX914
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "battleOppSkillsOff", "op": "grant", "value": True}, "cond": {"belowNamed": True}}]
    m = re.fullmatch(r"このカードの下にネームを持つカードがある場合、≪このキャラクター≫は(.+?)を得、支配キャラクターを目標にアタック宣言可能。?", text)   # A4-EX02 EX915
    if m and skills_list(m.group(1)):
        return [{"kind": "always", "text": text, "cond": {"belowNamed": True}, "mod": {"to": "self", "key": "skill", "op": "grant", "value": {"id": x["id"], "x": x["x"]}}} for x in skills_list(m.group(1))] + [{"kind": "always", "text": text, "cond": {"belowNamed": True}, "mod": {"to": "self", "key": "attackChars", "op": "grant", "value": {"area": "controlled"}}}]
    m = re.fullmatch(r"≪「(.+?)」がセットされている状態でバトルまたはアタックしたこのキャラクター≫の攻撃力に\+(\d+)する。?", text)   # A4-EX02 EX855
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "at", "op": "add", "value": int(m.group(2))}, "cond": {"all": [{"selfHasJp": re.sub(r"\s+", "", m.group(1))}, {"any": [{"self": "inBattle"}, {"self": "attacking"}]}]}}]
    # ---- Revise#343 ----
    if "されたキャラクターのオーナーに≫に" in text: return parse_ability(text.replace("されたキャラクターのオーナーに≫に", "されたキャラクターのオーナー≫に"), c)   # A4-PR PR137: a stray に in the card text
    m = re.fullmatch(r"このキャラクターがブレイクしていない支配キャラクターとバトルした場合、バトル終了時に、あなたのデッキの一番上のカード(\d+)枚を、パワーカードとして≪このキャラクター≫にセットする。?", text)   # A4-05 0916 / 0934
    if m: return [{"kind": "trigger", "when": {"event": "battleEnd", "self": True, "vsUnbrokenCtl": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "powerFromDeck", "to": "self", "n": int(m.group(1))}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このキャラクターがこのカードと異なる名称の[“\"]([^”“\"]+)[”“\"]にブレイクされた場合、≪あなた≫は(\d+)ドローする。?", text)   # A4-PR PR063
    if m: return [{"kind": "trigger", "when": {"event": "brokenSelf", "newSel": {"name": re.sub(r"\s+", "", m.group(1)), "otherJp": True}}, "optional": False, "text": text, "effect": {"steps": [{"a": "draw", "to": "you", "n": int(m.group(2))}], "status": "auto"}, "status": "auto"}]
    FQ = r"(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)"
    fq = lambda t: FACTION_JP.get(t) or FACTION_JP[t.replace("ー", "-")]
    cnt = lambda who, f: {"count": {"sel": {"owner": who, "area": "controlled", "faction": fq(f)}, "op": ">=", "n": 1}}
    m = re.fullmatch(r"対戦相手が" + FQ + r"のキャラクターを支配している場合、≪このキャラクター≫は(.+?)を得、≪あなた≫は、このカードの必要ファクターとコストを無視してセット宣言可能。?", text)   # A4-PP PP329 / PP337
    if m and skills_list(m.group(2)):
        c["freeIf"] = {"oppControls": {"faction": fq(m.group(1))}, "normal": True}
        return [{"kind": "always", "text": text, "cond": cnt("opp", m.group(1)), "mod": {"to": "self", "key": "skill", "op": "grant", "value": {"id": x["id"], "x": x["x"]}}} for x in skills_list(m.group(2))]
    m = re.fullmatch(r"あなたが" + FQ + "と" + FQ + r"のキャラクターを支配しているか、対戦相手が" + FQ + "か" + FQ + r"のキャラクターを支配している場合、≪あなた≫は、このカードの必要ファクターとコストを無視してセット宣言可能。?", text)   # A4-PP PP238 / PP246
    if m: c["freeIf"] = {"cond": {"any": [{"all": [cnt("you", m.group(1)), cnt("you", m.group(2))]}, cnt("opp", m.group(3)), cnt("opp", m.group(4))]}, "normal": True}; return []
    m = re.fullmatch(r"≪このカード≫の必要ファクターは([EW阿ダ極イ]+)でも満たすことが可能。?", text)   # A4-PP PP239 / PP247: another Factor that also works
    if m and len(set(m.group(1))) == 1: c["altFactor"] = {FACTOR_LETTER[m.group(1)[0]]: len(m.group(1))}; return []
    m = re.fullmatch(r"≪このカード≫の必要ファクターは([EW阿ダ極イ]+)または([EW阿ダ極イ]+)でも満たすことが可能。?", text)   # A4-PP PP209 (Revise#345): two other Factors
    if m and len(set(m.group(1))) == 1 and len(set(m.group(2))) == 1: c["altFactor"] = [{FACTOR_LETTER[g[0]]: len(g)} for g in (m.group(1), m.group(2))]; return []
    m = re.fullmatch(r"このカードをセットした場合、≪キャラクター1人≫を指定する。指定されたキャラクターは(.+?)を得る。?", text)   # A4-PP PP209
    if m and skills_list(m.group(1)):
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"target": {"kind": "char", "sel": {}, "count": 1, "byChoice": True}, "steps": [{"a": "mod", "to": "t", "mod": {"key": "skill", "op": "grant", "value": {"id": x["id"], "x": x["x"]}}, "until": "source"} for x in skills_list(m.group(1))], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪このカード≫は[“\"]([^”\"]+)[”\"]にのみセット可能。?", text)   # A4-EX01 EX0724 (Revise#343)
    if m and c.get("type") == "Permanent": c["onlyOnNames"] = [re.sub(r"\s+", "", m.group(1))]; return []
    m = re.fullmatch(r"≪このキャラクターがダメージを与えたキャラクターにセットされているパーマネントカード(\d+)枚≫を捨て札する。?", text)   # A4-03 0444 / 0459
    if m: return [{"kind": "trigger", "when": {"event": "damaged", "byThisAny": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "cardsOf", "to": "evCh", "part": "perm", "n": int(m.group(1)), "dest": "discard"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"≪このキャラクターとのバトルによるダメージを受けたキャラクター≫とこのカードを捨て札する。?", text) and c.get("type") == "Permanent":   # A4-04 0674 / 0689
        return [{"kind": "trigger", "when": {"event": "damaged", "byThisBattle": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "discard", "to": "evCh"}, {"a": "discard", "to": "card"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"このキャラクターのバトル相手が捨て札される場合、≪そのキャラクターを場に残す効果全て≫を無効化する。?", text):   # A4-PP PP360 / PP368
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "noKeepVictims", "op": "grant", "value": {"battle": True}}}]
    m = re.fullmatch(r"≪あなたの(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)以外の(武蔵|英国|三征西班牙|K\.P\.A\.Italia)とネームを持つブレイクカード≫の必要ファクターは(\d+)減少する。?", text)   # A4-EX02 EX790
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "factorLess", "op": "grant", "value": {"n": int(m.group(3)), "sel": {"types": ["Break"], "tag": m.group(2), "named": True, "notFaction": fq(m.group(1))}}}}]
    # ---- Revise#342 ----
    m = re.fullmatch(r"あなたの支配エリアに、?このカードと異なるネームを持つブレイクしているタレントがいる場合、≪このカード≫の必要ファクターは(\d+)減少し、(≪このキャラクター≫は(?:[+±][\d]+/[+±]\(?\d+\)?/[+±]\d+される|「.+」を得る)。?)", text)   # A4-04 0733 / 0748 / 0703 / 0718
    if m:
        sub = parse_ability(m.group(2), c)
        if sub and all(x.get("kind") == "always" and "cond" not in x and x.get("status", "auto") == "auto" for x in sub):
            c["factorLessIf"] = {"cond": talent_cond(c), "n": int(m.group(1))}
            return [dict(x, text=text, cond=talent_cond(c)) for x in sub]
    m = re.fullmatch(r"このカードがセットされた場合、キャラクター1人を指定する。≪指定されたキャラクター≫は(レジスト[^。]+?)を得る。?", text)   # A4-04 0607 / 0622: while this card stays
    if m:
        toks = m.group(1)[len("レジスト"):].split("・")
        rx = {"factions": [FACTION_JP[t] for t in toks if t in FACTION_JP], "icons": [t for t in toks if t not in FACTION_JP]}
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"target": {"kind": "char", "sel": {}, "count": 1, "byChoice": True}, "steps": [{"a": "mod", "to": "t", "mod": {"key": "skill", "op": "grant", "value": {"id": "resist", "x": rx}}, "until": "source"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このキャラクターがプレイヤーにアタックした場合、≪(アタックを受けたプレイヤーのテリトリーの、.+?)キャラクタ.1人≫を捨て札可能。?", text)   # A4-02 0246 / 0260
    if m and parse_selector(m.group(1)):
        return [{"kind": "trigger", "when": {"event": "attack", "self": True, "toPlayer": True}, "optional": True, "text": text, "effect": {"target": {"kind": "char", "sel": parse_selector(m.group(1)), "count": 1, "byChoice": True}, "steps": [{"a": "discard", "to": "t"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"このキャラクターがパワー0の場合、≪このカード≫は捨て札される。?", text) and c.get("type") == "Permanent":   # A3-PP PP075 (Revise#342)
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "zeroPowerCardDie", "op": "grant", "value": True}}]
    m = re.fullmatch(r"このカードがセットされた場合、≪キャラクター1人≫を指定する。指定されたキャラクターは(.+?)を得、([±+\-ー−]\(?\d+\)?)/([±+\-ー−]\(?\d+\)?)/([±+\-ー−]\(?\d+\)?)される。?", text)   # A4-PP PP269 / PP277
    if m and skills_list(m.group(1)):
        mods = [{"key": "skill", "op": "grant", "value": {"id": x["id"], "x": x["x"]}} for x in skills_list(m.group(1))]
        for k, g in (("se", 2), ("at", 3), ("de", 4)):
            v = m.group(g); n = int(re.search(r"\d+", v).group(0)) * (-1 if v[0] in "-ー−" else 1)
            if n: mods.append({"key": ("atm" if k == "at" else k) if "(" in v else k, "op": "add", "value": n})
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"target": {"kind": "char", "sel": {}, "count": 1, "byChoice": True}, "steps": [{"a": "mod", "to": "t", "mod": md, "until": "source"} for md in mods], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"≪このキャラクター≫が▼を持たないキャラクターに与えるダメージは無効化される。?", text):   # A4-EX01 EX0666 (Revise#342)
        return [{"kind": "always", "text": text, "mod": {"to": {"all": {"aggressive": False}}, "key": "noDamage", "op": "grant", "value": {"fromSrc": True}}}]
    # ---- Revise#341 ----
    m = re.fullmatch(r"≪このキャラクターのアタック宣言に対してガード宣言するか、このキャラクターにガード宣言された、ブレイクしていないキャラクターのオーナー≫は、デッキの上からカードを(\d+)枚捨て札する。?", text)   # A4-02 0241 / 0256
    if m: return [{"kind": "trigger", "when": {"event": "guarded", "self": True, "oppSel": {"broken": False}}, "optional": False, "text": text, "effect": {"steps": [{"a": "mill", "to": "battleOppOwner", "n": int(m.group(1))}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このキャラクターがアタック宣言している場合、≪このキャラクター≫の攻撃力に\+(\d+)し、≪このキャラクターのアタック宣言に対してガード宣言したキャラクター≫に(\d+)ダメージを与える。?", text)   # A4-EP EP484 / EP517
    if m: return [{"kind": "always", "text": text, "mod": {"key": "at", "op": "add", "value": int(m.group(1)), "to": "self"}, "cond": {"self": "attacking"}},
                  {"kind": "trigger", "when": {"event": "guarded", "self": True, "asAttacker": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "damage", "to": "battleOpp", "n": int(m.group(2)), "mental": False}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このキャラクターがブーストのコストを(\d+)コスト以上支払ってアタック宣言している場合、≪このキャラクターのバトル相手≫の持つスキル全てを無効化する。?", text)   # A4-EX01 EX0711 / EX0771
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "battleOppSkillsOff", "op": "grant", "value": True}, "cond": {"self": "attackingBoost", "n": int(m.group(1))}}]
    m = re.fullmatch(r"(?:あなたの支配エリアにブレイクしている[“\"]([^”\"]+)[”\"]がいる場合、)?≪このキャラクター≫から、?あなたの支配エリアの[“\"]([^”\"]+)[”\"]のアタックコスト・ガードコストを(?:代わりに)?支払うことが可能。?", text)   # A4-EP EP401 / EP523 / EP526 / EP557 / EP560
    if m: return [dict({"kind": "always", "text": text, "mod": {"to": "self", "key": "payFor", "op": "grant", "value": {"kinds": ["attack", "guard"], "sel": {"owner": "you", "area": "controlled", "name": re.sub(r"\s+", "", m.group(2))}}}}, **({"cond": {"namesCtl": [re.sub(r"\s+", "", m.group(1))], "broken": True}} if m.group(1) else {}))]
    if re.fullmatch(r"≪あなたと、あなたの支配キャラクター全て≫は、あなたの対戦相手が使用したプロジェクトカード・ファストカード・エフェクトの効果を受けない。?", text):   # A4-PP PP243 / PP251
        return [{"kind": "always", "text": text, "mod": {"to": {"all": {"owner": "you", "area": "controlled"}}, "key": "untargetable", "op": "grant", "value": {"from": ["Project", "Fast", "Effect"], "byOpp": True}}},
                {"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "playerImmune", "op": "grant", "value": {"byOpp": True}}}]
    if re.fullmatch(r"≪このキャラクターのバトル相手のキャラクター≫は、バトル終了時まで、プロジェクトカード・ファストカード・エフェクトの効果を受けない。?", text):   # A4-PP PP110 / PP118
        return [{"kind": "always", "text": text, "mod": {"to": {"all": {"oppOfSelf": True}}, "key": "untargetable", "op": "grant", "value": {"from": ["Project", "Fast", "Effect"]}}}]
    if re.fullmatch(r"このキャラクターにブレイクカードをセット宣言する場合、≪あなた≫は、そのカードのコストを無視してセット宣言可能。?", text):   # A4-PP PP303 / PP311
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "breakCostFree", "op": "grant", "value": True}}]
    m = re.fullmatch(r"このキャラクターが対戦相手にアタックした場合、ターン終了時まで、≪あなた≫は、(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のパーマネントカードをコストを無視してセット宣言可能。?", text)   # A4-05 0840 / 0858
    if m: return [{"kind": "trigger", "when": {"event": "attack", "self": True, "toPlayer": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "field", "mod": {"to": "you", "key": "cardCost", "op": "add", "value": {"n": -99, "sel": {"types": ["Permanent"], "faction": FACTION_JP[m.group(1)]}}, "until": "turn"}}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"≪このキャラクター≫は、このキャラクターにセットされているパーマネントカードの勢力に対するレジスト・プロテクトを得る。?", text):   # A4-01 0176 / 0191
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "permFactionGuard", "op": "grant", "value": True}}]
    # ---- Revise#340 ----
    m = re.fullmatch(r"あなたがネームレベルキャラクターをネームを持つブレイクカードでブレイクした場合、≪そのキャラクター≫に、あなたのデッキの一番上のカード(\d+)枚をパワーカードとしてセットする。?", text)   # A4-04 0768 / 0783 / PR091
    if m: return [{"kind": "trigger", "when": {"event": "broken", "own": True, "cardNamed": True, "prevNamed": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "powerFromDeck", "to": "evCh", "n": int(m.group(1))}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪アタック宣言したキャラクターのオーナー≫は、自分のデッキの上からカードを(\d+)枚捨て札する。?", text)   # A4-03 0536 / 0551
    if m: return [{"kind": "trigger", "when": {"event": "attack"}, "optional": False, "text": text, "effect": {"steps": [{"a": "mill", "to": "evOwner", "n": int(m.group(1))}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪ブレイクカードをセット宣言したプレイヤー≫は、自分のデッキの上からカードを(\d+)枚捨て札する。?", text)
    if m: return [{"kind": "trigger", "when": {"event": "cardDeclared", "types": ["Break"]}, "optional": False, "text": text, "effect": {"steps": [{"a": "mill", "to": "evPlayer", "n": int(m.group(1))}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"≪このキャラクターからバトルによるダメージを受けたパワー0のキャラクター≫は、バトル終了時に捨て札される。?", text):   # A4-02 0305 / 0320
        return [{"kind": "trigger", "when": {"event": "damaged", "byThisBattle": True, "chSel": {"power": {"op": "=", "n": 0}}}, "optional": False, "text": text, "effect": {"steps": [{"a": "discard", "to": "evCh"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪あなた≫は、あなたが各ターンの最初に使用する(.+?)のブレイクカードの必要ファクターを無視してセット宣言可能。?", text)   # A4-02 0213 / 0228: the first Break card of the turn, when it is one of that class
    if m and class_tokens(m.group(1)) and len(class_tokens(m.group(1))) == len(re.split(r"・|または", m.group(1))):
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "factorIgnore", "op": "grant", "value": {"type": "Break", "icons": class_tokens(m.group(1)), "firstInMain": True}}}]
    m = re.fullmatch(r"≪プレイヤー全て≫は(.+?)キャラクターからダメージを受けない。?", text)   # A4-PP PP050 / PP058
    if m and parse_selector(m.group(1)): return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "playerNoDamageFrom", "op": "grant", "value": {"sel": parse_selector(m.group(1))}}}]
    if text.startswith("≪あなた≫は全ての勢力のファクターをX得る"): return parse_ability(text.replace("≪あなた≫は全ての勢力", "≪あなた≫は、全ての勢力", 1), c)   # A4-02 0307 / 0322: wording variant
    # ---- Revise#339 ----
    if "を、パワーカードとしてこのキャラクターにセットする" in text: return parse_ability(text.replace("を、パワーカードとしてこのキャラクターにセットする", "をパワーカードとしてこのキャラクターにセットする"), c)   # A4-PR PR095: wording variant
    m = re.fullmatch(r"このカードがブレイクしてセットされた場合、≪このカードがセットされたキャラクターのオーナー≫に、このキャラクターの(攻撃力|精神力|耐久力)に等しいダメージを与える。?", text)   # A4-02 0210 / 0225
    if m: return parse_ability(f"このカードがセットされた場合、≪あなた≫にXダメージを与える。Xはこのキャラクターの{m.group(1)}に等しい。", c)
    m = re.fullmatch(r"このキャラクターがアタック目標にアタックした場合、≪このキャラクター≫の攻撃力に\+(\d+)して判定する。?", text)   # A4-04 0736 / 0751: the attack reaches its target (nobody guards)
    if m: return [{"kind": "always", "text": text, "cond": {"self": "attackingUnguarded"}, "mod": {"to": "self", "key": "at", "op": "add", "value": int(m.group(1))}}]
    if re.fullmatch(r"プレイヤーにアタックした場合、≪このキャラクター≫の攻撃力に\+\d+して判定する。?", text): return parse_ability("このキャラクターが" + text, c)   # A4-PP PP053 (a Permanent)
    m = re.fullmatch(r"このカードが““([^”]+)””にセットされている場合、(.+)", text)   # A4-EX01 EX0695: the Name is written with its own quotes (“武蔵”)
    if m:
        r0 = parse_ability(f"このカードが“ZZNAME”にセットされている場合、{m.group(2)}", c)
        if r0: return json.loads(json.dumps(r0, ensure_ascii=False).replace("ZZNAME", "“" + re.sub(r"\s+", "", m.group(1))))
    m = re.fullmatch(r"このキャラクターに“「([^」]+)」”がセットされている場合、(.+)", text)   # A4-EX01 EX0694: a card with the Name 「武蔵」 is set on it
    if m:
        r0 = parse_ability(f"このキャラクターに「ZZNAME」がセットされている場合、{m.group(2)}", c)
        if r0 and all(isinstance(x.get("cond"), dict) and x["cond"].get("selfHasJp") == "ZZNAME" for x in r0):
            for x in r0: x["cond"] = {"selfHasCardName": "「" + m.group(1) + "」"}; x["text"] = text
            return r0
    # ---- Revise#318 ----
    m = re.fullmatch(r"(あなたが[EW阿ダ極イ宇冥]+を満たした状態)でこのカードをセットした場合、(≪.+)", text)   # A4-PP PP208
    if m and cond_of(m.group(1)):
        ef = parse_body(m.group(2))
        if ef and ef.get("status") == "auto": return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "cond": cond_of(m.group(1)), "optional": False, "text": text, "effect": ef, "status": "auto"}]
    if re.search(r"あなたのデッキの上からカード\d+枚をパワーカードとしてセットする", text): return parse_ability(re.sub(r"あなたのデッキの上からカード(\d+)枚をパワーカード", r"あなたのデッキの一番上のカード\1枚をパワーカード", text), c)   # A4-PP PP214
    m = re.fullmatch(r"≪このキャラクター≫は、(.+?)とバトルする際、(攻撃力|耐久力|精神力)に([+\-]\d+)される。?", text)   # A4-05 0980 / 0998: wording variant
    if m: return parse_ability(f"このキャラクターが{m.group(1)}とバトルする際、≪このキャラクター≫の{m.group(2)}に{m.group(3)}する。", c)
    if re.fullmatch(r"≪このキャラクター≫は、パワー以下の数値の精神ダメージを受けない。?", text): return parse_ability("≪このキャラクター≫は、このキャラクターのパワー以下の数値の精神ダメージを受けない。", c)   # A4-PP PP215
    m = re.fullmatch(r"≪あなた≫は、パワーカードフェイズ終了時に(\d+)ドローする。?", text)   # A4-PR PR142
    if m: return [{"kind": "trigger", "when": {"event": "phaseEnd", "phase": "charge", "mine": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "draw", "to": "you", "n": int(m.group(1))}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"≪このカードのコスト≫は手札に戻る。?", text) and c.get("type") == "Permanent":   # A3-25 3799: the cost paid to set it comes back
        c["costBack"] = {"to": "hand"}; return []
    m = re.fullmatch(r"≪(.+?)全て≫は分類・([^、。・]+)を得る。?", text)   # A4-01 0018 / 0032: "≪あなたのテリトリーのキャラクター全て≫は分類・タレントを得る"
    if m and class_tokens(m.group(2)) == [m.group(2)]:
        p0 = parse_target(m.group(1) + "全て")
        if p0 and p0[0] == "ref" and isinstance(p0[1], dict) and "all" in p0[1]: return [{"kind": "always", "text": text, "mod": {"to": p0[1], "key": "icon", "op": "grant", "value": m.group(2)}}]
    m = re.fullmatch(r"≪ガード宣言しているこのキャラクター≫は(.+?)を得る。?", text)   # A4-EX02 EX797
    if m and skills_list(m.group(1)): return [{"kind": "always", "text": text, "cond": {"self": "guarding"}, "mod": {"to": "self", "key": "skill", "op": "grant", "value": {"id": x["id"], "x": x["x"]}}} for x in skills_list(m.group(1))]
    m = re.fullmatch(r"このカードが(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)の(ネームレベル)?キャラクターにセットされた場合、(≪.+)", text)   # A4-PP PP328
    if m:
        ef = parse_body(m.group(3))
        if ef and ef.get("status") == "auto": return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "cond": {"selfIs": dict({"faction": FACTION_JP.get(m.group(1)) or FACTION_JP[m.group(1).replace("ー", "-")]}, **({"named": True} if m.group(2) else {}))}, "optional": False, "text": text, "effect": ef, "status": "auto"}]
    if re.fullmatch(r"このカードがセットされたターンの終了時まで、≪あなた≫はブレイクカードをセット宣言できない。?", text):   # A4-PP PP214 / PP222
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "ban", "to": "you", "decl": "set", "type": "Break", "until": "turn"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪あなた≫は、このキャラクターに、ファストカードのタイミングで(武蔵|英国|三征西班牙|K\.P\.A\.Italia|六護式仏蘭西|M\.H\.R\.R\.|P\.A\.Oda|上越露西亜|清武田|IZUMO)を持つブレイクカードをセット宣言可能。?", text)   # A4-EX02 EX822 (Revise#294)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "breakFast", "op": "grant", "value": {"by": "you", "tag": m.group(1)}}}]
    m = re.fullmatch(r"≪このキャラクターを、(武蔵|英国|三征西班牙|K\.P\.A\.Italia|六護式仏蘭西|M\.H\.R\.R\.|P\.A\.Oda|上越露西亜|清武田|IZUMO)とネームを持つカードでブレイクしたプレイヤー≫は(\d+)ドローする。?", text)   # A4-EX02 EX820 (Revise#294)
    if m: return [{"kind": "trigger", "when": {"event": "brokenSelf", "newSel": {"named": True, "tag": m.group(1)}}, "ownerDecides": True, "optional": False, "text": text, "effect": {"steps": [{"a": "draw", "to": "evPlayer", "n": int(m.group(2))}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪このカードがセットされている(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)の(ネームレベル)?キャラクター≫に、?\+(\d+)/\+(\d+)/\+(\d+)する。?", text)   # A4-05 0808 (Revise#292), a Permanent
    if m:
        cd = {"selfIs": dict({"faction": FACTION_JP.get(m.group(1)) or FACTION_JP[m.group(1).replace("ー", "-")]}, **({"named": True} if m.group(2) else {}))}
        return [{"kind": "always", "text": text, "cond": cd, "mod": {"to": "self", "key": k, "op": "add", "value": int(m.group(g))}} for k, g in (("se", 3), ("at", 4), ("de", 5)) if int(m.group(g))]
    if re.fullmatch(r"このカードがセットされた場合、≪このキャラクター≫は、あなたの対戦相手1人を目標に、コストを支払わずにアタック宣言可能。?", text):   # A4-05 0952 (Revise#292), a Permanent: its Attack Cost is 0 this turn
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "mod", "to": "self", "mod": {"key": "attackCost", "op": "add", "value": -99}, "until": "turn"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"あなたのターンのメインフェイズ終了時に、このターン中、このキャラクターがアタック宣言していない場合、≪このキャラクター≫を捨て札する。?", text):   # A4-04 0764 / 0779 (Revise#288)
        return [{"kind": "trigger", "when": {"event": "phaseEnd", "phase": "main", "mine": True}, "cond": {"selfNoAttack": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "discard", "to": "self"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪アタック宣言しているこのキャラクター≫は(.+?)を得る。?", text)   # A4-04 0706 (Revise#288), a Permanent
    if m and skills_list(m.group(1)): return [{"kind": "always", "text": text, "cond": {"self": "attacking"}, "mod": {"to": "self", "key": "skill", "op": "grant", "value": {"id": x["id"], "x": x["x"]}}} for x in skills_list(m.group(1))]
    m = re.fullmatch(r"(.+?場合)、≪このカード≫の必要ファクターは(\d+)減少し、このカードがセットされた際、(≪.+)", text)   # A4-04 0672 / 0687 (Revise#288)
    if m:
        cd = talent_cond(c) if re.fullmatch(r"あなたの支配エリアに、?このカードと異なるネームを持つブレイクしているタレントがいる場合", m.group(1)) else cond_of(m.group(1))
        ef = parse_body(m.group(3)) if cd else None
        if ef and ef.get("status") == "auto":
            c["factorLessIf"] = {"cond": cd, "n": int(m.group(2))}
            return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "cond": cd, "optional": False, "text": text, "effect": ef, "status": "auto"}]
    if re.fullmatch(r"このキャラクターがバトルする際、バトル開始時に、≪このキャラクターのバトル相手にセットされているパワーカード1枚≫をそのオーナーの手札に戻す。?", text):   # A4-03 0405 / 0420 (Revise#287)
        return [{"kind": "trigger", "when": {"event": "battleStart", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "battleOppPowerTo", "dest": "hand"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"≪あなたの支配キャラクター≫が捨て札される場合、このキャラクターを捨て札することで、そのキャラクターを場に残すこと(?:が可能|ができる)。?", text):   # A4-03 0440 / 0455 (Revise#287)
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "sacSelfKeep", "op": "grant", "value": True}}]
    if "関らず" in text or "の持つエフェクトの効果を受けない" in text: return parse_ability(text.replace("関らず", "関わらず").replace("の持つエフェクトの効果を受けない", "のエフェクトの効果を受けない"), c)   # A4-03 0501 / 0410 (Revise#283): wording variants
    if re.fullmatch(r"≪このキャラクターをブレイクしたプレイヤー≫は(\d+)ドローする。?", text):   # A4-03 0501 / 0516 (Revise#283)
        return [{"kind": "trigger", "when": {"event": "brokenSelf"}, "ownerDecides": True, "optional": False, "text": text, "effect": {"steps": [{"a": "draw", "to": "evPlayer", "n": int(re.search(r"(\d+)ドロー", text).group(1))}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"≪このキャラクターから支払われたエフェクトコスト≫をデッキに戻し、そのデッキをシャッフルする。?", text):   # A4-03 0508 (Revise#283), a Permanent
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "dest", "op": "dest", "value": {"cost": "effect", "fromSelf": True, "to": "deckShuffle"}}}]
    m = re.fullmatch(r"≪プロジェクトカード全て≫はコストがX上昇する。(Xは[^。]+に等しい)。?", text)   # A4-02 0308 / 0323 (Revise#281)
    if m and x_def(m.group(1)): return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "cardCost", "op": "add", "value": {"n": {"x": x_def(m.group(1)), "sign": 1}, "sel": {"types": ["Project"]}}}}]
    m = re.fullmatch(r"このカードが分類・(.+?)にセットされた場合、(?:≪あなた≫は(\d+)ドローする|≪このキャラクター≫に、あなたのデッキの一番上のカード1枚をパワーカードとしてセットする)。?", text)   # A4-01 0014 / 0029 (Revise#281)
    if m and class_tokens(m.group(1)):
        st = {"a": "draw", "to": "you", "n": int(m.group(2))} if m.group(2) else {"a": "deckTopPowerSelf"}
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "cond": {"selfIs": {"icons": class_tokens(m.group(1))}}, "optional": False, "text": text, "effect": {"steps": [st], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"ターン開始時にこのキャラクターのパワーが0の場合、≪そのターンのプレイヤー≫は自分の支配キャラクタ.1人を捨て札する。?", text):   # A4-01 0175 / 0190 (Revise#281)
        return [{"kind": "trigger", "when": {"event": "turnStart"}, "cond": {"selfPowerIs": 0}, "optional": False, "text": text, "effect": {"steps": [{"a": "eachDiscardOwn", "who": "turn"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"このキャラクターがバトルするか、プレイヤーまたはキャラクターにアタックした場合、≪このカード≫を捨て札する。?", text):   # A4-01 0180 (Revise#281), a Permanent
        ef = {"steps": [{"a": "thisCardDiscard"}], "status": "auto"}
        return [{"kind": "trigger", "when": {"event": "battleStart", "self": True}, "optional": False, "text": text, "effect": ef, "status": "auto"}, {"kind": "trigger", "when": {"event": "attack", "self": True, "toPlayer": True}, "optional": False, "text": text, "effect": ef, "status": "auto"}]
    if re.fullmatch(r"≪あなたが各ターンのメインフェイズ中に最初に使用宣言するプロジェクトカードの、このキャラクターから支払われたコスト≫は、手札に戻る。?", text):   # A4-01 0079 / 0094 (Revise#281)
        return [{"kind": "always", "text": text, "mod": {"to": "you", "key": "dest", "op": "dest", "value": {"cost": "set", "type": "Project", "fromSelf": True, "firstMain": True, "to": "hand"}}}]
    if re.fullmatch(r"このカードがセットされた場合、≪あなた以外のプレイヤー全て≫は、手札を公開する。?", text): return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "revealHands", "to": "opp"}], "status": "auto"}, "status": "auto"}]   # A4-PP PP020 / PP028 (Revise#277)
    m = re.fullmatch(r"あなたに与えられたダメージは、≪このキャラクター≫が代わりに受ける。(その後、≪このカード≫を捨て札する。)?", text)   # A4-PP PP079 / PP087 (Revise#277)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "takeForOwner", "op": "grant", "value": {"thenDiscard": True} if m.group(1) else {}}}]
    m = re.fullmatch(r"(このキャラクターがアタック宣言またはガード宣言している場合)、バトルの際、(≪.+)", text)   # A4-01 0048 / 0063 (Revise#277)
    if m:
        r = parse_ability(m.group(1) + "、" + m.group(2), c)
        if r: return [dict(x, text=text) for x in r]
    if re.fullmatch(r"このキャラクターがバトルの結果捨て札される場合、≪このカード≫は(?:オーナーの)?手札に戻る。?", text): c["leaveSelfHandBattle"] = True; return []   # A4-01 0114 / 0128 (Revise#276)
    m = re.fullmatch(r"このカードがセットされた場合、≪あなたの手札のパーマネントカード(\d+)枚≫を、このキャラクターにセットすること(が可能|ができる)?。?", text)   # A4-01 0143 / 0158 (Revise#276)
    if m: return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "handPermToSelf", "n": int(m.group(1)), "upTo": bool(m.group(2))}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このキャラクターが与えたダメージによってキャラクターを捨て札した場合、≪あなた≫は(\d+)ドローする。?", text)   # A4-02 0337 / 0352 (Revise#276)
    if m: return [{"kind": "trigger", "when": {"event": "killed", "anyDamage": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "draw", "to": "you", "n": int(m.group(1))}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"このキャラクターがバトルする際、≪このキャラクターのバトル相手≫の持つスキル・エフェクト全てを、ターン終了時まで無効化する。?", text):   # A4-02 0341 / 0356 (Revise#276)
        return [{"kind": "trigger", "when": {"event": "battleStart", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "mod", "to": "battleOpp", "mod": {"key": "negate", "op": "grant", "value": {"skills": True, "effects": True}}, "until": "turn"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このキャラクターがプレイヤーにアタックした場合、通常のダメージ判定の後、≪アタックを受けたプレイヤー≫は、デッキの上からカードを(\d+)枚捨て札する。?", text)   # A4-02 0273 / 0288 (Revise#312)
    if m: return [{"kind": "trigger", "when": {"event": "hitPlayer", "by": "self"}, "optional": False, "text": text, "effect": {"steps": [{"a": "mill", "to": "evHit", "n": int(m.group(1))}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカードのセット宣言時に、(.*?)キャラクタ.1人を指定する。このカードがセットされた場合、≪指定したキャラクタ.1人≫に(?:(\d+)|(このキャラクターの攻撃力に等しい))ダメージを与える。?", text)   # A4-02 0374 / A4-01 0145 (Revise#311): chosen when the ability runs
    if m and (not m.group(1) or parse_selector(m.group(1)) is not None):
        ef = dict({"target": {"kind": "char", "sel": parse_selector(m.group(1)) if m.group(1) else {}, "count": 1}, "steps": [{"a": "damage", "to": "t", "n": "X" if m.group(3) else int(m.group(2)), "mental": False}], "status": "auto"}, **({"x": {"selfStat": "at"}} if m.group(3) else {}))
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": ef, "status": "auto"}]
    m = re.fullmatch(r"このカードがセットされた場合、またはこのキャラクターが対戦相手にアタック(?:宣言)?した場合、(.+)", text)   # A4-03 0471 / 0486 (Revise#310): two triggers, one body
    if m and not re.search(r"ダメージ置き場のカード\d+枚≫を手札に戻す", text):
        ef = parse_body(m.group(1))
        if ef["status"] != "manual":
            return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": ef, "status": ef["status"]}, {"kind": "trigger", "when": {"event": "attack", "self": True, "toPlayer": True}, "optional": False, "text": text, "effect": ef, "status": ef["status"]}]
    m = re.fullmatch(r"このカードがセットされた場合、またはこのキャラクターが対戦相手にアタックした場合、≪あなたのダメージ置き場のカード(\d+)枚≫を手札に戻す。?", text)   # A4-02 0309 / 0324 (Revise#276)
    if m:
        ef = {"steps": [{"a": "pickZone", "zones": ["damage"], "owner": "you", "sel": {}, "n": int(m.group(1)), "dest": "hand"}], "status": "auto"}
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": ef, "status": "auto"}, {"kind": "trigger", "when": {"event": "attack", "self": True, "toPlayer": True}, "optional": False, "text": text, "effect": ef, "status": "auto"}]
    if re.fullmatch(r"このカードがセットされた場合、≪このキャラクター≫はコストを支払わずにアタック宣言可能。?", text):   # A4-03 0437 / 0452 (Revise#276): its Attack Cost is 0 this turn
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "mod", "to": "self", "mod": {"key": "attackCost", "op": "add", "value": -99}, "until": "turn"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪あなた≫は、(\S+?)とネームを持つブレイクカードを、ファストカードのタイミングでセット宣言可能。?", text)   # A4-EX02 EX793 (Revise#275): a tag (武蔵 …) and a name
    if m and not re.search(r"[“”≪≫、]", m.group(1)): return [{"kind": "always", "text": text, "mod": {"to": "you", "key": "fastBreak", "op": "grant", "value": {"tag": m.group(1), "named": True}}}]
    m = re.fullmatch(r"≪あなた≫は、((?:“[^”]+”(?:または)?)+)のネームを持つブレイクカードをファストカードのタイミングでセット宣言可能。?", text)   # A4-EX02 EX849 (Revise#275)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "you", "key": "fastBreak", "op": "grant", "value": {"names": [re.sub(r"\s+", "", x) for x in re.findall(r"“([^”]+)”", m.group(1))]}}}]
    if re.fullmatch(r"≪あなた≫は、このキャラクターに、ファストカードのタイミングでブレイクカードをセット宣言可能。?", text): return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "breakFast", "op": "grant", "value": {"by": "you"}}}]   # A4-EX02 EX825 (Revise#275)
    if re.fullmatch(r"このキャラクターが捨て札される場合、≪このキャラクターにセットされているパーマネントカード1枚≫は手札に戻る。?", text): return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "leavePermHand", "op": "grant", "value": 1}}]   # A4-EX01 EX0705 (Revise#275)
    if re.fullmatch(r"このカードがセットされた際、≪対戦相手全て≫は手札の内容を公開する。?", text): return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "revealHands", "to": "opp"}], "status": "auto"}, "status": "auto"}]   # A4-EX02 EX799 (Revise#275)
    m = re.fullmatch(r"≪このキャラクターのアタック宣言に対してガード宣言したキャラクターのオーナー≫に(X|\d+)ダメージを与える。(Xは[^。]+に等しい。?)?", text)   # A4-05 0838 / 0856 (Revise#274)
    if m and (m.group(1) != "X" or (m.group(2) and x_def(m.group(2).rstrip("。")))):
        return [{"kind": "trigger", "when": {"event": "guarded", "self": True, "asAttacker": True}, "optional": False, "text": text, "effect": dict({"steps": [{"a": "damage", "to": "evOwner", "n": "X" if m.group(1) == "X" else int(m.group(1))}], "status": "auto"}, **({"x": x_def(m.group(2).rstrip("。"))} if m.group(1) == "X" else {})), "status": "auto"}]
    m = re.fullmatch(r"このカードがセットされた場合、≪あなた≫は、このカードがセットされたキャラクターのオーナーの手札を見る。その後、その中から(\d+)枚を捨て札可能。?", text)   # A4-04 0604 / 0619 (Revise#274)
    if m: return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "lookHandTake", "who": "selfOwner", "n": int(m.group(1)), "upTo": True, "dest": "discard"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このキャラクターがバトルによって対戦相手の支配キャラクターを捨て札した場合、≪捨て札されたキャラクターのオーナー≫は自身の手札を(\d+)枚選んで捨て札し、≪あなた≫は(\d+)ドローする。?", text)   # A4-04 0700 / 0715 (Revise#274)
    if m: return [{"kind": "trigger", "when": {"event": "killed", "controlled": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "ownDiscardBy", "to": "evOwner", "n": int(m.group(1))}, {"a": "draw", "to": "you", "n": int(m.group(2))}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"≪キャラクター全て≫は、分類に関わらずブレイク可能。?", text): return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "breakAnyIconAll", "op": "grant", "value": True}}]   # A4-05 0912 / 0930 (Revise#272)
    m = re.fullmatch(r"≪イニシアチブを(\d+)つ以上持つこのキャラクター≫はガードされない。?", text)   # A4-05 0800 / 0818 (Revise#272)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "unguardableInit", "op": "grant", "value": int(m.group(1))}}]
    m = re.fullmatch(r"このキャラクターが捨て札される場合、≪このキャラクターを構成する“([^”]+)”全て≫をダメージ置き場に置く。?", text)   # A4-03 0537 … (Revise#271)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "leaveNamedDamage", "op": "grant", "value": re.sub(r"\s+", "", m.group(1))}}]
    m = re.fullmatch(r"(?:このキャラクターにパーマネントカードがセットされている場合、≪このキャラクター≫|≪パーマネントカードがセットされているこのキャラクター≫)は、?(.+?)を得、(プレイヤーにアタックした場合、)?このキャラクターを構成する“([^”]+)”(\d+)枚につき、(?:このキャラクターの)?攻撃力に\+(\d+)(?:して判定する|される)。?", text)   # A4-01 0049 / A4-05 0841 … (Revise#271)
    if m and skills_list(m.group(1)):
        cp = {"selfHasPerm": True}
        out = [{"kind": "always", "text": text, "cond": cp, "mod": {"to": "self", "key": "skill", "op": "grant", "value": {"id": x["id"], "x": x["x"]}}} for x in skills_list(m.group(1))]
        out.append({"kind": "always", "text": text, "cond": {"all": [cp, {"attackPlayer": True}]} if m.group(2) else cp, "mod": {"to": "self", "key": "at", "op": "add", "value": {"x": {"selfNamed": re.sub(r"\s+", "", m.group(3)), "per": int(m.group(4))}, "sign": int(m.group(5))}}})
        return out
    m = re.fullmatch(r"(.+?場合)、≪このカード≫の必要ファクターは(\d+)減少し、≪このキャラクター≫は(.+?)を得る。?", text)   # A4-04 0605 / A4-05 0797 … (Revise#270 / #272)
    cd = m and (talent_cond(c) if re.fullmatch(r"あなたの支配エリアに、?このカードと異なるネームを持つブレイクしているタレントがいる場合", m.group(1)) else cond_of(m.group(1)))
    if m and cd and skills_list(m.group(3)):
        c["factorLessIf"] = {"cond": cd, "n": int(m.group(2))}
        return [{"kind": "always", "text": text, "cond": cd, "mod": {"to": "self", "key": "skill", "op": "grant", "value": {"id": x["id"], "x": x["x"]}}} for x in skills_list(m.group(3))]
    m = re.fullmatch(r"あなたの支配エリアに、?このカードと異なるネームを持つブレイクしているタレントがいる場合、≪このカード≫の必要ファクターは(\d+)減少する。?", text)
    if m: c["factorLessIf"] = {"cond": talent_cond(c), "n": int(m.group(1))}; return []
    m = re.fullmatch(r"あなたの支配エリアの、このキャラクター以外のネームを持つブレイクしているタレント1人につき、≪このキャラクター≫は\+(\d+)/\+(\d+)/\+(\d+)され(?:、キャパシティ\+Xの数値に\+(\d+)される)?。?", text)   # A4-04 0734 … (Revise#270)
    if m:
        xx = {"countChars": {"owner": "you", "area": "controlled", "broken": True, "named": True, "icons": ["タレント", "タレント♂"], "notSelf": True}}
        out = [{"kind": "always", "text": text, "mod": {"to": "self", "key": k, "op": "add", "value": {"x": xx, "sign": int(m.group(i))}}} for k, i in (("se", 1), ("at", 2), ("de", 3)) if int(m.group(i))]
        if m.group(4): out.append({"kind": "always", "text": text, "mod": {"to": "self", "key": "skill", "op": "grant", "value": {"id": "capacity", "x": {"x": xx, "sign": int(m.group(4))}}}})
        return out
    m = re.fullmatch(r"(.+?場合)、≪このカード≫の(必要ファクター|コスト)は(\d+)(減少|上昇)する。?", text)   # A4-05 0833 / A4-01 0170 … (Revise#259): a card's own factor / cost while in the hand
    if m and cond_of(m.group(1)) is not None and (m.group(4) == "減少" or m.group(2) == "コスト"):
        c["factorLessIf" if m.group(2) == "必要ファクター" else "costLessIf"] = {"cond": cond_of(m.group(1)), "n": int(m.group(3)) * (1 if m.group(4) == "減少" else -1)}; return []
    m = re.fullmatch(r"≪このカード≫は“([^”]+)”としても扱う。?", text)   # A4-04 0737 … (Revise#259)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "alsoName", "op": "grant", "value": re.sub(r"\s+", "", m.group(1))}}]
    r = parse_ability0(text, c)
    sm = r is None and re.fullmatch(r"(このカードが[“”\"][^“”\"]+[”\"]にセットされている場合)、(≪[^≫]+≫は[^≪]+?)され、(.+?)。?(Xは[^。]+。?)?", text)   # EX0291 / EX0296 / EX0436 (Revise#201): "…場合、≪このキャラクター≫は+1/+1/+1され、≪…のコスト≫は手札に戻る"
    if sm and cond_of(sm.group(1)):
        xs = ("。" + sm.group(4).rstrip("。") + "。") if sm.group(4) else ""
        r1 = parse_ability(sm.group(1) + "、" + sm.group(2) + "される" + (xs or "。"), c) or [dict(x, cond={"all": [x["cond"], cond_of(sm.group(1))]} if x.get("cond") else cond_of(sm.group(1))) for x in (parse_ability0(sm.group(2) + "される" + (xs or "。"), c) or [])]
        r2 = parse_ability0(sm.group(3) + (xs or "。"), c) if r1 and r1[0].get("kind") == "always" and (not xs or "X" in sm.group(3)) else parse_ability0(sm.group(3) + "。", c) if r1 else None
        if r1 and r2 and all(x.get("kind") in ("always", "trigger") for x in r2):
            cnd = cond_of(sm.group(1))
            return [dict(x, text=text) for x in r1] + [dict(x, text=text, cond={"all": [x["cond"], cnd]} if x.get("cond") else cnd) for x in r2]
    sm = r is None and re.fullmatch(r"(このカードが[“”\"][^“”\"]+[”\"]にセットされている場合)、([^。]+)。([^。]+)。?", text)   # EX0060 (Revise#210): "…場合、A。B。" — both sentences while it is set on that character
    if sm and cond_of(sm.group(1)):
        r1 = parse_ability(sm.group(1) + "、" + sm.group(2) + "。", c)
        r2 = parse_ability0(sm.group(3) + "。", c) if r1 else None
        if r1 and r2 and all(x.get("kind") in ("always", "trigger") for x in r1 + r2):
            cnd = cond_of(sm.group(1))
            return [dict(x, text=text) for x in r1] + [dict(x, text=text, cond={"all": [x["cond"], cnd]} if x.get("cond") else cnd) for x in r2]
    sm = r is None and re.fullmatch(r"(このカードが[“”\"][^“”\"]+[”\"]にセットされている場合)、([^。]+。?)", text)   # EX0063 (Revise#210): "…場合、<a trigger or always line>"
    if sm and cond_of(sm.group(1)):
        r2 = parse_ability0(sm.group(2).rstrip("。") + "。", c)
        if r2 and all(x.get("kind") in ("always", "trigger") for x in r2):
            cnd = cond_of(sm.group(1))
            return [dict(x, text=text, cond={"all": [x["cond"], cnd]} if x.get("cond") else cnd) for x in r2]
    hm = r is None and HOST_NAME.search(text)
    if hm:   # a Permanent / Break for one named character: "≪このカードをセットされている“X”≫は…" → this character, while it is “X” (Revise#164)
        name = re.sub(r"\s+", "", hm.group(1))
        t2 = HOST_NAME.sub(lambda m: ("≪このキャラクター" + ("≫" if m.group(0).endswith("≫") else "") if m.group(0).startswith("≪") else "このキャラクター"), text)
        r2 = parse_ability0(t2, c)
        if r2:
            out = []
            for x in r2:
                cnd = {"selfIs": {"name": name}}
                out.append(dict(x, text=text, cond={"all": [x["cond"], cnd]} if x.get("cond") else cnd))
            return out
    if r is None and re.search(r"(キャラクタ|プレイヤ|パワ|ファクタ)-", text):   # "キャラクタ-1人" as printed (Revise#152)
        t2 = re.sub(r"(キャラクタ|プレイヤ|パワ|ファクタ)-", r"\1ー", text)
        r = parse_ability0(t2, c)
        if r: r = [dict(x, text=text) for x in r]
    return r


def parse_ability0(text, c):
    """One ability statement (skills already removed) → [abilities], [] (handled as a card property), or None."""
    m = re.fullmatch(r"(?:あなたの支配エリアに分類・(.+?)がいる|(武蔵|英国|三征西班牙|K\.P\.A\.Italia)を持つ(ブレイクしている)?あなたの支配キャラクターが(\d+)体以上いる)場合、≪このキャラクター≫は(.+?)を得る。?", text)   # EX0677 / EX826 / EX831 (Revise#242)
    if m and skills_list(m.group(5)) and (not m.group(1) or class_tokens(m.group(1))):
        cnt = {"sel": {"owner": "you", "area": "controlled", "icons": class_tokens(m.group(1))}, "op": ">=", "n": 1} if m.group(1) else {"sel": dict({"owner": "you", "area": "controlled", "tag": m.group(2)}, **({"broken": True} if m.group(3) else {})), "op": ">=", "n": int(m.group(4))}
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "skill", "op": "grant", "value": x}, "cond": {"count": cnt}} for x in skills_list(m.group(5))]
    m = re.fullmatch(r"≪このキャラクター≫から、(武蔵|英国|三征西班牙|K\.P\.A\.Italia)を持つあなたの支配キャラクターのアタックコスト・ガードコストを代わりに支払うことが可能。?", text)   # EX0682 / EX808 (Revise#242)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "payFor", "op": "grant", "value": {"kinds": ["attack", "guard"], "sel": {"tag": m.group(1)}}}}]
    m = re.fullmatch(r"このキャラクターがバトルする際、≪このキャラクター≫の攻撃力に\+(\d+)・\+\((\d+)\)して判定する。?", text)   # EX804 (Revise#242)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "at", "op": "add", "value": int(m.group(1))}, "cond": {"self": "inBattle"}}, {"kind": "always", "text": text, "mod": {"to": "self", "key": "atm", "op": "add", "value": int(m.group(2))}, "cond": {"self": "inBattle"}}]
    if re.fullmatch(r"≪このキャラクターのアタック宣言に対してガード宣言するキャラクター≫は、?ガードコストが(\d+)上昇する。?", text):   # EX829 (Revise#242)
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "guardTaxVs", "op": "add", "value": int(re.search(r"(\d+)上昇", text).group(1))}}]
    if re.fullmatch(r"あなたの捨て札置き場の一番上のカード1枚をあなたのデッキの一番上に置くことで、≪このカードをセットされた“[^”]+”≫からアタックコストまたはガードコストを支払ったものとして扱うことができる。その後、このカードをオーナーの手札に戻す。?", text):   # A3-08 1255 / 1258 (Revise#253)
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "altPay", "op": "grant", "value": {"kind": "discTop"}}}]
    if re.fullmatch(r"≪このカードをセットされているキャラクターと同じネームを持つキャラクター≫は、?2体以上同時に場に存在できる。?", text):   # A3-09 1316 (Revise#253)
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "sameNameMulti", "op": "grant", "value": True}}]
    if re.fullmatch(r"≪このカードをセットされているキャラクターと同じネームを持つブレイクカードのコスト≫は、?(?:オーナーの)?手札に戻る。?", text):   # A3-09 1316
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "dest", "op": "dest", "value": {"cost": "set", "type": "Break", "nameOfSrcCh": True, "to": "hand"}}}]
    if re.fullmatch(r"メインフェイズ終了時に、あなたのダメージ置き場のカード枚数が1枚以下だった場合、≪このカードと、このキャラクターにセットされているカード全て≫をあなたのダメージ置き場に置く。?", text):   # A3-09 1349 (Revise#250)
        return [{"kind": "trigger", "when": {"event": "phaseEnd", "phase": "main", "mine": True}, "cond": {"xAtMost": {"x": {"damage": "you"}, "n": 1}}, "optional": False, "text": text, "effect": {"steps": [{"a": "selfAndSetToDamage"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"ターン終了時に、≪あなたの任意のあなたのダメージ置き場のカード1枚≫を捨て札する。?", text):   # A3-09 1349
        return [{"kind": "trigger", "when": {"event": "turnEnd"}, "optional": False, "text": text, "effect": {"steps": [{"a": "pickZone", "zones": ["damage"], "owner": "you", "n": 1, "dest": "discard"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"このキャラクターのオーナーを目標にした、ネームレベルキャラクターのアタック宣言に対して、このキャラクターがガード宣言しなかった場合、≪このキャラクターにセットされているパワーカード全て≫を、オーナーのダメージ置き場に置く。?", text):   # A3-03 0556 (Revise#249)
        return [{"kind": "trigger", "when": {"event": "unguardedNamed"}, "optional": False, "text": text, "effect": {"steps": [{"a": "selfPowerToDamage", "n": "all"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このキャラクターに「([^」]+)」がセットされている場合、≪このキャラクター≫の(攻撃力|耐久力|精神力)に\+(\d+)する。?", text)   # EP466 / EP482 / EP515 (Revise#229)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": {"攻撃力": "at", "耐久力": "de", "精神力": "se"}[m.group(2)], "op": "add", "value": int(m.group(3))}, "cond": {"selfHasJp": re.sub(r"\s+", "", m.group(1))}}]
    m = re.fullmatch(r"≪あなたの((?:“[^”]+”と?)+)≫のコストは(\d+)減少する。?", text)   # EP522 / EP525 / EP528 (Revise#229)
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "cardCost", "op": "add", "value": {"n": -int(m.group(2)), "sel": {"names": [re.sub(r"\s+", "", x) for x in re.findall(r"“([^”]+)”", m.group(1))]}, "minCost": 0}}}]
    if re.fullmatch(r"あなたのターン終了時に、このキャラクターのパワーが精神力未満だった場合、あなたのデッキの一番上のカード1枚を、≪このキャラクター≫にパワーカードとしてセットする。?", text):   # EP485 / EP518 (Revise#229)
        return [{"kind": "trigger", "when": {"event": "turnEnd", "mine": True}, "cond": {"selfPowerLtMental": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "deckTopPowerSelf"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪(プレイヤー全て|あなた|あなたの対戦相手全て|対戦相手全て)≫は(ドロー|キャパシティ)([+\-]\d+)を得る。?", text)   # EP590 (Revise#229)
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"players": {"プレイヤー全て": "all", "あなた": "you"}.get(m.group(1), "opponents")}, "key": "draw" if m.group(2) == "ドロー" else "handLimit", "op": "add", "value": int(m.group(3))}}]
    m = re.fullmatch(r"≪このキャラクター≫は、?分類・([^、。・]+)を得る。?", text)   # EP601 (Revise#229)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "icon", "op": "grant", "value": re.sub(r"\s+", "", m.group(1))}}]
    m = re.fullmatch(r"あなたのダメージ置き場にネームを持つブレイクカードが置かれている場合、≪このキャラクター≫の(攻撃力|耐久力|精神力)に\+(\d+)する。?", text)   # EP437 (Revise#228)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": {"攻撃力": "at", "耐久力": "de", "精神力": "se"}[m.group(1)], "op": "add", "value": int(m.group(2))}, "cond": {"xAtLeast": {"x": {"pileCount": {"zone": "damage", "owner": "you", "named": True, "type": "Break"}}, "n": 1}}}]
    if re.fullmatch(r"このキャラクターがバトルする際、バトル開始時に≪精神力X以下のバトル相手≫を捨て札する。Xはこのキャラクターのパワーに等しい。?", text):   # EP436 (Revise#228)
        return [{"kind": "trigger", "when": {"event": "battleStart", "self": True}, "cond": {"battleOppSeLePower": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "discard", "to": "battleOpp"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"あなたのターン終了時に、あなたのデッキの一番上のカード1枚をパワーカードとして≪このキャラクター≫にセットする。?", text):   # EP403 (Revise#228)
        return [{"kind": "trigger", "when": {"event": "turnEnd", "mine": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "deckTopPowerSelf"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"≪このキャラクター≫は、?X以上の数値の精神ダメージを受けない。Xはこのキャラクターの精神力に等しい。?", text):   # EP425 (Revise#228)
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "noDamage", "op": "grant", "value": {"mentalMinX": {"selfStat": "se"}}}}]
    m = re.fullmatch(r"≪このキャラクターと、?(.+?全て)≫(?:は|に)([±+\-ー−]\d+)/([±+\-ー−]\d+)/([±+\-ー−]\d+)(?:される|する)。?", text)   # EX0297 / EX0290 (Revise#222): this character and every …
    if m and parse_target(m.group(1)) and parse_target(m.group(1))[0] == "ref" and isinstance(parse_target(m.group(1))[1], dict) and "all" in parse_target(m.group(1))[1]:
        sel = dict(parse_target(m.group(1))[1]["all"], notSelf=True)
        return [{"kind": "always", "text": text, "mod": {"to": to, "key": k, "op": "add", "value": sign_n(m.group(g))}} for to in ("self", {"all": sel}) for k, g in (("se", 2), ("at", 3), ("de", 4)) if sign_n(m.group(g))]
    if re.fullmatch(r"バトルの際、≪このキャラクターと、このキャラクターのバトル相手のキャラクター≫の攻撃力に、?[-ー−]1・[-ー−]\(1\)して判定する。?", text):   # A3-14 1918 (Revise#217): Attack −1 (a mental Attack −(1)) for both
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "at", "op": "add", "value": -1}, "cond": {"self": "inBattle"}}, {"kind": "always", "text": text, "mod": {"to": "battleOpp", "key": "at", "op": "add", "value": -1}, "cond": {"self": "inBattle"}}]
    text = text.replace("キャラクタ-", "キャラクター").replace("プレイヤ-", "プレイヤー").replace("パワ-", "パワー")
    if not text: return []
    text = re.sub(r"^((?:あなたの)?ディスカードフェイズの最(?:初|後)に)(?!、)", r"\1、", norm_at(text))
    g = gained_effect(text)   # "<cond>、≪このキャラクター≫は<skills>を得、エフェクト「N:…」を得る" (Revise#084)
    if g is not None: return g
    if re.fullmatch(r"≪このキャラクター≫の攻撃力に\+\(X\)する。Xはこのキャラクターが持つ本来の精神攻撃力の数値に等しい。?", text):   # A3-14 1973 (Revise#179): the host's printed mental Attack again
        c["statModsX"] = {"atm": 1}; c["statX"] = {"selfBaseMental": True}; return []
    # ---- M3g (Revise#192) ----
    m = re.fullmatch(r"(?:このカードが)?[“\"]([^”\"]+)[”\"](?:または[“\"]([^”\"]+)[”\"])?以外にセットされている場合、(?:≪このカード≫は)?捨て札される。?(.*)", text)   # EP026 …: a Permanent only for its own character
    if m and (not m.group(3) or skills_list(m.group(3).strip("。"))):
        c["onlyOnNames"] = [{"玖珂なつき": "玖我なつき"}.get(re.sub(r"\s+", "", x), re.sub(r"\s+", "", x)) for x in (m.group(1), m.group(2)) if x]   # the card text writes 玖珂; the character card is 玖我 なつき
        for sk in skills_list(m.group(3).strip("。")) or []: c.setdefault("skills", {})[sk["id"]] = sk.get("x", True)   # a skill written after it on the same line
        return []
    rest = m and m.group(3) and re.sub(r"。\s+", "。", m.group(3).strip())
    r3 = rest and parse_ability(rest, c)
    if r3:   # EP070 (Revise#207): an ability written after it on the same line
        c["onlyOnNames"] = [{"玖珂なつき": "玖我なつき"}.get(re.sub(r"\s+", "", x), re.sub(r"\s+", "", x)) for x in (m.group(1), m.group(2)) if x]
        return r3
    m = re.fullmatch(r"≪このカードがセットされているキャラクターにセットする、?[“\"]([^”\"]+)[”\"]のブレイクカードのコスト≫は、?(?:オーナーの)?手札に戻る。?", text)   # EX0287 / EX0293 / EX0596 / EX0598
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "dest", "op": "dest", "value": {"cost": "set", "type": "Break", "name": re.sub(r"\s+", "", m.group(1)), "onTarget": "self", "to": "hand"}}}]
    m = re.fullmatch(r"このカードを[“\"]([^”\"]+)[”\"]にセット宣言する場合、≪このカードのコスト≫は、?(?:オーナーの)?手札に戻る。?", text)   # EX0450
    if m: c["costBack"] = {"to": "hand", "onName": re.sub(r"\s+", "", m.group(1))}; return []
    if re.fullmatch(r"このカードがネームを持たないキャラクターにセットされている場合、≪このカード≫(?:を捨て札する|は捨て札される)。?", text): c["onlyOnNamed"] = True; return []   # EXPV041
    m = re.fullmatch(r"このカードがあなたのダメージ置き場に置かれている場合、≪あなたの支配キャラクター全て≫は(.+?)を得る。?", text)   # EXPR024
    if m and skills_list(m.group(1)): return [{"kind": "always", "zone": "damage", "text": text, "mod": {"to": {"all": {"owner": "you", "area": "controlled"}}, "key": "skill", "op": "grant", "value": x}} for x in skills_list(m.group(1))]
    m = re.fullmatch(r"≪このカード≫はネーム[“\"]([^”\"]+)[”\"]を持つ。?", text)   # EX0442
    if m: c["name"] = re.sub(r"\s+", "", m.group(1)); return []
    # ---- M2b–M2g batch 3 (Revise#129) ----
    if re.fullmatch(r"≪このキャラクターが代わりに支払ったアタックコスト・ガードコスト≫は、?(?:その)?オーナーの手札に戻る。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "dest", "op": "dest", "value": {"cost": ["attack", "guard"], "fromSelf": True, "instead": True, "to": "hand"}}}]
    m = re.fullmatch(r"先攻以外のプレイヤーは、≪このカード≫の必要ファクターとコストを(\d+)ずつ減少させてセット宣言可能。?", text)
    if m: c["notFirstLess"] = int(m.group(1)); return []
    if re.fullmatch(r"あなたの対戦相手のテリトリーにキャラクターがいて、あなたの支配エリアにキャラクターがいない場合、≪あなた≫はこのカードの必要ファクターとコストを無視してセット宣言可能。?", text):
        c["freeIf"] = {"oppHasChars": True, "youNoControlled": True, "normal": True}; return []
    m = re.fullmatch(r"≪このキャラクター≫の攻撃力に\+Xする。Xはこのキャラクター以外の、場に出ている、このカードと同じネームを持つキャラクターの数に等しい。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "at", "op": "add", "value": {"x": {"sameNameChars": True}, "sign": 1}}}]
    if re.fullmatch(r"≪あなたの支配キャラクター全て≫は、?あなたの対戦相手が使用したプロジェクトカード・ファストカード・エフェクトの効果を受けない。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": {"all": {"owner": "you", "area": "controlled"}}, "key": "untargetable", "op": "grant", "value": {"from": ["Project", "Fast", "Effect"], "byOpp": True}}}]
    # ---- M2b–M2g batch 2 (Revise#128) ----
    if re.fullmatch(r"≪プレイヤー全て≫は、?プロジェクトカード・ファストカードの効果を受けない。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "playerImmune", "op": "grant", "value": {"types": ["Project", "Fast"]}}}]
    if re.fullmatch(r"≪このカードと同じネームを持つキャラクター≫は、?\d+体以上同時に場に存在可能。?", text): c["multiName"] = True; return []
    if re.fullmatch(r"≪ネームレベルでないキャラクターの持つエフェクト全て≫を無効化する。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": {"all": {"named": False}}, "key": "noEffect", "op": "grant", "value": True}}]
    if re.fullmatch(r"≪このカード≫は、?ダメージ置き場からセット宣言可能。?", text): c["playFromDamage"] = {"mill": 0}; return []
    if re.fullmatch(r"このカードが(?:あなたの)?ダメージ置き場にある場合、≪このカード≫を手札にあるカードと同様にセット宣言可能。?", text): c["playFromDamage"] = {"mill": 0}; return []   # A4-01 0110 … (Revise#260)
    m = re.fullmatch(r"≪あなた≫は、“([^”]+)”の必要ファクターを無視してセット宣言可能。?", text)   # A4-05 0877 … (Revise#260)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "you", "key": "factorIgnore", "op": "grant", "value": {"names": [re.sub(r"\s+", "", m.group(1))]}}}]
    if re.fullmatch(r"あなたがこのカードの必要ファクターを満たした状態で、あなたの対戦相手の支配キャラクターがあなたにアタックする場合、≪このカード≫をコストを支払ってあなたの支配キャラクターとしてセット可能。この効果でセットした場合、≪アタックするキャラクター全て≫のアタックは無効化され、このキャラクターとバトルする。そのバトルの際、≪このキャラクター≫はバトルによるダメージを受けない。?", text): c["guardFromHand"] = True; return []   # Q#41 (Revise#142)
    if re.fullmatch(r"このカードがあなたのダメージ置き場にある場合、あなたはこのカードを、ブレイクカードのタイミングで、手札にあるカードと同様にセット宣言可能。?", text): c["playFromDamage"] = {"mill": 0}; return []   # Revise#142
    m = re.fullmatch(r"≪あなた≫は、?あなたのデッキの上からカードを(\d+)枚捨て札することで、このカードのコストを無視してセット宣言可能。?", text)
    if m: c["altMill"] = int(m.group(1)); return []
    if re.fullmatch(r"このカードがあなたのダメージ置き場にある場合、あなたはこのカードを、ブレイクカードのタイミングで、手札にあるカードと同様にセット宣言可能。この効果でセット宣言した場合、≪このカードのコスト≫は、オーナーの手札に戻る。?", text):
        c["playFromDamage"] = {"mill": 0, "costTo": "hand"}; return []
    m = re.fullmatch(r"(このカード以外の、)?このカードと同じネームを持つ、このキャラクターを構成するブレイクカード(\d+)枚につき、(≪.+)", text)
    if m:
        inner = parse_ability(m.group(3), c)
        if inner and all(a.get("kind") == "always" and isinstance(a.get("mod", {}).get("value"), int) for a in inner):
            for a in inner: a["mod"]["value"] = {"x": dict({"selfNamed": True, "div": int(m.group(2))}, **({"minus": 1} if m.group(1) else {})), "sign": a["mod"]["value"]}; a["text"] = text
            return inner
    m = re.fullmatch(r"(?:(.+?場合)、)?このキャラクターを構成する“([^”]+)”(\d+)枚につき、(≪.+)", text)   # A4-01 0177 … (Revise#260): any card with that name
    if m and (not m.group(1) or cond_of(m.group(1)) is not None):
        pc = cond_of(m.group(1)) if m.group(1) else None
        m = re.fullmatch(r"(.*?)“([^”]+)”(\d+)枚につき、(≪.+)", text)
        inner = parse_ability(m.group(4), c)
        xx = {"selfNamed": re.sub(r"\s+", "", m.group(2)), "per": int(m.group(3))}
        if inner and all(a.get("kind") == "always" and not a.get("cond") and (isinstance(a.get("mod", {}).get("value"), int) or (a["mod"].get("key") == "skill" and isinstance(a["mod"]["value"].get("x"), int) and a["mod"]["value"]["x"] is not True)) for a in inner):
            for a in inner:
                if a["mod"]["key"] == "skill": a["mod"]["value"] = dict(a["mod"]["value"], x={"x": xx, "sign": a["mod"]["value"]["x"]})
                else: a["mod"]["value"] = {"x": xx, "sign": a["mod"]["value"]}
                a["text"] = text
                if pc: a["cond"] = pc
            return inner
    m = re.fullmatch(r"このキャラクターにセットされているパーマネントカード1枚につき、(≪.+)", text)   # A4-01 0176 … (Revise#261)
    if m:
        inner = parse_ability(m.group(1), c)
        if inner and all(a.get("kind") == "always" and not a.get("cond") and isinstance(a.get("mod", {}).get("value"), int) for a in inner):
            for a in inner: a["mod"]["value"] = {"x": {"permCount": True}, "sign": a["mod"]["value"]}; a["text"] = text
            return inner
    if re.fullmatch(r"≪あなた≫は、あなたのダメージ置き場のブレイクカードを、手札にあるカードと同様にセット宣言可能。?", text): return [{"kind": "always", "text": text, "mod": {"to": "you", "key": "breakFromDamage", "op": "grant", "value": {"types": ["Break"]}}}]   # A4-01 0111 … (Revise#261)
    m = re.fullmatch(r"このカードがセットされたターンの終了時まで、(≪.+)", text)
    if m:
        eff = parse_body("ターン終了時まで、" + m.group(1))
        if eff["status"] == "auto" and not eff.get("target"): return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": eff, "status": "auto"}]
    m = re.fullmatch(r"このキャラクターがアタック宣言またはガード宣言している場合、(≪.+)", text)
    if m:
        inner = parse_ability(m.group(1), c)
        if inner and all(a.get("kind") == "always" and not a.get("cond") for a in inner):
            for a in inner: a["cond"] = {"self": "declaring"}; a["text"] = text
            return inner
    m = re.fullmatch(r"このカードが(?:あなたの)?ダメージ置き場にある場合、(≪.+)", text)
    if m and c.get("type") != "Fast" and c.get("type") != "Project":
        inner = parse_ability(m.group(1), c)
        if inner and all(a.get("kind") == "always" for a in inner):
            for a in inner: a["zone"] = "damage"; a["text"] = text
            return inner
    # ---- M2d batch 4 (Revise#141) ----
    if re.fullmatch(r"このカードが場にセットされた場合、≪あなたの任意のプレイヤ[ー\-]1人≫の手札全てを公開し、その中のプロジェクトカード・ファストカード全てを捨て札する。?", text):
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "revealDiscardTypes", "types": ["Project", "Fast"]}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪あなたの対戦相手全て≫は、Xコスト以下のプロジェクトカード・ファストカードを使用宣言することができない。(Xは[^。]+に等しい)。?", text)
    if m and x_def(m.group(1)): return [{"kind": "always", "text": text, "mod": {"to": {"players": "opponents"}, "key": "ban", "op": "ban", "value": {"decl": "set", "types": ["Project", "Fast"], "costMax": x_def(m.group(1))}}}]
    if re.fullmatch(r"各ターンの開始時に、あなたはプロジェクトカードまたはファストカードの名称1つを指定する。そのターン中、≪プレイヤー全て≫は、指定したカードと同じ名称のカードを使用宣言することができない。?", text):
        return [{"kind": "trigger", "when": {"event": "turnStart"}, "optional": False, "text": text, "effect": {"steps": [{"a": "banNamePick", "types": ["Project", "Fast"]}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"ターン終了時にこのキャラクターのパワーが精神力未満だった場合、≪このキャラクターを構成するカード全てと、このキャラクターにセットされているカード全て≫をオーナーのデッキに戻し、そのデッキをシャッフルする。?", text):
        return [{"kind": "trigger", "when": {"event": "turnEnd"}, "optional": False, "text": text, "effect": {"steps": [{"a": "selfToDeck", "ifPowerLtMental": True}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"あなた(?:の)?ターン開始時に、≪あなたのデッキの一番上のカード1枚≫を、勢力(イレイザー|E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国)、([^の、]+)の、(\d+)/(\d+)/(\d+)のあなた(?:の)?支配キャラクター、([^と]+)としてセットする。?", text)
    if m and class_tokens(m.group(2)):
        return [{"kind": "trigger", "when": {"event": "turnStart", "mine": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "deckTopToken", "name": m.group(6), "faction": FACTION_JP[m.group(1)], "icons": class_tokens(m.group(2)), "stats": {"se": int(m.group(3)), "at": int(m.group(4)), "de": int(m.group(5))}}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"≪あなた≫は、あなたのダメージ置き場のブレイクカードを、手札にあるカードと同様に使用宣言可能。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "breakFromDamage", "op": "grant", "value": True}}]
    m = re.fullmatch(r"このキャラクターがプレイヤーに対してアタック宣言した場合、≪あなたの任意のアタック目標のプレイヤーの支配キャラクタ[ー\-]1人≫の(精神力|攻撃力|耐久力)に[ー\-]Xする。(Xは[^。]+に等しい)。?", text)
    if m and x_def(m.group(2)): return [{"kind": "trigger", "when": {"event": "attack", "self": True, "toPlayer": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "pickCharDamage", "sel": {"ownerAttacked": True, "area": "controlled"}, "n": "X", "stat": {"精神力": "se", "攻撃力": "at", "耐久力": "de"}[m.group(1)], "sign": -1, "until": "turn"}], "x": x_def(m.group(2)), "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"≪あなた≫は、カードを引かなければならない状況で残りデッキ枚数が足りない場合でも敗北しない。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "noDeckOut", "op": "grant", "value": True}}]
    if re.fullmatch(r"あなたの残りデッキ枚数が0枚の場合、≪このキャラクター≫はインフィニティを得る。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "skill", "op": "grant", "value": {"id": "infinity", "x": True}}, "cond": {"deckEmpty": True}}]
    if re.fullmatch(r"あなたの残りデッキ枚数が0枚の場合、あなたのメインフェイズ開始時に、≪あなたの捨て札置き場のカード1枚≫を選んであなたの手札に加えることが可能。?", text):
        return [{"kind": "trigger", "when": {"event": "phaseStart", "phase": "main", "mine": True}, "cond": {"deckEmpty": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "pickZone", "to": "you", "dest": "hand", "zone": "discard", "owner": "you", "sel": {}, "n": 1, "upTo": False}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカードがセットされた場合、≪あなた≫は、((?:[^・]+)(?:・[^・]+)*)のいずれかを持つブレイクカード1枚を、必要ファクターとコストを無視してセット宣言可能。?", text)
    if m and class_tokens(m.group(1)):
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "freeBreakSet", "icons": class_tokens(m.group(1)), "anyCost": True, "optional": True}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪(攻撃力|精神力|耐久力)の数値がX(未満|以下|以上|を超える)のキャラクター≫は、あなたに対してアタック宣言できない。(Xは[^。]+に等しい)。?", text)   # A3-20 2727 (Revise#209)
    if m and x_def(m.group(3)): return [{"kind": "always", "text": text, "mod": {"to": {"all": {"stat": [{"key": STAT_JP[m.group(1)], "op": {"未満": "<", "以下": "<=", "以上": ">=", "を超える": ">"}[m.group(2)], "n": {"x": x_def(m.group(3))}}]}}, "key": "noAttackOnSrc", "op": "grant", "value": True}}]
    m = re.fullmatch(r"≪このキャラクター≫は、攻撃力の数値がX以下のキャラクターとのバトルによるダメージを受けない。(Xは[^。]+に等しい)。?", text)
    if m and x_def(m.group(1)): return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "noDamage", "op": "grant", "value": {"battle": True, "fromSel": {"stat": [{"key": "at", "op": "<=", "n": {"x": x_def(m.group(1))}}]}}}}]
    if re.fullmatch(r"≪あなた≫は、カード名称に「式神」を含む阿羅耶識のカードを、あなたの手札またはダメージ置き場から、ファストカードのタイミングで使用宣言可能。?", text):
        q = {"jpHas": "式神", "faction": "Arayashiki"}
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "breakFromDamage", "op": "grant", "value": q}}, {"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "fastCards", "op": "grant", "value": q}}]
    m = re.fullmatch(r"≪あなた≫は、ネームに「([^」]+)」を含む(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のカードをファストカードのタイミングで使用宣言可能。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "fastCards", "op": "grant", "value": {"nameHas": m.group(1), "faction": FACTION_JP[m.group(2)]}}}]
    m = re.fullmatch(r"ネームに関わらず、≪このキャラクター≫を[“\"]([^”\"]+)[”\"]でブレイク可能。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "breakByName", "op": "grant", "value": {"name": re.sub(r"\s+", "", m.group(1)), "nameOnly": True}}}]
    m = re.fullmatch(r"≪あなた≫は、あなたのダメージ置き場にある(.+?)を持つブレイクカードを、手札にあるカードと同様にセット宣言可能。?", text)
    if m and class_tokens(m.group(1)): return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "breakFromDamage", "op": "grant", "value": {"types": ["Break"], "icons": class_tokens(m.group(1))}}}]
    m = re.fullmatch(r"≪支払ったコストの中にある、(.+?)を持つキャラクターカード≫を、そのオーナーの勢力エリアのそのカードの勢力のアクティブキャラクターとしてセットする。?", text)
    if m and class_tokens(m.group(1)): return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "costToActive", "op": "grant", "value": {"types": ["Character"], "icons": class_tokens(m.group(1))}}}]
    if re.fullmatch(r"≪あなた≫がドローした場合、その中の任意の枚数を自分のデッキに戻してシャッフルし、同じ枚数を手札に加えることが可能。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "redraw", "op": "grant", "value": True}}]
    if re.fullmatch(r"≪このキャラクター≫はステルスを持つキャラクターをガード可能。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "guardStealth", "op": "grant", "value": True}}]
    if re.fullmatch(r"≪あなた≫は捨て札置き場とパワーカードの内容を確認可能。?", text):   # the Discard Pile is open anyway
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "powerVisible", "op": "grant", "value": True}}]
    m = re.fullmatch(r"このカードがセットされた場合、≪あなたのデッキの上から(\d+)枚≫を公開し、その中にあるプロジェクトカードまたはファストカード全てをあなたの手札に加える。それ以外のカードはデッキに戻し、そのデッキをシャッフルする。?", text)
    if m: return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "revealTopTake", "n": int(m.group(1)), "types": ["Project", "Fast"]}], "status": "auto"}, "status": "auto"}]
    # ---- M2d batch 5 (Revise#142) ----
    if re.fullmatch(r"このキャラクターからコストが支払われた場合、≪このキャラクターにセットされているパワーカード全て≫を捨て札する。?", text):
        return [{"kind": "trigger", "when": {"event": "costPaid", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "cardsOf", "to": "self", "part": "power", "all": True, "dest": "discard"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"≪このキャラクター≫はプロジェクトカード・ファストカード・このキャラクター以外のエフェクトの効果を受けない。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "untargetable", "op": "grant", "value": {"from": ["Project", "Fast", "Effect"], "notSelfEffect": True}}}]
    if re.fullmatch(r"≪あなたの支配キャラクター全て≫は、このキャラクターのパワー以下のコストの、あなたの対戦相手が使用したプロジェクトカード・ファストカード・エフェクトの効果を受けない。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": {"all": {"owner": "you", "area": "controlled"}}, "key": "untargetable", "op": "grant", "value": {"from": ["Project", "Fast", "Effect"], "byOpp": True, "costMaxSrcPower": True}}}]
    m = re.fullmatch(r"あなたの対戦相手の支配キャラクターとのバトル、またはあなたの対戦相手の使用したカードの効果によって、あなたの支配エリアの(.+?)が捨て札になった場合、≪あなたの任意のキャラクターまたはプレイヤ.?1人≫に\((\d+)\)ダメージを与える。?", text)
    if m and class_tokens(m.group(1)): return [{"kind": "trigger", "when": {"event": "leave", "own": True, "controlled": True, "icons": class_tokens(m.group(1)), "oppCause": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "pickAnyDamage", "n": int(m.group(2)), "mental": True}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカードがブレイクして場にセットされた場合、≪あなたの任意の(.+?)のキャラクタ.?1人≫を捨て札する。?", text)
    if m and class_tokens(m.group(1).replace("または", "・")): return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "discardOwnPick", "anyArea": True, "sel": {"icons": class_tokens(m.group(1).replace("または", "・"))}}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカードが捨て札される場合、≪あなたの手札またはダメージ置き場の、ブレイク条件のない(.+?)を持つブレイクカード1枚≫を、あなたの支配キャラクターとしてセット可能。?", text)
    if m and class_tokens(m.group(1).replace("または", "・")): return [{"kind": "trigger", "when": {"event": "leave", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "pickZone", "to": "you", "dest": "back", "zones": ["hand", "damage"], "owner": "you", "sel": {"types": ["Break"], "icons": class_tokens(m.group(1).replace("または", "・")), "noBreakRule": True}, "n": 1, "upTo": True}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカードがブレイクして場にセットされるか、このカードと同じ名称のカードの効果で場にセットされた場合、≪あなたのデッキ≫の上から(\d+)枚を公開し、その中にあるネームを持たない(.+?)を持つブレイクカードまたはキャラクターカード全てを、あなたの支配キャラクターとしてセットし、それ以外のカードはデッキに戻し、そのデッキをシャッフルする。?", text)
    if m and class_tokens(m.group(2)): return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "revealTopTake", "n": int(m.group(1)), "types": ["Break", "Character"], "icons": class_tokens(m.group(2)), "unnamed": True, "dest": "back"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカードがセットされた場合、≪(あなたの任意のあなたの手札の|あなたの捨て札置き場またはダメージ置き場にある、あなたの任意の)パーマネントカード1枚≫を、コストを支払ってこのキャラクターにセット宣言可能。(そのカードは必要ファクターを無視してセットされる。?)?", text)   # Q#38 (Revise#142)
    if m: return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "effDecl", "zones": ["hand"] if "手札" in m.group(1) else ["discard", "damage"], "types": ["Permanent"], "ignoreFactor": bool(m.group(2))}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"≪あなたの対戦相手が使用した、このキャラクターを対象に含むプロジェクトカードまたはファストカード≫を捨て札する。その後、あなたのデッキの一番上からX枚を引き、パワーカードとして≪このキャラクター≫にセットする。Xはそのカードのコストに等しい。?", text):   # Q#42
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "absorbOpp", "op": "grant", "value": True}}]
    if re.fullmatch(r"このキャラクターを対象に含む、効果を発揮している持続のプロジェクトカード・ファストカード1枚につき、≪このキャラクター≫に\+1/\+1/\+1する。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": k, "op": "add", "value": {"x": {"lastingOn": True}, "sign": 1}}} for k in ("se", "at", "de")]
    if re.fullmatch(r"このキャラクターを対象に含む、瞬間のプロジェクトカードまたはファストカードが効果を発揮した場合、あなたのデッキの一番上のカード1枚を引き、パワーカードとして≪このキャラクター≫にセットする。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "instantFeed", "op": "grant", "value": True}}]
    if re.fullmatch(r"このキャラクターに与えられたバトル以外のダメージは、≪そのダメージを与えたカードもしくはキャラクターのオーナー≫が代わりに受ける。その後、そのプレイヤーにXダメージを与える。?", text):   # Q#39 (X = its normal Attack)
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "dmgBackToSource", "op": "grant", "value": True}}]
    if re.fullmatch(r"このキャラクターに、ネームに「ブレイブ」を含むE\.G\.O\.のパーマネントがセットされている場合、≪このキャラクターと、このキャラクターにセットされているカード全て≫は、あなたの対戦相手の使用したプロジェクトカード・ファストカード・エフェクトの効果を受けない。?", text):   # Q#40
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "untargetable", "op": "grant", "value": {"from": ["Project", "Fast", "Effect"], "byOpp": True}}, "cond": {"selfPermSel": {"nameHas": "ブレイブ", "faction": "E.G.O."}}}]
    if re.fullmatch(r"このキャラクターがバトルする際、アタック宣言・ガード宣言していない、あなたの任意の数のこのキャラクター以外のマシンのあなたの支配キャラクターを指定してもよい。そうした場合、あなたのデッキの上から指定したキャラクターの数と等しい枚数捨て札し、指定したキャラクターの能力値を≪このキャラクター≫に合計して判定し、このキャラクターは指定したキャラクターの持つスキル全てを得る。バトルの際のダメージは、≪指定したキャラクター≫にも同時に与えられる。?", text):   # Q#40
        return [{"kind": "trigger", "when": {"event": "battleStart", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "mergeMachines", "sel": {"icons": ["マシン"]}}], "status": "auto"}, "status": "auto"}]
    # ---- M2d batch 6 (Revise#143): "このカードの下に「X」がある場合、≪このキャラクター≫はインフィニティを得、…" ----
    m = re.fullmatch(r"このカードの下に「([^」]+)」がある場合、≪このキャラクター≫はインフィニティを得、(.+?)。?", text)
    if m:
        cond = {"belowName": re.sub(r"\s+", "", m.group(1))}
        inf_ab = {"kind": "always", "text": text, "mod": {"to": "self", "key": "skill", "op": "grant", "value": {"id": "infinity", "x": True}}, "cond": cond}
        rest = m.group(2).rstrip("。")
        out = None
        if rest == "エフェクトの目標にならず、≪あなたの阿羅耶識の支配キャラクター全て≫は精神ダメージ・バトル以外のダメージを受けない":
            sel = {"owner": "you", "area": "controlled", "faction": "Arayashiki"}
            out = [{"kind": "always", "text": text, "mod": {"to": "self", "key": "untargetable", "op": "grant", "value": {"from": ["Effect"]}}, "cond": cond},
                   {"kind": "always", "text": text, "mod": {"to": {"all": sel}, "key": "noDamage", "op": "grant", "value": {"mental": True}}, "cond": cond},
                   {"kind": "always", "text": text, "mod": {"to": {"all": sel}, "key": "noDamage", "op": "grant", "value": {"outside": True}}, "cond": cond}]
        mm = re.fullmatch(r"≪あなたの支配キャラクター全て≫は(.+?)を得、≪あなたの支配キャラクターの(.+?)全て≫に\+(\d+)/\+(\d+)/\+(\d+)する", rest)
        if mm and class_tokens(mm.group(1)) and class_tokens(mm.group(2)):
            sel = {"owner": "you", "area": "controlled"}
            out = [{"kind": "always", "text": text, "mod": {"to": {"all": sel}, "key": "icon", "op": "grant", "value": ic}, "cond": cond} for ic in class_tokens(mm.group(1))] + \
                  [{"kind": "always", "text": text, "mod": {"to": {"all": dict(sel, icons=class_tokens(mm.group(2)))}, "key": k, "op": "add", "value": int(mm.group(i))}, "cond": cond} for k, i in (("se", 3), ("at", 4), ("de", 5))]
        if rest in ("このキャラクターのバインドの支払いをあなたの手札から行うことが可能", "このキャラクターのバインドXの支払いをあなたの手札から行うことが可能"):
            out = [{"kind": "always", "text": text, "mod": {"to": "self", "key": "bindHand", "op": "grant", "value": True}, "cond": cond}]
        if out is not None: return [inf_ab] + out
    m = re.fullmatch(r"≪分類・(.+?)を持つキャラクターのアタック宣言に対してガード宣言するか、分類・\1を持つキャラクターにガード宣言されたキャラクター≫にXダメージを与える。(Xは[^。]+に等しい)。?", text)
    if m and class_tokens(m.group(1)) and x_def(m.group(2)): return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "guardHitSel", "op": "grant", "value": {"icons": class_tokens(m.group(1)), "x": x_def(m.group(2))}}}]
    if re.fullmatch(r"あなたの支配キャラクターがバトルによるダメージを与える場合、≪バトル相手のオーナー≫に\(X\)ダメージを与える。Xはそのキャラクターの持つ精神攻撃力の数値から、バトル相手にセットされているパワーカードの枚数を引いた値に等しい。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "battleMentalHit", "op": "grant", "value": True}}]
    m = re.fullmatch(r"≪X以下の数値の精神攻撃力を持つキャラクター全て≫は、ファクター全てを失う。(Xは[^。]+に等しい)。?", text)
    if m and x_def(m.group(1)): return [{"kind": "always", "text": text, "mod": {"to": {"all": {"atMental": True, "stat": [{"key": "at", "op": "<=", "n": {"x": x_def(m.group(1))}}]}}, "key": "noFactor", "op": "grant", "value": True}}]
    if re.fullmatch(r"このカードがセットされた場合、≪あなたの手札のブレイクカード1枚≫を、必要ファクターとブレイク条件を無視して、コストを支払ってセット宣言可能。?", text):
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "effDecl", "zones": ["hand"], "types": ["Break"], "ignoreFactor": True, "ignoreRule": True}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"メインフェイズ終了時に、≪このカード≫をあなたのデッキに戻し、そのデッキをシャッフルする。?", text):
        return [{"kind": "trigger", "when": {"event": "phaseEnd", "phase": "main"}, "optional": False, "text": text, "effect": {"steps": [{"a": "selfCardToDeck"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"≪このカードと同じネームを持つキャラクター≫が捨て札になる場合、そのキャラクターのオーナーは、そのキャラクターと同じネームを持つ、別の自分の支配キャラクターを代わりに捨て札することで、そのキャラクターを場に残すことが可能。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "sameNameKeep", "op": "grant", "value": {"name": c.get("name")}}}]
    m = re.fullmatch(r"あなたがこのカードの必要ファクターを満たした状態で、[“\"]([^”\"]+)[”\"]が場に存在する場合、≪このカード≫をコストを支払ってあなたの支配キャラクターとしてセット可能。?", text)
    if m: c["asCharIfName"] = re.sub(r"\s+", "", m.group(1)); return []
    m = re.fullmatch(r"≪このキャラクターから支払われたコスト≫を、あなたの任意の勢力の、分類・(.+?)を持ち、アビリティ「このキャラクターは、[“\"]([^”\"]+)[”\"]以外のエフェクトの効果を受けない。」を持つ、(\d+)/(\d+)/(\d+)のあなたの支配キャラクター、(.+?)としてセットする。?", text)
    if m and class_tokens(m.group(1)): return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "costToToken", "op": "grant", "value": {"name": m.group(6), "icons": class_tokens(m.group(1)), "stats": {"se": int(m.group(3)), "at": int(m.group(4)), "de": int(m.group(5))}, "immuneExcept": re.sub(r"\s+", "", m.group(2))}}}]
    # ---- M2d batch 3 (Revise#140) ----
    m = re.fullmatch(r"このキャラクターにパーマネントカードがセットされている場合、≪このキャラクター≫に±0/\+X/\+Xする。Xはこのキャラクターにセットされているパーマネントカードの必要ファクターの合計に等しい。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": k, "op": "add", "value": {"x": {"permFactor": True}, "sign": 1}}, "cond": {"selfHasPerm": True}} for k in ("at", "de")]
    m = re.fullmatch(r"≪(.+?)全て≫に与えられるダメージに[ー\-]\(X\)して判定する。(Xは[^。]+に等しい)。?", text)
    if m and class_tokens(m.group(1)) and x_def(m.group(2)):
        return [{"kind": "always", "text": text, "mod": {"to": {"all": {"icons": class_tokens(m.group(1))}}, "key": "dmgReduce", "op": "add", "value": {"x": x_def(m.group(2)), "which": "mental"}}}]
    m = re.fullmatch(r"このキャラクターがプレイヤーに対してアタック宣言した場合、≪あなたの任意のアタック目標のプレイヤーの支配キャラクター1人≫に\(X\)ダメージを与えることが可能。(Xは[^。]+に等しい)。?", text)
    if m and x_def(m.group(1)): return [{"kind": "trigger", "when": {"event": "attack", "self": True, "toPlayer": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "pickCharDamage", "sel": {"ownerAttacked": True, "area": "controlled"}, "n": "X", "mental": True}], "x": x_def(m.group(1)), "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "≪このキャラクターのバトル相手にセットされているパーマネントカード全て≫を捨て札する":
        return [{"kind": "trigger", "when": {"event": "battleStart", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "cardsOf", "to": "battleOpp", "part": "perm", "all": True, "dest": "discard"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"このキャラクターがプレイヤーにアタックした場合、あなたの手札全てを捨て札することが可能。そうした場合、≪このキャラクター≫の攻撃力に\+Xして判定する。Xはこの効果で捨て札した手札枚数に等しい。?", text):
        return [{"kind": "trigger", "when": {"event": "attack", "self": True, "toPlayer": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "handAll", "to": "you", "dest": "discard"}, {"a": "mod", "to": "self", "mod": {"key": "at", "op": "add", "value": {"xlast": True, "sign": 1}}, "until": "battle"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"このキャラクターがプレイヤーにアタックした場合、ダメージ判定後に≪このカード≫はオーナーの手札に戻る。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "playerHit", "op": "grant", "value": {"effect": {"steps": [{"a": "bounce", "to": "card"}], "status": "auto"}, "replace": False}}}]
    m = re.fullmatch(r"≪あなた≫は、あなたが各ターンのメインフェイズ中に、最初に使用する(プロジェクト|ブレイク)カードの(コストに-X|必要ファクターを無視)して(?:使用|セット)宣言可能。?(?:(Xは[^。]+に等しい)。?)?", text)
    if m and m.group(1) == "ブレイク" and "ファクター" in m.group(2): return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "factorIgnore", "op": "grant", "value": {"type": "Break", "firstInMain": True}}}]
    if m and m.group(1) == "プロジェクト" and m.group(3) and x_def(m.group(3)): return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "cardCost", "op": "add", "value": {"n": {"x": x_def(m.group(3)), "sign": -1}, "sel": {"types": ["Project"]}, "firstInMain": True}}}]
    m = re.fullmatch(r"≪あなたが?の?支払った(ブレイク|パーマネント)カードのコスト≫は、オーナーの手札に戻る。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "dest", "op": "dest", "value": {"cost": "set", "type": "Break" if m.group(1) == "ブレイク" else "Permanent", "to": "hand"}}}]
    if re.fullmatch(r"≪このキャラクターから支払われたコストの中にあるブレイクカード≫は、オーナーの手札に戻る。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "dest", "op": "dest", "value": {"fromSelf": True, "paidTypes": ["Break"], "to": "hand"}}}]
    if re.fullmatch(r"このキャラクターのパワーが精神力に等しい場合、≪あなた≫は、ファストカードのタイミングで、このキャラクターと同じネームを持つブレイクカードをこのキャラクターにセット宣言可能。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "breakFast", "op": "grant", "value": {"sameName": True}}, "cond": {"selfPowerEqMental": True}}]
    if re.fullmatch(r"≪あなたの支配キャラクター全て≫に分類・ミスティック・ミスティック♂・スチューデント・スチューデント♂、シールドを与え、耐久力に\+1する。?", text):
        sel = {"owner": "you", "area": "controlled"}
        return [{"kind": "always", "text": text, "mod": {"to": {"all": sel}, "key": "icon", "op": "grant", "value": ic}} for ic in ["ミスティック", "ミスティック♂", "スチューデント", "スチューデント♂"]] + \
               [{"kind": "always", "text": text, "mod": {"to": {"all": sel}, "key": "skill", "op": "grant", "value": {"id": "shield", "x": True}}}, {"kind": "always", "text": text, "mod": {"to": {"all": sel}, "key": "de", "op": "add", "value": 1}}]
    if text.rstrip("。") == "このカードがセットされた場合、≪精神力0のキャラクター全てと、パーマネントカード全て≫を、そのオーナーの手札に戻す":
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "cardsOf", "to": {"all": {}}, "part": "perm", "all": True, "dest": "hand"}, {"a": "bounce", "to": {"all": {"stat": [{"key": "se", "op": "<=", "n": 0}]}}}], "status": "auto"}, "status": "auto"}]
    SK = {"インフィニティ": "infinity", "シールド": "shield", "オフェンシブ": "offensive", "ディフェンシブ": "defensive", "インターセプト": "intercept", "ペネトレイト": "penetrate", "ブレイクスルー": "breakthrough", "シンクロ": "synchro", "イニシアチブ": "initiative", "ステルス": "stealth"}
    def grant_all(sel, skills_txt, stats, cond, txt):
        out = []
        for sk in (skills_txt or "").split("・"):
            if not sk: continue
            sm = re.fullmatch(r"(ブースト|チャージ)(\d+)", sk)
            if sm: out.append({"kind": "always", "text": txt, "mod": {"to": {"all": sel}, "key": "skill", "op": "grant", "value": {"id": "boost" if sm.group(1) == "ブースト" else "charge", "x": int(sm.group(2))}}}); continue
            if sk not in SK: return None
            out.append({"kind": "always", "text": txt, "mod": {"to": {"all": sel}, "key": "skill", "op": "grant", "value": {"id": SK[sk], "x": True}}})
        for key, v in zip(("se", "at", "de"), stats or ()):
            if v: out.append({"kind": "always", "text": txt, "mod": {"to": {"all": sel}, "key": key, "op": "add", "value": v}})
        if cond:
            for a in out: a["cond"] = cond
        return out or None
    m = re.fullmatch(r"このキャラクターがアタック宣言する場合、≪あなたの支配エリアのこのキャラクター以外の分類・(.+?)X体まで≫は、同じ目標に対して、コストを支払わずに、同時にアタック宣言可能。Xはこのキャラクターから支払われたブーストのコストに等しい。?", text)   # A4-01 0015 / 0030 (Revise#361)
    if m and (class_tokens(m.group(1)) or class_tokens(re.sub(r"[-−]$", "ー", m.group(1)))):
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "raid", "op": "grant", "value": {"max": {"selfBoostPaid": True}, "free": True, "sel": {"icons": class_tokens(m.group(1)) or class_tokens(re.sub(r"[-−]$", "ー", m.group(1)))}}}}]
    # ---- Q#43 (Revise#145): several attacks at once ----
    m = re.fullmatch(r"このキャラクターがアタック宣言する場合、≪あなたの任意のあなたの支配キャラクター(X|\d+)体まで≫は、同じ目標に対して、コストを支払わずに、同時にアタック宣言可能。アタック宣言されたプレイヤーは、それぞれのアタック宣言に対してガード宣言可能。(?:(Xは[^。]+に等しい)。?)?", text)
    if m and (m.group(1) != "X" or x_def(m.group(2) or "")):
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "raid", "op": "grant", "value": {"max": x_def(m.group(2)) if m.group(1) == "X" else {"n": int(m.group(1))}, "free": True}}}]
    if re.fullmatch(r"このキャラクターがアタック宣言またはガード宣言する場合、≪あなたの任意の数のあなたの支配キャラクター≫は、同じ目標に対して、同時にアタック宣言またはガード宣言可能。アタック宣言されたプレイヤーは、それぞれのアタック宣言に対してガード宣言可能。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "raid", "op": "grant", "value": {"max": None, "free": False, "guards": True}}}]
    if text.rstrip("。") == "≪あなたの支配キャラクター全て≫は、任意の数で同時にシンクロによる追加のアタック宣言・ガード宣言可能":   # any number of Synchro joins: the table has no limit anyway
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "synchroAny", "op": "grant", "value": True}}]
    if text.rstrip("。") == "≪このキャラクターのアタック目標となったプレイヤーの、精神力0の支配キャラクター全て≫は、このキャラクターのアタック宣言に対してガード宣言する。その際、そのプレイヤーはそれら以外のキャラクターでもガード宣言可能":
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "forceZeroGuard", "op": "grant", "value": True}}]
    if text.rstrip("。") == "≪このキャラクターを対象に含む、あなたが使用するプロジェクトカード・ファストカード・エフェクト≫のコストに+Xする。Xはこのキャラクターの精神力に等しい":   # Q#44
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "targetTax", "op": "grant", "value": True}}]
    if text.rstrip("。") == "このキャラクターがバトルする場合、≪バトル相手のキャラクター≫に3回同時にダメージを与える":   # Q#45
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "tripleHit", "op": "grant", "value": True}}]
    if re.fullmatch(r"このカードがセットされた場合、≪あなたの任意のブレイクカード1枚≫を捨て札(?:可能|する)。その後、あなたのデッキの上からカードX枚を引いて、このキャラクターにパワーカードとしてセットする。Xはこの効果で捨て札したブレイクカードのコストに等しい。?", text):   # Q#53: from your hand
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "discardTypeX", "types": ["Break"], "xCost": True}, {"a": "deckToPowerLast"}], "status": "auto"}, "status": "auto"}]
    # ---- Q#46 – Q#54 (Revise#146) ----
    if text.rstrip("。") == "≪あなた≫は、このキャラクターからのみコストを支払って、プロジェクトカードをファストカードのタイミングで使用宣言可能":
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "projFast", "op": "grant", "value": True}}]
    if text.rstrip("。") == "≪あなた≫は、あなたのダメージ置き場のプロジェクトカードを、このキャラクターからのみコストを支払って、手札にあるカードと同様に使用宣言可能":
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "breakFromDamage", "op": "grant", "value": {"types": ["Project"], "payOnlySrc": True}}}]
    if text.rstrip("。") == "≪このキャラクターから支払われたコストの中にあるパーマネントカード≫を、必要ファクターを無視して、コストを支払ってあなたの支配キャラクターにセット可能。≪その際に支払ったコスト≫は、オーナーの手札に戻る":
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "permFromCost", "op": "grant", "value": True}}]
    T47 = {"≪手札枚数が手札上限を越えたプレイヤー≫は、手札上限に等しくなるまで、手札から任意のカードを捨て札する": "handCapNow", "≪自分の使用した効果で手札にカードを加えたプレイヤー≫に、増えた手札枚数に等しいダメージを与える": "handGainHit", "≪手札を捨て札したプレイヤー≫に、捨て札したカード枚数に等しいダメージを与える": "handDiscardHit"}
    if text.rstrip("。") in T47: return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": T47[text.rstrip("。")], "op": "grant", "value": True}}]   # Q#47
    if text.rstrip("。") in ("≪ダメージ置き場と捨て札置き場にあるカード全て≫のテキストを無効化する", "≪このカード以外の、ダメージ置き場と捨て札置き場にあるカードに対して発揮されるテキスト全て≫を無効化する", "≪ダメージ置き場の枚数を参照するテキスト全て≫を無効化する", "メインフェイズの間、≪デッキにあるカードに対して発揮されるテキスト全て≫を無効化する"):   # Q#46
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "pileTextOff", "op": "grant", "value": True}}]
    if text.rstrip("。") == "このカードが場に出た場合、場またはダメージ置き場またはあなたの手札のブレイクカードまたはキャラクターカード1枚を指定する。≪このキャラクター≫は、指定したカードの持つ分類・スキル・エフェクト・アビリティ全てを持ち、そのカードの勢力のキャラクターとしても扱い、そのカードのファクターを1つ持つ。指定したカードが手札にある場合、常に公開され続ける。指定したカードが場またはダメージ置き場またはあなたの手札にある限り、この効果は発揮され続ける":   # Q#49
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "copyCardPick"}], "status": "auto"}, "status": "auto"}]
    if text.startswith("≪あなたの対戦相手全て≫は、キャラクターカード以外のカードを使用宣言する場合、コストを支払った状態で、使用宣言するカードを裏向きにする。あなたは、カード名称を1つ指定し、このキャラクターから1コスト支払うことが可能。"):   # Q#50
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "guessName", "op": "grant", "value": True}}]
    # ---- M2e batch 2 (Revise#147) ----
    m = re.fullmatch(r"あなたのテリトリーに、?ブレイクしているネームレベルキャラクターがいる場合、≪このキャラクター≫は(.+?)を得、\+(\d+)/\+\(?(\d+)\)?/\+(\d+)される。?", text)
    if m:
        r0 = grant_all({"self": True}, m.group(1), [int(m.group(2)), int(m.group(3)), int(m.group(4))], {"countAtLeast": {"sel": {"owner": "you", "broken": True, "named": True}, "n": 1}}, text)
        if r0:
            for a0 in r0: a0["mod"]["to"] = "self"
            return r0
    m = re.fullmatch(r"このキャラクターがあなたの対戦相手にアタックした場合、≪あなたの任意のキャラクタ.?1人≫にXダメージを与える。(Xは[^。]+に等しい)。?", text)
    if m and x_def(m.group(1)): return [{"kind": "trigger", "when": {"event": "attack", "self": True, "toPlayer": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "pickCharDamage", "sel": {}, "n": "X"}], "x": x_def(m.group(1)), "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "このキャラクターがプレイヤーにアタックした場合、≪アタックを受けたプレイヤー≫の手札から、あなたの任意の手札を1枚捨て札する":
        return [{"kind": "trigger", "when": {"event": "attack", "self": True, "toPlayer": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "handTake", "to": "attackedPlayer", "n": 1, "dest": "discard"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪あなたの支配エリアの(.+?)全て≫は、シールドを得、対戦相手の使用したプロジェクトカードの目標にならない。?", text)
    if m and class_tokens(m.group(1)):
        sel = {"owner": "you", "area": "controlled", "icons": class_tokens(m.group(1))}
        return [{"kind": "always", "text": text, "mod": {"to": {"all": sel}, "key": "skill", "op": "grant", "value": {"id": "shield", "x": True}}}, {"kind": "always", "text": text, "mod": {"to": {"all": sel}, "key": "untargetable", "op": "grant", "value": {"from": ["Project"], "byOpp": True}}}]
    m = re.fullmatch(r"≪このキャラクター以外のあなたの支配エリアの(.+?)≫がバトルする際、そのキャラクターに\+(\d+)/\+(\d+)/\+(\d+)して判定する。?", text)
    if m and class_tokens(m.group(1)):
        sel = {"owner": "you", "area": "controlled", "icons": class_tokens(m.group(1)), "notSelf": True}
        return [{"kind": "always", "text": text, "mod": {"to": {"all": sel}, "key": k, "op": "add", "value": int(m.group(i))}, "cond": {"targetInBattle": True}} for k, i in (("se", 2), ("at", 3), ("de", 4))]
    m = re.fullmatch(r"≪パワー0の(.+?)全て≫の、スキル・エフェクト全てを無効化する。?", text)
    if m and class_tokens(m.group(1)): return [{"kind": "always", "text": text, "mod": {"to": {"all": {"power": {"op": "=", "n": 0}, "icons": class_tokens(m.group(1))}}, "key": "negate", "op": "grant", "value": {"skills": True, "effects": True}}}]
    if text.rstrip("。") == "このカードがセットされたターンの終了時まで、≪あなたの支配キャラクター全て≫は対戦相手のカードの効果を受けない":
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "mod", "to": {"all": {"owner": "you", "area": "controlled"}}, "mod": {"key": "untargetable", "op": "grant", "value": {"from": ["Project", "Fast", "Effect", "Break"], "byOpp": True}}, "until": "turn"}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "このキャラクターがバトルする際、≪このキャラクターのバトル相手にセットされているパーマネントカード全て≫を捨て札する":
        return [{"kind": "trigger", "when": {"event": "battleStart", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "cardsOf", "to": "battleOpp", "part": "perm", "all": True, "dest": "discard"}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "≪バトルしたキャラクター≫は、バトル終了時に捨て札される":
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "battleEndAll", "op": "grant", "value": True}}]
    if text.rstrip("。") == "このカードがセットされた場合、≪あなたよりも多くの手札を持つプレイヤー全て≫は、あなたの手札枚数と等しくなるように自分の手札を選んで捨て札する":
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "handDownToMine"}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "メインフェイズ開始時に、≪あなたよりも多くのキャラクターを支配しているプレイヤー全て≫は、自分の支配キャラクター1人を捨て札する":
        return [{"kind": "trigger", "when": {"event": "phaseStart", "phase": "main"}, "optional": False, "text": text, "effect": {"steps": [{"a": "moreCharsDiscard"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"(このカードがセットされた場合、|あなたのメインフェイズ開始時に、)?≪プレイヤー全て≫は、?自分の(デッキ|ダメージ置き場または捨て札置き場|ダメージ置き場)(?:から|の)(プロジェクトカード|ブレイクカード|クリーチャーまたはクリーチャー♂のカード)1枚を(?:選び、)?手札に加える。?", text)
    if m:
        zones = {"デッキ": ["deck"], "ダメージ置き場または捨て札置き場": ["damage", "discard"], "ダメージ置き場": ["damage"]}[m.group(2)]
        sel = {"types": ["Project"]} if m.group(3) == "プロジェクトカード" else {"types": ["Break"]} if m.group(3) == "ブレイクカード" else {"icons": ["クリーチャー", "クリーチャー♂"]}
        when = {"event": "enter", "self": True} if m.group(1) == "このカードがセットされた場合、" else {"event": "phaseStart", "phase": "main", "mine": True} if m.group(1) else None
        step = {"a": "eachPlayerPick", "zones": zones, "sel": sel}
        if when: return [{"kind": "trigger", "when": when, "optional": False, "text": text, "effect": {"steps": [step], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"メインフェイズ開始時に、≪あなたのデッキ≫から(.+?)を持つカード1枚を選び、手札に加えることが可能。?", text)
    if m and class_tokens(m.group(1).replace("または", "・")):
        return [{"kind": "trigger", "when": {"event": "phaseStart", "phase": "main", "mine": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "pickZone", "to": "you", "dest": "hand", "zone": "deck", "owner": "you", "sel": {"icons": class_tokens(m.group(1).replace("または", "・"))}, "n": 1, "upTo": True}, {"a": "shuffle", "to": "you"}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "このカードがセットされた場合、≪あなたのデッキ≫から、ネームを持たないキャラクターカードを1枚選び、あなたの支配キャラクターとしてセット可能":
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "pickZone", "to": "you", "dest": "back", "zone": "deck", "owner": "you", "sel": {"types": ["Character"], "anyOf": [{"nameNone": True}]}, "n": 1, "upTo": True}, {"a": "shuffle", "to": "you"}], "status": "auto"}, "status": "auto"}]
    # ---- Revise#395 (card reports of 2026-11-11) ----
    if re.fullmatch(r"≪パワーが0の状態で、プレイヤーにアタックまたはバトルするこのキャラクター≫は、ダメージ判定とバトルの際、±0/\+10/-5される。その際、≪このキャラクターのバトル相手≫に-5/-5/-5して判定する。?", text):   # A4-04 0609 (M5)
        cd = {"all": [{"selfPowerIs": 0}, {"selfFighting": True}]}
        return [{"kind": "always", "text": text, "cond": cd, "mod": {"to": "self", "key": "at", "op": "add", "value": 10}}, {"kind": "always", "text": text, "cond": {"all": [{"selfPowerIs": 0}, {"self": "inBattle"}]}, "mod": {"to": "self", "key": "de", "op": "add", "value": -5}}] + \
               [{"kind": "always", "text": text, "cond": {"all": [{"selfPowerIs": 0}, {"self": "inBattle"}]}, "mod": {"to": "battleOpp", "key": k, "op": "add", "value": -5}} for k in ("se", "at", "de")]
    if re.fullmatch(r"このキャラクターが与えたダメージでパワーカードがセットされているキャラクターが捨て札された場合、あなたのダメージ置き場のカード1枚を≪このキャラクター≫にパワーカードとしてセットする。?", text):   # A4-EP EP421 (M5)
        return [{"kind": "trigger", "when": {"event": "killed", "anyDamage": True, "hadPower": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "pickZone", "zones": ["damage"], "owner": "you", "n": 1, "sel": {}, "dest": "powerSelf"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカードが“([^”]+)”にセットされている場合、≪このキャラクター≫は、アビリティ「メインフェイズ終了時まで、?≪このキャラクターからダメージを受けたキャラクター≫からコストを支払うことはできない。」を持つ。?", text)   # A3-EX02 EX0102 (M5)
    if m and cond_of("このカードが“" + m.group(1) + "”にセットされている場合"):
        return [{"kind": "trigger", "when": {"event": "damaged", "byThisAny": True}, "cond": cond_of("このカードが“" + m.group(1) + "”にセットされている場合"), "optional": False, "text": text, "effect": {"steps": [{"a": "mod", "to": "evCh", "mod": {"key": "noPay", "op": "grant", "value": True}, "until": "main"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"このカードがセットされた場合、≪あなたの任意のプロジェクトカード・ファストカード全て≫を捨て札する。?", text):   # A4-EX02 EX916 (M5): declared Project / Fast cards of your choice
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "cancelPicked", "types": ["Project", "Fast"]}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"対戦相手の手札枚数が手札上限以上の場合、≪このカード≫のコストは(\d+)減少する。?(?:Xは対戦相手全ての手札枚数の合計に等しい。?)?", text)   # A4-PR PR140 (M5)
    if m: c["costLessIf"] = {"cond": {"oppHandAtLimit": True}, "n": int(m.group(1))}; return []
    if re.fullmatch(r"≪ブレイクしていない、ドロー\+1と武蔵を持つあなたの支配キャラクター全て≫にドロー\+1を与える。?", text):   # A4-EX02 EX810 (M5)
        return [{"kind": "always", "text": text, "mod": {"to": {"all": {"broken": False, "tag": "武蔵", "owner": "you", "area": "controlled", "printedSkill": "draw"}}, "key": "skill", "op": "grant", "value": {"id": "draw", "x": 1}}}]
    if re.fullmatch(r"≪あなたのパートナーのこのキャラクター≫はバインド2・チャージXを得る。?(?:Xはこのキャラクターを構成する、ネームを持つカードの枚数に等しい。?)?", text):   # A4-05 0950 — no Partner in v4: read as "this Name-level character" (Pack's report)
        return [{"kind": "always", "text": text, "cond": {"selfIs": {"named": True}}, "mod": {"to": "self", "key": "skill", "op": "grant", "value": {"id": "bind", "x": 2}}},
                {"kind": "always", "text": text, "cond": {"selfIs": {"named": True}}, "mod": {"to": "self", "key": "skill", "op": "grant", "value": {"id": "charge", "x": {"x": {"stackNamedCards": "self"}}}}}]
    if re.fullmatch(r"このキャラクターがプレイヤーにアタックした場合、通常のダメージ判定を行わず、≪アタックを受けたプレイヤーのデッキ≫の上から、このキャラクターの精神力に等しい枚数のカードがダメージ置き場に置かれるまでダメージ判定を行う。?", text):   # A3-23 3357
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "playerHit", "op": "grant", "value": {"replace": True, "effect": {"steps": [{"a": "dmgUntilOne", "n": "selfSe"}], "status": "auto"}}}}]
    if re.fullmatch(r"このカードがセットされた場合、あなたはキャラクタ.1人を指定する。?", text):   # A3-25 3691
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "bindWeak", "x": {"factorSum": "WIZ-DOM"}, "keys": ["noAttack", "noGuard", "noEffect", "noPay"]}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"指定されたキャラクターの精神力がX未満の場合、≪指定されたキャラクター≫はアタック宣言・ガード宣言・エフェクトの使用宣言・コストの支払いができない。Xはあなたとあなたの支配キャラクターの持つWIZ.DOMのファクターの合計に等しい。?", text):   # A3-25 3691: the rule of the line above
        return []
    m = re.fullmatch(r"このカードがセットされた場合、あなたは、≪あなたの任意のプレイヤ.?1人≫の手札全てを見て、その中の(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のカード1枚を捨て札可能。?", text)
    if m: return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "peekHandDiscard", "sel": {"faction": FACTION_JP[m.group(1)]}}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "このカードがセットされた場合、≪あなたのダメージ置き場と捨て札置き場にある、このカードと同じネームを持つカード全て≫をあなたの手札に戻す":
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "sameNamePilesToHand"}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "あなたの支配キャラクターがバトルの結果捨て札になった場合、≪そのキャラクターを構成しているブレイクカード全て≫はオーナーの手札に戻る":
        return [{"kind": "trigger", "when": {"event": "leave", "own": True, "controlled": True, "battle": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "evBreakToHand"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪あなたの支配キャラクター≫が捨て札される場合、あなたの支配エリアの(.+?)1人を捨て札することで、そのキャラクターを場に残すことが可能。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "tokenKeep", "op": "grant", "value": {"name": m.group(1)}}}]
    # ---- M2e batch 3 (Revise#147) ----
    if text.rstrip("。") == "このカードを同じネームを持つキャラクターにセット宣言する場合、≪このカードのコスト≫はオーナーの手札に戻る": c["costBack"] = {"to": "hand", "sameName": True}; return []
    if text.rstrip("。") == "このカードが除去される場合、≪このカード≫をオーナーの手札に戻す": c["leaveSelfHand"] = True; return []   # A3-16 2256 (Revise#170)
    if text.rstrip("。") == "≪このカード≫は、プロジェクトカード・ファストカード・エフェクトの効果を受けない" and c.get("type") == "Permanent": c["selfImmune"] = True; return []   # A3-14 2027 (Revise#173)
    m = re.fullmatch(r"このカードがセットされた場合、≪あなたの任意の数のあなたの手札≫を、(勢力なし、.+?)のあなたの支配キャラクター、(\S+?)としてセットしてもよい。\2にカードをセットすることはできない。?", text)   # A3-12 1760 (Revise#174)
    tb = m and token_body("≪このエフェクトのコスト≫を、" + m.group(1) + "のあなたの支配キャラクター、" + m.group(2) + "としてセットする。" + m.group(2) + "にカードをセットすることはできない。")
    if tb and tb.get("steps"): return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [dict(tb["steps"][0], a="handTokens")], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"あなたがこのキャラクターにネームを持つ(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のブレイクカードをセットした場合、(.+)", text)   # A3-24 3433 / 3469 / 3505 / 3541 (Revise#176)
    if m:
        w, rest, eff, x = dict({"event": "brokenSelf", "own": True, "newSel": {"named": True, "faction": FACTION_JP[m.group(1)]}}, **({"onChar": True} if c.get("type") == "Permanent" else {})), m.group(2).rstrip("。"), None, None   # onChar: these are Permanents — the character they are on (Pack bug A3-24 3541, Revise#289)
        if rest == "≪あなたのダメージ置き場のプロジェクトカードまたはファストカード1枚≫を手札に戻すことが可能": eff = [{"a": "pickZone", "zones": ["damage"], "owner": "you", "dest": "hand", "n": 1, "upTo": True, "sel": {"types": ["Project", "Fast"]}}]
        if rest == "≪あなたの捨て札置き場のあなたの任意のカードX枚≫をデッキに戻すことが可能。その後、そのデッキをシャッフルする。Xはセットしたブレイクカードのコストに等しい": eff, x = [{"a": "pickZone", "zones": ["discard"], "owner": "you", "dest": "deckShuffle", "n": "X", "upTo": True}], {"evCardCost": True}
        if rest == "≪あなたの支配キャラクター1人≫にセットされているパワーカード全てを、このキャラクターに、パワーカードとしてセットする": eff = [{"a": "powerFromOwnToSelf"}]
        if rest == "≪あなた≫は、あなたの手札のあなたが必要ファクターを満たしているパーマネントカード1枚を、このキャラクターにセット可能": eff = [{"a": "handPermFreeSelf"}]
        if eff: return [{"kind": "trigger", "when": w, "optional": False, "text": text, "effect": dict({"steps": eff, "status": "auto"}, **({"x": x} if x else {})), "status": "auto"}]
    if text.rstrip("。") == "このカードがダメージ判定によってあなたのダメージ置き場に置かれた場合、≪このカード≫を、あなたのテリトリーのあなたの任意のキャラクター1人にセットする":   # A3-09 1317
        return [{"kind": "trigger", "zones": ["damage"], "when": {"event": "selfToDamage", "byCheck": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "thisCardPermOnto"}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "あなたのメインフェイズ終了時に、≪あなたの手札のゴーストを持つキャラクターカード1枚≫を、あなたの支配キャラクターとしてセット可能":   # A3-24 3432
        return [{"kind": "trigger", "when": {"event": "phaseEnd", "phase": "main", "mine": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "pickZone", "zones": ["hand"], "owner": "you", "dest": "back", "n": 1, "upTo": True, "sel": {"types": ["Character"], "icons": ["ゴースト"]}}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカードがあなたのダメージ置き場にある場合、≪あなたのパーマネントカード全て≫は、対戦相手のカードの効果を受けない。?", text)   # A3-25 3655
    if m: return [{"kind": "always", "zone": "damage", "text": text, "mod": {"to": {"players": "you"}, "key": "permImmuneOpp", "op": "grant", "value": True}}]
    if text.rstrip("。") == "使用宣言中の、≪このキャラクターを対象に含むプロジェクトカード・ファストカード・エフェクト全て≫を無効化する":   # A3-12 1790 (Revise#177): when it is set (at Fast timing)
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "cancelItemsOnSelf"}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "あなたのドローフェイズ開始時に、このキャラクターにセットされているパワーカード1枚を、あなたのダメージ置き場に置く。置けなかった場合、≪このキャラクター≫はオーナーの勢力エリアのアクティブキャラクターとなる":   # A3-17 2373
        return [{"kind": "trigger", "when": {"event": "phaseStart", "phase": "draw", "mine": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "powerToDamageOrActive"}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "メインフェイズ開始時に、このカードをオーナーの手札に戻すことが可能。そうした場合、≪あなたのデッキ≫からカード1枚を選び、プレイヤー全てに公開してからあなたの手札に加え、そのデッキをシャッフルする":   # A3-21 2980
        return [{"kind": "trigger", "when": {"event": "phaseStart", "phase": "main", "mine": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "selfCardToHandAny"}, {"a": "pickZone", "zones": ["deck"], "owner": "you", "dest": "hand", "n": 1, "reveal": True}, {"a": "shuffle", "to": "you"}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "あなたのターン開始時に、≪このキャラクター≫に、あなたの任意のあなたの手札X枚をパワーカードとしてセット可能":   # A3-04 0640 (Revise#175)
        return [{"kind": "trigger", "when": {"event": "turnStart", "mine": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "handToPowerAny"}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "≪このカード≫は対戦相手のカードの効果を受けない" and c.get("type") == "Permanent": c["selfImmune"] = {"oppOnly": True}; return []   # A3-25 3619 / 3763
    if text.rstrip("。") == "≪このカード≫は対戦相手のカードの効果を受けない" and c.get("type") in ("Break", "Character"): return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "untargetable", "op": "grant", "value": {"byOpp": True}}}]   # A3-25 3763 (Revise#173)
    if text.rstrip("。") == "≪このカード≫の必要ファクターとコストは、あなたの支配エリアの異なる勢力のキャラクター分減少する": c["costLess"] = {"factionsControlled": True}; c["factorLessX"] = {"factionsControlled": True}; return []   # A3-25 3619
    if text.rstrip("。") == "あなたのメインフェイズ開始時に、≪あなたの任意のあなたのダメージ置き場のカード1枚≫を、このキャラクターにパワーカードとしてセットする":   # A3-25 3763
        return [{"kind": "trigger", "when": {"event": "phaseStart", "phase": "main", "mine": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "pickZone", "zones": ["damage"], "owner": "you", "dest": "powerSelf", "n": 1}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"([“”\"][^“”\"]+[”\"]があなたの支配エリアにセットされている場合)、(捨て札になった≪このカード≫はオーナーの手札に戻る|≪このカード≫をファストカードのタイミングでセット宣言可能)。?", text)   # A3-08 1268 / 1271 (Revise#172)
    if m and cond_of(m.group(1)):
        if m.group(2).startswith("捨て札"): return [{"kind": "trigger", "zones": ["discard"], "when": {"event": "selfToDamage", "zone": "discard"}, "cond": cond_of(m.group(1)), "optional": False, "text": text, "effect": {"steps": [{"a": "selfCardToHandAny"}], "status": "auto"}, "status": "auto"}]
        c["fastIfCond"] = cond_of(m.group(1)); return []
    if text.rstrip("。") == "このカードがセットされた時にアタック宣言が行われている場合、≪あなたの任意のキャラクター1人≫のアタック宣言を取り消す":   # A3-12 1774
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "cancelCurrentAttack"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカードが対戦相手の使用したカード・エフェクトの効果によって捨て札になる場合、≪あなた≫は(\d+)ドローする。?", text)   # A3-07 1101
    if m: return [{"kind": "trigger", "when": {"event": "leave", "self": True, "byOppEffect": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "draw", "to": "you", "n": int(m.group(1))}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカード以外に、?このカードと同じ名称のカードがダメージ置き場に1枚以上ある場合、対象は(.+?)を得る。?", text)   # A3-09 1350 / A3-23 3319
    if m and skills_list(m.group(1)): return [{"kind": "always", "text": text, "cond": {"xAtLeast": {"x": {"sameJpInDamage": True}, "n": 1}}, "mod": {"to": "self", "key": "skill", "op": "grant", "value": x}} for x in skills_list(m.group(1))]
    if text.rstrip("。") == "≪このキャラクター≫は、このキャラクターを構成するキャラクターカードの持つスキル全てを得る":   # A3-22 3305
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "stackCharSkills", "op": "grant", "value": True}}]
    if text.rstrip("。") == "このカードが捨て札になる場合、≪あなたの任意のあなたの手札1枚≫を捨て札する":   # A3-22 3267
        return [{"kind": "trigger", "when": {"event": "leave", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "pickZone", "zones": ["hand"], "owner": "you", "dest": "discard", "n": 1}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "このカードをこのカードと同じネームを持つキャラクターにセット宣言する場合、≪あなた≫はこのカードをファストカードのタイミングでセット宣言可能": c["fastOnSameName"] = True; return []
    if text.rstrip("。") == "このカードをこのカードと同じネームを持つキャラクターにセット宣言する場合、≪あなた≫はこのカードをファストカードのタイミングで必要ファクターを無視してセット宣言可能": c["fastOnSameName"] = True; c["sameNameNoFactor"] = True; return []   # 3536 (Revise#151)
    if text.rstrip("。") == "このキャラクターにプロジェクトカード・ファストカードが効果を発揮している場合、≪あなた≫はファストカードのタイミングで、このキャラクターと同じネームを持つブレイクカードをこのキャラクターにセット宣言可能":   # 3791 (Revise#151)
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "breakFast", "op": "grant", "value": {"sameName": True}}, "cond": {"xAtLeast": {"x": {"lastingOn": True}, "n": 1}}}]
    if text.rstrip("。") == "手札からカードが捨て札された場合、≪捨て札されたカード≫は、そのオーナーのダメージ置き場に置かれる":   # 3228 (Revise#151)
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "handDiscardToDamage", "op": "grant", "value": True}}]
    m = re.fullmatch(r"このキャラクターが(?:あなたの)?対戦相手を目標にアタック宣言した場合、ターン終了時まで、≪このキャラクター≫に±0/\+(\d+)/\+(\d+)する。?", text)
    if m: return [{"kind": "trigger", "when": {"event": "attack", "self": True, "toPlayer": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "mod", "to": "self", "mod": {"key": "at", "op": "add", "value": int(m.group(1))}, "until": "turn"}, {"a": "mod", "to": "self", "mod": {"key": "de", "op": "add", "value": int(m.group(2))}, "until": "turn"}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "≪このキャラクターのバトル相手にセットされているカード全て≫は、バトル終了時に捨て札される":
        return [{"kind": "trigger", "when": {"event": "battleEnd", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "cardsOf", "to": "battleOpp", "part": "perm", "all": True, "dest": "discard"}, {"a": "cardsOf", "to": "battleOpp", "part": "power", "all": True, "dest": "discard"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカードの下に[“\"]([^”\"]+)[”\"]がある場合、≪あなたの支配エリアの(.+?)全て≫はインフィニティを得る。?", text)
    if m and class_tokens(m.group(2)): return [{"kind": "always", "text": text, "mod": {"to": {"all": {"owner": "you", "area": "controlled", "icons": class_tokens(m.group(2))}}, "key": "skill", "op": "grant", "value": {"id": "infinity", "x": True}}, "cond": {"belowName": re.sub(r"\s+", "", m.group(1))}}]
    m = re.fullmatch(r"このカードがセットされた場合、≪あなたのダメージ置き場または捨て札置き場にある、(.+?)を持つキャラクターカード1枚またはブレイク条件のない\1を持つブレイクカード1枚≫を、あなたの支配キャラクターとしてセット可能。?", text)
    if m and class_tokens(m.group(1)):
        ic = class_tokens(m.group(1))
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "pickZone", "to": "you", "dest": "back", "zones": ["damage", "discard"], "owner": "you", "sel": {"anyOf": [{"types": ["Character"], "icons": ic}, {"types": ["Break"], "icons": ic, "noRule": True}]}, "n": 1, "upTo": True}], "status": "auto"}, "status": "auto"}]
    # ---- M2e batch 3 (Revise#148) ----
    if text.rstrip("。") == "支配キャラクターが、プレイヤーを目標にアタック宣言した場合、≪そのキャラクターのオーナー≫は、1ドローする":
        return [{"kind": "trigger", "when": {"event": "attack", "toPlayer": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "draw", "to": "evPlayer", "n": 1}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "≪精神攻撃力を持つキャラクター全て≫は、アタック宣言・ガード宣言・エフェクトの使用宣言をすることができない":
        return [{"kind": "always", "text": text, "mod": {"to": {"all": {"atMental": True}}, "key": k, "op": "grant", "value": True}} for k in ("noAttack", "noGuard", "noEffect")]
    if text.rstrip("。") == "≪あなたの対戦相手全て≫は、効果範囲目標のプロジェクトカード・ファストカードを使用宣言することはできない":
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "opponents"}, "key": "ban", "op": "ban", "value": {"decl": "set", "types": ["Project", "Fast"], "areaTarget": True}}}]
    m = re.fullmatch(r"≪(.+?)を持つブレイクカードのコスト≫は、?オーナーの手札に戻る。?", text)
    if m and class_tokens(m.group(1).replace("または", "・")): return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "dest", "op": "dest", "value": {"cost": "set", "type": "Break", "icons": class_tokens(m.group(1).replace("または", "・")), "to": "hand"}}}]
    m = re.fullmatch(r"≪あなたの(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のカード≫の必要ファクターとコストは、1ずつ減少する。この効果で、コストは1未満にはならない。?", text)
    if m:
        f = FACTION_JP[m.group(1)]
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "cardCost", "op": "add", "value": {"n": -1, "sel": {"faction": f}, "minCost": 1}}}, {"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "factorLess", "op": "add", "value": {"n": 1, "sel": {"faction": f}}}}]
    m = re.fullmatch(r"このカードの下に[“\"]([^”\"]+)[”\"]がある場合、≪このキャラクター≫はバインド(\d+)を得、通常攻撃によるダメージを受けない。?", text)
    if m:
        cond = {"belowName": re.sub(r"\s+", "", m.group(1))}
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "skill", "op": "grant", "value": {"id": "bind", "x": int(m.group(2))}}, "cond": cond}, {"kind": "always", "text": text, "mod": {"to": "self", "key": "noDamage", "op": "grant", "value": {"battleNormal": True}}, "cond": cond}]
    m = re.fullmatch(r"あなたのダメージ置き場のカード枚数が(\d+)枚以上の場合、≪このキャラクター≫は(.+?)を得、\+(\d+)/\+(\d+)/\+(\d+)される。?", text)
    if m:
        r0 = grant_all({"self": True}, m.group(2), [int(m.group(g)) for g in (3, 4, 5)], {"damage": {"op": ">=", "n": int(m.group(1))}}, text)
        if r0:
            for a0 in r0: a0["mod"]["to"] = "self"
            return r0
    m = re.fullmatch(r"≪このキャラクターのアタック宣言に対してガード宣言した、耐久力(\d+)以下のキャラクター≫を捨て札する。?", text)
    if m: return [{"kind": "trigger", "when": {"event": "guarded", "self": True, "asAttacker": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "discard", "to": "evCh", "ifSel": {"stat": [{"key": "de", "op": "<=", "n": int(m.group(1))}]}}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪このキャラクター≫は、?([^≪≫、。]+?)を目標にアタック宣言可能。?", text)   # A3-11 1712 (Revise#171): a class
    if m and class_tokens(m.group(1).replace("または", "・")) and len(class_tokens(m.group(1).replace("または", "・"))) == len(re.split("・|または", m.group(1))):
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "attackChars", "op": "grant", "value": {"icons": class_tokens(m.group(1).replace("または", "・"))}}}]
    if text.rstrip("。") == "≪このキャラクターとのバトルによって捨て札されるブレイクしていないキャラクターを構成するカード全てと、そのキャラクターにセットされているカード全て≫を、そのオーナーのダメージ置き場に置く":   # A3-12 1775 (Revise#171)
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "killToDamageUnbroken", "op": "grant", "value": True}}]
    m = re.fullmatch(r"あなたのダメージ置き場のカード枚数が(\d+)枚(以上)?の場合、≪このキャラクター≫の(精神力|攻撃力|耐久力)に([+\-]\d+)する。?", text)   # A3-12 1775
    if m: return [{"kind": "always", "text": text, "cond": {"xEq" if not m.group(2) else "xAtLeast": {"x": {"damage": "you"}, "n": int(m.group(1))}}, "mod": {"to": "self", "key": STAT_JP[m.group(3)], "op": "add", "value": int(m.group(4))}}]
    m = re.fullmatch(r"このキャラクターがバトルする際、≪このキャラクターのバトル相手のパワーカードX枚≫を捨て札する。Xはこのキャラクターを構成する、?(ネームを持つ)?(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のブレイクカードの枚数に等しい。?", text)   # A3-24 3397 (Revise#173)
    if m: return [{"kind": "trigger", "when": {"event": "battleStart", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "powerDiscard", "to": "battleOpp", "n": "X", "zeroNone": True}], "x": {"selfStackSel": dict({"faction": FACTION_JP[m.group(2)]}, **({"named": True} if m.group(1) else {}))}, "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "このキャラクターがバトルによるダメージを与えた場合、≪このキャラクターとのバトルによるダメージを受けたキャラクターにセットされている、パワーカード全て≫を捨て札する":   # A3-22 3231
        return [{"kind": "trigger", "when": {"event": "damaged", "byThisBattle": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "powerDiscard", "to": "evCh"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"(このカードが(.+?)以外にセットされている場合)、≪このカード≫は(パーマネント[+\-]\d+)を得る。?", text)   # A3-12 1835
    if m and cond_of(m.group(1)) and skills_list(m.group(3)): return [{"kind": "always", "text": text, "cond": cond_of(m.group(1)), "mod": {"to": "self", "key": "skill", "op": "grant", "value": x}} for x in skills_list(m.group(3))]
    m = re.fullmatch(r"このキャラクターがプロジェクトカードの(?:対象|目標)になる場合、メインフェイズ終了時まで、≪このキャラクター≫は(.+?)を得る。?", text)   # A3-11 1603 (Revise#173): when a Project card is declared on it
    if m and skills_list(m.group(1)): return [{"kind": "trigger", "when": {"event": "cardDeclared", "types": ["Project"], "targetsSelf": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "mod", "to": "self", "mod": {"key": "skill", "op": "grant", "value": x}, "until": "main"} for x in skills_list(m.group(1))], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このキャラクターのアタック宣言に対してガード宣言された場合、バトル終了時まで、≪このキャラクター≫は(.+?)を得る。?", text)   # A3-11 1603
    if m and skills_list(m.group(1)): return [{"kind": "trigger", "when": {"event": "guarded", "self": True, "asAttacker": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "mod", "to": "self", "mod": {"key": "skill", "op": "grant", "value": x}, "until": "battle"} for x in skills_list(m.group(1))], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "このカードが捨て札された場合、≪このカード≫をオーナーの手札に戻す":   # A3-14 2027
        return [{"kind": "trigger", "zones": ["discard"], "when": {"event": "selfToDamage", "zone": "discard"}, "optional": False, "text": text, "effect": {"steps": [{"a": "selfCardToHandAny"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカードが(.+?)キャラクターにセットされている場合、≪このキャラクター≫は(.+?)を得る。?", text)   # A3-14 2027
    if m and parse_selector(m.group(1)) is not None and skills_list(m.group(2)): return [{"kind": "always", "text": text, "cond": {"selfIs": parse_selector(m.group(1))}, "mod": {"to": "self", "key": "skill", "op": "grant", "value": x}} for x in skills_list(m.group(2))]
    m = re.fullmatch(r"(このカードが[“”\"][^“”\"]+[”\"]にセットされている状態で、)?このキャラクターが(支配キャラクターと)?バトルした場合、?バトル終了時に(?:≪このカード≫|このカード)(?:は|を)オーナーの手札に(?:戻る|戻す)。?", text)   # EX0060 / EX0147 (Revise#210)
    if m: return [dict({"kind": "trigger", "when": dict({"event": "battleEnd", "self": True}, **({"vsCtl": True} if m.group(2) else {})), "optional": False, "text": text, "effect": {"steps": [{"a": "selfCardToHand"}], "status": "auto"}, "status": "auto"}, **({"cond": cond_of(m.group(1).replace("状態で、", "場合"))} if m.group(1) else {}))]
    if text.rstrip("。") == "このキャラクターがバトルした場合、バトル終了時に≪このカード≫を捨て札する":   # A3-07 1199 (a Permanent)
        return [{"kind": "trigger", "when": {"event": "battleEnd", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "thisCardDiscard"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪このキャラクター≫は支配キャラクターを目標にアタック宣言可能。≪このアタック宣言に対してガード宣言するキャラクター≫のガードコストは(\d+)上昇する。?", text)   # A3-16 2309 (Revise#170)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "attackChars", "op": "grant", "value": {"area": "controlled"}}}, {"kind": "always", "text": text, "mod": {"to": "self", "key": "guardTaxVs", "op": "add", "value": int(m.group(1))}}]
    if text.rstrip("。") == "≪このキャラクター≫は、このキャラクターと同じ分類を持つキャラクターを目標にアタック宣言可能":
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "attackChars", "op": "grant", "value": {"shareIconSelf": True}}}]
    m = re.fullmatch(r"このキャラクター以外の、このキャラクターと同じ分類を持つキャラクターが場に存在しない場合、≪このキャラクター≫は(.+?)を得、\+(\d+)/\+(\d+)/\+(\d+)される。?", text)
    if m:
        r0 = grant_all({"self": True}, m.group(1), [int(m.group(g)) for g in (2, 3, 4)], {"noOtherShareIcon": True}, text)
        if r0:
            for a0 in r0: a0["mod"]["to"] = "self"
            return r0
    if text.rstrip("。") == "このカードがセットされた場合、≪あなた≫は、あなたの任意のあなたの捨て札置き場のカード1枚を手札に戻す":
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "pickZone", "to": "you", "dest": "hand", "zone": "discard", "owner": "you", "sel": {}, "n": 1, "upTo": False}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "このカードがセットされたターンの終了時まで、≪あなたの任意のキャラクター1人≫に+2/+2/+2または-1/-1/-1する":
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "pickCharChoiceMod", "choices": [[2, 2, 2], [-1, -1, -1]], "until": "turn"}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "≪プレイヤー全て≫は、ドローフェイズのドローの際に、本来の2倍ドローする":
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "drawDouble", "op": "grant", "value": True}}]
    if text.rstrip("。") == "≪プレイヤー全て≫は、本来のコストがXの、Xを任意で指定する、ブレイクカード以外のカードを使用宣言することができない":
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "ban", "op": "ban", "value": {"decl": "set", "costIsX": True, "notType": "Break"}}}]
    if re.fullmatch(r"あなたのメインフェイズ開始時に、≪あなたのダメージ置き場のカードX枚と、あなたの手札のカードX枚≫を入れ替えることが可能。?(?:Xは[^。]+。?)?", text):   # (the X line may follow — Revise#222)
        return [{"kind": "trigger", "when": {"event": "phaseStart", "phase": "main", "mine": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "swapDamageHand"}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "このカードがセットされた場合、≪あなたの任意の勢力エリア1つのキャラクター全て≫を捨て札する":
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "factionAreaWipe"}], "status": "auto"}, "status": "auto"}]
    # ---- M2e batch 4 (Revise#149) ----
    m = re.fullmatch(r"このカードがセットされた際に、対戦相手のテリトリーに(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のキャラクターがいる場合、≪あなたの任意の、そのプレイヤーの手札1枚≫を捨て札し、≪あなた≫は1ドロー可能。?", text)
    if m: return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "factionOppHandHit", "faction": FACTION_JP[m.group(1)]}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪このキャラクターのアタック宣言に対してガード宣言するキャラクター≫は、通常のガードコストに加えて追加の(\d+)コストを支払わなければ、?ガード宣言できない。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "guardTaxVs", "op": "add", "value": int(m.group(1))}}]
    if text.rstrip("。") == "このキャラクターがプレイヤーにアタックした場合、通常のダメージ判定の後、≪アタックを受けたプレイヤー≫の手札から、あなたの任意の手札1枚を捨て札する":
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "playerHit", "op": "grant", "value": {"effect": {"steps": [{"a": "handTake", "to": "attackedPlayer", "n": 1, "dest": "discard"}], "status": "auto"}, "replace": False}}}]
    if text.rstrip("。") == "≪あなたと、あなたの支配キャラクター全て≫は、このキャラクターのパワー以下のコストの、プロジェクトカード・ファストカード・エフェクトの効果を受けない":   # the players' part: Project / Fast cards (playerImmune)
        return [{"kind": "always", "text": text, "mod": {"to": {"all": {"owner": "you", "area": "controlled"}}, "key": "untargetable", "op": "grant", "value": {"from": ["Project", "Fast", "Effect"], "costMaxSrcPower": True}}}]
    if text.rstrip("。") == "このキャラクターのパワーが0の場合、≪このキャラクター≫を捨て札する":
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "zeroPowerDie", "op": "grant", "value": True}}]
    if text.rstrip("。") == "≪このキャラクターのアタック宣言に対してガード宣言しているか、このキャラクターにガード宣言されている、パワー0のキャラクター≫は捨て札される":
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "zeroGuardDie", "op": "grant", "value": True}}]
    m = re.fullmatch(r"このキャラクターがバトルする際、このキャラクターのバトル相手を構成するカードの枚数が(\d+)枚以下の場合、≪このキャラクター≫はバトルによるダメージを受けない。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "noDamage", "op": "grant", "value": {"battle": True, "fromSel": {"stackMax": int(m.group(1))}}}}]
    m = re.fullmatch(r"≪あなたの支配キャラクターの(.+?)≫が捨て札される場合、あなたの支配エリアの\1を捨て札することで、そのキャラクターを場に残すことが可能。?", text)
    if m and class_tokens(m.group(1)): return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "tokenKeep", "op": "grant", "value": {"icons": class_tokens(m.group(1))}}}]
    m = re.fullmatch(r"あなたのメインフェイズ開始時に、≪あなたの対戦相手の中でダメージ置き場の枚数が一番多いプレイヤ.?1人≫にXダメージを与える。(Xは[^。]+に等しい)。?", text)
    if m and x_def(m.group(1)): return [{"kind": "trigger", "when": {"event": "phaseStart", "phase": "main", "mine": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "hitMostDamage", "n": "X"}], "x": x_def(m.group(1)), "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカードの下に[“\"]([^”\"]+)[”\"]がある場合、≪このキャラクター≫は(.+?)を得、±0/\+X/\+Xされる。Xはプレイヤー全てのダメージ置き場のカード枚数の合計に等しい。?", text)
    if m:
        cond = {"belowName": re.sub(r"\s+", "", m.group(1))}
        r0 = grant_all({"self": True}, m.group(2), None, cond, text)
        if r0:
            for a0 in r0: a0["mod"]["to"] = "self"
            return r0 + [{"kind": "always", "text": text, "mod": {"to": "self", "key": k, "op": "add", "value": {"x": {"damage": "all"}, "sign": 1}}, "cond": cond} for k in ("at", "de")]
    if text.rstrip("。") == "このカードがセットされた場合、≪あなたの任意の、対戦相手が使用したプロジェクトカードまたはファストカード1枚≫を、オーナーの手札に戻すことが可能":
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "bounceOppLasting"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このキャラクターが(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のキャラクターを捨て札した場合、あなたのデッキの上からカードを1枚引き、≪このキャラクター≫にパワーカードとしてセット可能。?", text)
    if m: return [{"kind": "trigger", "when": {"event": "leave", "bySelf": True, "faction": FACTION_JP[m.group(1)]}, "optional": True, "text": text, "effect": {"steps": [{"a": "powerFromDeck", "to": "self", "n": 1}], "status": "auto"}, "status": "auto"}]
    # ---- Q#55 (Revise#150) ----
    if text.rstrip("。") == "≪このキャラクター≫は、あなたの任意の数のあなたの支配キャラクターと同時に対戦相手1人にアタック宣言できる。アタック宣言されたプレイヤーは、それぞれのアタック宣言に対してガード宣言可能":   # Q#43 rule
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "raid", "op": "grant", "value": {"max": None, "free": False}}}]
    if text.rstrip("。") == "≪このキャラクターとのバトルによって捨て札されるキャラクターを構成するブレイクカード全て≫を、そのオーナーの手札に戻し、≪このキャラクターとのバトルによって捨て札されるキャラクターを構成するキャラクターカード全て≫を、そのオーナーのダメージ置き場に置く":
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "battleKillSplit", "op": "grant", "value": True}}]
    if text.rstrip("。") == "≪このキャラクター≫は、このキャラクター以外のキャラクターの持つエフェクト全てを持つ":
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "copyAllEffects", "op": "grant", "value": True}}]
    if text.rstrip("。") == "このキャラクターがバトルする際、≪このキャラクター≫の攻撃力に+Xして判定し、バトル相手の持つスキル全てを得る。Xはこのキャラクターのバトル相手の攻撃力に等しい":
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "at", "op": "add", "value": {"x": {"battleOppAt": True}, "sign": 1}}, "cond": {"self": "inBattle"}}, {"kind": "always", "text": text, "mod": {"to": "self", "key": "copyOppSkills", "op": "grant", "value": True}}]
    if text.startswith("このキャラクターがプレイヤーにダメージを与える場合、通常のダメージ判定を行わず、≪このキャラクターにダメージを与えられるプレイヤー≫の手札がX枚以上の場合、"):
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "playerHit", "op": "grant", "value": {"effect": {"steps": [{"a": "handDamage"}], "status": "auto"}, "replace": True}}}]
    if text.rstrip("。") == "このカードの下に「サイレントウィッチ“ジリアン・マキャフリー”」がある状態で、プロジェクトカードのコストがこのキャラクターからのみ支払われていた場合、≪プレイヤー全て≫は、そのプロジェクトカードの使用宣言に対してレスポンスを行うことができない":
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "noRespIfOnly", "op": "grant", "value": True}, "cond": {"belowName": "サイレントウィッチ“ジリアン・マキャフリー”"}}]
    if text.rstrip("。") == "≪このキャラクターのアタック宣言に対してガード宣言するか、このキャラクターにガード宣言されたキャラクター≫に、このキャラクターの攻撃力に等しいダメージを与える":
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "guardHit", "op": "grant", "value": {"selfAt": True, "noOwner": True}}}]
    if text.rstrip("。") == "このカードの下に「銀狼“フェンリル”」がある場合、≪このキャラクター≫はインフィニティを得、このカードに書かれたこのアビリティ以外のアビリティは、あなたの支配キャラクター以外のキャラクターにのみ効果を発揮する":
        c["scopeBelow"] = "銀狼“フェンリル”"
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "skill", "op": "grant", "value": {"id": "infinity", "x": True}}, "cond": {"belowName": "銀狼“フェンリル”"}}]
    if text.rstrip("。") == "≪パワー0またはブレイクしていないキャラクター≫のアタック宣言・ガード宣言を取り消す":
        nb = c.get("scopeBelow")
        out = []
        for sel in ({"power": {"op": "=", "n": 0}}, {"broken": False}):
            for k in ("noAttack", "noGuard"):
                if nb:
                    out.append({"kind": "always", "text": text, "mod": {"to": {"all": sel}, "key": k, "op": "grant", "value": True}, "cond": {"notBelowName": nb}})
                    out.append({"kind": "always", "text": text, "mod": {"to": {"all": dict(sel, notOwnCtl=True)}, "key": k, "op": "grant", "value": True}, "cond": {"belowName": nb}})
                else: out.append({"kind": "always", "text": text, "mod": {"to": {"all": sel}, "key": k, "op": "grant", "value": True}})
        return out
    if text.rstrip("。") == "このカードの使用宣言時に、勢力を1つ指定する":
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "nameFactionResist"}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "≪このキャラクター≫は、あなたがこのカードの使用宣言時に指定した勢力に対してのレジストを持つ": return []   # with the line above
    if text.rstrip("。") == "アタック宣言が行われている場合、≪このカード≫をファストカードのタイミングでセット宣言可能": c["fastIfAttack"] = True; return []
    if text.rstrip("。") == "このカードの下にカードがある場合、≪このキャラクター≫はインターセプトを得、エフェクト「1:≪このカード≫をオーナーの手札に戻す。」を得る":
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "skill", "op": "grant", "value": {"id": "intercept", "x": True}}, "cond": {"belowAny": True}},
                {"kind": "always", "text": text, "mod": {"to": "self", "key": "effect", "op": "grant", "value": {"cost": 1, "text": "1:≪このカード≫をオーナーの手札に戻す。", "steps": [{"a": "bounce", "to": "card"}], "status": "auto"}}, "cond": {"belowAny": True}}]
    if text.rstrip("。") == "あなたのメインフェイズ開始時に、≪あなた≫は1ドローする。その後、あなたの手札1枚を選んで捨て札する":
        return [{"kind": "trigger", "when": {"event": "phaseStart", "phase": "main", "mine": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "draw", "to": "you", "n": 1}, {"a": "discardTypeX", "types": ["Character", "Break", "Project", "Fast", "Permanent"]}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "このカードが捨て札される場合、プレイヤー全てにXダメージを与える":
        return [{"kind": "trigger", "when": {"event": "leave", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "damage", "to": "players", "n": "X"}], "x": {"evStat": "at"}, "status": "auto"}, "status": "auto"}]
    if text.startswith("あなたがこのカードの必要ファクターを満たしており、このカードのコストを支払える状態で、このカードがダメージ判定の結果あなたのダメージ置き場に置かれた場合、"): c["selfSetFromDamage"] = True; return []
    if text.rstrip("。") == "≪このキャラクター≫は、このキャラクター以外のあなたのテリトリーのマシンの持つスキル全てを持つ":
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "copyMachineSkills", "op": "grant", "value": True}}]
    if text.rstrip("。") == "メインフェイズ開始時に、≪あなたのテリトリーのマシン1人≫を捨て札する":
        return [{"kind": "trigger", "when": {"event": "phaseStart", "phase": "main"}, "optional": False, "text": text, "effect": {"steps": [{"a": "discardOwnPick", "anyArea": True, "sel": {"icons": ["マシン"]}}], "status": "auto"}, "status": "auto"}]
    # ---- M2e batch 5 (Revise#151) ----
    SK2 = {"インフィニティ": "infinity", "シールド": "shield", "オフェンシブ": "offensive", "ディフェンシブ": "defensive", "インターセプト": "intercept", "ペネトレイト": "penetrate", "ブレイクスルー": "breakthrough", "シンクロ": "synchro", "イニシアチブ": "initiative", "ステルス": "stealth"}
    if text.rstrip("。") == "≪このキャラクター≫は、このキャラクターを構成する、このカード以外のカードのスキル・エフェクト・アビリティ全てを持つ": c["inherit"] = {"all": True}; return []
    m = re.fullmatch(r"このキャラクターを構成するカードが(\d+)枚以上ある場合、≪このキャラクター≫はバインド0・インフィニティを得、バトルによるダメージを受けない。?", text)
    if m:
        cond = {"selfStackMin": int(m.group(1))}
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "skill", "op": "grant", "value": {"id": "bind", "x": 0, "set": True}}, "cond": cond}, {"kind": "always", "text": text, "mod": {"to": "self", "key": "skill", "op": "grant", "value": {"id": "infinity", "x": True}}, "cond": cond}, {"kind": "always", "text": text, "mod": {"to": "self", "key": "noDamage", "op": "grant", "value": {"battle": True}}, "cond": cond}]
    if text.rstrip("。").replace("ファクタ-", "ファクター") == "≪このキャラクター≫は、このカード以外の、このキャラクターを構成するカードの持つ分類全てと、そのカードの勢力のファクター1つを持つ":
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "stackAllIcons", "op": "grant", "value": True}}]
    m = re.fullmatch(r"場に(.+?)が(\d+)体以上存在する場合、≪((?:[^・≫]+)(?:・[^・≫]+)*)全て≫は、(インフィニティ|シールド|オフェンシブ|ディフェンシブ|インターセプト|ペネトレイト|ブレイクスルー|シンクロ|イニシアチブ|ステルス)を得る。?", text)
    if m and class_tokens(m.group(3)): return [{"kind": "always", "text": text, "mod": {"to": {"all": {"icons": class_tokens(m.group(3))}}, "key": "skill", "op": "grant", "value": {"id": SK2[m.group(4)], "x": True}}, "cond": {"countAtLeast": {"sel": {"tokenName": m.group(1)}, "n": int(m.group(2))}}}]
    m = re.fullmatch(r"このキャラクターにパーマネントカードがセットされている場合、≪このキャラクターのアタック宣言に対してガード宣言したキャラクター≫に、(\d+)ダメージを与える。?", text)
    if m: return [{"kind": "trigger", "when": {"event": "guarded", "self": True, "asAttacker": True}, "cond": {"selfHasPerm": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "damage", "to": "evCh", "n": int(m.group(1))}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "≪プレイヤー全て≫は、パーマネントカード・プロジェクトカード・ファストカードのコストを支払う場合、一度に1人のキャラクターからしか支払うことができない":
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "payOneChar", "op": "grant", "value": {"types": ["Permanent", "Project", "Fast"]}}}]
    if text.rstrip("。") == "≪プレイヤー全て≫は、パーマネントカード・プロジェクトカード・ファストカードのコストを支払う場合、そのカードと同じ勢力のキャラクターから支払うことができない":
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "noPaySameFaction", "op": "grant", "value": True}}]
    if text.rstrip("。") == "このカードがセットされたターンの終了時まで、≪このキャラクター≫の攻撃力に+Xする。Xはこのカードの下の、このカードと同じネームを持つカードの攻撃力の合計に等しい":
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "mod", "to": "self", "mod": {"key": "at", "op": "add", "value": {"xvar": True, "sign": 1}}, "until": "turn"}], "x": {"belowSameName": "at"}, "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "このカードの下にこのカードと同じネームを持つカードがある場合、1枚につき≪このキャラクター≫に+2/+2/+2する。2枚以上ある場合、≪このキャラクター≫はバインド1・インフィニティを得る":
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": k, "op": "add", "value": {"x": {"belowSameName": True}, "sign": 2}}} for k in ("se", "at", "de")] + [{"kind": "always", "text": text, "mod": {"to": "self", "key": "skill", "op": "grant", "value": v}, "cond": {"belowSameNameMin": 2}} for v in ({"id": "bind", "x": 1}, {"id": "infinity", "x": True})]
    m = re.fullmatch(r"このカードの下に[“\"]([^”\"]+)[”\"]がある場合、≪このキャラクター≫はバインド1・インターセプトを得、\+X/\+X/±0される。Xはこのカードの下にあるこのカードと同じネームを持つカード全ての本来のコストの合計に等しい。?", text)
    if m:
        cond = {"belowName": re.sub(r"\s+", "", m.group(1))}
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "skill", "op": "grant", "value": v}, "cond": cond} for v in ({"id": "bind", "x": 1}, {"id": "intercept", "x": True})] + [{"kind": "always", "text": text, "mod": {"to": "self", "key": k, "op": "add", "value": {"x": {"belowSameName": "cost"}, "sign": 1}}, "cond": cond} for k in ("se", "at")]
    if text.rstrip("。") == "このキャラクターがバトルする際、≪このキャラクター≫に±0/+X/+Xして判定する。Xはバトル相手のパワーに等しい":
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": k, "op": "add", "value": {"x": {"battleOppPower": True}, "sign": 1}}, "cond": {"self": "inBattle"}} for k in ("at", "de")]
    m = re.fullmatch(r"あなたの支配エリアに(.+?)のネームレベルキャラクターが(\d+)体以上いる場合、≪あなたの支配エリアの\1全て≫は(.+?)を得、\+(\d+)/\+(\d+)/\+(\d+)される。?", text)
    if m and class_tokens(m.group(1)):
        sel = {"owner": "you", "area": "controlled", "icons": class_tokens(m.group(1))}
        r0 = grant_all(sel, m.group(3), [int(m.group(g)) for g in (4, 5, 6)], {"countAtLeast": {"sel": dict(sel, named=True), "n": int(m.group(2))}}, text)
        if r0: return r0
    if text.rstrip("。") == "あなたのテリトリーに、ブレイクしているネームレベルキャラクターがいる場合、≪このキャラクター≫は+1/+1/+1され、このキャラクターがバトルする際、≪このキャラクターのバトル相手≫の持つスキル全てを無効化する":
        cond = {"countAtLeast": {"sel": {"owner": "you", "broken": True, "named": True}, "n": 1}}
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": k, "op": "add", "value": 1}, "cond": cond} for k in ("se", "at", "de")] + [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "battleOppSkillsOff", "op": "grant", "value": True}, "cond": cond}]
    if text.startswith("あなたの支配キャラクターが、支配キャラクターとのバトルまたは、あなた以外のプレイヤーの使用したカードの効果によって捨て札になる場合、≪あなた≫は1ドロー可能。捨て札になるキャラクターがネームを持っている場合、代わりに"):
        return [{"kind": "trigger", "when": {"event": "leave", "own": True, "controlled": True, "oppCause": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "drawOrSameName"}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "支配キャラクターとのバトルまたは対戦相手の使用した効果で、あなたの支配キャラクターが捨て札になる場合、≪あなたの任意のあなたの対戦相手1人≫にXダメージを与える。Xは捨て札になるキャラクターを構成するカード枚数に等しい":
        return [{"kind": "trigger", "when": {"event": "leave", "own": True, "controlled": True, "oppCause": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "pickOppDamage", "n": "evN"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪このキャラクターから支払われたアタックコスト・ガードコスト≫を、勢力・なし、(.+?)の、(.+?)、アビリティ「≪(.+?)全て≫に±0/\+1/\+1する。」を持つ(\d+)/(\d+)/(\d+)のあなたの支配キャラクター、(.+?)としてセットする。\7にカードをセットすることはできない。?", text)
    if m and class_tokens(m.group(1)) and class_tokens(m.group(3)):
        nm = m.group(7)
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "costToToken", "op": "grant", "value": {"name": nm, "icons": class_tokens(m.group(1)), "stats": {"se": int(m.group(4)), "at": int(m.group(5)), "de": int(m.group(6))}, "skills": [{"id": SK2[x], "x": True} for x in m.group(2).split("・") if x in SK2], "noSet": True, "noFaction": True}}}] + \
               [{"kind": "always", "text": text, "mod": {"to": {"all": {"icons": class_tokens(m.group(3))}}, "key": k, "op": "add", "value": {"x": {"countChars": {"tokenName": nm}}, "sign": 1}}} for k in ("at", "de")]
    # ---- M2e batch 7 (Revise#152) ----
    m = re.fullmatch(r"≪あなた≫の手札上限に([+\-])Xする。(Xは[^。]+に等しい)。?", text)
    if m and x_def(m.group(2)): return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "handLimit", "op": "add", "value": {"x": x_def(m.group(2)), "sign": -1 if m.group(1) == "-" else 1}}}]
    if re.fullmatch(r"このキャラクターがバトルする際、≪このキャラクターのバトル相手≫の持つスキル1つを無効化する。?", text):   # EX0439 (Revise#210)
        return [{"kind": "trigger", "when": {"event": "battleStart", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "skillOffPick", "to": "battleOpp", "until": "battle"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このキャラクターがバトルする際、≪このキャラクターのバトル相手にセットされているパーマネントカード(\d+)枚≫を捨て札(する|することが可能)。?", text)   # EX0443 (Revise#210)
    if m: return [{"kind": "trigger", "when": {"event": "battleStart", "self": True}, "optional": m.group(2) != "する", "text": text, "effect": {"steps": [{"a": "cardsOf", "to": "battleOpp", "part": "perm", "n": int(m.group(1)), "dest": "discard"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このキャラクターがバトルする際、≪このキャラクターのバトル相手にセットされているパワーカード(\d+|X)枚≫を捨て札する。?(Xは[^。]+に等しい)?。?", text)   # 2899
    if m and (m.group(1) != "X" or (m.group(2) and x_def(m.group(2)))):
        return [{"kind": "trigger", "when": {"event": "battleStart", "self": True}, "optional": False, "text": text, "effect": dict({"steps": [{"a": "cardsOf", "to": "battleOpp", "part": "power", "n": "X" if m.group(1) == "X" else int(m.group(1)), "dest": "discard"}], "status": "auto"}, **({"x": x_def(m.group(2))} if m.group(2) else {})), "status": "auto"}]
    m = re.fullmatch(r"あなたの支配エリアに“([^”]+)”がいる場合、≪手札のこのカード≫はサーチ\(異なるネームを持つブレイクカード(\d+)枚\)を持つ。?", text)   # 3118
    if m:
        c["condSearch"] = {"cond": {"count": {"sel": {"owner": "you", "area": "controlled", "name": re.sub(r"\s+", "", m.group(1))}, "op": ">=", "n": 1}}, "search": {"type": "Break", "n": int(m.group(2)), "distinct": True, "label": f"{m.group(2)} Break cards with different names"}}
        return []
    m = re.fullmatch(r"あなたのメインフェイズ開始時に、あなた以外のプレイヤーの支配キャラクタ[ー\-](X|\d+)体を指定する。メインフェイズ終了時まで、≪あなたの支配キャラクター全て≫は指定したキャラクターを目標にアタック宣言可能。その際、アタック目標となったキャラクター以外のキャラクターは、ガード宣言することができない。(Xは[^。]+に等しい)?。?", text)
    if m and (m.group(1) != "X" or (m.group(2) and x_def(m.group(2)))):
        return [{"kind": "trigger", "when": {"event": "phaseStart", "phase": "main", "mine": True}, "optional": False, "text": text, "effect": dict({"steps": [{"a": "designateAttackable", "n": "X" if m.group(1) == "X" else int(m.group(1)), "noGuard": True}], "status": "auto"}, **({"x": x_def(m.group(2))} if m.group(2) else {})), "status": "auto"}]
    if text.rstrip("。") == "ガード宣言またはブレイクカードのセット宣言が行われている場合、≪このカード≫をファストカードのタイミングでセット宣言可能": c["fastIfGuardBreak"] = True; return []   # 3790
    m = re.fullmatch(r"このキャラクターに(.+?)が(\d+)枚以上セットされている場合、≪このキャラクター≫はバインド(\d+)を得る。?", text)   # 2977
    if m and m.group(1) in ("コントラクトリング", "アームユニット"): return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "skill", "op": "grant", "value": {"id": "bind", "x": int(m.group(3)), "set": True}}, "cond": {"permTokenMin": {"name": m.group(1), "n": int(m.group(2))}}}]
    m = re.fullmatch(r"このキャラクターが、バトルまたはこのカードに書かれているアビリティの効果で支配キャラクターを捨て札した場合、≪あなたのデッキの一番上のカード1枚≫を、\+(\d+)/\+(\d+)/\+(\d+)するパーマネントカード・(.+?)としてこのキャラクターにセットする。?", text)   # 3302
    if m: return [{"kind": "trigger", "when": {"event": "leave", "controlled": True, "bySelf": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "deckTopPermToken", "token": {"name": m.group(4), "stats": {"se": int(m.group(1)), "at": int(m.group(2)), "de": int(m.group(3))}}}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪このキャラクターから支払われたアタックコスト・ガードコスト≫を、勢力(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)、(.+?)の(.+?)を持つ(\d+)/(\d+)/(\d+)のあなたの支配キャラクター、(.+?)としてセットする。?", text)   # 3793
    if m and class_tokens(m.group(2)) and skills_list(m.group(3)):
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "costToToken", "op": "grant", "value": {"name": m.group(7), "faction": FACTION_JP[m.group(1)], "icons": class_tokens(m.group(2)), "stats": {"se": int(m.group(4)), "at": int(m.group(5)), "de": int(m.group(6))}, "skills": skills_list(m.group(3)), "kinds": ["attack", "guard"]}}}]
    m = re.fullmatch(r"≪ガード宣言した対戦相手の支配キャラクター≫に、(\d+)ダメージを与える。?", text)   # 3794 (Revise#152): whenever an opponent's Controlled Character declares a guard
    if m: return [{"kind": "trigger", "when": {"event": "guarded", "guardSel": {"owner": "opp", "area": "controlled"}}, "optional": False, "text": text, "effect": {"steps": [{"a": "damage", "to": "evCh", "n": int(m.group(1))}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカードの下に[“\"]([^”\"]+)[”\"]がある場合、≪このキャラクター≫はバインド(\d+)を得、(.+)", text)   # Revise#152: the A3-24 “partner” Break cards
    if m:
        cond = {"belowPName": re.sub(r"\s+", "", m.group(1))}
        rest = m.group(3).strip()
        tries = [rest] if rest.startswith(("≪", "このキャラクター", "あなた")) else []
        tries += ["≪このキャラクター≫は" + rest, "≪このキャラクター≫は、" + rest]
        sub = None
        bind_ab = {"kind": "always", "text": text, "mod": {"to": "self", "key": "skill", "op": "grant", "value": {"id": "bind", "x": int(m.group(2))}}, "cond": cond}
        im = re.fullmatch(r"このカードの下の“([^”]+)”のスキル・エフェクト全てを持つ。?", rest)   # 3394
        if im: c["inherit"] = {"name": re.sub(r"\s+", "", im.group(1)), "min": 1}; return [bind_ab]
        am = re.fullmatch(r"≪あなた≫は、手札の(.+?)のブレイクカードを、コストを支払ってあなたの支配キャラクターとしてセット宣言可能。?", rest)   # 3573
        if am and class_tokens(am.group(1).replace("または", "/")): return [bind_ab, {"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "breakAsChar", "op": "grant", "value": {"icons": class_tokens(am.group(1).replace("または", "/"))}}, "cond": cond}]
        em = re.fullmatch(r"((?:エフェクト)?(?:「[^」]+」)+)を持つ。?((?:Xは[^。]+に等しい)。?)?", rest)
        if em:
            xs = em.group(2) or ""
            parts = re.findall(r"「([^」]+)」", em.group(1))
            gs = [gained_effect("≪このキャラクター≫はエフェクト「" + (p0.rstrip("。") + "。" + xs if xs and "X" in p0 else p0) + "」を得る。") for p0 in parts]
            if all(gs): sub = [x for g in gs for x in g]
        for t in ([] if sub else tries):
            sub = parse_ability(t, c)
            if sub: break
        if sub:
            def addc(ab):
                ab = dict(ab, text=text)
                old = ab.get("cond")
                ab["cond"] = cond if not old else {"all": [cond, old]}
                return ab
            return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "skill", "op": "grant", "value": {"id": "bind", "x": int(m.group(2))}}, "cond": cond}] + [addc(x) for x in sub]
    m = re.fullmatch(r"このキャラクターがアタック宣言・ガード宣言した場合、≪このキャラクターのアタック目標またはガード宣言されたキャラクターのオーナー≫に(X|\d+)ダメージを与える。?(Xは[^。]+に等しい)?。?", text)   # 3430
    if m and (m.group(1) != "X" or (m.group(2) and x_def(m.group(2)))):
        return [{"kind": "trigger", "when": {"event": "battleDeclared", "self": True}, "optional": False, "text": text, "effect": dict({"steps": [{"a": "battleSideOwnerHit", "mode": "declared", "n": "X" if m.group(1) == "X" else int(m.group(1))}], "status": "auto"}, **({"x": x_def(m.group(2))} if m.group(2) else {})), "status": "auto"}]
    m = re.fullmatch(r"≪このキャラクターのアタック宣言に対してガード宣言するか、このキャラクターにガード宣言されたキャラクターのオーナー≫に(X|\d+)ダメージを与える。?(Xは[^。]+に等しい)?。?", text)   # 3430
    if m and (m.group(1) != "X" or (m.group(2) and x_def(m.group(2)))):
        return [{"kind": "trigger", "when": {"event": "guarded", "self": True}, "optional": False, "text": text, "effect": dict({"steps": [{"a": "battleSideOwnerHit", "mode": "guarded", "n": "X" if m.group(1) == "X" else int(m.group(1))}], "status": "auto"}, **({"x": x_def(m.group(2))} if m.group(2) else {})), "status": "auto"}]
    if text.rstrip("。") == "このキャラクターが代わりにコストを支払ってあなたの支配キャラクターをアタック宣言させた場合、≪そのアタック宣言に対してガード宣言するキャラクター≫のガードコストは1上昇する":   # 3573
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "guardTaxIfPaid", "op": "grant", "value": True}}]
    if text.rstrip("。") == "このキャラクターから支払われたブーストのコスト1につき、≪このキャラクターのアタック宣言に対してガードするキャラクター≫の追加のガードコストは1上昇する":   # 3390
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "boostGuardTax", "op": "grant", "value": True}}]
    if text.rstrip("。") == "このキャラクターが代わりにコストを支払ってアタック宣言またはガード宣言しているキャラクターがダメージを与える場合、≪そのキャラクター≫の攻撃力に+Xして判定する。その後、≪そのキャラクター≫を捨て札する。Xはあなたのダメージ置き場のカード枚数に等しい":   # 3263
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "subPayBoost", "op": "grant", "value": True}}]
    if text.rstrip("。") == "あなたがドローをする場合、≪あなた≫は、ドローをする代わりにあなたのデッキからカード1枚を選び、手札に加えることが可能":   # 3723
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "drawTutor", "op": "grant", "value": True}}]
    if text.rstrip("。") == "≪対戦相手全て≫は、ドローしたカードを公開する":   # 3685
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "opponents"}, "key": "revealDraws", "op": "grant", "value": True}}]
    if text.rstrip("。") == "≪手札の上限を超えてドローしたプレイヤー≫の手札から、手札の枚数が手札上限に等しくなるまで、あなたの任意のカードを捨て札する":   # 3685
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "overDrawDiscard", "op": "grant", "value": True}}]
    m = re.fullmatch(r"≪対戦相手全て≫のダメージ置き場のカード枚数による敗北条件に-X枚する。(Xは[^。]+に等しい)。?", text)   # 3650
    if m and x_def(m.group(1)): return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "lossMinusOpp", "op": "grant", "value": x_def(m.group(1))}}]
    if text.rstrip("。") == "メインフェイズ終了時に、≪このキャラクターを構成する、このカードと同じ名称のカード全て≫をオーナーの手札に戻す":   # 3498
        return [{"kind": "trigger", "when": {"event": "phaseEnd", "phase": "main"}, "optional": False, "text": text, "effect": {"steps": [{"a": "sameJpStackToHand"}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "≪手札以外からセットされたキャラクターカード・ブレイクカード≫を捨て札する":   # 3718
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "nonHandSetDiscard", "op": "grant", "value": True}}]
    m = re.fullmatch(r"≪ダメージ置き場にプロジェクトカードまたはファストカードが置かれたプレイヤー≫に、(X|\d+)ダメージを与える。?(Xは[^。]+に等しい)?。?", text)   # 3424
    if m and (m.group(1) != "X" or (m.group(2) and x_def(m.group(2)))):
        return [{"kind": "trigger", "when": {"event": "toDamagePile", "types": ["Project", "Fast"]}, "optional": False, "text": text, "effect": dict({"steps": [{"a": "damage", "to": "evPlayer", "n": "X" if m.group(1) == "X" else int(m.group(1))}], "status": "auto"}, **({"x": x_def(m.group(2))} if m.group(2) else {})), "status": "auto"}]
    if text.rstrip("。") == "≪プロジェクトカードまたはファストカードを使用宣言したプレイヤー≫は、自分のデッキの上から、そのカードのコストに等しい枚数のカードをそのオーナーのダメージ置き場に置く":   # 3424
        return [{"kind": "trigger", "when": {"event": "cardDeclared", "types": ["Project", "Fast"]}, "optional": False, "text": text, "effect": {"steps": [{"a": "mill", "to": "evPlayer", "n": "X", "zone": "damage"}], "x": {"evStat": "cost"}, "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"支払ったコストの中にこのカードがあった場合、≪あなた≫は、あなたの支配キャラクターにセットされているパワーカードを(\d+)枚捨て札することで、このカードを、コストを無視してあなたのテリトリーのキャラクターにセット宣言可能。?", text)   # 3342
    if m: c["costRescue"] = {"discard": int(m.group(1))}; return []
    m = re.fullmatch(r"このカードを手札からセット宣言する場合、(ブレイクしていない)?キャラクタ[ー\-]1人を指定し、追加でXコスト支払うことが可能。そうした場合、このカードがセットされた際に、≪指定したキャラクタ[ー\-]1人≫を捨て札する。Xは指定したキャラクターのパワーに等しい。?", text)   # 3153 / 3154
    if m:
        c["kicker"] = {"designate": True, "unbroken": bool(m.group(1))}
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "kickDiscard"}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "このカードをセット宣言する場合、追加でXコスト支払うことが可能。そうした場合、このカードがセットされた際に、≪あなた≫は、あなたのデッキをコストがXに等しいプロジェクトカードが公開されるまで上から順に公開し、そのプロジェクトカードを、必要ファクターとコストを無視して使用宣言する。その後、そのデッキをシャッフルする":   # 3684
        c["kicker"] = {"x": True}
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "kickProject"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"捨て札置き場にパーマネントカードが置かれた場合、≪そのオーナー≫に(X|\d+)ダメージを与える。?(Xは[^。]+に等しい)?。?", text)   # 3192
    if m and (m.group(1) != "X" or (m.group(2) and x_def(m.group(2)))):
        return [{"kind": "trigger", "when": {"event": "toDamagePile", "zone": "discard", "types": ["Permanent"]}, "optional": False, "text": text, "effect": dict({"steps": [{"a": "damage", "to": "evPlayer", "n": "X" if m.group(1) == "X" else int(m.group(1))}], "status": "auto"}, **({"x": x_def(m.group(2))} if m.group(2) else {})), "status": "auto"}]
    if text.rstrip("。") == "≪あなたと、あなたのダメージ置き場と捨て札置き場にあるカード全て≫は、あなたの対戦相手のカードの効果を受けない":   # 3264
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "playerImmune", "op": "grant", "value": {"byOpp": True}}}, {"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "pileImmune", "op": "grant", "value": True}}]
    if text.rstrip("。").replace("：", ":") == "≪キャラクター全て≫に、エフェクト「0:このキャラクターを捨て札する。この効果でこのキャラクターが捨て札になる場合、≪あなた≫は1ドローする。」を与える":   # 3155
        ef = {"cost": 0, "text": "0:このキャラクターを捨て札する。この効果でこのキャラクターが捨て札になる場合、≪あなた≫は1ドローする。", "steps": [{"a": "discard", "to": "self"}, {"a": "draw", "to": "you", "n": 1}], "status": "auto"}
        return [{"kind": "always", "text": text, "mod": {"to": {"all": {}}, "key": "effect", "op": "grant", "value": ef}}]
    m = re.fullmatch(r"このキャラクターがバトル相手の支配キャラクターにダメージを与えた場合、そのバトル終了時に、≪このキャラクターのバトル相手のオーナー≫は、キャラクターカードが勢力エリアにX枚セットされるまでダメージ判定を行う。このダメージ判定で出たキャラクターカード以外のカードは、ダメージ置き場に置かれずに捨て札される。(Xは[^。]+に等しい)。?", text)   # 3011
    if m and x_def(m.group(1)): return [{"kind": "trigger", "when": {"event": "damaged", "byThis": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "flipUntilChars", "n": "X"}], "x": x_def(m.group(1)), "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このキャラクターがバトルまたはプレイヤーにアタックする場合、あなたの手札の(.+?)を持つカード1枚を捨て札可能。そうした場合、≪このキャラクター≫は捨て札したカードのスキル全てを持ち、そのカードの本来の能力値を合計して判定する。?", text)   # 2940
    if m and class_tokens(m.group(1).replace("または", "/")):
        st = {"steps": [{"a": "discardMerge", "icons": class_tokens(m.group(1).replace("または", "/"))}], "status": "auto"}
        return [{"kind": "trigger", "when": {"event": "battleStart", "self": True}, "optional": False, "text": text, "effect": st, "status": "auto"}, {"kind": "trigger", "when": {"event": "attack", "self": True, "toPlayer": True}, "optional": False, "text": text, "effect": st, "status": "auto"}]
    if text.rstrip("。") == "このカードがセットされた場合、≪あなたの手札のパーマネントカード2枚まで≫をこのキャラクターにセット可能":   # 3122
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "handPermsOnto", "n": 2}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "このカードを同じネームを持つカードにセットするか、このキャラクターに同じネームを持つカードをセットする場合、≪そのブレイクカードのコスト≫をこのキャラクターにパワーカードとしてセットする":   # 3191
        c["sameNameCostPower"] = True; return []
    if text.rstrip("。") == "≪分類鬼・鬼♂を持つか、カードテキストに分類鬼・鬼♂を含むカード≫のコストは1減少する":   # 3229
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "cardCost", "op": "add", "value": {"n": -1, "sel": {"iconsOrText": ["鬼", "鬼♂"]}, "minCost": 0}}}]
    m = re.fullmatch(r"このカードがセットされた場合、≪あなたの捨て札置き場にある、コスト(X|\d+)以下の、分類鬼・鬼♂を持つか、カードテキストに分類鬼・鬼♂を含むカード全て≫を公開する。その後、その中のネームを持たないブレイクカード全てをあなたの支配キャラクターとしてセットし、残りのカード全てをあなたの手札に戻す。(Xは[^。]+に等しい)?。?", text)   # 3229
    if m and (m.group(1) != "X" or (m.group(2) and x_def(m.group(2)))):
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": dict({"steps": [{"a": "oniRecall", "costMax": "X" if m.group(1) == "X" else int(m.group(1)), "icons": ["鬼", "鬼♂"]}], "status": "auto"}, **({"x": x_def(m.group(2))} if m.group(2) else {})), "status": "auto"}]
    if text.rstrip("。") == "≪このキャラクター≫は、このキャラクターの持つ▼またはリムーブXのスキル1つにつき、チャージ1・パーマネント+1を得る":   # 3266
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "perAggRemove", "op": "grant", "value": True}}]
    if text.rstrip("。") == "このカードがセットされた場合、≪あなたの手札の▼またはリムーブXのスキルを持つパーマネントカード1枚≫をこのキャラクターにセット可能":   # 3266
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "handPermsOnto", "n": 1, "aggRemove": True}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "≪あなた≫は、このキャラクターに、▼またはリムーブXのスキルを持つパーマネントカードを、必要ファクターを無視してセット宣言可能":   # 3266
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "permNoFactor", "op": "grant", "value": {"aggRemove": True}}}]
    if text.rstrip("。") == "≪このキャラクター≫の持つリムーブXのスキルの支払いは、あなたのデッキの上から、カードをリムーブXの数値に等しい枚数捨て札することで、支払ったものとして扱う":   # 3266
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "removeByMill", "op": "grant", "value": True}}]
    if text.rstrip("。") == "≪あなた≫は、このキャラクターに、ファストカードのタイミングで必要ファクターを無視してパーマネントカードをセット宣言可能":   # 3652
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "fastPerm", "op": "grant", "value": True}}, {"kind": "always", "text": text, "mod": {"to": "self", "key": "permNoFactor", "op": "grant", "value": {}}}]
    if text.rstrip("。") == "≪このキャラクターにセットされているパーマネントカード≫の精神力・攻撃力・耐久力の欄に書かれた修正値は2倍になる":   # 3652
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "permDouble", "op": "grant", "value": True}}]
    if text.rstrip("。") == "このキャラクターの持つリムーブXのスキルの支払いを行わなかった場合、勢力エリアに移動する代わりに、≪あなたの手札とあなたのデッキ全て≫を捨て札する":   # 3686
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "removeFailDump", "op": "grant", "value": True}}]
    if text.rstrip("。") == "≪プレイヤー全て≫は、鬼・鬼♂にパーマネントカードをセット宣言する場合、そのカードのコストは1減少し、ファストカードのタイミングでセット宣言可能。この効果で、コストは1未満にはならない":   # 3495
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "permOntoDiscount", "op": "grant", "value": {"icons": ["鬼", "鬼♂"]}}}, {"kind": "always", "text": text, "mod": {"to": {"all": {"icons": ["鬼", "鬼♂"]}}, "key": "fastPerm", "op": "grant", "value": True}}]
    m = re.fullmatch(r"このカードがセットされた場合、≪あなたのデッキの一番上のカード1枚≫を、勢力(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)、(.+?)の、(.+?)、アビリティ「≪このキャラクター≫が“([^”]+)”とシンクロする場合、アタックコスト・ガードコストを無視することが可能。」を持つ(\d+)/(\d+)/(\d+)のあなたの支配キャラクター、“([^”]+)”としてセット可能。?", text)   # 3534
    if m and class_tokens(m.group(2)) and skills_list(m.group(3)):
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "deckTopToken", "name": m.group(8), "faction": FACTION_JP[m.group(1)], "icons": class_tokens(m.group(2)), "skills": skills_list(m.group(3)), "stats": {"se": int(m.group(5)), "at": int(m.group(6)), "de": int(m.group(7))}, "freeJoinWith": re.sub(r"\s+", "", m.group(4))}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカードがセットされた場合、≪あなたのダメージ置き場または捨て札置き場にある、ネームを持たない(.+?)を持つキャラクターカード1枚またはあなたが必要ファクターを満たしている、ネームを持たない\1を持つブレイクカード1枚≫を、あなたの支配キャラクターとしてセット可能。?", text)   # 3611
    if m and class_tokens(m.group(1)): return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "pickRevive", "icons": class_tokens(m.group(1))}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカードがセットされた場合、≪このカードのコストとして支払ったカード≫を、勢力なし、分類・(.+?)、(.+?)を持つ(\d+)/(\d+)/(\d+)のあなたの支配キャラクター、(.+?)としてセットする。?", text)   # 3614
    if m and skills_list(m.group(2)):
        c["costTokenOnSet"] = {"name": m.group(6), "icons": class_tokens(m.group(1)) or [m.group(1)], "skills": skills_list(m.group(2)), "stats": {"se": int(m.group(3)), "at": int(m.group(4)), "de": int(m.group(5))}}
        return []
    if text.rstrip("。") == "このキャラクターがバトルする際、≪このキャラクターのバトル相手を対象に含むプロジェクトカード・ファストカード・エフェクト≫を無効化する":   # 3651
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "negateVsOpp", "op": "grant", "value": True}}]
    if text.rstrip("。") == "このカードに書かれたエフェクトが処理された場合、≪このカード≫を手札に戻す":   # 3721
        c["bounceAfterEffect"] = True; return []
    m = re.fullmatch(r"対戦相手のテリトリーにブレイクしているキャラクターがいる場合、≪あなた≫はこのカードの必要ファクターとコストを無視して(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のキャラクターにセット宣言可能。?", text)   # 3754
    if m: c["freeIf"] = {"oppBroken": True, "normal": True, "faction": FACTION_JP[m.group(1)]}; return []
    m = re.fullmatch(r"対戦相手のテリトリーにネームレベルキャラクターが(\d+)体以上いる場合、≪あなた≫は、このカードを、ファストカードのタイミングでネームを持たないキャラクターにセット宣言可能。この効果でセットされた場合、≪(.+?)を持たないキャラクター全て≫を捨て札可能。?", text)   # 3795
    if m and class_tokens(m.group(2)):
        c["fastIfOppNamed"] = int(m.group(1))
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "cond": {"fastDecl": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "discard", "to": {"all": {"notIcons": class_tokens(m.group(2))}}}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカードが場から捨て札になる場合、このカードをダメージ置き場に置く。そうした場合、次のターンのターン終了時まで、≪(.+?)を持たないキャラクター全て≫のスキル・エフェクト・アビリティ全てを無効化する。?", text)   # 3810
    if m and class_tokens(m.group(1)):
        return [{"kind": "trigger", "when": {"event": "leave", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "selfCardToDamage"}, {"a": "field", "mod": {"to": {"all": {"notIcons": class_tokens(m.group(1))}}, "key": "negate", "op": "grant", "value": {"skills": True, "effects": True}, "until": "nextTurn"}}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このキャラクターに効果を発揮している各勢力のプロジェクトカード・ファストカード1枚につき、≪このキャラクター≫は以下の能力を得る。?(.*)", text)   # 3792
    if m: return []   # the table of the next lines is read below (c["lastingTable"])
    if text.rstrip("。") == "このカードがセットされた場合、♂の分類を持つカードのネームを1つ指定する":   # 3758
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "nameMalePick"}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "≪このキャラクター≫は、指定したネームと♂の分類を持つキャラクターとのバトルによるダメージを受けない":   # 3758
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "noDamage", "op": "grant", "value": {"battle": True, "fromSel": {"male": True, "chosenName": True}}}}]
    m = re.fullmatch(r"≪指定したネームと♂の分類を持つあなたの支配キャラクター≫は、(.+?)を得る。?", text)   # 3758
    if m and skills_list(m.group(1)): return [{"kind": "always", "text": text, "mod": {"to": {"all": {"owner": "you", "area": "controlled", "male": True, "chosenName": True}}, "key": "skill", "op": "grant", "value": x}} for x in skills_list(m.group(1))]
    m = re.fullmatch(r"このカードの下に“([^”]+)”がある場合、このカードの下にあるこのカードと同じネームを持つカード1枚につき、≪このキャラクター≫は\+(\d+)/\+(\d+)/\+(\d+)され、エフェクト「(.+)」を持つ。?", text)   # 3572
    if m:
        cond = {"belowPName": re.sub(r"\s+", "", m.group(1))}
        g = gained_effect("≪このキャラクター≫はエフェクト「" + m.group(5) + "」を得る。")
        if g:
            out = [{"kind": "always", "text": text, "mod": {"to": "self", "key": k, "op": "add", "value": {"x": {"belowSameName": True}, "sign": 1, "per": int(m.group(i))}}, "cond": cond} for k, i in (("se", 2), ("at", 3), ("de", 4))]
            return out + [dict(x, text=text, cond=cond) for x in g]
    m = re.fullmatch(r"≪あなた以外のプレイヤー全て≫は、手札からカードを使用宣言する場合、追加でXコストを支払わなければならない。追加のコストを支払う場合、代わりに、そのカードの本来のコスト分、自分のデッキを捨て札することが可能。(Xは[^。]+に等しい)。?", text)   # 3616 (Q#59: the "mill instead" choice is a declare option)
    if m and x_def(m.group(1)): return [{"kind": "always", "text": text, "mod": {"to": {"players": "opponents"}, "key": "cardCost", "op": "add", "value": {"n": {"x": x_def(m.group(1)), "sign": 1}, "sel": {}, "fromHand": True, "millAlt": True}}}]
    if text.rstrip("。") == "≪キャラクターを対象とする、範囲のプロジェクトカード・ファストカード≫は、このキャラクターにのみ効果を発揮する":   # 0233
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "areaRod", "op": "grant", "value": True}}]
    m = re.fullmatch(r"このキャラクターがイニシアチブを(\d+)つ以上持つ場合、≪このキャラクター≫はガードされない。?", text)   # Q#56 (Revise#155)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "unguardableInit", "op": "grant", "value": int(m.group(1))}}]
    if text.rstrip("。") == "≪あなた≫は、プロジェクトカード・ファストカード・エフェクトが効果を発揮する際に、そのカードの対象を適正な対象に変更することが可能":   # Q#58 (3537)
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "retargetAny", "op": "grant", "value": True}}]
    if text.rstrip("。") == "あなた、またはあなたの支配キャラクターを対象に含むプロジェクトカードが効果を発揮する際、≪そのカードの対象に含まれる、あなたの任意のプレイヤー全てと、あなたの任意のキャラクター全て≫はそのカードの効果を受けない":   # Q#58 (3537)
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "projShield", "op": "grant", "value": True}}]
    m = re.fullmatch(r"このキャラクター以外のあなたの支配キャラクターが(ガードして)?バトルする場合、≪このキャラクター≫は、そのキャラクターと同時にバトルすることが可能。その際、≪バトル相手とバトルするあなたの支配キャラクター全て≫は、スキルを共有し、攻撃力を合計して判定する。バトルによって与えられる、それらの耐久力を合計した数値未満の通常ダメージは無効化され、精神ダメージはそれぞれのキャラクターに与えられる。このキャラクターがこのアビリティの効果でバトルする場合、あなたのデッキの上からカード1枚を捨て札する。?", text)   # Q#57 (3461 / 3462)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "jointBattle", "op": "grant", "value": {"guardOnly": bool(m.group(1))}}}]
    # ---- M2g batch 1 (Revise#157) ----
    m = re.fullmatch(r"≪(?:このキャラクター|あなたの支配エリアの“([^”]+)”)≫に与えられるダメージに[ー−\-]\((\d+)\)して判定する。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self" if not m.group(1) else {"all": {"owner": "you", "area": "controlled", "name": re.sub(r"\s+", "", m.group(1))}}, "key": "dmgReduce", "op": "add", "value": {"mental": int(m.group(2))}}}]
    m = re.fullmatch(r"≪あなた≫に与えられるダメージに-(\d+)(?:・ー\((\d+)\))?して判定する。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "playerDmgReduce", "op": "add", "value": {"n": int(m.group(1))}}}]
    m = re.fullmatch(r"あなたのディスカードフェイズ開始時に、≪あなた≫は(\d+)ドローする。?", text)
    if m: return [{"kind": "trigger", "when": {"event": "phaseStart", "phase": "discard", "mine": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "draw", "to": "you", "n": int(m.group(1))}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪あなた以外のプレイヤーの使用する(プロジェクト|ファスト)カード≫のコストは(\d+)上昇する。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"players": "opponents"}, "key": "cardCost", "op": "add", "value": {"n": int(m.group(2)), "sel": {"types": [{"プロジェクト": "Project", "ファスト": "Fast"}[m.group(1)]]}}}}]
    m = re.fullmatch(r"≪このキャラクター≫は、?“([^”]+)”を目標にアタック宣言可能。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"all": {"name": re.sub(r"\s+", "", m.group(1))}}, "key": "attackableBy", "op": "grant", "value": {"srcSelf": True}}}]
    m = re.fullmatch(r"このカードがセットされた場合、≪あなたの捨て札置き場の「([^」]+)」全て≫を手札に戻す。?", text)
    if m: return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "pickZone", "zone": "discard", "owner": "you", "sel": {"jp": m.group(1)}, "n": "all", "dest": "hand"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカードがセットされた場合、≪あなたのデッキ≫から「([^」]+)」1枚を手札に加える。?", text)
    if m: return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "search", "to": "you", "sel": {"jp": m.group(1)}, "n": 1}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカードがセットされた場合、≪あなたのデッキ≫から(?:“([^”]+)”のネームを持つ|(.+?)を持つ)ブレイクカード1枚を手札に加えることが可能。?", text)
    if m and (m.group(1) or class_tokens(m.group(2)) or True):
        sel = {"type": "Break", "name": re.sub(r"\s+", "", m.group(1))} if m.group(1) else {"type": "Break", "icons": class_tokens(m.group(2)) or [m.group(2)]}
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "search", "to": "you", "sel": sel, "n": 1}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"対戦相手のテリトリーにネームレベルキャラクターがいる場合、≪このキャラクター≫に\+(\d+)/\+(\d+)/\+(\d+)する。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": k, "op": "add", "value": int(m.group(i))}, "cond": {"count": {"sel": {"owner": "opp", "named": True}, "op": ">=", "n": 1}}} for k, i in (("se", 1), ("at", 2), ("de", 3)) if int(m.group(i))]
    m = re.fullmatch(r"このキャラクターにパーマネントカードがセットされていない場合、≪このキャラクター≫の攻撃力に\+(\d+)する。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "at", "op": "add", "value": int(m.group(1))}, "cond": {"selfNoPerm": True}}]
    m = re.fullmatch(r"このキャラクターにセットされているパーマネントカード1枚につき、≪このキャラクター≫は\+(\d+)/\+(\d+)/\+(\d+)される。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": k, "op": "add", "value": {"x": {"permCount": True}, "sign": 1, "per": int(m.group(i))}}} for k, i in (("se", 1), ("at", 2), ("de", 3)) if int(m.group(i))]
    m = re.fullmatch(r"このキャラクターを構成する“([^”]+)”1枚につき、≪このキャラクター≫に\+(\d+)/\+(\d+)/\+(\d+)する。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": k, "op": "add", "value": {"x": {"selfNamed": re.sub(r"\s+", "", m.group(1))}, "sign": 1, "per": int(m.group(i))}}} for k, i in (("se", 2), ("at", 3), ("de", 4)) if int(m.group(i))]
    m = re.fullmatch(r"このカードの下にある、?“([^”]+)”が描かれているカード1枚につき、≪このキャラクター≫に\+(\d+)/\+(\d+)/\+(\d+)する。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": k, "op": "add", "value": {"x": {"belowDrawn": re.sub(r"\s+", "", m.group(1))}, "sign": 1, "per": int(m.group(i))}}} for k, i in (("se", 2), ("at", 3), ("de", 4)) if int(m.group(i))]
    m = re.fullmatch(r"≪このキャラクター≫に\+X/\+X/\+Xする。Xはこのカードの下にある“([^”]+)”が描かれているカード枚数に等しい。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": k, "op": "add", "value": {"x": {"belowDrawn": re.sub(r"\s+", "", m.group(1))}, "sign": 1}}} for k in ("se", "at", "de")]
    m = re.fullmatch(r"≪(?:このキャラクター|あなたの支配エリアの“([^”]+)”)≫は、?(?:あなた以外のプレイヤー|対戦相手)の?使用した(プロジェクトカード|プロジェクトカード・ファストカード)の効果を受けない。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self" if not m.group(1) else {"all": {"owner": "you", "area": "controlled", "name": re.sub(r"\s+", "", m.group(1))}}, "key": "untargetable", "op": "grant", "value": {"from": ["Project"] if m.group(2) == "プロジェクトカード" else ["Project", "Fast"], "byOpp": True}}}]
    m = re.fullmatch(r"≪このキャラクター≫は、?対戦相手が使用したプロジェクトカード・ファストカードの効果を受けない。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "untargetable", "op": "grant", "value": {"from": ["Project", "Fast"], "byOpp": True}}}]
    m = re.fullmatch(r"≪このキャラクター≫は、?あなた以外のプレイヤーが使用したカードの効果を受けない。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "untargetable", "op": "grant", "value": {"from": ["Project", "Fast", "Effect", "Break"], "byOpp": True}}}]
    m = re.fullmatch(r"≪このキャラクター≫は対戦相手の使用したプロジェクトカード・ファストカード・エフェクトの目標にならない。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "untargetable", "op": "grant", "value": {"from": ["Project", "Fast", "Effect"], "byOpp": True}}}]
    m = re.fullmatch(r"≪カード名称に「([^」]+)」を含むあなたの支配キャラクター全て≫に(.+?)を与え、\+(\d+)/\+(\d+)/\+(\d+)する。?", text)
    if m and skills_list(m.group(2)):
        sel = {"all": {"owner": "you", "area": "controlled", "jpHas": m.group(1)}}
        return [{"kind": "always", "text": text, "mod": {"to": sel, "key": "skill", "op": "grant", "value": x}} for x in skills_list(m.group(2))] + [{"kind": "always", "text": text, "mod": {"to": sel, "key": k, "op": "add", "value": int(m.group(i))}} for k, i in (("se", 3), ("at", 4), ("de", 5)) if int(m.group(i))]
    m = re.fullmatch(r"≪このキャラクター以外の、あなたの支配エリアのカード名称に「([^」]+)」を含むキャラクター全て≫に、?(.+?)を与える。?", text)
    if m and skills_list(m.group(2)): return [{"kind": "always", "text": text, "mod": {"to": {"all": {"owner": "you", "area": "controlled", "jpHas": m.group(1), "notSelf": True}}, "key": "skill", "op": "grant", "value": x}} for x in skills_list(m.group(2))]
    m = re.fullmatch(r"≪(.+?)を持つあなたの支配キャラクター全て≫に\+(\d+)/\+(\d+)/\+(\d+)する。?", text)
    if m and (class_tokens(m.group(1)) or re.fullmatch(r"[^\s≪≫、]{2,10}", m.group(1))):
        sel = {"all": {"owner": "you", "area": "controlled", "icons": class_tokens(m.group(1)) or [m.group(1)]}}
        return [{"kind": "always", "text": text, "mod": {"to": sel, "key": k, "op": "add", "value": int(m.group(i))}} for k, i in (("se", 2), ("at", 3), ("de", 4)) if int(m.group(i))]
    m = re.fullmatch(r"このキャラクターがアタック宣言・ガード宣言した場合、≪このキャラクター以外のキャラクター全て≫に(\d+)ダメージを与える。?", text)
    if m: return [{"kind": "trigger", "when": {"event": "battleDeclared", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "damage", "to": {"all": {"notSelf": True}}, "n": int(m.group(1))}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"あなたの支配エリアに♂のネームレベルキャラクターが(\d+)体以上いる場合、≪このキャラクター≫はインフィニティを得る。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "skill", "op": "grant", "value": {"id": "infinity", "x": True}}, "cond": {"count": {"sel": {"owner": "you", "area": "controlled", "named": True, "male": True}, "op": ">=", "n": int(m.group(1))}}}]
    m = re.fullmatch(r"このキャラクターがネームレベルキャラクターとバトルする場合、≪このキャラクター≫の攻撃力に\+\((\d+)\)して判定する。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "at", "op": "add", "value": int(m.group(1))}, "cond": {"inBattleVs": {"named": True}}}]
    m = re.fullmatch(r"≪このキャラクター≫は、?あなたの支配キャラクターの(.+?)のアタックコスト・ガードコストを代わりに支払うことが可能。?", text)
    if m and (class_tokens(m.group(1)) or True): return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "payFor", "op": "grant", "value": {"kinds": ["attack", "guard"], "icons": class_tokens(m.group(1)) or [m.group(1)]}}}]
    # ---- Q#60 (Revise#157) ザラーム 3756 ----
    if text.rstrip("。") == "このカードがセットされた際に、このキャラクターを構成する“ザラーム”が5枚以上ある場合、≪このターンのプレイヤー≫は、このターン終了後、追加のターンを行う":
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "cond": {"selfNamedCount": {"name": "ザラーム", "n": 5}}, "effect": {"steps": [{"a": "extraTurnLock"}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "このカードの効果の追加のターン中は、≪プレイヤー全て≫は、手札のカードを使用できず、≪パワーがX以上のネームレベルキャラクター≫のみコストを支払うことが可能":
        return [{"kind": "rule", "text": text, "status": "auto"}]   # enforced by the extra-turn lock (AA4.turnLock)
    # ---- M2g batch 2 (Revise#157) ----
    if re.fullmatch(r"このキャラクターがプレイヤーにアタックした場合、カード種類1つを指定し、あなたのデッキの一番上のカード1枚を捨て札可能。この効果で捨て札したカードが指定したカード種類だった場合、≪このキャラクター≫は、通常のダメージ判定の後、追加でもう一度ダメージ判定を行う。?", text):   # EP167
        return [{"kind": "trigger", "when": {"event": "attack", "self": True, "toPlayer": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "millTypeHitTwice"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"このキャラクターがバトルによるダメージを与えた場合、あなたのデッキの一番上のカード1枚を捨て札可能。捨て札したカードがブレイクカードだった場合、≪このキャラクターのバトル相手≫を捨て札する。?", text):   # EP170
        return [{"kind": "trigger", "when": {"event": "damaged", "byThis": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "millThen", "types": ["Break"], "then": {"a": "discard", "to": "evCh"}}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このキャラクターが捨て札になる場合、≪あなたの任意の、あなたのダメージ置き場のカードX枚まで≫をあなたのデッキに戻して、そのデッキをシャッフルすることが可能。(Xは[^。]+に等しい)。?", text)   # EP173
    if m and x_def(m.group(1)): return [{"kind": "trigger", "when": {"event": "leave", "self": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "pickZone", "zones": ["damage"], "owner": "you", "dest": "deckShuffle", "n": "X", "upTo": True}], "x": x_def(m.group(1)), "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"あなたのメインフェイズ終了時に、≪あなたのデッキの一番上のカード1枚≫を、勢力(ダークロア|E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|極星帝国|イレイザー)、(.+?)の、(\d+)/(\d+)/(\d+)のあなたの支配キャラクター、(.+?)としてセット可能。?", text)   # EP178
    if m: return [{"kind": "trigger", "when": {"event": "phaseEnd", "phase": "main", "mine": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "deckTopToken", "name": m.group(6), "faction": FACTION_JP[m.group(1)], "icons": class_tokens(m.group(2)) or [m.group(2)], "stats": {"se": int(m.group(3)), "at": int(m.group(4)), "de": int(m.group(5))}}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"あなたの支配キャラクターが捨て札される場合、あなたの支配エリアの(.+?)1人を捨て札することで、≪そのキャラクター≫を場に残すことが可能。?", text)   # EP178
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "tokenKeep", "op": "grant", "value": {"name": m.group(1)}}}]
    m = re.fullmatch(r"このキャラクターがバトルする際、このキャラクターの耐久力がバトル相手の耐久力以下の場合、≪このキャラクター≫の攻撃力に\+(\d+)して判定する。?", text)   # EP181
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "at", "op": "add", "value": int(m.group(1))}, "cond": {"deLeBattleOpp": True}}]
    if re.fullmatch(r"このキャラクターにパーマネントカードが2枚以上セットされた状態で、このキャラクターがバトルまたはプレイヤーにアタックする場合、≪このキャラクターのバトル相手のキャラクター、またはこのキャラクターにアタックされたプレイヤー≫にX回同時にダメージを与える。Xはこのキャラクターにセットされているパーマネントカードの枚数に等しい。?", text):   # EP187
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "multiHit", "op": "grant", "value": {"x": {"permCount": True}}}, "cond": {"all": [{"permCountMin": 2}, {"battleOrAttackPlayer": True}]}}]
    m = re.fullmatch(r"このキャラクターから支払われたアタックコスト・ガードコストを、捨て札置き場に置かず、ダメージ置き場に置くことが可能。そうした場合、メインフェイズ終了時まで、≪このキャラクター≫の攻撃力に\+(\d+)する。?", text)   # EP191
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "payToDamageBoost", "op": "grant", "value": {"at": int(m.group(1))}}}]
    m = re.fullmatch(r"≪このキャラクター≫は、X以下のコストのプロジェクトカードの効果を受けない。?(?:Xはこのキャラクターのパワーに等しい。?)?", text)   # A3-03 0554 (X = its power, on its own line)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "untargetable", "op": "grant", "value": {"from": ["Project"], "costMaxPower": True}}}]
    # ---- M3a batch 1 (Revise#159): Permanent cards — "このキャラクター" is the character it is set on ----
    if re.fullmatch(r"このキャラクターのパワーが0の場合、(?:このカードは捨て札される|≪このカード≫(?:を捨て札する|は捨て札される))。?", text): c["discardIfPower0"] = True; return []   # A3-03 0447 / A3-21 2907 …
    if re.fullmatch(r"このキャラクターが捨て札される場合、≪このカード≫をあなたの支配キャラクタ.1人に移動することが可能。?", text): c["permMoveOnLeave"] = True; return []   # A3-22 3124 … (Revise#164)
    m = re.fullmatch(r"≪このカード≫は、?(超|W|ダ|極|イ|阿|E)(\d+)のファストカードとして使用宣言可能。?", text)   # A3-20 2764 …: the same text, used as a Fast card with that factor
    if m: c["asFast"] = {"factor": {{"超": "E.G.O.", "E": "E.G.O.", "阿": "Arayashiki", "W": "WIZ-DOM", "ダ": "Darklore", "極": "Polestar Empire", "イ": "Eraser"}[m.group(1)]: int(m.group(2))}}; return []
    m = re.fullmatch(r"このキャラクターがダメージを与えた場合、≪このカード≫を捨て札する。?", text)   # A3-20 2761 / 2797
    if m: return [{"kind": "trigger", "when": {"event": "damaged", "byThisAny": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "selfCardDiscard"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"キャラクターがアタック宣言した場合、≪そのキャラクターのオーナーのデッキ≫のカードを上から1枚捨て札する。?", text):   # A3-20 2871
        return [{"kind": "trigger", "when": {"event": "attack"}, "optional": False, "text": text, "effect": {"steps": [{"a": "mill", "to": "evOwner", "n": 1}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"あなたの手札からブレイクカードがセットされた場合、それがこのターンにあなたが最初にセットした(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のブレイクカードならば、≪あなたの捨て札置き場にある、そのカードのコスト以下の、ネームを持たない\1のブレイクカード1枚≫を、あなたの支配キャラクターとしてセット可能。?", text)   # A3-25 3617 …
    if m: return [{"kind": "trigger", "when": {"event": "ownBreakFirst", "faction": FACTION_JP[m.group(1)]}, "optional": True, "text": text, "effect": {"steps": [{"a": "pickZone", "zone": "discard", "owner": "you", "n": 1, "upTo": True, "sel": {"types": ["Break"], "named": False, "faction": FACTION_JP[m.group(1)], "costMaxEv": True}, "dest": "back"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"このキャラクターを対象に含む、?≪あなた以外のプレイヤーが使用したプロジェクトカードまたはファストカード≫を捨て札する。その後、?≪このカード≫を捨て札する。?", text):   # A3-11 1658 (Revise#215): when an opponent declares one aimed at this character
        return [{"kind": "trigger", "when": {"event": "cardDeclared", "types": ["Project", "Fast"], "targetsSelf": True, "oppOnly": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "cancelEvItem"}, {"a": "selfCardDiscard"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"≪このキャラクターまたはこのキャラクターにセットされているカードを効果範囲に含んで使用宣言されたプロジェクトカードまたはファストカード≫を捨て札する。その後、このカードを捨て札する。?", text):   # A3-03 0513
        return [{"kind": "trigger", "when": {"event": "cardDeclared", "types": ["Project", "Fast"], "targetsSelf": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "cancelEvItem"}, {"a": "selfCardDiscard"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"≪このキャラクターと、このキャラクターにセットされているカード全て≫は、プロジェクトカード・ファストカード・エフェクト・「エスケープルーム」以外のアビリティの効果を受けない。?", text):   # A3-21 3088 (M5): Project / Fast cards and effects (other cards' abilities are not blocked)
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "untargetable", "op": "grant", "value": {"from": ["Project", "Fast", "Effect"]}}}, {"kind": "always", "text": text, "mod": {"to": "self", "key": "skill", "op": "grant", "value": {"id": "shield", "x": True}}}]
    if re.fullmatch(r"≪このキャラクターと、このキャラクターにセットされているカード全て≫は、プロジェクトカード・ファストカード・エフェクトの目標にならない。?", text):   # A3-03 0514
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "untargetable", "op": "grant", "value": {"from": ["Project", "Fast", "Effect"]}}}]
    if re.fullmatch(r"このキャラクターがプレイヤーにアタックした場合、このカードはオーナーの手札に戻る。?", text):   # A3-03 0514
        return [{"kind": "trigger", "when": {"event": "reachPlayer", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "selfCardToHand"}], "status": "auto"}, "status": "auto"}]   # Pack's report (Revise#389): at the declaration the card went back to the hand and its Stealth was gone before the guard
    if re.fullmatch(r"アタックコスト以外のコストを、このキャラクターから支払った場合、このカードはオーナーの手札に戻る。?", text):   # A3-03 0514
        return [{"kind": "trigger", "when": {"event": "costPaid", "self": True, "kinds": ["guard", "effect", "set", "join"]}, "optional": False, "text": text, "effect": {"steps": [{"a": "selfCardToHand"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"このキャラクターのアタック宣言に対して、ブレイクしていないキャラクターでガード宣言されるか、ブレイクしていないキャラクターのアタック宣言に対してこのキャラクターでガード宣言した場合、≪あなたの任意の、このキャラクターにセットされているパワーカード1枚≫をダメージ置き場に置く。?", text):   # A3-03 0556
        return [{"kind": "trigger", "when": {"event": "guarded", "self": True, "unbrokenOther": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "selfPowerToDamage", "n": 1}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"このキャラクターがバトルでキャラクターを捨て札した場合、≪捨て札されたキャラクターのオーナーの手札≫から、あなたの任意の1枚を捨て札する。?", text):   # A3-04 0664
        return [{"kind": "trigger", "when": {"event": "killed"}, "optional": False, "text": text, "effect": {"steps": [{"a": "oppHandPickDiscard", "n": 1}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"このキャラクターがバトルで捨て札になる場合、≪バトル相手のオーナーの手札≫から、あなたの任意の1枚を捨て札する。?", text):   # A3-04 0664
        return [{"kind": "trigger", "when": {"event": "leave", "self": True, "battle": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "oppHandPickDiscard", "n": 1, "who": "evByOwner"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"このカードをセットされているキャラクターのオーナーに与えられたダメージは、≪このカードをセットされているキャラクター≫が代わりに受ける。その後、≪このカード≫を捨て札する。?", text):   # A3-04 0688
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "takeForOwner", "op": "grant", "value": {"thenDiscard": True}}}]
    m = re.fullmatch(r"このカードが“([^”]+)”にセットされた場合、≪あなたのダメージ置き場のパーマネントカード全て≫を[”“]\1”にセットする。?", text)   # A3-05 0728
    if m: return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "cond": {"selfIs": {"name": re.sub(r"\s+", "", m.group(1))}}, "optional": False, "text": text, "effect": {"steps": [{"a": "damagePermsOntoSelf"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪このカードをセットされている“([^”]+)”≫は、?(精神力|攻撃力|耐久力)に([+\-]\d+)され、(.+?)を得る。?", text)   # A3-05 0761 / 0869
    if m and skills_list(m.group(4)):
        cond = {"selfIs": {"name": re.sub(r"\s+", "", m.group(1))}}
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": STAT_JP[m.group(2)], "op": "add", "value": sign_n(m.group(3))}, "cond": cond}] + [{"kind": "always", "text": text, "mod": {"to": "self", "key": "skill", "op": "grant", "value": {"id": sk["id"], "x": sk["x"]}}, "cond": cond} for sk in skills_list(m.group(4))]
    m = re.fullmatch(r"≪このキャラクター≫はX以下の数値のダメージを受けない。(Xは[^。]+に等しい)。?", text)   # A3-05 0762
    if m and x_def(m.group(1)): return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "noDamage", "op": "grant", "value": {"maxX": x_def(m.group(1))}}}]
    m = re.fullmatch(r"このカードが“([^”]+)”にセットされている場合、≪このキャラクター以外のキャラクター全て≫の精神力に-(\d+)し、(.+?)を与える。?", text)   # A3-05 0799
    if m and skills_list(m.group(3)):
        cond = {"selfIs": {"name": re.sub(r"\s+", "", m.group(1))}}
        return [{"kind": "always", "text": text, "mod": {"to": {"all": {"notSelf": True}}, "key": "se", "op": "add", "value": -int(m.group(2))}, "cond": cond}] + [{"kind": "always", "text": text, "mod": {"to": {"all": {"notSelf": True}}, "key": "skill", "op": "grant", "value": {"id": sk["id"], "x": sk["x"]}}, "cond": cond} for sk in skills_list(m.group(3))]
    if re.fullmatch(r"このキャラクターのアタック宣言に対してガード宣言された場合、≪このキャラクターのアタック宣言≫を取り消す。?", text):   # A3-05 0870
        return [{"kind": "trigger", "when": {"event": "guarded", "self": True, "asAttacker": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "cancelBattle", "to": "self", "which": "attack"}], "status": "auto"}, "status": "auto"}]
    # ---- M2g batch 9 (Revise#157) ----
    m = re.fullmatch(r"このカードが(" + WORK_ALT + r")のキャラクターにセットされた場合、ターン終了時まで、≪あなたの任意のあなたの支配キャラクタ.1人≫に(.+?)を与える。?", text)   # EX0408
    if m and skills_list(m.group(2)): return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "cond": {"stackWorks": WORKS_JP[m.group(1)]}, "optional": False, "text": text, "effect": {"target": {"kind": "char", "sel": {"owner": "you", "area": "controlled"}, "count": 1}, "steps": [{"a": "mod", "to": "t", "mod": {"key": "skill", "op": "grant", "value": {"id": sk["id"], "x": sk["x"]}}, "until": "turn"} for sk in skills_list(m.group(2))], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このキャラクターがバトルする際、バトル開始時にバトル相手の攻撃力と耐久力の合計がこのキャラクターの攻撃力と耐久力の合計より高い場合、≪このキャラクター≫に([±+\-][\dX]+)/([±+\-][\dX]+)/([±+\-][\dX]+)して判定する。(Xは[^。]+に等しい)。?", text)   # EX0518
    if m and x_def(m.group(4)): return [{"kind": "trigger", "when": {"event": "battleStart", "self": True}, "cond": {"oppSumHigher": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "mod", "to": "self", "mod": {"key": k, "op": "add", "value": {"xvar": True, "sign": 1} if "X" in m.group(i) else sign_n(m.group(i))}, "until": "battle"} for k, i in (("se", 1), ("at", 2), ("de", 3)) if m.group(i) not in ("±0", "+0")], "x": x_def(m.group(4)), "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカードを、このカードと同じネームを持つ異なる名称のカードにセットした場合、≪あなたの任意のキャラクタ.1人にセットされているパワーカードX枚≫を捨て札する。?", text)   # PR334 (X: the card's X line)
    if m: return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "cond": {"sameNameOther": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "pickCharPowerDiscardX"}], "x": {"selfNamed": True}, "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"このターン中、このキャラクターからコストが支払われていない場合、あなたのメインフェイズ終了時に、あなたのデッキの一番上のカード1枚を≪このキャラクター≫にパワーカードとしてセット可能。?", text):   # EX0504
        return [{"kind": "trigger", "when": {"event": "phaseEnd", "phase": "main", "mine": True}, "cond": {"notPaidTurn": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "deckTopPowerSelf"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このキャラクターがアタック宣言またはガード宣言した場合、≪あなたの捨て札置き場のカード名称に「([^」]+)」を含むプロジェクトカード・ファストカード1枚≫をあなたの手札に戻す。?", text)   # EX0542
    if m:
        eff = {"steps": [{"a": "pickZone", "zones": ["discard"], "owner": "you", "dest": "hand", "n": 1, "sel": {"types": ["Project", "Fast"], "jpHas": m.group(1)}}], "status": "auto"}
        return [{"kind": "trigger", "when": {"event": "attack", "self": True}, "optional": False, "text": text, "effect": eff, "status": "auto"}, {"kind": "trigger", "when": {"event": "guarded", "self": True, "asGuard": True}, "optional": False, "text": text, "effect": eff, "status": "auto"}]
    m = re.fullmatch(r"≪あなたの使用する、?カードテキストに[「“]([^」”]+)[」”]を含むカードのコスト≫は(?:オーナーの)?手札に戻る。?", text)   # EX0290 (Revise#222)
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "dest", "op": "dest", "value": {"cost": "set", "textHas": m.group(1), "to": "hand"}}}]
    m = re.fullmatch(r"≪このキャラクターからのみコストを支払って使用宣言した、カードテキストに“([^”]+)”を含むプロジェクトカードのコスト≫は手札に戻る。?", text)   # EX0574
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "dest", "op": "dest", "value": {"cost": "set", "type": "Project", "textHas": m.group(1), "onlyFromSelf": True, "to": "hand"}}}]
    if re.fullmatch(r"≪このキャラクターからのみコストを支払って、このキャラクターを目標に使用宣言されたプロジェクトカード・ファストカードのコスト≫は手札に戻る。?", text):   # EX0517
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "dest", "op": "dest", "value": {"cost": "set", "types": ["Project", "Fast"], "onlyFromSelf": True, "onTarget": "self", "to": "hand"}}}]
    if re.fullmatch(r"あなたのメインフェイズ終了時にこのキャラクターのパワーが精神力未満だった場合、≪あなた≫は、このキャラクターのパワーが精神力と等しくなるか、あなたの手札がなくなるまで、あなたの手札をパワーカードとして、このキャラクターにセットする。?", text):   # EX0394
        return [{"kind": "trigger", "when": {"event": "phaseEnd", "phase": "main", "mine": True}, "cond": {"selfPowerLtMental": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "handToPowerUntilSe"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"≪あなた≫は、このカードをファストカードのタイミングであなたのテリトリーのキャラクターにセット宣言可能。?", text):   # EX0396
        c["fastTiming"] = True; return []
    if re.fullmatch(r"このカードがセットされたターンの終了時まで、次に≪このキャラクター以外のあなたの支配キャラクター≫が捨て札される場合、そのキャラクターを場に残す。?", text):   # EX0396
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "keepNextAlly", "until": "turn"}], "status": "auto"}, "status": "auto"}]
    # ---- M2g batch 8 (Revise#157) ----
    if re.fullmatch(r"このキャラクターに、このカードと同じネームを持つブレイクカードがセットされた場合、≪そのカードのコスト≫をこのキャラクターにパワーカードとしてセットする。?", text):   # PR317
        c["sameNameCostPower"] = True; return []
    if re.fullmatch(r"このカードをブレイク条件を満たしたキャラクターにセット宣言する場合、≪あなた≫は、このカードのコストを無視してセット宣言可能。?", text):   # PR336
        c["costFree"] = True; return []
    m = re.fullmatch(r"≪このキャラクター≫は、このカードの下にある“([^”]+)”のエフェクト全てを持つ。?", text)   # PR336
    if m: c["inherit"] = {"name": re.sub(r"\s+", "", m.group(1)), "min": 1}; return []
    if re.fullmatch(r"≪このキャラクター≫から、あなたの支配キャラクターのアタックコスト・ガードコスト・エフェクトコストを代わりに支払うことが可能。?", text):   # EXPP064
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "payFor", "op": "grant", "value": {"kinds": ["attack", "guard", "effect"]}}}]
    if re.fullmatch(r"このキャラクターがアタックした場合、≪このキャラクター≫の本来の攻撃力を2倍にして判定する。?", text):   # EXPR047
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "at", "op": "add", "value": {"x": {"selfBase": "at"}, "sign": 1}}, "cond": {"self": "attacking"}}]
    m = re.fullmatch(r"このカード使用宣言する際、場に“([^”]+)”がいる場合、このカードの必要ファクターとコストは1ずつ減少する。?", text)   # EXPR038
    if m: c["lessIfName"] = re.sub(r"\s+", "", m.group(1)); return []
    m = re.fullmatch(r"場に“([^”]+)”がいる場合、このキャラクターに([±+\-]\d+)/([±+\-]\d+)/([±+\-]\d+)する。?", text)   # EXPR038
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": k, "op": "add", "value": sign_n(m.group(i))}, "cond": {"namesOnField": [re.sub(r"\s+", "", m.group(1))]}} for k, i in (("se", 2), ("at", 3), ("de", 4)) if sign_n(m.group(i))]
    m = re.fullmatch(r"“([^”]+)”全てに([±+\-]\d+)/([±+\-]\d+)/([±+\-]\d+)する。?", text)   # EXPR038
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"all": {"name": re.sub(r"\s+", "", m.group(1))}}, "key": k, "op": "add", "value": sign_n(m.group(i))}} for k, i in (("se", 2), ("at", 3), ("de", 4)) if sign_n(m.group(i))]
    if re.fullmatch(r"≪あなたの任意の、このキャラクターのアタック目標となったプレイヤーの支配キャラクタ.1人≫は、このキャラクターのアタック宣言に対してガード宣言する。その際、そのプレイヤーは通常のガード宣言を行うことができない。?", text):   # EX0137
        return [{"kind": "trigger", "when": {"event": "attack", "self": True, "toPlayer": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "forceGuardPick"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このキャラクターがあなたの対戦相手を目標にアタック宣言する場合、≪あなたの支配エリアの(.+?)全て≫は、同じ目標に対して、コストを支払わずに、同時にアタック宣言する。アタック宣言されたプレイヤーは、それぞれのアタック宣言に対してガード宣言可能。?", text)   # EX0155
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "raid", "op": "grant", "value": {"free": True, "all": True, "tokenName": m.group(1)}}}]
    if re.fullmatch(r"このキャラクターが支配キャラクターからダメージを与えられた場合、あなたはカード名称1つを指定することが可能。そうした場合、あなたのデッキを上から5枚捨て札する。この効果で捨て札されたカードの中に指定した名称のカードがあった場合、≪このキャラクター≫は与えられたダメージを受けない。?", text):   # EX0164
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "nameMillShield", "op": "grant", "value": True}}]
    m = re.fullmatch(r"このキャラクターがダメージを与えた場合、≪このキャラクターにセットされている(.+?)全て≫を捨て札する。?", text)   # EX0192
    if m: return [{"kind": "trigger", "when": {"event": "damaged", "byThisAny": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "permTokensDiscard", "name": m.group(1)}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"このカードをあなたのターンのプロジェクトカードのタイミングでセット宣言した場合、セットされた後、≪このキャラクター≫は、ネームレベルキャラクタ.1人を目標に、コストを支払わずにアタック宣言可能。?", text):   # EX0231
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "cond": {"projDecl": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "attackNamedFree"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このキャラクターに効果を発揮している、あなたの使用した持続の(ファストカード|プロジェクトカード・ファストカード)1枚につき、≪このキャラクター≫の(精神力|攻撃力|耐久力)に\+1する。?", text)   # EP337 (Revise#203)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": STAT_JP[m.group(2)], "op": "add", "value": {"x": {"lastingMine": {"types": ["Fast"] if m.group(1) == "ファストカード" else ["Project", "Fast"]}}, "sign": 1}}}]
    m = re.fullmatch(r"このキャラクターに効果を発揮している、あなたの使用した持続の(ファストカード|プロジェクトカード・ファストカード)1枚につき、≪このキャラクター≫に([±+\-]\d+)/([±+\-]\d+)/([±+\-]\d+)する。?", text)   # EX0238 / EX0524
    if m:
        types = ["Fast"] if m.group(1) == "ファストカード" else ["Project", "Fast"]
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": k, "op": "add", "value": {"x": {"lastingMine": {"types": types}}, "sign": sign_n(m.group(i))}}} for k, i in (("se", 2), ("at", 3), ("de", 4)) if sign_n(m.group(i))]
    if re.fullmatch(r"メインフェイズ開始時に、あなたのデッキの上からカードを1枚引き、パワーカードとして≪このキャラクター≫にセット可能。?", text):   # EX0238
        return [{"kind": "trigger", "when": {"event": "phaseStart", "phase": "main", "mine": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "deckTopPowerSelf"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"メインフェイズ終了時に、あなたのデッキの一番上からカードX枚を引き、パワーカードとして≪このキャラクター≫にセットする。Xはこのキャラクターにのみ効果を発揮しているプロジェクトカード・ファストカードの枚数に等しい。?", text):   # EX0524
        return [{"kind": "trigger", "when": {"event": "phaseEnd", "phase": "main", "mine": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "deckTopPowerSelf", "n": "X"}], "x": {"lastingOnly": True}, "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪あなた≫は、このキャラクターからのみコストを支払って、あなた以外のテリトリーのキャラクターを対象とする【目標】のプロジェクトカードを使用する際に、このキャラクターからさらにXコスト支払うことで、その対象をX体増やすことが可能。Xはこのキャラクターを構成する“([^”]+)”が描かれたカード枚数が上限の任意の枚数に等しい。?", text)   # EX0250
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "extraTargets", "op": "grant", "value": {"name": re.sub(r"\s+", "", m.group(1))}}}]
    if re.fullmatch(r"このキャラクターがイニシアチブを持つ状態でバトルする場合、≪バトル相手のキャラクター≫にイニシアチブのタイミングと通常のタイミング、それぞれでダメージを与える。?", text):   # EX0256
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "dualTiming", "op": "grant", "value": True}}]
    if re.fullmatch(r"このキャラクターにダメージが与えられる場合、このキャラクターにセットされているパーマネントカードを1枚捨て札することが可能。そうした場合、≪このキャラクター≫はそのダメージを受けない。?", text):   # EX0378
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "permDamageShield", "op": "grant", "value": True}}]
    if re.fullmatch(r"このキャラクターがバトルによるダメージを与えた際、バトル相手が捨て札されていない場合、≪このキャラクターのバトル相手全て≫にXダメージを与える。Xはこのキャラクターの攻撃力の数値と、このキャラクターの持つイニシアチブの数の合計に等しい。?", text):   # EX0384
        return [{"kind": "trigger", "when": {"event": "damaged", "byThisBattle": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "damageAliveOpps"}], "x": {"atPlusInit": True}, "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪あなたが各ターンの最初に使用する(" + WORK_ALT + r")のネームを持つブレイクカード≫の必要ファクターとコストは1ずつ減少する。?", text)   # EX0389
    if m:
        sel = {"types": ["Break"], "named": True, "works": WORKS_JP[m.group(1)]}
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "cardCost", "op": "add", "value": {"n": -1, "sel": sel, "firstInTurn": True}}}, {"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "factorLess", "op": "add", "value": {"n": 1, "sel": sel, "firstInTurn": True}}}]
    m = re.fullmatch(r"あなたのメインフェイズ開始時に、≪あなた≫は、(" + WORK_ALT + r")の(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のプロジェクトカード1枚を必要ファクターとコストを無視して使用宣言可能。そのプロジェクトカードが効果を発揮した場合、あなたのメインフェイズを終了する。?", text)   # EX0390
    if m: return [{"kind": "trigger", "when": {"event": "phaseStart", "phase": "main", "mine": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "effDecl", "zones": ["hand"], "types": ["Project"], "faction": FACTION_JP[m.group(2)], "works": WORKS_JP[m.group(1)], "freeCost": True, "ignoreFactor": True, "anyChar": True, "endMain": True}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪このカード≫は「([^」]+)」の効果以外ではセット宣言できずセットすることができない。?", text)   # EX0402
    if m: c["onlyByJp"] = re.sub(r"\s+", "", m.group(1)); return []
    if re.fullmatch(r"このキャラクターがバトルする際、≪このキャラクターのバトル相手≫はプロジェクトカード・ファストカードの効果を受けない。?", text):   # EX0402
        return [{"kind": "always", "text": text, "mod": {"to": {"all": {"oppOfSelf": True}}, "key": "untargetable", "op": "grant", "value": {"from": ["Project", "Fast"]}}}]
    if re.fullmatch(r"このカードがダメージ判定によってあなたのダメージ置き場に置かれた際、あなたがこのカードの必要ファクターを満たしていた場合、≪このカード≫を手札に戻す。?", text):   # EX0505
        c["damageToHand"] = "factorMet"; return []
    if re.fullmatch(r"対戦相手が使用した、このキャラクターを対象に含むプロジェクトカード・ファストカードが効果を発揮した場合、≪そのカードのオーナー≫にXダメージを与える。Xはこのキャラクターの攻撃力に等しい。?", text):   # EX0515
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "oppProjHit", "op": "grant", "value": True}}]
    m = re.fullmatch(r"このキャラクターからのみコストを支払って、カード名称に「([^」]+)」を含むプロジェクトカードまたはファストカードを使用した場合、このキャラクターから1コストを支払うことが可能。そうした場合、≪あなたの捨て札置き場にある、カード名称に「\1」を含むプロジェクトカードまたはファストカード1枚≫を手札に戻すことが可能。?", text)   # EXPP024
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "payBack", "op": "grant", "value": {"jpHas": m.group(1)}}}]
    if re.fullmatch(r"あなたの支配キャラクター以外のキャラクターがアタック宣言している場合、≪このカード≫を、ファストカードのタイミングで、あなたのテリトリーのキャラクターにセット宣言可能。?", text):   # EXPP025
        c["fastIfOppAttacking"] = True; return []
    m = re.fullmatch(r"このキャラクターに“([^”]+)”のネームを持つブレイクカードがセットされた場合、≪このキャラクター≫にあなたの手札のカードを任意の枚数パワーカードとしてセット可能。?", text)   # EXPR037
    if m: return [{"kind": "trigger", "when": {"event": "broken", "self": True, "cardName": re.sub(r"\s+", "", m.group(1))}, "optional": True, "text": text, "effect": {"steps": [{"a": "handToPowerAny"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"対戦相手の使用したプロジェクトカード・ファストカード・エフェクトが効果を発揮している場合、このキャラクターがバトルする際、≪このキャラクター≫に([±+\-][\dX]+)/([±+\-][\dX]+)/([±+\-][\dX]+)する。Xはこのキャラクターの本来の精神力に等しい。?", text)   # EXPR037
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": k, "op": "add", "value": {"x": {"selfBase": "se"}, "sign": 1} if "X" in m.group(i) else sign_n(m.group(i))}, "cond": {"all": [{"oppEffectActive": True}, {"self": "inBattle"}]}} for k, i in (("se", 1), ("at", 2), ("de", 3)) if m.group(i) not in ("±0", "+0")]
    if re.fullmatch(r"このキャラクターからのみコストを支払って使用した必要ファクターが2以下のラグナロクオンラインシリーズのプロジェクトカード・ファストカードのカードテキストに、職業群を指定する効果が含まれている場合、≪このキャラクター≫を指定されている職業群を持つキャラクターと同様に扱う。?", text):   # EXPR058 (no card in the list names a 職業群 — nothing to do)
        return [{"kind": "rule", "text": text, "status": "auto"}]
    if re.fullmatch(r"≪精神ダメージによって捨て札されたカード≫は、オーナーの手札に戻る。?", text):   # PP117 (Pack Q-F4: Break / Character cards only)
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "mentalToHand", "op": "grant", "value": True}}]
    # ---- M3b … M3f abilities (Revise#164) ----
    m = re.fullmatch(r"このキャラクターにパーマネントカードがセットされた場合、≪あなた≫はXドローする。Xはそのパーマネントカードのコストに等しい。?", text)   # A3-25 3655 (Revise#166)
    if m: return [{"kind": "trigger", "when": {"event": "permOnto", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "draw", "to": "you", "n": "X"}], "x": {"evCardCost": True}, "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"≪あなたの対戦相手全て≫は、そのプレイヤーのメインフェイズ開始時に、自分の手札から任意のカード1枚を捨て札する。?", text):   # A3-22 3195 (Revise#166)
        return [{"kind": "trigger", "when": {"event": "phaseStart", "phase": "main", "others": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "handDiscard", "to": "turnPlayer", "n": 1}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"あなたのメインフェイズ中にこのキャラクターがアタック宣言しなかった場合、メインフェイズ終了時に≪このキャラクター≫を捨て札する。?", text):   # A3-22 3197
        return [{"kind": "trigger", "when": {"event": "phaseEnd", "phase": "main", "mine": True}, "cond": {"selfNoAttack": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "discard", "to": "self"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"このキャラクターがバトルによって捨て札される場合、≪バトル相手のキャラクター≫を捨て札する。?", text):   # A3-22 3123
        return [{"kind": "trigger", "when": {"event": "leave", "self": True, "battle": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "discard", "to": "battleOpp"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"あなたのメインフェイズ開始時に、≪このカード≫を捨て札することが可能。?", text):   # A3-21 3088
        return [{"kind": "trigger", "when": {"event": "phaseStart", "phase": "main", "mine": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "selfCardDiscard"}], "status": "auto"}, "status": "auto"}]
    cm = re.fullmatch(r"≪([^≫]+?)を持つブレイクカードのコスト≫は(\d+)減少する。?", text)   # A3-09 1481 (Revise#166): every player's
    if cm and not cm.group(1).startswith("あなたの") and class_tokens(cm.group(1).replace("または", "・")) and len(class_tokens(cm.group(1).replace("または", "・"))) == len(cm.group(1).split("または")):
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "cardCost", "op": "add", "value": {"n": -int(cm.group(2)), "sel": {"types": ["Break"], "icons": class_tokens(cm.group(1).replace("または", "・"))}}}}]
    cm = re.fullmatch(r"≪あなたの(.+?)のブレイクカード≫のコストは(\d+)減少する。?", text)   # A3-20 2691 (Revise#165)
    if cm and class_tokens(cm.group(1).replace("または", "・")) and len(class_tokens(cm.group(1).replace("または", "・"))) == len(cm.group(1).split("または")):
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "cardCost", "op": "add", "value": {"n": -int(cm.group(2)), "sel": {"types": ["Break"], "icons": class_tokens(cm.group(1).replace("または", "・"))}}}}]
    cm = re.fullmatch(r"≪このカード≫のコストはX減少する。(Xは[^。]+に等しい)。?", text)   # A4-PP PP244 (Revise#340): any count of characters as X
    if cm and x_def(cm.group(1)) and "countChars" in x_def(cm.group(1)): c["costLess"] = x_def(cm.group(1)); return []
    cm = re.fullmatch(r"≪このカード≫のコストはX減少する。Xはあなたの支配エリアの(.+?)の(?:合計|数)に等しい。?", text)   # A3-20 2691 (Revise#165)
    if cm and class_tokens(cm.group(1).replace("または", "・")) and len(class_tokens(cm.group(1).replace("または", "・"))) == len(cm.group(1).split("または")):
        c["costLess"] = {"countChars": {"owner": "you", "area": "controlled", "icons": class_tokens(cm.group(1).replace("または", "・"))}}; return []
    if re.fullmatch(r"このキャラクターがバトルによるダメージを与えた場合、≪バトル相手のキャラクター≫を捨て札する。?", text):   # A3-20 2870
        return [{"kind": "trigger", "when": {"event": "damaged", "byThisBattle": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "discard", "to": "battleOpp"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"このキャラクターがキャラクターにアタックした場合、≪アタックされたキャラクター≫を捨て札する。?", text):
        return [{"kind": "trigger", "when": {"event": "attack", "self": True, "toChar": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "discard", "to": "battleTarget"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"≪このキャラクター≫は、?このキャラクターのパワー以下の数値の精神ダメージを受けない。?", text):   # A3-21 2943
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "noDamage", "op": "grant", "value": {"mentalMaxX": {"power": "self"}}}}]
    m = re.fullmatch(r"このキャラクターがバトルする際、≪このキャラクター≫に\+X/\+X/\+Xして判定する。(Xは[^。]+に等しい)。?", text)   # A3-21 2944
    if m and x_def(m.group(1)): return [{"kind": "always", "text": text, "mod": {"to": "self", "key": k, "op": "add", "value": {"x": x_def(m.group(1)), "sign": 1}}, "cond": {"self": "inBattle"}} for k in ("se", "at", "de")]
    m = re.fullmatch(r"≪このキャラクター≫は、(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)(?:\(勢力\)|（勢力）)?のキャラクター・(.+?)(とのバトルによるダメージを受けない|にガードされない)。?", text)   # A3-24 3395 / 3431 / 3467 / 3539 / 3575 (Revise#164)
    if m and (m.group(2) == "キャパシティ-Xを持つキャラクター" or (class_tokens(m.group(2)) and len(class_tokens(m.group(2))) == len(m.group(2).split("・")))):
        sel = {"anyOf": [{"faction": FACTION_JP[m.group(1)]}, {"capSign": -1} if m.group(2) == "キャパシティ-Xを持つキャラクター" else {"icons": class_tokens(m.group(2))}]}   # capSign: A3-24 3503 (Revise#346)
        if m.group(3).startswith("と"): return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "noDamage", "op": "grant", "value": {"battle": True, "fromSel": sel}}}]
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "noGuardBy", "op": "grant", "value": sel}}]
    m = re.fullmatch(r"このカードが(ダメージ判定によって)?ダメージ置き場に置かれた際に?、このカードのオーナーがこのカードの必要ファクターを満たしていた場合、(.+)", text)   # A3-07 1205 / A3-11 1714 / A3-14 1999 / A3-16 2256 (Revise#164)
    if m:
        body = m.group(2).replace("≪このカード≫を、あなたの任意のあなたの支配キャラクタ-1人にセットする", "§PERMONTO§").replace("≪このカード≫を、あなたの任意のあなたの支配キャラクター1人にセットする", "§PERMONTO§")
        if body.rstrip("。") == "§PERMONTO§": eff = {"steps": [{"a": "thisCardPermOnto"}], "status": "auto"}
        else:
            body = re.sub(r"その後、≪このカード≫を捨て札する。?$", "", body)
            eff = parse_body(body)
            if m.group(2).rstrip("。").endswith("その後、≪このカード≫を捨て札する"): eff = dict(eff, steps=eff.get("steps", []) + [{"a": "thisCardDiscard"}])
        if eff.get("status") == "auto" and not eff.get("target"):
            return [{"kind": "trigger", "zone": "damage", "when": dict({"event": "selfToDamage"}, **({"byCheck": True} if m.group(1) else {})), "cond": {"cardFactorMet": True}, "optional": False, "text": text, "effect": eff, "status": "auto"}]
    m = re.fullmatch(r"あなたのメインフェイズ開始時に、あなたの手札またはダメージ置き場にあるこのカードを捨て札することが可能。その場合、≪あなたのデッキ≫の中から(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のキャラクターカードを1枚探してアクティブキャラクターとしてセットし、そのデッキをシャッフルする。?", text)   # A3-19 2522 …
    if m: return [{"kind": "trigger", "zones": ["hand", "damage"], "when": {"event": "phaseStart", "phase": "main", "mine": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "thisCardDiscard"}, {"a": "pickZone", "zone": "deck", "owner": "you", "n": 1, "sel": {"types": ["Character"], "faction": FACTION_JP[m.group(1)]}, "dest": "active"}, {"a": "shuffle", "to": "you"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"≪このキャラクター≫の攻撃力と耐久力を入れ替えて判定する。?", text):   # A3-11 1739
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "swapAtDe", "op": "grant", "value": True}}]
    if re.fullmatch(r"≪このキャラクター≫は、?ステルスを持つキャラクターをガード可能。?", text):   # A3-11 1684
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "guardStealth", "op": "grant", "value": True}}]
    if re.fullmatch(r"このカードがセットされた場合、≪あなたの捨て札置き場にある、あなたが必要ファクターを満たしていない、パーマネントカードまたはプロジェクトカードまたはファストカード1枚≫を、あなたの手札に戻す。?", text):   # A3-16 2202 (Revise#180)
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "pickZone", "zones": ["discard"], "owner": "you", "n": 1, "sel": {"types": ["Permanent", "Project", "Fast"], "factorUnmet": True}, "dest": "hand"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカードがセットされた場合、≪あなたの捨て札置き場またはダメージ置き場にある、あなたの任意のパーマネントカード(\d+)枚≫を、あなたの手札に戻す。?", text)   # A3-12 1789
    if m: return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "pickZone", "zones": ["discard", "damage"], "owner": "you", "n": int(m.group(1)), "sel": {"types": ["Permanent"]}, "dest": "hand"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカードをセットされているキャラクターが捨て札になる場合、≪あなた≫は(\d+)ドローする。?", text)   # A3-14 2053
    if m: return [{"kind": "trigger", "when": {"event": "leave", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "draw", "to": "you", "n": int(m.group(1))}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪このキャラクター≫は、?このキャラクターの精神力以下の数値の精神ダメージを受けない。?", text)   # A3-20 2725
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "noDamage", "op": "grant", "value": {"mentalMaxX": {"selfStat": "se"}}}}]
    if re.fullmatch(r"プロジェクトカードまたはファストカードが使用宣言された場合、≪あなた≫はXドローする。Xはそのカードのコストに等しい。?", text):   # A3-07 1166
        return [{"kind": "trigger", "when": {"event": "cardDeclared", "types": ["Project", "Fast"]}, "optional": False, "text": text, "effect": {"steps": [{"a": "draw", "to": "you", "n": "X"}], "x": {"evCardCost": True}, "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪このキャラクター≫がバトルする際、(精神力|攻撃力|耐久力)に\+Xして判定する。Xはこのキャラクターのバトル相手のパワーに等しい。?", text)   # A3-07 1065
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": STAT_JP[m.group(1)], "op": "add", "value": {"x": {"battleOppPower": True}, "sign": 1}}, "cond": {"self": "inBattle"}}]
    m = re.fullmatch(r"このカードがセットされた場合、≪このキャラクター≫に、あなたの任意のあなたのダメージ置き場のカード(\d+)枚をパワーカードとしてセットする。?", text)   # A3-07 1100
    if m: return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "pickZone", "zone": "damage", "owner": "you", "n": int(m.group(1)), "dest": "powerSelf"}], "status": "auto"}, "status": "auto"}]
    # ---- M2g final (Revise#161) ----
    m = re.fullmatch(r"このカードがあなたの手札にある場合、≪あなた≫は、このカードを「(.+)」という効果の目標・持続のファストカードとして使用宣言可能。?", text)   # EX0223 / EX0228 / EX0232 / EXPP023
    if m:
        pb = parse_body(m.group(1))
        if pb.get("status") == "auto": c["asFast"] = {"play": pb}; return []
    m = re.fullmatch(r"このカードをアクエリパーソナリティの.+?以外が使用する場合、このカードは「([^」]+)」と同じカードとして扱う。?", text)   # PR326 – PR329
    if m: c["sameAsJp"] = re.sub(r"\s+", "", m.group(1)); return []
    # ---- M2g batch 7 (Revise#157) ----
    m = re.fullmatch(r"このカードがセットされた場合、≪あなたのデッキ≫から“([^”]+)”のネームを持つパーマネントカード1枚を(手札に加える|、コストを支払ってこのキャラクターにセット(?:宣言)?する)ことが可能。?", text)   # EX0401 / EX0418 …
    if not m: m = re.fullmatch(r"このカードがセットされた場合、≪あなたのデッキ≫から“([^”]+)”のネームを持つパーマネントカード1枚を(手札に加え|、コストを支払ってこのキャラクターにセット(?:宣言)?)可能。?", text)
    if m:
        nm = re.sub(r"\s+", "", m.group(1))
        st = [{"a": "pickZone", "zones": ["deck"], "owner": "you", "dest": "hand", "n": 1, "upTo": True, "sel": {"types": ["Permanent"], "name": nm}}] if m.group(2).startswith("手札") else [{"a": "effDecl", "zones": ["deck"], "types": ["Permanent"], "nameHas": nm}]
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": True, "text": text, "effect": {"steps": st + [{"a": "shuffle", "to": "you"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪あなたの(.+?)を持つブレイクカード≫の必要ファクターとコストは1ずつ減少する。?", text)   # EX0428
    tg = m and (class_tokens(m.group(1)) and {"icons": class_tokens(m.group(1))} or ((parse_selector(m.group(1) + "を持つ") or {}).get("tag") and {"tag": parse_selector(m.group(1) + "を持つ")["tag"]}))
    if m and tg: return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "cardCost", "op": "add", "value": {"n": -1, "sel": dict({"types": ["Break"]}, **tg)}}}, {"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "factorLess", "op": "add", "value": {"n": 1, "sel": dict({"types": ["Break"]}, **tg)}}}]
    m = re.fullmatch(r"≪あなた≫は、このキャラクターに、ファストカードのタイミングで“([^”]+)”のネームを持つブレイクカードをセット宣言可能。?", text)   # EX0507 / EX0514 / EX0535
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "breakFast", "op": "grant", "value": {"name": re.sub(r"\s+", "", m.group(1))}}}]
    if re.fullmatch(r"このカードがセットされた場合、≪あなたの捨て札置き場のカード1枚≫を、あなたのデッキに戻してシャッフルすることが可能。?", text):   # EX0508
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "pickZone", "zones": ["discard"], "owner": "you", "dest": "deckShuffle", "n": 1}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカードがセットされた場合、≪あなたのダメージ置き場の“([^”]+)”のネームを持つブレイクカード1枚≫を手札に戻すことが可能。?", text)   # EX0516
    if m: return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "pickZone", "zones": ["damage"], "owner": "you", "dest": "hand", "n": 1, "sel": {"types": ["Break"], "name": re.sub(r"\s+", "", m.group(1))}}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカードがセットされた場合、≪あなたのデッキ≫から、?カードテキストに“([^”]+)”を含む(プロジェクト|ファスト)カード1枚を手札に加えることが可能。?", text)   # EX0523 / EX0574
    if m: return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "pickZone", "zones": ["deck"], "owner": "you", "dest": "hand", "n": 1, "upTo": True, "sel": {"types": [CARD_TYPES_JP[m.group(2)]], "textHas": m.group(1)}}, {"a": "shuffle", "to": "you"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このキャラクターに“([^”]+)”のネームを持つブレイクカードをセット宣言する場合、≪そのブレイクカードのコスト≫は手札に戻る。?", text)   # EX0573
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "dest", "op": "dest", "value": {"cost": "set", "type": "Break", "name": re.sub(r"\s+", "", m.group(1)), "onTarget": "self", "to": "hand"}}}]
    m = re.fullmatch(r"このキャラクターに、このカードと異なるカード名称の“([^”]+)”をセット宣言する場合、≪そのブレイクカードのコスト≫は手札に戻る。?", text)   # PR338
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "dest", "op": "dest", "value": {"cost": "set", "type": "Break", "name": re.sub(r"\s+", "", m.group(1)), "onTarget": "self", "notSameJp": True, "to": "hand"}}}]
    m = re.fullmatch(r"このキャラクターがバトルする際、バトル開始時に≪このキャラクターのバトル相手≫にXダメージを与える。(Xは[^。]+に等しい)。?", text)   # EXPP034
    if m and x_def(m.group(1)): return [{"kind": "trigger", "when": {"event": "battleStart", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "damage", "to": "battleOpp", "n": "X", "mental": False}], "x": x_def(m.group(1)), "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このキャラクターがバトルする際、バトル開始時に≪精神力X以下のバトル相手全て≫を捨て札する。(Xは[^。]+に等しい)。?", text)   # EXPP044
    if m and x_def(m.group(1)): return [{"kind": "trigger", "when": {"event": "battleStart", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "battleOppKillIfSe"}], "x": x_def(m.group(1)), "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"このキャラクターがバトルする際、≪このキャラクターのバトル相手のキャラクターにセットされている、あなたの任意のパーマネントカード1枚≫を捨て札する。?", text):   # EXPR008
        return [{"kind": "trigger", "when": {"event": "battleStart", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "battlePermDiscard" if False else "battleOppPermDiscard"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪このキャラクター以外のあなたの支配エリアの(" + WORK_ALT + r")に登場するネームレベルキャラクター全て≫に\+(\d+)/\+(\d+)/\+(\d+)する。?", text)   # EXPR039
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"all": {"works": WORKS_JP[m.group(1)], "named": True, "area": "controlled", "owner": "you", "notSelf": True}}, "key": k, "op": "add", "value": int(m.group(i))}} for k, i in (("se", 2), ("at", 3), ("de", 4))]
    m = re.fullmatch(r"あなたの支配エリアにこのキャラクター以外の(" + WORK_ALT + r")に登場するネームレベルキャラクターがいる場合、≪このキャラクター≫に\+(\d+)/\+(\d+)/\+(\d+)する。?", text)   # EXPR039
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": k, "op": "add", "value": int(m.group(i))}, "cond": {"xAtLeast": {"x": {"countChars": {"works": WORKS_JP[m.group(1)], "named": True, "area": "controlled", "owner": "you", "notSelf": True}}, "n": 1}}} for k, i in (("se", 2), ("at", 3), ("de", 4))]
    # ---- M2g batch 6 (Revise#157) ----
    m = re.fullmatch(r"このカードがセットされた場合、≪あなたの捨て札置き場の“([^”]+)”が描かれているカード1枚≫を、あなたのデッキに戻してシャッフルすることが可能。?", text)   # EX0242
    if m: return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "pickZone", "zones": ["discard"], "owner": "you", "dest": "deckShuffle", "n": 1, "sel": {"name": re.sub(r"\s+", "", m.group(1))}}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカードがセットされた場合、≪あなたのデッキの一番上のカード1枚≫を、勢力なし、(.+?)の、(.+?)を持つ(\d+)/(\d+)/(\d+)のあなたの支配キャラクター、(.+?)としてセット可能。?", text)   # EX0243
    if m and class_tokens(m.group(1)): return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "deckTopToken", "name": m.group(6), "faction": "", "icons": class_tokens(m.group(1)), "skills": skills_list(m.group(2)), "stats": {"se": int(m.group(3)), "at": int(m.group(4)), "de": int(m.group(5))}}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪このキャラクター≫から、カード名称に「([^」]+)」を含むあなたの支配キャラクターのアタックコスト・ガードコストを代わりに支払うことが可能。?", text)   # EX0244
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "payFor", "op": "grant", "value": {"kinds": ["attack", "guard"], "nameHas": m.group(1)}}}]
    m = re.fullmatch(r"このカードがセットされた場合、≪あなたのデッキの上から最大X枚まで≫を、(.+?)を持つパーマネントカード・(.+?)としてこのキャラクターにセットする。(Xは[^。]+に等しい)。?", text)   # EX0277
    if m and x_def(m.group(3)): return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "deckTopPermTokens", "token": {"name": m.group(2), "stats": {}, "skills": skills_list(m.group(1))}}], "x": x_def(m.group(3)), "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪このキャラクターのアタック宣言に対してガード宣言した支配キャラクターのオーナー≫は、?(\d+)ドローする。?", text)   # A3-08 1232 (Revise#166)
    if m: return [{"kind": "trigger", "when": {"event": "guarded", "self": True, "asAttacker": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "draw", "to": "battleOppOwner", "n": int(m.group(1))}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"≪このキャラクターから支払われ(?:る|た)アタックコスト・ガードコスト≫は、?(?:オーナーの)?手札に戻る。?", text):   # EX0441 / EXPP065 (Revise#201)
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "dest", "op": "dest", "value": {"cost": ["attack", "guard"], "to": "hand", "fromSelf": True}}}]
    m = re.fullmatch(r"このキャラクターがバトルする際、≪(?:このキャラクターの)?バトル相手(?:のキャラクター)?≫に(\d+)回同時にダメージを与える。?", text)   # EX0448 (Revise#201)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "multiHit", "op": "add", "value": int(m.group(1))}}]
    m = re.fullmatch(r"≪このキャラクター≫は攻撃力に\+\(X\)される。(Xは[^。]+)。?", text)   # EX0441 (Revise#201): +(X) mental attack
    if m and x_def(m.group(1)): return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "atm", "op": "add", "value": {"x": x_def(m.group(1)), "sign": 1}}}]
    m = re.fullmatch(r"≪このキャラクターから支払われ(?:る|た)(アタック|ガード)コスト≫は、?(?:あなたの)?(ダメージ置き場に置かれる|オーナーのデッキの一番上に置かれる|オーナーの手札に戻る)。?", text)   # A3-09 1349 / 1317 (Revise#166)
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "dest", "op": "dest", "value": {"cost": "attack" if m.group(1) == "アタック" else "guard", "to": {"ダ": "damage", "オーナーのデ": "deckTop", "オーナーの手": "hand"}[next(k for k in ("ダ", "オーナーのデ", "オーナーの手") if m.group(2).startswith(k))], "fromSelf": True}}}]
    m = re.fullmatch(r"≪このキャラクターから支払われ(?:る|た)エフェクトのコスト≫は、?(オーナーの手札に戻る|捨て札置き場に置かず、オーナーのデッキに戻し、そのデッキをシャッフルする)。?", text)   # A3-08 1231 / 1244 (Revise#166)
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "dest", "op": "dest", "value": {"cost": "effect", "to": "hand" if "手札" in m.group(1) else "deckShuffle", "fromSelf": True}}}]
    if re.fullmatch(r"≪このキャラクターから支払われるエフェクトのコスト≫はダメージ置き場に置く。?", text):   # EX0358
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "dest", "op": "dest", "value": {"cost": "effect", "to": "damage", "fromSelf": True}}}]
    m = re.fullmatch(r"このキャラクターがバトルまたはプレイヤーにアタックする場合、あなたのデッキの上からカードをX枚捨て札することが可能。そうした場合、≪このキャラクター≫(?:の攻撃力に\+X|に±0/\+X/\+X)して判定する。(Xは[^。]+に等しい)。?", text)   # EX0359 / EX0360
    if m and x_def(m.group(1)):
        keys = ["at"] if "攻撃力に+X" in text else ["at", "de"]
        eff = {"steps": [{"a": "millBoost", "keys": keys}], "x": x_def(m.group(1)), "status": "auto"}
        return [{"kind": "trigger", "when": {"event": "attack", "self": True}, "optional": True, "text": text, "effect": eff, "status": "auto"},
                {"kind": "trigger", "when": {"event": "battleStart", "self": True, "asGuard": True}, "optional": True, "text": text, "effect": eff, "status": "auto"}]
    m = re.fullmatch(r"メインフェイズ開始時に、≪あなた≫は、あなたのデッキからカードテキストに“([^”]+)”を含むファストカードを1枚手札に加えることが可能。?", text)   # EX0372
    if m: return [{"kind": "trigger", "when": {"event": "phaseStart", "phase": "main", "mine": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "pickZone", "zones": ["deck"], "owner": "you", "dest": "hand", "n": 1, "upTo": True, "sel": {"types": ["Fast"], "textHas": m.group(1)}}, {"a": "shuffle", "to": "you"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"このキャラクターがアタック宣言またはガード宣言した場合、≪あなた≫は1ドロー可能。?", text):   # EX0372
        eff = {"steps": [{"a": "draw", "to": "you", "n": 1}], "status": "auto"}
        return [{"kind": "trigger", "when": {"event": "attack", "self": True}, "optional": True, "text": text, "effect": eff, "status": "auto"},
                {"kind": "trigger", "when": {"event": "guarded", "self": True, "asGuard": True}, "optional": True, "text": text, "effect": eff, "status": "auto"}]
    # ---- M2g batch 5 (Revise#157) ----
    m = re.fullmatch(r"あなたのメインフェイズ開始時に、≪あなた≫はXドローする。Xはあなたの支配エリアのネームレベルキャラクターの数が上限の、あなたの任意の数に等しい。?", text)   # EP374
    if m: return [{"kind": "trigger", "when": {"event": "phaseStart", "phase": "main", "mine": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "drawUpTo", "max": {"countChars": {"named": True, "area": "controlled", "owner": "you"}}}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"このキャラクターがバトルの結果、対戦相手の支配キャラクターを捨て札した場合、≪あなたのダメージ置き場または捨て札置き場にあるキャラクターカードまたはブレイク条件のないブレイクカード1枚≫を、あなたの支配キャラクターとしてセット可能。?", text):   # EP374
        return [{"kind": "trigger", "when": {"event": "killed", "controlled": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "pickZone", "zones": ["damage", "discard"], "owner": "you", "dest": "back", "n": 1, "upTo": True, "sel": {"types": ["Character", "Break"], "noBreakRule": True}}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"構成するカードに「([^」]+)」を含むキャラクターにこのカードをセット宣言する場合、≪このカード≫のコストは(\d+)減少する。?", text)   # EP397
    if m: c["costLessOnto"] = {"jp": re.sub(r"\s+", "", m.group(1)), "n": int(m.group(2))}; return []
    m = re.fullmatch(r"≪このキャラクターのアタック宣言に対してガード宣言するか、このキャラクターにガード宣言されたキャラクター≫にXダメージを与える。Xはあなたの支配エリアの(" + WORK_ALT + r")に登場するネームレベルキャラクターの数に等しい。?", text)   # EP397
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "guardHit", "op": "grant", "value": {"x": {"countChars": {"named": True, "area": "controlled", "owner": "you", "works": WORKS_JP[m.group(1)]}}, "noOwner": True}}}]
    if re.fullmatch(r"≪このキャラクターにセットされているパーマネントカード≫は、プロジェクトカード・ファストカードの効果を受けない。?", text):   # EX0039
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "permShield", "op": "grant", "value": True}}]
    if re.fullmatch(r"このカードがセットされた場合、≪あなたのダメージ置き場または捨て札置き場のパーマネントカード1枚≫を、コストを支払ってセット宣言可能。?", text):   # EX0042
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "effDecl", "zones": ["damage", "discard"], "types": ["Permanent"], "anyChar": True}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"このカードがセットされた場合、≪あなたの任意のキャラクタ.1人にセットされているパーマネントカード全て≫を捨て札する。?", text):   # EX0045
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "pickCharPermsDiscard"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"このキャラクターがプレイヤーまたは支配キャラクターにアタックするか、支配キャラクターとバトルした場合、≪あなたの任意のあなたのダメージ置き場のカード1枚≫を捨て札する。?", text):   # EX0092
        eff = {"steps": [{"a": "pickZone", "zones": ["damage"], "owner": "you", "dest": "discard", "n": 1}], "status": "auto"}
        return [{"kind": "trigger", "when": {"event": "attack", "self": True}, "optional": False, "text": text, "effect": eff, "status": "auto"},
                {"kind": "trigger", "when": {"event": "battleStart", "self": True, "vsCtl": True, "asGuard": True}, "optional": False, "text": text, "effect": eff, "status": "auto"}]
    if re.fullmatch(r"このキャラクターがプレイヤーに対してアタック宣言するか、支配キャラクターのアタック宣言に対してガード宣言した場合、≪あなたの任意のパワーカード1枚≫を捨て札することが可能。?", text):   # EX0119
        eff = {"steps": [{"a": "anyPowerDiscard"}], "status": "auto"}
        return [{"kind": "trigger", "when": {"event": "attack", "self": True, "toPlayer": True}, "optional": True, "text": text, "effect": eff, "status": "auto"},
                {"kind": "trigger", "when": {"event": "guarded", "self": True, "asGuard": True}, "optional": True, "text": text, "effect": eff, "status": "auto"}]
    m = re.fullmatch(r"≪あなた≫は、あなたの支配エリアに“([^”]+)”がいる場合、このカードをコストを支払ってあなたの支配キャラクターとしてセット宣言可能。?", text)   # EX0121 / EX0122 / EX0173
    if m: c["asCharIfName"] = re.sub(r"\s+", "", m.group(1)); return []
    m = re.fullmatch(r"あなたの支配キャラクターの“([^”]+)”に与えられるダメージは、≪このキャラクター≫に代わりに与えられる。?", text)   # EX0121
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "takeFor", "op": "grant", "value": {"name": re.sub(r"\s+", "", m.group(1))}}}]
    m = re.fullmatch(r"≪あなたの支配キャラクターの“([^”]+)”≫に\+X/\+X/\+Xする。Xはあなたの支配エリアの“\1”以外のブレイクしている" + r"(ダークロア|E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|極星帝国|イレイザー)のネームレベルキャラクターの数に等しい。?", text)   # EX0122
    if m:
        nm = re.sub(r"\s+", "", m.group(1)); xd = {"countChars": {"named": True, "broken": True, "faction": FACTION_JP[m.group(2)], "area": "controlled", "owner": "you", "notName": nm}}
        return [{"kind": "always", "text": text, "mod": {"to": {"all": {"name": nm, "owner": "you", "area": "controlled"}}, "key": k, "op": "add", "value": {"x": xd, "sign": 1}}} for k in ("se", "at", "de")]
    m = re.fullmatch(r"あなたの支配エリアに“([^”]+)”がいる場合、≪このキャラクターと同時にアタック宣言またはガード宣言しているあなたの支配キャラクター≫は、バトルによるダメージを受けない。?", text)   # EX0173
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"all": {"sameSide": True, "owner": "you", "area": "controlled", "notSelf": True}}, "key": "noDamage", "op": "grant", "value": {"battle": True}}, "cond": {"namesOnField": [re.sub(r"\s+", "", m.group(1))]}}]
    if re.fullmatch(r"このキャラクターがシンクロによるアタック宣言を行う場合、≪このキャラクター≫はコストを支払わずアタック宣言可能。?", text):   # EX0173
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "freeJoin", "op": "grant", "value": True}}]
    m = re.fullmatch(r"“([^”]+)”が場にいる場合、≪このキャラクターを構成するカード全てと、このキャラクターにセットされているカード全て≫を捨て札する。?", text)   # EX0182
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "doomIfName", "op": "grant", "value": re.sub(r"\s+", "", m.group(1))}}]
    m = re.fullmatch(r"≪このキャラクター≫に([±+\-][\dX]+)/([±+\-][\dX]+)/([±+\-][\dX]+)する。Xはこのキャラクター以外の、場のカード名称に「([^」]+)」を含むキャラクターの数に等しい。?", text)   # EX0220
    if m:
        xd = {"countChars": {"jpHas": m.group(4), "notSelf": True}}
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": k, "op": "add", "value": {"x": xd, "sign": -1 if m.group(i)[0] == "-" else 1} if "X" in m.group(i) else sign_n(m.group(i))}} for k, i in (("se", 1), ("at", 2), ("de", 3)) if m.group(i) not in ("±0", "+0")]
    if re.fullmatch(r"あなた以外のプレイヤーのテリトリーにネームレベルキャラクターがいる場合、≪あなた≫はこのカードの必要ファクターを無視してセット宣言可能。?", text):   # EX0222
        c["noFactorIf"] = {"oppNamed": True}; return []
    # ---- M2g batch 4 (Revise#157) ----
    m = re.fullmatch(r"このカードの下に「([^」]+)」がある場合、≪このキャラクター≫は(.+?)を得、このキャラクターがバトルする際、≪あなたのデッキの一番上のカード1枚≫を、攻撃力に\+(\d+)するパーマネントカード・“([^”]+)”としてこのキャラクターにセット可能。?", text)   # EP288
    if m and skills_list(m.group(2)):
        cond = {"belowName": re.sub(r"\s+", "", m.group(1))}
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "skill", "op": "grant", "value": {"id": sk["id"], "x": sk["x"]}}, "cond": cond} for sk in skills_list(m.group(2))] + \
               [{"kind": "trigger", "when": {"event": "battleStart", "self": True}, "cond": cond, "optional": True, "text": text, "effect": {"steps": [{"a": "deckTopPermToken", "token": {"name": m.group(4), "stats": {"se": 0, "at": int(m.group(3)), "de": 0}}}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"≪このキャラクターから支払われたアタックコスト・ガードコスト・エフェクトコストの中にあるキャラクターカード全て≫は手札に戻る。?", text):   # EP353
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "costCharsToHand", "op": "grant", "value": True}}]
    if re.fullmatch(r"バトルの結果、このキャラクターが捨て札される場合、≪このカードとこのキャラクターにセットされているパーマネントカード全て≫を手札に戻す。?", text):   # EP356
        return [{"kind": "trigger", "when": {"event": "leave", "self": True, "battle": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "evSelfPermsToHand"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"このキャラクターがバトルの結果、対戦相手の支配キャラクターを捨て札した場合、≪あなたのデッキ≫からパーマネントカード1枚を選び、コストを無視してあなたの支配キャラクターにセット宣言可能。?", text):   # EP356
        return [{"kind": "trigger", "when": {"event": "killed", "controlled": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "effDecl", "zones": ["deck"], "types": ["Permanent"], "freeCost": True, "anyChar": True}, {"a": "shuffle", "to": "you"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このキャラクターが対戦相手にアタックした場合、あなたは≪このキャラクターのアタックを受けたプレイヤー≫の手札全てを見て、その中からあなたの任意の(プロジェクト|ファスト|パーマネント|ブレイク|キャラクター)カード1枚を捨て札する。?", text)   # EP359
    if m: return [{"kind": "trigger", "when": {"event": "attack", "self": True, "toPlayer": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "peekHandDiscard", "who": "attacked", "sel": {"types": [dict(CARD_TYPES_JP, キャラクター="Character")[m.group(1)]]}}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このターン中に、あなたがダメージ判定を行っている場合、ターン終了時まで、≪このキャラクター≫は([±+\-][\dX]+)/([±+\-][\dX]+)/([±+\-][\dX]+)される。(Xは[^。]+に等しい)。?", text)   # EP362
    if m and x_def(m.group(4)):
        out = []
        for k, i in (("se", 1), ("at", 2), ("de", 3)):
            g = m.group(i)
            if g in ("±0", "+0"): continue
            out.append({"kind": "always", "text": text, "mod": {"to": "self", "key": k, "op": "add", "value": {"x": x_def(m.group(4)), "sign": -1 if g[0] in "-" else 1} if "X" in g else sign_n(g)}, "cond": {"dmgCheckedTurn": True}})
        return out
    if re.fullmatch(r"このキャラクターのバインド(?:X|\d+)のスキルを使用した場合、≪このカード≫を(?:オーナーの)?手札に戻す。?", text):   # EX0599 (Revise#208)
        return [{"kind": "trigger", "when": {"event": "bindUsed"}, "optional": False, "text": text, "effect": {"steps": [{"a": "selfCardToHandAny"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪プレイヤー全て≫は、?自分のターン終了時に、?自分の捨て札置き場の任意のカード(\d+)枚を、?自分のデッキの一番下に置く。?", text)   # EX0096 (Revise#207): the turn player chooses
    if m: return [{"kind": "trigger", "when": {"event": "turnEnd"}, "ownerDecides": True, "optional": False, "text": text, "effect": {"steps": [{"a": "pickZone", "zones": ["discard"], "owner": "you", "n": int(m.group(1)), "dest": "deckBottom"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"あなたのパワーカードフェイズ(?:開始時|の最初)に、≪あなた≫は、?あなたのデッキの一番上のカード(\d+)枚を見る。?", text)   # EX0433 (Revise#207)
    if m: return [{"kind": "trigger", "when": {"event": "phaseStart", "phase": "charge", "mine": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "peekTop", "n": int(m.group(1))}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"あなたの支配キャラクターが対戦相手の支配キャラクターとのバトルまたは対戦相手の使用したカードの効果で捨て札された場合、(ターン終了時まで、≪このキャラクター≫に[^。]+する。?)", text)   # EP369 (Revise#201)
    if m and parse_body(m.group(1))["status"] == "auto": return [{"kind": "trigger", "when": {"event": "ownLost"}, "optional": False, "text": text, "effect": parse_body(m.group(1)), "status": "auto"}]
    if re.fullmatch(r"あなたの支配キャラクターが対戦相手の支配キャラクターとのバトルまたは対戦相手の使用したカードの効果で捨て札された場合、あなたのデッキの一番上のカード1枚を≪このキャラクター≫にパワーカードとしてセット可能。?", text):   # EP368
        return [{"kind": "trigger", "when": {"event": "ownLost"}, "optional": True, "text": text, "effect": {"steps": [{"a": "deckTopPowerSelf"}], "status": "auto"}, "status": "auto"}]
    # ---- M2g batch 3 (Revise#157) ----
    m = re.fullmatch(r"≪このキャラクターのバトル相手にセットされているパーマネントカード全て≫を捨て札する。この効果でパーマネントカードが捨て札された場合、バトル終了時まで、このキャラクターに([±+\-]\(?\d+\)?)/([±+\-]\(?\d+\)?)/([±+\-]\(?\d+\)?)して判定する。?", text)   # EP222 (Q#62: when it battles)
    if m: return [{"kind": "trigger", "when": {"event": "battleStart", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "oppPermStripBoost", "stats": {k: sign_n(m.group(i)) for k, i in (("se", 1), ("at", 2), ("de", 3))}}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"このキャラクターのオーナーに与えられたダメージは、≪このキャラクター≫が代わりに受ける。?", text):   # EP227
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "takeForOwner", "op": "grant", "value": True}}]
    m = re.fullmatch(r"≪パーマネントカードのセット宣言、またはプロジェクトカード・ファストカードを使用宣言した、(.+?)を支配していないプレイヤー≫は、自身の手札1枚を捨て札する。?", text)   # EP233
    if m and class_tokens(m.group(1).replace("または", "・")): return [{"kind": "trigger", "when": {"event": "cardDeclared", "types": ["Permanent", "Project", "Fast"]}, "optional": False, "text": text, "effect": {"steps": [{"a": "declarerNoIconDiscard", "icons": class_tokens(m.group(1).replace("または", "・"))}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"対戦相手のテリトリーのキャラクターをブレイクする場合、≪あなた≫はこのカードを必要ファクターとコストを無視してセット宣言可能。?", text):   # EP243
        return [{"kind": "rule", "text": text, "status": "auto", "card": {"freeIf": {"oppHasChars": True, "normal": True, "oppOnly": True}}}]
    if re.fullmatch(r"≪ネームを持つブレイクカードをセットしたプレイヤー≫は、1ドローする。その後、そのプレイヤーの任意のプレイヤ.1人の手札1枚を選んで捨て札する。?", text):   # EP244
        return [{"kind": "trigger", "when": {"event": "enter", "anyNamedBreak": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "namedBreakSetter"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このキャラクターが支配キャラクターを捨て札する場合、このキャラクターから1コストを支払うことが可能。そうした場合、≪捨て札になるキャラクターのオーナー≫の手札から、あなたの任意の手札X枚を捨て札する。(Xは[^。]+に等しい)。?", text)   # EP248
    if m and x_def(m.group(1)): return [{"kind": "trigger", "when": {"event": "killed", "controlled": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "payThen", "n": 1, "then": {"a": "oppHandPickDiscard", "n": "X"}}], "x": x_def(m.group(1)), "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカードに書かれたエフェクトは、捨て札したあなたの手札の(.+?)のいずれかを持つカード1枚につき1コストを支払ったものとして使用宣言可能。?", text)   # EP252
    if m and class_tokens(m.group(1)): return [{"kind": "rule", "text": text, "status": "auto", "card": {"effHandPay": {"icons": class_tokens(m.group(1))}}}]
    # ---- M2e batch 6 (Revise#151) ----
    if text.rstrip("。") == "このカードをあなたのターンのプロジェクトカードのタイミングでセット宣言した場合、セットされた後、≪このキャラクター≫は、あなたの任意の目標に対してアタック宣言する":
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "cond": {"projDecl": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "makeAttack", "self": True}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このキャラクターが対戦相手を目標にアタック宣言した場合、≪あなたのデッキ≫からネームを持たないキャラクターカードを1枚選び、あなたの支配キャラクターとしてセットし、ターン終了時まで、≪このキャラクター≫に±0/\+(\d+)/\+(\d+)する。?", text)
    if m: return [{"kind": "trigger", "when": {"event": "attack", "self": True, "toPlayer": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "pickZone", "to": "you", "dest": "back", "zone": "deck", "owner": "you", "sel": {"types": ["Character"], "anyOf": [{"nameNone": True}]}, "n": 1, "upTo": False}, {"a": "shuffle", "to": "you"}, {"a": "mod", "to": "self", "mod": {"key": "at", "op": "add", "value": int(m.group(1))}, "until": "turn"}, {"a": "mod", "to": "self", "mod": {"key": "de", "op": "add", "value": int(m.group(2))}, "until": "turn"}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "あなたのメインフェイズ開始時に、≪あなたのデッキ≫の上からカード10枚を捨て札する。あなたのデッキが10枚未満の場合、代わりに≪あなたのデッキ≫のカード全てを捨て札する":
        return [{"kind": "trigger", "when": {"event": "phaseStart", "phase": "main", "mine": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "mill", "to": "you", "n": 10}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "≪このキャラクターを対象に含むプロジェクトカード・ファストカード・エフェクト≫のコストに+Xする。Xはこのキャラクターのパワーに等しい":
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "targetTax", "op": "grant", "value": {"any": True, "stat": "power"}}}]
    m = re.fullmatch(r"あなたの対戦相手があなたのテリトリーのキャラクターを目標にブレイクカードをセット宣言する場合、≪そのブレイクカード≫のコストに\+Xする。Xはこのキャラクターの精神力に等しい。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "breakTaxMine", "op": "grant", "value": True}}]
    if text.rstrip("。") == "このカードがセットされた場合、≪このカードのコスト≫と、≪あなたのダメージ置き場と捨て札置き場にある、このカードと同じネームを持つカード全て≫を、オーナーの手札に戻す":
        c["costBack"] = {"to": "hand"}
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "sameNamePilesToHand"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカードの下に[“\"]([^”\"]+)[”\"]がある場合、メインフェイズ終了時に、精神力に等しくなるまであなたのデッキからカードを引き、≪このキャラクター≫にパワーカードとしてセット可能。?", text)
    if m: return [{"kind": "trigger", "when": {"event": "phaseEnd", "phase": "main"}, "cond": {"belowPName": re.sub(r"\s+", "", m.group(1))}, "optional": True, "text": text, "effect": {"steps": [{"a": "fillPower", "from": "deck"}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "このキャラクターに精神ダメージが与えられる場合、その数値に等しい枚数のカードを、あなたのデッキの上から捨て札する。そうした場合、≪このキャラクター≫は精神ダメージを受けない":
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "millForMental", "op": "grant", "value": True}}]
    if text.rstrip("。") == "このカードがセットされた場合、あなたの手札を公開し、≪あなたのダメージ置き場と捨て札置き場と手札にある、このカードと同じネームを持つカード全て≫を、このカードの下にセット可能":
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "sameNameUnder"}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "あなたのメインフェイズ開始時に、≪あなたの捨て札置き場にあるブレイクカード1枚≫を、コストを支払ってセット宣言可能。その場合、≪そのブレイクカードのコスト≫はオーナーの手札に戻る":
        return [{"kind": "trigger", "when": {"event": "phaseStart", "phase": "main", "mine": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "effDecl", "zones": ["discard"], "types": ["Break"], "costTo": "hand"}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "あなたのメインフェイズ開始時に、あなた以外のプレイヤーの支配キャラクター1人を指定する。メインフェイズ終了時まで、≪あなたの支配キャラクター全て≫は指定したキャラクターを目標にアタック宣言可能":
        return [{"kind": "trigger", "when": {"event": "phaseStart", "phase": "main", "mine": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "designateAttackable"}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "あなたがこのカードの必要ファクターを満たした状態で、このカードがあなたのダメージ置き場にある場合、≪あなた≫は、あなたのメインフェイズ開始時に、このカードをあなたの支配キャラクターとしてセット可能":
        return [{"kind": "trigger", "when": {"event": "phaseStart", "phase": "main", "mine": True}, "optional": True, "text": text, "zone": "damage", "effect": {"steps": [{"a": "selfFromDamage"}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "このカードがセットされた場合、あなたはパーマネントカード・プロジェクトカード・ファストカードのカード名称を1つずつ指定する。≪プレイヤー全て≫は、指定したカードと同じ名称のカードを使用宣言することができない":
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "banNamePick", "types": [t], "until": "source"} for t in ("Permanent", "Project", "Fast")], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "このキャラクターがプレイヤーにアタックした場合、通常のダメージ判定を行わず、≪アタックを受けたプレイヤーのデッキ≫の上から、このキャラクターの攻撃力の数値に等しい枚数を、そのプレイヤーのダメージ置き場に置く":
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "playerHit", "op": "grant", "value": {"effect": {"steps": [{"a": "mill", "to": "attackedPlayer", "n": "X", "zone": "damage"}], "status": "auto"}, "replace": True}}}]
    if text.rstrip("。") == "このキャラクターがプレイヤーに対してアタック宣言するか、支配キャラクターに対してガード宣言した場合、≪手札上限を越える手札を持つプレイヤー全て≫は、手札上限に等しくなるまで、手札からあなたの任意のカードをダメージ置き場に置く":
        return [{"kind": "trigger", "when": {"event": "battleDeclared", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "overLimitToDamage"}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "このキャラクターのアタック宣言に対してガード宣言しているキャラクターの攻撃力の数値が、このキャラクターの耐久力以上の場合、≪このキャラクター≫のアタック宣言を取り消す。その後、≪ガード宣言していたキャラクターのオーナー≫に1ダメージを与える":
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "retreatVsStrong", "op": "grant", "value": True}}]
    # ---- M2e batch 1 (Revise#144) ----
    SK2 = {"インフィニティ": "infinity", "シールド": "shield", "オフェンシブ": "offensive", "ディフェンシブ": "defensive", "インターセプト": "intercept", "ペネトレイト": "penetrate", "ブレイクスルー": "breakthrough", "シンクロ": "synchro", "イニシアチブ": "initiative", "ステルス": "stealth"}
    if text.rstrip("。") == "≪このキャラクター≫は、全ての分類を持つ": return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "allIcons", "op": "grant", "value": True}}]
    if text.rstrip("。") == "このキャラクターがシンクロによるアタック宣言またはガード宣言を行っている場合、≪このキャラクター≫はバトルによるダメージを受けない": return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "noDamage", "op": "grant", "value": {"whenSynchro": True}}}]   # A4-03 0538 (Revise#318)
    if text.rstrip("。") == "≪このキャラクター≫は、ガード時にバトルによるダメージを受けない": return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "noDamage", "op": "grant", "value": {"whenGuarding": True}}}]
    if text.rstrip("。") == "≪このキャラクター≫は、1人のキャラクターとのバトルによるダメージを受けない": return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "noDamage", "op": "grant", "value": {"oneOnOne": True}}}]
    if text.rstrip("。") == "≪このキャラクター≫は、このキャラクターの精神力以下の数値の精神ダメージを受けない": return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "noDamage", "op": "grant", "value": {"mentalMaxX": {"selfStat": "se"}}}}]
    if text.rstrip("。") == "≪このキャラクター≫は、パワーがこのキャラクターのパワーと等しいキャラクター以外とのバトルによるダメージを受けない": return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "noDamage", "op": "grant", "value": {"battle": True, "fromSel": {"powerNeSelf": True}}}}]
    m = re.fullmatch(r"≪このキャラクター≫は、(インフィニティ|シールド|オフェンシブ|ディフェンシブ|インターセプト|ペネトレイト|ブレイクスルー|シンクロ|イニシアチブ|ステルス)を持つキャラクター以外とのバトルによるダメージを受けない。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "noDamage", "op": "grant", "value": {"battle": True, "fromSel": {"noSkill": SK2[m.group(1)]}}}}]
    if text.rstrip("。") == "≪このキャラクター≫は、あなた以外のプレイヤーの使用したプロジェクトカード・ファストカード・エフェクトの効果を受けない":
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "untargetable", "op": "grant", "value": {"from": ["Project", "Fast", "Effect"], "byOpp": True}}}]
    if text.rstrip("。") == "≪あなたの支配キャラクター全て≫は、あなたの対戦相手が使用したエフェクトの効果を受けない":
        return [{"kind": "always", "text": text, "mod": {"to": {"all": {"owner": "you", "area": "controlled"}}, "key": "untargetable", "op": "grant", "value": {"from": ["Effect"], "byOpp": True}}}]
    m = re.fullmatch(r"≪プレイヤー全て≫にドロー\+(\d+)・チャージ(\d+)を与える。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "draw", "op": "add", "value": int(m.group(1))}}, {"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "charge", "op": "add", "value": int(m.group(2))}}]
    if text.rstrip("。") == "≪このキャラクターのアタックコスト≫は手札に戻る":
        return [{"kind": "always", "text": text, "mod": {"to": "you", "key": "dest", "op": "dest", "value": {"cost": "attack", "paidBy": "self", "to": "hand"}}}]
    if text.rstrip("。") in ("このキャラクターがアタックした場合、ダメージ判定後に≪このカード≫は手札に戻る", "このキャラクターがアタックした場合、ダメージ判定後に≪このカード≫はオーナーの手札に戻る"):
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "playerHit", "op": "grant", "value": {"effect": {"steps": [{"a": "bounce", "to": "card"}], "status": "auto"}, "replace": False}}}]
    if text.rstrip("。") == "≪あなた≫は、このカードをファストカードのタイミングでセット宣言可能": c["fastTiming"] = True; return []
    if text.rstrip("。") == "≪あなた≫は、このカードのコストを無視して、ファストカードのタイミングでセット宣言可能": c["fastTiming"] = True; c["costFree"] = True; return []
    if text.rstrip("。") == "≪あなた≫は、このキャラクターに、ファストカードのタイミングでパーマネントカードをセット宣言可能":
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "fastPerm", "op": "grant", "value": True}}]
    m = re.fullmatch(r"≪([^≫]+?)(?:全て)?≫に((?:オフェンシブ|ディフェンシブ|シールド|インターセプト|ペネトレイト|ブレイクスルー|シンクロ|イニシアチブ|ステルス)(?:・(?:オフェンシブ|ディフェンシブ|シールド|インターセプト|ペネトレイト|ブレイクスルー|シンクロ|イニシアチブ|ステルス))*)を与え(?:る|、([+\-]\d+)/([+\-]\d+)/([+\-]\d+)する)。?", text)
    if m:
        sel = parse_selector((lambda t: t if parse_selector(t) is not None else re.sub(r"の$", "", t))(re.sub(r"キャラクター$", "", m.group(1)))) if not class_tokens(m.group(1)) or len(class_tokens(m.group(1))) != len(m.group(1).split("・")) else {"icons": class_tokens(m.group(1))}
        if sel is not None:
            r0 = grant_all(sel, m.group(2), [int(m.group(g)) for g in (3, 4, 5)] if m.group(3) else None, None, text)
            if r0: return r0
    m = re.fullmatch(r"≪([^≫]+?)全て≫に(.+?)を与える。?", text)
    if m and class_tokens(m.group(2)) and len(class_tokens(m.group(2))) == len(m.group(2).split("・")):
        sel = parse_selector((lambda t: t if parse_selector(t) is not None else re.sub(r"の$", "", t))(re.sub(r"キャラクター$", "", m.group(1))))
        if sel is not None: return [{"kind": "always", "text": text, "mod": {"to": {"all": sel}, "key": "icon", "op": "grant", "value": ic}} for ic in class_tokens(m.group(2))]
    if text.rstrip("。") == "このカードがセットされたターンのメインフェイズ終了時まで、≪このキャラクター≫はイニシアチブを得る":
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "mod", "to": "self", "mod": {"key": "skill", "op": "grant", "value": {"id": "initiative", "x": True}}, "until": "main"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このキャラクターが(.+?)キャラクターとバトルする場合、≪このキャラクター≫の攻撃力に\+(\d+)して判定する。?", text)
    if m and parse_selector(m.group(1)) is not None:
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "at", "op": "add", "value": int(m.group(2))}, "cond": {"battleVs": parse_selector(m.group(1))}}]
    m = re.fullmatch(r"((?:[“\"][^”\"]+[”\"]、?)+)が全て場に出ている場合、≪それらのキャラクター全て≫は([^を]+)を得、([+\-]\d+)/[+\-]?\(?([+\-]?\d+)\)?/([+\-]\d+)される。?", text)
    if m:
        names = re.findall(r"[“\"]([^”\"]+)[”\"]", m.group(1))
        r0 = grant_all({"anyName": [re.sub(r"\s+", "", n) for n in names]}, m.group(2), [int(m.group(g)) for g in (3, 4, 5)], {"namesOnField": [re.sub(r"\s+", "", n) for n in names]}, text)
        if r0: return r0
    m = re.fullmatch(r"ネームに「([^」]+)」を含む、ブレイクしている(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)の異なるネームレベルのキャラクターが(\d+)人以上場に出ている場合、≪それらのキャラクター全て≫は([^を]+)を得、([+\-]\d+)/([+\-]\d+)/([+\-]\d+)される。?", text)
    if m:
        sel = {"nameHas": m.group(1), "broken": True, "faction": FACTION_JP[m.group(2)], "named": True}
        r0 = grant_all(sel, m.group(4), [int(m.group(g)) for g in (5, 6, 7)], {"countAtLeast": {"sel": sel, "n": int(m.group(3))}}, text)
        if r0: return r0
    m = re.fullmatch(r"≪このキャラクター以外の、カード名称に「([^」]+)」を含むブレイクしている(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のネームレベルキャラクター全て≫(?:[^≫]*≫)?は([^を]+)を得、([+\-]\d+)/([+\-]\d+)/([+\-]\d+)される。?", text)
    if m:
        r0 = grant_all({"notSelf": True, "jpHas": m.group(1), "broken": True, "faction": FACTION_JP[m.group(2)], "named": True}, m.group(3), [int(m.group(g)) for g in (4, 5, 6)], None, text)
        if r0: return r0
    m = re.fullmatch(r"(あなたのターン|あなた以外のプレイヤーのターン)の間、≪ブレイクしていない支配キャラクター≫の(アタック|ガード)コストは(\d+)上昇する。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"all": {"broken": False, "area": "controlled"}}, "key": "attackCost" if m.group(2) == "アタック" else "guardCost", "op": "add", "value": int(m.group(3))}, "cond": {"myTurn": True} if m.group(1) == "あなたのターン" else {"notMyTurn": True}}]
    m = re.fullmatch(r"≪(.+?)全て≫に((?:オフェンシブ|ディフェンシブ|シールド|インターセプト|ペネトレイト|ブレイクスルー|シンクロ|イニシアチブ|ステルス)(?:・(?:オフェンシブ|ディフェンシブ|シールド|インターセプト|ペネトレイト|ブレイクスルー|シンクロ|イニシアチブ|ステルス))*)を与える。?", text)
    if m and class_tokens(m.group(1)) and len(class_tokens(m.group(1))) == len(m.group(1).split("・")):
        r0 = grant_all({"icons": class_tokens(m.group(1))}, m.group(2), None, None, text)
        if r0: return r0
    # ---- M2d (A3-16 … A3-20, Revise#138) ----
    m = re.fullmatch(r"このカードがセットされた場合、≪あなたの任意のあなたの手札の(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)?のパーマネントカード1枚≫を、このキャラクターにセット可能。?", text)
    if m: return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [dict({"a": "handPermToChar", "self": True}, **({"faction": FACTION_JP[m.group(1)]} if m.group(1) else {}))], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"≪このキャラクター≫は、あなたの使用したプロジェクトカード・ファストカードの効果を受けない。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "untargetable", "op": "grant", "value": {"from": ["Project", "Fast"], "byOwn": True}}}]
    if re.fullmatch(r"≪あなた≫は、ブレイクカードを、ファストカードのタイミングでセット宣言可能。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": "you", "key": "fastBreak", "op": "grant", "value": {}}}]
    m = re.fullmatch(r"あなたがドローする際、ドローする前に、≪あなたのデッキのカードを上から(\d+)枚≫見て、そのカード全てを、あなたの任意の順番であなたのデッキの上か下に置くことが(?:でき|可能)(?:る)?。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "drawPeek", "op": "grant", "value": {"n": int(m.group(1))}}}]
    m = re.fullmatch(r"このカードがセットされたフェイズの終了時まで、≪このキャラクター≫に±0/\+(\d+)/\+(\d+)する。?", text)
    if m: return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "modPhase", "to": "self", "key": "at", "n": int(m.group(1))}, {"a": "modPhase", "to": "self", "key": "de", "n": int(m.group(2))}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"このキャラクターがあなた以外のプレイヤーに対してアタック宣言した場合、≪アタックコスト≫はオーナーの手札に戻る。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": "you", "key": "dest", "op": "dest", "value": {"cost": "attack", "paidBy": "self", "vsPlayer": True, "to": "hand"}}}]
    if re.fullmatch(r"≪プレイヤー全て≫の受ける5以上のダメージは4になる。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "dmgCap4", "op": "grant", "value": True}}]
    m = re.fullmatch(r"≪あなたの(.+?)を持つブレイクカード≫のコストは(\d+)(減少|上昇)する。?", text)   # Revise#139
    if m and class_tokens(re.sub(r"または", "・", m.group(1))):
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "cardCost", "op": "add", "value": {"n": int(m.group(2)) * (-1 if m.group(3) == "減少" else 1), "sel": {"types": ["Break"], "icons": class_tokens(re.sub(r"または", "・", m.group(1)))}}}}]
    m = re.fullmatch(r"≪(.+?)全て≫に((?:シールド|オフェンシブ|ディフェンシブ|インターセプト|ペネトレイト|ブレイクスルー|シンクロ|イニシアチブ|ステルス)(?:・(?:シールド|オフェンシブ|ディフェンシブ|インターセプト|ペネトレイト|ブレイクスルー|シンクロ|イニシアチブ|ステルス))*)を与え、([+\-±]\d+)/([+\-±]\d+)/([+\-±]\d+)する。?", text)
    msel = None
    if m:
        msel = parse_selector(m.group(1))
        cm2 = re.fullmatch(r"(あなたの支配エリアの|あなたの支配キャラクターの|あなたの)?(.+)", m.group(1))
        if msel is None and class_tokens(cm2.group(2)) and len(class_tokens(cm2.group(2))) == len(cm2.group(2).split("・")):
            msel = dict({"owner": "you", "area": "controlled"} if cm2.group(1) in ("あなたの支配エリアの", "あなたの支配キャラクターの") else {"owner": "you"} if cm2.group(1) else {}, icons=class_tokens(cm2.group(2)))
    if m and msel is not None:
        sel, out = msel, []
        SK = {"シールド": "shield", "オフェンシブ": "offensive", "ディフェンシブ": "defensive", "インターセプト": "intercept", "ペネトレイト": "penetrate", "ブレイクスルー": "breakthrough", "シンクロ": "synchro", "イニシアチブ": "initiative", "ステルス": "stealth"}
        for sk in m.group(2).split("・"): out.append({"kind": "always", "text": text, "mod": {"to": {"all": sel}, "key": "skill", "op": "grant", "value": {"id": SK[sk], "x": True}}})
        for key, g in (("se", 3), ("at", 4), ("de", 5)):
            v = sign_n(m.group(g))
            if v: out.append({"kind": "always", "text": text, "mod": {"to": {"all": sel}, "key": key, "op": "add", "value": v}})
        return out
    m = re.fullmatch(r"≪あなた≫は、全ての勢力のファクターをX得る。(Xは[^。]+に等しい)。?", text)
    if m and x_def(m.group(1)): return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "factorAll", "op": "add", "value": {"x": x_def(m.group(1)), "sign": 1}}}]
    m = re.fullmatch(r"≪あなた≫の、ダメージ置き場のカード枚数による敗北条件に\+X枚する。Xはこのキャラクターの精神力に等しい。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "lossPlus", "op": "grant", "value": True}}]
    if re.fullmatch(r"≪パーマネントカード・プロジェクトカード・ファストカードの必要ファクターとコスト≫は1ずつ上昇する。?", text):
        T3 = ["Permanent", "Project", "Fast"]
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "cardCost", "op": "add", "value": {"n": 1, "sel": {"types": T3}}}},
                {"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "factorLess", "op": "add", "value": {"n": 0, "up": 1, "sel": {"types": T3}}}}]
    m = re.fullmatch(r"≪あなた≫に与えられるダメージに-X(?:・[ー\-]\(X\))?して判定する。(Xは[^。]+に等しい)。?", text)
    if m and x_def(m.group(1)): return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "playerDmgCut", "op": "add", "value": {"x": x_def(m.group(1)), "sign": 1}}}]
    if re.fullmatch(r"≪アタック宣言・ガード宣言するか、コストを支払った、▼を持つキャラクター≫に\(1\)ダメージを与える。?", text):
        eff = {"steps": [{"a": "damage", "to": "evCh", "n": 1, "mental": True}], "status": "auto"}
        return [{"kind": "trigger", "when": {"event": "battleDeclared", "sel": {"aggressive": True}}, "optional": False, "text": text, "effect": eff, "status": "auto"},
                {"kind": "trigger", "when": {"event": "costPaid", "sel": {"aggressive": True}}, "optional": False, "text": text, "effect": eff, "status": "auto"}]
    m = re.fullmatch(r"≪ブレイクしていないキャラクター全て≫の持つドロー\+Xのスキルと、エフェクト全てを無効化する。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"all": {"broken": False}}, "key": "skill", "op": "remove", "value": {"id": "draw"}}},
                  {"kind": "always", "text": text, "mod": {"to": {"all": {"broken": False}}, "key": "negate", "op": "grant", "value": {"effects": True}}}]
    m = re.fullmatch(r"≪(ネームを持つ|ネームを持たない)?(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のブレイクカードのコスト≫は、?オーナーの手札に戻る。?", text)   # A3-14 2026 (Revise#165)
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "dest", "op": "dest", "value": dict({"cost": "set", "type": "Break", "faction": FACTION_JP[m.group(2)], "to": "hand"}, **({"named": m.group(1) == "ネームを持つ"} if m.group(1) else {}))}}]
    m = re.fullmatch(r"≪(.+?)のブレイクカードのコスト≫はオーナーの手札に戻る。?", text)
    if m and class_tokens(m.group(1)) and len(class_tokens(m.group(1))) == len(m.group(1).split("・")):
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "dest", "op": "dest", "value": {"cost": "set", "type": "Break", "icons": class_tokens(m.group(1)), "to": "hand"}}}]
    m = re.fullmatch(r"≪このキャラクター≫は、((?:E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)(?:・(?:E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー))*)のキャラクターとのバトルによるダメージを受けない。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "noDamage", "op": "grant", "value": {"battle": True, "fromSel": {"faction": [FACTION_JP[f] for f in m.group(1).split("・")]}}}}]
    if re.fullmatch(r"≪パワー0のキャラクター≫が捨て札される場合、このキャラクターのパワーカード1枚をあなたのダメージ置き場に置くことで、そのキャラクターを場に残すことが(?:でき|可能)(?:る)?。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "demonKeep", "op": "grant", "value": {"power0": True}}}]
    m = re.fullmatch(r"≪あなたの支配キャラクターの(.+?)≫が捨て札(?:され|にな)る場合、このキャラクターのパワーカード1枚を(?:あなたの)?ダメージ置き場に置くことで、そのキャラクターを場に残すことが(?:でき|可能)(?:る)?。?", text)
    if m and class_tokens(m.group(1)): return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "demonKeep", "op": "grant", "value": {"icons": class_tokens(m.group(1))}}}]
    if re.fullmatch(r"あなたのメインフェイズ開始時に、≪あなたの捨て札置き場にあるカード1枚≫をあなたの手札に加えることが可能。?", text):
        return [{"kind": "trigger", "when": {"event": "phaseStart", "phase": "main", "mine": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "pickZone", "zones": ["discard"], "owner": "you", "sel": {}, "n": 1, "dest": "hand"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"≪このキャラクターのバトル相手≫は、バトル終了時に捨て札される。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "battleEndKill", "op": "grant", "value": True}}]
    if re.fullmatch(r"ターン開始時に、≪全てのプレイヤーのデッキの一番上のカード1枚≫を捨て札する。?", text):
        return [{"kind": "trigger", "when": {"event": "turnStart"}, "optional": False, "text": text, "effect": {"steps": [{"a": "mill", "to": "players", "n": 1}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"≪アタック宣言またはガード宣言した、▼を持つブレイクしていないキャラクター≫を捨て札する。?", text):
        return [{"kind": "trigger", "when": {"event": "battleDeclared", "sel": {"aggressive": True, "broken": False}}, "optional": False, "text": text, "effect": {"steps": [{"a": "discard", "to": "evCh"}], "status": "auto"}, "status": "auto"}]
    # ---- M2c batch 3 (Revise#137) ----
    if text.rstrip("。") == "このキャラクターが支配キャラクターとバトルするか、あなたの対戦相手にアタックする場合、このキャラクターにセットされているパーマネントカード1枚を捨て札置き場に置き、≪あなたの任意のあなたの手札のXコスト以下のパーマネントカード1枚≫を、このキャラクターにセット可能。Xはこの効果で捨て札置き場に置いたパーマネントカードのコストに等しい":   # 千場イリヤ
        eff = {"steps": [{"a": "permSwap"}], "status": "auto"}
        return [{"kind": "trigger", "when": {"event": "battleStart", "self": True, "vsCtl": True}, "optional": True, "text": text, "effect": eff, "status": "auto"},
                {"kind": "trigger", "when": {"event": "attack", "self": True, "toPlayer": True}, "optional": True, "text": text, "effect": eff, "status": "auto"}]
    if re.fullmatch(r"あなたがドローする際、ドローする前に、≪あなたのデッキのカードを上からX枚≫見て、そのカード全てを、あなたの任意の順番であなたのデッキの上か下に置くことができる。?(?:Xはあなたがドローするカード枚数に等しい。?)?", text):   # 趙鏡香
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "drawPeek", "op": "grant", "value": True}}]
    if re.fullmatch(r"このキャラクターのバインドXは、捨て札したあなたの支配キャラクター1人につき、このキャラクターにセットされているパワーカード1枚をダメージ置き場に置いたものとして使用可能。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "bindSac", "op": "grant", "value": True}}]
    m = re.fullmatch(r"パワー(\d+)以上のあなたの支配キャラクター1人を捨て札することで、≪このキャラクター≫から1コストを支払ったものとして扱うことができる。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "sacPay", "op": "grant", "value": {"minPower": int(m.group(1))}}}]
    if re.fullmatch(r"このキャラクターのエフェクトは、捨て札したあなたの支配キャラクター1人につき1コストを支払ったものとして使用宣言可能。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "sacPay", "op": "grant", "value": {"kinds": ["effect"]}}}]
    if re.fullmatch(r"あなたの任意のあなたの手札X枚を捨て札することで、≪このキャラクター≫からブーストのコストを支払ったものとして扱うことができる。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "handBoost", "op": "grant", "value": True}}]
    m = re.fullmatch(r"≪アタック宣言またはガード宣言した、(ネームを持つ|ブレイクしていない)キャラクター≫は、そのキャラクターがバトルするか、プレイヤーにアタックするまで([±+\-]\d+|±0|[+\-]X)/([+\-]X)/([+\-]X)して判定する。宣言が取り消された場合、この効果は無効化される。?(?:(Xは[^。]+に等しい)。?)?", text)   # ダニエル・ポーラン
    if m:
        xd = x_def(m.group(5)) if m.group(5) else None
        sel = {"named": True} if m.group(1) == "ネームを持つ" else {"broken": False}
        out = []
        for key, g in (("se", 2), ("at", 3), ("de", 4)):
            v = m.group(g)
            if v in ("±0", "+0"): continue
            if "X" in v and xd: out.append({"kind": "always", "text": text, "mod": {"to": {"all": sel}, "key": key, "op": "add", "value": {"x": xd, "sign": -1 if v.startswith("-") else 1}}, "cond": {"targetDeclared": True}})
        if out: return out
    m = re.fullmatch(r"ネーム・分類に関わらず、≪このキャラクター≫を[“\"]([^”\"]+)[”\"]でブレイク可能。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "breakByName", "op": "grant", "value": {"name": m.group(1)}}}]
    if re.fullmatch(r"≪あなたの対戦相手の支配キャラクター全て≫の、このキャラクターのパワー以下のコストのエフェクト全てを無効化する。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "effCostCap", "op": "grant", "value": True}}]
    m = re.fullmatch(r"このカードが場にセットされた場合、≪ブレイクしていないあなたの支配キャラクターにセットされているパワーカード全て≫をこのキャラクターにセットし、≪ブレイクしていないあなたの対戦相手の支配キャラクターにセットされている(パワーカード|カード)全て≫を捨て札する。?", text)
    if m: return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [dict({"a": "gatherPower"}, **({"oppAll": True} if m.group(1) == "カード" else {}))], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "このカードが場にセットされた場合、≪あなたの任意のあなたの手札のパーマネントカード1枚≫を、このキャラクター以外の、あなたの支配エリアのネームレベルキャラクター1人にセット可能":
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "handPermToChar", "sel": {"named": True}}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"≪あなた≫は、パーマネントカードをファストカードのタイミングで、このキャラクターにセット宣言可能。?(?:Xは[^。]+に等しい。?)?", text):   # マシット
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "fastPerm", "op": "grant", "value": True}}]
    if re.fullmatch(r"≪このキャラクターから支払われたコストの中にある、ネームを持たないイレイザーまたはイレイザー♂を持つブレイクカードまたはキャラクターカード≫を、あなたの支配キャラクターとしてセットする。?", text):   # ラドゥエリエル
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "costToChars", "op": "grant", "value": True}}]
    m = re.fullmatch(r"このキャラクターがバトルする際、あなたの任意の枚数のあなたの手札のブレイクカードを捨て札してもよい。そうした場合、そのバトルの際、≪このキャラクター≫に±0/\+X/\+Xして判定する。Xはこの効果で捨て札したカードの必要ファクターの合計に等しい。?", text)   # ュルョラック
    if m: return [{"kind": "trigger", "when": {"event": "battleStart", "self": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "discardTypeX", "types": ["Break"], "any": True, "upTo": True}, {"a": "mod", "to": "self", "mod": {"key": "at", "op": "add", "value": {"xlast": True, "sign": 1}}, "until": "battle"}, {"a": "mod", "to": "self", "mod": {"key": "de", "op": "add", "value": {"xlast": True, "sign": 1}}, "until": "battle"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"≪ブレイクカード以外のコストを支払ったブレイクしていないキャラクターとそのオーナー≫に、1ダメージを与える。?", text):
        return [{"kind": "trigger", "when": {"event": "costPaid", "kindNot": "Break", "unbroken": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "damage", "to": "evCh", "n": 1}, {"a": "damage", "to": "evPlayer", "n": 1}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このキャラクターのパワーが(\d+)の状態で、このキャラクターがバトルするか、プレイヤーにアタックする場合、≪このキャラクター≫の攻撃力に\+(\d+)して判定する。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "at", "op": "add", "value": int(m.group(2))}, "cond": {"all": [{"selfPowerIs": int(m.group(1))}, {"battleOrAttackPlayer": True}]}}]
    m = re.fullmatch(r"≪あなたの支配キャラクターの(.+?)≫が捨て札される場合、このキャラクターのパワーカード1枚をあなたのダメージ置き場に置くことで、そのキャラクターを場に残すことができる。?", text)
    if m and class_tokens(m.group(1)): return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "demonKeep", "op": "grant", "value": {"icons": class_tokens(m.group(1))}}}]
    m = re.fullmatch(r"あなたのメインフェイズ開始時に、あなたのデッキの一番上からカードX枚を引き、パワーカードとして≪あなたの任意のあなたのテリトリーのキャラクターX体≫に1枚ずつセットする。(Xは[^。]+に等しい)。?", text)
    if m and x_def(m.group(1)): return [{"kind": "trigger", "when": {"event": "phaseStart", "phase": "main", "mine": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "spreadPower"}], "x": x_def(m.group(1)), "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"このキャラクターから支払われたブーストのコスト1につき、≪このキャラクター≫の攻撃力に\+2して判定する。?(?:Xは[^。]+に等しい。?)?", text):
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "boostAtk", "op": "grant", "value": {"per": 2}}}]
    # ---- M2c (Revise#134) ----
    if re.fullmatch(r"あなたが使用宣言したブレイクカードがセットされた場合、≪あなた≫は、パワーカードフェイズ終了時まで、セットしたブレイクカード1枚につきチャージ1を得る。?", text):
        return [{"kind": "trigger", "when": {"event": "enter", "ownBreak": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "field", "mod": {"to": "you", "key": "charge", "op": "add", "value": 1, "until": "charge"}}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "メインフェイズ終了時まで、≪このキャラクターからダメージを受けたキャラクター≫はアタック宣言・ガード宣言できず、そのキャラクターの持つスキル・エフェクト全てを無効化する":   # 流菜
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "hurtMark", "op": "grant", "value": [{"key": "noAttack", "value": True}, {"key": "noGuard", "value": True}, {"key": "negate", "value": {"skills": True, "effects": True}}]}}]
    if re.fullmatch(r"≪このキャラクターからダメージを受けたキャラクター≫は、?ターン終了時まで、?そのキャラクターの持つスキル全てが無効化される。?", text):   # A3-EP EP375 (Revise#210)
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "hurtMark", "op": "grant", "value": [{"key": "negate", "value": {"skills": True}, "until": "turn"}]}}]
    if re.fullmatch(r"メインフェイズ終了時まで、≪このキャラクターからダメージを受けたキャラクター≫の攻撃力に[-ー−]1(?:・[-ー−]\(1\))?して判定する。?", text):   # リーナ・スピカ
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "hurtMark", "op": "grant", "value": [{"key": "at", "op": "add", "value": -1}]}}]
    if re.fullmatch(r"このキャラクター以外のあなたの支配キャラクターか、このキャラクターのオーナーに与えられたダメージは、≪このキャラクター≫が代わりに受ける。?", text):   # ノーラン・トライアンフ
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "takeForAllies", "op": "grant", "value": True}}]
    if re.fullmatch(r"≪プレイヤー全て≫は、ドローしたカードをあなたに見せる。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "seeDraws", "op": "grant", "value": True}}]
    m = re.fullmatch(r"≪このキャラクターのアタックを受けたプレイヤー≫は、手札全てをあなたに見せる。あなたは、その中から(X|\d+)枚を選んでそのオーナーのダメージ置き場に置く。?(?:(Xは[^。]+に等しい)。?)?", text)
    if m and (m.group(1) != "X" or (m.group(2) and x_def(m.group(2)))):
        return [{"kind": "trigger", "when": {"event": "attack", "self": True, "toPlayer": True}, "optional": False, "text": text, "effect": dict({"steps": [{"a": "handTake", "to": "attackedPlayer", "see": "all", "n": "X" if m.group(1) == "X" else int(m.group(1)), "dest": "damage"}], "status": "auto"}, **({"x": x_def(m.group(2))} if m.group(1) == "X" else {})), "status": "auto"}]
    if re.fullmatch(r"≪ダメージ置き場に置かれているカード全て≫のテキストを無効化する。?(?:Xは[^。]+に等しい。?)?", text):
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "damageTextOff", "op": "grant", "value": True}}]
    m = re.fullmatch(r"≪(.+?)全て≫は、バトルの際、本来の攻撃力に加えて、そのキャラクターの持つ精神攻撃力の数値に等しい数値の通常攻撃力を持つ。?", text)
    if m and class_tokens(m.group(1)) and len(class_tokens(m.group(1))) == len(re.split(r"[・]", m.group(1))):
        return [{"kind": "always", "text": text, "mod": {"to": {"all": {"icons": class_tokens(m.group(1))}}, "key": "dualAtk", "op": "grant", "value": True}}]
    m = re.fullmatch(r"≪アタック宣言またはガード宣言した、対戦相手のテリトリーのキャラクター≫に(X|\d+)ダメージを与える。?(?:(Xは[^。]+に等しい)。?)?", text)
    if m and (m.group(1) != "X" or (m.group(2) and x_def(m.group(2)))):
        return [{"kind": "trigger", "when": {"event": "battleDeclared", "opp": True}, "optional": False, "text": text, "effect": dict({"steps": [{"a": "damage", "to": "evCh", "n": "X" if m.group(1) == "X" else int(m.group(1))}], "status": "auto"}, **({"x": x_def(m.group(2))} if m.group(1) == "X" else {})), "status": "auto"}]
    if re.fullmatch(r"≪プレイヤー全て≫は自分のターンのメインフェイズ開始時に、自分の支配キャラクター1人を捨て札する。捨て札できなかった場合、≪そのプレイヤーと、そのプレイヤーの支配キャラクター全て≫に\(X\)ダメージを与える。(?:Xはこのキャラクターのパワーに等しい。?)?", text):   # トラロック
        return [{"kind": "trigger", "when": {"event": "phaseStart", "phase": "main"}, "optional": False, "text": text, "effect": {"steps": [{"a": "tributeOrHurt"}], "x": {"power": "self"}, "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"キャラクターが捨て札される場合、≪そのキャラクターを場に残す効果全て≫を無効化する。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "noKeepAll", "op": "grant", "value": True}}]
    if re.fullmatch(r"あなたの支配キャラクターが支配キャラクターとのバトルによって捨て札された場合、あなたのデッキの一番上のカード1枚を引き、パワーカードとして≪このキャラクター≫にセットする。?", text):
        return [{"kind": "trigger", "when": {"event": "leave", "battle": True, "own": True, "controlled": True, "byCtl": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "powerFromDeck", "to": "self", "n": 1}], "status": "auto"}, "status": "auto"}]
    # ---- M2b batch 5 (Revise#132): なつき / ふぶき / クロス・フレイム ----
    if re.fullmatch(r"あなたを目標としたアタック宣言に対してガード宣言が行われずにレスポンスの宣言が終了した場合、≪このキャラクター≫は、そのレスポンスの解決でアタック宣言を処理するキャラクター全てをガードする。このアビリティの効果でガードした場合、≪このキャラクター≫に±0/\+X/\+Xして判定する。(?:Xはあなたのダメージ置き場のカード枚数に等しい。?)?", text):   # リムノレイア (Revise#133)
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "autoGuard", "op": "grant", "value": True}}]
    if re.fullmatch(r"≪ブレイクしているキャラクター全て≫は、そのキャラクターを構成するキャラクターカードのスキル全てを持つ。?", text):   # 皆川麗夢
        return [{"kind": "always", "text": text, "mod": {"to": {"all": {"broken": True}}, "key": "stackCharSkills", "op": "grant", "value": True}}]
    m = re.fullmatch(r"このカードが(セットされた|除去された)場合、≪全てのプレイヤーのデッキ≫を裏返す。?", text)   # カッサンドラ
    if m: return [{"kind": "trigger", "when": {"event": "enter", "self": True} if m.group(1) == "セットされた" else {"event": "leave", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "flipDecks"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"≪キャラクター1人を目標とするプロジェクトカード・ファストカード・エフェクト≫の目標は、このキャラクターに変更される。?", text):   # 百式改
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "decoy", "op": "grant", "value": True}}]
    if re.fullmatch(r"≪キャラクターを対象とする、範囲のプロジェクトカード・ファストカード≫の対象は、このキャラクター1人に変更される。?", text): return []   # the same "decoy" modifier
    m = re.fullmatch(r"このカードがセットされた場合、≪[“\"]([^”\"]+)[”\"]または[“\"]([^”\"]+)[”\"]のネームを持つキャラクターを構成するカード全てと、そのキャラクターにセットされているカード全て≫をそのオーナーの手札に戻す。?", text)
    if m: return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "bounceAll", "to": {"all": {"anyName": [m.group(1), m.group(2)]}}}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"[“\"]([^”\"]+)[”\"]または[“\"]([^”\"]+)[”\"]のネームを持つカードは使用宣言できない。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "ban", "op": "ban", "value": {"decl": "set", "names": [m.group(1), m.group(2)]}}}]
    m = re.fullmatch(r"[”“\"]([^”“\"]+)[”\"]が([^“]+)[“\"]([^”\"]+)[”\"]にブレイクされる場合、ただちにこのキャラクターの精神力に等しいダメージを≪(キャラクター全て|あなたの対戦相手全て)≫に与える。その後、≪このキャラクターを構成するカード全てと、このキャラクターにセットされているカード全て≫をオーナーの手札に戻す。?", text)
    if m:
        to = {"all": {}} if m.group(4) == "キャラクター全て" else "opp"
        return [{"kind": "trigger", "when": {"event": "brokeBy", "byName": m.group(3), "prevName": m.group(1)}, "optional": False, "text": text, "effect": {"steps": [{"a": "damage", "to": to, "n": "X"}, {"a": "bounceAll", "to": "self"}], "x": {"selfStat": "se"}, "status": "auto"}, "status": "auto"}]
    # ---- M2b batch 4 (Revise#131) ----
    if re.fullmatch(r"≪このキャラクター≫は、範囲のプロジェクトカード・ファストカードの効果を受けない。?", text):   # 外園今日子
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "untargetable", "op": "grant", "value": {"from": ["Project", "Fast"], "areaOnly": True}}}]
    if re.fullmatch(r"≪このキャラクター≫は、スキル・エフェクトの効果を受けない。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "untargetable", "op": "grant", "value": {"from": ["Effect"]}}}]
    if re.fullmatch(r"≪このキャラクターを対象に含む、プロジェクトカード・ファストカード・エフェクト≫は効果を発揮しない。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "untargetable", "op": "grant", "value": {"from": ["Project", "Fast", "Effect"]}}}]
    if re.fullmatch(r"このキャラクターがバトルする際、≪このキャラクターのバトル相手を対象に含むプロジェクトカード・ファストカード・エフェクトと、このキャラクターのバトル相手のスキル・エフェクト全て≫を無効化する。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": {"all": {}}, "key": "battleOppNegate", "op": "grant", "value": True}}]
    if re.fullmatch(r"≪あなたにアタックしたキャラクター≫の攻撃力に[ー\-]\(X\)して判定する。(?:Xはこのキャラクターのパワーに等しい。?)?", text):   # 鹿島栞 (both lines → one ward)
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "shioriWard", "op": "grant", "value": True}}]
    if re.fullmatch(r"≪あなた≫が通常攻撃力の数値がX以上のキャラクターのアタックを受けた場合、通常のダメージ判定を行わず、アタックしたキャラクターの通常攻撃力の数値から-Xした数値に等しい枚数のカードを、あなたのデッキから捨て札する。(?:Xはこのキャラクターのパワーに等しい。?)?", text):
        return []   # handled by the ward above
    PH = {"ドロー": "draw", "勢力": "active", "メイン": "main", "パワーカード": "charge", "ディスカード": "discard"}
    m = re.fullmatch(r"≪(?:全てのプレイヤー|プレイヤー全て)≫は、自分のターンの通常の(ドロー|勢力|メイン|パワーカード|ディスカード)フェイズの(後|前)に、?追加の(ドロー|勢力|メイン|パワーカード|ディスカード)フェイズを行う。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "extraPhase", "op": "grant", "value": {("after" if m.group(2) == "後" else "before"): PH[m.group(1)], "phase": PH[m.group(3)]}}}]
    if re.fullmatch(r"≪このキャラクター≫からプロジェクトカード・ファストカード・エフェクトのコストを支払うことはできない。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "noPayFor", "op": "grant", "value": {"kinds": ["Project", "Fast", "effect"]}}}]
    if text.rstrip("。") == "このカードがセットされた場合、≪パーマネントカード全て≫を捨て札し、≪パワーが精神力に等しい、ブレイクしているキャラクター≫にセットされているパワーカード全てを、そのオーナーの手札に戻す":   # 飛
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "cardsOf", "to": {"all": {}}, "part": "perm", "all": True, "dest": "discard"}, {"a": "cardsOf", "to": {"all": {"powerEqMental": True, "broken": True}}, "part": "power", "all": True, "dest": "hand"}], "status": "auto"}, "status": "auto"}]
    if text.rstrip("。") == "このカードがセットされた場合、≪あなたのダメージ置き場のあなたの任意のパーマネントカード1枚≫を、あなたの任意のあなたの支配キャラクター1人にセットできる":   # モルガン・ル・フェイ
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "pickZone", "zones": ["damage"], "owner": "you", "sel": {"types": ["Permanent"]}, "n": 1, "dest": "perm"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"≪パワー0のキャラクターにセットされているパーマネントカード全て≫を捨て札する。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "permZeroPower", "op": "grant", "value": True}}]
    if re.fullmatch(r"≪パーマネントカードをセットされているキャラクター≫が捨て札になる場合、セットされているパーマネントカード全てを、そのオーナーのダメージ置き場に置くことで、そのキャラクターを場に残すことができる。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "permKeep", "op": "grant", "value": True}}]
    if re.fullmatch(r"≪あなたの支配キャラクターの悪魔・悪魔♂≫が捨て札される場合、このキャラクターのパワーカード1枚をダメージ置き場に置くことで、そのキャラクターを場に残すことができる。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "demonKeep", "op": "grant", "value": True}}]
    # ---- M2b batch 3 (Revise#130) ----
    if re.fullmatch(r"≪全てのプレイヤー≫は、コストを支払う場合、一度に1人のキャラクターからしか支払えない。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "payOneChar", "op": "grant", "value": True}}]
    if re.fullmatch(r"≪全てのプレイヤー≫は、ブレイクしていないキャラクターから、プロジェクトカード・ファストカード・パーマネントカードのコストを支払うことはできない。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "noPayUnbroken", "op": "grant", "value": True}}]
    if re.fullmatch(r"このキャラクターのアタックによるダメージ判定でダメージ置き場にカードが1枚も置かれなかった場合、あなたのデッキの一番上のカード1枚を引き、≪このキャラクター≫にパワーカードとしてセットすることができる。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "zeroDmgPower", "op": "grant", "value": True}}]
    if re.fullmatch(r"このキャラクターが捨て札になる場合、≪このキャラクターと、あなたの捨て札置き場の上からX枚≫をあなたのデッキに戻し、そのデッキをシャッフルする。Xはこのキャラクターの精神力に等しい。?", text):   # 大海
        return [{"kind": "trigger", "when": {"event": "leave", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "leaveToDeckX"}], "x": {"evStat": "se"}, "status": "auto"}, "status": "auto"}]
    # ---- M2b batch 2 (Revise#129) ----
    if re.fullmatch(r"≪このキャラクターにセットされているパーマネントカード1枚≫を、アタックコスト・ガードコストの代わりに支払うことができる。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "altPay", "op": "grant", "value": {"kind": "perm"}}}]
    if text.rstrip("。") == "≪あなた≫は、あなたのデッキの上のカード2枚をあなたのダメージ置き場に置くことで、このキャラクターからアタックコスト・ガードコストを支払ったものとして扱うことが可能":   # A3-22 3269 (Revise#173)
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "altPay", "op": "grant", "value": {"kind": "deck2"}}}]
    m = re.fullmatch(r"このカードを捨て札することで、≪このキャラクター≫から(アタックコスト|ガードコスト|アタックコストまたはガードコスト)を支払ったものとして扱うことができる。?", text)   # A3-08 1280 / 1283 (Revise#170)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "altPay", "op": "grant", "value": {"kind": "perm", "self": True, "kinds": (["attack"] if "アタック" in m.group(1) else []) + (["guard"] if "ガード" in m.group(1) else [])}}}]
    m = re.fullmatch(r"(メインフェイズ終了時まで、)?あなたの任意のあなたの手札1枚をあなたのダメージ置き場に置くことで、≪このキャラクター≫からアタックコストまたはガードコストを支払ったものとして扱うことができる。?(?:Xは[^。]+に等しい。?)?", text)
    if m and not m.group(1): return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "altPay", "op": "grant", "value": {"kind": "hand"}}}]
    if text.rstrip("。") == "このキャラクターのアタック宣言に対して支配キャラクターがガード宣言した場合、≪ガード宣言したキャラクターのオーナーのダメージ置き場の、あなたの任意のカード1枚≫を捨て札する":   # ラファエル
        return [{"kind": "trigger", "when": {"event": "guarded", "self": True, "asAttacker": True, "guardSel": {"area": "controlled"}}, "optional": False, "text": text, "effect": {"steps": [{"a": "pickZone", "dest": "discard", "zone": "damage", "owner": "evOwner", "sel": {}, "n": 1}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪全てのプレイヤー≫は、ダメージ置き場に置かれている((?:プロジェクト|ファスト|パーマネント)カード(?:・(?:プロジェクト|ファスト|パーマネント)カード)*)と同じ名称のカードを使用宣言することができない。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "ban", "op": "ban", "value": {"decl": "set", "damageTypes": [CARD_TYPES_JP[t.replace("カード", "")] for t in m.group(1).split("・")]}}}]
    m = re.fullmatch(r"このカードがセットされた場合、≪あなたのデッキ≫から“([^”]+)”のネームを持つパーマネントカード1枚を手札に加える。?", text)   # A3-EX05 EX0595 (Revise#366)
    if m:
        nm_ = re.sub(r"\s+", "", m.group(1))
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "pickZone", "zones": ["deck"], "owner": "you", "n": 1, "sel": {"anyOf": [{"types": ["Permanent"], "name": nm_}, {"types": ["Permanent"], "jpHas": nm_}]}, "dest": "hand"}, {"a": "shuffle", "to": "you"}], "status": "auto"}, "status": "auto"}]
    # ---- Revise#369 ----
    m = re.fullmatch(r"このカードがダメージ置き場に置かれている状態で、あなたの支配キャラクターが対戦相手の支配キャラクターとのバトルまたは対戦相手の使用したカードの効果で捨て札された場合、≪このカード≫をあなたの支配エリアの“([^”]+)”にセット可能。?", text)   # A3-EP EP372
    if m: return [{"kind": "trigger", "zones": ["damage"], "when": {"event": "leave", "own": True, "controlled": True, "oppCause": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "thisCardPermOnto", "sel": {"name": re.sub(r"\s+", "", m.group(1))}}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"≪このキャラクター≫は、対戦相手の使用したX以下のコストのプロジェクトカード・ファストカード・エフェクトの効果を受けず、パワーX以下のキャラクターとのバトルによるダメージを受けない。Xはこのキャラクターのパワーに等しい。?", text):   # A4-EX02 EX912
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "untargetable", "op": "grant", "value": {"from": ["Project", "Fast", "Effect"], "byOpp": True, "costMaxPower": True}}}, {"kind": "always", "text": text, "mod": {"to": "self", "key": "noDamage", "op": "grant", "value": {"battle": True, "fromSel": {"powerLeSelf": True}}}}]
    # ---- Revise#368 ----
    m = re.fullmatch(r"“([^”]+)”にセット宣言する場合、≪このカード≫のコストを無視し、セットされた際に≪キャラクター1人≫にXダメージを与える。(Xは[^。]+に等しい)。?", text)   # A4-04 0785
    if m and x_def(m.group(2)):
        c["freeOnName"] = re.sub(r"\s+", "", m.group(1))
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "cond": {"belowPName": re.sub(r"\s+", "", m.group(1))}, "optional": False, "text": text, "effect": {"steps": [{"a": "pickCharDamage", "sel": {}, "n": "X"}], "x": x_def(m.group(2)), "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカードが本来の精神力が(\d+)以上の“([^”]+)”にセットされている場合、≪このキャラクター≫は\+(\d+)/\+(\d+)/\+(\d+)され、このキャラクターがバトルする際、≪このキャラクターのバトル相手≫の持つバインドXのスキルを無効化する。?", text)   # A4-EP EP440
    if m:
        cd = {"selfIs": {"name": re.sub(r"\s+", "", m.group(2)), "baseStat": [{"key": "se", "op": ">=", "n": int(m.group(1))}]}}
        return [{"kind": "always", "text": text, "cond": cd, "mod": {"to": "self", "key": k, "op": "add", "value": int(m.group(g))}} for k, g in (("se", 3), ("at", 4), ("de", 5))] + [{"kind": "always", "text": text, "cond": {"all": [cd, {"self": "inBattle"}]}, "mod": {"to": "battleOpp", "key": "skill", "op": "remove", "value": {"id": "bind"}}}]
    if re.fullmatch(r"このキャラクターがバトルによってキャラクターを捨て札した場合、≪捨て札したキャラクターのオーナー、またはそのオーナーの支配キャラクタ.1人≫にXダメージを与える。Xは捨て札したキャラクターを構成するカード枚数と、そのキャラクターにセットされていたカード枚数の合計に等しい。?", text):   # A4-02 0342
        return [{"kind": "trigger", "when": {"event": "killed"}, "optional": False, "text": text, "effect": {"steps": [{"a": "killHitOwnerSide"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"支配キャラクターとのバトルによって、このカードをセットされている“([^”]+)”がバトル相手のネームレベルキャラクターを捨て札する場合、あなたのデッキの一番上のカード(\d+)枚を引き、パワーカードとして≪このキャラクター≫にセットする。?", text)   # A3-EX01 EX0058
    if m: return [{"kind": "trigger", "when": {"event": "killed", "controlled": True, "namedVictim": True}, "cond": {"selfIs": {"name": re.sub(r"\s+", "", m.group(1))}}, "optional": False, "text": text, "effect": {"steps": [{"a": "powerFromDeck", "to": "self", "n": int(m.group(2))}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"このカードがダメージ判定によってダメージ置き場に置かれた際、あなたがこのカードの必要ファクターを満たしていた場合、≪このカード≫をコストを支払ってあなたの支配キャラクターにセット可能。≪その際に支払ったコスト≫は手札に戻る。?", text):   # A3-25 3799 (its cost goes back to the hand anyway: the card's first line)
        return [{"kind": "trigger", "zone": "damage", "when": {"event": "selfToDamage", "byCheck": True}, "cond": {"cardFactorMet": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "selfDeclFree", "paid": True}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"“([^”]+)”がいる状態でこのカードが捨て札になる場合、≪あなたの手札の、ブレイク条件のない、(.+?)を持つブレイクカード1枚≫を、あなたの支配キャラクターとしてセット可能。?", text)   # A3-17 2358
    if m and class_tokens(m.group(2).replace("または", "・")):
        return [{"kind": "trigger", "when": {"event": "leave", "self": True}, "cond": {"fieldName": re.sub(r"\s+", "", m.group(1))}, "optional": True, "text": text, "effect": {"steps": [{"a": "pickZone", "zones": ["hand"], "owner": "you", "n": 1, "upTo": True, "sel": {"types": ["Break"], "noBreakRule": True, "icons": class_tokens(m.group(2).replace("または", "・"))}, "dest": "back"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このキャラクターに、“([^”]+)”のブレイクカードを、あなたのターンのプロジェクトカードのタイミング(?:で)?セット宣言した場合、セットされた後、≪このキャラクター≫はコストを支払わずにアタック宣言可能。?", text)   # A3-EX03 EX0292
    if m: return [{"kind": "trigger", "when": {"event": "broken", "self": True, "own": True, "cardName": re.sub(r"\s+", "", m.group(1)).replace("Ｔ", "T")}, "cond": {"myTurn": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "makeAttack", "self": True}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"このキャラクターがあなた以外のプレイヤーが使用したプロジェクトカード・ファストカード・エフェクトの効果でバトル以外のダメージを受けた場合、あなたのデッキの上から、受けたダメージに等しい枚数のカードを引いて、パワーカードとして≪このキャラクター≫にセットする。?", text):   # A4-EX02 EX865
        return [{"kind": "trigger", "when": {"event": "damaged", "self": True, "nonBattle": True, "byOppSeat": True, "hurt": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "powerFromDeck", "to": "self", "n": "evN"}], "status": "auto"}, "status": "auto"}]
    # ---- Revise#367 (2) ----
    m = re.fullmatch(r"≪このカード≫のコストは、あなたの支配エリアの(武蔵|英国|三征西班牙|K\\.P\\.A\\.Italia|六護式仏蘭西|M\\.H\\.R\\.R\\.|P\\.A\\.Oda|上越露西亜|清武田|IZUMO|三河)を持つキャラクター分減少する。?", text)   # A4-EX02 EX910
    if m: c["costLess"] = {"countChars": {"owner": "you", "area": "controlled", "tag": m.group(1)}}; return []
    m = re.fullmatch(r"このカードがセットされた場合、≪あなた≫は、あなたの手札の(武蔵|英国|三征西班牙|K\\.P\\.A\\.Italia|六護式仏蘭西|M\\.H\\.R\\.R\\.|P\\.A\\.Oda|上越露西亜|清武田|IZUMO|三河)を持つブレイクカードを任意の枚数公開することが可能。その後、それらを必要ファクター・コストを無視してセット宣言可能。?", text)   # A4-EX02 EX910
    if m: return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "effDecl", "zones": ["hand"], "types": ["Break"], "tag": m.group(1), "ignoreFactor": True, "freeCost": True, "repeat": True, "anyChar": True}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカードが(.+?)以外のキャラクターにセットされている場合、≪このカード≫を捨て札する。?", text)   # A3-22 3125: checked when it is set
    if m and class_tokens(m.group(1)): return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "cond": {"not": {"selfIs": {"icons": class_tokens(m.group(1))}}}, "optional": False, "text": text, "effect": {"steps": [{"a": "selfCardDiscard"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"あなたのメインフェイズ開始時、≪あなたのダメージ置き場または捨て札置き場またはデッキ≫から、このカードと同じ名称のカードを1枚選び、あなたの支配キャラクターにセットする。?", text):   # A3-22 3125
        return [{"kind": "trigger", "when": {"event": "phaseStart", "phase": "main", "mine": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "pickZone", "zones": ["damage", "discard", "deck"], "owner": "you", "n": 1, "sel": {"sameJpAsSrc": True}, "dest": "perm"}], "status": "auto"}, "status": "auto"}]
    # ---- Revise#367 ----
    if re.fullmatch(r"≪対戦相手の支配キャラクター≫は、このキャラクターを目標にアタック宣言可能。?", text):   # A3-EP EP378
        return [{"kind": "always", "text": text, "mod": {"to": {"all": {"owner": "opp", "area": "controlled"}}, "key": "attackChars", "op": "grant", "value": {"srcCh": True}}}]
    m = re.fullmatch(r"≪このキャラクターを目標にアタック宣言している、あなたの支配キャラクターにガード宣言されたキャラクター≫に(\()?X\)?ダメージを与える。(Xは[^。]+に等しい)。?", text)   # A3-EP EP378
    if m and x_def(m.group(2)): return [{"kind": "trigger", "when": {"event": "guarded", "attackOnSelf": True, "guardOwn": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "damage", "to": "battleAttacker", "n": "X", "mental": bool(m.group(1))}], "x": x_def(m.group(2)), "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカードがセットされた場合、自身以外のキャラクター1人を指定可能。≪指定されたキャラクター≫は(.+?)を得、\+(\d+)/\+\(?(\d+)\)?(?:・\+\d+)?/\+(\d+)される。?", text)   # A4-05 0876 / 0894
    if m and skills_list(m.group(1)): return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "pickOtherBless", "skills": skills_list(m.group(1)), "stats": {"se": int(m.group(2)), "at": int(m.group(3)), "de": int(m.group(4))}}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"≪あなた≫は、各ターンに1度だけ、プロジェクトカードをファストカードのタイミングで使用宣言可能。?", text):   # A4-05 0876 / 0894
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "projFastTurn", "op": "grant", "value": True}}]
    m = re.fullmatch(r"このカードがカード名称に「([^」]+)」を含むパーマネントカードがセットされた“([^”]+)”にセットされた場合、精神力に等しくなるまであなたのデッキの上からカードを引いて、≪このキャラクター≫にパワーカードとしてセットする。?", text)   # A4-EX02 EX911
    if m: return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "cond": {"all": [{"selfIs": {"name": re.sub(r"\s+", "", m.group(2))}}, {"selfPermSel": {"jpHas": m.group(1)}}]}, "optional": False, "text": text, "effect": {"steps": [{"a": "fillPowerT", "to": "self"}], "status": "auto"}, "status": "auto"}]
    # ---- Revise#366 (2) ----
    nq = lambda x: re.sub(r"\s+", "", x)
    m = re.fullmatch(r"≪“([^”]+)”と同じエリアにいるこのキャラクターをガード宣言するキャラクター≫のガードコストは(\d+)上昇する。?", text)   # A4-EX02 EX802
    if m: return [{"kind": "always", "text": text, "cond": {"sameArea": {"name": nq(m.group(1))}}, "mod": {"to": "self", "key": "guardTaxVs", "op": "add", "value": int(m.group(2))}}]
    m = re.fullmatch(r"≪シンクロによるアタック宣言またはガード宣言を同時にしている“([^”]+)”と“([^”]+)”≫は、バトルによるダメージを受けない。?", text)   # A4-EX02 EX803
    if m: return [{"kind": "always", "text": text, "cond": {"namesSameSide": [nq(m.group(1)), nq(m.group(2))]}, "mod": {"to": {"all": {"names": [nq(m.group(1)), nq(m.group(2))]}}, "key": "noDamage", "op": "grant", "value": {"battle": True}}}]
    m = re.fullmatch(r"このキャラクターがあなたの支配エリアの“([^”]+)”と同じバトル相手とバトルしている場合、≪あなたの支配エリアの“([^”]+)”と“([^”]+)”≫の(攻撃力|耐久力|精神力)に\+(\d+)して判定する。?", text)   # A4-EX01 EX0669 / EX0672
    if m: return [{"kind": "always", "text": text, "cond": {"battleSideWith": nq(m.group(1))}, "mod": {"to": {"all": {"owner": "you", "area": "controlled", "names": [nq(m.group(2)), nq(m.group(3))]}}, "key": STAT_JP[m.group(4)], "op": "add", "value": int(m.group(5))}}]
    # ---- Revise#364 ----
    m = re.fullmatch(r"あなたのターン終了時に、≪あなたの任意の対戦相手のデッキ≫の上からカードX枚を捨て札する。(Xは[^。]+に等しい)。?", text)   # A4-PP PP270 / PP278
    if m and x_def(m.group(1)): return [{"kind": "trigger", "when": {"event": "turnEnd", "mine": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "millPickOpp", "n": "X"}], "x": x_def(m.group(1)), "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカードがセットされた際、≪あなた≫は、あなたの手札を任意の枚数、このキャラクターの下に(.+?)としてセット可能。?", text)   # A4-EX02 EX806
    if m: return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "handPermToken", "token": {"name": m.group(1)}, "any": True}], "status": "auto"}, "status": "auto"}]
    # ---- Revise#359 ----
    m = re.fullmatch(r"このカードがセットされた場合、≪このカードのコストの中にある(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)の(.+?)を持つキャラクターカード≫を、あなたの支配キャラクターとしてセットする。?", text)   # A4-PP PP299
    if m and class_tokens(m.group(2)):
        c["costCharsOnSet"] = {"types": ["Character"], "faction": FACTION_JP.get(m.group(1)) or FACTION_JP[m.group(1).replace("ー", "-")], "icons": class_tokens(m.group(2))}
        return []
    if re.fullmatch(r"このカードがセットされた場合、≪あなたのダメージ置き場または捨て札置き場にある、攻撃力と耐久力を同時に上昇させる効果を持つファストカード1枚≫を手札に戻すことが可能。?", text):   # A4-05 0907 / 0925: a Fast card whose text raises Attack and Defense together
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "pickZone", "zones": ["damage", "discard"], "owner": "you", "n": 1, "upTo": True, "sel": {"types": ["Fast"], "textRe": "/[+＋]\\(?(?:\\d+|X)\\)?/[+＋](?:\\d+|X)|攻撃力と耐久力に[+＋]"}, "dest": "hand"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"(あなたが[EW阿ダ極イ]+を満たしている場合)、このカードがセットされた際≪パワー0のキャラクタ.1人≫を捨て札し、このキャラクターは「(\d+)[:：](.+?)」を得る。?", text)   # A4-03 0407 / 0422
    if m and cond_of(m.group(1)):
        g_ = parse_ability(m.group(1) + "、≪このキャラクター≫は「" + m.group(2) + ":" + m.group(3).replace("キャラクタ-", "キャラクター") + "」を得る。", c)
        if g_ and all(x.get("status", "auto") == "auto" for x in g_):
            return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "cond": cond_of(m.group(1)), "optional": False, "text": text, "effect": {"steps": [{"a": "pickCharAll", "sel": {"power": {"op": "=", "n": 0}}}], "status": "auto"}, "status": "auto"}] + [dict(x, text=text) for x in g_]
    m = re.fullmatch(r"このカードがセットされた場合、≪あなたの任意のあなたの支配エリアのブレイクしていない(.+?)を構成するカード全て≫を、このキャラクターのパワーカードとしてセット可能。?", text)   # A4-05 0983 / 1001
    if m and class_tokens(m.group(1)): return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "pickCharToPower", "multi": True, "sel": {"broken": False, "icons": class_tokens(m.group(1))}}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"(?:チャージ\d+\s*)?支配キャラクターのアタックによるダメージ判定でこのカードがセットされた場合、≪あなた≫に(\()?(\d+)\)?ダメージを与える。?", text)   # A4-03 0465 (Revise#360)
    if m: return [{"kind": "trigger", "when": {"event": "enter", "self": True, "fromDamage": True, "byAttackCtl": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "damage", "to": "you", "n": int(m.group(2)), "mental": bool(m.group(1))}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカードがセットされた場合、≪あなた≫は、あなたの任意の数を1つ指定する。≪対戦相手全て≫は、指定した数のコストの((?:(?:パーマネント|プロジェクト|ファスト|ブレイク)カード・?)+)は使用宣言できない。?", text)   # A4-PP PP212 / PP220
    if m: return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "banCostPick", "types": [CARD_TYPES_JP[x] for x in re.findall(r"(パーマネント|プロジェクト|ファスト|ブレイク)カード", m.group(1))]}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"ターン終了時に、≪あなたの手札1枚≫を、パーマネントカード・(.+?)として裏向きでこのキャラクターにセットする。?", text)   # A4-02 0211 / 0226
    if m: return [{"kind": "trigger", "when": {"event": "turnEnd"}, "optional": False, "text": text, "effect": {"steps": [{"a": "handPermToken", "token": {"name": m.group(1)}}], "status": "auto"}, "status": "auto"}]
    # ---- Revise#357 ----
    if re.fullmatch(r"≪このキャラクターのバトル相手≫の攻撃力の数値に[-ー−]Xして判定する。?", text):   # A4-EX01 EX0723: its X is written once, after the effect — "Xはこのキャラクターのパワーに等しい"
        return [{"kind": "always", "text": text, "mod": {"key": "at", "op": "add", "value": {"x": {"power": "self"}, "sign": -1}, "to": "battleOpp"}}]
    m = re.fullmatch(r"あなたを目標にアタック宣言が行われている状態でこのカードがセットされた場合、(ターン終了時まで、≪このキャラクター≫は.+)", text)   # A4-EP EP419
    if m:
        ab = parse_ability("このカードがセットされた場合、" + m.group(1), c)
        if ab and all(x.get("status") == "auto" and x.get("kind") == "trigger" for x in ab): return [dict(x, text=text, cond={"attackedYou": True}) for x in ab]
    if re.fullmatch(r"あなたのターン終了時に、≪このカード≫は手札に戻る。?", text): return [dict(x, text=text) for x in parse_ability("あなたのターン終了時に、≪このカード≫を手札に戻す。", c)]   # A4-EP EP419
    # ---- Revise#356 ----
    if re.fullmatch(r"ターン開始時に、このカードがあなたのダメージ置き場にある場合、≪このカード≫をあなたの支配キャラクターとしてコストを支払わずにセット宣言可能。?", text):   # A4-PP PP240 / PP248
        return [{"kind": "trigger", "zones": ["damage"], "when": {"event": "turnStart"}, "optional": True, "text": text, "effect": {"steps": [{"a": "thisCardFromDamage", "dest": "back"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪あなた≫は、このキャラクターにカード名称に「([^」]+)」を含むパーマネントカードをセット宣言する場合、そのカードの必要ファクターを無視してセット宣言可能。?", text)   # A4-EX01 EX0645 / EX0774
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "permNoFactor", "op": "grant", "value": {"jpHas": m.group(1)}}}]
    m = re.fullmatch(r"あなたが“([^”]+)”のネームを持つブレイクカードをセットした場合、そのキャラクターに≪あなたの手札の「(.+)」1枚≫をセット可能。?", text)   # A4-EX02 EX848
    if m: return [{"kind": "trigger", "when": {"event": "broken", "own": True, "cardName": re.sub(r"\s+", "", m.group(1))}, "optional": True, "text": text, "effect": {"steps": [{"a": "pickZone", "zones": ["hand"], "owner": "you", "sel": {"types": ["Permanent"], "jp": re.sub(r"\s+", "", m.group(2))}, "n": 1, "dest": "perm", "permOn": "evCh"}], "status": "auto"}, "status": "auto"}]
    # ---- Revise#355 ----
    if re.fullmatch(r"あなたのターン開始時に、≪あなたのデッキのカードを上からX枚≫見て、そのカード全てを、あなたの任意の順番であなたのデッキの上か下に置くことが可能。Xはあなたがドローフェイズにドローする枚数に等しい。?", text):   # A3-EX02 EX0177
        return [{"kind": "trigger", "when": {"event": "turnStart", "mine": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "peekTopBottom", "to": "you", "n": "X", "thenOrder": True}], "x": {"drawPhase": "you"}, "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"このキャラクターがバトルする際、≪このキャラクター≫はバトル相手の持つスキル全てを得る。?", text):   # A4-EP EP422
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "copyBattleOppSkills", "op": "grant", "value": True}}]
    m = re.fullmatch(r"このキャラクターがバトルする際、≪このキャラクター≫の精神力、通常攻撃力、耐久力のいずれか1つに\+(\d+)して判定する。?", text)   # A4-03 0540
    if m: return [{"kind": "trigger", "when": {"event": "battleStart", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "pickStat"}, {"a": "mod", "to": "self", "mod": {"key": "@stat", "op": "add", "value": int(m.group(1))}, "until": "battle"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"このカードがセットされた場合、≪あなたの支配キャラクター1人≫は、コストを支払わずにアタック宣言する。?", text):   # A4-PP PP359
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "pickMakeAttack"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪あなた≫は、(.+?)のブレイクカードを、必要ファクターが(\d+)減少した状態で、ファストカードのタイミングでセット宣言可能。?", text)   # A4-04 0771
    if m and class_tokens(m.group(1).replace("または", "・")) and len(class_tokens(m.group(1).replace("または", "・"))) == len(m.group(1).split("または")):
        ic = class_tokens(m.group(1).replace("または", "・"))
        return [{"kind": "always", "text": text, "mod": {"to": "you", "key": "fastBreak", "op": "grant", "value": {"icons": ic}}}, {"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "factorLess", "op": "add", "value": {"n": int(m.group(2)), "sel": {"types": ["Break"], "icons": ic}}}}]
    if re.fullmatch(r"このカードをあなたのターンのプロジェクトカードのタイミングで使用宣言した場合、セットされた後、≪このキャラクター≫は、あなたの任意のあなたの対戦相手1人に対してアタック宣言する。?", text):   # ジャンヌ・ダルク
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "cond": {"projDecl": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "makeAttack", "self": True}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"(≪[^≫]+≫)の(精神力|攻撃力|耐久力)に([+\-]\d+)し、([^。、]+?)を与える。?", text)   # "≪T≫の攻撃力に+1し、シンクロを与える"
    if m:
        a1, a2 = parse_ability(f"{m.group(1)}の{m.group(2)}に{m.group(3)}する。", c), parse_ability(f"{m.group(1)}に、{m.group(4)}を与える。", c)
        if a1 and a2: return [dict(x, text=text) for x in a1 + a2]
    if re.fullmatch(r"≪このカード≫は、このキャラクターにセットされてるパワーカード1枚として支払うことができる。その場合、≪このカード≫は、捨て札置き場ではなく、あなたのダメージ置き場に置かれる。?", text):   # A3-04 0652 (Revise#264)
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "altPay", "op": "grant", "value": {"kind": "perm", "self": True, "kinds": ["attack", "guard"], "to": "damage"}}}]
    m = re.fullmatch(r"このキャラクターがプレイヤーにアタックした場合、通常のダメージ判定の後、≪アタックを受けたプレイヤーのデッキ≫の上からカードを(\d+)枚捨て札する。?", text)   # A4-04 0739 / A4-PR PR087 (Revise#266)
    if m: return [{"kind": "trigger", "when": {"event": "hitPlayer", "by": "self"}, "optional": False, "text": text, "effect": {"steps": [{"a": "mill", "to": "evHit", "n": int(m.group(1))}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"≪このキャラクターにセット宣言するブレイクカードのコスト≫は(?:オーナーの)?手札に戻る。?", text):   # A4-04 0784 / 0786 (Revise#269)
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "dest", "op": "dest", "value": {"cost": "set", "type": "Break", "onTarget": "self", "to": "hand"}}}]
    m = re.fullmatch(r"≪あなた≫の、ダメージ置き場のカード枚数による敗北条件に\+(\d+)枚する。?", text)   # Revise#262
    if m: return [{"kind": "always", "text": text, "mod": {"to": "you", "key": "lossPlusP", "op": "grant", "value": int(m.group(1))}}]
    m = re.fullmatch(r"≪このキャラクターを支配しているプレイヤー≫の、ダメージ置き場のカード枚数による敗北条件に\+(\d+)枚する。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "lossPlus", "op": "grant", "value": int(m.group(1))}}]   # Revise#138
    if re.fullmatch(r"≪このキャラクターを支配しているプレイヤー≫の、ダメージ置き場のカード枚数による敗北条件に\+X枚する。Xはこのキャラクターの精神力に等しい。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "lossPlus", "op": "grant", "value": True}}]
    if re.fullmatch(r"このキャラクターのバインド1のスキルを使用した場合、≪あなたの捨て札置き場の一番上のカード1枚≫をあなたのデッキの一番上に置く。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "bindRecycle", "op": "grant", "value": True}}]
    m = re.fullmatch(r"あなたの対戦相手全ての手札枚数の合計が(\d+)枚以上の場合、≪このキャラクター≫に、(\d+)枚を超える1枚につき±0/\+1/\+1する。?", text)
    if m:
        cnd = {"xAtLeast": {"x": {"hand": "opp"}, "n": int(m.group(1))}}
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": k, "op": "add", "value": {"x": {"hand": "opp", "over": int(m.group(2))}, "sign": 1}}, "cond": cnd} for k in ("at", "de")]
    if re.fullmatch(r"≪エフェクト全て≫を無効化する。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": {"all": {}}, "key": "noEffect", "op": "grant", "value": True}}]
    if re.fullmatch(r"≪あなた≫は、ドローしなければならない場合に、ドローしないことを選択できる。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "mayNotDraw", "op": "grant", "value": True}}]
    if re.fullmatch(r"≪あなた≫は、あなたがチャージの効果でセットするカードの内容を見ることができる。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "seeCharge", "op": "grant", "value": True}}]
    m = re.fullmatch(r"(あなたの)?ターン開始時に、あなたの任意のあなたの手札X枚を捨て札することができる。このアビリティの効果によって手札を捨て札した場合、メインフェイズ終了時まで、≪このキャラクター≫の攻撃力に\+\(X\)する。?", text)
    if m: return [{"kind": "trigger", "when": dict({"event": "turnStart"}, **({"mine": True} if m.group(1) else {})), "optional": True, "text": text, "effect": {"steps": [{"a": "discardHandAnyX"}, {"a": "mod", "to": "self", "mod": {"key": "at", "op": "add", "value": {"xlast": True, "sign": 1}}, "until": "main"}], "status": "auto"}, "status": "auto"}]   # Revise#126
    if text.rstrip("。") == "このカードがセットされた場合、≪プレイヤー全ての手札全て≫を捨て札する":   # 女媧
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "discardHands"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このキャラクターが捨て札になる場合、≪プレイヤー全ての捨て札置き場のカード全て≫を、そのオーナーのデッキに戻し、そのデッキをシャッフルする。その後、あなた以外のプレイヤーのデッキの一番上のカード(\d+)枚を、そのプレイヤーのダメージ置き場に置く。?", text)
    if m: return [{"kind": "trigger", "when": {"event": "leave", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "discardsToDecks", "mill": int(m.group(1))}], "status": "auto"}, "status": "auto"}]
    # ---- M2a (Break A3-01 … A3-05) ----
    m = re.fullmatch(r"このキャラクターが(?:プレイヤーに)?アタックした場合、(?:≪(?:アタックされたプレイヤー|アタックを受けたプレイヤー)≫は)?通常のダメージ判定(を行わず|の後)、(.+?)。?", text)
    if m:   # an attack that hits a player: instead of / after the damage check (Revise#109)
        hit = player_hit(m.group(2), c)
        if hit: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "playerHit", "op": "grant", "value": dict(hit, replace=m.group(1) == "を行わず")}}]
    m = re.fullmatch(r"≪(プレイヤー全て|あなた|あなたの対戦相手全て|対戦相手全て)≫に(ドロー|キャパシティ)([+\-])X(?:を与える)。?(Xは[^。]+に等しい)。?", text)
    if m and x_def(m.group(4)): return [{"kind": "always", "text": text, "mod": {"to": {"players": {"プレイヤー全て": "all", "あなた": "you"}.get(m.group(1), "opponents")}, "key": "draw" if m.group(2) == "ドロー" else "handLimit", "op": "add", "value": {"x": x_def(m.group(4)), "sign": -1 if m.group(3) == "-" else 1}}}]
    m = re.fullmatch(r"≪(プレイヤー全て|あなた|あなたの対戦相手全て|対戦相手全て)≫に(ドロー|キャパシティ)([+\-]\d+)を与える。?", text)   # player skills: Draw ± / Capacity ±
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"players": {"プレイヤー全て": "all", "あなた": "you"}.get(m.group(1), "opponents")}, "key": "draw" if m.group(2) == "ドロー" else "handLimit", "op": "add", "value": int(m.group(3))}}]
    m = re.fullmatch(r"このキャラクターがバトルする際、バトル相手のパワ[ー-](\d+)につき、≪このキャラクター≫に([+\-±]\d+)/([+\-±]\d+)/([+\-±]\d+)して判定する。?", text)
    if m:
        out = []
        for key, g in (("se", 2), ("at", 3), ("de", 4)):
            v = sign_n(m.group(g))
            if v: out.append({"kind": "always", "text": text, "mod": {"to": "self", "key": key, "op": "add", "value": {"x": {"battleOppPower": True, "div": int(m.group(1))}, "sign": v}}, "cond": {"self": "inBattle"}})
        return out
    m = re.fullmatch(r"このキャラクターがバトルする際、バトル相手のパワ[ー-](\d+)につき、≪このキャラクター≫の(精神力|攻撃力|耐久力)に([+\-]\d+)して判定する。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": STAT_JP[m.group(2)], "op": "add", "value": {"x": {"battleOppPower": True, "div": int(m.group(1))}, "sign": sign_n(m.group(3))}}, "cond": {"self": "inBattle"}}]
    m = re.fullmatch(r"このキャラクターのパワーが(\d+)の場合、バトルの際、(≪.+)", text)
    if m:
        inner = parse_ability("このキャラクターがバトルする際、" + m.group(2), c)
        if inner:
            for ab in inner: ab["cond"] = {"all": [ab.get("cond") or {"self": "inBattle"}, {"selfPower": {"op": "=", "n": int(m.group(1))}}]}; ab["text"] = text
            return inner
    m = re.fullmatch(r"(?:(このキャラクターのパワーが(\d+)の場合)、)?≪([^≫]+)≫(?:の|は、?)アタック宣言・ガード宣言(?:を取り消す|は取り消される)。?", text)   # "≪パワー0のキャラクター≫のアタック宣言・ガード宣言を取り消す"
    if m:
        p0 = parse_target(m.group(3))
        if not p0 and m.group(3).endswith("キャラクター") and parse_selector(m.group(3)[:-6]) is not None: p0 = ("ref", {"all": parse_selector(m.group(3)[:-6])})
        to = "self" if m.group(3) in ("このキャラクターのアタック宣言", "このキャラクター") or (p0 and p0[0] == "ref" and p0[1] == "self") else p0[1] if p0 and p0[0] == "ref" and isinstance(p0[1], dict) else None
        if m.group(3) == "このキャラクターのアタック宣言・ガード宣言": to = "self"
        if to:
            out = [{"kind": "always", "text": text, "mod": {"to": to, "key": k, "op": "grant", "value": True}} for k in ("noAttack", "noGuard")]
            if m.group(1): 
                for ab in out: ab["cond"] = {"selfPower": {"op": "=", "n": int(m.group(2))}}
            return out
    m = re.fullmatch(r"(このキャラクターのパワーが(\d+)の場合)、≪このキャラクターのアタック宣言・ガード宣言≫は取り消される。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": k, "op": "grant", "value": True}, "cond": {"selfPower": {"op": "=", "n": int(m.group(2))}}} for k in ("noAttack", "noGuard")]
    m = re.fullmatch(r"分類・(\S+?)を持つキャラクターが捨て札された場合、≪そのキャラクターを構成しているカード全て≫を、?そのオーナーの手札に戻す。?", text)
    if m: return [{"kind": "trigger", "when": {"event": "leave", "icons": class_tokens(m.group(1)) or [m.group(1)]}, "optional": False, "text": text, "effect": {"steps": [{"a": "evAllToHand"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"((?:[^・、]+?)(?:・[^・、]+?)*)のキャラクターが捨て札になった場合、≪そのキャラクターを構成しているブレイクカード全て≫は、?オーナーの手札に戻る。?", text)
    if m and class_tokens(m.group(1).replace("・", "/")): return [{"kind": "trigger", "when": {"event": "leave", "icons": class_tokens(m.group(1).replace("・", "/"))}, "optional": False, "text": text, "effect": {"steps": [{"a": "evBreakToHand"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"このキャラクターが捨て札(?:に)?(?:なる|される)場合、≪このキャラクターを構成するカード全てと、(?:このキャラクターに)?セットされているカード全て≫を、?(?:その)?オーナーのデッキに戻し、そのデッキをシャッフルする。?", text): return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "leaveToDeck", "op": "grant", "value": True}}]   # Revise#128
    if re.fullmatch(r"このキャラクターが捨て札になる場合、≪このカードと、このキャラクターにセットされているカード全て≫は、?オーナーの手札に戻る。?", text): return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "leaveToHand", "op": "grant", "value": True}}]
    m = re.fullmatch(r"≪あなた≫は、?((?:[^・、]+?)(?:(?:・|または)[^・、]+?)*)を持つブレイクカードを、?ファストカードのタイミングでセット宣言可能。?", text)
    if m and class_tokens(re.sub(r"・|または", "/", m.group(1))): return [{"kind": "always", "text": text, "mod": {"to": "you", "key": "fastBreak", "op": "grant", "value": {"icons": class_tokens(re.sub(r"・|または", "/", m.group(1)))}}}]
    m = re.fullmatch(r"ダメージ判定でセットされた≪([^≫]+)≫は捨て札される。?(Xは[^。]+に等しい。?)?", text)
    if m and parse_selector(re.sub(r"キャラクター$", "", m.group(1))) is not None and m.group(1).endswith("キャラクター"):
        xd2 = x_def(m.group(2).rstrip("。")) if m.group(2) else None
        if not m.group(2) or xd2:
            eff = {"steps": [{"a": "discard", "to": "evCh", "ifSel": parse_selector(m.group(1)[:-6])}], "status": "auto"}
            if xd2: eff["x"] = xd2
            return [{"kind": "trigger", "when": {"event": "enter", "fromDamage": True}, "optional": False, "text": text, "effect": eff, "status": "auto"}]
    m = re.fullmatch(r"ブレイクしているキャラクターが捨て札された場合、≪そのキャラクターを構成しているブレイクカード全て≫を、?そのオーナーの手札に戻す。?", text)
    if m: return [{"kind": "trigger", "when": {"event": "leave", "broken": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "evBreakToHand"}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"バトル以外のダメージを受けない。?", text): return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "noDamage", "op": "grant", "value": {"outside": True}}}]
    if re.fullmatch(r"このキャラクターを、?ネームを無視してブレイク可能。?", text): return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "breakIgnoreName", "op": "grant", "value": True}}]
    m = re.fullmatch(r"パワーカードフェイズに≪このキャラクター≫にパワーカードをセットすることはできない。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "noCharge", "op": "grant", "value": True}}]
    m = re.fullmatch(r"≪このカード≫の必要ファクターは、?あなたのダメージ置き場の(?:(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)の)?カード(?:の)?枚数分減少する。?", text)
    if m: c["factorLessX"] = {"pileCount": {"zone": "damage", "owner": "you", "faction": FACTION_JP[m.group(1)]}} if m.group(1) else {"damage": "you"}; return []
    m = re.fullmatch(r"≪([^≫]+)≫のアタックコスト・ガードコストはオーナーの手札に戻る。?", text)   # "≪ブレイクしているウォリアー・ウォリアー♂全て≫のアタックコスト・ガードコストは…"
    if m:
        p0 = parse_target(m.group(1))
        if p0 and p0[0] == "ref" and (p0[1] == "self" or (isinstance(p0[1], dict) and "all" in p0[1])):
            chsel = "self" if p0[1] == "self" else p0[1]["all"]
            return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "dest", "op": "dest", "value": {"cost": k, "to": "hand", "paidBy": chsel}}} for k in ("attack", "guard")]
    m = re.fullmatch(r"(勢力フェイズ|メインフェイズ|パワーカードフェイズ|ターン)終了時に、?(?:(このキャラクターのパワーが(\d+)の場合)、)?(.+)", text)
    if m:
        body = parse_body(m.group(4))
        if body["status"] == "auto" and not body.get("target"):
            ab = {"kind": "trigger", "when": {"event": "turnEnd"} if m.group(1) == "ターン" else {"event": "phaseEnd", "phase": {"勢力フェイズ": "active", "メインフェイズ": "main", "パワーカードフェイズ": "charge"}[m.group(1)]}, "optional": False, "text": text, "effect": body, "status": "auto"}
            if m.group(2): ab["cond"] = {"selfPower": {"op": "=", "n": int(m.group(3))}}
            return [ab]
    # ---- Q#37 (Pack: set for free): A3-PR PR346 ----
    m = re.fullmatch(r"このキャラクターにネームに「([^」]+)」を含む(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のブレイクカードがセットされた場合、≪あなたの手札のネームに「([^」]+)」を含む(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のパーマネントカード(\d+)枚≫をこのキャラクターにセットする。?", text)
    if m: return [{"kind": "trigger", "when": {"event": "brokenSelf", "own": True, "nameHas": m.group(1), "faction": FACTION_JP[m.group(2)]}, "optional": False, "text": text,
                   "effect": {"steps": [{"a": "handPermToSelf", "nameHas": m.group(3), "faction": FACTION_JP[m.group(4)], "n": int(m.group(5))}], "status": "auto"}, "status": "auto"}]
    # ---- M1c (Saga 4 Characters) ----
    m = re.fullmatch(r"(.+?場合)、(≪[^≫]+≫は.+?を得)、(.+?場合)、(≪.+)", text)   # two conditions in one sentence
    if m:
        a1, a2 = parse_ability(m.group(1) + "、" + m.group(2) + "る。", c), parse_ability(m.group(3) + "、" + m.group(4), c)
        if a1 and a2: return a1 + a2
    m = re.fullmatch(r"≪このキャラクター(?:と、このキャラクターにセットされているカード全て)?≫は、?このキャラクターのパワー以下のコストの((?:プロジェクトカード|ファストカード|エフェクト)(?:・(?:プロジェクトカード|ファストカード|エフェクト))*)の(?:効果を受けない|目標にならない)。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "untargetable", "op": "grant", "value": {"from": [IMMUNE_TYPES[x] for x in m.group(1).split("・")], "costMaxPower": True}}}]
    m = re.fullmatch(r"このカードがセットされた場合、≪このカードのコスト≫はオーナーの手札に戻り、≪あなたのダメージ置き場の[“”\"]([^“”\"]+)[”\"]のネームを持つカード≫はオーナーの手札に戻る。?", text)
    if m:
        c["costBack"] = {"to": "hand"}
        return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "pickZone", "to": "you", "dest": "hand", "zone": "damage", "owner": "you", "sel": {"name": re.sub(r"\s+", "", m.group(1))}, "n": "all"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"(あなたのターン終了時|ターン終了時|メインフェイズ終了時)に、?このキャラクターのパワーが(?:このキャラクターの)?精神力未満だった場合、≪あなた≫は、?(?:このキャラクターの)?パワーが(?:このキャラクターの)?精神力と等しくなる(か、(?:あなたの)?手札がなくなる)?まで、あなたの(手札を|デッキの上からカードを引き、)パワーカードとして、?このキャラクターにセットする。?", text)
    if m:   # fill this character up to its Mental (Revise#109)
        when = {"event": "turnEnd", "mine": True} if m.group(1) == "あなたのターン終了時" else {"event": "turnEnd"} if m.group(1) == "ターン終了時" else {"event": "phaseEnd", "phase": "main"}
        return [{"kind": "trigger", "when": when, "optional": False, "text": text, "effect": {"steps": [{"a": "fillPower", "from": "hand" if m.group(3) == "手札を" else "deck"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪このキャラクターを(?:効果範囲に含む、または)?目標とするプロジェクトカード・ファストカードのコスト≫は捨て札置き場に置かず、そのオーナーのダメージ置き場に置かれる。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "dest", "op": "dest", "value": {"cost": "set", "types": ["Project", "Fast"], "onTarget": "self", "to": "damage"}}}]
    if re.fullmatch(r"このキャラクターがバトルを行う際、≪このキャラクターのバトル相手≫は、そのキャラクターの精神力を耐久力、本来の攻撃力の代わりに、パワーに等しい数値の精神攻撃力を持つものとして判定する。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": "battleOpp", "key": "statSwap", "op": "grant", "value": True}, "cond": {"self": "inBattle"}}]
    if re.fullmatch(r"≪このキャラクターとのバトルによって捨て札になるキャラクター≫は、捨て札されず、そのキャラクターにセットされているカード全てを捨て札し、そのキャラクターの勢力の勢力パーティの一番上に移動する。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "battleSpare", "op": "grant", "value": True}}]
    m = re.fullmatch(r"このキャラクターにアタック宣言されたプレイヤーのダメージ置き場にパーマネントカードがある場合、≪このキャラクター≫は(.+?)キャラクターにガードされない。?", text)
    if m and parse_selector(m.group(1)) is not None: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "noGuardBy", "op": "grant", "value": parse_selector(m.group(1))}, "cond": {"attackedPile": {"zone": "damage", "type": "Permanent"}}}]
    if re.fullmatch(r"≪このキャラクター≫の(?:アビリティまたは)?アタックによるダメージ判定でパーマネントカードがダメージ置き場に置かれた場合、もう一度ダメージ判定する。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "redoOnPerm", "op": "grant", "value": True}}]
    m = re.fullmatch(r"≪(あなた以外のプレイヤーの)?((?:プロジェクト|ファスト|パーマネント|ブレイク)カード(?:・(?:プロジェクト|ファスト|パーマネント|ブレイク)カード)*)≫の必要ファクターに\+(X|\d+)する。?(?:(Xは[^。]+に等しい)。?)?", text)
    if m and (m.group(3) != "X" or (m.group(4) and x_def(m.group(4)))):
        up = {"x": x_def(m.group(4))} if m.group(3) == "X" else int(m.group(3))
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "opponents" if m.group(1) else "all"}, "key": "factorLess", "op": "add", "value": {"n": 0, "up": up, "sel": {"types": [CARD_TYPES_JP[x] for x in re.findall(r"(プロジェクト|ファスト|パーマネント|ブレイク)カード", m.group(2))]}}}}]
    if re.fullmatch(r"このカードがダメージ判定でダメージ置き場に置かれた場合、≪このカード≫はオーナーの手札に戻る。?", text): c["damageToHand"] = True; return []
    m = re.fullmatch(r"(?:あなたの)?ターン開始時に、このキャラクターのパワーがこのキャラクターの精神力未満だった場合、あなたのデッキの一番上のカード1枚を引いて、パワーカードとして≪このキャラクター≫にセットする。?", text)
    if m: return [{"kind": "trigger", "when": {"event": "turnStart", "mine": True}, "cond": {"selfPowerLtMental": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "powerFromDeck", "to": "self", "n": 1}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このキャラクターから支払われたコスト1につき、≪あなたのデッキの一番上のカード1枚≫を捨て札する。?", text)
    if m: return [{"kind": "trigger", "when": {"event": "costPaid", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "mill", "to": "you", "n": "X"}], "x": {"evStat": "n"}, "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪([^≫]+?全て)と、([^≫]+?全て)≫(は.+)", text)
    if m:
        a1, a2 = parse_ability("≪%s≫%s" % (m.group(1), m.group(3)), c), parse_ability("≪%s≫%s" % (m.group(2), m.group(3)), c)
        if a1 and a2: return a1 + a2
    m = re.fullmatch(r"≪(プレイヤー全て|あなた|あなたの対戦相手全て|対戦相手全て)≫にチャージ([+\-]?\d+)を与える。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"players": {"プレイヤー全て": "all", "あなた": "you"}.get(m.group(1), "opponents")}, "key": "charge", "op": "add", "value": int(m.group(2))}}]
    m = re.fullmatch(r"≪プレイヤー全て≫は自分のターンのメインフェイズ開始時に、(\d+)点のダメージ判定を行う。?", text)
    if m: return [{"kind": "trigger", "when": {"event": "phaseStart", "phase": "main"}, "optional": False, "text": text, "effect": {"steps": [{"a": "damage", "to": "evPlayer", "n": int(m.group(1))}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪対戦相手のテリトリーのキャラクターをブレイクしたプレイヤー≫は(\d+)ドローする。?", text)
    if m: return [{"kind": "trigger", "when": {"event": "broken", "oppChar": True}, "ownerDecides": True, "optional": False, "text": text, "effect": {"steps": [{"a": "draw", "to": "evPlayer", "n": int(m.group(1))}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"このキャラクターに与えられたダメージは、≪あなた≫が代わりに受ける。?", text): return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "dmgToOwner", "op": "grant", "value": {"all": True}}}]
    m = re.fullmatch(r"(.+?)1枚につき、≪このキャラクター≫に([±+\-]\(?\d+\)?)/([±+\-]\(?\d+\)?)/([±+\-]\(?\d+\)?)する。?", text)
    if m and count_def(m.group(1)):
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": k, "op": "add", "value": {"x": count_def(m.group(1)), "sign": sign_n(m.group(g))}}} for k, g in (("se", 2), ("at", 3), ("de", 4)) if sign_n(m.group(g))]
    m = re.fullmatch(r"バトルの際、(≪.+)", text)   # "バトルの際、≪このキャラクター≫に±0/+1/-1して判定する"
    if m:
        inner = parse_ability(m.group(1), c)
        if inner and all(ab["kind"] == "always" for ab in inner):
            for ab in inner: ab["cond"] = {"self": "inBattle"}; ab["text"] = text
            return inner
    m = re.fullmatch(r"このキャラクターがバトルする際、(≪[^≫]+≫に(?:X|\d+)ダメージを与える。.*)", text)
    if m:
        eff = parse_body(m.group(1))
        if eff["status"] == "auto" and not eff.get("target"): return [{"kind": "trigger", "when": {"event": "battleStart", "self": True}, "optional": False, "text": text, "effect": eff, "status": "auto"}]
    m = re.fullmatch(r"このキャラクターにガード宣言された≪([^≫]+)キャラクター≫のアタック宣言を取り消す。?", text)
    if m and parse_selector(m.group(1)) is not None: return [{"kind": "trigger", "when": {"event": "guarded", "self": True, "asGuard": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "cancelBattle", "to": {"battleOppSel": parse_selector(m.group(1))}, "which": "attack"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪エフェクト全て≫は、宣言時に、そのエフェクトを持つキャラクターから追加のXコストを支払わなければ効果を発揮しない。?(?:(Xは[^。]+に等しい)。?)?", text)   # A3-11 1711 (Revise#401): every effect costs X more, paid from its own character
    if m and m.group(1) and x_def(m.group(1)): return [{"kind": "always", "text": text, "mod": {"to": {"all": {}}, "key": "effectCost", "op": "add", "value": {"x": x_def(m.group(1)), "sign": 1}}}]
    m = re.fullmatch(r"≪プロジェクトカード・ファストカード(・エフェクト)?≫のコストは(X|\d+)上昇する。?(?:(Xは[^。]+に等しい)。?)?", text)
    if m and (m.group(2) != "X" or (m.group(3) and x_def(m.group(3)))):
        n = {"x": x_def(m.group(3)), "sign": 1} if m.group(2) == "X" else int(m.group(2))
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "cardCost", "op": "add", "value": {"n": n, "sel": {"types": ["Project", "Fast"]}}}},
                {"kind": "always", "text": text, "mod": {"to": {"all": {}}, "key": "effectCost", "op": "add", "value": n if isinstance(n, int) else {"x": n["x"], "sign": 1}}}][:2 if m.group(1) else 1]
    if re.fullmatch(r"≪このキャラクターとのバトルによって捨て札になるキャラクター≫は、そのオーナーのダメージ置き場に置かれる。?", text): return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "battleKillTo", "op": "grant", "value": True}}]   # Revise#132
    m = re.fullmatch(r"≪このキャラクターとのバトルによって捨て札されるキャラクターを構成するカード全て(?:と、そのキャラクターにセットされている(?:パーマネント)?カード全て)?≫を、?そのオーナーのダメージ置き場に置く。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "battleKillTo", "op": "grant", "value": True}}]
    m = re.fullmatch(r"≪プレイヤー全て≫は自分のターンのメインフェイズ開始時に、(X|\d+)ドローする。その後、自分の手札(X|\d+)枚を捨て札する。(?:(Xは[^。]+に等しい)。?)?", text)
    if m and (("X" not in (m.group(1) + m.group(2))) or (m.group(3) and x_def(m.group(3)))):
        nn = lambda g: "X" if g == "X" else int(g)
        eff = {"steps": [{"a": "draw", "to": "evPlayer", "n": nn(m.group(1))}, {"a": "handDiscard", "to": "evPlayer", "n": nn(m.group(2))}], "status": "auto"}
        if m.group(3): eff["x"] = x_def(m.group(3))
        return [{"kind": "trigger", "when": {"event": "phaseStart", "phase": "main"}, "optional": False, "text": text, "effect": eff, "status": "auto"}]
    m = re.fullmatch(r"≪([^≫]+)≫は、?バトルの際、?([±+\-]\(?\d+\)?)/([±+\-]\(?\d+\)?)/([±+\-]\(?\d+\)?)して判定する。?", text)
    if m:
        p0 = parse_target(m.group(1))
        if not p0 and m.group(1).endswith("キャラクター") and parse_selector(m.group(1)[:-6]) is not None: p0 = ("ref", {"all": parse_selector(m.group(1)[:-6])})
        if p0 and p0[0] == "ref" and isinstance(p0[1], dict) and "all" in p0[1]:
            return [{"kind": "always", "text": text, "mod": {"to": p0[1], "key": k, "op": "add", "value": sign_n(m.group(g))}, "cond": {"targetInBattle": True}} for k, g in (("se", 2), ("at", 3), ("de", 4)) if sign_n(m.group(g))]
    m = re.fullmatch(r"≪あなた≫は、?((?:[^・、]+?)(?:(?:・|または)[^・、]+?)*)を持つブレイクカードを必要ファクターを無視してセット可能。?", text)
    if m and class_tokens(re.sub(r"・|または", "/", m.group(1))): return [{"kind": "always", "text": text, "mod": {"to": "you", "key": "factorIgnore", "op": "grant", "value": {"type": "Break", "icons": class_tokens(re.sub(r"・|または", "/", m.group(1)))}}}]
    m = re.fullmatch(r"あなたの支配キャラクターの((?:[^・、]+?)(?:・[^・、]+?)*)がバトルによって支配キャラクターを捨て札した場合、(.+)", text)
    if m and class_tokens(m.group(1).replace("・", "/")):
        eff = parse_body(m.group(2))
        if eff["status"] == "auto" and not eff.get("target"): return [{"kind": "trigger", "when": {"event": "killed", "controlled": True, "bySel": {"icons": class_tokens(m.group(1).replace("・", "/"))}}, "optional": False, "text": text, "effect": eff, "status": "auto"}]
    m = re.fullmatch(r"≪あなたの手札にある((?:[^・≫]+?)(?:・[^・≫]+?)*)を持つブレイクカード全て≫は、?サーチ\(((?:[^・)]+?)(?:・[^・)]+?)*)を持つカード\)を得る。?", text)
    if m and class_tokens(m.group(1).replace("・", "/")) and class_tokens(m.group(2).replace("・", "/")):
        return [{"kind": "always", "text": text, "mod": {"to": "you", "key": "handSearch", "op": "grant", "value": {"cards": {"type": "Break", "icons": class_tokens(m.group(1).replace("・", "/"))}, "search": {"icons": class_tokens(m.group(2).replace("・", "/")), "label": m.group(2) + "を持つカード"}}}}]
    m = re.fullmatch(r"このキャラクターに(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のブレイクカードをセットする場合、≪そのブレイクカードのコスト≫はオーナーの手札に戻る。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "dest", "op": "dest", "value": {"cost": "set", "type": "Break", "faction": FACTION_JP[m.group(1)], "onTarget": "self", "to": "hand"}}}]
    m = re.fullmatch(r"あなたがこのキャラクターにネームを持つ(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のブレイクカードをセットした場合、≪あなたの任意のキャラクターまたはプレイヤー1人≫に(\d+)ダメージを与えることが可能。?", text)
    if m: return [{"kind": "trigger", "when": {"event": "broken", "self": True, "own": True, "cardSel": {"named": True, "faction": FACTION_JP[m.group(1)]}}, "optional": True, "text": text,
                   "effect": {"target": {"kind": "charOrPlayer", "sel": {}, "psel": {}, "count": 1}, "steps": [{"a": "damage", "to": "t", "n": int(m.group(2))}], "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"≪このキャラクターがプレイヤーに与えたダメージによるダメージ判定でセットされたキャラクター全て≫を捨て札する。?", text): return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "killDamageChars", "op": "grant", "value": True}}]
    m = re.fullmatch(r"≪あなた以外のプレイヤー全て≫は、ブレイクカード以外の、ダメージ置き場に置かれているカードと同じ名称のカードを使用宣言できない。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"players": "opponents"}, "key": "ban", "op": "ban", "value": {"decl": "set", "nameInDamage": True, "exceptType": "Break"}}}]
    m = re.fullmatch(r"≪あなた以外のプレイヤーのテリトリーの、ダメージ置き場に置かれているカードと同じ名称のキャラクター全て≫の持つスキル・エフェクト全てを無効化する。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": {"all": {"owner": "opp", "nameInDamage": True}}, "key": "negate", "op": "grant", "value": {"skills": True, "effects": True}}}]
    m = re.fullmatch(r"このキャラクターが支配キャラクターとバトルする場合、≪このキャラクター≫の攻撃力に-Xして判定することができる。その場合、バトル終了後に、目標の≪このキャラクターのバトル相手以外のキャラクターまたはプレイヤー1人≫に、ただちにXダメージを与える。Xはこのキャラクターの通常攻撃力の数値からバトル相手の耐久力の数値を引いた数値に等しい。?", text)
    if m:   # ドラグーン“ェデャエァス”: give up X attack at the start of the battle; after the battle X damage to another target
        return [{"kind": "trigger", "when": {"event": "battleStart", "self": True}, "cond": {"self": "battleVsControlled"}, "optional": True, "text": text,
                 "effect": {"x": {"atMinusOppDe": True}, "steps": [{"a": "mod", "to": "self", "until": "battle", "mod": {"key": "at", "op": "add", "value": {"xvar": True, "sign": -1}}},
                                                                   {"a": "mod", "to": "self", "until": "turn", "mod": {"key": "pendingHit", "op": "grant", "value": {"xvar": True, "sign": 1}}}], "status": "auto"}, "status": "auto"},
                {"kind": "trigger", "when": {"event": "battleEnd", "self": True}, "cond": {"selfHasMod": "pendingHit"}, "optional": False, "text": text,
                 "effect": {"target": {"kind": "charOrPlayer", "sel": {"notBattleOppOfSelf": True}, "psel": {}, "count": 1}, "steps": [{"a": "pendingHit", "to": "t"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪このカード≫は、?([EW阿ダ極イ宇]+)(\d+)のブレイク条件のないカードとしてセット宣言可能。?", text)   # 王の守護神“セクメト”
    if m:
        from collections import Counter as _C
        c["asBreak"] = {"factor": dict(_C(TEXT_FACTOR[ch] for ch in m.group(1))), "cost": int(m.group(2)), "noRule": True}; return []
    if re.fullmatch(r"≪アタック宣言またはガード宣言した、▼を持つあなたの支配キャラクター以外のキャラクター≫を捨て札する。?", text):
        return [{"kind": "trigger", "when": {"event": "battleDeclared"}, "optional": False, "text": text, "effect": {"steps": [{"a": "discard", "to": "evCh", "ifSel": {"notMineAggressiveCtl": True}}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"あなたがこのカードの効果以外でダメージを受けた場合、≪そのダメージを与えたキャラクターのオーナーまたはそのカードのオーナー≫にXダメージを与える。Xはこのキャラクターの攻撃力に等しい。?", text)
    if m: return [{"kind": "trigger", "when": {"event": "playerHurt"}, "optional": False, "text": text, "effect": {"steps": [{"a": "damage", "to": "evPlayer", "n": "X"}], "x": {"selfStat": "at"}, "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪エフェクトの使用宣言またはアタック宣言またはガード宣言した、スキルまたはエフェクトを持つ、このキャラクター以外のキャラクター≫に、(X|\d+)ダメージを与える。(?:Xはこのキャラクターの攻撃力に等しい。?)?", text)
    if m: return [{"kind": "trigger", "when": {"event": "anyDeclared"}, "optional": False, "text": text, "effect": dict({"steps": [{"a": "damage", "to": "evCh", "n": "X" if m.group(1) == "X" else int(m.group(1)), "ifSel": {"skillOrEffect": True}}], "status": "auto"}, **({"x": {"selfStat": "at"}} if m.group(1) == "X" else {})), "status": "auto"}]
    if re.fullmatch(r"≪支配キャラクターから支払われたアタックコスト≫は、?そのオーナーの手札に戻る。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "dest", "op": "dest", "value": {"cost": "attack", "to": "hand"}}}]
    if re.fullmatch(r"≪あなた以外のプレイヤーの支配キャラクター≫は、?このキャラクターを目標にアタック宣言可能。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "attackableBy", "op": "grant", "value": {"owner": "opp", "area": "controlled"}}}]
    if re.fullmatch(r"このキャラクターがバトルする際、≪このキャラクターのバトル相手を場に残す効果全て≫を無効化する。?", text): return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "noKeepVictims", "op": "grant", "value": {"battle": True}}}]   # EP351 (Revise#201)
    if re.fullmatch(r"≪このキャラクターが与えるダメージによって捨て札されるキャラクターを場に残す効果全て≫を無効化する。?", text): return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "noKeepVictims", "op": "grant", "value": True}}]
    if re.fullmatch(r"≪このキャラクターからバトルによるダメージを与えられたキャラクター≫は、?次のあなたのターンの終了時までパワーカードをセットすることができない。?", text): return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "chargeLock", "op": "grant", "value": True}}]
    if re.fullmatch(r"≪パワーが精神力に等しいキャラクターを構成するブレイクカード全て≫を捨て札する。?", text): return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "breakStrip", "op": "grant", "value": True}}]
    m = re.fullmatch(r"(このキャラクターのパワーが精神力に等しい場合、)?≪(プレイヤー全て|あなたの対戦相手全て|あなた以外のプレイヤー全て)≫は、?手札全てを(?:プレイヤー全てに見せて|公開して)プレイする。?", text)   # "公開して" (A4-04 0608 …, Revise#260)
    if m:
        ab = {"kind": "always", "text": text, "mod": {"to": {"players": "all" if m.group(2) == "プレイヤー全て" else "opponents"}, "key": "handsOpen", "op": "grant", "value": True}}
        if m.group(1): ab["cond"] = {"selfPowerEqMental": True}
        return [ab]
    if re.fullmatch(r"あなたの任意のあなたの支配キャラクター1人を捨て札しなければ、≪このキャラクター≫はアタック宣言・ガード宣言できない。?", text): return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "battleTax", "op": "grant", "value": {"discardOwn": 1}}}]
    m = re.fullmatch(r"≪ブレイクカードまたはパーマネントカードをセットしたプレイヤー≫はXドローする。Xはセットしたブレイクカードまたはパーマネントカードのコストに等しい。?", text)
    if m: return [{"kind": "trigger", "when": {"event": "cardResolved", "types": ["Break", "Permanent"]}, "ownerDecides": True, "optional": False, "text": text, "effect": {"steps": [{"a": "draw", "to": "evPlayer", "n": "X"}], "x": {"evStat": "cost"}, "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪プロジェクトカードまたはファストカードの使用宣言をしたプレイヤー≫に、このキャラクターの(精神力|攻撃力|耐久力)に等しいダメージを与える。?", text)
    if m: return [{"kind": "trigger", "when": {"event": "cardDeclared", "types": ["Project", "Fast"]}, "optional": False, "text": text, "effect": {"steps": [{"a": "damage", "to": "evPlayer", "n": "X"}], "x": {"selfStat": STAT_JP[m.group(1)]}, "status": "auto"}, "status": "auto"}]
    if re.fullmatch(r"≪このキャラクター≫は、対戦相手のテリトリーと、対戦相手のダメージ置き場の、異なるカード名称の、ネームを持つブレイクカード全てのスキル全てを持つ。?", text):
        return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "copyOppBreakSkills", "op": "grant", "value": True}}]
    m = re.fullmatch(r"あなたの対戦相手が(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のキャラクターを(?:(\d+)体以上)?支配している場合、≪あなた≫はこのカードの必要ファクターとコストを無視してセット宣言可能。?", text)   # (\d+)体以上: A4-03 0411 … (Revise#283)
    if m: c["freeIf"] = {"oppControls": dict({"faction": (FACTION_JP.get(m.group(1)) or FACTION_JP[m.group(1).replace("ー", "-")])}, **({"n": int(m.group(2))} if m.group(2) else {})), "normal": True}; return []
    m = re.fullmatch(r"このキャラクターとのバトル終了時まで、(≪.+)", text)   # "…≪このキャラクターのバトル相手のキャラクター≫は…の効果を受けない" while it battles this character
    if m:
        inner = parse_ability(m.group(1), c)
        if inner:
            for ab in inner: ab["cond"] = {"self": "inBattle"}; ab["text"] = text
            return inner
    m = re.fullmatch(r"≪(.+?)と同じエリアにいるこのキャラクター≫は(.+)", text)   # "≪Fのキャラクターと / “X”と同じエリアにいるこのキャラクター≫は…"
    if m:
        w = m.group(1)
        nm = re.fullmatch(r"“([^”]+)”", w)
        sel = {"name": re.sub(r"\s+", "", nm.group(1))} if nm else parse_selector(re.sub(r"キャラクター$", "", w))
        inner = parse_ability("≪このキャラクター≫は" + m.group(2), c) if sel is not None else None
        if inner:
            for ab in inner: ab["cond"] = {"sameArea": sel}; ab["text"] = text
            return inner
    m = re.fullmatch(r"≪このカードを構成するカードに含む、?(.*?)キャラクター≫(.+)", text)   # works while this card is anywhere in the character
    if m:
        w = m.group(1).rstrip("、")
        fm = re.fullmatch(r"(.+?)\(勢力\)の(.+?)\(分類\)の(ネームレベル)?", w)
        sel = ({"faction": FACTION_JP.get(fm.group(1)), "icons": class_tokens(fm.group(2)), **({"named": True} if fm.group(3) else {})} if fm else parse_selector(w)) if w else {}
        inner = parse_ability("≪このキャラクター≫" + m.group(2), c) if sel is not None else None
        if inner:
            for ab in inner:
                ab["anyLayer"] = True; ab["text"] = text
                if sel: ab["cond"] = {"selfIs": sel}
            return inner
    m = re.fullmatch(r"(あなたが先攻でない場合、)?≪あなた≫は、?(?:“([^”]+)”で、?)?(支配エリア(?:に)?(?:いる|の))?このキャラクタ[ー-]を、?ファストカードのタイミングでブレイク可能。?(?:Xはこのキャラクターを構成する、ネームを持つカードの枚数に等しい。?)?", text)
    if m:
        ab = {"kind": "always", "text": text, "mod": {"to": "self", "key": "breakFast", "op": "grant", "value": {"name": re.sub(r"\s+", "", m.group(2))} if m.group(2) else True}}
        conds = ([{"self": "controlled"}] if m.group(3) else []) + ([{"notFirst": True}] if m.group(1) else [])
        if conds: ab["cond"] = conds[0] if len(conds) == 1 else {"all": conds}
        return [ab]
    m = re.fullmatch(r"≪このキャラクター≫は、?分類に関わらず、?(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のカードでブレイク可能。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "breakableAny", "op": "grant", "value": {"faction": FACTION_JP[m.group(1)]}}}]
    m = re.fullmatch(r"(あなたが先攻でない場合、)?≪このカード≫[はを]、?([EW阿ダ極イ宇])(\d+)のブレイクカードとして、?(あなたのテリトリーのキャラクターに、?)?(ファストカードのタイミングで)?(?:セット宣言|使用宣言|使用)可能。?", text)
    if m:
        c["asBreak"] = dict({"factor": {TEXT_FACTOR[m.group(2)]: 1}, "cost": int(m.group(3))}, **({"cond": {"notFirst": True}} if m.group(1) else {}), **({"ownOnly": True} if m.group(4) else {}), **({"fast": True} if m.group(5) else {}))
        return []
    # ---- M1a (Characters A3-01 … A3-25) ----
    m = re.fullmatch(r"≪このカード≫は、?([EW阿ダ極イ])(\d+)のブレイクカードとして使用(?:宣言)?可能。?", text)
    if m: c["asBreak"] = {"factor": {FACTOR_LETTER[m.group(1)]: 1}, "cost": int(m.group(2))}; return []
    m = re.fullmatch(r"≪このカード≫は、?(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザ[ー-])(\d+)のブレイクカードとして使用(?:宣言)?可能。?", text)
    if m: c["asBreak"] = {"factor": {FACTION_JP[m.group(1).replace("イレイザ-", "イレイザー")]: 1}, "cost": int(m.group(2))}; return []
    m = re.fullmatch(r"分類に関わらず、≪このキャラクター≫を(?:(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のブレイクカードで)?ブレイク可能。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "breakableAny", "op": "grant", "value": {"faction": FACTION_JP[m.group(1)]} if m.group(1) else {}}}]
    m = re.fullmatch(r"分類に関わらず、≪このキャラクター≫を(" + WORK_ALT + r")の(?:ブレイク)?カードでブレイク可能。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "breakableAny", "op": "grant", "value": {"works": WORKS_JP[m.group(1)]}}}]
    m = re.fullmatch(r"≪あなた≫は、?(" + WORK_ALT + r")のブレイクカードで、?支配エリアのこのキャラクターを、?ファストカードのタイミングでブレイク可能。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "breakFast", "op": "grant", "value": {"works": WORKS_JP[m.group(1)]}}, "cond": {"self": "controlled"}}]
    m = re.fullmatch(r"≪このキャラクター≫は精神攻撃によるダメージを受けない。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "noDamage", "op": "grant", "value": {"mental": True}}}]
    m = re.fullmatch(r"≪このキャラクターを(" + WORK_ALT + r")のカードでブレイクしたプレイヤー≫は(\d+)ドローする。?", text)
    if m: return [{"kind": "trigger", "when": {"event": "brokenSelf", "works": WORKS_JP[m.group(1)]}, "ownerDecides": True, "optional": False, "text": text, "effect": {"steps": [{"a": "draw", "to": "evPlayer", "n": int(m.group(2))}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪このキャラクター≫がバトル(?:によって|の結果)捨て札される場合、あなたの任意のパワーカード(\d+)枚を捨て札可能。?", text)
    if m: return [{"kind": "trigger", "when": {"event": "leave", "self": True, "battle": True}, "optional": True, "text": text, "effect": {"steps": [{"a": "ownPowerDiscard", "n": int(m.group(1))}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪あなた≫は、?支配エリアのこのキャラクターを、?ファストカードのタイミングでブレイク可能。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "breakFast", "op": "grant", "value": True}, "cond": {"self": "controlled"}}]
    m = re.fullmatch(r"≪(支配エリアの|パワーカードをセットされている)このキャラクターをブレイクしたプレイヤー≫は、?(.+?)。?", text)
    if m:   # "≪…このキャラクターをブレイクしたプレイヤー≫は、…": the breaker does it (the ability looks back at the broken card)
        rest = m.group(2)
        optional = bool(re.search(r"可能$", rest))
        rest = re.sub(r"捨て札可能$", "捨て札する", re.sub(r"ドロー可能$", "ドローする", rest))
        when = {"event": "brokenSelf", "wasControlled": True} if m.group(1) == "支配エリアの" else {"event": "brokenSelf", "hadPower": True}
        mm = re.fullmatch(r"(\d+)ドローする", rest)
        steps = [{"a": "draw", "to": "evPlayer", "n": int(mm.group(1))}] if mm else None
        mm = re.fullmatch(r"任意のプレイヤー(\d+)人の手札(\d+)枚を捨て札する", rest)
        if mm and mm.group(1) == "1": steps = [{"a": "playerHandDiscard", "n": int(mm.group(2))}]
        if steps: return [{"kind": "trigger", "when": when, "ownerDecides": True, "optional": optional, "text": text, "effect": {"steps": steps, "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"≪このキャラクターから支払われたエフェクトコストと、(このキャラクターから支払われた[^≫]+)≫は、?(?:オーナーの)?手札に戻る。?", text)   # EX0296 / EX0298 (Revise#201)
    if m:
        r2 = parse_ability0("≪" + m.group(1) + "≫は手札に戻る。", c)
        if r2: return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "dest", "op": "dest", "value": {"cost": "effect", "to": "hand", "fromSelf": True}}}] + [dict(x, text=text) for x in r2]
    m = re.fullmatch(r"≪([^≫]+)≫は、?(?:(?:その|オーナーの)?手札に戻る|(あなたのデッキに戻し、デッキをシャッフルする))。?", text)
    if m:
        p0 = parse_target(m.group(1))
        dest = "deckShuffle" if m.group(2) else "hand"
        if p0 and p0[0] == "ref" and isinstance(p0[1], dict) and "costOf" in p0[1]:
            return [{"kind": "always", "text": text, "mod": {"to": {"players": "you"}, "key": "dest", "op": "dest", "value": dict({"cost": "set", "to": dest} if "paidTypes" not in p0[1]["costOf"] else {"to": dest}, **{k: v for k, v in p0[1]["costOf"].items() if k in ("type", "types", "icons", "named", "fromSelf", "works", "paidTypes", "onTarget", "faction", "name", "tag", "textHas")})}}]
    m = re.fullmatch(r"≪このキャラクターに与えられるダメージ≫に[ー−\-]\((\d+)\)して判定する。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "dmgReduce", "op": "add", "value": {"mental": int(m.group(1))}}}]
    m = re.fullmatch(r"≪このキャラクターに与えられるダメージ≫に[ー−\-](\d+)して判定する。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "dmgReduce", "op": "add", "value": {"normal": int(m.group(1))}}}]
    m = re.fullmatch(r"(?:このキャラクターを構成する“([^”]+)”が(\d+)枚以上ある場合、)?≪このキャラクター≫はバトル以外で捨て札されない。?", text)
    if m:
        ab = {"kind": "always", "text": text, "mod": {"to": "self", "key": "noDiscard", "op": "grant", "value": {"outside": True}}}
        if m.group(1): ab["cond"] = {"selfNamedCount": {"name": re.sub(r"\s+", "", m.group(1)), "n": int(m.group(2))}}
        return [ab]
    m = re.fullmatch(r"このカードの下に“([^”]+)”がある場合、≪([^≫]+)≫は(.+?)を得、≪このキャラクター≫はエフェクト「((?:\d+|X)[:：].+?)」を(?:得る|持つ)。?", text)
    if m:   # two halves: others gain skills, this character gains an effect
        cond = {"belowPName": re.sub(r"\s+", "", m.group(1))}
        p0, sk = parse_target(m.group(2)), skills_list(m.group(3))
        g2 = gained_effect("≪このキャラクター≫はエフェクト「" + m.group(4) + "」を得る。")
        if p0 and p0[0] == "ref" and sk and g2:
            out = [{"kind": "always", "text": text, "mod": {"to": p0[1], "key": "skill", "op": "grant", "value": {"id": x["id"], "x": x["x"]}}, "cond": cond} for x in sk]
            for ab in g2: ab["cond"] = cond; ab["text"] = text
            return out + g2
    m = re.fullmatch(r"このカードの下に“([^”]+)”が(\d+)枚以上ある場合、≪このキャラクター≫は、?このキャラクターを構成する、?「[^」]+」以外の、?異なるカード名称の“\1”のスキル・エフェクト・アビリティ全てを得る。?", text)
    if m:
        c["inherit"] = {"name": re.sub(r"\s+", "", m.group(1)), "min": int(m.group(2))}; return []
    m = re.fullmatch(r"このカードを“([^”]+)”のネームを持つキャラクターにセットする場合、≪このカードのコスト≫はオーナーの手札に戻る。?", text)
    if m: c["costBack"] = {"to": "hand", "onName": re.sub(r"\s+", "", m.group(1))}; return []
    m = re.fullmatch(r"このカードが、?([^、]+?)をセットされているキャラクターにセットされた場合、≪このカードのコスト≫はオーナーの手札に戻る。?", text)   # A3-05 0837
    if m: c["costBack"] = {"to": "hand", "onPerm": re.sub(r"\s+", "", m.group(1))}; return []
    m = re.fullmatch(r"このカードを“([^”]+)”にセット(?:宣言)?する場合、≪あなた≫は、?このカードのコストを無視してセット宣言可能。?", text)   # "セットする場合" too (EX0062, Revise#201)
    if m: c["freeOnName"] = re.sub(r"\s+", "", m.group(1)); return []
    m = re.fullmatch(r"このカードを「([^」]+)」にセット宣言する場合、≪あなた≫は、?このカードのコストを無視してセット宣言可能。?", text)   # EP313 (Revise#157): a card name
    if m: c["freeOnName"] = re.sub(r"\s+", "", m.group(1)); c["freeOnJp"] = True; return []
    m = re.fullmatch(r"あなたの対戦相手のテリトリーにキャラクターがいて、あなたの支配エリアにキャラクターがいない場合、≪あなた≫はこのカードの必要ファクターとコストを無視してあなたのテリトリーのキャラクターにセット宣言可能。?", text)
    if m: c["freeIf"] = {"oppHasChars": True, "youNoControlled": True}; return []
    m = re.fullmatch(r"支配エリアの((?:[^・]+)(?:・[^・]+)*)がプレイヤーに対してアタック宣言するか、支配キャラクターのアタック宣言に対してガード宣言した場合、≪そのキャラクターのオーナー≫は(\d+)ドロー可能。?", text)
    if m:
        icons = class_tokens(m.group(1).replace("・", "/"))
        if icons: return [{"kind": "trigger", "when": {"event": "iconAct", "icons": icons}, "ownerDecides": True, "optional": True, "text": text,
                           "effect": {"steps": [{"a": "draw", "to": "evPlayer", "n": int(m.group(2))}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカードがセットされた場合、≪プレイヤー全て≫は自分の捨て札置き場のカード(\d+)枚を手札に加える。?", text)
    if m: return [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": text, "effect": {"steps": [{"a": "eachPick", "zones": ["discard"], "n": int(m.group(1)), "sel": {}, "must": True}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"このカードをセットされている“([^”]+)”がプレイヤーにアタックした場合、通常のダメージ判定を行わず、≪このキャラクターと、あなたの任意の、アタックを受けたプレイヤーのテリトリーのネームレベルキャラクタ[ー-]1人≫をバトルさせることができる。?", text)
    if m: return [{"kind": "always", "text": text, "mod": {"to": "self", "key": "duelNamed", "op": "grant", "value": {"host": re.sub(r"\s+", "", m.group(1))}}}]
    # "≪あなたの対戦相手のカード全てのコストと、その支配キャラクターのアタックコスト・ガードコスト・エフェクトコスト全て≫はN上昇する"
    m = re.fullmatch(r"≪(?:あなたの)?対戦相手のカード全てのコストと、その支配キャラクターの((?:アタック|ガード|エフェクト)コスト(?:・(?:アタック|ガード|エフェクト)コスト)*)全て≫は(\d+)(上昇|減少)する。?", text)
    if m:
        n = int(m.group(2)) * (1 if m.group(3) == "上昇" else -1)
        out = [{"kind": "always", "text": text, "mod": {"to": {"players": "opponents"}, "key": "cardCost", "op": "add", "value": {"n": n, "sel": {}}}}]
        for k in m.group(1).split("・"):
            key = {"アタックコスト": "attackCost", "ガードコスト": "guardCost", "エフェクトコスト": "effectCost"}[k]
            out.append({"kind": "always", "text": text, "mod": {"to": {"all": {"owner": "opp", "area": "controlled"}}, "key": key, "op": "add", "value": n}})
        return out
    raw = re.findall(r"≪([^≫]+)≫", text)
    parsed = [parse_target(t) for t in raw]
    idx = {}
    body = re.sub(r"≪([^≫]+)≫", lambda m: "«%d»" % idx.setdefault(len(idx), len(idx)), text)
    sents = [x.strip() for x in body.split("。") if x.strip()]
    if not sents: return []
    main, rest = sents[0], sents[1:]
    xd, rest_ok = None, True
    for r in rest:
        xd = x_def(r)
        if not xd: rest_ok = False; break   # more sentences: only a trigger's effect may take them (below)
    for i, t in enumerate(raw):   # "≪精神力0のキャラクター≫" (no count, no 全て): every character it matches (Revise#109)
        if parsed[i] is None and t.endswith("キャラクター") and parse_selector(t[:-6]) is not None: parsed[i] = ("ref", {"all": parse_selector(t[:-6])})
    def R(i):
        p = parsed[int(i)]
        return p[1] if p and p[0] == "ref" else None
    # card properties
    if re.fullmatch(r"«(\d)»は、?ファストカードのタイミングで(?:、?[^。]*?)?セット(?:宣言)?可能", main) and R(re.match(r"«(\d)»", main).group(1)) == "card":
        c["fastTiming"] = True; return []
    m = re.fullmatch(r"(?:このキャラクターをブレイクする場合、)?«(\d)»は、?(?:その)?(?:オーナーの)?手札に戻る", main)
    if m and raw[int(m.group(1))] in ("そのブレイクカードのコスト", "このブレイクカードのコスト", "ブレイクカードのコスト"):
        if c.get("type") == "Break": c["costBack"] = {"to": "hand"}   # its own cost too, when it breaks a character (Pack report A3-EP EP245, Revise#325)
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "dest", "op": "dest", "value": {"cost": "set", "type": "Break", "onTarget": "self", "to": "hand"}}}]
    m = re.fullmatch(r"このカードを同じネームを持つキャラクターにセット宣言するか、このキャラクターに同じネームを持つブレイクカードをセット宣言した場合、«(\d)»は、?(?:その)?オーナーの手札に戻る", main)
    if m:
        c["costBack"] = {"to": "hand", "sameName": True}
        return [{"kind": "always", "text": text, "mod": {"to": {"players": "all"}, "key": "dest", "op": "dest", "value": {"cost": "set", "type": "Break", "onTarget": "self", "sameName": True, "to": "hand"}}}]
    if re.fullmatch(r"«(\d)»は、?\d+体以上同時に場に存在可能", main) and R(re.match(r"«(\d)»", main).group(1)) in ("card", "self"):
        c["multiName"] = True; return []
    trig_cond = None
    m = re.fullmatch(r"«(\d)»に、?(?:ただちに)?(\()?(\d+|X)\)?ダメージを与える", main)   # "≪バトル相手 / アタック宣言またはガード宣言したキャラクター≫に、ただちにXダメージを与える"
    if m:
        ref = R(m.group(1))
        when, to = ({"event": "guarded", "self": True}, ref) if ref in ("battleOpp", "battleOppOwner") else \
            ({"event": "battleDeclared"}, "evCh") if ref == {"all": {"inBattle": True}} else \
            ({"event": "guarded"}, "evCh") if ref == {"all": {"guarding": True}} else \
            ({"event": "attack"}, "evCh") if ref == {"all": {"attacking": True}} else \
            ({"event": "attack", "atMe": True}, "evCh") if ref == {"all": {"attacking": True, "attackingYou": True}} else \
            ({"event": "costPaid", "kinds": ref["all"]["paidFor"]}, "evCh") if isinstance(ref, dict) and isinstance(ref.get("all"), dict) and "paidFor" in ref["all"] else (None, None)
        if when:
            step = {"a": "damage", "to": to, "n": "X" if m.group(3) == "X" else int(m.group(3)), "mental": bool(m.group(2))}
            eff = {"steps": [step], "status": "auto"}
            if m.group(3) == "X":
                if not xd: return None
                eff["x"] = xd
            return [{"kind": "trigger", "when": when, "optional": False, "text": text, "effect": eff, "status": "auto"}]
    m = re.fullmatch(r"«(\d)»を捨て札する", main)   # "≪ガード宣言した▼を持つブレイクしていないキャラクター≫を捨て札する" (A4-PP PP170, Revise#318)
    if m and not rest:
        ref = R(m.group(1))
        if isinstance(ref, dict) and isinstance(ref.get("all"), dict) and (ref["all"].get("guarding") or ref["all"].get("attacking")) and set(ref["all"]) - {"guarding", "attacking"}:
            sel = {k: v for k, v in ref["all"].items() if k not in ("guarding", "attacking")}
            return [{"kind": "trigger", "when": {"event": "guarded" if ref["all"].get("guarding") else "attack", "chSel": sel}, "optional": False, "text": text, "effect": {"steps": [{"a": "discard", "to": "evCh"}], "status": "auto"}, "status": "auto"}]
    m = re.fullmatch(r"(.+?)状態で(このキャラクターを支配した場合|あなたがこのカードをセットした場合)、(.+)", main)   # "…状態でこのキャラクターを支配した場合"
    if m:
        cnd = cond_of(m.group(1) + "状態")
        if cnd is None: return None
        trig_cond, main = cnd, m.group(2) + "、" + m.group(3)
    m = re.fullmatch(r"あなたがこのキャラクターを“([^”]+)”でブレイクした場合、(.+)", main)
    if m:
        TRIGGERS_X = [(r"__BY__", {"event": "brokenSelf", "own": True, "byName": re.sub(r"\s+", "", m.group(1))})]
        main = "__BY__、" + m.group(2)
    else: TRIGGERS_X = []
    m = re.fullmatch(r"このカードが「([^」]+)」にセットされた場合、(.+)", main)
    if m: trig_cond, main = {"belowName": re.sub(r"\s+", "", m.group(1))}, "このカードがセットされた場合、" + m.group(2)
    gm = re.match(r"≪このキャラクターのアタック宣言に対してガード宣言((?:する|している)か、このキャラクターにガード宣言(?:された|されている)|した)", text)
    if gm:   # "≪このキャラクターのアタック宣言に対してガード宣言するか、…キャラクター≫に / を …": when that guard is declared (Revise#109)
        eff = parse_body(re.sub(r"^(≪このキャラクターのアタック宣言に対してガード宣言[^≫]*?キャラクター)(?<!そのキャラクター)に(セットされている[^≫]+)≫", r"\1≫に\2", text))
        if eff["status"] == "auto" and not eff.get("target"):
            return [{"kind": "trigger", "when": dict({"event": "guarded", "self": True}, **({"asAttacker": True} if gm.group(1) == "した" else {})), "optional": False, "text": text, "effect": eff, "status": "auto"}]
    # triggers: "…した場合、<effect>"
    for pat, when in TRIGGERS_X + TRIGGERS:
        m = re.fullmatch(pat + r"、(.+)", main) or (re.fullmatch(pat + r"([«≪].+)", main) if pat.endswith("に?") else None)   # "…バトル開始時に≪…≫…" (Revise#157)
        if not m: continue
        eff_text = re.sub(r"«(\d)»", lambda k: "≪%s≫" % raw[int(k.group(1))], m.group(1))
        optional = bool(re.search(r"(可能|してもよい|できる)$", eff_text)) or bool(re.search(r"(セット|加える)可能(?=。|$)", eff_text))
        eff_text = re.sub(r"セット可能(?=。|$)", "セットする", eff_text)
        eff_text = re.sub(r"セット可能$", "セットする", eff_text)
        eff_text = re.sub(r"(捨て札|ドロー|セット)可能$", r"\1する", re.sub(r"(してもよい|することができる)$", "する", re.sub(r"ことが可能$", "", eff_text)))
        rest_text = "".join(re.sub(r"«(\d)»", lambda k: "≪%s≫" % raw[int(k.group(1))], x) + "。" for x in rest)
        eff = parse_body(eff_text + "。" + rest_text)
        if eff["status"] == "manual":
            if cond_of(main[:len(main) - len(m.group(1)) - 1]) is not None: break   # also a condition ("…プレイヤーにアタックした場合、≪…≫の攻撃力に+1して判定する"): the always-on reading below
            return None
        ab = {"kind": "trigger", "when": when, "optional": optional, "text": text, "effect": eff, "status": eff["status"]}
        if trig_cond: ab["cond"] = trig_cond
        return [ab]
    if not rest_ok: return None
    # always-on, with an optional condition: "<cond>、<clause>"
    cond, clause, per = None, main, None
    m = re.fullmatch(r"このキャラクターのパワー(\d+)につき、(«.+)", main)   # "パワー1につき、…に±0/+1/+1する"
    if m: per, clause = int(m.group(1)), m.group(2)
    m = None if per else re.fullmatch(r"(.+?)、(«.+)", main)
    if m:
        cond = cond_of(m.group(1))
        if cond is None: return None
        clause = m.group(2)
    cm = clause_mods(clause, R)
    if not cm: return None
    out = []
    for ref, mod in cm:
        if ref is None: return None
        if isinstance(mod.get("value"), dict) and mod["value"].get("xvar"):
            if not xd: return None
            mod = dict(mod, value=dict({"x": xd, "sign": mod["value"]["sign"]}, **({"per": per} if per else {})))   # "パワー1につき、…+X": X × (power ÷ per)
        if per and isinstance(mod.get("value"), int): mod = dict(mod, value={"x": {"power": "self", "div": per}, "sign": mod["value"]})
        if ref == "card" and mod["key"] == "cardCost": ref = "self"
        if isinstance(ref, dict) and "cards" in ref:   # "≪極星帝国のプロジェクトカード≫のコストは1上昇する": every player's declarations of that kind
            if mod["key"] not in ("cardCost", "factorLess"): return None
            mod = dict(mod, value={"n": mod["value"], "sel": ref["cards"]}); ref = {"players": "all"}
        to = ref if ref in ("self", "you", "opp", "battleOpp") or isinstance(ref, dict) else None
        if to is None: return None
        if mod["key"] == "_inheritAll": c["inherit"] = {"all": True}; continue
        if isinstance(mod.get("value"), dict) and mod["value"].get("_mentalMaxX"):
            if not xd: return None
            mod = dict(mod, value={"mentalMaxX": xd})
        if isinstance(to, dict) and '"n": "X"' in json.dumps(to):
            if not xd: return None
            mod = dict(mod, xdef=xd)
        ab = {"kind": "always", "text": text, "mod": dict(mod, to=to)}
        if cond: ab["cond"] = cond
        out.append(ab)
    return out


# ---------------------------------------------------------------- abilities
KEEP = re.compile(r"(?:≪このキャラクター≫|このキャラクター|このカード(?:をセットされている[^が]*)?)が(?:、?[^、。]*?)(?:捨て札(?:され|にな)る|除去される)場合、([^。]*?)場に残す")
def keep_ability(line):
    m = KEEP.search(line)
    if not m: return None
    how, pay = m.group(1), {}
    n = int((re.search(r"(\d+)枚", how) or [None, 1])[1])
    if re.search(r"パワーカード\d*枚?を(?:あなたの|オーナーの)?ダメージ置き場", how): pay = {"power": n, "powerTo": "damage"}
    elif re.search(r"パワーカード\d*枚?を捨て札", how): pay = {"power": n, "powerTo": "discard"}
    elif "パーマネントカード全て" in how: pay = {"perm": "all", "permTo": "damage"}
    elif re.search(r"パーマネントカード1枚を捨て札", how): pay = {"perm": 1, "permTo": "discard"}
    elif "このカードをオーナーの手札に戻" in how: pay = {"self": "hand"}
    elif "このカードを捨て札" in how: pay = {"self": "discard"}
    elif "このカードをダメージ置き場に置" in how: pay = {"self": "damage"}   # A3-07 1199 (Revise#171)
    else: pay = {"manual": True}
    ab = {"kind": "replace", "when": "leave", "pay": pay, "text": line, "label": "keep it"}
    if re.search(r"(?:あなたの)?対戦相手が使用した(?:プロジェクトカード|ファストカード|エフェクト|・)+の効果によって", line): ab["outsideOnly"] = True; ab["byOppOnly"] = True   # A3-07 1199 (Revise#171)
    elif "バトル以外" in line: ab["outsideOnly"] = True
    elif re.search(r"バトルの結果|アタックを受けて", line): ab["battleOnly"] = True
    return ab


def always_ability(line):
    """"≪このキャラクター≫はシールド・インターセプトを得る。" (no condition) → always-on skill grant."""
    m = re.fullmatch(r"≪([^≫]+)≫は(.+?)を得る。?", line)
    if not m: return None
    p = parse_target(m.group(1))
    sk = skills_list(m.group(2))
    if not p or not sk or p[0] != "ref": return None
    to = p[1]
    if to not in ("self",) and not isinstance(to, dict): return None
    return [{"kind": "always", "text": line, "mod": {"to": to, "key": "skill", "op": "grant", "value": {"id": x["id"], "x": x["x"]}}} for x in sk]


def break_rule(lines):
    rule = {}
    for line in lines:
        if not line.startswith("【"): continue
        m = re.search(r"【(ブレイクしている)?“([^”]+)”のみブレイク可能", line)
        if m: rule["onlyName"] = re.sub(r"\s+", "", m.group(2)); rule.update({"onlyBroken": True} if m.group(1) else {})
        names = re.findall(r"“([^”]+)”", line) if re.fullmatch(r"【(?:“[^”]+”[”“]?)+(?:・|、)?(?:“[^”]+”)*を?ブレイク可能。?】", line.replace("””", "”“")) else []
        if names: rule["names"] = [re.sub(r"\s+", "", x) for x in names]
        if re.search(r"【ネーム・分類に関わらず", line): rule["anyName"] = True; rule["anyIcon"] = True
        if re.search(r"【ブレイクしているキャラクターを、?分類・ネームを無視してブレイク可能", line): rule.update({"onlyBroken": True, "anyName": True, "anyIcon": True})
        elif re.search(r"【分類に関わらずブレイク可能", line): rule["anyIcon"] = True
        m = re.search(r"分類に関わらず、(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のキャラクターをブレイク可能", line)
        if m: rule["anyIconFaction"] = FACTION_JP[m.group(1)]
        m = re.search(r"分類に関わらず、(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)または(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のキャラクターをブレイク可能", line)   # Saga 4 (Revise#268)
        if m: rule["anyIconFactions"] = [FACTION_JP[m.group(1)], FACTION_JP[m.group(2)]]
        if re.search(r"分類に関わらず、勢力キャラクターをブレイク可能", line): rule["anyIconActive"] = True   # Revise#268
        if re.search(r"分類に関わらず、あなたのテリトリーの▼を持つキャラクターをブレイク可能", line): rule["anyIconOwnAggr"] = True   # A4-EP EP598 … (Revise#268)
        m = re.fullmatch(r"【([^、【】]+?)を分類を無視してブレイク可能。?】", line)   # "【サイボーグ♂・マシン・アンドロイドを分類を無視してブレイク可能。】" (Revise#268)
        if m and class_tokens(m.group(1)) and len(class_tokens(m.group(1))) == len(m.group(1).split("・")): rule["anyIconOf"] = class_tokens(m.group(1))
        m = re.fullmatch(r"【パワー(\d+)のキャラクターを、ネーム・分類を無視してブレイク可能。?】", line)
        if m: rule.update({"anyName": True, "anyIcon": True, "onlyPower": int(m.group(1))})
        if "分類に関わらず、支配キャラクターをブレイク可能" in line: rule["anyIconControlled"] = True
        if re.search(r"【あなたの支配エリアのネームレベルキャラクターが捨て札されたターンにのみ、?ブレイク可能。?】", line): rule["namedGoneTurn"] = True   # EP437 (Revise#228)
        if "分類に関わらず、ブレイクしていないキャラクターをブレイク可能" in line: rule["anyIconUnbroken"] = True   # Revise#134
        if "このカードの使用宣言時に指定した勢力のキャラクターを、分類を無視してブレイク可能" in line: rule["anyIconAnyFaction"] = True   # 2418 (Q#55): the faction is named when it enters — read as "any character, class ignored"
        m = re.fullmatch(r"【[“\"]([^”\"]+)[”\"]が場に存在する場合のみ、ブレイク可能。?】", line)   # Revise#143
        if m: rule["ifNameOnField"] = re.sub(r"\s+", "", m.group(1))
        m = re.search(r"分類に関わらず、分類・(.+?)を持つキャラクターをブレイク可能", line)   # Revise#141
        if m and class_tokens(m.group(1)): rule["anyIconOf"] = class_tokens(m.group(1))
        if "精神攻撃力を持つキャラクターを、ネーム・分類を無視してブレイク可能" in line: rule.update({"anyName": True, "anyIcon": True, "onlyMental": True})   # Revise#138
        if re.search(r"【あなたの(テリトリーの|支配)?キャラクターのみ", line): rule["onlyOwn"] = True
        if re.search(r"【(他のプレイヤー|対戦相手)の(テリトリーの)?キャラクターのみ", line): rule["onlyOthers"] = True
        m = re.fullmatch(r"【“([^”]+)”、“([^”]+)”のみブレイク可能。?】", line)   # Revise#152
        if m: rule.pop("onlyName", None); rule["onlyNames"] = [re.sub(r"\s+", "", m.group(1)), re.sub(r"\s+", "", m.group(2))]; rule["names"] = list(rule["onlyNames"])
        m = re.fullmatch(r"【ネームに関わらず、“([^”]+)”をブレイク可能。?】", line)
        if m: rule["names"] = [re.sub(r"\s+", "", m.group(1))]
        if re.fullmatch(r"【パワーカードのセットされているネームレベルでないキャラクターをブレイク可能。?】", line): rule["powerUnnamed"] = True
        if re.fullmatch(r"【ガード宣言しているキャラクターを、分類を無視してブレイク可能。?】", line): rule["anyIconGuarding"] = True
        m = re.fullmatch(r"【“([^”]+?)のみブレイク可能”】", line)   # "【“木之坂 霧之のみブレイク可能”】" (misplaced quote, Revise#157)
        if m: rule["onlyName"] = re.sub(r"\s+", "", m.group(1))
        m = re.fullmatch(r"【([^“【】]+?)\s?“([^”]+)”のみブレイク可能。?】", line)   # "【クロスキャリバー“アプリコット・桜葉”のみブレイク可能。】": that card name only
        if m and not rule.get("onlyName"): rule["onlyJp"] = re.sub(r"\s+", "", m.group(1) + "“" + m.group(2) + "”")
        m = re.fullmatch(r"【ネームを無視して“([^”]+)”をブレイク可能。?】", line)
        if m: rule["names"] = [re.sub(r"\s+", "", m.group(1))]
        m = re.fullmatch(r"【構成しているカードに((?:「[^」]+」と?)+)を含む“([^”]+)”のみブレイク可能。?】", line)   # PR336 (Revise#157)
        if m: rule["onlyName"] = re.sub(r"\s+", "", m.group(2)); rule["stackJp"] = [re.sub(r"\s+", "", x) for x in re.findall(r"「([^」]+)」", m.group(1))]
        if not rule: rule["manual"] = line
    return rule or None


# ---------------------------------------------------------------- skills
def parse_skills(row, text):
    sk = {}
    for k in VALUED:
        v = N(row.get(f"Skill: {k}"))
        if not v: continue
        if re.fullmatch(r"[+\-]?\d+", v): sk[k.lower()] = int(v)
        elif k == "Boost": sk["boost"] = True   # Boost X / ∞: as many as it can pay
        elif re.fullmatch(r"[+]?∞", v): sk[k.lower()] = 99   # "キャパシティ+∞" / "パーマネント+∞" (Pack, A3-17 2388, Revise#278): 99 stands for ∞
    for t in N(row.get("Skills")).split(";"):
        t = t.strip()
        if not t: continue
        if t in FLAG_SKILLS: sk[FLAG_SKILLS[t]] = True; continue
        m = re.match(r"(Resist|Protect)\s+(.+)", t)
        if m:
            fs, ics = [], []
            for part in re.split(r"/", m.group(2).replace("(faction)", "").strip()):
                part = part.strip().replace("分類", "")
                if part in FACTION_EN: fs.append(part)
                elif part.replace("♂", "") in CLASS_FROM_EN: ics.append(CLASS_FROM_EN[part.replace("♂", "")] + ("♂" if part.endswith("♂") else ""))
                elif part.replace("♂", "") in CLASS_EN: ics.append(part)
                elif part in FACTION_JP: fs.append(FACTION_JP[part])
            key = m.group(1).lower()
            prev = sk.get(key) or {"factions": [], "icons": []}
            sk[key] = {"factions": sorted(set(prev["factions"] + fs)), "icons": sorted(set(prev["icons"] + ics))} if key == "resist" else {"factions": sorted(set(prev["factions"] + fs))}
    m = re.search(r"サーチ\(([^)]*)\)", text)
    if m or "Search" in N(row.get("Skills")):
        inner = m.group(1) if m else ""
        names = [re.sub(r"\s+", "", x) for x in re.findall(r"“([^”]+)”", inner)]
        sel = {"label": inner}
        f = re.fullmatch(r"(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)の(キャラクター|ブレイク|パーマネント|プロジェクト|ファスト)カード", inner)
        if len(names) == 1: sel["name"] = names[0]
        elif names: sel["any"] = [{"name": x} for x in names]
        elif f: sel.update({"faction": FACTION_JP[f.group(1)], "type": {"キャラクター": "Character", "ブレイク": "Break", "パーマネント": "Permanent", "プロジェクト": "Project", "ファスト": "Fast"}[f.group(2)]})
        elif inner == "デュアルを持つカード": sel["skill"] = "dual"
        else: sel["manual"] = True
        sk["search"] = sel
    if any(line.startswith("▼") for line in text.split("\n")): sk["aggressive"] = True
    return sk


# ---------------------------------------------------------------- one card
SKILL_ONLY = re.compile(r"[▼\s]*((チャージ|ドロー|バインド|パーマネント|キャパシティ|ブースト|リムーブ)[+\-]?[\dX∞]+(?:-X)?|シールド|インターセプト|イニシアチブ|ブレイクスルー|オフェンシブ|ディフェンシブ|シンクロ|ペネトレイト|デュアル|ステルス|インフィニティ|インヘレント|(レジスト|プロテクト)\S+|サーチ\([^)]*\)|\s)*")
SKILL_PREFIX = re.compile(r"^[▼\s]*(?:(?:(?:チャージ|ドロー|バインド|パーマネント|キャパシティ|ブースト|リムーブ)[+\-]?[\dX∞]+(?:-X)?|シールド|インターセプト|イニシアチブ|ブレイクスルー|オフェンシブ|ディフェンシブ|シンクロ|ペネトレイト|デュアル|ステルス|インフィニティ|インヘレント|(?:レジスト|プロテクト)\S+|サーチ\([^)]*\))(?:\s+|$))*")


def join_rule_lines(lines):
    """A 【…】 rule written over two lines → one line."""
    out = []
    for line in lines:
        if out and out[-1].startswith("【") and "】" not in out[-1]: out[-1] += line
        else: out.append(line)
    return out


def deck_pick_sel(t):
    """"プロジェクトカードまたはファストカード" / "ネームを持つE.G.O.のブレイクカード" / "ブレイクカード" → pickZone sel, or None."""
    m = re.fullmatch(r"((?:“[^”]+”)(?:または“[^”]+”)*)(?:のネームを持つ|が描かれている)(カード|ブレイクカード)", t)   # EXPR014 (Revise#201); "“X”が描かれている" (EX0307, Revise#210)
    if m: return dict({"names": [re.sub(r"\s+", "", x) for x in re.findall(r"“([^”]+)”", m.group(1))]}, **({"types": ["Break"]} if m.group(2) == "ブレイクカード" else {}))
    m = re.fullmatch(r"(武蔵|英国|三征西班牙|K\.P\.A\.Italia|六護式仏蘭西|M\.H\.R\.R\.|P\.A\.Oda|上越露西亜|清武田|IZUMO)とネームを持つブレイクカード", t)   # EX826 (Revise#242)
    if m: return {"types": ["Break"], "named": True, "tag": m.group(1)}
    if t == "カード": return {}   # "トップをねらえ!シリーズのカード" (EP554, Revise#229): any card of the work
    m = re.fullmatch(r"“([^”]+)”(?:カード)?", t)   # "“ガンバスター”1枚を選び" (A4-EP EP529, Revise#310): that name
    if m: return {"names": [re.sub(r"\s+", "", m.group(1))]}
    m = re.fullmatch(r"「([^」]+)」(?:カード)?", t)   # "「重武神“道征き白虎”」" (EX855, Revise#310): a card name
    if m: return {"jp": re.sub(r"\s+", "", m.group(1))}
    m = re.fullmatch(r"カードテキストに「([^」]+)」を含む(.+)", t)   # "カードテキストに「宮内大臣一座」を含むプロジェクトカード" (EX832, Revise#310)
    if m and deck_pick_sel(m.group(2)) is not None: return dict(deck_pick_sel(m.group(2)), textHas=m.group(1))
    if t == "キャラクターカードまたはブレイクカード": return {"types": ["Character", "Break"]}   # EP495
    if t == "ネームを持つ帝のブレイクカード": return {"types": ["Break"], "named": True, "faction": "Polestar Empire"}   # A3-PP PP271 (Revise#215): "帝" = 極星帝国, as its first line
    m = re.fullmatch(r"(ネームを持つ|ネームレベルでない)?([^のをにで、]+?)の(ブレイクカード|キャラクターカード)", t)   # a class: "ネームを持つクリーチャーのブレイクカード"
    if m and m.group(2) not in FACTION_JP and class_tokens(m.group(2).replace("または", "・")):
        sel = {"types": ["Break" if m.group(3) == "ブレイクカード" else "Character"], "icons": class_tokens(m.group(2).replace("または", "・"))}
        if m.group(1): sel["named"] = m.group(1) == "ネームを持つ"
        return sel
    m = re.fullmatch(r"カード名称に「([^」]+)」を含む(カード|ブレイクカード|キャラクターカード)", t)   # A3-21 2945 (Revise#166)
    if m: return dict({"jpHas": m.group(1)}, **({"types": [{"ブレイクカード": "Break", "キャラクターカード": "Character"}[m.group(2)]]} if m.group(2) != "カード" else {}))
    wm = re.match(r"(?:エキストラパック)?(" + "|".join(re.escape(k) for k in WORKS_JP) + r")(?:の、?|に登場する、?|に収録されている、?)", t)   # "魔法戦記リリカルなのはForceの、ネームを持つブレイクカード" (M3g, Revise#192)
    if wm:
        inner = deck_pick_sel(t[wm.end():])
        return dict(inner, works=WORKS_JP[wm.group(1)]) if inner is not None else None
    m = re.fullmatch(r"(ネームを持つ|ネームレベルでない)?(?:(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)の)?((?:ブレイク|プロジェクト|ファスト|パーマネント|キャラクター)カード(?:または(?:ブレイク|プロジェクト|ファスト|パーマネント|キャラクター)カード)*)", t)
    if not m: return None
    sel = {"types": [dict(CARD_TYPES_JP, キャラクター="Character")[x.replace("カード", "")] for x in m.group(3).split("または")]}
    if m.group(1): sel["named"] = m.group(1) == "ネームを持つ"
    if m.group(2): sel["faction"] = FACTION_JP[m.group(2)]
    return sel


def modes_of(rest):
    """「…」「…」 → the texts inside the outer brackets (nested 「」 kept)."""
    out, depth, cur = [], 0, ""
    for ch in rest:
        if ch == "「":
            depth += 1
            if depth == 1: cur = ""; continue
        if ch == "」":
            depth -= 1
            if depth == 0: out.append(cur.strip()); continue
        if depth >= 1: cur += ch
    return out


def statements(lines):
    """Card text lines → statements. The card list wraps long sentences over several lines, and puts
    "Xは…に等しい。" / "その後、…" on a line of their own: those belong to the statement before."""
    out = []
    for line in lines:
        rest = SKILL_PREFIX.sub("", line).strip()
        if rest != line.strip() and re.fullmatch(r"[^\s。≪≫「」、:：]{1,10}", rest):   # skills + a tag word: "キャパシティ-1 チャージ1 武蔵"
            out.append({"text": line, "flavour": False, "skills": True, "tag": rest}); continue
        if rest != line.strip() and rest.startswith("「") and SKILL_ONLY.fullmatch(line[:len(line) - len(rest)].strip()):   # "ドロー+1 「…」": skills, then a quote (Revise#157)
            out.append({"text": line[:len(line) - len(rest)].strip(), "flavour": False, "skills": True}); out.append({"text": rest, "flavour": True, "skills": False}); continue
        if out and out[-1]["flavour"] and out[-1]["text"].count("「") > out[-1]["text"].count("」") and "≪" not in line and not re.search(r"(効果|可能|する|与える|できない|選択|受けない|得る)。?」?$", line):   # a quote that goes on over the next line
            out[-1]["text"] += line; continue
        if "≪" not in line and "：" not in line and ":" not in line and (re.search(r"」$", line) and "「" not in line and not re.search(r"(効果|可能|する|与える|できない|選択|受けない|得る)。?」$", line) or re.search(r"(ーー|……|――)$", line)):   # the end of a quote / a flavour phrase
            out.append({"text": line, "flavour": True, "skills": False}); continue
        flavour = line.startswith("「") or line.startswith("【") or re.fullmatch(r"『[^』]*』[。!！]?", line) or re.fullmatch(r"▼[\s　]*「.*", line) or re.match(r"\d{4}\s", line) or re.fullmatch(r"[\d\s]+", line) \
            or (len(line) <= 12 and "。" not in line and "≪" not in line and not SKILL_ONLY.fullmatch(line) and not EFFECT_LINE.match(line) and not out or (out and out[-1]["text"].endswith("。") and len(line) <= 12 and "。" not in line and "≪" not in line and not EFFECT_LINE.match(line) and not SKILL_ONLY.fullmatch(line)))   # series labels such as 武蔵 / 英国
        if out and not flavour and not EFFECT_LINE.match(line) and not SKILL_ONLY.fullmatch(line):
            prev = out[-1]
            cont = re.match(r"(Xは|その後、|ただし、|この効果で|その場合、バトル終了後に)", line) or (EFFECT_LINE.match(prev["text"]) and not re.match(r"(このキャラクター|このカード|あなた)", line)
                and not (prev["text"].endswith("。") and re.match(r"≪このキャラクター以外の、", line)))   # an always-on line after an effect (Revise#140)
            if not (prev["flavour"] or prev["skills"]) and (not prev["text"].endswith("。") or cont):
                prev["text"] += line
                continue
        out.append({"text": line, "flavour": bool(flavour), "skills": bool(SKILL_ONLY.fullmatch(line))})
    return out


def resolve_same_as(compiled, raw):
    """A3-PR personality promos (PR326 – PR329, Revise#157): played by anyone but that personality, the card is the
    card named in 「…」 — its rules are copied from that card (the first printing found)."""
    by_jp = {}
    for k, r in raw.items():
        jp = re.sub(r"\s+", "", str(r.get("カード名称") or ""))
        if jp and k not in by_jp.get(jp, []): by_jp.setdefault(jp, []).append(k)
    for k, c in compiled.items():
        jp = c.get("sameAsJp")
        if not jp: continue
        src = next((x for x in by_jp.get(jp, []) if not compiled[x].get("sameAsJp")), None)
        if not src: continue
        keep = {kk: c[kk] for kk in ("sameAsJp",)}
        compiled[k] = dict(json.loads(json.dumps(compiled[src])), **keep, sameAs=src)


MENTAL_AT = re.compile(r"攻撃力(?:に|を)[+\-ー−]\((?:\d+|X)\)|[±+\-ー−]\(?(?:\d+|X)\)?/[±+\-ー−]\((?:\d+|X)\)/")
NORMAL_AT = re.compile(r"(?<!精神)攻撃力(?:に|を)[+\-ー−](?:\d+|X)|[±+\-ー−]\(?(?:\d+|X)\)?/[±+\-ー−](?:\d+|X)/")
def mental_at_pass(c, text):
    """Pack (Revise#191): "+(N)" on Attack is mental Attack. The stat parsers read "+(1)" as 1, so a line whose Attack changes are all
    written in brackets has its Attack modifiers turned into "atm" (mental Attack; the engine adds it beside a normal Attack)."""
    def conv(o):
        if isinstance(o, dict):
            if o.get("key") == "at" and o.get("op", "add") == "add" and "value" in o: o["key"] = "atm"
            for v in o.values(): conv(v)
        elif isinstance(o, list):
            for v in o: conv(v)
    def item(o, t):
        t = N(t or "")
        if t and MENTAL_AT.search(t) and not NORMAL_AT.search(t) and not re.search(r"(?:精神攻撃力|通常攻撃力|本来の攻撃力)(?:に|を)[±+\-ー−]", t): conv(o)   # a mere mention of 精神攻撃力 elsewhere does not stop it (Pack report A3-24 3471, Revise#296)
    for ab in c.get("abilities", []): item(ab, ab.get("text"))
    for ef in c.get("effects", []): item(ef, ef.get("text"))
    if "play" in c: item(c["play"], text)

DUAL_AT = re.compile(r"攻撃力に[\-ー−](?:\d+|X)・[ー−\-]\((?:\d+|X)\)|攻撃力に[ー−\-]\((?:\d+|X)\)・[\-ー−](?:\d+|X)")
def dual_at_pass(c, text):
    """Pack report (A3-24 3465, Revise#297): "攻撃力に-X・ー(X)" lowers normal AND mental Attack by X (each stays ≥ 0), so a character
    with both kinds loses both. norm_at turned it into "-X" (normal only, Revise#111, before normal / mental were apart); add the mental twin."""
    def neg(v): return (isinstance(v, (int, float)) and v < 0) or (isinstance(v, dict) and (v.get("sign", 1) < 0))
    def twin_steps(steps):
        out = []
        for st in steps:
            out.append(st)
            m = st.get("mod") if isinstance(st, dict) and st.get("a") == "mod" else None
            if m and m.get("key") == "at" and m.get("op", "add") == "add" and neg(m.get("value")): out.append(dict(st, mod=dict(m, key="atm")))
        return out
    def item(o, t):
        if not (t and DUAL_AT.search(N(t))): return
        if isinstance(o.get("steps"), list): o["steps"] = twin_steps(o["steps"])
        if isinstance(o.get("effect"), dict) and isinstance(o["effect"].get("steps"), list): o["effect"]["steps"] = twin_steps(o["effect"]["steps"])
    for ef in c.get("effects", []): item(ef, ef.get("text"))
    for ab in c.get("abilities", []): item(ab, ab.get("text"))
    if "play" in c: item(c["play"], text)
    extra = []
    for ab in c.get("abilities", []):   # an always-ability holds one mod: add its mental twin as another ability
        m = ab.get("mod") if ab.get("kind") == "always" else None
        if m and DUAL_AT.search(N(ab.get("text") or "")) and m.get("key") == "at" and m.get("op", "add") == "add" and neg(m.get("value")): extra.append(dict(ab, mod=dict(m, key="atm")))
    if extra: c["abilities"] = c["abilities"] + extra


def share_x_pass(c):
    """Pack report (A3-24 3465, Revise#297): one "Xは…" line under several effects defines X for each effect that uses X
    (it was attached to the last effect only)."""
    effs = c.get("effects") or []
    xs = {json.dumps(e["x"], sort_keys=True) for e in effs if e.get("x")}
    if len(xs) != 1: return
    x = json.loads(next(iter(xs)))
    for e in effs:
        if e.get("x") or str(e.get("cost")) == "X": continue
        if re.search(r'"xvar"|"n": "X"|"value": "X"', json.dumps(e.get("steps") or [], ensure_ascii=False)): e["x"] = x


_PERSIST = [False]   # the card being compiled is a 持続 (lasting) Project / Fast card (Revise#208)


def compile_card(row):
    prev = _PERSIST[0]; _PERSIST[0] = N(row.get("瞬間／持続") or "") == "持続"
    try: c = compile_card0(row)
    finally: _PERSIST[0] = prev
    for ab in c.get("abilities", []):   # "このカードがセットされた場合、≪このカードのコスト≫を手札に戻す。その後、…" (A4-05 0910, Revise#310): the card's cost comes back
        ef = ab.get("effect") if ab.get("kind") == "trigger" and ab.get("when") == {"event": "enter", "self": True} else None
        if ef and ef.get("costTo") == "hand" and c.get("type") in ("Break", "Character") and "costBack" not in c:
            c["costBack"] = {"to": "hand"}; del ef["costTo"]
    # a trigger that uses X while the card's one "Xは…" sentence sits on another line (A4-02 0307: "…Xドローする" / "…ファクターをX得る。Xは…", Revise#340)
    xs0 = [x_def(xm.group(0)) for xm in re.finditer(r"Xは[^。]+?に等しい", N(row.get("カードテキスト") or ""))]
    xs0 = [x for x in xs0 if x]
    if len(xs0) == 1:
        for ab in c.get("abilities", []):
            ef = ab.get("effect") if ab.get("kind") == "trigger" else None
            if ef and not ef.get("x") and ef.get("status") == "auto" and re.search(r'"n": "X"', json.dumps(ef.get("steps") or [], ensure_ascii=False)): ef["x"] = xs0[0]
    if c.get("statModsX") and "statX" not in c:   # the Permanent's "+X": its "Xは…" glued onto another line (Pack report A3-07 1167, Revise#325)
        for xm in re.finditer(r"Xは[^。]+?に等しい", N(row.get("カードテキスト") or "")):
            xd = x_def(xm.group(0))
            if xd: c["statX"] = xd; break
    # Pack (Revise#423): a card built with one clause left out, or done later than printed, is "partly", not "automatic"
    if c.get("status") == "auto":
        tx = N(row.get("カードテキスト") or "").replace("\n", "")
        for sub, note in SIMPLIFIED:
            if sub in tx:
                c["status"] = "partial"; c["simplified"] = note; c.setdefault("manualText", []).append(note); break
    return c


SIMPLIFIED = [   # (a piece of the card text, what the Game Table does differently) — Pack, 2026-11-12
    ("そのプレイヤーのダメージ置き場または捨て札置き場にあるプロジェクトカードまたはファストカード1枚を指定する。目標の", "The card in the pile is chosen when this card takes effect, not when it is declared."),   # A3-18 2436
    ("指定されたプレイヤーは勢力1つとカード種類1つを指定する", "The faction and the card type are named when this card takes effect, not when it is declared."),   # A3-20 2730
    ("指定した分類を持つキャラクターとのバトルによるダメージ受けない", "The class is named when this card takes effect, not when it is declared."),   # A3-25 3731
    ("その中にある、指定したカード種類のカード全てをあなたの手札に加え、残りをデッキに戻す", "The card type is named when this card takes effect, not when it is declared."),   # A4-02 0248
    ("Xが10以上の場合、目標はブレイクスルー・イニシアチブを得る。Xは指定した分類を持つあなたの支配キャラクターの数に等しい", "The class is named when this card takes effect, from the classes of its target."),   # A4-04 0711
    ("目標と同じエリアにいるキャラクター全てにXダメージを与える", "“Not affected by your own other cards” is not built."),   # A3-20 2877
    ("メインフェイズ終了時に、≪このカードと同じ名称のカードの効果でセットしたキャラクター全て≫を捨て札する", "“If this card is removed, discard the character it set” is not built."),   # A3-22 3163
    ("対象を、そのプレイヤーの勢力エリアの、対象の勢力の勢力パーティの上に、あなたの任意の順番で移動させる", "The characters move in their current order; the order is not chosen."),   # A3-20 2802
    ("このカードの効果終了時まで、プレイヤー全ては手札を公開し続ける", "The hands are not shown while the cards are taken."),   # A3-24 3579
    ("≪ネームレベルでないキャラクター全て≫に-1/-1・+(1)/-1する。この効果で1未満の数値にはならない", "Only the characters on the field when it takes effect are changed."),   # A4-03 0413
    ("目標がバトル以外のダメージを与えるかメインフェイズが終了した場合、目標を捨て札する", "“When it deals damage outside a battle” is not built: the target is discarded at the end of the Main Phase only."),   # A4-04 0710
    ("「エスケープルーム」以外のアビリティの効果を受けない", "Abilities of other cards are not blocked (Project cards, Fast cards and effects are)."),   # A3-21 3088
    ("魔法少女リリカルなのはViVidに登場するネーム1つを指定し", "Any Lyrical Nanoha Name is accepted, not only the ViVid ones."),   # A3-EX03 EX0326
    ("このカードが効果を発揮している場合、メインフェイズ終了時に、目標を捨て札する", "It is shielded from everyone's Fast cards and effects, not only the opponents'."),   # A3-EX02 EX0148
]


def compile_card0(row):
    raw_t = N(row.get("カードテキスト"))
    fm = re.search(r"(?:^|\n)\s*フールテキスト\s*[:：]\s*(?:\n|$)", raw_t)
    if fm:   # A3-23 joke cards (Pack, Q#66 / Revise#165): the normal text; the フールテキスト is kept for the Outlaw option "Fool text"
        normal, fool = raw_t[:fm.start()].strip(), raw_t[fm.end():].strip()
        c = compile_card(dict(row, **{"カードテキスト": normal}))
        f = compile_card(dict(row, **{"カードテキスト": fool}))
        def _note(o):   # a real-world instruction ("デコピンする", birthdays …): shown to the table automatically
            if isinstance(o, dict):
                if o.get("a") == "manual": return {"a": "foolNote", "text": o.get("text", "")}
                return {k: (_note(v) if k != "status" else ("auto" if v in ("manual", "partial") else v)) for k, v in o.items()}
            if isinstance(o, list): return [_note(v) for v in o]
            return o
        f = _note(f)
        c["fool"] = {k: f[k] for k in ("play", "abilities", "effects", "statMods", "statX") if k in f}
        if f.get("manualText"): c["fool"]["abilities"] = c["fool"].get("abilities", []) + [{"kind": "trigger", "when": {"event": "enter", "self": True}, "optional": False, "text": t, "effect": {"steps": [{"a": "foolNote", "text": t}], "status": "auto"}, "status": "auto"} for t in f["manualText"]]
        for k in ("play", "abilities", "effects", "manualText"):
            if k not in f and k in c: c["fool"][k] = [] if k != "play" else {"steps": [], "status": "auto"}
        c["foolStatus"] = f.get("status"); c["foolText"] = fool
        return c
    typ = N(row.get("カード種類"))
    jp = N(row.get("カード名称"))
    text = N(row.get("カードテキスト"))
    text = re.sub(r"キャパシティー(\d)", r"キャパシティ+\1", text)   # "キャパシティー1" = Capacity +1 (the Skills column agrees)
    text = re.sub(r"。[(（](\d+|X)[)）][:：]", lambda mm: "。\n" + mm.group(1) + ":", text)   # A3-EP EP071 (Revise#264): "…。(2):…" is an effect line
    lines = join_rule_lines([l.strip() for l in text.split("\n") if l.strip()])
    c = {"type": typ}
    src_title = N(row.get("エクスパンション or その他配布方法"))
    if any(re.search(rx, src_title) for rx in WORKS_RE.values()): c["works"] = [w for w, rx in WORKS_RE.items() if re.search(rx, src_title)]
    name = personal_name(jp)
    if name: c["name"] = name
    icons = class_tokens(row.get("分類アイコン"))
    if icons: c["icons"] = icons
    f = Counter(FACTOR_LETTER[ch] for ch in N(row.get("ファクター")) if ch in FACTOR_LETTER)
    if f: c["factor"] = dict(f)
    cost = N(row.get("コスト"))
    if cost: c["cost"] = "X" if cost.upper() == "X" else num(cost)
    if typ in ("Character", "Break"):
        se, at, de = N(row.get("精神力")), N(row.get("攻撃力")), N(row.get("耐久力"))
        c["se"], c["de"] = num(se), num(de)
        m = re.fullmatch(r"\((\d+)\)", at)
        c["at"] = int(m.group(1)) if m else num(at)
        if m: c["atMental"] = True
    elif typ == "Permanent":
        sm = {k: stat_mod(row.get(h)) for k, h in (("se", "精神力"), ("at", "攻撃力"), ("de", "耐久力"))}
        sm = {("atm" if k == "at" and "(" in str(N(row.get("攻撃力")) or "") else k): v for k, v in sm.items() if v}   # "+(1)": mental Attack (Revise#191)
        if sm: c["statMods"] = sm
        smx = {("atm" if k == "at" and "(" in str(N(row.get(h)) or "") else k): (-1 if str(N(row.get(h))).startswith(("-", "−")) else 1) for k, h in (("se", "精神力"), ("at", "攻撃力"), ("de", "耐久力")) if re.fullmatch(r"[+\-−]?\(?X\)?", str(N(row.get(h)) or ""))}
        if smx: c["statModsX"] = smx   # "+X" with "Xは…に等しい" on its own line (M3a, Revise#159)
    sk = parse_skills(row, text)
    if sk: c["skills"] = sk
    effects, abilities, play_lines = [], [], []
    sts = statements(lines)
    last_skill = None
    card_x = next((xm.group(1) for st in sts for xm in [re.search(r"(?:^|。)(Xは[^。]+に等しい)。?$", st["text"].strip())] if xm and x_def(xm.group(1))), None)
    if card_x and not card_x.endswith("。"): card_x += "。"
    ab_x = card_x or ("Xはこのカードのコストに等しい。" if c.get("cost") == "X" else None)   # abilities: "このカードがセットされた場合、…X枚…" = X as paid
    tags = [st["tag"] for st in sts if st.get("tag")] + [st["text"].strip("▼ 　") for st in sts if st["flavour"] and re.fullmatch(r"[▼\s　]*(武蔵|英国|三征西班牙|K\.P\.A\.Italia|六護式仏蘭西|M\.H\.R\.R\.|P\.A\.Oda|上越露西亜|清武田|IZUMO|\S{1,6}系)", st["text"])]   # a tag on a line of its own
    if tags: c["tags"] = tags
    for st in sts:
        line = st["text"]
        if st["skills"]: last_skill = line
        if st["flavour"] or st["skills"]: continue
        if last_skill and x_def(line.rstrip("。")):   # "パーマネント+X" / "Xは…に等しい。" on the next line
            sm = re.search(r"(バインド|ドロー|チャージ|キャパシティ|パーマネント)([+\-−]?)X", last_skill)
            if sm:
                c.setdefault("skills", {})[SKILL_JP[sm.group(1)]] = {"x": x_def(line.rstrip("。")), "sign": -1 if sm.group(2) in ("-", "−") else 1}
                continue
        last_skill = None
        if c.get("statModsX") and "statX" not in c and x_def(line.rstrip("。")): c["statX"] = x_def(line.rstrip("。")); continue   # the Permanent's "+X" (Revise#159)
        m = re.fullmatch(r"[▼\s]*(バインド|ドロー|チャージ|キャパシティ)([+\-−]?)X\s*(Xは.+?)。?", line)   # "バインドX Xは…に等しい" (M1a)
        if m and x_def(m.group(3)):
            sk = c.setdefault("skills", {})
            sk[SKILL_JP[m.group(1)]] = {"x": x_def(m.group(3)), "sign": -1 if m.group(2) in ("-", "−") else 1}
            continue
        m = EFFECT_LINE.match(line)
        if m:
            e = parse_body(m.group(2))
            if e["status"] != "auto" and card_x and "X" in m.group(2) and "Xは" not in m.group(2):   # X defined on its own line of the card
                e2 = parse_body(m.group(2).rstrip("。") + "。" + card_x)
                if e2["status"] == "auto" or (e2["status"] == "partial" and e["status"] == "manual"): e = e2
            e = dict({"cost": "X" if m.group(1) == "X" else int(m.group(1)), "text": line}, **e)
            effects.append(e)
            continue
        if typ == "Character" and re.fullmatch(r"[^\s。≪≫「」、]{1,10}", SKILL_PREFIX.sub("", line).strip()) and SKILL_PREFIX.sub("", line).strip() != line.strip(): continue   # skills + a label word (series tag)
        TAGW = r"(?:武蔵|英国|三征西班牙|K\.P\.A\.Italia|六護式仏蘭西|M\.H\.R\.R\.|P\.A\.Oda|上越露西亜|清武田|IZUMO)"
        rest_t = SKILL_PREFIX.sub("", line).strip()
        if rest_t != line.strip() and re.fullmatch(TAGW + r"(?:\s+" + TAGW + r")*", rest_t):   # "▼ K.P.A.Italia" / "キャパシティ+2 バインド2 チャージX 武蔵 英国" (Revise#343): skills, then series tags
            for tg in rest_t.split():
                if tg not in c.setdefault("tags", []): c["tags"].append(tg)
            sm = re.search(r"(バインド|ドロー|チャージ|キャパシティ|パーマネント)([+\-−]?)X", line)
            if sm and card_x and x_def(card_x.rstrip("。")): c.setdefault("skills", {})[SKILL_JP[sm.group(1)]] = {"x": x_def(card_x.rstrip("。")), "sign": -1 if sm.group(2) in ("-", "−") else 1}
            if not sm or card_x: continue
        k = keep_ability(line)
        if k: abilities.append(k); continue
        if typ in ("Fast", "Project"): play_lines.append(line); continue
        if x_def(line.strip().rstrip("。")): continue   # an X definition on a line of its own: used by the statements that say X
        body0 = SKILL_PREFIX.sub("", line)
        tm2 = re.match(r"(武蔵|英国|三征西班牙|K\.P\.A\.Italia|六護式仏蘭西|M\.H\.R\.R\.|P\.A\.Oda|上越露西亜|清武田|IZUMO)\s*(?=≪)", body0) if body0 != line else None   # "シールド K.P.A.Italia≪…≫は…" (EX0720, Revise#345)
        if tm2:
            if tm2.group(1) not in c.setdefault("tags", []): c["tags"].append(tm2.group(1))
            body0 = body0[tm2.end():]
        tm = re.match(r"(\S{1,8}系)\s+(?=\S)", body0)
        if tm: c.setdefault("tags", []).append(tm.group(1)); body0 = body0[tm.end():]
        a = parse_ability(body0, c)
        if a is None and "X" in body0 and ab_x and not re.search(r"Xは", body0): a = parse_ability(body0.rstrip("。") + "。" + ab_x, c)   # X defined elsewhere on the card
        elif a and ab_x and "X枚" in body0 and not re.search(r"Xは", body0) and any(x.get("kind") == "trigger" and "x" not in x.get("effect", {}) for x in a):   # a trigger "…X枚…": X from the card's own line (Revise#126)
            a2 = parse_ability(body0.rstrip("。") + "。" + ab_x, c)
            if a2: a = [dict(x, text=body0) for x in a2]
        if a is not None: abilities.extend(a); continue
        play_lines.append(line)
    if "このキャラクターに効果を発揮している各勢力のプロジェクトカード・ファストカード1枚につき、≪このキャラクター≫は以下の能力を得る" in text:   # 3792 (Revise#152): the table of 「faction：bonus」
        FJ = {"E.G.O.": "E.G.O.", "阿羅耶識": "Arayashiki", "WIZーDOM": "WIZ-DOM", "WIZ-DOM": "WIZ-DOM", "ダークロア": "Darklore", "極星帝国": "Polestar Empire", "イレイザー": "Eraser"}
        for fac, bonus in re.findall(r"「([^：:」]+)[：:]([^」]+)」", text):
            fac = fac.strip(); bonus = bonus.strip()
            if fac == "全ての勢力":
                cond = {"all": [{"xAtLeast": {"x": {"lastingFaction": f}, "n": 1}} for f in sorted(set(FJ.values()))]}
                sk = skills_list(bonus)
                if sk: abilities.extend({"kind": "always", "text": f"{fac}:{bonus}", "mod": {"to": "self", "key": "skill", "op": "grant", "value": x}, "cond": cond} for x in sk)
                continue
            f = FJ.get(fac)
            if not f: continue
            xv = {"x": {"lastingFaction": f}, "sign": 1}
            sm = re.fullmatch(r"([±+\-]\d+)/([±+\-]\d+)/([±+\-]\d+)", bonus.replace("±0", "+0"))
            am = re.fullmatch(r"(精神力|攻撃力|耐久力)\+\(?(\d+)\)?", bonus)
            if sm:
                for k, g in (("se", 1), ("at", 2), ("de", 3)):
                    n = int(sm.group(g))
                    if n: abilities.append({"kind": "always", "text": f"{fac}:{bonus}", "mod": {"to": "self", "key": k, "op": "add", "value": {"x": {"lastingFaction": f}, "sign": 1, "per": n}}})
            elif am:
                abilities.append({"kind": "always", "text": f"{fac}:{bonus}", "mod": {"to": "self", "key": STAT_JP[am.group(1)], "op": "add", "value": {"x": {"lastingFaction": f}, "sign": 1, "per": int(am.group(2))}}})
            elif skills_list(bonus):
                abilities.extend({"kind": "always", "text": f"{fac}:{bonus}", "mod": {"to": "self", "key": "skill", "op": "grant", "value": x}, "cond": {"xAtLeast": {"x": {"lastingFaction": f}, "n": 1}}} for x in skills_list(bonus))
    bm = re.search(r"(バインド|ドロー|チャージ|キャパシティ|パーマネント)(\d+)-X(?=\s|$)", text)   # 2899 (Revise#152): "バインド3-X" (X from the card's own line)
    if bm and card_x: c.setdefault("skills", {})[SKILL_JP[bm.group(1)]] = {"x": x_def(card_x.rstrip("。")), "sign": -1, "base": int(bm.group(2))}
    if card_x:   # "チャージX" with its "Xは…に等しい" further down the card, after the effects (A3-19 2656 — Pack, 2026-11-07)
        for st in sts:
            if not st["skills"]: continue
            for sm in re.finditer(r"(バインド|ドロー|チャージ|キャパシティ|パーマネント)([+\-−]?)X(?![-\w])", st["text"]):
                k = SKILL_JP[sm.group(1)]
                if not isinstance((c.get("skills") or {}).get(k), dict): c.setdefault("skills", {})[k] = {"x": x_def(card_x.rstrip("。")), "sign": -1 if sm.group(2) in ("-", "−") else 1}
    ni = sum(len(re.findall(r"(?:^|\s)イニシアチブ(?=\s|$)", st["text"])) for st in sts if st["skills"] or SKILL_PREFIX.match(st["text"]).group(0).strip())   # Q#56: "イニシアチブ イニシアチブ" = 2
    if ni > 1: c["skillCount"] = {"initiative": ni}
    if effects: c["effects"] = effects
    br = break_rule(lines) if typ == "Break" else None
    if br: c["breakRule"] = br
    if typ in ("Fast", "Project"):
        keep = []
        for x in play_lines:   # "このカードがあなたのダメージ置き場にある場合、…手札にあるカードと同様に使用宣言可能。この効果で使用宣言した場合、あなたのデッキのカードを上からN枚捨て札する。"
            pm = re.fullmatch(r"このカードがあなたのダメージ置き場にある場合、あなたはこのカードを、ファストカードのタイミングで、手札にあるカードと同様に使用宣言可能。(?:この効果で使用宣言した場合、あなたのデッキのカードを上から(\d+)枚捨て札する。?)?", x)
            if pm: c["playFromDamage"] = {"mill": int(pm.group(1) or 0)}; continue
            keep.append(x)
        play_lines[:] = keep
        keep = []
        for x in play_lines:   # card properties written as a line of the card text
            if re.fullmatch(r"≪このカード(?:≫のコスト|のコスト≫)は、?あなたのダメージ置き場のカード(?:の)?枚数分減少する。?", x): c["costLess"] = {"damage": "you"}; continue
            # ---- Revise#354 ----
            nm4 = re.fullmatch(r"“([^”]+)”が場にいる場合、このカードのコストは(\d+)減少する。?", x)   # A4-EX02 EX877
            if nm4: c["costLessIf"] = {"cond": {"fieldName": re.sub(r"\s+", "", nm4.group(1))}, "n": int(nm4.group(2))}; keep.append(x); continue
            fx4 = re.fullmatch(r"このカードの必要ファクターは、あなたの支配エリアの(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)のキャラクターの数分減少する。?", x)   # A4-EX01 EX0756 (Revise#363)
            if fx4: c["factorLessX"] = {"countChars": {"owner": "you", "area": "controlled", "faction": FACTION_JP.get(fx4.group(1)) or FACTION_JP[fx4.group(1).replace("ー", "-")]}}; continue
            sd4 = re.fullmatch(r"このカードと同じ名称のカードが使用宣言されている場合、このカードのコストは(\d+)減少し、使用宣言時にあなたは(\d+)ドローする。?", x)   # A4-04 0743 (Revise#360)
            if sd4: c["costLessIf"] = {"cond": {"sameJpDeclared": True}, "n": int(sd4.group(1))}; c["declDrawIf"] = {"cond": {"sameJpDeclared": True}, "n": int(sd4.group(2))}; continue
            fp4 = re.fullmatch(r"このカードのコストが(ブレイクしている)?“([^”]+)”からのみ支払われる場合、あなたはこのカードを、ファストカードのタイミングで使用宣言可能。?", x)   # A3-EX03 EX0299
            if fp4: c["fastPayOnlySel"] = dict({"name": re.sub(r"\s+", "", fp4.group(2))}, **({"broken": True} if fp4.group(1) else {})); continue
            dm4 = re.fullmatch(r"(E\.G\.O\.|阿羅耶識|WIZ[-ー]DOM|ダークロア|極星帝国|イレイザー)(?:分類)?のネームを持つブレイクカードがセットされた場合、あなたのダメージ置き場にあるこのカードを手札に戻す。?", x)   # A4-05 0994
            if dm4: abilities.append({"kind": "trigger", "zones": ["damage"], "when": {"event": "broken", "cardNamed": True, "cardFaction": FACTION_JP[dm4.group(1)]}, "optional": False, "text": x, "effect": {"steps": [{"a": "thisCardFromDamage"}], "status": "auto"}, "status": "auto"}); continue
            if re.fullmatch(r"あなたが先攻でない場合、あなたはこのカードを、?ファストカードのタイミングで使用宣言可能。?", x): c["fastIfCond"] = {"notFirst": True}; continue   # A4-05 0809 (Revise#292)
            nf = re.fullmatch(r"あなたが先攻でない場合、(?:≪このカード≫|このカード)の(必要ファクター|コスト)は(\d+)減少する。?", x)   # A4-05 0886 (Revise#292)
            if nf: c["factorLessIf" if nf.group(1) == "必要ファクター" else "costLessIf"] = {"cond": {"notFirst": True}, "n": int(nf.group(2))}; continue
            if re.fullmatch(r"目標が、あなたのプロジェクトカードまたはファストカードを目標に使用宣言されている場合、あなたはこのカードのコストを無視して使用宣言可能。?", x):   # A3-25 3700 (Revise#408)
                c.setdefault("tCost", []).append({"aimsAtYours": True, "free": True}); continue
            if re.fullmatch(r"このカードをあなたのテリトリー以外のキャラクターを目標に使用宣言した場合、このカードのコストをあなたのダメージ置き場に置く。?", x): continue   # A3-20 2804 (M5a): costToIfNotOwn on its play
            if re.fullmatch(r"このカードの使用宣言時に、分類1つを指定する。?", x) and any("指定した分類を持つキャラクター" in y for y in play_lines): continue   # A3-25 3731 (M5a): named when it resolves
            if re.fullmatch(r"このカードがダメージ判定によってダメージ置き場に置かれた際に、このカードのオーナーがこのカードの必要ファクターを満たしていた場合、ダメージ判定はそこで終了する。その後、≪このカード≫を捨て札する。?", x): c["dmgStop"] = True; continue   # A3-16 2178 (M5a)
            if re.fullmatch(r"このカードがあなたのダメージ置き場に置かれた状態で、あなたがこのカードの必要ファクターを満たしている場合、≪あなたと、あなたの支配キャラクター全て≫に与えられるダメージにー\(1\)して判定する。?", x):   # A3-22 3167 (M5a)
                abilities.append({"kind": "always", "zone": "damage", "text": x, "cond": {"cardFactorMet": True}, "mod": {"to": {"all": {"owner": "you", "area": "controlled"}}, "key": "dmgReduce", "op": "grant", "value": {"mental": 1}}})
                abilities.append({"kind": "always", "zone": "damage", "text": x, "cond": {"cardFactorMet": True}, "mod": {"to": "you", "key": "playerDmgCut", "op": "grant", "value": {"mentalOnly": 1}}}); continue
            if re.fullmatch(r"このカードをあなたの対戦相手のカードを目標に使用宣言した場合、追加でXコストを支払う。Xは目標のコストに等しい。?", x):   # A3-22 3131 (M5a)
                c.setdefault("tCost", []).append({"oppItemCost": True}); continue
            tn = re.fullmatch(r"目標がネームレベルでないか、攻撃力の数値がX以下の場合、≪あなた≫はこのカードのコストを無視して使用宣言可能。?(?:(Xは[^。]+に等しい)。?)?", x)   # A3-25 3660 (Revise#401)
            if tn and x_def((tn.group(1) or card_x or "").rstrip("。")):
                c.setdefault("tCost", []).extend([{"sel": {"named": False}, "free": True}, {"atMaxX": x_def((tn.group(1) or card_x or "").rstrip("。")), "free": True}]); continue
            cd = re.fullmatch(r"このカードがダメージ置き場に置かれた状態で、あなたのデッキが0枚になった際に、あなたがこのカードの必要ファクターを満たしている場合、≪あなたの任意のキャラクタ[ーｰ-]X体≫を捨て札する。その後、このカードを捨て札する。?(?:Xはあなたのダメージ置き場のカード枚数に等しい。?)?", x)   # A3-22 3203 (Revise#401)
            if cd: abilities.append({"kind": "trigger", "zones": ["damage"], "when": {"event": "deckEmpty", "you": True}, "optional": False, "text": x, "effect": {"steps": [{"a": "candleOut"}], "status": "auto"}, "status": "auto"}); continue
            tc = re.fullmatch(r"(ブレイクしている)?[“\"]([^”\"]+)[”\"]を目標にこのカードを使用宣言する場合、≪あなた≫は、このカードのコストを無視して使用宣言可能。?", x)   # A3-EX04 EX0471 (Revise#351): free for that target
            if tc: c.setdefault("tCost", []).append({"sel": dict({"name": re.sub(r"\s+", "", tc.group(2))}, **({"broken": True} if tc.group(1) else {})), "free": True}); continue
            if re.fullmatch(r"このカードをブレイクしていない支配キャラクターを目標に使用宣言する場合、このカードの必要ファクターとコストは2ずつ減少する。?", x):   # A4-02 0284 (M5)
                c["tFactorLess"] = {"sel": {"broken": False, "area": "controlled"}, "n": 2}; c.setdefault("tCost", []).append({"sel": {"broken": False, "area": "controlled"}, "add": -2}); continue
            if re.fullmatch(r"支配キャラクターの総数が、あなたよりも多いプレイヤーの支配キャラクターを目標にこのカードを使用宣言する場合、このカードの必要ファクターは2減少する。?", x):   # A4-05 0814 (M5)
                c["tFactorLess"] = {"sel": {"area": "controlled", "ownerMoreCtl": True}, "n": 2}; continue
            pn = re.fullmatch(r"あなたの支配エリアにパートナーがいるか、あなたが先攻でない場合、このカードのコストは(\d+)減少する。?", x)   # A4-05 0850 (no Partner in the Game Table: "not first" only)
            if pn: c["costLessIf"] = {"cond": {"any": [{"notFirst": True}, {"count": {"sel": {"owner": "you", "area": "controlled", "named": True}, "op": ">=", "n": 1}}]}, "n": int(pn.group(1))}; continue   # Partner = your Name-level character (Pack)
            ft0 = re.fullmatch(r"≪あなた≫は、このカードをファストカードのタイミングで[“\"]([^”\"]+)[”\"]を目標に使用宣言可能。?", x)   # A3-EX02 EX0131 (M5)
            if ft0: c["fastIfTName"] = re.sub(r"\s+", "", ft0.group(1)); continue
            ft = re.fullmatch(r"目標が[“\"]([^”\"]+)[”\"]の場合、あなたはこのカードを、?ファストカードのタイミングで使用宣言可能。?", x)   # A4-03 0510 / 0586 (Revise#350): at fast timing only that character can be the target
            if ft: c["fastIfTName"] = re.sub(r"\s+", "", ft.group(1)); continue
            fx = re.fullmatch(r"追加の(\d+)コストを?支払うことで、あなたはこのカードを、ファストカードのタイミングで使用宣言可能。?", x)   # を missing: A4-05 0846 (Revise#348)   # A4-01 0053 … (Revise#265)
            if fx: c["fastExtra"] = int(fx.group(1)); continue
            fm = re.fullmatch(r"(?:≪このカード≫|このカード)の必要ファクターとコストは、?あなたの支配エリアの(.*?)異なる勢力の(.*?)キャラクターの数だけ減少する。?", x)   # EP311 / PR263 (Revise#209)
            if fm and parse_selector(fm.group(1) + fm.group(2)) is not None:
                xv = {"factionsSel": parse_selector(fm.group(1) + fm.group(2))}; c["costLess"] = xv; c["factorLessX"] = xv; continue
            if re.fullmatch(r"≪このカード≫のコストはX減少する。Xはあなたの支配エリアの勢力・イレイザーのイレイザー・イレイザー♂のネームレベルキャラクターの合計に等しい。?", x):   # A3-22 3311 (Revise#220)
                c["costLess"] = {"countChars": {"owner": "you", "area": "controlled", "faction": "Eraser", "icons": ["イレイザー", "イレイザー♂"], "named": True}}; continue
            cm = re.fullmatch(r"≪このカード≫のコストはX減少する。Xはあなたの支配エリアの(.+?)の(?:合計|数)に等しい。?", x)   # A3-20 2691 (Revise#165)
            if cm and class_tokens(cm.group(1).replace("または", "・")) and len(class_tokens(cm.group(1).replace("または", "・"))) == len(cm.group(1).split("または")):
                c["costLess"] = {"countChars": {"owner": "you", "area": "controlled", "icons": class_tokens(cm.group(1).replace("または", "・"))}}; continue
            fm = re.fullmatch(r"≪このカード≫は、?(超|W|ダ|極|イ|阿|E)(\d+)のファストカードとして使用宣言可能。?", x)   # A3-20 2764 … (Revise#164)
            if fm: c["asFast"] = {"factor": {{"超": "E.G.O.", "E": "E.G.O.", "阿": "Arayashiki", "W": "WIZ-DOM", "ダ": "Darklore", "極": "Polestar Empire", "イ": "Eraser"}[fm.group(1)]: int(fm.group(2))}}; continue
            keep.append(x)
        play_lines[:] = keep
        for x in list(play_lines):   # EX0197 (Revise#201): "あなたがこのカードの必要ファクターを満たした状態で、このカードがダメージ判定によってあなたのダメージ置き場に置かれた場合、…" = the same rule as below
            nm = re.fullmatch(r"あなたがこのカードの必要ファクターを満たした状態で、このカードが(ダメージ判定によって)?あなたのダメージ置き場に置かれた場合、(.+)", N(x))
            if nm: play_lines[play_lines.index(x)] = "このカードが" + (nm.group(1) or "") + "ダメージ置き場に置かれた際に、このカードのオーナーがこのカードの必要ファクターを満たしていた場合、" + nm.group(2)
        for x in list(play_lines):   # A3-EX05 EX0622 / EX0634 (Revise#350): hit by a damage check with its Factor met → it is declared at once, for free
            if re.fullmatch(r"あなたがこのカードの必要ファクターを満たした状態で、このカードがダメージ判定によってダメージ置き場に置かれた場合、コストを無視して≪このカード≫を使用宣言する。?", N(x)):
                abilities.append({"kind": "trigger", "zone": "damage", "when": {"event": "selfToDamage", "byCheck": True}, "cond": {"cardFactorMet": True}, "optional": False, "text": x, "effect": {"steps": [{"a": "selfDeclFree"}], "status": "auto"}, "status": "auto"}); play_lines.remove(x)
        for x in list(play_lines):   # A4-EP EP449 (Revise#339): "…置かれた際、あなたがこのカードの必要ファクターを満たしている場合、…" = the same rule
            nm = re.fullmatch(r"このカードが(ダメージ判定によって)?(?:あなたの)?ダメージ置き場に置かれた際に?、あなたがこのカードの必要ファクターを満たしてい(?:る|た)場合、(.+)", N(x))
            if nm: play_lines[play_lines.index(x)] = "このカードが" + (nm.group(1) or "") + "ダメージ置き場に置かれた際に、このカードのオーナーがこのカードの必要ファクターを満たしていた場合、" + nm.group(2)
        for x in list(play_lines):   # "このカードが(ダメージ判定によって)ダメージ置き場に置かれた際に、…" on a Project / Fast card (Revise#164)
            if re.match(r"このカードが(?:ダメージ判定によって)?ダメージ置き場に置かれた際に?、このカードのオーナーがこのカードの必要ファクターを満たしていた場合", N(x).replace("キャラクタ-", "キャラクター").replace("プレイヤ-", "プレイヤー")):
                a = parse_ability(N(x).replace("キャラクタ-", "キャラクター").replace("プレイヤ-", "プレイヤー"), c)
                if a: abilities.extend(a); play_lines.remove(x)
        for x in list(play_lines):   # A3-EX02 EX0165 (Revise#210): milled from your deck → back to your hand
            if re.fullmatch(r"このカードが(?:あなたの)?デッキから捨て札された場合、?(?:≪このカード≫|このカード)を(?:あなたの|オーナーの)?手札に戻す。?", x):
                abilities.append({"kind": "trigger", "zones": ["discard"], "when": {"event": "selfToDamage", "zone": "discard", "fromZone": "deck"}, "optional": False, "text": x, "effect": {"steps": [{"a": "selfCardToHandAny"}], "status": "auto"}, "status": "auto"}); play_lines.remove(x)
        for x in list(play_lines):   # A3-07 1066 (Revise#256): drawn / to the Damage Pile by a damage check / discarded in the Discard Phase
            nx = N(x).replace("プレイヤ-", "プレイヤー")
            if re.fullmatch(r"あなたがこのカードをドローした場合、このカードを全てのプレイヤーに見せてから手札に戻す。その後、≪あなたのダメージ置き場のあなたの任意のカード1枚≫を手札に戻す。?", nx):
                abilities.append({"kind": "trigger", "zones": ["hand"], "when": {"event": "selfToDamage", "zone": "hand", "fromZone": "deck"}, "optional": False, "text": x, "effect": {"steps": [{"a": "pickZone", "zones": ["damage"], "owner": "you", "sel": {}, "n": 1, "dest": "hand"}], "status": "auto"}, "status": "auto"}); play_lines.remove(x)
            elif re.fullmatch(r"このカードがダメージ判定でダメージ置き場に置かれた場合、≪あなたのデッキの一番上のカード1枚≫を捨て札する。?", nx):
                abilities.append({"kind": "trigger", "zones": ["damage"], "when": {"event": "selfToDamage", "byCheck": True}, "optional": False, "text": x, "effect": {"steps": [{"a": "mill", "to": "you", "n": 1}], "status": "auto"}, "status": "auto"}); play_lines.remove(x)
            elif re.fullmatch(r"このカードをディスカードフェイズに捨て札した場合、ターン終了時に、≪あなた≫は1ドローする。?", nx):
                abilities.append({"kind": "trigger", "zones": ["discard"], "when": {"event": "selfToDamage", "zone": "discard", "fromZone": "hand", "phase": "discard"}, "optional": False, "text": x, "effect": {"steps": [{"a": "delayed", "at": "turn", "step": {"a": "draw", "to": "you", "n": 1}}], "status": "auto"}, "status": "auto"}); play_lines.remove(x)
        for x in list(play_lines):
            zm = re.fullmatch(r"このカードが(?:あなたの)?ダメージ置き場に(?:ある|置かれている)場合、(.+)", x)   # "置かれている" too (EXPR024, Revise#192)
            if zm:
                a = parse_ability(zm.group(1), c)
                if a:
                    for ab in a: ab["zone"] = "damage"; ab["text"] = x
                    abilities.extend(a); play_lines.remove(x)
        body = "".join(x for x in play_lines if not re.search(r"(ダメージ置き場|捨て札置き場)に(?:ある|置かれている)場合", x))
        nb = N(body).replace("キャラクタ-", "キャラクター").replace("プレイヤ-", "プレイヤー")
        if re.fullmatch(r"このカードの使用宣言時に、プレイヤー1人と、そのプレイヤーの、ネームを持つ支配キャラクター1人を指定する。目標の≪プレイヤー1人≫は、指定されたネームを持つ支配キャラクター1人を捨て札する。", nb):
            # designating (not targeting) a named Controlled Character of a player: that player discards it
            c["play"] = {"target": {"kind": "char", "sel": {"named": True, "area": "controlled"}, "count": 1, "designate": True}, "steps": [{"a": "discard", "to": "t"}], "status": "auto"}
        else:
            c["play"] = parse_body(body) if body else {"steps": [], "status": "auto"}
        mt = re.match(r"(?:このカードの使用宣言時に、分類1つを指定する。?\s*)?以下の効果から1つを選択して使用宣言する。?", N(text).strip())   # the leading line: A3-25 3731 (M5a)
        if mt:   # a card with modes: one effect is chosen when it is declared (Revise#164)
            modes = modes_of(N(text).strip()[mt.end():])
            if len(modes) >= 2:
                plays = []
                for mtxt in modes:
                    p = parse_body(mtxt.replace("\n", ""))
                    p["text"] = mtxt.replace("\n", "")
                    plays.append(p)
                st = "auto" if all(p.get("status") == "auto" for p in plays) else "manual" if all(p.get("status") == "manual" for p in plays) else "partial"
                c["play"] = {"modes": plays, "steps": [], "status": st}
    if typ in ("Break", "Permanent", "Project") and re.search(r"ファストカードのタイミングで使用", text) and not re.search(r"(ダメージ置き場|捨て札置き場)にある場合", text):
        c["fastTiming"] = True
    xs_ = [ab["effect"]["x"] for ab in abilities if isinstance(ab.get("effect"), dict) and ab["effect"].get("x")]   # Pack (Revise#246): one "Xは…" line is for every ability of the card that uses X (A3-24 3574)
    if xs_ and all(x == xs_[0] for x in xs_):
        for ab in abilities:
            ef = ab.get("effect")
            if isinstance(ef, dict) and not ef.get("x") and '"X"' in json.dumps(ef.get("steps", [])): ef["x"] = xs_[0]
    for ab in abilities:   # card-level fields from an ability ("rule" kind: EP243 freeIf, EP252 effHandPay — Revise#157)
        if isinstance(ab, dict) and "card" in ab: c.update(ab.pop("card"))
    if abilities: c["abilities"] = abilities
    mental_at_pass(c, text)   # "+(N)" Attack modifiers are mental Attack (Revise#191)
    dual_at_pass(c, text)   # "-X・ー(X)": normal and mental Attack (Revise#297)
    share_x_pass(c)   # one "Xは…" line for several effects (Revise#297)
    for x in list(play_lines):   # A4-EX02 EX867 (Revise#358): "このカードのエフェクトは、あなたが…していなければ使用できない" = a condition of every effect of the card
        em = re.fullmatch(r"このカードのエフェクトは、(あなたが.+?)していなければ使用できない。?", x)
        if em and effects and cond_of(em.group(1) + "している場合"):
            for e_ in effects: e_["declCond"] = cond_of(em.group(1) + "している場合")
            play_lines.remove(x)
    # what is still left for C1–C4: lines that are neither effects, skills, keep / always abilities nor flavour
    rest = [x for x in play_lines if typ not in ("Fast", "Project") and not SKILL_ONLY.fullmatch(x) and not re.fullmatch(r"『[^』]*』", x)
            and x.rstrip("。") not in ("≪プレイヤー全て≫は捨て札置き場の内容を確認可能",)]   # flavour in 『…』; the Discard Pile is open anyway (Revise#144)
    parts_ab = [a.get("status", "auto") for a in abilities]
    if rest: c["manualText"] = rest
    parts = [e["status"] for e in effects] + ([c["play"]["status"]] if "play" in c else []) + parts_ab
    if rest or (br and "manual" in br): parts.append("manual")
    c["status"] = "auto" if all(p == "auto" for p in parts) else "manual" if parts and all(p == "manual" for p in parts) else "partial"
    return c


def report(compiled):
    """Coverage report (Revise#049: shown on the site, not as Excel): counts per card type and status."""
    by = {}
    for c in compiled.values():
        t = by.setdefault(c["type"], {"auto": 0, "partial": 0, "manual": 0})
        t[c["status"]] += 1
    eff = Counter(e["status"] for c in compiled.values() for e in c.get("effects", []))
    play = Counter(c["play"]["status"] for c in compiled.values() if "play" in c)
    return {"cards": by, "effectLines": dict(eff), "fastProject": dict(play),
            "abilities": sum(len(c.get("abilities", [])) for c in compiled.values()),
            "linesByHand": sum(len(c.get("manualText", [])) for c in compiled.values())}


if __name__ == "__main__":
    sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))
    import build
    raw = build.raw_rows(build.DATA_DIR / "cardlist.xlsx")
    compiled = {k: compile_card(r) for k, r in raw.items()}
    print(json.dumps(report(compiled), ensure_ascii=False, indent=1))
