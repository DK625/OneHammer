---
name: planning-validator
description: >
  Deep semantic validation gate for the `planning` pipeline. Invoke this skill only when
  the user explicitly requests full/deep validation (for example "/validate plan full",
  "/validate plan deep", or asks for fresh-eyes validation), when targeted validation
  reports ambiguous semantic risk after deterministic checks pass, when unresolved
  high-risk payment/security/data-migration concerns remain, or when execution handoff
  is about to start and the user accepts deep validation.

  Do NOT invoke for default Phase 7, `mechanical_lite`, normal `targeted`, or concrete
  semantic-lite failures. Those are handled directly inside `planning` Phase 7 with graph
  checks and deterministic semantic-lite validation to avoid loading this large validator
  skill unnecessarily.

  This skill does NOT replace Phase 7 graph validation (cycles check with `bv --robot-insights`)
  or deterministic semantic-lite validation — it is invoked FROM Phase 7 only after those
  checks. It recommends spike work when needed but does not create or execute spike beads
  by default. It does NOT touch implementation code.

metadata:
  version: '1.0'
  position: 7.5
  chain: planning -> planning-validator -> orchestrator
  ecosystem: one_hammer
  dependencies:
    - id: beads-cli
      kind: command
      command: br
      missing_effect: unavailable
      reason: Validator inspects current-phase beads and may recommend spike beads without creating them by default.
    - id: beads-viewer
      kind: command
      command: bv
      missing_effect: unavailable
      reason: Validator consumes graph analytics in V3.
    - id: jq
      kind: command
      command: jq
      missing_effect: unavailable
      reason: All bv --robot-* outputs are parsed with jq.
---

# Planning Validator — Semantic Gate for the `planning` Pipeline

> "Don't jump off the wall without checking."

## Why This Skill Exists

`planning` Phase 7 should catch most plan defects without loading a large validator:

1. **Graph validation** — `bv --robot-triage` + `bv --robot-insights` + cycles check (`.cycles // .Cycles // []`). This stays in `planning`.
2. **Deterministic semantic-lite validation** — story-to-bead mapping, requirements coverage, runtime config/bootstrap invariants, endpoint/schema consistency, verification clauses, completion close-gates, and migration/provisioning decision clauses. This stays in `planning`.
3. **Targeted manifest review** — a compact LLM pass only when deterministic checks pass but API/DB/config/fullstack semantics still need judgment. This stays in `planning` unless it escalates.
4. **Deep semantic validation** — this skill. Use it only when the user opts into full/deep validation or targeted validation reports ambiguous critical risk.

This split keeps default Phase 7 cheap while preserving a deeper gate for cases where plan-space reasoning is worth the token cost. The validator can also be invoked standalone when the user already has a plan and explicitly wants deep/fresh-eyes review.

## Invocation Contracts

### Invoked from `planning` Phase 7

Caller passes:

- `feature` — feature slug (matches `history/<feature>/...`)
- `current_phase` — integer (e.g. `2`)
- `state_file` — `.planning/state/planning-state-v2.json`
- `semantic_lite_summary` — compact result from graph + deterministic checks
- `validation_reason` — why deep validation is needed (`explicit_full`, `explicit_deep`, `targeted_ambiguous_risk`, `unresolved_high_risk`, or `handoff_deep_accepted`)

Validator returns:

- `semantic_verdict` — `READY | BLOCKED | NEEDS-REVISION`
- `validator_invocation_id` — `val-<feature>-<phase>-<ISO8601>`
- `reasons` — list of short strings (empty when verdict is ready)
- `needs_spike` — optional yes/no spike recommendation when high risk remains unresolved

Caller writes the payload back into `phase_outputs."7"` of the state file. Validator does NOT mutate state itself.

### Invoked standalone ("/validate plan full" / "validate plan deep")

Auto-detect:

- If `.planning/state/planning-state-v2.json` exists → read `feature` + `current_phase` from it
- Otherwise ask the user

