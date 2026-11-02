import assert from "node:assert";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { applyRtlSettingsFromDisk, getBidiSettings } from "../src/bidi.ts";

const tmpDir = join(process.cwd(), "test-rtl-settings-tmp");

function withAgentSettings(terminal: unknown, run: () => void): void {
	const previous = process.env.PI_CODING_AGENT_DIR;
	mkdirSync(tmpDir, { recursive: true });
	writeFileSync(join(tmpDir, "settings.json"), JSON.stringify({ terminal }));
	process.env.PI_CODING_AGENT_DIR = tmpDir;
	try {
		run();
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(tmpDir, { recursive: true, force: true });
	}
}

describe("RTL settings read from disk", () => {
	it("uses the terminal.rtl block from the agent settings file", () => {
		withAgentSettings({ rtl: { enabled: false, align: true } }, () => {
			applyRtlSettingsFromDisk();
			assert.deepEqual(getBidiSettings(), { enabled: false, align: false });
		});
	});

	it("stays off when the settings say nothing", () => {
		withAgentSettings({ showTerminalProgress: true }, () => {
			applyRtlSettingsFromDisk();
			assert.deepEqual(getBidiSettings(), { enabled: false, align: false });
		});
	});

	it("turns reordering on when the settings ask for it", () => {
		withAgentSettings({ rtl: { enabled: true } }, () => {
			applyRtlSettingsFromDisk();
			assert.deepEqual(getBidiSettings(), { enabled: true, align: true });
		});
	});

	it("PI_RTL=0 turns reordering off whatever the file says", () => {
		process.env.PI_RTL = "0";
		withAgentSettings({ rtl: { enabled: true, align: true } }, () => {
			applyRtlSettingsFromDisk();
			assert.deepEqual(getBidiSettings(), { enabled: false, align: false });
		});
		delete process.env.PI_RTL;
	});

	it("stays off when no settings file exists", () => {
		const previous = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = join(tmpDir, "does-not-exist");
		try {
			applyRtlSettingsFromDisk();
			assert.deepEqual(getBidiSettings(), { enabled: false, align: false });
		} finally {
			if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previous;
		}
	});
});
