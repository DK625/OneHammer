# Oracle Runtime Cases

This file defines where Oracle CLI runs and where the signed-in ChatGPT browser lives. It does not change the project GPT Web flow.

## Table Of Contents

- Runtime resolution
- Shared Oracle rules
- Case 1: `case1_local_windows`
- Case 2: `case2_cloud_linux_to_local_linux`
- Case 3: `case3_cloud_linux_to_local_windows`
- Bridge troubleshooting

## Runtime Resolution

Resolve the active case in this order:

1. an explicit case named by the user in the current request;
2. `oracle_runtime.local.json` in this skill directory, at the same level as `SKILL.md`;
3. inferred local runner fallback.

When resolving `oracle_runtime.local.json`, construct the direct path from the skill directory, for example `<skillDir>/oracle_runtime.local.json`, and test that exact file before falling back. Do not use a bounded filesystem search such as `find -maxdepth` to decide whether this config exists; a search-depth miss is not evidence that the config is absent.

If no case is configured and the runner is clearly Windows, use `case1_local_windows`. If the runner is Linux and no config exists, ask for the case because Linux can be either a local desktop browser host or a cloud runner.

Current supported case names:

```text
case1_local_windows
case2_cloud_linux_to_local_linux
case3_cloud_linux_to_local_windows
```

Expected JSON shape:

```json
{
  "activeCase": "case2_cloud_linux_to_local_linux",
  "active_path": [
    "/opt/one_hammer/.codex",
    "/opt/one_hammer/sdlc"
  ],
  "extra": {
    "/opt/one_hammer/.codex": {
      "exclude": [
        "/opt/one_hammer/.codex/claude-workers"
      ]
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

`active_path` controls package roots. `extra[<path>].exclude` controls explicit per-root excludes. `extra[<path>].prompt` is a per-root GPT Web prompt addendum to append near the end of the prompt when that root is selected. None of these fields change the active Oracle runtime case. The command examples below use the current one_hammer cloud values.

## Shared Oracle Rules

Always run the dry run first. Use the same file list for the dry run and real browser call.

Required browser call flags:

```text
--engine browser
--model gpt-5.5
--max-file-size-bytes 2097152
--browser-thinking-time extended
--browser-model-strategy current
--browser-attachments auto
--browser-attachment-timeout 600s
--browser-keep-browser
--browser-archive never
```

Use `--browser-model-strategy current` because the ChatGPT UI may expose the model as `Thinking - Extended` instead of a stable `GPT-5.5 Pro` option.

Use separate `--file` arguments for screenshots. Stage files to unique ASCII filenames before dry-run and real send.

Prompt style:

```text
I am fixing a local project bug/feature. Read the attached context zip and screenshots/logs. Use only the attached files as context. Reply in Vietnamese.

Project: <short project/repo name if helpful>.
Problem: <short concrete bug/feature description>.

Requirements:
- <task-specific requirements from the user, repo notes, screenshots, logs, or handoff>
- Return an updated .zip file containing the fixed/updated files and instructions, with a clearly visible download link.

Additional requirements:
- <append selected extra[<path>].prompt values and any user-requested special constraints here; omit this section if empty>

