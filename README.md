# Pasteport

<!-- icon:begin — stripped from the packaged README by scripts/build.mjs; vsce rejects SVG -->
<p align="center">
  <img src="assets/icon.svg" alt="Pasteport icon" width="128" />
</p>
<!-- icon:end -->

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=chengww.pasteport"><img src="https://badgen.net/vs-marketplace/v/chengww.pasteport?label=VS%20Code%20Marketplace" alt="VS Code Marketplace version" /></a>
  <a href="https://open-vsx.org/extension/chengww/pasteport"><img src="https://img.shields.io/open-vsx/v/chengww/pasteport?label=Open%20VSX" alt="Open VSX version" /></a>
</p>

<p align="center">
  <strong>English</strong> ·
  <a href="https://github.com/chengww5217/Pasteport/blob/main/docs/README.zh-CN.md">简体中文</a> ·
  <a href="https://github.com/chengww5217/Pasteport/blob/main/docs/README.zh-TW.md">繁體中文</a> ·
  <a href="https://github.com/chengww5217/Pasteport/blob/main/docs/README.ja.md">日本語</a>
</p>

Press the paste key in the terminal of a VS Code **remote window** and the image or files on your
local clipboard are sent to the remote host — then the **remote path** is typed into your prompt,
ready for a CLI agent to read.

```
$ claude "what is wrong in this screenshot?" /tmp/pasteport/9f2c1a4b7e0d3856/clipboard.png
                                             └── appeared when you pressed paste
```

Nothing changes in a local window: the keystroke is passed straight through to the terminal, so
you can leave the keybinding in place everywhere.

## What it handles

| Clipboard contents                           | Result                                              |
| -------------------------------------------- | --------------------------------------------------- |
| Screenshot or copied image                   | Staged as PNG, uploaded, remote path inserted       |
| One or more files copied in the file manager | Uploaded under their original names, paths inserted |
| Text, an empty clipboard, a copied folder    | Nothing happens — the normal terminal paste runs    |

Multiple files are inserted space-separated, with a trailing space so you can keep typing.

## Requirements

