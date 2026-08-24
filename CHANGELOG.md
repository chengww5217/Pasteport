# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
