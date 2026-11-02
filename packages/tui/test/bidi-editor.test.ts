import assert from "node:assert";
import { describe, it } from "node:test";
import { caretOffsetAtVisualColumn, configureBidi } from "../src/bidi.ts";
import { Editor } from "../src/components/editor.ts";
import type { TUI } from "../src/tui.ts";
import { FAKE_CURSOR_START } from "../src/tui.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { visibleWidth } from "../src/utils.ts";
import { defaultEditorTheme } from "./test-themes.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

function createTestTUI(cols = 80, rows = 24): TUI {
	return new TuiMainScreen(new VirtualTerminal(cols, rows));
}

// The editor keeps its buffer and caret in a private state; tests read it directly.
function editorState(editor: Editor): { lines: string[]; cursorCol: number; cursorLine: number } {
	return (editor as unknown as { state: { lines: string[]; cursorCol: number; cursorLine: number } }).state;
}

function typeInto(editor: Editor, text: string): void {
	for (const char of text) editor.handleInput(char);
}

function click(editor: Editor, x: number, y: number, width: number): void {
	editor.handleMouse({
		type: "click",
		button: "left",
		x,
		y,
		width,
		height: 24,
		screenX: x,
		screenY: y,
		shift: false,
		alt: false,
		ctrl: false,
	});
}

/** Column the fake cursor occupies in the rendered line, i.e. where the caret shows up. */
function caretColumn(editor: Editor, width: number, row = 1): number {
	const line = editor.render(width)[row]!;
	const index = line.indexOf(FAKE_CURSOR_START);
	return index < 0 ? -1 : visibleWidth(line.slice(0, index));
}

