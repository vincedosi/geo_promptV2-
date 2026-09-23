/**
 * @file app/api/zones/jeux/[id]/extractions/route.ts
 *
 * Les EXTRACTIONS d'un jeu de zones (Phase 4 du chantier zones -> CP).
 *
 * GET  — la liste des versions, la plus récente d'abord.
 * POST — fige l'état courant du plan en une nouvelle version.
 *
 * ── CE QUI DISTINGUE CETTE ROUTE DE `/export` ────────────────────────────
 *
 * `/export` fabrique un classeur à la volée : il relit `zone_set_cp` et
 * rappelle `genererPlanCp` à chaque téléchargement, donc il reflète toujours
 * l'état COURANT du jeu. Parfait pour regarder, inutilisable pour se souvenir.
 *
 * Celle-ci fige. Après un POST, les multiplicateurs sont en base et ne
 * bougeront plus, même si le seuil de couverture est déplacé ensuite. C'est
 * ce qui permet à la Phase 5 de comparer une diffusion à l'extraction qui l'a
 * produite, et non à un plan recalculé depuis.
 *
 * ── LE PLAN EST CALCULÉ ICI, PAS EN SQL ──────────────────────────────────
 *
 * `genererPlanCp` (`lib/zones/plan.ts`) est la fonction PURE et testée qui
 * produit AUSSI le plan poussé au DSP par `/rattacher`. En écrire une version
 * SQL pour l'extraction donnerait deux implémentations qui divergeraient au
 * premier correctif — et ce qu'on aurait archivé ne serait plus ce qui est
 * parti. La base ne fait donc que ce que seule la base sait faire : sérialiser
 * l'attribution du numéro de version, et figer.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { lireCorps } from '@/lib/api/valider-corps';
import { lireTout } from '@/lib/supabase/lire-tout';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { rpcJson, toJson } from '@/lib/supabase/rpc-json';
import { normaliserJeu } from '@/lib/zones/jeu';
import { genererPlanCp, plierParCodePostal, type CpZone } from '@/lib/zones/plan';
import { lireGroupesCp } from '@/lib/zones/groupes';

export const dynamic = 'force-dynamic';

/**
 * 6 par minute, comme `/export` et `/rattacher`. Une extraction relit tous les
 * codes postaux du jeu et écrit près de 2 000 lignes : c'est un geste
 * délibéré, pas une lecture d'écran. Compteur PARTAGÉ en base
 * (`consommer_quota`, sql/135) — une `Map` locale ne bornerait même pas une
 * boucle relancée après un redémarrage du serveur de dev.
 */
const limiteurEcriture = createRateLimiter({
  max: 6, window: '60 s', prefix: 'geo:rl:zone-set-extraire',
});

/** La lecture ne calcule rien : plafond large, il empêche une boucle. */
const limiteurLecture = createRateLimiter({
  max: 30, window: '60 s', prefix: 'geo:rl:zone-set-extractions',
});

/** Au-delà, `lireTout` LÈVE plutôt que de rendre un début de plan. */
const PLAFOND_CP = 8000;

const CorpsSchema = z.object({
  origine: z.enum(['initiale', 'recalage']).default('initiale'),
  commentaire: z.string().trim().max(500).default(''),
});

interface LigneCp {
  code_postal: string;
  classe: string;
  pop_en_zone: number | null;
  pop_totale: number | null;
  part_en_zone: number | null;
  retenu: boolean;
  cluster_id: string | null;
}

/**
 * Une grappe, telle que l'extraction la fige.
 *
 * ⚠ `nom_auto` est un BOOLÉEN — « ce nom a été déduit, personne ne l'a
 * choisi » — et non un second nom. Un nom édité par l'utilisateur ne doit pas
 * être écrasé par la reconstruction suivante (sql/224).
 */
interface Grappe {
  id: string;
  rang: number;
  nom: string | null;
  nom_auto: boolean;
}

