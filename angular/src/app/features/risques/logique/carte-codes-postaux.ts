/**
 * Logique PURE de la carte des codes postaux de l'étape ④ (`cartes/carte-codes-postaux.component.ts`) : identifiants
 * des sources et couches, variables de coloration et leurs bornes FIXES, jetons de la palette fixe, expressions
 * MapLibre, bulle de survol. Sortie du composant au lot 4 (T22) : le composant ne garde que le cycle de vie MapLibre et
 * les lectures.
 */
import type maplibregl from 'maplibre-gl';
import { formaterDecimal, formaterNombre } from '../../../core/format/nombre';

export const SOURCE_CP = 'zoneset-cp';
export const SOURCE_RAYONS_CP = 'zoneset-rayons';
export const ID_FOND_CP = 'zoneset-cp-fond';
export const ID_CONTOUR_CP = 'zoneset-cp-contour';
export const ID_ECARTES_CP = 'zoneset-cp-ecartes';
export const ID_SURBRILLANCE_CP = 'zoneset-cp-surbrillance';
export const ID_RAYONS_CP = 'zoneset-rayons-contour';

/**
 * Les trois variables de coloration (`CarteCodesPostaux.tsx:49-67`). Elles ne répondent PAS à la même question :
 * `plan`, ce que le code postal reçoit du budget ; `exposition`, la part de SES habitants réellement en zone (la
 * dilution) ; `population`, combien d'exposés il porte.
 */
export type ColorationCp = 'plan' | 'exposition' | 'population';

export const LIBELLE_COLORATION: Record<ColorationCp, string> = {
  plan: 'Part du plan',
  exposition: 'Taux d’exposition',
  population: 'Population exposée',
};

/**
 * ⚠ Bornes FIXES par variable, jamais dérivées de ce qui est à l'écran : une échelle recalculée à chaque panoramique
 * fait changer la couleur d'un code postal qui n'a pas bougé (`CarteCodesPostaux.tsx:258-270`).
 */
export const ECHELLES: Record<ColorationCp, [champ: string, bornes: readonly number[]]> = {
  plan: ['part_plan', [0, 0.0005, 0.001, 0.002, 0.004]],
  exposition: ['taux_exposition', [0, 20, 40, 60, 80]],
  population: ['pop_en_zone', [0, 2000, 8000, 20000, 50000]],
};

/** Les compteurs du bandeau, tels que la route les rend. */
export interface ChiffresCp {
  n_total: number;
  n_affiches: number;
  n_retenus: number;
  taux_utile: number | null;
}

/**
 * Les teintes de cette carte, d'un THÈME FIXE (A11) : le fond est Positron dans les deux thèmes, et React peignait
 * toujours la rampe `--seq-*` SOMBRE (`RAMPE`), le gris neutre d'un écarté (`GRIS_ECARTE`, = `--donnee-absente` à
 * 0,28), le contour orange des rayons (`#e0603f` = `--niveau-haut` sombre) et la surbrillance teal.
 * Seul le contour des codes postaux n'a pas de jeton : React écrivait `rgba(120,120,120,0.55)` ; on prend
 * `--text-tertiary` (#8a8a8a, invariant) à la même opacité — écart listé au rapport T15.
 */
export const JETONS_CP = {
  r1: 'seq-1', r2: 'seq-2', r3: 'seq-3', r4: 'seq-4', r5: 'seq-5',
  ecarte: 'donnee-absente', contour: 'text-tertiary', rayons: 'niveau-haut', surbrillance: 'brand-teal',
} as const;
export type TeintesCp = Record<keyof typeof JETONS_CP, string>;
/** L'opacité du gris d'un écarté, appliquée par `fill-opacity` et non recopiée dans un `rgba`. */
export const OPACITE_ECARTE = 0.28;

export function expressionCouleur(coloration: ColorationCp, t: TeintesCp): maplibregl.ExpressionSpecification {
  const [champ, b] = ECHELLES[coloration];
  return [
    'interpolate', ['linear'], ['coalesce', ['get', champ], 0],
    b[0], t.r1, b[1], t.r2, b[2], t.r3, b[3], t.r4, b[4], t.r5,
  ] as unknown as maplibregl.ExpressionSpecification;
}

export const filtreSurbrillance = (codes: readonly string[] | null) =>
  ['in', ['get', 'code_postal'], ['literal', codes ?? []]] as unknown as maplibregl.FilterSpecification;

/**
 * Le taux d'exposition tel que la route le rend (arrondi au dixième par sql/230) : `23` reste `23`, `23.4` devient
 * `23,4` — les mêmes chiffres que React, la virgule en plus.
 */
export const tauxExposition = (t: number): string => (Number.isInteger(t) ? formaterNombre(t) : formaterDecimal(t, 1));

/**
 * La bulle d'un code postal (`CarteCodesPostaux.tsx:363-382`), par `textContent` et jamais par `innerHTML`.
 * Deux nombres sont écrits à la française, là où React écrivait un point décimal (`23.4 %`, `0.123 %`) — défaut
 * corrigé et listé au rapport T15.
 */
export function contenuBulleCp(p: Record<string, unknown>, doc: Document = document): HTMLElement {
  const ligne = (texte: string, classe = '') => {
    const d = doc.createElement('div');
    if (classe) d.className = classe;
    d.textContent = texte;
    return d;
  };
  const racine = doc.createElement('div');
  racine.className = 'text-[11px] leading-[1.5]';
  const titre = ligne(String(p['code_postal']), 'font-medium');
  const membres = Number(p['n_membres'] ?? 1);
  // ⚠ Le polygone dessiné est celui de la COMMUNE : le référentiel ne distingue pas les contours des codes postaux
  // d'une même ville (sql/228). Le taire ferait lire « 44000 » comme un quartier.
  if (membres > 1) {
    const s = doc.createElement('span');
    s.className = 'opacity-70';
    s.textContent = ` + ${membres - 1} code(s) indissociable(s)`;
    titre.appendChild(s);
  }
  const taux = p['taux_exposition'];
  racine.append(
    titre,
    ligne(`Exposés : ${formaterNombre(Number(p['pop_en_zone'] ?? 0))} / ${formaterNombre(Number(p['pop_totale'] ?? 0))} habitants`),
    ligne(`Taux d’exposition : ${taux == null ? '—' : tauxExposition(Number(taux))} %`),
    ligne(`Part du plan : ${formaterDecimal(Number(p['part_plan'] ?? 0) * 100, 3)} %`),
    ligne(p['retenu'] ? 'Acheté' : 'Écarté par le seuil', 'opacity-75'),
  );
  return racine;
}
