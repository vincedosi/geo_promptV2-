import type { FiltreActif } from '../filtre';
import type { PerimetreRecette } from './recette';

/**
 * Le périmètre de ① (le filtre actif) tel qu'une recette l'enregistre (spec carte-en-parcours § 16.2-5). Le code est
 * celui du filtre ; la France s'écrit `FR`. Aucun filtre : `null` — une recette lourde est alors refusée avant tout appel.
 */
export function perimetreDeFiltre(f: FiltreActif | null): PerimetreRecette | null {
  if (!f) return null;
  if (f.type === 'france') return { type: 'france', code: 'FR' };
  return { type: f.type, code: f.code };
}

/** Le message d'un échec HTTP des routes de zones : celui de la route s'il existe, sinon un message par statut. */
export function messageErreurZone(e: { status?: number; error?: unknown }): string {
  const m = (e.error as { error?: unknown } | null | undefined)?.error;
  if (typeof m === 'string' && m.length > 0) return m;
  if (e.status === 429) return 'Trop de calculs à la suite : patientez une minute.';
  if (e.status === 0) return 'Serveur injoignable : réessayez.';
  return 'Calcul de la zone impossible.';
}
