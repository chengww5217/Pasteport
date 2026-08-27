# Contributing

Thanks for considering a contribution. Bug reports that include the output of `Pasteport: Diagnose`
are especially useful — that command prints every condition a successful paste depends on.

## Build and test

```sh
npm install
npm run compile      # tsc, strict; type-checks into dist/tsc/, which the tests run from
npm run build        # esbuild bundle + icon + packaged readme, all into dist/build/
npm run lint         # eslint, type-aware rules
npm run format       # prettier --check (use format:write to fix)
npm test             # compile + node:test
```

Tests use `node:test` with no test framework dependency. They cover the modules that can be wrong
without a remote host or a pasteboard: quoting, fingerprints, remote path construction, the
clipboard JSON contract, the rate estimate, and formatting. Those modules deliberately do not
import `vscode`, which is what keeps them runnable outside the extension host — please keep it that
way when adding to them.

Two tests are skipped off macOS: they run the real JXA reader against whatever is on your
clipboard, without modifying it.

## Running the extension

Open the repository in VS Code and press <kbd>F5</kbd>. `npm run watch` keeps `dist/build/extension.js`
rebuilt as you edit — unminified and with a source map, unlike the packaged build. Note that the
interesting behaviour only appears in a **remote window**: in a local window every paste falls
through to the terminal by design, so an end-to-end check needs a Remote - SSH (or Dev Containers /
WSL) window with a folder open.

To package:

```sh
npm run package     # produces dist/pasteport-<version>.vsix
```

## What ends up in the vsix

Every generated file lives under `dist/`, and nothing under it is committed. The three subdivisions
have different fates, which is the whole reason they are kept apart:

```
dist/build/                 what ships — produced by scripts/build.mjs
dist/tsc/                   tsc output — type-checking and tests only, never packaged
dist/pasteport-<version>.vsix   the finished package
```

`scripts/build.mjs` produces everything shipped that is not checked in:

- **`dist/build/extension.js`** — the whole extension bundled and minified by esbuild into one
  CommonJS file, about 19 KB against roughly 70 KB of unbundled `tsc` output. `vscode` stays
  external because the host provides it; nothing else is imported beyond node builtins. The source
  map is written as `sourcemap: 'external'`, so it exists locally for symbolicating stack traces but
  is neither packaged nor referenced from the shipped bundle.
- **`dist/build/icon.png`** — 256×256, because the Marketplace and the Extensions view accept raster
  icons only. `assets/icon.svg` is the source of truth and the only icon file in the repository;
  edit the SVG, the PNG is disposable.
- **`dist/build/README.md`** — a copy of `README.md` with the `<!-- icon:begin -->` block removed.
  vsce refuses an SVG anywhere in a README, and the Marketplace renders the icon in the page header
  anyway, so the image is shown on GitHub and left out of the package. `npm run package` passes
  `--readme-path dist/build/README.md`; keep that flag on any hand-rolled vsce invocation, and note
  that `README.md` itself is in `.vscodeignore` so the two copies cannot collide.

`tsc` output goes to `dist/tsc/` and is never packaged: it exists to type-check and to give the tests
plain unbundled modules to run against, which a single bundle cannot provide — it exposes only the
`extension.ts` entry point, and that entry point imports `vscode`, so requiring it under bare node
fails. esbuild does not type-check, so `npm run compile` and `npm run build` are both needed and
neither replaces the other.

`.vscodeignore` is what enforces the split, and it carries the risk: `dist/tsc/**` and `dist/*.vsix`
are excluded, the second because the vsix is written into `dist/` alongside the rest and packaging
twice would otherwise nest the previous package inside the next one. Adding anything to `dist/`
means deciding whether it ships.

Two consequences worth remembering when moving files around: `dist/tsc/test/…` reaches the
repository root three levels up, which the two tests that locate a reader script depend on, and the
extension itself finds `resources/` through `context.extensionPath` rather than a relative path, so
it is unaffected by this layout.

The icon SVG contains no `<text>`, and the renderer runs with system fonts disabled, so the PNG is
identical on every machine.

## Architecture in one paragraph

The extension is `extensionKind: ["ui"]`, so it runs locally and can read the native pasteboard.
`resources/clipboard-read.darwin.js` is an out-of-process JXA reader that emits a small JSON
payload; `src/paste.ts` is the only module with business branching, and everything it decides not to
handle falls through to the terminal's own paste. Transfers go through `workspace.fs` with a URI
borrowed from the window, which is why no backend-specific code exists.

Nothing can be executed on the remote side from a `ui` extension, so anything the remote host has to
be asked is asked with a read. `src/remote/tempDir.ts` is the one place that does this: it reads
`/proc/self/environ`, which `workspace.fs` serves from the remote server process, to learn the
`TMPDIR` that host actually configured. New remote-side questions belong there, and they have to be
answerable by reading a file.

