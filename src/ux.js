'use strict';
// prettier-ignore
(() => {
  // Presentation-only enhancements. Game state and round resolution remain in game.js.
  const byId = (id) => document.getElementById(id);
  const mobile = () => window.matchMedia('(max-width:760px)').matches;
  const fmtUX = (n) => (Number(n) || 0).toFixed(1);
  const style = document.createElement('style');
  style.textContent = `
:root{color-scheme:dark;--ux-bg:#0b1424;--ux-panel:#14233a;--ux-card:#1b2d46;--ux-border:#344963;--ux-muted:#a6bad2;--ux-blue:#589cff;--ux-green:#6edab4}
body{background:var(--ux-bg);color:#f1f6ff;overflow-x:hidden}
button,input,select{border-radius:9px}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #f0d27e;outline-offset:2px}
header{background:#101d30;padding:12px 22px;align-items:center}
header h1{font-size:18px}header .muted{font-size:11px}
header>div:last-child{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
#score{background:#1c304a;border:1px solid #344963;border-radius:8px;padding:9px 11px;white-space:nowrap;font-size:12px}
header .primary,.ux-primary{background:#387dcc;border-color:#579eec;color:white;font-weight:750}
#mobileSettings{display:inline-block}
.toolbar{background:#0b1424;max-width:1480px;margin:auto;padding:13px 20px 2px;gap:16px}
.view-tabs{background:#182942;border:1px solid #344963;border-radius:11px;padding:4px}
.view-tabs button{border:0;background:transparent;padding:10px 15px;font-size:13px}
.view-tabs button.active{background:#315d94;border-radius:8px}
.layout{max-width:1480px;grid-template-columns:minmax(0,1fr) 288px;gap:14px;padding:14px 20px}
.layout>.panel{background:var(--ux-panel);border-color:var(--ux-border)}
.layout>.panel:first-child{min-width:0}
#mapViewport{height:min(70vh,730px);min-height:450px;background:#0d1a2b;border:1px solid #33455f;border-radius:11px}
#mapViewport svg{display:block}
.ux-map-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 4px 12px}
.ux-map-heading h2{font-size:17px;margin:0}
.ux-map-heading .muted{font-size:12px;margin:3px 0 0}
.ux-map-heading label{display:flex;align-items:center;gap:7px;font-size:12px;color:#afc2d9}
.ux-map-heading select{width:145px}
#mapViewport .map-zoom-controls{right:12px;bottom:12px;gap:6px}
#mapViewport .map-zoom-controls button{min-width:43px;min-height:43px;font-size:15px;background:#203956eb}
#mapViewport .map-zoom-controls #focusMap{font-size:12px}
.map-explanation{font-size:12px;line-height:1.6;margin:12px 0 0}
#gameSidebar{height:max-content;padding:15px}
.ux-side-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px}
.ux-side-head h3{font-size:15px;margin:0}
.ux-side-section+.ux-side-section{border-top:1px solid #354963;margin-top:17px;padding-top:17px}
.ux-node-card{border:1px solid #405b77;border-radius:12px;background:var(--ux-card);padding:14px}
.ux-node-card strong{font-size:21px}
.ux-node-card .muted{margin:8px 0;line-height:1.6}
.ux-node-card button{width:100%}
.ux-side-list{font-size:12px;color:#c7d4e7;display:grid;gap:9px}
.ux-side-list>div{padding:9px;border:1px solid #344963;border-radius:9px;background:#1c304a}
.ux-side-action{width:100%;margin-top:12px}
#nodeDialog{width:min(1000px,96vw);max-height:94dvh;padding:0;background:#101d30;border:1px solid #526681;border-radius:16px;box-shadow:0 22px 85px #000b}
#nodeDialog::backdrop,.ux-dialog::backdrop{background:#030912ce}
#nodeDialog .mobile-node-header{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12px;background:#14243b;padding:14px 18px;border-bottom:1px solid #344963;margin:0}
#selectedTitle{font-size:21px;margin:0}
#details{margin:6px 0;color:#b6c9e0}
#hint{border:1px solid #39516f;background:#192f48;padding:11px 13px;border-radius:10px;line-height:1.55}
#mobileNodeContent{max-height:none;overflow:visible}
.ux-editor-scroll{max-height:calc(94dvh - 125px);overflow-y:auto;overscroll-behavior:contain;padding:18px}
.ux-editor-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0 0 13px}
.ux-stat{background:#20334d;border:1px solid #405675;padding:14px;border-radius:11px}
.ux-stat strong{display:block;font-size:24px;line-height:1.25}
.ux-stat span{font-size:11px;color:#a8bed8;display:block;margin-bottom:4px}
.ux-budget{border:1px solid #3b5370;background:#16283f;border-radius:12px;padding:15px;margin-bottom:16px}
.ux-budget-head{display:flex;justify-content:space-between;gap:10px;font-size:13px}
.ux-budget-bar{display:flex;height:11px;border-radius:20px;overflow:hidden;background:#33455e;margin:12px 0 10px}
.ux-budget-bar>span{height:100%;display:block}
.ux-budget-legend{display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:#c2d1e4}
.ux-budget-legend b{color:white}
.ux-editor-sections{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(260px,.85fr);gap:14px;align-items:start}
.ux-editor-section{border:1px solid #354b66;border-radius:12px;padding:15px;background:#182c45;min-width:0}
.ux-editor-section>h3{font-size:17px;margin:0 0 12px}
#allocator .order-row{background:transparent;border:0;padding:0;margin:0}
#allocator .order-row:first-child{display:none}
#allocator .order-row strong{display:none}
#allocator .allocation-line{display:grid;grid-template-columns:minmax(0,1fr) 104px;gap:12px;min-height:46px;border-bottom:1px solid #344963;padding:8px 0;margin:0}
#allocator .allocation-line label{font-size:13px;color:#e0eaf7}
#allocator .allocation-line input{min-height:36px;width:100%}
#allocator>button{margin-top:15px;border-color:#6a5262;color:#ffd1c9}
#policyEditor .policy-box{margin:0;background:transparent;border:0;padding:0}
#policyEditor .policy-box h3{font-size:17px;margin:0 0 12px}
#policyEditor .policy-box label{display:block;color:#b8cbe1;line-height:1.5;margin:12px 0;font-size:12px}
#policyEditor .policy-box label input[type=number],#policyEditor .policy-box label select{display:block;margin-top:5px;min-height:39px}
#policyEditor .policy-actions{gap:6px}
#policyEditor .policy-actions button{font-size:12px}
#policyEditor .muted{line-height:1.6}
.ux-combat-note{font-size:12px;line-height:1.6;color:#a9c0d9;margin-top:13px}
.ux-editor-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 18px;background:#14243b;border-top:1px solid #344963}
.ux-editor-footer .muted{font-size:12px}
.ux-editor-footer button{min-width:120px}
.ux-jumps{display:none;gap:8px;margin:0 0 12px}
.ux-dialog{width:min(720px,96vw);max-height:92dvh;overflow-y:auto;background:#14243b;color:#eef5ff;border:1px solid #526681;border-radius:15px;padding:0}
.ux-dialog-header{display:flex;justify-content:space-between;align-items:center;gap:12px;position:sticky;top:0;background:#172943;padding:16px;border-bottom:1px solid #3c5069;z-index:1}
.ux-dialog-header h2{font-size:19px;margin:0}
.ux-dialog-body{padding:16px}
.ux-dialog-body .policy-box{margin-top:0}
.ux-dialog-body>h3{font-size:15px}
#uxOrdersDialog #orders{display:grid;gap:9px}
#uxOrdersDialog .order-row{margin:0;padding:13px}
#uxOrdersDialog .order-top button{font-size:12px}
#uxOrdersDialog #clearAll{margin-top:14px;color:#ffbfba}
#uxOrdersDialog .muted{line-height:1.6}
#uxSettingsDialog .policy-box{margin-bottom:16px}
#uxSettingsDialog label{line-height:1.6}
.ux-dock{display:none}
#dashboard{max-height:unset;overflow:visible}
#dashboard h3{margin-top:5px}
#dashboard>.policy-box{display:flex;align-items:end;flex-wrap:wrap;gap:9px}
#dashboard>.policy-box label{margin:0;flex:1 1 130px}
#dashboard>.policy-box button{min-height:39px}
#dashboard>.policy-box hr{display:none}
#dashboard>table{display:table;width:100%;font-size:12px}
#dashboard th{position:sticky;top:0;background:#243a55;white-space:nowrap}
#dashboard td{white-space:nowrap}
#dashboard .ux-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin:12px 0}
#dashboard .ux-summary>div{padding:13px;border:1px solid #3c5672;background:#1a3049;border-radius:10px}
#dashboard .ux-summary strong{display:block;font-size:22px}
#dashboard .ux-summary span{font-size:11px;color:#a8bed8}
#dashboard .ux-node-cards{display:none}
#messagesView .log{max-height:65vh}
@media(max-width:1050px){.layout{grid-template-columns:minmax(0,1fr) 245px}.ux-editor-sections{grid-template-columns:minmax(0,1fr) minmax(230px,.9fr)}}
@media(max-width:760px){
 header{padding:9px 12px;gap:7px}header h1{font-size:15px}header .muted{font-size:10px}header>div:last-child{gap:5px}header #score{width:auto;font-size:11px;padding:5px 7px}header #resolve,header #reset{display:none}#mobileSettings{display:inline-block;font-size:12px}
 .toolbar{padding:7px 8px}.view-tabs{width:100%;gap:3px}.view-tabs button{flex:1;padding:10px 5px}
 .layout{padding:5px 5px 84px;display:block}.layout>.panel:first-child{padding:5px;background:transparent;border:0}.ux-map-heading{padding:8px 4px}.ux-map-heading h2{font-size:14px}.ux-map-heading .muted{font-size:10px}.ux-map-heading label{font-size:11px}.ux-map-heading select{width:118px;max-width:118px;font-size:12px}
 #mapViewport{height:calc(100dvh - 240px);min-height:340px;max-height:none;border-radius:10px}
 #mapViewport .map-zoom-controls{bottom:11px;right:9px;flex-direction:row;gap:5px}#mapViewport .map-zoom-controls button{min-width:40px;min-height:42px;font-size:15px;padding:6px}#mapViewport .map-zoom-controls #fit,#mapViewport .map-zoom-controls #focusMap{font-size:11px}
 #gameSidebar{display:none!important}.map-explanation{display:none}
 .ux-dock{display:flex;position:fixed;bottom:0;left:0;right:0;z-index:20;padding:9px 12px calc(10px + env(safe-area-inset-bottom));gap:9px;background:#101d30;border-top:1px solid #40536d}
 .ux-dock button{flex:1;min-height:45px;font-weight:750}
 #nodeDialog{width:100vw;height:100dvh;max-height:100dvh;max-width:none;border:0;border-radius:0}
 #nodeDialog .mobile-node-header{padding:12px 14px}
 #selectedTitle{font-size:18px}
 .ux-editor-scroll{max-height:calc(100dvh - 128px);padding:13px 12px}
 .ux-editor-stats{gap:7px}.ux-stat{padding:11px}.ux-stat strong{font-size:20px}.ux-stat span{font-size:10px}
 .ux-editor-sections{display:flex;flex-direction:column;gap:12px}.ux-editor-section{width:100%;padding:13px}.ux-jumps{display:flex}.ux-jumps button{flex:1;font-size:12px;padding:9px 6px}
 .ux-editor-footer{padding:10px 14px calc(10px + env(safe-area-inset-bottom))}.ux-editor-footer button{min-height:44px;min-width:85px}
 .ux-dialog{width:100vw;height:100dvh;max-height:100dvh;max-width:none;border:0;border-radius:0}
 #dashboard>.policy-box{display:block}#dashboard>.policy-box label,#dashboard>.policy-box button{margin:8px 0;width:100%}
 #dashboard>table{display:none}#dashboard .ux-node-cards{display:grid;gap:9px}
 #dashboard .ux-node-card{background:#1a304a;border:1px solid #3b5572;padding:12px;border-radius:10px}
 #dashboard .ux-node-card header{display:flex;align-items:center;justify-content:space-between;background:transparent;border:0;padding:0}
 #dashboard .ux-summary{grid-template-columns:repeat(2,minmax(0,1fr))}
 #dashboard .ux-node-card button{font-size:12px}
}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
`;
  document.head.append(style);

  const nodeDialog = byId('nodeDialog');
  const oldHeader = nodeDialog.querySelector('.mobile-node-header');
  const oldClose = byId('closeNodeDialog');
  const slot = byId('nodeDetailsSlot');
  const originalAside = byId('gameSidebar');
  const settingsBox = originalAside.querySelector('.policy-box');
  const rules = originalAside.querySelector('details');
  const ordersContainer = byId('orders');
  const count = byId('orderCount');
  const clear = byId('clearAll');
  const selectedTitle = byId('selectedTitle');
  const details = byId('details');
  const hint = byId('hint');
  const allocator = byId('allocator');
  const policyEditor = byId('policyEditor');

  function makeDialog(id, title) {
    const d = document.createElement('dialog');
    d.id = id;
    d.className = 'ux-dialog';
    d.innerHTML = '<div class="ux-dialog-header"><h2>' + title + '</h2><button class="ux-dialog-close" type="button">Close ×</button></div><div class="ux-dialog-body"></div>';
    d.querySelector('.ux-dialog-close').onclick = () => d.close();
    document.body.append(d);
    return d;
  }
  const ordersDialog = makeDialog('uxOrdersDialog', 'Planned orders');
  const settingsDialog = makeDialog('uxSettingsDialog', 'Game settings');
  const ordersBody = ordersDialog.querySelector('.ux-dialog-body');
  const settingsBody = settingsDialog.querySelector('.ux-dialog-body');
  const orderHelp = document.createElement('p');
  orderHelp.className = 'muted';
  orderHelp.textContent = 'Manual allocations are separate from persistent policies. All actions execute together when you resolve the round.';
  ordersBody.append(orderHelp, count, ordersContainer, clear);
  clear.textContent = 'Clear all manual orders';
  settingsBody.append(settingsBox, rules);

  oldHeader.replaceChildren();
  oldHeader.append(selectedTitle, oldClose);
  oldClose.textContent = '← Back to map';
  oldClose.onclick = () => nodeDialog.close();
  const scroll = document.createElement('div');
  scroll.className = 'ux-editor-scroll';
  const stats = document.createElement('div');
  stats.className = 'ux-editor-stats';
  stats.id = 'uxEditorStats';
  const balance = document.createElement('div');
  balance.className = 'ux-budget';
  balance.id = 'uxBalance';
  const jumps = document.createElement('div');
  jumps.className = 'ux-jumps';
  jumps.innerHTML = '<button type="button" id="uxJumpOrders">Manual orders ↓</button><button type="button" id="uxJumpPolicy">Persistent policy ↓</button>';
  const columns = document.createElement('div');
  columns.className = 'ux-editor-sections';
  const manualSection = document.createElement('section');
  manualSection.className = 'ux-editor-section';
  manualSection.id = 'uxManualSection';
  const policySection = document.createElement('section');
  policySection.className = 'ux-editor-section';
  policySection.id = 'uxPolicySection';
  manualSection.append(allocator);
  policySection.append(policyEditor);
  columns.append(manualSection, policySection);
  const note = document.createElement('div');
  note.className = 'ux-combat-note';
  note.id = 'uxCombatNote';
  scroll.append(details, stats, balance, jumps, columns, note, hint);
  const footer = document.createElement('div');
  footer.className = 'ux-editor-footer';
  footer.innerHTML = '<span id="uxFooterSummary" class="muted"></span><button type="button" class="primary" id="uxDone">Done ✓</button>';
  byId('mobileNodeContent').replaceChildren(scroll, footer);
  byId('uxDone').onclick = () => nodeDialog.close();
  byId('uxJumpOrders').onclick = () => manualSection.scrollIntoView({block:'start',behavior:'smooth'});
  byId('uxJumpPolicy').onclick = () => policySection.scrollIntoView({block:'start',behavior:'smooth'});
  slot.remove();

  const side = document.createElement('div');
  side.innerHTML = '<div class="ux-side-section"><div class="ux-side-head"><h3>Selection</h3></div><div id="uxSideSelection"></div></div><div class="ux-side-section"><div class="ux-side-head"><h3>Next round</h3><span id="uxSideCount" class="muted"></span></div><div id="uxSideOrders" class="ux-side-list"></div><button type="button" class="ux-side-action" id="uxReviewSide">Review all orders →</button></div><div class="ux-side-section muted" style="line-height:1.6;font-size:12px">Manual orders spend the energy available at the start of the round. Unspent energy defends; policies use remaining surplus.</div>';
  originalAside.replaceChildren(...side.children);
  byId('uxReviewSide').onclick = () => ordersDialog.showModal();

  const reviewHead = document.createElement('button');
  reviewHead.id = 'uxReviewHead';
  reviewHead.type = 'button';
  reviewHead.textContent = 'Orders';
  reviewHead.onclick = () => ordersDialog.showModal();
  const headerActions = document.querySelector('body > header > div:last-child');
  headerActions.insertBefore(reviewHead, byId('resolve'));
  byId('mobileSettings').onclick = () => settingsDialog.showModal();
  const settingsClose = byId('closeMobileSettings');
  if (settingsClose) settingsClose.remove();

  const dock = document.createElement('div');
  dock.className = 'ux-dock';
  dock.innerHTML = '<button type="button" id="uxDockOrders">☷ Orders <span id="uxDockCount"></span></button><button type="button" class="primary" id="uxDockResolve">Resolve round →</button>';
  document.body.append(dock);
  byId('uxDockOrders').onclick = () => ordersDialog.showModal();
  byId('uxDockResolve').onclick = () => byId('resolve').click();

  const heading = document.createElement('div');
  heading.className = 'ux-map-heading';
  heading.innerHTML = '<div><h2>Tactical map</h2><p class="muted">Select a node to inspect or issue orders</p></div>';
  const overlayLabel = byId('overlay').closest('label');
  overlayLabel.prepend(document.createTextNode('Flows · '));
  overlayLabel.firstChild.textContent = 'Flows · ';
  overlayLabel.removeAttribute('hidden');
  heading.append(overlayLabel);
  byId('mapViewport').before(heading);
  const toolbar = document.querySelector('.toolbar');
  const hintZoom = toolbar.querySelector('.desktop-zoom-hint');
  if (hintZoom) hintZoom.remove();
  const option = document.createElement('option');
  option.value = 'selected';
  option.textContent = 'Selected node';
  byId('overlay').prepend(option);
  byId('overlay').value = 'selected';
  const focusButton = document.createElement('button');
  focusButton.id = 'focusMap';
  focusButton.type = 'button';
  focusButton.textContent = 'Focus';
  focusButton.title = 'Focus on selected node';
  byId('fit').after(focusButton);

  // Keep the game's normal renderer and engine; only change graphical overlays.
  const originalRenderFlows = renderFlows;
  renderFlows = function(svg, graph, element) {
    const filter = byId('overlay').value;
    if (filter === 'none') return;
    const paths = previewOrders();
    for (const o of paths) {
      if (o.dest === null || o.dest === undefined || o.amount <= .01) continue;
      if (filter === 'selected' && (selected === null || o.source !== selected)) continue;
      if (filter === 'manual' && o.automatic) continue;
      if (filter === 'policy' && !o.automatic) continue;
      const [ax,ay] = xy[o.source], [bx,by] = xy[o.dest];
      const dx=bx-ax,dy=by-ay,len=Math.hypot(dx,dy)||1;
      const fromX=ax+dx/len*32,fromY=ay+dy/len*32,toX=bx-dx/len*35,toY=by-dy/len*35;
      const color=o.type==='attack'?'#ff987f':o.automatic?'#76b3ff':'#63d9af';
      element('line',{x1:fromX,y1:fromY,x2:toX,y2:toY,stroke:color,'stroke-width':4,'stroke-dasharray':o.automatic?'8 5':'none'},graph);
      const arrow=element('path',{d:'M '+toX+' '+toY+' l '+(-dx/len*12-dy/len*5)+' '+(-dy/len*12+dx/len*5)+' l '+(dy/len*10)+' '+(-dx/len*10)+' Z',fill:color},graph);
      const label=element('text',{x:(ax+bx)/2-dy/len*15,y:(ay+by)/2+dx/len*15,class:'flow-label'},graph);
      label.textContent=fmtUX(o.amount);
    }
    if (filter === 'selected' && selected === null) return;
    for (const n of state.nodes) {
      if (n.owner !== 0 || (camera.scale < 1.7 && n.id !== selected)) continue;
      const p=projection(n.id),[x,y]=xy[n.id];
      const t=element('text',{x,y:y+53,'font-size':12,fill:'#92ebc9'},graph);
      t.textContent='+'+fmtUX(p.income)+' / I '+fmtUX(p.invest);
    }
  };

  // Existing DOM allocators and policy evaluation remain authoritative.
  positionNodeDetails = function() {};
  showNodeOnMobile = function() {
    if (selected !== null && !nodeDialog.open) nodeDialog.showModal();
  };
  const oldClickNode = clickNode;
  clickNode = function(id) {
    if (state.nodes[id] && state.nodes[id].owner === 0) {
      selected=id;
      render();
      showNodeOnMobile();
    } else {
      selected=id;
      render();
      showNodeOnMobile();
    }
  };
  const originalOrders = renderOrders;
  renderOrders = function() {
    originalOrders();
    ordersContainer.querySelectorAll('.order-top button:first-child').forEach((button) => {
      const original = button.onclick;
      button.onclick = (event) => {
        original(event);
        if (ordersDialog.open) ordersDialog.close();
        showNodeOnMobile();
      };
    });
  };

  const selectedBulk = new Set();
  const originalDashboard = renderDashboard;
  renderDashboard = function() {
    originalDashboard();
    if (currentView !== 'dashboard') return;
    const dash = byId('dashboard');
    const mine = state.nodes.filter(n => n.owner === 0);
    const energy = mine.reduce((a,n) => a+n.active,0);
    const invested = mine.reduce((a,n) => a+n.invested,0);
    const defense = mine.reduce((a,n) => a+projection(n.id).defense,0);
    const summary = document.createElement('div');
    summary.className = 'ux-summary';
    [[ 'Your nodes', mine.length ],[ 'Active energy', fmtUX(energy) ],[ 'Invested',fmtUX(invested) ],[ 'Defense preview',fmtUX(defense) ]].forEach(([label,v])=>{
      const item=document.createElement('div');
      const title=document.createElement('span');title.textContent=label;
      const value=document.createElement('strong');value.textContent=v;
      item.append(title,value);summary.append(item);
    });
    dash.querySelector('h3').after(summary);
    const cards = document.createElement('div');
    cards.className = 'ux-node-cards';
    for (const n of mine) {
      const p=projection(n.id), card=document.createElement('article');
      card.className='ux-node-card';
      const head=document.createElement('div');
      head.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:8px';
      const label=document.createElement('label');
      label.style.cssText='display:flex;align-items:center;gap:8px';
      const check=document.createElement('input');check.type='checkbox';check.checked=selectedBulk.has(n.id);
      check.onchange=()=>{ if(check.checked)selectedBulk.add(n.id);else selectedBulk.delete(n.id);syncBulk(); };
      label.append(check,document.createTextNode('Node '+n.id));
      const edit=document.createElement('button');edit.textContent='Edit →';
      edit.onclick=()=>{selected=n.id;switchView('map');showNodeOnMobile();};
      head.append(label,edit);
      const desc=document.createElement('div');desc.className='muted';
      desc.textContent='Active '+fmtUX(n.active)+' · Invested '+fmtUX(n.invested)+' · Defense '+fmtUX(p.defense)+' · Next '+fmtUX(p.next);
      desc.style.cssText='font-size:12px;line-height:1.7;margin-top:8px';
      card.append(head,desc);cards.append(card);
    }
    dash.append(cards);
    dash.querySelectorAll('.bulk-node').forEach(c => {c.checked=selectedBulk.has(Number(c.dataset.node));c.addEventListener('change',()=>{const id=Number(c.dataset.node);if(c.checked)selectedBulk.add(id);else selectedBulk.delete(id);syncBulk();});});
    function syncBulk() {
      dash.querySelectorAll('.bulk-node').forEach(c=>{c.checked=selectedBulk.has(Number(c.dataset.node));});
      cards.querySelectorAll('input[type=checkbox]').forEach((c,i)=>{c.checked=selectedBulk.has(mine[i].id);});
    }
  };

  let lastMap = '';
  const originalRender = render;
  function worldBounds() {
    return (xy.length === 14 && mapSeed === 'classic') ? [800,460] : [1800,1050];
  }
  function viewBounds() {
    const [baseW,baseH]=worldBounds(),el=byId('mapViewport');
    const vw = mobile() ? 800 : baseW;
    const w=Math.max(260,el.clientWidth||window.innerWidth);
    const h=Math.max(260,el.clientHeight||window.innerHeight*.6);
    return [vw,vw*h/w,baseW,baseH];
  }
  function redrawCamera() {
    const [vw,vh]=viewBounds();
    byId('map').setAttribute('viewBox','0 0 '+vw+' '+vh);
    const g=byId('map').querySelector('g');
    if (g) g.setAttribute('transform','translate('+camera.x+' '+camera.y+') scale('+camera.scale+')');
  }
  function fitCameraUX() {
    const [vw,vh,bw,bh]=viewBounds();
    const scale=Math.min((vw-100)/bw,(vh-120)/bh);
    camera={x:(vw-bw*scale)/2,y:(vh-bh*scale)/2,scale:scale};
    render();
  }
  function focusCameraUX(id) {
    const n=state.nodes[id];
    if (!n || !xy[id]) return;
    const [vw,vh]=viewBounds();
    const scale=mobile()?2.35:1.75;
    camera={x:vw/2-xy[id][0]*scale,y:vh/2-xy[id][1]*scale,scale};
    render();
  }
  function zoomUX(factor) {
    const [vw,vh]=viewBounds();
    const next=Math.min(6,Math.max(.25,camera.scale*factor));
    factor=next/camera.scale;
    camera={x:vw/2-(vw/2-camera.x)*factor,y:vh/2-(vh/2-camera.y)*factor,scale:next};
    render();
  }
  render = function() {
    originalRender();
    const key=mapSeed+'/'+N+'/'+edges.length+'/'+state.round;
    if(key!==lastMap) {
      const isFirst=lastMap==='';
      lastMap=key;
      if(mobile() && (isFirst || state.round===1)) {
        const mine=state.nodes.find(n=>n.owner===0);
        if(mine){const [vw,vh]=viewBounds(),scale=2.35;camera={x:vw/2-xy[mine.id][0]*scale,y:vh/2-xy[mine.id][1]*scale,scale};}
      }
    }
    redrawCamera();
    const own=state.nodes.filter(n=>n.owner===0);
    const present=own.filter(n=>orders[n.id]||policies[n.id]).length;
    byId('uxDockCount').textContent='('+present+')';
    byId('uxSideCount').textContent=present+' nodes';
    const selectedNode=selected===null?null:state.nodes[selected];
    const sideSelection=byId('uxSideSelection');sideSelection.replaceChildren();
    if(selectedNode) {
      const card=document.createElement('div');card.className='ux-node-card';
      const title=document.createElement('strong');title.textContent='Node '+selected;
      const subtitle=document.createElement('p');subtitle.className='muted';
      subtitle.textContent=fmtUX(selectedNode.active)+' active · '+fmtUX(selectedNode.invested)+' invested';
      const edit=document.createElement('button');edit.textContent=selectedNode.owner===0?'Edit orders →':'Inspect node →';edit.onclick=()=>showNodeOnMobile();
      card.append(title,subtitle,edit);sideSelection.append(card);
    } else {
      const p=document.createElement('p');p.className='muted';p.textContent='Select a node on the map to inspect it.';sideSelection.append(p);
    }
    const mini=byId('uxSideOrders');mini.replaceChildren();
    const plans=own.filter(n=>orders[n.id]||policies[n.id]);
    if(!plans.length)mini.textContent='No orders planned.';
    for(const n of plans.slice(0,5)) {
      const row=document.createElement('div'),a=allocated(n.id),pol=policyOrders(n.id).reduce((s,o)=>s+o.amount,0);
      row.textContent='Node '+n.id+' · Manual '+fmtUX(a)+' · Policy '+fmtUX(pol);
      mini.append(row);
    }
    const statsEl=byId('uxEditorStats'),budget=byId('uxBalance'),note=byId('uxCombatNote'),foot=byId('uxFooterSummary');
    if(!selectedNode) {statsEl.replaceChildren();budget.hidden=true;note.textContent='';foot.textContent='';}
    else {
      const id=selected, p=projection(id),manual=selectedNode.owner===0?allocated(id):0;
      const auto=selectedNode.owner===0?policyOrders(id).reduce((s,o)=>s+o.amount,0):0;
      const defense=Math.max(0,selectedNode.active-manual-auto);
      statsEl.innerHTML='';
      for (const [label,value] of [['Active',fmtUX(selectedNode.active)],['Invested',fmtUX(selectedNode.invested)],['Defense',fmtUX(defense)]]) {
        const box=document.createElement('div');box.className='ux-stat';
        const name=document.createElement('span');name.textContent=label;
        const v=document.createElement('strong');v.textContent=value;
        box.append(name,v);statsEl.append(box);
      }
      const portion = n => selectedNode.active>0?Math.max(0,100*n/selectedNode.active):0;
      budget.hidden=selectedNode.owner!==0;
      budget.innerHTML='<div class="ux-budget-head"><strong>Energy budget</strong><span>'+fmtUX(selectedNode.active)+' available</span></div><div class="ux-budget-bar"><span style="background:#5398f7;width:'+portion(manual)+'%"></span><span style="background:#8b79db;width:'+portion(auto)+'%"></span><span style="background:#60d5a6;width:'+portion(defense)+'%"></span></div><div class="ux-budget-legend"><span>Manual <b>'+fmtUX(manual)+'</b></span><span>Policy <b>'+fmtUX(auto)+'</b></span><span>Defense <b>'+fmtUX(defense)+'</b></span></div>';
      byId('uxManualSection').hidden=selectedNode.owner!==0;
      byId('uxPolicySection').hidden=selectedNode.owner!==0;
      jumps.hidden=selectedNode.owner!==0;
      const neighboring=neighbors(id).filter(dest=>state.nodes[dest].owner!==0);
      note.textContent=selectedNode.owner!==0
        ? 'Opponent and neutral energy can be inspected here. Select a friendly adjacent node to allocate an attack.'
        : 'Attack and defense each receive independent ×0.8–1.2 strength modifiers. Targets can change during simultaneous resolution; displayed energy is not a win probability.';
      foot.textContent=selectedNode.owner===0
        ? 'Defense '+fmtUX(defense)+' · Next active '+fmtUX(p.next)+' (estimate without combat)'
        : 'No orders can be issued from this node.';
    }
  };
  byId('zoomIn').onclick=()=>zoomUX(1.25);
  byId('zoomOut').onclick=()=>zoomUX(.8);
  byId('fit').onclick=fitCameraUX;
  focusButton.onclick=()=>{
    const id=selected===null?state.nodes.find(n=>n.owner===0)?.id:selected;
    if(id!==undefined && id!==null)focusCameraUX(id);
  };
  window.addEventListener('resize',redrawCamera);
  byId('overlay').onchange=render;
  byId('clearAll').onclick=()=>{orders={};render();};
  // The original HTML has inline-mobile navigation; the native dialogs supersede it.
  render();
  if(mobile()) {
    const mine=state.nodes.find(n=>n.owner===0);
    if(mine) focusCameraUX(mine.id);
  }
})();
