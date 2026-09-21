import { Onest, Unbounded } from 'next/font/google';
import './globals.css';

const display = Unbounded({ subsets: ['latin', 'cyrillic'], variable: '--font-display', display: 'swap' });
const body = Onest({ subsets: ['latin', 'cyrillic'], variable: '--font-body', display: 'swap' });

export const metadata = {
  title: 'AI Voice Task Manager',
  description: 'Say it once and your voice becomes tasks with dates, times and priorities.',
  applicationName: 'AI Voice Task Manager',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#2333d8',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
