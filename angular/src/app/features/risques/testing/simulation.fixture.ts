import type { ReponseSimulation } from '../logique/simulation/payload';

/**
 * Une réponse de `GET /api/zones/jeux/[id]/simulation` MINIMALE, pour les specs de l'étape ⑤ : deux bassins, trois codes
 * postaux, quatre jours (recalage au jour 3), deux partenaires. Assez pour que `construireVue` rende une vue,
 * `courbeAlignement` des points, et `constats` une sur-pression ET une sous-pression.
 */
export function reponseSimulation(statut: 'v1' | 'v2' = 'v2'): ReponseSimulation {
  const v2 = statut === 'v2';
  return {
    simulation: {
      id: 's1', campaign_id: 'c1', statut, date_debut: '2026-09-24', jours: 4, jour_recalage: 3,
      params: {} as never, lignes_v1: 10, lignes_v2: v2 ? 10 : 0, created_at: '2026-09-24T10:00:00Z',
      extraction_v1: { id: 'e1', version: 1 }, extraction_v2: v2 ? { id: 'e2', version: 2 } : null,
    },
    entrees: [
      { code_postal: '13001', code_canonique: '13001', cluster_id: 'za', retenu: true, multiplicateur: 1, pop_en_zone: 600, pop_totale: 1000, part_en_zone: 60, surface_km2: 2, membre: false, x: 5.4, y: 43.3 },
      { code_postal: '13002', code_canonique: '13002', cluster_id: 'za', retenu: true, multiplicateur: 1, pop_en_zone: 100, pop_totale: 1000, part_en_zone: 10, surface_km2: 2, membre: false, x: 5.5, y: 43.3 },
      { code_postal: '69001', code_canonique: '69001', cluster_id: 'zb', retenu: true, multiplicateur: 1, pop_en_zone: 300, pop_totale: 500, part_en_zone: 60, surface_km2: 1, membre: false, x: 4.8, y: 45.7 },
    ],
    multiplicateurs_v2: v2 ? { 13001: 1, 13002: 0.6, 69001: 1.4 } : undefined,
    zones: [
      { id: 'za', rang: 1, nom: 'Fos-sur-Mer', niveau: 'haut', n_sites: 3, pop_exposee: 700, bbox: [5, 43, 6, 44] },
      { id: 'zb', rang: 2, nom: 'Saint-Fons', niveau: 'haut', n_sites: 1, pop_exposee: 300, bbox: [4.7, 45.6, 4.9, 45.8] },
    ],
    agregats: {
      par_cp: [
        { cp: '13001', v: 1, imps: 30_000, utiles: 18_000, spend: 150 },
        { cp: '13002', v: 1, imps: 30_000, utiles: 3_000, spend: 150 },
        { cp: '69001', v: 1, imps: 6_000, utiles: 3_600, spend: 40 },
        ...(v2 ? [
          { cp: '13001', v: 2 as const, imps: 25_000, utiles: 15_000, spend: 120 },
          { cp: '13002', v: 2 as const, imps: 10_000, utiles: 1_000, spend: 50 },
          { cp: '69001', v: 2 as const, imps: 15_000, utiles: 9_000, spend: 90 },
        ] : []),
      ],
      par_zone_jour: [
        { jour: 1, cid: 'za', imps: 30_000, utiles: 14_000, spend: 150 }, { jour: 1, cid: 'zb', imps: 3_000, utiles: 1_800, spend: 20 },
        { jour: 2, cid: 'za', imps: 30_000, utiles: 14_000, spend: 150 }, { jour: 2, cid: 'zb', imps: 3_000, utiles: 1_800, spend: 20 },
        ...(v2 ? [
          { jour: 3, cid: 'za', imps: 17_500, utiles: 8_000, spend: 85 }, { jour: 3, cid: 'zb', imps: 7_500, utiles: 4_500, spend: 45 },
          { jour: 4, cid: 'za', imps: 17_500, utiles: 8_000, spend: 85 }, { jour: 4, cid: 'zb', imps: 7_500, utiles: 4_500, spend: 45 },
        ] : []),
      ],
      par_jour: [
        { jour: 1, imps: 33_000, utiles: 12_300, spend: 170, en_zone: 33_000 },
        { jour: 2, imps: 33_000, utiles: 12_300, spend: 170, en_zone: 33_000 },
        ...(v2 ? [
          { jour: 3, imps: 25_000, utiles: 12_500, spend: 130, en_zone: 25_000 },
          { jour: 4, imps: 25_000, utiles: 12_500, spend: 130, en_zone: 25_000 },
        ] : []),
      ],
      par_partenaire: [
        { partenaire: 'Partenaire B', v: 1, imps: 26_400, spend: 200, en_zone: 26_400, utiles: 9_840 },
        { partenaire: 'Partenaire A', v: 1, imps: 39_600, spend: 140, en_zone: 39_600, utiles: 14_760 },
        ...(v2 ? [{ partenaire: 'Partenaire A', v: 2 as const, imps: 50_000, spend: 260, en_zone: 50_000, utiles: 25_000 }] : []),
      ],
    },
  };
}
