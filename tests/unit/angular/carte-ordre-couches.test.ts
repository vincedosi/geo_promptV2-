/**
 * L'ordre d'empilement des couches de la carte principale Angular (`logique/ordre-couches.ts`) est EXACTEMENT celui
 * dans lequel React les pose au `load` (`app/copilote/_hooks/useMapInit.ts`, ordre des `addLayer`, aucun `beforeId`).
 * Ruling du lot 4, T8 : côté Angular les couches sont posées à la demande, donc l'ordre doit être écrit — et ce test
 * empêche qu'il dérive de celui de React (gel P5 étendu à /map).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ORDRE_COUCHES, avantDe } from '../../../angular/src/app/features/carte/logique/ordre-couches';

describe('ORDRE_COUCHES (lot 4, T8)', () => {
  it('reprend, dans le même ordre, toutes les couches que useMapInit.ts ajoute', () => {
    const source = readFileSync('app/copilote/_hooks/useMapInit.ts', 'utf8');
    const ids: string[] = [];
    for (const m of source.matchAll(/addLayer\(\{\s*id:\s*'([^']+)'/g)) ids.push(m[1]);
    expect(ids.length).toBeGreaterThan(20);
    expect(ORDRE_COUCHES).toEqual(ids);
  });

  it('avantDe : la première couche PLUS HAUTE déjà posée ; rien au-dessus ou hors liste → sommet', () => {
    const posees = new Set(['iris-fill', 'carreaux-mvt-fill']);
    const carte = { getLayer: (id: string) => (posees.has(id) ? {} : undefined) };
    expect(avantDe(carte, 'pois-heatmap')).toBe('iris-fill');
    expect(avantDe(carte, 'iris-border')).toBe('carreaux-mvt-fill');
    expect(avantDe(carte, 'carreaux-mvt-line')).toBeUndefined();
    expect(avantDe(carte, 'zones-risque-fond')).toBeUndefined();
  });
});
