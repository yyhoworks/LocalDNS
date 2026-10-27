// CI check for F1: every Han character used by the shipped UI source must
// be inside the Noto Sans SC / Noto Serif SC unicode-range declared in
// frontend/src/styles/fonts.css. If this fails, regenerate the subsets
// (see _src/ui/assets/fonts/manifest.json for provenance) instead of
// silently shipping text that falls back to a system font.
//
// Source scope mirrors what the subsets are built from: all files under
// frontend/src plus frontend/index.html. Dynamic/backend-supplied strings
// are not covered by this check by design.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const frontendRoot = path.join(projectRoot, 'frontend');

const HAN = (code) =>
  (code >= 0x3400 && code <= 0x9fff) ||
  (code >= 0xf900 && code <= 0xfaff) ||
  (code >= 0x20000 && code <= 0x2fa1f);

function parseRange(text) {
  const covered = new Set();
  for (const part of text.split(',')) {
    const token = part.trim();
    if (!token.startsWith('U+')) throw new Error(`Unparsable unicode-range token: ${token}`);
    const body = token.slice(2);
    if (body.includes('-')) {
      const [a, b] = body.split('-', 2);
      for (let code = parseInt(a, 16); code <= parseInt(b, 16); code++) covered.add(code);
    } else {
      covered.add(parseInt(body, 16));
    }
  }
  return covered;
}

async function collectSourceChars(directory) {
  const chars = new Set();
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (entry.isFile()) {
        const text = await readFile(target, 'utf8');
        for (const char of text) {
          const code = char.codePointAt(0);
          if (HAN(code)) chars.add(code);
        }
      }
    }
  }
  await walk(directory);
  return chars;
}

const css = await readFile(path.join(frontendRoot, 'src/styles/fonts.css'), 'utf8');
// Capture the unicode-range of each @font-face block together with its family.
const blocks = [...css.matchAll(/font-family:\s*'([^']+)'[\s\S]*?unicode-range:\s*([^;]+);/g)];
const noto = blocks.filter(([, family]) => family === 'Noto Sans SC' || family === 'Noto Serif SC');
if (noto.length !== 2) throw new Error(`Expected exactly 2 Noto SC @font-face blocks, found ${noto.length}.`);

const source = await collectSourceChars(path.join(frontendRoot, 'src'));
for (const char of await readFile(path.join(frontendRoot, 'index.html'), 'utf8')) {
  const code = char.codePointAt(0);
  if (HAN(code)) source.add(code);
}

let failed = false;
for (const [, family, rangeText] of noto) {
  const covered = parseRange(rangeText);
  const missing = [...source].filter((code) => !covered.has(code)).sort((a, b) => a - b);
  if (missing.length > 0) {
    failed = true;
    console.error(
      `${family}: ${missing.length} source Han character(s) outside unicode-range: ` +
        missing.map((code) => `${String.fromCodePoint(code)} (U+${code.toString(16).toUpperCase()})`).join(' '),
    );
  }
}
if (failed) {
  console.error('Font subset check failed: regenerate the Noto SC subsets from current source before shipping.');
  process.exit(1);
}
console.log(`Font subset check passed: ${source.size} source Han character(s) covered by both Noto SC unicode-ranges.`);
