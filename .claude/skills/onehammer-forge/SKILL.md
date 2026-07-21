---
name: onehammer-forge
description: "OneHammer implementation mode: claim the next ready bead, implement with scoped context, collect runtime evidence, and hand off safely. Use only when the user types /onehammer:forge or explicitly asks to claim/implement the next ready br bead"
hidden: true
---

We are now in IMPLEMENTATION mode.
Use README protocols for br/bv, validation, and durable handoff. Before any Herdr execution coordination, read `.claude/skills/onehammer-forge/references/herdr-orchestrator.md` completely and load every reference selected by its routing table. Do not duplicate coordination logic in chat.
The planning pipeline's Claude Code `Agent` tool is not MCP Agent Mail; do not alter or route its External-lane contract through Herdr.

Autonomy:
You may proceed without asking for confirmation for normal local/dev implementation and verification: code edits, migrations/seeds, tests, py_compile/lint/type checks, local/dev migration apply, local/dev service restart, login with configured test credentials, curl/API checks, evidence collection, bead close/sync, and Herdr-supported execution handoff.

Arguments from user, if any: `$ARGUMENTS`.
Treat arguments as a focus hint only. Still select work from `br ready --json`; if a bead id is named, it must appear in the ready list or you must STOP and report that it is not ready.

Mandatory kickoff (strict order):
1. Run `br ready --json` and select only from that list. If `[]`, STOP immediately; do not fall back to `bv` recommendations or existing `in_progress` beads.
2. Lock canonical ownership immediately: `br update <bead-id> --status=in_progress`. The bead is task truth; Herdr state is transport only.
3. Record the execution boundary: bead owner, main-agent integration owner, cwd/branch, allowed writes, dependencies, required evidence, and stop conditions. Do not create file reservations; Herdr has none.
4. Use the current main-agent checkout for one writer only. If parallel writers are actually required, split independent work into ready beads/child beads first, then give every writer an isolated Git worktree, branch, Herdr target, and non-overlapping write surface.
5. Load bead-scoped context only: selected bead details, referenced history/plan/contract/story-map files, and any convention/lesson file explicitly named by the bead or plan. For relative `history/...` references, resolve them under the planning target repo recorded in `phase_outputs."0".project_index_root`; fall back to the normal current project root only when no target repo is recorded.
6. Resolve runtime conventions before implementation: if the bead/plan mentions a runtime convention, lesson, adapter, credentials source, migration checklist, or verification source, read it and extract the repo-specific runtime adapter before running migrations, restarts, login, curl/API, browser, or DB checks.
7. After context/conventions are loaded, run targeted Serena/GitNexus discovery only.

Rules:
- Bead-scoped context only; no whole-repo architecture scans and no re-planning.
- Before editing any function/class/method, run GitNexus impact analysis and account for direct dependents.
- Expand context only when required for correctness: shared API/auth/routing/DB/global state/shared UI/dependency changes, failing tests, or public interfaces. If expansion is needed, read only direct callers/callees, nearby tests, exact affected files, and current contract sources.
- Runtime adapter must identify, when applicable: env/credential source, required env keys, project/cwd for migrations, restart commands, API base URL, auth/token flow, DB query method, browser-evidence decision, and commands that must be avoided.
- Agent Browser is for browser/UI evidence only. Use it when the selected bead actually has FE/UI surface, changes frontend files, explicitly requires browser/screenshot evidence, or the user asks for browser verification. Do not use Agent Browser to validate BE-only API/DB logic; for BE/API work, use migration/test/curl/HTTP/DB proof. A broad `fullstack` label alone is not enough—fullstack execution should normally be split into a BE/API bead with curl/HTTP evidence and a separate FE/UI bead with agent-browser screenshot evidence. If a BE-only bead contains a FE screenshot clause, flag it as evidence-scope mismatch and hand off/create/link the FE/UI evidence bead instead of treating browser work as part of the BE task.
- Do not ask the user for credentials or declare a credential blocker until the configured env source has been loaded/checked and the credentialed command has been retried according to the runtime convention.
- Do not use stale rollback artifacts, generated caches, pyc files, old logs, or prior failed transcripts as source-of-truth unless the bead/contract explicitly names them. Prefer current bead, contract, story-map, runtime convention, code, DB schema, and migrations.
- Before creating a migration/seed, inspect existing migrations/provisioning for the same table, setting key, or source-of-truth; record the decision as schema migration, data/seed migration, existing provisioning proof, or no migration required.
- Test failures are evidence to investigate, not dismiss. If route/API/browser checks fail, verify the actual mount path, app/router setup, auth prefix, and contract before calling it a harness issue.
- A Herdr timeout or uncertain state is not permission to launch a duplicate writer. Inspect target IDs, process, transcript, worktree, branch, and Git state; classify and record recovery before retry.
- If the plan or bead names a canonical handoff file, update that file directly. Herdr pane state/transcripts supplement the handoff and never replace it.

Execution checklist:
1. Confirm bead readiness, canonical ownership, main-agent integration ownership, topology, and loaded context/conventions.
2. Identify the minimal safe file set with Serena/GitNexus.
3. Implement BE/API/DB contract first when applicable, then FE/UI integration.
4. Add/update required tests without replacing runtime evidence.
5. Run narrow validation first, then broader validation only when needed.
6. Collect required runtime evidence for the selected bead: migration/provisioning result, restart decision/result, auth/token source, real API/curl response, DB query proof when required, and Agent Browser screenshot only when the selected bead truly includes FE/UI/browser evidence.
7. For delegated execution, capture the Herdr target IDs and final transcript, then independently inspect the complete diff and rerun required checks in the main-agent/integration lane.
8. Run GitNexus `detect_changes` and repo quality gates before finishing.
9. Close the bead only if required evidence is captured in the close reason. Never close with generic `Completed`.
10. If required evidence cannot be run, leave the bead open/in_progress or create/link a follow-up test bead; record a durable handoff in the bead and any canonical handoff file with owner, Herdr target IDs, worktree/branch, changed files, validation status, blocker, exact next command/evidence, and retained resources; run `br sync` only after those records agree.
11. Clean up only task-created Herdr targets/worktrees that are verified safe to remove. Never force-remove recoverable work or stop the Herdr server as routine cleanup.
