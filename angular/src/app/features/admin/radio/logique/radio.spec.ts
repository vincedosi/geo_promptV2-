import {
  daysAgo, detailsImport, dureeImport, fmtDate, ligneJournalPasse, messageSuppression, teinteFraicheur, teinteStatut,
  titreSuppression,
} from './radio';

/**
 * Parité avec `app/admin/radio/page.tsx` : ses fonctions sont LOCALES à la page (rien à importer). Chaque
 * cas compare la copie à l'expression React recopiée VERBATIM ci-dessous.
 */
const react = {
  fmtDate(d: string | null) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  },
  ligne(e: { message: string; level: string; phase: string; timestamp: string }) {
    return `[${(e.timestamp ?? '').slice(11, 19)}] [${(e.level ?? 'info').toUpperCase().padEnd(7)}] [${(e.phase ?? '').padEnd(12)}] ${e.message}`;
  },
  message(deleteDryRun: Record<string, number> | null) {
    return deleteDryRun
      ? `${Object.entries(deleteDryRun).map(([k, v]) => `${v} ${k}`).join(', ')} seront supprimés. Cette action est irréversible.`
      : 'Chargement...';
  },
};

describe('logique de l’onglet Import radio — copies de `radio/page.tsx` (lot 6, T16)', () => {
  it('fmtDate : la sortie de React, `—` sans date', () => {
    for (const d of ['2026-09-17T12:49:04.251009+00:00', '2026-09-06', '2026-04-01T16:55:00.600696+00:00', null]) {
      expect(fmtDate(d)).toBe(react.fmtDate(d));
    }
    expect(fmtDate(null)).toBe('—');
  });

  it('daysAgo : jours pleins depuis la date, 999 sans date ; teinte < 45 succès, < 90 avertissement, sinon danger', () => {
    const maintenant = Date.parse('2026-10-17T10:00:00Z');
    expect(daysAgo('2026-09-06', maintenant)).toBe(41);
    expect(daysAgo(null, maintenant)).toBe(999);
    expect([44, 45, 89, 90, 999].map(teinteFraicheur)).toEqual(['succes', 'avert', 'avert', 'danger', 'danger']);
  });

  it('ligneJournalPasse : `[HH:MM:SS] [LEVEL  ] [PHASE       ] message` de `loadHistoryLogs`, heure UTC lue dans la chaîne', () => {
    const e = { timestamp: '2026-09-17T12:49:04.289814+00:00', level: 'info', phase: 'DOWNLOAD', message: 'Phase DOWNLOAD démarrée' };
    expect(ligneJournalPasse(e)).toBe(react.ligne(e));
    expect(ligneJournalPasse(e)).toBe('[12:49:04] [INFO   ] [DOWNLOAD    ] Phase DOWNLOAD démarrée');
    const longue = { timestamp: '2026-09-17T12:51:39.120505+00:00', level: 'success', phase: 'REFRESH_VIEW', message: 'ok' };
    expect(ligneJournalPasse(longue)).toBe(react.ligne(longue));
  });

  it('confirmation : titres et message de React, comptes BRUTS', () => {
    expect(titreSuppression('emetteurs')).toBe('Supprimer les émetteurs');
    expect(titreSuppression('all')).toBe('Supprimer toutes les données radio');
    const cas: (Record<string, number> | null)[] = [{ emetteurs: 12704 }, { emetteurs: 12704, radios: 1175, archive: 11836 }, {}, null];
    for (const c of cas) {
      expect(messageSuppression(c)).toBe(react.message(c));
    }
    expect(messageSuppression({ emetteurs: 12704 })).toBe('12704 emetteurs seront supprimés. Cette action est irréversible.');
  });

  it('historique : durée arrondie en secondes, détails (erreur à 60 caractères, bilan, `—`), teinte du statut', () => {
    expect(dureeImport({ started_at: '2026-09-17T12:49:04.251009+00:00', completed_at: '2026-09-17T12:51:39.116+00:00' })).toBe(155);
    expect(dureeImport({ started_at: '2026-09-17T12:47:47+00:00', completed_at: null })).toBeNull();
    expect(detailsImport({ error_message: 'x'.repeat(80), stats: null })).toEqual({ texte: 'x'.repeat(60), erreur: true });
    expect(detailsImport({ error_message: null, stats: { inserted: 11138, updated: 926 } })).toEqual({ texte: '11138 insérés, 926 màj', erreur: false });
    // Un `{}` (import en cours) est un objet : React écrit « 0 insérés, 0 màj ».
    expect(detailsImport({ error_message: null, stats: {} })).toEqual({ texte: '0 insérés, 0 màj', erreur: false });
    expect(detailsImport({ error_message: null, stats: null })).toEqual({ texte: '—', erreur: false });
    expect(['success', 'error', 'running'].map(teinteStatut)).toEqual(['succes', 'danger', 'avert']);
  });
});
