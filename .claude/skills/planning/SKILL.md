---
name: planning
description: >
  Mandatory strict feature-planning pipeline. Use when the user asks to plan,
  design, roadmap, or decompose a software feature. Runs canonical phases
  0, 1, 1.5, 1.6, 2, 2.5, 3, 4, 5, and 6 with
  feature-scoped discovery, whole-feature phase-plan approval, all-phase
  contract/story-map sets, script-materialized beads, and terminal graph
  validation. Every planning response must start with the PIPELINE STATUS header.
---

# Feature Planning Pipeline

This skill is the operating manual. Mechanical gates are enforced by `.claude/hooks/planning_guard.mjs`; detailed formats live in `references/*`.

## Non-Negotiables

1. On every explicit `/planning` invocation, keep Phase 0 fast and bounded: resolve the target from the current prompt/path without reading the requirement body, reuse any early `UserPromptSubmit` job if present, otherwise start `bash .claude/hooks/planning/index.sh --target <resolved-root> --background`, run only the required tool/dependency health checks and target-scoped workspace/state evidence work, then `--wait --job <id>`. Do not broad-read requirement/code/project docs in Phase 0. Any non-zero exit stops planning immediately and must be reported.
2. Never skip a phase in the active mode.
3. Begin every planning response with the PIPELINE STATUS header.
4. Phase 1 obtains coverage for exactly 4 canonical discovery lanes: Architecture, Patterns, Constraints, and External.
5. Immediately after successful Phase 0, launch the missing/retryable External discovery lane FIRST with a background `Agent` call — exactly one Agent call in its own message (multi-call batches risk tool-call truncation) — using `subagent_type="general-purpose"` and the exact versioned `[PLANNING_DISCOVERY_AGENT_CONTRACT_V1]` block from `references/launch-discovery-agents.md`; do not rely on fragile paraphrase. The Architecture, Patterns, and Constraints lanes are main-agent-owned: while External runs, the main agent produces `1-architecture.md`, `2-patterns.md`, and `3-constraints.md` directly with GitNexus/Serena in one shared discovery pass, at the evidence-dense content bar and target lengths defined in `references/launch-discovery-agents.md` — never spawn subagents for those lanes. The External subagent writes its own full detailed canonical Markdown file directly under `HISTORY_ROOT/.planning/history/<feature>/discovery-lanes/`. The main agent verifies/reads all four files, compiles `discovery.md`, and manages planning state; it must not copy response bodies into lane files or replace lane files with vague summaries.
6. Every phase transition updates `.planning/state/planning-state-v2.json`, the single authoritative planning status/state file. It lives under `HISTORY_ROOT` (the selected target repo, next to `.planning/history/<feature>/`); `CONTROL_ROOT/.planning/state/active-target-root` is a pointer file the hooks and `index.sh` use to find it.
7. Phase 2.5 is auto-approved: writing `phase-plan.md` completes it. Set `phase_plan_approved=true` plus `phase_outputs."2.5"` completion in state and continue straight into Phase 3 — never issue an approval AskUserQuestion for Phase 2.5.
8. If a planning hook blocks, obey the hook message before continuing.
9. After Phase 1.5 reaches 12/12 questions, continue into Phase 1.6 and collect 8/8 test-clarification questions (2 rounds of 4) before advancing to Phase 2.
10. After Phase 1.6 reaches 8/8 and `test-scenarios.md` is written, continue in one run through Phase 2, auto-approved Phase 2.5, Phase 3, and Phase 4 without extra “ok to continue?” pauses.
11. The only intentional pause between Phase 1.6 and Phase 6 is the Phase 4 whole-set approval AskUserQuestion.
12. If Phase 4 approval is `Approve`, continue in one run through Phase 5 and Phase 6 with no extra confirmation pauses in between. Phase 5 is script-materialized: run `materialize_beads.mjs`, never hand-run `br create` loops.
13. Phase 6 is the mandatory pipeline stop: when the graph check passes (cycles `[]`) and bead coverage is verified, atomically mark Phase 6 completed with `cycles_found=0`, keep `current_phase="6"`, add `"6"` to `completed_phases`, set `planning_active=false`, and stop with the validated bead graph/state. Do not invoke `orchestrator`, spawn implementation agents, reserve execution files, or start beads unless the user explicitly asks to start execution after planning completes.
14. Phase 5 beads must be close-gated: every implementation/test bead that requires runtime proof must say (inside its Bead Specs `description`) not to run `br close` until the concrete evidence is captured, interpreted, and recorded in the close reason or named evidence artifacts.
15. FE/UI, FE↔BE integration, and browser evidence beads must reference `.claude/lessons/browser-runbook.md`, read it before running `agent-browser`, and append durable UI discoveries back to that same single runbook file.
16. FE/browser evidence is not valid just because a screenshot file exists: the executor must read/inspect the screenshot(s), state what each proves, capture at least before-action and after/final screenshots, record the browser action sequence, and cache safe reusable login/navigation/UI cues in the Browser Runbook.

