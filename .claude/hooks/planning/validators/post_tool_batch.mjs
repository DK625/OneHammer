// validators/post_tool_batch.mjs
// Called once per batch of parallel tool calls. Validates Phase 1 discovery Agent batches without inferring global coverage from one batch.

import { additionalContext } from "../lib/diagnostics.mjs";
import { readState, isPlanningActive } from "../lib/state.mjs";
import {
  DISCOVERY_CONTRACT_BEGIN, DISCOVERY_LANES, REQUIRED_DISCOVERY_SUBAGENT,
  discoveryLaneFromToolInput, validateDiscoveryAgentPromptContract,
} from "../lib/discovery_agent_contract.mjs";

function phase1AgentGuidance(message) {
  return additionalContext(
    "PostToolBatch",
    `[planning-guard] ${message}\n\nCorrective action: do not ask the user to fix this manually. Copy the exact ${DISCOVERY_CONTRACT_BEGIN} block from .claude/skills/planning/references/launch-discovery-agents.md, substitute the actual feature/lane artifact, and launch only missing/failed/orphaned subagent lanes (Patterns, Constraints, External) as background general-purpose agents. The Architecture lane is main-agent-owned: run GitNexus directly and write 1-architecture.md yourself instead of spawning it. Do not pre-mark running. Record running only after an accepted launch with a verified launch identity. Canonical lane files are the handoff; the main agent compiles discovery.md and manages JSON state.`,
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
    const lane = discoveryLaneFromToolInput(i);
    if (!lane) {
      issues.push("one Agent call did not clearly identify exactly one lane");
    } else {
      launchedLaneIds.push(lane.id);
    }
    const subagentType = i.subagent_type ?? "";
    if (subagentType !== REQUIRED_DISCOVERY_SUBAGENT) {
      issues.push(`one Agent call used subagent_type=${i.subagent_type ?? "missing"}; required: general-purpose`);
    }
    if (i.run_in_background !== true) {
      issues.push("one Agent call omitted run_in_background=true");
    }
    issues.push(...validateDiscoveryAgentPromptContract(i, lane, state.feature).map((issue) => `one Agent call: ${issue}`));
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


function unique(values) {
  return [...new Set(values)];
}
