/**
 * POST /api/custom-geo/source/battle
 * Retourne la geometry du battle isochrone (union des caches cibles).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { sourcesVisiblesDeLaRequete, cleDeCacheDuPerimetre } from '@/lib/auth/perimetre-donnees';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const BodySchema = z.object({
  cache_keys: z.array(z.string().min(1)).min(1).max(500),
});

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });

  // Les clés viennent du navigateur : chacune doit porter l'empreinte du
  // périmètre de l'appelant, sinon c'est le résultat de quelqu'un d'autre.
  // Une clé hors périmètre est ÉCARTÉE, pas refusée : elle reçoit la même
  // réponse qu'une clé absente du cache (géométrie nulle), qui est aussi ce
  // que rend une clé `cg__<zone>` envoyée par app/map/page.tsx — la refuser
  // aurait changé ce cas en erreur affichée.
  const sources = await sourcesVisiblesDeLaRequete(request);
  const cles = parsed.data.cache_keys.filter((cle) => cleDeCacheDuPerimetre(cle, sources));

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('get_battle_geometry', { p_cache_keys: cles });
  if (error) {
    console.error('[custom-geo/source/battle]', error.message);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data);
}
