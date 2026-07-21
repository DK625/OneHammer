# Parallel writers and isolated Git worktrees

Load this file whenever two or more agents may write, work spans independent branches,
or a writer must be isolated from the user's current checkout.

## Invariants

- `br`/beads define task readiness, dependencies, and one owner per active bead.
- The main agent remains the integration owner and final acceptance authority.
- Never run concurrent writers in the same checkout.
- Give every writer an independent bead or child bead, branch, worktree, and Herdr target.
- Write scopes must be disjoint; shared contracts require explicit dependency order.
- Never stash, reset, clean, move, or absorb unrelated user changes to create isolation.
- Do not push, release, force-remove, or delete branches without authority.

Herdr has no file reservation. Git worktrees provide physical checkout isolation, not
logical conflict prevention. APIs, schemas, generated files, dependency locks, migrations,
and shared contracts can still conflict even when branches do not touch the same lines.

## Prepare with Git as the source of truth

Inspect before mutation:

```bash
git -C <repo> status --short
git -C <repo> worktree list --porcelain
git -C <repo> branch --show-current
git -C <repo> rev-parse HEAD
```

Choose a verified base commit. Do not base a new worktree on uncommitted user state.
Create a unique branch and worktree with the repository's normal Git workflow, for example:

```bash
git -C <repo> worktree add -b herdr/<bead>-<slug> <absolute-path> <base-ref>
```

If the branch already exists, stop and inspect it rather than reusing it blindly. Verify
branch, cwd, base, and clean status. Then create or reuse one task-owned Herdr target at
that worktree path using the exact 0.7.4 help for the available pane/agent command.

## Ownership map

Maintain a small durable map in bead notes or the repo's execution handoff:

| Owner | Bead | Branch/worktree | Allowed writes | Depends on | Herdr target | Status |
|---|---|---|---|---|---|---|
| `<name>` | `<id>` | `<branch>` / `<path>` | `<surface>` | `<ids>` | `<ids>` | `<state>` |

Do not let one agent modify another agent's worktree or resolve another branch's conflicts.
A task that grows across ownership boundaries must be stopped and split before continuing.

## Validate each branch

From a trusted checkout, inspect every writer result:

```bash
git -C <worktree> status --short
git -C <worktree> diff --check
git -C <repo> diff <base-ref>..<commit-sha> -- <owned-surface>
git -C <repo> show --stat --oneline <commit-sha>
```

When no commit is expected, inspect the complete worktree diff directly. Reject or correct
out-of-scope changes before integration. Re-run branch-local checks and inspect runtime
artifacts rather than accepting the writer's summary.

## Integrate once, in dependency order

Use one main-agent integration owner. Apply provider/schema/contract changes before dependent
consumers, following the repo's documented merge or cherry-pick workflow. After each step,
rerun focused contract and regression checks in the combined tree. Individually green branches
can still conflict semantically.

If conflicts occur, freeze competing writers on the affected surface. Resolve once under the
integration owner, preserve both intended behaviors, validate the combined result, and record
follow-up work instead of hiding incomplete integration.

## Cleanup and rollback

Remove a task-created worktree only after its changes are committed or deliberately discarded,
integration and validation are complete, handoff is durable, and `git status` is clean. Use the
repository's normal `git worktree remove <path>` flow; never use `--force` on uncertain work.
Retain unsafe-to-remove worktrees and report path, branch, base, status, target IDs, and next step.
Delete branches only when policy permits and the integrated result is durable and recoverable.