Attached files:
1. <context zip>
2. <screenshot/log/handoff>
```

## Context Packager Commands

Run from the project root. Use the bundled script in this skill unless the repo has a stricter documented packager. Resolve included paths from the current user request first, then matching entries in `oracle_runtime.local.json` field `active_path`; if neither exists, ask the user what folders/files to zip. Paths may be project-relative or absolute. Files outside `RepoRoot` are stored under `external/...` inside the zip.

For configured paths, pass each selected `active_path` entry as `--path` / `-Path`. Pass excludes from the selected path's `extra[<path>].exclude` as repeatable `--exclude` / `-Exclude`. Excludes may be absolute paths, zip-entry-relative paths, or glob patterns such as `*.png` and `*.svg`. The bundled packagers automatically skip files and directories matched by the selected path's Git ignore rules using Git's own ignore machinery (`git ls-files --exclude-standard` and `git check-ignore --no-index`). `extra.exclude` is only for additional package-specific exclusions that are not already covered by `.gitignore`; there is no shared default exclude list. Append selected `extra[<path>].prompt` values to the GPT Web prompt as additional requirements; do not pass them to the packager.

Windows/PowerShell bundled script:

```powershell
$skillDir = '<path-to-gpt-web-fix-flow-skill>'
& "$skillDir\scripts\package-gpt-web-context.ps1" -RepoRoot (Get-Location).Path -NamePrefix 'gpt-web-context' -Path @('src', 'package.json')
```

Linux bundled script:

```bash
skill_dir="<path-to-gpt-web-fix-flow-skill>"
"$skill_dir/scripts/package-gpt-web-context.sh" --repo-root "$PWD" --name-prefix gpt-web-context --path src --path package.json
```

Configured absolute-path example:

```bash
skill_dir="<path-to-gpt-web-fix-flow-skill>"
"$skill_dir/scripts/package-gpt-web-context.sh" --repo-root "$PWD" --name-prefix gpt-web-context \
  --path /opt/one_hammer/sdlc \
  --exclude /opt/one_hammer/sdlc/history \
  --exclude /opt/one_hammer/sdlc/scripts \
  --exclude '*.png' \
  --exclude '*.svg'
```

The expected zip output is under `my_build/archive/gpt-web-context/`.

## Case 1: `case1_local_windows`

Use when Codex/Claude, the project repo, Oracle CLI, and the signed-in ChatGPT browser all run on the same Windows workstation.

Package context from the project root:

```powershell
$skillDir = '<path-to-gpt-web-fix-flow-skill>'
& "$skillDir\scripts\package-gpt-web-context.ps1" -RepoRoot (Get-Location).Path -NamePrefix 'gpt-web-context' -Path @('src', 'package.json')
```

Stage screenshots or other individual attachments:

```powershell
$attachmentDir = Join-Path $env:TEMP 'gpt-web-attachments'
New-Item -ItemType Directory -Force -Path $attachmentDir | Out-Null
Copy-Item -LiteralPath 'image copy.png' -Destination (Join-Path $attachmentDir 'screenshot-1.png') -Force
Copy-Item -LiteralPath 'image 1.png' -Destination (Join-Path $attachmentDir 'screenshot-2.png') -Force
Copy-Item -LiteralPath 'image 2.png' -Destination (Join-Path $attachmentDir 'screenshot-3.png') -Force
```

Dry run:

```powershell
oracle --dry-run summary `
  --max-file-size-bytes 2097152 `
  -p "Project bug investigation. Reply in Vietnamese." `
  --browser-attachments auto `
  --file "my_build\archive\gpt-web-context\<context>.zip" `
  --file "$attachmentDir\screenshot-1.png" `
  --file "$attachmentDir\screenshot-2.png" `
  --file "$attachmentDir\screenshot-3.png"
```

Foreground send:

```powershell
$outDir = Join-Path $env:TEMP 'gpt-response'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outFile = Join-Path $outDir "$(Get-Date -Format 'yyyyMMdd-HHmmss')-oracle-response.txt"
$prompt = @'
<use the shared prompt style above>
'@

oracle --engine browser `
  --model gpt-5.5 `
  --max-file-size-bytes 2097152 `
  --browser-thinking-time extended `
  --browser-model-strategy current `
  --browser-attachments auto `
  --browser-attachment-timeout 600s `
  --browser-keep-browser `
  --browser-archive never `
  -p $prompt `
  --file "my_build\archive\gpt-web-context\<context>.zip" `
  --file "$attachmentDir\screenshot-1.png" `
  --file "$attachmentDir\screenshot-2.png" `
  --file "$attachmentDir\screenshot-3.png" `
  2>&1 | Tee-Object -FilePath $outFile
```

For a background request on Windows, do not use `Start-Process -FilePath 'oracle'`; the npm PowerShell wrapper can fail with `%1 is not a valid Win32 application` or split a multi-word prompt into many arguments. Create a small temp Node runner that calls `@steipete/oracle/dist/bin/oracle-cli.js` via `spawn(process.execPath, args, { cwd, windowsHide: true })`, with `-p` and the prompt as adjacent array entries. Keep the same Oracle flags as the foreground send and include a unique `--slug`.

