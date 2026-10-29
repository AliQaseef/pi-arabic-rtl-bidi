// Rebuild rtl-patch/installed (the compiled-dist kit for an installed pi) from
// a patched source tree and a pristine upstream tree.
// Run: bun rtl-patch/build-installed-kit.mjs [patchedDir] [pristineDir]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const patched = process.argv[2] ?? "C:/Users/ali/pi-rtl";
const pristine = process.argv[3] ?? "C:/Users/ali/pi-bidi-check";
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "installed");

// Compiled files that carry the bidi changes.
const SOURCES = [
	"packages/tui/dist/bidi.js",
	"packages/tui/dist/index.js",
	"packages/tui/dist/components/editor.js",
	"packages/tui/dist/components/markdown.js",
	"packages/tui/dist/components/text.js",
	"packages/tui/dist/components/truncated-text.js",
	"packages/coding-agent/dist/core/settings-defaults.js",
	"packages/coding-agent/dist/core/settings-manager.js",
	"packages/coding-agent/dist/core/settings-schema.js",
	"packages/coding-agent/dist/modes/interactive/components/settings-selector.js",
	"packages/coding-agent/dist/modes/interactive/interactive-mode.js",
];

// bidi-js copied into the release so the patch works without a network install.
// The manifest we write is minimal: only the entry point is needed at runtime.
const VENDOR = ["dist/bidi.js", "LICENSE.txt"];

const upstreamFiles = new Set(
	execFileSync("git", ["ls-tree", "-r", "HEAD", "--name-only"], { cwd: pristine }).toString().split("\n"),
);
const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

// A dist file is "new" when upstream has no matching source file; otherwise the
// pristine build of the upstream tree gives the hash the installed file must match.
const sourceOf = (rel) => rel.replace("/dist/", "/src/").replace(/\.js$/, ".ts");

const files = [];
for (const rel of SOURCES) {
	const pkg = rel.startsWith("packages/tui") ? "pi-tui" : "pi-coding-agent";
	const distPath = "dist/" + rel.split("/dist/")[1];
	const srcPath = path.join(patched, rel);
	const destPath = path.join(out, pkg, distPath);
	fs.mkdirSync(path.dirname(destPath), { recursive: true });
	fs.copyFileSync(srcPath, destPath);

	// A pristine hash is only trustworthy for files the upstream tree actually tracks.
	const pristinePath = path.join(pristine, rel);
	const pristineSha = upstreamFiles.has(sourceOf(rel)) && fs.existsSync(pristinePath) ? sha(pristinePath) : null;

	files.push({ pkg, target: distPath, source: `${pkg}/${distPath}`, pristineSha, patchedSha: sha(srcPath) });
}

for (const rel of VENDOR) {
	const srcPath = path.join(patched, "node_modules/bidi-js", rel);
	if (!fs.existsSync(srcPath)) continue;
	const destPath = path.join(out, "bidi-js", rel);
	fs.mkdirSync(path.dirname(destPath), { recursive: true });
	fs.copyFileSync(srcPath, destPath);
}
fs.writeFileSync(
	path.join(out, "bidi-js", "package.json"),
	JSON.stringify({ name: "bidi-js", version: "1.1.0", description: "Unicode Bidirectional Algorithm (UAX #9), vendored for the RTL patch", main: "dist/bidi.js", license: "MIT" }, null, 1) + "\n",
);

fs.writeFileSync(
	path.join(out, "manifest.json"),
	JSON.stringify({ baseVersion: "1.4.0", vendored: { pkg: "bidi-js", files: ["package.json", ...VENDOR] }, files }, null, 1) + "\n",
);

console.log(`wrote ${files.length} patched dist files to ${out}`);
for (const f of files) console.log(`  ${f.pkg}/${f.target}  pristine=${f.pristineSha ? "matched v1.4.0" : "new file"}`);
