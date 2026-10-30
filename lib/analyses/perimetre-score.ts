/**
 * @file lib/analyses/perimetre-score.ts — la résolution du périmètre de `POST /api/analyses/score` en une liste BORNÉE
 * de codes postaux (extrait de la route, ④ finitions, T1).
 *
 * Trois formes, par ordre de précision : `codes_postaux` explicites, un `perimetre` de filtre, une `bbox`.
 *
 * - **Zone** (`perimetre.type === 'zone'`, sql/295) : `codes_postaux_de_zone_jsonb`, la règle de la couverture « Par
 *   code postal » de ④ (CP des carreaux habités dont le centroïde est dans la zone). L'espace se contrôle EN SQL :
 *   `p_org` est l'espace de la SESSION, jamais un paramètre du client ; absente ou d'un autre espace → 404
 *   `zone_introuvable`, la phrase unique du lot 4. Jusqu'au 30/10, la branche `zone` de
 *   `codes_postaux_du_perimetre_jsonb` retenait les CP dont le centroïde du CONTOUR tombait dans la zone : un disque
 *   de 2 km à la campagne n'en contenait aucun (« Périmètre vide »). React reçoit la même correction (règle serveur).
 *   ⚠ Un super admin ne score plus une zone d'un AUTRE espace que l'actif (la couverture ne le permettait déjà pas).
 * - **Autres filtres** (région, département, commune, CP, France) : `codes_postaux_du_perimetre_jsonb` (sql/168, 287),
 *   inchangé. `_jsonb` et non `codes_postaux_du_perimetre` (RETURNS TABLE) : PostgREST coupe à `db-max-rows` même une
 *   RPC tabulaire — mesuré sur `'france'`, 6 187 CP rendus comme 5 000 sans erreur (projet hébergé, 2026-09-15).
 * - **bbox** : `codes_postaux_dans_bbox_jsonb` (sql/245) et non la forme tabulaire, qui rendait 1 000 codes sur 6 051
 *   pour la métropole sous le `max_rows` local (2026-10-10).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { createAdminClient } from '@/lib/auth';
import { rpcJson } from '@/lib/supabase/rpc-json';
import { MESSAGES_REFUS_COUVERTURE } from '@/lib/zones/couverture';

type ClientAdmin = ReturnType<typeof createAdminClient>;

/**
 * Plafond de codes postaux d'un périmètre.
 *
 * **Relevé de 3 000 à 7 000 le 2026-09-15, sur mesure.** L'ancienne valeur
 * refusait la France entière au motif que « ce n'est plus un périmètre » —
 * un choix de conception, pas une contrainte technique. Or le référentiel
 * compte 6 187 codes postaux, et le calcul national a été chronométré :
 *
 *   EXPLAIN (ANALYZE, BUFFERS) sur les 6 187 CP, 2 indicateurs
 *   → 159 ms · shared hit=2795 read=80, soit 640 Ko lus
 *
 * Un sixième de seconde et moins d'un mégaoctet : rien qui justifie de
 * fermer le cas d'usage le plus naturel de l'outil. Le plafond reste, au-dessus
 * du référentiel complet, pour refuser une liste absurde envoyée par un client
 * — pas pour interdire la France. Les trois résolutions passent par des
 * jumelles `jsonb` : ce plafond n'est jamais masqué par la troncature à 1 000.
 *
 * ⚠️ Ce qui coûte vraiment n'est PAS ce plafond, c'est la matérialisation
 * paresseuse : un indicateur jamais calculé déclenche un balayage complet
 * d'`iris` (~220 Mo, ~1,4 s) dans `assurerIndicateurCp`, une fois pour toutes.
 * Six indicateurs neufs sur un même lancement, c'est ~8 s — d'où `maxDuration`.
 */
export const MAX_CP = 7000;

/** Le périmètre tel que la carte le pose (`FiltreActif`). */
interface PerimetreFiltre {
  type: 'region' | 'departement' | 'commune' | 'cp' | 'zone' | 'france';
  code: string;
}

interface DemandePerimetre {
  codes_postaux?: string[];
  perimetre?: PerimetreFiltre;
  bbox?: [number, number, number, number];
}

