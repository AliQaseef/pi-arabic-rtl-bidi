import fs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import bidiModule, {} from "bidi-js";
import { extractAnsiCode, getGraphemeSegmenter, visibleWidth } from "./utils.js";
/**
 * Bidirectional layout for terminal output.
 *
 * Problem: terminals such as Windows Terminal paint cells in the order the
 * program writes them. They do not implement the Unicode Bidirectional
 * Algorithm (UAX #9), so text stored in logical order - the order every
 * program, editor and clipboard keeps it in - appears mirrored on screen:
 * "مرحبا" written cell by cell left to right reads backwards.
 *
 * Solution: keep the logical text untouched everywhere (caret positions,
 * selection, copy, wrapping and search all stay logical) and reorder only the
 * string written to the terminal. `reorderLine` turns one rendered line from
 * logical order into visual order. Cell widths do not change - an Arabic
 * grapheme occupies one cell in either order - so every column-based
 * calculation in the renderer still works on the reordered line.
 *
 * Reordering works on grapheme clusters, not code units: an Arabic letter and
 * its combining marks travel as one cell. Bracket mirroring is part of UAX #9
 * and is applied here because the terminal does not do it.
 */
// bidi-js ships a factory as its only export; its type declaration is not
// resolved as callable by tsc, so the call is cast.
const bidi = bidiModule();
// SGR styling and OSC 8 hyperlinks can travel with a grapheme. Cursor position
// codes and the editor cursor marker are positional: moving them would put the
// caret or the padding in the wrong column.
const movableEscapeRegex = /^(\x1b\[[0-9;]*m|\x1b\]8;[^;]*;[^\x07\x1b]*(?:\x07|\x1b\\))$/;
// Used to count scripts in a line: styling and hyperlink codes are layout, not text.
const ansiEscapeRegex = /\x1b\[[0-9;]*[A-Za-z]|\x1b\]8;[^;]*;[^\x07\x1b]*(?:\x07|\x1b\\)/g;
const settings = { enabled: true, align: false };
/**
 * Settings defaults for a release that never calls configureBidi.
 *
 * The `pi` bin of the shipped package is a bundle that inlines the settings
 * manager and the interactive mode, so the wiring in interactive-mode.ts never
 * runs there. RTL stays off unless the user's settings turn it on: the agent
 * settings file, then the project settings file, then PI_RTL.
 */
export function applyRtlSettingsFromDisk() {
    const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
    const resolved = { enabled: false, align: true };
    for (const file of [join(agentDir, "settings.json"), join(process.cwd(), ".pi", "settings.json")]) {
        let raw;
        try {
            raw = JSON.parse(fs.readFileSync(file, "utf8"));
        }
        catch {
            continue;
        }
        const rtl = raw?.terminal?.rtl;
        if (rtl?.enabled !== undefined)
            resolved.enabled = rtl.enabled;
        if (rtl?.align !== undefined)
            resolved.align = rtl.align;
    }
    if (process.env.PI_RTL === "0")
        resolved.enabled = false;
    configureBidi(resolved);
}
export function configureBidi(next) {
    Object.assign(settings, next);
}
export function getBidiSettings() {
    // Alignment is part of the bidi layout: with reordering off the line is drawn
    // exactly as written, so it cannot hug the reading edge either.
    return { enabled: settings.enabled, align: settings.enabled && settings.align };
}
/**
 * Render caches key on this string. A component that caches painted lines has to
 * repaint when the settings change, and this is the value it compares against.
 */
export function bidiSettingsKey() {
    const current = getBidiSettings();
    return `${current.enabled}:${current.align}`;
}
/**
 * Does this text contain a strong right-to-left character?
 *
 * Strong means the character itself carries a direction: Arabic letters do,
 * their combining marks do not. A Latin string carrying an Arabic
 * vowel mark is therefore still left-to-right.
 */
