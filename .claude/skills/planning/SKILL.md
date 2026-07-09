---
name: planning
description: >
  Mandatory strict feature-planning pipeline. Use when the user asks to plan,
  design, roadmap, or decompose a software feature. Runs canonical phases
  0, 1, 1.5, 1.6, 2, 2.5, 3, 4, 5, and 7 with
  feature-scoped discovery, whole-feature phase-plan approval, all-phase
  contract/story-map sets, beads, and terminal graph/semantic validation. Every planning
  response must start with the PIPELINE STATUS header.
---

# Feature Planning Pipeline

This skill is the operating manual. Mechanical gates are enforced by `.claude/hooks/planning_guard.mjs`; detailed formats live in `references/*`.

## Non-Negotiables

1. On every explicit `/planning` invocation, keep Phase 0 fast and bounded: resolve the target from the current prompt/path without reading the requirement body, reuse any early `UserPromptSubmit` job if present, otherwise start `bash .claude/hooks/planning/index.sh --target <resolved-root> --background`, run only the required tool/dependency health checks and target-scoped workspace/state evidence work, then `--wait --job <id>`. Do not broad-read requirement/code/project docs in Phase 0. Any non-zero exit stops planning immediately and must be reported.
2. Never skip a phase in the active mode.
3. Begin every planning response with the PIPELINE STATUS header.
4. Phase 1 obtains coverage for exactly 4 canonical discovery lanes: Architecture, Patterns, Constraints, and External.
5. Immediately after successful Phase 0, launch the three missing/retryable subagent discovery lanes (Patterns, Constraints, External) with background `Agent` calls using `subagent_type="general-purpose"` and the exact versioned `[PLANNING_DISCOVERY_AGENT_CONTRACT_V1]` block from `references/launch-discovery-agents.md`; do not rely on fragile paraphrase. The Architecture lane is main-agent-owned: while the subagent lanes run, the main agent produces `1-architecture.md` directly with GitNexus tools (`query`/`context`/`impact`/`route_map`/`cypher`) at the same full-detail content bar — never spawn an Architecture subagent. Each subagent lane writes its own full detailed, non-summary canonical Markdown file directly under `HISTORY_ROOT/history/<feature>/discovery-lanes/`. The main agent verifies/reads all four files, compiles `discovery.md`, and manages planning state; it must not copy response bodies into lane files or replace lane files with summaries.
6. Every phase transition updates `.planning/state/planning-state-v2.json`, the single authoritative planning status/state file.
7. Phase 2.5 approval is required before Phase 3+ unless Lightweight Mode was explicitly requested and recorded.
8. If a planning hook blocks, obey the hook message before continuing.
9. After Phase 1.5 reaches 12/12 questions, continue into Phase 1.6 and collect 8/8 test-clarification questions (2 rounds of 4) before advancing to Phase 2.
10. After Phase 1.6 reaches 8/8 and `test-scenarios.md` is written, continue in one run through Phase 2 up to the Phase 2.5 approval AskUserQuestion without extra “ok to continue?” pauses.
11. If Phase 2.5 is approved, continue in one run through Phase 3 and Phase 4, then pause only at the Phase 4 approval AskUserQuestion.
12. If Phase 4 approval is `Approve`, continue in one run through Phase 5 and Phase 7 with no extra confirmation pauses in between; in Phase 7, classify validation mode (`mechanical_lite` / `targeted` / `full`) before choosing the gate.
13. Phase 7 is the mandatory pipeline stop: on `READY`, `READY_LITE`, or `READY_TARGETED`, atomically mark Phase 7 completed, keep `current_phase="7"`, add `"7"` to `completed_phases`, set `planning_active=false`, and stop with the validated bead graph/state. Do not invoke `orchestrator`, spawn implementation agents, reserve execution files, or start beads unless the user explicitly asks to start execution after planning completes.
14. Phase 5 beads must be close-gated: every implementation/test bead that requires runtime proof must say not to run `br close` until the concrete evidence is captured, interpreted, and recorded in the close reason or named evidence artifacts.
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

