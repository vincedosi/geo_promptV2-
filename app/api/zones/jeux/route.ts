/**
 * @file app/api/zones/jeux/route.ts
 *
 * GET  — les jeux de zones de l'organisation. `?type=risque` (DÉFAUT) rend les seuls jeux risque, `zone` les seuls jeux
 *        de zone, `tous` les deux : les lecteurs d'avant le lot 5 (atelier risque React et Angular, wizard `SourcePlan`,
 *        `JeuxDeZonesRail`) ne savent lire qu'un jeu risque et n'envoient aucun paramètre — le défaut leur rend
 *        exactement l'ancienne liste. ⑤ et « Mes zones » demandent `tous` (revue finale du lot 5, point 1).
 * POST — enregistre un jeu. Un jeu RISQUE (corps sans `jeu.type`) est construit (géométries + codes postaux) ;
 *        un jeu de ZONE (`jeu.type === 'zone'`, lot 5, T7) est seulement écrit : sa zone, sa cible, son mode de plan
 *        et un choix par plateforme — aucun calcul, ses chiffres se relisent (`lib/zones/jeu-zone-routes.ts`).
 *
 * ── CE QU'UN JEU DE ZONES EST ─────────────────────────────────────────────
 *
 * Le maillon qui manquait : un profil de rayons figé en objet réutilisable,
 * avec ses poids par classe et son mode de plan. C'est ce qu'une campagne
 * reçoit comme PLAN géographique — et sans lui, la campagne de démonstration
 * du 2026-09-19 a produit 2 000 codes postaux sans `planned_share`, donc un
 * score d'alignement de 100/100 qui ne mesurait rien.
 *
 * ── POURQUOI LA CONSTRUCTION EST SYNCHRONE ───────────────────────────────
 *
 * Mesuré le 2026-09-20 : **21,3 s** pour 7 classes et 1 942 codes postaux sur
 * la France entière. C'est long pour une requête, mais c'est un geste rare —
 * on enregistre un jeu, on ne le recalcule pas à chaque clic — et le rendre
 * asynchrone imposerait une table de jobs et un écran de suivi pour vingt
 * secondes.
 *
 * ⚠ Si le temps devait doubler, c'est ce raisonnement qu'il faudrait refaire,
 * pas le délai qu'il faudrait allonger.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { lireCorps, messageAnomalies } from '@/lib/api/valider-corps';
import { rpcJson, toJson } from '@/lib/supabase/rpc-json';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { JeuDeZonesSchema, normaliserJeu, codeJeu } from '@/lib/zones/jeu';
import {
  CorpsCreationZoneSchema, enregistrerJeuZone, estCorpsDeZone, prochaineVersion, retirerJeu,
} from '@/lib/zones/jeu-zone-routes';

export const dynamic = 'force-dynamic';

/**
 * 6 par minute : chaque enregistrement déclenche une construction de ~21 s qui
 * croise 883 451 carreaux. Même ordre que `geo:rl:qualite-donnees`, pour la
 * même raison — le quota protège un budget d'I/O, pas un caprice. Un jeu de
 * zone (quatre lectures légères, deux écritures) partage ce quota : un seul
 * compteur pour « enregistrer un jeu », quel que soit son type.
 */
const limiteur = createRateLimiter({
  max: 6,
  window: '60 s',
  prefix: 'geo:rl:zone-sets',
});

const CorpsSchema = z.object({
  /**
   * Le nom n'est exigé qu'à l'enregistrement. Un BROUILLON d'atelier n'en a
   * pas : on règle, on compare, on décide, et le nom vient en dernier.
   */
  nom: z.string().min(1).max(120).optional(),
  description: z.string().max(600).optional(),
  /**
   * `true` construit sans enregistrer. Le jeu reste hors de la liste, et un
   * brouillon déjà construit pour le MÊME profil est rendu tel quel : re-régler
   * deux fois le même profil ne doit pas coûter deux fois 21 s.
   */
  brouillon: z.boolean().optional(),
  jeu: JeuDeZonesSchema,
});

/** `?type=` de la liste : absent → `risque`, la liste d'avant le lot 5. */
const TypeListeSchema = z.enum(['risque', 'zone', 'tous'], {
  message: 'Paramètre type invalide : risque, zone ou tous.',
}).default('risque');

