#!/usr/bin/env node
// planning_guard.mjs — single entry point for planning hook validation.
//
// Reads JSON from stdin, dispatches to the validator matching `hook_event_name`,
// and writes the decision (if any) as JSON to stdout. Always exits 0 unless a
// fatal internal error occurs (exit 1, to avoid surprising blocks).
//
// Escape hatches:
//   PLANNING_GUARD_BYPASS=1  — immediately exit 0 with no output.
//   PLANNING_GUARD_DEBUG=1   — emit stderr debug lines.
//
// Safety defaults:
//   * state file missing         → bail out (not active planning).
//   * state schema invalid       → warn on stderr, DO NOT block.
//   * legacy state (4.5/4.6)     → bail out (phase gates disabled).
//   * any internal validator err → warn on stderr, DO NOT block.

import { validatePreToolUse } from "./planning/validators/pre_tool_use.mjs";
import { validatePostToolUse } from "./planning/validators/post_tool_use.mjs";
import { validatePostToolBatch } from "./planning/validators/post_tool_batch.mjs";
import { validateStop } from "./planning/validators/stop.mjs";
import { validateUserPromptSubmit } from "./planning/validators/user_prompt_submit.mjs";
import { validateSessionStart } from "./planning/validators/session_start.mjs";
import { warn, debug } from "./planning/lib/diagnostics.mjs";

const TIMEOUT_SOFT_MS = 10_000;

// Escape hatch: bypass everything.
if (process.env.PLANNING_GUARD_BYPASS === "1") {
  process.exit(0);
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let buf = "";
    let timedOut = false;
    const to = setTimeout(() => {
      timedOut = true;
      resolve(buf);
    }, TIMEOUT_SOFT_MS);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => { buf += c; });
    process.stdin.on("end", () => {
      clearTimeout(to);
      if (!timedOut) resolve(buf);
    });
    process.stdin.on("error", reject);
  });
}

function projectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

async function main() {
  const started = Date.now();
  let raw;
  try {
    raw = await readStdin();
  } catch (e) {
    warn(`stdin read failed: ${e.message}`);
    process.exit(0);
  }

  let input;
  try {
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch (e) {
    warn(`stdin not JSON, skipping guard: ${e.message}`);
    process.exit(0);
  }

  const event = input.hook_event_name;
  debug(`event=${event} tool=${input.tool_name ?? "-"}`);

  let decision = null;
  try {
    const dir = projectDir();
    switch (event) {
      case "PreToolUse":
        decision = await validatePreToolUse(input, dir);
        break;
      case "PostToolUse":
      case "PostToolUseFailure":
        decision = await validatePostToolUse(input, dir);
        break;
      case "PostToolBatch":
        decision = await validatePostToolBatch(input, dir);
        break;
      case "Stop":
      case "SubagentStop":
        decision = await validateStop(input, dir);
        break;
      case "UserPromptSubmit":
        decision = await validateUserPromptSubmit(input, dir);
        break;
      case "SessionStart":
        decision = await validateSessionStart(input, dir);
        break;
      default:
        debug(`no validator for event '${event}', passing through`);
        break;
    }
  } catch (e) {
    warn(`validator threw: ${e.stack || e.message}`);
    decision = null;
  }

  const elapsed = Date.now() - started;
  if (elapsed > TIMEOUT_SOFT_MS) {
    warn(`validator exceeded soft timeout: ${elapsed}ms (event=${event})`);
  }

  if (decision) {
    process.stdout.write(JSON.stringify(decision));
  }
  process.exit(0);
}

main().catch((e) => {
  warn(`fatal: ${e.stack || e.message}`);
  // Fatal internal error — exit 1 but do not print any decision.
  process.exit(1);
});
