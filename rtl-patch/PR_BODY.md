### Problem

A terminal paints cells in the order the program writes them. Windows Terminal does not
implement the Unicode Bidirectional Algorithm (UAX #9), so text kept in **logical** order —
the order every editor, clipboard, and model keeps it in — appears mirrored on screen.
`مرحبا` written cell by cell left to right reads backwards. Arabic and Persian
transcripts in pi read in the wrong order, and the caret in the prompt sits on the wrong
side of the word the user is typing.

This was verified against Windows Terminal directly: glyph cells land in write order, and a
dot-position probe confirmed there is no terminal-side reordering to rely on.

### What changes

Only the string written to the terminal changes. Logical state is untouched: caret offsets,
selection, copy, search, wrapping and every column calculation stay logical Unicode. Where the
reverse is needed - a selection cut out of a painted line, a search over painted text - `unpaintLine()`
maps the painted cells back to the logical text they were painted from.

Two independent behaviours:

1. **Glyph order.** `reorderLine()` turns one rendered line from logical order into visual
   order with UAX #9 (bidi-js), working on **grapheme clusters** so an Arabic letter and its
   combining marks travel as one cell. Bracket mirroring is applied here because the terminal
   does not do it. Leading and trailing whitespace is anchored: indentation is layout the
   renderer produced, not content the reader is reading.
2. **Direction and placement.** A line's reading direction is decided once and used for both
   the glyph order inside it and the edge it sits against. A line that opens in RTL is RTL. A
   line that opens in Latin is RTL only when RTL words outnumber Latin words: UAX #9 alone would
   take the paragraph direction from the first strong character, so `ask 3 questions (أي بريد
   يكتب في الـ commit؟)` - which opens with a tool name - would read backwards. Words rather
   than letters are counted because a command or a path is one word while the sentence around it
   is many. With `terminal.rtl.align` on, RTL lines then go right and LTR lines stay left; list
   markers, blockquote bars and table columns follow the same edge, so `- عنصر` reads with its
   bullet on the right and a mirrored RTL table has its first logical column on the right.

A line with no strong RTL character returns from the early check in `hasStrongRtl`, so
English rendering is byte for byte what it was before.

### Files

| File | Role |
|---|---|
| `packages/tui/src/bidi.ts` | The engine: `hasStrongRtl`, `detectBaseDirection`, `lineDirection`, `reorderLine`, `reorderLineWithCaret`, `stepCaretVisual`, `alignRight`, `configureBidi`, and the seams components use: `paintLine(line, width)`, `paintedLine(line)` (painted line plus caret map), `unpaintLine(line)` |
| `packages/tui/src/components/markdown.ts` | Wrap logical, paint visual; chrome (code blocks, table grid, list markers, quote bars) stays put |
| `packages/tui/src/components/text.ts`, `truncated-text.ts` | Tool rows and single lines: truncate logically, paint visually |
| `packages/tui/src/components/editor.ts` | Visual arrow-key stepping, painted caret at the visual edge, padding moved to the reading side; render, arrows and mouse hit-testing share one `PaintedLine` |
| `packages/tui/src/components/input.ts`, `select-list.ts`, `settings-list.ts`, `scroll-view.ts`, `image.ts` | The lines these build themselves go through the same seam, so a new component is RTL-correct by default |
| `packages/tui/src/tui-alt-screen.ts`, `alt-screen-search.ts` | A selection cut from a painted line is un-painted before it reaches the clipboard; search matches the typed spelling and the painted one |
| `packages/coding-agent/src/core/settings-*` | `terminal.rtl.enabled` / `terminal.rtl.align`, `PI_RTL=0` override; one setter (`setRtlSetting`) is the only writer of both keys |
| `packages/coding-agent/src/modes/interactive/` | Wiring: `configureBidi` on startup and on toggle |

Styling is carried per grapheme through an SGR state model, so a reordered line closes only
the attributes that end. A bare `ESC[0m` at the end of a reordered line would also clear the
background the renderer wraps the line in, and the padding would paint black.

### Settings

| Key | Default | Meaning |
|---|---|---|
| `terminal.rtl.enabled` | `false` | Reorder RTL text for display; off until the user turns it on |
| `terminal.rtl.align` | `true` | Put a line against the edge its dominant script reads from |
| `PI_RTL=0` | — | Off regardless of settings |

Both are in the settings list under "Bidirectional text" and "Align to the reading edge".

### Tests

`node --test test/bidi.test.ts test/bidi-text.test.ts test/bidi-markdown.test.ts test/bidi-editor.test.ts
 test/bidi-settings.test.ts test/bidi-components.test.ts test/bidi-selection.test.ts` —
75 tests: strong-script detection, grapheme reordering, bracket mirroring, whitespace
anchoring, positional escapes bail out, width preservation, styling and OSC 8 hyperlinks
travel with their grapheme, background fill survives the reorder, wrap-then-reorder, code
blocks stay left to right, table grid kept while cell content reorders, visual arrow-key
stepping, painted caret placement, mouse click mapping, the components that build their own
lines, copy and search in the alternate screen, disabled fallback, plus a reference test that
compares the reordering with bidi-js's own UAX #9 output on the same graphemes.

`test/rtl-settings.test.ts` and `packages/tui/test/bidi-settings.test.ts` cover the settings
files and the environment override. Applying this patch to a clean `v1.4.0` checkout and running
those seven test files gives 75 passing tests.

Full tui suite: 1151 pass, 5 fail — the same 5 that fail on unpatched v1.4.0 (symlink
autocomplete and terminal-image hyperlinks).

### Performance

200-line markdown render: English 1.97 ms, Arabic 2.45 ms; Arabic with bidi off 1.42 ms.
The extra ~1 ms per render is the bidi pass, and the strong-script regex short-circuits
ASCII lines before the table is touched.

### Limits

- Positional escapes (cursor-position codes, the editor `CURSOR_MARKER`) are not moved: if a
  line contains them, `parseCells` bails and the line is left as written.
- `unpaintLine` is exact for a whole line the renderer painted in this process (the mapping is
  remembered as it paints) and approximate for a slice of one, where the line direction has to be
  re-detected from the painted cells.
- bidi-js reorders by code unit, so the app path deliberately keeps combining marks attached
  to their base letter; the reference test excludes those samples.
- Right alignment is per line. A wrapped paragraph keeps one direction: the direction is read
  off the logical line and reused for every visual line cut out of it, so a paragraph does not
  change direction mid-sentence.
- `bidi-js` (MIT, pure JS, no native code) is a new runtime dependency of `packages/tui`.

### Screenshots

Rendered in Windows Terminal (see `rtl-patch/screenshots/`): RTL paragraphs, mixed lines
with English islands left to right, lists with the marker on the reading edge, mirrored
tables, code blocks unchanged, and `PI_RTL=0` showing the mirrored baseline.