## PIPELINE STATUS Header

```text
=== PIPELINE STATUS ===
Current Phase : <phase number and name>
Completed     : [0, 1, ...]
Next Action   : <one-line description>
State file    : .planning/state/planning-state-v2.json
=======================
```

For a Phase 1 launch turn, this header is the only text before the single External-lane `Agent` call; the main-agent lane work (Architecture, Patterns, Constraints) follows once External is launched.

## Output Standard

Planning output is for a human reviewer. It should sound like a teammate at a whiteboard.

- Start phases and stories with what becomes true in the product or system.
- Explain order using a realistic scenario.
- Use technical terms only after the practical meaning is clear.
- Keep technical terms, but at first mention add a short Vietnamese explanation in parentheses.
- Avoid vague labels like "foundation" or "integration layer" unless translated to concrete outcomes.
- Avoid buzzword stacking: do not pack 3+ abstract terms into one sentence without unpacking.
- Show a simple demo walkthrough for every phase.
- For every "Why" section, include a concrete "If skipped" failure scenario.
- In phase stories, use concise `Input` and `Guarantee`; add `Failure avoided` when non-obvious.
- If a story cannot answer "what becomes possible after this?", rewrite it.

## Cross-Surface Contract Rule

Do not assume a fixed monorepo, backend/frontend directory pair, framework, or repository layout. First read the active repository/project instructions and discover the actual topology. When work crosses components or repositories, identify the contract provider/source of truth and its dependent consumers; present provider-side contract findings first, then downstream consumer impact. For a pure single-surface feature, state which other surfaces were not inspected and why.

Test planning in Phase 1.6 must classify the feature into one of these modes and define evidence accordingly:

- **fullstack**: must prove all 3 layers — backend API/logic correctness, frontend UI change correctness, and FE↔BE integration correctness. FE proof requires interpreted before-action and after/final screenshots plus browser-observed network/API method + path + status.
- **fe-only**: must still use `agent-browser` for E2E browser validation, interpreted screenshot evidence at important checkpoints, and an explicit browser flow assertion; network/API cue may be `N/A` only when the UI behavior has no backend request.
- **be-only**: must prove API/logic correctness (and DB/query evidence when relevant); FE screenshot evidence can be explicitly marked `N/A`.

## Lightweight Mode

Default is the full pipeline. Lightweight Mode is opt-in only and must be recorded in the JSON state.

Allowed only when all are true:

- zero HIGH risks and at most one MEDIUM risk in `approach.md`
- one story only
- no cross-team/API contract change
- no new external dependency

Lightweight still requires Phase 0, compact discovery, full-feature bead coverage for all declared phases, and Phase 6 validation. It may inline Phase 3/4 details after explicit user opt-in. (Phase 2.5 is auto-approved in every mode.)

## Pipeline

