#!/usr/bin/env bash
set -euo pipefail

repo_root="$(pwd)"
output_dir=""
name_prefix="gpt-web-context"
paths=()
excludes=()

usage() {
  cat <<'USAGE'
Usage:
  package-gpt-web-context.sh [options] --path PATH [--path PATH ...]
  package-gpt-web-context.sh [options] PATH [PATH ...]

Options:
  --repo-root DIR        Project root. Defaults to current directory.
  --output-dir DIR      Zip output directory. Defaults to my_build/archive/gpt-web-context.
  --name-prefix NAME    Zip filename prefix. Defaults to gpt-web-context.
  --path PATH           Project-relative or absolute folder/file to include. Repeatable.
  --exclude PATTERN     Zip-entry-relative, absolute, or glob exclude pattern. Repeatable.
  -h, --help            Show this help.
USAGE
}

while (($#)); do
  case "$1" in
    --repo-root)
      repo_root="${2:?--repo-root requires a value}"
      shift 2
      ;;
    --output-dir)
      output_dir="${2:?--output-dir requires a value}"
      shift 2
      ;;
    --name-prefix)
      name_prefix="${2:?--name-prefix requires a value}"
      shift 2
      ;;
    --path)
      paths+=("${2:?--path requires a value}")
      shift 2
      ;;
    --exclude)
      excludes+=("${2:?--exclude requires a value}")
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      while (($#)); do
        paths+=("$1")
        shift
      done
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      paths+=("$1")
      shift
      ;;
  esac
done

if ((${#paths[@]} == 0)); then
  echo "No paths specified. Pass --path with project-relative or absolute folders/files, or configure oracle_runtime.local.json active_path. If neither is available, ask the user what to zip for GPT Web." >&2
  exit 2
fi

if [[ -z "$output_dir" ]]; then
  output_dir="$repo_root/my_build/archive/gpt-web-context"
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to create the zip on Linux." >&2
  exit 127
fi

python3 - "$repo_root" "$output_dir" "$name_prefix" "${paths[@]}" --exclude-marker-- "${excludes[@]}" <<'PY'
import fnmatch
import os
import subprocess
import sys
import time
import zipfile

repo_root, output_dir, name_prefix = sys.argv[1:4]
rest = sys.argv[4:]
try:
    marker = rest.index("--exclude-marker--")
except ValueError:
    marker = len(rest)
paths = rest[:marker]
excludes = rest[marker + 1 :]

repo_root = os.path.abspath(repo_root)
output_dir = os.path.abspath(output_dir)

def safe_segment(segment):
    clean = "".join("_" if ch in '<>:"|?*' or ord(ch) < 32 else ch for ch in segment).strip()
    if not clean or clean in {".", ".."}:
        return "_"
    return clean

def external_zip_path(full):
    parts = ["external"]
    drive, tail = os.path.splitdrive(full)
    if drive:
        parts.append(safe_segment(drive.rstrip(":")))
    if tail.startswith(os.sep):
        parts.append("root")
    for part in tail.strip(os.sep).split(os.sep):
        if part:
            parts.append(safe_segment(part))
    return "/".join(parts)

def zip_entry_path(path):
    full = os.path.abspath(path)
    rel = os.path.relpath(full, repo_root)
    if rel == os.curdir:
        return "repo-root"
    if rel == ".." or rel.startswith(".." + os.sep):
        return external_zip_path(full)
    return rel.replace(os.sep, "/")

def normalize_exclude_pattern(pattern):
    raw = pattern.strip()
    if not raw:
        return ""
    if os.path.isabs(raw):
        return zip_entry_path(raw)
    return raw.replace("\\", "/").strip("/")

exclude_patterns = [normalized for normalized in (normalize_exclude_pattern(p) for p in excludes) if normalized]

def is_excluded(rel):
    rel = rel.replace("\\", "/")
    for pattern in exclude_patterns:
        if rel == pattern or rel.startswith(pattern.rstrip("/") + "/"):
            return True
        if fnmatch.fnmatchcase(rel.lower(), pattern.lower()):
            return True
    return False

git_root_cache = {}
git_ignore_cache = {}

def find_git_root(path):
    start = path if os.path.isdir(path) else os.path.dirname(path)
    start = os.path.abspath(start)
    if start in git_root_cache:
        return git_root_cache[start]
    try:
        result = subprocess.run(
            ["git", "-C", start, "rev-parse", "--show-toplevel"],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
    except (FileNotFoundError, NotADirectoryError):
        git_root_cache[start] = None
        return None
    if result.returncode == 0 and result.stdout.strip():
        git_root = os.path.abspath(result.stdout.strip().splitlines()[0])
    else:
        git_root = None
    git_root_cache[start] = git_root
    return git_root

def is_inside(path, root):
    full = os.path.abspath(path)
    root = os.path.abspath(root)
    return full == root or full.startswith(root + os.sep)

def git_relative_path(path, git_root):
    if not git_root or not is_inside(path, git_root):
        return None
    rel = os.path.relpath(os.path.abspath(path), git_root)
    if rel in {"", "."}:
        return None
    return rel.replace(os.sep, "/")

def check_git_ignore(git_root, query):
    key = (git_root, query)
    if key in git_ignore_cache:
        return git_ignore_cache[key]
    result = subprocess.run(
        ["git", "-C", git_root, "check-ignore", "--no-index", "-q", "--", query],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    ignored = result.returncode == 0
    git_ignore_cache[key] = ignored
    return ignored

def is_git_ignored(path, git_root, is_dir=False):
    rel = git_relative_path(path, git_root)
    if rel is None:
        return False
    queries = [rel]
    if is_dir and not rel.endswith("/"):
        queries.insert(0, rel + "/")
    return any(check_git_ignore(git_root, query) for query in queries)

def iter_git_files(candidate, git_root):
    if not git_root or not is_inside(candidate, git_root):
        return None
    if os.path.isfile(candidate):
        return [] if is_git_ignored(candidate, git_root) else [candidate]

    rel = git_relative_path(candidate, git_root)
    pathspec = rel if rel else "."
    result = subprocess.run(
        [
            "git",
            "-C",
            git_root,
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
            "--",
            pathspec,
        ],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    if result.returncode != 0:
        return None
    files = []
    for raw in result.stdout.split(b"\0"):
        if not raw:
            continue
        rel_file = raw.decode("utf-8", errors="surrogateescape")
        source = os.path.join(git_root, rel_file)
        if os.path.isfile(source):
            files.append(source)
    return files

source_by_entry = {}
for requested in paths:
    if not requested.strip():
        continue
    candidate = requested if os.path.isabs(requested) else os.path.join(repo_root, requested)
    if not os.path.exists(candidate):
        raise SystemExit(f"Requested path not found: {requested}")
    git_root = find_git_root(candidate)
    git_files = iter_git_files(candidate, git_root)
    if git_files is not None:
        for source in git_files:
            rel = zip_entry_path(source)
            if is_excluded(rel) or is_git_ignored(source, git_root):
                continue
            source_by_entry[rel] = source
        continue
    if os.path.isdir(candidate):
        if is_git_ignored(candidate, git_root, is_dir=True):
            continue
        for current_root, dirnames, filenames in os.walk(candidate):
            kept_dirnames = []
            for dirname in sorted(dirnames):
                directory = os.path.join(current_root, dirname)
                rel = zip_entry_path(directory)
                if is_excluded(rel) or is_git_ignored(directory, git_root, is_dir=True):
                    continue
                kept_dirnames.append(dirname)
            dirnames[:] = kept_dirnames
            filenames = sorted(filenames)
            for filename in filenames:
                source = os.path.join(current_root, filename)
                rel = zip_entry_path(source)
                if is_excluded(rel) or is_git_ignored(source, git_root):
                    continue
                source_by_entry[rel] = source
    else:
        rel = zip_entry_path(candidate)
        if is_excluded(rel) or is_git_ignored(candidate, git_root):
            continue
        source_by_entry[rel] = candidate

if not source_by_entry:
    raise SystemExit("No files matched the requested paths after exclusions.")

os.makedirs(output_dir, exist_ok=True)
zip_path = os.path.join(output_dir, f"{name_prefix}-{time.strftime('%Y%m%d-%H%M%S')}.zip")
with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for entry in sorted(source_by_entry):
        archive.write(source_by_entry[entry], entry)

size_mb = round(os.path.getsize(zip_path) / (1024 * 1024), 2)
print("Created GPT Web context zip:")
print(zip_path)
print(f"Files: {len(source_by_entry)}")
print(f"Size: {size_mb} MB")
print("Roots: " + ", ".join(paths))
PY
