import type { ClustersGeoJSON, PoiCluster, ResumeCluster } from './types';
import {
  basculerDuree, clustersTries, comparaisonDurees, couleurBadge, dateCourte, deltasComparaison, emprise,
  etiquetteRadarCluster, jetonSilhouette, lignesPoi, messageAucunModele, poiDepuisClic, pourcent1, profilsParDuree,
} from './panneau';

const resume = (label: string, color: string, avg: Record<string, number> = {}): ResumeCluster => ({ label, count: 0, color, avg_profile: avg });
const SUMMARY: Record<string, ResumeCluster> = {
  '10': resume('Dix', '#bab0ac'), '2': resume('Deux / suite', '#59a14f'), '0': resume('Zéro', '#4e79a7'),
};
const entite = (id: string, cid: number, lng: number, lat: number) => ({
  type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [lng, lat] as [number, number] },
  properties: { poi_id: id, poi_name: `POI ${id}`, cluster_id: cid, cluster_label: `L${cid}`, cluster_color: '#4e79a7', categorie: 'cirfa', ville: 'Lyon' },
});
const GEO: ClustersGeoJSON = {
  type: 'FeatureCollection',
  features: [entite('a', 0, 2, 45), entite('b', 2, 5, 43), entite('c', 0, 4, 48)],
  metadata: {
    model_version: 3, k: 3, silhouette_score: 0.3, n_pca_components: 4, variance_explained: 0.86, duration_minutes: 15,
    mode: 'drive', created_at: '2026-09-12T09:52:55Z', cluster_summary: SUMMARY, feature_names: [],
  },
};

describe('logique du panneau de clusters (ClusterPanel.tsx)', () => {
  it('clustersTries : par identifiant NUMÉRIQUE (10 après 2)', () => {
    expect(clustersTries(SUMMARY).map(([cid]) => cid)).toEqual(['0', '2', '10']);
  });

  it('lignesPoi : toutes, ou celles du cluster filtré, avec lat/lng tirés des coordonnées', () => {
    expect(lignesPoi(GEO, null).map((r) => r.poi_id)).toEqual(['a', 'b', 'c']);
    const filtrees = lignesPoi(GEO, 0);
    expect(filtrees.map((r) => r.poi_id)).toEqual(['a', 'c']);
    expect(filtrees[0]).toMatchObject({ lat: 45, lng: 2, cluster_id: 0, ville: 'Lyon', profile_features: {} });
    expect(lignesPoi(null, null)).toEqual([]);
  });

  it('emprise d’un cluster : [[ouest, sud], [est, nord]] ; null sans point', () => {
    expect(emprise(GEO, '0')).toEqual([[2, 45], [4, 48]]);
    expect(emprise(GEO, '7')).toBeNull();
  });

  it('poiDepuisClic : propriétés plates → POI, profile_features relu en JSON (illisible → {})', () => {
    const p = poiDepuisClic({ ...GEO.features[0].properties, cluster_id: '0', profile_features: '{"pct_0_17":0.2}' }, { lat: 45.1, lng: 2.1 });
    expect(p).toEqual({
      poi_id: 'a', poi_name: 'POI a', cluster_id: 0, cluster_label: 'L0', cluster_color: '#4e79a7', categorie: 'cirfa', ville: 'Lyon',
      profile_features: { pct_0_17: 0.2 }, lat: 45.1, lng: 2.1,
    });
    expect(poiDepuisClic({ profile_features: '{tronqué' }, { lat: 0, lng: 0 }).profile_features).toEqual({});
  });

  it('couleurBadge : seul un hexadécimal passe dans un style ; sinon le gris de la donnée absente', () => {
    expect(couleurBadge('#4e79a7')).toBe('#4e79a7');
    expect(couleurBadge('red;background:url(x)')).toBe('var(--donnee-absente)');
    expect(couleurBadge(undefined)).toBe('var(--donnee-absente)');
  });

  it('jetonSilhouette : ≥ 0,5 succès, ≥ 0,3 avertissement, sinon danger', () => {
    expect([0.5, 0.3248, 0.2992].map(jetonSilhouette)).toEqual(['success', 'warning', 'danger']);
  });

  it('dateCourte : jj/mm/aa en fr-FR', () => {
    expect(dateCourte('2026-09-12T09:52:55.448365+00:00')).toBe('12/09/26');
  });

  it('etiquetteRadarCluster : « C<id>: » + premier segment du libellé, 12 caractères', () => {
    expect(etiquetteRadarCluster('3', 'Grandes familles / Familial (enfants)')).toBe('C3: Grandes fami');
  });

  it('pourcent1 : (v × 100).toFixed(1) + « % »', () => {
    expect(pourcent1(0.2016)).toBe('20.2%');
  });

  it('deltasComparaison : profil du POI, à défaut la moyenne de son cluster ; tri par écart absolu ; trois premiers', () => {
    const a: PoiCluster = { poi_id: 'a', poi_name: 'A', cluster_id: 0, cluster_label: 'Zéro', cluster_color: '#4e79a7', categorie: '', ville: '', profile_features: { x: 0.5 } };
    const b: PoiCluster = { ...a, poi_id: 'b', cluster_id: 2, profile_features: { x: 0.1, y: 0.3 } };
    const summary = { '0': resume('Zéro', '#4e79a7', { y: 0.2, z: 0.1 }), '2': resume('Deux', '#59a14f', { z: 0.5 }) };
    const { lignes, principales } = deltasComparaison(a, b, summary, ['x', 'y', 'z']);
    expect(lignes.map((l) => [l.cle, l.valA, l.valB])).toEqual([['x', 0.5, 0.1], ['z', 0.1, 0.5], ['y', 0.2, 0.3]]);
    expect(principales).toEqual(['x', 'z', 'y']);
  });

  it('profilsParDuree : `durations` indexées par nombre, profil absent → {}', () => {
    expect(profilsParDuree({ poi_id: 'a', durations: { '15': { profile_features: { x: 1 } }, '30': {} } })).toEqual({ 15: { x: 1 }, 30: {} });
  });

  it('basculerDuree : retire (jamais la dernière), ajoute en gardant l’ordre', () => {
    expect(basculerDuree([15, 30], 30)).toEqual([15]);
    expect(basculerDuree([15], 15)).toEqual([15]);
    expect(basculerDuree([30], 15)).toEqual([15, 30]);
  });

  it('comparaisonDurees : lignes dont l’amplitude dépasse 0,005, triées, 8 au plus', () => {
    const donnees = { 15: { a: 0.1, b: 0.2, c: 0.3 }, 30: { a: 0.104, b: 0.4, c: 0.31 } };
    const c = comparaisonDurees(donnees, [15, 30], ['a', 'b', 'c']);
    expect(c.disponibles).toEqual([15, 30]);
    expect(c.lignes.map((l) => l.cle)).toEqual(['b', 'c']);
    expect(c.lignes[0].valeurs).toEqual([0.2, 0.4]);
    expect(c.lignes[0].amplitude).toBeCloseTo(0.2);
  });

  it('messageAucunModele : la durée demandée et celles des modèles calculés', () => {
    expect(messageAucunModele(60, [15, 15])).toBe('Aucun modèle de clustering à 60 min — modèles calculés : 15 min.');
    expect(messageAucunModele(60, [])).toBe('Aucun modèle de clustering à 60 min.');
  });
});
