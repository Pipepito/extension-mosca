import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist-firefox');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await build({ entryPoints: { background: 'src/clients/firefox/background.ts', popup: 'src/clients/firefox/popup/index.ts' },
  outdir: output, bundle: true, platform: 'browser', format: 'iife', target: 'firefox142' });
await cp(resolve(root, 'public/brain'), resolve(output, 'brain'), { recursive: true });
await cp(resolve(root, 'licenses'), resolve(output, 'licenses'), { recursive: true });
await cp(resolve(root, 'node_modules/zod/LICENSE'), resolve(output, 'licenses/zod-LICENSE.txt'));
await cp(resolve(root, 'src/clients/firefox/manifest.json'), resolve(output, 'manifest.json'));
await cp(resolve(root, 'src/clients/firefox/popup/index.html'), resolve(output, 'popup.html'));
console.log('Extensión Firefox generada en dist-firefox/.');
