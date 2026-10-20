import type { NonMatcheeAudit } from '../data/radio-admin.api';
import {
  daysAgo, detailsImport, dureeEnrichissement, dureeImport, filtrerNonMatchees, fmtDate, libelleCategorie, libelleSlug,
  ligneJournalPasse, messageSuppression, partSource, resumeEnrichissement, slugRadio, teinteBarreCategorie,
  teinteDiagnostic, teinteFraicheur, teinteKpiMatchees, teintePctCategorie, teinteStatut, titreSuppression,
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

/**
 * Onglets Radios et Statistiques (T17) : expressions de `page.tsx:598-898` recopiées VERBATIM (elles
 * sont écrites en ligne dans le JSX, rien à importer).
 */
const reactT17 = {
  slug(nom: string) {
    return nom.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['']/g, '-').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  },
  dur(duration_s: number | null) {
    return duration_s ? (duration_s >= 60 ? `${Math.floor(duration_s / 60)}m${duration_s % 60}s` : `${duration_s}s`) : '—';
  },
  filtre(liste: NonMatcheeAudit[], auditCatFilter: string, auditFreqMin: number, auditSearch: string, auditDiagFilter: string) {
    return liste.filter(r => {
      if (auditCatFilter && r.cat !== auditCatFilter) return false;
      if (auditFreqMin && r.nb_freq_ods < auditFreqMin) return false;
      if (auditSearch && !r.nom.toLowerCase().includes(auditSearch.toLowerCase())) return false;
      if (auditDiagFilter === 'parent' && !r.diagnostic.startsWith('Parent')) return false;
      if (auditDiagFilter === 'declinaison' && !r.diagnostic.startsWith('Declinaison')) return false;
      if (auditDiagFilter === 'absente' && !r.diagnostic.startsWith('Absente')) return false;
      if (auditDiagFilter === 'aucune' && !r.diagnostic.startsWith('Aucune')) return false;
      return true;
    });
  },
};

const NM = (nom: string, cat: string, nb_freq_ods: number, diagnostic: string): NonMatcheeAudit =>
  ({ id: nom, nom, cat, portee: null, nb_freq_ods, parent_nom: null, diagnostic });

describe('logique des onglets Radios et Statistiques — copies de `radio/page.tsx` (lot 6, T17)', () => {
  it('slugRadio : le slug de frequence-radio.com de React (accents, apostrophes, ponctuation) ; libellé coupé à 20 caractères + « … »', () => {
    for (const nom of ['Europe 2 Nord Picardie', 'Radio Fréquence Plus', "RTL2 L'Alsace", 'Chérie FM – Côte d’Azur', '  NRJ  ', 'Ô Radio!']) {
      expect(slugRadio(nom)).toBe(reactT17.slug(nom));
    }
    expect(slugRadio("RTL2 L'Alsace")).toBe('rtl2-l-alsace');
    expect(libelleSlug('europe-2-nord-picardie')).toBe('europe-2-nord-picard…');
    expect(libelleSlug('nrj')).toBe('nrj');
  });

  it('dureeEnrichissement : `13m32s`, `45s`, `—` (y compris 0 et null, comme le test de vérité de React)', () => {
    for (const d of [812, 60, 59, 0, null]) expect(dureeEnrichissement(d)).toBe(reactT17.dur(d));
    expect(dureeEnrichissement(812)).toBe('13m32s');
  });

  it('filtrerNonMatchees : mêmes lignes que le filtre de React pour chaque combinaison', () => {
    const liste = [
      NM('Europe 2 Nord Picardie', 'C', 9, 'Parent detecte: Europe 2'),
      NM('Radio Locale', 'A', 2, 'Declinaison locale probable'),
      NM('Radio Absente', 'B', 5, 'Absente des sources'),
      NM('Muette', 'A', 0, 'Aucune freq FM'),
    ];
    for (const cat of ['', 'A', 'C']) for (const freq of [0, 3, 5]) for (const rech of ['', 'RADIO', 'pic']) {
      for (const diag of ['', 'parent', 'declinaison', 'absente', 'aucune']) {
        expect(filtrerNonMatchees(liste, { cat, freqMin: freq, recherche: rech, diag }))
          .toEqual(reactT17.filtre(liste, cat, freq, rech, diag));
      }
    }
  });

  it('libellés et teintes de React : catégories, KPI (> 80 / > 60), % par catégorie (≥ 90 / ≥ 70), diagnostic', () => {
    expect(['A', 'B', 'C', 'D', 'E', 'P', '?', 'Z'].map(libelleCategorie)).toEqual([
      'A (associative)', 'B (locale comm.)', 'C (franchise)', 'D (thematique)', 'E (generaliste)', 'P (public)', '?', 'Z',
    ]);
    expect([81, 80, 61, 60].map(teinteKpiMatchees)).toEqual(['succes', 'avert', 'avert', 'danger']);
    expect([90, 89.9, 70, 69.9].map(teintePctCategorie)).toEqual(['succes', 'secondaire', 'secondaire', 'danger']);
    expect([90, 89.9, 70, 69.9].map(teinteBarreCategorie)).toEqual(['succes', 'teal', 'teal', 'danger']);
    expect(['Parent detecte: X', 'Declinaison locale', 'Absente des sources', 'Aucune freq FM', 'Autre'].map(teinteDiagnostic))
      .toEqual(['teal', 'avert', 'danger', 'tertiaire', 'tertiaire']);
  });

  it('partSource : `((relations / (total || 1)) * 100).toFixed(1)` ; resumeEnrichissement : `P1: … · P2: …` en fr-FR, sinon le statut', () => {
    expect(partSource(293119, 569698)).toBe(((293119 / 569698) * 100).toFixed(1));
    expect(partSource(5, 0)).toBe('500.0');
    expect(resumeEnrichissement({ status: 'success', stats: { matched_pass1: 546019, matched_pass2: 23679 } }))
      .toBe(`P1: ${(546019).toLocaleString('fr-FR')} · P2: ${(23679).toLocaleString('fr-FR')}`);
    expect(resumeEnrichissement({ status: 'success', stats: {} })).toBe('P1: 0 · P2: 0');
    expect(resumeEnrichissement({ status: 'running', stats: {} })).toBe('running');
  });
});
