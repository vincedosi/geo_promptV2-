/**
 * Les données de l'export Excel de l'onglet Rayon, mises en forme pour le
 * classeur.
 *
 * ── CE QUE LE CLASSEUR RECALCULE SEUL ─────────────────────────────────────
 *
 * Le seuil Seveso, le territoire, les natures affichées et le rayon se
 * choisissent DANS Excel, après l'export. Le classeur porte donc la table de
 * couverture entière (sql/198) — une ligne par (département × gravité ×
 * nature), cent cumuls par ligne — et des formules `SOMME.SI.ENS` la relisent.
 *
 * ⚠ CE QUI NE PEUT PAS SE RECALCULER, et c'est une propriété de la donnée :
 * la courbe « toutes natures » n'est pas la somme des courbes par nature (un
 * carreau proche de deux natures compte dans les deux). Décocher des natures
 * ne retire donc que leurs courbes du graphique ; le total reste celui de
 * toutes les natures, exactement comme à l'écran (`total_est_global`).
 */

/** Le nombre de paliers de 100 m entre 100 m et 10 km — la borne du pré-calcul. */
export const N_PALIERS = 100;

/** Pas d'un palier, en mètres. */
const PAS_M = 100;

/**
 * Clés de gravité ÉCRITES DANS LE CLASSEUR.
 *
 * ⚠ La base note « toutes gravités » `*`, et c'est un JOKER pour
 * `SOMME.SI.ENS` : un critère `"*"` retient toutes les lignes, donc
 * additionnerait la ligne des deux seuils ET celles de chaque seuil. On
 * réécrit donc les deux jokers de la base en libellés sans caractère spécial.
 */
export const GRAVITE_TOUTES = 'seveso_haut_et_bas';

/** Même raison que {@link GRAVITE_TOUTES}, pour la nature. */
export const NATURE_TOUTES = '(toutes natures)';

/** Les trois choix du menu « Seuil Seveso », dans l'ordre du menu. */
export const CHOIX_GRAVITE: ReadonlyArray<{ libelle: string; cle: string }> = [
  { libelle: 'Seveso seuil haut et seuil bas', cle: GRAVITE_TOUTES },
  { libelle: 'Seveso seuil haut', cle: 'seveso_haut' },
  { libelle: 'Seveso seuil bas', cle: 'seveso_bas' },
];

/** La réponse brute de `export_couverture_rayon` (sql/233). */
export interface ReponseExportRayon {
  calculable: boolean;
  error?: string;
  cible: string;
  lignes: Array<{ d: string; g: string; n: string; inc: Record<string, number> }>;
  departements: Array<{ code: string; nom: string; region: string | null; pop: number | null }>;
  regions: Array<{ code: string; nom: string; pop: number | null }>;
  calcule_le: string | null;
}

/** Une ligne de la feuille « Données ». */
interface LigneCumul {
  departement: string;
  region: string;
  gravite: string;
  nature: string;
  /** Population à moins de (i + 1) × 100 m, i de 0 à 99. */
  cumuls: number[];
}

export interface DonneesExportRayon {
  lignes: LigneCumul[];
  /** Natures présentes, de la plus peuplée à 10 km à la moins peuplée. */
  natures: string[];
  departements: Array<{ code: string; nom: string; region: string; pop: number | null }>;
  regions: Array<{ code: string; nom: string; pop: number | null }>;
  calculeLe: string | null;
}

/**
 * Densifie et cumule la réponse de la base.
 *
 * Convention de sql/199, reprise telle quelle : le palier `b` regroupe les
 * carreaux à [b, b+100) mètres, donc « à moins de r mètres » est la somme des
 * paliers d'indice < r / 100. Le cumul d'indice i vaut donc la somme des
 * incréments 0 à i, soit la population à moins de (i + 1) × 100 m.
 *
 * @param r - La réponse de `export_couverture_rayon`.
 * @returns Les lignes cumulées, les natures ordonnées, les référentiels.
 *
 * @example
 * const d = preparerDonnees(rpcJson<ReponseExportRayon>(data)!);
 * d.lignes[0].cumuls[49]; // population à moins de 5 km pour cette ligne
 */
