import { NextRequest, NextResponse } from 'next/server';
import { runSpatialAgent, SpatialMessage } from '@/lib/spatial/engine';
import { createAdminClient } from '@/lib/auth';

// Délai étendu : appels ORS + Mistral peuvent prendre jusqu'à 60s
export const maxDuration = 120;

// =============================================================================
// POST /api/spatial — Moteur d'analyse spatiale piloté par Mistral
// Body: { message: string, history?: SpatialMessage[] }
// =============================================================================

export async function POST(request: NextRequest) {
  let body: { message?: string; history?: SpatialMessage[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 });
  }

  const { message, history = [] } = body;
  if (!message?.trim()) {
    return NextResponse.json({ error: 'message requis' }, { status: 400 });
  }

  try {
    const result = await runSpatialAgent(message.trim(), history);
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[spatial] Erreur agent:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// =============================================================================
// GET /api/spatial — Liste les analyses sauvegardées
// =============================================================================

export async function GET() {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('saved_analysis')
    .select('id, name, category_target, analysis_type, poi_count, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('[spatial] GET error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ analyses: data ?? [] });
}

// =============================================================================
// DELETE /api/spatial?id=xxx — Supprime une analyse sauvegardée
// =============================================================================

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'id requis' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('saved_analysis')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('[spatial] DELETE error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
