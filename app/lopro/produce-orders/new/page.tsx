import { redirect } from 'next/navigation';
import { hasRole } from '@/lib/rbac';
import NewOrderClient from './client';

export const dynamic = 'force-dynamic';

export default async function NewProduceOrderPage() {
  const session = await hasRole(['buying_manager', 'wholesale_manager', 'admin']);
  if (!session) redirect('/');
  return <NewOrderClient />;
}
