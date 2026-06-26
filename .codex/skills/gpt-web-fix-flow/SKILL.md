---
name: gpt-web-fix-flow
description: >-
  Automate a project-agnostic GPT Web fix/develop/investigation loop: perform only minimal local checks, package bounded repo context and user artifacts as GPT Web attachments, run the Oracle dry run, send the request through GPT Web, then stop for the returned zip. Apply/local asset work is gated and runs only when the user explicitly says "local apply asset" or asks for "bước 3" with a GPT Web returned artifact. Use when the user explicitly names this skill, provides its path, says to use/follow the GPT Web fix flow, asks to debug/fix/develop/investigate a project with GPT Web review, asks to package context for GPT Web, or asks to run the package to GPT Web to returned-zip loop.
---

# GPT Web Fix Flow

## Overview

Use this skill for a bounded project loop: create a safe context zip, send it to GPT Web for a fix/spec/investigation, then apply the returned zip into the live repo only when explicitly requested.

Follow the current repo's local instructions first. Read `AGENTS.md` when present. If the repo uses durable notes such as `my_build/INDEX.md`, read only the task-routed files and the user-provided handoff/zip files. Do not assume project-specific paths, runtimes, protocols, or validation commands unless the active project documents them.

Before an outbound GPT Web request, resolve the Oracle runtime case from an explicit user case, `oracle_runtime.local.json`, or inferred local runner fallback, then read only the matching case in [references/oracle_runtime_cases.md](references/oracle_runtime_cases.md). `oracle_runtime.local.json` lives in this skill directory, at the same level as `SKILL.md`; check exactly `<skillDir>/oracle_runtime.local.json` before any fallback or broad filesystem search. Do not rely on `find` depth limits to discover it. The runtime case controls shell syntax, paths, and browser transport only; it must not change the project package -> dry-run -> GPT Web -> stop-for-zip flow.

Use the bundled context packagers in `scripts/package-gpt-web-context.ps1` and `scripts/package-gpt-web-context.sh` unless the active repo has a stricter documented packager. These scripts require explicit folders/files and accept either project-relative or absolute paths; do not package a hardcoded source set. Reusable package roots live in `oracle_runtime.local.json` field `active_path`, with per-root options in `extra`.

## Strict Trigger Contract

- When the user explicitly names this skill, references its path, or says "use/follow this skill", using this flow is mandatory, not advisory.
- When this skill is called, immediately run the outbound GPT Web path: perform only the minimum checks needed to make safe attachments, package context, dry-run Oracle, send GPT Web, then stop after GPT Web finishes. Do not ask which mode to use unless the request is impossible to package safely.
- For a bug/feature/investigation request with this skill named, run the full outbound loop: package context, dry-run Oracle, send GPT Web, then stop after GPT Web finishes. Do not choose a local-only investigation path.
- Keep orchestrator investigation minimal before GPT Web: read the skill, repo instructions, task-routed durable notes, user artifacts, and only the path/output checks needed to package and send the request. Do not scan source/data to solve the problem yourself unless applying a returned zip or validating a concrete fix.
- Do not enter `local apply asset`, `Apply Returned Zip`, runtime patch, or local source/asset application merely because a local path, zip, or handoff exists. Enter that path only when the user explicitly says `local apply asset` or asks to perform `bước 3` of this skill with a GPT Web returned artifact.
- If the user provides a local artifact path without saying `local apply asset` or `bước 3`, treat it as an attachment/context candidate for GPT Web after basic existence, size, and filename checks.
- If packaging or Oracle/GPT Web fails, report the failing step, raw output path if available, and the next exact command/path needed. Do not silently fall back to broad local analysis.
- Do not ask which Oracle runtime case to use when it can be resolved from the current user request or `oracle_runtime.local.json`. Ask only when no configured case exists and the runner OS cannot be inferred safely.

## Mode Selection

- Default outbound GPT Web loop: use whenever this skill is called and the user did not explicitly say `local apply asset` or `bước 3`. Perform the minimum safe attachment checks, package context, run Oracle dry-run, send GPT Web through browser mode, and stop after GPT Web finishes so the user can manually download the returned zip from the web tab.
- Existing context zip only: treat the provided/generated zip as completed step 1, then call GPT Web with that zip and the user's screenshots/observations.
- Local apply asset / returned GPT Web artifact: use this mode only when the user explicitly says `local apply asset` or asks to perform `bước 3` of this skill, and provides an explicit local path to a downloaded GPT Web returned `.zip` or explicitly identifies a non-zip handoff as the GPT Web returned fix artifact. Ordinary repo files named `handoff.md` or durable-note markdown files are context attachments only and do not satisfy this mode.

