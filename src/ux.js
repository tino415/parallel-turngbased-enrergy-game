'use strict';
// prettier-ignore
(() => {
  // Presentation-only enhancements. Game state and round resolution remain in game.js.
  const byId = (id) => document.getElementById(id);
  const mobile = () => window.matchMedia('(max-width:760px)').matches;
  const fmtUX = exactEnergy;
  const nodeDialog = byId('nodeDialog');
  // Selection exists only while inspecting/editing a node.
  store.select(null);
  const oldHeader = nodeDialog.querySelector('.mobile-node-header');
  const oldClose = byId('closeNodeDialog');
  const selectedTitle = byId('selectedTitle');
  const details = byId('details');
  const hint = byId('hint');
  const allocator = byId('allocator');
  const policyEditor = byId('policyEditor');

  const ordersDialog = byId('uxOrdersDialog');
  const settingsDialog = byId('uxSettingsDialog');

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

  const reviewHead = document.createElement('button');
  reviewHead.id = 'uxReviewHead';
  reviewHead.type = 'button';
  reviewHead.textContent = 'Orders';
  reviewHead.onclick = () => ordersDialog.showModal();
  const headerActions = document.querySelector('body > header > div:last-child');
  headerActions.insertBefore(reviewHead, byId('resolve'));
  byId('mobileSettings').onclick = () => settingsDialog.showModal();

  const dock = document.createElement('div');
  dock.className = 'ux-dock';
  dock.innerHTML = '<button type="button" id="uxDockOrders">☷ Orders <span id="uxDockCount"></span></button><button type="button" class="primary" id="uxDockResolve">Resolve round →</button>';
  document.body.append(dock);
  byId('uxDockOrders').onclick = () => ordersDialog.showModal();
  byId('uxDockResolve').onclick = () => byId('resolve').click();

  const heading = document.createElement('div');
  heading.className = 'ux-map-heading';
  heading.innerHTML = '<div><h2>Tactical map</h2><p class="muted">Select a node to inspect or issue orders</p></div>';
  byId('mapViewport').before(heading);
  const toolbar = document.querySelector('.toolbar');
  const hintZoom = toolbar.querySelector('.desktop-zoom-hint');
  if (hintZoom) hintZoom.remove();
  const focusButton = document.createElement('button');
  focusButton.id = 'focusMap';
  focusButton.type = 'button';
  focusButton.textContent = 'Focus';
  focusButton.title = 'Focus on the last inspected node';
  byId('fit').after(focusButton);

  // Keep the game's normal renderer and engine; only change graphical overlays.
  const originalRenderFlows = renderFlows;
  renderFlows = function(svg, graph, element) {
    for (const o of previewOrders()) {
      if (o.dest === null || o.dest === undefined || o.amount <= .01) continue;
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
    // arrows; keep them on every owned node at every zoom level.
    for (const n of state.nodes) {
      if (n.owner !== 0) continue;
      const p=projection(n.id),[x,y]=xy[n.id];
      const t=element('text',{x,y:y+53,'font-size':12,fill:'#92ebc9',class:'ux-income-label'},graph);
      const bank=Object.values(policies[n.id]?.pressure??{}).reduce((sum,edge)=>sum+(edge.bank??0),0);
      t.textContent='+'+compactEnergy(p.income)+' / I '+compactEnergy(p.invest)+(softCapEnabled()&&p.overflow>.05?' / −'+compactEnergy(p.overflow):'')+(bank>.05?' / ⟂ '+compactEnergy(bank):'');
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
    if (!mobile()) { store.setCamera({x:0,y:0,scale:1}); render(); return; }
    const [vw,vh,bw,bh]=viewBounds();
    const scale=Math.min((vw-100)/bw,(vh-120)/bh);
    store.setCamera({x:(vw-bw*scale)/2,y:(vh-bh*scale)/2,scale:scale});
    render();
  }
  function focusCameraUX(id) {
    const n=state.nodes[id];
    if (!n || !xy[id]) return;
    const [vw,vh]=viewBounds();
    const scale=mobile()?2.35:1.75;
    store.setCamera({x:vw/2-xy[id][0]*scale,y:vh/2-xy[id][1]*scale,scale});
    render();
  }
  function zoomUX(factor) {
    const [vw,vh]=viewBounds();
    const next=Math.min(6,Math.max(.25,camera.scale*factor));
    factor=next/camera.scale;
    store.setCamera({x:vw/2-(vw/2-camera.x)*factor,y:vh/2-(vh/2-camera.y)*factor,scale:next});
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
        if(mine){const [vw,vh]=viewBounds(),scale=2.35;store.setCamera({x:vw/2-xy[mine.id][0]*scale,y:vh/2-xy[mine.id][1]*scale,scale});}
      }
    }
    redrawCamera();
    const own=state.nodes.filter(n=>n.owner===0);
    const present=own.filter(n=>orders[n.id]||policies[n.id]).length;
    byId('uxDockCount').textContent='('+present+')';
    const selectedNode=selected===null?null:state.nodes[selected];
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
  // Opening the on-screen keyboard resizes the mobile viewport. Moving
  // focused input elements between parents here blurs them and immediately
  // dismisses the keyboard; the editor is already in its final layout.
  window.addEventListener('resize', redrawCamera);
  render();
  if(mobile()) {
    const mine=state.nodes.find(n=>n.owner===0);
    if(mine) focusCameraUX(mine.id);
  }
})();
