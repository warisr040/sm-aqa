/* ==========================================================================
   v4 engine · event log (requirements_v4 §20.1 Transport, §16 "Event log replays the whole state")

   The log is the list of intents in the order the transport delivered them
   (Solo: this browser; Online: the shared room). The state is never sent —
   every device replays the same intents with the same seed and gets the same
   state. Refused intents stay in the log but change nothing.

   Undo / Redo (Q#03 b, as in v3): an {t:"undo", by, of: <index>} entry skips
   your latest action, allowed only while nobody else has acted since (chat
   doesn't count). {t:"redo", by, of: <index of the undo>} cancels your latest
   undo while only undo / redo happened after it. Whether an undo is valid is
   decided once, in log order, so every device agrees.

     const log = new AA4.GameLog(db, { debug: true });
     log.push({ t: "create", by: "A", seed: "x", mode: "online", seats: 2 });
     log.state          current state     log.results[i]   {ok, reason, events} of entry i
     log.undoTarget("A") / log.redoTarget("A")   index for an undo / redo entry, or -1
   ========================================================================== */
(function (G) {
  "use strict";
  const AA4 = G.AA4;
  const META = new Set(["undo", "redo", "undoOk", "undoNo"]);
  /* Undo agreement (Pack, Revise#112): an undo waits until every other player with Hold ON agrees ({t:"undoOk", by, of: <undo index>});
     {t:"undoNo"} refuses it. Hold OFF players are not asked. With the table rule respond = "order" they agree in turn order,
     with "together" in any order. Nobody to ask (Solo, or everyone else Hold OFF) → the undo happens at once, as before. */
  const voters = (S, e) => {
    if (S.stage !== "play" || S.mode !== "online") return [];
    const me = AA4.seatFor(S, e);
    return AA4.livingOrder(S).filter(s => s !== me && AA4.holdOn(S, s, "undo"));   // the "Undo" Hold switch (Pack, Revise#168)
  };
  /** Option changes (Pack, Revise#206): Hold, table rules, Game Situation. Undo / Redo pass over them — they are never undone and never block an undo. */
  AA4.OPTION_INTENTS = new Set(["hold", "rules", "situation", "sitHold"]);
  const quiet = e => e.t === "chat" || META.has(e.t) || AA4.OPTION_INTENTS.has(e.t);   // entries that don't count as "acting"
  /** Global Undo/Redo (Pack, Revise#190): with the table rule on, any player may undo / redo any player's latest action (watchers may not). */
  AA4.globalUndo = (S, by) => !!(S && S.rules && S.rules.globalUndo && AA4.seatsOfCid(S, by).length > 0);

  class GameLog {
    constructor(db, opts = {}) {
      this.db = db; this.opts = opts;
      this.entries = []; this.results = []; this.decided = new Map();   // undo / redo index → valid?
      this.undone = new Set(); this.activeUndo = new Set();
      this.state = AA4.newState();
    }
    static from(db, entries, opts) { const L = new GameLog(db, opts); L.entries = entries.map(e => Object.assign({}, e)); L.rebuild(); return L; }
    toJSON() { return { v: 1, entries: this.entries }; }

    /** Add one intent from the transport. Returns its result {ok, reason?, events}. */
    push(intent) {
      const e = AA4.clone(intent), i = this.entries.length;
      this.entries.push(e);
      if (META.has(e.t)) { this.rebuild(); return this.results[i]; }
      const r = this.safeStep(this.state, e);
      this.results.push(r);
      if (r.crashed) this.rebuild();   // a half-applied intent: replay without it
      return this.results[i];
    }

    safeStep(S, e) {
      try { return AA4.step(S, e, this.db, { debug: this.opts.debug }); }
      catch (err) {
        if (this.opts.debug || err instanceof AA4.InvariantError) throw err;
        return { ok: false, reason: "Engine error: " + err.message, events: [], crashed: true };
      }
    }

    /** Replay every entry from an empty state (after undo / redo, or a crash). */
    rebuild() {
      const crashed = new Set(this.results.map((r, i) => (r && r.crashed ? i : -1)).filter(i => i >= 0));
      for (;;) {
        const { undone, active } = this.undoneSet();
        const S = AA4.newState(), results = [], pend = new Map();
        let restart = false;
        for (let i = 0; i < this.entries.length; i++) {
          const e = this.entries[i];
          if (e.t === "undoOk" || e.t === "undoNo") {   // an answer to a waiting undo
            const p = pend.get(e.of), seat = AA4.seatFor(S, e);
            if (!this.decided.has(i)) {
              const next = p && p.voters.filter(s => !p.agreed.includes(s));
              const ok = !!p && next.includes(seat) && (S.rules.respond === "together" || next[0] === seat || e.t === "undoNo");
              this.decided.set(i, ok);
              if (ok && e.t === "undoNo") { this.decided.set(e.of, false); pend.delete(e.of); }
              if (ok && e.t === "undoOk") {
                p.agreed.push(seat);
                if (p.voters.every(s => p.agreed.includes(s))) {   // everyone agreed: the undo happens now, if nobody acted since
                  const good = this.lastAction(i, results, undone) === this.entries[e.of].of;
                  this.decided.set(e.of, good); pend.delete(e.of);
                  if (good) { restart = true; break; }
                }
              }
            } else if (this.decided.get(i) && p && e.t === "undoOk") p.agreed.push(seat);
            const ok = this.decided.get(i);
            results.push({ ok, reason: ok ? undefined : "Nothing to answer", events: [{ e: e.t, cid: e.by, of: e.of, ok }] });
            continue;
          }
          if (e.t === "undo" && !this.decided.has(i) && this.validUndo(i, results, undone, S) && voters(S, e).length) {
            pend.set(i, { voters: voters(S, e), agreed: [], by: e.by, of: e.of });   // waits for the others
            results.push({ ok: false, pending: true, reason: "Waiting for the other players to agree", events: [{ e: "undoAsked", cid: e.by, of: e.of }] });
            continue;
          }
          if (META.has(e.t)) {
            if (!this.decided.has(i)) {
              const ok = e.t === "undo" ? this.validUndo(i, results, undone, S) : this.validRedo(i, results, undone, active, S);
              this.decided.set(i, ok);
              if (ok) { restart = true; break; }   // the undone action is earlier in this replay: start again without it
            }
            const ok = this.decided.get(i);
            results.push({ ok, reason: ok ? undefined : `Nothing to ${e.t}`, events: [{ e: e.t, cid: e.by, of: e.of, ok }] });
            continue;
          }
          if (undone.has(i)) { results.push({ ok: false, undone: true, reason: "Undone", events: [] }); continue; }
          if (crashed.has(i)) { results.push({ ok: false, crashed: true, reason: "Engine error", events: [] }); continue; }
          const r = this.safeStep(S, e);
          if (r.crashed) { crashed.add(i); restart = true; break; }
          results.push(r);
        }
        if (restart) continue;
        this.state = S; this.results = results; this.undone = undone; this.activeUndo = active;
        const last = [...pend.keys()].pop();   // the waiting undo (the newest), for the table
        this.pendingUndo = last == null || this.lastAction(this.entries.length, results, undone) !== this.entries[last].of ? null : Object.assign({ at: last }, pend.get(last));
        return;
      }
    }

    /** Undone entries from the undo / redo decisions so far (in log order). */
    undoneSet() {
      const undone = new Set(), active = new Set();
      for (const i of [...this.decided.keys()].sort((a, b) => a - b)) {
        if (!this.decided.get(i)) continue;
        const e = this.entries[i];
        if (e.t === "undoOk" || e.t === "undoNo") continue;
        if (e.t === "undo") { undone.add(e.of); active.add(i); }
        else { active.delete(e.of); undone.delete(this.entries[e.of].of); }
      }
      return { undone, active };
    }
    /** The latest entry before `i` that did something (not chat / undo / redo / refused / undone). */
    lastAction(i, results, undone) {
      for (let k = i - 1; k >= 0; k--) {
        const e = this.entries[k];
        if (quiet(e) || undone.has(k) || !results[k] || !results[k].ok) continue;
        return k;
      }
      return -1;
    }
    validUndo(i, results, undone, S) {
      const e = this.entries[i], t = this.entries[e.of];
      return !!t && AA4.isInt(e.of) && e.of < i && (t.by === e.by || AA4.globalUndo(S, e.by)) && AA4.isUndoable(t.t) && this.lastAction(i, results, undone) === e.of;
    }
    validRedo(i, results, undone, active, S) {
      const e = this.entries[i], u = this.entries[e.of];
      if (!u || u.t !== "undo" || (u.by !== e.by && !AA4.globalUndo(S, e.by)) || !active.has(e.of)) return false;
      for (let k = e.of + 1; k < i; k++) {   // only undo / redo (or chat, or refused) since that undo
        const x = this.entries[k];
        if (quiet(x) || undone.has(k) || !results[k] || !results[k].ok) continue;
        return false;
      }
      return true;
    }

    /** Index your next undo would point at, or -1. */
    undoTarget(by) {
      if (this.pendingUndo) return -1;   // one undo at a time
      const k = this.lastAction(this.entries.length, this.results, this.undone);
      return k >= 0 && (this.entries[k].by === by || AA4.globalUndo(this.state, by)) && AA4.isUndoable(this.entries[k].t) ? k : -1;
    }
    /** Index of your latest undo that can be redone, or -1. */
    redoTarget(by) {
      for (let k = this.entries.length - 1; k >= 0; k--) {
        const x = this.entries[k];
        if (x.t === "chat" || x.t === "redo" || x.t === "undoOk" || x.t === "undoNo" || AA4.OPTION_INTENTS.has(x.t) || this.undone.has(k) || (!META.has(x.t) && !this.results[k].ok)) continue;
        if (x.t === "undo") { if ((x.by === by || AA4.globalUndo(this.state, by)) && this.activeUndo.has(k)) return k; continue; }
        return -1;
      }
      return -1;
    }

    /** Every game event so far, each with the index of the entry that caused it. */
    events() { return this.results.flatMap((r, i) => (r.events || []).map(ev => Object.assign({ at: i }, ev, { ix: i }))); }   // ix: always the entry index ("at" is also an event field, e.g. charNew's area)
  }
  AA4.GameLog = GameLog;

  /** Replay check (§20.10): the log replayed from scratch gives exactly the current state. */
  AA4.replayCheck = log => {
    const fresh = GameLog.from(log.db, log.entries, { debug: log.opts.debug });
    const a = JSON.stringify(fresh.state), b = JSON.stringify(log.state);
    return a === b ? null : "replayed state differs from the live state";
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
