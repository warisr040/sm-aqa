"""Add effect columns to the card list: Effect Count, Effect Costs, and Cost / JP / EN for every effect.

Effects are card-text lines that start with a cost ("1：…", "X：…" — circled numbers in print).
Same rule as parseEffects() in src/js/01-core.js.

    python3 tools/effects_xlsx.py data/cardlist.xlsx dist/cardlist_effects.xlsx
"""
import re, sys
import openpyxl
from openpyxl.styles import Font, PatternFill

LINE = re.compile(r"^(?:▼|\s|(?:(?:チャージ|ドロー|バインド|パーマネント|キャパシティ|ブースト|リムーブ)[+\-−＋－]?[0-9０-９XＸ]+|シールド|インターセプト|イニシアチブ|ブレイクスルー|オフェンシブ|ディフェンシブ|シンクロ|ペネトレイト|デュアル|ステルス|インフィニティ|インヘレント|(?:レジスト|プロテクト)\S+|(?:Charge|Draw|Bind|Permanent|Capacity|Boost|Remove) ?[+\-]?[0-9X]+|Shield|Intercept|Initiative|Breakthrough|Offensive|Defensive|Synchro|Penetrate|Dual|Stealth|Infinity|Inherent|(?:Resist|Protect) \S+)(?=\s))*?([0-9０-９XＸ]+)\s*[:：]\s*(.+)$")   # skills may come first: "▼ チャージ1 1：…"
HALF = str.maketrans("０１２３４５６７８９Ｘ", "0123456789X")


def effects(text):
    return [(m.group(1).translate(HALF), m.group(2).strip()) for m in (LINE.match(l) for l in str(text or "").split("\n")) if m]


def main(src, dst):
    wb = openpyxl.load_workbook(src)
    ws = wb.worksheets[0]
    head = [c.value for c in ws[1]]
    jp, en = head.index("カードテキスト") + 1, head.index("Card Text (English)") + 1
    rows = [(r, effects(ws.cell(r, jp).value), effects(ws.cell(r, en).value)) for r in range(2, ws.max_row + 1)]
    most = max(len(j) for _, j, _ in rows)
    col = ws.max_column + 1
    names = ["Effect Count", "Effect Costs"] + [f"Effect {i} {k}" for i in range(1, most + 1) for k in ("Cost", "(JP)", "(EN)")]
    fill = PatternFill("solid", fgColor="FFF2CC")
    for i, n in enumerate(names):
        c = ws.cell(1, col + i, n); c.font = Font(bold=True); c.fill = fill
    counts = {}
    for r, J, E in rows:
        if not J: continue
        counts[len(J)] = counts.get(len(J), 0) + 1
        ws.cell(r, col, len(J))
        ws.cell(r, col + 1, " / ".join(c for c, _ in J))
        for i, (cost, text) in enumerate(J):
            e = E[i][1] if i < len(E) and E[i][0] == cost else ""
            ws.cell(r, col + 2 + i * 3, int(cost) if cost.isdigit() else cost)
            ws.cell(r, col + 3 + i * 3, text)
            ws.cell(r, col + 4 + i * 3, e)
    wb.save(dst)
    print(f"{sum(counts.values())} cards with effects · by count {dict(sorted(counts.items()))} · up to {most} effects · {len(names)} columns added")


if __name__ == "__main__":
    main(*sys.argv[1:3])
