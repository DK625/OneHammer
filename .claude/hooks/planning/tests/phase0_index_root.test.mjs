import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  IndexRootResolutionError,
  resolveIndexRoot,
} from "../lib/index_root_resolver.mjs";
import { extractPlanningPathCandidates, startEarlyIndexFromPrompt } from "../lib/early_index.mjs";
import { PHASE_SEQUENCE } from "../lib/phase_gates.mjs";
import { featureWorkspacePath, historyRoot, resolvePlanningPath } from "../lib/state.mjs";
import { validatePostToolUse } from "../validators/post_tool_use.mjs";
import { validatePreToolUse } from "../validators/pre_tool_use.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLANNING_DIR = resolve(HERE, "..");
const HOOKS_DIR = resolve(PLANNING_DIR, "..");
const GUARD = join(HOOKS_DIR, "planning_guard.mjs");
const INDEX_SCRIPT = join(PLANNING_DIR, "index.sh");

const cleanup = [];
test.after(async () => {
  await Promise.all(cleanup.map((path) => rm(path, { recursive: true, force: true })));
});

async function temp(prefix) {
  const path = await mkdtemp(join(tmpdir(), prefix));
  cleanup.push(path);
  return path;
}

async function mkdirp(path) {
  await mkdir(path, { recursive: true });
  return path;
}

function gitInit(path) {
  execFileSync("git", ["init", "-q", path]);
}

async function makeNestedFixture() {
  const sandbox = await temp("planning-root-");
  const control = await mkdirp(join(sandbox, "opt", "control-workspace"));
  const child = await mkdirp(join(control, "nested-service"));
  const source = join(child, "my_build", "features", "example-feature.md");
  await mkdirp(dirname(source));
  await writeFile(source, "# fixture\n");
  gitInit(control);
  gitInit(child);
  return {
    sandbox,
    control: await realpath(control),
    child: await realpath(child),
    source: await realpath(source),
  };
}

async function assertResolutionError(fn, code) {
  await assert.rejects(fn, (error) => {
    assert.ok(error instanceof IndexRootResolutionError);
    assert.equal(error.code, code);
    return true;
  });
}

test("nested feature source resolves child repo, not outer control root", async () => {
  const fixture = await makeNestedFixture();
  const result = await resolveIndexRoot({
    controlRoot: fixture.control,
    pwd: fixture.control,
    sourcePaths: [fixture.source],
  });
  assert.equal(result.target_root, fixture.child);
  assert.notEqual(result.target_root, fixture.control);
  assert.equal(result.anchor_path, fixture.source);
  assert.equal(result.root_source, "source_path_nearest_git_root");
});

test("relative nested-service/my_build/features/example-feature.md resolves child repo", async () => {
  const fixture = await makeNestedFixture();
  const result = await resolveIndexRoot({
    controlRoot: fixture.control,
    pwd: fixture.control,
    sourcePaths: ["nested-service/my_build/features/example-feature.md"],
  });
  assert.equal(result.target_root, fixture.child);
});

test("explicit target root resolves exact child directory", async () => {
  const fixture = await makeNestedFixture();
  const result = await resolveIndexRoot({
    controlRoot: fixture.control,
    pwd: fixture.control,
    explicitTargetRoots: [fixture.child],
  });
  assert.equal(result.target_root, fixture.child);
  assert.equal(result.root_source, "explicit_target_root");
});

test("missing explicit source path fails closed", async () => {
  const fixture = await makeNestedFixture();
  await assertResolutionError(
    () => resolveIndexRoot({
      controlRoot: fixture.control,
      pwd: fixture.control,
      sourcePaths: [join(fixture.control, "missing.md")],
    }),
    "PATH_NOT_FOUND",
  );
});

test("two explicit source paths resolving to different repos fail closed", async () => {
  const base = await temp("planning-two-repos-");
  const control = await mkdirp(join(base, "control"));
  const a = await mkdirp(join(control, "repo-a"));
  const b = await mkdirp(join(control, "repo-b"));
  gitInit(a);
  gitInit(b);
  const aSource = join(a, "req.md");
  const bSource = join(b, "req.md");
  await writeFile(aSource, "a\n");
  await writeFile(bSource, "b\n");

  await assertResolutionError(
    () => resolveIndexRoot({
      controlRoot: control,
      pwd: control,
      sourcePaths: [aSource, bSource],
    }),
    "AMBIGUOUS_SOURCE_REPOS",
  );
});

test("relative source existing under pwd and control root as different files is ambiguous", async () => {
  const base = await temp("planning-relative-ambiguity-");
  const control = await mkdirp(join(base, "control"));
  const pwd = await mkdirp(join(base, "cwd"));
  gitInit(control);
  gitInit(pwd);
  await mkdirp(join(control, "docs"));
  await mkdirp(join(pwd, "docs"));
  await writeFile(join(control, "docs", "req.md"), "control\n");
  await writeFile(join(pwd, "docs", "req.md"), "pwd\n");

  await assertResolutionError(
    () => resolveIndexRoot({
      controlRoot: control,
      pwd,
      sourcePaths: ["docs/req.md"],
    }),
    "AMBIGUOUS_RELATIVE_PATH",
  );
});

test("anchor inside inner Git repo chooses inner root instead of outer root", async () => {
  const fixture = await makeNestedFixture();
  const result = await resolveIndexRoot({
    controlRoot: fixture.control,
    pwd: fixture.control,
    sourcePaths: [fixture.source],
  });
  assert.equal(result.target_root, fixture.child);
});

