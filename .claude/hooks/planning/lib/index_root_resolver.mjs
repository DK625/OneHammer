import { execFile } from "node:child_process";
import { access, readFile, realpath, stat } from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { promisify } from "node:util";
import { stateFilePath, writeActiveTargetRoot } from "./state.mjs";

const execFileAsync = promisify(execFile);

export const INDEX_ROOT_SOURCE_VALUES = Object.freeze([
  "explicit_target_root",
  "source_path_nearest_git_root",
  "source_path_nearest_serena_root",
  "source_path_my_build_feature_fallback",
  "phase0_project_index_root",
  "resume_source_nearest_git_root",
  "resume_source_nearest_serena_root",
  "resume_source_my_build_feature_fallback",
  "state_source_nearest_git_root",
  "state_source_nearest_serena_root",
  "state_source_my_build_feature_fallback",
  "pwd_nearest_git_root",
  "pwd_nearest_serena_root",
  "pwd_my_build_feature_fallback",
]);

const ROOT_SOURCE_SET = new Set(INDEX_ROOT_SOURCE_VALUES);

export class IndexRootResolutionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "IndexRootResolutionError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new IndexRootResolutionError(code, message, details);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function canonicalizeExistingPath(rawPath, options = {}) {
  const { directory = false, label = "path" } = options;
  if (typeof rawPath !== "string" || rawPath.trim() === "") {
    fail("EMPTY_PATH", `${label} is empty.`);
  }

  const absolute = resolve(rawPath.trim());
  let canonical;
  try {
    canonical = await realpath(absolute);
  } catch {
    fail("PATH_NOT_FOUND", `${label} does not exist: ${absolute}`, { path: absolute });
  }

  let info;
  try {
    info = await stat(canonical);
  } catch {
    fail("PATH_NOT_FOUND", `${label} does not exist: ${canonical}`, { path: canonical });
  }

  if (directory && !info.isDirectory()) {
    fail("NOT_A_DIRECTORY", `${label} must be a directory: ${canonical}`, { path: canonical });
  }

  return { path: canonical, stat: info };
}

function unique(values) {
  return [...new Set(values)];
}

function isWithin(child, parent) {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
}

async function resolveExistingIntentPath(rawPath, { pwd, controlRoot, directory = false, label }) {
  if (typeof rawPath !== "string" || rawPath.trim() === "") {
    fail("EMPTY_PATH", `${label} is empty.`);
  }

  const trimmed = rawPath.trim();
  if (isAbsolute(trimmed)) {
    return canonicalizeExistingPath(trimmed, { directory, label });
  }

  const bases = unique([pwd, controlRoot]);
  const observed = [];
  for (const base of bases) {
    const candidate = resolve(base, trimmed);
    if (!(await exists(candidate))) continue;
    const canonical = await canonicalizeExistingPath(candidate, { directory, label });
    observed.push({ base, candidate, canonical: canonical.path, stat: canonical.stat });
  }

  if (observed.length === 0) {
    fail(
      "RELATIVE_PATH_NOT_FOUND",
      `${label} '${trimmed}' does not exist under pwd or control root.`,
      { raw_path: trimmed, bases },
    );
  }

  const canonicalPaths = unique(observed.map((item) => item.canonical));
  if (canonicalPaths.length > 1) {
    fail(
      "AMBIGUOUS_RELATIVE_PATH",
      `${label} '${trimmed}' resolves to different existing paths under pwd and control root; supply an explicit absolute path.`,
      { raw_path: trimmed, candidates: observed },
    );
  }

  return { path: observed[0].canonical, stat: observed[0].stat };
}

async function nearestGitRoot(anchorDir) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", anchorDir, "rev-parse", "--show-toplevel"],
      { encoding: "utf8", maxBuffer: 1024 * 1024 },
    );
    const raw = String(stdout || "").trim();
    if (!raw) return null;
    const canonical = await canonicalizeExistingPath(raw, { directory: true, label: "Git root" });
    if (!isWithin(anchorDir, canonical.path)) return null;
    return canonical.path;
  } catch {
    return null;
  }
}

