#!/usr/bin/env python3
"""List the card reports that have no ticket yet (Revise#409):  python3 tools/new_reports.py aa-card-reports-….json
A report is old when its id is the "rid" of a ticket in src/tickets.json."""
import json, sys, pathlib
done = {t.get("rid"): t for t in json.loads((pathlib.Path(__file__).resolve().parent.parent / "src" / "tickets.json").read_text(encoding="utf-8"))}
rows = json.load(open(sys.argv[1], encoding="utf-8"))
new = [r for r in rows if r["id"] not in done]
print(f"{len(rows)} reports, {len(new)} new")
for r in sorted(new, key=lambda r: r["at"]):
    print(f"- {r['card']['key']} {r['card']['jp']} · v{r.get('ver')} · {r.get('page')} · {r['text']!r}")
