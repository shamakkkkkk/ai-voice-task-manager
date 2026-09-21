'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { api } from '../lib/api.js';
import { getStrings } from '../lib/i18n.js';
import { addDays, localNowTime, localToday } from '../lib/dates.js';
import { describeSummary } from '../lib/format.js';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition.js';
import { useMicAnalyser } from '../hooks/useMicAnalyser.js';
import { useRealtime } from '../hooks/useRealtime.js';
import { useSpeak } from '../hooks/useSpeak.js';
import VoiceOrb from './VoiceOrb.jsx';
import TaskBoard from './TaskBoard.jsx';
import Insight from './Insight.jsx';
import KeyPanel from './KeyPanel.jsx';
import { IconSend, IconVolume, IconVolumeOff } from './Icons.jsx';

let toastSeq = 0;
const str = () => getStrings(useStore.getState().locale);

export default function App() {
  const tasks = useStore((st) => st.tasks);
  const locale = useStore((st) => st.locale);
  const voiceReply = useStore((st) => st.voiceReply);
  const mode = useStore((st) => st.mode);
  const openaiKey = useStore((st) => st.openaiKey);
  const s = getStrings(locale);

  const [ready, setReady] = useState(false);
  const [health, setHealth] = useState(null);
  const [caps, setCaps] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [clock, setClock] = useState({ today: '2000-01-01', tomorrow: '2000-01-02' });
  const [tab, setTab] = useState('open');
  const [thinking, setThinking] = useState(false);
  const [heard, setHeard] = useState('');
  const [reply, setReply] = useState('');
  const [insight, setInsight] = useState(null);
  const [toast, setToast] = useState(null);
  const [problem, setProblem] = useState(null); // { kind: 'mic' | 'live', code } | { kind: 'text', text }
  const [draft, setDraft] = useState('');
  const busy = useRef(false);
  const inputRef = useRef(null);
  const lastUser = useRef('');
  const rtModel = useRef(null);

  const serverHasKey = caps?.realtime === true;
  const hasKey = serverHasKey || Boolean(openaiKey);
  const liveMode = mode === 'live';

  const { analyserRef: micRef, open: openMic, close: closeMic } = useMicAnalyser();
  const { speak, cancel } = useSpeak();

  const showToast = useCallback((text, undo = null) => setToast({ id: ++toastSeq, text, undo }), []);

  // ── loading: preferences (localStorage), tasks + capabilities (server) ──────
  const loadTasks = useCallback(async () => {
    try {
      const { tasks: rows } = await api.tasks();
      useStore.getState().setTasks(rows);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      await Promise.resolve(useStore.persist.rehydrate());
      const st = useStore.getState();
      if (!st.localeChosen) st.detectLocale(navigator.language?.toLowerCase().startsWith('ru') ? 'ru' : 'en');
      const [, h, c] = await Promise.all([loadTasks(), api.health().catch(() => null), api.capabilities().catch(() => null)]);
      if (!alive) return;
      setHealth(h);
      setCaps(c);
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [loadTasks]);

  // Keep several tabs/devices in sync: refetch when the tab becomes visible again.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !busy.current) loadTasks();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadTasks]);

  useEffect(() => {
    const tick = () => {
      const today = localToday();
      setClock((c) => (c.today === today ? c : { today, tomorrow: addDays(today, 1) }));
    };
    tick();
    const id = setInterval(tick, 30_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(id);
  }, [toast]);

  // ── classic pipeline: phrase → /api/command (LLM or local NLU → SQLite) → fresh list ──
  const runCommand = useCallback(
    async (text, via) => {
      const cmd = text.trim();
      if (cmd.length < 2 || busy.current) return;
      busy.current = true;
      setThinking(true);
      setHeard(cmd);
      setReply('');
      setProblem(null);
      setToast(null);

      const strings = str();
      const now = new Date();
      const today = localToday(now);
      const before = useStore.getState().tasks;
      try {
        const res = await api.command({
          text: cmd,
          source: via,
          today,
          now: localNowTime(now),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          locale: useStore.getState().locale,
        });
        useStore.getState().setTasks(res.tasks);
        const { summary } = res;
        const changed = summary.added.length + summary.completed.length + summary.deleted.length > 0;
        const lines = describeSummary(summary, today, strings);
        setInsight({ text: cmd, engine: res.engine, model: res.model, ms: res.ms, fallbackReason: res.fallbackReason, summary });
        if (!lines.length) lines.push(strings.nothing);
        showToast(lines.join('. '), changed ? before : null);
        if (useStore.getState().voiceReply) speak(lines.join('. '), strings.speechLang);
      } catch {
        setProblem({ kind: 'text', text: strings.serverError });
      } finally {
        setThinking(false);
        busy.current = false;
      }
    },
    [showToast, speak],
  );

  const { supported, listening, start, stop } = useSpeechRecognition({
    lang: s.speechLang,
    onInterim: setHeard,
    onFinal: (text) => runCommand(text, 'voice'),
    onError: (code) => setProblem({ kind: 'mic', code }),
    onAudioStart: openMic,
    onEnd: closeMic,
  });

  // ── live pipeline: OpenAI Realtime speaks with the user and calls our tools ──
  const rt = useRealtime({
    locale,
    getApiKey: () => useStore.getState().openaiKey,
    onUserInterim: setHeard,
    onUserText: (t) => {
      lastUser.current = t;
      setHeard(t);
      setReply('');
    },
    onAssistantText: setReply,
    onTools: (res) => {
      const before = useStore.getState().tasks;
      useStore.getState().setTasks(res.tasks);
      if (!res.summary) return;
      const { summary } = res;
      const changed = summary.added.length + summary.completed.length + summary.deleted.length > 0;
      setInsight({ text: lastUser.current || '…', engine: 'realtime', model: rtModel.current, ms: null, fallbackReason: null, summary });
      if (changed) showToast(describeSummary(summary, localToday(), str()).join('. '), before);
    },
    onError: (code, detail) => setProblem({ kind: 'live', code: str().liveErrors[code] ? code : 'failed', detail }),
    onEnded: (why) => setProblem({ kind: 'text', text: str().liveEnded[why] ?? str().liveEnded.connection }),
  });
  rtModel.current = rt.model;

  const phase = liveMode
    ? rt.status === 'connecting'
      ? 'thinking'
      : rt.status === 'live'
        ? rt.phase
        : 'idle'
    : thinking
      ? 'thinking'
      : listening
        ? 'listening'
        : 'idle';

  const toggleListening = useCallback(() => {
    if (liveMode) {
      if (rt.status !== 'idle') {
        rt.disconnect(); // also cancels a connection that is still being set up
        return;
      }
      cancel();
      setHeard('');
      setReply('');
      if (!hasKey) {
        setProblem({ kind: 'live', code: 'unavailable' });
        return;
      }
      setProblem(null);
      rt.connect();
      return;
    }
    if (thinking) return;
    if (listening) {
      stop();
      return;
    }
    if (!supported) {
      inputRef.current?.focus();
      return;
    }
    cancel();
    setHeard('');
    setProblem(null);
    start();
  }, [liveMode, hasKey, rt, thinking, listening, supported, start, stop, cancel]);

  // Space toggles the mic when nothing else has focus.
  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== 'Space' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target;
      if (el instanceof HTMLElement && el.closest('input, textarea, button, [contenteditable="true"], [role="tab"]')) return;
      e.preventDefault();
      toggleListening();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleListening]);

  const changeMode = (next) => {
    if (next === mode) return;
    rt.disconnect();
    if (listening) stop();
    setProblem(null);
    useStore.getState().setMode(next);
  };

  const submitText = (e) => {
    e.preventDefault();
    const v = draft.trim();
    if (!v) return;
    setDraft('');
    runCommand(v, 'text');
  };

  // ── task list actions: optimistic UI, the server (SQLite) has the last word ──
  const toggleTask = async (id) => {
    const before = useStore.getState().tasks;
    const task = before.find((t) => t.id === id);
    if (!task) return;
    const done = !task.done;
    useStore.getState().setTasks(before.map((t) => (t.id === id ? { ...t, done, doneAt: done ? Date.now() : null } : t)));
    try {
      useStore.getState().setTasks((await api.setDone(id, done)).tasks);
    } catch {
      useStore.getState().setTasks(before);
      showToast(str().serverError);
    }
  };

  const removeTask = async (id) => {
    const before = useStore.getState().tasks;
    const task = before.find((t) => t.id === id);
    if (!task) return;
    useStore.getState().setTasks(before.filter((t) => t.id !== id));
    try {
      useStore.getState().setTasks((await api.remove(id)).tasks);
      showToast(str().deleted(1, task.title), before);
    } catch {
      useStore.getState().setTasks(before);
      showToast(str().serverError);
    }
  };

  const clearDone = async () => {
    const before = useStore.getState().tasks;
    useStore.getState().setTasks(before.filter((t) => !t.done));
    try {
      useStore.getState().setTasks((await api.clearDone()).tasks);
    } catch {
      useStore.getState().setTasks(before);
      showToast(str().serverError);
    }
  };

  const undo = async () => {
    const snapshot = toast?.undo;
    setToast(null);
    if (!snapshot) return;
    useStore.getState().setTasks(snapshot);
    try {
      useStore.getState().setTasks((await api.restore(snapshot)).tasks);
    } catch {
      await loadTasks();
      showToast(str().serverError);
    }
  };

  // ── derived UI text ─────────────────────────────────────────────────────────
  const statusText = liveMode
    ? phase === 'speaking'
      ? s.liveSpeaking
      : rt.status === 'connecting'
        ? s.connecting
        : rt.status === 'live'
          ? phase === 'thinking'
            ? s.thinking
            : s.liveListening
          : s.tapLive
    : phase === 'listening'
      ? s.listening
      : phase === 'thinking'
        ? s.thinking
        : s.tap;
  const shownText = heard || (phase === 'listening' ? s.listeningEmpty : s.idlePrompt);
  const problemText =
    problem?.kind === 'mic'
      ? s.errors[problem.code] ?? s.errors.default
      : problem?.kind === 'live'
        ? `${s.liveErrors[problem.code] ?? s.liveErrors.failed}${problem.detail ? ` (${problem.detail})` : ''}`
        : problem?.text;

  return (
    <div className={`shell${ready ? ' is-ready' : ''}`}>
      <header className="top">
        <span className="wordmark">
          <i className="rec-dot" aria-hidden="true" />
          AI Voice Task Manager
        </span>
        <div className="top-actions">
          <div className="seg" role="group" aria-label="Language">
            {['ru', 'en'].map((l) => (
              <button key={l} type="button" className="seg-btn" aria-pressed={locale === l} onClick={() => useStore.getState().setLocale(l)}>
                {l === 'ru' ? 'RU' : 'EN'}
              </button>
            ))}
          </div>
          {!liveMode && (
            <button
              type="button"
              className="icon-btn"
              aria-pressed={voiceReply}
              aria-label={s.voiceReply}
              title={s.voiceReply}
              onClick={() => {
                if (voiceReply) cancel();
                useStore.getState().setVoiceReply(!voiceReply);
              }}
            >
              {voiceReply ? <IconVolume width={20} height={20} /> : <IconVolumeOff width={20} height={20} />}
            </button>
          )}
        </div>
      </header>

      <main className="grid">
        <section className="stage" aria-label="Voice">
          <div className="seg seg-mode" role="group" aria-label={s.modeLabel}>
            {['classic', 'live'].map((m) => (
              <button
                key={m}
                type="button"
                className="seg-btn"
                aria-pressed={m === 'live' ? liveMode : !liveMode}
                onClick={() => changeMode(m)}
              >
                {s.modes[m]}
              </button>
            ))}
          </div>

          {liveMode && (
            <KeyPanel
              s={s}
              savedKey={openaiKey}
              serverHasKey={serverHasKey}
              required={ready && !hasKey}
              onSave={(k) => {
                useStore.getState().setOpenaiKey(k);
                setProblem(null);
              }}
              onClear={() => useStore.getState().setOpenaiKey('')}
            />
          )}

          <VoiceOrb
            phase={phase}
            analyserRef={liveMode ? rt.analyserRef : micRef}
            onClick={toggleListening}
            label={statusText}
            disabled={liveMode ? false : thinking}
          />
          <p className="status" aria-live="polite">{statusText}</p>
          <p className={`transcript${heard ? '' : ' is-hint'}`} lang={locale}>{shownText}</p>
          {liveMode && reply && <p className="reply">{reply}</p>}

          {problemText && <p className="notice" role="alert">{problemText}</p>}
          {ready && !supported && !liveMode && !problemText && <p className="notice">{s.unsupported}</p>}

          <form className="typebar" onSubmit={submitText}>
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={s.inputPlaceholder}
              aria-label={s.inputPlaceholder}
              maxLength={300}
              autoComplete="off"
              enterKeyHint="send"
              disabled={thinking}
            />
            <button type="submit" className="send" aria-label={s.send} disabled={thinking || !draft.trim()}>
              <IconSend width={20} height={20} />
            </button>
          </form>

          {ready && tasks.length === 0 && !insight && !loadError && (
            <div className="examples">
              <p>{s.tryTitle}</p>
              <ul>
                {s.examples.map((ex) => (
                  <li key={ex}>
                    <button type="button" onClick={() => runCommand(ex, 'text')} disabled={thinking}>{ex}</button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Insight insight={insight} today={clock.today} s={s} />
        </section>

        <section className="board-wrap" aria-label="Tasks">
          {ready && health?.db?.persistent === false && <p className="notice notice-board">{s.ephemeralDb}</p>}
          {ready && loadError && (
            <p className="notice notice-board" role="alert">
              {s.dbError}{' '}
              <button type="button" className="link-btn" onClick={loadTasks}>{s.retry}</button>
            </p>
          )}
          {ready && (
            <TaskBoard
              tasks={tasks}
              today={clock.today}
              tomorrow={clock.tomorrow}
              tab={tab}
              onTab={setTab}
              s={s}
              onToggle={toggleTask}
              onDelete={removeTask}
              onClearDone={clearDone}
            />
          )}
        </section>
      </main>

      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            className="toast"
            role="status"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ type: 'spring', stiffness: 500, damping: 38 }}
          >
            <span>{toast.text}</span>
            {toast.undo && (
              <button type="button" onClick={undo}>{s.undo}</button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
