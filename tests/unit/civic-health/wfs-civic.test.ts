import { describe, it, expect } from 'vitest';
import { collectWfsAtmoFeatures, collectWfsFeatures } from '@/lib/civic-health/wfs-civic';
import type { AtmoBulkEntry, PollenBulkEntry } from '@/lib/civic-health/types';

describe('collectWfsFeatures', () => {
  it('parse une FeatureCollection WFS réelle (structure ind_national_pol)', () => {
    const target = new Map<string, PollenBulkEntry>();
    const added = collectWfsFeatures({
      features: [
        {
          properties: {
            code_zone: '22195', code_qual: 3,
            code_aul: 1, code_boul: 1, code_oliv: 1, code_gram: 3, code_arm: 1, code_ambr: 0,
            conc_gram: 41.9, conc_arm: 0.6, conc_ambr: 0, alerte: false,
          },
        },
        {
          properties: {
            code_zone: '2a004', code_qual: 5,
            code_aul: 0, code_boul: 0, code_oliv: 4, code_gram: 2, code_arm: 1, code_ambr: 0,
          },
        },
      ],
    }, target);

    expect(added).toBe(2);
    expect(target.get('22195')).toMatchObject({
      indice_global: 3,
      especes: { graminees: 3, aulne: 1, ambroisie: 0 },
      concentrations: { graminees: 41.9, armoise: 0.6, ambroisie: 0 },
      alerte: false,
    });
    // Codes corses normalisés en majuscules
    expect(target.get('2A004')?.especes.olivier).toBe(4);
  });

  it('ignore les features sans code_zone ou avec code_qual hors plage', () => {
    const target = new Map<string, PollenBulkEntry>();
    const added = collectWfsFeatures({
      features: [
        { properties: { code_qual: 3 } },                     // pas de code_zone
        { properties: { code_zone: '75056', code_qual: 9 } }, // hors plage 0-6
        { properties: { code_zone: '75056', code_qual: 2 } },
      ],
    }, target);

    expect(added).toBe(1);
    expect(target.size).toBe(1);
    expect(target.get('75056')?.indice_global).toBe(2);
  });

  it('tolère une collection vide', () => {
    const target = new Map<string, PollenBulkEntry>();
    expect(collectWfsFeatures({}, target)).toBe(0);
    expect(target.size).toBe(0);
  });
});

describe('collectWfsAtmoFeatures', () => {
  it('parse une FeatureCollection WFS réelle (structure ind_atmo)', () => {
    const target = new Map<string, AtmoBulkEntry>();
    const added = collectWfsAtmoFeatures({
      features: [
        {
          properties: {
            code_zone: '91689', code_qual: 2,
            code_no2: 1, code_o3: 2, code_pm10: 1, code_pm25: 1, code_so2: 1,
          },
        },
        // Zone EPCI (code SIREN) : parsée mais ne matchera jamais le mapping commune
        { properties: { code_zone: '200054781', code_qual: 3, code_no2: 2, code_o3: 3, code_pm10: 1, code_pm25: 1, code_so2: 1 } },
      ],
    }, target);

    expect(added).toBe(2);
    expect(target.get('91689')).toMatchObject({
      indice_global: 2,
      polluants: { o3: 2, no2: 1 },
    });
  });

  it('ignore code_qual 0 (indisponible) et hors plage', () => {
    const target = new Map<string, AtmoBulkEntry>();
    const added = collectWfsAtmoFeatures({
      features: [
        { properties: { code_zone: '75056', code_qual: 0 } },
        { properties: { code_zone: '75057', code_qual: 7 } },
      ],
    }, target);
    expect(added).toBe(0);
  });
});

import { pageSuivanteAttendue } from '@/lib/civic-health/wfs-civic';

describe('pageSuivanteAttendue — la pagination qui ne paginait pas', () => {
  it("continue tant que numberMatched n'est pas atteint, même si le serveur plafonne count", () => {
    // Serveur plafonné à 10 000 par page, 35 000 communes annoncées.
    expect(pageSuivanteAttendue({ numberMatched: 35_000 }, 0, 10_000)).toBe(true);
    expect(pageSuivanteAttendue({ numberMatched: 35_000 }, 30_000, 5_000)).toBe(false);
  });

  it("s'arrête sur une page vide, quoi qu'annonce numberMatched", () => {
    expect(pageSuivanteAttendue({ numberMatched: 35_000 }, 40_000, 0)).toBe(false);
  });

  it('sans numberMatched, repli sur la taille de page', () => {
    expect(pageSuivanteAttendue({}, 0, 40_000)).toBe(true);
    expect(pageSuivanteAttendue({}, 0, 12_345)).toBe(false);
  });
});