test("JSON state requirement source resolves target without Markdown status mirror", async () => {
  const fixture = await makeNestedFixture();
  const result = await resolveIndexRoot({
    controlRoot: fixture.control,
    pwd: fixture.control,
    state: {
      feature: "example-feature",
      requirement_source_path: fixture.source,
      phase_outputs: {},
    },
    allowPwdFallback: false,
  });
  assert.equal(result.target_root, fixture.child);
  assert.equal(result.root_source, "state_source_nearest_git_root");
});

test("conflicting legacy Markdown status file is ignored in favor of JSON state", async () => {
  const fixture = await makeNestedFixture();
  const statusDir = join(fixture.control, "history", "example-feature");
  const outerSource = join(fixture.control, "outer-requirement.md");
  await mkdirp(statusDir);
  await writeFile(outerSource, "outer\n");
  await writeFile(
    join(statusDir, "PLANNING_STATUS.md"),
    `| Source request | ${outerSource} |\n`,
  );

  const result = await resolveIndexRoot({
    controlRoot: fixture.control,
    pwd: fixture.control,
    state: {
      feature: "example-feature",
      requirement_source_path: fixture.source,
      phase_outputs: {},
    },
    allowPwdFallback: false,
  });
  assert.equal(result.target_root, fixture.child);
  assert.equal(result.root_source, "state_source_nearest_git_root");
});

test("without Git, nearest .serena/project.yml root is selected", async () => {
  const base = await temp("planning-serena-");
  const control = await mkdirp(join(base, "control"));
  const repo = await mkdirp(join(control, "nested-service"));
  const source = join(repo, "docs", "req.md");
  await mkdirp(join(repo, ".serena"));
  await writeFile(join(repo, ".serena", "project.yml"), 'project_name: "nested-service"\n');
  await mkdirp(dirname(source));
  await writeFile(source, "req\n");

  const result = await resolveIndexRoot({ controlRoot: control, pwd: control, sourcePaths: [source] });
  assert.equal(result.target_root, await realpath(repo));
  assert.equal(result.root_source, "source_path_nearest_serena_root");
});

test("without Git or Serena, exact my_build/features markdown path uses repo fallback", async () => {
  const base = await temp("planning-mybuild-");
  const control = await mkdirp(join(base, "control"));
  const repo = await mkdirp(join(control, "nested-service"));
  const source = join(repo, "my_build", "features", "example-feature.md");
  await mkdirp(dirname(source));
  await writeFile(source, "req\n");

  const result = await resolveIndexRoot({ controlRoot: control, pwd: control, sourcePaths: [source] });
  assert.equal(result.target_root, await realpath(repo));
  assert.equal(result.root_source, "source_path_my_build_feature_fallback");
});

test("pwd-only broad control root fallback is rejected", async () => {
  const base = await temp("planning-broad-control-");
  const control = await mkdirp(join(base, "control"));
  gitInit(control);
  await assertResolutionError(
    () => resolveIndexRoot({ controlRoot: control, pwd: control }),
    "BROAD_CONTROL_ROOT_ONLY",
  );
});

async function makeFakeIndexers() {
  const base = await temp("planning-index-script-");
  const bin = await mkdirp(join(base, "bin"));
  const log = join(base, "calls.log");
  const uvx = join(bin, "uvx");
  const gitnexus = join(bin, "gitnexus");
  await writeFile(uvx, '#!/usr/bin/env bash\nprintf "uvx|%s|%s\\n" "$PWD" "$*" >> "$CALL_LOG"\nif [[ -n "${FAKE_UVX_SLEEP:-}" ]]; then sleep "$FAKE_UVX_SLEEP"; fi\nexit "${FAKE_UVX_EXIT:-0}"\n');
  await writeFile(gitnexus, '#!/usr/bin/env bash\nprintf "gitnexus|%s|%s\\n" "$PWD" "$*" >> "$CALL_LOG"\nif [[ -n "${FAKE_GITNEXUS_SLEEP:-}" ]]; then sleep "$FAKE_GITNEXUS_SLEEP"; fi\nexit "${FAKE_GITNEXUS_EXIT:-0}"\n');
  await chmod(uvx, 0o755);
  await chmod(gitnexus, 0o755);
  return { base, bin, log };
}

