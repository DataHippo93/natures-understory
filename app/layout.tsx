import type { Metadata, Viewport } from 'next';
import { Josefin_Sans, Montserrat } from 'next/font/google';
import './globals.css';
import { AppShell } from '@/components/ui/app-shell';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

// Authoritative role for nav visibility (user_profiles via service role —
// same source lib/rbac.ts uses for page/API enforcement).
async function getUserRole(userId: string | undefined): Promise<string | null> {
  if (!userId) return null;
  const admin = createAdminClient();
  if (!admin) return null;
  const { data } = await admin.from('user_profiles').select('role').eq('id', userId).single();
  return data?.role ?? null;
}

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

// Explicit viewport export — Next 15+ splits this out of the metadata
// object. Without it iOS renders the app at desktop scale on phones.
// viewport-fit=cover enables safe-area-inset-* (notch / home-indicator).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#161009',
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  const userRole = await getUserRole(user?.id);

  return (
    <html lang="en" className={`${josefinSans.variable} ${montserrat.variable} h-full`}>
      <body className="h-full" style={{ background: 'var(--forest-dark)', color: 'var(--cream)' }}>
        {user ? (
          <AppShell userEmail={user.email} userRole={userRole}>{children}</AppShell>
        ) : (
          // Signed-out (login page): no app chrome.
          <div className="min-h-screen flex flex-col">
            <main className="flex-1">{children}</main>
          </div>
        )}
      </body>
    </html>
  );
}
