# QRipple

简体中文 | [English](README.en.md)

**Real-time QR Code Sharing** · *Scan once. Share everywhere.*

在线使用：<https://qripple.inkorange.com>

QRipple 是一个无需安装、无需注册的实时二维码共享网站。分享者用手机摄像头对准一个二维码，接收者输入五位数字配对码，就能在自己的设备上实时看到同一个二维码；二维码内容一变，所有接收者都会同步更新。

**只传输二维码解码后的数据，摄像头画面始终留在分享者设备上。** 服务器不保存任何记录，会话结束即消失。

## 使用方法

1. **分享者**：打开网站，点击“开始分享”，允许使用摄像头，把镜头对准要分享的二维码。页面上会显示一个五位配对码；也可以点击“复制邀请链接”或“分享邀请链接”，把形如 `https://qripple.inkorange.com/24914` 的链接发给接收者。
2. **接收者**：打开邀请链接，或者打开网站、点击“加入会话”并输入配对码，即可看到同一个二维码（在本地重新生成，可直接扫描）。接收端可以复制内容，或把其中的链接通过系统分享面板交给其他 App。
3. 分享者点击“结束分享”，或离线超过 2 分钟，会话结束，配对码随即失效。

## 功能

- **本地识别**：在分享者浏览器的 Web Worker 中用 ZXing（WebAssembly）识别，最高约 16 帧/秒；模糊时自动锐化重试，不支持 WebAssembly 时退回 jsQR。
- **动态二维码**：内容变化后自动推送给所有接收者，适合每隔几秒刷新一次的码。新内容连续识别 2 次后自动替换；同一位置的新旧内容短暂同时被识别时，优先跟随后出现的新内容，并隐藏已替换的旧码，避免来回切换。
- **多个二维码**：画面中出现多个独立码时，在预览上标出编号由分享者点选，之后持续跟随所选的码。首次同时识别到多个码而没有刷新历史时，仍需点选。大码旁边的小码也能找到。
- **自动变焦**：摄像头能看到但读不出的小码，会自动放大镜头再识别（需要摄像头支持缩放）。码过大或超出识别区时自动缩小；放大后持续 3 秒仍有读不出的码，会恢复到基础倍率，并等待 2 秒重新对焦，避免卡在高倍率。
- **接收端**：按原始字节重新生成二维码（SVG）；内容中的网址可直接点击；支持复制内容、通过系统分享面板把链接交给其他 App，Apple 设备上还可以改为运行快捷指令（见下文）；会话期间屏幕保持常亮。
- **断线恢复**：分享者刷新页面会自动回到原会话；接收者断线后自动重连。
- **分享时长**：分享端和接收端在原有时间旁显示“12 秒前”“2 分 03 秒前”，随时间更新。以服务器收到这张二维码的时间为准，估算网络延迟并定期校准；晚加入、重连不会重置计时，新码才重新计时。
- **多线路接入**：可以为同一个服务器配置多条访问线路，客户端自动选择最先连通的一条（见“部署”）。
- **中英双语**：按浏览器语言自动选择，可在右上角切换。

## 浏览器要求

- 摄像头只能在 HTTPS（或 `localhost`）页面上使用，所以分享端必须通过 HTTPS 访问。
- 分享端需要支持摄像头的现代浏览器；手机上推荐 Safari、Chrome 或 Edge。部分手机厂商自带的浏览器和 App 内置浏览器（如微信）可能无法调用摄像头或系统分享。
- 接收端任何现代浏览器都可以。

## 将链接交给 App

- **Android、iPhone、iPad 和 Mac**：点击内容卡片上的“分享链接”，在系统分享面板中选择目标 App。需要支持系统分享的浏览器（如 Safari、新版 Chrome 或 Edge）；如果目标 App 没有出现在面板中，表示它没有提供接收链接的分享入口。
- 网页不能预选或记住系统分享的目标，每次都需要在面板中选择 App（部分 Android 系统可以在面板中把常用 App 固定在前面）。
- **iPhone、iPad 和 Mac**：可以在右上角的设置中打开“使用快捷指令”并填写快捷指令名称。之后内容卡片上的“分享链接”会换成“运行快捷指令”，把完整的二维码内容作为输入交给这个快捷指令。设置只在 Apple 设备上显示。

## 工作方式

