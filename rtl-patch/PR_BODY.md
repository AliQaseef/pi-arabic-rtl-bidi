### Problem

A terminal paints cells in the order the program writes them. Windows Terminal does not
implement the Unicode Bidirectional Algorithm (UAX #9), so text kept in **logical** order —
the order every editor, clipboard, and model keeps it in — appears mirrored on screen.
`مرحبا` written cell by cell left to right reads backwards. Arabic, Hebrew and Persian
transcripts in pi read in the wrong order, and the caret in the prompt sits on the wrong
side of the word the user is typing.

This was verified against Windows Terminal directly: glyph cells land in write order, and a
dot-position probe confirmed there is no terminal-side reordering to rely on.

### What changes

Only the string written to the terminal changes. Logical state is untouched: caret offsets,
selection, copy, search, wrapping and every column calculation stay logical Unicode.

Two independent behaviours:

1. **Glyph order.** `reorderLine()` turns one rendered line from logical order into visual
   order with UAX #9 (bidi-js), working on **grapheme clusters** so an Arabic letter and its
   combining marks travel as one cell. Bracket mirroring is applied here because the terminal
   does not do it. Leading and trailing whitespace is anchored: indentation is layout the
   renderer produced, not content the reader is reading.
2. **Line placement.** With `terminal.rtl.align` on, a line is put against the edge its
   dominant script reads from: Arabic, Hebrew and Persian lines go right, English stays left,
   and a mixed line follows whichever script has more strong characters (a tie falls back to
   the first strong character, the same rule UAX #9 uses for direction). List markers,
   blockquote bars and table columns follow the same edge, so `- عنصر` reads with its bullet
   on the right and a mirrored RTL table has its first logical column on the right.

A line with no strong RTL character returns from the early check in `hasStrongRtl`, so
English rendering is byte for byte what it was before.

### Files

| File | Role |
|---|---|
| `packages/tui/src/bidi.ts` | The engine: `hasStrongRtl`, `detectBaseDirection`, `dominantDirection`, `reorderLine`, `reorderLineWithCaret`, `stepCaretVisual`, `alignRight`, `configureBidi` |
| `packages/tui/src/components/markdown.ts` | Wrap logical, paint visual; chrome (code blocks, table grid, list markers, quote bars) stays put |
| `packages/tui/src/components/text.ts`, `truncated-text.ts` | Tool rows and single lines: truncate logically, paint visually |
| `packages/tui/src/components/editor.ts` | Visual arrow-key stepping, painted caret at the visual edge, padding moved to the reading side |
| `packages/coding-agent/src/core/settings-*` | `terminal.rtl.enabled` / `terminal.rtl.align`, `PI_RTL=0` override |
| `packages/coding-agent/src/modes/interactive/` | Wiring: `configureBidi` on startup and on toggle |

Styling is carried per grapheme through an SGR state model, so a reordered line closes only
the attributes that end. A bare `ESC[0m` at the end of a reordered line would also clear the
background the renderer wraps the line in, and the padding would paint black.

### Settings

| Key | Default | Meaning |
|---|---|---|
| `terminal.rtl.enabled` | `true` | Reorder RTL text for display |
| `terminal.rtl.align` | `true` | Put a line against the edge its dominant script reads from |
| `PI_RTL=0` | — | Off regardless of settings |

Both are in the settings list under "Bidirectional text" and "Align to the reading edge".

### Tests

`node --test test/bidi.test.ts test/bidi-markdown.test.ts test/bidi-editor.test.ts test/bidi-text.test.ts` —
47 tests: strong-script detection, grapheme reordering, bracket mirroring, whitespace
anchoring, positional escapes bail out, width preservation, styling and OSC 8 hyperlinks
travel with their grapheme, background fill survives the reorder, wrap-then-reorder, code
blocks stay left to right, table grid kept while cell content reorders, visual arrow-key
stepping, painted caret placement, disabled fallback, plus a reference test that compares
the reordering with bidi-js's own UAX #9 output on the same graphemes.

`test/rtl-settings.test.ts` covers the settings and the environment override. Applying this
patch to a clean `v1.4.0` checkout and running those four test files gives 47 passing tests.

Full tui suite: 1123 pass, 5 fail — the same 5 that fail on unpatched v1.4.0 (symlink
autocomplete and terminal-image hyperlinks).

### Performance

200-line markdown render: English 1.97 ms, Arabic 2.45 ms; Arabic with bidi off 1.42 ms.
The extra ~1 ms per render is the bidi pass, and the strong-script regex short-circuits
ASCII lines before the table is touched.

### Limits

- Positional escapes (cursor-position codes, the editor `CURSOR_MARKER`) are not moved: if a
  line contains them, `parseCells` bails and the line is left as written.
- bidi-js reorders by code unit, so the app path deliberately keeps combining marks attached
  to their base letter; the reference test excludes those samples.
- Right alignment is per line. A paragraph that mixes scripts on a single wrapped line is
  aligned by that line's dominant script.
- `bidi-js` (MIT, pure JS, no native code) is a new runtime dependency of `packages/tui`.

### Screenshots

Rendered in Windows Terminal (see `rtl-patch/screenshots/`): RTL paragraphs, mixed lines
with English islands left to right, lists with the marker on the reading edge, mirrored
tables, code blocks unchanged, and `PI_RTL=0` showing the mirrored baseline.
