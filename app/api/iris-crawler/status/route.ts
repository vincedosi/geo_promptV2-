import { NextResponse } from 'next/server';
import { IRIS_CATALOG } from '@/lib/iris-crawler/catalog';
import { getBaseStatus } from '@/lib/iris-crawler/storage';
import type { CatalogStatus } from '@/lib/iris-crawler/types';

export const dynamic = 'force-dynamic';

// GET /api/iris-crawler/status
export async function GET() {
  const statuses = await Promise.all(
    IRIS_CATALOG.map(entry => getBaseStatus(entry.id))
  );

  const result: Record<string, CatalogStatus> = {};
  for (const s of statuses) {
    result[s.catalogId] = s;
  }

  return NextResponse.json(result);
}
