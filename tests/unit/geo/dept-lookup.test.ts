/**
 * Verrous sur les écritures d'un département.
 *
 * Chaque cas vient d'une mesure du 2026-09-13 sur `poi_france`, pas d'une
 * hypothèse : la colonne `departement` porte trois formats selon l'import qui
 * l'a remplie, et le filtre de `/api/map/pois` n'en connaissait qu'un.
 */
import { describe, it, expect } from 'vitest';
import { ecrituresDuDepartement } from '@/lib/geo/dept-lookup-server';

const NOMS = new Map<string, string>([
  ['75', 'Paris'],
  ['03', 'Allier'],
  ['2A', 'Corse-du-Sud'],
  ['2B', 'Haute-Corse'],
  ['01', 'Ain'],
]);

describe('ecrituresDuDepartement', () => {
  it('accepte le NOM, format des 5 584 lycées', () => {
    // C'est LE cas qui rendait zero lycee a Paris : la colonne contient
    // « Paris », le filtre cherchait « 75 ».
    const e = ecrituresDuDepartement('75', NOMS);
    expect(e).toContain('75');
    expect(e).toContain('Paris');
  });

  it('accepte le code non complété, présent chez cirfa', () => {
    // Mesure : 8 cirfa portent `3` ou `4` la ou le referentiel dit `03`/`04`.
    const e = ecrituresDuDepartement('03', NOMS);
    expect(e).toContain('03');
    expect(e).toContain('3');
    expect(e).toContain('Allier');
  });

  it('accepte aussi le sens inverse, un code court demandé', () => {
    const e = ecrituresDuDepartement('3', NOMS);
    expect(e).toContain('3');
    expect(e).toContain('03');
  });

  it('accepte l’ancienne écriture corse 20A / 20B', () => {
    // Mesure : deux cirfa portent `20A` et `20B`, codes perimes.
    expect(ecrituresDuDepartement('2A', NOMS)).toContain('20A');
    expect(ecrituresDuDepartement('2B', NOMS)).toContain('20B');
    expect(ecrituresDuDepartement('20A', NOMS)).toContain('2A');
  });

  it('ne rend jamais de doublon', () => {
    const e = ecrituresDuDepartement('75', NOMS);
    expect(new Set(e).size).toBe(e.length);
  });

  it('ne rend jamais de chaîne vide', () => {
    for (const code of ['75', '03', '2A', '99']) {
      expect(ecrituresDuDepartement(code, NOMS).every((x) => x.length > 0)).toBe(true);
    }
  });

  it('un code inconnu du référentiel reste cherché tel quel', () => {
    // Mieux vaut chercher une valeur qui ne matchera rien que de ne pas
    // chercher du tout : le second cas se lit comme « aucun POI ici ».
    expect(ecrituresDuDepartement('99', NOMS)).toEqual(['99']);
  });

  it('une entrée vide ne produit aucune clause', () => {
    expect(ecrituresDuDepartement('', NOMS)).toEqual([]);
    expect(ecrituresDuDepartement('   ', NOMS)).toEqual([]);
  });

  it('les espaces autour du code sont ignorés', () => {
    expect(ecrituresDuDepartement(' 75 ', NOMS)).toContain('Paris');
  });
});
