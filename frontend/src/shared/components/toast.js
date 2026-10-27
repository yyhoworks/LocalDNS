import { setHTML } from '../../core/security/safe-dom.ts';
import { icon } from './icons.js';
import { esc } from '../format/number.js';
import { $ } from '../../core/context.js';

// 成功 / 提示类通知自动消失，鼠标悬停或键盘聚焦时暂停计时；错误通知往往较长（例如列出失败的规则），
// 不自动消失，由用户点关闭按钮。错误用 role=alert 立即播报，其余用 role=status 礼貌播报。
export const TOAST_DURATION = 3920;
const LEAVE_MS = 280;

export function toast(message, type='success', detail='') {
    const error=type==='error';
    const el=document.createElement('div'); el.className=`toast ${type} toast-enter`;
    el.setAttribute('role', error?'alert':'status');
    setHTML(el, `<span>${icon(error?'warning':type==='success'?'check':'info')}</span><div><strong>${esc(message)}</strong>${detail?`<div class="toast-info">${esc(detail)}</div>`:''}</div>${error?`<button type="button" class="toast-close" aria-label="关闭通知">${icon('close')}</button>`:''}`);
    let timer=0, remaining=TOAST_DURATION, started=0, closed=false;
    const dismiss=()=>{if(closed)return;closed=true;clearTimeout(timer);el.classList.add('toast-leave');setTimeout(()=>el.remove(),LEAVE_MS)};
    const resume=()=>{if(closed||error)return;clearTimeout(timer);started=Date.now();timer=setTimeout(dismiss,remaining)};
    const pause=()=>{if(closed||error)return;clearTimeout(timer);remaining=Math.max(0,remaining-(Date.now()-started))};
    el.querySelector('.toast-close')?.addEventListener('click',dismiss);
    if(!error){
      el.addEventListener('mouseenter',pause);el.addEventListener('mouseleave',resume);
      el.addEventListener('focusin',pause);el.addEventListener('focusout',event=>{if(!el.contains(event.relatedTarget))resume()});
    }
    // A-L2: error toasts never auto-dismiss, so without a cap repeated
    // failures pile up indefinitely. Keep at most 3 error toasts, dropping
    // the oldest first; non-error toasts auto-dismiss and are unaffected.
    if(error){const stack=$('#toast-stack');while(stack.querySelectorAll('.toast.error').length>=3)stack.querySelector('.toast.error')?.remove();}
    $('#toast-stack').appendChild(el);
    void el.offsetWidth; el.classList.remove('toast-enter');
    resume();
    return { element: el, dismiss };
  }
