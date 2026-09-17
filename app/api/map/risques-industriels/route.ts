/**
 * MAGELIAN — `GET /api/map/risques-industriels`
 *
 * Sert la couche dédiée « Zones à risque industriel » du panneau Calques :
 * les sites ICPE de la vue courante, leurs attributs complets pour la popup,
 * et la zone de danger autour de chaque site quand l'utilisateur la demande.
 *
 * ── Pourquoi une route à part, et pas `/api/map/pois` ──────────────────────
 *
 * Trois raisons mesurées, pas une préférence :
 *  1. `/api/map/pois` colore par CATÉGORIE (`poiStyles[categorie]`) : une
 *     seule couleur pour les 99 152 sites. Impossible d'y peindre un type de
 *     risque, et c'est pour ça que la légende ne se voyait pas sur la carte.
 *  2. Elle plafonne à 10 000 POI et bascule en nappe de densité au-delà de
 *     500 — donc jamais les points nets qu'on veut ici.
 *  3. Elle ne renvoie pas `metadata`, où vivent la nature du risque et tout ce
 *     que la popup doit afficher. L'y ajouter ferait payer le jsonb à TOUTES
 *     les catégories.
 *
 * Le chemin générique reste donc intact pour les lycées, les POI importés et
 * les panneaux : aucune régression, aucun refactor non demandé.
 *
 * ── Bornes ────────────────────────────────────────────────────────────────
 *
 * `bbox` = la vue visible, jamais la France entière par défaut (règle I/O du
 * projet). `limite` plafonne à 5 000 côté RPC, et la RPC coupe les sites les
 * MOINS graves en premier : une liste tronquée ne perd jamais un Seveso.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { rpcJson, nullableArg } from '@/lib/supabase/rpc-json';
import { typeRisqueDepuisLibelle } from '@/lib/carte/palette-risques';
import type { TypeRisque } from '@/lib/carte/palette-risques';
import { FAMILLES_ICPE_SEED } from '@/lib/import/georisques/familles';

export const dynamic = 'force-dynamic';

const GRAVITES = [
  'seveso_haut',
  'seveso_bas',
  'ied',
  'autorisation',
  'enregistrement',
  'autre',
] as const;

const ParamsSchema = z.object({
  /** [ouest, sud, est, nord]. Absente = France entière : réservé aux Seveso. */
  bbox: z.string().optional(),
  /** Niveaux réglementaires retenus. Défaut : les deux niveaux Seveso. */
  gravites: z.string().optional(),
  /** Libellés de nature retenus (le filtre par type de risque les résout). */
  natures: z.string().optional(),
  inclure_inactifs: z.enum(['0', '1']).optional(),
  /** Rayon de la zone de danger en mètres. 0 ou absent = pas de zone. */
  rayon_m: z.coerce.number().int().min(0).max(20000).optional(),
  limite: z.coerce.number().int().min(1).max(5000).optional(),
});

interface ProprietesSite {
  id: string;
  libelle_nature: string | null;
  [k: string]: unknown;
}

interface Collection {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: ProprietesSite;
  }>;
  n_total: number;
  n_rendus: number;
  rayon_m: number | null;
}

function bboxValide(brut: string | undefined): number[] | null {
  if (!brut) return null;
  const parts = brut.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [o, s, e, n] = parts;
  if (o >= e || s >= n) return null;
  return [o, s, e, n];
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

  const gravites = (p.gravites ?? 'seveso_haut,seveso_bas')
    .split(',')
    .map((g) => g.trim())
    .filter((g): g is (typeof GRAVITES)[number] => (GRAVITES as readonly string[]).includes(g));
  if (gravites.length === 0) {
    return NextResponse.json({ error: 'Aucun niveau de gravité valide demandé' }, { status: 400 });
  }

  const natures = (p.natures ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('risques_industriels_carte', {
    // `nullableArg` : le generateur declare ces arguments non-nullables, mais
    // le SQL accepte NULL (bbox absente = France entiere, natures absentes =
    // toutes). Helper documente du projet, plutot qu'un cast a l'aveugle.
    p_bbox: nullableArg(bboxValide(p.bbox)),
    p_gravites: gravites,
    p_natures: nullableArg(natures.length > 0 ? natures : null),
    p_inclure_inactifs: p.inclure_inactifs === '1',
    p_rayon_m: nullableArg(p.rayon_m && p.rayon_m > 0 ? p.rayon_m : null),
    p_limite: p.limite ?? 2000,
  });

  if (error) {
    console.error('[map/risques-industriels]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const collection = rpcJson<Collection>(data);
  if (!collection) {
    return NextResponse.json(
      { type: 'FeatureCollection', features: [], n_total: 0, n_rendus: 0, rayon_m: null },
    );
  }

  /**
   * Le type de risque est calculé ICI, pas en base.
   *
   * Il vient du libellé de nature par `typeRisqueDepuisLibelle`, la MÊME
   * fonction que la légende et le panneau utilisent — c'est ce qui garantit
   * qu'un point peint « toxique » est bien celui que le filtre « toxique »
   * retient. Le mettre en SQL créerait une seconde définition du
   * regroupement, qui divergerait au premier type ajouté.
   */
  const features = collection.features.map((f) => ({
    ...f,
    properties: {
      ...f.properties,
      type_risque: typeRisqueDepuisLibelle(
        f.properties.libelle_nature,
        FAMILLES_ICPE_SEED,
      ) satisfies TypeRisque,
    },
  }));

  return NextResponse.json(
    { ...collection, features },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
