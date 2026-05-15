// validators/pre_tool_use.mjs
// Gate rules that must fire BEFORE a tool executes.
// Returns a decision object (to be JSON-stringified by the entry point) or null to pass through.

import { preToolUseDeny, debug } from "../lib/diagnostics.mjs";
import {
  readState, isPlanningActive, phaseOutput, featurePath, fileExists, isLightweightMode, completedIncludes,
} from "../lib/state.mjs";
import { readFileSafe } from "../lib/artifacts.mjs";

// Phase 1.5 — fixed-shape clarification: 12 PO-style business questions in
// 3 rounds of exactly 4 questions per AskUserQuestion call.
// Phase 1.6 — fixed-shape test clarification: 8 test-focused questions in
// 2 rounds of exactly 4 questions per AskUserQuestion call.
// Each question must expose >=2 selectable options so the user can pick instead of free-typing.
const QUESTIONS_PER_ROUND = 4;
const MIN_OPTIONS_PER_QUESTION = 2;
const PHASE_15_TOTAL_QUESTIONS = 12;
const PHASE_15_OPTIONAL_ROUND_TOTAL_QUESTIONS = 16;
const PHASE_16_TOTAL_QUESTIONS = 8;
const PHASE_15_PO_GUIDANCE = `Phase 1.5 must keep the normal contract of exactly ${PHASE_15_TOTAL_QUESTIONS} business-scope questions in ${PHASE_15_TOTAL_QUESTIONS / QUESTIONS_PER_ROUND} rounds of ${QUESTIONS_PER_ROUND} questions per AskUserQuestion call. Ask like a Product Owner: each question targets a load-bearing business-logic decision (scope cut, priority trade-off, success criterion, edge-case rule, ownership, rollout). No filler, no scattered probes. Every question needs >=${MIN_OPTIONS_PER_QUESTION} concrete options so the user picks instead of free-typing. Round 2/3 must avoid duplicate intent unless a clear followup_reason is provided. If unresolved anomaly exists, include at least one direct anomaly-resolution question in the next round. Optional Round 4 (questions ${PHASE_15_TOTAL_QUESTIONS + 1}-${PHASE_15_OPTIONAL_ROUND_TOTAL_QUESTIONS}) is allowed only for unresolved anomaly resolution and must not contain broad new discovery questions.`;
const PHASE_16_TEST_GUIDANCE = `Phase 1.6 must collect exactly ${PHASE_16_TOTAL_QUESTIONS} test-clarification questions in ${PHASE_16_TOTAL_QUESTIONS / QUESTIONS_PER_ROUND} rounds of ${QUESTIONS_PER_ROUND} questions per AskUserQuestion call. Ask only high-signal test questions (feature mode: fullstack/fe-only/be-only, critical acceptance path, failure paths, evidence requirement, FE screenshot checkpoint selection for FE-involving modes, environment/seed data, rollout verification, ownership of final sign-off). No filler. Every question needs >=${MIN_OPTIONS_PER_QUESTION} concrete options. Update phase_outputs."1.6".questions_asked after each round and only advance to Phase 2 once questions_asked === ${PHASE_16_TOTAL_QUESTIONS} and test-scenarios.md is written.`;
import { currentPhaseAtLeast } from "../lib/phase_gates.mjs";

const PHASE7_READY_VERDICTS = new Set(["READY", "READY_LITE", "READY_TARGETED"]);
const PHASE7_VALIDATION_MODES = new Set(["mechanical_lite", "targeted", "full"]);
import { looksLikeExecutionPlanFile } from "../lib/artifacts.mjs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

// Regex for the "bv" CLI (beads viewer) — the bare form launches an interactive TUI.
const ALLOWED_BV_FLAGS = /(--robot-|--export-graph|--help|-h\b|-V\b|--version)/;

// Rough heuristic: an Agent call whose prompt looks like it is spawning one of the
// Phase 1 discovery agents. Used to block malformed discovery Agent calls before they spawn.
const DISCOVERY_AGENT_KEYWORDS = /(discovery|architecture discovery|pattern discovery|constraint discovery|external discovery|discover\s+the\s+codebase)/i;
const DISCOVERY_LANES = [
  { id: "architecture", label: "Architecture", artifact: "history/{feature}/discovery-lanes/1-architecture.md", re: /architecture/i },
  { id: "patterns", label: "Patterns", artifact: "history/{feature}/discovery-lanes/2-patterns.md", re: /patterns?/i },
  { id: "constraints", label: "Constraints", artifact: "history/{feature}/discovery-lanes/3-constraints.md", re: /constraints?/i },
  { id: "external", label: "External", artifact: "history/{feature}/discovery-lanes/4-external.md", re: /external/i },
];
const ALLOWED_DISCOVERY_SUBAGENTS = new Set(["Explore", "general-purpose"]);
const PHASE_1_AGENT_DENY_GUIDANCE = `IMPORTANT: Do not launch this Agent call. Phase 1 discovery baseline is simple: launch each canonical lane once (Architecture, Patterns, Constraints, External), then wait for outputs/artifacts. Discovery subagents must author artifact-ready Markdown in their response only; the main agent writes canonical lane files, compiles discovery.md, updates PLANNING_STATUS.md, and manages JSON state. After outputs are observable, prime only lanes that are still missing or retryable failed. Use subagent_type="Explore" or "general-purpose", and keep run_in_background=true so all lanes can finish before Phase 1.5.`;

const RESUME_BLOCKED_TOOL_NAMES = new Set([
  "AskUserQuestion",
  "Agent",
]);

function isPhase8Completed(state) {
  if (!state) return false;
  if (completedIncludes(state, "8")) return true;
  const p8 = phaseOutput(state, "8") || {};
  return p8.status === "completed";
}

function phase7ExecutionGateIssue(state) {
  const p7 = phaseOutput(state, "7") || {};
  const mode = String(p7.validation_mode ?? "");
  const verdict = String(p7.semantic_verdict ?? "");
  const validatorId = p7.validator_invocation_id;
  const cyclesFound = Number(p7.cycles_found);

  if (p7.status !== "completed") {
    return "phase_outputs.7.status must be \"completed\" before Phase 8.";
  }
  if (!PHASE7_VALIDATION_MODES.has(mode)) {
    return `phase_outputs.7.validation_mode must be one of ${Array.from(PHASE7_VALIDATION_MODES).join("/")}.`;
  }
  if (!Number.isFinite(cyclesFound) || cyclesFound !== 0) {
    return `phase_outputs.7.cycles_found must be 0 before Phase 8 (current: ${p7.cycles_found ?? "missing"}).`;
  }
  if (!PHASE7_READY_VERDICTS.has(verdict)) {
    return `phase_outputs.7.semantic_verdict must be one of ${Array.from(PHASE7_READY_VERDICTS).join("/")} before Phase 8 (current: ${p7.semantic_verdict ?? "missing"}).`;
  }
  if (mode === "full") {
    if (typeof validatorId !== "string" || validatorId.trim().length === 0) {
      return "phase_outputs.7.validator_invocation_id is required for validation_mode=full.";
    }
  } else if (validatorId != null) {
    return `phase_outputs.7.validator_invocation_id must be null for validation_mode=${mode}.`;
  }
  if (!completedIncludes(state, "7")) {
    return "completed_phases must include \"7\" before entering Phase 8.";
  }
  return null;
}

