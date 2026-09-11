/**
 * POST   /api/admin/organizations/[id]/sources/assign — Partager une source avec l'org
 * DELETE /api/admin/organizations/[id]/sources/assign — Révoquer le partage
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { z } from 'zod';
import { lireCorps } from '@/lib/api/valider-corps';

/** Partage et revocation ne portent qu'une chose : quelle source. */
const SourceCibleSchema = z.object({ sourceId: z.string().uuid() });

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const sb = createAdminClient();
  const { id: orgId } = await params;
  const corps = await lireCorps(request, SourceCibleSchema);
  if (!corps.ok) return NextResponse.json({ success: false, error: corps.message }, { status: 400 });
  const { sourceId } = corps.valeur;

  const { data: source, error: fetchError } = await sb
    .from('data_sources')
    .select('shared_with')
    .eq('id', sourceId)
    .single();

  if (fetchError || !source) return NextResponse.json({ success: false, error: 'Source introuvable' }, { status: 404 });

  const current: string[] = Array.isArray(source.shared_with) ? source.shared_with : [];
  if (!current.includes(orgId)) current.push(orgId);

  const { error } = await sb.from('data_sources').update({ shared_with: current }).eq('id', sourceId);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const sb = createAdminClient();
  const { id: orgId } = await params;
  const corps = await lireCorps(request, SourceCibleSchema);
  if (!corps.ok) return NextResponse.json({ success: false, error: corps.message }, { status: 400 });
  const { sourceId } = corps.valeur;

  const { data: source, error: fetchError } = await sb
    .from('data_sources')
    .select('shared_with')
    .eq('id', sourceId)
    .single();

  if (fetchError || !source) return NextResponse.json({ success: false, error: 'Source introuvable' }, { status: 404 });

  const updated = Array.isArray(source.shared_with)
    ? source.shared_with.filter((id: string) => id !== orgId)
    : [];

  const { error } = await sb.from('data_sources').update({ shared_with: updated }).eq('id', sourceId);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
