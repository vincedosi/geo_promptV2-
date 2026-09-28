# ARCHITECTURE — MAGELIAN

> Derniere mise a jour : **2026-09-22** (remesure des chiffres que ce document
> presente comme mesures : routes API, scripts du stack local, variables
> d'environnement — voir les paragraphes dates du 22 plus bas).
>
> ⚠ **Cette ligne annoncait « 2026-09-08 » jusqu'a cette date**, alors que le
> corps du document decrivait des chantiers du 2026-09-21 — quatorze jours
> d'ecart. Elle ne se contentait pas d'etre inexacte : c'est la premiere ligne
> que lit quelqu'un qui cherche a savoir s'il peut faire confiance au reste, et
> elle repondait non a tort. Chaque section porte desormais sa propre date de
> mesure ; celle-ci ne dit que la derniere passe de verification d'ensemble.
>
> Entree du 2026-09-08 (conservee, c'est elle que cette ligne portait) :
> suppression de l'overlay Pilotage ML et de tout ce qui n'etait atteignable
> que par lui — voir ci-dessous.
> Regle structurelle : tout passe par /map et ses overlays (mediaplanner) ; le panneau Reglages = back office admin.
> Deep-link overlay campagne : `/map?campaign=<id>&tab=<strategie|activation|suivi|apercu>` (ignore si `?overlay=` present).
> Tache 9 (2026-09-12) : onglets de l'overlay MAGELIAN renommes — Programmer -> Strategie,
> Suivi campagne -> Suivi (Apercu inchange ; onglet Activation ajoute le 2026-09-13, Tache 20).
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

> **Suppression de l'ancien ecran de suivi (Tache 16, 2026-09-15, branche
> `feat/suivi-v2`).** L'onglet Suivi de l'overlay MAGELIAN affiche desormais
> **uniquement** `SuiviV2` (`components/campagne/suivi-v2/`) — le montage lui-meme
> datait deja de la Tache 15, cette tache retire ce qui ne servait plus qu'a
> comparer les deux ecrans. Supprimes : `components/campaign/CampaignSuivi.tsx`,
> et dans `components/campaign/suivi/` : `SuiviCockpit.tsx`, `SuiviCharts.tsx`,
> `SuiviTable.tsx`, `ActorFilter.tsx`, `ActorPanel.tsx`, `SuiviDeriveMap.tsx`,
> `DeriveTable.tsx`, `MeshSelector.tsx` ; les routes
> `app/api/digital/[campaignId]/derive/map`, `.../derive/ranked` et
> `.../suivi/cps` (cette derniere hors de la liste initiale de la tache —
> trouvee orpheline par le meme grep, `SuiviTable.tsx` en etait le seul
> appelant) ; et `lib/campaigns/derive-metrics.ts` (+ son test). Aucun de ces
> fichiers n'avait plus d'appelant en dehors de cet ensemble — verifie par grep
> avant suppression. Le re-export `fmtInt`/`fmtCpm`/`fmtPct`/`toneColor` de
> `lib/campaigns/actor-metrics.ts` (depuis `suivi-metrics.ts`) est egalement
> retire : ses seuls consommateurs etaient dans cet ensemble supprime, et le
> laisser aurait introduit un export mort (detecte par `npm run catalogue`).
>
> **Trois fichiers du meme lot NE SONT PAS supprimes**, malgre le plan initial,
> parce qu'un grep de consommateurs a trouve un appelant reel et vivant :
> - `components/campaign/suivi/ReconciliationPanel.tsx` et
>   `lib/campaigns/reconciliation-metrics.ts` (+ son test) — reutilises TEL QUEL
>   par `components/campagne/suivi-v2/DetailTechnique.tsx` (bloc technique replie
>   du cockpit Suivi V2, reconciliation DSP ⇔ ad server). Ce n'est pas un doublon
>   temporaire de comparaison comme l'etait `CampaignSuivi.tsx` : c'est une
>   reutilisation deliberee et definitive, documentee dans l'en-tete de
>   `DetailTechnique.tsx` lui-meme (« props-driven, deja teste, pas de deuxieme
>   table reecrite pour le meme besoin »).
> - `app/map/_components/SuiviMapLayer.tsx` — toujours importe et monte par
>   `app/map/page.tsx`, et ses deux exports ont chacun leur consommateur
>   (attribution precisee le 2026-09-16, elle etait collective et donc
>   invérifiable) : le type `SuiviMapEventDetail` par `app/map/page.tsx` ET
>   `app/map/_components/panneaux/PanneauCalques.tsx` (groupe « Campagne
>   active » du panneau Calques), la fonction `legendePourMetrique` par
>   `components/map/LegendeCarte.tsx` — et par elle seule. L'en-tete de
>   `DiffusionMapLayer.tsx` (Tache 13B) indique que ce fichier « remplace
>   SuiviMapLayer.tsx dans l'intention, pas dans le code » et que sa suppression
>   reelle est reservee a la Tache 16 — mais l'y retirer proprement suppose de
>   toucher `app/map/page.tsx` (etat `campagneActive`/`campagneActiveRef`,
>   l'effet `SUIVI_MAP_STATUS_EVENT`, `handleFermerCampagneActive`, la branche
>   `'campagne-impressions'` de l'exclusivite des degrades), `PanneauCalques.tsx`,
>   `LegendeCarte.tsx`, et potentiellement le `DegradeId`
>   `'campagne-impressions'` de `lib/carte/degrades.ts` — fichier explicitement
>   marque « protege » par le contrat de la Tache 5 dans l'en-tete de
>   `lib/carte/calques-actifs.ts`. Ce perimetre depassait les fichiers annonces
>   par cette tache (`components/magelian/MagelianOverlay.tsx` + ce document) ;
>   et la regle appliquee ici est celle de `CLAUDE.md` § Methodologie (« pas de
>   modifs non demandees », « apres modif, grep pour confirmer que rien d'autre
>   n'est casse ») : un fichier qui a encore un consommateur vivant ne part pas
>   dans cette tache — on le dit et on le documente, plutot que de le supprimer
>   et de rattraper les degats au prochain build. *(Ce paragraphe invoquait
>   jusqu'au 2026-09-16 « la regle de cette meme tache », citee entre
>   guillemets ; la phrase ne figure ni dans `task-16-brief.md` ni dans le plan
>   du chantier — elle ne vivait que dans le rapport de l'agent executant. Une
>   justification qui renvoie a un document introuvable ne justifie rien.)*
>   Reste donc a faire, en tache separee et revue :
>   supprimer `SuiviMapLayer.tsx` et desactiver proprement le degrade
>   `'campagne-impressions'` cote page.tsx/PanneauCalques/LegendeCarte.
>
> **Les RPC `get_campaign_derive_map`, `get_campaign_derive_ranked`,
> `get_campaign_derive_headline` (sql/117-118) et `get_campaign_suivi_cps`
> (sql/109, elargie sql/113) ont ete SUPPRIMEES le 2026-09-19 — sql/202.**
>
> Ce paragraphe interdisait leur suppression jusqu'a cette date, et la raison
> etait juste : « La base de donnees Supabase est UNIQUE et partagee entre
> branches — les supprimer maintenant casserait l'ecran de suivi en production,
> en direct. » Elle a cesse de valoir le jour ou le projet Supabase heberge a
> ete abandonne : il n'y a plus de base partagee, plus de production en ligne,
> plus d'ecran deploye a casser.
>
> Les quatre conditions du § « Menage en base » ont ete verifiees une a une
> avant d'ecrire la migration : 0 appelant dans le code de cette branche,
> 0 appelant EN BASE (`pg_proc.prosrc` et `information_schema.views`), aucune
> dependance structurelle, et une definition presente dans une migration
> versionnee — c'est elle qui rend la suppression reversible par un simple
> `git show`.
>
> ⚠ **`origin/main` les appelle encore**, dans 6 fichiers. Tant que
> `feat/suivi-v2` n'est pas mergee, sortir `main` en local et ouvrir l'ecran de
> suivi rendra une erreur. Ce n'est plus un incident de production — il n'y en
> a plus — c'est une gene de poste de travail, et elle disparait au merge.

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

> ## ⛔ Modal n'est PAS branchable — audit du 2026-09-22
>
> **Decision : les enchheres par code postal restent produites par un
> GENERATEUR LOCAL. Ne pas appeler ce service.** Arbitrage de Vincent, sur
> l'audit ci-dessous.
>
> **Le blocage n'est pas la plomberie, c'est la DONNEE.** Le modele
> (`river.HoeffdingAdaptiveTreeRegressor`) apprend sur 8 features tirees du
> jsonb `dsp_campaign_data.metrics`, et son reward vaut `leads - spend/12,5`.
> Or, mesure ce jour : **477 879 lignes, ZERO avec un `metrics` non vide**, et
> aucune colonne `leads`/`visits`/`conversions`/`bid_requests`/`bid_won`/`tier`
> n'existe. Consequence : 4 features sur 8 sont constantes, et le reward se
> reduit a **`- spend/12,5`**. Le modele n'apprendrait qu'une chose — depenser
> est mauvais — et rendrait des multiplicateurs a l'air savant, derives d'un
> signal inexistant.
>
> ⚠ **Sa sortie ecraserait le plan des jeux de zones.** Le mode `auto`
> (`persistence.py:34`) fait un `upsert` sur `bidding_zone_configs`
> `(strategy_id, postal_code, country_code)` — **exactement la cle et la table**
> ou `genererPlanCp` ecrit le plan d'un jeu de zones (`lib/zones/plan.ts`).
> Rien dans le schema ne distingue les deux origines : une passe de prediction
> remplacerait « ce qu'on a decide d'acheter » par « ce que le modele predit »,
> en silence.
>
> **Etat mesure le 2026-09-22 :**
> - `MODAL_BIDDING_ML_URL` vaut `""` (vide) et aucun `MODAL_TOKEN_*` n'est
>   pose : `getModalPrefix()` LEVE avant tout appel reseau. Le service est donc
>   injoignable, et son deploiement invérifiable.
> - `adaptive_model_state` : **0 ligne** — aucun modele n'a jamais ete entraine,
>   donc `/predict` repondrait « Lance /train d'abord ».
> - `bidding_daily_state`, `bidding_drift_events` : 0. La boucle n'a JAMAIS
>   rien produit dans cette base.
> - `bidding_zone_config_proposals` (cible du mode `suggest`) : **table
>   inexistante**.
> - Les **11 435** lignes de `bidding_zone_configs` viennent du wizard et des
>   jeux de zones, jamais de Modal.
> - La sortie ne part vers AUCUN DSP : le push DV360 lit `custom_geo_zones` et
>   `custom_geo_zone_codes`. Le seul pont est le FICHIER d'`/export`, depose a
>   la main.
>
> **Code vestigial recense** (non supprime, signale) : `predictForStrategy` et
> `detectDrift` exportes sans appelant ; `agentAutoPilotDaily` (cron 06h00,
> enregistre dans `app/api/inngest/route.ts`) appelle **deux routes supprimees
> le 08/09** — `drift-detect-local` et `recommendations` — donc tomberait en 404
> meme si un ordonnanceur existait ; `apply_proposal_to_config` sans appelant.
>
> **Ce qu'il faudrait pour rouvrir la question**, dans cet ordre : que
> `dsp_campaign_data.metrics` porte enfin les conversions et les signaux
> d'enchere (sujet d'INGESTION DSP, pas de ML) ; qu'un mode d'execution separe
> les ecritures du modele de celles du plan ; et que Modal soit redeploye avec
> une URL.

## Stack technique

| Couche | Technologie | Version |
|--------|-------------|---------|
| Framework web | Next.js (App Router) | 15.5.25 |
| Runtime UI | React | ^19.0 |
| Langage | TypeScript (strict) | ^5.3 |
| Base de donnees | Supabase (PostgreSQL **17.6** + **PostGIS 3.3.7**) — les docs annoncaient 15 jusqu'au 2026-09-13, soit deux versions majeures d'ecart. **L'environnement de reference est le stack LOCAL depuis le 2026-09-19** (conteneurs Docker, § « Environnement de developpement local ») ; le projet heberge portait un compute **Micro** et non Nano (shared_buffers 256 Mo, effective_cache_size 768 Mo, soit ~1 Go de RAM), et ses contraintes d'I/O restent la regle de codage. Neuf extensions actives, mesurees le 2026-09-19 : `postgis`, `http` 1.6, `pg_net`, `pg_trgm`, `pgcrypto`, `unaccent`, `uuid-ossp`, `pg_stat_statements`, `supabase_vault`. Acces applicatif par `@supabase/supabase-js` + `@supabase/ssr` (^0.5.2) | ^2.97 |
| Cartographie | MapLibre GL JS | ^5.18 |
| Tuiles vectorielles | MVT servies par PostGIS (`ST_AsMVT`) — **pour TOUT**, carreaux compris. Le paquet `pmtiles` (4.4.0) reste declare dans `package.json` mais **plus rien ne l'importe** : `npm run catalogue` le liste en dependance jamais importee, le protocole n'est plus enregistre (`app/copilote/_hooks/useMapInit.ts:136`) et aucune couche PMTiles ne subsiste. Ce document annoncait « PMTiles conserve pour les carreaux uniquement » jusqu'au 2026-09-16 : c'etait faux, les carreaux passent par `/api/tiles/[z]/[x]/[y]` (documente comme tel plus bas). Le desinstaller est un geste sans risque, laisse a une passe de nettoyage | — |
| LLM / Copilote | Vercel AI SDK + Gemini 2.5 Flash / Mistral Small | ai ^6.0 |
| Fonds de carte | OpenFreeMap (Liberty / Positron / Bright) + MAGELIAN dark style | — |
| Isochrones | OpenRouteService (ORS) REST API | — |
| Risques industriels | **Georisques** (ministere de la Transition ecologique) — `api/v1/installations_classees`, **sans jeton**. 138 423 installations classees. Aussi `api/v1/gaspar/pprt` : **415 procedures PPRT**, sans geometrie | — |
| Perimetres PPRT (polygones) | **Geoplateforme IGN** — WFS `wfs_sup:assiette_sup_s`, filtre `suptype='pm3'` (servitude d'utilite publique PM3 = PPRT), alimente par le Geoportail de l'Urbanisme. **664 polygones**, GeoJSON, `CQL_FILTER` honore, `numberMatched` exact. Voir « Perimetres PPRT » plus bas pour la comparaison mesuree avec le WFS Georisques, qui ne convient PAS | — |
| Meteo | Open-Meteo API (temperature, precipitation, ensoleillement) | — |
| Inference ML bidding | **Modal** (serverless Python, HTTPS) — `-predict` / `-train` / `-detect-drift`. **Le seul composant qui ne tourne pas dans Next.js**, et le seul code Python deploye. Bibliotheques : `river` (apprentissage EN LIGNE, incremental — c'est ce qui permet de reprendre un modele sans tout rejouer), `scikit-learn`, `numpy`, `pandas`, client `supabase` | — |
| Scripts Python hors ligne | 38 fichiers dans `scripts/` et `modal/` (imports INSEE/OSM/GTFS/TMJA, clustering POI x Filosofi, rescoring) : `supabase`, `requests`, `pandas`, `numpy`, `scikit-learn`, `pyproj`, `matplotlib`, `dotenv`. **Aucun runtime Python sur Vercel** — d'ou le 503 explicite de `/api/poi-clusters/run` quand le script est absent | — |
| Jobs asynchrones | Inngest (serverless queue) — ⚠ **plus d'ordonnanceur depuis la coupure du 2026-09-19** : Inngest appelle `/api/inngest` sur l'URL publique de l'application, et il n'y a plus de deploiement. Le cron `civic-daily-ingest` ne tourne donc plus (§ 2.1 de `docs/PLAN_REPRISE.md`) | ^3.54 |
| Rate limiting | Upstash Redis — **declare mais NON configure** : `lib/api/rate-limit.ts` l'importe, aucune variable `UPSTASH_*` n'est posee, et le limiteur retombe sur le compteur **en base** (`consommer_quota`, sql/135). C'est ce compteur partage qui protege reellement le budget d'I/O — une `Map` en memoire de processus ne limite RIEN sur Vercel | ^2.0 |
| PDF export | @react-pdf/renderer — **plus installe** : retire en dommage collateral de la suppression du clustering (commit 7192c68), son seul consommateur. A reinstaller le jour ou le rapport PDF est restaure (docs/PLAN_CLUSTERING.md) | — |
| Lecture tableurs | exceljs (.xlsx/.xlsm, et l'export du tableau d'exposition) + lecteur .ods maison (jszip ^3.10) | ^4.4 |
| Lecture CSV | papaparse — six consommateurs : parser DSP, parser d'import universel, geocodeur, parser ANFR, depot CSV IRIS, construction des geotargets Google | ^5.4 |
| Reprojection | proj4 — deux consommateurs seulement (lecteur de shapefile a l'import des carreaux, geocodeur). Toute reprojection en base passe par PostGIS, jamais par lui | ^2.11 |
| Graphiques | Recharts — sept consommateurs. ⚠ Contrairement a MapLibre, **il resout `var()`** : une palette servie a Recharts n'a pas a etre dupliquee en hex litteraux (voir `DESIGN_SYSTEM.md` § echelle qualitative) | ^3.8 |
| Dessin sur carte | **terra-draw** + `terra-draw-maplibre-gl-adapter` — seul moteur qui pilote MapLibre 5 nativement (`mapbox-gl-draw` exige un adaptateur non maintenu). Bundlee, jamais chargee d'un CDN : la CSP de `next.config.js` n'a RIEN a ouvrir, `script-src 'self'` suffit (verifie, pas suppose). Chargee en `dynamic(ssr:false)` a l'ouverture de l'outil seulement — elle ne pese pas dans le paquet initial de `/map` | ^1.33 / ^1.4 |
| Styles | Tailwind CSS + Design System MAGELIAN (dark minimal) — `DESIGN_SYSTEM.md` est la source de verite du frontend | ^3.4 |
| Composants UI | **shadcn/ui** sur **Radix** (`react-dialog`, `react-separator`, `react-slot`, `react-tabs` — quatre primitives, pas la suite entiere) + `class-variance-authority`, `clsx`, `tailwind-merge`, `tailwindcss-animate`. Icones : **lucide-react** | ^1.1 / ^1.7 |
| Fonts | Inter (UI) + JetBrains Mono (donnees/code) | — |
| Validation | Zod | ^3.22 |
| Authentification DSP | `google-auth-library` — flux OAuth et compte de service DV360 | ^10.7 |
| Client SQL direct | `postgres` (postgres.js) — **un seul appelant**, `/api/admin/health`. Tout le reste passe par PostgREST via supabase-js. `pg` et `@types/pg` restent en devDependency | ^3.4 |
| Tests | Vitest — deux projets lances en SEQUENCE (`unit` puis `integration`), jamais en parallele : voir `CLAUDE.md` § Tests | ^2.0 |
| Catalogue du code | knip (exports/fichiers morts, dependances inutilisees — `npm run catalogue`) | ^6.35 |
| Outillage | ESLint 8 + `eslint-config-next` · `tsx` (scripts TS) · `dotenv` · CLI Supabase (^2.78 declaree, **2.109 installee** sur ce poste) | — |
| CI/CD | **AUCUN — Vercel est abandonne (arbitrage du 2026-09-21).** Il n'y a plus de chaine de deploiement, donc plus d'environnement de production : **le seul environnement du projet est le stack LOCAL** (§ « Environnement de developpement local »). ⚠ Ce qui en decoule, et qui n'est pas qu'administratif : tout raisonnement de la forme « en production, X se comporte autrement » est desormais SANS OBJET dans ce document, et plusieurs notes en dependaient — elles sont corrigees la ou elles se trouvent, pas ici. Cette ligne annoncait « deploiement automatique sur push `main` » jusqu'au 2026-09-19, puis « plus aucun deploiement actif, le projet `geo-prompt-v2` existe encore » jusqu'au 21 : les deux formulations laissaient croire qu'un push pouvait mettre quelque chose en ligne. Il ne peut plus. ⚠ Un push sur `main` reste un push vers **GitHub**, qui est le depot de reference et le reste | — |

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
│   │   ├── _components/        # panneaux/ (Filtre/Calques/Analyse/Zones du rail,
│   │                           # dont JeuxDeZonesRail.tsx : les jeux de zones a
│   │                           # risque enregistres, qui MONTRE et OUVRE l'atelier
│   │                           # sans jamais afficher ni supprimer — ces deux gestes
│   │                           # restent la ou leur contexte les rend lisibles),
│   │   │                       # IrisDetailPanel, ClusterPanel, ClusteringWizard,
│   │   │                       # CaptureLayers, ZoneMediaPlanPanel, DessinLibre,
│   │   │                       # et les couches de carte : CivicHealthMapLayer,
│   │   │                       # CivicIndicatorsLayer, ScoreMapLayer,
│   │   │                       # DiffusionMapLayer, SuiviMapLayer.
│   │   │                       # FilterPanel.tsx (l'ancien monolithe) supprime le
│   │   │                       # 2026-09-12, vide par les taches 2 a 7 — mais
│   │   │                       # ⚠ le repertoire filter-panel/ VIT TOUJOURS
│   │   │                       # (34 fichiers) : ce n'est pas un residu, il porte
│   │   │                       # les outils montes par les panneaux du rail, dont
│   │   │                       # ScoreCompositeTool.tsx, CorrelationTool.tsx et
│   │   │                       # use-analyses.ts ajoutes par la Tache 11-12.
│   │   │                       # Ne pas le supprimer en lisant « FilterPanel
│   │   │                       # supprime » : ce sont deux choses differentes.
│   │   └── analyse/digital/    # Analyse campagnes digitales
│   │       ├── _components/    # AnalysisPanel, SyncMap, BiddingCopilot,
│   │       │                   # MeteoGeoPanel, MediaHeatmap, KpiSummary...
│   │       └── _lib/           # use-digital-data.ts
│   └── layout.tsx              # Layout racine (AppSidebar, fonts)
│
├── components/                 # Composants React partages
│   ├── AppSidebar.tsx          # Sidebar navigation MAGELIAN
│   ├── campaign/               # Gestion campagne (embarquee dans l'overlay MAGELIAN)
│   │   ├── ActivationPanel.tsx # ⚠ L'ECRAN qui pilote les quatre routes
│   │   │                       # /api/campaigns/[id]/activation/{prevol,pousser,
│   │   │                       # historique,rollback} (Tache 20, onglet Activation).
│   │   │                       # Absent de ce document jusqu'au 2026-09-16, alors
│   │   │                       # que les quatre routes y etaient decrites en detail :
│   │   │                       # on pouvait chercher « qui appelle activation/pousser »
│   │   │                       # et conclure que la plomberie n'avait pas d'interface.
│   │   ├── CampaignCockpit.tsx # Fil d'Ariane + wizard prog (Cible→Canaux & budgets→Pression→Strategie→Lancement)
│   │   ├── CampaignOverview.tsx# Apercu campagne + actions (Pause/Cloturer/Archiver/Supprimer) —
│   │   │                       # la modification passe par l'onglet Strategie (wizard)
│   │   ├── FinalReport.tsx     # Bilan executif Gemini fin de campagne — consomme par suivi-v2/DetailTechnique
│   │   ├── suivi/              # Tache 16 (2026-09-15) : ne contient plus que ReconciliationPanel.tsx,
│   │   │                       # reutilise TEL QUEL par suivi-v2/DetailTechnique (reconciliation DSP ⇔ mesure).
│   │   │                       # CampaignSuivi.tsx et le reste de suivi/ (SuiviCockpit/SuiviCharts/SuiviTable/
│   │   │                       # ActorFilter/ActorPanel/SuiviDeriveMap/DeriveTable/MeshSelector) supprimes —
│   │   │                       # ancien ecran de suivi, remplace par components/campagne/suivi-v2/
│   │   └── wizard/             # Etapes du wizard (PressureControl = slider pression ↔ CPM min/max ;
│   │                        #   StepCible : panier de zones ORDONNE (Tache 21). ⚠ L'ordre n'a AUCUN
│   │                        #   effet sur le ciblage a ce jour : `resolveFinalZone` fusionne les
│   │                        #   cibles multiples par une UNION (commutative) puis applique UNE
│   │                        #   courbe d'enchere a toute la zone. La priorite reste A IMPLEMENTER.
│   │                        #   Glisser-deposer HTML5 + fleches clavier, aucune dependance ajoutee ;
│   │                        #   logique pure dans lib/campaigns/priorite.ts)
│   ├── campagne/               # Chantier suivi-v2 (Taches 9-16, 2026-09-14/15) — convention FRANCAISE
│   │   │                       # du nom de dossier, distincte de campaign/ (anglais, plus ancien)
│   │   ├── BarreContexteCampagne.tsx # Barre de contexte campagne active (carte /map)
│   │   └── suivi-v2/           # Ecran de suivi actuel, seul monte par MagelianOverlay (onglet Suivi,
│   │                           # Tache 16) : SuiviV2.tsx (assemblage), TrioCartes/ScoreAlignement/
│   │                           # CarteVignette/GraphiqueEcart (vignettes), TableauDeregles/
│   │                           # ConstatsCorrection (deregles), QuiADiffuse (vue par acteur,
│   │                           # lib/campaigns/actor-metrics.ts), DetailTechnique (bloc technique
│   │                           # replie — budget vs trajectoire + ReconciliationPanel reutilise de
│   │                           # components/campaign/suivi/ + FinalReport), BandeauAvancement/
│   │                           # BarreMaille/CoutEtRythme/TroisComposantes (etat/maille/cout),
│   │                           # PressionParClasse (part des impressions contre part
│   │                           # du PLAN, par classe de zone — n'apparait QUE si le plan
│   │                           # vient d'un jeu de zones, sinon il n'y a rien a ventiler),
│   │                           # plus deux modules NON visuels partages par l'ecran :
│   │                           # etat-section.ts ('chargement' | 'echec' | 'pret', porte A COTE
│   │                           # de la donnee — un tableau vide confondait les trois etats)
│   │                           # et avec-semaphore.ts (le budget de 3 appels Supabase
│   │                           # simultanes vaut pour TOUT l'ecran, overlay masque compris).
│   │                           # Seize fichiers, verrouilles par
│   │                           # tests/unit/docs/derive-documentation.test.ts
│   ├── risques/                # Module « Population a risque industriel »
│   │                           # (overlay plein ecran, ouvert depuis le panneau
│   │                           # Calques). **CINQ ETAPES depuis le 2026-09-24**
│   │                           # (quatre depuis le 2026-09-21, trois onglets avant ;
│   │                           # `lib/risques/etape.ts`, `FilArianeEtapes.tsx`) :
│   │                           # ① Sites › ② Rayon › ③ Couverture › ④ Zones ›
│   │                           # ⑤ Campagne. **⑤ vit dans `campagne/`** :
│   │                           # `ContexteSimulation` (un seul chargement partagé
│   │                           # par le panneau, le bandeau, la carte et le
│   │                           # tableau — rien ne se charge avant la première
│   │                           # visite de l'étape), `PanneauCampagne` (extraction,
│   │                           # réglages, Simuler / Recaler / Exporter / Purger
│   │                           # avec barre de progression NDJSON, période, courbe
│   │                           # annotée, bilan avant/après, à corriger,
│   │                           # partenaires, sites sous-servis), `BandeauCampagne`
│   │                           # (les six KPI changent de question, pas de place),
│   │                           # `CarteCampagne` (3e instance MapLibre, montée à la
│   │                           # 1re visite puis gardée : bassins colorés par
│   │                           # indice de pression, cercles d'impressions par CP,
│   │                           # sites vert/orange/rouge, bascule Codes postaux),
│   │                           # `TableauZonesCampagne` (trié par écart en POINTS
│   │                           # DE PART, pas par indice). ⚠ Aucun badge
│   │                           # « Simulation » à l'écran (arbitrage du
│   │                           # 2026-09-24) : le drapeau vit en base. ⚠ La carte
│   │                           # peint avec la palette CLAIRE dans les deux thèmes,
│   │                           # le fond Positron étant clair. Un onglet dit « regarde
│   │                           # ailleurs », une etape dit « voici ou tu en es » —
│   │                           # et le module EST un parcours, qui produit un jeu
│   │                           # de zones. ⚠ **Ce n'est PAS un tunnel** : chaque
│   │                           # etape reste cliquable dans les deux sens, le
│   │                           # geste central etant le RETOUR du ③ au ② quand la
│   │                           # couverture ne convient pas. La pastille d'une
│   │                           # etape dit « tu as pose un choix ici », jamais
│   │                           # « validee ». ⚠ DEUX fils d'Ariane sur l'en-tete,
│   │                           # et ce n'est pas un doublon : `FilAriane`
│   │                           # (`elements.tsx`) dit OU JE REGARDE (France ›
│   │                           # PACA › Bouches-du-Rhone), `FilArianeEtapes` dit
│   │                           # OU J'EN SUIS. ⚠ `onglet=rayons|territoires|
│   │                           # zones|diffusion` reste lu comme ALIAS HERITE —
│   │                           # un lien partage ne se corrige pas apres coup, et
│   │                           # la 2e generation d'alias n'efface pas la 1re.
│   │                           # **UNE barre de commandes pour toutes les etapes
│   │                           # depuis le 2026-09-20** : tout ce
│   │                           # qui y figure vaut partout, et le changer met a
│   │                           # jour les quatre — l'etat est unique
│   │                           # (`lib/risques/etat-url.ts`), il n'y a aucune
│   │                           # copie a synchroniser. La rangee « Propre a
│   │                           # Territoires » a DISPARU le 2026-09-21 avec le
│   │                           # moteur qui l'imposait : sa reglette locale
│   │                           # affichait 390 112 habitants pendant que
│   │                           # l'en-tete en annoncait 24 406 618 pour le meme
│   │                           # profil. La barre porte desormais UNE REGLETTE
│   │                           # PAR NIVEAU (`RegletteRayons.tsx`), une seule
│   │                           # quand le cadenas « lier les niveaux » est
│   │                           # ferme. ⚠ Elle deplace le BORD de la zone —
│   │                           # l'anneau EXTERIEUR — et jamais « le » rayon :
│   │                           # un niveau en porte jusqu'a quatre et le profil
│   │                           # par defaut en a trois sur le seuil haut, donc
│   │                           # un curseur ne peut que mentir sur leur nombre.
│   │                           # Les anneaux interieurs restent au tiroir, et
│   │                           # sont rappeles en gris a cote de la valeur.
│   │                           # ⚠ **Le calcul ne part qu'au RELACHEMENT**
│   │                           # (mesure : zero requete sur 20 positions de
│   │                           # glissement, une seule au relachement) :
│   │                           # `population_par_classe` coute plusieurs
│   │                           # secondes, une requete par pixel serait la
│   │                           # famille de l'incident du 28/03. L'editeur
│   │                           # d'anneaux reste un TIROIR
│   │                           # ouvrable de toutes les etapes — il decide de la
│   │                           # classe de chaque carreau, donc de tous les
│   │                           # chiffres de l'ecran, et le laisser dans le
│   │                           # seul onglet Rayons obligeait a changer
│   │                           # d'onglet pour regler ce qu'on lisait ailleurs.
│   │                           # ⚠ **UNE SEULE BARRE DE PROGRESSION pour tout
│   │                           # l'ecran** (`ContexteChargement.tsx`,
│   │                           # `lib/risques/chargement.ts`, 2026-09-21) :
│   │                           # cinq sources portaient QUATRE formes de
│   │                           # signal differentes, et le bandeau gardait ses
│   │                           # chiffres a l'ecran pendant les secondes du
│   │                           # recalcul sans rien dire qu'ils decrivaient
│   │                           # l'etat PRECEDENT. `usePiste(cle, libelle,
│   │                           # actif)` declare ; le composant ne sait rien du
│   │                           # reste. INDETERMINEE : aucune de ces sources
│   │                           # ne rend d'avancement, un pourcentage y serait
│   │                           # invente. Les chiffres perimes passent en
│   │                           # opacite — jamais en squelette, qui effacerait
│   │                           # la valeur qu'on veut justement comparer.
│   │                           # ⚠ **L'EXPLORATION DE ③ EST LOCALE**
│   │                           # (`lib/risques/exploration.ts`) : cliquer une
│   │                           # ligne ecrivait le filtre Territoire, donc
│   │                           # faisait basculer TOUT l'ecran — bandeau KPI,
│   │                           # courbe, etapes voisines. Le filtre dit ce
│   │                           # qu'on ETUDIE, l'exploration ce qu'on REGARDE.
│   │                           # Trois gestes distincts : le clic SELECTIONNE
│   │                           # (la carte se recadre), la fleche droite
│   │                           # DESCEND, la gauche REMONTE. Un SECOND appel a
│   │                           # `population_par_classe` sert le tableau
│   │                           # explore, garde par `exploration.length > 0` —
│   │                           # sans quoi il doublerait chaque calcul, 2,8 s
│   │                           # sur le national, pour un resultat identique.
│   │                           # ⚠ **CES DEUX CALCULS SE CHOISISSENT PAR
│   │                           # `bandesTableau`, ET LA MINI-CARTE DOIT LIRE
│   │                           # LE MEME** (corrige le 2026-09-22) : le
│   │                           # tableau lisait l'explore pendant que la carte
│   │                           # lisait le global. Mesure au navigateur, en
│   │                           # vue France entiere : descendre dans
│   │                           # l'Ile-de-France listait ses 8 departements
│   │                           # et en dessinait **96**, peints avec des
│   │                           # valeurs de REGION — « Aude 26,0 % » etant la
│   │                           # valeur de la region 11 posee sur le
│   │                           # departement 11, « Paris 12,3 % » celle de la
│   │                           # Nouvelle-Aquitaine (region 75) sur le
│   │                           # departement 75. Les deux nomenclatures INSEE
│   │                           # se recouvrent sur 18 codes, donc la carte
│   │                           # restait plausible tout en etant fausse — le
│   │                           # piege de sql/171, cote client cette fois.
│   │                           # Le filtre des contours vit desormais dans la
│   │                           # fonction pure `codesDessines`
│   │                           # (`lib/risques/exploration.ts`) : il sortait
│   │                           # sur `chemin.length === 0`, donc ignorait
│   │                           # l'exploration, qui est un etat DISTINCT.
│   │                           # Verrouille par
│   │                           # `tests/unit/risques/carte-suit-tableau.test.ts`,
│   │                           # qui lit le SOURCE du composant — le lien vit
│   │                           # dans un `useMemo` qu'on ne peut pas appeler
│   │                           # isolement.
│   │                           # ⚠ **Le rayon vient EXCLUSIVEMENT de la
│   │                           # reglette** : le « comparateur de rayons » du
│   │                           # panneau ④ a ete retire, et `OngletZones` n'a
│   │                           # plus de `onProfil`. Il n'etait pas qu'un
│   │                           # doublon — il ecrasait un profil a plusieurs
│   │                           # anneaux en un anneau unique pose sur les DEUX
│   │                           # seuils, ce qui annulait le bidding
│   │                           # differencie qui justifie le module.
│   │                           # ⚠ **LA CARTE SE DEDOUBLE A L'ETAPE ④**
│   │                           # (`VueCartesZones.tsx`, `CarteCodesPostaux.tsx`,
│   │                           # `TableauGrappes.tsx`, 2026-09-22) : les rayons
│   │                           # a GAUCHE, les codes postaux a DROITE, cameras
│   │                           # liees. C'est la qu'on decide ce qu'on achete,
│   │                           # et cette decision EST la comparaison de deux
│   │                           # decoupages qui ne coincident pas. Ailleurs, une
│   │                           # seule carte et un interrupteur Rayons / Codes
│   │                           # postaux — il n'y a rien a comparer.
│   │                           # ⚠ **Les DEUX cartes restent montees**, celle
│   │                           # qu'on ne regarde pas en largeur nulle et
│   │                           # `visibility: hidden` : meme regle que la carte
│   │                           # permanente, la remonter rechargerait fond et
│   │                           # tuiles a chaque aller-retour.
│   │                           # ⚠ **Un VERROU DE REENTRANCE** sur la liaison
│   │                           # des cameras : placer B emet `move` sur B, qui
│   │                           # replace A, qui emet `move`. Sans le drapeau,
│   │                           # les deux cartes tremblent.
│   │                           # ⚠ **`jumpTo` et non `easeTo`** : une animation
│   │                           # sur la carte liee la ferait arriver APRES
│   │                           # celle qu'on manipule.
│   │                           # ⚠ Le taux d'utile du PANNEAU et celui du
│   │                           # BANDEAU etaient DEUX chiffres differents sur le
│   │                           # meme ecran — 77,1 % contre 81,6 %, puis 91,6 %
│   │                           # contre 81,6 %. Deux causes : le panneau comptait
│   │                           # des LIGNES (une par grappe depuis sql/225) et
│   │                           # divisait la population visee de TOUS les codes
│   │                           # postaux par celle des seuls RETENUS. Corrige
│   │                           # par `plierParCodePostal` (la regle du plan,
│   │                           # partagee) et `population_en_zone_retenue`.
│   │                           # ⚠ **LA CARTE EST PERMANENTE depuis le
│   │                           # 2026-09-21** (`CarteRisque.tsx`, ex-
│   │                           # `CarteZones.tsx`) : panneau de l'etape a
│   │                           # GAUCHE, carte a DROITE, **UNE seule instance
│   │                           # MapLibre montee au niveau de l'overlay et
│   │                           # JAMAIS demontee entre les etapes** — seules
│   │                           # les couches et la camera changent. La
│   │                           # remonter a chaque etape rechargerait fond,
│   │                           # tuiles et position, et ferait perdre la vue a
│   │                           # chaque aller-retour ② ↔ ③, le geste le plus
│   │                           # frequent du module. Poignee de largeur
│   │                           # (320-900 px) et bouton « Carte seule », qui
│   │                           # REPLIE le panneau au lieu d'appeler l'API
│   │                           # plein ecran — celle-ci sortirait la carte de
│   │                           # l'overlay, donc du bandeau KPI et du fil
│   │                           # d'Ariane. Le panneau replie garde
│   │                           # `visibility: hidden` et NON `display: none` :
│   │                           # ses composants resteraient sinon demontes, et
│   │                           # un jeu en construction serait perdu.
│   │                           # ⚠ **`ResizeObserver` obligatoire** : MapLibre
│   │                           # ne redimensionne pas son canevas quand son
│   │                           # conteneur change sans que la fenetre bouge —
│   │                           # ce qui est le cas de la poignee ET du repli.
│   │                           # Sans lui, la moitie droite reste grise et les
│   │                           # clics tombent a cote des points.
│   │                           # ⚠ L'etape ③ empile tableau et choroplethe au
│   │                           # lieu de les mettre cote a cote : mesure a
│   │                           # 480 px de panneau, la choroplethe gardait ses
│   │                           # 340 px fixes et il restait une vingtaine de
│   │                           # pixels au tableau. La choroplethe n'est PAS
│   │                           # redondante avec la grande carte — celle-ci
│   │                           # montre zones et sites, celle-la peint les
│   │                           # unites par part/densite/effectif.
│   │                           # (Historique : cette carte est nee dans
│   │                           # l'onglet Zones le 2026-09-20) :
│   │                           # zones en MVT (`/api/tiles/zones-risque`,
│   │                           # geometries deja exclusives par
│   │                           # `ST_Difference`) + sites en GeoJSON sur la
│   │                           # bbox visible, zoomable, avec legende, grappes
│   │                           # denses en surimpression et infobulle au clic.
│   │                           # C'etait une pile de six bandeaux gris : un
│   │                           # atelier de ZONES qui ne montrait aucune zone,
│   │                           # ou « adopter 2 km » se decidait sur un chiffre
│   │                           # sans jamais voir ce que ces 2 km recouvrent.
│   │                           # ⚠ **TROIS REGIMES DE ZOOM** (2026-09-21) :
│   │                           # sous `ZONES_RISQUE_ZOOM_LISIBLE` (7) les
│   │                           # zones ne sont PAS peintes — elles y font
│   │                           # moins d'un pixel — et le bandeau le dit ; de
│   │                           # 7 a `ZONES_RISQUE_ZOOM_DETAIL` (10) les
│   │                           # bandes d'un niveau sont FONDUES en un aplat
│   │                           # uni (la question de cette echelle est « ou
│   │                           # sont les zones », pas « a quelle distance ») ;
│   │                           # au-dela, chaque bande reprend son opacite,
│   │                           # son contour tirete et l'ETIQUETTE de son
│   │                           # rayon le long du contour. ⚠ Le rayon n'est
│   │                           # PAS dans la tuile (sql/205 y ecrit classe,
│   │                           # niveau, bande, surface) : l'etiquette est un
│   │                           # `match` compose cote client depuis le PROFIL,
│   │                           # l'ajouter a la tuile imposant de reconstruire
│   │                           # le cache a chaque anneau deplace.
│   │                           # ⚠ **DEUX LECTURES DES ZONES depuis le
│   │                           # 2026-09-21** (« Lecture des zones » dans la
│   │                           # barre commune, `EtatRisque.fusionner`,
│   │                           # `fusion=0` dans l'URL) : **Fusionnees** par
│   │                           # defaut — les enveloppes exclusives de
│   │                           # sql/205 servies en MVT — ou **Site par
│   │                           # site**, un cercle tirete par site et par
│   │                           # anneau. Les deux ne repondent PAS a la meme
│   │                           # question : la premiere dit « jusqu'ou
│   │                           # s'etend le risque », la seconde « de quel
│   │                           # site vient cette zone » — que l'aplat
│   │                           # exclusif ne peut pas trancher, et qui
│   │                           # n'etait atteignable qu'au survol, un site a
│   │                           # la fois. ⚠ C'est le SEUL champ de l'etat qui
│   │                           # ne change aucun chiffre, et il est dans
│   │                           # l'URL quand meme : deux lecteurs qui voient
│   │                           # l'un des enveloppes et l'autre des cercles
│   │                           # ne regardent pas la meme carte. ⚠ Basculer
│   │                           # ne declenche AUCUN appel — mesure le
│   │                           # 2026-09-21, zero requete reseau sur le clic,
│   │                           # les enveloppes etant deja en cache et les
│   │                           # cercles derives des sites deja charges ;
│   │                           # aucun des cinq crochets de donnees ne depend
│   │                           # de ce booleen. ⚠ La visibilite a la CREATION
│   │                           # des couches passe par une `ref`
│   │                           # (`fusionnerRef`) et la BASCULE par la prop :
│   │                           # l'effet des zones RECREE ses quatre couches
│   │                           # a chaque profil, nature ou theme, et une
│   │                           # couche neuve est visible — sans cette ref,
│   │                           # deplacer un anneau en mode site par site
│   │                           # ferait reapparaitre les enveloppes
│   │                           # par-dessus les cercles. Mettre `fusionner`
│   │                           # dans les dependances de cet effet aurait
│   │                           # recree la source vectorielle a chaque clic,
│   │                           # donc redemande toutes les tuiles pour un
│   │                           # changement qui n'en change aucune.
│   │                           # ⚠ Plafond sur les CERCLES (400) et non sur
│   │                           # les sites, contrairement a l'apercu : un
│   │                           # site du seuil haut porte jusqu'a quatre
│   │                           # anneaux, donc plafonner a 250 sites
│   │                           # autoriserait 1 000 cercles.
│   │                           # ⚠ **Pas de points proportionnels a la
│   │                           # population sous z7**, malgre le brief : cette
│   │                           # donnee n'existe pas par site a l'echelle
│   │                           # nationale, et le proxy tentant — le rayon —
│   │                           # vient du NIVEAU et non des habitants, donc
│   │                           # n'encoderait que la couleur deja affichee
│   │                           # sous l'apparence d'une mesure.
│   │                           # ⚠ Le SURVOL d'un site dessine ses anneaux
│   │                           # (64 segments, `circleGeoJSON` reutilise du
│   │                           # copilote, AUCUNE requete) : l'aplat etant
│   │                           # exclusif, il ne dit pas de quel site vient la
│   │                           # zone qu'on regarde. La population par site
│   │                           # reste hors du survol — elle demande un appel
│   │                           # par site, donc des dizaines par mouvement de
│   │                           # souris sur une grappe dense.
│   │                           # ⚠ Le paint des sites lit `COULEUR_NIVEAU`
│   │                           # (hex) et JAMAIS `COULEUR_NIVEAU_CSS` (`var()`)
│   │                           # — MapLibre ne resout pas `var()` dans `paint`,
│   │                           # `addLayer` LEVE, la couche n'est pas ajoutee,
│   │                           # et la legende annoncait pourtant « 58 sites
│   │                           # affiches » : un compte juste pour des points
│   │                           # absents. La legende, elle, est du DOM et garde
│   │                           # les jetons CSS.
│   │                           # ⚠ Les DEUX chargements (use-bandes,
│   │                           # use-courbe-rayon) vivent dans l'overlay et non
│   │                           # dans les onglets : ils repartaient sinon a
│   │                           # chaque bascule — quatre appels mesures pour
│   │                           # cinq bascules, sans qu'un reglage ait bouge.
│   │                           # Mesure apres correctif : ZERO appel.
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
│   │                           # (Il n'y a PLUS de couche PMTiles. Ce document listait ici un
│   │                           #  `CarreauxPMTilesLayer` qui n'existe pas sur le disque — verifie
│   │                           #  le 2026-09-16. Les carreaux sont servis en MVT par
│   │                           #  /api/tiles/[z]/[x]/[y]. Ligne conservee sous cette forme pour
│   │                           #  que la recherche du nom tombe sur l'explication.)
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
│   │                           # + lecture-avec-reprise.ts (2026-09-13) : le meme, AVEC
│   │                           #   reprise, reserve aux LECTURES idempotentes (Open-Meteo,
│   │                           #   ORS, BAN). Importer l'un ou l'autre EST la declaration
│   │                           #   d'idempotence. Audit : docs/AUDIT_APPELS_EXTERNES.md
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
│   ├── smart-prompt/           # Orchestrateur multi-agents Mistral
│   ├── risques/export-rayon/  # Export Excel interactif de l'onglet Rayon (2026-09-28) : donnees.ts
│   │                          #   (cumuls, jokers reecrits), classeur.ts (feuilles, formules, adresses),
│   │                          #   ooxml.ts (graphique, barre de defilement, cases — ce qu'exceljs
│   │                          #   n'ecrit pas), couleurs.ts (hex du theme clair, verrouilles par test)
│   ├── simulation/            # Étape ⑤ (2026-09-24) — FONCTIONS PURES, graine fixe :
│   │                          #   generateur.ts (diffusion = plan × effet inventaire ×
│   │                          #   dérive lente × bruit, + fuite hors zone ; somme des
│   │                          #   impressions = volume, au plus fort reste), recalage.ts
│   │                          #   (v1 → v2 par zone, borné et amorti), alignement.ts
│   │                          #   (score PAR BASSIN sur les impressions UTILES, via
│   │                          #   `calculerAlignement` du Suivi — pas de 2e formule),
│   │                          #   vue.ts (ce que l'écran ET l'export affichent),
│   │                          #   serveur.ts (lecture, lots de 50, purge). ⚠ Aucun score
│   │                          #   n'est écrit : 62 → 89 découle des réglages par défaut
│   │                          #   (intensité 1,55, recalage amorti à 0,8), calibrés sur
│   │                          #   le jeu national. Tests : tests/unit/simulation/
│   ├── zones/                 # jeu.ts, plan.ts (genererPlanCp — la part de budget de
│   │                          #   chaque code postal) + groupes.ts (2026-09-22) : les codes
│   │                          #   postaux qu'un referentiel ne sait pas distinguer.
│   │                          #   ⚠ Le plan les achete TOUS, multiplicateur divise par leur
│   │                          #   nombre — sinon on cible un quart d'une ville
│   └── supabase/               # rpc-json.ts, tables.ts + lire-tout.ts (2026-09-20) :
│                               #   lecture PAGINEE. ⚠ PostgREST applique un
│                               #   `db-max-rows` SERVEUR de **1000** sur ce stack
│                               #   (`supabase/config.toml:18`), et AUCUN `.limit()`
│                               #   client ne le depasse. Ce n'est PAS la troncature
│                               #   a 5 000 lignes des RPC : celle-ci frappe toute
│                               #   requete de TABLE ordinaire, et elle est quatre
│                               #   fois plus basse. Mesure : `zone_set_cp` portait
│                               #   1 942 codes postaux, `.select().limit(7000)` en
│                               #   rendait 1 000, et le plan ecrit couvrait donc la
│                               #   moitie du jeu — sans que rien le signale.
│                               #   `lireTout` rend TOUT ou LEVE, jamais un debut
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
| Zones | panneau gauche | `Alt+4` | seul endroit qui fabrique une geometrie + une liste de CP. **Depuis le 2026-09-20, il liste aussi les JEUX DE ZONES a risque** (`JeuxDeZonesRail.tsx`) : un jeu de zones EST une zone — un perimetre nomme, enregistre, reutilisable — et le chercher dans l'atelier suppose de se rappeler ou il a ete fabrique. Le panneau MONTRE et OUVRE, rien de plus : afficher ou supprimer restent dans l'atelier, avec le contexte (profil, seuil, taux d'utile) qui les rend comprehensibles |
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
  **Type `'france'` (2026-09-15, spec-filtre-france.md)** : une INTENTION
  explicite de perimetre national — ajoute au panneau Filtre (« Perimetre
  national »), distinct du pill Metro/+DROM (`scope`) qui ne pilote toujours
  que `/api/map/pois`. Piege inverse de l'intuition : `bboxDuFiltre` (fichier
  protege, inchange) replie sur `BBOX_METRO` des qu'un filtre n'a pas de bbox
  propre — applique a `'france'`, cela enverrait `BBOX_METRO` a CHAQUE requete
  de couche, PLUS restrictif que l'absence de filtre (l'incident documente en
  tete de `bbox-requete.ts` : 339 POI d'outre-mer masques). `bboxPourRequete`
  intercepte donc ce type AVANT d'appeler `bboxDuFiltre` et rend `undefined`,
  comme l'absence de filtre. Cote base, `codes_postaux_du_perimetre` (sql/146,
  branche `'france'` ajoutee sql/167) rend les 6 187 CP du referentiel pour ce
  type — mesure SQL directe : 3,9 ms, `shared hit=349`, aucune lecture disque.
  **Trouve en testant le parcours REEL (navigateur), pas seulement l'appel
  SQL** : `/api/analyses/score` affichait « scores sur **5 000** » et non
  6 187 — PostgREST tronque a 5000 lignes TOUTE RPC `RETURNS TABLE`, meme
  piege deja documente pour `correlation_campagne_indicateur` (sql/154).
  Corrige par la jumelle `codes_postaux_du_perimetre_jsonb` (sql/168,
  `RETURNS jsonb`, jamais tronquee ; l'originale `RETURNS TABLE` reste
  INCHANGEE, un DROP etant exclu en production) — seule `/api/analyses/score`
  l'appelle desormais pour le perimetre `FiltreActif`.
- **Un seul degrade de couleur a la fois** (`lib/carte/degrades.ts`, reducteur
  pur qui dit quoi eteindre sans rien eteindre lui-meme ; `lib/carte/
  calques-actifs.ts` l'enveloppe pour la bascule cochee/decochee et valide un
  `DegradeId` relu a la frontiere — localStorage, URL). Avant, jusqu'a neuf
  choroplethes (carreaux, IRIS, indicateurs civiques, sante environnementale,
  meteo, impressions de campagne, score composite, diffusion campagne, zones
  de risque) pouvaient s'empiler sans qu'aucune legende ne dise laquelle on
  lisait. Le
  score composite (Tache 12, 2026-09-13) puis la carte Diffusion plein ecran
  du Suivi V2 (Tache 13B, 2026-09-15, `app/map/_components/
  DiffusionMapLayer.tsx`) ont ete ajoutes a CE registre plutot que peints a
  cote : c'est la seule chose qui les empeche de s'empiler avec les six
  premiers. Les zones de risque (2026-09-19) suivent la meme regle et passent
  par un `CustomEvent`, l'overlay qui les regle vivant dans une autre branche
  de l'arbre React. Diffusion revendique l'exclusivite depuis `page.tsx`, qui lit
  directement la session de campagne (`useCampagneSession()`, contexte
  GLOBAL depuis la Tache 2) — pas de bus d'evenements DOM, contrairement au
  score composite et aux impressions de campagne, dont l'activation traverse
  une frontiere d'arbre React que seul un `CustomEvent` peut franchir. Les
  valeurs connues sont declarees DEUX fois — l'union `DegradeId` et le
  tableau `DEGRADE_IDS` de `calques-actifs.ts` — et un type `UnionCouverte`
  fait echouer `tsc` si la seconde oublie un membre de la premiere : sans
  lui, un degrade ajoute serait REJETE en silence a la frontiere et ne se
  rallumerait jamais depuis l'URL ou localStorage.
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
  **Refus explicite du perimetre national (2026-09-15, spec-filtre-france.md)** :
  poser le filtre `'france'` fait passer `perimetreChoisi` pour LES SIX outils
  d'un coup — c'est le but meme de ce filtre. `outilAdmetNational` (meme
  fichier) distingue l'outil dont le cout sur la France est mesure et
  negligeable (le score composite, 159 ms/640 Ko sur les 6 187 CP,
  `/api/analyses/score`) des cinq autres, jamais mesures a cette echelle
  (Voronoi/bataille V1/bataille V2/application de la bataille/clustering) et
  dont un seul (le Voronoi) depassait 30 s avant un correctif de la veille :
  `messageGardeOutil` leur rend un refus qui NOMME l'outil et propose une
  region ou un departement, jamais un blocage muet. Cablage verrouille par le
  meme test structurel (`HANDLERS_GARDE_OUTIL`, `verifierPerimetreOutil`) —
  `verifierPerimetreClustering`, relaye a `ClusteringWizard`, est un
  identifiant DISTINCT du `verifierPerimetre` generique relaye au score
  composite : les deux ne peuvent pas partager la meme reference sans faire
  admettre — ou refuser — le national aux deux outils a la fois.

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
- ~~`components/map/ClusteringResultsContent.tsx`~~ — **decision LEVEE et
  fichier SUPPRIME le 2026-09-22.** Il montait `ClusterPanel` sans relayer la
  garde de perimetre et n'etait importe nulle part ; il avait ete laisse en
  place plutot que supprime a l'aveugle, en attendant que « la passe `knip`
  le fasse remonter ». Elle l'a fait remonter le 22 : dernier des quatre
  fichiers morts du catalogue.
  **Supprime plutot que repare, et c'est le sens de la decision** : un fichier
  qu'aucun ecran ne monte ne vaut pas d'etre corrige, mais celui-ci, repris tel
  quel un jour, aurait lance un clustering SANS perimetre — la famille de
  l'incident du 28/03, contre laquelle `lib/carte/garde-perimetre.ts` existe.
  Le garder, c'etait laisser une amorce. `git show` le rend si l'ecran de
  resultats de clustering revient — il devra alors relayer
  `verifierPerimetreClustering`, comme le fait `PanneauAnalyse.tsx`.
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

⚠️ **Elles ne s'executent jamais.** Les routes API qui parlent a Supabase le
font par `createAdminClient()` (cle `service_role`), qui contourne RLS ; aucune
n'instancie de client avec la cle anon. L'autorisation reellement appliquee est
celle du middleware (authentifie ?) plus les guards et le scoping par org
ecrits dans chaque handler.

> **Recomptage du 2026-09-16.** Cette phrase annoncait « les 146 routes API »
> depuis des mois, et se lisait comme un recensement exhaustif — 146 sur 146,
> donc la garantie tient. Le depot en comptait **205**, dont 23 ajoutees par
> `feat/suivi-v2` : **59 routes n'avaient jamais ete comptees**, et il suffisait
> qu'une seule passe par la cle anon pour que la garantie tombe sans que
> personne ait de raison d'aller voir. Un chiffre ne vaut que par la date a
> laquelle il a ete mesure, d'ou ce paragraphe plutot qu'un nouveau nombre dans
> la phrase.
>
> Mesures du 2026-09-16 : **205** fichiers `app/api/**/route.ts` sur le disque,
> **204 suivis par git** (voir l'anomalie ci-dessous) ; **180** instancient
> `createAdminClient()` ; **0** instancie un client Supabase avec la cle anon —
> le seul fichier qui nomme `SUPABASE_ANON_KEY` est `/api/admin/health`, qui en
> verifie la PRESENCE sans s'en servir. Les ~25 routes restantes ne parlent pas
> a Supabase (proxys de tuiles, diagnostics de configuration, webhooks).
>
> **Remesure du 2026-09-22 — et c'est le paragraphe ci-dessus qui avait raison
> d'exister.** Six jours plus tard, les trois nombres ont bouge : **224** sur le
> disque, **223 suivis par git**, **199** instancient `createAdminClient()`.
> Dix-neuf routes de plus, soit 9 % en six jours (chantiers risque et jeux de
> zones) — un chiffre ecrit dans une phrase, sans sa date, aurait de nouveau ete
> lu comme un recensement. **Les deux garanties, elles, tiennent** : toujours
> **0** route avec la cle anon (verifie le 2026-09-22, `/api/admin/health` reste
> le seul fichier a nommer `SUPABASE_ANON_KEY`), et 224 − 199 = **25** routes
> qui ne parlent pas a Supabase. Les dix-neuf nouvelles routes sont toutes
> decrites dans les tableaux ci-dessous — verifie une a une, aucune route du
> depot n'est absente de ce document.
>
> **Remesure du 2026-09-23.** **228** routes sur le disque, **225 suivies par git**,
> **203** instanciant `createAdminClient()`. Les quatre de plus qu'au 22 se
> repartissent ainsi : deux datent du soir meme de la mesure precedente
> (`cp-geo` et `grappes`, Phase 3) et deux sont les extractions ajoutees ce
> jour. **Les deux garanties tiennent toujours** : **0** route avec la cle anon,
> et 228 - 203 = **25** routes qui ne parlent pas a Supabase — le meme compte
> qu'au 16 et au 22, donc aucune des nouvelles n'a ouvert un chemin different.
>
> ⚠️ **`app/api/radio/data/route.ts` n'est PAS suivi par git** : le motif
> `data/` de `.gitignore:45` l'exclut, et il n'a jamais ete commite (verifie sur
> toutes les branches). Il porte pourtant un `DELETE` reserve au super_admin
> (« Suppression des donnees radio », cibles `emetteurs`/`radios`/`all`) que
> `app/admin/radio/page.tsx:305,319` appelle par `adminFetch`.
>
> ⚠ **L'enjeu a change de nature le 2026-09-21, avec l'abandon de Vercel.**
> Cette note disait : « sur le poste du developpeur le bouton fonctionne ; en
> production, Vercel deploie depuis git, la route n'existe pas et la suppression
> repond 404 », et concluait qu'il fallait trancher entre deployer une route
> destructrice jamais eprouvee ou retirer le bouton. **Il n'y a plus de
> production**, donc plus de divergence entre deux environnements : la route
> existe partout ou le projet tourne, c'est-a-dire en local, et le bouton y
> supprime reellement les donnees radio.
>
> Ce qui reste a trancher n'est donc plus un arbitrage de deploiement mais une
> question de suivi : **un `DELETE` destructeur vit dans un fichier que git ne
> voit pas**, donc hors revue, hors historique, et qu'un `git clean` emporte.
> Les 569 698 liaisons radio rapatriees avant la coupure Supabase sont ce qu'il
> efface. Ajouter une exception a `.gitignore`, ou retirer le bouton.

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
| `/api/map/poi-natures` | GET | Natures de POI. ⚠ Pour `risque_industriel`, les natures sont servies depuis le registre borne `icpe_rubrique_familles` et NON par un balayage des POI : le chemin generique pagine toutes les lignes de la categorie en tirant le jsonb entier, soit ~100 requetes et des centaines de Mo sur 99 152 sites — la famille de l'incident du 28/03 |
| `/api/map/risques-industriels` | GET | **Couche dediee des sites a risque industriel** (sql/175, 2026-09-17) : sites de la bbox, attributs complets pour la popup, et **zone de danger** optionnelle autour de chaque site (`ST_Buffer` sur `geography`, rayon en metres — verifie 499 m pour 500 demandes). Defaut **Seveso** (1 327 sites sur 99 152 ICPE) : ouvrir sur tout noierait les sites qui comptent, et 99 152 points ne s'affichent pas. `gravites` / `natures` / `inclure_inactifs` / `rayon_m` / `limite`. **Route distincte de `/api/map/pois` a dessein** : celle-ci colore par CATEGORIE (une seule teinte pour 99 152 sites, donc aucune legende par type de risque possible), plafonne a 10 000 POI, bascule en nappe de densite des 500, et ne renvoie pas `metadata`. `n_total` compte AVANT la limite, qui coupe les sites les MOINS graves d'abord — une liste tronquee ne perd jamais un Seveso |
| `/api/map/pprt` | GET | **Perimetres PPRT** d'une bbox (sql/178, `?bbox=` OBLIGATOIRE, `types=`, `limite=`). Route DISTINCTE de `/api/map/risques-industriels`, qui sert des POINTS et un cercle de danger CALCULE : celle-ci sert les **servitudes PM3 opposables**. Bbox exigee non seulement pour l'I/O — France entiere = 4 948 ko brut — mais parce qu'a cette echelle une zone de 2 km fait **moins d'un pixel** ; la couche a donc un plancher `PPRT_ZOOM_PLANCHER` (8, `lib/version.ts`). Mesure z8 : 126 zones, 182 ko, 46 ms, 0 lecture disque. Cache CDN 1 h — un referentiel de servitudes ne bouge qu'au depot d'une DDT |
| `/api/risques/exposition/agregats` | GET | **Population exposee AGREGEE** par region / departement / code_postal (sql/185). `?dimension=&cible=&gravites=&natures=&modes=&rayon_m=&limite=&forcer_rayon=`. **Ce n'est PAS une somme de `seveso_exposition`** : ce cache est PAR SITE, et l'additionner compte deux fois les habitants du recouvrement de deux zones — mesure du 2026-09-18, +0,1 % sur les 664 perimetres PPRT mais **+62,2 %** en mode buffer sur les 69 Seveso des Bouches-du-Rhone, soit 128 232 habitants qui n'existent pas. La RPC unit donc les zones A L'INTERIEUR de chaque carreau. Le `total_exposee` EGALE la somme des lignes (un carreau de 200 m appartient a une seule unite) ; `total_sites`, lui, ne s'additionne PAS. Le type de risque est un FILTRE et non une dimension. **Maille `commune` (sql/194)** : elle est MOINS chere que `code_postal`, et c'est contre-intuitif — le carreau porte deja son code commune INSEE (`metadata->>'lcog_geo'`), donc AUCUN croisement geometrique, la ou le code postal impose un point-dans-polygone contre les 6 187 contours de `ref_codes_postaux`, carreau par carreau. Mesure en prod : 1 106 communes exposees, 6,0 s au premier appel puis 70 ms par le cache ; total 421 214 IDENTIQUE a la maille departement. Elle a de VRAIS denominateurs (`iris_agg_commune`), donc part et densite — que le code postal n'a pas. **Deux pieges mesures** : `lcog_geo` est une LISTE des que le carreau est a cheval (`'75103,75104,75111'` releve sur Paris) — on retient le PREMIER code, ce qui preserve « un carreau, une unite » et l'egalite somme=total ; et Paris/Lyon/Marseille sont en codes d'ARRONDISSEMENT (75101, pas 75056) dans les carreaux comme dans `ref_communes` et `iris_agg_commune`. **sql/195 les REGROUPE** sous leur commune mere via `communes_arrondissements` (45 lignes, sql/150, deja utilisee par l'outil copilote `classement_territoires`) : le classement affichait « Marseille 15e Arrondissement » a 10,43 % alors que la question posee etait « les 100 plus grandes COMMUNES ». Apres regroupement, Paris (10 190) et Marseille (9 037) apparaissent en une ligne, total inchange a 421 214. Le denominateur est somme AVEC le numerateur — regrouper l'un sans l'autre donnerait une part fausse d'un facteur 16 sur Marseille — et le compte de sites aussi. La maille **`arrondissement`** garde le detail brut : deux valeurs de dimension plutot qu'un parametre de plus, ce qui evite un `DROP` et dit mieux la verite — le nord de Marseille n'est pas Marseille. **Pas de mini-carte a cette maille** : 34 921 polygones sur 300 px, l'ecran le dit au lieu d'afficher un chargement sans fin. `forcer_rayon=1` (sql/191) impose le cercle a TOUS les sites, PPRT compris : sans lui, `rayon_m` ne touchait que les sites sans servitude et « 5 km autour de chaque site » etait inexprimable — `modes=buffer` ne repond pas a la meme question, il EXCLUT les sites qui ont un plan donc rend un total plus PETIT au lieu d'un total recalcule. Quota `geo:rl:exposition-agregats` 20/min. **`trop_de_sites` est le seul refus qui cite des chiffres**, parce que c'est le seul que l'utilisateur peut lever lui-meme : le message nomme le nombre de sites retenus, le plafond, et les deux sorties (restreindre le territoire, ou retirer un regime). Un « trop de sites » sans ces nombres est un mur |
| `/api/risques/exposition/export` | GET | **Export Excel** du tableau de population exposee (exceljs, deja au projet). Appelle la MEME RPC que l'ecran avec les MEMES parametres — un export qui recalculerait autrement finirait par diverger, et c'est le tableur qu'on croirait. Exporte TOUTES les lignes (`p_limite: 7000`), jamais la liste tronquee affichee : un tableur sert justement a regarder au-dela. ⚠ **Le classeur porte un onglet « Methode et limites »** : un tableur QUITTE l'application, et tout ce que l'interface explique disparait a l'export — la colonne « sites » qui ne s'additionne pas, l'outre-mer non calculable, l'absence de denominateur au code postal, le regroupement des arrondissements. Sans lui, le premier lecteur qui somme la colonne « sites » obtient un total faux sans moyen de le savoir. Quota `geo:rl:exposition-export` 6/min — plus serre que les 20 d'`/agregats`, l'export declenchant le meme calcul PLUS la fabrication du classeur |
| `/api/risques/exposition/rayon` | GET | **Courbe de couverture par rayon** (sql/198 construction, sql/199 lecture) : population vivant a moins de X metres d'au moins un site, de 100 m a 10 km par paliers de 100 m, **une courbe par nature de risque**. `?cible=&gravites=&natures=&perim_niveau=&perim_codes=`. **Ne calcule RIEN** — lit une table pre-agregee, d'ou une reponse en millisecondes la ou `/agregats` paie 3 a 43 s. ⚠ La courbe `cle='*'` n'est PAS la somme des autres : un carreau proche de deux natures compte dans les deux, ce qui est correct pour chacune et faux pour leur addition (mesure : 240 745 au minimum par carreau contre 282 502 en additionnant). `total_est_global` previent que l'utilisateur a filtre les natures mais que la courbe totale porte toujours sur l'ensemble. 409 `a_construire` si le pre-calcul manque — une courbe plate se lirait « personne n'habite pres d'un site ». Quota `geo:rl:exposition-rayon` 30/min |
| `/api/risques/exposition/rayon/export` | GET | **Classeur Excel INTERACTIF de l'onglet Rayon** (2026-09-28, sql/233). Feuille de pilotage avec un menu Seuil Seveso (haut, bas, les deux), un menu Territoire (France, region, departement), une VRAIE barre de defilement du rayon (100 m a 10 km) et des cases a cocher par nature et pour les etiquettes ; un graphique Excel natif (courbe totale, une courbe par nature, etiquettes au km, repere vertical au rayon) ; des tableaux par region et par departement ; la table de couverture ENTIERE (1 293 lignes x 100 paliers) dont tout se recalcule par `SUMIFS`. Les parametres `gravites`/`natures`/`perim_niveau`/`perim_code`/`rayon_m` ne FILTRENT rien : ils fixent les valeurs INITIALES des controles, pour que le classeur s'ouvre sur l'ecran. Cible `ind` seule. ⚠ exceljs n'ecrit ni graphique ni controle : `lib/risques/export-rayon/ooxml.ts` les AJOUTE au zip (VML pour les controles, forme Excel 2007). Deux pieges mesures au vrai Excel (automatisation COM) : le joker `*` de la base, reecrit en libelles, sans quoi un critere `"*"` de `SUMIFS` additionnerait tout ; et le cache `numCache/ptCount` de chaque serie, sans lequel Excel ignore les exclusions de legende. Verifie : 13 588 157 habitants a 5 km du seuil haut, identique a `lire_couverture_rayon`. ⚠ Masquer une nature ne retire que sa courbe : total, chiffres et tableaux restent toutes natures (meme regle que `total_est_global`). Mesure : 5,4 s a froid, 0,33 s ensuite, ~820 Ko. Quota `geo:rl:exposition-rayon-export` 6/min |
| `/api/risques/profil/bandes` | GET | **Population par CLASSE d'un profil de rayons** (sql/203 pre-calcul, sql/204 lecture). `?profil=&cible=&maille=departement\|commune&parent=&limite=`. Repond a la question que `/exposition/rayon` ne pouvait PAS poser : cette derniere sert une distribution MARGINALE — une courbe par gravite, chacune exacte isolement, mais **317 367 carreaux sur 883 451 (35,9 %) sont a portee des DEUX niveaux Seveso** et comptent donc dans les deux. Ici chaque carreau porte UNE classe (seuil haut prime sur seuil bas, puis PPRT, puis bande), donc `total` EGALE la somme de `par_classe` — verifie, ecart nul. ⚠ **Mais PAS la somme des unites, et cette phrase l'affirmait jusqu'au 2026-09-21** : mesure sur le profil par defaut, l'ecart vaut **+1** habitant a la maille region, **+22** au departement, **+502** a la commune, soit ~0,19 par unite — chaque cellule (unite x classe) est arrondie avant d'etre sommee. C'est un choix, et l'inverse serait pire : faire de `total` la somme des lignes le ferait REDEPENDRE de la maille, ce que sql/222 a precisement supprime (24 406 565 en region contre 24 408 136 en commune pour un meme profil). Un total qui bouge avec le decoupage fait douter de tout l'ecran ; un arrondi de 502 sur 7 millions ne se voit sur aucun chiffre affiche. L'ecran dit desormais « les lignes se repartissent ce total, a l'arrondi pres », et `tests/integration/bandes-mailles.test.ts` verrouille l'ORDRE DE GRANDEUR de l'ecart (au plus une unite d'arrondi par unite geographique) — ce qui distingue un arrondi de la perte d'un departement. ⚠ Le seul test qui semblait garantir l'egalite portait sur `population_exposee_agregee`, l'AUTRE moteur, ou elle est vraie. **Aucune geometrie a la lecture** : le pre-calcul a fige les distances, appliquer un profil n'est plus qu'un decoupage arithmetique. Mesure 2026-09-19 : **2,8 s** sur la France a la maille departement, 416 ms sur un departement a la maille commune. ⚠ `hors_zone` compte des habitants de carreaux PROCHES d'un site que le profil ne retient pas — ce n'est PAS la population non exposee de France, la table ne contient que des carreaux a moins de 10 km. **Un resultat vide a QUATRE causes** (sql/217, 2026-09-20), et la RPC les rend TOUTES sous la meme forme `total: 0, n_unites: 0` : (1) le profil ne porte AUCUN anneau — `hors_zone` vaut alors **41 083 708** sur la France, donc dire « aucun carreau a portee » serait l'INVERSE de la verite, c'est le profil qui ne retient rien ; (2) le pre-calcul n'a jamais ete construit — lancer le script ; (3) le territoire n'est pas CARROYE par l'INSEE (971/973/976) — aucun script n'y changera rien, et le message cite les sites presents malgre tout ; (4) des carreaux sont a portee mais aucun dans les anneaux choisis — mesure en Lozere, 1 carreau et 2 habitants — et le message CHIFFRE ce qui est a portee, sans quoi « elargissez vos anneaux » ne dit pas s'il manque dix metres ou dix kilometres. **L'ordre compte** : la premiere cause se teste sans aucune requete et vaut quel que soit le territoire, la placer apres ferait diagnostiquer un territoire alors que le reglage de l'utilisateur explique tout. `a_construire` n'est pose que sur la DEUXIEME ; si le diagnostic lui-meme echoue, la route rend la phrase generique — jamais une consigne qui pourrait faire perdre vingt minutes. **`natures=` ajoute le 2026-09-20** : le filtre vit dans la barre COMMUNE aux trois onglets, et cette route ne le transmettait pas — la courbe de l'onglet Rayons bougeait, ce tableau non. Un libelle non reconnu rend un 400 qui le NOMME, jamais un calcul sur le seau « non precisee ». Quota `geo:rl:risque-bandes` 30/min |
| `/api/risques/sites/compter` | GET | **Combien de sites les filtres retiennent, et sur combien au total.** `?gravites=&natures=&perim_niveau=&perim_codes=`. Alimente le bandeau KPI permanent de l'ecran de risque. ⚠ **Le denominateur passe par la MEME RPC `compter_sites_rayon`, appelee une seconde fois sans filtre de risque** — un `count(*)` ecrit ici, ou une constante reprise de ce document, donnerait deux definitions de « un site a risque » qui divergeraient au premier correctif du predicat (etat d'activite, coordonnees nulles, regimes retenus). Le cout le permet : **1,4 ms** mesure, l'index `poi_france(categorie, sous_categorie)` faisant tout le travail. Le total porte le MEME perimetre : « 421 sur 1 259 » se lit « les filtres ecartent les deux tiers », jamais « ce departement ne pese rien dans la France ». ⚠ Compte les sites **IMPLANTES** sur le territoire, jamais ceux qui l'EXPOSENT : un site dont la zone deborde apporte sa population au voisin sans y compter comme site. Quota `geo:rl:risque-sites` 60/min — plus large que les 6 a 30 des routes voisines parce que celle-ci ne calcule rien : deux lectures d'index. Le plafond empeche une boucle, il ne protege pas un budget d'I/O |
| `/api/risques/zones/preparer` | POST | **Construit la geometrie des zones d'un profil** (sql/205), avant d'allumer la couche. Idempotente : un profil deja construit rend `deja_construit: true`. Pas de flux de progression, et c'est MESURE — **2 805 ms** pour les sept classes du profil par defaut sur la France entiere, unions, differences ET lissage compris ; une barre sur moins de trois secondes ajouterait du bruit sans rien apprendre. ⚠ Ce chiffre etait de **1 326 ms jusqu'au 2026-09-21** : sql/223 a ajoute la fermeture morphologique et `quad_segs=16`, qui doublent le nombre de sommets. Le cout est paye UNE fois par code de profil — la route lit le cache avant de construire et rend `deja_construit: true` — jamais a l'affichage ni par tuile. Construire a la premiere tuile serait tentant, mais un panoramique demande des dizaines de tuiles EN PARALLELE qui declencheraient chacune la meme construction. **`natures` ajoute le 2026-09-20** : elles entrent dans la CLE DE CACHE et pas seulement dans le calcul, la geometrie dependant du filtre depuis sql/220. Deux vues qui n'en different que par lui partageraient sinon une entree — la premiere construite servirait ses zones a la seconde, sous la legende de la seconde. La cle est composee par `codeZonesRisque` (`lib/risques/code-profil.ts`), la MEME fonction que la route de tuiles et que le composant de carte : c'est la seule chose qui garantisse que la couche demande des tuiles sous la cle qui vient d'etre construite. Sans nature retenue la cle est celle du profil seul, donc les caches anterieurs restent valides. Quota `geo:rl:zones-risque` 12/min |
| `/api/tiles/zones-risque/[z]/[x]/[y]` | GET | Tuiles MVT des zones d'un profil (`?profil=<code>`), **gzip obligatoire** — MapLibre 5.x plante silencieusement sans. Placee sous `/api/tiles/` a dessein : le matcher de `middleware.ts` raisonne par SEGMENT, la route tombe donc sous `/api/tiles/:path*` sans toucher au fichier protege. ⚠ Cache **non `immutable`**, contrairement aux tuiles IRIS et carreaux : celles-la portent une version dans l'URL, ici la cle est le PROFIL et les zones sont reconstruites quand les SITES bougent — sans que le code du profil en sache rien. 1 h de cache partage. Poids mesure, tuile brute : z4 43 ko (la France entiere), z7 5,0 ko, z10 943 o. **`natures=` ajoute le 2026-09-20**, en parametre SEPARE du profil pour que `profilDepuisCode` continue de valider ce qu'il sait valider ; la cle est recomposee par `codeZonesRisque` |
| ~~`/api/risques/diffusion`~~ | — | **SUPPRIMEE le 2026-09-20** avec l'onglet du meme nom. Le module de risque est devenu un ATELIER qui produit un jeu de zones reutilisable, et le suivi de la diffusion est retourne dans Campagne > Suivi, ou il a toujours vecu. ⚠ Elle n'est pas simplement DEPLACEE : elle ventilait les impressions du CODE POSTAL vers le CARREAU de 200 m, seule facon de repondre tant qu'il n'existait pas de plan. Il en existe un desormais, et il est bati au code postal (`zone_set_cp`) — mesurer l'ecart au plan a une granularite PLUS FINE que le plan n'ajoute pas de justesse, cela ajoute une hypothese de repartition intra-code-postal que le plan ne porte pas, et l'ecart affiche melangerait alors la derive reelle avec l'erreur de cette hypothese. Definition conservee dans sql/207, retrait sql/214 |
| `/api/risques/profil/export` | GET | **Classeur Excel du profil de rayons** : onglets Profil, Bandes, Territoires, Diffusion, plus « Methode et limites ». Appelle les MEMES RPC que l'ecran — un export qui recalculerait autrement finirait par diverger, et c'est le tableur qu'on croirait. ⚠ L'onglet **Profil** porte le CODE du profil : deux exports du meme territoire pris avec deux profils sont sinon indiscernables une fois sur un disque, et coller ce code dans l'URL du module restitue exactement la vue dont le classeur est issu. Exporte TOUTES les unites (`p_limite: 40000`), jamais la liste tronquee affichee — un tableur sert a regarder au-dela. L'onglet de methode voyage avec le fichier : sans lui, un lecteur additionnerait les impressions des classes ET le hors-zone, ou lirait la colonne « impressions » comme une mesure alors qu'elle est VENTILEE. Quota `geo:rl:risque-profil-export` 6/min, plus serre que les 30 de `/profil/bandes` — meme ecart que celui deja retenu entre `/exposition/agregats` et `/exposition/export` |
| `/api/zones/jeux` | GET/POST | **Les jeux de zones de l'organisation.** POST enregistre un jeu ET le construit — mesure : **21,3 s** pour 7 classes et 1 942 codes postaux sur la France. Synchrone a dessein : c'est un geste rare, et le rendre asynchrone imposerait une table de jobs et un ecran de suivi pour vingt secondes. Un jeu de meme nom cree une NOUVELLE VERSION, jamais un ecrasement — une campagne fige la version au rattachement, et ecraser ferait changer le plan sous une campagne en vol. Le jeu est RENORMALISE cote serveur : deux saisies equivalentes auraient sinon deux `profil_hash`, donc deux constructions de 21 s pour une seule question. Quota `geo:rl:zone-sets` 6/min |
| `/api/zones/jeux/[id]/rattacher` | POST | **Donne un jeu de zones comme PLAN a une campagne.** N'invente aucun chemin : alimente celui qui existe — `zone_set_cp` -> `genererPlanCp` (fonction PURE, testee) -> `bidding_zone_configs.bid_multiplier` -> `refresh_campaign_rollups` -> `campaign_cp_rollup.planned_share`. Lots de 50, et l'erreur de CHAQUE lot est lue : supabase-js ne leve pas, et un plan a moitie ecrit se presenterait comme complet. Un echec retire la strategie entiere — un plan partiel est pire qu'aucun plan. Rend `part_plan_en_zone` et `taux_utile`, les deux chiffres qui doivent voyager avec le plan. ⚠ **Le plan ACHETE tout le groupe de codes postaux indiscernables depuis le 2026-09-22** (`lib/zones/groupes.ts`, sql/228) : une ligne par membre, **multiplicateur divise par le nombre de membres**. La division n'est pas cosmetique — `refresh_campaign_rollups` normalise sur la somme des multiplicateurs, donc quatre lignes au meme multiplicateur donneraient a Nantes QUATRE FOIS sa part, et le score d'alignement la declarerait en sous-pression permanente sans qu'aucune diffusion n'y puisse rien. `n_retenus` compte les TERRITOIRES, jamais les lignes envoyees au DSP. **Archive les strategies precedentes de la campagne** (2026-09-20), et APRES l'ecriture du plan, jamais avant : les archiver d'abord laisserait la campagne sans plan actif si l'ecriture echouait ensuite, et les laisser en `active` ferait afficher deux strategies actives pour une seule campagne. Archivees et NON supprimees — une strategie porte l'historique de ce qui a ete pousse au DSP (`strategie_versions`, `activation_lots`), l'effacer rendrait un rollback aveugle. `anciennes_archivees` remonte au client : le plan serait bon, l'affichage non. Quota `geo:rl:zone-set-rattacher` 6/min |
| `/api/zones/jeux/[id]` | GET/PATCH/DELETE | Detail d'un jeu (ses classes, ses codes postaux), reglage, suppression. **PATCH ne reconstruit JAMAIS** : ni le nom, ni les poids, ni le mode de plan, ni meme le SEUIL de couverture ne changent une geometrie. Le seuil ne fait que trancher, code postal par code postal, a partir de quelle part en zone on achete — `appliquer_seuil_zone_set` (sql/215) le rejoue en **22 ms** contre 21,3 s pour une construction. Seul un changement de PROFIL impose de reconstruire, et il passe par `POST /api/zones/jeux`, qui cree alors une nouvelle version. ⚠ `CHAMPS_JEU` est UNE chaine litterale et non une concatenation : supabase-js deduit le type des lignes de la valeur litterale passee a `.select()`, et une concatenation lui donne `string`, donc `GenericStringError` et un echec de compilation a la premiere lecture de propriete. La propriete est verifiee ICI (`org_id`) et non par RLS — les routes passent par `createAdminClient()`, qui contourne toute policy |
| `/api/zones/jeux/[id]/cp-geo` | GET | **La carte des CODES POSTAUX d'un jeu — ce qu'on ACHETE** (sql/230, 2026-09-22). `?bbox=` bornee au cadre visible. Le module montrait depuis toujours ce qu'on MESURE (des anneaux au carreau de 200 m) et nulle part ce qu'on achete, qui est autre chose. ⚠ **UNE ligne par CODE POSTAL** alors que `zone_set_cp` en porte une par (code postal x grappe) : peindre le meme polygone quatre fois ferait passer un code postal partage pour un code postal plus expose. ⚠ **La part du plan vient de `genererPlanCp`**, la fonction PURE qui produit le plan reellement pousse au DSP — la recalculer ici donnerait une carte qui contredit le fichier qu'on envoie, et c'est la carte qu'on croirait. Elle est appelee **SANS la carte des groupes**, contrairement a `/rattacher` et `/export` : les codes postaux d'un groupe partagent une geometrie identique (sql/228), les etaler dessinerait quatre fois le meme polygone au quart de la part. Mesure : 1 904 features et 1,2 Mo sur la France, 145 ms cote base. Quota `geo:rl:zone-set-cp-geo` 30/min — plus large que l'export, la route etant relue a chaque panoramique et ne fabriquant rien |
| `/api/zones/jeux/[id]/grappes` | GET | **Les BASSINS d'un jeu**, avec leur ENVELOPPE et leurs codes postaux (sql/230). ⚠ Separee de `/cp-geo` a dessein : cette derniere est relue a chaque panoramique, les bassins ne dependent pas du cadre. ⚠ Les codes postaux VOYAGENT avec le bassin — le tableau les surligne AU SURVOL, et les chercher a la demande ferait une requete par ligne survolee. Mesure : 580 bassins, 186 ko, moins qu'une tuile. L'enveloppe et non la geometrie : le tableau ne dessine rien, il recadre. Quota `geo:rl:zone-set-grappes` 30/min |
| `/api/zones/jeux/[id]/export` | GET | **Export Excel d'un jeu de zones** : 5 onglets — le jeu et son profil, les classes et leurs poids, les codes postaux avec leur multiplicateur, les SITES ET LEURS RAYONS, et « Methode et limites ». A ne pas confondre avec `/api/risques/profil/export`, qui exporte une ANALYSE (combien d'habitants chaque anneau expose) : celui-ci exporte un OBJET DE TRAVAIL (ce qu'on va acheter). ⚠ **Les onglets « Codes postaux » et « Sites et rayons » sont DEUX EXPRESSIONS DE LA MEME intention, pas deux plans** — le premier sert les DSP qui ciblent au code postal, le second ceux qui ciblent par PROXIMITE (un point, un rayon) ; les pousser tous les deux ferait diffuser deux fois sur le meme territoire, et le classeur le dit. Le rayon exporte est le PLUS GRAND anneau du niveau du site, l'etendue reelle de sa zone. Le plan est RECALCULE par `genererPlanCp`, la fonction pure qui produit aussi celui du DSP — recopier la formule donnerait deux implementations qui divergent, et c'est le tableur qu'on croirait. Lecture PAGINEE des codes postaux et des sites (`lireTout`). Quota `geo:rl:zone-set-export` 6/min. Mesure : 163 ko, 5 feuilles, 5,3 s a chaud |
| `/api/zones/jeux/[id]/extractions` | GET/POST | **Les EXTRACTIONS d'un jeu de zones** (sql/231, Phase 4, 2026-09-23). POST fige le plan courant en une version immuable ; GET les liste. ⚠ **A ne pas confondre avec `/export` juste au-dessus** : celui-la RECALCULE a chaque telechargement, donc il suit le jeu — deplacer le seuil de couverture change le fichier sous le meme nom. Celle-ci FIGE, et c'est la seule facon de repondre trois semaines plus tard a « qu'est-ce qu'on avait envoye, exactement ? ». Deux boutons cote a cote ne le laissent pas deviner : l'ecran le dit en toutes lettres. **Le plan est calcule ICI, en TypeScript**, par `genererPlanCp` — la fonction PURE qui produit AUSSI celui pousse au DSP par `/rattacher` ; en ecrire une version SQL donnerait deux implementations qui divergeraient au premier correctif, et ce qu'on aurait archive ne serait plus ce qui est parti. La base ne fait que ce que seule la base sait faire : serialiser l'attribution du numero de version (`pg_advisory_xact_lock`, lecon de sql/159) et figer. **IDEMPOTENTE a contenu identique** — memes multiplicateurs, meme seuil, meme mode → la version existante et `deja_extraite: true`, plutot que des v2/v3/v4 jumelles que personne ne saura departager. Le commentaire n'entre PAS dans l'empreinte : deux extractions au meme contenu ne se distinguent pas parce qu'on les a annotees differemment. Refuse un BROUILLON (409) — une extraction porte le nom du jeu. Lecture PAGINEE (`lireTout`), `db-max-rows` plafonnant a 1 000. Mesure du 2026-09-23 : **1 927 codes postaux, 2 000 lignes ecrites** (l'ecart est l'etalement aux groupes indiscernables), 290 bassins nommes, 6,7 s de bout en bout dont 100 ms en base. Quotas `geo:rl:zone-set-extraire` 6/min et `geo:rl:zone-set-extractions` 30/min |
| `/api/zones/jeux/[id]/extractions/[version]/export` | GET | **Le classeur d'une extraction** : 5 onglets — Extraction (metadonnees et reglages figes), Codes postaux, Zones (recapitulatif par bassin), Sites et rayons, « Methode et limites ». Relit `zone_set_extraction_cp` et **ne recalcule RIEN** : si le jeu a ete re-regle depuis, ce classeur et celui du jeu different, et c'est voulu — l'onglet de methode le dit, sans quoi la difference passerait pour un defaut. ⚠ L'onglet **Zones** existe parce que la Phase 5 note le score PAR ZONE : le calculer a la lecture obligerait chacun a refaire le meme tableau croise, et chacun le ferait un peu autrement. ⚠ Les cellules de population sont VIDES et non a zero sur un code postal dont la population est comptee sous son canonique — un 0 se lirait « ce code postal n'expose personne ». Mesure : **165 ko, 2 001 lignes de codes postaux, 291 zones, 718 sites**, 18,5 s a froid. 404 qui NOMME la version absente. Quota `geo:rl:zone-set-extraction-export` 6/min |
| `/api/zones/jeux/[id]/simulation` | GET/POST/DELETE | **La simulation de campagne d'un jeu — étape ⑤** (sql/232, 2026-09-24). GET rend en UN appel tout ce que l'écran lit : la dernière simulation, les entrées de l'extraction v1 (plan, bassin, population, part en zone, centroïde), les multiplicateurs v2, les bassins et les agrégats (`simulation_agregats`). POST, **flux NDJSON avec progression**, crée une campagne `est_simulation`, génère les semaines 1-2 sur l'extraction choisie (`lib/simulation/generateur.ts`, fonction pure à graine fixe) et les écrit dans `dsp_campaign_data` par **lots de 50, trois lots simultanés au plus**. DELETE purge la campagne (impressions et simulation en cascade) ET l'extraction v2 que son recalage a créée — elle est un produit de simulation, la laisser ferait croire qu'un recalage réel a eu lieu. **Une simulation par jeu** : simuler à nouveau remplace la précédente. Mesure : **83 977 lignes écrites en 11,2 s**. ⚠ Un échec en cours d'écriture supprime la campagne entière : un alignement calculé sur une diffusion amputée se présenterait comme complet. Quotas `geo:rl:zone-set-simulation` 4/min (écriture), `geo:rl:zone-set-simulation-lecture` 30/min |
| `/api/zones/jeux/[id]/simulation/recaler` | POST | **Le recalage v1 → v2**, flux NDJSON. Lit les impressions UTILES observées des semaines 1-2 par bassin, corrige les multiplicateurs zone par zone (`lib/simulation/recalage.ts` : rapport part du plan / part diffusée, borné entre ÷3 et ×3 et AMORTI, puis baisse des codes postaux très dilués), **fige le plan corrigé en vraie extraction d'origine `recalage`** par `creer_zone_set_extraction` — la même RPC que la Phase 4 — puis diffuse les semaines 3-4 dessus. ⚠ Un échec ramène la simulation à son état v1, EN ENTIER : lignes v2 et extraction v2 supprimées. 409 si la simulation est déjà recalée. Mesure : **84 000 lignes en 11,0 s**, alignement 62 → 89 sur le jeu « Seveso France » sans aucune valeur forcée |
| `/api/zones/jeux/[id]/simulation/carte` | GET | Bassins (géométrie simplifiée au zoom) et sites du jeu dans un cadre (`?bbox=` OBLIGATOIRE — jamais la France entière par défaut), RPC `simulation_carte`. ⚠ **Aucune donnée de diffusion** : l'écran fusionne les indices côté client, donc changer de période ne redemande aucune géométrie. 0,2 s en base sur la métropole entière, 261 ko. Quota `geo:rl:zone-set-simulation-carte` 60/min |
| `/api/zones/jeux/[id]/simulation/export` | GET | **Classeur Excel de la simulation** : Extraction (multiplicateurs v1 et v2 par CP), Diffusion par CP, Alignement par zone (parts et indices v1 et v2), Journalier (score jour par jour), plus « Méthode et limites ». Lit `construireVue` et `courbeAlignement` (`lib/simulation/vue.ts`), les MÊMES fonctions que l'écran — un export qui recalculerait autrement finirait par diverger. Quota `geo:rl:zone-set-simulation-export` 6/min |
| `/api/risques/exposition/cibles` | GET | Catalogue des cibles calculables (`cibles_exposition`, sql/185) : 24 EFFECTIFS, aucun taux. Lu depuis la base et non ecrit en dur, pour que le menu ne puisse pas proposer une cible que la RPC refuserait — les deux lisent la MEME table. Cache prive 24 h |
| `/api/risques/[siteId]/exposition` | GET | **Population exposee d'un site a risque industriel** (sql/180). DEUX MODES : `pprt` quand une servitude PPRT est a moins de 500 m — la zone est celle de l'Etat, `indicatif: false` — sinon `buffer` sur 500/1000/2000 m avec **`indicatif: true`**, un drapeau qui doit remonter jusqu'a l'ecran : le meme nombre d'habitants ne vaut pas la meme chose selon que la zone vient d'un arrete prefectoral ou d'un rayon que nous avons choisi. Lit le cache `seveso_exposition`, calcule et l'alimente si vide. **Ce n'est PAS un pre-calcul de masse** : les 96 427 sites d'un coup couteraient autant d'intersections sur `carreaux_filosofi` (2,3 M lignes), soit la famille exacte de l'incident du 28/03. `?recalculer=1` force le recalcul. `requireAuth` (pas admin) ; hors `PROTECTED_API_PREFIXES` du middleware, comme `/api/map/pprt` |
| `/api/tiles/[z]/[x]/[y]` | GET | Tuiles MVT carreaux (gzip obligatoire). **Cascade `get_tile` calee sur la taille apparente des mailles** (une choroplethe se lit entre 10 et 40 px par carreau) : `z<=6` 20 km · `z7` 5 km · `z8` 2 km · `z9-11` **1 km** · `z>=12` 200 m (sql/129). Ne PAS redescendre le seuil du 200 m sans avoir d'abord donne des colonnes typees a `carreaux_filosofi` : ses 4,6 Go et son jsonb de 806 o/ligne imposent un plancher d'environ 4 s par tuile froide (mesure faite quand le compute etait annonce Nano ; le palier reel est Micro, voir « Budget I/O Supabase » plus bas — le plancher, lui, a ete chronometre et reste vrai). Chaque feature porte `superficie_km2` (sql/122), consomme par `lib/carreaux/normalisation.ts` pour rendre les indicateurs comparables entre paliers de zoom. **Tout changement du schema de tuile (colonnes ajoutees/retirees) impose de bumper `CARREAUX_TILE_VERSION` dans `lib/version.ts`** — sinon une tuile en cache (jusqu'a 1 h) reste servie avec l'ancien schema pendant que le front attend le nouveau. |
| `/api/tiles/iris/[z]/[x]/[y]` | GET | Tuiles MVT IRIS (RPC `get_iris_tile`, sql/139) — cascade departement/commune/IRIS, plancher `IRIS_ZOOM_PLANCHER`. Placee sous `/api/tiles/` a dessein : le matcher de `middleware.ts` raisonne par SEGMENT. Voir la section « IRIS : tuiles MVT servies par Postgres » |
| `/api/tmja-tiles/[z]/[x]/[y]` | GET | Tuiles MVT du flux routier (`comptages_routiers`), pipeline calque sur celui des carreaux. ⚠ 99,7 % de cette table est un proxy OSM a 11 valeurs constantes et non du TMJA mesure — arbitrage produit en cours |
| `/api/map/territory-mask` | POST | Geometrie d'un territoire (region/departement/CP) pour le masque MapLibre cote client — meme union admin que `/api/custom-geo/source/admin` |
| `/api/insee-variables/[code]/geojson` | GET | Polygones CP d'une bbox enrichis de la valeur d'une variable INSEE (couche indicateurs) |
| `/api/insee-variables/cp-detail` | GET | Commune principale d'un code postal + nombre de communes associees — popup de la couche ci-dessus |
| `/api/ref/geo` | GET | Referentiel regions/departements INSEE lu EN BASE (`ref_regions` + `ref_departements`). Remplace `lib/geo/france-admin.ts` partout ou la liste doit etre a jour |

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
| `/api/poi-clusters/count` | GET | Nombre de POI clusterises |
| `/api/poi-clusters/poi-types` | GET | Types de POI disponibles, avec total et nombre deja clusterise |
| `/api/poi-clusters/france-averages` | GET | Moyennes nationales Filosofi (reference du radar de clustering) |
| `/api/poi-clusters/model` | GET | Modele courant |

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
| `/api/civic-indicators/health-map` | GET | Carte sante environnementale : `dataset=pollen\|atmo`, `scale=departement` (stream NDJSON 1 commune/dept, pollen ET air par ligne) ou `scale=cp` (lecture `pollen_map_daily`/`atmo_map_daily`, filtres `min_level` 0-6 + `metric` + `bbox` optionnelle, Tache 4 — resolue via la RPC `codes_postaux_dans_bbox`, PAS un filtre direct sur `ref_codes_postaux.centroid_lat/lon` qui sont NULL sur toutes les lignes) — layer CivicHealthMapLayer, section Sante environnementale. **2026-09-13** : `scale=departement` passe par `getHealthEnMasse` (lib/civic-health/get-health.ts) — cache lu et ecrit PAR LOTS, ~5 requetes de base au lieu de jusqu'a 312 (3 par commune) ; `scale=cp` avec plus de 500 CP dans la bbox lit la table nationale et filtre en memoire, un `.in()` plus long depassait la limite d'URL PostgREST en silence |

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
| `/api/digital/[campaignId]/actors` | GET | Acteurs de la campagne (DSP / social / regie) avec livre, depense, CPM, part et atteinte d'objectif — alimente « Qui a diffuse » du Suivi V2 (RPC `get_campaign_actors`) |
| `/api/digital/[campaignId]/pacing` | GET | Diagnostic plan-vs-reel PAR ITEM de zone (`?version=`) : parts intra-zone, ecart, statut, spillover. Distinct de `/suivi`, qui agrege au niveau campagne |
| `/api/digital/[campaignId]/custom-zone/[zoneId]` | GET | Croisement campagne x zone custom → GeoJSON + resume, meme forme que `/map` |
| `/api/digital/[campaignId]/ai-analysis` | POST | Analyse Gemini performances geo |
| `/api/digital/[campaignId]/campaign-chat` | POST | Chat IA « Suivi campagne » — streaming Gemini, historique ephemere cote client, contexte serveur borne (stats geo RPC 098 + journal strategie 25/15/10 + breakdown IRIS 30) |
| `/api/digital/[campaignId]/suivi` | GET | Payload complet du cockpit de suivi (pacing, CPM, pression tenue, alertes, depts, quotidien) — lit les rollups uniquement, backfill lazy si absents (campagnes avec strategie). Route KEPT (Tache 16) : `pacing.total_budget` + `daily` alimentent la trajectoire budget de `suivi-v2/DetailTechnique.tsx` |
| `/api/digital/[campaignId]/suivi/map` | GET | Choroplethe CP du suivi (`?metric=hold\|cpm&bbox=`) — features GeoJSON pour SuiviMapLayer |
| `/api/digital/[campaignId]/reconcile` | GET | Payload de reconciliation DSP ⇔ ad server (taux de mesure global, composition de l'achat par canal, tendance) — lit campaign_dsp_report + rollups |
| `/api/digital/[campaignId]/reconcile/pull` | POST | (Re)construit le rapport DSP (requireAdmin) : demo → RPC simulate_dsp_report ; prod → lib/dsp/report par canal connecte (API, skipped si non connecte — jamais d'import fichier) |
| `/api/digital/[campaignId]/reconcile/map` | GET | Choroplethe CP de reconciliation (`?metric=measure\|dspcpm&bbox=`) — SuiviMapLayer source reconcile |
| `/api/bidding/strategies/[id]/publier` | GET/POST | **Versionnage de strategie** (Tache 19, sql/157, corrigee sql/159). POST fige l'etat courant et une empreinte de CONTENU de ses zones — hachage de la geometrie plus les comptes de CP/IRIS resolus (RPC `empreinte_zones`) ; GET compare cette empreinte a l'etat courant et rend les zones qui ont DERIVE depuis. **Ce n'est PAS `updated_at`** : le seul UPDATE que `PATCH /api/custom-geo/[id]` autorise est un RENOMMAGE, qui bougeait la date et bloquait l'activation pour un geste cosmetique, tandis qu'aucun chemin applicatif ne modifie la geometrie d'une zone existante — la derive que la fonctionnalite pretendait detecter n'etait atteignable par rien. POST est IDEMPOTENT (empreinte + charge utile identiques -> la version existante, `deja_publiee: true`) et serialise par `pg_advisory_xact_lock`. Une strategie publiee a envoye ses encheres au DSP avec un perimetre fige : si la zone bouge — et le lot Zones vient d'ajouter cinq facons de la modifier — la campagne diffuse sur un perimetre qui n'est plus celui de la carte, et rien ne le signalait. Ne pousse RIEN vers un DSP : publier, ici, c'est enregistrer un point de repere |
| `/api/campaigns/[campaignId]/activation/prevol` | GET | **Pre-vol, strictement en LECTURE** (Tache 20) : ce qui partirait, et surtout ce qui l'empeche. Bloque si la strategie n'est pas publiee (le retour arriere serait aveugle) ou si elle a DERIVE (une zone a bouge depuis la publication : pousser enverrait un perimetre que personne n'a valide). **Troisieme blocage ajoute le 2026-09-15 : le DROIT de pousser.** `/activation/pousser` re-appelle en HTTP `/api/admin/dsp/dv360/targeting/push`, dont le guard est `isSuperAdmin` STRICT — `requireAdmin()` de ce projet n'est pas « admin », c'est « super_admin ». Un `admin` ou un `client` de l'org proprietaire lisait un pre-vol `activable: true`, cliquait, et ne decouvrait le refus qu'apres l'ecriture d'un `activation_lots` et de ses 50 `activation_cibles`, toutes en echec — 51 lignes pour rien. `/activation/pousser` refuse desormais en 403 AVANT d'ecrire quoi que ce soit. Les blocages sont rendus comme une liste, pas comme une erreur HTTP — la page doit montrer le reste du pre-vol en expliquant ce qui manque. La derive est mesuree par la MEME RPC `empreinte_zones` que `/publier` : comparer deux mesures obtenues autrement rendrait la derive systematique |
| `/api/campaigns/[campaignId]/activation/pousser` | POST | **Poussee par line item, flux NDJSON** (Tache 20). ENVELOPPE `/api/admin/dsp/dv360/targeting/push` sans le reecrire. Rejoue le pre-vol cote serveur — on ne pousse pas sur la foi d'un appel client, une zone a pu bouger entre son pre-vol et son clic. Le corps est lu AVANT d'ouvrir le flux (incident du 08/04 : `request.formData()` dans `ReadableStream.start()`), et `etat_avant` est ecrit AVANT chaque appel sortant. ⚠ **Corrige apres relecture** : `bulkEditAssignedTargetingOptions` repond HTTP 200 avec `failedLineItemIds` NON VIDE quand DV360 refuse un line item — tester `res.ok` seul enregistrait « terminé, 20 poussés » un lot que DV360 avait entierement refuse. Le statut lit desormais `failed_line_item_ids`. Le lot est ferme dans un `finally` (un flux interrompu ne laisse plus un lot `en_cours` eternel), l'enqueue est gardee apres `cancel()`, et l'appel sortant passe par `fetchAvecDelai(…, 60 s)` |
| `/api/campaigns/[campaignId]/activation/historique` | GET | Les lots passes, leur statut et leurs compteurs par line item. Compteurs en UNE requete, jamais une par lot (incident du 08/04). Borne a 50 |
| `/api/campaigns/[campaignId]/activation/rollback` | POST | Marque un lot annule. **Ne retire RIEN du DSP, et le dit** (`retire_du_dsp: false`) : la poussee DV360 est additive et la route de push ne rend pas la liste exacte des geo IDs assignes — les retirer risquerait d'effacer un ciblage pose par un autre lot ou un operateur. Un retour arriere qui efface le travail de quelqu'un d'autre est pire qu'un retour arriere absent. Confirmation explicite exigee (`confirme: true`). **409 sur un lot `en_cours`** : sa boucle de poussee tourne encore et repasserait le lot en `termine` juste apres l'annulation — une annulation qui ment est pire qu'une annulation refusee |
> **Quota commun aux cinq routes `alignement/*`** (`geo:rl:alignement`, 60/min par
> utilisateur, compteur PARTAGE en base — sql/135). Ajoute le 2026-09-15 : il manquait
> par symetrie avec `geo:rl:analyse-score` et `geo:rl:analyse-correlation` (12/min), pas
> par urgence. Mesure sur la plus lourde des cinq, `alignement_par_maille_geo(…, 'cp', …)` :
> 288,7 ms, `shared hit=10490`, 0 lecture disque — mais ces 10 490 buffers sont tous en
> cache SUR LA SEULE CAMPAGNE EN BASE ; la meme page sur une campagne froide, ou plusieurs
> onglets, passe par le disque sans plafond partage. 60 et non 12 : un chargement de
> l'ecran Suivi emet a lui seul CINQ appels (un par route) et chaque descente dans le fil
> d'Ariane en emet quatre — a 12/min le plafond aurait mordu sur l'usage normal.

| `/api/campaigns/[campaignId]/alignement` | GET | **Score d'alignement geographique** (Tache 5, sql/165) : 0-100, TOUJOURS calcule au code postal (jamais a la maille affichee, sans quoi agreger d'abord lisserait les ecarts et le score monterait mecaniquement au dezoom), penalise sous-pression ET sur-pression (`?tolerance=&poids=`, defaut sur `dsp_campaigns.tolerance_pct`/`.overpressure_weight`). Garde-fou : `plan_divergent` signale si `planned_share` n'est plus une propriete du seul CODE POSTAL (verifie a ecrire : une seule valeur distincte par CP). `etalon` lu a part sur les parametres PAR DEFAUT, et **rendu `null` tant que `n_campagnes = 0`** (2026-09-15) : `sql/166` a pose une graine `score_median=64` en annoncant « a remplacer par le calcul reel », et aucun code n'ecrit jamais dans `etalon_alignement` — le 64 partait donc au client comme une « moyenne du secteur » que personne n'avait calculee. Un repere faux est pire qu'un repere absent ; le type `ReponseAlignement` prevoit deja `etalon: {…} | null`. **Campagne sans donnees de diffusion (sql/172)** : la RPC rend `{error: 'aucune_donnee', calculable: false}` et la route un 404 avec une phrase francaise — jamais un score de 0, qui ne venait pas d'un calcul mais d'un `greatest(0, NULL)`. Les codes metier de la RPC ne repartent plus tels quels au client (`campagne_introuvable` etait rendu brut). `variation_7j` n'est derive que si `prev_7j_calculable` (sql/172) : sur une campagne d'une semaine, `score_prev_7j` retombait a 0 par le meme accident et l'ecran annoncait « +93 points en 7 jours ». Jumeau TypeScript `lib/campagne/alignement.ts`, croise avec la RPC a l'implementation (accord exact sur le chemin nominal, 2026-09-14 ; **et sur le cas degenere depuis sql/172** — les deux rendent « pas calculable », la ou le TS disait 100 et le SQL 0) |
| `/api/campaigns/[campaignId]/alignement/maille` | GET | **Agregation par maille** (Tache 6, sql/165, `?maille=region\|departement\|cp&parent=&limite=`) : les memes ecarts que `calculer_alignement_geo`, regroupes a la maille demandee pour le tableau/les tuiles carte/le fil d'Ariane — le score lui-meme ne change JAMAIS avec la maille. Jointure INSEE reelle (`ref_codes_postaux.code_dept` → `ref_departements` → `ref_regions`), jamais `campaign_cp_rollup.dept` qui effondre tous les DROM sur `97` sans nom. En maille `cp` SANS parent, plafond fixe a 200 unites cote route (vue nationale ~2041 CP) avec `n_total` toujours renseigne — jamais de liste presentee comme exhaustive |
| `/api/campaigns/[campaignId]/alignement/constats` | GET | **« Ce qu'il faut corriger »** (Tache 11) : au plus trois constats CALCULES (`calculerConstats`, `lib/campagne/constats.ts`) — jamais de texte redige en dur. Trois familles evaluees dans cet ordre, chacune produisant au plus un constat : concentration de la sous-pression (departements les plus en retard, impressions manquantes ré-estimées depuis `ecart_pct`), concentration de la sur-pression (symetrique, euros deplacables via le CPM de l'unite — Ruling T11-2 : compte aussi EN TOTALITE les unites `hors_plan` — plan nul, `ecart_pct` donc null — que le filtre initial ignorait en silence, ~19,6 % des CP sur la campagne demo), canal le plus cher (`cpm > cpm_moyen × SEUIL_CPM_CHER` — 1,25, constante EXPORTEE pour que la Tache 14 « Qui a diffuse » ne la retype pas). **Ruling T11-3 (2026-09-15)** : le TRI de la sur-pression et la MESURE AFFICHEE sont la meme grandeur — les euros. Classer par volume puis titrer en euros laissait une unite au `cpm` nul gagner le classement avec `eur: 0`, et le constat annoncait « X et Y concentrent la sur-pression : 0 € deplacables », une phrase qui se contredit elle-meme. Sans aucune depense connue sur les unites retenues, le constat chiffre le VOLUME (« N impressions a redeployer ») plutot qu'un zero qui nierait le constat qu'il porte — toujours chiffre, jamais un adjectif. Compose DEUX RPC sequentielles (jamais de `Promise.all` au-dela des deux deja groupes dans `checkCampaignAccess`) : `alignement_par_maille` (maille departement, vue nationale) pour les unites, `get_campaign_actors` (n'exige pas de strategie active, agrege `campaign_daily_rollup`) pour les canaux. **Ruling T11-1** : `cpm_moyen` est derive des CANAUX eux-memes (`Σ depense / Σ impressions × 1000`, pondere) et non de `calculer_alignement_geo` (`campaign_cp_rollup`) — comparer le CPM d'un canal issu de `campaign_daily_rollup` a une moyenne issue d'une AUTRE table n'a pas de sens, meme quand `refresh_campaign_rollups` (sql/113) les remplit avec des filtres differents (`date IS NOT NULL` vs `postal_code IS NOT NULL`) qui coincident aujourd'hui sans garantie de le rester |
| `/api/campaigns/[campaignId]/alignement/dispersion` | GET | **Histogramme de dispersion des ecarts au plan par CP** (Tache 12, sql/165, **corrigee sql/171**, `?parent=&tolerance=`) : sert la maille CP de `GraphiqueEcart`, ou une courbe de ~2000 points ne raconte plus rien — remplacee par 7 bandes fixes (`BORNES_DIVERGENTES`). `tolerance` est accepte pour la parite d'interface mais sans effet : les bandes sont l'echelle divergente universelle du produit, pas un reglage par campagne. **Correction apres relecture** : la RPC calcule ses totaux de normalisation sur le PERIMETRE COMPLET de la campagne, jamais sur le seul `parent` filtre — meme ruling que `alignement_par_maille` (T6-2) ; calculer sur le sous-ensemble filtre aurait rendu tout drill-down departemental muet par construction (verifie sur le departement '13' de la campagne demo, qui ne recoit que 51,6 % de son plan national). Les ~400 CP a plan nul (19,6 % de la campagne demo) ne disparaissent pas : ils atterrissent dans une ligne a part, bornes `null`, comptee separement des 7 bandes numerotees. **`parent` est un code de DEPARTEMENT, jamais de region** (sql/171) : l'en-tete annoncait « ou, a titre permissif, une region » et la RPC filtrait `code_dept OR code_region` — mais 18 codes INSEE designent les deux, et `parent=75` (Paris, 21 CP) rendait 164 CP dont 143 en Nouvelle-Aquitaine |
| `/api/campaigns/[campaignId]/pression-classes` | GET | **Pression reelle par CLASSE DE ZONE**, rapportee a la part du PLAN (sql/216). Indice = part des impressions / part du plan x100, repere a 100. ⚠ **Le denominateur est le PLAN et non la population** : l'onglet « Diffusion » supprime le meme jour comparait a la population faute de plan, ce qui melange deux questions — « cette zone est-elle sur-pressee au regard de son poids demographique ? » et « la campagne tient-elle son plan ? ». Seule la seconde est actionnable : on ne corrige pas une demographie, on corrige une enchere. ⚠ **Aucune ventilation** : `campaign_cp_rollup` et `zone_set_cp` sont au MEME grain, le code postal — ce que l'ecran affiche est MESURE, pas estime, et c'est la premiere fois. 409 `plan_sans_zones` si le plan vient d'un indicateur (la campagne existe, il n'y a simplement rien a ventiler) ; l'ecran n'affiche alors pas le bloc. Rend aussi le PROFIL du jeu : sans lui les bandes se nommaient « NaN km a ? ». Quota `geo:rl:alignement` PARTAGE avec les cinq routes `alignement/*` — c'est une section du meme ecran, lui donner son propre compteur elargirait le plafond sans le dire. Mesure : 14 ms sur la campagne de demonstration |
| `/api/campaigns/[campaignId]/alignement/maille/map` | GET | **Geometrie des trois vignettes carte du Suivi V2** (Tache 13A, sql/165, `?maille=region\|departement\|cp&parent=&variable=&bbox=&limite=`) — RPC dediee `alignement_par_maille_geo`, JAMAIS `alignement_par_maille` qui sert le tableau (ruling T6-1, pas besoin de 2041 polygones pour sept lignes). Variable du plan par defaut = celle de la strategie de bidding active de la campagne (`bidding_strategies.in_zone_weights->>'variable_code'`), repli sur `abstention_pres_2022` — jamais une constante recopiee, `?variable=` la surcharge (selecteur `cible_indicator_registry`). Maille region SANS parent est la racine (meme garde 400 que `alignement/maille`, ruling T6-4). Bbox par defaut = metropole, meme defaut que `suivi/map` — c'est aussi elle qui fixe cote RPC la tolerance de simplification de la geometrie (**ruling T13A-1**). **2026-09-20** : le repli sur `abstention_pres_2022` ne vaut QUE pour un plan bati sur un indicateur. Un plan issu d'un JEU DE ZONES n'a aucune variable derriere lui, et y replier faisait afficher « taux d'abstention » sous le titre « la variable qui a servi a batir le plan », pour une campagne dont le plan vient d'anneaux autour de sites classes. La reponse porte desormais `source_plan` (`lib/campagne/source-plan.ts`, source UNIQUE de cette lecture) et chaque unite porte `part_plan_pct` (sql/216) — la part du plan elle-meme, qui se passe de proxy. La vignette du milieu bascule alors du type `variable` au type `plan`, et son selecteur d'indicateur disparait : il choisirait une variable qui ne pilote rien |
| `/api/bidding/strategies/[id]/export` | GET | Fichier custom bidding « fidèle à la pression » par canal (`?channel=` du dsp_channel_registry) : scores par CP interpolés sur la courbe INSEE, 5 paliers quantiles, hors-zone 0 (zones strictes) ou 1 (national+surpression) — dv360 script .py / tiktok fiche / autres CSV `postal_code;score` (lib/digital/bidding-export.ts, étape 5 Lancement). **Branche `by_zone_set` (2026-09-20)** : un plan issu d'un jeu de zones n'a ni indicateur ni courbe — son multiplicateur a ete calcule une fois par `genererPlanCp` et vit deja dans `bidding_zone_configs`. La route le LIT au lieu de le refaire ; sans cette branche elle rendait `no_scores` en 422 (`variableCode` null, donc `values` vide, donc `cps` vide) alors que le plan existait. Le recalculer serait une SECONDE implementation de `genererPlanCp`, qui finirait par diverger de celle qui a produit le plan reellement pousse au DSP. La lecture est PAGINEE — `db-max-rows` plafonne a 1 000 et un plan national en porte pres de 2 000. Le catch-all suit le MODE : `exclusif` -> 0 (un ×1 rouvrirait la diffusion sur ce que le seuil vient d'ecarter), `pondere` -> 1 (le jeu ne couvre que les codes postaux a moins de 10 km d'un site, portee du pre-calcul ; le reste de la France est hors FICHIER sans etre hors PLAN). Mesure de bout en bout : script DV360 de 18 ko, 5 paliers, en-tete « jeu de zones » |

### Radio FM/DAB+ (protegees par `requireAuth()`)
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/radio/stations` | GET | Liste radios + nb emetteurs (pagine) |
| `/api/radio/emetteurs` | GET | GeoJSON emetteurs (RPC PostGIS) |
| `/api/radio/filter-options` | GET | Options filtres (categories, groupes) |
| `/api/radio/stats` | GET | Stats radios |
| `/api/radio/audit` | GET | Audit matching radio |
| `/api/radio/data` | DELETE | ⚠️ **Suppression** des donnees radio (`{ target: 'emetteurs' \| 'radios' \| 'all', confirm }`, `requireAdmin()`) — et NON un GET « donnees radio », comme ce tableau l'annoncait jusqu'au 2026-09-16. **Le fichier n'est pas suivi par git** (motif `data/` de `.gitignore:45`) : il n'existe donc pas en production, ou le bouton de `/admin/radio` repond 404. Voir la note de la section « RLS — DORMANTES » |
| `/api/radio/import-anfr` | POST | Import ANFR (requireAdmin) |
| `/api/radio/import-arcom-ods` | POST | Import Arcom ODS (requireAdmin) |
| `/api/radio/crawl-arcom` | POST | Crawl + matching Arcom (requireAdmin) |
| `/api/radio/imports-history` | GET | Historique imports |
| `/api/radio/import-logs/[logId]` | GET | Logs import |

### Meteo
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/meteo-geo` | GET | Meteo Open-Meteo agregee par zones admin (NDJSON streaming, echantillonnage spatial ≤500 points/appel, bbox viewport optionnelle en mode cp). **Corrigee le 2026-09-13** : le palier `cp` repondait TOUJOURS `500 No zones found` (sql/160, voir `get_zone_centroids`) ; l'appel Open-Meteo etait un `fetch` NU sans delai (desormais 20 s par tentative, reprise sur 429 minute, echec immediat sur quota horaire) ; la bbox est arrondie VERS L'EXTERIEUR au demi-degre et c'est cette bbox arrondie qui filtre les zones ET forme la cle de cache (avant, deux vues voisines partageaient une cle pour des jeux de zones differents) ; periode bornee des deux cotes ; quota `geo:rl:meteo-geo` 20/min par utilisateur (un appel = jusqu'a 500 unites du quota Open-Meteo gratuit). Logique pure testee dans `lib/meteo/requete.ts` |
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
| `/api/admin/campaigns/[id]/metrics` | GET | KPIs reellement remplis (`available`) et declares-mais-vides (`empty`) d'une campagne — pilote le selecteur de KPI (RPC `get_campaign_available_metrics`) |
| `/api/admin/campaigns/[id]/aggregate` | GET | Total agrege d'UN KPI (`?metric=`), valide contre `dsp_metrics_registry` — 400 sur un champ inconnu |

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
| `/api/admin/import-georisques` | POST | **Installations classees (ICPE) de l'API Georisques** vers `poi_france`, categorie `risque_industriel` (sql/173, spec du 2026-09-17). Flux NDJSON avec progression, lots de 50, `id` deterministe derive du `codeAIOT` — donc rejouable sans doublon (verifie : 1534 -> 1534 au rejeu). Corps `{departements?: string[], page_size?: number}`, defaut = les 101 departements. **Trois mesures a ne pas re-deviner** : `page_size` plafonne a **1 000** (a 2 000 l'API rend ZERO ligne, sans erreur) ; le filtre `statut_seveso` de l'API **est ignore** (il rend les 138 423 lignes quelle que soit la valeur), donc on ingere et on classe en base ; et l'endpoint sert aussi des etablissements `regime = 'Non ICPE'` qui ne sont PAS des installations classees — **19 % du volume national**, ecartes et comptes a part (`hors_perimetre`), jamais en silence. L'upsert MET A JOUR (referentiel vivant), donc `.select('id')` rend tout le lot : le compteur s'appelle `ecrites`, pas `inserees` |
| `/api/admin/import-pprt` | POST | **Perimetres PPRT (servitudes PM3) de la Geoplateforme IGN** vers `pprt_perimetres` (sql/177). Flux NDJSON avec progression. UN appel sortant — le WFS `wfs_sup:assiette_sup_s` filtre `suptype='pm3'` rend les **664 assiettes en une fois** (5,6 Mo) — puis UNE transaction par partition (69 documents deposes au GPU). Corps `{partitions?: string[]}` pour rejouer un seul document. Mesure : 664 ecrites en 11,2 s, 0 rejetee, 0 echec. ⚠ Ne PAS passer par le WFS Georisques `PPRT_PERIMETRE_RISQIND` malgre son nom : ~147 000 lignes, tous les PPR confondus, `CQL_FILTER` ignore en silence — voir § « Perimetres PPRT » |
| `/api/admin/import-datagouv` | POST | Import data.gouv.fr (SSRF whitelist). **Idempotent** depuis le 2026-09-11 : `id` deterministe (`lib/import/identite-poi.ts`, source `data_gouv`) + `upsert onConflict: 'id'`, donc un re-import du meme jeu n'ecrit rien. Les compteurs du flux NDJSON portent `inserted` ET `ignored` (deja presents) |
| `/api/admin/import-geo/*` | POST | Import Shapefile |
| `/api/admin/geocode/batch` | POST | Geocode batch BAN |
| `/api/admin/geocode/update` | POST | Mise a jour geocodage |
| `/api/admin/health` | GET | Monitoring DB |
| `/api/admin/qualite-donnees` | GET/POST | **Etat des donnees manquantes** (sql/149) : indicateurs du registre pointant vers du vide, fraicheur des sources a cadence attendue, invariants metier valides contre l'INSEE, remplissage colonne par colonne d'`iris`. Distincte de `/api/admin/health`, qui regarde l'INFRASTRUCTURE : celle-ci regarde le CONTENU. GET lit les releves PERSISTES (`qualite_releves`) sans rien recalculer ; POST relance **UNE** verification, jamais plusieurs — le balayage d'`iris` coute ~220 Mo et 1,4 s, et un bouton « tout verifier » serait l'incident du 28/03 rejoue par l'outil cense le prevenir. Quota `geo:rl:qualite-donnees` **2/min** — la doc annoncait 6/min, le code applique 2 depuis qu'il a ete mesure qu'a 6/min ce quota laissait passer 4,4 fois le budget d'I/O qu'il pretendait proteger (corrige ici le 2026-09-15 : une doc qui promet un plafond plus large que le code est ce qui fait dimensionner le suivant de travers) |
| `/api/admin/fraicheur-donnees` | GET/POST | **Fraicheur des sources HORS socle socio-demo** (sql/161), onglet « Fraicheur donnees » de `/admin/health` : d'ou vient chaque donnee, comment elle entre, ou elle atterrit, de quand elle date. POI/IRIS/Filosofi en sont exclus, ils relevent de `/admin/qualite-donnees`. Ce qui est DECLARE (`lib/donnees/registre-fraicheur.ts` : fournisseur, mode de collecte, table, nature) et ce qui est MESURE (la RPC) ne se melangent jamais — aucune date n'est ecrite en dur. GET lit le releve PERSISTE dans `qualite_releves`, ne mesure rien. POST mesure : quota `geo:rl:fraicheur` 6/min pour la passe ordinaire (moins de 15 Mo lus), `geo:rl:fraicheur-lourd` **1/min** pour le flux routier seul — `max(created_at)` sur `comptages_routiers` est un Seq Scan de 44 505 blocs, soit **347 Mo lus et 1,78 s mesures** (BRIN sur la colonne, et un BRIN n'accelere pas un `max()`). Le releve est **FUSIONNE** source par source : une passe legere laisse le flux routier non mesure, et sans cette fusion son millesime payé 347 Mo disparaitrait au premier clic sur « Relancer la mesure » |
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
| `/api/admin/custom-geo/list` | GET | Liste CROSS-WORKSPACE des `custom_geo_zones` (super_admin, service role) |
| `/api/admin/custom-geo/stats` | GET | Stats cross-workspace des zones, pour la carte d'en-tete de `/admin/sources` |
| `/api/admin/custom-geo/[id]` | DELETE | Suppression cross-workspace d'une zone (override RLS) |
| `/api/admin/import-geo/register` | POST | Enregistre une source geo importee (pendant de `/api/admin/import-geo/*`) |

### Multi-tenant utilisateur
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/user/organizations` | GET | Orgs de l'utilisateur courant |
| `/api/user/switch-org` | POST | Changement d'org active |
| `/api/auth/[...auth]` | GET/POST | Catch-all INERTE. L'authentification se fait entierement cote client par le SDK Supabase ; cette route existe pour qu'un appel a `/api/auth/*` reponde autre chose qu'un 404 |

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
| `/api/custom-geo/source/*` | — | ⚠ **Six des dix-sept routes de ce prefixe portent un quota**, PAS toutes. Avec quota (20 appels / 60 s par utilisateur, compteur PARTAGE en base — `consommer_quota`, sql/135, jamais une Map locale) : `codes-postaux`, `rayon`, `dessin`, `intersection`, `difference` (les cinq routes de fabrication de zone) et `score` (quota `geo:rl:zone-score`, ajoute le 2026-09-15). Les trois routes d'analyse `/api/analyses`, `/score` et `/correlation` en ont un aussi. **SANS quota** : `admin`, `battle`, `carreaux`, `composite`, `digital`, `indicator-threshold`, `iris`, `meteo`, `radio`, `tmja`, `voronoi` — et parmi elles, **`admin`, `indicator-threshold` et `meteo` appellent `get_admin_filter_geometry`**, la RPC dont le cout justifie le garde-fou. Recompte le 2026-09-16 : jusque-la cette ligne, posee sur le glob, laissait croire que les dix-sept etaient couvertes. Cout unitaire mesure : `get_admin_filter_geometry` sur 2 000 CP lit **540 blocs disque** par appel, `zone_dessin` sur 5 000 sommets prend 1,5 s, `zone_rayon` a 100 km 355 ms — sans plafond, une boucle sur l'une d'elles est la famille exacte de l'incident du 28/03 |
| `/api/custom-geo/source/codes-postaux` | POST | **Une zone depuis une liste de CP** (Tache 16) : liste collee (JSON) ou fichier depose (multipart, lu par `lireFormulaire()` + `fichierDeFormulaire()`, jamais un cast). Borne a 2 000 CP. Rend SEPAREMENT les jetons rejetes (coquille de saisie) et les codes inconnus du referentiel (Cedex, code perime, CP etranger) — un import qui avale 500 codes, en resout 460 et n'en dit rien produit une zone plus petite que commandee, et personne ne s'en apercoit avant la facture. La verification au referentiel est **decoupee en lots de 500** : `postgrest-js` encode chaque virgule d'un `.in()` en `%2C`, soit 8 caracteres par CP — a 2 000 codes l'URL faisait **16 104 caracteres** (mesure) pour une limite Kong/nginx usuelle de 16 384, et un depassement echoue MUETTEMENT |
| `/api/custom-geo/source/rayon` | POST | **Zone circulaire** (Tache 17, sql/155) : `{lon, lat, rayon_m}`, rayon borne a 100 km. `ST_Buffer` sur `geography` — en degres, le cercle deviendrait une ellipse et « 20 km » n'en ferait pas 20. Clippe sur `france_borders`, qui couvre les DROM (verifie : -61,8 a 55,8 de longitude). Rend `part_retenue` : Marseille 20 km ne garde que 60,5 % du cercle, le reste est en mer. 409 si le clip emporte tout |
| `/api/custom-geo/source/dessin` | POST | **Trace libre** (Tache 18, sql/156) : recoit le polygone dessine, le valide par `ST_MakeValid` — un trace a main levee croise souvent son propre chemin, et le « noeud papillon » resultant ferait lever toute operation PostGIS ulterieure — puis le clippe sur `france_borders`. 409 sur un trace sans surface exploitable. Rend `corrige` (le trace a du etre repare, la zone n'est pas exactement celle dessinee) et `part_retenue` |
| `/api/custom-geo/source/intersection` | POST | **Ce que 2 a 20 zones ont en commun** (Tache 14, sql/151) : la premiere zone intersectee avec l'UNION des autres — et non une reduction deux a deux, qui repondrait a une autre question. Repond **409** sur une intersection vide plutot que de creer une zone a zero code postal, qui partirait ensuite au DSP. `checkZoneAccess` par lots de 3 |
| `/api/custom-geo/source/difference` | POST | **Une zone moins d'autres** (Tache 14, sql/151). `zone_base` et `zones_retirees` sont deux champs distincts et non une liste : l'operation n'est PAS symetrique, et rien dans le resultat ne dirait qu'on s'est trompe d'ordre. 409 si rien ne reste |
| `/api/custom-geo/media-plan` | GET/POST/DELETE | Rattachement du plan media a une campagne DSP — persiste budget/CPM/cible/poids dans `dsp_campaigns.geo_strategy.media_plan` (sous-cle namespacee, scope org) |
| `/api/custom-geo/media-plan/snapshot` | POST | Fige un snapshot VERSIONNE du plan pousse au DSP, item par item (`zone_id:poi_id`), expanse en codes postaux via `get_zone_items_export` |
| `/api/custom-geo/list` | GET | Zones custom de l'org courante |
| `/api/custom-geo/stats` | GET | Comptages des zones de l'org, pour l'en-tete de la galerie |
| `/api/custom-geo/[id]/geometry` | GET | Geometrie d'une zone enregistree |
| `/api/custom-geo/capture` | POST | Recoit N geometries + une transformation, appelle `transform_geometries_for_save` puis enchaine creation et resolution des codes |

**Les onze autres routes `/api/custom-geo/source/*`** — fabrication d'une zone depuis une couche affichee ; toutes en POST, toutes rendant une geometrie que le client enregistre ensuite par `/api/custom-geo/save`. ⚠ **Aucune ne porte de quota**, voir l'avertissement de la ligne `source/*` plus haut.

| Route | Description |
|-------|-------------|
| `/api/custom-geo/source/admin` | Union des geometries d'une selection administrative (region / departement / CP). Appelle `get_admin_filter_geometry` |
| `/api/custom-geo/source/indicator-threshold` | Codes passant un seuil sur UN indicateur du registre, puis materialisation de la geometrie. Route sœur de `source/score`, qui elle sait exprimer un score COMPOSITE |
| `/api/custom-geo/source/meteo` | Enveloppe de `get_admin_filter_geometry` : la meteo est agregee par zones admin existantes, pas sur une grille propre |
| `/api/custom-geo/source/carreaux` | Union des carreaux Filosofi d'une bbox (borne par `max_rows`), filtrage optionnel par bornes de valeur |
| `/api/custom-geo/source/iris` | Union des geometries d'un ensemble d'IRIS |
| `/api/custom-geo/source/voronoi` | Union des cellules Voronoi d'une categorie (mode standard V1 ; le mode routier reste a faire) |
| `/api/custom-geo/source/battle` | Geometrie d'une bataille isochrone (union des caches cibles) |
| `/api/custom-geo/source/radio` | Union des buffers de couverture des emetteurs d'une radio (RPC `get_radio_coverage_geometry`, sql/121) |
| `/api/custom-geo/source/tmja` | Buffer de 250 m autour des LineStrings de flux routier d'une bbox, unis en MultiPolygon |
| `/api/custom-geo/source/digital` | Zone active d'une campagne digitale, filtree sur les codes ayant recu des impressions |
| `/api/custom-geo/source/composite` | Union des geometries de 2 a 20 zones custom membres — a distinguer de `source/intersection` et `source/difference`, qui repondent a d'autres questions |

### Wizard de campagne — cibles, canaux, brouillons
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/campaigns/[campaignId]/channels` | GET/PUT | Canaux de diffusion d'une campagne (DSP / reseaux / ad server). Catalogue = `dsp_channel_registry`, « connecte » = `dsp_connections` de l'org ; persiste dans `geo_strategy.channels` |
| `/api/cibles/indicators` | GET | Catalogue des indicateurs ciblables (`cible_indicator_registry`) |
| `/api/cibles/preview` | GET | Apercu `count` / population d'un seuil (`?indicator=&operator=&threshold=`) — COUNT indexe, **jamais de geometrie** : c'est ce qui rend l'apercu utilisable a chaque mouvement de curseur |
| `/api/bidding/strategies/drafts` | GET/POST | Brouillons de strategie de l'utilisateur courant (`consumed_at IS NULL`) ; POST = upsert appele par l'autosave du wizard |
| `/api/bidding/strategies/drafts/[id]` | GET/DELETE | Chargement / abandon d'un brouillon, avec verification du proprietaire |
| `/api/bidding/strategies/[id]/final-report` | POST | Bilan executif Gemini en cinq sections d'une campagne terminee, cache memoire 1 h. ⚠ Lit `get_strategy_comparison_data`, **tronquee a 5 000 lignes par PostgREST** sur une table qui en porte 280 000 — defaut C de `docs/SUITE_TRONCATURE_POSTGREST.md` |

### Agent autonome (bidding)
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/agent/chat` | POST | Pipeline complet : detection d'intention → handler → application des regles → trace d'audit |
| `/api/agent/analyze-drift` | POST | Force l'intention `analyze_drift` sur un evenement de derive donne |
| `/api/agent/apply-recommendation` | POST | Applique ou rejette une recommandation de l'agent et trace la decision |
| `/api/pilot` | POST | Point d'entree du pilote automatique |

### Mode demo (bac a sable)

Sept routes qui montent, font vivre et demontent un jeu de donnees de
demonstration. Elles ecrivent en base comme les vraies — le mode demo est un
jeu de DONNEES, pas un chemin de code separe (`sql/112`).

| Route | Methode | Description |
|-------|---------|-------------|
| `/api/demo/seed` | POST | Monte le jeu de demonstration |
| `/api/demo/reset` | POST | Remet le jeu a son etat initial |
| `/api/demo/teardown` | POST | Demonte le jeu |
| `/api/demo/simulate-period` | POST | Fait avancer la campagne de demonstration d'une periode |
| `/api/demo/apply-rebid` | POST | Applique un rebid sur la campagne de demonstration |
| `/api/demo/report` | GET | Rapport de demonstration |
| `/api/demo/report/narrative` | POST | Version redigee du rapport ci-dessus |

### Analyses enregistrees (Tache 11, 2026-09-12)
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/analyses` | GET/POST | GET : liste des analyses de l'org (`?type=`, bornee a 50, `idx_analyses_org_date`). POST : enregistre un lancement (nom, parametres complets, maillage, perimetre) |
| `/api/analyses/[id]` | GET/DELETE | Detail complet (avec `parametres`/`perimetre`/`resultat`) / suppression, scopes org |
| `/api/analyses/[id]/rejouer` | POST | Rend de quoi RELANCER une analyse : type, parametres, maillage, perimetre, et l'appel a faire quand le moteur est cable (`score` -> POST `/api/analyses/score`, `correlation` -> GET `/api/analyses/correlation` ; les quatre autres rendent `cable: false`). **N'ECRIT RIEN** depuis le 2026-09-13 : la premiere version inserait une ligne `en_cours` qu'aucun moteur ne reprenait, sans trigger ni delai d'expiration et sans UI de suppression — un fantome eternel par rejeu, double d'un « termine » des que le vrai calcul tournait. La ligne est ecrite par le moteur qui calcule, au moment ou il calcule |
| `/api/analyses/score` | POST | **Score composite** (Tache 12, sql/146) : plusieurs indicateurs de `cible_indicator_registry` normalises 0-100 sur le perimetre puis ponderes, un score par code postal. Perimetre OBLIGATOIRE sous l'une de trois formes (`codes_postaux`, `perimetre` d'un `FiltreActif` — types `region`/`departement`/`commune`/`cp`/`zone`/**`france`**, ce dernier depuis le 2026-09-15, resolu par `codes_postaux_du_perimetre_jsonb`, sql/168 — `bbox`), plafonne a **7000** CP (releve de 3000 le 2026-09-15 : la France entiere, 6 187 CP avec 2 indicateurs, mesure a 159 ms/640 Ko — voir la note du fichier). Materialise a la demande tout indicateur ABSENT d'`indicator_cp_values` (sequentiellement — jamais en parallele), et rend la date de calcul de chacun. Enregistre le lancement dans `analyses` (type `score`). Appelle `calculer_score_composite_jsonb` (sql/170) et non la forme `RETURNS TABLE` : celle-ci rend une ligne par CP et PostgREST la tronquait a 5000 sur les 6186 CP du perimetre national, sans erreur. Quota `geo:rl:analyse-score` 12/min |
| `/api/analyses/correlation` | GET | **Correlation impressions x indicateur** (Tache 13, sql/147) : `?campaignId=&variable=`. Apparie les impressions livrees par CP (`campaign_cp_rollup`, DEJA agrege — jamais `dsp_campaign_data`) avec un indicateur INSEE, et rend le coefficient de Pearson, `n`, les points du nuage et la COUVERTURE (CP apparies / CP touches par la campagne). La couverture n'est pas decorative : la jointure est interne, et `rev_median` ne couvre que 1221 des 2041 CP d'une campagne reelle — 40 % ecartes en silence sans elle. Scope org par `checkCampaignAccess`. Quota `geo:rl:analyse-correlation` 12/min |
| `/api/custom-geo/source/score` | POST | Geometrie des CP dont le score composite depasse un seuil — route soeur d'`indicator-threshold`, qui elle ne sait selectionner que sur UN indicateur et ne peut donc PAS exprimer « score composite >= 60 ». Recalcule le score cote serveur (jamais une liste de CP remontee par le client), plafond 1500 CP. Le client sauvegarde ensuite par `/api/custom-geo/save` (`source_type: 'score_composite'`) . **Quota `geo:rl:zone-score` 20/min, ajoute le 2026-09-15** : c'etait la SIXIEME route de fabrication de zone et la seule sans plafond, alors que le bloc ci-dessus la rangeait deja parmi les routes protegees — la doc garantissait une protection inexistante. Elle enchaine pourtant `calculer_score_composite` (jusqu'a 3000 CP) PUIS `get_admin_filter_geometry` sur jusqu'a 1500 CP |

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
| `dsp_campaigns` | Campagnes DSP (Adform, DV360...) | nom, source, dates, pays, tracked_ads, advertiser + product (identité déclarée au wizard, PATCHée au Lancement). `tolerance_pct` (numeric, defaut 10) + `overpressure_weight` (numeric, defaut 1.0) : parametres du score d'alignement geographique, lisibles en base pour que le score reste recalculable a l'identique depuis les donnees brutes (sql/166) · **`est_simulation`** (boolean, défaut false, sql/232) : campagne produite par la simulation de l'étape ⑤. ⚠ `is_demo` existait déjà mais AUCUNE liste ne le filtre : une simulation aurait paru dans le sélecteur du Suivi. `est_simulation` est écarté par les trois routes qui listent des campagnes (`/api/admin/campaigns`, `/api/admin/campaigns/attachable`, `/api/digital/campaigns`) |
| `dsp_channel_registry` | Catalogue des canaux (dsp/social/adserver) | code, label, connection_provider, `link_levels` jsonb = hiérarchie de liaison par canal (annonceur → campagne → IO/ad group/placement) — rendue en cascade API si connecté, en saisie manuelle sinon (sql/104) |
| `dsp_campaign_data` | Lignes d'impressions DSP | Unicite via index EXPRESSION `idx_dsp_data_unique` sur (campaign_id, COALESCE(date), COALESCE(postal_code), COALESCE(city), COALESCE(media), **COALESCE(actor)**) — **SIX** expressions, NULL=egal. ⚠ Ce document en annoncait CINQ et omettait `actor` jusqu'au 2026-09-19 : mesure en base ce jour, l'index en porte six. Un generateur qui pre-agregerait sur cinq cles en croyant la doc produirait des doublons refuses par la base. **Non inferable par `onConflict` PostgREST** : pour un import idempotent, faire DELETE cible + insert (pas d'upsert). |
| `campaign_organizations` | Liaison N:N campaigns/orgs | campaign_id, organization_id |
| `postal_code_commune` | Referentiel La Poste | ~35k lignes, code postal -> commune |
| `indicator_cp_materializations` | Journal des materialisations d'`indicator_cp_values` : une ligne par indicateur, avec le NOMBRE de lignes ecrites (zero compris) et la date de la donnee pour les sources quotidiennes | sql/148 (2026-09-13). Existe parce que la PRESENCE de valeurs ne dit pas qu'on a deja calcule : `materialize_indicator_cp_values` peut ecrire ZERO ligne — `part_couples_enfants` pointe sur une colonne vide sur les 49 448 IRIS tout en etant active au registre — et un appelant qui teste la presence rematerialisait alors a CHAQUE lancement, soit un seq scan complet d'`iris` — mesure : ~173 Mo et 1,3 s, chiffre a preferer au « 5 Mo/s » qui circulait alors (voir « Budget I/O Supabase »). RLS deny-all |
| `indicator_cp_values` | Valeurs d'indicateurs INSEE par code postal (pression sur la cible) | Materialisation lazy par indicateur (RPC ci-dessous), agregation IRIS -> CP avec fallback communal ; consommee par apply_zone_weights_to_strategy et l'export custom bidding |
| `campaign_daily_rollup` | Agregat quotidien par campagne (date × media : imps, clics, spend) | Rafraichi a l'import/absorb/armement — le cockpit de suivi ne scanne JAMAIS dsp_campaign_data. RLS deny-all (routes service role) |
| `campaign_cp_rollup` | Agregat par CP (imps, spend, fenetres 7 j, in_target + planned_share du plan) | ~6-12k lignes/campagne — tableau, alertes et carte du suivi. RLS deny-all |
| `etalon_alignement` | « Moyenne du secteur » du score d'alignement geographique : `score_median` + `n_campagnes` + `tolerance_pct`, une seule ligne (`id boolean primary key default true`) | sql/166 (2026-09-14). Calcule TOUJOURS sur les parametres PAR DEFAUT (`tolerance_pct` 10), jamais sur ceux d'une campagne — un etalon qui bouge avec le reglage de chacun ne mesure plus rien. Seed initial `score_median=64, n_campagnes=0`, a remplacer par le calcul reel (Tache 5) — **toujours pas fait au 2026-09-15, et AUCUN code n'ecrit jamais dans cette table** (verifie : une seule lecture, aucun insert/update hors du seed). `GET /api/campaigns/[id]/alignement` rend donc `etalon: null` tant que `n_campagnes = 0`, plutot que de servir la graine comme une mesure : un media planner lisait « votre score 93 est au-dessus de la moyenne du secteur (64) » et pouvait le reprendre dans une recommandation client. Le calcul reel reste a faire, et n'a de sens qu'avec un corpus de campagnes — la base n'en a qu'une en rollup. RLS deny-all |
| `campaign_dsp_report` | Flux DSP buy side pour la reconciliation. **Grains reels, mesures le 2026-09-11** : 2 041 lignes a `date` NULL (grain CP) et 90 avec date ET code postal — le grain « date×canal » annonce n'existe PAS (0 ligne a `postal_code` NULL). Sans cle primaire — `date` est NULL sur 2 041 des 2 131 lignes (grain « par code postal »), et une PK refuse les NULL. Unicite portee depuis le 2026-09-13 par l'index d'EXPRESSION `idx_dsp_report_unique` (campaign_id, COALESCE(date), channel, postal_code, **source**), meme patron que `idx_dsp_data_unique`. Il rend VERIFIABLE l'idempotence par DELETE cible + INSERT : un DELETE rate suivi de son INSERT leve desormais au lieu de doubler le taux de mesure affiche au media planner (sql/162) | Alimente par API (lib/dsp/report) en prod, simulate_dsp_report en demo. format/creative_ref nullable (plomberie future). RLS deny-all |
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
| `poi_france` | Points d'Interet — **une table**, et non une vue : il n'existe aucune table `poi`. Porte depuis le 2026-09-17 la categorie **`risque_industriel`** (ICPE Georisques) : `sous_categorie` = la gravite (`seveso_haut`/`seveso_bas`/`ied`/`autorisation`/`enregistrement`/`autre`, qui colore le point), `metadata.libelle_nature` = la nature DOMINANTE du risque (qui le filtre), `metadata.natures_risque[]` = toutes ses natures | Trigger `auto_set_geom`. `id` **deterministe** aux deux chemins d'import (universel et data.gouv) : UUIDv5 du contenu de la ligne (`lib/import/identite-poi.ts`), ce qui rend `onConflict: 'id'` operant et le rejeu d'un fichier sans effet. Ne jamais revenir a `randomUUID()` — voir `docs/AUDIT.md#ech-001` |
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
| `activation_lots` | Un lot = une poussee de ciblage vers un canal DSP. Statut `partiel` a part : un lot ou 3 line items sur 20 ont echoue n'est ni un succes ni un echec | sql/158 (2026-09-13). RLS deny-all |
| `activation_cibles` | Un line item d'un lot, avec son statut et son `etat_avant`. LIMITE CONNUE : `etat_avant` porte le CONTEXTE de la poussee, pas la liste des geo IDs assignes — que la route de push existante ne rend pas. C'est ce qui empeche un rollback reel | sql/158. RLS deny-all |
| `strategie_versions` | Etat fige d'une strategie publiee : `empreinte_zones` (`{zone_id: hachage de CONTENU}` — geometrie + comptes de CP/IRIS, sql/159 ; c'etait `updated_at`, ce qui faisait d'un renommage une derive et rendait la vraie derive indetectable), `charge_utile` (etat complet, independant de l'etat courant de `bidding_strategies`), numero de version attribue EN BASE **sous `pg_advisory_xact_lock`** | sql/157 + sql/159 (2026-09-13). ⚠ La justification initiale — « attribue dans la meme instruction, donc pas de course » — etait FAUSSE : un `INSERT … SELECT max+1` sans verrou est aussi expose qu'un `SELECT max` suivi d'un `INSERT`. `ON DELETE CASCADE` sur la strategie. RLS deny-all. Comparaison dans `lib/campaigns/version-strategie.ts`, testee sans base |
| `cibles_exposition` | Catalogue des cibles calculables de l'overlay population : **24 EFFECTIFS et aucun taux**. On peut prendre 30 % des habitants d'un carreau, pas 30 % d'un revenu median — les taux se calculent APRES agregation, a partir de deux effectifs. Meme distinction que `classe_iris` (sql/138), reutilisee plutot que reinventee | sql/185 (2026-09-18). Lue par la RPC ET par le menu : le menu ne peut donc pas proposer une cible que le calcul refuserait. RLS deny-all |
| `exposition_cache` | **Resultats memorises de `population_exposee_agregee`** : l'ecran relance le calcul a CHAQUE clic de filtre, et il coute de 3 a 43 s. Mesure en prod (2026-09-18) : **4 498 ms au premier appel, 70 ms ensuite**. ⚠ **Pre-calculer toutes les combinaisons est hors de portee** (3 dimensions x 24 cibles x 6 gravites combinables x N natures x un rayon libre), et **sommer des resultats PAR SITE ne marche pas** — les zones de deux sites voisins se recouvrent, l'addition compte deux fois les habitants du recouvrement (+62,2 % mesure sur les 69 Seveso des Bouches-du-Rhone). C'est la raison d'etre du `ST_Union` par carreau, et cela interdit tout pre-calcul par site additionne ensuite. On memorise donc ce qui a DEJA ete demande. **Pas de TTL** : la cle inclut le nombre de sites retenus (que le garde-fou compte deja, donc gratuit) et le nombre de perimetres PPRT — un import change la cle, le cache s'invalide seul. Un TTL aurait servi des chiffres perimes apres un import, en silence. **Elle inclut AUSSI `md5(prosrc)`, le corps de la fonction (sql/196)** : sans lui, une migration qui change la LOGIQUE ne changeait pas la cle et le cache servait l'ancien resultat — constate en production le 2026-09-18, le classement affichant toujours « Marseille 15e » apres sql/195. Le defaut est vicieux : le payload porte `du_cache: true` et une date, mais c'est celle du calcul PRECEDENT, qui a l'air legitime. L'empreinte du corps evite un numero de version a incrementer a la main — un compteur qu'on oublie de bumper serait le meme defaut. Verifie par mutation : un commentaire ajoute au corps change le md5 et l'appel suivant recalcule. NON couvert : une modification des CARREAUX a nombre de sites constant (millesime INSEE annuel) — `vider_exposition_cache()` est la pour ce jour-la | sql/193 (2026-09-18). `du_cache` remonte jusqu'a l'ecran : une valeur servie instantanement doit dire de quand elle date. RLS deny-all |
| `couverture_rayon_risque` | **Population par palier de distance au site a risque le plus proche**, au grain (departement x gravite x nature x palier de 100 m), 24 cibles en jsonb. Sert l'onglet « Rayon d'influence ». ⚠ Les lignes `gravite='*'` ou `nature='*'` viennent du **MINIMUM par carreau** sur le sous-ensemble, PAS de la somme des lignes detaillees. Pre-calcul indispensable : mesure du 2026-09-18, entre 500 000 et 1 000 000 de carreaux se trouvent a moins de 10 km d'un site Seveso, soit jusqu'a 40 % de la base, et une courbe de 100 paliers a la volee est hors de portee. Une ligne par CARREAU aurait fait 2 a 4 millions de lignes | sql/198 (2026-09-18). Construite par `scripts/construire_couverture_rayon.mjs`, par bandes de longitude reprenables (journal `couverture_rayon_bandes`). RLS deny-all |
| `zones_risque_cache` | **Geometrie des classes d'un profil de rayons**, exclusives entre elles et dans le MEME ordre de priorite que `classe_carreau_risque`. Cle = le CODE du profil, reversible : devant une tuile qui n'affiche pas ce qu'on attend, `h1000.2000.5000_b500.1000_a_L0_P1` se lit, une empreinte demanderait une requete — et pourrait entrer en collision, donc servir les zones d'un profil sous la legende d'un autre. **Exclusivite VERIFIEE** : zero recouvrement mesure entre les sept classes du profil par defaut — re-verifie apres le lissage de sql/223, **0,00 m2 sur 21 paires**, et 0,00 m2 sur les 15 paires de La Reunion. Mesure : **2 805 ms** de construction, 7 classes, de 5 a 25 573 km2. ⚠ Le lissage porte sur le DISQUE et jamais sur la BANDE : une fermeture bouche les trous plus petits que son rayon, donc appliquee a un anneau elle le refermerait en disque plein et recouvrirait la bande interieure. Sur le disque elle est monotone, donc l'emboitement survit. Le perimetre PPRT n'est PAS lisse — servitude opposable, son trace fait foi en droit | sql/205 (2026-09-19), lissage sql/223 (2026-09-21). RLS deny-all |
| `unite_population_totale` | **Le DENOMINATEUR de la part de population exposee**, au grain (maille x code), avec les 24 cibles en jsonb. Existe parce que rapporter un numerateur issu du CARROYAGE a un denominateur issu des IRIS faisait depasser 100 % a **1 070 communes sur 6 517**, jusqu'a **163 %** (Issou, 4 550 exposes pour 3 858 habitants) : **235 983 carreaux sur 2 324 577 sont a cheval** sur plusieurs communes, et chacun est attribue ENTIEREMENT a une seule — la regle qui rend les sommes additives. Meme raisonnement que `cp_population_totale` (sql/207) : « un prorata dont les deux termes ne comptent pas la meme chose ne veut rien dire ». La commune se lit sur les carreaux (`split_part(lcog_geo, ',', 1)`, la MEME regle que `carreau_risque_distance`), le departement et la region se somment depuis elle — jamais par un second balayage, qui pourrait diverger. ⚠ **AUCUNE ligne au code postal, et c'est mesure** : les contours de `ref_codes_postaux` se recouvrent sur ~14 % des carreaux et ne pavent pas le territoire, donc l'attribution est un arbitrage et non une mesure — `cp_population_totale` rend 6 carreaux et 975 habitants sur 59640 quand le meme predicat rejoue a la main en trouve 121 et 23 116, et un recalcul complet ne converge pas davantage (parts jusqu'a 15 173 %). ⚠ Totalise **63,8 M** et non 67,76 : le carroyage ne couvre ni la Guadeloupe ni la Guyane ni Mayotte, et ne porte que les carreaux HABITES — la part se lit « part des habitants CARROYES ». 35 031 lignes, construction 2 min 38 | sql/221 (2026-09-20). RLS deny-all |
| `cp_groupe` | **Le code CANONIQUE de chaque code postal** (6 187 lignes). ⚠ **`ref_codes_postaux` porte la MEME geometrie pour tous les codes postaux d'une commune** : `ST_Equals(geom('44000'), geom('44200'))` repond `true`, et les quatre codes postaux de Nantes partagent jusqu'a leur centroide, au bit pres. **71 groupes, 181 codes postaux**, jusqu'a 6 membres. Consequence mesuree : le departage « le contour qui contient le point, le centroide le plus proche » etait une EGALITE PARFAITE, tranchee par l'ordre physique des lignes — les 103 carreaux que le numerateur donnait a 44200, la meme regle rejouee les eclatait en 44000 (45), 44300 (24), 44100 (18), 44200 (16). C'est ce qui laissait **47 codes postaux** porter des carreaux sans avoir de ligne dans `cp_population_totale`, et c'est surtout ce qui faisait ACHETER un code postal sur quatre a Nantes. Un code postal seul est son propre canonique : la table couvre les 6 187, aucune requete n'a de cas particulier a ecrire. Le regroupement porte sur l'EGALITE EXACTE des geometries (`md5(ST_AsBinary(geom))`, un `group by` la ou un `ST_Equals` croise serait quadratique), jamais sur le recouvrement partiel — celui-la (~14 % des carreaux, sql/221) est une vraie ambiguite de frontiere qu'un departage tranche honnetement | sql/228 (2026-09-22). RLS deny-all |
| `cp_population_totale` | **Population TOTALE par code postal**, denominateur de la ventilation par classe de risque (onglet Diffusion, retire le 2026-09-20 ; la table reste lue par `population_par_classe`). ⚠ **NE PAS remplacer par `carreaux_cp_population`**, qui existe et serait tentante : mesuree le 2026-09-19, elle totalise **74 876 618 habitants** contre 67 760 552 reels, soit **+10,5 %** — un carreau y est compte dans chaque contour qui le recouvre. `lib/risques/methode.ts` le documente deja comme la raison pour laquelle la part et la densite sont ABSENTES a la maille code postal. Celle-ci applique la MEME regle que `carreau_risque_distance.code_postal` : un carreau, un code postal, celui dont le centroide est le plus proche — c'est la coherence entre numerateur et denominateur qui compte, un prorata dont les deux termes ne comptent pas la meme chose ne veut rien dire | sql/207 (2026-09-19). RLS deny-all |
| `zone_sets` | **Jeu de zones de risque** (colonne `brouillon` depuis sql/215) : un profil de rayons fige en objet reutilisable, avec ses poids par classe (0 a 5), son `mode_plan` (`pondere` par defaut, `exclusif`) et son `seuil_couverture_cp` (20 % par defaut). C'est ce qu'une campagne recoit comme PLAN geographique — le maillon qui manquait, et sans lequel le seed du 2026-09-19 a produit 2 000 codes postaux sans `planned_share`. ⚠ **NE PAS confondre avec `custom_geo_zones`**, qui ne porte qu'UNE geometrie sans classe ni poids ; un jeu enregistre y pose une ligne MIROIR (`custom_geo_zone_id`) pour heriter des six routes d'export et de push DSP, mais le miroir est une PROJECTION et jamais la source. `profil_hash` = `codeJeu()` (`lib/zones/jeu.ts`), reversible, couvrant le profil ET les filtres ET le seuil — mais ni les poids ni le mode de plan, qui ne changent pas la geometrie. **`brouillon` (sql/215)** : l'atelier a besoin du calcul AVANT qu'un nom soit choisi — on regle, on compare, on decide, puis on enregistre. Un brouillon porte donc le resultat sans apparaitre dans la liste ; l'enregistrer, c'est lui donner un nom et lever le drapeau, jamais recalculer. Index unique partiel `(org_id, profil_hash) where brouillon` : re-regler le meme profil reutilise le calcul au lieu d'en empiler un par clic. `purger_brouillons_zone_set()` retire ceux de plus de N heures — un brouillon porte des geometries et jusqu'a 2 000 lignes de codes postaux | sql/210, `brouillon` sql/215 (2026-09-20). RLS deny-all |
| `zone_set_geoms` | Geometrie figee des classes d'un jeu, exclusives entre elles. **COPIEE depuis `zones_risque_cache` et non referencee** : un plan enregistre ne doit pas changer sous une eviction de cache, `vider_zones_risque()` casserait sinon tous les jeux sauvegardes. Meme raisonnement que `strategie_versions.charge_utile` | sql/210. RLS deny-all |
| `zone_set_cp` | ⚠ **UNE LIGNE PAR (code postal x GRAPPE) depuis sql/225** — cle primaire `(zone_set_id, code_postal, cluster_id)`, colonnes `cluster_id` et `poids` ajoutees. `pop_totale` est une propriete du CODE POSTAL, **repetee sur chacune de ses lignes** : toute somme qui la traverse doit dedupliquer d'abord, sinon un CP present dans trois grappes pese trois fois dans le taux d'utile — meme piege que `campaign_cp_rollup` (PK campagne x CP x acteur). Codes postaux d'un jeu, avec leur **classe dominante** (celle qui porte le plus de population — un code postal chevauche souvent plusieurs bandes, et en retenir une est ce qui fait tenir « un code postal, un poids »), la population en zone, la part du code postal couverte et `retenu`. ⚠ **C'est ici que se joue le point dur du produit** : le DSP achete au CODE POSTAL, le risque se mesure au carreau de 200 m. Mesure du 2026-09-20 sur un jeu Seveso 1/2/5 km au seuil de 20 % : 1 942 codes postaux touches, **1 113 retenus**, 13 165 660 habitants exposes, **taux d'utile 72,4 %** — on achete 18,2 M d'habitants pour en viser 13,2 M. ⚠ **Elle ne porte PAS tous les habitants exposes** : un carreau sans code postal (aucun contour ne le couvre — littoral, zones non adressees) ou dont le code postal n'a pas de ligne dans `cp_population_totale` ne donne aucune ligne de plan. Mesure du 2026-09-22 : **47 codes postaux et 177 672 habitants** au national. Ce n'est pas une perte de calcul mais une limite d'ACHETABILITE — la population des grappes, elle, les compte (sql/227) — et `remplir_zone_set_cp` la chiffre desormais au lieu de la taire. ⚠ En cause cote referentiel : `cp_population_totale` ne couvre que **6 037 des 6 187** codes postaux | sql/210. RLS deny-all |
| `zone_set_extractions` | **Ce qui est parti au custom bidding, fige.** L'export Excel d'un jeu RECALCULE a chaque telechargement : il suit le jeu, donc un seuil deplace change le fichier sous le meme nom. Parfait pour REGARDER un plan, inutilisable pour SE SOUVENIR de ce qu'on a envoye — or au moment de comprendre pourquoi une campagne a sur-diffuse, c'est la seule question qui compte. ⚠ **IMMUABLE par TRIGGER et non par convention** : une route qui n'expose pas de PATCH suffit tant que personne n'ecrit une seconde route, et la Phase 5 viendra lire ici. Le trigger porte sur UPDATE et sur lui SEUL — DELETE reste permis, sans quoi la cascade depuis `zone_sets` echouerait et un jeu deviendrait indestructible ; immuable n'est pas indestructible. ⚠ Le meme trigger sert les deux tables, qui n'ont pas les memes colonnes : il lit `old` par `to_jsonb`, nommer `old.id` directement faisait lever « record "old" has no field "id" » sur la fille — un refus qui FONCTIONNE mais dont le message envoie chercher un defaut de schema. `empreinte` = md5 du seuil, du mode et des multiplicateurs, dans un ordre stable (sans le `order by`, l'idempotence ne se declencherait jamais) ; elle ne porte PAS le commentaire. Un recalage change les poids, donc l'empreinte, donc cree bien une version | sql/231 (2026-09-23). RLS deny-all |
| `zone_set_extraction_cp` | Les lignes figees d'une extraction. ⚠ **UNE LIGNE PAR CODE POSTAL** et non par (code postal x grappe) comme `zone_set_cp` : le DSP ne porte qu'un multiplicateur par code postal, et `genererPlanCp` a deja replie les grappes. ⚠ **`pop_en_zone` et `pop_totale` sont NULLABLES**, et c'est le point delicat : un membre non canonique — Nantes 44200 quand 44000 porte le groupe — n'a PAS de population propre, l'information n'est pas dans la donnee (les quatre codes partagent une geometrie identique, sql/228). Lui attribuer un quart du groupe inventerait une repartition que personne n'a mesuree ; lui attribuer 0 ferait lire « ce code postal n'expose personne ». La population est portee EN ENTIER par la ligne canonique, donc sommer la colonne reste juste. Mesure du 2026-09-23 : **2 000 lignes, dont 73 membres non canoniques, tous a NULL**. ⚠ **Une table fille et non un jsonb « poids par CP »** : le brief le disait au singulier, mais un jeu national en porte pres de 2 000 et la Phase 5 doit les JOINDRE jour apres jour — un jsonb imposerait de tout deserialiser a chaque requete. `cluster_id`/`cluster_rang`/`zone_nom` figent le BASSIN dominant (celui qui porte le plus d'exposes), pour que l'extraction soit auto-portante et que le score par zone ne change pas si les grappes sont reconstruites | sql/231. RLS deny-all |
| `zone_set_simulations` | **Une campagne simulée sur une extraction** (étape ⑤) : campagne, extraction v1, extraction v2 (`set null` et non `cascade` : supprimer la v2 ramène la simulation à v1), date de début, jours, jour du recalage, paramètres du générateur (jsonb), statut `v1`/`v2`, lignes écrites par phase. Les impressions ne sont PAS ici : elles vivent dans `dsp_campaign_data`, sous une campagne `est_simulation`, comme le brief l'exige — c'est ce qui permettra de l'ouvrir un jour dans le Suivi sans rien réécrire. ⚠ `refresh_campaign_rollups` n'est PAS appelée : elle lit la DERNIÈRE stratégie d'une campagne, et une simulation porte deux plans successifs. L'alignement se calcule donc à part, au grain (jour × bassin) que les rollups n'ont pas | sql/232 (2026-09-24). RLS deny-all |
| `zone_set_clusters` | **Les GRAPPES (bassins) d'un jeu de zones** — les sites dont les zones SE TOUCHENT, regroupes par `ST_ClusterIntersecting` sur leur anneau EXTERIEUR. Existe parce qu'un jeu ne connaissait que des CLASSES : on lisait « 2,4 M d'habitants dans la bande haut 2-5 km », jamais « la vallee de la chimie expose 340 000 personnes » — la seule phrase qu'un media planner prononce. ⚠ **Le regroupement porte sur le DERNIER anneau** : c'est lui qui decide de l'etendue reelle, et grouper sur un anneau interieur ferait eclater en trois ce que l'ecran montre comme un bassin continu. Mesure du 2026-09-22, profil par defaut : **580 grappes et 1 259 sites en 1,7 s**. ⚠ Ce document a annonce « 9,8 s » pendant quelques heures : c'etait une mesure a CHAUD, prise juste apres des requetes qui avaient charge les memes carreaux. A FROID, la meme construction prenait **508 s** — cinquante fois plus. Corrige avec la cause (sql/225) : le rattachement passait par un KNN sur les POLYGONES des bassins, chacun union de dizaines de disques et porteur de milliers de sommets. Il passe desormais par les SITES, qui sont des points. Les plus grosses grappes : Fos-sur-Mer (53 sites), Saint-Quentin-Fallavier (44, la vallee de la chimie) et Le Grand-Quevilly (21, l'estuaire de la Seine). ⚠ **`nom_auto`** : le nom est la commune la plus frequente des sites de la grappe, et devient EDITABLE — « Etang de Berre » ne se devine pas depuis une commune, et un nom choisi ne se fait pas ecraser par la reconstruction suivante (verrouille par test) | sql/224 (2026-09-22). RLS deny-all |
| `zone_set_cluster_sites` | **Les sites de chaque grappe, en POINTS.** Existe pour une raison de COUT, mesuree : rattacher un carreau a son bassin par KNN sur les POLYGONES des grappes coutait **508 s a froid** — une grappe est l'union de dizaines de disques et porte des milliers de sommets. Sur des points, le meme rattachement est trivial. ⚠ Et c'est semantiquement plus juste : un carreau appartient au bassin du site qui l'EXPOSE, pas a celui dont l'enveloppe le contient — les deux different la ou deux bassins se frolent | sql/225 (2026-09-22). RLS deny-all |
| `carreau_risque_distance` | **Distances JOINTES d'un carreau aux sites a risque, par niveau** : `d_haut_m` ET `d_bas_m` sur la MEME ligne, plus `pprt_niveau`. 883 451 lignes, 84 Mo, 98 departements. Existe parce que `couverture_rayon_risque` (sql/198) ne porte que les MARGES — elle sait dire « combien d'habitants a tel palier du plus proche seuil haut », jamais le couple pour un carreau donne. Or **317 367 carreaux (35,9 %) sont a portee des deux niveaux**, et la priorite « haut prime sur bas » a besoin exactement de ce couple. ⚠ **Elle PORTE desormais la population et la position du carreau** (`pops real[]` et `centroide_3857`, sql/229), et cette case disait exactement le contraire jusqu'au 2026-09-22 — « pas de population dedans, le recopier ferait ~730 Mo ». Le chiffre visait le jsonb ENTIER (811 o/ligne mesures) ; les 24 cibles seules en `real` pesent **96 o**, soit ~100 Mo, et le centroide 40 Mo de plus. Ce que ca achete : la jointure vers `carreaux_filosofi` DISPARAIT du remplissage d'un jeu de zones. Mesure — lire les 882 404 distances seules **0,9 s**, avec la jointure **11,2 s** ; et le remplissage complet d'un jeu passe de **12 a 400 s** (selon le cache, Kong coupant a 60 s) a **7,0 s**, stable. ⚠⚠ **`sum(pops[n])` MENT** : `sum()` sur du `real` accumule en flottant 32 bits et rend **41 083 500** la ou la source en compte **41 083 683**. Le stockage est exact — zero ecart ligne a ligne sur 883 451 carreaux, demi-entiers compris — c'est l'addition qui perd. Ecrire `sum(pops[n]::numeric)`. ⚠ La POSITION dans le tableau vient de `cibles_exposition.rang_pop`, une colonne UNIQUE : un tableau positionnel dont l'ordre serait une convention rendrait des logements sociaux sous le nom d'une tranche d'age, sans erreur. ⚠ **Pas de cle etrangere** vers `carreaux_filosofi` : ses `id` sont des bigint de sequence et ne survivent pas a un rechargement depuis le CSV INSEE — `vider_carreau_risque_distance()` est la pour ce jour-la. Construite par `scripts/construire_carreau_risque.mjs`, par bandes de longitude reprenables (journal `carreau_risque_bandes`) | sql/203 (2026-09-19). RLS deny-all |
| `carreau_risque_nature` | **La MEME chose que `carreau_risque_distance`, mais PAR NATURE de risque** : `d_haut_m` / `d_bas_m` / `pprt_niveau` au grain (carreau x nature). **1 446 552 lignes, 13 natures**, Martinique et La Reunion comprises. Existe parce que sa table mere a ete construite avec un predicat **FIXE** — Seveso haut et bas, toutes natures confondues — et ne peut donc pas repondre « distance au site *inflammable* le plus proche ». ⚠ **Une table FILLE et non quinze colonnes** sur la mere : la nature est une dimension, pas un attribut, et quinze colonnes `d_<nature>_m` auraient impose une migration a chaque nature ajoutee au registre. Le facteur de multiplication mesure est **1,64** et non 13 — un carreau n'est a portee que d'une ou deux natures en general. ⚠ **`nature_ord` est un `smallint`** et non le libelle : 1,4 M de lignes ne peuvent pas porter 25 caracteres chacune, et l'ordinal vient de `icpe_rubrique_familles.rang_gravite`, deja unique. ⚠ **`pprt_niveau` y est REPETE par nature** et ne vaut pas celui de la mere : un carreau peut etre couvert par un perimetre dont le generateur est d'une nature, et hors des anneaux d'une autre — sans cette colonne, filtrer une nature laissait a l'ecran les servitudes opposables des autres. Pas de cle etrangere vers `carreaux_filosofi`, meme raison que la mere | sql/218 (2026-09-20). ⚠ **AUCUN script ne la construit — corrige le 2026-09-22.** Cette case annoncait `scripts/construire_carreau_risque.mjs`, qui ne nomme nulle part `construire_carreau_risque_nature` : il ne batit que la table MERE. Il faut derouler les bandes a la main — 20 en metropole (`construire_carreau_risque_nature(i, 20)`), puis Martinique et La Reunion en appels SEPARES avec cles de journal >= 1000, plus `remplir_pprt_nature_generateur()` AVANT. Le defaut etait couteux precisement parce qu'il ne se voyait pas : en suivant cette ligne, on lancait le script, on lisait « termine », et le filtre par nature restait vide sans un mot — une table absente et une table qui ne retient rien se ressemblent a l'ecran. A doter d'un script, comme sa mere. RLS deny-all |
| `pprt_niveau_generateur` | Le niveau (`haut`/`bas`) du site generateur de chaque perimetre PPRT, par rattachement au site le plus proche a **500 m** — MEME regle que sql/179, et 500 m plutot que l'inclusion stricte parce que les coordonnees AIOT pointent parfois l'entree du site. 664 perimetres, **532 rattaches** ; les 132 autres n'ont aucun site Seveso ACTIF assez proche, le generateur ayant pu cesser son activite — ce n'est pas une lacune d'import. **`nature_ord` ajoute sql/218** : la nature dominante du generateur, par la MEME regle de rattachement que le niveau — sans elle, un jeu filtre sur une nature gardait les perimetres PPRT de toutes. ⚠ **MATERIALISEE sur mesure** : ecrite d'abord comme fonction `stable`, elle coutait **51,9 s par appel**, et la construction l'appelle une fois par bande — 17 minutes de recalcul identique sur 20 bandes. Le symptome designait mal la cause : la bande de l'Atlantique produisait ZERO ligne en 42 s quand une bande dense en produisait 48 391 en 3,7 s, et un cout qui ne suit pas le volume de sortie est un cout fixe | sql/203 (2026-09-19). RLS deny-all |
| `seveso_exposition` | Cache de la population exposee par site. Une ligne par (site, mode, palier). `indicatif` distingue un chiffre issu de la servitude PPRT d'un chiffre issu d'un rayon choisi par nous. `pop_couronne` est STOCKEE et non derivee a l'affichage : la couronne se deduit des cumuls DEJA ARRONDIS, sinon la somme des couronnes ne retombe pas sur le cumul (mesure avant correctif : 2+29+2096 = 2127 pour un cumul de 2126, et un tableau qui ne s'additionne pas fait douter le lecteur, pas le logiciel) | sql/180 (2026-09-18). Alimente a la demande par `/api/risques/[siteId]/exposition`. RLS deny-all |
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
| `icpe_rubrique_familles` | Familles de rubriques ICPE : traduit le prefixe (2 chiffres) du numero de rubrique en **nature de risque** (41 toxicite aigue, 47 GPL et produits petroliers, 27 dechets...). 15 lignes | sql/173 (2026-09-17). Miroir TS `lib/import/georisques/familles.ts` — le classement tourne sur 138 423 sites et ne peut pas faire un aller-retour en base par rubrique ; la table sert l'affichage et l'evolution sans deploiement. `rang_gravite` (UNIQUE) ne sert QU'A departager la nature dominante d'un site qui en porte plusieurs : ce n'est pas une echelle de danger, la gravite reglementaire est le statut Seveso. RLS deny-all |
| `pprt_documents` | **Les PROCEDURES PPRT** de GASPAR — 415. A ne pas confondre avec les 664 assiettes ni les 609 generateurs : un plan couvre plusieurs generateurs, un generateur porte plusieurs assiettes. `zonage_existe` dit qu'un zonage reglementaire EXISTE (**365 sur 415, soit 88 %**) alors que sa GEOMETRIE n'est publiee nulle part — l'ecran peut donc dire « ce plan comporte 3 zones (R, r, B), leur trace n'est pas publie », ce qui n'est pas la meme chose qu'un silence. `types_zones` garde le `listTypeReg` brut : les codeZone ne sont pas normalises (R 139, r 92, G 73, b 60, B 51, mais aussi B1, R1, b1). ⚠ **`etat`, `date_approbation` et `date_abrogation` n'existent PAS** — verifie champ par champ, `/api/v1/gaspar/pprt` ne les expose pas ; les creer aurait pose trois colonnes que rien ne remplit | sql/183 (2026-09-18). Alimentee par `/api/admin/import-pprt`. RLS deny-all |
| `pprt_perimetres` | Perimetres PPRT (servitudes PM3, Geoplateforme IGN). **UNE LIGNE = UNE ASSIETTE** : 664 assiettes, 609 generateurs (`id_generateur` = l'etablissement, PAS la procedure — `gaspar/pprt` en recense 415, sans cle de jointure). `geom` 4326 + `geom_3857` pre-calculee + `superficie_km2` sur `geography` | sql/177 (2026-09-17). 15 Mo. **Trois index geometriques, et le troisieme n'est pas redondant** : `idx_pprt_geom` (GIST sur `geom`) et `idx_pprt_geog` (GIST sur `geom::geography`, sql/179) — un `ST_DWithin` en geography ne peut PAS emprunter l'index geometry, le cast change le type indexe. Sans `idx_pprt_geog`, le rattachement site<->PPRT retombait en Seq Scan par site : 118 340 ms mesurees contre 164 ms. `code_departement` CALCULE par recouvrement geometrique sur `ref_departements`, **jamais lu dans `partition`** dont 5 depots sur 69 sont REGIONAUX (`_SUP_R76_` = Occitanie, 77 zones). **`id_gaspar`** relie l'assiette a sa PROCEDURE, via `wfs_sup:generateur_sup_s.id_gaspar` (sql/183-184) — 664 sur 664 renseignees, **404 procedures atteintes**, dont **657 assiettes joignables** a `pprt_documents` : 4 procedures (7 assiettes) sont citees par le flux SUP mais absentes des 415 de GASPAR — un ecart entre deux referentiels de l'Etat, pas une erreur d'import. PAS de cle etrangere : les deux flux sont importes separement, une contrainte ferait echouer l'import des perimetres sur un ordre d'execution. `id_assiette` conserve mais NON unique : `2147483647` y est porte par 4 PPRT sans rapport. RLS deny-all |
| `qualite_releves` | Dernier releve de chaque verification de qualite des donnees | sql/149 (2026-09-13). Rouvrir `/admin/qualite-donnees` lit CETTE table, jamais les tables sources. RLS deny-all |
| `quotas_appels` | Compteurs de quota d'appels PARTAGES entre instances (sql/135) | Une ligne par cle = prefixe de route + appelant. Ecrite par la RPC `consommer_quota` (un seul `INSERT … ON CONFLICT … RETURNING`, donc exact en concurrence). Se purge elle-meme. RLS deny-all. **C'est le garde-fou du budget I/O** : avant, il comptait en memoire d'instance et ne limitait rien sur Vercel |
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
| `get_campaign_suivi_cps` | **SUPPRIMEE le 2026-09-19 (sql/202)** avec les trois `get_campaign_derive_*`, l'ancien ecran de suivi ne l'appelant plus depuis la Tache 16. Definition conservee dans sql/113 (signature a 3 arguments) et sql/109 (a 2) : restaurer est un `git show`, pas une restauration de sauvegarde. Le detail du raisonnement vit dans le PARAGRAPHE DE TETE de ce document, ou elle etait decrite avec les trois autres | — |
| `get_campaign_suivi_map` | Features CP (geometries ref_codes_postaux) pour la choroplethe hold/cpm | `api/digital/[id]/suivi/map/` |
| `simulate_dsp_report` | Genere le rapport DSP demo (set-based depuis les rollups, part de budget, sur-declaration ×1,03) | `api/digital/[id]/reconcile/pull/` |
| `get_campaign_reconciliation` | Payload reconciliation (global taux de mesure, par canal, tendance) | `api/digital/[id]/reconcile/` |
| `get_campaign_reconciliation_map` | Features CP taux de mesure / CPM DSP pour la carte | `api/digital/[id]/reconcile/map/` |
| `apply_zone_weights_to_strategy` | Bid multipliers par CP d'une strategie — generalise (sql/106) : courbe sur N'IMPORTE quel indicateur de `indicator_cp_values` via `variable_code`, uniforme sans indicateur | `api/bidding/strategies/` (POST/PATCH) |
| `calculer_alignement_geo` | **Score d'alignement geographique** 0-100 (sql/165), TOUJOURS calcule au code postal — jamais a la maille affichee. Somme les acteurs AVANT tout calcul (PK `campaign_cp_rollup` = campagne × CP × acteur, un CP apparait jusqu'a 5 fois). Penalise sous-pression et sur-pression (`overpressure_weight`), sur la tolerance de `dsp_campaigns.tolerance_pct`. Garde-fou `plan_divergent` : `planned_share` est cense etre une propriete du seul CODE POSTAL — si `count(distinct planned_share)` differe entre acteurs d'un meme CP, le moyenner en silence rendrait un score faux sans le signaler. Mesure sur la campagne demo (2026-09-14) : score 93, conformes 72,5 %, 2041 CP, 1777 buffers en cache, ~36 ms a chaud. **sql/172 (2026-09-15)** : une campagne SANS donnees de diffusion rend `{error: 'aucune_donnee', calculable: false}` et non plus `{score: 0, conformes_pct: null, impressions_totales: null, …}`. Le 0 venait d'un `greatest(0, round(100 - NULL))` — GREATEST ignore les NULL — et non d'un calcul ; l'intention etait deja ecrite dans sql/165 (`coalesce(v_res, jsonb_build_object('error','aucune_donnee'))`) mais ne se declenchait jamais, une agregation sur un ensemble vide rendant UNE ligne de NULL et non zero ligne. Le garde-fou teste desormais `n_cp = 0` ou `impressions_totales <= 0`. Corollaire : aucun champ numerique du payload calculable n'est plus NULL (cinq d'entre eux etaient declares `number` cote client et recevaient `null` ; `depense_totale`, qui pouvait l'etre MEME avec des donnees, est `coalesce(…, 0)`). Ajoute aussi `prev_7j_calculable` : sans lui, une campagne d'une semaine (`t_prev` vide) voyait `score_prev_7j` retomber a 0 et la route annoncait une progression fabriquee. Calcul nominal inchange a la virgule — verifie apres migration sur la campagne demo : score 93, conformes 72,5 %, sous 150 971, sur 132 000, n_cp 2041, identiques a la mesure du 2026-09-14 ; 37,7 ms, `shared hit=1885`, 0 lecture disque. Jumeau TypeScript `lib/campagne/alignement.ts`, croise a l'implementation — accord exact sur le chemin nominal, **et desormais sur le cas degenere** (le jumeau rend `null`, la ou il rendait 100) | `api/campaigns/[campaignId]/alignement/` **sql/209 (2026-09-20) : TROISIEME cas de non-calcul — `plan_absent`.** La fonction rendait **score 100** sur une campagne sans aucun plan : `planned_share` NULL rend `plan_imps` NULL, le filtre `where plan_imps > 0` ecarte alors toutes les lignes (sous-pression NULL donc 0) et GREATEST IGNORE les NULL (sur-pression 0). score = 100 - 0 - 0, soit zero ecart a un plan qui n'existe pas. Le garde-fou de sql/172 ne voyait rien : 2 000 CP et 1 196 332 538 impressions mesures le 2026-09-20 sur la campagne de demonstration du module risque. La contradiction etait pourtant LISIBLE dans le payload — `score: 100` ET `conformes_pct: 0.0`. Rend desormais `{error:'plan_absent', calculable:false}` avec `n_cp` pour que l'ecran puisse ecrire « 2 000 codes postaux touches, aucun plan defini » : refuser de calculer n'est pas refuser de renseigner. Expose aussi `n_cp_plan` et `plan_couverture_pct` — un score calcule sur 12 % des CP touches ne vaut pas un score calcule sur 100 %. Et le volume parti sur un CP HORS PLAN compte desormais EN TOTALITE en sur-pression (`coalesce(plan_imps, 0)`), sans quoi une couverture partielle pourrait encore rendre un score parfait — MEME regle que le jumeau TypeScript et que le ruling T11-2. ⚠ Les deux implementations DIVERGEAIENT sur ce cas (SQL 100, TypeScript 0) alors que ce document affirmait leur accord « sur le chemin nominal et sur le cas degenere » : ce cas-ci — des unites, des impressions, aucun plan — n'avait jamais ete croise. Il l'est desormais a CHAQUE execution de la suite par `tests/integration/alignement-plan-sql.test.ts`. Verifie apres migration sur la campagne elections : score 93, conformes 72,5 %, 2 041 CP, sous 150 971, sur 132 000 — identiques a la mesure du 2026-09-14 |
| `alignement_par_maille` | **Agregation d'alignement par maille** region/departement/cp (Tache 6, sql/165), via la jointure INSEE reelle `ref_codes_postaux.code_dept` → `ref_departements` → `ref_regions` — jamais `campaign_cp_rollup.dept` (`LEFT(postal_code,2)`, effondre tous les DROM sur `97` sans nom). PV-2 : 3 departements (975/977/978, collectivites d'outre-mer) ont `code_region` NULL en base — regroupes explicitement sous `'HORS'`/« Hors region », jamais laisses `null`. `n_total` compte AVANT la limite (`p_limite`), pour permettre un rendu tronque honnete. Mesure sur la campagne demo (2026-09-14) : 17 regions, 100 departements, 2041 CP ; somme des impressions au grain departement = 3 936 390, identique au total de la campagne ; ~22-35 ms par appel, uniquement des buffers en cache (0 lecture disque) | `api/campaigns/[campaignId]/alignement/maille/`, `.../alignement/constats/` (maille departement fixe, sans parent) |
| `alignement_par_maille_geo` | **Agregation geometrique d'alignement par maille** (rend AUSSI `part_plan_pct` depuis sql/216 — voir la note de la route `maille/map`), pour les trois vignettes carte du Suivi V2 (Tache 13A, sql/165) — JAMAIS pour le tableau (`alignement_par_maille`, ruling T6-1). Memes ecarts, meme jointure INSEE reelle et memes totaux perimetre-complet que `alignement_par_maille` (ruling T6-2). Joint aussi `indicator_cp_values` pour la variable du plan (`p_variable_code`, moyenne NON PONDEREE des CP du groupe). **Ruling T13A-1** : la geometrie est simplifiee (`ST_Simplify`) a une tolerance DERIVEE DE L'ETENDUE DE LA BBOX demandee (`greatest((xmax-xmin)/1000, 0.0001)`), jamais une constante — une tolerance fixe (0,01-0,02°) ferait perdre des sous-polygones ultramarins entiers (Mayotte 9 → 2 anneaux, -13,5 % de surface, mesure avant correctif) alors qu'une tolerance derivee de la bbox les preserve a l'echelle ou ils sont affiches et ne les degrade qu'a l'echelle France entiere, ou ils sont invisibles. Mesure sur la campagne demo (2026-09-15, apres correctif, bbox metropole) : 13 regions 102,7 ko (etait 5205 ko), 96 departements 283,5 ko (etait 5646 ko), 1879 CP 737,7 ko — 0 lecture disque aux trois mailles (86,8 ms / 137,5 ms / 972,8 ms, uniquement des buffers en cache) | `api/campaigns/[campaignId]/alignement/maille/map/` |
| `alignement_dispersion_cp` | **Histogramme de dispersion des ecarts au plan par CP** (Tache 12, sql/165, **corrigee sql/171**) — 7 bandes fixes de `BORNES_DIVERGENTES` (`lib/campagne/palette-divergente.ts`), jamais la tolerance de la campagne. Totaux de normalisation calcules sur le PERIMETRE COMPLET de la campagne (`situe`), jamais sur le seul `p_parent` filtre — **correction apres relecture**, meme defaut que T6-2 corrige plus haut pour `alignement_par_maille` : calculer les totaux sur le sous-ensemble filtre renormalise mecaniquement le plan sur la livraison REELLE du parent, et la somme des ecarts a l'interieur d'un departement vaudrait alors zero par construction — aucun drill-down ne pourrait plus jamais montrer qu'un departement ENTIER est sous ou sur-livre. **sql/171 (2026-09-15)** : `p_parent` est un code de DEPARTEMENT et rien d'autre. Le predicat etait `code_dept = p_parent OR code_region = p_parent`, or les deux nomenclatures INSEE SE RECOUVRENT — 18 codes designent a la fois un departement et une region (mesure : 01,02,03,04,06,11,24,27,28,32,44,52,53,75,76,84,93,94). Un drill-down sur Paris (`'75'`, 21 CP) rendait **164 CP**, dont 143 en Nouvelle-Aquitaine ; l'Aude (`'11'`, 7 CP) en rendait 407. Les deux RPC soeurs conditionnent deja ce predicat a la maille demandee ; celle-ci ne prend pas de `p_maille` (elle ne sert que la maille CP) et l'avait oublie. Verifie apres correctif : 75 -> 21, 11 -> 7, 13 -> 102, null -> 2041, chacun egal a un `count(distinct postal_code)` ecrit a part ; 30,6 ms, `shared hit=7551`, 0 lecture disque. Mesure sur la campagne demo (2026-09-14, vue nationale) : les bandes retombent exactement sur 2041 CP (52+109+1480 dans 3 bandes + 400 hors plan) ; 30 ms, 7552 buffers en cache, 0 lecture disque. Les ~400 CP a plan nul (19,6 %) ont un ecart NULL (`reel / NULL`) donc un `width_bucket` NULL : ils atterrissent dans une ligne a part (bornes `null`, `n_cp`/`impressions` renseignes) plutot que de disparaitre — verifie, pas suppose | `api/campaigns/[campaignId]/alignement/dispersion/` |
| `pression_par_classe` | **Part des impressions contre part du PLAN, par classe de zone** (sql/216). `left join` et non `join` : un code postal qui a recu des impressions SANS appartenir au jeu doit apparaitre — c'est meme le chiffre a montrer en premier (`part_hors_zone_pct`), une campagne pouvant tenir son plan classe par classe et avoir verse l'essentiel de son budget ailleurs. `indice` est **null et jamais zero** quand la classe n'a pas de plan : zero se lirait « la campagne ignore cette classe », alors que la verite est « le plan ne lui destinait rien ». Impressions SOMMEES sur les acteurs (la PK de `campaign_cp_rollup` demultiplie chaque code postal jusqu'a cinq fois) et part de plan prise au `max` — c'est une propriete du code postal, pas de l'acteur. Une campagne sans diffusion rend `aucune_donnee` et non un tableau de zeros. Mesure sur la campagne de demonstration : **14 ms**, indices 30 / 70 / 112, conformes au scenario de sql/213 | `api/campaigns/[campaignId]/pression-classes/` (sql/216) |

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
| `get_zone_centroids` | Centroides zones admin. **sql/160 (2026-09-13)** : le palier `cp` lisait `centroid_lat`/`centroid_lon`, NULL sur les 6 187 lignes de `ref_codes_postaux` (meme piege que sql/144) et rendait 0 ligne — la meteo par code postal n'a jamais fonctionne. Lit `ST_X/ST_Y(centroid)`, avec le meme repli sur la geometrie pour region et departement. Mesure : 6 187 lignes en 34 ms | `api/meteo-geo/` |
| `get_zone_polygons` | Polygones simplifies zones admin (choroplethe) | `api/meteo-geo/zones/` |
| `zone_intersection` | Intersection de zones custom, `ST_MakeValid` avant toute operation (une geometrie capturee depuis des carreaux ou isochrones peut etre invalide, et `ST_Intersection` LEVE dessus). Rend `vide: true` explicite, jamais NULL | `api/custom-geo/source/intersection/` (sql/151) |
| `zone_difference` | Zone de base moins l'union des zones retirees, memes garanties | `api/custom-geo/source/difference/` (sql/151) |
| `zone_rayon` | Cercle clippe sur `france_borders`. `ST_Buffer` sur `geography` (rayon en metres, pas en degres). Rend `part_retenue`, affichee avant enregistrement : un rayon sur la cote perd sa surface en mer | `api/custom-geo/source/rayon/` (sql/155) |
| `zone_dessin` | Valide et clippe un trace libre. Mesure : un carre de 163,23 km2 dont deux sommets se croisent devient deux triangles de 81,62 km2 — la moitie exacte, donc le bon resultat geometrique | `api/custom-geo/source/dessin/` (sql/156) |
| `empreinte_zones` | Hachage de CONTENU d'un lot de zones : `md5(geometrie + n_cp + n_iris)` par zone. Sert la detection de derive d'une strategie publiee. Remplace `updated_at`, qui faisait d'un RENOMMAGE une derive et ne voyait pas la vraie | `api/bidding/strategies/[id]/publier/`, `api/campaigns/[campaignId]/activation/prevol/` (sql/159) |
| `publier_strategie` | Ecrit une version de strategie sous `pg_advisory_xact_lock`, idempotente a empreinte et charge utile identiques | `api/bidding/strategies/[id]/publier/` (sql/157, sql/159) |
| `get_national_population_totals` | Totaux France par tranche d'age (carreaux_5km, sql/087) | `api/custom-geo/national-totals/` |

### Referentiels
| RPC | Description | Appelee depuis |
|-----|-------------|----------------|
| `build_ref_codes_postaux` | Construction ref CP | `api/admin/import-laposte/` |
| `truncate_laposte_hexasmal` | Reset ref La Poste | `api/admin/import-laposte/` |
| `update_laposte_centroids` | Centroides CP | `api/admin/import-laposte/` |
| `calculer_score_composite` | **ENVELOPPE MINCE de `calculer_score_composite_jsonb` depuis sql/170** (meme patron que sql/169 : un seul corps, deux formes de retour, derive impossible par construction). `RETURNS TABLE`, donc tronquee a 5000 lignes par PostgREST au-dela — seul `/api/custom-geo/source/score` l'appelle encore, son plafond de 1500 CP rendant la troncature inatteignable. Score composite 0-100 par code postal : N indicateurs d'`indicator_cp_values` normalises min-max SUR LE PERIMETRE demande — jamais des bornes nationales figees (c'est le role d'`iris_bornes_echelle` pour les couleurs) — puis ponderes. Rend aussi `n_indicateurs`, sans quoi un score porte par un seul indicateur serait indiscernable d'un score complet — ce n'est pas theorique, `rev_median` ne couvre que 1952 des 6186 CP. Jumeau TypeScript teste : `lib/analyses/score.ts` (memes poids, meme arrondi). Mesure : 23,5 ms sur 500 CP, **159 ms sur les 6 187 CP de France** (spec-filtre-france.md, 2026-09-15) — `/api/analyses/score` admet desormais ce perimetre (plafond releve a 7000, filtre `'france'`) ; `/api/custom-geo/source/score` reste plafonne a 1500 CP, un choix produit (zone trop large a creer) et non une contrainte technique | `api/custom-geo/source/score/` (sql/146, enveloppe sql/170) |
| `calculer_score_composite_jsonb` | Jumelle `RETURNS jsonb` de `calculer_score_composite` ci-dessus (sql/170, 2026-09-15) et **source unique du corps du calcul** depuis cette migration. QUATRIEME troncature PostgREST du projet, apres `correlation_campagne_indicateur` (sql/154) et `codes_postaux_du_perimetre` (sql/168) : la RPC rend UNE LIGNE PAR CODE POSTAL, mesuree a **6186 lignes** sur les 6 187 CP du referentiel — PostgREST en rendait 5 000 sans erreur, 1 186 codes postaux restaient non colories sur la choropleth et `analyses.resultat` figeait `n_scores: 5000`. sql/168 avait corrige la fonction qui RESOUT le perimetre ; celle qui le CALCULE etait restee `RETURNS TABLE`. Verifie apres migration : 6186 des deux cotes, 0 ecart sur un FULL JOIN ligne a ligne. Mesure `EXPLAIN (ANALYZE, BUFFERS)` : jumelle jsonb 67,4 ms / `shared hit=2899` / 0 lecture disque ; enveloppe TABLE 72,7 ms / `shared hit=2948` — l'indirection coute ~5 ms et 49 buffers sur 6 186 lignes | `api/analyses/score/` (sql/170) |
| `correlation_campagne_indicateur` | Impressions par CP (SOMMEES sur les acteurs) appariees a un indicateur INSEE. La somme est obligatoire : la PK de `campaign_cp_rollup` est (campaign_id, postal_code, ACTEUR), donc un CP y apparait jusqu'a 5 fois — 10 205 lignes pour 2 041 CP sur une campagne reelle. **`RETURNS jsonb` et non `TABLE` (sql/154)** : PostgREST tronque a 5 000 lignes AUSSI les RPC `RETURNS TABLE` — mesure, `codes_postaux_dans_bbox` rend 5 000 lignes pour 6 051 reelles, sans erreur. Une campagne nationale de plus de 5 000 CP aurait vu son coefficient calcule sur la moitie nord-est de la France, avec un `n` faux et rien pour le dire | `api/analyses/correlation/` (sql/147, sql/154) |
| `compte_cp_campagne` | Nombre de codes postaux DISTINCTS touches par une campagne. Existe parce que supabase-js ne sait pas faire un `COUNT(DISTINCT)` : un `count: 'exact'` compterait une ligne par acteur et annoncerait 5x trop. Separee de la RPC d'appariement pour repondre AUSSI quand zero CP s'apparie — le cas ou ce chiffre compte le plus | `api/analyses/correlation/` (sql/147) |
| `codes_postaux_du_perimetre` | Codes postaux d'un `FiltreActif` (region/departement/commune/CP/zone/**france**). Existe parce qu'un filtre ne porte de bbox resolue QUE pour une zone enregistree : `bboxDuFiltre` repliait sinon sur `BBOX_METRO`, soit les 6187 CP de France. **Depuis sql/169 (2026-09-15, ruling FF-1) : ENVELOPPE MINCE de `codes_postaux_du_perimetre_jsonb` ci-dessous** — `RETURN QUERY SELECT jsonb_array_elements_text(...)`, un seul corps porte desormais les six branches, deux formes de retour, derive impossible par construction (les deux fonctions portaient chacune les six branches recopiees avant ce correctif, et rien ne les comparait). `RETURNS TABLE`, donc tronquee a 5000 lignes par PostgREST au-dela — c'est pour cela que `france` (6 187 CP) n'est jamais appelee sous cette forme par l'app. Verifie apres migration, les six branches TABLE vs jsonb : cp 1/1, departement 23/23, region 30/30, commune 1/1, zone 58/58, france 6187/6187. Cout mesure sur la branche departement (EXPLAIN ANALYZE BUFFERS) : ~1,7-1,9 ms/343 buffers avant l'enveloppe, ~2,0-2,5 ms/385 buffers apres — indirection mesuree, non cachee, jugee negligeable a cette echelle | plus appelee par l'app depuis sql/168 (definition conservee, jamais de DROP) |
| `codes_postaux_du_perimetre_jsonb` | Jumelle `RETURNS jsonb` de `codes_postaux_du_perimetre` ci-dessus (sql/168, 2026-09-15) : PostgREST tronque a 5000 lignes TOUTE RPC `RETURNS TABLE`, meme piege deja documente pour `correlation_campagne_indicateur` (sql/154) — decouvert en testant le parcours reel, `/api/analyses/score` affichait 5 000 CP au lieu de 6 187 sur le perimetre `france`. Une fonction JUMELLE plutot qu'un DROP + CREATE OR REPLACE de l'originale (changer le type de retour l'exige, et DROP est exclu en production). Verifie : `jsonb_array_length(...('france', _)) = 6187`. **Depuis sql/169 : SOURCE UNIQUE des six branches** — `codes_postaux_du_perimetre` l'enveloppe au lieu de les recopier | `api/analyses/score/` (sql/168) |
| `codes_postaux_dans_bbox` | Codes postaux dont le centroide (`ref_codes_postaux.centroid`, geometry GIST) tombe dans une bbox (sql/144). `centroid_lat`/`centroid_lon` sont NULL sur les 6187 lignes — seule cette RPC (PostGIS `&&`/`ST_MakeEnvelope`) donne un resultat correct | `api/civic-indicators/health-map/` (scale=cp, Tache 4) |

### Admin & Monitoring
| RPC | Description | Appelee depuis |
|-----|-------------|----------------|
| `get_table_sizes` | Taille tables (monitoring) | `api/admin/health/` |
| `qualite_colonnes_iris` | Remplissage de CHAQUE colonne numerique d'`iris` en UN SEUL balayage (~220 Mo, 1,4 s). Se distingue de `get_iris_fill_status`, qui fait un COUNT par colonne (~40 balayages, ~8,8 Go) et confond une colonne vide avec une colonne pleine de zeros | `api/admin/qualite-donnees/` (sql/149) |
| `qualite_indicateurs` | Quels indicateurs ACTIFS du registre pointent vers une colonne vide, partielle ou absente. La verification la plus rentable du lot : elle aurait attrape `part_couples_enfants` (0 renseigne sur 49 448 IRIS, actif donc propose a l'utilisateur) avant qu'un score ne soit calcule dessus | `api/admin/qualite-donnees/` (sql/149) |
| `qualite_fraicheur` | Age de chaque source a cadence attendue. Le champ `alimentation` evite LE contresens : une table figee alimentee par un cron signale un cron qui ne tourne pas, pas une donnee absente a la source | `api/admin/qualite-donnees/` (sql/149) |
| `fraicheur_sources` | Fraicheur d'un ensemble de sources dont la liste — tables ET colonnes — arrive EN ARGUMENT depuis `lib/donnees/registre-fraicheur.ts` : ajouter une source ne demande aucune migration, contrairement a `qualite_fraicheur` qui code ses six sources dans son corps. Noms valides dans `information_schema` avant toute interpolation, seule barriere contre l'injection par nom de colonne (meme patron que `classer_territoires`). `p_inclure_lourd` garde le balayage de `comptages_routiers` derriere un geste explicite ; sur une source lourde le nombre de lignes vient de `reltuples`, car un COUNT exact couterait le balayage que ce garde-fou evite | `api/admin/fraicheur-donnees/` (sql/161) |
| `qualite_invariants` | Invariants metier chiffres (population 67 760 552, proprietaires 58,60 %, logements sociaux 14,97 %, revenu median 23 097 EUR, somme des tranches d'age = population). Seule famille qui detecte une donnee FAUSSE, par opposition a absente, partielle ou perimee | `api/admin/qualite-donnees/` (sql/149) |
| `count_poi_by_categorie_source` | Compte POI par categorie/source | `api/admin/import-datagouv/` |
| `get_sources_stats` | Stats sources de donnees | `api/admin/sources-stats/` |
| `get_poi_categories` | Categories POI | `api/admin/poi-categories/` |
| `get_active_data_registry` | Registre donnees actif | `api/` |
| `get_check_constraint_values` | Valeurs contraintes CHECK | `api/` |
| `drop_carreaux_table` | DROP table carreaux dynamique | `api/admin/sources/[id]/` |
| `log_smart_prompt_feedback` | Log feedback prompt IA | `api/smart-prompt/` |
| `population_exposee_agregee` | **Agregat de population exposee** par maille geographique (sql/185). DEUX REECRITURES mesurees pour tenir le temps d'un ecran interactif : **54,6 s** en decoupant chaque zone par chaque unite, **23,5 s** en attribuant le CARREAU a son unite via son code commune INSEE (`metadata->>'lcog_geo'`, renseigne a 100 %), **3,1 s** en comptant les sites par ATTRIBUT et non par geometrie — croiser 1 259 zones avec 101 polygones departementaux pesait a soi seul l'essentiel des 23 s. Effet voulu : un carreau appartient a UNE unite, donc la somme des lignes EGALE le total (verifie 5 804 = 5 804) ; en echange la colonne « sites » se lit « sites implantes ici » et non « sites dont la zone touche ici ». La cible est validee contre `cibles_exposition`, seule barriere contre l'injection par nom de champ. **GARDE-FOU DE COUT depuis sql/190** : au-dela de **3 000 sites retenus**, la RPC refuse (`{error:'trop_de_sites', calculable:false, n_sites, max_sites}`) au lieu de calculer. Plafond derive de DEUX mesures en production le 2026-09-18 — 1 326 sites (Seveso haut+bas, France) ~3 s, **19 521 sites (idem + regime `autorisation`) 88,3 s** — soit 2,3 a 4,5 ms par site, l'intersection avec `carreaux_filosofi` (2,3 M lignes) dominant tout. Sans lui, cocher `autre` (41 690 sites) ou `enregistrement` (29 665) partait pour plusieurs MINUTES sur la base de production : la famille exacte de l'incident du 28/03, et a l'ecran une attente sans fin, qui se lit comme une panne — c'est ainsi qu'elle a ete signalee. La sortie est le perimetre : le meme filtre sur UN departement passe sans probleme. **SECOND GARDE-FOU, sur la SURFACE (sql/192)** : le compte de sites ne suffit pas, et la mesure le prouve — sur les MEMES 1 258 sites Seveso, le rayon par defaut prend ~3 s et ~5 600 carreaux quand un cercle impose de 2 km prend **42,8 s et 95 268 carreaux**. Le cout suit les carreaux intersectes (~0,45 ms chacun), donc la surface cumulee des zones, pas leur nombre : « 20 km autour de chaque site » passait le premier garde-fou sans encombre. Plafond **5 500 km2** sur la majoration `n_sites x pi x r2` (tous les sites supposes prendre un cercle, aucun recouvrement — majorer est le bon sens de l'erreur pour un garde-fou). Le refus `zone_trop_vaste` rend `rayon_max_m`, le plus large qui passerait sur CE nombre de sites, sans quoi on tatonne entre deux refus. Consequence concrete : sur la France entiere et tous les Seveso, le rayon impose plafonne a **1,2 km** ; au-dela il faut choisir une region ou un departement. **`p_forcer_rayon` (sql/191)** dissocie `mode` (le site A-t-il un PPRT ? — sert le filtre) de la geometrie MESUREE (le cercle) : quand il est vrai, `total_indicatifs` egale `total_sites` et `rayon_force` le dit au client, parce qu'aucun chiffre ne vient alors d'une zone publiee par l'Etat. Ajouter ce parametre a EXIGE un `drop function` — un argument a valeur par defaut cree une SECONDE fonction et rend tout appel nomme ambigu ; le patron « enveloppe mince » du projet resout une divergence de type de RETOUR, pas de signature. DROP et CREATE sont dans la meme migration, donc la meme transaction : aucun instant sans fonction | `api/risques/exposition/agregats/` (sql/185) |
| `construire_zones_risque` | Construit la geometrie des classes d'un profil. `ST_Buffer` sur **geography** — le rayon est en metres, jamais en degres : en 4326, « 5 km » vaudrait 5 km en latitude et ~3,5 km en longitude a Marseille, une ellipse presentee comme un cercle (meme raison que `zone_rayon`, sql/155). La priorite est transcrite en geometrie : bande i = disque(r_i) moins disque(r_i-1), moins le PPRT du meme niveau ; puis toute classe du seuil bas moins l'EMPREINTE COMPLETE du seuil haut — son dernier disque UNION son perimetre publie, car un carreau retenu par le seuil haut peut l'etre par sa servitude au-dela du dernier anneau. **`p_natures` ajoute sql/220** : la GEOMETRIE aussi depend du filtre — un jeu bati sur « Explosibles » dont la carte montrerait les anneaux de tous les sites serait le meme mensonge, en plus visible. Le filtre porte sur la nature DOMINANTE du site, comme partout dans ce module. Mesure sur le departement 13, profil a deux anneaux : **2 922 km2 et 5 codes postaux** filtre sur Explosibles, contre 13 224 km2 et 25 codes postaux sans filtre | `api/risques/zones/preparer/` (sql/205, `p_natures` sql/220) |
| `zones_risque_tuile` | Tuile MVT des zones d'un profil. **`ST_SimplifyPreserveTopology` et JAMAIS `ST_Simplify`** : ce dernier VIDE les petits polygones, et une bande interieure de 500 m en est un — meme mesure que sql/178, ou `ST_Simplify` vidait 602 zones PPRT sur 664. La tolerance est derivee de la taille du PIXEL au zoom demande, d'ou un poids borne : 43 ko a z4, 943 o a z10 | `api/tiles/zones-risque/` (sql/205) |
| `vider_zones_risque` | Vidange du cache de zones. A rejouer apres un import de sites ou de perimetres : la cle est le profil, elle ne voit pas changer les donnees sous elle | sql/205 |
| ~~`diffusion_par_classe`~~ | **SUPPRIMEE le 2026-09-20 (sql/214)** avec `/api/risques/diffusion`. Les quatre conditions du § « Menage en base » verifiees une a une : 0 appelant dans le code, 0 appelant EN BASE (`pg_proc.prosrc`, `information_schema.views`), aucune dependance structurelle, definition presente dans sql/207. ⚠ La signature du `drop function` a ete relevee EN BASE (`pg_proc.oid::regprocedure`) et non recopiee de la migration : un `drop function` qui se trompe d'arguments ne leve pas, il ne trouve rien et laisse la fonction en place | — |
| `remplir_cp_population_totale` | Construit UNE bande de longitude du denominateur. ⚠ **Bornes METROPOLE par defaut, outre-mer par appels SEPARES** : la premiere version prenait -61,6 a 56,0 en vingt bandes, soit 5,88 deg par bande pour une metropole qui n'en fait que 15,3 — toute la France tenait dans TROIS bandes de 800 000 carreaux et la construction ne rendait plus la main (222 codes postaux sur 6 018 apres vingt minutes). C'est l'avertissement de sql/200, reproduit ici puis corrige. Mesure apres correctif : 8,9 s par bande sur 60 | `scripts/seed-demo-campagne-risque.ts` (sql/207) |
| ~~`seed_campagne_risque_demo`~~ | Premiere version du jeu de demonstration (sql/208). **Remplacee par `seed_impressions_risque_demo` (sql/213)**, dont l'entree ci-dessus detaille les trois defauts mesures : trois CPM indiscernables, 1,2 milliard d'impressions, et aucun plan. Le scenario a change aussi — voir l'entree de sql/213 | `scripts/seed-demo-campagne-risque.ts` (sql/208) |
| `purger_campagne_risque_demo` | Retire le jeu de demonstration ; la campagne emporte ses donnees et ses rollups en cascade | `scripts/seed-demo-campagne-risque.ts --purger` (sql/208) |
| `creer_zone_set_extraction` | **Fige un plan en extraction versionnee** (sql/231). ⚠ **Les multiplicateurs arrivent CALCULES, en argument**, et ne sont pas recalcules ici : la regle du plan vit dans `genererPlanCp` (`lib/zones/plan.ts`), fonction pure et testee, qui produit AUSSI celui pousse au DSP. En ecrire une version SQL donnerait deux implementations qui divergeraient au premier correctif — et l'extraction archivee ne serait plus ce qui est parti. La base fait donc ce que seule la base sait faire : serialiser l'attribution du numero de version sous `pg_advisory_xact_lock`, et figer. ⚠ **Le verrou couvre la lecture d'idempotence ET l'attribution** : le poser apres le test laisserait deux appels concurrents conclure tous les deux « elle n'existe pas ». La lecon de sql/159 s'applique mot pour mot — un `INSERT … SELECT max+1` SANS verrou est aussi expose qu'un `SELECT max` suivi d'un `INSERT`. Un plan vide rend `plan_vide` et non une extraction vide : l'archiver produirait une version qu'on croirait valide. Mesure : **100 ms pour 2 000 lignes** | `api/zones/jeux/[id]/extractions/` (sql/231) |
| `simulation_entrees` | Les codes postaux d'une extraction tels que le générateur de simulation les consomme : plan, bassin, population, part en zone, surface, centroïde. Un membre non canonique reçoit la population de son canonique POUR LA DENSITÉ ET LA PART, et le drapeau `membre` l'écarte de toute somme. `RETURNS jsonb`. 48 ms pour 2 000 lignes | `api/zones/jeux/[id]/simulation/` (sql/232) |
| `simulation_agregats` | Tout ce que l'étape ⑤ lit, en UN appel : par (CP × version), (jour × bassin), jour et (partenaire × version). **Les impressions UTILES se calculent ici**, au grain de la ligne (impressions × part en zone du CP) — les calculer côté client imposerait de rapatrier 168 000 lignes. « En zone » dépend de la VERSION du plan du jour. `RETURNS jsonb`. **366 ms** sur 168 000 lignes, 1,1 Mo | `api/zones/jeux/[id]/simulation/`, `.../recaler/` (sql/232) |
| `simulation_carte` | Bassins (`ST_SimplifyPreserveTopology`, jamais `ST_Simplify`, tolérance dérivée du cadre) et sites d'un jeu dans un cadre, FeatureCollection jsonb. 0,2 s | `api/zones/jeux/[id]/simulation/carte/` (sql/232) |
| `construire_zone_set_clusters` | Construit les grappes d'un jeu (sql/224). Le predicat des sites est celui de sql/220 **a l'identique** — recopier en donnerait deux versions qui divergent, et la carte montrerait des grappes baties sur des sites que le plan ne compte pas (lecon de `sites_exposition`, sql/190). ⚠ **La population exposee vient de `classe_carreau_risque` (sql/204) et JAMAIS d'un test geometrique**, et l'ecart n'est pas theorique — mesure le 2026-09-22 contre les 14 103 578 habitants de l'ecran : le test sur le POLYGONE du carreau rend 14 636 073 (+3,8 %, un carreau qui effleure est compte entier), le test sur son CENTROIDE 14 047 617 (-0,4 %, `ST_Buffer` approxime le cercle par un polygone a 32 cotes, un peu plus PETIT), et ni l'un ni l'autre ne voit les perimetres PPRT qui retiennent sans anneau. La regle unique rend **14 103 711**, soit +133 : l'arrondi par unite deja documente pour `population_par_classe` (~0,19 x 580 grappes). ⚠ La regle rend `'hors'` et JAMAIS null pour un carreau non retenu — tester `is not null` retenait les 883 451 carreaux et annoncait 41 083 838 habitants, le total national. ⚠ **Depuis sql/225 elle ne calcule PLUS la population** : elle batit les grappes et leurs SITES (`zone_set_cluster_sites`), et `remplir_zone_set_cp` remplit la population en meme temps que les codes postaux — une seule passe sur les carreaux au lieu de deux | `api/zones/jeux/` (sql/224, corrigee sql/225) |
| `cp_des_points` / `cp_du_point` | **LA regle de rattachement d'un point a un code postal**, en un seul corps et deux formes (patron sql/169-170). Le contour qui contient le point, departage par la distance au centroide **PUIS par le code postal** — ce second critere est ce qui rend le tirage deterministe la ou 181 codes postaux partagent un contour identique. Rend le code CANONIQUE (`cp_groupe`). ⚠ **La forme ENSEMBLISTE est le corps, la scalaire l'enveloppe, et c'est MESURE** : avec la seule forme scalaire, le rattachement des 883 451 carreaux a pris **33 min 34** ; en jointure ensembliste, **2 min 05**, et 7,7 s pour 100 000. La cause est dans PostGIS — `ST_Contains` met en cache la geometrie PREPAREE de son premier argument et la reutilise d'une ligne a l'autre, ce qu'un appel scalaire par ligne interdit. Une regle partagee qui coute quatre fois la regle recopiee finit recopiee | `remplir_code_postal_carreau`, `remplir_cp_population_totale` (sql/228) |
| `construire_cp_groupe` | Reconstruit `cp_groupe` depuis `ref_codes_postaux` (130 ms). A rejouer apres tout import du referentiel, et AVANT les deux remplissages — sans elle, `cp_du_point` ne rend AUCUNE ligne et tous les carreaux seraient declares « sans code postal », en silence | `11-reconstruire.sh` (sql/228) |
| `remplir_population_carreau` | Copie population (24 cibles) et centroide depuis `carreaux_filosofi` vers `carreau_risque_distance`, par lots reprenables — **52 s** pour 883 451 carreaux. L'etat EST la donnee (`pops is null`), donc pas de journal de bandes a desynchroniser (lecon du 2026-09-22 sur `couverture_rayon_bandes`) | `11-reconstruire.sh` (sql/229) |
| `remplir_zone_set_cp` | **Ecrit les lignes (code postal x grappe) d'un jeu, ET la population des grappes** — UNE LIGNE PAR GRAPPE depuis l'arbitrage du 2026-09-22 : un code postal peut servir deux bassins, et l'ecraser en une ligne perdrait l'information. Mesure sur le profil par defaut : **2 255 lignes pour 1 942 codes postaux**, dont **274 a cheval** (14 %), jusqu'a **6 grappes** pour un seul, et **69 portent des classes differentes selon la grappe** — ceux que la version a une ligne ecrasait. Totaux : 1 112 CP retenus, taux d'utile 72,3 %. ⚠ **Le seuil de retention se decide sur le CODE POSTAL, jamais sur la ligne** : un CP expose a 12 % par une grappe et 15 % par une autre est expose a 27 % — ligne a ligne, le seuil de 20 % l'ecarterait DEUX FOIS. ⚠ **Le filtre AVANT la jointure** (`as materialized`) : `carreaux_filosofi` pese 4,6 Go et 806 octets de jsonb par ligne, joindre les 883 451 carreaux pour n'en garder que 215 646 fait lire quatre fois trop. ⚠ **Elle honore le filtre de nature depuis sql/226** : elle lisait la table MERE sans condition alors que la geometrie (sql/220) et les grappes (sql/224) l'appliquent toutes deux — un jeu bati sur « Explosibles » aurait achete les codes postaux de TOUTES les natures sous une carte qui n'en montre qu'une, soit mot pour mot ce que sql/220 avait ferme, rouvert par une autre porte. Verifie sur le departement 13 : **5 codes postaux filtre contre 30 sans filtre**. ⚠ **La population des grappes NE passe PLUS par le filtre des codes postaux (sql/227)** : elle en etait deduite, or ce remplissage ecarte tout code postal absent de `cp_population_totale` et tout carreau qu'aucun contour postal ne couvre. Mesure du 2026-09-22 : **47 codes postaux et 177 672 habitants** au national, **6 339 habitants (1,6 %)** sur les seules Bouches-du-Rhone. Un bassin est une realite physique ; ce qu'on sait en acheter ne change pas combien ils sont. Apres correctif, la somme des grappes retombe a **14 103 716** contre 14 103 578 a l'ecran, soit +138 — l'arrondi par grappe. Les deux chiffres ecartes repartent au client (`n_cp_sans_denominateur`, `pop_sans_denominateur`), a zero comme au-dessus. ⚠ **Une table TEMPORAIRE et non une chaine de CTE** : deux ecritures doivent lire le meme resultat sans le recalculer, et une CTE n'est visible que de l'ordre qui la porte. ⚠ **COUT : 7,0 s, stable, depuis sql/229** — la jointure vers `carreaux_filosofi` a disparu. Avant, et c'est ce que cette case annoncait : **de 12 s a plus de 400 s**, selon l'etat du cache — 215 646 carreaux lus dans une table de 4,6 Go contre 128 Mo de `shared_buffers` en local. Mesure du 2026-09-22 sur LE MEME jeu a dix minutes d'intervalle : 12 s, puis 44 s. **Kong coupe a 60 s** : l'appel HTTP echouait donc sans que rien soit fautif, et le test d'integration passait ou non selon ce qui avait tourne avant lui. Ce cout PREEXISTE au chantier (l'ancien remplissage faisait la meme jointure) et les « 21,3 s » documentes etaient une mesure a chaud. ⚠ Son `duree_ms` a menti jusqu'a sql/226 : le retour etait `jsonb_build_object(...) || appliquer_seuil_zone_set(...)`, et `||` fait gagner la DROITE — le chiffre rendu etait celui du seuil, 22 a 65 ms. La fonction annoncait « 48 ms » pour 15 s de travail. Les deux durees repartent desormais separees (`duree_ms`, `duree_seuil_ms`) | `api/zones/jeux/` (sql/225, sql/226, sql/227) |
| `construire_zone_set` | Fige un profil en jeu de zones. La geometrie n'est PAS recalculee : `construire_zones_risque` (sql/205) la produit deja avec sa priorite en `ST_Difference`, on l'appelle puis on COPIE — recopier cette logique en donnerait deux versions qui divergent au premier correctif, et l'ecran montrerait des zones que le plan ne compte pas. ⚠ **Il REFUSAIT un filtre de nature** (`filtre_nature_non_supporte`) jusqu'au 2026-09-20, et le refus etait honnete : `carreau_risque_distance` portait un predicat FIXE, et un filtre affiche mais non applique est pire qu'un filtre absent. **sql/218 a construit la dimension manquante et sql/220 leve le refus** : le filtre porte desormais sur les DEUX moities du jeu — la geometrie que la carte montre ET les codes postaux que le DSP achete. N'en filtrer qu'une produirait une carte qui contredit son propre plan. Un libelle de nature que le registre ne reconnait pas est REFUSE (`natures_inconnues`) et jamais replie : `ordinal_nature` rend 0 pour l'inconnu — correct a la CONSTRUCTION, ou un site hors registre garde une ligne sous « Nature non precisee » — ce qui au FILTRAGE servirait ce seau sous le nom d'une autre nature. Mesure : un accent manquant sur « GPL et produits petroliers » rendait **136 277 habitants au lieu de 7 753 811**. Mesure : **21,2 s a chaud** pour 7 classes et 1 942 codes postaux (remesure le 2026-09-22 par le vrai chemin, apres le chainage de sql/226). ⚠ **Ce chiffre n'est vrai qu'a chaud** : le remplissage des codes postaux lit 215 646 carreaux dans une table de 4,6 Go, et le meme appel a pris **plus de dix minutes** au premier passage du jour. Kong coupe a 60 s, donc `POST /api/zones/jeux` peut echouer sur un cache froid — voir `remplir_zone_set_cp`. **Depuis sql/217, c'est une ENVELOPPE** : le calcul vit dans `construire_zone_set_corps`, et deux gardes sont posees DEVANT lui — « pre-calcul absent » et « territoire non carroye ». Une enveloppe plutot qu'un debut de corps, pour qu'un `return` mal place au prochain correctif ne puisse pas les contourner | `api/zones/jeux/` (sql/211) |
| `couverture_carreau_risque` | **Distingue « le pre-calcul n'est pas construit » de « ce territoire n'est pas carroye par l'INSEE »** (sql/217). Les deux rendaient le MEME ecran : selectionner la Guadeloupe dans l'onglet Rayons affichait « les distances n'ont pas encore ete construites, lancez `node scripts/construire_carreau_risque.mjs` » alors que le pre-calcul portait 883 451 lignes sur 98 departements. Le carroyage Filosofi 2021 a 200 m ne publie que metropole + Martinique + La Reunion : **971, 973 et 976 ont 0 carreau**, et aucun script n'en fabriquera. Le message reclamait donc une action impossible, et taisait le seul fait qui compte — ces trois departements portent **603 sites a risque dont 31 Seveso**, qui restent visibles sur la carte. ⚠ **Aucun COUNT sur `carreau_risque_distance`** : la premiere version rendait `n_departements` par un `count(distinct)`, mesure a **295 ms**, soit 98 % du cout, pour un chiffre qu'aucun message n'utilise. Les sondes qui restent sont des `exists` sur index — **2,7 ms**. Ce diagnostic s'affiche chaque fois qu'un ecran ne trouve rien : il doit etre moins cher que ce qui vient d'echouer | `api/risques/profil/bandes/`, `construire_zone_set` (sql/217) |
| `construire_zone_set_corps` | Le calcul reel d'un jeu de zones : la geometrie, puis les grappes, puis les codes postaux. Appele UNIQUEMENT par `construire_zone_set`. ⚠ **Il ne remplit PLUS `zone_set_cp` lui-meme depuis sql/226** : il portait encore son propre remplissage, ecrit quand la table avait une ligne par code postal, et sql/225 a fait de `cluster_id` une colonne de la cle primaire — donc `not null`, sans defaut. Cet `insert` ne pouvait plus qu'echouer en 23502, et c'est le SEUL chemin d'enregistrement d'un jeu (`POST /api/zones/jeux`, et le seed de demonstration). Les tests d'integration ne le voyaient pas : ils appellent la chaine en deux temps a la main. Le corriger sur place aurait donne deux implementations du meme remplissage, qui auraient diverge au premier correctif — l'une servant la carte, l'autre le plan. ⚠ Il ne recalcule pas non plus les totaux : `remplir_zone_set_cp` termine par `appliquer_seuil_zone_set`, qui les pose ET qui deduplique `pop_totale` avant de la sommer | `construire_zone_set` (sql/217, chainage sql/226) |
| `appliquer_seuil_zone_set` | **Rejoue le seuil de couverture SANS reconstruire** (sql/215). Le calcul couteux — quel carreau appartient a quelle classe, quelle part de chaque code postal cela couvre — NE DEPEND PAS du seuil : celui-ci ne decide que d'une chose, a partir de quelle part un code postal est `retenu`. On construit donc UNE fois en gardant `part_en_zone` pour TOUS les codes postaux touches, et le seuil se rejoue par un `update` sur 1 942 lignes. **Mesure : 22 a 65 ms contre 21,3 s.** C'est ce qui rend le curseur de dilution utilisable, et le curseur n'est pas cosmetique — mesure sur le profil par defaut, seuil 20 % : 1 113 codes postaux et 75,9 % d'utile ; seuil 35 % : 939 codes postaux et 88,4 %. `taux_utile` est `nullif(...)` et non `coalesce(..., 0)` : 0 % se lit « on achete tout pour ne viser personne », NULL se lit « aucun code postal retenu » | `api/zones/jeux/[id]/` (sql/215) |
| `purger_brouillons_zone_set` | Retire les brouillons d'atelier plus vieux que N heures (24 par defaut), geometries et codes postaux emportes en cascade | outil de menage (sql/215) |
| `seed_impressions_risque_demo` | **Seme les impressions de la campagne de demonstration SUR SON PLAN** (sql/213, remplace sql/208). Trois defauts mesures de la version precedente, chacun instructif : (1) **les trois partenaires valaient tous 7,06 EUR de CPM** — le bruit etait tire par (code postal, jour), donc moyenne sur 20 000 lignes par acteur il convergeait vers sa moyenne ; **un bruit qui varie sur un axe qu'on agrege ensuite ne distingue rien**, et le CPM est desormais une propriete de l'ACTEUR (4,20 / 8,10 / 10,60 EUR de base) ; (2) **1,2 milliard d'impressions en 30 jours** — le generateur partait de `population x 0,9` par code postal ET par jour, soit chaque habitant servi presque une fois par jour ; on fixe desormais le TOTAL (30 M) et on repartit ; (3) refusait de semer sans plan (`plan_absent`), sans quoi l'alignement retomberait sur le faux 100/100 que sql/209 vient de fermer. ⚠ **Le scenario REDISTRIBUE, il ne gonfle pas** : les parts etant normalisees par leur somme, booster un groupe en degonfle mecaniquement tous les autres — mesure avant correctif, les codes postaux neutres tombaient a 0,79 de leur plan et il ne restait **9 conformes sur 1 942**. Le facteur du groupe sur-diffuse est donc CALCULE pour absorber exactement ce que les coupes liberent, ce qui laisse le groupe neutre sur son plan. ⚠ **La coupe porte sur `haut:pprt`/`haut:1`/`haut:2` et non sur `haut:%`** : l'anneau le plus large `haut:3` porte a lui seul **1 468 des 1 942 codes postaux** (76 %), et l'y inclure ne laissait plus aucun groupe neutre. Resultat mesure : 30 000 028 impressions, **63 % de conformes**, 474 codes postaux sous-presses autour des sites classes, 251 sur-presses en Ile-de-France, score 86/100 | `scripts/seed-demo-campagne-risque.ts` (sql/213) |
| `purger_demo_risque` | Retire la campagne de demonstration ET les jeux de zones `[DEMO]`. La campagne emporte ses donnees, ses rollups et ses strategies en cascade ; un jeu emporte ses geometries et ses codes postaux | `scripts/seed-demo-campagne-risque.ts` (sql/213) |
| `classe_carreau_risque` | **La regle d'affectation unique, en SQL** : un carreau, un niveau, une bande. Transcription de `lib/risques/affectation.ts`, croisee avec elle a CHAQUE execution de la suite par `tests/integration/affectation-sql.test.ts` — contrairement aux trois jumeaux TypeScript precedents du projet (`lib/analyses/score.ts`, `lib/campagne/alignement.ts`, `lib/qualite/verdict.ts`), croises UNE FOIS a la main. ⚠ **Ecrite sans aucune sous-requete, et c'est une mesure** : la premiere version cherchait la bande par `generate_subscripts … limit 1`, correcte mais NON INLINABLE — PostgreSQL l'appelait reellement 883 451 fois, soit **108 s** contre **12 s** pour la meme agregation a plat. En `case` imbriquee, elle se fond dans la requete appelante. Plafond de quatre anneaux par niveau, la meme borne que `ANNEAUX_MAX` cote TypeScript | `population_par_classe` (sql/204) |
| `population_par_classe` | Population par classe du profil et par territoire (maille departement ou commune). `RETURNS jsonb` et non `TABLE` : cinquieme occurrence de la troncature PostgREST recensee dans le projet. **L'arrondi a lieu AU GRAIN LE PLUS FIN et nulle part ailleurs**, tous les totaux en decoulant par addition — arrondir chaque total separement produisait un ecart d'un habitant entre `total` et la somme de `par_classe` (14 103 577 contre 14 103 578), et un tableau qui ne s'additionne pas fait douter le lecteur, pas le logiciel. Meme correctif que sql/188. ⚠ **`parallel safe` n'est pas decoratif** : une fonction `security definer` est non parallelisable par defaut, et la marque fait passer l'appel national de **12,3 s a 2,8 s**. **`p_natures` ajoute sql/219 (2026-09-20)** : la fonction n'en portait AUCUN et la route ne lui en passait aucun, alors que le filtre vit dans la barre COMMUNE aux trois onglets — le decocher changeait la courbe du rayon d'influence (`couverture_rayon_risque` porte la dimension depuis sql/198) et pas le tableau juste au-dessus. Deux chiffres sur le meme ecran, l'un filtre, l'autre non. Sans filtre elle lit la table MERE (chemin rapide) ; avec filtre, la fille `carreau_risque_nature`. ⚠ **Une jointure ORDINAIRE et surtout pas un `lateral`** : ce dernier s'evalue LIGNE A LIGNE, soit un sous-plan pour chacun des 883 451 carreaux meme quand `v_filtre` est faux — mesure, **4,27 s contre 3,75 s**, un demi-seconde payee par ceux qui ne filtrent rien. Agregee une fois et jointe par hachage : **3,1 s**, donc plus rapide qu'avant l'ajout. Le filtre APPLIQUE repart dans la reponse (`filtre_natures_applique`) — un ecran ne doit pas avoir a SUPPOSER qu'il a ete honore. Un `drop function` a ete necessaire, un argument a valeur par defaut creant une SECONDE fonction (lecon de sql/191). **sql/222 (2026-09-20) lui donne QUATRE mailles** — `region`, `departement`, `commune`, `code_postal` — c'est ce qui permet a l'onglet Territoires de quitter `population_exposee_agregee`, dont le garde-fou de surface plafonne le rayon national a **1 179 m** quand le profil en demande 5 000 : les deux ecrans affichaient **390 112 et 24 406 618 habitants** pour le meme profil, et synchroniser deux reglettes n'y aurait rien change — l'ancien moteur rend un REFUS a 5 km, pas un chiffre. ⚠ `p_parent` est un code de DEPARTEMENT et `p_region` un code de REGION : DEUX arguments et non un parent polymorphe, **18 codes INSEE designant les deux** (piege de sql/171). ⚠ **Le total ne depend PAS de la maille** : les agregats d'en-tete sont groupes sur la CLASSE SEULE. Groupes sur (unite, classe), l'arrondi au grain fin les faisait bouger — 24 406 565 en region contre 24 408 136 en commune pour un meme profil, la meme famille de defaut que celui qu'on corrigeait. Mesure apres correctif : **24 406 555 aux quatre mailles**, ~4 s chacune. Rend aussi `nom`, `pop_totale` et `surface_km2` par unite — la part sur le denominateur COHERENT d'`unite_population_totale`, la densite sur la superficie ADMINISTRATIVE, parce que « combien d'exposes par km2 de territoire » n'est pas « par km2 habite » | `api/risques/profil/bandes/` (sql/204, `p_natures` sql/219, mailles et denominateur sql/222) |
| `classer_lot_risque` | Classe un lot de cas en un appel, pour le croisement TypeScript/SQL. **ENVELOPPE MINCE** de `classe_carreau_risque` : une seconde transcription ici ferait valider par le test une fonction que l'application n'appelle pas — le test resterait vert pendant que l'ecran afficherait faux | `tests/integration/affectation-sql.test.ts` (sql/204) |
| `ordinal_nature` | Traduit un libelle de nature en son `rang_gravite` du registre `icpe_rubrique_familles`, **0 pour l'inconnu**. Le repli sur 0 est CORRECT ici et nulle part ailleurs : a la construction, un site dont la nature n'est pas repertoriee doit garder une ligne, sous « Nature non precisee » — le faire disparaitre rendrait un carreau sans aucune nature, indiscernable d'un carreau hors de portee | `construire_carreau_risque_nature`, `population_par_classe` (sql/218) |
| `natures_inconnues` | **Le pendant de `ordinal_nature` pour le FILTRAGE** : rend les libelles qu'on ne sait PAS resoudre, ou NULL si tous le sont. Existe parce que le repli sur 0 ment des qu'on filtre — il sert le seau des natures non precisees sous le nom d'une autre. Mesure le 2026-09-20 : « GPL et produits petroliers » sans accent rendait **136 277 habitants au lieu de 7 753 811**, un chiffre plausible pour une question que personne n'avait posee. ⚠ Le lot ENTIER est refuse des qu'un libelle est inconnu — calculer sur les autres en taisant celui-la rendrait un chiffre juste pour une question amputee. « Nature non precisee » est une valeur LEGITIME du filtre, et la seule sans ligne au registre | `population_par_classe`, `construire_zone_set_corps` (sql/218) |
| `construire_carreau_risque_nature` | Construit UNE bande de longitude de `carreau_risque_nature`. Meme decoupage et memes bornes parametrables que sa soeur de sql/203 — les bandes decoupent les CARREAUX, jamais les sites. La seule difference tient en un `group by … s.nature_ord`, plus un `full join` pour rattacher le PPRT de la meme nature | `scripts/construire_carreau_risque.mjs` (sql/218) |
| `remplir_pprt_nature_generateur` | Pose `nature_ord` sur `pprt_niveau_generateur`, par la MEME regle de rattachement au site le plus proche a 500 m que le niveau. 532 des 664 perimetres. A rejouer apres tout import de sites ou de perimetres | `scripts/construire_carreau_risque.mjs` (sql/218) |
| `construire_carreau_risque_distance` | Construit UNE bande de longitude de `carreau_risque_distance`. Les bandes decoupent les CARREAUX et jamais les sites : un carreau doit etre traite exactement une fois. Bornes parametrables (lecon de sql/200) — et **le piege a coute une seconde fois** : la premiere construction n'a couvert que -5,5 a 9,8 et la **Martinique (972) et La Reunion (974) manquaient**, 14 058 carreaux absents sans le moindre message. L'outre-mer se construit par des appels SEPARES, cles de journal >= 1000 | `scripts/construire_carreau_risque.mjs` (sql/203) |
| `remplir_pprt_niveau_generateur` | Remplit `pprt_niveau_generateur`. A rejouer apres tout import de sites ou de perimetres | `scripts/construire_carreau_risque.mjs` (sql/203) |
| `vider_carreau_risque_distance` | Vidange complete, a rejouer apres un rechargement de `carreaux_filosofi` — les id sont des bigint de sequence et ne survivent pas au rechargement. Ne vide PAS `pprt_niveau_generateur`, qui ne depend pas des carreaux | sql/203 |
| `sites_exposition` | **Source UNIQUE du predicat** qui choisit les sites a risque du calcul d'exposition (sql/190). Extraite d'une CTE de `population_exposee_agregee` pour que le garde-fou de cout compte EXACTEMENT ce que le calcul traite : recopier le predicat aurait donne deux versions qui divergent au premier correctif, donc un garde-fou qui protege autre chose que ce qu'il mesure. Appelee seulement depuis d'autres fonctions, jamais par PostgREST — hors du champ de la troncature a 5 000 lignes. `revoke` anon/authenticated | `population_exposee_agregee` (sql/190) |
| `vider_exposition_cache` | Vidange manuelle d'`exposition_cache`, par age de LECTURE (`lu_le`) et non de calcul : on garde ce qui sert, pas ce qui est recent. Necessaire au millesime INSEE, seul changement que la cle ne detecte pas | sql/193 |
| `lire_couverture_rayon` | Lit la courbe cumulee depuis la table pre-calculee — **aucun croisement geometrique**. Rend une grille COMPLETE de 100 a 10 000 par pas de 100 : une nature sans carreau a un palier n'a pas de ligne (mesure : 94 points sur 99 pour « Inflammables »), et Recharts relierait les points existants en inventant une pente. Le dernier cumul connu est donc reporte. **L'increment est la DIFFERENCE de deux cumuls arrondis** et jamais l'arrondi de l'increment brut : 100 arrondis independants s'accumulaient a 26 habitants d'ecart sur le total, alors que la spec exige l'egalite exacte — meme correctif que sql/188. Le decalage de 100 m est voulu : le palier `b` regroupe [b, b+100), donc « a moins de 100 m » est l'increment du palier 0 | `api/risques/exposition/rayon/` (sql/199) |
| `export_couverture_rayon` | La table `couverture_rayon_risque` ENTIERE pour une cible, au grain (departement x gravite x nature), paliers en objet CREUX `{indice: pop}` — la grille dense et les cumuls se font cote TypeScript avec la convention de sql/199. Plus les departements, regions et leurs denominateurs (`unite_population_totale`). `RETURNS jsonb`. ⚠ La premiere version densifiait la grille par jointure et prenait 12 s ; des `exists` sur la CTE la relisaient ensuite par departement (5 s). Un seul `group by` et une liste `materialized` : **0,33 s** a chaud, 5,4 s a froid (lecture de la table) | `api/risques/exposition/rayon/export/` (sql/233) |
| `compter_sites_rayon` | Nombre de sites concernes par les filtres, pour le KPI de l'onglet. Ne se deduit pas de la table de couverture, qui compte des carreaux. `sum(n)` et non `count(*)` — la sous-requete etant groupee par nature, `count(*)` aurait rendu 8 au lieu de 1 258 | `api/risques/exposition/rayon/` (sql/199) |
| `construire_couverture_rayon` | Construit UNE bande de longitude. Les bandes decoupent les CARREAUX, jamais les sites : un carreau doit etre traite exactement une fois, sans quoi son minimum serait calcule sur un sous-ensemble a chaque passe. **Deux correctifs de performance mesures en production** — (1) les SITES aussi sont filtres par la bande, sans quoi chacune parcourait les 1 258 sites de France ; (2) le jsonb des carreaux est SORTI des cles de groupement, car `metadata` pese ~806 octets et Postgres devait le hacher pour chaque groupe a chacun des quatre niveaux : **54,5 s -> 7,4 s** sur la meme bande, resultat identique **sql/200 (2026-09-18) : les deux bornes du decoupage sont devenues des PARAMETRES** (`p_lon_ouest` / `p_lon_est`, defauts -5.5 / 9.8 — donc tout appel existant inchange). C'etaient deux constantes, la bbox metropole de `CLAUDE.md`, et **1 698 sites ICPE dont 45 SEVESO** tombent hors de cet intervalle : ils n'apparaissaient sur AUCUNE courbe, et rien ne le disait — la courbe montre une population, et une population absente ressemble trait pour trait a une population nulle. L'outre-mer se construit par des appels SEPARES (une bande par zone, cle de journal >= 1000) et non en elargissant le decoupage : un partitionnement uniforme de -61,8 a 55,8 mettrait la France entiere dans une ou deux bandes de 1 degre, exactement les bandes trop denses qui depassaient deja le delai. `p_bande_id` separe la CLE DE JOURNAL de l'INDEX de bande, que sql/198 confondait : une zone traitee en une seule bande a forcement l'index 0, deja pris par la premiere bande de metropole, qu'elle ecrasait. ⚠ **Limite qui reste, et qui n'est pas de notre fait** : le carroyage Filosofi 2021 a 200 m ne publie que metropole + Martinique + La Reunion. La Guadeloupe, la Guyane et Mayotte ont des sites mais AUCUN carreau, donc une population exposee nulle — une donnee absente, pas un zero. | `scripts/construire_couverture_rayon.mjs` (sql/198, bornes parametrables sql/200) |
| `rayon_defaut_exposition` | Rayon par defaut des sites sans PPRT, **DEDUIT** des 664 perimetres reels : moyenne des rayons equivalents `r = racine(aire/pi)`, **532 m** mesures le 2026-09-18 (mediane 286 m, Q1 99 m, Q3 654 m, max 12 307 m). C'est la moyenne des RAYONS et non le rayon de l'aire moyenne — les deux different d'un facteur deux (532 contre 974 m), la racine carree etant concave. ⚠ Probablement trop genereux pour les sites concernes : un PPRT n'existe que la ou l'Etat a juge le risque assez fort, et les sites qui n'en ont pas sont majoritairement des Seveso seuil BAS | `api/risques/exposition/agregats/` (sql/185) |
| `population_exposee_site` | **Population exposee d'un site** (sql/180). Prorata de SURFACE des carreaux INSEE 200 m intersectes : un carreau dont 30 % tombe dans la zone contribue 30 % de ses habitants — hypothese d'uniformite dans le carreau, fausse au detail, la seule possible sans palier plus fin. ⚠ **La population est dans `metadata->>'ind'`** : la colonne `ind` existe mais est NULL sur les 2 298 582 lignes, la lire rendrait ZERO partout sans erreur. Buffer construit sur `geography` (a Marseille un metre de 3857 vaut ~0,73 m reel : « 500 m » en couvrirait 685) puis transforme UNE fois en 3857, ou vit l'index GIST. ⚠ `carreaux_filosofi` ne couvre que les carreaux HABITES : 0 carreau = 0 habitant, pas une lacune — 250 des 664 perimetres sont dans ce cas. Mesures (prod, 2026-09-18) : un perimetre 299 ms / `shared hit=1367 read=242`, Index Scan ; les 664 perimetres = **173 819 habitants**, 414 peuples ; invariants du prompt verifies sur 40 sites (somme des couronnes = cumul 40/40, 0 palier decroissant) | `api/risques/[siteId]/exposition/` (sql/180) |
| `risques_industriels_carte` | Sites ICPE d'une bbox pour la couche carte dediee, **rattaches a leur perimetre PPRT** (sql/179) et avec zone CALCULEE optionnelle. `statut_zone` (`pprt` / `sans_pprt` / `non_soumis` / `non_concerne`) est calcule EN BASE et repond a la seule question qui compte a l'ecran : cette zone est-elle publiee par l'Etat, ou calculee par nous ? Il distingue une donnee qui MANQUE (seuil haut sans PPRT, 137 sites) d'une zone qui n'existe pas EN DROIT (seuil bas, non soumis) — les confondre ferait passer une regle de droit pour une lacune d'import. Rattachement au perimetre le plus proche a **500 m**, et non par inclusion stricte : les coordonnees AIOT pointent parfois l'entree du site ou le centroide communal, et l'inclusion stricte perdait 71 Seveso seuil haut dont le PPRT est a 200 m (mesure : 496 -> 567 sur 717). ⚠ **`idx_pprt_geog` (GIST sur `geom::geography`) est OBLIGATOIRE** : `idx_pprt_geom` porte sur `geom` en geometry et le cast le rend inutilisable, d'ou un Seq Scan des 664 polygones PAR SITE — **118 340 ms et 1 614 807 buffers** mesures sur l'Etang de Berre, contre **164 ms et 3 332 buffers** avec l'index. `ST_Buffer` sur **geography** : rayon en metres, jamais en degres — en 4326 « 500 m » vaudrait 500 m en latitude et ~350 m en longitude a Marseille, une ellipse presentee comme un cercle (meme raison que `zone_rayon`, sql/155). C'est la MEME geometrie qui servira a compter la population exposee : une seule definition du cercle, pas une pour l'affichage et une pour le calcul. Mesure : 1 259 sites + zones de 500 m = 4,2 Mo en 323 ms, 0 lecture disque | `api/map/risques-industriels/` (sql/175, rattachement sql/179) |
| `consolider_geo_icpe` | Repare `code_departement`/`departement`/`region` des POI ICPE depuis `metadata.code_insee`. Existe parce que **la pagination de l'API Georisques n'est pas stable** : deux imports successifs ont apporte 4 500 sites inedits et laisse 6 079 sites non revus (~5 % de rotation), donc les colonnes ajoutees apres un import ne se remplissent que pour les lignes que l'API veut bien renvoyer — et sans `code_departement`, `/api/map/pois` ne rend RIEN sur un filtre departemental | `api/admin/import-georisques/` (sql/174) |
| `pprt_perimetres_carte` | Perimetres PPRT d'une bbox pour la couche carte. **`ST_SimplifyPreserveTopology` et JAMAIS `ST_Simplify`**, tolerance **PLAFONNEE a 0,0001 deg (~11 m)** : mesure sur les 664 zones, `ST_Simplify` en vide **18** a 11 m et **602 sur 664** a une tolerance derivee de l'etendue France — un PPRT fait 0,94 km de large en moyenne et **2 m** au minimum, donc la regle de `alignement_par_maille_geo` (ruling T13A-1) detruirait cette couche. PreserveTopology a 11 m : 0 zone videe, 0 invalide, 0,314 % de surface. La limite coupe les PLUS PETITES zones d'abord (un bassin industriel compte plus qu'un eclat de 2 m) et `n_total` est compte AVANT | `api/map/pprt/` (sql/178) |
| `pprt_importer_partition` | Remplace en UNE transaction toutes les zones PPRT d'une partition : DELETE cible + INSERT set-based. La partition n'est donc jamais vide en base, contrairement a un DELETE puis un INSERT emis separement par le client. `ST_MakeValid` puis `ST_CollectionExtract(..., 3)` avant insertion — un trace depose par une DDT peut se croiser, et la colonne MultiPolygon refuserait la GeometryCollection que rend la reparation. Rend `recues`/`supprimees`/`inserees`/`ecartees` | `api/admin/import-pprt/` (sql/177) |
| `pprt_consolider_departement` | Rattrape `code_departement`/`nom_departement`/`code_region` des zones PPRT qui en manquent, par recouvrement maximal sur `ref_departements` — une zone a cheval tombe du cote ou elle mord le plus. Rejouable, ne touche jamais une ligne deja renseignee. Pendant de `consolider_geo_icpe` | `api/admin/import-pprt/` (sql/177) |
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
| `CONTENEUR_PG` | Nom du conteneur Postgres local (defaut `supabase_db_genesis_app`). Lu par les **cinq outils de construction** qui parlent a la base par `docker exec psql` plutot que par HTTP — `construire_carreau_risque.mjs`, `construire_couverture_rayon.mjs`, `seed-demo-campagne-risque.ts` et les deux moteurs `scripts/local/rapatrier-*.mjs`. C'est la variable qui dit OU est la base : sur un poste ou le conteneur porte un autre nom, tout le pre-calcul echoue |
| `DEST_SAUVEGARDE` | Destination de `10-sauvegarder.sh` (defaut `C:/GENESIS/_sauvegarde_locale`). ⚠ La pointer sur un AUTRE disque que le volume Docker est le seul moyen que la sauvegarde protege d'autre chose qu'une erreur logicielle |
| `ATMO_API_URL` | Override de l'API REST Atmo Data v2 (defaut `https://admindata.atmo-france.org`). ⚠ **A ne pas confondre avec `ATMO_WFS_URL`** juste au-dessus : celle-ci vise l'API authentifiee (`ATMO_FRANCE_USERNAME`/`PASSWORD`), celle-la le GeoServer WFS public sans identifiant qui sert l'ingestion nationale |
| `GITHUB_ACTIONS_TOKEN` | Jeton de declenchement du workflow PMTiles depuis `/api/admin/trigger-pmtiles` |
| `GITHUB_REPO` | Depot vise par ce declenchement, au format `owner/repo`. ⚠ Ces deux variables pilotent le workflow `generate-iris-pmtiles`, qui **n'alimente plus rien** depuis le passage des IRIS aux tuiles MVT servies par Postgres (voir la section dediee) : elles survivent a leur usage et partiront avec lui |
| `DATABASE_URL` / `POSTGRES_URL` | Replis de `SUPABASE_DB_URL` dans `scripts/populate_geom_3857.ts`, seul consommateur. Les trois noms y sont essayes dans cet ordre |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Vue Street View d'un panneau dans `app/copilote/_components/MapPanel.tsx` — l'unique consommateur, et **la seule dependance Google Maps du produit** (la cartographie est MapLibre + OpenFreeMap). `NEXT_PUBLIC_`, donc **inlinee dans le bundle client** : restreindre la cle par referent cote console Google, elle est lisible par tout visiteur. Absente, le composant remplace l'iframe par un bandeau rouge qui NOMME la variable (`MapPanel.tsx:331`) — verifie, pas de plantage |

---

## Contraintes operationnelles

### Budget I/O Supabase — les regles tiennent, le chiffre n'est plus citable

> **Ce titre annoncait « Supabase Nano (250 IOPS, 5 MB/s, burst 30 min/jour) »
> jusqu'au 2026-09-16.** Il contredisait le tableau Stack technique de CE MEME
> document, huit cents lignes plus haut : le compute est **Micro**, pas Nano
> (`shared_buffers` 256 Mo, `effective_cache_size` 768 Mo, ~1 Go de RAM), et
> une lecture sequentielle de 348 Mo a ete chronometree a **~195 Mo/s** le
> 2026-09-13, pas 5. `CLAUDE.md` conclut depuis cette mesure : « ne plus
> **citer** 250 IOPS / 5 MB/s comme un fait etabli ». Le document autoritaire
> le citait quand meme, dans son titre.
>
> **Cela ne releve AUCUNE des regles ci-dessous.** Une mesure unique ne
> distingue pas un debit soutenu d'une rafale sur credits de burst, les trois
> incidents d'epuisement d'I/O ont bien eu lieu, et le plafond qui a lache
> etait peut-etre le debit ALEATOIRE, que cette mesure sequentielle ne dit pas.
> Tant que le palier et l'IOPS provisionnee ne sont pas releves dans la console
> Supabase (point 0 de `docs/audit/QUICK_WINS.md`, non lisible en SQL), on
> continue de coder comme si la marge etait etroite.

- Max 3 requetes Supabase paralleles (`Promise.all`)
- Bbox = viewport carte visible, jamais France entiere
- Lazy loading : 1 colonne IRIS a la fois
- Cache client `useRef` avant tout fetch
- Batch insert par 50 max (`lib/import/inserter.ts`)
- `EXPLAIN ANALYZE` sur toute nouvelle requete PostGIS

### PostgREST — troncature a 5 000 lignes, sans erreur

- **Toute** fonction `RETURNS TABLE` ou `SETOF` est coupee a 5 000 lignes par
  PostgREST, sans exception levee, sans en-tete, sans avertissement. Cinq
  occurrences recensees dans ce projet, **trois encore ouvertes en
  production** : `docs/SUITE_TRONCATURE_POSTGREST.md`.
- Une RPC dont le resultat peut depasser ce seuil est `RETURNS jsonb`. Changer
  le type de retour d'une fonction existante exige un `DROP`, exclu en
  production : on ecrit une **jumelle** `_jsonb` porteuse du corps, et
  l'originale devient une **enveloppe mince** (patron sql/154, 168-169, 170).
- ⚠ **Sur une requete de TABLE ordinaire, le plafond est `db-max-rows`, et il
  vaut 1 000 sur le stack local** (`supabase/config.toml:18`,
  `PGRST_DB_MAX_ROWS=1000`, verifie dans l'environnement du conteneur le
  2026-09-20). C'est un plafond SERVEUR : `.limit(100000)` ne le leve pas, il
  demande seulement moins que lui. Passer par `lireTout`
  (`lib/supabase/lire-tout.ts`), qui pagine et LEVE plutot que de rendre un
  debut. Ce document affirmait l'inverse jusqu'a cette date.
- `tests/unit/db/troncature-postgrest.test.ts` exige une borne ecrite pour
  chaque RPC tabulaire appelee par l'application.

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

## Perimetres PPRT — la source est la Geoplateforme, PAS le WFS Georisques

> Mesure du 2026-09-17. Ce document affirmait que le WFS Georisques
> `PPRT_PERIMETRE_RISQIND` « porte les polygones de perimetre PPRT » et
> plafonnait « a 80 000 features ». **Les deux enonces sont faux**, et le
> premier est le plus couteux : il aurait fait batir le chantier sur une couche
> qui ne contient pas ce que son nom annonce.

**Retenu : `wfs_sup:assiette_sup_s` sur `data.geopf.fr/wfs/ows`, filtre
`suptype='pm3'`.** La categorie **PM3** des servitudes d'utilite publique EST
le PPRT ; la couche est alimentee par le Geoportail de l'Urbanisme, ou chaque
DDT depose ses documents.

| | Geoplateforme `wfs_sup` (retenu) | Georisques `PPRT_PERIMETRE_RISQIND` (ecarte) |
|---|---|---|
| Lignes a telecharger | **664** | **~147 000** (borne par dichotomie entre 146 875 et 148 437) |
| Contenu | PPRT uniquement | **TOUS les PPR** — la ligne a `STARTINDEX=100000` est `lib_ppr = 'PPRN-Mvt - MOLIERES'`, un PPR mouvement de terrain |
| `CQL_FILTER` | honore (664 sur 138 558 assiettes toutes SUP) | **ignore en silence** — `lib_ppr LIKE 'PPRT%'` rend `PPRmt_Pougny` |
| `numberMatched` | exact | **vaut toujours 500**, quel que soit `STARTINDEX` : on ne peut pas savoir quand s'arreter |
| Sortie | GeoJSON | GML seulement (`application/json` refuse) |
| Requetes pour tout avoir | 1 | ~294 pages de 500, puis filtrage cote client |

Mesures sur les 664 polygones : **5,6 Mo** de GeoJSON, 202 899 sommets
(306 par zone), bbox **lon -61,56 a 55,58 / lat -21,20 a 51,06** — les DROM
sont dedans (971, 973, 974). Etang de Berre : 14 zones nommees proprement
(« PPRT ARCELOR MITTAL », « PPRT FOS-OUEST », « PPRT BUTAGAZ Rognac »).

**Couverture reelle, mesuree APRES import : 87 departements sur les 88 qui ont
un PPRT.** Seule la **Haute-Loire (43), 2 procedures**, n'a aucune zone.

> ⚠️ **Correction du 2026-09-17, meme jour.** Ce paragraphe annoncait « 63
> departements » et « au moins 78 procedures (19 %) manquantes, dont la
> Seine-Maritime (10 PPRT), la Haute-Garonne (9) et la Loire-Atlantique (7) ».
> **C'etait faux, et la cause est instructive** : la couverture avait ete
> recensee en lisant le code departemental dans le NOM DE PARTITION, or 5 des
> 69 depots sont **regionaux** (`_SUP_R76_` = Occitanie) et portent 77 des 664
> zones a eux seuls. Les trois departements cites sont bel et bien presents —
> verifie en base apres import, avec le compte EXACT de `gaspar/pprt` :
> Seine-Maritime 10 zones / 10 generateurs, Haute-Garonne 9, Loire-Atlantique
> 7. C'est pour cela que `code_departement` est desormais calcule par
> **recouvrement geometrique** sur `ref_departements` et jamais lu dans un nom
> de fichier.

**Une limite qui reste, et il faut la dire au client :**

- **C'est l'ENVELOPPE du PPRT, pas le zonage interne.** `typeass` vaut
  « Enveloppe des zonages reglementaires » sur 633 des 664 lignes : un polygone
  par procedure, sans la distinction rouge/bleu/grise. Et ce zonage interne
  **n'est pas normalise a l'echelle nationale** — `gaspar/pprt` declare plus de
  **200 libelles distincts** de `codeZone` pour ce qui devrait etre quatre
  familles (`R`, `r`, `B`, `b`, `G`), chaque DDT nommant les siennes a sa
  facon (« petit b Faible (Fai) », « zone grisée », « B_Autorisation sous
  conditions et prescriptions »...). Le detail rouge/bleu n'existe que dans les
  jeux `data.gouv.fr` publies **un par PPRT ou par departement** par chaque
  DDT/DREAL — eparpilles, aux schemas variables, sans point d'entree unique.

**Fraicheur** : `gpu_timestamp` est propre a chaque document depose (de 2020-07
a 2026-08 dans le lot). Ce n'est donc pas un referentiel fige comme l'annoncait
ce document, mais il n'est pas non plus homogene : chaque PPRT date du jour ou
sa DDT l'a televerse.

### Ce qui est en place (2026-09-17, sql/177)

**TROIS nombres, aucun interchangeable** — c'est le piege de vocabulaire de
cette source : **664 assiettes** (les polygones, une ligne de table chacun),
**609 generateurs** (`id_generateur` = l'etablissement a l'origine du risque),
**415 procedures PPRT** (`gaspar/pprt`). Plusieurs generateurs relevent d'une
meme procedure. La colonne s'appelait `id_procedure` a la premiere ecriture :
quiconque l'aurait comptee aurait annonce « 609 PPRT ». Renommee avant toute
donnee en production.

> ⚠️ **Correction du 2026-09-18 : la cle de jointure vers GASPAR EXISTE.**
> Ce paragraphe affirmait que « ce flux ne porte aucune cle de jointure vers
> GASPAR », ce qui fermait la porte a tout enrichissement par les donnees de
> procedure (nom du plan, bassin de risques, types de zones reglementaires).
> C'est faux : la couche **`wfs_sup:generateur_sup_s`** porte un champ
> **`id_gaspar`**, et l'assiette porte `idgen`.
>
> Mesure du 2026-09-18 sur le flux complet : **664 assiettes / 664 se
> rattachent a un generateur** (609 distincts, 711 entites au total), **0 sans
> `id_gaspar`**, atteignant **404 procedures GASPAR distinctes** sur les 415
> recensees — coherent avec les 403 PPRT prevus au niveau national.
> `GET /api/v1/gaspar/pprt` rend alors, par procedure, `libPpr`,
> `libBassinRisques` et `zonageReglementaire.listTypeReg` (les `codeZone`
> R / r / B / b) — **sans geometrie**.
>
> `id_gaspar` n'est PAS encore importe dans `pprt_perimetres` : seul
> `id_generateur` l'est. L'ajouter demande une passe d'import supplementaire
> (une requete WFS de plus sur `generateur_sup_s`), non faite a ce jour.

| Objet | Role |
|---|---|
| `POST /api/admin/import-pprt` | Import NDJSON avec progression. UN appel sortant (le WFS rend les 664 en une fois, 5,6 Mo), puis UNE transaction par partition. Corps `{partitions?: string[]}` pour rejouer un seul document. `requireAdmin()` |
| `pprt_perimetres` | 664 lignes, **15 Mo**, `geom` 4326 + `geom_3857` pre-calculee (c'est en 3857 que vit l'index GIST de `carreaux_1km`, donc la projection du chantier C) + `superficie_km2` sur `geography`. RLS deny-all |
| `pprt_importer_partition(text, jsonb)` | DELETE cible + INSERT set-based dans la MEME transaction : la partition n'est jamais vide en base, meme une fraction de seconde |
| `pprt_consolider_departement()` | Rattrape les zones sans departement, rejouable — pendant de `consolider_geo_icpe` (sql/174) |
| `lib/import/pprt/normalisation.ts` | Logique pure, 47 tests sur une table de verite batie des valeurs REELLEMENT mesurees |

**Mesures de l'import** (local, 2026-09-17) : 664 recues / 664 ecrites / **0
rejetee, 0 ecartee, 0 echec, 0 sans departement**, 69 partitions, **11,2 s**,
1 979 km2 cumules, 0 geometrie invalide. Rejeu verifie : la seconde passe
supprime 664 et reecrit 664, net inchange. Requete carte type (bbox Etang de
Berre) : **Bitmap Index Scan, 0,12 ms, `shared hit=17`, 0 lecture disque**.

> ⚠️ **Corrige le 2026-09-18 : ce paragraphe annoncait « les donnees ne sont
> qu'en LOCAL ; la prod ne porte que la structure (table vide, fonctions) ».
> C'est FAUX depuis le deploiement des migrations du chantier exposition.**
> Mesure directe en prod ce jour : `pprt_perimetres` **664 lignes**,
> `poi_france` categorie `risque_industriel` **96 427**, `carreaux_filosofi`
> **2 298 582**, `cibles_exposition` **24**, et les trois RPC d'exposition
> presentes. Lire cette phrase aurait fait croire qu'un test contre la prod ne
> rendrait rien, alors que c'est le SEUL endroit ou les chiffres sont complets.

> **Ce paragraphe disait le contraire jusqu'au 2026-09-18 au soir**, et sa
> conclusion — « un ecran d'exposition se teste contre la prod, en lecture » —
> est ce qui a fait developper tout le module exposition CONTRE la production,
> jusqu'a ce que Supabase signale l'epuisement du budget d'I/O. Il decrivait
> une situation reelle (local a 8,7 %) mais la presentait comme une fatalite
> alors qu'elle tenait a une seule ligne d'exclusion dans `02-dump-prod.sh`.

**Local et prod portent le meme jeu de carreaux depuis le 2026-09-18** — et le
local en porte meme **plus**. `carreaux_filosofi` reste exclu du dump (4 630 Mo
a tirer de la prod), mais il se charge desormais depuis la SOURCE PUBLIQUE
INSEE, sans toucher a Supabase et sans aucun identifiant :
`scripts/local/07-carreaux-insee.sh`.

| | carreaux 200 m |
|---|---|
| production | 2 298 582 — metropole seule |
| local apres `07` | **2 324 577** — metropole + Martinique + La Reunion |

Les 25 995 carreaux supplementaires sont ceux des DROM, que l'INSEE publie dans
le meme fichier et que la prod n'a jamais eus. **Ne PAS prendre le parquet de
`data.gouv.fr`** : il se resout en `carreaux-200m-met-3035.parquet`, metropole
seule, soit exactement la lacune qu'on repare.

Fidelite verifiee avant d'ecrire le chargeur, et non supposee : sur le carreau
`CRS3035RES200mN2242800E3635800`, les 31 champs de `metadata` concordent un a
un avec la ligne du CSV, et la geometrie reconstruite s'ecarte de **1,1 mm** au
centroide (Hausdorff 1,3 mm, surface 0,26 m2 sur 40 000, soit 6 ppm) — un
dernier bit de `double` entre deux versions de PROJ. `ST_Equals` repond quand
meme « faux », etant un test EXACT : ne pas s'en alarmer.

Trois pieges de la source, mesures :
- **Le SRID est DANS l'identifiant et change d'une zone a l'autre** : metropole
  **3035**, Martinique **5490**, La Reunion **2975**. Appliquer 3035 aux trois
  fichiers poserait les carreaux antillais au large du Portugal, sans la moindre
  erreur — la projection etant parfaitement valide.
- **`N` et `E` donnent le coin SUD-OUEST, pas le centre** : verifie contre les
  geometries deja en base, 0,0 m d'ecart pour le coin, 142 m pour le centre.
- **`lcog_geo` peut porter plusieurs communes separees par une virgule**
  (`"66061,66179"`), le champ etant alors entre guillemets.

⚠ **`carreaux_filosofi.id` est un `bigint` de sequence**, pas un identifiant
derivable d'`idcar` : les id locaux ne sont donc PAS ceux de la prod. Verifie
avant le chargement — aucune cle etrangere ne pointe vers cette table, aucun
trigger ne la garnit, et aucun cache applicatif ne stocke d'id de carreau
(`exposition_cache`, `couverture_rayon_risque` et `seveso_exposition` ne gardent
que des agregats). La cle stable est `(idcar, resolution, millesime)`, qui porte
l'index UNIQUE.

**Trois defauts de la source, traites et testes** — a ne pas redecouvrir :
- **`idass` n'identifie rien** : 660 valeurs distinctes pour 664 lignes.
  `2147483647` (INT32_MAX, un debordement chez l'editeur) est porte par QUATRE
  PPRT sans rapport. L'identite est donc un UUIDv5 de
  `partition | nom_technique | md5(geometrie)`, unique sur les 664 et stable au
  rejeu.
- **`typeass` arrive en SIX orthographes pour deux familles**, dont une en
  mojibake (`Pï¿½rimï¿½tre...`, l'UTF-8 de l'editeur relu en latin-1) et une
  ligne valant `24`. Reparti en 639 enveloppes / 18 perimetres reglementes /
  7 indetermines, la valeur brute toujours conservee a cote.
- **Le nom lisible manque sur 202 des 664 lignes** : repli sur le nom technique,
  degrossi.

## Environnement de developpement local (2026-09-17)

> Le dev tapait jusqu'ici directement dans la base de PROD — la meme que
> Vercel — avec les consequences d'I/O documentees plus haut. Le stack Supabase
> local (`supabase/config.toml`, deja present mais jamais monte) sert desormais
> de bac a sable : Postgres 17 + PostGIS, PostgREST, GoTrue, Realtime, Storage
> et Studio, en conteneurs.

**Dix-huit fichiers** dans `scripts/local/`, rejouables un par un — dont trois
font doublon, voir l'avertissement sous le tableau. (Ce nombre annoncait
**onze** jusqu'au 2026-09-22 : les cinq fichiers ajoutes les 19 et 20 septembre
— dont la seule SAUVEGARDE de la base — n'etaient decrits nulle part dans ce
document. Voir le paragraphe « Cinq fichiers manquaient » sous le tableau. Les
deux derniers, `11-reconstruire.sh` et `12-sante.sh`, sont nes de la reprise du
22 : l'un porte l'ordre de remontage, l'autre le diagnostic.)

| Script | Role |
|---|---|
| `00-docker-up.sh` | demarre le moteur Docker et **diagnostique la RAM** avant d'attendre |
| `01-supabase-up.sh` | `supabase start` — API 54321 · Postgres 54322 · Studio 54323 · mails 54324 |
| `02-dump-prod.sh` | ⚠ **INERTE depuis le 2026-09-22** : il dumpait le projet heberge, supprime le 19/09, et `$DUMP_DIR` (`C:/GENESIS/_dump_prod`) a ete efface le 22 apres verification table par table — les 91 tables du dump sont en base locale, aucune avec MOINS de lignes, plusieurs avec plus (`poi_france` 390 029 contre 290 877). Conserve comme trace du chemin de rapatriement, il ne peut plus rien dumper |
| `03-restore-local.sh` | remise a zero de `public` + extensions -> comptes auth -> `public.sql`, via le `psql` du conteneur. **Rejouable** |
| `04-env-local.sh` | ecrit `.env.development.local` (surcharge dev, `.env.local` intact) |
| `05-verifier.sh` | controle en trois temps : conteneurs, volumetrie en base, **et PostgREST** — c'est PostgREST que l'app appelle, pas `psql` |
| **`07-carreaux-insee.sh`** | **charge les 2 324 577 carreaux 200 m depuis le CSV INSEE** — voir la section carreaux plus haut. C'est le SEUL des quatre chemins ci-dessous a ne rien couter a la production, a ne demander aucun identifiant, et a porter les DROM |
| `06-rapatrier-carreaux.sh` | ⚠ copie `carreaux_filosofi` depuis la PROD par tranches de hachage — **supplante par `07-carreaux-insee.sh`** |
| `07-carreaux-200m.sh` | ⚠ copie `carreaux_filosofi` depuis la PROD par tranches d'index — **supplante, et DOUBLON de la ligne precedente** (voir la note ci-dessous) |
| `06-completer-tables-lourdes.sh` | ⚠ copie `carreaux_filosofi` ET `comptages_routiers` depuis la PROD — **supplante pour les carreaux** ; reste le seul chemin pour `comptages_routiers`, dont 99,7 % est du proxy OSM et non du TMJA mesure |
| `08-rapatrier-radio.sh` (+ `rapatrier-radio.mjs`, le moteur) | rapatrie les TROIS tables radio de la prod. Mesure du 2026-09-19 : le local portait **40 496** liaisons `emetteur_radio_stations` contre **569 698** en prod (-93 %) tout en ayant PLUS d'emetteurs — le dump du 17/09 en avait perdu l'essentiel sans rien signaler. Joue avant la coupure du projet heberge ; ces 569 698 lignes n'existent plus ailleurs |
| `09-rapatrier-tmja-reel.sh` (+ `rapatrier-tmja-reel.mjs`) | rapatrie les **1 100 comptages routiers MESURES** (`source = 'tmja_rrn_national'`) et EUX SEULS — les 406 930 lignes de `osm_highway_proxy`, 11 valeurs constantes, sont volontairement abandonnees. Meme fenetre que le 08 : joue avant la coupure |
| **`10-sauvegarder.sh`** | **la seule sauvegarde de la base, et la seule copie des donnees depuis la coupure du 2026-09-19.** `pg_dump -Fc` des schemas `public` + `auth` vers `$DEST_SAUVEGARDE` (defaut `C:/GENESIS/_sauvegarde_locale`), puis **restauration de controle dans une base jetable `verif_sauvegarde`** — une sauvegarde qu'on n'a jamais restauree n'est pas une sauvegarde, et celle-ci l'a prouve (voir les trois pieges ci-dessous). `carreaux_filosofi` et `couverture_rayon_risque` sont exclues : deux scripts les reconstruisent, les inclure ferait 4 Go de donnee regenerable. ⚠ La sauvegarde atterrit sur le MEME disque que la base : elle protege d'une erreur logicielle, pas d'une panne materielle |
| **`11-reconstruire.sh`** (`npm run reconstruire`) | **Rejoue, DANS L'ORDRE, tout ce qu'une sauvegarde ne porte pas** : droits des roles, carreaux INSEE, `carreau_risque_distance`, `carreau_risque_nature`, `unite_population_totale`, `couverture_rayon_risque` — puis sauvegarde ce qu'il vient de construire. Chaque etape est SAUTEE si la table est deja pleine, donc rejouable sans risque. Ecrit le 2026-09-22 parce que cet ordre n'existait nulle part et a du etre reconstitue PENDANT la panne, au prix de deux erreurs. ⚠ Il appelle `construire_couverture_rayon.mjs --tout` quand la table est vide : le journal de bandes ment apres restauration (voir le 2e defaut plus bas) |
| **`12-sante.sh`** (`npm run sante`) | **Dit QUELLE couche est en panne** quand l'application repond « Failed to fetch » — un message qui ne distingue pas un moteur Docker eteint d'un volume efface, d'un Postgres en demarrage ou de GRANTs manquants. Teste chaque etage PAR LE CHEMIN DE L'APPLICATION, PostgREST compris et pas seulement `psql` (superuser sur sa base, donc aveugle aux droits manquants), puis les effectifs des tables qui ne se regenerent pas, puis l'age des sauvegardes. Chaque defaut rend la commande qui repare |
| `dev-sur-prod.sh` | lance `npm run dev` contre la PRODUCTION en passant les valeurs par l'ENVIRONNEMENT (Next n'ecrase jamais une variable deja posee), sans toucher a `.env.development.local`. **Sortie de secours, pas le geste du quotidien** ⚠ Devenu INERTE avec la coupure du projet heberge (2026-09-19) : il n'y a plus de production a viser |

> ⚠ **Quatre scripts pour une seule tache, et trois sont morts.** Recompte le
> 2026-09-19 : ce tableau annoncait « Sept scripts » pour **onze fichiers**, et
> trois d'entre eux — `06-rapatrier-carreaux.sh`, `07-carreaux-200m.sh`,
> `06-completer-tables-lourdes.sh` — rapatrient tous `carreaux_filosofi` depuis
> la production. `07-carreaux-200m.sh` et `06-completer-tables-lourdes.sh`
> datent du montage du stack (commit `165eaa7`, 2026-09-17) ;
> `06-rapatrier-carreaux.sh` a ete ecrit le 2026-09-18 **sans voir qu'ils
> existaient**, et `07-carreaux-insee.sh` les a tous rendus inutiles le
> lendemain. Ils ne sont pas supprimes ici — `docs/AUDIT_SEVESO_PPRT.md` cite
> encore `07-carreaux-200m.sh` pour expliquer une mesure, et effacer un script
> dont un document explique un resultat rend ce document incomprehensible. A
> trancher en passe de menage : garder `06-completer-tables-lourdes.sh` pour
> `comptages_routiers`, retirer les deux autres.

> ⚠ **Cinq fichiers manquaient a ce tableau, dont la sauvegarde.** Constate le
> 2026-09-22 : `08-rapatrier-radio.sh`, `09-rapatrier-tmja-reel.sh`,
> `10-sauvegarder.sh` et les deux moteurs `.mjs` ont ete ecrits les 19 et 20
> septembre sans que ce document les enregistre — alors meme que la regle
> « documentation a jour DANS le commit » de `CLAUDE.md` existe pour cela.
>
> Ce n'est pas qu'une lacune d'inventaire. Depuis l'abandon du projet Supabase
> heberge, **le volume Docker est la seule copie des donnees** : un document
> d'architecture qui ne nomme aucun script de sauvegarde se lit « il n'y en a
> pas », et la conclusion raisonnable — en ecrire un — aurait produit un
> quatrieme doublon, exactement le defaut decrit juste au-dessus.
>
> **Trois pieges de `pg_dump` sur ce stack, tous rencontres le meme jour**, et
> c'est ce qui justifie la restauration de controle plutot qu'un simple dump :
> - **`\restrict` (PostgreSQL 17.6)** ouvre tout dump TEXTE et met psql en mode
>   restreint, ou `\.` — le terminateur de chaque bloc `COPY` — est lui aussi
>   bloque. Les lignes de donnees passent alors pour du SQL : **568 197
>   « syntax error »** a la restauration. D'ou le format BINAIRE (`-Fc`), que
>   `pg_restore` lit sans aucune meta-commande psql.
> - **`OWNER TO` / `SET ROLE`** : le `postgres` du conteneur Supabase n'est pas
>   superuser (« must be able to SET ROLE "supabase_auth_admin" »). D'ou
>   `--no-owner --no-acl`, la meme cause que les 24 `ALTER DEFAULT PRIVILEGES`
>   neutralises au restore du dump de prod.
> - **Le schema `extensions`** : convention Supabase, `pgcrypto` et `uuid-ossp`
>   y vivent et des colonnes en dependent. Sans lui, `poi_france` et
>   `panneaux_affichage` ne se creent pas — en silence, au milieu de 58 autres
>   lignes.

### Reprise du 2026-09-22 — le volume Docker efface, et ce qu'on en a appris

Docker Desktop s'est retrouve **vide** : zero image, zero conteneur, **zero
volume** (`docker volume ls` sans une ligne), alors que le moteur repondait
normalement. Cause non etablie — le meme poste avait perdu `git` la veille
(reinstalle en portable). Le stack local etant le SEUL environnement du projet
depuis la coupure du 2026-09-19, c'etait la base entiere. Cote application, le
symptome etait « Failed to fetch » sur chaque appel, avec un `npm run dev`
parfaitement vivant sur le port 3000 : rien n'ecoutait plus sur 54321.

**Tout ce qui a permis la reprise etait HORS de Docker** — c'est la seule chose
a retenir de cet incident :

| | Etat au 2026-09-22 |
|---|---|
| `_sauvegarde_locale/local-2026-09-19.dump` | 355 Mo, produit par `10-sauvegarder.sh` — **c'est lui qui a tout sauve** |
| `_dump_prod/` (17/09) | encore la, mais deux jours plus vieux |
| `_insee_carreaux/` | les 3 CSV, donc aucun telechargement a refaire |
| git | les 223 migrations |

**L'ordre de reprise, mesure ce jour-la** (~2 h, dont ~1 h 45 de calcul sans
surveillance) :

1. `01-supabase-up.sh` — retelechargement des images, puis 8 conteneurs.
2. `drop schema public cascade` + recreation des extensions **avant** tout
   restore : PostGIS habite `public`, sans lui aucune colonne `geometry` ne se
   cree. ⚠ **`auth` ne se drope PAS** : il appartient a `supabase_admin` et le
   `postgres` du conteneur n'est pas superuser (« must be owner of schema
   auth ») — meme famille que les `OWNER TO` du restore de prod. On y injecte
   les COMPTES seuls, `--data-only --table=users --table=identities`, et
   **`users` AVANT `identities`** : l'ordre inverse viole la cle etrangere.
3. `pg_restore --schema=public` : **0 erreur**, 102 tables, 985 fonctions,
   143 policies — le compte exact d'avant.
4. Rejeu des migrations **sql/203 a 223**, les 21 posterieures a la sauvegarde.
5. `07-carreaux-insee.sh`, puis les pre-calculs du module risque.

**Ce que la sauvegarde ne portait pas, et c'est par construction** : tout ce qui
a ete calcule APRES le 19/09 10h45 — `carreau_risque_distance` (883 451 lignes,
batie le 19 au soir), `carreau_risque_nature` (1 446 552, le 20),
`unite_population_totale`, `couverture_rayon_risque`, `zones_risque_cache`, plus
`carreaux_filosofi` volontairement exclu. Aucune de ces tables n'est dans git :
ce sont des heures de calcul geometrique, pas du code. **Une sauvegarde
quotidienne ne suffit pas a un projet dont la valeur est dans des pre-calculs :
il faut soit la prendre apres chaque construction lourde, soit accepter de les
rejouer — et savoir dans quel ORDRE**, d'ou la liste ci-dessus.

> ⚠ **Le defaut qui a failli faire conclure a une sauvegarde inutilisable.**
> `10-sauvegarder.sh` dumpait avec `--no-acl`, pose par symetrie avec
> `--no-owner`. Une sauvegarde sans ACL ne porte **aucun `GRANT`** : apres
> restauration, `anon`, `authenticated` et `service_role` n'avaient plus le
> moindre droit sur les 102 tables, et PostgREST repondait **401 sur tout** —
> un code qui envoie chercher du cote des cles JWT, alors que le corps disait
> `42501 permission denied for table profiles`. Les cles etaient bonnes.
>
> **La verification integree ne pouvait pas l'attraper** : elle restaure dans
> une base jetable et COMPTE DES LIGNES, or les lignes etaient toutes la. Un
> dump sans droits se restaure parfaitement et ne sert a rien. Elle interrogeait
> de surcroit la base en `psql -U postgres`, superuser sur sa propre base :
> **ce chemin ne verra jamais un droit manquant.** Corrige le meme jour —
> `--no-acl` retire du dump ET de la restauration de controle, et une assertion
> `has_table_privilege` sur 3 roles x 3 tables temoins, qui fait echouer le
> script. Meme lecon que `05-verifier.sh` (« c'est PostgREST que l'app appelle,
> pas psql »), qui etait deja ecrite ailleurs dans ce depot.

> ⚠ **Le second defaut, et le plus vicieux : une sauvegarde qui MENT au script
> de reconstruction.** `couverture_rayon_risque` est exclue du dump parce
> qu'elle se regenere — mais son JOURNAL DE BANDES,
> `couverture_rayon_bandes`, est une petite table qui, elle, etait sauvegardee
> normalement. Apres restauration le journal annoncait **122 bandes deja
> construites** pour une table a **ZERO ligne**, et
> `construire_couverture_rayon.mjs` repondait « ✓ 0 bande construite en 1 s »
> avant de rendre la main, satisfait. L'ecran, lui, affichait toujours « la
> couverture par rayon n'a pas encore ete construite » — deux composants du
> meme projet en desaccord, chacun sur d'avoir raison.
>
> **Regle : une table regenerable et son journal de progression forment un
> COUPLE. On les exclut tous les deux, ou aucun des deux.** Corrige le
> 2026-09-22 (`--exclude-table-data=public.couverture_rayon_bandes`). Sortie de
> secours si le cas se represente : `--tout`, qui purge le journal avant de
> reconstruire. `carreaux_filosofi` n'a pas ce defaut —
> `07-carreaux-insee.sh` vide et recharge sans consulter de journal.

- **WSL2 et surtout PAS Hyper-V.** Hyper-V **pre-alloue** toute la RAM de la
  VM : sur ce poste (15,5 Go dont ~10 pris par Chrome, Teams, le nouvel Outlook
  et les agents corporate), le demarrage echouait en `0x800705AA`
  « ressources systeme insuffisantes » — a 6 Go, puis 4, 3, 2 et **jusqu'a
  768 Mo**, meme en memoire dynamique. Baisser l'allocation ne resout rien, et
  Docker Desktop reste affiche « starting » sans jamais donner la raison.
  Le developpeur a besoin de son navigateur POUR tester l'app : lui demander de
  fermer Chrome n'est pas une solution.
  Sortie retenue le 2026-09-17 : **WSL2** (`wsl.2.7.14.0.x64.msi`, MSI Microsoft
  signe, installe sans redemarrage — les fonctionnalites Windows
  `Microsoft-Windows-Subsystem-Linux` et `VirtualMachinePlatform` etaient DEJA
  activees). WSL2 n'alloue pas son plafond d'avance : il grandit a la demande et
  `autoMemoryReclaim=gradual` rend la memoire a Windows quand la base est au
  repos. Plafond declare dans `~/.wslconfig` : 3 Go, 4 vCPU, swap 4 Go.
  `00-docker-up.sh` alerte si le backend Hyper-V est reactive — sur ce poste ce
  n'est pas un detail de configuration, c'est la panne elle-meme.
- **Perimetre du DUMP** (~1,5 Go des 6,8 Go de prod) : sont EXCLUS
  `carreaux_filosofi` (4 630 Mo) et `comptages_routiers` (701 Mo, dont 99,7 % de
  proxy OSM et non du TMJA mesure). IRIS, POI, campagnes DSP, radio et
  referentiels sont copies en entier.
  ⚠ **Exclu du dump ne veut plus dire absent de la base.** `carreaux_filosofi`
  se charge depuis l'INSEE par `07-carreaux-insee.sh` et le local en porte alors
  2 324 577, soit plus que la prod. La justification d'origine de l'exclusion —
  « ne sert que les tuiles z>=12, les paliers 1/2/5/20 km restent » — etait vraie
  pour la CARTE et fausse pour tout calcul de POPULATION, qui passe par ces
  carreaux et rendait des totaux trop bas sans le signaler.
- **Le stack local est PLUS SEVERE que la production sur deux delais, et les
  deux symptomes mentent.** Mesure le 2026-09-18, en essayant d'y faire tourner
  un pre-calcul :
  - le role `authenticator` (par lequel PostgREST ouvre ses connexions) porte
    `statement_timeout=8s`, et `service_role` n'en declare aucun — il herite
    donc des 8 s, contre **2 min** en production ;
  - **Kong, la passerelle HTTP, coupe a 60 s**. Le message est
    « The upstream server is timing out » et il ne vient PAS de Postgres :
    desserrer `statement_timeout` cote base n'y change rien, la requete tourne
    toujours mais plus personne n'attend sa reponse.

  `03-restore-local.sh` porte `service_role` a 30 min (LOCAL uniquement — les
  2 min de la prod sont un garde-fou du budget d'I/O, jamais une gene). Pour
  Kong il n'y a rien a regler : **un outil de CONSTRUCTION n'emprunte pas la
  passerelle de l'application**. `scripts/construire_couverture_rayon.mjs`
  parle a Postgres par `psql` dans le conteneur quand il vise le local, et ne
  garde le chemin HTTPS que pour `--prod`. Mesure : une bande a tenu **243 s**
  la ou Kong coupait a 60.

- **Le planificateur local se croyait sur un disque a plateaux sans cache**, et
  c'est le reglage le plus rentable du lot. Mesure du 2026-09-18 :
  `effective_cache_size` valait **128 Mo**, soit EXACTEMENT `shared_buffers` —
  le planificateur en deduit qu'aucun cache systeme n'existe et prefere le
  balayage sequentiel a l'index sur a peu pres tout. La production annonce
  768 Mo. Et `random_page_cost` valait 4.0, le defaut d'un disque mecanique,
  alors que le volume Docker est sur SSD.

  Effet mesure sur le pre-calcul de couverture, a densite comparable : la
  bande 40 a pris **243 s** avant, la bande 80 — region parisienne, **deux fois
  plus de lignes produites** — en a pris **23** apres. Les 80 bandes restantes
  sont passees en 793 s au total, la ou les premieres tournaient en minutes.
  14 Go de fichiers temporaires avaient ete ecrits avant le correctif.

  `effective_cache_size` n'ALLOUE rien : c'est une estimation, pas une
  reservation. Les deux sont poses **sur le role** (`alter role postgres set`)
  et non par `ALTER SYSTEM` : le `postgres` du conteneur Supabase n'est pas
  superuser et se voit repondre « permission denied to set parameter ».
  `03-restore-local.sh` les repose apres chaque restauration.

- **Kong et PostgREST se disputent les connexions persistantes, et le symptome
  ment.** Diagnostique le 2026-09-19, journaux de Kong a l'appui :

      recv() failed (104: Connection reset by peer) while reading response
      header from upstream, request: "POST /rest/v1/rpc/lire_couverture_rayon"
      "POST /rest/v1/rpc/lire_couverture_rayon HTTP/1.1" 502 75

  PostgREST ferme une connexion au moment precis ou Kong la reutilise. Kong
  traduit la coupure en **502**, et supabase-js la rend comme « An invalid
  response was received from the upstream server » — un message qui ne nomme ni
  Kong, ni les connexions persistantes, ni la course. **Aucune erreur
  n'apparait dans les journaux de PostgREST** : seuls ceux de Kong la portent.

  Effet observe : un test d'integration DIFFERENT echouait a chaque execution,
  ce qui se lisait comme une regression du test concerne. Mesure : 36/36 puis
  4 echecs sur la passe suivante, sans qu'une ligne de code ait bouge.

  Corrige dans le HARNAIS de test (`tests/integration/_client.ts`), jamais dans
  `lib/` : c'est une particularite du stack local, la production Supabase regle
  ses delais de connexion persistante. La reprise ne vaut que pour les LECTURES
  (idempotentes), ne se declenche que sur 502/503, et n'a lieu qu'UNE fois —
  deux coupures d'affilee ne sont plus une course mais une panne, et on veut la
  voir. Verifie : 5 executions consecutives a 36/36.

- **`[db.migrations]` et `[db.seed]` sont passes a `false`** dans
  `supabase/config.toml` : le schema local vient du dump, pas des 43 fichiers
  de `supabase/migrations/`, qui n'ont jamais ete l'historique reel du projet
  (les migrations vivantes sont les ~150 fichiers de `sql/`, appliques par le
  MCP Supabase). Corollaire : `supabase db push` ne pousse plus rien tant que
  ces deux options sont a `false`.
- **La CSP devait etre ouverte, et c'est le piege le plus trompeur du lot.**
  `next.config.js` fixe `connect-src 'self' https://*.supabase.co …` : l'origine
  locale `http://127.0.0.1:54321` n'y correspond pas, donc **le navigateur
  refuse la requete AVANT de l'emettre**. Le symptome ment completement — la
  connexion echoue sans qu'aucune trace n'arrive dans les journaux de GoTrue, ce
  qui se lit comme un mot de passe refuse alors que rien n'est parti. Seule la
  console du navigateur le dit (« violates the following Content Security Policy
  directive »). Corrige par `originesSupabaseLocal`, ajoute a `connect-src`
  **uniquement quand `NODE_ENV !== 'production'`** : verifie par appel direct a
  `headers()` dans les deux modes — en prod, aucune origine en http ni en
  boucle locale n'apparait.
- **`.env.development.local` n'est lu qu'en dev.** Next.js le charge avant
  `.env.local` pour `npm run dev` uniquement : `npm run build` et `npm test`
  continuent de parler a la PROD. Renommer ou supprimer ce fichier fait
  repasser le dev sur la prod, sans toucher aux cles reelles.
- **`[realtime]`, `[storage]` et `[analytics]` sont a `false`** : verifie par
  grep sur `app/`, `lib/` et `components/`, l'app n'ouvre aucun `.channel(` et
  n'appelle jamais `.storage.from(` (les PMTiles IRIS passent par GitHub
  Releases) ; logflare/vector ne servent qu'a explorer les logs du stack, et le
  conteneur `vector` bouclait en redemarrage. Cinq conteneurs de moins
  (realtime, storage-api, imgproxy, analytics, vector) la ou la RAM est le
  facteur limitant. Reste 8 conteneurs, **575 Mo mesures** au total.
- **Parite avec la prod verifiee, pas supposee** : local PostgreSQL **17.6** vs
  17.6.1 en prod, et PostGIS **3.3.7 disponible dans l'image** = exactement la
  version de prod, plus `http` 1.6, `pg_trgm` 1.6, `unaccent`, `pgcrypto`,
  `uuid-ossp`, `pg_stat_statements` — les neuf extensions de la prod.
- **Chemin reseau du dump : le pooler, jamais la connexion directe.**
  `db.vkkdbygwbrxyogqosten.supabase.co` n'a qu'un enregistrement **AAAA**
  (IPv6) et n'est pas joignable depuis ce poste (l'IPv4 directe est une option
  payante). Le pooler repond en IPv4, et des deux hotes de la region **seul
  `aws-1-eu-west-3.pooler.supabase.com` sert ce projet** : `aws-0` repond
  « tenant/user not found », `aws-1` « password authentication failed » — c'est
  ainsi qu'il a ete identifie sans connaitre le mot de passe. **Port 5432
  obligatoire** (mode session) : en 6543, mode transaction, `pg_dump` ne
  fonctionne pas. Le drapeau `--linked` est ecarte : le CLI 2.109 ne relit pas
  `supabase/.temp/linked-project.json` et repond « Cannot find project ref »
  alors que le projet EST lie.
- **`.env.local` portait un BOM UTF-8** : le CLI Supabase refusait de demarrer
  (`failed to parse environment file: unexpected character '»' in variable
  name`) la ou Next.js le tolerait sans rien dire. Retire le 2026-09-17 — si le
  fichier est reecrit un jour par un editeur Windows, le symptome reviendra.
- **UN SEUL fichier de dump pour `public`, schema ET donnees — c'est
  structurel, ne pas re-separer.** Un dump `--data-only` emet les `COPY` dans
  l'ordre ALPHABETIQUE des tables avec les contraintes ACTIVES :
  `activation_cibles` se charge avant `activation_lots` qu'elle reference, et
  le restore casse. Un dump complet ordonne pre-data (tables) -> data -> 
  post-data (contraintes, index, policies, triggers) : aucune cle etrangere
  n'est verifiee pendant le chargement, et les index sont batis apres, donc
  bien plus vite. Corollaire : l'auto-reference `radios.parent_radio_id`, que
  pg_dump signale comme circulaire, ne demande aucun traitement particulier.
- **Les comptes `auth` se chargent AVANT `public`** : mesure en base,
  **18 contraintes** de `public` pointent vers `auth.users` (`created_by`,
  `user_id`, `profiles.id`…). Effet secondaire utile : les empreintes bcrypt
  venant de la prod, **le mot de passe de prod ouvre la session en local**.
- **Deux enonces neutralises a la volee** (sur une copie, le dump reste
  intact) : `CREATE SCHEMA public` — le schema existe deja en local et c'est
  lui qui porte PostGIS, qu'on ne peut pas emporter — et les 24
  `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin`, que le `postgres` du
  conteneur Supabase (**non superuser**) ne peut pas poser pour un autre role.
  Sans consequence : elles ne regissent que des objets crees plus tard.
- **`pg_dump` du CONTENEUR, pas le CLI Supabase** : `supabase db dump` emet un
  `SET ROLE "postgres"` qu'un role restreint ne peut pas executer. Appeler
  `pg_dump` directement l'evite, n'exige aucun Postgres installe sous Windows,
  et permet de passer le mot de passe par `PGPASSWORD` plutot que dans une URI
  (plus de percent-encoding a gerer).
- **Piege Windows dans les scripts** : Git Bash (MSYS) traduit tout argument
  ressemblant a un chemin Unix absolu. `psql -f /tmp/restore.sql` arrivait dans
  le conteneur en `C:/Users/.../Temp/restore.sql`. `MSYS_NO_PATHCONV=1` est
  donc pose sur ce qui s'execute DANS le conteneur — et surtout PAS sur le
  `docker cp`, dont la source est un vrai chemin Windows.
- ⚠ **Ce releve date du 2026-09-17 et n'a PAS ete refait le 2026-09-22** : le
  conteneur n'etait pas demarre, et un nombre de tables recopie d'une passe
  precedente vaudrait moins que l'aveu. Il a certainement bouge — la
  numerotation de `sql/` est montee jusqu'a **223** depuis (198 fichiers
  numerotes presents), et les chantiers risque et jeux de zones y ajoutent
  tables ET fonctions. Le remesurer demande le stack
  monte (`00-docker-up.sh` puis `01-supabase-up.sh`), pas une lecture de code.
- **Resultat mesure le 2026-09-17** : 94 tables, **192 RPC applicatives**,
  143 policies (le compte exact de la prod), 334 index. Volumes locaux : `iris`
  209 Mo, `poi_france` 206 Mo, `carreaux_1km` 142 Mo, `dsp_campaign_data`
  133 Mo. Effectifs compares un a un a la prod sur dix tables a RLS
  (`iris` 49 448, `poi_france` 290 877, `dsp_campaign_data` 477 879,
  `campaign_cp_rollup` 10 205, `emetteur_radio_stations` 569 698, `profiles`,
  `organizations`, `custom_geo_zones`, `panneaux_affichage`,
  `bidding_strategies`) : **identiques**. PostgREST sert les tables (HTTP 200)
  et les RPC PostGIS repondent. **Parcours navigateur valide de bout en bout**
  (Playwright, compte `admin@geoprompt.com`) : `POST /auth/v1/token` 200,
  `/rest/v1/profiles` 200, `/api/user/organizations` 200,
  `/api/digital/campaigns` 200, `/api/campaigns/[id]/alignement` 200 et
  `/api/campaigns/[id]/alignement/maille/map` 200 — donc la RPC geometrique la
  plus lourde tourne sur les donnees locales. Seule erreur restante : un glyphe
  404 chez OpenFreeMap (`Open Sans Bold`), amont et present aussi en prod.
- Le mot de passe Postgres de prod n'est dans aucun fichier suivi :
  `02-dump-prod.sh` le lit dans `SUPABASE_DB_PASSWORD` (`.env.local`, gitignore)
  ou dans l'environnement.

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
# ⚠ La generation des types visait le projet HEBERGE, SUPPRIME le 2026-09-21 :
#    `--project-id vkkdbygwbrxyogqosten` rend desormais une erreur d'authentification.
#    Le schema de reference est le stack LOCAL.
npx supabase gen types typescript --local > types/database.types.ts
```

---

*MAGELIAN — Geospatial intelligence*
