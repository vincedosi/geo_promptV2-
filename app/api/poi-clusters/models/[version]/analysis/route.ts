/**
 * GET  /api/poi-clusters/models/[version]/analysis  — retourne l'analyse Gemini
 * DELETE /api/poi-clusters/models/[version]/analysis — supprime l'analyse (re-génération)
 */
import { NextResponse }    from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: { version: string } },
) {
  const version = parseInt(params.version, 10);
  if (isNaN(version)) return NextResponse.json({ error: 'Version invalide' }, { status: 400 });

  const sb = createAdminClient();
  const { data, error } = await sb
    .from('clustering_models')
    .select('analysis')
    .eq('version', version)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.analysis) return NextResponse.json({ error: 'no_analysis' }, { status: 404 });

  return NextResponse.json(data.analysis);
}

export async function DELETE(
  _req: Request,
  { params }: { params: { version: string } },
) {
  const version = parseInt(params.version, 10);
  if (isNaN(version)) return NextResponse.json({ error: 'Version invalide' }, { status: 400 });

  const sb = createAdminClient();
  const { error } = await sb
    .from('clustering_models')
    .update({ analysis: null })
    .eq('version', version);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ cleared: version });
}
