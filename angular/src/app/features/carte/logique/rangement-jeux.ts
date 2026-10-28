/**
 * Le rangement de ② (spec § 4 ②, § 7.2 ; arbitrage A10) : « Données de l'espace » d'abord, puis « Données communes »
 * ouvertes sur la sélection recommandée de l'espace, le reste dans « Plus de données communes » (ruling contrôleur :
 * « Autres » ne désigne que le bouton hors fil). Rien n'est caché, tout est rangé. Une sélection qui ne désigne AUCUN
 * jeu commun présent (aucune, ou périmée) vaut « pas de sélection » : tout est déplié — jamais un bloc vide. Pur.
 *
 * Les jeux d'« Autres » (`JEUX_AUTRES` : panneaux OOH, radio — T11b) n'entrent jamais dans ② : seuls les 8
 * `JEUX_REFERENTIELS` et les types de POI y sont rangés — moins un référentiel dont aucun indicateur n'est visible de
 * l'espace, et « Données de l'espace » pour celui dont un indicateur lui est propre (A-7, lot « Catalogue et groupes »). Un type de POI passe par `cleJeuPoi`, comme la liste
 * recommandable d'Accès (T10, AT-10) : une catégorie dont la clé serait refusée par la base n'est pas un jeu.
 */
import { plierTexte } from '../../../core/format/texte';
import type { TypePoi } from '../etat/catalogue-poi.service';
import { CATEGORIES_HORS_POI, JEUX_REFERENTIELS, type JeuReferentiel, type NatureJeu, PREFIXE_POI, cleJeuPoi } from './jeux-carte';

export interface JeuAffichable {
  readonly cle: string;
  readonly nom: string;
  readonly nature: NatureJeu;
  readonly maille: string;
  readonly origine: 'espace' | 'commune';
}

export interface RangementJeux {
  readonly espace: readonly JeuAffichable[];
  readonly recommandes: readonly JeuAffichable[];
  /** Le repli « Plus de données communes (n) » ; vide quand il n'y a pas de sélection. */
  readonly autres: readonly JeuAffichable[];
  readonly sansSelection: boolean;
}

/** Ce que `jeuxDeLaCarte` lit d'une ligne du catalogue d'indicateurs (`GET /api/cibles/indicators`, A-6). */
export interface IndicateurVu {
  readonly indicator_code: string;
  readonly origine?: 'espace' | 'commune';
}

/**
 * Le rang d'un référentiel au vu des indicateurs VISIBLES de l'espace (A-7) : `null` s'il montre des indicateurs dont
 * aucun n'est visible (il n'a rien à montrer : la route ne servirait rien), `espace` si l'un d'eux est propre à l'espace,
 * sinon `commune`. Un référentiel sans `indicateurs`, ou un catalogue pas encore arrivé (`null`), reste commun : la
 * ligne ne clignote pas pendant la lecture.
 */
function origineReferentiel(j: JeuReferentiel, indicateurs: readonly IndicateurVu[] | null): 'espace' | 'commune' | null {
  if (j.indicateurs === undefined || indicateurs === null) return 'commune';
  const vus = indicateurs.filter((i) => j.indicateurs!.includes(i.indicator_code));
  if (vus.length === 0) return null;
  return vus.some((i) => i.origine === 'espace') ? 'espace' : 'commune';
}

/**
 * Les jeux de ② dans l'ordre d'affichage : POI de l'espace, référentiels propres à l'espace, référentiels communs, POI
 * communs. `indicateurs` : le catalogue d'indicateurs visibles (`CatalogueIndicateursService`), `null` tant qu'il n'est
 * pas arrivé.
 */
export function jeuxDeLaCarte(types: readonly TypePoi[], indicateurs: readonly IndicateurVu[] | null = null): JeuAffichable[] {
  const pois: JeuAffichable[] = [];
  for (const t of types) {
    if (CATEGORIES_HORS_POI.includes(t.id)) continue;
    const cle = cleJeuPoi(t.id);
    if (cle === null) continue;
    pois.push({ cle, nom: t.label, nature: 'poi', maille: 'point', origine: t.origine });
  }
  const referentiels: JeuAffichable[] = [];
  for (const j of JEUX_REFERENTIELS) {
    const origine = origineReferentiel(j, indicateurs);
    if (origine !== null) referentiels.push({ cle: j.cle, nom: j.nom, nature: j.nature, maille: j.maille, origine });
  }
  return [
    ...pois.filter((p) => p.origine === 'espace'),
    ...referentiels.filter((r) => r.origine === 'espace'),
    ...referentiels.filter((r) => r.origine === 'commune'),
    ...pois.filter((p) => p.origine === 'commune'),
  ];
}

/** Range les jeux selon la sélection recommandée ; un jeu de l'espace reste dans son bloc, recommandé ou non. */
export function rangerJeux(jeux: readonly JeuAffichable[], recommandes: readonly string[]): RangementJeux {
  const espace = jeux.filter((j) => j.origine === 'espace');
  const communs = jeux.filter((j) => j.origine === 'commune');
  const choisis = new Set(recommandes);
  const reco = communs.filter((j) => choisis.has(j.cle));
  if (reco.length === 0) return { espace, recommandes: communs, autres: [], sansSelection: true };
  return { espace, recommandes: reco, autres: communs.filter((j) => !choisis.has(j.cle)), sansSelection: false };
}

/**
 * Découpe une liste de jeux communs (recommandés, ou « Plus de données communes ») en référentiels et POI (retours du
 * 26/10, T6) : le panneau range les seconds dans un sous-groupe « POI communs ». Par la clé `poi:<catégorie>`
 * (`PREFIXE_POI`, celle que `jeuxDeLaCarte` donne à tout type de POI), jamais par une liste de catégories : tout type
 * importé depuis une source commune y entre seul. PAS par `nature === 'poi'`, comme l'écrivait le plan : deux
 * référentiels (« Arrêts de transport », « Sites industriels (ICPE) ») sont aussi de nature `poi`, et ils déplient
 * une section, ils ne se cochent pas. Ordre conservé. Pur.
 */
export function decouperCommuns(jeux: readonly JeuAffichable[]): { referentiels: JeuAffichable[]; pois: JeuAffichable[] } {
  return { referentiels: jeux.filter((j) => !estClePoi(j.cle)), pois: jeux.filter((j) => estClePoi(j.cle)) };
}

/**
 * Une clé de jeu est-elle celle d'un TYPE de POI (`poi:<catégorie>`) ? La seule écriture du prédicat : le panneau ②
 * s'en sert pour le mode « case » d'une ligne, `decouperCommuns` pour le sous-groupe (revue finale T8, m-4 de T6).
 */
export function estClePoi(cle: string): boolean {
  return cle.startsWith(PREFIXE_POI);
}

/** « Chercher un jeu par nom » (spec § 4 ②) : sans casse ni accents (`plierTexte`) ; une recherche vide rend tout. */
export function filtrerJeux(jeux: readonly JeuAffichable[], recherche: string): JeuAffichable[] {
  const q = plierTexte(recherche);
  return q === '' ? [...jeux] : jeux.filter((j) => plierTexte(j.nom).includes(q));
}
