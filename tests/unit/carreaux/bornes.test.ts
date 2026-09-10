import { describe, it, expect } from 'vitest';
import { CARREAUX_INDICATEURS } from '@/components/CarreauxPMTilesLayer';
import {
  bornesDe,
  BORNES_NATIONALES,
  PLANCHER_LOG,
  palierEchelle,
  versValeurReelle,
  formaterValeur,
} from '@/lib/carreaux/bornes';

describe('bornes nationales', () => {
  it('couvre tous les indicateurs du catalogue', () => {
    const manquants = CARREAUX_INDICATEURS.map(i => i.id).filter(id => !(id in BORNES_NATIONALES));
    expect(manquants).toEqual([]);
  });

  it('a des bornes strictement croissantes — MapLibre rejette le contraire en silence', () => {
    for (const [id, b] of Object.entries(BORNES_NATIONALES)) {
      expect(b.max, `${id} : max doit etre > min`).toBeGreaterThan(b.min);
    }
  });

  it('n’a que des bornes finies', () => {
    for (const [id, b] of Object.entries(BORNES_NATIONALES)) {
      expect(Number.isFinite(b.min), `${id} : min fini`).toBe(true);
      expect(Number.isFinite(b.max), `${id} : max fini`).toBe(true);
    }
  });

  it('porte des LOGARITHMES, pas des valeurs brutes', () => {
    // log10 d'une densite ou d'un ratio : aucune borne du catalogue ne depasse
    // 10 (soit 10 milliards en unite reelle). Une borne >= 10 ici signalerait
    // une valeur lineaire recopiee par erreur a la place de son logarithme.
    for (const [id, b] of Object.entries(BORNES_NATIONALES)) {
      expect(b.max, `${id} : max doit etre un log10`).toBeLessThan(10);
      expect(b.min, `${id} : min doit etre un log10`).toBeGreaterThan(-10);
    }
  });

  it('laisse le plancher du log sous la plus basse des bornes', () => {
    // Un carreau vide est clampe par PLANCHER_LOG ; s'il retombait AU-DESSUS
    // d'un `min`, il serait colore comme un carreau peuple.
    const minimum = Math.min(...Object.values(BORNES_NATIONALES).map(b => b.min));
    expect(Math.log10(PLANCHER_LOG)).toBeLessThan(minimum);
  });

  it('retourne un repli exploitable pour un indicateur inconnu', () => {
    const b = bornesDe('indicateur_inexistant');
    expect(b.max).toBeGreaterThan(b.min);
  });

  it('resiste a la chaine de prototype', () => {
    const b = bornesDe('constructor');
    expect(b.max).toBeGreaterThan(b.min);
    const t = bornesDe('toString');
    expect(t.max).toBeGreaterThan(t.min);
  });

  it('rend les bornes d’un indicateur connu', () => {
    expect(bornesDe('population_totale')).toEqual(BORNES_NATIONALES.population_totale);
  });
});

describe('palierEchelle', () => {
  it('decoupe l’echelle en tranches jointives couvrant tout l’intervalle', () => {
    const bornes = { min: -1, max: 3 };
    const paliers = Array.from({ length: 6 }, (_, i) => palierEchelle(bornes, i, 6));
    expect(paliers[0].min).toBeCloseTo(-1, 10);
    expect(paliers[5].max).toBeCloseTo(3, 10);
    for (let i = 1; i < paliers.length; i++) {
      expect(paliers[i].min).toBeCloseTo(paliers[i - 1].max, 10);
    }
  });

  it('produit des tranches strictement croissantes sur chaque indicateur reel', () => {
    for (const [id, bornes] of Object.entries(BORNES_NATIONALES)) {
      for (let i = 0; i < 6; i++) {
        const p = palierEchelle(bornes, i, 6);
        expect(p.max, `${id} palier ${i}`).toBeGreaterThan(p.min);
      }
    }
  });
});

describe('versValeurReelle', () => {
  it('est l’inverse du log10 applique par l’expression de couleur', () => {
    expect(versValeurReelle(Math.log10(1234))).toBeCloseTo(1234, 6);
    expect(versValeurReelle(0)).toBe(1);
  });

  it('rend des densites plausibles sur les bornes de population', () => {
    const b = BORNES_NATIONALES.population_totale;
    expect(versValeurReelle(b.min)).toBeCloseTo(2.22, 1);
    // Borne haute = p99,9 du palier 200 m : l'ordre de grandeur d'un coeur
    // urbain tres dense, pas une moyenne nationale.
    expect(versValeurReelle(b.max)).toBeGreaterThan(10_000);
  });
});

describe('formaterValeur', () => {
  it('garde de la precision sous l’unite — le defaut « 0 – 0 » de la legende', () => {
    // Les deux premieres tranches de logements_inconnus valent 0,02 et 0,10 :
    // un arrondi a l'entier les affichait toutes deux « 0 ».
    expect(formaterValeur(0.02)).not.toBe('0');
    expect(formaterValeur(0.103)).not.toBe('0');
    expect(formaterValeur(0.02)).not.toBe(formaterValeur(0.103));
  });

  it('distingue toutes les tranches de l’indicateur le plus resserre', () => {
    // Tout l'enjeu : deux tranches voisines ne doivent jamais afficher le meme
    // texte, sinon la legende devient illisible pour cet indicateur.
    for (const [id, bornes] of Object.entries(BORNES_NATIONALES)) {
      const etiquettes = Array.from({ length: 6 }, (_, i) =>
        formaterValeur(versValeurReelle(palierEchelle(bornes, i, 6).min)),
      );
      expect(new Set(etiquettes).size, `${id} : tranches indistinctes (${etiquettes.join(', ')})`).toBe(6);
    }
  });

  it('abrege les grands nombres', () => {
    expect(formaterValeur(29_310)).toBe('29k');
    expect(formaterValeur(1_500)).toBe('1.5k');
    expect(formaterValeur(2_500_000)).toBe('2.5M');
  });

  it('ne rend jamais NaN ni Infinity', () => {
    expect(formaterValeur(Number.NaN)).toBe('—');
    expect(formaterValeur(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formaterValeur(0)).toBe('0');
  });
});
