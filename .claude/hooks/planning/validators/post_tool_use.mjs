// validators/post_tool_use.mjs
// Validates artifacts just written/edited and parses bv robot output for cycles.

import { stat } from "node:fs/promises";
import { join } from "node:path";
import { additionalContext, topLevelBlock } from "../lib/diagnostics.mjs";
import { PHASE_SEQUENCE, phaseIndex } from "../lib/phase_gates.mjs";
import {
  readFileSafe, missingSections,
  APPROACH_SECTIONS, DISCOVERY_SECTIONS,
  looksLikeApproachFile, looksLikeDiscoveryFile,
  looksLikeContractFile, looksLikeStoryMapFile,
  CONTRACT_SECTIONS, STORY_MAP_SECTIONS,
  looksLikeStateFile, extractFilePath,
} from "../lib/artifacts.mjs";
import { readState, fileExists, isLightweightMode, resolvePlanningPath, featureWorkspacePath, historyRoot } from "../lib/state.mjs";
import { validateRecordedIndexResolution } from "../lib/index_root_resolver.mjs";
import {
  DISCOVERY_CONTRACT_BEGIN, hasVerifiedDiscoveryLaunchIdentity, isMainAgentDiscoveryLane,
} from "../lib/discovery_agent_contract.mjs";

const REQUIRED_MCP_SERVERS = ["serena", "exa", "gitnexus"];
const PHASE_ZERO_BOOL_FIELDS = [
  "mcp_json_checked",
  "serena_onboarding_checked",
  "serena_ready",
  "project_index_ran",
  "project_index_ok",
  "serena_index_ok",
  "gitnexus_index_ok",
  "br_help_ok",
  "bv_help_ok",
  "jq_ok",
];
const LIGHTWEIGHT_SKIPPABLE_PHASES = new Set(["2.5", "3", "4"]);
const PHASE7_READY_VERDICTS = new Set(["READY", "READY_LITE", "READY_TARGETED"]);
const PHASE7_VALIDATION_MODES = new Set(["mechanical_lite", "targeted", "full"]);

const DISCOVERY_LANE_PATHS = [
  { id: "architecture", label: "Architecture", rel: (feature) => `history/${feature}/discovery-lanes/1-architecture.md` },
  { id: "patterns", label: "Patterns", rel: (feature) => `history/${feature}/discovery-lanes/2-patterns.md` },
  { id: "constraints", label: "Constraints", rel: (feature) => `history/${feature}/discovery-lanes/3-constraints.md` },
  { id: "external", label: "External", rel: (feature) => `history/${feature}/discovery-lanes/4-external.md` },
];
const PHASE_1_LAUNCH_GUIDANCE = `IMPORTANT: Phase 0 succeeded; start Phase 1 immediately. Copy the exact ${DISCOVERY_CONTRACT_BEGIN} prompt block from .claude/skills/planning/references/launch-discovery-agents.md for each missing subagent lane (Patterns, Constraints, External), substitute the actual feature/artifact, and launch as subagent_type="general-purpose" with run_in_background=true. Then, while those run, execute the Architecture lane in the main agent itself using GitNexus tools (query/context/impact/route_map/cypher) and write history/<feature>/discovery-lanes/1-architecture.md directly — do not spawn an Architecture subagent. Do not pre-mark subagent lanes running. Record status="running" only after an accepted launch with agent_id/launch_id (or attempt_id plus launch_confirmed_at). A running lane without launch identity is orphaned/retryable. After all four canonical files exist, read/verify them, fill only specific gaps, compile discovery.md, and record completion state.`;

const QUESTIONS_PER_ROUND = 4;
const PHASE_15_TOTAL_QUESTIONS = 12;
const PHASE_15_OPTIONAL_ROUND_TOTAL_QUESTIONS = 16;
const PHASE_16_TOTAL_QUESTIONS = 8;
const PHASE_15_GUIDANCE_TEMPLATE = (asked) => {
  const round = Math.floor(asked / QUESTIONS_PER_ROUND) + 1;
  const totalRounds = PHASE_15_TOTAL_QUESTIONS / QUESTIONS_PER_ROUND;
  return `IMPORTANT: Phase 1.5 — business clarification. Keep the normal contract: ${PHASE_15_TOTAL_QUESTIONS} total questions across ${totalRounds} rounds, exactly ${QUESTIONS_PER_ROUND} per AskUserQuestion call. Currently asked=${asked}, next round index=${round}. Each question must target one load-bearing business decision (scope cut, priority trade-off, success criterion, edge-case rule, ownership, rollout) and expose >=2 concrete options the user can pick. Round 2/3 must avoid duplicate intent unless followup_reason is explicit. If anomaly_scan.unresolved_count > 0, include direct anomaly-resolution questions (keep/remove/deprecate/migrate/ignore intentionally). After ${PHASE_15_TOTAL_QUESTIONS} questions, optional Round 4 is allowed only for unresolved anomaly and must be resolution-only (no broad new discovery). Hard cap is ${PHASE_15_OPTIONAL_ROUND_TOTAL_QUESTIONS} questions.`;
};
const PHASE_16_GUIDANCE_TEMPLATE = (asked) => {
  const round = Math.floor(asked / QUESTIONS_PER_ROUND) + 1;
  const totalRounds = PHASE_16_TOTAL_QUESTIONS / QUESTIONS_PER_ROUND;
  return `IMPORTANT: Phase 1.6 — test clarification. Ask exactly ${PHASE_16_TOTAL_QUESTIONS} high-signal test questions across ${totalRounds} rounds (${QUESTIONS_PER_ROUND} per AskUserQuestion). Cover feature mode classification (fullstack/fe-only/be-only), acceptance proof, failure-path proof, evidence artifacts, FE screenshot timing checkpoints (before/after important action + final) for FE-involving modes, environment/data setup, rollout verification, and sign-off owner. After each round increment phase_outputs."1.6".questions_asked by ${QUESTIONS_PER_ROUND}. When questions_asked === ${PHASE_16_TOTAL_QUESTIONS}, write test-scenarios.md with mode-aware FE/BE/integration evidence matrix, then continue immediately to Phase 2 and Phase 2.5 approval prep without extra pause.`;
};

