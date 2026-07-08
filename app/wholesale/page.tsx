import { redirect } from 'next/navigation';
import { hasRole } from '@/lib/rbac';
import WholesaleClient from './client';

export const dynamic = 'force-dynamic';

export default async function WholesalePage() {
  const session = await hasRole(['wholesale_manager', 'admin']);
  if (!session) redirect('/');

  return <WholesaleClient />;
}
