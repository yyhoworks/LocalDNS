/* Browser acceptance uses public fixtures; no production configuration is written. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createPreviewServer}=require('./preview_ui.cjs');
const {chromium}=require(process.env.LOCALDNS_PLAYWRIGHT||'C:/Users/dev/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const output=path.resolve(__dirname,'../dist/server-traffic-fragments-verification');fs.mkdirSync(output,{recursive:true});
(async()=>{
 const server=createPreviewServer({backend:'http://192.168.1.7:9099'});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,channel:'msedge'});const errors=[],ranges=[],checks=[],saves=[];let failFirst=true,trafficReads=0;
 const fragments=new Map([['/etc/sing-box/conf.d/00-base.json','{"log":{"level":"info"}}\n'],['/etc/sing-box/conf.d/10-outbounds.json','{"outbounds":[{"type":"direct","tag":"direct"}]}\n'],['/etc/sing-box/conf.d/20-route.json','{"route":{"final":"direct"}}\n']]);let groupRevision='group-v1';
 const api=async route=>{
  const request=route.request(),url=new URL(request.url()),op=url.pathname.split('/').pop(),body=request.method()==='POST'?request.postDataJSON():{};let result,status=200;
  if(op==='traffic'){
   trafficReads++;ranges.push(Number(url.searchParams.get('minutes')));
   if(failFirst){failFirst=false;status=503;result={error:'测试断线，正在自动重试。'};}
   else{const now=Date.now();result={points:[{time:now-10000,qps:1,delta:5,elapsed:5,peak:1},{time:now-5000,qps:2,delta:10,elapsed:5,peak:2}],current:2,now,error:'',source:'server'};}
  }else if(url.pathname.includes('/interface/'))result={value:null,revision:'new'};
  else if(op==='cores')result={cores:[{id:'sing-box',available:true,exists:true,path:'/etc/sing-box/conf.d/00-base.json',directory:'/etc/sing-box/conf.d',roots:['/etc/sing-box'],mode:'fragments',configDirectories:['/etc/sing-box/conf.d']}]};
  else if(op==='files')result={directory:'/etc/sing-box/conf.d',files:[...fragments].map(([filename,content])=>({path:filename,name:filename.split('/').pop(),bytes:content.length,directory:false,active:true}))};
  else if(op==='read')result={core:'sing-box',path:body.path,content:fragments.get(body.path),revision:'file-v1',active:true,mode:'fragments',groupCount:3,groupRevision};
  else if(op==='check'){checks.push(body);assert.equal(body.groupRevision,groupRevision);result={valid:true,detail:'整套分片校验通过。'};}
  else if(op==='save'){saves.push(body);assert.equal(body.groupRevision,groupRevision);fragments.set(body.path,body.content);groupRevision='group-v2';result={revision:'file-v2',groupRevision,saved:true,reloaded:true,confirmation:'signal-and-health',backup:'/etc/sing-box/localdns-backups/example.bak'};}
  else{status=404;result={error:'unsupported fixture'};}
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
 };
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});await context.route('**/api/proxy-config/**',api);const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));const origin=`http://127.0.0.1:${server.address().port}/ui/`;
  await page.goto(origin);await page.locator('.console-service-summary').waitFor();await page.locator('.traffic-read-error').waitFor();await page.locator('.traffic-chart').waitFor({timeout:15000});assert(trafficReads>=2);assert.equal(await page.locator('.traffic-read-error').count(),0);
  for(const minutes of [60,360,1440,4320,10080]){await page.locator(`[data-chart-range="${minutes}"]`).click();await page.waitForFunction(m=>document.querySelector('.traffic-chart-body')?.dataset.trafficMinutes===String(m),minutes);await page.locator('.traffic-chart').waitFor();assert(ranges.includes(minutes));}
  await page.evaluate(()=>location.hash='#/management');await page.locator('[data-proxy-panel-settings]').waitFor();await page.evaluate(()=>location.hash='#/overview');await page.locator('.traffic-chart').waitFor();
  const freshContext=await browser.newContext();await freshContext.route('**/api/proxy-config/**',api);const freshPage=await freshContext.newPage();await freshPage.goto(origin);await freshPage.locator('.traffic-chart').waitFor();assert.equal(await freshPage.evaluate(()=>Object.keys(sessionStorage).some(k=>k.startsWith('localdns-trends'))),false);await freshContext.close();
  for(const skin of ['claude','glass'])for(const width of [1440,390]){
   await page.setViewportSize({width,height:width===390?844:1000});await page.locator('#btn-open-bg-customizer').click();await page.locator(`[data-skin-select="${skin}"]`).click();await page.locator('#btn-close-bg-popover').click();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   assert((await page.evaluate(()=>document.documentElement.scrollWidth))<=width+1);await page.locator('.console-trend').screenshot({path:path.join(output,`traffic-${skin}-${width}.png`)});
  }
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>location.hash='#/proxy-config');await page.locator('.cm-editor').waitFor();await page.getByRole('button',{name:'20-route.json 运行分片',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#pc-name').textContent==='20-route.json');assert((await page.locator('#pc-active-note').innerText()).includes('3 份'));
  await page.locator('#pc-editor .cm-content').click();await page.keyboard.press('ControlOrMeta+a');await page.keyboard.insertText('{\n // JSONC fragment\n "route":{"final":"direct"}\n}\n');await page.locator('#pc-save').click();await page.locator('#pc-confirm-save').click();await page.waitForFunction(()=>document.querySelector('#pc-result-title').textContent.includes('已发送重载且核心在线'));assert(checks.length>0);assert.equal(saves.length,1);assert(saves[0].content.includes('// JSONC'));
  await page.screenshot({path:path.join(output,'sing-box-fragments-desktop.png')});await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'sing-box-fragments-mobile.png')});
  assert.deepEqual(errors,[]);const report={passed:true,automaticRecovery:true,serverHistoryAcrossBrowsers:true,ranges:[...new Set(ranges)],fragmentGroupRevisionVerified:true,jsoncFragmentSaved:true,errors};fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