type Issue = { ok: true; codes: string[] } | { ok: false; reponse: NextResponse };

const ECHEC = 'Résolution du périmètre impossible.';
const ETIQUETTE = '[POST /api/analyses/score]';

/** Les refus de `codes_postaux_de_zone_jsonb` (sql/295), et leurs statuts : ceux de la couverture. */
const REFUS_ZONE = ['zone_introuvable', 'zone_trop_vaste', 'couverture_non_construite'] as const;
type RefusZone = (typeof REFUS_ZONE)[number];
const STATUT_REFUS: Readonly<Record<RefusZone, number>> = {
  zone_introuvable: 404, zone_trop_vaste: 422, couverture_non_construite: 503,
};

const refus = (r: RefusZone, details: Record<string, unknown> = {}): Issue => ({
  ok: false,
  reponse: NextResponse.json({ error: MESSAGES_REFUS_COUVERTURE[r], ...details, refus: r }, { status: STATUT_REFUS[r] }),
});

const echec = (contexte: string, message: string): Issue => {
  console.error(`${ETIQUETTE} ${contexte}:`, message);
  return { ok: false, reponse: NextResponse.json({ error: ECHEC }, { status: 500 }) };
};

/** Une zone : sa liste de CP, ou le refus de la RPC en HTTP. Un id illisible répond 404 sans rien lire. */
async function codesDeZone(supabase: ClientAdmin, orgId: string, zoneId: string): Promise<Issue> {
  if (!z.string().uuid().safeParse(zoneId).success) return refus('zone_introuvable');
  const { data, error } = await supabase.rpc('codes_postaux_de_zone_jsonb', { p_zone: zoneId, p_org: orgId });
  if (error) return echec('zone', error.message);
  const o = rpcJson<Record<string, unknown>>(data);
  if (o && Array.isArray(o.codes) && o.codes.every((c) => typeof c === 'string')) return { ok: true, codes: o.codes as string[] };
  const r = REFUS_ZONE.find((x) => x === o?.refus);
  if (!r) return echec('zone', `réponse hors contrat ${JSON.stringify(data)}`);
  const { refus: _r, ...details } = o!;
  return refus(r, details);
}

/**
 * La liste de codes postaux du périmètre demandé, ou la réponse d'échec à rendre telle quelle : refus de zone, erreur
 * de base (500), périmètre vide (400) ou trop large (400, au-delà de `MAX_CP`).
 */
export async function resoudrePerimetreScore(supabase: ClientAdmin, orgId: string, d: DemandePerimetre): Promise<Issue> {
  let codes = d.codes_postaux ?? [];
  if (!codes.length && d.perimetre?.type === 'zone') {
    const issue = await codesDeZone(supabase, orgId, d.perimetre.code);
    if (!issue.ok) return issue;
    codes = issue.codes;
  } else if (!codes.length && d.perimetre) {
    const { data, error } = await supabase.rpc('codes_postaux_du_perimetre_jsonb', {
      p_type: d.perimetre.type, p_code: d.perimetre.code,
    });
    if (error) return echec('périmètre', error.message);
    codes = rpcJson<string[]>(data) ?? [];
  }
  if (!codes.length && d.bbox) {
    const [ouest, sud, est, nord] = d.bbox;
    const { data, error } = await supabase.rpc('codes_postaux_dans_bbox_jsonb', {
      p_ouest: ouest, p_sud: sud, p_est: est, p_nord: nord,
    });
    if (error) return echec('bbox', error.message);
    codes = rpcJson<string[]>(data) ?? [];
  }
  if (!codes.length) {
    return { ok: false, reponse: NextResponse.json({ error: 'Périmètre vide : aucun code postal à scorer.' }, { status: 400 }) };
  }
  if (codes.length > MAX_CP) {
    return {
      ok: false,
      reponse: NextResponse.json(
        { error: `Périmètre trop large : ${codes.length} codes postaux pour un maximum de ${MAX_CP}. Resserrez le filtre.` },
        { status: 400 },
      ),
    };
  }
  return { ok: true, codes };
}
