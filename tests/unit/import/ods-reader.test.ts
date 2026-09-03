/**
 * Contrat du lecteur ODS maison — exceljs ne sait pas lire OpenDocument.
 *
 * Un .ods est une archive zip contenant content.xml ; le lecteur s'appuie sur
 * jszip (déjà utilisé ailleurs dans le projet).
 *
 * Deux fixtures : une écrite par SheetJS, une fabriquée à la main pour
 * reproduire les tics de LibreOffice (colonnes répétées, text:p multiples,
 * office:value distinct du texte affiché, lignes répétées).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { readOdsSheetRows } from '@/lib/import/ods-reader';

const FIX = join(process.cwd(), 'tests', 'fixtures', 'parsers');
const fixture = (name: string) => readFileSync(join(FIX, name));

describe('readOdsSheetRows', () => {
  it('lit un ODS écrit par un tableur et respecte l\'ordre des colonnes', async () => {
    const rows = await readOdsSheetRows(fixture('arcom-sheetjs.ods'));

    expect(Object.keys(rows[0])).toEqual([
      'Nom du service',
      'Nom du titulaire',
      'Catégorie',
      'Type',
      'Fréquence',
      'Bloc',
    ]);
    expect(rows[0]['Nom du service']).toBe('RADIO ALPHA');
  });

  it('remplace les cellules absentes par defval', async () => {
    const rows = await readOdsSheetRows(fixture('arcom-sheetjs.ods'), { defval: '' });

    expect(rows[0].Bloc).toBe('');
  });

  it('rend les cellules numériques comme nombres', async () => {
    const rows = await readOdsSheetRows(fixture('arcom-libreoffice.ods'), { defval: '' });

    expect(rows[0].Fréquence).toBe(88.6);
    expect(rows[1].Fréquence).toBe(210);
  });

  it('joint les paragraphes multiples d\'une cellule par un retour ligne', async () => {
    const rows = await readOdsSheetRows(fixture('arcom-libreoffice.ods'), { defval: '' });

    expect(rows[1]['Nom du titulaire']).toBe('DELTA GROUPE\nfiliale Nord');
  });

  it('développe table:number-columns-repeated en cellules distinctes', async () => {
    const rows = await readOdsSheetRows(fixture('arcom-libreoffice.ods'), { defval: '' });
    const epsilon = rows.find((r) => r['Nom du service'] === 'RADIO EPSILON');

    expect(epsilon).toBeDefined();
    expect(epsilon!['Nom du titulaire']).toBe('');
    expect(epsilon!['Catégorie']).toBe('');
    expect(epsilon!.Type).toBe('FM');
  });

  it('développe table:number-rows-repeated en lignes distinctes', async () => {
    const rows = await readOdsSheetRows(fixture('arcom-libreoffice.ods'), { defval: '' });
    const zeta = rows.filter((r) => r['Nom du service'] === 'RADIO ZETA');

    expect(zeta).toHaveLength(2);
  });

  it('ignore les lignes entièrement vides', async () => {
    const rows = await readOdsSheetRows(fixture('arcom-libreoffice.ods'), { defval: '' });

    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r['Nom du service'] !== '')).toBe(true);
  });

  it('déduplique les en-têtes identiques avec un suffixe', async () => {
    const rows = await readOdsSheetRows(await buildOds([
      ['Code', 'Code', 'Valeur'],
      ['A', 'B', '1'],
    ]), { defval: '' });

    expect(Object.keys(rows[0])).toEqual(['Code', 'Code_1', 'Valeur']);
  });

  it('rejette une archive sans content.xml', async () => {
    await expect(readOdsSheetRows(fixture('simple.xlsx'))).rejects.toThrow(/ODS/i);
  });

  it('restitue les espaces et sauts de ligne encodés par LibreOffice', async () => {
    // LibreOffice n'écrit pas deux espaces consécutifs en clair : il pose un
    // <text:s/> (ou <text:s text:c="n"/>), et un retour ligne devient
    // <text:line-break/>.
    const cells =
      '<table:table-cell office:value-type="string"><text:p>Nom</text:p></table:table-cell>';
    const spaced =
      '<table:table-cell office:value-type="string">' +
      '<text:p>RADIO<text:s text:c="2"/>ALPHA<text:line-break/>Nord</text:p>' +
      '</table:table-cell>';
    const rows = await readOdsSheetRows(
      await buildRawOds(`<table:table-row>${cells}</table:table-row>` +
        `<table:table-row>${spaced}</table:table-row>`),
      { defval: '' },
    );

    expect(rows[0].Nom).toBe('RADIO  ALPHA\nNord');
  });
});

/** Fabrique un .ods minimal en mémoire pour les cas non couverts par les fixtures. */
async function buildOds(aoa: string[][]): Promise<Buffer> {
  const cell = (v: string) =>
    `<table:table-cell office:value-type="string"><text:p>${v}</text:p></table:table-cell>`;
  const rows = aoa
    .map((r) => `<table:table-row>${r.map(cell).join('')}</table:table-row>`)
    .join('');
  return buildRawOds(rows);
}

/** Empaquette des `<table:table-row>` brutes dans une archive ODS valide. */
async function buildRawOds(rows: string): Promise<Buffer> {
  const JSZip = (await import('jszip')).default;
  const content =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<office:document-content' +
    ' xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"' +
    ' xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"' +
    ' xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">' +
    `<office:body><office:spreadsheet><table:table table:name="F1">${rows}</table:table>` +
    '</office:spreadsheet></office:body></office:document-content>';

  const zip = new JSZip();
  zip.file('mimetype', 'application/vnd.oasis.opendocument.spreadsheet');
  zip.file('content.xml', content);
  return zip.generateAsync({ type: 'nodebuffer' });
}
