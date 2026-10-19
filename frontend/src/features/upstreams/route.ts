import type { RouteModule } from '../../core/router/route-context';
import { renderUpstreams } from './index.js';
export const upstreamsRoute: RouteModule = { mount(container, context) { return renderUpstreams(container, context); } };
