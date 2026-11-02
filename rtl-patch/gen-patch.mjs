// Regenerate rtl-patch/pi-rtl-bidi.patch from this repository, against the release
// the patch is meant to apply to.
//
//   node rtl-patch/gen-patch.mjs              write the patch
//   node rtl-patch/gen-patch.mjs --check      report drift against the patch on disk
//
// The patch is derived, not hand-maintained: every file it contains is whatever the
// working tree holds right now, so running this after a change is what keeps the
// patch, the kit and the repo in sync.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PATCH = path.join(REPO, "rtl-patch", "pi-rtl-bidi.patch");
const MANIFEST = path.join(REPO, "rtl-patch", "installed", "manifest.json");
const mode = process.argv.includes("--check") ? "check" : "write";

// The release the patch applies to, read from the kit manifest.
const baseVersion = JSON.parse(fs.readFileSync(MANIFEST, "utf8")).baseVersion;
const BASE = `v${baseVersion}`;
const SCOPE = ["packages", "bun.lock", "package-lock.json"];

function git(args) {
	return execFileSync("git", args, { cwd: REPO, maxBuffer: 16 * 1024 * 1024 }).toString();
}

// git diff ignores untracked files. Files the patch adds (the bidi tests) are
// recorded as "intent to add" so they show up as new files in the diff.
for (const line of git(["status", "--porcelain", "--untracked-files=all", ...SCOPE]).split("\n")) {
	if (!line.startsWith("?? ")) continue;
	const file = line.slice(3).trim();
	if (file) git(["add", "-N", file]);
}

const lines = git(["diff", BASE, "--", ...SCOPE]).split("\n");

let added = 0;
let removed = 0;
let files = 0;
for (const line of lines) {
	if (line.startsWith("diff --git ")) files++;
	else if (line.startsWith("+") && !line.startsWith("+++")) added++;
	else if (line.startsWith("-") && !line.startsWith("---")) removed++;
}

// Each hunk carries the blob hash the file has after the patch. Compare those hashes
// with the blobs on disk: a mismatch means the patch on disk was written from a
// different tree than the one being patched.
function driftOf(patchText) {
	const patchLines = patchText.split("\n");
	const drift = [];
	for (let i = 0; i < patchLines.length; i++) {
		const match = /^index ([0-9a-f]+)\.\.([0-9a-f]+) /.exec(patchLines[i]);
		if (!match) continue;
		const file = patchLines[i - 1].slice(11).split(" b/")[0].slice(2);
		const local = git(["hash-object", file]).trim();
		if (!local.startsWith(match[2])) drift.push(`${file}: patch has ${match[2]}, working tree has ${local.slice(0, 7)}`);
	}
	return drift;
}

if (mode === "check") {
	if (!fs.existsSync(PATCH)) {
		console.error(`no patch at ${PATCH}; run gen-patch.mjs to write one`);
		process.exit(1);
	}
	const drift = driftOf(fs.readFileSync(PATCH, "utf8"));
	console.log(`patch on disk: ${files} files in the current diff, +${added} / -${removed}`);
	if (!drift.length) {
		console.log("the patch on disk matches the working tree");
	} else {
		console.log(`drift: ${drift.length} file(s) in the patch do not match the working tree`);
		for (const line of drift) console.log(`  ${line}`);
		process.exit(1);
	}
} else {
	fs.writeFileSync(PATCH, lines.join("\n"));
	console.log(`base ${BASE}: ${files} files, +${added} / -${removed}`);
	console.log(`wrote ${PATCH}`);
}
