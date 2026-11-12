#!/usr/bin/env node
/* ==========================================================================
   What the players do when they attack (Pack, Revise#376) — the numbers behind the bot's limits.
     node tools/bot_stats.js rooms.json [rows.json]
   rooms.json = Admin → Online rooms → "Download rooms (for the bot)". Every attack declaration is replayed: the power cards on
   the attacker's Controlled Characters, its Charge total, Offensive or not, a guard that could defeat it, and whether the
   attacker was still there after the battle. Players and the Bot (seat named "Bot" in a SOLOBOT room) are counted apart.
   attackPowerMin / attackChargeMin in src/engine/20-bot.js follow the players' lower quarter (25%).
   ========================================================================== */
const fs=require("fs"); const {AA4,DB}=require("./bot_lib.js");
const rooms=JSON.parse(fs.readFileSync(process.argv[2],"utf8")); const rows=[];
for(const [code,room] of Object.entries(rooms)){
  const entries=Object.entries(room.log).sort(([a],[b])=>a<b?-1:1).map(([k,e])=>Object.assign({id:k},e));
  const index=new Map(entries.map((e,i)=>[e.id,i])); for(let i=0;i<entries.length;i++){const e=entries[i]; if(["undo","redo","undoOk","undoNo"].includes(e.t)&&e.ofId) entries[i]=Object.assign({},e,{of:index.has(e.ofId)?index.get(e.ofId):-1});}
  const L=new AA4.GameLog(DB,{}); let open=[]; const botSeats=new Set(); let seatN=0;
  for(const e of entries){
    if(e.t==="join"){ if(code.startsWith("SOLOBOT")&&e.name==="Bot") botSeats.add(seatN); seatN++; }
    const S0=L.state;
    if(e.t==="declare"&&e.kind==="attack"&&S0.chars&&S0.chars[e.ch]){const ch=S0.chars[e.ch], seat=ch.owner, st=AA4.charStats(S0,DB,e.ch);
      const total=AA4.controlledOf(S0,seat).reduce((n,id)=>n+S0.chars[id].power.length,0);
      const opp=e.target&&e.target.seat!=null?e.target.seat:e.target&&S0.chars[e.target.ch]?S0.chars[e.target.ch].owner:null;
      const guards=opp==null?[]:AA4.controlledOf(S0,opp).filter(id=>!(S0.chars[id].flags&&S0.chars[id].flags.tapped));
      const risk=guards.some(id=>(+AA4.charStats(S0,DB,id).at||0)>=(+st.de||0));
      let charge=0; try{charge=+AA4.playerStats(S0,DB,seat).charge||0;}catch(x){}
      open.push({charge,code,turn:S0.turn.number,seat,bot:botSeats.has(seat),ch:e.ch,total,own:ch.power.length,at:st.at,de:st.de,off:st.skills.offensive!=null,onPlayer:!!(e.target&&e.target.seat!=null),guards:guards.length,risk,chars:AA4.controlledOf(S0,seat).length,myDmg:S0.players[seat].zones.damage.length,oppDmg:opp!=null?S0.players[opp].zones.damage.length:null});}
    const r=L.push(e); if(r&&r.ok===false) continue;
    const S1=L.state; if(open.length&&!S1.battle){ for(const o of open){ o.survived=!!S1.chars[o.ch]; rows.push(o);} open=[]; }
  }
}
if(process.argv[3]) fs.writeFileSync(process.argv[3],JSON.stringify(rows));
const H=rows.filter(r=>!r.bot), B=rows.filter(r=>r.bot);
const q=(a,p)=>{const s=a.slice().sort((x,y)=>x-y); return s.length?s[Math.min(s.length-1,Math.floor(p*s.length))]:null;};
const rep=(name,R)=>{ if(!R.length) return console.log(name,"none"); const t=R.map(r=>r.total);
  console.log(`${name}: ${R.length} attacks · total power min ${q(t,0)} · 10% ${q(t,.1)} · 25% ${q(t,.25)} · median ${q(t,.5)} · 75% ${q(t,.75)} · max ${q(t,.999)} · mean ${(t.reduce((a,b)=>a+b,0)/t.length).toFixed(1)}`);
  console.log(`   survived ${R.filter(r=>r.survived).length}/${R.length} · into a guard that could defeat it: ${R.filter(r=>r.risk).length} (survived ${R.filter(r=>r.risk&&r.survived).length}) · Offensive: ${R.filter(r=>r.off).length} (survived ${R.filter(r=>r.off&&r.survived).length}) · attacker's own power median ${q(R.map(r=>r.own),.5)} · first attack turn median ${q(Object.values(R.reduce((m,r)=>{const k=r.code+r.seat; m[k]=Math.min(m[k]||99,r.turn); return m;},{})),.5)}`);
  const hist={}; for(const r of R){const k=r.total>=10?"10+":String(r.total); hist[k]=(hist[k]||0)+1;} console.log("   total power → attacks:",JSON.stringify(hist)); };
rep("Players",H); rep("Players, attacker without Offensive",H.filter(r=>!r.off)); rep("Players, attacker with Offensive",H.filter(r=>r.off)); rep("Bot",B);
for(const [n,R] of [["Players",H],["Players without Offensive",H.filter(r=>!r.off)],["Bot",B]]){const c=R.map(r=>r.charge); const hist={}; for(const r of R){hist[r.charge]=(hist[r.charge]||0)+1;} console.log(n,"Charge at the attack: min",q(c,0),"10%",q(c,.1),"25%",q(c,.25),"median",q(c,.5),"75%",q(c,.75),"max",q(c,.999),JSON.stringify(hist));}
const died=H.filter(r=>!r.survived); console.log("Players' attackers that died:",died.map(r=>`T${r.turn} pw${r.total} chg${r.charge} off${r.off?1:0} risk${r.risk?1:0}`).join(" | "));
