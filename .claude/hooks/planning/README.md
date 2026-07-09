# planning_guard — MCP hook enforcer for the `planning` skill

Single Node `.mjs` entry point (`.claude/hooks/planning_guard.mjs`) that reads stdin
JSON from Claude Code hook events and enforces the `planning` skill's phase gates
and artifact invariants. No external dependencies — only Node built-ins.

`.planning/state/planning-state-v2.json` is the single authoritative planning status/state file. Hooks do not require or consume a Markdown status mirror.

## Root scoping

The guard keeps control-plane state and target-repo artifacts separate:

```text
CONTROL_ROOT = CLAUDE_PROJECT_DIR or cwd
TARGET_ROOT  = phase_outputs.0.project_index_root when selected
HISTORY_ROOT = TARGET_ROOT when selected; otherwise CONTROL_ROOT
```

`.planning/state`, hook code, skill code, and `.mcp.json` are read from `CONTROL_ROOT`. Relative `history/...` artifact paths are resolved from `HISTORY_ROOT`. For a generic nested-repository case:

```text
CONTROL_ROOT = /workspace/control
TARGET_ROOT  = /workspace/control/service-repo
feature      = example-feature

required workspace:
  /workspace/control/service-repo/history/example-feature
```

A directory at `/workspace/control/history/example-feature` does not satisfy the gate. When no target repo has been selected, history keeps the previous/default behavior and resolves under the normal project/cwd root.

## Architecture

```
.claude/hooks/
├── planning_guard.mjs            # Entry — route by hook_event_name
└── planning/
    ├── lib/
    │   ├── state.mjs             # Read/validate state + target-repo-scoped history path resolution
    │   ├── phase_gates.mjs       # Phase ordering helpers
    │   ├── artifacts.mjs         # Parse discovery.md / approach.md / ...
    │   ├── index_root_resolver.mjs # Shared Phase 0 target-root resolution/validation
    │   ├── index_job_state.mjs   # Atomic JSON-backed background index job lifecycle state
    │   └── diagnostics.mjs       # Format [planning-guard] reasons
    ├── validators/
    │   ├── pre_tool_use.mjs
    │   ├── post_tool_use.mjs
    │   ├── post_tool_batch.mjs
    │   ├── stop.mjs
    │   ├── user_prompt_submit.mjs
    │   └── session_start.mjs
    ├── resolve_index_root.mjs    # Phase 0 CONTROL_ROOT -> TARGET_INDEX_ROOT resolver CLI
    ├── index.sh                  # Canonical Serena + GitNexus index entrypoint + background job start/wait/status
    ├── tests/
    │   ├── phase0_index_root.test.mjs
    │   └── run_phase0_index_root_tests.sh
    ├── state.schema.json         # JSON Schema for state file (documentation)
    └── README.md                 # (this file)
```

## Rule coverage

