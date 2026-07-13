import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

import { IndexRootResolutionError, resolveIndexRoot } from "./index_root_resolver.mjs";
import { readState } from "./state.mjs";

const execFileAsync = promisify(execFile);
const SLASH_PLANNING_RE = /(?:^|\s)\/planning(?:\s|$)/i;

export function isSlashPlanningInvocation(prompt) {
  return SLASH_PLANNING_RE.test(String(prompt || ""));
}

function unique(values) {
  return [...new Set(values)];
}

export function extractPlanningPathCandidates(prompt) {
  const text = String(prompt || "");
  const found = [];

  for (const match of text.matchAll(/(["'])(.*?)\1/g)) {
    const value = String(match[2] || "").trim();
    if (value && (value.includes("/") || value.includes("\\") || /\.[A-Za-z0-9_-]+$/.test(value))) {
      found.push(value);
    }
  }

  for (const match of text.matchAll(/(?:^|\s)(\/(?!planning\b)[^\s"']+)/gi)) {
    const value = String(match[1] || "").replace(/[),.;:]+$/, "").trim();
    if (value) found.push(value);
  }

  return unique(found);
}

async function classifyCandidate(raw, { pwd, projectDir }) {
  const candidates = isAbsolute(raw)
    ? [raw]
    : unique([resolve(pwd, raw), resolve(projectDir, raw)]);

  const existing = [];
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      existing.push({ path: await realpath(candidate), info });
    } catch {
      // Ignore non-existing candidate bases; the resolver remains fail-closed.
    }
  }

  const canonical = unique(existing.map((item) => item.path));
  if (canonical.length === 0) return { kind: "unknown", raw };
  if (canonical.length > 1) return { kind: "ambiguous", raw, candidates: canonical };

  const item = existing.find((entry) => entry.path === canonical[0]);
  return {
    kind: item.info.isDirectory() ? "target" : "source",
    raw,
  };
}

export async function startEarlyIndexFromPrompt(options = {}) {
  const prompt = String(options.prompt || "");
  const projectDir = options.projectDir;
  const pwd = options.pwd || process.cwd();
  const env = options.env || process.env;

  if (!isSlashPlanningInvocation(prompt)) {
    return { status: "not_applicable", reason: "not_slash_planning" };
  }
  if (!projectDir) {
    return { status: "failed", stage: "resolve", error: "projectDir is required" };
  }

  const rawCandidates = extractPlanningPathCandidates(prompt);
  const explicitTargetRoots = [];
  const sourcePaths = [];

  for (const raw of rawCandidates) {
    const classified = await classifyCandidate(raw, { pwd, projectDir });
    if (classified.kind === "ambiguous") {
      return {
        status: "failed",
        stage: "resolve",
        error: `planning path '${raw}' resolves ambiguously; use an absolute path`,
      };
    }
    if (classified.kind === "target") explicitTargetRoots.push(raw);
    if (classified.kind === "source") sourcePaths.push(raw);
  }

  let resolution;
  try {
    resolution = await resolveIndexRoot({
      controlRoot: projectDir,
      pwd,
      explicitTargetRoots,
      sourcePaths,
      allowPwdFallback: false,
    });
  } catch (error) {
    if (error instanceof IndexRootResolutionError) {
      return {
        status: "not_started",
        stage: "resolve",
        error: `${error.code}: ${error.message}`,
      };
    }
    return { status: "failed", stage: "resolve", error: error.message };
  }

  // Resume guard: when the authoritative state already carries completed,
  // collected Phase 0 index evidence for THIS resolved target, do not queue a
  // fresh job. Re-queueing would flip project_index_job_id/project_index_waited
  // to a running job and retroactively invalidate completed Phase 0 evidence,
  // blocking every state write until the new job is waited/collected.
  try {
    const { state } = await readState(projectDir);
    const p0 = state?.phase_outputs?.["0"];
    const p0Status = String(p0?.status ?? "");
    const completed = p0Status === "completed" || p0Status === "passed";
    const sameTarget = String(p0?.project_index_root ?? "") === resolution.target_root;
    const evidenceCollected =
      p0?.project_index_ok === true &&
      (String(p0?.project_index_execution_mode ?? "") !== "background" || p0?.project_index_waited === true);
    if (completed && sameTarget && evidenceCollected) {
      return {
        status: "already_indexed",
        targetRoot: resolution.target_root,
        controlRoot: resolution.control_root,
        anchorPath: resolution.anchor_path,
        rootSource: resolution.root_source,
        jobId: typeof p0.project_index_job_id === "string" ? p0.project_index_job_id : null,
      };
    }
  } catch {
    // State unreadable — fall through to the normal fresh-index path.
  }

  const indexScriptPath = options.indexScriptPath || join(projectDir, ".claude", "hooks", "planning", "index.sh");
  try {
    const { stdout, stderr } = await execFileAsync(
      "bash",
      [indexScriptPath, "--target", resolution.target_root, "--background"],
      {
        cwd: projectDir,
        env,
        encoding: "utf8",
        timeout: options.startTimeoutMs || 8000,
        maxBuffer: 1024 * 1024,
      },
    );
    const jobId = String(stdout || "").trim().split(/\s+/).filter(Boolean).at(-1) || "";
    if (!/^[A-Za-z0-9._-]+$/.test(jobId)) {
      return {
        status: "failed",
        stage: "start",
        error: `index.sh returned an invalid job id: ${jobId || "<empty>"}`,
        stderr: String(stderr || "").trim(),
      };
    }
    return {
      status: "started",
      jobId,
      targetRoot: resolution.target_root,
      controlRoot: resolution.control_root,
      anchorPath: resolution.anchor_path,
      rootSource: resolution.root_source,
    };
  } catch (error) {
    return {
      status: "failed",
      stage: "start",
      error: error.message,
      stderr: String(error.stderr || "").trim(),
    };
  }
}
