// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CleanupScope } from '../src/core/lifecycle/cleanup-scope';
const mocks=vi.hoisted(()=>({leave:vi.fn(),editor:vi.fn(),traffic:vi.fn(),disposeEditor:vi.fn()}));
vi.mock('../src/features/proxy-config/index.js',()=>({requestLeave:mocks.leave,mount:mocks.editor}));
vi.mock('../src/features/proxy/traffic.js',()=>({mountTraffic:mocks.traffic}));
import { mount, requestLeave } from '../src/features/proxy/index.js';
import { requestProxyPane } from '../src/features/proxy/selection.js';

let scope:CleanupScope;
beforeEach(()=>{
  vi.clearAllMocks();mocks.leave.mockResolvedValue(true);scope=new CleanupScope();document.body.innerHTML='<main></main>';
  mocks.editor.mockImplementation(async(root:HTMLElement,context:{scope:CleanupScope})=>{root.innerHTML='<textarea aria-label="editor"></textarea>';context.scope.add(mocks.disposeEditor);});
  mocks.traffic.mockImplementation(async(root:HTMLElement)=>{root.innerHTML='<p>Statistics</p>';});
});
afterEach(()=>{scope.dispose();document.body.replaceChildren();});
const start=()=>mount(document.querySelector('main')!,{scope,signal:scope.signal,navigate:vi.fn(),notify:vi.fn()});

it('opens the proxy route directly in statistics without loading the editor',async()=>{
  await start();expect(mocks.traffic).toHaveBeenCalledTimes(1);expect(mocks.editor).not.toHaveBeenCalled();expect(requestLeave()).toBe(true);
});
it('preserves the management edit-configuration entry',async()=>{
  requestProxyPane('config');await start();expect(mocks.editor).toHaveBeenCalledTimes(1);expect(document.querySelector('textarea')).not.toBeNull();
});
it('does not discard an unsaved editor when switching tabs is cancelled',async()=>{
  requestProxyPane('config');await start();mocks.leave.mockResolvedValue(false);
  document.querySelector<HTMLButtonElement>('#proxy-pane-traffic')!.click();await vi.waitFor(()=>expect(mocks.leave).toHaveBeenCalled());
  expect(document.querySelector('textarea')).not.toBeNull();expect(mocks.disposeEditor).not.toHaveBeenCalled();
});
it('releases the editor and its listeners after approved navigation',async()=>{
  requestProxyPane('config');await start();document.querySelector<HTMLButtonElement>('#proxy-pane-traffic')!.click();
  await vi.waitFor(()=>expect(mocks.traffic).toHaveBeenCalledTimes(1));expect(mocks.disposeEditor).toHaveBeenCalledTimes(1);expect(document.querySelector('textarea')).toBeNull();
});
