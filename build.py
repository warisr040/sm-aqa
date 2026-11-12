#!/usr/bin/env python3
"""Build the Aquarian Age Thailand Fan-site site (formerly Aquarian Age Helper).

    python3 build.py

Reads
  data/cardlist.xlsx              card database (sheet "Cards"; English names, card text and skills included)
  data/old_keys.json              old deck key → current key, so decks saved by earlier versions still import
  src/index.html                  page markup with @PLACEHOLDERS
  src/css/app.css, src/js/*.js    styles and scripts (JS files are joined in name order)
  src/partials/help.html          Deck Builder "How to use" guide
  src/rules_content.py            bilingual rules guide
  assets/banner.jpg, assets/help/ images

Writes
  dist/aquarian-age-helper/       folder to drag onto Netlify (index.html at its root)
  dist/aquarian-age-helper.zip
  docs/requirements_v4.html       readable copy of docs/requirements_v4.md (tools/requirements_html.py)
  dist/…/assets/rules.js          v4 rule database (tools/rules_compile.py; read by the v4 engine, not used by the v3 table)
  dist/…/coverage.html            card rule coverage (which cards / lines the v4 table runs by itself)
  dist/…/table.html               v4 game table (src/table4/ + src/engine/ → assets/table.js, assets/table.css); index.html is not changed
"""
import base64, hashlib, html, json, re, shutil, sys, unicodedata, zipfile
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent
SRC, ASSETS, DATA_DIR = ROOT / "src", ROOT / "assets", ROOT / "data"
OUT = ROOT / "dist" / "aquarian-age-helper"

FACTIONS = ["E.G.O.", "Arayashiki", "WIZ-DOM", "Darklore", "Polestar Empire", "Eraser"]   # display order (Pack)
TYPES = ["Character", "Break", "Fast", "Project", "Permanent", "Area Marker", "Pack cover", "Promo art"]


def nz(v):
    return "" if v is None else unicodedata.normalize("NFKC", str(v)).strip()


def drive_id(url):
    m = re.search(r"/d/([\w-]+)", url or "")
    return m.group(1) if m else None


def series_code(s_en, s_jp):
    if s_jp and s_jp != "#N/A":
        return "A3-SIGN" if s_jp.startswith("A3_7") else s_jp.split("_")[0]
    return (s_en or "—").split(" ")[0]


VALUED_SKILLS = ["Charge", "Draw", "Bind", "Capacity", "Permanent", "Boost", "Remove"]
GROUPED_SKILLS = ("Resist", "Protect", "Search")   # "Resist Darklore" → "Resist"


def skill_value(v):
    """Skill column value → display text: 1 → "+1", -1 → "-1", "X" → "X"."""
    v = nz(v)
    if not v: return ""
    return "+" + v if re.fullmatch(r"\d+", v) else v


def parse_skills(r, get):
    """Skill tokens for filtering (e.g. ["Aggressive ▼", "Shield", "Charge +1"]) and
    the value of each valued skill, in VALUED_SKILLS order."""
    values = [skill_value(get(r, f"Skill: {k}")) for k in VALUED_SKILLS]
    tokens = []
    if nz(get(r, "カードテキスト")).startswith("▼"): tokens.append("Aggressive ▼")
    for t in nz(get(r, "Skills")).split(";"):
        t = t.strip()
        if not t: continue
        base = re.sub(r"\s*[-+]?[\dX∞]+$", "", t).strip()
        if base in VALUED_SKILLS: continue                       # taken from the value columns below
        base = next((g for g in GROUPED_SKILLS if base.startswith(g)), base)
        if base not in tokens: tokens.append(base)
    tokens += [f"{k} {v}" for k, v in zip(VALUED_SKILLS, values) if v]
    return tokens, values


