"""Re-read skills from the Japanese card text and fill the Skills / Skill: X columns where they are missing.

Root cause: the Skills columns were filled only when the skill words stood on a line of their own
("▼ チャージ1"). When the same line went on with an effect ("▼ チャージ1 1：…") or other text,
the line was skipped, so those cards had no skills.

Skills are the leading words of the card text (after ▼), separated by spaces:
    ▼ レジスト極星帝国 チャージ1 1：≪このエフェクトのコスト≫を…
    → Aggressive ▼, Resist Polestar Empire, Charge +1   (then the effect starts at "1：")

    python3 tools/skills_fix.py data/cardlist.xlsx dist/cardlist_fixed.xlsx [report.xlsx]
"""
import re, sys, collections
import openpyxl
from openpyxl.styles import Font, PatternFill

FAC = {"E.G.O.": "E.G.O.", "阿羅耶識": "Arayashiki", "WIZ-DOM": "WIZ-DOM", "WIZーDOM": "WIZ-DOM", "ダークロア": "Darklore", "極星帝国": "Polestar Empire", "イレイザー": "Eraser"}
NUM = r"([+\-－＋−]?)([0-9０-９]+|[XＸ]|∞)"
VALUED = [("チャージ", "Charge"), ("ドロー", "Draw"), ("バインド", "Bind"), ("パーマネント", "Permanent"), ("キャパシティ", "Capacity"),
          ("ブースト", "Boost"), ("リムーブ", "Remove")]
PLAIN = [("シールド", "Shield"), ("インターセプト", "Intercept"), ("イニシアチブ", "Initiative"), ("ブレイクスルー", "Breakthrough"),
         ("オフェンシブ", "Offensive"), ("ディフェンシブ", "Defensive"), ("シンクロ", "Synchro"), ("ペネトレイト", "Penetrate"),
         ("デュアル", "Dual"), ("ステルス", "Stealth"), ("インフィニティ", "Infinity"), ("インヘレント", "Inherent")]
WITH_ARG = [("レジスト", "Resist"), ("プロテクト", "Protect"), ("サーチ", "Search")]
ICONS = {"スチューデント": "Student", "ワーカー": "Worker", "アスリート": "Athlete", "スカラー": "Scholar", "タレント": "Talent",
         "ミスティック": "Mystic", "サイキッカー": "Psychic", "霊能者": "Psychic", "スキャナー": "Scanner", "ドラグーン": "Dragoon",
         "クリーチャー": "Creature", "ヴァンパイア": "Vampire", "ワーウルフ": "Werewolf", "ワータイガー": "Weretiger", "モンスター": "Monster",
         "サイボーグ": "Cyborg", "ウォリアー": "Warrior", "ゴースト": "Ghost", "マーメイド": "Mermaid",
         "アンドロイド": "Android", "マシン": "Machine", "アンデッド": "Undead", "トライ": "Three-Eyed", "悪魔": "Demon", "鬼": "Oni"}   # same words the sheet already uses in Resist / Protect
HALF = str.maketrans("０１２３４５６７８９ＸＮ＋－−", "0123456789XN+--")


def skill_token(w):
    """One word → (English skill, value) or None."""
    for jp, en in VALUED:
        m = re.fullmatch(jp + NUM, w)
        if m:
            sign = "-" if m.group(1) in "-－−" and m.group(1) else "+"
            v = m.group(2).translate(HALF)
            return f"{en} {sign + v}", (v if v in ("X", "∞") else int(sign + v) if sign == "-" else int(v))
    for jp, en in PLAIN:
        if w == jp: return en, None
    for jp, en in WITH_ARG:
        if w.startswith(jp) and len(w) > len(jp):
            arg = w[len(jp):].strip("「」・")
            for j, e in FAC.items(): arg = arg.replace(j, e)
            for j, e in ICONS.items(): arg = arg.replace(j, e)
            return f"{en} {arg.replace('・', '/')}", None
    return None


def read_skills(text):
    """Leading skill words of the card text: [(English, value)], aggressive flag."""
    t = str(text or "").strip()
    out, aggressive = [], t.startswith("▼")
    words = re.findall(r"(?:[^\s　(（]|[(（][^)）]*[)）])+", t.lstrip("▼").strip())   # spaces inside ( ) stay in the word
    for w in words:
        s = skill_token(w)
        if not s: break
        out.append(s)
    return out, aggressive


def main(src, dst, report=None):
    wb = openpyxl.load_workbook(src)
    ws = wb.worksheets[0]
    head = [c.value for c in ws[1]]
    col = {h: i + 1 for i, h in enumerate(head)}
    vcol = {en: col.get(f"Skill: {en}") for _, en in VALUED}
    fixed, same, differ, rows_out = 0, 0, 0, []
    fill = PatternFill("solid", fgColor="E2EFDA")
    for r in range(2, ws.max_row + 1):
        text = ws.cell(r, col["カードテキスト"]).value
        sk, _ = read_skills(text)
        if not sk: continue
        names = "; ".join(n for n, _ in sk)
        have = ws.cell(r, col["Skills"]).value
        if have:
            if str(have).replace(" ", "") == names.replace(" ", ""): same += 1
            else: differ += 1; rows_out.append(("different (kept)", r, ws.cell(r, col["カード№"]).value, ws.cell(r, col["カード名称"]).value, have, names, str(text)[:80]))
            continue
        ws.cell(r, col["Skills"], names).fill = fill
        for n, v in sk:
            base = n.split(" ")[0]
            if vcol.get(base) and v is not None:
                ws.cell(r, vcol[base], v).fill = fill
        fixed += 1
        rows_out.append(("filled", r, ws.cell(r, col["カード№"]).value, ws.cell(r, col["カード名称"]).value, "", names, str(text)[:80]))
    wb.save(dst)
    print(f"filled {fixed} rows · already right {same} · different (left as is) {differ}")
    if report:
        rb = openpyxl.Workbook(); s = rb.active; s.title = "Skill fixes"
        s.append(["Result", "Row", "Card no.", "Card name", "Skills before", "Skills from card text", "Card text (start)"])
        for c in s[1]: c.font = Font(bold=True)
        for x in rows_out: s.append(list(x))
        s.column_dimensions["F"].width = 40; s.column_dimensions["G"].width = 60
        rb.save(report)
    return fixed, same, differ


if __name__ == "__main__":
    main(*sys.argv[1:4])
