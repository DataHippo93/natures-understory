import { redirect } from 'next/navigation';
import { hasRole } from '@/lib/rbac';
import ReviewClient from './client';

export const dynamic = 'force-dynamic';

export default async function ProduceOrderReviewPage(props: { params: Promise<{ id: string }> }) {
  const session = await hasRole(['admin']);
  if (!session) redirect('/');
  const { id } = await props.params;
  return <ReviewClient orderId={id} />;
}