## Zip Selection

Resolve what to zip in this order:

1. explicit folders/files from the current user request;
2. any matching configured path in `oracle_runtime.local.json` field `active_path` when the user mentions that repo/path/name;
3. all entries in `active_path` when the user asks to use the configured package set without naming one path;
4. ask the user which folders/files to zip before calling GPT Web.

Do not guess a broad repository archive. `active_path` accepts both folders and files, either project-relative or absolute, for example `["src", "package.json", "/opt/one_hammer/.codex"]`. Files outside `RepoRoot` are stored under `external/...` inside the zip so the archive does not contain absolute paths.

`extra` is an object keyed by the exact `active_path` value. Supported per-path fields:

- `exclude`: additional package-specific excludes for that selected path.
- `prompt`: a task/config-specific prompt addendum to append near the end of the GPT Web prompt when that selected path is packaged.

```json
{
  "extra": {
    "/opt/one_hammer/.codex": {
      "exclude": ["/opt/one_hammer/.codex/claude-workers"]
    },
    "/opt/one_hammer/sdlc": {
      "exclude": [
        "/opt/one_hammer/sdlc/history",
        "/opt/one_hammer/sdlc/scripts",
        "*.png",
        "*.svg"
      ],
      "prompt": "Improve the maintainability and extensibility of the directly relevant code."
    }
  }
}
```

Pass the selected `active_path` entries as repeatable `--path` / `-Path` arguments and pass each selected entry's `extra[<path>].exclude` values as repeatable `--exclude` / `-Exclude` arguments. Excludes may be absolute paths, zip-entry-relative paths, or glob patterns such as `*.png` and `*.svg`. The bundled packagers automatically skip files and directories matched by the selected path's Git ignore rules using Git's own ignore machinery (`git ls-files --exclude-standard` and `git check-ignore --no-index`). `extra.exclude` is only for additional package-specific exclusions that are not already covered by `.gitignore`; there is no shared default exclude list.

Append each selected entry's `extra[<path>].prompt` as an explicit "Additional requirements" item near the end of the GPT Web prompt. Do not treat `extra.prompt` as a global requirement for unrelated paths.

## Required Flow

1. Resolve the Oracle runtime case:

```text
explicit user case > oracle_runtime.local.json > inferred local runner
```

When checking `oracle_runtime.local.json`, use the direct sibling path next to this skill file, e.g. `<skillDir>/oracle_runtime.local.json`. Do not search for it with a bounded `find -maxdepth`; a missed depth must not be treated as "no config exists".

Then read the matching case in [references/oracle_runtime_cases.md](references/oracle_runtime_cases.md). Do not load unrelated cases unless troubleshooting requires comparison.

2. Resolve the zip selection, then run or confirm the context packager output from the project root using the command style from the active runtime case.

Bundled Windows/PowerShell command:

```powershell
$skillDir = '<path-to-gpt-web-fix-flow-skill>'
& "$skillDir\scripts\package-gpt-web-context.ps1" -RepoRoot (Get-Location).Path -Path @('src', 'package.json')
```

Bundled Linux command:

```bash
skill_dir="<path-to-gpt-web-fix-flow-skill>"
"$skill_dir/scripts/package-gpt-web-context.sh" --repo-root "$PWD" --path src --path package.json
```

3. Ask GPT Web for the fix/feature/investigation. Attach the generated context zip plus any screenshots or short observations from the user.
4. When GPT Web finishes the response, stop. Report that the browser tab is kept open, point the user to the visible download link, and ask them to manually download the updated zip. For later local application, require the zip path plus an explicit `local apply asset` or `bước 3` request. Do not proceed from the response text alone.
5. Only after the user explicitly says `local apply asset` or asks for `bước 3`, and provides the downloaded GPT Web zip/handoff path, treat it as the authoritative fix artifact and apply its intended source changes, using only mechanical archive/path checks to avoid accidental bad extraction or unrelated overwrite.
6. Run the project-specific build, runtime patch, or asset-install steps documented by the repo or returned handoff.
7. Validate with the project's static checks and targeted runtime/protocol/UI checks.
8. Update durable project notes when the repo has an established notes/index system.

