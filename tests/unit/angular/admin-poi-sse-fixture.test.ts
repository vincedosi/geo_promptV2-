/**
 * Le flux SSE rejoué par les specs Angular de l'import POI (lot 6, T13) est le MÊME fichier que celui
 * que la preuve navigateur peut servir aux deux écrans. Les specs Angular ne peuvent rien importer
 * hors d'`angular/` (`isolement.test.ts`) : elles en gardent une copie en TypeScript, verrouillée ici.
 *
 * Le second test relie la fixture à la ROUTE : chaque événement porte un `type` que la route émet, et
 * le message d'arrêt du scénario A3 est recopié de `execute/route.ts`, pas réécrit de mémoire.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  FLUX_IMPORT_COMPLET, FLUX_IMPORT_POI, FLUX_SOURCE_IMPOSSIBLE,
} from '../../../angular/src/app/features/admin/import/testing/import-poi-sse.fixture';

const RACINE = path.resolve(__dirname, '../../..');

const evenements = (flux: string) => flux.split('\n').filter((l) => l.startsWith('data: '))
  .map((l) => JSON.parse(l.slice(6)) as { type: string; message?: string; report?: Record<string, number> });

describe('fixture du flux d’import POI (lot 6, T13)', () => {
  it('la copie TypeScript des specs Angular est identique à l’octet au fichier SSE', () => {
    const fichier = readFileSync(path.join(RACINE, 'tests/fixtures/admin/import-poi.sse'), 'utf8').replace(/\r\n/g, '\n');
    expect(FLUX_IMPORT_POI).toBe(fichier);
  });

  it('scénario complet : ≥ 3 `log`, ≥ 3 progressions, un `complete` en dernier, rapport aux compteurs de la route', () => {
    const e = evenements(FLUX_IMPORT_COMPLET);
    expect(e.filter((x) => x.type === 'log').length).toBeGreaterThanOrEqual(3);
    expect(e.filter((x) => x.type === 'progress').length).toBeGreaterThanOrEqual(3);
    expect(e.at(-1)).toEqual({ type: 'complete', report: { total: 10, inserted: 10, ignored: 0, errors: 0 }, firstError: null });
    for (const x of e) expect(['progress', 'geocode', 'complete', 'error', 'log']).toContain(x.type);
  });

  it('scénario A3 : le flux finit sur l’`error` de la route, texte recopié de `execute/route.ts`, sans `complete`', () => {
    const route = readFileSync(path.join(RACINE, 'app/api/admin/import-poi/execute/route.ts'), 'utf8');
    const e = evenements(FLUX_SOURCE_IMPOSSIBLE);
    const fin = e.at(-1)!;
    expect(fin.type).toBe('error');
    expect(route).toContain(`message: '${fin.message}'`);
    expect(e.some((x) => x.type === 'complete')).toBe(false);
  });

  it('les messages de progression sont ceux de la route (préfixes des `send`)', () => {
    const route = readFileSync(path.join(RACINE, 'app/api/admin/import-poi/execute/route.ts'), 'utf8');
    for (const debut of ["'Parsing du fichier...'", '`Fichier parse: ', "'Traitement des coordonnees...'", ' sans coordonnees`', '`Source "']) {
      expect(route).toContain(debut);
    }
  });
});
