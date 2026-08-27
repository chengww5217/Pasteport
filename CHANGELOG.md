# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Clipboard images are staged in the extension's own global storage instead of a fixed name under
  `os.tmpdir()`. On Linux that was a shared, world-writable `/tmp`, where another user of the machine
  could read every screenshot passing through, or pre-create the directory and plant a symlink under
  a name that is only a millisecond timestamp. `Pasteport: Diagnose` prints the path in use.
- `pasteport.remoteDir` now defaults to empty, which means "detect it". The remote host's own
  `TMPDIR` is read out of the remote server process's environment through `workspace.fs`
  (`/proc/self/environ`), falling back to the first of `/tmp` and `/var/tmp` that exists, and then
  to `/tmp` with a warning. Files land under a `pasteport` subdirectory of whatever was chosen. A
  host that points `TMPDIR` elsewhere is no longer ignored; setting the value explicitly still skips
  detection. Detection costs at most two round trips, once per remote host per session.
- `Pasteport: Diagnose` reports the resolved remote directory alongside the configured one.

### Fixed

- The paste key no longer does nothing while a transfer is in flight: the extension's own handling
  is dropped, but the keystroke is passed through to the terminal as it always was.
- A clipboard reader that throws — rather than returning an error payload, as all of them do —
  passes the keystroke through instead of swallowing it.
- Remote directory detection is bounded by a timeout and its result is only remembered when the host
  actually answered. A detection that ran before the remote file system was serving no longer pins
  `/tmp` for the rest of the session, and a half-dead connection can no longer leave the paste
  command waiting forever.
- Backtick and `$` are stripped from remote file names. `quoting: auto` inserts paths verbatim, so a
  file called ``x`id`.png`` used to carry live shell syntax to the prompt.
- The Windows reader validates that the clipboard's `PNG` flavour really is a PNG before staging it,
  falling back to the bitmap when it is not — the Linux reader already did — and disposes the
  clipboard stream it reads.
- The Linux install helper spawns the package manager and `pkexec` by the absolute path it found
  rather than by name, since the command runs as root.
- A clipboard holding thousands of files no longer kills the reader with `ENOBUFS`: the output limit
  is 8 MB rather than 1 MB. Only paths cross that pipe, never image bytes.
- `release.yml` passes the tag version to the shell through the environment instead of interpolating
  it into a command line.

## [0.0.1] - 2026-08-24

Released on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=chengww.pasteport)
and [Open VSX](https://open-vsx.org/extension/chengww/pasteport).

### Added

- Paste images and files from the macOS clipboard into the terminal of a VS Code remote window; the
  remote path is inserted at the prompt.
- Transfer through `workspace.fs`, using a URI borrowed from the window, so every remote backend
  takes the same code path. Verified end to end on Remote - SSH.
- Deduplication by fingerprint: content SHA-256 up to 8 MB, `size:mtime:name` above it. An existing
  remote copy of the right size is reused instead of re-sent.
- Status-bar progress from the first millisecond; a confirmation dialog and cancellable
  notification for transfers estimated to exceed `pasteport.confirmAboveSeconds`, based on the
  throughput measured on your own link.
- TTL cleanup of uploaded files and locally staged images, in the background at startup and via
  `Pasteport: Clean Up Remote Files`.
- `Pasteport: Diagnose`, which reports every condition a successful paste depends on.
- Settings: `remoteDir`, `quoting`, `trailingSpace`, `confirmAboveSeconds`, `ttlHours`,
  `bracketedPaste`.
- Windows client support: a PowerShell reader taking the PNG clipboard flavour when present and the
  bitmap otherwise, bound to <kbd>Ctrl</kbd>+<kbd>V</kbd>.
- Linux client support: `wl-paste` on Wayland and `xclip` on X11, handling `text/uri-list` and
  `x-special/gnome-copied-files`, bound to <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd>.
- When the Linux clipboard tool is missing, an offer to install it: the command is shown before it
  runs, elevation goes through `pkexec` so the desktop prompts for authentication, and unsupported or
  source-based distributions are told what to run instead of having something guessed for them.
- `pasteport.paste` is contributed to `terminal.integrated.commandsToSkipShell`, without which the
  paste key on Windows is delivered to the shell and never reaches the extension.
- An extension icon, rasterised from `assets/icon.svg` at package time by `scripts/build.mjs`; no
  image is committed.
- Packaging through esbuild: the extension ships as one minified `dist/build/extension.js`, and the
  vsix contains neither tests nor source maps.

### Known limitations

- The Windows and Linux readers have not been exercised on a real desktop session yet; both are
  covered by unit tests, and the Windows one runs against a real PowerShell in CI.
- PowerShell's startup cost is unmeasured on real hardware. It lands on every paste, including
  plain-text ones; the extension logs a warning if a probe exceeds 150ms.
- Only Remote - SSH has been verified as a backend; Dev Containers, WSL and Tunnels use the same code
  path but have not been exercised yet.
- `quoting: auto` inserts paths verbatim while quote handling in TUI agents is unverified.
- A transfer already in flight cannot be interrupted mid-file: `workspace.fs.writeFile` has no
  cancellation point, so cancelling stops the transfer between files.

[unreleased]: https://github.com/chengww5217/pasteport/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/chengww5217/pasteport/releases/tag/v0.0.1
