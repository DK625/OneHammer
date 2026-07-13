// discovery_agent_contract.mjs — canonical Phase 1 discovery Agent contract.
//
// The launcher copies a versioned key=value block into every discovery Agent
// prompt. PreToolUse validates that block exactly instead of guessing whether
// free-form prose contains equivalent phrases. This keeps the contract
// machine-checkable, copy-safe, and stable across refreshed sessions.

export const DISCOVERY_CONTRACT_BEGIN = "[PLANNING_DISCOVERY_AGENT_CONTRACT_V1]";
export const DISCOVERY_CONTRACT_END = "[/PLANNING_DISCOVERY_AGENT_CONTRACT_V1]";
export const REQUIRED_DISCOVERY_SUBAGENT = "general-purpose";

export const DISCOVERY_LANES = [
  { id: "architecture", label: "Architecture", filename: "1-architecture.md", re: /architecture/i },
  { id: "patterns", label: "Patterns", filename: "2-patterns.md", re: /patterns?/i },
  { id: "constraints", label: "Constraints", filename: "3-constraints.md", re: /constraints?/i },
  { id: "external", label: "External", filename: "4-external.md", re: /external/i },
];

// Architecture, Patterns, and Constraints are main-agent-owned: the main agent
// produces 1-architecture.md, 2-patterns.md, and 3-constraints.md directly with
// GitNexus/Serena instead of spawning subagents. Only External is a subagent.
export const MAIN_AGENT_DISCOVERY_LANE_IDS = new Set(["architecture", "patterns", "constraints"]);
export const SUBAGENT_DISCOVERY_LANES = DISCOVERY_LANES.filter(
  (lane) => !MAIN_AGENT_DISCOVERY_LANE_IDS.has(lane.id),
);

export function isMainAgentDiscoveryLane(laneId) {
  return MAIN_AGENT_DISCOVERY_LANE_IDS.has(String(laneId ?? "").trim());
}

const REQUIRED_STATIC_FIELDS = Object.freeze({
  requirement_input: "provided_requirement_source_or_current_request",
  delivery: "direct_canonical_markdown_file",
  detail: "full_detailed_non_summary",
  write_scope: "canonical_lane_file_only",
  forbid: ".planning/state/,planning-state-v2.json,discovery.md,other_lane_files",
  main_agent_owns: "read_verify_lane_files,compile_discovery_md,manage_planning_state",
  handoff: "canonical_file_not_background_response_body",
  topology: "read_active_repo_project_instructions,discover_actual_topology,provider_source_of_truth_before_dependent_consumer_impact",
  browser_runbook_candidates: "durable_ui_route_login_selector_state_cues",
});

export function discoveryLaneById(id) {
  return DISCOVERY_LANES.find((lane) => lane.id === String(id ?? "").trim()) ?? null;
}

export function canonicalDiscoveryArtifact(laneId, feature) {
  const lane = discoveryLaneById(laneId);
  if (!lane) return null;
  return `.planning/history/${feature || "<feature>"}/discovery-lanes/${lane.filename}`;
}

export function renderDiscoveryContractBlock(laneId, feature) {
  const lane = discoveryLaneById(laneId);
  if (!lane) throw new Error(`Unknown discovery lane '${laneId}'`);
  const fields = {
    lane: lane.id,
    artifact: canonicalDiscoveryArtifact(lane.id, feature),
    ...REQUIRED_STATIC_FIELDS,
  };
  return [
    DISCOVERY_CONTRACT_BEGIN,
    ...Object.entries(fields).map(([key, value]) => `${key}=${value}`),
    DISCOVERY_CONTRACT_END,
  ].join("\n");
}

