import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // No Supabase config = demo mode, allow everything
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // Refresh session — IMPORTANT: do not write logic between createServerClient and getUser
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isLoginPage = pathname.startsWith('/login');

  if (!user && !isLoginPage) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    return NextResponse.redirect(loginUrl);
  }

  // Wholesale managers are scoped to /wholesale/* + /lopro/* (excluding
  // /lopro/produce-orders/*, which is admin-only). Cheap routing hint from
  // JWT metadata; authoritative checks live in lib/rbac.ts on every page/API.
  const metaRole = (user?.user_metadata as Record<string, unknown> | undefined)?.role;
  const isWholesaleManager = metaRole === 'wholesale_manager';

  if (user && isLoginPage) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = isWholesaleManager ? '/wholesale' : '/';
    return NextResponse.redirect(homeUrl);
  }

  // wholesale_manager scope:
  //   allowed:  /wholesale/*, /lopro/* (except /lopro/produce-orders/*), /api/*
  //   denied:   everything else — including /lopro/produce-orders/* which
  //             was tightened to admin-only in v7.7.8a.
  // API routes are always allowed at the proxy layer; page/API-level auth is
  // enforced by lib/rbac.ts.
  if (user && isWholesaleManager) {
    const isProduceOrdersSurface = pathname.startsWith('/lopro/produce-orders');
    const isAllowedSurface =
      pathname.startsWith('/wholesale') ||
      pathname.startsWith('/lopro') ||
      pathname.startsWith('/api');

    if (isProduceOrdersSurface || !isAllowedSurface) {
      const wholesaleUrl = request.nextUrl.clone();
      wholesaleUrl.pathname = '/wholesale';
      return NextResponse.redirect(wholesaleUrl);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Exclude static assets, auth API routes, cron routes (use CRON_SECRET), and admin API routes
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|api/auth|api/cron|api/admin|api/debug).*)',
  ],
};
