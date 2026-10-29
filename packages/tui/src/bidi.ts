import bidiModule, { type Bidi } from "bidi-js";
import { extractAnsiCode, getGraphemeSegmenter, visibleWidth } from "./utils.ts";

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
const bidi: Bidi = (bidiModule as unknown as () => Bidi)();

// SGR styling and OSC 8 hyperlinks can travel with a grapheme. Cursor position
// codes and the editor cursor marker are positional: moving them would put the
// caret or the padding in the wrong column.
const movableEscapeRegex = /^(\x1b\[[0-9;]*m|\x1b\]8;[^;]*;[^\x07\x1b]*(?:\x07|\x1b\\))$/;

export type BaseDirection = "ltr" | "rtl";

export interface BidiSettings {
	/** Reorder RTL lines into visual order. Off makes rendering exactly what it was before. */
	enabled: boolean;
	/** Right-align RTL lines inside the content column. Off by default: alignment touches padding, the scrollbar gutter and overlay compositing. */
	align: boolean;
}

const settings: BidiSettings = { enabled: true, align: false };

export function configureBidi(next: Partial<BidiSettings>): void {
	Object.assign(settings, next);
}

export function getBidiSettings(): BidiSettings {
	return settings;
}

/**
 * Does this text contain a strong right-to-left character?
 *
 * Strong means the character itself carries a direction: Arabic and Hebrew
 * letters do, their combining marks do not. A Latin string carrying an Arabic
 * vowel mark is therefore still left-to-right.
 */
