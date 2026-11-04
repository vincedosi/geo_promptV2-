/**
 * La carte des CODES POSTAUX d'un jeu de zones — ce qu'on ACHÈTE.
 *
 * ── POURQUOI CETTE ROUTE EXISTE ──────────────────────────────────────────
 *
 * Le module de risque montre depuis toujours ce qu'on MESURE : des anneaux
 * autour de sites classés, au carreau de 200 m. Il ne montrait nulle part ce
 * qu'on achète, qui est autre chose — le DSP cible au code postal, et un
 * anneau d'un kilomètre est bien plus petit qu'un code postal.
 *
 * L'écart se lisait en chiffres (« 1 102 codes postaux retenus, 73,1 %
 * d'utile »). Il se regarde désormais, côte à côte avec les rayons.
 *
 * ── LA PART DU PLAN VIENT DE `genererPlanCp`, JAMAIS D'UN CALCUL LOCAL ────
 *
 * C'est la fonction PURE qui produit le plan réellement poussé au DSP
 * (`/rattacher`) et celui du classeur d'export. Recalculer ici une part « à
 * peu près pareille » donnerait une carte qui contredit le fichier qu'on
 * envoie — et c'est la carte qu'on croirait.
 *
 * ⚠ Elle est appelée **SANS la carte des groupes**, contrairement aux deux
 * autres appelants. Les codes postaux d'un groupe partagent une géométrie
 * identique (sql/228) : les étaler ici dessinerait quatre fois le même
 * polygone, chacun au quart de la part, et l'opacité cumulée ferait passer
 * Nantes pour un code postal moins exposé qu'il ne l'est. La carte montre donc
 * le CANONIQUE, porteur de la part entière du groupe, et l'infobulle dit
 * combien de codes postaux il représente.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { chargerJeu } from '@/lib/zones/charger-jeu';
import { lireTout } from '@/lib/supabase/lire-tout';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { normaliserJeu } from '@/lib/zones/jeu';
import { type CpZone } from '@/lib/zones/plan';
import { planRisqueSousDrapeau, reponseErreurOptimisation } from '@/lib/optimisation/plans';
import { rpcJson } from '@/lib/supabase/rpc-json';

export const dynamic = 'force-dynamic';

/**
 * 30 par minute. Plus large que l'export (6) : celle-ci est LUE À CHAQUE
 * panoramique de la carte, et elle ne fabrique rien — une lecture de
 * `zone_set_cp` plus une jointure géométrique bornée par la bbox. Compteur
 * PARTAGÉ en base (`consommer_quota`, sql/135).
 */
const limiteur = createRateLimiter({ max: 30, window: '60 s', prefix: 'geo:rl:zone-set-cp-geo' });

/** Au-delà, la lecture des codes postaux échoue plutôt que de rendre un début. */
const PLAFOND_CP = 8000;

interface LigneCp {
  code_postal: string;
  classe: string;
  pop_en_zone: number | null;
  pop_totale: number | null;
  retenu: boolean;
}

interface Feature {
  type: 'Feature';
  id: string;
  geometry: unknown;
  properties: Record<string, unknown>;
}

interface Reponse {
  type: 'FeatureCollection';
  features: Feature[];
  n_total?: number;
  error?: string;
}

