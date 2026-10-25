/**
 * ⑥ Plan — les gestes de saisie des sections Plateformes et Impressions (lot 6, T5), logique pure : le brouillon est
 * rendu neuf, jamais muté (`PlanCampagneService.modifier`).
 *
 * Écart à React (`StepCanaux.tsx`, `toggle`) : DÉCOCHER une plateforme retire aussi son budget et son CPM prévu. React
 * les gardait dans `channelBudgets` (filtrés à l'affichage, élagués par le serveur) ; ici, recocher repart d'une ligne
 * vide plutôt que de ressusciter un montant que l'écran ne montrait plus.
 */
import type { ProgDraft } from './brouillon';
import type { ChannelBudgets } from './canaux';

/** Les deux colonnes de montants par plateforme : budget (€) et CPM prévu (€). */
export type ChampMontant = 'channelBudgets' | 'cpmPrevus';

const sans = (m: ChannelBudgets | undefined, code: string): ChannelBudgets =>
  Object.fromEntries(Object.entries(m ?? {}).filter(([c]) => c !== code));

/** Coche ou décoche une plateforme ; décochée, son budget et son CPM prévu partent avec elle. */
export function basculerPlateforme(d: ProgDraft, liste: 'dsps' | 'socials', code: string): ProgDraft {
  const cochee = d.channels[liste].includes(code);
  const channels = { ...d.channels, [liste]: cochee ? d.channels[liste].filter((c) => c !== code) : [...d.channels[liste], code] };
  if (!cochee) return { ...d, channels };
  return { ...d, channels, channelBudgets: sans(d.channelBudgets, code), cpmPrevus: sans(d.cpmPrevus, code) };
}

/** Pose (ou retire, `null`) le montant d'une plateforme dans une colonne. */
export function poserMontant(d: ProgDraft, champ: ChampMontant, code: string, valeur: number | null): ProgDraft {
  const suite = sans(d[champ], code);
  return { ...d, [champ]: valeur === null ? suite : { ...suite, [code]: valeur } };
}

/**
 * La valeur d'un champ numérique, ARRONDIE au centime (relecture 3, M2 : sinon les impressions se calculaient sur
 * 1 234,567 € quand `total_budget` en stockait 1 234,57) ; vide, illisible ou négative → `null` (ligne retirée).
 */
export function lireMontant(brut: string): number | null {
  if (brut.trim() === '') return null;
  const n = Number(brut);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}
