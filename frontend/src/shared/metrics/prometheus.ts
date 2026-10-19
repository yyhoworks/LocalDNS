export interface PromMetric {
  name: string;
  labels: Record<string, string>;
  value: number;
}

// Characterize the legacy parser; intentionally not a full Prometheus implementation.
export function parseProm(text: unknown): PromMetric[] {
  const out: PromMetric[] = [];
  String(text || '').split('\n').forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;
    const m = line.match(/^([a-zA-Z_:][\w:]*)({([^}]*)})?\s+([^\s]+)$/);
    if (!m) return;
    const labels: Record<string, string> = {};
    if (m[3]) {
      const re = /(\w+)="((?:\\.|[^"])*)"/g;
      let x;
      while ((x = re.exec(m[3]))) {
        labels[x[1]] = x[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      }
    }
    out.push({ name: m[1], labels, value: Number(m[4]) });
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
