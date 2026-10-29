# Applying the bidi patch to upstream pi

`pi-rtl-bidi.patch` is the whole diff from upstream tag `v1.4.0` to the `rtl` branch:
21 files, +1319 / -27. It applies to a clean checkout — verified below.

## Apply

```sh
git clone https://github.com/earendil-works/pi pi-upstream
cd pi-upstream
git checkout v1.4.0
git apply /path/to/pi-rtl-bidi.patch
git add -A && git commit -m "Add bidi (RTL) rendering for terminal output"
```

Check without writing anything:

```sh
git apply --check pi-rtl-bidi.patch
```

## Verify

```sh
bun install --ignore-scripts
cd packages/tui
node --test test/bidi.test.ts test/bidi-markdown.test.ts test/bidi-editor.test.ts test/bidi-text.test.ts
```

Expected: `47 passed`. Then `bun install` in `packages/coding-agent` and
`bun x vitest run test/rtl-settings.test.ts test/settings-selector.test.ts`.

## Turn it off

- `PI_RTL=0` in the environment, or
- `terminal.rtl.enabled: false` / `terminal.rtl.align: false` in settings, or
- the settings list: *Bidirectional text* and *Align to the reading edge*.

## Dependency

`packages/tui/package.json` gains `bidi-js` (^1.1.0) — MIT, pure JavaScript, no native
build. `npm run check:runtime-deps` passes with it as a runtime dependency of `packages/tui`.