## Case 2: `case2_cloud_linux_to_local_linux`

Use when Codex/Claude and the project repo run on the cloud Linux server, while ChatGPT Web runs in Chrome on a local Ubuntu/Linux desktop.

Local Ubuntu browser host setup:

```bash
npm install -g @steipete/oracle@latest
ssh -o BatchMode=yes openclaw true
oracle bridge host \
  --bind 127.0.0.1:9473 \
  --token f667af3845a136e7a1d6573a1d0ecff2 \
  --ssh openclaw \
  --ssh-remote-port 9473 \
  --ssh-extra-args "-o ExitOnForwardFailure=yes" \
  --foreground \
  --print
```

If Ubuntu uses a non-default SSH key, add:

```bash
--ssh-identity ~/.ssh/<key-file>
```

Keep this terminal open. It owns both the bridge and the local Chrome manual-login profile.

Local Ubuntu files:

```text
~/.oracle/bridge-connection.json
~/.oracle/browser-profile
```

If Oracle sees the correct Chrome profile but loads `0` ChatGPT cookies and logs `Failed to read Linux keyring via secret-tool`, install the missing keyring helper:

```bash
sudo apt-get update
sudo apt-get install -y libsecret-tools
```

Cloud Linux one-time/client setup:

```bash
npm install -g @steipete/oracle@latest
oracle bridge client --connect 'oracle+tcp://127.0.0.1:9473?token=f667af3845a136e7a1d6573a1d0ecff2'
curl -s http://127.0.0.1:9473/status
curl -s -H "Authorization: Bearer f667af3845a136e7a1d6573a1d0ecff2" http://127.0.0.1:9473/health
```

If Oracle opens Chrome on the cloud server in this case, stop. The bridge config is missing or stale; rerun `oracle bridge client --connect ...` on the cloud server and retest `/health`.

Package context from the project root on cloud Linux:

```bash
skill_dir="<path-to-gpt-web-fix-flow-skill>"
"$skill_dir/scripts/package-gpt-web-context.sh" --repo-root "$PWD" --name-prefix gpt-web-context --path src --path package.json
```

For zip listing/metadata on cloud Linux, use Python's built-in zipfile module: `python3 -m zipfile -l <context>.zip`; do not require `zipinfo` or `unzip`.

Stage screenshots or other individual attachments:

```bash
attachment_dir="${TMPDIR:-/tmp}/gpt-web-attachments"
mkdir -p "$attachment_dir"
cp -- "image copy.png" "$attachment_dir/screenshot-1.png"
cp -- "image 1.png" "$attachment_dir/screenshot-2.png"
cp -- "image 2.png" "$attachment_dir/screenshot-3.png"
```

Dry run:

```bash
oracle --dry-run summary \
  --max-file-size-bytes 2097152 \
  -p "Project bug investigation. Reply in Vietnamese." \
  --browser-attachments auto \
  --file "my_build/archive/gpt-web-context/<context>.zip" \
  --file "$attachment_dir/screenshot-1.png" \
  --file "$attachment_dir/screenshot-2.png" \
  --file "$attachment_dir/screenshot-3.png"
```

Foreground send:

```bash
out_dir="${TMPDIR:-/tmp}/gpt-response"
mkdir -p "$out_dir"
out_file="$out_dir/$(date +%Y%m%d-%H%M%S)-oracle-response.txt"
prompt="$(cat <<'PROMPT'
<use the shared prompt style above>
PROMPT
)"

oracle --engine browser \
  --model gpt-5.5 \
  --max-file-size-bytes 2097152 \
  --browser-thinking-time extended \
  --browser-model-strategy current \
  --browser-attachments auto \
  --browser-attachment-timeout 600s \
  --browser-keep-browser \
  --browser-archive never \
  -p "$prompt" \
  --file "my_build/archive/gpt-web-context/<context>.zip" \
  --file "$attachment_dir/screenshot-1.png" \
  --file "$attachment_dir/screenshot-2.png" \
  --file "$attachment_dir/screenshot-3.png" \
  2>&1 | tee "$out_file"
```

