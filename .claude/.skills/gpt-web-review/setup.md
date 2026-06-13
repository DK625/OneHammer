# Setup Oracle Bridge: Windows → Cloud Linux

## Mục tiêu

Dùng **ChatGPT web trên máy Windows** làm browser host, còn **Claude Code / Oracle CLI chạy trên cloud Linux** gọi ngược về qua SSH tunnel.

Luồng:

```text
Cloud Linux / Claude Code
→ Oracle CLI/MCP
→ SSH reverse tunnel
→ Windows Chrome đã login ChatGPT
→ ChatGPT trả kết quả về server
```

---

# A. Setup lần đầu trên Windows

## 1. Cài Oracle trên PowerShell

```powershell
npm i -g @steipete/oracle
npm install -g @steipete/oracle@latest
```

## 2. Chạy Oracle bridge host

Chạy **một dòng duy nhất** trong PowerShell:

```powershell
oracle bridge host --bind 127.0.0.1:9473 --token f667af3845a136e7a1d6573a1d0ecff2 --ssh root@45.124.94.77 --ssh-remote-port 9473 --ssh-extra-args "-o ExitOnForwardFailure=yes" --foreground --print
```

Sau khi chạy, nó sẽ tạo file:

```text
C:\Users\noname\.oracle\bridge-connection.json
```

Nó cũng sẽ mở Chrome profile riêng:

```text
C:\Users\noname\.oracle\browser-profile
```

## 3. Login ChatGPT trong Chrome vừa mở

Đăng nhập ChatGPT như bình thường.

Sau khi login xong, **không tắt PowerShell đang chạy `oracle bridge host`**.

Cửa sổ đó phải để mở để giữ bridge.

Lệnh này thay cho cách chạy 2 terminal (`oracle serve` + `ssh -R`). Nó tự:

```text
1. bind Oracle host ở Windows 127.0.0.1:9473
2. mở SSH reverse tunnel về cloud 127.0.0.1:9473
3. mở Chrome manual-login profile để dùng ChatGPT web
```

---

# B. Đẩy connection file lên cloud server

Nếu setup lần đầu, có thể copy connection file lên server.

Mở **PowerShell mới**, chạy:

```powershell
scp C:\Users\noname\.oracle\bridge-connection.json root@45.124.94.77:~/bridge-connection.json
```

Hoặc dùng trực tiếp connection string mà `--print` in ra:

```bash
oracle bridge client --connect 'oracle+tcp://127.0.0.1:9473?token=f667af3845a136e7a1d6573a1d0ecff2'
```

---

# C. Setup trên cloud Linux

## 1. SSH vào server

```powershell
ssh root@45.124.94.77
```

## 2. Dùng Node 24

```bash
source ~/.nvm/nvm.sh
nvm install 24
nvm use 24
```

Check lại:

```bash
node --version
```

Nên ra kiểu:

```text
v24.x.x
```

## 3. Cài pnpm nếu cần

```bash
npm install -g pnpm@10
```

## 4. Cài Oracle trên server

```bash
npm install -g @steipete/oracle@latest
```

## 5. Kết nối server với bridge host

Dùng connection file đã copy:

```bash
oracle bridge client --connect ~/bridge-connection.json
```

Hoặc dùng thẳng connection string:

```bash
oracle bridge client --connect 'oracle+tcp://127.0.0.1:9473?token=f667af3845a136e7a1d6573a1d0ecff2'
```

Nếu thành công sẽ thấy:

```text
Remote service OK (127.0.0.1:9473)
Wrote remote config to /root/.oracle/config.json
```

---

# D. Test Oracle từ cloud server

Không dùng mặc định `gpt-5.5-pro` vì dễ lỗi:

```text
Unable to find model option matching "GPT-5.5 Pro"
```

Dùng lệnh này:

```bash
oracle --engine browser \
  --model gpt-5.5 \
  --browser-thinking-time extended \
  --browser-model-strategy current \
  -p "Say hello from Oracle bridge"
```

Nếu thành công sẽ ra:

```text
Answer:
Hello from Oracle bridge 👋
```

Ghi nhớ: `--browser-model-strategy current` rất quan trọng, vì ChatGPT UI của ông đang hiện model là:

```text
Thinking • Extended
```

chứ không hiện đúng option tên `"GPT-5.5 Pro"`.

---

# E. Tạo MCP config cho Claude Code

Vào thư mục project trên server:

```bash
cd /opt/one_hammer
```

Tạo `.mcp.json`:

```bash
oracle bridge claude-config > .mcp.json
```

Sau đó mở lại Claude Code trong project này.

Nếu đúng, Claude Code sẽ thấy MCP Oracle, thường là:

```text
mcp__oracle__consult
mcp__oracle__sessions
```

---

# F. Khi dùng với skill Oracle Spec Bridge

Gọi trong Claude Code:

```text
/oracle-spec-bridge spec phân tích lại planning skill và onehammer:forge command, tạo spec chi tiết để Minimax implement
```

Nhưng cần sửa skill để tránh gọi nhầm `gpt-5.5-pro`.

Trong phần Oracle call, ưu tiên dùng config kiểu này:

```json
{
  "engine": "browser",
  "model": "gpt-5.5",
  "browserThinkingTime": "extended",
  "browserModelStrategy": "current"
}
```

Nếu dùng CLI fallback thì dùng:

```bash
oracle --engine browser \
  --model gpt-5.5 \
  --browser-thinking-time extended \
  --browser-model-strategy current \
  -p "<prompt>"
```

---

# G. Lần sau dùng lại thì chỉ cần

## Trên Windows

Mở PowerShell:

```powershell
oracle bridge host --bind 127.0.0.1:9473 --token f667af3845a136e7a1d6573a1d0ecff2 --ssh root@45.124.94.77 --ssh-remote-port 9473 --ssh-extra-args "-o ExitOnForwardFailure=yes" --foreground --print
```

Để nguyên cửa sổ đó chạy.

Nếu Chrome mở ra và đã login rồi thì không cần login lại.

## Trên server

Nếu đã có config rồi, thường chỉ cần test:

```bash
oracle --engine browser \
  --model gpt-5.5 \
  --browser-thinking-time extended \
  --browser-model-strategy current \
  -p "hello"
```

Sau đó vào Claude Code dùng skill như bình thường.

---

# Các lỗi đã gặp và cách xử lý

## Lỗi 1

```text
unknown option '--write-config'
```

Cách sửa:

```bash
oracle bridge client --connect ~/bridge-connection.json
```

Không thêm `--write-config`.

## Lỗi 2

```text
Unable to find model option matching "GPT-5.5 Pro"
Available: Instant, Thinking• Extended, Configure...
```

Cách sửa:

```bash
--model gpt-5.5
--browser-model-strategy current
```

Lệnh chuẩn:

```bash
oracle --engine browser \
  --model gpt-5.5 \
  --browser-thinking-time extended \
  --browser-model-strategy current \
  -p "hello"
```

## Lỗi 3

Bridge không chạy

Kiểm tra Windows PowerShell còn đang chạy không. Nếu tắt rồi thì chạy lại:

```powershell
oracle bridge host --bind 127.0.0.1:9473 --token f667af3845a136e7a1d6573a1d0ecff2 --ssh root@45.124.94.77 --ssh-remote-port 9473 --ssh-extra-args "-o ExitOnForwardFailure=yes" --foreground --print
```

Nếu Windows log lặp lại kiểu này:

```text
[bridge host] ssh tunnel exited (code 255); restarting in ...
```

Nguyên nhân thường gặp: remote port `9473` trên cloud còn bị SSH reverse tunnel cũ giữ. Vào cloud server và dọn listener cũ bằng lệnh động này:

```bash
lsof -nP -tiTCP:9473 -sTCP:LISTEN | xargs -r kill
```

Sau đó chạy lại lệnh `oracle bridge host ...` trên Windows.

---

---

# H. Cách chạy thay thế: oracle serve + SSH tunnel thủ công

