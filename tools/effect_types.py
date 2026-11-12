#!/usr/bin/env python3
"""Effect System report: every effect in the card list, grouped by effect type.

Uses the same rules as the site (src/data/effect_types.json): each effect is split into sentences and
each sentence gets the first rule whose regex matches.

    python3 tools/effect_types.py data/cardlist.xlsx dist/effect_types_report.xlsx

Sheets: Summary (one row per type: group, action, automated?, sentences, effects, cards, examples),
        Effects (one row per card effect: card, cost, text, main type, every step's type),
        Groups (one row per group).
"""
import json, re, sys, collections, importlib.util
from pathlib import Path
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment

ROOT = Path(__file__).resolve().parents[1]
RULES = json.loads((ROOT / "src/data/effect_types.json").read_text(encoding="utf-8"))
for r in RULES["rules"]: r["rx"] = re.compile(r["re"])
GROUPS = dict(RULES["groups"])
TYPE = {r["id"]: r for r in RULES["rules"]}
MANUAL = {"manual"}
spec = importlib.util.spec_from_file_location("efx", ROOT / "tools/effects_xlsx.py")
efx = importlib.util.module_from_spec(spec); spec.loader.exec_module(efx)   # same effect-line reader as the effects sheet


def sentences(t): return [x.strip() for x in re.split(r"(?<=。)", t) if x.strip()]
def classify(t):
    steps = [next(r for r in RULES["rules"] if r["rx"].search(s))["id"] for s in sentences(t)]
    main = next((s for s in steps if s not in ("xdef", "timing", "declare")), steps[0] if steps else "other")
    return main, steps


def main(src, dst):
    ws = openpyxl.load_workbook(src, read_only=True)["Cards"]
    rows = ws.iter_rows(values_only=True); head = next(rows); ix = {k: i for i, k in enumerate(head)}
    eff_rows, by_type = [], collections.defaultdict(lambda: {"sent": 0, "eff": set(), "cards": set(), "ex": []})
    for r in rows:
        jp, en = str(r[ix["カードテキスト"]] or ""), str(r[ix["Card Text (English)"]] or "")
        effs = [m for m in (efx.LINE.match(l) for l in jp.split("\n")) if m]
        ens = [m for m in (efx.LINE.match(l) for l in en.split("\n")) if m]
        card = (r[ix["Series"]] or "", str(r[ix["カード№"]] or ""), r[ix["カード名称"]] or "", r[ix["カード種類"]] or "")
        for n, m in enumerate(effs, 1):
            text = m.group(2).strip(); mt, steps = classify(text)
            auto = all(TYPE[s]["action"] not in MANUAL for s in steps)
            eff_rows.append([*card, n, m.group(1).translate(efx.HALF), text, ens[n - 1].group(2).strip() if n - 1 < len(ens) else "",
                             TYPE[mt]["label"], GROUPS[TYPE[mt]["group"]], "yes" if auto else "partly by hand", " → ".join(TYPE[s]["label"] for s in steps)])
            for s, st in zip(sentences(text), steps):
                d = by_type[st]; d["sent"] += 1; d["eff"].add((card, n)); d["cards"].add(card)
                if len(d["ex"]) < 3 and s not in d["ex"]: d["ex"].append(s)
    wb = openpyxl.Workbook(); bold = Font(bold=True, color="FFFFFF"); fill = PatternFill("solid", fgColor="1F2A6B")
    def sheet(ws, header, data, widths):
        ws.append(header)
        for c in ws[1]: c.font, c.fill = bold, fill
        for d in data: ws.append(d)
        for i, w in enumerate(widths): ws.column_dimensions[openpyxl.utils.get_column_letter(i + 1)].width = w
        ws.freeze_panes = "A2"; ws.auto_filter.ref = ws.dimensions
        for row in ws.iter_rows(min_row=2):
            for c in row: c.alignment = Alignment(wrap_text=True, vertical="top")
    order = [r["id"] for r in RULES["rules"]]
    summary = [[GROUPS[TYPE[t]["group"]], t, TYPE[t]["label"], TYPE[t]["action"], "manual (reminder in the log)" if TYPE[t]["action"] in MANUAL else "automated",
                by_type[t]["sent"], len(by_type[t]["eff"]), len(by_type[t]["cards"]), "\n".join(by_type[t]["ex"]), TYPE[t]["re"]]
               for t in sorted(by_type, key=lambda t: (list(GROUPS).index(TYPE[t]["group"]), -by_type[t]["sent"], order.index(t)))]
    sheet(wb.active, ["Group", "Type id", "Effect type", "Action", "At the table", "Sentences", "Effects", "Cards", "Examples", "Rule (regex)"], summary,
          [20, 18, 34, 13, 26, 10, 9, 8, 80, 40])
    wb.active.title = "Summary"
    sheet(wb.create_sheet("Effects"), ["Series", "Card No.", "Card name", "Type", "Effect #", "Cost", "Effect text (JP)", "Effect text (EN)",
          "Main effect type", "Group", "Automated", "Steps (one per sentence)"], eff_rows, [34, 9, 26, 10, 8, 6, 60, 60, 30, 18, 14, 60])
    g = collections.Counter(); ge = collections.Counter()
    for row in eff_rows: g[row[9]] += 1; ge[row[9]] += row[10] == "yes"
    sheet(wb.create_sheet("Groups"), ["Group", "Effects (main type)", "Fully automated"], [[k, v, ge[k]] for k, v in g.most_common()], [26, 18, 16])
    wb.save(dst)
    auto = sum(1 for r in eff_rows if r[10] == "yes"); other = sum(1 for r in eff_rows if r[8] == TYPE["other"]["label"])
    print(f"{len(eff_rows)} effects · {len(by_type)} types used · fully automated {auto} · main type 'Other' {other}")


if __name__ == "__main__":
    main(*(sys.argv[1:3] if len(sys.argv) > 2 else (ROOT / "data/cardlist.xlsx", ROOT / "dist/effect_types_report.xlsx")))
