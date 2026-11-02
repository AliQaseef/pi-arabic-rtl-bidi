import assert from "node:assert";
import { describe, it } from "node:test";
import { configureBidi, reorderLine } from "../src/bidi.ts";
import { Input } from "../src/components/input.ts";
import { ScrollView } from "../src/components/scroll-view.ts";
import { SelectList } from "../src/components/select-list.ts";
import { SettingsList, type SettingsListTheme } from "../src/components/settings-list.ts";
import { Text } from "../src/components/text.ts";
import { visibleWidth } from "../src/utils.ts";

const stripAnsi = (line: string): string =>
	line
		.replace(/\x1b\[[0-9;]*m/g, "")
		.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
		// The fake cursor and the hardware cursor marker are layout, not text.
		.replace(/\x1b_pi:[\s\S]*?\x07/g, "")
		.trimEnd();

const listTheme = {
	selectedPrefix: (text: string) => text,
	selectedText: (text: string) => text,
	description: (text: string) => text,
	scrollInfo: (text: string) => text,
	noMatch: (text: string) => text,
};

const settingsTheme: SettingsListTheme = {
	label: (text) => text,
	value: (text) => text,
	description: (text) => text,
	cursor: "> ",
	hint: (text) => text,
};

describe("RTL in components that build their own lines", () => {
	it("paints a single-line input in visual order", () => {
		const input = new Input({ prompt: "" });
		input.handleInput("مرحبا");
		const line = stripAnsi(input.render(20)[0]);
		assert.equal(line, reorderLine("مرحبا"), line);
		assert.ok(visibleWidth(line) <= 20, line);
	});

	it("leaves an English input untouched", () => {
		const input = new Input({ prompt: "" });
		input.handleInput("hello world");
		assert.equal(stripAnsi(input.render(20)[0]), "hello world");
	});

	it("paints an Arabic row of a select list", () => {
		const list = new SelectList([{ value: "مرحبا", label: "مرحبا" }], 5, listTheme);
		const line = stripAnsi(list.render(20)[0]);
		assert.ok(line.includes(reorderLine("مرحبا")), line);
	});

	it("paints Arabic labels and values inside their columns", () => {
		const list = new SettingsList(
			[{ id: "rtl", label: "مرحبا", currentValue: "نعم", values: ["نعم", "لا"] }],
			10,
			settingsTheme,
			() => {},
			() => {},
		);
		const line = stripAnsi(list.render(40)[0]);
		assert.ok(line.includes(reorderLine("مرحبا")), line);
		assert.ok(line.includes(reorderLine("نعم")), line);
		assert.ok(visibleWidth(line) <= 40, line);
	});

	it("puts the scrollbar gutter on the edge the line reads from", () => {
		configureBidi({ enabled: true, align: true });
		try {
			const rtl = new ScrollView(new Text("مرحبا", 0, 0), { scrollbar: "always" }).render(10)[0];
			const ltr = new ScrollView(new Text("hello", 0, 0), { scrollbar: "always" }).render(10)[0];
			assert.ok(rtl.startsWith(" "), rtl);
			assert.ok(ltr.endsWith(" "), ltr);
		} finally {
			configureBidi({ enabled: true, align: false });
		}
	});

	it("repaints a cached line when the bidi settings change", () => {
		configureBidi({ enabled: true, align: true });
		const text = new Text("مرحبا", 1, 0);
		const aligned = text.render(10)[0];
		configureBidi({ enabled: true, align: false });
		const unaligned = text.render(10)[0];
		assert.notEqual(aligned, unaligned, "a settings change must repaint the cached line");
		configureBidi({ enabled: true, align: false });
	});
});