export async function validatePreToolUse(input, projectDir) {
  const toolName = input.tool_name;
  const toolInput = input.tool_input || {};

  // 1. Block bare `bv` (PreToolUse Bash). Unconditional — even without planning state.
  if (toolName === "Bash") {
    const cmd = typeof toolInput.command === "string" ? toolInput.command.trim() : "";
    // First token must be bv (allow leading env assignments). Strip VAR=value assignments.
    const stripped = cmd.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)+/, "").trim();
    if (/^bv(\s|$)/.test(stripped)) {
      if (!ALLOWED_BV_FLAGS.test(stripped)) {
        return preToolUseDeny(
          "Bare `bv` launches an interactive TUI that blocks the session. " +
          "Use `bv --robot-triage` / `bv --robot-insights` / `bv --robot-plan` / `bv --export-graph` / `bv --help` instead.",
        );
      }
    }
  }

  // Load state for the phase-based rules below.
  const { state, legacy, missing } = await readState(projectDir);
  if (legacy) return null;       // legacy numbering — skip gating
  if (missing || !state) return null;  // no planning active — skip
  if (!isPlanningActive(state)) return null;

  const feat = featurePath(state) ?? "";
  const lightweight = isLightweightMode(state);
  if (lightweight) {
    debug("lightweight mode active — gates 2.5/3/4 bypassed");
    process.stderr.write(
      "[planning-guard] Lightweight mode active — gates 2.5/3/4 bypassed\n",
    );
  }

  const resumeGateIssue = await validateResumeContextRehydration({
    toolName,
    toolInput,
    state,
    projectDir,
  });
  if (resumeGateIssue) return preToolUseDeny(resumeGateIssue);

  // 2. Phase 8 gate: writing execution-plan.md requires Phase 7 semantic_verdict in READY-ready verdicts.
  //    This applies regardless of lightweight mode — Phase 7 is ALWAYS enforced.
  if (toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit") {
    const fp =
      typeof toolInput.file_path === "string" ? toolInput.file_path :
      typeof toolInput.path === "string" ? toolInput.path : null;
    if (typeof fp === "string" && /(^|\/)history\/[^/]+\/phase-[^/]+-(contract|story-map)\.md$/.test(fp)) {
      return preToolUseDeny(
        `Flat phase artifact path blocked: '${fp}'. ` +
        `Write contracts to history/<feature>/contracts/phase-<n>-contract.md and story maps to history/<feature>/story-maps/phase-<n>-story-map.md.`,
      );
    }
    const targetingPlanningState = typeof fp === "string" && /(^|\/)\.planning\/state\/planning-state-v2\.json$/.test(fp);
    const targetingExecPlan =
      looksLikeExecutionPlanFile(fp) ||
      (String(state.current_phase ?? "") === "8" && !targetingPlanningState);
    if (targetingExecPlan) {
      const gateIssue = phase7ExecutionGateIssue(state);
      if (gateIssue) {
        return preToolUseDeny(
          `Phase 8 state gate blocked: ${gateIssue} ` +
          `Before setting current_phase=8 or writing execution-plan.md, complete Phase 7 atomically (status, validation_mode, cycles_found=0, READY* verdict, validator id policy, completed_phases includes "7").`,
        );
      }
    }
  }

  // 3. Block `br create` at phase >= 5 when phase_plan_approved is false.
  //    In lightweight mode the Phase 2.5 approval gate is bypassed.
  if (toolName === "Bash") {
    const cmd = typeof toolInput.command === "string" ? toolInput.command.trim() : "";
    const stripped = cmd.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)+/, "").trim();
    if (/^br\s+create\b/.test(stripped)) {
      // Phase 8 gate also applies to `br create`: don't create beads for phase 8
      // before the validator verdict lands.
      if (String(state.current_phase ?? "") === "8") {
        const gateIssue = phase7ExecutionGateIssue(state);
        if (gateIssue) {
          return preToolUseDeny(
            `br create blocked at Phase 8: ${gateIssue} ` +
            `Complete Phase 7 atomic state fields before creating Phase 8 beads.`,
          );
        }
      }

      if (!lightweight && currentPhaseAtLeast(state, "5") && state.phase_plan_approved !== true) {
        return preToolUseDeny(
          `br create blocked: Phase 2.5 phase plan not yet approved. ` +
          `state.phase_plan_approved=${state.phase_plan_approved}, current_phase=${state.current_phase}. ` +
          `Complete Phase 2.5 approval before decomposition.`,
        );
      }
      const p4Approval = phaseOutput(state, "4_approval") || {};
      if (!lightweight && currentPhaseAtLeast(state, "5")) {
        const phase4Approved =
          p4Approval.status === "completed" &&
          p4Approval.approved === true &&
          p4Approval.approval_response === "Approve";
        if (!phase4Approved) {
          return preToolUseDeny(
            `br create blocked: Phase 4 approval gate is not fully completed. ` +
            `Require phase_outputs.4_approval.status="completed", approved=true, approval_response="Approve" ` +
            `(current: status=${p4Approval.status ?? "missing"}, approved=${p4Approval.approved ?? "missing"}, approval_response=${p4Approval.approval_response ?? "missing"}).`,
          );
        }
      }

      // In full mode, decomposition is allowed only after ALL feature-plan phases
      // have both contract and story-map artifacts.
      if (!lightweight && currentPhaseAtLeast(state, "5")) {
        const coverageIssue = await validateFeaturePlanCoverageForBeads(projectDir, state);
        if (coverageIssue) {
          return preToolUseDeny(coverageIssue);
        }
      }

      const verificationIssue = validatePhase5VerificationClauses(stripped, state);
      if (verificationIssue) {
        return preToolUseDeny(verificationIssue);
      }
    }

    if (currentPhaseAtLeast(state, "5") && /\bbr\s+dep\s+add\b/.test(stripped)) {
      const depAddCount = (stripped.match(/\bbr\s+dep\s+add\b/g) || []).length;
      if (depAddCount >= 3 && /(?:&&|;)/.test(stripped)) {
        return preToolUseDeny(
          `br dep add batch blocked: ${depAddCount} dependency edges in one command can silently recreate an over-linear graph. ` +
          `Add only real prerequisite edges, keep independent beads parallel-ready, and prefer fan-out/fan-in. ` +
          `Split this into smaller dep-add steps after checking each edge is necessary.`,
        );
      }
    }

    const closeEvidenceIssue = await validateBeadCloseEvidence(stripped, projectDir);
    if (closeEvidenceIssue) {
      return preToolUseDeny(closeEvidenceIssue);
    }
  }

  // 4. Block malformed or duplicate discovery Agent calls before they spawn.
  //    Once Phase 8 is completed, Agent spawning is unrestricted.
  if (toolName === "Agent") {
    const cp = String(state.current_phase ?? "");
    const phase8Completed = isPhase8Completed(state);
    if (phase8Completed) {
      return null;
    }

    const desc = (toolInput.name ?? "") + "\n" + (toolInput.description ?? "");
    const lane = discoveryLaneFromText(desc);
    const looksDiscovery = lane || DISCOVERY_AGENT_KEYWORDS.test(desc);
    if (cp !== "1") {
      if (looksDiscovery) {
        return preToolUseDeny(
          `Discovery-style Agent call blocked: planning is in phase '${cp}', not Phase 1. ` +
          `Discovery lane Agents are allowed only while current_phase=1.`,
        );
      }
    } else if (looksDiscovery) {
      const issues = [];
      if (!lane) {
        issues.push("Agent prompt/description/name must identify exactly one discovery lane: Architecture, Patterns, Constraints, or External");
      }
      const subagentType = toolInput.subagent_type ?? "general-purpose";
      if (!ALLOWED_DISCOVERY_SUBAGENTS.has(subagentType)) {
        issues.push(`subagent_type must be "Explore" or "general-purpose" (got ${toolInput.subagent_type ?? "missing"})`);
      }
      if (toolInput.run_in_background !== true) {
        issues.push("run_in_background must be true");
      }
      issues.push(...validateDiscoveryAgentPromptContract(toolInput, lane, state.feature));
      if (lane) {
        const existing = await discoveryLaneStatus(projectDir, state, lane.id);
        if (existing && existing !== "failed" && existing !== "missing") {
          issues.push(`${lane.label} discovery is already ${existing}; launch only missing or retryable failed lanes`);
        }
      }
      if (issues.length > 0) {
        return preToolUseDeny(`${issues.join("; ")}. ${PHASE_1_AGENT_DENY_GUIDANCE}`);
      }
    }
  }

  // 5. AskUserQuestion — allow Phase 0 GitNexus reindex, Phase 1.5 business clarification,
  //    Phase 1.6 test clarification, Phase 2.5 approval, Phase 4 approval, and Phase 8 execution.
  if (toolName === "AskUserQuestion") {
    const cp = String(state.current_phase ?? "");

    // Phase 8 completed: planning cycle done — unrestrict (mirrors Agent gate above).
    if (isPhase8Completed(state)) return null;

    const allowedPhases = new Set(["0", "1.5", "1.6", "2.5", "4", "8"]);
    if (!allowedPhases.has(cp)) {
      return preToolUseDeny(
        `AskUserQuestion blocked: planning is in phase '${cp}'. ` +
        `GitNexus reindex questions belong in Phase 0, business questions belong in Phase 1.5, test clarification belongs in Phase 1.6, phase-plan approval belongs in Phase 2.5, and story-map approval belongs in Phase 4.`,
      );
    }

    if (cp === "1.5") {
      if (!completedIncludes(state, "1")) {
        return preToolUseDeny(
          `Phase 1.5 AskUserQuestion blocked: Phase 1 discovery is not completed. ` +
          `Collect all four discovery lane outputs, write discovery artifacts, then advance to Phase 1.5.`,
        );
      }
      const shapeIssue = validateQuestionRoundShape(toolInput, "Phase 1.5", PHASE_15_PO_GUIDANCE);
      if (shapeIssue) return preToolUseDeny(shapeIssue);

      const p15 = phaseOutput(state, "1.5") || {};
      const asked = Number(p15.questions_asked ?? 0);
      const semanticIssue = validatePhase15RoundSemantics(toolInput, p15, asked);
      if (semanticIssue) return preToolUseDeny(`${semanticIssue} ${PHASE_15_PO_GUIDANCE}`);

      if (!Number.isFinite(asked) || asked < 0) {
        return preToolUseDeny(
          `Phase 1.5 AskUserQuestion blocked: phase_outputs."1.5".questions_asked is invalid (${p15.questions_asked ?? "missing"}). ` +
          `Expected a non-negative multiple of ${QUESTIONS_PER_ROUND}.`,
        );
      }

      if (asked >= PHASE_15_OPTIONAL_ROUND_TOTAL_QUESTIONS) {
        return preToolUseDeny(
          `Phase 1.5 AskUserQuestion blocked: optional Round 4 is already exhausted ` +
          `(phase_outputs."1.5".questions_asked=${asked}, max=${PHASE_15_OPTIONAL_ROUND_TOTAL_QUESTIONS}). ` +
          `Resolve remaining ambiguity in artifacts/state and advance, do not ask more questions.`,
        );
      }

      if (asked < PHASE_15_TOTAL_QUESTIONS) {
        const remaining = PHASE_15_TOTAL_QUESTIONS - asked;
        if (remaining < QUESTIONS_PER_ROUND) {
          return preToolUseDeny(
            `Phase 1.5 round size invalid: only ${remaining} question(s) remain to reach ${PHASE_15_TOTAL_QUESTIONS} ` +
            `but each round must contain exactly ${QUESTIONS_PER_ROUND} questions. ` +
            `phase_outputs."1.5".questions_asked=${asked} is inconsistent with the 4-per-round contract — fix state, do not partial-ask.`,
          );
        }
      } else if (asked === PHASE_15_TOTAL_QUESTIONS) {
        const unresolved = phase15UnresolvedAnomalyCount(p15);
        if (unresolved === 0) {
          return preToolUseDeny(
            `Phase 1.5 AskUserQuestion blocked: ${PHASE_15_TOTAL_QUESTIONS}/${PHASE_15_TOTAL_QUESTIONS} questions already collected and unresolved anomaly count is 0. ` +
            `Advance to Phase 1.6; Optional Round 4 is allowed only when unresolved anomaly remains.`,
          );
        }
        if (p15.optional_round_4_used === true) {
          return preToolUseDeny(
            `Phase 1.5 AskUserQuestion blocked: optional Round 4 is already marked used but questions_asked is still ${asked}. ` +
            `Fix phase_outputs."1.5" state before asking more questions.`,
          );
        }
      } else if (asked > PHASE_15_TOTAL_QUESTIONS && asked < PHASE_15_OPTIONAL_ROUND_TOTAL_QUESTIONS) {
        return preToolUseDeny(
          `Phase 1.5 AskUserQuestion blocked: phase_outputs."1.5".questions_asked=${asked} is inconsistent with the 4-per-round optional-round contract. ` +
          `Allowed checkpoints are 0,4,8,12,16. Fix state before asking more questions.`,
        );
      }
    }

    if (cp === "1.6") {
      if (!completedIncludes(state, "1.5")) {
        return preToolUseDeny(
          `Phase 1.6 AskUserQuestion blocked: Phase 1.5 is not completed. ` +
          `Complete 12/12 business clarification questions first.`,
        );
      }
      const shapeIssue = validateQuestionRoundShape(toolInput, "Phase 1.6", PHASE_16_TEST_GUIDANCE);
      if (shapeIssue) return preToolUseDeny(shapeIssue);

      const asked = Number(phaseOutput(state, "1.6")?.questions_asked ?? 0);
      const semanticIssue = validatePhase16RoundSemantics(toolInput, asked);
      if (semanticIssue) return preToolUseDeny(`${semanticIssue} ${PHASE_16_TEST_GUIDANCE}`);

      if (Number.isFinite(asked) && asked >= PHASE_16_TOTAL_QUESTIONS) {
        return preToolUseDeny(
          `Phase 1.6 AskUserQuestion blocked: ${PHASE_16_TOTAL_QUESTIONS} questions already collected ` +
          `(phase_outputs."1.6".questions_asked=${asked}). Write test-scenarios.md and advance to Phase 2.`,
        );
      }
      const remaining = PHASE_16_TOTAL_QUESTIONS - asked;
      if (remaining < QUESTIONS_PER_ROUND) {
        return preToolUseDeny(
          `Phase 1.6 round size invalid: only ${remaining} question(s) remain to reach ${PHASE_16_TOTAL_QUESTIONS} ` +
          `but each round must contain exactly ${QUESTIONS_PER_ROUND} questions. ` +
          `phase_outputs."1.6".questions_asked=${asked} is inconsistent with the 4-per-round contract — fix state, do not partial-ask.`,
        );
      }
    }

    if (cp === "0" && !looksLikeGitNexusReindexQuestion(toolInput)) {
      return preToolUseDeny(
        `Phase 0 AskUserQuestion must use the exact machine-checkable GitNexus reindex shape: ` +
        `header 'GitNexus Reindex', question 'The current GitNexus index may be stale or inaccurate. Reindex GitNexus now before planning discovery?' with options Yes and No.`,
      );
    }

    if (cp === "2.5" && !looksLikeExactApprovalQuestion(toolInput)) {
      return preToolUseDeny(
        `Phase 2.5 approval must use the exact machine-checkable AskUserQuestion shape: ` +
        `question 'Approve the phase plan (history/<feature>/phase-plan.md)?' with options Approve and Revise.`,
      );
    }

    if (cp === "4") {
      const coverageIssue = await validateFeaturePlanCoverageForPhase4Approval(projectDir, state);
      if (coverageIssue) return preToolUseDeny(coverageIssue);

      if (!looksLikeExactPhase4ApprovalQuestion(toolInput)) {
        return preToolUseDeny(
          `Phase 4 approval must use the exact machine-checkable AskUserQuestion shape: ` +
          `question 'Approve the story maps (history/<feature>/story-maps/*.md)?' with options Approve and Revise.`,
        );
      }
    }
  }

  return null;
}

