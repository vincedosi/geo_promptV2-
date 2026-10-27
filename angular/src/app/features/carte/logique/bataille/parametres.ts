/**
 * Logique PURE des paramètres d'une bataille d'isochrones — portage de `use-isochrone-battle.ts:92-101,152-159,
 * 224-242,317-326` et de la dérivation du territoire de `PanneauAnalyse.tsx:186-194` (lot 4, T17).
 *
 * Le territoire de la bataille ne vient PAS du sélecteur de périmètre (code mort depuis la refonte du panneau Filtre,
 * `PanneauAnalyse.tsx:66-75`) mais du FILTRE UNIQUE : une commune donne la ville, une région ou un département leur
 * code. Les autres filtres (code postal, zone, France) ne restreignent rien — comme React. Mais un code postal ou une
 * zone sont un périmètre CHOISI, qui passe la garde : la bataille partait alors sur toute la métropole, un calcul national
 * (appels ORS, I/O) que l'utilisateur croyait local. `messageRefusTerritoireBataille` le refuse (écart voulu, ci-dessous).
 */
import type { FiltreActif } from '../filtre';
import type { DirectBattleV2Params, FillIsochroneCacheParams } from '../modes-isochrones';

/** Le territoire d'une bataille (`filtreVilleBattle` / `filtreRegionsBattle` / `filtreDeptsBattle`). */
export interface TerritoireBataille {
  ville: string;
  regions: string[];
  depts: string[];
}

/** Ce que les trois appels partagent : la catégorie unique, le mode, le territoire, la taille du référentiel régions. */
export interface ContexteBataille {
  categorie: string;
  mode: string;
  territoire: TerritoireBataille;
  /** `REF_REGIONS.length` : 0 tant que le référentiel n'est pas lu. */
  nbRegionsRef: number;
}

export function territoireDuFiltre(filtre: FiltreActif | null): TerritoireBataille {
  return {
    ville: filtre?.type === 'commune' ? filtre.label : '',
    regions: filtre?.type === 'region' ? [filtre.code] : [],
    depts: filtre?.type === 'departement' ? [filtre.code] : [],
  };
}

/**
 * Le refus d'un filtre que la bataille ne sait PAS transmettre — code postal ou zone enregistrée — `null` si le filtre
 * est transmis (commune, département, région) ou déjà jugé par `messageGardeOutil` (absent, France entière).
 *
 * DÉFAUT REACT CORRIGÉ (revue finale du lot 4, arbitrage de la ligne 71 du registre inversé par le contrôleur) : React
 * laissait ce filtre passer la garde puis l'ignorait — `territoireDuFiltre` ne rend alors aucun territoire, et la
 * bataille portait sur toute la métropole. Le refus le dit au lieu de calculer autre chose que ce qui est demandé.
 */
export function messageRefusTerritoireBataille(filtre: FiltreActif | null): string | null {
  if (filtre?.type === 'cp') {
    return 'La bataille isochrone ne sait pas encore se borner à un code postal — choisissez une commune, un département ou une région.';
  }
  if (filtre?.type === 'zone') {
    return 'La bataille isochrone ne sait pas encore se borner à une zone enregistrée — choisissez une commune, un département ou une région.';
  }
  return null;
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
 * La portée géographique commune aux trois corps. Règle métier conservée : quand TOUTES les régions sont choisies,
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

/** Le remplissage du cache des paliers V2 manquants (`handleFillMissingV2`). */
export function parametresRemplissage(c: ContexteBataille, paliers: readonly number[]): FillIsochroneCacheParams {
  return { category: c.categorie, mode: c.mode, durations: croissant(paliers), max_minutes: Math.max(...paliers), ...portee(c) };
}

/** Les paramètres de la bataille V2 (`handleBattleV2`). */
export function parametresV2(c: ContexteBataille, paliers: readonly number[], force: boolean): DirectBattleV2Params {
  return { category: c.categorie, mode: c.mode, ...portee(c), paliers: croissant(paliers), force_battle: force };
}

/**
 * Le corps EXACT du remplissage V2, envoyé à `POST /api/isochrone-battle` (`useMapDirectActions.ts:301-311`) : un
 * filtre absent part en `null`, jamais omis, et `force_recalculate` à `false` — la route protégée le reçoit ainsi depuis
 * React. (`corpsBatailleV1` jusqu'au retrait de la V1, 27/10.)
 */
export function corpsRemplissage(p: FillIsochroneCacheParams) {
  return {
    category: p.category, mode: p.mode, max_minutes: p.max_minutes, durations: p.durations,
    filtre_ville: p.filtre_ville ?? null, filtre_regions: p.filtre_regions ?? null, filtre_depts: p.filtre_depts ?? null,
    metropolitaine: p.metropolitaine, force_recalculate: false,
  };
}
