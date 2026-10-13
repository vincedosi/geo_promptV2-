/**
 * @file lib/carte/jeux-carte.ts — le registre des jeux de la carte (spec carte-en-parcours § 4 ②, § 7 ; arbitrage A10).
 *
 * Un « jeu » est ce qu'on allume à l'étape ② : un référentiel commun (ci-dessous, statique) ou un type de POI
 * (`poi:<categorie>`, dont l'origine espace/commune vient de `GET /api/map/categories`). Sa clé `famille:nom` est celle
 * de la sélection recommandée (`espace_jeux_recommandes.cle_jeu`, sql/251) : `RE_CLE_JEU` est EXACTEMENT le CHECK de
 * la table (tests/unit/carte/jeux-carte.test.ts).
 *
 * Les référentiels sont tous COMMUNS jusqu'au catalogue (lot 8), qui rendra un indicateur privable.
 * Copie Angular : angular/src/app/features/carte/logique/jeux-carte.ts (parité verrouillée).
 */
export type NatureJeu = 'poi' | 'carreau' | 'indicateur_iris' | 'indicateur_cp' | 'ligne' | 'polygone' | 'a_la_demande';

export interface JeuReferentiel {
  readonly cle: string;
  readonly nom: string;
  readonly nature: NatureJeu;
  readonly maille: string;
}

/** Les référentiels communs, dans l'ordre d'affichage de ② (maquette du 2026-10-13). */
export const JEUX_REFERENTIELS: readonly JeuReferentiel[] = [
  { cle: 'iris:socio-demo', nom: 'IRIS socio-démographie (Filosofi)', nature: 'indicateur_iris', maille: 'IRIS' },
  { cle: 'carreaux:filosofi', nom: 'Carreaux Filosofi', nature: 'carreau', maille: 'carreau 200 m à 20 km' },
  { cle: 'civique:indicateurs-cp', nom: 'Indicateurs au code postal', nature: 'indicateur_cp', maille: 'code postal' },
  { cle: 'transport:arrets', nom: 'Arrêts de transport en commun', nature: 'poi', maille: 'point' },
  { cle: 'ooh:panneaux', nom: 'Panneaux OOH et DOOH', nature: 'poi', maille: 'point' },
  { cle: 'radio:emetteurs', nom: 'Émetteurs radio FM / DAB+', nature: 'poi', maille: 'point' },
  { cle: 'tmja:comptages', nom: 'Flux routier (TMJA)', nature: 'ligne', maille: 'tronçon' },
  { cle: 'risques:icpe-pprt', nom: 'Sites industriels (ICPE) et périmètres PPRT', nature: 'poi', maille: 'point et polygone' },
  { cle: 'sante:air-pollen', nom: 'Santé environnementale (air, pollen)', nature: 'indicateur_cp', maille: 'département, code postal' },
  { cle: 'meteo:zones', nom: 'Météo', nature: 'a_la_demande', maille: 'zone' },
];

export const LIBELLE_NATURE: Readonly<Record<NatureJeu, string>> = {
  poi: 'POI', carreau: 'Carreau', indicateur_iris: 'Indicateur IRIS', indicateur_cp: 'Indicateur',
  ligne: 'Ligne', polygone: 'Polygone', a_la_demande: 'À la demande',
};

export const PREFIXE_POI = 'poi:';
/** Catégories de POI rangées dans un AUTRE jeu (les sites ICPE vivent dans `risques:icpe-pprt` jusqu'au lot 4). */
export const CATEGORIES_HORS_POI: readonly string[] = ['risque_industriel'];
/** La forme d'une clé — le CHECK de `espace_jeux_recommandes.cle_jeu` (sql/251). */
export const RE_CLE_JEU = /^[a-z]+:[a-z0-9_-]{1,64}$/;
/** La borne de la RPC `remplacer_jeux_recommandes` (sql/251). */
export const MAX_JEUX_RECOMMANDES = 200;

/** La clé d'un type de POI, ou `null` si la catégorie ne donnerait pas une clé conforme (elle n'est alors pas recommandable). */
export function cleJeuPoi(categorie: string): string | null {
  const cle = `${PREFIXE_POI}${categorie}`;
  return RE_CLE_JEU.test(cle) ? cle : null;
}

/** Une clé que la carte sait afficher : un référentiel, ou un type de POI hors catégories rangées ailleurs. */
export function estCleJeuConnue(cle: string): boolean {
  if (!RE_CLE_JEU.test(cle)) return false;
  if (JEUX_REFERENTIELS.some((j) => j.cle === cle)) return true;
  return cle.startsWith(PREFIXE_POI) && !CATEGORIES_HORS_POI.includes(cle.slice(PREFIXE_POI.length));
}

/** Une ligne du bloc « Sélection recommandée » d'Accès. */
export interface JeuRecommandable extends JeuReferentiel {
  readonly recommande: boolean;
}

/** `GET /api/admin/espaces/[id]/jeux-recommandes`. */
export interface ReponseJeuxRecommandables {
  jeux: JeuRecommandable[];
}
