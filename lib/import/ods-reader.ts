/**
 * MAGELIAN — Lecteur ODS (OpenDocument Spreadsheet).
 *
 * exceljs ne lit pas OpenDocument, et le fichier de référence Arcom
 * (`/api/radio/import-arcom-ods`) n'existe qu'en `.ods`. Un ODS est une
 * archive zip dont `content.xml` porte le tableau : on l'ouvre avec jszip
 * (déjà utilisé ailleurs dans le projet) et on parcourt le XML.
 *
 * Seule la première feuille est lue, comme le faisait SheetJS.
 *
 * Le balayage est linéaire — pas d'arbre DOM en mémoire — et borné par
 * `SHEET_LIMITS` : un `table:number-columns-repeated` forgé ne peut pas
 * faire exploser la mémoire du serveur.
 */
import JSZip from 'jszip';
import {
  isRowEmpty,
  rowsToObjects,
  SHEET_LIMITS,
  type SheetCellValue,
} from './sheet-common';

export interface ReadOdsOptions {
  /** Valeur substituée aux cellules absentes ou vides. Défaut : `null`. */
  defval?: SheetCellValue;
}

/** Balise ou fermeture de balise, attributs quotés inclus. */
const TAG = /<(\/?)([\w:-]+)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;

/**
 * Lit la première feuille d'un fichier ODS en lignes indexées par en-tête.
 *
 * @throws si le buffer n'est pas une archive ODS exploitable.
 */
export async function readOdsSheetRows(
  buffer: Buffer,
  options: ReadOdsOptions = {},
): Promise<Record<string, SheetCellValue>[]> {
  const { defval = null } = options;
  const content = await readContentXml(buffer);
  return rowsToObjects(parseFirstTable(content), defval);
}

/** Extrait `content.xml` de l'archive. */
async function readContentXml(buffer: Buffer): Promise<string> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new Error('Fichier ODS illisible : archive OpenDocument invalide.');
  }

  const entry = zip.file('content.xml');
  if (!entry) {
    throw new Error(
      'Fichier ODS invalide : content.xml absent de l\'archive. ' +
        'Enregistrez le fichier au format OpenDocument (.ods).',
    );
  }

  return entry.async('string');
}

/** Cellule en cours de lecture pendant le balayage. */
interface PendingCell {
  valueType: string | null;
  officeValue: string | null;
  repeat: number;
  paragraphs: string[];
}

/**
 * Parcourt le XML jusqu'à la fin de la première `<table:table>` et rend une
 * grille positionnelle (index 0 = colonne A).
 */
function parseFirstTable(xml: string): SheetCellValue[][] {
  const start = xml.indexOf('<table:table ');
  if (start === -1) return [];

  const grid: SheetCellValue[][] = [];

  let row: SheetCellValue[] | null = null;
  let rowRepeat = 1;
  let cell: PendingCell | null = null;
  /** Cellules vides en attente : matérialisées seulement si une cellule remplie suit. */
  let pendingEmpty = 0;
  let paragraphDepth = 0;
  let paragraph = '';
  let cursor = start;

  TAG.lastIndex = start;

  let match: RegExpExecArray | null;
  while ((match = TAG.exec(xml)) !== null) {
    const [full, closing, name, attributes, selfClosing] = match;

    if (paragraphDepth > 0) {
      paragraph += xml.slice(cursor, match.index);
    }
    cursor = match.index + full.length;

    const isClose = closing === '/';
    const isSelfClose = selfClosing === '/';

    switch (name) {
      case 'table:table':
        if (isClose) return grid;
        break;

      case 'table:table-row':
        if (isClose || isSelfClose) {
          if (row) pushRow(grid, row, rowRepeat);
          row = null;
          pendingEmpty = 0;
          if (isSelfClose) break;
        }
        if (!isClose) {
          row = [];
          rowRepeat = clampRepeat(readAttribute(attributes, 'table:number-rows-repeated'));
          pendingEmpty = 0;
        }
        break;

      case 'table:table-cell':
      case 'table:covered-table-cell': {
        if (isClose) {
          if (row && cell) pendingEmpty = appendCell(row, cell, pendingEmpty);
          cell = null;
          break;
        }

        const pending: PendingCell = {
          valueType: readAttribute(attributes, 'office:value-type'),
          officeValue:
            readAttribute(attributes, 'office:value') ??
            readAttribute(attributes, 'office:boolean-value') ??
            readAttribute(attributes, 'office:date-value') ??
            readAttribute(attributes, 'office:time-value') ??
            readAttribute(attributes, 'office:string-value'),
          repeat: clampRepeat(readAttribute(attributes, 'table:number-columns-repeated')),
          paragraphs: [],
        };

        if (isSelfClose) {
          if (row) pendingEmpty = appendCell(row, pending, pendingEmpty);
        } else {
          cell = pending;
        }
        break;
      }

      case 'text:p':
        if (isSelfClose) {
          cell?.paragraphs.push('');
          break;
        }
        if (isClose) {
          paragraphDepth = Math.max(0, paragraphDepth - 1);
          if (paragraphDepth === 0) {
            cell?.paragraphs.push(decodeEntities(paragraph));
            paragraph = '';
          }
          break;
        }
        paragraphDepth += 1;
        break;

      // LibreOffice n'écrit pas les espaces consécutifs, les tabulations ni
      // les retours ligne en clair : il pose des balises dédiées.
      case 'text:s':
        if (!isClose && paragraphDepth > 0) {
          paragraph += ' '.repeat(clampRepeat(readAttribute(attributes, 'text:c')));
        }
        break;

      case 'text:tab':
        if (!isClose && paragraphDepth > 0) paragraph += '\t';
        break;

      case 'text:line-break':
        if (!isClose && paragraphDepth > 0) paragraph += '\n';
        break;

      default:
        break;
    }
  }

  if (row) pushRow(grid, row, rowRepeat);
  return grid;
}