For a Phase 1 launch turn, this header is the only text before the missing subagent-lane `Agent` calls (the main-agent Architecture lane work follows in the same turn).

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

Lightweight still requires Phase 0, compact discovery, full-feature bead coverage for all declared phases, and Phase 7 validation. It may inline Phase 3/4 details and skip Phase 2.5 approval only after explicit user opt-in.

## Pipeline

| Phase | Goal | Required Output | Hook / Gate |
|---|---|---|---|
| 0 | Fast bounded pre-flight: resolve target, run existing resolver/index entrypoints, verify required tools/dependencies, collect index result | target-repo `history/<feature>/` + JSON state evidence | safe target resolved first; `resolve_index_root.mjs` + `bash index.sh --target <repo>` are the canonical entrypoints (always via `bash`; the script carries no executable bit); `index.sh` verifies/runs Serena + GitNexus indexing; `.mcp.json`/Serena and `br`/`bv`/`jq` health checks pass; no broad requirement/code/docs read; mandatory wait/collect exits 0 before completion |
| 1 | Discover feature context | 4 lane-owned files + `discovery.md` | immediately spawn the missing/failed/orphaned subagent lanes (Patterns, Constraints, External) after Phase 0 using the canonical versioned prompt block; the main agent runs the Architecture lane itself with GitNexus and writes `1-architecture.md` directly; never pre-mark `running`; main reads/verifies files, fills only specific gaps, then compiles `discovery.md` |
| 1.5 | Clarify business scope | `requirements.md` | `AskUserQuestion` only; exactly 12 PO-style questions in 3 rounds of 4, each with >=2 options; `questions_asked` must reach 12 before Phase 1.6 |
| 1.6 | Clarify test scope | `test-scenarios.md` | `AskUserQuestion` only; exactly 8 test-focused questions in 2 rounds of 4, each with >=2 options; `questions_asked` must reach 8 before Phase 2 |
| 2 | Synthesize approach | `approach.md` | Gap Analysis, Recommended Approach, Alternatives, Risk Map; continue directly to Phase 2.5 without extra confirmation pause |
| 2.5 | Approve whole-feature plan | `phase-plan.md` | exact `AskUserQuestion` approval: Approve / Revise (first intentional pause after Phase 1.6) |
| 3 | Define phase contracts | `contracts/phase-<n>-contract.md` (for each phase declared in `phase-plan.md`) with both business contract + technical contract details (API/DB/config/error/testability) | after 2.5 Approve, continue directly to 4 without extra confirmation pause |
| 4 | Map phase stories + approve decomposition readiness | `story-maps/phase-<n>-story-map.md` (for each phase declared in `phase-plan.md`) | in full mode, ask exact `AskUserQuestion` approval once for the whole story-map set after all declared phases have both contract and story-map artifacts; after `Approve`, continue immediately in one run through Phase 5 → 7 |
| 5 | Create full-feature beads | real `br create` tasks | requires whole-set Phase 4 approval true + full feature-plan contract/story-map coverage + full story-map-to-bead coverage for all declared phases; each bead must carry evidence clauses matching its actual surface (BE/API/DB, FE/UI, or integration), migration/provisioning decision rules, completion close-gate evidence requirements, and test-session budget/split policy; no pseudo Markdown beads; no extra confirmation pause before Phase 7 |
| 7 | Validate graph and semantics; terminate planning | graph check + mode-based semantic verdict + terminal JSON state | cycles must be `[]`; classify `mechanical_lite` / `targeted` / `full`; only `READY`, `READY_LITE`, or `READY_TARGETED` complete planning; set `planning_active=false` and STOP |
| Manual Handoff | Start execution coordination | optional `skill("orchestrator")` or execution workflow | only after explicit user request after Phase 7 completion; not part of the planning pipeline |

## Phase Notes

### Phase 0 — Pre-flight

