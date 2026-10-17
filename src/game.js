"use strict";
const {buildMap,evaluatePolicy,forecast}=GameEngine;
let N=14;
let edges=[[0,1],[0,2],[1,3],[1,4],[2,4],[2,5],[3,6],[4,6],[4,7],[5,7],[6,8],[7,8],[7,9],[8,10],[9,10],[9,11],[10,12],[11,12],[11,13],[12,13]];
let xy=[[70,230],[165,115],[165,355],[280,70],[290,210],[280,385],[415,105],[420,295],[520,170],[530,375],[630,220],[640,405],[725,300],[735,415]];
const neighbors=i=>edges.flatMap(([a,b])=>a===i?[b]:b===i?[a]:[]);
const $=id=>document.getElementById(id), clamp=v=>Math.max(0,v),rnd=(a,b)=>a+Math.random()*(b-a),fmt=v=>v.toFixed(1);
let state,orders,policies,clipboard=null,selected=null,history=[],playerCount=2,mapSeed="classic",camera={x:0,y:0,scale:1},viewDashboard=false;
function fresh(){
 const nodes=Array.from({length:N},(_,id)=>({id,owner:null,active:rnd(3,7),invested:0}));
 const starts=playerCount===2?[0,N-1]:Array.from({length:playerCount},(_,i)=>Math.floor(i*N/playerCount));
 for(let i=0;i<starts.length;i++){const node=nodes[starts[i]];node.owner=i;node.active=24;node.invested=14}
 state={round:1,nodes,finished:false};orders={};policies={};selected=null;history=['New match started. You are Blue.'];camera={x:0,y:0,scale:1};render()
}
function mapOptions(){return {count:Math.max(10,Math.min(120,Number($('nodeCount').value)||30)),players:Number($('playerCount').value),density:$('density').value,seed:$('seed').value||'energy-42'}}
function previewMap(){
 const options=mapOptions(),map=buildMap(options),svg=$('newGamePreview'),ns='http://www.w3.org/2000/svg';
 svg.replaceChildren();
 const element=(name,attrs)=>{const e=document.createElementNS(ns,name);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);svg.append(e);return e};
 for(const [a,b] of map.links)element('line',{x1:map.positions[a][0],y1:map.positions[a][1],x2:map.positions[b][0],y2:map.positions[b][1],stroke:'#75859b','stroke-width':3,opacity:'.65'});
 for(const n of map.nodes){const [cx,cy]=map.positions[n.id];element('circle',{cx,cy,r:24,fill:n.owner===null?'#768092':['#3278c8','#cc6255','#b18adc','#d9a44d','#72b995','#da7dba'][n.owner%6],stroke:'#e0e9fa','stroke-width':2})}
 $('previewCaption').textContent=options.count+' nodes · '+options.players+' players · '+map.links.length+' links · seed '+options.seed;
}
function generate(){
 const options=mapOptions(),map=buildMap(options);
 mapSeed=map.seed;N=map.nodes.length;playerCount=map.players;xy=map.positions;edges=map.links;
 state={round:1,nodes:map.nodes,finished:false};orders={};policies={};selected=null;history=['Generated '+N+' nodes, '+playerCount+' players, seed '+map.seed];camera={x:0,y:0,scale:1};viewDashboard=false;$('tableView').textContent='Node dashboard';$('newGameDialog').close();render();
}
function openNewGame(){previewMap();$('newGameDialog').showModal()}

function log(message){history.unshift(message);history=history.slice(0,70)}

