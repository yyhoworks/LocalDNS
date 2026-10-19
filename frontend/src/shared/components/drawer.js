import { shellInterfaceService } from '../../features/shell/interface.js';

import { setHTML } from '../../core/security/safe-dom.ts';

import { $ } from '../../core/context.js';

export function openDrawer(title,subtitle,html){const wasOpen=$('#drawer').classList.contains('open');$('#drawer-title').textContent=title;$('#drawer-subtitle').textContent=subtitle;setHTML($('#drawer-content'), html);$('#drawer').classList.add('open');$('#drawer').setAttribute('aria-hidden','false');$('#drawer-backdrop').classList.add('open');if(!wasOpen)shellInterfaceService?.drawerOpened()}
export function closeDrawer(){$('#drawer').classList.remove('open');$('#drawer').setAttribute('aria-hidden','true');$('#drawer-backdrop').classList.remove('open');shellInterfaceService?.drawerClosed()}
