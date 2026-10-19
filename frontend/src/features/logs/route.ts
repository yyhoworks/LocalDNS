import type { RouteModule } from '../../core/router/route-context';
import { renderLogs } from './index.js';
export const logsRoute: RouteModule = { mount(container, context) { return renderLogs(container, context); } };
