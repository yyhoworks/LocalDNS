let requested = null;
export function requestProxyPane(pane) { requested=pane==='config'?'config':'traffic'; }
export function takeProxyPane() { const pane=requested||'traffic';requested=null;return pane; }
