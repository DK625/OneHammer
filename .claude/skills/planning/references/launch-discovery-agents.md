---
name: launch-discovery-agents
description: >
  Phase 1 launcher protocol. Immediately launches missing/retryable subagent
  discovery lanes (Patterns, Constraints, External) after successful Phase 0
  using a versioned machine-checkable Agent prompt contract, then runs the
  Architecture lane in the main agent itself via GitNexus. Each general-purpose
  subagent writes its own canonical lane artifact; the main agent writes
  1-architecture.md directly, verifies files, compiles discovery.md, and owns state.
---

# Phase 1: Discovery Lane Coverage Protocol

Phase 1 starts immediately after Phase 0 succeeds. Coverage is still the four orthogonal lanes, but ownership is split:

1. Architecture — **main-agent-owned** (GitNexus-direct; no subagent)
2. Patterns — subagent
3. Constraints — subagent
4. External — subagent

All four lanes share the same delivery promise: **full detailed, non-summary Markdown** at the canonical lane path.

The three subagent lanes use:

- `subagent_type="general-purpose"`
- `run_in_background=true`
- exactly one canonical lane per Agent call
- the exact versioned prompt block defined below
- direct write to that lane's own canonical Markdown file

**Never spawn an Agent for the Architecture lane** — the guard denies it. Launch the three subagent lanes first (one parallel batch), then, while they run in the background, execute the Architecture lane inline per the protocol below.

The canonical files are the handoff. The main agent reads/verifies those files, compiles `discovery.md`, and manages planning state; it does not retrieve/copy background response bodies into lane files.

## Main-Agent Architecture Lane (GitNexus-direct)

The main agent produces `HISTORY_ROOT/history/<feature>/discovery-lanes/1-architecture.md` itself, immediately after launching the three subagent lanes. Use the GitNexus MCP tools freely — there is no fixed call budget; use as many calls as the feature needs:

1. `list_repos` — confirm the indexed repo name and freshness; pass `repo` explicitly on every later call when more than one repo is indexed.
2. `query` — locate the execution flows and the source-of-truth module(s) for the feature concept; a second `query` for auth/config/adjacent patterns when relevant.
3. `context` — 360° view of each load-bearing symbol (callers, callees, process membership); use `include_content: true` when the exact body/signature is contract-relevant.
4. `impact` (direction=upstream, includeTests=true) — blast radius of the main façade/source-of-truth symbols.
5. `route_map` — HTTP surface inventory (verify whether needed routes exist today).
6. `cypher` — file-level `DEFINES` inventories for exact symbol/line tables, and any structural question the other tools do not answer.

The lane file must meet the same content bar as a subagent lane: scope, packages/modules/entry points/boundaries, architecture sketch, file/symbol evidence with line numbers, provider/source-of-truth before dependent consumer impact when cross-surface, Browser Runbook candidates for durable UI route/login/selector/state cues, risks, constraints, gaps, and open questions. Include a GitNexus evidence index (which call produced which claim). State honestly what GitNexus alone could not see (literal values inside unfetched bodies, ops/config context) and flag those to the Patterns/Constraints lanes instead of guessing.

Ledger lifecycle for this lane: it never becomes `running` with a launch identity. Write the canonical file, then record `status="completed"` with `owner="main-agent"` in `phase_outputs.1.lanes.architecture`. The canonical file on disk is the completion evidence.

## Fresh/Refresh Launch Order

After Phase 0 is valid:

1. Derive `HISTORY_ROOT` from `phase_outputs.0.project_index_root`; only use normal project/control root when no target repo exists.
2. Ensure `HISTORY_ROOT/history/<feature>/discovery-lanes/` exists.
3. Determine lane coverage from canonical files plus `phase_outputs.1.lanes`.
4. Treat `missing`, `failed`, and `orphaned` as retryable (subagent lanes).
5. Treat `running` as non-retryable only when it carries a verified launch identity (subagent lanes).
6. Launch all retryable subagent lanes (Patterns, Constraints, External) immediately, preferably in one parallel batch.
7. After launch acceptance, record launch identity if the runtime exposes it.
8. While subagent lanes run, execute the main-agent Architecture lane with GitNexus and write `1-architecture.md` directly (see protocol above). If the file already exists, verify it instead of redoing it.
9. Wait for canonical files; retry only missing/failed/orphaned subagent lanes.
10. Read/verify all four files, fill only specific gaps, compile `discovery.md`, then record Phase 1 completion.

## Critical State Lifecycle

Applies to the three subagent lanes. (The Architecture lane skips this lifecycle: it goes straight from `missing` to `completed` with `owner="main-agent"` once the canonical file is written.)

Never pre-mark a lane `running` before the Agent tool call succeeds.

Valid lifecycle:

```text
missing|failed|orphaned
  -> PreToolUse accepts canonical Agent prompt
  -> Agent launch is accepted
  -> running + verified launch identity
  -> canonical artifact appears
  -> completed|succeeded
```

A running lane is considered verifiable when state contains one of:

- non-empty `agent_id`; or
- non-empty `launch_id`; or
- non-empty `attempt_id` together with non-empty `launch_confirmed_at`.

