import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { DISCOVERY_SECTIONS } from "../lib/artifacts.mjs";
import { discoveryLaneById, renderDiscoveryContractBlock } from "../lib/discovery_agent_contract.mjs";
import {
  validateDiscoveryAgentPromptContract,
  validatePhase5VerificationClauses,
} from "../validators/pre_tool_use.mjs";
import {
  storyMapHasCanonicalBeadId,
  validateBootstrapProvisioningInvariant,
} from "../validators/post_tool_use.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const SCAN_ROOTS = [
  join(ROOT, ".claude", "skills", "planning"),
  join(ROOT, ".claude", "skills", "planning-validator"),
  join(ROOT, ".claude", "hooks", "planning"),
];

async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "tests") continue;
      out.push(...await walk(child));
    } else if ([".md", ".mjs", ".json", ".sh"].includes(extname(entry.name))) {
      out.push(child);
    }
  }
  return out;
}

test("shared planning toolkit contains no fixed project/repo/service identifiers", async () => {
  const forbidden = [
    ["onehammer", "Store"].join(""),
    ["onehammer", "UI"].join(""),
    ["onehammer", "-be"].join(""),
    ["one", "_hammer"].join(""),
    ["/opt/one", "_hammer"].join(""),
    ["clip", "-transcript"].join(""),
    ["grok", "-xai-stt"].join(""),
  ];

  const offenders = [];
  for (const root of SCAN_ROOTS) {
    for (const file of await walk(root)) {
      const text = await readFile(file, "utf8");
      for (const needle of forbidden) {
        if (text.toLowerCase().includes(needle.toLowerCase())) {
          offenders.push(`${file}: ${needle}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("discovery artifact schema is component/repo agnostic", () => {
  assert.ok(DISCOVERY_SECTIONS.includes("Contract / Interface Changes"));
  assert.ok(DISCOVERY_SECTIONS.includes("Dependent Consumer Impact"));
  assert.ok(!DISCOVERY_SECTIONS.includes("Backend/API Contract Changes"));
  assert.ok(!DISCOVERY_SECTIONS.includes("Frontend Impact"));
});

test("discovery Agent prompt accepts canonical machine-checkable lane contract", () => {
  const lane = discoveryLaneById("patterns");
  const prompt = [
    "Perform patterns discovery and preserve detailed evidence.",
    renderDiscoveryContractBlock("patterns", "example"),
    "Write the lane artifact directly; the main agent owns synthesis and state.",
  ].join("\n\n");

  const issues = validateDiscoveryAgentPromptContract(
    { prompt },
    lane,
    "example",
  );
  assert.deepEqual(issues, []);
});

test("discovery Agent prompt rejects old response-only main-agent persistence contract", () => {
  const prompt = [
    "Return artifact-ready Markdown in your response for history/example/discovery-lanes/1-architecture.md.",
    "Do not write files or artifacts.",
    "The main agent writes canonical lane files and manages planning state.",
    "Read the active repo/project instructions and discover actual topology.",
    "Report the contract provider/source-of-truth first, then dependent consumer impact.",
    "Include Browser Runbook candidates when durable UI cues are found.",
  ].join("\n");

  const issues = validateDiscoveryAgentPromptContract(
    { prompt },
    discoveryLaneById("architecture"),
    "example",
  );
  assert.ok(issues.some((issue) => /missing canonical/i.test(issue)));
  assert.ok(issues.some((issue) => /delivery must be/i.test(issue)));
});


test("Phase 1 launch protocol uses general-purpose for all subagent lanes", async () => {
  const text = await readFile(join(ROOT, ".claude", "skills", "planning", "references", "launch-discovery-agents.md"), "utf8");
  const launchTypes = [...text.matchAll(/subagent_type="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(launchTypes.length >= 3);
  assert.deepEqual(new Set(launchTypes), new Set(["general-purpose"]));
  assert.doesNotMatch(text, /subagent_type="Explore"/);
});

test("Phase 1 launch protocol uses canonical files as handoff and has no side-channel retrieval path", async () => {
  const text = await readFile(join(ROOT, ".claude", "skills", "planning", "references", "launch-discovery-agents.md"), "utf8");
  assert.match(text, /canonical(?: Markdown)? files are the handoff/i);
  assert.match(text, /full detailed, non-summary Markdown/i);
  assert.match(text, /main agent.*compiles `discovery\.md`/is);
  assert.doesNotMatch(text, /side channel retrieval is required/i);
});

test("Phase 5 validator accepts repo-native non-Alembic migration command", () => {
  const command = `br create --title "[Phase 1] Update service contract" --description "
Technical Contract: API Contract endpoint POST /api/items with request shape, response shape, and expected status 200.
Data / DB / Config Contract: database table item_config owns persisted values.
BE verification clause: curl -H 'Authorization: Bearer TEST_TOKEN' -X POST /api/items; expected status 200 and response payload.
FE verification: N/A (backend-only).
Migration decision: inspect existing migration history before creating artifacts; data migration required.
Migration path: db/migrations/2026_example.sql per active repo/project instructions.
Migration command: npm run db:migrate.
No restart expected.
Completion Evidence Gate: do not run br close until the close reason records actual curl command, status, response, and migration evidence.
Test Session Budget: <=1 session.
"`;

  const state = {
    current_phase: "5",
    phase_outputs: { "1.6": { feature_mode: "be-only" } },
  };
  assert.equal(validatePhase5VerificationClauses(command, state), null);
});

test("Phase 5 validator still blocks migration-required bead without apply command", () => {
  const command = `br create --title "[Phase 1] Update service contract" --description "
Technical Contract: API Contract endpoint POST /api/items with request shape, response shape, and expected status 200.
Data / DB / Config Contract: database table item_config owns persisted values.
BE verification clause: curl -H 'Authorization: Bearer TEST_TOKEN' -X POST /api/items; expected status 200 and response payload.
FE verification: N/A (backend-only).
Migration decision: inspect existing migration history before creating artifacts; data migration required.
Migration path: db/migrations/2026_example.sql per active repo/project instructions.
No restart expected.
Completion Evidence Gate: do not run br close until the close reason records actual curl command, status, response, and migration evidence.
Test Session Budget: <=1 session.
"`;

  const state = {
    current_phase: "5",
    phase_outputs: { "1.6": { feature_mode: "be-only" } },
  };
  assert.match(
    validatePhase5VerificationClauses(command, state) ?? "",
    /repository-appropriate migration apply command/i,
  );
});

test("bootstrap invariant accepts repo-native migration proof and keeps gate strict", () => {
  const good = `
## API Contract
GET /api/config returns expected 200 payload.
## Data / DB / Config Contract
Source of truth: settings key runtime.mode.
## Bootstrap / Provisioning Contract
Data migration required. Migration artifact: db/migrations/2026_runtime_mode.sql per active repo/project instructions.
`;
  assert.equal(validateBootstrapProvisioningInvariant(good), null);

  const bad = `
## API Contract
GET /api/config returns expected 200 payload.
## Data / DB / Config Contract
Source of truth: settings key runtime.mode.
`;
  const issue = validateBootstrapProvisioningInvariant(bad) ?? "";
  assert.match(issue, /explicit bootstrap proof/i);
  assert.doesNotMatch(issue, /onehammer/i);
});

test("canonical Beads mapping accepts arbitrary project prefix and rejects alias-only mapping", () => {
  const canonical = `## Story-To-Bead Mapping\n| Story | Bead |\n| S1 | teamalpha-r35 |`;
  assert.equal(storyMapHasCanonicalBeadId(canonical, new Set(["teamalpha-r35"])), true);

  const aliasOnly = `## Story-To-Bead Mapping\n| Story | Bead |\n| S1 | br-r35 |`;
  assert.equal(storyMapHasCanonicalBeadId(aliasOnly, new Set()), false);
});
