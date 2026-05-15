// validators/stop.mjs
// Blocks Claude from stopping if planning is active and the last assistant message
// is missing the PIPELINE STATUS header. Always respects stop_hook_active to avoid loops.

import { topLevelBlock } from "../lib/diagnostics.mjs";
import { readState, isPlanningActive } from "../lib/state.mjs";

const HEADER_RE = /^=== PIPELINE STATUS ===\nCurrent Phase : .+\nCompleted\s+: .+\nNext Action\s+: .+\nState file\s+: \.planning\/state\/planning-state-v2\.json\n=======================/;
const PREMATURE_PAUSE_RE = /(if\s+you\s+ok|if\s+you'?re\s+ok|nếu\s+bạn\s+ok|đợi\s+bạn\s+xác\s+nhận|pause\s+for\s+confirmation|chờ\s+xác\s+nhận)/i;

export async function validateStop(input, projectDir) {
  // Loop guard: if we already blocked once this turn, bail.
  if (input.stop_hook_active === true) return null;

  const { state, legacy, missing } = await readState(projectDir);
  if (legacy || missing || !state) return null;
  if (!isPlanningActive(state)) return null;

  const msg = typeof input.last_assistant_message === "string" ? input.last_assistant_message : "";
  if (!HEADER_RE.test(msg)) {
    return topLevelBlock(
      `Planning session active (current_phase=${state.current_phase}). ` +
      `Last assistant message is missing the '=== PIPELINE STATUS ===' header. ` +
      `Re-emit the response with the header at the top, showing Current Phase, Completed, Next Action, State file.`,
    );
  }

  if (String(state.current_phase ?? "") === "2" && state.phase_plan_approved !== true && PREMATURE_PAUSE_RE.test(msg)) {
    return topLevelBlock(
      `Planning phase 2 is in progress and should continue directly to Phase 2.5 approval prep. ` +
      `Detected premature confirmation pause language in the last assistant message. ` +
      `Continue by producing approach.md and phase-plan.md, then pause only at the Phase 2.5 AskUserQuestion approval prompt.`,
    );
  }

  if (["3", "4"].includes(String(state.current_phase ?? "")) && state.phase_plan_approved === true && PREMATURE_PAUSE_RE.test(msg)) {
    return topLevelBlock(
      `After Phase 2.5 approval, planning should continue through Phase 3 and Phase 4 in one run. ` +
      `Detected premature confirmation pause language before Phase 4 approval. ` +
      `Continue by producing contracts/phase-<n>-contract.md and story-maps/phase-<n>-story-map.md, then pause only at the Phase 4 whole-set AskUserQuestion approval prompt.`,
    );
  }

  const p4Approval = state.phase_outputs?.["4_approval"];
  const phase4Approved =
    p4Approval &&
    p4Approval.status === "completed" &&
    p4Approval.approved === true &&
    p4Approval.approval_response === "Approve";

  if (["5", "7"].includes(String(state.current_phase ?? "")) && phase4Approved && PREMATURE_PAUSE_RE.test(msg)) {
    return topLevelBlock(
      `After Phase 4 Approve, planning must continue in one run through Phase 5, Phase 7, and Phase 8. ` +
      `Detected premature confirmation pause language before Phase 8 stop gate. ` +
      `Continue by finishing decomposition/validation/execution-plan steps and stop only after Phase 8 state update.`,
    );
  }

  return null;
}
