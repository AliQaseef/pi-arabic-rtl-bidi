import assert from "node:assert";
import { describe, it } from "node:test";
import { findAltScreenSearchMatches } from "../src/alt-screen-search.ts";
import { configureBidi, reorderLine, unpaintLine } from "../src/bidi.ts";
import { Text } from "../src/components/text.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("unpainting a painted line", () => {
	it("gives back the logical text a painted line came from", () => {
		configureBidi({ enabled: true, align: false });
		for (const line of [
			"مرحبا",
			"مرحبا بالعالم",
			"hello مرحبا world",
			"(قوس) مع [أقواس]",
			"ارسل إلى npm install ثم check",
		]) {
			assert.equal(unpaintLine(reorderLine(line)), line, line);
		}
	});

	it("leaves a line nothing painted unchanged", () => {
		assert.equal(unpaintLine("hello world"), "hello world");
		configureBidi({ enabled: false });
		assert.equal(unpaintLine("مرحبا"), "مرحبا");
		configureBidi({ enabled: true });
	});
});

describe("searching a painted line", () => {
	it("finds the text the user typed, not only the painted spelling", () => {
		configureBidi({ enabled: true, align: false });
		const painted = reorderLine("مرحبا بالعالم");
		assert.ok(
			findAltScreenSearchMatches([painted], "العالم").length > 0,
			"typed query should match the painted line",
		);
		assert.ok(findAltScreenSearchMatches([painted], "مرحبا").length > 0, "first word should match");
		assert.equal(findAltScreenSearchMatches([painted], "xyz").length, 0, "no match for absent text");
		configureBidi({ enabled: true });
	});
});

describe("copying RTL text from the alt screen", () => {
	it("copies the text the user typed, not the painted cells", async () => {
		configureBidi({ enabled: true, align: false });
		const terminal = new VirtualTerminal(24, 6);
		const copied: string[] = [];
		const tui = new TuiAltScreen(terminal, undefined, undefined, {
			copySelection: async (text) => {
				copied.push(text);
				return true;
			},
		});
		tui.addChild(new Text("مرحبا بالعالم", 0, 0));
		tui.start();
		await terminal.waitForRender();

		// Drag across the line, then release: the renderer copies the selection.
		terminal.sendInput("\x1b[<0;1;1M");
		terminal.sendInput("\x1b[<32;20;1M");
		terminal.sendInput("\x1b[<0;20;1m");
		await terminal.waitForRender();

		assert.strictEqual(await tui.copyActiveSelectionToClipboard(), true);
		assert.equal(copied[0], "مرحبا بالعالم", `copied ${JSON.stringify(copied[0])}`);
		tui.stop();
	});
});
