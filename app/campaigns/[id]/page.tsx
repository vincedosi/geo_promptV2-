'use client';

import { useParams } from 'next/navigation';
import { CampaignCockpit } from '@/components/campaign/CampaignCockpit';

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();

  if (!id) return null;

  return <CampaignCockpit campaignId={id} />;
}
