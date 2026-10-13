# ARCHITECTURE — dentsu.explore (ex-MAGELIAN)

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
> `/strategies/[id]/export`, `/strategies/drafts` + `/drafts/[id]`.
> `/api/bidding/train` (appele par `lib/agent/autonomy.ts`) est retire le
> 2026-10-12 avec l'agent et Modal ; `/strategies/[id]/final-report` et son
> composant `FinalReport` (bilan Gemini) le meme jour, au lot 3.
> Les tables `bidding_daily_state`, `bidding_simulations` et `bidding_curve_history`
> n'ont plus d'ecrivain applicatif — a trancher en seconde passe.
> `bidding_zone_configs` reste utile (lue par `refresh_campaign_rollups`).

---

> **Agent d'encheres, ML Modal et historique de chat : RETIRES le 2026-10-12**
> (chantier « suppression de toute l'IA », lot 2 ; AIDA, le shell dentsu,
> devient l'IA). Partis du code : `app/_components/agent/**` (le panneau
> `AgentPanel` et son declencheur, montes dans `app/layout.tsx`), `lib/agent/**`,
> `lib/prompting/**`, `/api/agent/{chat,analyze-drift,apply-recommendation}`,
> `/api/bidding/train`, `lib/bidding-ml/client.ts` (seul client de `*.modal.run`),
> les crons Inngest `agentAutoPilotDaily` et `agentChatPurgeWeekly`, et le
> service Python `modal/bidding_ml/` avec ses variables `MODAL_*`. Plus aucun
> appel vers Modal.
>
> Pourquoi Modal pouvait partir sans perte (audit du 2026-09-22) : il n'avait
> jamais ete branchable. `dsp_campaign_data.metrics` etait vide sur 477 879
> lignes, donc son reward se reduisait a `- spend/12,5` ; `adaptive_model_state`
> comptait 0 ligne (aucun modele entraine) ; et son mode `auto` aurait ecrase le
> plan des jeux de zones (meme table `bidding_zone_configs`, meme cle). Les
> encheres par code postal restent produites par le GENERATEUR LOCAL
> (`genererPlanCp`, `lib/zones/plan.ts`).
>
> En base, seule la table `agent_chat_messages` et sa purge
> `purge_old_agent_chat_messages()` sont supprimees (sql/250, en local). Les
> autres tables de l'agent (`agent_autonomy_settings`, `agent_recommendations`,
> `adaptive_model_state`, `bidding_agent_actions`, `bidding_drift_events`,
> `bidding_algorithms`) RESTENT, sans ecrivain applicatif : leur sort est remis
> au proprietaire. `/api/bidding/strategies` ne lit ni n'ecrit plus
> `agent_autonomy_settings` (le champ `agent_autonomy_override` disparait de la
> creation et de la lecture). Au lot 3, la lecture ne rend plus non plus
> `active_model` : `adaptive_model_state` (le modele entraine par Modal, 0 ligne)
> n'est plus lue par l'application ; aucun ecran ne lisait ce champ. La table
> reste en base et `scripts/benchmarking/` peut encore l'ecrire.

---

> **Bilans et analyses Gemini/Mistral hors carte : RETIRES le 2026-10-12**
> (chantier « suppression de toute l'IA », lot 3). Partis du code :
> - le bilan executif de fin de campagne : `/api/bidding/strategies/[id]/final-report`,
>   `components/campaign/FinalReport.tsx` (monte par `suivi-v2/DetailTechnique`,
>   qui ne lit donc plus `GET /api/bidding/strategies`), et ses calculs
>   `lib/bidding-ml/{comparison,targeting-kpis}.ts`. `metric-labels.ts` est
>   garde et deplace dans `lib/bidding/` ; le dossier `lib/bidding-ml/` n'existe
>   plus. `get_strategy_comparison_data` n'a plus d'appelant (defaut C de
>   `docs/SUITE_TRONCATURE_POSTGREST.md` clos par retrait) ;
> - le diagnostic geo de l'analyse digitale : `/api/digital/[campaignId]/ai-analysis`
>   et `AiAnalysisBlock.tsx`, retires d'`AnalysisPanel` (V1) et d'`AnalyseV2`,
>   dont l'onglet « IA » devient « Score qualite » (le score, calcule
>   localement, reste) ;
> - l'analyse d'un modele de clustering : `/api/poi-clusters/models/[version]/{analysis,generate-analysis}`,
>   le bloc « Analyser » de `components/ClusterDetails.tsx`, le type
>   `lib/clustering/types.ts` (`GeminiAnalysis`, seul contenu du fichier), et
>   dans `scripts/clustering_poi_filosofi.py` la phase 11, le mode
>   `generate-analysis` et les options `--no-analysis` / `--model-version`. Le
>   k-means est inchange ;
> - le resume Mistral d'une source : `/api/admin/sources/[id]/summary`, son
>   bouton, son bloc et l'apercu en liste de `/admin/sources`.
>
> En base, rien n'est supprime : la colonne `clustering_models.analysis`, la
> colonne `ai_summary` des sources et la RPC `get_strategy_comparison_data`
> restent, sans ecrivain ni lecteur applicatif ; leur sort est remis au
> proprietaire.

## Stack technique

| Couche | Technologie | Version |
|--------|-------------|---------|
| Framework web | Next.js (App Router) | 15.5.25 |
| Runtime UI | React | ^19.0 |
| Langage | TypeScript (strict) | ^5.3 |
| Base de donnees | Supabase (PostgreSQL **17.6** + **PostGIS 3.3.7**) — les docs annoncaient 15 jusqu'au 2026-09-13, soit deux versions majeures d'ecart. **L'environnement de reference est le stack LOCAL depuis le 2026-09-19** (conteneurs Docker, § « Environnement de developpement local ») ; le projet heberge portait un compute **Micro** et non Nano (shared_buffers 256 Mo, effective_cache_size 768 Mo, soit ~1 Go de RAM), et ses contraintes d'I/O restent la regle de codage. Neuf extensions actives, mesurees le 2026-09-19 : `postgis`, `http` 1.6, `pg_net`, `pg_trgm`, `pgcrypto`, `unaccent`, `uuid-ossp`, `pg_stat_statements`, `supabase_vault`. Acces applicatif par `@supabase/supabase-js` + `@supabase/ssr` (^0.5.2) | ^2.97 |
| Cartographie | MapLibre GL JS | ^5.18 |
| Tuiles vectorielles | MVT servies par PostGIS (`ST_AsMVT`) — **pour TOUT**, carreaux compris. Le paquet `pmtiles` (4.4.0) reste declare dans `package.json` mais **plus rien ne l'importe** : `npm run catalogue` le liste en dependance jamais importee, le protocole n'est plus enregistre (`app/map/_hooks/useMapInit.ts:136`) et aucune couche PMTiles ne subsiste. Ce document annoncait « PMTiles conserve pour les carreaux uniquement » jusqu'au 2026-09-16 : c'etait faux, les carreaux passent par `/api/tiles/[z]/[x]/[y]` (documente comme tel plus bas). Le desinstaller est un geste sans risque, laisse a une passe de nettoyage | — |
| Fonds de carte | OpenFreeMap (Liberty / Positron / Bright) + MAGELIAN dark style | — |
| Isochrones | OpenRouteService (ORS) REST API | — |
| Risques industriels | **Georisques** (ministere de la Transition ecologique) — `api/v1/installations_classees`, **sans jeton**. 138 423 installations classees. Aussi `api/v1/gaspar/pprt` : **415 procedures PPRT**, sans geometrie | — |
| Perimetres PPRT (polygones) | **Geoplateforme IGN** — WFS `wfs_sup:assiette_sup_s`, filtre `suptype='pm3'` (servitude d'utilite publique PM3 = PPRT), alimente par le Geoportail de l'Urbanisme. **664 polygones**, GeoJSON, `CQL_FILTER` honore, `numberMatched` exact. Voir « Perimetres PPRT » plus bas pour la comparaison mesuree avec le WFS Georisques, qui ne convient PAS | — |
| Meteo | Open-Meteo API (temperature, precipitation, ensoleillement) | — |
| Scripts Python hors ligne | 24 fichiers dans `scripts/` — `modal/` retire le 2026-10-12 (imports INSEE/OSM/GTFS/TMJA, clustering POI x Filosofi, rescoring) : `supabase`, `requests`, `pandas`, `numpy`, `scikit-learn`, `pyproj`, `matplotlib`, `dotenv`. **Aucun runtime Python sur Vercel** — d'ou le 503 explicite de `/api/poi-clusters/run` quand le script est absent | — |
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
| Interface Angular (migration en cours) | **Angular 21.2.4** épinglé (standalone, zoneless, signals), Tailwind 4, Vitest, `@supabase/ssr` — dossier `angular/`, application séparée servie sur `:4200` et reliée à l'API Next.js par le proxy de dev. Aucun import croisé avec le code React (`tests/unit/angular/isolement.test.ts`). Feuille de route : `docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md` | 21.2.4 |

---

## Arborescence

```
genesis_app/
├── angular/                    # Application Angular (migration progressive, lot par lot)
│   ├── proxy.conf.json         # /api -> localhost:3000 (même origine : les cookies suivent)
│   ├── scripts/ecrire-config.mjs # public/config.local.json depuis .env.development.local (ignoré par git)
│   ├── federation.config.js    # Native Federation : name 'magelian', exposes './Routes' (lot AIDA)
│   ├── .npmrc                  # registre @gdo-rd-france (jeton NPM_GITHUB_TOKEN) + legacy-peer-deps
│   ├── src/environments/       # environment.ts : slug AIDA (vide tant que le siège ne l'a pas fourni)
│   └── src/app/
│       ├── core/               # config, auth (@supabase/ssr), http (HttpBaseService, intercepteurs),
│       │                       # demarrage (DemarrageService, demarrageGuard), ressources (urlRessourceDistante,
│       │                       # chargerFeuille, feuille construite + coutures LIRE/CONSTRUIRE/ADOPTER_FEUILLE),
│       │                       # theme (ThemeService, CouleursService), etat (versEtat),
│       │                       # chargement (ChargementService)
│       ├── layout/             # coquille (AppSidebar + TopRightChrome + MainPadding portés, lot Rendu R3) :
│       │                       # mg-barre-laterale, mg-chrome-haut (mg-bascule-theme, mg-badge-session),
│       │                       # navigation.ts, fermeture.ts ; RacineDistanteComponent (racine de remoteRoutes,
│       │                       # racine d'ombre) + racine-ombre.ts (monterRacineOmbre)
│       ├── ui/                 # composants de base génériques (lot 1)
│       ├── carte/              # mg-carte (MapLibre), chargerParCadre, lierCameras, contenuPopup (lot 2)
│       ├── graphiques/         # mg-courbe (ECharts, import modulaire) (lot 2)
│       └── features/           # un dossier par module migré
├── app/                        # Next.js App Router — pages et routes API
│   ├── api/                    # Routes API (voir section dediee)
│   ├── admin/                  # Pages d'administration back-office
│   │   ├── campaigns/          # Campagnes DSP — liste, import, detail
│   │   ├── carreaux-import/    # Import des carreaux Filosofi (SHP/Parquet)
│   │   ├── health/             # Monitoring : etat DB, tables, fonctions RPC
│   │   ├── import/             # Import universel de POI (CSV/XLSX/GeoJSON)
│   │   ├── imports/            # Historique et gestion des imports
│   │   ├── ooh-import/         # Import panneaux OOH depuis ArcGIS REST
│   │   ├── profiles/           # Gestion des profils utilisateurs
│   │   ├── radio/              # Admin emetteurs radio FM/DAB+
│   │   └── sources/            # Gestion des sources de donnees (proprietaire et
│   │                           # partages : renvoi vers la page Angular Acces)
│   │   # users/ et organizations/ SUPPRIMES le 2026-10-10 : page Angular « Acces »
│   # copilote/ SUPPRIME le 2026-10-12 (suppression de l'IA, lot 5) : chat IA,
│   # ChatPanel, useChatControls, useToolProcessor... Son moteur de carte etait
│   # deja sorti vers app/map/ au lot 4. L'etat `error` de app/map/page.tsx
│   # (alimente par useMapDirectActions et useVoronoiDirect) s'affiche dans
│   # components/map/BandeauErreur.tsx, au-dessus de la carte, ferme par sa croix
│   # ou efface par la prochaine action (round de correction 1 du lot 5).
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
│   │   │                       # MapPanel.tsx (badges ZONE_ACTIVE / isochrone /
│   │   │                       # Voronoi / bataille, fond compact, tiroir Street
│   │   │                       # View), venu d'app/copilote le 2026-10-12.
│   │   │                       # FilterPanel.tsx (l'ancien monolithe) supprime le
│   │   │                       # 2026-09-12, vide par les taches 2 a 7 — mais
│   │   │                       # ⚠ le repertoire filter-panel/ VIT TOUJOURS
│   │   │                       # (34 fichiers) : ce n'est pas un residu, il porte
│   │   │                       # les outils montes par les panneaux du rail, dont
│   │   │                       # ScoreCompositeTool.tsx, CorrelationTool.tsx et
│   │   │                       # use-analyses.ts ajoutes par la Tache 11-12.
│   │   │                       # Ne pas le supprimer en lisant « FilterPanel
│   │   │                       # supprime » : ce sont deux choses differentes.
│   │   ├── _hooks/             # Moteur de la carte : useMapInit (sources et
│   │   │                       # couches posees au load), useMapLayers (peinture,
│   │   │                       # Voronoi, bataille, carreaux, IRIS),
│   │   │                       # useMapMarkers, useMapDirectActions,
│   │   │                       # useVoronoiDirect... — useMapInit/useMapLayers
│   │   │                       # venus d'app/copilote le 2026-10-12. useSavedMaps
│   │   │                       # SUPPRIME au lot 5 : son seul ecran vivait dans
│   │   │                       # le chat (cartes sauvegardees React abandonnees).
│   │   ├── _lib/               # constants.ts (MAP_STYLES, circleGeoJSON,
│   │   │                       # getCatColor, ISOCHRONE_COLORS), venu
│   │   │                       # d'app/copilote le 2026-10-12.
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
│   │                           # components/campaign/suivi/), BandeauAvancement/
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
│   │                           # (64 segments, `circleGeoJSON` defini dans
│   │                           # app/map/_lib/constants.ts, AUCUNE requete) : l'aplat etant
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
│   # chat/ (copilote IA : providers, prompt systeme, outils) SUPPRIME le 2026-10-12 (lot 5)
│   ├── db/                     # Migrations SQL applicatives
│   ├── digital/                # google-ads-geo-ids.json
│   ├── dsp-mapping/            # loader.ts — mappings de colonnes DSP dynamiques (table dsp_source_mappings)
│   ├── metrics-display/        # loader + formateur dynamique des metriques (dsp_metrics_registry)
│   ├── bidding/                # metric-labels.ts (ex-lib/bidding-ml/, dossier retire le 2026-10-12 avec le ML et le bilan Gemini)
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
│   ├── meteo/                  # aggregation.ts, palettes.ts, types.ts
│   ├── poi/                    # categories.ts
│   ├── radio/                  # anfr-import, arcom-crawler, arcom-ods-parser...
│   # mcp/ (datagouv.ts) et smart-prompt/ (multi-agents Mistral) SUPPRIMES le 2026-10-12 (lot 5)
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
│                               #   client ne le depasse. C'est le MEME plafond que
│                               #   celui des RPC `RETURNS TABLE`/`SETOF` (le « 5 000
│                               #   des RPC » ecrit ici jusqu'au 2026-10-10 etait le
│                               #   reglage du projet heberge supprime). Une table se
│                               #   pagine ; une RPC tabulaire passe en `jsonb`.
│                               #   Mesure : `zone_set_cp` portait
│                               #   1 942 codes postaux, `.select().limit(7000)` en
│                               #   rendait 1 000, et le plan ecrit couvrait donc la
│                               #   moitie du jeu — sans que rien le signale.
│                               #   `lireTout` rend TOUT ou LEVE, jamais un debut
│                               #   ⚠ Chaque page refait la requete ENTIERE (OFFSET) :
│                               #   sain sur une petite table (OOH, radios), ruineux
│                               #   sur un filtre qui parcourt un gros index — le
│                               #   transport passe donc par une RPC jsonb (sql/241)
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
Filtre, Calques, Analyse, Zones, Campagne. Le rail complet expose ces cinq
themes plus Reglages et Aide, soit **sept** entrees. L'Assistant (geo.prompt,
le copilote IA, tiroir droit, `Ctrl+K`) en etait la huitieme jusqu'au
2026-10-12 : il est retire avec toute l'IA du code (lot 5), React et Angular
ensemble, et `Ctrl+K` n'ouvre plus rien. Le type `'tiroir-droit'` est parti
avec lui.

| Entree | Ouvre | Raccourci | Role |
|---|---|---|---|
| Filtre | panneau gauche | `Alt+1` | pose le filtre unique (voir plus bas) |
| Calques | panneau gauche | `Alt+2` | affiche des donnees, ne fabrique rien |
| Analyse | panneau gauche | `Alt+3` | lance un calcul (Voronoi, bataille, clustering, score composite) |
| Zones | panneau gauche | `Alt+4` | seul endroit qui fabrique une geometrie + une liste de CP. **Depuis le 2026-09-20, il liste aussi les JEUX DE ZONES a risque** (`JeuxDeZonesRail.tsx`) : un jeu de zones EST une zone — un perimetre nomme, enregistre, reutilisable — et le chercher dans l'atelier suppose de se rappeler ou il a ete fabrique. Le panneau MONTRE et OUVRE, rien de plus : afficher ou supprimer restent dans l'atelier, avec le contexte (profil, seuil, taux d'utile) qui les rend comprehensibles |
| Campagne | overlay MAGELIAN plein ecran | `Alt+C` | active/pilote une campagne (accent teal, pastille d'alertes) |
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
  6 187 — PostgREST tronquait a 5000 lignes (reglage de l'ancien projet
  heberge ; 1 000 sur le stack local, `db-max-rows`) TOUTE RPC `RETURNS TABLE`, meme
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
un composant qui se re-rend a chaque jeton de streaming (l'Assistant, retire
le 2026-10-12) repousse son entree au sommet en continu et Echap ferme la
mauvaise chose.

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

Trois roles, declares par la contrainte `profiles_role_check` et par
`lib/auth/roles.ts` (`/api/admin/roles`, qui les exposait, est supprimee depuis
le 2026-10-10 avec la page React Users, son seul appelant). Le pouvoir REELLEMENT exerce :

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

⚠️ **Elles ne s'executent jamais POUR L'APPLICATION.** Les routes API qui parlent a Supabase le
font par `createAdminClient()` (cle `service_role`), qui contourne RLS ; aucune
n'instancie de client avec la cle anon. L'autorisation reellement appliquee est
celle du middleware (authentifie ?) plus les guards et le scoping par org
ecrits dans chaque handler.

⛔ **Mais elles sont la SEULE barriere face a un client qui appelle PostgREST
lui-meme.** La cle publique est dans le bundle du navigateur : n'importe quel
compte connecte peut appeler `/rest/v1/<table>` avec son propre jeton. « RLS
dormantes » s'est longtemps lu « RLS sans importance », et c'est faux. Mesure
du 2026-10-08, par PostgREST et un vrai compte client, avant `sql/234` :

- `profiles_update` (`id = auth.uid()`, sans restriction de colonne) : un client
  DRHAT s'est fait **`super_admin` de BMW GROUP**, puis a lu les 177
  concessions — et toutes les routes `/api/admin` lui etaient ouvertes ;
- `USING (true)` sur `isochrones_cache`, `geography_zones` (les 93 zones
  CIRFA) et huit tables `bidding_*` : tout client lisait les donnees de tous ;
- `organizations` lisible en entier : la liste des clients ;
- quatre `SECURITY DEFINER` executables **sans connexion**, dont trois qui
  reconstruisent des tables entieres ;
- `organization_members` : sa politique se lisait elle-meme, toute lecture par
  un client levait « infinite recursion ».

## Cloisonnement entre organisations (2026-10-08)

**Le navigateur lit, il n'ecrit jamais par PostgREST.** `sql/234` retire
`INSERT/UPDATE/DELETE/TRUNCATE` a `anon` et `authenticated` sur toutes les
tables, et pour les tables futures (`alter default privileges`). Recense ce
jour : le seul acces direct du navigateur est la LECTURE de son propre profil
(`lib/auth-client.ts`, `angular/.../auth.service.ts`).

**Plus aucune politique `FOR ALL` pour un client (`sql/238`, 2026-10-09).** Une
politique FOR ALL vaut aussi pour SELECT ; sans droit d'ecriture (sql/234),
elle ne sert plus QU'A LIRE. Douze tables bidding/agent en portaient une ecrite
`USING (get_user_role() in ('super_admin','admin'))` sans filtre d'organisation :
un compte `admin` d'espace lisait les 13 377 lignes de `bidding_zone_configs`,
toutes d'une autre organisation. `sql/238` eclate toute politique FOR ALL non
reservee a `service_role` en INSERT/UPDATE/DELETE (22 politiques, 26 → 4 FOR ALL,
les 4 restantes sont `service_role`) ; supprime les SELECT `*_org_read` de
`agent_chat_messages` (table supprimee le 2026-10-12, sql/250), `agent_recommendations`, `bidding_curve_history` (meme
clause `admin` ET « infinite recursion » 42P17 pour tout compte) ; ramene
`bidding_agent_actions`, `bidding_strategy_drafts`, `agent_autonomy_settings` a
« le mien, ou super_admin ». Les tables bidding se lisent cote serveur
(service_role), comme `bidding_strategies` depuis sql/234. Verrous :
`tests/integration/politiques-for-all.test.ts` (lit `pg_policies` par
`DATABASE_URL`) et le compte `admin` DRHAT de `cloisonnement-rls.test.ts`.

**Appartenance aux espaces, tenue en base (`sql/236`, 2026-10-09).** Deux
colonnes, une regle : `organization_members (user_id, organization_id)` dit a
quels espaces l'utilisateur APPARTIENT (source de verite) ; `profiles.organization_id`
dit dans lequel il TRAVAILLE (l'espace actif, lu par `getOrgSourceIds` et
`get_user_org()`). Invariant : pour un non-super_admin, l'espace actif est un
espace dont il est membre, ou `null` (il ne voit alors que le socle). Constat
du 2026-10-08 : **aucun code n'ecrivait `organization_members`** — « ajouter un
membre » ne posait que `profiles.organization_id`, et les deux comptes clients
avaient un espace actif sans en etre membres (rattrapes par la migration :
8 → 10 lignes). Trois objets :

- declencheur `profiles_espace_actif_membre` (BEFORE INSERT OR UPDATE OF
  `organization_id`, `role` sur `profiles`) : refuse en `23514` un espace actif
  dont un non-super_admin n'est pas membre ; depuis `sql/239` il verrouille la
  ligne d'appartenance (`FOR KEY SHARE`), si bien qu'un retrait concurrent
  ATTEND au lieu de laisser un espace actif sans appartenance ;
- declencheur `organization_members_report_espace_actif` (AFTER DELETE sur
  `organization_members`) : retire de son espace actif, l'utilisateur bascule sur
  son plus ancien autre espace, ou `null` ; un super_admin n'est pas touche ;
- RPC `remplacer_espaces_utilisateur(p_user, p_espaces, p_actif) returns jsonb`
  (`service_role` seul) : ajoute, place l'espace actif, PUIS retire — l'invariant
  n'est jamais viole. Erreurs : `P0002` utilisateur introuvable, `22023` espace
  actif hors de la liste (non-super_admin), `23503` espace inexistant.

Verrou : `tests/integration/appartenance-espaces.test.ts`.

**Un compte neuf nait sans espace (`sql/237`, 2026-10-09).** Le declencheur
`on_auth_user_created` (AFTER INSERT sur `auth.users` → `handle_new_user`)
manquait dans la base locale : pose a la main sur le projet heberge, aucun
fichier `sql/` ne le creait, et le dump du schema auth est en `--data-only`.
Sans lui `POST /api/admin/users` rendait 500 « Utilisateur introuvable ». Et
l'ancienne `handle_new_user` posait GENESIS (Global) comme espace actif SANS
appartenance, ce que sql/236 refuse. Desormais le profil nait `client`,
`organization_id` null, aucune appartenance (`on conflict do nothing`) ; la
route pose l'appartenance puis l'espace actif. Pas d'appartenance automatique
a l'espace interne : tout client cree en aurait vu les donnees. Verrou :
`tests/integration/creation-compte.test.ts`.

### Espaces de travail (2026-10-09, livre) — page « Accès » depuis le 2026-10-10

Une seule page — **Administration › Accès** (interface Angular, `/app/admin/acces` ;
elle s'appelait « Espaces de travail », `/app/admin/espaces`, adresse gardée en
redirection) — LA page unique des droits (comptes, espaces, donnees visibles). Elle remplace les trois pages React `/admin/users`,
`/admin/organizations` et `/admin/organizations/[id]`, **supprimees le 2026-10-10**
(decision de Vincent) avec leur bandeau de renvoi `components/admin/BandeauEspaces.tsx`
et la route `/api/admin/roles` (seul appelant : la page Users). Les ROUTES API
qu'elles appelaient restent : la page Angular les appelle. Cote React, la barre
laterale (`components/AppSidebar.tsx`), le panneau Reglages de la carte
(`components/map/overlays/SettingsOverlay.tsx`) et le tableau de bord portent une
entree « Accès » vers `${NEXT_PUBLIC_URL_ANGULAR}/admin/acces`
(`lib/espaces/lien-page-acces.ts`), ABSENTE si la variable manque ou ne commence pas par `http://` ou `https://` (pas de lien
mort) ; le detail d'une source de `/admin/sources` ne modifie plus ni le
proprietaire ni les partages (ligne « Proprietaire et partages : page Accès »),
l'organisation proprietaire reste affichee en lecture seule. Garde :
`tests/unit/espaces/lien-page-acces.test.ts`. Specification :
`docs/superpowers/specs/2026-10-08-espaces-de-travail-design.md` ; plan :
`docs/superpowers/plans/2026-10-09-espaces-de-travail.md`.

- **Modele a deux colonnes** : `organization_members` = a quels espaces on
  APPARTIENT (source de verite) ; `profiles.organization_id` = dans lequel on
  TRAVAILLE (espace actif). Invariant tenu en base par `sql/236` (voir plus haut :
  declencheurs et RPC `remplacer_espaces_utilisateur`). Un compte neuf nait sans
  espace (`sql/237`). Seul le super_admin administre (D1) ; le role `admin` n'est
  jamais propose.
- **Routes** : `GET /api/admin/espaces`, `…/espaces/socle`, `…/espaces/comptes`,
  `…/espaces/[id]/donnees`, `…/espaces/[id]/membres`, `…/espaces/[id]/apercu`,
  `PUT /api/admin/users/[id]/espaces`,
  plus les routes existantes (organisations, membres, `sources/assign`,
  `PATCH /api/admin/sources/[id]`, utilisateurs) — detail dans le tableau des routes
  admin. Logique serveur : `lib/espaces/` (`appartenance.ts`, `lister-espaces.ts`,
  `lister-comptes.ts`, `nom-espace.ts`, `types.ts`).
- **Ecran** : colonne « Socle dentsu.explore », « Tous les comptes » (2026-10-10 : la
  seule vue qui atteint un compte rattache a aucun espace), puis un espace par ligne ; fiche d'un
  espace a quatre onglets (Membres, Donnees, Apercu, Reglages) et fiche Socle.
  L'apercu APPELLE la regle des routes (`getOrgSourceIds`, `getCategoriesVisibles`)
  sur une session client simulee, il ne la recopie pas. Details composant par
  composant : section Angular « Espaces de travail » (T5 a T10) plus bas.
- **Garde-fous** : l'espace interne (`genesis-global`) ne se supprime pas (409 par
  appel direct, garde sur l'IDENTIFIANT `ID_ORGANISATION_INTERNE` de
  `lib/espaces/nom-espace.ts` et non sur le slug), son slug ne se modifie pas
  (PATCH 409) et il n'a pas d'interrupteur « actif » ; `POST …/members` ignore le
  role quand la cible est deja super_admin.

Ecarts a la specification : voir la section « Ecarts a la livraison » de la spec.

**Trois niveaux de visibilite d'une donnee importee**, portes par
`data_sources.visibilite` :

| Niveau | Qui voit | Exemple |
|---|---|---|
| `socle` | toutes les organisations | lycees, carroyage Filosofi, inventaire Brest Metropole |
| `privee` | l'organisation proprietaire | CONCESSIONS BMW → BMW GROUP, CIRFA → MARINE |
| partage | `privee` + les organisations de `shared_with` | `/api/admin/organizations/[id]/sources/assign` (page Accès, onglet Données) |

Defaut `privee` : une source oubliee reste FERMEE. Un POI **sans source**
(`data_source_id is null`) est un referentiel systeme charge par script (arrets
de transport, installations classees) : socle. D'ou la regle dure : **un
import client n'ecrit jamais un POI sans source** — `import-poi/execute`
s'arrete si la source n'a pas pu etre creee.

**La regle est ecrite deux fois, a garder egales :**

| Ou | Protege | Fichier |
|---|---|---|
| SQL | les acces directs PostgREST | `source_visible()` + politiques de `poi_france`, `panneaux_affichage`, `data_sources` (`sql/234`) |
| TypeScript | les routes (service_role) | `lib/auth/getOrgSourceIds.ts` (QUOI) + `lib/auth/perimetre-donnees.ts` (l'appliquer) |

`getOrgSourceIds` **ferme par defaut** : `null` (« tout voir ») est reserve au
super_admin, et seulement SANS l'option `vueEspace` — c'est-a-dire en
administration ; sur la carte il n'existe plus (paragraphe suivant).
Jusqu'au 2026-10-08 il rendait `null` sans session et pour un
compte sans organisation — toute anomalie ouvrait les donnees de tous.
« Source non supprimee » s'y ecrit `FILTRE_SOURCE_NON_SUPPRIMEE`
(`status.is.null,status.neq.deleted`), le `is distinct from 'deleted'` du SQL :
`.neq('status','deleted')` ecartait aussi un statut NULL (2026-10-09).

**Sur la carte, le super_admin voit comme son espace actif (2026-10-12, spec
`docs/superpowers/specs/2026-10-12-droits-sur-la-carte-design.md` R3/R4).**
`getOrgSourceIds(session, { vueEspace: true })` lui applique la regle d'un
client de son espace actif (socle + sources de l'espace + partages ; socle seul
sans espace actif) et ne rend JAMAIS `null`. Sans l'option, le contrat
d'administration tient : `null` pour le super_admin (`lib/espaces/*`,
`app/api/admin/**`). `sourcesVisiblesDeLaRequete(req)` — point d'entree
de toutes les routes hors `/api/admin` — passe toujours l'option et rend
toujours un tableau ; `/api/map/categories` et `/api/map/pois` (et
`/api/chat` jusqu'a sa suppression le 2026-10-12), qui appellent
`getOrgSourceIds` directement, la passent aussi (verrou :
`tests/unit/auth/perimetre-vue-espace.test.ts`). Consequences : l'empreinte de
cache d'un super_admin sur la carte est celle de son espace (les battles
calculees sous `tout` ne lui sont plus resservies, recalcul une fois, pas de
purge) ; `categorieEntierementVisible` lui refuse, dans l'espace BMW, un
Voronoi sur une categorie contenant des POI de la Marine. `source_visible()`
(SQL) n'est pas modifiee. Preuve de bout en bout (T5, base locale, Angular +
Next du chantier) : super_admin dans BMW GROUP = categories `bmw` (espace) +
`lycee` (commune), 177 concessions affichees (24 en Ile-de-France), 0 CIRFA ;
dans Marine nationale = `cirfa` (espace) + `lycee`, 101 CIRFA, 0 concession ;
dans l'interne = `lycee` seul, 0 et 0, panneaux de Brest (1 434, socle)
proposes ; un compte client de BMW rend exactement les memes chiffres ; une zone
creee dans BMW n'apparait ni dans Marine ni dans l'interne ; la page Acces
(onglet Donnees d'un espace) montre toujours les cinq jeux au super_admin.
Les deux LISTES DE CAMPAGNES lues par la carte suivent la meme regle depuis la
revue finale (2026-10-12) : `/api/digital/campaigns` et la liste de
`/api/custom-geo/media-plan` rendent les campagnes de l'espace actif, super_admin
compris, et rien sans espace actif (verrou :
`tests/unit/auth/campagnes-vue-espace.test.ts`). L'administration des campagnes
passe par `/api/admin/campaigns`, inchangee.

**L'origine d'une categorie (2026-10-12, meme spec, R6).** Chaque categorie
rendue par `/api/map/categories` porte `origine: 'commune' | 'espace'`.
`getSourcesPropresEspace(session)` (`lib/auth/getOrgSourceIds.ts`) liste les
sources PROPRES a l'espace actif : `visibilite = 'privee'`, possedees par lui
ou partagees avec lui, non supprimees, jamais le socle ; `[]` sans espace
actif (meme garde UUID que `SEC-002`) ou sur une lecture en echec. Une
categorie est « espace » si `getCategoriesVisibles(propres)` la contient —
une categorie mixte (socle + espace) est donc « espace » —, « commune »
sinon. Ce n'est PAS une regle d'autorisation : elle ne fait que ranger ce que
`getOrgSourceIds` autorise deja. Cout : une lecture de `data_sources` puis,
s'il y a des sources propres, un second leapfrog sur l'index de
`poi_france.categorie`, en cache par empreinte comme le premier, lu APRES lui
(jamais en parallele).

Outils de `lib/auth/perimetre-donnees.ts` :

- `filtrerParSourcesVisibles(q, sources, { referentiels })` — restreint une
  requete ; `referentiels: true` laisse passer les lignes sans source.
- `empreintePerimetre(sources)` — a mettre dans **toute cle de cache** d'un
  resultat calcule sur des POI (battle, isochrones du chat) : sans elle, la
  battle d'un super_admin sur toutes les concessions etait resservie a la
  Marine. `cleDeCacheDuPerimetre` controle une cle recue du navigateur.
- `categorieEntierementVisible` — pour un calcul SQL sur toute une categorie
  (Voronoi) : refuse si un seul POI appartient a une source invisible.
- `reserverAuSuperAdmin(req)` — session lue par cookie OU en-tete
  (`requireAdmin` ne lit que l'en-tete, et les ecrans de la carte appellent par
  `fetch` nu). Pose sur les 16 handlers de `/api/poi-clusters` : les modeles de
  clustering portent sur les POI de toutes les organisations, aucun filtrage
  ligne a ligne n'est possible.
- `getCategoriesVisibles(sources)` (`lib/poi/categories.ts`) — ce qui est
  montre ou dicte a l'IA. `getDistinctCategories` reste interne : un nom de
  categorie (« bmw ») suffit a reveler qu'un client existe. Resultat mis en
  cache 5 min par `empreintePerimetre(sources)` (200 perimetres au plus, une
  liste partielle n'est jamais cachee, `strict` relit toujours) : sans lui,
  chaque appel de `/api/map/categories` (route publique) ou du chat lisait
  ≈ 35 000 pages (≈ 270 Mo, EXPLAIN BUFFERS du 2026-10-09).
  `invalidateCategoriesCache` vide les deux caches ; `?refresh=1` sur la route
  ne le declenche que pour un appelant connecte (un anonyme pouvait sinon
  forcer la relecture a chaque appel).

**Verrous :** `tests/integration/cloisonnement-rls.test.ts` rejoue 44 attaques
PostgREST avec de vrais comptes MARINE / BMW / DRHAT (dont un `admin` d'espace
DRHAT, sql/238) ;
`tests/unit/securite/perimetre-routes.test.ts` fait echouer la suite si un
fichier de `app/api` (hors `/admin`) ou de `lib/` lit une table de donnees
client sans passer par la regle, ou si un handler clustering perd sa garde.

⚠ **`sql/010_security_hardening.sql` recree des `USING (true)`** : le rejouer
impose de rejouer `sql/234` puis `sql/238` juste apres (`sql/SETUP.md`).

**Ce qui n'est pas fait :** pas de mode « voir comme » pour le super_admin (il
voit tout, il ne peut pas verifier ce que voit un client sans un compte de
test) ; l'identifiant deterministe d'un POI (`lib/import/identite-poi.ts`)
n'inclut pas l'organisation, donc deux clients qui importent le MEME fichier
se percutent : le second voit ses lignes « deja presentes » et ne les recoit
pas. Pas une fuite, une perte.

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

### Chat & Copilote IA — SUPPRIMES le 2026-10-12
`/api/chat` (copilote, streaming LLM + function calling), `/api/smart-prompt`
(multi-agents Mistral) et `/api/providers/status` (disponibilite des modeles)
sont supprimes avec toute l'IA du code (chantier « suppression de toute l'IA »,
lot 5 ; AIDA, le shell dentsu, porte l'IA). Leurs entrees de `middleware.ts`
(fichier protege) sont retirees au lot 6, avec l'accord du proprietaire (« plus rien d'IA
dans le code », 2026-10-12) ; les paquets `ai` et `@ai-sdk/*` sont desinstalles et le
verrou `tests/unit/securite/aucune-ia.test.ts` echoue si un import, une cle
(`GOOGLE_GENERATIVE_AI_API_KEY`, `MISTRAL_API_KEY`, `MODAL_*`) ou un appel vers
Gemini/Mistral reparait dans un fichier suivi. Le seul calcul que seul le chat offrait,
le Voronoi, a sa route directe `GET /api/voronoi` (lot 4).

### Donnees cartographiques
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/map/pois` | POST | POI dans une zone avec filtres categorie. ⚠ **POST et non GET** : la route n'exporte que `POST` (`app/api/map/pois/route.ts:67`) ; ce tableau annoncait GET jusqu'au lot 4, T8 (2026-10-07). `bbox` optionnelle (Tache 4, `[west,south,east,north]`) : envoyee par la carte uniquement quand un filtre carte est actif (`lib/carte/bbox-requete.ts`) — absente, comportement inchange (scope/regions/depts/ville seuls decident) |
| `/api/map/categories` | GET | Categories POI VISIBLES de l'appelant (`getCategoriesVisibles`) ; route publique : sans session, le socle seul. Super_admin compris : celles de son espace actif (`vueEspace`, 2026-10-12), plus « tout ». Reponse `{ categories: { id, label, origine: 'commune' \| 'espace' }[] }` : « espace » si au moins un POI visible vient d'une source propre a l'espace (`getSourcesPropresEspace`), categorie mixte comprise |
| `/api/map/ooh` | POST | Panneaux OOH. `bbox` optionnelle (Tache 4), meme regle que `/api/map/pois`. Lecture PAGINEE par `lireTout` (borne `PLAFOND_PANNEAUX` = 5 000, au-dela 500 en français plutot qu'un debut) : l'ancien `.limit(5000)` rendait 1 000 panneaux sur 1 434 actifs, plafond `db-max-rows` (corrige le 2026-10-10, mesure : 1 000 → 1 434) |
| `/api/map/transport` | GET | Arrets de transport de la vue (`west/south/east/north`, `types`). UN appel a la RPC `lire_arrets_transport_bbox` (sql/241, `jsonb`, index GIST), borne VOULUE `BORNE_ARRETS` = 5 000 (285 015 arrets en France) : au-dela, les 5 000 premiers par `id` et **`tronque: true`** dans la reponse — lu par l'interface Angular depuis le 2026-10-12 (revue finale du lot 4, I-2b) : la legende de la carte dit « N arrêts affichés, liste tronquée — zoomez pour tout voir » sous le compte (`mentionArretsTronques`, `couches/transport.service.ts`) ; React ne l'affiche toujours pas (gel P5). L'ancien `.limit(5000)` rendait 1 000 arrets (plafond `db-max-rows` ; Marseille-Est : 1 000 → 1 626). ⚠ Une lecture PAGINEE a ete essayee puis retiree le meme jour : chaque page de 1 000 refaisait le parcours de l'index de categorie, ≈ 177 000 buffers sur la vue de Paris contre ≈ 6 800 pour la RPC |
| `/api/map/poi-natures` | GET | Natures de POI. ⚠ Pour `risque_industriel`, les natures sont servies depuis le registre borne `icpe_rubrique_familles` et NON par un balayage des POI : le chemin generique pagine toutes les lignes de la categorie en tirant le jsonb entier, soit ~100 requetes et des centaines de Mo sur 99 152 sites — la famille de l'incident du 28/03 |
| `/api/map/risques-industriels` | GET | **Couche dediee des sites a risque industriel** (sql/175, 2026-09-17) : sites de la bbox, attributs complets pour la popup, et **zone de danger** optionnelle autour de chaque site (`ST_Buffer` sur `geography`, rayon en metres — verifie 499 m pour 500 demandes). Defaut **Seveso** (1 327 sites sur 99 152 ICPE) : ouvrir sur tout noierait les sites qui comptent, et 99 152 points ne s'affichent pas. `gravites` / `natures` / `inclure_inactifs` / `rayon_m` / `limite`. **Route distincte de `/api/map/pois` a dessein** : celle-ci colore par CATEGORIE (une seule teinte pour 99 152 sites, donc aucune legende par type de risque possible), plafonne a 10 000 POI, bascule en nappe de densite des 500, et ne renvoie pas `metadata`. `n_total` compte AVANT la limite, qui coupe les sites les MOINS graves d'abord — une liste tronquee ne perd jamais un Seveso. Lue aussi par `SitesRisqueApi.carte` (Angular, lot 4, T12 : bbox VISIBLE, sans `limite` comme React, donc defaut 2 000) ; RPC `jsonb`, aucune troncature PostgREST |
| `/api/map/pprt` | GET | **Perimetres PPRT** d'une bbox (sql/178, `?bbox=` OBLIGATOIRE, `types=`, `limite=`). Route DISTINCTE de `/api/map/risques-industriels`, qui sert des POINTS et un cercle de danger CALCULE : celle-ci sert les **servitudes PM3 opposables**. Bbox exigee non seulement pour l'I/O — France entiere = 4 948 ko brut — mais parce qu'a cette echelle une zone de 2 km fait **moins d'un pixel** ; la couche a donc un plancher `PPRT_ZOOM_PLANCHER` (8, `lib/version.ts`). Mesure z8 : 126 zones, 182 ko, 46 ms, 0 lecture disque. Cache CDN 1 h — un referentiel de servitudes ne bouge qu'au depot d'une DDT. Lue aussi par `CarteApi.pprt` (Angular, lot 4, T12), bbox VISIBLE, sans `limite` comme React (defaut 700) ; RPC `jsonb`, aucune troncature PostgREST |
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
| `/api/tmja-tiles/[z]/[x]/[y]` | GET | Tuiles MVT du flux routier (`comptages_routiers`), pipeline calque sur celui des carreaux. La table ne porte plus que les **1 100** comptages MESURÉS (le proxy OSM, 99,7 % de l'ancienne table, a été abandonné au rapatriement du 2026-09-19 ; recompté le 2026-10-10). Lue par la carte React et par `CarteApi.urlTuilesTmja()` (Angular, lot 4, T9) |
| `/api/voronoi` | GET | **Cellules de Voronoi d'une categorie** (`?categorie=`, `metropolitaine`, `ville` / `departement` / `region`) — le bouton « Lancer le calcul » du panneau Analyse, SANS le chat (2026-10-12). RPC `get_voronoi_by_category_jsonb` (borne 5 000, `tronque`), session exigee DANS la route par `requireAuth` + `adminFetch` (hors matcher de `middleware.ts`), quota 6 / 60 s, garde `categorieEntierementVisible`. Detail : section « Voronoi & Stats villes » |
| `/api/map/territory-mask` | POST | Geometrie d'un territoire (region/departement/CP) pour le masque MapLibre cote client — meme union admin que `/api/custom-geo/source/admin` |
| `/api/insee-variables/[code]/geojson` | GET | Polygones CP d'une bbox enrichis de la valeur d'une variable INSEE (couche indicateurs). React demande le monde (`-180,-90,180,90` : 6 186 polygones, 21,6 Mo de jsonb) ; Angular (lot 4, T10) la carte VISIBLE |
| `/api/insee-variables/cp-detail` | GET | Commune principale d'un code postal + nombre de communes associees — popup de la couche ci-dessus |
| `/api/ref/geo` | GET | Referentiel regions/departements INSEE lu EN BASE (`ref_regions` + `ref_departements`). Remplace `lib/geo/france-admin.ts` partout ou la liste doit etre a jour |

### Clustering POI x Filosofi (restaure le 2026-09-12)

**Reserve au super_admin depuis le 2026-10-08** (`reserverAuSuperAdmin` sur chaque handler, section masquee dans `PanneauAnalyse` pour les autres) : les modeles portent sur les POI de toutes les organisations.

| Route | Methode | Description |
|-------|---------|-------------|
| `/api/poi-clusters` | GET | GeoJSON des POI colories par cluster (`?duration=`). `poi_clusters` lue par `lireTout` (plafond 20 000) et `poi_france` par lots de 150 ids (« URI too long » mesure des 250 UUID via Kong) : `lib/clustering/lire-clusters.ts` — meme chose pour `/models/[version]` et `/[clusterId]` (2026-10-11 ; coupees a 1 000 POI avant) |
| `/api/poi-clusters/run` | POST/GET | Lance un job (corps valide par Zod) / polling du statut. **`features` null, absent ou `[]` = les 16 variables, passees EXPLICITEMENT en `--features`** (liste lue dans `lib/clustering/feature-themes.ts`) : c'est `--features` seul qui fait enchainer `cache-isochrones` -> `full-retrain` au script. Jusqu'au 2026-10-11, « toutes les variables » omettait l'option et le job finissait `done` sans aucun modele. **Effet de bord : un `dry_run` enchaine lui aussi un `full-retrain` a blanc** — rien n'est ecrit, mais le profilage Filosofi (`compute_filosofi_profiles_batch_2km`) tourne sur TOUTES les isochrones en cache du type, France entiere (`_load_all_cached_isochrones` ignore `geo_filter` : 160 bmw profiles pour 6 selectionnes, mesure le 2026-10-11) ; un vrai lancement entraine de meme sur tout le cache du type. `result_meta.latest_model_version` est lu APRES l'entrainement enchaine, et `result_meta.modele_entraine` dit si une nouvelle version est apparue (`run_full_retrain` peut finir sans erreur et sans modele) **Le moteur est un script Python lance en processus fils : il n'y a aucun runtime Python sur Vercel.** La route repond 503 explicite si le script est absent. Portage Modal : `docs/PLAN_CLUSTERING.md` |
| `/api/poi-clusters/models` | GET | Liste des modeles calcules |
| `/api/poi-clusters/models/[version]` | GET/DELETE | Detail d'un modele (resume par cluster + POI) / suppression |
| `/api/poi-clusters/[clusterId]` | GET | Detail d'un cluster |
| `/api/poi-clusters/poi/[poiId]` | GET | Clusters d'un POI, toutes durees |
| `/api/poi-clusters/history/[poiId]` | GET | Historique des assignations d'un POI |
| `/api/poi-clusters/count` | GET | Nombre de POI du périmètre de l'assistant de calcul (types, `metropolitaine`, `depts`), compté avant le lancement — pas les POI déjà clusterisés |
| `/api/poi-clusters/poi-types` | GET | Types de POI disponibles, avec total et nombre deja clusterise. **Comptes en base par `types_poi_clustering` (sql/248) depuis le 2026-10-11** : la route lisait `poi_france` sans pagination et comptait 1 000 POI sur 390 029 |
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
| `/api/civic-indicators/health-map` | GET | Carte sante environnementale : `dataset=pollen\|atmo`, `scale=departement` (stream NDJSON 1 commune/dept, pollen ET air par ligne) ou `scale=cp` (lecture `pollen_map_daily`/`atmo_map_daily`, filtres `min_level` 0-6 + `metric` + `bbox` optionnelle, Tache 4 — resolue via la RPC `codes_postaux_dans_bbox`, PAS un filtre direct sur `ref_codes_postaux.centroid_lat/lon` qui sont NULL sur toutes les lignes) — layer CivicHealthMapLayer, section Sante environnementale. **2026-09-13** : `scale=departement` passe par `getHealthEnMasse` (lib/civic-health/get-health.ts) — cache lu et ecrit PAR LOTS, ~5 requetes de base au lieu de jusqu'a 312 (3 par commune) ; `scale=cp` avec plus de 500 CP dans la bbox lit la table nationale et filtre en memoire, un `.in()` plus long depassait la limite d'URL PostgREST en silence. **2026-10-10 (sql/244)** : `scale=cp` = UN appel a la RPC `lire_sante_cp_jsonb` (date, seuil, bbox par le centroide du CP, borne `BORNE_LIGNES_CP` = 10 000, `tronque` → 500 en francais) ; avant, la table du jour (`.limit(10_000)` ramene a 1 000 par `max_rows`) ET `codes_postaux_dans_bbox` (1 000 CP sur 6 051 en metropole) etaient deux plafonds muets — invisibles tant que la table ne porte que 100 lignes (2026-09-17), ~6 100 apres une ingestion nationale |

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
| `/api/digital/campaigns` | GET | Liste campagnes avec stats (RPC) — celles de l'ESPACE ACTIF, super_admin compris ; `[]` sans espace actif (R3/R5, 2026-10-12 ; jusque-la le super_admin recevait tout) |
| `/api/digital/[campaignId]/analysis` | GET | Breakdown/medias/indicators/heatmap |
| `/api/digital/[campaignId]/map` | GET | Choroplethe CP campagne (GeoJSON) |
| `/api/digital/[campaignId]/media` | GET | Regies distinctes campagne |
| `/api/digital/[campaignId]/actors` | GET | Acteurs de la campagne (DSP / social / regie) avec livre, depense, CPM, part et atteinte d'objectif — alimente « Qui a diffuse » du Suivi V2 (RPC `get_campaign_actors`) |
| `/api/digital/[campaignId]/pacing` | GET | Diagnostic plan-vs-reel PAR ITEM de zone (`?version=`) : parts intra-zone, ecart, statut, spillover. Distinct de `/suivi`, qui agrege au niveau campagne |
| `/api/digital/[campaignId]/custom-zone/[zoneId]` | GET | Croisement campagne x zone custom → GeoJSON + resume, meme forme que `/map` |
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
| `/api/bidding/strategies/[id]/export` | GET | Fichier custom bidding « fidèle à la pression » par canal (`?channel=` du dsp_channel_registry) : scores par CP interpolés sur la courbe INSEE, 5 paliers quantiles, hors-zone 0 (zones strictes) ou 1 (national+surpression) — dv360 script .py / tiktok fiche / autres CSV `postal_code;score` (lib/digital/bidding-export.ts, étape 5 Lancement). Stratégie sur zone : CP lus par `lireCodesDeZone` (pagine) depuis le 2026-10-10 — avant, le fichier d'une zone de 1 641 CP en portait 1 000 (`db-max-rows`). **Branche `by_zone_set` (2026-09-20)** : un plan issu d'un jeu de zones n'a ni indicateur ni courbe — son multiplicateur a ete calcule une fois par `genererPlanCp` et vit deja dans `bidding_zone_configs`. La route le LIT au lieu de le refaire ; sans cette branche elle rendait `no_scores` en 422 (`variableCode` null, donc `values` vide, donc `cps` vide) alors que le plan existait. Le recalculer serait une SECONDE implementation de `genererPlanCp`, qui finirait par diverger de celle qui a produit le plan reellement pousse au DSP. La lecture est PAGINEE — `db-max-rows` plafonne a 1 000 et un plan national en porte pres de 2 000. Le catch-all suit le MODE : `exclusif` -> 0 (un ×1 rouvrirait la diffusion sur ce que le seuil vient d'ecarter), `pondere` -> 1 (le jeu ne couvre que les codes postaux a moins de 10 km d'un site, portee du pre-calcul ; le reste de la France est hors FICHIER sans etre hors PLAN). Mesure de bout en bout : script DV360 de 18 ko, 5 paliers, en-tete « jeu de zones ». **Branche nationale (variable INSEE sur toute la France) : pages de `indicator_cp_values` triees sur `postal_code` depuis le 2026-10-11** — avec `indicator_code` fixe c'est la cle primaire, ordre total servi par l'index sans tri (EXPLAIN : Index Scan `indicator_cp_values_pkey`, 8 ms a l'offset 5 000) ; avant, `.range()` sans `order()` pouvait rendre des pages qui se recouvrent et des CP absents du fichier. Verrou : `tests/unit/api/export-strategie-national.test.ts` |

### Radio FM/DAB+ (protegees par `requireAuth()`)
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/radio/stations` | GET | Liste radios + nb emetteurs (pagine cote route). Les radios sont lues par `lireTout` (borne `PLAFOND_RADIOS` = 5 000) : l'ancien `.limit(5000)` en rendait 1 000 sur 1 175 et un `total` faux (corrige le 2026-10-10) ; erreur de lecture → message français, detail au journal |
| `/api/radio/emetteurs` | GET | GeoJSON emetteurs (RPC `get_radio_emetteurs_geojson`, `jsonb`, bornee par `limit` ≤ 20 000). Rendait 500 sans `radio_ids` ni `exclude_categories` jusqu'au 2026-10-10 — DEUX surcharges de la RPC (4 et 6 arguments, sql/078 puis sql/080 en `CREATE OR REPLACE` d'une autre signature), PostgREST PGRST203 « Could not choose the best candidate function » : la carte (React ET Angular) n'affichait aucun emetteur par defaut. **sql/240 retire la surcharge a 4 arguments.** Un echec de la RPC rend desormais « Lecture des émetteurs radio impossible. » (le detail PostgREST anglais reste au journal du serveur) |
| `/api/radio/filter-options` | GET | Options filtres (categories, groupes) |
| `/api/radio/stats` | GET | Stats radios |
| `/api/radio/audit` | GET | Audit matching radio |
| `/api/radio/data` | DELETE | ⚠️ **Suppression** des donnees radio (`{ target: 'emetteurs' \| 'radios' \| 'all', confirm }`, `requireAdmin()`) — et NON un GET « donnees radio », comme ce tableau l'annoncait jusqu'au 2026-09-16. **Le fichier n'est pas suivi par git** (motif `data/` de `.gitignore:45`) : il n'existe donc pas en production, ou le bouton de `/admin/radio` repond 404. Voir la note de la section « RLS — DORMANTES » |
| `/api/radio/import-anfr` | POST | Import ANFR (requireAdmin). Phase DIFF : les emetteurs deja en base sont lus par `lireTout` (pagine, borne 100 000) depuis le 2026-10-10 — l'ancienne boucle paginait par 5 000 et s'arretait sur une page de moins de 5 000, donc APRES LA PREMIERE PAGE de 1 000 (`db-max-rows`) : 11 704 des 12 704 emetteurs echappaient au diff (jamais supprimes, comptes nouveaux). **Garde-fous de suppression (decision du 2026-10-10)** : `emetteur_radio_stations.emetteur_id` est `ON DELETE CASCADE` et les 569 698 liaisons rapatriees du projet supprime sont irremplacables. (1) Phase LIAISONS : un emetteur retire de l'ANFR mais lie a au moins une radio n'est JAMAIS supprime, il est compte (`retained_linked`) et nomme au journal (« conserves car lies a des radios », avec le nombre de radios). (2) Si les suppressions restantes depassent 5 % des emetteurs existants, toute la phase DELETE est annulee (`delete_aborted`, message francais chiffre : « fichier ANFR probablement tronque ») ; au-dela de 50 % a retirer, annulation immediate sans lire les liaisons. (3) Suppression par lots de 100 ids, `.delete({ count: 'exact' })` : `deleted` = lignes reellement supprimees, chaque erreur journalisee et comptee (`delete_errors`). Verrou : `tests/unit/radio/anfr-import-pagination.test.ts` |
| `/api/radio/import-arcom-ods` | POST | Import Arcom ODS (requireAdmin) |
| `/api/radio/crawl-arcom` | POST | Crawl + matching Arcom (requireAdmin) |
| `/api/radio/imports-history` | GET | Historique imports |
| `/api/radio/import-logs/[logId]` | GET | Logs import |

### Meteo
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/meteo-geo` | GET | Meteo Open-Meteo agregee par zones admin (NDJSON streaming, echantillonnage spatial ≤500 points/appel, bbox viewport optionnelle en mode cp). **Corrigee le 2026-09-13** : le palier `cp` repondait TOUJOURS `500 No zones found` (sql/160, voir `get_zone_centroids`) ; l'appel Open-Meteo etait un `fetch` NU sans delai (desormais 20 s par tentative, reprise sur 429 minute, echec immediat sur quota horaire) ; la bbox est arrondie VERS L'EXTERIEUR au demi-degre et c'est cette bbox arrondie qui filtre les zones ET forme la cle de cache (avant, deux vues voisines partageaient une cle pour des jeux de zones differents) ; periode bornee des deux cotes ; quota `geo:rl:meteo-geo` 20/min par utilisateur (un appel = jusqu'a 500 unites du quota Open-Meteo gratuit). Logique pure testee dans `lib/meteo/requete.ts`. **Corrigee le 2026-10-10 (sql/243)** : `get_zone_centroids` (`RETURNS TABLE`) rendait 1 000 CP sur 6 187 sous le `max_rows` local, puis la bbox filtrait ce debut en memoire ; la route lit en UN appel `get_zone_centroids_jsonb` (bbox arrondie filtree EN BASE, borne ecrite `BORNE_ZONES` = 10 000, `tronque` → 500 en francais). **Plus de repli sur la France entiere** : une vue sans code postal rend une ligne NDJSON `error` « Aucun code postal dans la zone affichée. » |
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
| `/api/admin/dsp/dv360/targeting/push` | POST | Push ciblage geo d'une zone custom (CP → geo IDs Google) sur un line item DV360 (additif, max 2000 geo IDs, log dans dsp_api_logs). Codes lus par `lireCodesDeZone` (pagine) depuis le 2026-10-10 : avant, 1 000 CP pousses pour une zone de 1 641, sans erreur |
| `/api/admin/dsp/dv360/zones/push` | POST | Cree une location list DV360 regionale nommee comme la zone custom (CP → geo IDs, lots de 500, max 10 000) — bouton « Creer la zone dans DV360 » du ZoneDetailPanel. Codes lus par `lireCodesDeZone` (pagine) depuis le 2026-10-10 : avant, une location list de 1 000 CP pour une zone de 1 641 |
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
| `/api/admin/organizations` | GET/POST | CRUD organisations ; `member_count` = lignes d'`organization_members` (appartenances, pas espace actif) |
| `/api/admin/organizations/[id]` | GET/PATCH/DELETE | Lecture, modification (`config` remplacée en bloc : l'appelant fusionne), suppression ; DELETE refuse en 409 l'espace interne (reconnu par son id `ID_ORGANISATION_INTERNE`, il porte le socle) ; PATCH refuse en 409 un changement de son slug |
| `/api/admin/organizations/[id]/members` | POST/PATCH/DELETE | Gestion membres via `lib/espaces/appartenance.ts` (sql/236) : POST écrit `organization_members` (idempotent), pose l'espace actif s'il était vide, rôle OPTIONNEL et jamais écrit sur une cible déjà super_admin (E3 : l'écran React, supprimé le 2026-10-10, en envoyait un ; un super_admin n'est pas rétrogradé ; son rôle se change par PATCH `/api/admin/users/[id]`) ; PATCH change le rôle d'un membre (appartenance vérifiée, pas l'espace actif) ; DELETE supprime l'appartenance, la base reporte l'espace actif, le rôle n'est plus touché |
| `/api/admin/organizations/[id]/members/reset-password` | POST | Lien de réinitialisation d'un membre (corps `{ email }`) ; lien construit par `genererLienMotDePasse` (`lib/espaces/lien-mot-de-passe.ts`, vers `<origine>/reset-password`) |
| `/api/admin/espaces` | GET | Espaces de travail + compteurs (`nb_membres` depuis `organization_members`, `nb_jeux_prives`) + `socle.nb_jeux` + `nb_comptes` (décompte `head: true` des profils, APRÈS les trois lectures : jamais plus de 3 requêtes simultanées ; compteur de « Tous les comptes ») ; `lib/espaces/lister-espaces.ts` ; super_admin seul, bornée (trois lectures de dizaines de lignes, sous `db-max-rows` = 1 000) |
| `/api/admin/espaces/socle` | GET | Tous les jeux de données + `nb_espaces_clients` (fiche Socle) ; segment fixe à côté de `[id]` |
| `/api/admin/espaces/comptes` | GET | `{ comptes }` : TOUS les profils avec TOUS leurs espaces (`nom_affiche`, E2), espace actif, `cree_le`, tri par email — vue « Tous les comptes » de la page Accès (2026-10-10) ; `lib/espaces/lister-comptes.ts` ; super_admin seul ; profils et appartenances lus PAGE PAR PAGE (`lireTout`, `db-max-rows` = 1 000), au-delà de 10 000 comptes / 50 000 appartenances → 500 plutôt qu'une liste tronquée ; segment fixe à côté de `[id]` |
| `/api/admin/espaces/[id]/donnees` | GET | Chaque jeu avec son statut POUR l'espace (`proprietaire`/`partage`/`socle`/`non_visible`, `statutPourEspace` = condition de `getOrgSourceIds` / `source_visible`, sql/234) ; 400 id non UUID, 404 espace inconnu |
| `/api/admin/espaces/[id]/membres` | GET | `{ membres }` avec leurs AUTRES espaces ; 404 espace inconnu |
| `/api/admin/espaces/[id]/apercu` | GET | « Ce que voit cet espace » : appelle `getOrgSourceIds` (session client simulée) + `getCategoriesVisibles` ; catégories SANS effectif (aucun COUNT sur `poi_france`), `nb_campagnes` ; zones/jeux de zones absents (rattachés à un utilisateur) |
| `/api/admin/users/[id]/espaces` | PUT | Remplace les espaces d'un utilisateur ET son espace actif en UNE transaction (RPC `remplacer_espaces_utilisateur`, sql/236, via `remplacerEspaces` de `lib/espaces/appartenance.ts`) ; corps `{ espaces: uuid[] (50 au plus, sans doublon), espace_actif: uuid \| null }` ; super_admin seul ; 400 corps invalide, espace inconnu ou actif hors liste (client), 404 utilisateur inconnu |
| `/api/admin/organizations/[id]/sources/assign` | POST/DELETE | Assignation sources |
| `/api/admin/sources` | GET/POST | CRUD sources |
| `/api/admin/sources/[id]` | GET/PATCH/DELETE | Detail/modification/suppression source |
| `/api/admin/sources/[id]/export` | GET | Export CSV source (POI ou panneaux). **Depuis le 2026-10-11** : pages de 1 000 triees sur `id`, reprise apres le dernier `id` lu (`lireParCleJusqua`, `lib/supabase/lire-tout.ts`), jusqu'a `BORNE_EXPORT_SOURCE` = 50 000 (`lib/csv/export-source.ts`) ; au-dela, derniere ligne `# Export tronqué : N lignes sur M…`, fichier `…_export_tronque.csv` et en-tete `X-Export-Tronque: true` (`X-Export-Lignes` toujours). Avant, `.limit(50000)` en un appel sortait 1 000 lignes sous `db-max-rows` (mesure : 1 000 sur 5 584 POI). Verrou : `tests/unit/api/export-source-borne.test.ts` |
| `/api/admin/sources/[id]/meta-keys` | GET | Cles metadata source |
| `/api/admin/sources-stats` | GET | Stats sources |
| `/api/admin/iris/stats` | GET | Stats admin IRIS |
| `/api/admin/iris/delete` | DELETE | Suppression donnees IRIS |
| `/api/admin/iris/metadata` | GET/POST | Metadata IRIS |
| `/api/admin/poi-categories` | GET/POST | CRUD categories POI |
| `/api/admin/poi-manage` | GET/POST/DELETE | Gestion POI |
| `/api/admin/poi-samples` | GET | Echantillons POI |
| `/api/admin/civic-ingest` | POST | Ingestion nationale pollen + qualite de l'air → `pollen_map_daily` + `atmo_map_daily` (WFS public Atmo, NDJSON streaming) — aussi cron Inngest `civic-daily-ingest` 05h30. **Corrigee le 2026-10-10** : le referentiel `postal_code_commune` (35 358 liaisons) etait lu par pages de 5 000 que `db-max-rows` ramenait a 1 000, et la boucle s'arretait sur cette « page incomplete » — l'ingestion ne couvrait que 1 000 liaisons (departements 01-02 : les 100 CP de `pollen_map_daily` au 2026-09-17). `lib/civic-health/civic-ingest.ts` lit desormais par `lireTout` (tri sur la cle primaire entiere, borne `MAPPING_PLAFOND` = 60 000) |
| `/api/admin/sync-iris-system` | POST | Sync systeme IRIS |
| `/api/admin/trigger-pmtiles` | POST | Declenchement generation PMTiles |
| `/api/admin/transport-stats` | GET | Stats transport. Scoring des panneaux lu par `lireTout` (pagine, borne 5 000) depuis le 2026-10-10 : l'ancien `.limit(5000)` en comptait 1 000 sur 1 434 (`db-max-rows`) |
| `/api/admin/users` | GET/POST | CRUD utilisateurs ; POST s'appuie sur le profil créé par `on_auth_user_created` (sql/237, sans espace), puis écrit rôle puis appartenance (`organization_members`, avant l'espace actif) ; si l'écriture échoue le compte Auth est supprimé et la route rend 500 |
| `/api/admin/users/[id]` | PATCH/DELETE | Modification / suppression utilisateur ; PATCH : un espace actif hors appartenance (23514, sql/236) rend 400 lisible |
| `/api/admin/users/[id]/lien-mot-de-passe` | POST | Lien de mot de passe d'un compte désigné par son IDENTIFIANT, avec ou sans espace (fiche utilisateur de la page Accès) ; aucun corps ; lit `profiles.email` puis `genererLienMotDePasse` (`lib/espaces/lien-mot-de-passe.ts`, vers `<origine>/reset-password`) ; rend `{ lien }` (secret d'usage unique, jamais journalisé) ; 404 « Compte introuvable. » sur un compte inconnu ou un identifiant non UUID ; super_admin seul |
| `/api/admin/imports` | GET | Historique imports |
| `/api/admin/init-admin` | POST | Init premier admin (protege par ADMIN_INIT_KEY) |
| `/api/admin/custom-geo/list` | GET | Liste CROSS-WORKSPACE des `custom_geo_zones` (super_admin, service role) |
| `/api/admin/custom-geo/stats` | GET | Stats cross-workspace des zones, pour la carte d'en-tete de `/admin/sources` |
| `/api/admin/custom-geo/[id]` | DELETE | Suppression cross-workspace d'une zone (override RLS) |
| `/api/admin/import-geo/register` | POST | Enregistre une source geo importee (pendant de `/api/admin/import-geo/*`) |

### Multi-tenant utilisateur
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/user/organizations` | GET | Orgs de l'utilisateur courant (badge de session React et Angular) ; `name` est le nom AFFICHÉ (`nomAffiche`, `lib/espaces/nom-espace.ts` : « dentsu.explore (interne) » pour `genesis-global`), la base garde son nom |
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
| `/api/custom-geo/[id]/export?weights=` | GET | Variantes ponderees de `bidding_script` (paliers de score DV360 par item) et `tiktok_geo` (un ad group par item avec part de budget) — poids du plan media, RPC `get_zone_items_export` (sql/089). Les formats `csv_cp`, `csv_iris`, `dv360_cp`, `dv360_sdf` et `bidding_script` lisent `custom_geo_zone_codes` EN ENTIER par `lireCodesDeZone` (`lib/custom-geo/codes-zone.ts`, lecture paginee, borne 60 000) depuis le 2026-10-10 : l'ancien `.limit(100000)` rendait 1 000 codes (`db-max-rows`) — une zone en porte 1 641 CP, une autre 9 834 IRIS |
| `/api/custom-geo/source/*` | — | ⚠ **Six des dix-sept routes de ce prefixe portent un quota**, PAS toutes. Avec quota (20 appels / 60 s par utilisateur, compteur PARTAGE en base — `consommer_quota`, sql/135, jamais une Map locale) : `codes-postaux`, `rayon`, `dessin`, `intersection`, `difference` (les cinq routes de fabrication de zone) et `score` (quota `geo:rl:zone-score`, ajoute le 2026-09-15). Les trois routes d'analyse `/api/analyses`, `/score` et `/correlation` en ont un aussi. **SANS quota** : `admin`, `battle`, `carreaux`, `composite`, `digital`, `indicator-threshold`, `iris`, `meteo`, `radio`, `tmja`, `voronoi` — et parmi elles, **`admin`, `indicator-threshold` et `meteo` appellent `get_admin_filter_geometry`**, la RPC dont le cout justifie le garde-fou. Recompte le 2026-09-16 : jusque-la cette ligne, posee sur le glob, laissait croire que les dix-sept etaient couvertes. Cout unitaire mesure : `get_admin_filter_geometry` sur 2 000 CP lit **540 blocs disque** par appel, `zone_dessin` sur 5 000 sommets prend 1,5 s, `zone_rayon` a 100 km 355 ms — sans plafond, une boucle sur l'une d'elles est la famille exacte de l'incident du 28/03 |
| `/api/custom-geo/source/codes-postaux` | POST | **Une zone depuis une liste de CP** (Tache 16) : liste collee (JSON) ou fichier depose (multipart, lu par `lireFormulaire()` + `fichierDeFormulaire()`, jamais un cast). Borne a 2 000 CP. Rend SEPAREMENT les jetons rejetes (coquille de saisie) et les codes inconnus du referentiel (Cedex, code perime, CP etranger) — un import qui avale 500 codes, en resout 460 et n'en dit rien produit une zone plus petite que commandee, et personne ne s'en apercoit avant la facture. La verification au referentiel est **decoupee en lots de 500** : `postgrest-js` encode chaque virgule d'un `.in()` en `%2C`, soit 8 caracteres par CP — a 2 000 codes l'URL faisait **16 104 caracteres** (mesure) pour une limite Kong/nginx usuelle de 16 384, et un depassement echoue MUETTEMENT |
| `/api/custom-geo/source/rayon` | POST | **Zone circulaire** (Tache 17, sql/155) : `{lon, lat, rayon_m}`, rayon borne a 100 km. `ST_Buffer` sur `geography` — en degres, le cercle deviendrait une ellipse et « 20 km » n'en ferait pas 20. Clippe sur `france_borders`, qui couvre les DROM (verifie : -61,8 a 55,8 de longitude). Rend `part_retenue` : Marseille 20 km ne garde que 60,5 % du cercle, le reste est en mer. 409 si le clip emporte tout |
| `/api/custom-geo/source/dessin` | POST | **Trace libre** (Tache 18, sql/156) : recoit le polygone dessine, le valide par `ST_MakeValid` — un trace a main levee croise souvent son propre chemin, et le « noeud papillon » resultant ferait lever toute operation PostGIS ulterieure — puis le clippe sur `france_borders`. 409 sur un trace sans surface exploitable. Rend `corrige` (le trace a du etre repare, la zone n'est pas exactement celle dessinee) et `part_retenue` |
| `/api/custom-geo/source/intersection` | POST | **Ce que 2 a 20 zones ont en commun** (Tache 14, sql/151) : la premiere zone intersectee avec l'UNION des autres — et non une reduction deux a deux, qui repondrait a une autre question. Repond **409** sur une intersection vide plutot que de creer une zone a zero code postal, qui partirait ensuite au DSP. `checkZoneAccess` par lots de 3 |
| `/api/custom-geo/source/difference` | POST | **Une zone moins d'autres** (Tache 14, sql/151). `zone_base` et `zones_retirees` sont deux champs distincts et non une liste : l'operation n'est PAS symetrique, et rien dans le resultat ne dirait qu'on s'est trompe d'ordre. 409 si rien ne reste |
| `/api/custom-geo/media-plan` | GET/POST/DELETE | Rattachement du plan media a une campagne DSP — persiste budget/CPM/cible/poids dans `dsp_campaigns.geo_strategy.media_plan` (sous-cle namespacee, scope org). La LISTE (GET sans `campaign_id`) suit l'espace actif pour tous, `{ campaigns: [] }` sans espace actif, super_admin compris (2026-10-12) ; detail et ecriture d'une campagne nommee : `scopeGuard` inchange (super_admin sans espace autorise) |
| `/api/custom-geo/media-plan/snapshot` | POST | Fige un snapshot VERSIONNE du plan pousse au DSP, item par item (`zone_id:poi_id`), expanse en codes postaux via `get_zone_items_export` |
| `/api/custom-geo/list` | GET | Zones custom de l'org courante |
| `/api/custom-geo/stats` | GET | Comptages des zones de l'org, pour l'en-tete de la galerie |
| `/api/custom-geo/[id]` | GET/PATCH/DELETE | Detail d'une zone (sans geometrie) + bbox (`get_zone_bbox_array`) + sous-zones natives avec leurs comptes de CP/IRIS. Les comptes lisent `custom_geo_zone_codes` par `lireTout` (pagine, borne 60 000) depuis le 2026-10-10 : avant, ils s'arretaient a 1 000 (`db-max-rows`) sur une zone de 9 834 IRIS |
| `/api/custom-geo/[id]/geometry` | GET | Geometrie d'une zone enregistree |
| `/api/custom-geo/capture` | POST | Recoit N geometries + une transformation, appelle `transform_geometries_for_save` puis enchaine creation et resolution des codes |
| `/api/custom-geo/save` | POST | Enregistre la geometrie rendue par une route `source/*` : `create_custom_geo_zone` puis `resolve_custom_geo_zone_codes` (207 si la zone est creee mais la resolution echoue). **Jusqu'au 2026-10-11 (sql/247), 400 sur beaucoup de zones par codes postaux** (13001 + 13002, 75001 + 75002, 13002 seul…), React comme Angular : la geometrie revient du client INVALIDE (voir `create_custom_geo_zone`) |

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

### Agent autonome (bidding) — RETIRE le 2026-10-12

`/api/agent/chat`, `/api/agent/analyze-drift`, `/api/agent/apply-recommendation`
et `/api/bidding/train` sont supprimees avec l'agent, son panneau et le ML
Modal (chantier « suppression de toute l'IA », lot 2 — voir l'encadre en tete
de ce document). Aucune route ne les remplace.

### Mode demo (bac a sable)

Six routes qui montent, font vivre et demontent un jeu de donnees de
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

### Analyses enregistrees (Tache 11, 2026-09-12)
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/analyses` | GET/POST | GET : liste des analyses de l'org (`?type=`, bornee a 50, `idx_analyses_org_date`). POST : enregistre un lancement (nom, parametres complets, maillage, perimetre) |
| `/api/analyses/[id]` | GET/DELETE | Detail complet (avec `parametres`/`perimetre`/`resultat`) / suppression, scopes org |
| `/api/analyses/[id]/rejouer` | POST | Rend de quoi RELANCER une analyse : type, parametres, maillage, perimetre, et l'appel a faire quand le moteur est cable (`score` -> POST `/api/analyses/score`, `correlation` -> GET `/api/analyses/correlation` ; les quatre autres rendent `cable: false`). **N'ECRIT RIEN** depuis le 2026-09-13 : la premiere version inserait une ligne `en_cours` qu'aucun moteur ne reprenait, sans trigger ni delai d'expiration et sans UI de suppression — un fantome eternel par rejeu, double d'un « termine » des que le vrai calcul tournait. La ligne est ecrite par le moteur qui calcule, au moment ou il calcule |
| `/api/analyses/score` | POST | **Score composite** (Tache 12, sql/146) : plusieurs indicateurs de `cible_indicator_registry` normalises 0-100 sur le perimetre puis ponderes, un score par code postal. Perimetre OBLIGATOIRE sous l'une de trois formes (`codes_postaux`, `perimetre` d'un `FiltreActif` — types `region`/`departement`/`commune`/`cp`/`zone`/**`france`**, ce dernier depuis le 2026-09-15, resolu par `codes_postaux_du_perimetre_jsonb`, sql/168 — `bbox`, resolue depuis le 2026-10-10 par `codes_postaux_dans_bbox_jsonb`, sql/245 : l'ancienne RPC tabulaire rendait 1 000 codes sur 6 051 et une grande zone etait scoree sur ses 1 000 premiers), plafonne a **7000** CP (releve de 3000 le 2026-09-15 : la France entiere, 6 187 CP avec 2 indicateurs, mesure a 159 ms/640 Ko — voir la note du fichier). Materialise a la demande tout indicateur ABSENT d'`indicator_cp_values` (sequentiellement — jamais en parallele), et rend la date de calcul de chacun. Enregistre le lancement dans `analyses` (type `score`). Appelle `calculer_score_composite_jsonb` (sql/170) et non la forme `RETURNS TABLE` : celle-ci rend une ligne par CP et PostgREST la tronquait a 5000 sur les 6186 CP du perimetre national, sans erreur. Quota `geo:rl:analyse-score` 12/min |
| `/api/analyses/correlation` | GET | **Correlation impressions x indicateur** (Tache 13, sql/147) : `?campaignId=&variable=`. Apparie les impressions livrees par CP (`campaign_cp_rollup`, DEJA agrege — jamais `dsp_campaign_data`) avec un indicateur INSEE, et rend le coefficient de Pearson, `n`, les points du nuage et la COUVERTURE (CP apparies / CP touches par la campagne). La couverture n'est pas decorative : la jointure est interne, et `rev_median` ne couvre que 1221 des 2041 CP d'une campagne reelle — 40 % ecartes en silence sans elle. Scope org par `checkCampaignAccess`. Quota `geo:rl:analyse-correlation` 12/min |
| `/api/custom-geo/source/score` | POST | Geometrie des CP dont le score composite depasse un seuil — route soeur d'`indicator-threshold`, qui elle ne sait selectionner que sur UN indicateur et ne peut donc PAS exprimer « score composite >= 60 ». Recalcule le score cote serveur (jamais une liste de CP remontee par le client), plafond 1500 CP. Le client sauvegarde ensuite par `/api/custom-geo/save` (`source_type: 'score_composite'`) . **Quota `geo:rl:zone-score` 20/min, ajoute le 2026-09-15** : c'etait la SIXIEME route de fabrication de zone et la seule sans plafond, alors que le bloc ci-dessus la rangeait deja parmi les routes protegees — la doc garantissait une protection inexistante. Elle enchaine pourtant `calculer_score_composite_jsonb` (jusqu'a 3000 CP) PUIS `get_admin_filter_geometry` sur jusqu'a 1500 CP. **Jusqu'au 2026-10-10 elle lisait la forme `RETURNS TABLE`, coupee a 1 000 lignes par PostgREST** : sur une zone de 1 429 CP, les 429 derniers n'etaient jamais scores, et une zone « score >= seuil » sortait amputee ou vide sans erreur. Elle lit la jumelle `jsonb` depuis (verrou : `tests/unit/api/plafond-lectures-carte.test.ts`) |

### Export & Sauvegarde
| Route | Methode | Description |
|-------|---------|-------------|
| `/api/saved-maps`, `/api/saved-maps/[id]` | — | **SUPPRIMEES le 2026-10-12** (lot 6 de la suppression de l'IA) : plus aucun appelant depuis le retrait de `ChatPanel` et de `useSavedMaps` (cartes sauvegardees React abandonnees ; le parcours Angular garde son etat dans l'URL). Elles n'avaient d'ailleurs jamais fonctionne en local (401 faute d'en-tete `Authorization`, puis POST en 500 : colonne `voronoi_data` absente de `saved_maps`). La table `saved_maps` reste en base (liste du proprietaire) ; les entrees `/api/saved-maps` de `middleware.ts` sont inoffensives et laissees (fichier protege, l'accord ne couvre que les routes IA) |
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
| `espace_jeux_recommandes` | **Sélection recommandée de jeux de la carte par espace** (étape ② : « Données communes » s'ouvre sur elle, le reste va dans « Autres données communes »). Une ligne = `(organization_id, cle_jeu)`, clé `famille:nom` (référentiel, ex. `iris:socio-demo`, ou `poi:<categorie>`), CHECK `^[a-z]+:[a-z0-9_-]{1,64}$`. ⚠ **Range, ne donne aucun droit** : les droits restent ceux de `data_sources` / `getOrgSourceIds`, et la recommandation ne précharge aucun calque. Écrite UNIQUEMENT par la RPC `remplacer_jeux_recommandes` (remplacement en une transaction) ; ≤ 200 lignes par espace, donc une lecture par espace est bornée sous le plafond PostgREST de 1 000 par construction. Lecture par la clé primaire (`organization_id` en tête). `ON DELETE CASCADE` depuis `organizations` | sql/251 (2026-10-13). RLS activée sans politique, droits `service_role` seuls |

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
| `communes_arrondissements` | Correspondance arrondissement -> commune mere (45 lignes : Paris 20, Lyon 9, Marseille 16) | Seedee par derivation des codes presents dans `iris_agg_commune`, pas par une liste tapee. Existe parce que `iris_agg_commune` ne contient QUE les arrondissements : les codes 75056 / 69123 / 13055 en sont absents, donc aucun double comptage mais Paris, Lyon et Marseille n'apparaissent jamais entieres. RLS deny-all (sql/150). Etait relue par l'outil copilote `classement_territoires` (`lib/chat/tools/classementTerritoires.ts`, supprime le 2026-10-12 avec le chat) pour reconstituer un centroide des 3 villes ; plus aucun lecteur applicatif |
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
| `panneaux_affichage` | Panneaux OOH/DOOH toutes regies (~1 434 lignes) — table unique (carte) | `source_ref` = OBJECTID, UNIQUE (source, source_ref), filtrer `actif = true` |
| `import_runs_ooh` | Historique imports OOH | |
| `poi_categories` | Categories POI | |
| `poi_accessibility_config` | Parametres sigma accessibilite | |
| `data_sources` | Sources de donnees importees | `organization_id`, `shared_with`, `visibilite` (`socle`/`privee`, sql/234) |

### Radio FM/DAB+
| Table | Description | Notes |
|-------|-------------|-------|
| `emetteurs_radio` | Emetteurs radio ANFR (12 704, dont 11 836 lies a au moins une radio — recompte le 2026-10-10) | geom, puissance_w, hauteur_m, systeme, **`rayon_couverture_m` pre-calcule** (6-54 km). `radio_id` existe mais est NULL partout : passer par la table N:N. 754 emetteurs en outre-mer — tout calcul metrique doit utiliser `geography`, pas Lambert-93. |
| `radios` | Radios (1 175, dont 861 liees a un emetteur — recompte le 2026-10-10) | nom, categorie_arcom, portee, groupe_media, audience_data |
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
| `get_voronoi_by_category` | Voronoi par categorie, clippe France. **ENVELOPPE MINCE de `get_voronoi_by_category_jsonb` depuis sql/246** (2026-10-10) : `RETURNS SETOF json`, donc coupee a `db-max-rows` = 1 000 par PostgREST — mesure : 4 653 cellules de lycees en base, 1 000 rendues. Meme borne (5 000) qu'en sql/164 ; droits alignes sur la jumelle (service_role seul) | *plus appelee par l'application* |
| `get_voronoi_by_category_jsonb` | Jumelle `jsonb` (sql/246) qui porte le calcul de sql/164 inchange (seule la forme passe de `json_build_object` a `jsonb_build_object` : ordre des cles normalise par jsonb, contenu identique ; `p_limite` NULL ou negatif non garde, seul service_role l'appelle) : rend `{ features, tronque }`, lit `p_limite + 1` cellules (defaut 5 000) et DIT quand la borne est atteinte. Identite verifiee contre l'ancienne fonction (ids + aire de chaque cellule, cirfa 95 et lycee 4 653 : 0 ecart). Cout inchange : lycee 14,4 s, `shared hit=318267 read=45946` ; cirfa 0,7 s. Service_role seul | `GET /api/voronoi` (bouton « Lancer le calcul » du panneau Analyse, depuis le 2026-10-12), seul appelant depuis le retrait de `lib/chat/tools/voronoi.ts` (lot 5) — borne `BORNE_CELLULES` = 5 000 |
| `refresh_ville_stats_chunk` | Refresh stats villes par batch | *orpheline* (route supprimee 08/2026) |

**`GET /api/voronoi?categorie=…[&metropolitaine=false][&ville=…|&departement=…|&region=…]`**
(2026-10-12, suppression de l'IA, lot 4) — le Voronoi du panneau Analyse SANS
le chat. Jusque-la, « Lancer le calcul » ecrivait « Fais le Voronoi des … » au
copilote, et seul l'outil `voronoi_analysis` appelait la RPC. La route rend la
MEME forme que l'outil (`voronoiGeoJSON` avec `_meta`, `poisForMap`,
`nb_polygones`, `tronque`, `category`, `metropolitaine`), affichee par
`lib/carte/voronoi-direct.ts` (`appliquerResultatVoronoi` : `applyVoronoi` puis
`setZoneData`, ce que faisait la branche `voronoi_analysis` de `useToolProcessor`)
via `app/map/_hooks/useVoronoiDirect.ts`. Depuis le lot 5, l'outil et
`useToolProcessor` sont supprimes avec le chat : la route est la SEULE copie
du calcul. L'authentification passe AVANT la validation (un anonyme recoit
401, jamais un 400 qui decrirait les parametres) et l'id de repli d'une cellule
sans `id` est deterministe (`<categorie>-<rang>`, plus de `Math.random`). `requeteVoronoi` traduit le territoire du
panneau comme la phrase le formulait (ville > UN departement > UNE region par son
NOM > etendue ; plusieurs regions/departements retombent sur l'etendue).
Gardes : **session exigee dans la route** par `requireAuth` (en-tete
`Authorization`, pose par `adminFetch` cote client — 401 sinon ; la route n'est
PAS dans le matcher de `middleware.ts`, fichier protege, meme patron que
`/api/custom-geo/source/voronoi`), quota partage 6 / 60 s par compte
(`geo:rl:voronoi`), puis `categorieEntierementVisible` avec
`sourcesVisiblesDeLaRequete` (vue espace) : 403 et RPC jamais lancee si un seul
POI de la categorie echappe a l'appelant. Erreur RPC : 500 dans
l'enveloppe `{ error, nb_polygones: 0, category }`. `maxDuration` 60 s (lycees :
14 s). Verrous : `tests/unit/api/voronoi-route.test.ts`,
`tests/unit/carte/voronoi-direct.test.ts`.

### Carreaux & Tuiles
| RPC | Description | Appelee depuis |
|-----|-------------|----------------|
| `get_carreaux_by_zoom` | Carreaux adaptes au zoom | *orpheline* (route supprimee) |
| `get_carreaux_for_scoring` | Carreaux dans rayon (scoring) | `lib/chat/tools/` — **sans appelant depuis le 2026-10-12** (chat supprime, lot 5 ; reste en base, liste du proprietaire) |
| `get_tile` | Tuile MVT carreaux (ST_AsMVT), cascade 5 paliers 20/5/2/1 km + 200 m (sql/129) | `api/tiles/` |
| `get_iris_tile` | Tuile MVT IRIS (sql/139) — **cascade** departement (z4-z6) / commune (z7-z8) / IRIS (z>=9), colonnes decouvertes dynamiquement, chaque feature porte `niveau` et `superficie_km2` | `api/tiles/iris/` |
| `classe_iris` | Classe d'un indicateur IRIS (effectif / densite / proportion), DERIVEE du nom (sql/138). Source unique : agregation, bornes et front en dependent | `construire_iris_agg`, `construire_iris_bornes` |
| `construire_iris_agg` | (Re)construit un palier agrege de la cascade IRIS | outil de construction, sql/138 |
| `construire_iris_bornes` | (Re)calcule les bornes nationales de l'echelle IRIS | outil de construction, sql/140 |
| `classer_territoires` | Classe les territoires d'un palier (commune / departement) sur N'IMPORTE QUEL indicateur numerique, en volume ou en part, avec plancher de population et regroupement optionnel des arrondissements. La colonne est decouverte dans `information_schema` — seule barriere contre l'injection par nom de colonne — et l'agregation est deleguee a `classe_iris` : effectif=somme, proportion=moyenne ponderee par la population, densite=recalculee sur les surfaces. La colonne `part` ne vaut que pour un effectif (sql/150) | `lib/chat/tools/classementTerritoires.ts` (outil copilote `classement_territoires`, branche le 2026-09-12) — **sans appelant depuis le 2026-10-12** (chat supprime, lot 5 ; reste en base, liste du proprietaire) |
| `fill_carreaux_1km_bande` | Agrege les carreaux 200 m en mailles 1 km, par bande verticale (progression + journal anti-rejeu) | outil de construction, sql/129 |
| `import_carreaux_batch` | Upsert batch carreaux | `api/admin/import-geo/` |
| `populate_carreaux_columns` | Colonnes derivees post-import | `lib/inngest/functions/` |

### IRIS
| RPC | Description | Appelee depuis |
|-----|-------------|----------------|
| `get_iris_stats_by_bbox` | Stats IRIS par bbox | `api/iris/stats/` |
| `get_iris_dept_stats` | Stats IRIS departementales | `api/iris/stats/` |
| `get_iris_metric_columns` | Colonnes metriques dynamiques | `api/admin/sync-iris-system/` (`lib/chat/tools/indicateursTerritoires.ts`, son autre lecteur, supprime le 2026-10-12 avec le chat) |
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
| `create_custom_geo_zone` | Cree une zone custom depuis un GeoJSON Polygon/MultiPolygon ; une geometrie invalide passe par `ST_MakeValid` **puis `ST_CollectionExtract(…, 3)` depuis sql/247 (2026-10-11)** : `ST_MakeValid` (methode `linework`) gardait l'anneau effondre d'un trou degenere en LIGNE et rendait une GEOMETRYCOLLECTION, refusee par la colonne `geometry(MultiPolygon)`. Cause mesuree : `get_admin_filter_geometry` serialise en GeoJSON a 9 decimales, et 470 des 6 187 codes postaux (13002, 75001…) portent un trou de 4 sommets dont deux ne different qu'a la 15e decimale — l'aller-retour par le client le rend invalide. Les residus jetes sont des lignes sans aire (ecart < 2e-7 km2 avec l'union exacte) ; une reparation sans surface leve « Géométrie sans surface après réparation ». Geometrie deja valide : chemin inchange (surfaces et comptes IRIS/CP identiques avant/apres, verifie sur 2 listes et les 7 zones existantes) | `api/custom-geo/save/`, `api/custom-geo/capture/` |
| `create_custom_geo_zone_with_subzones` | Zone parente + N sous-zones (sans sous-zones : delegue a `create_custom_geo_zone`). Meme correctif sql/247, sur la parente ET chaque sous-zone | `api/custom-geo/capture/` |
| `get_zone_radius_targets` | Un cercle circonscrit (centroide, rayon 1-50 km, aire) par poche disjointe (`ST_Dump`) d'une zone custom, pour le ciblage TikTok par rayon. **Creee hors migrations** (aucun `CREATE` dans `sql/`), `RETURNS TABLE` sans `LIMIT` : 565 lignes au plus le 2026-10-10, sous le plafond PostgREST de 1 000, mais rien ne l'y tient — **dette E** de `docs/SUITE_TRONCATURE_POSTGREST.md` | `api/custom-geo/[id]/export/` (`tiktok_geo`) |
| `get_campaign_medias` | Regies distinctes campagne | `api/digital/[id]/analysis/` |
| `get_digital_geography_map_v2` | Choroplethe CP | `api/digital/[id]/map/` — la v1 `get_digital_campaign_map` a ete supprimee le 2026-09-11 |
| `get_digital_analysis_breakdown_v2` | Breakdown geo | `api/digital/[id]/analysis/` — la v1 a ete supprimee le 2026-09-11 |
| `get_digital_media_heatmap_v2` | Heatmap regies x zones | `api/digital/[id]/analysis/` — la v1 a ete supprimee le 2026-09-11 |
| `get_digital_available_indicators` | Indicateurs disponibles | `api/digital/[id]/analysis/` |
| `match_campaign_postal_to_iris` | Matching postal -> commune -> IRIS | `api/admin/campaigns/import/` |
| `get_dsp_campaign_stats` | Stats agregees campagne | `api/admin/campaigns/` |
| `get_campaign_stats_by_field` | Stats par champ (jsonb, creee sql/098 — n'existait pas avant 07/2026, la route admin utilisait son fallback) | `api/admin/campaigns/[id]/` |
| `materialiser_indicateur_cp` | Enveloppe instrumentee de `materialize_indicator_cp_values` : journalise le nombre de lignes ecrites et la date de la donnee (pollen/atmo) | `lib/analyses/indicateurs.ts` (sql/148) |
| `etat_indicateur_cp` | Dit si un indicateur est calculable, deja calcule, VIDE ou perime — sans rien recalculer. `perime` ne vaut true que pour les sources quotidiennes `pollen`/`atmo`, dont `indicator_cp_values` fige le `max(date_ech)` du jour de la materialisation | `lib/analyses/indicateurs.ts` (sql/148) |
| `materialize_indicator_cp_values` | Materialise un indicateur du registre IRIS en valeurs par CP (agregation ponderee + fallback communal), table `indicator_cp_values`. **sql/249 (2026-10-12)** : verrou consultatif PAR INDICATEUR (`pg_advisory_xact_lock`) en tete et `ON CONFLICT (indicator_code, postal_code) DO UPDATE` sur chaque INSERT — deux premiers calculs simultanes (correlation, score) levaient `indicator_cp_values_pkey` et la route repondait 500 (revue finale du lot 4, I-2a). La seconde requete attend la premiere puis recalcule ; verrouille par `tests/unit/db/materialisation-indicateur-course.test.ts` | Lancement wizard (matérialisation lazy), `api/bidding/strategies/`, `lib/analyses/indicateurs.ts` via `materialiser_indicateur_cp` |
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
| `get_radio_emetteurs_geojson` | GeoJSON emetteurs, UNE seule signature a 6 arguments depuis sql/240 (la surcharge a 4 arguments de sql/078 rendait l'appel ambigu). **Radio d'un emetteur (sql/242) : jamais un choix arbitraire.** `radio_id`, `radio_nom`, `portee`, `categorie_arcom`, `genre`, `groupe_media` (et `radio_principale`) ne sont remplis que si la radio est UNIQUE : sans filtre de radio, seulement si l'emetteur est lie a exactement une radio ; avec `p_radio_id`, la radio choisie ; avec `p_radio_ids`, la seule radio du filtre que l'emetteur porte (deux → NULL). Sinon NULL, et `nb_radios` dit combien de radios l'emetteur porte. ⚠ Aucun emetteur n'est lie a une seule radio (13 a 73) : sans filtre, AUCUN ne porte de radio — les clients affichent « Radio non associée », ce qui est vrai. sql/240 prenait la premiere par nom (« Air Zen, locale » sur 3 046 emetteurs, dont Mont July et ses 73 radios) : retire. `exploitant` rendu depuis sql/240. 11 836 emetteurs lies sur 12 704 ; `puissance_w` NULL partout (donnee absente de l'import ANFR). Cout de l'appel global : ≈ 1,72 M buffers → ≈ 72 000 (sql/242 ne sonde plus `radios` pour chaque liaison) | `api/radio/emetteurs/` |
| `get_radio_filter_options` | Options filtres radio | `api/radio/filter-options/` |
| `get_radio_stats` | Stats globales radio | `api/radio/stats/` |
| `get_radio_audit` | Audit matching radio | `api/radio/audit/` |
| `count_emetteurs_par_radio` | Comptage emetteurs/radio. `RETURNS TABLE`, une ligne par radio ayant un emetteur : 861 le 2026-10-10, sous le plafond PostgREST de 1 000 — mais 1 175 radios en table. **Dette D** de `docs/SUITE_TRONCATURE_POSTGREST.md`, non touchee | `api/radio/stations/` |
| `archive_and_purge_radio` | Archivage donnees radio | `lib/radio/anfr-import.ts` |

### Meteo
| RPC | Description | Appelee depuis |
|-----|-------------|----------------|
| `get_zone_centroids` | Centroides zones admin. **sql/160 (2026-09-13)** : le palier `cp` lisait `centroid_lat`/`centroid_lon`, NULL sur les 6 187 lignes de `ref_codes_postaux` (meme piege que sql/144) et rendait 0 ligne — la meteo par code postal n'a jamais fonctionne. Lit `ST_X/ST_Y(centroid)`, avec le meme repli sur la geometrie pour region et departement. Mesure : 6 187 lignes en 34 ms. **Depuis sql/243 (2026-10-10) : enveloppe mince de `get_zone_centroids_jsonb`, plus appelee par l'application** | — |
| `get_zone_centroids_jsonb` | Jumelle `jsonb` de `get_zone_centroids` (sql/243, 2026-10-10), qui porte le corps : `(p_scale, p_ouest, p_sud, p_est, p_nord, p_limite = 10 000)` → `{ zones: [{code, nom, lat, lon}], tronque }`, triees par code. La bbox (palier `cp` seulement) est filtree par `idx_ref_codes_postaux_centroid` ; `p_limite + 1` lignes lues, `tronque` dit la borne atteinte. plpgsql + `EXECUTE … USING` (plan sur mesure). EXPLAIN : bbox metropole 6 051 CP, 1 710 buffers / 64 ms ; departement du Rhone 205 CP, 89 buffers / 1,7 ms (avant : la table entiere, 1 552 buffers, a chaque appel). Reservee a `service_role` | `api/meteo-geo/` |
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
| `calculer_score_composite` | **ENVELOPPE MINCE de `calculer_score_composite_jsonb` depuis sql/170** (meme patron que sql/169 : un seul corps, deux formes de retour, derive impossible par construction). `RETURNS TABLE`, donc coupee a `db-max-rows` = **1 000** lignes par PostgREST (et non 5 000, le reglage de l'ancien projet heberge) — **plus appelee par l'application depuis le 2026-10-10** : `/api/custom-geo/source/score`, qui l'appelait avec jusqu'a 3 000 CP en se croyant protege par un plafond de 1 500, recevait 1 000 scores sur une zone de 1 429 CP (Auvergne-Rhone-Alpes + Occitanie) ; il lit desormais la jumelle. Score composite 0-100 par code postal : N indicateurs d'`indicator_cp_values` normalises min-max SUR LE PERIMETRE demande — jamais des bornes nationales figees (c'est le role d'`iris_bornes_echelle` pour les couleurs) — puis ponderes. Rend aussi `n_indicateurs`, sans quoi un score porte par un seul indicateur serait indiscernable d'un score complet — ce n'est pas theorique, `rev_median` ne couvre que 1952 des 6186 CP. Jumeau TypeScript teste : `lib/analyses/score.ts` (memes poids, meme arrondi). Mesure : 23,5 ms sur 500 CP, **159 ms sur les 6 187 CP de France** (spec-filtre-france.md, 2026-09-15) — `/api/analyses/score` admet desormais ce perimetre (plafond releve a 7000, filtre `'france'`) ; `/api/custom-geo/source/score` plafonne la ZONE CREEE a 1500 CP, un choix produit (zone trop large a creer) et non une contrainte technique | *plus appelee par l'application* (sql/146, enveloppe sql/170) |
| `calculer_score_composite_jsonb` | Jumelle `RETURNS jsonb` de `calculer_score_composite` ci-dessus (sql/170, 2026-09-15) et **source unique du corps du calcul** depuis cette migration. QUATRIEME troncature PostgREST du projet, apres `correlation_campagne_indicateur` (sql/154) et `codes_postaux_du_perimetre` (sql/168) : la RPC rend UNE LIGNE PAR CODE POSTAL, mesuree a **6186 lignes** sur les 6 187 CP du referentiel — PostgREST en rendait 5 000 sans erreur, 1 186 codes postaux restaient non colories sur la choropleth et `analyses.resultat` figeait `n_scores: 5000`. sql/168 avait corrige la fonction qui RESOUT le perimetre ; celle qui le CALCULE etait restee `RETURNS TABLE`. Verifie apres migration : 6186 des deux cotes, 0 ecart sur un FULL JOIN ligne a ligne. Mesure `EXPLAIN (ANALYZE, BUFFERS)` : jumelle jsonb 67,4 ms / `shared hit=2899` / 0 lecture disque ; enveloppe TABLE 72,7 ms / `shared hit=2948` — l'indirection coute ~5 ms et 49 buffers sur 6 186 lignes. Mesure du 2026-10-10 sur 1 429 CP (AURA + Occitanie) : jumelle 10,7 ms / `shared hit=529`, 1 429 lignes rendues par PostgREST ; enveloppe TABLE 25,7 ms, 1 000 rendues | `api/analyses/score/`, `api/custom-geo/source/score/` (sql/170) |
| `correlation_campagne_indicateur` | Impressions par CP (SOMMEES sur les acteurs) appariees a un indicateur INSEE. La somme est obligatoire : la PK de `campaign_cp_rollup` est (campaign_id, postal_code, ACTEUR), donc un CP y apparait jusqu'a 5 fois — 10 205 lignes pour 2 041 CP sur une campagne reelle. **`RETURNS jsonb` et non `TABLE` (sql/154)** : PostgREST tronque a `db-max-rows` (5 000 sur l'ancien projet heberge, 1 000 sur le stack local) AUSSI les RPC `RETURNS TABLE` — mesure, `codes_postaux_dans_bbox` rend 5 000 lignes pour 6 051 reelles, sans erreur. Une campagne nationale de plus de 5 000 CP aurait vu son coefficient calcule sur la moitie nord-est de la France, avec un `n` faux et rien pour le dire | `api/analyses/correlation/` (sql/147, sql/154) |
| `compte_cp_campagne` | Nombre de codes postaux DISTINCTS touches par une campagne. Existe parce que supabase-js ne sait pas faire un `COUNT(DISTINCT)` : un `count: 'exact'` compterait une ligne par acteur et annoncerait 5x trop. Separee de la RPC d'appariement pour repondre AUSSI quand zero CP s'apparie — le cas ou ce chiffre compte le plus | `api/analyses/correlation/` (sql/147) |
| `codes_postaux_du_perimetre` | Codes postaux d'un `FiltreActif` (region/departement/commune/CP/zone/**france**). Existe parce qu'un filtre ne porte de bbox resolue QUE pour une zone enregistree : `bboxDuFiltre` repliait sinon sur `BBOX_METRO`, soit les 6187 CP de France. **Depuis sql/169 (2026-09-15, ruling FF-1) : ENVELOPPE MINCE de `codes_postaux_du_perimetre_jsonb` ci-dessous** — `RETURN QUERY SELECT jsonb_array_elements_text(...)`, un seul corps porte desormais les six branches, deux formes de retour, derive impossible par construction (les deux fonctions portaient chacune les six branches recopiees avant ce correctif, et rien ne les comparait). `RETURNS TABLE`, donc tronquee a `db-max-rows` par PostgREST au-dela (1 000 sur le stack local ; 5000 sur l'ancien projet heberge) — c'est pour cela que `france` (6 187 CP) n'est jamais appelee sous cette forme par l'app. Verifie apres migration, les six branches TABLE vs jsonb : cp 1/1, departement 23/23, region 30/30, commune 1/1, zone 58/58, france 6187/6187. Cout mesure sur la branche departement (EXPLAIN ANALYZE BUFFERS) : ~1,7-1,9 ms/343 buffers avant l'enveloppe, ~2,0-2,5 ms/385 buffers apres — indirection mesuree, non cachee, jugee negligeable a cette echelle | plus appelee par l'app depuis sql/168 (definition conservee, jamais de DROP) |
| `codes_postaux_du_perimetre_jsonb` | Jumelle `RETURNS jsonb` de `codes_postaux_du_perimetre` ci-dessus (sql/168, 2026-09-15) : PostgREST tronque a `db-max-rows` TOUTE RPC `RETURNS TABLE` (5000 sur l'ancien projet heberge, 1 000 sur le stack local), meme piege deja documente pour `correlation_campagne_indicateur` (sql/154) — decouvert en testant le parcours reel, `/api/analyses/score` affichait 5 000 CP au lieu de 6 187 sur le perimetre `france`. Une fonction JUMELLE plutot qu'un DROP + CREATE OR REPLACE de l'originale (changer le type de retour l'exige, et DROP est exclu en production). Verifie : `jsonb_array_length(...('france', _)) = 6187`. **Depuis sql/169 : SOURCE UNIQUE des six branches** — `codes_postaux_du_perimetre` l'enveloppe au lieu de les recopier | `api/analyses/score/` (sql/168) |
| `codes_postaux_dans_bbox` | Codes postaux dont le centroide (`ref_codes_postaux.centroid`, geometry GIST) tombe dans une bbox (sql/144). `centroid_lat`/`centroid_lon` sont NULL sur les 6187 lignes — seule cette RPC (PostGIS `&&`/`ST_MakeEnvelope`) donne un resultat correct. ⚠ `RETURNS TABLE` : 1 000 lignes rendues sur 6 051 pour la metropole sous le `max_rows` local (mesure 2026-10-10). `health-map` ne l'appelle plus depuis sql/244. **Depuis sql/245 : enveloppe mince de `codes_postaux_dans_bbox_jsonb`, plus appelee par l'application** | — |
| `codes_postaux_dans_bbox_jsonb` | Jumelle `jsonb` de `codes_postaux_dans_bbox` (sql/245, 2026-10-10), qui porte le corps : tableau des codes tries dont le centroide tombe dans la bbox, `[]` si aucun. Bornee par construction par le referentiel (6 187 CP). SECURITY DEFINER, `service_role` seul, comme l'originale. EXPLAIN : metropole 6 051 codes, 4,7 ms ; Rhone 205 codes, 206 buffers, 0,5 ms | `api/analyses/score/` (bbox d'une zone enregistree) |
| `lire_sante_cp_jsonb` | Sante environnementale au code postal en UN passage (sql/244, 2026-10-10) : `(p_jeu pollen\|atmo, p_metrique, p_niveau_min, p_ouest/p_sud/p_est/p_nord, p_limite = 10 000)` → `{ date, rows, tronque }`. Dernier jour par la cle primaire (lecture arriere), seuil sur la metrique (liste FERMEE avant le SQL dynamique), bbox par semi-jointure sur `ref_codes_postaux.centroid` (GIST, meme semantique que `codes_postaux_dans_bbox`). Colonnes rendues = celles de l'ancienne route. Mesure (jour national synthetique de 6 187 lignes, en transaction annulee) : metropole 6 051 lignes ≈ 140 ms a chaud ; Rhone 205 lignes, 222 buffers, 6 ms ; sans bbox 6 187 lignes ≈ 110 ms. Reservee a `service_role` | `api/civic-indicators/health-map/` (scale=cp) |

### Admin & Monitoring
| RPC | Description | Appelee depuis |
|-----|-------------|----------------|
| `remplacer_jeux_recommandes` | Remplace la sélection recommandée d'un espace (`espace_jeux_recommandes`) en UNE transaction : `(p_organization_id uuid, p_cles text[])` → `RETURNS jsonb` `{ cles: [...] }`, triées et dédoublonnées ; liste vide = tout effacer. Erreurs : `22004` espace `null`, `22023` au-delà de 200 clés, `23514` sur une clé mal formée (la liste précédente reste intacte), `23503` espace inexistant. Verrouille d'abord la ligne de l'espace (`FOR NO KEY UPDATE`) : sans ce verrou, deux remplacements simultanés aux listes disjointes laissaient leur UNION (mesuré le 2026-10-13, deux sessions psql) ; ils passent désormais en file, le dernier remplace tout. Range, ne donne aucun droit. `SECURITY INVOKER`, `service_role` seul. Un DELETE puis un INSERT côté route doublerait ou viderait sur une erreur à moitié — d'où la RPC | aucun appelant à ce jour (route d'admin à venir, chantier « carte en parcours ») (sql/251, 2026-10-13) |
| `get_table_sizes` | Taille tables (monitoring) | `api/admin/health/` |
| `qualite_colonnes_iris` | Remplissage de CHAQUE colonne numerique d'`iris` en UN SEUL balayage (~220 Mo, 1,4 s). Se distingue de `get_iris_fill_status`, qui fait un COUNT par colonne (~40 balayages, ~8,8 Go) et confond une colonne vide avec une colonne pleine de zeros | `api/admin/qualite-donnees/` (sql/149) |
| `qualite_indicateurs` | Quels indicateurs ACTIFS du registre pointent vers une colonne vide, partielle ou absente. La verification la plus rentable du lot : elle aurait attrape `part_couples_enfants` (0 renseigne sur 49 448 IRIS, actif donc propose a l'utilisateur) avant qu'un score ne soit calcule dessus | `api/admin/qualite-donnees/` (sql/149) |
| `qualite_fraicheur` | Age de chaque source a cadence attendue. Le champ `alimentation` evite LE contresens : une table figee alimentee par un cron signale un cron qui ne tourne pas, pas une donnee absente a la source | `api/admin/qualite-donnees/` (sql/149) |
| `fraicheur_sources` | Fraicheur d'un ensemble de sources dont la liste — tables ET colonnes — arrive EN ARGUMENT depuis `lib/donnees/registre-fraicheur.ts` : ajouter une source ne demande aucune migration, contrairement a `qualite_fraicheur` qui code ses six sources dans son corps. Noms valides dans `information_schema` avant toute interpolation, seule barriere contre l'injection par nom de colonne (meme patron que `classer_territoires`). `p_inclure_lourd` garde le balayage de `comptages_routiers` derriere un geste explicite ; sur une source lourde le nombre de lignes vient de `reltuples`, car un COUNT exact couterait le balayage que ce garde-fou evite | `api/admin/fraicheur-donnees/` (sql/161) |
| `qualite_invariants` | Invariants metier chiffres (population 67 760 552, proprietaires 58,60 %, logements sociaux 14,97 %, revenu median 23 097 EUR, somme des tranches d'age = population). Seule famille qui detecte une donnee FAUSSE, par opposition a absente, partielle ou perimee | `api/admin/qualite-donnees/` (sql/149) |
| `count_poi_by_categorie_source` | Compte POI par categorie/source | `api/admin/import-datagouv/` |
| `get_sources_stats` | Stats sources de donnees | `api/admin/sources-stats/` |
| `get_poi_categories` | Categories POI | `api/admin/poi-categories/` |
| `get_active_data_registry` | Registre donnees actif | `api/` — **sans appelant depuis le 2026-10-12** (son lecteur, l'outil copilote `ask_configuration`, est supprime avec le chat, lot 5 ; reste en base, liste du proprietaire) |
| `get_check_constraint_values` | Valeurs contraintes CHECK | `api/` |
| `drop_carreaux_table` | DROP table carreaux dynamique | `api/admin/sources/[id]/` |
| `log_smart_prompt_feedback` | Log feedback prompt IA | `api/smart-prompt/` — **sans appelant depuis le 2026-10-12** (chat supprime, lot 5 ; reste en base, liste du proprietaire) |
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
| `lire_arrets_transport_bbox` | Arrets de transport d'une bbox en UN passage (sql/241, 2026-10-10) : `geom &&` enveloppe (index GIST partiel `idx_poi_france_geom_cat`) + bornes `lat`/`lng` exactes, filtre `p_types`, perimetre `p_sources` (NULL = tout ; sinon referentiels + sources listees), `ORDER BY id LIMIT p_limite + 1` → `{ arrets, tronque }`. `RETURNS jsonb`, plpgsql + `EXECUTE … USING` : une version `language sql` recevait un plan GENERIQUE (375 000 buffers sur la bbox France contre ≈ 7 000). service_role seul. EXPLAIN (ANALYZE, BUFFERS) : Paris 6 795, Marseille-Est 480, France 6 955 buffers | `api/map/transport/` |
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
| `types_poi_clustering` | Types de POI de l'assistant de clustering, comptes EN BASE (sql/248, 2026-10-11) : `[{ type, total, clustered }]` trie par total decroissant, `RETURNS jsonb`. `clustered` = POI DISTINCTS presents dans `poi_clusters`, tous modeles confondus. Remplace la lecture non paginee de `poi_france` par la route, coupee a 1 000 lignes sur 390 029 (l'assistant ne proposait qu'« arret_transport 1 000 POIs »). Index Only Scan `idx_poi_france_categorie`, ≈ 7 000 buffers, ≈ 25-38 ms. service_role seul | `api/poi-clusters/poi-types` |
| `compte_poi_par_categorie` | Comptage des POI par categorie dans une ville ou une region, en UNE requete groupee (sql/136). `p_champ` limite a 'ville'/'region' | `lib/chat/tools/analyseComplete.ts` — **sans appelant depuis le 2026-10-12** (chat supprime, lot 5 ; reste en base, liste du proprietaire) |
| `smart_demographie_stats` | Stats demo smart prompt | `lib/smart-prompt/` — **sans appelant depuis le 2026-10-12** (chat supprime, lot 5 ; reste en base, liste du proprietaire) |
| `smart_demographie_top_villes` | Top villes smart prompt | `lib/smart-prompt/` — **sans appelant depuis le 2026-10-12** (chat supprime, lot 5 ; reste en base, liste du proprietaire) |

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
| `DSP_ENC_KEY` | Cle AES-256 base64 (32 bytes) pour chiffrer les secrets DSP (`dsp_connections`) — **jamais exposer au client** |

### Optionnelles
| Variable | Description |
|----------|-------------|
| `UPSTASH_REDIS_REST_URL` | Redis rate limiting |
| `UPSTASH_REDIS_REST_TOKEN` | Token Redis |
| `ADMIN_INIT_KEY` | Cle init admin |
| `INNGEST_EVENT_KEY` | Jobs async |
| `INNGEST_SIGNING_KEY` | Signing jobs |
| `NEXT_PUBLIC_APP_URL` | URL app ; absente, l'origine de la requete. Sert le `redirectTo` des liens de mot de passe (`lib/espaces/lien-mot-de-passe.ts`) : l'origine retenue doit figurer dans la liste blanche de GoTrue. Second lecteur depuis le 2026-10-13 : `angular/scripts/ecrire-config.mjs` (`npm run config`) la recopie dans `urlApplicationReact` de `config.local.json` — OPTIONNELLE, non posee a ce jour ; sans elle, les etapes 6 a 8 du parcours de la carte Angular (5 a 7 avant le passage a 8 etapes du 2026-10-13) affichent « Bientot dans le parcours. » au lieu du lien vers l'ecran React |
| `NEXT_PUBLIC_URL_ANGULAR` | Adresse de l'application Angular (ex. `http://localhost:4200/app`, sans barre finale). Les liens React vers la page « Accès » en derivent (`${URL}/admin/acces`, `lib/espaces/lien-page-acces.ts`) ; absente, l'entree « Accès » n'est pas rendue (barre laterale, Reglages de la carte, tableau de bord) et `/admin/sources` n'affiche qu'un texte. Inlinee dans le bundle client au build |
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
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Vue Street View d'un panneau dans `app/map/_components/MapPanel.tsx` — l'unique consommateur, et **la seule dependance Google Maps du produit** (la cartographie est MapLibre + OpenFreeMap). `NEXT_PUBLIC_`, donc **inlinee dans le bundle client** : restreindre la cle par referent cote console Google, elle est lisible par tout visiteur. Absente, le composant remplace l'iframe par un bandeau rouge qui NOMME la variable (`MapPanel.tsx:327`) — verifie, pas de plantage |

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

### PostgREST — troncature a 1 000 lignes (`db-max-rows`), sans erreur

- **Toute** requete de table ET **toute** fonction `RETURNS TABLE` ou `SETOF`
  est coupee a `db-max-rows` par PostgREST, sans exception levee, sans
  en-tete, sans avertissement. **Ce plafond vaut 1 000** sur le seul
  environnement qui existe (`supabase/config.toml`, `max_rows = 1000` ;
  `PGRST_DB_MAX_ROWS=1000` dans le conteneur). C'est un plafond SERVEUR :
  `.limit(100000)` ne le leve pas.
- ⚠ **Cette section annoncait « 5 000 lignes » pour les RPC jusqu'au
  2026-10-10**, et un plafond DISTINCT de 1 000 pour les tables. Le 5 000
  etait le reglage du projet heberge, supprime le 2026-09-21 ; mesure ce
  jour-la par des appels PostgREST directs, `get_zone_centroids('cp')` rendait
  1 000 lignes sur 6 187, `calculer_score_composite` 1 000 sur 1 429,
  `get_voronoi_by_category('lycee')` 1 000 sur 4 653. C'est le meme plafond.
- Une RPC dont le resultat peut depasser 1 000 lignes est `RETURNS jsonb`.
  Changer le type de retour d'une fonction existante exige un `DROP` : on
  ecrit une **jumelle** `_jsonb` porteuse du corps, et l'originale devient une
  **enveloppe mince** (patron sql/154, 168-169, 170, 243, 246), avec
  `p_limite + 1` lu et `tronque` rendu quand une borne s'applique.
- Une table se lit par `lireTout` (`lib/supabase/lire-tout.ts`), qui pagine et
  LEVE plutot que de rendre un debut — sauf quand chaque page re-parcourt un
  gros index : alors une RPC `jsonb` en un passage (sql/241).
- `tests/unit/db/troncature-postgrest.test.ts` exige une borne ecrite pour
  chaque RPC tabulaire appelee par l'application (y compris les deux creees
  hors migrations), et lit `max_rows` dans `supabase/config.toml`.
  Recensement du 2026-10-10 et dettes ouvertes (C, D, E) :
  `docs/SUITE_TRONCATURE_POSTGREST.md`.

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
- **Liste blanche des redirections de l'auth locale** (`[auth]
  additional_redirect_urls` de `supabase/config.toml`) : `http://localhost:3000/**`
  et `http://127.0.0.1:3000/**` depuis le 2026-10-10. Elle valait
  `["https://127.0.0.1:3000"]` (https, sans chemin, sans `localhost`) : GoTrue
  remplacait EN SILENCE le `redirectTo` des liens de mot de passe par
  `site_url`, et le lien d'un compte cree menait a la racine au lieu de
  `/reset-password`. `tests/integration/creation-compte.test.ts` lit le
  `redirect_to` du lien genere. Une modification de `config.toml` ne prend
  effet qu'apres `npx supabase stop` puis `scripts/local/01-supabase-up.sh` —
  jamais `--no-backup`, qui efface les volumes.
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

## Application Angular (depuis le 2026-09-29)

Migration progressive de l'interface, module par module, sans toucher à l'API
(feuille de route : `docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md`).

- **Guide de reprise (lot 4, T22, 2026-10-12)** : `angular/README.md` (démarrer, arborescence, patrons avec
  un fichier exemple chacun, contraintes AIDA, gardes structurelles, pièges) et un `README.md` court par
  dossier de `angular/src/app/features/`. Ce document reste la source de vérité ; les README n'en sont que
  l'entrée. ⚠ **Plafond de 400 lignes** par `.ts` non-spec d'`angular/src`
  (`tests/unit/angular/taille-fichiers.test.ts`, seule exception nommée : `ui/icone/icones.ts`, table de
  données) : un fichier qui grossit se découpe — logique pure dans `logique/`, gabarit long en `.html`.
- **Deux applications, une API.** React sur `:3000`, Angular sur `:4200` ; le
  proxy de dev d'Angular redirige `/api` vers `:3000`.
- ⚠ **L'authentification est DOUBLE, et c'est ce qui a imposé `@supabase/ssr`.**
  Les routes lues par `requireAuth()` exigent le Bearer ; celles de
  `PROTECTED_API_PREFIXES` (`/api/tiles`, `/api/ref`, `/api/map/pois`…) sont
  d'abord filtrées par `middleware.ts`, qui lit le COOKIE et ignore le
  Bearer. `@supabase/ssr` range la session en cookies au format de
  l'application React, et l'intercepteur `jetonInterceptor` pose le Bearer.
  Vérifié au navigateur le 2026-09-29 : `/api/ref/geo` 200 par le
  seul cookie — et l'autre moitié de la preuve, sans laquelle la première ne
  prouve rien : appelé SANS Bearer, `/api/risques/sites/compter` répond 401 ;
  il ne répond 200 dans la page que parce que `jetonInterceptor` l'ajoute. Les
  deux routes sont donc bien protégées par des mécanismes DIFFÉRENTS, chacun
  nécessaire.
- ⚠ **Ordre de démarrage (état du 2026-09-30).** Il n'y a PLUS
  d'`APP_INITIALIZER` : le shell AIDA n'exécute pas `app.config.ts`. Le
  démarrage vit dans `DemarrageService` (`core/demarrage/`), déclenché par le
  garde `demarrageGuard` de la route racine de `remoteRoutes`, donc dans les
  deux modes : polices (`magelian-polices.css`, dans le document) et feuille
  globale `magelian.css` (lue et CONSTRUITE, jamais posée dans le document —
  voir « Isolation CSS » plus bas), PUIS configuration, PUIS session. `ConfigService` lit `config.local.json` À CÔTÉ de l'application
  distante (voir « ressources » plus bas), par un `HttpClient` construit sur
  `HttpBackend` et non sur le `HttpClient` injecté : le faire passer par le
  pipeline d'intercepteurs recréerait le cycle `jetonInterceptor` →
  `HttpBaseService.baseUrl` → `ConfigService.valeur`, qui n'est pas encore
  chargée à cet instant précis. `AuthService` n'est construit qu'après la
  configuration : un `inject()` posé après cet `await` est hors contexte
  d'injection (NG0203), d'où l'injecteur capturé à la construction de
  `DemarrageService` et rejoué via `runInInjectionContext`. Un démarrage en
  ÉCHEC n'est pas gardé : la navigation suivante retente — y compris vers une
  page ENFANT (menu du shell), la route racine portant
  `runGuardsAndResolvers: 'always'` : sans lui, le routeur réutilise la route
  racine sans rejouer son garde (revue finale du lot AIDA). Une racine d'ombre
  créée PENDANT un échec sur `magelian.css` adopte la feuille quand la relance
  la construit (effet sur `feuille()`, `monterRacineOmbre`). **Les polices ne
  sont PAS bloquantes**, à l'inverse de `magelian.css` : un échec de
  `magelian-polices.css` laisse démarrer l'application sur les polices système
  (fin des piles `--font-sans`/`--font-mono`) avec un `console.warn` qui nomme
  le fichier. Couvert par
  `angular/src/app/app.config.spec.ts` (lancement autonome, sans rien mocker
  côté configuration/HTTP) et `angular/src/app/remote.spec.ts` (`remoteRoutes`
  seules, sans `app.config`).
- ⚠ **Fin de session en cours de page.** Le garde de route (`authGuard`) ne
  s'exécute qu'À LA NAVIGATION : un jeton de rafraîchissement révoqué ou un
  cookie expiré PENDANT qu'une page est déjà ouverte la laissait bloquée sur
  son état d'erreur, sans aucun moyen d'en sortir. Un 401 de l'API
  (`sessionExpireeInterceptor`, enregistré après `jetonInterceptor`) termine
  la session LOCALEMENT (`AuthService.deconnecter('locale')`), sans naviguer ;
  un `SIGNED_OUT` de GoTrue la met à null. **`AuthService` ne navigue plus**
  (lot AIDA, 2026-09-30) : c'est `RacineDistanteComponent` qui en tire la
  conséquence selon `STRATEGIE_SANS_SESSION` (voir « Sans session » plus
  bas) — renvoi vers `/connexion` avec la page à reprendre en autonome,
  message dans un hôte. L'erreur continue de remonter vers la page pour que
  son état de chargement se résolve.
- **La clé anon n'est dans aucun fichier suivi** : `npm start` (et
  `npm run config`) écrit `angular/public/config.local.json` depuis
  `.env.development.local`, lu à l'exécution par `ConfigService`.
- **Remote app AIDA — Native Federation (lot « AIDA — Conformité »,
  2026-09-30).** L'application est une *remote app* au sens de la doc AIDA :
  - **Dépendances.** `@angular-architects/native-federation` **21.2.1** et
    `es-module-shims` **1.10.1**, épinglés exacts — le second est exigé par le
    runtime de fédération (polyfill des import maps, `type=module-shim`).
    `@softarc/native-federation-node` (ajouté par le schématique, SSR seul) a
    été retiré.
  - **`angular/federation.config.js`** : `name: 'magelian'` (à aligner sur le
    nom attendu par AIDA), `exposes: { './Routes': './src/app/app.routes.ts' }`,
    `shareAll({ singleton: true, strictVersion: false })`, `rxjs/ajax|fetch|
    testing|webSocket` en `skip`, `ignoreUnusedDeps`. Le build publie
    `remoteEntry.json`, que le shell référence dans son manifeste.
  - **Cibles d'`angular.json`** : `build` et `serve` passent par le builder
    fédéré, qui délègue à `esbuild` (`@angular/build:application`, la vraie
    configuration du bundle) et à `serve-original` (`@angular/build:dev-server`,
    proxy `/api`). ⚠ `test` pointe `buildTarget: magelian:esbuild:development`
    et NON la cible `build` : le builder de tests unitaires ne sait pas lire le
    builder fédéré, et le laisser par défaut ne produisait qu'un avertissement,
    les tests tournant alors sans les vraies options.
  - **`main.ts` → `initFederation()` puis `import('./bootstrap')`** ; un échec
    de chargement du chunk d'amorçage affiche `afficherErreurDemarrage` au lieu
    d'une page blanche.
  - **`angular/.npmrc`** (registre `@gdo-rd-france` sur GitHub Packages,
    `${NPM_GITHUB_TOKEN}`, plus `legacy-peer-deps=true`) : conservé, il fonctionne SANS le jeton — `npm ls`,
    `npm ci --dry-run` et `npm run config` passent (mesuré le 2026-09-30) tant
    qu'aucun paquet `@gdo-rd-france` n'est installé.
  - **`src/environments/environment.ts`** : `slug: ''`. Le slug est FOURNI par
    le siège et ne s'invente pas.
  - **Services d'API** : chacun HÉRITE de `HttpBaseService`
    (`core/http/http-base.service.ts`), qui hérite de
    `MechaRemoteAppHttpBaseService` — pour l'instant une DOUBLURE PROVISOIRE
    (`mecha-remote-app-http-base.provisoire.ts`, importée sous l'alias
    `MechaRemoteAppHttpBaseService`), le paquet `@gdo-rd-france/mecha-lib-ui`
    exigeant le jeton. `baseUrl` = origine de l'API (`config.local.json`, vide
    = origine du document) + `/api` ; `urlAbsolue()` pour MapLibre, dont le
    worker ne résout pas une adresse relative. Le jour où le paquet est
    installé, l'import de `http-base.service.ts` change — mais ce n'est QUE le
    point 2 de la « liste de bascule » ci-dessous. Garde :
    `tests/unit/angular/modele-aida.test.ts`.
  - ⚠ **Règle de fourniture des services d'API (revue finale du lot AIDA)** :
    chaque `*.api.ts` est `@Injectable()` **SANS `providedIn`** et fourni par
    la route racine de `remoteRoutes` (`FOURNISSEURS_DISTANTS`). Un service
    `providedIn: 'root'` serait construit dans l'injecteur RACINE — celui du
    shell — et recevrait son `HttpClient`, sans aucun de nos intercepteurs :
    les appels partiraient sans `Authorization`, hors du limiteur, sans que
    rien ne le signale. Verrouillé par `modele-aida.test.ts` (avec un
    auto-test sur les cas fautifs).
  - **Liste de bascule vers `@gdo-rd-france/mecha-lib-ui` + slug** — à dérouler
    dans l'ordre, le jour où le siège fournit le jeton et le slug :
    1. poser `NPM_GITHUB_TOKEN`, installer EXACTEMENT
       `@gdo-rd-france/mecha-lib-ui@0.0.81` ; vérifier le lockfile et les
       dépendances pairs (`npm ls`) ;
    2. importer `MechaRemoteAppHttpBaseService` du paquet dans
       `core/http/http-base.service.ts` et supprimer la doublure
       `mecha-remote-app-http-base.provisoire.ts` ;
    3. vérifier la surface RÉELLE de la classe : constructeur (slug) ;
       `httpClient` protégé et issu de `inject(HttpClient)` dans le contexte de
       la SOUS-CLASSE — sinon nos intercepteurs sont contournés : rejouer
       `remote.spec.ts` (Bearer et limiteur) ; un éventuel provider exigé est à
       ajouter à `app.config.ts` ;
    4. sémantique de `baseUrl` : si une passerelle AIDA la fournit,
       `apiBaseUrl` de `config.local.json` devient mort, les tests en
       `startsWith('/api')` passent en adresses absolues, et les tuiles
       MapLibre chargées par cookie sur une autre origine deviennent une
       question ouverte ;
    5. écrire le test du slug (celui d'aujourd'hui éprouve la doublure) ;
    6. renseigner `src/environments/environment.ts` ;
    7. aligner `name` dans `angular/federation.config.js` et la clé du
       manifeste de l'hôte ;
    8. rejouer l'épreuve dans l'hôte PAR DÉFAUT (`ignoreUnusedDeps: true`) :
       les dépendances transitives de mecha-lib-ui sont invisibles à la garde
       des imports partagés ;
    9. vérifier les intercepteurs d'AIDA et l'en-tête `Authorization` (pas de
       doublon avec `jetonInterceptor`) ;
    10. mettre à jour ce document et la feuille de route.
  - **`remoteRoutes` autonome** : le shell ne charge QUE cette constante. Sa
    route racine (`RacineDistanteComponent`) porte en `providers`
    `provideHttpClient(withInterceptors([limiteur, jeton, sessionExpiree]),
    withRequestsMadeViaParent())` et les services d'API — nos intercepteurs
    passent d'abord, puis la requête continue par le `HttpClient` de l'hôte —
    et en `canActivate` `demarrageGuard`. Tous les liens internes sont
    RELATIFS (le préfixe de montage est inconnu). Le lancement autonome
    (`appRoutes`) monte les mêmes routes sous `app` — pages `/app`,
    `/app/catalogue`, `/app/carte` — plus
    `connexion`, qui n'existe que dans ce mode. (`/app/essai-carte`, la page
    de preuve du lot 2, est SUPPRIMÉE depuis le lot 4, T22.)
  - **Sans session : `STRATEGIE_SANS_SESSION`** (`core/auth/strategie-sans-session.ts`,
    2026-09-30, remplace `CHEMIN_CONNEXION`). `{ mode: 'message' }` ou
    `{ mode: 'rediriger', chemin }`. ⚠ **Le défaut RACINE est `message`**,
    parce qu'un hôte ne fournit rien ; la route `app` d'`appRoutes` fournit
    `rediriger` vers `/connexion`. Le jeton est donc lu dans l'injecteur de
    ROUTE — `authGuard`, la coquille (« Se déconnecter »),
    `RacineDistanteComponent` — et par rien de `providedIn: 'root'`, qui ne
    verrait que le défaut : c'est pourquoi `AuthService` ne navigue plus.
    La page `/connexion` et `sans-session.guard.ts`, hors de la route `app`,
    ne le lisent pas : ils n'existent qu'en autonome.
    - **Dans un hôte** : `authGuard` laisse passer, et `RacineDistanteComponent`
      affiche « Session requise — connectez-vous à AIDA pour accéder à
      MAGELIAN. » (`role="status"`) À LA PLACE de son `<router-outlet />`.
      Aucune page n'est créée, donc aucun appel d'API ne part, et l'URL de
      l'hôte ne bouge pas. Quand la session apparaît, l'outlet revient et monte
      la route DÉJÀ activée : la page demandée s'affiche sans renavigation. Un
      401 fait apparaître le même message, sans boucle (les pages sont
      retirées) ; « Se déconnecter » aussi, sans aucune navigation.
      Verrouillé par `remote.spec.ts`.
    - **En autonome** : comportement inchangé — sans session, une page
      protégée renvoie vers `/connexion?redirection=…` ; « Se déconnecter »
      vers `/connexion` ; un 401 ou un `SIGNED_OUT` de GoTrue vers
      `/connexion?redirection=<page courante>`. Ces deux derniers passent par
      UN `effect` de `RacineDistanteComponent`, qui ne part jamais PENDANT une
      navigation (`router.currentNavigation()`, suivie) : ni au démarrage, ni
      pendant la déconnexion de la coquille, qui navigue elle-même sans page à
      reprendre ; il réévalue à la fin de la navigation. Démarrage en échec :
      ni message ni redirection, l'erreur prime. Verrouillé par
      `app.config.spec.ts` (routes réelles) et `racine-distante.component.spec.ts`.
  - **Garde des imports partagés** (`tests/unit/angular/imports-partages.test.ts`,
    2026-09-30). Hors `*.spec.ts`, les imports À L'EXÉCUTION vers `@angular/*`
    sont limités à `core`, `common`, `common/http`, `router`,
    `platform-browser`, plus `forms` dans `features/connexion/` seulement.
    Raison : un hôte généré par défaut (`ignoreUnusedDeps: true`) ne partage
    que ce qu'il utilise, et une entrée secondaire qu'il n'utilise pas est
    chargée depuis le remote avec sa propre copie des morceaux privés de
    `@angular/core` — c'est ce qui faisait lever `NG0203` à
    `@angular/core/rxjs-interop`. Analyse par l'AST TypeScript (commentaires
    et `import type` ignorés, `import()` dynamiques inclus). **rxjs-interop
    est retiré** : `versEtat` repose sur `signal` + `subscribe` +
    `DestroyRef.onDestroy` (même comportement, `NG0203` nommant `versEtat`
    hors contexte d'injection, et `NG0602` dans un contexte réactif —
    `assertNotInReactiveContext`, comme `toSignal`), l'essai de carte se
    désabonne explicitement.
  - **Ressources résolues contre l'application distante, jamais contre le
    document** : `urlRessourceDistante()` + `BASE_RESSOURCES`
    (`core/ressources/`), base = `import.meta.url` — valable parce que le build
    est PLAT (chunks, `magelian.css`, `maplibre.css`, `config.local.json` dans
    le même dossier). `magelian.css` (Tailwind + jetons), `magelian-polices.css`
    (les seules `@font-face`) et `magelian-document.css` (autonome seulement)
    sont émises en paquets paresseux `inject: false` ; leur chargement est
    décrit à la puce « Isolation CSS ». Le logo est un SVG inline, en teal
    exact.
  - **Thème** : voir la puce « Thème » plus bas — il SUIT la classe de
    `<html>`, y compris posée par le shell.
- Le `tsconfig.json` et l'`.eslintrc.json` de la racine EXCLUENT `angular/` :
  leur `**/*.ts` compilait sinon le projet Angular avec la configuration Next.
- ⚠ **Le `.gitignore` racine porte une exception pour `angular/`** :
  `!angular/src/**/data/` — son motif `data/` (déjà utilisé pour exclure
  `app/api/radio/data/`, voir § « RLS — DORMANTES ») aurait sinon avalé
  silencieusement `angular/src/app/features/*/data/`.
- **Composants de base (lot 1, 2026-09-29)** dans `angular/src/app/ui/` : `mg-kpi`, `button[mgPastille]`, `mg-champ`, `th[mgTh]`/`td[mgTd]`, `mg-fil-etapes`, `mg-fil-ariane`, `mg-reglette` (validée au RELÂCHEMENT, jamais par pixel), `mg-barre-progression` + `[mgPerime]` alimentées par un `ChargementService` fourni par l'écran. Tous GÉNÉRIQUES : le vocabulaire du risque arrive au lot 3 en les configurant. Démonstration : page `/catalogue` (`/app/catalogue` en autonome depuis le lot AIDA). ⚠ **Portés depuis les primitives MAISON du module risque, pas depuis shadcn/ui** — inventaire du 2026-09-29 : aucun des 35 fichiers de `components/risques/` n'importe un composant shadcn.
- **Bandeau KPI et courbe au rendu de React (lots Rendu R8 et R10, 2026-10-03)** : `mg-bandeau-kpi` (`angular/src/app/ui/bandeau-kpi/`) est le conteneur de `BandeauKpi.tsx` — fond `--bg-level-2`, traits de 0,5 px haut et bas, `10px 20px`, écart 26, retour à la ligne ; les `mg-kpi` sont projetés (valeur d'accent teal par `accent`, périmée par `mgPerime`), la consigne de fin et sa définition en infobulle sont facultatives. `mg-kpi` pose le libellé à `text-[12px]` : le `text-xs` de Tailwind 4 impose un interligne de 16 px là où React hérite 1,5 (18 px). `mg-courbe` rend désormais `OngletRayonInfluence.tsx` : courbes lissées (`smooth` + `smoothMonotone: 'x'`, le `monotone` de Recharts), traits 2,2 / 1,3, grille horizontale seule pointillée 2 4, deux axes et leurs graduations en `--border-default`, graduations en JetBrains Mono 10, graduations X imposées (`graduationsX`, `customValues`), repère teal tireté 3 3 SANS libellé, marges de Recharts (62 / 20 / 54), légende sous un trait fin avec la VALEUR au repère (`valeurLegende`), note de lecture projetée (`[mgNote]`), étiquettes au kilomètre sur la série `etiquetee` (halo `--bg-level-1`). ⚠ **L'infobulle d'ECharts est plate par construction (V7)** : elle porte par défaut `shadowBlur: 10` et un bord de 1 px ; l'option pose `shadowBlur/offset: 0`, `extraCssText: 'box-shadow:none'`, bord 0,5, rayon 6, fond `--card-overlay`, et un `formatter` HTML (libellés ÉCHAPPÉS — ils viennent de l'API) qui reproduit l'infobulle de Recharts. Les étiquettes vivent sur une série INVISIBLE à part (`etiquettes:<cle>`, silencieuse, hors infobulle) : la courbe totale garde son point de survol. Mise en forme des nombres : `core/format/nombre.ts` (copie de `lib/format/nombre.ts`, mêmes sorties). Écrans de comparaison : `.superpowers/sdd/2026-09-30-angular-lot-rendu/R8R10-*.png`.
- **Icônes `mg-icone` (lot Rendu R1, 2026-09-30)** : `angular/src/app/ui/icone/`, SVG en ligne, **zéro dépendance**. Les 58 tracés (34 avant le lot 3 : 29 au lot Rendu R9, plus `cadenas`, `cadenas-ouvert`, `agrandir`, `reduire` et `grille` en R11 ; puis dix au lot 3 : `plus`, `chevron-gauche` et `chevron-droite` en T11, `enregistrer`, `copier`, `corbeille` et `dossier-ouvert` en T13, `colis-coche` et `rafraichir` en T14, `jouer` (lucide `play`) en T16 ; puis sept au lot 4, T1, pour le rail de la carte : `etincelles` (retirée le 2026-10-12, lot 5), `porte-voix`, `entonnoir`, `fiole`, `formes`, `reglages`, `aide` ; puis `info` (lucide `info`, Feather) au lot 4, T3, pour les annonces de la carte ; puis `gomme` (lucide `eraser`) au lot 4, T4, pour « Tout effacer » ; puis `loupe` (lucide `search`, Feather) au lot 4, T5, pour la recherche des listes du panneau Filtre ; puis `fichier-bas` (lucide `file-down`) et `musique` (lucide `music-2`) au lot 4, T14, pour les exports DV360 et TikTok des zones ; puis `tourner-gauche` (lucide `rotate-ccw`) au lot 4, T15, pour « Répartir au prorata » — 58 au total avec ceux du lot 6, `etincelles` retirée, compte relevé par les deux tests) sont copiés de `lucide-react` v1.7.0 dans `icones.ts` (table lucide PascalCase → nom Angular en tête ; licences ISC **et** MIT de Feather reproduites, icônes Feather marquées `feather: true`). Chaque entrée nomme son fichier lucide (`lucide: '…'`) et `tests/unit/angular/icones-lucide.test.ts` la compare attribut par attribut : toute dérive échoue. `NomIcone` est dérivé des clés, un nom inconnu ne compile pas. Mêmes défauts que lucide : `taille` 24, `trait` 2. **Règle de portage : recopier les props React une à une** — `size={16} strokeWidth={1.5}` devient `[taille]="16" [trait]="1.5"` (la barre latérale, l'accueil et le changement de thème sont à 1,5) ; `className="shrink-0"` devient `class="shrink-0"` sur `<mg-icone>`. Aucune valeur n'est devinée par le composant. Vérifié au pixel contre React (14/16/20 px, traits 1,5 et 2 : écart 0). **Ajouter une icône** : lire `__iconNode` de `node_modules/lucide-react/dist/esm/icons/<nom>.js`, ajouter l'entrée (nom français, `feather: true` si le nom est dans la liste de la LICENSE), la voir dans la planche de `/app/catalogue`, relever le compte du test. Remplaçable par `mecha-lib-ui` le jour venu.
- **Logo dentsu (2026-10-08)** : `mg-hexagone`, les jetons `--logo-accent` / `--logo-lettre` et `magelian-icon.svg` sont SUPPRIMÉS. `mg-logo` et `components/ui/LogoDentsu.tsx` recopient en ligne les six tracés de `public/dentsu-logo.svg` (fichier officiel dentsu, `viewBox` 3840 × 812) en `currentColor` ; `mg-marque` = logo 20 px + signature, sans hexagone. Favicon : `dentsu-favicon.svg` (le « d » seul, noir ou blanc selon `prefers-color-scheme`). Fidélité verrouillée par `tests/unit/design/logo-dentsu.test.ts`. Le paragraphe suivant décrit l'état ANTÉRIEUR, gardé pour l'historique de la parité.
- **Marque `mg-hexagone`, `mg-logo`, `mg-marque` (lot Rendu R2, 2026-09-30, remplacé le 2026-10-08)** : `angular/src/app/ui/{hexagone,logo,marque}/`. `mg-hexagone` porte les DEUX hexagones dessinés à la main dans `AppSidebar.tsx` (ce ne sont pas des icônes lucide) : `variante="marque"` (28 px, `:170-190`, teal de marque par jeton, remplissage 6 % en `fill-opacity`, aucun littéral) et `variante="cta"` (15 px, `:223-226`, `currentColor`). `mg-logo` prend `[hauteur]` (18 px, barre) OU `[largeur]` (240 px, connexion) ; `viewBox` 1600 × 360 inchangé. `mg-marque` est l'en-tête complet de la barre (hexagone + logo + signature « Geospatial intelligence », cadre `px-4 pt-5 pb-4`) que la coquille (R3) pose tel quel. Deux jetons : `--logo-accent` (#2aa9a8, invariant : le fichier `magelian-icon.svg` porte #2AA9A8 sur deux accents et #2AA8A7 sur le troisième, 1/255 d'écart, un seul jeton ; le teal de marque s'en écartait de 36/255) et `--logo-lettre` (#0d1316 en clair, valeur du fichier ; `var(--text-primary)` en sombre), ajoutés à `globals.css` ET `jetons.css` et documentés dans `DESIGN_SYSTEM.md`. `[hauteur]` et `[largeur]` de `mg-logo` sont exclusives (erreur en mode dev). Vérifié au pixel contre React, conteneurs posés sur des pixels entiers : hexagone et signature écart 0, en-tête 86,5 px de haut comme React, logo 240 px en clair écart max 7/255 (aucun pixel au-delà de 8). Résidu de l'en-tête (clair) : 3 pixels (max 85/255) à la pointe de l'étoile du logo 18 px, qui se reproduit avec la MÊME balise `<img>` du MÊME fichier posée dans la page Angular — ni la couleur, ni le SVG en ligne, ni un décalage ne l'expliquent : c'est la rasterisation de l'image d'une page à l'autre. ⚠ **Seul écart volontaire, défaut de React** : en thème sombre React affiche le logotype quasi invisible (lettres noires sur fond sombre) ; Angular garde les lettres à la couleur du texte.
- **Coquille = `AppSidebar` + `TopRightChrome` + `MainPadding` (lot Rendu R3, 2026-09-30)** : `angular/src/app/layout/`. `mg-barre-laterale` recopie `navItems` (`layout/navigation.ts`) : mêmes quatre sections, ordre, libellés (orthographe React comprise, « Systeme », « Qualite des donnees »), icônes 16 px trait 1,5, badges « Admin »/« Sys ». ⚠ **React ne filtre AUCUNE entrée par rôle** (le contrôle vit dans les routes) : Angular non plus. Une entrée dont l'écran n'est pas porté a `cible: null` et se rend à l'identique mais INERTE (`aria-disabled`, infobulle « Disponible prochainement », sans `href`) ; le bouton « MAGELIAN » aussi (lot 5). **Liens de développement (Accueil, Catalogue, Module risque — « Essai carte » retiré au lot 4, T22) et pied « Online » : hors production seulement** — les liens sont des ICÔNES de 20 px, sans écart, dans la rangée du pied (quand ils étaient quatre, à 24 px + 2, le dernier poussait l'horloge hors des 208 px du pied : 226 px mesurés) (`LIENS_DEVELOPPEMENT`, titre et `aria-label` = libellé, lien actif visible), et non une section du `nav` : cette section le faisait déborder (barre de défilement de 6 px que React n'a pas, colonne rétrécie de 216 à 210 px, badges décalés de 6 px), décidé par UN jeton, `MODE_DEVELOPPEMENT` (`core/environnement/`, défaut `isDevMode()` — dans un hôte, celui du `@angular/core` partagé, donc le mode du shell). `mg-chrome-haut` (bascule de thème par `ThemeService.basculer()` seul — règle `ECRIRE_HTML` —, puis `mg-badge-session` : sélecteur d'organisation + menu utilisateur, rôle lu par `AuthService.lireRole()` sur `profiles` comme `useSession`) est posé dans une rangée `sticky top-0` de hauteur nulle, en tête du conteneur défilant de la coquille (jamais `fixed`) : comme le `fixed` de React il reste visible au défilement ET s'arrête à gauche de la barre de défilement de la page (positions mesurées identiques à React : bascule 1036,7, dernière flèche 1422). Menus et tiroir rendus DANS la racine d'ombre ; fermeture par Échap et appui extérieur via `layout/fermeture.ts` (`composedPath()` : un écouteur de document voit sinon l'hôte de la racine comme cible). Petit écran : barre masquée, bouton Menu, tiroir `absolute` avec voile, piège de Tab, focus rendu au bouton. **Service d'API `OrganisationsApi`** (`features/session/data/organisations.api.ts`, GET `/api/user/organizations`, POST `/api/user/switch-org`), fourni par `FOURNISSEURS_DISTANTS`. Après un changement d'organisation, React fait `window.location.reload()` — dans un hôte, cela rechargerait le SHELL : la coquille recrée à la place la page courante (génération de l'outlet), sans toucher à l'URL. Contenu `p-8` (les pages ne posent plus de marge). ⚠ **Échelle des rayons alignée sur React** (`angular/src/styles.css`, `@theme`) : `--radius-sm` 2 px, `--radius-md` 4 px, `--radius-lg` 6 px (`tailwind.config.ts` : `--radius` 0,375rem moins 4/2/0), et non 4/6/8 comme Tailwind 4 par défaut. Tous les `rounded-sm/md/lg` d'Angular suivent donc React (accueil, catalogue, connexion, pastille : 2 px plus petits qu'avant). Écarts voulus, défauts de React : pas d'ombre sous les menus ni de flou sur l'icône de thème (flat total) ; à 375 px le chrome de React recouvre et rend INCLIQUABLE le bouton Menu — Angular le garde au-dessus ; un lien suivi ferme le tiroir. Vérifié au pixel (colonne 240 × 900, 1440, dev masquée, horloge masquée) : **clair, 20 pixels à 1/255, aucun au-delà** ; sombre, seul le logotype diffère (écart R2). Dans l'hôte jetable : tableau de fuite **0 différence**, 0 propriété sur `<html>`, menus dans le cadre et dans la racine d'ombre, feuille hostile sans effet sur la coquille.
- **Écrans plein écran hors coquille (lot Rendu R4, 2026-10-03)** : `carte` (lot 4) et son enfant `risques` (lot 3 ; `essai-carte`, la première, est supprimée depuis le lot 4, T22) sont des routes SŒURS de `mg-coquille` dans `remoteRoutes`, comme `/map` en React (`AppSidebar.tsx:348`, `MainPadding.tsx`, `TopRightChrome.tsx` : ni barre, ni chrome, ni marge). Elles restent sous `RacineDistanteComponent` (fournisseurs, racine d'ombre) et `authGuard` : sans session, message dans un hôte, redirection vers `/connexion` en autonome — aucun appel d'API. Chaque page occupe `h-full` de la racine et porte une croix « Fermer » (lien RELATIF `..`), faute de barre. L'entrée « Explorer » de la coquille mène à la carte (lien relatif résolu contre la route de la coquille, de chemin vide). Pied de barre : la rangée des liens de développement ne grandit plus avec ses boutons (`-my-1` ; 20 px depuis le lot 3), séparateur à y = 859 comme React (1440 × 900). Tests : `remote.spec.ts`, `app.config.spec.ts`.
- **Connexion en écran partagé (lot Rendu R5, 2026-10-03)** : `angular/src/app/features/connexion/`, portage de `app/login/page.tsx` — formulaire 50/50 à gauche (logo 240 px, champs `--bg-level-2`, bord 0,5, focus en BORDURE `--brand-teal-50`, œil, encart « Mot de passe oublié ? », erreur en encart `danger` 10 %/20 % avec icône, bouton blanc au survol `--cta-hover`, spinner à l'envoi), vitrine à droite (grille d'hexagones, accroche, quatre chiffres : constante nommée `VITRINE` dans `vitrine.ts`, **dette** : React les écrit en dur, ils sont repris tels quels). Nouveau jeton `--cta-hover` (#d4d4d4, invariant) dans `globals.css`, `jetons.css` et `DESIGN_SYSTEM.md`. ⚠ **« Inscription » est rendu à l'identique mais INERTE** (`aria-disabled`, « Disponible prochainement ») : `AuthService` n'a pas d'inscription. ⚠ Écarts voulus, défauts de React : sous 768 px le formulaire prend toute la largeur (React le laisse à 50 % de l'écran, soit ~187 px à 375 px, vitrine masquée) ; messages d'identifiants en français (`messageErreurConnexion`). Champs à `9px 12px` comme React (DESIGN_SYSTEM § 5 dit 8px : la parité l'emporte). Le démarrage en échec s'affiche dans le même encart d'erreur, à la place du formulaire.
- **En-têtes et tableau de bord (lots Rendu R6-R7, 2026-10-03)** : `angular/src/app/ui/{entete-section,entete-page,tuile-chiffre}/`. `mg-entete-section` = `.geo-section-header` (`globals.css:527-550`, DESIGN_SYSTEM § 5) : bandeau `--bg-level-2`, trait haut de 1 px, point teal de 6 px, libellé Inter 500 12 px ; `repliable` ajoute le chevron (icônes `chevron-bas`/`chevron-haut`, lucide `chevron-down`/`chevron-up`, 14 px) et en fait un bouton (`ouvert` en `model`). Les coins sont laissés au parent (`class="rounded-t-lg"`), comme React les pose en ligne. `mg-entete-page` = bloc d'en-tête de `app/dashboard/page.tsx:104-114` (h1 18 px, interlettrage −0,02 em, sous-titre 13 px tertiaire ; remplace `tracking-tight` = −0,025 em, V9). `mg-tuile-chiffre` (nom ≠ `mg-carte`, la carte MapLibre) = carte de chiffre du tableau de bord : icône teal 20 px, valeur mono 15/500, libellé 12 tertiaire, `16px 18px`, bord 0,5, rayon 6, survol du bord ; `cliquable` ajoute le curseur main (aucun soulèvement : celui de React est annulé par son animation `slideUp … both`, le rendu n'en a pas). L'accueil (`features/accueil/`) reprend `/dashboard` : en-tête, trois cartes de session depuis le 2026-10-12 (« geo.prompt / Copilote IA » retirée, lot 5 de la suppression de l'IA) (`AuthService.lireProfil()` = rôle et nom du profil, comme `fetchProfileEnrichment`), « Navigation rapide » (cinq cartes INERTES, « Disponible prochainement » : leurs écrans ne sont pas portés ; « Accès », qui remplace « Organisations » le 2026-10-10 comme côté React, ouvre `admin/acces` par lien RELATIF) ; le compte des sites à risque, propre à Angular, est posé SOUS cette disposition — et sa tuile ouvre le module risque (lien RELATIF `risques` qui l'enveloppe, tuile `cliquable` ; lot 3, T18). **Focus clavier global** (`styles.css`) aligné sur `app/globals.css:1223` : `outline: none` et anneau `box-shadow 0 0 0 1px var(--brand-teal-50)`, dans `@layer base` — comme React, où cette règle (0,1,0) perd contre `.focus-visible:ring-*` ; non étagée, elle battrait les utilitaires Tailwind 4 et effacerait l'anneau propre d'un composant. La pastille passe sa transition par `var(--ease-out)` (R12).
- **Logique pure du module risque (lot 3, T1, 2026-10-03)** : `angular/src/app/features/risques/logique/` COPIE onze fichiers de `lib/risques/` (profil, code-profil, dimensions, gravites, etape, etat-url, affectation, libelle-classe, exploration, kpi, palette-natures), mêmes exports et mêmes signatures, sans dépendance Angular — `angular/` n'importe rien hors d'`angular/` (décision P6). Seul écart de forme : `normaliserProfil` valide à la main (`ProfilInvalide`) au lieu de Zod (arbitrage A12), mêmes règles, mêmes messages pour les bornes, dans le même ordre. ⚠ Le React `lib/risques/` est GELÉ (P5) ; `tests/unit/angular/risques-logique-paritaire.test.ts` compare sorties ET levées des deux jeux et échoue si la copie dérive. `palette-natures` rend des `var(--nature-n)` : valable pour le DOM, à traduire en nom de jeton pour ECharts.
- **Logique pure zones, simulation et carte (lot 3, T2, 2026-10-03)** : même dossier, huit fichiers (`seuils-naturels`, `opacites-zones`, `nature-zone`, `zooms`, `cercle`, `palettes-donnees`, `jeu`, `palette-divergente`) et `logique/simulation/` (sept : `vue`, `alignement`, `alignement-campagne`, `payload`, `types`, `entrees`, `parametres`). Copies sans couleur d'interface — les teintes de zone et de divergence restent des jetons ; **seule exception, A10 : `palettes-donnees.ts` recopie en hexadécimal les six échelles de DONNÉES de `CARREAUX_PALETTES`** (identiques dans les deux thèmes), verrouillées par `risques-logique-carte-paritaire.test.ts`. `jeu.ts` n'a ni Zod (A12) ni normalisation : le type `JeuDeZones` est écrit à la main et le test vérifie qu'il passe le schéma de React. `simulation-paritaire.test.ts` compare `construireVue` (v1, v2, tout), `courbeAlignement`, `constats` et `etatSite` sur `fixtures/simulation-reponse.json` — ⚠ fixture SYNTHÉTIQUE (40 codes postaux, 5 bassins), produite par les fonctions pures du générateur et du recalage de React, non capturée sur une pile vivante.
- **Services d'API du module risque (lot 3, T3, 2026-10-03)** : `angular/src/app/features/risques/data/`, tous `@Injectable()` SANS `providedIn`, héritiers de `HttpBaseService` et fournis par `FOURNISSEURS_DISTANTS` : `SitesRisqueApi` (`compter` avec filtres), `ZonesRisqueApi` (`preparer`, `urlTuilesZones`, `sites`, `courbe` avec natures), `ProfilRisqueApi` (`bandes`, `cibles`, `exportProfil`, `exportRayon`), `ReferentielApi` (`geo`, `contours`), `JeuxZonesApi` (jeux, `cpGeo`, `grappes`, extractions, exports) et `SimulationApi` (`lire`, `simuler`/`recaler` en NDJSON, `purger`, `carte`, export). Les formes de requête reprennent celles des hooks React : mêmes noms de paramètres, même ORDRE, un paramètre optionnel absent quand sa liste est vide (`natures`, `parent`, `region`, périmètre) — les specs vérifient `params.keys()` et la valeur DÉCODÉE des natures accentuées. ⚠ `HttpParams` encode l'espace en `%20` et garde la virgule, là où `URLSearchParams` écrit `+` et `%2C` : le serveur relit la même valeur ; pour les exports, `URLSearchParams` est converti paire par paire (jamais `fromString`, qui réencoderait un `+` en `%2B`). **NDJSON par `HttpClient`** (`core/http/ndjson.ts`, `lignesNdjson`) : requête `observe: 'events', reportProgress: true, responseType: 'text'`, lecture du `partialText` cumulé aux seules lignes terminées, puis du reste à la réponse finale (dernière ligne sans saut de ligne comprise) ; une ligne illisible est ignorée, comme `lireFlux` de `ContexteSimulation.tsx`. Passer par `HttpClient` plutôt que par `fetch` garde le limiteur de 3 appels, le jeton et la détection de session expirée. **Téléchargement par blob** (`core/http/telecharger.ts`) : React pointait trois exports par un `<a href>` nu, qui part SANS le jeton porteur que `requireAuth` exige ; la réponse est donc lue en blob par `HttpClient` (`observe: 'response'` pour l'en-tête `Content-Disposition`), puis `enregistrerFichier` clique une ancre DÉTACHÉE — jamais insérée dans `document.body`, garde `portails-hors-ombre` — et révoque l'URL d'objet une seconde plus tard (et non au tour suivant : certains navigateurs lisent l'URL après le retour de `click()`). `nomDeFichier` lit `filename="…"` (React) et `filename*=UTF-8''…`. `/api/ref/geo` reste au cookie seul (middleware) : le Bearer ajouté est sans effet.
- **Écran du module risque — route, état d'URL, squelette (lot 3, T4, 2026-10-03)** : route PLEIN ÉCRAN `risques` (`/app/risques` en autonome) sous `remoteRoutes`, sœur de la coquille, gardée par `authGuard` — et non un overlay `position: fixed` comme `AnalysePopulationOverlay.tsx` (interdit dans la racine d'ombre, arbitrage A1). `RisquePage` (`features/risques/risque.page.{ts,html}`) fournit ses services d'ÉTAT (`ChargementService`, `EtatRisqueService` ; A13 — détruits avec l'écran). **État d'URL par le `Router` (A2)** : `EtatRisqueService` (`features/risques/etat/`) lit `?risque=` à la construction (`lireEtatUrl`, qui ne lève jamais : `onglet=territoires`, `fusion=oui`, profil illisible ou `jeu=` non-UUID donnent un état partiellement récupéré) PUIS à chaque `?risque=` qui diffère du dernier écrit (écoute de `route.queryParamMap`, désabonnée par `DestroyRef` — l'écran étant réutilisé, un lien suivi depuis l'écran ouvert changeait sinon l'URL sans changer l'état), et reflète chaque changement par `router.navigate([], { relativeTo, queryParams: { risque }, queryParamsHandling: 'merge', replaceUrl: true })` — jamais `history.replaceState`, le routeur appartenant au shell dans un hôte. Même paramètre unique et même encodage que React (`PARAM_RISQUE`, `ecrireEtatUrl`) : une URL React se colle telle quelle ; ⚠ **`departement%25253A13` dans l'adresse n'est PAS un encodage de trop** (vérifié le 2026-10-04, relecture T13 → T14) : c'est la forme que React écrit lui-même — `encodeURIComponent` sur chaque élément de liste (`encoderListe`), puis la chaîne interne de `ecrireEtatUrl`, puis le paramètre externe. Le `Router` n'y ajoute rien : mesuré au navigateur côte à côte, territoire Provence-Alpes-Côte d'Azur posé dans les deux écrans sur le même jeu, `location.search` IDENTIQUE à l'octet ; et `etat-risque-url-react.spec.ts` le verrouille avec le VRAI routeur (`RouterTestingHarness`) sur quatre états — département 13, région 93 puis département, natures accentuées avec espaces, virgules et parenthèses, profil délié + jeu + atelier + fusion — dans les deux sens (écrire, puis coller l'URL React). Aucune URL Angular « héritée » n'a donc jamais divergé ; ne PAS ajouter de décodage tolérant, qui lirait autrement que React une URL que React aurait produite. le défaut retire le paramètre ; un alias hérité est réécrit une fois sous sa forme courante ; `replaceUrl` : « retour » quitte l'écran. ⚠ **Une navigation de requête RÉUTILISE l'écran** (même route) : ni le composant ni la carte ne sont recréés, et le garde de démarrage rejoué par `runGuardsAndResolvers: 'always'` ne relance rien (`remote.spec.ts`, `risque.page.spec.ts`). En-tête de React (point teal, titre, `mg-fil-ariane`, `mg-fil-etapes` alimenté par `etapesAffichees` — `commandes/etapes.ts` —, cible, croix). **Fermer** (croix et Échap, A7) navigue vers le parent RELATIF ; Échap est écouté sur l'HÔTE de l'écran (`tabindex="-1"`, focalisé à l'ouverture — test du focus par `getRootNode().activeElement`, `document.activeElement` valant l'hôte de la racine d'ombre), jamais sur `document`. ⚠ **Règle : un gestionnaire d'Échap INTÉRIEUR (tiroir, menu) appelle `preventDefault()`** ; `fermer` ignore un Échap déjà consommé (`defaultPrevented`) — c'est ce qui remplace la pile Échap de React, non portée. Corps : panneau d'étape (480 px, poignée 320-900 px par capture de pointeur sur elle-même, écoute sur l'élément et non `window`) et `mg-vue-cartes` (`cartes/vue-cartes.component.ts`, cadre de `VueCartesZones.tsx` : interrupteur Rayons / Codes postaux, ce dernier désactivé sans jeu ; vue dédoublée à ④ avec un jeu ; « Carte seule », masqué à ④-avec-jeu et ⑤ — le repli ne vaut donc que là où son bouton existe, `panneauReplie`, sans quoi le panneau restait replié sans moyen de le rouvrir). ⚠ **Règle : la carte ne se démonte JAMAIS** — aucun `@if` autour de `mg-carte` ; ce qu'on ne regarde pas garde `visibility: hidden` et une largeur nulle, jamais `display: none`, comme le panneau replié ; la carte de diffusion de ⑤ n'est montée qu'à la première visite, puis gardée — c'est un TEXTE PROVISOIRE jusqu'à T17, pas encore une instance MapLibre. Barre commune, bandeau KPI, couches de carte et panneaux d'étape arrivent en T5-T17 (textes provisoires d'ici là). Largeur, repli et `apercuRayon` restent LOCAUX (ils ne changent aucun chiffre).
- **Données partagées, barre commune et bandeau KPI du module risque (lot 3, T5, 2026-10-03)** : `features/risques/etat/donnees-risque.service.ts` (`DonneesRisqueService`, fourni par `RisquePage` à côté de `ChargementService` et `EtatRisqueService`, détruit avec l'écran) porte ce que `AnalysePopulationOverlay.tsx` et ses crochets `use-bandes`/`use-courbe-rayon`/`use-sites-compte` chargeaient : cibles et référentiel géo (UNE fois par écran, échec silencieux comme React), contours par échelle (cache, T12), bandes (anti-rebond **400 ms**), courbe, compte des sites (indépendant du profil), plus `profilCalcul`, `rayonMaxProfil`, `courbeTotale`, `perime` et un second calcul de bandes `requeteExploree` → `bandesExplorees`, qui ne part que si la requête est non nulle — depuis T11 un `computed` de l'exploration de ③, nul hors exploration. ⚠ **Règles d'I/O** : chaque chargement dépend d'une CLÉ TEXTE (`computed` sérialisé), poussée dans un `Subject` par un `effect` (pas de `toObservable`) puis `switchMap` — un nouveau réglage ANNULE l'appel en cours (abandon réel, et le limiteur rend sa place), l'attente de 400 ms vit DANS le `switchMap` : l'écran montre le résultat du DERNIER réglage, jamais de la dernière réponse arrivée. Basculer « Lecture des zones » ne change aucune clé, donc zéro appel (mesuré au navigateur). Pistes de chargement aux libellés EXACTS de React. ⚠ **Territoire dans l'URL (A3)** : `etat.chemin` (`region:93`, `departement:13`) est résolu contre `/api/ref/geo` ; un élément sans préfixe ou inconnu est ignoré ; tant que le référentiel n'a pas répondu, aucun calcul ne part (il partirait sur la France entière) — sauf si AUCUN élément n'est bien formé (`13`, `commune:13055` : ignorés de toute façon, l'attente ne servirait à rien) ; référentiel en échec, l'élément est gardé sous son code, et un code bien formé mais inconnu (`region:99`) part tel quel : c'est le SERVEUR qui le valide. La région part dans `region`, jamais dans `parent` (sql/171). La maille « Lister par » reste LOCALE (A4, `mailleChoisie`, `null` = maille naturelle). `commandes/barre-commune.component.ts` (`mg-barre-commune`) : Cible (`<select>` natif groupé par famille), Lister par (infobulles mot pour mot), Territoire (`code — nom`), Nature de la zone et Niveau réglementaire (au moins un gardé), Lecture des zones ; les réglettes y seront projetées en T6. `commandes/bandeau-kpi-risque.component.ts` (`mg-bandeau-kpi-risque`, sur `mg-bandeau-kpi`) : les six chiffres, notes et infobulle mot pour mot de `BandeauKpi.tsx`, « — » tant que la donnée manque, estompé par `[mgPerime]` ; absent à l'étape ⑤ (BandeauCampagne, T16). Vérifié au navigateur contre React, même état : défaut 14 103 578 · 22,1 % · 1 259 / 1 259 · 1 927 · — · +555 930 ; département 13 + Commune 388 272 · 20,2 % · 66 / 66 · 46 · 37,0 % · +19 194 ; 3 requêtes `/api` simultanées au plus.
- **Réglettes de rayon, tiroir des anneaux et résumé du profil (lot 3, T6, 2026-10-03)** : trois composants dans `features/risques/commandes/`. `mg-reglette-rayons` (portage de `RegletteRayons.tsx`, sur `mg-reglette`) est projeté dans `mg-barre-commune` : une réglette par niveau RÉGLABLE (seuils haut et bas — « Autres régimes » n'en a pas, le pré-calcul ne le mesure pas), UNE seule « Tous les niveaux » cadenas fermé, et le cadenas aux infobulles mot pour mot. Elle déplace le BORD (`poserRayonExterieur`, qui le garde au-dessus du dernier anneau intérieur) ; les anneaux intérieurs sont rappelés en gris (infobulle portée par la nouvelle entrée `titreComplement` de `mg-reglette`). ⚠ **Le calcul ne part qu'au RELÂCHEMENT** : `apercu` (`ApercuRayon`, niveau `null` cadenas fermé) à chaque position, `profil` seulement à la validation — mesuré au navigateur, **0** requête `/api/risques/profil/bandes` sur 20 positions, **1** au relâchement, l'URL ne change qu'alors. L'aperçu reste un signal LOCAL de l'écran (`apercuRayon`, relayé à la carte en T8), jamais dans l'URL. `mg-panneau-profil` (`PanneauProfil.tsx`) est le tiroir des anneaux, ouvert par `etat.atelier` sous la barre, DANS LE FLUX (ni portail ni `position: fixed`), 340 px au plus : chips des anneaux (infobulle « Bande n : … habitants » depuis `bandes.par_classe`), paliers 500 m / 1 / 2 / 5 km, saisie libre bornée 100-10 000 m, cadenas, case PPRT ; chaque geste passe par `normaliserProfil` ; un cinquième anneau est refusé avec un message. **Échap DANS le tiroir le referme sans fermer l'écran** (`preventDefault`, règle de `fermer`), et rend le focus à l'élément qui l'avait OUVERT — la chip réellement cliquée (relecture T8, corrigé en T10), à défaut la première chip, puis l'hôte. `mg-resume-profil` (`ResumeProfil.tsx`) est dans l'en-tête : une chip par niveau ayant des anneaux, « liés », « PPRT à part · n classes » ; une chip bascule le tiroir. Icône `plus` ajoutée (35 tracés). Vérifié au navigateur contre React, même état : bord du seuil haut glissé à 2 km et relâché (le bord est tenu à 2,1 km, au-dessus de l'anneau de 2 km, des deux côtés) → 4 207 636 · 6,6 % · 1 259 / 1 259 · 1 244 · — · +604 190 au rayon de 2 100 m, et la même URL (`profil=h1000.2000.2100_b500.1000_a_L0_P1`).
- **Carte permanente du module risque — zones et trois régimes de zoom (lot 3, T7, 2026-10-03)** : `features/risques/cartes/carte-risque.component.ts` (`mg-carte-risque`, portage de `CarteRisque.tsx`) remplace le `mg-carte` provisoire de `mg-vue-cartes`, qui lui relaie `profil` (le profil CALCULÉ), `natures`, `gravites`, `fusionner` (`etat.fusionner`) et `apercu` ; sortie `carte` (l'instance, pour la liaison des caméras en T15). Mobilier de `CarteRisque.tsx` : trois raccourcis de grappes (`GRAPPES`, vue d'ouverture = Étang de Berre, `fitBounds` animé 800 ms), légende (`mg-legende` + `mg-legende-niveaux`, seuls les niveaux qui portent un anneau), bandeau « Zoomez pour voir les zones… » sous **z7**, pastille « Découpage des zones… » (et piste de chargement au même libellé). Les couches vivent dans `cartes/couches-zones.ts`, fonctions pures testées sur la carte factice : `poserCouchesZones` (source vectorielle `atelier-zones`, plancher 4, et quatre couches `-fond`/`-contour`/`-pprt`/`-etiquettes` sur la couche de tuile `zones_risque`), `retirerCouchesZones` (couches AVANT la source, sinon `removeSource` lève et l'ancienne source reste), `repeindreCouchesZones`, `basculerCouchesZones`. **Trois régimes** par `minzoom` de COUCHE : rien sous 7 ; de 7 à 10, aplat fondu par niveau (`expressionOpaciteSelonZoom(10)`) et contour PLEIN des PPRT ; au-delà, opacité par bande, contour TIRETÉ et étiquette de rayon le long du contour (`symbol-placement: line`), composée côté client depuis le PROFIL (`expressionEtiquetteClasse` : la tuile ne porte pas le rayon). ⚠ **Trois effets, trois dépendances** : la CLÉ `codeZonesRisque(codeProfil(profil), natures)` (une chaîne : un aller-retour d'étapes ou un nouveau tableau au même contenu ne relance rien) → `preparer` PUIS source et couches, une nouvelle clé annulant la préparation en vol (relecture T7 : la préparation part DÈS LE MONTAGE, en parallèle du chargement du fond comme React, et les couches attendent `load` ET la clé courante préparée — `codePrepare`, une seule pose par clé, revenir à la clé déjà posée ne relance rien) ; le THÈME → `setPaintProperty` seul (aucune source recréée, aucune tuile redemandée — React, lui, recréait la source et repréparait à chaque bascule de thème : défaut corrigé) ; `fusionner` → `setLayoutProperty('visibility')` seul, la visibilité à la CRÉATION lisant `fusionner` sous `untracked` (l'équivalent de `fusionnerRef`). Couleurs par `CouleursService` (`niveau-*`, `halo-carte`), jamais `var()` dans `paint`. Préparation en échec : la source est posée quand même (React : « la carte reste utilisable ») mais le message est AFFICHÉ (React le taisait). `CarteFactice` gagne `getLayer`, `removeLayer`, `removeSource` (qui lève si une couche utilise la source, comme MapLibre), `setLayoutProperty`, `isStyleLoaded`. Tests : `couches-zones.spec.ts`, `carte-risque.component.spec.ts`, `risque.page.spec.ts` (allers-retours ②↔③↔④ : UNE préparation, aucune couche retirée ; `fusion=0` : couches nées masquées). Vérifié au navigateur contre React, même état (`etape=rayon`, raccourci « Étang de Berre » puis ±1 cran) : un `preparer` 200 puis tuiles `zones-risque` 200 en **gzip** ; bascule de thème → `fill-color` passé de `#e0603f` à `#b8431f`, **0** `preparer` et **0** tuile redemandée, comme après quatre changements d'étape ; rendu identique à React à z6 (bandeau), z8 (aplats fondus) et z11 (bandes, tirets, étiquettes « 1 km », « 2 km », « 5 km », « PPRT »), deux thèmes. Les sites et les cercles du mode site par site arrivent en T8.
- **Carte permanente du module risque — sites, survol, site par site, aperçu (lot 3, T8, 2026-10-04)** : `features/risques/cartes/couches-sites.ts`, fonctions pures testées sur la carte factice — `poserCouchesSites` (quatre sources GeoJSON vides posées au `load`, du dessous au dessus : `atelier-cercles` en `line` tireté coloré par `niveau`, `atelier-apercu`, `atelier-survol`, puis les points `atelier-sites-points` colorés par `gravite`), `repeindreCouchesSites`, `basculerCerclesSites`, `cerclesDesSites` (plafond `CERCLES_MAX` = **400 CERCLES**, et non sites — un site du seuil haut en porte jusqu'à quatre), `cerclesApercu` (`APERCU_SITES_MAX` = 250 sites, un disque par site au rayon réglé, `niveau: null` = niveaux liés), `cerclesSurvol` ; tous par `cercleGeoJSON` (64 segments) et `anneauxDuNiveau`, **aucune requête**. `mg-carte-risque` charge les points par `chargerParCadre` sur la bbox VISIBLE (`ZonesRisqueApi.sites`, premier chargement IMMÉDIAT puis anti-rebond 350 ms aux seuls `moveend` — relecture de T8, corrigée en T10 —, requête précédente annulée, `limite=800`, `gravites`/`natures`), relancé (donc immédiatement) quand les filtres changent — jamais sur le thème (React refaisait la requête à chaque bascule). ⚠ Écart BÉNIN, assumé : l'aperçu de rayon dérive des sites CHARGÉS, il suit donc leur rechargement (un panoramique pendant un glissement de réglette redessine l'aperçu sur les nouveaux sites) ; légende « · N sites affichés » ; popup au clic par `contenuPopup` (textContent, libellés de React : nom puis statut · ville · nature) via le nouveau jeton `FABRIQUE_POPUP` (`carte/fabrique-carte.ts`, popup dans le conteneur de la carte, donc dans la racine d'ombre) ; survol → anneaux du site au profil courant, curseur ; les cercles du site par site et l'aperçu DÉRIVENT des sites déjà chargés. Couleurs par `CouleursService` : `niveau-*` et le nouveau jeton **`--contour-point`** (cerne des points et cercles de survol, la valeur de `CONTOUR_POINT`, inversée entre thèmes — ajouté à `app/globals.css` ET `styles/jetons.css`, `DESIGN_SYSTEM.md`). ⚠ **Les zones s'insèrent SOUS les sites** (`poserCouchesZones(…, { avant: ID_CERCLES })`) : chez React l'ordre dépendait de qui répondait le premier, et à chaque changement de profil les zones recréées passaient au-dessus des points et des cercles de survol — écart volontaire. ⚠ Défauts React corrigés : points, cercles, aperçu et survol n'étaient JAMAIS repeints au changement de thème (lecture du code : pose gardée par `getSource`, points en `setData` seul) ; un échec de chargement des sites était tu (message affiché, points précédents gardés). `CarteFactice` gagne `getCanvas`. Tests : `couches-sites.spec.ts`, `carte-risque.component.spec.ts`. Vérifié au navigateur contre React (`etape=rayon`, raccourci « Étang de Berre », deux thèmes) : **58 sites affichés** des deux côtés, popup identique (« COMPAGNIE PETROCHIMIQUE DE BERRE SAS — Seveso seuil haut · Berre-l'Étang · GPL et produits pétroliers »), **0** requête au clic « Site par site », aperçu pendant le glissement (6,9 km) identique ; captures `T8-carte-sites-*`.
- **Étapes ① Sites et ② tableau des bandes du module risque (lot 3, T9, 2026-10-04)** : trois composants de PRÉSENTATION, sans aucun appel — ils lisent ce que `DonneesRisqueService` a déjà chargé, relayé par `risque.page.html` (le compte de sites et les bandes sont les MÊMES objets que ceux du bandeau KPI et du tiroir ; aller-retour ① ↔ ② : zéro appel). `etapes/sites/panneau-sites.component.ts` (`mg-panneau-sites`, portage de `PanneauSites.tsx`) : KPI « sites retenus » (22 px, accent) et sa note « sur <territoire> — le total porte le même territoire » ; barre empilée par nature (`partsDeNature` : 7 natures + « Autres natures »), largeurs calculées sur les EFFECTIFS et non sur les parts arrondies, teintes `var(--nature-n)` posées dans le DOM ; légende = liste des effectifs ; écart natures ↔ retenus signalé ; « Aucun site ne passe les filtres… » mot pour mot (`MESSAGE_AUCUN_SITE`) ; « Comptage des sites… » pendant le calcul, jamais un zéro ; échec dit. `etapes/rayon/etape-rayon.component.ts` (`mg-etape-rayon`, `OngletRayons.tsx` sans la courbe) : KPI total, un par niveau qui porte des anneaux (déduit de `par_classe`), carreaux classés ; « Classement des carreaux… » au PREMIER calcul seulement (pendant un recalcul, les chiffres précédents restent et s'estompent — `[mgPerime]` est désormais posé sur le panneau d'étape entier, comme le `<Perime>` de React) ; 409 `a_construire` → encadré d'avertissement en jetons (`color-mix` sur `--warning`) et `node scripts/construire_carreau_risque.mjs` en mono, autre échec → encadré de danger ; emplacement `<ng-content select="[emplacement-courbe]">` pour la courbe de T10 (l'attribut s'appelait `courbe`, renommé en T10 : il entrait en collision avec l'entrée `courbe` du composant projeté), sous sa note de lecture. `etapes/rayon/tableau-bandes.component.ts` (`mg-tableau-bandes`, `TableauBandes.tsx`) : PPRT puis bandes du cœur vers l'extérieur, cumul calculé côté client, trait plein (servitude publiée) / tiretés (bande calculée) en jetons, total « tous niveaux » (la somme des bandes l'égale EXACTEMENT : rien n'est réarrondi entre la base et l'écran), phrase du hors-zone. ⚠ Cellules propres (Th 11 px, Td 12 px), et NON `th[mgTh]`/`td[mgTd]` : React n'utilise pas ici les cellules génériques d'`elements.tsx`. Tests : `panneau-sites.component.spec.ts` (réponse mesurée, 14 natures), `tableau-bandes.component.spec.ts`, `etape-rayon.component.spec.ts`, `risque.page.spec.ts` (compte partagé, un seul appel ; bandes partagées, bascule ① ↔ ② sans nouvel appel). Vérifié au navigateur contre React, même état, deux thèmes : ① 1 259 / 1 259, Toxicité aiguë 502 (39,9 %) … Autres natures 27 (2,1 %) ; ② 14 103 578 = 13 585 817 + 517 761, 215 646 carreaux, 26 980 106 hors zone ; seuil bas décoché : 13 585 817 et 206 970 carreaux des deux côtés ; département 13 + Commune : 66 / 66, 388 272 = 361 669 + 26 603, 5 835 carreaux ; captures `T9-*`.
- **Étape ② courbe de couverture et exports du module risque (lot 3, T10, 2026-10-04)** : `etapes/rayon/courbe-rayon.component.ts` (`mg-courbe-rayon`, portage d'`OngletRayonInfluence.tsx` sur `mg-courbe`) est projeté dans `mg-etape-rayon` et lit `DonneesRisqueService.courbe` (chargée UNE fois par écran : revenir sur ② ne relance rien). Curseur LOCAL (défaut 1 km) : le bouger relit la série en mémoire — **zéro appel** mesuré au navigateur sur trois positions, rien dans l'URL. Quatre KPI (point le plus proche SANS dépasser, part du total à 10 km, sites et départements, incrément de la courbe `'*'`), case « Afficher les étiquettes (tous les 1 km) », légende cliquable (masquer une nature retire sa série), note « « Toutes natures » n'est pas la somme des autres courbes » et, quand les natures sont filtrées, l'avertissement `total_est_global`. Bandeau « Pré-calcul partiel » sous 99 % (`couverture_pct`), squelette au premier chargement, 409 `a_construire` → message expliqué + `node scripts/construire_couverture_rayon.mjs` (jamais une courbe plate). ⚠ **Couleurs ECharts par NOM DE JETON** : totale `brand-teal` (« Toutes natures »), natures `nature-1…8` recyclées modulo 8 comme React (`jetonNature`, dérivé de `TEINTES_NATURE`) ; jamais `var()` ni hexadécimal dans les options, `mg-courbe` les lit par `CouleursService` et REPEINT au changement de thème (vérifié : traits de grille `#1a1a1a` → `#e5e5e5`, zéro appel). `ReponseCourbe` (`zones-risque.api.ts`) porte désormais `total_est_global`, `couverture_pct`, `n_bandes_construites`, `n_zones_lointaines` (optionnels). `exports/bouton-export.component.ts` (`mg-bouton-export`, générique : `libelle`, `charger: () => Observable<HttpResponse<Blob>>`, `nomRepli`, `libelleEnCours`, `titre`, `variante` teal/neutre, `desactive`) : désactivé et « Préparation… » pendant, nom de fichier lu dans `Content-Disposition`, corps d'erreur JSON lu DANS le `Blob` et affiché en rouge (`messageExport`). Il sert « Export Excel » du rayon (paramètres de `BoutonExportRayon.tsx`, rayon du curseur au clic) et « Exporter le profil » dans l'en-tête (paramètres de `BoutonExportProfil.tsx`, profil CALCULÉ, désactivé sur un profil sans anneau). Les deux passent par `HttpClient` (Bearer, limiteur) ; `enregistrerFichier` est exposé par le jeton `ENREGISTRER_FICHIER` (`core/http/telecharger.ts`), couture des specs. ⚠ **A8 vérifié au navigateur** : les trois `<a href>` d'export de React (`/api/zones/jeux/[id]/export`, `…/extractions/[version]/export`, `…/simulation/export`) répondent **401 « Authentification requise. »** — le défaut est réel ; les exports de T10, eux, utilisaient déjà `adminFetch` côté React. Deux corrections de `mg-courbe` / `optionCourbe`, mesurées contre Recharts : graduations Y RONDES (`graduationsRecharts`, 0-60 M par 15 M pour 42 409 940 ; 0-32 M par 8 M « Toutes natures » masquée — ECharts traçait 0-50 M) ; infobulle triée par CLÉ de série (`'*'` d'abord, « GPL » avant « Gaz ») et, retournée, bornée au coin de la zone de tracé (62 px, haut de grille). ⚠ **Contenu projeté sous un `@if`** : Angular CRÉE le contenu projeté même quand l'emplacement n'est pas rendu, donc ECharts s'initialisait sur un élément DÉTACHÉ, y posait `position: relative` en ligne et la classe `absolute inset-0` perdait — graphique haut de 0 px, sans erreur. Corrigé deux fois : la page n'instancie `mg-courbe-rayon` que sous le même `@if` que l'emplacement, et `mg-courbe` dimensionne son conteneur en `h-full` (indifférent à ce style en ligne). Vérifié au navigateur contre React, même état, deux thèmes : 1 647 943 à 1 km (3,9 %, 42 409 940 au maximum, 1 259 sites, 98 départements, +353 301), 25 261 303 à 5 km, infobulle à 1 km et à 5 km identique ligne à ligne, natures « Toxicité aiguë » : 502 sites + avertissement ; classeurs téléchargés depuis les deux écrans : `rayon-influence-seveso-2026-10-03.xlsx` (7 onglets) et `profil-risque_departement_2026-10-03.xlsx` (4 onglets), mêmes onglets et mêmes sommes de cellules. Captures `T10-*`.
- **Étape ③ tableau de couverture et exploration locale du module risque (lot 3, T11, 2026-10-04)** : `etapes/couverture/tableau-couverture.component.ts` (`mg-tableau-couverture`, portage de `TableauCouverture.tsx` : trois KPI, classes triées par population et libellées par `libelleClasse`, tableau unité / cible / Part / Densité sur `th[mgTh]`/`td[mgTd]` — les `Th`/`Td` d'`elements.tsx` que React emploie ici —, « — » et jamais 0 sans dénominateur, notes, liste vide ou tronquée, commande de construction sur un 409 `a_construire` seulement) et `etapes/couverture/etape-couverture.component.ts` (`mg-etape-couverture`, le tableau plus le fil local « Exploration : … — le filtre Territoire de la barre, lui, n’a pas bougé. » mot pour mot). Trois gestes distincts : clic sur la ligne = SÉLECTION (`selectionCarte`, pour la mini-carte de T12), flèche droite = DESCENDRE, flèche gauche = REMONTER ; les flèches sont de vrais `<button>` (clavier, anneau de focus global), grisées et non masquées aux extrémités. ⚠ **L'exploration vit dans `DonneesRisqueService`, hors URL et hors `etat`** (`exploration`, `actif`, `selectionCarte`, `mailleTableau`, `requeteExploree` en `computed`, `bandesTableau`) et non dans le composant de ③, que le `@switch` des étapes démonte : React la garde, avec son calcul, à travers un aller-retour ② ↔ ③. Elle n'écrit JAMAIS `etat.chemin` : l'URL et le bandeau KPI ne bougent pas en descendant (vérifié au navigateur). Le second calcul ne part que pendant une exploration (0 appel au retour à la racine). Survol et sélection effacés à chaque changement de niveau, filtre Territoire compris (mineur T5 ; homonymes région/département, sql/171). ⚠ **Défaut React corrigé** : React garde l'exploration quand le filtre Territoire change — explorer l'Île-de-France puis choisir les Bouches-du-Rhône affichait « Bouches-du-Rhone › Île-de-France » et « Aucun carreau habité… » ; Angular repart du nouveau territoire. Icônes `chevron-gauche` et `chevron-droite` ajoutées (37). Vérifié contre React, même état : 15 régions identiques ligne à ligne (Île-de-France 3 076 627 · 26 % · 255) ; Île-de-France explorée : 8 départements identiques, KPI du tableau 3 076 629 · 8 · 16 799, bandeau inchangé (14 103 578) ; département 13 + Commune : 46 communes identiques (Martigues 43 756 · 89,6 % · 604), total 388 272. La mini-carte sous le tableau : voir T12.
- **Étape ③ mini-carte, encodages et palettes du module risque (lot 3, T12, 2026-10-04)** : `etapes/couverture/carte-mini-france.component.ts` (`mg-carte-mini-france`, portage de `CarteMiniFrance.tsx`) — **SVG et non MapLibre**, comme React : vue fixe, rien à naviguer, aucun canvas WebGL. Entrées `zones`, `valeurs`, `libelleValeur`, `formater`, `stops`, `mode` (`aplat` pour un rapport, `cercles` proportionnels — l'AIRE suit la valeur — pour un effectif, fond neutre), `codeActif` (survol), `cadrageSur` (sélection) ; sorties `survol`, `clic` (un clic SÉLECTIONNE et recadre, il ne descend jamais). Seuils naturels (Jenks, 5 classes), première teinte de la rampe écartée, gris `--donnee-absente` = « aucune exposition », cartouches pour les seuls territoires lointains EXPOSÉS, infobulle sous la carte, bornes écrites. Projection et cadrage dans `logique/mini-france.ts` (`mercatorX/Y`, `projecteur`, `cadreDe`, `elargir`, `chemin`, `centreDe`, `separerLointains`) : copie des lignes 137-299 de React, qui ne les exporte pas — gel P5 — donc valeurs attendues produites UNE fois par la version React et figées dans `mini-france.spec.ts`. ⚠ **Couleurs par `[style.fill]`/`[style.stroke]`**, jamais l'attribut `fill="var(…)"` ; la rampe est la palette de DONNÉES (A10, défaut `rouge`). ⚠ **La carte lit `bandesTableau` et JAMAIS le calcul global** (défaut React du 2026-09-22, « Aude 26,0 % ») : contours filtrés par `codesDessines`, valeurs ET verdict « encodage indisponible » tirés du même résultat ; vérifié au navigateur, l'Île-de-France explorée dessine ses 8 départements. Encodages Part % / Densité / Effectif (pastilles), palette (six pastilles du catalogue Carreaux) : état dans `DonneesRisqueService` (`encodage`, `palette`), qui survit à un aller-retour ② ↔ ③ comme dans React. Contours : `DonneesRisqueService.contours(scale)`, UNE requête par échelle et par écran (mesuré : une `region` + une `departement` malgré explorations, encodages et mailles) ; maille commune ou code postal → AUCUNE requête et la phrase de React mot pour mot ; au code postal, Part/Densité basculent sur l'effectif ET le disent. Deux écarts voulus à React sur l'attente des contours : changer de maille vers une échelle pas encore chargée affiche « Chargement des contours… » le temps de la requête (React gardait les contours de l'ANCIENNE échelle à l'écran) ; et un ÉCHEC n'est plus gardé — React avalait l'erreur et laissait « Chargement des contours… » tourner sans fin, Angular affiche « Contours indisponibles » et évince l'échelle du cache, redemandée au prochain changement de maille qui y revient (`ContoursMaille`, relecture T12, corrigé en T14). Les cartouches d'outre-mer (Martinique 02, La Réunion 04) sont bien dans le DOM et visibles, mais SOUS le bas de la mini-carte à 1440 × 900 : on y arrive en faisant défiler le panneau, comme le reste de la légende. ③ empile tableau et mini-carte (`max-h-[55%]`, `border-t-fin`), chacun avec sa marge : le panneau de `risque.page.html` ne pose plus de marge à l'étape ③. `DonneesRisqueService.oublierUnite()` devient public : « Lister par » (barre commune) oublie survol et sélection, une région 93 désignant sinon la Seine-Saint-Denis. Pendant un recalcul, les deux flèches du tableau de ③ sont grisées (les lignes affichées décrivent le réglage précédent). Vérifié contre React, même état, deux thèmes : mini-carte PIXEL POUR PIXEL identique aux trois encodages, en exploration et en sélection (0 pixel d'écart), valeurs et bornes identiques (Île-de-France 25,997 %, bornes 4,2 · 16,199 · 23,43 · 28,967 · 37,689 %).
- **Étape ④ atelier des jeux de zones du module risque (lot 3, T13, 2026-10-04)** : `features/risques/etat/atelier-jeux.service.ts` (`AtelierJeuxService`, portage de `use-jeux-zones.ts`, fourni par `RisquePage` — A13) et `features/risques/etapes/zones/` : `mg-etape-zones` (portage d'`OngletZones.tsx`), `mg-dilution`, `mg-tableau-classes`, `mg-mode-plan`, `mg-actions-jeu`, `mg-bibliotheque`. Construire reste un geste EXPLICITE (`POST /api/zones/jeux` en brouillon, une vingtaine de secondes, piste `jeu-de-zones` de la barre de progression) ; tout réglage (seuil, poids, mode, enregistrement) passe par `PATCH` puis RELIT le détail, jamais une fusion locale ; un jeton jette la réponse d'un appel dépassé par un plus récent. Le seuil n'est envoyé qu'au RELÂCHEMENT du curseur. KPI visée / taux d'utile / codes postaux recalculés depuis les classes (`population_en_zone_retenue` au numérateur, `—` si rien n'est acheté). `reglage` (signal incrémenté après chaque réglage réussi ET affiché — un réglage dépassé par un plus récent ne compte pas : deux réglages rapides, UN cran, relecture T13) remplace l'événement DOM `magelian:jeu-zones-regle` pour la future carte des codes postaux (A14). ⚠ **Écarts à React, corrigés et listés** : le service vit au niveau de l'ÉCRAN (une construction survit à un changement d'étape ; la bibliothèque n'est lue qu'à la première visite de ④, pas à chaque visite) ; le jeu de l'URL n'est ouvert que quand l'URL CHANGE (React redemandait en boucle un jeu introuvable, et remplaçait un brouillon construit par le jeu de l'URL — mesuré au navigateur : POST, lecture du brouillon, puis relecture du jeu de l'URL ; construire ou « Dupliquer » retire désormais `jeu` de l'URL) ; un poids vidé ou inchangé n'envoie rien, et un poids REFUSÉ (vide, hors bornes) remet le champ au poids en vigueur au lieu de laisser affiché ce qui n'est pas parti ; cliquer le mode de plan déjà actif n'envoie rien ; le curseur de dilution écoute aussi `change` (un relâchement HORS du curseur ne livre pas `pointerup`), sans double envoi du même seuil (relecture T13) — et un nouveau geste (`pointerdown`, `keydown`) oublie le dernier envoi, si bien qu’un PATCH REFUSÉ se réessaie en relâchant au même cran (relecture T14, corrigé en T16) ; l'export passe par `mg-bouton-export` (A8, nouvelle `variante="action"` ; le `<a href>` de React répond 401, mesuré). Double carte (T15) : hors de cette tâche ; le rattachement à une campagne n'existe pas dans l'écran React.
- **Étape ④ extractions figées pour le custom bidding (lot 3, T14, 2026-10-04)** : `features/risques/etapes/zones/panneau-extractions.component.ts` (`mg-panneau-extractions`, portage de `PanneauExtractions.tsx`), monté par `mg-etape-zones` dans sa propre section « Extractions pour le custom bidding », entre le jeu et la bibliothèque (`OngletZones.tsx:360-370` : extraire FIGE un état, ce n'est pas un réglage de plus). Entrées `jeuId` (`null` pour un brouillon ou sans jeu : le message de React, et AUCUN appel) et `cleFraicheur` (`construit_le` du jeu : la liste se RELIT à une reconstruction). Lit `JeuxZonesApi.extractions`, fige par `extraire` (`origine` initiale ou recalage, commentaire nettoyé) puis RELIT la liste ; `deja_extraite` est dit (« Rien n’a changé depuis la vN… ») et n'est ni une erreur ni une création ; la case « recalage » n'apparaît qu'une fois une extraction existante ; un jeton jette la lecture dépassée. Textes, colonnes (version + étiquette recalage + commentaire tronqué, date `fr-FR` jour/heure, seuil, CP retenus / touchés, taux d'utile ou `—`), styles et tailles mot pour mot. ⚠ **Le classeur d'une version passe par `mg-bouton-export`** (A8, nouvelle `variante="lien"` : lien teal sans cadre, Inter, icône 12) : le `<a href>` de React vers `/extractions/[version]/export` répond **401** (mesuré le 2026-10-04 — la route ne lit que l'en-tête `Authorization`). Vérifié au navigateur sur « Seveso France — test phase 4 » : deux versions listées comme React, la v1 téléchargée depuis Angular (`magelian_extraction_seveso-france-test-phase-4_v1.xlsx`, 165 298 octets, 5 feuilles) ; sur un jeu jetable « [TEST] » des Bouches-du-Rhône, construit, enregistré, extrait (v1, 23 / 46 CP, 76,1 %) puis réextrait (`deja_extraite`, aucune v2 en base), supprimé ensuite avec son extraction (cascade). ⚠ Écart de rendu voulu : l'étiquette « recalage » tient sur UNE ligne — chez React, le préflight Tailwind pose `display: block` sur le `svg` de l'icône et casse l'étiquette en trois morceaux dans une cellule étroite. Icônes `colis-coche` (PackageCheck) et `rafraichir` (RefreshCw).
- **Étape ④ double carte — codes postaux, caméras liées, bassins (lot 3, T15, 2026-10-04)** : `features/risques/cartes/carte-codes-postaux.component.ts` (`mg-carte-codes-postaux`, portage de `CarteCodesPostaux.tsx`) et `tableau-grappes.component.ts` (`mg-tableau-grappes`, portage de `TableauGrappes.tsx`), assemblés par `mg-vue-cartes` comme `VueCartesZones.tsx` : rayons à GAUCHE, codes postaux à DROITE à l'étape ④ avec un jeu, bandeau des quatre chiffres (« Codes postaux du jeu / Retenus par le seuil / Taux d’utile / Affichés dans le cadre ») et tableau des bassins dessous, interrupteur Rayons / Codes postaux ailleurs, coloration « Part du plan / Taux d’exposition / Population exposée » (bornes FIXES par variable). ⚠ **Les deux cartes sont montées dès l'ouverture et jamais démontées** (largeur nulle + `visibility: hidden` pour celle qu'on ne regarde pas) : `RisquePage` crée DEUX instances MapLibre (specs `risque.page` et `remote` mises à jour). ⚠ **Caméras liées en double vue SEULEMENT**, par `lierCameras` (lot 2 : verrou de réentrance, `jumpTo` jamais `easeTo`, alignement de la droite sur la gauche à la liaison), déliées dès qu'on quitte ④ — sans détruire aucune carte. Un clic sur un bassin recadre les DEUX cartes (`fitBounds`, marge 40, 600 ms) ; le survol d'un bassin met ses codes postaux en évidence (filtre MapLibre, AUCUNE requête : ils voyagent avec le bassin). ⚠ **`/cp-geo` n'est relu que quand (jeu, réglage, bbox visible) change** : clé `jeu|AtelierJeuxService.reglage()|bbox arrondie` comparée à la dernière chargée ET à celle en vol, AVANT le `switchMap` ; jamais masquée (sa bbox serait celle d'un conteneur nul) ; à l'apparition, `resize()` puis lecture dans un `afterRenderEffect`. **Défaut React corrigé**, mesuré au navigateur sur le jeu « Seveso France — test phase 4 » : React lance **11** `/cp-geo` à l'ouverture de ④ puis **2 de plus en 30 s d'inactivité** (chaque `moveend` relance, y compris ceux d'un `resize` ou d'un `jumpTo` de la carte liée sur le même cadre) ; Angular : 3 à l'ouverture (le cadre change deux fois pendant que l'écran se compose), **0 en 30 s d'inactivité**, 1 par panoramique, 1 par recadrage, 0 pour un aller-retour ④ ↔ ③. `/grappes` est lu **une fois par jeu** (le tableau reste monté, masqué, hors de ④ ; React le relisait à chaque retour). ⚠ **Palette d'un THÈME FIXE (A11) : `CouleursService.paletteDuTheme(jetons, 'clair' | 'sombre')`** lit les déclarations `--x` des RÈGLES de la feuille construite `magelian.css` (`DemarrageService.feuille()`) — bloc `:root, :host` pour le sombre, `html.light, :host(.light)` PAR-DESSUS pour le clair (cascade), en descendant dans les `@layer`/`@media` (`jetonsDuBloc`, exportée), alias `var(--y)` résolus ; repli sur la valeur calculée du thème courant si la feuille est illisible, levée « Jeton de couleur inconnu » sinon. La carte des codes postaux peint donc toujours les `--seq-*` SOMBRES, le gris d'un écarté `--donnee-absente` à 0,28 par `fill-opacity`, le contour des rayons `--niveau-haut` sombre et la surbrillance `--brand-teal`, comme React, sans un hexadécimal recopié ; bascule de thème : elle ne repeint rien, la carte des rayons repeint seule (et garde ses zones, que React perdait). Écarts listés au rapport T15 : contour des codes postaux `--text-tertiary` (#8a8a8a) à 0,55 au lieu du `rgba(120,120,120,0.55)` littéral de React ; nombres de la bulle à la française (« 23,4 % », « 0,123 % »). `PopupCarte` gagne `remove()`, la carte factice `setFilter`/`queryRenderedFeatures`. **Relecture T15 (2026-10-04, T17)** : la surimpression des rayons sur la carte des codes postaux n'est posée qu'une fois CETTE clé préparée par la carte des rayons (`mg-carte-risque` émet `clePrete`, relayée en `cleRayonsPrete`) — mesuré au navigateur, les tuiles `zones-risque` ne partent qu'après la fin de `/zones/preparer` ; le tableau des bassins réserve un créneau FIXE de 190 px dès qu'il est à l'écran (le passage chargement → tableau changeait la hauteur des cartes et coûtait une relecture de `/cp-geo`) ; le taux d'exposition de la bulle passe par `formaterNombre`/`formaterDecimal` (« 23 % », « 23,4 % »). Reste à l'ouverture de ④ UNE relecture de `/cp-geo` : le bandeau KPI de l'écran grandit de 83 à 138 px quand ses chiffres arrivent (consigne repliée sous les tuiles), hors du périmètre de la carte.
- **Étape ⑤ simulation — service NDJSON, panneau, bandeau, courbe annotée (lot 3, T16, 2026-10-04)** : `features/risques/etat/simulation.service.ts` (`SimulationService`, portage de `ContexteSimulation.tsx`, fourni par `RisquePage` — A13) et `features/risques/etapes/campagne/` : `mg-panneau-campagne` (portage de `PanneauCampagne.tsx`) et `mg-bandeau-campagne` (portage de `BandeauCampagne.tsx`, à la place du bandeau KPI à l'étape ⑤ : même `mg-bandeau-kpi`, mêmes `mg-kpi`, on change de question, pas d'écran). ⚠ **UNE seule lecture de la simulation pour tout l'écran** (panneau, bandeau, fil d'étapes, et la carte et le tableau de T17), et **AUCUNE avant la première visite de ⑤** : le service est construit avec l'écran mais inerte jusqu'à `activer()`, appelé par un `effect` de `RisquePage` à l'étape `campagne` ; il se relit quand le JEU change, une réponse d'un autre jeu étant périmée (`reponse` la masque). Simuler et Recaler sont des flux NDJSON lus par `HttpClient` (A9, `lignesNdjson`) : `insertion` → pourcentage et « N / M lignes », `preparation`/`generation` → indéterminé ; un flux fini sans événement final rend « Le flux s’est interrompu avant la fin. » ; un corps d'erreur en TEXTE est relu pour son `error`. Pistes `simulation` (au message du geste) et `simulation-lecture` dans la barre de progression unique. Le flux n'est PAS annulé (React non plus) : l'annuler n'arrêterait rien côté serveur, qui écrit jusqu'au bout une fois la requête reçue, et un retour à ⑤ perdrait l'affichage de la progression d'un travail qui continue ; l'écran fermé n'écrit simplement plus rien. Mesuré au navigateur sur un jeu jetable : 66 événements de progression reçus de 5,6 s à 15,9 s, AVANT la fin du flux — la barre avance réellement ; React et Angular affichent les MÊMES chiffres (jeu « Seveso France — test phase 4 » : 37,3 M impressions, alignement 77, bilan **62 → 89**, partenaires et sites sous-servis identiques ; jeu jetable : 61 → 89). La courbe d'alignement passe par `mg-courbe`, qui gagne des entrées RÉTROCOMPATIBLES : points `[x, number | null]` (trou, `connectNulls: false`, ignoré par l'infobulle et la légende), `marqueurs` par série (`dot={{ r: 2 }}`), `domaineY`, `graduationsY`, `marges` (celles de Recharts ; données, elles remplacent la réserve `mr-2` du conteneur et posent `outerBoundsMode: 'none'` — ECharts 6 rétrécissait sinon la grille pour contenir « j28 », mesuré à 12 px), `grillePleine`, `legende` (masquable), `jetonFondInfobulle`, et `repere.{jeton, jetonLibelle}` avec un libellé AU-DESSUS du trait (`position: 'end'`) ; mesuré contre Recharts, points et graduations à 1-2 px près. v1 en `--diverge-sous-2`, v2 en `--brand-teal`, repère « Recalage v2 ». Aucun badge « Simulation » (arbitrage React du 2026-09-24). « Exporter en Excel » passe par `mg-bouton-export` (A8, nouvelle `variante="panneau"`). `core/format/nombre.ts` gagne `formaterNombreCourt` (« 37,3 M », « 249,8 k », parité verrouillée par `format-paritaire.test.ts`) ; icône `jouer` (lucide `play`). `logique/palette-divergente.ts` gagne `trancheIndice` (−1 sans indice) : ⚠ `trancheDivergente(null)` ne lève pas et rend la tranche **3, « conforme »** — toute couleur tirée d'un écart nullable (carte de ⑤, T17) passe par cette garde.
- **Étape ⑤ carte de diffusion et tableau des zones (lot 3, T17, 2026-10-04)** : `features/risques/cartes/carte-campagne.component.ts` (`mg-carte-campagne`, portage de `CarteCampagne.tsx`) et `features/risques/etapes/campagne/tableau-zones-campagne.component.ts` (`mg-tableau-zones-campagne`, portage de `TableauZonesCampagne.tsx`), montés par `mg-vue-cartes` à l'étape ⑤. ⚠ **TROISIÈME instance MapLibre, montée à la PREMIÈRE visite de ⑤ seulement, puis gardée** (largeur nulle + `visibility: hidden` hors de ⑤, jamais démontée) : avant ⑤, deux instances ; après, trois, et un retour à ② n'en détruit aucune (spec `risque.page`). Trois couches comme React : bassins peints par leur indice de pression (part diffusée ÷ part du plan × 100) sur l'échelle divergente, un cercle par POSITION de code postal (surface ∝ impressions, teal acheté / gris fuite), sites vert / orange / rouge selon `etatSite` ; bascule « Zones / Codes postaux » (l'aplat des codes postaux, même indice au CP) et case « Impressions ». ⚠ **Un indice ABSENT passe par `trancheIndice`** (−1 → gris de fuite), jamais la tranche 3 « conforme » — sur la carte comme dans la pastille du tableau (`--bg-level-3`). ⚠ **Géométrie et chiffres séparés** : `/simulation/carte?bbox=` (et `/cp-geo` en mode codes postaux) sur la bbox VISIBLE par `chargerParCadre` (immédiat, puis 350 ms de calme au `moveend`, requête précédente annulée), seulement carte À L'ÉCRAN, relancé au changement de jeu ou de lecture ; les chiffres viennent de `SimulationService.vue`, fusionnés par la fonction pure `fusionnerDiffusion` puis `setData` — **changer de période ne fait partir AUCUNE requête** (mesuré au navigateur : 0 appel `/api/` pour v1 → v2 → toute la campagne). ⚠ **Palette CLAIRE fixe (A11)** : `paletteDuTheme(JETONS_CAMPAGNE, 'clair')`, lue une fois ; les couleurs voyagent dans les propriétés des entités (`['get', 'couleur']`), jamais `var()` dans `paint` ; une bascule de thème ne repeint rien, ne recrée aucune source, ne relit rien (specs `carte-campagne` et `risque.page`, vrai `ThemeService`). La légende est peinte avec la MÊME palette fixe — **défaut React corrigé** : sa légende suivait le thème (`RAMPE_CSS`, `var(--success)`…) et ne ressemblait plus à la carte en sombre. Bulle au survol par `textContent` (les noms de bassins sont éditables), clic sur un bassin → `zoneActive`, recadrage 600 ms / zoom 11 au plus ; premier cadrage sur les bassins métropolitains (zoom 9 au plus), fait UNE fois et SEULEMENT carte à l'écran (`afterRenderEffect`, `resize()` puis `fitBounds`, drapeau posé après le vrai cadrage — un cadrage à largeur nulle donnait un zoom absurde et bloquait le suivant). **Défaut React corrigé (revue finale)** : une simulation PURGÉE vide les quatre sources ; React gardait à l'écran les bassins colorés et les cercles d'une diffusion qui n'existe plus. Le tableau trie par écart en POINTS DE PART (`|part diffusée − part du plan|`), écarte les zones sans plan, 40 lignes puis « Afficher les N zones » ; un clic sélectionne, un second désélectionne. Mesuré sur « Seveso France — test phase 4 » : les 40 lignes du tableau **identiques à React, caractère pour caractère, pour v1, v2 et toute la campagne**. Écart listé au rapport T17 : le halo des étiquettes prend `--halo-carte` clair (0,85) là où React écrivait `rgba(255,255,255,0.9)` en se disant son miroir.
- **Module risque (lot 3, synthèse, 2026-10-04)** : le module « Population à risque industriel » est porté EN ENTIER — ① Sites › ② Rayon › ③ Couverture › ④ Zones › ⑤ Campagne, état dans l'URL, exports, barre de progression unique ; le module React reste en place (cohabitation jusqu'au lot 7). **Route** : `risques` (`/app/risques` en autonome, `<préfixe>/risques` dans un hôte), plein écran, sœur de la coquille sous `remoteRoutes`, `authGuard`. **Entrées** : le lien de développement « Module risque » du pied de barre et la tuile « Sites à risque industriel en base » de l'accueil (liens RELATIFS) ; React l'ouvre depuis le panneau Calques de `/map`, porté au lot 4. **Services d'état, fournis par l'écran** (détruits avec lui) : `EtatRisqueService` (l'état unique, reflété dans `?risque=`), `DonneesRisqueService` (cibles, référentiel, contours, sites, courbe, bandes, exploration), `AtelierJeuxService` (④), `SimulationService` (⑤, inerte avant la première visite de ⑤). **Cartes permanentes** : une instance MapLibre pour ①-④, jamais démontée ; la carte des codes postaux montée dès l'ouverture à largeur nulle, révélée à ④ (caméras liées) ; la carte de diffusion montée à la PREMIÈRE visite de ⑤ puis gardée — un aller-retour d'étapes ne recrée aucune carte et ne rejoue aucune requête ; une bascule de thème repeint (`setPaintProperty`) sans recréer de source. **I/O** : calcul au RELÂCHEMENT des réglettes, anti-rebond et annulation (le dernier réglage gagne), cache avant appel, bbox = carte visible, limiteur de 3 appels jamais contourné (mesuré dans l'hôte à l'ouverture de ③ : 8 appels, 3 au plus en vol). **Arbitrages** : A1 route plein écran et non overlay `fixed` ; A2 état par le `Router` (`replaceUrl`, relatif), même paramètre et même encodage que React ; A3 le Territoire va dans l'URL (défaut React corrigé) ; A4 « Lister par » reste local ; A5 natures lues dans `etat.natures` (le lot 4 les écrira) ; A6 « Voir sur la carte » absent jusqu'au lot 4 ; A7 Fermer = parent relatif, Échap écouté sur l'hôte ; A8 tous les téléchargements en `blob` par `HttpClient` (défaut React corrigé : trois `<a href>` en 401) ; A9 flux NDJSON par `HttpClient` ; A10 palettes de DONNÉES recopiées en hex (exception documentée) ; A11 couleurs d'un thème fixe lues dans la feuille construite ; A12 profils validés sans Zod ; A13 API dans `FOURNISSEURS_DISTANTS`, état fourni par l'écran ; A14 seuil de ④ propagé par signal. **Parité finale (T18)** : huit états d'URL × deux thèmes (+ 375 × 812 sur l'état par défaut), TOUS les nombres de l'écran identiques à React (multiset complet : de 16 à 320 nombres par état — détail au rapport T18), à UNE exception près, liée à A6 : la légende de la carte annonce « 54 sites affichés » là où React en annonce 55 (61 contre 62 tiroir ouvert) — le site que React compte en plus est celui que son bouton « Voir sur la carte » ajoute, absent jusqu'au lot 4. **Épreuve AIDA (T18)** : hôte jetable PAR DÉFAUT, remote en `ng serve` puis en build de production — page stylée, cinq étapes, URL de l'hôte portant `?risque=`, tuiles 200, 0 différence sur la table de fuite (135 mesures), 0 propriété sur `<html>`, thème piloté par l'hôte, aucune erreur console, export téléchargé, et les flux NDJSON progressent AVANT leur fin (A9 sans repli). ⚠ Cette preuve a été faite derrière le proxy `ng serve` de l'hôte JETABLE : la passerelle réelle d'AIDA n'est PAS mesurée — si elle bufferise les réponses, la barre de Simuler/Recaler restera indéterminée jusqu'à la fin du flux, sans rien casser d'autre. À remesurer à l'hébergement. **Entrées en production AIDA** : le lien « Module risque » du pied de barre n'existe que HORS production (`MODE_DEVELOPPEMENT`) ; dans un shell AIDA de production, la SEULE entrée est la tuile de l'accueil.
- **Logique pure de la carte principale (lot 4, T1, 2026-10-04)** : ⚠ **le rail que cette puce décrit n'existe plus** — `logique/navigation.ts` (la copie du rail) a été SUPPRIMÉ le 2026-10-13 avec le rail, la carte étant devenue un parcours (puces « La carte en parcours » et « parcours en 8 étapes » plus bas) ; ce qui suit est l'état du 2026-10-04. `angular/src/app/features/carte/logique/` a COPIÉ huit fichiers — `lib/navigation/{config→navigation, garde-saisie}.ts`, `lib/carte/{filtre, bbox-requete, degrades, calques-actifs, garde-perimetre}.ts` et `app/map/_components/panneaux/panneau-filtre-logique.ts` — mêmes exports, mêmes signatures, imports relatifs seuls changés. Deux écarts de TYPE dans `navigation.ts` (supprimé depuis) : `icone` était un `NomIcone` (Sparkles → `etincelles`, Megaphone → `porte-voix`, Funnel → `entonnoir`, Layers → `calques`, FlaskConical → `fiole`, Shapes → `formes`, Settings → `reglages`, CircleHelp → `aide`, sept icônes ajoutées à `icones.ts`, 51 au total), et `entreeParRaccourci` recevait un `Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>`. `BBOX_METRO` reste `Object.freeze`. ⚠ **Gel P5 étendu à `/map`** (`app/map/**`, `components/map/**`, `components/custom-geo/**`, `lib/carte/**`, `lib/navigation/**`, `lib/custom-geo/**`, `useMapInit.ts`, `useMapLayers.ts`) : `tests/unit/angular/carte-logique-paritaire.test.ts` compare les sorties des deux jeux (constantes ; entrées du rail hors icône, tracé lucide de chaque icône contre le `displayName` du composant React et raccourcis du rail jusqu'au 2026-10-13, où `navigation.ts` est sorti du test ; garde de saisie, filtre × filtre, bbox, dégradés, garde de périmètre six outils × sept filtres, composeurs du panneau Filtre). ⚠ Le verrou `UnionCouverte` de `calques-actifs.ts` est actif côté Angular aussi (`tsconfig.app.json` inclut `src/**/*.ts`, donc `ng build` type-vérifie la copie même sans consommateur) : vérifié à la main, retirer `'zones-risque'` de `DEGRADE_IDS` fait échouer `ng build` en TS2322. `features/carte/etat/pile-echap.service.ts` (`PileEchapService`, `@Injectable()` sans `providedIn`, à fournir par la page carte — arbitrage B10) reprend `lib/carte/pile-echap.ts` avec un état d'INSTANCE au lieu d'un tableau de module : deux pages n'ont aucune entrée commune ; ré-empiler un id existant remplace sa fonction sans changer sa position ; `etat()` rend une copie.
- **Logique pure des couches, palettes de données et zones (lot 4, T2, 2026-10-06)** : même dossier `angular/src/app/features/carte/logique/`, 20 fichiers de plus — `types-risque` (de `lib/carte/palette-risques.ts`), `familles-icpe`, `pprt` (logique de `palette-pprt.ts`), `iris-echelle`, `versions` (`CARREAUX_TILE_VERSION`, `IRIS_TILE_VERSION`, `IRIS_ZOOM_PLANCHER`, `PPRT_ZOOM_PLANCHER` ; les trois zooms des zones de risque restent dans `risques/logique/zooms.ts`), `fonds` (`MAP_STYLES`), `constantes-calques`, `modes-isochrones`, `palettes-donnees-carte`, et trois sous-dossiers `carreaux/` (normalisation, bornes, expressions), `meteo/` (types, palettes, requete, aggregation) et `zones/` (parse-cp, composition, cibles, source-type-labels). Corps verbatim, imports relatifs seuls changés (`composition` lit `core/format/nombre`) ; aucun zod, aucune dépendance Angular. ⚠ **Les couleurs d'INTERFACE ne sont pas recopiées** : `COULEURS_MAPLIBRE`, `COULEURS_CSS`, `couleurDuType`, `expressionCouleurRisque`, `CONTOUR_POINT` et `COULEURS_PPRT` sont remplacés par des NOMS de jeton (`JETON_TYPE` : `risque-toxique`… `non_precise → donnee-absente` ; `JETON_PPRT` ; `JETONS_NIVEAUX_SANTE`), lus par `CouleursService` — jamais `var()` ni hexadécimal dans un `paint`. Seules les échelles de DONNÉES, identiques dans les deux thèmes, restent en hexadécimal (exception B12, en-tête de `palettes-donnees-carte.ts` et de `constantes-calques.ts`) : catégories de POI, isochrones, Voronoï, bataille, paliers TMJA et teintes radio (littéraux de `paint` de `useMapInit.ts` NOMMÉS ici), échelle d'abstention ; les six palettes de carreaux sont ré-exportées du lot 3 (`CARREAUX_PALETTES` = `PALETTES_DONNEES`, pas recopiées). `librellesDuType` garde la faute de frappe React (parité). Verrouillé par `tests/unit/angular/carte-couches-paritaire.test.ts` (fonction par fonction sur des tableaux de cas, expressions MapLibre en `toEqual`, horloge figée pour la météo, littéraux de `useMapInit`/`CivicIndicatorsLayer` relus dans le source, jetons relus dans `jetons.css`).
- **Écran carte — route, rail, barre du haut, panneau, état, clavier (lot 4, T3, 2026-10-06)** : ⚠ **rail, barre du haut, panneau `mg-panneau-carte` et raccourcis `Alt+1..4` ont été RETIRÉS le 2026-10-13**, remplacés par le parcours (puces « La carte en parcours » et « parcours en 8 étapes » plus bas) : ils sont décrits ici au passé ; la route, les services d'état, `mg-carte`, les libellés français et les annonces restent en place. Route PLEIN ÉCRAN `carte` sous `remoteRoutes` (`/app/carte` en autonome, `<préfixe>/carte` dans un hôte), sœur de `risques` et de la coquille, hors coquille, `authGuard`, avec un outlet enfant VIDE (`children: []`) que T13 remplira du module risque ; l'entrée « Explorer » de la barre latérale y mène désormais (`cible: 'carte'`). `CartePage` (`features/carte/carte.page.{ts,html}`, sélecteur `mg-carte-principale`) fournit ses services d'état — `EtatCarteService` (entrée active, mode immersif, filtre, POI sélectionnés, périmètre, dégradé actif), `CouchesCarteService` (`carteCourante` publiée par `(prete)` puis `null` à la destruction ; registre « Tout effacer »), `PileEchapService`, `AnnonceService` — tous `@Injectable()` sans `providedIn`, détruits avec l'écran. ⚠ **Arbitrage B1** : toutes les `position: fixed` de React (enveloppe, rail, barre, bouton immersif) sont `absolute` dans l'hôte `relative`, mêmes `z-index` relatifs (rail 30 < panneau 40 < barre 45 < boutons 50) ; mesuré au navigateur à 1440 × 900, rail, barre, logo (80 × 18), bascule Campagne / Carte, thème, session, badge de zoom, bouton immersif, contrôle de navigation et panneau (84, 56, 340 px) tombent au pixel près sur React. **Rail** (`rail/rail.component.ts`, retiré le 2026-10-13) : il rendait les entrées de `logique/navigation.ts` (copie verbatim), **l'Assistant retiré AU RENDU** (décision du propriétaire du 2026-10-04 : jamais porté ; `Ctrl+K` n'est pas capté ; l'icône `etincelles` a été retirée depuis ; depuis le 2026-10-12 l'entrée est retirée de la navigation elle-même, voir « Suppression de l'IA — lot 5 ») — donc 7 entrées, 5 en haut, 2 en bas, un seul séparateur ; Campagne était rendue à l'identique mais INERTE (`aria-disabled`, « Disponible prochainement », `Alt+C` sans effet, B6). **Barre du haut** (`rail/barre-haut.component.ts`, retirée, remplacée par `mg-barre-parcours`) : `mg-logo` 18 px, bascule Campagne (inerte) / Carte (pressée), `mg-bascule-theme` et `mg-badge-session` de la coquille. **Panneau** (`rail/panneau.component.ts`, `mg-panneau-carte`, retiré ; son cadre a été repris par `mg-panneau-etape` à T4b) : cadre d'`OverlayPanel.tsx` (340 px, point de couleur `DOT_PAR_ENTREE` en jetons `cat-*`, titre = libellé, croix), restait MONTÉ d'un outil à l'autre (rejouait le « morph » de React), entrée/sortie animées (200 ms avant `fermer`), empilé `'panneau'` dans la pile Échap ; un clic hors du panneau ET du rail le fermait — écouté sur l'hôte de la page, jamais `window` ; contenu provisoire par entrée (T4-T20). **Clavier (B10)** : un seul écouteur `(keydown)` sur l'HÔTE (`tabindex="-1"`, focalisé au montage) : Échap → `fermerLePlusHaut()` (jamais filtré par la garde de saisie ; ignoré s'il a déjà été consommé par `preventDefault()`), `Alt+1..4` → `choisirEntree` jusqu'au 2026-10-13 (aujourd'hui `Alt+1…Alt+8` → étape du parcours) ; la garde lit `composedPath()[0]`, jamais `document.activeElement` (l'hôte de la racine d'ombre). Mode immersif (à T3) : bouton `agrandir`/`reduire`, rail en `translateX(-100%)`, barre retirée, empilé `'rail-masque'` — aujourd'hui `immersif`, voir le parcours. **`mg-carte` gagne trois entrées optionnelles (B11)** : `centre` et `zoomInitial` (fournis ensemble, ils remplacent `cadre` à la création — `cadre` n'est plus `required` mais l'un des deux reste exigé, la carte ne choisit jamais d'elle-même la France entière) et `navigation` (`{ position, boussole }`, défaut haut droite sans boussole) ; la carte principale s'ouvre sur `[2.3, 46.6]` à z5,5, fond Liberty, zoom en bas à droite AVEC boussole, comme `useMapInit.ts`. Badge de zoom en élément du gabarit (B16) : `z<entier>  <palier>` (`palierCarreaux`, cascade de `get_tile`), interligne 20 px recopié de `.maplibregl-map`. ⚠ **Libellés du fond en français** (`logique/libelles-fr.ts`, `franciserLibelles` au `load`) : copie de `patchLabelFrValeur` (`useMapInit.ts:16-33,209-215`) — sans elle, la carte disait « Switzerland » là où React dit « Suisse ». **Annonces (B14)** : `AnnonceService` + `mg-annonce` (`commun/annonce.component.ts`), rendu de la carte `info` de `geo-toast.tsx` (4 s, trois au plus, `role="status"`), en `absolute` en haut à droite de la page ; `EtatCarteService.basculerDegrade` annonce « <libellé> a été masqué — un seul dégradé de couleur à la fois » DANS le geste, jamais d'un `effect`, et `reinitialiserDegrade` (« Tout effacer ») n'annonce rien. Écarts voulus : ni ombre ni flou sous le panneau, la barre et le badge (flat total) ; texte de Campagne en `--brand-teal-fg` (React écrit `var(--background)`, triplet HSL invalide, donc hérite de `--text-primary` : #f0f0f0 sur teal en sombre) ; la barre du haut est retirée en immersif comme React, le badge de session est donc remonté au retour (une lecture `/api/user/organizations`, comme React). Sélecteur compact « FOND » et gomme « Tout effacer » : T4.
- **Fond de carte, Réglages, Aide, Tout effacer (lot 4, T4, 2026-10-06)** : ⚠ **Changer de fond RECRÉE la carte, comme React (B11)** — `mg-carte` est rendu sous `@for (f of [fond()]; track f)` ; `CartePage.fond` porte l'ID du fond (`MAP_STYLES[].id`), lu dans `localStorage['genesis_map_style']` (try/catch, défaut Liberty ; une URL écrite par React est relue comme le premier fond qui la porte) et écrit au choix (`etat/fond-carte.ts`). Le choix publie `carteCourante = null` AVANT la recréation, puis la nouvelle instance au `load`. **Contrat de chaque service de couche** (en-tête de `etat/couches-carte.service.ts`) : un `effect` sur `carteCourante()` qui re-pose ses sources par `quandStyleCharge(carte, poser)` (posé tout de suite ou au `load`, écoute retirée par `onCleanup`), `poser` IDEMPOTENT (teste `getSource`/`getLayer` sur l'instance COURANTE, jamais un drapeau gardé dans le service), et `inscrireEffacement`. **Fond « MAGELIAN »** (`couches/style-magelian.ts`, `appliquerStyleMagelian`) : Positron + les surcharges de `applyMagelianStyle`, posées au `load` et ré-appliquées à chaque bascule de thème ; couleurs par `CouleursService.palette(JETONS_STYLE_MAGELIAN)` — quinze jetons DÉDIÉS `--carte-magelian-*` (`app/globals.css`, `jetons.css`, DESIGN_SYSTEM.md), aux valeurs EXACTES de `MAGELIAN_PALETTE` dans les deux thèmes (revue 1) : le fond ne dépend d'aucun jeton d'interface. ⚠ **Seules les couches du style de FOND sont repeintes** : la page relève leurs ids au `load` (`couchesDuFond`), AVANT toute couche de l'application — sans quoi les règles d'id de React (`symbol`, « catch-all fill », `admin`/`road`…) repeindraient météo, couverture radio ou étiquettes de zones à chaque bascule de thème. ⚠ **Défaut React corrigé** : « Clair » et « MAGELIAN » partagent l'URL Positron ; React suit l'URL, donc les surcharges ne s'appliquaient JAMAIS (l'URL ne contient pas « magelian ») et les deux boutons s'allumaient ensemble — Angular suit l'id. **Réglages** (`panneaux/reglages.component.ts`) : Fond de carte (actif, `aria-pressed`), Apparence (`mg-bascule-theme`, `ThemeService.basculer()` seul), Back office (onze liens INERTES « Disponible prochainement »). **Aide** (`panneaux/aide.component.ts`) : raccourcis dérivés de `ENTREES_NAVIGATION`, sans l'Assistant (retiré de la navigation le 2026-10-12, `Ctrl+K` non capté). **Boutons flottants** (`commun/boutons-flottants.component.ts`) : immersif puis gomme « Tout effacer » 42 px plus bas (`absolute`, B1) ; **sélecteur compact « FOND »** (`commun/fond-compact.component.ts`, `MapPanel.tsx:255-287`) projeté dans `mg-carte`. **Tout effacer** : chaque effacement inscrit, dégradé remis à zéro SANS annonce, périmètre et POI sélectionnés vidés ; le filtre unique reste posé, comme React. Icône `gomme` (lucide `eraser`) — 53 icônes. Recréer la carte la replace sur le centre et le zoom d'ouverture, comme React.
- **Panneau Filtre, puce du filtre unique, pastille du rail (lot 4, T5, 2026-10-06)** : `features/carte/panneaux/filtre/` — `mg-panneau-filtre` (portage de `PanneauFiltre.tsx` + `use-territory-selection.ts`), `mg-perimetre-filtre` (`PerimeterSections.tsx`, mode overlay, avec `mg-entete-filtre` = `FilterSectionHeader.tsx`) et `mg-liste-multiple` (`MultiDropdown.tsx` : liste en `absolute` dans le flux, jamais de portail ; clic extérieur écouté sur la RACINE qui porte le composant, jamais sur le document du shell). Le panneau est RECRÉÉ à chaque ouverture (sous le `@switch` du cadre) et RE-SÈME régions / départements / ville / CP depuis `EtatCarteService.filtre` sans l'écrire ; sélection simple émulée sur le widget multiple ; pastille Métro / +DROM = `perimetreScope` + retrait d'un filtre territorial (`filtreApresChangementScope`, un filtre `zone` survit) ; recherche locale à anti-rebond PAR SETTER (`ANTI_REBOND_RECHERCHE_MS` = 400, 0 au vidage, minuteries abandonnées à la destruction) ; « Périmètre national » = filtre `'france'` sans bbox ; région / département / commune / CP sans bbox (voulu : `bboxPourRequete` repliera sur la métropole). **Référentiel** : `etat/referentiel-geo.service.ts` (`ReferentielGeoService`, fourni par la page) lit `/api/ref/geo` UNE fois par écran via `ReferentielApi` du lot 3 ; un échec est DIT (« Référentiel indisponible », défaut React corrigé : « Chargement… » sans fin) et réessayé à l'ouverture suivante. **Zones enregistrées** : nouveau service d'API `features/carte/data/zones-custom.api.ts` (`ZonesCustomApi.lister`, dans `FOURNISSEURS_DISTANTS`, étendu en T14), UN appel `/api/custom-geo/list?org_id=…&_t=…` par ouverture, organisation ACTIVE lue dans le profil — `AuthService.lireProfil()` rend désormais `organisation` (`profiles.organization_id`, même lecture, aucune requête de plus), et `AuthService.oublierProfil()`, appelé par `mg-badge-session` après un changement d'organisation, la fait relire (React recharge la page). **Puce** `filtre/puce-filtre.component.ts` (`mg-puce-filtre`, portage de `FiltreChip.tsx`) : `absolute`, 56 / 84 px, `z-index` 35 (sous le panneau), croix « Retirer le filtre » ; **pastille** teal 6 px sur l'entrée Filtre du rail (`mg-rail [pastille]`) tant qu'un filtre est posé. Icône `loupe` (lucide `search`) — 54 icônes. Mesuré contre React : mêmes 18 régions, 101 départements du référentiel, mêmes zones de l'organisation, puce au pixel (84, 56, 216,5 × 32).
- **Panneau Calques, carreaux Filosofi et légende unique (lot 4, T6, 2026-10-07)** : `features/carte/panneaux/calques/` — `mg-panneau-calques` (portage de `PanneauCalques.tsx` : « Actifs (n) » avec croix « Masquer … », puis les groupes dans l'ordre de React — Socio-démographie, POI et mobilité, Médias offline, Environnement, Mes analyses (ce dernier groupe retiré le 2026-10-13 : « Mes analyses » est un outil de la boîte à outils, T6 du parcours) ; « Campagne active » absent sans campagne, B6 ; tous repliés et JAMAIS mémorisés, comme React, dont `useFilterSections(true)` est en mode overlay : `localStorage` n'est ni lu ni écrit, logique pure dans `etat/sections-filtre.ts` pour les sections T8-T12), `mg-groupe-calques` (`GroupeCalques.tsx`, badge de compte teal 15 %) et `mg-section-carreaux` (`CarreauxSection.tsx` : l'en-tête allume/éteint la couche, réglages — indicateur en `<optgroup>`, six palettes, opacité, Relief 3D et exagération en multiples de maille — visibles couche active seulement). Groupes autres que Socio-démographie : contenu provisoire jusqu'à T7-T18 ; « Mes analyses » ne lance aucune requête. **Couche** : `couches/carreaux.service.ts` (`CarreauxService`, fourni par la page) + fonctions pures `couches/couche-carreaux.ts` (source `carreaux-mvt`, couches `-fill`, `-extrusion`, `-line`, `useMapInit.ts:924-975`) ; posée à la PREMIÈRE visibilité sur l'instance courante, re-posée sur une carte recréée (B11) avec indicateur, palette, opacité et relief ; indicateur, palette, opacité, palier et hauteur = `setPaintProperty` seulement, ZÉRO requête (mesuré au navigateur : aucune requête au changement d'indicateur et de palette) ; `basculer(true)` réclame le dégradé `carreaux`, l'éviction et « Tout effacer » masquent. Adresse des tuiles par `data/carreaux.api.ts` (`CarreauxApi.urlTuiles`, absolue, `?v=CARREAUX_TILE_VERSION`, aucun appel `HttpClient`, dans `FOURNISSEURS_DISTANTS`). Couleurs de données `CARREAUX_PALETTES` (A10) ; couleurs d'interface par `CouleursService` : `--donnee-absente` (le `COULEUR_DONNEE_ABSENTE` hex n'est plus recopié dans `logique/carreaux/expressions.ts`, mineur T2) et le NOUVEAU jeton invariant `--carreaux-contour` (#555555, le `#555` de `useMapInit.ts`, ajouté à `app/globals.css`, `jetons.css` et `DESIGN_SYSTEM.md`). Catalogue des indicateurs copié dans `logique/carreaux/catalogue.ts` (parité verrouillée). **Légende** : `legende/legende-carte.component.ts` (`mg-legende-carte`, portage de `LegendeCarte.tsx`, `absolute` à `LARGEUR_RAIL + ECART_RAIL_PANNEAU`, `bottom` 12, `z-index` 35, repliable) ; `degradeALegende` exhaustif (`never`) — seul le cas `carreaux` est porté (six paliers cliquables qui filtrent l'opacité par le même découpage) ; jamais de boîte vide ; chaque tâche de couche ajoute son bloc (le bloc des figurés arrive avec T8-T9). Écarts voulus : ni flou ni ombre (flat total) ; fonds `rgba(255,255,255,…)` de React remplacés par `--text-primary` en `color-mix` (visibles en clair), et le survol de `mg-liste-multiple` aussi (mineur T5). Vérifié contre React, deux thèmes, Marseille z5/z8/z12 : couleurs, paliers (« 2.2 – 10.8 » … « ≥ 6.0k » ; revenu « 19k – 21k » … « ≥ 30k ») et relief 3D identiques au pixel.
- **IRIS : section, couche en cascade, panneau de détail (lot 4, T7, 2026-10-07)** : `panneaux/calques/section-iris.component.ts` (`mg-section-iris`, portage d'`IrisSection.tsx`, sous les carreaux dans Socio-démographie : l'en-tête allume/éteint, « ● » couche active ; « Couche IRIS », bandeau « Trop loin pour les IRIS — lisibles à partir du zoom 4 (zX.X) » + « Zoomer » sous le plancher, palier « Affiché Départements / Communes / IRIS » (+ « zoomer pour les IRIS »), « Vrais IRIS uniquement » DÉCOCHÉ par défaut, indicateur en `<optgroup>` depuis `logique/iris-colonnes.ts` — copie verrouillée d'`IRIS_DB_COLUMNS` —, sept palettes `IRIS_PALETTES` (copiées dans `palettes-donnees-carte.ts`, B12), opacité, Relief 3D). **Couche** : `couches/iris.service.ts` (`IrisService`, fourni par la page, même contrat que `CarreauxService`) + `couches/couche-iris.ts` (source `iris-source`, couches `iris-fill`/`iris-border`/`iris-extrusion`, toutes à `minzoom: IRIS_ZOOM_PLANCHER`, posées SOUS les carreaux) ; allumer remonte la caméra au plancher (`easeTo` 800 ms) ; `zoomCourant` relevé à `zoomend`, `niveau` = `niveauAuZoom` ; filtre « vrais IRIS » = `['any', ['!=', niveau, 'iris'], ['==', is_true_iris, true]]` de React ; bornes nationales lues UNE fois par écran (`/api/iris/bornes`), retentées au prochain allumage après un échec ; indicateur et palette = nouvelle expression, ZÉRO requête (mesuré). IRIS et carreaux s'évincent avec annonce. **API** : `data/iris.api.ts` (`IrisApi` dans `FOURNISSEURS_DISTANTS` : `urlTuiles` absolue `?v=IRIS_TILE_VERSION`, `bornes()`, `detail(code)` → `/api/iris/detail?code_iris=`). **Détail** : `couches/detail-iris.component.ts` (`mg-detail-iris`, portage d'`IrisDetailPanel.tsx`) dans le conteneur de la carte, `absolute` à droite, 320 px, `z-index` 50, hors du `@for` du fond ; clic sur `iris-fill` (au palier IRIS seulement : les agrégats ne portent pas `code_iris`), une lecture à la fois (la plus récente annule la précédente) ; « Tout effacer » masque et ferme. **Légende** : bloc `iris` de `mg-legende-carte` (« IRIS · /km² » ou « · % », six lignes « ≤ a », « a – b », « ≥ z »). Nouveau jeton invariant `--iris-contour` (`rgba(66,146,198,0.7)`, le littéral d'`iris-border`). Écarts voulus (défauts React corrigés) : colonne sans bornes peinte en gris « absente » (React gardait l'expression de l'indicateur précédent) ; légende « Chargement... » pendant la lecture et « ! Bornes indisponibles » après un échec (React affichait « ! Aucune donnée » dans les deux cas) ; détail illisible → « Détail indisponible pour cet IRIS. » (React refermait sans un mot). Panneau de détail PLAT (revue 1, décision du contrôleur, « flat total » et précédent T3) : l'ombre `-4px 0 24px rgba(0,0,0,0.5)` de React est retirée (trait 0,5 px à gauche à la place) et le squelette est un aplat `--bg-level-3` sans dégradé miroitant. Fermer le détail (croix, « Tout effacer ») rend le focus à l'hôte de la page s'il était dedans (`CartePage`, effet sur `codeSelectionne`), sans quoi Alt+1..4 et Échap ne répondaient plus — même défaut que T3. Mineurs T6 soldés : `sections`/`basculerSectionInterne`/`DOCUMENT` retirés du panneau Calques. Vérifié contre React, deux thèmes : `pop_15_29` à z5,5 / z7,5 / z9,5 sur Paris, légende (« ≤ 13.4 » … « ≥ 3.8k ») et détail de l'IRIS 751062301 identiques.
- **POI, transport, OOH et tiroir des panneaux (lot 4, T8, 2026-10-10)** : `data/carte.api.ts` (`CarteApi`, dans `FOURNISSEURS_DISTANTS` : `pois` = **POST** `/api/map/pois` (25 s), `categories(rafraichir)` (`?refresh=1`), `poiNatures`, `ooh` = POST `/api/map/ooh` (15 s), `transport(bbox, types)` = GET à 4 décimales, `territoryMask` ; types `POI`/`ZoneData`/`SelectedBillboard` recopiés). **État** : `couches/pois.service.ts` (`PoisService`, fourni par la page) porte la zone PARTAGÉE (`zone`, l'équivalent de `zoneData` : POI, panneaux OOH et arrêts s'y remplacent), `modeDensite` (`localStorage['genesis_density_mode']`), `styles` (épingles), `panneauSelectionne` ; la bbox ne part que si `bboxPourRequete(filtre)` est défini (département → `BBOX_METRO`, `france` → aucune). `couches/ooh.service.ts` et `couches/transport.service.ts` ne font que leur requête (transport : carte VISIBLE). `etat/catalogue-poi.service.ts` lit `/api/map/categories` UNE fois par écran, à la première ouverture de la section (React relisait à chaque ouverture du panneau), reprise unique à 800 ms ; les natures ne sont pas branchées (aucun composant de `/map` ne les appelle). **Rendu** (`couches/couche-pois.ts`, fonctions pures) : > 500 POI ou mode densité → nappe `pois-heatmap` (et `pois-circles` dès z11), > 300 → cercles GPU, sinon marqueurs DOM créés par `document.createElement` du document de la carte via le nouveau jeton `FABRIQUE_MARQUEUR` (`carte/fabrique-carte.ts`), tous retirés au changement de zone, à « Tout effacer » et à la disparition de la carte ; canevas des rayons redessiné sur `moveend`/`zoomend`/premier `idle` ; popups construites par `textContent` (jamais d'HTML concaténé) ; cercle de zone `zone-fill`/`zone-outline` ; re-posé sur une carte recréée (B11). **Ordre des couches** (ruling T7→T8) : `logique/ordre-couches.ts` (`ORDRE_COUCHES` = l'ordre des `addLayer` de `useMapInit.ts`, verrouillé par `tests/unit/angular/carte-ordre-couches.test.ts`) et `avantDe(carte, id)`, employé par les couches POI, carreaux et IRIS : comme React, la nappe et les cercles POI restent SOUS IRIS et carreaux quel que soit l'ordre des gestes. **Complété le 2026-10-12 (revue finale du lot 4, I-1)** : la liste ne couvrait que les couches du `load` (et le score) ; une couche du `load` allumée APRÈS une couche posée plus tard (IRIS après les sites ICPE) passait au-dessus d'elle, le contraire de React. `COUCHES_APRES_LOAD` range désormais, au-dessus de toutes celles du `load` et dans l'ordre de montage de `app/map/page.tsx` : civique `civic-cps-*`, sites ICPE `risques-*`, PPRT `pprt-*`, santé `civic-health-zones-*`, score, zones de risque `atelier-zones-*`, puis les tracés de l'utilisateur — zones enregistrées (`custom-zone-*`, entrée PRÉFIXE : une nouvelle zone se pose au sommet de son groupe, `avantDe` la cherche par `getStyle().layers`), aperçu du rayon, tracé libre. Tous leurs poseurs passent par `avantDe` ; `carte-ordre-couches.test.ts` (« ICPE puis IRIS », ordre de montage, sources React) et `features/carte/logique/ordre-couches.spec.ts` (vraies fonctions de pose) le verrouillent. Entre elles, React les empile dans l'ordre d'arrivée de leurs données : l'ordre de montage est le seul fixe, c'est lui qui est retenu. **Panneau** : `panneaux/calques/section-poi|section-transport|section-ooh.component.ts` (portages de `PoiSection`/`TransportSection`/`OohSection`) dans « POI et mobilité » et « Médias offline », badges et « Actifs » (POI (n), Transport (n), OOH (n régies)) ; régies, types de transport et sections internes dans `panneaux/calques/selections-calques.service.ts` (fourni par le panneau, rien en `localStorage`) ; `mg-entete-filtre` reçoit `infobulle`. **Tiroir** : `couches/tiroir-panneau.component.ts` (`mg-tiroir-panneau`, `MapPanel.tsx:291-339`) — clic sur un panneau (marqueur ou cercle `panneaux`/`top_ooh`), `iframe` Street View dans la racine d'ombre ; clé `googleMapsKey` FACULTATIVE de `config.local.json` (écrite par `npm run config` depuis `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `.env.development.local` puis `.env.local`) ; sans clé, bandeau qui nomme la variable. Même patron, depuis le 2026-10-13 (parcours de la carte, T3) : clé `urlApplicationReact` (`ConfigApplication.urlApplicationReact?`), FACULTATIVE, recopiée de `NEXT_PUBLIC_APP_URL` par `npm run config` ; la variable n'est posée dans aucun `.env` de ce poste à ce jour, et sans elle les étapes ⑤ Plan, ⑥ Activation, ⑦ Live (`parcours/etape-bientot.component.ts`) affichent « Bientôt dans le parcours. » au lieu du lien « Ouvrir dans l'application actuelle » (`/map?tab=strategie|activation|suivi`) — jamais une URL inventée (hôte AIDA). Badge `couches/zone-active.component.ts` (« ZONE_ACTIVE », `MapPanel.tsx:150-167`). **Légende** : blocs « Analyse spatiale » (catégories affichées et leur compte) et « Figurés » (types choisis). Nouveau jeton invariant `--poi-contour` (#ffffff). Écarts voulus (défauts React corrigés) : changer une épingle ou la densité ne re-cadre plus ; épingles gardées à la réouverture du panneau ; zone vidée = marqueurs retirés ; échecs POI/OOH/transport dits dans leur section ; entités des cercles complétées (format, adresse) pour le tiroir ; gris de popup et bandeau Street View sur jetons. Vérifié contre React, deux thèmes : lycées sur le filtre département 13 → même corps POST et 5 324 points, même cadrage ; arrêts à `west=5.4623&south=43.2782&east=5.9494&north=43.5003` → 1 000 ; OOH → 1 000 (voir ⚠) ; Signali → 13 marqueurs, tiroir identique. ⚠ `/api/map/ooh` rend 1 000 panneaux sur 1 434 actifs, React compris : `.limit(5000)` ne lève pas le plafond `db-max-rows` de PostgREST (1 000) — troncature silencieuse côté route, hors du périmètre du port (gel P5). **Corrigé le 2026-10-10** (tâche serveur du lot 4) : lecture paginée, 1 434 panneaux ; idem `/api/radio/stations` ; `/api/map/transport` passe par la RPC `lire_arrets_transport_bbox` (sql/241) — tableau des routes.
- **Flux routier (TMJA) et radio FM/DAB+ (lot 4, T9, 2026-10-10)** : **TMJA** — `couches/tmja.service.ts` (`TmjaService`, fourni par la page) pose à la PREMIÈRE visibilité la source vectorielle `tmja-source` (`CarteApi.urlTuilesTmja()`, `/api/tmja-tiles/{z}/{x}/{y}?v=v10`, `minzoom 5`) et la couche `tmja-lines` à sa place dans `ORDRE_COUCHES` ; « Masquer le trafic faible (< 5 000 véh/j) », coché par défaut, n'est qu'un `setFilter(['>=', ['get','tmja'], 5000])` (décoché → `null`), aucune tuile redemandée ; re-posé sur une carte recréée (B11) ; section `panneaux/calques/section-tmja.component.ts` dans « POI et mobilité ». **Radio** — `data/radio.api.ts` (`RadioApi`, dans `FOURNISSEURS_DISTANTS` : `emetteurs` avec la chaîne `URLSearchParams` de React octet pour octet, `optionsFiltre`, `stations(q)` → `?search=…&limit=8`) ; `couches/radio.service.ts` (`RadioService`, fourni par la page : l'état de `useRadioLayer`) + `couches/couche-radio.ts` (fonctions pures : sources `radio-emetteurs` groupée et `radio-coverage`, six couches, cercles de couverture calculés côté client — 500 au plus, 64 segments —, popup par `textContent`). Trois stratégies de chargement gardées : radio choisie (tous ses émetteurs, cadrage), couverture (lecture globale `limit=15000`), sinon carte VISIBLE relue 600 ms après un déplacement si la bbox arrondie a changé ; options du filtre lues UNE fois par écran ; densité, couleur et réglettes ne font que repeindre (réglettes appliquées au RELÂCHEMENT), zéro requête. `getClusterExpansionZoom` employé en PROMESSE (MapLibre 5.18). Sections `panneaux/calques/section-radio.component.ts` et `recherche-radio.component.ts` (anti-rebond 300 ms, 2 caractères) dans « Médias offline ». « Actifs » (« Flux routier (TMJA) », « Radio FM/DAB+ ») et comptes de groupe ; légende « Figurés » : quatre paliers TMJA (le faible estompé à 0,35 quand masqué) et « Émetteurs radio ». Couleurs (ruling T2) : sombre invariant des cernes et du texte des grappes = `--brand-teal-fg` (et non `--bg-level-0`), cœur de la carte de chaleur `#f0f0f0` invariant et littéraux restants nommés dans `TEINTES_RADIO` (`palettes-donnees-carte.ts`, verrouillés par `carte-couches-paritaire.test.ts`) ; couleurs de couverture = DONNÉES (B12, `COULEURS_COUVERTURE_RADIO`). Écarts voulus (défauts React corrigés) : clic sur une grappe qui zoome (le rappel de React était ignoré par MapLibre 5) ; radio choisie peinte en teal (React passait `var(--brand-teal)` à `paint`, refusé) ; première pastille de couverture `#4ecdc4` (idem) ; légende TMJA aux couleurs de la carte (React : `#e5a00d` pour un palier peint `#f97316`) ; échec de lecture des émetteurs dit dans la section ; « Tout effacer » vide le compte et ferme la popup. Vérifié contre React, deux thèmes : 118 tronçons rendus sur l'Île-de-France (filtre posé et retiré), 11 082 émetteurs et 45 grappes sur la France (exclusion « P »), Chérie FM → 11 281 émetteurs, même chaîne de requête, même popup. ⚠ Sans exclusion de catégorie, `/api/radio/emetteurs` rend 500 dans les deux applications (deux surcharges de la RPC, voir le tableau des routes) ; ⚠ les propriétés des émetteurs ne portent ni `radio_nom`, ni `radio_id`, ni `portee` : popups « Radio non associée », points tous gris, surbrillance de la radio choisie sans effet — contrat de la RPC, hors du port. **Corrigés le 2026-10-10 par sql/240 et sql/242** (surcharge à 4 arguments retirée ; une radio n'est portée par un émetteur que si elle est UNIQUE, voir le tableau des RPC) : 12 704 émetteurs rendus par défaut ; radio choisie → chaque émetteur porte cette radio (Chérie FM : 11 281). Sans filtre, aucun émetteur n'est lié à une seule radio : les points restent gris et la popup dit « Radio non associée » — c'est vrai ; colorer par `nb_radios` serait un choix client. Reste côté clients : la portée `regionale` n'a pas de couleur dans le `match` des points.
- **Indicateurs civiques et santé environnementale (lot 4, T10, 2026-10-10)** : `data/civique.api.ts` (`CiviqueApi`, dans `FOURNISSEURS_DISTANTS`) — `geojsonVariable`, `detailCp`, `zones` (`/api/meteo-geo/zones`), `santeDepartement` (NDJSON par `lignesNdjson`), `santeCp`, `ingerer` (POST NDJSON, écrit en base). **Indicateurs civiques** — `couches/indicateurs-civiques.service.ts` (`IndicateursCiviquesService`, fourni par la page) : la bbox VISIBLE et non le monde comme React (`-180,-90,180,90` = 6 186 polygones, 21,6 Mo de jsonb, 3,9 s de RPC mesurés ; département 13 visible : 225-335 polygones, 34 ms), relue 600 ms après un déplacement SEULEMENT si la carte sort de la bbox lue ; couches `civic-cps-fill`/`civic-cps-line` au-dessus des couches du `load` (`COUCHES_APRES_LOAD`, revue finale I-1) ; popup DOM en jetons, commune du CP en cache par écran. **Santé** — `couches/sante.service.ts` (`SanteService`) : département en flux NDJSON (progression `{done,total}` ligne à ligne, repeint tous les 10), code postal avec `bbox` SEULEMENT si filtre (`bboxPourRequete`) ; seuil et métrique = repeinture seule ; zones lues une fois par échelle ; teintes `--pollen-level-*`/`--atmo-level-*` par `CouleursService`, REPEINTES au changement de thème (React non) ; changer de jeu remet métrique `global` et progression `null`. Revue 1 : contours puis valeurs en UNE chaîne (`switchMap`) et un seul abonnement — des contours en cache (réponse synchrone) faisaient perdre l'abonnement au flux, qui n'était plus annulé au changement de jeu ; un échec santé est dit dans la section ; la commune d'un CP n'est mise en cache qu'après un succès ; trait civique sur le jeton `--contour-civique` (blanc / `#1a1a1a`). Sections `panneaux/calques/section-{civique,sante}.component.ts` (groupe Environnement, compte et « Actifs ») ; donnée périmée (`pollen_map_daily` arrêtée au 2026-09-17) : message daté de React et bouton d'ingestion à la condition EXACTE de React (code postal, `no_data` ou > 3 jours ; la route exige un admin, 403 → « Réservé aux administrateurs. ») ; « Santé environnementale » s'ouvre au premier IRIS sélectionné. Légende : blocs `civic-indicateurs` (dégradé pondéré, trois repères) et `civic-sante` (six niveaux, estompés sous le seuil). Logique copiée : `logique/sante.ts` (libellés de niveaux, métriques, `ageEnJours`) ; constantes `ABSTENTION_LEGEND`, `TRAIT_CIVIQUE`, `OPACITE_SANTE`… dans `palettes-donnees-carte.ts`, verrouillées par `tests/unit/angular/carte-couches-paritaire.test.ts`. Fiche commune (revue 1) : `panneaux/calques/fiche-sante.component.ts` (`mg-fiche-sante`, portage de `HealthIndicatorCard` + `AirSubBlock`, `PollenSubBlock`, `HealthCardSkeleton`) — `CiviqueApi.santeCommune` (`GET /api/civic-indicators/health/<commune>`), cinq états (invite, squelette, indisponible, erreur + « Réessayer », fiche avec prévisions repliables), commune gardée pour la vie de la fiche.
- **Météo (lot 4, T11, 2026-10-10)** : `data/meteo.api.ts` (`MeteoApi`, dans `FOURNISSEURS_DISTANTS`) — `donnees(scale, params)`, `GET /api/meteo-geo?scale=&variable=&startDate=&endDate=[&bbox=]` (chaîne de React), flux NDJSON par `lignesNdjson`. Les polygones `/api/meteo-geo/zones?scale=` restent lus par `CiviqueApi.zones` (signature élargie à `region`) à travers **`etat/contours-zones.service.ts`** (`ContoursZonesService`, fourni par la page) : une lecture par échelle et par écran, PARTAGÉE avec la santé environnementale (`SanteService` y passe désormais), requête en vol comprise (`shareReplay`), un échec non retenu. `couches/meteo.service.ts` (`MeteoService`, fourni par la page et instancié à l'ouverture) : l'état de `useMeteoLayer` + `useMeteoData` ; « Appliquer » lance polygones et flux ENSEMBLE et conclut quand les deux ont répondu — réussite : couche `meteo-source` / `meteo-fill` / `meteo-outline` posée à sa place (`avantDe`, sous le flux routier), dégradé `meteo` réclamé (`basculerDegrade`, éviction annoncée), dialogue fermé ; échec — du flux OU des contours (React concluait en réussite sur un échec des contours) : dialogue OUVERT avec le message, aucun dégradé, affichage précédent vidé (« HTTP 429 <message de la route> », jamais le JSON brut). Bbox au code postal SEULEMENT : celle du filtre, sinon la carte visible (règle exacte de React, trois décimales) ; aucun appel au déplacement de la carte (quota 20/min). Re-posée avec ses valeurs sur une carte recréée, sans relire. Teintes `METEO_PALETTES` (B12), `OPACITE_METEO`, `TRAIT_METEO` (`palettes-donnees-carte.ts`, verrouillés par `carte-couches-paritaire.test.ts`). Fonctions pures de la couche (pose, synchronisation, popup, libellé d'erreur) dans `couches/couche-meteo.ts`. Dialogue `panneaux/calques/dialogue-meteo.component.ts` (état et gabarit seuls ; validation, préréglages et périodes dans `logique/meteo/periode-dialogue.ts`, bornes et date du jour importées de `logique/meteo/requete.ts`) (`mg-dialogue-meteo`, `<dialog>` natif monté par la page sous `@if`, B13) : défauts de React à chaque ouverture, entrée `meteo` de la pile Échap, Échap consommé (le panneau derrière reste), focus rendu à l'hôte à la fermeture. Section `panneaux/calques/section-meteo.component.ts` (groupe Environnement, compte, badge « <variable> actif », « Masquer » = dégradé rendu + couche vidée) ; « Actifs » « Météo » ; légende : bloc `meteo` (titre + variable, comme React — pas de rampe). Défauts React corrigés : `#ff5757` → `--danger`, `colorScheme: 'dark'` en dur sur les dates (icône invisible en clair), ombre retirée, message d'erreur HTTP lisible. **`quandStyleCharge` (`etat/couches-carte.service.ts`) attend désormais `load` OU `idle`** : constaté au navigateur, une carte recréée par un changement de fond est publiée au `load` mais `isStyleLoaded()` reste faux tant que ses tuiles chargent — l'écoute de `load`, déjà passé, ne se déclenchait jamais et AUCUNE couche (T6-T11) n'était re-posée dans un vrai navigateur. ⚠ Au code postal, 1 000 CP sur 6 187 (plafond PostgREST de `get_zone_centroids`, voir le tableau des routes), dans les deux applications.
- **Risque industriel : sites ICPE et périmètres PPRT (lot 4, T12, 2026-10-10)** : **État** — `etat/risque-carte.service.ts` (`RisqueCarteService`, fourni par la page : recopie en signaux d'`EtatRisqueIndustriel` — `actif`, `niveaux` (défaut `seveso_haut`, `seveso_bas`), `typesRisque`, `inclureInactifs`, `rayonM` (0), `afficherHalo`, `compte`, `pprtActif`, `pprtTypes`, `pprtEtat`, `filtres`, `natures` = `naturesDesTypes` (`logique/natures-risque.ts`) : libellés de `librellesDuType` + « Nature non précisée » ; `compte` remis à `null` à l'extinction (revue 1, défaut React corrigé)). **Données** — `SitesRisqueApi.carte(bbox, filtres)` (`GET /api/map/risques-industriels`, paramètres dans l'ordre de React) et `exposition(siteId)` (`GET /api/risques/[siteId]/exposition`, écrit le cache `seveso_exposition` au premier clic, comme React) ; `CarteApi.pprt(bbox, types, limite?)`. **Couches** — `couches/risques-industriels.service.ts` (`risques-zone`, `risques-zone-contour` tireté, `risques-halo`, `risques-point`) et `couches/pprt.service.ts` (`pprt-fond`, `pprt-contour` plein), couches MapLibre pures dans `couches/couche-risques.ts`, popups dans `couches/popups-risques.ts` (revue 1 : séparées ; leur fabrique d'éléments `elementTexte` de `carte/contenu-popup.ts` est désormais la SEULE du dépôt Angular, employée aussi par les popups POI, radio et civiques/santé, qui en portaient chacune une copie) ; lecture par `chargerParCadre` (immédiate, puis 350 ms après un déplacement, l'ancienne annulée) ; une lecture de même bbox et mêmes filtres n'est pas refaite (carte recréée B11 : zéro requête) ; PPRT sous `PPRT_ZOOM_PLANCHER` (8) : aucune requête, source vidée, bandeau ; couleurs par `CouleursService` (`--risque-*`, `--donnee-absente`, cerne `--contour-point` inversé, `--pprt-contour`/`--pprt-fond`), REPEINTES au thème ; couches au-dessus de toutes celles du `load`, comme React (rangées dans `COUCHES_APRES_LOAD` depuis la revue finale I-1, 2026-10-12) ; popups DOM par `textContent` (site : statut de zone, rubriques, population exposée remplie à l'arrivée, la lecture précédente annulée au clic suivant ; PPRT : servitude PM3). Statuts de zone (`STATUT_ZONE`, `descriptionStatut`, `NATURES_ZONE`) ajoutés à `features/risques/logique/nature-zone.ts`. **Panneau** — `panneaux/calques/section-risque.component.ts` (`mg-section-risque` + `mg-carte-zone`, `mg-trace-zone`, `mg-repli-risque`, `mg-provenance-zones`) en tête du groupe Environnement ; « Analyser la population à risque → » posé DÉSACTIVÉ (« Disponible prochainement », câblé en T13) ; « Actifs » (« Zones à risque industriel », « Périmètre PPRT ») et compte de groupe. **Légende** — bloc « Zones à risque » (trait plein PPRT, tireté du rayon, « N sites sur M ont un périmètre PPRT »). « Tout effacer » ne touche pas ces couches, comme React. Écarts voulus (défauts React corrigés) : le thème et le halo ne relisent plus rien (React relisait à chaque bascule) ; un `moveend` sans déplacement ne relit rien ; échecs de lecture dits dans la section ; la section se replie au PREMIER clic (React : clé absente de `sectionsOpen`, `!undefined`). Vérifié contre React, deux thèmes, même requête octet pour octet : France z5,2 → 1 215 sites (621 avec PPRT) ; Étang de Berre z9 → 79 (59) ; rayon 500 m → 79 zones ; z8 → 108 sites, 43 périmètres PPRT ; même popup, population exposée 8 918 (périmètre PPRT).
- **Module risque intégré à la carte (lot 4, T13, 2026-10-10)** : **Route enfant (B2)** — le module « Population à risque industriel » est désormais `carte/risques` (`/app/carte/risques` en autonome), enfant de la carte principale, rendu par son `<router-outlet>` dans un calque `absolute inset-0 z-[60]` (affiché seulement module ouvert, `activate`/`deactivate`) : la carte reste montée DESSOUS, comme l'overlay React au-dessus de `/map` — ouvrir puis fermer le module ne recrée ni `CartePage` ni sa carte (spec). L'ancienne route racine `risques` devient `{ path: 'risques', redirectTo: 'carte/risques' }` (relative : préfixe de l'hôte et `?risque=` gardés — un lien du lot 3 marche encore) ; le lien de développement « Module risque » et la tuile de l'accueil visent `carte/risques`. Fermer (croix, Échap) revient au parent relatif, donc à la carte (A7 du lot 3 levé) ; l'Échap qui ferme le module est consommé (`preventDefault`) pour ne pas fermer en plus le panneau de la carte resté dessous ; le focus revient à l'hôte de la carte à la fermeture. **Natures (B4)** — « Analyser la population à risque → » (`section-risque`) est actif : il garde le `?risque=` courant et y remplace `natures` par celles des types cochés (`logique/entree-module-risque.ts` : `risqueDepuisCalques`, formule `naturesDesTypes` de `AnalysePopulationOverlay.tsx:582-588` ; les gravités ne sont pas transmises, parité) puis navigue vers `risques` relatif à la carte. **« Voir sur la carte » (B3, A6 du lot 3 levé)** — `features/risques/exports/bouton-voir-carte.component.ts` (`mg-bouton-voir-carte`) dans l'en-tête du module, présent seulement si le jeton `PONT_CARTE` (`carte/etat/pont-carte.ts`, interface `PontCarte.afficherZonesRisque`) est fourni — `CartePage` le fournit (`useExisting: ZonesRisqueService`), le module le voit par l'injecteur de l'outlet ; geste : `POST /api/risques/zones/preparer` (profil CALCULÉ + `natures`), puis le pont, puis Fermer ; profil sans anneau → désactivé (`title` React) ; `classes: 0` et erreurs → messages de React. **Couche** — `couches/zones-risque.service.ts` (`ZonesRisqueService`, fourni par la page) RÉUTILISE `features/risques/cartes/couches-zones.ts` du lot 3 avec un nouveau régime `REGIME_CARTE` (chaque bande dès le plancher z4) et `etiquettes: false` — trois couches sans étiquette de rayon, comme `ZonesRisqueLayer.tsx` ; le module garde `REGIME_MODULE` 7/10 et ses étiquettes. Jetons `--niveau-*`, niveaux de légende et convention de trait partagés par les deux légendes (`risques/logique/legende-niveaux.ts`, revue 1) ; carte recouverte `inert` pendant le module ; tuiles `urlTuilesZones(code, natures)` ; re-posée sur une carte recréée (B11), repeinte au thème, éteinte par « Tout effacer ». **Défauts React corrigés** : les natures entrent dans la préparation et les tuiles (React : profil seul, la carte montrait toutes les natures sous un module filtré) ; afficher les zones RÉCLAME le dégradé `zones-risque` (IRIS, carreaux… évincés et annoncés ; React ne le réclamait jamais) ; la légende a un bloc « Zones de risque » (`legende/legende-zones-profil.component.ts`, `mg-legende-niveaux` du module + natures retenues + convention de trait ; React renvoyait la légende à une couche qui n'en dessinait aucune). **Jeux de zones** — `panneaux/zones/jeux-de-zones.component.ts` (`mg-jeux-de-zones`, portage de `JeuxDeZonesRail.tsx`) dans le panneau Zones : liste `GET /api/zones/jeux` (`JeuxZonesApi.lister`), un clic ouvre `carte/risques?risque=etape=zones&jeu=<id>` (`risqueDuJeu`). Vérifié au navigateur (type « Toxique ») : mêmes six chiffres que React (6 953 643 · 10,9 % · 502 / 1 259 · 1 054 · 11,1 % · +555 930), même « 13 sites affichés », une entrée d'historique par geste.
- **Panneau Zones, lien `customZone`, script DV360 (lot 4, T14, 2026-10-10)** : `features/carte/panneaux/zones/` — `mg-panneau-zones` (`PanneauZones.tsx` : « Créer une zone » provisoire jusqu'à T16, jeux de zones T13, « Mes zones »), `mg-mes-zones` (`ZonesOverlay.tsx` : chiffres `GET /api/custom-geo/stats` et liste lus ENSEMBLE, organisation ACTIVE du profil, horodatage anti-cache, recherche à 200 ms d'anti-rebond, puces par type de source dès deux types, sélection ORDONNÉE — la première cochée est la base d'une soustraction —, zones disparues retirées de la sélection), `mg-carte-zone` (`ZoneCard`), `mg-operations-zones` (`ZonesOperations.tsx` : Fusionner / Restreindre à / Soustraire → `POST /api/custom-geo/source/{composite,intersection,difference}` puis `POST /api/custom-geo/save` ; un refus 409 « aucune surface en commun » est relayé et RIEN n'est enregistré ; 207 dit), `mg-dialogue-suppression-zone` (`<dialog>` natif, `DELETE /api/custom-geo/[id]`, l'échec reste dans le dialogue). **Couche** `couches/zones-custom.service.ts` (`ZonesCustomService`, fourni par la page) : sources `custom-zone-<id>` + aplat/contour à la teinte de `PALETTE_ZONES` (B12, `palettes-donnees-carte.ts`, verrouillée contre `ZonesOverlay.tsx`), UN `effect` de réconciliation (afficher, masquer, « Tout effacer », carte recréée B11), recadrage 50 px / 800 ms ; l'état vit dans la page (React le reconstruisait du style MapLibre à chaque ouverture) et `zonesAffichees` est exposé pour le plan média (T15). **Créneau de bataille** `couches/bataille.service.ts` (`BatailleService`) + `couches/couche-bataille.ts` + `logique/bataille/anneaux.ts` : rendu de `applyIsochroneBattle` (sources `battle-rings` / `battle-pois`, littéraux nommés `TRAITS_BATAILLE`, B12) — T17 y branchera les batailles, bordures, palier max, popups et légende. **Lien** `etat/lien-zone.service.ts` (`LienZoneService`) : `?customZone=<id>` lu carte prête, UNE fois par id (`customZoneLoadedRef`, ni une autre navigation de requête ni un changement de fond ne relisent), géométrie → créneau (palier 1, POI au centre, clé `cg__<id>`, `logique/zones/zone-du-lien.ts`), recadrage 60 px / 1 s ; « Tout effacer » retire `customZone` de l'URL (navigation relative, `replaceUrl`). **Script DV360** : bouton flottant « Script bidding DV360 » (`mg-boutons-flottants`, 84 px sous l'immersif) tant que la clé est `cg__` ; `etat/export-zone.service.ts` (`ExportZoneService`) télécharge `GET /api/custom-geo/[id]/export?format=bidding_script|tiktok_geo` en blob par `enregistrerFichier` — un FICHIER à coller dans DV360, aucun envoi à Google ; vérifié : fichier octet pour octet identique à React. `ZonesCustomApi` gagne `stats`, `geometrie`, `supprimer`, `operation`, `enregistrer`, `exporter` (pas de `renommer` : aucun écran de la carte ne renomme). **Changement d'organisation** sur la carte (badge de `mg-barre-haut`, sortie `orgChangee`) : panneau ouvert FERMÉ quel que soit le geste (clavier compris : « Mes zones » lit l'organisation à l'ouverture), zones affichées et zone du lien lâchées (lecture en vol abandonnée), filtre de ZONE retiré (les autres calques restent — React rechargeait toute la page). Défauts React corrigés : « Tout effacer » laissait l'état des zones affichées (« Masquer » devant une zone disparue) ; « Zone créée » n'était jamais vu (barre démontée par la sélection vidée) puis resurgissait périmé ; « codes postalux » ; échecs d'export et de lien muets.
- **Plan média des zones affichées (lot 4, T15, 2026-10-10)** : `features/carte/panneaux/zones/plan-media.component.ts` (`mg-plan-media`, `ZoneMediaPlanPanel.tsx`) — panneau droit `absolute` de 600 px (`LARGEUR_PLAN_MEDIA`, `PANEL_WIDTH`) sous la barre (0 en immersif), z 45 : campagne rattachée, budget, CPM, cible groupée (`cibles.ts`), impressions totales, tableau `mg-tableau-plan-media` (% total, % France, volume, impressions, répétition — avertissement au-delà de 10 —, coût pour 1000, répartition modifiable ramenée à 100), « Répartir au prorata », export CSV (`;`, BOM, cellules neutralisées contre l'injection de formule), exports DSP pondérés « Script bidding DV360 » / « Ciblage TikTok » (un FICHIER par zone, poids par item ; aucun envoi à Google ni à TikTok). **Calculs** : `logique/zones/plan-media.ts` (formules, arrondis et formats de React extraits du composant), `plan-media-csv.ts`, et trois copies VERBATIM verrouillées par `carte-couches-paritaire.test.ts` : `media-plan.ts` (`normalizeShares`, `proportionalShares`), `slug.ts`, `csv-escape.ts`. **État de page** `etat/plan-media.service.ts` (`PlanMediaService`) : ouverture à la première zone affichée, fermeture à zéro zone, la croix tient jusqu'au changement du nombre de zones (`linkedSignal`) ; audiences par zone en CACHE de page (`GET /api/custom-geo/[id]/items-audience`, repli `GET /api/custom-geo/[id]` → `audience_stats`), lues panneau ouvert seulement, par lots de 3 ; totaux nationaux (`GET /api/custom-geo/national-totals`) lus UNE fois. **Écritures** : `POST`/`DELETE /api/custom-geo/media-plan` (`geo_strategy.media_plan` de la campagne) et `POST /api/custom-geo/media-plan/snapshot` (instantané à l'export avec campagne) ; liste des campagnes `GET /api/custom-geo/media-plan` (pas `/api/digital/campaigns`). `ZonesCustomApi` gagne `totauxNationaux`, `audienceItems`, `zone`, `campagnesPlan`, `planMedia`, `enregistrerPlan`, `detacherPlan`, `instantane`, et `exporter` des paramètres (`weights`, `budget`). **Boutons flottants** : tous s'écartent du panneau ouvert, `min(620px, calc(100% - 60px))` (`droiteBoutons` — en `%` de l'hôte et non `vw`) ; panneau fermé, « Plan média (n) » 126 px sous l'immersif. Vérifié au navigateur : chaque cellule égale à React (deux zones, trois réglages), CSV et scripts DV360 octet pour octet identiques. Défauts React corrigés : choisir une campagne dont le plan vise une autre cible perdait ses poids ; les poids d'un plan stocké sont ramenés aux lignes affichées (`repartitionDesLignes`, revue 1) — aucune clé commune → prorata, plan partiel → lignes absentes au prorata puis total ramené à 100 — là où React mettait chaque ligne à 0 % sous un pied à « 100 % » et réécrivait ces zéros à l'enregistrement et dans l'instantané d'export. Formats composés sur `core/format/nombre.ts`.
- **Créer une zone — codes postaux, rayon, dessin maison, capture des couches (lot 4, T16, 2026-10-11)** : la section « Créer une zone » du panneau Zones (`panneau-zones.component.ts`, `PanneauZones.tsx`) — bouton « Capturer zone custom » et son badge, puis trois outils repliables au pied commun `mg-outil-creation` (nom, « Créer la zone », erreur, réussite) : `mg-creer-codes-postaux` (`CreerZoneCodesPostaux.tsx` ; aperçu à la frappe par `parse-cp.ts`, sans requête ; liste collée en JSON, fichier déposé envoyé TEL QUEL en multipart `FormData` champ `file` sauf saisie retouchée ; plafond 2 000 ; inconnus du référentiel et rejetés dits séparément), `mg-creer-rayon` (`CreerZoneRayon.tsx` ; centre au clic, curseur 500 m–100 km, aperçu LOCAL du cercle `couches/apercu-rayon.ts`, part retenue dite sous 98 %), `mg-creer-dessin` (`CreerZoneDessin.tsx` + `DessinLibre.tsx`). Les trois enchaînent route source puis `/api/custom-geo/save` par `etat/creation-zone.service.ts` (`CreationZoneService`, fourni par le panneau : organisation active relue à chaque ouverture) ; chaque création relit « Mes zones » sans le recréer. **Dessin (B8)** : `couches/dessin.service.ts` (`DessinService`, page) ÉCRIT À LA MAIN sur MapLibre, sans `terra-draw` ni aucune dépendance — gestes purs dans `logique/zones/dessin.ts` (polygone : clic = sommet, double-clic ou clic à moins de 8 px du premier sommet = fermer, `Backspace` sur le conteneur de la carte = retirer ; rectangle : deux coins), source `dessin-trace` + couches remplissage/ligne/point en teal de `CouleursService`, zoom au double-clic coupé tant que l'outil est ouvert, `dragPan` coupé pendant un tracé en cours ; le tracé fermé part tel quel à `/source/dessin` (`ST_MakeValid`, « tracé réparé »). Pas de mode « Modifier ». **Capture** : `etat/capture.service.ts` (`CaptureService`, page) remplace `CustomGeoCaptureContext` + `CaptureLayers.tsx` : chaque service de couche DÉCLARE sa source (signal non nul = allumée) — `CarreauxService` (emprise visible, `zoom_level` 14, 1 500 carreaux), `IrisService` (IRIS sélectionné), `RadioService` (couverture de la radio choisie), `BatailleService` (clé de cache, POI, anneaux) ; aucune liste en dur. `mg-capture` (`CustomGeoCaptureModal.tsx`, `<dialog>` natif, `logique/zones/capture.ts`) résout chaque couche isolément (50 s), puis `POST /api/custom-geo/capture` (union / enveloppe convexe / rectangle / brute ; POI et sous-zones d'une bataille). **La carte « prise »** : `EtatCarteService.prendreCarte/rendreCarte/carteOccupee` — tant qu'un outil tient la carte (dessin ouvert, pose d'un centre), un clic sur la carte ne ferme pas le panneau (défaut React : il le fermait, et rayon et dessin étaient inutilisables). `ZonesCustomApi` gagne `depuisCodesPostaux`, `depuisRayon`, `depuisDessin`, `source(route, corps)`, `capturer`. Aucune route ni table nouvelle.
- **Panneau Analyse I — garde de périmètre et batailles d'isochrones (lot 4, T17, 2026-10-11)** : `features/carte/panneaux/analyse/` — `mg-panneau-analyse` (`PanneauAnalyse.tsx` : message de garde, accordéon « Analyse spatiale », mode de transport), `mg-intro-analyse` (`SpatialAnalysisIntro.tsx`), `mg-outil-bataille-v2` (`BattleV2Tool.tsx`), `mg-outil-isochrones` (`IsochronesTool.tsx`), `mg-journal-bataille` et `mg-statut-cache` (les deux blocs que React écrivait deux fois), `styles-analyse.ts`. **Garde** : chaque gestionnaire de lancement du panneau commence par `verifierPerimetreOutil('bataille_v1' | 'bataille_v2' | 'application_bataille')` (`messageGardeOutil`) — sans filtre « Choisissez un périmètre… », sur la France entière un refus qui nomme l'outil, zéro requête ; les outils ÉMETTENT, le panneau garde, verrou structurel `tests/unit/angular/panneau-analyse-garde.test.ts` (lit le source ; 4 mutations détectées). **Voronoï ABSENT** (décision du propriétaire : il ne se lançait que par l'Assistant). **État** à la page (fermer le panneau ne coupe pas un calcul) : `etat/contexte-bataille.service.ts` (mode, catégorie unique, territoire dérivé du FILTRE, POI de la bataille posés comme zone de points), `etat/bataille-v1.service.ts` (vérification du cache, flux V1 avec ticker, découpe `ST_Difference`), `etat/bataille-v2.service.ts` (vérification, remplissage ORS qui enchaîne sur la V2, V2) ; « Tout effacer » annule les flux. **API** `data/isochrones.api.ts` (`IsochronesApi`, `FOURNISSEURS_DISTANTS`) : `POST /api/isochrone-cache-check`, `POST /api/isochrone-battle` (route PROTÉGÉE, appelée avec le corps exact de React — filtres absents à `null` —, jamais modifiée), `POST /api/isochrone-battle-v2`, `POST /api/isochrone-battle/apply-battle` ; flux NDJSON par `lignesNdjson`, un événement `error` devient une erreur de l'Observable. **Couche** `couches/bataille.service.ts` + `couche-bataille.ts` (créneau T14 complété) : sources `battle-rings` / `battle-borders` / `battle-pois`, cinq couches (`battle-cirfa-border` ajoutée), anneaux bruts au fil du flux, visibilité, popups (anneau « ⏱ Anneau N min », POI), recadrage 60 px / z12 / 1,2 s ; UN filtre combine palier 0 (« Voronoï » résiduel) et palier maximum (`filtreAnneaux`). **Légende** `legende/legende-bataille.component.ts` (« BATAILLE · catégorie », réglette PALIER_MAX 10-90, rampe, huit POI puis « +N autres »), dans le bloc « Analyse spatiale » ; bascule « Bataille » dans la colonne haut-gauche (`mg-zone-active`). Logique pure `logique/bataille/{parametres,journal,flux}.ts`. Palettes B12 : `TRAITS_BATAILLE.bordure`, `OPACITE_PALIER_PARTIEL` (parité `carte-couches-paritaire.test.ts`). Défauts React corrigés : les deux filtres d'anneaux qui s'écrasaient ; clé `cg__` gardée après une V2 ; bordures/points d'une bataille précédente laissés ; catégorie survivant à « Tout effacer » ; « > > » et « ◆ ◆ » du journal de remplissage ; « Cache rempli (? isochrones) » ; succès affiché après un échec HTTP de la découpe ; **un filtre code postal ou zone REFUSÉ par les deux batailles** (2026-10-12, revue finale du lot 4, registre ligne 71 — arbitrage de parité inversé) : il passait la garde mais n'était pas transmis, et la bataille partait sur toute la métropole ; `messageRefusTerritoireBataille` (`logique/bataille/parametres.ts`), appliqué dans `verifierPerimetreOutil` pour `bataille_v1`/`bataille_v2` (pas pour l'application de la bataille, sans territoire).
- **Panneau Analyse II — score composite, corrélation, mes analyses (lot 4, T18, 2026-10-11)** : deux accordéons sous « Analyse spatiale » — `mg-outil-score` (`ScoreCompositeTool.tsx` ; jusqu'à six indicateurs du catalogue `GET /api/cibles/indicators`, poids 0,1-3, sens ; « Enregistrer dans Mes analyses » opt-in ; « Créer la zone » au-dessus d'un seuil par `POST /api/custom-geo/source/score` puis `/save` via `CreationZoneService`) et `mg-outil-correlation` (`CorrelationTool.tsx` ; `GET /api/digital/campaigns` + catalogue, `GET /api/analyses/correlation` ; `r` jamais sans `n` ni la couverture CP appariés / touchés ; nuage `graphiques/nuage.component.ts` + `option-nuage.ts`, ECharts `ScatterChart` ajouté à `fabrique-graphique.ts`). **Garde** : le score passe par `lancerScore()` → `verifierPerimetreOutil('score_composite')` (la France entière est ADMISE, seul outil national) ; la corrélation n'est PAS gardée, délibérément (bornée par une campagne) — verrou `panneau-analyse-garde.test.ts` étendu. État des outils fourni par le PANNEAU (`etat/score-composite.service.ts`, `etat/catalogue-indicateurs.service.ts` — catalogue lu UNE fois pour les deux outils, au premier dépliage). **Couche** `couches/score.service.ts` + `couche-score.ts` (`ScoreMapLayer.tsx`, à la PAGE) : `SCORE_MAP_EVENT` remplacé par `afficher` / `eteindre` ; dégradé `score` réclamé et rendu aux seules transitions (le défaut de pile synchrone de `page.tsx:533-549` n'a pas d'équivalent avec les signaux) ; contours CP de `ContoursZonesService` lus à la première activation ; source `score-composite-cp`, couches `-fill` / `-line` au-dessus des couches du `load` (`COUCHES_APRES_LOAD` de `ordre-couches.ts`) ; teal plein par `CouleursService`, paliers `PALIERS_SCORE` / `OPACITE_SCORE` / `TRAIT_SCORE` (B12, parité `carte-couches-paritaire.test.ts`) ; popup en DOM. Carte flottante `legende/legende-score.component.ts`, montée par `mg-legende-carte`, en bas à droite. **Mes analyses** (Calques jusqu'au 2026-10-13, boîte à outils depuis — T6 du parcours) : `outils/mes-analyses.{component,service}.ts` (ex-`panneaux/calques/`) — `GET /api/analyses` à la PREMIÈRE ouverture de l'outil « Mes analyses » de la boîte à outils (jusqu'au 2026-10-13 : au premier dépliage du groupe des Calques, retiré ; fermer/rouvrir ne relit rien, sauf après un échec), plus deux gestes absents de React : « Rejouer » un score (`POST /api/analyses/[id]/rejouer` puis `POST /api/analyses/score` avec la liste de CP enregistrée, `enregistrer: false`) et « Supprimer » confirmé sur la ligne (`DELETE /api/analyses/[id]`, ÉCRIT). API `data/analyses.api.ts` (`AnalysesApi`, `FOURNISSEURS_DISTANTS`) ; logique pure `logique/analyses/{score,correlation,commun}.ts`. Défauts React corrigés : « codes postalux » ; comptes non formatés de la carte flottante ; « Tout effacer » laissait le score peint. Aucune route ni table nouvelle.
- **Clustering I — modèles, couche des clusters, panneau de résultats, rapport d'un modèle (lot 4, T19, 2026-10-11)** : accordéon « Clustering » du panneau Analyse, réservé au super admin (`AuthService.lireProfil`, comme `clusteringOuvert` de React) — `panneaux/analyse/clustering/` : `mg-section-clustering` (`ClusteringSection.tsx` ; liste des modèles relue à chaque ouverture, erreur de la route affichée au lieu de « Aucun modèle calculé »), `mg-panneau-clusters` (`ClusterPanel.tsx` ; en-tête version/K/silhouette/variance, durées 30/45/60, onglets Légende/POI/Comparer) et ses sous-composants `mg-fiche-poi-cluster` (historique `GET …/history/[poiId]`), `mg-comparaison-durees` (`GET …/poi/[poiId]`), `mg-comparaison-poi`, `mg-radar` (SVG, géométrie pure `logique/clustering/radar.ts`), état partagé `etat-panneau-clusters.service.ts` (fourni par le panneau, mode comparaison dans la pile Échap) ; `rapport/` : `mg-rapport-clusters` (`ClusterResultsOverlay` + `ClusterDetails.tsx`, tiroir `<dialog>` natif, 7 onglets `mg-onglet-*`, modèle et moyennes nationales lus en parallèle, exports XLSX/PDF visibles et inactifs). **« Charger les clusters »** est ÉMIS jusqu'au panneau Analyse, qui le garde par la garde GÉNÉRIQUE `verifierPerimetre` (`messageGardePerimetre`, sans refus national : relecture d'un modèle, pas le calcul lourd) avant `ClustersService.charger` — `HANDLERS_GARDE_GENERIQUE` du verrou `panneau-analyse-garde.test.ts`. **Couche** `couches/clusters.service.ts` + `couche-clusters.ts` (`ClustersService`, PAGE) : source `clusters-source`, couche `clusters-layer` (teinte = donnée `cluster_color`, cerne `--poi-contour` par `CouleursService`), TROIS synchronisations séparées (pose, `setData`, visibilité), re-posée sur carte recréée sans requête, popup en `textContent`, clic transmis au panneau par `ecouterSelection` (React : `CustomEvent` sur `window`), source de capture `map-poi-clusters` (géométrie locale), « Tout effacer ». **API** `data/clustering.api.ts` (`ClusteringApi`, `FOURNISSEURS_DISTANTS`) : `/api/poi-clusters?duration=`, `/models`, `/models/[version]`, `/france-averages`, `/poi/[poiId]`, `/history/[poiId]` — l'analyse Gemini (`/analysis`, `/generate-analysis`) n'est PAS portée (aucune IA ; React ne l'affichait pas). **Graphiques** : `graphiques/graphique.component.ts` (`mg-graphique`, ECharts générique : barres et anneau enregistrés là, pas dans la fabrique de la courbe) ; le cycle de vie ECharts (création après rendu, `ResizeObserver`, `dispose`, options en `notMerge`) est UNE fonction, `graphiques/monter-graphique.ts`, employée par `mg-courbe`, `mg-nuage` (T18) et `mg-graphique` (revue 1), options pures `logique/clustering/options-graphiques.ts` ; logique pure `logique/clustering/{types,panneau,rapport,libelles,feature-themes}.ts` (`feature-themes.ts` et `libelles.ts` copies verbatim, parité `carte-logique-paritaire.test.ts`). Défauts React corrigés : rapport INVISIBLE (tiroir `z-index` 8001 sous la carte à 9999) ; 404 « aucun modèle » muet (les deux modèles sont à 15 min, le sélecteur propose 30/45/60) → message nommant les durées calculées ; clic sur un point qui fermait le panneau (le panneau RÉSERVE les seuls clics sur un point des clusters, `EtatCarteService.reserverClics/clicReserve`, lu par `CartePage.pointerHors` — tout autre clic ferme le panneau comme avant) ; seconde table `FEAT_SHORT` périmée ; `Durée` affiché littéralement ; aplats `var(--…)+'30'` invalides (noirs) ; couleurs du rapport différentes de celles de la carte ; violet `#261a35`. Aucune route ni table nouvelle.
- **Clustering II — assistant de calcul et sondage du job (lot 4, T20, 2026-10-11)** : « Nouveau clustering » / « Nouveau » du panneau de clusters ouvrent `mg-assistant-clustering` (`ClusteringWizard.tsx`) PAR-DESSUS le panneau — `panneaux/analyse/clustering/assistant-clustering.component.ts` et ses étapes `assistant/{etape-types,etape-perimetre,etape-parametres,choix-variables,etape-execution}.component.ts`, état `assistant/etat-assistant-clustering.service.ts` (fourni par l'assistant), logique pure `logique/clustering/assistant.ts` (corps du POST, départements des régions sans DROM, bornes de durée, préréglages et thématiques, teintes `JETON_THEME` en `--nature-*` au lieu des hexadécimaux dont un violet). **Lancement gardé** : « Lancer » ÉMET le corps exact de React jusqu'au panneau Analyse, dont `lancerClustering` commence par `verifierPerimetreOutil('clustering')` (refus NOMMÉ de la France entière) avant `CalculClusteringService.lancer` — ajouté à `HANDLERS_GARDE_OUTIL` du verrou `panneau-analyse-garde.test.ts`, qui interdit aussi tout `.lancer(` aux composants du clustering ; le message de garde redescend (`[refusCalcul]`) et s'affiche dans l'étape 3 après le clic. **Job** `clustering/calcul-clustering.service.ts` (`CalculClusteringService`, fourni par le panneau Analyse) : `POST /api/poi-clusters/run`, puis sondage `GET …/run?job_id=` immédiat et toutes les 3 s (React), arrêté sur `done`/`failed`, à la destruction de l'assistant et du service ; `done` relit la liste des modèles ; 503 « script absent » affiché tel quel. **Aperçu** `couches/apercu-clustering.service.ts` (`ApercuClusteringService`, PAGE) : `POST /api/map/pois` (corps de `page.tsx:414-419`, 15 s) → couche `wizard-highlight-layer` (`--warning`, cerne `--brand-teal-fg`, repeints au thème, `avantDe`), annulée à chaque nouvelle sélection, mise en cache par (types, portée), effacée à la fermeture et par « Tout effacer ». **API** `ClusteringApi` : `typesPoi`, `compter`, `lancer`, `statut`. Défauts React corrigés : le message de fin d'un job réussi n'était jamais vu (le wizard se refermait au même tic) ; « Voir résultats » menait à `/clusters`, page inexistante → retour à la liste des modèles ; « Clustérisé » / « Voir résultats » affichés littéralement ; vider la sélection laissait l'aperçu ; interrupteurs en `div` injoignables au clavier. ⚠ Constat non corrigé (route et script hors du port) : avec les 16 variables, `features` part à `null` et le script NE chaîne PAS `full-retrain` — un lancement « Toutes » ne fait que mettre des isochrones en cache, sans nouveau modèle. Aucune route ni table nouvelle.
- **Carte principale (lot 4) — parcours final, parité et épreuve AIDA (lot 4, T21, 2026-10-11)** : synthèse des puces T3-T20 ci-dessus, vérifiée au navigateur. **Routes** : `carte` (plein écran sous `remoteRoutes`, `authGuard`) et son enfant `risques` (module risque, patron B2 — la carte reste montée dessous ; `risques` à la racine redirige vers `carte/risques`) ; dans l'hôte, `<préfixe>/carte/risques` apparaît bien dans l'URL du shell. **Registre des couches (B11)** : `CouchesCarteService.carteCourante` passe par `null` puis la nouvelle instance ; chaque service de couche se re-pose par son `effect` — mesuré : 14 couches allumées avant « Clair », 14 après (React en perd 11 : sites ICPE, PPRT, score, zones de risque, zone custom). **Pont carte (B3)** : `PONT_CARTE.afficherZonesRisque` (« Voir sur la carte ») évince le dégradé courant et l'annonce (« Météo a été masqué — un seul dégradé de couleur à la fois ») là où React superpose les deux. **Clavier (B10)** : `Alt+1..4`/Échap écoutés sur la racine MAGELIAN — dans l'hôte, actifs focus dans MAGELIAN, inertes focus dans un champ de l'hôte. **I/O mesurées sur le parcours** (instrumentation `fetch`/XHR) : 3 appels `/api` simultanés au plus (React 10), zéro requête au changement d'indicateur carreaux et IRIS (les deux), bornes IRIS, catégories, options radio, contours météo par échelle lus UNE fois (React : catégories 4 fois, `/api/user/organizations` 10 fois sur le parcours, 6 simultanés au chargement), aucune requête France entière au premier chargement ; référentiel `ref/geo` lu une fois par écran (carte, module). **Épreuve AIDA** (hôte jetable PAR DÉFAUT `ignoreUnusedDeps: true`, remote en `ng serve` PUIS build de production servi par `http-server --cors`) : page stylée dans le cadre, `magelian.css`/`config.local.json`/`maplibre.css` sur le remote, API par l'origine de l'hôte, tuiles carreaux/IRIS/TMJA/zones de risque en 200, flux NDJSON santé (`application/x-ndjson`) et météo, dialogues météo et capture DANS la racine d'ombre (`MG-RACINE-DISTANTE`), thème suivi depuis le bouton de l'hôte sans rien écrire dans `localStorage`, tableau de fuite = 0 différence sur les éléments de l'hôte et 0 variable sur `<html>`, 0 erreur console, aucun `rxjs-interop`, `_angular_core` servi par l'hôte. **Deux défauts Angular corrigés au parcours** : `mg-panneau-carte` passe de `--card-overlay` translucide à `--surface` opaque (sans le flou de React, la légende ouverte sous le panneau se lisait au travers, texte sur texte — c'était le « chevauchement » de la légende IRIS noté en T10) ; Réglages › Back office › « Health check » mène à `admin/health` (page portée au lot 6, l'entrée était restée inerte) ; ronde 1 : en-tête du module risque ramené à 80 px comme React (`whitespace-nowrap` retiré de « Exporter le profil » et « Voir sur la carte », libellé « Voir sur / la carte » en deux morceaux insécables parce que l'icône tenue à 13 px ne rétrécit pas comme celle de React) — même cadrage, même compte de sites, mêmes étiquettes de rayon. Écarts restants et défauts React : rapport T21 et feuille de route (« À savoir … revue finale du lot 4 »).
- **Suppression de l'IA — lot 5 (2026-10-12)** : l'entrée « Assistant » (`Ctrl+K`, type `tiroir-droit`) quitte `logique/navigation.ts` EN MÊME TEMPS que `lib/navigation/config.ts` (7 entrées, verrou `tests/unit/angular/carte-logique-paritaire.test.ts`) ; le rail, l'Aide et `carte.page.ts` ne la filtrent donc plus (plus rien à filtrer), et `EtatCarteService.choisirEntree` ne connaît plus `tiroir-droit`. **Réglages** : sections « Modèle IA » (Mistral/Gemini) et « Vues sauvegardées » retirées, comme dans `SettingsOverlay.tsx` (3 sections : Fond de carte, Apparence, Back office). **Accueil** : tuile de session « geo.prompt / Copilote IA » retirée (grille de 3, comme `/dashboard`) ; la carte de navigation « geo.prompt / Carte + IA » devient « Carte / Calques et analyses », côté React aussi. Le catalogue d'interface montre une autre tuile cliquable. L'icône `etincelles` est retirée du registre (`ui/icone/icones.ts`, 58 tracés ; round de correction 1) puisqu'elle n'avait plus de consommateur. **Bandeau d'erreur React** : `components/map/BandeauErreur.tsx` rend de nouveau l'état `error` de `app/map/page.tsx` (refus de périmètre ou délai du Voronoï, erreurs OOH / bataille / isochrones), muet depuis le retrait de `ChatPanel` — alerte `role="alert"` aux jetons `--danger`, croix de fermeture, effacé à la prochaine action (`setError(null)` en tête de chaque action) ; exception assumée au gel P5. `ORS_MAX_POIS_CHAT` devient `ORS_MAX_POIS_DEFAUT` ; `SavedMap` (`types/spatial.ts`) est retiré.
- **La carte en parcours — barre, fil, panneau d'étape, clavier ; le rail retiré (parcours de la carte, lot 1, T4, 2026-10-13)** : spec `docs/superpowers/specs/2026-10-13-carte-en-parcours-design.md`. `/app/carte` devient un PARCOURS (`logique/parcours.ts`, T1) — sept étapes à T4, HUIT depuis T4c (même jour, ordre du module risque) : ① Périmètre › ② Données › ③ Zones › ④ Analyse › ⑤ Jeu de zones › ⑥ Plan › ⑦ Activation › ⑧ Live ; l'étape vit dans `?etape=` (`etat/parcours.service.ts`, `ParcoursService`, fourni par la page, T2 : `replaceUrl`, `merge`, navigation relative, défaut `perimetre` non écrit, valeur illisible réécrite une fois). **Mise en page** : l'hôte `mg-carte-principale` est une colonne — `parcours/barre-parcours.component.ts` (`mg-barre-parcours`, 44 px : logo 18 px, fil d'Ariane « où je regarde » nourri par le filtre de ① — « France entière » le retire, c'était la croix de l'ancienne puce —, `mg-fil-etapes` « où j'en suis », puis « Script bidding DV360 » (zone du lien `?customZone=`) et « Plan média (n) » (plan fermé) quand ils ont un objet, « Tout effacer », mode immersif, thème, session) ; puis le conteneur carte `[data-zone-carte]`, SEUL dans sa rangée (carte, badge de zoom, panneau d'étape, détail IRIS, zone active, tiroir Street View, légende, plan média `[haut]=0`, boîte à outils et annonces — T5 ci-dessous ; le sélecteur compact FOND de T4 est retiré en T5). **Le panneau d'étape FLOTTE sur la carte (T4b, 2026-10-13, demande de Vincent : « le tiroir de gauche ça doit être un overlay comme on avait avant »)** — à T4 il était un `aside` DANS le flux, à côté de la carte, et l'ouvrir ou l'élargir rétrécissait la carte. `parcours/panneau-etape.component.ts` (`mg-panneau-etape`) rend désormais une carte `absolute z-40` posée dans `[data-zone-carte]`, cadre de l'ancien panneau du rail (`rail/panneau.component.ts`, retiré à T4) : 12 px du haut et de la gauche, hauteur AJUSTÉE au contenu de l'étape courante et bornée à `max-h-[calc(100%-24px)]` (au-delà elle défile ; une étape courte comme ③ Zones ne pose plus un grand pan vide sur la carte — la page ne laisse que l'étape courante dans le flux, les étapes quittées restent montées en `absolute` invisible), coins 12 px, `border-fin border-default`, fond OPAQUE `--surface` (sans le flou de React, un fond translucide laisserait lire la carte et la légende au travers), ni ombre ni flou ; largeur 320-900 px, 480 par défaut, bornée par la place libre : le conteneur moins `reserveDroite` (= `decalageOutils()` de la page, qui suit plan média, détail IRIS et Street View, ruling AT-3) et `JOUR_DROIT_PANNEAU` (128 : colonne d'outils 48 + 80 pour le badge de zoom) — un panneau élargi RÉTRÉCIT quand le plan média s'ouvre au lieu de passer sous lui et sous les outils (mesuré : 700 → 668 px, badge 690-737, outils à 778, plan média à 840) ; poignée `role="separator"` sur son BORD DROIT, capturée sur ELLE-MÊME ; consigne d'une ligne de l'étape ; repli « carte seule » en `visibility: hidden` (jamais démonté), rouvert par l'onglet `[data-afficher-panneau]` au bord gauche de la carte ; largeur et repli LOCAUX, jamais dans l'URL. La carte garde toute sa largeur, panneau ouvert, replié ou élargi. **`--emprise-panneau`** : le composant expose `emprise()` (`min(marge 12 + largeur px, 100% - (réserve + 140) px)`, `0px` replié ou en immersif — le `100%` se résout contre le conteneur à l'endroit où la variable sert), que la page pose en propriété CSS sur `[data-zone-carte]` ; le badge de zoom (+10 px), `mg-zone-active` (+12 px) et la légende (+12 px) s'y alignent par `left-[calc(var(--emprise-panneau,0px)+…)]` — rien ne reste caché dessous. **Marge MapLibre (round 1, I-1)** : flottant et ouvert par défaut, le panneau masquait la cible du centrage initial et des sept recadrages (zones custom, lien de zone, bataille, zones à risque, clusters, POI, radio). `couches/marge-carte.ts` (`suivreMargeCarte`, un `effect` appelé par la page) pose `setPadding({ left: panneau.decalageCarte(), right: decalageOutils() })` sur chaque carte publiée, donc aussi après la recréation par changement de fond ; `decalageCarte` = 12 + largeur POSÉE (au relâcher de la poignée, pas à chaque pixel), 0 replié ou en immersif. Dans MapLibre 5.18 (`camera_helper.ts`, `cameraForBoxAndBearing`), la largeur utile d'un `fitBounds` retranche `tr.padding` ET le `padding` de l'appel : les appelants gardent leur padding scalaire. ⚠ `setPadding` est un `jumpTo` qui ARRÊTE le mouvement en cours — « Afficher » une zone ouvre le plan média dans le même tour que son `fitBounds`, qui n'aboutissait jamais : une marge qui change pendant un mouvement attend le `moveend`, puis recadre ce que montrait l'ancienne partie libre (coins dé-projetés) dans la nouvelle (`fitBounds` 300 ms). La largeur est ramenée à la largeur RENDUE (bornée par `max-width`) à la saisie et au relâcher de la poignée, et `JOUR_DROIT_PANNEAU` = `ECART_TIROIR` (exporté de `boite-outils`) + 80. Tests : `marge-carte.spec.ts` (pose, suivi, carte recréée, attente du `moveend` puis recadrage), `panneau-etape.component.spec.ts` (cadre, poignée, emprise, `decalageCarte`, largeur rendue), `carte.page.spec.ts` (« T4b » : le panneau est dans le conteneur carte, en `absolute`, le conteneur seul dans sa rangée et inchangé à l'élargissement, au repli, à la réouverture, au changement d'étape ; étape courante dans le flux, quittée `absolute` ; emprise ouverte → `0px` repliée ou en immersif ; détail IRIS ouvert → place libre et emprise reculent de 330 px), `zone-active.component.spec.ts`, `legende-carte.component.spec.ts`. **Panneaux montés à la première visite puis gardés** (arbitrage A1) : `@for` sur les étapes visitées, l'étape quittée `invisible` + `inert` + `aria-hidden`, jamais `@if` — ① `mg-panneau-filtre`, ② `mg-panneau-calques`, ③ `mg-panneau-zones`, ④ `mg-panneau-analyse`, ⑤-⑧ `mg-etape-bientot` (T3, T4c) ; cinq bascules après une première visite de ① à ④ ne relisent rien (référentiel, zones, jeux, catégories — test « zéro relecture »). **Clavier** : garde de saisie, puis Échap → pile (le panneau d'étape n'y est pas : il ne se ferme pas, il se replie), puis RIEN sous le module risque (un raccourci n'écrit pas l'URL de la carte dessous), puis `Alt+1…Alt+8` → étape (T4c ; `Alt+1…Alt+7` à T4), lus sur `KeyboardEvent.code` (Digit/Numpad) avant `key` — Alt+1 marche en AZERTY ; Alt+C et Ctrl+K ne sont plus captés. Le focus revient à l'hôte quand ce qui le portait devient inatteignable (étape quittée, panneau replié, barre retirée par l'immersif). **Mode immersif** (`EtatCarteService.immersif`, ex-`railMasque`, pile `'immersif'`) : barre retirée, `aside` caché (panneaux MONTÉS), bouton `[data-quitter-immersif]` dans la boîte à outils (T5). **Pastilles « renseignée »** (A2) : ① = filtre ou Métro/+DROM posé ; ② = dégradé, POI choisis, TMJA, radio, sites ICPE ou PPRT — PARTIELLE jusqu'à T13 (ruling AT-4 : OOH et transport vivent dans un service du panneau Calques). **Retirés** : `rail/` (rail, barre du haut, cadre `mg-panneau-carte`), `filtre/puce-filtre`, `commun/boutons-flottants`, et `logique/navigation.ts` (copie Angular du rail React, sortie de `tests/unit/angular/carte-logique-paritaire.test.ts` ; React, gelé, garde `lib/navigation/config.ts`) ; `EtatCarteService` perd `entreeActive`/`choisirEntree`/`fermerEntree` et la réservation de clics (`reserverClics`/`clicReserve`, et `ClustersService.pointSous`) qui n'avait plus de lecteur une fois le « clic hors du panneau » retiré. `AideComponent` est réécrite (aide de l'étape courante + raccourcis dérivés de `ETAPES_CARTE`), montée en T5 (boîte à outils), comme les Réglages.
- **La boîte à outils de la carte — fond, légende, aide, réglages (parcours de la carte, lot 1, T5, 2026-10-13)** : spec § 6. `outils/boite-outils.component.ts` (`mg-boite-outils`, dans le conteneur carte `[data-zone-carte]`, hors du `@for` du fond : elle survit à la recréation de la carte) : une colonne `role="toolbar"` en haut à droite — Fond de carte, Légende, puis (filet) Aide, Réglages ; en mode immersif, le bouton `[data-quitter-immersif]` s'y ajoute (il était posé seul sur la carte en T4). Les outils à tiroir ouvrent UN tiroir de 320 px à gauche de la colonne (`[data-tiroir-outil]`, en-tête à point teal, croix) ; la Légende est une bascule (`OutilsCarteService.legendeVisible`, la page rend `mg-legende-carte` sous `@if`). **État** : `outils/outils-carte.service.ts` (`OutilsCarteService`, fourni par la page) — `outil` (un seul à la fois), `visites`, `legendeVisible`, `revisionZones`/`zonesModifiees()` (pour « Mes zones », T6) ; l'outil ouvert est dans la pile Échap sous l'id `'outil'` (dernier ouvert = premier fermé, avec l'immersif). **Contenu monté à la première ouverture puis GARDÉ** (ruling AT-6, patron A1) : tiroir fermé `invisible` + `inert` + `aria-hidden`, outil quitté `hidden` + `inert` — rouvrir rend la même instance. Contenus : **Fond de carte** = `commun/choix-fond.component.ts` (`mg-choix-fond`, la section Fond des Réglages sortie en composant ; le sélecteur compact `commun/fond-compact.component.ts` est SUPPRIMÉ) ; **Aide** = `mg-aide` (aide de l'étape courante, suit `?etape=`) ; **Réglages** = `mg-reglages` (Apparence, Back office — plus de section Fond, plus d'`input`/`output` ; « Accès » et « Health check » de nouveau atteignables depuis la carte, liens relatifs à la route `carte`). **Écart au bord droit** (ruling AT-3, `ecartOutils`) : 10 px, plus le plus large des panneaux ouverts à `right: 0` — plan média 600, détail IRIS 320, tiroir Street View 420 — et 10 px de jour (le plus large, pas la somme : ils se recouvrent) ; le tiroir ne déborde jamais à gauche du conteneur carte (`largeurMaxADroite(écart + 48)` : plan média ouvert sur 1 440 px, il rétrécit au lieu d'être coupé) ; les annonces (`mg-annonce`) sont PROJETÉES dans `mg-boite-outils`, SOUS la colonne et sur son bord droit (`[data-colonne-outils]`, flex colonne `items-end`, `z-[46]` au-dessus du tiroir) : elles descendent avec la colonne quel que soit le nombre d'outils, et la colonne est bornée à `largeurMaxADroite(droite)` = `calc(100% - droite - 10px)` — les annonces (280-380 px) rétrécissent au lieu de sortir du conteneur carte, qui les coupait (relecture T5, I-1 : à 996 px du bord, plan média et tiroir ouverts, elles étaient invisibles). Le focus revient à l'hôte quand le tiroir qui le portait se ferme.
- **« Mes analyses » et « Mes zones » dans la boîte à outils (parcours de la carte, lot 1, T6, 2026-10-13)** : spec § 6. Deux entrées EN TÊTE de `OUTILS` — « Mes analyses » (icône `fiole`) et « Mes zones » (`formes`) —, deux tiroirs montés à la première ouverture puis gardés (ruling AT-6). **Mes analyses** : `outils/outil-mes-analyses.component.ts` (`mg-outil-mes-analyses`, fournit `MesAnalysesService`) ; `mes-analyses.{component,service}.ts` DÉPLACÉS de `panneaux/calques/` vers `outils/` — le groupe « Mes analyses » du panneau Calques est retiré. `GET /api/analyses` à la PREMIÈRE ouverture de l'outil, jamais au chargement ; fermer et rouvrir ne relit rien, sauf après un échec. « Rejouer » un score, à la réussite, peint la carte ET ouvre l'étape Analyse (`ParcoursService.choisir('analyse')`, ruling AT-7 ; ③ à T6, ④ depuis T4c). **Mes zones** : `outils/outil-mes-zones.component.ts` (`mg-outil-mes-zones`) rend `mg-jeux-de-zones` puis `mg-mes-zones` (recherche, puces, opérations, affichage, export, suppression), SORTIS du panneau Zones (④ à T6, ③ depuis T4c) ; « Afficher » une zone ne change pas d'étape (AT-7). Le panneau Zones (`panneau-zones.component.ts`) garde « Créer une zone » et un renvoi « Ouvrir « Mes zones » » (`[data-ouvrir-mes-zones]`, ouvre l'outil sans changer d'étape) ; chaque zone créée appelle `OutilsCarteService.zonesModifiees()`, et `mg-mes-zones` se relit par `[rafraichir]="revisionZones()"` sans être recréé (la sélection survit). Aucune route ni table nouvelle.
- **Carte en parcours, lot 1 (2026-10-13) — synthèse et inventaire « aucune fonction perdue » (T7)** : spec `docs/superpowers/specs/2026-10-13-carte-en-parcours-design.md` § 12 (lot 1 : « la nouvelle navigation, sans aucune perte »), synthèse des puces T4, T5, T6 ci-dessus. **Ce qui compose le parcours** : `logique/parcours.ts` (les étapes — sept à T7, huit depuis T4c —, libellés, consignes, raccourcis — seule définition, T1) ; `etat/parcours.service.ts` (`ParcoursService`, fourni par la page) et `?etape=` (défaut ① non écrit, valeur illisible réécrite une fois, T2) ; `parcours/barre-parcours.component.ts` (fil d'Ariane du filtre, fil d'étapes, « Script bidding DV360 » et « Plan média (n) » quand ils ont un objet, « Tout effacer », immersif, thème, session) ; `parcours/panneau-etape.component.ts`, panneau de chaque étape MONTÉ à la première visite puis gardé (A1) — carte FLOTTANTE au-dessus de la carte depuis T4b (la carte garde toute sa largeur ; `couches/marge-carte.ts` lui pose `setPadding` pour que centrage et recadrages visent la partie libre) ; boîte à outils `outils/boite-outils.component.ts`, six outils (Mes analyses, Mes zones, Fond de carte, Légende, Aide, Réglages) ; ⑥-⑧ « bientôt » (`parcours/etape-bientot.component.ts`) avec le lien vers l'écran React si la clé FACULTATIVE `urlApplicationReact` de `config.local.json` est posée (recopiée de `NEXT_PUBLIC_APP_URL` par `npm run config` ; absente sur ce poste, voir la puce T8 du lot 4 et la table des variables), et ⑤ Jeu de zones « bientôt » sans lien (T4c) ; `Alt+1…Alt+8` lus sur `KeyboardEvent.code`. **Retirés** : `rail/` (rail, barre du haut, cadre `mg-panneau-carte`), `filtre/puce-filtre`, `commun/boutons-flottants`, `commun/fond-compact` (sélecteur compact « FOND »), `logique/navigation.ts` ; le groupe « Mes analyses » des Calques. **Arbitrages A1-A9** (plan `docs/superpowers/plans/2026-10-13-carte-en-parcours-lots-1-2.md`) : A1 panneau d'étape monté à la PREMIÈRE visite puis gardé (`invisible` + `inert`), jamais tous au chargement (prefetch interdit) ; A2 le lot 1 n'écrit QUE `etape`, pastilles ① (filtre ou périmètre) et ② (un calque allumé), `?customZone=` sans `etape` ouvre l'étape Zones (④ à T7, ③ depuis T4c) ; A3 bandeau KPI par étape REPORTÉ (pas de bandeau vide) ; A4 `Alt+1…Alt+7` (`Alt+1…Alt+8` depuis T4c) par `code` puis `key`, Alt+C retiré, inertes sous le module risque, Échap = pile ; A5 barre sans titre ni croix, Plan média et Script DV360 dans la barre jusqu'aux lots 6-7 ; A6 six outils, « Fiche » attend le lot 8 (détail IRIS et Street View restent sur la carte) ; A7 ⑤-⑦ (⑥-⑧ depuis T4c) « bientôt » + lien `/map?tab=strategie|activation|suivi` si `urlApplicationReact`, jamais une URL inventée ; A8 corrélation dans l'étape Analyse (③ à T7, ④ depuis T4c), section « Zones à risque industriel » et route `carte/risques` inchangées jusqu'au lot 4, navigations vers `risques` en `merge` ; A9 `logique/navigation.ts` supprimé, React gelé garde son rail. Rulings d'exécution : AT-6 tiroirs d'outils montés à la première ouverture puis gardés ; AT-7 « Rejouer » une analyse ouvre l'étape Analyse (`choisir('analyse')`, ④ depuis T4c), « Afficher » une zone ne change pas d'étape. **Inventaire verrouillé** : `carte.page.spec.ts`, describe « aucune fonction perdue (spec § 12, lot 1) » — `INVENTAIRE`, une ligne par fonction de l'ancienne carte avec sa nouvelle place (étape par `Alt+n`, ou outil cliqué) et ses sélecteurs de preuve : filtre ①, fil d'Ariane, calques ②, « Créer une zone » ③, analyse ④ (numéros de T4c), jeux de zones et Mes zones (outil), Mes analyses (outil), fond (outil), Apparence (Réglages + bascule de la barre), Back office (`admin/acces`), les 9 raccourcis (8 étapes + Échap, depuis T4c) et l'aide de l'étape (Aide), légende (carte + bouton), Tout effacer, immersif (bouton de sortie dans la boîte à outils), DV360 (lien `?customZone=`, carte publiée d'abord), session, Plan « bientôt » (Alt+6 depuis T4c), badge de zoom. Le commentaire au-dessus d'`INVENTAIRE` dit où vit ce que le tableau ne prouve pas lui-même (relecture T7, corrigé en T4c) : pastille « renseignée » (describe « filtre unique »), entrée du module risque dans ② (`panneau-calques.component.spec.ts`, « Environnement (T12) ») et module lui-même (describe T13), « Health check » (`reglages.component.spec.ts`), « Plan média (n) » (describe T15), détail IRIS / zone active / Street View (test « la barre porte… ») et météo (describe T11). Une ligne qui échoue = une fonction PERDUE : la rétablir, jamais retirer la ligne. Fixture partagée `ZONE_DU_LIEN` au niveau du module. **Preuve navigateur** (`:4202`, super_admin, espace « dentsu.explore (interne) », deux thèmes) : les 22 lignes relevées sur la vraie page ; un aller-retour ①→④→①→④→① (numérotation à 7 étapes) ne lance AUCUNE requête `/api` hors tuiles (au chargement : `user/organizations`, `ref/geo`, `custom-geo/list`) ; `/app/carte?etape=zones&customZone=<id réel>` collé dans un nouvel onglet → ④ courante, géométrie lue une fois, carte recadrée sur la zone, bouton DV360 nommé. **Écarts à la spec à la livraison du lot 1** : panneau d'étape FLOTTANT au-dessus de la carte (T4b, demande de Vincent) là où le schéma du § 3 le pose en colonne qui partage la largeur ; pas encore de bandeau KPI (§ 3, A3) ; pas d'outil « Fiche » (§ 6, A6) — le détail IRIS et le tiroir Street View restent sur la carte ; tiroir des outils à GAUCHE de leur colonne, sur la carte ; « Plan média (n) » et « Script bidding DV360 » vivent dans la barre du parcours en attendant ⑥ Plan et ⑦ Activation (lots 6 et 7 ; ⑤ et ⑥ à T7) ; ⑤-⑧ « bientôt » depuis T4c. Aucune route ni table nouvelle.
- **Le parcours en 8 étapes, dans l'ordre du module risque (parcours de la carte, T4c, 2026-10-13)** : décision de Vincent du 13/10 (« le fil d'Ariane devait suivre la logique des zones à risque »), spec § 15. ① Périmètre › ② Données › ③ Zones › ④ Analyse › ⑤ Jeu de zones › ⑥ Plan › ⑦ Activation › ⑧ Live — comme Sites › Rayon › Couverture › Zones › Campagne : on définit des zones, on calcule SUR elles, puis on les convertit en codes postaux achetables. `ETAPES_CARTE` = `['perimetre', 'donnees', 'zones', 'analyse', 'jeu', 'plan', 'activation', 'live']` ; libellé de ⑤ « Jeu de zones » ; consignes de ③ (ce que le panneau offre AUJOURD'HUI : codes postaux, rayon, dessin, capture — rayons et isochrones comme TYPES de zone n'y sont pas encore), ④ (« Calculez sur ces zones… ») et ⑤ (seuil de couverture, CP retenus, taux d'utile, extraction). ⚠ **`?etape=` porte un IDENTIFIANT, jamais un numéro** : les liens d'avant restent valides par construction (`?etape=analyse` ouvre l'Analyse, désormais ④), `jeu` s'y ajoute, et il n'existe PAS d'alias numérique. `?customZone=` sans `etape` ouvre toujours `zones` (désormais ③). `Alt+1…Alt+8`, pavé numérique compris (`Alt+9` : rien). ⑤ est une étape « bientôt » (`mg-etape-bientot`) SANS lien même avec `urlApplicationReact` : React n'a rien d'équivalent hors du module risque (`lienApplicationReact` rend `null`, `ONGLET_REACT` reste ⑥-⑧). « Rejouer » une analyse appelle toujours `choisir('analyse')` (AT-7). **Le fil tient sur la largeur** : `mg-fil-etapes` gagne une entrée `compact` (défaut `false` : module risque et catalogue inchangés), posée par la seule barre du parcours, dont le conteneur du fil porte `@container` — une ligne par étape (`whitespace-nowrap`, `shrink-0`, `px-1.5`, 30 px de haut), et sous 640 px de conteneur (`@max-[640px]:sr-only`) les étapes NON courantes ne montrent plus que leur numéro, libellé gardé pour le lecteur d'écran et redit en infobulle (`title`). Mesuré : le fil complet en compact fait 638 px ; à 1 440 px il dispose de 642-702 px (tout lisible), à 1 280 px de 482 px (replié) ; la barre ne déborde jamais (`scrollWidth` = largeur de la fenêtre aux deux largeurs). Avant le correctif, « 5 Jeu de zones » passait sur deux lignes à 1 440 px. Le nom d'espace du badge de session reste borné à 120 px avec points de suspension, comme avant T4c (`mg-badge-session`, non modifié). Rien d'autre ne bouge : ni la boîte à outils, ni les outils entre panneaux (rayon et isochrones comme types de zone de ③, couverture par territoire dans ④, convertisseur en ⑤ : lots 4-5), ni aucun type de zone. Aucune route ni table nouvelle.
- **Suppression de l'IA — lot 6 (2026-10-12)** : configuration et verrou. `GET /api/admin/health` ne contrôle plus de clé de fournisseur d'IA (la ligne `MISTRAL_API_KEY` de la section « Variables d'environnement » disparaît de la page Santé ; `health.page.spec.ts` et `carte-verification.component.spec.ts` prennent `ORS_API_KEY` comme exemple). `next.config.js` : la CSP `connect-src` perd `api.mistral.ai` et `generativelanguage.googleapis.com`. `scripts/setup-check.ts` ne demande plus de clé Gemini. `.env.example` perd `GOOGLE_GENERATIVE_AI_API_KEY` et `MISTRAL_API_KEY` ; `.env.local` du poste n'est pas touché. `PATCH /api/admin/sources/[id]` n'accepte plus `ai_summary` (la colonne reste en base). Routes `/api/saved-maps` supprimées (voir « Export & Sauvegarde »). Verrou `tests/unit/securite/aucune-ia.test.ts` (aucun import `ai` / `@ai-sdk/*`, aucune clé ni hôte de fournisseur d'IA, aucun paquet d'IA dans `package.json`).
- **Interligne global 1,5 (lot Rendu R2, 2026-09-30)** : `angular/src/styles.css` (liste de l'hôte) passe de 1,6 à 1,5, le rendu EFFECTIF de React (préflight Tailwind ; `globals.css` n'en pose aucun). `DESIGN_SYSTEM.md` annonce « 1,6 pour le corps de texte » : contredit par le rendu réel de React, la parité l'emporte.
- **3 appels API simultanés au plus, pour toute l'application** (`limiteurInterceptor` + `SEMAPHORE_API`, `core/http/`), enregistré en premier PARMI LES NÔTRES — l'intercepteur XSRF d'Angular (`xsrfInterceptorFn`, ajouté par `provideHttpClient`) passe avant lui. Côté React la règle était tenue écran par écran ; ici elle ne dépend plus de la discipline de chaque écran. ⚠ Il ne voit que `HttpClient` : les requêtes de MapLibre (tuiles, GeoJSON) lui échappent.
- **Thème** : `ThemeService` (`core/theme/`), même clé de stockage que React (`magelian-theme`), tolérant à un stockage bloqué. Depuis l'isolation CSS, il RECOPIE la classe `light`/`dark` sur l'élément hôte de chaque racine d'ombre MAGELIAN enregistrée (`enregistrerRacine`), au moment même où il pose `themeApplique` : les jetons clairs y vivent sous `:host(.light)`, dont le `color-scheme` suit. Ce sont nos éléments. `<html>`, lui, relève de `ECRIRE_HTML` (puce suivante).
- ⚠ **`<html>` n'est JAMAIS écrit dans un hôte : jeton `ECRIRE_HTML` (revue finale du lot AIDA, 2026-09-30).** `InjectionToken<boolean>`, **défaut racine `false`** ; seul `app.config.ts` (lancement autonome) le fournit à `true`. À `false`, MAGELIAN n'écrit `<html>` ni au démarrage ni sur `basculer()` — ni classe ni `color-scheme`. La règle précédente (« on n'écrit qu'au premier passage sans classe ou sur une bascule ») écrivait encore dans un hôte sans classe (classe `dark` et `color-scheme` posés au montage) et réécrivait la classe du shell à chaque bascule. Dans l'hôte : démarrage sur la classe de l'hôte s'il en pose exactement une, sinon sur le stockage ; la bascule reste disponible et n'agit que sur nos racines (`:host(.light)`) et sur le stockage ; le suivi reste actif — quand le thème EXPRIMÉ par l'hôte change (il pose `light` ou `dark`), on l'adopte ; une mutation qui ne le change pas (classe étrangère au thème) ne défait pas une bascule ; un hôte qui RETIRE sa classe n'exprime plus rien et le thème courant est gardé. Mesuré au navigateur dans l'hôte par défaut, `<html>` SANS classe au départ (puce « Épreuve », plus bas). Verrouillé par `theme.service.spec.ts` (bloc « dans un hôte ») et `remote.spec.ts`.
- ⚠ **EN AUTONOME seulement (`ECRIRE_HTML` = `true`), règle de propriété du thème (lot AIDA, 2026-09-30) : le shell pose la classe, MAGELIAN la SUIT.** Un `MutationObserver` (filtre `class` sur `<html>`) recopie la classe dans `theme` et `themeApplique`, donc carte et courbes se repeignent sur un changement de l'hôte. MAGELIAN n'ÉCRIT `<html>` (classes ET `style.colorScheme`) que dans deux cas : son utilisateur bascule (`basculer()`), ou au premier passage quand `<html>` ne porte NI `light` NI `dark`. Au démarrage, une classe unique posée par l'hôte l'emporte sur le stockage. Seul un geste de l'utilisateur de MAGELIAN est persisté ; un changement de l'hôte ne l'est jamais, et un geste supplanté par l'hôte avant écriture est abandonné. Le `color-scheme` de `<html>` reste à l'hôte ; À L'INTÉRIEUR de MAGELIAN, il suit le thème de MAGELIAN (`:host` sombre, `:host(.light)` clair, en `!important` — voir « Isolation CSS »), jamais celui du shell. Lecture = ce que rend le CSS : `light` présente → clair, sinon sombre.
- ⚠ **Thème posé avant le premier affichage (lot 1, 2026-09-29)** : `ThemeService` n'appliquait sa classe qu'après le démarrage (config + session), donc un utilisateur en thème clair voyait le fond sombre pendant tout le démarrage. Un script inline dans `angular/src/index.html` (même patron que `themeInitScript` d'`app/layout.tsx` côté React) lit `localStorage['magelian-theme']` en `try/catch` et pose la classe ET `color-scheme` avant que quoi que ce soit d'Angular ne s'exécute ; `ThemeService` reste la source de vérité ensuite. **Ce script ne sert qu'en AUTONOME** : dans AIDA, le shell possède `index.html` et pose lui-même la classe — tranché le 2026-09-30 par la règle de propriété ci-dessus.
- **Carte et graphiques (lot 2, 2026-09-30)** : `mg-carte` (`angular/src/app/carte/`) ne porte que le CYCLE DE VIE de MapLibre — création après rendu, `ResizeObserver`, destruction — et rend la carte au parent, qui pose ses sources. `chargerParCadre` charge une donnée sur la bbox VISIBLE au `moveend` après 350 ms de calme et annule la requête précédente ; `lierCameras` porte le verrou de réentrance de `VueCartesZones.tsx` ; `contenuPopup` construit les popups par `textContent`. `mg-courbe` (`angular/src/app/graphiques/`) repose sur **Apache ECharts** en import modulaire (courbe, grille, infobulle, repère, rendu SVG), utilisé directement, sans `ngx-echarts`. MapLibre et ECharts sont dans des chunks PARESSEUX (chunk de l'ancienne page `/essai-carte`, supprimée au lot 4 T22 : 1,56 Mo brut, 383 kB transféré, mesuré au lot 2 ; ils vivent désormais dans le chunk de la carte principale). Paquet initial : **41 kB brut** (40,99 kB au build de production du 2026-09-30, revue finale du lot AIDA ; 40,8 kB à la tâche 4) — ce document annonçait 463 kB, le chiffre d'avant la fédération.
- **Écran d'essai sur le squelette risque (lot Rendu R11, 2026-10-03) — SUPPRIMÉ au lot 4 (T22, 2026-10-12)**, remplacé par la carte principale et le module risque ; ce qui suit est l'historique, les briques qu'il a introduites (`mg-reglette`, `mg-barre-progression`, `button[mgPastille]`…) vivent toujours. `features/essai-carte` reprenait la composition de `AnalysePopulationOverlay.tsx` à l'étape ② : en-tête (point teal, titre, `mg-fil-ariane`, `mg-fil-etapes` sur « Rayon », cible, résumé du profil, exports, croix « Fermer » = lien RELATIF `..`), barre commune en deux rangées (`mg-champ` + `select`, `button[mgPastille]`, une `mg-reglette` par niveau + cadenas « lier les niveaux »), `mg-barre-progression` ENTRE la barre et les chiffres, `mg-bandeau-kpi` toujours présent (tuiles « — » si la courbe échoue, comme React), puis panneau d'étape à gauche (480 px, poignée 320-900 px par capture de pointeur, replié par « Carte seule » en `width: 0` + `visibility: hidden`, jamais démonté) et carte permanente à droite, qui suit les changements de largeur par le `ResizeObserver` de `mg-carte`. Le curseur du panneau relit la courbe EN MÉMOIRE (aucun appel) ; une réglette de la barre ne recalcule qu'au RELÂCHEMENT : un `POST /api/risques/zones/preparer` (la préparation précédente est annulée), puis `setTiles` sur la source des zones. Le profil de l'essai (`ProfilEssai`, `poserBord`, `basculerLiaison`, `codeDuProfil`) est un MODÈLE MINIMAL que le lot 3 remplace par le port de `lib/risques/profil.ts`. Filtres, autres étapes, exports et résumé du profil sont rendus INERTES (`aria-disabled`, « Disponible prochainement »). `button[mgPastille]` passe au rayon 6 (`rounded-lg`) et, comme `mg-fil-ariane`, `mg-fil-etapes` et la valeur de `mg-reglette`, à `text-[12px]` : `text-xs` de Tailwind 4 impose un interligne de 16 px là où le style en ligne de React hérite 18 px ; 12 px à l'interligne React : écrire `text-[12px]` (aucun interligne imposé). `styles.css` porte la règle `prefers-reduced-motion` générique de `app/globals.css`. Rejoué dans l'hôte AIDA PAR DÉFAUT (prod et dev) : 0 différence sur la table de fuite, 0 propriété sur `<html>`, feuille hostile sans effet hors la limite connue (propriété personnalisée posée sur l'élément hôte). Tests (à l'époque) : `essai-carte.page.spec.ts`, `remote.spec.ts`.
- **Mobilier de carte (lot Rendu R9, 2026-10-03)** : `mg-carte` pose seule le zoom +/− sans boussole (haut droite) et projette son contenu (`<ng-content>`) par-dessus la carte ; elle émet `zoom` (à chaque image et à la première pose). `mg-legende` (`angular/src/app/carte/legende/`) est le CONTENEUR générique d'une légende (`--card-overlay`, bord 0,5 subtil, rayon 8, 260 px au plus), `mg-legende-niveaux` son contenu pour le module risque : un carré par anneau à l'opacité de sa bande, teinte par `var(--niveau-*)` DANS le DOM (jamais dans un `paint`), rayons en mono (ce sont des nombres). Les raccourcis de grappe, la légende et l'avertissement sous z7 se posent dans la page (`essai-carte` au lot Rendu, `mg-carte-risque` depuis le lot 3), comme dans `CarteRisque.tsx`. Popup : titre + UNE ligne tertiaire « statut · ville · nature » (`contenuPopup(titre, details)`), plus aucune valeur en mono (V8) ; marge intérieure de 8×10 px GARDÉE (arbitrage 3 : React la met à 0 et le texte touche le bord) ; entrée `popup-in` de 180 ms. L'avertissement utilise `--warning` en `color-mix` (Tailwind `warning/12`) et non le `rgba` en dur de React : identique en sombre, un peu plus foncé en clair.
- ⚠ **Plus de couleurs recopiées en hexadécimal pour MapLibre et ECharts** : `CouleursService.palette()` lit la valeur CALCULÉE des jetons de `styles/jetons.css` sur l'HÔTE de la racine d'ombre enregistrée (`ThemeService.racine()`, repli sur `<html>` hors racine), et suit le thème par `ThemeService.themeApplique` (qui ne change qu'une fois la classe posée). Côté React, ces valeurs vivaient en double (`lib/carte/palette-*.ts`) sous garde de tests de parité. Un nom de jeton inconnu LÈVE au lieu de peindre en noir.
- **Feuille MapLibre paresseuse (lot 2)** : `angular.json` déclare `maplibre-gl.css` en `styles` avec `inject: false` + `bundleName: 'maplibre'` ; Angular l'émet en `maplibre.css` sans l'ajouter à `index.html`, et `chargerFeuilleMaplibre()` (ex-`assurerFeuilleMaplibre`) pose un `<link>` à la création de la PREMIÈRE carte — DANS la racine d'ombre qui porte la carte depuis l'isolation CSS (un `<link>` du document n'y entre pas ; mesuré au navigateur, le `<link>` dans l'ombre fonctionne, erreur de chargement toujours remontée par `mg-carte`), dans `<head>` seulement hors racine. Elle ne pèse donc jamais sur le paquet initial. Son `href` est résolu contre l'application distante (`urlRessourceDistante('maplibre.css')`, lot AIDA, 2026-09-30) et non plus relatif au document : dans le shell, il vise bien le serveur de MAGELIAN (vérifié dans l'hôte jetable, voir plus bas). Les surcharges de popup et d'attribution portées de `app/globals.css` (fond `--bg-surface`, bordure `--border-default`, pointe, attribution discrète) vivent dans `angular/src/styles.css`, avec `!important` : sans lui, l'ordre entre le `<link>` MapLibre et la feuille adoptée déciderait (fond de popup blanc `#fff`, texte clair illisible en thème sombre).
- ⚠ **`.maplibregl-map` impose `position: relative`** et la feuille MapLibre (chargée à la demande) passe après Tailwind : un conteneur posé en `absolute inset-0` perdait son étirement et la carte restait à 300 px de haut, canevas noir. `mg-carte` ajoute `h-full w-full` ; le parent donne la hauteur à `<mg-carte>`. Trouvé au navigateur, invisible en test (carte factice).
- Les tuiles MVT restent chargées par MapLibre lui-même (cookie, via le proxy) ; les GeoJSON passent par `HttpClient`, donc par le limiteur de 3 appels et le jeton. Vérifié au navigateur le 2026-09-30 : tuiles `zones-risque` en 200, une seule requête de sites après un panoramique rapide sans inertie (un coup de doigt avec inertie peut en émettre deux, le premier `moveend` et celui de la fin d'inertie étant espacés de plus de 350 ms), KPI « habitants à moins de 5 km » égal à `lire_couverture_rayon` (13 841 288).
- **Épreuve dans un shell hôte jetable (2026-09-30).** Un hôte Angular 21.2.4 + Native Federation 21.2.1 `dynamic-host`, HORS du dépôt, sur `:4300`, manifeste `{ "magelian": "http://localhost:4201/remoteEntry.json" }`, route `outils/magelian` → `loadRemoteModule('magelian', './Routes')` → `remoteRoutes`, proxy `/api` → `:3000`, un bouton qui bascule `light`/`dark` sur `<html>`. Constaté au navigateur, sur `/outils/magelian/essai-carte` : page stylée dans le cadre de l'hôte, Inter et JetBrains Mono chargées ; `magelian.css`, `config.local.json` et `maplibre.css` demandés sur **:4201**, jamais sur :4300 ; API sur l'origine de l'hôte (`:4300/api/…`) avec `Authorization: Bearer`, `/api/map/risques-industriels?bbox=…` et tuiles `zones-risque` en 200 ; lien « Catalogue » → `/outils/magelian/catalogue` ; KPI **13 841 288** ; bouton de thème de l'HÔTE → carte et courbe repeintes, rien écrit dans `localStorage`, classe de l'hôte jamais réécrite. CORS : le serveur de dev du remote répond `Access-Control-Allow-Origin` à `:4300` sans aucun réglage. Session : le cookie `@supabase/ssr` posé en se connectant sur `:4201/connexion` est lu sur `:4300` (les cookies de `localhost` ignorent le port).
  - **Épreuve rejouée avec l'hôte PAR DÉFAUT, en développement ET en production (2026-09-30, tâche 7).** Le 1er passage avait échoué avec l'hôte tel que le génère le schématique (`ignoreUnusedDeps: true`) : `NG0203` sur `takeUntilDestroyed()`, parce que l'hôte ne partageait pas `@angular/core/rxjs-interop` et que la copie du remote importe les morceaux PRIVÉS de `@angular/core` par des chemins relatifs (`./_effect-chunk2.mjs`) — deux contextes d'injection, en production aussi (`inject(DestroyRef)` n'est pas réservé au développement). Correctif côté MAGELIAN : rxjs-interop retiré et interdit par la garde des imports partagés (plus haut). Rejoué avec la configuration GÉNÉRÉE de l'hôte (`ignoreUnusedDeps: true`, rien partagé à la main — son `remoteEntry.json` ne partage ni rxjs-interop ni `@angular/forms`), en deux passes : remote en `ng serve`, puis remote en build de PRODUCTION servi statiquement avec CORS (`http-server --cors`, hors dépôt ; l'hôte reste en `ng serve`). Aux deux passes : les sept vérifications ci-dessus refaites (page stylée, ressources sur :4201, API Bearer en 200, lien Catalogue, KPI **13 841 288**, thème de l'hôte suivi, fuite de styles toujours présente — tâche « isolation CSS ») ; accueil (**1 259** sites) ET essai de carte **sans aucune erreur en console** ; aucune ressource `rxjs-interop` chargée, `_angular_core` servi par l'hôte seul. **Sans session** (cookies effacés) : « Session requise… » dans le cadre, URL de l'hôte inchangée, aucun appel `/api/`, puis une connexion faite en place (`AuthService.connecter`, depuis la console) fait apparaître l'essai de carte **sans aucun événement de routeur** — ses appels d'API ne partent qu'à ce moment. **Limiteur mesuré DANS l'hôte** : quatre `compter()` simultanés sur l'instance de `SitesRisqueApi` du composant d'accueil (`ng.getComponent`, identique à `ng.getInjector(…).get`) → trois requêtes lancées à t≈2-7 ms, la quatrième à t≈4 620 ms, juste après la fin de la première (4 614 ms) ; même profil sur le build de production. Captures : `.superpowers/sdd/2026-09-30-angular-lot-aida-conformite/task-7-hote-*.png`.
  - **Hôte SANS `provideHttpClient()`** : fonctionne. En Angular 21, `HttpHandler` est `providedIn: 'root'`, donc `withRequestsMadeViaParent()` trouve toujours un gestionnaire parent et son erreur de développement ne se déclenche pas.
  - **Sans session**, au 1er passage, `authGuard` renvoyait vers `/connexion`, que l'hôte n'a pas (`NG04002`, cadre vide) : remplacé par le message « Session requise… » (`STRATEGIE_SANS_SESSION`, plus haut). La connexion elle-même dans AIDA reste une question ouverte.
  - ⚠ **Fuite de styles, mesurée le 2026-09-30 AVANT l'isolation CSS (historique — corrigée, puce suivante)** : `magelian.css` restyle TOUT le document hôte, et le lien n'est jamais retiré (il reste après être revenu sur une page de l'hôte). `body` : marge 12 px → 0, fond → `--bg-level-0`, police Georgia → Inter, 15 px → 13 px ; `html` : police et `line-height` de Tailwind ; `ul` : puces et marges supprimées ; `a` : couleur et soulignement supprimés ; `button`/`input` sans classe : fond, bordure et padding remis à zéro ; `h1` : graisse 700 → 400 (sa taille et sa marge, posées par une règle NON étagée de l'hôte, résistent : le preflight de Tailwind 4 vit dans `@layer base`). Un bouton stylé par classe garde ses couleurs mais prend la police. Et **123 propriétés personnalisées** posées sur `:root`, dont des noms génériques (`--surface`, `--overlay`, `--elevated`, `--radius`, `--spacing`, `--danger`, `--success`, `--warning`, `--info`, `--font-sans`, `--text-*`, `--ease-*`, `--tw-*`). Tâche « isolation CSS » à suivre.
  - Le 1er passage avait été mesuré en `ng serve` seul ; le rejeu de la tâche 7 couvre aussi le build de production du remote (l'hôte, lui, reste en développement).
- ⚠ **Isolation CSS (lot AIDA, tâche 8, 2026-09-30) : toute l'interface vit dans des RACINES D'OMBRE.** Approche retenue après une épreuve comparée (racine d'ombre contre CSS confinée sous `.mg-racine` + jetons `--mg-*` : la seconde laissait l'hôte restyler MAGELIAN — ses règles `h1`/`button`/`a` et un simple `.absolute{position:static}` cassaient la carte — et imposait de renommer chaque `var(--x)` porté depuis React ; rapport `.superpowers/sdd/2026-09-30-angular-lot-aida-conformite/task-8-report.md`).
  - **Un seul chemin dans les deux modes.** `RacineDistanteComponent` (racine de `remoteRoutes`) et `ConnexionPage` (autonome, hors d'elle) sont en `ViewEncapsulation.ShadowDom` et appellent `monterRacineOmbre()` (`layout/racine-ombre.ts`) : adoption de la feuille, enregistrement de l'hôte auprès de `ThemeService`.
  - **`magelian.css` n'est JAMAIS posée dans le document.** `DemarrageService` la LIT (`LIRE_FEUILLE`, `fetch` de l'application distante) — d'où l'exigence CORS de la section « Exigences de déploiement » plus bas : un `<link>` s'en passait, un `fetch` échoue sans (mesuré présent : `ng serve` renvoie `Access-Control-Allow-Origin` à l'origine appelante, `http-server --cors` à `*`). Puis elle la CONSTRUIT (`CONSTRUIRE_FEUILLE`, `new CSSStyleSheet({ baseURL: href }).replace()`), avant que la racine n'existe ; la racine l'ADOPTE (`ADOPTER_FEUILLE`) de façon synchrone à sa création — aucun instant sans style. Tout échec rejette en nommant le fichier. `monterRacineOmbre()` LÈVE (message français nommant l'élément) si une feuille existe mais que le composant n'a pas de racine d'ombre : jamais d'écran sans style en silence. Ces trois jetons sont les coutures des specs : jsdom n'a ni `fetch` distant ni `adoptedStyleSheets` (`core/ressources/testing/feuilles-factices.ts`).
  - **Trois réécritures à la lecture** (`preparerFeuilleOmbre`, `core/ressources/feuilles.ts`) :
    - les `@import` sont retirés (`replace()` les refuse) ;
    - chaque `@property` de Tailwind est réécrite en déclaration (`proprietesEnVariables`) — Chrome IGNORE `@property` dans une racine d'ombre : mesuré, la bordure de la barre latérale (`border-r`) y perdait son style. `inherits: false` (toutes celles de Tailwind) → posée sur chaque élément, le repli que Tailwind émet déjà pour les navigateurs sans `@property`, qui rétablit le non-héritage (mesuré : un parent `font-medium` porte `--tw-font-weight: 500`, son enfant rien) ; `inherits: true` → posée sur `:host` seul. Les règles `@property` d'origine sont RETIRÉES : un navigateur qui les honorerait dans l'ombre les enregistrerait pour tout le document, donc pour le shell ;
    - chaque `rem` des valeurs est converti en px, base 16 (`remEnPx`) : `rem` renvoie à la taille de police de `<html>`, qui appartient au SHELL. Mesuré à la revue : un `* { font-size: 20px }` du shell faisait passer le titre de page de 18 à 22,5 px ; avec `html { font-size: 62.5% }` (courant), tout MAGELIAN rétrécissait. Seule une valeur ISOLÉE est convertie, jamais un `rem` collé à un nom (`var(--gap-2rem)`, `.x-1rem` : lookbehind `(?<![\w-])`). ⚠ **Compromis, en autonome aussi** : le rendu est identique pour qui garde la taille de police par défaut du navigateur (16 px), mais un utilisateur qui l'a AGRANDIE perd la mise à l'échelle que `rem` lui aurait donnée — il ne lui reste que le zoom de page. Ce document écrivait « identique tant que `<html>` reste à 16 px, donc en autonome » : faux pour cet utilisateur-là. Les styles de COMPOSANT ne passent pas par cette conversion (compilés dans le JavaScript) : ils ne portent aucun `rem`, garde `tests/unit/angular/gardes-styles.test.ts`. `maplibre.css` (un `<link>`, non réécrit) porte un seul `rem`.
  - **Polices au niveau du DOCUMENT, dans les deux modes** : une `@font-face` est ignorée dans une racine d'ombre. `styles/polices.css` (paquet `magelian-polices`, uniquement l'`@import` Google Fonts, incorporé en `@font-face` au build de production) est posé dans le `<head>` par `DemarrageService`. C'est la seule FEUILLE MAGELIAN du document de l'hôte ; elle ne change aucun style calculé (mesuré), ne porte aucune `@property`. Le document reçoit aussi, par Angular, les `<style>` des composants confinés par attribut (point suivant sur les portails).
  - **`:host` : `all: initial` NORMAL, puis chaque propriété HÉRITÉE en `!important`** (`styles.css`, verrouillé par `tests/unit/angular/isolation-hote.test.ts` — `pointer-events` et `-webkit-tap-highlight-color` compris depuis la revue finale : un voile `pointer-events: none` du shell rendait sinon MAGELIAN inerte). Deux règles de la cascade : pour des déclarations NORMALES, le contexte EXTÉRIEUR l'emporte sur `:host` — un `* { font-family: Georgia; color: red }` du shell atteint notre élément hôte, bat `all: initial` et descend sur tout MAGELIAN (trouvé à la revue : la première feuille hostile ne visait `*` que pour les marges) ; pour des `!important`, c'est le contexte INTÉRIEUR qui gagne. `all` reste normal, sinon il figerait `display` et `height` et le shell ne pourrait plus dimensionner le cadre ; `display`, `height` et `visibility` (un shell peut cacher un onglet) restent normaux, exprès. `direction` et `unicode-bidi` sont exclues de `all` par la spécification (mesuré : `direction: rtl` traversait) : fixées elles aussi. Les propriétés personnalisées ne sont pas touchées par `all` : les jetons de `:host(.light)` s'appliquent (mesuré sous la feuille hostile, thème clair). ⚠ Limite connue, NOTÉE et non corrigée : une propriété personnalisée posée PAR LE SHELL sur l'élément hôte lui-même (`mg-racine-distante { --surface: … }`, ou en `!important`) peut encore y forcer un jeton — nos jetons sont déclarés sur `:host`, que le contexte extérieur bat en déclaration normale.
  - **`color-scheme`** : `all: initial` le remettait à `normal` — barres de défilement, champs, listes et remplissage automatique en CLAIR dans le thème sombre (trouvé à la revue). Reposé `dark !important` sur `:host` et `light !important` sur `:host(.light)` : il suit le thème de MAGELIAN, jamais celui du shell. Mesuré : champ-sonde dans la racine, `select` et `range` du catalogue, champs de la connexion autonome — `dark`/`light` selon le thème, y compris quand le shell impose `color-scheme: light` sur `*` et sur `mg-racine-distante`.
  - **Jetons** : `:root, :host` et `html.light, :host(.light)` (`styles/jetons.css`). `:host-context(html.light)` écarté : ni Firefox ni Safari ne l'implémentent, et un sélecteur invalide dans une liste annule toute la règle. `tests/unit/angular/jetons-paritaires.test.ts` exige les deux portées.
  - **Autonome** : `index.html` pose `magelian-document.css` (`styles/document.css` : jetons + `html, body { height: 100%; margin: 0; background }`) pour le fond AVANT que la première racine ne monte ; le script inline pose classe et `color-scheme`. Le shell n'exécute jamais ce fichier.
  - ⚠ **Rien ne doit s'afficher HORS d'une racine d'ombre** : un portail vers `document.body` (ou `querySelector('body')`), un overlay du CDK, une infobulle `appendTo: 'body'` ou un élément `position: fixed` (feuille, `.style.position`, `[style.position]`, classe `fixed`, `host: { class }`) s'afficheraient SANS style (et dans le document de l'hôte). Et **Angular (SharedStylesHost) recopie AUSSI les styles des composants dans le `<head>` du DOCUMENT**, en plus des racines d'ombre : ils n'y sont inoffensifs que parce qu'ils sont confinés par attribut (`_ngcontent-…`, animations renommées) — `::ng-deep` et `ViewEncapsulation.None` lèveraient ce confinement et atteindraient le shell. Garde : `tests/unit/angular/portails-hors-ombre.test.ts` (commentaires retirés, non vide par construction, un cas d'autotest par motif). Une seule exception nommée : `core/demarrage/erreur-demarrage.ts`, qui remplace le `<body>` quand Angular LUI-MÊME ne démarre pas — appelé seulement par `main.ts`/`bootstrap.ts`, que le shell n'exécute pas. Hors de toute racine, `magelian.css` ne l'atteint pas : il porte donc des styles EN LIGNE neutres (marges, tailles, `color: inherit`, aucune couleur en dur) — il portait jusqu'à la revue finale des classes Tailwind sans aucun effet. Les popups MapLibre et l'infobulle ECharts sont rendues dans leur conteneur, donc dans l'ombre (mesuré). Pour une fenêtre modale future : `<dialog>` natif ou l'API popover (couche supérieure, mais dans l'arbre).
  - **Mesuré dans l'hôte PAR DÉFAUT (`ignoreUnusedDeps: true`), remote en build de production ET en `ng serve`** : tableau de la tâche 6 rejoué (15 propriétés × 9 éléments de l'hôte) → **0 différence**, **0 propriété personnalisée** sur `<html>` (avant : 65 différences et 123 propriétés, dont les 2 `--tw-*` issues des enregistrements `@property` — il n'y en a plus aucune au niveau du document) ; feuille d'hôte hostile (utilitaires homonymes, remise à zéro façon Material, `:root` qui redéfinit `--surface`, `--text-primary`, `--brand-teal`…, et depuis la revue : `html { font-size: 62.5% }`, `* { font-family: Georgia; color: red; letter-spacing: 3px; line-height: 3; text-transform: uppercase; color-scheme: light; direction: rtl }`, une règle sur `mg-racine-distante` elle-même) → **aucun changement** dans MAGELIAN, dans les deux thèmes, prod et dev ; carte stylée, tuiles 200, vraie popup (ouverte au clic d'un site, refermée par son bouton), glisser de la carte à la souris (nouvelle bbox chargée), courbe et infobulle, KPI **13 841 288**, logo teal, polices, thème piloté par l'hôte (classe recopiée sur `mg-racine-distante`, `<html>` jamais réécrit, rien mémorisé), erreur de démarrage et « Session requise… » stylés. Autonome, build de production : connexion (dans sa propre racine) → page → déconnexion, clair et sombre, carte et courbe repeintes. Captures : `.superpowers/sdd/2026-09-30-angular-lot-aida-conformite/task-8-final-*.png`.
  - **Gardes de l'isolation (revue finale)** : `tests/unit/angular/gardes-styles.test.ts` échoue si une entrée `styles` d'`angular/angular.json` perd `inject: false` (Angular la poserait dans le `<head>` du document du shell) et si un `styles`/`styleUrl(s)` de composant sous `angular/src/app` contient un `rem`.
- **Épreuve `<html>` SANS classe dans l'hôte par défaut (revue finale du lot AIDA, 2026-09-30, I1).** Hôte jetable à sa configuration GÉNÉRÉE (`ignoreUnusedDeps: true`), son `index.html` privé de sa classe `dark` le temps de la mesure, remote en `ng serve`, stockage de l'origine de l'hôte à `light`, un `MutationObserver` d'attributs posé sur `<html>` AVANT d'entrer dans MAGELIAN. Montage de `/outils/magelian/essai-carte` : `<html>` reste `class=""` sans attribut `style`, **zéro mutation** ; la racine prend le thème STOCKÉ (`mg-racine-distante.light`, `color-scheme: light`, fond blanc). Bascule de MAGELIAN : racine en `dark` (`color-scheme: dark`, fond `rgb(5, 5, 5)`), stockage `dark`, `<html>` toujours sans classe ni style, **zéro mutation**. Puis l'hôte pose `light` puis `dark` : suivis ; une bascule de MAGELIAN ensuite met la racine en clair sans réécrire le `dark` de l'hôte (les 3 mutations relevées sont toutes celles des deux clics de l'hôte). Console : 0 erreur, 0 avertissement. Autonome (`:4201`), inchangé : la bascule écrit bien classe, `color-scheme` et stockage. Captures : `.superpowers/sdd/2026-09-30-angular-lot-aida-conformite/final-fix-hote-*.png`.
- ⚠ **Exigences de déploiement (revue finale du lot AIDA, 2026-09-30).** Aucun déploiement n'existe ; ces exigences s'imposeront au premier. Pas de mécanisme de version des fichiers pour l'instant (arbitrage) :
  - **`Cache-Control: no-cache`** (revalidation à chaque chargement) OBLIGATOIRE sur les fichiers chargés à l'exécution SANS empreinte dans leur nom : `magelian.css`, `magelian-polices.css`, `maplibre.css`, `config.local.json` et `remoteEntry.json`. Sans lui, un déploiement laisse le shell sur l'ancienne feuille, l'ancienne configuration ou l'ancien manifeste de fédération — donc des chunks qui ne correspondent plus. Les chunks, eux, portent une empreinte et peuvent être mis en cache longtemps.
  - **CORS** (`Access-Control-Allow-Origin` pour l'origine du shell) sur `magelian.css`, `magelian-polices.css`, `maplibre.css`, `config.local.json`, `remoteEntry.json` et les chunks : `magelian.css` et `config.local.json` sont lus par `fetch`, `remoteEntry.json` et les chunks par le chargeur de modules de la fédération.
  - **`Access-Control-Expose-Headers: Content-Disposition`** sur les routes d'export de l'API, le jour où l'API est servie sur une AUTRE origine que la page (passerelle AIDA) : sans lui, le navigateur masque cet en-tête à `HttpClient`, et `nomDeFichier` (`core/http/telecharger.ts`) retombe sur le nom de repli au lieu de celui que le serveur a choisi. Sans effet en même origine (proxy de dev, montage actuel).
  - **CSP du shell** : autoriser les polices Google — `style-src` `https://fonts.googleapis.com` (en développement ; au build de production les `@font-face` sont incorporées dans `magelian-polices.css`) et `font-src` `https://fonts.gstatic.com`. Sans elles, repli sur les polices système (non bloquant, voir « Ordre de démarrage »).
- **Administration (lot 6, T1, 2026-10-06)** — socle de l'administration (`angular/src/app/features/admin/`). **Route (C1)** : `admin`, DERNIER enfant de la route de la coquille (`app.routes.ts`, une ligne `loadChildren` → `ROUTES_ADMIN`, chunk paresseux de ~3,7 kB ; paquet initial inchangé à 40,99 kB). Les pages admin sont donc sous `mg-coquille` et sous son `authGuard` : sans session, « Session requise… » dans un hôte, redirection vers `/connexion` en autonome, rien de refait. `admin` seul → `admin/health` (React répond 404 sur `/admin`) ; `health` est une page PROVISOIRE (« Disponible prochainement », aucun appel) jusqu'au portage du Health check en T3. **Garde super_admin (C2), que React n'a pas** : React affiche la page à un `client` et laisse chaque appel répondre 401/403 (`requireAdmin` = super_admin STRICT). `RoleAdminService` (`etat/role-admin.service.ts`) lit le rôle UNE fois par session par `AuthService.lireProfil()` — et non `lireRole()`, qui rend `null` à la fois sur une lecture en échec et pour un profil sans rôle : `null` → `erreur` (« Impossible de vérifier vos droits. » + « Réessayer »), profil présent dont le rôle n'est pas `super_admin` → `refuse` (« Accès réservé aux super-administrateurs. ») ; jamais plus d'une lecture en vol ; relu quand l'IDENTIFIANT de session change (pas au rafraîchissement du jeton), y compris sans navigation dans un hôte. `roleResoluGuard` attend la lecture puis rend TOUJOURS `true` — il ne navigue jamais — et `runGuardsAndResolvers: 'always'` le rejoue à chaque navigation (idempotent). `CadreAdminComponent` n'ouvre son `<router-outlet>` qu'au `super_admin` : sinon le message À LA PLACE des pages, donc aucune page admin créée et aucun appel d'API, et l'URL ne bouge pas (vérifié au navigateur avec un compte `client` jetable : seule la lecture des organisations de la coquille part, aucun `/api/admin`). Les entrées de la barre restent visibles pour tous, comme React. **Services de la route (C3)** : `FOURNISSEURS_ADMIN` (`admin.routes.ts`), fournis par la route `admin` et JAMAIS par `FOURNISSEURS_DISTANTS` — l'injecteur de cette route est un enfant de celui de la racine distante, donc un service d'API qui y est fourni reçoit le `HttpClient` de nos intercepteurs (`remote.spec.ts` : Bearer posé, 4 appels → 3 en vol). **`lignesSse`** (`core/http/sse.ts`) : même contrat que `lignesNdjson` pour les deux routes qui répondent `text/event-stream` à un POST (`import-poi/execute`, `campaigns/import` — `EventSource` ne fait que des GET) : texte cumulé, lignes complètes seulement, séparateurs `\r\n` / `\n` / `\r`, seules les lignes `data:` lues (préfixe et espace retirés), `event:`/`id:`/commentaires ignorés, ligne illisible ignorée sans couper le flux, reste lu à la `Response` finale. **Copies pures (P6)** dans `logique/` : `roles.ts` (sans Zod), `version.ts` (`APP_VERSION`, `BUILD_DATE`), `formats.ts` (`fmtBytes`, `fmtTime`), `types/{admin,dsp,campagne-import,import-poi,fraicheur}.ts` — tenues par `tests/unit/angular/admin-logique-paritaire.test.ts` (valeurs comparées, types par assignabilité mutuelle vérifiée par le `tsc` racine : retirer un membre d'une union de la copie le fait échouer, vérifié). **Gel P5 étendu à l'administration React** (`app/admin/**`, `app/dashboard/iris-crawler/**`, `lib/admin-fetch.ts`) ; les modules purs recopiés qui servent aussi l'API ne sont pas gelés, c'est le test de parité qui oblige la copie à suivre.
- **Administration (lot 6, T2, 2026-10-06)** — socle II : notifications, confirmation, journal, progression, dépôt de fichiers. **Notifications (C7)** : `NotificationsService` + `mg-notifications` (`angular/src/app/ui/notifications/`, génériques), port de `useToast` (`components/ui/geo-toast.tsx`) aux mêmes valeurs — 4 variantes (succès `coche`, erreur `croix`, avertissement `triangle-alerte`, info `info`), 4 s puis sortie animée de 280 ms, 3 au plus (une quatrième retire la plus ancienne sans attendre), barre de temps. `@Injectable()` SANS `providedIn`, **fourni par `CadreAdminComponent`** (et par le catalogue) et détruit avec lui : ses minuteries sont annulées par `DestroyRef` (React les laissait courir). React les épinglait en haut à droite de la fenêtre, interdit dans la racine d'ombre : le cadre les pose dans une rangée `sticky top-0` (patron du chrome de la coquille), z 300 au-dessus du chrome comme le z 10000 de React — mesuré au navigateur : 12 px du haut et de la droite, comme React. ⚠ **Rangée haute de 1 px et non 0** : une boîte vide de hauteur nulle laisse ses marges `-mt-8` / `mb-8` se fondre (−32 + 32 = 0) et ne remonte pas (mesuré : 44 px au lieu de 12). Le refus et l'erreur du cadre sont décalés par un `pt-8` (une marge fondrait avec celle de la rangée) : ils passaient sous le chrome du haut (réserve de T1, mesuré : haut à 64 px, chrome jusqu'à 50). **Confirmation (C6)** : `mg-confirmation` (`ui/confirmation/`), port de `ConfirmModal` (`components/ui/confirm-modal.tsx`) — même boîte au pixel près (420 px, rayon 12, boutons 9 × 18), variante danger (pastille triangle, bouton `--danger`), `enCours` → boutons désactivés et « En cours... ». **`<dialog>` natif** : `showModal()` le met dans la couche supérieure SANS le sortir de l'arbre, donc DANS la racine d'ombre, stylé, fond inerte et focus piégé par le navigateur (« Annuler » a le focus à l'ouverture). L'événement `cancel` (Échap) est EMPÊCHÉ puis `annuler` émis — c'est le parent qui repasse `ouvert` à faux, sinon DOM et état divergeraient ; la touche ne remonte pas à un écouteur de page ; une fermeture native non empêchable (second Échap sans activation, Chrome) émet aussi `annuler`. Le dialogue n'a pas de marge intérieure : un clic dont la cible est le dialogue vient du fond. Voile : noir à 85 % + flou de 4 px dans les deux thèmes, comme React (aucun jeton ne reste sombre en clair). Remplacera aussi les trois `window.confirm()` de React. **Journal (C14)** : `mg-journal` (`features/admin/commun/`), rendu du terminal radio (`radio/page.tsx:459-518`) — filtre par niveau avec compteurs (`filtrable`, `debug` masqué au départ comme React), « Copier » (`copiable` ; TOUTES les lignes jointes par `\n`, « Logs copiés » ; presse-papiers absent ou refusé → notification d'erreur, jamais une exception), hauteur en entrée. Défilement par `scrollTop = scrollHeight`, JAMAIS `scrollIntoView` (qui ferait défiler la page du shell), et plus du tout quand l'utilisateur a remonté de plus de 30 px. Palette de React ramenée aux jetons (C9) : `debug` `--text-tertiary`, `info`/`log` `--text-secondary`, `warn` `--warning`, `error` `--danger`, `success` `--success` ; fond `#080808` → `--bg-level-0`, qui suit le thème avec elles. **Progression (C5)** : `mg-progression-import`, carte de l'import Shapefile (`ImportStep.tsx`) — étape nommée, `traitees / total`, pourcentage SEULEMENT si le flux porte un total ; sans total, barre INDÉTERMINÉE (`aria-busy`, aucun `aria-valuenow`) et « N lignes reçues » ; terminé « ✓ Import terminé » ; échec « ! message » en gardant le pourcentage atteint, jamais une barre pleine. Remplissage uni en jeton (React : dégradés et halo, flat total) ; libellé lisible sur la piste ET sur le remplissage par deux couches (texte du thème, texte sombre invariant découpé à la largeur) au lieu de l'ombre portée de React. **Dépôt** : `mg-depot-fichiers`, cadre des zones d'`UploadStep.tsx` et de l'IRIS crawler (tirets 2 px, teal au survol), contenu PROJETÉ, `survol` public ; `dragover`/`drop` écoutés sur la zone seule ; sans `multiple`, seul le premier fichier ; focalisable et ouvrable au clavier (le `div` de React ne l'était pas). **Pas de `mg-onglets`** (ruling C16) : les onglets de Health (13 px, 500, actif `--text-primary`, écart 4) et de Sources (9 px, 700/400, actif dans la couleur de l'onglet, écart 2) ne sont pas identiques au pixel — chaque écran garde les siens. Icônes `triangle-alerte`, `coche`, `loupe` ajoutées EN FIN de table (55). Planche « Administration » en fin de `/app/catalogue`.
- **Administration (lot 6, T3, 2026-10-07)** — Health check, onglet « Diagnostic système » (`features/admin/health/`), portage de `app/admin/health/page.tsx`. `HealthApi.lire()` (`GET /api/admin/health`) est fourni par `FOURNISSEURS_ADMIN` ; la page fait UNE lecture à l'ouverture, « Re-tester » en relance une — jamais une seconde tant que la première est en vol (bouton désactivé ET méthode gardée). Comme React, la pastille de statut de l'en-tête n'existe que lecture finie et réponse présente ; statut global `health?.status || 'ERROR'` ; filtres de sections recopiés (`BORNES_CARREAUX` sort des variables d'environnement vers « Fraîcheur des données ») ; nombres par `formaterNombre`. Onglets PROPRES à la page (pas de `mg-onglets`, ruling T2) ; l'onglet « Fraîcheur données » est un texte provisoire jusqu'à T4, sans aucun appel. `mg-carte-verification` porte `CheckCard` ; icônes SVG recopiées en ligne (couleur par `style`, jamais l'attribut `stroke="var(…)"`). ⚠ **Défaut React reproduit, mesuré** : `border: 1px solid ${couleur}44` avec `couleur = 'var(--success)'` devient `var(--success)44`, invalide une fois substitué — une carte OK n'a donc NI bordure NI fond de badge (mesuré `0px none`, transparent), à la différence de WARN/ERROR écrits en hex ; gardé par parité (`data-etat`, `statut.ts`). ⚠ **Défaut React corrigé** : React fait `res.json()` sans tester `res.ok` ; un corps d'erreur JSON (401/500 `{ error }`) devenait `health` et `health.checks.filter` levait au rendu — mesuré : page « Cannot read properties of undefined (reading 'filter') » ; ici toute réponse non 2xx vaut une lecture en échec (« Erreur de connexion au serveur »). ⚠ Le quota de la barre « Espace base de données » (Free 500 MB / Pro 8 GB) est recopié TEL QUEL : il décrit le projet hébergé supprimé le 2026-09-21. Couleurs (C9) : `#f87171`/`#fbbf24`/`#3b82f6`/`#94a3b8` → `--danger`/`--warning`/`--info`/`--text-tertiary`, fonds `rgba` → `color-mix` du jeton à la même opacité, piste `rgba(255,255,255,0.06)` → `--text-primary` à 6 % (visible en clair, invisible chez React). Vérifié au navigateur, deux thèmes : 191 lignes de texte identiques à React (compteurs, 119 tables, 3 415 817 lignes, version 7.19.0), carte Database Overview 900 × 4 756 px des deux côtés, barre de taille remplie à 651,781 px. L'entrée « Health check » de la barre mène à `admin/health`.
- **Administration (lot 6, T4, 2026-10-07)** — Health check, onglet « Fraîcheur données » : `mg-fraicheur` (`features/admin/health/fraicheur.component.{ts,html}`), portage de `app/admin/health/_components/FraicheurPanel.tsx`, et `FraicheurApi` (`health/data/fraicheur.api.ts`, dans `FOURNISSEURS_ADMIN`) : `lire()` = `GET /api/admin/fraicheur-donnees` (relevé PERSISTÉ, ne mesure rien), `mesurer(inclureLourd)` = `POST` au corps `{ inclureLourd }`. ⚠ **Le panneau est monté à la PREMIÈRE ouverture de l'onglet puis GARDÉ** (`hidden`, jamais démonté) : un aller-retour d'onglets ne relit pas le relevé — React démontait le panneau et le relisait à chaque retour (écart voulu, I/O). Deux boutons comme React : « Relancer la mesure » (passe légère, < 15 Mo, quota `geo:rl:fraicheur` 6/min) et « Mesurer » sur la ligne du flux routier (`comptages_routiers`, **347 Mo lus**, quota `geo:rl:fraicheur-lourd` 1/min), dont le coût est affiché AVANT le clic (légende « 347 Mo lus, hors mesure ordinaire » et `title`) ; pendant une mesure les DEUX boutons sont désactivés et la méthode refuse un second envoi. Un refus (429 compris) affiche le `error` du SERVEUR, sans aucune relance automatique ; le relevé rendu par le POST — FUSIONNÉ source par source côté serveur — remplace l'affichage tel quel, rien n'est recalculé côté client. `persiste: false` → l'avertissement de React. Écarts : corps d'erreur illisible → repli de React (« Lecture impossible. », « La mesure a échoué. ») au lieu du message de `res.json()` ; badges SANS fond ni bordure, reproduits (React écrit `${var(--x)}1a`/`44`, valeurs invalides, mesuré au navigateur) ; encart d'erreur en `color-mix` de `--danger` (C9). Onglets : `role="tabpanel"`, `aria-controls`/`aria-labelledby` ; polices de l'écran Health par `var(--font-mono)`/`var(--font-sans)`. Vérifié au navigateur contre React, deux thèmes : texte du panneau IDENTIQUE (10 sources), une mesure légère réelle (relevé 117 ms, millésime du flux routier conservé par la fusion), UN GET pour deux allers-retours d'onglets.
- **Administration (lot 6, T5, 2026-10-07)** — Qualité des données : `QualiteDonneesPage` (`features/admin/qualite-donnees/`, route `admin/qualite-donnees`, entrée « Qualite des donnees » de la barre branchée), portage de `app/admin/qualite-donnees/page.tsx`, et `QualiteApi` (`qualite-donnees/data/qualite.api.ts`, dans `FOURNISSEURS_ADMIN`) : `lire()` = `GET /api/admin/qualite-donnees` (relevés PERSISTÉS de `qualite_releves`, rien n'est recalculé), `verifier(cle)` = `POST` au corps `{ verification }` — UNE clé, jamais un tableau. **Rien ne se lance au chargement** : UN GET par ouverture ; chaque famille (indicateurs, fraîcheur, invariants, colonnes d'`iris`) a SON bouton, et il n'y a délibérément AUCUN « tout vérifier » (incident du 28/03 : trois des quatre vérifications lisent ~220 Mo). Pendant une vérification, les QUATRE boutons sont désactivés et la méthode refuse un second envoi ; le quota serveur `geo:rl:qualite-donnees` (2/min) reste la seule limite réelle (deux onglets ouverts passent le garde client). Un refus (429 compris) affiche le `error` du SERVEUR, sans relance automatique. Partis pris de React gardés : une famille jamais lancée dit « jamais lancée — ce n’est pas « rien à signaler » », le coût est affiché AVANT le clic (ligne « coût d’une mesure » et `title`), les indicateurs en problème d'abord, la couverture de POPULATION à côté de celle des lignes, l'écart des invariants en unité métier, « renseignée » distinguée de « non nulle ». `cache: 'no-store'` de React : sans objet côté `HttpClient`. Écarts : fonds `rgba(…, 0.08/0.06)` → `color-mix` de `--danger`/`--warning`/`--brand-teal` (C9, en clair les jetons s'assombrissent) ; réponse non JSON → `HTTP <statut>` au lieu de l'erreur de `res.json()`. Gardé par parité : `persiste: false` n'est pas signalé. Vérifié au navigateur contre React, deux thèmes : texte de la page IDENTIQUE (61 lignes, 5 indicateurs sur 19 en problème) ; une vérification LÉGÈRE réelle (fraîcheur, 131 ms) — l'état « Mesure… » montre les quatre boutons désactivés ; aucune vérification `iris` lancée.
- **Espaces de travail (T5, 2026-10-09)** — route `admin/espaces` (`features/admin/espaces/`), enfant de la route `admin` APRÈS `qualite-donnees` : `EspacesPage` (colonne persistante + `<router-outlet>`) avec trois enfants paresseux — `''` → `AucunEspaceComponent` (invite), `socle` → `FicheSocleComponent`, `:id` → `FicheEspaceComponent` (la fiche du socle est remplie par T6, celle d’un espace par T7). **Données** : `EspacesApi` (`espaces/data/espaces.api.ts`, `@Injectable()` sans `providedIn`, héritier de `HttpBaseService`, ajouté à `FOURNISSEURS_ADMIN`) couvre les lectures `GET /api/admin/espaces`, `…/socle`, `…/[id]/donnees|membres|apercu` et les écritures des routes existantes (organisations, membres SANS `role` — E3, partage `sources/assign`, `PATCH admin/sources/[id]`, comptes, `PUT admin/users/[id]/espaces`). `creerEspace` = `POST admin/organizations { name }` puis, s'il y a une description, `PATCH { description }` (deux appels séquentiels, `switchMap`) ; un PATCH en échec remonte en `DescriptionNonEnregistree` (porte l'id : l'espace existe, la page le dit). **État** : `EspacesEtatService` (`@Injectable()` sans `providedIn`, fourni par `EspacesPage`, détruit avec elle) — UN `GET admin/espaces` au montage, en cache tant que la page vit (passer d'une fiche à l'autre ne relit rien), `recharger()` après une écriture qui change un compteur. **Colonne** : « Socle dentsu.explore » (point teal, « visible de tous · N jeux »), séparateur 0,5 px, une ligne par espace (`nom_affiche` du serveur — « dentsu.explore (interne) » pour `genesis-global`, E2 — et « membres · jeux privés » en JetBrains Mono, pastille « Inactif »), puis « + Nouvel espace » ; liens RELATIFS, `routerLinkActive` (fond `--bg-level-3`, bord gauche 2 px `--text-primary`), flèches haut/bas par un écouteur sur la `<nav>` ; trois squelettes au chargement, message + « Réessayer » en erreur. **Nouvel espace** : `mg-dialogue-nouvel-espace`, `<dialog>` natif (patron `mg-confirmation`), monté par `@if` (formulaire neuf à chaque ouverture) ; nom vide après `trim()` → « Créer l'espace » désactivé ; succès → notification « Espace créé », liste relue, navigation relative vers l'espace ; 409 → message du serveur DANS le dialogue, qui reste ouvert. Types copiés de `lib/espaces/types.ts` dans `espaces/logique/types.ts`, parité par `tests/unit/angular/espaces-types-paritaires.test.ts`. **Barre latérale (E6)** : « Users » et « Organisations » de la section « Systeme » remplacées par UNE entrée « Espaces de travail » (`cible: 'admin/espaces'`) — écart VOULU à la barre React, documenté dans `layout/navigation.ts`.
- **Espaces de travail — fiche Socle (T6, 2026-10-09)** : `FicheSocleComponent` (`features/admin/espaces/fiche-socle.component.ts`, route `admin/espaces/socle`) remplace la coquille de T5. UN `GET admin/espaces/socle` au montage ; la réponse (tous les jeux) est répartie en « Dans le socle (n) » et « Jeux privés (n) » (bandeaux `mg-entete-section`, tableaux sur `th[mgTh]`/`td[mgTd]` : Jeu, Type, Propriétaire, Lignes en JetBrains Mono), puis « Référentiels système » (Arrêts de transport, Installations classées (ICPE) : textes fixes, ces POI n'ont pas de source, lecture seule). « Retirer du socle » / « Mettre au socle » passent par `mg-confirmation` (`danger` / `defaut`, `enCours` pendant l'écriture) puis `PATCH admin/sources/:id { visibilite }`. Le décompte « {k} espaces clients ne le verront plus » est `nb_espaces_clients` moins 1 quand le propriétaire est lui-même un espace client (`interne === false` dans `EspacesEtatService.espaces()`, R2). Un jeu du socle SANS propriétaire a son bouton désactivé (personne ne le verrait plus s'il redevenait privé). **Aucune mise à jour optimiste** : succès → notification, relecture du socle ET `etat.recharger()` (le compteur de la colonne suit) ; refus → notification d'erreur avec le message du serveur, confirmation fermée, tableaux inchangés.
- **Espaces de travail — fiche d'un espace, membres, fiche utilisateur (T7, 2026-10-09)** : `FicheEspaceComponent` (`features/admin/espaces/fiche-espace.component.ts`, route `admin/espaces/:id`) lit `:id` en S'ABONNANT à `ActivatedRoute.paramMap` — le routeur réutilise le composant d'un espace à l'autre : un changement de paramètre remet l'onglet sur « Membres » et démonte les onglets déjà ouverts (lectures en vol abandonnées). Quatre onglets du design system (actif `--text-primary` + bord bas 2 px `--brand-teal`, flèches gauche/droite) : `Membres ({nb_membres})`, `Données`, `Aperçu`, `Réglages` ; un onglet n'est créé (et ne lit rien) qu'à sa première ouverture — les trois derniers ne sont en T7 qu'un texte d'attente, branchés par T8-T10. Nom et compteur viennent d'`EspacesEtatService` : un seul appel à l'ouverture (les membres). Espace absent de la liste chargée → « Espace introuvable » + lien relatif `..`. `OngletMembresComponent` (`onglet-membres.component.ts`, `espaceId` input réactif) : `GET admin/espaces/:id/membres`, tableau Utilisateur / Rôle (`ROLE_LABELS`, pastille « Voit tous les espaces » pour un super_admin) / Autres espaces / Espace actif (« Aucun (socle seul) ») ; clic ou Entrée sur une ligne → fiche utilisateur. « Retirer de l'espace » : `mg-confirmation` `danger` dont le message suit les quatre cas de la spec § 4.3 (super_admin ; espace non actif ; espace actif avec d'autres espaces — « un de ses autres espaces (liste) », le serveur choisissant le plus ancien par `joined_at` que l'écran ne connaît pas ; seul espace), puis `DELETE admin/organizations/:id/members { userId }`. « Lien de mot de passe » : `POST …/members/reset-password { email }` → `DialogueLienComponent` + `LienSecretComponent` (champ en lecture seule, « Copier » par `navigator.clipboard.writeText`). `DialogueAjoutMembreComponent` : « Compte existant » (`GET admin/users` UNE fois à l'ouverture, filtre local, membres exclus, `POST …/members { email }` SANS rôle, E3) et « Nouveau compte » (rôle FIXÉ à `client`, E5 ; `POST admin/users` → écran « Compte créé » avec `setup_link`, repli si `null`, 409 → « Ce compte existe déjà… »). `FicheUtilisateurComponent` (`<dialog>` 560 px) : Nom (`PATCH admin/users/:id { full_name }`), Rôle en radios `client` / `super_admin` seulement (passer à super_admin demande confirmation ; le radio ne bascule qu'après un PATCH réussi ; rôle de son propre compte non modifiable), cases d'espaces + espace actif limité aux cochés (décocher l'actif reporte sur le premier coché restant, sinon « Aucun »), `PUT admin/users/:id/espaces` (un 400 affiche le message du serveur dans la fiche), « Supprimer le compte » (confirmation `danger`, désactivé sur son propre compte). **Secrets** : les liens d'initialisation et de réinitialisation sont d'usage unique — affichés une fois, jamais passés à `console.*` ni à une notification, effacés de l'état (signal remis à `null` / composant démonté) à la fermeture du dialogue. **Aucune mise à jour optimiste** : toute écriture réussie → notification, relecture des membres ET `etat.recharger()` ; refusée → message du serveur (notification, ou dans le dialogue / la fiche), état inchangé.
- **Espaces de travail — onglet Données (T8, 2026-10-09)** : `OngletDonneesComponent` (`features/admin/espaces/onglet-donnees.component.ts`, `espaceId` input réactif, branché dans `FicheEspaceComponent` à la première ouverture de l'onglet « Données ») lit `GET admin/espaces/:id/donnees` (UN appel, tri du serveur : propriétaire, partagé, socle, non visible) et rend un tableau Jeu / Type / Catégorie (« — » si vide) / Lignes (`formaterNombre`) / Statut (pastille : propriétaire bord `--brand-teal`, partagé bord `--info`, socle `--text-tertiary` + cadenas, non visible `--text-tertiary`) / Actions. Propriétaire : « Transférer… » (`DialogueTransfertComponent`, `<dialog>` natif listant les AUTRES espaces par `nom_affiche`, puis `mg-confirmation` qui nomme les deux espaces) → `PATCH admin/sources/:id { organization_id }` ; « Mettre au socle » (confirmation) → `PATCH { visibilite: 'socle' }`. Partagé : « Retirer le partage » (confirmation `danger`) → `DELETE admin/organizations/:id/sources/assign { sourceId }`. Non visible : « Partager avec cet espace » → `POST …/sources/assign { sourceId }`, sans confirmation (réversible). Socle : aucune action, texte « Se règle dans le socle » avec lien relatif `../socle`. Aucune mise à jour optimiste : succès → notification, relecture de l'onglet ET `etat.recharger()` (compteurs de jeux privés) ; échec → notification du message du serveur, tableau inchangé ; lecture en échec → message + « Réessayer ».
- **Espaces de travail — onglet Aperçu (T9, 2026-10-09)** : `OngletApercuComponent` (`features/admin/espaces/onglet-apercu.component.ts`, `espaceId` input réactif, branché dans `FicheEspaceComponent` à la première ouverture de l'onglet « Aperçu », donc lu à l'initialisation seulement) lit `GET admin/espaces/:id/apercu` (UN appel, une requête par catégorie côté serveur : plusieurs secondes possibles) et montre ce que voit un compte client de l'espace : trois groupes de jeux (« Du socle », « Propres à l'espace », « Partagés avec l'espace », « Aucun » si vide) avec type et lignes (`formaterNombre`, JetBrains Mono), les catégories de POI en pastilles SANS effectif (E4), `nb_campagnes`. Pendant la lecture, « Calcul de l'aperçu… » et `mg-barre-progression` indéterminée (`ChargementService` fourni par l'onglet). « Recalculer » (l'aperçu ne suit pas l'onglet Données) relit en ANNULANT la lecture en vol ; erreur → message + « Réessayer ».
- **Espaces de travail — onglet Réglages (T10, 2026-10-09)** : `OngletReglagesComponent` (`features/admin/espaces/onglet-reglages.component.ts`, `espaceId` input réactif, branché dans `FicheEspaceComponent` à la première ouverture de l'onglet « Réglages ») lit `GET admin/organizations/:id` (UN appel ; erreur → message + « Réessayer ») et reprend les champs de `app/admin/organizations/[id]/page.tsx` : Nom, Description, Quota de POI (`config.max_poi`), Quota de requêtes IA (`config.max_ai_requests`, mention « Disparaîtra avec la suppression de l'IA. »), Site Centric URL et clé (`type="password"`, jamais journalisée ni notifiée). « Enregistrer » → `PATCH admin/organizations/:id { name, description, config }` où `config` est la config LUE **fusionnée** avec les quatre clés du formulaire : la route REMPLACE la colonne `config` en bloc (`updates.config = body.config`), d'autres clés peuvent y vivre (vérifié : une clé étrangère survit à un enregistrement). Quota vide → `null`, « 12 » → `12` ; négatif, décimal, lettres ou notation scientifique → message en ligne et AUCUN envoi (`lireQuota` ; React lisait « 1.5 » comme 1 par `parseInt`) ; nom vide refusé. Section « Statut » : interrupteur « Espace actif » → `PATCH { active }` seul, sans mise à jour optimiste (il ne bouge qu'après la relecture ; un refus le laisse en place). Zone dangereuse : « Supprimer l'espace » → `mg-confirmation` `danger` « Supprimer {nom_affiche} ? Ses {n} membres en sont retirés ; ses {m} jeux privés deviennent sans propriétaire… » (n et m viennent de la LISTE de la page, `EspacesEtatService`, sans lecture de plus) → `DELETE admin/organizations/:id`, puis navigation relative `..` (fiche vide) ; ABSENTE sur l'espace interne, remplacée par « L'espace interne porte les données du socle : il ne se supprime pas. ». Toute écriture réussie notifie, relit puis appelle `etat.recharger()` (le titre de la fiche et la colonne suivent le nouveau nom, la pastille « Inactif » apparaît) ; tout est désactivé tant qu'une écriture ou sa relecture est en vol (pas de double envoi).
- **Accès — renommage et vue « Tous les comptes » (2026-10-10)** : la page `admin/espaces` s'appelle désormais « Accès » — titre (`mg-entete-page`), `aria-label` de la colonne, entrée de la barre latérale (`layout/navigation.ts`, `cible: 'admin/acces'`) ; les noms internes (dossier `espaces/`, `EspacesPage`, `EspacesApi`, sélecteurs `mg-…`) n'ont PAS changé. **Routes** : `admin/acces` avec les enfants `''`, `socle`, `comptes`, `:id` (chemins fixes avant le paramètre) ; `admin/espaces` → `admin/acces` et `admin/espaces/:id` → `admin/acces/:id` en `redirectTo` RELATIF (un favori ne casse pas ; `espaces/socle` suit `:id`), verrouillés par `features/admin/admin.routes.spec.ts`. **Colonne** : « Tous les comptes » sous le socle, même style, compteur `nb_comptes` lu par le MÊME `GET admin/espaces` (`EspacesEtatService.nbComptes`, aucun appel de plus), atteint aux flèches comme les autres liens. **Vue** `VueComptesComponent` (`espaces/vue-comptes.component.ts`, route `admin/acces/comptes`) : UN `GET admin/espaces/comptes` à l'ouverture (`EspacesApi.lireComptes`), relu seulement après une écriture réussie (avec `etat.recharger()`) ; regroupement de la page React Users par `grouperComptes` (`espaces/logique/comptes.ts`) — « Super admins », un groupe par espace ACTIF (nom affiché, ordre alphabétique `fr`), « Aucun espace actif » (membre sans actif, écart voulu), « Sans espace » en dernier — bandeau point teal + effectif ; colonnes Nom · Email (JetBrains Mono) · Rôle (`ROLE_LABELS` en badge du design system, PAS les couleurs rouge/orange/bleu de React) · Espaces (pastilles de TOUS ses espaces, l'actif en teal) · Créé le (`fr-FR`) ; filtre LOCAL nom/email sans casse ni accents (`filtrerComptes`, aucun appel). Clic sur une ligne → `FicheUtilisateurComponent`, dont `espaceId` est devenu FACULTATIF (`null` : les cases cochées viennent de `autres_espaces`, qui porte alors TOUS les espaces du compte). Au clavier, le nom est un vrai `<button data-ouvrir>` (rôle accessible, Entrée ET Espace natifs, son clic remonte à la ligne ; son libellé accessible contient le nom visible, WCAG 2.5.3), la ligne n'est plus focalisable ; l'email ne passe jamais à la ligne (règle `.email` du composant). Survol des CTA par l'opacité (`--cta-hover` est invariant, illisible en thème clair). **Créer un compte** (CTA principal) : `DialogueCreationCompteComponent` — email · nom · rôle Client / Super admin (jamais Admin, E5) · espace parmi les espaces ACTIFS (la route refuse un inactif), obligatoire pour un client (bouton désactivé + aide, règle de `POST /api/admin/users`), facultatif pour un super_admin ; 201 → écran « Compte créé » `CompteCreeComponent` (`espaces/compte-cree.component.ts`, extrait de `DialogueAjoutMembreComponent` qui l'utilise aussi : lien d'usage unique affiché une fois, jamais journalisé, Échap et clic sur le fond ignorés, fermeture native forcée → réouverture). `emailValide` est passé dans `espaces/logique/libelles.ts` (partagé par les deux dialogues). **Panneau Réglages de la carte** : « Organisations (workspaces) » et « Utilisateurs » remplacés par UNE entrée « Accès » ACTIVE (`routerLink` relatif `../admin/acces` depuis la route `carte`), les neuf autres liens restent inertes.
- **Accès — lien de mot de passe depuis la fiche (2026-10-10)** : `FicheUtilisateurComponent` porte un bloc « Mot de passe » et un bouton neutre « Lien de mot de passe » pour TOUT compte, avec ou sans espace (un super_admin créé sans espace n'avait aucun chemin) : `EspacesApi.lienMotDePasseCompte(userId)` → `POST admin/users/:id/lien-mot-de-passe` → `{ lien }`, affiché dans `DialogueLienComponent` (le MÊME que l'onglet Membres, `<dialog>` natif posé au-dessus de la fiche, qui reste ouverte). Mêmes garanties de secret : signal remis à `null` à la fermeture et à la destruction, jamais `console.*` ni notification ; fermer la fiche pendant la génération abandonne la requête. Ce n'est pas une écriture (`fermer(ecrit)` inchangé). À la fermeture du dialogue du lien, le focus revient au bouton (`afterNextRender` : tant que le `<dialog>` modal du lien est ouvert, la fiche est inerte et un `focus()` immédiat tombait sur le `<body>`). Le message « lien non généré » du dialogue de création renvoie désormais vers la fiche.
- **Droits sur la carte, T3 (2026-10-12) — changer d'espace recrée la page carte** : la route `carte` (`app.routes.ts`) charge désormais `CarteHoteComponent` (`features/carte/carte-hote.component.ts`, `mg-carte-hote`) au lieu de `CartePage` — enfants (`risques`) et fournisseurs inchangés. Patron EXACT de la coquille : `generation = signal(0)`, `@for (g of [generation()]; track g) { <mg-carte-principale (espaceChange)="actualiser()" /> }`. `CartePage.organisationChangee()` (badge de la barre du haut, après `POST` réussi) n'émet plus que `espaceChange = output<void>()` : le nettoyage manuel (fermer le panneau, effacer les zones, oublier le lien, retirer un filtre de zone) est retiré, la recréation de la page détruit TOUS ses services d'état (`providers` de `CartePage` : catalogue POI, points, panneaux OOH, batailles, clusters, zones, analyses, plan média) et la carte MapLibre — équivalent du `window.location.reload()` de React. Les lectures en vol sont désabonnées, donc ANNULÉES : une réponse de l'ancien espace n'atteint jamais la nouvelle page. Aucun service hors page (API de `FOURNISSEURS_DISTANTS`, services racine) ne garde d'état dépendant du périmètre. L'URL est gardée — le module risque est re-rendu par l'outlet de la page recréée — SAUF `customZone` (zone de l'ancien espace), retiré par l'hôte AVANT la recréation. La recréation n'appelle rien de plus qu'une ouverture de carte (spec `carte-hote.component.spec.ts`, appels comptés). Le filtrage par espace du super_admin est porté côté serveur par T1. Complété en T4 : une navigation de retrait de `customZone` REJETÉE est interceptée (`.then(f, f)`, plus de rejet non géré) et la page est recréée quand même ; si le focus était dans l'ancienne page, il est rendu au bouton d'espace du badge (`[data-declencheur="org"]`) de la nouvelle, plutôt qu'à l'hôte de la page. Un focus « perdu » se reconnaît par `instanceof HTMLBodyElement` et non par une comparaison au corps du document, que le garde `tests/unit/angular/portails-hors-ombre.test.ts` refuse (T5).
- **Droits sur la carte, T4 (2026-10-12) — deux groupes dans la section POI** : `CategoriePoi` (`features/carte/data/carte.api.ts`) lit le champ `origine: 'commune' | 'espace'` de `GET /api/map/categories` (T2) ; `typeDePoi` (`etat/catalogue-poi.service.ts`) le pose TOUJOURS sur `TypePoi` — « espace » seulement si la route le dit, « commune » pour une chaîne, un objet sans le champ ou une valeur inconnue. `SectionPoiComponent` (`panneaux/calques/section-poi.component.ts`) : dès qu'un type est « espace », la liste se coupe en « Données de l'espace » puis « Données communes » (sous-titres `text-[11px] font-medium text-secondary`, libellés provisoires), une `mg-liste-multiple` par groupe, groupe vide non rendu ; tout commun (espace interne) = rendu d'avant, sans sous-titre. La sélection reste UNE (`EtatCarteService.poiSelectionnes`) : chaque liste reçoit sa part, et ce qu'elle émet ne remplace que cette part (`changerGroupe`) — sa croix et « Tout deselectionner » n'effacent pas l'autre groupe. `mg-liste-multiple` n'est pas modifiée. Le compteur « (N) » reste global ; `risque_industriel` reste retiré de la liste. Chaque groupe porte `role="group"` et `aria-label` = son sous-titre (T5) : les deux listes ont le même libellé « Aucun type selectionne », le groupe nommé est ce qui les distingue pour un lecteur d'écran.

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
# ⚠ `--local` echoue sur ce poste (2026-10-13) : « SASL: client password must be a
#    string ». L'URL explicite du conteneur marche (mot de passe par defaut, public,
#    du stack local). Puis ne reporter que SES ajouts : le fichier suivi derive deja
#    (`source_visible`, sql/234, en est absente).
npx supabase gen types typescript --db-url "postgresql://postgres:postgres@127.0.0.1:54322/postgres" > types/database.types.ts
```

---

*MAGELIAN — Geospatial intelligence*
