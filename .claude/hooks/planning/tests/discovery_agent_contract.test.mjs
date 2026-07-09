import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  DISCOVERY_LANES,
  SUBAGENT_DISCOVERY_LANES,
  classifyDiscoveryLaneLedger,
  discoveryLaneById,
  renderDiscoveryContractBlock,
  validateDiscoveryAgentPromptContract,
} from "../lib/discovery_agent_contract.mjs";
import { validatePreToolUse } from "../validators/pre_tool_use.mjs";


const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");

const cleanup = [];
test.after(async () => {
  await Promise.all(cleanup.map((path) => rm(path, { recursive: true, force: true })));
});

async function tempControl() {
  const control = await mkdtemp(join(tmpdir(), "planning-discovery-contract-"));
  cleanup.push(control);
  return control;
}

function canonicalAgentInput(lane, feature = "feature-x") {
  return {
    name: `phase1-${lane.id}`,
    description: `${lane.label} discovery lane — ${feature}`,
    subagent_type: "general-purpose",
    run_in_background: true,
    prompt: [
      `Perform ${lane.label} discovery for ${feature}.`,
      renderDiscoveryContractBlock(lane.id, feature),
      "Write the complete lane artifact and preserve evidence.",
    ].join("\n\n"),
  };
}

async function writeState(control, lanes = {}) {
  const path = join(control, ".planning", "state", "planning-state-v2.json");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({
    schema_version: "v2",
    feature: "feature-x",
    current_phase: "1",
    completed_phases: ["0"],
    phase_plan_approved: false,
    planning_active: true,
    phase_outputs: {
      "0": { status: "completed" },
      "1": { status: "in_progress", lanes },
    },
  }, null, 2));
}

function preToolInput(toolInput) {
  return {
    hook_event_name: "PreToolUse",
    tool_name: "Agent",
    tool_input: toolInput,
  };
}

test("canonical contract prompts pass direct validation for the three subagent lanes", () => {
  for (const lane of SUBAGENT_DISCOVERY_LANES) {
    const toolInput = canonicalAgentInput(lane);
    assert.deepEqual(
      validateDiscoveryAgentPromptContract(toolInput, lane, "feature-x"),
      [],
      `${lane.id} canonical prompt should pass`,
    );
  }
});

test("architecture lane contract is rejected as main-agent-owned", () => {
  const architecture = DISCOVERY_LANES.find((lane) => lane.id === "architecture");
  const toolInput = canonicalAgentInput(architecture);
  const issues = validateDiscoveryAgentPromptContract(toolInput, architecture, "feature-x");
  assert.ok(
    issues.some((issue) => issue.includes("main-agent-owned")),
    `expected main-agent-owned rejection, got: ${JSON.stringify(issues)}`,
  );
});

test("copy-safe launcher documentation prompts pass guard contract for the three subagent lanes", async () => {
  const doc = await readFile(
    join(ROOT, ".claude", "skills", "planning", "references", "launch-discovery-agents.md"),
    "utf8",
  );
  const encodedPrompts = [...doc.matchAll(/prompt="((?:\\.|[^"\\])*)",\n  run_in_background=true/g)]
    .map((match) => match[1]);
  assert.equal(encodedPrompts.length, 3, "expected three copy-safe Agent prompt examples (architecture is main-agent-owned)");

  for (const lane of SUBAGENT_DISCOVERY_LANES) {
    const encoded = encodedPrompts.find((value) => value.includes(`lane=${lane.id}\\n`));
    assert.ok(encoded, `missing documented prompt for ${lane.id}`);
    const prompt = JSON.parse(`"${encoded}"`).replaceAll("<feature>", "feature-x");
    const issues = validateDiscoveryAgentPromptContract(
      { prompt },
      discoveryLaneById(lane.id),
      "feature-x",
    );
    assert.deepEqual(issues, [], `${lane.id} documented launcher prompt should pass`);
  }
});

test("malformed prompt without canonical block fails", () => {
  const lane = DISCOVERY_LANES.find((candidate) => candidate.id === "patterns");
  const toolInput = {
    ...canonicalAgentInput(lane),
    prompt: "Please do full detailed patterns discovery and write the file directly.",
  };
  const issues = validateDiscoveryAgentPromptContract(toolInput, lane, "feature-x");
  assert.ok(issues.some((issue) => issue.includes("missing canonical")));
});

