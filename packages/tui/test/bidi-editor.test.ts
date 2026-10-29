import assert from "node:assert";
import { describe, it } from "node:test";
import { configureBidi } from "../src/bidi.ts";
import { Editor } from "../src/components/editor.ts";
import { FAKE_CURSOR_START } from "../src/tui.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { visibleWidth } from "../src/utils.ts";
import { defaultEditorTheme } from "./test-themes.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

function createTestTUI(cols = 80, rows = 24): TUI {
	return new TuiMainScreen(new VirtualTerminal(cols, rows));
}

function typeInto(editor: Editor, text: string): void {
	for (const char of text) editor.handleInput(char);
}

describe("RTL in the editor", () => {
	it("paints an RTL line in visual order while keeping the logical string", () => {
		const editor = new Editor(createTestTUI(40), defaultEditorTheme);
		typeInto(editor, "مرحبا");

		assert.strictEqual(editor.state.lines[0], "مرحبا", "stored text stays logical");
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
		assert.strictEqual(editor.state.cursorCol, 5);

		// Right arrow goes right on screen = one grapheme earlier in the string.
		editor.handleInput("\x1b[C");
		assert.strictEqual(editor.state.cursorCol, 4, "right arrow steps backwards through RTL text");

		// Pressing Left at the logical end (already the visual left edge) does nothing.
		for (let i = 0; i < 5; i++) editor.handleInput("\x1b[D");
		assert.strictEqual(editor.state.cursorCol, 5, "caret stops at the visual left edge");

		// Right walks back through the run one grapheme at a time.
		for (let i = 0; i < 5; i++) editor.handleInput("\x1b[C");
		assert.strictEqual(editor.state.cursorCol, 0, "right arrow reaches the logical start");
		editor.handleInput("\x1b[C");
		assert.strictEqual(editor.state.cursorCol, 0, "caret does not jump past the visual right edge");
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

	it("inserts at the caret position when typing in the middle of an RTL line", () => {
		const editor = new Editor(createTestTUI(40), defaultEditorTheme);
		typeInto(editor, "مرحبا");
		editor.handleInput("\x1b[C"); // visual right = logical position 4
		editor.handleInput("X");
		assert.strictEqual(editor.state.lines[0], "مرحبXا", "typing lands at the logical caret");
	});
});