| Phase | Goal | Required Output | Hook / Gate |
|---|---|---|---|
| 0 | Fast bounded pre-flight: resolve target, run existing resolver/index entrypoints, verify required tools/dependencies, collect index result | target-repo `.planning/history/<feature>/` + JSON state evidence | safe target resolved first; `resolve_index_root.mjs` + `bash index.sh --target <repo>` are the canonical entrypoints (always via `bash`; the script carries no executable bit); `index.sh` verifies/runs Serena + GitNexus indexing; `.mcp.json`/Serena and `br`/`bv`/`jq` health checks pass; no broad requirement/code/docs read; mandatory wait/collect exits 0 before completion |
| 1 | Discover feature context | 4 lane-owned files + `discovery.md` | immediately spawn the missing/failed/orphaned External lane after Phase 0 (one Agent call in its own message, canonical versioned prompt block); the main agent runs Architecture, Patterns, and Constraints itself with GitNexus/Serena and writes their canonical files directly; never pre-mark `running`; main reads/verifies files, fills only specific gaps, then compiles `discovery.md` |
| 1.5 | Clarify business scope | `requirements.md` | `AskUserQuestion` only; exactly 12 PO-style questions in 3 rounds of 4, each with >=2 options; `questions_asked` must reach 12 before Phase 1.6 |
| 1.6 | Clarify test scope | `test-scenarios.md` | `AskUserQuestion` only; exactly 8 test-focused questions in 2 rounds of 4, each with >=2 options; `questions_asked` must reach 8 before Phase 2 |
| 2 | Synthesize approach | `approach.md` | Gap Analysis, Recommended Approach, Alternatives, Risk Map; continue directly to Phase 2.5 without extra confirmation pause |
| 2.5 | Record whole-feature plan | `phase-plan.md` | auto-approved: writing `phase-plan.md` completes 2.5; set `phase_plan_approved=true` and continue directly to Phase 3 with no pause and no AskUserQuestion |
| 3 | Define phase contracts | `contracts/phase-<n>-contract.md` (for each phase declared in `phase-plan.md`) with both business contract + technical contract details (API/DB/config/error/testability) | after auto-approved 2.5, continue directly to 4 without extra confirmation pause |
| 4 | Map phase stories + approve decomposition readiness | `story-maps/phase-<n>-story-map.md` (for each phase declared in `phase-plan.md`), each including a complete machine-readable Bead Specs block | in full mode, ask exact `AskUserQuestion` approval once for the whole story-map set after all declared phases have both contract and story-map artifacts; after `Approve`, continue immediately in one run through Phase 5 → 6 |
| 5 | Materialize full-feature beads | `node .claude/hooks/planning/materialize_beads.mjs --feature <feature>` → real beads + dep edges + `<bead:KEY>` tokens replaced with canonical IDs + `beads-manifest.json` | requires whole-set Phase 4 approval true + full feature-plan contract/story-map coverage; every Bead Specs description must carry evidence clauses matching its actual surface (BE/API/DB, FE/UI, or integration), migration/provisioning decision rules, completion close-gate evidence requirements, and test-session budget/split policy (the script validates and refuses otherwise); no hand-run `br create` loops; no extra confirmation pause before Phase 6 |
| 6 | Validate graph; terminate planning | `bv` graph check + manifest/coverage verification + terminal JSON state | cycles must be `[]`; story-maps must contain real canonical IDs (no `<bead:...>` tokens or placeholders left); record `cycles_found=0`, set `planning_active=false` and STOP |
| Manual Handoff | Start execution coordination | optional `skill("orchestrator")` or execution workflow | only after explicit user request after Phase 6 completion; not part of the planning pipeline |

## Phase Notes

### Phase 0 — Pre-flight

Use `references/pre-flight.md`. **Ordering is mandatory and bounded:** on `/planning`, derive target intent from the current prompt/path, call the existing `resolve_index_root.mjs` resolver, and start the canonical `bash .claude/hooks/planning/index.sh --target <resolved-root> --background` entrypoint before broad context work. `UserPromptSubmit` may already have started that job; reuse its job id instead of launching a duplicate. While indexing runs, perform only Phase 0 health checks and evidence work: required MCP config/runtime readiness, required CLI checks, target-scoped workspace creation, and minimal authoritative-state bookkeeping. Do **not** read broad requirement/code/project docs in Phase 0. Before Phase 0 completes, run `bash index.sh --wait --job <id>` and collect terminal evidence. Any non-zero exit is fail-closed: stop planning immediately, report the indexing error, keep Phase 0 incomplete, and do not continue to discovery. After success, transition immediately to Phase 1: spawn the External discovery lane, then run the three main-agent lanes (Architecture, Patterns, Constraints) with GitNexus/Serena, before any other broad main-agent exploration.

As part of the same Phase 0 pre-flight, create/ensure the canonical feature workspace `.planning/history/<feature>/` under the selected target repo and record the repo-relative path as `phase_outputs.0.feature_path`; feature-workspace setup is part of Phase 0 rather than a separate milestone. Define `HISTORY_ROOT = TARGET_INDEX_ROOT` when a target repo is selected, otherwise fall back to the normal project/control root for backward-compatible no-target cases. `HISTORY_ROOT/.planning/` owns both the feature history (`.planning/history/<feature>/`) and the single authoritative `.planning/state/planning-state-v2.json`. Keep `CONTROL_ROOT` separate: it continues to own `.claude/hooks`, `.claude/skills/planning`, `.mcp.json`, and the `.planning/state/active-target-root` pointer (written automatically by the resolver/`index.sh` on successful target resolution); it does **not** own active feature history or state when planning targets a nested repo. Every relative `.planning/...` artifact path in state must be resolved against `HISTORY_ROOT`. When `TARGET_INDEX_ROOT != CONTROL_ROOT`, use absolute target-repo paths for Write/Edit operations so file tools cannot accidentally create `/CONTROL_ROOT/.planning/history/...`; the guard blocks such mis-scoped relative writes. Do not ask for reindex confirmation. Never use `CLAUDE_PROJECT_DIR` as an implicit indexing target, never fall back to a broad parent/control root, and stop Phase 0 before launch when source/root signals are missing, ambiguous, or conflicting. Background launch is not success evidence. `index.sh` stores background lifecycle metadata only in `phase_outputs.0.project_index_jobs.<job-id>` inside `.planning/state/planning-state-v2.json`; it must not create `.planning/index-jobs/<job-id>/` metadata files or a worktree `index.log`. For background mode keep `project_index_execution_mode=background` and `project_index_job_id`; `project_index_waited=true` is valid only after the mandatory wait exits 0 and the same JSON job record has terminal `status="succeeded"`, matching `target_root`, `exit_code=0`, and `collected_at`. Preserve `project_index_jobs` when recording final Phase 0 evidence. The validator rejects a running, failed, wrong-target, missing-state-record, or uncollected job.