Use `references/pre-flight.md`. **Ordering is mandatory and bounded:** on `/planning`, derive target intent from the current prompt/path, call the existing `resolve_index_root.mjs` resolver, and start the canonical `bash .claude/hooks/planning/index.sh --target <resolved-root> --background` entrypoint before broad context work. `UserPromptSubmit` may already have started that job; reuse its job id instead of launching a duplicate. While indexing runs, perform only Phase 0 health checks and evidence work: required MCP config/runtime readiness, required CLI checks, target-scoped workspace creation, and minimal authoritative-state bookkeeping. Do **not** read broad requirement/code/project docs in Phase 0. Before Phase 0 completes, run `bash index.sh --wait --job <id>` and collect terminal evidence. Any non-zero exit is fail-closed: stop planning immediately, report the indexing error, keep Phase 0 incomplete, and do not continue to discovery. After success, transition immediately to Phase 1: spawn the three subagent discovery lanes, then run the main-agent Architecture lane with GitNexus, before any other broad main-agent exploration.

As part of the same Phase 0 pre-flight, create/ensure the canonical feature workspace `history/<feature>/` under the selected target repo and record the repo-relative path as `phase_outputs.0.feature_path`; feature-workspace setup is part of Phase 0 rather than a separate milestone. Define `HISTORY_ROOT = TARGET_INDEX_ROOT` when a target repo is selected, otherwise fall back to the normal project/control root for backward-compatible no-target cases. Keep `CONTROL_ROOT` separate: it continues to own `.claude/hooks`, `.claude/skills/planning`, the single authoritative `.planning/state/planning-state-v2.json`, and `.mcp.json`; it does **not** own active feature history when planning targets a nested repo. Every relative `history/...` artifact path in state must be resolved against `HISTORY_ROOT`. When `TARGET_INDEX_ROOT != CONTROL_ROOT`, use absolute target-repo paths for Write/Edit operations so file tools cannot accidentally create `/CONTROL_ROOT/history/...`; the guard blocks such mis-scoped relative writes. Do not ask for reindex confirmation. Never use `CLAUDE_PROJECT_DIR` as an implicit indexing target, never fall back to a broad parent/control root, and stop Phase 0 before launch when source/root signals are missing, ambiguous, or conflicting. Background launch is not success evidence. `index.sh` stores background lifecycle metadata only in `phase_outputs.0.project_index_jobs.<job-id>` inside `.planning/state/planning-state-v2.json`; it must not create `.planning/index-jobs/<job-id>/` metadata files or a worktree `index.log`. For background mode keep `project_index_execution_mode=background` and `project_index_job_id`; `project_index_waited=true` is valid only after the mandatory wait exits 0 and the same JSON job record has terminal `status="succeeded"`, matching `target_root`, `exit_code=0`, and `collected_at`. Preserve `project_index_jobs` when recording final Phase 0 evidence. The validator rejects a running, failed, wrong-target, missing-state-record, or uncollected job.

### Phase 1 — Discovery

Use `references/launch-discovery-agents.md`. The 4 lanes are orthogonal dimensions, not backend/frontend splits. **Immediately after Phase 0 succeeds**, spawn the three missing subagent lanes in parallel, then run the Architecture lane in the main agent itself:

1. Architecture discovery — **main-agent-owned**: produced directly with GitNexus tools (`list_repos`, `query`, `context`, `impact`, `route_map`, `cypher`), written straight to `1-architecture.md`. No fixed call budget — use as many GitNexus calls as the feature needs. Never spawn a subagent for this lane; the guard denies it.
2. Pattern discovery — subagent
3. Constraint discovery — subagent
4. External discovery — subagent

The three subagent launches use `subagent_type="general-purpose"`, `run_in_background=true`, and the exact machine-checkable `[PLANNING_DISCOVERY_AGENT_CONTRACT_V1]` key/value block from `references/launch-discovery-agents.md`. Substitute only the actual lane and canonical artifact values; do not paraphrase the contract. Each lane (including the main-agent Architecture lane) applies the cross-surface rule internally and writes its own full detailed, non-summary Markdown directly to its canonical file under `HISTORY_ROOT/history/<feature>/discovery-lanes/`. A lane agent may write only its own lane file; it must not modify `.planning`, JSON state, `discovery.md`, or another lane. The canonical file is the handoff, so the main agent does not need to retrieve/copy a background response body.