function plan(source){return orders[source]??{invest:0,edges:{}}}
function allocated(source,p=plan(source)){return p.invest+Object.values(p.edges).reduce((sum,n)=>sum+n,0)}
function setAllocation(source,destination,value){
 if(state.finished||state.nodes[source]?.owner!==0)return;
 const amount=Number(value),node=state.nodes[source],p={invest:plan(source).invest,edges:{...plan(source).edges},hold:plan(source).hold||false};
 if(!Number.isFinite(amount)||amount<0)return;
 if(destination===null)p.invest=amount;
 else if(neighbors(source).includes(destination)){if(amount===0)delete p.edges[destination];else p.edges[destination]=amount}
 else return;
 if(allocated(source,p)>node.active+1e-8){$('hint').textContent='Over budget: total allocations cannot exceed '+fmt(node.active);return;}
 if(allocated(source,p)<1e-9&&!p.hold)delete orders[source];else orders[source]=p;
 render();
}
function numberField(value,max,onChange){
 const input=document.createElement('input');input.type='number';input.min='0';input.max=String(max);
 input.step='0.1';input.value=String(Number(value.toFixed(2)));
 input.addEventListener('change',()=>{const amount=Number(input.value);if(!Number.isFinite(amount)||amount<0||amount>max+1e-8){input.value=String(Number(value.toFixed(2)));$('hint').textContent='Invalid amount';return}onChange(amount)});
 return input;
}
function renderAllocator(){
 const container=$('allocator');container.replaceChildren();
 if(selected===null||state.nodes[selected].owner!==0)return;
 const n=state.nodes[selected],p=plan(selected),used=allocated(selected),remain=Math.max(0,n.active-used);
 const summary=document.createElement('div');summary.className='order-row';
 summary.textContent='Allocated '+fmt(used)+' / '+fmt(n.active)+' · Defense reserve '+fmt(remain);
 container.append(summary);
 const fields=document.createElement('div');fields.className='order-row';
 const heading=document.createElement('strong');heading.textContent='Energy allocation';fields.append(heading);
 const makeRow=(label,amount,target)=>{const row=document.createElement('div');row.className='allocation-line';const name=document.createElement('label');name.textContent=label;const input=numberField(amount,n.active,value=>setAllocation(selected,target,value));row.append(name,input);fields.append(row)};
 makeRow('Invest',p.invest,null);
 for(const dest of neighbors(selected))makeRow((state.nodes[dest].owner===0?'Transfer':'Attack')+' → Node '+dest,p.edges[dest]||0,dest);
 container.append(fields);
 const clear=document.createElement('button');clear.textContent='Clear node allocations';clear.onclick=()=>{delete orders[selected];render()};container.append(clear);
}

function defaultPolicy(){return {enabled:true,reserve:5,investPct:50,dest:null}}
function policyOrders(source){
 return evaluatePolicy({policy:policies[source],node:state.nodes[source],manualSpent:allocated(source),manualHold:Boolean(plan(source).hold),neighbors:neighbors(source),owners:state.nodes.map(n=>n.owner),source});
}
function changePolicy(source,key,value){policies[source]={...defaultPolicy(),...policies[source],[key]:value};render()}
function renderPolicyEditor(){
 const container=$('policyEditor');container.replaceChildren();
 if(selected===null||state.nodes[selected].owner!==0)return;
 const source=selected,p=policies[source],box=document.createElement('div');box.className='policy-box';
 const heading=document.createElement('h3');heading.textContent='Persistent policy';box.append(heading);
 const actions=document.createElement('div');actions.className='policy-actions';
 function button(label,fn){const b=document.createElement('button');b.textContent=label;b.onclick=fn;actions.append(b)}
 button(p?'Remove policy':'Create policy',()=>{if(p)delete policies[source];else policies[source]=defaultPolicy();render()});
 if(p)button('Copy',()=>{clipboard={...p};render()});
 if(clipboard)button('Paste',()=>{policies[source]={...clipboard,dest:neighbors(source).includes(clipboard.dest)&&state.nodes[clipboard.dest].owner===0?clipboard.dest:null};render()});
 box.append(actions);
 if(p){
  const add=(title,field)=>{const label=document.createElement('label');label.textContent=title;label.append(field);box.append(label)};
  const enabled=document.createElement('input');enabled.type='checkbox';enabled.checked=p.enabled;enabled.onchange=()=>changePolicy(source,'enabled',enabled.checked);add(' Enabled every round ',enabled);
  const reserve=numberField(p.reserve,100000,value=>changePolicy(source,'reserve',value));add('Active defense reserve',reserve);
  const invest=numberField(p.investPct,100,value=>changePolicy(source,'investPct',value));add('Invest % of surplus',invest);
  const dest=document.createElement('select');
  for(const [value,title] of [['','Keep remaining surplus'],...neighbors(source).filter(id=>state.nodes[id].owner===0).map(id=>[String(id),'Transfer → Node '+id])]){
   const opt=document.createElement('option');opt.value=value;opt.textContent=title;opt.selected=(value===''?null:Number(value))===p.dest;dest.append(opt)}
  dest.onchange=()=>changePolicy(source,'dest',dest.value===''?null:Number(dest.value));add('Transfer destination',dest);
  const pause=document.createElement('input');pause.type='checkbox';pause.checked=Boolean(plan(source).hold);
  pause.onchange=()=>{const m={...plan(source),edges:{...plan(source).edges},hold:pause.checked};if(allocated(source,m)===0&&!m.hold)delete orders[source];else orders[source]=m;render()};
  add(' Pause policy this round ',pause);
 }
 const automatic=policyOrders(source),spent=automatic.reduce((sum,o)=>sum+o.amount,0);
 const preview=document.createElement('p');preview.className='muted';
 preview.textContent='Preview: '+(automatic.length?automatic.map(o=>o.type+' '+fmt(o.amount)+(o.dest===null?'':' → '+o.dest)).join(' · '):'No automatic spending')+' · Defense '+fmt(Math.max(0,state.nodes[source].active-allocated(source)-spent));
 box.append(preview);container.append(box);
}
function renderOrders(){
 const container=$('orders');container.replaceChildren();
 const ids=[...new Set([...Object.keys(orders),...Object.keys(policies)])].map(Number).filter(id=>state.nodes[id].owner===0).sort((a,b)=>a-b);
 $('orderCount').textContent='('+ids.length+' nodes)';
 if(!ids.length){const p=document.createElement('p');p.className='muted';p.textContent='No allocations planned.';container.append(p)}
 for(const id of ids){
  const p=plan(id),row=document.createElement('div');row.className='order-row'+(selected===id?' order-selected':'');
  const top=document.createElement('div');top.className='order-top';
  const choose=document.createElement('button');choose.textContent='Edit node '+id;choose.onclick=()=>{selected=id;render()};
  const remove=document.createElement('button');remove.textContent='Clear ×';remove.onclick=()=>{delete orders[id];render()};
  top.append(choose,remove);row.append(top);
  const details=document.createElement('div');details.className='muted';
  const parts=[];if(p.invest>0)parts.push('Invest '+fmt(p.invest));
  for(const [dest,amount] of Object.entries(p.edges))parts.push((state.nodes[dest].owner===0?'Transfer':'Attack')+' '+dest+': '+fmt(amount));
  const automatic=policyOrders(id),spent=automatic.reduce((sum,o)=>sum+o.amount,0);details.textContent=(p.hold?'Policy paused · ':'')+parts.join(' · ')+(automatic.length?' · Auto: '+automatic.map(o=>o.type+' '+fmt(o.amount)+(o.dest===null?'':' → '+o.dest)).join(', '):'')+' · Defense '+fmt(Math.max(0,state.nodes[id].active-allocated(id)-spent));
  row.append(details);container.append(row);
 }
}
function clickNode(id){if(state.nodes[id].owner===0){selected=id;render()}else if(selected!==null&&neighbors(selected).includes(id)){$('hint').textContent='Set the attack amount for node '+id+' in the selected node allocation panel.'}}