### Phase 1 — Discovery

Use `references/launch-discovery-agents.md`. The 4 lanes are orthogonal dimensions, not backend/frontend splits. **Immediately after Phase 0 succeeds**, spawn the missing External lane first (one Agent call in its own message), then run the other three lanes in the main agent itself:

1. Architecture discovery — **main-agent-owned**: GitNexus-direct (`list_repos`, `query`, `context`, `impact`, `route_map`, `cypher`), written straight to `1-architecture.md`.
2. Pattern discovery — **main-agent-owned**: GitNexus/Serena-direct (verbatim signatures/literals to mirror), written straight to `2-patterns.md`.
3. Constraint discovery — **main-agent-owned**: GitNexus/Serena + targeted config/manifest reads, written straight to `3-constraints.md`.
4. External discovery — subagent (Exa/web research), launched FIRST because it is the slowest lane.

Main-agent lanes share one discovery pass (do not re-discover the same symbols per lane), have no fixed call budget, and follow the evidence-dense content bar and target lengths in `references/launch-discovery-agents.md`; the guard denies any Agent spawn for them. The External launch uses `subagent_type="general-purpose"`, `run_in_background=true`, and the exact machine-checkable `[PLANNING_DISCOVERY_AGENT_CONTRACT_V1]` key/value block from `references/launch-discovery-agents.md`. Substitute only the actual canonical artifact values; do not paraphrase the contract. Each lane (main-agent or subagent) applies the cross-surface rule internally and writes evidence-dense, decision-complete Markdown directly to its canonical file under `HISTORY_ROOT/.planning/history/<feature>/discovery-lanes/`. A lane agent may write only its own lane file; it must not modify `.planning/state/`, JSON state, `discovery.md`, or another lane. The canonical file is the handoff, so the main agent does not need to retrieve/copy a background response body.

**Launch-state lifecycle is strict (External subagent lane):** do not set `phase_outputs.1.lanes.<lane>.status="running"` before the Agent call is accepted. Record `running` only with a verified launch identity: non-empty `agent_id`, non-empty `launch_id`, or `attempt_id` plus `launch_confirmed_at`. A `running` ledger entry without such identity is classified as `orphaned` and is retryable on refresh; it must not cause an `already running` deadlock. `missing`, `failed`, and `orphaned` lanes are retryable. A canonical artifact on disk is stronger completion evidence than the ledger. The main-agent lanes (Architecture, Patterns, Constraints) skip this lifecycle: they go straight from `missing` to `completed` with `owner="main-agent"` once the main agent writes each canonical file.

This direct-write ownership fixes the old response-only failure mode: background agents were forbidden to write files, the main agent had to retrieve/copy response text, and idle-only completion notifications could leave no response body to persist. That encouraged response-retrieval detours and then main-agent summaries or duplicated discovery. `general-purpose` is mandatory because it can edit/write the lane file directly. The versioned contract additionally fixes the observed PreToolUse failure mode where semantically correct paraphrases missed fragile regex phrases and were denied before spawn.

Once all four canonical lane files exist, the main agent reads them as sufficient Phase 1 context by default, verifies detail/evidence, self-fills only a **specific remaining gap** when necessary, and compiles repo-relative `.planning/history/<feature>/discovery.md` using `references/discovery-cache.md`. It must not replace the lane files with summaries or redo broad discovery.

### Phase 1.5 — Business Clarification

Ask the user as a Product Owner — distilled, not scattered. Keep the normal contract of **12 questions** in **3 rounds of 4** via `AskUserQuestion`:

