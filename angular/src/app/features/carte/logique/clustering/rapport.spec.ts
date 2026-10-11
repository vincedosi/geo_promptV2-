import {
  dateLongue, ecartsFrance, etapesMethodologie, formaterValeur, imputesParCluster, jetonEcart, jetonIndex, libelleSilhouette,
  lignesModele, lignesTableauProfils, poisParCluster, profilReference, revenusIndex, themesBadge, variables,
} from './rapport';
import type { DetailModele, MoyennesFrance, PoiModele, ResumeCluster } from './types';

const MODELE: DetailModele = {
  version: 3, k: 4, silhouette_score: 0.2992347391058109, n_pca_components: 5, variance_explained: 0.8612,
  feature_names: ['pct_0_17', 'revenu_moyen', 'surface_moyenne'], feature_themes: ['demographie', 'revenus', 'logement', 'menages'],
  cluster_labels: { '0': 'Seniors actifs / Proprietaires' }, cluster_avg_profiles: {}, n_poi_trained: 95,
  duration_minutes: 15, mode: 'drive', created_at: '2026-09-12T09:52:55.448365+00:00', cluster_mapping_from_previous: null,
};
const FRANCE: MoyennesFrance = {
  pct_0_17: { avg: 0.2, std: 0, min: 0, max: 1, n_carreaux: 1 },
  revenu_moyen: { avg: 1.25, std: 0, min: 0, max: 3, n_carreaux: 1 },
};
const poi = (id: string, cid: number, imputes: string[] = []): PoiModele => ({
  poi_id: id, poi_name: id, categorie: '', ville: '', cluster_id: cid, cluster_label: '', cluster_color: '#4e79a7',
  profile_features: {}, pca_components: [0.1, -0.2], imputed_features: imputes, duration_minutes: 15, mode: 'drive',
});
const resume = (avg: Record<string, number>): ResumeCluster => ({ label: 'L', count: 1, color: '#4e79a7', avg_profile: avg });

describe('logique du rapport d’un modèle (ClusterDetails.tsx)', () => {
  it('revenusIndex : val / moyenne × 100 arrondi ; null sans moyenne ; jeton ≥ 110 / ≤ 90', () => {
    expect(revenusIndex(1.5, 1.25)).toBe(120);
    expect(revenusIndex(1, 0)).toBeNull();
    expect([110, 100, 90].map(jetonIndex)).toEqual(['success', 'warning', 'danger']);
  });

  it('formaterValeur : surface en m², le reste en pourcentage', () => {
    expect(formaterValeur('surface_moyenne', 103.44)).toBe('103.4 m²');
    expect(formaterValeur('pct_0_17', 0.2016)).toBe('20.2%');
  });

  it('variables : celles du modèle, à défaut les 16 de FEAT_SHORT', () => {
    expect(variables(MODELE)).toEqual(MODELE.feature_names);
    expect(variables({ ...MODELE, feature_names: [] })).toHaveLength(16);
  });

  it('profilReference : la moyenne de chaque variable ; undefined sans moyennes', () => {
    expect(profilReference(FRANCE)).toEqual({ pct_0_17: 0.2, revenu_moyen: 1.25 });
    expect(profilReference(null)).toBeUndefined();
  });

  it('lignesModele : le panneau « Modèle vN » du résumé, valeurs de React', () => {
    expect(lignesModele(MODELE)).toEqual([
      ['Clusters (K)', '4'], ['Silhouette', '0.2992'], ['Variables', 'Personnalisé (3 vars)'], ['PCA composantes', '5'],
      ['Variance expliquée', '86.1%'], ['POI entraînés', '95'], ['Isochrone', '15 min drive'], ['Créé le', '12 septembre 2026'],
    ]);
    expect(dateLongue('2026-09-12T09:52:55Z')).toBe('12 septembre 2026');
  });

  it('libelleSilhouette : Excellent ≥ 0,5, Bon ≥ 0,3, Faible', () => {
    expect([0.6, 0.31, 0.29].map(libelleSilhouette)).toEqual(['Excellent', 'Bon', 'Faible']);
  });

  it('themesBadge : seulement entre 1 et 3 thématiques, libellés joints par « + »', () => {
    expect(themesBadge(MODELE.feature_themes)).toBeNull();
    expect(themesBadge(['demographie', 'revenus'])).toBe('Démographie + Revenus & Précarité');
    expect(themesBadge(null)).toBeNull();
  });

  it('imputesParCluster et poisParCluster', () => {
    const pois = [poi('a', 0, ['x']), poi('b', 2), poi('c', 0, ['y', 'z'])];
    expect(imputesParCluster(pois)).toEqual({ '0': 2 });
    expect(poisParCluster(pois).map(([cid, l]) => [cid, l.map((p) => p.poi_id)])).toEqual([[0, ['a', 'c']], [2, ['b']]]);
  });

  it('ecartsFrance : écart du cluster à la moyenne nationale, arrondi à 4 décimales', () => {
    expect(ecartsFrance(resume({ pct_0_17: 0.25 }), ['pct_0_17', 'revenu_moyen'], FRANCE)).toEqual([
      { variable: '0-17', ecart: 0.05 }, { variable: 'Revenu', ecart: -1.25 },
    ]);
  });

  it('jetonEcart : au-delà de ±0,02 succès / danger, sinon le texte', () => {
    expect([0.03, -0.03, 0.01].map(jetonEcart)).toEqual(['success', 'danger', 'text-primary']);
  });

  it('lignesTableauProfils : barre relative au maximum (France comprise), repère France, index de revenu', () => {
    const summary = { '0': resume({ revenu_moyen: 1.5 }), '1': resume({ revenu_moyen: 1 }) };
    const [ligne] = lignesTableauProfils(['revenu_moyen'], ['0', '1'], summary, FRANCE);
    expect(ligne.libelle).toBe('Revenu');
    expect(ligne.valeurs.map((v) => [v.largeur, v.texte, v.index])).toEqual([[100, '150.0%', 120], [(1 / 1.5) * 100, '100.0%', 80]]);
    expect(ligne.repereFrance).toBeCloseTo((1.25 / 1.5) * 100);
    expect(ligne.texteFrance).toBe('125.0%');
  });

  it('etapesMethodologie : six étapes, chiffres du modèle', () => {
    const e = etapesMethodologie(MODELE);
    expect(e).toHaveLength(6);
    expect(e[3].detail).toBe('PCA avec seuil de variance 85%. Résultat : 5 composantes → 86.1% de variance expliquée.');
    expect(e[4].detail).toContain('K retenu : 4. Score final : 0.2992.');
    expect(e[5].detail).toBe('pct_0_17, revenu_moyen, surface_moyenne');
  });
});
