import type { RouteModule } from '../../core/router/route-context';
import { renderManagement } from './index.js';
export const managementRoute: RouteModule = { mount(container, context) { return renderManagement(container, context); } };
