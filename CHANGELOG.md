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

### Known limitations

- macOS clients only, and <kbd>Cmd</kbd>+<kbd>V</kbd> is bound only there. No key is bound on
  Windows or Linux, so pasting on those clients is untouched until their readers land.
- Only Remote - SSH has been verified; Dev Containers, WSL and Tunnels use the same code path but
  have not been exercised yet.
- `quoting: auto` inserts paths verbatim while quote handling in TUI agents is unverified.
- A transfer already in flight cannot be interrupted mid-file: `workspace.fs.writeFile` has no
  cancellation point, so cancelling stops the transfer between files.
