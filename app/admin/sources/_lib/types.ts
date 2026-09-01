/**
 * MAGELIAN — types du back-office Data Sources.
 *
 * Extraits de app/admin/sources/page.tsx (refactor du 31/08/2026). Ces
 * formes decrivent les payloads des routes d'administration IRIS et de
 * /api/admin/sources-stats ; elles ne sont pas generees depuis le schema.
 */

// ── IRIS ──────────────────────────────────────────────────────────────────────

export interface IrisStats {
  total: number; nb_depts: number; nb_communes: number;
  type_h: number; type_a: number; type_d: number; type_z: number;
  with_geom: number; table_size: string; index_size: string;
}

export interface IrisDept { code: string; nom: string; nb: number; }

export interface IrisSource {
  name: string; edition: string; provider: string; license: string;
  format: string; coverage: string; imported_at: string; schema: string[];
}

/** Rapport de /api/admin/sync-iris-system : coherence schema DB <-> code. */
export interface IrisSyncReport {
  synced:                boolean;
  total_iris:            number;
  db_columns:            string[];
  code_columns:          string[];
  missing_in_code:       string[];
  missing_in_db:         string[];
  fill_status:           Record<string, number>;
  rpc_status:            Record<string, string>;
  manual_actions_needed: string[];
}

// ── Stats consolidees par domaine ─────────────────────────────────────────────

/** Ligne POI telle que renvoyee par /api/admin/poi-samples. */
export interface PoiRow {
  id: string;
  nom: string | null;
  categorie: string;
  sous_categorie: string | null;
  lat: number;
  lng: number;
  adresse: string | null;
  ville: string | null;
  departement: string | null;
  code_postal: string | null;
  source: string | null;
}

/** Payload de /api/admin/transport-stats (arrets, flux routiers, scoring panneaux). */
export interface TransportStats {
  arrets:   { total: number; by_source: Record<string, number> };
  flux:     { total: number; by_source: Record<string, number> };
  panneaux: { total: number; avec_transport: number; avec_flux: number };
  villes:   Array<{ ville: string; nb_panneaux: number; avec_transport: number; transport_moyen: number; avec_flux: number; flux_moyen: number; score_moyen: number }>;
}

export interface SourcesStats {
  ooh: {
    total: number; nb_villes: number; regies: string[]; sources: string[];
    types: Array<{ type: string; nb: number }>;
    top_villes: Array<{ ville: string; nb: number }>;
  };
  poi: { total: number; by_category: Array<{ categorie: string; nb: number }> };
  transport: { total: number; bus: number; train: number; tram: number; metro: number };
  flux: { total: number; cerema: number; osm: number };
  carreaux: { total: number };
  iris: { total: number; enrichis: number };
}
