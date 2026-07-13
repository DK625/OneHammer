#!/usr/bin/env node
// materialize_beads.mjs — Deterministic Phase 5 bead materialization.
//
// Reads the machine-readable `bead-specs` JSON blocks from every declared
// story-map of a feature, validates them (unique keys, clause coverage via the
// same validator the PreToolUse hook uses, and topological consistency), then:
//   1. creates each bead with `br create --json` (topological order),
//   2. adds `br dep add <dependent> <dependency>` edges,
//   3. replaces `<bead:KEY>` tokens in the story-maps with the real canonical IDs,
//   4. writes `.planning/history/<feature>/beads-manifest.json` (idempotency ledger).
//
// Re-running is safe: keys already present in the manifest are reused, not
// re-created. `--dry-run` performs all validation and prints the plan without
// touching br, the story-maps, or the manifest.
//
// Usage:
//   node .claude/hooks/planning/materialize_beads.mjs --feature <slug> [--root <HISTORY_ROOT>] [--dry-run]
//
// Exit codes: 0 ok, 1 validation/spec error, 2 br execution error.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validatePhase5VerificationClauses } from "./validators/pre_tool_use.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTROL_ROOT = resolve(HERE, "../../..");
const BR_BIN = process.env.BR_BIN || "br";

// ---------------------------------------------------------------- args
function parseArgs(argv) {
  const args = { feature: null, root: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--feature") args.feature = argv[++i];
    else if (a === "--root") args.root = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else fail(1, `unknown argument: ${a}`);
  }
  if (!args.feature) fail(1, "missing required --feature <slug>");
  return args;
}

function fail(code, message, extra = {}) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: message, ...extra }, null, 2)}\n`);
  process.exit(code);
}

// ---------------------------------------------------------------- roots
function resolveHistoryRoot(cliRoot) {
  if (cliRoot) return resolve(cliRoot);
  const pointer = join(CONTROL_ROOT, ".planning", "state", "active-target-root");
  if (existsSync(pointer)) {
    const target = readFileSync(pointer, "utf8").trim();
    if (target && existsSync(target)) return target;
  }
  return process.cwd();
}

// br auto-discovers .beads by walking up from cwd; make that deterministic by
// picking the nearest ancestor of HISTORY_ROOT that has .beads, falling back to
// CONTROL_ROOT. This fixes the "ran bv from the wrong directory" failure mode.
function resolveBeadsRoot(historyRoot) {
  let dir = historyRoot;
  for (;;) {
    if (existsSync(join(dir, ".beads"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (existsSync(join(CONTROL_ROOT, ".beads"))) return CONTROL_ROOT;
  return null;
}

// ---------------------------------------------------------------- spec parsing
const SPEC_FENCE_RE = /```json[ \t]+bead-specs[ \t]*\r?\n([\s\S]*?)```/g;

function extractSpecs(storyMapPath, text) {
  const beads = [];
  let matched = false;
  for (const m of text.matchAll(SPEC_FENCE_RE)) {
    matched = true;
    let parsed;
    try {
      parsed = JSON.parse(m[1]);
    } catch (err) {
      fail(1, `invalid JSON in bead-specs block of ${storyMapPath}: ${err.message}`);
    }
    if (!parsed || !Array.isArray(parsed.beads)) {
      fail(1, `bead-specs block in ${storyMapPath} must be {"beads": [...]}`);
    }
    for (const bead of parsed.beads) beads.push({ ...bead, story_map: storyMapPath });
  }
  if (!matched) fail(1, `no \`\`\`json bead-specs block found in ${storyMapPath}`);
  return beads;
}

