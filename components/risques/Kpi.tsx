'use client';

import React from 'react';
import { fInter, fMono } from '@/lib/design/polices';

/**
 * Un indicateur chiffré : la valeur en gros, son libellé, sa note de lecture.
 *
 * ── POURQUOI IL EST SORTI DES DEUX ÉCRANS ─────────────────────────────────
 *
 * Il était écrit deux fois, dans `AnalysePopulationOverlay` et
 * `OngletRayonInfluence` — deux composants montés dans le MÊME overlay, à un
 * onglet d'écart (constat R-18 de `docs/AUDIT_ZONE_RISQUE.md`). Les deux copies
 * ne différaient que par la taille de la valeur, 24 px contre 22.
 *
 * ── LA NOTE N'EST PAS DÉCORATIVE ──────────────────────────────────────────
 *
 * Tous les chiffres de cet écran demandent une précaution de lecture : la
 * colonne « sites » ne s'additionne pas, une zone peut venir d'un arrêté
 * préfectoral ou d'un rayon que nous avons choisi, l'outre-mer n'est pas
 * calculable partout. `note` est l'endroit prévu pour ça, et c'est pourquoi
 * elle est OBLIGATOIRE : un KPI sans note, ici, est un KPI qu'on n'a pas fini
 * d'expliquer.
 */
interface Props {
  /** La valeur, déjà formatée — le composant ne met jamais en forme lui-même. */
  valeur: string;
  /** Ce que la valeur mesure. */
  libelle: string;
  /** La précaution de lecture. Obligatoire, voir ci-dessus. */
  note: string;
  /** Met la valeur à l'accent de marque. Réservé au chiffre principal de l'écran. */
  accent?: boolean;
  /**
   * Taille de la valeur en pixels.
   *
   * 24 dans l'onglet population, 22 dans l'onglet rayon : la seule chose qui
   * distinguait les deux copies. Conservée telle quelle — l'uniformiser
   * changerait l'apparence, ce qui n'est pas le rôle d'un dédoublonnage.
   */
  taille?: 22 | 24;
}

export function Kpi({ valeur, libelle, note, accent, taille = 24 }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span
        style={{
          fontFamily: fMono,
          fontSize: taille,
          lineHeight: 1.1,
          color: accent ? 'var(--brand-teal)' : 'var(--text-primary)',
        }}
      >
        {valeur}
      </span>
      <span style={{ fontFamily: fInter, fontSize: taille === 24 ? 12 : 11, color: 'var(--text-secondary)' }}>
        {libelle}
      </span>
      <span style={{ fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)' }}>
        {note}
      </span>
    </div>
  );
}
