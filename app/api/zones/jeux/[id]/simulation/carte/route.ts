/**
 * La géométrie de la carte de l'étape ⑤ : les bassins d'un jeu et leurs sites,
 * bornés au cadre visible (`?bbox=ouest,sud,est,nord`).
 *
 * ⚠ AUCUNE donnée de diffusion ici. L'écran fusionne les indices de pression
 * côté client, ce qui permet de changer de période (v1, v2, 28 jours) sans
 * redemander une seule géométrie. La route est relue à chaque panoramique, et
 * rien de ce qu'elle rend ne dépend de la période.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { rpcJson } from '@/lib/supabase/rpc-json';

export const dynamic = 'force-dynamic';

const limiteur = createRateLimiter({
  max: 60, window: '60 s', prefix: 'geo:rl:zone-set-simulation-carte',
});

/** Bornes de la bbox : la France outre-mer comprise, jamais au-delà. */
function lireBbox(brut: string | null): [number, number, number, number] | null {
  if (!brut) return null;
  const v = brut.split(',').map(Number);
  if (v.length !== 4 || v.some((x) => !Number.isFinite(x))) return null;
  const [o, s, e, n] = v;
  if (o >= e || s >= n || o < -180 || e > 180 || s < -90 || n > 90) return null;
  return [o, s, e, n];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  if (!profile.organization_id) {
    return NextResponse.json({ error: 'Aucune organisation active.' }, { status: 403 });
  }
  const quota = await limiteur(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  const bbox = lireBbox(request.nextUrl.searchParams.get('bbox'));
  if (!bbox) {
    // Jamais la France entière par défaut : la bbox est le cadre visible, et
    // son absence est une erreur d'appel, pas une demande nationale.
    return NextResponse.json({ error: 'Paramètre bbox manquant ou invalide (ouest,sud,est,nord).' }, { status: 400 });
  }

  const { id } = await params;
  const supabase = createAdminClient();
  const { data: jeu, error: erreurJeu } = await supabase
    .from('zone_sets').select('id')
    .eq('id', id).eq('org_id', profile.organization_id).maybeSingle();
  if (erreurJeu) return NextResponse.json({ error: 'Jeu de zones illisible.' }, { status: 500 });
  if (!jeu) return NextResponse.json({ error: 'Ce jeu de zones est introuvable.' }, { status: 404 });

  const { data, error } = await supabase.rpc('simulation_carte', {
    p_zone_set: id, p_xmin: bbox[0], p_ymin: bbox[1], p_xmax: bbox[2], p_ymax: bbox[3],
  });
  if (error) {
    console.error('[zones/simulation/carte] :', error.message);
    return NextResponse.json({ error: 'Géométrie des bassins illisible.' }, { status: 500 });
  }
  return NextResponse.json(rpcJson(data), { headers: { 'Cache-Control': 'private, max-age=300' } });
}
