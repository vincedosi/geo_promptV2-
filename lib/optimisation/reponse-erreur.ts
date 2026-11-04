/**
 * @file lib/optimisation/reponse-erreur.ts — une défaillance du service d'optimisation en réponse Next, la même pour
 * toutes les passerelles de réglage d'une campagne (`…/optimisation/algo`, `…/optimisation/reglages`).
 *
 * - 404 du service (campagne hors de l'espace transmis) → notre propre 404, sans dire si la campagne existe ;
 * - 422 (choix refusé) → message français et code stable relayés tels quels ;
 * - le reste → 503 / 504 / 502 selon le motif, jamais masqué.
 * Toute autre exception est relancée : ce n'est pas une panne du service.
 */
import { NextResponse } from 'next/server';
import { ErreurOptimisation, type MotifErreur } from '@/lib/optimisation/client';

const STATUT_PAR_MOTIF: Record<MotifErreur, number> = {
  configuration: 503,
  reseau: 503,
  indisponible: 503,
  delai: 504,
  refus: 502,
  serveur: 502,
  reponse: 502,
};

export const CAMPAGNE_INTROUVABLE = { error: 'Campagne introuvable.' };

export function reponseErreurOptimisation(e: unknown): NextResponse {
  if (!(e instanceof ErreurOptimisation)) throw e;
  if (e.statut === 404) return NextResponse.json(CAMPAGNE_INTROUVABLE, { status: 404 });
  if (e.statut === 422) return NextResponse.json({ error: e.refus ?? 'refus', message: e.message }, { status: 422 });
  return NextResponse.json({ error: e.message, motif: e.motif }, { status: STATUT_PAR_MOTIF[e.motif] });
}
