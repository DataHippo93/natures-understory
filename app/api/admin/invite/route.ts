import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient, type UserRole } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: 'Auth not configured' }, { status: 500 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'Admin client not configured' }, { status: 500 });

  // Authorize via the service-role client. Reading the requester's role
  // through the anon client inside a route handler is unreliable (the user
  // JWT doesn't always propagate to the PostgREST request, so RLS returns no
  // row and every admin looked "insufficient"). The admin client is
  // authoritative — we've already verified the caller's identity via getUser.
  const { data: profile } = await admin
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (!profile || !['admin', 'gm'].includes(profile.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const { email, role, full_name } = await req.json() as {
    email: string;
    role: UserRole;
    full_name?: string;
  };

  if (!email || !role) {
    return NextResponse.json({ error: 'Email and role are required' }, { status: 400 });
  }

  const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { role, full_name: full_name ?? '' },
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/auth/callback`,
  });

  if (inviteError) {
    // Surface the real cause rather than a generic message — the common one
    // is "email not configured" (no SMTP set on the Supabase project).
    const msg = inviteError.message || 'Invite failed';
    const friendly = /smtp|email|not enabled|sending/i.test(msg)
      ? `${msg} — set up email (Supabase → Auth → SMTP) or use "Add user manually".`
      : msg;
    return NextResponse.json({ error: friendly }, { status: 400 });
  }

  await admin.from('user_profiles').upsert({
    id: inviteData.user.id,
    email,
    full_name: full_name ?? null,
    role,
    invited_by: user.id,
  }, { onConflict: 'id' });

  return NextResponse.json({ success: true, email });
}
