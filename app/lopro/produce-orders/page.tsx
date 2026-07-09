// v7.7.8 (2026-07-09): produce ordering surface locked to `admin` role.
// Daniel (wholesale_manager) is scoped to /lopro/wholesale-pricing only.

import { redirect } from 'next/navigation';
import { hasRole } from '@/lib/rbac';
import ProduceOrdersClient from './client';

export const dynamic = 'force-dynamic';

export default async function ProduceOrdersPage() {
  const session = await hasRole(['admin']);
  if (!session) redirect('/lopro/wholesale-pricing');
  return <ProduceOrdersClient />;
}
