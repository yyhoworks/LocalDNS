/* Browser acceptance for display identity and independent configuration files; device writes are mocked. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {createPreviewServer} = require('./preview_ui.cjs');
const {chromium} = require(process.env.LOCALDNS_PLAYWRIGHT || 'C:/Users/dev/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const output=path.resolve(__dirname,'../dist/identity-directory-verification');fs.mkdirSync(output,{recursive:true});
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="12" fill="#a34e35"/><path d="M16 32h32M32 16v32" stroke="white" stroke-width="5"/></svg>');
(async()=>{
  const server=createPreviewServer({backend:'http://192.168.1.7:9099'});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  const report={errors:[],layouts:[],saves:[]};
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
    const identities={localdns:null,proxy:null};let settingsUnavailable=false;
    const files=new Map([['/etc/mihomo/config.yaml','mode: rule\nmixed-port: 7890\n'],['/etc/mihomo/backup.yaml','mode: direct\nmixed-port: 7891\n'],['/etc/sing-box/config.json','{\n  "log": {"level": "info"}\n}\n'],['/etc/sing-box/backup.json','{\n  "log": {"level": "warn"}\n}\n']]);
    const handleAPI=async route=>{
      const req=route.request(),url=new URL(req.url()),operation=url.pathname.split('/').pop();const body=req.method()==='POST'?req.postDataJSON():{};
      let result,status=200;
      if(url.pathname.includes('/interface/')){
        const section=operation;
        if(settingsUnavailable){status=503;result={error:'服务器暂时不可用，设置未保存。'};}
        else if(req.method()==='POST'){assert.equal(body.revision,hash(JSON.stringify(identities[section])));identities[section]=body.value;result={value:body.value,revision:hash(JSON.stringify(body.value)),saved:true};}
        else result={value:identities[section],revision:hash(JSON.stringify(identities[section]))};
      }else if(operation==='traffic'){const now=Date.now();result={points:[{time:now-10000,qps:1,delta:5,elapsed:5,peak:1},{time:now-5000,qps:2,delta:10,elapsed:5,peak:2}],current:2,now,error:'',source:'server'};}else if(operation==='cores')result={cores:[{id:'mihomo',available:true,exists:true,path:'/etc/mihomo/config.yaml',directory:'/etc/mihomo',roots:['/etc/mihomo']},{id:'sing-box',available:true,exists:true,path:'/etc/sing-box/config.json',directory:'/etc/sing-box',roots:['/etc/sing-box']}]};
      else if(operation==='files'){
        const dir=url.searchParams.get('path')||'/etc/mihomo';
        if(!['/etc/mihomo','/etc/sing-box'].includes(dir)){status=403;result={error:'请选择当前核心配置目录中的文件。'};}
        else result={directory:dir,files:[...files].filter(([file])=>file.startsWith(dir+'/')).map(([file,content])=>({name:file.split('/').pop(),path:file,bytes:content.length,directory:false,active:file.includes('/config.')}))};
      }else if(operation==='read')result={core:body.core,path:body.path,content:files.get(body.path),revision:hash(files.get(body.path)),active:body.path.includes('/config.')};
      else if(operation==='check')result={valid:true,detail:'核心校验通过。'};
      else if(operation==='save'){
        assert.equal(body.revision,hash(files.get(body.path)));files.set(body.path,body.content);const active=body.path.includes('/config.');report.saves.push({core:body.core,path:body.path,reloaded:active});result={saved:true,reloaded:active,confirmation:active?'api':'saved-only',revision:hash(body.content),backup:'/etc/localdns-backups/example.bak'};
      }else{status=404;result={error:'Unknown fixture endpoint'};}
      await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
    };
    await context.route('**/api/proxy-config/**',handleAPI);
    await page.addInitScript(()=>{localStorage.setItem('localdns-identity-v1',JSON.stringify({name:'原有 DNS',logo:''}));localStorage.setItem('localdns-proxy-panel-v1',JSON.stringify({type:'sing-box',url:'http://192.168.1.7:9090/ui'}));});
    await page.goto(`http://127.0.0.1:${server.address().port}/ui/`);await page.locator('.console-service-summary').waitFor();
    await page.waitForFunction(()=>localStorage.getItem('localdns-identity-v1')===null&&localStorage.getItem('localdns-proxy-panel-v1')===null);assert.equal(identities.localdns.name,'原有 DNS');assert.equal(identities.proxy.url,'http://192.168.1.7:9090/ui');
    await page.locator('#proxy-launcher button').click();
    assert.equal(await page.locator('[name="proxy-panel-type"]').count(),0);
    await page.locator('#proxy-panel-name').fill('家庭网络');
    await page.locator('#proxy-panel-logo-file').setInputFiles({name:'custom.svg',mimeType:'image/svg+xml',buffer:svg});
    await page.waitForFunction(()=>document.querySelector('#proxy-panel-preview').src.startsWith('data:image/png'));
    await page.locator('#proxy-panel-url').fill('http://192.168.1.7:9090/ui');
    await page.locator('#proxy-panel-popover [type=submit]').click();await page.locator('#proxy-panel-popover').waitFor({state:'hidden'});
    assert((await page.locator('#proxy-launcher a').getAttribute('aria-label')).includes('家庭网络'));
    assert.equal(await page.locator('#proxy-launcher a').innerText(),'');
    await page.locator('#btn-open-bg-customizer').click();await page.locator('.identity-settings summary').click();
    await page.locator('#identity-name').fill('家里的 DNS');
    await page.locator('#identity-logo-file').setInputFiles({name:'custom.svg',mimeType:'image/svg+xml',buffer:svg});
    await page.waitForFunction(()=>document.querySelector('#identity-preview').src.startsWith('data:image/png'));
    await page.locator('#identity-save').click();await page.waitForFunction(()=>document.title==='家里的 DNS 控制台');
    const customLogo=await page.locator('#brand-mark').getAttribute('src');assert(customLogo.startsWith('data:image/png'));
    await page.screenshot({path:path.join(output,'identity-settings.png')});
    await page.locator('#btn-close-bg-popover').click();
    const otherContext=await browser.newContext();await otherContext.route('**/api/proxy-config/**',handleAPI);const otherPage=await otherContext.newPage();
    await otherPage.goto(`http://127.0.0.1:${server.address().port}/ui/`);await otherPage.waitForFunction(()=>document.title==='家里的 DNS 控制台');assert.equal(await otherPage.locator('#brand-mark').getAttribute('src'),customLogo);assert((await otherPage.locator('#proxy-launcher a').getAttribute('aria-label')).includes('家庭网络'));
    assert.equal(await otherPage.evaluate(()=>localStorage.getItem('localdns-identity-v1')),null);assert.equal(await otherPage.evaluate(()=>localStorage.getItem('localdns-proxy-panel-v1')),null);await otherContext.close();
    await page.locator('#proxy-launcher button').click();await page.locator('#proxy-panel-name').fill('失败的更改');settingsUnavailable=true;await page.locator('#proxy-panel-popover [type=submit]').click();await page.locator('#proxy-panel-error').waitFor({state:'visible'});assert((await page.locator('#proxy-launcher a').getAttribute('aria-label')).includes('家庭网络'));settingsUnavailable=false;await page.keyboard.press('Escape');
    await page.reload();await page.locator('.console-service-summary').waitFor();assert.equal(await page.locator('.brand-name').innerText(),'家里的 DNS');assert.equal(await page.locator('#brand-mark').getAttribute('src'),customLogo);
    await page.locator('#proxy-launcher button').click();await page.locator('#proxy-panel-url').fill('javascript:alert(1)');await page.locator('#proxy-panel-popover [type=submit]').click();await page.locator('#proxy-panel-error').waitFor({state:'visible'});assert.equal(await page.locator('#proxy-launcher a').getAttribute('href'),'http://192.168.1.7:9090/ui');await page.screenshot({path:path.join(output,'proxy-settings.png')});await page.keyboard.press('Escape');
    await page.evaluate(()=>location.hash='#/proxy-config');await page.locator('.cm-editor').waitFor();
    await page.locator('[data-pc-mode=directory]').click();await page.locator('.pc-directory-item').first().waitFor();
    assert.equal(await page.locator('#pc-file-count').innerText(),'2 份配置');
    await page.getByRole('button',{name:'backup.yaml',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#pc-name').textContent==='backup.yaml');
    const edit=async text=>{await page.locator('#pc-editor .cm-content').click();await page.keyboard.press('ControlOrMeta+a');await page.keyboard.insertText(text);};
    await edit('mixed-port: [\n');await page.locator('#pc-save').click();await page.waitForFunction(()=>document.querySelector('#pc-result-title').textContent.includes('语法检查未通过'));assert.equal(report.saves.length,0);
    await edit('mode: global\nmixed-port: 7891\n');
    await page.getByRole('button',{name:'config.yaml 启动配置',exact:true}).click();await page.getByRole('button',{name:'继续编辑',exact:true}).click();assert.equal(await page.locator('#pc-name').innerText(),'backup.yaml');
    await page.locator('#pc-save').click();await page.locator('#pc-confirm-save').click();await page.waitForFunction(()=>document.querySelector('#pc-result-title').textContent.includes('备用配置已保存'));
    assert.equal(files.get('/etc/mihomo/config.yaml'),'mode: rule\nmixed-port: 7890\n');
    await page.locator('#pc-file-filter').fill('config');assert.equal(await page.locator('.pc-directory-item').count(),1);await page.locator('#pc-file-filter').fill('');
    await page.getByRole('button',{name:'config.yaml 启动配置',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#pc-name').textContent==='config.yaml');await edit('mode: rule\nmixed-port: 7890\n# accepted change\n');await page.locator('#pc-save').click();await page.locator('#pc-confirm-save').click();await page.waitForFunction(()=>document.querySelector('#pc-result-title').textContent.includes('核心重载成功'));
    await page.locator('#pc-core-select').selectOption('sing-box');await page.waitForFunction(()=>document.querySelector('#pc-path').textContent==='/etc/sing-box/config.json');await page.waitForFunction(()=>document.querySelector('#pc-directory-input').value==='/etc/sing-box');
    await page.getByRole('button',{name:'backup.json',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#pc-name').textContent==='backup.json');await edit('{\n  "log": {"level": "error"}\n}\n');await page.locator('#pc-save').click();await page.locator('#pc-confirm-save').click();await page.waitForFunction(()=>document.querySelector('#pc-result-title').textContent.includes('备用配置已保存'));
    await page.reload();await page.locator('.cm-editor').waitFor();await page.locator('.pc-directory-item').first().waitFor();assert.equal(await page.locator('#pc-name').innerText(),'backup.json');assert.equal(await page.locator('[data-pc-mode=directory]').getAttribute('aria-pressed'),'true');
    for(const skin of ['claude','glass'])for(const mode of ['left','top'])for(const width of [1440,390]){
      await page.setViewportSize({width,height:width===390?844:1000});
      await page.locator('#btn-open-bg-customizer').click();await page.locator(`[data-skin-select="${skin}"]`).click();await page.locator(`[data-navigation-layout="${mode}"]`).click();await page.locator('#btn-close-bg-popover').click();
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const bounds=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,workspace:document.querySelector('.pc-workspace').getBoundingClientRect().toJSON()}));assert(bounds.scroll<=width+1,JSON.stringify({skin,mode,width,bounds}));
      assert.equal(await page.locator('#brand-mark').getAttribute('src'),customLogo);
      await page.screenshot({path:path.join(output,`${skin}-${mode}-${width}.png`)});report.layouts.push({skin,mode,width,noOverflow:true});
    }
    assert.deepEqual(report.errors,[]);assert.equal(report.saves.length,3);assert.equal(report.saves.filter(item=>item.reloaded).length,1);
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,...report}));
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
