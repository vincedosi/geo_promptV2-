import type { RegionRef } from '../../etat/referentiel-geo.service';
import { ALL_FEATURES, ALL_THEME_IDS, FEATURE_PRESETS, FEATURE_THEMES, type ThemeId, featureSelectionLabel } from './feature-themes';

/**
 * La logique PURE de l'assistant de calcul du clustering — portage de `app/map/_components/ClusteringWizard.tsx`
 * (lot 4, T20). Aucun appel réseau ni signal ici : les composants et `EtatAssistantClusteringService` lisent ces
 * fonctions, les specs les exercent sans DOM.
 */

/** Un type de POI proposé à l'étape 1 (`PoiTypeEntry`, `GET /api/poi-clusters/poi-types`). */
export interface TypePoiClustering {
  type: string;
  total: number;
  clustered: number;
  has_clusters: boolean;
}

export type Transport = 'drive' | 'walk' | 'bike';

/** Le corps EXACT de `POST /api/poi-clusters/run` (`ClusteringWizard.tsx:234-239`, `CorpsRunSchema` de la route). */
export interface CorpsLancementClustering {
  poi_types: string[];
  geo_filter: { metropolitaine: boolean; regions: string[]; depts: string[] };
  params: { duration: number; transport: Transport; dry_run: boolean };
  /** `null` = toutes les variables (le script prend alors ses 16 variables par défaut). */
  features: string[] | null;
}

/** Ce que rend le sondage `GET /api/poi-clusters/run?job_id=` (la route en rend davantage ; l'écran lit ces deux-là). */
export interface StatutJobClustering {
  status?: string;
  log_tail?: string | null;
}

/** Les deux statuts qui arrêtent le sondage (`ClusteringWizard.tsx:185`). */
export const STATUTS_FINAUX: readonly string[] = ['done', 'failed'];

/** L'intervalle de sondage de React (`setInterval(poll, 3000)`, `ClusteringWizard.tsx:194`). */
export const INTERVALLE_SONDAGE_MS = 3000;

/** Les codes département DROM-COM, retirés en « France métropolitaine uniquement » (`DROM_DEPTS`). */
const DEPTS_DROM = new Set(['971', '972', '973', '974', '975', '976']);
/** Les codes INSEE des régions DROM-COM, masquées en « France métropolitaine uniquement » (`DROM_REGION_CODES`). */
const REGIONS_DROM = new Set(['01', '02', '03', '04', '06']);

/** Les raccourcis de durée (`[30, 45, 60, 90]`) et les bornes de la saisie (`min={5} max={120}`). */
export const RACCOURCIS_DUREE: readonly number[] = [30, 45, 60, 90];
export const DUREE_MIN = 5;
export const DUREE_MAX = 120;
/** La durée proposée à l'ouverture (`useState(60)`). */
export const DUREE_INITIALE_ASSISTANT = 60;

export const TRANSPORTS: readonly { id: Transport; libelle: string }[] = [
  { id: 'drive', libelle: 'Voiture' },
  { id: 'walk', libelle: 'Marche' },
  { id: 'bike', libelle: 'Vélo' },
];

/**
 * La teinte de chaque thématique, en JETON. React peignait les `color` hexadécimales de `feature-themes.ts`, dont un
 * VIOLET (`#8b5cf6`, Ménages) que le design system interdit partout. Les quatre deviennent des teintes de l'échelle
 * qualitative `--nature-*` — elle est faite pour cela (catégories sans ordre, distinguables en gris et pour un deutan) :
 * bleu, ambre, vert comme React, et un vert d'eau à la place du violet.
 */
export const JETON_THEME: Record<ThemeId, string> = {
  demographie: 'nature-2',
  revenus: 'nature-6',
  logement: 'nature-3',
  menages: 'nature-7',
};

/** Ajoute `x` s'il manque, le retire s'il y est — l'ordre des autres est gardé (les `toggle*` de React). */
export function basculer<T>(liste: readonly T[], x: T): T[] {
  return liste.includes(x) ? liste.filter((y) => y !== x) : [...liste, x];
}

/** Les régions proposées : sans les DROM en « métropolitaine uniquement » (`ClusteringWizard.tsx:400`). */
export function regionsProposees(regions: readonly RegionRef[], metropolitaine: boolean): RegionRef[] {
  return regions.filter((r) => !metropolitaine || !REGIONS_DROM.has(r.code_region));
}

/** Les départements des régions choisies, DROM retirés en « métropolitaine uniquement » (`buildDepts`). */
export function departementsChoisis(regions: readonly RegionRef[], choisies: readonly string[], metropolitaine: boolean): string[] {
  if (choisies.length === 0) return [];
  return regions
    .filter((r) => choisies.includes(r.code_region))
    .flatMap((r) => r.depts.map((d) => d.code_dept))
    .filter((c) => !metropolitaine || !DEPTS_DROM.has(c));
}

