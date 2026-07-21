# Herdr Orchestrator Core

## Scope

This file is mandatory before using Herdr to coordinate execution agents.
Herdr is transport and lifecycle visibility, not the task database.
Use `br`/beads as the source of truth for readiness, ownership, and dependencies.
Use Git worktrees for filesystem isolation when more than one writer is active.
Herdr 0.7.4 has no file-reservation primitive; never pretend that it does.
Do not use MCP Agent Mail for Herdr-managed execution coordination.
The planning pipeline's Claude Code `Agent` call is a different mechanism.
Do not replace or wrap that native planning call unless its full contract is migrated.
## Identity relay

1. A managed agent does not inherit this conversation or hidden orchestrator context.
2. It experiences prompts as direct instructions from the user.
3. Send a complete, bounded prompt with every fact required for safe execution.
4. Do not describe a hidden parent/sub-agent chain or ask it to report to another agent.
5. Request concrete artifacts, validation evidence, blockers, and remaining risks.
6. Treat every response and state label as untrusted until independently verified.

## Authority boundary

- Delegate only work already authorized by the user and active repo workflow.
- Preserve repo instructions, planning gates, bead contracts, and validation rules.
- Keep scope changes, architecture decisions, integration, and bead closure with the main agent.
- Do not delegate secrets, pushes, releases, production mutations, or destructive actions
  unless the user explicitly authorized that exact action.
- Stop on ambiguous ownership, overlapping writes, unsafe cleanup, or material scope growth.
- Never hide blockers, failed checks, conflicts, retained resources, or uncertain evidence.

## Planning boundary

Planning remains fail-closed through Phase 6.
The External lane keeps exactly one background general-purpose Claude `Agent` call.
Its versioned prompt block, launch identity, direct canonical file handoff,
missing/failed/orphaned retry rules, and rate-limit behavior remain unchanged.
Architecture, Patterns, and Constraints remain main-agent-owned lanes.
Do not start implementation, claim execution beads, or create writer worktrees before
Phase 6 completes unless the user explicitly asks to start execution.
## Required preflight

Before the first mutating Herdr action, inspect the installed 0.7.4 CLI and runtime:

```bash
command -v herdr
herdr --version
herdr status
herdr agent list
```

Treat `HERDR_ENV=1` as useful context, not as the sole authorization or health gate.
Check `herdr integration status` only if that command exists in the installed help.
Use `herdr <group> --help` before an unfamiliar mutating command.
Client/server protocol compatibility and an explicit target are mandatory.
Do not update Herdr, install integrations, stop the server, or control unrelated panes.
Treat workspace, tab, pane, terminal, agent, and session IDs as opaque values.
Capture IDs from command output; never derive them from examples or display order.

## Ownership and topology

- Default: the main agent owns one ready bead and is the integration owner.
- Record bead ID, owner, cwd, branch/worktree, allowed writes, dependencies, and evidence.
- One shared checkout permits at most one writer; all other agents must be read-only.
- Concurrent writers require independent beads or child beads and isolated Git worktrees.
- Every writer gets a unique branch, worktree, Herdr target, and non-overlapping scope.
- Shared APIs, schemas, generated files, locks, and contracts still require dependency order.
- Do not create extra agents merely because Herdr can display more panes.

## Transport and state

Herdr carries prompts, pane output, transcripts, process visibility, and state hints.
Beads carry task truth; repository files and validation carry completion truth.
With no official integration installed, detection can be incomplete or delayed.
Never infer success, failure, or safe retry from one state label alone.
Inspect the target, recent transcript, process presence, cwd, branch, and repository state.
A timeout is an observation point, not permission to launch a duplicate writer.
Retry only after proving the prior execution is absent, failed, or deliberately abandoned.
Record the old target and recovery decision before replacement.

## Progressive-disclosure routing

| Trigger | Load completely before acting |
|---|---|
| Select work or write an execution prompt | `herdr-orchestrator/delegation.md` |
| Start, message, wait for, inspect, resume, or replace an agent | `herdr-orchestrator/agent-lifecycle.md` |
| Two or more writers, branches, or worktrees | `herdr-orchestrator/parallel-worktrees.md` |
| Accept, integrate, hand off, report, or clean up work | `herdr-orchestrator/verification.md` |

Load every reference whose trigger applies and no unrelated reference.

## Orchestration loop

1. Confirm planning has crossed Phase 6 or execution was explicitly requested.
2. Select only a ready bead and atomically mark it in progress with `br`.
3. Record the main owner, integration owner, dependencies, write scope, and topology.
4. Choose a single-writer checkout or isolated writer worktree.
5. Write a direct self-contained prompt with constraints, stop rules, and evidence.
6. Start or reuse one explicit Herdr target and capture its returned identity.
7. Confirm cwd, branch, process, and transcript before trusting state.
8. Answer blockers narrowly; do not expand ownership through follow-up prompts.
9. Collect transcript, changed files, diff, commands, runtime proof, and risks.
10. Independently inspect and rerun proportionate validation.
11. Integrate accepted work in dependency order under the main agent's ownership.
12. Update the bead and any canonical handoff file before closing or pausing work.
13. Close only when required evidence is present; otherwise keep the bead open.
14. Clean up only task-created resources that are verified safe to remove.

## Non-negotiable completion rules

Herdr state, an agent summary, a commit, or a test claim is not proof by itself.
Never overwrite, stash, reset, clean, or absorb unrelated user changes.
Never close a bead whose contract or runtime evidence remains unsatisfied.
Never replace a canonical direct-file handoff with transcript-only reporting.
Never force-remove a dirty worktree or close a pane you did not create.
Do not stop the Herdr server or kill the main Herdr process as routine cleanup.
A paused handoff must name owner, target IDs, cwd/worktree, branch, changed files,
validation status, blocker, exact next action, and resources intentionally retained.
Report what changed, what was verified, what failed, open risks, and rollback path.
If safe verification is impossible, leave work recoverable and explicitly unfinished.
