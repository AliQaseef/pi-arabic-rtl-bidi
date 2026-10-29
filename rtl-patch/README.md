# Applying the bidi patch to pi

`pi-rtl-bidi.patch` is the whole diff from upstream tag `v1.4.0` to the `rtl` branch:
23 files, +1368 / -27. Two scripts apply it on Windows.

## The newest pi source

```
rtl-apply-latest.bat
```

It reads the newest tag from `github.com/earendil-works/pi`, clones it into
`..\pi-rtl-src`, applies the patch, installs with `bun install --ignore-scripts` and
runs the four bidi test files. Green output means the patch fits that version.

- `--revert` puts the tree back to plain upstream.
- Set `RTL_NO_PAUSE=1` to skip the "Press any key" hold when running from a shell.

If `git apply --check` refuses, upstream moved past the base of the patch. Rebuild it
from the fork:

```sh
git diff <upstream-tag> rtl -- . ':!.gitignore' ':!rtl-patch' ':!.scratch' > pi-rtl-bidi.patch
```

By hand:

```sh
git clone https://github.com/earendil-works/pi pi-upstream
cd pi-upstream
git checkout v1.4.0
git apply /path/to/pi-rtl-bidi.patch
```

## The pi you already have

```
rtl-apply-installed.bat
```

No source tree, no npm install. It finds the newest release under
`~/.pi/agent/install/releases/`, copies the eleven patched `dist/*.js` files from
`rtl-patch/installed/` into it, and drops a vendored `bidi-js` into that release's
`node_modules` so nothing has to be downloaded. Every file it touches is first copied
to `node_modules/.rtl-backup/`, and it finishes by running the patched `pi-tui` to
prove it loads.

- `--check` reports what it would do, writes nothing.
- `--revert` restores the originals.
- `--release <dir>` points at a specific release folder.

A release whose files do not match the v1.4.0 build is skipped with a `SKIP` line
rather than guessed at; that means the installed pi is newer than the patch base and
the patch needs rebuilding from the fork.

## Verify

```sh
bun install --ignore-scripts
cd packages/tui
node --test test/bidi.test.ts test/bidi-markdown.test.ts test/bidi-editor.test.ts test/bidi-text.test.ts
```

Expected: `47 passed`. Then `bun install` in `packages/coding-agent` and
`bun x vitest run test/rtl-settings.test.ts test/settings-selector.test.ts`.

Screenshots in `screenshots/` are the rendered result in Windows Terminal.

## Turn it off

- `PI_RTL=0` in the environment, or
- `terminal.rtl.enabled: false` / `terminal.rtl.align: false` in settings, or
- the settings list: *Bidirectional text* and *Align to the reading edge*.

## Dependency

`packages/tui/package.json` gains `bidi-js` (1.1.0) — MIT, pure JavaScript, no native
build. `npm run check:runtime-deps` passes with it as a runtime dependency of
`packages/tui`. The installed-pi route carries its own copy under
`rtl-patch/installed/bidi-js/`.

## Rebuild the installed kit

After changing the source, regenerate the compiled files the installed patch uses:

```sh
bun rtl-patch/build-installed-kit.mjs
```

It compares the patched build against a pristine v1.4.0 build and writes
`rtl-patch/installed/manifest.json`, which holds the hash each installed file must
have before it is replaced.