Proceed with deep semantic validation and print the verdict in the final report. If the user asks only for a normal Phase 7 check, tell them to run the default planning Phase 7 path instead of loading this skill.

## Validation Mode Policy

Default Phase 7 must NOT invoke this full validator. Phase 7 must first run deterministic semantic-lite validation:

- graph cycles (`bv --robot-insights` cycles must be `[]`)
- story-to-bead mapping has real `br-*` IDs
- every story maps to at least one bead
- requirements coverage (`R1`/`R2`/... requirements appear in contract, story, or bead coverage)
- DB settings source-of-truth has bootstrap/provisioning/migration proof
- runtime-critical config keys are not paired with "no migration expected"
- BE/runtime beads require a migration/provisioning decision clause before new Alembic files are created
- legacy endpoint retirement is explicit when required, including 404/410/no-side-effect behavior
- canonical API endpoint/schema naming is consistent across contract, tests, and beads
- every bead has concrete FE/BE verification clauses, completion close-gate evidence requirements, and test budget

Invoke `planning-validator` only when:

1. the user explicitly requests full/deep validation;
2. semantic-lite passes but reports ambiguous semantic risk;
3. high-risk payment/security/data-migration concerns remain unresolved;
4. execution handoff is about to start and the user accepts deep validation.

If semantic-lite reports concrete actionable failures, fix those failures directly and do not spawn a validator Agent.

## Validation Scope

This skill is **deep-mode only**.

- Lightweight mechanical checks and normal targeted checks are handled in `planning` Phase 7.
- Do not load this skill for concrete semantic-lite failures.
- Run at most one deep Agent pass by default and return a patch list instead of automatically rerunning expensive review loops.

## Prerequisites

These must exist before validation starts:

- `history/<feature>/CONTEXT.md` (or `requirements.md` — both acceptable)
- `history/<feature>/discovery.md` (10 section schema — see `references/structural-checklist.md`)
- `history/<feature>/approach.md` (Gap / Recommended / Alternatives / Risk Map)
- `history/<feature>/phase-plan.md`
- `history/<feature>/phase-<n>-contract.md`
- `history/<feature>/phase-<n>-story-map.md`
- Beads labelled with current phase (e.g. `-l phase-<n>` or tagged in title `[Phase <n>]`)

If any are missing → verdict `BLOCKED` with `reasons: ["missing artifact: <path>"]`. Return to caller.

## Fullstack Rule (one_hammer specific)

`onehammerStore` is the contract source of truth. When reviewing dimensions that touch both sides:

- backend contract changes must be verified BEFORE frontend work is accepted
- a story that touches `onehammerUI` but has no matching backend contract (either in a prior phase or this phase) is a FAIL on Dimension 8 (Exit-State) unless explicitly documented as pure-frontend

---

## Deep Mode — V1 Structural Validation

**Run at most one plan-checker Agent pass by default.** The expensive Agent pass is for ambiguous semantic judgment, not for failures a deterministic script already found.

### V1.0 — Semantic-lite gate

Before loading prompts or spawning an Agent, inspect `semantic_lite_summary` from Phase 7.

- If semantic-lite is missing → return `BLOCKED` with reason `semantic-lite must run before planning-validator`.
- If semantic-lite has concrete actionable failures → return `NEEDS-REVISION` with those failures and do not spawn any Agent.
- If semantic-lite passed or reports ambiguous semantic risk → continue to V1.1.

Concrete semantic-lite failures include missing `br-*` story mapping, uncovered `R*` requirements, runtime config without bootstrap proof, endpoint/schema contradictions, missing verify clauses, missing completion close-gates, missing migration/provisioning decision clauses, and beads without test budgets.

### V1.1 — Load plan-checker prompt

Read `references/plan-checker-prompt.md` and `references/structural-checklist.md` only after V1.0 allows deep validation.

### V1.2 — Spawn plan-checker subagent

Run this at most once by default. Do not run V1.2 if semantic-lite has concrete failures. Do not rerun automatically after fixes unless the user explicitly requests a deep second pass.