- **A macOS, Windows or Linux client.** The extension runs on your local machine and reads the
  native clipboard there. Each platform has its own reader; see
  [Platform support](#platform-support) for what has been verified on real hardware.
- **On Linux only, a clipboard tool:** `wl-clipboard` for Wayland or `xclip` for X11. Neither is
  bundled. If it is missing, the first paste offers to install it: the exact command is shown first,
  and your desktop asks for authentication through its own polkit prompt. Declining leaves you with
  the command to run yourself.
- **VS Code 1.85 or later**, and a remote window (the local window is not the target scenario).
- Nothing to install on the remote host.

## Remote backends

Transfers go through the connection VS Code already has, using `workspace.fs` with a URI borrowed
from the window itself. Scheme and authority are inherited, so every backend takes the same code
path and there is no per-backend logic to maintain.

| Backend              | Status                             |
| -------------------- | ---------------------------------- |
| Remote - SSH         | Verified end to end                |
| Dev Containers       | Expected to work, not yet verified |
| WSL                  | Expected to work, not yet verified |
| Tunnels / Codespaces | Expected to work, not yet verified |

The unverified rows are honest about it: the same code path is used, but only SSH has been measured
and exercised. Reports from the other backends are welcome.

## How it works

The extension is declared `"extensionKind": ["ui"]`, which means it runs in the **local** extension
host on your own machine rather than on the remote host. Two consequences follow, and they are the
reason the extension is built this way:

- **It reads the real clipboard.** Files copied in Finder or Explorer appear on the clipboard as
  file URLs — a flavour the asynchronous clipboard API in a webview never exposes. Reading the
  native clipboard directly is what makes "copy a file, paste it in the terminal" work at all.
- **Bytes take one hop.** The file is read from local disk and written through VS Code's existing
  channel. There is no base64 round trip through an RPC boundary, so nothing is inflated on the way.
  The one ceiling that remains is memory: `workspace.fs.writeFile` takes a buffer, so each file is
  held in the extension host while it is sent. Screenshots and archives are unaffected; a
  multi-gigabyte file is not what this is for.

The clipboard read runs on every paste, including plain-text ones, so its cost is felt as input
latency. On macOS it is an `osascript` (JXA) call into AppKit, measured at about **30ms** — below the
threshold where a keystroke starts to feel delayed. If a probe ever exceeds 150ms the extension logs
a warning, since that is the point at which the reader would need to become a resident process.

### Why not scp

Measured on the link this was developed against:

| Payload | Through `workspace.fs` | Local baseline (`file:`) |
| ------- | ---------------------- | ------------------------ |
| 1 MB    | 268ms (3.7 MB/s)       | —                        |
| 8 MB    | 2315ms (3.5 MB/s)      | 10ms (800 MB/s)          |

3.5 MB/s versus 800 MB/s locally says the ceiling is the network link, not the API. scp travels the
same link and inherits the same ceiling, so adding it would buy no speed — only host resolution,
key and agent handling, `ProxyJump` support and a connection lifecycle to maintain. The transport
is `workspace.fs` alone, and Dev Containers, WSL and Tunnels come along for free as a result.

### Deduplication

Files land at `<remoteDir>/<fingerprint>/<original name>`. Before uploading, the target is checked
with a single `stat`: if it is already there at the right size, nothing is transferred and the
existing path is inserted. Pasting the same screenshot a second time costs one round trip.

The fingerprint is a content hash (SHA-256) for payloads up to 8 MB, and `size:mtime:name` above
that, where hashing hundreds of megabytes would cost more than the collision risk it removes.

### Progress and cancellation

A spinner appears in the status bar from the first millisecond of every transfer. Its only job is
to answer "is this stuck?" — the real completion signal is the path appearing in your prompt.

If the transfer is estimated to take longer than `pasteport.confirmAboveSeconds` (5s by default),
you are asked first, and then progress moves to a notification with a cancel button. The estimate
comes from the throughput actually measured on your link, so the threshold adapts instead of
guessing at a byte count. `Pasteport: Cancel Transfer` is available as a command at any time.

### Cleanup

Uploaded files and locally staged images older than `pasteport.ttlHours` (24 by default) are
removed in the background at startup, and on demand via `Pasteport: Clean Up Remote Files`.

Images extracted from the clipboard are staged inside the extension's own global storage, which
lives in your VS Code profile — not in `/tmp`, where on a shared Linux machine another user could
read them or plant a symlink under a predictable name. `Pasteport: Diagnose` prints the exact path.

The sweep only ever deletes directories whose names match the extension's own fingerprint format
(16 hex characters) and staged images matching its own naming scheme. Anything else under
`remoteDir` is counted and left alone, so pointing the setting at a shared directory cannot turn
cleanup into collateral damage.

## Commands

| Command                                 | What it does                                            |
| --------------------------------------- | ------------------------------------------------------- |
| `Pasteport: Paste into Remote Terminal` | The keybinding target; also runnable by hand            |
| `Pasteport: Cancel Transfer`            | Aborts the transfer in progress                         |
| `Pasteport: Clean Up Remote Files`      | Runs the TTL sweep immediately                          |
| `Pasteport: Diagnose`                   | Prints the environment and a clipboard probe to the log |

If something does not work, run `Pasteport: Diagnose` — it reports every condition a successful
paste depends on, which makes a bug report much easier to act on.

## Settings

| Setting                         | Default   | Description                                                        |
| ------------------------------- | --------- | ------------------------------------------------------------------ |
| `pasteport.remoteDir`           | _(empty)_ | Absolute POSIX directory on the remote host; empty means detect it |
| `pasteport.quoting`             | `auto`    | `auto`, `shell` (quote special characters) or `none` (verbatim)    |
| `pasteport.trailingSpace`       | `true`    | Append a space after the inserted path                             |
| `pasteport.confirmAboveSeconds` | `5`       | Ask before transfers estimated to take longer; `0` never asks      |
| `pasteport.ttlHours`            | `24`      | Age at which pasted files are cleaned up; `0` disables             |
| `pasteport.bracketedPaste`      | `false`   | Wrap the insertion in bracketed paste markers                      |

`pasteport.remoteDir` is machine-scoped: it can be set per user or per machine, but not per
workspace. The value is written into your terminal, so a repository is not allowed to choose it.
`~` is not expanded — `workspace.fs` does not resolve it, so it would create a directory literally
named `~`.

### Where files land

Left empty, `pasteport.remoteDir` is resolved from the remote host rather than assumed to be
`/tmp`: a host is entitled to point `TMPDIR` somewhere else, and throwaway files for an agent to
read belong wherever that host says throwaway files go.

The extension has no way to run a command on the remote side — it lives in the local extension
host. What it does have is `workspace.fs`, whose reads are served by the remote server process, so
`/proc/self/environ` is that process's own environment. The server was started from your login
environment, which makes its `TMPDIR` the value the host actually configured. Resolution order:

1. `TMPDIR`, then `TMP`, then `TEMP`, from the remote server's environment — Linux remotes, which
   covers SSH to Linux, Dev Containers, WSL, Tunnels and Codespaces.
2. The first of `/tmp` and `/var/tmp` that exists — the path for remotes without procfs, macOS
   among them.
3. `/tmp`, with a warning in the log.

Files then land under a `pasteport` subdirectory of whatever was chosen, and only that
subdirectory is ever written to or swept. The result is logged once per host and reported by
`Pasteport: Diagnose`, so there is never a question about where a paste went. Setting the value
explicitly skips detection entirely.

Two things this does not solve. On a remote host you share with other people, `TMPDIR` is usually
just `/tmp`, so `/tmp/pasteport` belongs to whoever pasted first and the next user gets a permission
error — set `pasteport.remoteDir` to somewhere of your own, under your home directory for instance.
And detection assumes a POSIX remote: every supported backend is Linux or macOS, and a Windows
remote would need a path no part of this understands.

About `quoting`: the target is a TUI agent that treats your input as literal text, where a quote
character becomes part of the path and silently breaks it. `auto` therefore inserts paths verbatim
today. Choose `shell` if you mainly paste into a shell that will parse the line.

## Keybinding

Each platform's own terminal paste key is used, and only while the terminal has focus. The key
keeps doing what it always did unless there is an image or a file on the clipboard.

| Platform | Key                                           | Note                                                                                                          |
| -------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| macOS    | <kbd>Cmd</kbd>+<kbd>V</kbd>                   | —                                                                                                             |
| Windows  | <kbd>Ctrl</kbd>+<kbd>V</kbd>                  | —                                                                                                             |
| Linux    | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> | Matches the terminal convention; <kbd>Ctrl</kbd>+<kbd>V</kbd> is readline's `quoted-insert` and is left alone |

On Windows and Linux a key pressed in a focused terminal is normally sent straight to the shell, so
`pasteport.paste` is added to `terminal.integrated.commandsToSkipShell` — that list is additive on
top of VS Code's built-in one, so nothing you already rely on changes. If you have your own
`commandsToSkipShell` array in your settings, it replaces the default and the extension offers to
add the entry for you once.

To use a different key, rebind `pasteport.paste` in your keyboard shortcuts.

## Platform support

The three readers are separate programs with no code in common beyond a small JSON contract, because
the platform APIs have nothing in common either.

| Client  | Reader                                      | Status                                                                 |
| ------- | ------------------------------------------- | ---------------------------------------------------------------------- |
| macOS   | `osascript` (JXA) into AppKit               | Verified on real hardware: screenshots, TIFF-only copies, Finder files |
| Windows | `powershell -STA` into System.Windows.Forms | Runs in CI on a Windows runner; not yet exercised on a real desktop    |
| Linux   | `wl-paste` (Wayland) / `xclip` (X11)        | Format handling is unit tested; not yet exercised on a real desktop    |

Two things are honestly unmeasured. PowerShell starts an order of magnitude more slowly than
`osascript`, and that cost lands on every paste; the extension logs a warning above 150ms, so if
Windows input feels sluggish the log will say so and the reader will need to become a resident
process. And neither the Windows nor the Linux reader has been driven by a human on a real desktop
session yet — reports are welcome.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports that include the output of
`Pasteport: Diagnose` are the most useful kind.

## License

[MIT](LICENSE)