**Launch-state lifecycle is strict (subagent lanes):** do not set `phase_outputs.1.lanes.<lane>.status="running"` before the Agent call is accepted. Record `running` only with a verified launch identity: non-empty `agent_id`, non-empty `launch_id`, or `attempt_id` plus `launch_confirmed_at`. A `running` ledger entry without such identity is classified as `orphaned` and is retryable on refresh; it must not cause an `already running` deadlock. `missing`, `failed`, and `orphaned` lanes are retryable. A canonical artifact on disk is stronger completion evidence than the ledger. The Architecture lane skips this lifecycle: it goes straight from `missing` to `completed` with `owner="main-agent"` once the main agent writes the canonical file.

This direct-write ownership fixes the old response-only failure mode: background agents were forbidden to write files, the main agent had to retrieve/copy response text, and idle-only completion notifications could leave no response body to persist. That encouraged response-retrieval detours and then main-agent summaries or duplicated discovery. `general-purpose` is mandatory because it can edit/write the lane file directly. The versioned contract additionally fixes the observed PreToolUse failure mode where semantically correct paraphrases missed fragile regex phrases and were denied before spawn.

Once all four canonical lane files exist, the main agent reads them as sufficient Phase 1 context by default, verifies detail/evidence, self-fills only a **specific remaining gap** when necessary, and compiles repo-relative `history/<feature>/discovery.md` using `references/discovery-cache.md`. It must not replace the lane files with summaries or redo broad discovery.

### Phase 1.5 — Business Clarification

Ask the user as a Product Owner — distilled, not scattered. Keep the normal contract of **12 questions** in **3 rounds of 4** via `AskUserQuestion`:

- 1 round = 1 `AskUserQuestion` call with `questions.length === 4`.
- Every question carries `header`, `question`, and **>=2 concrete `options`** so the user picks instead of free-typing.
- Every question targets one load-bearing business decision: scope cut, priority trade-off, success criterion, edge-case rule, ownership/SLA, or rollout/permission. Skip filler ("any preferences?", "anything else?").
- Round 2 and Round 3 must use prior answers and avoid duplicate intent unless there is a clear `followup_reason`.
- Before each next round, run a lightweight ambiguity/anomaly scan using: Phase 1 discovery artifacts, answers from prior Phase 1.5 rounds, and current requirement direction.
- Treat anomaly as business-relevant uncertainty such as: similar flow exists but appears unused, legacy fallback ownership/status unclear, conflicting sources of truth, orphan path with unclear future, or old implementation partially overlaps requested scope.
- If unresolved anomaly exists, the next round must include at least one direct PO resolution question (`keep` / `remove` / `deprecate` / `migrate` / `ignore intentionally`).
- After each round, increment `phase_outputs."1.5".questions_asked` by 4 in `.planning/state/planning-state-v2.json`.
- Synthesize `requirements.md` only after normal 12 questions are complete.
- Optional Round 4 is allowed only if unresolved anomaly remains after 12 questions; Optional Round 4 must be anomaly-resolution only (no broad new discovery questions).

### Phase 1.6 — Test Clarification

Use business context from 1.5 and ask **exactly 8 test-focused questions** in **2 rounds of 4** via `AskUserQuestion`:

- 1 round = 1 `AskUserQuestion` call with `questions.length === 4`.
- Every question carries `header`, `question`, and **>=2 concrete `options`**.
- Cover only high-signal testing decisions: test mode classification (fullstack / fe-only / be-only), golden path proof, critical failure-path proof, required evidence (screenshots/curl/query), FE screenshot checkpoints (before/after important actions + final state), environment + seed-data needs, rollout verification, and final sign-off owner.
- For FE-involving modes (fullstack, fe-only), options must explicitly list important screenshot timing candidates and ask the user to choose required checkpoints in Phase 1.6.
- For FE-involving modes, `test-scenarios.md` must reference `.claude/lessons/browser-runbook.md` as the single Browser Runbook source and describe any feature-specific browser flow as a runbook delta, not a new runbook file.
- After each round, increment `phase_outputs."1.6".questions_asked` by 4 in `.planning/state/planning-state-v2.json`.
- Write `test-scenarios.md` only after `questions_asked === 8`.
- `test-scenarios.md` must include an evidence matrix per test case for FE (screenshots), BE (API/logic), and integration (FE↔BE) with `N/A` explicitly marked for non-applicable columns.
- Once 1.6 is complete, do not pause for confirmation: transition to Phase 2, write `approach.md`, transition to Phase 2.5, write `phase-plan.md`, then stop only at the Phase 2.5 approval `AskUserQuestion`.

