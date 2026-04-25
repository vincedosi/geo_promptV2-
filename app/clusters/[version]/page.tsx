'use client';

import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';

const ClusterDetails = dynamic(
  () => import('@/components/ClusterDetails').then((m) => ({ default: m.ClusterDetails })),
  { ssr: false, loading: () => null }
);

export default function ClusterVersionPage() {
  const { version } = useParams<{ version: string }>();
  return <ClusterDetails version={version ?? ''} />;
}
