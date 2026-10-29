import type { RouteModule } from '../../core/router/route-context';
import { renderDevices } from './index.js';
export const devicesRoute: RouteModule = {
  mount(container, context) { return renderDevices(container, context); },
};