export async function validatePostToolUse(input, projectDir) {
  const toolName = input.tool_name;
  const toolInput = input.tool_input || {};
  const toolResponse = input.tool_response || {};

  // 1. Write/Edit of approach.md — check 4 required sections.
  if (toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit") {
    const fp = extractFilePath(toolName, toolInput);
    if (fp) {
      const lanePathIssue = validateDiscoveryLaneArtifactPath(fp);
      if (lanePathIssue) return topLevelBlock(lanePathIssue);
      if (/(^|\/)history\/[^/]+\/phase-[^/]+-(contract|story-map)\.md$/.test(fp)) {
        return topLevelBlock(
          `Flat phase artifact path blocked: '${fp}'. ` +
          `Write contracts to history/<feature>/contracts/phase-<n>-contract.md and story maps to history/<feature>/story-maps/phase-<n>-story-map.md.`,
        );
      }

      const { state: pathState } = await readState(projectDir);
      const abs = resolvePlanningPath(projectDir, pathState, fp);
      if (looksLikeApproachFile(fp)) {
        const text = await readFileSafe(abs);
        if (text != null) {
          const missing = missingSections(text, APPROACH_SECTIONS);
          if (missing.length > 0) {
            return topLevelBlock(
              `approach.md at ${fp} is missing required section(s): ${missing.join(", ")}. ` +
              `All four are mandatory: ${APPROACH_SECTIONS.join(" / ")}.`,
            );
          }
        }
      }
      if (looksLikeDiscoveryFile(fp)) {
        const text = await readFileSafe(abs);
        if (text != null) {
          const missing = missingSections(text, DISCOVERY_SECTIONS);
          if (missing.length > 0) {
            return topLevelBlock(
              `discovery.md at ${fp} is missing required section(s): ${missing.join(", ")}. ` +
              `Required sections (per SKILL.md): ${DISCOVERY_SECTIONS.join(" / ")}.`,
            );
          }
        }
      }
      if (looksLikeContractFile(fp)) {
        const text = await readFileSafe(abs);
        if (text != null) {
          const missing = missingSections(text, CONTRACT_SECTIONS);
          if (missing.length > 0) {
            return topLevelBlock(
              `contracts/phase-<n>-contract.md at ${fp} is missing section(s): ${missing.join(", ")}. ` +
              `Required: ${CONTRACT_SECTIONS.join(" / ")}.`,
            );
          }
          const bootstrapInvariantIssue = validateBootstrapProvisioningInvariant(text);
          if (bootstrapInvariantIssue) {
            return topLevelBlock(
              `contracts/phase-<n>-contract.md at ${fp} violates bootstrap/provisioning invariant: ${bootstrapInvariantIssue}`,
            );
          }
        }
      }
      if (looksLikeStoryMapFile(fp)) {
        const text = await readFileSafe(abs);
        if (text != null) {
          const missing = missingSections(text, STORY_MAP_SECTIONS);
          if (missing.length > 0) {
            return topLevelBlock(
              `story-maps/phase-<n>-story-map.md at ${fp} is missing section(s): ${missing.join(", ")}. ` +
              `Required: ${STORY_MAP_SECTIONS.join(" / ")}.`,
            );
          }
        }
      }
      // Validate the authoritative JSON state update and all phase invariants.
      if (looksLikeStateFile(fp)) {
        const maybe = await validateStateTransition(projectDir);
        if (maybe) return maybe;
        const guidance = await phase1LaunchGuidance(projectDir);
        if (guidance) return guidance;
        const ph15 = await phase15Guidance(projectDir);
        if (ph15) return ph15;
        const ph16 = await phase16Guidance(projectDir);
        if (ph16) return ph16;
        const ph2 = await phase2ContinuityGuidance(projectDir);
        if (ph2) return ph2;
        const ph34 = await phase3Phase4ContinuityGuidance(projectDir);
        if (ph34) return ph34;
      }
    }
  }

  // 2. Bash: parse bv --robot-insights output for non-empty cycles.
  if (toolName === "Bash") {
    const cmd = typeof toolInput.command === "string" ? toolInput.command : "";
    if (/\bbv\s+[^|;&]*--robot-insights/.test(cmd)) {
      const stdout =
        (typeof toolResponse === "string" ? toolResponse : null) ||
        toolResponse.stdout ||
        toolResponse.output ||
        "";
      if (typeof stdout === "string" && stdout.trim().length > 0) {
        const cyclesIssue = detectCycles(stdout);
        if (cyclesIssue) {
          return topLevelBlock(
            `bv --robot-insights reported cycles. Phase 7 gate blocks until cycles are []. ` +
            `Cycles found: ${cyclesIssue}. Fix circular deps and re-run.`,
          );
        }
      }
    }
  }

  return null;
}

function validateDiscoveryLaneArtifactPath(fp) {
  if (typeof fp !== "string") return null;
  const match = fp.match(/(^|\/)(history\/([^/]+)\/discovery-lanes\/)([^/]+\.md)$/);
  if (!match) return null;

  const [, , prefix, feature, filename] = match;
  const allowed = new Map(DISCOVERY_LANE_PATHS.map((lane) => [lane.rel(feature).split("/").pop(), lane.label]));
  if (allowed.has(filename)) return null;

  const unnumbered = filename.match(/^(architecture|patterns|constraints|external)\.md$/);
  const canonical = unnumbered
    ? DISCOVERY_LANE_PATHS.find((lane) => lane.id === unnumbered[1])?.rel(feature)
    : null;
  const allowedList = DISCOVERY_LANE_PATHS.map((lane) => `history/${feature}/discovery-lanes/${lane.rel(feature).split("/").pop()}`).join(", ");
  return canonical
    ? `Phase 1 discovery lane artifact must use canonical numbered filename. Write ${canonical} instead of ${prefix}${filename}.`
    : `Invalid Phase 1 discovery lane artifact path ${prefix}${filename}. Use one of: ${allowedList}.`;
}

async function phase1LaunchGuidance(projectDir) {
  const { state, legacy, missing } = await readState(projectDir);
  if (legacy || missing || !state) return null;
  if (String(state.current_phase ?? "") !== "1") return null;
  const completed = Array.isArray(state.completed_phases)
    ? state.completed_phases.map(String)
    : [];
  if (!completed.includes("0")) return null;
  if (state.phase_outputs?.["1"]?.status === "completed") return null;
  return additionalContext("PostToolUse", PHASE_1_LAUNCH_GUIDANCE);
}

async function phase15Guidance(projectDir) {
  const { state, legacy, missing } = await readState(projectDir);
  if (legacy || missing || !state) return null;
  if (String(state.current_phase ?? "") !== "1.5") return null;
  const p15 = state.phase_outputs?.["1.5"];
  if (p15?.status === "completed") return null;
  const asked = Number(p15?.questions_asked ?? 0);
  const unresolved = phase15UnresolvedAnomalyCount(p15);
  if (Number.isFinite(asked) && asked >= PHASE_15_TOTAL_QUESTIONS && unresolved <= 0) return null;
  if (Number.isFinite(asked) && asked >= PHASE_15_OPTIONAL_ROUND_TOTAL_QUESTIONS) return null;
  return additionalContext("PostToolUse", PHASE_15_GUIDANCE_TEMPLATE(Number.isFinite(asked) ? asked : 0));
}

