---
name: launch-discovery-agents
description: >
  Phase 1 launcher protocol. Immediately launches the External discovery lane
  as a background general-purpose subagent (versioned machine-checkable Agent
  prompt contract), then runs the Architecture, Patterns, and Constraints lanes
  in the main agent itself via GitNexus/Serena, writing the three canonical lane
  files directly. The main agent verifies files, compiles discovery.md, and owns state.
---

# Phase 1: Discovery Lane Coverage Protocol

Phase 1 starts immediately after Phase 0 succeeds. Coverage is still the four orthogonal lanes, but ownership is split:

1. Architecture — **main-agent-owned** (GitNexus-direct; no subagent)
2. Patterns — **main-agent-owned** (GitNexus/Serena-direct; no subagent)
3. Constraints — **main-agent-owned** (GitNexus/Serena + config reads; no subagent)
4. External — subagent (Exa/web research)

**Launch order: spawn the External subagent FIRST** (it is the slowest lane — network latency), in its own message with exactly one Agent call, then execute the three main-agent lanes while it runs in the background.

**Never spawn an Agent for the Architecture, Patterns, or Constraints lanes** — the guard denies it. They are produced directly by the main agent per the protocol below.

The canonical files are the handoff. The main agent reads/verifies those files, compiles `discovery.md`, and manages planning state; it does not retrieve/copy background response bodies into lane files.

## Main-Agent Lanes (GitNexus/Serena-direct)

The main agent produces the three files itself, immediately after launching the External subagent. There is no fixed tool-call budget — use as many GitNexus/Serena calls as the feature needs. Recommended order: Architecture → Patterns → Constraints, because one shared discovery pass feeds all three files (do not re-discover the same symbols per lane — reuse evidence already in context and cite it in each file).

### Shared discovery pass

1. `list_repos` — confirm the indexed repo name and freshness; pass `repo` explicitly on every later call when more than one repo is indexed.
2. `query` — locate the execution flows and the source-of-truth module(s) for the feature concept; additional `query` calls for auth/config/adjacent patterns when relevant.
3. `context` — 360° view of each load-bearing symbol (callers, callees, process membership); `include_content: true` when the exact body/signature is contract-relevant.
4. `impact` (direction=upstream, includeTests=true) — blast radius of the main façade/source-of-truth symbols.
5. `route_map` — HTTP surface inventory.
6. `cypher` — file-level `DEFINES` inventories for exact symbol/line tables.
7. Serena (`find_symbol`, `get_symbols_overview`, `find_referencing_symbols`) — literal bodies and conventions the graph does not carry.
8. Targeted file reads for constraints sources: manifests, lockfiles, service units, CI configs, `.gitignore`, env/config files.

### Content bar per lane file

All three files are **evidence-dense and decision-complete** — compact is good, vague is not. Every claim carries `file:line` or a literal value. The acceptance test for each file: *a fresh session that reads only this file (plus the requirement source) can write phase contracts without re-running discovery.*

| File | Target length | Must contain |
|---|---|---|
| `1-architecture.md` | ~200–300 lines | scope; packages/modules/entry points/boundaries; architecture sketch; symbol/line evidence tables; provider/source-of-truth before dependent consumer impact when cross-surface; blast radius; cross-surface impact set in topological order; risks; gaps; open questions |
| `2-patterns.md` | ~250–400 lines | similar implementations with **verbatim signatures/literals to mirror** (adapter shapes, naming/alias conventions, widget/storage key strings, test patterns); reusable utilities; anti-patterns; file/symbol evidence; gaps; open questions |
| `3-constraints.md` | ~200–300 lines | concrete constraint values (runtime/dependency versions, env vars, config keys, service units, CI/build/test requirements, security/hardening state) by severity; migration/provisioning implications; file evidence; gaps; open questions |

