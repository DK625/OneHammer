# Phase 0: Pre-flight Check

**MANDATORY** — Run this before any discovery phase. Do NOT skip.

Serena is required for semantic code discovery/editing. Exa is required for external research. GitNexus is required by `CLAUDE.md` for code intelligence / impact analysis. CLI tools (`br`, `bv`, `jq`) are required for planning workflow execution.

## Critical Ordering: Start Indexing First

Phase 0 must be fast and bounded. The first expensive action is repo indexing, and Phase 0 must not turn into a broad context-reading pass. Use the current `/planning` prompt/path only to resolve target intent, call the existing resolver/index scripts, run required health checks, collect terminal index evidence, and move immediately to Phase 1.

Required order when `/planning` starts:

```text
1. Derive a safe target intent from the current /planning prompt/path.
2. Call the existing `resolve_index_root.mjs` script to resolve TARGET_INDEX_ROOT without reading the requirement body.
3. Call the existing entrypoint via `bash index.sh --target <repo> --background` (always invoke through `bash`; the script is tracked without an executable bit) immediately; do not reimplement indexing with ad-hoc commands.
4. While indexing runs, perform only bounded tool/dependency health checks, target-scoped workspace setup, and minimal authoritative-state evidence work.
5. Before Phase 0 completes, call `bash index.sh --wait --job <id>` and collect the exit code.
6. If indexing failed, STOP planning immediately and report the error. Never continue to Phase 1.
7. If Phase 0 succeeds, set/record Phase 1 state, immediately spawn the missing External discovery lane (one Agent call in its own message), then run the three main-agent lanes (Architecture, Patterns, Constraints) with GitNexus/Serena, before any other broad main-agent context reads or code/doc exploration.
```

`UserPromptSubmit` attempts step 1-3 automatically for explicit `/planning` invocations. When its injected context contains an early `job_id`, reuse that job; do not launch a duplicate. If no early job could be started safely, manually call the resolver and `index.sh` before any broad context reads.

Resume skip: when the authoritative state already records Phase 0 `status=completed` for the SAME resolved target with collected index evidence (`project_index_ok=true`, and `project_index_waited=true` for background mode), the early-index hook does NOT start a new job (`EARLY PHASE 0 INDEX skipped` context). Re-queueing would flip `project_index_job_id`/`project_index_waited` onto a running job and retroactively invalidate completed Phase 0 evidence, blocking state writes. Resume from the current phase; if the index seems stale, run `bash index.sh --target <root> --background` manually and wait/collect it.

## Root Model: CONTROL_ROOT vs TARGET_INDEX_ROOT vs HISTORY_ROOT

Keep these concepts separate throughout Phase 0:

```text
CONTROL_ROOT      = current Claude workspace/project root
TARGET_INDEX_ROOT = repository root selected for Serena + GitNexus indexing
HISTORY_ROOT      = TARGET_INDEX_ROOT when a target repo is selected;
                    otherwise CONTROL_ROOT for backward-compatible/default behavior
```

`.planning/state/planning-state-v2.json` under `HISTORY_ROOT` (the selected target repo) is the single authoritative status/state file — it lives next to `.planning/history/<feature>/`. Hooks and `index.sh` find it through the pointer file `CONTROL_ROOT/.planning/state/active-target-root`, which `resolve_index_root.mjs` / `index.sh` write automatically on successful target resolution. Without a selected target, the state file stays under `CONTROL_ROOT/.planning/state/`. No Markdown status mirror participates in Phase 0 or resume resolution.

`CONTROL_ROOT` remains the lookup root for:

```text
.claude/hooks/planning
.claude/skills/planning
.planning/state/active-target-root   (pointer to the target repo)
.mcp.json
```

`TARGET_INDEX_ROOT` is the selected target repository. It is used as the working directory for:

```bash
uvx --from git+https://github.com/oraios/serena serena project index --log-level INFO
gitnexus analyze
```

When `TARGET_INDEX_ROOT` is selected, human planning artifacts and state are target-repo scoped:

```text
HISTORY_ROOT/.planning/history/<feature>/
HISTORY_ROOT/.planning/state/planning-state-v2.json
```

Therefore a broad Claude workspace must not keep the active feature workspace or state under its own `.planning/` when planning targets a nested repository.

Concrete required behavior:

```text
CONTROL_ROOT:
  /workspace/control

Source:
  /workspace/control/service-repo/my_build/features/example-feature.md

TARGET_INDEX_ROOT:
  /workspace/control/service-repo

HISTORY_ROOT:
  /workspace/control/service-repo

Feature workspace:
  /workspace/control/service-repo/.planning/history/example-feature

State file:
  /workspace/control/service-repo/.planning/state/planning-state-v2.json

Pointer:
  /workspace/control/.planning/state/active-target-root  ->  /workspace/control/service-repo
```

