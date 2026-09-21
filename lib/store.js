import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const STORAGE_KEY = 'ai-voice-task-manager:v1';

/**
 * `tasks` is a cache of what the server (SQLite) holds — it is fetched on load and replaced after every API call.
 * Only small UI preferences are kept in localStorage. `skipHydration` avoids SSR/client markup mismatches:
 * <App/> rehydrates after mount.
 */
export const useStore = create(
  persist(
    (set) => ({
      tasks: [],
      locale: 'en',
      localeChosen: false,
      voiceReply: true,
      mode: 'classic', // 'classic' = browser speech recognition, 'live' = OpenAI Realtime
      openaiKey: '', // optional visitor-supplied key for Live mode; lives only in this browser
      setTasks: (tasks) => set({ tasks }),
      setLocale: (locale) => set({ locale, localeChosen: true }),
      detectLocale: (locale) => set({ locale }),
      setVoiceReply: (voiceReply) => set({ voiceReply }),
      setMode: (mode) => set({ mode }),
      setOpenaiKey: (openaiKey) => set({ openaiKey }),
    }),
    {
      name: STORAGE_KEY,
      version: 2,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (s) => ({ locale: s.locale, localeChosen: s.localeChosen, voiceReply: s.voiceReply, mode: s.mode, openaiKey: s.openaiKey }),
    },
  ),
);
