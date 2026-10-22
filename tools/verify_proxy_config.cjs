/* UI acceptance against isolated fixtures. No production files or services are changed. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createPreviewServer}=require('./preview_ui.cjs');
const {chromium}=require(process.env.LOCALDNS_PLAYWRIGHT||'playwright');
const fixtures=require('../frontend/tests/fixtures/api.json');
const {uiVersion,releaseTag}=require('../VERSION.json');
const output=path.resolve(__dirname,'../dist/proxy-config-verification');
fs.mkdirSync(output,{recursive:true});
const report={scenarios:[],layouts:[],errors:[],writes:[],browser:'',fixtureOnly:true};
const stamp=content=>require('node:crypto').createHash('sha256').update(content).digest('hex');
const yaml='external-controller: 127.0.0.1:9090\nsecret: fixture-secret\nmode: rule\nrules:\n  - MATCH,DIRECT\n';
const json='{"experimental":{"clash_api":{"external_controller":"127.0.0.1:9091","secret":"fixture-secret"}},"outbounds":[{"type":"direct","tag":"direct"}],"route":{"final":"direct"}}\n';
const importedYaml='# HTTP source\nmode: rule\nrules:\n  - DOMAIN,example.com,REJECT\n  - MATCH,DIRECT\n';
const importedJson='{// HTTP source\n"outbounds":[{"type":"direct","tag":"direct"}],"route":{"rules":[{"domain":["example.com"],"action":"reject"}],"final":"direct"},}';
let browser,server;
async function layout(page,width,skin,state){
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const result=await page.evaluate(()=>{
  const root=document.querySelector('.pc-root');
  const tooSmall=[...root.querySelectorAll('button,input[type=url],select')].filter(el=>el.getClientRects().length&&!el.disabled&&el.getBoundingClientRect().height<43).map(el=>({id:el.id,height:el.getBoundingClientRect().height}));
  return {overflow:document.documentElement.scrollWidth>innerWidth+1,rootWidth:root.getBoundingClientRect().width,tooSmall};
 });
 report.layouts.push({width,skin,state,...result});
 await page.screenshot({path:path.join(output,`${width}-${skin}-${state}.png`),fullPage:true});
}
async function main(){
 server=createPreviewServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,channel:'msedge'});report.browser=browser.version();
 for(const width of [1440,390,320])for(const skin of ['glass','claude']){
  const context=await browser.newContext({viewport:{width,height:width===1440?1000:844},reducedMotion:'reduce',locale:'zh-CN'});
  await context.addInitScript(skin=>{
   localStorage.setItem('localdns-skin-v1',JSON.stringify({active:skin,claude:{preset:'parchment',theme:'light-glass'},glass:{theme:'cosmos-glass'}}));
  },skin);
  let failImport=false,failSave=false,unavailable=false;
  const files={'/etc/mihomo/config.yaml':yaml,'/etc/mihomo/backup.yaml':yaml,'/etc/sing-box/config.json':json};
  const sends=[];
  const respond=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.pathname.startsWith('/api/proxy-config/')){
    const endpoint=url.pathname.split('/').pop();
    if(unavailable)return respond(route,{error:'配置服务暂时不可用'},503);
    if(endpoint==='cores')return respond(route,{cores:[{id:'mihomo',available:true,exists:true,path:'/etc/mihomo/config.yaml',directory:'/etc/mihomo',roots:['/etc/mihomo'],mode:'file'},{id:'sing-box',available:true,exists:true,path:'/etc/sing-box/config.json',directory:'/etc/sing-box',roots:['/etc/sing-box'],mode:'file'}]});
    if(endpoint==='files'){
     const dir=url.searchParams.get('core')==='sing-box'?'/etc/sing-box':'/etc/mihomo';
     return respond(route,{directory:dir,files:Object.keys(files).filter(p=>p.startsWith(dir+'/')).map(p=>({path:p,name:p.split('/').pop(),bytes:files[p].length,directory:false,active:!p.includes('backup')})),truncated:false});
    }
    const body=req.postDataJSON();sends.push({endpoint,body});
    if(endpoint==='read')return respond(route,{path:body.path,core:body.core,revision:stamp(files[body.path]),content:files[body.path],active:!body.path.includes('backup'),mode:'file'});
    if(endpoint==='fetch')return failImport?respond(route,{error:'链接返回了网页，请使用原始配置链接。'},422):respond(route,{core:body.core,content:body.core==='mihomo'?importedYaml:importedJson,sourceHost:'config.fixture.test',bytes:100,imported:true});
    if(endpoint==='check')return respond(route,{valid:true,detail:'隔离核心校验夹具通过。'});
    if(endpoint==='save'){
     if(failSave)return respond(route,{error:'重载失败，已恢复原文件。修改仍保留在编辑器。',rolledBack:true,backup:'/fixture/backups/original'},502);
     assert.equal(body.revision,stamp(files[body.path]));files[body.path]=body.content;
     report.writes.push({width,skin,core:body.core,path:body.path});
     return respond(route,{saved:true,active:true,reloaded:true,revision:stamp(body.content),confirmation:body.core==='sing-box'?'signal-and-health':'api',backup:'/fixture/backups/original'});
    }
    throw new Error('Unrecognized fixture endpoint '+endpoint);
   }
   if(url.hostname==='api.github.com')return respond(route,{tag_name:releaseTag,assets:[],version:uiVersion});
   if(url.hostname==='127.0.0.1'&&url.port==='9090')return route.fulfill({contentType:'image/svg+xml',body:fs.readFileSync(path.resolve(__dirname,'../_src/ui/assets/img/proxy-panel.svg'))});
   if(url.origin===origin&&/^\/(api|plugins)\//.test(url.pathname)){
    assert.equal(req.method(),'GET','Unexpected real business write');return respond(route,fixtures[url.pathname]||{});
   }
   if(url.origin===origin&&url.pathname==='/metrics')return route.fulfill({contentType:'text/plain',body:fs.readFileSync(path.resolve(__dirname,'../frontend/tests/fixtures/metrics.prom'),'utf8')});
   return route.continue();
  });
  const page=await context.newPage();
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'&&/CodeMirror|EditorView|TypeError|ReferenceError/.test(message.text()))report.errors.push(message.text());});
  await page.goto(origin+'/ui/#/management');
  await page.locator('[data-route="proxy-config"]').first().click();
  await page.locator('#pc-name').filter({hasText:'config.yaml'}).waitFor();
  await page.locator('#pc-http-toggle').click();
  await page.locator('#pc-http-url').fill('https://config.fixture.test/config?token=fixture-token');
  await page.locator('#pc-http-read').click();
  await page.locator('#pc-result-title').filter({hasText:'HTTP 配置已读入草稿'}).waitFor();
  assert.equal(files['/etc/mihomo/config.yaml'],yaml,'HTTP import applied without save');
  assert((await page.locator('.pc-editor .cm-content').textContent()).includes('fixture-secret'));
  await layout(page,width,skin,'http-draft');
  await page.locator('#pc-save').click();await page.locator('#pc-confirm-save').waitFor();
  if(width===1440)await page.locator('.pc-dialog[open]').screenshot({path:path.join(output,`${width}-${skin}-diff.png`)});
  await page.locator('#pc-confirm-save').click();
  await page.locator('#pc-result-title').filter({hasText:'核心重载成功'}).waitFor();
  assert(files['/etc/mihomo/config.yaml'].includes('DOMAIN,example.com,REJECT'));
  const storage=await page.evaluate(()=>JSON.stringify({...localStorage}));
  assert(!storage.includes('fixture-secret')&&!storage.includes('fixture-token'),'Configuration or URL token persisted');
  report.scenarios.push(`${width}/${skin}: HTTP draft, controller preservation, diff, save/apply, no secret persistence`);
  failImport=true;const editor=page.locator('.pc-editor .cm-content');const savedText=await editor.textContent();
  await page.locator('#pc-http-read').click();await page.locator('#pc-http-error:not([hidden])').waitFor();
  assert.equal(await editor.textContent(),savedText);
  report.scenarios.push(`${width}/${skin}: failed HTTP import preserves editor`);
  failImport=false;
  // Exercise normal typing: no nested CodeMirror updates, then leave protection.
  await editor.click();await page.keyboard.press('Control+End');await page.keyboard.type('\n# typed draft');
  await page.locator('#pc-document-state[data-dirty=true]').waitFor();
  await page.locator('#pc-back').click();await page.locator('#pc-discard').waitFor();
  await page.locator('.pc-dialog [data-pc-close]').last().click();
  assert.equal(new URL(page.url()).hash,'#/proxy-config');
  failSave=true;await page.locator('#pc-save').click();await page.locator('#pc-confirm-save').click();
  await page.locator('#pc-result-title').filter({hasText:'重载失败'}).waitFor();
  assert((await editor.textContent()).includes('typed draft'));assert(await page.locator('#pc-save').isEnabled());
  report.scenarios.push(`${width}/${skin}: typing, leave protection, failed apply keeps draft and backup detail`);
  await page.locator('#pc-reread').click();await page.locator('#pc-discard').click();
  await page.locator('#pc-document-state[data-dirty=false]').waitFor();failSave=false;
  await page.locator('[data-pc-mode=directory]').click();
  if(width<801)await page.locator('#pc-toggle-files').click();
  await page.locator('.pc-directory-item').filter({hasText:'backup.yaml'}).click();
  await page.locator('#pc-name').filter({hasText:'backup.yaml'}).waitFor();
  assert((await page.locator('#pc-save').textContent()).includes('保存文件'));
  assert((await page.locator('#pc-active-note').textContent()).includes('备用配置'));
  await layout(page,width,skin,'directory');
  await page.locator('#pc-core-select').selectOption('sing-box');
  await page.locator('#pc-name').filter({hasText:'config.json'}).waitFor();
  await page.locator('#pc-http-read').click();await page.locator('#pc-document-state[data-dirty=true]').waitFor();
  await page.locator('#pc-save').click();await page.locator('#pc-confirm-save').waitFor();
  assert((await page.locator('.pc-dialog-body').textContent()).includes('现有连接可能断开'));
  await page.locator('#pc-confirm-save').click();await page.locator('#pc-result-title').filter({hasText:'已发送重载且核心在线'}).waitFor();
  assert(files['/etc/sing-box/config.json'].includes('example.com'));
  report.scenarios.push(`${width}/${skin}: directory, standby semantics, JSONC import, sing-box reload feedback`);
  await page.locator('#pc-focus').click();assert(await page.locator('.pc-focused').count());
  await page.keyboard.press('Escape');assert.equal(await page.locator('.pc-focused').count(),0);
  if(width===390){
   unavailable=true;await page.reload();await page.locator('#pc-retry:not([hidden])').waitFor();
   assert(await page.locator('#pc-save').isDisabled());assert(await page.locator('#pc-setup').isVisible());
   await layout(page,width,skin,'service-unavailable');
   unavailable=false;await page.locator('#pc-retry').click();
   try{await page.locator('#pc-name').filter({hasText:'config.json'}).waitFor({timeout:5000});}
   catch(error){report.retryDebug={text:await page.locator('.pc-root').innerText(),storage:await page.evaluate(()=>JSON.stringify({...localStorage})),requests:sends.slice(-3)};throw error;}
   report.scenarios.push(`${width}/${skin}: unavailable service, installation help and retry`);
  }
  assert(sends.some(item=>item.endpoint==='save'&&item.body.core==='sing-box'));
  await context.close();
 }
 assert.deepEqual(report.errors,[]);
 assert(report.layouts.every(item=>!item.overflow),'A viewport has horizontal overflow');
 assert(report.layouts.filter(item=>item.width<650).every(item=>item.tooSmall.length===0),'Mobile touch targets need repair');
}
main().then(()=>console.log(JSON.stringify({scenarios:report.scenarios.length,layouts:report.layouts.length,writes:report.writes.length,errors:report.errors.length,output}))).catch(error=>{report.failure=error.stack;console.error(error);process.exitCode=1;}).finally(async()=>{
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2));
 if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));
});
