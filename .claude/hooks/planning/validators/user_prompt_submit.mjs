// validators/user_prompt_submit.mjs
// Non-blocking: injects additionalContext when the user's prompt smells like planning.
// For an explicit /planning invocation, attempt to start repo indexing immediately
// before normal planning work; Phase 0 stays bounded to health checks/evidence.

import { additionalContext } from "../lib/diagnostics.mjs";
import { startEarlyIndexFromPrompt } from "../lib/early_index.mjs";
import { readState, isPlanningActive } from "../lib/state.mjs";
import { nextActionHint } from "../lib/phase_gates.mjs";
import { DISCOVERY_CONTRACT_BEGIN } from "../lib/discovery_agent_contract.mjs";

const PLANNING_INTENT_RE = /(kế hoạch|lên kế hoạch|plan(?:ning)?\b|migration plan|design the implementation|roadmap|feature plan|plan a feature|plan the|how (?:would|should) we implement|implementation strategy|step-by-step implementation|tính năng mới|design (?:an? )?(?:new )?feature)/i;

export async function validateUserPromptSubmit(input, projectDir) {
  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  const looksPlanning = PLANNING_INTENT_RE.test(prompt);

  // Critical ordering: try to launch the /planning index job before readState() and
  // before Claude starts broad requirement/code/project-doc reads. The helper only
  // auto-starts for an explicit slash-command invocation and fails closed on unsafe
  // target resolution.
  const earlyIndex = await startEarlyIndexFromPrompt({ prompt, projectDir });

  const { state, legacy, missing } = await readState(projectDir);
  const active = !legacy && !missing && isPlanningActive(state);

  if (!looksPlanning && !active && earlyIndex.status === "not_applicable") return null;

  const lines = ["[planning-guard]"];
  if (looksPlanning) {
    lines.push(
      "This prompt looks like a planning request. Invoke skill `planning` — it enforces the canonical pipeline through Phase 7 with approvals at 2.5 and 4.",
    );
  }

  if (earlyIndex.status === "started") {
    lines.push(
      "EARLY PHASE 0 INDEX: a background repo-index job was started before normal planning context reads. Do not launch a duplicate job for this target.",
      `  job_id: ${earlyIndex.jobId}`,
      `  target_root: ${earlyIndex.targetRoot}`,
      `  root_source: ${earlyIndex.rootSource}`,
      `  anchor_path: ${earlyIndex.anchorPath}`,
      "Keep Phase 0 bounded while indexing runs: perform required MCP/CLI health checks, target-scoped workspace setup, and minimal state evidence only. Do not broad-read requirement/code/project docs.",
      `Before Phase 0 can complete, run: bash "$CLAUDE_PROJECT_DIR/.claude/hooks/planning/index.sh" --wait --job "${earlyIndex.jobId}"`,
      "Background job lifecycle metadata is authoritative only in .planning/state/planning-state-v2.json under phase_outputs.0.project_index_jobs; preserve that record when writing final Phase 0 evidence. Do not create or consult .planning/index-jobs/<job-id>/ files.",
      "FAIL-CLOSED: if that wait command exits non-zero, stop the planning pipeline immediately, report the indexing error, and do not mark Phase 0 completed or continue to discovery.",
      `After a successful wait and health checks, record Phase 0 evidence, set current_phase=1, and immediately spawn the External discovery lane as a background general-purpose agent — exactly one Agent call in its own message — using the exact ${DISCOVERY_CONTRACT_BEGIN} block from launch-discovery-agents.md; then run the Architecture, Patterns, and Constraints lanes in the main agent itself with GitNexus/Serena and write 1-architecture.md, 2-patterns.md, and 3-constraints.md directly — never spawn subagents for them. Do not pre-mark the External lane running; record running only after accepted launch with verified identity.`,
    );
  } else if (earlyIndex.status === "failed") {
    lines.push(
      `EARLY PHASE 0 INDEX START FAILED at ${earlyIndex.stage}: ${earlyIndex.error}`,
      earlyIndex.stderr ? `  stderr: ${earlyIndex.stderr}` : "",
      "FAIL-CLOSED: stop the planning pipeline and report this indexing-start error. Do not continue context reads or discovery as though Phase 0 were healthy.",
    );
  } else if (earlyIndex.status === "not_started") {
    lines.push(
      `EARLY PHASE 0 INDEX was not started safely: ${earlyIndex.error}`,
      "Before broad requirement/code/project-doc reads, resolve the target immediately with resolve_index_root.mjs and start bash index.sh --target <resolved-root> --background (always invoke via bash; the script is tracked without an executable bit). Keep Phase 0 bounded to health checks/evidence. On ambiguity/conflict, stop and request an explicit target path instead of falling back to a broad parent root.",
    );
  }

  if (active) {
    const activePhase = String(state.current_phase ?? "");
    const resumeLine = activePhase === "1"
      ? `Resume requirement for Phase 1: derive HISTORY_ROOT from Phase 0 state and launch a missing/failed/orphaned External lane as a background general-purpose agent (exactly one Agent call in its own message). Copy the exact ${DISCOVERY_CONTRACT_BEGIN} block from launch-discovery-agents.md. Produce any missing 1-architecture.md / 2-patterns.md / 3-constraints.md directly in the main agent with GitNexus/Serena instead of spawning subagents. Do not pre-mark running; running without verified launch identity is orphaned/retryable. After all four files exist, read them as default context and fill only specific gaps.`
      : "Resume requirement: if planning was interrupted/unfinished, derive HISTORY_ROOT from the selected target repo in Phase 0 state (fallback normal project root only when no target exists), then reread the requirement source and existing planning artifacts needed for the current phase before asking new questions or producing new outputs.";
    lines.push(
      `Planning state is ACTIVE. feature=${state.feature} current_phase=${state.current_phase} completed=[${(state.completed_phases||[]).join(",")}] phase_plan_approved=${state.phase_plan_approved}.`,
      resumeLine,
      "Execution style: after Phase 1.5 reaches 12/12, continue into Phase 1.6 for 8/8 test clarification, then continue in one run through Phase 2 into Phase 2.5; if Phase 2.5 is approved, continue in one run through Phase 3 and Phase 4, pause only at the Phase 4 approval AskUserQuestion, and after exact Approve continue immediately in one run through Phase 5 and Phase 7, then stop planning on READY/READY_LITE/READY_TARGETED.",
      `Next action: ${nextActionHint(state)}`,
      `Begin every response with the '=== PIPELINE STATUS ===' header.`,
    );
  }
  const text = lines.filter(Boolean).join("\n");
  return additionalContext("UserPromptSubmit", text);
}