Targets are ranges, not hard caps — evidence never gets cut to satisfy a line count; prose gets cut instead. Each file also records Browser Runbook candidates (durable UI route/login/selector/state cues) when the feature has a UI surface, an evidence index (which tool call produced which claim), and an honest "what the tools could not see" note instead of guesses.

**Write files section-by-section as complete sections** (finish a section before starting the next; keep open-questions maintained as you go) so a manually-refreshed session inherits a usable partial file rather than a truncated one.

### Ledger lifecycle for main-agent lanes

They never become `running` with a launch identity. Write the canonical file, then record `status="completed"` with `owner="main-agent"` in `phase_outputs.1.lanes.<lane>`. The canonical file on disk is the completion evidence. A missing file simply means the main agent produces it now.

## Fresh/Refresh Launch Order

After Phase 0 is valid:

1. Derive `HISTORY_ROOT` from `phase_outputs.0.project_index_root`; only use normal project/control root when no target repo exists.
2. Ensure `HISTORY_ROOT/.planning/history/<feature>/discovery-lanes/` exists.
3. Determine lane coverage from canonical files plus `phase_outputs.1.lanes`.
4. If the External lane is `missing`/`failed`/`orphaned`, launch it immediately — exactly one Agent call in its own message (a multi-call batch risks tool-call truncation that drops `subagent_type`/`run_in_background` or cuts the contract block mid-line).
5. Treat External `running` as non-retryable only when it carries a verified launch identity.
6. After launch acceptance, record launch identity if the runtime exposes it.
7. While External runs, produce the missing main-agent lane files in order `1-architecture.md` → `2-patterns.md` → `3-constraints.md` (see protocol above). Files that already exist are verified, not redone.
8. Wait for the External canonical file; retry only a missing/failed/orphaned External lane.
9. Read/verify all four files, fill only specific gaps, compile `discovery.md`, then record Phase 1 completion.

## Critical State Lifecycle

Applies to the External subagent lane only. (Main-agent lanes skip this lifecycle: they go straight from `missing` to `completed` with `owner="main-agent"` once the canonical file is written.)

Never pre-mark the lane `running` before the Agent tool call succeeds.

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
- retry the lane with the canonical prompt.

Refresh recovery rule: legacy/bad state with `status="running"` but no verified launch identity is classified as `orphaned` by the guard and is retryable. It must not create a permanent `already running` deadlock.

## Canonical Machine-Checkable Contract

The External Agent prompt must contain exactly one block with these markers and keys. Copy it verbatim; change only `artifact=` to the actual feature. `lane=architecture`, `lane=patterns`, and `lane=constraints` are invalid here — those lanes are main-agent-owned and never spawned.

```text
[PLANNING_DISCOVERY_AGENT_CONTRACT_V1]
lane=external
artifact=.planning/history/<feature>/discovery-lanes/4-external.md
requirement_input=provided_requirement_source_or_current_request
delivery=direct_canonical_markdown_file
detail=full_detailed_non_summary
write_scope=canonical_lane_file_only
forbid=.planning/state/,planning-state-v2.json,discovery.md,other_lane_files
main_agent_owns=read_verify_lane_files,compile_discovery_md,manage_planning_state
handoff=canonical_file_not_background_response_body
topology=read_active_repo_project_instructions,discover_actual_topology,provider_source_of_truth_before_dependent_consumer_impact
browser_runbook_candidates=durable_ui_route_login_selector_state_cues
[/PLANNING_DISCOVERY_AGENT_CONTRACT_V1]
```

Do not paraphrase the block. Additional lane-specific prose may appear before or after it, but the block itself is the guard contract.

## Copy-Safe Launcher Prompt

Substitute all placeholders before calling `Agent`. In particular:

- `<feature>` must equal `state.feature`.
- `<REQUIREMENT_SOURCE_PATH_OR_CURRENT_REQUEST>` must be the actual requirement source or current request.
- `<HISTORY_ROOT>` must be the selected target repo root from Phase 0.

### Architecture / Patterns / Constraints

