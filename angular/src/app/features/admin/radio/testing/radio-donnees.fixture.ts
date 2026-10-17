import type { ImportRadio, StatsRadio } from '../data/radio-admin.api';

/** Dix jours avant aujourd'hui : un import ANFR « frais » (moins de 45 jours). */
export const DERNIERE_MAJ = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);

/** `GET /api/radio/stats` relevé le 2026-10-17 (`get_radio_stats`), date ANFR rapprochée pour rester « fraîche ». */
export const STATS_RADIO: StatsRadio = {
  total_emetteurs: 12704, emetteurs_fm: 11602, emetteurs_dab: 1102, total_radios: 1175, emetteurs_matches: 11836,
  emetteurs_orphelins: 868, pct_matching: 93.2, par_categorie: {}, par_portee: {}, par_genre: {},
  derniere_maj_anfr: DERNIERE_MAJ, archives_count: 11836,
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
