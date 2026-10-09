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

- **分享端**：摄像头帧（1080p）裁剪到取景框，在 Web Worker 中用 [zxing-wasm](https://github.com/Sec-ant/zxing-wasm)（zxing-cpp 的 WebAssembly 版）解码，最高约 16 帧/秒；不支持 WebAssembly 的浏览器自动退回 [jsQR](https://github.com/cozmo/jsQR)。首个二维码识别一次即推送；内容变化需连续识别 2 次才替换，防止两个码同时入镜或误识别导致闪烁；内容未变化不重复发送。识别不到时保留上一次结果，扫描永不停止。
- **服务器**：单进程 Node.js（依赖仅 `ws`），会话完全存在内存中，不落盘、不记录内容。
- **接收端**：按原始字节（base64 传输）用 [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 重新编码；纯数字 / 字母数字内容自动使用更紧凑的编码模式。外观可能不同，但承载的数据相同。

## 会话规则

| 项目 | 默认值 | 环境变量 |
| --- | --- | --- |
| 配对码 | 五位数字 10000–99999，结束后 10 分钟内不复用 | `CODE_COOLDOWN_MS` |
| 会话最长有效期 | 2 小时 | `SESSION_TTL_MS` |
| 分享者离线宽限期 | 2 分钟（超时后会话关闭） | `HOST_GRACE_MS` |
| 每个会话接收者上限 | 50 | `MAX_RECEIVERS` |
| 最大数据量 | 8 KiB（可覆盖任何合法二维码） | `MAX_DATA_BYTES` |

分享者刷新页面可自动恢复原会话（令牌保存在 sessionStorage）；接收者断线后自动重连，并通过会话 ID 确保不会误连到复用同一配对码的新会话。

## 安全措施

- 只有持有分享令牌（创建会话时下发的 192 位随机值）的连接才能更新或结束会话。
- 按 IP 限制：错误配对码 10 次后限速（每 30 秒恢复 1 次）、创建会话频率、并发连接数；按连接限制消息速率；超大消息直接断开。
- WebSocket 校验 Origin；页面启用严格 CSP、`Permissions-Policy`、`X-Frame-Options` 等安全响应头。
- 五位配对码不是强认证，界面会提示用户不要分享付款码、登录码等敏感二维码。

完整的消息格式见 [docs/PROTOCOL.md](docs/PROTOCOL.md)。

## 本地开发

需要 Node.js ≥ 20。

```bash
npm install
npm run dev        # http://localhost:3000，修改服务器代码后自动重启
npm test           # 服务器单元测试与集成测试
```

浏览器只允许在 HTTPS 或 `localhost` 下使用摄像头。要用手机测试，需要部署到带 HTTPS 的地址。

## 部署

生产环境：<https://qripple.inkorange.com>（服务器 `vps-sh`，Ubuntu 24.04）。

```
Internet ──► Caddy :443 (TLS，Let's Encrypt 自动续期；UDP 443 提供 HTTP/3) ──► Node 127.0.0.1:3000 (systemd: qripple)
         └─► Caddy :80  (ACME 验证 + 跳转 HTTPS)
```

- 首次初始化服务器：`deploy/setup-server.sh`（安装校验过的 Node.js 官方二进制、Caddy、systemd 服务、ufw 规则）
- 发布新版本：`deploy/deploy.sh [ssh-host]`（先跑测试，再 rsync + `npm ci` + 重启服务）
- 查看日志：`ssh vps-sh journalctl -u qripple -f`

服务为单实例、状态在内存中：重启会结束所有进行中的会话（客户端会提示会话已失效）。

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
