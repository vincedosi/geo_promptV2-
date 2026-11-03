/**
 * @file lib/zones/jeu-zone-routes.ts — enregistrer, lire et régler un jeu de ZONE (lot 5, T7 ; arbitrages A-1, A-2,
 * A-7). Appelé par `app/api/zones/jeux/route.ts` (POST) et `app/api/zones/jeux/[id]/route.ts` (GET, PATCH) : un
 * fichier `route.ts` ne peut exporter que ses verbes HTTP, et les deux routes portent déjà le jeu risque.
 *
 * Un jeu de zone = UNE zone de l'espace (A-1), la cible comptée, le mode de plan et un choix de maille par plateforme
 * (`zone_set_plateformes`). AUCUN calcul ici : ni profil, ni `zone_set_cp`, ni population — les chiffres se relisent
 * par la couverture (A-2), l'extraction les fige (T8). Les règles des plateformes (couple connu, `disponible`, bornes
 * du rayon) se lisent dans `plateformes_geo`, jamais en dur (§ 16.2-3).
 *
 * L'espace est celui de la session (`profile.organization_id`) : toute lecture de zone et toute écriture de jeu y
 * sont bornées, parce que `createAdminClient()` contourne la RLS.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { createAdminClient } from '@/lib/auth';
import type { Tables } from '@/types/database.types';
import { zoneIntrouvable } from '@/lib/zones/session-zones';
import { JeuZoneSchema, type ChoixPlateforme } from '@/lib/zones/jeu';
import { lireRegles, refusDuChoix } from '@/lib/zones/conversion-serveur';
import { regleCategorieSpeciale } from '@/lib/zones/conversion-rayon';
import { mailleSansObjet } from '@/lib/zones/conversion';
import { lireRecette, recetteVue } from '@/lib/zones/recette-schema';
import { refusActivationServeur } from '@/lib/zones/activation-serveur';
import type { PlateformeGeo } from '@/lib/zones/plateformes';

type ClientAdmin = ReturnType<typeof createAdminClient>;
type LigneJeu = Tables<'zone_sets'>;

/** Ce qui identifie l'appelant : l'espace où le jeu se lit et s'écrit, l'auteur. */
export interface EspaceJeu { orgId: string; userId: string }

const NOM = z.string().trim().min(1).max(120);
const DESCRIPTION = z.string().max(600);

/**
 * Le corps de `POST /api/zones/jeux` pour un jeu de zone — reconnu à `jeu.type === 'zone'` ({@link estCorpsDeZone}).
 * Strict : une clé inconnue (`brouillon`, `seuil_couverture_cp`…) est refusée, pas ignorée — un jeu de zone n'a pas
 * de brouillon (A-2), et un réglage du risque passé ici serait perdu sans que l'appelant le sache.
 */
export const CorpsCreationZoneSchema = z.object({
  nom: NOM,
  description: DESCRIPTION.optional(),
  jeu: JeuZoneSchema,
}).strict();

/** Le corps de `PATCH /api/zones/jeux/[id]` pour un jeu de zone. La zone et la cible ne changent pas : nouveau jeu. */
export const CorpsReglageZoneSchema = z.object({
  nom: NOM.optional(),
  description: DESCRIPTION.nullable().optional(),
  mode_plan: JeuZoneSchema.shape.mode_plan.optional(),
  categorie_speciale: z.boolean().optional(),
  plateformes: JeuZoneSchema.shape.plateformes.optional(),
}).strict();

/** Le discriminant du corps de POST : un jeu risque n'a pas de `type` (corps d'avant le lot 5, inchangé). */
export function estCorpsDeZone(brut: unknown): boolean {
  const jeu = (brut as { jeu?: { type?: unknown } } | null)?.jeu;
  return typeof jeu === 'object' && jeu !== null && jeu.type === 'zone';
}

/** Les champs d'un jeu de zone rendus au client : ni l'espace (`org_id`), ni l'auteur, ni les colonnes du risque. */
const CHAMPS_JEU_ZONE = [
  'id', 'type', 'nom', 'description', 'version', 'created_at', 'custom_geo_zone_id', 'cible', 'mode_plan',
  'categorie_speciale',
] as const satisfies readonly (keyof LigneJeu)[];

const COLONNES_CHOIX = 'plateforme, maille, seuil, rayon_m';

const ECHEC_ENREGISTREMENT = 'Enregistrement impossible.';

const erreur = (message: string, status: number) => NextResponse.json({ error: message }, { status });

function panne(contexte: string, detail: string | undefined, message = ECHEC_ENREGISTREMENT): NextResponse {
  console.error(`[zones/jeux] ${contexte} :`, detail);
  return erreur(message, 500);
}