export function preparerDonnees(r: ReponseExportRayon): DonneesExportRayon {
  const regionDuDept = new Map(r.departements.map((d) => [d.code, d.region ?? '']));

  const lignes: LigneCumul[] = r.lignes.map((l) => {
    const cumuls: number[] = new Array(N_PALIERS);
    let somme = 0;
    for (let i = 0; i < N_PALIERS; i++) {
      somme += l.inc[String(i)] ?? 0;
      cumuls[i] = somme;
    }
    return {
      departement: l.d,
      region: regionDuDept.get(l.d) ?? '',
      gravite: l.g === '*' ? GRAVITE_TOUTES : l.g,
      nature: l.n === '*' ? NATURE_TOUTES : l.n,
      cumuls,
    };
  });

  // Ordre des natures : population à 10 km, les deux seuils, France entière.
  // C'est l'ordre dans lequel on les lit — la plus lourde en tête de légende.
  const poids = new Map<string, number>();
  for (const l of lignes) {
    if (l.gravite !== GRAVITE_TOUTES || l.nature === NATURE_TOUTES) continue;
    poids.set(l.nature, (poids.get(l.nature) ?? 0) + l.cumuls[N_PALIERS - 1]);
  }
  const natures = [...new Set(lignes.map((l) => l.nature))]
    .filter((n) => n !== NATURE_TOUTES)
    .sort((a, b) => (poids.get(b) ?? 0) - (poids.get(a) ?? 0) || a.localeCompare(b, 'fr'));

  return {
    lignes,
    natures,
    departements: r.departements.map((d) => ({ ...d, region: d.region ?? '' })),
    regions: r.regions,
    calculeLe: r.calcule_le,
  };
}

/** L'état de l'écran au moment de l'export — les valeurs initiales du classeur. */
export interface EtatInitialExport {
  /** Gravités cochées à l'écran ; vide = les deux seuils. */
  gravites: string[];
  /** Natures retenues à l'écran ; vide = toutes. */
  natures: string[];
  /** Territoire courant, ou `null` pour la France entière. */
  perim: { niveau: 'region' | 'departement'; code: string } | null;
  /** Rayon du curseur, en mètres. */
  rayonM: number;
}

/**
 * La clé de gravité du classeur qui correspond aux gravités cochées à l'écran.
 * Même règle que sql/199 : aucune ou les deux → la courbe des deux seuils.
 *
 * @param gravites - Les gravités cochées à l'écran.
 * @returns La clé écrite dans le classeur.
 *
 * @example
 * cleGraviteInitiale(['seveso_haut']);               // 'seveso_haut'
 * cleGraviteInitiale(['seveso_haut', 'seveso_bas']); // 'seveso_haut_et_bas'
 */
export function cleGraviteInitiale(gravites: readonly string[]): string {
  const haut = gravites.includes('seveso_haut');
  const bas = gravites.includes('seveso_bas');
  if (haut && !bas) return 'seveso_haut';
  if (bas && !haut) return 'seveso_bas';
  return GRAVITE_TOUTES;
}

/**
 * Le palier (1 à 100) du rayon demandé, borné — la valeur de la réglette.
 *
 * @param rayonM - Rayon en mètres ; hors bornes, ramené à 100 m ou 10 km, et
 *   un rayon non numérique retombe sur 1 km, la valeur par défaut de l'écran.
 * @returns Le palier, de 1 (100 m) à 100 (10 km).
 *
 * @example
 * palierDuRayon(5000); // 50
 * palierDuRayon(0);    // 1
 */
export function palierDuRayon(rayonM: number): number {
  const p = Math.round(rayonM / PAS_M);
  return Math.min(N_PALIERS, Math.max(1, Number.isFinite(p) ? p : 10));
}
