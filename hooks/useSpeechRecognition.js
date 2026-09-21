'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

const getCtor = () =>
  typeof window === 'undefined' ? null : window.SpeechRecognition || window.webkitSpeechRecognition || null;

/**
 * Thin wrapper over the Web Speech API.
 * - one utterance per tap (continuous = false), live interim text
 * - callbacks are kept in refs so the recognition instance never restarts on re-render
 */
export function useSpeechRecognition({ lang, onInterim, onFinal, onError, onAudioStart, onEnd }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);
  const textRef = useRef('');
  const errorRef = useRef(null);
  const cb = useRef({});
  cb.current = { onInterim, onFinal, onError, onAudioStart, onEnd };

  useEffect(() => {
    setSupported(!!getCtor());
    return () => recRef.current?.abort?.();
  }, []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor || recRef.current) return false;
    const rec = new Ctor();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    textRef.current = '';
    errorRef.current = null;

    rec.onstart = () => setListening(true);
    rec.onaudiostart = () => cb.current.onAudioStart?.();
    rec.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += `${e.results[i][0].transcript} `;
      textRef.current = text.trim();
      cb.current.onInterim?.(textRef.current);
    };
    rec.onerror = (e) => {
      if (e.error !== 'aborted') errorRef.current = e.error;
    };
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
      cb.current.onEnd?.();
      const text = textRef.current.trim();
      if (text) cb.current.onFinal?.(text);
      else cb.current.onError?.(errorRef.current || 'no-speech');
    };

    recRef.current = rec;
    try {
      rec.start();
      return true;
    } catch {
      recRef.current = null;
      cb.current.onError?.('default');
      return false;
    }
  }, [lang]);

  const stop = useCallback(() => recRef.current?.stop?.(), []);

  return { supported, listening, start, stop };
}
