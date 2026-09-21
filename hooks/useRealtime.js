'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { localNowTime, localToday } from '../lib/dates.js';
import { createEventHandler, toolOutputEvents } from '../lib/realtime/events.js';

const IDLE_LIMIT_MS = 120_000; // hang up after two quiet minutes: a live session costs money
const CONNECT_LIMIT_MS = 20_000;
const DROP_GRACE_MS = 6_000; // WebRTC reports "disconnected" for short network blips
const SPEAKING_WATCHDOG_MS = 8_000;

const SERVER_CODES = {
  realtime_unavailable: 'unavailable',
  realtime_invalid_key: 'invalid_key',
  realtime_quota: 'quota',
  realtime_model: 'model',
  realtime_upstream: 'upstream',
};

/** Turns whatever went wrong into { code, detail } for the UI. */
function classify(err) {
  if (err?.code && SERVER_CODES[err.code]) return { code: SERVER_CODES[err.code], detail: err.detail || '' };
  if (err?.status === 429) return { code: 'rate', detail: '' };
  if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') return { code: 'not-allowed', detail: '' };
  if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') return { code: 'no-mic', detail: '' };
  if (err?.code === 'insecure' || err?.code === 'timeout') return { code: err.code, detail: '' };
  if (err?.code === 'sdp') return { code: 'sdp', detail: err.detail || '' };
  return { code: 'failed', detail: err?.message && !/^http_|^Failed to fetch/.test(err.message) ? err.message : '' };
}

/**
 * Live voice session with the OpenAI Realtime API over WebRTC.
 *   1. our server mints an ephemeral key (the real API key never reaches the browser)
 *   2. the browser opens a peer connection straight to OpenAI: mic in, model voice out
 *   3. when the model calls a function, we run it on OUR server (SQLite) and hand the result back
 */
