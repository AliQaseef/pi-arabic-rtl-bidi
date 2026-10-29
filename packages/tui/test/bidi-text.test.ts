import assert from "node:assert";
import { describe, it } from "node:test";
import { configureBidi, reorderLine } from "../src/bidi.ts";
import { Text } from "../src/components/text.ts";
import { TruncatedText } from "../src/components/truncated-text.ts";
import { truncateToWidth, visibleWidth } from "../src/utils.ts";

function stripAnsi(line: string): string {
	return line
		.replace(/\x1b\[[0-9;]*m/g, "")
		.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
		.trimEnd();
}

describe("RTL in Text and TruncatedText", () => {
	it("reorders an RTL line in Text", () => {
		const text = new Text("مرحبا بالعالم", 0, 0);
		const lines = text.render(20);
		assert.equal(stripAnsi(lines[0]), "ملاعلاب ابحرم", lines[0]);
	});

	it("leaves an English line byte for byte", () => {
		const text = new Text("hello world 1234", 0, 0);
		assert.equal(stripAnsi(text.render(20)[0]), "hello world 1234");
	});

	it("truncates logically, then reorders the visual line", () => {
		const expected = stripAnsi(reorderLine(truncateToWidth("مرحبا بالعالم", 8)));
		const line = stripAnsi(new TruncatedText("مرحبا بالعالم", 0, 0).render(8)[0]);
		assert.ok(visibleWidth(line) <= 8, line);
		assert.ok(line.includes("..."), line);
		// The cut is made on the logical string, then painted in visual order.
		assert.equal(line, expected, line);
	});

	it("keeps width stable for wrapped RTL lines", () => {
		const text = new Text("مرحبا بالعالم هذا اختبار للنص الطويل الذي ينعطف", 0, 0);
		for (const line of text.render(20)) {
			assert.ok(visibleWidth(stripAnsi(line)) <= 20, line);
		}
	});

	it("does nothing when bidi is disabled", () => {
		const enabled = stripAnsi(new Text("مرحبا", 0, 0).render(20)[0]);
		configureBidi({ enabled: false });
		const disabled = stripAnsi(new Text("مرحبا", 0, 0).render(20)[0]);
		configureBidi({ enabled: true });
		assert.equal(disabled, "مرحبا", disabled);
		assert.equal(enabled, "ابحرم", enabled);
	});
});