// Arabic and the other RTL blocks in the Unicode ranges that carry a
// strong RTL direction. Cheaper than segmenting every line of a mostly-ASCII
// transcript; anything outside these ranges is checked by the bidi table below.
const rtlScriptRegex = /[\u0590-\u06FF\u070C-\u0740\u0850-\u085F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
export function hasStrongRtl(text) {
    if (!rtlScriptRegex.test(text))
        return false;
    for (const { segment } of getGraphemeSegmenter().segment(text)) {
        const type = bidi.getBidiCharTypeName(segment[0] ?? "");
        if (type === "R" || type === "AL")
            return true;
    }
    return false;
}
/**
 * Base direction of a paragraph by UAX #9 P2/P3: the first strong character
 * decides. A forced direction wins over detection.
 */
export function detectBaseDirection(text, forced) {
    if (forced)
        return forced;
    return bidi.getEmbeddingLevels(text, "auto").paragraphs[0].level % 2 === 1 ? "rtl" : "ltr";
}
/**
 * Which way a line is read: one rule for both halves of the layout, the order of
 * the characters inside the line and the edge the line sits against.
 *
 * UAX #9 takes a paragraph's direction from its first strong character. That is
 * right for prose and wrong for a terminal line, which usually opens with
 * something the renderer put there - a tool name, a code span, a list marker -
 * while the sentence after it is Arabic:
 *
 *   ask 3 questions (أي بريد يكتب في الـ commit؟)
 *
 * Ordered by its first character that line reads backwards. The rule used here:
 * a line that opens in RTL is RTL. A line that opens in Latin is RTL only when
 * Arabic words outnumber Latin ones. Words, not characters, because a path or a
 * command is one word while the sentence around it is many.
 *
 * Undefined means the line has no RTL content at all, so nothing moves.
 */
export function lineDirection(text, forced) {
    if (forced)
        return forced;
    // Escape codes are layout, not content: the letters in a style code are not
    // words the reader is reading.
    const content = text.replace(ansiEscapeRegex, "");
    if (!rtlScriptRegex.test(content))
        return undefined;
    let rtlWords = 0;
    let ltrWords = 0;
    let firstStrong;
    for (const token of content.split(/\s+/)) {
        for (const { segment } of getGraphemeSegmenter().segment(token)) {
            const type = bidi.getBidiCharTypeName(segment[0] ?? "");
            if (type === "R" || type === "AL") {
                if (!firstStrong)
                    firstStrong = "rtl";
                rtlWords++;
                break;
            }
            if (type === "L") {
                if (!firstStrong)
                    firstStrong = "ltr";
                ltrWords++;
                break;
            }
        }
    }
    if (rtlWords === 0)
        return undefined;
    if (firstStrong === "rtl")
        return "rtl";
    return rtlWords > ltrWords ? "rtl" : "ltr";
}
const defaultState = {
    fg: "",
    bg: "",
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    inverse: false,
    link: "",
};
function applySgr(state, code) {
    const next = { ...state };
    // `ESC[m` is the same as `ESC[0m`: an empty parameter list means a full reset.
    const tokens = code.slice(2, -1).split(";");
    if (tokens.length === 1 && tokens[0] === "")
        tokens[0] = "0";
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (!token)
            continue;
        const value = Number(token);
        if (value === 0) {
            next.fg = "";
            next.bg = "";
            next.bold = false;
            next.dim = false;
            next.italic = false;
            next.underline = false;
            next.inverse = false;
        }
        else if (value === 1)
            next.bold = true;
        else if (value === 2)
            next.dim = true;
        else if (value === 3)
            next.italic = true;
        else if (value === 4)
            next.underline = true;
        else if (value === 7)
            next.inverse = true;
        else if (value === 22)
            next.bold = false;
        else if (value === 23)
            next.italic = false;
        else if (value === 24)
            next.underline = false;
        else if (value === 27)
            next.inverse = false;
        else if (value === 39)
            next.fg = "";
        else if (value === 49)
            next.bg = "";
        else if (value >= 30 && value <= 37)
            next.fg = code;
        else if (value >= 40 && value <= 47)
            next.bg = code;
        else if (value === 38 || value === 48) {
            const full = `\x1b[${tokens.slice(i).join(";")}m`;
            if (tokens[i + 1] === "5")
                i += 2;
            else if (tokens[i + 1] === "2")
                i += 4;
            else
                continue;
            if (value === 38)
                next.fg = full;
            else
                next.bg = full;
        }
    }
    return next;
}
// Codes that turn an attribute off are specific to it, so the background the
// caller wrapped the line in survives the transition.
function sgrTransition(prev, next) {
    let out = "";
    if (prev.bg !== next.bg) {
        if (prev.bg)
            out += "\x1b[49m";
        if (next.bg)
            out += next.bg;
    }
    if (prev.fg !== next.fg) {
        if (prev.fg)
            out += "\x1b[39m";
        if (next.fg)
            out += next.fg;
    }
    if (prev.bold !== next.bold)
        out += next.bold ? "\x1b[1m" : "\x1b[22m";
    if (prev.dim !== next.dim)
        out += next.dim ? "\x1b[2m" : "\x1b[22m";
    if (prev.italic !== next.italic)
        out += next.italic ? "\x1b[3m" : "\x1b[23m";
    if (prev.underline !== next.underline)
        out += next.underline ? "\x1b[4m" : "\x1b[24m";
    if (prev.inverse !== next.inverse)
        out += next.inverse ? "\x1b[7m" : "\x1b[27m";
    if (prev.link !== next.link)
        out += next.link ? `\x1b]8;;${next.link}\x07` : "\x1b]8;;\x07";
    return out;
}
/**
 * Split a rendered line into grapheme cells carrying the styling that applies
 * to them. Returns an empty list when the line contains positional escapes
 * that must not move, so the caller leaves the line untouched.
 */
