// artifacts.mjs — Read + structural validate planning artifacts (markdown files).
// Checks are cheap regex + section existence. No full markdown parse.

import { readFile } from "node:fs/promises";
import { fileExists } from "./state.mjs";

export async function readFileSafe(p) {
  if (!(await fileExists(p))) return null;
  try {
    return await readFile(p, "utf8");
  } catch {
    return null;
  }
}

// Case-insensitive section header check. Accepts ##, ###, or bold **Section**.
function hasSection(text, label) {
  if (!text) return false;
  const pattern = new RegExp(
    `^\\s*(#{1,6}\\s*|\\*\\*\\s*)${escapeRe(label)}`,
    "im",
  );
  return pattern.test(text);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// discovery.md must include these 10-11 sections.
export const DISCOVERY_SECTIONS = [
  "Scope",
  "Architecture Findings",
  "Contract / Interface Changes",
  "Dependent Consumer Impact",
  "Existing Patterns To Reuse",
  "Technical Constraints",
  "External References",
  "GitNexus Evidence",
  "Serena Evidence",
  "Risks",
  "Open Questions",
  "Discovery Gaps",
];

export const APPROACH_SECTIONS = [
  "Gap Analysis",
  "Recommended Approach",
  "Alternatives Considered",
  "Risk Map",
];

export const CONTRACT_SECTIONS = [
  "Entry state",
  "Exit state",
  "Demo walkthrough",
  "Technical Contract Details",
  "API Contract",
  "Data / DB / Config Contract",
  "Bootstrap / Provisioning Contract",
  "Validation + Error Contract",
  "Observability / Testability Contract",
  "Out-of-scope",
];

export const STORY_MAP_SECTIONS = [
  "Story dependency order",
  "Done-looks-like",
];

export function missingSections(text, required) {
  const missing = [];
  for (const s of required) {
    if (!hasSection(text, s)) missing.push(s);
  }
  return missing;
}

// Look up a path in tool input regardless of tool (Write: file_path, Edit: file_path, etc).
export function extractFilePath(toolName, toolInput) {
  if (!toolInput) return null;
  if (typeof toolInput.file_path === "string") return toolInput.file_path;
  if (typeof toolInput.path === "string") return toolInput.path;
  return null;
}

export function looksLikeApproachFile(fp) {
  return typeof fp === "string" && /(^|\/)approach\.md$/.test(fp);
}

export function looksLikeDiscoveryFile(fp) {
  return typeof fp === "string" && /(^|\/)discovery\.md$/.test(fp);
}

export function looksLikeContractFile(fp) {
  return typeof fp === "string" && /phase-[^/]+-contract\.md$/.test(fp);
}

export function looksLikeStoryMapFile(fp) {
  return typeof fp === "string" && /phase-[^/]+-story-map\.md$/.test(fp);
}

export function looksLikePhasePlanFile(fp) {
  return typeof fp === "string" && /(^|\/)phase-plan\.md$/.test(fp);
}

export function looksLikeStateFile(fp) {
  return typeof fp === "string" && /planning-state-v2\.json$/.test(fp);
}
