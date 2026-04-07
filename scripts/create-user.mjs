// Run once: node scripts/create-user.mjs
// Creates the admin user in Supabase

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env manually
const envPath = resolve(process.cwd(), '.env');
const envContent = readFileSync(envPath, 'utf-8');
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const [key, ...rest] = trimmed.split('=');
  if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const email = 'cmaine@ycconsulting.biz';
const password = 'Cerises!1';

console.log(`Creating user: ${email}`);

const { data, error } = await supabase.auth.signUp({ email, password });

if (error) {
  if (error.message.includes('already registered') || error.message.includes('already been registered')) {
    console.log('User already exists — trying sign in to confirm...');
    const { error: signinErr } = await supabase.auth.signInWithPassword({ email, password });
    if (signinErr) {
      console.error('Sign in failed:', signinErr.message);
    } else {
      console.log('✓ User exists and credentials are valid');
    }
  } else {
    console.error('Sign up error:', error.message);
  }
} else {
  console.log('✓ User created:', data.user?.email);
  if (!data.user?.email_confirmed_at && data.user?.confirmation_sent_at) {
    console.log('⚠  Check your email for a confirmation link, or disable email confirmation in Supabase Auth settings.');
  }
}
