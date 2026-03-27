import { NextRequest, NextResponse } from 'next/server';
import { deleteBase } from '@/lib/iris-crawler/storage';

export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest) {
  const { catalogId } = await req.json() as { catalogId?: string };
  if (!catalogId) return NextResponse.json({ error: 'catalogId requis' }, { status: 400 });
  await deleteBase(catalogId);
  return NextResponse.json({ success: true });
}
