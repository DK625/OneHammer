// phase_gates.mjs — Phase ordering helpers + gate matrix queries.

export const PHASE_SEQUENCE = [
  "0", "1", "1.5", "1.6", "2", "2.5", "3", "4", "5", "6",
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
    case "0": return "Keep pre-flight bounded: resolve target with the existing resolver, run bash index.sh, verify required tools/dependencies and target-scoped .planning/history/<feature>/, collect terminal success, then immediately enter Phase 1.";
    case "1": return "Launch a missing/failed/orphaned External lane first as a background general-purpose agent (one Agent call in its own message, canonical versioned prompt block), then produce 1-architecture.md, 2-patterns.md, and 3-constraints.md directly in the main agent with GitNexus/Serena (never spawn subagents for those lanes); do not pre-mark running, and treat identity-less running as orphaned/retryable. Then read/verify the four canonical files, fill only specific gaps, and compile discovery.md.";
    case "1.5": return "Resume by rereading the requirement source plus all existing planning artifacts first, then ask 12 PO-style business questions via AskUserQuestion in 3 rounds of 4 (each question with >=2 selectable options), asked in Vietnamese with the recommended option first (label suffix ' (Khuyến nghị)').";
    case "1.6": return "Using clarified business context from Phase 1.5, ask 8 test-clarification questions via AskUserQuestion in 2 rounds of 4 (each question with >=2 selectable options), asked in Vietnamese with the recommended option first (label suffix ' (Khuyến nghị)'), including feature mode (fullstack/fe-only/be-only) and FE screenshot checkpoint selection (before/after important action + final) for FE-involving modes, then write test-scenarios.md before Phase 2.";
    case "2": return "Synthesize approach.md, then continue directly to Phase 2.5: write phase-plan.md, set phase_plan_approved=true (auto-approved, no AskUserQuestion), and continue into Phase 3 without pausing.";
    case "2.5": return "Phase 2.5 is auto-approved: with phase-plan.md written, record phase_plan_approved=true and phase_outputs.\"2.5\" completion, then continue in one run through Phase 3 and Phase 4, pause only at the Phase 4 approval AskUserQuestion, then after Approve continue directly through Phase 5 and Phase 6.";
    case "3": return "Write phase contracts/story-maps to cover all phases declared in phase-plan.md, then continue directly to Phase 4 without extra confirmation pauses.";
    case "4": return "Ask Phase 4 approval only after contract+story-map artifacts exist for every phase declared in phase-plan.md; after Approve continue immediately to Phase 5 without extra pause.";
    case "5": return "Materialize beads deterministically: ensure every declared story-map has a complete Bead Specs JSON block (each bead with title, labels, priority, depends_on, and full clause-bearing description), then run `node .claude/hooks/planning/materialize_beads.mjs --feature <feature>` which creates beads via br, adds dependencies, writes real IDs back into Story-To-Bead Mapping, and writes beads-manifest.json; then continue directly to Phase 6 without extra confirmation pause.";
    case "6": return "Run bv --robot-insights (cycles must be []), verify the materialize manifest and story-map bead coverage, then atomically record terminal Phase 6 state (cycles_found=0, planning_active=false) and stop planning.";
    case "handoff": return "Hand off to skill(orchestrator).";
    default: return `Resume phase ${cp}.`;
  }
}
