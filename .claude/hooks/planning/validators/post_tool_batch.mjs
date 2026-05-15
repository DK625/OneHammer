// validators/post_tool_batch.mjs
// Called once per batch of parallel tool calls. Validates Phase 1 discovery Agent batches without inferring global coverage from one batch.

import { additionalContext } from "../lib/diagnostics.mjs";
import { readState, isPlanningActive } from "../lib/state.mjs";

const DISCOVERY_LANES = [
  { id: "architecture", label: "Architecture", artifact: "history/{feature}/discovery-lanes/1-architecture.md", re: /architecture/i },
  { id: "patterns", label: "Patterns", artifact: "history/{feature}/discovery-lanes/2-patterns.md", re: /patterns?/i },
  { id: "constraints", label: "Constraints", artifact: "history/{feature}/discovery-lanes/3-constraints.md", re: /constraints?/i },
  { id: "external", label: "External", artifact: "history/{feature}/discovery-lanes/4-external.md", re: /external/i },
];
const ALLOWED_DISCOVERY_SUBAGENTS = new Set(["Explore", "general-purpose"]);

function phase1AgentGuidance(message) {
  return additionalContext(
    "PostToolBatch",
    `[planning-guard] ${message}\n\nCorrective action: do not ask the user to fix this manually. If this is the initial Phase 1 launch, keep or complete the four canonical discovery lanes once (Architecture, Patterns, Constraints, External). Each Agent prompt must require artifact-ready Markdown in the subagent response only, forbid file/state writes, and state that the main agent writes canonical lane files plus PLANNING_STATUS.md/JSON state. Then wait for outputs. After outputs/artifacts are observable, verify coverage and prime only lanes that are still missing or retryable failed. Do not relaunch a whole discovery batch based on partial batch coverage.`,
  );
}

export async function validatePostToolBatch(input, projectDir) {
  const { state, legacy, missing } = await readState(projectDir);
  if (legacy || missing || !state) return null;
  if (!isPlanningActive(state)) return null;

  const cp = String(state.current_phase ?? "");
  if (cp !== "1") return null;

  const calls = Array.isArray(input.tool_calls) ? input.tool_calls : [];
  const agentCalls = calls.filter(
    (c) => c && c.tool_name === "Agent",
  );

  if (agentCalls.length === 0) return null;

  const launchedLaneIds = [];
  const issues = [];

  for (const call of agentCalls) {
    const i = call.tool_input || {};
    const text = [i.name, i.description].filter(Boolean).join(" :: ");
    const lane = discoveryLaneFromText(text);
    if (!lane) {
      issues.push("one Agent call did not clearly identify exactly one lane");
    } else {
      launchedLaneIds.push(lane.id);
    }
    const subagentType = i.subagent_type ?? "general-purpose";
    if (!ALLOWED_DISCOVERY_SUBAGENTS.has(subagentType)) {
      issues.push(`one Agent call used subagent_type=${i.subagent_type ?? "missing"}; allowed: Explore or general-purpose`);
    }
    if (i.run_in_background !== true) {
      issues.push("one Agent call omitted run_in_background=true");
    }
  }

  const duplicateLaunches = launchedLaneIds.filter((id, idx) => launchedLaneIds.indexOf(id) !== idx);
  if (duplicateLaunches.length > 0) {
    issues.push(`duplicate lane launch in this batch: ${unique(duplicateLaunches).join(", ")}`);
  }

  if (issues.length > 0) {
    return phase1AgentGuidance(issues.join("; "));
  }

  const lanes = unique(launchedLaneIds).map((id) => DISCOVERY_LANES.find((lane) => lane.id === id)?.label ?? id);
  return phase1AgentGuidance(`Phase 1 discovery Agent batch accepted for lane(s): ${lanes.join(", ")}.`);
}

function discoveryLaneFromText(text) {
  const matches = DISCOVERY_LANES.filter((lane) => lane.re.test(text));
  return matches.length === 1 ? matches[0] : null;
}

function unique(values) {
  return [...new Set(values)];
}
