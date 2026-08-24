import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatPathsForTerminal, quotePath, shellQuote } from '../quoting';

test('shellQuote leaves safe paths untouched', () => {
  assert.equal(shellQuote('/tmp/pasteport/a1b2/report.zip'), '/tmp/pasteport/a1b2/report.zip');
  assert.equal(shellQuote('/tmp/a-b_c.d+e=f@g%h:i,j'), '/tmp/a-b_c.d+e=f@g%h:i,j');
});

test('shellQuote wraps anything else', () => {
  // The default macOS screenshot name always hits this branch.
  assert.equal(
    shellQuote('/tmp/x/Screenshot 2026-08-24 at 10.28.15.png'),
    "'/tmp/x/Screenshot 2026-08-24 at 10.28.15.png'"
  );
  assert.equal(shellQuote('/tmp/x/$(whoami).png'), "'/tmp/x/$(whoami).png'");
  assert.equal(shellQuote('/tmp/x/名前.png'), "'/tmp/x/名前.png'");
  assert.equal(shellQuote(''), "''");
});

test('shellQuote closes and reopens around single quotes', () => {
  assert.equal(shellQuote("/tmp/it's.png"), "'/tmp/it'\\''s.png'");
  assert.equal(shellQuote("'"), "''\\'''");
});

test('none and auto pass paths through verbatim', () => {
  const raw = "/tmp/x/it's a shot.png";
  assert.equal(quotePath(raw, 'none'), raw);
  assert.equal(quotePath(raw, 'auto'), raw);
  assert.equal(quotePath(raw, 'shell'), "'/tmp/x/it'\\''s a shot.png'");
});

test('formatPathsForTerminal joins with spaces and honours trailingSpace', () => {
  const paths = ['/tmp/a.png', '/tmp/b c.png'];

  assert.equal(
    formatPathsForTerminal(paths, { mode: 'none', trailingSpace: true }),
    '/tmp/a.png /tmp/b c.png '
  );
  assert.equal(
    formatPathsForTerminal(paths, { mode: 'none', trailingSpace: false }),
    '/tmp/a.png /tmp/b c.png'
  );
  assert.equal(
    formatPathsForTerminal(paths, { mode: 'shell', trailingSpace: false }),
    "/tmp/a.png '/tmp/b c.png'"
  );
});

test('formatPathsForTerminal emits nothing for no paths', () => {
  assert.equal(formatPathsForTerminal([], { mode: 'none', trailingSpace: true }), '');
});
