import { redirect } from 'next/navigation';
import { hasRole } from '@/lib/rbac';
import WholesaleClient from './client';

export const dynamic = 'force-dynamic';

// v7.7.5: moved from app/wholesale to app/lopro/wholesale-pricing.
// Old path is redirected via next.config.ts.
export default async function WholesalePricingPage() {
  const session = await hasRole(['wholesale_manager', 'admin']);
  if (!session) redirect('/');

  return <WholesaleClient />;
}