```
分享端浏览器                       服务器 (Node.js)                    接收端浏览器
camera → Web Worker(ZXing) 解码 ──► 内存中的临时会话 ──WebSocket──► qrcode-generator 重新生成
          （图像不出设备）           只保存最新一条数据                  SVG 二维码
```

- **分享端**：摄像头帧（1080p）裁剪到取景框后送入 Web Worker 解码（[zxing-wasm](https://github.com/Sec-ant/zxing-wasm)，兜底 [jsQR](https://github.com/cozmo/jsQR)）。首个二维码识别一次即推送；内容未变化不重复发送；识别不到时保留上一次结果，扫描不会停止。
- **服务器**：单进程 Node.js，唯一的运行时依赖是 `ws`。会话完全存在内存中，不落盘、不记录内容。
- **接收端**：按原始字节（base64 传输）用 [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 重新编码；纯数字、字母数字内容自动使用更紧凑的编码模式。外观可能与原码不同，但承载的数据相同。

完整的消息格式见 [docs/PROTOCOL.md](docs/PROTOCOL.md)。

## 会话规则

| 项目 | 默认值 | 环境变量 |
| --- | --- | --- |
| 配对码 | 五位数字 10000–99999，结束后 10 分钟内不复用 | `CODE_COOLDOWN_MS` |
| 分享者离线自动关闭 | 离线超过 2 分钟（关闭页面、断网、锁屏过久）会话自动结束 | `HOST_GRACE_MS` |
| 会话安全上限 | 24 小时（不在界面显示，防止页面一直开着导致会话永不结束） | `SESSION_TTL_MS` |
| 每个会话接收者上限 | 50 | `MAX_RECEIVERS` |
| 最大数据量 | 8 KiB（可覆盖任何合法二维码） | `MAX_DATA_BYTES` |

分享者的会话令牌保存在 sessionStorage 中，刷新页面可恢复原会话；接收者重连时通过会话 ID 确保不会误连到复用同一配对码的新会话。

## 安全与隐私

- 摄像头画面只在分享者设备上处理，服务器只收到解码后的数据，并且只保留每个会话的最新一条；会话结束后立即删除。
- 只有持有分享令牌（创建会话时下发的 192 位随机值）的连接才能更新或结束会话。
- 按 IP 限制：错误配对码 10 次后限速（每 30 秒恢复 1 次）、创建会话频率、并发连接数；按连接限制消息速率；超大消息直接断开。
- WebSocket 校验 Origin；页面启用严格的 CSP、`Permissions-Policy`、`X-Frame-Options` 等安全响应头。
- 二维码内容视为不可信数据：只有 http(s) 网址会变成链接，页面不会把内容当作 HTML 插入。
- **五位配对码不是强认证**：错误猜测会被限流，但任何知道配对码的人都能看到分享内容。邀请链接只是带上了配对码的网址，同样如此；会话结束后旧链接随即失效，但配对码 10 分钟后可能分配给新的会话。不要用它分享付款码、登录码等敏感二维码。

## 本地开发

需要 Node.js ≥ 22。

```bash
npm install
npm run dev        # http://localhost:3000，修改服务器代码后自动重启
npm test           # 单元测试与集成测试（node:test）
```

前端是原生 ES 模块，没有构建步骤，修改后刷新页面即可。浏览器只允许在 HTTPS 或 `localhost` 下使用摄像头，要用手机测试需要部署到带 HTTPS 的地址。

## 部署

推荐的方式是用 `deploy/` 里的脚本部署到一台 Ubuntu 服务器：脚本会安装校验过的 Node.js 官方二进制、Caddy（自动申请 HTTPS 证书）和一个加固过的 systemd 服务。

### 准备

- 一台 **Ubuntu 24.04** 服务器（x86_64 或 ARM64），能通过 SSH 登录，登录用户是 root 或能免密码 sudo。
- 一个**域名**，A 记录（有 IPv6 的话还有 AAAA 记录）指向这台服务器。
- 在云服务商的防火墙/安全组中放行 **80 和 443 端口**（TCP；如需 HTTP/3，再放行 443/UDP）。
- 本地电脑装有 **Node.js ≥ 22**、git 和 rsync（macOS 和大多数 Linux 自带 rsync）。

> 中国大陆的服务器需要域名完成 ICP 备案，才能在 80/443 端口上提供网站。

### 部署步骤

以下命令都在本地电脑上执行。把 `myserver` 换成你的 SSH 地址（如 `root@203.0.113.10`，或 `~/.ssh/config` 中的别名），把 `qr.example.com` 换成你的域名。

```bash
# 1. 获取代码并安装依赖（发布前会在本地运行测试）
git clone https://github.com/InkCitrus/QRipple.git
cd QRipple
npm install

# 2. 初始化服务器：安装 Node.js、Caddy 和 systemd 服务，申请 HTTPS 证书
ssh myserver 'mkdir -p qripple-deploy'
scp deploy/* myserver:qripple-deploy/
ssh -t myserver 'sudo DOMAIN=qr.example.com bash qripple-deploy/setup-server.sh'

# 3. 发布代码并启动服务（先运行测试，再上传、安装依赖、重启服务）
deploy/deploy.sh myserver
```

完成后打开 `https://qr.example.com` 即可使用。也可以用 `curl https://qr.example.com/healthz` 检查，正常时返回 `ok`。证书通常在一分钟内申请好。

### 日常维护

| 操作 | 命令 |
| --- | --- |
| 发布新版本 | `git pull && deploy/deploy.sh myserver` |
| 查看日志 | `ssh myserver journalctl -u qripple -f` |
| 重启服务 | `ssh myserver sudo systemctl restart qripple` |
| 修改配置 | 在服务器上把环境变量（见下方“配置项”）写入 `/etc/qripple/qripple.env`（没有就新建，每行一个 `名称=值`），再重启服务 |
| 升级 Node.js | 重新执行第 2 步，并在 `sudo` 后加上 `NODE_VERSION=v24.x.y`，然后 `deploy/deploy.sh myserver` |

重启服务会结束进行中的会话（会话只存在内存中）。

**常见问题**

- **打不开网站或证书申请失败**：确认域名已解析到服务器、80/443 端口已放行，然后查看 Caddy 日志：`ssh myserver journalctl -u caddy -n 50`。
- **发布时提示 sudo 需要密码**：`deploy.sh` 不能输入密码。请用 root 登录，或为该用户配置免密码 sudo。
- **摄像头无法使用**：必须通过 HTTPS 访问页面。

### 多线路部署（nginx + Tailscale）

在部分地区，单条网络线路的连通性不稳定。多线路部署让多台位于不同网络的服务器共同提供服务，每台服务器是一条线路，客户端同时尝试各条线路，用最先连通的一条。这种方式更复杂，一般用上面的单台服务器部署就够了。在线实例用了两台服务器：

```
                    ┌─ tk.qripple.inkorange.com ─► vps-tk    (UCloud)    nginx ─┐
浏览器同时竞速两条线路 ┤                                                         ├─ Tailscale ─► QRipple 主进程 (vps-azure)
                    └─ az.qripple.inkorange.com ─► vps-azure (Microsoft) nginx ─┘               备用进程 (vps-tk)
页面 qripple.inkorange.com：两条 A 记录，分别指向两台服务器
```

- **线路竞速**：客户端从 `/lines.json` 拿到线路列表，优先连上次成功的线路；0.6 秒内没连上就并行尝试下一条，谁先连上用谁。重连时刚断开的线路排在最后。逻辑见 `public/js/connection.js`。
- **会话一致**：所有线路都转发到同一个 QRipple 主进程（跨服务器时经由 Tailscale），所以分享者和接收者走不同线路也在同一会话里。主进程不可达时，所有线路都切到同一个备用进程。备用进程只能有一个：nginx 会把请求分散到多个备用进程，同一会话就会被拆开。会话只存在内存中，主进程重启会结束进行中的会话。
- **证书**：每台服务器用 certbot（webroot）申请主域名和自己的线路域名。主域名解析到所有服务器，ACME 验证请求若落到别的服务器上，会经由 Tailscale 依次转给其他服务器，直到找到申请方。

**准备**

- 两台或更多 Ubuntu 24.04 服务器，其余要求同单台部署。nginx 可以和其他网站共用：脚本只添加一个 `qripple` 站点。
- 所有服务器加入同一个 [Tailscale](https://tailscale.com) 网络，记下各自的 Tailscale 地址（`tailscale ip -4`）。
- 选一台运行主进程、另一台运行备用进程。下面以三台为例：A（主进程，`100.64.0.1`）、B（备用进程，`100.64.0.2`）、C（只做线路，`100.64.0.3`）。只有两台时去掉 C 即可。
- 域名（以 `qr.example.com` 为例）：
  - `qr.example.com`：每台服务器一条 A 记录（用户访问的地址）；
  - 每台服务器一个线路域名：`a.qr.example.com` 指向 A，`b.qr.example.com` 指向 B，`c.qr.example.com` 指向 C。

各服务器的参数（`MAIN_NAME` 和 `ACCESS_LINES` 在所有服务器上都相同）：

| 参数 | A（主进程） | B（备用进程） | C（只做线路） |
| --- | --- | --- | --- |
| `LINE_NAME` | `a.qr.example.com` | `b.qr.example.com` | `c.qr.example.com` |
| `LISTEN_HOSTS` | `127.0.0.1,100.64.0.1` | `127.0.0.1,100.64.0.2` | `127.0.0.1` |
| `PRIMARY` | `127.0.0.1:3000` | `100.64.0.1:3000` | `100.64.0.1:3000` |
| `BACKUP` | `100.64.0.2:3000` | `127.0.0.1:3000` | `100.64.0.2:3000` |
| `PEERS`（其他所有服务器） | `100.64.0.2,100.64.0.3` | `100.64.0.1,100.64.0.3` | `100.64.0.1,100.64.0.2` |

**步骤**

```bash
# 1. 在本地：获取代码、安装依赖，并把 deploy/ 复制到每台服务器
git clone https://github.com/InkCitrus/QRipple.git && cd QRipple && npm install
for h in serverA serverB serverC; do ssh $h 'mkdir -p qripple-deploy' && scp deploy/* $h:qripple-deploy/; done
```

```bash
# 2. 在每台服务器上执行，参数见上表。服务器 A：
sudo MAIN_NAME=qr.example.com \
     ACCESS_LINES=a.qr.example.com,b.qr.example.com,c.qr.example.com \
     LINE_NAME=a.qr.example.com LISTEN_HOSTS=127.0.0.1,100.64.0.1 \
     PRIMARY=127.0.0.1:3000 BACKUP=100.64.0.2:3000 PEERS=100.64.0.2,100.64.0.3 \
     bash qripple-deploy/setup-line.sh

# 服务器 B：
sudo MAIN_NAME=qr.example.com \
     ACCESS_LINES=a.qr.example.com,b.qr.example.com,c.qr.example.com \
     LINE_NAME=b.qr.example.com LISTEN_HOSTS=127.0.0.1,100.64.0.2 \
     PRIMARY=100.64.0.1:3000 BACKUP=127.0.0.1:3000 PEERS=100.64.0.1,100.64.0.3 \
     bash qripple-deploy/setup-line.sh

# 服务器 C：
sudo MAIN_NAME=qr.example.com \
     ACCESS_LINES=a.qr.example.com,b.qr.example.com,c.qr.example.com \
     LINE_NAME=c.qr.example.com LISTEN_HOSTS=127.0.0.1 \
     PRIMARY=100.64.0.1:3000 BACKUP=100.64.0.2:3000 PEERS=100.64.0.1,100.64.0.2 \
     bash qripple-deploy/setup-line.sh
```

```bash
# 3. 在本地：发布代码到所有服务器
deploy/deploy.sh serverA serverB serverC
```

4. 域名解析生效后，在每台服务器上把第 2 步的命令末尾加上 `--issue-cert` 再执行一次，申请证书并启用 HTTPS。之后打开 `https://qr.example.com` 即可使用。

以后发布新版本：`deploy/deploy.sh serverA serverB serverC`。`setup-line.sh` 生成的配置在 `/etc/qripple/qripple.env`，重新执行脚本时只更新它管理的几项，手动添加的其他配置会保留。

**以后再增加一台服务器**（例如 D）

1. 添加线路域名 `d.qr.example.com` 指向 D。
2. 在每台已有的服务器上重新执行第 2 步的命令：`ACCESS_LINES` 加上 D 的线路域名，`PEERS` 加上 D 的 Tailscale 地址（不用加 `--issue-cert`，已有的证书不受影响）。
3. 把 `deploy/` 复制到 D，按 C 的方式执行 `setup-line.sh`（`PEERS` 填其他所有服务器），然后 `deploy/deploy.sh` 发布到所有服务器，使新的线路列表生效（会结束进行中的会话）。
4. 在 D 上加 `--issue-cert` 再执行一次，最后给 `qr.example.com` 加一条指向 D 的 A 记录。

### 其他环境

QRipple 只需要 Node.js ≥ 22，也可以放在已有的反向代理后面手动运行。反向代理需要负责 HTTPS，并支持 WebSocket（路径为 `/ws`；健康检查为 `/healthz`）：

```bash
npm ci --omit=dev
HOST=127.0.0.1 PORT=3000 TRUST_PROXY=1 node server/index.js
```

### 配置项

所有配置都通过环境变量设置（见 `server/config.js`）：

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | 监听地址，可用逗号分隔多个 |
| `PORT` | `3000` | 监听端口 |
| `TRUST_PROXY` | `0` | 信任几层反向代理的 `X-Forwarded-For`（用于按 IP 限流）；放在一层反向代理后面时设为 `1` |
| `ALLOWED_ORIGINS` | 空 | 除页面自身域名外，额外允许的 WebSocket Origin（逗号分隔） |
| `ACCESS_LINES` | 空 | 多线路部署时的线路域名（逗号分隔）；为空时客户端只连接页面自身的域名 |
| `SESSION_TTL_MS` / `HOST_GRACE_MS` / `CODE_COOLDOWN_MS` | 24 小时 / 2 分钟 / 10 分钟 | 见“会话规则” |
| `MAX_SESSIONS` / `MAX_RECEIVERS` | `2000` / `50` | 同时存在的会话数、每个会话的接收者数上限 |
| `MAX_DATA_BYTES` / `MAX_MESSAGE_BYTES` | `8192` / `49152` | 单条二维码数据、单条 WebSocket 消息的大小上限 |
| `MAX_CONNECTIONS_PER_IP` | `20` | 每个 IP 的并发连接数上限 |
| `CREATE_BURST` / `CREATE_REFILL_MS` | `10` / `60000` | 每个 IP 创建会话的令牌桶 |
| `JOIN_FAIL_BURST` / `JOIN_FAIL_REFILL_MS` | `10` / `30000` | 每个 IP 输错配对码的令牌桶 |
| `MESSAGE_BURST` / `MESSAGE_REFILL_MS` | `40` / `50` | 每个连接的消息速率 |
| `HEARTBEAT_MS` / `SWEEP_MS` | `30000` / `5000` | WebSocket 心跳间隔、过期会话清理间隔 |

## 项目结构

```
server/
  index.js           入口：启动服务器，处理退出信号
  app.js             HTTP 服务、WebSocket 升级与 Origin 校验、/lines.json、/healthz
  hub.js             WebSocket 协议（分享者 / 接收者消息处理）
  sessions.js        内存中的会话存储与配对码分配
  ratelimit.js       令牌桶限流
  static.js          静态文件服务（内存缓存 + gzip）与安全响应头
  config.js          环境变量配置
public/              浏览器端（原生 ES 模块，无构建步骤）
  js/app.js          前端路由
  js/share.js        分享页
  js/join.js         接收页
  js/scanner.js      摄像头、取景框裁剪与自动变焦
  js/scan-worker.js  Web Worker 中的二维码解码（ZXing WASM，jsQR 兜底）
  js/code-tracker.js 多个二维码时决定分享哪一个
  js/auto-zoom.js    自动变焦的判断逻辑
  js/qr-render.js    接收端重新生成二维码（SVG）
  js/connection.js   WebSocket 连接、多线路竞速与自动重连
  js/linkify.js      识别内容中的网址
  js/launch.js       系统分享与快捷指令
  js/i18n.js         中英文文案
docs/PROTOCOL.md     WebSocket 消息格式
deploy/              部署脚本、systemd 单元、Caddy / nginx 配置
test/                node:test 测试
```

## 参与贡献

欢迎提交 issue 和 pull request。提交前请运行 `npm test`；纯逻辑模块（如 `code-tracker.js`、`linkify.js`）都有对应的单元测试，修改时请一并更新。

## License

[Apache-2.0](LICENSE)。网站发送到浏览器的第三方组件（jsQR、qrcode-generator、zxing-wasm 和图标）的许可声明见 [public/third-party-notices.txt](public/third-party-notices.txt)，网站页脚的“开源许可”链接也指向它；增加或升级这类依赖时请一并更新。