If PreToolUse denies the Agent call, or launch fails before a verifiable identity exists:

- do not leave `status="running"`;
- leave the lane `missing`, or record `failed`/`orphaned` with error evidence;
- retry that lane with the canonical prompt.

Refresh recovery rule: legacy/bad state with `status="running"` but no verified launch identity is classified as `orphaned` by the guard and is retryable. It must not create a permanent `already running` deadlock.

## Canonical Machine-Checkable Contract

Every discovery Agent prompt must contain exactly one block with these markers and keys. Copy it verbatim; change only `lane=` and `artifact=` to the actual lane/feature. `lane=architecture` is invalid here — that lane is main-agent-owned and never spawned.

```text
[PLANNING_DISCOVERY_AGENT_CONTRACT_V1]
lane=<patterns|constraints|external>
artifact=history/<feature>/discovery-lanes/<canonical-numbered-file>.md
requirement_input=provided_requirement_source_or_current_request
delivery=direct_canonical_markdown_file
detail=full_detailed_non_summary
write_scope=canonical_lane_file_only
forbid=.planning/,planning-state-v2.json,discovery.md,other_lane_files
main_agent_owns=read_verify_lane_files,compile_discovery_md,manage_planning_state
handoff=canonical_file_not_background_response_body
topology=read_active_repo_project_instructions,discover_actual_topology,provider_source_of_truth_before_dependent_consumer_impact
browser_runbook_candidates=durable_ui_route_login_selector_state_cues
[/PLANNING_DISCOVERY_AGENT_CONTRACT_V1]
```

Do not paraphrase the block. Additional lane-specific prose may appear before or after it, but the block itself is the guard contract.

## Copy-Safe Launcher Prompts

Substitute all placeholders before calling `Agent`. In particular:

- `<feature>` must equal `state.feature`.
- `<REQUIREMENT_SOURCE_PATH_OR_CURRENT_REQUEST>` must be the actual requirement source or current request.
- `<HISTORY_ROOT>` must be the selected target repo root from Phase 0.

### Architecture

No Agent call. The main agent runs this lane itself with GitNexus — see "Main-Agent Architecture Lane (GitNexus-direct)" above.

### Patterns

```text
Agent(
  name="phase1-patterns",
  subagent_type="general-purpose",
  description="Patterns discovery lane — <feature>",
  prompt="Find reusable implementations, utilities, naming conventions, and coding patterns for feature <feature>. Read requirement source/current request: <REQUIREMENT_SOURCE_PATH_OR_CURRENT_REQUEST>. Use Serena/GitNexus/code intelligence as primary tools when available.\n\n[PLANNING_DISCOVERY_AGENT_CONTRACT_V1]\nlane=patterns\nartifact=history/<feature>/discovery-lanes/2-patterns.md\nrequirement_input=provided_requirement_source_or_current_request\ndelivery=direct_canonical_markdown_file\ndetail=full_detailed_non_summary\nwrite_scope=canonical_lane_file_only\nforbid=.planning/,planning-state-v2.json,discovery.md,other_lane_files\nmain_agent_owns=read_verify_lane_files,compile_discovery_md,manage_planning_state\nhandoff=canonical_file_not_background_response_body\ntopology=read_active_repo_project_instructions,discover_actual_topology,provider_source_of_truth_before_dependent_consumer_impact\nbrowser_runbook_candidates=durable_ui_route_login_selector_state_cues\n[/PLANNING_DISCOVERY_AGENT_CONTRACT_V1]\n\nWrite the full lane artifact directly to <HISTORY_ROOT>/history/<feature>/discovery-lanes/2-patterns.md. Read active repo/project instructions and discover actual topology before conclusions. Include scope, similar implementations, reusable utilities, conventions, anti-patterns, file/symbol evidence, provider/source-of-truth before dependent consumer impact when cross-surface, Browser Runbook candidates for durable UI route/login/selector/state cues, risks, constraints, gaps, and open questions. Preserve evidence and reasoning; do not compress to a short recap. Write only this lane file. The main agent owns discovery.md and planning state.",
  run_in_background=true
)
```

### Constraints

```text
Agent(
  name="phase1-constraints",
  subagent_type="general-purpose",
  description="Constraints discovery lane — <feature>",
  prompt="Identify technical constraints for feature <feature>: manifests, config, environment, CI, runtime versions, dependencies, and build/test requirements. Read requirement source/current request: <REQUIREMENT_SOURCE_PATH_OR_CURRENT_REQUEST>.\n\n[PLANNING_DISCOVERY_AGENT_CONTRACT_V1]\nlane=constraints\nartifact=history/<feature>/discovery-lanes/3-constraints.md\nrequirement_input=provided_requirement_source_or_current_request\ndelivery=direct_canonical_markdown_file\ndetail=full_detailed_non_summary\nwrite_scope=canonical_lane_file_only\nforbid=.planning/,planning-state-v2.json,discovery.md,other_lane_files\nmain_agent_owns=read_verify_lane_files,compile_discovery_md,manage_planning_state\nhandoff=canonical_file_not_background_response_body\ntopology=read_active_repo_project_instructions,discover_actual_topology,provider_source_of_truth_before_dependent_consumer_impact\nbrowser_runbook_candidates=durable_ui_route_login_selector_state_cues\n[/PLANNING_DISCOVERY_AGENT_CONTRACT_V1]\n\nWrite the full lane artifact directly to <HISTORY_ROOT>/history/<feature>/discovery-lanes/3-constraints.md. Read active repo/project instructions and discover actual topology before conclusions. Include scope, constraints by severity, technical boundaries, migration/runtime/auth/precision/build-test implications, file/symbol evidence, provider/source-of-truth before dependent consumer impact when cross-surface, Browser Runbook candidates for durable UI route/login/selector/state cues, risks, gaps, and open questions. Preserve evidence and reasoning; do not compress to a short recap. Write only this lane file. The main agent owns discovery.md and planning state.",
  run_in_background=true
)
```

