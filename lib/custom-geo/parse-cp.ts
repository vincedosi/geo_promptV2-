/**
 * @file lib/custom-geo/parse-cp.ts — lire une liste de codes postaux collée ou
 * déposée (Tâche 16, 2026-09-13).
 *
 * Le média planner arrive avec une liste de CP dans un mail, un tableur ou un
 * CSV du client. Ce module en fait une liste propre, et **dit ce qu'il a
 * rejeté** : un import silencieux qui perd 40 codes postaux produit une zone
 * plus petite que commandée, et rien ne le signale avant la facture.
 *
 * ── Les pièges, tous rencontrés sur des données réelles ───────────────────
 *
 * - **Le zéro initial.** `01000` et `20000` passés par un tableur deviennent
 *   `1000` et `20000`. On ne convertit donc JAMAIS en nombre : un code postal
 *   est une CHAÎNE de cinq chiffres, pas un entier.
 * - **Les espaces invisibles.** CLAUDE.md l'impose pour les CSV INSEE, et un
 *   copier-coller depuis une page web ajoute en plus des espaces insécables
 *   (U+00A0, U+202F) — invisibles à l'écran, fatals à une comparaison.
 * - **Le BOM UTF-8** en tête d'un fichier Windows déposé, qui collerait au
 *   premier code et le ferait rejeter.
 * - **Les guillemets** d'un export tableur (`"75001";"75002"`).
 * - **Un code à six chiffres est REJETÉ**, jamais tronqué à cinq : tronquer
 *   fabriquerait un code postal valide mais faux, donc une zone silencieusement
 *   décalée. Mieux vaut le signaler.
 */

/** Séparateurs acceptés : virgule, point-virgule, tabulation, espaces, sauts de ligne. */
const SEPARATEURS = /[\s,;]+/;

/** Un code postal français : exactement cinq chiffres. */
const CODE_VALIDE = /^\d{5}$/;

/**
 * Caractères à retirer avant de juger un jeton : BOM, guillemets d'export
 * tableur, espaces insécables des copier-coller web.
 */
const PARASITES = /[﻿"'  ]/g;

/**
 * Au-delà, la liste de rejets n'est plus lisible à l'écran. Le COMPTE, lui,
 * reste exact : c'est lui qui dit l'ampleur du problème.
 */
const MAX_REJETS_RAPPORTES = 50;

export interface ResultatParseCp {
  /** Codes valides, dédoublonnés, DANS L'ORDRE de la saisie. */
  codes: string[];
  /** Jetons rejetés, dédoublonnés, bornés à 50 pour rester affichables. */
  rejetes: string[];
  /** Nombre TOTAL de rejets, même au-delà des 50 rapportés. */
  nRejetes: number;
}

/**
 * Découpe une saisie libre en codes postaux valides et en rejets.
 *
 * L'ordre de saisie est conservé — un média planner colle souvent sa liste dans
 * un ordre qui a un sens pour lui (par ville, par priorité), et la lui rendre
 * mélangée lui coûterait une relecture.
 */
export function parserCodesPostaux(saisie: string): ResultatParseCp {
  if (typeof saisie !== 'string' || !saisie.trim()) {
    return { codes: [], rejetes: [], nRejetes: 0 };
  }

  const codes: string[] = [];
  const rejetes: string[] = [];
  const vusCodes = new Set<string>();
  const vusRejets = new Set<string>();
  let nRejetes = 0;

  for (const brut of saisie.split(SEPARATEURS)) {
    const jeton = brut.replace(PARASITES, '').trim();
    if (!jeton) continue;

    if (CODE_VALIDE.test(jeton)) {
      if (!vusCodes.has(jeton)) {
        vusCodes.add(jeton);
        codes.push(jeton);
      }
      continue;
    }

    if (!vusRejets.has(jeton)) {
      vusRejets.add(jeton);
      nRejetes++;
      // Le compte est exact ; seule la LISTE est bornée.
      if (rejetes.length < MAX_REJETS_RAPPORTES) rejetes.push(jeton);
    }
  }

  return { codes, rejetes, nRejetes };
}
