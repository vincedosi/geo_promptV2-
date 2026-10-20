/**
 * La fixture d'analyse de l'import POI (lot 6, T12) EST ce que la route rendrait pour
 * `tests/fixtures/admin/poi-essai.csv` : mêmes fonctions que `app/api/admin/import-poi/parse/route.ts`
 * (`parseFile`, `detectColumns`, `suggestMapping`, aperçu des 5 premières lignes, taille du fichier).
 * Seul `fileId` (un `randomUUID()` de la route) est libre.
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFile } from '@/lib/import/file-parser';
import { detectColumns, suggestMapping } from '@/lib/import/column-detector';
import { ANALYSE_POI_ESSAI } from '../../../angular/src/app/features/admin/import/testing/import-poi.fixture';

const CSV = join(process.cwd(), 'tests', 'fixtures', 'admin', 'poi-essai.csv');

describe('fixture de l’import POI (T12) = sortie de la route sur poi-essai.csv', () => {
  it('format, encodage, séparateur, lignes, colonnes, suggestion, aperçu et taille', async () => {
    const buffer = readFileSync(CSV);
    const lu = await parseFile(buffer, 'poi-essai.csv');
    const colonnes = detectColumns(lu.rows);
    const { fileId: _id, ...fixture } = ANALYSE_POI_ESSAI;
    expect(fixture).toEqual({
      success: true,
      fileName: 'poi-essai.csv',
      fileSize: statSync(CSV).size,
      format: lu.format,
      encoding: lu.encoding,
      separator: lu.separator,
      totalRows: lu.totalRows,
      columns: colonnes,
      preview: lu.rows.slice(0, 5),
      suggestedMapping: suggestMapping(colonnes.map((c) => c.name)),
    });
  });

  it('le fichier jetable : 10 lignes, toutes nommées `[ESSAI lot 6]`', () => {
    const lignes = readFileSync(CSV, 'utf-8').trim().split('\n').slice(1);
    expect(lignes).toHaveLength(10);
    for (const l of lignes) expect(l.startsWith('[ESSAI lot 6] ')).toBe(true);
  });
});
