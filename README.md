# OneHammer — Claude Code Toolkit cho Vietnamese Developers

Bộ **skills, hooks, và setup scripts** cho [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — được xây dựng và dùng thực chiến bởi OneHammer, chia sẻ miễn phí cho cộng đồng developer Việt Nam.

---

## Có gì trong repo này?

| Công cụ | Loại | Mô tả |
|---------|------|-------|
| [GitNexus Setup](#gitnexus-setup) | Install/Uninstall scripts | One-command setup & teardown GitNexus cho fullstack project |
| [Codex Review Skill](#codex-review-skill) | Claude Code Skill | Dùng GPT làm reviewer thứ hai ngay trong terminal |

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

## Cấu trúc repo

```
OneHammer/
├── gitnexus/
│   ├── install_linux.sh       # Cài GitNexus — Linux/macOS
│   ├── install_window.ps1     # Cài GitNexus — Windows (PowerShell)
│   ├── uninstall_linux.sh     # Gỡ GitNexus — Linux/macOS
│   └── uninstall_window.ps1   # Gỡ GitNexus — Windows (PowerShell)
├── codex/
│   └── README.md              # Codex Skill — hướng dẫn đầy đủ
└── .claude/.skills/
    ├── codex/
    │   └── SKILL.md           # Codex skill definition
    └── codex-workspace/       # Eval benchmark data
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
