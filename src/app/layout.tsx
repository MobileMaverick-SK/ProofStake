import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'ProofStake', template: '%s | ProofStake' },
  description: 'Put money behind your own deadlines. Keep it by proving you did the work.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5fbf6' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1512' },
  ],
};

const FONTS =
  'https://fonts.googleapis.com/css2?family=Roboto+Flex:opsz,wdth,wght@8..144,100..115,400..700&family=Roboto+Mono:wght@500&display=swap';
const ICONS =
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={FONTS} />
        <link rel="stylesheet" href={ICONS} />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
