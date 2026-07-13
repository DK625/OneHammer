# Planning State File — Concurrency & Lockfile Spec

**Status:** DESIGN SPEC ONLY — not yet implemented. To be consumed by Step C+D of `planning_hook_improvement_analysis.md` when implementing `lib/state.mjs`.

## Problem

`.planning/state/planning-state-v2.json` (under `HISTORY_ROOT`, resolved through the `CONTROL_ROOT/.planning/state/active-target-root` pointer) is a single shared file. Multiple workflow actors may work in the same repository concurrently, so two state writers can clobber each other's transitions (for example, Phase 2 → 2.5 overwritten by another state update). Phase 1 lane agents are explicitly not state writers: they write only their own canonical lane Markdown files; the main agent owns state recording/verification.

## Lockfile Design

| Field | Value |
|-------|-------|
| Path | `.planning/state/planning-state-v2.lock` (next to the resolved state file) |
| Format | JSON: `{ "pid": <number>, "acquired_at": "<ISO-8601>", "session_id": "<string>" }` |
| TTL | 30 seconds (stale locks are treated as expired) |
| Ownership | Per-process via PID recorded in the lockfile |

## Acquire Protocol

1. **Atomic create:** `fs.writeFileSync(lockPath, JSON.stringify(payload), { flag: 'wx' })`. The `wx` flag fails if the file already exists — this is the atomic compare-and-swap primitive.
2. **If create fails with `EEXIST`:**
   - Read the existing lock.
   - If `Date.now() - Date.parse(acquired_at) > 30_000` (stale) OR the recorded `pid` is not running (`try { process.kill(pid, 0); } catch { /* dead */ }`), delete the stale lock and retry acquire once.
   - Otherwise, throw `STATE_LOCK_CONTENDED` with the holder's `pid` and `acquired_at` so the caller can back off.
3. **On acquire success:** register `process.on('exit', releaseLock)` and `process.on('SIGTERM'/'SIGINT', ...)` to guarantee release.

## Release Protocol

- On success: `fs.unlinkSync(lockPath)` — idempotent, ignore `ENOENT`.
- On crash: TTL expiry covers it; next acquirer will clean up.

## Write Pattern (atomic)

Even with the lock held, prefer write-temp-then-rename for durability:

```js
const tmp = statePath + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
fs.renameSync(tmp, statePath); // atomic on POSIX
```

## Caller Contract

All state mutations MUST go through `lib/state.mjs` helpers (`readState`, `withStateLock(fn)`). Direct `fs.writeFileSync` on the state file is forbidden in the guard — the lock is advisory and only works if every writer participates.

## Related Failure Modes

- **Double-lock by same PID:** not supported. Nested callers should reuse the outer `withStateLock` context.
- **Cross-session resume:** `session_id` is informational; TTL is the authoritative liveness signal.
- **Git merge conflict on state file:** out of scope for lockfile. Recommend documenting a conflict-resolution rule separately (e.g., newer `started_at` wins, or fail loud and require manual resolution).

---

# State File Concurrency

(Embedded here until a top-level `.claude/hooks/planning/README.md` is created by Step C+D. At that point, this section should be appended to the README under "State File Concurrency" and the rest of this file kept as the reference spec.)
