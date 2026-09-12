import { describe, it, expect } from 'vitest';
import { decisionAffichageClassement } from '@/components/chat/classementAffichage';

/**
 * Cette fonction est le point de passage unique entre la sortie brute de
 * l'outil `classement_territoires` et ce que `ClassementCard` doit rendre.
 * C'est la fonction qui aurait attrapé le bug de la revue : les deux retours
 * d'erreur de `classementTerritoires.ts` ne posaient pas de champ `type`, donc
 * `ClassementCard` retournait `null` avant même d'atteindre son propre
 * affichage d'erreur (garde `output.type !== 'classement_territoires'`).
 */

describe('decisionAffichageClassement — mode rien', () => {
  it('rend "rien" pour une sortie absente', () => {
    expect(decisionAffichageClassement(undefined)).toEqual({ mode: 'rien' });
    expect(decisionAffichageClassement(null)).toEqual({ mode: 'rien' });
  });

  it('rend "rien" pour la sortie d\'un autre outil', () => {
    expect(decisionAffichageClassement({ type: 'analyse_complete', demographie: {} })).toEqual({ mode: 'rien' });
  });

  it('rend "rien" pour une valeur qui n\'est pas un objet', () => {
    expect(decisionAffichageClassement('texte')).toEqual({ mode: 'rien' });
    expect(decisionAffichageClassement(42)).toEqual({ mode: 'rien' });
  });
});

describe('decisionAffichageClassement — mode erreur (le bug de la revue)', () => {
  it('reconnaît une erreur MÊME SANS champ `type` — c\'est exactement le défaut corrigé', () => {
    // Avant le correctif, classementTerritoires.ts ne posait pas `type` sur
    // ses retours d'erreur. Cette fonction doit rester robuste à cette classe
    // de régression : un objet avec `error` est une erreur de cet outil,
    // `type` ou pas.
    const decision = decisionAffichageClassement({ error: 'Indicateur requis pour classer les territoires.' });
    expect(decision.mode).toBe('erreur');
  });

  it('reconnaît une erreur avec le type désormais posé (comportement nominal actuel)', () => {
    const decision = decisionAffichageClassement({
      type: 'classement_territoires',
      error: "Cet indicateur n'existe pas.",
      indicateur: 'bidon',
      indicateurs_disponibles: [{ key: 'population', label: 'Population totale' }],
    });
    expect(decision).toEqual({
      mode:              'erreur',
      message:           "Cet indicateur n'existe pas.",
      indicateurDemande: 'bidon',
      suggestions:       [{ key: 'population', label: 'Population totale' }],
    });
  });

  it('rend une liste de suggestions vide plutôt que undefined quand elle est absente', () => {
    const decision = decisionAffichageClassement({ error: 'x' });
    expect(decision.mode).toBe('erreur');
    if (decision.mode === 'erreur') {
      expect(decision.suggestions).toEqual([]);
      expect(decision.indicateurDemande).toBeNull();
    }
  });
});

describe('decisionAffichageClassement — mode vide (zéro résultat)', () => {
  it('rend "vide" avec le contexte (indicateur, palier, plancher) quand resultats est un tableau vide', () => {
    const decision = decisionAffichageClassement({
      type: 'classement_territoires',
      indicateur: 'pop_15_29',
      indicateur_label: 'Pop 15–29 ans',
      palier_label: 'départements',
      plancher_population: 900_000,
      plancher_population_applique_par_defaut: false,
      resultats: [],
    });
    expect(decision).toEqual({
      mode:               'vide',
      indicateurLabel:    'Pop 15–29 ans',
      palierLabel:        'départements',
      plancherPopulation: 900_000,
      plancherParDefaut:  false,
    });
  });

  it('rend "vide" quand resultats est absent (jamais un crash)', () => {
    const decision = decisionAffichageClassement({ type: 'classement_territoires', indicateur: 'population' });
    expect(decision.mode).toBe('vide');
  });
});

describe('decisionAffichageClassement — mode resultats', () => {
  const sortieValide = {
    type:                                     'classement_territoires',
    indicateur:                               'pop_15_29',
    indicateur_label:                         'Pop 15–29 ans',
    palier:                                   'commune' as const,
    palier_label:                             'communes',
    tri:                                      'volume' as const,
    classe:                                   'effectif' as const,
    plancher_population:                      0,
    plancher_population_applique_par_defaut:  false,
    regrouper_arrondissements:                true,
    limite:                                   10,
    resultats: [
      { code: '75056', nom: 'Paris', population: 2_113_697, valeur: 513_373, part: 24.3, classe: 'effectif' as const, lat: 48.86, lng: 2.34 },
    ],
  };

  it('transmet tout le contexte nécessaire au rendu', () => {
    const decision = decisionAffichageClassement(sortieValide);
    expect(decision.mode).toBe('resultats');
    if (decision.mode !== 'resultats') throw new Error('mode inattendu');
    expect(decision.indicateurLabel).toBe('Pop 15–29 ans');
    expect(decision.indicateur).toBe('pop_15_29');
    expect(decision.palierLabel).toBe('communes');
    expect(decision.tri).toBe('volume');
    expect(decision.classe).toBe('effectif');
    expect(decision.regrouperArrondissements).toBe(true);
    expect(decision.resultats).toHaveLength(1);
  });

  it("affiche le libellé exact de l'indicateur réellement interrogé — jamais celui que la prose du modèle pourrait suggérer", () => {
    // Le piège des tranches d'âge (15-24 n'existe pas, la donnée est 15-29) ne
    // doit reposer sur AUCUNE reformulation du modèle : le libellé structurel
    // rendu par cette fonction vient uniquement de la donnée.
    const decision = decisionAffichageClassement(sortieValide);
    if (decision.mode !== 'resultats') throw new Error('mode inattendu');
    expect(decision.indicateurLabel).toBe('Pop 15–29 ans');
    expect(decision.indicateurLabel).not.toContain('15-24');
  });

  it('retombe sur la clé brute si indicateur_label est absent — jamais un label inventé', () => {
    const { indicateur_label: _sansLabel, ...sansLabel } = sortieValide;
    const decision = decisionAffichageClassement(sansLabel);
    if (decision.mode !== 'resultats') throw new Error('mode inattendu');
    expect(decision.indicateurLabel).toBe('pop_15_29');
  });

  it("retombe sur la classe de la première ligne si `classe` est absent au niveau racine", () => {
    const { classe: _sansClasse, ...sansClasse } = sortieValide;
    const decision = decisionAffichageClassement(sansClasse);
    if (decision.mode !== 'resultats') throw new Error('mode inattendu');
    expect(decision.classe).toBe('effectif');
  });
});
