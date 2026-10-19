import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { buildIntegrity } from './scripts/build-integrity';
import cascadeLayers from '@csstools/postcss-cascade-layers';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/ui/',
  publicDir: fileURLToPath(new URL('../_src/ui', import.meta.url)),
  plugins: [buildIntegrity()],
  css: { postcss: { plugins: [cascadeLayers()] } },
  esbuild: { legalComments: 'inline' },
  build: {
    // Explicit syntax floor; no new polyfills or runtime dependencies.
    target: ['es2020', 'chrome90', 'edge90', 'safari14.1'],
    outDir: fileURLToPath(new URL('../dist/ui', import.meta.url)),
    // Only the generated static tree is cleared; maintained assets are in publicDir.
    emptyOutDir: true,
    copyPublicDir: true,
    minify: false,
    sourcemap: false,
    reportCompressedSize: false,
    rollupOptions: {
      input: fileURLToPath(new URL('./index.html', import.meta.url)),
      treeshake: false,
      output: {
        entryFileNames: 'assets/app-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
