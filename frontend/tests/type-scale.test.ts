import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// 正文与标签字号只用这几档；≥ 28px 的展示数字与 min()/var() 计算值不受限。
const SCALE = [11, 12, 13, 14, 16, 18, 20, 22, 24];
const DISPLAY_MIN = 28;

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? files(full) : /\.(css|js|ts)$/.test(entry.name) ? [full] : [];
  });
}

describe('type scale', () => {
  it('uses only scale steps for literal pixel font sizes', () => {
    const offenders: string[] = [];
    for (const file of [...files(path.join(frontend, 'src')), path.join(frontend, 'index.html')]) {
      const text = readFileSync(file, 'utf8');
      const sizes = [
        ...text.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g),
        ...text.matchAll(/\bfont:\s*(?:[^;}{'"`]*?\s)?(\d+(?:\.\d+)?)px/g),
      ];
      for (const match of sizes) {
        const size = Number(match[1]);
        if (size < DISPLAY_MIN && !SCALE.includes(size)) offenders.push(`${path.relative(frontend, file)}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
