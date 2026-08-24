import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  choosePackageManager,
  ELEVATOR,
  installArgv,
  PACKAGE_MANAGERS,
  renderCommand,
} from '../installPolicy';

/** Builds the availability predicate a real system would produce. */
const withBinaries =
  (...binaries: string[]) =>
  (binary: string): boolean =>
    binaries.includes(binary);

test('the distribution is identified by its package manager binary', () => {
  assert.equal(choosePackageManager(withBinaries('apt-get'))?.id, 'apt');
  assert.equal(choosePackageManager(withBinaries('dnf'))?.id, 'dnf');
  assert.equal(choosePackageManager(withBinaries('pacman'))?.id, 'pacman');
  assert.equal(choosePackageManager(withBinaries('zypper'))?.id, 'zypper');
  assert.equal(choosePackageManager(withBinaries('apk'))?.id, 'apk');
  assert.equal(choosePackageManager(withBinaries('xbps-install'))?.id, 'xbps');
  assert.equal(choosePackageManager(withBinaries('eopkg'))?.id, 'eopkg');
});

test('an unrecognised system yields nothing rather than a guess', () => {
  // Source-based distributions land here on purpose: an unattended emerge can
  // compile for an hour, so those users are shown the command instead.
  assert.equal(choosePackageManager(withBinaries()), undefined);
  assert.equal(choosePackageManager(withBinaries('emerge', 'nix-env')), undefined);
});

test('every install command is non-interactive and installs only what was asked', () => {
  for (const manager of PACKAGE_MANAGERS) {
    const args = manager.install(['wl-clipboard']);

    assert.ok(args.includes('wl-clipboard'), manager.id);
    assert.ok(!args.some((arg) => /upgrade|dist-upgrade|update|-Syu/.test(arg)), manager.id);
    // Nothing may be interpolated into a shell: these are argv entries.
    assert.ok(!args.some((arg) => /[;&|`$]/.test(arg)), manager.id);
  }
});

test('the spawned command elevates through pkexec, not sudo', () => {
  // A desktop session has no terminal to type a sudo password into; pkexec
  // prompts through the desktop's own agent.
  const manager = choosePackageManager(withBinaries('apt-get'));
  assert.ok(manager);

  const [command, args] = installArgv(manager, ['wl-clipboard']);
  assert.equal(command, ELEVATOR);
  assert.deepEqual(args, ['apt-get', 'install', '-y', 'wl-clipboard']);
  assert.equal(renderCommand(command, args), 'pkexec apt-get install -y wl-clipboard');
});

test('pacman installs without reinstalling what is already there', () => {
  const manager = choosePackageManager(withBinaries('pacman'));
  assert.ok(manager);
  assert.deepEqual(manager.install(['xclip']), ['-S', '--needed', '--noconfirm', 'xclip']);
});
