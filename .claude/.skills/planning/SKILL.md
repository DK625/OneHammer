---
name: planning
description: >
  Mandatory strict feature-planning pipeline. Use when the user asks to plan,
  design, roadmap, or decompose a software feature. Runs Phase 0..8 with
  feature-scoped discovery, whole-feature phase-plan approval, all-phase
  contract/story-map sets, beads, validation, and execution plan. Every planning
  response must start with the PIPELINE STATUS header.
---

# Feature Planning Pipeline

This skill is the operating manual. Mechanical gates are enforced by `.claude/hooks/planning_guard.mjs`; detailed formats live in `references/*`.

## Non-Negotiables

1. Never skip a phase in the active mode.
2. Begin every planning response with the PIPELINE STATUS header.
3. Phase 1 obtains coverage for exactly 4 canonical discovery lanes: Architecture, Patterns, Constraints, and External.
4. Launch missing lanes with background `Agent` calls whose prompts require artifact-ready Markdown in the subagent response only; wait for all 4 lane outputs, then the main agent writes canonical discovery artifacts and manages planning state.
5. Every phase transition updates both `history/<feature>/PLANNING_STATUS.md` and `.planning/state/planning-state-v2.json`.
6. Phase 2.5 approval is required before Phase 3+ unless Lightweight Mode was explicitly requested and recorded.
7. If a planning hook blocks, obey the hook message before continuing.
8. After Phase 1.5 reaches 12/12 questions, continue into Phase 1.6 and collect 8/8 test-clarification questions (2 rounds of 4) before advancing to Phase 2.
9. After Phase 1.6 reaches 8/8 and `test-scenarios.md` is written, continue in one run through Phase 2 up to the Phase 2.5 approval AskUserQuestion without extra “ok to continue?” pauses.
10. If Phase 2.5 is approved, continue in one run through Phase 3 and Phase 4, then pause only at the Phase 4 approval AskUserQuestion.
11. If Phase 4 approval is `Approve`, continue in one run through Phase 5, Phase 7, and Phase 8 with no extra confirmation pauses in between; in Phase 7, classify validation mode (`mechanical_lite` / `targeted` / `full`) before choosing the gate.
12. Phase 8 is a hard stop: after writing `execution-plan.md` and updating `PLANNING_STATUS.md` plus `.planning/state/planning-state-v2.json`, stop. Do not invoke `orchestrator`, spawn agents, reserve execution files, or start beads unless the user explicitly asks to start orchestration/execution after seeing the Phase 8 result.
13. Phase 5 beads must be close-gated: every implementation/test bead that requires runtime proof must say not to run `br close` until the concrete evidence is captured, interpreted, and recorded in the close reason or named evidence artifacts.
14. FE/UI, FE↔BE integration, and browser evidence beads must reference `.claude/lessons/browser-runbook.md`, read it before running `agent-browser`, and append durable UI discoveries back to that same single runbook file.
15. FE/browser evidence is not valid just because a screenshot file exists: the executor must read/inspect the screenshot(s), state what each proves, capture at least before-action and after/final screenshots, record the browser action sequence, and cache safe reusable login/navigation/UI cues in the Browser Runbook.

## PIPELINE STATUS Header

```text
=== PIPELINE STATUS ===
Current Phase : <phase number and name>
Completed     : [0, 0.5, 1, ...]
Next Action   : <one-line description>
State file    : .planning/state/planning-state-v2.json
=======================
```

For a Phase 1 launch turn, this header is the only text before the missing-lane `Agent` calls.

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

## Fullstack Rule

The repo is one project with `onehammerStore` backend and `onehammerUI` frontend. Backend/API contract is the source of truth. Discovery and plans must present backend findings first, then frontend impact based on that contract.

Test planning in Phase 1.6 must classify the feature into one of these modes and define evidence accordingly:

- **fullstack**: must prove all 3 layers — backend API/logic correctness, frontend UI change correctness, and FE↔BE integration correctness. FE proof requires interpreted before-action and after/final screenshots plus browser-observed network/API method + path + status.
- **fe-only**: must still use `agent-browser` for E2E browser validation, interpreted screenshot evidence at important checkpoints, and an explicit browser flow assertion; network/API cue may be `N/A` only when the UI behavior has no backend request.
- **be-only**: must prove API/logic correctness (and DB/query evidence when relevant); FE screenshot evidence can be explicitly marked `N/A`.

## Lightweight Mode

Default is the full pipeline. Lightweight Mode is opt-in only and must be recorded in state/status.

Allowed only when all are true:

- zero HIGH risks and at most one MEDIUM risk in `approach.md`
- one story only
- no cross-team/API contract change
- no new external dependency

