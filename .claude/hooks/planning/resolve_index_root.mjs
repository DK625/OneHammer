#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  IndexRootResolutionError,
  resolveIndexRoot,
} from "./lib/index_root_resolver.mjs";

function usage() {
  return [
    "Usage:",
    "  node .claude/hooks/planning/resolve_index_root.mjs --source <path> [--source <path> ...]",
    "  node .claude/hooks/planning/resolve_index_root.mjs --target-root <directory>",
    "",
    "Options:",
    "  --control-root <directory>   Claude control/workspace root (default: CLAUDE_PROJECT_DIR or script root)",
    "  --pwd <directory>            Resolution cwd for relative paths (default: process.cwd())",
    "  --state <file>               Planning state JSON path (default: <control>/.planning/state/planning-state-v2.json)",
    "  --no-pwd-fallback            Disable final pwd repository fallback",
  ].join("\n");
}

function parseArgs(argv) {
  const out = {
    explicitTargetRoots: [],
    sourcePaths: [],
    allowPwdFallback: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--no-pwd-fallback") {
      out.allowPwdFallback = false;
      continue;
    }
    const valueFlags = new Set(["--target-root", "--source", "--control-root", "--pwd", "--state"]);
    if (!valueFlags.has(arg)) throw new Error(`Unknown argument: ${arg}`);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    i += 1;
    if (arg === "--target-root") out.explicitTargetRoots.push(value);
    if (arg === "--source") out.sourcePaths.push(value);
    if (arg === "--control-root") out.controlRoot = value;
    if (arg === "--pwd") out.pwd = value;
    if (arg === "--state") out.statePath = value;
  }
  return out;
}

function defaultControlRoot() {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "../../..");
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  args.controlRoot ||= defaultControlRoot();
  args.pwd ||= process.cwd();
  const result = await resolveIndexRoot(args);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  const payload = error instanceof IndexRootResolutionError
    ? { ok: false, error: error.code, message: error.message, details: error.details }
    : { ok: false, error: "RESOLVER_ERROR", message: error.message };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(2);
}