function runIndexScript(args, env, cwd) {
  return spawnSync("bash", [INDEX_SCRIPT, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

test("index.sh --target runs Serena then GitNexus from exact canonical target cwd", async () => {
  const fixture = await makeNestedFixture();
  const fake = await makeFakeIndexers();
  const result = runIndexScript(["--target", fixture.child], {
    PATH: `${fake.bin}:${process.env.PATH}`,
    CALL_LOG: fake.log,
  }, fixture.control);
  assert.equal(result.status, 0, result.stderr);

  const lines = (await readFile(fake.log, "utf8")).trim().split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], new RegExp(`^uvx\\|${fixture.child.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\|--from git\\+https://github\\.com/oraios/serena serena project index --log-level INFO$`));
  assert.equal(lines[1], `gitnexus|${fixture.child}|analyze`);
});

test("index.sh --target-root alias runs the same direct implementation", async () => {
  const fixture = await makeNestedFixture();
  const fake = await makeFakeIndexers();
  const result = runIndexScript(["--target-root", fixture.child], {
    PATH: `${fake.bin}:${process.env.PATH}`,
    CALL_LOG: fake.log,
  }, fixture.control);
  assert.equal(result.status, 0, result.stderr);

  const calls = await readFile(fake.log, "utf8");
  assert.ok(calls.includes(`uvx|${fixture.child}|`));
  assert.ok(calls.includes(`gitnexus|${fixture.child}|analyze`));
});

test("index.sh without explicit target fails before calling indexers", async () => {
  const fixture = await makeNestedFixture();
  const fake = await makeFakeIndexers();
  const result = runIndexScript([], {
    PATH: `${fake.bin}:${process.env.PATH}`,
    CALL_LOG: fake.log,
  }, fixture.control);
  assert.notEqual(result.status, 0);
  await assert.rejects(() => readFile(fake.log, "utf8"));
});

test("Serena failure prevents GitNexus call", async () => {
  const fixture = await makeNestedFixture();
  const fake = await makeFakeIndexers();
  const result = runIndexScript(["--target", fixture.child], {
    PATH: `${fake.bin}:${process.env.PATH}`,
    CALL_LOG: fake.log,
    FAKE_UVX_EXIT: "7",
  }, fixture.control);
  assert.notEqual(result.status, 0);
  const calls = await readFile(fake.log, "utf8");
  assert.ok(calls.includes("uvx|"));
  assert.ok(!calls.includes("gitnexus|"));
});

test("GitNexus failure exits non-zero", async () => {
  const fixture = await makeNestedFixture();
  const fake = await makeFakeIndexers();
  const result = runIndexScript(["--target", fixture.child], {
    PATH: `${fake.bin}:${process.env.PATH}`,
    CALL_LOG: fake.log,
    FAKE_GITNEXUS_EXIT: "9",
  }, fixture.control);
  assert.notEqual(result.status, 0);
  const calls = await readFile(fake.log, "utf8");
  assert.ok(calls.includes("uvx|"));
  assert.ok(calls.includes("gitnexus|"));
});

test("index.sh background job overlaps work, status reports running, then wait collects success from JSON state only", async () => {
  const fixture = await makeNestedFixture();
  const fake = await makeFakeIndexers();
  const env = {
    PATH: `${fake.bin}:${process.env.PATH}`,
    CALL_LOG: fake.log,
    PLANNING_CONTROL_ROOT: fixture.control,
    FAKE_UVX_SLEEP: "1",
  };

  const started = runIndexScript(["--target", fixture.child, "--background"], env, fixture.control);
  assert.equal(started.status, 0, started.stderr);
  const jobId = started.stdout.trim();
  assert.match(jobId, /^[A-Za-z0-9._-]+$/);

  const probed = runIndexScript(["--status", "--job", jobId], env, fixture.control);
  assert.equal(probed.status, 3, probed.stderr);
  assert.match(probed.stderr, /status=(queued|running)/i);

  // Simulate independent context work while the index process is running.
  await readFile(fixture.source, "utf8");

  const collected = runIndexScript(["--wait", "--job", jobId], env, fixture.control);
  assert.equal(collected.status, 0, collected.stderr);
  const calls = await readFile(fake.log, "utf8");
  assert.ok(calls.includes(`uvx|${fixture.child}|`));
  assert.ok(calls.includes(`gitnexus|${fixture.child}|analyze`));

  const state = JSON.parse(await readFile(join(fixture.child, ".planning", "state", "planning-state-v2.json"), "utf8"));
  const p0 = state.phase_outputs["0"];
  const record = p0.project_index_jobs[jobId];
  assert.equal(p0.project_index_job_id, jobId);
  assert.equal(p0.project_index_waited, true);
  assert.equal(record.status, "succeeded");
  assert.equal(record.exit_code, 0);
  assert.equal(record.target_root, fixture.child);
  assert.equal(typeof record.collected_at, "string");

  await assert.rejects(() => access(join(fixture.control, ".planning", "index-jobs")));
  for (const loose of ["pid", "status", "queued_at", "started_at", "finished_at", "target_root", "index.log", "exit_code"]) {
    await assert.rejects(() => access(join(fixture.control, ".planning", "index-jobs", jobId, loose)));
  }
});

test("index.sh background failure is fail-closed and stores failure evidence in JSON state only", async () => {
  const fixture = await makeNestedFixture();
  const fake = await makeFakeIndexers();
  const env = {
    PATH: `${fake.bin}:${process.env.PATH}`,
    CALL_LOG: fake.log,
    PLANNING_CONTROL_ROOT: fixture.control,
    FAKE_UVX_EXIT: "7",
  };

  const started = runIndexScript(["--target", fixture.child, "--background"], env, fixture.control);
  assert.equal(started.status, 0, started.stderr);
  const jobId = started.stdout.trim();
  const collected = runIndexScript(["--wait", "--job", jobId], env, fixture.control);
  assert.notEqual(collected.status, 0);
  assert.match(collected.stderr, /background index failed/i);
  const calls = await readFile(fake.log, "utf8");
  assert.ok(calls.includes("uvx|"));
  assert.ok(!calls.includes("gitnexus|"));

  const state = JSON.parse(await readFile(join(fixture.child, ".planning", "state", "planning-state-v2.json"), "utf8"));
  const record = state.phase_outputs["0"].project_index_jobs[jobId];
  assert.equal(record.status, "failed");
  assert.notEqual(record.exit_code, 0);
  assert.equal(record.target_root, fixture.child);
  assert.match(record.log_tail ?? "", /Serena indexing failed/i);
  await assert.rejects(() => access(join(fixture.control, ".planning", "index-jobs")));
});

test("early /planning prompt starts background index from explicit source path", async () => {
  const fixture = await makeNestedFixture();
  const fake = await makeFakeIndexers();
  const env = {
    ...process.env,
    PATH: `${fake.bin}:${process.env.PATH}`,
    CALL_LOG: fake.log,
    PLANNING_CONTROL_ROOT: fixture.control,
    FAKE_UVX_SLEEP: "0.2",
  };

  const result = await startEarlyIndexFromPrompt({
    prompt: `/planning cho '${fixture.source}'`,
    projectDir: fixture.control,
    pwd: fixture.control,
    env,
    indexScriptPath: INDEX_SCRIPT,
  });
  assert.equal(result.status, "started", JSON.stringify(result));
  assert.equal(result.targetRoot, fixture.child);
  assert.equal(result.anchorPath, fixture.source);

  const collected = runIndexScript(["--wait", "--job", result.jobId], env, fixture.control);
  assert.equal(collected.status, 0, collected.stderr);
});

test("planning path extraction ignores /planning command token and keeps explicit source", () => {
  const candidates = extractPlanningPathCandidates("/planning cho '/tmp/repo/my_build/features/example.md'");
  assert.deepEqual(candidates, ["/tmp/repo/my_build/features/example.md"]);
});

async function makeGuardFixture() {
  const fixture = await makeNestedFixture();
  await mkdirp(join(fixture.control, ".planning", "state"));
  await mkdirp(join(fixture.child, ".planning", "history", "example-feature"));
  await writeFile(join(fixture.control, ".mcp.json"), JSON.stringify({
    mcpServers: { serena: {}, exa: {}, gitnexus: {} },
  }));
  return fixture;
}

function validP0(fixture) {
  return {
    status: "completed",
    feature_path: ".planning/history/example-feature",
    mcp_json_checked: true,
    mcp_servers_verified: ["serena", "exa", "gitnexus"],
    serena_onboarding_checked: true,
    serena_ready: true,
    project_index_ran: true,
    project_index_ok: true,
    project_index_root: fixture.child,
    project_index_control_root: fixture.control,
    project_index_anchor_path: fixture.source,
    project_index_root_source: "source_path_nearest_git_root",
    serena_index_ok: true,
    gitnexus_index_ok: true,
    br_help_ok: true,
    bv_help_ok: true,
    jq_ok: true,
  };
}

async function writeState(fixture, p0) {
  const state = {
    feature: "example-feature",
    current_phase: "0",
    completed_phases: ["0"],
    phase_plan_approved: false,
    phase_outputs: { "0": p0 },
  };
  await writeFile(
    join(fixture.control, ".planning", "state", "planning-state-v2.json"),
    JSON.stringify(state, null, 2),
  );
}


function indexJobRecord(fixture, jobId, {
  exitCode,
  status = "running",
  targetRoot,
  collected = false,
} = {}) {
  const record = {
    job_id: jobId,
    status,
    pid: process.pid,
    queued_at: "2026-07-06T00:00:00Z",
    target_root: targetRoot || fixture.child,
  };
  if (status !== "queued") record.started_at = "2026-07-06T00:00:01Z";
  if (exitCode !== undefined) {
    record.exit_code = exitCode;
    record.finished_at = "2026-07-06T00:00:02Z";
  }
  if (collected) record.collected_at = "2026-07-06T00:00:03Z";
  return record;
}

function withIndexJob(p0, fixture, jobId, options = {}) {
  return {
    ...p0,
    project_index_jobs: {
      [jobId]: indexJobRecord(fixture, jobId, options),
    },
  };
}

test("Phase 0 background evidence ignores legacy loose job files when JSON metadata is missing", async () => {
  const fixture = await makeGuardFixture();
  const jobId = "job-legacy-loose-only";
  const legacyDir = await mkdirp(join(fixture.control, ".planning", "index-jobs", jobId));
  await writeFile(join(legacyDir, "target_root"), `${fixture.child}\n`);
  await writeFile(join(legacyDir, "status"), "succeeded\n");
  await writeFile(join(legacyDir, "exit_code"), "0\n");
  await writeState(fixture, {
    ...validP0(fixture),
    project_index_execution_mode: "background",
    project_index_job_id: jobId,
    project_index_waited: true,
  });

  const result = await validatePostToolUse({
    tool_name: "Write",
    tool_input: { file_path: ".planning/state/planning-state-v2.json" },
    tool_response: {},
  }, fixture.control);
  assert.equal(result?.decision, "block");
  assert.match(result?.reason ?? "", /project_index_jobs|authoritative metadata/i);
});

test("Phase 0 background evidence blocks while index job is still running", async () => {
  const fixture = await makeGuardFixture();
  const jobId = "job-running";
  await writeState(fixture, withIndexJob({
    ...validP0(fixture),
    project_index_execution_mode: "background",
    project_index_job_id: jobId,
    project_index_waited: true,
  }, fixture, jobId));
  const result = await validatePostToolUse({
    tool_name: "Write",
    tool_input: { file_path: ".planning/state/planning-state-v2.json" },
    tool_response: {},
  }, fixture.control);
  assert.equal(result?.decision, "block");
  assert.match(result?.reason ?? "", /still running|not published an exit code/i);
});

test("Phase 0 background evidence blocks an unwaited job even after exit_code=0", async () => {
  const fixture = await makeGuardFixture();
  const jobId = "job-unwaited";
  await writeState(fixture, withIndexJob({
    ...validP0(fixture),
    project_index_execution_mode: "background",
    project_index_job_id: jobId,
    project_index_waited: false,
  }, fixture, jobId, { exitCode: 0, status: "succeeded", collected: false }));
  const result = await validatePostToolUse({
    tool_name: "Write",
    tool_input: { file_path: ".planning/state/planning-state-v2.json" },
    tool_response: {},
  }, fixture.control);
  assert.equal(result?.decision, "block");
  assert.match(result?.reason ?? "", /not collected|--wait/i);
});

test("Phase 0 background evidence blocks a successful wrong-target job", async () => {
  const fixture = await makeGuardFixture();
  const jobId = "job-wrong-target";
  await writeState(fixture, withIndexJob({
    ...validP0(fixture),
    project_index_execution_mode: "background",
    project_index_job_id: jobId,
    project_index_waited: true,
  }, fixture, jobId, {
    exitCode: 0,
    status: "succeeded",
    targetRoot: fixture.control,
    collected: true,
  }));
  const result = await validatePostToolUse({
    tool_name: "Write",
    tool_input: { file_path: ".planning/state/planning-state-v2.json" },
    tool_response: {},
  }, fixture.control);
  assert.equal(result?.decision, "block");
  assert.match(result?.reason ?? "", /targeted.*not recorded project_index_root/i);
});

test("Phase 0 background evidence blocks failed index job and instructs stop", async () => {
  const fixture = await makeGuardFixture();
  const jobId = "job-failed";
  await writeState(fixture, withIndexJob({
    ...validP0(fixture),
    project_index_execution_mode: "background",
    project_index_job_id: jobId,
    project_index_waited: true,
  }, fixture, jobId, { exitCode: 1, status: "failed", collected: true }));
  const result = await validatePostToolUse({
    tool_name: "Write",
    tool_input: { file_path: ".planning/state/planning-state-v2.json" },
    tool_response: {},
  }, fixture.control);
  assert.equal(result?.decision, "block");
  assert.match(result?.reason ?? "", /failed.*exit_code=1/i);
  assert.match(result?.reason ?? "", /stop planning/i);
});

test("Phase 0 background evidence accepts collected exit_code=0 for same target", async () => {
  const fixture = await makeGuardFixture();
  const jobId = "job-success";
  await writeState(fixture, withIndexJob({
    ...validP0(fixture),
    project_index_execution_mode: "background",
    project_index_job_id: jobId,
    project_index_waited: true,
  }, fixture, jobId, { exitCode: 0, status: "succeeded", collected: true }));
  const result = await validatePostToolUse({
    tool_name: "Write",
    tool_input: { file_path: ".planning/state/planning-state-v2.json" },
    tool_response: {},
  }, fixture.control);
  assert.equal(result, null);
});

function runGuard(fixture) {
  const input = JSON.stringify({
    hook_event_name: "PostToolUse",
    tool_name: "Write",
    tool_input: { file_path: ".planning/state/planning-state-v2.json", content: "{}" },
    tool_response: {},
  });
  return spawnSync(process.execPath, [GUARD], {
    cwd: fixture.control,
    env: { ...process.env, CLAUDE_PROJECT_DIR: fixture.control },
    input,
    encoding: "utf8",
  });
}

test("hook validation accepts authoritative JSON state with feature set and no Markdown status mirror", async () => {
  const fixture = await makeGuardFixture();
  await writeState(fixture, validP0(fixture));
  const result = runGuard(fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("resume gate does not require a Markdown status mirror", async () => {
  const fixture = await makeGuardFixture();
  const feature = "example-feature";
  const historyDir = join(fixture.child, ".planning", "history", feature);
  const lanesDir = join(historyDir, "discovery-lanes");
  await mkdirp(lanesDir);
  await writeFile(join(historyDir, "discovery.md"), "# Discovery\n");
  await writeFile(join(lanesDir, "1-architecture.md"), "# Architecture\n");
  await writeFile(join(lanesDir, "2-patterns.md"), "# Patterns\n");
  await writeFile(join(lanesDir, "3-constraints.md"), "# Constraints\n");
  await writeFile(join(lanesDir, "4-external.md"), "# External\n");

  const state = {
    feature,
    current_phase: "1.5",
    completed_phases: ["0", "1"],
    phase_plan_approved: false,
    planning_active: true,
    resume_context: { required: true, requirement_source_path: fixture.source },
    phase_outputs: {
      "0": validP0(fixture),
      "1": { status: "completed", discovery_path: `.planning/history/${feature}/discovery.md` },
      "1.5": { status: "in_progress", questions_asked: 0 },
    },
  };
  await writeFile(
    join(fixture.control, ".planning", "state", "planning-state-v2.json"),
    JSON.stringify(state, null, 2),
  );

  const input = JSON.stringify({
    hook_event_name: "PreToolUse",
    tool_name: "AskUserQuestion",
    tool_input: {
      questions: [1, 2, 3, 4].map((n) => ({
        header: `Q${n}`,
        question: `Question ${n}?`,
        options: [{ label: "A" }, { label: "B" }],
      })),
    },
  });
  const result = spawnSync(process.execPath, [GUARD], {
    cwd: fixture.control,
    env: { ...process.env, CLAUDE_PROJECT_DIR: fixture.control },
    input,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Resume blocked in Phase 1\.5/i);
  assert.doesNotMatch(result.stdout, /expected prior planning artifact\(s\) are missing/i);
});

test("hook validation blocks outer control root for nested-repo anchor", async () => {
  const fixture = await makeGuardFixture();
  const p0 = validP0(fixture);
  p0.project_index_root = fixture.control;
  await writeState(fixture, p0);
  const result = runGuard(fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /resolver-derived root .*nested-service.* does not match project_index_root/i);
});

test("hook validation blocks missing provenance field", async () => {
  const fixture = await makeGuardFixture();
  const p0 = validP0(fixture);
  delete p0.project_index_root_source;
  await writeState(fixture, p0);
  const result = runGuard(fixture);
  assert.match(result.stdout, /missing project-index provenance field/i);
});

test("hook validation blocks old gitnexus_reindex-only evidence", async () => {
  const fixture = await makeGuardFixture();
  await writeState(fixture, {
    status: "completed",
    feature_path: ".planning/history/example-feature",
    mcp_json_checked: true,
    mcp_servers_verified: ["serena", "exa", "gitnexus"],
    serena_onboarding_checked: true,
    serena_ready: true,
    gitnexus_reindex_ran: true,
    gitnexus_reindex_ok: true,
    br_help_ok: true,
    bv_help_ok: true,
    jq_ok: true,
  });
  const result = runGuard(fixture);
  assert.match(result.stdout, /missing true evidence field/i);
});

test("hook validation blocks non-absolute project_index_root", async () => {
  const fixture = await makeGuardFixture();
  const p0 = validP0(fixture);
  p0.project_index_root = "nested-service";
  await writeState(fixture, p0);
  const result = runGuard(fixture);
  assert.match(result.stdout, /path evidence must be absolute/i);
});

test("nested-repo scenario scopes feature history to target repo, not outer control root", async () => {
  const fixture = await makeGuardFixture();
  const state = {
    feature: "example-feature",
    phase_outputs: { "0": validP0(fixture) },
  };
  assert.equal(historyRoot(state, fixture.control), fixture.child);
  assert.equal(
    featureWorkspacePath(fixture.control, state),
    join(fixture.child, ".planning", "history", "example-feature"),
  );
  assert.equal(
    resolvePlanningPath(fixture.control, state, ".planning/history/example-feature/discovery.md"),
    join(fixture.child, ".planning", "history", "example-feature", "discovery.md"),
  );
  // Legacy pre-relocation relative values resolve to the same canonical location.
  assert.equal(
    resolvePlanningPath(fixture.control, state, "history/example-feature/discovery.md"),
    join(fixture.child, ".planning", "history", "example-feature", "discovery.md"),
  );
});

test("history path falls back to normal project root when no target repo is selected", async () => {
  const fixture = await makeNestedFixture();
  const state = { feature: "example-feature", phase_outputs: { "0": {} } };
  assert.equal(historyRoot(state, fixture.control), fixture.control);
  assert.equal(
    featureWorkspacePath(fixture.control, state),
    join(fixture.control, ".planning", "history", "example-feature"),
  );
});

test("PreToolUse blocks relative active-feature history write when target repo differs from control root", async () => {
  const fixture = await makeGuardFixture();
  await writeState(fixture, validP0(fixture));
  const input = JSON.stringify({
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: {
      file_path: ".planning/history/example-feature/discovery.md",
      content: "# Discovery\n",
    },
  });
  const result = spawnSync(process.execPath, [GUARD], {
    cwd: fixture.control,
    env: { ...process.env, CLAUDE_PROJECT_DIR: fixture.control },
    input,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Target-repo-scoped history write blocked/i);
  assert.match(result.stdout, /nested-service/);
});

test("canonical phase sequence merges workspace setup into Phase 0 and ends at Phase 6", () => {
  assert.deepEqual(PHASE_SEQUENCE, ["0", "1", "1.5", "1.6", "2", "2.5", "3", "4", "5", "6"]);
  assert.equal(PHASE_SEQUENCE.includes("0.5"), false);
  assert.equal(PHASE_SEQUENCE.includes("7"), false);
  assert.equal(PHASE_SEQUENCE.includes("8"), false);
});

test("Phase 0 completion is blocked when target-repo-scoped history/<feature>/ workspace is missing", async () => {
  const fixture = await makeGuardFixture();
  await rm(join(fixture.child, ".planning", "history", "example-feature"), { recursive: true, force: true });
  await mkdirp(join(fixture.control, ".planning", "history", "example-feature")); // wrong-root decoy
  await writeState(fixture, validP0(fixture));
  const result = await validatePostToolUse({
    tool_name: "Write",
    tool_input: { file_path: ".planning/state/planning-state-v2.json" },
    tool_response: {},
  }, fixture.control);
  assert.equal(result?.decision, "block");
  assert.match(result?.reason ?? "", /target-repo-scoped feature workspace/i);
  assert.match(result?.reason ?? "", new RegExp(fixture.child.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(result?.reason ?? "", new RegExp(`${fixture.control.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/history/example-feature.*does not exist`, "i"));
});

async function writeTerminalPhase6Fixture(fixture, { planningActive }) {
  const feature = "example-feature";
  const historyDir = join(fixture.child, ".planning", "history", feature);
  const lanesDir = join(historyDir, "discovery-lanes");
  await mkdirp(lanesDir);
  await writeFile(join(historyDir, "discovery.md"), "# Discovery\n");
  await writeFile(join(lanesDir, "1-architecture.md"), "# Architecture\n");
  await writeFile(join(lanesDir, "2-patterns.md"), "# Patterns\n");
  await writeFile(join(lanesDir, "3-constraints.md"), "# Constraints\n");
  await writeFile(join(lanesDir, "4-external.md"), "# External\n");
  await writeFile(join(historyDir, "requirements.md"), "# Requirements\n");
  await writeFile(
    join(historyDir, "test-scenarios.md"),
    "# Test Scenarios\nMode: fullstack\n## Evidence Matrix\nBefore action, after action, final state.\n",
  );
  await writeFile(join(historyDir, "approach.md"), "# Approach\n");

  const state = {
    feature,
    current_phase: "6",
    completed_phases: ["0", "1", "1.5", "1.6", "2", "5", "6"],
    phase_plan_approved: false,
    planning_active: planningActive,
    mode: "lightweight",
    phase_outputs: {
      "0": { ...validP0(fixture), lightweight_mode: true },
      "1": {
        status: "completed",
        discovery_path: `.planning/history/${feature}/discovery.md`,
        agents: ["a", "b", "c", "d"],
      },
      "1.5": {
        status: "completed",
        questions_asked: 12,
        anomaly_scan: { unresolved_count: 0 },
        requirements_path: `.planning/history/${feature}/requirements.md`,
      },
      "1.6": {
        status: "completed",
        questions_asked: 8,
        test_scenarios_path: `.planning/history/${feature}/test-scenarios.md`,
      },
      "2": {
        status: "completed",
        approach_path: `.planning/history/${feature}/approach.md`,
      },
      "5": { status: "completed", beads_created: 1 },
      "6": {
        status: "completed",
        cycles_found: 0,
      },
    },
  };

  await writeFile(
    join(fixture.control, ".planning", "state", "planning-state-v2.json"),
    JSON.stringify(state, null, 2),
  );
}

test("terminal Phase 6 completed state accepts planning_active=false as final pipeline state", async () => {
  const fixture = await makeGuardFixture();
  await writeTerminalPhase6Fixture(fixture, { planningActive: false });
  const result = await validatePostToolUse({
    tool_name: "Write",
    tool_input: { file_path: ".planning/state/planning-state-v2.json" },
    tool_response: {},
  }, fixture.control);
  assert.equal(result, null);
});

test("terminal Phase 6 completed state blocks when planning_active remains true", async () => {
  const fixture = await makeGuardFixture();
  await writeTerminalPhase6Fixture(fixture, { planningActive: true });
  const result = await validatePostToolUse({
    tool_name: "Write",
    tool_input: { file_path: ".planning/state/planning-state-v2.json" },
    tool_response: {},
  }, fixture.control);
  assert.equal(result?.decision, "block");
  assert.match(result?.reason ?? "", /planning_active must be false/i);
});

// --- Phase artifact ordering gate (1.5/1.6 before Phase 2+ synthesis artifacts) ---

async function writeOrderingState(fixture, { currentPhase, completed, p15 = {}, p16 = {} }) {
  const state = {
    schema_version: "v2",
    feature: "example-feature",
    current_phase: currentPhase,
    completed_phases: completed,
    phase_plan_approved: false,
    planning_active: true,
    phase_outputs: {
      "0": validP0(fixture),
      "1.5": p15,
      "1.6": p16,
    },
  };
  await writeFile(
    join(fixture.control, ".planning", "state", "planning-state-v2.json"),
    JSON.stringify(state, null, 2),
  );
}

function orderingWriteInput(fp) {
  return {
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: { file_path: fp, content: "# x\n" },
  };
}

test("approach.md write is blocked before Phase 1.5/1.6 are satisfied", async () => {
  const fixture = await makeGuardFixture();
  await writeOrderingState(fixture, {
    currentPhase: "1.5",
    completed: ["0", "1"],
    p15: { status: "in_progress", questions_asked: 0 },
  });
  const fp = join(fixture.child, ".planning", "history", "example-feature", "approach.md");
  const decision = await validatePreToolUse(orderingWriteInput(fp), fixture.control);
  assert.ok(decision, "expected deny decision");
  assert.match(JSON.stringify(decision), /Phase artifact ordering blocked/);
});

test("phase-plan.md and contract writes are blocked while Phase 1.6 is unfinished", async () => {
  const fixture = await makeGuardFixture();
  await writeOrderingState(fixture, {
    currentPhase: "1.6",
    completed: ["0", "1", "1.5"],
    p15: { status: "completed", questions_asked: 12 },
    p16: { status: "in_progress", questions_asked: 4 },
  });
  for (const rel of ["phase-plan.md", "contracts/phase-1-contract.md", "story-maps/phase-1-story-map.md"]) {
    const fp = join(fixture.child, ".planning", "history", "example-feature", rel);
    const decision = await validatePreToolUse(orderingWriteInput(fp), fixture.control);
    assert.ok(decision, `expected deny for ${rel}`);
    assert.match(JSON.stringify(decision), /Phase artifact ordering blocked/);
  }
});

test("requirements.md is blocked before 12/12 questions and allowed at 12/12", async () => {
  const fixture = await makeGuardFixture();
  const fp = join(fixture.child, ".planning", "history", "example-feature", "requirements.md");
  await writeOrderingState(fixture, {
    currentPhase: "1.5",
    completed: ["0", "1"],
    p15: { status: "in_progress", questions_asked: 8 },
  });
  const blocked = await validatePreToolUse(orderingWriteInput(fp), fixture.control);
  assert.ok(blocked, "expected deny at 8/12");
  await writeOrderingState(fixture, {
    currentPhase: "1.5",
    completed: ["0", "1"],
    p15: { status: "in_progress", questions_asked: 12 },
  });
  assert.equal(await validatePreToolUse(orderingWriteInput(fp), fixture.control), null);
});

test("approach.md write is allowed after Phase 1.5 and 1.6 complete", async () => {
  const fixture = await makeGuardFixture();
  await writeOrderingState(fixture, {
    currentPhase: "2",
    completed: ["0", "1", "1.5", "1.6"],
    p15: { status: "completed", questions_asked: 12 },
    p16: { status: "completed", questions_asked: 8 },
  });
  const fp = join(fixture.child, ".planning", "history", "example-feature", "approach.md");
  assert.equal(await validatePreToolUse(orderingWriteInput(fp), fixture.control), null);
});

test("ordering gate ignores same-named files outside the feature workspace", async () => {
  const fixture = await makeGuardFixture();
  await writeOrderingState(fixture, {
    currentPhase: "1.5",
    completed: ["0", "1"],
    p15: { status: "in_progress", questions_asked: 0 },
  });
  const fp = join(fixture.child, "docs", "approach.md");
  assert.equal(await validatePreToolUse(orderingWriteInput(fp), fixture.control), null);
});

test("early /planning prompt skips new index job when Phase 0 already completed for same target", async () => {
  const fixture = await makeNestedFixture();
  const fake = await makeFakeIndexers();
  // Realistic resume layout: pointer at control, authoritative state in target repo.
  await mkdirp(join(fixture.control, ".planning", "state"));
  await writeFile(join(fixture.control, ".planning", "state", "active-target-root"), `${fixture.child}\n`);
  await mkdirp(join(fixture.child, ".planning", "state"));
  await writeFile(
    join(fixture.child, ".planning", "state", "planning-state-v2.json"),
    JSON.stringify({
      schema_version: "v2",
      feature: "example-feature",
      current_phase: "3",
      completed_phases: ["0", "1", "1.5", "1.6", "2", "2.5"],
      phase_plan_approved: true,
      planning_active: true,
      phase_outputs: {
        "0": {
          status: "completed",
          project_index_root: fixture.child,
          project_index_ok: true,
          project_index_execution_mode: "background",
          project_index_waited: true,
          project_index_job_id: "prior-job-1",
        },
      },
    }, null, 2),
  );

  const result = await startEarlyIndexFromPrompt({
    prompt: `/planning tiep tuc '${fixture.source}'`,
    projectDir: fixture.control,
    pwd: fixture.control,
    env: { ...process.env, PATH: `${fake.bin}:${process.env.PATH}`, CALL_LOG: fake.log, PLANNING_CONTROL_ROOT: fixture.control },
    indexScriptPath: INDEX_SCRIPT,
  });
  assert.equal(result.status, "already_indexed", JSON.stringify(result));
  assert.equal(result.targetRoot, fixture.child);
  assert.equal(result.jobId, "prior-job-1");
  // No indexer process may have been launched.
  await assert.rejects(() => readFile(fake.log, "utf8"));

  // Evidence pointers in state stay untouched.
  const state = JSON.parse(await readFile(join(fixture.child, ".planning", "state", "planning-state-v2.json"), "utf8"));
  assert.equal(state.phase_outputs["0"].project_index_job_id, "prior-job-1");
  assert.equal(state.phase_outputs["0"].project_index_waited, true);
});

test("early /planning prompt still starts a job when Phase 0 evidence is uncollected", async () => {
  const fixture = await makeNestedFixture();
  const fake = await makeFakeIndexers();
  await mkdirp(join(fixture.control, ".planning", "state"));
  await writeFile(join(fixture.control, ".planning", "state", "active-target-root"), `${fixture.child}\n`);
  await mkdirp(join(fixture.child, ".planning", "state"));
  await writeFile(
    join(fixture.child, ".planning", "state", "planning-state-v2.json"),
    JSON.stringify({
      schema_version: "v2",
      feature: "example-feature",
      current_phase: "0",
      completed_phases: [],
      phase_plan_approved: false,
      planning_active: true,
      phase_outputs: {
        "0": {
          status: "completed",
          project_index_root: fixture.child,
          project_index_ok: true,
          project_index_execution_mode: "background",
          project_index_waited: false,
        },
      },
    }, null, 2),
  );

  const result = await startEarlyIndexFromPrompt({
    prompt: `/planning cho '${fixture.source}'`,
    projectDir: fixture.control,
    pwd: fixture.control,
    env: { ...process.env, PATH: `${fake.bin}:${process.env.PATH}`, CALL_LOG: fake.log, PLANNING_CONTROL_ROOT: fixture.control },
    indexScriptPath: INDEX_SCRIPT,
  });
  assert.equal(result.status, "started", JSON.stringify(result));
  const collected = runIndexScript(["--wait", "--job", result.jobId], {
    PATH: `${fake.bin}:${process.env.PATH}`, CALL_LOG: fake.log, PLANNING_CONTROL_ROOT: fixture.control,
  }, fixture.control);
  assert.equal(collected.status, 0, collected.stderr);
});