/** Ajoute une cellule (et ses répétitions) à la ligne courante. */
function appendCell(
  row: SheetCellValue[],
  cell: PendingCell,
  pendingEmpty: number,
): number {
  const value = resolveCellValue(cell);

  if (value === null) {
    // On diffère : LibreOffice clôt chaque ligne par un millier de cellules
    // vides répétées, inutile de les matérialiser.
    return pendingEmpty + cell.repeat;
  }

  const budget = SHEET_LIMITS.maxColumns - row.length;
  if (budget <= 0) return 0;

  for (let i = 0; i < Math.min(pendingEmpty, budget); i++) row.push(null);

  const remaining = SHEET_LIMITS.maxColumns - row.length;
  for (let i = 0; i < Math.min(cell.repeat, remaining); i++) row.push(value);

  return 0;
}

/** Empile une ligne et ses répétitions, en écartant les lignes vides. */
function pushRow(grid: SheetCellValue[][], row: SheetCellValue[], repeat: number): void {
  if (row.length === 0 || isRowEmpty(row)) return;

  for (let i = 0; i < repeat; i++) {
    if (grid.length >= SHEET_LIMITS.maxRows) {
      throw new Error(
        `Fichier trop volumineux : plus de ${SHEET_LIMITS.maxRows} lignes sur une feuille.`,
      );
    }
    grid.push(i === 0 ? row : [...row]);
  }
}

/**
 * Rend la valeur d'une cellule : le nombre porté par `office:value` pour les
 * types numériques, le texte affiché sinon. C'est la sémantique de SheetJS en
 * mode brut, dont dépend le parser Arcom.
 */
function resolveCellValue(cell: PendingCell): SheetCellValue {
  const text = cell.paragraphs.join('\n');

  switch (cell.valueType) {
    case 'float':
    case 'percentage':
    case 'currency': {
      const parsed = Number(cell.officeValue);
      if (Number.isFinite(parsed)) return parsed;
      break;
    }
    case 'boolean':
      if (cell.officeValue !== null) return cell.officeValue === 'true';
      break;
    case 'date':
    case 'time':
      if (cell.officeValue !== null) return cell.officeValue;
      break;
    default:
      break;
  }

  return text === '' ? null : text;
}

/**
 * Attributs lus pendant le balayage. Les motifs sont compilés une fois : le
 * référentiel Arcom fait ~10 000 lignes, soit autant de compilations évitées
 * par attribut et par cellule.
 */
const ATTRIBUTE_PATTERNS = {
  'office:value-type': /office:value-type\s*=\s*"([^"]*)"/,
  'office:value': /office:value\s*=\s*"([^"]*)"/,
  'office:boolean-value': /office:boolean-value\s*=\s*"([^"]*)"/,
  'office:date-value': /office:date-value\s*=\s*"([^"]*)"/,
  'office:time-value': /office:time-value\s*=\s*"([^"]*)"/,
  'office:string-value': /office:string-value\s*=\s*"([^"]*)"/,
  'table:number-columns-repeated': /table:number-columns-repeated\s*=\s*"([^"]*)"/,
  'table:number-rows-repeated': /table:number-rows-repeated\s*=\s*"([^"]*)"/,
  'text:c': /text:c\s*=\s*"([^"]*)"/,
} as const;

/** Lit un attribut sur la chaîne d'attributs brute d'une balise. */
function readAttribute(
  attributes: string,
  name: keyof typeof ATTRIBUTE_PATTERNS,
): string | null {
  const found = attributes.match(ATTRIBUTE_PATTERNS[name]);
  return found ? decodeEntities(found[1]) : null;
}

/** Un compteur de répétition absent, illisible ou hors bornes vaut 1. */
function clampRepeat(raw: string | null): number {
  if (raw === null) return 1;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, SHEET_LIMITS.maxColumns);
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: '\'',
};

/** Décode les entités XML nommées et numériques. */
function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;

  return text.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (whole, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[entity] ?? whole;
  });
}
