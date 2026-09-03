/**
 * Contrat du lecteur XLSX (exceljs) — remplace `XLSX.utils.sheet_to_json`.
 *
 * Les fixtures binaires ont été écrites par SheetJS (writer indépendant
 * d'exceljs) : voir tests/fixtures/parsers/README.md.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { readXlsxSheetRows } from '@/lib/import/xlsx-reader';

const FIX = join(process.cwd(), 'tests', 'fixtures', 'parsers');
const fixture = (name: string) => readFileSync(join(FIX, name));

describe('readXlsxSheetRows', () => {
  it('utilise la première ligne comme en-têtes, dans l\'ordre des colonnes', async () => {
    const rows = await readXlsxSheetRows(fixture('simple.xlsx'));

    expect(Object.keys(rows[0])).toEqual(['Nom', 'Population', 'Prix', 'Date', 'Note', 'Vide']);
  });

  it('rend les valeurs en chaînes sans les trimer quand raw est false', async () => {
    const rows = await readXlsxSheetRows(fixture('simple.xlsx'));

    expect(rows[0].Nom).toBe('  Lyon  ');
    expect(rows[0].Population).toBe('522969');
    expect(rows[0].Prix).toBe('1234.5');
  });

  it('rend un zéro numérique comme "0" et non comme valeur vide', async () => {
    const rows = await readXlsxSheetRows(fixture('simple.xlsx'));

    expect(rows[1].Prix).toBe('0');
    expect(rows[3].Population).toBe('0');
  });

  it('formate les cellules date en ISO yyyy-mm-dd', async () => {
    const rows = await readXlsxSheetRows(fixture('simple.xlsx'));

    expect(rows[0].Date).toBe('2026-01-15');
    expect(rows[1].Date).toBe('2026-12-31');
  });

  it('remplace les cellules absentes par defval', async () => {
    const nullDefault = await readXlsxSheetRows(fixture('simple.xlsx'));
    const emptyString = await readXlsxSheetRows(fixture('simple.xlsx'), { defval: '' });

    expect(nullDefault[0].Vide).toBeNull();
    expect(emptyString[0].Vide).toBe('');
  });

  it('conserve les types natifs quand raw est true', async () => {
    const rows = await readXlsxSheetRows(fixture('simple.xlsx'), { raw: true });

    expect(rows[0].Population).toBe(522969);
    expect(rows[0].Prix).toBe(1234.5);
  });

  it('lit la première feuille par défaut, même vide', async () => {
    const rows = await readXlsxSheetRows(fixture('empty-first-sheet.xlsx'));

    expect(rows).toEqual([]);
  });

  it('saute les feuilles vides quand sheet vaut firstNonEmpty', async () => {
    const rows = await readXlsxSheetRows(fixture('empty-first-sheet.xlsx'), {
      sheet: 'firstNonEmpty',
    });

    expect(rows).toEqual([{ Code: 'A1', Valeur: '42' }]);
  });

  it('ignore les lignes entièrement vides', async () => {
    const rows = await readXlsxSheetRows(fixture('simple.xlsx'));

    expect(rows).toHaveLength(4);
  });

  it('rejette un classeur binaire .xls avec un message actionnable', async () => {
    await expect(readXlsxSheetRows(fixture('legacy.xls'))).rejects.toThrow(/\.xlsx/);
  });
});