async function validateBeadCloseEvidence(command, projectDir) {
  const close = parseBrCloseCommand(command);
  if (!close || close.ids.length === 0) return null;

  const closeText = `${close.reason}\n${command}`.trim();
  if (/\b(cancelled|canceled|duplicate|wontfix|won't fix|not planned|superseded|invalid)\b/i.test(closeText)) {
    return null;
  }

  const issues = [];
  for (const id of close.ids) {
    const bead = await loadBeadIssue(projectDir, id);
    if (!bead) continue;

    const beadText = [
      bead.title,
      bead.description,
      Array.isArray(bead.labels) ? bead.labels.join(" ") : "",
    ].filter(Boolean).join("\n");
    const issue = validateCloseEvidenceForBead(id, beadText, closeText);
    if (issue) issues.push(issue);
  }

  if (issues.length === 0) return null;
  return issues.join("\n\n");
}

function parseBrCloseCommand(command) {
  const tokens = splitShellWords(command);
  if (tokens.length < 2 || tokens[0] !== "br" || tokens[1] !== "close") return null;

  const ids = [];
  let reason = "";
  for (let i = 2; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (["&&", ";", "||", "|"].includes(token)) break;
    if (token === "--reason" || token === "-r") {
      reason = tokens[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (token.startsWith("--reason=")) {
      reason = token.slice("--reason=".length);
      continue;
    }
    if (!token.startsWith("-")) ids.push(token);
  }

  return { ids, reason: reason.trim() };
}

function splitShellWords(command) {
  const matches = String(command || "").match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+/g) || [];
  return matches.map((token) => {
    if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
      return token.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
    }
    return token;
  });
}

async function loadBeadIssue(projectDir, id) {
  for (const rel of [".beads/issues.jsonl", ".beads/beads.jsonl"]) {
    const text = await readFileSafe(join(projectDir, rel));
    if (!text) continue;

    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const issue = JSON.parse(trimmed);
        if (beadIdMatches(issue.id, id)) return issue;
      } catch {
        continue;
      }
    }
  }
  return null;
}