async function nearestSerenaRoot(anchorDir) {
  let current = anchorDir;
  while (true) {
    if (await exists(join(current, ".serena", "project.yml"))) {
      return (await canonicalizeExistingPath(current, { directory: true, label: "Serena root" })).path;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function myBuildFeatureFallback(anchorPath, anchorStat) {
  if (!anchorStat.isFile()) return null;
  if (!anchorPath.toLowerCase().endsWith(".md")) return null;

  const featureDir = dirname(anchorPath);
  if (featureDir.split(sep).pop() !== "features") return null;
  const myBuildDir = dirname(featureDir);
  if (myBuildDir.split(sep).pop() !== "my_build") return null;
  return dirname(myBuildDir);
}

export async function resolveBoundaryFromAnchor(rawAnchorPath, options = {}) {
  const {
    pwd = process.cwd(),
    controlRoot,
    sourcePrefix = "source_path",
    label = "source path",
  } = options;

  if (!controlRoot) fail("MISSING_CONTROL_ROOT", "control root is required to resolve an anchor path.");
  const canonicalControl = (await canonicalizeExistingPath(controlRoot, { directory: true, label: "control root" })).path;
  const canonicalPwd = (await canonicalizeExistingPath(pwd, { directory: true, label: "pwd" })).path;
  const anchor = await resolveExistingIntentPath(rawAnchorPath, {
    pwd: canonicalPwd,
    controlRoot: canonicalControl,
    directory: false,
    label,
  });
  const anchorDir = anchor.stat.isDirectory() ? anchor.path : dirname(anchor.path);

  const gitRoot = await nearestGitRoot(anchorDir);
  if (gitRoot) {
    return {
      target_root: gitRoot,
      anchor_path: anchor.path,
      root_source: `${sourcePrefix}_nearest_git_root`,
    };
  }

  const serenaRoot = await nearestSerenaRoot(anchorDir);
  if (serenaRoot) {
    return {
      target_root: serenaRoot,
      anchor_path: anchor.path,
      root_source: `${sourcePrefix}_nearest_serena_root`,
    };
  }

  const fallback = myBuildFeatureFallback(anchor.path, anchor.stat);
  if (fallback) {
    const canonicalFallback = await canonicalizeExistingPath(fallback, {
      directory: true,
      label: "my_build feature fallback root",
    });
    return {
      target_root: canonicalFallback.path,
      anchor_path: anchor.path,
      root_source: `${sourcePrefix}_my_build_feature_fallback`,
    };
  }

  fail(
    "NO_SAFE_REPO_BOUNDARY",
    `No safe Git root, Serena root, or exact <repo>/my_build/features/<file>.md fallback exists for ${anchor.path}.`,
    { anchor_path: anchor.path },
  );
}

async function resolveExplicitTargets(rawTargets, context) {
  const resolved = [];
  for (const raw of rawTargets) {
    const item = await resolveExistingIntentPath(raw, {
      ...context,
      directory: true,
      label: "explicit target root",
    });
    resolved.push(item.path);
  }
  const roots = unique(resolved);
  if (roots.length > 1) {
    fail(
      "AMBIGUOUS_EXPLICIT_TARGETS",
      "Multiple explicit target roots resolve to different directories; supply exactly one target root.",
      { candidates: roots },
    );
  }
  return roots[0] || null;
}

async function resolveSources(rawSources, context, sourcePrefix, label) {
  const resolved = [];
  for (const raw of rawSources) {
    resolved.push(await resolveBoundaryFromAnchor(raw, { ...context, sourcePrefix, label }));
  }
  const roots = unique(resolved.map((item) => item.target_root));
  if (roots.length > 1) {
    fail(
      "AMBIGUOUS_SOURCE_REPOS",
      `${label} values resolve to different repository roots; supply an explicit target root.`,
      { candidates: resolved },
    );
  }
  return resolved[0] || null;
}

function phaseTimestamp(entry) {
  const value = Date.parse(entry?.timestamp || "");
  return Number.isFinite(value) ? value : -1;
}

export function newestStateRequirementSource(state) {
  if (!state || typeof state !== "object") return null;

  const candidates = [];
  if (typeof state.requirement_source_path === "string" && state.requirement_source_path.trim()) {
    candidates.push({ path: state.requirement_source_path.trim(), timestamp: Number.MAX_SAFE_INTEGER, order: 0 });
  }

  const outputs = state.phase_outputs && typeof state.phase_outputs === "object"
    ? state.phase_outputs
    : {};
  let order = 1;
  for (const entry of Object.values(outputs)) {
    if (!entry || typeof entry !== "object") continue;
    const timestamp = phaseTimestamp(entry);
    if (typeof entry.requirement_source_path === "string" && entry.requirement_source_path.trim()) {
      candidates.push({ path: entry.requirement_source_path.trim(), timestamp, order: order++ });
    }
    if (Array.isArray(entry.requirement_source_paths)) {
      for (const raw of entry.requirement_source_paths) {
        if (typeof raw === "string" && raw.trim()) {
          candidates.push({ path: raw.trim(), timestamp, order: order++ });
        }
      }
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (a.timestamp - b.timestamp) || (a.order - b.order));
  return candidates[candidates.length - 1].path;
}

async function readJsonIfExists(path) {
  if (!(await exists(path))) return null;
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    fail("INVALID_STATE_JSON", `Cannot parse planning state JSON at ${path}: ${error.message}`, { path });
  }
}

async function canonicalStoredTarget(raw, context, label) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  return (await resolveExistingIntentPath(raw, {
    ...context,
    directory: true,
    label,
  })).path;
}

function conflict(code, message, details) {
  fail(code, `${message} Supply an explicit --target-root absolute path.`, details);
}

export async function resolveIndexRoot(options = {}) {
  const result = await resolveIndexRootWithoutPointer(options);
  // Successful resolution publishes CONTROL_ROOT/.planning/state/active-target-root
  // so every later state read/write (hooks, index.sh, job records) resolves the
  // authoritative planning state under the target repo's .planning/state/.
  if (result?.ok && result.control_root && result.target_root) {
    writeActiveTargetRoot(result.control_root, result.target_root);
  }
  return result;
}

async function resolveIndexRootWithoutPointer(options = {}) {
  const scriptControlRoot = options.controlRoot;
  if (!scriptControlRoot) fail("MISSING_CONTROL_ROOT", "control root is required.");

  const controlRoot = (await canonicalizeExistingPath(scriptControlRoot, {
    directory: true,
    label: "control root",
  })).path;
  const pwd = (await canonicalizeExistingPath(options.pwd || process.cwd(), {
    directory: true,
    label: "pwd",
  })).path;
  const context = { pwd, controlRoot };

  const explicitTargets = Array.isArray(options.explicitTargetRoots)
    ? options.explicitTargetRoots.filter(Boolean)
    : [];
  const explicitSources = Array.isArray(options.sourcePaths)
    ? options.sourcePaths.filter(Boolean)
    : [];

  // Current-request intent has highest precedence. Resolve it before touching
  // lower-priority stored state so an explicit target can repair stale history.
  const explicitTarget = await resolveExplicitTargets(explicitTargets, context);
  const explicitSource = await resolveSources(explicitSources, context, "source_path", "explicit source path");

  if (explicitTarget) {
    if (explicitSource && explicitSource.target_root !== explicitTarget) {
      conflict(
        "EXPLICIT_TARGET_SOURCE_CONFLICT",
        "Explicit target root conflicts with explicit source path.",
        { explicit_target_root: explicitTarget, explicit_source: explicitSource },
      );
    }
    return {
      ok: true,
      control_root: controlRoot,
      target_root: explicitTarget,
      anchor_path: explicitSource?.anchor_path || explicitTarget,
      root_source: "explicit_target_root",
    };
  }

  // Follows the active-target-root pointer, so a resumed session reads the state
  // that lives under the previously selected target repo's .planning/state/.
  const statePath = options.statePath || stateFilePath(controlRoot);
  const state = options.state === undefined ? await readJsonIfExists(statePath) : options.state;
  const phase0StoredRaw = state?.phase_outputs?.["0"]?.project_index_root;

  let phase0Stored = null;
  if (phase0StoredRaw) {
    phase0Stored = await canonicalStoredTarget(phase0StoredRaw, context, "stored phase_outputs.0.project_index_root");
  }

  if (explicitSource) {
    if (phase0Stored && explicitSource.target_root !== phase0Stored) {
      conflict(
        "PROMPT_SOURCE_PHASE0_CONFLICT",
        "Current explicit source path conflicts with prior phase_outputs.0.project_index_root.",
        { explicit_source: explicitSource, stored_project_index_root: phase0Stored },
      );
    }
    return {
      ok: true,
      control_root: controlRoot,
      ...explicitSource,
    };
  }

  const resumeSourceRaw = state?.resume_context?.requirement_source_path;
  const stateSourceRaw = newestStateRequirementSource(state);

  let resumeSource = null;
  if (resumeSourceRaw) {
    resumeSource = await resolveSources([resumeSourceRaw], context, "resume_source", "resume requirement source path");
  }

  let stateSource = null;
  if (stateSourceRaw) {
    stateSource = await resolveSources([stateSourceRaw], context, "state_source", "state requirement source path");
  }

  if (phase0Stored) {
    const conflictingSources = [resumeSource, stateSource]
      .filter(Boolean)
      .filter((item) => item.target_root !== phase0Stored);
    if (conflictingSources.length > 0) {
      conflict(
        "STORED_ROOT_SOURCE_CONFLICT",
        "Stored phase_outputs.0.project_index_root conflicts with stored source provenance.",
        { stored_project_index_root: phase0Stored, conflicting_sources: conflictingSources },
      );
    }
    if (phase0Stored === controlRoot && !resumeSource && !stateSource) {
      conflict(
        "BROAD_CONTROL_ROOT_ONLY",
        "Only the broad control root is available from prior Phase 0 state; refusing parent-root fallback.",
        { control_root: controlRoot },
      );
    }
    return {
      ok: true,
      control_root: controlRoot,
      target_root: phase0Stored,
      anchor_path: resumeSource?.anchor_path || stateSource?.anchor_path || phase0Stored,
      root_source: "phase0_project_index_root",
    };
  }

  if (resumeSource) {
    if (stateSource && stateSource.target_root !== resumeSource.target_root) {
      conflict(
        "RESUME_STATE_SOURCE_CONFLICT",
        "resume_context.requirement_source_path conflicts with current/newest state requirement source.",
        { resume_source: resumeSource, state_source: stateSource },
      );
    }
    return { ok: true, control_root: controlRoot, ...resumeSource };
  }

  if (stateSource) return { ok: true, control_root: controlRoot, ...stateSource };

  if (options.allowPwdFallback === false) {
    fail("NO_TARGET_SIGNAL", "No safe target root signal is available and pwd fallback is disabled.");
  }

  let pwdBoundary;
  try {
    pwdBoundary = await resolveBoundaryFromAnchor(pwd, {
      pwd,
      controlRoot,
      sourcePrefix: "pwd",
      label: "pwd fallback",
    });
  } catch (error) {
    if (error instanceof IndexRootResolutionError) {
      fail(
        "NO_TARGET_SIGNAL",
        "No explicit/stored source identifies a target repository and pwd does not resolve to a safe repository boundary.",
        { pwd, cause: { code: error.code, message: error.message, details: error.details } },
      );
    }
    throw error;
  }

  if (pwdBoundary.target_root === controlRoot) {
    conflict(
      "BROAD_CONTROL_ROOT_ONLY",
      "pwd resolves only to the broad control root; refusing parent-root fallback.",
      { pwd, control_root: controlRoot, pwd_boundary: pwdBoundary },
    );
  }

  return { ok: true, control_root: controlRoot, ...pwdBoundary };
}

export async function validateRecordedIndexResolution(record, options = {}) {
  const controlRoot = (await canonicalizeExistingPath(options.controlRoot, {
    directory: true,
    label: "validator control root",
  })).path;

  if (!record || typeof record !== "object") {
    return { ok: false, error: "Phase 0 project index evidence is missing." };
  }

  const absoluteEvidenceFields = [
    "project_index_root",
    "project_index_control_root",
    "project_index_anchor_path",
  ];
  const nonAbsolute = absoluteEvidenceFields.filter(
    (field) => typeof record[field] !== "string" || !isAbsolute(record[field].trim()),
  );
  if (nonAbsolute.length > 0) {
    return {
      ok: false,
      error: `project index path evidence must be absolute: ${nonAbsolute.join(", ")}.`,
    };
  }

  const rootSource = String(record.project_index_root_source || "").trim();
  if (!ROOT_SOURCE_SET.has(rootSource)) {
    return {
      ok: false,
      error: `project_index_root_source must be one of: ${INDEX_ROOT_SOURCE_VALUES.join(", ")}.`,
    };
  }

  try {
    const recordedControl = await canonicalizeExistingPath(record.project_index_control_root, {
      directory: true,
      label: "project_index_control_root",
    });
    if (recordedControl.path !== controlRoot) {
      return {
        ok: false,
        error: `project_index_control_root=${recordedControl.path} does not match current control root ${controlRoot}.`,
      };
    }
    if (recordedControl.path !== resolve(String(record.project_index_control_root))) {
      return {
        ok: false,
        error: `project_index_control_root must be canonical/physical; recorded=${record.project_index_control_root}, canonical=${recordedControl.path}.`,
      };
    }

    const target = await canonicalizeExistingPath(record.project_index_root, {
      directory: true,
      label: "project_index_root",
    });
    if (target.path !== resolve(String(record.project_index_root))) {
      return {
        ok: false,
        error: `project_index_root must be canonical/physical; recorded=${record.project_index_root}, canonical=${target.path}.`,
      };
    }

    const anchor = await canonicalizeExistingPath(record.project_index_anchor_path, {
      directory: false,
      label: "project_index_anchor_path",
    });
    if (anchor.path !== resolve(String(record.project_index_anchor_path))) {
      return {
        ok: false,
        error: `project_index_anchor_path must be canonical/physical; recorded=${record.project_index_anchor_path}, canonical=${anchor.path}.`,
      };
    }

    if (rootSource === "explicit_target_root" || rootSource === "phase0_project_index_root") {
      if (anchor.stat.isDirectory() && anchor.path === target.path) return { ok: true };
      const derived = await resolveBoundaryFromAnchor(anchor.path, {
        pwd: controlRoot,
        controlRoot,
        sourcePrefix: "source_path",
        label: `recorded ${rootSource} anchor`,
      });
      if (derived.target_root === target.path) return { ok: true };
      return {
        ok: false,
        error: `${rootSource} evidence requires anchor_path to be the exact target directory or a source anchor resolving to it.`,
      };
    }

    const prefix = rootSource.replace(/_(nearest_git_root|nearest_serena_root|my_build_feature_fallback)$/, "");
    const derived = await resolveBoundaryFromAnchor(anchor.path, {
      pwd: controlRoot,
      controlRoot,
      sourcePrefix: prefix,
      label: "recorded project index anchor",
    });
    if (derived.target_root !== target.path) {
      return {
        ok: false,
        error: `resolver-derived root ${derived.target_root} from anchor ${anchor.path} does not match project_index_root ${target.path}.`,
      };
    }
    if (derived.root_source !== rootSource) {
      return {
        ok: false,
        error: `resolver-derived root source ${derived.root_source} does not match project_index_root_source ${rootSource}.`,
      };
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof IndexRootResolutionError) {
      return { ok: false, error: `${error.code}: ${error.message}` };
    }
    throw error;
  }
}
