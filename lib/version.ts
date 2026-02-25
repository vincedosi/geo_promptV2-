/**
 * GEO.Prompt — Versioning central
 * ⚠️  REGLE DEV: Toute modification de code → incrémenter APP_VERSION
 * Format: MAJOR.MINOR.PATCH
 *   MAJOR = refonte majeure
 *   MINOR = nouvelle feature
 *   PATCH = bugfix / logs / petits ajustements
 */

export const APP_NAME = 'GEO.Prompt';
export const APP_VERSION = '5.0.0';
export const BUILD_DATE = '2026-02-24';

export interface ChangelogEntry {
  version: string;
  date: string;
  type: 'major' | 'minor' | 'patch';
  changes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '5.0.0',
    date: '2026-02-24',
    type: 'major',
    changes: [
      'BREAKING: Inserter reecrit avec Supabase JS client (HTTPS port 443)',
      'Suppression connexion PostgreSQL directe (postgres npm)',
      'Trigger auto_set_geom pour generation automatique du champ geom PostGIS',
      'Plus de SUPABASE_DB_URL — tout passe par le client Supabase',
      'Fix: firewall dentsu ne bloque plus les imports',
    ],
  },
  {
    version: '4.2.0',
    date: '2026-02-24',
    type: 'minor',
    changes: [
      'MEGA-LOGS: journal d\'erreur en direct dans l\'UI d\'import',
      'SSE type "log" — chaque INSERT streame OK/SKIP/ERR en temps reel',
      'Panneau logs live (scrollable, colore, compteurs)',
      'Test connexion DB avant insertion',
      'Fix: SUPABASE_DB_URL URL-encodage (@ et * dans password)',
    ],
  },
  {
    version: '4.1.0',
    date: '2026-02-24',
    type: 'minor',
    changes: [
      'Renommage projet GEO.Prompt (ex-GENESIS)',
      'Page Health Check /admin/health avec UI',
      'Logs verbose dans Import (schema check, per-row errors)',
      'Fix: erreur SQL affichee dans le rapport d\'import',
      'Fix: inserts individuels pour resilience (pas de transaction globale)',
      'Versioning dynamique en sidebar',
      'README.md avec regles dev',
    ],
  },
  {
    version: '4.0.0',
    date: '2026-02-23',
    type: 'major',
    changes: [
      'Back-office complet: Organizations, Sources, Auth',
      'Tracking data_source_id + organization_id sur toutes les tables',
      'Import Universel avec SSE progress (5 etapes)',
      'Health check API endpoint /api/admin/health',
      'SQL migration: organizations, profiles, data_sources tables',
    ],
  },
  {
    version: '3.0.0',
    date: '2026-02-20',
    type: 'major',
    changes: [
      'Import Universel 5 etapes (CSV/XLSX/GeoJSON)',
      'Geolocalisation BAN (geocodage adresse)',
      'Import Carreaux INSEE',
      'Dry-run avec validation et apercu carte',
    ],
  },
  {
    version: '2.0.0',
    date: '2026-02-15',
    type: 'major',
    changes: [
      'Carte interactive Mapbox/Leaflet',
      'Filtres POI + Panneaux',
      'Import panneaux affichage (JCDecaux, Clear Channel)',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-02-10',
    type: 'major',
    changes: [
      'Lancement initial',
      'Parse Prompt IA (Mistral)',
      'Base de donnees Supabase + PostGIS',
    ],
  },
];
