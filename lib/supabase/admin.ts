// Server-side admin Supabase client (service role — never expose to browser)
import { createClient } from '@supabase/supabase-js';

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export type UserRole = 'admin' | 'gm' | 'agm' | 'store_associate' | 'kitchen';

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  gm: 'General Manager',
  agm: 'Asst. General Manager',
  store_associate: 'Store Associate',
  kitchen: 'Kitchen',
};

export const ROLE_ORDER: UserRole[] = ['admin', 'gm', 'agm', 'store_associate', 'kitchen'];

export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  created_at: string;
}
