// Rebuild rtl-patch/installed (the compiled-dist kit for an installed pi) from a
// patched source tree and a pristine upstream tree.
// Run: node rtl-patch/build-installed-kit.mjs [patchedDir] [pristineDir]
//   --installed-pristine <dir>  use an installed pi release (the node_modules folder
//       holding pi-tui and pi-coding-agent) as the pristine reference instead of a
//       built upstream checkout. With no pristine reference the manifest records no
//       pristine hash, so apply-to-installed.mjs cannot tell a stock file from one
//       that is already patched.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(scriptDir, "..");

// The patched tree is this repository after `npm --prefix packages/tui run build`;
// the pristine tree is either an upstream checkout of the base release built the same
// way, or an installed pi release passed with --installed-pristine.
const patched = process.argv[2] ?? process.env.PI_RTL_PATCHED_DIR ?? repo;
const pristine = process.argv[3] ?? process.env.PI_RTL_PRISTINE_DIR ?? path.join(repo, ".scratch", "upstream-check");
const installedFlag = process.argv.indexOf("--installed-pristine");
const installedPristine = installedFlag >= 0 ? process.argv[installedFlag + 1] : undefined;
const out = path.join(scriptDir, "installed");

// The release the kit is built for. Keep it in sync with the manifest the kit carries.
let baseVersion = "1.4.0";
try {
	baseVersion = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8")).baseVersion ?? baseVersion;
} catch {
	/* no manifest yet - the default is kept */
}

// The compiled files the kit must carry are every source file the patch touches,
// mapped to its build output - so the list is derived from the patch, not typed out.
const patchText = fs.readFileSync(path.join(scriptDir, "pi-rtl-bidi.patch"), "utf8");
const SOURCES = [...new Set(
	patchText
		.split("\n")
		.filter((line) => line.startsWith("diff --git a/"))
		.map((line) => line.split(" ")[2].slice(2))
		.filter((p) => p.startsWith("packages/") && p.includes("/src/") && p.endsWith(".ts"))
		.map((p) => p.replace("/src/", "/dist/").replace(/\.ts$/, ".js")),
)];

// The shipped `pi` bin is a bundle that inlines pi-tui and the settings wiring,
// so patching dist/*.js is invisible there. The bundle's runtime entry is
// replaced with one that runs the plain dist, where the patched files load.
const BUNDLE_ENTRY_TARGET = "dist/bundle/cli-runtime.js";
const BUNDLE_ENTRY_SOURCE = [
	'#!/usr/bin/env node',
	"// RTL patch entry point: the bundle inlines pi-tui and the settings wiring,",
	"// so the patch is applied to the plain dist. Run that dist instead.",
	'import { enableCompileCache } from "node:module";',
	"enableCompileCache();",
	'import { setupCli } from "../cli/setup.js";',
	'import { main } from "../main.js";',
	"setupCli();",
	"main(process.argv.slice(2));",
].join("\n") + "\n";

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
	const srcPath = path.join(patched, rel);
	if (!fs.existsSync(srcPath)) {
		console.error(
			`no built file at ${srcPath} - build first: npm --prefix packages/tui run build && npm --prefix packages/coding-agent run build:unbundled`,
		);
		process.exit(1);
	}
	const pkg = rel.startsWith("packages/tui") ? "pi-tui" : "pi-coding-agent";
	const distPath = "dist/" + rel.split("/dist/")[1];
	const destPath = path.join(out, pkg, distPath);
	fs.mkdirSync(path.dirname(destPath), { recursive: true });
	fs.copyFileSync(srcPath, destPath);
	// With an installed release as the reference, the file on disk is the stock file.
	// With an upstream checkout, the hash is only trustworthy once that tree is built.
	const pristinePath = installedPristine ? path.join(installedPristine, pkg, distPath) : path.join(pristine, rel);
	const pristineSha = fs.existsSync(pristinePath) ? sha(pristinePath) : null;

	files.push({
		pkg,
		target: distPath,
		source: `${pkg}/${distPath}`,
		pristineSha,
		patchedSha: sha(srcPath),
		added: !upstreamFiles.has(sourceOf(rel)),
	});
}

const bundleEntryPath = path.join(out, "pi-coding-agent", BUNDLE_ENTRY_TARGET);
fs.mkdirSync(path.dirname(bundleEntryPath), { recursive: true });
fs.writeFileSync(bundleEntryPath, BUNDLE_ENTRY_SOURCE);
files.push({
	pkg: "pi-coding-agent",
	target: BUNDLE_ENTRY_TARGET,
	source: `pi-coding-agent/${BUNDLE_ENTRY_TARGET}`,
	pristineSha: null,
	patchedSha: sha(bundleEntryPath),
	// The file exists upstream; only its content is replaced, so --revert restores
	// the backup rather than deleting it.
	added: false,
});

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
	JSON.stringify({ baseVersion, vendored: { pkg: "bidi-js", files: ["package.json", ...VENDOR] }, files }, null, 1) + "\n",
);

// The manifest is only useful if the kit on disk really matches it.
const mismatch = files.filter((f) => sha(path.join(out, f.pkg, f.target)) !== f.patchedSha);
if (mismatch.length) {
	console.error(`kit does not match its manifest: ${mismatch.map((f) => `${f.pkg}/${f.target}`).join(", ")}`);
	process.exit(1);
}

console.log(`wrote ${files.length} patched dist files to ${out}`);

// A file with no pristine hash cannot be told apart from a file the patch already
// changed, so say so instead of letting the apply step guess.
const withoutReference = files.filter((f) => !f.pristineSha && !f.added);
if (withoutReference.length) {
	console.warn(
		`no pristine reference for ${withoutReference.length} file(s) (${withoutReference.map((f) => `${f.pkg}/${f.target}`).join(", ")}) - ` +
			"pass --installed-pristine <node_modules/@earendil-works> or build the upstream checkout to record stock hashes",
	);
}
for (const f of files) console.log(`  ${f.pkg}/${f.target}  pristine=${f.pristineSha ? `matched v${baseVersion}` : "new file"}`);