export function useRealtime({ locale, getApiKey, onUserInterim, onUserText, onAssistantText, onTools, onError, onEnded }) {
  const [status, setStatus] = useState('idle'); // idle | connecting | live
  const [phase, setPhase] = useState('listening'); // listening | thinking | speaking
  const [model, setModel] = useState(null);
  const analyserRef = useRef(null);
  const live = useRef(null);
  const cb = useRef({});
  cb.current = { getApiKey, onUserInterim, onUserText, onAssistantText, onTools, onError, onEnded };

  const teardown = useCallback(() => {
    const s = live.current;
    live.current = null;
    if (!s) return;
    clearTimeout(s.idleTimer);
    clearTimeout(s.connectTimer);
    clearTimeout(s.dropTimer);
    clearTimeout(s.speakTimer);
    try { s.dc?.close(); } catch { /* already closed */ }
    try { s.pc?.close(); } catch { /* already closed */ }
    s.stream?.getTracks().forEach((t) => t.stop());
    if (s.audio) {
      s.audio.pause();
      s.audio.srcObject = null;
    }
    s.ctx?.close().catch(() => {});
    analyserRef.current = null;
    setStatus('idle');
    setPhase('listening');
  }, []);

  const connect = useCallback(async () => {
    if (live.current) return;
    const session = {};
    live.current = session;
    setStatus('connecting');
    setPhase('thinking');
    const active = () => live.current === session;

    const clock = () => ({ today: localToday(), now: localNowTime(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, locale });
    const fail = (err) => {
      if (!active()) return;
      const { code, detail } = classify(err);
      teardown();
      cb.current.onError?.(code, detail);
    };
    const endWith = (reason) => {
      if (!active()) return;
      teardown();
      cb.current.onEnded?.(reason);
    };

    session.connectTimer = setTimeout(() => fail({ code: 'timeout' }), CONNECT_LIMIT_MS);

    try {
      if (typeof window === 'undefined' || !window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
        throw { code: 'insecure' };
      }

      const { clientSecret, model: usedModel } = await api.realtimeSession(clock(), cb.current.getApiKey?.() || '');
      if (!active()) return;
      setModel(usedModel);

      // Ask for the microphone before building the connection, so a refusal fails fast and cleanly.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (!active()) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      session.stream = stream;

      const pc = new RTCPeerConnection();
      session.pc = pc;
      pc.addTrack(stream.getAudioTracks()[0], stream);

      const audio = new Audio();
      audio.autoplay = true;
      session.audio = audio;

      // Two analysers: our own voice while we talk, the model's voice while it answers.
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = AC ? new AC() : null;
      session.ctx = ctx;
      ctx?.resume?.().catch(() => {});
      const analyserFor = (mediaStream) => {
        if (!ctx) return null;
        try {
          const an = ctx.createAnalyser();
          an.fftSize = 128;
          an.smoothingTimeConstant = 0.78;
          ctx.createMediaStreamSource(mediaStream).connect(an);
          return an;
        } catch {
          return null; // the visualiser is cosmetic: never let it break the call
        }
      };
      session.micAnalyser = analyserFor(stream);
      analyserRef.current = session.micAnalyser;

      pc.ontrack = (e) => {
        audio.srcObject = e.streams[0];
        audio.play().catch(() => {}); // Safari wants an explicit play()
        session.botAnalyser = analyserFor(e.streams[0]);
      };
      pc.onconnectionstatechange = () => {
        if (!active()) return;
        clearTimeout(session.dropTimer);
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') endWith('connection');
        else if (pc.connectionState === 'disconnected') session.dropTimer = setTimeout(() => endWith('connection'), DROP_GRACE_MS);
      };

      const dc = pc.createDataChannel('oai-events');
      session.dc = dc;

      const bump = () => {
        clearTimeout(session.idleTimer);
        session.idleTimer = setTimeout(() => endWith('idle'), IDLE_LIMIT_MS);
      };

      const usePhase = (p) => {
        clearTimeout(session.speakTimer);
        setPhase(p);
        analyserRef.current = p === 'speaking' ? session.botAnalyser ?? session.micAnalyser : session.micAnalyser;
      };

      const handle = createEventHandler({
        onPhase: usePhase,
        onIdle: () => usePhase('listening'),
        // Safety net when the transport sends no "audio finished" event.
        onResponseEnd: () => {
          clearTimeout(session.speakTimer);
          session.speakTimer = setTimeout(() => usePhase('listening'), SPEAKING_WATCHDOG_MS);
        },
        onUserInterim: (t) => cb.current.onUserInterim?.(t),
        onUserText: (t) => cb.current.onUserText?.(t),
        onAssistantText: (t) => cb.current.onAssistantText?.(t),
        onError: (m) => cb.current.onError?.('failed', m),
        onToolCalls: async (calls) => {
          const results = await Promise.all(
            calls.map(async (call) => {
              try {
                const res = await api.realtimeTool({ ...clock(), name: call.name, args: call.args });
                if (active()) cb.current.onTools?.(res, call);
                return { callId: call.callId, output: res.output };
              } catch {
                return { callId: call.callId, output: { ok: false, error: 'server_error' } };
              }
            }),
          );
          if (active() && dc.readyState === 'open') {
            for (const ev of toolOutputEvents(results)) dc.send(JSON.stringify(ev));
          }
        },
      });

      dc.addEventListener('message', (e) => {
        bump();
        try {
          handle(JSON.parse(e.data));
        } catch {
          /* ignore malformed frames */
        }
      });
      dc.addEventListener('open', () => {
        if (!active()) return;
        clearTimeout(session.connectTimer);
        bump();
        setStatus('live');
        setPhase('listening');
      });
      dc.addEventListener('close', () => endWith('connection'));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const res = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        body: offer.sdp,
        headers: { Authorization: `Bearer ${clientSecret}`, 'Content-Type': 'application/sdp' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw { code: 'sdp', detail: `HTTP ${res.status}${text ? `: ${text.replace(/\s+/g, ' ').slice(0, 160)}` : ''}` };
      }
      if (!active()) return;
      await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
    } catch (err) {
      fail(err);
    }
  }, [locale, teardown]);

  useEffect(() => teardown, [teardown]);

  return { status, phase, model, analyserRef, connect, disconnect: teardown };
}