### Phase 2.5 — Approval Gate

Use `references/phase-plan-template.md`. Ask approval with the exact machine-checkable `AskUserQuestion` shape documented there / enforced by hook. Only an exact `Approve` response sets `phase_plan_approved: true`.

After 2.5 is approved, do not pause for extra confirmation: continue directly through Phase 3 and Phase 4, produce contract artifacts under `history/<feature>/contracts/` and story-map artifacts under `history/<feature>/story-maps/` for every phase declared in `phase-plan.md`, then pause only at the Phase 4 whole-set approval AskUserQuestion.

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
- `question`: `Approve the story maps (history/<feature>/story-maps/*.md)?`
- options in order: `Approve`, `Revise`

Only exact `Approve` of the whole set allows Phase 5 decomposition in full mode. After this `Approve`, continue immediately in one run through Phase 5 and Phase 7, then stop planning only when Phase 7 records `READY`, `READY_LITE`, or `READY_TARGETED` in the terminal state update.

### Phase 5 — Beads

Create real beads with `br create`. Every bead must include enough phase/story context for a fresh worker and Phase 5 must produce a complete bead set for all phases declared in `phase-plan.md` (not only a single current phase).

Canonical Beads ID rule:
- Persist the exact canonical issue IDs returned by `br create` / `br list --json` in story maps, planning state, execution plans, and handoffs. Never assume a fixed project prefix.
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

Mandatory decomposition verification clauses (bead description template):
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
- If `>1 session`, decomposition must create a follow-up test bead chained behind the implementation bead (using `br dep add`).

Hard gate before any bead creation in full mode:
1. `phase_outputs.4_approval` must be fully closed (`status=completed`, `approved=true`, `approval_response=Approve`).
2. All phases declared in `history/<feature>/phase-plan.md` must already have both artifacts:
   - `history/<feature>/contracts/phase-<n>-contract.md`
   - `history/<feature>/story-maps/phase-<n>-story-map.md`
3. Every `br create` command used in decomposition must include the mandatory technical-contract clause plus evidence clauses matching that bead's actual surface. Phase 1.6 `feature_mode=fullstack` requires FE, BE, and integration coverage across the bead set, not FE screenshot obligations on every BE-only bead; by default, represent that coverage as a BE/API bead with curl/HTTP proof plus a separate FE/UI bead with agent-browser screenshot proof.
4. Every `br create` command for BE/runtime scope must include a migration/provisioning decision clause so the executor must inspect existing repo-native migration/provisioning history before creating new migration artifacts.
5. Every `br create` command must include the completion evidence gate and explain that `br close --reason` must carry the actual curl/API, DB/query, migration/provisioning, FE screenshot evidence, and browser-runbook delta required by the bead.
6. Every FE/UI or integration `br create` command must reference `.claude/lessons/browser-runbook.md` and require updating that same file when `agent-browser` discovers durable UI details such as login route, credential source key names, dashboard route, stable selectors, action sequence, expected network cue, or expected UI state. The bead must require before-action and after/final screenshots, screenshot interpretation, browser action summary, network artifact/requests log when integration is in scope, and quality-gate classification.
7. Every `br create` command must include the test-session budget clause; if budget is `>1 session`, create and chain a follow-up test bead immediately.
8. Phase 5 output must converge to full decomposition coverage: every declared `story-maps/phase-<n>-story-map.md` gets non-placeholder Story-To-Bead Mapping entries with real canonical Beads issue IDs returned by the CLI.

If any gate fails, do not create or finalize beads. Fix missing approvals/artifacts/verification/coverage first.

