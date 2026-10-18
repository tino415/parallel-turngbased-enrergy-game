#!/usr/bin/env node
// Experimental economics only. This file is not imported by the browser or production engine.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { planStrategyOrders } from '../tests/support/strategies.mjs';

const source = readFileSync(new URL('../src/engine.js', import.meta.url), 'utf8');
const exact = 'const income = 1 + n.invested * 0.1;';
assert.equal(source.split(exact).length, 2, 'Engine economy anchor changed; review experiment adapter');
const rules = {
  baseline: exact,
  // Principal beyond 100 per node still earns, but at a decreasing marginal rate.
  diminishing: 'const income = 1 + 0.1 * 100 * Math.log1p(n.invested / 100);',
  // Every node can productively employ only 100 principal at the full interest rate.
  capacity: 'const income = 1 + 0.1 * Math.min(n.invested, 100);',
  // Flat 10% yield on the first 100 principal, 2% thereafter.
  tiered: 'const income = 1 + 0.1 * Math.min(n.invested, 100) + 0.02 * Math.max(0, n.invested - 100);',
};
const engines = Object.fromEntries(Object.entries(rules).map(([name, rule]) => {
  const engine = runInNewContext(source.replace(exact, rule) + '\n;GameEngine');
  return [name, engine];
}));
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const m = /^--([a-z-]+)=(.+)$/.exec(arg);
  if (!m) throw Error('Expected --name=value: ' + arg);
  return [m[1], m[2]];
}));
const matches = Number(args.matches ?? 30);
const rounds = Number(args.rounds ?? 300);
const nodesCount = Number(args.nodes ?? 20);
const players = Number(args.players ?? 2);
const seed = args.seed ?? 'economy-experiment-v1';
const opponent = args.opponent ?? 'default';
const density = args.density ?? 'normal';
const attackPct = Number(args['attack-pct'] ?? 5);
assert.ok(Number.isSafeInteger(matches) && matches > 0 && matches <= 1000);
assert.ok(Number.isSafeInteger(rounds) && rounds > 0 && rounds <= 1000);
assert.ok(Number.isSafeInteger(players) && players >= 2 && players <= 6);
assert.ok(Number.isSafeInteger(nodesCount) && nodesCount >= 10 && nodesCount <= 120);
assert.ok(['default','aggressive','balanced'].includes(opponent));
assert.ok(['normal','dense','sparse'].includes(density));

const med = xs => { const v = [...xs].sort((a,b)=>a-b); const m = v.length>>1; return v.length%2?v[m]:(v[m-1]+v[m])/2; };
const pct = x => Math.round(10000*x)/100;
function incomeFor(rule, invested) {
  if (rule === 'diminishing') return 10 * Math.log1p(invested/100);
  if (rule === 'capacity') return .1 * Math.min(invested,100);
  if (rule === 'tiered') return .1*Math.min(invested,100)+.02*Math.max(0,invested-100);
  return .1*invested;
}
function play(rule, strategy, index) {
  const engine=engines[rule], mapSeed=seed+':map:'+index, combatSeed=seed+':combat:'+index;
  const map=engine.buildMap({count:nodesCount,players,density,seed:mapSeed});
  const rng=engine.seeded(combatSeed), homeNodes=Array.from({length:players},(_,owner)=>map.nodes.find(n=>n.owner===owner).id);
  const strategies=[strategy,...Array(players-1).fill(opponent)];
  let state={round:1,finished:false,nodes:map.nodes}, policies={}, firstConquest=null, peak=1, captures=0,lastCapture=0;
  let cumulativeIncome=0, priorShare=null, lowestShare=1, regainedShare=0;
  const hash=createHash('sha256');
  hash.update(JSON.stringify(map.nodes));
  while (!state.finished && state.round<=rounds) {
    const choices=planStrategyOrders({engine,nodes:state.nodes,links:map.links,strategies,round:state.round,homeNodes,attackPct});
    const orders={}, aiOrdersOverride=[];
    for (const [key,choice] of Object.entries(choices)) {
      const entries=Array.isArray(choice)?choice:[choice];
      if(state.nodes[Number(key)].owner===0) {
        const order={invest:0,edges:{}};
        for(const c of entries) if(c.type==='invest') order.invest+=c.amount; else order.edges[c.dest]=(order.edges[c.dest]??0)+c.amount;
        orders[key]=order;
      } else aiOrdersOverride.push(...entries);
    }
    const before=state.nodes;
    const resolved=engine.resolveRound({state,orders,policies,links:map.links,rng,aiOrdersOverride});
    state=resolved.state; policies=resolved.policies;
    for(let j=0;j<nodesCount;j++) if(before[j].owner!==state.nodes[j].owner) {
      captures++;lastCapture=state.round-1;
      if(state.nodes[j].owner===0 && firstConquest===null) firstConquest=state.round-1;
    }
    const owned=state.nodes.filter(n=>n.owner===0);
    peak=Math.max(peak,owned.length);
    const perPlayer=Array.from({length:players},(_,p)=>state.nodes.filter(n=>n.owner===p).reduce((s,n)=>s+1+incomeFor(rule,n.invested),0));
    const total=perPlayer.reduce((a,b)=>a+b,0);
    const share=total?perPlayer[0]/total:0;
    // A trailing-window proxy for economic recovery after falling behind.
    if (priorShare!==null && share>lowestShare) regainedShare=Math.max(regainedShare,share-lowestShare);
    lowestShare=Math.min(lowestShare,share); priorShare=share;
    cumulativeIncome+=perPlayer[0];
    hash.update(JSON.stringify(state));
  }
  const standings=Array.from({length:players},(_,p)=>{
    const ns=state.nodes.filter(n=>n.owner===p);
    return {nodes:ns.length,active:ns.reduce((s,n)=>s+n.active,0),invested:ns.reduce((s,n)=>s+n.invested,0),gross:ns.reduce((s,n)=>s+1+incomeFor(rule,n.invested),0)};
  });
  const total=standings.reduce((a,b)=>a+b.gross,0);
  return {mapSeed,combatSeed,rule,strategy,rounds:state.round-1,finished:state.finished,
    winner:state.finished?standings.findIndex(s=>s.nodes>0):null,
    survived:standings[0].nodes>0,expanded:peak>1,firstConquest,peakNodes:peak,
    standings, incomeShare:total?standings[0].gross/total:0,cumulativeIncome,captures,
    stalemate:!state.finished && state.round-1-lastCapture>=25,
    recoveryProxy:regainedShare, checksum:hash.digest('hex')};
}
const scenarios=['superturtle','compoundexpand'];
const all={metadata:{seed,matches,rounds,nodes:nodesCount,players,opponent,density,attackPct,
  note:'Simulation-only economy patch; identical map/combat seed inputs, but RNG consumption may diverge after different decisions. RecoveryProxy is NOT a calibrated comeback metric.'},results:{}};