export function parseDiscoveryContractBlock(prompt) {
  const text = typeof prompt === "string" ? prompt : "";
  const begin = text.indexOf(DISCOVERY_CONTRACT_BEGIN);
  const end = text.indexOf(DISCOVERY_CONTRACT_END);
  const issues = [];

  if (begin < 0 || end < 0 || end < begin) {
    return { ok: false, fields: {}, issues: [`missing canonical ${DISCOVERY_CONTRACT_BEGIN} block`] };
  }
  if (text.indexOf(DISCOVERY_CONTRACT_BEGIN, begin + DISCOVERY_CONTRACT_BEGIN.length) >= 0) {
    issues.push("multiple canonical discovery contract blocks found");
  }
  if (text.indexOf(DISCOVERY_CONTRACT_END, end + DISCOVERY_CONTRACT_END.length) >= 0) {
    issues.push("multiple canonical discovery contract end markers found");
  }

  const bodyStart = begin + DISCOVERY_CONTRACT_BEGIN.length;
  const body = text.slice(bodyStart, end).trim();
  const fields = {};
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) {
      issues.push(`invalid contract line '${line}'`);
      continue;
    }
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!/^[a-z][a-z0-9_]*$/.test(key)) {
      issues.push(`invalid contract key '${key}'`);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      issues.push(`duplicate contract key '${key}'`);
      continue;
    }
    fields[key] = value;
  }

  return { ok: issues.length === 0, fields, issues };
}

export function discoveryLaneFromText(text) {
  const matches = DISCOVERY_LANES.filter((lane) => lane.re.test(String(text ?? "")));
  return matches.length === 1 ? matches[0] : null;
}

export function discoveryLaneFromToolInput(toolInput = {}) {
  const parsed = parseDiscoveryContractBlock(toolInput.prompt);
  const contractLane = discoveryLaneById(parsed.fields?.lane);
  if (contractLane) return contractLane;
  return discoveryLaneFromText(
    [toolInput.name, toolInput.description, toolInput.prompt].filter(Boolean).join("\n"),
  );
}

export function validateDiscoveryAgentPromptContract(toolInput, lane, feature) {
  const parsed = parseDiscoveryContractBlock(toolInput?.prompt);
  const issues = [...parsed.issues];
  const fields = parsed.fields || {};

  if (!lane) {
    issues.push("canonical contract must identify the external lane (architecture, patterns, and constraints are main-agent-owned)");
  } else if (isMainAgentDiscoveryLane(lane.id)) {
    issues.push(`${lane.label} discovery is main-agent-owned (GitNexus-direct); do not spawn a subagent for it`);
  } else if (fields.lane !== lane.id) {
    issues.push(`contract lane must be '${lane.id}' (got '${fields.lane || "missing"}')`);
  }

  if (lane) {
    const expectedArtifact = canonicalDiscoveryArtifact(lane.id, feature || "<feature>");
    if (fields.artifact !== expectedArtifact) {
      issues.push(`contract artifact must be '${expectedArtifact}' (got '${fields.artifact || "missing"}')`);
    }
  } else if (!fields.artifact) {
    issues.push("contract artifact is missing");
  }

  for (const [key, expected] of Object.entries(REQUIRED_STATIC_FIELDS)) {
    if (fields[key] !== expected) {
      issues.push(`contract ${key} must be '${expected}' (got '${fields[key] || "missing"}')`);
    }
  }

  const allowedKeys = new Set(["lane", "artifact", ...Object.keys(REQUIRED_STATIC_FIELDS)]);
  for (const key of Object.keys(fields)) {
    if (!allowedKeys.has(key)) issues.push(`unknown contract key '${key}'`);
  }

  return unique(issues);
}

// A lane may be treated as truly running only when state carries an identity
// produced/confirmed by the Agent launch. A bare local status flip is not proof.
export function hasVerifiedDiscoveryLaunchIdentity(ledger) {
  if (!ledger || typeof ledger !== "object") return false;
  if (nonEmptyString(ledger.agent_id) || nonEmptyString(ledger.launch_id)) return true;
  return nonEmptyString(ledger.attempt_id) && nonEmptyString(ledger.launch_confirmed_at);
}

export function classifyDiscoveryLaneLedger(ledger, artifactExists = false) {
  if (artifactExists) return "completed";
  if (!ledger || typeof ledger !== "object") return "missing";

  const status = String(ledger.status ?? "").trim();
  if (!status || status === "missing") return "missing";
  if (status === "running") {
    return hasVerifiedDiscoveryLaunchIdentity(ledger) ? "running" : "orphaned";
  }
  if (status === "completed" || status === "succeeded") {
    // Completion without the canonical artifact cannot be authoritative.
    return "orphaned";
  }
  if (status === "orphaned") return "orphaned";
  return status;
}

export function isRetryableDiscoveryLaneStatus(status) {
  return new Set(["missing", "failed", "orphaned"]).has(String(status ?? ""));
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function unique(values) {
  return [...new Set(values)];
}
