# planning_guard — MCP hook enforcer for the `planning` skill

Single Node `.mjs` entry point (`.claude/hooks/planning_guard.mjs`) that reads stdin
JSON from Claude Code hook events and enforces the `planning` skill's phase gates
and artifact invariants. No external dependencies — only Node built-ins.

## Architecture

```
.claude/hooks/
├── planning_guard.mjs            # Entry — route by hook_event_name
└── planning/
    ├── lib/
    │   ├── state.mjs             # Read/validate .planning/state/planning-state-v2.json
    │   ├── phase_gates.mjs       # Phase ordering helpers
    │   ├── artifacts.mjs         # Parse discovery.md / approach.md / ...
    │   └── diagnostics.mjs       # Format [planning-guard] reasons
    ├── validators/
    │   ├── pre_tool_use.mjs
    │   ├── post_tool_use.mjs
    │   ├── post_tool_batch.mjs
    │   ├── stop.mjs
    │   ├── user_prompt_submit.mjs
    │   └── session_start.mjs
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
| PreToolUse:Agent  | Block discovery Agent calls outside Phase 1; during Phase 1 block ambiguous lanes, duplicate running/completed lanes, invalid subagent types, missing `run_in_background=true`, prompts that do not require artifact-ready Markdown in the subagent response, or prompts that let subagents write files/state instead of the main agent; prompts must also ask for Browser Runbook candidates when durable UI route/login/selector/state cues are found | permissionDecision deny  |
| PreToolUse:AskUserQuestion | Block AskUserQuestion outside phases 0 / 1.5 / 1.6 / 2.5 / 4; block Phase 1.5 questions until Phase 1 is completed and Phase 1.6 questions until Phase 1.5 is completed; hard-block resume reread only when `.planning/state/planning-state-v2.json` explicitly sets `resume_context.required=true` (continuous in-session planning gets non-blocking prime/reminder from SessionStart/UserPromptSubmit); in Phase 0 require the exact GitNexus reindex question; in Phase 1.5 require exactly 4 questions per round with header/text/>=2 options each, cap at 12 total via `phase_outputs."1.5".questions_asked`; in Phase 1.6 require exactly 4 questions per round with header/text/>=2 options each, cap at 8 total via `phase_outputs."1.6".questions_asked`; in Phase 2.5 require the exact phase-plan approval shape; in Phase 4 require full feature-plan contract/story-map coverage before allowing the exact whole-set approval shape | permissionDecision deny  |
| PreToolUse:Write/Edit | Block flat `history/<feature>/phase-<n>-contract.md` and `history/<feature>/phase-<n>-story-map.md`; require `contracts/` and `story-maps/` directories; when writing execution plan / operating at Phase 8, require atomic Phase 7 state (`status=completed`, `validation_mode`, `cycles_found=0`, READY* verdict, validator ID policy, completed_phases contains `7`); allow direct state-file repair edits so PostToolUse can validate the resulting atomic state instead of deadlocking on a stale mid-transition file | permissionDecision deny |
| PostToolBatch     | At `current_phase === "1"`, validate discovery Agent batches without inferring global lane coverage from a partial batch; malformed Agent calls receive corrective guidance that preserves the artifact-ready response / main-agent persistence split | additionalContext       |
| PostToolUse       | After Write/Edit state file: require canonical phase ordering and Phase 0 evidence for `serena`, `exa`, `gitnexus`, GitNexus reindex ask/response, `br`, `bv`, and `jq`; inject continuity guidance to continue 2 -> 2.5, (after 2.5 approval) 3 -> 4, and (after Phase 4 Approve) 5 -> 7 -> 8 without extra confirmation pauses | decision block           |
| PostToolUse       | After Write/Edit `approach.md`: require Gap Analysis / Recommended Approach / Alternatives Considered / Risk Map                                           | decision block           |
| PostToolUse       | After Write/Edit `discovery.md`: require 12 sections from SKILL.md                                                                                         | decision block           |
| PostToolUse       | After Write/Edit/MultiEdit under `history/<feature>/discovery-lanes/`: require canonical numbered lane filenames (`1-architecture.md`, `2-patterns.md`, `3-constraints.md`, `4-external.md`) | decision block           |
| PostToolUse       | After Write/Edit `contracts/phase-<n>-contract.md` / `story-maps/phase-<n>-story-map.md`: require core sections                                                                 | decision block           |
| PostToolUse       | After Bash `bv --robot-insights`: parse stdout, block if cycles are non-empty                                                                              | decision block           |
| PostToolUse       | After Write/Edit/MultiEdit of state file: verify PLANNING_STATUS.md exists and mirrors feature/current phase/approval, completed artifacts exist, Phase 1 lane artifacts exist, Phase 1.5 / 1.6 / 2.5 invariants hold, atomic Phase 7 invariants hold (`validation_mode`, `cycles_found=0`, READY* verdict, validator ID policy, completed_phases contains `7` before Phase 8), and (for full mode) Phase 5 has full-feature Story-To-Bead coverage using canonical actual `one_hammer-*` Beads issue IDs across all phases declared in phase-plan.md before Phase 7/8; `br-*` aliases are backward-compatible input only and should be normalized before this gate | decision block   |
| Stop              | When planning active, block if last_assistant_message does not start with the full machine-checkable PIPELINE STATUS block. Also block premature “if you’re ok I’ll continue” pause prompts during Phase 2 before 2.5 approval prep, during Phase 3/4 before the Phase 4 approval AskUserQuestion, and during Phase 5/7 after Phase 4 Approve before the Phase 8 stop gate. Respects `stop_hook_active` loop guard + `PLANNING_GUARD_BYPASS=1` | decision block           |
| UserPromptSubmit  | Detect planning intent, inject additionalContext reminder + active planning state                                                                          | additionalContext        |
| SessionStart      | If planning active, inject current_phase + next-action context and non-blocking resume prime/reminder (reread requirement source + existing artifacts before continuing after a true interruption) | additionalContext        |

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

# 3. Phase 0 GitNexus reindex question must pass when state current_phase is 0.
echo '{"hook_event_name":"PreToolUse","tool_name":"AskUserQuestion","tool_input":{"questions":[{"header":"GitNexus Reindex","question":"The current GitNexus index may be stale or inaccurate. Reindex GitNexus now before planning discovery?","options":[{"label":"Yes"},{"label":"No"}]}]}}' \
  | CLAUDE_PROJECT_DIR=/path/to/fixture node .claude/hooks/planning_guard.mjs

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
3. `history/<feature>/PLANNING_STATUS.md` artifacts table row (`Source request` / `Requirement source`)
4. latest markdown file by mtime in `history/<feature>/requirements/`

If none resolve to an existing file, the explicit resume gate passes through instead of hard-coding a fallback path.


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
