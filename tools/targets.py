"""Targeting system: read every ≪target≫ in the card text and split it into parts.

A target = WHAT (character / player / card / cost / pile) × HOW MANY × WHOSE × WHERE × CONDITIONS.
The same rules are used in the site (parseTarget in src/js/06c-target.js).

    python3 tools/targets.py data/cardlist.xlsx dist/targets_catalog.xlsx
"""
import re, sys, collections
import openpyxl
from openpyxl.styles import Font, PatternFill

ICONS = {"スチューデント": "Student", "ワーカー": "Worker", "アスリート": "Athlete", "スカラー": "Scholar", "タレント": "Talent",
         "ミスティック": "Mystic", "サイキッカー": "Psychic", "霊能者": "Psychic", "スキャナー": "Scanner", "ドラグーン": "Dragoon",
         "クリーチャー": "Creature", "ヴァンパイア": "Vampire", "ワーウルフ": "Werewolf", "ワータイガー": "Weretiger", "モンスター": "Monster",
         "鬼": "Ogre", "悪魔": "Devil", "トライ": "Three-Eyed", "サイボーグ": "Cyborg", "ウォリアー": "Warrior", "イレイザー": "Eraser",
         "ゴースト": "Ghost", "マーメイド": "Mermaid", "アンドロイド": "Android", "マシン": "Machine", "アンデッド": "Undead"}
FACTIONS = {"E.G.O.": "E.G.O.", "阿羅耶識": "Arayashiki", "WIZ-DOM": "WIZ-DOM", "WIZーDOM": "WIZ-DOM", "ダークロア": "Darklore", "極星帝国": "Polestar Empire", "イレイザーの": "Eraser"}

# ---- parts (first match wins inside each list) ----
WHAT = [  # (key, label, pattern)
    ("cost", "Cost (paid cards)", r"コスト≫?$|のコスト$"),
    ("power", "Power card", r"パワーカード"),
    ("deck", "Deck / deck card", r"デッキ"),
    ("discardpile", "Discard pile card", r"捨て札置き場"),
    ("damagepile", "Damage pile card", r"ダメージ置き場"),
    ("hand", "Hand card", r"手札"),
    ("party", "Faction party", r"勢力パーティ|勢力1つ|の勢力の"),
    ("area", "Area", r"エリア1つ|エリアの(?!キャラ)"),
    ("project", "Project card", r"プロジェクトカード"),
    ("fast", "Fast card", r"ファストカード"),
    ("permanent", "Permanent card", r"パーマネント"),
    ("break", "Break card", r"ブレイクカード"),
    ("player_or_char", "Player or character", r"プレイヤーまたはキャラクタ|キャラクターまたはプレイヤ"),
    ("player", "Player", r"プレイヤ|あなた$|^あなた(と|、)|オーナー|対戦相手(全て|1人)?$|対戦相手$"),
    ("thiscard", "This card", r"^このカード$"),
    ("player_or_char", "Player or character", r"アタック目標"),
    ("character", "Character", r"キャラクタ|人$|体$|全て$|[1-9X]人|バトル相手|“|”|分類|" + "|".join(ICONS)),
    ("card", "Card (any)", r"カード"),
]
COUNT = [("all", "All", r"全て|全員"), ("upto", "Up to X", r"まで"), ("x", "X", r"[XＸ]体|[XＸ]枚|[XＸ]人"),
         ("one", "One", r"1人|1枚|1体|1つ|1人$"), ("self", "This one", r"^この(キャラクター|カード)$")]
WHOSE = [("notyou", "Not you", r"あなた以外"), ("opp", "Opponent's", r"対戦相手"), ("yours", "Yours", r"あなたの|あなたが"),
         ("choice", "Your choice (any)", r"任意")]
WHERE = [("territory", "Territory", r"テリトリー"), ("control", "Control area (dominated)", r"支配"),
         ("active", "Active area / active character", r"勢力エリア|アクティブ"), ("field", "Field", r"場の|場に"),
         ("pfzone", "Project / Fast zone", r"プロジェクト・ファスト")]
