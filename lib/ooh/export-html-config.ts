/**
 * @file lib/ooh/export-html-config.ts
 *
 * Les constantes de l'export HTML autonome d'une campagne OOH (`lib/ooh/export-html.ts`) : la palette du thème clair,
 * la dépendance MapLibre (version exacte, empreintes SRI), le fond de carte et la politique de sécurité de contenu.
 */

/** Une couleur de la page : la valeur du thème clair du jeton `--<jeton>` de `app/globals.css`. */
export interface CouleurJeton {
  readonly jeton: string;
  readonly valeur: string;
}

/**
 * La palette de l'export, recopiée du thème CLAIR de `app/globals.css` (bloc `html.light`) — le fichier vit hors de
 * l'application, sans `globals.css`, d'où les hex ; ils ne sont écrits qu'ICI. `tests/unit/ooh/export-html.test.ts`
 * vérifie l'égalité jeton par jeton et qu'aucun autre hex n'apparaît dans la page : retoucher un jeton dans
 * `globals.css` fait échouer ce test, on recopie alors ici.
 */
export const PALETTE_EXPORT_OOH = {
  fond: { jeton: 'bg-level-0', valeur: '#ffffff' },
  surface: { jeton: 'bg-level-1', valeur: '#f5f5f5' },
  eleve: { jeton: 'bg-level-2', valeur: '#eeeeee' },
  bordure: { jeton: 'border-subtle', valeur: '#e5e5e5' },
  bordureForte: { jeton: 'border-default', valeur: '#d0d0d0' },
  texte: { jeton: 'text-primary', valeur: '#1a1a1a' },
  texteSecondaire: { jeton: 'text-secondary', valeur: '#555555' },
  texteTertiaire: { jeton: 'text-tertiary', valeur: '#8a8a8a' },
  teal: { jeton: 'brand-teal', valeur: '#4ecdc4' },
  avertissement: { jeton: 'warning', valeur: '#c08400' },
  /** Cerne des points et segment clair de l'anneau des points à vérifier (invariant). */
  contour: { jeton: 'poi-contour', valeur: '#ffffff' },
  /** Segment sombre de l'anneau pointillé des points à vérifier (invariant). */
  anneau: { jeton: 'anneau-a-verifier', valeur: '#1a1a1a' },
  /** Échelle qualitative des lignes d'une campagne (DESIGN_SYSTEM), thème clair, dans l'ordre des rangs 1 à 8. */
  lignes: [
    { jeton: 'ligne-media-1', valeur: '#b9770f' },
    { jeton: 'ligne-media-2', valeur: '#2a73b8' },
    { jeton: 'ligne-media-3', valeur: '#b23a57' },
    { jeton: 'ligne-media-4', valeur: '#23874f' },
    { jeton: 'ligne-media-5', valeur: '#8c7d10' },
    { jeton: 'ligne-media-6', valeur: '#3a5aa0' },
    { jeton: 'ligne-media-7', valeur: '#b8532f' },
    { jeton: 'ligne-media-8', valeur: '#5c7f1f' },
  ],
} as const satisfies Record<string, CouleurJeton | readonly CouleurJeton[]>;

/** Les couleurs simples de la palette (sans l'échelle des lignes), dans l'ordre de déclaration. */
export function couleursSimples(): CouleurJeton[] {
  const valeurs: readonly (CouleurJeton | readonly CouleurJeton[])[] = Object.values(PALETTE_EXPORT_OOH);
  return valeurs.filter((c): c is CouleurJeton => !Array.isArray(c));
}

/**
 * MapLibre GL JS chargé par la page : version EXACTE (jamais `@5`), même majeure que la dépendance du projet
 * (`package.json`, vérifié par le test) — celle installée le 2026-10-19.
 */
export const MAPLIBRE_VERSION_EXPORT = '5.18.0';
/** Le dossier du paquet sur jsDelivr : la CSP n'autorise que lui, pas tout le CDN. */
export const CDN_MAPLIBRE = `https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION_EXPORT}/dist/`;

/**
 * Empreintes SRI (SHA-384) des deux fichiers de MapLibre `MAPLIBRE_VERSION_EXPORT`. Le document vit indéfiniment chez
 * des tiers : un CDN compromis ne pourra pas y injecter de script. Calculées le 2026-10-19 sur les fichiers servis par
 * jsDelivr, identiques à ceux de `node_modules/maplibre-gl/dist` (le test les recalcule sur ces derniers tant que la
 * version installée est la même). Changer de version impose de les recalculer.
 */
export const SRI_MAPLIBRE = {
  js: 'sha384-MYTfGytf3SxNyO7ZAu/U0wHCcs3NpqE92Q3wBz5PQhat8kEA/wbwb9qY6H/JLyuR',
  css: 'sha384-q7EDwLXBfakVimqzBJqFCTxpgy7B18buhebV158qkVMCEVAaUnU3fQTEfWgYz+7g',
} as const;

/** Le fond « Clair » de l'application (`angular/src/app/features/carte/logique/fonds.ts`, id `positron`). */
export const URL_FOND_EXPORT = 'https://tiles.openfreemap.org/styles/positron';

/**
 * Ce que la page a le droit de charger : le dossier du paquet MapLibre, et OpenFreeMap (style, tuiles, glyphes,
 * sprites) ; le travailleur de MapLibre naît d'une URL `blob:`. Le script inline n'est autorisé que par son empreinte
 * SHA-256 (`empreinteScript`), jamais par `'unsafe-inline'`. Les styles gardent `'unsafe-inline'` : MapLibre pose des
 * attributs `style` sur ses éléments, qu'aucune empreinte ne couvre. Rien vers l'application.
 */
export function politiqueContenu(empreinteScript: string): string {
  return [
    "default-src 'none'",
    `script-src '${empreinteScript}' ${CDN_MAPLIBRE}`,
    `style-src 'unsafe-inline' ${CDN_MAPLIBRE}`,
    'img-src data: blob: https://tiles.openfreemap.org',
    'connect-src https://tiles.openfreemap.org',
    'font-src https://tiles.openfreemap.org',
    'worker-src blob:',
    'child-src blob:',
  ].join('; ');
}
