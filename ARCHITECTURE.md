# ARCHITECTURE — MAGELIAN

> Derniere mise a jour : 2026-07-02 (consolidation panneaux : global_ooh fusionnee dans panneaux_affichage, page /integration-panneaux supprimee)
> Version : 7.7.x
> Auteur initial : Vince Dosi

---

## Stack technique

| Couche | Technologie | Version |
|--------|-------------|---------|
| Framework web | Next.js (App Router) | ^14.2 |
| Runtime UI | React | ^19.0 |
| Langage | TypeScript (strict) | ^5.3 |
| Base de donnees | Supabase (PostgreSQL 15 + PostGIS) | ^2.97 |
| Cartographie | MapLibre GL JS | ^5.18 |
| Tuiles vectorielles | PMTiles (IRIS via GitHub Releases) | 4.4.0 |
| LLM / Copilote | Vercel AI SDK + Gemini 2.5 Flash / Mistral Small | ai ^6.0 |
| Fonds de carte | OpenFreeMap (Liberty / Positron / Bright) + MAGELIAN dark style | — |
| Isochrones | OpenRouteService (ORS) REST API | — |
| Meteo | Open-Meteo API (temperature, precipitation, ensoleillement) | — |
| Jobs asynchrones | Inngest (serverless queue) | ^3.52 |
| Rate limiting | Upstash Redis | ^2.0 |
| PDF export | @react-pdf/renderer | ^4.3 |
| Graphiques | Recharts | ^3.8 |
| Styles | Tailwind CSS + Design System MAGELIAN (dark minimal) | ^3.4 |
| Fonts | Inter (UI) + JetBrains Mono (donnees/code) | — |
| Validation | Zod | ^3.22 |
| Tests | Vitest | ^2.0 |
| CI/CD | Vercel (deploiement automatique sur push `main`) | — |

---

## Arborescence