| Event             | Rule (MVP)                                                                                                                                                 | Decision                 |
|-------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------|
| PreToolUse:Bash   | Block bare `bv` without `--robot-*` / `--export-graph` / `--help`                                                                                          | permissionDecision deny  |
| PreToolUse:Bash   | Block `br create` when `current_phase >= 5` AND `phase_plan_approved === false`                                                                            | permissionDecision deny  |
| PreToolUse:Bash   | Block `br create` at phase >=5 unless Phase 4 approval gate is fully closed (`phase_outputs.4_approval.status=completed`, `approved=true`, `approval_response=Approve`) | permissionDecision deny  |
| PreToolUse:Bash   | Block `br create` at phase >=5 in full mode unless **all phases declared in phase-plan.md** have both `contracts/phase-<n>-contract.md` and `story-maps/phase-<n>-story-map.md` artifacts | permissionDecision deny  |
| PreToolUse:Bash   | Block `br create` when bead description lacks technical contract details (API contract + DB/config source-of-truth), evidence clauses matching the bead's actual BE/FE/integration surface, migration/provisioning decision rules, completion close-gate evidence, or test-session budget/split policy; for `agent-browser` evidence require `.claude/lessons/browser-runbook.md`, before-action and after/final screenshot paths, browser action sequence, screenshot interpretation expectations, expected browser network/API cue plus artifact/requests log, quality-gate classification, and runbook delta expectation; also block oversized fullstack beads that combine BE/API curl/runtime proof with FE agent-browser proof unless a split/paired bead or `Single-session exception` is explicit | permissionDecision deny  |
| PreToolUse:Bash   | Block `br close` for implementation/test beads whose description requires runtime evidence unless the close reason records required API/auth/status evidence, DB/query proof when named, migration/provisioning decision/apply proof when relevant, and FE agent-browser evidence only when FE/UI evidence is required: before-action + after/final screenshots, what each screenshot proves, browser action summary, expected/observed UI state, browser network method/path/status when relevant, non-empty network artifact (0-request HAR is rejected), runbook delta/unchanged status, and quality-gate classification (or explicit FE N/A/mismatch follow-up for BE-only scope) | permissionDecision deny  |
| PreToolUse:Bash   | Block large chained `br dep add` batches in Phase 5+ so dependency edges are reviewed as real prerequisites instead of recreating an over-linear graph; keep independent beads parallel-ready and use fan-out/fan-in | permissionDecision deny |
| PreToolUse:Agent  | Block discovery Agent calls outside Phase 1; deny any Architecture-lane subagent launch (that lane is main-agent-owned via GitNexus-direct); during Phase 1 require exactly one canonical subagent lane (Patterns/Constraints/External), `subagent_type="general-purpose"`, `run_in_background=true`, and the exact versioned `[PLANNING_DISCOVERY_AGENT_CONTRACT_V1]` key/value block with lane-specific canonical artifact. The block machine-checks direct full-detail file delivery, single-lane write scope, main-agent ownership of `discovery.md`/state, file handoff, topology/provider-first ordering, and Browser Runbook candidate capture. Duplicate blocking uses effective lifecycle classification: identity-less `running` is `orphaned`/retryable, not a permanent lock | permissionDecision deny  |
| PreToolUse:AskUserQuestion | Block AskUserQuestion outside phases 1.5 / 1.6 / 2.5 / 4; Phase 0 project indexing is automatic and user prompting is blocked; block Phase 1.5 questions until Phase 1 is completed and Phase 1.6 questions until Phase 1.5 is completed; hard-block resume reread only when `.planning/state/planning-state-v2.json` explicitly sets `resume_context.required=true` (continuous in-session planning gets non-blocking prime/reminder from SessionStart/UserPromptSubmit); in Phase 1.5 require exactly 4 questions per round with header/text/>=2 options each, cap at 12 total via `phase_outputs."1.5".questions_asked`; in Phase 1.6 require exactly 4 questions per round with header/text/>=2 options each, cap at 8 total via `phase_outputs."1.6".questions_asked`; in Phase 2.5 require the exact phase-plan approval shape; in Phase 4 require full feature-plan contract/story-map coverage before allowing the exact whole-set approval shape | permissionDecision deny  |
| PreToolUse:Write/Edit | Target-scope active feature history writes: when selected target repo differs from control root, block relative `history/<feature>/...` writes that would land under control root and block absolute writes into the wrong control-root workspace; also block flat phase contract/story-map paths | permissionDecision deny |
| PostToolBatch     | At `current_phase === "1"`, validate each discovery Agent call against the same canonical versioned contract, lane identity, background mode, and subagent type without inferring global coverage from a partial batch; malformed calls receive copy-safe corrective guidance | additionalContext       |
| PostToolUse       | After Write/Edit state file: require canonical phase ordering; Phase 0 evidence/index invariants; reject Phase 1 `status="running"` entries that lack verified launch identity; validate target-scoped artifacts and later phase invariants; inject continuity guidance including canonical Phase 1 launcher instructions and later 2 -> 2.5, 3 -> 4, 5 -> 7 transitions | decision block           |
| PostToolUse       | After Write/Edit `approach.md`: require Gap Analysis / Recommended Approach / Alternatives Considered / Risk Map                                           | decision block           |
| PostToolUse       | After Write/Edit `discovery.md`: require 12 sections from SKILL.md                                                                                         | decision block           |
| PostToolUse       | After Write/Edit/MultiEdit under `history/<feature>/discovery-lanes/`: require canonical numbered lane filenames (`1-architecture.md`, `2-patterns.md`, `3-constraints.md`, `4-external.md`) | decision block           |
| PostToolUse       | After Write/Edit `contracts/phase-<n>-contract.md` / `story-maps/phase-<n>-story-map.md`: require core sections                                                                 | decision block           |
| PostToolUse       | After Bash `bv --robot-insights`: parse stdout, block if cycles are non-empty                                                                              | decision block           |
| PostToolUse       | After Write/Edit/MultiEdit of the authoritative JSON state file: verify completed artifacts exist, Phase 1 lane artifacts exist, Phase 1.5 / 1.6 / 2.5 invariants hold, terminal Phase 7 invariants hold (`validation_mode`, `cycles_found=0`, READY* verdict, validator ID policy, `completed_phases` contains `7`, `current_phase="7"`, `planning_active=false`), and (for full mode) Phase 5 has full-feature Story-To-Bead coverage using canonical actual Beads issue IDs returned by `br` (whatever project prefix the active repo uses) across all phases declared in phase-plan.md before Phase 7; `br-*` aliases are backward-compatible input only and should be normalized to the canonical actual IDs before this gate | decision block   |
| Stop              | When planning active, block if last_assistant_message does not start with the full machine-checkable PIPELINE STATUS block. Also block premature “if you’re ok I’ll continue” pause prompts during Phase 2 before 2.5 approval prep, during Phase 3/4 before the Phase 4 approval AskUserQuestion, and during Phase 5/7 after Phase 4 Approve before terminal Phase 7 readiness. Once Phase 7 atomically sets `planning_active=false`, planning may stop. Respects `stop_hook_active` loop guard + `PLANNING_GUARD_BYPASS=1` | decision block           |
| UserPromptSubmit  | Detect planning intent; for explicit `/planning`, attempt safe target resolution and start background indexing before broad context reads, keep Phase 0 bounded, then after successful collection direct immediate Phase 1 spawning with the canonical versioned prompt block and no pre-marked `running` state | additionalContext        |
| SessionStart      | If planning active, inject current_phase + next-action context; Phase 1 resume is special-cased to launch missing/failed/orphaned background `general-purpose` subagent lanes (Patterns/Constraints/External) with the canonical versioned prompt block and to produce a missing Architecture lane directly in the main agent via GitNexus; identity-less `running` is explicitly retryable; later phases keep focused resume guidance | additionalContext        |

