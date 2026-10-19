import type { AuditRadio, ImportRadio, StationRadio, StatsRadio } from '../data/radio-admin.api';

/** Dix jours avant aujourd'hui : un import ANFR « frais » (moins de 45 jours). */
export const DERNIERE_MAJ = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);

/** `GET /api/radio/stats` relevé le 2026-10-17 (`get_radio_stats`), date ANFR rapprochée pour rester « fraîche ». */
export const STATS_RADIO: StatsRadio = {
  total_emetteurs: 12704, emetteurs_fm: 11602, emetteurs_dab: 1102, total_radios: 1175, emetteurs_matches: 11836,
  emetteurs_orphelins: 868, pct_matching: 93.2, par_categorie: {}, par_portee: {}, par_genre: {},
  derniere_maj_anfr: DERNIERE_MAJ, archives_count: 11836, radios_matchees: 861,
};

/** Trois lignes de `radio_imports_log` (relevées le 2026-10-17), dont l'enrichissement resté `running`. */
export const HISTORIQUE_RADIO: ImportRadio[] = [
  {
    id: '7d507127-b88e-4dd0-82c5-1b7cd1d5799f', type: 'anfr', status: 'success', started_at: '2026-09-17T12:49:04.251009+00:00',
    completed_at: '2026-09-17T12:51:39.116+00:00', error_message: null, stats: { errors: 0, deleted: 74, updated: 926, inserted: 11138 },
  },
  {
    id: 'd41c7d3d-0731-453a-b0a3-035e0cf4d979', type: 'arcom', status: 'running', started_at: '2026-09-17T12:47:47.671852+00:00',
    completed_at: null, error_message: null, stats: {},
  },
  {
    id: '61b65323-cf86-42d7-84be-40c3c33ce8d3', type: 'arcom', status: 'error', started_at: '2026-04-03T08:07:39.783679+00:00',
    completed_at: '2026-04-03T08:18:38.196918+00:00', error_message: 'Killed manually - process stuck', stats: {},
  },
];

/** Une radio de `GET /api/radio/stations` (champs de `RadioRow`, `page.tsx:34-42`, et ceux que la route calcule). */
function station(id: string, nom: string, categorie_arcom: string | null, nb_emetteurs: number, nb_freq_fm: number, parent_nom: string | null): StationRadio {
  return {
    id, nom, categorie_arcom, portee: 'locale', genre: null, groupe_media: null, audience_data: {}, tarifs_data: {},
    created_at: '2026-04-03T08:00:00+00:00', nb_emetteurs, nb_freq_fm, parent_nom,
  };
}

/** Trois radios de la première page (`sort=freq_desc`), dont une sans émetteur et une sans catégorie. */
export const STATIONS_RADIO: StationRadio[] = [
  station('r1', 'NRJ', 'E', 412, 180, null),
  station('r2', 'Europe 2 Nord Picardie', 'C', 0, 9, 'Europe 2'),
  station('r3', "Radio Fréquence L'Alsace Plus Longue", null, 3, 0, null),
];

/** `GET /api/radio/audit` (`get_radio_audit`), relevé le 2026-10-19 en local, listes raccourcies. */
export const AUDIT_RADIO: AuditRadio = {
  kpis: { pct: 73.3, total: 1175, matchees: 861, relations: 569698, non_matchees: 314 },
  par_categorie: [
    { cat: '?', pct: 0, total: 1, matchees: 0, non_matchees: 1 },
    { cat: 'C', pct: 62.3, total: 236, matchees: 147, non_matchees: 89 },
    { cat: 'B', pct: 87.8, total: 189, matchees: 166, non_matchees: 23 },
    { cat: 'P', pct: 100, total: 53, matchees: 53, non_matchees: 0 },
  ],
  non_matchees: [
    { id: 'n1', nom: 'Europe 2 Nord Picardie', cat: 'C', portee: 'locale', nb_freq_ods: 9, parent_nom: 'Europe 2', diagnostic: 'Parent detecte: Europe 2' },
    { id: 'n2', nom: 'Radio Locale B', cat: 'B', portee: null, nb_freq_ods: 2, parent_nom: null, diagnostic: 'Declinaison locale probable' },
    { id: 'n3', nom: 'Radio Absente', cat: 'C', portee: 'regionale', nb_freq_ods: 5, parent_nom: null, diagnostic: 'Absente des sources' },
  ],
  sources: [
    { radios: 516, source: 'arcom', relations: 252900 },
    { radios: 27, source: 'fallback-national', relations: 23679 },
    { radios: 465, source: 'freq-radio', relations: 293119 },
  ],
  historique: [
    { id: 'h1', stats: {}, status: 'running', duration_s: null, started_at: '2026-09-17T12:47:47.671852+00:00', completed_at: null },
    {
      id: 'h2', status: 'success', duration_s: 812, started_at: '2026-04-04T07:34:35.555336+00:00', completed_at: '2026-04-04T07:48:07.795+00:00',
      stats: { matched_pass1: 546019, matched_pass2: 23679 },
    },
  ],
};