Chỉ dùng cách này khi cần debug. Bình thường ưu tiên một terminal bằng `oracle bridge host` ở mục G.

## Trên Windows — 2 terminal riêng biệt

**Terminal 1:**
```powershell
oracle serve --host 127.0.0.1 --port 9473 --token f667af3845a136e7a1d6573a1d0ecff2
```

**Terminal 2:**
```powershell
ssh -N -R 9473:127.0.0.1:9473 root@45.124.94.77
```

Giữ cả 2 terminal chạy suốt session. Login ChatGPT trong Chrome oracle tự mở — profile lưu lại cho lần sau.

## Lỗi đã gặp: `socket hang up` / `Empty reply from server`

**Nguyên nhân:** Dùng `localhost` thay vì `127.0.0.1` trong SSH tunnel:
```powershell
ssh -R 9473:localhost:9473 root@45.124.94.77 -N  # SAI — localhost resolve thành ::1 (IPv6) trên Windows
```

Oracle serve chỉ listen IPv4 (`0.0.0.0:9473`), SSH client thử kết nối IPv6 → thất bại → empty reply.

**Fix:**
```powershell
ssh -R 9473:127.0.0.1:9473 root@45.124.94.77 -N  # ĐÚNG — force IPv4
```

---

## Lỗi đã gặp: `connect to 127.0.0.1 port 9473 failed: No error`

**Nguyên nhân:** SSH reverse tunnel đã mở trên cloud, nhưng phía Windows không có service listen ở `127.0.0.1:9473`.

Trường hợp đã gặp: chạy `oracle serve --port 9473` làm Oracle listen ở IP LAN như `10.212.74.83:9473`, trong khi SSH tunnel forward về `127.0.0.1:9473`.

**Fix chuẩn:** dùng một terminal:

```powershell
oracle bridge host --bind 127.0.0.1:9473 --token f667af3845a136e7a1d6573a1d0ecff2 --ssh root@45.124.94.77 --ssh-remote-port 9473 --ssh-extra-args "-o ExitOnForwardFailure=yes" --foreground --print
```

Nếu vẫn dùng 2 terminal thì `oracle serve` bắt buộc có `--host 127.0.0.1`.

---

# I. Dùng nhiều máy local (nhà + công ty) → 1 cloud server

## Nguyên tắc bắt buộc: dùng token cố định

**KHÔNG dùng `--token auto`** khi có nhiều hơn 1 máy local.

`--token auto` sinh token ngẫu nhiên mỗi lần restart → server config lỗi thời → `unauthorized`.

Token chung cố định của project này: `f667af3845a136e7a1d6573a1d0ecff2`

## Cách chạy đúng trên mọi máy local (nhà hoặc công ty)

Ưu tiên dùng một terminal:

```powershell
oracle bridge host --bind 127.0.0.1:9473 --token f667af3845a136e7a1d6573a1d0ecff2 --ssh root@45.124.94.77 --ssh-remote-port 9473 --ssh-extra-args "-o ExitOnForwardFailure=yes" --foreground --print
```

Giữ terminal này chạy suốt session.

## Quy tắc switch máy

1. Chỉ 1 máy giữ SSH tunnel tại 1 thời điểm.
2. Máy thứ 2 mở tunnel cùng remote port `9473` sẽ **không override** máy thứ 1. Nó sẽ fail kiểu `ssh tunnel exited (code 255)` vì server báo `Address already in use`.
3. Khi switch (nhà → công ty hoặc ngược lại): dừng PowerShell `oracle bridge host` ở máy cũ trước, rồi chạy lệnh một terminal ở máy mới.
4. Nếu máy cũ không tự nhả port, vào cloud server dọn listener cũ:

```bash
lsof -nP -tiTCP:9473 -sTCP:LISTEN | xargs -r kill
```

5. Nếu vẫn fail, kiểm tra IP nào đang giữ tunnel:

```bash
lsof -nP -iTCP:9473 -sTCP:LISTEN
lsof -nP -a -p "$(lsof -nP -tiTCP:9473 -sTCP:LISTEN | head -n1)" -iTCP
```

Nếu thấy listener vừa bị kill lại xuất hiện ngay, nghĩa là máy cũ vẫn đang chạy `oracle bridge host` và tự reconnect. Cần tắt terminal/process Oracle trên máy cũ trước.

Nếu chưa tắt được máy cũ nhưng cần dùng máy hiện tại ngay, dùng remote port khác, ví dụ `9474`.

Trên Windows máy hiện tại:

```powershell
oracle bridge host --bind 127.0.0.1:9473 --token f667af3845a136e7a1d6573a1d0ecff2 --ssh root@45.124.94.77 --ssh-remote-port 9474 --ssh-extra-args "-o ExitOnForwardFailure=yes" --foreground --print
```

Trên cloud server, trỏ Oracle client sang port mới:

```bash
oracle bridge client --connect 'oracle+tcp://127.0.0.1:9474?token=f667af3845a136e7a1d6573a1d0ecff2'
```

Sau đó test:

```bash
curl -s http://127.0.0.1:9474/status
curl -s -H "Authorization: Bearer f667af3845a136e7a1d6573a1d0ecff2" http://127.0.0.1:9474/health
```

## Lỗi đã gặp: `unauthorized` dù tunnel active

**Nguyên nhân:** `oracle bridge host --token auto --background` sinh token mới, ghi đè vào port 9473 trước khi `oracle serve` kịp bind. Server config dùng token cũ → mismatch.

**Cách phát hiện:**
```powershell
# Tìm process nào đang thực sự giữ port 9473
wmic process where "name like '%node%'" get commandline | findstr oracle
# → Xem token trong output để biết token thực đang dùng
```

**Fix:**
```powershell
# Kill toàn bộ oracle/node process đang giữ port 9473
netstat -ano | findstr 9473
taskkill /F /PID <pid>

# Chạy lại với token cố định
oracle bridge host --bind 127.0.0.1:9473 --token f667af3845a136e7a1d6573a1d0ecff2 --ssh root@45.124.94.77 --ssh-remote-port 9473 --ssh-extra-args "-o ExitOnForwardFailure=yes" --foreground --print
```

## Test nhanh từ server

```bash
# Tunnel có sống không?
curl -s http://127.0.0.1:9473/status
# → {"ok":true}

# Token có khớp không?
curl -s -H "Authorization: Bearer f667af3845a136e7a1d6573a1d0ecff2" http://127.0.0.1:9473/health
# → {"ok":true,"version":"...","uptimeSeconds":...}
```

Nếu `/status` OK nhưng `/health` trả `unauthorized` → token mismatch, chạy lại `oracle bridge host` trên Windows với token cố định.

---

# Bản checklist siêu ngắn

```text
1. Windows: npm i -g @steipete/oracle
2. Windows: oracle bridge host --bind 127.0.0.1:9473 --token f667af3845a136e7a1d6573a1d0ecff2 --ssh root@45.124.94.77 --ssh-remote-port 9473 --ssh-extra-args "-o ExitOnForwardFailure=yes" --foreground --print
3. Login ChatGPT trong Chrome Oracle mở ra
4. Không tắt PowerShell bridge host
5. Copy bridge file:
   scp C:\Users\noname\.oracle\bridge-connection.json root@45.124.94.77:~/bridge-connection.json
6. Server: nvm use/install 24
7. Server: npm install -g @steipete/oracle@latest
8. Server: oracle bridge client --connect ~/bridge-connection.json
9. Server test:
   oracle --engine browser --model gpt-5.5 --browser-thinking-time extended --browser-model-strategy current -p "hello"
10. Project: oracle bridge claude-config > .mcp.json
11. Claude Code: dùng /oracle-spec-bridge
```

> Lưu ý: Checklist trên dùng cho lần setup đầu tiên với 1 máy.
> Nếu có nhiều máy, xem mục I — bắt buộc dùng token cố định thay vì `--token auto`.