function beadIdMatches(left, right) {
  if (String(left || "") === String(right || "")) return true;
  return beadIdSuffix(left) === beadIdSuffix(right);
}

function beadIdSuffix(value) {
  return String(value || "").trim().replace(/^(br|one_hammer)-/, "");
}

function validateCloseEvidenceForBead(id, beadText, evidenceText) {
  const bead = String(beadText || "").toLowerCase();
  const evidence = String(evidenceText || "").toLowerCase();
  const looksImplementation = /(runtime conventions source|technical contract clause|test session budget|be verification clause|fe verification clause|fullstack|be-only|fe-only)/.test(bead);
  if (!looksImplementation) return null;

  const missing = [];
  const requiresBe = /(be verification clause|real api-call|api[ -]?call|\bcurl\b|\/api\/)/.test(bead);
  const feEvidenceWaived = /(fe\s+(evidence|screenshot|verification)\s*[:=-]?\s*(n\/a|not applicable)|browser\s+evidence\s*[:=-]?\s*(n\/a|not applicable)|evidence-scope\s+mismatch|follow-?up\s+(fe|frontend|ui|browser)|fe\s+follow-?up|be-only|backend-only|api-only|db-only|no\s+fe\s+(surface|changes|evidence))/i.test(evidence);
  const requiresFe = /(fe verification clause|agent-browser)/.test(bead) && !feEvidenceWaived;
  const requiresDbQuery = /(then query|db query proof|query orders|orders metadata|metadata proof|database query)/.test(bead);
  const migrationRelevant = /(migration-relevant|migration required|data migration required|seed required|bootstrap required|alembic|onehammerstore\/alembic\/versions|schema)/.test(bead);
  const requiresBrowserNetworkCue = requiresFe && /(integration|fe.?be|network|api cue|\/api\/|endpoint|legacy|retired|cleanup|create path|order)/.test(bead);
  const requiresQualityGate = requiresFe && /(quality gate|typecheck|typescript|tsc|lint|build)/.test(bead);
  const pngMatches = evidence.match(/[\w./-]+\.png\b/g) || [];

  if (!evidence || /^completed\.?$/i.test(evidence.trim())) {
    missing.push("non-generic close reason with actual evidence");
  }

  if (requiresBe) {
    if (!/(\bcurl\b|\bhttpie\b|http\s+|api[ -]?call|post\s+\/api|get\s+\/api|\/api\/)/.test(evidence)) {
      missing.push("BE runtime API command/call evidence");
    }
    if (!/(status\s*[:=]?\s*(200|201|204|4\d\d|5\d\d)|\b(200|201|204|400|401|403|404|410|422)\b|response)/.test(evidence)) {
      missing.push("expected/actual HTTP status or response evidence");
    }
    if (!/(authorization|bearer|token|login|credential|test_client_email|test_client_password)/.test(evidence)) {
      missing.push("auth/token source used for the API call");
    }
  }

  if (requiresDbQuery && !/(select\b|db query|database query|sql\b|orders\.metadata|metadata\s*(ok|verified|contains|=)|query result)/.test(evidence)) {
    missing.push("DB/query proof named by the bead");
  }

  if (migrationRelevant) {
    if (!/(migration decision|schema migration|data migration|seed migration|provisioning proof|existing provisioning|existing migration|no new migration|no migration required|alembic)/.test(evidence)) {
      missing.push("explicit migration/provisioning decision");
    }
    if (!/(alembic upgrade head|uv run --project onehammerstore alembic upgrade head|migration applied|already at head|existing provisioning proof|no migration required|schema already exists)/.test(evidence)) {
      missing.push("migration apply/provisioning proof or explicit no-migration proof");
    }
  }

  if (requiresFe) {
    if (!/(agent-browser|browser)/.test(evidence)) {
      missing.push("agent-browser action summary");
    }
    if (!/(clicked|filled|selected|opened|navigated|action|cta|submit|button|login|dashboard)/.test(evidence)) {
      missing.push("browser action taken before screenshots");
    }
    if (pngMatches.length < 2 || !/(before|pre[- ]?action|pre[- ]?click)/.test(evidence) || !/(after|post[- ]?action|post[- ]?click|final state|settled)/.test(evidence)) {
      missing.push("at least two interpreted FE screenshots: before action and after/final state");
    }
    if (!/(observed ui|actual ui|visible|shows|does not show|no legacy|absence|expected ui|ui state)/.test(evidence)) {
      missing.push("screenshot interpretation with expected/observed UI state");
    }
    if (!/(browser runbook|runbook delta|runbook unchanged|updated \.claude\/lessons\/browser-runbook\.md|browser-runbook\.md)/.test(evidence)) {
      missing.push("browser-runbook delta or unchanged statement");
    }
  }

  if (requiresBrowserNetworkCue) {
    if (!/(get|post|put|patch|delete)\s+\/api\/[\w./{}:-]+.*(status\s*[:=]?\s*)?(200|201|204|4\d\d|5\d\d)|\/api\/[\w./{}:-]+.*(200|201|204|400|401|403|404|410|422)/.test(evidence)) {
      missing.push("browser-observed network/API cue with method, path, and status");
    }
    if (/(har[^\n.;]*(0\s+requests|empty)|0\s+requests[^\n.;]*har)/.test(evidence)) {
      missing.push("non-empty HAR/network artifact (0-request HAR is not evidence)");
    }
  }

  if (requiresQualityGate && !/(tsc|typecheck|typescript|lint|build|quality gate).*(pass|passed|ok|failed|pre-existing|known|classified|not related|clean)/.test(evidence)) {
    missing.push("quality gate result classified as pass or known/pre-existing failure");
  }

  if (missing.length === 0) return null;
  return `br close blocked for ${id}: missing ${missing.join("; ")}. Close only after required runtime evidence is captured and interpreted. Put the evidence in --reason, including before/after screenshot paths plus what each screenshot proves, browser network method/path/status when relevant, browser-runbook delta/unchanged status, and quality-gate classification when the bead asks for it. If the evidence cannot be run in this session, do not close the bead; leave it in_progress/blocked or create a chained follow-up test bead.`;
}

async function validateResumeContextRehydration({ toolName, state, projectDir }) {
  if (!RESUME_BLOCKED_TOOL_NAMES.has(toolName)) return null;

  const resumeContext =
    state && typeof state.resume_context === "object" && state.resume_context !== null
      ? state.resume_context
      : {};
  const resumeRequired =
    resumeContext.required === true ||
    resumeContext.rehydration_required === true;
  const alreadyHydrated =
    resumeContext.hydrated === true ||
    resumeContext.rehydrated === true ||
    resumeContext.required === false;
  if (!resumeRequired || alreadyHydrated) return null;

  const cp = String(state.current_phase ?? "");
  if (!["1.5", "1.6"].includes(cp)) return null;

  const p1 = phaseOutput(state, "1");
  if (!p1 || p1.status !== "completed") return null;
  const p15 = phaseOutput(state, "1.5");
  const p16 = phaseOutput(state, "1.6");
  if (cp === "1.5" && p15?.status === "completed") return null;
  if (cp === "1.6" && p16?.status === "completed") return null;

  const explicitRequirementSourcePath = cleanRequirementPath(resumeContext.requirement_source_path);
  const requirementSourcePath =
    explicitRequirementSourcePath && await fileExists(join(projectDir, explicitRequirementSourcePath))
      ? explicitRequirementSourcePath
      : await resolveRequirementSourcePath(projectDir, state);

  const requiredArtifacts = expectedResumeArtifacts(state);
  const missingArtifacts = [];
  for (const rel of requiredArtifacts) {
    if (!(await fileExists(join(projectDir, rel)))) {
      missingArtifacts.push(rel);
    }
  }

  if (missingArtifacts.length > 0) {
    return `Resume blocked in Phase ${cp}: state.resume_context.required=true and expected prior planning artifact(s) are missing: ${missingArtifacts.join(", ")}. Read and rebuild the missing artifacts before continuing, then mark resume_context.required=false after rehydration.`;
  }

  const sourceText = requirementSourcePath
    ? `the requirement source '${requirementSourcePath}'`
    : "the requirement source recorded in planning state/status";
  return `Resume blocked in Phase ${cp}: state.resume_context.required=true, so reread ${sourceText} and existing planning artifacts before continuing. After rehydration, update state to set resume_context.required=false.`;
}

