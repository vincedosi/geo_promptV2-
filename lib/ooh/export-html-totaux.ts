/**
 * @file lib/ooh/export-html-totaux.ts
 *
 * Les totaux d'une campagne OOH pour son export HTML (`lib/ooh/export-html.ts`) : le PONT entre la somme des lignes
 * média et le budget du plan. Sans lui, le document affichait « budget 249 674 € » en synthèse et « total des lignes
 * 229 699 € » au pied du tableau, sans rien entre les deux : l'écart est le coût d'impression (19 975,20 €), un coût
 * ANNEXE du plan que l'import range dans `campagnes.metadata.couts_annexes` (relecture du 2026-10-19, I-1).
 */
import type { CampagneOohLue } from '@/types/campagne-ooh';

export interface TotauxCampagne {
  /** Somme des `total_ttc` des lignes ; `null` si aucune ligne n'a de montant. */
  sousTotalLignes: number | null;
  /** Les coûts hors lignes média (`campagnes.metadata.couts_annexes`), libellé en casse de phrase. */
  annexes: { libelle: string; total_ttc: number }[];
  /** Lignes + annexes ; `null` sans aucun montant. */
  total: number | null;
  /** Le budget du plan (`budget_total_ttc`). */
  budget: number | null;
  /** `budget − total` au CENTIME : 0 quand les deux concordent (TF4 : 0,0024 € d'arrondi du fichier source, sous le centime). */
  ecart: number;
}

/** « IMPRESSION JUSQU’À 5 VISUELS » → « Impression jusqu’à 5 visuels » ; un libellé déjà en casse mixte est gardé. */
function casseDePhrase(t: string): string {
  if (t !== t.toUpperCase()) return t;
  const bas = t.toLowerCase();
  return bas.charAt(0).toUpperCase() + bas.slice(1);
}

const auCentime = (v: number) => Math.round(v * 100) / 100;

/** TF4 : 229 698,90 € de lignes + 19 975,20 € d'impression = 249 674,10 €, le budget du plan au centime. */
export function totauxCampagne(d: CampagneOohLue): TotauxCampagne {
  const sousTotalLignes = d.lignes.some((l) => l.total_ttc !== null) ? d.lignes.reduce((s, l) => s + (l.total_ttc ?? 0), 0) : null;
  const brutes = d.campagne.metadata?.couts_annexes;
  const annexes = (Array.isArray(brutes) ? brutes : [])
    .filter((a) => typeof a?.total_ttc === 'number' && Number.isFinite(a.total_ttc))
    .map((a) => ({ libelle: casseDePhrase(String(a.libelle ?? 'Coût annexe')), total_ttc: a.total_ttc as number }));
  const total = sousTotalLignes === null && annexes.length === 0
    ? null : (sousTotalLignes ?? 0) + annexes.reduce((s, a) => s + a.total_ttc, 0);
  const budget = d.campagne.budget_total_ttc;
  const ecart = budget === null || total === null ? 0 : auCentime(auCentime(budget) - auCentime(total));
  return { sousTotalLignes, annexes, total, budget, ecart };
}