def load_cards(path):
    """Card database → compact JSON-ready dict (see 01-core.js for the decoder)."""
    ws = openpyxl.load_workbook(path, read_only=True).worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    col = {h: i for i, h in enumerate(rows[0])}
    get = lambda r, h: r[col[h]] if h in col else None

    factions, types, notes = list(FACTIONS), list(TYPES), []
    pool = {}  # de-duplicate long strings (card text, class icons, illustrators, …)
    def pooled(s):
        if not s: return -1
        return pool.setdefault(s, len(pool))

    series, series_idx, cards, skipped, keys, raw = [], {}, [], 0, set(), {}
    key_by_drive = {}
    for r in rows[1:]:
        cid, fid = nz(get(r, "カード№")), drive_id(get(r, "Image URL (Google Drive)"))
        if not cid or not fid:
            skipped += 1
            continue
        s_en, s_jp = get(r, "Series"), get(r, "Series Folder")
        if (s_en, s_jp) not in series_idx:
            series_idx[(s_en, s_jp)] = len(series)
            jp_name = s_jp.split("_", 1)[-1].replace("_", " ") if s_jp and s_jp != "#N/A" else " ".join((s_en or "").split(" ")[1:])
            series.append([series_code(s_en, s_jp), s_en or "", jp_name, get(r, "Saga (EN)") or "", get(r, "Page URL") or ""])
        si = series_idx[(s_en, s_jp)]

        fac = nz(get(r, "Faction (EN)")) or nz(get(r, "Classified Faction"))
        typ = nz(get(r, "カード種類")) or nz(get(r, "Classified Card Type"))
        skills, skill_values = parse_skills(r, get)
        note = nz(get(r, "Classification Note"))
        for value, bucket in ((fac, factions), (typ, types), (note, notes)):
            if value and value not in bucket: bucket.append(value)

        stats = [nz(get(r, h)) for h in ("ファクター", "コスト", "精神力", "攻撃力", "耐久力")]
        extra = [pooled(nz(get(r, h))) for h in ("カードテキスト", "分類アイコン", "レアリティ", "イラストレーター",
                                                 "目標／範囲", "瞬間／持続", "Variant", "エラッタ／テキスト修正", "Card Text (English)")]
        key = (series[si][0] + " " + cid).upper()
        if key in keys: key += "#2"
        keys.add(key)
        raw[key] = {h: r[i] for h, i in col.items()}   # whole row, for the rule compiler (tools/rules_compile.py)
        key_by_drive.setdefault(fid, key)
        cards.append([cid, nz(get(r, "カード名称")), nz(get(r, "Card Name (English)")), fid, si,
                      factions.index(fac) if fac else -1, types.index(typ) if typ else -1,
                      notes.index(note) if note else -1, stats, extra, nz(get(r, "よみがな")),
                      pooled(";".join(skills)), skill_values])
    strings = [s for s, _ in sorted(pool.items(), key=lambda kv: kv[1])]
    return {"s": series, "f": factions, "t": types, "n": notes, "p": strings, "c": cards}, key_by_drive, skipped, raw


def raw_rows(path):
    """Card key → whole card-list row (same keys and skipped rows as load_cards)."""
    return load_cards(path)[3]


def load_aliases(path):
    """Old deck keys (from the database before cardlist.xlsx) → current keys. Made once from the old
    cardlist_classified.xlsx by matching Drive images; the old file is no longer needed."""
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def render_changelog(entries):
    """Changelog tab: newest first. Items may hold simple inline HTML (<b>)."""
    months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
    out = []
    for i, e in enumerate(entries):
        y, m, d = e["date"].split("-")
        items = "".join(f"<li>{x}</li>" for x in e["items"])
        out.append(f'<article class="clog{" latest" if i == 0 else ""}"><div class="chd"><span class="cver">v{e["v"]}</span>'
                   f'<time datetime="{e["date"]}">{int(d)} {months[int(m) - 1]} {y}</time>'
                   f'{"<span class=cnew>Latest</span>" if i == 0 else ""}</div><h3>{e["title"]}</h3><ul>{items}</ul></article>')
    return "\n".join(out)


