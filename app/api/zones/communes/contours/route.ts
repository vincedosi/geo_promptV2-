/**
 * POST /api/zones/communes/contours — les contours simplifiés d'une liste de communes, pour peindre la maille commune
 * de l'étape ⑤ (TikTok) sur la carte (lot 5, T8 ; plan A-14). Corps `{ codes }`, 1 à `MAX_CODES` codes INSEE.
 *
 * POST et non GET : 3 000 codes de 5 caractères ne tiennent pas dans une adresse.
 *
 * Ordre : session (`requireAuth`, 401 / 403) → corps (`lireCorps`, 400 : liste vide, trop longue, code mal formé),
 * rien en base → quota `geo:rl:couverture` (429 ; le limiteur de ④, une lecture de plus pour une carte) →
 * `contours_communes` (sql/279) : `[{code, nom, geometry}]`, simplifiés à 0,001°, GeoJSON à 5 décimales. Réponse
 * `{ communes, manquants }` : un code absent du référentiel (`ref_communes`) n'a pas de contour, et la réponse le dit
 * au lieu de le taire.
 *
 * Les communes ne sont d'aucun espace (référentiel public) : l'espace actif n'est exigé que par cohérence avec ⑤.
 * Coût mesuré (sql/279) : 400 communes en 14 ms / 820 accès (176 Ko) ; 3 000 en 114 ms (1,4 Mo).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { requireAuth } from '@/lib/api/middleware';
import { lireCorps } from '@/lib/api/valider-corps';
import { formaterNombre } from '@/lib/format/nombre';
import { espaceDeZone } from '@/lib/zones/session-zones';
import { quotaCouverture } from '@/lib/zones/couverture';

export const dynamic = 'force-dynamic';

/**
 * Borne de COÛT de la lecture (≈ 1,4 Mo de GeoJSON au plafond, mesure de sql/279), égale au défaut de la RPC — pas la
 * règle d'une plateforme, qui vit dans `plateformes_geo`. La RPC est `jsonb` et lit `p_max + 1` : au-delà, elle
 * refuse au lieu de tronquer (PostgREST coupe à 1 000 lignes une RPC tabulaire).
 */
const MAX_CODES = 3000;

const ECHEC = 'Lecture des contours des communes impossible.';

const CorpsSchema = z.object({
  codes: z.array(z.string().regex(/^(\d{5}|2[AB]\d{3})$/, 'Code commune INSEE invalide.'))
    .min(1, 'Au moins un code commune.')
    .max(MAX_CODES, `Au plus ${formaterNombre(MAX_CODES)} communes par lecture.`),
}).strict();

interface ContourCommune { code: string; nom: string | null; geometry: unknown }

export async function POST(req: NextRequest) {
  const s = espaceDeZone(await requireAuth(req));
  if (!s.ok) return s.reponse;

  const corps = await lireCorps(req, CorpsSchema);
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });

  const refusQuota = await quotaCouverture(s.espace.userId);
  if (refusQuota) return refusQuota;

  const codes = [...new Set(corps.valeur.codes)];
  const { data, error } = await createAdminClient().rpc('contours_communes', { p_codes: codes, p_max: MAX_CODES });
  if (error || !Array.isArray(data)) {
    // Un refus `trop_de_communes` est impossible ici (corps borné à `p_max`) : s'il arrive, c'est une anomalie.
    console.error('[zones/communes/contours]', error?.code, error?.message ?? data);
    return NextResponse.json({ error: ECHEC }, { status: 500 });
  }

  const communes = data as unknown as ContourCommune[];
  const rendus = new Set(communes.map((c) => c.code));
  return NextResponse.json({ communes, manquants: codes.filter((c) => !rendus.has(c)) });
}
