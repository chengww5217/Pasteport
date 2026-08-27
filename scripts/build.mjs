#!/usr/bin/env node
// Assembles the extension. Two destinations, for two audiences:
//
//   dist/build/    what an F5 dev session loads — the bundle and the icon, exactly where
//                  the committed package.json points
//   dist/package/  a complete, self-contained extension tree; this is what vsce packages
//
// The second one exists because VS Code resolves the %key% placeholders in package.json
// against package.nls*.json in the *extension root*, and nowhere else. Satisfying that by
// generating ten of those into the repository root would put build output next to source
// that is written by hand. Assembling a tree instead keeps the repository to the latter,
// with every generated file under dist/ where the rest of them already live.
//
//   src/extension.ts       -> dist/build/extension.js -> dist/package/extension.js
//   assets/icon.svg        -> dist/build/icon.png     -> dist/package/icon.png
//   README.md              -> dist/package/README.md          (icon block stripped)
//   l10n/nls/package.nls*  -> dist/package/package.nls*.json
//   l10n/bundle.l10n*      -> dist/package/l10n/
//   resources/, LICENSE, CHANGELOG.md -> dist/package/ verbatim
//
// `npm run compile` is a separate step: it type-checks into dist/tsc/, which is where the
// tests run from and which is never packaged. esbuild does not type-check, so neither
// replaces the other. The finished vsix is written to dist/ itself.
//
// Pass --watch to rebuild the bundle on change, unminified and with a source map; the
// packaged tree is not reassembled, since nothing loads it until `npm run package`.

import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import * as esbuild from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = resolve(root, 'dist/build');
const packageDir = resolve(root, 'dist/package');
const watch = process.argv.includes('--watch');

mkdirSync(buildDir, { recursive: true });

// --- bundle -------------------------------------------------------------------
// One file instead of a tree of tsc output: the extension host loads a single
// module, and minification is worth having because every byte is read from disk
// at startup. `vscode` is provided by the host, so it stays external; nothing
// else is imported beyond node builtins.
const options = {
  entryPoints: [resolve(root, 'src/extension.ts')],
  outfile: resolve(buildDir, 'extension.js'),
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
  console.log('bundle:  watching src/ -> dist/build/extension.js');
} else {
  await esbuild.build(options);
  const bytes = readFileSync(options.outfile).length;
  console.log(`bundle:  ${bytes} bytes -> dist/build/extension.js`);
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
writeFileSync(resolve(buildDir, 'icon.png'), png);
console.log(`icon:    ${SIZE}x${SIZE}, ${png.length} bytes -> dist/build/icon.png`);

if (watch) {
  console.log('package: skipped in watch mode; run `npm run build` before packaging');
} else {
  assemblePackage();
}

/** Builds the tree vsce is pointed at, from nothing, every time. */
function assemblePackage() {
  // Rebuilt from scratch rather than updated in place: a file that stops being
  // produced has to stop being shipped, and an incremental copy would keep it
  // forever.
  rmSync(packageDir, { recursive: true, force: true });
  mkdirSync(resolve(packageDir, 'l10n'), { recursive: true });

  const manifest = stagedManifest();
  writeFileSync(resolve(packageDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  cpSync(resolve(buildDir, 'extension.js'), resolve(packageDir, 'extension.js'));
  cpSync(resolve(buildDir, 'icon.png'), resolve(packageDir, 'icon.png'));
  cpSync(resolve(root, 'resources'), resolve(packageDir, 'resources'), { recursive: true });
  cpSync(resolve(root, 'LICENSE'), resolve(packageDir, 'LICENSE'));
  cpSync(resolve(root, 'CHANGELOG.md'), resolve(packageDir, 'CHANGELOG.md'));
  writeFileSync(resolve(packageDir, 'README.md'), packagedReadme());

  // Every file here was put here on purpose, so there is nothing to exclude. vsce
  // warns when this file is absent, and an empty one is a more honest answer than
  // a list of patterns that would match nothing.
  writeFileSync(
    resolve(packageDir, '.vscodeignore'),
    '# Assembled by scripts/build.mjs: this tree contains exactly what ships.\n'
  );

  const bundles = copyJson(resolve(root, 'l10n'), resolve(packageDir, 'l10n'), /^bundle\.l10n\./);
  const nls = copyJson(resolve(root, 'l10n/nls'), packageDir, /^package\.nls\./);

  if (!nls.includes('package.nls.json')) {
    throw new Error('l10n/nls/package.nls.json is missing; it is the fallback for every locale');
  }
  checkPlaceholders(manifest, resolve(packageDir, 'package.nls.json'));

  console.log(`l10n:    ${nls.length} nls + ${bundles.length} bundle file(s) -> dist/package/`);
  console.log('package: dist/package/ assembled; `npm run package` runs vsce there');
}

/**
 * The manifest as it ships.
 *
 * `scripts` goes because nothing in the packaged tree could run them — there is no
 * scripts/ directory and no node_modules — and a `vscode:prepublish` that cannot run
 * would only mislead. `devDependencies` goes for the same reason. The two paths change
 * because the tree is flat: the committed values point at dist/build/ so that F5 finds
 * the bundle in the repository.
 */
function stagedManifest() {
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  delete manifest.scripts;
  delete manifest.devDependencies;
  manifest.main = './extension.js';
  manifest.icon = 'icon.png';
  return manifest;
}

/**
 * README.md without the icon block.
 *
 * vsce refuses an SVG anywhere in a README, and the Marketplace renders the icon in the
 * page header anyway, so the image is shown on GitHub and left out of the package. The
 * line ending is optional so a CRLF checkout still matches, whatever a contributor's
 * core.autocrlf says.
 */
function packagedReadme() {
  const iconBlock = /^<!-- icon:begin[\s\S]*?<!-- icon:end -->\r?\n\r?\n/m;
  const readme = readFileSync(resolve(root, 'README.md'), 'utf8');

  if (!iconBlock.test(readme)) {
    throw new Error('README.md has no <!-- icon:begin --> … <!-- icon:end --> block to strip');
  }
  return readme.replace(iconBlock, '');
}

/** Copies matching .json files, parsing each so a malformed one fails the build. */
function copyJson(from, to, pattern) {
  const names = readdirSync(from).filter((name) => pattern.test(name) && name.endsWith('.json'));

  for (const name of names) {
    const source = readFileSync(resolve(from, name), 'utf8');
    // A broken translation bundle does not fail at load time; it silently degrades
    // that locale, which is exactly the kind of thing nobody notices.
    JSON.parse(source);
    writeFileSync(resolve(to, name), source);
  }
  return names;
}

/** Nothing may ship a `%key%` the fallback bundle cannot resolve. */
function checkPlaceholders(manifest, nlsFile) {
  const english = JSON.parse(readFileSync(nlsFile, 'utf8'));
  const used = [...JSON.stringify(manifest).matchAll(/"%([^%"]+)%"/g)].map((match) => match[1]);
  const missing = used.filter((key) => !(key in english));

  if (missing.length > 0) {
    throw new Error(`package.nls.json does not define: ${missing.join(', ')}`);
  }
}
