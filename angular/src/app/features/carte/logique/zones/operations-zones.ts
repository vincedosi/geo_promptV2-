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

export type OperationZones = 'union' | 'intersection' | 'difference';

/** La route de la famille `custom-geo/source/*` — et le `source_type` de la zone créée. */
export type SourceOperation = 'composite' | 'intersection' | 'difference';

export interface DefinitionOperation {
  libelle: string;
  source: SourceOperation;
  /** Nombre minimum de zones cochées. */
  min: number;
  /** Infobulle du bouton. */
  aide: string;
}

/**
 * Les trois opérations, dans l'ordre des boutons (`OPERATIONS`, `ZonesOperations.tsx:39-56`). « Restreindre à » et
 * non « Intersection » : au-delà de deux zones, le calcul est « A restreint à B ∪ C » — le mot de React, mesuré juste.
 */
export const OPERATIONS_ZONES: Readonly<Record<OperationZones, DefinitionOperation>> = {
  union: { libelle: 'Fusionner', source: 'composite', min: 2, aide: 'tout ce que couvrent les zones cochées' },
  intersection: { libelle: 'Restreindre à', source: 'intersection', min: 2, aide: 'la première, limitée à ce que couvrent les autres' },
  difference: { libelle: 'Soustraire', source: 'difference', min: 2, aide: 'la première, moins toutes les autres' },
};

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
export const MESSAGE_RESOLUTION_ECHOUEE = 'Zone créée, mais la résolution des codes postaux a échoué — retirez-la et réessayez.';

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
