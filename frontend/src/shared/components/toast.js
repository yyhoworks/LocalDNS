import { setHTML } from '../../core/security/safe-dom.ts';
import { icon } from './icons.js';
import { esc } from '../format/number.js';
import { $ } from '../../core/context.js';

export function toast(message, type='success', detail='') {
    const el=document.createElement('div'); el.className=`toast ${type} toast-enter`;
    setHTML(el, `<span>${icon(type==='error'?'warning':type==='success'?'check':'info')}</span><div><strong>${esc(message)}</strong>${detail?`<div class="toast-info">${esc(detail)}</div>`:''}</div>`);
    $('#toast-stack').appendChild(el);
    void el.offsetWidth; el.classList.remove('toast-enter');
    setTimeout(()=>{el.classList.add('toast-leave');setTimeout(()=>el.remove(),280)},3920);
  }
