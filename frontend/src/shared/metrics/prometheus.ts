export interface PromMetric {
  name: string;
  labels: Record<string, string>;
  value: number;
}

// Intentionally not a full Prometheus implementation, but sample lines with a
// trailing exposition timestamp are accepted (timestamp ignored), label values
// decode the standard escapes (\\, \", \n) in a single pass, and +Inf/-Inf map
// to the corresponding infinite values instead of NaN.
function sampleValue(raw: string): number {
  if (raw === '+Inf' || raw === 'Inf') return Infinity;
  if (raw === '-Inf') return -Infinity;
  return Number(raw);
}

export function parseProm(text: unknown): PromMetric[] {
  const out: PromMetric[] = [];
  String(text || '').split('\n').forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;
    const m = line.match(/^([a-zA-Z_:][\w:]*)({([^}]*)})?\s+([^\s{]+)(?:\s+\d+)?$/);
    if (!m) return;
    const labels: Record<string, string> = {};
    if (m[3]) {
      const re = /(\w+)="((?:\\.|[^"])*)"/g;
      let x;
      while ((x = re.exec(m[3]))) {
        labels[x[1]] = x[2].replace(/\\(.)/g, (_match, ch: string) => ch === 'n' ? '\n' : ch);
      }
    }
    out.push({ name: m[1], labels, value: sampleValue(m[4]) });
  });
  return out;
}

export function metricFind(
  metrics: PromMetric[],
  name: string,
  labels: Record<string, string> = {},
): number {
  const m = metrics.find(x => x.name === name && Object.entries(labels).every(([k, v]) => x.labels[k] === v));
  return m ? m.value : 0;
}
