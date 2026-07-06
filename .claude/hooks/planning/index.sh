#!/usr/bin/env bash
set -Eeuo pipefail

log() {
  printf '[planning-index] %s\n' "$*" >&2
}

fail() {
  log "ERROR: $*"
  exit 1
}

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
DEFAULT_CONTROL_ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd -P)"
CONTROL_ROOT_RAW="${PLANNING_CONTROL_ROOT:-$DEFAULT_CONTROL_ROOT}"
[[ -d "$CONTROL_ROOT_RAW" ]] || fail "control root does not exist or is not a directory: $CONTROL_ROOT_RAW"
CONTROL_ROOT="$(cd -- "$CONTROL_ROOT_RAW" && pwd -P)"
JOB_STATE_HELPER="$SCRIPT_DIR/lib/index_job_state.mjs"
STATE_FILE="$CONTROL_ROOT/.planning/state/planning-state-v2.json"
[[ -f "$JOB_STATE_HELPER" ]] || fail "background job state helper is missing: $JOB_STATE_HELPER"

usage() {
  cat <<'USAGE'
Usage:
  index.sh --target /absolute/path/to/repo
  index.sh --target /absolute/path/to/repo --background
  index.sh --wait --job <job-id>
  index.sh --status --job <job-id>

Options:
  --target-root is accepted as an alias for --target.

Behavior:
  Default mode runs combined Serena + GitNexus indexing synchronously.
  --background starts the same combined index run asynchronously.
  --wait collects terminal state and propagates background failure.
  --status probes a job without waiting; a running job exits with status 3.
  Background job metadata is stored only in .planning/state/planning-state-v2.json.
USAGE
}

canonical_target() {
  local raw="$1"
  [[ -n "$raw" ]] || fail "target is empty"
  [[ -d "$raw" ]] || fail "target does not exist or is not a directory: $raw"
  (cd -- "$raw" && pwd -P)
}

run_combined_index() {
  local target
  target="$(canonical_target "$1")"
  cd -- "$target" || fail "cannot enter target root: $target"
  target="$(pwd -P)"

  command -v uvx >/dev/null 2>&1 || fail "uvx is required for Serena indexing"
  command -v gitnexus >/dev/null 2>&1 || fail "gitnexus is required for GitNexus indexing"

  log "target_root=$target"
  log "Serena index: start"
  if ! uvx --from git+https://github.com/oraios/serena serena project index --log-level INFO; then
    fail "Serena indexing failed for target_root=$target"
  fi
  log "Serena index: ok"

  log "GitNexus index: start"
  if ! gitnexus analyze; then
    fail "GitNexus indexing failed for target_root=$target"
  fi
  log "GitNexus index: ok"
  log "combined project index: ok target_root=$target"
}

valid_job_id() {
  [[ "$1" =~ ^[A-Za-z0-9._-]+$ ]]
}

job_state() {
  node "$JOB_STATE_HELPER" "$@" --control-root "$CONTROL_ROOT"
}

json_field() {
  local field="$1"
  node -e '
    let s="";
    process.stdin.on("data", c => s += c);
    process.stdin.on("end", () => {
      const x = JSON.parse(s);
      const v = x[process.argv[1]];
      if (v === undefined || v === null) return;
      process.stdout.write(typeof v === "string" ? v : String(v));
    });
  ' "$field"
}

show_failure_tail_from_json() {
  local json="$1"
  local tail_text=""
  tail_text="$(printf '%s' "$json" | json_field log_tail 2>/dev/null || true)"
  if [[ -n "$tail_text" ]]; then
    log "last index log lines:"
    printf '%s\n' "$tail_text" >&2
  fi
}

find_active_job_for_target() {
  local target="$1"
  job_state find-active --target "$target"
}

new_job_id() {
  printf '%s-%s-%s\n' "$(date -u +%Y%m%dT%H%M%SZ)" "$$" "${RANDOM:-0}"
}

worker_main() {
  local target="$1"
  local job_id="$2"
  valid_job_id "$job_id" || fail "invalid job id: $job_id"

  job_state start --job "$job_id" --pid "$$" || fail "failed to publish running state for job_id=$job_id"

  local log_file
  log_file="$(mktemp "${TMPDIR:-/tmp}/one-hammer-planning-index.${job_id}.XXXXXX.log")"
  trap 'rm -f -- "$log_file"' EXIT

  local rc=0
  set +e
  ( run_combined_index "$target" ) >"$log_file" 2>&1
  rc=$?
  set -e

  if ! job_state finish --job "$job_id" --exit-code "$rc" --log-file "$log_file"; then
    fail "failed to publish terminal state for job_id=$job_id"
  fi
  exit "$rc"
}

