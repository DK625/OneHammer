// validators/session_start.mjs
// Inject "resume planning" hint whenever a session starts with an active planning state.

import { additionalContext } from "../lib/diagnostics.mjs";
import { readState, isPlanningActive } from "../lib/state.mjs";
import { nextActionHint } from "../lib/phase_gates.mjs";
import { DISCOVERY_CONTRACT_BEGIN } from "../lib/discovery_agent_contract.mjs";

export async function validateSessionStart(input, projectDir) {
  const { state, legacy, missing } = await readState(projectDir);
  if (missing) return null;
  if (legacy) {
    return additionalContext("SessionStart",
      "[planning-guard] Detected legacy planning state (contains 4.5/4.6 markers). " +
      "Phase gates are disabled for this state. Start a new feature to use the v2 pipeline, " +
      "or migrate the state file.",
    );
  }
  if (!state) return null;
  if (!isPlanningActive(state)) return null;

  const phase = String(state.current_phase ?? "");
  const resumeRequirement = phase === "1"
    ? `  resume requirement: derive HISTORY_ROOT from phase_outputs.0.project_index_root, then immediately launch missing/failed/orphaned Phase 1 lanes as background general-purpose agents before broad main-agent context reads. Copy the exact ${DISCOVERY_CONTRACT_BEGIN} block from launch-discovery-agents.md and substitute actual lane/artifact values. Do not pre-mark running; running requires verified launch identity. Identity-less running is orphaned/retryable. Once all four files exist, read them as default context and self-fill only specific gaps.`
    : "  resume requirement: before continuing planning, derive HISTORY_ROOT from phase_outputs.0.project_index_root (fallback normal project root only when no target is selected), then reread the original requirement source and existing planning artifacts needed for the current phase.";

  const lines = [
    "[planning-guard] Planning session in progress — resume context:",
    `  feature: ${state.feature}`,
    `  current_phase: ${state.current_phase}`,
    `  completed: [${(state.completed_phases||[]).join(", ")}]`,
    `  phase_plan_approved: ${state.phase_plan_approved}`,
    resumeRequirement,
    "  execution style: after Phase 1.5 reaches 12/12, continue into Phase 1.6 for 8/8 test clarification, then continue in one run through Phase 2 into Phase 2.5; if Phase 2.5 is approved, continue in one run through Phase 3 and Phase 4, pause only at the Phase 4 approval AskUserQuestion, and after exact Approve continue immediately in one run through Phase 5 and Phase 7, then stop planning on READY/READY_LITE/READY_TARGETED.",
    `  next action: ${nextActionHint(state)}`,
    "Every response MUST begin with '=== PIPELINE STATUS ===' header (see skill(planning)).",
  ];
  return additionalContext("SessionStart", lines.join("\n"));
}
