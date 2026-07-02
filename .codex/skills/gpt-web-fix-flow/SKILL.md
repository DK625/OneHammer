---
name: gpt-web-fix-flow
description: >-
  Automate a project-agnostic GPT Web fix/develop/investigation loop: perform only minimal local checks, package bounded repo context and user artifacts as GPT Web attachments, run the Oracle dry run, send the request through GPT Web, automatically download/transfer the returned zip from the GPT Web response, then apply it when Oracle materializes it as a local/cloud-readable artifact. If the returned zip cannot be downloaded, transferred, or validated, report the failure. Use when the user explicitly names this skill, provides its path, says to use/follow the GPT Web fix flow, asks to debug/fix/develop/investigate a project with GPT Web review, asks to package context for GPT Web, or asks to run the package to GPT Web to returned-zip loop.
---

# GPT Web Fix Flow

## Overview

Use this skill for a bounded project loop: create a safe context zip, send it to GPT Web for a fix/spec/investigation, let Oracle collect the returned zip from the GPT Web response, then automatically apply that zip into the live repo when Oracle materializes a valid local or cloud-readable artifact. After the returned zip has been fully applied, validated, and no longer needed, delete both the applied returned zip artifact and the generated context zip that was sent to GPT Web, so stale fix/context packages do not accumulate. If the returned zip cannot be downloaded, transferred, found, validated, or safely applied, stop and report the failing step, raw output/session path when available, and the next exact recovery input needed.

Follow the current repo's local instructions first. Read `AGENTS.md` when present. If the repo uses durable notes such as `my_build/INDEX.md`, read only the task-routed files and the user-provided handoff/zip files. Do not assume project-specific paths, runtimes, protocols, or validation commands unless the active project documents them.

Before an outbound GPT Web request, resolve the Oracle runtime case from an explicit user case, `oracle_runtime.local.json`, or inferred local runner fallback, then read only the matching case in [references/oracle_runtime_cases.md](references/oracle_runtime_cases.md). `oracle_runtime.local.json` lives in this skill directory, at the same level as `SKILL.md`; check exactly `<skillDir>/oracle_runtime.local.json` before any fallback or broad filesystem search. Do not rely on `find` depth limits to discover it. The runtime case controls shell syntax, paths, and browser transport only; it must not change the project package -> dry-run -> GPT Web -> stop-for-zip flow.

Use the bundled context packagers in `scripts/package-gpt-web-context.ps1` and `scripts/package-gpt-web-context.sh` unless the active repo has a stricter documented packager. These scripts require explicit folders/files and accept either project-relative or absolute paths; do not package a hardcoded source set. Reusable package roots live in `oracle_runtime.local.json` field `active_path`, with per-root options in `extra`.

## Strict Trigger Contract

- When the user explicitly names this skill, references its path, or says "use/follow this skill", using this flow is mandatory, not advisory.
- When this skill is called, immediately run the outbound GPT Web path: perform only the minimum checks needed to make safe attachments, package context, dry-run Oracle, send GPT Web, wait for the returned zip, then automatically apply it if Oracle materializes a valid local/cloud-readable artifact. Do not ask which mode to use unless the request is impossible to package safely.
- For a bug/feature/investigation request with this skill named, run the full outbound loop: package context, dry-run Oracle, send GPT Web, download/materialize the returned zip, apply it, then validate. Do not choose a local-only investigation path.
- Keep orchestrator investigation minimal before GPT Web: read the skill, repo instructions, task-routed durable notes, user artifacts, and only the path/output checks needed to package and send the request. Do not scan source/data to solve the problem yourself unless applying a returned zip or validating a concrete fix.
- Do not require the phrases `local apply asset` or `bước 3` before applying a GPT Web returned artifact. Automatic application is allowed only when the artifact is the returned zip from the current outbound run, or when the user explicitly identifies a provided local/cloud-readable path as a GPT Web returned fix artifact. Ordinary repo files named `handoff.md`, context zips, or durable-note markdown files are attachments/context only and must not be applied merely because they exist.
- If the user provides a local artifact path without identifying it as a GPT Web returned fix artifact, treat it as an attachment/context candidate for GPT Web after basic existence, size, and filename checks.
- If packaging, Oracle/GPT Web, returned-zip download/transfer, archive validation, or application fails, report the failing step, raw output path if available, and the next exact command/path needed. Do not silently fall back to broad local analysis.
- Do not ask which Oracle runtime case to use when it can be resolved from the current user request or `oracle_runtime.local.json`. Ask only when no configured case exists and the runner OS cannot be inferred safely.

