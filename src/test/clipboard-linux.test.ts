import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import { STAGED_IMAGE_PATTERN } from '../clipboard/index';
import {
  chooseBackends,
  fileUriToPath,
  packageFor,
  parseTargets,
  parseUriList,
  pickFileTarget,
  readCommand,
  readLinuxClipboard,
  stagedImageName,
  targetsCommand,
  toolFor,
} from '../clipboard/linux';
import { silentLogger } from '../log';

test('a Wayland session tries Wayland first but keeps X11 as a fallback', () => {
  // XWayland is normally running, and an app under it can own the X selection.
  assert.deepEqual(chooseBackends({ WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' }), [
    'wayland',
    'x11',
  ]);
  assert.deepEqual(chooseBackends({ WAYLAND_DISPLAY: 'wayland-0' }), ['wayland']);
  assert.deepEqual(chooseBackends({ XDG_SESSION_TYPE: 'wayland' }), ['wayland']);
});

test('an X11 session uses xclip only', () => {
  assert.deepEqual(chooseBackends({ DISPLAY: ':0', XDG_SESSION_TYPE: 'x11' }), ['x11']);
});

test('no display variables means no clipboard to read', () => {
  // Distinct from a missing tool, and reported differently.
  assert.deepEqual(chooseBackends({}), []);
  assert.deepEqual(chooseBackends({ WAYLAND_DISPLAY: '', DISPLAY: '' }), []);
});

test('each backend gets its own command line', () => {
  assert.deepEqual(targetsCommand('wayland'), ['wl-paste', ['--list-types']]);
  assert.deepEqual(targetsCommand('x11'), [
    'xclip',
    ['-selection', 'clipboard', '-t', 'TARGETS', '-o'],
  ]);

  assert.deepEqual(readCommand('wayland', 'image/png'), [
    'wl-paste',
    ['--no-newline', '--type', 'image/png'],
  ]);
  assert.deepEqual(readCommand('x11', 'image/png'), [
    'xclip',
    ['-selection', 'clipboard', '-t', 'image/png', '-o'],
  ]);
});

test('parseTargets trims, drops blanks and deduplicates', () => {
  const stdout = 'text/plain\n text/uri-list \n\ntext/plain\nimage/png\n';
  assert.deepEqual(parseTargets(stdout), ['text/plain', 'text/uri-list', 'image/png']);
});

test('the GNOME flavour is preferred over the generic uri list', () => {
  assert.equal(
    pickFileTarget(['text/uri-list', 'x-special/gnome-copied-files']),
    'x-special/gnome-copied-files'
  );
  assert.equal(pickFileTarget(['text/uri-list', 'text/plain']), 'text/uri-list');
  assert.equal(pickFileTarget(['text/plain', 'image/png']), undefined);
});

test('parseUriList decodes paths and skips the format noise', () => {
  const body = 'copy\nfile:///home/me/%E5%B1%8F%E5%B9%95%E6%88%AA%E5%9B%BE.png\r\n# comment\n\n';
  assert.deepEqual(parseUriList(body), ['/home/me/屏幕截图.png']);

  assert.deepEqual(parseUriList('file:///a/one.txt\nfile:///a/two%20three.txt'), [
    '/a/one.txt',
    '/a/two three.txt',
  ]);
});

test('parseUriList ignores anything that is not a local file', () => {
  // Copying a link in a browser also produces text/uri-list.
  assert.deepEqual(parseUriList('https://example.com/x.png'), []);
  assert.deepEqual(parseUriList('file://otherhost/a/b.png'), []);
  assert.deepEqual(parseUriList('not a uri at all'), []);
});

test('fileUriToPath handles the localhost form and rejects the rest', () => {
  assert.equal(fileUriToPath('file:///a/b.png'), '/a/b.png');
  assert.equal(fileUriToPath('file://localhost/a/b.png'), '/a/b.png');
  assert.equal(fileUriToPath('file://nas/a/b.png'), undefined);
  assert.equal(fileUriToPath('file:///a/%ZZ.png'), undefined);
  assert.equal(fileUriToPath('file://'), undefined);
});

test('each backend knows its tool and the package that provides it', () => {
  assert.equal(toolFor('wayland'), 'wl-paste');
  assert.equal(packageFor('wayland'), 'wl-clipboard');
  assert.equal(toolFor('x11'), 'xclip');
  assert.equal(packageFor('x11'), 'xclip');
});

test('staged image names match what the TTL sweeper looks for', () => {
  const name = stagedImageName(new Date(2026, 7, 24, 9, 5, 3, 7));
  assert.equal(name, 'clipboard-20260824-090503-007.png');
  assert.ok(STAGED_IMAGE_PATTERN.test(name));
});

test('with no display, the reader says so and marks it actionable', async () => {
  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pasteport-staging-test-'));
  try {
    const content = await readLinuxClipboard({
      stagingDir,
      log: silentLogger,
      env: {},
    });

    assert.equal(content.kind, 'error');
    if (content.kind === 'error') {
      assert.match(content.message, /no graphical session/);
      assert.equal(content.actionable, true);
    }
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true });
  }
});

test('a missing tool is reported with the package that would fix it', async () => {
  // Pointed at a PATH with no clipboard tools at all: the reader must describe
  // the fix rather than just failing, so the UI can offer to install it.
  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pasteport-staging-test-'));
  const emptyBinDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pasteport-nobin-'));
  const realPath = process.env['PATH'];
  process.env['PATH'] = emptyBinDir;

  try {
    const content = await readLinuxClipboard({
      stagingDir,
      log: silentLogger,
      env: { WAYLAND_DISPLAY: 'wayland-0' },
    });

    assert.equal(content.kind, 'error');
    if (content.kind === 'error') {
      assert.equal(content.actionable, true);
      assert.match(content.message, /wl-paste is not installed/);
      assert.deepEqual(content.remedy, { kind: 'installPackages', packages: ['wl-clipboard'] });
    }
  } finally {
    process.env['PATH'] = realPath;
    await fs.rm(stagingDir, { recursive: true, force: true });
    await fs.rm(emptyBinDir, { recursive: true, force: true });
  }
});
