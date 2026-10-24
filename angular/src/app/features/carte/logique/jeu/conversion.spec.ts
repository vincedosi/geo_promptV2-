import { appliquerSeuil, exactitude, mailleParDefaut, resumeExact, verifierLimites } from './conversion';
import type { PlateformeGeo } from './plateformes';

/**
 * La copie Angular de la conversion (lot 5, T9). Le comportement complet est éprouvé côté serveur
 * (`tests/unit/zones/conversion.test.ts`) et l'égalité des deux copies par `conversion-paritaire.test.ts` ; ici, les
 * deux égalités de la perte (Review Focus 1) et les cas qu'utilise l'écran de ⑤, dans le projet Angular lui-même.
 */
const ligne = (p: Partial<PlateformeGeo> & Pick<PlateformeGeo, 'plateforme' | 'maille'>): PlateformeGeo => ({
  libelle: 'x', natif: true, disponible: true, limites: {}, doc_url: null, releve_le: '2026-10-14', a_verifier: false,
  note: null, ordre: 0, ...p,
});

describe('conversion (copie Angular)', () => {
  const lignes = [
    { pop_en_zone: 80, pop_totale: 100, part: 80 }, { pop_en_zone: 10, pop_totale: 100, part: 10 },
    { pop_en_zone: 5, pop_totale: null, part: null },
  ];
  it('manques + couverte = population ; hors_zone + couverte = achetée, à tout seuil', () => {
    for (const seuil of [0, 10, 50, 100]) {
      const r = appliquerSeuil(lignes, 95, seuil);
      expect(r.manques + r.couverte).toBe(95);
      expect(r.hors_zone + r.couverte).toBe(r.achetee);
    }
    expect(appliquerSeuil(lignes, 95, 50)).toMatchObject({ n_unites: 1, n_touchees: 3, couverte: 80, achetee: 100, taux_utile: 80 });
  });
  it('une maille exacte : aucune perte, aucun calcul', () => {
    expect(resumeExact(1234, 5.5)).toMatchObject({ exacte: true, manques: 0, hors_zone: 0, taux_utile: 100, n_unites: 1 });
  });
  it('le rayon choisi décide de l’exactitude d’un cercle autour d’un point', () => {
    const r = { v: 1, type: 'rayon_point', lon: 5, lat: 43, rayon_m: 20_000 } as const;
    expect(exactitude(r, 'cercle', ligne({ plateforme: 'meta', maille: 'cercle' }))).toBe('exacte');
    expect(exactitude(r, 'cercle', ligne({ plateforme: 'meta', maille: 'cercle' }), 5_000)).toBe('calculee');
  });
  it('maille par défaut : « à vérifier » écartée d’abord ; avertissement de plafond lu dans la ligne', () => {
    const regles = [ligne({ plateforme: 'meta', maille: 'cp', a_verifier: true }), ligne({ plateforme: 'meta', maille: 'cercle' })];
    expect(mailleParDefaut(regles, 'meta', { v: 1, type: 'dessin' })).toBe('cercle');
    expect(verifierLimites(resumeExact(10, 1, 4), ligne({ plateforme: 'meta', maille: 'cp', limites: { max_unites: 3 } })))
      .toEqual([{ code: 'max_unites', limite: 3, valeur: 4 }]);
  });
});
