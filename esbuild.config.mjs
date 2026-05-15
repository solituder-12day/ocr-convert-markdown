import esbuild from 'esbuild';
import process from 'process';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const production = process.argv[2] === 'production';

// Read the pdfjs worker file and encode as base64 data URL for inline use
const workerPath = resolve('node_modules/pdfjs-dist/build/pdf.worker.min.mjs');
const workerCode = readFileSync(workerPath, 'utf-8');
const workerB64 = Buffer.from(workerCode).toString('base64');
const workerDataUrl = `data:application/javascript;base64,${workerB64}`;

// Replace the placeholder in main.ts before bundling
// We inject it via a define
await esbuild.build({
  entryPoints: ['main.ts'],
  bundle: true,
  external: ['obsidian', 'electron'],
  format: 'cjs',
  target: 'es2022',
  platform: 'node',
  sourcemap: production ? false : 'inline',
  minify: production,
  outfile: 'main.js',
  define: {
    'PDFJS_WORKER_URL': JSON.stringify(workerDataUrl),
  },
}).catch(() => process.exit(1));
