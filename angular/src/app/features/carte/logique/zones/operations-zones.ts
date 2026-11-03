/**
 * Logique PURE des opérations booléennes sur les zones enregistrées — portage de
 * `components/map/overlays/ZonesOperations.tsx:37-151` (lot 4, T14), textes et formules EXACTS de React.
 *
 * ── L'ORDRE DE LA SÉLECTION EST SIGNIFIANT ───────────────────────────────
 * La sélection est un TABLEAU, jamais un `Set` : « A moins B » et « B moins A » ne donnent pas la même chose, et rien
 * dans le résultat ne dirait laquelle on a obtenue. La première zone cochée est la BASE de « Soustraire » et de
 * « Restreindre à » ; l'interface le dit en toutes lettres.
 *
 * ── AUCUNE ZONE CRÉÉE À VIDE ─────────────────────────────────────────────
 * Les routes répondent 409 sur une intersection ou une soustraction sans reste ; leur message, déjà en français, est
 * relayé tel quel et rien n'est enregistré. Une zone à zéro code postal partirait vers un DSP et la campagne ne
 * diffuserait nulle part sans que rien ne l'ait signalé.
 */
import { formaterNombre } from '../../../../core/format/nombre';
import { MAX_ZONES_COMBINAISON } from './recette';

export type OperationZones = 'union' | 'intersection' | 'difference';

export interface DefinitionOperation {
  libelle: string;
  /** Nombre minimum de zones cochées. */
  min: number;
  /** Nombre maximum de zones cochées, quand il y en a un. */
  max?: number;
  /** Infobulle du bouton. */
  aide: string;
}

/**
 * Les trois opérations, dans l'ordre des boutons (`OPERATIONS`, `ZonesOperations.tsx:39-56`). « Restreindre à » et
 * non « Intersection », le mot de React. Écart voulu : React l'admettait sur plus de deux zones au sens « A restreint
 * à B ∪ C » ; la recette `combinaison` l'admet de 2 à 20 zones (C20) au sens de l'intersection de TOUTES
 * (`zone_intersection_toutes`, sql/325) — ce que les zones cochées ont toutes en commun.
 */
export const OPERATIONS_ZONES: Readonly<Record<OperationZones, DefinitionOperation>> = {
  union: { libelle: 'Fusionner', min: 2, max: MAX_ZONES_COMBINAISON, aide: 'tout ce que couvrent les zones cochées' },
  intersection: { libelle: 'Restreindre à', min: 2, max: MAX_ZONES_COMBINAISON, aide: 'ce que toutes les zones cochées ont en commun' },
  difference: { libelle: 'Soustraire', min: 2, max: MAX_ZONES_COMBINAISON, aide: 'la première, moins toutes les autres' },
};

/** C20 round 1 : la raison affichée quand plus de `MAX_ZONES_COMBINAISON` zones sont cochées (le schéma les refuse). */
export const MESSAGE_TROP_DE_ZONES = `Cochez ${MAX_ZONES_COMBINAISON} zones au plus.`;

/** L'opération est-elle possible sur `n` zones cochées ? */
export function operationPossible(op: OperationZones, n: number): boolean {
  const d = OPERATIONS_ZONES[op];
  return n >= d.min && n <= (d.max ?? Infinity);
}

export const ORDRE_OPERATIONS: readonly OperationZones[] = ['union', 'intersection', 'difference'];

/** Le nom d'une zone de la sélection, ou les huit premiers caractères de son id (`nomDe`, l.75). */
export function nomDansSelection(noms: ReadonlyMap<string, string>, id: string): string {
  return noms.get(id) ?? id.slice(0, 8);
}

/** Le nom de la zone créée, borné à 200 caractères à l'enregistrement (`ZonesOperations.tsx:108-112`). */
export function nomZoneCreee(op: OperationZones, selection: readonly string[], noms: ReadonlyMap<string, string>): string {
  const base = nomDansSelection(noms, selection[0]);
  const autres = selection.length - 1;
  const pluriel = selection.length > 2 ? 's' : '';
  if (op === 'difference') return `${base} — moins ${autres} zone${pluriel}`;
  if (op === 'intersection') return `${base} — restreinte à ${autres} zone${pluriel}`;
  return `Fusion de ${selection.length} zones — ${base}…`;
}

// Depuis le lot 3 (T10), une opération s'écrit en UN appel (`POST /api/zones`, recette `combinaison`) : le corps des
// routes `/source/*` et la traduction de leurs refus ne servent plus — le message d'échec est `messageErreurZone`.

/** L'enregistrement a échoué (`!saveRes.ok`). */
export const MESSAGE_SAUVEGARDE_ECHOUEE = 'Sauvegarde de la zone échouée.';
/** 207 : zone créée, mais ses codes postaux n'ont pas été résolus (`ZonesOperations.tsx:136-138`). */
export const MESSAGE_RESOLUTION_ECHOUEE = 'Zone créée, mais la résolution des codes postaux a échoué.';

/**
 * « Zone créée : 1 234 codes postaux · 56,7 km² » (`ZonesOperations.tsx:140-144`).
 *
 * Défaut de React corrigé : il ajoutait « ux » APRÈS « postal » (`postal` + `ux`) et affichait « codes postalux ».
 */
export function messageZoneCreee(countCp: number | null | undefined, surfaceKm2: number | null | undefined): string {
  const n = countCp ?? 0;
  return `Zone créée : ${formaterNombre(n)} ${n > 1 ? 'codes postaux' : 'code postal'}`
    + (surfaceKm2 ? ` · ${formaterNombre(surfaceKm2)} km²` : '');
}

/** « N zone(s) sélectionnée(s) » (`ZonesOperations.tsx:159`). */
export function libelleSelection(n: number): string {
  return `${n} zone${n > 1 ? 's' : ''} sélectionnée${n > 1 ? 's' : ''}`;
}

/** Coche ou décoche une zone en gardant l'ORDRE de cochage (`ZonesOverlay.tsx:410-412`). */
export function basculerDansSelection(selection: readonly string[], id: string): string[] {
  return selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id];
}

/**
 * Retire de la sélection les zones qui n'existent plus (A6g, `ZonesOverlay.tsx:161-168`) — supprimées ici ou ailleurs —
 * sinon l'opération suivante part avec leur uuid et répond 404. Rend la MÊME référence quand rien ne change.
 */
export function selectionExistante(selection: string[], existants: ReadonlySet<string>): string[] {
  const filtree = selection.filter((id) => existants.has(id));
  return filtree.length === selection.length ? selection : filtree;
}
