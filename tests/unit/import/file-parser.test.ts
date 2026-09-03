/**
 * Contrat de l'import universel (`lib/import/file-parser.ts`).
 *
 * Consommé par /api/admin/import-poi/{parse,dry-run,execute} et
 * /api/admin/geocode/batch. Les chemins CSV et GeoJSON sont couverts ici
 * parce que `parseFile` devient asynchrone pour tous les formats.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { parseFile } from '@/lib/import/file-parser';

const FIX = join(process.cwd(), 'tests', 'fixtures', 'parsers');
const fixture = (name: string) => readFileSync(join(FIX, name));

describe('parseFile — Excel', () => {
  it('rend les cellules en chaînes trimées', async () => {
    const parsed = await parseFile(fixture('simple.xlsx'), 'simple.xlsx');

    expect(parsed.rows[0].Nom).toBe('Lyon');
    expect(parsed.rows[0].Population).toBe('522969');
  });

  it('formate les dates en ISO yyyy-mm-dd', async () => {
    const parsed = await parseFile(fixture('simple.xlsx'), 'simple.xlsx');

    expect(parsed.rows[0].Date).toBe('2026-01-15');
    expect(parsed.rows[1].Date).toBe('2026-12-31');
  });

  it('convertit les valeurs NA-like et les cellules vides en null', async () => {
    const parsed = await parseFile(fixture('simple.xlsx'), 'simple.xlsx');

    expect(parsed.rows[1].Note).toBeNull(); // 'NA'
    expect(parsed.rows[2].Note).toBeNull(); // 'N/A'
    expect(parsed.rows[3].Note).toBeNull(); // 'NULL'
    expect(parsed.rows[0].Vide).toBeNull();
  });

  it('préserve un zéro numérique au lieu de le nullifier', async () => {
    const parsed = await parseFile(fixture('simple.xlsx'), 'simple.xlsx');

    expect(parsed.rows[1].Prix).toBe('0');
    expect(parsed.rows[3].Population).toBe('0');
  });

  it('décrit le fichier lu', async () => {
    const parsed = await parseFile(fixture('simple.xlsx'), 'simple.xlsx');

    expect(parsed.format).toBe('xlsx');
    expect(parsed.encoding).toBe('binary');
    expect(parsed.separator).toBe('xlsx');
    expect(parsed.totalRows).toBe(4);
  });

  it('saute une première feuille vide', async () => {
    const parsed = await parseFile(fixture('empty-first-sheet.xlsx'), 'empty-first-sheet.xlsx');

    expect(parsed.rows).toEqual([{ Code: 'A1', Valeur: '42' }]);
  });

  it('refuse un .xls binaire en indiquant la conversion à faire', async () => {
    await expect(parseFile(fixture('legacy.xls'), 'legacy.xls')).rejects.toThrow(/\.xlsx/);
  });
});

describe('parseFile — CSV', () => {
  it('détecte le point-virgule comme séparateur', async () => {
    const csv = Buffer.from('Nom;Population\nLyon;522969\nLille;236234\n', 'utf-8');
    const parsed = await parseFile(csv, 'villes.csv');

    expect(parsed.separator).toBe(';');
    expect(parsed.format).toBe('csv');
    expect(parsed.rows).toEqual([
      { Nom: 'Lyon', Population: '522969' },
      { Nom: 'Lille', Population: '236234' },
    ]);
  });

  it('bascule en latin-1 quand l\'UTF-8 échoue', async () => {
    const parsed = await parseFile(Buffer.from([0x4e, 0x6f, 0x6d, 0x0a, 0x4c, 0x79, 0xe9]), 'x.csv');

    expect(parsed.encoding).toBe('latin-1');
    expect(parsed.rows[0].Nom).toBe('Lyé');
  });
});

describe('parseFile — GeoJSON', () => {
  it('aplatit les propriétés et extrait les coordonnées', async () => {
    const geojson = Buffer.from(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { nom: 'Panneau A', actif: true },
            geometry: { type: 'Point', coordinates: [4.85, 45.75] },
          },
        ],
      }),
      'utf-8',
    );
    const parsed = await parseFile(geojson, 'panneaux.geojson');

    expect(parsed.rows[0]).toEqual({
      nom: 'Panneau A',
      actif: 'true',
      _geojson_lng: '4.85',
      _geojson_lat: '45.75',
    });
  });

  it('rejette un GeoJSON sans tableau features', async () => {
    const bad = Buffer.from(JSON.stringify({ type: 'Point' }), 'utf-8');

    await expect(parseFile(bad, 'x.geojson')).rejects.toThrow(/features/);
  });
});

describe('parseFile — formats refusés', () => {
  it('renvoie la liste des formats acceptés pour une extension inconnue', async () => {
    await expect(parseFile(Buffer.from('x'), 'fichier.pdf')).rejects.toThrow(/Formats acceptés/);
  });

  it('renvoie une consigne multi-fichiers pour un .shp seul', async () => {
    await expect(parseFile(Buffer.from('x'), 'zones.shp')).rejects.toThrow(/complémentaires/);
  });
});
