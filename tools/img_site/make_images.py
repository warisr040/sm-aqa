#!/usr/bin/env python3
"""Aquarian Age Helper - build the card pictures site (Revise#398).

Downloads every card picture once from Google Drive, shrinks it to WebP and writes the
folder to upload to Cloudflare Pages:

    aqa-img/s/<fileId>.webp   short side 400 px  (lists, deck, game table)
    aqa-img/l/<fileId>.webp   short side 1000 px (the big card view)
    aqa-img/_headers          long browser cache + open to the site (CORS)

Run:   python make_images.py            (needs:  pip install pillow)
It can be stopped and run again: finished pictures are skipped.
Pictures that could not be downloaded are listed in failed.txt; run again to retry them.
"""
import argparse, io, os, random, sys, threading, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is missing. Run:  pip install pillow")

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCES = ["https://lh3.googleusercontent.com/d/{fid}=w1600", "https://drive.google.com/thumbnail?id={fid}&sz=w1600"]
SIZES = {"s": (400, 78), "l": (1000, 82)}          # folder: (short side in px, WebP quality)
UA = {"User-Agent": "Mozilla/5.0 (aqa-img builder)"}
lock = threading.Lock()
slow = [0.0]                                        # a shared pause after Google says "too many requests"


def fetch(fid, tries=6):
    err = None
    for n in range(tries):
        for url in SOURCES:
            time.sleep(slow[0] + random.random() * 0.2)
            try:
                with urllib.request.urlopen(urllib.request.Request(url.format(fid=fid), headers=UA), timeout=40) as r:
                    data = r.read()
                if len(data) > 2000:
                    slow[0] = max(0.0, slow[0] - 0.05)
                    return data
                err = "empty answer"
            except urllib.error.HTTPError as e:
                err = f"HTTP {e.code}"
                if e.code == 404: return None, "HTTP 404 (not shared or deleted)"
                if e.code in (403, 429): slow[0] = min(8.0, slow[0] + 1.0)
            except Exception as e:                  # time-out, network
                err = str(e)
        time.sleep(min(60, 2 ** n))
    return None, err


def one(fid, out):
    paths = {k: os.path.join(out, k, fid + ".webp") for k in SIZES}
    if all(os.path.exists(p) and os.path.getsize(p) > 500 for p in paths.values()): return "skip", None
    got = fetch(fid)
    if isinstance(got, tuple): return "fail", got[1]
    try:
        im = Image.open(io.BytesIO(got)); im.load()
        im = im.convert("RGB")
    except Exception as e:
        return "fail", f"not a picture ({e})"
    for k, (side, q) in SIZES.items():
        short = min(im.size); f = min(1.0, side / short)
        x = im if f >= 1 else im.resize((max(1, round(im.width * f)), max(1, round(im.height * f))), Image.LANCZOS)
        tmp = paths[k] + ".tmp"
        x.save(tmp, "WEBP", quality=q, method=6)
        os.replace(tmp, paths[k])
    return "ok", None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cards", default=os.path.join(HERE, "cards.txt"))
    ap.add_argument("--out", default=os.path.join(HERE, "aqa-img"))
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--limit", type=int, default=0, help="only the first N pictures (for a test)")
    a = ap.parse_args()
    fids = []
    for line in open(a.cards, encoding="utf-8"):
        f = line.split("\t")[0].strip()
        if f and not f.startswith("#") and f not in fids: fids.append(f)
    if a.limit: fids = fids[:a.limit]
    for k in SIZES: os.makedirs(os.path.join(a.out, k), exist_ok=True)
    open(os.path.join(a.out, "_headers"), "w", encoding="utf-8", newline="\n").write(
        "/s/*\n  Access-Control-Allow-Origin: *\n  Cache-Control: public, max-age=31536000, immutable\n"
        "/l/*\n  Access-Control-Allow-Origin: *\n  Cache-Control: public, max-age=31536000, immutable\n")
    open(os.path.join(a.out, "index.html"), "w", encoding="utf-8").write("<!doctype html><meta charset=utf-8><title>Card pictures</title><p>Card pictures for the Aquarian Age Helper.</p>\n")
    open(os.path.join(a.out, "robots.txt"), "w", encoding="utf-8").write("User-agent: *\nDisallow: /\n")
    done = {"ok": 0, "skip": 0, "fail": 0}; failed = []; t0 = time.time()

    def work(fid):
        try: res, why = one(fid, a.out)
        except Exception as e: res, why = "fail", str(e)
        with lock:
            done[res] += 1
            if res == "fail": failed.append(f"{fid}\t{why}")
            n = sum(done.values())
            if n % 25 == 0 or n == len(fids):
                print(f"\r{n}/{len(fids)}  new {done['ok']}  already there {done['skip']}  failed {done['fail']}  {int(time.time() - t0)} s ", end="", flush=True)

    with ThreadPoolExecutor(max_workers=max(1, a.workers)) as ex: list(ex.map(work, fids))
    open(os.path.join(HERE, "failed.txt"), "w", encoding="utf-8").write("\n".join(failed) + ("\n" if failed else ""))
    size = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(a.out) for f in fs)
    print(f"\nFolder: {a.out}  ({size / 1e6:.0f} MB, {sum(len(fs) for _, _, fs in os.walk(a.out))} files)")
    print("All pictures are ready." if not failed else f"{len(failed)} pictures failed - see failed.txt, then run this script again.")


if __name__ == "__main__":
    main()