Lightweight still requires Phase 0, compact discovery, full-feature bead coverage for all declared phases, and Phase 7 validation. It may inline Phase 3/4 details and skip Phase 2.5 approval only after explicit user opt-in.

## Pipeline

| Phase | Goal | Required Output | Hook / Gate |
|---|---|---|---|
| 0 | Verify planning dependencies | state + status evidence | `.mcp.json` has `serena`, `exa`, `gitnexus`; Serena ready; ask user whether to reindex GitNexus; `br`/`bv`/`jq` OK |
| 0.5 | Prepare feature workspace | `history/<feature>/` | feature-scoped workspace exists |
| 1 | Discover feature context | 4 lane files + `discovery.md` | coverage for Architecture, Patterns, Constraints, External; wait for all outputs before 1.5 |
| 1.5 | Clarify business scope | `requirements.md` | `AskUserQuestion` only; exactly 12 PO-style questions in 3 rounds of 4, each with >=2 options; `questions_asked` must reach 12 before Phase 1.6 |
| 1.6 | Clarify test scope | `test-scenarios.md` | `AskUserQuestion` only; exactly 8 test-focused questions in 2 rounds of 4, each with >=2 options; `questions_asked` must reach 8 before Phase 2 |
| 2 | Synthesize approach | `approach.md` | Gap Analysis, Recommended Approach, Alternatives, Risk Map; continue directly to Phase 2.5 without extra confirmation pause |
| 2.5 | Approve whole-feature plan | `phase-plan.md` | exact `AskUserQuestion` approval: Approve / Revise (first intentional pause after Phase 1.6) |
| 3 | Define phase contracts | `contracts/phase-<n>-contract.md` (for each phase declared in `phase-plan.md`) with both business contract + technical contract details (API/DB/config/error/testability) | after 2.5 Approve, continue directly to 4 without extra confirmation pause |
| 4 | Map phase stories + approve decomposition readiness | `story-maps/phase-<n>-story-map.md` (for each phase declared in `phase-plan.md`) | in full mode, ask exact `AskUserQuestion` approval once for the whole story-map set after all declared phases have both contract and story-map artifacts; after `Approve`, continue immediately in one run through Phase 5 → 7 → 8 |
| 5 | Create full-feature beads | real `br create` tasks | requires whole-set Phase 4 approval true + full feature-plan contract/story-map coverage + full story-map-to-bead coverage for all declared phases; each bead must carry evidence clauses matching its actual surface (BE/API/DB, FE/UI, or integration), migration/provisioning decision rules, completion close-gate evidence requirements, and test-session budget/split policy; no pseudo Markdown beads; no extra confirmation pause before Phase 7 |
| 7 | Validate graph and semantics | graph check + mode-based semantic verdict | cycles must be `[]`; classify `mechanical_lite` / `targeted` / `full`; only `READY`, `READY_LITE`, or `READY_TARGETED` may advance to Phase 8 |
| 8 | Produce execution plan | `execution-plan.md` + status/state update | `bv --robot-plan` plus tracks/risks; then STOP |
| Manual Handoff | Start execution coordination | optional `skill("orchestrator")` | only after explicit user approval after Phase 8; not part of Phase 8 |

## Phase Notes

### Phase 0 — Pre-flight

Use `references/pre-flight.md`. Record the Phase 0 evidence shape required by the hook. Hooks can verify `.mcp.json` config and state evidence; Claude must still run the actual MCP/CLI readiness checks and ask the user whether to reindex GitNexus before discovery because an existing index can be stale or inaccurate.

### Phase 1 — Discovery

Use `agents/launch-discovery-agents.md`. The 4 lanes are orthogonal dimensions, not backend/frontend splits. Launch only missing lanes and do not proceed to Phase 1.5 until all four lane outputs have been collected and written:

1. Architecture discovery
2. Pattern discovery
3. Constraint discovery
4. External discovery

Each lane applies the fullstack rule internally and returns artifact-ready Markdown for its canonical lane file. The subagent is the lane content author, but must not write files or planning state. The main agent writes each lane artifact near-verbatim from the subagent response, retries/enriches any thin lane with evidence instead of inventing, then compiles `history/<feature>/discovery.md` with the required sections from `references/discovery-cache.md`.

### Phase 1.5 — Business Clarification

Ask the user as a Product Owner — distilled, not scattered. Keep the normal contract of **12 questions** in **3 rounds of 4** via `AskUserQuestion`:

