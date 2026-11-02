# Issue to file first (Contribution Proposal template)

pi auto-closes issues and PRs from new contributors. `lgtm` from a maintainer on an issue
is what unlocks the PR. So: file the issue, attach the patch and the screenshots, wait for
`lgtm`, then open the PR with `PR_BODY.md`.

**What do you want to change?**
Arabic and Persian output in pi renders backwards in Windows Terminal. I want to
add bidirectional rendering: reorder RTL lines into visual order before they are written,
and put a line against the edge its script reads from. Behind two settings
(`terminal.rtl.enabled`, default off, and `terminal.rtl.align`) so nothing changes for
English.

**Why?**
Windows Terminal paints cells in write order and does not implement UAX #9, so logical
text stored correctly in the buffer reads mirrored on screen. A terminal user writing in
Arabic cannot read the transcript, and the caret in the prompt sits on the wrong side of
the word being typed. Copy, search and the saved transcript are all correct today — only
the painted order is wrong, which is exactly what needs fixing.

**How?**
`reorderLine()` in `packages/tui/src/bidi.ts` runs one rendered line through UAX #9
(bidi-js), on grapheme clusters, and returns the line in visual order. Components reach it through
one seam, `paintLine(line, width)`, rather than deciding the direction and the edge themselves.
Only the string written to the terminal changes — caret offsets, selection, copy, wrapping and
column widths stay logical, and a selection taken from a painted line is un-painted before it
reaches the clipboard. Chrome stays chrome: code blocks, table borders, list markers and quote
bars are reordered only where content is produced. Alignment uses the script that dominates the
line, so "npm install ثم build the package" stays on the left. 75 tests in `test/bidi*.test.ts`;
English lines take an early return and are byte for byte unchanged. Patch attached
(`pi-rtl-bidi.patch`, 33 files, applies clean to v1.4.0). Screenshots of the same session with the
patch and with `PI_RTL=0`.
the same session with the patch and with `PI_RTL=0`.
