/**
 * Périmètres PPRT d'une bbox, pour la couche carte.
 *
 * `GET /api/map/pprt?bbox=o,s,e,n&types=&limite=`
 *
 * ── ROUTE DISTINCTE DE `/api/map/risques-industriels`, À DESSEIN ──────────
 *
 * Celle-là sert des POINTS (les 99 152 installations classées) et, en option,
 * le **cercle de danger calculé** autour de chacun — un rayon que
 * l'utilisateur règle, de notre invention. Celle-ci sert les **périmètres
 * réglementaires opposables**, 664 polygones importés de la Géoplateforme.
 *
 * Deux natures, deux routes, deux façons de les dessiner (aplat plein contre
 * trait tireté) : confondre les deux ferait passer un cercle que nous avons
 * choisi pour une servitude d'urbanisme.
 *
 * ── LA BBOX EST OBLIGATOIRE ───────────────────────────────────────────────
 *
 * Pas seulement pour l'I/O : France entière, c'est 4 948 ko de GeoJSON brut et
 * une zone de 2 km y mesure **moins d'un pixel**. La couche a donc un plancher
 * de zoom côté client (`PPRT_ZOOM_PLANCHER`), et cette route refuse en 400 une
 * requête sans bbox plutôt que de servir une carte illisible et coûteuse.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { rpcJson, nullableArg } from '@/lib/supabase/rpc-json';
import { bboxValide } from '@/lib/api/parametres-requete';

export const dynamic = 'force-dynamic';

/** Les trois valeurs de `pprt_perimetres.type_zone` (contrainte CHECK, sql/177). */
const TYPES_ZONE = ['enveloppe', 'perimetre_reglemente', 'indetermine'] as const;

const ParamsSchema = z.object({
  /** `[ouest, sud, est, nord]`. OBLIGATOIRE — voir l'en-tête. */
  bbox: z.string(),
  /** Familles de `type_zone` retenues. Absent = toutes. */
  types: z.string().optional(),
  limite: z.coerce.number().int().min(1).max(1000).optional(),
});

interface Collection {
  type: 'FeatureCollection';
  features: unknown[];
  n_total: number;
  n_rendus: number;
  tolerance_deg: number;
  error?: string;
}

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const parsed = ParamsSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 400 },
    );
  }
  const p = parsed.data;

  const bbox = bboxValide(p.bbox);
  if (!bbox) {
    return NextResponse.json(
      { error: 'bbox invalide — attendu « ouest,sud,est,nord » avec ouest<est et sud<nord' },
      { status: 400 },
    );
  }

  // Un type inconnu est ÉCARTÉ, pas refusé : le client peut envoyer une valeur
  // héritée d'un lien ou d'un localStorage. Mais si le filtre ne retient plus
  // rien du tout, on le dit — servir « toutes les zones » à la place ferait
  // afficher l'inverse de ce qui a été demandé.
  const types = (p.types ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t): t is (typeof TYPES_ZONE)[number] =>
      (TYPES_ZONE as readonly string[]).includes(t),
    );
  if (p.types && p.types.trim() !== '' && types.length === 0) {
    return NextResponse.json({ error: 'Aucun type de zone valide demandé' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('pprt_perimetres_carte', {
    p_bbox: bbox,
    // `nullableArg` : le générateur déclare l'argument non-nullable alors que
    // le SQL accepte NULL (= tous les types). Helper documenté du projet.
    p_types: nullableArg(types.length > 0 ? types : null),
    p_limite: p.limite ?? 700,
  });

  if (error) {
    console.error('[map/pprt]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const collection = rpcJson<Collection>(data);
  if (!collection || collection.error) {
    return NextResponse.json(
      { error: collection?.error ?? 'Réponse inattendue de la base' },
      { status: 500 },
    );
  }

  return NextResponse.json(collection, {
    headers: {
      // Un référentiel de servitudes ne bouge qu'au dépôt d'une DDT : 1 h de
      // cache CDN est sans risque et évite de repayer la simplification à
      // chaque panoramique. `stale-while-revalidate` sert l'ancienne pendant
      // le recalcul plutôt que de faire attendre.
      'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
