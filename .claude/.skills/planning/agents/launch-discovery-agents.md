---
name: launch-discovery-agents
description: >
  Sub-skill for Phase 1 of planning-v2. Handles coverage for the four
  feature-scoped discovery lanes. Subagents author artifact-ready lane Markdown
  in responses; the main agent writes canonical artifacts under history/<feature>.
---

# Phase 1: Discovery Lane Coverage Protocol

You are executing Phase 1 of the planning pipeline. Your job is to obtain complete coverage for exactly four canonical lanes:

1. Architecture
2. Patterns
3. Constraints
4. External

Batching is an optimization, not the invariant. The invariant is: all four unique lanes must produce successful non-error outputs before Phase 1 can complete.

## Pre-Launch Checklist

Before emitting any Agent call, verify:

- [ ] `<feature>` is substituted with the actual feature name in every prompt.
- [ ] You know which lanes are already running, completed, failed, or missing from `phase_outputs.1.lanes` and existing lane artifacts.
- [ ] You launch only missing or failed lanes; never relaunch a lane already `running`, `completed`, or `succeeded`.
- [ ] Each launch identifies exactly one lane in `name`, `description`, and `prompt`.
- [ ] Each launch uses `run_in_background=true` so missing lanes can run concurrently.
- [ ] Each launch uses `subagent_type="Explore"` or `subagent_type="general-purpose"`.
- [ ] Fullstack cross-cutting rule is stated in each prompt: backend-first, then frontend impact based on contract.
- [ ] Each prompt requires the subagent to return artifact-ready Markdown in its response for the canonical lane path.
- [ ] Each prompt forbids the subagent from writing files, artifacts, `history/`, `.planning`, `PLANNING_STATUS.md`, `discovery.md`, or JSON state.
- [ ] Each prompt states that the main agent writes canonical lane files, compiles `discovery.md`, and manages `PLANNING_STATUS.md` plus JSON state.
- [ ] You will write lane outputs only to canonical numbered artifact paths: `1-architecture.md`, `2-patterns.md`, `3-constraints.md`, `4-external.md`. Do not create unnumbered aliases like `architecture.md`.

If any check fails, fix it first.

## Subagent Type Decision

`Explore` and `general-purpose` are both valid for Phase 1.

Prefer `Explore` for read-heavy lanes because it can use MCP/code intelligence while reducing write-side effects:

- Architecture: prefer `Explore`
- Patterns: prefer `Explore`
- Constraints: prefer `Explore`
- External: use `Explore` if it has the required external-research tools; otherwise use `general-purpose`

Use `general-purpose` when a lane needs tools unavailable to `Explore`. The main agent, not the discovery agents, writes lane artifacts and planning state.

## Required Output Shape

First output:

```text
=== PIPELINE STATUS ===
Current Phase : 1 — Discovery (launching or waiting for missing lanes)
Completed     : [list phases completed so far]
Next Action   : Waiting for all four discovery lane outputs before Phase 1.5
State file    : .planning/state/planning-state-v2.json
=======================
```

Then immediately output `Agent` calls for the missing lanes only. You may launch 1, 2, 3, or 4 calls, depending on coverage state.

## Fullstack cross-cutting note (embed into every prompt)

Every agent prompt must carry this clause so the fullstack rule from `CLAUDE.md` is honored inside each lane:

> "This repo is a monorepo with `onehammerStore` (Python backend) and `onehammerUI` (Next.js frontend). Sweep both where your dimension requires. Report backend findings first as contract source of truth, then frontend impact based on that contract. If the feature is pure-backend or pure-frontend, state which half you skipped and why."

## Subagent Response Contract

Every discovery prompt must require the lane agent to return Markdown that is ready to persist as the lane artifact. The lane agent is the content author, but not the file writer.

Required prompt language:

