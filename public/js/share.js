// Share view: creates a session, keeps the camera scanning, and pushes each
// newly confirmed QR payload to the server.

import { t } from './i18n.js';
import { Connection } from './connection.js';
import { Scanner } from './scanner.js';
import { CodeTracker } from './code-tracker.js';
import { bytesToBase64, describe } from './payload.js';
import { $, setText, connectionChip, formatClock, createWakeLock, storage, toast } from './ui.js';

const STORAGE_KEY = 'qripple.share';
const SVG_NS = 'http://www.w3.org/2000/svg';
// After this long without a successful read the code counts as out of view.
const LOST_AFTER_MS = 1200;

export function mountShare(root) {
  const el = {
    main: $('#share-main', root),
    code: $('#share-code', root),
    conn: $('#share-conn', root),
    receivers: $('#share-receivers', root),
    video: $('#camera-video', root),
    viewfinder: $('#viewfinder', root),
    cameraMessage: $('#camera-message', root),
    cameraMessageText: $('#camera-message-text', root),
    cameraRetry: $('#camera-retry', root),
    cameraSwitch: $('#camera-switch', root),
    scanStatus: $('#scan-status', root),
    markers: $('#code-markers', root),
    outlines: $('#code-outlines', root),
    choices: $('#code-choices', root),
    choicesList: $('#code-choices-list', root),
    content: $('#share-content', root),
    meta: $('#share-meta', root),
    end: $('#share-end', root),
    ended: $('#share-ended', root),
    endedTitle: $('#share-ended-title', root),
    endedText: $('#share-ended-text', root),
  };

  const saved = storage.get(STORAGE_KEY);
  const state = {
    phase: 'starting', // 'starting' | 'active' | 'ended'
    endTitle: '', // i18n keys for the ended card
    endText: '',
    code: saved?.code ?? null,
    sid: saved?.sid ?? null,
    token: saved?.token ?? null,
    hadSession: false, // a code was shown during this page's lifetime
    receivers: 0,
    conn: 'connecting',
    line: null, // access line in use (see connection.js)
    camera: 'starting', // scanner state
    cameraError: null,
    canSwitch: false,
    sentKey: null, // payload key sent on the current connection
    ackedKey: null,
    syncedAt: null,
  };

  const wakeLock = createWakeLock();
  // Which code is shared when zero, one or several are in view (see code-tracker.js).
  const tracker = new CodeTracker();

  // ------------------------------------------------------------ connection

  const conn = new Connection({
    onOpen() {
      state.sentKey = null;
      state.ackedKey = null;
      if (state.sid && state.token) conn.send({ t: 'resume', sid: state.sid, token: state.token });
      else conn.send({ t: 'create' });
    },
    onStatus(status, c) {
      state.conn = status;
      state.line = c.line?.id ?? null;
      if (status === 'reconnecting' && !conn.everOpened && conn.attempts >= 4 && state.phase === 'starting') {
        finish('failed', 'network');
        return;
      }
      render();
    },
    onMessage(msg) {
      switch (msg.t) {
        case 'created':
          state.token = msg.token;
        // falls through
        case 'resumed':
          state.code = msg.code;
          state.sid = msg.sid;
          state.receivers = msg.receivers ?? 0;
          state.phase = 'active';
          state.hadSession = true;
          storage.set(STORAGE_KEY, { code: state.code, sid: state.sid, token: state.token });
          flush();
          break;
        case 'receivers':
          state.receivers = msg.count;
          break;
        case 'ack':
          state.ackedKey = state.sentKey;
          state.syncedAt = Date.now();
          break;
        case 'ended':
          finish('ended', msg.reason);
          return;
        case 'error':
          handleError(msg.code);
          return;
        default:
          return;
      }
      render();
    },
  });

  function handleError(code) {
    if (code === 'session_ended' && !state.hadSession) {
      // Stale session from an earlier visit: just start a fresh one.
      storage.remove(STORAGE_KEY);
      state.sid = state.token = state.code = null;
      conn.send({ t: 'create' });
    } else if (code === 'session_ended' || code === 'forbidden') {
      finish('ended', 'gone');
    } else if (code === 'replaced') {
      finish('ended', 'replaced');
    } else if ((code === 'busy' || code === 'rate_limited') && state.phase === 'starting') {
      finish('failed', code);
    } else if (code === 'too_large') {
      toast(t('share.tooLarge'));
    }
  }

  /** Send the current payload if the server doesn't have it yet. */
  function flush() {
    const current = tracker.current;
    if (state.phase !== 'active' || !current || state.sentKey === current.key) return;
    if (conn.send({ t: 'update', text: current.text, data: current.key })) state.sentKey = current.key;
  }

  // ------------------------------------------------------------ scanning

  const scanner = new Scanner({
    video: el.video,
    viewfinder: el.viewfinder,
    onState({ state: cameraState, error, canSwitch }) {
      state.camera = cameraState;
      state.cameraError = error ?? null;
      state.canSwitch = canSwitch;
      render();
    },
    onResult(codes) {
      const keyed = codes.map((code) => ({ ...code, key: bytesToBase64(code.bytes) }));
      if (tracker.update(keyed, Date.now())) shared();
      else {
        renderScan();
        renderChoices();
      }
    },
  });

  /** A new code is now being shared. */
  function shared() {
    navigator.vibrate?.(30);
    flush();
    render();
  }

  function choose(key) {
    if (tracker.choose(key, Date.now())) shared();
    else render();
  }

  // ------------------------------------------------------------ rendering

  function scanState() {
    if (state.camera !== 'running') return state.camera; // starting | paused | error
    if (tracker.needsChoice) return 'multiple';
    if (Date.now() - tracker.lastSeenAt < LOST_AFTER_MS) return 'detected';
    return tracker.current ? 'lost' : 'scanning';
  }

  function renderScan() {
    const s = scanState();
    el.scanStatus.dataset.state = s;
    setText(el.scanStatus, t(`scan.${s}`, { n: tracker.visible.length }));
    el.viewfinder.classList.toggle('detected', s === 'detected');
  }

  // Numbered markers on the preview plus a list, shown while several codes
  // are in view. Elements are reused per code so a tap is never lost to a
  // re-render (results arrive ~16 times a second).
  const choiceEls = new Map(); // key -> { marker, outline, item, num, text, tag }

  function choiceElements(key) {
    let els = choiceEls.get(key);
    if (els) return els;
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.className = 'code-marker';
    marker.dataset.key = key;
    const outline = document.createElementNS(SVG_NS, 'polygon');
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'code-choice';
    item.dataset.key = key;
    const num = document.createElement('span');
    num.className = 'code-choice-num';
    const text = document.createElement('span');
    text.className = 'code-choice-text';
    const tag = document.createElement('span');
    tag.className = 'code-choice-tag';
    item.append(num, text, tag);
    el.markers.append(marker);
    el.outlines.append(outline);
    els = { marker, outline, item, num, text, tag };
    choiceEls.set(key, els);
    return els;
  }

  function renderChoices() {
    const codes = state.camera === 'running' ? tracker.visible : [];
    const show = codes.length >= 2;
    el.markers.hidden = !show;
    el.choices.hidden = !show;
    const live = new Set(show ? codes.map((c) => c.key) : []);
    for (const [key, els] of choiceEls) {
      if (live.has(key)) continue;
      els.marker.remove();
      els.outline.remove();
      els.item.remove();
      choiceEls.delete(key);
    }
    if (!show) return;
    const currentKey = tracker.current?.key;
    codes.forEach((code, i) => {
      const els = choiceElements(code.key);
      const n = String(i + 1);
      const isCurrent = code.key === currentKey;
      setText(els.marker, n);
      els.marker.setAttribute('aria-label', t('share.chooseCode', { n }));
      els.marker.style.left = `${(code.center[0] * 100).toFixed(2)}%`;
      els.marker.style.top = `${(code.center[1] * 100).toFixed(2)}%`;
      els.marker.classList.toggle('is-current', isCurrent);
      els.outline.setAttribute('points', code.quad.map(([x, y]) => `${(x * 100).toFixed(2)},${(y * 100).toFixed(2)}`).join(' '));
      els.outline.classList.toggle('is-current', isCurrent);
      const shown = describe(code.text, code.bytes);
      setText(els.num, n);
      setText(els.text, shown.binary ? t('common.binary', { n: code.bytes.length }) : shown.text);
      setText(els.tag, isCurrent ? t('share.sharingTag') : '');
      els.item.classList.toggle('is-current', isCurrent);
      el.choicesList.append(els.item); // keeps the list in on-screen numbering order
    });
  }

  function render() {
    if (state.phase === 'ended') {
      el.main.hidden = true;
      el.ended.hidden = false;
      setText(el.endedTitle, t(state.endTitle));
      setText(el.endedText, t(state.endText));
      return;
    }
    el.main.hidden = false;
    el.ended.hidden = true;

    setText(el.code, state.phase === 'active' && state.code ? state.code : '-----');
    connectionChip(el.conn, state.conn, state.line);
    setText(el.receivers, t('share.receivers', { n: state.receivers }));

    // Camera overlay
    const error = state.camera === 'error' ? state.cameraError : null;
    el.cameraMessage.hidden = !error;
    if (error) setText(el.cameraMessageText, t(`camera.${error}`));
    el.cameraRetry.hidden = error === 'insecure' || error === 'unsupported';
    el.cameraSwitch.hidden = !state.canSwitch || state.camera !== 'running';
    renderScan();
    renderChoices();

    // Current payload
    const current = tracker.current;
    if (!current) {
      el.content.classList.add('empty');
      setText(el.content, t('share.noContent'));
      setText(el.meta, '');
    } else {
      const shown = describe(current.text, current.bytes);
      el.content.classList.remove('empty');
      setText(el.content, shown.binary ? `${t('common.binary', { n: current.bytes.length })}\n${shown.text}` : shown.text);
      let meta;
      if (state.ackedKey === current.key) meta = t('share.synced', { time: formatClock(state.syncedAt) });
      else if (state.conn === 'online') meta = t('share.syncing');
      else meta = t('share.pendingSync');
      setText(el.meta, meta);
    }
  }

  function finish(kind, reason) {
    if (state.phase === 'ended') return;
    if (kind === 'failed') {
      state.endTitle = 'share.failed.title';
      state.endText = `share.failed.${reason}`;
    } else {
      state.endTitle = 'share.ended.title';
      const known = ['ended', 'expired', 'replaced'];
      state.endText = `share.ended.${known.includes(reason) ? reason : 'gone'}`;
    }
    state.phase = 'ended';
    storage.remove(STORAGE_KEY);
    scanner.stop();
    conn.stop();
    wakeLock.disable();
    clearInterval(ticker);
    render();
  }

  function endSharing() {
    if (state.phase === 'active') conn.send({ t: 'end' });
    finish('ended', 'ended');
  }

  // ------------------------------------------------------------ wiring

  const ticker = setInterval(() => {
    if (state.phase === 'ended') return;
    renderScan();
  }, 500);
  const onEnd = () => {
    if (window.confirm(t('share.endConfirm'))) endSharing();
  };
  const onChoose = (event) => {
    const target = event.target.closest('[data-key]');
    if (target) choose(target.dataset.key);
  };
  const onRetry = () => scanner.start();
  const onSwitch = () => scanner.switchCamera();
  const onLang = () => render();
  const onBeforeUnload = (event) => {
    if (state.phase === 'active' && state.receivers > 0) event.preventDefault();
  };
  el.end.addEventListener('click', onEnd);
  el.markers.addEventListener('click', onChoose);
  el.choices.addEventListener('click', onChoose);
  el.cameraRetry.addEventListener('click', onRetry);
  el.cameraSwitch.addEventListener('click', onSwitch);
  window.addEventListener('langchange', onLang);
  window.addEventListener('beforeunload', onBeforeUnload);

  render();
  conn.start();
  scanner.start();
  wakeLock.enable();

  return {
    canLeave() {
      return state.phase !== 'active' || window.confirm(t('share.endConfirm'));
    },
    unmount() {
      if (state.phase !== 'ended') endSharing();
      clearInterval(ticker);
      el.end.removeEventListener('click', onEnd);
      el.markers.removeEventListener('click', onChoose);
      el.choices.removeEventListener('click', onChoose);
      el.cameraRetry.removeEventListener('click', onRetry);
      el.cameraSwitch.removeEventListener('click', onSwitch);
      window.removeEventListener('langchange', onLang);
      window.removeEventListener('beforeunload', onBeforeUnload);
      // Reset the DOM for the next visit.
      el.main.hidden = false;
      el.ended.hidden = true;
      el.video.classList.remove('mirrored');
      state.camera = 'stopped';
      renderChoices(); // removes any leftover markers
    },
  };
}