function aiOrders(){const planned={};const ns=state.nodes;for(const node of ns.filter(n=>n.owner!==null&&n.owner!==0)){const adj=neighbors(node.id),foes=adj.filter(id=>ns[id].owner!==node.owner),friends=adj.filter(id=>ns[id].owner===node.owner);let active=node.active;if(foes.length){foes.sort((a,b)=>ns[a].active-ns[b].active);const t=foes[0];if(active>ns[t].active*0.9+2){planned[node.id]={source:node.id,type:'attack',amount:Math.min(active,ns[t].active*1.4+3),dest:t};continue}}
if(friends.length&&active>10){const towards=friends.sort((a,b)=>neighbors(b).filter(k=>ns[k].owner!==node.owner).length-neighbors(a).filter(k=>ns[k].owner!==node.owner).length);if(neighbors(towards[0]).some(k=>ns[k].owner!==1)){planned[node.id]={source:node.id,type:'transfer',amount:active*0.5,dest:towards[0]};continue}}
if(active>3)planned[node.id]={source:node.id,type:'invest',amount:active*0.6,dest:null};}return planned}
function resolve(){if(state.finished)return;const nodes=state.nodes;
const manual=Object.entries(orders).flatMap(([source,p])=>[
 ...(p.invest>0?[{source:Number(source),type:'invest',amount:p.invest,dest:null}]:[]),
 ...Object.entries(p.edges).filter(([,amount])=>amount>0).map(([dest,amount])=>({source:Number(source),type:nodes[Number(dest)].owner===0?'transfer':'attack',amount,dest:Number(dest)}))
]);
const automatic=Object.keys(policies).map(Number).flatMap(id=>policyOrders(id));
const all=[...manual,...automatic,...Object.values(aiOrders())];const valid=[],spent={};for(const o of all){const n=nodes[o.source];if(!n||n.owner===null||o.amount<=0||(spent[o.source]||0)+o.amount>n.active+1e-8)continue;if(o.type!=='invest'&&!neighbors(o.source).includes(o.dest))continue;if(o.type==='transfer'&&nodes[o.dest].owner!==n.owner)continue;if(o.type==='attack'&&nodes[o.dest].owner===n.owner)continue;spent[o.source]=(spent[o.source]||0)+o.amount;valid.push({...o,owner:n.owner})}
for(const o of valid)nodes[o.source].active=clamp(nodes[o.source].active-o.amount);
for(const o of valid.filter(o=>o.type==='invest'))nodes[o.source].invested+=o.amount;
for(const o of valid.filter(o=>o.type==='transfer'))nodes[o.dest].active+=o.amount;
const battles={};for(const o of valid.filter(o=>o.type==='attack')){const key=o.dest+':'+o.owner; if(!battles[key])battles[key]={dest:o.dest,owner:o.owner,amount:0};battles[key].amount+=o.amount}
const byTarget={};for(const attack of Object.values(battles))(byTarget[attack.dest]??=[]).push(attack);
for(const [destination,attacks] of Object.entries(byTarget)){const node=nodes[Number(destination)],original=node.owner;for(let i=attacks.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[attacks[i],attacks[j]]=[attacks[j],attacks[i]]}
for(const a of attacks){
 if(node.owner===a.owner){node.active+=a.amount;continue}
 const defenderOwner=node.owner,defenderBefore=node.active;
 const atk=a.amount*rnd(.8,1.2),def=defenderBefore*rnd(.8,1.2);
 let attackerSurvived=0,defenderSurvived=0;
 if(atk>def){
   attackerSurvived=a.amount*(1-def/atk);
   node.owner=a.owner;node.active=attackerSurvived;
 }else{
   defenderSurvived=defenderBefore*(1-atk/Math.max(def,1e-10));
   node.active=defenderSurvived;
 }
 const attackerLoss=a.amount-attackerSurvived;
 const defenderLoss=defenderBefore-defenderSurvived;
 log('Round '+state.round+' · Node '+node.id+': '+(a.owner===0?'Blue':'Red')+
     ' attacks '+(defenderOwner===null?'Neutral':defenderOwner===0?'Blue':'Red')+
     ' with '+fmt(a.amount)+' vs '+fmt(defenderBefore)+
     '. '+(atk>def?'Captured!':'Defended!')+
     ' Attacker lost '+fmt(attackerLoss)+', defender lost '+fmt(defenderLoss)+
     '. Remaining '+fmt(atk>def?attackerSurvived:defenderSurvived)+'.');
 }
 if(node.owner!==original){node.invested*=rnd(.25,.75);if(node.owner===0&&$('autoConquer').checked){policies[node.id]={enabled:true,reserve:Math.max(0,Number($('defaultReserve').value)||0),investPct:Math.max(0,Math.min(100,Number($('defaultInvest').value)||0)),dest:null}}}}
for(const n of nodes){const income=1+n.invested*.1;n.active=clamp(n.active*.9+income)}
for(const id of Object.keys(policies)){if(nodes[Number(id)].owner!==0)delete policies[id]}
let blue=nodes.filter(n=>n.owner===0).length,red=nodes.filter(n=>n.owner!==null&&n.owner!==0).length;
log('Round '+state.round+' complete: Blue '+blue+' nodes / Red '+red+' nodes.');state.round++;orders={};
const alive=new Set(nodes.filter(n=>n.owner!==null).map(n=>n.owner));if(alive.size<=1){state.finished=true;log(alive.has(0)?'Blue wins by elimination!':'An AI player wins by elimination!')}render()}

