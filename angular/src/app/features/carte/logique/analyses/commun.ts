import { HttpErrorResponse } from '@angular/common/http';
import { messageErreurApi } from '../../../../core/http/erreurs';

/**
 * Ce que les trois écrans d'analyse (score composite, corrélation, mes analyses — lot 4, T18) partagent : la date
 * française et le message d'une requête refusée. React les écrivait en ligne dans chaque composant.
 */

/** `new Date(iso).toLocaleDateString('fr-FR')`, « — » sans date (`ScoreCompositeTool.tsx:394`). */
export function dateFr(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('fr-FR') : '—';
}

/** « 11/10/2026 · cp · échec » : date, maillage, statut s'il n'est pas « terminé » (`PanneauCalques.tsx:694-698`). */
export function ligneMetaAnalyse(a: { created_at: string; maillage: string | null; statut: string }): string {
  const statut = a.statut !== 'termine' ? ` · ${a.statut === 'echec' ? 'échec' : 'en cours'}` : '';
  return `${dateFr(a.created_at)}${a.maillage ? ` · ${a.maillage}` : ''}${statut}`;
}

/**
 * `data.error ??\`Erreur ${res.status}\`` de React (`ScoreCompositeTool.tsx:169`, `CorrelationTool.tsx:121`) : la
 * phrase que la route a écrite pour l'utilisateur, sinon le statut. Réseau coupé (statut 0, aucune réponse) : le
 * message commun de l'application plutôt que « Erreur 0 », qui ne dit rien.
 */
export function messageErreurRequete(e: unknown): string {
  if (e instanceof HttpErrorResponse) {
    const corps = e.error as { error?: unknown } | null;
    if (corps && typeof corps === 'object' && typeof corps.error === 'string' && corps.error) return corps.error;
    return e.status === 0 ? messageErreurApi(e) : `Erreur ${e.status}`;
  }
  return e instanceof Error ? e.message : String(e);
}