- 1 round = 1 `AskUserQuestion` call with `questions.length === 4`.
- Every question carries `header`, `question`, and **>=2 concrete `options`** so the user picks instead of free-typing.
- **Ask in Vietnamese**: write `question`, option labels, and option descriptions in Vietnamese (keep established technical terms in English). Put your recommended option FIRST with the label suffix ` (Khuyến nghị)` and a description explaining in one sentence why it fits this feature, so the user can accept quickly or diverge deliberately.
- Every question targets one load-bearing business decision: scope cut, priority trade-off, success criterion, edge-case rule, ownership/SLA, or rollout/permission. Skip filler ("any preferences?", "anything else?").
- Round 2 and Round 3 must use prior answers and avoid duplicate intent unless there is a clear `followup_reason`.
- Before each next round, run a lightweight ambiguity/anomaly scan using: Phase 1 discovery artifacts, answers from prior Phase 1.5 rounds, and current requirement direction.
- Treat anomaly as business-relevant uncertainty such as: similar flow exists but appears unused, legacy fallback ownership/status unclear, conflicting sources of truth, orphan path with unclear future, or old implementation partially overlaps requested scope.
- If unresolved anomaly exists, the next round must include at least one direct PO resolution question (`keep` / `remove` / `deprecate` / `migrate` / `ignore intentionally`).
- After each round, increment `phase_outputs."1.5".questions_asked` by 4 in `.planning/state/planning-state-v2.json`.
- Synthesize `requirements.md` only after normal 12 questions are complete (hook-enforced: the guard denies writing `requirements.md` while `questions_asked < 12`).
- Optional Round 4 is allowed only if unresolved anomaly remains after 12 questions; Optional Round 4 must be anomaly-resolution only (no broad new discovery questions).

### Phase 1.6 — Test Clarification

Use business context from 1.5 and ask **exactly 8 test-focused questions** in **2 rounds of 4** via `AskUserQuestion`:

- 1 round = 1 `AskUserQuestion` call with `questions.length === 4`.
- Every question carries `header`, `question`, and **>=2 concrete `options`**.
- **Ask in Vietnamese** with a recommended option, same convention as Phase 1.5: recommended option first, label suffix ` (Khuyến nghị)`, description says why (keep technical terms like fullstack/fe-only/be-only, screenshot, curl in English).
- Cover only high-signal testing decisions: test mode classification (fullstack / fe-only / be-only), golden path proof, critical failure-path proof, required evidence (screenshots/curl/query), FE screenshot checkpoints (before/after important actions + final state), environment + seed-data needs, rollout verification, and final sign-off owner.
- For FE-involving modes (fullstack, fe-only), options must explicitly list important screenshot timing candidates and ask the user to choose required checkpoints in Phase 1.6.
- For FE-involving modes, `test-scenarios.md` must reference `.claude/lessons/browser-runbook.md` as the single Browser Runbook source and describe any feature-specific browser flow as a runbook delta, not a new runbook file.
- After each round, increment `phase_outputs."1.6".questions_asked` by 4 in `.planning/state/planning-state-v2.json`.
- Write `test-scenarios.md` only after `questions_asked === 8` (hook-enforced: the guard denies writing it while Phase 1.5 is unfinished or `questions_asked < 8`).
- `test-scenarios.md` must include an evidence matrix per test case for FE (screenshots), BE (API/logic), and integration (FE↔BE) with `N/A` explicitly marked for non-applicable columns.
- Once 1.6 is complete, do not pause for confirmation: transition to Phase 2, write `approach.md`, transition to Phase 2.5, write `phase-plan.md`, set `phase_plan_approved=true` (auto-approved), and continue straight into Phase 3.

Phase 2+ synthesis artifacts are ordering-gated by the guard: `approach.md`, `phase-plan.md`, `contracts/phase-<n>-contract.md`, and `story-maps/phase-<n>-story-map.md` inside the feature workspace are denied until Phase 1.5 (12/12) and Phase 1.6 (8/8) are satisfied. Do not pre-draft later-phase artifacts while clarification is still open.

### Phase 2.5 — Auto-Approved Plan Record

Use `references/phase-plan-template.md`. Phase 2.5 has **no approval question**: writing `phase-plan.md` is the completion event. Atomically record `phase_plan_approved: true` and `phase_outputs."2.5" = { status: "completed", phase_plan_path, approved: true, approval: "auto" }`, then continue. The guard denies any AskUserQuestion in Phase 2.5 and validates exactly these auto-approval invariants on completion.

After that, do not pause for extra confirmation: continue directly through Phase 3 and Phase 4, produce contract artifacts under `.planning/history/<feature>/contracts/` and story-map artifacts under `.planning/history/<feature>/story-maps/` for every phase declared in `phase-plan.md`, then pause only at the Phase 4 whole-set approval AskUserQuestion.

### Phase 3 — Contract Detailing Gate

Phase 3 contract artifacts are not allowed to stay at business-contract level only. Every `contracts/phase-<n>-contract.md` must include:
- Business contract: what changes, why now, entry/exit truths.
- Technical contract: API endpoints + request/response shape, DB/config source-of-truth, validation/error behavior, and observable testability hooks.
- If the phase says values come from DB/settings, specify concrete key/table/field source and fallback behavior; do not leave it as ambiguous prose.
- Bootstrap / Provisioning Contract is mandatory when runtime behavior depends on DB settings key/table/value:
  - declare exact runtime-critical key/table/field;
  - declare either existing provisioning proof or an idempotent migration/provisioning artifact at the path required by the active repo/project instructions (use Alembic paths only when that repo actually uses Alembic);
  - missing-config fail-fast behavior (500/domain error) is corruption guard only, not a substitute for bootstrap/provisioning.

