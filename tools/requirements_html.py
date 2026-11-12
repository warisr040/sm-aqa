#!/usr/bin/env python3
"""docs/requirements_v4.md → docs/requirements_v4.html (one self-contained page).

    python3 tools/requirements_html.py            (also run by build.py)

The .md stays the file that is edited (Pack's text + Claude's {Revise#NNN} lines); the
HTML is only a nicer way to read it: contents list, Pack's text and Claude's additions in
different colours, links between Revise / Q tags, search, and filters
(All · Pack's text · Claude's additions · Questions).

Format of the .md that this reads (plain text, tab-indented):
  "12. Effect System"            section (no tab)        "\t20.3 One pipeline…"  sub-section
  "\t1. …" / "\t\t2. …"          Pack's items (tabs = level)
  "\t→ {Revise#045} …"           Claude's addition       "\t   …" (3+ spaces)    continuation of the line above
  "\t   | a | b |"               table row               "Q#07 [ANSWERED → …] …" question (section 19)
  "=====" / "-----"              separators (ignored; sections are headings)
"""
import html, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC, OUT = ROOT / "docs" / "requirements_v4.md", ROOT / "docs" / "requirements_v4.html"

INLINE = re.compile(
    r"(?P<rvtag>\{Revise#(?P<rvn>\d+)\})"
    r"|(?P<qtag>\{Q#(?P<qn>\d+)\})"
    r"|(?P<status>\[(?P<st>ANSWERED|RE-ASKED)(?P<stx>[^\]]*)\])"
    r"|(?P<rvref>(?<![\w#])Revise#(?P<rrn>\d+))"
    r"|(?P<qref>(?<![\w#])Q#(?P<qrn>\d+))"
    r"|(?P<prev>\(prev(?: v[\d.]+)?\))"
    r"|(?P<same>\*\s?(?:Make it the same as previous version|Same as previous version))")


def inline(text, lead=False):
    """Escape and mark up one line. lead=True: a leading {Revise#N} becomes the block's anchor badge."""
    out, pos, first = [], 0, True
    for m in INLINE.finditer(text):
        out.append(html.escape(text[pos:m.start()]))
        pos = m.end()
        if m["rvtag"]:
            n = m["rvn"]
            out.append(f'<a class="rv" id="r-{n}" href="#r-{n}">Revise#{n}</a>' if lead and first and m.start() <= 2
                       else f'<a class="ref rvl" href="#r-{n}">Revise#{n}</a>')
        elif m["qtag"]:
            out.append(f'<a class="ref ql" href="#q-{m["qn"]}">Q#{m["qn"]}</a>')
        elif m["status"]:
            cls = "ok" if m["st"] == "ANSWERED" else "warn"
            out.append(f'<span class="st {cls}">{m["st"].lower().replace("-", " ")}</span>'
                       + (f'<span class="stx">{inline(m["stx"].lstrip(" →").strip())}</span>' if m["stx"].strip() else ""))
        elif m["rvref"]:
            out.append(f'<a class="ref rvl" href="#r-{m["rrn"]}">Revise#{m["rrn"]}</a>')
        elif m["qref"]:
            out.append(f'<a class="ref ql" href="#q-{m["qrn"]}">Q#{m["qrn"]}</a>')
        elif m["prev"]:
            out.append(f'<span class="chip prev" title="How the previous version (v3) did it">{html.escape(m["prev"][1:-1])}</span>')
        elif m["same"]:
            out.append('<span class="chip same">same as previous version</span>')
        first = False
    out.append(html.escape(text[pos:]))
    return "".join(out)