After gates pass, add dependencies with `br dep add` and update Story-To-Bead Mapping in every declared `story-maps/phase-<n>-story-map.md` file.

### Phase 7 — Validation

Never run bare `bv`; use robot flags only.

```bash
bv --robot-triage 2>/dev/null | jq '.quick_ref'
bv --robot-insights 2>/dev/null | jq '.cycles // .Cycles // []'
```

Cycles must be `[]` before semantic validation. Then classify validation mode from actual scope of change:

- `mechanical_lite`: only mechanical sync changed (ID alias normalization such as `br-*` -> the canonical actual ID returned by `br`, state/story-map mapping sync, timestamp/status sync, typo/formatting, wording clarification with no contract/story/dependency-order/verification-obligation change).
- `targeted`: only affected/failed local dimensions changed (for example D3/D5/D8), including dependency additions that do not alter approved phase/story order.
- `full`: contract/API/DB/config behavior changed (including runtime-critical DB settings bootstrap/provisioning semantics), architecture or phase boundary changed, HIGH risk exists, dependency changes contradict approved phase/story order, targeted returns `ESCALATE_FULL`, or user explicitly requests full validation.

Mode rules:

1. `mechanical_lite`
   - Run cheap structural checks only (graph health + story-map mapping integrity + stale-ID scan).
   - Verify story-map bead IDs exist and no legacy IDs/placeholders remain.
   - Write Phase 7 output atomically: `status=completed`, `validation_mode=mechanical_lite`, `cycles_found=0`, `semantic_verdict=READY_LITE`, `validator_invocation_id=null`, add `"7"` to `completed_phases`.
   - Do not invoke `planning-validator`.

2. `targeted`
   - Recheck only affected/failed dimensions and affected artifacts/beads.
   - Do not run fresh-eyes subagent by default.
   - Write `semantic_verdict = "READY_TARGETED"` when targeted checks pass; otherwise `NEEDS-REVISION`.
   - If targeted evidence is ambiguous or reveals semantic risk, set `ESCALATE_FULL` and switch to `full`.
   - Do not invoke `planning-validator` unless escalation to `full` is required.

3. `full`
   - Invoke `skill("planning-validator")`.
   - Persist Phase 7 output atomically with `validation_mode=full`, `semantic_verdict`, `validator_invocation_id`, and reasons from validator output.

Only `READY`, `READY_LITE`, or `READY_TARGETED` complete the mandatory planning pipeline. On one of those verdicts, atomically:

- set `phase_outputs.7.status = "completed"`
- keep `current_phase = "7"`
- add `"7"` to `completed_phases`
- set `planning_active = false`
- preserve `validation_mode`, `cycles_found = 0`, `semantic_verdict`, and the validator ID policy

Then stop. Do not create another planning phase or planning-order artifact.

## State and Artifacts

- Authoritative status/state: `.planning/state/planning-state-v2.json`
- State schema: `.claude/hooks/planning/state.schema.json`
- Human planning artifacts remain under `history/<feature>/` **inside the selected target repo** (`phase_outputs.0.project_index_root`); only when no target repo is selected do they fall back to the normal project/control root. No Markdown status mirror is created, updated, validated, or consumed.

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
| `planning-validator` | Phase 7 only for `full` mode (or `targeted` escalation) after graph check | Semantic validation verdict |
| `orchestrator` | Manual handoff only after explicit user request following terminal Phase 7 completion | Multi-agent execution coordination |

## Recovery

If interrupted, read `.planning/state/planning-state-v2.json` from `CONTROL_ROOT`, derive `HISTORY_ROOT` from `phase_outputs.0.project_index_root` (fallback: normal project root only when no target is selected), reread the requirement source plus existing `HISTORY_ROOT/history/<feature>/` artifacts, resume from the first incomplete phase, and print the PIPELINE STATUS header with the resume point.

Continuous in-session planning is not a resume. Do not restart discovery or force requirement-source path mentions into normal Phase 1.5/1.6 questions just to satisfy hooks; reread reminders are prime-only unless state explicitly sets `resume_context.required=true`.