function expectedResumeArtifacts(state) {
  const feature = state.feature;
  if (!feature) return [];

  const artifacts = [
    `history/${feature}/PLANNING_STATUS.md`,
    `history/${feature}/discovery.md`,
    `history/${feature}/discovery-lanes/1-architecture.md`,
    `history/${feature}/discovery-lanes/2-patterns.md`,
    `history/${feature}/discovery-lanes/3-constraints.md`,
    `history/${feature}/discovery-lanes/4-external.md`,
  ];

  const p1 = phaseOutput(state, "1");
  if (p1?.discovery_path) artifacts.push(String(p1.discovery_path));

  const unique = [];
  const seen = new Set();
  for (const item of artifacts) {
    const rel = String(item || "").trim();
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    unique.push(rel);
  }
  return unique;
}


async function resolveRequirementSourcePath(projectDir, state) {
  const feature = state.feature;
  if (!feature) return null;

  const sourceFromState = extractRequirementPathFromState(state);
  if (sourceFromState && await fileExists(join(projectDir, sourceFromState))) {
    return sourceFromState;
  }

  const planningStatusPath = join(projectDir, "history", feature, "PLANNING_STATUS.md");
  const statusText = await readFileSafe(planningStatusPath);
  const sourceFromStatus = extractRequirementPathFromStatus(statusText);
  if (sourceFromStatus && await fileExists(join(projectDir, sourceFromStatus))) {
    return sourceFromStatus;
  }

  const latest = await findLatestRequirementSource(projectDir, feature);
  if (latest) return latest;

  return null;
}

function extractRequirementPathFromState(state) {
  if (!state || typeof state !== "object") return null;
  const p0 = phaseOutput(state, "0") || {};
  const p15 = phaseOutput(state, "1.5") || {};
  const p16 = phaseOutput(state, "1.6") || {};

  const candidates = [
    p0.requirement_source_path,
    p15.requirement_source_path,
    p16.requirement_source_path,
  ];

  if (Array.isArray(p15.requirement_source_paths)) {
    candidates.push(...p15.requirement_source_paths);
  }
  if (Array.isArray(p16.requirement_source_paths)) {
    candidates.push(...p16.requirement_source_paths);
  }

  for (const candidate of candidates) {
    const cleaned = cleanRequirementPath(candidate);
    if (cleaned) return cleaned;
  }
  return null;
}

function extractRequirementPathFromStatus(statusText) {
  if (typeof statusText !== "string" || statusText.trim().length === 0) return null;

  const rows = statusText
    .split(/\r?\n/)
    .filter((line) => /^\|/.test(line));

  for (const row of rows) {
    const cells = row
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean);
    if (cells.length < 2) continue;
    const artifact = cells[0].toLowerCase();
    if (!["source request", "requirement source", "requirements source"].includes(artifact)) {
      continue;
    }
    const cleaned = cleanRequirementPath(cells[1]);
    if (cleaned) return cleaned;
  }

  const line = statusText
    .split(/\r?\n/)
    .find((l) => /requirement\s*source|source\s*request/i.test(l));
  if (!line) return null;

  const normalized = line.replace(/\*\*/g, "").trim();
  const colonIdx = normalized.indexOf(":");
  if (colonIdx < 0) return null;

  return cleanRequirementPath(normalized.slice(colonIdx + 1));
}

function cleanRequirementPath(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const cleaned = raw
    .replace(/^`+|`+$/g, "")
    .replace(/^"+|"+$/g, "")
    .replace(/^'+|'+$/g, "")
    .trim();

  if (!cleaned || /^(none|n\/a|unknown)$/i.test(cleaned)) return null;
  return cleaned;
}