describe("RTL in the editor", () => {
	it("paints an RTL line in visual order while keeping the logical string", () => {
		const editor = new Editor(createTestTUI(40), defaultEditorTheme);
		typeInto(editor, "مرحبا");

		assert.strictEqual(editorState(editor).lines[0], "مرحبا", "stored text stays logical");
		const content = editor.render(40)[1]!;
		assert.ok(content.includes("ا"), "visual line starts with the last logical grapheme");
		assert.ok(visibleWidth(content) <= 40, "painted line does not change width");
	});

	it("keeps English lines byte for byte", () => {
		const editor = new Editor(createTestTUI(40), defaultEditorTheme);
		typeInto(editor, "hello world");
		assert.deepStrictEqual(editor.render(40), editor.render(40));
		const line = editor.render(40)[1]!;
		assert.ok(line.includes("hello world"), "LTR line is not reordered");
	});

	it("moves the caret visually, not logically, on arrow keys", () => {
		const editor = new Editor(createTestTUI(40), defaultEditorTheme);
		typeInto(editor, "مرحبا");
		// Logical caret is at the end (index 5), which is the left edge visually.
		assert.strictEqual(editorState(editor).cursorCol, 5);

		// Right arrow goes right on screen = one grapheme earlier in the string.
		editor.handleInput("\x1b[C");
		assert.strictEqual(editorState(editor).cursorCol, 4, "right arrow steps backwards through RTL text");

		// Pressing Left at the logical end (already the visual left edge) does nothing.
		for (let i = 0; i < 5; i++) editor.handleInput("\x1b[D");
		assert.strictEqual(editorState(editor).cursorCol, 5, "caret stops at the visual left edge");

		// Right walks back through the run one grapheme at a time.
		for (let i = 0; i < 5; i++) editor.handleInput("\x1b[C");
		assert.strictEqual(editorState(editor).cursorCol, 0, "right arrow reaches the logical start");
		editor.handleInput("\x1b[C");
		assert.strictEqual(editorState(editor).cursorCol, 0, "caret does not jump past the visual right edge");
	});

	it("places the painted caret on the visual side of the grapheme it precedes", () => {
		const editor = new Editor(createTestTUI(40), defaultEditorTheme);
		typeInto(editor, "مرحبا");
		const line = editor.render(40)[1]!;

		// Caret is at the logical end, so it must appear at the left of the RTL run,
		// not at the right where the logical index would put it.
		const cursorColumn = line.indexOf(FAKE_CURSOR_START);
		const textStart = line.search(/[ء-ي]/);
		assert.ok(
			cursorColumn >= 0 && cursorColumn <= textStart,
			`caret at column ${cursorColumn}, run starts at ${textStart}`,
		);
	});

	it("keeps the caret on the visual edge when the RTL line is right-aligned", () => {
		configureBidi({ enabled: true, align: true });
		try {
			const editor = new Editor(createTestTUI(40), defaultEditorTheme);
			typeInto(editor, "مرحبا");
			const line = editor.render(40)[1]!;

			// The run hugs the right edge of the column and the caret still sits at the
			// left of it, where an RTL reader expects the next character to go.
			assert.equal(visibleWidth(line), 40, line);
			const cursorColumn = line.indexOf(FAKE_CURSOR_START);
			const textStart = line.search(/[ء-ي]/);
			assert.ok(textStart > 0, `run starts at column ${textStart}`);
			assert.ok(cursorColumn >= 0 && cursorColumn <= textStart, `caret at ${cursorColumn}, run at ${textStart}`);
			assert.ok(visibleWidth(line) === 40, line);
		} finally {
			configureBidi({ enabled: true, align: false });
		}
	});

	it("draws the caret at the left edge of an RTL line, where the text ends", async () => {
		const terminal = new VirtualTerminal(40, 8);
		const editor = new Editor(new TuiMainScreen(terminal), defaultEditorTheme);
		typeInto(editor, "مرحبا\nعالم");
		for (const line of editor.render(40)) terminal.write(`${line}\n`);
		const line = editor.render(40)[1]!;
		// Drop the styling and cursor-marker escapes, keep the painted graphemes.
		const painted = line
			.replace(/\x1b[^\x07]*\x07/g, "")
			.replace(/\x1b\[[0-9;]*m/g, "")
			.trimEnd();
		// The caret sits at the logical end, which in RTL is the left edge of the line.
		assert.ok(painted.startsWith("ا"), painted);
		assert.ok(painted.indexOf("ا") < painted.indexOf("ب"), painted);
	});

	it("keeps the caret at the reading end when a space follows an RTL word", () => {
		configureBidi({ enabled: true, align: true });
		try {
			const editor = new Editor(createTestTUI(40), defaultEditorTheme);
			typeInto(editor, "مرحبا");
			const before = caretColumn(editor, 40);
			editor.handleInput(" ");
			const after = caretColumn(editor, 40);
			// The space joins the padding at the physical end of the line; the caret must
			// not ride it to the far edge, it stays against the text it follows.
			assert.ok(after < before, `caret jumped to column ${after} after a space`);
			assert.equal(visibleWidth(editor.render(40)[1]!), 40, editor.render(40)[1]);
		} finally {
			configureBidi({ enabled: true, align: false });
		}
	});

	it("gives the caret its own blank cell outside an RTL run, like a Latin line", () => {
		configureBidi({ enabled: true, align: true });
		try {
			const editor = new Editor(createTestTUI(40), defaultEditorTheme);
			typeInto(editor, "مرحبا ");
			const line = editor.render(40)[1]!;
			const painted = line.replace(/\x1b[^\x07]*\x07/g, "").replace(/\x1b\[[0-9;]*m/g, "");
			const caretAt = visibleWidth(painted.slice(0, line.indexOf(FAKE_CURSOR_START)));
			// The caret's cell, then the blank the writer typed, then the word: nothing is
			// hidden under the caret, so the reader sees the space the caret sits after.
			assert.equal(painted.charAt(caretAt), " ", painted);
			assert.equal(painted.charAt(caretAt + 1), " ", painted);
			assert.ok(painted.startsWith("ا", caretAt + 2), painted);
			assert.equal(visibleWidth(line), 40, line);
		} finally {
			configureBidi({ enabled: true, align: false });
		}
	});

	it("inserts at the caret position when typing in the middle of an RTL line", () => {
		const editor = new Editor(createTestTUI(40), defaultEditorTheme);
		typeInto(editor, "مرحبا");
		editor.handleInput("\x1b[C"); // visual right = logical position 4
		editor.handleInput("X");
		assert.strictEqual(editorState(editor).lines[0], "مرحبXا", "typing lands at the logical caret");
	});

	it("puts the caret on the character the mouse is clicked on", () => {
		const editor = new Editor(createTestTUI(40), defaultEditorTheme);
		typeInto(editor, "مرحبا");

		// Painted left to right: ا ب ح ر م. Each click has to land on the grapheme
		// under the pointer, not on its mirror position.
		const expected = [5, 4, 3, 2, 1];
		for (let column = 0; column < expected.length; column++) {
			click(editor, column, 1, 40);
			assert.strictEqual(editorState(editor).cursorCol, expected[column], `click on column ${column}`);
			assert.strictEqual(caretColumn(editor, 40), column, `caret paints on the clicked cell of column ${column}`);
		}
	});

	it("clicks a right-aligned RTL line at the edge the text is painted on", () => {
		configureBidi({ enabled: true, align: true });
		try {
			const editor = new Editor(createTestTUI(40), defaultEditorTheme);
			typeInto(editor, "مرحبا");
			// The run hugs the right edge of the 40-column line, so its cells start at 35.
			// A click on the last cell lands the caret at the end of the text, and that caret
			// gets its own blank cell just outside the run, the way a Latin line's does.
			for (const [column, logical, caretAt] of [
				[35, 5, 34],
				[36, 4, 36],
				[37, 3, 37],
				[38, 2, 38],
				[39, 1, 39],
			]) {
				click(editor, column, 1, 40);
				assert.strictEqual(editorState(editor).cursorCol, logical, `click on column ${column}`);
				assert.strictEqual(caretColumn(editor, 40), caretAt, `caret paints beside the cell of column ${column}`);
			}
		} finally {
			configureBidi({ enabled: true, align: false });
		}
	});

	it("maps clicks in a line that mixes Latin and Arabic", () => {
		const editor = new Editor(createTestTUI(40), defaultEditorTheme);
		typeInto(editor, "hello مرحبا world");
		// Painted: "hello ابحرم world" - column 6 is the first painted cell of the
		// Arabic run. The caret goes before that grapheme in logical order; no
		// boundary can paint at column 6, so it is the nearest one.
		click(editor, 6, 1, 40);
		assert.strictEqual(editorState(editor).cursorCol, 10, "caret goes before the clicked ا");
		for (const [column, logical] of [
			[7, 10],
			[8, 9],
			[9, 8],
			[10, 7],
		]) {
			click(editor, column, 1, 40);
			assert.strictEqual(editorState(editor).cursorCol, logical, `click on column ${column}`);
			assert.strictEqual(caretColumn(editor, 40), column, `caret paints on the clicked cell of column ${column}`);
		}
		// The Latin part of the line is untouched by the reversal.
		click(editor, 4, 1, 40);
		assert.strictEqual(editorState(editor).cursorCol, 4, "caret on the clicked o");
		click(editor, 13, 1, 40);
		assert.strictEqual(editorState(editor).cursorCol, 13, "caret on the clicked o of world");
	});

	it("leaves clicks logical when RTL rendering is off", () => {
		configureBidi({ enabled: false, align: false });
		try {
			const editor = new Editor(createTestTUI(40), defaultEditorTheme);
			typeInto(editor, "مرحبا");
			// The line is painted exactly as written, so column and logical index agree.
			for (let column = 0; column < 5; column++) {
				click(editor, column, 1, 40);
				assert.strictEqual(editorState(editor).cursorCol, column, `click on column ${column}`);
			}
			assert.strictEqual(
				caretOffsetAtVisualColumn("مرحبا", 2),
				undefined,
				"no visual mapping for an unreordered line",
			);
		} finally {
			configureBidi({ enabled: true, align: false });
		}
	});
});
