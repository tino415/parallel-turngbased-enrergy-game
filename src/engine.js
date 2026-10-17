"use strict";
// Pure, browser-independent map and economy functions.
function seeded(seed){let h=2166136261;for(const c of String(seed)){h=Math.imul(h^c.charCodeAt(0),16777619)}return ()=>{h+=0x6D2B79F5;let t=h;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296}}

function buildMap({count,players,density,seed}){
 const random=seeded(seed),columns=Math.ceil(Math.sqrt(count*1.75)),rows=Math.ceil(count/columns);
 const cellW=1680/columns,cellH=920/rows,cells=[];
 for(let row=0;row<rows;row++)for(let col=0;col<columns;col++)cells.push([col,row]);
 for(let i=cells.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[cells[i],cells[j]]=[cells[j],cells[i]]}
 const positions=cells.slice(0,count).map(([col,row])=>[60+(col+.5+(random()-.5)*.24)*cellW,50+(row+.5+(random()-.5)*.24)*cellH]);
 // Spacing is guaranteed by jittered grid cells: ≥ 76% of a cell between neighbors.
 const chosen=new Set([0]),links=[];
 while(chosen.size<count){let best=null;for(const a of chosen)for(let b=0;b<count;b++){if(chosen.has(b))continue;const d=(positions[a][0]-positions[b][0])**2+(positions[a][1]-positions[b][1])**2;if(!best||d<best.d)best={a,b,d}}links.push([best.a,best.b]);chosen.add(best.b)}
 const existing=new Set(links.map(([a,b])=>[a,b].sort((x,y)=>x-y).join(':')));
 const candidates=[];for(let a=0;a<count;a++)for(let b=a+1;b<count;b++){if(existing.has(a+':'+b))continue;const d=(positions[a][0]-positions[b][0])**2+(positions[a][1]-positions[b][1])**2;candidates.push({a,b,score:d*(.6+random()*.8)})}
 candidates.sort((a,b)=>a.score-b.score);
 const extra=Math.round(count*(density==='dense'?1.25:density==='sparse'?.2:.65));
 for(const x of candidates.slice(0,extra))links.push([x.a,x.b]);
 const starters=[Math.floor(random()*count)];
 while(starters.length<players){let best=-1,score=-1;for(let i=0;i<count;i++){if(starters.includes(i))continue;const min=Math.min(...starters.map(j=>(positions[i][0]-positions[j][0])**2+(positions[i][1]-positions[j][1])**2));if(min>score){score=min;best=i}}starters.push(best)}
 const nodes=Array.from({length:count},(_,id)=>({id,owner:null,active:3+random()*4,invested:0}));
 for(let p=0;p<players;p++){nodes[starters[p]].owner=p;nodes[starters[p]].active=24;nodes[starters[p]].invested=14}
 return {positions,links,nodes,seed,players};
}

function evaluatePolicy({policy,node,manualSpent,manualHold,neighbors,owners,source}){
 if(!policy||!policy.enabled||!node||node.owner!==0||manualHold)return [];
 const surplus=Math.max(0,node.active-manualSpent-policy.reserve);
 const invest=surplus*policy.investPct/100;
 const transfer=policy.dest!==null&&neighbors.includes(policy.dest)&&owners[policy.dest]===0?surplus-invest:0;
 const result=[];
 if(invest>1e-9)result.push({source,type:'invest',amount:invest,dest:null,automatic:true});
 if(transfer>1e-9)result.push({source,type:'transfer',amount:transfer,dest:policy.dest,automatic:true});
 return result;
}
function forecast(node,incoming,outgoing){
 const invest=outgoing.filter(o=>o.type==='invest').reduce((a,o)=>a+o.amount,0);
 const spent=outgoing.reduce((a,o)=>a+o.amount,0);
 const defense=Math.max(0,node.active-spent);
 return {invest,incoming,defense,income:1+.1*(node.invested+invest),next:.9*(defense+incoming)+1+.1*(node.invested+invest)};
}
globalThis.GameEngine=Object.freeze({seeded,buildMap,evaluatePolicy,forecast});
