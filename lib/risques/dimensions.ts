/**
 * Les mailles et les modes de zone de l'analyse de population exposée.
 *
 * ── POURQUOI CE FICHIER ────────────────────────────────────────────────────
 *
 * La liste des mailles était écrite TROIS fois, et les trois divergeaient
 * (constat R-09 de `docs/AUDIT_ZONE_RISQUE.md`) : `/export` en acceptait cinq,
 * `/agregats` quatre, l'interface quatre. La maille `arrondissement` — que
 * `ARCHITECTURE.md` décrit comme le moyen de voir que « le nord de Marseille
 * n'est pas Marseille » — était donc **inatteignable** : l'écran ne la
 * proposait pas et `/agregats` la refusait en 400, pendant que `/export`
 * l'acceptait. `LIBELLE_DIMENSION` portait une entrée morte.
 *
 * Les modes de zone avaient le même défaut en plus discret (R-10) :
 * `/agregats` filtrait contre une liste blanche, `/export` passait la valeur
 * brute. Pour `?modes=xxx`, l'un répondait « les deux modes » et l'autre **un
 * classeur vide, sans message** — deux réponses différentes à la même question.
 */

/**
 * Les mailles d'agrégation, telles que la RPC les accepte (sql/195, sql/197).
 *
 * `commune` REGROUPE les arrondissements de Paris, Lyon et Marseille sous leur
 * commune mère ; `arrondissement` garde le détail brut. Ce sont deux valeurs de
 * dimension plutôt qu'un paramètre de plus — ce qui évite un `DROP` en base et
 * dit mieux la vérité.
 */
export const DIMENSIONS = [
  'region',
  'departement',
  'code_postal',
  'commune',
  'arrondissement',
] as const;

export type Dimension = (typeof DIMENSIONS)[number];

/**
 * Les mailles PROPOSÉES par l'interface.
 *
 * `arrondissement` en est absente à dessein : c'est un choix produit, pas une
 * limite technique. Les deux routes l'acceptent, et l'export y donne accès.
 * La distinction est explicite ici pour qu'on ne la reprenne pas pour un oubli.
 */
export const DIMENSIONS_PROPOSEES = [
  'region',
  'departement',
  'code_postal',
  'commune',
] as const satisfies readonly Dimension[];

/** Libellé lisible de chaque maille. Une seule table, pour l'écran et le classeur. */
export const LIBELLE_DIMENSION: Record<Dimension, string> = {
  region: 'Région',
  departement: 'Département',
  code_postal: 'Code postal',
  commune: 'Commune',
  arrondissement: 'Arrondissement',
};

/**
 * Origine de la zone retenue autour d'un site.
 *
 * `pprt` = la servitude publiée par l'État. `buffer` = un rayon que MAGELIAN a
 * choisi. Ce n'est pas un détail de calcul : le même nombre d'habitants ne vaut
 * pas la même chose selon l'origine de la zone, et le drapeau `indicatif`
 * remonte cette différence jusqu'à l'écran.
 */
export const MODES_ZONE = ['pprt', 'buffer'] as const;

export type ModeZone = (typeof MODES_ZONE)[number];

/**
 * Ne garde que les modes connus, ou `null` s'il n'en reste aucun.
 *
 * `null` et non `[]` : côté RPC, `null` signifie « les deux modes » alors qu'un
 * tableau vide signifierait « aucun », donc zéro site. Un mode mal orthographié
 * doit donc rendre le comportement par défaut, pas un résultat vide sans
 * explication.
 *
 * @param valeurs - Les modes demandés, éventuellement absents.
 * @returns Les modes reconnus, ou `null`.
 *
 * @example
 * modesValides(['pprt'])        // ['pprt']
 * modesValides(['xxx'])         // null — et non un classeur vide
 * modesValides(null)            // null
 */
export function modesValides(valeurs: string[] | null): ModeZone[] | null {
  if (!valeurs) return null;
  const gardes = valeurs.filter((m): m is ModeZone => (MODES_ZONE as readonly string[]).includes(m));
  return gardes.length > 0 ? gardes : null;
}