```
genesis_app/
├── app/                        # Next.js App Router — pages et routes API
│   ├── api/                    # Routes API (voir section dediee)
│   ├── admin/                  # Pages d'administration back-office
│   │   ├── campaigns/          # Campagnes DSP — liste, import, detail
│   │   ├── carreaux-import/    # Import des carreaux Filosofi (SHP/Parquet)
│   │   ├── health/             # Monitoring : etat DB, tables, fonctions RPC
│   │   ├── import/             # Import universel de POI (CSV/XLSX/GeoJSON)
│   │   ├── imports/            # Historique et gestion des imports
│   │   ├── ooh-import/         # Import panneaux OOH depuis ArcGIS REST
│   │   ├── organizations/      # CRUD organisations (clients)
│   │   ├── profiles/           # Gestion des profils utilisateurs
│   │   ├── radio/              # Admin emetteurs radio FM/DAB+
│   │   ├── sources/            # Gestion des sources de donnees
│   │   └── users/              # Gestion utilisateurs multi-tenant
│   ├── clusters/               # Pages analyse clustering POI x Filosofi
│   ├── copilote/               # Interface principale : chat IA + carte MapLibre
│   │   ├── _components/        # ChatPanel, MapPanel, PromptsPanel, ZoneCard...
│   │   ├── _hooks/             # useMapInit, useMapLayers, useChatControls...
│   │   └── _lib/               # constants.ts (circleGeoJSON, getCatColor)
│   ├── dashboard/              # Page d'accueil apres login
│   │   └── iris-crawler/       # Interface crawler INSEE IRIS
│   ├── login/                  # Page de connexion Supabase Auth
│   ├── map/                    # Page carte complete
│   │   ├── _components/        # FilterPanel, IrisDetailPanel, ClusteringWizard,
│   │   │                       # CorrelationPanel, ScoringPanel, StudyDashboard
│   │   └── analyse/digital/    # Analyse campagnes digitales
│   │       ├── _components/    # AnalysisPanel, SyncMap, BiddingCopilot,
│   │       │                   # MeteoGeoPanel, MediaHeatmap, KpiSummary...
│   │       └── _lib/           # use-digital-data.ts
│   └── layout.tsx              # Layout racine (AppSidebar, fonts)
│
├── components/                 # Composants React partages
│   ├── AppSidebar.tsx          # Sidebar navigation MAGELIAN
│   ├── CarreauxPMTilesLayer    # Couche PMTiles carreaux INSEE
│   ├── ClusterDetails          # Detail cluster + analyse
│   ├── ClusterRadar            # Graphique radar profil cluster
│   ├── ClusteringPDFReport     # Export PDF rapport clustering
│   ├── ClusterResultsOverlay   # Overlay resultats clustering
│   ├── CoverageResultsPanel    # Panel resultats couverture Filosofi
│   ├── SessionBadge            # Badge session utilisateur
│   └── ui/                     # Composants UI MAGELIAN
│       ├── GeoBot.tsx          # Mascotte/assistant visuel
│       ├── GeoSkeleton.tsx     # Skeleton loading
│       ├── SplashScreen.tsx    # Ecran de chargement initial
│       ├── PageTransition.tsx  # Transition entre pages
│       ├── confirm-modal.tsx   # Modal de confirmation
│       └── geo-toast.tsx       # Notifications toast
│
├── lib/                        # Logique metier et services partages
│   ├── auth.ts                 # createAdminClient(), getUserFromRequest()
│   ├── auth-client.ts          # Helpers auth cote client
│   ├── admin-fetch.ts          # adminFetch() — wrapper fetch avec token admin
│   ├── version.ts              # APP_VERSION
│   ├── api/                    # Middleware API (requireAdmin, requireAuth)
│   ├── auth/                   # getSessionOrg, getOrgSourceIds
│   ├── campaigns/              # column-mappings.ts, parser.ts
│   ├── chat/                   # Copilote IA
│   │   ├── providers.ts        # createModel() — Gemini / Mistral
│   │   ├── system-prompt.ts    # Prompt systeme dynamique
│   │   ├── trim-history.ts     # Compression historique chat
│   │   └── tools/              # Outils function calling (1 fichier = 1 outil)
│   ├── clustering/             # feature-themes.ts
│   ├── db/                     # Migrations SQL applicatives
│   ├── digital/                # google-ads-geo-ids.json
│   ├── geo/                    # france-admin.ts, locations.ts
│   ├── import/                 # Pipeline d'import universel
│   ├── inngest/                # Jobs async (couverture, colonnes derivees)
│   ├── iris-crawler/           # Crawler INSEE IRIS
│   ├── isochrones/             # fetcher.ts — ORS batch 5 POIs/appel
│   ├── map/                    # magelian-style.ts
│   ├── mcp/                    # datagouv.ts — MCP data.gouv.fr
│   ├── meteo/                  # aggregation.ts, palettes.ts, types.ts
│   ├── poi/                    # categories.ts
│   ├── radio/                  # anfr-import, arcom-crawler, arcom-ods-parser...
│   └── smart-prompt/           # Orchestrateur multi-agents Mistral
│
├── types/                      # Interfaces TypeScript partagees
│   ├── poi.ts                  # POI, PoiRow
│   ├── campaign.ts             # DspCampaign, DspCampaignData
│   ├── spatial.ts              # ZoneData, IsochroneData, BattleData...
│   └── admin.ts                # Organization, DataSource...
│
├── scripts/                    # Scripts CLI standalone (Python/TS)
│   ├── clustering_poi_filosofi.py  # K-means POI x Filosofi
│   ├── import_gtfs_stops.py        # Import arrets transport
│   ├── import_iris_insee.py         # Import IRIS INSEE
│   ├── import_iris_local.py         # Import IRIS local
│   ├── import_filosofi_iris.py      # Import Filosofi IRIS
│   ├── import_osm_roads.py          # Import routes OSM
│   ├── import_tmja.py               # Import TMJA
│   ├── rescore_all_villes.py        # Rescore villes
│   ├── populate_carreaux_1km.ts     # Post-import carreaux
│   ├── populate_geom_3857.ts        # Reprojection geom
│   └── export_iris_geojson.py       # Export GeoJSON IRIS
│
├── sql/                        # Migrations SQL (Supabase Dashboard)
├── supabase/migrations/        # Migrations Supabase CLI
├── tests/                      # unit/ + integration/
├── docs/                       # Documentation
└── public/                     # Assets statiques
```

---

## Modele multi-tenant

### Hierarchie

```
Organization (client)
  └── Members (profiles avec organization_id)
       └── role: super_admin | admin | client
```

### Tables cles

- `profiles` — role + organization_id
- `organizations` — clients
- `organization_members` — liaison N:N users/orgs
- `campaign_organizations` — liaison N:N campaigns/orgs

### Fonctions SQL

- `get_user_org(user_id)` — org principale d'un user
- `get_user_role(user_id)` — role effectif
- `get_user_orgs(user_id)` — toutes les orgs d'un user

### RLS

Les policies filtrent par `organization_id` via `get_user_org(auth.uid())` sur :
`dsp_campaigns`, `dsp_campaign_data`, `data_sources`, `panneaux_affichage`,
`poi_france`, `saved_maps`, `scoring_profiles`, `profiles`, `organizations`,
`organization_members`, `campaign_organizations`

---

## Routes API

