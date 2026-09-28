/**
 * Les couleurs du graphique Excel, en hexadécimal.
 *
 * ⚠ DUPLIQUÉES depuis `app/globals.css`, et c'est forcé : un fichier Excel ne
 * lit pas `var(--nature-1)`. Même situation que MapLibre
 * (`lib/campagne/palette-divergente.ts`), même remède : les deux copies sont
 * verrouillées ensemble par `tests/unit/risques/export-rayon.test.ts`.
 *
 * On prend les valeurs du THÈME CLAIR (`html.light`) : un classeur s'ouvre
 * sur fond blanc, et les teintes du thème sombre y seraient trop pâles.
 */

/** `--brand-teal` — la courbe totale, et elle seule, comme à l'écran. */
export const COULEUR_TOTALE = '4ECDC4';

/** `--nature-1` à `--nature-8`, thème clair, dans l'ordre d'attribution de l'écran. */
export const COULEURS_NATURES = [
  'B85C22', '2A6D92', '2F7D4D', '9E3B35', '4D6D85', '8C6A1C', '35605D', '7E4E6C',
] as const;