- 1 round = 1 `AskUserQuestion` call with `questions.length === 4`.
- Every question carries `header`, `question`, and **>=2 concrete `options`** so the user picks instead of free-typing.
- Every question targets one load-bearing business decision: scope cut, priority trade-off, success criterion, edge-case rule, ownership/SLA, or rollout/permission. Skip filler ("any preferences?", "anything else?").
- Round 2 and Round 3 must use prior answers and avoid duplicate intent unless there is a clear `followup_reason`.
- Before each next round, run a lightweight ambiguity/anomaly scan using: Phase 1 discovery artifacts, answers from prior Phase 1.5 rounds, and current requirement direction.
- Treat anomaly as business-relevant uncertainty such as: similar flow exists but appears unused, legacy fallback ownership/status unclear, conflicting sources of truth, orphan path with unclear future, or old implementation partially overlaps requested scope.
- If unresolved anomaly exists, the next round must include at least one direct PO resolution question (`keep` / `remove` / `deprecate` / `migrate` / `ignore intentionally`).
- After each round, increment `phase_outputs."1.5".questions_asked` by 4 and update `PLANNING_STATUS.md`.
- Synthesize `requirements.md` only after normal 12 questions are complete.
- Optional Round 4 is allowed only if unresolved anomaly remains after 12 questions; Optional Round 4 must be anomaly-resolution only (no broad new discovery questions).

### Phase 1.6 — Test Clarification

Use business context from 1.5 and ask **exactly 8 test-focused questions** in **2 rounds of 4** via `AskUserQuestion`:

- 1 round = 1 `AskUserQuestion` call with `questions.length === 4`.
- Every question carries `header`, `question`, and **>=2 concrete `options`**.
- Cover only high-signal testing decisions: test mode classification (fullstack / fe-only / be-only), golden path proof, critical failure-path proof, required evidence (screenshots/curl/query), FE screenshot checkpoints (before/after important actions + final state), environment + seed-data needs, rollout verification, and final sign-off owner.
- For FE-involving modes (fullstack, fe-only), options must explicitly list important screenshot timing candidates and ask the user to choose required checkpoints in Phase 1.6.
- For FE-involving modes, `test-scenarios.md` must reference `.claude/lessons/browser-runbook.md` as the single Browser Runbook source and describe any feature-specific browser flow as a runbook delta, not a new runbook file.
- After each round, increment `phase_outputs."1.6".questions_asked` by 4 and update `PLANNING_STATUS.md`.
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
  - declare either existing provisioning proof or an idempotent Alembic data migration path under `onehammerStore/alembic/versions`;
  - missing-config fail-fast behavior (500/domain error) is corruption guard only, not a substitute for bootstrap/provisioning.

### Phase 4 — Story Map Approval Gate

After writing story-map artifacts for all declared phases, ask approval once for the whole story-map set with this exact machine-checkable shape:
- `header`: `Phase 4 Approval`
- `question`: `Approve the story maps (history/<feature>/story-maps/*.md)?`
- options in order: `Approve`, `Revise`

Only exact `Approve` of the whole set allows Phase 5 decomposition in full mode. After this `Approve`, continue immediately in one run through Phase 5, Phase 7, and Phase 8, then stop only at the Phase 8 hard stop gate.

### Phase 5 — Beads

Create real beads with `br create`. Every bead must include enough phase/story context for a fresh worker and Phase 5 must produce a complete bead set for all phases declared in `phase-plan.md` (not only a single current phase).

Canonical Beads ID rule:
- Persist the exact issue IDs returned by `br create` / `br list --json` (for this repo, IDs such as `one_hammer-r35`) in story maps, planning state, execution plans, Agent Mail thread IDs, and handoffs.
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
- Migration/provisioning decision clause (always required for BE/runtime beads): before creating a new Alembic file, inspect existing revisions for the same table/key/source-of-truth, classify the decision as `schema migration`, `data/seed migration`, `existing provisioning proof`, or `no migration required`, and do not create duplicate settings/seed migrations when existing provisioning proof already satisfies the contract.
- Technical contract clause (always required): explicit API contract, DB/config source-of-truth, validation/error behavior, and what must not be hardcoded.
- FE verification clause (required only for beads whose selected work includes FE/UI/browser or FE↔BE integration evidence): explicit E2E verification via `agent-browser` with action sequence, expected UI state, before-action screenshot path, after/final screenshot path, screenshot interpretation requirement (`read the screenshots and state what each proves`), expected browser network/API cue (method + path + status, or explicit `N/A` for UI-only), network evidence artifact/requests log path when integration is in scope, `Browser Runbook Reference: .claude/lessons/browser-runbook.md`, quality-gate classification, and runbook delta (`unchanged` or durable login/navigation/UI discovery appended) in the `br close --reason` evidence. Do not attach FE screenshot obligations to BE-only implementation beads; create/link a separate FE/integration evidence bead when the overall feature still needs UI proof.
- BE verification clause (required for beads whose selected work includes BE/API/DB/runtime behavior): explicit real API-call verification (e.g. `curl`/HTTP endpoint + auth/token source + expected status/response payload) and require the command/status/response cues in the `br close --reason` evidence.
- BE runtime checklist clause (required for beads whose selected work includes BE/API/DB/runtime behavior): include explicit verification sequence with concrete cues:
  - migration/provisioning expectation (`data migration required` / `seed required` / `bootstrap required` / explicit `existing provisioning proof`),
  - migration decision evidence before writing new migration files: existing revision inspected, decision classified, and duplicate settings/seed migrations avoided,
  - idempotent migration path under `onehammerStore/alembic/versions` when data migration is required,
  - Alembic apply command from `.claude/lessons/runtime-conventions.md` or the repo-specific runtime adapter when migration-relevant,
  - backend restart step (`sudo systemctl restart onehammer-be`) when runtime reload is needed,
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
4. Every `br create` command for BE/runtime scope must include a migration/provisioning decision clause so the executor must inspect existing Alembic revisions before creating new migration files.
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

