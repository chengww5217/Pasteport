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

/** The locales a `docs/<document>.<locale>.md` set is translated into, lowercased. */
function documentLocales(files: string[], document: string): string[] {
  const pattern = new RegExp(`^${document}\\.(.+)\\.md$`);

  return files
    .flatMap((file) => pattern.exec(file)?.[1] ?? [])
    .map((locale) => locale.toLowerCase())
    .sort();
}

test('every localised string in the source is in the English bundle', () => {
  const english = readJson(path.join(L10N_DIR, 'bundle.l10n.json'));
  const requested = requestedKeys();

  assert.ok(requested.size > 0, 'found no l10n.t() calls — has the convention changed?');

  for (const key of requested) {
    assert.ok(key in english, `l10n/bundle.l10n.json is missing ${JSON.stringify(key)}`);
    const value = english[key];
    assert.ok(value.trim() !== '', `l10n/bundle.l10n.json leaves ${JSON.stringify(key)} empty`);
    // The English bundle holds the sentence that is shown when a locale is
    // missing; a value that is also a key would render the key to the user.
    assert.notEqual(value, key, `l10n/bundle.l10n.json leaves ${JSON.stringify(key)} untranslated`);
  }

  for (const key of Object.keys(english)) {
    // A stale key is not harmless: it is a string translators are still paying
    // for and reviewers still reading.
    assert.ok(requested.has(key), `l10n/bundle.l10n.json has an unused key: ${key}`);
  }

  // Keys are semantic identifiers, grouped by feature; a sentence-shaped key
  // means a call site was pasted instead of named.
  for (const key of Object.keys(english)) {
    assert.ok(
      /^pasteport\.[a-z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)+$/.test(key),
      `keys must be pasteport.<feature>.<name>: ${key}`
    );
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

test('every translated document is a language the extension itself is translated into', () => {
  // The docs are translated into a subset of the UI languages on purpose — prose is
  // not a string table — but a link that goes nowhere is a bug.
  const files = fs.readdirSync(path.join(ROOT, 'docs'));
  const readmes = documentLocales(files, 'README');
  const changelogs = documentLocales(files, 'CHANGELOG');

  assert.ok(readmes.length > 0, 'docs/ has no translated README');

  // A locale with one document but not the other reads as a half-finished
  // translation: the reader follows a language link and lands back in English.
  assert.deepEqual(
    changelogs,
    readmes,
    'docs/README.* and docs/CHANGELOG.* cover different locales'
  );

  for (const locale of readmes) {
    assert.ok(
      fs.existsSync(path.join(NLS_DIR, `package.nls.${locale}.json`)),
      `docs/ documents ${locale}, a language the extension itself is not translated into`
    );
  }
});

test('the English documents link to every translation of themselves', () => {
  // The language switcher at the top of each document is written by hand, so a
  // translation nothing points at is a file nobody finds.
  const files = fs.readdirSync(path.join(ROOT, 'docs'));

  for (const document of ['README', 'CHANGELOG']) {
    const english = fs.readFileSync(path.join(ROOT, `${document}.md`), 'utf8');

    for (const file of files.filter((name) => name.startsWith(`${document}.`))) {
      assert.ok(english.includes(`docs/${file}`), `${document}.md does not link to docs/${file}`);
    }
  }
});