```text
Return artifact-ready Markdown in your response for history/<feature>/discovery-lanes/<n>-<lane>.md.
Do not write, edit, persist, create, or modify files, artifacts, history/, .planning, PLANNING_STATUS.md, discovery.md, or JSON state.
The main agent writes canonical lane files, compiles discovery.md, and manages PLANNING_STATUS.md/JSON state.
Include: Scope, Findings, Evidence with file paths/symbol names, backend first as source of truth, frontend impact, Browser Runbook candidates when durable UI route/login/selector/state cues are found, risks/constraints/gaps, and open questions.
Target: compact but complete, roughly 50-120 lines unless the lane is truly tiny.
```

If a lane response is thin, missing evidence, or not artifact-ready, retry/enrich that lane from evidence. Do not compress it into a short main-agent summary and do not invent missing findings.

## Agent A — Architecture Discovery

```text
Agent(
  name="phase1-architecture",
  subagent_type="Explore",
  description="Agent A: Architecture discovery — <feature>",
  prompt="Map codebase architecture for feature <feature>.\nUse Serena/GitNexus/code intelligence as PRIMARY tools.\nReturn artifact-ready Markdown in your response for history/<feature>/discovery-lanes/1-architecture.md. Do not write, edit, persist, create, or modify files, artifacts, history/, .planning, PLANNING_STATUS.md, discovery.md, or JSON state. The main agent writes canonical lane files, compiles discovery.md, and manages PLANNING_STATUS.md/JSON state.\nInclude: Scope, packages/modules/entry points/module boundaries, target architecture sketch, Evidence with file paths/symbol names, backend first as source of truth, frontend impact, Browser Runbook candidates when durable UI cues are found, risks/constraints/gaps, and open questions. Target 50-120 lines unless the lane is truly tiny.\n\n<fullstack cross-cutting note>",
  run_in_background=true
)
```

## Agent B — Pattern Discovery

```text
Agent(
  name="phase1-patterns",
  subagent_type="Explore",
  description="Agent B: Patterns discovery — <feature>",
  prompt="Find reusable implementations, utilities, naming conventions, and coding patterns for feature <feature>.\nUse Serena/GitNexus/code intelligence as PRIMARY tools.\nReturn artifact-ready Markdown in your response for history/<feature>/discovery-lanes/2-patterns.md. Do not write, edit, persist, create, or modify files, artifacts, history/, .planning, PLANNING_STATUS.md, discovery.md, or JSON state. The main agent writes canonical lane files, compiles discovery.md, and manages PLANNING_STATUS.md/JSON state.\nInclude: Scope, reusable backend and frontend patterns, similar implemented features, conventions, anti-patterns, Evidence with file paths/symbol names, backend first as source of truth, frontend impact, Browser Runbook candidates when durable UI cues are found, risks/constraints/gaps, and open questions. Target 50-120 lines unless the lane is truly tiny.\n\n<fullstack cross-cutting note>",
  run_in_background=true
)
```

## Agent C — Constraint Discovery

```text
Agent(
  name="phase1-constraints",
  subagent_type="Explore",
  description="Agent C: Constraints discovery — <feature>",
  prompt="Identify technical constraints for feature <feature>: package.json / pyproject / tsconfig, env vars, CI configs, runtime versions, available deps, build/test requirements.\nReturn artifact-ready Markdown in your response for history/<feature>/discovery-lanes/3-constraints.md. Do not write, edit, persist, create, or modify files, artifacts, history/, .planning, PLANNING_STATUS.md, discovery.md, or JSON state. The main agent writes canonical lane files, compiles discovery.md, and manages PLANNING_STATUS.md/JSON state.\nInclude: Scope, constraints by severity, technical boundaries, migration/runtime/auth/precision/build-test implications, Evidence with file paths/symbol names, backend first as source of truth, frontend impact, Browser Runbook candidates when durable UI cues are found, risks/gaps, and open questions. Target 50-120 lines unless the lane is truly tiny.\n\n<fullstack cross-cutting note>",
  run_in_background=true
)
```

## Agent D — External Discovery