### Chat & Copilote IA
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/chat` | POST | Copilote — streaming LLM + function calling |
| `/api/smart-prompt` | POST | Multi-agents Mistral (orchestrateur + agents specialises) |
| `/api/providers/status` | GET | Disponibilite providers IA |
| `/api/analysis` | POST | Analyse complete zone |

### Donnees cartographiques
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/map/pois` | GET | POI dans une zone avec filtres categorie |
| `/api/map/categories` | GET | Categories POI distinctes |
| `/api/map/ooh` | POST | Panneaux OOH dans bbox |
| `/api/map/transport` | GET | Donnees transport |
| `/api/map/tmja` | GET | Trafic moyen journalier |
| `/api/map/poi-natures` | GET | Natures de POI |
| `/api/carreaux` | GET/POST | Carreaux Filosofi dans bbox |
| `/api/tiles/[z]/[x]/[y]` | GET | Tuiles MVT carreaux (gzip obligatoire) |
| `/api/iris-tiles/[z]/[x]/[y]` | GET | Tuiles MVT zones IRIS |
| `/api/iris-tiles-proxy` | GET | Proxy CORS pour PMTiles IRIS (GitHub Releases) |

### IRIS
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/iris/stats` | GET | Stats IRIS par colonne et niveau |
| `/api/iris/detail` | GET | Detail IRIS complet (toutes colonnes socio-demo + nom_commune) |

### Indicateurs civiques
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/civic-indicators/health/[code_insee]` | GET | Indice ATMO + pollen pour une commune (cache 24h, fallback stale 48h, ODbL Atmo France) |

### Correlation IRIS
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/correlation/categories` | GET | Categories disponibles pour correlation |
| `/api/correlation/metrics` | GET | Metriques IRIS disponibles |
| `/api/correlation/compute` | POST | Calcul correlation POI x IRIS |
| `/api/correlation/analyse` | POST | Analyse textuelle de correlation |

### Import IRIS (protegees par `requireAdmin()`)
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/iris-crawler/import-history` | GET | Historique imports IRIS |
| `/api/iris-crawler/manual-upload` | POST | Upload manuel CSV (parse + auto-map) |
| `/api/iris-crawler/manual-import` | POST | Import manuel vers table `iris` (NDJSON streaming) |
| `/api/iris-import/insee` | POST | Import INSEE one-shot (download + parse + ecrit, NDJSON) |

> Le pipeline crawler 3-temps (`discover`/`download`/`upload` + `preview`/`status`/`delete`)
> a ete supprime en 2026-07 : staging disque local incompatible serverless,
> supplante par les deux chemins ci-dessus. Voir `docs/AUDIT_IMPORTS.md`.

### Isochrones & Bataille
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/isochrone-battle` | POST | NE PAS MODIFIER — isochrones multi-POI streaming |
| `/api/isochrone-battle-v2` | POST | Version active isochrone battle |
| `/api/isochrone-battle/apply-battle` | POST | Decoupe territoires sans chevauchement |
| `/api/isochrone-cache-check` | GET/POST | Verifie cache isochrone par POI |

### Couverture Filosofi
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/coverage-stats` | POST | Couverture demographique (streaming NDJSON) |
| `/api/coverage-breakdown` | POST | Detail par tranche d'age |
| `/api/coverage-jobs` | POST | Lance job Inngest |

### Scoring OOH
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/scoring` | GET/POST | Scoring OOH par ville |
| `/api/scoring/dashboard` | GET | Dashboard scoring ville |
| `/api/scoring/isochrones` | GET | Isochrones scoring |
| `/api/scoring/profiles` | GET/POST | CRUD profils scoring |
| `/api/scoring/profiles/[id]` | PUT/DELETE | Modification/suppression profil |

### Clustering POI
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/poi-clusters` | GET | Clusters par modele |
| `/api/poi-clusters/run` | POST | Lance calcul clustering |
| `/api/poi-clusters/count` | GET | Compte POI par cluster |
| `/api/poi-clusters/model` | GET | Modele actif |
| `/api/poi-clusters/models` | GET | Historique modeles |
| `/api/poi-clusters/models/[version]` | GET/DELETE | Detail/suppression modele |
| `/api/poi-clusters/models/[version]/analysis` | GET/DELETE | Analyse IA du modele |
| `/api/poi-clusters/models/[version]/generate-analysis` | POST | Generation analyse IA |
| `/api/poi-clusters/poi/[poiId]` | GET | Cluster d'un POI |
| `/api/poi-clusters/poi-types` | GET | Types de POI par cluster |
| `/api/poi-clusters/france-averages` | GET | Moyennes nationales |
| `/api/poi-clusters/history/[poiId]` | GET | Historique cluster POI |

