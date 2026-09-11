import { describe, it, expect } from 'vitest';
import {
  comparerEmpreinte,
  EMPREINTE_MESURE,
  type EmpreinteRelevee,
} from '@/lib/carreaux/empreinte-source';

/** L'empreinte telle qu'elle a été relevée en base le 2026-09-11 : concordante. */
const CONCORDANTE: EmpreinteRelevee = {
  carreaux5kmLignes: EMPREINTE_MESURE.carreaux5km.lignes,
  carreaux5kmPopulation: EMPREINTE_MESURE.carreaux5km.population,
  carreaux5kmMenages: EMPREINTE_MESURE.carreaux5km.menages,
  carreauxFilosofiEstime: EMPREINTE_MESURE.carreauxFilosofiEstime,
};

describe('comparerEmpreinte', () => {
  it("ne signale rien quand la source n'a pas bouge", () => {
    const d = comparerEmpreinte(CONCORDANTE);
    expect(d.perimees).toBe(false);
    expect(d.ecarts).toEqual([]);
  });

  it('signale un re-import qui change le nombre de carreaux', () => {
    const d = comparerEmpreinte({ ...CONCORDANTE, carreaux5kmLignes: 22_100 });
    expect(d.perimees).toBe(true);
    expect(d.ecarts.join(' ')).toContain('carreaux_5km');
  });

  it('signale un nouveau millesime qui change la population', () => {
    // C'est le cas reel redoute : meme maillage, autres valeurs. Un compte de
    // lignes seul ne le verrait pas — d'ou les sommes dans l'empreinte.
    const d = comparerEmpreinte({ ...CONCORDANTE, carreaux5kmPopulation: 63_100_000 });
    expect(d.perimees).toBe(true);
    expect(d.ecarts.join(' ')).toContain('population');
  });

  it('signale un ecart sur les menages meme si la population est stable', () => {
    const d = comparerEmpreinte({ ...CONCORDANTE, carreaux5kmMenages: 28_300_000 });
    expect(d.perimees).toBe(true);
    expect(d.ecarts.join(' ')).toContain('ménages');
  });

  it("tolere la derive de l'estimation du planificateur sous 2 %", () => {
    // reltuples n'est rafraichi qu'a l'ANALYZE : une petite derive est normale
    // et ne doit pas crier au loup.
    const leger = Math.round(EMPREINTE_MESURE.carreauxFilosofiEstime * 1.01);
    expect(comparerEmpreinte({ ...CONCORDANTE, carreauxFilosofiEstime: leger }).perimees).toBe(false);
  });

  it('signale une derive de l estimation au-dela de 2 %', () => {
    const fort = Math.round(EMPREINTE_MESURE.carreauxFilosofiEstime * 1.10);
    const d = comparerEmpreinte({ ...CONCORDANTE, carreauxFilosofiEstime: fort });
    expect(d.perimees).toBe(true);
    expect(d.ecarts.join(' ')).toContain('carreaux_filosofi');
  });

  it('cumule les ecarts au lieu de s arreter au premier', () => {
    const d = comparerEmpreinte({
      carreaux5kmLignes: 1,
      carreaux5kmPopulation: 2,
      carreaux5kmMenages: 3,
      carreauxFilosofiEstime: 4,
    });
    expect(d.ecarts).toHaveLength(4);
  });

  it('rappelle la date de mesure, pour situer les bornes dans le temps', () => {
    expect(comparerEmpreinte(CONCORDANTE).mesureLe).toBe('2026-09-10');
  });
});
