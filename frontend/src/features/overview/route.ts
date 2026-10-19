import type { RouteModule } from '../../core/router/route-context';
import { renderOverview } from './index.js';
export const overviewRoute: RouteModule = { mount(container, context) { return renderOverview(container, context); } };
