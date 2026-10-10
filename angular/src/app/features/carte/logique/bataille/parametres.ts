/**
 * Logique PURE des paramètres d'une bataille d'isochrones — portage de `use-isochrone-battle.ts:92-101,152-159,
 * 224-242,317-326` et de la dérivation du territoire de `PanneauAnalyse.tsx:186-194` (lot 4, T17).
 *
 * Le territoire de la bataille ne vient PAS du sélecteur de périmètre (code mort depuis la refonte du panneau Filtre,
 * `PanneauAnalyse.tsx:66-75`) mais du FILTRE UNIQUE : une commune donne la ville, une région ou un département leur
 * code. Les autres filtres (code postal, zone, France) ne restreignent rien — comme React.
 */
import type { FiltreActif } from '../filtre';
import type { DirectBattleParams, DirectBattleV2Params, FillIsochroneCacheParams } from '../modes-isochrones';

/** Le territoire d'une bataille (`filtreVilleBattle` / `filtreRegionsBattle` / `filtreDeptsBattle`). */
export interface TerritoireBataille {
  ville: string;
  regions: string[];
  depts: string[];
}

/** Ce que les quatre appels partagent : la catégorie unique, le mode, le territoire, la taille du référentiel régions. */
export interface ContexteBataille {
  categorie: string;
  mode: string;
  territoire: TerritoireBataille;
  /** `REF_REGIONS.length` : 0 tant que le référentiel n'est pas lu. */
  nbRegionsRef: number;
}

/** Une région du référentiel, pour nommer le territoire dans le journal. */
export interface RegionNommee {
  code_region: string;
  nom_region: string;
}

export function territoireDuFiltre(filtre: FiltreActif | null): TerritoireBataille {
  return {
    ville: filtre?.type === 'commune' ? filtre.label : '',
    regions: filtre?.type === 'region' ? [filtre.code] : [],
    depts: filtre?.type === 'departement' ? [filtre.code] : [],
  };
}

/** Une copie triée par ordre croissant (`[...x].sort((a, b) => a - b)`). */
export function croissant(valeurs: readonly number[]): number[] {
  return [...valeurs].sort((a, b) => a - b);
}

/** Ajoute ou retire un palier, la liste restant triée (`toggleDuration`, sélection des paliers V2). */
export function basculerPalier(valeurs: readonly number[], p: number): number[] {
  return valeurs.includes(p) ? valeurs.filter((x) => x !== p) : croissant([...valeurs, p]);
}

/**
 * La portée géographique commune aux quatre corps. Règle métier conservée : quand TOUTES les régions sont choisies,
 * aucun filtre région n'est envoyé — sinon la comparaison en base ne correspond pas (`use-isochrone-battle.ts:18-19`).
 */
function portee(c: ContexteBataille) {
  const { ville, regions, depts } = c.territoire;
  return {
    filtre_ville: ville || undefined,
    filtre_regions: regions.length > 0 && (c.nbRegionsRef === 0 || regions.length < c.nbRegionsRef) ? regions : undefined,
    filtre_depts: depts.length > 0 ? depts : undefined,
    metropolitaine: !regions.includes('dom'),
  };
}

/** Le corps de `POST /api/isochrone-cache-check` (`buildCheckParams`) — les clés `undefined` ne partent pas. */
export function corpsVerification(c: ContexteBataille, paliers: readonly number[]) {
  const p = portee(c);
  return {
    category: c.categorie, mode: c.mode, paliers: [...paliers], metropolitaine: p.metropolitaine,
    filtre_ville: p.filtre_ville, filtre_regions: p.filtre_regions, filtre_depts: p.filtre_depts,
  };
}

/** Les paramètres de la bataille V1 (`handleBattle`). */
export function parametresV1(c: ContexteBataille, durees: readonly number[], force: boolean): DirectBattleParams {
  return {
    category: c.categorie, mode: c.mode, max_minutes: Math.max(...durees), durations: croissant(durees),
    ...portee(c), force_recalculate: force,
  };
}

/** Le remplissage du cache des paliers V2 manquants (`handleFillMissingV2`). */
export function parametresRemplissage(c: ContexteBataille, paliers: readonly number[]): FillIsochroneCacheParams {
  return { category: c.categorie, mode: c.mode, durations: croissant(paliers), max_minutes: Math.max(...paliers), ...portee(c) };
}

/** Les paramètres de la bataille V2 (`handleBattleV2`). */
export function parametresV2(c: ContexteBataille, paliers: readonly number[], force: boolean): DirectBattleV2Params {
  return { category: c.categorie, mode: c.mode, ...portee(c), paliers: croissant(paliers), force_battle: force };
}

/**
 * Le corps EXACT envoyé à `POST /api/isochrone-battle` (`useMapDirectActions.ts:130-140,301-311`) : un filtre absent
 * part en `null`, jamais omis — la route protégée le reçoit ainsi depuis React.
 */
export function corpsBatailleV1(p: DirectBattleParams | FillIsochroneCacheParams, force: boolean) {
  return {
    category: p.category, mode: p.mode, max_minutes: p.max_minutes, durations: p.durations,
    filtre_ville: p.filtre_ville ?? null, filtre_regions: p.filtre_regions ?? null, filtre_depts: p.filtre_depts ?? null,
    metropolitaine: p.metropolitaine, force_recalculate: force,
  };
}

/** « territoire : … » du journal V1 (`use-isochrone-battle.ts:239-242`). */
export function libelleTerritoire(p: DirectBattleParams, t: TerritoireBataille, regionsRef: readonly RegionNommee[]): string {
  return p.filtre_ville
    ?? (t.depts.length > 0 ? `${t.depts.length} dept(s)` : null)
    ?? (t.regions.length > 0 ? t.regions.map((code) => regionsRef.find((r) => r.code_region === code)?.nom_region ?? code).join(' + ') : null)
    ?? 'France métropolitaine';
}
