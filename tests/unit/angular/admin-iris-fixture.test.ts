/**
 * Le flux NDJSON rejoué par les specs Angular de l'IRIS crawler (lot 6, T15) est le MÊME que celui que
 * la preuve navigateur sert aux deux écrans, React et Angular, par interception (régime C12 c).
 *
 * Les specs Angular ne peuvent rien importer hors d'`angular/` (`isolement.test.ts`) : elles en
 * gardent une copie en TypeScript. Sans ce test, la copie et le fichier dériveraient, et les specs
 * prouveraient un rendu sur un flux que le navigateur ne voit jamais.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FLUX_IMPORT_IRIS } from '../../../angular/src/app/features/admin/iris-crawler/testing/iris-manual-import.fixture';

const RACINE = path.resolve(__dirname, '../../..');

describe('fixture du flux d’import IRIS (lot 6, T15)', () => {
  it('la copie TypeScript des specs Angular est identique à l’octet au fichier NDJSON', () => {
    const fichier = readFileSync(path.join(RACINE, 'tests/fixtures/admin/iris-manual-import.ndjson'), 'utf8').replace(/\r\n/g, '\n');
    expect(FLUX_IMPORT_IRIS).toBe(fichier);
  });

  it('chaque ligne est un événement de la route (`type` et `message`), et le flux se termine par `done`', () => {
    const evenements = FLUX_IMPORT_IRIS.trim().split('\n').map((l) => JSON.parse(l) as { type: string; message: string });
    for (const e of evenements) {
      expect(['log', 'status', 'progress', 'error', 'done']).toContain(e.type);
      expect(typeof e.message).toBe('string');
    }
    expect(evenements.at(-1)?.type).toBe('done');
  });

  it('réponse de suppression de TOUS les IRIS (T19), servie par interception aux deux écrans : la forme de la route, au compte de référence', () => {
    // `DELETE /api/admin/iris/delete` n'est JAMAIS joué en preuve (régime C12 c) : il efface la table `iris`.
    const route = readFileSync(path.join(RACINE, 'app/api/admin/iris/delete/route.ts'), 'utf8');
    expect(route).toContain('NextResponse.json({ success: true, deleted: count })');
    const corps = JSON.parse(readFileSync(path.join(RACINE, 'tests/fixtures/admin/iris-delete.json'), 'utf8')) as Record<string, unknown>;
    expect(corps).toEqual({ success: true, deleted: 49448 });
  });
});
