/**
 * components/chat/classementAffichage.ts
 * Décision d'affichage de `ClassementCard` — extraite en fonction PURE, sans
 * React ni Recharts, pour être testée directement.
 *
 * Pourquoi : les 30 premiers tests de l'outil `classement_territoires`
 * testaient la fonction serveur isolément et n'ont jamais détecté que les
 * deux retours d'erreur ne posaient pas de champ `type` — donc que
 * `ClassementCard` retournait `null` (`output.type !== 'classement_territoires'`)
 * AVANT d'atteindre son propre affichage d'erreur. Un test de composant
 * aurait attrapé le bug ; le projet n'a pas de bibliothèque de test de
 * composant. Cette fonction est le point de passage unique entre « la sortie
 * brute de l'outil » et « ce qu'il faut montrer » : la tester revient à
 * tester ce qu'on aurait vu à l'écran.
 */

export interface IndicateurDisponible {
  key:   string;
  label: string;
}

export type ClasseIndicateurAffichage = 'effectif' | 'proportion' | 'densite';

export interface ResultatLigneAffichage {
  code:       string;
  nom:        string;
  population: number;
  valeur:     number;
  part:       number | null;
  classe:     ClasseIndicateurAffichage;
  lat:        number | null;
  lng:        number | null;
}

/** Forme (partielle, non validée) de ce que l'outil `classement_territoires` peut renvoyer. */
export interface SortieClassementBrute {
  type?:                                    string;
  error?:                                   string;
  indicateur?:                              string;
  indicateur_label?:                        string;
  indicateurs_disponibles?:                 IndicateurDisponible[];
  palier?:                                  'commune' | 'departement';
  palier_label?:                            string;
  tri?:                                     'volume' | 'part';
  classe?:                                  ClasseIndicateurAffichage | null;
  plancher_population?:                     number;
  plancher_population_applique_par_defaut?: boolean;
  regrouper_arrondissements?:               boolean;
  limite?:                                  number;
  resultats?:                               ResultatLigneAffichage[];
}

export type DecisionAffichageClassement =
  /** Pas une sortie de cet outil (autre outil, message en cours de streaming…) — ne rien rendre. */
  | { mode: 'rien' }
  /** Une des RAISE EXCEPTION de sql/150, ou une garde de l'outil (indicateur manquant). */
  | {
      mode:              'erreur';
      message:           string;
      indicateurDemande: string | null;
      suggestions:       IndicateurDisponible[];
    }
  /** La RPC a répondu, zéro territoire ne passe le plancher — jamais un écran vide muet. */
  | {
      mode:               'vide';
      indicateurLabel:    string;
      palierLabel:        string;
      plancherPopulation: number;
      plancherParDefaut:  boolean;
    }
  /** Au moins un résultat — tout ce qu'il faut pour le tableau + l'histogramme. */
  | {
      mode:                       'resultats';
      indicateur:                 string;
      indicateurLabel:            string;
      palier:                     'commune' | 'departement';
      palierLabel:                string;
      tri:                        'volume' | 'part';
      classe:                     ClasseIndicateurAffichage;
      plancherPopulation:         number;
      plancherParDefaut:          boolean;
      regrouperArrondissements:   boolean;
      resultats:                  ResultatLigneAffichage[];
    };

/**
 * Décide quoi rendre pour une sortie donnée. Ne fait AUCUNE hypothèse sur la
 * présence du champ `type` pour détecter une erreur : un objet qui porte un
 * `error` est traité comme une erreur de cet outil quel que soit son `type`
 * (absent ou non) — c'est précisément la garde qui manquait avant ce correctif
 * (`ClassementCard.tsx` rendait `null` en silence).
 */
export function decisionAffichageClassement(output: unknown): DecisionAffichageClassement {
  if (!output || typeof output !== 'object') return { mode: 'rien' };
  const data = output as SortieClassementBrute;

  const estCetOutil = data.type === 'classement_territoires' || typeof data.error === 'string';
  if (!estCetOutil) return { mode: 'rien' };

  if (typeof data.error === 'string') {
    return {
      mode:              'erreur',
      message:           data.error,
      indicateurDemande: data.indicateur ?? null,
      suggestions:       data.indicateurs_disponibles ?? [],
    };
  }

  const resultats = data.resultats ?? [];
  if (resultats.length === 0) {
    return {
      mode:               'vide',
      indicateurLabel:    data.indicateur_label ?? data.indicateur ?? '',
      palierLabel:        data.palier_label ?? 'communes',
      plancherPopulation: data.plancher_population ?? 0,
      plancherParDefaut:  data.plancher_population_applique_par_defaut ?? false,
    };
  }

  return {
    mode:                     'resultats',
    indicateur:               data.indicateur ?? '',
    indicateurLabel:          data.indicateur_label ?? data.indicateur ?? '',
    palier:                   data.palier ?? 'commune',
    palierLabel:              data.palier_label ?? 'communes',
    tri:                      data.tri ?? 'volume',
    classe:                   data.classe ?? resultats[0].classe,
    plancherPopulation:       data.plancher_population ?? 0,
    plancherParDefaut:        data.plancher_population_applique_par_defaut ?? false,
    regrouperArrondissements: data.regrouper_arrondissements ?? false,
    resultats,
  };
}
