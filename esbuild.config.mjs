import esbuild from 'esbuild';
import process from 'process';

const production = process.argv[2] === 'production';

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
}).catch(() => process.exit(1));
