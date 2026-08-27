import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  normalizeRemoteDir,
  remoteDirForFingerprint,
  remoteFilePath,
  sanitizeFileName,
} from '../remote/paths';

test('normalizeRemoteDir canonicalises absolute paths', () => {
  assert.equal(normalizeRemoteDir('/tmp/pasteport'), '/tmp/pasteport');
  assert.equal(normalizeRemoteDir('  /tmp/pasteport/  '), '/tmp/pasteport');
  assert.equal(normalizeRemoteDir('/tmp//pasteport///x'), '/tmp/pasteport/x');
});

test('normalizeRemoteDir rejects what workspace.fs cannot resolve', () => {
  // `~` would create a directory literally named "~" on the remote host.
  assert.throws(() => normalizeRemoteDir('~/pasteport'), /absolute POSIX path/);
  assert.throws(() => normalizeRemoteDir('tmp/pasteport'), /absolute POSIX path/);
  assert.throws(() => normalizeRemoteDir('   '), /empty/);
});

test('normalizeRemoteDir rejects a newline that would run a command', () => {
  // The path is written into a terminal; an embedded newline would execute.
  assert.throws(() => normalizeRemoteDir('/tmp/x\ntouch pwned\n#'), /control characters/);
  assert.throws(() => normalizeRemoteDir('/tmp/\u0007bell'), /control characters/);
});

test('normalizeRemoteDir rejects the filesystem root', () => {
  // The sweeper deletes fingerprint directories recursively; not at /.
  assert.throws(() => normalizeRemoteDir('/'), /below the filesystem root/);
  assert.throws(() => normalizeRemoteDir('///'), /below the filesystem root/);
});

test('normalizeRemoteDir rejects dot segments that lead back to the root', () => {
  assert.throws(() => normalizeRemoteDir('/..'), /"\." or "\.\."/);
  assert.throws(() => normalizeRemoteDir('/tmp/..'), /"\." or "\.\."/);
  assert.throws(() => normalizeRemoteDir('/./'), /"\." or "\.\."/);
  assert.throws(() => normalizeRemoteDir('/tmp/../../etc'), /"\." or "\.\."/);
  // A leading dot in a real directory name is fine.
  assert.equal(normalizeRemoteDir('/home/me/.cache/pasteport'), '/home/me/.cache/pasteport');
});

test('sanitizeFileName keeps names the remote side never re-parses', () => {
  assert.equal(
    sanitizeFileName('Screenshot 2026-08-24 at 10.28.15.png'),
    'Screenshot 2026-08-24 at 10.28.15.png'
  );
  assert.equal(sanitizeFileName('屏幕截图 2026-08-24.png'), '屏幕截图 2026-08-24.png');
  assert.equal(sanitizeFileName("it's a $(shot).png"), "it's a $(shot).png");
});

test('sanitizeFileName strips structure and control characters', () => {
  assert.equal(sanitizeFileName('/Users/me/Desktop/shot.png'), 'shot.png');
  assert.equal(sanitizeFileName('C:\\Users\\me\\shot.png'), 'shot.png');
  assert.equal(sanitizeFileName('bad\nname\u0000.png'), 'badname.png');
  assert.equal(sanitizeFileName('  spaced.png  '), 'spaced.png');
});

test('sanitizeFileName never yields a path-traversing or empty segment', () => {
  assert.equal(sanitizeFileName(''), 'file');
  assert.equal(sanitizeFileName('.'), 'file');
  assert.equal(sanitizeFileName('..'), 'file');
  assert.equal(sanitizeFileName('/'), 'file');
  assert.equal(sanitizeFileName('../../etc/passwd'), 'passwd');
});

test('sanitizeFileName truncates the stem and preserves the extension', () => {
  const long = `${'a'.repeat(400)}.png`;
  const result = sanitizeFileName(long);

  assert.ok(Buffer.byteLength(result) <= 200, `got ${Buffer.byteLength(result)} bytes`);
  assert.ok(result.endsWith('.png'));
});

test('sanitizeFileName truncates multi-byte names on character boundaries', () => {
  const result = sanitizeFileName(`${'截'.repeat(200)}.png`);

  assert.ok(Buffer.byteLength(result) <= 200);
  assert.ok(!result.includes('\ufffd'));
  assert.equal(result, `${'截'.repeat(65)}.png`);
});

test('remote paths put the fingerprint in a directory of its own', () => {
  assert.equal(
    remoteDirForFingerprint('/tmp/pasteport', 'a1b2c3d4e5f60718'),
    '/tmp/pasteport/a1b2c3d4e5f60718'
  );
  assert.equal(
    remoteFilePath('/tmp/pasteport/', 'a1b2', 'My Report.zip'),
    '/tmp/pasteport/a1b2/My Report.zip'
  );
});