/** Une extraction telle que la liste la rend. */
export interface ExtractionResume {
  id: string;
  version: number;
  origine: 'initiale' | 'recalage';
  commentaire: string;
  seuil_couverture_cp: number;
  mode_plan: string;
  n_cp: number;
  n_retenus: number;
  taux_utile: number | null;
  part_plan_en_zone: number | null;
  created_at: string;
}

/** Le jeu, s'il appartient à l'organisation et qu'il est exploitable. */
async function lireJeu(
  supabase: ReturnType<typeof createAdminClient>,
  id: string,
  orgId: string,
) {
  const { data, error } = await supabase
    .from('zone_sets')
    .select('*')
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle();
  // La propriété est vérifiée ICI et non par RLS : les routes passent par
  // `createAdminClient()`, qui contourne toute policy.
  return { jeu: data, error };
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

  const quota = await limiteurLecture(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  const { id } = await params;
  const supabase = createAdminClient();

  const { jeu, error: erreurJeu } = await lireJeu(supabase, id, profile.organization_id);
  if (erreurJeu) {
    console.error('[zones/extractions] lecture jeu :', erreurJeu.message);
    return NextResponse.json({ error: 'Jeu de zones illisible.' }, { status: 500 });
  }
  if (!jeu) {
    return NextResponse.json({ error: 'Ce jeu de zones est introuvable.' }, { status: 404 });
  }

  const { data, error } = await supabase
    .from('zone_set_extractions')
    // ⚠ UNE chaîne littérale, JAMAIS une concaténation : supabase-js déduit le
    // type des lignes de la valeur littérale passée à `.select()`. Concaténée,
    // elle vaut `string`, le retour devient `GenericStringError` et la première
    // lecture de propriété échoue à la compilation (piège déjà documenté pour
    // `CHAMPS_JEU`, ARCHITECTURE.md).
    .select('id, version, origine, commentaire, seuil_couverture_cp, mode_plan, n_cp, n_retenus, taux_utile, part_plan_en_zone, created_at')
    .eq('zone_set_id', id)
    .order('version', { ascending: false });

  if (error) {
    console.error('[zones/extractions] liste :', error.message);
    return NextResponse.json({ error: 'Extractions illisibles.' }, { status: 500 });
  }

  return NextResponse.json({
    extractions: (data ?? []) as ExtractionResume[],
    jeu: { id: jeu.id, nom: jeu.nom, version: jeu.version },
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  if (!profile.organization_id) {
    return NextResponse.json({ error: 'Aucune organisation active.' }, { status: 403 });
  }

  // `lireCorps` ne lève jamais et rend un message français — `request.json()`
  // nu répondrait 500 sur un corps illisible (`lib/api/valider-corps.ts`).
  const corps = await lireCorps(request, CorpsSchema);
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });

  const quota = await limiteurEcriture(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  const { id } = await params;
  const supabase = createAdminClient();

  const { jeu: jeuRow, error: erreurJeu } = await lireJeu(supabase, id, profile.organization_id);
  if (erreurJeu) {
    console.error('[zones/extractions] lecture jeu :', erreurJeu.message);
    return NextResponse.json({ error: 'Jeu de zones illisible.' }, { status: 500 });
  }
  if (!jeuRow) {
    return NextResponse.json({ error: 'Ce jeu de zones est introuvable.' }, { status: 404 });
  }
  if (jeuRow.brouillon) {
    return NextResponse.json(
      {
        error: 'Ce jeu est encore un brouillon. Enregistrez-le avant d’extraire : une '
          + 'extraction porte le nom du jeu, et un brouillon n’en a pas.',
      },
      { status: 409 },
    );
  }
  if (!jeuRow.construit_le) {
    return NextResponse.json(
      { error: 'Ce jeu de zones n’a pas été construit : il n’y a rien à extraire.' },
      { status: 409 },
    );
  }

  /*
   * ⚠ Lecture PAGINÉE. PostgREST applique `db-max-rows = 1000` côté SERVEUR
   * (`supabase/config.toml:18`) et aucun `.limit()` client ne le lève : un jeu
   * national de près de 2 000 codes postaux en rendrait 1 000, et l'extraction
   * archivée couvrirait la moitié du plan en se présentant comme complète.
   */
  let cpRows: LigneCp[];
  try {
    ({ lignes: cpRows } = await lireTout<LigneCp>(
      (de, a) => supabase
        .from('zone_set_cp')
        .select('code_postal, classe, pop_en_zone, pop_totale, part_en_zone, retenu, cluster_id')
        .eq('zone_set_id', id)
        .order('code_postal')
        .range(de, a),
      PLAFOND_CP,
    ));
  } catch (e) {
    console.error('[zones/extractions] lecture CP :', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Codes postaux du jeu illisibles.' }, { status: 500 });
  }

  if (cpRows.length === 0) {
    return NextResponse.json(
      { error: 'Ce jeu de zones ne couvre aucun code postal.' },
      { status: 409 },
    );
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

  const cps: CpZone[] = cpRows.map((r) => ({
    code_postal: r.code_postal,
    classe: r.classe,
    pop_en_zone: Number(r.pop_en_zone ?? 0),
    pop_totale: Number(r.pop_totale ?? 0),
    retenu: r.retenu,
  }));

  // Les codes postaux que le référentiel ne distingue pas : le plan les achète
  // TOUS, multiplicateur divisé par leur nombre (`lib/zones/groupes.ts`).
  const groupes = await lireGroupesCp(supabase);
  const plan = genererPlanCp(cps, jeu, groupes);

  if (plan.lignes.length === 0) {
    return NextResponse.json(
      { error: 'Ce jeu ne produit aucun plan : il n’y a rien à extraire.' },
      { status: 409 },
    );
  }

  /*
   * Les populations sont reprises des lignes REPLIÉES par code postal, jamais
   * des lignes brutes : depuis sql/225, `zone_set_cp` en porte une par grappe,
   * et sommer `pop_totale` ferait peser trois fois un code postal présent dans
   * trois bassins (`plierParCodePostal`).
   */
  const plie = new Map(plierParCodePostal(cps).map((c) => [c.code_postal, c]));
  // La part en zone vient de la base et non d'un recalcul : c'est elle qui a
  // décidé de la rétention, et la recalculer ici pourrait rendre une valeur
  // légèrement différente de celle qui a tranché.
  const partParCp = new Map<string, number | null>();
  for (const r of cpRows) {
    const actuel = partParCp.get(r.code_postal);
    const v = r.part_en_zone == null ? null : Number(r.part_en_zone);
    // Un code postal à cheval porte une ligne par grappe : on garde la plus
    // forte couverture, celle qui explique la rétention.
    if (actuel == null || (v != null && v > actuel)) partParCp.set(r.code_postal, v);
  }
  /*
   * La GRAPPE dominante de chaque code postal : celle qui y porte le plus de
   * population exposée. Un code postal peut appartenir à plusieurs bassins —
   * 274 sur 1 927 mesurés le 2026-09-22, jusqu'à six — mais le DSP n'achète
   * qu'une ligne par code postal, et l'écran ne sait en nommer qu'un.
   */
  const grappeDominante = new Map<string, { id: string; pop: number }>();
  for (const r of cpRows) {
    if (!r.cluster_id) continue;
    const pop = Number(r.pop_en_zone ?? 0);
    const actuel = grappeDominante.get(r.code_postal);
    if (!actuel || pop > actuel.pop) grappeDominante.set(r.code_postal, { id: r.cluster_id, pop });
  }

  const { data: grappesRows, error: erreurGrappes } = await supabase
    .from('zone_set_clusters')
    .select('id, rang, nom, nom_auto')
    .eq('zone_set_id', id);
  if (erreurGrappes) {
    // L'extraction reste possible sans les noms de bassins : le plan est
    // complet sans eux. On le dit dans le journal plutôt que d'échouer.
    console.error('[zones/extractions] grappes :', erreurGrappes.message);
  }
  const grappeParId = new Map<string, Grappe>(
    ((grappesRows ?? []) as Grappe[]).map((g) => [g.id, g]),
  );

  // L'inverse de `groupes` : de quel canonique chaque membre relève.
  const canoniqueDe = new Map<string, string>();
  for (const [canonique, membres] of groupes) {
    for (const m of membres) canoniqueDe.set(m, canonique);
  }

  const lignes = plan.lignes.map((l) => {
    const canonique = canoniqueDe.get(l.code_postal) ?? l.code_postal;
    const estCanonique = canonique === l.code_postal;
    const source = plie.get(canonique);
    // La grappe suit le CANONIQUE : un membre indiscernable partage le bassin
    // de son groupe, faute de pouvoir en distinguer un autre.
    const grappe = grappeParId.get(grappeDominante.get(canonique)?.id ?? '');
    return {
      code_postal: l.code_postal,
      code_canonique: canonique,
      classe: l.classe,
      cluster_id: grappe?.id ?? null,
      cluster_rang: grappe?.rang ?? null,
      // Un bassin sans nom garde son rang : « Zone 3 » se lit, une cellule
      // vide laisserait croire que le code postal n'appartient à aucune zone.
      zone_nom: grappe ? (grappe.nom?.trim() || `Zone ${grappe.rang}`) : null,
      retenu: l.retenu,
      multiplicateur: l.multiplicateur,
      // ⚠ `null` et non 0 sur un membre non canonique : sa population est
      // indiscernable de celle de son groupe, que la ligne canonique porte en
      // entier. Un 0 se lirait « ce code postal n'expose personne ».
      pop_en_zone: estCanonique ? (source?.pop_en_zone ?? null) : null,
      pop_totale: estCanonique ? (source?.pop_totale ?? null) : null,
      part_en_zone: estCanonique ? (partParCp.get(canonique) ?? null) : null,
    };
  });

  const resume = {
    n_cp: plie.size,
    n_retenus: plan.n_retenus,
    taux_utile: plan.taux_utile,
    part_plan_en_zone: plan.part_plan_en_zone,
    population_exposee: [...plie.values()]
      .filter((c) => c.retenu)
      .reduce((t, c) => t + c.pop_en_zone, 0),
  };

  const { data: brut, error } = await supabase.rpc('creer_zone_set_extraction', {
    p_zone_set_id: id,
    // `toJson` à la frontière : le générateur déclare ces arguments `Json`, et
    // un objet applicatif ne s'y coule pas sans conversion explicite.
    p_lignes: toJson(lignes),
    p_resume: toJson(resume),
    p_origine: corps.valeur.origine,
    p_commentaire: corps.valeur.commentaire,
    p_created_by: profile.id,
  });

  const data = rpcJson<{
    ok: boolean;
    error?: string;
    deja_extraite?: boolean;
    id?: string;
    version?: number;
    lignes_ecrites?: number;
  }>(brut);

  if (error) {
    console.error('[zones/extractions] création :', error.message);
    return NextResponse.json({ error: 'Extraction impossible.' }, { status: 500 });
  }
  if (!data?.ok) {
    // Les codes métier de la RPC ne repartent pas bruts au client : ils ne
    // veulent rien dire pour qui lit l'écran.
    const messages: Record<string, string> = {
      jeu_introuvable: 'Ce jeu de zones est introuvable.',
      jeu_non_construit: 'Ce jeu de zones n’a pas été construit : il n’y a rien à extraire.',
      plan_vide: 'Ce jeu ne produit aucun plan : il n’y a rien à extraire.',
    };
    return NextResponse.json(
      { error: messages[data?.error ?? ''] ?? 'Extraction impossible.' },
      { status: 409 },
    );
  }

  return NextResponse.json(data, { status: data.deja_extraite ? 200 : 201 });
}
