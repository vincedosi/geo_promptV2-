/**
 * POST /api/custom-geo/source/score — géométrie des codes postaux dont le score
 * composite dépasse un seuil (Tâche 12, 2026-09-13).
 *
 * Route sœur de `source/indicator-threshold`, `source/composite`,
 * `source/meteo`… : une source de zone = une route de cette famille. Le client
 * sauvegarde ensuite via `/api/custom-geo/save` (`source_type: 'score_composite'`).
 *
 * **Pourquoi ne PAS réutiliser `source/indicator-threshold`**, comme le plan le
 * prévoyait : cette route-là refait en SQL une sélection sur **un seul**
 * indicateur du registre (`get_indicator_threshold_selection`). Elle n'a aucun
 * moyen d'exprimer « score composite ≥ 60 » — l'appeler aurait construit une
 * zone sur un critère DIFFÉRENT de celui affiché à l'écran, sans rien signaler.
 *
 * Le score est ici RECALCULÉ côté serveur à partir des mêmes paramètres, plutôt
 * que de faire remonter une liste de CP choisie par le client : le seuil doit
 * porter sur le score que la base calcule, pas sur ce qu'un client aurait pu
 * altérer en chemin. Le recalcul est bon marché — 23,5 ms pour 500 CP.
 *
 * Les indicateurs sont supposés DÉJÀ matérialisés : cette route suit toujours un
 * `POST /api/analyses/score` qui s'en est chargé. Un indicateur absent donne
 * donc simplement zéro ligne, jamais une agrégation surprise sur `iris`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { lireCorps } from '@/lib/api/valider-corps';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Mêmes plafonds que `/api/analyses/score` — même périmètre, même calcul. */
const MAX_CP = 3000;
const MAX_INDICATEURS = 6;

/**
 * Au-delà, la géométrie unie devient trop lourde à rendre et à pousser vers un
 * DSP. `get_admin_filter_geometry` unit les polygones de chaque CP.
 */
const MAX_CP_ZONE = 1500;

/**
 * Quota — la SIXIÈME route de fabrication de zone, et la seule qui n'en avait
 * aucun. Les cinq autres (codes-postaux, rayon, dessin, intersection,
 * différence) portent toutes `max: 20 / 60 s`, et `ARCHITECTURE.md` rangeait
 * celle-ci dans le même bloc — la documentation garantissait une protection
 * qui n'existait pas.
 *
 * Elle enchaîne pourtant `calculer_score_composite` (jusqu'à 3 000 CP) PUIS
 * `get_admin_filter_geometry` sur jusqu'à 1 500 CP — l'appel qu'ARCHITECTURE.md
 * chiffre à 540 blocs disque pour 2 000 CP. Un curseur de seuil relié à cette
 * route sans anti-rebond, ou un onglet laissé sur un `setInterval`, et c'est
 * la famille exacte de l'incident du 28/03, sans plafond en base pour
 * l'arrêter.
 *
 * Compteur PARTAGÉ en base (`consommer_quota`, sql/135) — jamais une `Map`
 * locale, qui ne limiterait rien sur Vercel (CLAUDE.md).
 */
const limiteur = createRateLimiter({ max: 20, window: '60 s', prefix: 'geo:rl:zone-score' });

const CorpsSchema = z.object({
  indicateurs: z.array(z.object({
    code: z.string().min(1).max(100),
    poids: z.number().positive().finite(),
    sens: z.enum(['croissant', 'decroissant']),
  })).min(1).max(MAX_INDICATEURS),
  codes_postaux: z.array(z.string().min(2).max(10)).min(1).max(MAX_CP),
  seuil: z.number().min(0).max(100),
  /** `true` (défaut) : au-dessus du seuil. `false` : en dessous. */
  au_dessus: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const quota = await limiteur(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  const corps = await lireCorps(request, CorpsSchema);
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });
  const { indicateurs, codes_postaux, seuil } = corps.valeur;
  const auDessus = corps.valeur.au_dessus !== false;

  // Même garde que `/api/analyses/score` : deux fois le même code passe deux
  // fois dans le LATERAL de `calculer_score_composite`, ce qui le compte
  // double dans la pondération ET gonfle `n_indicateurs`. L'asymétrie entre
  // deux routes qui appellent la MÊME RPC est un piège en soi.
  const codes = indicateurs.map((i) => i.code);
  if (new Set(codes).size !== codes.length) {
    return NextResponse.json({ error: 'indicateur_duplique' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: lignes, error } = await supabase.rpc('calculer_score_composite', {
    p_indicateurs: codes,
    p_poids: indicateurs.map((i) => i.poids),
    p_sens: indicateurs.map((i) => i.sens),
    p_codes_postaux: codes_postaux,
  });
  if (error) {
    console.error('[source/score] calcul:', error.message);
    return NextResponse.json({ error: 'score_failed' }, { status: 500 });
  }

  const retenus = (lignes ?? [])
    .filter((l) => (auDessus ? Number(l.score) >= seuil : Number(l.score) <= seuil))
    .map((l) => l.postal_code);

  if (!retenus.length) {
    return NextResponse.json({ error: 'empty_selection', count: 0 }, { status: 400 });
  }
  if (retenus.length > MAX_CP_ZONE) {
    return NextResponse.json(
      { error: 'selection_too_large', count: retenus.length, max: MAX_CP_ZONE },
      { status: 400 },
    );
  }

  // Même RPC que `source/indicator-threshold` et la source météo pour le
  // palier CP (signature : p_scale, p_codes).
  const { data: geoRaw, error: erreurGeo } = await supabase.rpc('get_admin_filter_geometry', {
    p_scale: 'cp', p_codes: retenus,
  });
  if (erreurGeo) {
    console.error('[source/score] geometrie:', erreurGeo.message);
    return NextResponse.json({ error: 'geometry_failed' }, { status: 400 });
  }
  const parsedGeo = (typeof geoRaw === 'string' ? JSON.parse(geoRaw) : geoRaw) as { geometry?: unknown };
  const geometry = parsedGeo?.geometry ?? null;
  if (!geometry) {
    console.error('[source/score] geometrie vide dans la reponse RPC');
    return NextResponse.json({ error: 'geometry_failed' }, { status: 400 });
  }

  return NextResponse.json({ geometry, count: retenus.length, codes: retenus, scale: 'cp' });
}