// Arabic, Hebrew and the other RTL blocks in the Unicode ranges that carry a
// strong RTL direction. Cheaper than segmenting every line of a mostly-ASCII
// transcript; anything outside these ranges is checked by the bidi table below.
const rtlScriptRegex = /[\u0590-\u06FF\u070C-\u0740\u0850-\u085F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

export function hasStrongRtl(text: string): boolean {
	if (!rtlScriptRegex.test(text)) return false;
	for (const { segment } of getGraphemeSegmenter().segment(text)) {
		const type = bidi.getBidiCharTypeName(segment[0] ?? "");
		if (type === "R" || type === "AL") return true;
	}
	return false;
}

/**
 * Base direction of a paragraph by UAX #9 P2/P3: the first strong character
 * decides. A forced direction wins over detection.
 */
export function detectBaseDirection(text: string, forced?: BaseDirection): BaseDirection {
	if (forced) return forced;
	return bidi.getEmbeddingLevels(text, "auto").paragraphs[0].level % 2 === 1 ? "rtl" : "ltr";
}

interface Cell {
	grapheme: string;
	style: string;
	level: number;
	/** Bounds of the grapheme in the logical line, in code units. */
	logicalStart: number;
	logicalEnd: number;
	isCaret?: boolean;
}

/**
 * Split a rendered line into grapheme cells carrying the styling that applies
 * to them. Returns an empty list when the line contains positional escapes
 * that must not move, so the caller leaves the line untouched.
 */
function parseCells(line: string): Cell[] {
	const cells: Cell[] = [];
	const activeStyles: string[] = [];

	let index = 0;
	while (index < line.length) {
		const ansi = extractAnsiCode(line, index);
		if (ansi) {
			if (!movableEscapeRegex.test(ansi.code)) return [];
			if (ansi.code === "\x1b[0m") {
				activeStyles.length = 0;
			} else if (ansi.code.startsWith("\x1b]8;")) {
				const body = ansi.code.slice(4, ansi.code.endsWith("\x07") ? -1 : -2);
				const url = body.split(";")[1] ?? "";
				if (url) {
					activeStyles.push(`\x1b]8;;${url}${ansi.code.endsWith("\x07") ? "\x07" : "\x1b\\"}`);
				} else {
					for (let i = activeStyles.length - 1; i >= 0; i--) {
						if (activeStyles[i].startsWith("\x1b]8;")) {
							activeStyles.splice(i, 1);
							break;
						}
					}
				}
			} else {
				activeStyles.push(ansi.code);
			}
			index += ansi.length;
			continue;
		}

		let end = index;
		while (end < line.length && !extractAnsiCode(line, end)) end++;
		let cursor = index;
		for (const { segment } of getGraphemeSegmenter().segment(line.slice(index, end))) {
			cells.push({
				grapheme: segment,
				style: activeStyles.join(""),
				level: 0,
				logicalStart: cursor,
				logicalEnd: cursor + segment.length,
			});
			cursor += segment.length;
		}
		index = end;
	}

	return cells;
}

/**
 * Resolve embedding levels and return the [maxLevel, minOddLevel] range to
 * reverse. Undefined means the line has no right-to-left run.
 */
function resolveLevels(cells: Cell[], logical: string, forced?: BaseDirection): [number, number] | undefined {
	const levels = bidi.getEmbeddingLevels(logical, forced ?? "auto");
	const paragraph = levels.paragraphs[0];

	let offset = 0;
	for (const cell of cells) {
		cell.level = levels.levels[offset];
		offset += cell.grapheme.length;
	}

	// Leading and trailing whitespace stay where they are. UAX #9 L1.4 resets
	// trailing whitespace to the paragraph level so it does not jump to the
	// other end of the line; leading whitespace needs the same anchor because
	// in a terminal the indent is layout produced by the renderer, not content
	// the reader is reading.
	const anchorLevel = paragraph.level % 2 === 1 ? 0 : paragraph.level;
	let first = 0;
	while (first < cells.length && /^\s+$/.test(cells[first].grapheme)) cells[first++].level = anchorLevel;
	let last = cells.length - 1;
	while (last >= first && /^\s+$/.test(cells[last].grapheme)) cells[last--].level = anchorLevel;

	let maxLevel = 0;
	let minOddLevel = Infinity;
	for (const cell of cells) {
		if (cell.level > maxLevel) maxLevel = cell.level;
		if (cell.level % 2 === 1 && cell.level < minOddLevel) minOddLevel = cell.level;
	}
	if (minOddLevel === Infinity) return undefined;

	return [maxLevel, minOddLevel];
}

/** UAX #9 L2: reverse every run at each level, from the top level down. */
function reverseRuns(cells: Cell[], maxLevel: number, minOddLevel: number): void {
	for (let level = maxLevel; level >= minOddLevel; level--) {
		let i = 0;
		while (i < cells.length) {
			if (cells[i].level >= level) {
				const runStart = i;
				while (i + 1 < cells.length && cells[i + 1].level >= level) i++;
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

function mirror(grapheme: string): string {
	let mirrored = "";
	for (const char of grapheme) {
		mirrored += bidi.getMirroredCharacter(char) ?? char;
	}
	return mirrored;
}

function emitCells(cells: Cell[]): string {
	let out = "";
	let emittedStyle = "";

	for (const cell of cells) {
		if (cell.isCaret) continue;
		if (cell.style !== emittedStyle) {
			out += cell.style || "\x1b[0m";
			emittedStyle = cell.style;
		}
		out += cell.level % 2 === 1 ? mirror(cell.grapheme) : cell.grapheme;
	}
	return emittedStyle ? `${out}\x1b[0m` : out;
}

/**
 * Reorder one rendered line into visual order, keeping each grapheme's styling
 * with it. Lines with no RTL content come back unchanged, so English rendering
 * is bit for bit what it was before.
 */
export function reorderLine(line: string, forced?: BaseDirection): string {
	if (!settings.enabled || !hasStrongRtl(line) || line.includes("\n")) return line;

	const cells = parseCells(line);
	if (cells.length === 0) return line;

	const range = resolveLevels(cells, cells.map((cell) => cell.grapheme).join(""), forced);
	if (!range) return line;

	reverseRuns(cells, range[0], range[1]);
	return emitCells(cells);
}

/**
 * A caret is not a character: it is a boundary between two graphemes. Model it
 * as a zero-width cell in the run it sits in so the reversal moves it with the
 * text around it.
 */
function insertCaretCell(cells: Cell[], boundary: number): Cell[] {
	const withCaret = [...cells];
	const level = cells[boundary]?.level ?? cells[boundary - 1]?.level ?? 0;
	const start = cells[boundary]?.logicalStart ?? cells[boundary - 1]?.logicalEnd ?? 0;
	withCaret.splice(boundary, 0, {
		grapheme: "",
		style: "",
		level,
		logicalStart: start,
		logicalEnd: start,
		isCaret: true,
	});
	return withCaret;
}

/** Boundary index of the grapheme that contains or follows a code-unit offset. */
function boundaryAt(cells: Cell[], offset: number): number {
	for (let i = 0; i < cells.length; i++) {
		if (cells[i].logicalStart >= offset) return i;
		if (cells[i].logicalEnd >= offset) return i + 1;
	}
	return cells.length;
}

/**
 * Reorder a line and report where the caret lands in it. Returns undefined when
 * the line needs no reordering.
 */
export function reorderLineWithCaret(
	line: string,
	caretOffset: number,
	forced?: BaseDirection,
): { line: string; caretOffset: number } | undefined {
	if (!settings.enabled || !hasStrongRtl(line) || line.includes("\n")) return undefined;

	const cells = parseCells(line);
	if (cells.length === 0) return undefined;

	const range = resolveLevels(cells, line, forced);
	if (!range) return undefined;

	const withCaret = insertCaretCell(cells, boundaryAt(cells, caretOffset));
	reverseRuns(withCaret, range[0], range[1]);

	let out = "";
	let emittedStyle = "";
	let caretIndex = 0;
	for (const cell of withCaret) {
		if (cell.isCaret) {
			caretIndex = out.length;
			continue;
		}
		if (cell.style !== emittedStyle) {
			out += cell.style || "\x1b[0m";
			emittedStyle = cell.style;
		}
		out += cell.level % 2 === 1 ? mirror(cell.grapheme) : cell.grapheme;
	}
	return { line: emittedStyle ? `${out}\x1b[0m` : out, caretOffset: caretIndex };
}

/**

/**
 * Where the caret goes when an arrow key moves it one cell in visual direction.
 * Undefined for lines with no RTL (the caller keeps its logical step) or when
 * the caret is already at the edge of the line.
 */
export function stepCaretVisual(
	line: string,
	caretOffset: number,
	direction: 1 | -1,
	forced?: BaseDirection,
): number | undefined {
	if (!settings.enabled || !hasStrongRtl(line) || line.includes("\n")) return undefined;

	const cells = parseCells(line);
	if (cells.length === 0) return undefined;

	const range = resolveLevels(cells, line, forced);
	if (!range) return undefined;

	const withCaret = insertCaretCell(cells, boundaryAt(cells, caretOffset));
	reverseRuns(withCaret, range[0], range[1]);

	const caretIndex = withCaret.findIndex((cell) => cell.isCaret);
	const crossed = withCaret[caretIndex + direction];
	// The caret is already at the edge of the painted line: it cannot go further.
	if (!crossed || crossed.isCaret) return caretOffset;

	// The caret crossed one grapheme. In an RTL run the grapheme it stepped over
	// sits on the other side of the caret, so the boundary moves to the start of
	// that grapheme; in an LTR run it moves to the end.
	const rtlRun = crossed.level % 2 === 1;
	return (direction === 1) === rtlRun ? crossed.logicalStart : crossed.logicalEnd;
}

/** Pad a line on the left so it ends at the right edge of the column. */
export function alignRight(line: string, width: number): string {
	const padding = width - visibleWidth(line);
	return padding > 0 ? " ".repeat(padding) + line : line;
}