- `mechanical_lite`: only mechanical sync changed (ID alias normalization such as `br-*` -> actual `one_hammer-*`, state/story-map mapping sync, timestamp/status sync, typo/formatting, wording clarification with no contract/story/dependency-order/verification-obligation change).
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
   - Persist Phase 7 output atomically with `validation_mode=full`, `semantic_verdict`, `validator_invocation_id`, and reasons from validator output before moving to Phase 8.

Only `READY`, `READY_LITE`, or `READY_TARGETED` can advance to Phase 8.

### Phase 8 — Execution Plan Stop Gate

Phase 8 converts the validated full-feature bead graph into an execution plan only. Run `bv --robot-plan` on the full feature bead set (all declared phase labels included) so execution ordering covers backend → frontend → evidence tasks consistently while preserving every safe parallel lane; do not collapse independent ready beads into one serial track. Write `history/<feature>/execution-plan.md`, then update `PLANNING_STATUS.md` first and `.planning/state/planning-state-v2.json` second.

After that state update, stop. Keep `current_phase` at `8` with Phase 8 marked completed; do not set `current_phase` to `handoff`, invoke `skill("orchestrator")`, spawn BA/worker agents, reserve implementation files, or start the first bead. If the user later explicitly asks to start orchestration/execution, record that approval in `phase_outputs.handoff` and only then move to manual handoff.

## State and Artifacts

- Machine state: `.planning/state/planning-state-v2.json`
- State schema: `.claude/hooks/planning/state.schema.json`
- Human mirror: `history/<feature>/PLANNING_STATUS.md`
- Status mirror template: `references/planning-status-template.md`

Write `PLANNING_STATUS.md` first and the JSON state second on every transition.

## References

| File | Purpose |
|---|---|
| `references/pre-flight.md` | Phase 0 checks and evidence fields |
| `references/discovery-cache.md` | Phase 0.5 and discovery synthesis sections |
| `agents/launch-discovery-agents.md` | Phase 1 discovery coverage protocol |
| `references/phase-plan-template.md` | Whole-feature phase plan |
| `references/phase-contract-template.md` | Per-phase contract (repeat for every phase declared in `phase-plan.md`) |
| `references/story-map-template.md` | Per-phase story map (repeat for every phase declared in `phase-plan.md`) |
| `references/test-clarification.md` | Phase 1.6 test clarification |
| `references/execution-plan-template.md` | Phase 8 execution plan |
| `references/planning-status-template.md` | Human-readable state mirror |
| `.claude/hooks/planning/README.md` | Hook rule coverage |
| `.claude/lessons/browser-runbook.md` | Single living Browser Runbook for FE/UI and browser evidence beads |

## Delegated Skills

| Skill | When | Purpose |
|---|---|---|
| `planning-validator` | Phase 7 only for `full` mode (or `targeted` escalation) after graph check | Semantic validation verdict |
| `orchestrator` | Manual handoff only after explicit user approval following Phase 8 | Multi-agent execution coordination |

## Recovery

If interrupted, read `.planning/state/planning-state-v2.json`, reread the requirement source plus existing `history/<feature>/` artifacts, resume from the first incomplete phase, and print the PIPELINE STATUS header with the resume point.

Continuous in-session planning is not a resume. Do not restart discovery or force requirement-source path mentions into normal Phase 1.5/1.6 questions just to satisfy hooks; reread reminders are prime-only unless state explicitly sets `resume_context.required=true`.