/** Le corps du lancement (`handleLaunch`) : `features` vaut `null` quand TOUTES les variables sont retenues. */
export function corpsLancement(e: {
  types: readonly string[];
  metropolitaine: boolean;
  regions: readonly string[];
  depts: readonly string[];
  duree: number;
  transport: Transport;
  dryRun: boolean;
  variables: readonly string[];
}): CorpsLancementClustering {
  return {
    poi_types: [...e.types],
    geo_filter: { metropolitaine: e.metropolitaine, regions: [...e.regions], depts: [...e.depts] },
    params: { duration: e.duree, transport: e.transport, dry_run: e.dryRun },
    features: e.variables.length === ALL_FEATURES.length ? null : [...e.variables],
  };
}

/** `canLaunch` de React : au moins un type, une durée dans ses bornes, au moins deux variables, rien en cours. */
export function peutLancer(e: { types: number; duree: number; variables: number; enCours: boolean }): boolean {
  return e.types > 0 && e.duree >= DUREE_MIN && e.duree <= DUREE_MAX && !e.enCours && e.variables >= 2;
}

/** La saisie de la durée : un entier borné à [5, 120], `null` si illisible (React ignorait alors la frappe). */
export function dureeSaisie(texte: string): number | null {
  const v = parseInt(texte, 10);
  return Number.isNaN(v) ? null : Math.min(DUREE_MAX, Math.max(DUREE_MIN, v));
}

/** Les variables d'un préréglage (« Toutes », « Socio-démo », « Habitat »). */
export function variablesDuPrereglage(cle: keyof typeof FEATURE_PRESETS): string[] {
  return FEATURE_PRESETS[cle].themes.flatMap((t) => [...FEATURE_THEMES[t].features]);
}

/** Un préréglage est actif quand la sélection contient EXACTEMENT ses variables (`isActive`). */
export function prereglageActif(cle: keyof typeof FEATURE_PRESETS, variables: readonly string[]): boolean {
  const siennes = variablesDuPrereglage(cle);
  return siennes.length === variables.length && siennes.every((f) => variables.includes(f));
}

/** Les préréglages dans l'ordre de React (`Object.entries(FEATURE_PRESETS)`). */
export const PREREGLAGES = Object.keys(FEATURE_PRESETS) as (keyof typeof FEATURE_PRESETS)[];

/** L'état d'une thématique : combien de ses variables sont cochées. */
export function etatTheme(theme: ThemeId, variables: readonly string[]): { cochees: number; total: number; toutes: boolean; aucune: boolean } {
  const siennes: readonly string[] = FEATURE_THEMES[theme].features;
  const cochees = siennes.filter((f) => variables.includes(f)).length;
  return { cochees, total: siennes.length, toutes: cochees === siennes.length, aucune: cochees === 0 };
}

/** Cocher une thématique : toute cochée → retirée en bloc ; sinon complétée, ajoutée EN FIN de liste (`toggleTheme`). */
export function basculerTheme(theme: ThemeId, variables: readonly string[]): string[] {
  const siennes: readonly string[] = FEATURE_THEMES[theme].features;
  const reste = variables.filter((f) => !siennes.includes(f));
  return etatTheme(theme, variables).toutes ? reste : [...reste, ...siennes];
}

/** La ligne sous les thématiques : bloquante sous 2 variables, une alerte sous 5, sinon le résumé de la sélection. */
export function avisVariables(variables: readonly string[]): { niveau: 'erreur' | 'alerte' | 'info'; texte: string } {
  if (variables.length < 2) return { niveau: 'erreur', texte: '! Minimum 2 variables requises' };
  if (variables.length < 5) return { niveau: 'alerte', texte: '! Peu de variables — clusters moins discriminants' };
  return { niveau: 'info', texte: featureSelectionLabel([...variables]) };
}

/** Le périmètre du résumé de l'étape 4 (`ClusteringWizard.tsx:696-697`). */
export function libellePerimetre(metropolitaine: boolean, regions: number): string {
  return `${metropolitaine ? 'France métro' : 'France entière'}${regions > 0 ? ` — ${regions} région(s)` : ''}`;
}

/** « N type(s) sélectionné(s) » (`ClusteringWizard.tsx:343`). */
export function libelleTypesChoisis(n: number): string {
  const s = n > 1 ? 's' : '';
  return `${n} type${s} sélectionné${s}`;
}

/** « N région(s) — M départements » (`ClusteringWizard.tsx:426`). */
export function libelleRegionsChoisies(regions: number, depts: number): string {
  return `${regions} région${regions > 1 ? 's' : ''} — ${depts} départements`;
}

/** Les quatre thématiques, dans l'ordre de React. */
export const THEMES = ALL_THEME_IDS;
