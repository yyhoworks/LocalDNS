/* Version-dialog acceptance. Every backend write is fulfilled by an isolated fixture. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createPreviewServer} = require('./preview_ui.cjs');
const {chromium} = require(process.env.LOCALDNS_PLAYWRIGHT || 'playwright');
const fixtures = require('../frontend/tests/fixtures/api.json');
const metadata = require('../_src/ui/version.json');
const next = metadata.uiVersion.split('.').map(Number); next[3]++;
const nextVersion = next.join('.');
const release = {tag_name:'fjgac-ui-v' + nextVersion, assets:[{name:'LocalDNS_UI_' + nextVersion + '_Update.zip'}]};
const out = path.resolve(__dirname,'../dist/ui-update-verification');
fs.mkdirSync(out,{recursive:true});

(async()=>{
  const server = createPreviewServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({headless:true,channel:'msedge'});
  const report = {scenarios:[],errors:[],writes:[],layouts:[]};
  try {
    for (const width of [1440,390]) {
      for (const theme of ['dark','light-glass']) {
        const context = await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
        await context.addInitScript(theme=>localStorage.setItem('localdnsTheme',theme),theme);
        const page = await context.newPage();
        page.on('pageerror',error=>report.errors.push(error.message));
        page.on('dialog',dialog=>dialog.accept());
        let mode = 'available', task = {state:'idle',canRollback:false,installedVersion:metadata.uiVersion}, polls=0;
        const json = (route,body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
        await page.route('https://api.github.com/repos/yyhoworks/LocalDNS/releases/latest',route=>json(route,release));
        await page.route(origin+'/**',route=>{
          const request=route.request(), url=new URL(request.url()), method=request.method();
          assert.notEqual(url.pathname,'/session');
          assert.equal(request.headers().authorization,undefined);
          if(url.pathname.startsWith('/upgrade/ui')) {
            if(mode==='unavailable')return json(route,{error:'not found'},404);
            if(url.pathname==='/upgrade/ui'&&method==='GET')return json(route,{protocol:'localdns-ui-updater/v1',repository:'https://github.com/yyhoworks/LocalDNS',requiresAuth:false});
            if(method==='POST') {
              report.writes.push({method,path:url.pathname,body:request.postDataJSON()});
              assert(['/upgrade/ui','/upgrade/ui/rollback'].includes(url.pathname));
              if(url.pathname==='/upgrade/ui')assert.equal(request.postDataJSON().releaseTag,release.tag_name);
              task={state:'running',jobId:'fixture-job',step:'download',message:'正在下载并校验正式发行包…',canRollback:false,installedVersion:metadata.uiVersion};polls=0;
              return json(route,task,202);
            }
            if(task.state==='running'&&++polls>1)task=mode==='failed'
              ?{...task,state:'failed',message:'安装包 SHA-256 校验失败，旧界面保持可用。'}
              :{...task,state:'succeeded',installedVersion:nextVersion,canRollback:true,message:'UI 已升级至 '+nextVersion+'，可刷新使用。'};
            return json(route,task);
          }
          if(/^\/(api|plugins)\//.test(url.pathname)){
            assert.equal(method,'GET','Business writes must never reach the backend');
            return json(route,fixtures[url.pathname]||{});
          }
          if(url.pathname==='/metrics')return route.fulfill({contentType:'text/plain',body:fs.readFileSync(path.resolve(__dirname,'../frontend/tests/fixtures/metrics.prom'),'utf8')});
          return route.continue();
        });
        await page.goto(origin+'/ui/');
        await page.locator('#version-button').click();
        await page.locator('#version-dialog[open]').waitFor();
        if(process.env.LOCALDNS_UPDATE_BASELINE){
          await page.locator('#version-dialog').screenshot({path:path.join(out,`before-${width}-${theme}.png`)});
          await context.close();continue;
        }
        assert.equal(await page.locator('#version-update-password,.version-update-auth').count(),0);
        await page.locator('[data-update-start]:not([disabled])').waitFor();
        await page.locator('[data-update-start]').click();
        await page.locator('.version-update-progress:not([hidden])').waitFor();
        assert(await page.locator('[data-update-start]').isDisabled());
        if(width===390&&theme==='light-glass')await page.locator('#version-dialog').screenshot({path:path.join(out,'running-mobile.png')});
        await page.locator('#version-dialog form[method=dialog] button').click();
        await page.locator('#version-button').click();
        await page.locator('[data-update-refresh]:not([hidden])').waitFor();
        assert(await page.locator('[data-update-start]').isDisabled(),'Completed target must not be offered again');
        assert(await page.locator('[data-update-rollback]').isVisible());
        assert.equal(await page.locator('#version-update-password,.version-update-auth').count(),0);
        const layout=await page.locator('#version-dialog').evaluate(el=>({width:el.clientWidth,scrollWidth:el.scrollWidth,height:el.clientHeight,scrollHeight:el.scrollHeight,theme:document.documentElement.dataset.theme}));
        assert(layout.scrollWidth<=layout.width+1);
        await page.locator('#version-dialog').screenshot({path:path.join(out,`after-${width}-${theme}.png`)});
        report.layouts.push({viewport:width,...layout});
        report.scenarios.push(`${width}/${theme}: password-free upgrade, close/reopen, completion, rollback availability`);
        // A fresh browser connects directly to the server state.
        mode='unavailable';await page.reload();await page.locator('#version-button').click();
        await page.getByText('此服务器尚未启用网页升级。完成一次安装后即可在这里操作。',{exact:true}).waitFor();
        assert(await page.locator('[data-update-start]').isDisabled());
        report.scenarios.push(`${width}/${theme}: unsupported endpoint shows setup help`);
        mode='failed';task={state:'idle',canRollback:false,installedVersion:metadata.uiVersion};
        await page.locator('[data-update-retry]').click();
        await page.locator('[data-update-start]:not([disabled])').waitFor();
        await page.locator('[data-update-start]').click();
        await page.getByText('安装包 SHA-256 校验失败，旧界面保持可用。',{exact:true}).waitFor();
        assert(await page.locator('[data-update-refresh]').isHidden());
        assert(await page.locator('[data-update-start]').isEnabled());
        if(width===390&&theme==='light-glass')await page.locator('#version-dialog').screenshot({path:path.join(out,'failed-mobile.png')});
        report.scenarios.push(`${width}/${theme}: failed job never reports success and can retry`);
        await context.close();
      }
    }
    assert.deepEqual(report.errors,[]);
    fs.writeFileSync(path.join(out,process.env.LOCALDNS_UPDATE_BASELINE?'baseline.json':'report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({scenarios:report.scenarios.length,layouts:report.layouts.length,errors:report.errors,output:out}));
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
