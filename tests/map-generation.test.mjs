import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const src=readFileSync(new URL('../src/game.js',import.meta.url),'utf8');
const functions=src.slice(src.indexOf('function seeded('),src.indexOf('function previewMap('));
const buildMap=runInNewContext(functions+';buildMap');

test('generated maps keep nodes visually separated',()=>{
 for(const count of [10,30,60,90,120])for(let i=0;i<10;i++){
  const map=buildMap({count,players:3,density:'normal',seed:'layout-'+i});
  for(let a=0;a<count;a++)for(let b=a+1;b<count;b++){
   const distance=Math.hypot(map.positions[a][0]-map.positions[b][0],map.positions[a][1]-map.positions[b][1]);
   assert.ok(distance>=75,'nodes '+a+' and '+b+' overlap at '+distance+' (count='+count+')');
  }
 }
});
test('generation is reproducible and graph remains connected',()=>{
 const input={count:50,players:4,density:'dense',seed:'repeatable'};
 const first=buildMap(input),second=buildMap(input);
 assert.equal(JSON.stringify(first),JSON.stringify(second));
 const visited=new Set([0]);let changed=true;
 while(changed){changed=false;for(const [a,b] of first.links){if(visited.has(a)&&!visited.has(b)){visited.add(b);changed=true}else if(visited.has(b)&&!visited.has(a)){visited.add(a);changed=true}}}
 assert.equal(visited.size,50);
 assert.equal(first.nodes.filter(n=>n.owner!==null).length,4);
});