Use the `Agent` tool with `subagent_type="general-purpose"` and pass the plan-checker prompt plus compact inputs:

```text
feature: <feature>
current_phase: <n>
validation_reason: <reason>
semantic_lite_summary: <compact PASS/FAIL/AMBIGUOUS list>
artifacts:
  - history/<feature>/CONTEXT.md (or requirements.md)
  - history/<feature>/discovery.md
  - history/<feature>/approach.md
  - history/<feature>/phase-plan.md
  - history/<feature>/phase-<n>-contract.md
  - history/<feature>/phase-<n>-story-map.md
  - beads with label phase-<n>
```

### V1.3 — 8 dimensions

1. **Phase contract clarity** — entry/exit state, demo walkthrough, unlocks, out-of-scope all concrete and observable
2. **Story coverage and ordering** — each story has job + why-now + done-looks-like; Story 1 has a reason to be first
3. **Decision coverage** — locked decisions from `CONTEXT.md`/`approach.md` map to stories and beads
4. **Dependency correctness** — bead graph acyclic, story order matches bead dependency order, no missing refs
5. **File scope isolation** — no two ready beads write the same file without explicit sequencing; `onehammerStore` vs `onehammerUI` split respected
6. **Context budget** — every bead fits in one worker context (no multi-layer omnibus beads)
7. **Verification completeness** — every story has `done looks like`, every bead has runnable `verify:` and an explicit test budget
8. **Exit-state completeness and risk alignment** — if all beads close, the phase exit state holds, and HIGH-risk items either have explicit deferrals or spike recommendations

### V1.4 — Triage

- All 8 PASS → advance to V2
- Any FAIL → return `NEEDS-REVISION` with a concrete patch list. Do not automatically fix artifacts and rerun the Agent.
- If the user explicitly asks to patch plan artifacts, patch the affected artifacts, run semantic-lite again, and stop unless they request a deep second pass.

Repair routing:

| Failing dimension | Fix file |
|---|---|
| 1 Phase contract | `phase-<n>-contract.md` |
| 2 Story order | `phase-<n>-story-map.md` |
| 3 Decision coverage | `phase-<n>-story-map.md` + beads |
| 4 Dependency | beads (`br dep add/rm`) |
| 5 File scope | bead descriptions + `br dep add` for sequencing |
| 6 Context budget | split beads (create smaller children, close oversized) |
| 7 Verify | bead `verify:` field + story `done looks like` + test budget |
| 8 Exit-state / risk | `phase-<n>-contract.md`, spike recommendation, or explicit deferral in `phase-plan.md` |

---

## V2 — Spike Recommendation, Not Automatic Execution

Do not create or execute spike beads during default deep validation. Spike execution is research/implementation work, not validation.

Fire only when `phase_outputs."2".high_risk_count > 0` AND at least one HIGH risk targets the current phase.

If no current-phase HIGH risks → skip to V3.

### V2.1 — Emit spike recommendation

For each unresolved HIGH risk, return `NEEDS-REVISION` with:

- risk id or short risk slug
- the yes/no question the spike must answer
- suggested spike bead title
- affected artifact(s) or bead(s)
- what evidence would make the answer YES vs NO

Suggested title format:

```text
Spike: Phase <n> - <yes/no question>
```

### V2.2 — Stop for user decision

Do not run `br create`, do not spawn a spike Agent, and do not write `history/<feature>/spike-*.md` unless the user explicitly approves separate spike execution.

If a HIGH risk can be explicitly deferred without breaking the phase exit state, require that deferral to be written into `phase-plan.md` or `phase-<n>-contract.md`; otherwise return `NEEDS-REVISION` with `needs_spike: true`.

---

## V3 — Polish Review

Multiple rounds. Quality compounds.

### V3.1 — Dependency completeness

```bash
bv --robot-suggest 2>/dev/null | jq '.suggestions'
```

Add missing structural dependencies. Re-run until stable.

### V3.2 — Graph health

```bash
bv --robot-insights 2>/dev/null | jq '{cycles: (.cycles // .Cycles // []), bottlenecks: .bottlenecks, orphans: .orphans}'
```

