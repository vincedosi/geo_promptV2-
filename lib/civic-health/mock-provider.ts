/**
 * Mock provider — données déterministes pour dev/test sans creds Atmo France.
 *
 * Le hash du code_insee détermine les valeurs : même code → même payload
 * (utile pour les tests et la démo). Les dates sont calculées dynamiquement
 * à partir d'aujourd'hui.
 */
import type {
  AirIndicator,
  AtmoLevel,
  HealthIndicator,
  HealthProvider,
  PollenBulkEntry,
  PollenIndicator,
  PollenLevel,
} from './types';
import { atmoQualificatif, parseAtmoLevel } from './levels';
import { isoDate as todayIso } from './utils';

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function buildAir(codeInsee: string): AirIndicator {
  const h = hash(codeInsee);
  const indice = ((h % 5) + 1) as AtmoLevel;
  const j1Indice = parseAtmoLevel(((h >> 3) % 5) + 1)!;
  return {
    date: todayIso(0),
    indice,
    qualificatif: atmoQualificatif(indice),
    sous_indices: {
      pm10: parseAtmoLevel(((h >> 1) % 5) + 1),
      pm25: parseAtmoLevel(((h >> 2) % 5) + 1),
      no2: parseAtmoLevel(((h >> 4) % 5) + 1),
      o3: parseAtmoLevel(((h >> 5) % 5) + 1),
      so2: parseAtmoLevel(((h >> 6) % 5) + 1),
    },
    previsionJ1: {
      indice: j1Indice,
      qualificatif: atmoQualificatif(j1Indice),
    },
  };
}

function buildPollen(codeInsee: string): PollenIndicator {
  const h = hash(codeInsee);
  const indice_global = ((h % 5) + 1) as PollenLevel;
  const especes = {
    ambroisie: ((h >> 1) % 6) as PollenLevel,
    armoise: ((h >> 2) % 4) as PollenLevel,
    aulne: ((h >> 3) % 3) as PollenLevel,
    bouleau: ((h >> 4) % 6) as PollenLevel,
    graminees: ((h >> 5) % 5) as PollenLevel,
    olivier: ((h >> 6) % 4) as PollenLevel,
  };
  return {
    date: todayIso(0),
    indice_global,
    especes,
    // Concentrations pseudo-réalistes : ~10 grains/m³ par niveau + bruit
    concentrations: {
      ambroisie: especes.ambroisie * 10 + (h % 7),
      armoise: especes.armoise * 10 + ((h >> 1) % 7),
      aulne: especes.aulne * 10 + ((h >> 2) % 7),
      bouleau: especes.bouleau * 10 + ((h >> 3) % 7),
      graminees: especes.graminees * 10 + ((h >> 4) % 7),
      olivier: especes.olivier * 10 + ((h >> 5) % 7),
    },
    alerte: h % 41 === 0,
    previsionJ1: { indice: ((h >> 7) % 5) as PollenLevel },
    previsionJ2: { indice: ((h >> 8) % 4) as PollenLevel },
  };
}

export class MockProvider implements HealthProvider {
  readonly name = 'mock' as const;

  async fetchHealth(codeInsee: string): Promise<HealthIndicator | null> {
    if (!codeInsee) return null;
    return {
      code_insee: codeInsee,
      commune: `Commune ${codeInsee}`,
      air: buildAir(codeInsee),
      pollen: buildPollen(codeInsee),
      fetchedAt: new Date().toISOString(),
      source: 'Atmo France et AASQA',
      stale: false,
    };
  }

  /** Bulk déterministe : mêmes valeurs que fetchHealth, pour toutes les communes demandées. */
  async fetchPollenBulk(
    communeCodes: string[],
    onLog?: (message: string) => void,
  ): Promise<Map<string, PollenBulkEntry> | null> {
    onLog?.(`Mock bulk : génération de ${communeCodes.length} communes`);
    const out = new Map<string, PollenBulkEntry>();
    for (const code of communeCodes) {
      const p = buildPollen(code);
      out.set(code.toUpperCase(), {
        indice_global: p.indice_global,
        especes: p.especes,
        concentrations: p.concentrations ?? { ambroisie: 0, armoise: 0, aulne: 0, bouleau: 0, graminees: 0, olivier: 0 },
        alerte: p.alerte ?? false,
      });
    }
    return out;
  }
}