No Agent calls. The main agent runs these lanes itself — see "Main-Agent Lanes (GitNexus/Serena-direct)" above.

### External

```text
Agent(
  name="phase1-external",
  subagent_type="general-purpose",
  description="External discovery lane — <feature>",
  prompt="Research external knowledge for feature <feature>: design patterns, best practices, API docs, and library references. Read requirement source/current request: <REQUIREMENT_SOURCE_PATH_OR_CURRENT_REQUEST>. Use Exa/web research as primary tools when available.\n\n[PLANNING_DISCOVERY_AGENT_CONTRACT_V1]\nlane=external\nartifact=.planning/history/<feature>/discovery-lanes/4-external.md\nrequirement_input=provided_requirement_source_or_current_request\ndelivery=direct_canonical_markdown_file\ndetail=full_detailed_non_summary\nwrite_scope=canonical_lane_file_only\nforbid=.planning/state/,planning-state-v2.json,discovery.md,other_lane_files\nmain_agent_owns=read_verify_lane_files,compile_discovery_md,manage_planning_state\nhandoff=canonical_file_not_background_response_body\ntopology=read_active_repo_project_instructions,discover_actual_topology,provider_source_of_truth_before_dependent_consumer_impact\nbrowser_runbook_candidates=durable_ui_route_login_selector_state_cues\n[/PLANNING_DISCOVERY_AGENT_CONTRACT_V1]\n\nWrite the full lane artifact directly to <HISTORY_ROOT>/.planning/history/<feature>/discovery-lanes/4-external.md. Read active repo/project instructions and discover actual topology before conclusions. Include scope, recommendations, sources mapped to product/architecture decisions, source links/doc names, provider/source-of-truth before dependent consumer impact when cross-surface, Browser Runbook candidates for durable UI route/login/selector/state cues, risks, constraints, gaps, and open questions. Preserve evidence and reasoning; do not compress to a short recap. If external research is not applicable, document that determination and evidence instead of skipping the lane. Write only this lane file. The main agent owns discovery.md and planning state.",
  run_in_background=true
)
```

## Retry Classification

Applies to the External subagent lane; for the main-agent lanes the only signal is the canonical file (present = completed, absent = the main agent must produce it now).

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

Do not start Phase 1.5 until all four canonical files exist and are evidence-dense, non-error outputs:

```text
.planning/history/<feature>/discovery-lanes/1-architecture.md
.planning/history/<feature>/discovery-lanes/2-patterns.md
.planning/history/<feature>/discovery-lanes/3-constraints.md
.planning/history/<feature>/discovery-lanes/4-external.md
```

Do not treat idle/availability notifications as lane content. Do not use a side channel to retrieve response bodies. Check the canonical files.

## Compile and Complete

Once all four files exist:

1. Read all four canonical files.
2. Verify evidence/detail/topology/risk/gap coverage.
3. Self-fill only a specific remaining gap when necessary; do not redo broad discovery.
4. Compile `.planning/history/<feature>/discovery.md`.
5. Record completed lane statuses and artifacts in the authoritative JSON state.

Example completion ledger:

```json
"lanes": {
  "architecture": { "status": "completed", "owner": "main-agent", "artifact_path": ".planning/history/<feature>/discovery-lanes/1-architecture.md" },
  "patterns": { "status": "completed", "owner": "main-agent", "artifact_path": ".planning/history/<feature>/discovery-lanes/2-patterns.md" },
  "constraints": { "status": "completed", "owner": "main-agent", "artifact_path": ".planning/history/<feature>/discovery-lanes/3-constraints.md" },
  "external": { "status": "completed", "agent_name": "phase1-external", "artifact_path": ".planning/history/<feature>/discovery-lanes/4-external.md" }
}
```

The main agent owns `HISTORY_ROOT/.planning/state/planning-state-v2.json`. Lane agents must never modify it, the active-target-root pointer, or anything else under `.planning/state/`.
