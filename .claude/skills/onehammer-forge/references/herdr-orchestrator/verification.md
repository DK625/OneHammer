# Verification, handoff, integration, and reporting

Load this file before accepting, integrating, handing off, reporting, or cleaning up
Herdr-managed execution work.

## Evidence gate

Herdr state is a notification, not proof. Agent prose, a transcript, commit, screenshot,
or test claim is also insufficient until the main agent inspects the artifact and confirms
that it proves the bead's required behavior.

Collect at minimum:

- bead ID, owner, integration owner, dependencies, and assigned write surface;
- Herdr target IDs, transcript snapshot/location, cwd/worktree, branch, and base;
- changed-file list, full relevant diff, and `git diff --check` result;
- commands run with exit status and relevant output, not only prose;
- required API/DB/UI/runtime artifacts and an explanation of what each proves;
- blocker/risk list and confirmation that unrelated user changes were preserved.

## Independent review sequence

1. Read the final transcript and separate facts, inferences, and unsupported claims.
2. Inspect `git status`, branch/base, changed files, and complete relevant diff.
3. Compare changes with the bead, ownership map, and active repo instructions.
4. Check compatibility, failure paths, security, secrets, migrations, and generated files.
5. Run the smallest static checks that can falsify the change quickly.
6. Run targeted tests and the bead's required runtime/protocol/UI evidence.
7. Inspect every produced artifact and state exactly what it proves or does not prove.
8. Validate the integrated combined tree when changes came from parallel branches.
9. Update or close the bead only after its explicit evidence contract is satisfied.

Use documented repository commands. A missing or unavailable check is not a pass. Keep the
bead open/in-progress or create/link a follow-up bead when required proof cannot be obtained.

## Acceptance and correction

Accept only work that is in scope, internally consistent, compatible with preserved contracts,
and supported by reproducible evidence. Request a narrow correction when recoverable. Reject
or retain for investigation when work includes destructive actions, hidden scope expansion,
unresolved conflicts, secrets, or unreproducible proof.

Never accept merely because Herdr reports completion, the agent says tests passed, a commit
exists, another reviewer found nothing, or a screenshot/log file exists without inspection.

## Safe integration

- Preserve the user's dirty checkout and unrelated edits.
- Integrate only reviewed commits/files from the intended bead and owner.
- Apply dependency providers before consumers and validate the combined behavior.
- Preserve legacy aliases and protocol values unless an approved migration supersedes them.
- Never copy a whole worktree or archive over the live repository.
- Do not push or release unless explicitly authorized.

## Durable completion or paused handoff

A completed bead close reason must identify changed files, validation commands/results,
required runtime proof, compatibility decisions, and remaining risks. A paused bead must stay
open and record owner, target/worktree IDs, branch/base, current diff/commit, validation status,
blocker, exact next command or decision, and retained resources.

When a workflow defines a canonical handoff file, write that file directly and verify it. Herdr
transcripts supplement that handoff; they do not replace it. Run `br sync` only after bead state
and durable handoff content are consistent.

## Cleanup gate

Cleanup is allowed only after results are captured, accepted changes are durable, required checks
pass, bead/handoff state is updated, and no recovery value remains. Close or remove only resources
created for the task. Never force-remove dirty worktrees or stop the Herdr server. Retain and report
resources when validation, integration, or recovery is incomplete.

## Final report contract

Report outcome, exact files/commits integrated, agents and scoped assignments, validation results,
observed runtime proof, corrections/conflicts, bead state, handoff location, cleanup performed,
resources retained, unrelated dirty state left untouched, unrun checks, risks, and rollback path.
Never claim completion while required implementation, evidence, integration, or handoff is missing.