async function phase16Guidance(projectDir) {
  const { state, legacy, missing } = await readState(projectDir);
  if (legacy || missing || !state) return null;
  if (String(state.current_phase ?? "") !== "1.6") return null;
  const p16 = state.phase_outputs?.["1.6"];
  if (p16?.status === "completed") return null;
  const asked = Number(p16?.questions_asked ?? 0);
  if (Number.isFinite(asked) && asked >= PHASE_16_TOTAL_QUESTIONS) return null;
  return additionalContext("PostToolUse", PHASE_16_GUIDANCE_TEMPLATE(Number.isFinite(asked) ? asked : 0));
}

async function phase2ContinuityGuidance(projectDir) {
  const { state, legacy, missing } = await readState(projectDir);
  if (legacy || missing || !state) return null;
  if (String(state.current_phase ?? "") !== "2") return null;
  if (state.phase_plan_approved === true) return null;
  return additionalContext(
    "PostToolUse",
    "IMPORTANT: Phase 2 should run continuously into Phase 2.5 approval prep. After writing approach.md, immediately write phase-plan.md and issue the exact Phase 2.5 approval AskUserQuestion. Do not insert extra confirmation pauses before the approval prompt.",
  );
}

async function phase3Phase4ContinuityGuidance(projectDir) {
  const { state, legacy, missing } = await readState(projectDir);
  if (legacy || missing || !state) return null;

  const cp = String(state.current_phase ?? "");
  if (state.phase_plan_approved !== true) return null;

  if (cp === "3") {
    return additionalContext(
      "PostToolUse",
      "IMPORTANT: After Phase 2.5 approval, continue in one run through Phase 3 and Phase 4. Before asking Phase 4 approval in full mode, ensure every phase declared in phase-plan.md has both artifacts: history/<feature>/contracts/phase-<n>-contract.md and history/<feature>/story-maps/phase-<n>-story-map.md.",
    );
  }

  if (cp === "4") {
    return additionalContext(
      "PostToolUse",
      "IMPORTANT: Phase 4 should end with the exact approval AskUserQuestion for the whole story-map set (Approve/Revise). Do not insert extra confirmation pauses before that approval prompt. After exact Approve, continue immediately in one run through Phase 5 and Phase 7, then stop planning when Phase 7 records a READY* verdict.",
    );
  }

  if (["5", "7"].includes(cp)) {
    const p4Approval = state.phase_outputs?.["4_approval"];
    const approved =
      p4Approval &&
      p4Approval.status === "completed" &&
      p4Approval.approved === true &&
      p4Approval.approval_response === "Approve";

    if (approved) {
      return additionalContext(
        "PostToolUse",
        "IMPORTANT: Phase 4 was approved. Continue planning in one run with no extra confirmation pauses: Phase 5 decomposition -> Phase 7 validation -> stop with the validated bead graph/state on READY/READY_LITE/READY_TARGETED.",
      );
    }
  }

  return null;
}

// When the state file is written, verify phase_outputs.<N>.status === 'completed'
// artifacts are all present on disk. Only block on hard misses to avoid false positives.
async function validateStateTransition(projectDir) {
  const { state, legacy, missing } = await readState(projectDir);
  if (legacy || missing || !state) return null;
  const po = state.phase_outputs || {};

  const orderingIssue = validatePhaseOrdering(state);
  if (orderingIssue) return topLevelBlock(orderingIssue);

  const phase0Issue = await validatePhase0Evidence(projectDir, state, po["0"]);
  if (phase0Issue) return topLevelBlock(phase0Issue);


  const checks = [
    { k: "1", fields: ["discovery_path"] },
    { k: "1.5", fields: ["requirements_path"] },
    { k: "1.6", fields: ["test_scenarios_path"] },
    { k: "2", fields: ["approach_path"] },
    { k: "2.5", fields: ["phase_plan_path"] },
    { k: "3", fields: ["contract_paths", "contract_path"] },
    { k: "4", fields: ["story_map_paths", "story_map_path"] },
  ];
  for (const c of checks) {
    const entry = po[c.k];
    if (!entry) continue;
    if (entry.status !== "completed") continue;
    const field = c.fields.find((candidate) => entry[candidate]);
    if (!field) {
      return topLevelBlock(
        `State says phase ${c.k} is completed but none of phase_outputs.${c.k}.${c.fields.join("/")} is present. ` +
        `Record the artifact path(s) before marking the phase completed.`,
      );
    }
    const rels = Array.isArray(entry[field]) ? entry[field] : [entry[field]];
    for (const relValue of rels) {
      const rel = String(relValue || "").trim();
      if (!rel) {
        return topLevelBlock(
          `State says phase ${c.k} is completed but phase_outputs.${c.k}.${field} contains an empty artifact path.`,
        );
      }
      const abs = resolvePlanningPath(projectDir, state, rel);
      if (!(await fileExists(abs))) {
        return topLevelBlock(
          `State says phase ${c.k} is completed but ${field} '${rel}' does not exist on disk. ` +
          `Either write the artifact or revert the state entry.`,
        );
      }
    }
  }

  const phase1LifecycleIssue = validatePhase1LaneLifecycle(po["1"]);
  if (phase1LifecycleIssue) return topLevelBlock(phase1LifecycleIssue);

  const phase1Issue = await validatePhase1Artifacts(projectDir, state, po["1"]);
  if (phase1Issue) return topLevelBlock(phase1Issue);

  const phase15Issue = validatePhase15Questions(state, po["1.5"]);
  if (phase15Issue) return topLevelBlock(phase15Issue);

  const phase16Issue = await validatePhase16QuestionsAndScenarios(projectDir, state, po["1.6"]);
  if (phase16Issue) return topLevelBlock(phase16Issue);

  const p25 = po["2.5"];
  if (p25 && p25.status === "completed") {
    if (state.phase_plan_approved !== true || p25.approved !== true || p25.approval_response !== "Approve") {
      return topLevelBlock(
        `Phase 2.5 marked completed but approval invariants are not satisfied. ` +
        `Require state.phase_plan_approved=true, phase_outputs.2.5.approved=true, and approval_response="Approve".`,
      );
    }
  }

  const completed = Array.isArray(state.completed_phases)
    ? state.completed_phases.map(String)
    : [];
  const p7 = po["7"] || {};
  const phase7GateIssue = validatePhase7AtomicGate(state, p7, { completed });
  if (phase7GateIssue) return topLevelBlock(phase7GateIssue);

  const p4Approval = po["4_approval"];
  if (phaseIndex(String(state.current_phase ?? "")) >= phaseIndex("5") && !isLightweightMode(state)) {
    const phase4GateClosed =
      p4Approval &&
      p4Approval.status === "completed" &&
      p4Approval.approved === true &&
      p4Approval.approval_response === "Approve";
    if (!phase4GateClosed) {
      return topLevelBlock(
        `Phase 5+ requires a fully closed Phase 4 approval gate. ` +
        `Require phase_outputs.4_approval.status="completed", approved=true, approval_response="Approve" before current_phase>=5.`,
      );
    }
  }

  if (p4Approval && p4Approval.status === "completed") {
    if (p4Approval.approved !== true || p4Approval.approval_response !== "Approve") {
      return topLevelBlock(
        `Phase 4 approval marked completed but approval invariants are not satisfied. ` +
        `Require phase_outputs.4_approval.approved=true and approval_response="Approve".`,
      );
    }
    const p4StoryMapPaths = Array.isArray(p4Approval.story_map_paths)
      ? p4Approval.story_map_paths
      : p4Approval.story_map_path
        ? [p4Approval.story_map_path]
        : [];
    if (p4StoryMapPaths.length === 0) {
      return topLevelBlock(
        `Phase 4 approval marked completed but story_map_paths is missing. ` +
        `Record phase_outputs.4_approval.story_map_paths for the whole approved story-map set before completing this gate.`,
      );
    }
    for (const storyMapPath of p4StoryMapPaths) {
      const rel = String(storyMapPath || "").trim();
      if (!rel) {
        return topLevelBlock(
          `Phase 4 approval marked completed but story_map_paths contains an empty artifact path.`,
        );
      }
      const absP4 = resolvePlanningPath(projectDir, state, rel);
      if (!(await fileExists(absP4))) {
        return topLevelBlock(
          `Phase 4 approval marked completed but story_map_paths entry '${rel}' does not exist on disk.`,
        );
      }
    }
  }

  const phaseCoverageIssue = await validateFeaturePlanCoverageForBeads(projectDir, state, po);
  if (phaseCoverageIssue) return topLevelBlock(phaseCoverageIssue);

  const beadCoverageIssue = await validatePhase5BeadCoverage(projectDir, state, po);
  if (beadCoverageIssue) return topLevelBlock(beadCoverageIssue);

  return null;
}

