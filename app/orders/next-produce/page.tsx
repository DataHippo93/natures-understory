// /orders/next-produce — Inventory-driven Albert's order with notes + email
//                       draft. Server component fetches initial evaluation,
//                       hands off to NextProduceClient for interactivity.

import { evaluateNextProduceOrder, type NextOrderEvaluation } from '@/lib/next-order';
import { createClient } from '@/lib/supabase/server';
import NextProduceClient from './client';

export const dynamic = 'force-dynamic';

export default async function NextProduceOrderPage() {
  const supabase = await createClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  if (!user) {
    return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Sign in to view.</p>;
  }
  const initial: NextOrderEvaluation = await evaluateNextProduceOrder();
  return <NextProduceClient initial={initial} />;
}