def render_tickets(tickets):
    """Changelog → Bug reports (Pack, Revise#329): one ticket per card report — the report, the breakdown, cause, fix, check, captures."""
    esc = lambda x: html.escape(str(x), quote=True)
    out = []
    for t in tickets:
        done = t.get("status") == "done"
        figs = "".join(f'<figure><figcaption><b>{esc(a)}</b> {esc(c)}</figcaption><img src="tickets/{esc(f)}" alt="{esc(a)}: {esc(c)}" loading="lazy" width="560"></figure>' for a, f, c in t.get("imgs", []))
        steps = "".join(f"<li>{esc(x)}</li>" for x in t.get("steps", []))
        out.append(f'<article class="tk" id="{esc(t["id"])}"><header class="tkh"><span class="tkid">{esc(t["id"])}</span><div class="tkn"><h3>{esc(t["name"])} <span class="jp">{esc(t["jp"])}</span></h3>'
                   f'<p class="tkm"><span>{esc(t["key"])}</span><span>{esc(t["type"])}</span><span>Reported on v{esc(t["reported"])}</span><span>{esc(t["where"])}</span></p></div>'
                   f'<span class="tkst{" done" if done else " closed" if t.get("status") == "closed" else ""}">{"Done · fixed in v" + esc(t.get("fixed", "")) if done else "Closed · not a bug" if t.get("status") == "closed" else "Open"}</span></header>'
                   f'<blockquote class="tkq"><p lang="th">{esc(t["th"])}</p><p class="tr">{esc(t["en"])}</p></blockquote>'
                   f'<div class="tkc"><section><h4>How it was broken down</h4><ol>{steps}</ol></section><section><h4>Cause</h4><p>{esc(t["cause"])}</p><h4>Fix</h4><p>{esc(t["fix"])}</p><h4>How it was checked</h4><p>{esc(t["check"])}</p></section></div>'
                   f'<div class="tkimg">{figs}</div></article>')
    return "\n".join(out)


