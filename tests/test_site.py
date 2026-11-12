#!/usr/bin/env python3
"""Regression tests for the built site (headless Chromium via Playwright).

    python3 tests/test_site.py [path/to/sortable.min.js]

1. Differential: the same filter/sort actions on the previous single-file page
   (legacy/aquarian-age-card-finder.html, if present) and on dist/ must return
   identical result lists.
2. Feature checks on dist/: deck rules, export/import round trip, old deck keys,
   drag-and-drop, image export, help, rules tab, keyboard, phone layout, errors.
Network is blocked except a local copy of SortableJS, so Drive images fail on purpose.
"""
import re, sys, json, threading, functools, http.server
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
NEW = (ROOT / "dist/aquarian-age-helper/index.html").as_uri()
OLD_PATH = ROOT / "legacy/aquarian-age-card-finder.html"
SORTABLE = Path(sys.argv[1]) if len(sys.argv) > 1 else None

passed, failed = 0, []
def check(name, cond, detail=""):
    global passed
    if cond: passed += 1
    else: failed.append(f"{name}: {detail}")

def passall(*pages):
    """Resolve Box: every player passes (no response), so the declarations resolve."""
    for _ in range(3):
        for pg in pages:
            if pg.locator('[data-play="pass"]').count(): pg.locator('[data-play="pass"]').first.click(); pg.wait_for_timeout(200)

def context(browser, **kw):
    kw.setdefault("reduced_motion", "reduce")   # Revise#286: the checks look right after a click; motion is checked on its own
    ctx = browser.new_context(**kw)
    def route(r):
        if SORTABLE and "Sortable" in r.request.url:
            return r.fulfill(body=SORTABLE.read_text(), content_type="application/javascript")
        if r.request.url.startswith("http://127.0.0.1:"): return r.continue_()
        return r.abort()
    ctx.route(re.compile(r"^https?://"), route)
    return ctx

def open_page(ctx, url, errors):
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(url); pg.wait_for_timeout(500)
    return pg

SCENARIOS = [  # (name, actions); each action = (kind, selector, value)
    ("text search 巫女", [("fill", "#q", "巫女")]),
    ("hiragana reading", [("fill", "#q", "じょしこうせい")]),
    ("series + faction", [("select", "#series", "0"), ("faction", None, "E.G.O.")]),
    ("category Break + cost 2", [("select", "#ctype", "Break"), ("click", "#statsToggle", None), ("select", "#st-co", "2")]),
    ("class any", [("click", "#klassBtn", None), ("check", '.kgrid input[value="スチューデント"]', None), ("check", '.kgrid input[value="スキャナー"]', None)]),
    ("class all", [("click", "#klassBtn", None), ("check", '.kgrid input[value="スチューデント"]', None), ("check", '.kgrid input[value="スキャナー"]', None), ("click", '[data-km="all"]', None)]),
    ("multi-sort F↑ C↓", [("select", "#ctype", "Break"), ("click", "#statsToggle", None), ("click", '.sbtn[data-sort="fa"]', None), ("click", '.sbtn[data-sort="co"]', None), ("click", '.sbtn[data-sort="co"]', None)]),
    ("attack sort + none", [("click", "#statsToggle", None), ("select", "#st-de", "__none"), ("click", '.sbtn[data-sort="at"]', None)]),
]

def pick_faction(pg, val):
    if pg.locator("#factBtn").count(): pg.click("#factBtn"); pg.click(f'#fpanel [data-f="{val}"]')
    else: pg.select_option("#faction", val)

def run_scenario(pg, actions):
    pg.evaluate("localStorage.clear()"); pg.reload(); pg.wait_for_timeout(400)
    for kind, sel, val in actions:
        if kind == "fill": pg.fill(sel, val); pg.wait_for_timeout(250)
        elif kind == "select": pg.select_option(sel, val)
        elif kind == "click": pg.click(sel)
        elif kind == "check": pg.check(sel)
        elif kind == "faction": pick_faction(pg, val)
        pg.wait_for_timeout(80)
    return pg.inner_text("#status"), pg.evaluate("PANES.cards.res.slice(0,40).map(c=>c.k).join(',')")

