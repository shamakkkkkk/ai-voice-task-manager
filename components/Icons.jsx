const base = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };

export const IconMic = (p) => (
  <svg {...base} {...p}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /></svg>
);
export const IconStop = (p) => (
  <svg {...base} {...p}><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none" /></svg>
);
export const IconCheck = (p) => (
  <svg {...base} strokeWidth={3} {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
);
export const IconTrash = (p) => (
  <svg {...base} {...p}><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="m6 7 1 13h10l1-13" /></svg>
);
export const IconSend = (p) => (
  <svg {...base} {...p}><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>
);
export const IconVolume = (p) => (
  <svg {...base} {...p}><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" fill="currentColor" stroke="none" /><path d="M15.5 9a4 4 0 0 1 0 6" /><path d="M18 6.5a7.5 7.5 0 0 1 0 11" /></svg>
);
export const IconVolumeOff = (p) => (
  <svg {...base} {...p}><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" fill="currentColor" stroke="none" /><path d="m16 9.5 5 5" /><path d="m21 9.5-5 5" /></svg>
);
export const IconPlus = (p) => (
  <svg {...base} strokeWidth={2.5} {...p}><path d="M12 5v14" /><path d="M5 12h14" /></svg>
);
