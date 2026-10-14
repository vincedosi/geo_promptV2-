/**
 * Le rangement de ② (spec § 4 ②, § 7.2 ; arbitrage A10) : « Données de l'espace » d'abord, puis « Données communes »
 * ouvertes sur la sélection recommandée de l'espace, le reste dans « Plus de données communes » (ruling contrôleur :
 * « Autres » ne désigne que le bouton hors fil). Rien n'est caché, tout est rangé. Une sélection qui ne désigne AUCUN
 * jeu commun présent (aucune, ou périmée) vaut « pas de sélection » : tout est déplié — jamais un bloc vide. Pur.
 *
 * Les jeux d'« Autres » (`JEUX_AUTRES` : panneaux OOH, radio — T11b) n'entrent jamais dans ② : seuls les 8
 * `JEUX_REFERENTIELS` et les types de POI y sont rangés. Un type de POI passe par `cleJeuPoi`, comme la liste
 * recommandable d'Accès (T10, AT-10) : une catégorie dont la clé serait refusée par la base n'est pas un jeu.
 */
import type { TypePoi } from '../etat/catalogue-poi.service';
import { CATEGORIES_HORS_POI, JEUX_REFERENTIELS, type NatureJeu, cleJeuPoi } from './jeux-carte';

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

/** Les jeux de ② dans l'ordre d'affichage : POI de l'espace, référentiels communs, POI communs. */
export function jeuxDeLaCarte(types: readonly TypePoi[]): JeuAffichable[] {
  const pois: JeuAffichable[] = [];
  for (const t of types) {
    if (CATEGORIES_HORS_POI.includes(t.id)) continue;
    const cle = cleJeuPoi(t.id);
    if (cle === null) continue;
    pois.push({ cle, nom: t.label, nature: 'poi', maille: 'point', origine: t.origine });
  }
  return [
    ...pois.filter((p) => p.origine === 'espace'),
    ...JEUX_REFERENTIELS.map((j): JeuAffichable => ({ ...j, origine: 'commune' })),
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

/** Sans casse ni accents (diacritiques combinants U+0300–U+036F retirés après décomposition). */
const plier = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** « Chercher un jeu par nom » (spec § 4 ②) : sans casse ni accents ; une recherche vide rend tout. */
export function filtrerJeux(jeux: readonly JeuAffichable[], recherche: string): JeuAffichable[] {
  const q = plier(recherche);
  return q === '' ? [...jeux] : jeux.filter((j) => plier(j.nom).includes(q));
}
