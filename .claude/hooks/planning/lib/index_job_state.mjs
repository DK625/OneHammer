#!/usr/bin/env node

import { open, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { stateFilePath, withStateLock } from "./state.mjs";

const SAFE_JOB_ID_RE = /^[A-Za-z0-9._-]+$/;
const ACTIVE_STATUSES = new Set(["queued", "running"]);
const TERMINAL_STATUSES = new Set(["succeeded", "failed"]);
const MAX_LOG_TAIL_BYTES = 64 * 1024;
const MAX_LOG_TAIL_LINES = 120;
const POLL_MS = 100;

function fail(message, code = 1) {
  console.error(`[planning-index-state] ERROR: ${message}`);
  process.exit(code);
}

function nowIso() {
  return new Date().toISOString();
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2).replace(/-/g, "_");
    const next = argv[i + 1];
    if (next == null || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function requireString(args, key) {
  const value = String(args[key] ?? "").trim();
  if (!value) fail(`--${key.replace(/_/g, "-")} is required`);
  return value;
}

function requireJobId(args) {
  const jobId = requireString(args, "job");
  if (!SAFE_JOB_ID_RE.test(jobId)) fail(`invalid job id: ${jobId}`);
  return jobId;
}

function parsePid(value, label = "pid") {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) fail(`invalid ${label}: ${text || "<empty>"}`);
  const pid = Number(text);
  if (!Number.isSafeInteger(pid) || pid <= 0) fail(`invalid ${label}: ${text}`);
  return pid;
}

function parseExitCode(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) fail(`invalid exit code: ${text || "<empty>"}`);
  const exitCode = Number(text);
  if (!Number.isSafeInteger(exitCode) || exitCode < 0) fail(`invalid exit code: ${text}`);
  return exitCode;
}

function ensureStateShape(state) {
  const out = state && typeof state === "object" && !Array.isArray(state) ? state : {};
  if (!("schema_version" in out)) out.schema_version = "v2";
  if (!("feature" in out)) out.feature = "";
  if (!("current_phase" in out)) out.current_phase = "0";
  if (!Array.isArray(out.completed_phases)) out.completed_phases = [];
  if (typeof out.phase_plan_approved !== "boolean") out.phase_plan_approved = false;
  if (!("planning_active" in out)) out.planning_active = true;
  if (!out.phase_outputs || typeof out.phase_outputs !== "object" || Array.isArray(out.phase_outputs)) {
    out.phase_outputs = {};
  }
  if (!out.phase_outputs["0"] || typeof out.phase_outputs["0"] !== "object" || Array.isArray(out.phase_outputs["0"])) {
    out.phase_outputs["0"] = {};
  }
  const p0 = out.phase_outputs["0"];
  if (!p0.project_index_jobs || typeof p0.project_index_jobs !== "object" || Array.isArray(p0.project_index_jobs)) {
    p0.project_index_jobs = {};
  }
  return out;
}

async function loadState(controlRoot) {
  const path = stateFilePath(controlRoot);
  try {
    const raw = await readFile(path, "utf8");
    if (!raw.trim()) return ensureStateShape({});
    return ensureStateShape(JSON.parse(raw));
  } catch (error) {
    if (error?.code === "ENOENT") return ensureStateShape({});
    if (error instanceof SyntaxError) {
      throw new Error(`authoritative planning state is invalid JSON at ${path}: ${error.message}`);
    }
    throw error;
  }
}