test("canonical block with wrong lane artifact fails", () => {
  const patterns = DISCOVERY_LANES.find((lane) => lane.id === "patterns");
  const toolInput = canonicalAgentInput(patterns);
  toolInput.prompt = toolInput.prompt.replace(
    "artifact=history/feature-x/discovery-lanes/2-patterns.md",
    "artifact=history/feature-x/discovery-lanes/3-constraints.md",
  );
  const issues = validateDiscoveryAgentPromptContract(toolInput, patterns, "feature-x");
  assert.ok(issues.some((issue) => issue.includes("contract artifact must be")));
});

test("PreToolUse accepts canonical prompts for the three missing subagent lanes", async () => {
  const control = await tempControl();
  await writeState(control, {});
  for (const lane of SUBAGENT_DISCOVERY_LANES) {
    const decision = await validatePreToolUse(preToolInput(canonicalAgentInput(lane)), control);
    assert.equal(decision, null, `${lane.id} should be launchable when missing`);
  }
});

test("PreToolUse denies an architecture subagent launch even when the lane is missing", async () => {
  const control = await tempControl();
  await writeState(control, {});
  const architecture = DISCOVERY_LANES.find((lane) => lane.id === "architecture");
  const decision = await validatePreToolUse(preToolInput(canonicalAgentInput(architecture)), control);
  assert.ok(decision, "expected main-agent-owned denial");
  assert.match(JSON.stringify(decision), /main-agent-owned/);
});

test("failed lane remains retryable", async () => {
  const control = await tempControl();
  await writeState(control, {
    patterns: { status: "failed", error: "previous PreToolUse denial" },
  });
  const lane = DISCOVERY_LANES.find((candidate) => candidate.id === "patterns");
  const decision = await validatePreToolUse(preToolInput(canonicalAgentInput(lane)), control);
  assert.equal(decision, null);
});

test("running without launch identity is orphaned and retryable", async () => {
  const control = await tempControl();
  await writeState(control, {
    patterns: { status: "running" },
  });
  const lane = DISCOVERY_LANES.find((candidate) => candidate.id === "patterns");
  const decision = await validatePreToolUse(preToolInput(canonicalAgentInput(lane)), control);
  assert.equal(decision, null);
  assert.equal(classifyDiscoveryLaneLedger({ status: "running" }, false), "orphaned");
});

test("running with verified agent identity is duplicate-blocked", async () => {
  const control = await tempControl();
  await writeState(control, {
    patterns: { status: "running", agent_id: "agent-123" },
  });
  const lane = DISCOVERY_LANES.find((candidate) => candidate.id === "patterns");
  const decision = await validatePreToolUse(preToolInput(canonicalAgentInput(lane)), control);
  assert.ok(decision, "expected duplicate denial");
  assert.match(JSON.stringify(decision), /already running/);
});

test("attempt identity requires launch confirmation to count as running", () => {
  assert.equal(
    classifyDiscoveryLaneLedger({ status: "running", attempt_id: "attempt-1" }, false),
    "orphaned",
  );
  assert.equal(
    classifyDiscoveryLaneLedger({
      status: "running",
      attempt_id: "attempt-1",
      launch_confirmed_at: "2026-07-06T22:00:00Z",
    }, false),
    "running",
  );
});

test("completed ledger without canonical artifact is orphaned/retryable", async () => {
  const control = await tempControl();
  await writeState(control, {
    patterns: { status: "completed" },
  });
  const lane = DISCOVERY_LANES.find((candidate) => candidate.id === "patterns");
  const decision = await validatePreToolUse(preToolInput(canonicalAgentInput(lane)), control);
  assert.equal(decision, null);
  assert.equal(classifyDiscoveryLaneLedger({ status: "completed" }, false), "orphaned");
});

test("existing canonical artifact suppresses duplicate launch even with failed ledger", async () => {
  const control = await tempControl();
  await writeState(control, {
    patterns: { status: "failed" },
  });
  const artifact = join(control, "history", "feature-x", "discovery-lanes", "2-patterns.md");
  await mkdir(dirname(artifact), { recursive: true });
  await writeFile(artifact, "# Patterns\n\nDetailed evidence\n");

  const lane = DISCOVERY_LANES.find((candidate) => candidate.id === "patterns");
  const decision = await validatePreToolUse(preToolInput(canonicalAgentInput(lane)), control);
  assert.ok(decision, "existing artifact should block duplicate launch");
  assert.match(JSON.stringify(decision), /already completed/);
});
