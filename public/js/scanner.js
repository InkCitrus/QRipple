// Continuous QR scanning from the camera. Frames are cropped to the
// viewfinder, decoded in a Web Worker, and never leave the device.
//
// onState({ state: 'starting' | 'running' | 'paused' | 'error', error?, canSwitch?, mirrored? })
// onResult(codes) once per decoded frame, where codes is an array (empty when
// nothing was found) of { text, bytes, quad, center }. quad holds the four
// corners and center the middle of the code, both as [x, y] fractions of the
// preview element, so overlays can be positioned with percentages.

const FRAME_INTERVAL_MS = 60; // at most ~16 decodes per second
// Decode resolution cap (px) per engine. Small codes (e.g. thumbnails next to a
// big one) need the extra pixels: 1440 px found 4/4 codes where 960 px found 2/4.
const MAX_SIDE = { zxing: 1440, jsqr: 720 };
const MARGIN = 0.12; // scan a little beyond the drawn viewfinder

function errorCode(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return 'denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'notFound';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'busy';
    default:
      return 'failed';
  }
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export class Scanner {
  constructor({ video, viewfinder, onResult, onState }) {
    this.video = video;
    this.viewfinder = viewfinder;
    this.onResult = onResult;
    this.onState = onState;
    this.stream = null;
    this.deviceId = null;
    this.devices = [];
    this.mirrored = false;
    this.running = false;
    this.stopped = false;
    this.busy = false;
    this.timer = null;
    this.frameId = 0;
    this.frameStart = 0;
    this.startToken = 0;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.worker = null;
    this.engine = 'zxing'; // confirmed by the worker once its decoder has loaded
    this.onVisibility = () => this.#handleVisibility();
    document.addEventListener('visibilitychange', this.onVisibility);
    // Start loading the decoder now, so the WebAssembly module downloads and
    // compiles while the user is still answering the camera permission prompt.
    this.#ensureWorker();
  }

  #emit(state, extra = {}) {
    this.state = state;
    this.onState?.({ state, canSwitch: this.devices.length > 1, mirrored: this.mirrored, ...extra });
  }

  #ensureWorker() {
    if (this.worker) return;
    this.worker = new Worker('/js/scan-worker.js');
    this.worker.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === 'engine') {
        this.engine = msg.engine;
        if (msg.reason) console.info(`QR decoder: ${msg.engine} (${msg.reason})`);
      } else {
        this.#handleResult(msg);
      }
    };
    this.worker.onerror = () => {
      this.worker?.terminate();
      this.worker = null;
      this.busy = false;
      this.#halt();
      this.#emit('error', { error: 'failed' });
    };
  }

  async start(deviceId = this.deviceId) {
    this.stopped = false;
    const token = ++this.startToken;
    this.#halt();
    this.#releaseStream();

    if (!window.isSecureContext) return this.#emit('error', { error: 'insecure' });
    if (!navigator.mediaDevices?.getUserMedia) return this.#emit('error', { error: 'unsupported' });
    this.#emit('starting');

    // 1440p gives small or distant codes enough pixels (devices without it fall
    // back to their nearest mode); only the viewfinder region is ever decoded.
    const video = { width: { ideal: 2560 }, height: { ideal: 1440 }, frameRate: { ideal: 30 } };
    if (deviceId) video.deviceId = { exact: deviceId };
    else video.facingMode = { ideal: 'environment' };

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch (err) {
      if (token !== this.startToken) return;
      // A remembered camera may have been unplugged: fall back to any camera.
      if (deviceId && errorCode(err) === 'notFound') return this.start(null);
      return this.#emit('error', { error: errorCode(err) });
    }
    if (token !== this.startToken || this.stopped) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    this.stream = stream;
    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings?.() ?? {};
    this.deviceId = settings.deviceId || deviceId || null;
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    this.mirrored = settings.facingMode ? settings.facingMode === 'user' : !mobile;
    track.addEventListener('ended', () => {
      if (this.stream === stream && !this.stopped) {
        // Camera was taken away (unplugged, OS interruption). Try again once visible.
        this.#halt();
        this.#releaseStream();
        if (document.visibilityState === 'visible') this.start(null);
      }
    });

    // Keep refocusing as the code moves closer or further away (mostly Android).
    const caps = track.getCapabilities?.() ?? {};
    if (caps.focusMode?.includes('continuous')) {
      track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
    }

    this.video.srcObject = stream;
    this.video.classList.toggle('mirrored', this.mirrored);
    try {
      await this.video.play();
    } catch {
      // autoplay of a muted inline video is allowed everywhere we care about
    }

    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      this.devices = all.filter((d) => d.kind === 'videoinput');
    } catch {
      this.devices = [];
    }

    this.#ensureWorker();
    this.running = true;
    this.#emit(document.visibilityState === 'visible' ? 'running' : 'paused');
    this.#schedule(0);
  }

  async switchCamera() {
    if (this.devices.length < 2) return;
    const index = this.devices.findIndex((d) => d.deviceId === this.deviceId);
    const next = this.devices[(index + 1) % this.devices.length];
    await this.start(next.deviceId);
  }

  stop() {
    this.stopped = true;
    this.startToken++;
    this.#halt();
    this.#releaseStream();
    this.worker?.terminate();
    this.worker = null;
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  #halt() {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = null;
  }

  #releaseStream() {
    if (this.stream) this.stream.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  #handleVisibility() {
    if (this.stopped) return;
    if (document.visibilityState !== 'visible') {
      if (this.running) this.#emit('paused');
      return;
    }
    const live = this.stream?.getVideoTracks().some((track) => track.readyState === 'live');
    if (this.running && live) {
      this.video.play().catch(() => {});
      this.#emit('running');
      this.#schedule(0);
    } else if (this.state !== 'error') {
      this.start();
    }
  }

  #schedule(delay) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.#tick(), delay);
  }

  #tick() {
    this.timer = null;
    if (!this.running || this.busy || !this.worker) return;
    if (document.visibilityState !== 'visible') return; // resumed by #handleVisibility
    const v = this.video;
    if (v.readyState < 2 || !v.videoWidth) {
      this.#schedule(100);
      return;
    }
    const view = this.#viewLayout();
    const crop = this.#cropRect(view);
    const scale = Math.min(1, MAX_SIDE[this.engine] / Math.max(crop.w, crop.h));
    const w = Math.max(1, Math.round(crop.w * scale));
    const h = Math.max(1, Math.round(crop.h * scale));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.ctx.drawImage(v, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
    const image = this.ctx.getImageData(0, 0, w, h);
    this.busy = true;
    this.frameStart = performance.now();
    this.frame = { crop, scale, view };
    this.worker.postMessage({ id: ++this.frameId, width: w, height: h, buffer: image.data.buffer }, [image.data.buffer]);
  }

  #handleResult(data) {
    this.busy = false;
    if (!this.running) return;
    const { crop, scale, view } = this.frame;
    // Frame pixels -> video pixels -> fraction of the (object-fit: cover) preview.
    const toView = ([px, py]) => {
      const vx = crop.x + px / scale;
      const vy = crop.y + py / scale;
      const x = view.width ? (view.dx + vx * view.fit) / view.width : 0.5;
      const y = view.height ? (view.dy + vy * view.fit) / view.height : 0.5;
      return [view.mirrored ? 1 - x : x, y];
    };
    const codes = data.codes.map((code) => {
      const quad = code.quad.map(toView);
      const center = [(quad[0][0] + quad[2][0]) / 2, (quad[0][1] + quad[2][1]) / 2];
      return { text: code.text, bytes: code.bytes, quad, center };
    });
    this.onResult?.(codes);
    const elapsed = performance.now() - this.frameStart;
    this.#schedule(Math.max(0, FRAME_INTERVAL_MS - elapsed));
  }

  /** How the video frame maps onto the preview element (object-fit: cover). */
  #viewLayout() {
    const v = this.video;
    const rect = v.getBoundingClientRect();
    const fit = rect.width > 0 && rect.height > 0 ? Math.max(rect.width / v.videoWidth, rect.height / v.videoHeight) : 1;
    return {
      rect,
      width: rect.width,
      height: rect.height,
      fit,
      dx: (rect.width - v.videoWidth * fit) / 2,
      dy: (rect.height - v.videoHeight * fit) / 2,
      mirrored: this.mirrored,
    };
  }

  /** The viewfinder's area in video pixel coordinates. */
  #cropRect(view) {
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    const vr = view.rect;
    const fr = this.viewfinder?.getBoundingClientRect();
    if (vr.width > 0 && vr.height > 0 && fr && fr.width > 0) {
      const { fit: scale, dx, dy } = view;
      const w = fr.width / scale;
      const h = fr.height / scale;
      let x = (fr.left - vr.left - dx) / scale;
      const y = (fr.top - vr.top - dy) / scale;
      if (this.mirrored) x = vw - x - w;
      const x0 = clamp(x - w * MARGIN, 0, vw);
      const y0 = clamp(y - h * MARGIN, 0, vh);
      const x1 = clamp(x + w * (1 + MARGIN), 0, vw);
      const y1 = clamp(y + h * (1 + MARGIN), 0, vh);
      if (x1 - x0 >= 64 && y1 - y0 >= 64) return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    const side = Math.min(vw, vh) * 0.85;
    return { x: (vw - side) / 2, y: (vh - side) / 2, w: side, h: side };
  }
}
