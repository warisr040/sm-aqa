"""Shared page template: bright starry sky, rulebook-style pages, English / Thai switch."""

CSS = r"""
:root{
  --sky-deep:#1d4fc4; --sky:#3f8cf0; --sky-pale:#cfe6ff; --paper:#ffffff; --band:#eaf4ff;
  --ink:#14285a; --ink-soft:#44567f; --rule:#b9d3f2; --gold:#f0a012; --gold-pale:#fff3cf;
  --red:#d2233a; --red-pale:#fde9ec; --blue:#1f5fd0; --blue-pale:#e4eeff; --green:#1e8a55; --green-pale:#e3f6ec;
  color-scheme: light;
}
*{box-sizing:border-box}
body{margin:0;background:var(--sky-deep);color:var(--ink);font-family:"Sarabun","Noto Sans Thai",system-ui,sans-serif;font-size:16px;line-height:1.65;
  background-image:
   radial-gradient(1.6px 1.6px at 12% 8%,#fff 55%,transparent 60%),radial-gradient(1.2px 1.2px at 31% 22%,#fff 55%,transparent 60%),
   radial-gradient(2px 2px at 54% 6%,#fff 55%,transparent 60%),radial-gradient(1.3px 1.3px at 73% 18%,#fff 55%,transparent 60%),
   radial-gradient(1.8px 1.8px at 88% 9%,#fff 55%,transparent 60%),radial-gradient(1.2px 1.2px at 6% 30%,#fff 55%,transparent 60%),
   radial-gradient(1.5px 1.5px at 44% 34%,#fff 55%,transparent 60%),radial-gradient(1.1px 1.1px at 66% 40%,#fff 55%,transparent 60%),
   radial-gradient(2.2px 2.2px at 93% 33%,#fff 55%,transparent 60%),radial-gradient(1.3px 1.3px at 22% 46%,#fff 55%,transparent 60%),
   radial-gradient(60% 40% at 30% 0%,rgba(190,225,255,.75),transparent 70%),radial-gradient(50% 35% at 85% 12%,rgba(215,200,255,.5),transparent 70%),
   linear-gradient(180deg,#2a63d6 0%,#58a2f4 38%,#a9d3fb 72%,#dff0ff 100%);
  background-size:520px 520px,520px 520px,520px 520px,520px 520px,520px 520px,520px 520px,520px 520px,520px 520px,520px 520px,520px 520px,100% 900px,100% 900px,100% 100%;
  background-repeat:repeat,repeat,repeat,repeat,repeat,repeat,repeat,repeat,repeat,repeat,no-repeat,no-repeat,no-repeat;
  background-attachment:scroll}
.wrap{max-width:1040px;margin:0 auto;padding-block:20px 56px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:grid;gap:26px;counter-reset:page}
h1,h2,h3,h4,.kan{font-family:"Kanit","Sarabun",system-ui,sans-serif}
html[data-lang="en"] [lang="th"],html[data-lang="th"] [lang="en"]{display:none!important}

/* language switch */
.langbar{position:sticky;top:env(safe-area-inset-top,0px);z-index:5;display:flex;justify-content:flex-end;gap:8px;align-items:center;pointer-events:none}
.langbar .seg{pointer-events:auto;display:inline-flex;background:rgba(255,255,255,.92);border:1.5px solid var(--blue);border-radius:999px;padding:3px;box-shadow:0 4px 14px rgba(20,40,90,.25)}
.langbar{justify-content:space-between}
.langbar .backlink{pointer-events:auto;font:600 14px "Kanit",sans-serif;color:var(--blue);background:rgba(255,255,255,.92);border:1.5px solid var(--blue);border-radius:999px;padding:7px 16px;text-decoration:none;box-shadow:0 4px 14px rgba(20,40,90,.25)}
.langbar .backlink:hover,.langbar .backlink:focus-visible{background:var(--blue);color:#fff;outline:none}
.langbar .seg{margin-left:auto}
.langbar button{font:600 14px "Kanit",sans-serif;border:0;background:none;color:var(--blue);padding:5px 16px;border-radius:999px;cursor:pointer}
.langbar button[aria-pressed="true"]{background:var(--blue);color:#fff}
.langbar button:focus-visible{outline:3px solid var(--gold);outline-offset:2px}

/* pages */
.page{position:relative;background:var(--paper);border-radius:6px;box-shadow:0 10px 30px rgba(15,35,95,.35);overflow:hidden;counter-increment:page}
.page>.body{padding:22px 34px 20px}
.page>.foot{display:flex;justify-content:space-between;gap:12px;align-items:center;margin:0 34px;padding:8px 0 12px;border-top:1px solid var(--rule);font:500 11.5px "Kanit",sans-serif;letter-spacing:.14em;color:var(--ink-soft)}
.page>.foot::after{content:counter(page);font-size:14px;letter-spacing:0;color:#fff;background:var(--blue);min-width:30px;text-align:center;border-radius:4px;padding:1px 6px}

/* cover */
.cover{background:#0c1c5c}
.cover img{display:block;width:100%;height:auto}
.cover .ttl{padding:26px 34px 30px;text-align:center;color:#fff;
  background:radial-gradient(70% 120% at 50% 0%,#7fc0ff 0%,#3f8cf0 45%,#1d4fc4 100%)}
.cover .ttl .small{font:500 14px "Kanit",sans-serif;letter-spacing:.42em;text-transform:none;opacity:.95}
.cover .ttl h1{margin:6px 0 4px;font-size:clamp(30px,6vw,54px);line-height:1.12;font-weight:700;letter-spacing:.02em;text-shadow:0 2px 0 #1a3f9c,0 0 22px rgba(255,255,255,.55)}
.cover .ttl p{margin:0;font-size:17px}
.cover .ttl .ver{display:inline-block;margin-top:14px;background:#fff;color:var(--blue);font:600 13px "Kanit",sans-serif;padding:3px 14px;border-radius:4px}

/* contents */
.contents .body{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:26px;align-items:stretch}
.contents h2{margin:0 0 10px;font-size:30px;letter-spacing:.3em;color:var(--blue);font-weight:700;-webkit-text-stroke:0}
.contents ol{list-style:none;margin:0;padding:0;display:grid;gap:2px}
.contents li a{display:flex;align-items:baseline;gap:10px;padding:5px 2px;color:var(--ink);text-decoration:none;border-radius:4px}
.contents li a:hover,.contents li a:focus-visible{background:var(--blue-pale);outline:none}
.contents li .n{flex:none;font:600 12px "Kanit",sans-serif;color:#fff;background:var(--blue);border-radius:3px;padding:1px 8px;min-width:86px;text-align:center}
.contents li .t{font-weight:600}
.contents li .dots{flex:1;border-bottom:2px dotted var(--rule);transform:translateY(-4px);min-width:16px}
.contents .intro{margin:0 0 14px;color:var(--ink-soft)}
.contents figure{margin:0;border-radius:10px;overflow:hidden;box-shadow:0 6px 18px rgba(20,40,90,.3);border:3px solid #fff;outline:1.5px solid var(--rule)}
.contents figure img{display:block;width:100%;height:100%;object-fit:cover;object-position:35% 30%}

/* chapter header, as in the rulebook: starry band, number tab, title bar */
.chead{display:flex;align-items:stretch;gap:0;min-height:84px;color:#fff;
  background:
   radial-gradient(1.5px 1.5px at 18% 30%,#fff 55%,transparent 60%),radial-gradient(1.2px 1.2px at 42% 70%,#fff 55%,transparent 60%),
   radial-gradient(1.8px 1.8px at 67% 25%,#fff 55%,transparent 60%),radial-gradient(1.2px 1.2px at 86% 62%,#fff 55%,transparent 60%),
   radial-gradient(1.4px 1.4px at 95% 20%,#fff 55%,transparent 60%),radial-gradient(1.1px 1.1px at 55% 45%,#fff 55%,transparent 60%),
   linear-gradient(180deg,#3577e4 0%,#7fbdf8 70%,#cfe8ff 100%)}
.chead .num{flex:none;width:92px;display:grid;place-content:center;text-align:center;border-right:5px solid var(--ink);padding:6px 0}
.chead .num small{display:block;font:500 11px "Kanit",sans-serif;letter-spacing:.12em;color:#fff}
.chead .num b{font:700 46px/1 "Kanit",sans-serif;color:#fff;text-shadow:0 2px 0 #1a3f9c}
.chead h2{flex:1;align-self:end;margin:0 0 12px;padding:6px 18px;background:#fff;color:var(--ink);font-size:clamp(21px,3.4vw,28px);font-weight:600;line-height:1.25;border-bottom:4px solid var(--ink);border-top-right-radius:0;min-width:0}

/* body blocks */
.cols{columns:2 330px;column-gap:34px}
.cols>*{break-inside:avoid}
.body p{margin:0 0 10px}
.body h3{margin:16px 0 10px;padding:4px 16px;color:#fff;font-size:17px;font-weight:600;text-align:center;border-radius:999px;background:linear-gradient(180deg,#5ea5f5,#1f5fd0);box-shadow:inset 0 1px 0 rgba(255,255,255,.5)}
.body h3:first-child{margin-top:0}
.body h3,.body h4{break-after:avoid}
.body h4{margin:12px 0 4px;font-size:16px;font-weight:600;color:var(--ink);padding-left:10px;border-left:6px solid var(--blue)}
.body ul,.body ol{margin:0 0 10px;padding-left:22px}
.body li{margin:2px 0}
.body li::marker{color:var(--blue);font-weight:700}
.body code,.body kbd{font:500 .9em ui-monospace,Menlo,Consolas,monospace;background:var(--blue-pale);border-radius:4px;padding:1px 5px;overflow-wrap:anywhere}
.body kbd{background:#fff;border:1px solid var(--rule);border-bottom-width:2px;font-family:"Kanit",sans-serif}
.body a{color:var(--blue)}
.body kbd{white-space:nowrap}
td code{white-space:nowrap}
[lang="th"]{letter-spacing:0!important}
.contents h2 [lang="th"]{letter-spacing:.08em!important}
.box{border:2px solid var(--red);border-radius:6px;margin:12px 0;overflow:hidden;break-inside:avoid}
.box>b{display:block;background:var(--red);color:#fff;text-align:center;font:600 14px "Kanit",sans-serif;padding:2px 10px}
.box>div{padding:8px 12px;background:var(--red-pale)}
.box.blue{border-color:var(--blue)}.box.blue>b{background:var(--blue)}.box.blue>div{background:var(--blue-pale)}
.box.gold{border-color:var(--gold)}.box.gold>b{background:var(--gold);color:var(--ink)}.box.gold>div{background:var(--gold-pale)}
.box>div>:last-child{margin-bottom:0}
.tip{background:var(--green-pale);border-left:5px solid var(--green);padding:6px 12px;margin:10px 0;font-size:14.5px;break-inside:avoid}
.tw{overflow-x:auto;margin:10px 0;break-inside:avoid}
table{border-collapse:collapse;width:100%;font-size:14.5px}
th,td{border:1px solid var(--rule);padding:6px 9px;text-align:left;vertical-align:top}
th{background:var(--blue);color:#fff;font-family:"Kanit",sans-serif;font-weight:500}
tr:nth-child(even) td{background:var(--band)}
figure.shot{margin:12px 0;break-inside:avoid}
figure.shot img{display:block;width:100%;height:auto;border:2px solid var(--ink);border-radius:6px}
figure.shot figcaption{font-size:13px;color:var(--ink-soft);text-align:center;margin-top:4px}
.steps{list-style:none;padding:0;counter-reset:s}
.steps>li{counter-increment:s;position:relative;padding:2px 0 6px 40px;min-height:30px}
.steps>li::before{content:counter(s);position:absolute;left:0;top:1px;width:28px;height:28px;border-radius:50%;display:grid;place-content:center;background:var(--gold);color:var(--ink);font:700 15px "Kanit",sans-serif;box-shadow:0 0 0 2px #fff,0 0 0 3.5px var(--gold)}
.full{column-span:all}
svg.dia{display:block;width:100%;height:auto;max-width:900px;margin:6px auto 4px}
.diawrap{overflow-x:auto}
@media (max-width:720px){
  .page>.body{padding:16px 16px 14px}.page>.foot{margin:0 16px}
  .contents .body{grid-template-columns:1fr}.contents figure{order:-1;max-width:420px;margin:0 auto}.contents figure img{height:auto}
  .chead .num{width:70px}.chead .num b{font-size:36px}
  .contents li .n{min-width:74px}
}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
"""