function validatePhase7AtomicGate(state, p7, { completed }) {
  const hasPhase7Record = p7 && Object.keys(p7).length > 0;
  if (!hasPhase7Record) return null;

  if (p7.status !== "completed") {
    return null;
  }

  const mode = String(p7.validation_mode ?? "");
  if (!PHASE7_VALIDATION_MODES.has(mode)) {
    return `Phase 7 marked completed but validation_mode is invalid (${p7.validation_mode ?? "missing"}). ` +
      `Require one of: ${Array.from(PHASE7_VALIDATION_MODES).join("/")}.`;
  }

  const cyclesFound = Number(p7.cycles_found);
  if (!Number.isFinite(cyclesFound) || cyclesFound !== 0) {
    return `Phase 7 marked completed but cycles_found must be 0 (current: ${p7.cycles_found ?? "missing"}).`;
  }

  const verdict = String(p7.semantic_verdict ?? "");
  if (!PHASE7_READY_VERDICTS.has(verdict)) {
    return `Phase 7 marked completed but semantic validation is incomplete. ` +
      `Require semantic_verdict in ${Array.from(PHASE7_READY_VERDICTS).join("/")} before completing terminal Phase 7.`;
  }

  const validatorId = p7.validator_invocation_id;
  if (mode === "full") {
    if (typeof validatorId !== "string" || validatorId.trim().length === 0) {
      return "Phase 7 validation_mode=full requires validator_invocation_id from skill(planning-validator).";
    }
  } else if (validatorId != null) {
    return `Phase 7 validation_mode=${mode} requires validator_invocation_id=null (planning-validator is full-only).`;
  }

  if (!completed.includes("7")) {
    return `Phase 7 marked completed but completed_phases is missing \"7\". ` +
      `Add \"7\" in the same atomic terminal state update.`;
  }

  if (String(state.current_phase ?? "") !== "7") {
    return `Phase 7 marked completed with a READY* verdict but current_phase must remain \"7\" as the terminal planning phase ` +
      `(current: ${state.current_phase ?? "missing"}).`;
  }

  if (state.planning_active !== false) {
    return `Phase 7 marked completed with a READY* verdict but planning_active must be false. ` +
      `End the mandatory planning pipeline atomically at Phase 7.`;
  }

  return null;
}

async function validateFeaturePlanCoverageForBeads(projectDir, state, phaseOutputs) {
  if (!state || isLightweightMode(state)) return null;

  const completed = Array.isArray(state.completed_phases)
    ? state.completed_phases.map(String)
    : [];
  const p5 = phaseOutputs?.["5"] || {};
  const curIdx = phaseIndex(String(state.current_phase ?? ""));
  const phase5Reached =
    curIdx >= phaseIndex("5") ||
    completed.includes("5") ||
    ["in_progress", "completed"].includes(String(p5.status ?? ""));

  if (!phase5Reached) return null;

  const feature = String(state.feature ?? "").trim();
  if (!feature) {
    return "Phase 5 coverage gate cannot run because state.feature is missing.";
  }

  const phasePlanPath = phaseOutputs?.["2.5"]?.phase_plan_path;
  if (!phasePlanPath) {
    return "Phase 5 coverage gate failed: phase_outputs.2.5.phase_plan_path is missing.";
  }

  const absPhasePlan = resolvePlanningPath(projectDir, state, phasePlanPath);
  const phasePlanText = await readFileSafe(absPhasePlan);
  if (!phasePlanText) {
    return `Phase 5 coverage gate failed: phase-plan '${phasePlanPath}' is missing or unreadable.`;
  }

  const phaseNumbers = extractFeaturePlanPhaseNumbers(phasePlanText);
  if (phaseNumbers.length === 0) {
    return `Phase 5 coverage gate failed: could not detect feature-plan phases in '${phasePlanPath}'. ` +
      `Expected headings like 'Phase 1:', 'Phase 2:', ...`;
  }

  const missing = [];
  for (const n of phaseNumbers) {
    const contractRel = `history/${feature}/contracts/phase-${n}-contract.md`;
    const storyRel = `history/${feature}/story-maps/phase-${n}-story-map.md`;
    if (!(await fileExists(resolvePlanningPath(projectDir, state, contractRel)))) missing.push(contractRel);
    if (!(await fileExists(resolvePlanningPath(projectDir, state, storyRel)))) missing.push(storyRel);
  }

  if (missing.length > 0) {
    return `Phase 5 coverage gate failed: missing feature-plan artifact(s): ${missing.join(", ")}. ` +
      `Before decomposition, create contract+story-map for every phase declared in '${phasePlanPath}'.`;
  }

  return null;
}