Cycles MUST be `[]`. Fix bottlenecks/orphans before advancing.

> Note: the caller's Phase 7 already checks cycles. Re-check here in case V1/V2 added or closed beads.

### V3.3 — Priority sanity

```bash
bv --robot-priority 2>/dev/null | jq '.misaligned'
```

Adjust priorities if foundational work is buried behind cosmetic polish.

### V3.4 — Deduplication

Scan current-phase bead titles + descriptions. Merge or close beads where `story + file scope + goal` collide.

### V3.5 — Fresh-eyes review (disabled by default)

Do not run this step automatically merely because this skill was invoked. Fresh-eyes review is expensive and should be reserved for critical ambiguity.

Run only when one of the following is true:

- the user explicitly requests deep/fresh-eyes validation; or
- execution handoff is about to start and semantic-lite/targeted validation found ambiguous critical risk.

Load `references/bead-reviewer-prompt.md`. Spawn fresh-eyes `Agent` (`subagent_type="general-purpose"`, no prior context beyond the bead set) with this framing:

```text
Check over each bead super carefully — are you sure it makes sense? Is it optimal?
Could we change anything to make the system work better for users? If so, revise the beads.
It is a lot easier and faster to operate in plan space before we start implementing these things.
Use /effort max.
```

Output: CRITICAL + MINOR flags per `references/bead-quality-checklist.md`. Return CRITICAL flags as `NEEDS-REVISION`; do not automatically enter another rewrite/review loop unless the user explicitly asks.

### V3.6 — Story-to-bead coherence

- every story maps to ≥ 1 bead
- every bead belongs to exactly one story
- if a story has many beads, each bead must have a distinct reason
- if a bead spans multiple unrelated stories → muddy decomposition, split it

---

## V4 — Exit-State Readiness Review

Human-readable readiness check. Use `references/exit-state-review.md` for the full question list. At minimum answer:

1. If every story reaches its `done looks like`, does the phase exit state hold?
2. If every current-phase bead closes, will every story actually be done?
3. Is the demo walkthrough credible?
4. Does this phase still make sense in the larger `phase-plan.md`?
5. Fullstack check: backend contract changes (if any) come from either a prior completed phase OR the current phase's bead set — never deferred implicitly to a later phase.

Any "no" or "not sure" → verdict `NEEDS-REVISION`. Route:

| Problem | File to fix |
|---|---|
| Phase meaning | `phase-<n>-contract.md` |
| Story decomposition | `phase-<n>-story-map.md` |
| Implementation granularity | beads |
| Phase-boundary / architecture | `approach.md` or `phase-plan.md` |

---

## V5 — Final Approval

Present this summary to the user. Do not skip any field.

```text
DEEP VALIDATION COMPLETE — APPROVAL REQUIRED BEFORE EXECUTION

Feature: <feature>
Current Phase: Phase <n> - <name>
Validation reason: <explicit_full|explicit_deep|targeted_ambiguous_risk|unresolved_high_risk|handoff_deep_accepted>

Phase 7 prechecks consumed:
- graph cycles:                 <PASS|FAIL> (<N> cycles)
- semantic-lite summary:        <PASS|AMBIGUOUS|FAIL>
- concrete semantic-lite fails: <none | list>

Artifacts reviewed:
- discovery.md (10 sections): <PASS|FAIL>
- approach.md (4 sections):   <PASS|FAIL>
- phase-plan.md:              <PASS|FAIL>
- phase-<n>-contract.md:      <PASS|FAIL>
- phase-<n>-story-map.md:     <PASS|FAIL>
- beads labelled phase-<n>:   <N>

V1 Structural Verification:
- Plan-checker Agent: <RUN_ONCE|SKIPPED>
- All 8 dimensions:  <PASS|FAIL>
- Patch list:        <none | list>

V2 Spike Recommendations:
- HIGH-risk items for this phase: <N>
- Spike execution performed:      0
- Spike recommendations:          <none | list yes/no question + suggested bead title>
- needs_spike:                    <true|false>

V3 Polish Results:
- Dependencies added/recommended: <N>
- Graph issues fixed/reported:    <N>
- Priority adjustments:           <N>
- Duplicates removed/reported:    <N>
- Fresh-eyes Agent:               <RUN|SKIPPED>
- Fresh-eyes CRITICAL flags:      <N>

V4 Exit-State Readiness:
- Exit state observable: <YES|NO>
- Story sequence coherent: <YES|NO>
- Demo credible: <YES|NO>
- Fullstack contract intact: <YES|NO>

Unresolved concerns:
- <none | list>

VERDICT: <READY | BLOCKED | NEEDS-REVISION>
Invocation ID: val-<feature>-<phase>-<ISO8601>
Reasons: [<short strings>]
```

