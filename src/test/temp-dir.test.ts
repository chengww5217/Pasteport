import assert from 'node:assert/strict';
import { test } from 'node:test';

import { silentLogger } from '../log';
import {
  detectRemoteTempRoot,
  ENVIRON_PATH,
  FALLBACK_REMOTE_TMP,
  parseTempDirFromEnviron,
  remoteDirUnder,
  type RemoteProbe,
} from '../remote/tempDir';

/** A NUL-separated environ blob, exactly as procfs serves it. */
function environ(...entries: string[]): Uint8Array {
  return new TextEncoder().encode(`${entries.join('\0')}\0`);
}

/**
 * @param files paths the probe can read.
 * @param dirs paths the probe reports as directories.
 */
function probe(
  files: Record<string, Uint8Array>,
  dirs: readonly string[]
): RemoteProbe & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    readFile: (posixPath) => {
      reads.push(posixPath);
      const found = files[posixPath];
      return found === undefined
        ? Promise.reject(new Error(`ENOENT: ${posixPath}`))
        : Promise.resolve(found);
    },
    isDirectory: (posixPath) => Promise.resolve(dirs.includes(posixPath)),
  };
}

test('TMPDIR wins over the other temp variables', () => {
  const blob = environ('PATH=/usr/bin', 'TEMP=/temp', 'TMP=/tmp-b', 'TMPDIR=/scratch/tmp');
  assert.equal(parseTempDirFromEnviron(blob), '/scratch/tmp');
});

test('TMP and TEMP are honoured when TMPDIR is absent', () => {
  assert.equal(parseTempDirFromEnviron(environ('TEMP=/t2', 'TMP=/t1')), '/t1');
  assert.equal(parseTempDirFromEnviron(environ('TEMP=/t2')), '/t2');
});

test('a temp value that is not a usable remote directory is skipped', () => {
  // Relative, home-relative and empty values would all produce a wrong path
  // rather than an error, since workspace.fs resolves none of them.
  assert.equal(parseTempDirFromEnviron(environ('TMPDIR=~/tmp', 'TMP=/var/tmp')), '/var/tmp');
  assert.equal(parseTempDirFromEnviron(environ('TMPDIR=tmp')), undefined);
  assert.equal(parseTempDirFromEnviron(environ('TMPDIR=')), undefined);
  assert.equal(parseTempDirFromEnviron(environ('TMPDIR=/tmp/../etc')), undefined);
  assert.equal(parseTempDirFromEnviron(environ('TMPDIR=/tmp\nrm -rf /')), undefined);
});

test('an environ without temp variables yields nothing', () => {
  assert.equal(parseTempDirFromEnviron(environ('PATH=/usr/bin', 'HOME=/home/me')), undefined);
  assert.equal(parseTempDirFromEnviron(new Uint8Array()), undefined);
});

test('a trailing slash is canonicalised away', () => {
  assert.equal(parseTempDirFromEnviron(environ('TMPDIR=/scratch/tmp/')), '/scratch/tmp');
});

test("detection reads the remote server's own environment first", async () => {
  const remote = probe({ [ENVIRON_PATH]: environ('TMPDIR=/scratch/tmp') }, ['/scratch/tmp']);
  assert.equal(await detectRemoteTempRoot(remote, silentLogger), '/scratch/tmp');
  assert.deepEqual(remote.reads, [ENVIRON_PATH]);
});

test('a TMPDIR that is not there falls through to the standard locations', async () => {
  const remote = probe({ [ENVIRON_PATH]: environ('TMPDIR=/scratch/tmp') }, ['/tmp']);
  assert.equal(await detectRemoteTempRoot(remote, silentLogger), '/tmp');
});

test('a remote without procfs is probed instead', async () => {
  assert.equal(await detectRemoteTempRoot(probe({}, ['/tmp']), silentLogger), '/tmp');
  assert.equal(await detectRemoteTempRoot(probe({}, ['/var/tmp']), silentLogger), '/var/tmp');
});

test('a host that answers nothing still gets a working default', async () => {
  assert.equal(await detectRemoteTempRoot(probe({}, []), silentLogger), FALLBACK_REMOTE_TMP);
});

test('the extension only ever writes under its own subdirectory', () => {
  assert.equal(remoteDirUnder('/scratch/tmp'), '/scratch/tmp/pasteport');
  assert.equal(remoteDirUnder('/tmp/'), '/tmp/pasteport');
});