### Digital / Campagnes DSP (protegees par `requireAuth()`)
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/digital/campaigns` | GET | Liste campagnes avec stats (RPC) |
| `/api/digital/codes-postaux` | GET | GeoJSON codes postaux dans bbox |
| `/api/digital/[campaignId]/analysis` | GET | Breakdown/medias/indicators/heatmap |
| `/api/digital/[campaignId]/map` | GET | Choroplethe CP campagne (GeoJSON) |
| `/api/digital/[campaignId]/media` | GET | Regies distinctes campagne |
| `/api/digital/[campaignId]/cp-detail` | GET | IRIS dans un code postal |
| `/api/digital/[campaignId]/ai-analysis` | POST | Analyse Gemini performances geo |
| `/api/digital/[campaignId]/bidding-chat` | POST | Chat bidding Gemini multi-turn |
| `/api/digital/[campaignId]/geography/[setId]` | GET | Croisement campagne x jeu de zones |

### Radio FM/DAB+ (protegees par `requireAuth()`)
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/radio/stations` | GET | Liste radios + nb emetteurs (pagine) |
| `/api/radio/stations/[id]` | PUT | Modification station |
| `/api/radio/emetteurs` | GET | GeoJSON emetteurs (RPC PostGIS) |
| `/api/radio/emetteurs/[staAnfr]` | GET | Detail emetteur + radios associees |
| `/api/radio/filter-options` | GET | Options filtres (categories, groupes) |
| `/api/radio/stats` | GET | Stats radios |
| `/api/radio/audit` | GET | Audit matching radio |
| `/api/radio/data` | GET | Donnees radio |
| `/api/radio/import-anfr` | POST | Import ANFR (requireAdmin) |
| `/api/radio/import-arcom-ods` | POST | Import Arcom ODS (requireAdmin) |
| `/api/radio/crawl-arcom` | POST | Crawl + matching Arcom (requireAdmin) |
| `/api/radio/imports-history` | GET | Historique imports |
| `/api/radio/import-logs/[logId]` | GET | Logs import |

### Meteo
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/meteo-geo` | GET | Meteo Open-Meteo agregee par zones admin (NDJSON streaming, echantillonnage spatial ≤500 points/appel, bbox viewport optionnelle en mode cp) |
| `/api/meteo-geo/zones` | GET | Polygones simplifies des zones admin (choroplethe meteo, cache CDN 1 sem.) |

### Administration campagnes (protegees par `requireAdmin()`)
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/admin/campaigns` | GET | Liste campagnes avec stats agregees |
| `/api/admin/campaigns/preview` | POST | Preview mapping fichier AVANT import |
| `/api/admin/campaigns/import` | POST | Import SSE streaming |
| `/api/admin/campaigns/populate-postal` | POST | Peuple ref La Poste |
| `/api/admin/campaigns/[id]` | GET/DELETE/PATCH | Detail/suppression/modification campagne |
| `/api/admin/campaigns/[id]/match-iris` | POST | Relance matching IRIS |
| `/api/admin/campaigns/[id]/organizations` | GET/POST | Gestion orgs campagne |
| `/api/admin/campaigns/[id]/organizations/[orgId]` | DELETE | Retrait org campagne |

