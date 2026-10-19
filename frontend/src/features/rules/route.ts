import type { RouteModule } from '../../core/router/route-context';
import { renderRules } from './index.js';
import { rulesWorkbenchService } from './workbench.js';
export const rulesRoute: RouteModule = {
  mount(container, context) { return renderRules(container, context); },
  canLeave() { return rulesWorkbenchService.requestLeave(); },
};
