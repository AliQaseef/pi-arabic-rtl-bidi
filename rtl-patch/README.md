# Applying the bidi patch to pi

`pi-rtl-bidi.patch` is the whole diff from upstream tag `v1.5.0` to this working tree:
33 files, +2221 / -112. Two scripts apply it on Windows.

## The newest pi source

```
rtl-apply-latest.bat
```

It reads the newest tag from `github.com/earendil-works/pi`, clones it into
`..\pi-rtl-src`, applies the patch, installs with `bun install --ignore-scripts` and
runs the four bidi test files. Green output means the patch fits that version.

- `--revert` puts the tree back to plain upstream.
- Set `RTL_NO_PAUSE=1` to skip the "Press any key" hold when running from a shell.

If `git apply --check` refuses, upstream moved past the base of the patch. Regenerate
it from this tree (it also reports patch-vs-tree drift):

```sh
node rtl-patch/gen-patch.mjs            # write the patch from the working tree
node rtl-patch/gen-patch.mjs --check    # report drift, write nothing
```

By hand:
```sh
git clone https://github.com/earendil-works/pi pi-upstream
cd pi-upstream
git checkout v1.5.0
git apply /path/to/pi-rtl-bidi.patch
```

## The pi you already have

```
rtl-apply-installed.bat
```

No source tree, no npm install. It finds the newest release under
`~/.pi/agent/install/releases/`, copies the patched `dist/*.js` files from
`rtl-patch/installed/` into it, and drops a vendored `bidi-js` into that release's
`node_modules` so nothing has to be downloaded. Every file it touches is first copied
to `node_modules/.rtl-backup/`, and it finishes by running the patched `pi-tui` to
prove it loads.

The entry point is replaced too. The `pi` bin of the shipped package is
`dist/bundle/cli.js`, which loads a bundle (`dist/bundle/chunks/`) that inlines
pi-tui, the settings manager and the interactive mode: patching `dist/*.js` alone
would never be read by it. The kit swaps `dist/bundle/cli-runtime.js` for a small
entry that runs the plain dist, where the patched files are the ones loaded.

RTL is off by default. Turn it on in `~/.pi/agent/settings.json`:

```json
"terminal": { "rtl": { "enabled": true, "align": true } }
```

`applyRtlSettingsFromDisk()` in `packages/tui/src/bidi.ts` reads that file (then
`.pi/settings.json` in the working directory, then `PI_RTL`) when the patched `pi-tui`
entry is imported, so the setting is honoured without the settings manager.

- `--check` reports what it would do, writes nothing.
- `--revert` restores the originals.
- `--release <dir>` points at a specific release folder.

A release whose files do not match the v1.5.0 build is skipped with a `SKIP` line
rather than guessed at; that means the installed pi is newer than the patch base and
the patch needs rebuilding from the fork.

## Verify

```sh
bun install --ignore-scripts
cd packages/tui
node --test test/bidi.test.ts test/bidi-text.test.ts test/bidi-markdown.test.ts \
  test/bidi-editor.test.ts test/bidi-settings.test.ts test/bidi-components.test.ts \
  test/bidi-selection.test.ts
```

Expected: 77 tests, all passing. Then `bun install` in `packages/coding-agent` and `bun x vitest run
test/rtl-settings.test.ts test/settings-selector.test.ts`.
test/settings-selector.test.ts`.
Screenshots in `screenshots/` are the rendered result in Windows Terminal.

## Turn it on and off

RTL is off until one of these says otherwise:

- `terminal.rtl.enabled: true` in `~/.pi/agent/settings.json` (the settings list has
  *Bidirectional text* and *Align to the reading edge*), or
- `PI_RTL=0` in the environment, which turns reordering off whatever the settings say.
- the settings list: *Bidirectional text* and *Align to the reading edge*.

A line's direction is decided per line: a line that opens in RTL reads RTL, and a line that
opens in Latin reads RTL only when RTL words outnumber Latin ones. A path, a command or a list
marker at the start of a line does not decide the direction of the sentence after it.

Copying runs the other way: a selection cut out of a painted line is un-painted before it reaches the
clipboard, so an Arabic line pastes in reading order instead of as mirrored graphemes. The
alternate-screen search finds the text as typed as well as its painted spelling.

## Dependency

`packages/tui/package.json` gains `bidi-js` (1.1.0) — MIT, pure JavaScript, no native
build. `npm run check:runtime-deps` passes with it as a runtime dependency of
`packages/tui`. The installed-pi route carries its own copy under
`rtl-patch/installed/bidi-js/`.

## Rebuild the installed kit

After changing the source, regenerate the compiled files the installed patch uses:

```sh
node rtl-patch/gen-patch.mjs                                   # the patch
bun install --ignore-scripts
bun x tsc -p packages/tui/tsconfig.build.json                  # packages/tui/dist
bun x tsc -p packages/coding-agent/tsconfig.build.json         # packages/coding-agent/dist
node rtl-patch/build-installed-kit.mjs . .scratch/upstream-150 \
  --installed-pristine "C:/Users/ali/.pi/agent/install/releases/1.5.0/node_modules/@earendil-works"
```

The list of files the kit carries is read out of the patch itself: every `packages/*/src/*.ts` the
patch touches is mapped to its build output, so a newly patched component needs no edit here. The
builder defaults to this repository and to the pristine upstream tree it was rebased on; pass
directories or set `PI_RTL_PATCHED_DIR` / `PI_RTL_PRISTINE_DIR` when they live elsewhere. It writes
`rtl-patch/installed/manifest.json`, which holds the hash each installed file must have before it is
replaced, and checks the kit it wrote against those hashes. A pristine tree that has not been built
records no hash, and the builder names the files left without one.