function parseCells(line) {
    const cells = [];
    let state = defaultState;
    // Escape codes seen since the last grapheme. At the end of the line these are
    // the closing codes the renderer wrote, and they belong at the end of the line.
    let pendingCodes = "";
    let index = 0;
    while (index < line.length) {
        const ansi = extractAnsiCode(line, index);
        if (ansi) {
            if (!movableEscapeRegex.test(ansi.code))
                return { cells: [], trailing: "" };
            if (ansi.code.startsWith("\x1b]8;")) {
                const body = ansi.code.slice(4, ansi.code.endsWith("\x07") ? -1 : -2);
                state = { ...state, link: body.split(";")[1] ?? "" };
            }
            else {
                state = applySgr(state, ansi.code);
            }
            pendingCodes += ansi.code;
            index += ansi.length;
            continue;
        }
        let end = index;
        while (end < line.length && !extractAnsiCode(line, end))
            end++;
        let cursor = index;
        for (const { segment } of getGraphemeSegmenter().segment(line.slice(index, end))) {
            cells.push({
                grapheme: segment,
                state,
                level: 0,
                logicalStart: cursor,
                logicalEnd: cursor + segment.length,
            });
            pendingCodes = "";
            cursor += segment.length;
        }
        index = end;
    }
    return { cells, trailing: pendingCodes };
}
/**
 * Resolve embedding levels and return the [maxLevel, minOddLevel] range to
 * reverse. Undefined means the line has no right-to-left run.
 */