## Mode Selection

- Default outbound GPT Web loop: use whenever this skill is called and the user did not provide an already-returned GPT Web artifact path. Perform the minimum safe attachment checks, package context, run Oracle dry-run, send GPT Web through browser mode, wait for GPT Web to create the returned zip, let Oracle automatically download/transfer that response artifact, then apply it when Oracle materializes exactly one valid local/cloud-readable zip artifact. If no valid returned zip is available, report the download/transfer/validation failure and stop with the browser tab kept open.
- Existing context zip only: treat the provided/generated zip as completed step 1, then call GPT Web with that zip and the user's screenshots/observations.
- Apply returned GPT Web artifact: use this mode when the user provides an explicit local/cloud-readable path to a downloaded or transferred GPT Web returned `.zip`, or explicitly identifies a non-zip handoff as the GPT Web returned fix artifact. A trigger phrase is no longer required. Ordinary repo files named `handoff.md` or durable-note markdown files are context attachments only and do not satisfy this mode unless the user explicitly identifies them as the returned GPT Web fix artifact.

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
4. When GPT Web finishes, inspect Oracle output/session metadata for response artifacts. If Oracle downloaded/transferred exactly one valid local/cloud-readable `.zip` artifact from the current GPT Web response, immediately treat it as the authoritative fix artifact and continue to Apply Returned Zip without asking the user. If the returned zip was not downloaded/transferred, is missing, is invalid, or multiple ambiguous candidate zips exist, report the failure/ambiguity with the raw output/session path when available, keep the browser tab available, and stop. Do not apply from response text or a visible link alone.
5. Apply the returned artifact's intended source changes, using only mechanical archive/path checks to avoid accidental bad extraction or unrelated overwrite.
6. Run the project-specific build, runtime patch, or asset-install steps documented by the repo or returned handoff.
7. Validate with the project's static checks and targeted runtime/protocol/UI checks.
8. Update durable project notes when the repo has an established notes/index system.
9. After application, validation, and durable-note updates are complete, delete the applied returned zip artifact from the local/cloud-readable artifact path and delete the generated context zip that was sent to GPT Web for this run. Keep Oracle session metadata, browser transcript, response logs, user-provided attachments, and final diffs; delete only now-consumed generated zip artifacts unless the user explicitly asks to preserve them.

## GPT Web Request

Use the active runtime case in [references/oracle_runtime_cases.md](references/oracle_runtime_cases.md) for package, attachment staging, dry-run, and real Oracle command templates. Keep these invariants across all cases:

- Always run an Oracle dry run before opening the browser request.
- Use separate `--file` arguments for screenshots. Do not pass `--browser-bundle-files` when the user expects images to appear as separate ChatGPT attachments; Oracle will show only `attachments-bundle.zip`, which makes screenshot review harder to verify. Bundle files only when intentionally sending a large source-only context archive.
- Stage user screenshots into a temp attachment directory with unique ASCII filenames before the dry run and the real Oracle call, especially when source filenames contain spaces, repeated names like `copy`, shell metacharacters, or Vietnamese text. If the browser draft shows fewer image thumbnails than expected, do not treat the request as sent; retry with staged ASCII filenames and a longer `--browser-attachment-timeout`.
- Include `--max-file-size-bytes 2097152` on both Oracle dry-run and real browser calls. Oracle has rejected generated context zips above the default 1 MiB limit; the 2 MiB override allows typical bounded context zips plus screenshots to upload successfully.
- Prefer an English ASCII prompt with `Reply in Vietnamese`, especially through Windows shells. Direct Vietnamese prompts are acceptable only when the exact command path preserves the prompt as one argument.
- For an artifact-producing request, keep the browser tab available after Oracle finishes. Use `--browser-keep-browser` so the tab remains available if automatic artifact collection fails, and use `--browser-archive never` so the conversation is not archived before the zip is checked.
- During long `oracle --engine browser` waits after the request has been sent successfully, treat 15-20 minutes as normal for GPT Web to produce a response or downloadable artifact. Poll the running command and send user-facing waiting-status updates about once every 3 minutes, unless completion, download availability, or an error appears sooner; do not ask the user whether to keep waiting during this normal window, and do not start duplicate Oracle requests just to provide more frequent status.
- If Oracle says a session with the same prompt is already running, reattach with `oracle session <slug>` instead of starting duplicates. Use `--force` only when a fresh conversation is explicitly intended.
- Avoid generic exclude patterns for single explicit screenshot/zip requests. In Oracle CLI 0.13 on Windows, commands such as `--file 'image copy.png' --file '!node_modules/**'` can fail with `No files matched the provided --file patterns`, even though the image itself matches. Use excludes only for directory/glob context bundles.

For cloud bridge cases, the browser tab runs on the local browser host, while the repo and Codex may be on the cloud server. Prefer Oracle artifact transfer so the returned GPT Web zip is materialized at a cloud-readable path. If transfer/download succeeds and the zip validates, apply it automatically. If transfer/download fails or no cloud-readable zip is produced, report the failure and raw output/session path; do not ask for a trigger phrase.

Returned zip gate: after GPT Web generates its response, continue into Apply Returned Zip only when there is a local/cloud-readable returned artifact path that passes mechanical zip checks. If Oracle reports an artifact transfer/download error, no zip is materialized, or validation fails, report the failing step and stop. A later user-provided cloud-readable returned zip path can be applied without requiring `local apply asset` or `bước 3`.

## Package Context

Run the bundled project packager from the project root using the active runtime case command. Prefer the repo's own documented context packager only when it is safer or stricter for that repo.

Bundled packager locations:

- Windows/PowerShell: `scripts/package-gpt-web-context.ps1`
- Linux: `scripts/package-gpt-web-context.sh`

Both scripts require selected paths. They write a timestamped zip under `my_build/archive/gpt-web-context/` unless `OutputDir`/`--output-dir` is supplied. If the user provides the exact successful packager output and zip path, verify that zip exists and use it as the step 1 artifact. Re-run the packager only when the zip is missing, stale for the described task, or the user asks for a fresh package.

If no paths were supplied and `oracle_runtime.local.json` has no `active_path`, ask the user which folders/files to zip. Do not create an ad hoc broad repository zip unless the user explicitly asks for that and the archive can be bounded safely.

Use the generated zip as the attachment for GPT Web. Treat this generated context zip as temporary run state: after the returned artifact has been applied and validated successfully, delete it during cleanup unless the user explicitly asks to preserve it. Do not manually add logs, tools, database data, generated build outputs, backups, credentials, or large media unless the user explicitly asks and the data is safe.

When writing the GPT Web prompt, include:

- a plain English ASCII request with `Reply in Vietnamese` when running through Windows shells;
- the exact bug, feature, or investigation request;
- any task-specific requirements from the user, repo notes, screenshots, logs, or returned handoff;
- any selected `extra[<path>].prompt` values from `oracle_runtime.local.json`, appended near the end under "Additional requirements";
- the required output: an updated `.zip` file containing the fixed/updated files and instructions as a downloadable GPT Web response artifact that Oracle can collect automatically;
- any screenshots or short observations the user provided.

