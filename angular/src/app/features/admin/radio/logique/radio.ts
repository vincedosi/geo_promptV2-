import { formaterNombre } from '../../../../core/format/nombre';
import type {
  AuditRadio, CibleSuppressionRadio, EntreeJournalRadio, ImportRadio, NonMatcheeAudit,
} from '../data/radio-admin.api';

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

// ── Onglets Radios et Statistiques (T17) — expressions écrites EN LIGNE dans le JSX de React ──────────

/** Slug de frequence-radio.com (`page.tsx:676` et `:820`, même expression aux deux endroits). */
export function slugRadio(nom: string): string {
  return nom.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/['']/g, '-').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Libellé du lien de l'onglet Radios (`page.tsx:683`) : 20 caractères, puis « … ». */
export function libelleSlug(slug: string): string {
  return `${slug.slice(0, 20)}${slug.length > 20 ? '…' : ''}`;
}

/** Libellés des catégories Arcom de l'audit (`catLabels`, `page.tsx:761`) ; une catégorie inconnue s'affiche telle quelle. */
const LIBELLES_CATEGORIE: Record<string, string> = {
  A: 'A (associative)', B: 'B (locale comm.)', C: 'C (franchise)', D: 'D (thematique)', E: 'E (generaliste)', P: 'P (public)', '?': '?',
};

export function libelleCategorie(cat: string): string {
  return LIBELLES_CATEGORIE[cat] ?? cat;
}

/** Filtres de la liste des non matchées (`auditCatFilter`, `auditDiagFilter`, `auditFreqMin`, `auditSearch`). */
export interface FiltresNonMatchees {
  cat: string;
  diag: string;
  freqMin: number;
  recherche: string;
}

/** Le filtre de `page.tsx:807-816`, dans le même ordre. */
export function filtrerNonMatchees(liste: readonly NonMatcheeAudit[], f: FiltresNonMatchees): NonMatcheeAudit[] {
  return liste.filter((r) => {
    if (f.cat && r.cat !== f.cat) return false;
    if (f.freqMin && r.nb_freq_ods < f.freqMin) return false;
    if (f.recherche && !r.nom.toLowerCase().includes(f.recherche.toLowerCase())) return false;
    if (f.diag === 'parent' && !r.diagnostic.startsWith('Parent')) return false;
    if (f.diag === 'declinaison' && !r.diagnostic.startsWith('Declinaison')) return false;
    if (f.diag === 'absente' && !r.diagnostic.startsWith('Absente')) return false;
    if (f.diag === 'aucune' && !r.diagnostic.startsWith('Aucune')) return false;
    return true;
  });
}

/** Teinte du KPI « Radios matchees » (`page.tsx:729`). */
export function teinteKpiMatchees(pct: number): 'succes' | 'avert' | 'danger' {
  return pct > 80 ? 'succes' : pct > 60 ? 'avert' : 'danger';
}

/** Teinte du `%` d'une catégorie (`page.tsx:770`). */
export function teintePctCategorie(pct: number): 'succes' | 'secondaire' | 'danger' {
  return pct >= 90 ? 'succes' : pct >= 70 ? 'secondaire' : 'danger';
}

/** Teinte de la barre d'une catégorie (`page.tsx:773`). */
export function teinteBarreCategorie(pct: number): 'succes' | 'teal' | 'danger' {
  return pct >= 90 ? 'succes' : pct >= 70 ? 'teal' : 'danger';
}

/** Teinte d'un diagnostic (`diagColor`, `page.tsx:821`). */
export function teinteDiagnostic(diagnostic: string): 'teal' | 'avert' | 'danger' | 'tertiaire' {
  return diagnostic.startsWith('Parent') ? 'teal' : diagnostic.startsWith('Declinaison') ? 'avert' : diagnostic.startsWith('Absente') ? 'danger' : 'tertiaire';
}

/** Part d'une source dans les relations (`page.tsx:854-855`). */
export function partSource(relations: number, totalRelations: number): string {
  const totalRel = totalRelations || 1;
  return ((relations / totalRel) * 100).toFixed(1);
}

/** Durée d'un enrichissement (`dur`, `page.tsx:875`) : `13m32s`, `45s`, `—` (0 compris). */
export function dureeEnrichissement(duration_s: number | null): string {
  return duration_s ? (duration_s >= 60 ? `${Math.floor(duration_s / 60)}m${duration_s % 60}s` : `${duration_s}s`) : '—';
}

/** Colonne de droite d'un enrichissement (`page.tsx:882-884`) : `P1: … · P2: …` en fr-FR si succès, sinon le statut. */
export function resumeEnrichissement(h: Pick<AuditRadio['historique'][number], 'status' | 'stats'>): string {
  const s = h.stats as Record<string, number> | null;
  return h.status === 'success' ? `P1: ${formaterNombre(s?.['matched_pass1'] ?? 0)} · P2: ${formaterNombre(s?.['matched_pass2'] ?? 0)}` : h.status;
}
