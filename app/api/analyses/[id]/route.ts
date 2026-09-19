/**
 * GET    /api/analyses/[id] — détail complet d'une analyse enregistrée
 *   (paramètres, périmètre, résultat inclus), scopé à l'org courante.
 * DELETE /api/analyses/[id] — supprime l'enregistrement.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import type { AnalyseEnregistree } from '@/lib/analyses/types';

export const dynamic = 'force-dynamic';

const IdSchema = z.string().uuid();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const orgId = profile.organization_id;
  if (!orgId) return NextResponse.json({ error: 'Aucune organisation associée à ce compte.' }, { status: 400 });

  const { id } = await params;
  if (!IdSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('analyses')
    .select('*')
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) {
    console.error('[GET /api/analyses/[id]]', error.message);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Analyse introuvable.' }, { status: 404 });

  return NextResponse.json({ analyse: data as AnalyseEnregistree }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const orgId = profile.organization_id;
  if (!orgId) return NextResponse.json({ error: 'Aucune organisation associée à ce compte.' }, { status: 400 });

  const { id } = await params;
  if (!IdSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Scope org vérifié AVANT le DELETE : un id valide d'une autre org ne doit
  // ni supprimer, ni révéler par son message d'erreur qu'il existe ailleurs.
  // L'erreur de CETTE lecture se lit aussi, pas seulement celle du DELETE :
  // sans ça, un echec de lecture (budget I/O Nano epuise — le mode de panne
  // documente trois fois dans CLAUDE.md) rend `data` null et la route repond
  // « Analyse introuvable » a propos d'une analyse parfaitement intacte. Un
  // client qui purge sa liste sur 404 l'effacerait de l'affichage.
  const { data: existante, error: lectureErr } = await supabase
    .from('analyses')
    .select('id')
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle();
  if (lectureErr) {
    console.error('[DELETE /api/analyses/[id]] lecture:', lectureErr.message);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }
  if (!existante) return NextResponse.json({ error: 'Analyse introuvable.' }, { status: 404 });

  // supabase-js ne lève jamais : lire `error` est la seule façon de détecter
  // un DELETE en échec (CLAUDE.md — « Jamais de delete() sans lire son erreur »).
  const { error, count } = await supabase
    .from('analyses')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('org_id', orgId);

  if (error) {
    console.error('[DELETE /api/analyses/[id]]', error.message);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }

  return NextResponse.json({ supprime: count ?? 0 });
}
