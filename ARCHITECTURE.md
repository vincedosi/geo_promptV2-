# ARCHITECTURE — MAGELIAN

> Derniere mise a jour : 2026-09-08 (suppression de l'overlay Pilotage ML et de tout ce
> qui n'etait atteignable que par lui — voir ci-dessous)
> Regle structurelle : tout passe par /map et ses overlays (mediaplanner) ; le panneau Reglages = back office admin.
> Deep-link overlay campagne : `/map?campaign=<id>&tab=<strategie|suivi|apercu>` (ignore si `?overlay=` present).
> Tache 9 (2026-09-12) : onglets de l'overlay MAGELIAN renommes — Programmer -> Strategie,
> Suivi campagne -> Suivi (Apercu inchange ; l'onglet Activation n'existe pas encore, Phase 2).
> Deep-link `tab=` : `creation` -> `strategie` — `creation` reste un ALIAS HERITE (round de
> correction 1) : un ancien lien `tab=creation` ouvre toujours l'onglet Stratégie, jamais
> Suivi par defaut. Le traiter comme une simple valeur invalide perdait silencieusement les
> campagnes coquilles/brouillons (non consultables sur Suivi) derriere un tel lien. Campagne
> active exposee globalement par `MagelianOverlayContext` (id/nom/annonceur, derivee par la
> fonction pure `deriveCampagneActive` de `lib/campaigns/campagne-active.ts`), affichee dans
> `MapTopBar` (bascule Campagne/Carte au centre, raccourci `alt+c` deja declare en Tache 1)
> et dans `CampagneActiveCard` (carte flottante haut-gauche de la carte, aucune requete —
> derivee du contexte deja charge). Persiste a la fermeture de l'overlay. La bascule ferme
> TOUJOURS par le chemin anime (`requestClose` -> `handleClose`), meme depuis Alt+C ou la
> top bar ; l'overlay porte aussi un bouton "Carte" dans son en-tete (le bouton de la top bar
> est recouvert tant que l'overlay est ouvert, z-index superieur).
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
| Tuiles vectorielles | MVT servies par PostGIS (`ST_AsMVT`). PMTiles conserve pour les carreaux uniquement — les IRIS sont passes en MVT le 2026-09-11 | 4.4.0 |
| LLM / Copilote | Vercel AI SDK + Gemini 2.5 Flash / Mistral Small | ai ^6.0 |
| Fonds de carte | OpenFreeMap (Liberty / Positron / Bright) + MAGELIAN dark style | — |
| Isochrones | OpenRouteService (ORS) REST API | — |
| Meteo | Open-Meteo API (temperature, precipitation, ensoleillement) | — |
| Inference ML bidding | **Modal** (serverless Python, HTTPS) — `-predict` / `-train` / `-detect-drift` | — |
| Jobs asynchrones | Inngest (serverless queue) | ^3.52 |
| Rate limiting | Upstash Redis | ^2.0 |
| PDF export | @react-pdf/renderer — **plus installe** : retire en dommage collateral de la suppression du clustering (commit 7192c68), son seul consommateur. A reinstaller le jour ou le rapport PDF est restaure (docs/PLAN_CLUSTERING.md) | — |
| Lecture tableurs | exceljs (.xlsx/.xlsm) + lecteur .ods maison (jszip) | ^4.4 |
| Graphiques | Recharts | ^3.8 |
| Styles | Tailwind CSS + Design System MAGELIAN (dark minimal) | ^3.4 |
| Fonts | Inter (UI) + JetBrains Mono (donnees/code) | — |
| Validation | Zod | ^3.22 |
| Tests | Vitest | ^2.0 |
| Catalogue du code | knip (exports/fichiers morts, dependances inutilisees — `npm run catalogue`) | ^6.35 |
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
│   │   ├── _components/        # panneaux/ (Filtre/Calques/Analyse/Zones du rail),
│   │   │                       # IrisDetailPanel, ClusterPanel — FilterPanel.tsx
│   │   │                       # (l'ancien monolithe) supprime le 2026-09-12,
│   │   │                       # vide par les taches 2 a 7
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
│   │   │                       # la modification passe par l'onglet Strategie (wizard)
│   │   ├── CampaignSuivi.tsx   # Cockpit de suivi en vol (tuiles/alertes/graphes/tableau via suivi/*)
│   │   │                       # + reconciliation DSP ⇔ mesure + bilan + chat IA
│   │   ├── suivi/              # SuiviCockpit, SuiviCharts, SuiviTable, ReconciliationPanel
│   │   └── wizard/             # Etapes du wizard (PressureControl = slider pression ↔ CPM min/max)
│   ├── magelian/               # Overlay MAGELIAN (Strategie/Suivi/Apercu) + deep-link
│   │   ├── MagelianOverlay.tsx # Overlay plein ecran — onglets Strategie/Suivi/Apercu ; selecteur
│   │   │                       # de campagne reserve a Suivi/Apercu (donnees OU strategie)
│   │   ├── CreationHall.tsx    # Hall de l'onglet Strategie : nouvelle campagne, reprendre une
│   │   │                       # coquille (badge brouillon, suppression), modifier une lancee
│   │   ├── MagelianOverlayContext.tsx # open/request + campagneActive (id/nom/annonceur, globale,
│   │   │                       # persiste a la fermeture) + filtreActif (miroir de lib/carte/filtre.ts)
│   │   ├── CampagneActiveCard.tsx # Carte flottante haut-gauche de la carte : campagne active +
│   │   │                       # bouton Ouvrir, visible quand l'overlay est ferme, aucune requete
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

## Navigation de /map

> Refonte 2026-09-12 (`docs/superpowers/plans/2026-09-12-refonte-navigation-5-themes.md`).
> Remplace l'ancien `IconBar.tsx` et `FilterPanel.tsx` (2 118 lignes, six
> categories melangees sans hierarchie de lecture claire).

