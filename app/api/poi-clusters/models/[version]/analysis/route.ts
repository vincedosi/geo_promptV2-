/**
 * GET  /api/poi-clusters/models/[version]/analysis  — retourne l'analyse Gemini
 * DELETE /api/poi-clusters/models/[version]/analysis — supprime l'analyse (re-génération)
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
// Clustering réservé au super_admin (2026-10-08) : les modèles sont calculés
// sur TOUS les POI, toutes organisations confondues — voir lib/auth/perimetre-donnees.ts.
import { reserverAuSuperAdmin } from '@/lib/auth/perimetre-donnees';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ version: string }> },
) {
  const refus = await reserverAuSuperAdmin(req);
  if (refus) return refus;
  const { version: versionParam } = await params;
  const version = parseInt(versionParam, 10);
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
  req: NextRequest,
  { params }: { params: Promise<{ version: string }> },
) {
  const refus = await reserverAuSuperAdmin(req);
  if (refus) return refus;
  const { version: versionParam } = await params;
  const version = parseInt(versionParam, 10);
  if (isNaN(version)) return NextResponse.json({ error: 'Version invalide' }, { status: 400 });

  const sb = createAdminClient();
  const { error } = await sb
    .from('clustering_models')
    .update({ analysis: null })
    .eq('version', version);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ cleared: version });
}