def parse(lines):
    """Lines → list of blocks: {kind: title|h2|h3|item|revise|question|note, level, lines: [(indent, text)], rows, sec}."""
    blocks, cur, sec = [], None, "top"
    for i, raw in enumerate(lines):
        if i == 0:
            blocks.append({"kind": "title", "text": raw.strip()}); continue
        if not raw.strip() or re.fullmatch(r"[=\-]{10,}", raw.strip()):
            if not raw.strip() and cur and cur["kind"] in ("item", "revise", "note"): cur = None
            continue
        tabs = len(raw) - len(raw.lstrip("\t"))
        rest = raw[tabs:]
        spaces = len(rest) - len(rest.lstrip(" "))
        text = rest.strip()
        if tabs == 0 and spaces == 0 and (re.match(r"\d+\.\s", text) or text in ("Requirements:", "How to read this file")):
            m = re.match(r"(\d+)\.\s", text)
            sec = f"s-{m.group(1)}" if m else ("s-req" if text.startswith("Req") else "s-read")
            cur = {"kind": "h2", "text": text.rstrip(":"), "id": sec, "sec": sec}
            blocks.append(cur); cur = None; continue
        if tabs == 1 and spaces == 0 and re.match(r"20\.\d+\s", text):
            hid = "s-" + text.split()[0].replace(".", "-")
            blocks.append({"kind": "h3", "text": text, "id": hid, "sec": sec}); cur = None; continue
        if text.startswith("|"):
            cells = [c.strip() for c in text.strip("|").split("|")]
            if cur is None: cur = {"kind": "note", "level": tabs, "lines": [], "rows": [], "sec": sec}; blocks.append(cur)
            cur.setdefault("rows", []).append(cells); continue
        if spaces >= 2 and cur is not None:
            cur["lines"].append((spaces - 3 if spaces > 3 else 0, text)); continue
        if spaces >= 2:   # continuation right after a heading: its own paragraph
            cur = {"kind": "note", "level": tabs, "lines": [(max(0, spaces - 3), text)], "sec": sec}; blocks.append(cur); continue
        if text.startswith("→ {Revise#"):
            kind = "revise"
        elif re.match(r"Q#\d+\s", text) and sec == "s-19":
            kind = "question"
        elif tabs == 0 and text.startswith("- "):
            kind = "note"
        else:
            kind = "item"
        cur = {"kind": kind, "level": tabs, "lines": [(0, text)], "sec": sec}
        blocks.append(cur)
    return blocks


def render_block(b):
    if b["kind"] == "title": return ""
    if b["kind"] == "h2": return f'<h2 id="{b["id"]}" data-sec="{b["sec"]}">{inline(b["text"])}</h2>'
    if b["kind"] == "h3": return f'<h3 id="{b["id"]}" data-sec="{b["sec"]}">{inline(b["text"])}</h3>'
    cls, attrs, body = ["blk", b["kind"]], [f'data-sec="{b["sec"]}"', f'style="--lvl:{min(b["level"], 4)}"'], []
    for n, (ind, text) in enumerate(b["lines"]):
        if b["kind"] == "revise" and n == 0: text = text[1:].lstrip()   # drop the "→"
        if b["kind"] == "question" and n == 0:
            m = re.match(r"Q#(\d+)\s+(.*)", text)
            attrs.append(f'id="q-{m.group(1)}"')
            if not re.search(r"\[(ANSWERED|RE-ASKED)", text): cls.append("open")   # re-asked = replaced by a newer question
            body.append(f'<div class="ln"><a class="qid" href="#q-{m.group(1)}">Q#{m.group(1)}</a> {inline(m.group(2))}</div>')
            continue
        lead = b["kind"] == "revise" and n == 0
        pad = f' style="padding-left:{ind * 0.55:.2f}em"' if ind else ""
        mono = " diag" if re.search(r"[─▶◀│↓]", text) else ""
        body.append(f'<div class="ln{mono}"{pad}>{inline(text, lead)}</div>')
    if b.get("rows"):
        head, *rows = b["rows"]
        body.append('<div class="tw"><table><thead><tr>' + "".join(f"<th>{inline(c)}</th>" for c in head) + "</tr></thead><tbody>"
                    + "".join("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>" for r in rows) + "</tbody></table></div>")
    if b["kind"] == "revise": cls.append("by-claude")
    elif b["kind"] in ("item",): cls.append("by-pack")
    return f'<div class="{" ".join(cls)}" {" ".join(attrs)}>{"".join(body)}</div>'


