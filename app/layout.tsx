import type { Metadata } from 'next';
import { Josefin_Sans, Montserrat } from 'next/font/google';
import './globals.css';
import { Sidebar } from '@/components/sidebar';
import { createClient } from '@/lib/supabase/server';

const josefinSans = Josefin_Sans({
  variable: '--font-josefin',
  subsets: ['latin'],
  weight: ['400', '600', '700'],
});

const montserrat = Montserrat({
  variable: '--font-montserrat',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: "Nature's Understory | Operations",
  description: "Internal operations dashboard for Nature's Storehouse",
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/icon.svg',
  },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;

  return (
    <html lang="en" className={`${josefinSans.variable} ${montserrat.variable} h-full`}>
      <body className="h-full" style={{ background: 'var(--forest-dark)', color: 'var(--cream)' }}>
        <Sidebar userEmail={user?.email} />
        {/* Main content offset by sidebar width */}
        <div className="ml-56 min-h-screen flex flex-col">
          <main className="flex-1 p-6 lg:p-8">
            {children}
          </main>
          <footer className="px-6 py-3 text-xs lg:px-8" style={{ color: 'var(--text-muted)', borderTop: '1px solid var(--forest-mid)' }}>
            Nature&apos;s Storehouse · Canton, NY · Internal use only
          </footer>
        </div>
      </body>
    </html>
  );
}
