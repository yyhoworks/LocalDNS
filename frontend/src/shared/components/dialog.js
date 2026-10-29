import { currentScope } from '../../core/router/route-lifetime';
import { shellInterfaceService } from '../../features/shell/interface.js';
import { toast } from './toast.js';
import { workspaceService } from '../workspace.js';
import { setHTML } from '../../core/security/safe-dom.ts';
import { esc } from '../format/number.js';

import { $ } from '../../core/context.js';
export function modalOpen(title,subtitle,html,onSave,showActions=true){workspaceService.modalChanging();$('#modal-title').textContent=title;$('#modal-subtitle').textContent=subtitle||'';setHTML($('#modal-content'), html);setHTML($('#modal-actions'), showActions?`<button class="button" id="modal-cancel" type="button" value="cancel">取消</button><button class="button primary" id="modal-save" type="button">保存</button>`:'');const scope=currentScope(), d=$('#modal');shellInterfaceService?.semantics(d);if(!d.open)d.showModal();const firstFocusable=$('#modal-content').querySelector('input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])');firstFocusable?.focus();const cancel=$('#modal-cancel');if(cancel)cancel.onclick=modalClose;if(onSave&&showActions)$('#modal-save').onclick=async()=>{if(!$('#modal-form').reportValidity())return;const b=$('#modal-save');b.disabled=true;$('#modal-error')?.remove();try{const next=await onSave();if(scope.signal.aborted)return;modalClose();if(typeof next==='function')next()}catch(e){if(scope.signal.aborted)return;shellInterfaceService?.formError(e.message);toast('操作失败','error',e.message)}finally{b.disabled=false}};}
export function modalClose(){workspaceService.modalChanging();const d=$('#modal');d.classList.remove('overview-detail-modal');if(d.open)d.close()}
/* 确认框：替代原生 confirm()，返回 Promise<boolean>；Esc/取消视为 false */
export function confirmDialog({title='请确认',message='',confirmText='确定',danger=false}){
  return new Promise(resolve=>{
    const d=$('#modal');
    const done=v=>{d.removeEventListener('cancel',onEsc);modalClose();resolve(v);};
    const onEsc=e=>{e.preventDefault();done(false);};
    d.addEventListener('cancel',onEsc);
    modalOpen(title,'',`<p class="confirm-dialog-msg">${esc(message).replace(/\n/g,'<br>')}</p>`,null,false);
    setHTML($('#modal-actions'),`<button class="button" id="modal-cancel" type="button">取消</button><button class="button ${danger?'danger':'primary'}" id="modal-confirm-ok" type="button">${esc(confirmText)}</button>`);
    $('#modal-cancel').onclick=()=>done(false);
    $('#modal-confirm-ok').onclick=()=>done(true);
    (danger?$('#modal-cancel'):$('#modal-confirm-ok')).focus();
  });
}
