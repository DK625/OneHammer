# Delegation and prompt design

Load this file before selecting work for a Herdr-managed execution agent or
writing its prompt.

## Keep planning and execution separate

The planning pipeline's External-lane Claude Code `Agent` call is not MCP Agent
Mail and is not an execution delegation. Preserve its exact tool, prompt block,
launch identity, direct canonical-file handoff, retry/orphan behavior, and lane
ownership. Herdr execution coordination begins only after Phase 6 or an explicit
user request to execute.

## When delegation is appropriate

Delegate only a bounded, independently checkable task whose separate context is
worth the coordination cost. Good candidates are a focused implementation, one
test surface, a read-only review, or a named investigation deliverable.

Keep work with the main agent when it is small, tightly coupled to current local
context, requires a user decision, or would overlap another writer. Delegation
never removes the main agent's duty to understand, integrate, and verify.

## Ownership before launch

`br`/beads are authoritative. Before starting a writer, record:

- ready bead or child-bead ID, dependencies, and one explicit owner;
- main-agent integration owner;
- exact cwd, branch/worktree, and Herdr target identity when available;
- allowed file/behavior surface and explicit exclusions;
- expected artifact, validation, runtime evidence, and stop conditions.

Do not assign one bead to concurrent writers. Split independent work into beads
or child beads first. A shared checkout allows one writer only; parallel writers
require isolated Git worktrees and non-overlapping scopes.

## Self-contained prompt contract

A managed agent does not inherit this conversation. Write the prompt as a direct
user instruction and include, in this order:

1. **Objective** — one concrete outcome.
2. **Repository context** — absolute cwd, governing instructions, bead, files.
3. **Current facts** — symptoms, decisions, dependencies, constraints.
4. **Ownership** — permitted writes and forbidden overlaps.
5. **Method constraints** — required skills, hooks, compatibility, conventions.
6. **Validation** — exact checks and runtime evidence.
7. **Deliverable** — changed files or read-only report, results, risks.
8. **Stop rules** — ambiguity, destructive action, conflict, scope growth.

Point to the smallest authoritative files instead of pasting broad chat history.
Never ask the agent to update planning state or another lane unless that exact
workflow explicitly assigns it ownership.

## Writer prompt template

```text
Implement <bounded outcome> in <absolute worktree path> for bead <id>.

Read and obey: <instruction files>. Current facts: <short facts>.
You own only: <files/behavior>. Do not modify: <explicit exclusions>.
Preserve: <contracts, compatibility, user changes>. Do not expand scope.

Validate with: <commands and runtime evidence>. Inspect produced artifacts.
Return: changed files, rationale, command results, observed proof, blockers,
remaining risks, and commit SHA only when this isolated branch is expected to commit.

Stop without guessing if <decision, conflict, or destructive condition> occurs.
```

## Read-only reviewer prompt template

```text
Review <commit/diff/files> in <absolute path>. Make no edits or commits.
Check: <correctness, regressions, security, tests, workflow contracts>.
Use repository evidence and non-mutating diagnostics only.
Return prioritized findings with file/line evidence, plus unverified risks.
```

## Follow-up prompts

A follow-up must restate the target, observed evidence, exact correction, unchanged
scope, and next proof. Never send only “continue”, “fix it”, or “try again”.
A material task change requires a new ownership record or a new bead.
