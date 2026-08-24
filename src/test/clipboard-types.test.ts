import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseClipboardPayload } from '../clipboard/types';

test('parses the files payload', () => {
  const result = parseClipboardPayload('{"kind":"files","paths":["/a/one.txt","/a/two.txt"]}');
  assert.deepEqual(result, { kind: 'files', paths: ['/a/one.txt', '/a/two.txt'] });
});

test('parses the image payload', () => {
  const result = parseClipboardPayload('{"kind":"image","paths":["/tmp/staged.png"]}\n');
  assert.deepEqual(result, { kind: 'image', paths: ['/tmp/staged.png'] });
});

test('parses the other payload, keeping type identifiers for the log', () => {
  const result = parseClipboardPayload('{"kind":"other","types":["public.utf8-plain-text"]}');
  assert.deepEqual(result, { kind: 'other', types: ['public.utf8-plain-text'] });
});

test('parses the error payload', () => {
  const result = parseClipboardPayload('{"kind":"error","message":"AppKit import failed"}');
  assert.deepEqual(result, { kind: 'error', message: 'AppKit import failed' });
});

test('ignores interpreter noise around the JSON object', () => {
  const noisy = 'osascript: some warning\n{"kind":"other","types":[]}\n';
  assert.deepEqual(parseClipboardPayload(noisy), { kind: 'other', types: [] });
});

test('parses a Windows payload with escaped separators and \\u escapes', () => {
  // The PowerShell reader emits ASCII-only JSON so the console code page cannot
  // corrupt a name, which means both of these escapes are the normal case there.
  const raw = '{"kind":"files","paths":["C:\\\\Users\\\\me\\\\\\u5c4f\\u5e55\\u622a\\u56fe.png"]}';
  assert.deepEqual(parseClipboardPayload(raw), {
    kind: 'files',
    paths: ['C:\\Users\\me\\屏幕截图.png'],
  });
});

test('malformed output degrades to an error value, never a throw', () => {
  for (const raw of ['', '   ', 'not json at all', '{"kind":', '[]', '{"kind":"weird"}']) {
    const result = parseClipboardPayload(raw);
    assert.equal(result.kind, 'error', `raw=${JSON.stringify(raw)}`);
  }
});

test('a path-bearing kind with nothing usable is an error, not an empty success', () => {
  // Silently treating this as "nothing to paste" would hide a broken reader.
  assert.equal(parseClipboardPayload('{"kind":"files","paths":[]}').kind, 'error');
  assert.equal(parseClipboardPayload('{"kind":"files"}').kind, 'error');
  assert.equal(parseClipboardPayload('{"kind":"image","paths":[42, "  "]}').kind, 'error');
});

test('non-string entries are dropped rather than poisoning the path list', () => {
  const result = parseClipboardPayload('{"kind":"files","paths":["/a/one.txt", null, 7]}');
  assert.deepEqual(result, { kind: 'files', paths: ['/a/one.txt'] });
});

test('error payload without a message still identifies itself', () => {
  const result = parseClipboardPayload('{"kind":"error"}');
  assert.deepEqual(result, { kind: 'error', message: 'unspecified reader error' });
});

test('other payload tolerates a missing types array', () => {
  assert.deepEqual(parseClipboardPayload('{"kind":"other"}'), { kind: 'other', types: [] });
});
