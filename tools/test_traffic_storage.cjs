const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {loadFeature}=require('./frontend_test_module.cjs');
let IDB;try{IDB=require('fake-indexeddb');}catch{IDB=require(path.resolve(process.env.LOCALDNS_TEST_DEPS||'deployment/tools/wallpaper-test-deps/node_modules','fake-indexeddb'));}
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
