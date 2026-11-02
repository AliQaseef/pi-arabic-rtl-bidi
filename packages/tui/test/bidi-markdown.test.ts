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

	it("reorders RTL text inside the borders of a blockquote", () => {
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

	it("keeps the background fill to the right edge of a reordered line", () => {
		configureBidi({ enabled: true, align: false });
		const line = new Markdown("مرحبا بالعالم **bold**", 1, 0, defaultMarkdownTheme, {
			bgColor: (text: string) => `\x1b[44m${text}\x1b[49m`,
		}).render(30)[0];

		assert.ok(line.includes("ملاعلاب"), line);

		// The background the renderer wraps the line in has to survive the reorder:
		// a full reset in the middle of the line would leave the padding black.
		const bgStart = line.indexOf("\x1b[44m");
		const bgEnd = line.lastIndexOf("\x1b[49m");
		assert.ok(bgStart >= 0 && bgEnd > bgStart, line);
		assert.ok(!line.slice(bgStart + 6, bgEnd).includes("\x1b[0m"), line);
		assert.equal(visibleWidth(line), 30, line);
	});
});

describe("alignment follows the script that dominates the line", () => {
	function renderAligned(markdown: string, width: number): string {
		configureBidi({ enabled: true, align: true });
		return new Markdown(markdown, 0, 0, defaultMarkdownTheme).render(width)[0].trimEnd();
	}

	it("pushes an Arabic line to the right edge", () => {
		const line = renderAligned("مرحبا بالعالم", 20);
		assert.equal(stripAnsi(line), "       ملاعلاب ابحرم", line);
		assert.equal(visibleWidth(line), 20, line);
	});

	it("leaves an English line at the left edge", () => {
		const line = renderAligned("hello world", 20);
		assert.equal(stripAnsi(line), "hello world", line);
	});

	it("leaves a mixed line with more English than Arabic at the left edge", () => {
		const line = renderAligned("npm install ثم build the package", 40);
		assert.ok(line.startsWith("npm install"), line);
		assert.ok(!line.startsWith(" "), line);
	});

	it("pushes a mixed line with more Arabic than English to the right edge", () => {
		const line = renderAligned("مرحبا بالعالم (mixed 1234)", 40);
		assert.ok(!line.startsWith("npm"), line);
		assert.ok(visibleWidth(line) === 40, line);
		assert.ok(stripAnsi(line).startsWith(" "), line);
	});

	it("never changes the visible width of a wrapped paragraph", () => {
		configureBidi({ enabled: true, align: true });
		const lines = new Markdown("مرحبا بالعالم هذا اختبار للنص الطويل الذي ينعطف", 0, 0, defaultMarkdownTheme).render(
			30,
		);
		for (const line of lines) {
			assert.ok(visibleWidth(line) <= 30, line);
		}
		// Every line of the paragraph ends at the same column.
		assert.ok(
			lines.every((line) => visibleWidth(line) === 30),
			lines.map((line) => visibleWidth(line)).join(","),
		);
		configureBidi({ enabled: true, align: false });
	});

	it("puts the marker on the reading edge of an RTL list item", () => {
		configureBidi({ enabled: true, align: true });
		const lines = new Markdown("- عنصر قصير\n- عنصر آخر", 0, 0, defaultMarkdownTheme).render(20);
		assert.ok(stripAnsi(lines[0]).trimEnd().endsWith("-"), lines[0]);
		assert.ok(!stripAnsi(lines[0]).startsWith("- "), lines[0]);
		assert.ok(stripAnsi(lines[1]).trimEnd().endsWith("-"), lines[1]);
		assert.ok(
			lines.every((line) => visibleWidth(line) === 20),
			lines.join("|"),
		);

		// An item whose text is mostly English keeps its marker on the left.
		const english = new Markdown("- npm install the package now", 0, 0, defaultMarkdownTheme).render(40)[0];
		assert.ok(stripAnsi(english).startsWith("- "), english);
		configureBidi({ enabled: true, align: false });
	});

	it("puts the blockquote bar on the reading edge of an RTL quote", () => {
		configureBidi({ enabled: true, align: true });
		const line = new Markdown("> اقتباس عربي", 0, 0, defaultMarkdownTheme).render(20)[0];
		assert.ok(stripAnsi(line).trimEnd().endsWith("│"), line);
		assert.equal(visibleWidth(line), 20, line);
		configureBidi({ enabled: true, align: false });
	});

	it("mirrors an RTL table's columns and hugs the grid to the right edge", () => {
		configureBidi({ enabled: true, align: true });
		const lines = new Markdown("| الأمر | البديل |\n|---|---|\n| grep -r | rg |", 0, 0, defaultMarkdownTheme).render(
			30,
		);
		const grid = lines[0];
		assert.ok(stripAnsi(grid).startsWith(" "), grid);
		assert.ok(!stripAnsi(grid).startsWith("┌"), grid);
		assert.ok(grid.includes("┐"), grid);
		assert.ok(!grid.includes("┐ "), grid); // the grid ends flush with the column edge

		const header = lines[1];
		// The logical first column is painted on the right, its content still in visual order.
		assert.ok(header.indexOf("ليدبلا") < header.indexOf("رمألا"), header);
		configureBidi({ enabled: true, align: false });
	});
});