start_background() {
  local target="$1"

  local active=""
  active="$(find_active_job_for_target "$target" 2>/dev/null || true)"
  if [[ -n "$active" ]]; then
    log "reusing active job_id=$active target_root=$target"
    printf '%s\n' "$active"
    return 0
  fi

  local job_id
  job_id="$(new_job_id)"
  job_state queue --job "$job_id" --target "$target" --pid "$$" \
    || fail "failed to create background job state in $STATE_FILE"

  nohup bash "$SCRIPT_DIR/index.sh" \
    --worker --target "$target" --job "$job_id" \
    >/dev/null 2>&1 < /dev/null &
  local pid=$!

  if ! job_state set-pid --job "$job_id" --pid "$pid"; then
    kill "$pid" 2>/dev/null || true
    fail "failed to publish background pid for job_id=$job_id"
  fi

  log "started background job_id=$job_id pid=$pid target_root=$target state=$STATE_FILE"
  printf '%s\n' "$job_id"
}

collect_job() {
  local job_id="$1"
  local wait_mode="$2"
  valid_job_id "$job_id" || fail "invalid job id: $job_id"

  local record_json="" helper_rc=0
  set +e
  record_json="$(job_state "$wait_mode" --job "$job_id")"
  helper_rc=$?
  set -e

  if ((helper_rc == 3)); then
    local running_status=""
    running_status="$(printf '%s' "$record_json" | json_field status 2>/dev/null || true)"
    log "job_id=$job_id status=${running_status:-running}"
    return 3
  fi
  if ((helper_rc != 0)); then
    return "$helper_rc"
  fi

  local rc target status
  rc="$(printf '%s' "$record_json" | json_field exit_code)"
  [[ "$rc" =~ ^[0-9]+$ ]] || fail "invalid exit code for job_id=$job_id: ${rc:-<empty>}"
  target="$(printf '%s' "$record_json" | json_field target_root 2>/dev/null || true)"
  status="$(printf '%s' "$record_json" | json_field status 2>/dev/null || true)"

  if ((rc != 0)); then
    show_failure_tail_from_json "$record_json"
    log "background index failed job_id=$job_id exit_code=$rc target_root=$target state=$STATE_FILE"
    if ((rc > 125)); then
      exit 1
    fi
    exit "$rc"
  fi

  [[ "$status" == "succeeded" ]] || fail "job_id=$job_id exit_code=0 but status=${status:-<empty>}"
  log "background index ok job_id=$job_id status=$status target_root=$target state=$STATE_FILE"
  return 0
}

TARGET_ARG=""
JOB_ID=""
MODE="sync"
INTERNAL_WORKER=false

while (($# > 0)); do
  case "$1" in
    --target|--target-root)
      (($# >= 2)) || fail "$1 requires a directory argument"
      if [[ -n "$TARGET_ARG" && "$TARGET_ARG" != "$2" ]]; then
        fail "conflicting target arguments supplied"
      fi
      TARGET_ARG="$2"
      shift 2
      ;;
    --background)
      [[ "$MODE" == "sync" ]] || fail "conflicting modes: $MODE and background"
      MODE="background"
      shift
      ;;
    --wait)
      [[ "$MODE" == "sync" ]] || fail "conflicting modes: $MODE and wait"
      MODE="wait"
      shift
      ;;
    --status)
      [[ "$MODE" == "sync" ]] || fail "conflicting modes: $MODE and status"
      MODE="status"
      shift
      ;;
    --job)
      (($# >= 2)) || fail "--job requires a job id"
      JOB_ID="$2"
      shift 2
      ;;
    --worker)
      INTERNAL_WORKER=true
      MODE="worker"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

case "$MODE" in
  sync)
    [[ -n "$TARGET_ARG" ]] || fail "--target is required"
    run_combined_index "$TARGET_ARG"
    ;;
  background)
    [[ -n "$TARGET_ARG" ]] || fail "--target is required with --background"
    TARGET_ROOT="$(canonical_target "$TARGET_ARG")"
    start_background "$TARGET_ROOT"
    ;;
  wait)
    [[ -n "$JOB_ID" ]] || fail "--job is required with --wait"
    collect_job "$JOB_ID" "wait"
    ;;
  status)
    [[ -n "$JOB_ID" ]] || fail "--job is required with --status"
    collect_job "$JOB_ID" "status"
    ;;
  worker)
    $INTERNAL_WORKER || fail "internal worker mode is unavailable"
    [[ -n "$TARGET_ARG" ]] || fail "--target is required in worker mode"
    [[ -n "$JOB_ID" ]] || fail "--job is required in worker mode"
    TARGET_ROOT="$(canonical_target "$TARGET_ARG")"
    worker_main "$TARGET_ROOT" "$JOB_ID"
    ;;
  *)
    fail "unsupported mode: $MODE"
    ;;
esac
