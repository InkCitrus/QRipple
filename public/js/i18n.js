// Tiny i18n: Simplified Chinese and English, chosen from the browser
// language and switchable from the header.

const STORAGE_KEY = 'qripple.lang';

const messages = {
  zh: {
    'home.desc': '无需安装、无需注册。分享者用摄像头持续扫描二维码，接收者输入五位配对码，即可实时看到同一个二维码。',
    'home.shareSub': '用摄像头扫描并实时分享二维码',
    'home.joinSub': '输入五位配对码，查看实时二维码',
    'home.fact1': '二维码在分享者设备上本地识别，摄像头画面不会上传',
    'home.fact2': '内容变化时，所有接收者自动同步更新',
    'home.fact3': '临时会话，结束或过期后立即失效，不保存任何记录',

    'common.privacy': '隐私优先：只传输解码后的数据，不传输图像或视频。',
    'common.home': '返回首页',
    'common.copied': '已复制',
    'common.copyFailed': '复制失败，请手动选择内容',
    'common.binary': '二进制数据 · {n} 字节',

    'conn.connecting': '连接中…',
    'conn.online': '已连接',
    'conn.onlineVia': '已连接 · 线路 {line}',
    'conn.reconnecting': '重新连接中…',
    'conn.offline': '网络已断开',

    'share.codeLabel': '配对码',
    'share.receivers': '{n} 位接收者',
    'share.currentLabel': '当前分享内容',
    'share.noContent': '尚未识别到二维码，请将二维码放入取景框。',
    'share.synced': '已同步 · {time}',
    'share.syncing': '同步中…',
    'share.pendingSync': '网络恢复后自动同步',
    'share.end': '结束分享',
    'share.endConfirm': '确定结束分享？所有接收者将断开连接。',
    'share.startNew': '开始新的分享',
    'share.switchCamera': '切换摄像头',
    'share.chooseTitle': '画面中有多个二维码，点选要分享的一个：',
    'share.chooseCode': '分享第 {n} 个二维码',
    'share.sharingTag': '分享中',
    'share.retryCamera': '重试',
    'share.tooLarge': '二维码内容过大，无法分享',
    'share.ended.title': '分享已结束',
    'share.ended.ended': '会话已关闭，接收者已断开。',
    'share.ended.expired': '会话已到期，接收者已断开。',
    'share.ended.gone': '会话已失效（离线时间过长或服务器已重启）。',
    'share.ended.replaced': '该会话已在另一个页面中继续。',
    'share.failed.title': '无法创建会话',
    'share.failed.busy': '服务器繁忙，请稍后再试。',
    'share.failed.rate_limited': '创建会话过于频繁，请稍后再试。',
    'share.failed.network': '无法连接服务器，请检查网络后重试。',

    'scan.starting': '正在启动摄像头…',
    'scan.scanning': '正在扫描…',
    'scan.detected': '已识别二维码',
    'scan.multiple': '检测到 {n} 个二维码，请点选要分享的',
    'scan.lost': '未检测到二维码 · 保留上次结果',
    'scan.paused': '已暂停（页面在后台）',
    'scan.error': '摄像头不可用',

    'camera.denied': '摄像头权限被拒绝。请在浏览器地址栏或系统设置中允许本网站使用摄像头，然后重试。',
    'camera.notFound': '未找到可用的摄像头。',
    'camera.busy': '摄像头正被其他应用占用，请关闭后重试。',
    'camera.insecure': '浏览器只允许在 HTTPS 安全连接下使用摄像头。',
    'camera.unsupported': '当前浏览器不支持摄像头访问，请使用最新版 Chrome、Safari、Edge 或 Firefox。',
    'camera.failed': '无法启动摄像头。',

    'join.codeLabel': '输入五位配对码',
    'join.submit': '加入',
    'join.joining': '正在加入…',
    'join.hint': '配对码显示在分享者的屏幕上',
    'join.sessionLabel': '会话',
    'join.waiting': '等待分享者扫描二维码…',
    'join.contentLabel': '二维码内容',
    'join.copy': '复制内容',
    'join.leave': '离开会话',
    'join.joinAnother': '加入其他会话',
    'join.updatedAt': '更新于 {time}',
    'join.hostOffline': '分享者暂时离线，显示的是最后一次识别的结果。',
    'join.reconnecting': '连接已断开，正在重新连接…当前显示的可能不是最新内容。',
    'join.error.invalid': '请输入 5 位数字',
    'join.error.not_found': '配对码无效或会话已结束',
    'join.error.full': '该会话的接收人数已满',
    'join.error.rate_limited': '尝试次数过多，请稍后再试',
    'join.error.network': '无法连接服务器，请检查网络',
    'join.ended.title': '会话已结束',
    'join.ended.ended': '分享者已结束分享。',
    'join.ended.expired': '会话已到期。',
    'join.ended.host_left': '分享者离线时间过长，会话已关闭。',
    'join.ended.gone': '会话已不存在。',
  },
  en: {
    'home.desc': 'No install, no sign-up. The sharer keeps a QR code in front of the camera; receivers enter a 5-digit code and see the same QR code live.',
    'home.shareSub': 'Scan a QR code and share it live',
    'home.joinSub': 'Enter a 5-digit code to view it',
    'home.fact1': "QR codes are decoded on the sharer's device; camera images never leave it",
    'home.fact2': 'Every receiver updates automatically when the code changes',
    'home.fact3': 'Temporary sessions: nothing is kept once they end or expire',

    'common.privacy': 'Privacy first: only decoded data is sent, never images or video.',
    'common.home': 'Back to home',
    'common.copied': 'Copied',
    'common.copyFailed': "Couldn't copy. Please select the text manually",
    'common.binary': 'Binary data · {n} bytes',

    'conn.connecting': 'Connecting…',
    'conn.online': 'Connected',
    'conn.onlineVia': 'Connected · line {line}',
    'conn.reconnecting': 'Reconnecting…',
    'conn.offline': 'Offline',

    'share.codeLabel': 'Pairing code',
    'share.receivers': ({ n }) => (Number(n) === 1 ? '1 receiver' : `${n} receivers`),
    'share.currentLabel': 'Currently sharing',
    'share.noContent': 'No QR code yet. Hold one inside the frame.',
    'share.synced': 'Synced · {time}',
    'share.syncing': 'Syncing…',
    'share.pendingSync': 'Will sync when back online',
    'share.end': 'End sharing',
    'share.endConfirm': 'End sharing? All receivers will be disconnected.',
    'share.startNew': 'Start a new share',
    'share.switchCamera': 'Switch camera',
    'share.chooseTitle': 'Several QR codes in view. Tap the one to share:',
    'share.chooseCode': 'Share QR code {n}',
    'share.sharingTag': 'Sharing',
    'share.retryCamera': 'Try again',
    'share.tooLarge': 'This QR code is too large to share',
    'share.ended.title': 'Sharing ended',
    'share.ended.ended': 'The session is closed and receivers were disconnected.',
    'share.ended.expired': 'The session expired and receivers were disconnected.',
    'share.ended.gone': 'The session is no longer available (offline too long, or the server restarted).',
    'share.ended.replaced': 'This session continued in another tab.',
    'share.failed.title': "Couldn't create a session",
    'share.failed.busy': 'The server is busy. Please try again later.',
    'share.failed.rate_limited': 'Too many sessions created. Please wait a moment.',
    'share.failed.network': "Can't reach the server. Check your connection and try again.",

    'scan.starting': 'Starting camera…',
    'scan.scanning': 'Scanning…',
    'scan.detected': 'QR code detected',
    'scan.multiple': '{n} QR codes found. Tap the one to share',
    'scan.lost': 'No QR code in view · keeping last result',
    'scan.paused': 'Paused (page in background)',
    'scan.error': 'Camera unavailable',

    'camera.denied': 'Camera access was denied. Allow camera access for this site in your browser or system settings, then try again.',
    'camera.notFound': 'No camera found on this device.',
    'camera.busy': 'The camera is in use by another app. Close it and try again.',
    'camera.insecure': 'Browsers only allow camera access over HTTPS.',
    'camera.unsupported': "This browser can't access the camera. Try the latest Chrome, Safari, Edge or Firefox.",
    'camera.failed': "Couldn't start the camera.",

    'join.codeLabel': 'Enter the 5-digit code',
    'join.submit': 'Join',
    'join.joining': 'Joining…',
    'join.hint': "The code is shown on the sharer's screen",
    'join.sessionLabel': 'Session',
    'join.waiting': 'Waiting for the sharer to scan a QR code…',
    'join.contentLabel': 'QR code content',
    'join.copy': 'Copy content',
    'join.leave': 'Leave session',
    'join.joinAnother': 'Join another session',
    'join.updatedAt': 'Updated {time}',
    'join.hostOffline': 'The sharer is offline. Showing the last scanned result.',
    'join.reconnecting': 'Connection lost. Reconnecting… the code shown may be out of date.',
    'join.error.invalid': 'Enter 5 digits',
    'join.error.not_found': 'Invalid code, or the session has ended',
    'join.error.full': 'This session is full',
    'join.error.rate_limited': 'Too many attempts. Please wait and try again',
    'join.error.network': "Can't reach the server. Check your connection",
    'join.ended.title': 'Session ended',
    'join.ended.ended': 'The sharer ended the session.',
    'join.ended.expired': 'The session expired.',
    'join.ended.host_left': 'The sharer was offline too long, so the session closed.',
    'join.ended.gone': 'This session no longer exists.',
  },
};

function storedLang() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function detectLang() {
  const saved = storedLang();
  if (saved && messages[saved]) return saved;
  const prefs = navigator.languages?.length ? navigator.languages : [navigator.language || 'en'];
  return prefs.some((l) => /^zh\b/i.test(l)) ? 'zh' : 'en';
}

let lang = detectLang();

export function getLang() {
  return lang;
}

export function setLang(next) {
  if (!messages[next] || next === lang) return;
  lang = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // private mode; the choice just won't persist
  }
  applyI18n();
  window.dispatchEvent(new Event('langchange'));
}

export function t(key, vars = {}) {
  const msg = messages[lang][key] ?? messages.en[key] ?? key;
  if (typeof msg === 'function') return msg(vars);
  return msg.replace(/\{(\w+)\}/g, (_, name) => (name in vars ? String(vars[name]) : `{${name}}`));
}

export function applyI18n(root = document) {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':');
      if (attr && key) el.setAttribute(attr.trim(), t(key.trim()));
    }
  }
}