const MESSAGES: Record<string, string> = {
  jeu_introuvable: 'Ce jeu de zones n’existe pas.',
  /*
   * ⚠ `filtre_nature_non_supporte` a été LEVÉ le 2026-09-20 (sql/220) : la
   * dimension manquante a été construite (`carreau_risque_nature`, sql/218) et
   * le filtre porte désormais sur la géométrie ET sur les codes postaux. Le
   * message reste ici parce que sql/211 et sql/217 portent encore ce code dans
   * une branche morte, et qu'un code sans message s'affiche « Construction
   * impossible » — un refus muet là où il y avait une phrase.
   */
  filtre_nature_non_supporte:
    'Le filtre par nature de risque n’a pas pu être appliqué à ce jeu de zones. '
    + 'Retirez le filtre, ou reconstruisez le pré-calcul des distances.',
  natures_inconnues:
    'Nature de risque non reconnue. Le catalogue des natures a changé depuis le '
    + 'chargement de la page — la rouvrir devrait suffire.',
  precalcul_absent:
    'Les distances par carreau n’ont pas encore été construites. '
    + 'Elles se calculent une fois après chaque import de sites à risque.',
  /*
   * ⚠ Distinct de `precalcul_absent`, et la distinction n'est pas de style :
   * aucune construction ne rendra un territoire que l'INSEE ne carroie pas.
   * Sans ce refus, l'atelier enregistrait un jeu VIDE — zéro classe, zéro
   * code postal — qu'une campagne pouvait recevoir comme plan, et qui ne
   * diffusait alors nulle part sans que rien le signale.
   */
  territoire_non_carroye:
    'L’INSEE ne publie pas de carroyage à 200 m pour ce département : un jeu de '
    + 'zones n’y retiendrait aucun code postal. Les sites y restent visibles sur '
    + 'la carte, mais leur population exposée n’est pas mesurable.',
};

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  if (!profile.organization_id) {
    return NextResponse.json({ error: 'Aucune organisation active.' }, { status: 403 });
  }

  const sp = request.nextUrl?.searchParams ?? new URL(request.url).searchParams;
  const type = TypeListeSchema.safeParse(sp.get('type') ?? undefined);
  if (!type.success) {
    return NextResponse.json({ error: type.error.issues[0]?.message ?? 'Paramètres invalides.' }, { status: 400 });
  }

  const supabase = createAdminClient();
  let requete = supabase
    .from('zone_sets')
    // UNE chaîne littérale : supabase-js déduit le type des lignes de la valeur, une concaténation le perd. Le nom de
    // la zone d'un jeu de zone vient par la clé étrangère (jointure PostgREST) : une requête, pas N. Le nombre
    // d'extractions aussi (agrégat `count` embarqué, index `idx_zse_jeu`) : ⑥ grise d'emblée un jeu jamais figé.
    .select('id, nom, description, version, created_at, construit_le, population_exposee, n_cp_retenus, taux_utile, mode_plan, seuil_couverture_cp, type, custom_geo_zone_id, zone:custom_geo_zones(name), extractions:zone_set_extractions(count)')
    .eq('org_id', profile.organization_id)
    // Les brouillons d'atelier ne sont pas des jeux : ils n'ont pas de nom, ils
    // se purgent seuls, et les lister ferait croire à une bibliothèque pleine
    // d'objets que personne n'a créés.
    .eq('brouillon', false)
    .order('created_at', { ascending: false })
    // Borne écrite, et pas seulement par prudence : une liste présentée comme
    // exhaustive alors qu'elle est tronquée est un mensonge silencieux.
    // 200 jeux dans une organisation serait déjà un symptôme.
    .limit(200);
  if (type.data !== 'tous') requete = requete.eq('type', type.data);
  const { data, error } = await requete;

  if (error) {
    console.error('[zones/jeux] liste :', error.message);
    return NextResponse.json({ error: 'Liste des jeux indisponible.' }, { status: 500 });
  }

  // Les objets imbriqués sont aplatis — `zone_nom` (null pour un jeu risque), `n_extractions` — : la liste reste plate.
  const jeux = (data ?? []).map(({ zone, extractions, ...jeu }) => ({
    ...jeu, zone_nom: zone?.name ?? null, n_extractions: extractions?.[0]?.count ?? 0,
  }));
  return NextResponse.json({ jeux }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  if (!profile.organization_id) {
    return NextResponse.json({ error: 'Aucune organisation active.' }, { status: 403 });
  }

  // Lu une fois (`lireCorps` ne lève jamais : un JSON illisible répond 400, pas
  // 500), puis validé par le schéma de SON type — `jeu.type` le discrimine.
  const brut = await lireCorps(request, z.unknown());
  if (!brut.ok) return NextResponse.json({ error: brut.message }, { status: 400 });

  if (estCorpsDeZone(brut.valeur)) {
    const zone = CorpsCreationZoneSchema.safeParse(brut.valeur);
    if (!zone.success) return NextResponse.json({ error: messageAnomalies(zone.error) }, { status: 400 });
    const quota = await limiteur(profile.id);
    if (!quota.ok) return rateLimitResponse(quota.retrySec);
    return enregistrerJeuZone(createAdminClient(), { orgId: profile.organization_id, userId: profile.id }, zone.data);
  }

  const lu = CorpsSchema.safeParse(brut.valeur);
  if (!lu.success) return NextResponse.json({ error: messageAnomalies(lu.error) }, { status: 400 });
  const valeur = lu.data;

  /*
   * Le jeu est RENORMALISÉ côté serveur, jamais accepté sur parole. Le client
   * envoie ce qu'il affiche ; le serveur décide ce qu'il stocke. Sans cette
   * étape, deux jeux équivalents mais saisis dans un ordre différent auraient
   * deux `profil_hash`, donc deux constructions de 21 s pour une seule
   * question.
   */
  let jeu;
  try {
    jeu = normaliserJeu(valeur.jeu);
  } catch {
    return NextResponse.json(
      { error: 'Jeu de zones invalide : vérifiez les rayons, les poids et le seuil.' },
      { status: 400 },
    );
  }

  const brouillon = valeur.brouillon === true;
  if (!brouillon && !valeur.nom) {
    return NextResponse.json(
      { error: 'Donnez un nom au jeu de zones.' },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const empreinte = codeJeu(jeu);

  /*
   * Un brouillon DÉJÀ construit pour ce profil est rendu tel quel, AVANT de
   * consommer le quota : l'atelier revient souvent sur un profil qu'il vient
   * de régler, et refaire 21 s de calcul pour un résultat identique serait
   * aussi inutile que coûteux. L'index unique partiel
   * `idx_zone_sets_brouillon_unique` (sql/215) garantit qu'il n'y en a qu'un.
   */
  if (brouillon) {
    const { data: deja, error: erreurBrouillon } = await supabase
      .from('zone_sets')
      .select('id, version, n_cp_retenus, taux_utile, population_exposee, seuil_couverture_cp')
      .eq('org_id', profile.organization_id)
      .eq('profil_hash', empreinte)
      .eq('brouillon', true)
      .maybeSingle();

    if (erreurBrouillon) {
      console.error('[zones/jeux] brouillon :', erreurBrouillon.message);
      return NextResponse.json({ error: 'Enregistrement impossible.' }, { status: 500 });
    }
    if (deja) {
      return NextResponse.json({
        id: deja.id,
        version: deja.version,
        deja_construit: true,
        retenus: deja.n_cp_retenus,
        taux_utile: deja.taux_utile,
        population_exposee: deja.population_exposee,
      });
    }
  }

  const quota = await limiteur(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  // Même nom, même espace : une NOUVELLE version, jamais un écrasement (une
  // campagne fige la version au rattachement).
  const version = await prochaineVersion(supabase, profile.organization_id, valeur.nom ?? '');
  if (version === null) return NextResponse.json({ error: 'Enregistrement impossible.' }, { status: 500 });

  const { data: cree, error: erreurCreation } = await supabase
    .from('zone_sets')
    .insert({
      // Un brouillon porte un nom vide plutôt que `null` : la colonne est
      // `not null`, et un nom vide se distingue d'un nom oublié.
      nom: valeur.nom ?? '',
      description: valeur.description ?? null,
      brouillon,
      org_id: profile.organization_id,
      created_by: profile.id,
      version,
      profil: toJson(jeu.profil),
      cible: jeu.cible,
      gravites: jeu.gravites,
      natures: jeu.natures,
      modes: jeu.modes,
      territoire: jeu.territoire,
      mode_plan: jeu.mode_plan,
      seuil_couverture_cp: jeu.seuil_couverture_cp,
      poids: toJson(jeu.poids),
      profil_hash: empreinte,
    })
    .select('id')
    .single();

  if (erreurCreation || !cree) {
    console.error('[zones/jeux] creation :', erreurCreation?.message);
    return NextResponse.json({ error: 'Enregistrement impossible.' }, { status: 500 });
  }

  const { data, error } = await supabase.rpc('construire_zone_set', {
    p_zone_set_id: cree.id,
  });

  if (error) {
    console.error('[zones/jeux] construction :', error.message);
    await retirerJeu(supabase, cree.id);
    return NextResponse.json({ error: 'Construction du jeu impossible.' }, { status: 500 });
  }

  const resultat = rpcJson<{
    ok: boolean; error?: string; classes: number; codes_postaux: number;
    retenus: number; population_exposee: number; taux_utile: number | null;
    duree_ms: number;
  }>(data);

  if (!resultat?.ok) {
    await retirerJeu(supabase, cree.id);
    return NextResponse.json(
      { error: MESSAGES[resultat?.error ?? ''] ?? 'Construction du jeu impossible.' },
      { status: 400 },
    );
  }

  return NextResponse.json({ id: cree.id, version, ...resultat }, { status: 201 });
}
