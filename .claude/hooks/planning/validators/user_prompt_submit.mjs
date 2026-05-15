// validators/user_prompt_submit.mjs
// Non-blocking: injects additionalContext when the user's prompt smells like planning.

import { additionalContext } from "../lib/diagnostics.mjs";
import { readState, isPlanningActive } from "../lib/state.mjs";
import { nextActionHint } from "../lib/phase_gates.mjs";

const PLANNING_INTENT_RE = /(kế hoạch|lên kế hoạch|plan(?:ning)?\b|migration plan|design the implementation|roadmap|feature plan|plan a feature|plan the|how (?:would|should) we implement|implementation strategy|step-by-step implementation|tính năng mới|design (?:an? )?(?:new )?feature)/i;

export async function validateUserPromptSubmit(input, projectDir) {
  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  const looksPlanning = PLANNING_INTENT_RE.test(prompt);

  const { state, legacy, missing } = await readState(projectDir);
  const active = !legacy && !missing && isPlanningActive(state);

  if (!looksPlanning && !active) return null;

  const lines = ["[planning-guard]"];
  if (looksPlanning) {
    lines.push(
      "This prompt looks like a planning request. Invoke skill `planning` — it enforces the multi-gate pipeline (Phase 0..8 + approvals at 2.5 and 4).",
    );
  }
  if (active) {
    lines.push(
      `Planning state is ACTIVE. feature=${state.feature} current_phase=${state.current_phase} completed=[${(state.completed_phases||[]).join(",")}] phase_plan_approved=${state.phase_plan_approved}.`,
      "Resume requirement: if planning was interrupted/unfinished, do not skip prior context — reread the requirement source and all generated planning artifacts under history/<feature>/ before asking new questions or producing new outputs.",
      "Execution style: after Phase 1.5 reaches 12/12, continue into Phase 1.6 for 8/8 test clarification, then continue in one run through Phase 2 into Phase 2.5; if Phase 2.5 is approved, continue in one run through Phase 3 and Phase 4, pause only at the Phase 4 approval AskUserQuestion, and after exact Approve continue immediately in one run through Phase 5, Phase 7, and Phase 8.",
      `Next action: ${nextActionHint(state)}`,
      `Begin every response with the '=== PIPELINE STATUS ===' header.`,
    );
  }
  const text = lines.join("\n");
  return additionalContext("UserPromptSubmit", text);
}