### Verdict mapping

| Mode | Result pattern | Verdict |
|---|---|---|
| deep | semantic-lite missing or required artifacts missing | **BLOCKED** |
| deep | semantic-lite has concrete actionable failures | **NEEDS-REVISION** |
| deep | all V1..V4 checks pass after the single deep pass and no unresolved CRITICAL/high-risk flags remain | **READY** |
| deep | unresolved HIGH risk needs a spike | **NEEDS-REVISION** with `needs_spike: true` |
| deep | unresolved polish/readiness issues remain | **NEEDS-REVISION** |

### Return payload to caller

```json
{
  "semantic_verdict": "<READY|BLOCKED|NEEDS-REVISION>",
  "validator_invocation_id": "val-<feature>-<phase>-<ISO8601>",
  "reasons": ["<optional short reasons>"],
  "needs_spike": false,
  "spike_recommendations": []
}
```

Caller (`planning` Phase 7) writes this into `phase_outputs."7"`:

```json
"7": {
  "status": "completed",
  "validation_mode": "deep",
  "cycles_found": 0,
  "semantic_lite_verdict": "PASS",
  "semantic_verdict": "READY",
  "validator_invocation_id": "val-<feature>-<phase>-<ISO8601>",
  "needs_spike": false,
  "timestamp": "<ISO8601>"
}
```

Use `READY` only when deep-mode pass has no unresolved patch list, CRITICAL flags, or spike recommendation. `BLOCKED` and `NEEDS-REVISION` must not advance to Phase 8.

---

## Lightweight / Targeted Handling Boundary

- `mechanical_lite`, semantic-lite, and normal `targeted` validation are owned by `planning` Phase 7.
- This skill should not be loaded for those paths.
- If semantic-lite reports concrete actionable failures, fix the artifacts directly and rerun semantic-lite; do not call this skill.
- If targeted validation escalates because risk remains ambiguous, call this skill once in deep mode.
- A second deep Agent pass, fresh-eyes Agent, or spike execution requires explicit user approval.

---

## Red Flags

- executing any bead before V5 approval
- validating a bead set whose `phase-plan.md` was never user-approved
- validating a phase whose contract/story-map files do not exist
- invoking this skill before semantic-lite has run
- spawning plan-checker Agent when semantic-lite already reported concrete failures
- running a second plan-checker Agent pass without explicit user request
- creating spike beads or spawning spike Agents during validation without explicit user approval
- running fresh-eyes Agent automatically merely because deep/full validation is active
- fullstack feature with frontend beads but no backend contract trail
- a bead whose `verify:` field is "make sure it works"
- a bead missing an explicit test budget

---

## Reference Files

| File | When to load |
|------|-------------|
| `references/structural-checklist.md` | V1 — artifact + section schema |
| `references/plan-checker-prompt.md` | V1.2 — plan-checker subagent prompt |
| `references/spike-template.md` | V2 — spike finding artifact template |
| `references/bead-quality-checklist.md` | V3 — CRITICAL/MINOR classifier |
| `references/bead-reviewer-prompt.md` | V3.5 — fresh-eyes subagent prompt |
| `references/exit-state-review.md` | V4 — readiness question list |