Download handoff rule: the browser and download UI are on local Ubuntu. If the next step runs on cloud Linux, the user must copy/upload the downloaded GPT Web zip to a cloud-readable path and then request `local apply asset` or `bước 3` with that cloud path.

## Case 3: `case3_cloud_linux_to_local_windows`

Use when Codex/Claude and the project repo run on the cloud Linux server, while ChatGPT Web runs in Chrome on a local Windows workstation.

Local Windows browser host setup:

```powershell
npm install -g @steipete/oracle@latest
ssh -o BatchMode=yes openclaw true
oracle bridge host --bind 127.0.0.1:9473 --token f667af3845a136e7a1d6573a1d0ecff2 --ssh openclaw --ssh-remote-port 9473 --ssh-extra-args "-o ExitOnForwardFailure=yes" --foreground --print
```

If Windows uses a non-default SSH key, add:

```powershell
--ssh-identity "$env:USERPROFILE\.ssh\<key-file>"
```

Keep the PowerShell window open. It owns both the bridge and the local Chrome manual-login profile.

Local Windows files:

```text
C:\Users\<user>\.oracle\bridge-connection.json
C:\Users\<user>\.oracle\browser-profile
```

Cloud Linux setup and Oracle command templates are the same as case 2:

```bash
oracle bridge client --connect 'oracle+tcp://127.0.0.1:9473?token=f667af3845a136e7a1d6573a1d0ecff2'
curl -s http://127.0.0.1:9473/status
curl -s -H "Authorization: Bearer f667af3845a136e7a1d6573a1d0ecff2" http://127.0.0.1:9473/health
```

Use the case 2 Linux/cloud package, staging, dry-run, and foreground send commands.

Download handoff rule: the browser and download UI are on local Windows. If the next step runs on cloud Linux, the user must copy/upload the downloaded GPT Web zip to a cloud-readable path and then request `local apply asset` or `bước 3` with that cloud path.

## Bridge Troubleshooting

Use fixed token `f667af3845a136e7a1d6573a1d0ecff2` for these shared one_hammer bridge cases. Do not use `--token auto` when multiple machines may share one cloud server, because cloud config can keep an old token and return `unauthorized`.

Use `127.0.0.1`, not `localhost`, in bridge and manual SSH tunnel commands. This avoids IPv4/IPv6 mismatch failures such as `socket hang up`, `Empty reply from server`, or `connect to 127.0.0.1 port 9473 failed`.

Only one local host can own cloud remote port `9473` at a time. On the cloud server:

```bash
lsof -nP -iTCP:9473 -sTCP:LISTEN
lsof -nP -tiTCP:9473 -sTCP:LISTEN | xargs -r kill
```

If `oracle bridge host` logs `ssh tunnel exited (code 255)`, first suspect a stale reverse tunnel or another bridge session already owning cloud port `9473`.

On the local Linux browser host, check and kill old manual SSH tunnels:

```bash
ps -ef | grep 'ssh -N -R 9473' | grep -v grep
kill <pid>
```

Also close old `oracle bridge host` terminals before starting a new one. If the cloud listener reappears immediately after kill, another local bridge host is still running and reconnecting.

If port `9473` must stay occupied temporarily, use a different remote port:

Local browser host:

```bash
oracle bridge host \
  --bind 127.0.0.1:9473 \
  --token f667af3845a136e7a1d6573a1d0ecff2 \
  --ssh openclaw \
  --ssh-remote-port 9474 \
  --ssh-extra-args "-o ExitOnForwardFailure=yes" \
  --foreground \
  --print
```

Cloud Linux:

```bash
oracle bridge client --connect 'oracle+tcp://127.0.0.1:9474?token=f667af3845a136e7a1d6573a1d0ecff2'
```

If `/status` succeeds but `/health` returns `unauthorized`, restart the local `oracle bridge host` with the fixed token and rerun `oracle bridge client --connect ...` on cloud Linux.