CSS = """.mstab{overflow-x:auto;margin:.4em 0 1em}.mstab table{border-collapse:collapse;font-size:.92em;min-width:560px}
.mstab th,.mstab td{border:1px solid var(--line,#8884);padding:.3em .55em;text-align:left;vertical-align:middle}.mstab td.n{text-align:right;font-variant-numeric:tabular-nums}
.mstab .bar{display:inline-block;width:90px;height:.6em;border-radius:3px;background:#8883;vertical-align:middle;overflow:hidden}.mstab .bar i{display:block;height:100%;background:#3a9d5d}
.mstab .st{padding:.05em .45em;border-radius:9px;font-size:.88em;font-weight:600}.st-done{background:#3a9d5d33;color:#2d8a4e}.st-next{background:#e0a10033;color:#b07a00}.st-doing{background:#3b7ddd33;color:#2f6ac0}.st-planned{background:#8882}
.mstab td:nth-child(5){white-space:nowrap}.mstab tr.ms-next td{background:#e0a1000f}.mstab .z{color:#2d8a4e;font-weight:600}

:root{--bg:#f7f6f2;--panel:#fff;--ink:#1f2328;--muted:#646c76;--line:#e3e0d8;--pack:#1f2328;--claude:#8a4b0f;--claude-bg:#fdf3e6;--claude-bd:#efc994;
--q:#245fae;--q-bg:#eaf1fb;--ok:#1e7a46;--ok-bg:#e5f4ea;--warn:#9a6200;--warn-bg:#fdf1d8;--chip:#efece4;--mark:#ffe58a;--accent:#245fae}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#15171b;--panel:#1d2026;--ink:#e6e6e3;--muted:#9aa1ab;--line:#2d3139;--pack:#e6e6e3;
--claude:#f1b26a;--claude-bg:#2a2117;--claude-bd:#5a4223;--q:#8ab4f8;--q-bg:#1c2738;--ok:#7ad19b;--ok-bg:#16291e;--warn:#f0c060;--warn-bg:#2d2513;--chip:#2a2e35;--mark:#6b5a12;--accent:#8ab4f8}}
:root[data-theme="dark"]{--bg:#15171b;--panel:#1d2026;--ink:#e6e6e3;--muted:#9aa1ab;--line:#2d3139;--pack:#e6e6e3;
--claude:#f1b26a;--claude-bg:#2a2117;--claude-bd:#5a4223;--q:#8ab4f8;--q-bg:#1c2738;--ok:#7ad19b;--ok-bg:#16291e;--warn:#f0c060;--warn-bg:#2d2513;--chip:#2a2e35;--mark:#6b5a12;--accent:#8ab4f8}
*{box-sizing:border-box}html{scroll-padding-top:110px}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 system-ui,-apple-system,"Segoe UI","Noto Sans JP","Hiragino Sans","Yu Gothic",sans-serif}
a{color:var(--accent)}
header{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:blur(6px);border-bottom:1px solid var(--line)}
.hd{max-width:1240px;margin:0 auto;padding:12px 16px;display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center}
.hd h1{font-size:17px;margin:0;font-weight:650;flex:1 1 320px}
.stats{display:flex;gap:6px;flex-wrap:wrap;font-size:12.5px}
.stats span{background:var(--chip);border-radius:999px;padding:2px 10px;color:var(--muted)}
.tools{max-width:1240px;margin:0 auto;padding:0 16px 10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.tools input{flex:1 1 220px;min-width:0;font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--ink)}
.seg{display:flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;flex-wrap:wrap}
.seg button{font:inherit;font-size:13px;border:0;background:var(--panel);color:var(--ink);padding:6px 11px;cursor:pointer;border-right:1px solid var(--line)}
.seg button:last-child{border-right:0}.seg button[aria-pressed="true"]{background:var(--accent);color:var(--bg)}
.wrap{max-width:1240px;margin:0 auto;padding:16px;display:grid;grid-template-columns:250px minmax(0,1fr);gap:28px}
nav{position:sticky;top:112px;align-self:start;max-height:calc(100vh - 130px);overflow:auto;font-size:13.5px;padding-right:6px}
nav a{display:block;color:var(--muted);text-decoration:none;padding:3px 8px;border-radius:6px;line-height:1.35}
nav a:hover{background:var(--chip);color:var(--ink)}nav a.sub{padding-left:22px;font-size:12.5px}
main{min-width:0;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:8px 28px 40px}
h2{font-size:19px;margin:30px 0 10px;padding-top:12px;border-top:1px solid var(--line)}main>h2:first-of-type{border-top:0}
h3{font-size:15.5px;margin:22px 0 6px;color:var(--ink)}
.blk{margin:6px 0 6px calc(var(--lvl) * 1.4em);padding:4px 10px;border-left:3px solid transparent;border-radius:4px}
.blk.by-pack{border-left-color:var(--line)}
.blk.note{color:var(--muted)}
.blk.revise{background:var(--claude-bg);border:1px solid var(--claude-bd);border-left:3px solid var(--claude);padding:8px 12px;margin-top:8px;margin-bottom:8px}
.blk.question{background:var(--q-bg);border-left-color:var(--q);margin-left:0}.blk.question.open{border-left-color:var(--warn);background:var(--warn-bg)}
.ln{white-space:pre-wrap;overflow-wrap:anywhere}.ln+.ln{margin-top:2px}
.ln.diag{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;white-space:pre}
.blk.revise .ln.diag,.blk.note .ln.diag,.blk .ln.diag{overflow-x:auto}
.rv{font-weight:650;color:var(--claude);text-decoration:none;margin-right:4px;font-size:13px;background:var(--panel);border:1px solid var(--claude-bd);border-radius:6px;padding:0 6px}
.ref{text-decoration:none;font-size:.92em;border-radius:5px;padding:0 3px}.rvl{color:var(--claude)}.ql{color:var(--q);background:var(--q-bg)}
.ref:hover{text-decoration:underline}
.qid{font-weight:700;color:var(--q);text-decoration:none;margin-right:4px}
.st{font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;border-radius:5px;padding:1px 6px;margin-right:6px;font-weight:650}
.st.ok{background:var(--ok-bg);color:var(--ok)}.st.warn{background:var(--warn-bg);color:var(--warn)}.stx{color:var(--muted);margin-right:6px}
.stx::before{content:"→ "}
.chip{font-size:11.5px;border-radius:999px;padding:1px 8px;background:var(--chip);color:var(--muted);white-space:nowrap}
.tw{overflow-x:auto;margin:8px 0 4px}
table{border-collapse:collapse;font-size:13.5px;width:100%;background:var(--panel)}
th,td{border:1px solid var(--line);padding:5px 8px;text-align:left;vertical-align:top}th{background:var(--chip)}
:target{box-shadow:0 0 0 2px var(--accent);border-radius:6px}
mark{background:var(--mark);color:inherit;border-radius:2px}
.hide{display:none!important}
.empty{color:var(--muted);padding:30px 0;text-align:center}
.theme{font:inherit;font-size:13px;border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:8px;padding:5px 10px;cursor:pointer}
footer{color:var(--muted);font-size:12.5px;text-align:center;padding:10px 16px 30px}
@media (max-width:860px){.wrap{grid-template-columns:1fr;padding:12px 0}nav{display:none}main{border-radius:0;border-left:0;border-right:0;padding:4px 16px 30px}
.blk{margin-left:calc(var(--lvl) * .7em)}html{scroll-padding-top:12px}
.hd{padding:8px 16px 6px;gap:6px}.hd h1{font-size:14.5px;flex-basis:100%}.stats{font-size:11.5px}.theme{font-size:12px;padding:3px 8px;margin-left:auto}
.tools{flex-wrap:nowrap;flex-direction:column;align-items:stretch;gap:6px;padding-bottom:8px}.tools input{flex:none;padding:5px 9px}
.seg{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}.seg button{white-space:nowrap;font-size:12.5px;padding:5px 10px}
header{position:static}}
"""

