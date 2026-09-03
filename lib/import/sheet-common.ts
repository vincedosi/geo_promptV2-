/**
 * MAGELIAN — Primitives partagées par les lecteurs de tableurs.
 *
 * `lib/import/xlsx-reader.ts` (exceljs) et `lib/import/ods-reader.ts` (jszip)
 * rendent tous deux des lignes indexées par en-tête, avec les mêmes règles :
 * en-têtes dédoublonnés, lignes vides ignorées, dates en ISO.
 *
 * Ces règles reproduisent `XLSX.utils.sheet_to_json` (SheetJS), remplacé en
 * 2026-09 : le paquet npm `xlsx` porte deux vulnérabilités hautes sans
 * correctif (prototype pollution GHSA-4r6h-8v6p-xvw6, ReDoS GHSA-5pgg-2g8v-p4x9).
 */

/** Valeur de cellule rendue par les lecteurs de tableur. */
export type SheetCellValue = string | number | boolean | null;

/** Garde-fous anti-déni de service sur un fichier forgé. */
export const SHEET_LIMITS = {
  /** Lignes de données maximum par feuille. */
  maxRows: 500_000,
  /** Colonnes maximum par ligne. */
  maxColumns: 4_096,
} as const;

/**
 * Dédoublonne les en-têtes en suffixant les répétitions (`Code`, `Code_1`).
 * Reproduit le comportement de SheetJS sur un tableur à colonnes homonymes.
 */
export function dedupeHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();

  return headers.map((header) => {
    const count = seen.get(header);
    if (count === undefined) {
      seen.set(header, 0);
      return header;
    }
    const next = count + 1;
    seen.set(header, next);
    return `${header}_${next}`;
  });
}

/** Une ligne dont toutes les cellules sont absentes ou vides est ignorée. */
export function isRowEmpty(cells: readonly SheetCellValue[]): boolean {
  return cells.every((cell) => cell === null || cell === undefined || cell === '');
}

/**
 * Formate une date en `yyyy-mm-dd` sur ses composantes UTC.
 *
 * Les lecteurs de tableur reconstruisent une date à minuit UTC depuis le
 * numéro de série du fichier ; passer par les getters locaux décalerait le
 * jour d'un cran sur un fuseau à l'est de Greenwich (Europe/Paris inclus).
 */
export function formatDateISO(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Assemble des lignes de cellules positionnelles en objets indexés par
 * en-tête. La première ligne fournit les en-têtes ; les colonnes sans en-tête
 * sont écartées (les pipelines d'import résolvent par nom de colonne).
 *
 * L'ordre d'insertion des clés suit l'ordre des colonnes du fichier : le
 * parser Arcom s'appuie dessus (`Object.values(row)[n]` en repli positionnel).
 */
export function rowsToObjects(
  grid: readonly SheetCellValue[][],
  defval: SheetCellValue,
): Record<string, SheetCellValue>[] {
  const headerRow = grid[0];
  if (!headerRow) return [];

  const columns: { index: number; name: string }[] = [];
  const rawNames: string[] = [];

  headerRow.forEach((cell, index) => {
    const name = cell === null || cell === undefined ? '' : String(cell).trim();
    if (name === '') return;
    rawNames.push(name);
    columns.push({ index, name });
  });

  const names = dedupeHeaders(rawNames);
  columns.forEach((column, i) => {
    column.name = names[i];
  });

  const out: Record<string, SheetCellValue>[] = [];

  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    if (isRowEmpty(columns.map((c) => cells[c.index] ?? null))) continue;

    const row: Record<string, SheetCellValue> = {};
    for (const column of columns) {
      const value = cells[column.index];
      row[column.name] = value === undefined || value === null || value === '' ? defval : value;
    }
    out.push(row);
  }

  return out;
}