/**
 * Retire un jeu qui n'a pas pu être enregistré ou construit.
 *
 * ⚠ L'erreur de la suppression est LUE (`CLAUDE.md`) : supabase-js ne lève pas, et un retrait raté laisserait un jeu
 * fantôme dans la liste — un objet qu'on ne peut ni utiliser ni comprendre.
 */
export async function retirerJeu(supabase: ClientAdmin, id: string): Promise<void> {
  const { error } = await supabase.from('zone_sets').delete().eq('id', id);
  if (error) {
    console.error(`[zones/jeux] jeu ${id} non abouti ET non supprimé : ${error.message}. Il reste en base, incomplet.`);
  }
}

/**
 * La version d'un nouveau jeu : un jeu de même nom dans le même espace est une NOUVELLE version, jamais un écrasement
 * — une campagne fige la version au rattachement. `null` sur une erreur de lecture (journalisée).
 */
export async function prochaineVersion(supabase: ClientAdmin, orgId: string, nom: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('zone_sets').select('version').eq('org_id', orgId).eq('nom', nom)
    .order('version', { ascending: false }).limit(1);
  if (error) {
    console.error('[zones/jeux] version :', error.message);
    return null;
  }
  return (data?.[0]?.version ?? 0) + 1;
}

/**
 * Vérifie chaque choix contre `plateformes_geo` : couple connu, maille `disponible`, rayon dans les bornes de la
 * plateforme. La lecture commune `lireRegles` (bornée, validée). `null` = admis.
 */
async function refusDesChoix(supabase: ClientAdmin, choix: ChoixPlateforme[], categorieSpeciale: boolean): Promise<NextResponse | null> {
  let regles: PlateformeGeo[];
  try {
    // C29 : la règle telle que l'extraction la lira (`regleCategorieSpeciale`) — un choix refusé là l'est ici.
    regles = (await lireRegles(supabase, choix.map((c) => c.plateforme))).map((l) => regleCategorieSpeciale(l, categorieSpeciale));
  } catch (e) {
    return panne('plateformes_geo', e instanceof Error ? e.message : String(e));
  }

  for (const c of choix) {
    const refus = refusDuChoix(c, regles.find((l) => l.plateforme === c.plateforme && l.maille === c.maille));
    if (refus) return erreur(refus, 400);
  }
  return null;
}

/**
 * Un choix SANS OBJET pour la recette de la zone (⑤ finitions, A-3 : cercles ou commune sur une zone pays, pays sur une
 * zone locale) → 400 `{ error: « <plateforme> — <phrase> », refus: 'maille_sans_objet', plateforme }`, comme le 422
 * de l'extraction (relecture 1) ; la phrase est celle de `mailleSansObjet`, la même règle que l'écran et
 * l'extraction. `recette` : brute de `custom_geo_zones` ; illisible, seule la maille pays est refusée. `null` = admis.
 */
function refusSansObjet(recette: unknown, choix: ChoixPlateforme[]): NextResponse | null {
  const lue = lireRecette(recette);
  for (const c of choix) {
    const phrase = mailleSansObjet(lue.ok ? lue.recette : null, c.maille);
    if (phrase) {
      return NextResponse.json({ error: `${c.plateforme} — ${phrase}`, refus: 'maille_sans_objet', plateforme: c.plateforme }, { status: 400 });
    }
  }
  return null;
}

/**
 * Décision du 02/11 (+ tour 3, N-2) : une zone de rayon sous le minimum d'activation, ou une combinaison qui en contient
 * une → 400 `rayon_non_activable`, avec la valeur et la zone fautive (`refusActivationServeur` : une lecture par niveau
 * de combinaison, aucune sinon) — gardée pour l'analyse, jamais activée. `null` = admis.
 */
async function refusTropFin(supabase: ClientAdmin, orgId: string, recette: unknown, echec: string): Promise<NextResponse | null> {
  try {
    const tropFin = await refusActivationServeur(supabase, orgId, recette);
    return tropFin ? NextResponse.json({ error: tropFin, refus: 'rayon_non_activable' }, { status: 400 }) : null;
  } catch (e) {
    return panne('sources de la zone', e instanceof Error ? e.message : String(e), echec);
  }
}

const lignesChoix = (jeuId: string, choix: ChoixPlateforme[]) => choix.map((c) => ({
  zone_set_id: jeuId, plateforme: c.plateforme, maille: c.maille, seuil: c.seuil, rayon_m: c.rayon_m ?? null,
}));

/**
 * POST d'un jeu de zone, APRÈS le quota (la route le consomme). Zone de l'espace (404 sinon), cible active de
 * `cibles_exposition`, choix admis par `plateformes_geo` — trois lectures légères, en parallèle (≤ 3, `CLAUDE.md`) —,
 * choix qui ont un sens pour la recette de la zone (`refusSansObjet`, sans lecture de plus), puis la version, puis
 * UNE écriture par table ; si les choix échouent, le jeu est retiré.
 */