JS = r"""
(function(){
  const blocks=[...document.querySelectorAll('main .blk')], heads=[...document.querySelectorAll('main h2, main h3')];
  const q=document.getElementById('q'), empty=document.getElementById('empty');
  let filter='all';
  const orig=new Map(blocks.map(b=>[b,b.innerHTML]));
  function esc(s){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}
  function mark(el,re){ // highlight text nodes only
    const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),nodes=[];while(w.nextNode())nodes.push(w.currentNode);
    for(const n of nodes){const t=n.nodeValue;if(!re.test(t))continue;re.lastIndex=0;const f=document.createDocumentFragment();let p=0,m;
      while((m=re.exec(t))){f.append(t.slice(p,m.index));const k=document.createElement('mark');k.textContent=m[0];f.append(k);p=m.index+m[0].length;}
      f.append(t.slice(p));n.replaceWith(f);}
  }
  function apply(){
    const term=q.value.trim(), re=term?new RegExp(esc(term),'gi'):null, shown=new Set();
    for(const b of blocks){
      b.innerHTML=orig.get(b);
      let ok=filter==='all'||(filter==='pack'&&!b.classList.contains('revise')&&!b.classList.contains('question'))
        ||(filter==='claude'&&b.classList.contains('revise'))||(filter==='questions'&&b.classList.contains('question'))
        ||(filter==='open'&&b.classList.contains('question')&&b.classList.contains('open'));
      if(ok&&re){re.lastIndex=0;ok=re.test(b.textContent);if(ok)mark(b,new RegExp(esc(term),'gi'));}
      b.classList.toggle('hide',!ok); if(ok)shown.add(b.dataset.sec);
    }
    const plain=filter==='all'&&!term;
    for(const h of heads) h.classList.toggle('hide',!plain&&!shown.has(h.dataset.sec));
    empty.classList.toggle('hide',shown.size>0);
  }
  document.querySelectorAll('.seg button').forEach(btn=>btn.addEventListener('click',()=>{
    filter=btn.dataset.f;document.querySelectorAll('.seg button').forEach(b=>b.setAttribute('aria-pressed',b===btn));apply();}));
  q.addEventListener('input',apply);
  document.getElementById('theme').addEventListener('click',()=>{const r=document.documentElement;
    const dark=r.dataset.theme?r.dataset.theme==='dark':matchMedia('(prefers-color-scheme: dark)').matches;r.dataset.theme=dark?'light':'dark';
    try{localStorage.setItem('req-theme',r.dataset.theme)}catch(e){}});
  try{const t=localStorage.getItem('req-theme');if(t)document.documentElement.dataset.theme=t}catch(e){}
  document.addEventListener('click',e=>{const a=e.target.closest('a[href^="#"]');if(!a)return;const el=document.getElementById(a.getAttribute('href').slice(1));
    if(el&&el.classList.contains('hide')){q.value='';filter='all';document.querySelectorAll('.seg button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.f==='all'));apply();}});
})();
"""


