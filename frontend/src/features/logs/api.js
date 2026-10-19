import { api } from '../../core/api/api.js';
import { logQueryParams } from './query';
import { logViewModel } from './model.js';

export async function readLogs(query, aliases, scope) {
  const data = await scope.guard(api.logs(logQueryParams(query)));
  return { ...data, records: data.logs, rows: data.logs.map(record => logViewModel(record, aliases)) };
}
