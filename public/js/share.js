// Share view: creates a session, keeps the camera scanning, and pushes each
// newly confirmed QR payload to the server.

import { t } from './i18n.js';
import { Connection } from './connection.js';
import { Scanner } from './scanner.js';
import { bytesToBase64, describe } from './payload.js';
import { $, setText, connectionChip, formatDuration, formatClock, createWakeLock, storage, toast } from './ui.js';

const STORAGE_KEY = 'qripple.share';
// A *changed* value must be read this many times in a row before it replaces
// what is shared, so two codes in view (or a one-off misread) can't make
// receivers flicker. The very first code is shared on its first read.
const CONFIRM_READS = 2;
// After this long without a successful read the code counts as out of view.
const LOST_AFTER_MS = 1200;

export function mountShare(root) {
  const el = {
    main: $('#share-main', root),
    code: $('#share-code', root),
    conn: $('#share-conn', root),
    receivers: $('#share-receivers', root),
    timer: $('#share-timer', root),
    video: $('#camera-video', root),
    viewfinder: $('#viewfinder', root),
    cameraMessage: $('#camera-message', root),
    cameraMessageText: $('#camera-message-text', root),
    cameraRetry: $('#camera-retry', root),
    cameraSwitch: $('#camera-switch', root),
    scanStatus: $('#scan-status', root),
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
    deadline: null,
    receivers: 0,
    conn: 'connecting',
    camera: 'starting', // scanner state
    cameraError: null,
    canSwitch: false,
    current: null, // { key, text, bytes, at } — last confirmed payload
    candidate: null,
    candidateCount: 0,
    lastSeenAt: 0,
    sentKey: null, // payload key sent on the current connection
    ackedKey: null,
    syncedAt: null,
  };

  const wakeLock = createWakeLock();

  // ------------------------------------------------------------ connection

  const conn = new Connection({
    onOpen() {
      state.sentKey = null;
      state.ackedKey = null;
      if (state.sid && state.token) conn.send({ t: 'resume', sid: state.sid, token: state.token });
      else conn.send({ t: 'create' });
    },
    onStatus(status) {
      state.conn = status;
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
          state.deadline = Date.now() + msg.remainingMs;
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
    const current = state.current;
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
    onResult(result) {
      const now = Date.now();
      if (!result) {
        state.candidate = null;
        state.candidateCount = 0;
        renderScan();
        return;
      }
      state.lastSeenAt = now;
      const key = bytesToBase64(result.bytes);
      if (state.current?.key === key) {
        state.candidate = null;
        state.candidateCount = 0;
      } else {
        if (state.candidate?.key === key) state.candidateCount += 1;
        else {
          state.candidate = { key, text: result.text, bytes: result.bytes };
          state.candidateCount = 1;
        }
        if (!state.current || state.candidateCount >= CONFIRM_READS) {
          state.current = { ...state.candidate, at: now };
          state.candidate = null;
          state.candidateCount = 0;
          navigator.vibrate?.(30);
          flush();
          render();
          return;
        }
      }
      renderScan();
    },
  });

  // ------------------------------------------------------------ rendering

  function scanState() {
    if (state.camera !== 'running') return state.camera; // starting | paused | error
    if (Date.now() - state.lastSeenAt < LOST_AFTER_MS) return 'detected';
    return state.current ? 'lost' : 'scanning';
  }

  function renderScan() {
    const s = scanState();
    el.scanStatus.dataset.state = s;
    setText(el.scanStatus, t(`scan.${s}`));
    el.viewfinder.classList.toggle('detected', s === 'detected');
  }

  function renderTimer() {
    if (!state.deadline) {
      el.timer.hidden = true;
      return;
    }
    el.timer.hidden = false;
    setText(el.timer, t('common.remaining', { time: formatDuration(state.deadline - Date.now()) }));
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
    connectionChip(el.conn, state.conn);
    setText(el.receivers, t('share.receivers', { n: state.receivers }));
    renderTimer();

    // Camera overlay
    const error = state.camera === 'error' ? state.cameraError : null;
    el.cameraMessage.hidden = !error;
    if (error) setText(el.cameraMessageText, t(`camera.${error}`));
    el.cameraRetry.hidden = error === 'insecure' || error === 'unsupported';
    el.cameraSwitch.hidden = !state.canSwitch || state.camera !== 'running';
    renderScan();

    // Current payload
    const current = state.current;
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
    renderTimer();
    renderScan();
  }, 500);
  const onEnd = () => {
    if (window.confirm(t('share.endConfirm'))) endSharing();
  };
  const onRetry = () => scanner.start();
  const onSwitch = () => scanner.switchCamera();
  const onLang = () => render();
  const onBeforeUnload = (event) => {
    if (state.phase === 'active' && state.receivers > 0) event.preventDefault();
  };
  el.end.addEventListener('click', onEnd);
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
      el.cameraRetry.removeEventListener('click', onRetry);
      el.cameraSwitch.removeEventListener('click', onSwitch);
      window.removeEventListener('langchange', onLang);
      window.removeEventListener('beforeunload', onBeforeUnload);
      // Reset the DOM for the next visit.
      el.main.hidden = false;
      el.ended.hidden = true;
      el.video.classList.remove('mirrored');
    },
  };
}