async function writeStateAtomic(controlRoot, state) {
  const path = stateFilePath(controlRoot);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`;
  try {
    await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tmp, path);
  } finally {
    await unlink(tmp).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

async function mutateState(controlRoot, mutator) {
  await mkdir(dirname(stateFilePath(controlRoot)), { recursive: true });
  return withStateLock(controlRoot, async () => {
    const state = await loadState(controlRoot);
    const result = await mutator(state, state.phase_outputs["0"]);
    await writeStateAtomic(controlRoot, state);
    return result;
  });
}

async function readJob(controlRoot, jobId) {
  const state = await loadState(controlRoot);
  const record = state.phase_outputs?.["0"]?.project_index_jobs?.[jobId];
  return record && typeof record === "object" && !Array.isArray(record) ? record : null;
}

function isPidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function emitJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function readLogTail(path) {
  if (!path) return "";
  let handle;
  try {
    handle = await open(path, "r");
    const stat = await handle.stat();
    const length = Math.min(stat.size, MAX_LOG_TAIL_BYTES);
    if (length <= 0) return "";
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, stat.size - length);
    const text = buffer.toString("utf8");
    return text.split(/\r?\n/).slice(-MAX_LOG_TAIL_LINES).join("\n").trim();
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function commandQueue(controlRoot, args) {
  const jobId = requireJobId(args);
  const targetRoot = requireString(args, "target");
  const pid = parsePid(args.pid, "launcher pid");
  const queuedAt = nowIso();
  await mutateState(controlRoot, async (_state, p0) => {
    p0.project_index_execution_mode = "background";
    p0.project_index_job_id = jobId;
    p0.project_index_waited = false;
    p0.project_index_jobs[jobId] = {
      job_id: jobId,
      status: "queued",
      pid,
      queued_at: queuedAt,
      target_root: targetRoot,
    };
  });
}

async function commandSetPid(controlRoot, args) {
  const jobId = requireJobId(args);
  const pid = parsePid(args.pid);
  await mutateState(controlRoot, async (_state, p0) => {
    const record = p0.project_index_jobs[jobId];
    if (!record) throw new Error(`unknown index job: ${jobId}`);
    record.pid = pid;
  });
}

async function commandStart(controlRoot, args) {
  const jobId = requireJobId(args);
  const pid = parsePid(args.pid);
  await mutateState(controlRoot, async (_state, p0) => {
    const record = p0.project_index_jobs[jobId];
    if (!record) throw new Error(`unknown index job: ${jobId}`);
    if (TERMINAL_STATUSES.has(String(record.status || ""))) {
      throw new Error(`cannot start terminal index job: ${jobId}`);
    }
    record.pid = pid;
    record.status = "running";
    record.started_at ||= nowIso();
  });
}

async function commandFinish(controlRoot, args) {
  const jobId = requireJobId(args);
  const exitCode = parseExitCode(args.exit_code);
  const logTail = exitCode === 0 ? "" : await readLogTail(String(args.log_file ?? "").trim());
  await mutateState(controlRoot, async (_state, p0) => {
    const record = p0.project_index_jobs[jobId];
    if (!record) throw new Error(`unknown index job: ${jobId}`);
    record.status = exitCode === 0 ? "succeeded" : "failed";
    record.finished_at = nowIso();
    record.exit_code = exitCode;
    if (logTail) record.log_tail = logTail;
    else delete record.log_tail;
  });
}

async function commandFindActive(controlRoot, args) {
  const targetRoot = requireString(args, "target");
  const state = await loadState(controlRoot);
  const jobs = state.phase_outputs?.["0"]?.project_index_jobs;
  if (!jobs || typeof jobs !== "object") return;

  const records = Object.entries(jobs)
    .filter(([jobId, record]) => SAFE_JOB_ID_RE.test(jobId) && record && typeof record === "object")
    .filter(([, record]) => record.target_root === targetRoot && ACTIVE_STATUSES.has(String(record.status || "")))
    .sort((a, b) => String(b[1].queued_at || "").localeCompare(String(a[1].queued_at || "")));

  for (const [jobId, record] of records) {
    const pid = Number(record.pid);
    if (isPidAlive(pid)) {
      process.stdout.write(`${jobId}\n`);
      return;
    }
  }
}

async function markCollected(controlRoot, jobId) {
  return mutateState(controlRoot, async (_state, p0) => {
    const record = p0.project_index_jobs[jobId];
    if (!record) throw new Error(`unknown index job: ${jobId}`);
    record.collected_at ||= nowIso();
    p0.project_index_job_id = jobId;
    p0.project_index_waited = Number(record.exit_code) === 0 && record.status === "succeeded";
    return { ...record };
  });
}

async function commandProbe(controlRoot, args, waitMode) {
  const jobId = requireJobId(args);
  while (true) {
    let record = await readJob(controlRoot, jobId);
    if (!record) fail(`unknown index job: ${jobId}`);

    const status = String(record.status || "");
    const exitCode = record.exit_code;
    if (TERMINAL_STATUSES.has(status) || exitCode !== undefined) {
      if (!TERMINAL_STATUSES.has(status)) {
        fail(`invalid terminal state for job_id=${jobId}: status=${status || "<empty>"} exit_code=${exitCode}`);
      }
      if (!Number.isSafeInteger(exitCode) || exitCode < 0) {
        fail(`invalid exit code for job_id=${jobId}: ${String(exitCode)}`);
      }
      if (waitMode === "wait") record = await markCollected(controlRoot, jobId);
      emitJson(record);
      return;
    }

    if (!ACTIVE_STATUSES.has(status)) {
      fail(`invalid non-terminal status for job_id=${jobId}: ${status || "<empty>"}`);
    }

    const pid = Number(record.pid);
    if (!isPidAlive(pid)) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      record = await readJob(controlRoot, jobId);
      const refreshedStatus = String(record?.status || "");
      if (record && TERMINAL_STATUSES.has(refreshedStatus) && Number.isSafeInteger(record.exit_code)) {
        if (waitMode === "wait") record = await markCollected(controlRoot, jobId);
        emitJson(record);
        return;
      }
      fail(`background index process disappeared before publishing terminal state: job_id=${jobId} pid=${Number.isFinite(pid) ? pid : "<invalid>"}`);
    }

    if (waitMode === "status") {
      emitJson(record);
      process.exit(3);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const controlRoot = requireString(args, "control_root");

  switch (command) {
    case "queue":
      await commandQueue(controlRoot, args);
      return;
    case "set-pid":
      await commandSetPid(controlRoot, args);
      return;
    case "start":
      await commandStart(controlRoot, args);
      return;
    case "finish":
      await commandFinish(controlRoot, args);
      return;
    case "find-active":
      await commandFindActive(controlRoot, args);
      return;
    case "wait":
      await commandProbe(controlRoot, args, "wait");
      return;
    case "status":
      await commandProbe(controlRoot, args, "status");
      return;
    case "read": {
      const record = await readJob(controlRoot, requireJobId(args));
      if (!record) fail(`unknown index job: ${args.job}`);
      emitJson(record);
      return;
    }
    default:
      fail(`unknown command: ${command || "<empty>"}`);
  }
}

main().catch((error) => fail(error?.message || String(error)));