function resolveLevels(cells, logical, forced) {
    const levels = bidi.getEmbeddingLevels(logical, forced ?? "auto");
    const paragraph = levels.paragraphs[0];
    let offset = 0;
    for (const cell of cells) {
        cell.level = levels.levels[offset];
        offset += cell.grapheme.length;
    }
    // Indent is layout, not content: leading whitespace stays at the left edge of the
    // line so the column the renderer chose still lines up. Whitespace at the end of
    // the text belongs to the paragraph and moves with it - in an RTL line the blank
    // after the last letter is the reading end, and that is where the caret has to sit.
    const anchorLevel = paragraph.level % 2 === 1 ? 0 : paragraph.level;
    let first = 0;
    while (first < cells.length && /^\s+$/.test(cells[first].grapheme))
        cells[first++].level = anchorLevel;
    let maxLevel = 0;
    let minOddLevel = Infinity;
    for (const cell of cells) {
        if (cell.level > maxLevel)
            maxLevel = cell.level;
        if (cell.level % 2 === 1 && cell.level < minOddLevel)
            minOddLevel = cell.level;
    }
    if (minOddLevel === Infinity)
        return undefined;
    return [maxLevel, minOddLevel];
}
/** UAX #9 L2: reverse every run at each level, from the top level down. */
function reverseRuns(cells, maxLevel, minOddLevel) {
    for (let level = maxLevel; level >= minOddLevel; level--) {
        let i = 0;
        while (i < cells.length) {
            if (cells[i].level >= level) {
                const runStart = i;
                while (i + 1 < cells.length && cells[i + 1].level >= level)
                    i++;
                if (i > runStart) {
                    const run = cells.slice(runStart, i + 1);
                    for (let k = 0; k < run.length; k++) {
                        cells[runStart + k] = run[run.length - 1 - k];
                    }
                }
            }
            i++;
        }
    }
}
function mirror(grapheme) {
    let mirrored = "";
    for (const char of grapheme) {
        mirrored += bidi.getMirroredCharacter(char) ?? char;
    }
    return mirrored;
}
// Emit the cells in the order given, carrying each grapheme's styling with it. The
// caret cell has no width of its own; its position in the emitted string is
// reported so the caller can put the cursor there.
function emitCells(cells, trailing) {
    let out = "";
    let emittedState;
    let caretIndex = 0;
    for (const cell of cells) {
        if (cell.isCaret) {
            caretIndex = out.length;
            continue;
        }
        out += sgrTransition(emittedState ?? defaultState, cell.state);
        emittedState = cell.state;
        out += cell.level % 2 === 1 ? mirror(cell.grapheme) : cell.grapheme;
    }
    return { text: out + trailing, caretIndex };
}
/**
 * Reorder one rendered line into visual order, keeping each grapheme's styling
 * with it. Lines with no RTL content come back unchanged, so English rendering
 * is bit for bit what it was before.
 */
export function reorderLine(line, forced) {
    return paintedLine(line, forced)?.text ?? line;
}
// The painted text of every line the renderer wrote, mapped back to the logical text
// it came from. Selection and search read painted lines, so this is how they get the
// text the user typed.
const logicalByPainted = new Map();
const PAINT_MEMORY_LIMIT = 4000;
function rememberPainted(text, logical) {
    if (logicalByPainted.size >= PAINT_MEMORY_LIMIT) {
        const oldest = logicalByPainted.keys().next().value;
        if (oldest !== undefined)
            logicalByPainted.delete(oldest);
    }
    logicalByPainted.set(text, logical);
}
/**
 * The logical text a painted line came from: brackets un-mirrored, runs put back in
 * the order they were written. Exact for a line painted in this process, approximate
 * for a fragment of one (the paragraph direction has to be re-detected from the
 * painted cells).
 */
