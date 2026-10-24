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
import { formaterNombre } from '@/lib/format/nombre';
import { zoneIntrouvable } from '@/lib/zones/session-zones';
import { JeuZoneSchema, type ChoixPlateforme } from '@/lib/zones/jeu';

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
 * plateforme. Une lecture, bornée par construction (≤ 4 plateformes × 6 mailles, clé primaire). `null` = admis.
 */
async function refusDesChoix(supabase: ClientAdmin, choix: ChoixPlateforme[]): Promise<NextResponse | null> {
  const { data, error } = await supabase
    .from('plateformes_geo').select('plateforme, maille, disponible, limites, note')
    .in('plateforme', [...new Set(choix.map((c) => c.plateforme))]);
  if (error) return panne('plateformes_geo', error.message);

  for (const c of choix) {
    const regle = (data ?? []).find((l) => l.plateforme === c.plateforme && l.maille === c.maille);
    if (!regle) return erreur(`${c.plateforme} n’achète pas à la maille ${c.maille}.`, 400);
    if (!regle.disponible) {
      return erreur(`La maille ${c.maille} n’est pas disponible chez ${c.plateforme}${regle.note ? ` : ${regle.note}` : '.'}`, 400);
    }
    const limites = (regle.limites ?? {}) as { rayon_min_m?: number; rayon_max_m?: number };
    const min = limites.rayon_min_m ?? 0;
    const max = limites.rayon_max_m ?? Number.POSITIVE_INFINITY;
    if (c.rayon_m !== undefined && (c.rayon_m < min || c.rayon_m > max)) {
      const bornes = Number.isFinite(max)
        ? `${formaterNombre(min)} à ${formaterNombre(max)} m`
        : `au moins ${formaterNombre(min)} m`;
      return erreur(`Rayon de ${formaterNombre(c.rayon_m)} m hors des bornes de ${c.plateforme} (${bornes}).`, 400);
    }
  }
  return null;
}

const lignesChoix = (jeuId: string, choix: ChoixPlateforme[]) => choix.map((c) => ({
  zone_set_id: jeuId, plateforme: c.plateforme, maille: c.maille, seuil: c.seuil, rayon_m: c.rayon_m ?? null,
}));

/**
 * POST d'un jeu de zone, APRÈS le quota (la route le consomme). Zone de l'espace (404 sinon), cible active de
 * `cibles_exposition`, choix admis par `plateformes_geo` — trois lectures légères, en parallèle (≤ 3, `CLAUDE.md`) —
 * puis la version, puis UNE écriture par table ; si les choix échouent, le jeu est retiré.
 */
export async function enregistrerJeuZone(
  supabase: ClientAdmin,
  espace: EspaceJeu,
  corps: z.infer<typeof CorpsCreationZoneSchema>,
): Promise<NextResponse> {
  const { jeu } = corps;
  const [zone, cible, refus] = await Promise.all([
    supabase.from('custom_geo_zones').select('id').eq('id', jeu.zone_id).eq('org_id', espace.orgId).maybeSingle(),
    supabase.from('cibles_exposition').select('code').eq('code', jeu.cible).eq('actif', true).maybeSingle(),
    refusDesChoix(supabase, jeu.plateformes),
  ]);
  if (zone.error) return panne('zone', zone.error.message);
  if (!zone.data) return zoneIntrouvable();
  if (cible.error) return panne('cible', cible.error.message);
  if (!cible.data) return erreur(`Cible inconnue : ${jeu.cible}.`, 400);
  if (refus) return refus;

  const version = await prochaineVersion(supabase, espace.orgId, corps.nom);
  if (version === null) return erreur(ECHEC_ENREGISTREMENT, 500);

  const { data: cree, error: erreurCreation } = await supabase
    .from('zone_sets')
    .insert({
      type: 'zone', nom: corps.nom, description: corps.description ?? null, org_id: espace.orgId,
      created_by: espace.userId, version, custom_geo_zone_id: jeu.zone_id, cible: jeu.cible,
      mode_plan: jeu.mode_plan, brouillon: false,
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
 * GET d'un jeu de zone : `{ jeu, zone: { id, nom, recette }, plateformes }`. Deux lectures, en parallèle ; aucune de
 * `zone_set_cp` (un jeu de zone n'en a pas). La zone ne peut manquer (clé étrangère `on delete restrict`) : son
 * absence est une anomalie, rendue en 500.
 */
export async function lireJeuZone(supabase: ClientAdmin, jeu: LigneJeu): Promise<NextResponse> {
  const [zone, choix] = await Promise.all([
    supabase.from('custom_geo_zones').select('id, name, recette')
      .eq('id', jeu.custom_geo_zone_id ?? '').eq('org_id', jeu.org_id).maybeSingle(),
    supabase.from('zone_set_plateformes').select(COLONNES_CHOIX).eq('zone_set_id', jeu.id).order('plateforme'),
  ]);
  const illisible = 'Jeu de zones illisible.';
  if (zone.error || !zone.data) return panne(`zone du jeu ${jeu.id}`, zone.error?.message ?? 'absente', illisible);
  if (choix.error) return panne(`choix du jeu ${jeu.id}`, choix.error.message, illisible);

  return NextResponse.json(
    {
      jeu: Object.fromEntries(CHAMPS_JEU_ZONE.map((k) => [k, jeu[k]])),
      zone: { id: zone.data.id, nom: zone.data.name, recette: zone.data.recette },
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
 */
export async function reglerJeuZone(
  supabase: ClientAdmin,
  jeu: LigneJeu,
  corps: z.infer<typeof CorpsReglageZoneSchema>,
  relire: () => Promise<{ ok: true; jeu: LigneJeu } | { ok: false; reponse: NextResponse }>,
): Promise<NextResponse> {
  if (corps.plateformes) {
    const refus = await refusDesChoix(supabase, corps.plateformes);
    if (refus) return refus;
  }

  const maj: Partial<LigneJeu> = {};
  if (corps.nom !== undefined) maj.nom = corps.nom;
  if (corps.description !== undefined) maj.description = corps.description;
  if (corps.mode_plan !== undefined) maj.mode_plan = corps.mode_plan;
  if (Object.keys(maj).length > 0) {
    const { error } = await supabase.from('zone_sets').update(maj).eq('id', jeu.id).eq('org_id', jeu.org_id);
    // 23505 : (espace, nom, version) existe déjà — un renommage vers un jeu existant, pas une panne.
    if (error?.code === '23505') return erreur('Un jeu de zones de ce nom existe déjà dans cette version.', 409);
    if (error) return panne('réglage', error.message, 'Modification impossible.');
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

  const apres = await relire();
  return apres.ok ? lireJeuZone(supabase, apres.jeu) : apres.reponse;
}
