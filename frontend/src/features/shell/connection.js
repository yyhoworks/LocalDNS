import { identityService } from '../identity/index.js';
import { shellInterfaceService } from './interface.js';
import { $, API_BASE } from '../../core/context.js';

  function setApiStatus(ok, text) {
    const box=$('#sidebar-status'), dot=$('.status-dot',box), strong=$('strong',box);
      dot.className=`status-dot ${ok?'online':'offline'}`; strong.textContent=(identityService?.getName()||'LocalDNS')+(ok?' 运行正常':' 连接异常');
    $('#api-endpoint-label').textContent=text || (API_BASE || location.host);
    shellInterfaceService?.connection(ok, text);
  }
export { setApiStatus };
