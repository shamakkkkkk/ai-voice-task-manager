'use client';
import { useCallback, useEffect, useRef } from 'react';

/**
 * Opens the microphone through Web Audio only to *draw* the live spectrum.
 * Skipped on touch devices: Android Chrome can't share the mic between getUserMedia and SpeechRecognition,
 * so there the visualiser falls back to a synthetic animation and recognition keeps priority.
 */
export function useMicAnalyser() {
  const analyserRef = useRef(null);
  const cleanupRef = useRef(null);
  const generation = useRef(0);

  const close = useCallback(() => {
    generation.current += 1;
    cleanupRef.current?.();
    cleanupRef.current = null;
    analyserRef.current = null;
  }, []);

  const open = useCallback(async () => {
    if (analyserRef.current || typeof window === 'undefined') return;
    if (window.matchMedia?.('(pointer: coarse)').matches) return;
    if (!navigator.mediaDevices?.getUserMedia) return;
    const ticket = ++generation.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const AC = window.AudioContext || window.webkitAudioContext;
      if (ticket !== generation.current || !AC) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const ctx = new AC();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.78;
      ctx.createMediaStreamSource(stream).connect(analyser);
      analyserRef.current = analyser;
      cleanupRef.current = () => {
        stream.getTracks().forEach((t) => t.stop());
        ctx.close().catch(() => {});
      };
    } catch {
      /* permission or device problem: the synthetic animation takes over */
    }
  }, []);

  useEffect(() => close, [close]);
  return { analyserRef, open, close };
}
