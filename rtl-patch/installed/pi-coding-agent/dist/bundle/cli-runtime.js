#!/usr/bin/env node
// RTL patch entry point: the bundle inlines pi-tui and the settings wiring,
// so the patch is applied to the plain dist. Run that dist instead.
import { enableCompileCache } from "node:module";
enableCompileCache();
import { setupCli } from "../cli/setup.js";
import { main } from "../main.js";
setupCli();
main(process.argv.slice(2));