function previewOrders(){
 const manual=Object.entries(orders).flatMap(([source,p])=>[
 ...(p.invest>0?[{source:Number(source),type:'invest',amount:p.invest,automatic:false}]:[]),
 ...Object.entries(p.edges).map(([dest,amount])=>({source:Number(source),dest:Number(dest),amount,type:state.nodes[Number(dest)].owner===0?'transfer':'attack',automatic:false}))
 ]);
 return [...manual,...Object.keys(policies).map(Number).flatMap(policyOrders)];
}
function projection(id){
 const scheduled=previewOrders(),incoming=scheduled.filter(o=>o.dest===id&&o.type==='transfer').reduce((a,o)=>a+o.amount,0);
 return forecast(state.nodes[id],incoming,scheduled.filter(o=>o.source===id));
}
function renderFlows(svg,graph,element){
 const filter=$('overlay').value;
 if(filter==='none')return;
 for(const o of previewOrders()){
  if(filter==='manual'&&o.automatic||filter==='policy'&&!o.automatic||o.dest===undefined||o.dest===null||o.amount<=.01)continue;
  const [ax,ay]=xy[o.source],[bx,by]=xy[o.dest],dx=bx-ax,dy=by-ay,length=Math.hypot(dx,dy)||1;
  const fromX=ax+dx/length*32,fromY=ay+dy/length*32,toX=bx-dx/length*35,toY=by-dy/length*35;
  const color=o.type==='attack'?'#ef886a':o.automatic?'#31c9a0':'#7fbeff';
  element('line',{x1:fromX,y1:fromY,x2:toX,y2:toY,stroke:color,'stroke-width':3,'stroke-dasharray':o.automatic?'8 5':'none'},graph);
  const arrow=element('path',{d:'M '+toX+' '+toY+' l '+(-dx/length*12-dy/length*5)+' '+(-dy/length*12+dx/length*5)+' l '+(dy/length*10)+' '+(-dx/length*10)+' Z',fill:color},graph);
  const label=element('text',{x:(ax+bx)/2-dy/length*15,y:(ay+by)/2+dx/length*15,class:'flow-label'},graph);label.textContent=fmt(o.amount);
 }
 for(const n of state.nodes){if(n.owner!==0)continue;const p=projection(n.id),[x,y]=xy[n.id];const t=element('text',{x,y:y+53,'font-size':12,fill:'#92ebc9'},graph);t.textContent='+'+fmt(p.income)+' / I '+fmt(p.invest)}
}
function renderDashboard(){
 $('mapViewport').hidden=viewDashboard;$('dashboard').hidden=!viewDashboard;
 if(!viewDashboard)return;
 const dashboard=$('dashboard');dashboard.replaceChildren();
 const title=document.createElement('h3');title.textContent='Node dashboard — select several nodes for bulk policies';dashboard.append(title);
 const bulk=document.createElement('div');bulk.className='policy-box';
 bulk.innerHTML='<label>Reserve <input id="bulkReserve" type="number" min="0" value="5"></label><label>Invest % <input id="bulkInvest" type="number" min="0" max="100" value="70"></label><button id="bulkApply">Apply policy to selected</button><hr><label>One-time investment energy per selected node <input id="bulkManualInvest" type="number" min="0" value="5"></label><button id="bulkManualApply">Set manual investments</button>';
 dashboard.append(bulk);
 const table=document.createElement('table'),head=document.createElement('tr');
 for(const h of ['Select','Node','Active','Invested','Income','Defense','Invest next','Next active','Policy']){const th=document.createElement('th');th.textContent=h;head.append(th)}table.append(head);
 for(const n of state.nodes.filter(n=>n.owner===0)){const p=projection(n.id),tr=document.createElement('tr');
 const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.dataset.node=n.id;checkbox.className='bulk-node';
 const makeCell=child=>{const td=document.createElement('td');if(typeof child==='string')td.textContent=child;else td.append(child);tr.append(td)};
 makeCell(checkbox);const select=document.createElement('button');select.textContent=n.id;select.onclick=()=>{selected=n.id;viewDashboard=false;render()};makeCell(select);
 for(const value of [n.active,n.invested,p.income,p.defense,p.invest,p.next])makeCell(fmt(value));
 makeCell(policies[n.id]?(policies[n.id].enabled?'On':'Off'):'None');table.append(tr)}
 dashboard.append(table);
 $('bulkApply').onclick=()=>{const selectedIds=[...dashboard.querySelectorAll('.bulk-node:checked')].map(x=>Number(x.dataset.node));for(const id of selectedIds)policies[id]={enabled:true,reserve:Math.max(0,Number($('bulkReserve').value)||0),investPct:Math.max(0,Math.min(100,Number($('bulkInvest').value)||0)),dest:null};render()};
 $('bulkManualApply').onclick=()=>{const ids=[...dashboard.querySelectorAll('.bulk-node:checked')].map(x=>Number(x.dataset.node)),amount=Math.max(0,Number($('bulkManualInvest').value)||0);for(const id of ids){const p={...plan(id),edges:{...plan(id).edges}},available=state.nodes[id].active-Object.values(p.edges).reduce((a,b)=>a+b,0);if(amount<=available+1e-8){p.invest=amount;if(allocated(id,p)<1e-9&&!p.hold)delete orders[id];else orders[id]=p}}render()};
}
function attachNavigation(){
 const svg=$('map');let drag=null;
 svg.addEventListener('wheel',e=>{
   e.preventDefault();
   camera.scale=Math.max(.3,Math.min(5,camera.scale*(e.deltaY<0?1.12:.89)));
   render();
 },{passive:false});
 svg.addEventListener('pointerdown',e=>{
   // Node clicks must remain native click events. Only pan on empty background.
   if(e.button!==0 || e.target.closest('.node-hit'))return;
   drag={x:e.clientX,y:e.clientY,ox:camera.x,oy:camera.y,id:e.pointerId};
 });
 svg.addEventListener('pointermove',e=>{
   if(!drag||e.pointerId!==drag.id)return;
   const rect=svg.getBoundingClientRect();
   const factor=(xy.length===14&&mapSeed==='classic'?800:1800)/rect.width;
   camera.x=drag.ox+(e.clientX-drag.x)*factor;
   camera.y=drag.oy+(e.clientY-drag.y)*factor;
   const g=svg.querySelector('g');
   if(g)g.setAttribute('transform','translate('+camera.x+' '+camera.y+') scale('+camera.scale+')');
 });
 const stop=e=>{if(drag&&e.pointerId===drag.id)drag=null};
 svg.addEventListener('pointerup',stop);
 svg.addEventListener('pointercancel',stop);
 window.addEventListener('pointerup',stop);
}

