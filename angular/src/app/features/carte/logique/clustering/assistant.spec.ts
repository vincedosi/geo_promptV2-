import type { RegionRef } from '../../etat/referentiel-geo.service';
import {
  avisVariables, basculer, basculerTheme, corpsLancement, departementsChoisis, dureeEnCours, dureeSaisie, etatTheme, libellePerimetre,
  libelleRegionsChoisies, libelleTypesChoisis, messageFinJob, peutLancer, prereglageActif, regionsProposees, variablesDuPrereglage,
} from './assistant';
import { ALL_FEATURES } from './feature-themes';

const REGIONS: RegionRef[] = [
  { code_region: '32', nom_region: 'Hauts-de-France', depts: [{ code_dept: '59', nom_dept: 'Nord' }, { code_dept: '62', nom_dept: 'Pas-de-Calais' }] },
  { code_region: '04', nom_region: 'La Réunion', depts: [{ code_dept: '974', nom_dept: 'La Réunion' }] },
];

describe('logique de l’assistant de clustering (ClusteringWizard.tsx)', () => {
  it('régions proposées : les DROM masquées en « métropolitaine uniquement »', () => {
    expect(regionsProposees(REGIONS, true).map((r) => r.code_region)).toEqual(['32']);
    expect(regionsProposees(REGIONS, false)).toHaveLength(2);
  });

  it('départements des régions choisies : aucun sans région ; DROM retirés en métropole', () => {
    expect(departementsChoisis(REGIONS, [], true)).toEqual([]);
    expect(departementsChoisis(REGIONS, ['32', '04'], true)).toEqual(['59', '62']);
    expect(departementsChoisis(REGIONS, ['32', '04'], false)).toEqual(['59', '62', '974']);
  });

  it('corps du lancement : la forme exacte de React, `features` à null quand toutes les variables sont retenues', () => {
    const base = { types: ['bmw'], metropolitaine: true, regions: ['32'], depts: ['59', '62'], duree: 15, transport: 'drive' as const, dryRun: false };
    expect(corpsLancement({ ...base, variables: ALL_FEATURES })).toEqual({
      poi_types: ['bmw'],
      geo_filter: { metropolitaine: true, regions: ['32'], depts: ['59', '62'] },
      params: { duration: 15, transport: 'drive', dry_run: false },
      features: null,
    });
    expect(corpsLancement({ ...base, variables: ['pct_0_17', 'revenu_moyen'] }).features).toEqual(['pct_0_17', 'revenu_moyen']);
  });

  it('peutLancer : un type, une durée bornée, deux variables, rien en cours', () => {
    const ok = { types: 1, duree: 60, variables: 16, enCours: false };
    expect(peutLancer(ok)).toBe(true);
    expect(peutLancer({ ...ok, types: 0 })).toBe(false);
    expect(peutLancer({ ...ok, variables: 1 })).toBe(false);
    expect(peutLancer({ ...ok, enCours: true })).toBe(false);
    expect(peutLancer({ ...ok, duree: 121 })).toBe(false);
  });

  it('saisie de la durée bornée à [5, 120], illisible → null', () => {
    expect(dureeSaisie('3')).toBe(5);
    expect(dureeSaisie('200')).toBe(120);
    expect(dureeSaisie('45')).toBe(45);
    expect(dureeSaisie('')).toBeNull();
  });

  it('préréglages et thématiques', () => {
    expect(variablesDuPrereglage('socio_demo')).toHaveLength(7);
    expect(prereglageActif('all', ALL_FEATURES)).toBe(true);
    expect(prereglageActif('socio_demo', ALL_FEATURES)).toBe(false);
    expect(etatTheme('revenus', ['revenu_moyen'])).toEqual({ cochees: 1, total: 2, toutes: false, aucune: false });
    expect(basculerTheme('revenus', ['revenu_moyen', 'pct_0_17'])).toEqual(['pct_0_17', 'revenu_moyen', 'taux_pauvrete']);
    expect(basculerTheme('revenus', ['taux_pauvrete', 'revenu_moyen'])).toEqual([]);
    expect(basculer(['a', 'b'], 'a')).toEqual(['b']);
    expect(basculer(['a'], 'b')).toEqual(['a', 'b']);
  });

  it('avis sur les variables : erreur sous 2, alerte sous 5, résumé au-delà', () => {
    expect(avisVariables(['a'])).toEqual({ niveau: 'erreur', texte: '! Minimum 2 variables requises' });
    expect(avisVariables(['a', 'b'])).toEqual({ niveau: 'alerte', texte: '! Peu de variables — clusters moins discriminants' });
    expect(avisVariables(ALL_FEATURES)).toEqual({ niveau: 'info', texte: 'Toutes les variables (16)' });
  });

  it('libellés', () => {
    expect(libellePerimetre(true, 0)).toBe('France métro');
    expect(libellePerimetre(false, 2)).toBe('France entière — 2 région(s)');
    expect(libelleTypesChoisis(1)).toBe('1 type sélectionné');
    expect(libelleTypesChoisis(2)).toBe('2 types sélectionnés');
    expect(libelleRegionsChoisies(1, 5)).toBe('1 région — 5 départements');
  });

  it('frappe en cours : retenue seulement DANS les bornes, jamais bornée', () => {
    expect(dureeEnCours('1')).toBeNull();
    expect(dureeEnCours('12')).toBe(12);
    expect(dureeEnCours('120')).toBe(120);
    expect(dureeEnCours('200')).toBeNull();
    expect(dureeEnCours('')).toBeNull();
    expect(dureeEnCours('7.5')).toBeNull();
  });

  it('message de fin : ce que le job a réellement fait', () => {
    const corps = corpsLancement({ types: ['bmw'], metropolitaine: true, regions: [], depts: [], duree: 15, transport: 'drive', dryRun: false, variables: ALL_FEATURES });
    expect(messageFinJob(corps)).toEqual({ texte: '✓ Isochrones mis en cache.', commande: true });
    expect(messageFinJob({ ...corps, features: ['pct_0_17', 'revenu_moyen'] })).toEqual({
      texte: '✓ Isochrones mis en cache et modèle entraîné sur la sélection de variables.', commande: false,
    });
    expect(messageFinJob({ ...corps, params: { ...corps.params, dry_run: true } }).texte).toBe('✓ Simulation terminée — aucune écriture en base.');
  });
});