The incorrect paths for that case are:

```text
/workspace/control/.planning/history/example-feature
/workspace/control/history/example-feature
/workspace/control/.planning/state/planning-state-v2.json  (as authoritative state)
```

`CLAUDE_PROJECT_DIR` identifies the control root. It is **not** an implicit target-index or target-history root when a nested repository has been selected.

## Step 1: Resolve TARGET_INDEX_ROOT and Start Indexing Immediately

**Do not ask the user whether to reindex.** Use the source/target path already present in the current `/planning` invocation as an anchor. Resolving a path does not require reading the requirement file body.

Preferred invocation when the current request contains a requirement/source path:

```bash
CONTROL_ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
SOURCE_PATH="/absolute/or/relative/path/from-the-current-planning-request"

RESOLUTION_JSON="$(
  node "$CONTROL_ROOT/.claude/hooks/planning/resolve_index_root.mjs" \
    --control-root "$CONTROL_ROOT" \
    --source "$SOURCE_PATH"
)" || exit $?

TARGET_INDEX_ROOT="$(
  printf '%s' "$RESOLUTION_JSON" \
    | jq -er '.target_root'
)" || exit $?
```

When the current request explicitly names the target repository/directory, use:

```bash
RESOLUTION_JSON="$(
  node "$CONTROL_ROOT/.claude/hooks/planning/resolve_index_root.mjs" \
    --control-root "$CONTROL_ROOT" \
    --target-root "/absolute/or/relative/target/repo"
)" || exit $?
```

The resolver uses target-intent precedence:

1. Explicit target repo/directory from the current `/planning` request.
2. Explicit requirement/source file path from the current request.
3. Existing `phase_outputs."0".project_index_root` for same-feature resume.
4. `resume_context.requirement_source_path`.
5. Current/newest `requirement_source_path` / `requirement_source_paths` in the authoritative JSON state.
6. `pwd` only when it resolves unambiguously to a repository boundary and is not merely the broad control root.
7. Otherwise stop; do not index.

For a selected source anchor, boundary detection is:

1. Explicit target directory: canonicalize and use exactly that directory.
2. Otherwise nearest Git root from the anchor directory.
3. Otherwise nearest ancestor containing `.serena/project.yml`.
4. Otherwise exact `<repo>/my_build/features/<file>.md` fallback.
5. Otherwise fail closed.

Nested-repository rule: if the trusted anchor is inside an inner Git repository, the inner Git root wins. Never climb to an outer Git root.

The resolver must not return `/workspace/control` for the `service-repo/my_build/features/example-feature.md` source case above.

### Fail-closed resolution conditions

Stop before indexing when any of these occurs:

- Explicit source path does not exist.
- Multiple primary source paths resolve to different repositories.
- Current prompt source conflicts with prior `phase_outputs.0.project_index_root`.
- A relative path exists under both `pwd` and `CONTROL_ROOT` but resolves to different files.
- Only a broad control-root fallback is available.
- No safe Git/Serena/`my_build/features` boundary exists.

This is not the old reindex confirmation flow. Do not ask “Reindex?”. On ambiguity, stop and require an explicit target path.

### Preferred background launch

Immediately after safe resolution:

```bash
INDEX_JOB_ID="$(
  "$CONTROL_ROOT/.claude/hooks/planning/index.sh" \
    --target "$TARGET_INDEX_ROOT" \
    --background
)" || exit $?
```

`index.sh` is the single canonical indexing entrypoint. It behaves as follows:

- `bash index.sh --target <repo>`: synchronous combined index run.
- `bash index.sh --target <repo> --background`: start background job and print its job id.
- `bash index.sh --wait --job <id>`: wait/collect terminal evidence; exits non-zero when indexing failed.
- `bash index.sh --status --job <id>`: non-blocking status probe.
- `--target-root` is accepted as an alias for `--target`.

`index.sh` performs the combined work directly. It requires an explicit target, canonicalizes and enters that target, verifies both required commands, and runs in order:

```bash
uvx --from git+https://github.com/oraios/serena serena project index --log-level INFO
gitnexus analyze
```

Serena failure stops before GitNexus. GitNexus failure exits non-zero. Background mode runs the same in-script implementation; `--wait` propagates its terminal failure.

## Step 2: Run Only Bounded Health Checks While the Index Job Runs

After the background job starts, keep Phase 0 narrow. Perform only the checks/evidence needed to prove the planning toolchain is available and working:

- read the minimum authoritative state fields needed for same-feature resume/root provenance;
- verify `.mcp.json` configuration;
- verify Serena runtime readiness;
- prepare the target-scoped feature workspace;
- verify `br` / `bv` / `jq`;
- optionally probe the index job with `bash index.sh --status --job <id>` when useful.

Do **not** use this window to broad-read the requirement body, project documentation, source tree, or discovery context. Those are Phase 1 responsibilities and should be parallelized through the four lane agents. Do not treat the background launch itself as successful Phase 0 evidence.

## Step 3: Verify Required Tool/Dependency Health

Use the existing scripts and direct health probes rather than duplicating workflow logic:

- `resolve_index_root.mjs` proves target resolution;
- `index.sh` verifies `uvx` and `gitnexus` availability before running the combined index;
- `.mcp.json` plus Serena readiness checks prove required MCP configuration/runtime;
- CLI help/version probes prove `br`, `bv`, and `jq` are callable.

Read `.mcp.json` from `CONTROL_ROOT` and verify these keys exist in `mcpServers`:

| MCP Server | Required By | Role | Fallback |
|---|---|---|---|
| `serena` | All code discovery/editing | Semantic code analysis | **MUST have** |
| `exa` | External research lane | External docs/pattern research | **MUST have** |
| `gitnexus` | Discovery + impact checks | Indexed code intelligence and blast radius | **MUST have** |

Hook enforcement can verify `.mcp.json` contains these server names, but only Claude/tool execution can verify runtime readiness.

## Step 4: Verify Serena Runtime Readiness

- Call `mcp__serena__check_onboarding_performed()`.
- Onboard if needed, then re-check.
- Do not start discovery until Serena is ready.

## Step 5: Ensure Feature Workspace Under HISTORY_ROOT

Once target resolution succeeds:

```bash
HISTORY_ROOT="$TARGET_INDEX_ROOT"
mkdir -p "$HISTORY_ROOT/.planning/history/<feature>"
```

Record the canonical repo-relative planning path as:

```json
"feature_path": ".planning/history/<feature>"
```

`feature_path` stays relative for portability, but its resolution base is target-aware:

```text
if phase_outputs."0".project_index_root is selected:
  resolve .planning/history/<feature>/ under project_index_root

otherwise:
  resolve .planning/history/<feature>/ under CONTROL_ROOT / normal project root
```

There is no separate workspace-preparation phase. Phase 0 is not complete until the target-repo-scoped `.planning/history/<feature>/` exists as a directory.

When `TARGET_INDEX_ROOT != CONTROL_ROOT`, do not use a relative Write/Edit path such as:

```text
.planning/history/<feature>/discovery.md
```

from the broad control workspace, because the tool may create it under the wrong root. Use the absolute target-repo path, for example:

```text
/workspace/control/service-repo/.planning/history/example-feature/discovery.md
```

The planning guard blocks active-feature relative history writes when a selected target repo differs from the control root.

## Step 6: Verify Required CLIs

```bash
br --help 2>&1
bv --help 2>&1
jq --version 2>&1
```

## Step 7: Wait for and Collect the Index Job — Mandatory Fail-Closed Gate

Before writing Phase 0 as completed:

```bash
"$CONTROL_ROOT/.claude/hooks/planning/index.sh" \
  --wait \
  --job "$INDEX_JOB_ID"
```

Rules:

- Exit code `0`: combined indexing completed successfully; Phase 0 may record success evidence after all other checks pass.
- Any non-zero exit: **STOP the planning pipeline immediately**, report the indexing failure and relevant log tail, keep Phase 0 incomplete, and do not continue to discovery.
- Never set `project_index_ok=true`, `serena_index_ok=true`, or `gitnexus_index_ok=true` merely because the background process started.
- Never mark Phase 0 completed while the job is still running.

Background job records live only in the single authoritative JSON state:

```text
HISTORY_ROOT/.planning/state/planning-state-v2.json   (target repo; via the
CONTROL_ROOT/.planning/state/active-target-root pointer)
  phase_outputs."0".project_index_jobs.<job-id>
```

`index.sh` must not create `.planning/index-jobs/<job-id>/` or loose `pid`, `status`, `queued_at`, `started_at`, `finished_at`, `target_root`, `index.log`, or `exit_code` files in the worktree. The worker may use a temporary OS log outside the worktree while running; it deletes that file and stores only a bounded failure `log_tail` inline when needed.

The Phase 0 validator verifies from the JSON record that the selected background job targeted the same `project_index_root`, reached `status="succeeded"`, published numeric `exit_code=0`, and was collected (`collected_at`) before accepting completion.