function render(){const nodes=state.nodes,blue=nodes.filter(n=>n.owner===0).length,red=nodes.filter(n=>n.owner!==null&&n.owner!==0).length;
$('score').textContent='Round '+state.round+' · Blue '+blue+' · Opponents '+red;
$('resolve').disabled=state.finished;
const svg=$('map');svg.innerHTML='';svg.setAttribute('viewBox',xy.length===14&&mapSeed==='classic'?'0 0 800 460':'0 0 1800 1050');
const ns='http://www.w3.org/2000/svg';
const element=(name,attrs,parent=svg)=>{const e=document.createElementNS(ns,name);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);parent.append(e);return e};
const graph=element('g',{transform:'translate('+camera.x+' '+camera.y+') scale('+camera.scale+')'});
for(const [a,b] of edges)element('line',{x1:xy[a][0],y1:xy[a][1],x2:xy[b][0],y2:xy[b][1],stroke:'#71849d','stroke-width':3,opacity:.55},graph);
for(const n of nodes){const [x,y]=xy[n.id],group=element('g',{},graph);const cir=element('circle',{cx:x,cy:y,r:30,fill:n.owner===null?'#768092':(['#3278c8','#cc6255','#b18adc','#d9a44d','#72b995','#da7dba'][n.owner%6]),class:'node node-hit'+(selected===n.id?' selected':'')+(orders[n.id]?' node-ordered':'')},group);const t=element('text',{x,y:y+2,'font-size':17},group);t.textContent=fmt(n.active);const t2=element('text',{x,y:y+18,'font-size':10},group);t2.textContent='I '+fmt(n.invested);const t3=element('text',{x,y:y-40,'font-size':12},group);t3.textContent=n.id;group.style.cursor='pointer';group.addEventListener('click',()=>clickNode(n.id))}
let selectedNode=selected===null?null:nodes[selected];$('selectedTitle').textContent=selectedNode?'Node '+selected:'Select a blue node';
$('details').textContent=selectedNode?'Active '+fmt(selectedNode.active)+' · Invested '+fmt(selectedNode.invested):'Choose a blue node to issue an order.';
$('hint').textContent=state.finished?'Game over. Start a new game.':'Manual allocations take priority; policies automatically use remaining energy. Unspent energy defends.';
renderAllocator();
renderPolicyEditor();
renderOrders();
renderFlows(svg,graph,element);
renderDashboard();
$('log').innerHTML=history.map(line=>'<div>'+line+'</div>').join('');
}
$('clearAll').onclick=()=>{orders={};render()};
$('resolve').onclick=resolve;$('reset').onclick=openNewGame;
$('generate').onclick=generate;for(const id of ['nodeCount','playerCount','density','seed'])$(id).addEventListener('input',previewMap);$('cancelNewGame').onclick=()=>$('newGameDialog').close();$('tableView').onclick=()=>{viewDashboard=!viewDashboard;$('tableView').textContent=viewDashboard?'Map view':'Node dashboard';render()};
$('overlay').onchange=render;$('fit').onclick=()=>{camera={x:0,y:0,scale:1};render()};
fresh();attachNavigation();