### DSP API (connexions) (protegees par `requireAdmin()`)
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/admin/dsp/connections` | GET | Liste connexions DSP par org |
| `/api/admin/dsp/dv360/connect` | POST/DELETE | Enregistrement/suppression credentials DV360 (Service Account ou OAuth) |
| `/api/admin/dsp/dv360/test` | POST | Test connexion DV360 (list_advertisers) |
| `/api/admin/dsp/dv360/config` | GET | Diagnostic config serveur DV360 (presence env vars en booleens, jamais de secret + redirect URI en clair) |
| `/api/admin/dsp/dv360/oauth/config` | POST | Enregistre le client OAuth (Client ID + Secret chiffre) par org — saisie formulaire, prime sur les env vars |
| `/api/admin/dsp/dv360/oauth/start` | POST | Initiation flux OAuth DV360 (persiste partner_id, renvoie l'URL de consentement Google en JSON, `state` signe HMAC) |
| `/api/admin/dsp/dv360/oauth/callback` | GET | Callback OAuth DV360 (verif `state` HMAC anti-CSRF, echange code → tokens) |
| `/api/admin/dsp/dv360/targeting/push` | POST | Push ciblage geo d'une zone custom (CP → geo IDs Google) sur un line item DV360 (additif, max 2000 geo IDs, log dans dsp_api_logs) |
| `/api/admin/dsp/dv360/zones/push` | POST | Cree une location list DV360 regionale nommee comme la zone custom (CP → geo IDs, lots de 500, max 10 000) — bouton « Creer la zone dans DV360 » du ZoneDetailPanel |
| `/api/admin/dsp/tiktok/connect` | POST/DELETE | Enregistrement app TikTok (App ID + Secret chiffre) / deconnexion (?scope=full : purge) |
| `/api/admin/dsp/tiktok/config` | GET | Diagnostic config serveur TikTok (env vars en booleens + redirect URI en clair) |
| `/api/admin/dsp/tiktok/oauth/start` | POST | Initiation flux OAuth TikTok (renvoie l'URL portal/auth en JSON, state signe HMAC) |
| `/api/admin/dsp/tiktok/oauth/callback` | GET | Callback OAuth TikTok (verif state HMAC, echange auth_code → access token longue duree chiffre) |
| `/api/admin/dsp/tiktok/test` | POST | Test connexion TikTok (oauth2/advertiser/get) |
| `/api/admin/dsp/logs` | GET | Logs appels DSP par org (pagines) |

### Administration generale (protegees par `requireAdmin()`)
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/admin/import-poi/parse` | POST | Parse + auto-detection colonnes |
| `/api/admin/import-poi/dry-run` | POST | Preview import (10 lignes) |
| `/api/admin/import-poi/execute` | POST | Import batch SSE streaming |
| `/api/admin/import-ooh/arcgis` | POST/DELETE | Import OOH ArcGIS REST |
| `/api/admin/import-datagouv` | POST | Import data.gouv.fr (SSRF whitelist) |
| `/api/admin/import-geo/*` | POST | Import Shapefile |
| `/api/admin/geocode/batch` | POST | Geocode batch BAN |
| `/api/admin/geocode/update` | POST | Mise a jour geocodage |
| `/api/admin/health` | GET | Monitoring DB |
| `/api/admin/organizations` | GET/POST | CRUD organisations |
| `/api/admin/organizations/[id]/members` | GET/POST/DELETE | Gestion membres |
| `/api/admin/organizations/[id]/members/reset-password` | POST | Reset password membre |
| `/api/admin/organizations/[id]/sources/assign` | POST/DELETE | Assignation sources |
| `/api/admin/sources` | GET/POST | CRUD sources |
| `/api/admin/sources/[id]` | GET/PATCH/DELETE | Detail/modification/suppression source |
| `/api/admin/sources/[id]/export` | GET | Export CSV source |
| `/api/admin/sources/[id]/summary` | POST | Resume IA source |
| `/api/admin/sources/[id]/meta-keys` | GET | Cles metadata source |
| `/api/admin/sources-stats` | GET | Stats sources |
| `/api/admin/iris/stats` | GET | Stats admin IRIS |
| `/api/admin/iris/delete` | DELETE | Suppression donnees IRIS |
| `/api/admin/iris/metadata` | GET/POST | Metadata IRIS |
| `/api/admin/poi-categories` | GET/POST | CRUD categories POI |
| `/api/admin/poi-manage` | GET/POST/DELETE | Gestion POI |
| `/api/admin/poi-samples` | GET | Echantillons POI |
| `/api/admin/refresh-ville-stats` | POST | Refresh stats villes |
| `/api/admin/sync-iris-system` | POST | Sync systeme IRIS |
| `/api/admin/trigger-pmtiles` | POST | Declenchement generation PMTiles |
| `/api/admin/transport-stats` | GET | Stats transport |
| `/api/admin/users` | GET/POST | CRUD utilisateurs |
| `/api/admin/users/[id]` | DELETE | Suppression utilisateur |
| `/api/admin/imports` | GET | Historique imports |
| `/api/admin/init-admin` | POST | Init premier admin (protege par ADMIN_INIT_KEY) |

