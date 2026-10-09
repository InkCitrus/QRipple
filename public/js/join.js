// Join view: enter a pairing code, then show the sharer's latest QR code,
// regenerated locally from the decoded data.

import { t } from './i18n.js';
import { Connection } from './connection.js';
import { base64ToBytes, describe } from './payload.js';
import { renderQrSvg } from './qr-render.js';
import { $, setText, connectionChip, formatDuration, formatClock, copyText, createWakeLock, toast } from './ui.js';

const CODE_RE = /^\d{5}$/;
const JOIN_ERRORS = new Set(['not_found', 'full', 'rate_limited', 'network']);

export function mountJoin(root, { navigate }) {
  const el = {
    form: $('#join-form', root),
    input: $('#join-code', root),
    error: $('#join-error', root),
    submit: $('#join-submit', root),
    session: $('#join-session', root),
    sessionCode: $('#join-session-code', root),
    conn: $('#join-conn', root),
    timer: $('#join-timer', root),
    banner: $('#join-banner', root),
    qrFrame: $('#qr-frame', root),
    qrPlaceholder: $('#qr-placeholder', root),
    qrMeta: $('#qr-meta', root),
    contentCard: $('#join-content-card', root),
    content: $('#join-content', root),
    copy: $('#join-copy', root),
    leave: $('#join-leave', root),
    ended: $('#join-ended', root),
    endedTitle: $('#join-ended-title', root),
    endedText: $('#join-ended-text', root),
  };

  const state = {
    phase: 'form', // 'form' | 'joining' | 'session' | 'ended'
    error: null,
    code: null,
    sid: null,
    deadline: null,
    conn: 'connecting',
    hostOnline: true,
    payload: null, // { rev, data, text, bytes, receivedAt }
    endReason: null,
  };

  const wakeLock = createWakeLock();
  let conn = null;
  let retryTimer = null;

  // ------------------------------------------------------------ connection

  function join(code) {
    state.phase = 'joining';
    state.code = code;
    state.sid = null;
    state.error = null;
    render();
    conn = new Connection({
      onOpen() {
        const msg = { t: 'join', code: state.code };
        if (state.sid) msg.sid = state.sid; // rejoin after a reconnect
        conn.send(msg);
      },
      onStatus(status) {
        state.conn = status;
        if (state.phase === 'joining' && status !== 'online' && conn.attempts >= 3) {
          fail('network');
          return;
        }
        render();
      },
      onMessage: handleMessage,
    }).start();
  }

  function handleMessage(msg) {
    switch (msg.t) {
      case 'joined':
        state.phase = 'session';
        state.sid = msg.sid;
        state.code = msg.code;
        state.deadline = Date.now() + msg.remainingMs;
        state.hostOnline = msg.hostOnline;
        if (msg.payload) showPayload(msg.payload);
        wakeLock.enable();
        break;
      case 'payload':
        showPayload(msg.payload);
        break;
      case 'host':
        state.hostOnline = msg.online;
        break;
      case 'ended':
        end(msg.reason);
        return;
      case 'error':
        handleError(msg.code);
        return;
      default:
        return;
    }
    render();
  }

  function handleError(code) {
    if (state.phase === 'joining') {
      fail(JOIN_ERRORS.has(code) ? code : 'not_found');
    } else if (state.phase === 'session') {
      if (code === 'session_ended' || code === 'not_found') {
        end('gone');
      } else if (code === 'full' || code === 'rate_limited') {
        // Could not rejoin right now; drop the socket and let it reconnect later.
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => conn?.ws?.close(), 5000);
      }
    }
  }

  function fail(code) {
    conn?.stop();
    conn = null;
    state.phase = 'form';
    state.error = code;
    render();
    el.input.focus();
  }

  function end(reason) {
    conn?.stop();
    conn = null;
    clearTimeout(retryTimer);
    wakeLock.disable();
    state.phase = 'ended';
    state.endReason = ['ended', 'expired', 'host_left'].includes(reason) ? reason : 'gone';
    render();
  }

  function leave() {
    conn?.send({ t: 'leave' });
    conn?.stop();
    conn = null;
    wakeLock.disable();
  }

  // ------------------------------------------------------------ payload

  function showPayload(p) {
    const previous = state.payload;
    // Same content: nothing to redraw (avoids needless flicker).
    if (previous && previous.data === p.data) {
      previous.rev = p.rev;
      return;
    }
    const bytes = base64ToBytes(p.data);
    state.payload = { rev: p.rev, data: p.data, text: p.text, bytes, receivedAt: Date.now() - (p.ageMs || 0) };
    try {
      el.qrFrame.replaceChildren(renderQrSvg(bytes));
    } catch {
      el.qrFrame.replaceChildren(el.qrPlaceholder);
    }
    if (previous) {
      el.qrFrame.classList.remove('updated');
      void el.qrFrame.offsetWidth; // restart the animation
      el.qrFrame.classList.add('updated');
    }
  }

  async function copyPayload() {
    const p = state.payload;
    if (!p) return;
    const shown = describe(p.text, p.bytes);
    const ok = await copyText(shown.binary ? shown.fullHex() : shown.text);
    toast(t(ok ? 'common.copied' : 'common.copyFailed'));
  }

  // ------------------------------------------------------------ rendering

  function renderTimer() {
    if (state.phase !== 'session' || !state.deadline) {
      el.timer.hidden = true;
      return;
    }
    el.timer.hidden = false;
    setText(el.timer, t('common.remaining', { time: formatDuration(state.deadline - Date.now()) }));
  }

  function render() {
    const { phase } = state;
    el.form.hidden = phase !== 'form' && phase !== 'joining';
    el.session.hidden = phase !== 'session';
    el.ended.hidden = phase !== 'ended';

    // Form
    el.submit.disabled = phase === 'joining';
    el.input.readOnly = phase === 'joining';
    setText(el.submit, t(phase === 'joining' ? 'join.joining' : 'join.submit'));
    el.error.hidden = !state.error;
    if (state.error) setText(el.error, t(`join.error.${state.error}`));
    el.input.setAttribute('aria-invalid', state.error ? 'true' : 'false');

    // Session
    if (phase === 'session') {
      setText(el.sessionCode, state.code);
      connectionChip(el.conn, state.conn);
      renderTimer();
      let banner = null;
      if (state.conn !== 'online') banner = 'join.reconnecting';
      else if (!state.hostOnline) banner = 'join.hostOffline';
      el.banner.hidden = !banner;
      if (banner) setText(el.banner, t(banner));

      const p = state.payload;
      el.contentCard.hidden = !p;
      if (p) {
        const shown = describe(p.text, p.bytes);
        setText(el.content, shown.binary ? `${t('common.binary', { n: p.bytes.length })}\n${shown.text}` : shown.text);
        setText(el.qrMeta, t('join.updatedAt', { time: formatClock(p.receivedAt) }));
      } else {
        setText(el.qrMeta, '');
      }
    }

    // Ended
    if (phase === 'ended') {
      setText(el.endedTitle, t('join.ended.title'));
      setText(el.endedText, t(`join.ended.${state.endReason}`));
    }
  }

  // ------------------------------------------------------------ wiring

  function onInput() {
    const digits = el.input.value.replace(/\D/g, '').slice(0, 5);
    if (digits !== el.input.value) el.input.value = digits;
    if (state.error) {
      state.error = null;
      render();
    }
    if (digits.length === 5 && state.phase === 'form') onSubmit();
  }

  function onSubmit(event) {
    event?.preventDefault();
    if (state.phase !== 'form') return;
    const code = el.input.value.trim();
    if (!CODE_RE.test(code)) {
      state.error = 'invalid';
      render();
      return;
    }
    el.input.blur();
    join(code);
  }

  function onLeave() {
    leave();
    navigate('/');
  }

  const ticker = setInterval(renderTimer, 1000);
  const onLang = () => render();
  el.form.addEventListener('submit', onSubmit);
  el.input.addEventListener('input', onInput);
  el.copy.addEventListener('click', copyPayload);
  el.leave.addEventListener('click', onLeave);
  window.addEventListener('langchange', onLang);

  el.input.value = '';
  render();
  // Focus the code field on larger screens; on phones the keyboard would cover the page.
  if (window.matchMedia('(hover: hover)').matches) el.input.focus();

  return {
    canLeave: () => true,
    unmount() {
      leave();
      clearInterval(ticker);
      clearTimeout(retryTimer);
      el.form.removeEventListener('submit', onSubmit);
      el.input.removeEventListener('input', onInput);
      el.copy.removeEventListener('click', copyPayload);
      el.leave.removeEventListener('click', onLeave);
      window.removeEventListener('langchange', onLang);
      // Reset the DOM for the next visit.
      el.qrFrame.replaceChildren(el.qrPlaceholder);
      el.qrFrame.classList.remove('updated');
      el.input.value = '';
    },
  };
}
