# Contributing

Thanks for considering a contribution. Bug reports that include the output of `Pasteport: Diagnose`
are especially useful — that command prints every condition a successful paste depends on.

## Build and test

```sh
npm install
npm run compile     # tsc, strict
npm run lint        # eslint, type-aware rules
npm run format      # prettier --check (use format:write to fix)
npm test            # compile + node:test
```

Tests use `node:test` with no test framework dependency. They cover the modules that can be wrong
without a remote host or a pasteboard: quoting, fingerprints, remote path construction, the
clipboard JSON contract, the rate estimate, and formatting. Those modules deliberately do not
import `vscode`, which is what keeps them runnable outside the extension host — please keep it that
way when adding to them.

Two tests are skipped off macOS: they run the real JXA reader against whatever is on your
clipboard, without modifying it.

## Running the extension

Open the repository in VS Code and press <kbd>F5</kbd>. Note that the interesting behaviour only
appears in a **remote window**: in a local window every paste falls through to the terminal by
design, so an end-to-end check needs a Remote - SSH (or Dev Containers / WSL) window with a folder
open.

To package:

```sh
npm run package     # produces pasteport.vsix
```

## Architecture in one paragraph

The extension is `extensionKind: ["ui"]`, so it runs locally and can read the native pasteboard.
`media/clipboard-read.js` is an out-of-process JXA reader that emits a small JSON payload;
`src/paste.ts` is the only module with business branching, and everything it decides not to handle
falls through to the terminal's own paste. Transfers go through `workspace.fs` with a URI borrowed
from the window, which is why no backend-specific code exists.

Adding a reader for another platform means writing a new program that emits the same JSON contract
(see `src/clipboard/types.ts`) plus a thin host wrapper alongside `src/clipboard/darwin.ts`. The
readers share no code — the platform APIs have nothing in common — only the contract.

## Before re-adding the Windows or Linux keybinding

Only <kbd>Cmd</kbd>+<kbd>V</kbd> is contributed, and that is not an oversight. When the terminal has
focus, a key event reaches the workbench only if xterm.js declines to consume it, or if the command
it resolves to is in `terminal.integrated.commandsToSkipShell`. On macOS xterm.js maps no
<kbd>Cmd</kbd> combination to terminal input except <kbd>Cmd</kbd>+<kbd>A</kbd>, so the event bubbles
up and the command runs. <kbd>Ctrl</kbd>+<kbd>V</kbd> is different: xterm.js turns it into `^V` and
consumes it, so binding it would replace the working built-in paste with nothing at all — an
extension keybinding outranks the core one, and `pasteport.paste` is not in the skip list.

So a platform binding needs three things, in this order: a reader, a verified key event that
actually reaches the command, and only then the manifest entry.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `test:`,
`refactor:`, `chore:`. One commit does one thing, and the body explains **why** rather than
restating the diff.

## Code style

- TypeScript `strict`, no `any` escapes.
- Comments explain reasoning, not mechanics. A comment that restates the next line is noise; one
  that records why an alternative was rejected saves the next reader an investigation.
- Anything that could delete user data (the TTL sweeper in particular) must match a pattern this
  extension is certain it created. `pasteport.remoteDir` is user-configurable, and pointing it at a
  shared directory must never turn cleanup into collateral damage.

## Licence

Contributions are accepted under the [MIT licence](LICENSE). Do not paste code from other projects
into this repository: all platform readers here are independent implementations, and keeping it that
way avoids attribution obligations entirely.
