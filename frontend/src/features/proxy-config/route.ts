import type { RouteModule } from '../../core/router/route-context';
import { mount, requestLeave } from './index.js';
export const proxyConfigRoute: RouteModule = { mount, canLeave: requestLeave };
