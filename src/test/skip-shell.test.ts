import assert from 'node:assert/strict';
import { test } from 'node:test';

import { needsSkipShellEntry, PASTE_COMMAND } from '../skipShellPolicy';

test('an unset skip list needs nothing: the contributed default covers it', () => {
  assert.equal(needsSkipShellEntry(undefined, PASTE_COMMAND), false);
});

test('a user list without our command leaves the paste key unreachable', () => {
  // A user value replaces the contributed default outright, ours included.
  assert.equal(needsSkipShellEntry(['workbench.action.quickOpen'], PASTE_COMMAND), true);
  assert.equal(needsSkipShellEntry([], PASTE_COMMAND), true);
});

test('a user list that already has our command is left alone', () => {
  assert.equal(needsSkipShellEntry([PASTE_COMMAND], PASTE_COMMAND), false);
  assert.equal(needsSkipShellEntry(['a', PASTE_COMMAND, 'b'], PASTE_COMMAND), false);
});

test('an explicit removal is respected rather than argued with', () => {
  // "-command" is VS Code's syntax for dropping an entry; someone who typed it
  // meant it, and a dialog every startup would be the wrong answer.
  assert.equal(needsSkipShellEntry([`-${PASTE_COMMAND}`], PASTE_COMMAND), false);
});
