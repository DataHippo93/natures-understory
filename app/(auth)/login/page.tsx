'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // In demo mode, accept any credentials
    // When Supabase is configured, this will use real auth
    const isDemoMode = !process.env.NEXT_PUBLIC_SUPABASE_URL;

    if (isDemoMode) {
      // Demo mode - accept any login
      if (email && password) {
        // Store demo session in localStorage
        localStorage.setItem('demo_session', JSON.stringify({ email, loggedIn: true }));
        router.push('/');
        return;
      } else {
        setError('Please enter email and password');
        setLoading(false);
        return;
      }
    }

    // Real Supabase auth would go here
    try {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();

      if (!supabase) {
        // Fallback to demo mode
        localStorage.setItem('demo_session', JSON.stringify({ email, loggedIn: true }));
        router.push('/');
        return;
      }

      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        setError(authError.message);
      } else {
        router.push('/');
      }
    } catch {
      setError('Authentication failed. Please try again.');
    }

    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4 dark:bg-stone-900">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-8 w-8 text-emerald-600"
            >
              <path d="M11 3.055A9.001 9.001 0 1 0 20.945 13H11V3.055Z" />
              <path d="M20.488 11H13V3.512A9.025 9.025 0 0 1 20.488 11Z" />
            </svg>
          </div>
          <CardTitle className="text-2xl">Nature&apos;s Understory</CardTitle>
          <CardDescription>Sign in to access the operations dashboard</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium text-stone-700 dark:text-stone-300">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-stone-300 bg-white px-4 py-2 text-stone-900 placeholder-stone-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-stone-700 dark:bg-stone-800 dark:text-white dark:placeholder-stone-500"
                placeholder="you@example.com"
                required
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium text-stone-700 dark:text-stone-300">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-stone-300 bg-white px-4 py-2 text-stone-900 placeholder-stone-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-stone-700 dark:bg-stone-800 dark:text-white dark:placeholder-stone-500"
                placeholder="Enter your password"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 rounded-lg bg-amber-50 p-3 text-center text-sm text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
            <strong>Demo Mode:</strong> Enter any email/password to explore the dashboard with
            synthetic data.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