function validateSpecs(specs, state) {
  const errors = [];
  const seen = new Set();
  for (const bead of specs) {
    const key = String(bead.key || "").trim();
    if (!key) errors.push(`${bead.story_map}: bead with empty key`);
    else if (seen.has(key)) errors.push(`duplicate bead key '${key}'`);
    seen.add(key);
    if (!String(bead.title || "").trim()) errors.push(`bead '${key}': empty title`);
    if (!String(bead.description || "").trim()) errors.push(`bead '${key}': empty description`);
    if (!Array.isArray(bead.labels) || bead.labels.length === 0) errors.push(`bead '${key}': labels must be a non-empty array`);
    if (bead.depends_on != null && !Array.isArray(bead.depends_on)) errors.push(`bead '${key}': depends_on must be an array`);

    // Same clause gate the PreToolUse hook applies to manual `br create` commands.
    const syntheticCommand = `br create --title "${bead.title}" --description "${bead.description}"`;
    const clauseIssue = validatePhase5VerificationClauses(syntheticCommand, state);
    if (clauseIssue) errors.push(`bead '${key}': ${clauseIssue}`);
  }
  for (const bead of specs) {
    for (const dep of bead.depends_on || []) {
      if (!seen.has(dep) && !/^[A-Za-z0-9_]+-[A-Za-z0-9]+$/.test(dep)) {
        errors.push(`bead '${bead.key}': depends_on '${dep}' is neither a spec key nor a canonical issue ID`);
      }
    }
  }
  return errors;
}

// Kahn topological sort over spec keys. External canonical IDs are treated as
// already-satisfied dependencies. Returns ordered specs or reports a cycle.
function topoSort(specs) {
  const byKey = new Map(specs.map((b) => [b.key, b]));
  const inDegree = new Map(specs.map((b) => [b.key, 0]));
  const dependents = new Map();
  for (const bead of specs) {
    for (const dep of bead.depends_on || []) {
      if (!byKey.has(dep)) continue; // external existing bead
      inDegree.set(bead.key, inDegree.get(bead.key) + 1);
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep).push(bead.key);
    }
  }
  const queue = specs.filter((b) => inDegree.get(b.key) === 0).map((b) => b.key);
  const order = [];
  while (queue.length > 0) {
    const key = queue.shift();
    order.push(byKey.get(key));
    for (const next of dependents.get(key) || []) {
      inDegree.set(next, inDegree.get(next) - 1);
      if (inDegree.get(next) === 0) queue.push(next);
    }
  }
  if (order.length !== specs.length) {
    const stuck = specs.filter((b) => !order.includes(b)).map((b) => b.key);
    fail(1, `bead-specs dependency cycle detected among: ${stuck.join(", ")}`);
  }
  return order;
}

// ---------------------------------------------------------------- br calls
function br(args, cwd) {
  try {
    return execFileSync(BR_BIN, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    fail(2, `br ${args.join(" ")} failed: ${err.stderr || err.message}`);
  }
  return "";
}

function createBead(bead, beadsRoot) {
  const args = [
    "create",
    "--title", bead.title,
    "--description", bead.description,
    "--type", bead.type || "task",
    "--priority", String(bead.priority ?? 1),
    "--labels", bead.labels.join(","),
    "--silent",
  ];
  const out = br(args, beadsRoot).trim();
  // --silent prints only the issue ID.
  const id = out.split(/\s+/).pop();
  if (!id || !id.includes("-")) fail(2, `could not parse issue ID from br create output: '${out}'`);
  return id;
}

// ---------------------------------------------------------------- main
const args = parseArgs(process.argv.slice(2));
const HISTORY_ROOT = resolveHistoryRoot(args.root);
const featureDir = join(HISTORY_ROOT, ".planning", "history", args.feature);
const storyMapsDir = join(featureDir, "story-maps");
if (!existsSync(storyMapsDir)) fail(1, `story-maps directory not found: ${storyMapsDir}`);

const storyMapFiles = readdirSync(storyMapsDir)
  .filter((f) => /^phase-\d+-story-map\.md$/.test(f))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
  .map((f) => join(storyMapsDir, f));
if (storyMapFiles.length === 0) fail(1, `no phase-<n>-story-map.md files in ${storyMapsDir}`);

// Planning state gives the feature mode for clause validation; degrade gracefully.
let state = { current_phase: "5", phase_outputs: {} };
const statePath = join(HISTORY_ROOT, ".planning", "state", "planning-state-v2.json");
if (existsSync(statePath)) {
  try {
    const real = JSON.parse(readFileSync(statePath, "utf8"));
    state = { ...real, current_phase: "5" };
  } catch { /* keep minimal state */ }
}

const specs = storyMapFiles.flatMap((f) => extractSpecs(f, readFileSync(f, "utf8")));
const specErrors = validateSpecs(specs, state);
if (specErrors.length > 0) fail(1, "bead-specs validation failed", { issues: specErrors });
const ordered = topoSort(specs);

const beadsRoot = resolveBeadsRoot(HISTORY_ROOT);
if (!beadsRoot && !args.dryRun) fail(1, `no .beads workspace found above ${HISTORY_ROOT} or at ${CONTROL_ROOT}; run 'br init' first`);

const manifestPath = join(featureDir, "beads-manifest.json");
let manifest = { feature: args.feature, beads: {}, deps: [] };
if (existsSync(manifestPath)) {
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    fail(1, `existing manifest is unreadable JSON: ${manifestPath}`);
  }
}

