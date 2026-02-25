/**
 * GEO.Prompt — Versioning central
 * ⚠️  REGLE DEV: Toute modification de code → incrémenter APP_VERSION
 * Format: MAJOR.MINOR.PATCH
 *   MAJOR = refonte majeure
 *   MINOR = nouvelle feature
 *   PATCH = bugfix / logs / petits ajustements
 */

export const APP_NAME = 'GEO.Prompt';
export const APP_VERSION = '5.2.3';
export const BUILD_DATE = '2026-02-26';

export interface ChangelogEntry {
  version: string;
  date: string;
  type: 'major' | 'minor' | 'patch';
  changes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '5.2.3',
    date: '2026-02-26',
    type: 'patch',
    changes: [
      'Import carreaux: support GeoJSON (.geojson) dans le sélecteur de fichier',
      'Import carreaux: affichage du nom de table créée dans le rapport de résultat',
      'Import carreaux: suppression de SUPABASE_DB_URL (obsolète) de l\'env Python',
      'Import carreaux: parsing Table cible dans le rapport Python',
    ],
  },
  {
    version: '5.2.2',
    date: '2026-02-25',
    type: 'patch',
    changes: [
      'Fix: search-poi paginé par batches de 1000 (.range()) — contourne le plafond PostgREST 1000 lignes',
      'Fix: toutes les lignes de la base sont maintenant chargées (jusqu\'à 20 000)',
      'Map: limite portée à 20 000 POIs par chargement',
    ],
  },
  {
    version: '5.2.1',
    date: '2026-02-25',
    type: 'patch',
    changes: [
      'Fix critique: filtres IA effacés dès que les catégories changeaient (race condition React)',
      'Fix: pendingAIFilters ref — filtres stockés avant le fetch et appliqués après réception des données',
      'Fix: setActiveFilters({}) ignoré si un filtre IA est en attente',
    ],
  },
  {
    version: '5.2.0',
    date: '2026-02-25',
    type: 'minor',
    changes: [
      'IA: modèle mistral-small-latest + response_format JSON garanti',
      'IA: prompt revu — multi-villes, multi-régions, multi-départements',
      'IA: support des alias (IDF, PACA, ARA, HDF) et numéros de département',
      'IA: contexte des valeurs exactes disponibles transmis au modèle',
      'Filtres: logique OR multi-valeur (ville: ["Brest","Versailles"] = l\'un OU l\'autre)',
      'Filtres: tags supprimables dans la sidebar pour les filtres multi-valeur IA',
      'Export: bouton Excel dans la barre de statut — exporte les POIs affichés',
      'Export: inclut toutes les colonnes schema + colonnes metadata',
      'AISearchInput: affichage des catégories et filtres appliqués en badges',
      'AISearchInput: bouton reset pour revenir à la vue complète',
      'AISearchInput: robot pixel art redessiné avec useRef canvas',
    ],
  },
  {
    version: '5.1.1',
    date: '2026-02-25',
    type: 'patch',
    changes: [
      'Sources: éditeur filtres dynamique — colonnes schema + metadata keys réels',
      'Sources: boutons Tout cocher / Effacer dans l\'éditeur filtres',
      'Sources: compteur de filtres sélectionnés',
      'Sources: indicateur de chargement pour les clés metadata',
      'Sources: fermeture automatique de l\'éditeur après sauvegarde',
    ],
  },
  {
    version: '5.1.0',
    date: '2026-02-25',
    type: 'minor',
    changes: [
      'Import: Step 03b refait — tableau de toutes les colonnes du fichier',
      'Import: checkbox Importer par colonne (sélection metadata)',
      'Import: checkbox Filtre par colonne (filtre carte, désactivé si non importé)',
      'Import: colonnes schema/géoloc verrouillées (toujours importées)',
      'Import: boutons Tout importer / Tout exclure / Effacer filtres',
      'Import: config importedColumns transmise au validator + execute route',
      'Validator: respecte importedColumns — exclut les colonnes non sélectionnées du metadata',
    ],
  },
  {
    version: '5.0.4',
    date: '2026-02-25',
    type: 'patch',
    changes: [
      'Fix filtres /map: auto-découverte depuis poisRaw (plus de dépendance filter_fields)',
      'Filtres calculés directement depuis les données chargées (colonnes + metadata)',
      'Suppression de /api/admin/source-filters du flux map (resté pour admin)',
      'Affichage: région, département, sous-catégorie + champs metadata (2–50 valeurs)',
      'Bouton Effacer filtres + compteur filtres actifs',
      'Status bar: affiche taille échantillon filtré vs total',
      'Reset filtres automatique quand catégories changent',
    ],
  },
  {
    version: '5.0.3',
    date: '2026-02-25',
    type: 'patch',
    changes: [
      'Fix carte /map: remplacement source GeoJSON+layer par maplibregl.Marker',
      'Les markers DOM ne dependent pas du chargement du style MapLibre',
      'Résout le bug persistant: points POI invisibles malgré données valides',
      'Couleur marker par catégorie (lycee=indigo, college=bleu, etc.)',
      'Popup clic sur marker avec adresse/ville/département',
    ],
  },
  {
    version: '5.0.2',
    date: '2026-02-25',
    type: 'patch',
    changes: [
      'Fix carte /map: RASTER_STYLE inline sans tiles @2x',
      'Fix carte /map: isStyleLoaded() check + fallbacks setTimeout 500ms/2000ms',
      'Fix carte /map: suppression layer symbol (évite erreur glyphs)',
      'Ajout onCoordsInfo callback: diagnostic coordonnées valides dans status bar',
    ],
  },
  {
    version: '5.0.1',
    date: '2026-02-25',
    type: 'patch',
    changes: [
      'Fix carte /map: buildGeoJSON utilise Number() + null check strict (lat != null)',
      'Fix carte /map: log diagnostic si 0 POI avec coordonnees valides',
      'Fix filtres: comparaison case-insensitive dans poiMatchesFilter',
      'Fix filtres: labels affiches lisibles (LIBELLE_REGION → Libelle Region)',
      'Fix AI search: matching par valeur si le nom de champ ne matche pas directement',
      'Fix AI search: support partiel du nom de champ (region dans LIBELLE_REGION)',
    ],
  },
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
