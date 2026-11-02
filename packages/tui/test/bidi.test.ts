import assert from "node:assert";
import { describe, it } from "node:test";
import bidiModule, { type Bidi } from "bidi-js";
import {
	alignRight,
	caretOffsetAtVisualColumn,
	configureBidi,
	detectBaseDirection,
	hasStrongRtl,
	lineDirection,
	paintLine,
	reorderLine,
	reorderLineWithCaret,
} from "../src/bidi.ts";
import { visibleWidth } from "../src/utils.ts";

describe("strong script detection", () => {
	it("does not treat Latin text as RTL", () => {
		assert.equal(hasStrongRtl("hello world 123"), false);
		assert.equal(hasStrongRtl("مرحبا"), true);
		assert.equal(hasStrongRtl("שלום"), true);
		// Combining marks are not strong: a Latin string carrying an Arabic vowel
		// mark is still left-to-right.
		assert.equal(hasStrongRtl("a\u064F"), false);
	});

	it("uses the first strong character for the base direction", () => {
		assert.equal(detectBaseDirection("   مرحبا"), "rtl");
		assert.equal(detectBaseDirection("pi is مرحبا"), "ltr");
		assert.equal(detectBaseDirection("مرحبا", "ltr"), "ltr");
	});
});

describe("reorderLine", () => {
	it("leaves lines without RTL content untouched", () => {
		const plain = "hello world, run npm install --save typescript";
		assert.equal(reorderLine(plain), plain);
		const styled = "\x1b[31merror:\x1b[0m expected 1 but got 2";
		assert.equal(reorderLine(styled), styled);
	});

	it("reverses a pure Arabic paragraph", () => {
		assert.equal(reorderLine("مرحبا بالعالم"), "ملاعلاب ابحرم");
	});

	it("keeps embedded Latin words in left-to-right order", () => {
		assert.equal(reorderLine("ارسل إلى npm install ثم check"), "check مث npm install ىلإ لسرا");
		// The line opens with a path, but two of its three words are Arabic, so the
		// Arabic sentence is the paragraph and the path sits inside it.
		assert.equal(reorderLine("C:/Users/ali/file.ts هذا ملف"), "فلم اذه C:/Users/ali/file.ts");
		// Latin owns more words here, so the Arabic stays an embedded run.
		assert.equal(
			reorderLine("npm run build ثم check the test then build"),
			"npm run build مث check the test then build",
		);
	});

	it("keeps combining marks attached to their base character", () => {
		// A code-unit reversal would put the damma before the meem; a grapheme
		// reversal keeps the cluster together.
		const visual = reorderLine("مُرحبا");
		assert.equal(visual, "ابحرم\u064F");
		assert.ok(!visual.startsWith("\u064F"), "the mark must not end up alone at the line start");
	});

	it("mirrors brackets in right-to-left runs", () => {
		assert.equal(reorderLine("الفقرة (الثانية) تنتهي"), "يهتنت (ةيناثلا) ةرقفلا");
	});

	it("keeps edge whitespace where the layout put it", () => {
		// UAX #9 L1.4 keeps trailing whitespace at the end of the line. Leading
		// whitespace is anchored the same way because in a terminal the indent is
		// layout produced by the renderer, not content the reader is reading.
		assert.equal(reorderLine("مرحبا   "), "ابحرم   ");
		assert.equal(reorderLine("  مرحبا"), "  ابحرم");
	});

	it("does not move positional escape sequences", () => {
		const marker = "مرحبا\x1b_pi:c\x07";
		assert.equal(reorderLine(marker), marker);
		assert.equal(reorderLine("مرحبا\x1b[2H"), "مرحبا\x1b[2H");
	});

	it("keeps cell width identical after reordering", () => {
		const lines = ["مرحبا بالعالم", "السعر 100 دولار", "نص (داخل الأقواس)", "مُرحبا by pi", "日本語 مرحبا"];
		for (const line of lines) {
			assert.equal(visibleWidth(reorderLine(line)), visibleWidth(line), line);
		}
	});

	it("keeps styling with the grapheme it moves", () => {
		// The meem is the last logical character, so it becomes the first glyph of
		// the RTL run; the red that opened the span travels with it. The span is
		// closed with the code that clears only the foreground, never a full reset,
		// which would also wipe the background wrapped around the line.
		assert.equal(reorderLine("\x1b[31mمرحبا\x1b[0m tail"), "tail \x1b[31mابحرم");
		assert.ok(!reorderLine("\x1b[31mمرحبا\x1b[0m tail").includes("\x1b[0m"));
	});

	it("closes a style with the code that clears only that attribute", () => {
		// A full reset in the middle of the line would also wipe the background the
		// renderer wraps the line in, leaving the padding black.
		const line = "\x1b[38;5;250mمرحبا\x1b[39m tail";
		const reordered = reorderLine(line);
		assert.ok(!reordered.includes("\x1b[0m"), reordered);
		assert.equal(reordered.replace(/\x1b\[[0-9;]*m/g, ""), "tail ابحرم", reordered);
		assert.equal(visibleWidth(reordered), visibleWidth(line), reordered);
	});

	it("treats the empty parameter form ESC[m as a reset", () => {
		const reordered = reorderLine("\x1b[1mمرحبا\x1b[m tail");
		assert.equal(reordered.replace(/\x1b\[[0-9;]*m/g, ""), "tail ابحرم", reordered);
	});

	it("keeps hyperlinks attached to their text", () => {
		const line = "مرحبا \x1b]8;;https://pi.dev\x07الرابط\x1b]8;;\x07";
		const reordered = reorderLine(line);
		assert.ok(visibleWidth(reordered) === visibleWidth(line), reordered);
		assert.ok(reordered.includes("https://pi.dev"), reordered);
	});

	it("aligns RTL lines to the right edge", () => {
		const line = "مرحبا";
		assert.equal(visibleWidth(alignRight(line, 20)), 20);
		assert.ok(alignRight(line, 20).startsWith("   "));
	});

	it("aligns with the script that dominates the line", () => {
		// No RTL content means nothing to move: the line stays where it is.
		assert.equal(lineDirection("hello world 1234"), undefined);
		assert.equal(lineDirection("مرحبا بالعالم"), "rtl");
		assert.equal(lineDirection("npm install ثم build the package"), "ltr");
		assert.equal(lineDirection("مرحبا بالعالم (mixed 1234)"), "rtl");
		assert.equal(lineDirection("مرحبا"), "rtl");
		assert.equal(lineDirection("عربي text"), "rtl");
		// Equal counts fall back to the first strong character, the same rule UAX #9
		// uses for direction, so the script the line starts with wins.
		assert.equal(lineDirection("مرحبا hello"), "rtl");
		assert.equal(lineDirection("hello مرحبا"), "ltr");
	});

	it("reads a line by the script that owns it, not by its first character", () => {
		// A renderer can put a tool name, a code span or a marker at the front of a
		// line while the sentence behind it is Arabic. UAX #9 alone would order that
		// line by "ask", and the Arabic would read backwards.
		assert.equal(lineDirection("ask 3 questions (أي بريد يكتب في الـ commit؟)"), "rtl");
		assert.equal(lineDirection("commit الـ الذي يكتب في الريبو كثيرا", "ltr"), "ltr");
		// Escape codes are layout, not text: the letters in a style code do not
		// tip the balance towards Latin.
		assert.equal(lineDirection("\x1b[1mgit\x1b[0m حالة الريبو الحالية"), "rtl");
		assert.equal(lineDirection("git status"), undefined);
	});

	it("reorders by the same rule that aligns the line", () => {
		const line = "ask 3 questions (أي بريد يكتب في الـ commit؟)";
		assert.equal(reorderLine(line), reorderLine(line, "rtl"));
		assert.notEqual(reorderLine(line), reorderLine(line, "ltr"));
		// A Latin-dominant line keeps its LTR order even when it holds Arabic words.
		const mixed = "npm install ثم build the package";
		assert.equal(reorderLine(mixed), reorderLine(mixed, "ltr"));
	});

	// The reference is bidi-js's own UAX #9 reordering, run on the same graphemes.
	it("matches the bidi-js reference reordering", () => {
		// bidi-js exports a factory; its declaration is not callable for tsc.
		const reference = (bidiModule as unknown as () => Bidi)();
		const samples = [
			"مرحبا بالعالم",
			"الرقم 1234 هو الاصغر",
			"مرحبا — this line mixes Arabic and English, with numbers 1234.",
			"(قوس) مع [أقواس]",
			"عنصر أول",
			"أكتب بالعربية here",
			"هل支持 bidi؟ نعم 123",
		];
		// Combining marks are excluded: bidi-js reorders by code unit and detaches a
		// mark from its base letter, while a terminal needs the cluster to travel whole.
		for (const sample of samples) {
			const levels = reference.getEmbeddingLevels(sample, "auto");
			const expected = reference.getReorderedString(sample, levels);
			assert.equal(reorderLine(sample), expected, sample);
		}
	});
});

describe("click-to-caret mapping", () => {
	const caretPaintsAt = (line: string, offset: number): number => {
		const painted = reorderLineWithCaret(line, offset);
		return painted ? visibleWidth(painted.line.slice(0, painted.caretOffset)) : -1;
	};

	it("mirrors the caret position inside an RTL run", () => {
		// Painted ا ب ح ر م: column 0 holds the grapheme at the end of the logical string.
		assert.equal(caretOffsetAtVisualColumn("مرحبا", 0), 5);
		assert.equal(caretOffsetAtVisualColumn("مرحبا", 1), 4);
		assert.equal(caretOffsetAtVisualColumn("مرحبا", 4), 1);
		// A click past the painted text lands on the edge of the line the reader sees.
		assert.equal(caretOffsetAtVisualColumn("مرحبا", 20), 0);
	});

	it("returns undefined for a line nothing was reordered", () => {
		assert.equal(caretOffsetAtVisualColumn("hello world", 3), undefined);
		configureBidi({ enabled: false });
		try {
			assert.equal(caretOffsetAtVisualColumn("مرحبا", 3), undefined);
		} finally {
			configureBidi({ enabled: true });
		}
	});

	it("puts a caret at a line edge against the text, not the pinned padding", () => {
		// The trailing space is pinned at the physical end of the line, but the caret
		// after the last Arabic grapheme belongs to the run: it stays at the reading end.
		assert.equal(caretPaintsAt("مرحبا ", 6), 0);
		assert.equal(caretPaintsAt("مرحبا ", 5), 0);
		assert.equal(caretPaintsAt("مرحبا   ", 8), 0);
		// The indent is layout too: a caret before it lands at the reading start, the right.
		assert.equal(caretPaintsAt("  مرحبا", 0), 7);
		// A gap between two runs is a real boundary the caret can sit in.
		assert.equal(caretPaintsAt("hello مرحبا world", 5), 5);
	});

	// Every caret position the renderer can paint has to be reachable by a click
	// Every caret position the renderer can paint has to be reachable by a click
	// on the cell the caret occupies.
	it("maps every painted caret column back to a logical offset", () => {
		for (const line of ["مرحبا", "مرحبا بالعالم", "hello مرحبا world", "(قوس) مع [أقواس]"]) {
			for (let offset = 0; offset <= line.length; offset++) {
				const column = caretPaintsAt(line, offset);
				const mapped = caretOffsetAtVisualColumn(line, column);
				assert.ok(mapped !== undefined, `${line} column ${column}`);
				assert.equal(caretPaintsAt(line, mapped), column, `${line}: offset ${offset} paints at column ${column}`);
			}
		}
	});
});

describe("paintLine", () => {
	it("paints an RTL line in visual order against the reading edge", () => {
		configureBidi({ enabled: true, align: true });
		try {
			const painted = paintLine("مرحبا", 10);
			assert.equal(painted, "     ابحرم");
			// The padding stays part of the line, so a background wrapped around it
			// still covers the whole row.
			assert.equal(visibleWidth(painted), 10);
		} finally {
			configureBidi({ enabled: true, align: false });
		}
	});

	it("returns the line unchanged when alignment is off", () => {
		configureBidi({ enabled: true, align: false });
		assert.equal(paintLine("مرحبا", 10), "ابحرم");
	});

	it("does not touch a line with no RTL content", () => {
		configureBidi({ enabled: true, align: true });
		try {
			assert.equal(paintLine("hello world", 40), "hello world");
			assert.equal(paintLine("pi is 1.4.0", 20), "pi is 1.4.0");
		} finally {
			configureBidi({ enabled: true, align: false });
		}
	});

	it("paints nothing when reordering is off", () => {
		configureBidi({ enabled: false, align: true });
		try {
			assert.equal(paintLine("مرحبا", 10), "مرحبا");
		} finally {
			configureBidi({ enabled: true, align: false });
		}
	});
});
