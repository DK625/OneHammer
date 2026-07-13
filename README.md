# OneHammer - Claude Code & Codex Toolkit cho developer Việt Nam

Bộ **skills, hooks, và setup scripts** do OneHammer dùng thực chiến cho Claude Code và Codex. Repo tập trung vào 4 nhóm việc chính:

- Tăng khả năng hiểu codebase bằng GitNexus.
- Chuẩn hóa planning và execution bằng Claude Code skills/hooks.
- Lấy second opinion từ Codex hoặc GPT Web.
- Đóng gói context an toàn khi cần gửi sang ChatGPT web.

---

## Thành phần

| Thành phần | Loại | Mục đích |
|---|---|---|
| [One-command Installer](#cài-đặt-one-command) | Script cài/gỡ | Cài toàn bộ scaffold + toolchain (br, bv, jq, GitNexus, Beads) bằng một lệnh curl |
| [Codex Review Skill](#codex-review-skill) | Claude Code skill | Gọi Codex làm reviewer thứ hai ngay trong terminal |
| [Planning Skill](#planning-skill) | Claude Code skill | Pipeline lập kế hoạch feature theo phase, có artifact và gate |
| [OneHammer Forge](#onehammer-forge) | Claude Code skill | Claim bead, implement, kiểm chứng runtime, handoff |
| [GPT Web Review](#gpt-web-review) | Claude Code skill | Gửi context sang ChatGPT web qua Oracle CLI, nhận raw response |
| [GPT Web Fix Flow](#gpt-web-fix-flow) | Codex skill | Đóng gói context, gửi GPT Web, chờ zip trả về, apply có gate |

---

## Cài đặt (one-command)

Đứng tại **thư mục gốc của project cần cài** (Linux/WSL/macOS, cần sẵn `git`, `curl`, Node.js + npm), chạy:

```bash
curl -fsSL \
  https://raw.githubusercontent.com/DK625/OneHammer/master/scripts/install.sh \
  | bash
```

Installer cài **thẳng vào thư mục hiện tại (cwd)** — đứng ở đâu cài vào đó, không tự dò git root. Muốn cài vào nơi khác thì dùng `--target <path>` hoặc `ONEHAMMER_TARGET_DIR`.

Một lệnh duy nhất sẽ:

- Copy scaffold OneHammer vào project: `.claude/hooks/`, `.claude/skills/{planning,onehammer-forge}`, `.claude/settings.json`, `.mcp.json`.
- Tự cài `jq` nếu chưa có (package manager hoặc official binary có checksum).
- Cài các CLI planning: `br`, `bv`, `gitnexus`, và khởi tạo Beads workspace (`.beads/`).
- Wire hook GitNexus user-level (`~/.claude/hooks/gitnexus/`) vào `.claude/settings.json` của project.
- Backup `settings.json`/`.mcp.json` cũ vào `.onehammer-backup/<timestamp>/` nếu nội dung khác.

Chạy lại lần hai an toàn (idempotent): không duplicate hook, không phá `.beads`, giữ nguyên file không liên quan trong `scripts/` và `.claude/hooks/`.

Gỡ cài đặt (chạy tại thư mục gốc của project):

```bash
curl -fsSL \
  https://raw.githubusercontent.com/DK625/OneHammer/master/scripts/uninstall.sh \
  | bash
```

Sau khi cài, restart Claude Code để reload MCP server và project settings.

### Lộ trình phân phối installer

**Giai đoạn hiện tại** — dùng raw GitHub, không cần domain riêng:

```bash
curl -fsSL \
  https://raw.githubusercontent.com/DK625/OneHammer/master/scripts/install.sh \
  | bash
```

**Khi chuẩn bị dùng ổn định trong công ty** — tạo tag để pin phiên bản:

```bash
curl -fsSL \
  https://raw.githubusercontent.com/DK625/OneHammer/v1.0.0/scripts/install.sh \
  | bash
```

**Khi muốn quy trình release chặt hơn** — dùng GitHub Release:

```bash
curl -fsSL \
  https://github.com/DK625/OneHammer/releases/download/v1.0.0/onehammer-install.sh \
  | bash
```

**Khi muốn URL đẹp, độc lập nền tảng** — gắn domain vào GitHub Pages:

```bash
curl -fsSL https://install.onehammer.bizflycloud.vn | bash
```

---

## Claude Code Skills

Các skill nằm trong `.claude/.skills/`. Để cài sang project khác:

```bash
mkdir -p .claude/skills
cp -r /path/to/OneHammer/.claude/.skills/<skill-name> .claude/skills/
```

### Codex Review Skill

Path: `.claude/.skills/codex`

Dùng Codex với reasoning cao để review code, plan, ý tưởng hoặc phương án. Skill hỗ trợ các intent như:

| Lệnh / intent | Mục đích |
|---|---|
| `/codex review code` | Review git diff hoặc code vừa thay đổi |
| `/codex review plan` | Review execution plan trước khi implement |
| `/codex review phương án` | So sánh trade-off giữa các phương án |
| `/codex review commit` | Review commit cụ thể |
| `/codex fix this bug` | Nhờ Codex phân tích và đề xuất fix |

Chi tiết: `.claude/.skills/codex/README.md` và `.claude/.skills/codex/SKILL.md`.

### Planning Skill

Path: `.claude/.skills/planning`

Pipeline planning bắt buộc cho feature có scope đáng kể. Luồng chuẩn:

| Phase | Kết quả chính |
|---|---|
| 0 | Pre-flight: kiểm tra dependencies/state, chạy index nền, tạo workspace `history/<feature>/` |
| 1 | Discovery 4 lane: Architecture, Patterns, Constraints do **main agent chạy trực tiếp** (GitNexus/Serena); External là **subagent duy nhất** (research bằng Exa/web) |
| 1.5 | Làm rõ business scope (12 câu hỏi PO-style, 3 vòng x 4) |
| 1.6 | Làm rõ test scope và evidence (8 câu hỏi, 2 vòng x 4) |
| 2 | Tổng hợp approach |
| 2.5 | Approval cho whole-feature phase plan |
| 3 | Contract chi tiết cho từng phase |
| 4 | Story map và approval cho decomposition |
| 5 | Materialize beads bằng script deterministic (`materialize_beads.mjs`) từ Bead Specs trong story-maps đã duyệt |
| 6 | Validate graph (0 cycles) + coverage — điểm dừng bắt buộc của pipeline (execution chỉ bắt đầu khi user yêu cầu) |

Artifacts chính nằm dưới `history/<feature>/`: `discovery-lanes/`, `discovery.md`, `requirements.md`, `test-scenarios.md`, `approach.md`, `phase-plan.md`, `contracts/`, `story-maps/`.

### OneHammer Forge

Path: `.claude/.skills/onehammer-forge`

Implementation mode sau khi planning đã tạo beads. Luồng bắt buộc:

1. Chạy `br ready --json` và chỉ chọn bead trong danh sách ready.
2. Lock ownership bằng `br update <id> --status=in_progress`.
3. Claim qua Agent Mail và reserve file surface nhỏ nhất.
4. Load bead-scoped context, không scan cả repo.
5. Dùng Serena/GitNexus để phân tích impact trước khi edit.
6. Implement BE/API/DB trước, rồi FE/UI nếu có.
7. Thu runtime evidence: test, curl/API, DB query, migration, browser screenshot khi cần.
8. Close bead chỉ khi evidence đã được ghi rõ trong close reason.

Kích hoạt bằng `/onehammer:forge` hoặc `/onehammer:forge <bead-id>`.

---

## GPT Web Review

Path: `.claude/.skills/gpt-web-review`

Skill gửi context từ Claude Code sang ChatGPT web qua Oracle CLI và trả lại raw response, không rewrite qua Claude.

Luồng chính:

1. Thu context an toàn: git diff, file liên quan, snippet cần thiết.
2. Gửi qua `oracle` CLI, hỗ trợ attachment bằng `--file`.
3. Lưu raw response vào `/opt/gpt-response`.
4. Trả nguyên văn phản hồi của GPT cho user.

Yêu cầu:

- Oracle CLI đã cài và login ChatGPT.
- Bridge/runtime setup theo `.claude/.skills/gpt-web-review/setup.md`.
- SSH target nên dùng alias `openclaw`, không hardcode IP hoặc `root@<ip>`.

Kích hoạt bằng `/gpt-web-review <câu hỏi>`.

---

## GPT Web Fix Flow

Path: `.codex/skills/gpt-web-fix-flow`

Đây là Codex skill cho quy trình outbound GPT Web có kiểm soát:

1. Đọc instruction repo và context tối thiểu.
2. Resolve Oracle runtime case từ `oracle_runtime.local.json`.
3. Đóng gói context bằng script trong `scripts/`.
4. Chạy Oracle dry run.
5. Gửi request sang GPT Web bằng browser mode.
6. Dừng lại để user tải zip kết quả từ ChatGPT web.
7. Chỉ apply zip khi user nói rõ `local apply asset` hoặc `bước 3`.

Packager có sẵn:

```bash
.codex/skills/gpt-web-fix-flow/scripts/package-gpt-web-context.sh --repo-root "$PWD" --path src
```

```powershell
& ".codex\skills\gpt-web-fix-flow\scripts\package-gpt-web-context.ps1" -RepoRoot (Get-Location).Path -Path @("src")
```

Runtime cases và alias `openclaw` được mô tả trong `.codex/skills/gpt-web-fix-flow/references/oracle_runtime_cases.md`.

---

## Cấu trúc repo

```text
OneHammer/
├── README.md
├── scripts/
│   ├── install.sh
│   └── uninstall.sh
├── .claude/
│   ├── settings.json
│   ├── .skills/
│   │   ├── codex/
│   │   ├── gpt-web-review/
│   │   ├── onehammer-forge/
│   │   └── planning/
│   └── hooks/
│       ├── planning_guard.mjs
│       └── planning/
└── .codex/
    └── skills/
        └── gpt-web-fix-flow/
```

---

## Đóng góp và giấy phép

Đây là bộ công cụ OneHammer chia sẻ cho cộng đồng developer dùng Claude Code/Codex. Bạn có thể dùng, chỉnh sửa và phân phối theo MIT License.

Nếu đóng góp thêm skill/hook/script, hãy giữ nguyên nguyên tắc: instruction rõ, workflow có gate, không hardcode secret/IP, và có cách kiểm chứng kết quả.
