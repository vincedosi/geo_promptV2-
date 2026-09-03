/**
 * Contrat du parser d'import DSP (`lib/dsp-mapping/parser.ts`) sur fichier
 * Excel. Consommé par /api/admin/campaigns/import.
 *
 * Avant la migration exceljs, SheetJS rendait les cellules date au format US
 * (« 6/1/26 ») que `castToDataType` refuse : toutes les lignes d'un .xlsx
 * daté partaient en `validationErrors`. Les tests ci-dessous fixent le
 * comportement attendu — dates ISO, lignes valides.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { parseFile, readHeaders } from '@/lib/dsp-mapping/parser';
import type { SourceMapping } from '@/lib/dsp-mapping/types';

const FIX = join(process.cwd(), 'tests', 'fixtures', 'parsers');
const fixture = (name: string) => readFileSync(join(FIX, name));

const mapping = (
  sourceColumn: string,
  targetField: string,
  targetLocation: SourceMapping['targetLocation'],
  dataType: SourceMapping['dataType'],
  isRequired = false,
): SourceMapping => ({
  id: sourceColumn,
  dspSource: 'test',
  sourceColumn,
  targetField,
  targetLocation,
  dataType,
  transform: null,
  isRequired,
  displayOrder: 0,
  notes: null,
});

const MAPPINGS: SourceMapping[] = [
  mapping('Date', 'date', 'core', 'date', true),
  mapping('Postal code', 'postal_code', 'core', 'text', true),
  mapping('Country', 'country', 'core', 'text'),
  mapping('Media', 'media', 'dimension', 'text'),
  mapping('Impressions', 'impressions', 'core', 'bigint'),
  mapping('Clicks', 'clicks', 'core', 'bigint'),
  mapping('Spend', 'spend', 'core', 'numeric'),
];

describe('readHeaders — Excel', () => {
  it('rend les en-têtes dans l\'ordre du fichier', async () => {
    const headers = await readHeaders(fixture('dsp-campaign.xlsx'), 'dsp-campaign.xlsx');

    expect(headers).toEqual([
      'Date',
      'Postal code',
      'Country',
      'Media',
      'Impressions',
      'Clicks',
      'Spend',
    ]);
  });

  it('refuse un .xls binaire', async () => {
    await expect(readHeaders(fixture('legacy.xls'), 'legacy.xls')).rejects.toThrow(/\.xlsx/);
  });
});

describe('parseFile — Excel', () => {
  it('accepte les lignes d\'un fichier à colonne date sans erreur de cast', async () => {
    const result = await parseFile(fixture('dsp-campaign.xlsx'), 'dsp-campaign.xlsx', MAPPINGS);

    expect(result.validationErrors).toEqual([]);
    expect(result.totalRows).toBe(3);
  });

  it('caste chaque colonne selon son data type', async () => {
    const result = await parseFile(fixture('dsp-campaign.xlsx'), 'dsp-campaign.xlsx', MAPPINGS);

    expect(result.rows[0].core).toEqual({
      date: '2026-06-01',
      postal_code: '69001',
      country: 'FR',
      impressions: 15000,
      clicks: 42,
      spend: 123.45,
    });
    expect(result.rows[0].dimensions).toEqual({ media: 'Regie A' });
  });

  it('omet une dimension dont la cellule est vide', async () => {
    const result = await parseFile(fixture('dsp-campaign.xlsx'), 'dsp-campaign.xlsx', MAPPINGS);

    expect(result.rows[2].dimensions).toEqual({});
  });

  it('agrège les totaux et la fenêtre de dates', async () => {
    const result = await parseFile(fixture('dsp-campaign.xlsx'), 'dsp-campaign.xlsx', MAPPINGS);

    expect(result.totalImpressions).toBe(23500);
    expect(result.countries).toEqual(['FR']);
    expect(result.dateStart).toBe('2026-06-01');
    expect(result.dateEnd).toBe('2026-06-03');
  });

  it('déduit le nom de campagne du nom de fichier faute de colonne dédiée', async () => {
    const result = await parseFile(fixture('dsp-campaign.xlsx'), 'dsp-campaign.xlsx', MAPPINGS);

    expect(result.campaignName).toBe('dsp-campaign');
  });

  it('refuse un .xls binaire', async () => {
    await expect(
      parseFile(fixture('legacy.xls'), 'legacy.xls', MAPPINGS),
    ).rejects.toThrow(/\.xlsx/);
  });
});

describe('parseFile — CSV', () => {
  it('reste utilisable sur le chemin CSV', async () => {
    const csv = Buffer.from(
      'Date,Postal code,Country,Media,Impressions,Clicks,Spend\n' +
        '2026-06-01,69001,FR,Regie A,15000,42,123.45\n',
      'utf-8',
    );
    const result = await parseFile(csv, 'export.csv', MAPPINGS);

    expect(result.validationErrors).toEqual([]);
    expect(result.rows[0].core.date).toBe('2026-06-01');
    expect(result.rows[0].core.impressions).toBe(15000);
  });
});
