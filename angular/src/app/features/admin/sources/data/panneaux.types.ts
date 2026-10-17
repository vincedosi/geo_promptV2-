/**
 * Formes des réponses lues par les panneaux Transport, IRIS et POI de l'écran Sources (lot 6, T19),
 * reprises de `app/admin/sources/_lib/types.ts` (gel P5) et des routes `app/api/admin/{transport-stats,
 * iris/stats,iris/metadata,iris/delete,sync-iris-system,trigger-pmtiles,poi-samples,poi-manage}`.
 */

/** `GET /api/admin/transport-stats` (`TransportStats`, `_lib/types.ts:51-56`, plus `success` / `error`). */
export interface StatsTransport {
  success: boolean;
  error?: string;
  arrets: { total: number; by_source: Record<string, number> };
  flux: { total: number; by_source: Record<string, number> };
  panneaux: { total: number; avec_transport: number; avec_flux: number };
  villes: Array<{
    ville: string; nb_panneaux: number; avec_transport: number; transport_moyen: number;
    avec_flux: number; flux_moyen: number; score_moyen: number;
  }>;
}

/** `stats` de `GET /api/admin/iris/stats` (RPC `get_iris_admin_stats`, sql/131). */
export interface StatsIris {
  total: number; nb_depts: number; nb_communes: number;
  type_h: number; type_a: number; type_d: number; type_z: number;
  with_geom: number; table_size: string; index_size: string;
}

/** Un des 15 départements les plus fournis (nom ajouté par la route, référentiel statique). */
export interface DepartementIris { code: string; nom: string; nb: number; }

/** Fiche de la source IRIS, écrite EN DUR dans la route (`iris/stats/route.ts:72-81`). */
export interface SourceIris {
  name: string; edition: string; provider: string; license: string;
  format: string; coverage: string; imported_at: string; schema: string[];
}

export interface ReponseStatsIris {
  success: boolean;
  error?: string;
  stats?: StatsIris;
  top_depts?: DepartementIris[];
  source?: SourceIris;
}

/** `GET /api/admin/iris/metadata` : la table clé/valeur `iris_metadata` à plat (`{ annee: '2025' }`). */
export type MetadonneesIris = Record<string, string>;

/** `POST /api/admin/sync-iris-system` : comparaison des colonnes IRIS en base et d'`IRIS_DB_COLUMNS`. */
export interface RapportSynchroIris {
  synced: boolean;
  total_iris: number;
  db_columns: string[];
  code_columns: string[];
  missing_in_code: string[];
  missing_in_db: string[];
  fill_status: Record<string, number>;
  rpc_status: Record<string, string>;
  manual_actions_needed: string[];
}

/** `POST /api/admin/trigger-pmtiles` : succès, ou `error` (500 sans jeton GitHub). */
export interface ReponsePmtiles {
  success?: boolean;
  message?: string;
  workflow_url?: string;
  error?: string;
}

/** `DELETE /api/admin/iris/delete` : `deleted` = le nombre de lignes effacées (`count: 'exact'`). */
export interface ReponseSuppressionIris {
  success: boolean;
  deleted?: number | null;
  error?: string;
}

/** Une ligne de `GET /api/admin/poi-samples` (`PoiRow`, `_lib/types.ts:35-46`). */
export interface LignePoi {
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

export interface ReponseEchantillonsPoi {
  success?: boolean;
  error?: string;
  samples?: LignePoi[];
  total?: number;
  offset?: number;
  limit?: number;
}

/**
 * Le formulaire de la modale POI (`emptyPoiForm`, `usePoiAdmin.ts:19-22`) : tout en TEXTE, latitude et
 * longitude comprises (la route les convertit, `z.coerce.number()`). C'est CE corps, tel quel, que
 * React envoie (`JSON.stringify(poiModal.data)`) — `id` en tête en édition.
 */
export interface FormulairePoi {
  id?: string;
  nom: string;
  categorie: string;
  sous_categorie: string;
  lat: string;
  lng: string;
  adresse: string;
  ville: string;
  departement: string;
  code_postal: string;
  source: string;
}

/** Réponse de `POST` / `PUT` / `DELETE /api/admin/poi-manage`. */
export interface ReponseGestionPoi {
  success?: boolean;
  error?: string;
  poi?: LignePoi;
  deleted?: 'single' | 'bulk';
  count?: number | null;
}
