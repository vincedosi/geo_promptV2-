# ARCHITECTURE — MAGELIAN

> Derniere mise a jour : 2026-09-08 (suppression de l'overlay Pilotage ML et de tout ce
> qui n'etait atteignable que par lui — voir ci-dessous)
> Regle structurelle : tout passe par /map et ses overlays (mediaplanner) ; le panneau Reglages = back office admin.
> Deep-link overlay campagne : `/map?campaign=<id>&tab=<creation|suivi|apercu>` (ignore si `?overlay=` present).
> Retrait 2026-09-08 (2e passe) : `/api/iris-import/insee` et son onglet supprimes
> — la route n'ecrivait rien dans `iris_import_history` et aucun des 8 imports
> IRIS de la base n'en vient. Il ne reste qu'un chemin : le depot de CSV.
> `lib/import/shp-parser.ts` supprime aussi (mort, homonyme de la fonction
> reellement utilisee dans `file-parser.ts`).
> Retrait 2026-09-08 : 13 routes API sans appelant supprimees (voir
> `docs/PLAN_SAAS.md` §3.A). Les six RPC devenues orphelines EN BASE ont ete
> supprimees le 2026-09-11 avec le reste du menage (sql/133 et sql/134).
> Version : 7.7.x
> Auteur initial : Vince Dosi

> **Retrait de Pilotage ML (2026-09-08).** L'overlay `pilotage` du rail /map a ete
> supprime, avec le wizard de strategie A4.7 (`app/strategies/`), les pages de demo
> `app/custom-bidding/`, `app/settings/agent/`, `CustomBiddingBar` et 22 routes
> `/api/bidding/*` devenues sans appelant. Le slot du rail est desormais
> « Campagnes » et ouvre l'overlay MAGELIAN ; la tuile de marque qui doublonnait
> en tete de rail a ete retiree. Le deep-link `?overlay=pilotage` est inerte.
>
> Ce qui reste de la plomberie bidding sert le wizard de campagne :
> `/api/bidding/strategies` (GET/POST), `/strategies/[id]` (GET/PATCH/DELETE),
> `/strategies/[id]/export`, `/strategies/[id]/final-report`,
> `/strategies/drafts` + `/drafts/[id]`, et `/api/bidding/train` (appele par
> `lib/agent/autonomy.ts`). `FinalReport` a migre vers `components/campaign/`.
> Les tables `bidding_daily_state`, `bidding_simulations` et `bidding_curve_history`
> n'ont plus d'ecrivain applicatif — a trancher en seconde passe.
> `bidding_zone_configs` reste utile (lue par `refresh_campaign_rollups`).

---

> **Dependance externe non documentee jusqu'au 2026-09-11 : Modal.**
> `lib/bidding-ml/client.ts` appelle un service serverless Python tiers sur
> `*.modal.run` (endpoints `-predict`, `-train`, `-detect-drift`), pilote par
> `MODAL_BIDDING_ML_URL`. Chemin d'appel vivant :
> `lib/agent/autonomy.ts:147` → `POST /api/bidding/train` → `trainModel()` → Modal.
> Le service lui-meme vit DANS LE DEPOT : `modal/bidding_ml/` (16 fichiers
> suivis par git, tests compris), deploye sur Modal et non sur Vercel — c'est le
> seul composant du projet qui ne tourne pas dans Next.js.
>
> Seul `docs/architecture.md` (perime, 30/04) en parlait ; ce document l'ignorait,
> arborescence et tableau des variables d'environnement compris. Corrige le
> 2026-09-11, et desormais garde par `tests/unit/docs/derive-documentation.test.ts`.

## Stack technique

| Couche | Technologie | Version |
|--------|-------------|---------|
| Framework web | Next.js (App Router) | 15.5.25 |
| Runtime UI | React | ^19.0 |
| Langage | TypeScript (strict) | ^5.3 |
| Base de donnees | Supabase (PostgreSQL 15 + PostGIS) | ^2.97 |
| Cartographie | MapLibre GL JS | ^5.18 |
| Tuiles vectorielles | PMTiles (IRIS via GitHub Releases) | 4.4.0 |
| LLM / Copilote | Vercel AI SDK + Gemini 2.5 Flash / Mistral Small | ai ^6.0 |
| Fonds de carte | OpenFreeMap (Liberty / Positron / Bright) + MAGELIAN dark style | — |
| Isochrones | OpenRouteService (ORS) REST API | — |
| Meteo | Open-Meteo API (temperature, precipitation, ensoleillement) | — |
| Inference ML bidding | **Modal** (serverless Python, HTTPS) — `-predict` / `-train` / `-detect-drift` | — |
| Jobs asynchrones | Inngest (serverless queue) | ^3.52 |
| Rate limiting | Upstash Redis | ^2.0 |
| PDF export | @react-pdf/renderer | ^4.3 |
| Lecture tableurs | exceljs (.xlsx/.xlsm) + lecteur .ods maison (jszip) | ^4.4 |
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
│   ├── copilote/               # Composants/hooks/lib du chat IA + carte, consommes
│   │                           # par /map (plus de page propre depuis 825af5a)
│   │   ├── _components/        # ChatPanel, MapPanel, PromptsPanel, ZoneCard...
│   │   ├── _hooks/             # useMapInit, useMapLayers, useChatControls...
│   │   └── _lib/               # constants.ts (circleGeoJSON, getCatColor)
│   ├── dashboard/              # Page d'accueil apres login
│   │   └── iris-crawler/       # Interface crawler INSEE IRIS
│   ├── login/                  # Page de connexion Supabase Auth
│   ├── map/                    # Page carte complete
│   │   ├── _components/        # FilterPanel, IrisDetailPanel
│   │   └── analyse/digital/    # Analyse campagnes digitales
│   │       ├── _components/    # AnalysisPanel, SyncMap, BiddingCopilot,
│   │       │                   # MeteoGeoPanel, MediaHeatmap, KpiSummary...
│   │       └── _lib/           # use-digital-data.ts
│   └── layout.tsx              # Layout racine (AppSidebar, fonts)
│
├── components/                 # Composants React partages
│   ├── AppSidebar.tsx          # Sidebar navigation MAGELIAN
│   ├── campaign/               # Gestion campagne (embarquee dans l'overlay MAGELIAN)
│   │   ├── CampaignCockpit.tsx # Fil d'Ariane + wizard prog (Cible→Canaux & budgets→Pression→Strategie→Lancement)
│   │   ├── CampaignOverview.tsx# Apercu campagne + actions (Pause/Cloturer/Archiver/Supprimer) —
│   │   │                       # la modification passe par l'onglet Programmer (wizard)
│   │   ├── CampaignSuivi.tsx   # Cockpit de suivi en vol (tuiles/alertes/graphes/tableau via suivi/*)
│   │   │                       # + reconciliation DSP ⇔ mesure + bilan + chat IA
│   │   ├── suivi/              # SuiviCockpit, SuiviCharts, SuiviTable, ReconciliationPanel
│   │   └── wizard/             # Etapes du wizard (PressureControl = slider pression ↔ CPM min/max)
│   ├── magelian/               # Overlay MAGELIAN (Programmer/Suivi/Apercu) + deep-link
│   │   ├── MagelianOverlay.tsx # Overlay plein ecran — onglets Programmer/Suivi/Apercu ; selecteur
│   │   │                       # de campagne reserve a Suivi/Apercu (donnees OU strategie)
│   │   ├── CreationHall.tsx    # Hall de l'onglet Programmer : nouvelle campagne, reprendre une
│   │   │                       # coquille (badge brouillon, suppression), modifier une lancee
│   │   ├── MagelianDeepLink.tsx# Lit /map?campaign=&tab=, ouvre l'overlay, nettoie l'URL
│   │   └── deep-link.ts        # parseMagelianParams (ignore ?overlay= des autres overlays)
│   ├── CarreauxPMTilesLayer    # Couche PMTiles carreaux INSEE
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
│   ├── api/                    # Middleware API (requireAdmin, requireAuth) + rate-limit.ts (Upstash ou memoire)
│   │                           # + valider-corps.ts : lireCorps (JSON) / lireFormulaire (multipart)
│   │                           #   + fichierDeFormulaire / fichiersDeFormulaire — lecture validee
│   │                           #   du corps, ne leve jamais, messages en francais (SEC-001)
│   ├── auth/                   # getSessionOrg, getOrgSourceIds, roles.ts (source unique des roles + schemas Zod)
│   ├── campaigns/              # column-mappings.ts, parser.ts
│   ├── carreaux/                # normalisation.ts (densite/km2, moyennes) + bornes.ts (echelle nationale log10)
│   │                           # + expressions.ts : expressions MapLibre partagees (couleur, hauteur 3D,
│   │                           #   largeur de maille deduite de superficie_km2 — pas de cascade recopiee)
│   ├── chat/                   # Copilote IA
│   │   ├── providers.ts        # createModel() — Gemini / Mistral
│   │   ├── system-prompt.ts    # Prompt systeme dynamique
│   │   ├── trim-history.ts     # Compression historique chat
│   │   └── tools/              # Outils function calling (1 fichier = 1 outil)
│   ├── db/                     # Migrations SQL applicatives
│   ├── digital/                # google-ads-geo-ids.json
│   ├── dsp-mapping/            # loader.ts — mappings de colonnes DSP dynamiques (table dsp_source_mappings)
│   ├── metrics-display/        # loader + formateur dynamique des metriques (dsp_metrics_registry)
│   ├── bidding-ml/             # client HTTP vers Modal + comparison / metric-labels / targeting-kpis
│   ├── format/                 # nombre.ts — source unique de la mise en forme des nombres
│   │                           #   (DUP-001 : 15 fmtNum locaux remplaces)
│   ├── geo/                    # france-admin.ts, locations.ts
│   ├── http/                   # fetch-avec-delai.ts — tout appel sortant vers un tiers
│   │                           # DOIT passer par la : delai d'expiration, PAS de reprise
│   │                           # (la plupart de ces appels ne sont pas idempotents)
│   ├── import/                 # Pipeline d'import universel (+ identite-poi.ts : id deterministe,
│   │                           #   schemas.ts : ConfigImportSchema partage par dry-run et execute)
│   ├── inngest/                # Jobs async (colonnes derivees)
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
├── modal/                      # Service ML serverless Python (deploye sur Modal, HORS Vercel)
│   └── bidding_ml/             # app.py = 3 endpoints HTTPS predict/train/detect-drift
│       ├── algos/              # registry.py (pluggable) + hoeffding.py (river)
│       ├── data_loader.py      # lecture Supabase en HTTPS
│       ├── persistence.py      # UPSERT bidding_zone_configs / proposals / daily_state
│       ├── drift_detection.py  # scan CPL/CTR par CP sur 2 fenetres
│       ├── serialization.py    # pickle + base64 du modele river
│       └── tests/              # test_predict / test_train / test_drift
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

### Roles et autorisation (audit du 2026-09-10)

Trois roles, declares par la contrainte `profiles_role_check` et exposes par
`/api/admin/roles`. Le pouvoir REELLEMENT exerce :

| | super_admin | admin | client |
|---|:---:|:---:|:---:|
| Se connecter, `/map`, `/dashboard` | oui | oui | oui |
| Les 64 routes `/api/admin/*` | oui | non | non |
| Gerer utilisateurs et organisations | oui | non | non |
| Voir les donnees de TOUTES les orgs (aucun filtre) | oui | non | non |
| Basculer d'organisation (org switcher) | oui | non | non |
| Campagnes, zones, plan media, suivi — de sa propre org | oui | oui | oui |
| Connexions DSP (DV360, TikTok) — de sa propre org | oui | oui | oui |
| Activer le mode demo (`/api/user/demo-mode`) | oui | oui | non |

**`requireAdmin()` n'est pas « admin », c'est « super_admin ».** Le guard
appelle `isSuperAdmin()`, soit `role === 'super_admin'` strictement. Un `admin`
n'ouvre donc aucune route d'administration.

Consequence : les branches « escalation protection » de `/api/admin/users` et
`/api/admin/organizations` (un admin ne peut pas creer de super_admin, ni
toucher un utilisateur d'une autre org, ni promouvoir) sont ecrites, correctes,
et **inatteignables** — seul un super_admin franchit le guard. C'est le vestige
d'un modele a deux niveaux d'administration qui n'a jamais ete branche. Il sera
reveille en rendant `requireAdmin` parametrable par niveau, le jour ou une org
cliente devra gerer ses propres sieges. Pas avant : personne n'est bloque
aujourd'hui (0 admin, 0 client hors comptes de test).

`editor` a ete retire le 2026-09-10 (migration `drop_editor_role`) : il
n'accordait rien de plus que `client` cote application.

### RLS — DORMANTES, ne pas s'y fier

Les policies filtrent par `organization_id` via `get_user_org(auth.uid())` sur :
`dsp_campaigns`, `dsp_campaign_data`, `data_sources`, `panneaux_affichage`,
`poi_france`, `saved_maps`, `profiles`, `organizations`,
`organization_members`, `campaign_organizations`.

⚠️ **Elles ne s'executent jamais.** Les 146 routes API utilisent
`createAdminClient()` (cle `service_role`), qui contourne RLS ; aucune
n'utilise la cle anon. L'autorisation reellement appliquee est celle du
middleware (authentifie ?) plus les guards et le scoping par org ecrits dans
chaque handler.

Les policies restent une defense en profondeur valable — mais personne ne doit
supposer qu'elles protegent quoi que ce soit tant que ce chemin n'est pas
emprunte. Deux pieges a connaitre avant de brancher la cle anon un jour :

- Trois policies nomment encore `editor` (`dsp_campaign_data_modify`,
  `dsp_campaigns_update`, `poi_france_modify`). Le role n'existe plus : ce OR
  se lit desormais « admin ». Elles ont ete laissees telles quelles — les
  reecrire ferait courir un risque sur l'autorisation de trois tables coeur
  pour zero changement de comportement.
- Huit tables de referentiel (`ref_communes`, `ref_departements`,
  `ref_regions`, `ref_codes_postaux`, `laposte_hexasmal`,
  `postal_code_commune`, `carreaux_commune_lookup`, `carreaux_cp_population`)
  ont des policies `auth.jwt() ->> 'role' = 'admin'`. C'est le role **Postgres**
  du JWT, qui vaut `authenticated` pour un utilisateur connecte, jamais
  `admin` : ces policies ne matchent donc JAMAIS. Sans consequence aujourd'hui,
  bloquant total le jour ou la cle anon serait utilisee.

---

## Routes API

### Chat & Copilote IA
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/chat` | POST | Copilote — streaming LLM + function calling |
| `/api/smart-prompt` | POST | Multi-agents Mistral (orchestrateur + agents specialises) |
| `/api/providers/status` | GET | Disponibilite providers IA |

### Donnees cartographiques
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/map/pois` | GET | POI dans une zone avec filtres categorie |
| `/api/map/categories` | GET | Categories POI distinctes |
| `/api/map/ooh` | POST | Panneaux OOH dans bbox |
| `/api/map/transport` | GET | Donnees transport |
| `/api/map/poi-natures` | GET | Natures de POI |
| `/api/tiles/[z]/[x]/[y]` | GET | Tuiles MVT carreaux (gzip obligatoire). **Cascade `get_tile` calee sur la taille apparente des mailles** (une choroplethe se lit entre 10 et 40 px par carreau) : `z<=6` 20 km · `z7` 5 km · `z8` 2 km · `z9-11` **1 km** · `z>=12` 200 m (sql/129). Ne PAS redescendre le seuil du 200 m sans avoir d'abord donne des colonnes typees a `carreaux_filosofi` : ses 4,6 Go et son jsonb de 806 o/ligne imposent un plancher d'environ 4 s par tuile froide sur Nano. Chaque feature porte `superficie_km2` (sql/122), consomme par `lib/carreaux/normalisation.ts` pour rendre les indicateurs comparables entre paliers de zoom. **Tout changement du schema de tuile (colonnes ajoutees/retirees) impose de bumper `CARREAUX_TILE_VERSION` dans `lib/version.ts`** — sinon une tuile en cache (jusqu'a 1 h) reste servie avec l'ancien schema pendant que le front attend le nouveau. |

### IRIS
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/iris/stats` | GET | Stats IRIS par colonne et niveau |
| `/api/iris/detail` | GET | Detail IRIS complet (toutes colonnes socio-demo + nom_commune) |

### Indicateurs civiques
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/civic-indicators/health/[code_insee]` | GET | Indice ATMO + pollen pour une commune (cache 24h, fallback stale 48h, ODbL Atmo France) |
| `/api/civic-indicators/health-map` | GET | Carte sante environnementale : `dataset=pollen\|atmo`, `scale=departement` (stream NDJSON 1 commune/dept, pollen ET air par ligne) ou `scale=cp` (lecture `pollen_map_daily`/`atmo_map_daily`, filtres `min_level` 0-6 + `metric`) — layer CivicHealthMapLayer, section Sante environnementale |

### Import IRIS (protegees par `requireAdmin()`)
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/iris-crawler/import-history` | GET | Historique imports IRIS |
| `/api/iris-crawler/manual-upload` | POST | Upload manuel CSV (parse + auto-map) |
| `/api/iris-crawler/manual-import` | POST | Import manuel vers table `iris` (NDJSON streaming) |

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

### Digital / Campagnes DSP (protegees par `requireAuth()`)
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/digital/campaigns` | GET | Liste campagnes avec stats (RPC) |
| `/api/digital/[campaignId]/analysis` | GET | Breakdown/medias/indicators/heatmap |
| `/api/digital/[campaignId]/map` | GET | Choroplethe CP campagne (GeoJSON) |
| `/api/digital/[campaignId]/media` | GET | Regies distinctes campagne |
| `/api/digital/[campaignId]/ai-analysis` | POST | Analyse Gemini performances geo |
| `/api/digital/[campaignId]/bidding-chat` | POST | Chat bidding Gemini multi-turn |
| `/api/digital/[campaignId]/campaign-chat` | POST | Chat IA « Suivi campagne » — streaming Gemini, historique ephemere cote client, contexte serveur borne (stats geo RPC 098 + journal strategie 25/15/10 + breakdown IRIS 30) |
| `/api/digital/[campaignId]/suivi` | GET | Payload complet du cockpit de suivi (pacing, CPM, pression tenue, alertes, depts, quotidien) — lit les rollups uniquement, backfill lazy si absents (campagnes avec strategie) |
| `/api/digital/[campaignId]/suivi/cps` | GET | Drill niveau 3 du tableau : les CP d'un departement (`?dept=`, max 500, pires indices d'abord) |
| `/api/digital/[campaignId]/suivi/map` | GET | Choroplethe CP du suivi (`?metric=hold\|cpm&bbox=`) — features GeoJSON pour SuiviMapLayer |
| `/api/digital/[campaignId]/reconcile` | GET | Payload de reconciliation DSP ⇔ ad server (taux de mesure global, composition de l'achat par canal, tendance) — lit campaign_dsp_report + rollups |
| `/api/digital/[campaignId]/reconcile/pull` | POST | (Re)construit le rapport DSP (requireAdmin) : demo → RPC simulate_dsp_report ; prod → lib/dsp/report par canal connecte (API, skipped si non connecte — jamais d'import fichier) |
| `/api/digital/[campaignId]/reconcile/map` | GET | Choroplethe CP de reconciliation (`?metric=measure\|dspcpm&bbox=`) — SuiviMapLayer source reconcile |
| `/api/bidding/strategies/[id]/export` | GET | Fichier custom bidding « fidèle à la pression » par canal (`?channel=` du dsp_channel_registry) : scores par CP interpolés sur la courbe INSEE, 5 paliers quantiles, hors-zone 0 (zones strictes) ou 1 (national+surpression) — dv360 script .py / tiktok fiche / autres CSV `postal_code;score` (lib/digital/bidding-export.ts, étape 5 Lancement) |

### Radio FM/DAB+ (protegees par `requireAuth()`)
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/radio/stations` | GET | Liste radios + nb emetteurs (pagine) |
| `/api/radio/emetteurs` | GET | GeoJSON emetteurs (RPC PostGIS) |
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
| `/api/admin/campaigns` | GET/POST | Liste campagnes avec stats agregees ; POST = naissance d'une campagne vierge du wizard (dsp_source `magelian`, nom par defaut date en Europe/Paris, org du createur) |
| `/api/admin/campaigns/attachable` | GET | Imports rattachables a une campagne du wizard (`?exclude=` — donnees sans strategie de bidding, scope org) |
| `/api/admin/campaigns/[id]/absorb` | POST | Fusionne un import orphelin dans la campagne (donnees + dates + totaux, cible SANS donnees uniquement — 409 sinon), puis supprime la coquille source |
| `/api/admin/campaigns/import` | POST | Import SSE streaming |
| `/api/admin/campaigns/[id]` | GET/DELETE/PATCH | Detail/suppression/modification campagne |
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
| `/api/dsp/dv360/resources` | GET | Listing cascade liaison DV360 de l'etape Canaux (requireAuth, PAS admin) : `?campaignId=` → annonceurs du partner de la connexion de l'org proprietaire, `+advertiserId=` → campagnes DV360, `+dv360CampaignId=` → insertion orders — alimente `geo_strategy.channels.links.dv360` (IDs + noms), consomme par le push bidding |

### Administration generale (protegees par `requireAdmin()`)
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/admin/import-poi/parse` | POST | Parse + auto-detection colonnes |
| `/api/admin/import-poi/dry-run` | POST | Preview import (10 lignes) |
| `/api/admin/import-poi/execute` | POST | Import batch SSE streaming |
| `/api/admin/import-ooh/arcgis` | POST/DELETE | Import OOH ArcGIS REST |
| `/api/admin/import-datagouv` | POST | Import data.gouv.fr (SSRF whitelist). **Idempotent** depuis le 2026-09-11 : `id` deterministe (`lib/import/identite-poi.ts`, source `data_gouv`) + `upsert onConflict: 'id'`, donc un re-import du meme jeu n'ecrit rien. Les compteurs du flux NDJSON portent `inserted` ET `ignored` (deja presents) |
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
| `/api/admin/civic-ingest` | POST | Ingestion nationale pollen + qualite de l'air → `pollen_map_daily` + `atmo_map_daily` (WFS public Atmo, NDJSON streaming) — aussi cron Inngest `civic-daily-ingest` 05h30 |
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

### Zones custom — plan média
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/custom-geo/national-totals` | GET | Totaux population France par tranche d'age (RPC `get_national_population_totals` sur carreaux_5km, cache serveur 24h) — colonne « % France » du plan media (ZoneMediaPlanPanel : budget/CPM/cible sur les zones affichees) |
| `/api/custom-geo/[id]/items-audience` | GET | Audience par item d'une zone (les isochrones d'une zone battle) — cache `items_audience_stats`, sinon RPC `compute_zone_items_audience` (sql/088, cibles age+menages+logement social sql/090) |
| `/api/custom-geo/[id]/export?weights=` | GET | Variantes ponderees de `bidding_script` (paliers de score DV360 par item) et `tiktok_geo` (un ad group par item avec part de budget) — poids du plan media, RPC `get_zone_items_export` (sql/089) |
| `/api/custom-geo/media-plan` | GET/POST/DELETE | Rattachement du plan media a une campagne DSP — persiste budget/CPM/cible/poids dans `dsp_campaigns.geo_strategy.media_plan` (sous-cle namespacee, scope org) |

### Export & Sauvegarde
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/saved-maps` | GET/POST/DELETE | Sauvegarde/charge etat carte |
| `/api/saved-maps/[id]` | GET/PUT/DELETE | Acces/modification/suppression |
| `/api/inngest` | POST | Webhook Inngest |

---

> **Menage en base du 2026-09-11 (sql/133 et sql/134).** 240 Mo liberes,
> 18 objets et 18 fonctions retires. Critere applique a chacun : aucune
> reference dans le code (attention au faux positif — `types/database.types.ts`
> cite TOUTES les tables), aucune mention dans une fonction, vue ou vue
> materialisee de `public`, aucune cle etrangere, aucune vue dependante, et une
> definition presente dans une migration versionnee (restaurer = une operation
> git, pas une restauration de sauvegarde).
>
> La plus grosse prise : `carreaux_commune_lookup` (227 Mo, 2,2 M lignes), un
> cache derive de `carreaux_filosofi` dont l'unique lecteur, `get_equity_analysis`,
> n'avait lui-meme aucun appelant — du code mort lisant un cache mort.
>
> **N'ONT PAS ete retires, et il faut savoir pourquoi :**
> - `geography_zones` (93 lignes) n'a aucun lecteur non plus, mais ce sont les
>   **93 zones CIRFA** d'avril 2026, la donnee metier du plan media. De la
>   geometrie faconnee, pas un cache. Les migrer vers `custom_geo_zones` ou les
>   abandonner est un arbitrage produit.
> - `laposte_hexasmal` (vide) et ses trois fonctions : `sql/119-120` les ont
>   durcies apres avoir decouvert qu'un appel pouvait effacer les 6 187 codes
>   postaux de `ref_codes_postaux`. Les retirer supprimerait ce risque — et le
>   seul chemin de reconstruction du referentiel.
> - `get_isochrone_battle_v10` : sans appelant, mais famille bataille, PROTEGEE.
> - `get_user_org` / `get_user_orgs` / `get_user_role` : sans appelant applicatif,
>   citees par les policies RLS.
> - `custom_access_token_hook` : appelee par GoTrue, jamais par notre code.
> - `releve_empreinte_carreaux`, `fill_carreaux_1km_bande` : outils de
>   construction, sans appelant PAR CONSTRUCTION.

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
| `dsp_campaigns` | Campagnes DSP (Adform, DV360...) | nom, source, dates, pays, tracked_ads, advertiser + product (identité déclarée au wizard, PATCHée au Lancement) |
| `dsp_channel_registry` | Catalogue des canaux (dsp/social/adserver) | code, label, connection_provider, `link_levels` jsonb = hiérarchie de liaison par canal (annonceur → campagne → IO/ad group/placement) — rendue en cascade API si connecté, en saisie manuelle sinon (sql/104) |
| `dsp_campaign_data` | Lignes d'impressions DSP | Unicite via index EXPRESSION `idx_dsp_data_unique` sur (campaign_id, COALESCE(date), COALESCE(postal_code), COALESCE(city), COALESCE(media)) — 5 colonnes, NULL=egal. **Non inferable par `onConflict` PostgREST** : pour un import idempotent, faire DELETE cible + insert (pas d'upsert). |
| `campaign_organizations` | Liaison N:N campaigns/orgs | campaign_id, organization_id |
| `postal_code_commune` | Referentiel La Poste | ~35k lignes, code postal -> commune |
| `indicator_cp_values` | Valeurs d'indicateurs INSEE par code postal (pression sur la cible) | Materialisation lazy par indicateur (RPC ci-dessous), agregation IRIS -> CP avec fallback communal ; consommee par apply_zone_weights_to_strategy et l'export custom bidding |
| `campaign_daily_rollup` | Agregat quotidien par campagne (date × media : imps, clics, spend) | Rafraichi a l'import/absorb/armement — le cockpit de suivi ne scanne JAMAIS dsp_campaign_data. RLS deny-all (routes service role) |
| `campaign_cp_rollup` | Agregat par CP (imps, spend, fenetres 7 j, in_target + planned_share du plan) | ~6-12k lignes/campagne — tableau, alertes et carte du suivi. RLS deny-all |
| `campaign_dsp_report` | Flux DSP buy side pour la reconciliation. **Grains reels, mesures le 2026-09-11** : 2 041 lignes a `date` NULL (grain CP) et 90 avec date ET code postal — le grain « date×canal » annonce n'existe PAS (0 ligne a `postal_code` NULL). Sans cle primaire, mais idempotente par DELETE cible + INSERT | Alimente par API (lib/dsp/report) en prod, simulate_dsp_report en demo. format/creative_ref nullable (plomberie future). RLS deny-all |
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
| `carreaux_1km` | Agregation 1km (374 511 mailles, 151 Mo) — **sert z9-z11** | `grid_id` en PK, geometrie stockee en **3857** (pas de ST_Transform par tuile), sommes brutes. Construite par `fill_carreaux_1km_bande` (sql/129), journal des bandes dans `carreaux_1km_bandes` |
| `carreaux_2km` | Agregation 2km (122 018) — sert z8 | Colonnes directes, <100ms |
| `carreaux_5km` | Agregation 5km (22 058) — sert z7 | Colonnes directes, <100ms |
| `carreaux_20km` | Vue materialisee 20km (1 515) — sert z<=6 | Derivee de `carreaux_5km`, noms applicatifs (sql/124) |
| `france_borders` | Contours France metro | Clip isochrones/Voronoi |
| `france_boundary` | Boundary simplifie | |
| `comptages_routiers` | Comptages routiers (~408k lignes) | |

### POI & Panneaux
| Table | Description | Notes |
|-------|-------------|-------|
| `poi_france` | Points d'Interet — **une table**, et non une vue : il n'existe aucune table `poi` | Trigger `auto_set_geom`. `id` **deterministe** aux deux chemins d'import (universel et data.gouv) : UUIDv5 du contenu de la ligne (`lib/import/identite-poi.ts`), ce qui rend `onConflict: 'id'` operant et le rejeu d'un fichier sans effet. Ne jamais revenir a `randomUUID()` — voir `docs/AUDIT.md#ech-001` |
| `panneaux_affichage` | Panneaux OOH/DOOH toutes regies (~1 434 lignes) — table unique (carte + copilote) | `source_ref` = OBJECTID, UNIQUE (source, source_ref), filtrer `actif = true` |
| `import_runs_ooh` | Historique imports OOH | |
| `poi_categories` | Categories POI | |
| `poi_accessibility_config` | Parametres sigma accessibilite | |
| `data_sources` | Sources de donnees importees | |

### Radio FM/DAB+
| Table | Description | Notes |
|-------|-------------|-------|
| `emetteurs_radio` | Emetteurs radio ANFR (11 836) | geom, puissance_w, hauteur_m, systeme, **`rayon_couverture_m` pre-calcule** (6-54 km). `radio_id` existe mais est NULL partout : passer par la table N:N. 754 emetteurs en outre-mer — tout calcul metrique doit utiliser `geography`, pas Lambert-93. |
| `radios` | Radios (861) | nom, categorie_arcom, portee, groupe_media, audience_data |
| `emetteur_radio_stations` | Liaison N:N emetteurs/radios (569 698) | seule liaison exploitable, index `idx_ers_radio` |
| `radio_imports_log` | Historique imports radio | |

### Isochrones
| Table | Description | Notes |
|-------|-------------|-------|
| `isochrones_cache` | Cache isochrones ORS | Cle : poi_id + mode + minutes |

### Support
| Table | Description | Notes |
|-------|-------------|-------|
| `saved_maps` | Etats carte sauvegardes (user_id) | |
| `data_registry` | Registre donnees pour routeur multi-agents | |
| `calculation_jobs` | Jobs de calcul couverture | |
| `filosofi_national_averages` | Moyennes nationales Filosofi | |
| `smart_prompt_feedback` | Feedback prompts IA (user_id) | |
| `smart_ville_stats` | Stats villes | |
| `quotas_appels` | Compteurs de quota d'appels PARTAGES entre instances (sql/135) | Une ligne par cle = prefixe de route + appelant. Ecrite par la RPC `consommer_quota` (un seul `INSERT … ON CONFLICT … RETURNING`, donc exact en concurrence). Se purge elle-meme. RLS deny-all. **C'est le garde-fou du budget I/O Nano** : avant, il comptait en memoire d'instance et ne limitait rien sur Vercel |
| `civic_health_cache` | Cache indicateurs ATMO + pollen par code INSEE commune | TTL 24h, fallback stale 48h, RLS public read / service write, source ODbL Atmo France |
| `pollen_map_daily` | Indice pollen national par code postal (max des communes du CP) + concentrations grains/m³ par espece + alerte | ~6 200 lignes/jour, purge J-2, ingestion bulk WFS (sql/084 + 086), RLS read auth / write service |
| `atmo_map_daily` | Indice ATMO qualite de l'air par code postal (max des communes du CP) | ~5 000 lignes/jour, purge J-2, ingestion bulk WFS (sql/085), RLS read auth / write service |

---

## Fonctions RPC PostGIS

### Isochrones & Bataille (NE PAS MODIFIER)
| RPC | Description | Appelee depuis |
|-----|-------------|----------------|
| `get_isochrone_battle` | Isochrones multi-paliers, ST_Difference | `api/isochrone-battle/` |
| `clip_rings_to_france` | Clip anneaux isochrones sur France | Routes isochrone |
| `clip_geojson_to_france` | Clip GeoJSON sur `france_borders` | `api/isochrone-battle/` |

### Voronoi & Stats villes
| RPC | Description | Appelee depuis |
|-----|-------------|----------------|
| `get_voronoi_by_category` | Voronoi par categorie, clippe France | `lib/chat/tools/voronoi.ts` |
| `refresh_ville_stats_chunk` | Refresh stats villes par batch | *orpheline* (route supprimee 08/2026) |

### Carreaux & Tuiles
| RPC | Description | Appelee depuis |
|-----|-------------|----------------|
| `get_carreaux_by_zoom` | Carreaux adaptes au zoom | *orpheline* (route supprimee) |
| `get_carreaux_for_scoring` | Carreaux dans rayon (scoring) | `lib/chat/tools/` |
| `get_tile` | Tuile MVT carreaux (ST_AsMVT), cascade 5 paliers 20/5/2/1 km + 200 m (sql/129) | `api/tiles/` |
| `fill_carreaux_1km_bande` | Agrege les carreaux 200 m en mailles 1 km, par bande verticale (progression + journal anti-rejeu) | outil de construction, sql/129 |
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

> `get_iris_geojson_by_bbox` et `get_iris_geojson_by_codes` (route
> `/api/iris/geojson` supprimee) ont ete retirees de la base le 2026-09-11
> (sql/134).

### Digital / Campagnes
| RPC | Description | Appelee depuis |
|-----|-------------|----------------|
| `get_digital_campaigns_list` | Liste campagnes avec stats | `api/digital/campaigns/` |
| `get_campaign_medias` | Regies distinctes campagne | `api/digital/[id]/ai-analysis/` |
| `get_digital_geography_map_v2` | Choroplethe CP | `api/digital/[id]/map/` — la v1 `get_digital_campaign_map` a ete supprimee le 2026-09-11 |
| `get_digital_analysis_breakdown_v2` | Breakdown geo | `api/digital/[id]/analysis/` — la v1 a ete supprimee le 2026-09-11 |
| `get_digital_media_heatmap_v2` | Heatmap regies x zones | `api/digital/[id]/analysis/` — la v1 a ete supprimee le 2026-09-11 |
| `get_digital_available_indicators` | Indicateurs disponibles | `api/digital/[id]/analysis/` |
| `match_campaign_postal_to_iris` | Matching postal -> commune -> IRIS | `api/admin/campaigns/import/` |
| `get_dsp_campaign_stats` | Stats agregees campagne | `api/admin/campaigns/` |
| `get_campaign_stats_by_field` | Stats par champ (jsonb, creee sql/098 — n'existait pas avant 07/2026, la route admin utilisait son fallback) | `api/admin/campaigns/[id]/`, `api/digital/[id]/campaign-chat/` |
| `materialize_indicator_cp_values` | Materialise un indicateur du registre IRIS en valeurs par CP (agregation ponderee + fallback communal), table `indicator_cp_values` | Lancement wizard (matérialisation lazy), `api/bidding/strategies/` |
| `refresh_campaign_rollups` | Reconstruit les rollups de suivi d'une campagne (daily + CP, plan copie de bidding_zone_configs) | Import DSP, absorb, armement, backfill lazy `api/digital/[id]/suivi/` |
| `get_campaign_suivi` | Payload jsonb complet du cockpit (pacing, cpm, pression, objectif, alertes, depts, daily) — seuils d'alerte constants sql/108 | `api/digital/[id]/suivi/` |
| `get_campaign_suivi_cps` | CP d'un departement (drill, max 500, pires indices d'abord) | `api/digital/[id]/suivi/cps/` |
| `get_campaign_suivi_map` | Features CP (geometries ref_codes_postaux) pour la choroplethe hold/cpm | `api/digital/[id]/suivi/map/` |
| `simulate_dsp_report` | Genere le rapport DSP demo (set-based depuis les rollups, part de budget, sur-declaration ×1,03) | `api/digital/[id]/reconcile/pull/` |
| `get_campaign_reconciliation` | Payload reconciliation (global taux de mesure, par canal, tendance) | `api/digital/[id]/reconcile/` |
| `get_campaign_reconciliation_map` | Features CP taux de mesure / CPM DSP pour la carte | `api/digital/[id]/reconcile/map/` |
| `apply_zone_weights_to_strategy` | Bid multipliers par CP d'une strategie — generalise (sql/106) : courbe sur N'IMPORTE quel indicateur de `indicator_cp_values` via `variable_code`, uniforme sans indicateur | `api/bidding/strategies/` (POST/PATCH) |

### Radio
| RPC | Description | Appelee depuis |
|-----|-------------|----------------|
| `get_radio_emetteurs_geojson` | GeoJSON emetteurs | `api/radio/emetteurs/` |
| `get_radio_filter_options` | Options filtres radio | `api/radio/filter-options/` |
| `get_radio_stats` | Stats globales radio | `api/radio/stats/` |
| `get_radio_audit` | Audit matching radio | `api/radio/audit/` |
| `count_emetteurs_par_radio` | Comptage emetteurs/radio | `api/radio/stations/` |
| `archive_and_purge_radio` | Archivage donnees radio | `lib/radio/anfr-import.ts` |

### Meteo
| RPC | Description | Appelee depuis |
|-----|-------------|----------------|
| `get_zone_centroids` | Centroides zones admin | `api/meteo-geo/` |
| `get_zone_polygons` | Polygones simplifies zones admin (choroplethe) | `api/meteo-geo/zones/` |
| `get_national_population_totals` | Totaux France par tranche d'age (carreaux_5km, sql/087) | `api/custom-geo/national-totals/` |

### Referentiels
| RPC | Description | Appelee depuis |
|-----|-------------|----------------|
| `build_ref_codes_postaux` | Construction ref CP | `api/admin/import-laposte/` |
| `truncate_laposte_hexasmal` | Reset ref La Poste | `api/admin/import-laposte/` |
| `update_laposte_centroids` | Centroides CP | `api/admin/import-laposte/` |

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
| `log_smart_prompt_feedback` | Log feedback prompt IA | `api/smart-prompt/` |
| `consommer_quota` | Consomme une unite de quota et dit si l'appel passe (sql/135) | `lib/api/rate-limit.ts` — tous les limiteurs |
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
| `MODAL_BIDDING_ML_URL` | Prefixe Modal du service d'inference bidding (sans suffixe d'endpoint). `lib/bidding-ml/client.ts` y ajoute `-predict.modal.run`, `-train.modal.run`, `-detect-drift.modal.run`. **Sans elle, `/api/bidding/train` leve** |
| `MODAL_TOKEN_ID` | Token Modal |
| `MODAL_TOKEN_SECRET` | Secret Modal |
| `NEXT_PUBLIC_APP_URL` | URL app (defaut localhost:3000) |
| `ATMO_PROVIDER` | `mock` (defaut) ou `atmofrance`. Backend de l'indicateur sante environnementale |
| `ATMO_FRANCE_USERNAME` | Email du compte Atmo Data v2 (requis si `ATMO_PROVIDER=atmofrance`) |
| `ATMO_FRANCE_PASSWORD` | Mot de passe du compte Atmo Data v2 |
| `ATMO_WFS_URL` | Override du GeoServer WFS public Atmo (defaut : data.atmo-france.org/geoserver/ows) — source primaire SANS credential de l'ingestion pollen nationale |
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
- Servies directement depuis `/public` (`IRIS_PMTILES_URL`, cf. `lib/version.ts`).
  Le proxy `/api/iris-tiles-proxy` et la route MVT `/api/iris-tiles` ont ete
  supprimes en 09/2026 : plus aucun appelant depuis le passage aux PMTiles.

---

## Commandes

> **Traçabilité base (2026-09-08).** `types/database.types.ts` est desormais
> versionne (genere par le MCP Supabase — la CLI et `SUPABASE_DB_URL` ne sont pas
> requises). A regenerer apres chaque `apply_migration`. L'audit complet
> « ce que le code appelle vs ce que la base expose » est dans
> `docs/AUDIT_BASE.md` : 92 RPC appelees, 3 appelees sans exister en base
> (`get_check_constraint_values`, `compute_panneau_scores`).
> `get_radio_coverage_geometry` a ete ecrite le 2026-09-10 (sql/121) : la
> capture d'une zone custom depuis une couverture radio fonctionne desormais.

> **Types generes branches (2026-09-10).** Les clients Supabase sont typés
> `createClient<Database>`. Quatre frontieres que le generateur ne peut pas
> typer seul ont chacune un helper documente — les utiliser plutot qu'un cast :
>
> | Helper | Quand |
> |--------|-------|
> | `toJson` (`lib/supabase/rpc-json.ts`) | ecrire un objet applicatif dans une colonne `jsonb`, ou le passer en argument `jsonb` d'une RPC |
> | `rpcJson<T>` (idem) | lire le retour d'une RPC `RETURNS jsonb`, type `Json` donc inaccessible par propriete |
> | `nullableArg` (idem) | passer `null` a un argument de RPC que le generateur declare non-nullable (un `p_x text` SQL accepte NULL) |
> | `triggerFilled` (`lib/supabase/tables.ts`) | insert dans une table dont une colonne est posee par un trigger BEFORE INSERT : `poi_france.geom` et `panneaux_affichage.geom` via `auto_set_geom()` |
>
> `TableRow`/`TableInsert`/`TableUpdate<'table'>` remplacent toute redeclaration
> manuelle de la forme d'une ligne.
>
> Les colonnes `text` + CHECK (`profiles.role`, `dsp_connections.provider`…)
> sortent du generateur en `string` : les unions restent ecrites a la main et
> doivent etre resynchronisees avec la contrainte. `types/admin.ts#UserRole`
> est la reference pour les roles — TROIS
> (`super_admin`, `admin`, `client`) depuis le retrait d'`editor` le 2026-09-10 —
> et `lib/auth/roles.ts` les verrouille par `satisfies Record<UserRole, _>`,
> tout en fournissant les schemas Zod (`RoleSchema`, `RoleMembreSchema`) que
> les routes utilisent au lieu de recopier la liste.

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