## Phase 1 discovery Agent contract and lifecycle

The failure transcript demonstrates why Phase 1 must not depend on free-form phrase matching or speculative state updates: all four Agent calls can be denied by PreToolUse before spawn while state already says `running`, producing false duplicate blocks on retry.

The fixed contract is the exact block documented in `.claude/skills/planning/references/launch-discovery-agents.md`:

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

Only `lane` and `artifact` vary by lane/feature. The guard parses exact keys/values rather than attempting to infer equivalent prose. Malformed/missing blocks are denied.

State lifecycle rules:

- never set a lane to `running` before Agent launch acceptance;
- `running` is valid only with non-empty `agent_id`, non-empty `launch_id`, or `attempt_id` plus `launch_confirmed_at`;
- `running` without launch identity is classified as `orphaned` for duplicate checks and is retryable on refresh;
- `missing`, `failed`, and `orphaned` are retryable;
- an existing canonical lane artifact is completion evidence and suppresses duplicate launch even if the ledger is stale;
- `completed`/`succeeded` without the canonical artifact is treated as orphaned rather than authoritative completion.

Focused regression tests:

```bash
.claude/hooks/planning/tests/run_discovery_agent_contract_tests.sh
```

## Phase 1.6 test-clarification logic

State `phase_outputs."1.6"` tracks early test clarification.
When verifying Phase 1.6 completion:

- `questions_asked` must reach exactly 8 (2 rounds × 4 questions).
- AskUserQuestion content must include mode-aware test clarification (`fullstack`, `fe-only`, `be-only`).
- For FE-involving modes, AskUserQuestion content must include FE screenshot checkpoint choices (before important action + after/final state) and require interpreting what each screenshot proves.
- `test_scenarios_path` is required before advancing to Phase 2.
- `test-scenarios.md` should include an Evidence Matrix covering FE/BE/integration proof with explicit `N/A` when not applicable, including browser network method/path/status and artifact path when integration is in scope.
- For FE-involving modes, `test-scenarios.md` should reference `.claude/lessons/browser-runbook.md` as the single living Browser Runbook and record feature-specific browser flow as a runbook delta, not a new file; durable login/navigation/selector/network/UI discoveries must be appended to that runbook.
- After Phase 1.6 completes, the pipeline continues directly to Phase 2 and Phase 2.5 prep without extra confirmation pause.

