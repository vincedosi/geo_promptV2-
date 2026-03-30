'use client';

import { useParams } from 'next/navigation';
import { ClusterDetails } from '@/components/ClusterDetails';

export default function ClusterVersionPage() {
  const { version } = useParams<{ version: string }>();
  return <ClusterDetails version={version ?? ''} />;
}
