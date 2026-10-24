/**
 * Les BASSINS d'un jeu de zones — les sites dont les zones se touchent.
 *
 * ── POURQUOI CETTE LECTURE EXISTE À PART ─────────────────────────────────
 *
 * Un jeu ne connaissait que des CLASSES : on lisait « 2,4 M d'habitants dans
 * la bande haut 2-5 km », jamais « la vallée de la chimie expose 340 000
 * personnes » — la seule phrase qu'un média planner prononce.
 *
 * ⚠ Séparée de `/cp-geo` À DESSEIN. Cette dernière est relue à CHAQUE
 * panoramique de la carte ; les bassins, eux, ne dépendent pas du cadre. Les
 * livrer ensemble ferait recalculer et retransmettre 580 lignes à chaque
 * déplacement de souris.
 *
 * ⚠ Les enveloppes, jamais les géométries : le tableau ne dessine rien, il a
 * besoin de savoir où recadrer les deux cartes au clic. Une enveloppe fait
 * cinq nombres, une grappe de Fos-sur-Mer en fait des milliers.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { chargerJeu } from '@/lib/zones/charger-jeu';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { rpcJson } from '@/lib/supabase/rpc-json';

export const dynamic = 'force-dynamic';

/** 30 par minute, comme `/cp-geo` : c'est le même écran, lu au même rythme. */
const limiteur = createRateLimiter({ max: 30, window: '60 s', prefix: 'geo:rl:zone-set-grappes' });

interface Grappe {
  id: string;
  rang: number;
  nom: string;
  nom_auto: boolean;
  niveau_dominant: string;
  n_sites: number;
  pop_exposee: number | null;
  n_cp: number;
  n_cp_retenus: number;
  bbox: [number, number, number, number] | null;
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

  const { id } = await params;
  const supabase = createAdminClient();

  // Un jeu de zone (étape ⑤) n'a pas de grappes : 409 du chargeur (lot 5, A-3). L'espace est
  // vérifié par lui, et non par RLS (`createAdminClient()` contourne toute policy).
  const charge = await chargerJeu(supabase, id, profile.organization_id, { type: 'risque' });
  if (!charge.ok) return charge.reponse;

  const quota = await limiteur(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  const { data, error } = await supabase.rpc('zone_set_grappes', {
    p_zone_set_id: id,
    p_limite: 600,
  });
  if (error) {
    console.error('[zones/grappes] zone_set_grappes :', error.message);
    return NextResponse.json({ error: 'Bassins illisibles.' }, { status: 500 });
  }

  const grappes = rpcJson<Grappe[]>(data) ?? [];
  return NextResponse.json({ grappes, n: grappes.length });
}