### Phase 4 — Story Map Approval Gate

After writing story-map artifacts for all declared phases, ask approval once for the whole story-map set with this exact machine-checkable shape:
- `header`: `Phase 4 Approval`
- `question`: `Approve the story maps (.planning/history/<feature>/story-maps/*.md)?`
- options in order: `Approve`, `Revise`

Only exact `Approve` of the whole set allows Phase 5 materialization in full mode. After this `Approve`, continue immediately in one run through Phase 5 and Phase 6, then stop planning only when Phase 6 records `cycles_found=0` and `planning_active=false` in the terminal state update.

Because Phase 5 is script-materialized, the Phase 4 approval is the real semantic gate of the pipeline: the Bead Specs blocks the user approves here are byte-for-byte what becomes executable beads. Story-maps without a complete Bead Specs block are not approvable.

### Phase 5 — Bead Materialization (script-run, not LLM-run)

Phase 5 is deterministic. All bead content was already authored and approved in Phase 4 inside each story-map's Bead Specs block (see `references/story-map-template.md` section 6). Phase 5 only materializes it:

```bash
node .claude/hooks/planning/materialize_beads.mjs --feature <feature> --dry-run   # validate + preview
node .claude/hooks/planning/materialize_beads.mjs --feature <feature>             # create for real
```

The script (never the LLM by hand):
1. parses the `bead-specs` JSON blocks from every declared `story-maps/phase-<n>-story-map.md`,
2. validates unique keys, dependency references, clause coverage (same rules as the hook), and topological consistency (a spec cycle aborts before anything is created),
3. runs `br create` in topological order from the correct `.beads` workspace root,
4. runs `br dep add <dependent> <dependency>` for every `depends_on` edge,
5. replaces every `<bead:KEY>` token in the story-maps with the exact canonical issue ID returned by `br`,
6. writes `.planning/history/<feature>/beads-manifest.json` — the idempotency ledger; re-running reuses already-created beads instead of duplicating them.

If the script exits non-zero, planning stops there: fix the reported Bead Specs issue (which may require a `Revise` round back through Phase 4 when the fix changes approved content), then re-run. Do not fall back to manual `br create` to route around a validation failure.

After a successful run, record in state: `phase_outputs.5.status="completed"`, `beads_created`, `story_map_paths` (all declared story-maps), and `phase_labels`. Then continue directly to Phase 6.

Canonical Beads ID rule:
- Story-maps reference beads as `<bead:KEY>` tokens before materialization; after materialization they contain only the exact canonical issue IDs returned by `br`. Never assume a fixed project prefix and never hand-write IDs.
- Treat short aliases such as `br-r35` as backwards-compatible input only; do not write alias IDs into new planning artifacts or state.
- When normalizing older artifacts, prefer alias → actual ID, not actual ID → alias.

Default fullstack surface split:
- **BE/API bead**: backend/API/DB/migration/restart work plus real `curl`/HTTP API proof; DB query proof only when relevant. FE/browser evidence must be `N/A` here.
- **FE/UI bead**: frontend/UI behavior plus `agent-browser` E2E proof, at least before-action and after/final screenshot paths, explicit screenshot interpretation (`what the agent saw and what it proves`), expected FE↔BE network/API cue with method + path + status or explicit `N/A`, and a network artifact/requests log path when integration is in scope. BE runtime/curl proof must be `N/A` here except for the API/network cue observed through the browser flow.
- A fullstack story should normally create both beads and chain the FE/UI bead after the BE/API bead when the UI depends on the backend contract. Do not combine BE runtime proof and FE browser proof in one bead just to reduce bead count.
- A combined BE+FE bead is allowed only with an explicit `Single-session exception:` reason and only when there is no migration, restart, auth/login setup, DB query proof, or browser-login complexity.

Dependency topology rule:
- Add `br dep add` links only for real prerequisites: API/DB contracts before dependent FE work, fixtures before evidence that consumes them, BE evidence before browser evidence that validates the same side effect, and all required evidence before sign-off.
- Do not serialize independent beads just because they are in the same phase. If two beads touch different file scopes or prove independent evidence surfaces, leave them parallel-ready.
- Prefer a fan-out/fan-in graph over a single chain: core BE contract can fan out to legacy cleanup, quota/runtime work, FE UI work, and fixture/evidence tracks; sign-off fans in only after the required BE and FE evidence beads finish.
- If dependency uncertainty remains, record the reason in the bead description or story-map notes instead of adding a conservative chain by default.