## GPT Web Request

Use the active runtime case in [references/oracle_runtime_cases.md](references/oracle_runtime_cases.md) for package, attachment staging, dry-run, and real Oracle command templates. Keep these invariants across all cases:

- Always run an Oracle dry run before opening the browser request.
- Use separate `--file` arguments for screenshots. Do not pass `--browser-bundle-files` when the user expects images to appear as separate ChatGPT attachments; Oracle will show only `attachments-bundle.zip`, which makes screenshot review harder to verify. Bundle files only when intentionally sending a large source-only context archive.
- Stage user screenshots into a temp attachment directory with unique ASCII filenames before the dry run and the real Oracle call, especially when source filenames contain spaces, repeated names like `copy`, shell metacharacters, or Vietnamese text. If the browser draft shows fewer image thumbnails than expected, do not treat the request as sent; retry with staged ASCII filenames and a longer `--browser-attachment-timeout`.
- Include `--max-file-size-bytes 2097152` on both Oracle dry-run and real browser calls. Oracle has rejected generated context zips above the default 1 MiB limit; the 2 MiB override allows typical bounded context zips plus screenshots to upload successfully.
- Prefer an English ASCII prompt with `Reply in Vietnamese`, especially through Windows shells. Direct Vietnamese prompts are acceptable only when the exact command path preserves the prompt as one argument.
- For an artifact-producing request, keep the browser tab available after Oracle finishes. Use `--browser-keep-browser` so the user can manually click the download link if automatic artifact collection fails, and use `--browser-archive never` so the conversation is not archived before the zip is checked.
- During long `oracle --engine browser` waits after the request has been sent successfully, poll the running command and send user-facing waiting-status updates about once every 3 minutes, unless completion, download availability, or an error appears sooner. Do not start duplicate Oracle requests just to provide more frequent status.
- If Oracle says a session with the same prompt is already running, reattach with `oracle session <slug>` instead of starting duplicates. Use `--force` only when a fresh conversation is explicitly intended.
- Avoid generic exclude patterns for single explicit screenshot/zip requests. In Oracle CLI 0.13 on Windows, commands such as `--file 'image copy.png' --file '!node_modules/**'` can fail with `No files matched the provided --file patterns`, even though the image itself matches. Use excludes only for directory/glob context bundles.

For cloud bridge cases, the browser tab and downloaded GPT Web zip are on the local browser host, while the repo and Codex may be on the cloud server. If the next step is `local apply asset` on the cloud server, require a cloud-readable path to the downloaded zip after the user copies/uploads it to the cloud.

Manual download gate: after GPT Web generates its response, do not continue into `local apply asset` / `Apply Returned Zip` in the same run unless the user has already provided the local downloaded zip path and explicitly asked for `local apply asset` or `bước 3`. End the turn with the response/output location, keep the browser tab available, and ask for the downloaded zip path plus one of those triggers.

## Package Context

Run the bundled project packager from the project root using the active runtime case command. Prefer the repo's own documented context packager only when it is safer or stricter for that repo.

Bundled packager locations:

- Windows/PowerShell: `scripts/package-gpt-web-context.ps1`
- Linux: `scripts/package-gpt-web-context.sh`

Both scripts require selected paths. They write a timestamped zip under `my_build/archive/gpt-web-context/` unless `OutputDir`/`--output-dir` is supplied. If the user provides the exact successful packager output and zip path, verify that zip exists and use it as the step 1 artifact. Re-run the packager only when the zip is missing, stale for the described task, or the user asks for a fresh package.

If no paths were supplied and `oracle_runtime.local.json` has no `active_path`, ask the user which folders/files to zip. Do not create an ad hoc broad repository zip unless the user explicitly asks for that and the archive can be bounded safely.

Use the generated zip as the attachment for GPT Web. Do not manually add logs, tools, database data, generated build outputs, backups, credentials, or large media unless the user explicitly asks and the data is safe.

When writing the GPT Web prompt, include:

- a plain English ASCII request with `Reply in Vietnamese` when running through Windows shells;
- the exact bug, feature, or investigation request;
- any task-specific requirements from the user, repo notes, screenshots, logs, or returned handoff;
- any selected `extra[<path>].prompt` values from `oracle_runtime.local.json`, appended near the end under "Additional requirements";
- the required output: an updated `.zip` file containing the fixed/updated files and instructions, with a clearly visible download link;
- any screenshots or short observations the user provided.

