import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient, type UserRole } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  // Verify the requesting user is admin or gm
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: 'Auth not configured' }, { status: 500 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
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

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'Admin client not configured' }, { status: 500 });

  // Send Supabase invitation email
  const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { role, full_name: full_name ?? '' },
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/auth/callback`,
  });

  if (inviteError) {
    return NextResponse.json({ error: inviteError.message }, { status: 400 });
  }

  // Pre-create the profile with correct role (trigger will also fire, but this ensures role)
  await admin.from('user_profiles').upsert({
    id: inviteData.user.id,
    email,
    full_name: full_name ?? null,
    role,
    invited_by: user.id,
  }, { onConflict: 'id' });

  return NextResponse.json({ success: true, email });
}