for(const rule of Object.keys(rules)) {
  all.results[rule]={};
  for(const strategy of scenarios) {
    const results=Array.from({length:matches},(_,i)=>play(rule,strategy,i));
    all.results[rule][strategy]={
      results,summary:{wins:results.filter(x=>x.winner===0).length,survival:results.filter(x=>x.survived).length,
        expansion:results.filter(x=>x.expanded).length,stalemates:results.filter(x=>x.stalemate).length,
        unresolved:results.filter(x=>!x.finished).length,
        medianRounds:med(results.map(x=>x.rounds)),medianNodes:med(results.map(x=>x.standings[0].nodes)),
        medianActive:med(results.map(x=>x.standings[0].active)),
        medianInvested:med(results.map(x=>x.standings[0].invested)),
        medianTotalEnergy:med(results.map(x=>x.standings[0].active+x.standings[0].invested)),
        medianGross:med(results.map(x=>x.standings[0].gross)),
        medianCumulative:med(results.map(x=>x.cumulativeIncome)),
        medianIncomeSharePct:pct(med(results.map(x=>x.incomeShare))),
        medianRecoveryProxyPct:pct(med(results.map(x=>x.recoveryProxy)))}};
  }
  const pairs=all.results[rule].superturtle.results.map((a,i)=>[a,all.results[rule].compoundexpand.results[i]]);
  all.results[rule].expanderVsTurtle={
    medianGrossRatio:med(pairs.filter(([a,b])=>a.rounds===b.rounds && a.standings[0].gross>0).map(([a,b])=>b.standings[0].gross/a.standings[0].gross)),
    medianCumulativeRatio:med(pairs.filter(([a])=>a.cumulativeIncome>0).map(([a,b])=>b.cumulativeIncome/a.cumulativeIncome)),
    expansionAdvantageCount:pairs.filter(([a,b])=>b.standings[0].gross>a.standings[0].gross).length
  };
}
if(args.json==='true') console.log(JSON.stringify(all,null,2));
else {
 console.log('seed='+seed+' matches='+matches+' rounds='+rounds+' nodes='+nodesCount+' players='+players+' opponent='+opponent);
 console.log('| Rule | Strategy | Wins | Survival | Expansion | Stalemates | Median nodes | Median total | Median gross/turn | Gross share % |');
 console.log('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|');
 for(const [rule,strategies] of Object.entries(all.results)) for(const name of scenarios) {
   const s=strategies[name].summary;
   console.log('| '+[rule,name,s.wins,s.survival,s.expansion,s.stalemates,s.medianNodes,s.medianTotalEnergy.toPrecision(5),s.medianGross.toPrecision(5),s.medianIncomeSharePct].join(' | ')+' |');
 }
 console.log('\nPaired expander/turtle ratios:');
 for(const [rule,value] of Object.entries(all.results)) console.log(rule+': final gross '+value.expanderVsTurtle.medianGrossRatio.toFixed(4)+'x; cumulative '+value.expanderVsTurtle.medianCumulativeRatio.toFixed(4)+'x');
}