### External

```text
Agent(
  name="phase1-external",
  subagent_type="general-purpose",
  description="External discovery lane — <feature>",
  prompt="Research external knowledge for feature <feature>: design patterns, best practices, API docs, and library references. Read requirement source/current request: <REQUIREMENT_SOURCE_PATH_OR_CURRENT_REQUEST>. Use Exa/web research as primary tools when available.\n\n[PLANNING_DISCOVERY_AGENT_CONTRACT_V1]\nlane=external\nartifact=history/<feature>/discovery-lanes/4-external.md\nrequirement_input=provided_requirement_source_or_current_request\ndelivery=direct_canonical_markdown_file\ndetail=full_detailed_non_summary\nwrite_scope=canonical_lane_file_only\nforbid=.planning/,planning-state-v2.json,discovery.md,other_lane_files\nmain_agent_owns=read_verify_lane_files,compile_discovery_md,manage_planning_state\nhandoff=canonical_file_not_background_response_body\ntopology=read_active_repo_project_instructions,discover_actual_topology,provider_source_of_truth_before_dependent_consumer_impact\nbrowser_runbook_candidates=durable_ui_route_login_selector_state_cues\n[/PLANNING_DISCOVERY_AGENT_CONTRACT_V1]\n\nWrite the full lane artifact directly to <HISTORY_ROOT>/history/<feature>/discovery-lanes/4-external.md. Read active repo/project instructions and discover actual topology before conclusions. Include scope, recommendations, sources mapped to product/architecture decisions, source links/doc names, provider/source-of-truth before dependent consumer impact when cross-surface, Browser Runbook candidates for durable UI route/login/selector/state cues, risks, constraints, gaps, and open questions. Preserve evidence and reasoning; do not compress to a short recap. If external research is not applicable, document that determination and evidence instead of skipping the lane. Write only this lane file. The main agent owns discovery.md and planning state.",
  run_in_background=true
)
```

## Retry Classification

Applies to the three subagent lanes; for the Architecture lane the only signal is the canonical file (present = completed, absent = the main agent must produce it now).

Use canonical files as the strongest completion evidence.

| Observed state | Canonical file | Launch identity | Classification | Action |
|---|---:|---:|---|---|
| missing/no ledger | absent | no | `missing` | launch |
| `failed` | absent | any | `failed` | retry lane |
| `orphaned` | absent | any | `orphaned` | retry lane |
| `running` | absent | no | `orphaned` | retry lane |
| `running` | absent | yes | `running` | do not duplicate |
| `completed`/`succeeded` | absent | any | `orphaned` | retry/repair lane |
| any | present | any | `completed` | verify file; do not duplicate |

Rate-limit blocks remain separately controlled by `blocked_rate_limit` and `retry_after`.

## File Gate Before Phase 1.5

Do not start Phase 1.5 until all four canonical files exist and are detailed, non-error outputs:

```text
history/<feature>/discovery-lanes/1-architecture.md
history/<feature>/discovery-lanes/2-patterns.md
history/<feature>/discovery-lanes/3-constraints.md
history/<feature>/discovery-lanes/4-external.md
```

Do not treat idle/availability notifications as lane content. Do not use a side channel to retrieve response bodies. Check the canonical files.

## Compile and Complete

Once all four files exist:

1. Read all four canonical files.
2. Verify evidence/detail/topology/risk/gap coverage.
3. Self-fill only a specific remaining gap when necessary; do not redo broad discovery.
4. Compile `history/<feature>/discovery.md`.
5. Record completed lane statuses and artifacts in the authoritative JSON state.

Example completion ledger:

```json
"lanes": {
  "architecture": { "status": "completed", "owner": "main-agent", "artifact_path": "history/<feature>/discovery-lanes/1-architecture.md" },
  "patterns": { "status": "completed", "agent_name": "phase1-patterns", "artifact_path": "history/<feature>/discovery-lanes/2-patterns.md" },
  "constraints": { "status": "completed", "agent_name": "phase1-constraints", "artifact_path": "history/<feature>/discovery-lanes/3-constraints.md" },
  "external": { "status": "completed", "agent_name": "phase1-external", "artifact_path": "history/<feature>/discovery-lanes/4-external.md" }
}
```

The main agent owns `.planning/state/planning-state-v2.json`. Lane agents must never modify it.