## Step 8: Record Phase 0 Evidence and Launch Phase 1 Immediately

When marking Phase 0 complete after a successful background collection, `phase_outputs."0"` must include:

```json
{
  "status": "completed",
  "feature_path": ".planning/history/<feature>",
  "mcp_json_checked": true,
  "mcp_servers_verified": ["serena", "exa", "gitnexus"],
  "serena_onboarding_checked": true,
  "serena_ready": true,
  "project_index_ran": true,
  "project_index_ok": true,
  "project_index_execution_mode": "background",
  "project_index_job_id": "<job-id>",
  "project_index_waited": true,
  "project_index_jobs": {
    "<job-id>": {
      "job_id": "<job-id>",
      "status": "succeeded",
      "pid": 12345,
      "queued_at": "<ISO8601>",
      "started_at": "<ISO8601>",
      "finished_at": "<ISO8601>",
      "collected_at": "<ISO8601>",
      "target_root": "/absolute/path/to/target-repo",
      "exit_code": 0
    }
  },
  "project_index_root": "/absolute/path/to/target-repo",
  "project_index_control_root": "/absolute/path/to/control-workspace",
  "project_index_anchor_path": "/absolute/path/to/source-or-target-anchor",
  "project_index_root_source": "source_path_nearest_git_root",
  "serena_index_ok": true,
  "gitnexus_index_ok": true,
  "br_help_ok": true,
  "bv_help_ok": true,
  "jq_ok": true,
  "timestamp": "<ISO8601>"
}
```

For a direct synchronous run, set:

```json
"project_index_execution_mode": "synchronous"
```

and omit the background-only `project_index_job_id` / `project_index_waited` / `project_index_jobs` fields.

Evidence rules:

- `feature_path` is target-repo-relative. It resolves to existing `<project_index_root>/.planning/history/<feature>/` when a target repo is selected; without a selected target repo it falls back to `<CONTROL_ROOT>/.planning/history/<feature>/`.
- `project_index_root` is canonical `TARGET_INDEX_ROOT`, not the control root unless that root was safely derived or explicitly targeted.
- `project_index_control_root` is canonical `CONTROL_ROOT`; it owns hook/skill/pointer lookup, not nested-target history or state.
- `project_index_anchor_path` records the canonical source/directory anchor used to justify the target.
- `project_index_root_source` records resolver provenance such as `source_path_nearest_git_root`, `source_path_nearest_serena_root`, `source_path_my_build_feature_fallback`, or `explicit_target_root`.
- The four combined-index booleans (`project_index_ran`, `project_index_ok`, `serena_index_ok`, `gitnexus_index_ok`) must all be `true` only after terminal success is collected.
- For background mode, `project_index_waited` must be `true`, the job id must be safe, and `project_index_jobs[project_index_job_id]` must be preserved from `index.sh` with matching `target_root`, terminal `status="succeeded"`, numeric `exit_code=0`, and non-empty `collected_at`. Never reconstruct success from a launch alone.

Immediately after these checks succeed, transition to `current_phase="1"`, spawn the missing External discovery lane as a background `general-purpose` agent (one Agent call in its own message), then execute the three main-agent lanes with GitNexus/Serena (write `1-architecture.md`, `2-patterns.md`, `3-constraints.md` directly; never spawn subagents for them). Do not insert a broad main-agent requirement/code/docs reading pass between Phase 0 success and the Phase 1 launches.

The planning guard re-derives the root from existing anchor evidence and blocks Phase 0 completion when the recorded target does not match. It then validates the feature workspace under that selected target repo. In particular:

```text
anchor:
  /workspace/control/service-repo/my_build/features/example-feature.md

project_index_root:
  /workspace/control/service-repo

required feature workspace:
  /workspace/control/service-repo/.planning/history/example-feature
```

A decoy or stale directory at `/workspace/control/.planning/history/example-feature` (or legacy `/workspace/control/history/example-feature`) does not satisfy the gate.

## Failure Behavior

Stop before Phase 0 completion if the target-repo-scoped feature workspace is missing/misdirected, any required MCP server is missing from `.mcp.json`, Serena is not ready after onboarding, target-root resolution is missing/ambiguous/conflicting, background indexing cannot be started safely, the combined index job is still running at completion time, either Serena or GitNexus exits non-zero, the authoritative JSON job record is missing/inconsistent/wrong-target/uncollected, provenance evidence is missing or inconsistent, or `br`/`bv`/`jq` checks fail.

For an indexing error, report it immediately and keep the pipeline stopped in Phase 0. Do not continue reading toward discovery as though indexing succeeded.