**Source unique : `lib/navigation/config.ts`.** Ids, libelles, icones lucide,
tooltips, type de panneau et raccourcis de CHAQUE entree du rail y sont
declares une seule fois (`ENTREES_NAVIGATION`) ; aucun composant ne redeclare
l'un de ces champs — verrouille par `tests/unit/navigation/config.test.ts`.
Le fichier fixe aussi `LARGEUR_RAIL` (76 px — 48 tronquait « Perimetre » a huit
caracteres) et `ECART_RAIL_PANNEAU` (8 px, entre le rail et le panneau qu'il
ouvre) : toute position calee sur le rail lit ces constantes, jamais un 48/56
en dur.

**Cinq themes** forment la chaine mentale de la carte, dans l'ordre exact de
`lib/navigation/config.ts:4-9` (« ou je regarde » -> « ce que je vois » ->
« ce que je calcule » -> « ce que je fabrique » -> « ce que j'active ») :
Filtre, Calques, Analyse, Zones, Campagne. **L'Assistant est a part** :
`type: 'tiroir-droit'`, pas un theme de cette chaine — un tiroir de
geo.prompt qui s'ouvre a cote, pas une etape dedans. Le rail complet expose
ces cinq themes plus Assistant, Reglages et Aide, soit huit entrees :

| Entree | Ouvre | Raccourci | Role |
|---|---|---|---|
| Filtre | panneau gauche | `Alt+1` | pose le filtre unique (voir plus bas) |
| Calques | panneau gauche | `Alt+2` | affiche des donnees, ne fabrique rien |
| Analyse | panneau gauche | `Alt+3` | lance un calcul (Voronoi, bataille, clustering, score composite) |
| Zones | panneau gauche | `Alt+4` | seul endroit qui fabrique une geometrie + une liste de CP |
| Campagne | overlay MAGELIAN plein ecran | `Alt+C` | active/pilote une campagne (accent teal, pastille d'alertes) |
| Assistant | tiroir a DROITE de la carte | `Ctrl+K` | geo.prompt, le copilote IA — a part de la chaine ci-dessus |
| Reglages, Aide | panneau gauche, en bas du rail | — | pas de raccourci, pas de tooltip |

Les quatre panneaux (Filtre/Calques/Analyse/Zones) vivent dans
`app/map/_components/panneaux/` (`PanneauFiltre.tsx`, `PanneauCalques.tsx`,
`PanneauAnalyse.tsx`, `PanneauZones.tsx`) et remplacent l'ancien
`FilterPanel.tsx` (**supprime**) — repris logique par logique, sans reecriture
du comportement metier de chaque outil.

### Trois regles structurelles

- **Un seul filtre actif** (`lib/carte/filtre.ts`) — poser un filtre remplace
  le precedent, re-poser le meme le retire. Il ne se contente PAS de masquer
  cote client : `lib/carte/bbox-requete.ts` ne fait partir une bbox vers une
  requete de couche QUE si un filtre est actif ; sans filtre, aucun parametre
  n'est envoye (comportement identique a avant la refonte). C'est le
  garde-fou direct contre le scan France entiere du 28/03 (CLAUDE.md
  « Incidents »). `lib/carte/filtre.ts` est **protege** par le contrat de la
  tache qui l'a ecrit : son propre repli sur `BBOX_METRO` reste reserve au cas
  d'un filtre POSE dont la bbox n'est pas encore resolue (region/departement/
  commune/CP) — different du cas « pas de filtre du tout » que gere
  `bbox-requete.ts`.
- **Un seul degrade de couleur a la fois** (`lib/carte/degrades.ts`, reducteur
  pur qui dit quoi eteindre sans rien eteindre lui-meme ; `lib/carte/
  calques-actifs.ts` l'enveloppe pour la bascule cochee/decochee et valide un
  `DegradeId` relu a la frontiere — localStorage, URL). Avant, jusqu'a sept
  choroplethes (carreaux, IRIS, indicateurs civiques, sante environnementale,
  meteo, impressions de campagne, score composite) pouvaient s'empiler sans
  qu'aucune legende ne dise laquelle on lisait. Le score composite (Tache 12,
  2026-09-13) a ete ajoute a CE registre plutot que peint a cote : c'est la
  seule chose qui l'empeche de s'empiler avec les six autres. Les valeurs
  connues sont declarees DEUX fois — l'union `DegradeId` et le tableau
  `DEGRADE_IDS` de `calques-actifs.ts` — et un type `UnionCouverte` fait
  echouer `tsc` si la seconde oublie un membre de la premiere : sans lui, un
  degrade ajoute serait REJETE en silence a la frontiere et ne se rallumerait
  jamais depuis l'URL ou localStorage.
- **Aucun calcul d'analyse sans perimetre** (`lib/carte/garde-perimetre.ts`) —
  bloque le lancement (Voronoi, bataille V1/V2, application de la bataille,
  clustering, score composite) tant qu'aucun `FiltreActif` n'est pose et
  qu'aucune zone n'est selectionnee. Meme famille d'incident que le filtre unique (28/03 et 08/04).
  Le cablage reel sur les six outils est verrouille par
  `tests/unit/carte/panneau-analyse-garde.test.ts`, qui lit le SOURCE de
  `PanneauAnalyse.tsx` plutot que de simuler son comportement — une premiere
  version avait ecrit la garde correctement dans un test isole, tout en
  laissant une prop reelle cablee SANS garde en production ; seul un test qui
  lit le composant reel attrape ce genre d'ecart.

### Pile Echap et garde de saisie

`lib/carte/pile-echap.ts` remplace quatre listeners `keydown` concurrents qui
ecoutaient tous `Escape` sans ordre garanti : desormais, dernier ouvert =
premier ferme. Re-empiler un id DEJA present met a jour sa fonction de
fermeture sans changer sa position (seul un id NOUVEAU part au sommet) — sinon
un composant qui se re-rend a chaque jeton de streaming (l'Assistant) repousse
son entree au sommet en continu et Echap ferme la mauvaise chose.

`lib/navigation/garde-saisie.ts` fait qu'un raccourci a modificateur
(`Ctrl`/`Alt`, seuls modificateurs de `entreeParRaccourci`) ne s'active jamais
pendant une saisie (INPUT/TEXTAREA/contentEditable) — sauf `Echap`, jamais
filtree puisque c'est justement la touche qui ferme ce qu'on est en train de
remplir.

### Trois decisions parquees

- Le verrou `tests/unit/carte/pile-echap-usage.test.ts` lit le **tableau de
  dependances** de chaque `useEffect` qui appelle `empiler(`, jamais
  l'**argument** passe a `empiler(` : un callback brut non stabilise (au lieu
  d'un wrapper `useCallback` a deps vides + ref) pourrait etre reintroduit
  sans faire rougir ce test. La protection reelle contre le defaut vecu trois
  fois pendant ce chantier reste la revue de code sur ce point precis.
- `components/map/ClusteringResultsContent.tsx` monte `ClusterPanel` **sans
  relayer** la garde de perimetre, et n'est importe nulle part dans le code
  vivant — laisse en place volontairement plutot que supprime a l'aveugle. La
  tache 23 (passe `knip`, detection de code mort avec preuves) le fera
  remonter.
- L'overlay Campagne (MAGELIAN) retombe toujours sur l'onglet Suivi a la
  reouverture, meme si l'onglet Strategie etait ouvert avant fermeture —
  comportement preexistant a cette refonte, que la spec ne demandait pas de
  changer (seule la persistance de la campagne active entre ouvertures etait
  exigee).

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
| `/api/map/pois` | GET | POI dans une zone avec filtres categorie. `bbox` optionnelle (Tache 4, `[west,south,east,north]`) : envoyee par la carte uniquement quand un filtre carte est actif (`lib/carte/bbox-requete.ts`) — absente, comportement inchange (scope/regions/depts/ville seuls decident) |
| `/api/map/categories` | GET | Categories POI distinctes |
| `/api/map/ooh` | POST | Panneaux OOH. `bbox` optionnelle (Tache 4), meme regle que `/api/map/pois` |
| `/api/map/transport` | GET | Donnees transport |
| `/api/map/poi-natures` | GET | Natures de POI |
| `/api/tiles/[z]/[x]/[y]` | GET | Tuiles MVT carreaux (gzip obligatoire). **Cascade `get_tile` calee sur la taille apparente des mailles** (une choroplethe se lit entre 10 et 40 px par carreau) : `z<=6` 20 km · `z7` 5 km · `z8` 2 km · `z9-11` **1 km** · `z>=12` 200 m (sql/129). Ne PAS redescendre le seuil du 200 m sans avoir d'abord donne des colonnes typees a `carreaux_filosofi` : ses 4,6 Go et son jsonb de 806 o/ligne imposent un plancher d'environ 4 s par tuile froide sur Nano. Chaque feature porte `superficie_km2` (sql/122), consomme par `lib/carreaux/normalisation.ts` pour rendre les indicateurs comparables entre paliers de zoom. **Tout changement du schema de tuile (colonnes ajoutees/retirees) impose de bumper `CARREAUX_TILE_VERSION` dans `lib/version.ts`** — sinon une tuile en cache (jusqu'a 1 h) reste servie avec l'ancien schema pendant que le front attend le nouveau. |

### Clustering POI x Filosofi (restaure le 2026-09-12)
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/poi-clusters` | GET | GeoJSON des POI colories par cluster (`?duration=`) |
| `/api/poi-clusters/run` | POST/GET | Lance un job (corps valide par Zod) / polling du statut. **Le moteur est un script Python lance en processus fils : il n'y a aucun runtime Python sur Vercel.** La route repond 503 explicite si le script est absent. Portage Modal : `docs/PLAN_CLUSTERING.md` |
| `/api/poi-clusters/models` | GET | Liste des modeles calcules |
| `/api/poi-clusters/models/[version]` | GET/DELETE | Detail d'un modele (resume par cluster + POI) / suppression |
| `/api/poi-clusters/models/[version]/analysis` | GET/DELETE | Analyse Gemini du modele |
| `/api/poi-clusters/models/[version]/generate-analysis` | POST | (Re)genere l'analyse Gemini |
| `/api/poi-clusters/[clusterId]` | GET | Detail d'un cluster |
| `/api/poi-clusters/poi/[poiId]` | GET | Clusters d'un POI, toutes durees |
| `/api/poi-clusters/history/[poiId]` | GET | Historique des assignations d'un POI |
| `/api/poi-clusters/count`, `/poi-types`, `/france-averages`, `/model` | GET | Comptages, types disponibles, moyennes France, modele courant |

> Les 13 routes sont protegees par `middleware.ts` (`/api/poi-clusters` dans
> `PROTECTED_API_PREFIXES` **et** `/api/poi-clusters/:path*` dans le matcher —
> les deux, sans quoi elles restent publiques).

### IRIS
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/iris/stats` | GET | Stats IRIS par colonne et niveau |
| `/api/iris/detail` | GET | Detail IRIS complet (toutes colonnes socio-demo + nom_commune) |
| `/api/iris/bornes` | GET | Bornes nationales log10 de l'echelle de couleurs IRIS, toutes colonnes (lit `iris_bornes_echelle`, cache CDN 24 h). Remplace l'appel par colonne a `/api/iris/stats`, qui balayait les 49 448 IRIS a chaque changement d'indicateur |

### Indicateurs civiques
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/civic-indicators/health/[code_insee]` | GET | Indice ATMO + pollen pour une commune (cache 24h, fallback stale 48h, ODbL Atmo France) |
| `/api/civic-indicators/health-map` | GET | Carte sante environnementale : `dataset=pollen\|atmo`, `scale=departement` (stream NDJSON 1 commune/dept, pollen ET air par ligne) ou `scale=cp` (lecture `pollen_map_daily`/`atmo_map_daily`, filtres `min_level` 0-6 + `metric` + `bbox` optionnelle, Tache 4 — resolue via la RPC `codes_postaux_dans_bbox`, PAS un filtre direct sur `ref_codes_postaux.centroid_lat/lon` qui sont NULL sur toutes les lignes) — layer CivicHealthMapLayer, section Sante environnementale |

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
| `/api/admin/qualite-donnees` | GET/POST | **Etat des donnees manquantes** (sql/149) : indicateurs du registre pointant vers du vide, fraicheur des sources a cadence attendue, invariants metier valides contre l'INSEE, remplissage colonne par colonne d'`iris`. Distincte de `/api/admin/health`, qui regarde l'INFRASTRUCTURE : celle-ci regarde le CONTENU. GET lit les releves PERSISTES (`qualite_releves`) sans rien recalculer ; POST relance **UNE** verification, jamais plusieurs — le balayage d'`iris` coute ~220 Mo et 1,4 s, et un bouton « tout verifier » serait l'incident du 28/03 rejoue par l'outil cense le prevenir. Quota `geo:rl:qualite-donnees` 6/min |
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
| `/api/custom-geo/source/intersection` | POST | **Ce que 2 a 20 zones ont en commun** (Tache 14, sql/151) : la premiere zone intersectee avec l'UNION des autres — et non une reduction deux a deux, qui repondrait a une autre question. Repond **409** sur une intersection vide plutot que de creer une zone a zero code postal, qui partirait ensuite au DSP. `checkZoneAccess` par lots de 3 |
| `/api/custom-geo/source/difference` | POST | **Une zone moins d'autres** (Tache 14, sql/151). `zone_base` et `zones_retirees` sont deux champs distincts et non une liste : l'operation n'est PAS symetrique, et rien dans le resultat ne dirait qu'on s'est trompe d'ordre. 409 si rien ne reste |
| `/api/custom-geo/media-plan` | GET/POST/DELETE | Rattachement du plan media a une campagne DSP — persiste budget/CPM/cible/poids dans `dsp_campaigns.geo_strategy.media_plan` (sous-cle namespacee, scope org) |

### Analyses enregistrees (Tache 11, 2026-09-12)
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/analyses` | GET/POST | GET : liste des analyses de l'org (`?type=`, bornee a 50, `idx_analyses_org_date`). POST : enregistre un lancement (nom, parametres complets, maillage, perimetre) |
| `/api/analyses/[id]` | GET/DELETE | Detail complet (avec `parametres`/`perimetre`/`resultat`) / suppression, scopes org |
| `/api/analyses/[id]/rejouer` | POST | Rend de quoi RELANCER une analyse : type, parametres, maillage, perimetre, et l'appel a faire quand le moteur est cable (`score` -> POST `/api/analyses/score`, `correlation` -> GET `/api/analyses/correlation` ; les quatre autres rendent `cable: false`). **N'ECRIT RIEN** depuis le 2026-09-13 : la premiere version inserait une ligne `en_cours` qu'aucun moteur ne reprenait, sans trigger ni delai d'expiration et sans UI de suppression — un fantome eternel par rejeu, double d'un « termine » des que le vrai calcul tournait. La ligne est ecrite par le moteur qui calcule, au moment ou il calcule |
| `/api/analyses/score` | POST | **Score composite** (Tache 12, sql/146) : plusieurs indicateurs de `cible_indicator_registry` normalises 0-100 sur le perimetre puis ponderes, un score par code postal. Perimetre OBLIGATOIRE sous l'une de trois formes (`codes_postaux`, `perimetre` d'un `FiltreActif`, `bbox`), plafonne a 3000 CP. Materialise a la demande tout indicateur ABSENT d'`indicator_cp_values` (sequentiellement — jamais en parallele), et rend la date de calcul de chacun. Enregistre le lancement dans `analyses` (type `score`). Quota `geo:rl:analyse-score` 12/min |
| `/api/analyses/correlation` | GET | **Correlation impressions x indicateur** (Tache 13, sql/147) : `?campaignId=&variable=`. Apparie les impressions livrees par CP (`campaign_cp_rollup`, DEJA agrege — jamais `dsp_campaign_data`) avec un indicateur INSEE, et rend le coefficient de Pearson, `n`, les points du nuage et la COUVERTURE (CP apparies / CP touches par la campagne). La couverture n'est pas decorative : la jointure est interne, et `rev_median` ne couvre que 1221 des 2041 CP d'une campagne reelle — 40 % ecartes en silence sans elle. Scope org par `checkCampaignAccess`. Quota `geo:rl:analyse-correlation` 12/min |
| `/api/custom-geo/source/score` | POST | Geometrie des CP dont le score composite depasse un seuil — route soeur d'`indicator-threshold`, qui elle ne sait selectionner que sur UN indicateur et ne peut donc PAS exprimer « score composite >= 60 ». Recalcule le score cote serveur (jamais une liste de CP remontee par le client), plafond 1500 CP. Le client sauvegarde ensuite par `/api/custom-geo/save` (`source_type: 'score_composite'`) |

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
| `indicator_cp_materializations` | Journal des materialisations d'`indicator_cp_values` : une ligne par indicateur, avec le NOMBRE de lignes ecrites (zero compris) et la date de la donnee pour les sources quotidiennes | sql/148 (2026-09-13). Existe parce que la PRESENCE de valeurs ne dit pas qu'on a deja calcule : `materialize_indicator_cp_values` peut ecrire ZERO ligne — `part_couples_enfants` pointe sur une colonne vide sur les 49 448 IRIS tout en etant active au registre — et un appelant qui teste la presence rematerialisait alors a CHAQUE lancement, soit un seq scan complet d'`iris` (~173 Mo, 1,3 s) sur un Nano a 5 Mo/s. RLS deny-all |
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
| `iris_agg_departement` | Palier departement de la cascade IRIS (104) — sert z4-z6 | Geometrie stockee en **3857** simplifiee a 400 m, `superficie_km2` = SOMME des IRIS du groupe. Construite par `construire_iris_agg` (sql/138, **corrigee sql/153**). Population EXACTE depuis ce correctif : le filtre `centroid_lat IS NOT NULL` etait dans le `WHERE` et excluait donc des LIGNES entieres — or 85 IRIS n'ont aucune geometrie (`geom` et `geom_3857` NULL) tout en portant **91 189 habitants sur 38 departements**. Les deux paliers sous-declaraient la population de la France de 0,13 %, et la carte avec eux de z4 a z8. Le filtre porte desormais sur le seul calcul de SURFACE, seul a avoir besoin du centroide — la geometrie du palier vient de `ref_departements`, jamais des IRIS |
| `iris_agg_commune` | Palier commune de la cascade IRIS (34 921) — sert z7-z8 | Idem, simplifiee a 100 m. **82 IRIS y sont absents** (80 253 habitants, 68 communes absentes de `ref_communes`) : la jointure du palier les perd, et c'est structurel. Mesure du 2026-09-13 — la version precedente de cette ligne annoncait « 0,12 % de la population » sans la chiffrer, et affirmait qu'ils etaient « presents aux deux autres paliers », ce qui etait FAUX pour le palier departement (voir ci-dessous). L'invariant « palier vs IRIS » de `/admin/qualite-donnees` mesure cet ecart en continu |
| `clustering_models` | Modeles k-means POI x Filosofi (scaler + PCA + centroides, assez complet pour rejouer une prediction avec numpy seul). `profil_palier` = palier de la matrice d'entrainement | Restauree le 2026-09-12 (sql/141). RLS deny-all |
| `poi_clusters` | Un enregistrement par POI x duree x mode. `profil_palier` dit quel palier de carreaux a produit le profil ('200m' ou '2km') — deux modeles de paliers differents ne se comparent pas terme a terme sur les effectifs (sql/143) | `imputed_features` distingue une valeur reconstituee d'une valeur mesuree. RLS deny-all |
| `poi_cluster_history` | Historique des assignations, avec le cluster precedent dans le numbering de l'ANCIEN modele | RLS deny-all |
| `clustering_jobs` | Suivi des jobs lances depuis l'UI (pending -> running -> done/failed) | `log_tail` porte la sortie tronquee du script. RLS deny-all |
| `iris_bornes_echelle` | Bornes nationales log10 de l'echelle IRIS, par colonne (37 lignes) | min = p05 du palier departement, max = p99,9 (effectif/densite) ou p95 (proportion) du palier IRIS. Reconstruire avec `construire_iris_bornes()` (sql/140) apres tout import |
| `iris_metadata` | Metadonnees IRIS | |
| `communes_arrondissements` | Correspondance arrondissement -> commune mere (45 lignes : Paris 20, Lyon 9, Marseille 16) | Seedee par derivation des codes presents dans `iris_agg_commune`, pas par une liste tapee. Existe parce que `iris_agg_commune` ne contient QUE les arrondissements : les codes 75056 / 69123 / 13055 en sont absents, donc aucun double comptage mais Paris, Lyon et Marseille n'apparaissent jamais entieres. RLS deny-all (sql/150). Relue par `lib/chat/tools/classementTerritoires.ts` pour reconstituer un centroide (moyenne ponderee par population des IRIS d'arrondissement) permettant le clic-carte sur ces 3 villes dans l'outil `classement_territoires` |
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

### Analyses enregistrees
| Table | Description | Notes |
|-------|-------------|-------|
| `analyses` | Une analyse lancee (clusters/score/battle/voronoi/correlation/elm) devenue un objet rejouable : nom, `parametres` complets (cle de rejeu via `cleParametres`, `lib/analyses/types.ts`), `maillage`, `perimetre`, `resultat` leger, `statut` | sql/145 (2026-09-12). `type`/`statut` sont `text` + `CHECK` — le generateur sort `string`, les unions TS vivent dans `lib/analyses/types.ts` et doivent rester synchronisees a la main avec la contrainte. Index `idx_analyses_org_date` (org_id, created_at DESC) et `idx_analyses_type` (org_id, type). RLS deny-all, routes en `service_role`. Auparavant, seul le clustering laissait une trace (`clustering_models`/`clustering_jobs`) ; battles/voronois/isochrones n'en laissaient aucune |

### Support
| Table | Description | Notes |
|-------|-------------|-------|
| `saved_maps` | Etats carte sauvegardes (user_id) | |
| `data_registry` | Registre donnees pour routeur multi-agents | |
| `calculation_jobs` | Jobs de calcul couverture | |
| `filosofi_national_averages` | Moyennes nationales Filosofi | |
| `smart_prompt_feedback` | Feedback prompts IA (user_id) | |
| `smart_ville_stats` | Stats villes | |
| `qualite_releves` | Dernier releve de chaque verification de qualite des donnees | sql/149 (2026-09-13). Rouvrir `/admin/qualite-donnees` lit CETTE table, jamais les tables sources. RLS deny-all |
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
| `get_iris_tile` | Tuile MVT IRIS (sql/139) — **cascade** departement (z4-z6) / commune (z7-z8) / IRIS (z>=9), colonnes decouvertes dynamiquement, chaque feature porte `niveau` et `superficie_km2` | `api/tiles/iris/` |
| `classe_iris` | Classe d'un indicateur IRIS (effectif / densite / proportion), DERIVEE du nom (sql/138). Source unique : agregation, bornes et front en dependent | `construire_iris_agg`, `construire_iris_bornes` |
| `construire_iris_agg` | (Re)construit un palier agrege de la cascade IRIS | outil de construction, sql/138 |
| `construire_iris_bornes` | (Re)calcule les bornes nationales de l'echelle IRIS | outil de construction, sql/140 |
| `classer_territoires` | Classe les territoires d'un palier (commune / departement) sur N'IMPORTE QUEL indicateur numerique, en volume ou en part, avec plancher de population et regroupement optionnel des arrondissements. La colonne est decouverte dans `information_schema` — seule barriere contre l'injection par nom de colonne — et l'agregation est deleguee a `classe_iris` : effectif=somme, proportion=moyenne ponderee par la population, densite=recalculee sur les surfaces. La colonne `part` ne vaut que pour un effectif (sql/150) | `lib/chat/tools/classementTerritoires.ts` (outil copilote `classement_territoires`, branche le 2026-09-12) |
| `fill_carreaux_1km_bande` | Agrege les carreaux 200 m en mailles 1 km, par bande verticale (progression + journal anti-rejeu) | outil de construction, sql/129 |
| `import_carreaux_batch` | Upsert batch carreaux | `api/admin/import-geo/` |
| `populate_carreaux_columns` | Colonnes derivees post-import | `lib/inngest/functions/` |

### IRIS
| RPC | Description | Appelee depuis |
|-----|-------------|----------------|
| `get_iris_stats_by_bbox` | Stats IRIS par bbox | `api/iris/stats/` |
| `get_iris_dept_stats` | Stats IRIS departementales | `api/iris/stats/` |
| `get_iris_metric_columns` | Colonnes metriques dynamiques | `api/admin/sync-iris-system/`, `lib/chat/tools/indicateursTerritoires.ts` (catalogue d'indicateurs de l'outil `classement_territoires`, cache 5 min) |
| `get_iris_fill_status` | Taux de remplissage IRIS | `api/admin/iris/` |
| `get_iris_iris_residual_inputs` | Inputs residus correlation | *orpheline* — `api/correlation/compute/` n'existe pas dans le code, aucun appelant |
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
| `materialiser_indicateur_cp` | Enveloppe instrumentee de `materialize_indicator_cp_values` : journalise le nombre de lignes ecrites et la date de la donnee (pollen/atmo) | `lib/analyses/indicateurs.ts` (sql/148) |
| `etat_indicateur_cp` | Dit si un indicateur est calculable, deja calcule, VIDE ou perime — sans rien recalculer. `perime` ne vaut true que pour les sources quotidiennes `pollen`/`atmo`, dont `indicator_cp_values` fige le `max(date_ech)` du jour de la materialisation | `lib/analyses/indicateurs.ts` (sql/148) |
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
| `zone_intersection` | Intersection de zones custom, `ST_MakeValid` avant toute operation (une geometrie capturee depuis des carreaux ou isochrones peut etre invalide, et `ST_Intersection` LEVE dessus). Rend `vide: true` explicite, jamais NULL | `api/custom-geo/source/intersection/` (sql/151) |
| `zone_difference` | Zone de base moins l'union des zones retirees, memes garanties | `api/custom-geo/source/difference/` (sql/151) |
| `get_national_population_totals` | Totaux France par tranche d'age (carreaux_5km, sql/087) | `api/custom-geo/national-totals/` |

### Referentiels
| RPC | Description | Appelee depuis |
|-----|-------------|----------------|
| `build_ref_codes_postaux` | Construction ref CP | `api/admin/import-laposte/` |
| `truncate_laposte_hexasmal` | Reset ref La Poste | `api/admin/import-laposte/` |
| `update_laposte_centroids` | Centroides CP | `api/admin/import-laposte/` |
| `calculer_score_composite` | Score composite 0-100 par code postal : N indicateurs d'`indicator_cp_values` normalises min-max SUR LE PERIMETRE demande (jamais la France — budget I/O Nano), puis ponderes. Rend aussi `n_indicateurs`, sans quoi un score porte par un seul indicateur serait indiscernable d'un score complet — ce n'est pas theorique, `rev_median` ne couvre que 1952 des 6186 CP. Jumeau TypeScript teste : `lib/analyses/score.ts` (memes poids, meme arrondi). Mesure : 23,5 ms sur 500 CP | `api/analyses/score/`, `api/custom-geo/source/score/` (sql/146) |
| `correlation_campagne_indicateur` | Impressions par CP (SOMMEES sur les acteurs) appariees a un indicateur INSEE. La somme est obligatoire : la PK de `campaign_cp_rollup` est (campaign_id, postal_code, ACTEUR), donc un CP y apparait jusqu'a 5 fois — 10 205 lignes pour 2 041 CP sur une campagne reelle. **`RETURNS jsonb` et non `TABLE` (sql/154)** : PostgREST tronque a 5 000 lignes AUSSI les RPC `RETURNS TABLE` — mesure, `codes_postaux_dans_bbox` rend 5 000 lignes pour 6 051 reelles, sans erreur. Une campagne nationale de plus de 5 000 CP aurait vu son coefficient calcule sur la moitie nord-est de la France, avec un `n` faux et rien pour le dire | `api/analyses/correlation/` (sql/147, sql/154) |
| `compte_cp_campagne` | Nombre de codes postaux DISTINCTS touches par une campagne. Existe parce que supabase-js ne sait pas faire un `COUNT(DISTINCT)` : un `count: 'exact'` compterait une ligne par acteur et annoncerait 5x trop. Separee de la RPC d'appariement pour repondre AUSSI quand zero CP s'apparie — le cas ou ce chiffre compte le plus | `api/analyses/correlation/` (sql/147) |
| `codes_postaux_du_perimetre` | Codes postaux d'un `FiltreActif` (region/departement/commune/CP/zone). Existe parce qu'un filtre ne porte de bbox resolue QUE pour une zone enregistree : `bboxDuFiltre` repliait sinon sur `BBOX_METRO`, soit les 6187 CP de France. Branches SEPAREES et non un `CASE` dans le `WHERE` — le CASE rendait `idx_ref_cp_dept` inutilisable (835 ms -> 6,5 ms). Le palier commune passe par `communes_arrondissements`, sans quoi Marseille/Paris/Lyon rendaient ZERO CP | `api/analyses/score/` (sql/146) |
| `codes_postaux_dans_bbox` | Codes postaux dont le centroide (`ref_codes_postaux.centroid`, geometry GIST) tombe dans une bbox (sql/144). `centroid_lat`/`centroid_lon` sont NULL sur les 6187 lignes — seule cette RPC (PostGIS `&&`/`ST_MakeEnvelope`) donne un resultat correct | `api/civic-indicators/health-map/` (scale=cp, Tache 4) |

### Admin & Monitoring
| RPC | Description | Appelee depuis |
|-----|-------------|----------------|
| `get_table_sizes` | Taille tables (monitoring) | `api/admin/health/` |
| `qualite_colonnes_iris` | Remplissage de CHAQUE colonne numerique d'`iris` en UN SEUL balayage (~220 Mo, 1,4 s). Se distingue de `get_iris_fill_status`, qui fait un COUNT par colonne (~40 balayages, ~8,8 Go) et confond une colonne vide avec une colonne pleine de zeros | `api/admin/qualite-donnees/` (sql/149) |
| `qualite_indicateurs` | Quels indicateurs ACTIFS du registre pointent vers une colonne vide, partielle ou absente. La verification la plus rentable du lot : elle aurait attrape `part_couples_enfants` (0 renseigne sur 49 448 IRIS, actif donc propose a l'utilisateur) avant qu'un score ne soit calcule dessus | `api/admin/qualite-donnees/` (sql/149) |
| `qualite_fraicheur` | Age de chaque source a cadence attendue. Le champ `alimentation` evite LE contresens : une table figee alimentee par un cron signale un cron qui ne tourne pas, pas une donnee absente a la source | `api/admin/qualite-donnees/` (sql/149) |
| `qualite_invariants` | Invariants metier chiffres (population 67 760 552, proprietaires 58,60 %, logements sociaux 14,97 %, revenu median 23 097 EUR, somme des tranches d'age = population). Seule famille qui detecte une donnee FAUSSE, par opposition a absente, partielle ou perimee | `api/admin/qualite-donnees/` (sql/149) |
| `count_poi_by_categorie_source` | Compte POI par categorie/source | `api/admin/import-datagouv/` |
| `get_sources_stats` | Stats sources de donnees | `api/admin/sources-stats/` |
| `get_poi_categories` | Categories POI | `api/admin/poi-categories/` |
| `get_active_data_registry` | Registre donnees actif | `api/` |
| `get_check_constraint_values` | Valeurs contraintes CHECK | `api/` |
| `drop_carreaux_table` | DROP table carreaux dynamique | `api/admin/sources/[id]/` |
| `log_smart_prompt_feedback` | Log feedback prompt IA | `api/smart-prompt/` |
| `consommer_quota` | Consomme une unite de quota et dit si l'appel passe (sql/135) | `lib/api/rate-limit.ts` — tous les limiteurs |
| `compute_filosofi_profiles_batch_2km` | **Profilage Filosofi par defaut depuis le 2026-09-12.** Variante sur `carreaux_2km` (colonnes typees, sans jsonb) — **7,8x plus rapide** (19 818 ms -> 2 543 ms pour 5 POI) et 6x moins de lectures disque. Les 16 variables du modele derivent de moins de 3,5 % ; seule `population_totale` derive de 11,8 %, et elle n'entre PAS dans le modele. Mesure sur le meme calcul (95 CIRFA) : profilage ~6 min -> 6,5 s, K 7 -> 4. Le 200 m reste joignable par `--palier 200m`. Voir docs/PLAN_CLUSTERING.md (sql/142, sql/143) | `scripts/clustering_poi_filosofi.py` |
| `compute_filosofi_profiles_batch` | Profil sociodemographique Filosofi d'un lot de POI, par intersection avec leur isochrone. **~4 s par POI** : joint `carreaux_filosofi` (2,3 M lignes) et extrait 26 champs d'un jsonb par carreau | `scripts/clustering_poi_filosofi.py` |
| `compte_poi_par_categorie` | Comptage des POI par categorie dans une ville ou une region, en UNE requete groupee (sql/136). `p_champ` limite a 'ville'/'region' | `lib/chat/tools/analyseComplete.ts` |
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

### IRIS : tuiles MVT servies par Postgres (depuis le 2026-09-11)

**Les PMTiles n'ont jamais atteint la production.** Le fichier de 361 Mo etait
exclu par `.vercelignore` ET `.gitignore` ; en production, `/iris_france.pmtiles`
rendait la page 404 de Next (`<!DOCTYP` au lieu de `PMTiles`). La GitHub Release
censee le porter renvoie 404 en anonyme : le depot est prive. La couche ne
s'affichait que sur le poste du developpeur, sans erreur — MapLibre echoue en
silence sur une source vide.

- Route : `/api/tiles/iris/{z}/{x}/{y}` → RPC `get_iris_tile` (sql/137).
  Placee sous `/api/tiles/` a dessein : le matcher de `middleware.ts` raisonne
  par SEGMENT, donc `/api/iris/:path*` ne couvrirait pas `/api/iris-tiles`.
  Ce placement la protege sans toucher a un fichier protege.
- **CASCADE d'agregation** (sql/138-139), meme strategie que les carreaux :

  | zoom | palier servi | mailles | taille apparente |
  |---|---|---|---|
  | z4-z6  | `iris_agg_departement` | 104    | 23 a 91 px |
  | z7-z8  | `iris_agg_commune`     | 34 921 | 11 a 22 px |
  | z >= 9 | `iris`                 | 49 448 | 31 px a z9 |

  Sous z4, aucune tuile n'est servie. Plancher defini UNE seule fois :
  `IRIS_ZOOM_PLANCHER` dans `lib/version.ts`, lu par la route, la source
  MapLibre, les trois couches et le panneau.

  Poids mesure (octets bruts avant gzip, 2026-09-12) : **la France entiere
  tient dans une tuile de 101 kB** a z4. z7 Paris 783 kB (le pire), z9 Paris
  827 kB. Plan PostGIS du palier commune : Bitmap Index Scan, 54,9 ms,
  **zero lecture disque**.

  Pourquoi agreger plutot que baisser le plancher sur les IRIS bruts : une
  tuile z8 parisienne couvre 4 251 IRIS et la France tient en ~75 tuiles z8 —
  l'incident du 28/03 rejoue. Les geometries administratives existaient deja
  (`ref_departements`, `ref_communes`), donc aucun `ST_Union`.

- **Regle d'agregation, source unique : `classe_iris()`** (sql/138). Derivee du
  NOM, jamais une liste en dur — les colonnes d'`iris` sont dynamiques.
  - `effectif` (population, pop_*, nb_*) -> SOMME, puis rapporte au km2 a l'affichage
  - `densite` (densite_*) -> RECALCULEE depuis les sommes (moyenner des
    densites de mailles inegales est faux)
  - `proportion` (part_*, taux_*, indice_*, rev_*) -> MOYENNE PONDEREE par la
    population, sur les seules lignes renseignees

  Valide contre l'INSEE : population 67 760 552 · proprietaires 58,60 % ·
  logements sociaux 14,97 % · revenu median 23 097 EUR. Et par departement :
  Paris 105 km2 / 20 066 hab/km2 / 32,8 % · Cantal 25 hab/km2 · Guyane 3,4.

- **Echelle de couleurs : log10 de la valeur NORMALISEE**, bornes nationales
  dans `iris_bornes_echelle` (sql/140), servies par `/api/iris/bornes`.
  Elles vivent EN BASE et non dans un fichier TypeScript comme
  `lib/carreaux/bornes.ts` : les colonnes d'`iris` sont dynamiques, une table
  statique serait fausse au prochain import, en silence. 37 colonnes bornees ;
  les 4 restantes (`nb_emplois`, `nb_emplois_commune`,
  `part_couples_avec_enfants`, `part_menages_emmenages_2ans`) sont ENTIEREMENT
  VIDES en base et le panneau les propose pourtant.

  Effet de bord voulu : la couche n'appelle plus `/api/iris/stats`, qui faisait
  un `percentile_cont` sur 49 448 lignes PAR COLONNE consultee. Cette route n'a
  plus AUCUN appelant — a trancher.

- **Chaque feature porte `niveau`** ('departement' | 'commune' | 'iris'). Le
  filtre « vrais IRIS uniquement » porte sur `is_true_iris`, qui n'existe qu'au
  palier IRIS : sans `niveau`, il viderait la carte des qu'on s'eloigne. Et le
  panneau annonce le palier affiche — une valeur departementale presentee comme
  un IRIS est un mensonge silencieux. `niveauAuZoom()` applique `Math.floor`,
  car MapLibre demande la tuile `floor(zoom)` : sans ce plancher, le panneau se
  trompait de palier sur tout le demi-cran superieur de chaque tranche.

- **Sous le minzoom d'une source, MapLibre ne demande AUCUNE tuile** et n'emet
  aucune erreur. C'est ce qui rendait la couche muette quand le plancher etait
  a z9 et la carte a z5,5. Deux garde-fous subsistent : `setIrisVisible` remonte
  la camera au plancher a l'activation, et `IrisSection` affiche un bandeau
  quand la couche est active en dessous.

- **« Vrais IRIS uniquement » est DECOCHE par defaut.** `is_true_iris = true`
  sert l'analyse statistique, jamais l'affichage (regle `CLAUDE.md`) : le defaut
  inverse masquait toute la France rurale, ou l'IRIS est la commune entiere.

- A rejouer apres tout import IRIS, dans cet ordre :
  `construire_iris_agg('departement')`, `construire_iris_agg('commune')`,
  puis `construire_iris_bornes()`.

- Deux paliers : `geom_z7` sous z12, `geom_3857` au-dessus. `geom_z10` n'est PAS
  utilisee — mesure : elle conserve 98,8 % des points de l'originale.
- La tuile porte toutes les colonnes numeriques et booleennes d'`iris`,
  DECOUVERTES dans `information_schema` (les colonnes sont dynamiques), plus un
  `superficie_km2` calcule qui permet la 3D avec la meme expression que les
  carreaux.
- `is_true_iris` est EMISE mais jamais filtree cote serveur : sur une tuile z10
  de France rurale, 50 IRIS presents et ZERO avec ce drapeau.
- Bumper `IRIS_TILE_VERSION` (`lib/version.ts`) a tout changement de schema de
  tuile — sinon une tuile en cache (jusqu'a 1 semaine au CDN) reste servie.

Le workflow `generate-iris-pmtiles` et son bouton d'administration restent en
place mais n'alimentent plus rien : a trancher (voir `docs/AUDIT_IRIS_TERRAIN.md`).

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
npm run catalogue        # Regenere docs/CATALOGUE_CODE.md (knip — exports/fichiers morts, deps inutilisees)
npx supabase db push     # Appliquer migrations
npx supabase gen types typescript --project-id vkkdbygwbrxyogqosten > types/database.types.ts
```

---

*MAGELIAN — Geospatial intelligence*
