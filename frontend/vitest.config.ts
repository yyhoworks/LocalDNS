import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // A stray it.only must fail the run instead of silently shrinking the
    // suite to a single test.
    allowOnly: false,
    coverage: {
      provider: 'v8',
      // Coverage is measured and reported for src/core only for now; the
      // thresholds below sit just under the measured baseline so the gate
      // catches regressions without blocking on legacy gaps. Widen `include`
      // (and re-measure) as checkJs coverage expands to shared/ and features/.
      include: ['src/core/**'],
      // Measured baseline for src/core (2026-10-22): statements 36.9,
      // branches 43.9, functions 38.2, lines 49.1. Thresholds sit a few
      // points below that; enforce via `npm run test:coverage`.
      thresholds: {
        lines: 45,
        functions: 35,
        branches: 40,
        statements: 35,
      },
    },
  },
});
