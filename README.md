# Pasteport

<!-- icon:begin — stripped from the packaged README by scripts/build.mjs; vsce rejects SVG -->
<img src="assets/icon.svg" alt="Pasteport icon" width="116" align="right" />
<!-- icon:end -->

Press <kbd>Cmd</kbd>+<kbd>V</kbd> in the terminal of a VS Code **remote window** and the image or
files on your Mac's clipboard are sent to the remote host — then the **remote path** is typed into
your prompt, ready for a CLI agent to read.

```
$ claude "what is wrong in this screenshot?" /tmp/pasteport/9f2c1a4b7e0d3856/clipboard.png
                                             └── appeared when you pressed Cmd+V
```

Nothing changes in a local window: the keystroke is passed straight through to the terminal, so
you can leave the keybinding in place everywhere.

## What it handles

| Clipboard contents                        | Result                                              |
| ----------------------------------------- | --------------------------------------------------- |
| Screenshot or copied image                | Staged as PNG, uploaded, remote path inserted       |
| One or more files copied in Finder        | Uploaded under their original names, paths inserted |
| Text, an empty clipboard, a copied folder | Nothing happens — the normal terminal paste runs    |

Multiple files are inserted space-separated, with a trailing space so you can keep typing.

## Requirements

- **macOS client.** The extension runs on your local machine and reads the native pasteboard, and
  only the macOS reader ships today. On Windows and Linux clients it stays out of the way entirely:
  no key is bound, so pasting behaves exactly as it did before. Readers for both are planned — see
  [Platform support](#platform-support).
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
host on your Mac rather than on the remote host. Two consequences follow, and they are the reason
the extension is built this way:

- **It reads the real pasteboard.** Files copied in Finder appear on the pasteboard as file URLs,
  which is a flavour the asynchronous clipboard API in a webview never exposes. Reading AppKit
  directly is what makes "copy a file in Finder, paste it in the terminal" work at all.
- **Bytes take one hop.** The file is read from local disk and written through VS Code's existing
  channel. There is no base64 round trip through an RPC boundary, so there is no size ceiling
  beyond patience and remote disk space.

The clipboard read itself is an `osascript` (JXA) call into AppKit, measured at about **30ms** —
below the threshold where a keystroke starts to feel delayed.

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

| Setting                         | Default          | Description                                                      |
| ------------------------------- | ---------------- | ---------------------------------------------------------------- |
| `pasteport.remoteDir`           | `/tmp/pasteport` | Absolute POSIX directory on the remote host. `~` is not expanded |
| `pasteport.quoting`             | `auto`           | `auto`, `shell` (quote special characters) or `none` (verbatim)  |
| `pasteport.trailingSpace`       | `true`           | Append a space after the inserted path                           |
| `pasteport.confirmAboveSeconds` | `5`              | Ask before transfers estimated to take longer; `0` never asks    |
| `pasteport.ttlHours`            | `24`             | Age at which pasted files are cleaned up; `0` disables           |
| `pasteport.bracketedPaste`      | `false`          | Wrap the insertion in bracketed paste markers                    |

`pasteport.remoteDir` is machine-scoped: it can be set per user or per machine, but not per
workspace. The value is written into your terminal, so a repository is not allowed to choose it.

About `quoting`: the target is a TUI agent that treats your input as literal text, where a quote
character becomes part of the path and silently breaks it. `auto` therefore inserts paths verbatim
today. Choose `shell` if you mainly paste into a shell that will parse the line.

## Keybinding

<kbd>Cmd</kbd>+<kbd>V</kbd> is bound on macOS, while the terminal has focus. It matches the
terminal's own paste binding, so the key keeps doing what it always did unless there is an image or
a file on the clipboard.

**No key is bound on Windows or Linux.** Each platform's binding arrives with its reader: claiming
the key earlier would shadow the terminal's own paste and leave those platforms worse off than
without the extension installed. On Linux the binding will be
<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> — <kbd>Ctrl</kbd>+<kbd>V</kbd> is `quoted-insert` in
readline and will be left alone.

To use a different key, rebind `pasteport.paste` in your keyboard shortcuts.

## Platform support

The macOS, Windows and Linux readers are three separate programs — JXA on macOS, PowerShell on
Windows, `wl-paste`/`xclip` on Linux — with no code in common beyond a small JSON contract. The
macOS reader is implemented; the other two are next, along with verification of the remaining
remote backends.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports that include the output of
`Pasteport: Diagnose` are the most useful kind.

## License

[MIT](LICENSE)
