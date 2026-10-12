/**
 * GET /api/voronoi?categorie=lycee[&metropolitaine=false][&ville=…|&departement=…|&region=…]
 *
 * Cellules de Voronoï d'une catégorie de POI — la zone d'influence de chaque
 * point. Route directe créée le 2026-10-12 (chantier « suppression de toute
 * l'IA », lot 4) : jusque-là, ce calcul n'était accessible QUE par l'outil
 * `voronoi_analysis` du copilote, que le bouton « Lancer le calcul » du
 * panneau Analyse déclenchait en écrivant une phrase au chat. Le chat est
 * retiré (lot 5) ; cette route est désormais la SEULE copie du calcul.
 *
 * La réponse garde la forme du résultat que l'outil rendait à l'écran
 * (`voronoiGeoJSON`, `poisForMap`, `nb_polygones`, `tronque`, `category`,
 * `metropolitaine`), et `lib/carte/voronoi-direct.ts` l'affiche :
 * `applyVoronoi` puis `setZoneData`.
 *
 * ── Garde ───────────────────────────────────────────────────────────────────
 *
 * Hors du matcher de `middleware.ts` (fichier protégé) : la session est donc
 * exigée ICI, par `requireAuth` (en-tête `Authorization`, que pose
 * `adminFetch` côté client — le patron de `/api/custom-geo/source/voronoi`) —
 * 401 sans elle. Un calcul de 14 s (les 4 653 cellules des lycées, mesuré le
 * 2026-10-10) ne s'offre pas à un appelant anonyme.
 *
 * La RPC calcule sur TOUTE la catégorie, sans notion de source : on ne la lance
 * que si l'appelant voit chacun de ses POI (`categorieEntierementVisible`,
 * avec les sources de la carte — le socle, l'espace actif et ses partages,
 * super_admin compris). 403 sinon.
 *
 * Quota partagé en base (`lib/api/rate-limit.ts`) : 6 calculs par minute et
 * par compte, la même famille d'I/O que les trois pannes.
 *
 * ── Troncature ──────────────────────────────────────────────────────────────
 *
 * `get_voronoi_by_category_jsonb` (sql/246) et non `get_voronoi_by_category`
 * (RETURNS SETOF json) : PostgREST coupe à `db-max-rows` = 1 000 lignes toute
 * RPC tabulaire, sans erreur — 1 000 cellules rendues sur 4 653 pour les
 * lycées. La jumelle rend tout jusqu'à `p_limite` et dit `tronque`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { sourcesVisiblesDeLaRequete, categorieEntierementVisible } from '@/lib/auth/perimetre-donnees';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { messageAnomalies } from '@/lib/api/valider-corps';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { rpcJson } from '@/lib/supabase/rpc-json';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Borne du nombre de cellules, passée à `get_voronoi_by_category_jsonb`
 * (sql/246) : le `LIMIT 5000` historique de sql/164. La jumelle rend du jsonb,
 * relever cette borne ne ramène aucune troncature PostgREST, mais chaque
 * cellule coûte une intersection contre la frontière (14 s pour les 4 653
 * cellules des lycées, mesuré le 2026-10-10).
 */
const BORNE_CELLULES = 5000;

const limiteur = createRateLimiter({ max: 6, window: '60 s', prefix: 'geo:rl:voronoi' });

const texteOptionnel = z.string().trim().max(200).optional()
  .transform((v) => (v ? v : undefined));

const QuerySchema = z.object({
  categorie: z.string().trim().min(1, 'categorie requise').max(200),
  metropolitaine: z.enum(['true', 'false']).default('true'),
  ville: texteOptionnel,
  region: texteOptionnel,
  departement: texteOptionnel,
});

interface CelluleVoronoi {
  type?: string;
  geometry?: unknown;
  properties?: {
    id?: string;
    nom?: string;
    lat?: number;
    lng?: number;
    categorie?: string;
    adresse?: string;
    ville?: string;
  };
}

