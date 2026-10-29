import { currentScope } from '../../core/router/route-lifetime';
import { shellInterfaceService } from '../../features/shell/interface.js';
import { toast } from './toast.js';
import { workspaceService } from '../workspace.js';
import { setHTML } from '../../core/security/safe-dom.ts';
import { esc } from '../format/number.js';

import { $ } from '../../core/context.js';
export function modalOpen(title,subtitle,html,onSave,showActions=true){workspaceService.modalChanging();$('#modal-title').textContent=title;$('#modal-subtitle').textContent=subtitle||'';setHTML($('#modal-content'), html);setHTML($('#modal-actions'), showActions?`<button class="button" id="modal-cancel" type="button" value="cancel">取消</button><button class="button primary" id="modal-save" type="button">保存</button>`:'');const scope=currentScope(), d=$('#modal');shellInterfaceService?.semantics(d);if(!d.open)d.showModal();const firstFocusable=$('#modal-content').querySelector('input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])');firstFocusable?.focus();const cancel=$('#modal-cancel');if(cancel)cancel.onclick=modalClose;if(onSave&&showActions)$('#modal-save').onclick=async()=>{if(!$('#modal-form').reportValidity())return;const b=$('#modal-save');b.disabled=true;$('#modal-error')?.remove();try{const next=await onSave();if(scope.signal.aborted)return;modalClose();if(typeof next==='function')next()}catch(e){if(scope.signal.aborted)return;shellInterfaceService?.formError(e.message);toast('操作失败','error',e.message)}finally{b.disabled=false}};}
export function modalClose(){workspaceService.modalChanging();const d=$('#modal');d.classList.remove('overview-detail-modal');if(d.open)d.close()}
/* 确认框：替代原生 confirm()，返回 Promise<boolean>；Esc/取消视为 false。
   使用独立的 #confirm-modal，不复用 #modal：调用方可能正打开着 #modal（例如审计控制），
   复用会覆盖它的内容，并在关闭时把调用方的弹窗一起关掉。 */
function confirmHost(){
  const existing=$('#confirm-modal');
  if(existing)return existing;
  const d=document.createElement('dialog');
  d.id='confirm-modal';
  d.className='modal';
  setHTML(d,`<form method="dialog" class="modal-panel"><div class="modal-header"><div><h2 id="confirm-title">请确认</h2></div></div><div class="modal-content"><p class="confirm-dialog-msg" id="confirm-message"></p></div><div class="modal-actions"><button class="button" id="confirm-cancel" type="button">取消</button><button class="button primary" id="confirm-ok" type="button">确定</button></div></form>`);
  document.body.appendChild(d);
  return d;
}
export function confirmDialog({title='请确认',message='',confirmText='确定',danger=false}){
  const d=confirmHost();
  return new Promise(resolve=>{
    const ok=$('#confirm-ok',d), cancel=$('#confirm-cancel',d);
    $('#confirm-title',d).textContent=title;
    setHTML($('#confirm-message',d), esc(message).replace(/\n/g,'<br>'));
    ok.className=`button ${danger?'danger':'primary'}`;
    ok.textContent=confirmText;
    const done=v=>{d.removeEventListener('cancel',onEsc);ok.onclick=null;cancel.onclick=null;if(d.open)d.close();resolve(v);};
    const onEsc=e=>{e.preventDefault();done(false);};
    d.addEventListener('cancel',onEsc);
    cancel.onclick=()=>done(false);
    ok.onclick=()=>done(true);
    shellInterfaceService?.semantics(d);
    if(!d.open)d.showModal();
    (danger?cancel:ok).focus();
  });
}
