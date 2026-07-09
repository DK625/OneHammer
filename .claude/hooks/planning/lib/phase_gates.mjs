// phase_gates.mjs — Phase ordering helpers + gate matrix queries.

export const PHASE_SEQUENCE = [
  "0", "1", "1.5", "1.6", "2", "2.5", "3", "4", "5", "7",
];

// Return index in canonical sequence; -1 if unknown.
export function phaseIndex(phaseId) {
  if (phaseId == null) return -1;
  return PHASE_SEQUENCE.indexOf(String(phaseId));
}

// True if state has reached or passed `phaseId` (via current_phase or completed_phases).
export function hasReached(state, phaseId) {
  if (!state) return false;
  const target = phaseIndex(phaseId);
  if (target < 0) return false;
  const cur = phaseIndex(state.current_phase);
  if (cur >= target) return true;
  if (!Array.isArray(state.completed_phases)) return false;
  return state.completed_phases.some((p) => phaseIndex(p) >= target);
}

// True if numeric current phase is >= N.
export function currentPhaseAtLeast(state, nStr) {
  const cur = phaseIndex(state?.current_phase);
  const target = phaseIndex(nStr);
  return cur >= 0 && target >= 0 && cur >= target;
}

export function nextActionHint(state) {
  if (!state) return "Begin Phase 0 (pre-flight).";
  const cp = state.current_phase;
  if (!cp) return "State uninitialized — run Phase 0 pre-flight and set current_phase='0'.";
  switch (String(cp)) {
    case "0": return "Keep pre-flight bounded: resolve target with the existing resolver, run bash index.sh, verify required tools/dependencies and target-scoped history/<feature>/, collect terminal success, then immediately enter Phase 1.";
    case "1": return "Immediately launch missing/failed/orphaned subagent lanes (Patterns, Constraints, External) as background general-purpose agents using the canonical versioned prompt block, and produce 1-architecture.md directly in the main agent with GitNexus (never spawn an Architecture subagent); do not pre-mark running, and treat identity-less running as orphaned/retryable. Then read/verify the four canonical files, fill only specific gaps, and compile discovery.md.";
    case "1.5": return "Resume by rereading the requirement source plus all existing planning artifacts first, then ask 12 PO-style business questions via AskUserQuestion in 3 rounds of 4 (each question with >=2 selectable options).";
    case "1.6": return "Using clarified business context from Phase 1.5, ask 8 test-clarification questions via AskUserQuestion in 2 rounds of 4 (each question with >=2 selectable options), including feature mode (fullstack/fe-only/be-only) and FE screenshot checkpoint selection (before/after important action + final) for FE-involving modes, then write test-scenarios.md before Phase 2.";
    case "2": return "Synthesize approach.md, then continue directly to Phase 2.5 (write phase-plan.md) and stop only at the Phase 2.5 approval AskUserQuestion.";
    case "2.5": return "Ask Phase 2.5 approval. If approved, continue in one run through Phase 3 and Phase 4, pause only at the Phase 4 approval AskUserQuestion, then after Approve continue directly through Phase 5 and Phase 7.";
    case "3": return "Write phase contracts/story-maps to cover all phases declared in phase-plan.md, then continue directly to Phase 4 without extra confirmation pauses.";
    case "4": return "Ask Phase 4 approval only after contract+story-map artifacts exist for every phase declared in phase-plan.md; after Approve continue immediately to Phase 5 without extra pause.";
    case "5": return "Create beads via `br create` for all phases declared in phase-plan.md; each bead must include technical contract details (API + DB/config source-of-truth), evidence clauses matching that bead's surface (FE: `agent-browser` E2E only when UI/browser applies, BE: real API-call evidence when API/DB/runtime applies), and test-session budget/split policy (if >1 session, create follow-up test bead and chain with br dep add), complete Story-To-Bead Mapping coverage in every phase story-map, then continue directly to Phase 7 without extra confirmation pause.";
    case "7": return "Run bv --robot-insights (cycles must be []), run mode-based semantic validation, and stop planning with the validated bead graph/state when verdict is READY/READY_LITE/READY_TARGETED.";
    case "handoff": return "Hand off to skill(orchestrator).";
    default: return `Resume phase ${cp}.`;
  }
}
