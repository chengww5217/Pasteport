import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import { readDarwinClipboard } from '../clipboard/darwin';
import { STAGED_IMAGE_PATTERN } from '../clipboard/index';
import { silentLogger } from '../log';

// dist/tsc/test/… -> repository root, where resources/ sits next to dist/.
const scriptPath = path.join(__dirname, '..', '..', '..', 'resources', 'clipboard-read.darwin.js');
const darwinOnly = { skip: process.platform !== 'darwin' ? 'macOS only' : false };

test('the staged image pattern accepts the readers format and nothing else', () => {
  // The TTL sweeper deletes exactly what this matches, so a reader drifting
  // from the format would leak staged images forever.
  assert.ok(STAGED_IMAGE_PATTERN.test('clipboard-20260824-103727-127.png'));
  assert.ok(!STAGED_IMAGE_PATTERN.test('clipboard-20260824-103727.png'));
  assert.ok(!STAGED_IMAGE_PATTERN.test('important-notes.png'));
  assert.ok(!STAGED_IMAGE_PATTERN.test('clipboard-20260824-103727-127.png.bak'));
});

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
      // Staged images must be absolute, inside the directory we handed over,
      // and named so the sweeper will recognise them later.
      assert.ok(content.paths.every((p) => p.startsWith(stagingDir)));
      assert.ok(content.paths.every((p) => STAGED_IMAGE_PATTERN.test(path.basename(p))));
    }
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true });
  }
});

test('a missing reader script fails as an error payload, not a throw', darwinOnly, async () => {
  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pasteport-staging-test-'));
  try {
    const content = await readDarwinClipboard({
      scriptPath: path.join(os.tmpdir(), 'pasteport-absent-reader.js'),
      stagingDir,
      log: silentLogger,
    });

    assert.equal(content.kind, 'error');
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true });
  }
});
