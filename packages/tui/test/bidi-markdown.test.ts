import assert from "node:assert";
import { describe, it } from "node:test";
import { configureBidi, reorderLine } from "../src/bidi.ts";
import { Markdown } from "../src/components/markdown.ts";
import { visibleWidth, wrapTextWithAnsi } from "../src/utils.ts";
import { defaultMarkdownTheme } from "./test-themes.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

function stripAnsi(line: string): string {
	return line.replace(/\x1b\[[0-9;]*m/g, "");
}

function renderMarkdown(markdown: string, width: number): string[] {
	return new Markdown(markdown, 0, 0, defaultMarkdownTheme).render(width).map((line) => stripAnsi(line).trimEnd());
}

describe("Arabic in the markdown renderer", () => {
	it("paints an RTL paragraph in visual order", () => {
		assert.equal(renderMarkdown("مرحبا بالعالم", 40)[0], "ملاعلاب ابحرم");
	});

	it("leaves English paragraphs exactly as before", () => {
		assert.equal(renderMarkdown("hello world", 40)[0], "hello world");
	});

	it("wraps the logical text, then reorders each visual line", () => {
		const text = "هذا نص عربي طويل جدا جدا جدا لا يستوعبه العرض";
		const logicalLines = wrapTextWithAnsi(text, 20);
		const visualLines = renderMarkdown(text, 20);
		assert.ok(logicalLines.length > 1, "the paragraph must wrap");
		assert.equal(visualLines.length, logicalLines.length);
		for (let i = 0; i < logicalLines.length; i++) {
			assert.equal(visualLines[i], reorderLine(logicalLines[i]), `line ${i}: ${visualLines[i]}`);
		}
	});

	it("keeps code blocks left to right", () => {
		const lines = renderMarkdown("```python\n# مرحبا\nprint(1)\n```", 40);
		assert.ok(
			lines.some((line) => line.includes("مرحبا")),
			lines.join("\n"),
		);
	});

	it("keeps list markers on the left edge", () => {
		const lines = renderMarkdown("- مرحبا\n- عالم", 40);
		assert.ok(lines[0].startsWith("- "), lines[0]);
		assert.ok(lines[1].startsWith("- "), lines[1]);
	});

	it("keeps the table grid while reordering cell content", () => {
		const lines = renderMarkdown("| عربي | English |\n|------|---------|\n| مرحبا | hello |", 40);
		assert.ok(
			lines.some((line) => line.startsWith("┌─")),
			lines[0],
		);
		const header = lines.find((line) => line.includes("│"))!;
		// The cell text travels; the column widths and the │ do not.
		assert.ok(header.includes("يبرع"), header);
		assert.ok(header.includes("English"), header);
		assert.equal(visibleWidth(header.replace(/\x1b\[[0-9;]*m/g, "")), visibleWidth(lines[2]), header);
	});

	it("reorders Hebrew and Persian inside the borders of a blockquote", () => {
		const lines = renderMarkdown("> שלום hello\n> این خط فارسی است", 40);
		assert.ok(lines[0].startsWith("│ "), lines[0]);
		assert.ok(!lines[0].includes("שלום"), lines[0]);
		assert.ok(lines[1].startsWith("│ "), lines[1]);
	});

	it("writes the reordered cells into the terminal buffer", async () => {
		const terminal = new VirtualTerminal(24, 4);
		for (const line of new Markdown("مرحبا بالعالم", 1, 0, defaultMarkdownTheme).render(24)) {
			terminal.write(`${line}\n`);
		}
		const viewport = await terminal.flushAndGetViewport();
		const row = viewport.findIndex((line) => line.trim().length > 0);
		assert.ok(row >= 0, viewport.join("|"));
		assert.equal(viewport[row].trim(), "ملاعلاب ابحرم", viewport[row]);
	});

	it("renders the old way when bidi is switched off", () => {
		const withBidi = renderMarkdown("مرحبا بالعالم", 40);
		configureBidi({ enabled: false });
		const withoutBidi = renderMarkdown("مرحبا بالعالم", 40);
		configureBidi({ enabled: true });
		assert.equal(withBidi[0], "ملاعلاب ابحرم");
		assert.equal(withoutBidi[0], "مرحبا بالعالم");
	});
});