## Escape hatches

- `PLANNING_GUARD_BYPASS=1` → immediate exit 0, no output. Use when debugging.
- `PLANNING_GUARD_DEBUG=1`  → verbose stderr.
- Missing state file       → bail out (hook returns no decision).
- Invalid state schema     → warn on stderr, do not block (graceful degradation).
- Legacy state (`4.5`/`4.6` markers) → bail out, phase gates disabled.

## Pipe-test examples

```bash
# 1. Bare `bv` must be denied.
echo '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"bv"}}' \
  | node .claude/hooks/planning_guard.mjs

# 2. `bv --robot-triage` must pass (no output).
echo '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"bv --robot-triage"}}' \
  | node .claude/hooks/planning_guard.mjs

# 3. Phase 0 must not ask before indexing; any AskUserQuestion is denied.
echo '{"hook_event_name":"PreToolUse","tool_name":"AskUserQuestion","tool_input":{"questions":[{"header":"Reindex","question":"Reindex before discovery?","options":[{"label":"Yes"},{"label":"No"}]}]}}' \
  | CLAUDE_PROJECT_DIR=/path/to/fixture node .claude/hooks/planning_guard.mjs

# 3b. Resolve target from a planning source path, then pass it explicitly to the index script.
CONTROL_ROOT=/path/to/control-workspace
SOURCE_PATH=/path/to/nested-repo/my_build/features/feature.md
RESOLUTION_JSON="$(node "$CONTROL_ROOT/.claude/hooks/planning/resolve_index_root.mjs" \
  --control-root "$CONTROL_ROOT" --source "$SOURCE_PATH")"
TARGET_INDEX_ROOT="$(printf '%s' "$RESOLUTION_JSON" | jq -er '.target_root')"
"$CONTROL_ROOT/.claude/hooks/planning/index.sh" --target "$TARGET_INDEX_ROOT"

# 4. Stop with loop guard — must NOT block.
echo '{"hook_event_name":"Stop","stop_hook_active":true,"last_assistant_message":"done"}' \
  | node .claude/hooks/planning_guard.mjs

# 5. Bypass env — no output ever.
PLANNING_GUARD_BYPASS=1 echo '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"bv"}}' \
  | node .claude/hooks/planning_guard.mjs

# 6. Phase 1.5/1.6 continuous planning must not hard-block reread reminders by default.
#    To test hard-block behavior, fixture state must explicitly set resume_context.required=true.
printf '%s' '{"hook_event_name":"PreToolUse","tool_name":"AskUserQuestion","tool_input":{"questions":[{"header":"Q1","question":"Q1","options":[{"label":"A"},{"label":"B"}]},{"header":"Q2","question":"Q2","options":[{"label":"A"},{"label":"B"}]},{"header":"Q3","question":"Q3","options":[{"label":"A"},{"label":"B"}]},{"header":"Q4","question":"Q4","options":[{"label":"A"},{"label":"B"}]}]}}' \
  | CLAUDE_PROJECT_DIR=/path/to/project node .claude/hooks/planning_guard.mjs
```

Requirement-source resolution order for explicit `resume_context.required=true` checks:
1. `resume_context.requirement_source_path`
2. `phase_outputs.0.requirement_source_path` (or `phase_outputs."1.5".requirement_source_path` / latest in `requirement_source_paths`)
3. latest markdown file by mtime in target-repo-scoped `history/<feature>/requirements/` (`HISTORY_ROOT`, fallback control root only when no target is selected)

If none resolve to an existing file, the explicit resume gate passes through instead of hard-coding a fallback path.


## Automatic Phase 0 project indexing

### Early-start ordering

The transcript-driven ordering requirement is explicit: indexing must start before broad requirement/pre-flight/state/project content reads where possible. `UserPromptSubmit` is registered in `.claude/settings.json` and, for an explicit `/planning` invocation, calls the shared resolver and starts:

```bash
.claude/hooks/planning/index.sh --target <resolved-root> --background
```

before the normal planning response begins. The hook injects `job_id`, target provenance, and the mandatory collection command. If safe target resolution is unavailable, it does not guess a broad parent root; the skill must resolve/start immediately before broad reads or stop on ambiguity.

The background launch is only concurrency, not success evidence. Before Phase 0 completes, planning must run:

```bash
.claude/hooks/planning/index.sh --wait --job <job-id>
```

