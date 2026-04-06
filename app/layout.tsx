import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Header } from '@/components/header';
import { getIsDemoMode } from '@/lib/data';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: "Nature's Understory | Operations Dashboard",
  description: "Internal operations dashboard for Nature's Storehouse",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isDemoMode = getIsDemoMode();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-stone-50 dark:bg-stone-900">
        <Header isDemoMode={isDemoMode} />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-stone-200 bg-white py-4 dark:border-stone-800 dark:bg-stone-950">
          <div className="mx-auto max-w-7xl px-4 text-center text-sm text-stone-500 sm:px-6 lg:px-8">
            Nature&apos;s Storehouse - Canton, NY
          </div>
        </footer>
      </body>
    </html>
  );
}