if (args.dryRun) {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    dry_run: true,
    feature: args.feature,
    history_root: HISTORY_ROOT,
    beads_root: beadsRoot,
    story_maps: storyMapFiles,
    plan: ordered.map((b) => ({
      key: b.key,
      title: b.title,
      labels: b.labels,
      priority: b.priority ?? 1,
      depends_on: b.depends_on || [],
      reused: Boolean(manifest.beads[b.key]?.id),
    })),
  }, null, 2)}\n`);
  process.exit(0);
}

// 1. Create beads (topological order), reusing manifest entries.
const created = [];
const reused = [];
for (const bead of ordered) {
  const existing = manifest.beads[bead.key]?.id;
  if (existing) {
    reused.push({ key: bead.key, id: existing });
    continue;
  }
  const id = createBead(bead, beadsRoot);
  manifest.beads[bead.key] = { id, title: bead.title, story_map: bead.story_map };
  created.push({ key: bead.key, id });
}

// 2. Dependency edges: br dep add <dependent> <dependency>.
const idOf = (keyOrId) => manifest.beads[keyOrId]?.id || keyOrId;
const existingDeps = new Set((manifest.deps || []).map(([a, b]) => `${a}->${b}`));
let depsAdded = 0;
for (const bead of ordered) {
  for (const dep of bead.depends_on || []) {
    const edge = `${bead.key}->${dep}`;
    if (existingDeps.has(edge)) continue;
    br(["dep", "add", idOf(bead.key), idOf(dep)], beadsRoot);
    manifest.deps.push([bead.key, dep]);
    existingDeps.add(edge);
    depsAdded += 1;
  }
}

// 3. Replace <bead:KEY> tokens in story-maps with canonical IDs.
const updatedMaps = [];
for (const file of storyMapFiles) {
  const original = readFileSync(file, "utf8");
  const replaced = original.replace(/<bead:([A-Za-z0-9._-]+)>/g, (whole, key) =>
    manifest.beads[key]?.id || whole);
  if (replaced !== original) {
    writeFileSync(file, replaced);
    updatedMaps.push(file);
  }
  const leftover = [...replaced.matchAll(/<bead:([A-Za-z0-9._-]+)>/g)].map((m) => m[1]);
  if (leftover.length > 0) {
    fail(1, `story-map ${file} references unknown bead keys: ${[...new Set(leftover)].join(", ")}`);
  }
}

// 4. Persist the manifest, then confirm the graph is acyclic.
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

let cycleReport = "not-checked";
try {
  const out = execFileSync(BR_BIN, ["dep", "cycles"], { cwd: beadsRoot, encoding: "utf8" });
  if (/no[\s\S]{0,40}?cycles?/i.test(out) || !/cycle/i.test(out)) cycleReport = "none";
  else cycleReport = out.trim();
} catch (err) {
  cycleReport = `br dep cycles failed: ${err.stderr || err.message}`;
}
if (cycleReport !== "none" && cycleReport !== "not-checked") {
  fail(2, "dependency cycle detected after materialization", { cycles: cycleReport });
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  feature: args.feature,
  beads_root: beadsRoot,
  manifest: manifestPath,
  created,
  reused,
  deps_added: depsAdded,
  story_maps_updated: updatedMaps,
  cycles: "none",
}, null, 2)}\n`);
