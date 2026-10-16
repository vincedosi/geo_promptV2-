import ExcelJS from 'exceljs';
import { lireClasseur } from '@/lib/ooh/plan/classeur';
import type { Classeur } from '@/types/campagnes-media';

export type ValeurEssai = string | number | Date | null;

/**
 * Construit un classeur .xlsx EN MÉMOIRE (exceljs), puis le relit par `lireClasseur` : les tests ne lisent jamais un
 * fichier client (spec 2026-10-16-ooh-campagnes § 8). `lignes[i][j]` = cellule de la ligne i+1, colonne j+1 ; `null`
 * = cellule vide.
 */
export async function classeurEssai(feuilles: Record<string, ValeurEssai[][]>): Promise<Classeur> {
  const classeur = new ExcelJS.Workbook();
  for (const [nom, lignes] of Object.entries(feuilles)) {
    const feuille = classeur.addWorksheet(nom);
    lignes.forEach((cellules, i) => {
      cellules.forEach((valeur, j) => {
        if (valeur !== null) feuille.getCell(i + 1, j + 1).value = valeur;
      });
    });
  }
  const tampon = await classeur.xlsx.writeBuffer();
  return lireClasseur(Buffer.from(tampon as ArrayBuffer));
}
