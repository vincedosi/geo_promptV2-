/**
 * @file lib/zones/unite-cp.ts — l'UNITÉ de la maille CP : le groupe de codes postaux indiscernables (A2, plan de
 * corrections du découpage des zones, 2026-10-31).
 *
 * ── POURQUOI UNE UNITÉ ET PAS UN CODE ─────────────────────────────────────
 *
 * `ref_codes_postaux` porte la MÊME géométrie pour tous les codes postaux de certaines communes (Saint-Denis :
 * 93200, 93210, 93380 ; Toulouse : six codes) — 71 groupes, 181 codes (sql/228). Aucun calcul ne peut dire dans
 * lequel habite un exposé : chaque carreau est rattaché au code CANONIQUE du groupe, et la couverture rend UNE ligne
 * par groupe. Cette ligne est l'unité de calcul : une part, un seuil, un multiplicateur. Depuis sql/304 elle le dit
 * elle-même : `code` est l'identifiant de l'unité (le canonique), `membres` la liste de ses codes.
 *
 * ── LA RÈGLE DE DÉVELOPPEMENT ─────────────────────────────────────────────
 *
 * Les plateformes achètent des codes, pas des groupes : à l'extraction, une unité devient autant de lignes que de
 * membres, avec le MÊME multiplicateur (décision du chef de projet, A2). Les populations restent sur la ligne du
 * canonique, `null` sur les autres membres : sommer les lignes ne compte jamais un habitant deux fois, et un 0 se
 * lirait « personne ».
 *
 * ⚠ « Même multiplicateur » ou « divisé par le nombre de membres » dépend de la façon dont la plateforme cumule les
 * poids d'une impression ; ce n'est PAS tranché ici. Le registre le porte (`plateformes_geo.poids_groupe_cp`, seed
 * `meme`) et le marque « à vérifier » (`parametres_a_verifier`). Le chemin RISQUE (`genererPlanCp` avec ses
 * `membres`, `etendreAuxGroupes`) garde la division, inchangé (ruling A1 ↔ ⑥ du lot 1).
 */
import type { MembresParCanonique } from './plan';

/** Une unité CP : son identifiant (le code canonique) et ses codes, triés, le canonique compris. */
export interface UniteCp {
  code: string;
  membres: readonly string[];
}

/**
 * Les codes d'une unité CP.
 *
 * `membres` de la ligne (sql/304) fait foi. À défaut — ligne synthétique d'une liste exacte sans carreau, ou chiffrage
 * d'avant sql/304 —, le groupe lu dans `cp_groupe` (`lireGroupesCp`), puis le code seul.
 */
export function membresDe(
  ligne: { code: string; membres?: readonly string[] | null }, groupes?: MembresParCanonique,
): readonly string[] {
  if (ligne.membres && ligne.membres.length > 0) return ligne.membres;
  return groupes?.get(ligne.code) ?? [ligne.code];
}

/** L'inverse d'un ensemble d'unités : code → identifiant de son unité. Un code absent est son propre canonique. */
export function canoniques(unites: Iterable<UniteCp>): Map<string, string> {
  const de = new Map<string, string>();
  for (const u of unites) for (const m of u.membres) de.set(m, u.code);
  return de;
}

/** Les unités d'une carte de groupes (`lireGroupesCp`). */
export function unitesDeGroupes(groupes: MembresParCanonique): UniteCp[] {
  return [...groupes].map(([code, membres]) => ({ code, membres }));
}

/** Une ligne développée : l'unité d'origine, un de ses codes, et s'il en est le canonique. */
export interface CodeDeveloppe<U> {
  unite: U;
  code_postal: string;
  est_canonique: boolean;
}

/**
 * Développe des unités en codes : une ligne par membre, dans l'ordre des unités puis des membres. Ce que porte
 * l'unité (multiplicateur, classe, retenu) est recopié tel quel par l'appelant ; seules les populations sont à
 * réserver au canonique (`est_canonique`).
 */
export function developperUnites<U>(
  unites: readonly U[], membres: (u: U) => readonly string[], code: (u: U) => string,
): CodeDeveloppe<U>[] {
  return unites.flatMap((unite) => {
    const id = code(unite);
    return membres(unite).map((code_postal) => ({ unite, code_postal, est_canonique: code_postal === id }));
  });
}
