#!/usr/bin/env node
// Produces everything the vsix contains that is not checked in, all of it under dist/build/:
//
//   src/extension.ts -> dist/build/extension.js  one bundled, minified CommonJS file
//   assets/icon.svg  -> dist/build/icon.png      the Marketplace accepts raster icons only
//   README.md        -> dist/build/README.md     the Marketplace rejects SVG in a README
//
// `npm run compile` is a separate step: it type-checks into dist/tsc/, which is where
// the tests run from and which is never packaged. esbuild does not type-check, so
// neither replaces the other. The finished vsix is written to dist/ itself.
//
// Pass --watch to rebuild the bundle on change, unminified and with a source map.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import * as esbuild from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'dist/build');
const watch = process.argv.includes('--watch');

mkdirSync(outDir, { recursive: true });

// --- bundle -------------------------------------------------------------------
// One file instead of a tree of tsc output: the extension host loads a single
// module, and minification is worth having because every byte is read from disk
// at startup. `vscode` is provided by the host, so it stays external; nothing
// else is imported beyond node builtins.
const options = {
  entryPoints: [resolve(root, 'src/extension.ts')],
  outfile: resolve(outDir, 'extension.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  // VS Code 1.85 ships Node 18; keeping the target honest avoids downlevelling
  // that would only make the bundle bigger.
  target: 'node18',
  external: ['vscode'],
  minify: !watch,
  // 'external' writes the map without a sourceMappingURL comment: the map is not
  // packaged, so a reference to it in the shipped bundle would dangle.
  sourcemap: watch ? true : 'external',
  legalComments: 'none',
  logLevel: 'warning',
};

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
  console.log('bundle: watching src/ -> dist/build/extension.js');
} else {
  await esbuild.build(options);
  const bytes = readFileSync(options.outfile).length;
  console.log(`bundle: ${bytes} bytes -> dist/build/extension.js`);
}

// --- icon ---------------------------------------------------------------------
// 128x128 is the documented minimum; 256 keeps it crisp on hidpi listings. The SVG
// deliberately contains no <text> — the wordmark is outlined into a path — and system
// fonts are disabled, so the output is identical on every machine.
const SIZE = 256;

const rendered = new Resvg(readFileSync(resolve(root, 'assets/icon.svg'), 'utf8'), {
  fitTo: { mode: 'width', value: SIZE },
  font: { loadSystemFonts: false },
}).render();

if (rendered.width !== SIZE || rendered.height !== SIZE) {
  throw new Error(`expected a ${SIZE}x${SIZE} icon, rendered ${rendered.width}x${rendered.height}`);
}

const png = rendered.asPng();
writeFileSync(resolve(outDir, 'icon.png'), png);
console.log(`icon:   ${SIZE}x${SIZE}, ${png.length} bytes -> dist/build/icon.png`);

// --- readme -------------------------------------------------------------------
// The icon block is shown on GitHub and dropped here: vsce refuses an SVG anywhere
// in a README, and the Marketplace renders the icon in the page header anyway.
const ICON_BLOCK = /^<!-- icon:begin[\s\S]*?<!-- icon:end -->\n\n/m;

const readme = readFileSync(resolve(root, 'README.md'), 'utf8');

if (!ICON_BLOCK.test(readme)) {
  throw new Error('README.md has no <!-- icon:begin --> … <!-- icon:end --> block to strip');
}

const stripped = readme.replace(ICON_BLOCK, '');
writeFileSync(resolve(outDir, 'README.md'), stripped);
console.log(`readme: icon block stripped, ${stripped.length} bytes -> dist/build/README.md`);