### Multi-tenant utilisateur
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/user/organizations` | GET | Orgs de l'utilisateur courant |
| `/api/user/switch-org` | POST | Changement d'org active |

> La page `/integration-panneaux` et ses routes `/api/integration-panneaux/*`
> ont ete supprimees en 2026-07 (pipeline CSV incomplet, perte de colonnes —
> voir `docs/AUDIT_IMPORTS.md` C4). Les panneaux s'importent via
> `/admin/ooh-import` (ArcGIS REST → `panneaux_affichage`).

### Export & Sauvegarde
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/export/ooh-report` | POST | Rapport OOH Excel (XLSX) |
| `/api/saved-maps` | GET/POST/DELETE | Sauvegarde/charge etat carte |
| `/api/saved-maps/[id]` | GET/PUT/DELETE | Acces/modification/suppression |
| `/api/inngest` | POST | Webhook Inngest |

---

## Tables Supabase

### Auth & Multi-tenant
| Table | Description | Notes |
|-------|-------------|-------|
| `profiles` | Profils utilisateurs | role: super_admin/admin/client, organization_id |
| `organizations` | Clients/organisations | name, slug |
| `organization_members` | Liaison N:N users/orgs | user_id, organization_id, role |

### Campagnes DSP
| Table | Description | Notes |
|-------|-------------|-------|
| `dsp_campaigns` | Campagnes DSP (Adform, DV360...) | nom, source, dates, pays, tracked_ads |
| `dsp_campaign_data` | Lignes d'impressions DSP | UNIQUE(campaign_id, date, postal_code, city) |
| `campaign_organizations` | Liaison N:N campaigns/orgs | campaign_id, organization_id |
| `postal_code_commune` | Referentiel La Poste | ~35k lignes, code postal -> commune |
| `dsp_connections` | Credentials DSP par organisation | RLS par org, secrets chiffres AES-256-GCM, provider + method, client OAuth optionnel par org (`oauth_client_id` + `oauth_client_secret_encrypted`, fallback env) |
| `dsp_api_logs` | Logs appels/connexion/jobs DSP | RLS par org, action + status + latency + error |

### Geographie & INSEE
| Table | Description | Notes |
|-------|-------------|-------|
| `iris` | Zones IRIS INSEE (~51k) | Colonnes socio-demo **dynamiques**, `is_true_iris` |
| `iris_import_history` | Historique imports IRIS | |
| `iris_indicator_registry` | Registre indicateurs IRIS | 51 indicateurs |
| `iris_metadata` | Metadonnees IRIS | |
| `carreaux_filosofi` | Carreaux INSEE 200m (2.3M lignes, 4.5 GB) | `geom_3857` pre-calcule |
| `carreaux_2km` | Agregation 2km (~75k, zoom 8-13) | Colonnes directes, <100ms |
| `carreaux_5km` | Agregation 5km (~17k, zoom 7) | Colonnes directes, <100ms |
| `france_borders` | Contours France metro | Clip isochrones/Voronoi |
| `france_boundary` | Boundary simplifie | |
| `comptages_routiers` | Comptages routiers (~408k lignes) | |

### POI & Panneaux
| Table | Description | Notes |
|-------|-------------|-------|
| `poi` / `poi_france` (vue) | Points d'Interet | Trigger `auto_set_geom` |
| `panneaux_affichage` | Panneaux OOH/DOOH toutes regies (~1 434 lignes) — table unique (carte + copilote + scoring) | `source_ref` = OBJECTID, UNIQUE (source, source_ref), filtrer `actif = true` |
| `import_runs_ooh` | Historique imports OOH | |
| `poi_categories` | Categories POI | |
| `poi_accessibility_config` | Parametres sigma accessibilite | |
| `data_sources` | Sources de donnees importees | |

### Radio FM/DAB+
| Table | Description | Notes |
|-------|-------------|-------|
| `emetteur_radio` | Emetteurs radio (ANFR) | position geo, puissance, systeme |
| `radio_stations` | Stations radio | nom, categorie Arcom, portee |
| `emetteur_radio_stations` | Liaison N:N emetteurs/stations | many-to-many |
| `radio_imports_log` | Historique imports radio | |

### Scoring & Clustering
| Table | Description | Notes |
|-------|-------------|-------|
| `scoring_profiles` | Profils JSON scoring OOH parametrique | |
| `isochrones_cache` | Cache isochrones ORS | Cle : poi_id + mode + minutes |
| `clustering_jobs` | Jobs de clustering K-means | |
| `clustering_models` | Modeles de clustering | |
| `poi_clusters` | Resultats POI -> cluster_id | |
| `poi_cluster_history` | Historique assignations cluster | |

### Support
| Table | Description | Notes |
|-------|-------------|-------|
| `saved_maps` | Etats carte sauvegardes (user_id) | |
| `data_registry` | Registre donnees pour routeur multi-agents | |
| `calculation_jobs` | Jobs de calcul couverture | |
| `filosofi_national_averages` | Moyennes nationales Filosofi | |
| `smart_prompt_feedback` | Feedback prompts IA (user_id) | |
| `smart_ville_stats` | Stats villes | |
| `civic_health_cache` | Cache indicateurs ATMO + pollen par code INSEE commune | TTL 24h, fallback stale 48h, RLS public read / service write, source ODbL Atmo France |

---

## Fonctions RPC PostGIS

### Isochrones & Bataille (NE PAS MODIFIER)
| RPC | Description | Appelee depuis |
|-----|-------------|----------------|
| `get_isochrone_battle` | Isochrones multi-paliers, ST_Difference | `api/isochrone-battle/` |
| `clip_rings_to_france` | Clip anneaux isochrones sur France | Routes isochrone |
| `clip_geojson_to_france` | Clip GeoJSON sur `france_borders` | `api/isochrone-battle/` |

### Scoring & Couverture
| RPC | Description | Appelee depuis |
|-----|-------------|----------------|
| `compute_panneau_scores_v2` | Scoring OOH parametrique | `lib/chat/tools/scorerOoh.ts` |
| `compute_coverage_fast` | Couverture Filosofi dans isochrones | `lib/inngest/functions/` |
| `calculate_coverage_per_group` | Couverture par groupe (dedupliquee) | `api/coverage-stats/` |
| `calculate_target_coverage` | Couverture buffer circulaire | `lib/chat/tools/audienceCoverage.ts` |
| `compute_poi_accessibility` | Accessibilite POI (Gaussian sigma) | `api/correlation/compute/` |
| `find_synergy_billboards` | Panneaux OOH synergie | `lib/chat/tools/synergy.ts` |
| `get_voronoi_by_category` | Voronoi par categorie, clippe France | `lib/chat/tools/voronoi.ts` |
| `refresh_ville_stats_chunk` | Refresh stats villes par batch | `api/admin/refresh-ville-stats/` |

### Carreaux & Tuiles
| RPC | Description | Appelee depuis |
|-----|-------------|----------------|
| `get_carreaux` | Carreaux dans bbox avec indicateur | `api/carreaux/` |
| `get_carreaux_by_zoom` | Carreaux adaptes au zoom | `api/carreaux/dynamic/` |
| `get_carreaux_for_scoring` | Carreaux dans rayon (scoring) | `lib/chat/tools/` |
| `get_tile` | Tuile MVT carreaux (ST_AsMVT) | `api/tiles/` |
| `get_iris_tile` | Tuile MVT IRIS (ST_AsMVT) | `api/iris-tiles/` |
| `import_carreaux_batch` | Upsert batch carreaux | `api/admin/import-geo/` |
| `populate_carreaux_columns` | Colonnes derivees post-import | `lib/inngest/functions/` |

### IRIS
| RPC | Description | Appelee depuis |
|-----|-------------|----------------|
| `get_iris_stats_by_bbox` | Stats IRIS par bbox | `api/iris/stats/` |
| `get_iris_dept_stats` | Stats IRIS departementales | `api/iris/stats/` |
| `get_iris_metric_columns` | Colonnes metriques dynamiques | `api/iris/` |
| `get_iris_fill_status` | Taux de remplissage IRIS | `api/admin/iris/` |
| `get_iris_iris_residual_inputs` | Inputs residus correlation | `api/correlation/compute/` |
| `update_iris_core_batch` | Update batch colonnes core | `api/iris-crawler/manual-import/` |

> Orphelines (en base mais sans appelant TS) : `get_iris_geojson_by_bbox`,
> `get_iris_geojson_by_codes` — etaient utilises par `/api/iris/geojson`,
> route supprimee. Conservees en base ; voir `CLEANUP_REPORT.md`.

### Digital / Campagnes
| RPC | Description | Appelee depuis |
|-----|-------------|----------------|
| `get_digital_campaigns_list` | Liste campagnes avec stats | `api/digital/campaigns/` |
| `get_campaign_medias` | Regies distinctes campagne | `api/digital/[id]/ai-analysis/` |
| `get_digital_campaign_map` | Choroplethe CP | `api/digital/[id]/map/` |
| `get_digital_analysis_breakdown` | Breakdown geo | `api/digital/[id]/analysis/` |
| `get_digital_media_heatmap` | Heatmap regies x zones | `api/digital/[id]/analysis/` |
| `get_digital_available_indicators` | Indicateurs disponibles | `api/digital/[id]/analysis/` |
| `get_digital_cp_iris_detail` | Detail IRIS dans un CP | `api/digital/[id]/cp-detail/` |
| `get_digital_geography_map` | Croisement campagne x zones | `api/digital/[id]/geography/` |
| `get_codes_postaux_bbox` | Polygones CP dans bbox | `api/digital/codes-postaux/` |
| `get_geography_sets` | Jeux de zones disponibles | `api/geographies/` |
| `match_campaign_postal_to_iris` | Matching postal -> commune -> IRIS | `api/admin/campaigns/import/` |
| `get_dsp_campaign_stats` | Stats agregees campagne | `api/admin/campaigns/` |
| `get_campaign_stats_by_field` | Stats par champ | `api/admin/campaigns/[id]/` |

### Radio
| RPC | Description | Appelee depuis |
|-----|-------------|----------------|
| `get_radio_emetteurs_geojson` | GeoJSON emetteurs | `api/radio/emetteurs/` |
| `get_radio_filter_options` | Options filtres radio | `api/radio/filter-options/` |
| `get_radio_stats` | Stats globales radio | `api/radio/stats/` |
| `get_radio_audit` | Audit matching radio | `api/radio/audit/` |
| `count_emetteurs_par_radio` | Comptage emetteurs/radio | `api/radio/stations/` |
| `get_radios_for_emetteur` | Radios d'un emetteur | `api/radio/emetteurs/[staAnfr]/` |
| `archive_and_purge_radio` | Archivage donnees radio | `lib/radio/anfr-import.ts` |

### Meteo
| RPC | Description | Appelee depuis |
|-----|-------------|----------------|
| `get_zone_centroids` | Centroides zones admin | `api/meteo-geo/` |
| `get_zone_polygons` | Polygones simplifies zones admin (choroplethe) | `api/meteo-geo/zones/` |

### Correlation
| RPC | Description | Appelee depuis |
|-----|-------------|----------------|
| `correlation_iris_iris` | Correlation POI x IRIS | `api/correlation/compute/` |

### Referentiels
| RPC | Description | Appelee depuis |
|-----|-------------|----------------|
| `build_ref_codes_postaux` | Construction ref CP | `api/admin/import-laposte/` |
| `truncate_laposte_hexasmal` | Reset ref La Poste | `api/admin/import-laposte/` |
| `update_laposte_centroids` | Centroides CP | `api/admin/import-laposte/` |
| `save_geography_from_cache` | Sauvegarde jeu de zones | `api/geographies/` |

### Admin & Monitoring
| RPC | Description | Appelee depuis |
|-----|-------------|----------------|
| `get_table_sizes` | Taille tables (monitoring) | `api/admin/health/` |
| `count_poi_by_categorie_source` | Compte POI par categorie/source | `api/admin/import-datagouv/` |
| `get_sources_stats` | Stats sources de donnees | `api/admin/sources-stats/` |
| `get_poi_categories` | Categories POI | `api/admin/poi-categories/` |
| `get_active_data_registry` | Registre donnees actif | `api/` |
| `get_check_constraint_values` | Valeurs contraintes CHECK | `api/` |
| `drop_carreaux_table` | DROP table carreaux dynamique | `api/admin/sources/[id]/` |
| `get_accessibility_inputs` | Inputs accessibilite | `api/correlation/` |
| `log_smart_prompt_feedback` | Log feedback prompt IA | `api/smart-prompt/` |
| `smart_demographie_stats` | Stats demo smart prompt | `lib/smart-prompt/` |
| `smart_demographie_top_villes` | Top villes smart prompt | `lib/smart-prompt/` |

---

## Variables d'environnement

### Obligatoires
| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL publique Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Cle publique (anon) |
| `SUPABASE_SERVICE_ROLE_KEY` | Cle service role — **jamais exposer au client** |
| `SUPABASE_DB_URL` | URL PostgreSQL directe |
| `ORS_API_KEY` | Cle OpenRouteService |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Cle Gemini |
| `DSP_ENC_KEY` | Cle AES-256 base64 (32 bytes) pour chiffrer les secrets DSP (`dsp_connections`) — **jamais exposer au client** |

### Optionnelles
| Variable | Description |
|----------|-------------|
| `MISTRAL_API_KEY` | Provider alternatif |
| `UPSTASH_REDIS_REST_URL` | Redis rate limiting |
| `UPSTASH_REDIS_REST_TOKEN` | Token Redis |
| `ADMIN_INIT_KEY` | Cle init admin |
| `INNGEST_EVENT_KEY` | Jobs async |
| `INNGEST_SIGNING_KEY` | Signing jobs |
| `NEXT_PUBLIC_APP_URL` | URL app (defaut localhost:3000) |
| `ATMO_PROVIDER` | `mock` (defaut) ou `atmofrance`. Backend de l'indicateur sante environnementale |
| `ATMO_FRANCE_USERNAME` | Email du compte Atmo Data v2 (requis si `ATMO_PROVIDER=atmofrance`) |
| `ATMO_FRANCE_PASSWORD` | Mot de passe du compte Atmo Data v2 |
| `DV360_OAUTH_CLIENT_ID` | Client ID OAuth Google pour le flux DV360 (fallback si non saisi par org via formulaire) |
| `DV360_OAUTH_CLIENT_SECRET` | Client Secret OAuth Google pour le flux DV360 (fallback si non saisi par org) |
| `DV360_OAUTH_REDIRECT_URI` | Override du callback OAuth DV360 ; si absente, derivee de `NEXT_PUBLIC_APP_URL` + `/api/admin/dsp/dv360/oauth/callback` |
| `TIKTOK_APP_ID` | App ID TikTok Business API (fallback si non saisi par org via formulaire) |
| `TIKTOK_APP_SECRET` | App Secret TikTok (fallback si non saisi par org) |
| `TIKTOK_OAUTH_REDIRECT_URI` | Override du callback OAuth TikTok ; si absente, derivee de `NEXT_PUBLIC_APP_URL` + `/api/admin/dsp/tiktok/oauth/callback` |

---

## Contraintes operationnelles

### Supabase Nano (250 IOPS, 5 MB/s, burst 30 min/jour)
- Max 3 requetes Supabase paralleles (`Promise.all`)
- Bbox = viewport carte visible, jamais France entiere
- Lazy loading : 1 colonne IRIS a la fois
- Cache client `useRef` avant tout fetch
- Batch insert par 50 max (`lib/import/inserter.ts`)
- `EXPLAIN ANALYZE` sur toute nouvelle requete PostGIS

### PostgREST
- Truncate a 5000 rows par defaut → utiliser RPC JSON ou `.limit(100000)`

### MapLibre 5.x
- Gzip obligatoire sur reponses MVT (plante silencieusement sans)
- `geom_3857` pre-calcule sur carreaux (pas de reprojection a la volee)

### PMTiles IRIS
- Stockees sur GitHub Releases (pas Supabase Storage)
- Proxy : `/api/iris-tiles-proxy`

---

## Commandes

```bash
npm run dev              # Dev (localhost:3000)
npm run build            # Build production
npx tsc --noEmit         # Type-check
npm test                 # Vitest
npm run lint             # ESLint
npx supabase db push     # Appliquer migrations
npx supabase gen types typescript --project-id vkkdbygwbrxyogqosten > types/database.types.ts
```

---

*MAGELIAN — Geospatial intelligence*