export function unpaintLine(painted) {
    const remembered = logicalByPainted.get(painted);
    if (remembered !== undefined)
        return remembered;
    if (!getBidiSettings().enabled || !hasStrongRtl(painted))
        return painted;
    const parsed = parseCells(painted);
    if (parsed.cells.length === 0)
        return painted;
    const logical = parsed.cells.map((cell) => cell.grapheme).join("");
    const range = resolveLevels(parsed.cells, logical, lineDirection(logical));
    if (!range)
        return painted;
    // A painted line only ends in whitespace when something padded it after painting -
    // the renderer's padding, not text the reader read - so that blank stays put.
    let last = parsed.cells.length - 1;
    while (last >= 0 && /^\s+$/.test(parsed.cells[last].grapheme))
        parsed.cells[last--].level = 0;
    reverseRuns(parsed.cells, range[0], range[1]);
    return emitCells(parsed.cells, parsed.trailing).text;
}
export function paintedLine(line, forced) {
    if (!getBidiSettings().enabled || line.includes("\n") || !hasStrongRtl(line))
        return undefined;
    const parsed = parseCells(line);
    if (parsed.cells.length === 0)
        return undefined;
    const logical = parsed.cells.map((cell) => cell.grapheme).join("");
    const range = resolveLevels(parsed.cells, logical, forced ?? lineDirection(logical));
    if (!range)
        return undefined;
    const [maxLevel, minOddLevel] = range;
    const visual = [...parsed.cells];
    reverseRuns(visual, maxLevel, minOddLevel);
    const paintedWithCaret = (offset) => {
        const withCaret = insertCaretCell(parsed.cells, boundaryAt(parsed.cells, offset));
        reverseRuns(withCaret, maxLevel, minOddLevel);
        return emitCells(withCaret, parsed.trailing);
    };
    const caretColumns = new Map();
    const caretColumnAt = (offset) => {
        const cached = caretColumns.get(offset);
        if (cached !== undefined)
            return cached;
        const painted = paintedWithCaret(offset);
        const column = visibleWidth(painted.text.slice(0, painted.caretIndex));
        caretColumns.set(offset, column);
        return column;
    };
    const stepCaret = (offset, direction) => {
        const withCaret = insertCaretCell(parsed.cells, boundaryAt(parsed.cells, offset));
        reverseRuns(withCaret, maxLevel, minOddLevel);
        const caretIndex = withCaret.findIndex((cell) => cell.isCaret);
        const crossed = withCaret[caretIndex + direction];
        // The caret is already at the edge of the painted line: it cannot go further.
        if (!crossed || crossed.isCaret)
            return offset;
        // In an RTL run the grapheme the caret stepped over sits on the other side of
        // the caret, so the boundary moves to its start; in an LTR run, to its end.
        const rtlRun = crossed.level % 2 === 1;
        return (direction === 1) === rtlRun ? crossed.logicalStart : crossed.logicalEnd;
    };
    const caretOffsetAtColumn = (column) => {
        // The cell under the click. A click past the painted text belongs to the last
        // cell, so the caret lands at the edge of the line the reader is looking at.
        let cell;
        let paintedColumn = 0;
        for (const visualCell of visual) {
            cell = visualCell;
            if (column < paintedColumn + Math.max(1, visibleWidth(visualCell.grapheme)))
                break;
            paintedColumn += Math.max(1, visibleWidth(visualCell.grapheme));
        }
        if (!cell)
            return undefined;
        // Two boundaries touch this grapheme: before it and after it in logical order.
        // The reversal leaves one of them next to the clicked cell, so pick whichever
        // caret paints nearest the click.
        const before = Math.abs(caretColumnAt(cell.logicalStart) - column);
        const after = Math.abs(caretColumnAt(cell.logicalEnd) - column);
        return after < before ? cell.logicalEnd : cell.logicalStart;
    };
    const paintedText = emitCells(visual, parsed.trailing).text;
    rememberPainted(paintedText, logical);
    return {
        text: paintedText,
        direction: forced ?? lineDirection(logical) ?? "ltr",
        caretIndexAt: (offset) => paintedWithCaret(offset).caretIndex,
        caretColumnAt,
        caretOffsetAtColumn,
        stepCaret,
    };
}
/**
 * Paint one rendered line: put it in visual order, then, when alignment is on,
 * move it to the edge its script reads from. `width` is the column the line lives
 * in, so the padding that fills the column stays part of the line and a
 * background wrapped around the line still covers the whole row.
 *
 * This is the seam every component that writes a line to the terminal goes
 * through. Callers do not need `lineDirection`, `reorderLine` and `alignRight`
 * themselves, and lines with no RTL content come back unchanged.
 */
