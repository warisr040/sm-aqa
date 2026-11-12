// deck study: node deckstudy.js mirror|matrix out.json [games]
const fs=require("fs"); const {AA4,DB,PACK}=require("./bot_lib.js");
const S0=(process.env.BOT_DECKS_DIR||".")+"/";
const ex=JSON.parse(fs.readFileSync(S0+"extra_decks5.json","utf8"));
const pick=n=>ex.find(d=>d.name===n);
const decks=PACK.concat(["Seraphiel","ブレイブ","Cyborg Rider","Faris - Kuro"].map(pick)).filter(Boolean);
const NEW=AA4.botWeights(), OLD=Object.assign({},NEW,{attackPowerMin:0,attackChargeMin:0,attackStrike:0,setActiveMax:99,attackLoss:0});
function game(dA,dB,wA,wB,seed){
  const log=new AA4.GameLog(DB,{});
  log.push({t:"create",by:"P0",seed,mode:"online",seats:2,rules:{autoPay:true,autoSkip:true}});
  log.push({t:"join",by:"P0",name:"A",deck:dA.cards}); log.push({t:"join",by:"P1",name:"B",deck:dB.cards});
  const st=[0,1].map(()=>({attacks:0,lostBattle:0,lostOther:0,dmgN:0,dmgM:0,dmgBattle:0,dmgOther:0,mainTurn:null,sets:0}));
  const plan=[0,1].map(s=>{try{return AA4.botPlan(log.state,DB,s)[0]||null;}catch(e){return null;}});
  let steps=0,idle=0;
  const note=(r,S)=>{ for(const ev of (r.events||[])){
    if(ev.e==="attacked"&&ev.seat!=null&&ev.target&&(ev.target.seat==null||ev.target.seat!==ev.seat)) st[ev.seat].attacks++;
    if(ev.e==="defeated"&&ev.owner!=null){ if(ev.battle) st[ev.owner].lostBattle++; else st[ev.owner].lostOther++; }
    if(ev.e==="playerDamage"&&ev.seat!=null&&!ev.byHand){ const o=1-ev.seat, n=+ev.normal||0, m=+ev.mental||0; st[o].dmgN+=n; st[o].dmgM+=m; if(S.battle||ev.battle) st[o].dmgBattle+=n+m; else st[o].dmgOther+=n+m; }
  } };
  while(log.state.stage!=="over"&&steps<3000){ const S=log.state; let acted=false;
    for(const seat of [0,1]){ if(!AA4.botTurn(S,seat)&&S.stage!=="mulligan") continue; const it=AA4.botChoose(S,DB,seat,"P"+seat,{weights:seat===0?wA:wB,noise:0.15}); if(!it) continue; const r=log.push(it); steps++; if(r.ok){note(r,S);acted=true;break;} }
    if(!acted){ for(const seat of [0,1]){ const c=AA4.candidates(log.state,DB,"P"+seat,seat,{}).find(x=>x.t==="pass"||x.t==="next"||x.t==="noGuard"); if(c){const r=log.push(c); if(r.ok){note(r,S);acted=true;steps++;break;}} } }
    if(!acted&&++idle>5) break; if(acted) idle=0;
    if(steps%8===0){ const S2=log.state; for(const s of [0,1]) if(plan[s]&&st[s].mainTurn==null&&AA4.charsOf(S2,s).some(id=>S2.chars[id].stack.some(c=>(DB.card(S2.cards[c].key)||{}).name===plan[s].name&&(DB.card(S2.cards[c].key)||{}).type==="Break"))) st[s].mainTurn=S2.turn.number; }
  }
  const S=log.state, alive=AA4.living(S), dmg=S.players.map(p=>p.zones.damage.length);
  const winner=S.stage==="over"&&alive.length===1?alive[0]:(dmg[0]!==dmg[1]?(dmg[0]>dmg[1]?1:0):null);
  return {winner,decided:S.stage==="over",turns:S.turn.number,dmg,st,plan:plan.map(p=>p&&p.name)};
}
const mode=process.argv[2], out=process.argv[3], N=+process.argv[4]||10, part=+process.argv[5]||0, parts=+process.argv[6]||1; const rows=[]; let k=0;
if(mode==="info"){ for(const d of decks){ const log=new AA4.GameLog(DB,{}); log.push({t:"create",by:"P0",seed:"i"+d.name,mode:"online",seats:2,rules:{}}); log.push({t:"join",by:"P0",name:"A",deck:d.cards}); log.push({t:"join",by:"P1",name:"B",deck:d.cards});
  const inf=d.cards.map(c=>DB.card(c)||{}); const ch=inf.filter(c=>c.type==="Character"), br=inf.filter(c=>c.type==="Break"); const avg=(a,f)=>a.length?(a.reduce((n,c)=>n+(+c[f]||0),0)/a.length).toFixed(1):"-";
  const pl=AA4.botPlan(log.state,DB,0).slice(0,3).map(p=>`${p.en||p.name}(cost ${p.cost}, ${p.role}, x${p.copies})`);
  const fac={}; for(const c of inf) fac[c.faction]=(fac[c.faction]||0)+1;
  console.log(`${d.name}: main factor ${AA4.botMainFactor(log.state,DB,0)} · factions ${JSON.stringify(fac)} · Character ${ch.length} (avg ${avg(ch,"se")}/${avg(ch,"at")}/${avg(ch,"de")}) · Break ${br.length} (avg ${avg(br,"se")}/${avg(br,"at")}/${avg(br,"de")}, named ${br.filter(c=>c.name).length}) · Fast ${inf.filter(c=>c.type==="Fast").length} · Project ${inf.filter(c=>c.type==="Project").length} · Permanent ${inf.filter(c=>c.type==="Permanent").length} · top: ${pl.join("; ")}`); } process.exit(0); }
if(mode==="mirror"){ for(const d of decks) for(let g=0;g<N;g++){ if((k++)%parts!==part) continue; const newSeat=g%2; const r=game(d,d,newSeat===0?NEW:OLD,newSeat===0?OLD:NEW,"mir-"+d.name+g); rows.push({deck:d.name,newSeat,r}); fs.writeFileSync(out,JSON.stringify(rows)); } }
if(mode==="matrix"){ for(let i=0;i<decks.length;i++) for(let j=0;j<decks.length;j++){ if(i===j) continue; for(let g=0;g<N;g++){ if((k++)%parts!==part) continue; const r=game(decks[i],decks[j],NEW,NEW,"mx-"+i+"-"+j+"-"+g); rows.push({a:decks[i].name,b:decks[j].name,r}); fs.writeFileSync(out,JSON.stringify(rows)); } } }
console.log("done",rows.length);
