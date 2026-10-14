/**
 * @file lib/carte/jeux-recommandables.ts — les jeux COMMUNS qu'un espace peut se voir recommander (Accès › fiche
 * espace › Données, spec carte-en-parcours § 7.2) : les référentiels du registre, puis les types de POI du SOCLE (ce que
 * tout espace voit). Une catégorie rangée dans un autre jeu (`CATEGORIES_HORS_POI`) ou dont le nom ne donne pas une clé
 * conforme n'est pas proposée : elle ne peut pas être enregistrée, et la proposer ferait échouer l'enregistrement de
 * TOUTE la sélection.
 *
 * Lectures SÉQUENTIELLES (règles I/O) : l'espace, les sources du socle, les catégories, leurs libellés, la sélection
 * (≤ 200 lignes, sql/251 — sous le plafond PostgREST de 1 000).
 *
 * Coût : les catégories du socle sont le leapfrog de `getCategoriesVisibles`, en cache 5 min par empreinte de
 * périmètre — la MÊME empreinte que `GET /api/map/categories` appelée sans espace : ces routes partagent sa lecture
 * (≈ 18 000 buffers au premier pas sans cache, EXPLAIN ANALYZE du 2026-10-13) au lieu d'en ajouter une.
 */
import type { createAdminClient } from '@/lib/auth';
import { getOrgSourceIds } from '@/lib/auth/getOrgSourceIds';
import { getCategoriesVisibles } from '@/lib/poi/categories';
import { avecLibelles, libellesCategories } from '@/lib/poi/libelles-categories';
import {
  CATEGORIES_HORS_POI, JEUX_REFERENTIELS, PREFIXE_POI, cleJeuPoi,
  type JeuRecommandable, type ReponseJeuxRecommandables,
} from './jeux-carte';

type Sb = ReturnType<typeof createAdminClient>;

/** Les catégories de POI du socle qu'on peut recommander : hors catégories rangées ailleurs, à clé conforme. */
async function categoriesRecommandables(): Promise<string[]> {
  // Le socle seul : une session absente, en vue espace, rend `visibilite = socle` (getOrgSourceIds).
  const socle = (await getOrgSourceIds(null, { vueEspace: true })) ?? [];
  return (await getCategoriesVisibles(socle))
    .filter((c) => !CATEGORIES_HORS_POI.includes(c) && cleJeuPoi(c) !== null);
}

/**
 * Les jeux recommandables de l'espace, chacun avec `recommande`.
 * @returns `null` si l'espace n'existe pas (aucune catégorie n'est alors lue).
 * @throws Error — lecture en échec (message technique, à journaliser, jamais à afficher).
 */
export async function jeuxRecommandables(supabase: Sb, orgId: string): Promise<ReponseJeuxRecommandables | null> {
  const { data: org, error: eOrg } = await supabase.from('organizations').select('id').eq('id', orgId).maybeSingle();
  if (eOrg) throw new Error(`lecture de l'espace : ${eOrg.message}`);
  if (!org) return null;

  const categories = await categoriesRecommandables();
  const libelles = await libellesCategories(supabase, categories);

  const { data: lignes, error } = await supabase
    .from('espace_jeux_recommandes').select('cle_jeu').eq('organization_id', orgId);
  if (error) throw new Error(`lecture de la sélection : ${error.message}`);
  const choisies = new Set((lignes ?? []).map((l: { cle_jeu: string }) => l.cle_jeu));

  const jeux: JeuRecommandable[] = [
    ...JEUX_REFERENTIELS.map((j) => ({ ...j, recommande: choisies.has(j.cle) })),
    ...avecLibelles(categories, libelles).flatMap((c) => {
      const cle = cleJeuPoi(c.id);
      if (cle === null) return [];
      return [{ cle, nom: c.label, nature: 'poi' as const, maille: 'point', recommande: choisies.has(cle) }];
    }),
  ];
  return { jeux };
}

/**
 * Les clés `poi:` qui ne désignent AUCUN type de POI recommandable (catégorie absente du socle, ou disparue).
 * `estCleJeuConnue` ne vérifie que la forme : sans ce contrôle, `poi:<n'importe quoi>` s'enregistrerait.
 * Ne lit rien si aucune clé n'est `poi:`.
 */
export async function clesPoiInconnues(cles: readonly string[]): Promise<string[]> {
  const poi = cles.filter((c) => c.startsWith(PREFIXE_POI));
  if (poi.length === 0) return [];
  const connues = new Set((await categoriesRecommandables()).map((c) => cleJeuPoi(c)));
  return poi.filter((c) => !connues.has(c));
}
