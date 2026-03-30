# OneHammer — Claude Code Skills for Vietnamese Developers

Bộ skills cho [Claude Code](https://docs.anthropic.com/en/docs/claude-code) được xây dựng và sử dụng thực chiến bởi OneHammer.

## Codex Review Skill

Skill gọi [OpenAI Codex CLI](https://github.com/openai/codex) (GPT-5.4, xhigh reasoning) làm **reviewer thứ hai** ngay trong terminal — không cần copy/paste context sang tab khác.

### Tính năng

| Lệnh | Mô tả |
|------|-------|
| `/codex review code` | Review code vừa thay đổi (git diff) |
| `/codex review plan` | Review execution plan trước khi implement |
| `/codex review phương án` | So sánh và đánh giá các phương án |
| `/codex review ý tưởng` | Phân tích ý tưởng kinh doanh / kỹ thuật |
| `/codex review commit` | Review commit cụ thể |
| `/codex fix this bug` | Fix bug với reasoning sâu |

### Cài đặt

**Yêu cầu:**
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) đã cài và hoạt động
- [OpenAI Codex CLI](https://github.com/openai/codex) đã cài và có API key

**Cài skill:**

```bash
# Clone repo vào thư mục skills của project
mkdir -p .claude/skills
cp -r codex .claude/skills/
```

Sau đó trong Claude Code, gõ `/codex review code` để bắt đầu.

### Cách hoạt động

1. Bạn gõ `/codex review <gì đó>` trong Claude Code
2. Skill tự động gom context từ cuộc hội thoại (diff, file paths, intent)
3. Gửi cho GPT-5.4 với reasoning level cao nhất
4. Kết quả tự trả về — không cần chờ hay check lại

### Tại sao lại cần 2 model?

Mỗi model có thế mạnh khác nhau:
- **Claude** mạnh ở implement, triển khai, flow làm việc liên tục
- **GPT-5.4 (xhigh)** mạnh ở phản biện, bóc giả định, soi lỗ hổng logic

Kết hợp cả hai = góc nhìn rộng hơn, code/plan chất lượng hơn.

## Eval Benchmark — Proof of Quality

Toàn bộ benchmark và eval test được công khai minh bạch. Bạn có thể tự kiểm chứng.

### Kết quả tổng hợp

| Metric | With Skill | Without Skill | Delta |
|--------|-----------|--------------|-------|
| **Pass Rate (avg)** | **95%** | 81% | +14% |
| Pass Rate (range) | 86% – 100% | 43% – 100% | — |
| Duration (avg) | 374s | 313s | +62s |
| Tokens (avg) | 79,537 | 49,694 | +29,843 |

### Kết quả chi tiết theo Eval

| Eval | With Skill | Without Skill | Ghi chú |
|------|-----------|--------------|---------|
| **Review Code** | **86%** (6/7) | 43% (3/7) | Skill quan trọng nhất — fix wrong subcommand, thiếu flags |
| Review Phương án | 100% (8/8) | 100% (8/8) | Task đơn giản, cả hai đều pass |
| Review Plan | 100% (8/8) | 100% (8/8) | Pass như nhau, nhưng with-skill phân tích sâu hơn 8x tokens |

### Xem Benchmark tương tác

Mở file `codex-workspace/iteration-1/benchmark.html` trong browser để xem kết quả dạng dashboard với tabs, comparison charts, và chi tiết từng assertion.

### Cấu trúc thư mục

```
.claude/skills/
├── codex/
│   └── SKILL.md                    # Skill definition
└── codex-workspace/
    ├── evals.json                  # Eval definitions & assertions
    └── iteration-1/
        ├── benchmark.html          # Interactive dashboard
        ├── benchmark.json          # Full raw data
        ├── benchmark.md            # Summary table
        ├── review-code/            # Eval: review code
        ├── review-phuong-an/       # Eval: review options
        └── review-plan/            # Eval: review plan
            ├── eval_metadata.json  # Prompt & assertions
            ├── with_skill/         # Chạy CÓ skill
            │   ├── grading.json
            │   ├── timing.json
            │   └── outputs/
            │       ├── result.md
            │       └── metrics.json
            └── without_skill/      # Chạy KHÔNG CÓ skill
                ├── grading.json
                ├── timing.json
                └── outputs/
                    ├── result.md
                    └── metrics.json
```

## Đóng góp

Đây là đóng góp của OneHammer cho cộng đồng developer sử dụng Claude Code. Nếu bạn thấy hữu ích:

- Cho repo một star
- Chia sẻ cho ae dev khác
- Đóng góp skills mới qua Pull Request

## Giấy phép

MIT License — tự do sử dụng, chỉnh sửa, và phân phối.

---

**OneHammer** — AI-powered development tools cho developer Việt Nam.
