// state.mjs — Read + light structural validate for planning-state-v2.json.
// No ajv; we do manual structural check. If the schema is invalid we degrade gracefully
// (log warn, return null state) instead of blocking user work.
//
// This module also exposes the advisory lockfile helpers described in LOCKFILE_SPEC.md.
// Hooks currently read state only, but writers (e.g. a future skill-side helper or a
// test harness) MUST go through acquireLock/releaseLock to avoid concurrent clobbers
// when multiple agents work in the same repo.

import {
  readFile, writeFile, access, constants,
} from "node:fs/promises";
import {
  writeFileSync, readFileSync, unlinkSync, statSync, mkdirSync,
} from "node:fs";
import { join, dirname, isAbsolute, resolve } from "node:path";
import { warn, debug } from "./diagnostics.mjs";

const VALID_PHASES = new Set([
  "0", "1", "1.5", "1.6", "2", "2.5", "3", "4", "5", "6",
  // Handoff sentinel
  "handoff",
]);

// Legacy markers we refuse to gate on (leave user alone).
const LEGACY_PHASE_MARKERS = new Set(["4.5", "4.6"]);

// Lockfile constants (per LOCKFILE_SPEC.md).
const LOCK_TTL_MS = 30_000;
const LOCK_DEFAULT_TIMEOUT_MS = 5_000;
const LOCK_POLL_INTERVAL_MS = 50;

// The authoritative state lives under the SELECTED TARGET REPO's .planning/state/
// (same root as .planning/history/<feature>). Hooks run with projectDir=CONTROL_ROOT,
// which may differ from the target repo, so CONTROL_ROOT keeps a small pointer file
// (.planning/state/active-target-root) holding the absolute target root. Written by
// resolve_index_root.mjs / index.sh at target-resolution time. Without a valid
// pointer, state resolves under projectDir itself (no-target / control==target case).
const ACTIVE_TARGET_POINTER = "active-target-root";

export function activeTargetPointerPath(projectDir) {
  return join(projectDir, ".planning", "state", ACTIVE_TARGET_POINTER);
}

export function readActiveTargetRoot(projectDir) {
  try {
    const raw = readFileSync(activeTargetPointerPath(projectDir), "utf8").trim();
    if (!raw || !isAbsolute(raw)) return null;
    const canonical = resolve(raw);
    if (!statSync(canonical).isDirectory()) return null;
    return canonical;
  } catch {
    return null;
  }
}

