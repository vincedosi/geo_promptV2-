/**
 * Lecture d'un plan de régie .xlsx en grilles POSITIONNELLES (spec 2026-10-16-ooh-campagnes § 7).
 *
 * `readXlsxSheetRows` (lib/import/xlsx-reader.ts) rend des objets par en-tête de PREMIÈRE ligne : un plan de régie a
 * son en-tête en ligne 3 ou 4, des blocs côte à côte (gares IDF et province), des sections et des notes. Les
 * adaptateurs ont besoin des numéros de ligne et des colonnes telles quelles. Le déballage des cellules (texte
 * enrichi, formule, date → ISO) est celui de `toNative`, une seule définition.
 */
import ExcelJS from 'exceljs';
import { toNative } from '@/lib/import/xlsx-reader';
import type { Cellule, Classeur, Feuille, LigneFeuille } from '@/types/campagnes-media';

/** Garde-fou d'un fichier forgé : au-delà, la lecture échoue plutôt que de saturer la mémoire. */
const LIGNES_MAX = 50_000;

/**
 * Lit toutes les feuilles d'un classeur.
 *
 * @throws si le contenu n'est pas un .xlsx lisible, ou si une feuille dépasse `LIGNES_MAX` lignes.
 */
export async function lireClasseur(contenu: Buffer): Promise<Classeur> {
  const classeur = new ExcelJS.Workbook();
  try {
    // Même cast local que lib/import/xlsx-reader.ts : le Buffer d'exceljs n'est pas celui de Node pour TypeScript.
    await classeur.xlsx.load(contenu as unknown as Parameters<ExcelJS.Xlsx['load']>[0]);
  } catch {
    throw new Error('Classeur illisible : le plan doit être un fichier .xlsx (le format .xls n\'est pas lu).');
  }
  const feuilles = new Map<string, Feuille>();
  for (const feuille of classeur.worksheets) {
    const lignes: LigneFeuille[] = [];
    feuille.eachRow({ includeEmpty: false }, (rang, numero) => {
      if (lignes.length >= LIGNES_MAX) throw new Error(`Feuille « ${feuille.name} » : plus de ${LIGNES_MAX} lignes.`);
      const valeurs = rang.values as ExcelJS.CellValue[];
      const cellules: Cellule[] = [];
      for (let c = 1; c < valeurs.length; c++) cellules.push(toNative(valeurs[c]));
      lignes.push({ numero, cellules });
    });
    feuilles.set(feuille.name, { nom: feuille.name, lignes });
  }
  return { feuilles };
}

/**
 * La première ligne d'en-tête reconnue d'un classeur, feuille après feuille, ligne après ligne : c'est ainsi qu'un
 * adaptateur trouve sa liste sans dépendre du nom de l'onglet. `reconnaitre` rend ce qu'il a tiré de la ligne
 * (colonnes, index…) ou `null`.
 */
export function trouverEntete<T>(
  classeur: Classeur, reconnaitre: (ligne: LigneFeuille) => T | null,
): { feuille: Feuille; iEntete: number; entete: T } | null {
  for (const feuille of classeur.feuilles.values()) {
    for (let i = 0; i < feuille.lignes.length; i++) {
      const entete = reconnaitre(feuille.lignes[i]);
      if (entete !== null) return { feuille, iEntete: i, entete };
    }
  }
  return null;
}

/** Lit la cellule d'un champ nommé par l'en-tête ; `null` si le champ n'a pas de colonne ou si la cellule est vide. */
export function cellule<C>(cols: ReadonlyMap<C, number>): (ligne: LigneFeuille, champ: C) => Cellule {
  return (ligne, champ) => {
    const i = cols.get(champ);
    return i === undefined ? null : (ligne.cellules[i] ?? null);
  };
}
