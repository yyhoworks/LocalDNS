const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
// Every dependency is optional at load time: when one is missing the whole
// file reports a single skipped test with the reason instead of crashing
// with a module error (which used to make the suite silently absent in
// clean environments). fake-indexeddb resolves from, in order: normal
// node_modules lookup, the frontend workspace's node_modules, or an
// explicit LOCALDNS_TEST_DEPS directory -- never a path outside this
// repository.
const missing=[];
let loadFeature=null;
try{ ({loadFeature}=require('./frontend_test_module.cjs')); }catch{ missing.push('frontend 依赖（esbuild 等）'); }
let IDB=null;
for(const candidate of [
  () => require('fake-indexeddb'),
  () => require(path.resolve(__dirname,'..','frontend','node_modules','fake-indexeddb')),
  () => process.env.LOCALDNS_TEST_DEPS ? require(path.resolve(process.env.LOCALDNS_TEST_DEPS,'fake-indexeddb')) : (()=>{throw new Error('unset')})(),
]){ try{ IDB=candidate(); break; }catch{} }
if(!IDB)missing.push('fake-indexeddb');
if(missing.length){
 test('traffic storage repository', {skip:'缺少依赖：'+missing.join('、')+'。请在 frontend/ 执行 npm install，或设置 LOCALDNS_TEST_DEPS 指向含 fake-indexeddb 的 node_modules'}, ()=>{});
}else{
global.IDBKeyRange=IDB.IDBKeyRange;
const TrafficRepository=loadFeature('features/overview/traffic/repository.ts','TrafficRepository',false);
test('persists across instances, isolates API addresses, keeps newest same-slot sample and prunes at 24 hours',async()=>{
 const factory=new IDB.IDBFactory(),repo=new TrafficRepository(()=>factory),base=1792459200000;
 await repo.save('api-a',{time:base,total:10},base);
 await repo.save('api-a',{time:base+1000,total:20},base+1000);
 await repo.save('api-a',{time:base+500,total:15},base+1000);
 await repo.save('api-b',{time:base+1000,total:99},base+1000);
 const again=new TrafficRepository(()=>factory);
 assert.deepEqual((await again.load('api-a',base+2000)).map(p=>p.total),[20]);
 assert.deepEqual((await again.load('api-b',base+2000)).map(p=>p.total),[99]);
 assert.equal((await again.load('api-a',base-1000)).length,0);
 await repo.save('api-a',{time:base+86402000,total:30},base+86402000);
 assert.deepEqual((await again.load('api-a',base+86402000)).map(p=>p.total),[30]);
 assert.equal((await again.load('api-b',base+86402000)).length,0);
});
test('reports unavailable storage without pretending the history was saved',async()=>{
 const repo=new TrafficRepository(()=>{throw new Error('blocked');});
 await assert.rejects(repo.load('a'),/blocked/);
 await assert.rejects(repo.save('a',{time:1000,total:1}),/blocked/);
});
}
