import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

/**
 * Localisation is only correct if three sets agree: the strings the code asks
 * for, the keys in the English bundle, and the keys in every translation. Any
 * one of them drifting silently degrades a locale back to English, which is
 * exactly the kind of failure nobody notices.
 *
 * The repo root is reached from dist/tsc/test/, where the compiled tests run.
 */
const ROOT = path.resolve(__dirname, '..', '..', '..');
const L10N_DIR = path.join(ROOT, 'l10n');
/** Sources for the root package.nls*.json copies that scripts/build.mjs writes. */
const NLS_DIR = path.join(L10N_DIR, 'nls');

/** Placeholders `vscode.l10n.t` substitutes, e.g. `{0}`. */
const PLACEHOLDER = /\{\d+\}/g;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

/**
 * The first argument of every `l10n.t(...)` call in the source.
 *
 * A literal is required — that is what makes the strings extractable at all — so
 * a regex is enough, and it fails loudly (by finding nothing) if that convention
 * is ever broken.
 */
function requestedKeys(): Set<string> {
  const call = /l10n\.t\(\s*(['"])((?:\\.|(?!\1).)*)\1/gs;
  const keys = new Set<string>();

  for (const file of sourceFiles(path.join(ROOT, 'src'))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(call)) {
      keys.add(unescapeLiteral(match[2] ?? ''));
    }
  }
  return keys;
}

/** Turns a TypeScript string literal body into the runtime string. */
function unescapeLiteral(literal: string): string {
  return literal.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|.)/g, (_, escape: string) => {
    switch (escape) {
      case 'n':
        return '\n';
      case 't':
        return '\t';
      case 'r':
        return '\r';
      case '0':
        return '\0';
      default:
        return escape.startsWith('u') ? String.fromCodePoint(codePoint(escape)) : escape;
    }
  });
}

function codePoint(escape: string): number {
  const hex = escape.startsWith('u{') ? escape.slice(2, -1) : escape.slice(1);
  return Number.parseInt(hex, 16);
}

function readJson(file: string): Record<string, string> {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;
}

function translationBundles(): string[] {
  return fs
    .readdirSync(L10N_DIR)
    .filter((name) => /^bundle\.l10n\..+\.json$/.test(name))
    .sort();
}

function nlsTranslations(): string[] {
  return fs
    .readdirSync(NLS_DIR)
    .filter((name) => /^package\.nls\..+\.json$/.test(name))
    .sort();
}

test('every localised string in the source is in the English bundle', () => {
  const english = readJson(path.join(L10N_DIR, 'bundle.l10n.json'));
  const requested = requestedKeys();

  assert.ok(requested.size > 0, 'found no l10n.t() calls — has the convention changed?');

  for (const key of requested) {
    assert.ok(key in english, `l10n/bundle.l10n.json is missing ${JSON.stringify(key)}`);
    assert.equal(english[key], key, `the English bundle must map ${JSON.stringify(key)} to itself`);
  }

  for (const key of Object.keys(english)) {
    // A stale key is not harmless: it is a string translators are still paying
    // for and reviewers still reading.
    assert.ok(requested.has(key), `l10n/bundle.l10n.json has an unused key: ${key}`);
  }
});

test('every translation covers the English bundle exactly', () => {
  const english = readJson(path.join(L10N_DIR, 'bundle.l10n.json'));
  const bundles = translationBundles();

  assert.ok(bundles.length > 0, 'no translated bundles found');

  for (const name of bundles) {
    const translated = readJson(path.join(L10N_DIR, name));

    for (const key of Object.keys(english)) {
      const value = translated[key];
      assert.ok(value !== undefined, `${name} is missing ${JSON.stringify(key)}`);
      assert.notEqual(value.trim(), '', `${name} leaves ${JSON.stringify(key)} empty`);
    }
    for (const key of Object.keys(translated)) {
      assert.ok(key in english, `${name} has a key the English bundle does not: ${key}`);
    }
  }
});

test('translations keep every placeholder the English string has', () => {
  const english = readJson(path.join(L10N_DIR, 'bundle.l10n.json'));

  for (const name of translationBundles()) {
    const translated = readJson(path.join(L10N_DIR, name));

    for (const [key, source] of Object.entries(english)) {
      // A dropped {0} silently swallows a path or a size; an invented one is
      // rendered as a literal brace pair.
      const expected = [...source.matchAll(PLACEHOLDER)].map((m) => m[0]).sort();
      const actual = [...(translated[key] ?? '').matchAll(PLACEHOLDER)].map((m) => m[0]).sort();
      assert.deepEqual(actual, expected, `${name} changes the placeholders of ${key}`);
    }
  }
});

test('package.json placeholders all resolve, in every language', () => {
  const manifest = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
  const used = new Set([...manifest.matchAll(/"%([^%"]+)%"/g)].map((m) => m[1]));
  const english = readJson(path.join(NLS_DIR, 'package.nls.json'));

  assert.ok(used.size > 0, 'package.json uses no %nls% placeholders');

  for (const key of used) {
    assert.ok(key in english, `l10n/nls/package.nls.json is missing ${key}`);
  }
  for (const key of Object.keys(english)) {
    assert.ok(used.has(key), `l10n/nls/package.nls.json has an unused key: ${key}`);
  }

  const locales = nlsTranslations();
  assert.ok(locales.length > 0, 'no translated package.nls files found');

  for (const name of locales) {
    const translated = readJson(path.join(NLS_DIR, name));
    for (const key of Object.keys(english)) {
      const value = translated[key];
      assert.ok(value !== undefined, `${name} is missing ${key}`);
      assert.notEqual(value.trim(), '', `${name} leaves ${key} empty`);
    }
    for (const key of Object.keys(translated)) {
      assert.ok(key in english, `${name} has a key package.nls.json does not: ${key}`);
    }
  }
});

test('the same set of languages is offered by both halves of the UI', () => {
  // Half a translated extension is worse than none: the command palette in one
  // language and its dialogs in another looks like a bug.
  const bundleLocales = translationBundles()
    .map((name) => name.replace(/^bundle\.l10n\.(.+)\.json$/, '$1'))
    .sort();
  const manifestLocales = nlsTranslations()
    .map((name) => name.replace(/^package\.nls\.(.+)\.json$/, '$1'))
    .sort();

  assert.deepEqual(bundleLocales, manifestLocales);
});

test('every translated language has a documented README, or none does', () => {
  // The docs are translated into a subset of the UI languages on purpose — a
  // README is prose, not a string table — but a link that goes nowhere is a bug.
  const readmes = fs
    .readdirSync(path.join(ROOT, 'docs'))
    .filter((name) => /^README\..+\.md$/.test(name));

  assert.ok(readmes.length > 0, 'docs/ has no translated README');

  for (const name of readmes) {
    const locale = name.replace(/^README\.(.+)\.md$/, '$1').toLowerCase();
    assert.ok(
      fs.existsSync(path.join(NLS_DIR, `package.nls.${locale}.json`)),
      `docs/${name} is a language the extension itself is not translated into`
    );
  }
});
