// validators/pre_tool_use.mjs
// Gate rules that must fire BEFORE a tool executes.
// Returns a decision object (to be JSON-stringified by the entry point) or null to pass through.

import { preToolUseDeny, debug } from "../lib/diagnostics.mjs";
import {
  readState, isPlanningActive, phaseOutput, featurePath, fileExists, isLightweightMode, completedIncludes,
  resolvePlanningPath, historyRoot, featureWorkspacePath,
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
import {
  DISCOVERY_CONTRACT_BEGIN, DISCOVERY_LANES, REQUIRED_DISCOVERY_SUBAGENT,
  classifyDiscoveryLaneLedger, discoveryLaneFromToolInput, isMainAgentDiscoveryLane,
  isRetryableDiscoveryLaneStatus, validateDiscoveryAgentPromptContract,
} from "../lib/discovery_agent_contract.mjs";

import { readdir, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

// Regex for the "bv" CLI (beads viewer) — the bare form launches an interactive TUI.
const ALLOWED_BV_FLAGS = /(--robot-(?!plan\b)[A-Za-z0-9-]+|--export-graph|--help|-h\b|-V\b|--version)/;

// Discovery Agent calls use a versioned canonical prompt block. We still keep a
// broad heuristic to catch malformed discovery-like calls before they spawn.
const DISCOVERY_AGENT_KEYWORDS = /(discovery|architecture discovery|pattern discovery|constraint discovery|external discovery|discover\s+the\s+codebase)/i;
const PHASE_1_AGENT_DENY_GUIDANCE = `IMPORTANT: Do not launch this malformed Agent call. Use the exact ${DISCOVERY_CONTRACT_BEGIN} block from .claude/skills/planning/references/launch-discovery-agents.md, substitute the actual feature and canonical lane artifact, and launch only missing/failed/orphaned subagent lanes (Patterns, Constraints, External) as subagent_type="general-purpose" with run_in_background=true. The Architecture lane is main-agent-owned: produce history/<feature>/discovery-lanes/1-architecture.md directly with GitNexus tools (query/context/impact/route_map/cypher); never spawn a subagent for it. Do not pre-mark a lane running. Record status="running" only after the Agent launch is accepted and state has a verified agent_id/launch_id (or attempt_id plus launch_confirmed_at). A running lane without launch identity is orphaned/retryable, not a duplicate lock. Each lane agent writes only its own canonical file; the main agent reads/verifies lane files, compiles discovery.md, and manages JSON state.`;

const RESUME_BLOCKED_TOOL_NAMES = new Set([
  "AskUserQuestion",
  "Agent",
]);

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
          "Use `bv --robot-triage` / `bv --robot-insights` / `bv --robot-suggest` / `bv --robot-priority` / `bv --export-graph` / `bv --help` instead.",
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

  // 2. Target-repo-scope active feature history writes.
  const historyWriteIssue = validateHistoryWriteTarget(toolName, toolInput, projectDir, state);
  if (historyWriteIssue) return preToolUseDeny(historyWriteIssue);

  // 3. Enforce canonical phase artifact directories.
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
  }

  // 3. Block `br create` at phase >= 5 when phase_plan_approved is false.
  //    In lightweight mode the Phase 2.5 approval gate is bypassed.
  if (toolName === "Bash") {
    const cmd = typeof toolInput.command === "string" ? toolInput.command.trim() : "";
    const stripped = cmd.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)+/, "").trim();
    if (/^br\s+create\b/.test(stripped)) {
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
  if (toolName === "Agent") {
    const cp = String(state.current_phase ?? "");
    const agentText = [toolInput.name, toolInput.description, toolInput.prompt].filter(Boolean).join("\n");
    const lane = discoveryLaneFromToolInput(toolInput);
    const looksDiscovery = lane || DISCOVERY_AGENT_KEYWORDS.test(agentText) || agentText.includes(DISCOVERY_CONTRACT_BEGIN);
    if (cp !== "1") {
      if (looksDiscovery) {
        return preToolUseDeny(
          `Discovery-style Agent call blocked: planning is in phase '${cp}', not Phase 1. ` +
          `Discovery lane Agents are allowed only while current_phase=1.`,
        );
      }
    } else if (looksDiscovery) {
      if (lane && isMainAgentDiscoveryLane(lane.id)) {
        return preToolUseDeny(
          `${lane.label} discovery Agent blocked: this lane is main-agent-owned. ` +
          `Run it directly in the main agent with GitNexus tools (query/context/impact/route_map/cypher) and write ` +
          `history/${state.feature || "<feature>"}/discovery-lanes/1-architecture.md yourself, then record the lane completed in state. ` +
          `Launch subagents only for Patterns, Constraints, and External.`,
        );
      }
      const issues = [];
      if (!lane) {
        issues.push("Agent prompt/description/name must identify exactly one subagent discovery lane: Patterns, Constraints, or External (Architecture is main-agent-owned)");
      }
      const subagentType = toolInput.subagent_type ?? "";
      if (subagentType !== REQUIRED_DISCOVERY_SUBAGENT) {
        issues.push(`subagent_type must be "general-purpose" for every discovery lane (got ${toolInput.subagent_type ?? "missing"})`);
      }
      if (toolInput.run_in_background !== true) {
        issues.push("run_in_background must be true");
      }
      issues.push(...validateDiscoveryAgentPromptContract(toolInput, lane, state.feature));
      if (lane) {
        const existing = await discoveryLaneStatus(projectDir, state, lane.id);
        if (!isRetryableDiscoveryLaneStatus(existing)) {
          issues.push(`${lane.label} discovery is already ${existing}; launch only missing, failed, or orphaned lanes`);
        }
      }
      if (issues.length > 0) {
        return preToolUseDeny(`${issues.join("; ")}. ${PHASE_1_AGENT_DENY_GUIDANCE}`);
      }
    }
  }

  // 5. AskUserQuestion — Phase 0 indexes automatically with no question. Allow only
  //    Phase 1.5 business clarification, Phase 1.6 test clarification, Phase 2.5 approval,
  //    and Phase 4 approval.
  if (toolName === "AskUserQuestion") {
    const cp = String(state.current_phase ?? "");

    const allowedPhases = new Set(["1.5", "1.6", "2.5", "4"]);
    if (!allowedPhases.has(cp)) {
      return preToolUseDeny(
        `AskUserQuestion blocked: planning is in phase '${cp}'. ` +
        `Phase 0 project indexing is automatic and must not ask the user; business questions belong in Phase 1.5, test clarification belongs in Phase 1.6, phase-plan approval belongs in Phase 2.5, and story-map approval belongs in Phase 4.`,
      );
    }

    if (cp === "1.5") {
      if (!completedIncludes(state, "1")) {
        return preToolUseDeny(
          `Phase 1.5 AskUserQuestion blocked: Phase 1 discovery is not completed. ` +
          `Complete the main-agent Architecture lane (GitNexus-direct) and wait for the three subagent lanes to write their canonical discovery files, verify/read all four files, compile discovery.md, then advance to Phase 1.5.`,
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

function pathInside(base, candidate) {
  const rel = relative(base, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function validateHistoryWriteTarget(toolName, toolInput, projectDir, state) {
  if (!["Write", "Edit", "MultiEdit"].includes(toolName)) return null;
  const fp =
    typeof toolInput.file_path === "string" ? toolInput.file_path :
    typeof toolInput.path === "string" ? toolInput.path : null;
  if (!fp || !state?.feature) return null;

  const feature = String(state.feature).trim();
  if (!feature) return null;
  const normalized = String(fp).replace(/\\/g, "/").replace(/^\.\/+/, "");
  const relPrefix = `history/${feature}`;
  const isActiveRelativeHistory =
    !isAbsolute(fp) && (normalized === relPrefix || normalized.startsWith(`${relPrefix}/`));

  const expectedWorkspace = featureWorkspacePath(projectDir, state);
  if (!expectedWorkspace) return null;
  const selectedHistoryRoot = historyRoot(state, projectDir);
  const controlRoot = resolve(projectDir);

  if (isActiveRelativeHistory && selectedHistoryRoot !== controlRoot) {
    const intended = resolvePlanningPath(projectDir, state, fp);
    return `Target-repo-scoped history write blocked: relative path '${fp}' would be applied from CONTROL_ROOT ${controlRoot}, ` +
      `but the selected target repo scopes history to ${selectedHistoryRoot}. Use the target-repo path '${intended}'.`;
  }

  if (isAbsolute(fp)) {
    const actual = resolve(fp);
    const controlWorkspace = resolve(controlRoot, "history", feature);
    const looksLikeWrongControlWorkspace =
      selectedHistoryRoot !== controlRoot &&
      pathInside(controlWorkspace, actual) &&
      !pathInside(expectedWorkspace, actual);
    if (looksLikeWrongControlWorkspace) {
      return `Target-repo-scoped history write blocked: '${actual}' is under CONTROL_ROOT history, ` +
        `but active feature history belongs under '${expectedWorkspace}'.`;
    }
  }

  return null;
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
  const text = String(value || "").trim();
  if (/^br-/i.test(text)) return text.slice(3);
  const canonicalSuffix = text.match(/-([a-z0-9]+)$/i);
  return canonicalSuffix ? canonicalSuffix[1] : text;
}

export function validateCloseEvidenceForBead(id, beadText, evidenceText) {
  const bead = String(beadText || "").toLowerCase();
  const evidence = String(evidenceText || "").toLowerCase();
  const looksImplementation = /(runtime conventions source|technical contract clause|test session budget|be verification clause|fe verification clause|fullstack|be-only|fe-only)/.test(bead);
  if (!looksImplementation) return null;

  const missing = [];
  const requiresBe = /(be verification clause|real api-call|api[ -]?call|\bcurl\b|\/api\/)/.test(bead);
  const feEvidenceWaived = /(fe\s+(evidence|screenshot|verification)\s*[:=-]?\s*(n\/a|not applicable)|browser\s+evidence\s*[:=-]?\s*(n\/a|not applicable)|evidence-scope\s+mismatch|follow-?up\s+(fe|frontend|ui|browser)|fe\s+follow-?up|be-only|backend-only|api-only|db-only|no\s+fe\s+(surface|changes|evidence))/i.test(evidence);
  const requiresFe = /(fe verification clause|agent-browser)/.test(bead) && !feEvidenceWaived;
  const requiresDbQuery = /(then query|db query proof|database query|sql proof|query result|row proof|record proof|metadata proof)/.test(bead);
  const migrationRelevant = /(migration-relevant|migration required|data migration required|seed required|bootstrap required|schema migration|migration tool|alembic|prisma|flyway|liquibase|django migrate|rails db:migrate|knex|sequelize|goose)/.test(bead);
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
    if (!/(migration apply|migration command|migrations? applied|already at head|already current|existing provisioning proof|no migration required|schema already exists|alembic\s+upgrade|prisma\s+migrate\s+deploy|flyway\s+migrate|liquibase\s+update|manage\.py\s+migrate|rails\s+db:migrate|knex\s+migrate:latest|sequelize\s+db:migrate|goose\s+up)/.test(evidence)) {
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
    explicitRequirementSourcePath && await fileExists(resolvePlanningPath(projectDir, state, explicitRequirementSourcePath))
      ? explicitRequirementSourcePath
      : await resolveRequirementSourcePath(projectDir, state);

  const requiredArtifacts = expectedResumeArtifacts(state);
  const missingArtifacts = [];
  for (const rel of requiredArtifacts) {
    if (!(await fileExists(resolvePlanningPath(projectDir, state, rel)))) {
      missingArtifacts.push(rel);
    }
  }

  if (missingArtifacts.length > 0) {
    return `Resume blocked in Phase ${cp}: state.resume_context.required=true and expected prior planning artifact(s) are missing: ${missingArtifacts.join(", ")}. Read and rebuild the missing artifacts before continuing, then mark resume_context.required=false after rehydration.`;
  }

  const sourceText = requirementSourcePath
    ? `the requirement source '${requirementSourcePath}'`
    : "the requirement source recorded in planning state";
  return `Resume blocked in Phase ${cp}: state.resume_context.required=true, so reread ${sourceText} and existing planning artifacts before continuing. After rehydration, update state to set resume_context.required=false.`;
}

function expectedResumeArtifacts(state) {
  const feature = state.feature;
  if (!feature) return [];

  const artifacts = [
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
  if (sourceFromState && await fileExists(resolvePlanningPath(projectDir, state, sourceFromState))) {
    return sourceFromState;
  }

  const latest = await findLatestRequirementSource(projectDir, state, feature);
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

async function findLatestRequirementSource(projectDir, state, feature) {
  const requirementsDir = resolvePlanningPath(projectDir, state, `history/${feature}/requirements`);
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
  const lane = DISCOVERY_LANES.find((candidate) => candidate.id === laneId);
  if (!lane || !state.feature) return classifyDiscoveryLaneLedger(ledger, false);
  const rel = `history/${state.feature}/discovery-lanes/${lane.filename}`;
  const artifactExists = await fileExists(resolvePlanningPath(projectDir, state, rel));
  return classifyDiscoveryLaneLedger(ledger, artifactExists);
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

export function validatePhase5VerificationClauses(command, state) {
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
  const hasMigrationDecisionClause = /(migration\s+decision|inspect\s+existing\s+(migration|provisioning|revision|schema)\s*(history|artifacts?|files?|revisions?)?|inspect\s+existing\s+alembic\s+revisions|before\s+creating\s+.*migration|schema\s+migration|data\s*\/\s*seed\s+migration|seed\s+migration|no\s+migration\s+required|existing\s+provisioning\s+proof)/.test(lower);
  const overOneSession = /(>\s*1\s*session|more\s+than\s+1\s*session|over\s+1\s*session|multi-?session|2\+\s*sessions)/.test(lower);
  const hasFollowUpChain = /(follow-?up\s+test\s+bead|create\s+.*test\s+bead.*(after|next)|br\s+dep\s+add|depends\s+on|blocked\s+by)/.test(lower);

  const hasNoMigrationExpectation = /(no\s+migration\s+expected|migration\s*:\s*none|no\s+schema\s+change|schema\s*unchanged)/.test(lower);
  const hasMigrationRequiredCue = /(migration\s+(required|expected)|create\s+migration|apply\s+migration|alembic\s+revision|schema\s+change\s+required|data\s+migration\s+required|seed\s+required|bootstrap\s+required)/.test(lower);
  const hasMigrationExpectation = hasNoMigrationExpectation || hasMigrationRequiredCue;
  const hasMigrationApplyCommand = /(migration\s+(apply|command)|apply\s+migration|migrate\s+(up|deploy|latest)|alembic\s+upgrade(?:\s+head)?|prisma\s+migrate\s+deploy|flyway\s+migrate|liquibase\s+update|manage\.py\s+migrate|rails\s+db:migrate|knex\s+migrate:latest|sequelize\s+db:migrate|goose\s+up|repo[- ]specific\s+migration\s+command|project[- ]specific\s+migration\s+command)/.test(lower);

  const hasRuntimeSettingsSource = /(db\s+settings|settings\s+key|settings\s+table|source\s+of\s+truth|config\s+key)/.test(lower);
  const expectsRuntime200 = /(get\s+\/api\/|\/api\/|expected\s+200|returns?\s+200|status\s+200|payload)/.test(lower);
  const mentionsMissingConfigFail = /(missing\s+config|missing\s+setting|fail\s+500|500\s*\/\s*domain\s+error|domain\s+error)/.test(lower);
  const hasBootstrapProof = /(data\s+migration\s+required|seed\s+required|bootstrap\s+required|migration\s+(artifact|path|file|revision)|existing\s+provisioning\s+proof|existing\s+key\s+proof|provisioning\s+proof|repo[- ]native\s+migration|project[- ]specific\s+migration)/.test(lower);

  const hasNoRestartExpectation = /(no\s+restart\s+expected|restart\s*:\s*not\s+needed|no\s+runtime\s+reload\s+needed)/.test(lower);
  const hasRestartRequiredCue = /(restart\s+(required|needed)|reload\s+(required|needed)|service\s+restart|process\s+restart|backend\s+restart|runtime\s+reload)/.test(lower);
  const hasRestartExpectation = hasNoRestartExpectation || hasRestartRequiredCue;

  const explicitNoFe = /(fe\s+(evidence|screenshot|verification)\s*[:=-]?\s*(n\/a|not applicable)|browser\s+evidence\s*[:=-]?\s*(n\/a|not applicable)|be-only|backend-only|api-only|db-only|thuần\s*be|no\s+fe\s+(surface|changes|evidence)|frontend\s*[:=-]?\s*(n\/a|not applicable))/i.test(lower);
  const explicitNoBe = /(be\s+(evidence|verification)\s*[:=-]?\s*(n\/a|not applicable)|backend\s*[:=-]?\s*(n\/a|not applicable)|fe-only|frontend-only|ui-only|browser-only|thuần\s*fe|no\s+be\s+(surface|changes|evidence))/i.test(lower);
  const beadHasFeSurface = !explicitNoFe && /(fe\s+verification\s+clause|agent-browser|browser\s+evidence|screenshot|frontend|\bui\b|react|nextjs|page|component|screen|visual|button|form|client\s+app)/i.test(lower);
  const beadHasBeSurface = !explicitNoBe && /(be\s+verification\s+clause|backend|service|worker|\bapi\b|\/api\/|endpoint|curl|http|\bdb\b|database|settings\s+key|settings\s+table|migration|runtime|schema|seed|provisioning)/i.test(lower);

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
      `Add a repo-native migration/seed/provisioning artifact at the path required by active repo/project instructions, or explicit existing-key provisioning proof. ` +
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

  if (requiresBe && hasMigrationRequiredCue && !hasMigrationApplyCommand) {
    return `br create blocked: migration-required bead must include the repository-appropriate migration apply command evidence. ` +
      `Use the command declared by active repo/project instructions or runtime conventions; do not assume Alembic or a fixed project path.`;
  }

  if (requiresBe && !hasRestartExpectation) {
    return `br create blocked: BE/runtime clause must explicitly state backend restart expectation. ` +
      `Add either 'no restart expected' or the repository-appropriate service/process restart or reload command when runtime reload is needed.`;
  }

  if ((requiresBe || requiresFe) && !hasCompletionEvidenceGate) {
    return `br create blocked: Phase 5 bead description must include a completion evidence gate. ` +
      `State that br close must not run until the close reason records the actual curl/API, DB/query, migration/provisioning, and FE screenshot evidence required by the bead.`;
  }

  if (requiresBe && !hasMigrationDecisionClause) {
    return `br create blocked: BE/runtime bead description must include a migration/provisioning decision clause. ` +
      `Require the executor to inspect existing repo-native migration/provisioning history before creating a new artifact and classify the outcome as schema migration, data/seed migration, existing provisioning proof, or no migration required.`;
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

  const absPhasePlan = resolvePlanningPath(projectDir, state, phasePlanPath);
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
    if (!(await fileExists(resolvePlanningPath(projectDir, state, contractRel)))) missing.push(contractRel);
    if (!(await fileExists(resolvePlanningPath(projectDir, state, storyRel)))) missing.push(storyRel);
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

export { validateDiscoveryAgentPromptContract } from "../lib/discovery_agent_contract.mjs";