COND = [("self", "This character / card", r"^この(キャラクター|カード)"),
        ("battle", "In battle / attacking / guarding", r"アタック|ガード|バトル"),
        ("broken", "Broken", r"ブレイクしている"), ("unbroken", "Not broken", r"ブレイクしていない"),
        ("aggressive", "Has ▼", r"▼"), ("power", "Power (power cards)", r"パワ[ー-]\s*[0-9X]"),
        ("mental", "Mental power", r"精神力"), ("attack", "Attack", r"攻撃力"), ("defense", "Defense", r"耐久力"),
        ("cost", "Cost / factor", r"コストが|必要ファクター|ファクター"), ("name", "Name (“ ”)", r"ネーム|“"),
        ("icon", "Class icon", "|".join(ICONS)), ("faction", "Faction", "|".join(map(re.escape, FACTIONS))),
        ("discarded", "Discarded / defeated", r"捨て札され|捨て札にな"), ("damaged", "Damaged", r"ダメージを受け"),
        ("chosen", "Chosen / named", r"指定|選んだ"), ("same", "Same as / those", r"同じ|それら|その")]


def classify(t):
    pick = lambda table: next((k for k, _, p in table if re.search(p, t)), "")
    if t.isascii(): return {"what": "other", "count": "", "whose": "", "where": "", "cond": [], "icons": [], "factions": []}
    return {"what": pick(WHAT) or "other", "count": pick(COUNT) or "",
            "whose": pick(WHOSE) or "", "where": pick(WHERE) or "",
            "cond": [k for k, _, p in COND if re.search(p, t)],
            "icons": [ICONS[j] for j in ICONS if j in t], "factions": sorted({FACTIONS[j] for j in FACTIONS if j in t})}


def main(src, dst):
    ws = openpyxl.load_workbook(src, read_only=True).worksheets[0]
    rows = ws.iter_rows(values_only=True); head = next(rows); H = {h: i for i, h in enumerate(head)}
    count, example, cards = collections.Counter(), {}, set()
    for r in rows:
        for t in re.findall(r"≪([^≫]+)≫", str(r[H["カードテキスト"]] or "")):
            t = t.strip(); count[t] += 1; cards.add(r[H["カード名称"]])
            example.setdefault(t, f'{r[H["エクスパンションコード"]]} {r[H["カード№"]]} {r[H["カード名称"]]}')
    total = sum(count.values())
    dims = {k: collections.Counter() for k in ("what", "count", "whose", "where", "cond")}
    out = []
    for t, n in count.most_common():
        c = classify(t)
        for k in ("what", "count", "whose", "where"): dims[k][c[k] or "—"] += n
        for k in c["cond"]: dims["cond"][k] += n
        out.append((t, n, c, example[t]))
    lab = {**{k: l for k, l, _ in WHAT}, "other": "Other"}
    labels = {"what": lab, "count": {k: l for k, l, _ in COUNT}, "whose": {k: l for k, l, _ in WHOSE},
              "where": {k: l for k, l, _ in WHERE}, "cond": {k: l for k, l, _ in COND}}
    wb = openpyxl.Workbook(); bold = Font(bold=True); fill = PatternFill("solid", fgColor="FFF2CC")
    s = wb.active; s.title = "Summary"
    s.append([f"{total} targets in {len(cards)} card names · {len(count)} different wordings"])
    for k, title in (("what", "What is targeted"), ("count", "How many"), ("whose", "Whose"), ("where", "Where"), ("cond", "Conditions")):
        s.append([]); s.append([title, "Targets", "%"]); [setattr(c, "font", bold) for c in s[s.max_row]]
        for v, n in dims[k].most_common(): s.append([labels[k].get(v, v), n, round(100 * n / total, 1)])
    d = wb.create_sheet("All targets")
    d.append(["Target (JP)", "Count", "What", "How many", "Whose", "Where", "Conditions", "Icons", "Factions", "Example card"])
    for c in d[1]: c.font = bold; c.fill = fill
    for t, n, c, e in out:
        d.append([t, n, labels["what"].get(c["what"], c["what"]), labels["count"].get(c["count"], ""), labels["whose"].get(c["whose"], ""),
                  labels["where"].get(c["where"], ""), ", ".join(labels["cond"][x] for x in c["cond"]), ", ".join(c["icons"]), ", ".join(c["factions"]), e])
    d.column_dimensions["A"].width = 60; d.column_dimensions["J"].width = 40
    wb.save(dst)
    other = sum(n for t, n, c, e in out if c["what"] == "other")
    print(f"{total} targets · {len(count)} wordings · {len(cards)} card names · unclassified {other} ({100*other/total:.1f}%)")
    for k in dims: print(k, [(labels[k].get(v, v), n) for v, n in dims[k].most_common(14)])
    print("unclassified examples:", [t for t, n, c, e in out if c["what"] == "other"][:25])


if __name__ == "__main__":
    main(*sys.argv[1:3])
