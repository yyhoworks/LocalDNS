export let ruleSaveService;
export function initialize() {

  'use strict';
  const running=new Set();
  const normalize=value=>String(value).split('\n').map(line=>line.trim()).filter(Boolean).join('\n');
  async function save(tag,value,baseline,read,write){
    if(running.has(tag))throw new Error('这份名单正在保存，请稍候。');
    if(typeof baseline!=='string')throw new Error('名单尚未完整读取，请重新打开后保存。');
    running.add(tag);
    try{
      const current=String(await read());
      if(normalize(current)!==normalize(baseline))throw new Error('服务器上的名单已有变化。当前编辑已保留为草稿，请重新读取后核对，避免覆盖其他修改。');
      const latest=String(await read());
      if(normalize(latest)!==normalize(current))throw new Error('名单已被其他设备修改，请重新读取后保存。');
      await write(normalize(value).split('\n').filter(Boolean));
    }finally{running.delete(tag);}
  }
  ruleSaveService ={save,isSaving:tag=>running.has(tag)};

}