export async function enregistrerJeuZone(
  supabase: ClientAdmin,
  espace: EspaceJeu,
  corps: z.infer<typeof CorpsCreationZoneSchema>,
): Promise<NextResponse> {
  const { jeu } = corps;
  const [zone, cible, refus] = await Promise.all([
    supabase.from('custom_geo_zones').select('id, recette').eq('id', jeu.zone_id).eq('org_id', espace.orgId).maybeSingle(),
    supabase.from('cibles_exposition').select('code').eq('code', jeu.cible).eq('actif', true).maybeSingle(),
    refusDesChoix(supabase, jeu.plateformes, jeu.categorie_speciale === true),
  ]);
  if (zone.error) return panne('zone', zone.error.message);
  if (!zone.data) return zoneIntrouvable();
  if (cible.error) return panne('cible', cible.error.message);
  if (!cible.data) return erreur(`Cible inconnue : ${jeu.cible}.`, 400);
  if (refus) return refus;
  const sansObjet = refusSansObjet(zone.data.recette, jeu.plateformes);
  if (sansObjet) return sansObjet;
  const tropFin = await refusTropFin(supabase, espace.orgId, zone.data.recette, ECHEC_ENREGISTREMENT);
  if (tropFin) return tropFin;

  const version = await prochaineVersion(supabase, espace.orgId, corps.nom);
  if (version === null) return erreur(ECHEC_ENREGISTREMENT, 500);

  const { data: cree, error: erreurCreation } = await supabase
    .from('zone_sets')
    .insert({
      type: 'zone', nom: corps.nom, description: corps.description ?? null, org_id: espace.orgId,
      created_by: espace.userId, version, custom_geo_zone_id: jeu.zone_id, cible: jeu.cible,
      mode_plan: jeu.mode_plan, categorie_speciale: jeu.categorie_speciale === true, brouillon: false,
    })
    .select('id')
    .single();
  if (erreurCreation || !cree) return panne('création', erreurCreation?.message);

  const { error: erreurChoix } = await supabase.from('zone_set_plateformes').insert(lignesChoix(cree.id, jeu.plateformes));
  if (erreurChoix) {
    await retirerJeu(supabase, cree.id);
    return panne('choix des plateformes', erreurChoix.message);
  }
  return NextResponse.json({ id: cree.id, version }, { status: 201 });
}

/**
 * GET d'un jeu de zone : `{ jeu, zone: { id, nom, recette, surface_km2 }, plateformes }` (`surface_km2` : sql/316, B10). Deux lectures, en parallèle ; aucune de
 * `zone_set_cp` (un jeu de zone n'en a pas). La zone ne peut manquer (clé étrangère `on delete restrict`) : son
 * absence est une anomalie, rendue en 500.
 */
