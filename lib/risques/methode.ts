/**
 * Ce que les chiffres de population exposée veulent dire, et ce qu'ils ne
 * disent PAS.
 *
 * ── POURQUOI CE TEXTE EST DU CODE ─────────────────────────────────────────
 *
 * Il était rédigé DEUX fois, et différemment : vingt lignes en dur dans
 * `app/api/risques/exposition/export/route.ts`, et une version plus courte dans
 * `components/risques/AnalysePopulationOverlay.tsx` (constat R-23 de
 * `docs/AUDIT_ZONE_RISQUE.md`). Corriger une phrase imposait de toucher une
 * route API, et rien ne garantissait que les deux disent la même chose.
 *
 * ── POURQUOI IL COMPTE AUTANT QUE LE CALCUL ───────────────────────────────
 *
 * Un tableur QUITTE l'application. Tout ce que l'interface explique disparaît
 * à l'export — et le premier lecteur qui somme la colonne « sites » obtient un
 * total faux sans aucun moyen de le savoir. C'est pourquoi le classeur porte un
 * onglet « Méthode et limites » : il voyage avec le fichier.
 *
 * ⚠ Si un refactor déplace un jour l'export vers une génération côté client,
 * cet onglet doit partir avec.
 */

/** Une précaution de lecture : son titre, et ce qu'elle dit. */
export interface NoteMethode {
  titre: string;
  texte: string;
}

/** Comment le chiffre est obtenu — la mécanique, pas les limites. */
export const METHODE_CALCUL = {
  /** La zone retenue dépend de si le rayon est imposé à tous les sites. */
  zone(rayonForce: boolean): string {
    return rayonForce
      ? 'Un cercle du rayon choisi autour de CHAQUE site. Aucun chiffre ne provient d’une zone publiée par l’État.'
      : 'Le périmètre PPRT publié par l’État quand le site en a un (rattachement à 500 m), sinon un cercle du rayon indiqué.';
  },
  population:
    'Carreaux INSEE de 200 m (Filosofi), répartis au prorata de surface : un carreau dont 30 % tombe dans la zone contribue 30 % de ses habitants. '
    + 'Hypothèse d’une population uniforme dans le carreau — fausse au détail, raisonnable en agrégat.',
  doubleComptage:
    'Les zones qui se recouvrent sont UNIES avant comptage : un habitant proche de deux sites n’est compté qu’une fois. '
    + 'Sans cette union, l’écart mesuré atteint +62 % sur un département dense.',
} as const;

/**
 * Ce que les chiffres ne disent PAS.
 *
 * Chacune de ces notes existe parce qu'un lecteur pouvait conclure faux sans
 * elle — et la première, sur la colonne « sites », est celle qui produit le
 * total faux le plus facile à obtenir.
 */
export const LIMITES: readonly NoteMethode[] = [
  {
    titre: 'La colonne « Sites »',
    texte:
      'Elle ne s’additionne PAS avec la population. Elle compte les sites IMPLANTÉS dans l’unité ; '
      + 'une commune peut être très exposée sans en porter aucun, quand c’est la zone d’un site voisin qui déborde chez elle.',
  },
  {
    titre: '« dont rayon calculé »',
    texte:
      'Ces sites n’ont AUCUN périmètre publié par l’État : leur zone est un cercle que nous avons choisi. '
      + 'Le chiffre est indicatif, pas réglementaire.',
  },
  {
    titre: 'Outre-mer',
    texte:
      'CALCULABLE pour la Martinique et La Réunion : l’INSEE publie leur carroyage 200 m dans le même fichier que la métropole, '
      + 'et il est en base depuis le 18/09/2026 (26 022 carreaux, 1 190 910 habitants). Leurs 14 sites Seveso et 26 périmètres PPRT sont donc comptés. '
      + 'NON CALCULABLE pour la Guadeloupe, la Guyane et Mayotte, que l’INSEE ne carroye pas : leurs 603 sites, dont 31 Seveso — les 27 de Guyane compris — '
      + 'n’ont aucune population exposée calculable et n’entrent pas dans le total. '
      + 'Un site y apparaît sans chiffre : c’est une donnée absente à la source, pas une exposition nulle.',
  },
  {
    titre: 'Part et densité au code postal',
    texte:
      'Absentes à cette maille, et c’est délibéré : le seul référentiel de population par code postal disponible surcompte de 10,5 % '
      + 'la population française, et est vide sur Paris et les DROM. Une colonne vide vaut mieux qu’un pourcentage faux.',
  },
  {
    titre: 'Paris, Lyon, Marseille',
    texte:
      'À la maille Commune, leurs arrondissements sont REGROUPÉS sous la commune mère. À la maille Arrondissement, ils sont détaillés. '
      + 'Ce sont les trois seules communes françaises concernées.',
  },
];

/** D'où vient chaque donnée. Un chiffre sans source ne se vérifie pas. */
export const SOURCES: readonly NoteMethode[] = [
  {
    titre: 'Sites à risque',
    texte: 'Géorisques (ministère de la Transition écologique), API installations classées.',
  },
  {
    titre: 'Périmètres PPRT',
    texte: 'Géoplateforme IGN, servitudes d’utilité publique PM3 — 664 périmètres.',
  },
  { titre: 'Population', texte: 'INSEE Filosofi, carroyage 200 m, millésime 2021.' },
  {
    titre: 'Dénominateurs',
    texte: 'INSEE IRIS agrégés — 67 760 552 habitants, soit 100,0 % du chiffre national.',
  },
];