JS = r"""
(function(){
  var root=document.documentElement, key='aa-doc-lang', lang='en';
  try{ lang=localStorage.getItem(key)||lang; }catch(e){}
  function set(l){ root.setAttribute('data-lang',l); root.setAttribute('lang',l);
    document.querySelectorAll('.langbar button').forEach(function(b){ b.setAttribute('aria-pressed', b.dataset.l===l); });
    try{ localStorage.setItem(key,l); }catch(e){} }
  document.querySelectorAll('.langbar button').forEach(function(b){ b.addEventListener('click',function(){ set(b.dataset.l); }); });
  set(lang==='th'?'th':'en');
})();
"""


def both(en, th, tag="span"):
    return f'<{tag} lang="en">{en}</{tag}><{tag} lang="th">{th}</{tag}>'


def build(out, title, kind_en, kind_th, sub_en, sub_th, ver, intro_en, intro_th, chapters, foot_en, foot_th, img="", back=None, full=False):
    """chapters: list of (id, title_en, title_th, html_en, html_th)"""
    toc = "".join(
        f'<li><a href="#{cid}"><span class="n">{both("Chapter " + str(i), "บทที่ " + str(i))}</span><span class="t">{both(te, tt)}</span><span class="dots"></span></a></li>'
        for i, (cid, te, tt, _, _) in enumerate(chapters, 1))
    pages = ""
    for i, (cid, te, tt, he, ht) in enumerate(chapters, 1):
        pages += f'''
<section class="page" id="{cid}">
  <header class="chead"><div class="num"><small>{both("Chapter", "บทที่")}</small><b>{i}</b></div><h2>{both(te, tt)}</h2></header>
  <div class="body"><div class="cols" lang="en">{he}</div><div class="cols" lang="th">{ht}</div></div>
  <div class="foot"><span>{both(foot_en, foot_th)}</span></div>
</section>'''
    html = f'''<title>{title}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Kanit:wght@500;600;700&family=Sarabun:wght@400;600;700&display=swap">
<style>{CSS}</style>
<div class="wrap">
  <div class="langbar">{('<a class="backlink" href="' + back[0] + '">' + both(back[1], back[2]) + '</a>') if back else ''}<div class="seg" role="group" aria-label="Language"><button type="button" data-l="en" aria-pressed="true">English</button><button type="button" data-l="th" aria-pressed="false">ไทย</button></div></div>
  <section class="page cover">
    <img src="{img}cover.jpg" alt="Aquarian Age Fan Site — the site banner: the logo on a starry sky above six card illustrations" width="1800" height="903">
    <div class="ttl"><div class="small">AQUARIAN AGE THAILAND FAN-SITE</div><h1>{both(kind_en, kind_th)}</h1><p>{both(sub_en, sub_th)}</p><span class="ver">{ver}</span></div>
  </section>
  <section class="page contents">
    <div class="body">
      <div><h2>{both("Contents", "สารบัญ")}</h2><p class="intro">{both(intro_en, intro_th)}</p><ol>{toc}</ol></div>
      <figure><img src="{img}contents.jpg" alt="A winged girl holding a blue orb and a pink orb under a starry sky" width="1100" height="682"></figure>
    </div>
    <div class="foot"><span>{both(foot_en, foot_th)}</span></div>
  </section>
  {pages}
</div>
<script>{JS}</script>
'''
    html = html.replace('src="shot-', 'src="' + img + 'shot-')
    if full:
        head, body = html.split("<div class=\"wrap\">", 1)
        html = ('<!doctype html>\n<html lang="en" data-lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
                '<link rel="icon" href="favicon.ico">\n' + head + '</head>\n<body>\n<div class="wrap">' + body + '</body>\n</html>\n')
    open(out, "w", encoding="utf-8").write(html)
    return len(html)