Mandatory decomposition verification clauses (every Bead Specs `description` must carry the clauses matching its surface — the materialize script validates them and refuses to create beads otherwise):
- Runtime conventions source (always required): follow `.claude/lessons/runtime-conventions.md` for restart/migration/token-flow verification conventions.
- Completion evidence gate (always required): do not run `br close` for implementation/test completion until the close reason records the concrete runtime evidence required by the bead; if evidence cannot be run in the current session, leave the bead open/in_progress or create a chained follow-up test bead.
- Migration/provisioning decision clause (always required for BE/runtime beads): before creating a new migration/provisioning artifact, inspect the existing repo-native migration/provisioning history for the same table/key/source-of-truth, classify the decision as `schema migration`, `data/seed migration`, `existing provisioning proof`, or `no migration required`, and do not create duplicate settings/seed migrations when existing provisioning proof already satisfies the contract.
- Technical contract clause (always required): explicit API contract, DB/config source-of-truth, validation/error behavior, and what must not be hardcoded.
- FE verification clause (required only for beads whose selected work includes FE/UI/browser or FE↔BE integration evidence): explicit E2E verification via `agent-browser` with action sequence, expected UI state, before-action screenshot path, after/final screenshot path, screenshot interpretation requirement (`read the screenshots and state what each proves`), expected browser network/API cue (method + path + status, or explicit `N/A` for UI-only), network evidence artifact/requests log path when integration is in scope, `Browser Runbook Reference: .claude/lessons/browser-runbook.md`, quality-gate classification, and runbook delta (`unchanged` or durable login/navigation/UI discovery appended) in the `br close --reason` evidence. Do not attach FE screenshot obligations to BE-only implementation beads; create/link a separate FE/integration evidence bead when the overall feature still needs UI proof.
- BE verification clause (required for beads whose selected work includes BE/API/DB/runtime behavior): explicit real API-call verification (e.g. `curl`/HTTP endpoint + auth/token source + expected status/response payload) and require the command/status/response cues in the `br close --reason` evidence.
- BE runtime checklist clause (required for beads whose selected work includes BE/API/DB/runtime behavior): include explicit verification sequence with concrete cues:
  - migration/provisioning expectation (`data migration required` / `seed required` / `bootstrap required` / explicit `existing provisioning proof`),
  - migration decision evidence before writing new migration files: existing revision inspected, decision classified, and duplicate settings/seed migrations avoided,
  - idempotent migration/provisioning artifact path required by the active repo/project instructions when data migration is required,
  - repository-appropriate migration apply command from active repo/project instructions or `.claude/lessons/runtime-conventions.md` when migration-relevant (Alembic only when actually used),
  - repository-appropriate restart/reload step when runtime reload is needed; use the service/process command declared by active repo/project instructions rather than a fixed service name,
  - auth/token acquisition flow (login/token source),
  - target API call + expected status/payload cues,
  - close evidence summary: actual API command/status/response, DB query proof when named, migration/provisioning proof when relevant, and FE screenshot path when required.
- Runtime-critical DB settings source-of-truth rule: if API behavior depends on DB settings key/table/value and expected runtime result is 200/payload, `no migration expected` is invalid unless explicit existing provisioning proof is included.
- For BE verification, DB query proof is optional (recommended for confidence, not mandatory for gate pass).
- If feature mode is unclear in state, infer evidence clauses from the bead's actual surface and mark non-applicable FE/BE evidence as `N/A`; ask/fix planning state if the surface cannot be determined. Do not default BE-only beads into FE screenshot obligations.
- Test session budget clause (always required): state `Test Session Budget: <=1 session` or `Test Session Budget: >1 session`.
- If `>1 session`, the Bead Specs block must contain a follow-up test bead chained behind the implementation bead via `depends_on`.

Hard gate before running the materialize script in full mode:
1. `phase_outputs.4_approval` must be fully closed (`status=completed`, `approved=true`, `approval_response=Approve`).
2. All phases declared in `.planning/history/<feature>/phase-plan.md` must already have both artifacts:
   - `.planning/history/<feature>/contracts/phase-<n>-contract.md`
   - `.planning/history/<feature>/story-maps/phase-<n>-story-map.md` (each with a complete Bead Specs block)
