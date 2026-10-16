/**
 * @file lib/format/nombre.ts
 *
 * Mise en forme des nombres affichés. Source unique.
 *
 * ── Le constat (`DUP-001`) ──────────────────────────────────────────────────
 *
 * L'audit signalait « deux `fmtNum` divergents ». Le recensement du 2026-09-11
 * en a trouvé **quinze**, réparties en trois comportements réellement
 * identiques et deux variantes qui, elles, divergent à l'écran :
 *
 * | Comportement | Copies | Fichiers |
 * |---|---|---|
 * | `toLocaleString('fr-FR')` brut | 6 | carreaux-import, campaign, ooh-import (page supprimée le 2026-10-16), admin/imports, DspPanel, ZoneAudienceStats |
 * | paliers `k` / `M` / `G`, séparateur `.` | 5 | KpiSummary, CampaignCard, CampaignContextBar, RailroadPipeline, SyncMap |
 * | paliers `k` / `M` **sans `G`** | 2 | ActionListTable, MediaHeatmap |
 *
 * Quinze définitions du même besoin, c'est quinze endroits où corriger un
 * arrondi. Elles sont remplacées ici, **à sortie constante**.
 *
 * ── Ce qui n'est PAS unifié, et pourquoi ────────────────────────────────────
 *
 * Deux divergences restent, parce que les réduire change ce que voit
 * l'utilisateur — c'est un arbitrage produit, pas un choix technique. Elles
 * sont désormais visibles ICI, côte à côte, au lieu d'être noyées dans deux
 * composants éloignés :
 *
 *  - **le palier `G`** : `formaterNombreAbrege` rend « 1.2G » là où
 *    `formaterNombreAbregeSansMilliard` rend « 1200.0M ». Deux écrans d'analyse
 *    affichent donc le même milliard d'impressions différemment. Les unifier,
 *    c'est supprimer une des deux fonctions ;
 *  - **le séparateur décimal** : `components/digital/AnalyseV2.tsx` rend
 *    « 1,2M » (virgule, convention française) quand tout le reste rend
 *    « 1.2M ». Cette variante est laissée sur place, seule, pour que
 *    l'arbitrage porte sur un fichier et un seul.
 */

/** Ce qu'on affiche quand il n'y a pas de valeur. */
const ABSENT = '—';

/**
 * Nombre complet, séparateurs de milliers français : `1 234 567`.
 *
 * Accepte `null` / `undefined` et rend `—`. Quatre des six copies remplacées
 * n'acceptaient qu'un `number` et deux géraient le cas absent : réunir les deux
 * ne change rien pour un `number`, qui n'est jamais `null`.
 */
export function formaterNombre(valeur: number | null | undefined): string {
  if (valeur == null) return ABSENT;
  return valeur.toLocaleString('fr-FR');
}

/** Nombre arrondi à l'entier, puis mis en forme : `1 235`. */
export function formaterNombreArrondi(valeur: number | null | undefined): string {
  if (valeur == null || !Number.isFinite(valeur)) return ABSENT;
  return Math.round(valeur).toLocaleString('fr-FR');
}

/**
 * Nombre abrégé avec paliers : `1.2k`, `3.4M`, `1.2G`.
 *
 * En dessous de mille, le nombre est rendu en entier — c'est ce que faisaient
 * les cinq copies remplacées.
 *
 * Accepte `unknown` et rend `—` sur une valeur non finie. Quatre des cinq
 * copies n'avaient pas cette garde et rendaient donc la chaîne « NaN » à
 * l'écran ; c'est le seul écart de sortie de cette unification, et il va dans
 * le bon sens.
 */
export function formaterNombreAbrege(valeur: unknown): string {
  const v = Number(valeur);
  if (!Number.isFinite(v)) return ABSENT;
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'G';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k';
  return v.toLocaleString('fr-FR');
}

/**
 * Nombre abrégé en notation FRANÇAISE : `12,5 k`, `37,3 M`, `1,2 Md`.
 *
 * Existe à côté de `formaterNombreAbrege`, qui rend `37.3M` avec un point
 * décimal : un écran qui écrit par ailleurs « 1 927 » et « 81,6 % » ne peut pas
 * afficher « 249.8k € ». La remplacer changerait l'affichage des écrans qui
 * l'emploient, ce qui n'est pas le rôle d'un ajout ; la convergence des deux
 * reste un arbitrage à faire.
 *
 * @example
 * formaterNombreCourt(37_312_000) // '37,3 M'
 * formaterNombreCourt(950)        // '950'
 */
export function formaterNombreCourt(valeur: unknown): string {
  const v = Number(valeur);
  if (!Number.isFinite(v)) return ABSENT;
  const a = Math.abs(v);
  const un = (x: number, suffixe: string) =>
    `${x.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${suffixe}`;
  if (a >= 1e9) return un(v / 1e9, 'Md');
  if (a >= 1e6) return un(v / 1e6, 'M');
  if (a >= 1e4) return un(v / 1e3, 'k');
  return Math.round(v).toLocaleString('fr-FR');
}

/**
 * Même chose, **sans le palier `G`** : un milliard s'affiche « 1000.0M ».
 *
 * Cette fonction n'existe que pour préserver l'affichage de deux écrans
 * (`ActionListTable`, `MediaHeatmap`). La fusionner avec `formaterNombreAbrege`
 * est un arbitrage d'affichage : au-delà du milliard, les deux ne disent pas la
 * même chose. Le jour où il est tranché, cette fonction disparaît et ses deux
 * appelants passent sur `formaterNombreAbrege`.
 */
export function formaterNombreAbregeSansMilliard(valeur: unknown): string {
  const v = Number(valeur);
  if (!Number.isFinite(v)) return ABSENT;
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k';
  return v.toLocaleString('fr-FR');
}

/**
 * Formate un nombre avec un nombre fixe de décimales, en notation française.
 *
 * Existe parce que `toFixed(1).replace('.', ',')` s'était reformé **six fois**
 * dans le périmètre « zone à risque » — dont une côté serveur (constat R-19 de
 * `docs/AUDIT_ZONE_RISQUE.md`). C'est la septième variante de la règle DUP-001,
 * celle qui avait déjà donné quinze `fmtNum` locaux avant le 2026-09-11.
 *
 * `toLocaleString` et non un `replace` : il gère aussi le séparateur de
 * milliers, qu'un `replace` sur le point décimal laissait en notation anglaise
 * dès qu'on dépassait mille.
 *
 * @param valeur - La valeur à formater.
 * @param decimales - Le nombre de décimales, toujours affichées. Défaut : 1.
 * @returns La valeur formatée, ou le marqueur d'absence si elle n'est pas finie.
 *
 * @example
 * formaterDecimal(2.5)        // '2,5'
 * formaterDecimal(1234.56, 2) // '1 234,56'
 * formaterDecimal(null)       // '—'
 */
export function formaterDecimal(
  valeur: number | null | undefined,
  decimales = 1,
): string {
  if (valeur == null || !Number.isFinite(valeur)) return ABSENT;
  return valeur.toLocaleString('fr-FR', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
}