export async function GET(request: NextRequest) {
  // L'authentification AVANT la validation : un appelant anonyme reçoit 401,
  // jamais un 400 qui lui décrirait les paramètres attendus.
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const parsed = QuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: messageAnomalies(parsed.error) }, { status: 400 });
  }
  const { categorie: category, ville, region, departement } = parsed.data;
  const metropolitaine = parsed.data.metropolitaine === 'true';

  const quota = await limiteur(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  // Les sources de la CARTE : le socle, l'espace actif et ses partages —
  // super_admin compris, jamais `null` (vue espace, 2026-10-12).
  const sources = await sourcesVisiblesDeLaRequete(request);
  const supabase = createAdminClient();
  if (!(await categorieEntierementVisible(supabase, category, sources))) {
    return NextResponse.json(
      { error: `Catégorie « ${category} » hors de votre périmètre de données.`, nb_polygones: 0, category },
      { status: 403 },
    );
  }

  const { data, error } = await supabase.rpc('get_voronoi_by_category_jsonb', {
    cat_name: category,
    metropolitaine,
    p_limite: BORNE_CELLULES,
    ...(ville       ? { filtre_ville: ville }              : {}),
    ...(region      ? { filtre_region: region }            : {}),
    ...(departement ? { filtre_departement: departement }  : {}),
  });
  if (error) {
    console.error('[api/voronoi] RPC error:', error.message);
    return NextResponse.json({ error: error.message, nb_polygones: 0, category }, { status: 500 });
  }

  const reponse = rpcJson<{ features?: CelluleVoronoi[]; tronque?: boolean }>(data);
  const features = Array.isArray(reponse?.features) ? reponse.features : [];
  const tronque = reponse?.tronque === true;
  logger.debug('api/voronoi', `"${category}" metro=${metropolitaine} ville=${ville} region=${region} dept=${departement} → ${features.length} polygones${tronque ? ' (borne atteinte)' : ''}`);

  const pois = features
    // Id de repli DÉTERMINISTE (catégorie + rang) : la RPC rend toujours
    // `id`, mais un repli aléatoire changerait la clé à chaque appel.
    .map((f, rang) => ({
      id:        f.properties?.id        ?? `${category}-${rang}`,
      nom:       f.properties?.nom       ?? 'Inconnu',
      lat:       Number(f.properties?.lat ?? 0),
      lng:       Number(f.properties?.lng ?? 0),
      categorie: f.properties?.categorie ?? category,
      adresse:   f.properties?.adresse   ?? undefined,
      ville:     f.properties?.ville     ?? undefined,
    }))
    .filter((p) => p.lat !== 0 && p.lng !== 0);

  const filtre_ville  = ville ?? null;
  const filtre_region = region ?? null;
  const filtre_dept   = departement ?? null;
  const locationLabel = filtre_ville ?? filtre_region ?? filtre_dept
    ?? (metropolitaine ? 'France métropolitaine' : 'France');

  const coordonnees = pois.length > 0
    ? {
        lat: pois.reduce((s, p) => s + p.lat, 0) / pois.length,
        lng: pois.reduce((s, p) => s + p.lng, 0) / pois.length,
      }
    : { lat: 46.8, lng: 2.3 };

  return NextResponse.json({
    voronoiGeoJSON: {
      type: 'FeatureCollection' as const,
      features,
      _meta: { category, metropolitaine, filtre_ville, filtre_region, filtre_dept },
    },
    poisForMap: {
      ville:            locationLabel,
      region:           filtre_region,
      departement:      filtre_dept,
      categorie_poi:    category,
      rayon_metres:     null,
      rayon_poi_metres: null,
      coordonnees,
      pois,
      nb_pois:          pois.length,
      categories:       { [category]: pois.length },
    },
    nb_polygones: features.length,
    /** Vrai si la catégorie a plus de cellules que `BORNE_CELLULES` : le compte n'est pas le total. */
    tronque,
    category,
    metropolitaine,
  });
}
