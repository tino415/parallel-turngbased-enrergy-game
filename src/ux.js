'use strict';
// prettier-ignore
(() => {
  // Presentation-only enhancements. Game state and round resolution remain in game.js.
  const byId = (id) => document.getElementById(id);
  const mobile = () => window.matchMedia('(max-width:760px)').matches;
  // Selection exists only while inspecting/editing a node.
  store.select(null);

  const ordersDialog = byId('uxOrdersDialog');
  const settingsDialog = byId('uxSettingsDialog');

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
  dock.innerHTML = '<button type="button" class="primary" id="uxDockResolve">Resolve round →</button>';
  document.body.append(dock);
  byId('uxDockResolve').onclick = () => byId('resolve').click();

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
      if (!isMine(n.id)) continue;
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
    store.setCamera(fittedCamera());
    render();
  }
  function focusCameraUX(id) {
    if (!state.nodes[id] || !xy[id]) return;
    store.setCamera(cameraFocusedOn(id));
    render();
  }
  function startingCamera() {
    const mine=state.nodes.find(n=>n.owner===0);
    return mobile()&&mine?cameraFocusedOn(mine.id):fittedCamera();
  }
  function fittedCamera() {
    const [vw,vh,bw,bh]=viewBounds(),top=headerOverlap();
    if (!mobile()) {
      const scale=Math.min(1,(vh-top)/bh);
      return {x:(vw-bw*scale)/2,y:top,scale};
    }
    const scale=Math.min((vw-100)/bw,(vh-top-120)/bh);
    return {x:(vw-bw*scale)/2,y:top+(vh-top-bh*scale)/2,scale};
  }
  function cameraFocusedOn(id) {
    const [vw,vh]=viewBounds(),top=headerOverlap();
    const scale=mobile()?2.35:1.75;
    return {x:vw/2-xy[id][0]*scale,y:(top+vh)/2-xy[id][1]*scale,scale};
  }
  function headerOverlap() {
    const viewport=byId('mapViewport'),[vw]=viewBounds();
    const covered=document.querySelector('body > header').getBoundingClientRect().bottom-viewport.getBoundingClientRect().top;
    return Math.max(0,covered)*vw/Math.max(260,viewport.clientWidth||window.innerWidth);
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
    document.querySelector('.layout').classList.toggle('ux-wide-view',currentView!=='map');
    const key=mapSeed+'/'+N+'/'+edges.length+'/'+state.round;
    if(key!==lastMap) {
      const isFirst=lastMap==='';
      lastMap=key;
      if(isFirst || state.round===1) store.setCamera(startingCamera());
    }
    redrawCamera();
  };
  byId('zoomIn').onclick=()=>zoomUX(1.25);
  byId('zoomOut').onclick=()=>zoomUX(.8);
  byId('fit').onclick=fitCameraUX;
  byId('focusMap').onclick=()=>focusCameraUX(store.getSnapshot().ui.inspector.focusedNode);
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
