import type { CibleSuppressionRadio, EntreeJournalRadio, ImportRadio } from '../data/radio-admin.api';

/**
 * Logique pure de l'onglet Import de l'écran Radio, recopiée de `app/admin/radio/page.tsx` (gel P5 du
 * 2026-10-17) ; parité : `radio.spec.ts`, qui compare chaque fonction à l'expression React verbatim
 * (les fonctions de React sont locales à la page, rien à importer).
 */

/** `fmtDate` (`page.tsx:55-58`) : `17/09/26 14:49`, heure locale. */
export function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** `daysAgo` (`page.tsx:59-62`) : 999 sans date. */
export function daysAgo(d: string | null, maintenant = Date.now()): number {
  if (!d) return 999;
  return Math.floor((maintenant - new Date(d).getTime()) / 86400000);
}

/** Fraîcheur de l'import ANFR (`freshColor`, `page.tsx:342`) : moins de 45 jours, moins de 90, au-delà. */
export function teinteFraicheur(jours: number): 'succes' | 'avert' | 'danger' {
  return jours < 45 ? 'succes' : jours < 90 ? 'avert' : 'danger';
}

/**
 * Une entrée d'un journal passé, mise en forme comme `loadHistoryLogs` (`page.tsx:244-246`) :
 * `[HH:MM:SS] [LEVEL  ] [PHASE       ] message`, l'heure LUE dans la chaîne (UTC, `slice(11, 19)`).
 */
export function ligneJournalPasse(e: Pick<EntreeJournalRadio, 'timestamp' | 'level' | 'phase' | 'message'>): string {
  return `[${(e.timestamp ?? '').slice(11, 19)}] [${(e.level ?? 'info').toUpperCase().padEnd(7)}] [${(e.phase ?? '').padEnd(12)}] ${e.message}`;
}

/** Titre de la confirmation (`page.tsx:904`). */
export function titreSuppression(cible: CibleSuppressionRadio | null): string {
  return cible === 'all' ? 'Supprimer toutes les données radio' : 'Supprimer les émetteurs';
}

/** Message de la confirmation (`page.tsx:905-909`) : comptes BRUTS, clés de la route telles quelles. */
export function messageSuppression(comptes: Record<string, number> | null): string {
  return comptes
    ? `${Object.entries(comptes).map(([k, v]) => `${v} ${k}`).join(', ')} seront supprimés. Cette action est irréversible.`
    : 'Chargement...';
}

/** Durée d'un import en secondes (`page.tsx:537-539`), `null` s'il n'est pas terminé. */
export function dureeImport(imp: Pick<ImportRadio, 'started_at' | 'completed_at'>): number | null {
  return imp.completed_at && imp.started_at
    ? Math.round((new Date(imp.completed_at).getTime() - new Date(imp.started_at).getTime()) / 1000)
    : null;
}

/** Colonne « Détails » (`page.tsx:554-558`) : l'erreur (60 caractères), sinon le bilan, sinon `—`. */
export function detailsImport(imp: Pick<ImportRadio, 'stats' | 'error_message'>): { texte: string; erreur: boolean } {
  if (imp.error_message) return { texte: imp.error_message.slice(0, 60), erreur: true };
  if (imp.stats) {
    const s = imp.stats as Record<string, number>;
    return { texte: `${s['inserted'] ?? 0} insérés, ${s['updated'] ?? 0} màj`, erreur: false };
  }
  return { texte: '—', erreur: false };
}

/** Teinte du statut (`statusColor`, `page.tsx:540`). */
export function teinteStatut(statut: string): 'succes' | 'danger' | 'avert' {
  return statut === 'success' ? 'succes' : statut === 'error' ? 'danger' : 'avert';
}
