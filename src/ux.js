'use strict';
// prettier-ignore
(() => {
  // Presentation-only enhancements. Game state and round resolution remain in game.js.
  const byId = (id) => document.getElementById(id);
  const mobile = () => window.matchMedia('(max-width:760px)').matches;
  const fmtUX = exactEnergy;
  const nodeDialog = byId('nodeDialog');
  // Selection exists only while inspecting/editing a node; Focus remembers
  // the latest inspected node independently of the active editor.
  let lastInspectedNodeId = state.nodes[selected] ? selected : null;
  selected = null;
  const oldHeader = nodeDialog.querySelector('.mobile-node-header');
  const oldClose = byId('closeNodeDialog');
  const slot = byId('nodeDetailsSlot');
  const originalAside = byId('gameSidebar');
  const settingsBox = byId('autoConquer').closest('.policy-box');
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
  const newGameButton = document.createElement('button');
  newGameButton.type = 'button';
  newGameButton.textContent = 'New game…';
  newGameButton.style.marginTop = '16px';
  newGameButton.onclick = () => { settingsDialog.close(); byId('reset').click(); };
  settingsBody.append(newGameButton);

  oldHeader.replaceChildren();
  oldHeader.append(selectedTitle, oldClose);
  oldClose.textContent = '← Back to map';
  oldClose.onclick = () => nodeDialog.close();
  nodeDialog.addEventListener('close', () => {
    if (selected === null) return;
    lastInspectedNodeId = selected;
    selected = null;
    // A closed editor must not leave a persistent node highlight or sidebar selection.
    render();
  });
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
  // Show every planned attack and support transfer by default.
  // Players can explicitly filter flow types without losing economy labels.
  byId('overlay').value = 'all';
  const focusButton = document.createElement('button');
  focusButton.id = 'focusMap';
  focusButton.type = 'button';
  focusButton.textContent = 'Focus';
  focusButton.title = 'Focus on the last inspected node';
  byId('fit').after(focusButton);

  // Keep the game's normal renderer and engine; only change graphical overlays.
  const originalRenderFlows = renderFlows;
  renderFlows = function(svg, graph, element) {
    const filter = byId('overlay').value;
    const paths = filter === 'none' ? [] : previewOrders();
    for (const o of paths) {
      if (o.dest === null || o.dest === undefined || o.amount <= .01) continue;
      if (filter === 'manual' && o.automatic) continue;
      if (filter === 'policy' && !o.automatic) continue;
      const [ax,ay] = xy[o.source], [bx,by] = xy[o.dest];
      const dx=bx-ax,dy=by-ay,len=Math.hypot(dx,dy)||1;
      const fromX=ax+dx/len*32,fromY=ay+dy/len*32,toX=bx-dx/len*35,toY=by-dy/len*35;
      const color=o.type==='attack'?'#ff987f':o.automatic?'#76b3ff':'#63d9af';
      element('line',{x1:fromX,y1:fromY,x2:toX,y2:toY,stroke:color,'stroke-width':4,'stroke-dasharray':o.automatic?'8 5':'none',class:'ux-flow-overlay'},graph);
      const arrow=element('path',{d:'M '+toX+' '+toY+' l '+(-dx/len*12-dy/len*5)+' '+(-dy/len*12+dx/len*5)+' l '+(dy/len*10)+' '+(-dx/len*10)+' Z',fill:color,class:'ux-flow-overlay'},graph);
      const label=element('text',{x:(ax+bx)/2-dy/len*15,y:(ay+by)/2+dx/len*15,class:'flow-label'},graph);
      label.textContent=compactEnergy(o.amount);
    }
    // Next-round income/investment previews are economic status, not flow
    // arrows; keep them on every owned node at every zoom and filter level.
    for (const n of state.nodes) {
      if (n.owner !== 0) continue;
      const p=projection(n.id),[x,y]=xy[n.id];
      const t=element('text',{x,y:y+53,'font-size':12,fill:'#92ebc9',class:'ux-income-label'},graph);
      t.textContent='+'+compactEnergy(p.income)+' / I '+compactEnergy(p.invest)+(softCapEnabled()&&p.overflow>.05?' / −'+compactEnergy(p.overflow):'');
    }
  };

  // Existing DOM allocators and policy evaluation remain authoritative.
  positionNodeDetails = function() {};
  showNodeOnMobile = function() {
    if (selected !== null && !nodeDialog.open) nodeDialog.showModal();
  };
  clickNode = function(id) {
    if (!state.nodes[id]) return;
    lastInspectedNodeId = id;
    selected = id;
    render();
    showNodeOnMobile();
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
    // Bulk policy edits should not erase existing transfer destinations.
    byId('bulkApply').onclick=()=>{
      const reserve=Math.max(0,Number(byId('bulkReserve').value)||0);
      const investPct=Math.max(0,Math.min(100,Number(byId('bulkInvest').value)||0));
      const chosen=[...selectedBulk].filter(id=>state.nodes[id]?.owner===0);
      if(!chosen.length) {byId('bulkApply').title='Select nodes first';return;}
      for(const id of chosen) policies[id]={...defaultPolicy(),...policies[id],enabled:true,reserve,investPct};
      render();
    };
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
      desc.textContent='Active '+fmtUX(n.active)+' · Invested '+fmtUX(n.invested)+' · Defense '+fmtUX(p.defense)+' · Next '+fmtUX(p.next)+(softCapEnabled()?' · Capacity '+fmtUX(n.active+n.invested)+'/'+SOFT_CAP_RULES.capacity+' · Overflow loss '+fmtUX(p.overflow):'');
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
    if (!mobile()) { camera={x:0,y:0,scale:1}; render(); return; }
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
    heading.hidden=currentView!=='map';
    document.querySelector('.layout').classList.toggle('ux-wide-view',currentView!=='map');
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
      subtitle.textContent=fmtUX(selectedNode.active)+' active · '+fmtUX(selectedNode.invested)+' invested'+(softCapEnabled()?' · '+fmtUX(selectedNode.active+selectedNode.invested)+'/'+SOFT_CAP_RULES.capacity+' capacity':'');
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
      const defense=Math.max(0,(selectedNode.owner===0?availableEnergy(id):selectedNode.active)-manual-auto);
      statsEl.innerHTML='';
      for (const [label,value] of [['Active',fmtUX(selectedNode.active)],['Invested',fmtUX(selectedNode.invested)],['Defense',fmtUX(defense)],...(softCapEnabled()&&selectedNode.owner!==null?[['Total / cap',fmtUX(selectedNode.active+selectedNode.invested)+' / '+SOFT_CAP_RULES.capacity]]:[])]) {
        const box=document.createElement('div');box.className='ux-stat';
        const name=document.createElement('span');name.textContent=label;
        const v=document.createElement('strong');v.textContent=value;
        box.append(name,v);statsEl.append(box);
      }
      const budgetTotal=selectedNode.owner===0?availableEnergy(id):selectedNode.active;
      const portion = n => budgetTotal>0?Math.max(0,100*n/budgetTotal):0;
      budget.hidden=selectedNode.owner!==0;
      budget.innerHTML='<div class="ux-budget-head"><strong>Energy budget</strong><span>'+fmtUX(budgetTotal)+' available'+(softCapEnabled()&&selectedNode.owner===0?' (withdraw '+fmtUX(withdrawal(id))+')':'')+'</span></div><div class="ux-budget-bar"><span style="background:#5398f7;width:'+portion(manual)+'%"></span><span style="background:#8b79db;width:'+portion(auto)+'%"></span><span style="background:#60d5a6;width:'+portion(defense)+'%"></span></div><div class="ux-budget-legend"><span>Manual <b>'+fmtUX(manual)+'</b></span><span>Policy <b>'+fmtUX(auto)+'</b></span><span>Defense <b>'+fmtUX(defense)+'</b></span></div>';
      byId('uxManualSection').hidden=selectedNode.owner!==0;
      byId('uxPolicySection').hidden=selectedNode.owner!==0;
      jumps.hidden=selectedNode.owner!==0;
      // Existing combat math is unchanged: show strength intervals, not win odds.
      if (selectedNode.owner===0) {
        allocator.querySelectorAll('.allocation-line').forEach((row,i)=>{
          if (i<(softCapEnabled()?2:1)) return;
          const dest=neighbors(id)[i-(softCapEnabled()?2:1)], target=state.nodes[dest];
          if(!target || target.owner===0) return;
          const attack=plan(id).edges[dest]||0;
          const cap=document.createElement('small');
          cap.style.cssText='display:block;font-size:11px;line-height:1.5;color:#adc3d9';
          cap.textContent='Attack strength '+fmtUX(attack*.8)+'–'+fmtUX(attack*1.2)+' · Current defense '+fmtUX(target.active*.8)+'–'+fmtUX(target.active*1.2);
          row.querySelector('label')?.append(cap);
        });
      }
      note.textContent=selectedNode.owner!==0
        ? 'Opponent and neutral energy can be inspected here. Select a friendly adjacent node to allocate an attack.'
        : 'Attack and defense each receive independent ×0.8–1.2 strength modifiers. Targets can change during simultaneous resolution; displayed energy is not a win probability.';
      foot.textContent=selectedNode.owner===0
        ? 'Defense '+fmtUX(defense)+' · Next active '+fmtUX(p.next)+(softCapEnabled()?' · Overflow '+fmtUX(p.overflow):'')+' (estimate without combat)'
        : 'No orders can be issued from this node.';
    }
  };
  byId('zoomIn').onclick=()=>zoomUX(1.25);
  byId('zoomOut').onclick=()=>zoomUX(.8);
  byId('fit').onclick=fitCameraUX;
  focusButton.onclick=()=>{
    const id=state.nodes[lastInspectedNodeId]
      ? lastInspectedNodeId
      : state.nodes.find(n=>n.owner===0)?.id;
    if(id!==undefined && id!==null)focusCameraUX(id);
  };
  // Opening the on-screen keyboard resizes the mobile viewport. Moving
  // focused input elements between parents here blurs them and immediately
  // dismisses the keyboard; the editor is already in its final layout.
  window.addEventListener('resize', redrawCamera);
  byId('overlay').onchange=render;
  byId('clearAll').onclick=()=>{orders={};render();};
  // The original HTML has inline-mobile navigation; the native dialogs supersede it.
  render();
  if(mobile()) {
    const mine=state.nodes.find(n=>n.owner===0);
    if(mine) focusCameraUX(mine.id);
  }
})();