async function findLatestRequirementSource(projectDir, feature) {
  const requirementsDir = join(projectDir, "history", feature, "requirements");
  if (!(await fileExists(requirementsDir))) return null;

  let entries;
  try {
    entries = await readdir(requirementsDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const markdownFiles = entries
    .filter((entry) => entry.isFile() && /\.md$/i.test(entry.name))
    .map((entry) => entry.name);
  if (markdownFiles.length === 0) return null;

  const scored = [];
  for (const name of markdownFiles) {
    const abs = join(requirementsDir, name);
    try {
      const info = await stat(abs);
      scored.push({ name, mtimeMs: info.mtimeMs || 0 });
    } catch {
      scored.push({ name, mtimeMs: 0 });
    }
  }

  scored.sort((a, b) => {
    if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs;
    return b.name.localeCompare(a.name);
  });

  return `history/${feature}/requirements/${scored[0].name}`;
}

async function discoveryLaneStatus(projectDir, state, laneId) {
  const p1 = phaseOutput(state, "1");
  const ledger = p1?.lanes?.[laneId];
  if (ledger?.status) return String(ledger.status);
  const lane = DISCOVERY_LANES.find((l) => l.id === laneId);
  if (!lane || !state.feature) return "missing";
  const rel = lane.artifact.replace("{feature}", state.feature);
  if (await fileExists(join(projectDir, rel))) return "completed";
  return "missing";
}

function discoveryLaneFromText(text) {
  const matches = DISCOVERY_LANES.filter((lane) => lane.re.test(text));
  return matches.length === 1 ? matches[0] : null;
}

function validateDiscoveryAgentPromptContract(toolInput, lane, feature) {
  const prompt = typeof toolInput.prompt === "string" ? toolInput.prompt : "";
  const issues = [];

  if (!/\bartifact[- ]ready\b/i.test(prompt) || !/markdown/i.test(prompt)) {
    issues.push("Agent prompt must ask the subagent to return artifact-ready Markdown for its lane");
  }
  if (!/\b(response|reply|return|respond|output)\b/i.test(prompt)) {
    issues.push("Agent prompt must state that lane content is returned in the subagent response");
  }
  const forbidsWrites = /do\s+not\s+(?:use\s+)?(?:write|edit|persist|create|modify)[\s\S]{0,100}(?:file|artifact|repo|repository|state|history\/|\.planning|PLANNING_STATUS)/i.test(prompt);
  if (!forbidsWrites) {
    issues.push("Agent prompt must forbid the subagent from writing files, artifacts, or planning state");
  }
  const mainOwnsPersistence = /main agent[\s\S]{0,160}(?:write|persist|record|manage|update)/i.test(prompt) && /(?:canonical|lane file|discovery\.md|PLANNING_STATUS|\.planning|state)/i.test(prompt);
  if (!mainOwnsPersistence) {
    issues.push("Agent prompt must say the main agent writes canonical files and manages planning state");
  }
  if (!/backend[\s\S]{0,80}(?:first|source of truth)/i.test(prompt) || !/frontend[\s\S]{0,100}impact/i.test(prompt)) {
    issues.push("Agent prompt must preserve the fullstack rule: backend first/source-of-truth, then frontend impact");
  }
  if (!/browser\s+runbook\s+candidates/i.test(prompt)) {
    issues.push("Agent prompt must ask for Browser Runbook candidates when durable UI route/login/selector/state cues are found");
  }
  if (lane) {
    const canonicalPath = lane.artifact.replace("{feature}", feature || "<feature>");
    const canonicalFilename = canonicalPath.split("/").pop();
    if (!prompt.includes(canonicalPath) && !prompt.includes(canonicalFilename)) {
      issues.push(`Agent prompt must name the canonical lane artifact target (${canonicalPath})`);
    }
  }

  return issues;
}

function normalizeSingleQuestion(toolInput) {
  const questions = Array.isArray(toolInput.questions)
    ? toolInput.questions
    : (toolInput.question ? [{ question: toolInput.question }] : []);
  if (questions.length !== 1) return null;

  const q = questions[0] || {};
  const question = String(q.question ?? q.text ?? "").trim();
  const header = String(q.header ?? toolInput.header ?? "").trim();
  const options = Array.isArray(q.options) ? q.options : [];
  const labels = options.map((o) => String(o?.label ?? o ?? "").trim());
  return { question, header, labels };
}

function looksLikeGitNexusReindexQuestion(toolInput) {
  const q = normalizeSingleQuestion(toolInput);
  if (!q) return false;
  return q.header === "GitNexus Reindex" &&
    q.question === "The current GitNexus index may be stale or inaccurate. Reindex GitNexus now before planning discovery?" &&
    q.labels.length === 2 &&
    q.labels[0] === "Yes" &&
    q.labels[1] === "No";
}

function validateQuestionRoundShape(toolInput, phaseLabel, guidanceText) {
  const questions = Array.isArray(toolInput.questions) ? toolInput.questions : null;
  if (!questions || questions.length !== QUESTIONS_PER_ROUND) {
    return `${phaseLabel} AskUserQuestion must contain exactly ${QUESTIONS_PER_ROUND} questions per round (got ${questions ? questions.length : "missing"}). ${guidanceText}`;
  }
  const issues = [];
  questions.forEach((q, i) => {
    const idx = i + 1;
    const text = String(q?.question ?? q?.text ?? "").trim();
    const header = String(q?.header ?? "").trim();
    const options = Array.isArray(q?.options) ? q.options : [];
    if (!text) issues.push(`Q${idx} missing 'question' text`);
    if (!header) issues.push(`Q${idx} missing 'header' label`);
    if (options.length < MIN_OPTIONS_PER_QUESTION) {
      issues.push(`Q${idx} has ${options.length} option(s); need >=${MIN_OPTIONS_PER_QUESTION} concrete options for the user to pick`);
    } else {
      options.forEach((opt, oi) => {
        const label = String(opt?.label ?? opt ?? "").trim();
        if (!label) issues.push(`Q${idx} option[${oi}] is empty`);
      });
    }
  });
  if (issues.length > 0) {
    return `${phaseLabel} question shape invalid: ${issues.join("; ")}. ${guidanceText}`;
  }
  return null;
}

function phase15UnresolvedAnomalyCount(p15) {
  const unresolved = Number(p15?.anomaly_scan?.unresolved_count ?? 0);
  if (!Number.isFinite(unresolved) || unresolved < 0) return 0;
  return unresolved;
}

function normalizePhase15IntentTag(value) {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!normalized) return "";
  return normalized.split(/\s+/).slice(0, 12).join(" ");
}

function phase15QuestionText(question) {
  const options = Array.isArray(question?.options) ? question.options : [];
  return [
    question?.header,
    question?.question,
    question?.text,
    question?.followup_reason,
    ...options.map((opt) => opt?.label ?? opt),
  ]
    .filter(Boolean)
    .map((v) => String(v).trim())
    .filter(Boolean)
    .join("\n");
}

function extractPhase15IntentTag(question) {
  const explicit =
    question?.intent_tag ??
    question?.intent ??
    question?.tag ??
    question?.intentTag;
  if (explicit != null) {
    const normalized = normalizePhase15IntentTag(explicit);
    if (normalized) return normalized;
  }

  const fallback = normalizePhase15IntentTag(`${question?.header ?? ""} ${question?.question ?? question?.text ?? ""}`);
  return fallback;
}

function hasPhase15FollowupReason(question) {
  const reason = String(question?.followup_reason ?? question?.followupReason ?? "").trim();
  return reason.length > 0;
}

function isPhase15AnomalyResolutionQuestion(question) {
  if (question?.anomaly_resolution === true || question?.anomalyResolution === true) return true;
  const joined = phase15QuestionText(question).toLowerCase();
  if (!joined) return false;

  const anomalySignal = /(similar flow|already exists|existing flow|unused|orphan|legacy|fallback|source of truth|overlap|not used|unclear status|ambig|anomaly|deprecated|deprecate|migrate)/i.test(joined);
  const resolutionSignal = /(keep|remove|deprecate|migrate|ignore intentionally|ignore|retain|drop|replace|sunset)/i.test(joined);
  return anomalySignal && resolutionSignal;
}

function validatePhase15RoundSemantics(toolInput, p15, asked) {
  const questions = Array.isArray(toolInput?.questions) ? toolInput.questions : [];
  if (questions.length !== QUESTIONS_PER_ROUND) return null;

  if (!Number.isFinite(asked) || asked < 0 || asked % QUESTIONS_PER_ROUND !== 0) {
    return `Phase 1.5 blocked: questions_asked=${p15?.questions_asked ?? "missing"} is invalid; expected non-negative multiples of ${QUESTIONS_PER_ROUND}.`;
  }

  const unresolved = phase15UnresolvedAnomalyCount(p15);
  const priorTags = new Set(
    Array.isArray(p15?.asked_intent_tags)
      ? p15.asked_intent_tags.map((v) => normalizePhase15IntentTag(v)).filter(Boolean)
      : [],
  );

  const roundTags = new Set();
  const duplicateIssues = [];
  let hasResolutionQuestion = false;

  questions.forEach((question, idx) => {
    const tag = extractPhase15IntentTag(question);
    if (tag) {
      const duplicatePrior = priorTags.has(tag);
      const duplicateRound = roundTags.has(tag);
      if ((duplicatePrior || duplicateRound) && !hasPhase15FollowupReason(question)) {
        duplicateIssues.push(`Q${idx + 1} repeats intent '${tag}' without followup_reason`);
      }
      roundTags.add(tag);
    }

    if (isPhase15AnomalyResolutionQuestion(question)) {
      hasResolutionQuestion = true;
    }
  });

  if (duplicateIssues.length > 0) {
    return `Phase 1.5 blocked: Round 2/3/optional rounds must avoid duplicate intent unless followup_reason is explicit (${duplicateIssues.join("; ")}).`;
  }

  if (unresolved > 0 && !hasResolutionQuestion) {
    return `Phase 1.5 blocked: anomaly_scan.unresolved_count=${unresolved}; this round must include at least one direct anomaly-resolution question (keep/remove/deprecate/migrate/ignore intentionally).`;
  }

  if (asked === PHASE_15_TOTAL_QUESTIONS) {
    const nonResolution = questions
      .map((question, idx) => ({ idx: idx + 1, ok: isPhase15AnomalyResolutionQuestion(question) }))
      .filter((row) => !row.ok)
      .map((row) => `Q${row.idx}`);
    if (nonResolution.length > 0) {
      return `Phase 1.5 optional Round 4 blocked: after ${PHASE_15_TOTAL_QUESTIONS} normal questions, Round 4 must contain only anomaly-resolution questions. Non-resolution items: ${nonResolution.join(", ")}.`;
    }
  }

  return null;
}

function validatePhase16RoundSemantics(toolInput, asked) {
  const questions = Array.isArray(toolInput?.questions) ? toolInput.questions : [];
  if (questions.length !== QUESTIONS_PER_ROUND) return null;

  const round = Math.floor(Number(asked || 0) / QUESTIONS_PER_ROUND) + 1;
  const joined = questions
    .flatMap((q) => [q?.header, q?.question, q?.text, ...(Array.isArray(q?.options) ? q.options.map((o) => o?.label ?? o) : [])])
    .filter(Boolean)
    .map((v) => String(v).toLowerCase())
    .join("\n");

  const modeMentioned = /(fullstack|fe-only|be-only|frontend only|backend only|thuần fe|thuần be)/i.test(joined);
  const feModeMentioned = /(fullstack|fe-only|frontend only|thuần fe)/i.test(joined);
  const screenshotMentioned = /(screenshot|chụp|ảnh|before|after|trước|sau|final|redirect|toast)/i.test(joined);

  if (!modeMentioned) {
    return "Phase 1.6 round blocked: include at least one question/options that classify test mode (fullstack / fe-only / be-only).";
  }

  if (round === 1 && feModeMentioned && !screenshotMentioned) {
    return "Phase 1.6 round 1 blocked: when FE-involving modes are offered, include FE screenshot timing candidates (before/after important action/final) in question/options so user can choose checkpoints.";
  }

  return null;
}

function looksLikeExactApprovalQuestion(toolInput) {
  const q = normalizeSingleQuestion(toolInput);
  if (!q) return false;

  return /^Approve the phase plan \(history\/[^/]+\/phase-plan\.md\)\?$/.test(q.question) &&
    q.header === "Phase Plan Approval" &&
    q.labels.length === 2 &&
    q.labels[0] === "Approve" &&
    q.labels[1] === "Revise";
}

function looksLikeExactPhase4ApprovalQuestion(toolInput) {
  const q = normalizeSingleQuestion(toolInput);
  if (!q) return false;

  return /^Approve the story maps \(history\/[^/]+\/story-maps\/\*\.md\)\?$/.test(q.question) &&
    q.header === "Phase 4 Approval" &&
    q.labels.length === 2 &&
    q.labels[0] === "Approve" &&
    q.labels[1] === "Revise";
}

async function validateFeaturePlanCoverageForPhase4Approval(projectDir, state) {
  const coverage = await collectFeaturePlanCoverage(projectDir, state);
  if (coverage.error) return coverage.error;
  if (coverage.missing.length === 0) return null;

  return `Phase 4 approval blocked: full feature-plan coverage is incomplete. Missing artifact(s): ${coverage.missing.join(", ")}. ` +
    `Create contract+story-map for every phase declared in ${coverage.phasePlanPath} before asking Phase 4 approval.`;
}

async function validateFeaturePlanCoverageForBeads(projectDir, state) {
  const coverage = await collectFeaturePlanCoverage(projectDir, state);
  if (coverage.error) {
    return coverage.error
      .replace("Phase 4 approval blocked", "br create blocked")
      .replace("asking Phase 4 approval", "decomposition");
  }
  if (coverage.missing.length === 0) return null;

  return `br create blocked: full feature-plan coverage is incomplete. Missing artifact(s): ${coverage.missing.join(", ")}. ` +
    `Create contract+story-map for every phase declared in ${coverage.phasePlanPath} before decomposition.`;
}

function validatePhase5VerificationClauses(command, state) {
  if (!currentPhaseAtLeast(state, "5")) return null;

  const mode = inferFeatureModeFromState(state);
  const lower = String(command || "").toLowerCase();

  const hasFeVerification = /agent-browser/.test(lower);
  const hasBeVerification =
    /(\bcurl\b|\bhttpie\b|api[ -]?call|\/api\/|endpoint|expected\s+(status|response))/.test(lower) &&
    /api|endpoint|\/api\//.test(lower);
  const hasBeAuthCue = /(authorization|bearer|token|auth\s+method|credential|login)/.test(lower);

  const hasTechnicalContractLabel = /(technical\s+contract|api\s+contract|data\s*\/\s*db\s*\/\s*config\s+contract|source\s+of\s+truth)/.test(lower);
  const hasApiContractCue = /(api\s+contract|endpoint|\/api\/|request\s+shape|response\s+shape|expected\s+(status|response))/.test(lower);
  const hasDbSourceCue = /(\bdb\b|database|settings\s+key|source\s+of\s+truth|table|field|config)/.test(lower);
  const hasTestSessionBudget = /(test\s+session\s+budget|session\s+budget|test\s+budget)/.test(lower);
  const hasCompletionEvidenceGate = /(completion\s+evidence\s+gate|close\s+evidence|br\s+close|close\s+reason|do\s+not\s+close|closing\s+evidence)/.test(lower);
  const hasMigrationDecisionClause = /(migration\s+decision|inspect\s+existing\s+(alembic\s+)?revisions|before\s+creating\s+.*migration|schema\s+migration|data\s*\/\s*seed\s+migration|seed\s+migration|no\s+migration\s+required|existing\s+provisioning\s+proof)/.test(lower);
  const overOneSession = /(>\s*1\s*session|more\s+than\s+1\s*session|over\s+1\s*session|multi-?session|2\+\s*sessions)/.test(lower);
  const hasFollowUpChain = /(follow-?up\s+test\s+bead|create\s+.*test\s+bead.*(after|next)|br\s+dep\s+add|depends\s+on|blocked\s+by)/.test(lower);

  const hasNoMigrationExpectation = /(no\s+migration\s+expected|migration\s*:\s*none|no\s+schema\s+change|schema\s*unchanged)/.test(lower);
  const hasMigrationRequiredCue = /(migration\s+(required|expected)|create\s+migration|apply\s+migration|alembic\s+revision|schema\s+change\s+required|data\s+migration\s+required|seed\s+required|bootstrap\s+required)/.test(lower);
  const hasMigrationExpectation = hasNoMigrationExpectation || hasMigrationRequiredCue;
  const hasAlembicUpgradeCommand = /(uv\s+run\s+--project\s+onehammerstore\s+alembic\s+upgrade\s+head|alembic\s+upgrade\s+head)/.test(lower);

  const hasRuntimeSettingsSource = /(db\s+settings|settings\s+key|settings\s+table|source\s+of\s+truth|config\s+key)/.test(lower);
  const expectsRuntime200 = /(get\s+\/api\/|\/api\/|expected\s+200|returns?\s+200|status\s+200|payload)/.test(lower);
  const mentionsMissingConfigFail = /(missing\s+config|missing\s+setting|fail\s+500|500\s*\/\s*domain\s+error|domain\s+error|catalog_missing)/.test(lower);
  const hasBootstrapProof = /(data\s+migration\s+required|seed\s+required|bootstrap\s+required|alembic\s+revision|onehammerstore\/alembic\/versions|existing\s+provisioning\s+proof|existing\s+key\s+proof|provisioning\s+proof)/.test(lower);

  const hasNoRestartExpectation = /(no\s+restart\s+expected|restart\s*:\s*not\s+needed|no\s+runtime\s+reload\s+needed)/.test(lower);
  const hasRestartRequiredCue = /(restart\s+(required|needed)|systemctl\s+restart\s+onehammer-be|restart\s+onehammer-be|backend\s+restart)/.test(lower);
  const hasRestartExpectation = hasNoRestartExpectation || hasRestartRequiredCue;

  const explicitNoFe = /(fe\s+(evidence|screenshot|verification)\s*[:=-]?\s*(n\/a|not applicable)|browser\s+evidence\s*[:=-]?\s*(n\/a|not applicable)|be-only|backend-only|api-only|db-only|thuần\s*be|no\s+fe\s+(surface|changes|evidence)|frontend\s*[:=-]?\s*(n\/a|not applicable))/i.test(lower);
  const explicitNoBe = /(be\s+(evidence|verification)\s*[:=-]?\s*(n\/a|not applicable)|backend\s*[:=-]?\s*(n\/a|not applicable)|fe-only|frontend-only|ui-only|browser-only|thuần\s*fe|no\s+be\s+(surface|changes|evidence))/i.test(lower);
  const beadHasFeSurface = !explicitNoFe && /(fe\s+verification\s+clause|agent-browser|browser\s+evidence|screenshot|frontend|onehammerui|\bui\b|react|nextjs|page|component|screen|visual|button|form|client\s+dashboard)/i.test(lower);
  const beadHasBeSurface = !explicitNoBe && /(be\s+verification\s+clause|backend|onehammerstore|\bapi\b|\/api\/|endpoint|curl|http|\bdb\b|database|settings\s+key|settings\s+table|migration|alembic|runtime|schema|seed|provisioning)/i.test(lower);

  const requiresFe = mode === "fe-only" || beadHasFeSurface;
  const requiresBe = mode === "be-only" || beadHasBeSurface || (!requiresFe && mode === "unknown");

  const hasAgentBrowser = /agent-browser/.test(lower);
  const hasBrowserRunbookReference = /(\.claude\/lessons\/browser-runbook\.md|browser\s+runbook\s+reference|single\s+living\s+browser\s+runbook)/.test(lower);
  const hasBrowserBeforeAfterScreenshots = /(before|pre[- ]?action|pre[- ]?click).*(screenshot|\.png)/.test(lower) && /(after|post[- ]?action|post[- ]?click|final state|settled).*(screenshot|\.png)/.test(lower);
  const hasBrowserActionSummary = /(action\s+sequence|click|clicked|fill|filled|select|selected|submit|cta|button|login|navigate|dashboard)/.test(lower);
  const hasBrowserUiInterpretation = /(read\s+the\s+screenshot|interpret\s+the\s+screenshot|observed\s+ui|actual\s+ui|expected\s+ui|visible\s+text|shows|does\s+not\s+show|no\s+legacy|absence)/.test(lower);
  const hasBrowserNetworkCue = /(expected\s+network\/api\s+cue|browser-observed\s+api|network\s+cue|method\s*\+?\s*path\s*\+?\s*status|(get|post|put|patch|delete)\s+\/api\/|api\s+cue\s*[:=-]?\s*(n\/a|not applicable)|network\s*[:=-]?\s*(n\/a|not applicable))/.test(lower);
  const hasBrowserNetworkArtifact = /(network\s+evidence\s+(artifact|path)|har\s+(path|artifact)|requests?\s+log|method\s*\+?\s*path\s*\+?\s*status)/.test(lower);
  const hasBrowserRunbookDelta = /(runbook\s+delta|append\s+.*browser-runbook|update\s+.*browser-runbook|durable\s+ui\s+discover|browser\s+runbook\s+unchanged|cache\s+.*login|cache\s+.*navigation)/.test(lower);
  const hasQualityGateClassification = /(quality\s+gate|typecheck|typescript|tsc|lint|build).*(pass|passed|ok|fail|failed|pre-existing|known|classif)/.test(lower);
  const singleSessionException = /(single-session\s+exception|single\s+session\s+exception|combined-surface\s+exception)/.test(lower);
  const hasSurfaceSplitCue = /(separate\s+(be|backend|api).*?(fe|frontend|ui|browser)|split\s+(be|backend|api).*?(fe|frontend|ui|browser)|follow-?up\s+(fe|frontend|ui|browser|test)\s+bead|paired\s+(be|backend|api|fe|frontend|ui)\s+bead|br\s+dep\s+add|depends\s+on|blocked\s+by)/.test(lower);
  const heavyBeRuntime = /(migration|alembic|restart|systemctl\s+restart|login|token|authorization|bearer|db\s+query|database\s+query|\bcurl\b|\/api\/)/.test(lower);

  if (requiresBe && requiresFe && heavyBeRuntime && !singleSessionException && !hasSurfaceSplitCue) {
    return `br create blocked: fullstack bead combines BE/API runtime proof and FE/browser proof in one oversized surface. ` +
      `Split it into a BE/API bead with curl/HTTP evidence and a separate FE/UI bead with agent-browser screenshot evidence, or add an explicit Single-session exception.`;
  }

  if (hasAgentBrowser && !(hasBrowserRunbookReference && hasBrowserBeforeAfterScreenshots && hasBrowserActionSummary && hasBrowserUiInterpretation && hasBrowserNetworkCue && hasBrowserNetworkArtifact && hasBrowserRunbookDelta && hasQualityGateClassification)) {
    return `br create blocked: agent-browser evidence requires Browser Runbook Reference: .claude/lessons/browser-runbook.md, before-action and after/final screenshot paths, the browser action sequence, screenshot interpretation expectations, expected browser network/API cue with an artifact path or requests log, quality-gate classification, and a runbook delta expectation in the FE/UI bead description.`;
  }

  if (requiresBe && hasRuntimeSettingsSource && expectsRuntime200 && !hasBootstrapProof) {
    return `br create blocked: runtime DB settings source-of-truth requires bootstrap proof. ` +
      `Add data migration/seed under onehammerStore/alembic/versions or explicit existing-key provisioning proof. ` +
      `Do not use missing-config fail-fast behavior as a substitute for provisioning.`;
  }

  if (requiresBe && hasRuntimeSettingsSource && hasNoMigrationExpectation && !hasBootstrapProof) {
    return `br create blocked: "no migration expected" is invalid for a runtime-critical DB settings key unless explicit existing provisioning proof is included.`;
  }

  if (requiresBe && hasRuntimeSettingsSource && mentionsMissingConfigFail && !hasBootstrapProof) {
    return `br create blocked: missing-config 500/domain-error fallback does not satisfy bootstrap obligations for runtime-critical DB settings source-of-truth.`;
  }

  if (!(hasTechnicalContractLabel && hasApiContractCue && hasDbSourceCue)) {
    return `br create blocked: Phase 5 bead description must include a technical contract clause (API contract + DB/config source-of-truth). ` +
      `Add explicit API/request-response details and DB/settings key/source details to avoid business-only beads.`;
  }

  if (requiresFe && !hasFeVerification) {
    return `br create blocked: Phase 5 bead description must include FE E2E verification via agent-browser. ` +
      `Add an explicit FE verify clause (e.g. 'FE verify: agent-browser ... expected UI state').`;
  }

  if (requiresBe && !hasBeVerification) {
    return `br create blocked: Phase 5 bead description must include BE real API-call verification evidence. ` +
      `Add an explicit BE verify clause with curl/http endpoint and expected response/status (see .claude/lessons/runtime-conventions.md).`;
  }

  if (requiresBe && !hasBeAuthCue) {
    return `br create blocked: BE verify clause must specify auth/token source for the runtime API call. ` +
      `Mention bearer/token/login credential flow per .claude/lessons/runtime-conventions.md.`;
  }

  if (requiresBe && !hasMigrationExpectation) {
    return `br create blocked: BE/runtime clause must explicitly state migration/provisioning expectation. ` +
      `Add explicit data migration/seed/bootstrap requirement or explicit existing provisioning proof in the bead description.`;
  }

  if (requiresBe && hasMigrationRequiredCue && !hasAlembicUpgradeCommand) {
    return `br create blocked: migration-required bead must include Alembic apply command evidence. ` +
      `Add 'uv run --project onehammerStore alembic upgrade head' (or equivalent alembic upgrade head command) to the BE runtime checklist.`;
  }

  if (requiresBe && !hasRestartExpectation) {
    return `br create blocked: BE/runtime clause must explicitly state backend restart expectation. ` +
      `Add either 'no restart expected' or 'sudo systemctl restart onehammer-be' when runtime reload is needed.`;
  }

  if ((requiresBe || requiresFe) && !hasCompletionEvidenceGate) {
    return `br create blocked: Phase 5 bead description must include a completion evidence gate. ` +
      `State that br close must not run until the close reason records the actual curl/API, DB/query, migration/provisioning, and FE screenshot evidence required by the bead.`;
  }

  if (requiresBe && !hasMigrationDecisionClause) {
    return `br create blocked: BE/runtime bead description must include a migration/provisioning decision clause. ` +
      `Require the executor to inspect existing Alembic revisions before creating a new migration and classify the outcome as schema migration, data/seed migration, existing provisioning proof, or no migration required.`;
  }

  if (!hasTestSessionBudget) {
    return `br create blocked: Phase 5 bead description must include a test-session budget clause (` +
      `e.g. 'Test Session Budget: <=1 session' or 'Test Session Budget: >1 session').`;
  }

  if (overOneSession && !hasFollowUpChain) {
    return `br create blocked: test workload is marked >1 session but no follow-up test bead chaining is declared. ` +
      `Create a follow-up test bead and chain it with br dep add.`;
  }

  return null;
}

function inferFeatureModeFromState(state) {
  const p16 = phaseOutput(state, "1.6") || {};
  const answers = p16.answers && typeof p16.answers === "object" ? p16.answers : {};
  const round1 = answers.round_1 && typeof answers.round_1 === "object" ? answers.round_1 : {};

  const rawCandidates = [
    p16.feature_mode,
    answers.feature_mode,
    round1.feature_mode,
  ];

  for (const candidate of rawCandidates) {
    const normalized = normalizeFeatureMode(candidate);
    if (normalized !== "unknown") return normalized;
  }

  return "unknown";
}

function normalizeFeatureMode(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "unknown";
  if (["fullstack", "full-stack", "full_stack"].includes(raw)) return "fullstack";
  if (["fe-only", "fe only", "frontend only", "frontend-only", "thuần fe", "thuan fe"].includes(raw)) return "fe-only";
  if (["be-only", "be only", "backend only", "backend-only", "thuần be", "thuan be"].includes(raw)) return "be-only";
  return "unknown";
}

async function collectFeaturePlanCoverage(projectDir, state) {
  const feature = String(state.feature ?? "").trim();
  if (!feature) {
    return {
      phasePlanPath: null,
      missing: [],
      error: "Phase 4 approval blocked: state.feature is missing, cannot verify feature-plan phase coverage.",
    };
  }

  const phasePlanPath = phaseOutput(state, "2.5")?.phase_plan_path;
  if (!phasePlanPath) {
    return {
      phasePlanPath: null,
      missing: [],
      error: "Phase 4 approval blocked: phase_outputs.2.5.phase_plan_path is missing, cannot verify feature-plan phase coverage.",
    };
  }

  const absPhasePlan = join(projectDir, phasePlanPath);
  const phasePlanText = await readFileSafe(absPhasePlan);
  if (!phasePlanText) {
    return {
      phasePlanPath,
      missing: [],
      error: `Phase 4 approval blocked: phase-plan file '${phasePlanPath}' is missing or unreadable.`,
    };
  }

  const phaseNumbers = extractFeaturePlanPhaseNumbers(phasePlanText);
  if (phaseNumbers.length === 0) {
    return {
      phasePlanPath,
      missing: [],
      error: "Phase 4 approval blocked: could not detect feature-plan phases in phase-plan.md (expected headings like 'Phase 1:', 'Phase 2:').",
    };
  }

  const missing = [];
  for (const n of phaseNumbers) {
    const contractRel = `history/${feature}/contracts/phase-${n}-contract.md`;
    const storyRel = `history/${feature}/story-maps/phase-${n}-story-map.md`;
    if (!(await fileExists(join(projectDir, contractRel)))) missing.push(contractRel);
    if (!(await fileExists(join(projectDir, storyRel)))) missing.push(storyRel);
  }

  return { phasePlanPath, missing, error: null };
}

function extractFeaturePlanPhaseNumbers(phasePlanText) {
  const found = new Set();
  const re = /^\s*(?:#{1,6}\s*)?Phase\s+(\d+)\s*:/gim;
  let m;
  while ((m = re.exec(phasePlanText)) !== null) {
    found.add(String(Number(m[1])));
  }
  return Array.from(found).sort((a, b) => Number(a) - Number(b));
}
