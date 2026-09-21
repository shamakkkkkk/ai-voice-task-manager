'use client';
import { useCallback } from 'react';

export function useSpeak() {
  const speak = useCallback((text, lang) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 1.03;
    window.speechSynthesis.speak(u);
  }, []);
  const cancel = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);
  return { speak, cancel };
}
