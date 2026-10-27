import { identityService } from '../identity/index.js';
import { shellInterfaceService } from './interface.js';
import { $, API_BASE, CONFIG } from '../../core/context.js';

// Route-independent connectivity heartbeat (B3): route renders only call
// setApiStatus on navigation, so a page left open on a non-overview/logs
// route would otherwise keep showing "online" forever after the backend
// drops. The heartbeat only ever reports through setApiStatus — it never
// re-renders a route, touches a form, or steals focus. It skips hidden
// documents, never overlaps probes, and treats any HTTP response as
// "reachable" (only a network/timeout failure marks the sidebar offline).
let heartbeatTimer = null, probing = false;
function startConnectionHeartbeat() {
  if (heartbeatTimer !== null || typeof window === 'undefined' || typeof document === 'undefined') return;
  const interval = Math.max(15000, (CONFIG?.refreshInterval || 30) * 1000);
  const probe = async () => {
    if (document.hidden || probing) return;
    probing = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      await fetch(`${API_BASE}/api/v1/status`, { method: 'GET', cache: 'no-store', signal: controller.signal });
      setApiStatus(true);
    } catch { setApiStatus(false); }
    finally { clearTimeout(timeout); probing = false; }
  };
  heartbeatTimer = setInterval(probe, interval);
  if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();
}

  function setApiStatus(ok, text) {
    const box=$('#sidebar-status'), dot=$('.status-dot',box), strong=$('strong',box);
      dot.className=`status-dot ${ok?'online':'offline'}`; strong.textContent=(identityService?.getName()||'LocalDNS')+(ok?' 在线':' 离线');
    $('#api-endpoint-label').textContent=text || (API_BASE || location.host);
    shellInterfaceService?.connection(ok, text);
    startConnectionHeartbeat();
  }
export { setApiStatus };