Do not always add root-cause guidance, maintainability/extensibility requests, scoped-refactor constraints, or legacy protocol/API constraints. Add those only when the user asks, the task clearly needs that analysis, repo instructions require it, or a selected `extra.prompt` supplies that requirement. The only universal GPT Web deliverable requirement is an updated zip with instructions, returned as a downloadable GPT Web response artifact that Oracle can collect automatically.

Keep the prompt concise. If the user explicitly asks to use another GPT Web review skill, follow that skill, but preserve the same attachment rules and required zip-output rule: dry-run first, no screenshot bundling unless intentional, append task/config-specific requirements near the end, and save raw output.

Prompt shape:

```text
I am fixing a local project bug/feature. Read the attached context zip and screenshots/logs. Use only the attached files as context. Reply in Vietnamese.

Project: <short project/repo name if helpful>.
Problem: <short concrete description>.

Requirements:
- <task-specific requirements from the user, repo notes, screenshots, logs, or handoff>
- Return an updated .zip file containing the fixed/updated files and instructions as a downloadable response artifact that Oracle can collect automatically.

Additional requirements:
- <append selected extra[<path>].prompt values and any user-requested special constraints here; omit this section if empty>

Attached files:
1. <context zip>
2. <screenshot/log/handoff if any>
```

## Auto Apply Returned Zip / Apply Returned Zip

Treat a GPT Web zip/handoff returned by the current outbound run, or a user-provided path explicitly identified as a GPT Web returned fix artifact, as a trusted, authoritative fix artifact. The job is to apply the intended source changes from that zip into the live repo, then rebuild and validate. Do not stall by treating the GPT Web response as merely advisory, and do not re-litigate the whole diagnosis unless the zip is internally inconsistent or impossible to apply.

Enter this section automatically when Oracle downloads/transfers and materializes a valid returned zip from the current GPT Web response. Also enter it when the user provides a cloud-readable path and explicitly identifies that path as the GPT Web returned fix artifact. Do not enter it merely because a file is named `handoff.md`, because a zip path exists, or because the user attached a local artifact as context.

Required inputs:

- a local/cloud-readable artifact path from the current GPT Web run, or a user-identified GPT Web returned fix artifact path;
- a valid `.zip`, unless the user explicitly identifies a non-zip handoff as the returned GPT Web fix artifact.

If Oracle or the bridge fails to download/transfer the returned zip, report that failure and stop. Do not try to apply source changes from response text, a `sandbox:` link, or a visible browser link without a validated local/cloud-readable artifact file.

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

## Flow Artifact Cleanup

Once `Apply Returned Zip`, build/runtime steps, validation, and durable-note updates have all succeeded, remove the generated zip artifacts that were just consumed: the returned GPT Web fix zip and the context zip created for upload to GPT Web. At that point the live repo and validation output are the durable result, and both zips are only stale duplicate state.

Cleanup rules:

- Delete only the returned artifact zip that was applied in the current run, or the user-identified returned artifact zip that was just applied.
- Delete the generated context zip that was sent to GPT Web in the same successful run when it was created by this flow's packager. If the user supplied an existing context zip as an input artifact, do not delete it unless they explicitly ask.
- Do not delete user-provided source attachments, screenshots, logs, Oracle session metadata, browser transcripts, or response text unless the user explicitly asks.
- Do not delete the returned zip when download/transfer, archive validation, apply, build, runtime patch, validation, or durable-note update failed; keep it available for troubleshooting and report its path.
- If multiple returned artifact zips were ambiguous and no apply happened, delete none.
- If apply or validation fails, keep the generated context zip as well, because it may be needed to reproduce or rerun the GPT Web request.
- Report every deleted zip path in the final report. If deletion fails, report the failure and the exact path that still needs manual cleanup, but do not undo the applied source changes.

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
- returned GPT Web zip artifact path and generated context zip path deleted after successful local apply, or why either was kept;
- observed runtime proof when available;
- anything not run;
- any unrelated dirty worktree state you intentionally left alone.
