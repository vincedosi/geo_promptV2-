/**
 * Constantes et mises en forme de l'écran Sources (lot 6, T18), copiées de React (gel P5) :
 * `app/admin/sources/_lib/theme.ts` (`SCHEMA_FILTER_COLS`), `_components/ui.tsx` (`typeBadge`,
 * `formatDate`) et `page.tsx` (`fmtK`, l. 319). Parité : `tests/unit/angular/admin-logique-paritaire.test.ts`
 * (colonnes de schéma) et `constantes.spec.ts` (mêmes sorties que les expressions React).
 */

/** Les neuf onglets de React (`page.tsx:75`), dans l'ordre de sa barre. */
export type OngletSources = 'all' | 'poi' | 'panneaux' | 'carreaux' | 'iris' | 'transport' | 'radio' | 'dsp' | 'custom_zones';

/** Colonnes de schéma exploitables comme filtres carte (hors id/lat/lng/geom) — `theme.ts:38-40`. */
export const SCHEMA_FILTER_COLS = [
  'region', 'departement', 'ville', 'code_postal', 'categorie', 'sous_categorie',
];

/**
 * Teinte d'un onglet ou d'une tuile. React écrit `C.accent` / `var(--brand-teal)` (teal), `C.green`
 * (`--success`), `C.warn` (`--warning`), et deux hex en dur : `#06b6d4` (IRIS) et `#22c55e`
 * (Transport) — ramenés aux jetons `--info` et `--success` (C9, écart listé au rapport).
 */
export type TeinteSources = 'teal' | 'succes' | 'avert' | 'info';

/** `fmtK` de `page.tsx:319` : `1.2M`, `105k` (arrondi au millier), sinon le nombre brut. */
export function fmtK(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}k` : String(n);
}

/** `formatDate` de `ui.tsx` : `jj/mm/aaaa hh:mm`, fr-FR. */
export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Badge de type de source (`typeBadge`, `ui.tsx`) : libellé et famille de teinte. */
export interface BadgeType {
  libelle: string;
  /** `poi` (teal), `panneaux` (avertissement), `carreaux` (succès), `autre` (neutre). */
  famille: 'poi' | 'panneaux' | 'carreaux' | 'autre';
}

/**
 * `category` n'est lu que pour les POI, `regie` que pour les panneaux ; un type inconnu retombe sur
 * un badge neutre libellé « Carreaux INSEE » — comme React (son `else` couvre tout type non POI et
 * non panneaux).
 */
export function badgeType(type: string, category?: string | null, regie?: string | null): BadgeType {
  const libelle = type === 'poi'
    ? `POI${category ? ` — ${category}` : ''}`
    : type === 'panneaux'
      ? `OOH${regie ? ` — ${regie}` : ''}`
      : 'Carreaux INSEE';
  const famille = type === 'poi' || type === 'panneaux' || type === 'carreaux' ? type : 'autre';
  return { libelle, famille };
}
