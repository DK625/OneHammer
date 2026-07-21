# Agent lifecycle, transport, and recovery

Load this file before starting, messaging, waiting for, inspecting, resuming, or
replacing a Herdr-managed execution agent.

## Runtime inspection

The installed Herdr 0.7.4 CLI is the syntax authority. Before mutation:

```bash
command -v herdr
herdr --version
herdr status
herdr agent list
```

Use `herdr <group> --help` for the exact pane, agent, wait, transcript, or workspace
subcommand before invoking it. Check integration status only when that command is
present. No official integration is installed in the reviewed runtime, so process
and screen detection are advisory rather than completion authority.

`HERDR_ENV=1` identifies a Herdr-hosted shell but is not sufficient proof of protocol
health, ownership, or a safe target. Require a compatible client/server and an
explicit returned target ID. Never guess IDs, infer them from display order, or use
an unrelated current pane merely because it is visible.

## Start or reuse exactly one target

Prefer reusing a verified task-owned target. Otherwise create one named pane/session
at the exact checkout or worktree cwd without stealing focus. Capture every returned
workspace, tab, pane, terminal, agent, and native-session identifier that exists.
Confirm the actual cwd, branch, foreground process, and clean/expected repository
state before sending the task prompt.

Launch only the requested coding-agent executable. Do not silently add non-interactive
flags, auto-approval flags, prompts in argv, or environment changes. After the agent
UI is ready, send the complete prompt through the Herdr input/messaging command shown
by the installed help. Verify in the transcript that the full prompt arrived once.

## Observe efficiently

Inspect current state and recent transcript before waiting for a future event. Keep a
bounded transcript snapshot for handoff, but do not treat transcript prose as proof.
A Herdr state such as working, blocked, idle, done, or unknown is only a routing hint:

- active work: wait unless output proves looping, unsafe behavior, or scope drift;
- blocker: answer narrowly with a self-contained correction;
- apparent completion: read artifacts and begin independent verification;
- unknown or timeout: inspect process, pane, transcript, cwd, branch, and Git state.

Do not interrupt merely because progress is quiet. Do not launch a duplicate writer
because one wait timed out or a state detector lagged.

## Safe correction

Send corrections to the same explicit target. Include observed evidence, the precise
change requested, unchanged ownership, and the next validation proof. Stop the task
instead of broadening scope when the correction would cross another bead or writer's
surface.

## Retry and orphan handling

Retry is allowed only after the main agent establishes that the prior execution is
absent, failed, deliberately abandoned, or incapable of continuing. Before replacement:

1. capture the old target IDs and final transcript segment;
2. inspect its worktree and uncommitted/committed changes;
3. record the classification and recovery decision in the bead handoff;
4. preserve recoverable changes and avoid a second writer on the same worktree;
5. create a fresh target, and a fresh worktree when prior ownership is uncertain.

An `unknown` state alone is not an orphan. A dead pane alone is not proof that its
worktree is disposable. Never erase state to make a retry appear clean.

## Durable handoff

For pause, resume, or transfer, record in the bead and any repo-required handoff file:
owner, integration owner, target IDs, cwd/worktree, branch, base commit, changed files,
commit SHA if any, validation results, transcript location/snapshot, blocker, exact next
action, and resources intentionally retained. Canonical repository files remain the
handoff when a workflow names them; do not substitute background response bodies.

## Cleanup

Close only targets created for this task after output is captured, accepted changes are
durable, validation passes, bead/handoff state is updated, and no recovery value remains.
Never close the main pane, another user's pane, or an uncertain target. Never stop the
Herdr server as routine cleanup. Retain and report any target containing unintegrated
work, unresolved blockers, or useful diagnostics.
