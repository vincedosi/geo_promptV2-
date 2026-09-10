import { describe, it, expect } from 'vitest';
import { classeDe, denominateurDe, normaliser, uniteNormalisee } from '@/lib/carreaux/normalisation';

describe('classeDe', () => {
  it('classe les effectifs de population, ménages et logements', () => {
    expect(classeDe('population_totale')).toBe('effectif');
    expect(classeDe('ind_18_24')).toBe('effectif');
    expect(classeDe('menages_pauvres')).toBe('effectif');
    expect(classeDe('logements_sociaux')).toBe('effectif');
  });

  it('classe comme moyennes les deux sommes Filosofi mal nommées', () => {
    expect(classeDe('revenu_median')).toBe('moyenne');
    expect(classeDe('surface_moyenne')).toBe('moyenne');
  });

  it('ne traverse pas le prototype d’objet pour un id hors catalogue', () => {
    expect(classeDe('toString')).toBe('effectif');
  });
});

describe('denominateurDe', () => {
  it('divise les effectifs par la superficie', () => {
    expect(denominateurDe('population_totale')).toBe('superficie_km2');
    expect(denominateurDe('logements_sociaux')).toBe('superficie_km2');
  });

  it('divise ind_snv par la population et men_surf par les ménages', () => {
    expect(denominateurDe('revenu_median')).toBe('population_totale');
    expect(denominateurDe('surface_moyenne')).toBe('menages_total');
  });

  it('ne renvoie pas une valeur héritée du prototype d’objet pour un id hors catalogue', () => {
    expect(denominateurDe('constructor')).toBe('superficie_km2');
  });
});

describe('normaliser', () => {
  it('divise la valeur par le dénominateur', () => {
    // Carreau 200 m = 0,04 km² ; 814 habitants -> 20 350 hab/km²
    expect(normaliser(814, 0.04)).toBeCloseTo(20350, 0);
  });

  it('rend un carreau 200 m et un carreau 2 km comparables', () => {
    const dense200m = normaliser(814, 0.04);      // 0,04 km²
    const dense2km  = normaliser(57310, 4);       // 4 km²
    // Meme territoire : les densites doivent etre du meme ordre, pas x70.
    const rapport = Math.max(dense200m!, dense2km!) / Math.min(dense200m!, dense2km!);
    expect(rapport).toBeLessThan(2);
  });

  it('retourne null sur un dénominateur nul ou négatif plutôt que Infinity', () => {
    expect(normaliser(100, 0)).toBeNull();
    expect(normaliser(100, -1)).toBeNull();
  });

  it('retourne null sur une valeur NaN ou Infinity plutôt que de la propager', () => {
    expect(normaliser(NaN, 1)).toBeNull();
    expect(normaliser(Infinity, 1)).toBeNull();
  });
});

describe('uniteNormalisee', () => {
  it('suffixe les effectifs par km²', () => {
    expect(uniteNormalisee('population_totale', 'pers.')).toBe('pers./km²');
  });

  it('laisse l’unité intacte pour les moyennes', () => {
    expect(uniteNormalisee('revenu_median', '€')).toBe('€');
  });
});
