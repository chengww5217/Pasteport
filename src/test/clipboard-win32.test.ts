import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import { STAGED_IMAGE_PATTERN } from '../clipboard/index';
import { powershellPath, readWin32Clipboard } from '../clipboard/win32';
import { silentLogger } from '../log';

// dist/tsc/test/… -> repository root, where resources/ sits next to dist/.
const scriptPath = path.join(__dirname, '..', '..', '..', 'resources', 'clipboard-read.win32.ps1');
const win32Only = { skip: process.platform !== 'win32' ? 'Windows only' : false };

/** Anything here means PowerShell rejected the script, not the clipboard. */
const SCRIPT_BROKEN = /ParserError|CommandNotFoundException|is not recognized|ParameterBinding/i;

test('powershellPath resolves under SystemRoot, not through PATH', () => {
  // A powershell.exe earlier in PATH must not be able to stand in for the real
  // one, since it is handed our script and our staging directory. Asserted with
  // win32 semantics so this runs on any host.
  const resolved = powershellPath();
  assert.ok(path.win32.isAbsolute(resolved), resolved);
  assert.ok(resolved.endsWith('\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'), resolved);
});

/**
 * Runs the real reader against whatever the machine has on its clipboard —
 * usually nothing on a CI runner, which is fine: the point is that PowerShell
 * parses the script, the -STA requirement is satisfied, and the output honours
 * the JSON contract.
 *
 * A session with no clipboard at all is allowed to come back as an error, but
 * not with an error that means the script itself is broken.
 */
test('the PowerShell reader runs and honours the contract', win32Only, async (t) => {
  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pasteport-staging-test-'));
  try {
    const started = Date.now();
    const content = await readWin32Clipboard({ scriptPath, stagingDir, log: silentLogger });
    const elapsed = Date.now() - started;

    // Reported rather than asserted: this is the R6 measurement, and a CI runner
    // is not the machine whose latency budget matters.
    t.diagnostic(`clipboard probe via powershell took ${elapsed}ms`);

    assert.ok(
      ['files', 'image', 'other', 'error'].includes(content.kind),
      `unexpected payload: ${JSON.stringify(content)}`
    );
    if (content.kind === 'error') {
      assert.doesNotMatch(content.message, SCRIPT_BROKEN, 'the reader script itself failed');
    }
    if (content.kind === 'image') {
      assert.ok(content.paths.every((p) => p.startsWith(stagingDir)));
      assert.ok(content.paths.every((p) => STAGED_IMAGE_PATTERN.test(path.basename(p))));
    }
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true });
  }
});

test('a missing reader script fails as an error payload, not a throw', win32Only, async () => {
  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pasteport-staging-test-'));
  try {
    const content = await readWin32Clipboard({
      scriptPath: path.join(os.tmpdir(), 'pasteport-absent-reader.ps1'),
      stagingDir,
      log: silentLogger,
    });

    assert.equal(content.kind, 'error');
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true });
  }
});