def main(src=SRC, out=OUT, extra=None):
    text = src.read_text(encoding="utf-8")
    blocks = parse(text.splitlines())
    title = blocks[0]["text"]
    revs = sum(1 for b in blocks if b["kind"] == "revise")
    qs = [b for b in blocks if b["kind"] == "question"]
    open_q = sum(1 for b in qs if not re.search(r"\[(ANSWERED|RE-ASKED)", b["lines"][0][1]))
    toc = "".join(f'<a class="{"sub" if b["kind"] == "h3" else ""}" href="#{b["id"]}">{html.escape(b["text"])}</a>'
                  for b in blocks if b["kind"] in ("h2", "h3"))
    body = "\n".join(render_block(b) for b in blocks)
    for k, v in (extra or {}).items():   # generated parts (e.g. the milestone sheet from build.py): "@@KEY@@" on a line of its own
        body = body.replace('<div class="ln">@@' + k + '@@</div>', v)
    # Revise tags written inside a line (e.g. "(Revise#068, Q#23)" in the skill table): the first mention is the anchor
    for n in sorted(set(re.findall(r'href="#r-(\d+)"', body)) - set(re.findall(r'id="r-(\d+)"', body))):
        body = body.replace(f'<a class="ref rvl" href="#r-{n}">', f'<a class="ref rvl" id="r-{n}" href="#r-{n}">', 1)
    page = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Requirements v4</title><style>{CSS}</style></head>
<body>
<header><div class="hd"><h1>{html.escape(title)}</h1>
<div class="stats"><span>{revs} Revise notes</span><span>{len(qs)} questions · {"all answered" if not open_q else f"{open_q} open"}</span></div>
<button class="theme" id="theme" type="button">Light / dark</button></div>
<div class="tools"><input id="q" type="search" placeholder="Search (English or Japanese)…" aria-label="Search">
<div class="seg" role="group" aria-label="Show"><button data-f="all" aria-pressed="true">All</button><button data-f="pack" aria-pressed="false">Pack's text</button>
<button data-f="claude" aria-pressed="false">Claude's additions</button><button data-f="questions" aria-pressed="false">Questions</button><button data-f="open" aria-pressed="false">Open questions</button></div></div>
</header>
<div class="wrap"><nav aria-label="Contents">{toc}</nav>
<main>{body}<div id="empty" class="empty hide">Nothing matches.</div></main></div>
<footer>Made from docs/requirements_v4.md by tools/requirements_html.py — edit the .md, then run python3 build.py.</footer>
<script>{JS}</script></body></html>"""
    out.write_text(page, encoding="utf-8")
    return revs, len(qs), open_q


if __name__ == "__main__":
    r, q, o = main(*(map(Path, sys.argv[1:3]) if len(sys.argv) > 2 else ()))
    print(f"{OUT.relative_to(ROOT)}: {r} Revise notes, {q} questions ({o} open)")