```text
Agent(
  name="phase1-external",
  subagent_type="general-purpose",
  description="Agent D: External discovery — <feature>",
  prompt="Research external knowledge for feature <feature>: design patterns, best practices, API docs, library references.\nUse Exa/web research as PRIMARY tools when available.\nReturn artifact-ready Markdown in your response for history/<feature>/discovery-lanes/4-external.md. Do not write, edit, persist, create, or modify files, artifacts, history/, .planning, PLANNING_STATUS.md, discovery.md, or JSON state. The main agent writes canonical lane files, compiles discovery.md, and manages PLANNING_STATUS.md/JSON state.\nInclude: Scope, external recommendations, references mapped to product/architecture decisions, Evidence/source links or doc names, backend first as source of truth, frontend impact, Browser Runbook candidates when durable UI cues are found, risks/constraints/gaps, and open questions. Target 50-120 lines unless the lane is truly tiny. Skip only if the feature is purely internal with no external library/integration.\n\n<fullstack cross-cutting note>",
  run_in_background=true
)
```

## Waiting Gate Before Phase 1.5

Do not start Phase 1.5 until all four lanes have successful non-error results.

If any lane is still running:
- do not ask the user business questions,
- do not write partial discovery synthesis,
- wait for the remaining agent output.

If a lane failed:
- record the lane as failed or blocked in `phase_outputs.1.lanes`,
- relaunch only that lane when retryable,
- if the failure is a rate limit, record `blocked_rate_limit` and `retry_after`, then pause instead of spawning duplicates.

## Write Artifacts After All 4 Outputs

After all four subagent responses are available, inspect each response for artifact-ready structure and evidence. Write lane artifacts near-verbatim from the subagent responses using exactly these canonical numbered filenames; the planning guard blocks unnumbered aliases:

```text
Write("history/<feature>/discovery-lanes/1-architecture.md", <agent_a_result>)
Write("history/<feature>/discovery-lanes/2-patterns.md", <agent_b_result>)
Write("history/<feature>/discovery-lanes/3-constraints.md", <agent_c_result>)
Write("history/<feature>/discovery-lanes/4-external.md", <agent_d_result>)
```

If a response lacks evidence, backend-first analysis, frontend impact, Browser Runbook candidates when durable UI cues are found, risks/gaps, or enough detail for Phase 2 to avoid rediscovery, retry/enrich that lane before writing completion state. Then compile synthesis:

```text
Write("history/<feature>/discovery.md", <compiled_feature_discovery>)
```

`discovery.md` should include at minimum:
- Scope
- Architecture Findings (backend → frontend order)
- Backend/API Contract Changes
- Frontend Impact (based on contract)
- Existing Patterns To Reuse
- Technical Constraints
- External References (Exa evidence)
- GitNexus Evidence
- Serena Evidence
- Risks
- Open Questions
- Discovery Gaps

## Update State

After artifact writes, update `.planning/state/planning-state-v2.json`:
- `current_phase`: `"1.5"`
- add `"1"` to `completed_phases`
- set `phase_outputs.1.status`: `"completed"`
- record `discovery_path`
- record `agents` and/or lane ledger:

```json
"lanes": {
  "architecture": { "status": "completed", "agent_name": "phase1-architecture", "artifact_path": "history/<feature>/discovery-lanes/1-architecture.md" },
  "patterns": { "status": "completed", "agent_name": "phase1-patterns", "artifact_path": "history/<feature>/discovery-lanes/2-patterns.md" },
  "constraints": { "status": "completed", "agent_name": "phase1-constraints", "artifact_path": "history/<feature>/discovery-lanes/3-constraints.md" },
  "external": { "status": "completed", "agent_name": "phase1-external", "artifact_path": "history/<feature>/discovery-lanes/4-external.md" }
}
```

Write `history/<feature>/PLANNING_STATUS.md` first, then write the JSON state second.

## Why Coverage Matters

A missing lane silently degrades plan quality. Coverage-based recovery allows partial launches and retries without duplicate agents, while the completion gate still requires all four unique lane artifacts before Phase 1.5.
