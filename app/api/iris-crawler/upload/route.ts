import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// POST /api/iris-crawler/upload
// Body: { catalogId: string }
// STUB — schéma Supabase à définir
export async function POST(req: NextRequest) {
  const body = await req.json() as { catalogId?: string };
  const { catalogId } = body;

  if (!catalogId) {
    return NextResponse.json({ success: false, message: 'catalogId requis' }, { status: 400 });
  }

  return NextResponse.json({
    success: false,
    catalogId,
    message: 'Upload Supabase — à implémenter. Schéma de mapping colonnes INSEE → iris non défini.',
  });
}
