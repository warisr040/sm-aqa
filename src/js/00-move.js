/* ==========================================================================
   Site moved (Pack, Revise#326): aquarian-age-fs.netlify.app → sm-aqa.netlify.app.

   A browser keeps the Deck Builder slots (and the Game Table name / picture) per web address, so the decks
   saved on the old address are not seen on the new one. On the old address a bar offers "Move my decks":
   it opens the new address with the decks in the link (#move=…, nothing goes through a server); the new
   address asks before it replaces anything, then keeps them.
   ========================================================================== */
(() => {
  "use strict";
  const OLD_HOSTS = ["aquarian-age-fs.netlify.app"];
  const NEW_URL = "https://sm-aqa.netlify.app/";
  const KEYS = ["aa-decks", "aa-deck", "aa-slot", "aa-pname", "aa4-avatar", "aa4-avatar-up"];
  const enc = o => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const dec = s => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))));
  const raw = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const countDecks = list => (Array.isArray(list) ? list.filter(d => d && d.cols && Object.values(d.cols).some(c => (c || []).length)).length : 0);

  /* ---------- the old address: offer the move ---------- */
  if (OLD_HOSTS.includes(location.hostname)) {
    const bar = () => {
      if (document.getElementById("moveBar")) return;
      const n = countDecks(JSON.parse(raw("aa-decks") || "null"));
      const b = document.createElement("div");
      b.id = "moveBar";
      b.style.cssText = "position:sticky;top:0;z-index:200;display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap;padding:10px 14px;background:#ffd447;color:#231a00;font:600 15px system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4)";
      b.innerHTML = `<span>This site has moved to <b>sm-aqa.netlify.app</b>.${n ? ` Your ${n} deck${n > 1 ? "s" : ""} on this address can come with you.` : ""}</span>`
        + `<button type="button" id="moveGo" style="font:700 15px system-ui,sans-serif;padding:8px 16px;border-radius:10px;border:0;background:#231a00;color:#ffd447;cursor:pointer">${n ? "Move my decks to the new address" : "Go to the new address"}</button>`;
      document.body.prepend(b);
      document.getElementById("moveGo").onclick = () => {
        const data = {}; for (const k of KEYS) { const v = raw(k); if (v != null) data[k] = v; }
        location.href = NEW_URL + (n ? "#move=" + enc({ v: 1, data }) : "");
      };
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bar); else bar();
    return;
  }

  /* ---------- the new address: take the decks from the link ---------- */
  const m = /^#move=([A-Za-z0-9_-]+)$/.exec(location.hash);
  if (!m) return;
  let got = null; try { got = dec(m[1]); } catch (e) { got = null; }
  const done = msg => { history.replaceState(null, "", location.pathname + location.search); if (msg) alert(msg); location.reload(); };
  if (!got || !got.data) return done("The moved decks could not be read. Open the old address again and press “Move my decks”.");
  const theirs = countDecks(JSON.parse(got.data["aa-decks"] || "null")), mine = countDecks(JSON.parse(raw("aa-decks") || "null"));
  if (mine && !confirm(`Bring ${theirs} deck${theirs === 1 ? "" : "s"} from the old address?\n\nOK: they replace the ${mine} deck${mine === 1 ? "" : "s"} saved here (an overwritten deck can't be brought back).\nCancel: keep the decks here.`)) return done("");
  try { for (const [k, v] of Object.entries(got.data)) if (KEYS.includes(k) && typeof v === "string") localStorage.setItem(k, v); }
  catch (e) { return done("The decks could not be saved on this device (storage is blocked or full)."); }
  done(`${theirs} deck${theirs === 1 ? "" : "s"} moved from the old address.`);
})();