Adding a reader for another platform means writing a new program that emits the same JSON contract
(see `src/clipboard/types.ts`) plus a thin host wrapper alongside `src/clipboard/darwin.ts`. The
readers share no code — the platform APIs have nothing in common — only the contract. They live in
`resources/`, one file per platform, and ship as plain files: a reader is handed to its interpreter
by path, so bundling it would defeat the point. `media/` would be the wrong home for the same
reason — by convention that directory holds webview assets, and this extension has no webview.

## How the terminal keybindings work

Each platform binds its own paste key, and the mechanism behind that is worth knowing before
changing any of it. A key pressed while the terminal has focus reaches the workbench only if
xterm.js declines to consume it, or if the command it resolves to is listed in
`terminal.integrated.commandsToSkipShell`.

- macOS: xterm.js maps no <kbd>Cmd</kbd> combination to terminal input except
  <kbd>Cmd</kbd>+<kbd>A</kbd>, so <kbd>Cmd</kbd>+<kbd>V</kbd> bubbles up on its own.
- Windows: xterm.js turns <kbd>Ctrl</kbd>+<kbd>V</kbd> into `^V` and consumes it, so the binding
  only works because `pasteport.paste` is contributed to `commandsToSkipShell`. Contributing to that
  list is safe — VS Code concatenates the configured value onto a hardcoded default list, so nothing
  existing is displaced — but a user who has their own array in settings.json replaces the default
  outright, which `src/skipShell.ts` detects and offers to fix.

An extension keybinding outranks the built-in terminal paste, so any binding added here must keep
the pass-through path working: if the clipboard holds no image or file, `pasteport.paste` has to
behave exactly like the paste it displaced.

## Localisation

The UI is translated in two halves, because VS Code loads them differently:

- `package.nls.json` and `package.nls.<locale>.json` cover everything in `package.json` — command
  titles, setting descriptions. The manifest refers to them as `%key%`.
- `l10n/bundle.l10n.json` and `l10n/bundle.l10n.<locale>.json` cover everything in the code. The key
  **is** the English sentence, so `vscode.l10n.t('Send')` and the bundle entry must match character
  for character.

Log lines are deliberately not translated: they are what a bug report carries, and an English log is
readable by everyone who might act on it. Only what a user is shown goes through `l10n.t`.

The readers under `src/clipboard/` are pure modules that never import `vscode`, so they cannot call
`l10n.t` at all. They report a `code` on the error instead, and `src/paste.ts` turns that into a
translated sentence.

Adding a language means one file in each half, and both must be added together —
`src/test/l10n.test.ts` fails if the two sets of locales disagree, if a key is missing, empty or
stale, or if a translation drops a `{0}` placeholder. Locale names follow VS Code's own display
languages, lowercased: `zh-cn`, `pt-br`, and so on.

## Releasing

A tag is the whole release process:

```sh
# bump "version" in package.json and move CHANGELOG's Unreleased entries under it first
git tag v0.1.0 && git push --tags
```

`.github/workflows/release.yml` then re-runs every CI check, fails if the tag disagrees with
`package.json`, packages the vsix once, attaches it to a generated GitHub release and publishes that
same file to Open VSX.

The VS Code Marketplace is the one manual step: download the vsix from the GitHub release and upload
it at <https://marketplace.visualstudio.com/manage>. The web portal takes a vsix without any token,
whereas publishing from CI needs an Azure DevOps organization — and creating one now requires a
pay-as-you-go Azure subscription. Global Azure DevOps PATs are retired on 1 December 2026 in any
case, so automating that step would mean buying a subscription for a credential with months left to
live. One click is cheaper.

Open VSX asks for nothing but an Eclipse account: sign in at <https://open-vsx.org> with GitHub,
sign the publisher agreement, generate an access token, store it as the repository secret
`OVSX_PAT`. The namespace has to exist before the first publish, once:

```sh
npx ovsx create-namespace chengww --pat <token>
```

It must equal `publisher` in `package.json`; Open VSX rejects a vsix whose publisher does not match
the namespace it is pushed to. A missing `OVSX_PAT` skips publishing with a warning rather than
failing the run, so a token-free tag still produces a usable vsix.

A tag with a prerelease suffix (`v0.2.0-rc.1`) still produces a GitHub prerelease with the vsix
attached, but is published nowhere: the Marketplace accepts `major.minor.patch` only, and the same
artifact goes to both places.

Publishing is irreversible — a version number can never be reused — so the tag is the point of no
return, not the commit.

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
