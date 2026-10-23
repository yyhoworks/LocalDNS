/* Rule-editor regression tests. All writes use fixtures and never reach a device. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createPreviewServer}=require('./preview_ui.cjs');
const {chromium}=require(process.env.LOCALDNS_PLAYWRIGHT||'playwright');
const output=path.resolve(__dirname,'../dist/rules-editor-verification');fs.mkdirSync(output,{recursive:true});
(async()=>{
 const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,channel:'msedge'}),errors=[],checks=[],views=[];
 const initial='# 标题：测试分组\ndomain:example.com\nfull:api.example.com\n#\nlegacy.example.com';
 let context,page,writes,lists,readFailure=false;
 async function fresh(content=initial){
  if(context)await context.close();
  context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});writes=[];
  lists=new Map([['whitelist',content],['greylist','domain:grey.example.com'],['direct_ip','192.0.2.0/24'],['client_ip','192.0.2.10'],['rewrite','home.example.com 192.0.2.10']]);
  await context.route('**/plugins/**',async route=>{
   const req=route.request(),url=new URL(req.url()),m=url.pathname.match(/\/plugins\/([\w-]+)\/(show|post)/);
   if(m&&m[2]==='show')return route.fulfill({status:readFailure?503:200,contentType:'text/plain',body:readFailure?'Fixture read failed':lists.get(m[1])||''});
   if(m&&m[2]==='post'){writes.push(m[1]);lists.set(m[1],req.postDataJSON().values.join('\n'));}
   return route.fulfill({contentType:'application/json',body:url.pathname.includes('client_name')?'{}':'[]'});
  });
  await context.route('**/api/**',route=>route.fulfill({contentType:'application/json',body:'{"value":null,"revision":"new","backups":[]}'}));
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(6000);
  await page.goto(`http://127.0.0.1:${server.address().port}/ui/#/rules`);
  await page.locator(readFailure?'.error-panel':'.wb-list-heading').waitFor();
 }
 async function add(kind='rule'){await page.locator('#rv-new').click();await page.locator(`[data-new="${kind}"]`).click();await page.locator(kind==='paste'?'#rp-wrap[open]':'#rv-sheet.show').waitFor();}
 const value=text=>page.locator('.rv-value').filter({hasText:text}).first();
 async function closed(){await page.locator('#rv-sheet.show').waitFor({state:'hidden'});assert.equal(await page.locator('.master-container').evaluate(e=>e.inert),false);assert.equal(await page.locator('#rv-sheet').evaluate(e=>e.inert),true);}
 async function discard(){await page.locator('#rv-cancel').click();try{await page.locator('[data-rv-discard]').click();}catch(error){await page.screenshot({path:path.join(output,'failure.png')});fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify(await page.evaluate(()=>({sheet:document.querySelector('#rv-sheet')?.outerHTML,text:document.querySelector('#rule-text')?.value})),null,2));throw error;}await closed();}
 async function openTag(tag){await page.locator(`[data-rule-tag="${tag}"]`).click();await page.waitForFunction(t=>document.querySelector('.rule-menu button.active')?.dataset.ruleTag===t&&!!document.querySelector('.wb-list-heading'),tag);}
 try{
  await fresh();await value('example.com').click();await page.locator('#rv-cancel').click();await closed();
  await page.waitForTimeout(100);assert(!await page.locator('#rv-sheet').evaluate(e=>e.contains(document.activeElement)));
  await value('example.com').focus();await page.keyboard.press('Enter');await page.locator('#rv-type [data-t="regexp"]').click();
  for(let i=0;i<5;i++)await page.locator('#rv-cancel').click();
  assert.equal(await page.locator('.rv-discard-prompt:visible').count(),1);assert.equal(await page.locator('.toast').filter({hasText:'再点一次关闭放弃'}).count(),0);
  assert(await page.locator('.master-container').evaluate(e=>e.inert));
  await page.locator('[data-rv-continue]').click();assert.equal(await page.locator('#rv-value').inputValue(),'example.com');
  await page.keyboard.press('Escape');await page.locator('[data-rv-discard]').click();await closed();assert.equal(await page.locator('#rule-text').inputValue(),initial);
  checks.push('unchanged close, explicit continue/discard, no repeated toasts, inert and keyboard entry');

  // Notes, group selection and new panels all participate in dirty detection.
  await value('legacy.example.com').click();await page.locator('#rv-note').fill('仅修改备注');await discard();assert.equal(await page.locator('#rule-text').inputValue(),initial);
  await value('legacy.example.com').click();await page.locator('#rv-group').selectOption({label:'测试分组'});await discard();assert.equal(await page.locator('#rule-text').inputValue(),initial);
  await value('legacy.example.com').click();await page.locator('#rv-value').fill('full:changed.example.com');await page.keyboard.press('Enter');await discard();
  await page.locator('.rv-sw').last().uncheck();assert((await page.locator('#rule-text').inputValue()).endsWith('# 停用原文：legacy.example.com'));await page.locator('#rv-undo').click();
  await add();await page.locator('#rv-note').fill('只有备注');await discard();
  await add('group');await page.locator('#rv-grp-notes').fill('只有注释');await discard();
  checks.push('note/group-only dirty checks and cancelled recognition preserve original raw model');

  await add();await page.locator('#rv-value').fill('# full:disabled.example.com');await page.locator('#rv-ok').click();await closed();assert((await page.locator('#rule-text').inputValue()).includes('# full:disabled.example.com'));
  await add();await page.locator('#rv-value').fill('keyboard.example.com');await page.keyboard.press('Control+s');await closed();assert.equal(writes.length,0);assert(/(?:domain|full):keyboard\.example\.com/.test(await page.locator('#rule-text').inputValue()));
  await add();await page.locator('#rv-value').fill('not a domain');await page.locator('#rv-ok').click();assert.equal(await page.locator('#rv-sheet.show').count(),1);await discard();
  await value('keyboard.example.com').click();let confirms=0;page.on('dialog',async d=>{confirms++;await d.accept();});await page.locator('#rv-del').click();await closed();assert.equal(confirms,1);
  checks.push('disabled prefixes, panel Ctrl+S applies draft only, invalid input and one delete confirmation');

  for(const [tag,newValue] of [['direct_ip','2001:db8::/32'],['client_ip','192.0.2.11'],['rewrite','new.example.com 192.0.2.12']]){
   await fresh();await openTag(tag);await add();assert.equal(await page.locator('#rv-type').isVisible(),false);
   await page.locator('#rv-ok').click();assert.equal(await page.locator('#rv-sheet.show').count(),1);
   await page.locator('#rv-value').fill(newValue);await page.locator('#rv-ok').click();await closed();assert((await page.locator('#rule-text').inputValue()).endsWith(newValue));assert(!(await page.locator('#rule-text').inputValue()).includes('domain:'));
   await add();await page.locator('#rv-value').fill(newValue);await page.locator('#rv-ok').click();assert.equal(await page.locator('#rv-sheet.show').count(),1);await discard();
  }
  checks.push('IP, CIDR and rewrite creation retain raw format; empty and duplicate creation rejected');

  await fresh();await add('group');await page.locator('#rv-grp-title').fill('第二组');await page.locator('#rv-grp-notes').fill('分组注释');await page.locator('#rv-ok').click();await closed();
  await value('legacy.example.com').click();await page.locator('#rv-group').selectOption({label:'第二组'});await page.locator('#rv-note').fill('规则备注');await page.locator('#rv-ok').click();await closed();
  let text=await page.locator('#rule-text').inputValue();assert(text.indexOf('# 第二组')<text.indexOf('legacy.example.com'));assert(text.includes('# 备注：规则备注\nlegacy.example.com'));
  await page.locator('.rv-row.grp').filter({hasText:'第二组'}).click();await page.locator('#rv-grp-title').fill('改名分组');await page.locator('#rv-ok').click();await closed();assert((await page.locator('#rule-text').inputValue()).includes('改名分组'));
  await value('legacy.example.com').click();await page.locator('#rv-group').selectOption('');await page.locator('#rv-ok').click();await closed();assert(!(await value('legacy.example.com').locator('..').getAttribute('class')).includes('child'));
  checks.push('group creation/editing, notes and moving a rule into/out of groups');

  await fresh();await add('paste');await page.locator('#rp-text').fill('domain:example.com\nfull:new.example.com\nfull:new.example.com\n# keyword:ads');
  assert((await page.locator('#rp-note').innerText()).includes('跳过重复 2'));
  await page.keyboard.press('Control+s');await page.locator('#rp-wrap').waitFor({state:'hidden'});text=await page.locator('#rule-text').inputValue();assert.equal(text.match(/full:new.example.com/g).length,1);assert(text.includes('# keyword:ads'));assert.equal(writes.length,0);
  await add('paste');await page.locator('#rp-text').fill('domain:cancel.example.com');await page.keyboard.press('Escape');assert.equal(await page.locator('#rp-wrap[open]').count(),0);assert(!(await page.locator('#rule-text').inputValue()).includes('cancel.example.com'));
  await add('paste');await page.locator('#rp-cancel').click();assert.equal(await page.locator('dialog[open]').count(),0);
  checks.push('paste deduplicates current list and same batch; apply/cancel/Escape retain draft boundaries');

  await fresh();await value('example.com').click();await page.locator('#rv-note').fill('输入法');
  await page.locator('#rv-note').dispatchEvent('keydown',{key:'Enter',isComposing:true});assert.equal(await page.locator('#rv-sheet.show').count(),1);
  const unload=await page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;});assert.equal(unload,true);
  await page.evaluate(()=>document.querySelector('#refresh-button').click());await page.locator('.rv-discard-prompt:visible').waitFor();await page.locator('[data-rv-continue]').click();assert.equal(await page.locator('#rv-note').inputValue(),'输入法');
  await page.evaluate(()=>document.querySelector('#refresh-button').click());await page.locator('[data-rv-discard]').click();await page.waitForFunction(()=>!document.querySelector('#rv-sheet.show')&&!!document.querySelector('.wb-list-heading'));assert.equal(await page.locator('#rule-text').inputValue(),initial);
  await add('paste');await page.locator('#rp-text').fill('domain:pending.example.com');page.once('dialog',d=>d.dismiss());await page.evaluate(()=>location.hash='#/logs');await page.waitForTimeout(100);assert(page.url().endsWith('#/rules'));assert.equal(await page.locator('#rp-wrap[open]').count(),1);await page.keyboard.press('Escape');
  checks.push('IME Enter does not apply prematurely; unload/refresh and paste navigation protect edits');

  // Browser hash changes and page refreshes cannot silently erase panel inputs.
  await fresh();await value('example.com').click();await page.locator('#rv-note').fill('待处理');
  await page.evaluate(()=>location.hash='#/logs');await page.locator('.rv-discard-prompt:visible').waitFor();assert(page.url().endsWith('#/rules'));
  await page.locator('[data-rv-continue]').click();assert.equal(await page.locator('#rv-note').inputValue(),'待处理');
  await page.evaluate(()=>document.querySelector('[data-rule-tag="greylist"]').click());await page.locator('[data-rv-discard]').click();await closed();await page.waitForFunction(()=>document.querySelector('.rule-menu button.active')?.dataset.ruleTag==='greylist');
  await value('grey.example.com').click();await page.locator('#rv-note').fill('tab');await page.evaluate(()=>document.querySelector('[data-rule-tab="adguard"]').click());await page.locator('[data-rv-discard]').click();await page.waitForFunction(()=>!document.querySelector('#rv-root'));
  assert.equal(await page.locator('#rv-sheet').count(),0);assert.equal(await page.locator('.master-container').evaluate(e=>e.inert),false);
  await page.locator('[data-rule-tab="lists"]').click();await value('grey.example.com').click();await page.locator('#rv-note').fill('route');await page.evaluate(()=>location.hash='#/logs');await page.locator('[data-rv-discard]').click();await page.waitForFunction(()=>!document.querySelector('#rv-root'));assert.equal(await page.locator('.master-container').evaluate(e=>e.inert),false);
  checks.push('route/hash/list/tab transitions protect pending panel edits and clean up overlays');

  await fresh('domain:first.example.com\ndomain:second.example.com\ndomain:third.example.com');
  const drag=page.locator('.rv-row').first();await drag.locator('.rv-handle').dispatchEvent('mousedown');const transfer=await page.evaluateHandle(()=>new DataTransfer());await drag.dispatchEvent('dragstart',{dataTransfer:transfer});await page.locator('.rv-row').nth(2).dispatchEvent('drop',{dataTransfer:transfer});await page.locator('.rv-row').first().dispatchEvent('dragend');
  assert.equal(await page.locator('#rule-text').inputValue(),'domain:second.example.com\ndomain:first.example.com\ndomain:third.example.com');await page.locator('#rv-undo').click();assert((await page.locator('#rule-text').inputValue()).startsWith('domain:first'));
  checks.push('drag ordering and undo preserve rule text');

  readFailure=true;await fresh();assert.equal(await page.locator('#rule-save').count(),0);readFailure=false;await page.locator('#rule-retry').click();await page.locator('.wb-list-heading').waitFor();
  await fresh('');assert.equal(await page.locator('.rv-empty').count(),1);await add();await page.locator('#rv-cancel').click();await closed();
  const large=Array.from({length:1000},(_,i)=>'domain:host'+i+'.example.com').join('\n');const started=Date.now();await fresh(large);assert.equal(await page.locator('.rv-sw').count(),1000);await page.locator('#rv-q').fill('host999');assert.equal(await page.locator('.rv-sw').count(),1);const largeListMs=Date.now()-started;
  checks.push('load failure disables save; retry, empty list and 1000-rule search work');

  await fresh();
  for(const [skin,nav,width,height] of [['claude','left',1440,900],['glass','top',1440,900],['claude','left',390,568],['glass','top',390,568]]){
   await page.setViewportSize({width,height});await page.locator('#btn-open-bg-customizer').click();await page.locator('[data-appearance-tab=theme]').click();await page.locator(`[data-skin-select="${skin}"]`).click();await page.locator('[data-appearance-tab=material]').click();await page.locator(`[data-navigation-layout="${nav}"]`).click();await page.locator('#btn-close-bg-popover').click();
   await value('example.com').click();await page.locator('#rv-type [data-t="regexp"]').click();await page.locator('#rv-value').fill('^'+('long-label'.repeat(30))+'\\.example\\.com$');await page.locator('#rv-cancel').click();
   await page.evaluate(()=>document.fonts.ready);
   const bounds=await page.locator('#rv-ok').boundingBox();assert(bounds.y>=0&&bounds.y+bounds.height<=height+1);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await page.locator('[data-rv-continue]').focus();await page.keyboard.press('Shift+Tab');assert(await page.locator('#rv-sheet').evaluate(e=>e.contains(document.activeElement)));
   await page.locator('#rv-cancel').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'rv-del');
   const panel=await page.locator('#rv-sheet').boundingBox();assert(Math.abs(panel.y)<1&&panel.height<=height+1);
   const filename=`editor-${skin}-${nav}-${width}.png`;await page.screenshot({path:path.join(output,filename)});views.push(filename);await page.locator('[data-rv-discard]').click();await closed();
   await add('paste');const paste=await page.locator('.rp-panel').boundingBox();assert(paste.x>=0&&paste.x+paste.width<=width+1);assert(paste.height<=height);await page.keyboard.press('Escape');
  }
  checks.push('both skins, both navigation layouts, short mobile viewport, long content and focus containment');
  assert.deepEqual(errors,[]);
  const report={passed:true,checks,largeListMs,views,errors};fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
