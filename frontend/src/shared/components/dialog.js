import { currentScope } from '../../core/router/route-lifetime';
import { shellInterfaceService } from '../../features/shell/interface.js';
import { toast } from './toast.js';
import { workspaceService } from '../workspace.js';
import { setHTML } from '../../core/security/safe-dom.ts';

import { $ } from '../../core/context.js';
export function modalOpen(title,subtitle,html,onSave,showActions=true){workspaceService.modalChanging();$('#modal-title').textContent=title;$('#modal-subtitle').textContent=subtitle||'';setHTML($('#modal-content'), html);setHTML($('#modal-actions'), showActions?`<button class="button" id="modal-cancel" type="button" value="cancel">取消</button><button class="button primary" id="modal-save" type="button">保存</button>`:'');const scope=currentScope(), d=$('#modal');shellInterfaceService?.semantics(d);d.showModal();const cancel=$('#modal-cancel');if(cancel)cancel.onclick=modalClose;if(onSave&&showActions)$('#modal-save').onclick=async()=>{if(!$('#modal-form').reportValidity())return;const b=$('#modal-save');b.disabled=true;$('#modal-error')?.remove();try{const next=await onSave();if(scope.signal.aborted)return;modalClose();if(typeof next==='function')next()}catch(e){if(scope.signal.aborted)return;shellInterfaceService?.formError(e.message);toast('操作失败','error',e.message)}finally{b.disabled=false}};}
export function modalClose(){workspaceService.modalChanging();const d=$('#modal');d.classList.remove('overview-detail-modal');if(d.open)d.close()}
