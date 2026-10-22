/* Font picker regression: themed popup, keyboard choice, uploaded fonts and persistence. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createPreviewServer}=require('./preview_ui.cjs');
const {chromium}=require(process.env.LOCALDNS_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'dist/font-select-verification');
const fixtures=require('../frontend/tests/fixtures/api.json'),metrics=fs.readFileSync(path.join(root,'frontend/tests/fixtures/metrics.prom'),'utf8');
const report={checks:[],views:[],errors:[]};let browser,server;
(async()=>{
 fs.mkdirSync(out,{recursive:true});server=createPreviewServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({headless:true,channel:'msedge'});
 for(const width of [1440,390])for(const skin of ['glass','claude'])for(const theme of ['cosmos-glass','light-glass']){
  const context=await browser.newContext({viewport:{width,height:width===390?844:1000},reducedMotion:'reduce'});
  await context.addInitScript(({skin,theme})=>{localStorage.setItem('localdns-skin-v1',JSON.stringify({active:skin,claude:{preset:theme==='cosmos-glass'?'obsidian':'parchment',theme},glass:{theme}}));},{skin,theme});
  await context.route('**/*',route=>{
   const url=new URL(route.request().url()),p=url.pathname;
   if(url.hostname==='api.github.com')return route.fulfill({contentType:'application/json',body:'{}'});
   if(p==='/metrics')return route.fulfill({contentType:'text/plain',body:metrics});
   if(/^\/plugins\/switch\d+\/show$/.test(p))return route.fulfill({contentType:'text/plain',body:'A'});
   if(/^\/(api|plugins)\//.test(p))return route.fulfill({contentType:'application/json',body:JSON.stringify(fixtures[p]??{})});
   return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/ui/`);await page.locator('.console-service-summary').waitFor();
  async function open(){await page.locator('#btn-open-bg-customizer').click();await page.locator('[data-appearance-tab="brand"]').click();await page.locator('#btn-font-upload:not([disabled])').waitFor();}
  await open();
  const reference=await page.locator('#select-brand-ver').evaluate(select=>getComputedStyle(select,'::picker(select)').backgroundColor);
  for(const role of ['heading','numeral','body']){
   const select=page.locator('#font-'+role);
   assert.equal(await select.evaluate(select=>getComputedStyle(select).appearance),'base-select');
   assert.equal(await select.evaluate(select=>getComputedStyle(select,'::picker(select)').backgroundColor),reference);
   await select.click();assert(await select.evaluate(select=>select.matches(':open')));
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   if(role==='heading'){await page.waitForTimeout(220);const file=`fonts-${skin}-${theme}-${width}.png`;await page.screenshot({path:path.join(out,file),animations:'disabled'});report.views.push(file);}
   const next=await select.evaluate(select=>select.options[(select.selectedIndex+1)%select.options.length].value);
   await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');assert.equal(await select.inputValue(),next);
  }
  const chosen=await page.locator('#font-heading').inputValue();await page.reload();await page.locator('.console-service-summary').waitFor();await open();assert.equal(await page.locator('#font-heading').inputValue(),chosen);
  if(width===1440&&skin==='glass'&&theme==='cosmos-glass'){
   await page.locator('#input-font-upload').setInputFiles(path.join(root,'_src/ui/assets/fonts/instrument-serif-numerals.woff2'));
   const uploaded=page.locator('#font-heading optgroup[data-uploaded-fonts] option').first();await uploaded.waitFor({state:'attached'});
   const value=await uploaded.getAttribute('value');await page.locator('#font-heading').click();await uploaded.click();assert.equal(await page.locator('#font-heading').inputValue(),value);
   await page.locator('#font-heading').click();await page.keyboard.press('Escape');assert.equal(await page.locator('#font-heading').inputValue(),value);
   report.checks.push('Uploaded font optgroup selects correctly; Escape retains selection');
  }
  report.checks.push(`Three themed pickers, keyboard choice and reload persistence: ${width}/${skin}/${theme}`);await context.close();
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
})().catch(error=>{report.failure=error.stack;process.exitCode=1;}).finally(async()=>{
 if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));
 fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
});