def main():
    data, key_by_drive, skipped, raw = load_cards(DATA_DIR / "cardlist.xlsx")
    data["a"] = load_aliases(DATA_DIR / "old_keys.json")
    data["vs"] = VALUED_SKILLS
    # v4 rule database: every card compiled once into engine links (Revise#048)
    sys.path.insert(0, str(ROOT / "tools"))
    import rules_compile
    compiled = {k: rules_compile.compile_card(r) for k, r in raw.items()}
    rules_compile.resolve_same_as(compiled, raw)   # PR326 …: "…以外が使用する場合、このカードは「X」と同じカードとして扱う" (Revise#157)
    # Deck Builder (Pack, Revise#167): cards the Game Table can't run fully by itself get a red frame
    data["na"] = sorted(k for k, c in compiled.items() if c.get("status") in ("partial", "manual"))
    # Revise#398: the list of pictures for tools/img_site/make_images.py (file id, card number, name)
    (ROOT / "tools" / "img_site" / "cards.txt").write_text("".join(f"{c[3]}\t{c[0]}\t{c[1]}\n" for c in data["c"] if c[3]), encoding="utf-8")
    data_js = "window.AA_DATA=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"

    js = "\n".join(f"/* ---- {p.name} ---- */\n" + p.read_text(encoding="utf-8") for p in sorted((SRC / "js").glob("*.js")))
    # card reports (Revise#295): shared by the site and the game table; the site version from the changelog
    shared = "\n".join(f"/* ---- shared/{p.name} ---- */\n" + p.read_text(encoding="utf-8") for p in sorted((SRC / "shared").glob("*.js")))
    site_ver = json.loads((SRC / "changelog.json").read_text(encoding="utf-8"))[0]["v"]
    shared = f"window.AA_SITE_VER = {json.dumps(site_ver)};\n" + shared
    # Revise#409: report id → [ticket, status], so the Card reports manager can tell new reports from handled ones
    shared = "window.AA_TICKETS = " + json.dumps({t["rid"]: [t["id"], t.get("status", "open")] for t in json.loads((SRC / "tickets.json").read_text(encoding="utf-8")) if t.get("rid")}) + ";\n" + shared
    js = js + "\n" + shared
    # Basic decks for Deck Builder → Template (Pack, 2026-11-05): src/data/basic_decks.txt (an "All decks" export) → const BASIC_DECKS_TXT
    js = "const BASIC_DECKS_TXT = " + json.dumps((SRC / "data" / "basic_decks.txt").read_text(encoding="utf-8"), ensure_ascii=False) + ";\n" + js
    # Effect System rules (src/data/effect_types.json) → const EFFECT_RULES, read by src/js/06d-effects.js (card details analysis)
    js = "const EFFECT_RULES = " + json.dumps(json.loads((SRC / "data" / "effect_types.json").read_text(encoding="utf-8")), ensure_ascii=False) + ";\n" + js
    css = (SRC / "css" / "app.css").read_text(encoding="utf-8")

    sys.path.insert(0, str(SRC))
    import rules_content
    rules_toc, rules_body = rules_content.render()
    changelog = render_changelog(json.loads((SRC / "changelog.json").read_text(encoding="utf-8")))
    tickets_l = json.loads((SRC / "tickets.json").read_text(encoding="utf-8"))
    tickets = render_tickets(tickets_l)
    tickets_n = f"{sum(t.get('status') == 'done' for t in tickets_l)} done · {sum(t.get('status') == 'closed' for t in tickets_l)} closed · {sum(t.get('status') not in ('done', 'closed') for t in tickets_l)} open"

    version = hashlib.sha1((data_js + js + css).encode()).hexdigest()[:10]
    banner = "data:image/jpeg;base64," + base64.b64encode((ASSETS / "banner.jpg").read_bytes()).decode()  # inline: keeps canvas export untainted
    html = (SRC / "index.html").read_text(encoding="utf-8")
    for k, v in {"@BANNER": banner, "<!--@HELP-->": (SRC / "partials" / "help.html").read_text(encoding="utf-8"),
                 "<!--@RULES_TOC-->": rules_toc, "<!--@RULES_BODY-->": rules_body, "<!--@CHANGELOG-->": changelog, "<!--@TICKETS-->": tickets, "@TICKETS_N": tickets_n, "@VER": version}.items():
        assert k in html, f"placeholder {k} missing from src/index.html"
        html = html.replace(k, v)

    if OUT.exists(): shutil.rmtree(OUT)
    (OUT / "assets").mkdir(parents=True)
    (OUT / "index.html").write_text(html, encoding="utf-8")
    # Firebase settings for Play Online (assets/firebase-config.js; a stub when not set up yet)
    fb = ASSETS / "firebase-config.js"
    (OUT / "assets" / "firebase-config.js").write_text(fb.read_text(encoding="utf-8") if fb.exists() else
        "/* Play Online: paste your Firebase web config here (see the Play Online tab for the steps). */\nwindow.AA_FIREBASE = null;\n", encoding="utf-8")
    # Card pictures (Revise#398): assets/img-config.js names the pictures site; empty = Google Drive as before
    ib = ASSETS / "img-config.js"
    (OUT / "assets" / "img-config.js").write_text(ib.read_text(encoding="utf-8") if ib.exists() else
        "/* Card pictures: the address of the pictures site (Cloudflare Pages), e.g. \"https://aqa-img.pages.dev\". Empty = Google Drive. */\nwindow.AA_IMG_BASE = \"\";\n", encoding="utf-8")
    (OUT / "assets" / "app.css").write_text(css, encoding="utf-8")
    (OUT / "assets" / "app.js").write_text(js, encoding="utf-8")
    (OUT / "assets" / "data.js").write_text(data_js, encoding="utf-8")
    rules_report = rules_compile.report(compiled)
    (OUT / "assets" / "rules.js").write_text("window.AA_RULES=" + json.dumps({"v": 1, "cards": compiled, "report": rules_report},
        ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    # v4 game table: its own page, so the v3 table in index.html stays as it is (Q#15)
    t_js = "\n".join(f"/* ---- {p.parent.name}/{p.name} ---- */\n" + p.read_text(encoding="utf-8")
                     for p in sorted((SRC / "engine").glob("*.js")) + sorted((SRC / "table4").glob("*.js"))) + "\n" + shared
    t_css = (SRC / "table4" / "table.css").read_text(encoding="utf-8")
    t_ver = hashlib.sha1((t_js + t_css + version).encode()).hexdigest()[:10]
    (OUT / "assets" / "table.js").write_text(t_js, encoding="utf-8")
    (OUT / "assets" / "table.css").write_text(t_css, encoding="utf-8")
    (OUT / "table.html").write_text((SRC / "table4" / "page.html").read_text(encoding="utf-8").replace("@VER", t_ver), encoding="utf-8")
    # card rule coverage page (Revise#049: on the site, not in Excel)
    (OUT / "coverage.html").write_text((SRC / "coverage" / "page.html").read_text(encoding="utf-8").replace("@VER", t_ver), encoding="utf-8")
    # browser tab / home-screen icon (Pack's image, cropped by tools — see assets/favicon/)
    for f in (ASSETS / "favicon").glob("*"): shutil.copy(f, OUT / f.name)
    (OUT / "site.webmanifest").write_text(json.dumps({"name": "Aquarian Age Thailand Fan-site", "short_name": "AA Thailand", "start_url": "index.html", "display": "standalone",
        "background_color": "#060828", "theme_color": "#121866", "icons": [{"src": "icon-192.png", "sizes": "192x192", "type": "image/png"}, {"src": "icon-512.png", "sizes": "512x512", "type": "image/png"}]}, indent=1), encoding="utf-8")
    # User Manual page (Pack, Revise#427): tools/manual/manual.py → manual.html, pictures in manual/
    shutil.copytree(ASSETS / "manual", OUT / "manual")
    sys.path.insert(0, str(ROOT / "tools" / "manual"))
    import manual as manual_page
    _cl = json.loads((SRC / "changelog.json").read_text(encoding="utf-8"))[0]
    manual_page.make(str(OUT / "manual.html"), _cl["v"], _cl["date"])
    shutil.copytree(ASSETS / "help", OUT / "help")
    shutil.copytree(ASSETS / "icons", OUT / "icons")
    shutil.copytree(ASSETS / "tabicons", OUT / "tabicons")   # tab icons (Home: Pack's image; Card List: the card back)
    shutil.copytree(ASSETS / "factions", OUT / "factions")
    shutil.copytree(ASSETS / "tickets", OUT / "tickets")   # Bug reports captures (Revise#329)
    shutil.copytree(ASSETS / "players", OUT / "players")   # Game Table: the 6 default Player images (Pack, Revise#214)
    shutil.copy(ASSETS / "sleeve.jpg", OUT / "sleeve.jpg")   # default deck sleeve: the Aquarian Age card back   # faction marks cropped from the rulebook (p.6)   # class icons cropped from the rulebook table (p.13)

    zip_path = OUT.parent / "aquarian-age-helper.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(OUT.rglob("*")):
            if p.is_file(): z.write(p, p.relative_to(OUT.parent))

    kb = lambda p: p.stat().st_size // 1024
    print(f"{len(data['c'])} cards · {len(data['s'])} series · {skipped} rows skipped (no card no. or Drive image) · {len(data['a'])} old-key aliases")
    import requirements_html
    import milestones   # card milestone sheet (Revise#095): docs/milestones.json + the compiled rules
    keys = {f"{data['s'][r[4]][0]} {r[0]}" for r in data["c"]}
    ms_html, grid_html = milestones.tables(compiled, keys)
    revs, qs, open_q = requirements_html.main(extra={"MILESTONES": ms_html, "SERIES_GRID": grid_html})
    print(f"docs/requirements_v4.html · {revs} Revise notes · {qs} questions ({open_q} open)")
    cr = rules_report["cards"]
    print("rules.js · cards auto / partial / manual: " + " · ".join(f"{t} {v['auto']}/{v['partial']}/{v['manual']}" for t, v in cr.items() if t in ("Character", "Break", "Permanent", "Project", "Fast"))
          + f" · effect lines {rules_report['effectLines']} · Fast/Project {rules_report['fastProject']}")
    print(f"index.html {kb(OUT / 'index.html')} KB · app.js {kb(OUT / 'assets' / 'app.js')} KB · data.js {kb(OUT / 'assets' / 'data.js')} KB · zip {kb(zip_path)} KB · v{version}")


if __name__ == "__main__":
    main()
