"""Card milestones sheet for docs/requirements_v4.html (Pack, Revise#094): docs/milestones.json (what each milestone covers,
its status) + the compiled rules (how many cards are still by hand) → HTML tables. Run by build.py."""
import html, json, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
TYPES = ["Character", "Break", "Permanent", "Project", "Fast"]
STATUS = {"done": "Done", "next": "Next", "planned": "Planned", "doing": "In progress"}


def series_of(key): return key.rsplit(" ", 1)[0]


def tables(compiled, keys):
    doc = json.loads((ROOT / "docs" / "milestones.json").read_text(encoding="utf-8"))
    by = {}   # (series, type) → [auto, all]
    for k in keys:
        c = compiled.get(k)
        if not c or c["type"] not in TYPES: continue
        x = by.setdefault((series_of(k), c["type"]), [0, 0])
        x[1] += 1
        if c["status"] == "auto": x[0] += 1
    rows = []
    for m in doc["milestones"]:
        auto = sum(by.get((s, t), [0, 0])[0] for s in m["series"] for t in m["types"])
        tot = sum(by.get((s, t), [0, 0])[1] for s in m["series"] for t in m["types"])
        todo = tot - auto
        st = m.get("status", "planned")
        if todo == 0 and tot: st = "done"
        pct = 100 * auto // tot if tot else 100
        rows.append(f'<tr class="ms-{st}"><td><b>{html.escape(m["id"])}</b></td><td>{html.escape(m["title"])}</td><td class="n">{todo}</td><td class="n">{tot}</td>'
                    f'<td><span class="bar"><i style="width:{pct}%"></i></span> {pct}%</td><td><span class="st st-{st}">{STATUS.get(st, st)}</span>{" · " + html.escape(m["released"]) if m.get("released") else ""}</td></tr>')
    ms = ('<div class="mstab"><table><thead><tr><th>Milestone</th><th>Scope</th><th>Cards to do</th><th>Cards in all</th><th>Automatic</th><th>Status</th></tr></thead>'
          f'<tbody>{"".join(rows)}</tbody></table></div>')
    # every series × type: cards still to do / in all (to choose what to order next)
    series = sorted({s for s, _ in by}, key=lambda s: (s[:2], 0 if s[3:5].isdigit() else 1, s))
    cell = lambda s, t: (lambda x: "—" if not x else f'<span class="{"z" if x[1] == x[0] else ""}">{x[1] - x[0]}</span>/{x[1]}')(by.get((s, t)))
    grid = ('<div class="mstab"><table class="grid"><thead><tr><th>Series</th>' + "".join(f"<th>{t}</th>" for t in TYPES) + "</tr></thead><tbody>"
            + "".join(f"<tr><td>{html.escape(s)}</td>" + "".join(f'<td class="n">{cell(s, t)}</td>' for t in TYPES) + "</tr>" for s in series)
            + "</tbody></table></div>")
    return ms, grid
