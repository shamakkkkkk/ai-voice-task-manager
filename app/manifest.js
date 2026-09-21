export default function manifest() {
  return {
    name: 'AI Voice Task Manager',
    short_name: 'AI Task Manager',
    description: 'Voice-first task manager',
    start_url: '/',
    display: 'standalone',
    background_color: '#2333d8',
    theme_color: '#2333d8',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