3. Every Bead Specs description must include the mandatory technical-contract clause plus evidence clauses matching that bead's actual surface. Phase 1.6 `feature_mode=fullstack` requires FE, BE, and integration coverage across the bead set, not FE screenshot obligations on every BE-only bead; by default, represent that coverage as a BE/API bead with curl/HTTP proof plus a separate FE/UI bead with agent-browser screenshot proof.
4. Every BE/runtime-scope description must include a migration/provisioning decision clause so the executor must inspect existing repo-native migration/provisioning history before creating new migration artifacts.
5. Every description must include the completion evidence gate and explain that `br close --reason` must carry the actual curl/API, DB/query, migration/provisioning, FE screenshot evidence, and browser-runbook delta required by the bead.
6. Every FE/UI or integration description must reference `.claude/lessons/browser-runbook.md` and require updating that same file when `agent-browser` discovers durable UI details such as login route, credential source key names, dashboard route, stable selectors, action sequence, expected network cue, or expected UI state. The bead must require before-action and after/final screenshots, screenshot interpretation, browser action summary, network artifact/requests log when integration is in scope, and quality-gate classification.
7. Every description must include the test-session budget clause; if budget is `>1 session`, the specs must already contain the chained follow-up test bead.
8. Phase 5 output must converge to full decomposition coverage: every declared `story-maps/phase-<n>-story-map.md` gets non-placeholder Story-To-Bead Mapping entries with real canonical Beads issue IDs (the script's token replacement does this; verify no `<bead:...>` token survived).

If any gate fails, do not run the script. Fix missing approvals/artifacts/verification/coverage first.

### Phase 6 — Graph Validation (deterministic, terminal)

Phase 6 is fully deterministic — no validation-mode classification, no semantic verdict, no validator skill. The semantic gate of the pipeline is the human Phase 4 approval of the Bead Specs; Phase 6 only proves the materialized graph is structurally sound.

Never run bare `bv`; use robot flags only. Run from the `.beads` workspace root (the materialize script output's `beads_root`):

```bash
bv --robot-triage 2>/dev/null | jq '.quick_ref'
bv --robot-insights 2>/dev/null | jq '.cycles // .Cycles // []'
```

Checklist (all must pass):

1. Cycles are `[]` (or `null`) in `bv --robot-insights` output.
2. `beads-manifest.json` exists in the feature workspace and every bead ID it records resolves via `br show`.
3. No `<bead:...>` token, `<actual-beads-id>` placeholder, or `br-*` alias remains in any declared story-map.
4. `phase_outputs.5.story_map_paths` covers every phase declared in `phase-plan.md`.

On success, atomically:

- set `phase_outputs.6.status = "completed"` with `cycles_found = 0` and `beads_manifest_path`
- keep `current_phase = "6"`
- add `"6"` to `completed_phases`
- set `planning_active = false`

Then stop. Do not create another planning phase or planning-order artifact. If any check fails, fix the cause (usually by re-running the materialize script or revising specs through Phase 4) before writing the terminal state.

## State and Artifacts

- Authoritative status/state: `HISTORY_ROOT/.planning/state/planning-state-v2.json` (inside the selected target repo; `CONTROL_ROOT/.planning/state/active-target-root` points hooks at it)
- State schema: `CONTROL_ROOT/.claude/hooks/planning/state.schema.json`
- Human planning artifacts remain under `.planning/history/<feature>/` **inside the selected target repo** (`phase_outputs.0.project_index_root`); only when no target repo is selected do they fall back to the normal project/control root. No Markdown status mirror is created, updated, validated, or consumed.

Write the JSON state on every transition. Hooks and resume/root-resolution logic must derive status and requirement-source provenance from that JSON state plus canonical planning artifacts only.

## References

| File | Purpose |
|---|---|
| `references/pre-flight.md` | Phase 0 checks and evidence fields |
| `references/discovery-cache.md` | Phase 0/1 feature-scoped discovery setup and synthesis sections |
| `references/launch-discovery-agents.md` | Phase 1 discovery coverage protocol |
| `references/phase-plan-template.md` | Whole-feature phase plan |
| `references/phase-contract-template.md` | Per-phase contract (repeat for every phase declared in `phase-plan.md`) |
| `references/story-map-template.md` | Per-phase story map (repeat for every phase declared in `phase-plan.md`) |
| `references/test-clarification.md` | Phase 1.6 test clarification |
| `.claude/hooks/planning/README.md` | Hook rule coverage |
| `.claude/lessons/browser-runbook.md` | Single living Browser Runbook for FE/UI and browser evidence beads |

## Delegated Skills

| Skill | When | Purpose |
|---|---|---|
| `orchestrator` | Manual handoff only after explicit user request following terminal Phase 6 completion | Multi-agent execution coordination |

## Recovery

If interrupted, resolve the state file through `CONTROL_ROOT/.planning/state/active-target-root` (pointer to the target repo; without it, read `CONTROL_ROOT/.planning/state/planning-state-v2.json`), derive `HISTORY_ROOT` from `phase_outputs.0.project_index_root` (fallback: normal project root only when no target is selected), reread the requirement source plus existing `HISTORY_ROOT/.planning/history/<feature>/` artifacts, resume from the first incomplete phase, and print the PIPELINE STATUS header with the resume point.

Continuous in-session planning is not a resume. Do not restart discovery or force requirement-source path mentions into normal Phase 1.5/1.6 questions just to satisfy hooks; reread reminders are prime-only unless state explicitly sets `resume_context.required=true`.
