# OneHammer — Claude Code Toolkit cho Vietnamese Developers

Bộ **skills, hooks, và setup scripts** cho [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — được xây dựng và dùng thực chiến bởi OneHammer, chia sẻ miễn phí cho cộng đồng developer Việt Nam.

---

## Có gì trong repo này?

| Công cụ | Loại | Mô tả |
|---------|------|-------|
| [GitNexus Setup](#gitnexus-setup) | Install/Uninstall scripts | One-command setup & teardown GitNexus cho fullstack project |
| [Codex Review Skill](#codex-review-skill) | Claude Code Skill | Dùng GPT làm reviewer thứ hai ngay trong terminal |
| [Planning Skill](#planning-skill) | Claude Code Skill | Pipeline lập kế hoạch feature 8-phase có kiểm soát |
| [OneHammer Forge Skill](#onehammer-forge-skill) | Claude Code Skill | Implementation mode — claim bead, implement, hand off |
| [Planning Guard Hook](#planning-guard-hook) | Claude Code Hook | Enforce phase gates và artifact invariants cho planning pipeline |

---

## GitNexus Setup

> One-command setup & teardown GitNexus cho fullstack project — hỗ trợ cả Linux/macOS và Windows.

### GitNexus là gì?

[GitNexus](https://www.npmjs.com/package/gitnexus) là công cụ xây dựng **knowledge graph** cho codebase — giúp Claude Code hiểu sâu hơn về codebase của bạn thay vì phải đọc từng file một.

Khi đã có GitNexus, Claude Code có thể:
- Tra cứu symbol, function, class qua MCP (`mcp__gitnexus__context`, `mcp__gitnexus__query`) thay vì dùng Grep/Glob
- Tự động nhận thông báo khi knowledge graph bị stale sau mỗi commit
- Làm việc nhanh hơn, chính xác hơn trên codebase lớn

### Script làm gì?

`setup-gitnexus.sh` tự động hóa toàn bộ quá trình setup trong **8 bước**:

| Bước | Mô tả |
|------|-------|
| 1 | Cài `gitnexus@latest` global (binary, không dùng npx) |
| 2 | Chạy `gitnexus setup` (configure editors, skills, hooks toàn cục) |
| 3 | Chạy `gitnexus analyze` (build knowledge graph → sinh ra `CLAUDE.md`, `AGENTS.md`, skills) |
| 4 | Chuyển MCP config từ `~/.mcp.json` → `.mcp.json` (project scope, dùng binary để tránh timeout) |
| 5 | Chuyển hooks từ `~/.claude/settings.json` → `.claude/settings.json` (project scope) |
| 6 | Cài custom hook JS (block Grep/Glob/Read + redirect sang Serena LSP + cascade context→query→augment) |
| 7 | Xóa global skills (project đã có skills riêng từ `analyze`) |
| 8 | Append workspace structure + technical guidelines vào `CLAUDE.md` |

### Tại sao cần script này?

Setup GitNexus thủ công mất ~15–20 phút, dễ sai, và khác nhau tùy môi trường. Script này làm toàn bộ trong ~1 phút, đồng nhất trên mọi machine.

Quan trọng hơn: script **đưa config về project scope** (thay vì global) — tránh conflict khi bạn làm nhiều project cùng lúc.

### Cài đặt

**Yêu cầu:**
- Node.js + npm
- `jq` (`apt install jq` hoặc `brew install jq`) — chỉ cần trên Linux/macOS
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) đã cài và hoạt động

**Linux / macOS — chạy từ project root:**

```bash
# Cài GitNexus
bash gitnexus/install_linux.sh

# Gỡ GitNexus (khi cần)
bash gitnexus/uninstall_linux.sh
```

**Windows — chạy từ project root (PowerShell):**

```powershell
# Cài GitNexus
powershell -ExecutionPolicy Bypass -File gitnexus/install_window.ps1

# Gỡ GitNexus (khi cần)
powershell -ExecutionPolicy Bypass -File gitnexus/uninstall_window.ps1
```

**Sau khi cài xong:**

```
  Knowledge graph:   n nodes
  MCP config:        .mcp.json
  Hook:              .claude/hooks/gitnexus/gitnexus-hook.cjs
  Project settings:  .claude/settings.json

  Next step: Restart Claude Code to reload MCP server.
```

Restart Claude Code là xong — GitNexus đã live.

### Hook hoạt động như thế nào?

Script cài một **PreToolUse hook** chặn Grep/Glob/Read trên code files và redirect Claude Code sang dùng Serena (LSP) hoặc GitNexus MCP thay thế:

```
Grep/Glob blocked — dùng Serena (LSP) hoặc GitNexus thay thế.

• mcp__serena__find_symbol({name: "MyClass"})
• mcp__gitnexus__context({name: "MyClass"})
• mcp__gitnexus__query({query: "MyClass"})
• Bash(grep / find)  ← escape hatch nếu MCP không đủ
```

Ngoài ra có **PostToolUse hook** tự động báo khi knowledge graph bị stale sau `git commit/merge/rebase`.

---

## Codex Review Skill

> Dùng codex làm **reviewer thứ hai** ngay trong terminal — không cần copy/paste sang tab khác.

Chi tiết đầy đủ: [codex/README.md](codex/README.md)

### Cài nhanh

```bash
mkdir -p .claude/skills
cp -r .claude/.skills/codex .claude/skills/
```

### Các lệnh

| Lệnh | Mô tả |
|------|-------|
| `/codex review code` | Review code vừa thay đổi (git diff) |
| `/codex review plan` | Review execution plan trước khi implement |
| `/codex review phương án` | So sánh và đánh giá các phương án |
| `/codex fix this bug` | Fix bug với reasoning sâu |

### Tại sao cần 2 model?

- **Claude** mạnh ở implement, triển khai, flow làm việc liên tục
- **GPT (xhigh)** mạnh ở phản biện, bóc giả định, soi lỗ hổng logic

Kết hợp cả hai = pass rate tăng từ **81% → 95%** trong benchmark thực tế (xem [codex/README.md](codex/README.md#eval-benchmark--proof-of-quality)).

---

## Planning Skill

> Pipeline lập kế hoạch feature **8 phase có kiểm soát** — từ discovery đến execution plan, không bỏ qua bước nào.

### Planning Skill là gì?

Thay vì để Claude Code đoán mò cách tiếp cận, Planning Skill ép buộc quy trình đầy đủ:

| Phase | Mô tả |
|-------|-------|
| 0 | Kickoff — xác nhận scope, đọc CLAUDE.md |
| 1–3 | Discovery — backend, frontend, integration |
| 4 | Approach — đề xuất và phê duyệt phương án |
| 5 | Contract — API/DB/component contracts chi tiết |
| 6 | Story map — beads/tasks breakdown |
| 7 | Validation — graph check, semantic-lite, hoặc deep validator |
| 8 | Execution plan — handoff cho forge |

Mỗi phase có **artifact cụ thể** (discovery.md, approach.md, contract, story-map). Hook `planning_guard` enforce không cho bỏ qua phase.

### Planning Validator Skill

`planning-validator` là **deep validation gate** cho phase 7 — dùng khi cần full/deep validation hoặc có rủi ro cao (payment, security, data migration).

### Cài nhanh

```bash
mkdir -p .claude/skills
cp -r .claude/.skills/planning .claude/skills/
cp -r .claude/.skills/planning-validator .claude/skills/
```

### Các lệnh

| Lệnh | Mô tả |
|------|-------|
| `/planning <feature>` | Bắt đầu pipeline planning cho feature |
| `/validate plan full` | Deep validation (invoke planning-validator) |
| `/validate plan deep` | Như trên |

---

## OneHammer Forge Skill

> **Implementation mode** — claim bead sẵn sàng, implement có scope rõ ràng, thu thập runtime evidence, hand off an toàn.

### Forge là gì?

Forge là skill thực thi — dùng sau khi planning xong và beads đã được tạo. Nó ép buộc workflow đúng thứ tự:

1. `br ready --json` → chọn bead (không fallback nếu list rỗng)
2. Lock ownership: `br update <id> --status=in_progress`
3. Agent Mail claim flow — reserve files
4. Load context bead-scoped — không scan toàn repo
5. GitNexus impact analysis trước khi edit bất kỳ symbol nào
6. Thu thập runtime evidence (curl/migration/screenshot) theo loại bead
7. Close bead với evidence cụ thể — không close với "Completed" chung chung

### Cài nhanh

```bash
mkdir -p .claude/skills
cp -r .claude/.skills/onehammer-forge .claude/skills/
```

### Kích hoạt

| Lệnh | Mô tả |
|------|-------|
| `/onehammer:forge` | Claim và implement bead sẵn sàng tiếp theo |
| `/onehammer:forge <bead-id>` | Implement bead cụ thể (phải có trong `br ready`) |

---

## Planning Guard Hook

> **PreToolUse + PostToolUse hook** enforce phase gates và artifact invariants cho planning pipeline — ngăn Claude Code bỏ qua bước quan trọng.

### Hook làm gì?

`planning_guard.mjs` chạy tự động mỗi khi Claude Code dùng tool trong session planning:

- **PreToolUse**: Chặn tool call nếu vi phạm phase ordering (ví dụ: cố write contract khi chưa có approach)
- **PostToolUse**: Kiểm tra artifact sau mỗi bước — đảm bảo output đúng schema

Không có external dependency — chỉ dùng Node built-ins, chạy offline.

### Cài nhanh

```bash
# Copy hook vào project
mkdir -p .claude/hooks
cp .claude/hooks/planning_guard.mjs .claude/hooks/
cp -r .claude/hooks/planning .claude/hooks/

# Đăng ký trong .claude/settings.json
# (xem README trong .claude/hooks/planning/ để biết cấu hình đầy đủ)
```

---

## Cấu trúc repo (đầy đủ)

```
community/
├── gitnexus/
│   ├── install_linux.sh
│   ├── install_window.ps1
│   ├── uninstall_linux.sh
│   └── uninstall_window.ps1
├── .claude/
│   ├── .skills/
│   │   ├── codex/SKILL.md              # Codex review skill
│   │   ├── planning/SKILL.md           # Planning pipeline skill
│   │   ├── planning-validator/SKILL.md # Deep validation skill
│   │   └── onehammer-forge/SKILL.md   # Implementation mode skill
│   └── hooks/
│       ├── planning_guard.mjs          # Hook entry point
│       └── planning/                   # Hook lib + validators
└── README.md
```

---

## Đóng góp

Đây là đóng góp của OneHammer cho cộng đồng developer sử dụng Claude Code. Nếu bạn thấy hữu ích:

- Cho repo một star
- Chia sẻ cho ae dev khác
- Đóng góp skills/hooks mới qua Pull Request

## Giấy phép

MIT License — tự do sử dụng, chỉnh sửa, và phân phối.

---

**OneHammer** — AI-powered development tools cho developer Việt Nam.
