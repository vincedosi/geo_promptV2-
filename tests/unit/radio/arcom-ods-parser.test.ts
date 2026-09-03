/**
 * Contrat du parser du fichier de référence Arcom (`lib/radio/arcom-ods-parser.ts`).
 * Consommé par /api/radio/import-arcom-ods.
 *
 * Les valeurs attendues ici ont été capturées sur l'implémentation SheetJS
 * avant migration : le lecteur ODS maison doit rendre exactement la même chose.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { aggregateByRadio, parseArcomODS } from '@/lib/radio/arcom-ods-parser';

const FIX = join(process.cwd(), 'tests', 'fixtures', 'parsers');
const fixture = (name: string) => readFileSync(join(FIX, name));

describe('parseArcomODS', () => {
  it('lit un ODS de tableur et rend une entrée par fréquence', async () => {
    const entries = await parseArcomODS(fixture('arcom-sheetjs.ods'));

    expect(entries).toEqual([
      {
        nom_service: 'RADIO ALPHA',
        nom_titulaire: 'ASSOCIATION ALPHA',
        categorie_arcom: 'A',
        categorie_label: 'A - Services associatifs',
        type: 'FM',
        frequence_mhz: 95,
        bloc: null,
      },
      {
        nom_service: 'RADIO BETA',
        nom_titulaire: 'BETA SAS',
        categorie_arcom: 'D',
        categorie_label: 'D - Services thématiques',
        type: 'DAB+',
        frequence_mhz: 192,
        bloc: '6C',
      },
      {
        nom_service: 'RADIO ALPHA',
        nom_titulaire: 'ASSOCIATION ALPHA',
        categorie_arcom: 'A',
        categorie_label: 'A - Services associatifs',
        type: 'FM',
        frequence_mhz: 101.5,
        bloc: null,
      },
    ]);
  });

  it('saute les lignes à catégorie Arcom inconnue et à fréquence illisible', async () => {
    const entries = await parseArcomODS(fixture('arcom-sheetjs.ods'));

    expect(entries.map((e) => e.nom_service)).not.toContain('SANS CATEGORIE');
    expect(entries.map((e) => e.nom_service)).not.toContain('FREQ INVALIDE');
  });

  it('lit un ODS produit par LibreOffice', async () => {
    const entries = await parseArcomODS(fixture('arcom-libreoffice.ods'));

    expect(entries.map((e) => e.nom_service)).toEqual([
      'RADIO GAMMA',
      'RADIO DELTA',
      'RADIO ZETA',
      'RADIO ZETA',
    ]);
    expect(entries[0].frequence_mhz).toBe(88.6);
    expect(entries[1].nom_titulaire).toBe('DELTA GROUPE\nfiliale Nord');
    expect(entries[1].bloc).toBe('11A');
  });

  it('arrondit la fréquence à un décimal', async () => {
    const entries = await parseArcomODS(fixture('arcom-libreoffice.ods'));

    expect(entries[2].frequence_mhz).toBe(90.1);
  });

  it('refuse un classeur qui n\'est pas un ODS', async () => {
    await expect(parseArcomODS(fixture('simple.xlsx'))).rejects.toThrow();
  });

  it('lit aussi un référentiel réenregistré en .xlsx', async () => {
    // L'écran d'import radio accepte .ods et .xlsx : un opérateur qui
    // réenregistre le fichier Arcom depuis Excel doit rester servi.
    const entries = await parseArcomODS(await buildArcomXlsx(), 'arcom.xlsx');

    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      nom_service: 'RADIO OMEGA',
      nom_titulaire: 'OMEGA SAS',
      categorie_arcom: 'C',
      categorie_label: 'C - Services locaux',
      type: 'FM',
      frequence_mhz: 99.9,
      bloc: null,
    });
  });
});

/** Référentiel Arcom minimal au format xlsx, fabriqué en mémoire. */
async function buildArcomXlsx(): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Radios');
  sheet.addRow(['Nom du service', 'Nom du titulaire', 'Catégorie', 'Type', 'Fréquence', 'Bloc']);
  sheet.addRow(['RADIO OMEGA', 'OMEGA SAS', 'C - Services locaux', 'FM', '99,90 MHz', null]);
  const written = await workbook.xlsx.writeBuffer();
  return Buffer.from(written as ArrayBuffer);
}

describe('aggregateByRadio', () => {
  it('regroupe les fréquences par service et déduit la portée', async () => {
    const entries = await parseArcomODS(fixture('arcom-sheetjs.ods'));
    const [alpha, beta] = aggregateByRadio(entries);

    expect(alpha.nom).toBe('RADIO ALPHA');
    expect(alpha.frequences_fm).toEqual([95, 101.5]);
    expect(alpha.nb_frequences_total).toBe(2);
    expect(alpha.portee).toBe('locale');

    expect(beta.frequences_dab).toEqual([192]);
    expect(beta.blocs_dab).toEqual(['6C']);
  });

  it('dédoublonne une fréquence répétée', async () => {
    const entries = await parseArcomODS(fixture('arcom-libreoffice.ods'));
    const zeta = aggregateByRadio(entries).find((a) => a.nom === 'RADIO ZETA');

    expect(zeta!.frequences_fm).toEqual([90.1]);
    expect(zeta!.nb_frequences_total).toBe(1);
  });
});