async function validatePhase5BeadCoverage(projectDir, state, phaseOutputs) {
  if (!state || isLightweightMode(state)) return null;

  const completed = Array.isArray(state.completed_phases)
    ? state.completed_phases.map(String)
    : [];
  const p5 = phaseOutputs?.["5"] || {};
  const p7 = phaseOutputs?.["7"] || {};
  const curIdx = phaseIndex(String(state.current_phase ?? ""));
  const phase7Reached =
    curIdx >= phaseIndex("7") ||
    completed.includes("7") ||
    ["completed", "in_progress"].includes(String(p7.status ?? ""));

  if (!phase7Reached) return null;

  const feature = String(state.feature ?? "").trim();
  if (!feature) {
    return "Phase 5 bead coverage gate cannot run because state.feature is missing.";
  }

  const phasePlanPath = phaseOutputs?.["2.5"]?.phase_plan_path;
  if (!phasePlanPath) {
    return "Phase 5 bead coverage gate failed: phase_outputs.2.5.phase_plan_path is missing.";
  }

  const absPhasePlan = resolvePlanningPath(projectDir, state, phasePlanPath);
  const phasePlanText = await readFileSafe(absPhasePlan);
  if (!phasePlanText) {
    return `Phase 5 bead coverage gate failed: phase-plan '${phasePlanPath}' is missing or unreadable.`;
  }

  const phaseNumbers = extractFeaturePlanPhaseNumbers(phasePlanText);
  if (phaseNumbers.length === 0) {
    return `Phase 5 bead coverage gate failed: could not detect feature-plan phases in '${phasePlanPath}'. ` +
      `Expected headings like 'Phase 1:', 'Phase 2:', ...`;
  }

  const expectedStoryMaps = phaseNumbers.map((n) => `history/${feature}/story-maps/phase-${n}-story-map.md`);
  const recordedStoryMaps = Array.isArray(p5.story_map_paths)
    ? p5.story_map_paths.map((p) => String(p || "").trim()).filter(Boolean)
    : [];

  if (recordedStoryMaps.length === 0) {
    return "Phase 5 bead coverage gate failed: phase_outputs.5.story_map_paths is missing. " +
      "Record all story-map files covered by bead decomposition before advancing to Phase 7.";
  }

  const missingFromState = expectedStoryMaps.filter((rel) => !recordedStoryMaps.includes(rel));
  if (missingFromState.length > 0) {
    return `Phase 5 bead coverage gate failed: phase_outputs.5.story_map_paths is incomplete. Missing: ${missingFromState.join(", ")}.`;
  }

  const knownCanonicalBeadIds = await collectKnownCanonicalBeadIds(projectDir, state);
  const uncoveredMaps = [];
  for (const storyRel of expectedStoryMaps) {
    const storyAbs = resolvePlanningPath(projectDir, state, storyRel);
    const storyText = await readFileSafe(storyAbs);
    if (!storyText) {
      uncoveredMaps.push(`${storyRel} (missing/unreadable)`);
      continue;
    }

    if (/\<(?:actual-beads-id|beads-id|issue-id)\>/i.test(storyText)) {
      uncoveredMaps.push(`${storyRel} (still has placeholder Beads issue id)`);
      continue;
    }

    if (!storyMapHasCanonicalBeadId(storyText, knownCanonicalBeadIds)) {
      uncoveredMaps.push(`${storyRel} (no canonical actual Beads issue id found in Story-To-Bead mapping; preserve the exact ID returned by br and do not assume a project prefix)`);
    }
  }

  if (uncoveredMaps.length > 0) {
    return `Phase 5 bead coverage gate failed: story-map to bead mapping is incomplete for declared phases: ${uncoveredMaps.join(", ")}. ` +
      "Fill Story-To-Bead mapping with real canonical Beads issue IDs for every declared phase before Phase 7.";
  }

  return null;
}


async function collectKnownCanonicalBeadIds(projectDir, state) {
  const roots = new Set([projectDir, historyRoot(projectDir, state)]);
  const ids = new Set();

  for (const root of roots) {
    for (const rel of [".beads/issues.jsonl", ".beads/beads.jsonl"]) {
      const text = await readFileSafe(join(root, rel));
      if (!text) continue;
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const issue = JSON.parse(trimmed);
          const id = String(issue?.id || "").trim();
          if (id && !/^br-/i.test(id)) ids.add(id);
        } catch {
          continue;
        }
      }
    }
  }

  return ids;
}