export async function lireJeuZone(supabase: ClientAdmin, jeu: LigneJeu): Promise<NextResponse> {
  const [zone, choix] = await Promise.all([
    supabase.from('custom_geo_zones').select('id, name, recette, unites_constitutives, surface_km2')
      .eq('id', jeu.custom_geo_zone_id ?? '').eq('org_id', jeu.org_id).maybeSingle(),
    supabase.from('zone_set_plateformes').select(COLONNES_CHOIX).eq('zone_set_id', jeu.id).order('plateforme'),
  ]);
  const illisible = 'Jeu de zones illisible.';
  if (zone.error || !zone.data) return panne(`zone du jeu ${jeu.id}`, zone.error?.message ?? 'absente', illisible);
  if (choix.error) return panne(`choix du jeu ${jeu.id}`, choix.error.message, illisible);

  return NextResponse.json(
    {
      jeu: Object.fromEntries(CHAMPS_JEU_ZONE.map((k) => [k, jeu[k]])),
      // B15 round 1 (I-2) : la recette jointe à la colonne de ses unités constitutives (sql/321), que ⑤ lit (`exactitude`).
      zone: { id: zone.data.id, nom: zone.data.name, recette: recetteVue(zone.data.recette, zone.data.unites_constitutives), surface_km2: zone.data.surface_km2 },
      plateformes: choix.data ?? [],
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * PATCH d'un jeu de zone : nom, description, mode de plan, choix par plateforme. Rend le jeu relu (forme du GET) ;
 * `relire` est fourni par la route (le chargeur commun), pour qu'un jeu supprimé entre-temps rende son 404.
 *
 * Les choix se remplacent par un UPSERT des nouveaux puis un DELETE CIBLÉ des plateformes retirées — et non
 * « DELETE tout puis INSERT » : si la seconde requête échoue, le jeu garde au pire une plateforme de trop (dite par le
 * 500), jamais zéro choix. L'erreur du DELETE est LUE (`CLAUDE.md`).
 *
 * Les CHOIX s'écrivent avant l'en-tête (revue finale du lot 5, point 8) : un échec des choix laisse le jeu tel quel,
 * nom compris — la réponse « Modification impossible » dit alors vrai. Un renommage refusé ENSUITE (23505) le dit
 * avec ce qui a déjà été écrit.
 */
export async function reglerJeuZone(
  supabase: ClientAdmin,
  jeu: LigneJeu,
  corps: z.infer<typeof CorpsReglageZoneSchema>,
  relire: () => Promise<{ ok: true; jeu: LigneJeu } | { ok: false; reponse: NextResponse }>,
): Promise<NextResponse> {
  // C29 round 1 : la case changée SANS nouveaux choix — les choix ENREGISTRÉS se revérifient avec elle (une lecture
  // de plus, bornée aux 4 plateformes du jeu) ; un choix que la case rend hors bornes refuse le PATCH, valeurs dites.
  if (corps.categorie_speciale !== undefined && !corps.plateformes) {
    const { data: enregistres, error } = await supabase.from('zone_set_plateformes').select(COLONNES_CHOIX).eq('zone_set_id', jeu.id);
    if (error) return panne('choix des plateformes', error.message, 'Modification impossible.');
    const choix = (enregistres ?? []).map((c) => ({ ...c, rayon_m: c.rayon_m ?? undefined })) as ChoixPlateforme[];
    const refus = choix.length > 0 ? await refusDesChoix(supabase, choix, corps.categorie_speciale) : null;
    if (refus) return refus;
  }
  if (corps.plateformes) {
    // Deux lectures légères en parallèle (≤ 3, `CLAUDE.md`) : les règles, la recette de la zone du jeu (A-3).
    const [refus, zone] = await Promise.all([
      refusDesChoix(supabase, corps.plateformes, corps.categorie_speciale ?? jeu.categorie_speciale === true),
      supabase.from('custom_geo_zones').select('recette').eq('id', jeu.custom_geo_zone_id ?? '').eq('org_id', jeu.org_id).maybeSingle(),
    ]);
    if (refus) return refus;
    // La zone ne peut manquer (clé étrangère `on delete restrict`) : son absence est une anomalie.
    if (zone.error || !zone.data) return panne('zone du jeu', zone.error?.message ?? 'absente', 'Modification impossible.');
    const sansObjet = refusSansObjet(zone.data.recette, corps.plateformes);
    if (sansObjet) return sansObjet;
    const tropFin = await refusTropFin(supabase, jeu.org_id, zone.data.recette, 'Modification impossible.');
    if (tropFin) return tropFin;
  }

  if (corps.plateformes) {
    const { error: erreurUpsert } = await supabase
      .from('zone_set_plateformes')
      .upsert(lignesChoix(jeu.id, corps.plateformes), { onConflict: 'zone_set_id,plateforme' });
    if (erreurUpsert) return panne('choix des plateformes', erreurUpsert.message, 'Modification impossible.');

    // Les codes viennent de `PLATEFORMES` (schéma) : aucune valeur libre dans le filtre.
    const gardees = corps.plateformes.map((c) => `"${c.plateforme}"`).join(',');
    const { error: erreurRetrait } = await supabase
      .from('zone_set_plateformes').delete().eq('zone_set_id', jeu.id).not('plateforme', 'in', `(${gardees})`);
    if (erreurRetrait) {
      return panne('retrait des plateformes', erreurRetrait.message,
        'Choix des plateformes partiellement enregistré : relancez l’enregistrement.');
    }
  }

  const maj: Partial<LigneJeu> = {};
  if (corps.nom !== undefined) maj.nom = corps.nom;
  if (corps.description !== undefined) maj.description = corps.description;
  if (corps.mode_plan !== undefined) maj.mode_plan = corps.mode_plan;
  if (corps.categorie_speciale !== undefined) maj.categorie_speciale = corps.categorie_speciale;
  if (Object.keys(maj).length > 0) {
    const { error } = await supabase.from('zone_sets').update(maj).eq('id', jeu.id).eq('org_id', jeu.org_id);
    // 23505 : (espace, nom, version) existe déjà — un renommage vers un jeu existant, pas une panne.
    if (error?.code === '23505') {
      return erreur('Un jeu de zones de ce nom existe déjà dans cette version.'
        + (corps.plateformes ? ' Les choix des plateformes, eux, sont enregistrés.' : ''), 409);
    }
    if (error) return panne('réglage', error.message, 'Modification impossible.');
  }

  const apres = await relire();
  return apres.ok ? lireJeuZone(supabase, apres.jeu) : apres.reponse;
}
