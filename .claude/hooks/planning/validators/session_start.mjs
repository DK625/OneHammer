// validators/session_start.mjs
// Inject "resume planning" hint whenever a session starts with an active planning state.

import { additionalContext } from "../lib/diagnostics.mjs";
import { readState, isPlanningActive } from "../lib/state.mjs";
import { nextActionHint } from "../lib/phase_gates.mjs";

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

  const lines = [
    "[planning-guard] Planning session in progress — resume context:",
    `  feature: ${state.feature}`,
    `  current_phase: ${state.current_phase}`,
    `  completed: [${(state.completed_phases||[]).join(", ")}]`,
    `  phase_plan_approved: ${state.phase_plan_approved}`,
    "  resume requirement: before continuing planning, reread the original requirement source and all existing artifacts under history/<feature>/ (discovery lanes, discovery.md, requirements.md, approach.md, phase-plan.md, contracts/story maps, test scenarios, execution plan, PLANNING_STATUS.md if present).",
    "  execution style: after Phase 1.5 reaches 12/12, continue into Phase 1.6 for 8/8 test clarification, then continue in one run through Phase 2 into Phase 2.5; if Phase 2.5 is approved, continue in one run through Phase 3 and Phase 4, pause only at the Phase 4 approval AskUserQuestion, and after exact Approve continue immediately in one run through Phase 5, Phase 7, and Phase 8.",
    `  next action: ${nextActionHint(state)}`,
    "Every response MUST begin with '=== PIPELINE STATUS ===' header (see skill(planning)).",
  ];
  return additionalContext("SessionStart", lines.join("\n"));
}
