# QRipple

**Real-time QR Code Sharing** · *Scan once. Share everywhere.*

QRipple 是一个无需安装、无需注册的实时二维码共享网站。分享者在浏览器中打开摄像头持续扫描二维码，接收者输入五位数字配对码即可实时看到同一个二维码（在本地重新生成）。

**只传输二维码解码后的数据，摄像头画面始终留在分享者设备上。**

## 工作方式

```
分享端浏览器                       服务器 (Node.js)                    接收端浏览器
camera → Web Worker(ZXing) 解码 ──► 内存中的临时会话 ──WebSocket──► qrcode-generator 重新生成
          （图像不出设备）           只保存最新一条数据                  SVG 二维码
```

- **分享端**：摄像头帧（1080p）裁剪到取景框，在 Web Worker 中用 [zxing-wasm](https://github.com/Sec-ant/zxing-wasm)（zxing-cpp 的 WebAssembly 版）解码，最高约 16 帧/秒；一帧识别失败时会做一次锐化（反锐化掩模）再识别，提升对失焦模糊的识别率；不支持 WebAssembly 的浏览器自动退回 [jsQR](https://github.com/cozmo/jsQR)。首个二维码识别一次即推送；内容变化需连续识别 2 次才替换，防止误识别导致闪烁；内容未变化不重复发送。识别不到时保留上一次结果，扫描永不停止。
- **多个二维码**：画面中同时出现多个二维码时不会自动切换，而是在预览上标出编号并列出内容，由分享者点选；之后会持续跟随所选的码（包括原位刷新内容的动态码）。逻辑见 `public/js/code-tracker.js`。
- **服务器**：单进程 Node.js（依赖仅 `ws`），会话完全存在内存中，不落盘、不记录内容。
- **接收端**：按原始字节（base64 传输）用 [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 重新编码；纯数字 / 字母数字内容自动使用更紧凑的编码模式。外观可能不同，但承载的数据相同。

## 会话规则

| 项目 | 默认值 | 环境变量 |
| --- | --- | --- |
| 配对码 | 五位数字 10000–99999，结束后 10 分钟内不复用 | `CODE_COOLDOWN_MS` |
| 分享者离线自动关闭 | 离线超过 2 分钟（关闭页面、断网、锁屏过久）会话自动结束 | `HOST_GRACE_MS` |
| 会话安全上限 | 24 小时（不在界面显示，防止页面一直开着导致会话永不结束） | `SESSION_TTL_MS` |
| 每个会话接收者上限 | 50 | `MAX_RECEIVERS` |
| 最大数据量 | 8 KiB（可覆盖任何合法二维码） | `MAX_DATA_BYTES` |

分享者刷新页面可自动恢复原会话（令牌保存在 sessionStorage）；接收者断线后自动重连，并通过会话 ID 确保不会误连到复用同一配对码的新会话。

## 安全措施

- 只有持有分享令牌（创建会话时下发的 192 位随机值）的连接才能更新或结束会话。
- 按 IP 限制：错误配对码 10 次后限速（每 30 秒恢复 1 次）、创建会话频率、并发连接数；按连接限制消息速率；超大消息直接断开。
- WebSocket 校验 Origin；页面启用严格 CSP、`Permissions-Policy`、`X-Frame-Options` 等安全响应头。
- 五位配对码不是强认证：错误猜测会被限流，但任何知道配对码的人都能看到分享内容。

完整的消息格式见 [docs/PROTOCOL.md](docs/PROTOCOL.md)。

## 本地开发

需要 Node.js ≥ 22。

```bash
npm install
npm run dev        # http://localhost:3000，修改服务器代码后自动重启
npm test           # 服务器单元测试与集成测试
```

浏览器只允许在 HTTPS 或 `localhost` 下使用摄像头。要用手机测试，需要部署到带 HTTPS 的地址。

## 部署（多线接入）

生产环境：<https://qripple.inkorange.com>，两台东京服务器，分别走两条不同的网络线路：

```
                    ┌─ tk.qripple.inkorange.com ─► vps-tk    (UCloud)    nginx ─┐
浏览器同时竞速两条线路 ┤                                                         ├─ Tailscale ─► QRipple 主进程 (vps-azure)
                    └─ az.qripple.inkorange.com ─► vps-azure (Microsoft) nginx ─┘               备用进程 (vps-tk)
页面 qripple.inkorange.com：两条 A 记录，分别指向两台服务器
```

- **线路竞速**：客户端从 `/lines.json` 拿到线路列表，优先连上次成功的线路；0.6 秒内没连上就并行尝试下一条，谁先连上用谁。连接断开后重连时，刚断开的线路排在最后。逻辑见 `public/js/connection.js`。
- **会话一致**：两条线路都转发到同一个 QRipple 主进程，分享者和接收者走不同线路也在同一会话里。主进程不可达时，两边的 nginx 自动切到备用进程。
- **配置**（`/etc/qripple/qripple.env`，由 `deploy/setup-line.sh` 生成）：`HOST`（监听地址，可多个）、`ACCESS_LINES`（线路主机名）、`ALLOWED_ORIGINS`、`TRUST_PROXY`。
- **证书**：每台服务器用 certbot（webroot）申请 `qripple.inkorange.com` + 自己的线路域名。主域名同时解析到两台服务器，所以 ACME 验证请求若落到另一台，会通过 Tailscale 转给申请方。

操作：

- 初始化/更新一条线路：把 `deploy/` 复制到服务器后执行 `deploy/setup-line.sh`（参数见脚本开头）；DNS 生效后加 `--issue-cert` 再执行一次即启用 HTTPS
- 发布新版本：`deploy/deploy.sh`（默认发布到 `vps-azure` 和 `vps-tk`；先跑测试，再 rsync + `npm ci` + 重启服务）
- 查看日志：`ssh vps-azure journalctl -u qripple -f`

会话状态只在主进程内存中：主进程重启会结束进行中的会话（客户端会提示会话已失效）。旧的单机部署方式（Caddy）保留在 `deploy/setup-server.sh` / `deploy/Caddyfile`。

## 项目结构

```
server/        Node.js 服务器：HTTP 静态文件、WebSocket 协议、会话存储、限流
public/        浏览器端（原生 ES 模块，无构建步骤）
  js/scanner.js      摄像头与取景框裁剪
  js/scan-worker.js  Web Worker 中的二维码解码（ZXing WASM，jsQR 兜底）
  js/qr-render.js    接收端重新生成二维码（SVG）
  js/share.js        分享页
  js/join.js         接收页
test/          node:test 测试
deploy/        Caddyfile、systemd 单元、服务器初始化与发布脚本
```

## License

Apache-2.0
