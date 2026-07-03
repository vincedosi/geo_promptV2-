import { describe, it, expect } from 'vitest';
import { aggregateAtmoByCp, aggregatePollenByCp } from '@/lib/civic-health/civic-ingest';
import type { AtmoBulkEntry, PollenBulkEntry } from '@/lib/civic-health/types';

const DATE = '2026-07-03';

function entry(global: number, overrides: Partial<PollenBulkEntry['especes']> = {}): PollenBulkEntry {
  return {
    indice_global: global as PollenBulkEntry['indice_global'],
    especes: {
      ambroisie: 0, armoise: 0, aulne: 0, bouleau: 0, graminees: 0, olivier: 0,
      ...overrides,
    } as PollenBulkEntry['especes'],
  };
}

describe('aggregatePollenByCp', () => {
  it('prend le max des communes du CP (indice global et espèces)', () => {
    const mapping = [
      { code_postal: '29200', code_commune: '29019' },
      { code_postal: '29200', code_commune: '29189' },
    ];
    const byCommune = new Map<string, PollenBulkEntry>([
      ['29019', entry(2, { graminees: 5 })],
      ['29189', entry(4, { bouleau: 3 })],
    ]);

    const rows = aggregatePollenByCp(mapping, byCommune, DATE);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      date_ech: DATE,
      code_postal: '29200',
      indice_global: 4,
      graminees: 5,
      bouleau: 3,
      nb_communes: 2,
    });
  });

  it('ignore les communes sans donnée et omet les CP entièrement vides', () => {
    const mapping = [
      { code_postal: '75001', code_commune: '75056' },
      { code_postal: '99999', code_commune: '00000' }, // aucune donnée
    ];
    const byCommune = new Map<string, PollenBulkEntry>([['75056', entry(3)]]);

    const rows = aggregatePollenByCp(mapping, byCommune, DATE);
    expect(rows).toHaveLength(1);
    expect(rows[0].code_postal).toBe('75001');
    expect(rows[0].nb_communes).toBe(1);
  });

  it('matche les codes commune insensiblement à la casse (2A/2B corses)', () => {
    const mapping = [{ code_postal: '20000', code_commune: '2a004' }];
    const byCommune = new Map<string, PollenBulkEntry>([['2A004', entry(5)]]);

    const rows = aggregatePollenByCp(mapping, byCommune, DATE);
    expect(rows).toHaveLength(1);
    expect(rows[0].indice_global).toBe(5);
  });
});

function atmoEntry(global: number, overrides: Partial<AtmoBulkEntry['polluants']> = {}): AtmoBulkEntry {
  return {
    indice_global: global as AtmoBulkEntry['indice_global'],
    polluants: { no2: 0, o3: 0, pm10: 0, pm25: 0, so2: 0, ...overrides } as AtmoBulkEntry['polluants'],
  };
}

describe('aggregateAtmoByCp', () => {
  it("prend le max des communes du CP (indice global et polluants)", () => {
    const mapping = [
      { code_postal: '13001', code_commune: '13055' },
      { code_postal: '13001', code_commune: '13201' },
    ];
    const byCommune = new Map<string, AtmoBulkEntry>([
      ['13055', atmoEntry(2, { o3: 4 })],
      ['13201', atmoEntry(3, { no2: 2 })],
    ]);

    const rows = aggregateAtmoByCp(mapping, byCommune, DATE);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      date_ech: DATE,
      code_postal: '13001',
      indice_global: 3,
      o3: 4,
      no2: 2,
      nb_communes: 2,
    });
  });

  it('omet les CP sans aucune commune couverte', () => {
    const mapping = [{ code_postal: '99999', code_commune: '00000' }];
    const rows = aggregateAtmoByCp(mapping, new Map(), DATE);
    expect(rows).toHaveLength(0);
  });
});