Do not always add root-cause guidance, maintainability/extensibility requests, scoped-refactor constraints, or legacy protocol/API constraints. Add those only when the user asks, the task clearly needs that analysis, repo instructions require it, or a selected `extra.prompt` supplies that requirement. The only universal GPT Web deliverable requirement is the updated zip with instructions and a visible download link.

Keep the prompt concise. If the user explicitly asks to use another GPT Web review skill, follow that skill, but preserve the same attachment rules and required zip-output rule: dry-run first, no screenshot bundling unless intentional, append task/config-specific requirements near the end, and save raw output.

Prompt shape:

```text
I am fixing a local project bug/feature. Read the attached context zip and screenshots/logs. Use only the attached files as context. Reply in Vietnamese.

Project: <short project/repo name if helpful>.
Problem: <short concrete description>.

Requirements:
- <task-specific requirements from the user, repo notes, screenshots, logs, or handoff>
- Return an updated .zip file containing the fixed/updated files and instructions, with a clearly visible download link.

Additional requirements:
- <append selected extra[<path>].prompt values and any user-requested special constraints here; omit this section if empty>

Attached files:
1. <context zip>
2. <screenshot/log/handoff if any>
```

## Local Apply Asset / Apply Returned Zip

Treat a GPT Web zip/handoff provided by the user as a trusted, authoritative fix artifact. The job is to apply the intended source changes from that zip into the live repo, then rebuild and validate. Do not stall by treating the GPT Web response as merely advisory, and do not re-litigate the whole diagnosis unless the zip is internally inconsistent or impossible to apply.

Do not enter this section merely because a file is named `handoff.md`, because a zip path is present, or because the user attached a local artifact. Require both:

- an explicit local-apply trigger: the user says `local apply asset` or asks for `bước 3` of this skill;
- a downloaded GPT Web fix zip path, unless the user explicitly identifies a non-zip handoff as the returned GPT Web fix artifact.

Still perform mechanical archive hygiene before writing files: list entries, extract to temp, avoid path traversal/absolute paths, and compare changed files so unrelated local edits are not overwritten accidentally. These checks are for applying the trusted handoff correctly, not for rejecting the GPT Web solution by default.

1. Read the user-provided handoff markdown first when present.
2. List zip entries without extracting directly into the repo.
3. Read `CHANGED_FILES.md` or the handoff's changed-file list inside the zip when present.
4. Extract only relevant changed files to a temp directory.
5. Compare temp files against the live repo using checksums and targeted diffs.
6. Apply the zip's intended source changes. Prefer precise merges when the repo has unrelated local edits; direct copy is acceptable when the zip file is the intended full replacement for that file.
7. Never blindly expand the whole zip over the workspace.

For runtime media/assets, install or compare them at the runtime path documented by the project or returned handoff. Do not copy media into durable notes just because the artifact packaged them there; keep only mapping, commands, validation rules, and handoff notes in durable documentation.

For source changes, preserve existing local fixes unless the handoff explicitly supersedes them and the diff confirms it. Keep legacy protocol values and aliases unless the handoff gives a concrete compatibility migration.

## Build And Validation

After source changes, run the project's documented build, patch, asset-install, and validation commands. Prefer commands named by the returned handoff or repo docs. If the repo has standard static checks, run them first, then run targeted compile/runtime/protocol/UI checks for the changed area.

Use project-specific examples only when they exist in the active repo. Do not assume specific runtimes, emulators, database schemas, frontend build tools, or protocol clients unless the project documents them.

Run `git diff --check` when the repo is git-tracked. Check logs only for focused patterns. Do not store raw log dumps in durable notes.

## Durable Notes

After a durable change, update the relevant project notes only if the repo has an established notes/index system. For repos using `my_build`, use the appropriate subfolder such as:

- bug fix: `my_build/bugs/`
- feature/tooling workflow: `my_build/features/`
- API/protocol contract: `my_build/specs/`
- handoff/status for future agents: `my_build/handoffs/`
- debug lesson/gotcha: `my_build/debug/` or `my_build/notes/gotchas.md`

Update manifests/indexes only when the project expects it. Do not commit raw zips, logs, temp extracts, scratch files, large generated artifacts, or runtime media copies into durable notes.

## Final Report

Report:

- files and runtime/build artifacts changed;
- commands run and whether they passed;
- observed runtime proof when available;
- anything not run;
- any unrelated dirty worktree state you intentionally left alone.
