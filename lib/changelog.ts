/**
 * GEO.Prompt — Historique des versions
 * Ce fichier est séparé de version.ts pour ne pas alourdir le bundle.
 * Importer uniquement si l'UI changelog est affichée.
 */

export interface ChangelogEntry {
  version: string;
  date: string;
  type: 'major' | 'minor' | 'patch';
  changes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '7.0.0',
    date: '2026-03-16',
    type: 'major',
    changes: [
      'Refactoring profond : suppression code mort (~2892 lignes, 20 fichiers)',
      'Coverage dédupliquée : __total__ via ST_UnaryUnion PostGIS (plus de double-comptage CIRFA)',
      'CoverageResultsPanel : multi-select métriques + bouton Lancer les calculs',
      'FilterPanel : section Couverture Cumulée (remplace widget Inngest)',
      'Nettoyage dépendances : react-window, supercluster, @types/supercluster supprimés',
    ],
  },
  {
    version: '6.6.0',
    date: '2026-03-06',
    type: 'minor',
    changes: [
      'Refonte complète import Carreaux : parser SHP/DBF/PRJ 100% client-side (plus de Python)',
      'Wizard 3 étapes : Fichiers → Mapping → Import (avec reprojection proj4 browser EPSG:3035/2154/4326)',
      'Nouvelle route /api/admin/import-geo : INSERT batch via PostgreSQL direct (unnest, fully parameterized)',
      'Nouvelle route /api/admin/import-geo/register : enregistrement source dans data_sources',
      'Nouvelle route /api/admin/import-geo/rename-columns : renommage clés JSONB metadata',
      'Suppression 6 anciennes routes : carreaux-gen-schema, carreaux-infer-schema, import-carreaux, import-carreaux/execute, preview-carreaux, carreaux-debug',
      'API /api/carreaux refaite : connexion PostgreSQL directe, GET sources + POST GeoJSON bbox, normalisation lowercase metadata',
      'Sécurité : sql.unsafe() + escapeLiteral() remplacés par requêtes fully parameterized (unnest arrays + tagged template)',
      'Copilote : applyChoropleth() améliorée (valeurs 0 = transparent, expression MapLibre robuste)',
      'Copilote : loadCarreauxFromAI — fly+fetch en parallèle, applyChoropleth intégrée',
      'Copilote : useToolProcessor supporte afficher_carreaux (sauvegarde carreauxConfigForSaveRef)',
      'SQL : 005_upsert_carreaux_batch.sql — notify_pgrst_reload() helper',
    ],
  },
  {
    version: '6.5.1',
    date: '2026-03-03',
    type: 'patch',
    changes: [
      'Fix: "voronoï routier" ne déclenchait plus aucun outil — system prompt corrigé (isochrone_battle)',
      'Copilote: panel Prompts disponibles (bouton ?) — 6 catégories, 20 exemples cliquables',
      'PromptsPanel: accordéon par catégorie (Analyse zone, Isochrones, Carreaux, Voronoï, Voronoï Routier, OOH)',
    ],
  },
  {
    version: '6.5.0',
    date: '2026-03-03',
    type: 'minor',
    changes: [
      'Itération 5 — Rate Limiting & Robustesse',
      '/api/chat: rate limiter in-memory 12 req/min/IP (Map module-scope, format RATE_LIMIT:N)',
      'lib/isochrones/fetcher.ts: AbortController 12s par batch ORS, délai adaptatif (5s timeout / 20s rate limit)',
      'useRateLimitHandler: parse RATE_LIMIT:N → countdown exact (plus hardcodé à 15s)',
      'useToolProcessor: messages erreur améliorés Bataille + Voronoï (friendly strings)',
      'Copilote: outil analyser_panneaux — panneaux OOH sur la carte (table panneaux_affichage)',
    ],
  },
  {
    version: '6.4.1',
    date: '2026-03-03',
    type: 'patch',
    changes: [
      'Audit DB: suppression lib/spatial/engine.ts et app/api/spatial/route.ts (code mort, table saved_analysis inexistante)',
      'Tables obsolètes identifiées: __test_geom_check__, demographie (143MB), enrichissement_jobs, carreaux_insee',
    ],
  },
  {
    version: '6.4.0',
    date: '2026-03-03',
    type: 'minor',
    changes: [
      'Itération 4 — Découpage UI: copilote/page.tsx ~160 lignes (orchestration pure)',
      'Nouveaux hooks: useMapInit, useMapLayers, useChatControls, useRateLimitHandler, useToolProcessor, useSavedMaps',
      'Nouveaux composants: ChatPanel, MapPanel, ZoneCard, TypingDots, PromptsPanel',
      'Deps circulaires résolues via mutableRefs (applyIsochronesRef, applyVoronoiRef, loadCarreauxRef, setMessagesRef)',
    ],
  },
  {
    version: '6.3.0',
    date: '2026-03-03',
    type: 'minor',
    changes: [
      'Migration Vercel AI SDK v6: streamText + createMistral + Zod inputSchema',
      'Backend: convertToModelMessages (async), toUIMessageStreamResponse()',
      'Frontend: useChat + DefaultChatTransport + prepareSendMessagesRequest',
      'Frontend: sendMessage({ text }), status, UIMessage parts (role/tool/text)',
      'processedToolIds Set ref — évite double-traitement des tool results',
    ],
  },
  {
    version: '6.2.0',
    date: '2026-03-03',
    type: 'minor',
    changes: [
      'Itération 3 — Couche Service',
      'lib/geo/geometry.ts: circleGeoJSON, tupleToGeoJSON, bboxFromPoints',
      'lib/geo/locations.ts: resolveLocation, fetchPoisForLocation',
      'lib/isochrones/fetcher.ts: fetchIsochrones() partagé entre /api/chat et /api/voronoi-routier',
    ],
  },
  {
    version: '6.1.0',
    date: '2026-03-03',
    type: 'minor',
    changes: [
      'Itération 2 — Contrat de Types',
      'types/poi.ts: PoiRow, PoiCategory',
      'types/spatial.ts: ZoneData, IsochroneData, VoronoiData, CarreauxData, SavedMap',
      'types/api.ts: ApiError, PaginatedResponse',
    ],
  },
  {
    version: '6.0.0',
    date: '2026-03-02',
    type: 'major',
    changes: [
      'Itération 1 — Sécurité: requireAdmin() sur 18 routes admin, adminFetch(), createAdminClient() strict',
      'Nouveau repo: vincedosi/geo_promptV2-',
    ],
  },
  {
    version: '5.12.0',
    date: '2026-02-28',
    type: 'minor',
    changes: [
      'SQL v5.12: table france_borders — MultiPolygon 14 polygones, mainland 2805 pts, Corse 306 pts',
      'SQL v5.12: get_voronoi_by_category — clip via france_borders (vraies côtes + frontières)',
      'Frontend: voronoi-fill opacity 0.25 (normal) / 0.35 (hover)',
    ],
  },
  {
    version: '5.11.0',
    date: '2026-02-28',
    type: 'minor',
    changes: [
      'SQL v5.11: ST_SnapToGrid(0.0001) — stabilité numérique zones denses',
      'SQL v5.11: clip réel France métro via ST_Intersection',
      'Frontend: sauvegarde + restauration voronoi_data via saved_maps',
    ],
  },
  {
    version: '5.10.0',
    date: '2026-02-28',
    type: 'minor',
    changes: [
      'Feature: Moteur d\'analyse spatiale piloté par Mistral AI',
      'Feature: Voronoï par catégorie (PostGIS ST_VoronoiPolygons)',
      'Feature: Isochrone ponctuelle via ORS (walk/drive/bike)',
    ],
  },
  {
    version: '5.9.0',
    date: '2026-02-28',
    type: 'minor',
    changes: [
      'Copilote IA: isochrones OpenRouteService autour des POI',
      'Backend: fetchIsochrones() — batch 5 POIs/appel ORS, retry 20s sur 429',
      'Copilote: couche MapLibre isochrones-fill + isochrones-line',
    ],
  },
  {
    version: '5.8.0',
    date: '2026-02-27',
    type: 'minor',
    changes: [
      'ETL carreaux_import.py: support Shapefile, GeoPackage, KML, GPX',
      'ETL: auto-détection format, reprojection WGS84 via geopandas',
    ],
  },
  {
    version: '5.6.0',
    date: '2026-02-26',
    type: 'minor',
    changes: [
      'Carte /map : couche carreaux INSEE — polygones choroplèthe',
      'Copilote : bouton toggle Carreaux + choroplèthe auto',
      'API /api/carreaux : GET liste sources, POST retourne GeoJSON FeatureCollection',
    ],
  },
  {
    version: '5.3.0',
    date: '2026-02-26',
    type: 'minor',
    changes: [
      'Copilote IA : nouveau layout fullscreen Chat + Carte (split 2 panneaux)',
      'Copilote IA : function calling — outil generer_zone_et_panneaux',
    ],
  },
  {
    version: '5.0.0',
    date: '2026-02-24',
    type: 'major',
    changes: [
      'BREAKING: Inserter réécrit avec Supabase JS client (HTTPS port 443)',
      'Suppression connexion PostgreSQL directe',
      'Trigger auto_set_geom pour génération automatique du champ geom PostGIS',
    ],
  },
  {
    version: '4.0.0',
    date: '2026-02-23',
    type: 'major',
    changes: [
      'Back-office complet: Organizations, Sources, Auth',
      'Import Universel avec SSE progress (5 étapes)',
      'Health check API endpoint /api/admin/health',
    ],
  },
  {
    version: '3.0.0',
    date: '2026-02-20',
    type: 'major',
    changes: [
      'Import Universel 5 étapes (CSV/XLSX/GeoJSON)',
      'Géolocalisation BAN (géocodage adresse)',
      'Import Carreaux INSEE',
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
      'Base de données Supabase + PostGIS',
    ],
  },
];