export function paintLine(line, width, forced) {
    const paint = paintedLine(line, forced);
    if (!paint)
        return line;
    return getBidiSettings().align && paint.direction === "rtl" ? alignRight(paint.text, width) : paint.text;
}
/**
 * A caret is not a character: it is a boundary between two graphemes. Model it
 * as a zero-width cell in the run it sits in so the reversal moves it with the
 * text around it.
 */
function insertCaretCell(cells, boundary) {
    const withCaret = [...cells];
    let level = cells[boundary]?.level ?? cells[boundary - 1]?.level ?? 0;
    let insert = boundary;
    // Whitespace pinned to a line edge is layout, not content: a caret next to it
    // belongs to the run it touches, so it travels with that run instead of riding the
    // padding to the far side of the line. Only edge whitespace is treated this way -
    // a gap between two runs is a real boundary the caret can sit in.
    if (level === 0) {
        let left = boundary - 1;
        while (left >= 0 && cells[left].level === 0 && /^\s+$/.test(cells[left].grapheme))
            left--;
        let right = boundary;
        while (right < cells.length && cells[right].level === 0 && /^\s+$/.test(cells[right].grapheme))
            right++;
        const touchesStart = left < 0;
        const touchesEnd = right >= cells.length;
        if (touchesEnd && left >= 0 && cells[left].level > 0) {
            level = cells[left].level;
            insert = left + 1;
        }
        else if (touchesStart && right < cells.length && cells[right].level > 0) {
            level = cells[right].level;
            insert = right;
        }
    }
    const start = cells[insert]?.logicalStart ?? cells[insert - 1]?.logicalEnd ?? 0;
    withCaret.splice(insert, 0, {
        grapheme: "",
        state: defaultState,
        level,
        logicalStart: start,
        logicalEnd: start,
        isCaret: true,
    });
    return withCaret;
}
/** Boundary index of the grapheme that contains or follows a code-unit offset. */
function boundaryAt(cells, offset) {
    for (let i = 0; i < cells.length; i++) {
        if (cells[i].logicalStart >= offset)
            return i;
        if (cells[i].logicalEnd >= offset)
            return i + 1;
    }
    return cells.length;
}
/**
 * Reorder a line and report where the caret lands in it. Returns undefined when
 * the line needs no reordering.
 */
export function reorderLineWithCaret(line, caretOffset, forced) {
    const paint = paintedLine(line, forced);
    if (!paint)
        return undefined;
    return { line: paint.text, caretOffset: paint.caretIndexAt(caretOffset) };
}
/**
 * Where the caret goes when an arrow key moves it one cell in visual direction.
 * Undefined for lines with no RTL (the caller keeps its logical step).
 */
export function stepCaretVisual(line, caretOffset, direction, forced) {
    return paintedLine(line, forced)?.stepCaret(caretOffset, direction);
}
/**
 * Which logical caret offset paints a caret at a given column of the reordered
 * line. A mouse click is a visual column; the editor's cursor is a logical offset,
 * so the click has to go through the same reversal the renderer used.
 *
 * Undefined for lines with no RTL, so the caller keeps its own logical walk.
 */
export function caretOffsetAtVisualColumn(line, visualColumn, forced) {
    return paintedLine(line, forced)?.caretOffsetAtColumn(visualColumn);
}
/** Pad a line on the left so it ends at the right edge of the column. */
export function alignRight(line, width) {
    const padding = width - visibleWidth(line);
    return padding > 0 ? " ".repeat(padding) + line : line;
}
//# sourceMappingURL=bidi.js.map