/** `-5.5,41.2,9.8,51.2` → `[-5.5, 41.2, 9.8, 51.2]`, ou `null` si illisible. */
function lireBbox(v: string | null): number[] | null {
  if (!v) return null;
  const n = v.split(',').map(Number);
  // ⚠ Quatre nombres FINIS et dans l'ordre : une bbox inversée ne lève pas
  // côté PostGIS, elle rend simplement zéro ligne — donc une carte vide qu'on
  // lirait « aucun code postal ici ».
  if (n.length !== 4 || n.some((x) => !Number.isFinite(x))) return null;
  if (n[0] >= n[2] || n[1] >= n[3]) return null;
  return n;
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

  // Un jeu de zone (étape ⑤) n'a ni profil ni `zone_set_cp` : 409 du chargeur (lot 5, A-3). L'espace est
  // vérifié par lui, et non par RLS (`createAdminClient()` contourne toute policy).
  const charge = await chargerJeu(supabase, id, profile.organization_id, { type: 'risque' });
  if (!charge.ok) return charge.reponse;
  const jeuRow = charge.jeu;
  if (!jeuRow.construit_le) {
    return NextResponse.json(
      { error: 'Ce jeu de zones n’a pas été construit : il n’y a rien à afficher.' },
      { status: 409 },
    );
  }

  const quota = await limiteur(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  const url = new URL(request.url);
  const bbox = lireBbox(url.searchParams.get('bbox'));

  // ── La géométrie ──────────────────────────────────────────────────────
  const { data: brut, error: erreurGeo } = await supabase.rpc('zone_set_cp_geo', {
    p_zone_set_id: id,
    // ⚠ `undefined` et non `null` : le générateur déclare l'argument
    // non-nullable alors que la fonction SQL accepte NULL (le cas « France
    // entière »). Passer `undefined` le laisse prendre sa valeur par défaut,
    // qui est précisément NULL — même contournement que `nullableArg`.
    p_bbox: bbox ?? undefined,
    p_limite: 4000,
  });
  const geo = rpcJson<Reponse>(brut);
  if (erreurGeo || !geo || geo.error) {
    console.error('[zones/cp-geo] zone_set_cp_geo :', erreurGeo?.message ?? geo?.error ?? 'aucune réponse');
    return NextResponse.json({ error: 'Géométrie des codes postaux illisible.' }, { status: 500 });
  }

  // ── La part du plan, par la fonction qui produit le plan réel ─────────
  let lignes: LigneCp[];
  try {
    ({ lignes } = await lireTout<LigneCp>(
      (de, a) => supabase
        .from('zone_set_cp')
        .select('code_postal, classe, pop_en_zone, pop_totale, retenu')
        .eq('zone_set_id', id)
        // Ordre TOTAL, la clé primaire (`zone_set_id, code_postal, cluster_id`, sql/225) : sans ordre, un code à
        // cheval sur plusieurs grappes rendait ses lignes dans un ordre arbitraire — plan non reproductible (`genererPlanCp`
        // somme les grappes dans l'ordre reçu), pages de `lireTout` qui pouvaient se recouvrir (tâche 1.6, comme 72185c97).
        .order('code_postal')
        .order('cluster_id')
        .range(de, a),
      PLAFOND_CP,
    ));
  } catch (e) {
    console.error('[zones/cp-geo] lecture des codes postaux :', e);
    return NextResponse.json({ error: 'Codes postaux illisibles.' }, { status: 500 });
  }

  const jeu = normaliserJeu({
    profil: jeuRow.profil,
    cible: jeuRow.cible,
    gravites: jeuRow.gravites,
    natures: jeuRow.natures,
    modes: jeuRow.modes,
    territoire: jeuRow.territoire,
    mode_plan: jeuRow.mode_plan,
    seuil_couverture_cp: Number(jeuRow.seuil_couverture_cp),
    poids: jeuRow.poids,
  });

  const cps: CpZone[] = lignes.map((r) => ({
    code_postal: r.code_postal,
    classe: r.classe,
    pop_en_zone: Number(r.pop_en_zone ?? 0),
    pop_totale: Number(r.pop_totale ?? 0),
    retenu: r.retenu,
  }));

  // `genererPlanCp`, ou le service Python, selon `OPTIMISATION_PLAN_SOURCE` (`lib/optimisation/plans.ts`).
  let plan: Awaited<ReturnType<typeof planRisqueSousDrapeau>>['valeur'];
  try {
    ({ valeur: plan } = await planRisqueSousDrapeau('cp_geo', cps, jeu));
  } catch (e) {
    return reponseErreurOptimisation(e, 'part du plan (cp-geo)');
  }
  const partParCp = new Map(plan.lignes.map((l) => [l.code_postal, l.part_plan]));

  // ⚠ La part est posée sur la feature, pas calculée dans la carte : MapLibre
  // ne sait pas normaliser, et un front qui diviserait par un total local
  // afficherait des parts qui ne somment pas à 100 dès qu'une bbox tronque.
  for (const f of geo.features) {
    f.properties.part_plan = partParCp.get(String(f.properties.code_postal)) ?? 0;
  }

  return NextResponse.json({
    type: 'FeatureCollection',
    features: geo.features,
    n_total: geo.n_total ?? geo.features.length,
    n_affiches: geo.features.length,
    // Les trois chiffres du bandeau, calculés par la MÊME fonction que le plan.
    taux_utile: plan.taux_utile,
    part_plan_en_zone: plan.part_plan_en_zone,
    n_retenus: plan.n_retenus,
    seuil_couverture_cp: Number(jeuRow.seuil_couverture_cp),
  });
}