export function storyMapHasCanonicalBeadId(storyText, knownIds) {
  const text = String(storyText || "");
  const mappingMatch = text.match(/(?:^|\n)#{1,6}\s*(?:\d+\.\s*)?Story-To-Bead Mapping\b[\s\S]*/i);
  const mapping = mappingMatch ? mappingMatch[0] : text;

  for (const id of knownIds) {
    if (mapping.includes(id)) return true;
  }

  const beadCells = mapping
    .split(/\r?\n/)
    .filter((line) => /^\s*\|/.test(line))
    .map((line) => line.split("|").map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 4)
    .map((cells) => cells[2])
    .filter((cell) => cell && !/^beads?$/i.test(cell) && !/^[-:]+$/.test(cell));

  const candidates = beadCells.flatMap((cell) =>
    cell.match(/\b[a-z0-9][a-z0-9_.-]*-[a-z0-9]{2,}\b/gi) || []
  );
  return candidates.some((id) =>
    !/^br-/i.test(id) &&
    !/^(phase|story|feature|issue|actual|beads?)-/i.test(id)
  );
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

function validatePhaseOrdering(state) {
  if (!state?.feature) return null;
  const completed = Array.isArray(state.completed_phases)
    ? state.completed_phases.map(String)
    : [];
  const completedSet = new Set();
  let previousIndex = -1;

  for (const phaseId of completed) {
    const idx = phaseIndex(phaseId);
    if (idx < 0) {
      return `completed_phases contains unknown phase '${phaseId}'. Use canonical phases: ${PHASE_SEQUENCE.join(" -> ")}.`;
    }
    if (completedSet.has(phaseId)) {
      return `completed_phases contains duplicate phase '${phaseId}'.`;
    }
    if (idx < previousIndex) {
      return `completed_phases must be in canonical order (${PHASE_SEQUENCE.join(" -> ")}); found '${phaseId}' after a later phase.`;
    }
    previousIndex = idx;
    completedSet.add(phaseId);
  }

  const lightweight = isLightweightMode(state);
  for (const phaseId of completed) {
    const missing = requiredPriorPhases(phaseId, lightweight).filter((p) => !completedSet.has(p));
    if (missing.length > 0) {
      return `Phase ${phaseId} is marked completed before required prior phase(s): ${missing.join(", ")}.`;
    }
  }

  const currentPhase = String(state.current_phase ?? "");
  if (phaseIndex(currentPhase) >= 0 && !completedSet.has(currentPhase)) {
    const missing = requiredPriorPhases(currentPhase, lightweight).filter((p) => !completedSet.has(p));
    if (missing.length > 0) {
      return `current_phase=${currentPhase} cannot start before required prior phase(s): ${missing.join(", ")}.`;
    }
  }

  return null;
}

function requiredPriorPhases(phaseId, lightweight) {
  const idx = phaseIndex(phaseId);
  if (idx <= 0) return [];
  return PHASE_SEQUENCE.slice(0, idx).filter(
    (p) => !(lightweight && LIGHTWEIGHT_SKIPPABLE_PHASES.has(p)),
  );
}

async function validatePhase0Evidence(projectDir, state, p0) {
  if (!isCompletedStatus(p0, { allowPassed: true })) return null;

  const feature = String(state?.feature ?? "").trim();
  if (!feature) {
    return "Phase 0 marked completed but state.feature is missing; cannot verify target-repo-scoped feature workspace.";
  }

  const missingBoolFields = PHASE_ZERO_BOOL_FIELDS.filter((field) => p0[field] !== true);
  if (missingBoolFields.length > 0) {
    return `Phase 0 marked completed but phase_outputs.0 is missing true evidence field(s): ${missingBoolFields.join(", ")}.`;
  }

  const verified = Array.isArray(p0.mcp_servers_verified)
    ? p0.mcp_servers_verified.map(String)
    : [];
  const missingVerified = REQUIRED_MCP_SERVERS.filter((name) => !verified.includes(name));
  if (missingVerified.length > 0) {
    return `Phase 0 marked completed but phase_outputs.0.mcp_servers_verified is missing: ${missingVerified.join(", ")}.`;
  }

  const requiredProvenanceFields = [
    "project_index_root",
    "project_index_control_root",
    "project_index_anchor_path",
    "project_index_root_source",
  ];
  const missingProvenance = requiredProvenanceFields.filter(
    (field) => typeof p0[field] !== "string" || p0[field].trim().length === 0,
  );
  if (missingProvenance.length > 0) {
    return `Phase 0 marked completed but phase_outputs.0 is missing project-index provenance field(s): ${missingProvenance.join(", ")}.`;
  }

  const resolution = await validateRecordedIndexResolution(p0, { controlRoot: projectDir });
  if (!resolution.ok) {
    return `Phase 0 marked completed but project-index root evidence is unsafe or inconsistent: ${resolution.error}`;
  }

  const backgroundIndexIssue = await validateBackgroundIndexEvidence(projectDir, p0);
  if (backgroundIndexIssue) return backgroundIndexIssue;

  const featurePath = String(p0.feature_path ?? "").trim();
  if (!featurePath) {
    return "Phase 0 marked completed but phase_outputs.0.feature_path is missing. Record target-repo-relative history/<feature>/ as part of pre-flight.";
  }

  const expectedWorkspace = featureWorkspacePath(projectDir, state);
  const recordedWorkspace = resolvePlanningPath(projectDir, state, featurePath);
  const selectedRoot = historyRoot(state, projectDir);
  if (!expectedWorkspace || recordedWorkspace !== expectedWorkspace) {
    return `Phase 0 marked completed but phase_outputs.0.feature_path must resolve to target-repo-scoped history/${feature}/ ` +
      `under ${selectedRoot} (current: ${featurePath}).`;
  }

  try {
    const info = await stat(expectedWorkspace);
    if (!info.isDirectory()) {
      return `Phase 0 marked completed but target-repo-scoped feature workspace '${expectedWorkspace}' is not a directory.`;
    }
  } catch {
    return `Phase 0 marked completed but target-repo-scoped feature workspace '${expectedWorkspace}' does not exist. ` +
      `Create '${expectedWorkspace}' during pre-flight; do not create it under CONTROL_ROOT when the selected target repo is ${selectedRoot}.`;
  }

  const configured = await readConfiguredMcpServers(projectDir);
  if (!configured.ok) {
    return `Phase 0 marked completed but .mcp.json could not be verified: ${configured.error}.`;
  }
  const missingConfigured = REQUIRED_MCP_SERVERS.filter((name) => !configured.servers.includes(name));
  if (missingConfigured.length > 0) {
    return `Phase 0 marked completed but .mcp.json is missing required MCP server(s): ${missingConfigured.join(", ")}.`;
  }

  return null;
}


async function validateBackgroundIndexEvidence(_projectDir, p0) {
  const mode = String(p0?.project_index_execution_mode ?? "").trim();
  if (!mode) return null; // Legacy state may omit mode; explicit synchronous/background values are validated below.
  if (mode !== "synchronous" && mode !== "background") {
    return `Phase 0 marked completed but phase_outputs.0.project_index_execution_mode is invalid: ${mode}.`;
  }
  if (mode !== "background") return null;

  const jobId = String(p0?.project_index_job_id ?? "").trim();
  if (!/^[A-Za-z0-9._-]+$/.test(jobId)) {
    return "Phase 0 background indexing is marked completed but project_index_job_id is missing or unsafe.";
  }

  const jobs = p0?.project_index_jobs;
  if (!jobs || typeof jobs !== "object" || Array.isArray(jobs)) {
    return "Phase 0 background indexing is marked completed but phase_outputs.0.project_index_jobs state metadata is missing.";
  }
  const record = jobs[jobId];
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return `Phase 0 background indexing job '${jobId}' has no authoritative metadata record in phase_outputs.0.project_index_jobs.`;
  }

  const recordedTarget = String(record.target_root ?? "").trim();
  if (!recordedTarget) {
    return `Phase 0 background indexing job '${jobId}' has no target_root evidence in planning-state-v2.json.`;
  }
  if (recordedTarget !== String(p0.project_index_root ?? "").trim()) {
    return `Phase 0 background indexing job '${jobId}' targeted '${recordedTarget}', not recorded project_index_root '${p0.project_index_root}'.`;
  }

  const status = String(record.status ?? "").trim();
  if (status === "queued" || status === "running" || record.exit_code == null) {
    return `Phase 0 background indexing job '${jobId}' is still running or has not published terminal state in planning-state-v2.json. Wait/collect it before completing Phase 0.`;
  }
  if (!Number.isSafeInteger(record.exit_code) || record.exit_code < 0) {
    return `Phase 0 background indexing job '${jobId}' has invalid exit code evidence: '${String(record.exit_code)}'.`;
  }
  if (record.exit_code !== 0 || status !== "succeeded") {
    return `Phase 0 background indexing job '${jobId}' failed (status=${status || "failed"}, exit_code=${record.exit_code}). Stop planning and report the index error; do not continue to discovery.`;
  }

  if (p0.project_index_waited !== true || typeof record.collected_at !== "string" || !record.collected_at.trim()) {
    return `Phase 0 background indexing job '${jobId}' was not collected. Run index.sh --wait --job '${jobId}' and only continue when it exits 0.`;
  }

  return null;
}

async function readConfiguredMcpServers(projectDir) {
  const text = await readFileSafe(join(projectDir, ".mcp.json"));
  if (text == null) return { ok: false, error: ".mcp.json is missing or unreadable" };
  try {
    const parsed = JSON.parse(text);
    if (!parsed?.mcpServers || typeof parsed.mcpServers !== "object") {
      return { ok: false, error: "mcpServers object is missing" };
    }
    return { ok: true, servers: Object.keys(parsed.mcpServers) };
  } catch (e) {
    return { ok: false, error: `invalid JSON (${e.message})` };
  }
}


function validatePhase1LaneLifecycle(p1) {
  const lanes = p1?.lanes;
  if (!lanes || typeof lanes !== "object") return null;
  const orphanRunning = DISCOVERY_LANE_PATHS
    .filter((lane) => !isMainAgentDiscoveryLane(lane.id))
    .filter((lane) => String(lanes[lane.id]?.status ?? "") === "running" && !hasVerifiedDiscoveryLaunchIdentity(lanes[lane.id]))
    .map((lane) => lane.label);
  if (orphanRunning.length === 0) return null;
  return `Phase 1 lane state invalid: status="running" without verified launch identity for ${orphanRunning.join(", ")}. ` +
    `Do not pre-mark running before Agent spawn. Leave the lane missing/failed/orphaned until launch succeeds; after an accepted launch record agent_id/launch_id, or attempt_id plus launch_confirmed_at. ` +
    `The PreToolUse guard classifies identity-less running entries as orphaned/retryable so refresh-session relaunch is not deadlocked.`;
}

async function validatePhase1Artifacts(projectDir, state, p1) {
  if (!isCompletedStatus(p1)) return null;
  if (!state.feature) return `Phase 1 marked completed but state.feature is missing.`;

  const missingLanes = [];
  for (const lane of DISCOVERY_LANE_PATHS) {
    const rel = lane.rel(state.feature);
    if (!(await fileExists(resolvePlanningPath(projectDir, state, rel)))) missingLanes.push(`${lane.label} (${rel})`);
  }
  if (missingLanes.length > 0) {
    return `Phase 1 marked completed but canonical discovery file(s) are missing: ${missingLanes.join(", ")}. For subagent lanes (Patterns, Constraints, External) wait for/retry only the missing lane agents; for the main-agent Architecture lane, produce it directly with GitNexus and write the canonical file. Do not substitute thin summaries for full lane evidence.`;
  }

  const agents = Array.isArray(p1.agents) ? p1.agents.filter((id) => typeof id === "string" && id.trim().length > 0) : [];
  const lanes = p1.lanes && typeof p1.lanes === "object" ? p1.lanes : null;
  if (lanes) {
    const incomplete = DISCOVERY_LANE_PATHS
      .filter((lane) => !["completed", "succeeded"].includes(String(lanes[lane.id]?.status ?? "")))
      .map((lane) => lane.label);
    if (incomplete.length > 0) {
      return `Phase 1 marked completed but phase_outputs.1.lanes has incomplete lane status for: ${incomplete.join(", ")}.`;
    }
  } else if (new Set(agents).size < 3) {
    return `Phase 1 marked completed but phase_outputs.1 must record either lanes.<id>.status completed/succeeded for all four lanes or at least 3 unique non-empty agent ids (Patterns/Constraints/External subagents; Architecture is main-agent-owned and has no agent id).`;
  }
  return null;
}

function phase15UnresolvedAnomalyCount(p15) {
  const unresolved = Number(p15?.anomaly_scan?.unresolved_count ?? 0);
  if (!Number.isFinite(unresolved) || unresolved < 0) return 0;
  return unresolved;
}

function validatePhase15Questions(state, p15) {
  const completed = Array.isArray(state.completed_phases)
    ? state.completed_phases.map(String)
    : [];
  const advancedPast15 = completed.includes("1.5") ||
    phaseIndex(state.current_phase) > phaseIndex("1.5");

  const phase15Done = isCompletedStatus(p15) || advancedPast15;
  if (!phase15Done) return null;

  const asked = Number(p15?.questions_asked ?? 0);
  if (!Number.isFinite(asked) || asked < PHASE_15_TOTAL_QUESTIONS) {
    return `Phase 1.5 cannot be completed: phase_outputs."1.5".questions_asked=${p15?.questions_asked ?? "missing"} ` +
      `but ${PHASE_15_TOTAL_QUESTIONS} business questions are required (${PHASE_15_TOTAL_QUESTIONS / QUESTIONS_PER_ROUND} rounds of ${QUESTIONS_PER_ROUND}). ` +
      `Run another AskUserQuestion round before advancing to Phase 1.6.`;
  }

  if (asked % QUESTIONS_PER_ROUND !== 0) {
    return `Phase 1.5 questions_asked=${asked} is not a multiple of ${QUESTIONS_PER_ROUND}; each round must contain exactly ${QUESTIONS_PER_ROUND} questions.`;
  }

  if (asked > PHASE_15_OPTIONAL_ROUND_TOTAL_QUESTIONS) {
    return `Phase 1.5 questions_asked=${asked} exceeds the maximum allowed ${PHASE_15_OPTIONAL_ROUND_TOTAL_QUESTIONS} (optional Round 4 included).`;
  }

  if (asked > PHASE_15_TOTAL_QUESTIONS && asked < PHASE_15_OPTIONAL_ROUND_TOTAL_QUESTIONS) {
    return `Phase 1.5 questions_asked=${asked} is invalid for optional-round contract. Allowed checkpoints are 12 or 16.`;
  }

  const unresolved = phase15UnresolvedAnomalyCount(p15);
  if (asked === PHASE_15_TOTAL_QUESTIONS && unresolved > 0) {
    return `Phase 1.5 cannot be completed: anomaly_scan.unresolved_count=${unresolved}. ` +
      `Use optional Round 4 (4 anomaly-resolution questions) before advancing to Phase 1.6.`;
  }

  if (p15?.optional_round_4_used === true && asked < PHASE_15_OPTIONAL_ROUND_TOTAL_QUESTIONS) {
    return `Phase 1.5 state inconsistency: optional_round_4_used=true but questions_asked=${asked}. ` +
      `Optional Round 4 requires ${PHASE_15_OPTIONAL_ROUND_TOTAL_QUESTIONS} total questions.`;
  }

  if (asked === PHASE_15_OPTIONAL_ROUND_TOTAL_QUESTIONS) {
    if (p15?.optional_round_4_used !== true) {
      return `Phase 1.5 state inconsistency: questions_asked=${asked} implies optional Round 4 used, but optional_round_4_used is not true.`;
    }
    if (unresolved > 0) {
      return `Phase 1.5 cannot be completed: optional Round 4 used but anomaly_scan.unresolved_count=${unresolved} still unresolved.`;
    }
  }

  return null;
}

async function validatePhase16QuestionsAndScenarios(projectDir, state, p16) {
  const completed = Array.isArray(state.completed_phases)
    ? state.completed_phases.map(String)
    : [];
  const advancedPast16 = completed.includes("1.6") ||
    phaseIndex(state.current_phase) > phaseIndex("1.6");

  const phase16Done = isCompletedStatus(p16) || advancedPast16;
  if (!phase16Done) return null;

  const asked = Number(p16?.questions_asked ?? 0);
  if (!Number.isFinite(asked) || asked < PHASE_16_TOTAL_QUESTIONS) {
    return `Phase 1.6 cannot be completed: phase_outputs."1.6".questions_asked=${p16?.questions_asked ?? "missing"} ` +
      `but ${PHASE_16_TOTAL_QUESTIONS} test clarification questions are required (${PHASE_16_TOTAL_QUESTIONS / QUESTIONS_PER_ROUND} rounds of ${QUESTIONS_PER_ROUND}). ` +
      `Run another AskUserQuestion round before advancing to Phase 2.`;
  }
  if (asked % QUESTIONS_PER_ROUND !== 0) {
    return `Phase 1.6 questions_asked=${asked} is not a multiple of ${QUESTIONS_PER_ROUND}; each round must contain exactly ${QUESTIONS_PER_ROUND} questions.`;
  }
  if (!p16?.test_scenarios_path) {
    return `Phase 1.6 marked completed but phase_outputs."1.6".test_scenarios_path is missing. Write test-scenarios.md before advancing to Phase 2.`;
  }

  const rel = String(p16.test_scenarios_path || "").trim();
  if (!rel) return `Phase 1.6 marked completed but test_scenarios_path is empty.`;
  const abs = resolvePlanningPath(projectDir, state, rel);
  const text = await readFileSafe(abs);
  if (!text) {
    return `Phase 1.6 marked completed but test-scenarios artifact '${rel}' is missing or unreadable.`;
  }

  const lower = text.toLowerCase();
  if (!/(fullstack|fe-only|be-only)/.test(lower)) {
    return `Phase 1.6 test-scenarios must declare feature mode (fullstack/fe-only/be-only).`;
  }
  if (!/evidence matrix/i.test(text)) {
    return `Phase 1.6 test-scenarios must include an 'Evidence Matrix' section for FE/BE/integration proof mapping.`;
  }
  const feModeDeclared = /(fullstack|fe-only)/.test(lower);
  if (feModeDeclared && !/(before|after|final|trước|sau)/i.test(lower)) {
    return `Phase 1.6 test-scenarios must include FE screenshot timing checkpoints (before/after important action + final) for FE-involving modes.`;
  }

  return null;
}

export function validateBootstrapProvisioningInvariant(text) {
  const lower = String(text || "").toLowerCase();
  if (!lower) return null;

  const hasRuntimeSettingsSource = /(db\s+settings|settings\s+key|settings\s+table|source\s+of\s+truth|config\s+key)/.test(lower);
  const expectsRuntime200 = /(get\s+\/api\/|\/api\/|expected\s+200|returns?\s+200|status\s+200|payload)/.test(lower);
  const mentionsMissingConfigFail = /(missing\s+config|missing\s+setting|fail\s+500|500\s*\/\s*domain\s+error|domain\s+error)/.test(lower);
  const hasBootstrapContractSection = /bootstrap\s*\/\s*provisioning\s+contract/.test(lower);
  const hasBootstrapProof = /(data\s+migration\s+required|seed\s+required|bootstrap\s+required|migration\s+(artifact|path|file|revision)|existing\s+provisioning\s+proof|existing\s+key\s+proof|provisioning\s+proof|repo[- ]native\s+migration|project[- ]specific\s+migration)/.test(lower);

  if (hasRuntimeSettingsSource && expectsRuntime200 && mentionsMissingConfigFail && !hasBootstrapContractSection) {
    return "runtime DB settings source-of-truth with expected 200 behavior must include a 'Bootstrap / Provisioning Contract' section.";
  }

  if (hasRuntimeSettingsSource && expectsRuntime200 && !hasBootstrapProof) {
    return "runtime DB settings source-of-truth with expected 200/payload requires explicit bootstrap proof (repo-native idempotent migration/provisioning artifact at the path required by active repo/project instructions, or existing provisioning proof).";
  }

  return null;
}

function isCompletedStatus(entry, opts = {}) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.status === "completed") return true;
  return opts.allowPassed === true && entry.status === "passed";
}


function detectCycles(stdout) {
  // Try JSON parse first. bv --robot-* emits JSON; after jq the root may be an array.
  try {
    const obj = JSON.parse(stdout);
    if (Array.isArray(obj)) {
      if (obj.length > 0) return JSON.stringify(obj).slice(0, 400);
      return null;
    }
    const cycles =
      obj.cycles ??
      obj.Cycles ??
      obj.data?.cycles ??
      obj.data?.Cycles ??
      null;
    if (Array.isArray(cycles) && cycles.length > 0) {
      return JSON.stringify(cycles).slice(0, 400);
    }
  } catch {
    // Fallback heuristic: look for a line like "cycles": [ ... non-empty ... ]
    const m = stdout.match(/"[Cc]ycles"\s*:\s*(\[[^\]]*\])/);
    if (m) {
      const inner = m[1];
      if (!/\[\s*\]/.test(inner)) return inner.slice(0, 400);
    }
  }
  return null;
}
