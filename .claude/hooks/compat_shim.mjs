#!/usr/bin/env node
// compat_shim.mjs — TEMPORARY model-compatibility shim (PreToolUse).
//
// WHY THIS EXISTS
//   Some backend models used through Anthropic-compatible proxies (verified:
//   MiniMax-M3 via the `claude-minimax` alias, 2026-07-11) habitually fill
//   optional tool params with invalid values. Example: Read with pages:"" hard-
//   fails validation, and the model then loops forever re-emitting the same
//   failing call (self-conditioning). This shim strips ONLY clearly-invalid
//   optional params before the tool runs. It never blocks a call and never
//   touches params whose value could be meaningful (e.g. Write content:"").
//
// THIS IS A WORKAROUND, NOT A FEATURE — PLAN FOR ITS REMOVAL
//   Every rule carries `reviewAfter` + `removeWhen`. Every strip is appended to
//   the hit log below. Removal decision is data-driven, not memory-driven:
//
//     hit log : ~/.claude/compat-shim/hits.jsonl
//     check   : jq -r '[.ts, .rule] | @tsv' ~/.claude/compat-shim/hits.jsonl | sort | tail
//     rule of thumb: no hits for ~30 days => delete the rule;
//                    no rules left        => delete this file + its settings.json entry.
//
//   When a rule fires past its reviewAfter date, the shim prints a loud stderr
//   reminder instead of silently continuing. It deliberately does NOT auto-
//   disable on expiry: if the backend model still needs it, turning off would
//   bring the infinite-retry loops back. Expiry makes it louder, never off.
//
// Registered in .claude/settings.json under PreToolUse (matcher "Read").
// If you add a rule for another tool, extend that matcher too.

import { readFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const HIT_LOG_DIR = join(homedir(), ".claude", "compat-shim");
const HIT_LOG = join(HIT_LOG_DIR, "hits.jsonl");

// Valid Read.pages forms per the tool: "3" or "1-5" (1-indexed, PDF-only).
const VALID_PAGES_RE = /^\s*\d+\s*(-\s*\d+\s*)?$/;

const RULES = [
  {
    id: "read-pages-invalid",
    tool: "Read",
    addedAt: "2026-07-11",
    evidence: "MiniMax-M3 emitted pages:\"\" on every Read; hard validation error; infinite Phase 0 retry loop in the grok-xai-stt planning session.",
    reviewAfter: "2026-10-01",
    removeWhen: "Planning/work sessions no longer run on models that emit invalid `pages` (check hit log for ~30 quiet days).",
    applies(input) {
      if (!("pages" in input)) return false;
      const v = input.pages;
      // A valid string like "1" or "2-5" is accepted (and ignored) by Read on
      // non-PDF files — harmless, leave it alone. Only strip what would fail.
      return typeof v !== "string" || !VALID_PAGES_RE.test(v);
    },
    fix(input) {
      const { pages, ...rest } = input;
      return rest;
    },
  },
];

function logHit(rule, input, sessionId) {
  try {
    mkdirSync(HIT_LOG_DIR, { recursive: true });
    appendFileSync(HIT_LOG, JSON.stringify({
      ts: new Date().toISOString(),
      rule: rule.id,
      tool: rule.tool,
      session_id: sessionId ?? null,
      stripped: { pages: input.pages ?? null },
    }) + "\n");
  } catch {
    // Best-effort telemetry only — never break the tool call over it.
  }
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return; // Unparseable input — pass through.
  }

  const toolName = payload.tool_name;
  const toolInput = payload.tool_input;
  if (!toolName || !toolInput || typeof toolInput !== "object") return;

  const rule = RULES.find((r) => r.tool === toolName && r.applies(toolInput));
  if (!rule) return; // Nothing to fix — normal permission flow continues.

  logHit(rule, toolInput, payload.session_id);

  const expired = new Date() > new Date(`${rule.reviewAfter}T00:00:00Z`);
  const note = expired
    ? ` NOTE: this rule is past its review date (${rule.reviewAfter}) and still firing — the backend model still needs it; re-evaluate or extend reviewAfter in compat_shim.mjs.`
    : "";
  process.stderr.write(
    `[compat-shim] ${rule.id}: stripped invalid optional param from ${toolName} call ` +
    `(value ${JSON.stringify(toolInput.pages)}).${note}\n`,
  );

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: `compat-shim ${rule.id}: removed invalid optional param that would hard-fail tool validation`,
      updatedInput: rule.fix(toolInput),
    },
  }) + "\n");
}

main();
