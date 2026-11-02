import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsManager } from "../src/core/settings-manager.ts";

describe("RTL settings", () => {
	const testDir = join(process.cwd(), "test-rtl-tmp");
	const agentDir = join(testDir, "agent");

	beforeEach(() => {
		rmSync(testDir, { recursive: true, force: true });
		mkdirSync(agentDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("defaults to reordering off with edge alignment on", () => {
		const manager = SettingsManager.create(testDir, agentDir);
		expect(manager.getRtlSettings()).toEqual({ enabled: false, align: true });
	});

	it("persists toggles written from the settings list", async () => {
		const manager = SettingsManager.create(testDir, agentDir);
		manager.setRtlAlign(true);
		manager.setRtlEnabled(false);
		await manager.flush();

		const written = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
		expect(written.terminal.rtl).toEqual({ enabled: false, align: true });
	});

	it("PI_RTL=0 turns reordering off whatever the settings say", () => {
		const manager = SettingsManager.create(testDir, agentDir);
		manager.setRtlEnabled(true);
		process.env.PI_RTL = "0";
		expect(manager.getRtlSettings().enabled).toBe(false);
		delete process.env.PI_RTL;
	});

	it("reads a settings file written by hand", () => {
		writeFileSync(
			join(agentDir, "settings.json"),
			JSON.stringify({ terminal: { rtl: { enabled: false, align: true } } }),
		);
		const manager = SettingsManager.create(testDir, agentDir);
		expect(manager.getRtlSettings()).toEqual({ enabled: false, align: true });
	});
});
