import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import { keepOnlyRegularFiles, type ClipboardContent } from '../clipboard/index';
import { silentLogger } from '../log';

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'pasteport-test-'));
}

test('keepOnlyRegularFiles passes non-path payloads straight through', async () => {
  const other: ClipboardContent = { kind: 'other', types: ['public.utf8-plain-text'] };
  assert.deepEqual(await keepOnlyRegularFiles(other, silentLogger), other);

  const error: ClipboardContent = { kind: 'error', message: 'boom' };
  assert.deepEqual(await keepOnlyRegularFiles(error, silentLogger), error);
});

test('keepOnlyRegularFiles keeps files and drops directories and dead paths', async () => {
  const dir = await tempDir();
  try {
    const file = path.join(dir, 'keep.txt');
    const subdir = path.join(dir, 'subdir');
    await fs.writeFile(file, 'x');
    await fs.mkdir(subdir);

    const result = await keepOnlyRegularFiles(
      { kind: 'files', paths: [file, subdir, path.join(dir, 'gone.txt')] },
      silentLogger
    );

    assert.deepEqual(result, { kind: 'files', paths: [file] });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('keepOnlyRegularFiles follows a symlink to a file', async () => {
  const dir = await tempDir();
  try {
    const target = path.join(dir, 'target.txt');
    const link = path.join(dir, 'link.txt');
    await fs.writeFile(target, 'x');
    await fs.symlink(target, link);

    const result = await keepOnlyRegularFiles({ kind: 'files', paths: [link] }, silentLogger);
    assert.deepEqual(result, { kind: 'files', paths: [link] });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a folder-only copy becomes "other" so the native paste can run', async () => {
  const dir = await tempDir();
  try {
    const result = await keepOnlyRegularFiles({ kind: 'files', paths: [dir] }, silentLogger);
    assert.equal(result.kind, 'other');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a staged image that disappeared is an error, not a silent no-op', async () => {
  const result = await keepOnlyRegularFiles(
    { kind: 'image', paths: [path.join(os.tmpdir(), 'pasteport-absent.png')] },
    silentLogger
  );
  assert.equal(result.kind, 'error');
});
