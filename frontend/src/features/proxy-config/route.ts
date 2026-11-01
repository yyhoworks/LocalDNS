import type { RouteModule } from '../../core/router/route-context';
import { mount, requestLeave } from '../proxy/index.js';
export const proxyConfigRoute: RouteModule = { mount, canLeave: requestLeave };
