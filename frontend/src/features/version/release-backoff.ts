// GitHub supplies either a delay or an epoch reset time. Keep a minimum pause
// for secondary limits and never let a manual check bypass that pause.
export function releaseRetryAt(headers: Headers, now = Date.now()): number {
  const retry = headers.get('retry-after');
  const delay = retry && /^\d+$/.test(retry) ? now + Number(retry) * 1000 : Date.parse(retry || '');
  const reset = Number(headers.get('x-ratelimit-reset')) * 1000;
  return Math.max(now + 60000, Number.isFinite(delay) ? delay : 0, Number.isFinite(reset) ? reset : 0);
}
