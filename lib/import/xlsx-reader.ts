/**
 * MAGELIAN — Lecteur XLSX (exceljs).
 *
 * Remplace `XLSX.utils.sheet_to_json` de SheetJS, retiré en 2026-09 pour
 * cause de vulnérabilités hautes sans correctif sur le paquet npm.
 *
 * Écarts assumés vis-à-vis de SheetJS :
 *  - les cellules date sortent en `yyyy-mm-dd` et non au format d'affichage
 *    du fichier (SheetJS rendait « 1/15/26», inexploitable en import) ;
 *  - le format binaire `.xls` (Excel 97-2003) n'est plus lu — exceljs ne
 *    sait pas le décoder. L'erreur demande une conversion en `.xlsx`.
 */
import ExcelJS from 'exceljs';
import {
  formatDateISO,
  rowsToObjects,
  SHEET_LIMITS,
  type SheetCellValue,
} from './sheet-common';

export interface ReadXlsxOptions {
  /** Valeur substituée aux cellules absentes ou vides. Défaut : `null`. */
  defval?: SheetCellValue;
  /**
   * `false` (défaut) rend toutes les cellules en chaînes ; `true` conserve
   * les nombres et booléens dans leur type natif.
   */
  raw?: boolean;
  /**
   * `'first'` (défaut) lit la première feuille, même vide.
   * `'firstNonEmpty'` retient la première feuille comportant des données.
   */
  sheet?: 'first' | 'firstNonEmpty';
}

const UNREADABLE =
  'Classeur illisible. Le format binaire .xls (Excel 97-2003) n\'est pas ' +
  'supporté : enregistrez le fichier en .xlsx depuis Excel ou LibreOffice.';

/**
 * Lit une feuille d'un classeur XLSX en lignes indexées par en-tête.
 *
 * @throws si le buffer n'est pas un classeur OOXML lisible (`.xls` binaire inclus).
 */
export async function readXlsxSheetRows(
  buffer: Buffer,
  options: ReadXlsxOptions = {},
): Promise<Record<string, SheetCellValue>[]> {
  const { defval = null, raw = false, sheet = 'first' } = options;

  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs déclare son propre `interface Buffer extends ArrayBuffer`, que
    // TypeScript juge incompatible avec le Buffer de Node (un Uint8Array).
    // Le runtime, lui, accepte les deux : le cast reste local à cet appel.
    await workbook.xlsx.load(buffer as unknown as Parameters<ExcelJS.Xlsx['load']>[0]);
  } catch {
    throw new Error(UNREADABLE);
  }

  const worksheets = workbook.worksheets;
  if (worksheets.length === 0) return [];

  if (sheet === 'firstNonEmpty') {
    for (const worksheet of worksheets) {
      const rows = rowsToObjects(readGrid(worksheet, raw), defval);
      if (rows.length > 0) return rows;
    }
    return [];
  }

  return rowsToObjects(readGrid(worksheets[0], raw), defval);
}

/** Extrait la feuille en grille positionnelle (index 0 = colonne A). */
function readGrid(worksheet: ExcelJS.Worksheet, raw: boolean): SheetCellValue[][] {
  const grid: SheetCellValue[][] = [];

  worksheet.eachRow({ includeEmpty: false }, (row) => {
    if (grid.length >= SHEET_LIMITS.maxRows) {
      throw new Error(
        `Fichier trop volumineux : plus de ${SHEET_LIMITS.maxRows} lignes sur une feuille.`,
      );
    }

    // `row.values` est indexé à partir de 1 (index 0 inutilisé par exceljs).
    const values = row.values as ExcelJS.CellValue[];
    const width = Math.min(values.length - 1, SHEET_LIMITS.maxColumns);
    const cells: SheetCellValue[] = [];

    for (let column = 1; column <= width; column++) {
      cells.push(convertCell(values[column], raw));
    }

    grid.push(cells);
  });

  return grid;
}

/** Ramène une valeur de cellule exceljs à un scalaire. */
function convertCell(value: ExcelJS.CellValue, raw: boolean): SheetCellValue {
  const native = toNative(value);

  if (native === null) return null;
  if (raw) return native;
  return typeof native === 'string' ? native : String(native);
}

/**
 * Déballe les formes composées d'exceljs : texte enrichi, lien hypertexte,
 * formule (on retient le résultat calculé) et cellule en erreur.
 */
function toNative(value: ExcelJS.CellValue): SheetCellValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return formatDateISO(value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }

  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((fragment) => fragment.text).join('');
    }
    if ('result' in value) return toNative(value.result as ExcelJS.CellValue);
    if ('text' in value) return String(value.text);
    if ('error' in value) return String(value.error);
  }

  return String(value);
}
