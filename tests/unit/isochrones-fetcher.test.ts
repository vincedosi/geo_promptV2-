import { describe, it, expect } from 'vitest';
import {
  buildIsochCacheKey,
  ORS_PROFILES,
  ORS_BATCH_SIZE,
  ORS_MAX_POIS_CHAT,
  ORS_MAX_POIS_ROUTIER,
} from '@/lib/isochrones/fetcher';

// ─── buildIsochCacheKey ────────────────────────────────────────────────────────

describe('buildIsochCacheKey', () => {
  it('génère une clé de base ville__categorie__Xmin__mode', () => {
    const key = buildIsochCacheKey('Paris', 'recrutement', 30, 'drive');
    expect(key).toBe('paris__recrutement__30min__drive');
  });

  it('normalise les accents', () => {
    const key = buildIsochCacheKey('Île-de-France', 'défense', 60, 'walk');
    expect(key).toBe('ile-de-france__defense__60min__walk');
  });

  it('normalise la casse', () => {
    const key = buildIsochCacheKey('LYON', 'CIRFA', 15, 'bike');
    expect(key).toBe('lyon__cirfa__15min__bike');
  });

  it('remplace les espaces par des underscores', () => {
    const key = buildIsochCacheKey('Le Mans', 'bureau de recrutement', 45, 'drive');
    expect(key).toBe('le_mans__bureau_de_recrutement__45min__drive');
  });

  it('utilise "all" si categorie est undefined', () => {
    const key = buildIsochCacheKey('Bordeaux', undefined, 30, 'drive');
    expect(key).toBe('bordeaux__all__30min__drive');
  });

  it('ajoute un suffixe normalisé si fourni', () => {
    const key = buildIsochCacheKey('Toulouse', 'Marine', 60, 'drive', 'Île-de-France');
    expect(key).toBe('toulouse__marine__60min__drive__ile-de-france');
  });

  it('sans suffixe — pas de double underscore en fin', () => {
    const key = buildIsochCacheKey('Rennes', 'Armée', 30, 'walk');
    expect(key).not.toContain('__undefined');
    expect(key).not.toMatch(/__$/);
  });

  it('deux clés distinctes pour des modes différents', () => {
    const walk  = buildIsochCacheKey('Nantes', 'all', 30, 'walk');
    const drive = buildIsochCacheKey('Nantes', 'all', 30, 'drive');
    expect(walk).not.toBe(drive);
  });

  it('deux clés distinctes pour des durées différentes', () => {
    const k30 = buildIsochCacheKey('Nantes', 'all', 30, 'drive');
    const k60 = buildIsochCacheKey('Nantes', 'all', 60, 'drive');
    expect(k30).not.toBe(k60);
  });

  it('clé déterministe — même entrée → même sortie', () => {
    const a = buildIsochCacheKey('Strasbourg', 'Armée de l\'Air', 120, 'drive');
    const b = buildIsochCacheKey('Strasbourg', 'Armée de l\'Air', 120, 'drive');
    expect(a).toBe(b);
  });
});

// ─── ORS_PROFILES ─────────────────────────────────────────────────────────────

describe('ORS_PROFILES', () => {
  it('walk → foot-walking', () => {
    expect(ORS_PROFILES['walk']).toBe('foot-walking');
  });

  it('drive → driving-car', () => {
    expect(ORS_PROFILES['drive']).toBe('driving-car');
  });

  it('bike → cycling-regular', () => {
    expect(ORS_PROFILES['bike']).toBe('cycling-regular');
  });

  it('profil inconnu → undefined (fallback à foot-walking dans fetcher)', () => {
    expect(ORS_PROFILES['flying']).toBeUndefined();
  });
});

// ─── Constantes de limites ─────────────────────────────────────────────────────

describe('Constantes limites ORS', () => {
  it('batch size = 5 (limite API ORS public)', () => {
    expect(ORS_BATCH_SIZE).toBe(5);
  });

  it('max POIs chat ≤ max POIs battle (battle a un timeout plus long)', () => {
    expect(ORS_MAX_POIS_CHAT).toBeLessThanOrEqual(ORS_MAX_POIS_ROUTIER);
  });

  it('max POIs chat est raisonnable (≤ 200)', () => {
    expect(ORS_MAX_POIS_CHAT).toBeLessThanOrEqual(200);
  });
});

// ─── Logique de batching ───────────────────────────────────────────────────────

describe('Logique de batching ORS', () => {
  it('40 POIs → 8 batches de 5 (optimisation v5)', () => {
    const pois = Array.from({ length: 40 }, (_, i) => i);
    const batches: number[][] = [];
    for (let i = 0; i < pois.length; i += ORS_BATCH_SIZE) {
      batches.push(pois.slice(i, i + ORS_BATCH_SIZE) as number[]);
    }
    expect(batches).toHaveLength(8);
    expect(batches[0]).toHaveLength(5);
    expect(batches[7]).toHaveLength(5);
  });

  it('41 POIs → 9 batches (dernier batch de 1)', () => {
    const pois = Array.from({ length: 41 }, (_, i) => i);
    const batches: number[][] = [];
    for (let i = 0; i < pois.length; i += ORS_BATCH_SIZE) {
      batches.push(pois.slice(i, i + ORS_BATCH_SIZE) as number[]);
    }
    expect(batches).toHaveLength(9);
    expect(batches[8]).toHaveLength(1);
  });

  it('troncature correcte : slice(0, maxPois)', () => {
    const pois = Array.from({ length: 100 }, (_, i) => i);
    const sliced = pois.slice(0, ORS_MAX_POIS_CHAT);
    expect(sliced).toHaveLength(ORS_MAX_POIS_CHAT);
  });
});
