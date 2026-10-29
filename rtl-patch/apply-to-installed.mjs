// Apply the RTL/bidi patch to an INSTALLED pi (compiled dist, no source tree).
//
//   node apply-to-installed.mjs                 patch the newest installed release
//   node apply-to-installed.mjs --check         report status, write nothing
//   node apply-to-installed.mjs --revert        restore the original files
//   node apply-to-installed.mjs --release <dir> a specific release directory
//
// Every file it touches is backed up under node_modules/.rtl-backup/ first.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const KIT = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = JSON.parse(fs.readFileSync(path.join(KIT, "installed/manifest.json"), "utf8"));
const args = process.argv.slice(2);
const mode = args.includes("--revert") ? "revert" : args.includes("--check") ? "check" : "apply";

function findRelease() {
	const i = args.indexOf("--release");
	if (i >= 0 && args[i + 1]) return args[i + 1];
	const base = path.join(process.env.USERPROFILE || process.env.HOME || "", ".pi/agent/install/releases");
	if (!fs.existsSync(base)) return null;
	const versions = fs
		.readdirSync(base)
		.filter((v) => fs.existsSync(path.join(base, v, "node_modules/@earendil-works/pi-coding-agent")));
	if (!versions.length) return null;
	versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
	return path.join(base, versions[versions.length - 1]);
}

const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

const release = findRelease();
if (!release) {
	console.error("pi is not installed under ~/.pi/agent/install/releases - install pi first, or pass --release <dir>");
	process.exit(1);
}
const nm = path.join(release, "node_modules");
const backup = path.join(nm, ".rtl-backup");
const isPatched = fs.existsSync(path.join(nm, "@earendil-works/pi-tui/dist/bidi.js"));

console.log(`release: ${release}`);
console.log(`mode:    ${mode}   (bidi.js present: ${isPatched ? "yes" : "no"})`);

let ok = 0,
	skip = 0,
	fail = 0;

for (const entry of MANIFEST.files) {
	const target = path.join(nm, "@earendil-works", entry.pkg, entry.target);
	const kitFile = path.join(KIT, "installed", entry.source);
	const patchedSha = sha(kitFile);
	const exists = fs.existsSync(target);
	const currentSha = exists ? sha(target) : null;

	if (mode === "revert") {
		const bak = path.join(backup, entry.pkg, entry.target);
		if (!exists) continue;
		if (currentSha === patchedSha) {
			if (fs.existsSync(bak)) {
				fs.copyFileSync(bak, target);
				console.log(`  restored  ${entry.pkg}/${entry.target}`);
				ok++;
			} else {
				fs.rmSync(target);
				console.log(`  removed   ${entry.pkg}/${entry.target} (added by the patch, no backup)`);
				ok++;
			}
		} else {
			console.log(`  left as is ${entry.pkg}/${entry.target} (not our patched build)`);
		}
		continue;
	}

	if (currentSha === patchedSha) {
		console.log(`  already   ${entry.pkg}/${entry.target}`);
		ok++;
		continue;
	}
	if (entry.pristineSha && currentSha !== entry.pristineSha) {
		console.log(`  SKIP      ${entry.pkg}/${entry.target} - this pi build differs from v${MANIFEST.baseVersion} (file changed by upstream or a previous patch)`);
		fail++;
		continue;
	}
	if (mode === "check") {
		console.log(`  would patch ${entry.pkg}/${entry.target}`);
		ok++;
		continue;
	}
	fs.mkdirSync(path.dirname(target), { recursive: true });
	if (exists) {
		fs.mkdirSync(path.join(backup, entry.pkg, path.dirname(entry.target)), { recursive: true });
		fs.copyFileSync(target, path.join(backup, entry.pkg, entry.target));
	}
	fs.copyFileSync(kitFile, target);
	console.log(`  patched   ${entry.pkg}/${entry.target}`);
	ok++;
}

// bidi-js must be resolvable from the patched pi-tui.
const bidiDir = path.join(nm, "bidi-js");
if (mode !== "revert") {
	if (!fs.existsSync(bidiDir)) {
		fs.mkdirSync(bidiDir, { recursive: true });
		for (const rel of MANIFEST.vendored.files) {
			const src = path.join(KIT, "installed/bidi-js", rel);
			if (!fs.existsSync(src)) continue;
			fs.mkdirSync(path.dirname(path.join(bidiDir, rel)), { recursive: true });
			fs.copyFileSync(src, path.join(bidiDir, rel));
		}
		console.log(`  vendored  bidi-js (offline, no npm install needed)`);
	} else {
		console.log(`  already   bidi-js`);
	}
}

console.log(`\n${mode}: ${ok} handled, ${fail} skipped`);

const smokePath = path.join(release, ".rtl-smoke.mjs");
if (mode === "revert") {
	fs.rmSync(smokePath, { force: true });
} else {
	const tui = path.join(nm, "@earendil-works/pi-tui/dist/index.js");
	const probe = `import { pathToFileURL } from "node:url";
const m = await import(pathToFileURL(${JSON.stringify(tui)}.replace(/\\\\/g, "/")).href);
console.log("  reorderLine ->", JSON.stringify(m.reorderLine("١. اختبار الترجمة إلى اليمين")));
`;
	fs.writeFileSync(smokePath, probe);
	if (mode === "apply") {
		console.log("\nsmoke test (running the patched pi-tui):");
		const r = spawnSync(process.execPath, [smokePath], { stdio: "inherit" });
		if (r.status !== 0) {
			console.log("the patched pi-tui did not load - rerun with --check to see what went wrong");
			process.exit(1);
		}
	}
}
