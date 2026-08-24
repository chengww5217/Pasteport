import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import { readDarwinClipboard } from '../clipboard/darwin';
import { silentLogger } from '../log';

const scriptPath = path.join(__dirname, '..', '..', 'media', 'clipboard-read.js');
const darwinOnly = { skip: process.platform !== 'darwin' ? 'macOS only' : false };

/**
 * Reads whatever the developer happens to have on the clipboard: the point is
 * that the JXA script runs and honours the contract, so the test must not
 * clobber the pasteboard to make an assertion easier.
 */
test('the JXA reader runs and returns a contract-shaped payload', darwinOnly, async () => {
  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pasteport-staging-test-'));
  try {
    const content = await readDarwinClipboard({ scriptPath, stagingDir, log: silentLogger });

    assert.ok(
      ['files', 'image', 'other'].includes(content.kind),
      `unexpected payload: ${JSON.stringify(content)}`
    );
    if (content.kind === 'image') {
      // Staged images must be absolute and inside the directory we handed over.
      assert.ok(content.paths.every((p) => p.startsWith(stagingDir)));
    }
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true });
  }
});

test('a missing reader script fails as an error payload, not a throw', darwinOnly, async () => {
  const content = await readDarwinClipboard({
    scriptPath: path.join(os.tmpdir(), 'pasteport-absent-reader.js'),
    stagingDir: await fs.mkdtemp(path.join(os.tmpdir(), 'pasteport-staging-test-')),
    log: silentLogger,
  });

  assert.equal(content.kind, 'error');
});
