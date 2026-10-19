import { polygonToEWKT, type Feature } from '../../logique/shapefile';
import type { CorpsEnregistrement, LigneCarreau } from '../data/import-geo.api';

/**
 * Ce que `processImport` de React calcule avant et pendant l'envoi (`app/admin/carreaux-import/page.tsx:
 * 236-395`), sorti en fonctions pures pour être testé sans écran. Mêmes règles, mêmes chaînes.
 */

/** Une colonne du `.dbf` et sa cible : `''` = nom d'origine, `'__skip__'` = exclue (`_components/shared.ts:7`). */
export interface ColumnMapping {
  source: string;
  target: string; // user-chosen target name or '' for metadata
}

/** Étape courante : fichiers, mapping, import (`WizardStep`). */
export type WizardStep = 1 | 2 | 3;

/** Valeur de `target` d'une colonne exclue. */
export const EXCLUE = '__skip__';

/**
 * Taille d'un lot (`BATCH_SIZE`, l.246), comme React : la règle « 50 par lot » vaut pour les inserts SERVEUR,
 * qu'`import_carreaux_batch` fait déjà ligne à ligne ; la route accepte jusqu'à 2 000 lignes.
 */
export const TAILLE_LOT = 1000;

/** Les colonnes retenues (`selectedMappings`, l.257). */
export function colonnesRetenues(mappings: readonly ColumnMapping[]): ColumnMapping[] {
  return mappings.filter((m) => m.target !== EXCLUE);
}

/** Colonne source → clé dans `metadata` : la cible si elle est saisie et différente, sinon la source (l.258-263). */
export function tableRenommage(retenues: readonly ColumnMapping[]): Map<string, string> {
  const renommage = new Map<string, string>();
  for (const m of retenues) {
    const cle = m.target && m.target !== m.source ? m.target : m.source;
    renommage.set(m.source, cle);
  }
  return renommage;
}

export interface ParametresLot {
  renommage: ReadonlyMap<string, string>;
  idColumn: string;
  resolution: string;
  millesime: string;
}

/**
 * Les lignes du lot `[debut, fin)` (l.265-296) : identifiant de la colonne choisie (`String(…)`), sinon
 * `auto_<rang>` ; `metadata` = les seules colonnes retenues NON nulles, renommées ; géométrie en EWKT.
 */
export function construireLot(features: readonly Feature[], debut: number, fin: number, p: ParametresLot): LigneCarreau[] {
  const lot = features.slice(debut, fin);
  return lot.map((feat) => {
    const rawId = p.idColumn && feat.properties[p.idColumn] != null
      ? String(feat.properties[p.idColumn])
      : `auto_${debut + lot.indexOf(feat)}`;
    const metadata: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(feat.properties)) {
      const cle = p.renommage.get(key);
      if (val != null && cle !== undefined) metadata[cle] = val;
    }
    return { idcar: rawId, resolution: p.resolution, millesime: p.millesime, geom_wkt: polygonToEWKT(feat.geometry), metadata };
  });
}

/** Le refus d'un lot appelle la reprise par demi-lots (l.314). */
export function appelleDemiLots(erreur: string | undefined): boolean {
  return !!erreur && (erreur.includes('413') || erreur.includes('too large') || erreur.includes('payload'));
}

/** Corps de `register` (l.364-371). */
export function corpsEnregistrement(
  retenues: readonly ColumnMapping[], resolution: string, millesime: string, inserees: number, fichier: string | null,
): CorpsEnregistrement {
  return {
    name: `Carreaux ${resolution} — ${millesime}${fichier ? ` (${fichier})` : ''}`,
    resolution,
    millesime,
    row_count: inserees,
    columns: retenues.map((m) => m.target || m.source),
    filename: fichier || null,
  };
}