Any non-zero exit is fail-closed: stop planning, report the indexing error, keep Phase 0 incomplete, and do not continue to discovery. Background job lifecycle state is stored only in the authoritative `.planning/state/planning-state-v2.json` under `phase_outputs.0.project_index_jobs.<job-id>`; no `.planning/index-jobs/<job-id>/` directory is created. The Phase 0 validator requires the selected record to be terminal success for the same target root and collected by `--wait`; a running, failed, wrong-target, missing-record, or uncollected job cannot satisfy Phase 0.

Phase 0 separates two roots:

```text
CONTROL_ROOT       = Claude workspace containing .claude/hooks and .planning/state
TARGET_INDEX_ROOT  = repository indexed by Serena and GitNexus
```

`resolve_index_root.mjs` resolves `TARGET_INDEX_ROOT` before any indexing. Target-intent precedence is explicit target, explicit source, same-feature stored Phase 0 root, resume source, current/newest JSON-state source, then `pwd` only when it is an unambiguous non-broad repository fallback. From a source anchor it chooses nearest Git root, then nearest `.serena/project.yml`, then the exact `<repo>/my_build/features/<file>.md` fallback. Ambiguity, conflicts, missing explicit sources, or broad-control-root-only fallback exit non-zero.

Example nested-repo resolution:

```bash
node .claude/hooks/planning/resolve_index_root.mjs \
  --control-root /workspace/control \
  --source /workspace/control/service-repo/my_build/features/example-feature.md
```

must return target root `/workspace/control/service-repo`, never `/workspace/control`.

`index.sh` is the single canonical indexing entrypoint:

```bash
index.sh --target /path/to/repo                    # synchronous
index.sh --target /path/to/repo --background       # prints job id
index.sh --wait --job <job-id>                     # collect; propagates failure
index.sh --status --job <job-id>                   # non-blocking probe
```

`--target-root` is accepted as an alias for `--target`. The script requires an explicit target, canonicalizes and enters exactly that target, verifies both `uvx` and `gitnexus`, then runs in strict order:

```bash
uvx --from git+https://github.com/oraios/serena serena project index --log-level INFO
gitnexus analyze
```

It never infers the target from `CLAUDE_PROJECT_DIR` or `pwd`. It emits concise `[planning-index]` logs with the final target root. Serena failure stops before GitNexus; GitNexus failure exits non-zero. Background jobs run the same in-script implementation but publish lifecycle metadata atomically into `phase_outputs.0.project_index_jobs` in the authoritative JSON state. Full runtime output is captured only in a temporary OS file outside the worktree and removed by the worker; on failure, a bounded `log_tail` is stored inline in the JSON record. The script never creates `pid`, `status`, `queued_at`, `started_at`, `finished_at`, `target_root`, `index.log`, or `exit_code` files under `.planning/index-jobs/<job-id>/`. Planning instructions start resolution + indexing before broad context reads where possible, overlap independent Phase 0 work, and require terminal collection before discovery; there is no reindex question or skip path.

Focused fixture tests (no real indexing) are available via:

```bash
.claude/hooks/planning/tests/run_phase0_index_root_tests.sh
```

## settings.json integration

The guard script is merged into `.claude/settings.json` alongside the existing GitNexus
hooks. GitNexus's `PreToolUse (Grep|Glob|Bash|Read)` and `PostToolUse (Bash)` matcher
groups are preserved unchanged; the planning guard uses its own matcher groups
(`Agent|AskUserQuestion|Write|Edit|MultiEdit|Bash` on PreToolUse, `Write|Edit|MultiEdit|Bash|Agent|AskUserQuestion`
on PostToolUse). The `Bash` overlap is intentional — both hooks fire for Bash calls.

Hook timeouts: PreToolUse 15s, PostToolBatch 20s, PostToolUse 20s, Stop/SessionStart/UserPromptSubmit 10s.

## Adding a new rule

1. Add a helper to `planning/lib/artifacts.mjs` or `planning/lib/state.mjs` if new data
   needs to be read.
2. Append the rule to the relevant `planning/validators/*.mjs`. Return an object from
   `diagnostics.mjs` (`preToolUseDeny`, `topLevelBlock`, `additionalContext`) or
   `null` to pass through.
3. Add a pipe-test stanza below.
4. Never exit non-zero on expected user-land input — always return `null` and let the
   tool proceed. Exit 1 only on genuine internal fatal errors.