export function writeActiveTargetRoot(projectDir, targetRoot) {
  const raw = String(targetRoot ?? "").trim();
  if (!raw || !isAbsolute(raw)) {
    throw new Error(`active target root must be an absolute path (got '${raw || "<empty>"}')`);
  }
  const p = activeTargetPointerPath(projectDir);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${resolve(raw)}\n`, "utf8");
}

export function planningStateRoot(projectDir) {
  return readActiveTargetRoot(projectDir) ?? resolve(projectDir);
}

export function stateFilePath(projectDir) {
  return join(planningStateRoot(projectDir), ".planning", "state", "planning-state-v2.json");
}

export function lockFilePath(projectDir) {
  return join(planningStateRoot(projectDir), ".planning", "state", "planning-state-v2.lock");
}

export async function fileExists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readState(projectDir) {
  const p = stateFilePath(projectDir);
  if (!(await fileExists(p))) {
    debug(`state file not present at ${p}`);
    return { state: null, legacy: false, missing: true };
  }
  let raw;
  try {
    raw = await readFile(p, "utf8");
  } catch (e) {
    warn(`failed to read state file: ${e.message}`);
    return { state: null, legacy: false, missing: false, readError: true };
  }
  if (!raw.trim()) return { state: null, legacy: false, missing: true };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    warn(`state file is not valid JSON: ${e.message}`);
    return { state: null, legacy: false, missing: false, invalid: true };
  }

  const legacy = detectLegacy(parsed);
  const valid = validateShape(parsed);
  if (!valid.ok) {
    warn(`state schema degraded: ${valid.issues.join("; ")}`);
    return { state: parsed, legacy, missing: false, invalid: true, issues: valid.issues };
  }
  // Strict schema validation (non-blocking warn only).
  const strict = validateAgainstSchema(parsed, projectDir);
  if (!strict.ok) {
    warn(`state strict schema warnings: ${strict.issues.join("; ")}`);
  }
  return { state: parsed, legacy, missing: false };
}

function detectLegacy(state) {
  if (!state || typeof state !== "object") return false;
  const cp = state.completed_phases;
  if (Array.isArray(cp) && cp.some((p) => LEGACY_PHASE_MARKERS.has(String(p)))) return true;
  if (typeof state.current_phase === "string" && LEGACY_PHASE_MARKERS.has(state.current_phase)) return true;
  if (state.phase_outputs && typeof state.phase_outputs === "object") {
    for (const k of Object.keys(state.phase_outputs)) {
      if (LEGACY_PHASE_MARKERS.has(k)) return true;
    }
  }
  return false;
}

function validateShape(state) {
  const issues = [];
  if (typeof state !== "object" || state === null) {
    return { ok: false, issues: ["state is not an object"] };
  }
  if (!("feature" in state)) issues.push("missing feature");
  if (!("current_phase" in state)) issues.push("missing current_phase");
  if (!("completed_phases" in state)) {
    issues.push("missing completed_phases");
  } else if (!Array.isArray(state.completed_phases)) {
    issues.push("completed_phases is not an array");
  }
  if (!("phase_outputs" in state) || typeof state.phase_outputs !== "object") {
    issues.push("missing phase_outputs object");
  }
  if (
    state.current_phase != null &&
    !VALID_PHASES.has(String(state.current_phase)) &&
    !LEGACY_PHASE_MARKERS.has(String(state.current_phase))
  ) {
    issues.push(`unknown current_phase '${state.current_phase}'`);
  }
  if ("phase_plan_approved" in state && typeof state.phase_plan_approved !== "boolean") {
    issues.push("phase_plan_approved must be boolean");
  }
  return { ok: issues.length === 0, issues };
}

// Strict structural check against state.schema.json. Hand-rolled (no ajv).
// Never blocks — only surfaces warnings via stderr.
let _cachedSchema = null;
let _cachedSchemaPath = null;
function loadSchema(projectDir) {
  const p = join(projectDir, ".claude", "hooks", "planning", "state.schema.json");
  if (_cachedSchema && _cachedSchemaPath === p) return _cachedSchema;
  try {
    const raw = readFileSync(p, "utf8");
    _cachedSchema = JSON.parse(raw);
    _cachedSchemaPath = p;
    return _cachedSchema;
  } catch (e) {
    debug(`strict schema load failed: ${e.message}`);
    return null;
  }
}

function validateAgainstSchema(state, projectDir) {
  const schema = loadSchema(projectDir);
  if (!schema) return { ok: true, issues: [] }; // can't validate — silent pass
  const issues = [];
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required) {
    if (!(key in state)) issues.push(`missing required field '${key}'`);
  }
  const props = schema.properties || {};
  // Check enum constraints for top-level primitive fields we care about.
  if (props.mode && Array.isArray(props.mode.enum) && state.mode != null) {
    if (!props.mode.enum.includes(state.mode)) {
      issues.push(`mode='${state.mode}' not in enum ${JSON.stringify(props.mode.enum)}`);
    }
  }
  return { ok: issues.length === 0, issues };
}

// planning_active = state exists, has a feature, not yet in handoff.
export function isPlanningActive(state) {
  if (!state) return false;
  if (state.planning_active === false) return false;
  if (!state.feature) return false;
  if (state.current_phase === "handoff") return false;
  return true;
}

// Lightweight mode — set by skill during Phase 0 pre-flight.
// Signaled either via top-level state.mode === "lightweight" OR
// phase_outputs."0".lightweight_mode === true.
export function isLightweightMode(state) {
  if (!state) return false;
  if (state.mode === "lightweight") return true;
  const p0 = state.phase_outputs?.["0"];
  return p0?.lightweight_mode === true;
}

export function currentPhaseNumeric(state) {
  if (!state || state.current_phase == null) return null;
  const raw = String(state.current_phase);
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function completedIncludes(state, phaseId) {
  if (!state || !Array.isArray(state.completed_phases)) return false;
  return state.completed_phases.map(String).includes(String(phaseId));
}

export function phaseOutput(state, phaseId) {
  if (!state || !state.phase_outputs) return null;
  return state.phase_outputs[phaseId] ?? null;
}

export function featurePath(state) {
  if (!state || !state.feature) return null;
  // Default convention per SKILL.md. This remains target-repo-relative.
  return `.planning/history/${state.feature}`;
}

// Both the authoritative state and human planning artifacts live under the selected
// target repository's .planning/ when Phase 0 has recorded one (or when the
// active-target-root pointer already names it). Before a target is selected (or for
// legacy/incomplete state), preserve the historical behavior: resolve .planning/
// artifacts from the normal project/control root.
export function historyRoot(state, projectDir) {
  const controlRoot = resolve(projectDir);
  const targetRoot = state?.phase_outputs?.["0"]?.project_index_root;
  if (typeof targetRoot !== "string" || !targetRoot.trim() || !isAbsolute(targetRoot.trim())) {
    return readActiveTargetRoot(projectDir) ?? controlRoot;
  }
  return resolve(targetRoot.trim());
}

export function isHistoryScopedPath(pathValue) {
  const raw = String(pathValue ?? "").trim();
  if (!raw || isAbsolute(raw)) return false;
  const normalized = raw.replace(/\\/g, "/").replace(/^\.\/+/, "");
  // Canonical: .planning/... (history/, state/). Legacy: bare history/... from
  // pre-relocation state files keeps resolving under the same target root.
  return normalized === ".planning" || normalized.startsWith(".planning/") ||
    normalized === "history" || normalized.startsWith("history/");
}

export function resolvePlanningPath(projectDir, state, pathValue) {
  const raw = String(pathValue ?? "").trim();
  if (!raw) return null;
  if (isAbsolute(raw)) return resolve(raw);
  if (!isHistoryScopedPath(raw)) return resolve(resolve(projectDir), raw);
  // Legacy `history/...` values from pre-relocation state files resolve to the
  // canonical physical location under .planning/history/.
  const normalized = raw.replace(/\\/g, "/").replace(/^\.\/+/, "")
    .replace(/^history(\/|$)/, ".planning/history$1");
  return resolve(historyRoot(state, projectDir), normalized);
}

export function featureWorkspacePath(projectDir, state) {
  const rel = featurePath(state);
  return rel ? resolvePlanningPath(projectDir, state, rel) : null;
}

// ---------------------------------------------------------------------------
// Lockfile — advisory, co-operative. Per LOCKFILE_SPEC.md.
// ---------------------------------------------------------------------------

let _ownedLockPath = null;

function _isPidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // ESRCH = no such process. EPERM = process exists but we can't signal (still alive).
    return e.code === "EPERM";
  }
}

function _tryReadLock(p) {
  try {
    const raw = readFileSync(p, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function _lockIsStale(lockObj, lockPath) {
  if (!lockObj) return true;
  const acquiredMs = Date.parse(lockObj.acquired_at);
  if (!Number.isFinite(acquiredMs)) return true;
  if (Date.now() - acquiredMs > LOCK_TTL_MS) return true;
  if (lockObj.pid && !_isPidAlive(lockObj.pid)) return true;
  // Also sanity-check: if the file is older than TTL on disk.
  try {
    const st = statSync(lockPath);
    if (Date.now() - st.mtimeMs > LOCK_TTL_MS) return true;
  } catch { /* ignore */ }
  return false;
}

/**
 * Acquire an advisory lock on the planning state file.
 *
 * @param {string} projectDir - project root (for locating .claude/state/)
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=5000] - max wait for stale-lock cleanup + retry
 * @param {string} [opts.sessionId] - informational session id recorded in the lock
 * @returns {Promise<{path: string, acquired_at: string, pid: number}>}
 * @throws Error with code STATE_LOCK_CONTENDED if a live lock holder is still active.
 */
export async function acquireLock(projectDir, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? LOCK_DEFAULT_TIMEOUT_MS;
  const sessionId = opts.sessionId ?? (process.env.CLAUDE_SESSION_ID || "");
  const p = lockFilePath(projectDir);
  const started = Date.now();

  while (true) {
    const payload = {
      pid: process.pid,
      acquired_at: new Date().toISOString(),
      session_id: sessionId,
    };
    try {
      writeFileSync(p, JSON.stringify(payload), { flag: "wx" });
      _ownedLockPath = p;
      _registerReleaseHooks();
      debug(`lock acquired: ${p} pid=${process.pid}`);
      return { path: p, ...payload };
    } catch (e) {
      if (e.code !== "EEXIST") {
        // Unexpected FS error (no such dir?). Surface but don't infinite-loop.
        throw e;
      }
      const existing = _tryReadLock(p);
      if (_lockIsStale(existing, p)) {
        debug(`stale lock detected (pid=${existing?.pid}, acquired_at=${existing?.acquired_at}), overriding`);
        try { unlinkSync(p); } catch { /* race with another cleaner */ }
        continue; // retry immediately
      }
      if (Date.now() - started >= timeoutMs) {
        const err = new Error(
          `STATE_LOCK_CONTENDED: held by pid=${existing?.pid} since ${existing?.acquired_at} ` +
          `(session_id=${existing?.session_id || "?"}). Timeout after ${timeoutMs}ms.`,
        );
        err.code = "STATE_LOCK_CONTENDED";
        err.holder = existing;
        throw err;
      }
      await new Promise((r) => setTimeout(r, LOCK_POLL_INTERVAL_MS));
    }
  }
}

/**
 * Release the advisory lock if we own it. Idempotent.
 */
export function releaseLock() {
  if (!_ownedLockPath) return;
  try {
    // Defensive: only unlink if we still own it (pid matches).
    const cur = _tryReadLock(_ownedLockPath);
    if (cur && cur.pid && cur.pid !== process.pid) {
      debug(`releaseLock: lock at ${_ownedLockPath} owned by different pid=${cur.pid}, skipping`);
    } else {
      unlinkSync(_ownedLockPath);
      debug(`lock released: ${_ownedLockPath}`);
    }
  } catch (e) {
    if (e.code !== "ENOENT") {
      warn(`releaseLock failed: ${e.message}`);
    }
  } finally {
    _ownedLockPath = null;
  }
}

let _releaseHooksRegistered = false;
function _registerReleaseHooks() {
  if (_releaseHooksRegistered) return;
  _releaseHooksRegistered = true;
  const off = () => { try { releaseLock(); } catch { /* ignore */ } };
  process.on("exit", off);
  process.on("SIGINT", () => { off(); process.exit(130); });
  process.on("SIGTERM", () => { off(); process.exit(143); });
  process.on("uncaughtException", (e) => {
    off();
    warn(`uncaughtException: ${e.stack || e.message}`);
    process.exit(1);
  });
}

/**
 * Run a function with the state lock held. Releases regardless of outcome.
 *
 * @param {string} projectDir
 * @param {() => (Promise<any>|any)} fn
 * @param {object} [opts]
 */
export async function withStateLock(projectDir, fn, opts = {}) {
  await acquireLock(projectDir, opts);
  try {
    return await fn();
  } finally {
    releaseLock();
  }
}
