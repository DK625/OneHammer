// diagnostics.mjs — Formatting helpers for block reasons and logging.
// All user-facing block messages go through here so they share the [planning-guard] prefix.

const PREFIX = "[planning-guard]";

export function reason(msg) {
  return `${PREFIX} ${msg}`;
}

export function warn(msg) {
  // Visible on stderr but non-blocking. Claude Code logs stderr in debug.
  process.stderr.write(`${PREFIX} WARN: ${msg}\n`);
}

export function debug(msg) {
  if (process.env.PLANNING_GUARD_DEBUG === "1") {
    process.stderr.write(`${PREFIX} DEBUG: ${msg}\n`);
  }
}

// Shape helpers for the two main JSON output variants.
export function preToolUseDeny(message) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason(message),
    },
  };
}

export function preToolUseAllow(message) {
  // We intentionally never force "allow" — we stay out of the way.
  // This helper is only here for completeness; guard exits empty to let default flow proceed.
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: reason(message),
    },
  };
}

export function topLevelBlock(message) {
  return {
    decision: "block",
    reason: reason(message),
  };
}

export function additionalContext(eventName, text) {
  return {
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: text,
    },
  };
}