with sync_playwright() as p:
    b = p.chromium.launch()
    errors = []

    # ---- 1. differential against the previous build ----
    if OLD_PATH.exists():
        ctx = context(b, viewport={"width": 1366, "height": 900})
        old, new = open_page(ctx, OLD_PATH.as_uri() + "#cards", errors), open_page(ctx, NEW + "#cards", errors)
        for name, actions in SCENARIOS:
            o, n = run_scenario(old, actions), run_scenario(new, actions)
            check(f"same results: {name}", o == n, f"old {o[0]} / new {n[0]}")
        ctx.close()

    # ---- 2. feature checks on the new build ----
    ctx = context(b, viewport={"width": 1366, "height": 900}, accept_downloads=True)
    pg = open_page(ctx, NEW + "#cards", errors)
    pg.evaluate("localStorage.clear()"); pg.reload(); pg.wait_for_timeout(400)
    # User Manual page, opened from Home (Revise#427)
    mp = open_page(ctx, NEW, errors); mp.wait_for_timeout(300)
    check("home: the User Manual link", mp.locator("#homeManual").is_visible() and mp.get_attribute("#homeManual", "href") == "manual.html")
    mp.click("#homeManual"); mp.wait_for_selector("section.page.cover", timeout=15000); mp.wait_for_timeout(400)
    check("manual: cover, contents and 10 chapters, pictures loaded", mp.locator("section.page").count() == 12 and mp.evaluate("[...document.images].every(i => i.complete && i.naturalWidth > 0)"))
    mp.click(".langbar button[data-l=th]"); mp.wait_for_timeout(150)
    check("manual: Thai switch", mp.evaluate("document.documentElement.dataset.lang") == "th" and mp.locator("#ch4 h2 [lang=th]").is_visible() and not mp.locator("#ch4 h2 [lang=en]").is_visible())
    mp.click(".backlink"); mp.wait_for_selector("#p-home", timeout=15000)
    check("manual: back to the site", mp.url.split("#")[0].endswith("index.html"))
    mp.close()

    # highlight: second term must not break the first term's <mark>
    pg.fill("#q", "ma a"); pg.wait_for_timeout(300)
    html = pg.evaluate("document.querySelector('#grid .card .en')?.innerHTML||''")
    check("highlight markup intact", "<m<mark>" not in html and html.count("<mark>") == html.count("</mark>"), html[:120])
    pg.fill("#q", "")

    # "/" focuses search only on search tabs
    pg.click('[data-tab="rules"]'); pg.keyboard.press("/")
    check("'/' ignored on Rules", pg.evaluate("document.activeElement.id") != "q")
    pg.click('[data-tab="cards"]'); pg.locator("body").click(position={"x": 5, "y": 5}); pg.keyboard.press("/")
    check("'/' focuses search on Card List", pg.evaluate("document.activeElement.id") == "q")

    # reset keeps the search text, clears filters
    pg.fill("#q", "巫女"); pg.wait_for_timeout(250); pick_faction(pg, "Darklore"); pg.wait_for_timeout(100)
    check("faction button shows icon + pastel", pg.locator("#factBtn.tinted img.ficon").count() == 1)
    check("reset button visible + count", pg.locator("#resetF").is_visible() and pg.locator("#resetTop").is_visible() and pg.inner_text("#resetTopN") == "1")
    pg.click("#resetF")
    check("reset keeps query", pg.input_value("#q") == "巫女" and pg.evaluate("curF().f") == "")
    pg.click("#factBtn")
    order = pg.eval_on_selector_all("#fpanel [data-f]", "els => els.map(e => e.dataset.f).filter(Boolean)")
    check("faction order", order[:6] == ["E.G.O.", "Arayashiki", "WIZ-DOM", "Darklore", "Polestar Empire", "Eraser"], str(order))
    check("faction icons", pg.locator("#fpanel img.ficon").count() == 6)
    pg.click("#factBtn")
    pg.fill("#q", ""); pg.wait_for_timeout(250)
    pg.click("#brBtn"); pg.wait_for_timeout(150)
    check("Break-cost return filter", pg.evaluate("PANES.cards.res.length>=15&&PANES.cards.res.every(c=>c.t==='Character'&&/ブレイクカードのコスト≫は(オーナーの)?手札に戻る/.test(c.text))") and pg.get_attribute("#brBtn","aria-pressed") == "true")
    check("Break-cost return count", pg.inner_text("#brN") == str(pg.evaluate("PANES.cards.res.length")))
    pg.click("#resetTop"); pg.wait_for_timeout(150)
    check("top Reset clears filters", pg.evaluate("!curF().br") and pg.locator("#resetTop").is_hidden())

    # faceted filters: counts follow the other filters
    pg.click("#statsToggle"); pg.select_option("#st-co", "3"); pg.wait_for_timeout(150)
    shown = pg.evaluate("[...document.querySelectorAll('#st-fa option')].filter(o=>o.value).map(o=>[o.value,+o.textContent.match(/\\(([\\d,]+)\\)/)[1].replace(/,/g,'')])")
    real = pg.evaluate("(()=>{const m={};CARDS.filter(c=>c.st.co==='3').forEach(c=>{const v=c.st.fa||'__none';m[v]=(m[v]||0)+1});return m})()")
    check("factor counts follow cost 3", all(real.get(v) == n for v, n in shown) and len(shown) == len(real), f"{shown} vs {real}")
    total = pg.evaluate("+document.getElementById('status').textContent.split(' ')[0].replace(/,/g,'')")
    check("factor counts add up to results", sum(n for _, n in shown) == total, f"{sum(n for _, n in shown)} vs {total}")
    pg.click("#resetF"); pg.select_option("#ctype", "Character"); pg.wait_for_timeout(150)
    se = pg.evaluate("[...document.querySelectorAll('#st-se option')].map(o=>o.value)")
    check("Character hides +X 精神力", "+X" not in se and "+1" not in se and "3" in se, str(se))
    pg.select_option("#st-se", "3"); pg.select_option("#ctype", ""); pg.wait_for_timeout(150)
    check("selected value stays listed", pg.input_value("#st-se") == "3")
    pg.click("#klassBtn"); pg.check('.kgrid input[value="スチューデント"]'); pg.click('[data-km="all"]'); pg.wait_for_timeout(150)
    kn = pg.evaluate("(()=>{const l=[...document.querySelectorAll('.kgrid label')].find(l=>l.querySelector('input').value==='スキャナー');return l?+l.querySelector('.kn').textContent.replace(/,/g,''):-1})()")
    want = pg.evaluate("CARDS.filter(c=>c.st.se==='3'&&c.cls.includes('スチューデント')&&c.cls.includes('スキャナー')).length")
    check("multi-icon count = result if ticked", kn == want, f"{kn} vs {want}")
    pg.click("#resetF"); pg.click("#kdone"); pg.wait_for_timeout(150)

    # skills: checklist filter, counts, value sort
    pg.click("#skillBtn"); pg.check('#skgrid input[value="Charge +2"]'); pg.wait_for_timeout(150)
    want = pg.evaluate("CARDS.filter(c=>c.skills.includes('Charge +2')).length")
    got = pg.evaluate("+document.getElementById('status').textContent.split(' ')[0].replace(/,/g,'')")
    check("skill filter Charge +2", got == want and want > 0, f"{got} vs {want}")
    pg.uncheck('#skgrid input[value="Charge +2"]'); pg.check('#skgrid input[value="Shield"]'); pg.check('#skgrid input[value="Charge +1"]'); pg.click('[data-skm="all"]'); pg.wait_for_timeout(150)
    want = pg.evaluate("CARDS.filter(c=>c.skills.includes('Shield')&&c.skills.includes('Charge +1')).length")
    got = pg.evaluate("PANES.cards.res.length")
    check("skills all-mode", got == want, f"{got} vs {want}")
    pg.click("#skclear"); pg.click("#skdone")
    pg.click('#sksorts .sbtn[data-sort="sk:Draw"]'); pg.click('#sksorts .sbtn[data-sort="sk:Draw"]'); pg.wait_for_timeout(150)
    top = pg.evaluate("PANES.cards.res.slice(0,3).map(c=>c.sk.Draw)")
    check("sort by Draw value, large first", top[0] in ("+2", "X") or top[0].startswith("+"), str(top))
    pg.click("#resetF"); pg.wait_for_timeout(100)

    # deck rules
    pg.click('[data-tab="deck"]'); pg.wait_for_timeout(200)
    pg.click("#btnSearch"); pg.wait_for_timeout(200)   # Revise#154: the search is a pop-up
    check("deck search pop-up", pg.locator("#dbs").is_visible() and pg.locator("#dbs #q").count() == 1)
    pg.fill("#q", "財巫女"); pg.wait_for_timeout(300)
    row = pg.locator("#plist .row").first
    check("search card: − 0 + and no category buttons (Revise#404)", row.locator(".catbtn").count() == 0 and row.locator(".qtyn").inner_text() == "0" and row.locator('button[data-act="dec"]').is_disabled())
    row.locator('button[data-act="add"]').click()
    check("+ adds it under its card type", pg.evaluate("(() => { const k = document.querySelector('#plist .row .ctrl').dataset.k, f = entryOf(k); return !!f && f.cat === card(k).t && f.e.n === 1; })()"))
    for _ in range(3): row.locator('button[data-act="add"]').click()
    row.locator('button[data-act="add"]').click()
    check("no 4-copy limit (Revise#211)", pg.evaluate("deckTotal()") == 5 and not row.locator('button[data-act="add"]').is_disabled())
    pg.keyboard.press("Escape"); pg.wait_for_timeout(150)
    check("Escape closes the search pop-up", pg.locator("#dbs").is_hidden() and pg.locator("header #fhome").count() == 1)
    full = "\n".join(["[Break]"] + [f"4 x {k}" for k in pg.evaluate("CARDS.filter(c=>c.t==='Break').slice(0,20).map(c=>c.k)")])
    r = pg.evaluate("t=>{const r=parseDeck(t);return [r.total,r.notes.length]}", full)
    check("no 60-card limit on import (Revise#211)", r[0] == 80 and r[1] == 0, str(r))

    # export text → import round trip, old keys still import
    text = pg.evaluate("deckText()")
    pg.click("#btnNew"); pg.click("#btnNew")
    check("New clears deck", pg.evaluate("deckTotal()") == 0)
    pg.click("#btnImport"); pg.fill("#txtIn", text); pg.click("#doImport"); pg.wait_for_timeout(200)
    check("import round trip", pg.evaluate("deckTotal()") == 5)   # 5 copies since Revise#211 (no limit)
    # Empty Check (Revise#219): importing over a slot with cards asks first; No keeps it, Yes overwrites
    pg.click("#btnImport"); pg.fill("#txtIn", "[Fast]\n2 x A3-PR 0052"); pg.wait_for_timeout(100)
    check("Empty Check box, on by default", pg.locator("#impCheck").is_checked())
    pg.click("#doImport"); pg.wait_for_timeout(200)
    ask = pg.locator("#impAsk").inner_text() if pg.locator("#impAsk").is_visible() else ""
    check("Empty Check asks before overwriting", "Would you like to overwrite slot number" in ask and pg.locator("#impYes").is_visible() and pg.locator("#impNo").is_visible(), ask)
    pg.click("#impNo"); pg.wait_for_timeout(150)
    check("No: nothing overwritten", pg.evaluate("deckTotal()") == 5)
    pg.click("#doImport"); pg.wait_for_timeout(150); pg.click("#impYes"); pg.wait_for_timeout(200)
    check("Yes: overwritten", pg.evaluate("deckTotal()") == 2)
    pg.evaluate("deck=parseDeck('[Character]\\n5 x A3-01 0001').deck;deckChanged()")
    check("old key alias", pg.evaluate("parseDeck('[Fast]\\n2 x A3-PR 0052').total") == 2)

    # drag-and-drop between columns
    pg.evaluate("deck=parseDeck('[Character]\\n2 x A3-01 0001\\n1 x A3-01 0002\\n[Break]\\n1 x A3-01 0010').deck;deckChanged()")
    pg.locator('#cols .list[data-cat="Fast"]').scroll_into_view_if_needed(); pg.wait_for_timeout(100)   # the columns can be below the fold
    src, dst = pg.locator('#cols .list[data-cat="Character"] .item').first.bounding_box(), pg.locator('#cols .list[data-cat="Fast"]').bounding_box()
    pg.mouse.move(src["x"] + 5, src["y"] + 5); pg.mouse.down(); pg.mouse.move(src["x"] + 20, src["y"] + 20, steps=4)
    pg.mouse.move(dst["x"] + dst["width"] / 2, dst["y"] + 20, steps=12); pg.mouse.up(); pg.wait_for_timeout(300)
    check("drag to another column", pg.evaluate("catTotal('Character')") == 1 and pg.evaluate("deckTotal()") == 4,
          pg.evaluate("JSON.stringify(deck.cols)"))
    check("Character in 2 columns (main / other factors)", pg.locator('#cols .list[data-cat="Character"]').count() == 2 and pg.locator("#cols .col").count() == 6)

    # image export (art is blocked here, so name tiles are expected)
    pg.click("#btnExport"); pg.wait_for_selector("#prev img", timeout=40000)
    check("jpg export", pg.locator("#dlJpg").is_enabled())
    with pg.expect_download() as d: pg.click("#dlJpg")
    check("jpg download name", d.value.suggested_filename.endswith(".jpg"))
    pg.keyboard.press("Escape"); pg.wait_for_timeout(150)
    check("Escape closes export", pg.locator("#modal").is_hidden())

    # deck sleeve
    pg.click("#btnSleeve"); pg.wait_for_timeout(150)
    check("sleeve: default is the card back", "sleeve.jpg" in pg.get_attribute("#slvBack", "style"))
    pg.fill("#slvZoom", "150"); pg.dispatch_event("#slvZoom", "input"); pg.wait_for_timeout(80)
    check("sleeve: size adjusts", pg.evaluate("deck.sleeve.zoom") == 150 and "150% auto" in pg.get_attribute("#slvBack", "style"))
    pg.click("#slvDef"); pg.keyboard.press("Escape"); pg.wait_for_timeout(100)
    check("sleeve: back to default", pg.evaluate("deck.sleeve") is None)
    # deck slots + export all
    check("deck slots: 10 slots a page", pg.locator("#deckSlot option").count() == 10)
    check("deck slots: 5 pages (Revise#397)", pg.locator("#deckPage option").count() == 5)
    pg.select_option("#deckPage", "4"); pg.wait_for_timeout(150)
    check("deck page 5: slots 41-50, slot 41 open", pg.locator("#deckSlot option").first.inner_text().startswith("41.") and pg.evaluate("deckSlot") == 40)
    pg.select_option("#deckSlot", "49"); pg.wait_for_timeout(100)
    check("slot 50 can be opened and is kept", pg.evaluate("deckSlot") == 49 and pg.evaluate("JSON.parse(localStorage.getItem('aa-slot'))") == 49)
    pg.select_option("#deckPage", "0"); pg.wait_for_timeout(150)
    check("back on page 1: the same place (slot 10)", pg.evaluate("deckSlot") == 9)
    pg.select_option("#deckSlot", "0"); pg.wait_for_timeout(150)
    n0 = pg.evaluate("deckTotal()"); name0 = pg.evaluate("deck.name")
    pg.select_option("#deckSlot", "1"); pg.wait_for_timeout(150)
    check("deck slots: empty slot 2", pg.evaluate("deckTotal()") == 0 and pg.evaluate("deckSlot") == 1)
    pg.evaluate("addCard(CARDS.find(c=>c.t==='Character').k,'Character')"); pg.fill("#deckName", "Second deck"); pg.wait_for_timeout(100)
    pg.evaluate("addCard(CARDS.find(c=>c.na&&c.t==='Project').k,'Project')"); pg.wait_for_timeout(100)   # Revise#167: red frame
    check("deck: not-automatic card has a red frame + legend", pg.locator("#cols .item.na").count() == 1 and "not automatic" in pg.inner_text("#summary"))
    pg.evaluate("removeAll(CARDS.find(c=>c.na&&c.t==='Project').k)"); pg.wait_for_timeout(100)
    pg.select_option("#deckSlot", "0"); pg.wait_for_timeout(150)
    check("deck slots: slot 1 kept", pg.evaluate("deckTotal()") == n0 and pg.evaluate("deck.name") == name0 and "Second deck" in pg.inner_text("#deckSlot"))
    # Print Preview (Revise#424): the chosen cards on A4 pages, 59 × 86 mm each
    pg.click("#btnExport"); pg.wait_for_timeout(200); pg.click('[data-fmt="print"]'); pg.wait_for_timeout(200)
    check("print: not logged in → a login notice, no card list (Revise#425)", pg.locator("#prLogin").is_visible() and pg.locator("#prList").count() == 0 and pg.evaluate("AAAccount.state()") == "out")
    pg.evaluate("makePrintPages(deck, printEntries(deck), printLayouts().p)"); pg.wait_for_timeout(200)
    check("print: no pages are made without a login", pg.evaluate("PRINT.pages.length") == 0 and pg.locator("#prLogin").is_visible())
    pg.click("#prLogin"); pg.wait_for_timeout(300)
    check("print: Log in opens the Account page", pg.locator("#acId").is_visible() and pg.locator("#modal").is_hidden())
    pg.evaluate("AAAccount.close()"); pg.wait_for_timeout(100); pg.click("#btnExport"); pg.wait_for_timeout(200)
    pg.evaluate("AAAccount.state = () => 'in'"); pg.click('[data-fmt="jpg"]'); pg.click('[data-fmt="print"]'); pg.wait_for_timeout(200)
    n_all = pg.evaluate("deckTotal()")
    check("print: every card of the deck is chosen at first", pg.locator("#prList input:checked").count() == pg.locator("#prList input").count() and f"{n_all} card" in pg.text_content("#prSum"))
    pg.click("#prMake"); pg.wait_for_selector(".prpage img", timeout=90000); pg.wait_for_timeout(300)
    import math
    lay = pg.evaluate("printLayouts()")
    check("print: 1 mm between cards, portrait only (Revise#426)", list(lay.keys()) == ["p"] and lay["p"]["mx"] == 15.5 and lay["p"]["my"] == 18.5 and pg.locator("#prLay").count() == 0 and "1 mm between cards" in pg.text_content("#prLayNote"))
    check("print: 9 cards a page in portrait", pg.locator(".prpage").count() == math.ceil(n_all / 9) and "2480 × 3508 px at 300 dpi" in pg.text_content("#prStat"))
    pr = pg.evaluate("(async () => { const pdf = await printPdf(PRINT.pages), b = new Uint8Array(await pdf.arrayBuffer()), png = new Uint8Array(await PRINT.pages[0].png.arrayBuffer()); return [String.fromCharCode(...b.slice(0, 5)), new TextDecoder().decode(b.slice(-6)).trim(), String.fromCharCode(...png.slice(37, 41)), new DataView(png.buffer).getUint32(41)]; })()")
    check("print: a PDF and a PNG that knows its 300 dpi", pr == ["%PDF-", "%%EOF", "pHYs", 11811])
    pg.keyboard.press("Escape"); pg.wait_for_timeout(150)
    pg.click("#btnExport"); pg.click('[data-scope="all"]'); pg.wait_for_timeout(200); pg.click('[data-fmt="txt"]')
    txt = pg.input_value("#txtOut")
    check("export all decks (text)", txt.count("# Deck:") == 2 and "# ==========" in txt and "Second deck" in txt)
    pg.click('[data-fmt="jpg"]'); pg.wait_for_selector(".prevs img", timeout=60000); pg.wait_for_timeout(300)
    check("export all decks (one image each)", pg.locator(".prevs img").count() == 2 and pg.locator("#dlJpg").is_enabled())
    pg.keyboard.press("Escape"); pg.wait_for_timeout(100)
    pg.evaluate("exportAll=false")
    pg.select_option("#deckSlot", "1"); pg.click("#btnNew"); pg.click("#btnNew"); pg.wait_for_timeout(100)
    pg.select_option("#deckSlot", "2"); pg.wait_for_timeout(100)
    pg.click("#btnImport"); pg.fill("#txtIn", txt); pg.click("#doImport"); pg.wait_for_timeout(200)
    ask = pg.locator("#impAsk").inner_text() if pg.locator("#impAsk").is_visible() else ""
    check("Empty Check lists every slot it would overwrite (Revise#219)", ask.startswith("Would you like to overwrite slot number") and ("and" in ask or ask.count(",") == 0), ask)
    if pg.locator("#impYes").is_visible(): pg.click("#impYes"); pg.wait_for_timeout(200)
    check("import all decks restores slots", pg.evaluate("slotTotal(deckSlots[1])") == 1 and pg.evaluate("deckSlots[1].name") == "Second deck")
    pg.select_option("#deckSlot", "0"); pg.wait_for_timeout(150)

    # template: Character #1
    pg.click("#btnTemplate"); pg.check("#tplFresh"); pg.click('[data-tpl="char1"]'); pg.wait_for_timeout(150)
    combo = pg.evaluate("""(()=>{let best=null;for(const t of CLASS_LIST)for(const m of FACTS)for(const s of FACTS){if(m===s)continue;
      const d=CARDS.filter(c=>c.t==='Character'&&c.cls.includes(t)&&c.f===m&&c.sk.Draw&&!c.sk.Draw.startsWith('-')).length;
      const ch=CARDS.filter(c=>c.t==='Character'&&c.cls.includes(t)&&c.f===m&&c.sk.Charge).length;
      const ds=CARDS.filter(c=>c.t==='Character'&&c.cls.includes(t)&&c.f===s&&c.sk.Draw&&!c.sk.Draw.startsWith('-')).length;
      if(d>=2&&ch>=4&&ds>=1&&(!best||d+ch+ds>best[3]))best=[t,m,s,d+ch+ds]}return best})()""")
    check("template icon grid has images", pg.locator('.tpl-igrid [data-tval="icon"] img.kicon').count() > 20)
    check("template next disabled before setup", pg.locator('[data-tnav="next"]').is_disabled())
    check("setup defaults with no Break cards: sub icon None, sub factor Any, main icon / factor empty", pg.evaluate("[tpl.icon, tpl.icon2, tpl.main, tpl.sub]") == ["", "-", "", "*"])
    pg.click(f'[data-tval="icon"][data-v="{combo[0]}"]'); pg.wait_for_timeout(80)
    pg.click('[data-topen="icon2"]'); pg.wait_for_timeout(80)
    sub_opts = pg.eval_on_selector_all('[data-tval="icon2"]', "els => els.map(e => e.dataset.v)")
    expect = pg.evaluate(f"""[...new Set(CARDS.filter(c=>c.t==='Character'&&c.cls.includes({combo[0]!r})).flatMap(c=>c.cls))].filter(t=>t!=={combo[0]!r}).length""")
    check("sub icon list: None, Any, filtered by main icon", sub_opts[:2] == ["-", "*"] and len(sub_opts) - 2 == expect, f"{sub_opts[:2]} {len(sub_opts)} vs {expect}")
    pg.click('[data-tval="icon2"][data-v="-"]'); pg.wait_for_timeout(80)
    check("template sub factor locked until main", pg.locator('[data-topen="sub"]').is_disabled())
    check("factor picker has faction icons", pg.locator('.tpl-fgrid [data-tval="main"] img.ficon').count() == 6)
    pg.click(f'[data-tval="main"][data-v="{combo[1]}"]'); pg.wait_for_timeout(50)
    pg.click('[data-topen="sub"]'); pg.wait_for_timeout(50)
    check("template sub factor Any option", pg.locator('[data-tval="sub"][data-v="*"]').count() == 1 and pg.locator(f'[data-tval="sub"][data-v="{combo[1]}"]').count() == 0)
    pg.click(f'[data-tval="sub"][data-v="{combo[2]}"]'); pg.wait_for_timeout(50)
    pg.click('[data-tnav="next"]'); pg.wait_for_timeout(150)
    check("template starts empty deck", pg.evaluate("deckTotal()") == 0 and "Template #2" in pg.evaluate("deck.name"))
    pg.locator('[data-tcount="1"]').first.click(); pg.wait_for_timeout(60); pg.locator('[data-tcount="1"]').first.click(); pg.wait_for_timeout(60)
    pg.locator(".tpl-dbtn").first.click(); pg.wait_for_timeout(150)
    check("template card → details over the dialog", pg.evaluate("!$('sheet').hidden && !$('modal').hidden && document.body.classList.contains('sheetover')"))
    pg.keyboard.press("Escape"); pg.wait_for_timeout(100)
    check("Escape closes the details, back to the template", pg.evaluate("$('sheet').hidden && !$('modal').hidden && !!tpl"))
    check("template stepper sets 2 copies", pg.evaluate("deckCharacters()") == 2, str(pg.evaluate("deckCharacters()")))
    order0 = pg.evaluate("[...document.querySelectorAll('.tpl-grid .tpl-card')].slice(0, 8).map(e => e.innerText.slice(0, 30)).join('|')")
    pg.locator("[data-tfour]").nth(1).click(); pg.wait_for_timeout(60)
    order1 = pg.evaluate("[...document.querySelectorAll('.tpl-grid .tpl-card')].slice(0, 8).map(e => e.innerText.slice(0, 30)).join('|')")
    check("template: a card picked on this page stays where it is (Revise#123)", order0.split("|")[1].split("\n")[0] == order1.split("|")[1].split("\n")[0] and pg.evaluate("document.querySelectorAll('.tpl-grid .tpl-card')[1].classList.contains('on')"), order1[:160])
    check("template: picked card moved to the top", pg.evaluate("document.querySelector('.tpl-grid .tpl-card').classList.contains('on')"))
    check("template Draw·main capped at 4 cards", pg.evaluate("deckCharacters()") == 4, str(pg.evaluate("deckCharacters()")))
    check("template counter shows cards", "4 / 4 cards" in pg.inner_text(".tpl-count"))
    pg.click('[data-tnav="next"]'); pg.locator("[data-tfour]").first.click(); pg.click('[data-tnav="next"]'); pg.wait_for_timeout(100)
    check("Break return step after Draw", "Break-cost return" in pg.inner_text("#m-title") and pg.evaluate("textCandidates(curStep()).length") >= 15
          and pg.evaluate("textCandidates(curStep()).every(x=>x.c.t==='Character'&&/ブレイクカードのコスト≫は(オーナーの)?手札に戻る/.test(x.c.text))"))
    check("Break return: main icon first, then factions", pg.evaluate("""(()=>{const L=textCandidates(curStep()),G=textGroups();
      return new Set(L.map(x=>x.c.f)).size>=4&&L.every((x,i)=>i===0||L[i-1].g<=x.g)&&L.every(x=>G.findIndex(g=>g.test(x.c))===x.g)&&G[0].icons[0]===tpl.icon})()"""))
    ok = pg.evaluate("""(()=>{const t=CLASS_LIST.find(t=>CARDS.some(c=>S_BREAKRET.test(c)&&c.cls.includes(t)));const keep={...tpl};
      Object.assign(tpl,{icon:t,icon2:'-'});const L=textCandidates(curStep());Object.assign(tpl,keep);
      return L[0].c.cls.includes(t)&&L.filter(x=>x.g===0).every(x=>x.c.cls.includes(t))})()""")
    check("Break return: cards with the main icon come first", ok)
    before = pg.evaluate("deckCharacters()")
    for i in range(3):
        en = pg.locator("[data-tfour]:not([disabled])")
        if en.count(): en.first.click(); pg.wait_for_timeout(50)
    check("Break return capped at 8 cards", pg.evaluate("deckCharacters()") - before == 8 and "8 / 4–8" in pg.inner_text(".tpl-goal"), str(pg.evaluate("deckCharacters()") - before))
    pg.click('[data-tnav="next"]'); pg.wait_for_timeout(100)
    before = pg.evaluate("deckCharacters()")
    for i in range(4):
        en = pg.locator("[data-tfour]:not([disabled])")
        if en.count(): en.first.click(); pg.wait_for_timeout(60)
    pg.evaluate("document.getElementById('modal').scrollTop = 99999"); pg.wait_for_timeout(150)
    st = pg.evaluate("(()=>{const m=document.getElementById('modal').getBoundingClientRect(),s=document.querySelector('.tpl-sticky').getBoundingClientRect();return [s.top>=m.top, s.top<m.top+200]})()")
    check("template: counts stay visible when scrolled", st == [True, True], str(st))
    check("template Charge·main capped at 12 cards", pg.evaluate("deckCharacters()") - before == 12, str(pg.evaluate("deckCharacters()") - before))
    pg.click('[data-tnav="next"]'); pg.wait_for_timeout(100)
    before = pg.evaluate("deckCharacters()")
    for i in range(4):
        en = pg.locator("[data-tfour]:not([disabled])")
        if en.count(): en.first.click(); pg.wait_for_timeout(50)
    sub_added = pg.evaluate("deckCharacters()") - before
    check("template Charge·sub capped at 10 cards", sub_added <= 10 and "/ 10 cards" in pg.inner_text(".tpl-count"), str(sub_added))
    check("template counts are characters", pg.evaluate("deckCharacters()") == pg.evaluate("deckTotal()"))
    pg.click('[data-tnav="next"]'); pg.click('[data-tnav="finish"]')
    check("Clear button label", pg.inner_text("#btnNew") == "Clear")
    pg.evaluate("""(()=>{const t=CLASS_LIST.find(t=>CARDS.some(c=>c.t==='Character'&&c.f==='E.G.O.'&&c.sk.Charge&&c.cls.includes(t)&&c.cls.length>1));
      const t2=CARDS.find(c=>c.t==='Character'&&c.f==='E.G.O.'&&c.sk.Charge&&c.cls.includes(t)&&c.cls.length>1).cls.find(x=>x!==t);
      openTemplates(); startTemplate('char1'); Object.assign(tpl,{icon:t,icon2:t2,main:'E.G.O.',sub:'*',step:4,open:null}); renderTemplate();})()""")
    check("Charge·main shows 3 icon sections + jump links", pg.locator(".tpl-ghead").count() == 3 and pg.locator("[data-tjump]").count() == 3)
    pg.evaluate("tpl=null; closeAll()")
    res = pg.evaluate("""(()=>{const out={};
      for(const t of CLASS_LIST)for(const m of FACTS){
        const pair=CARDS.find(c=>c.t==='Character'&&c.f===m&&c.sk.Charge&&c.cls.includes(t)&&c.cls.length>1);
        if(!pair)continue; const t2=pair.cls.find(x=>x!==t);
        tpl={id:'char1',step:4,icon:t,icon2:t2,main:m,sub:'*',q:{},sf:{},more:{}};
        const ch=stepCandidates(CHAR_STEPS[3]), dr=stepCandidates(CHAR_STEPS[0]);
        const grp=c=>c.cls.includes(t)&&c.cls.includes(t2)?0:c.cls.includes(t)?1:2;
        out.order=ch.every((x,i)=>x.g===grp(x.c)&&(i===0||ch[i-1].g<=x.g)) && ch.some(x=>x.g===0);
        out.drawMain=dr.every((x,i)=>x.c.f===m&&(x.g===0?x.c.cls.includes(t):x.c.cls.includes(t2)&&!x.c.cls.includes(t))&&(i===0||dr[i-1].g<=x.g));
        tpl.icon2='-'; out.none=stepCandidates(CHAR_STEPS[3]).every(x=>x.c.cls.includes(t));
        tpl.sub='*'; out.anySub=stepCandidates(CHAR_STEPS[1]).every(x=>x.c.f!==m&&x.c.cls.includes(t));
        tpl=null; return out;}})()""")
    check("template Charge groups: main+sub → main → sub", res.get("order"), str(res))
    check("template Draw: main icon section, then sub icon", res.get("drawMain"))
    check("template sub icon None = main icon only", res.get("none"))
    check("template Any sub factor", res.get("anySub"))

    # Template #2 Full Deck
    pg.click("#btnTemplate"); pg.check("#tplFresh"); pg.click('[data-tpl="full"]'); pg.wait_for_timeout(150)
    check("T1 starts on Main Break search", pg.locator('[data-tq="mainbreak"]').count() == 1 and pg.evaluate("deckTotal()") == 0)
    brk = pg.evaluate("""(()=>{const b=CARDS.find(c=>c.t==='Break'&&c.f==='Arayashiki'&&c.cls.length===2&&CARDS.some(x=>x.t==='Break'&&x.f==='Arayashiki'&&x.cls.includes(c.cls[0])&&(x.sk.Charge||x.sk.Draw)));return [b.jp,b.cls]})()""")
    pg.fill('[data-tq="mainbreak"]', brk[0]); pg.wait_for_timeout(400)
    pg.locator("#tpl-res [data-tfour]").first.click(); pg.wait_for_timeout(100)
    check("T1 main break added (non-character meter)", pg.evaluate("deckNonCharacters()") == 4 and "Non-characters" in pg.inner_text(".tpl-meter"))
    pg.click('[data-tnav="next"]'); pg.wait_for_timeout(100)
    check("T1 setup defaults: main icon / factor = the most common of the Main Break cards, sub icon None, sub factor Any", pg.evaluate("[tpl.icon, tpl.icon2, tpl.main, tpl.sub]") == [brk[1][0], "-", "Arayashiki", "*"], str(pg.evaluate("[tpl.icon, tpl.icon2, tpl.main, tpl.sub]")))
    check("T1 Next is ready with the defaults", not pg.locator('[data-tnav="next"]').is_disabled())
    pg.click('[data-topen="icon"]'); pg.wait_for_timeout(80)
    rec = pg.eval_on_selector_all('.tpl-igrid [data-tval="icon"]', "els => els.filter(e => e.querySelector('.tpl-rec')).map(e => e.dataset.v)")
    check("T1 recommended icons from Main Break", sorted(rec) == sorted(brk[1]), f"{rec} vs {brk[1]}")
    pg.click(f'[data-tval="icon"][data-v="{brk[1][0]}"]'); pg.wait_for_timeout(60)
    pg.click('[data-topen="icon2"]'); pg.wait_for_timeout(60)
    sub2 = pg.locator(f'[data-tval="icon2"][data-v="{brk[1][1]}"]')
    has_sub2 = sub2.count() > 0
    (sub2 if has_sub2 else pg.locator('[data-tval="icon2"][data-v="-"]')).click(); pg.wait_for_timeout(80)
    pg.click('[data-topen="main"]'); pg.wait_for_timeout(60)
    check("T1 recommended faction first", pg.locator('.tpl-fgrid [data-tval="main"]').first.get_attribute("data-v") == "Arayashiki" and pg.locator('.tpl-fgrid .tpl-rec').count() == 1)
    pg.click('[data-tval="main"][data-v="Arayashiki"]'); pg.wait_for_timeout(60); pg.click('[data-topen="sub"]'); pg.wait_for_timeout(60); pg.click('[data-tval="sub"][data-v="WIZ-DOM"]'); pg.wait_for_timeout(80)
    pg.click('[data-tnav="next"]'); pg.wait_for_timeout(150)
    check("T1 name + split Break steps", "TEMPLATE #1 FULL DECK" in pg.inner_text("#m-title").upper() and pg.locator(".tpl-steps li").nth(2).inner_text().endswith("Break · Charge") and pg.locator(".tpl-steps li").nth(3).inner_text().endswith("Break · Draw"))
    for sk in ("Charge", "Draw"):
        ok = pg.evaluate("""(()=>{const st=curStep(),L=breakCandidates(st);const pri=L.map(x=>x.g*10+breakPriority(x.c));
          return st.skill==='%s' && L.length>0 && L.every(x=>x.c.t==='Break'&&x.c.f==='Arayashiki'&&st.test(x.c)&&(x.g===0?x.c.cls.includes(tpl.icon):x.c.cls.includes(tpl.icon2)&&!x.c.cls.includes(tpl.icon))) && pri.every((p,i)=>i===0||pri[i-1]<=p)})()""" % sk)
        check(f"T1 Break · {sk}: main factor, icon sections, priority order", ok)
        check(f"T1 Break · {sk}: foldable main + sub icon sections + goal", pg.locator("details.tpl-sec").count() == (2 if has_sub2 else 1) and pg.locator(".tpl-goal").count() == 1)
        pg.click('[data-tnav="next"]'); pg.wait_for_timeout(150)
    secs = pg.eval_on_selector_all("details.tpl-sec > summary", "els => els.map(e => e.innerText)")
    check("T1 Permanent: main factor section, then sub factor", len(secs) == 2 and "Arayashiki" in secs[0] and "WIZ-DOM" in secs[1], str(secs))
    ok = pg.evaluate("(()=>{const L=searchCandidates(curStep());return L.every(x=>x.c.f===(x.g===0?'Arayashiki':'WIZ-DOM'))&&L.every((x,i)=>i===0||L[i-1].g<x.g||rarityRank(L[i-1].c.rarity)>=rarityRank(x.c.rarity))})()")
    check("T1 Permanent sections sorted rarest first", ok)
    pg.locator("details.tpl-sec > summary").first.click(); pg.wait_for_timeout(80)
    pg.locator("details.tpl-sec").nth(1).locator("[data-tcount='1']").first.click(); pg.wait_for_timeout(120)
    check("T1 folded section stays folded after re-render", pg.evaluate("!document.querySelector('details.tpl-sec').open") and pg.evaluate("deckNonCharacters()") == 5)
    pg.locator("details.tpl-sec > summary").first.click(); pg.wait_for_timeout(80)
    rk = pg.evaluate("searchCandidates(curStep()).slice(0,60).map(x=>rarityRank(x.c.rarity))")
    check("T1 Permanent cards only", pg.evaluate("searchCandidates(curStep()).every(x=>x.c.t==='Permanent')"))
    for i in range(9):
        en = pg.locator("[data-tfour]:not([disabled])")
        if en.count(): en.first.click(); pg.wait_for_timeout(40)
    check("T1 non-characters capped at 32", pg.evaluate("deckNonCharacters()") == 32, str(pg.evaluate("deckNonCharacters()")))
    pg.evaluate("tpl.step = curT().steps.length - 1; renderTemplate()"); pg.wait_for_timeout(100)
    check("T1 done summary", "within 28–32" in pg.inner_text(".tpl-done"))
    # Revise#226: the deck name is needed at Finish; default = the name-level name with the most copies
    nk = pg.evaluate("(()=>{const c=CARDS.filter(c=>c.named&&c.t==='Break'); const a=c[0], b=c.find(x=>x.jp.match(/“([^”]+)”/)[1]!==a.jp.match(/“([^”]+)”/)[1]); setCopies(a.k,1); setCopies(b.k,60); renderTemplate(); return b.jp.match(/“([^”]+)”/)[1].trim();})()")
    pg.wait_for_timeout(100)
    check("finish: deck name box, filled with the name-level name with the most copies", pg.input_value("#tplName") == nk, pg.input_value("#tplName") + " vs " + nk)
    pg.fill("#tplName", "   "); pg.click('[data-tnav="finish"]'); pg.wait_for_timeout(100)
    check("finish: an empty name is not accepted", pg.evaluate("!!tpl") and pg.locator("#tplName.bad").count() == 1)
    pg.fill("#tplName", "Pack Test Deck"); pg.click('[data-tnav="finish"]'); pg.wait_for_timeout(150)
    check("finish: the typed name is the deck name", pg.evaluate("tpl === null && deck.name") == "Pack Test Deck" and pg.input_value("#deckName") == "Pack Test Deck", pg.evaluate("deck.name"))

    # Revise#226: ▲ / ▼ beside each card's count on the deck board
    it0 = pg.locator("#cols .item").first
    k0 = it0.get_attribute("data-k"); n0 = pg.evaluate(f"keyCount({k0!r})")
    it0.locator("[data-act=inc]").click(); pg.wait_for_timeout(120)
    check("deck board: ▲ adds one copy", pg.evaluate(f"keyCount({k0!r})") == n0 + 1 and pg.locator(f'#cols .item[data-k="{k0}"] .qty').inner_text() == f"x {n0 + 1}")
    pg.locator(f'#cols .item[data-k="{k0}"] [data-act=dec]').click(); pg.wait_for_timeout(120)
    check("deck board: ▼ takes one copy away; the card panel does not open", pg.evaluate(f"keyCount({k0!r})") == n0 and pg.locator("#sheet").is_hidden())
    bb = pg.evaluate("(()=>{const i=document.querySelector('#cols .item'),q=i.querySelector('.qtyc').getBoundingClientRect(),r=i.getBoundingClientRect();return [q.right<=r.right+1, i.querySelectorAll('.qbtn').length]})()")
    check("deck board: the buttons sit with the count", bb == [True, 2], str(bb))

    # details panel, help, rules
    pg.locator("#cols .item").first.click(position={"x": 8, "y": 8}); pg.wait_for_timeout(200)
    check("details panel", not pg.locator("#sheet").is_hidden() and "category" in pg.inner_text("#sheet dl").lower())
    pg.evaluate("openCard(CARDS.find(c=>c.text&&c.textEn&&c.f))"); pg.wait_for_timeout(100)
    check("details: English text before Japanese", pg.evaluate("[...document.querySelector('#sheet .ctext').children].map(e=>e.lang).join()") == "en,ja")
    check("details: faction badge", pg.locator("#sheet dd .fbadge img.ficon").count() == 1)
    check("stat label Mental", "Mental" in pg.inner_text("#sheet .statgrid") and "精神力" not in pg.inner_text("#sheet .statgrid"))
    pg.keyboard.press("Escape")
    pg.click("#btnHelp"); pg.wait_for_timeout(300)
    check("help guide", pg.locator("#mbody .hsec").count() == 4)
    pg.keyboard.press("Escape")
    pg.click('[data-tab="rules"]'); pg.click('button[data-rlang="en"]')
    check("rules English only", pg.evaluate("getComputedStyle(document.querySelector('#r-battle .bi [lang=ja]')).display") == "none")
    pg.click('[data-tab="cards"]'); pg.wait_for_timeout(150)
    pg.evaluate("updateFilters(F=>Object.assign(F,emptyFilters()))"); pg.wait_for_timeout(100)
    if not pg.locator("#statrow").is_visible(): pg.click("#statsToggle")
    opts = pg.eval_on_selector_all("#st-ra option", "els => els.map(e => e.value).filter(v => v && v !== '__none')")
    check("rarity filter options ordered by rank", pg.evaluate(f"(()=>{{const o={opts!r};return o.length>8&&o.every((v,i)=>i===0||rarityRank(o[i-1])<=rarityRank(v))}})()"), str(opts))
    pg.select_option("#st-ra", "SR★★★"); pg.wait_for_timeout(150)
    check("rarity filter", pg.evaluate("PANES.cards.res.length>0&&PANES.cards.res.every(c=>c.rarity==='SR★★★')"))
    pg.select_option("#st-ra", ""); pg.click('.sbtn[data-sort="ra"]'); pg.click('.sbtn[data-sort="ra"]'); pg.wait_for_timeout(150)
    check("rarity sort (rarest first)", pg.evaluate("(()=>{const r=PANES.cards.res.slice(0,300).map(c=>rarityRank(c.rarity));return r[0]===60&&r.every((v,i)=>i===0||r[i-1]>=v)})()"))
    pg.evaluate("updateFilters(F=>Object.assign(F,emptyFilters()))")
    pg.click('[data-tab="changelog"]'); pg.wait_for_timeout(150)
    check("changelog tab", pg.locator("#p-changelog .clog").count() >= 10 and pg.locator("#p-changelog .clog.latest .cnew").count() == 1 and pg.locator(".searchrow").is_hidden())
    pg.reload(); pg.wait_for_timeout(500)
    check("changelog tab remembered", pg.locator("#p-changelog").is_visible())
    pg.click('[data-tab="rules"]'); pg.wait_for_timeout(100)
    check("state saved", pg.evaluate("JSON.parse(localStorage.getItem('aa-ui')).rlang") == "en")
    ctx.close()

    # ---- phone layout ----
    ctx = context(b, viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    m = open_page(ctx, NEW + "#cards", errors)
    for t in ("home", "cards", "rules", "deck", "table", "changelog"):
        m.click(f'.tabs [data-tab="{t}"]'); m.wait_for_timeout(150)
        check(f"phone width ok ({t})", m.evaluate("document.documentElement.scrollWidth") <= 390)
    m.click('.tabs [data-tab="cards"]'); m.wait_for_timeout(150)
    check("phone: filters start folded", m.locator("#fbox").is_hidden() and m.locator("#fToggle").is_visible())
    h_folded = m.evaluate("$('hdr').offsetHeight")
    m.click("#fToggle"); m.wait_for_timeout(100)
    check("phone: unfold filters", m.locator("#factBtn").is_visible() and m.evaluate("$('hdr').offsetHeight") > h_folded + 100)
    m.click('[data-fmode="side"]'); m.wait_for_timeout(250)
    check("sidebar mode: drawer open in body", m.evaluate("$('fbox').parentNode === document.body") and m.locator("#fbox").is_visible() and not m.locator("#fscrim").is_hidden())
    check("sidebar mode: header compact", m.evaluate("$('hdr').offsetHeight") <= h_folded + 2)
    m.click("#factBtn"); m.click('#fpanel [data-f="WIZ-DOM"]'); m.wait_for_timeout(150)
    check("sidebar: filter works + badge", m.evaluate("curF().f") == "WIZ-DOM" and m.inner_text("#fN") == "1")
    check("sidebar width ok", m.evaluate("document.documentElement.scrollWidth") <= 390)
    m.click("#fDone"); m.wait_for_timeout(100)
    check("sidebar closes", m.locator("#fbox").is_hidden() and m.locator("#fscrim").is_hidden())
    m.reload(); m.wait_for_timeout(500)
    check("sidebar mode remembered", m.evaluate("document.body.dataset.fmode") == "side" and m.locator("#fbox").is_hidden())
    m.click("#fToggle"); m.wait_for_timeout(150); m.keyboard.press("Escape"); m.wait_for_timeout(100)
    check("Escape closes sidebar", m.locator("#fbox").is_hidden())
    m.click("#fToggle"); m.click('[data-fmode="inline"]'); m.wait_for_timeout(100)
    check("back to inline", m.evaluate("$('fbox').parentNode.id") == "fhome" and m.locator("#fbox").is_visible())
    ctx.close()
    # ---- Home page (front page) and tabs ----
    ctx = context(b, viewport={"width": 1366, "height": 900})
    h = open_page(ctx, NEW, errors)
    check("no #tab: the Home page", h.evaluate("document.body.dataset.tab") == "home" and h.locator("#p-home .hcard").count() == 5)
    check("Home: the disclaimer (Revise#254)", h.locator("#p-home #disclaimer").is_visible() and "unofficial, non-profit fan project" in h.inner_text("#disclaimer") and "Broccoli / original illustrators" in h.inner_text("#disclaimer"))
    check("tabs: order and names", h.evaluate("[...document.querySelectorAll('.tabs [data-tab]')].map(b=>b.dataset.tab).join()") == "home,cards,rules,deck,table,changelog")
    h.click('[data-go="rules"]'); h.wait_for_timeout(150)
    check("Home button opens its tab", h.evaluate("document.body.dataset.tab") == "rules")
    h.goto(NEW + "#play/ABC123"); h.wait_for_timeout(400)
    check("old Play Online link → Game Table", h.evaluate("document.body.dataset.tab") == "table")
    ctx.close()

    b.close()

check("no page errors", not errors, "; ".join(errors[:3]))
print(f"{passed} passed, {len(failed)} failed")
for f in failed: print("  FAIL", f)
sys.exit(1 if failed else 0)
