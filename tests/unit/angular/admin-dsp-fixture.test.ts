/**
 * Fixtures de l'import de campagnes DSP (lot 6, T20).
 *
 * - `campagne-essai.csv` est le fichier RÉELLEMENT importé par les deux écrans (React puis Angular) lors
 *   de la preuve navigateur, puis supprimé par l'écran (régime C12 a) : 20 lignes, 3 codes postaux, une
 *   seule campagne au nom reconnaissable, aux colonnes du mapping `adform` en base.
 * - `dsp-import.sse` est le flux que la route émet pour ce fichier ; les specs Angular en gardent une
 *   copie TypeScript (elles ne peuvent rien importer hors d'`angular/`, `isolement.test.ts`). Sans ce
 *   test, la copie et le fichier dériveraient, et les specs prouveraient un rendu sur un flux que la
 *   route n'émet pas.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FLUX_IMPORT_DSP } from '../../../angular/src/app/features/admin/sources/testing/dsp-import.fixture';

const RACINE = path.resolve(__dirname, '../../..');
const lire = (f: string) => readFileSync(path.join(RACINE, 'tests/fixtures/admin', f), 'utf8').replace(/\r\n/g, '\n');

describe('fixtures de l’import DSP (lot 6, T20)', () => {
  it('la copie TypeScript des specs Angular est identique à l’octet au fichier SSE', () => {
    expect(FLUX_IMPORT_DSP).toBe(lire('dsp-import.sse'));
  });

  it('le flux est une suite d’événements `data:` de la route, terminée par `complete`', () => {
    const blocs = FLUX_IMPORT_DSP.split('\n\n').filter((b) => b.trim());
    const evenements = blocs.map((b) => {
      expect(b.startsWith('data: ')).toBe(true);
      return JSON.parse(b.slice(6)) as { type: string };
    });
    for (const e of evenements) expect(['parsing', 'progress', 'matching', 'rollups', 'complete', 'error']).toContain(e.type);
    expect(evenements.map((e) => e.type)).toEqual(['parsing', 'progress', 'progress', 'matching', 'matching', 'rollups', 'complete']);
  });

  it('le CSV jetable : 20 lignes, 3 codes postaux, une seule campagne « [ESSAI lot 6] campagne »', () => {
    const [entete, ...lignes] = lire('campagne-essai.csv').trim().split('\n');
    expect(entete.split(',')).toEqual(['campaign', 'date', 'city', 'country', 'postal code', 'region', 'tracked ads', 'media', 'unique impressions']);
    expect(lignes).toHaveLength(20);
    const colonnes = lignes.map((l) => l.split(','));
    expect(new Set(colonnes.map((c) => c[0]))).toEqual(new Set(['[ESSAI lot 6] campagne']));
    expect(new Set(colonnes.map((c) => c[4])).size).toBe(3);
    // Aucune ligne en double sur la clé d'agrégation de la route (date|CP|ville|média) : 20 lignes insérées.
    expect(new Set(colonnes.map((c) => [c[1], c[4], c[2], c[7]].join('|'))).size).toBe(20);
  });
});
