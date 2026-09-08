# Known tech debt — MAGELIAN

> Date : 2026-04-30 · Référencé par chantier A4.6.2
> Révisé : 2026-08-31 (branche `chore/zero-tech-debt`) — items 2, 4 et 5 fermés,
> chiffres remesurés.
> Révisé : 2026-09-03 — item 3 fermé (xlsx retiré, branche
> `chore/drop-xlsx-exceljs`) puis item 1 fermé en entier : `FilterPanel.tsx`
> splitté (branche `refactor/filter-panel-split`), après `admin/sources/page.tsx`
> et `map/page.tsx` le 2026-09-01.
> Révisé : 2026-09-07 — `app/admin/import/page.tsx` splitté (branche
> `refactor/split-admin-import`) : 1 776 → 586 lignes, puis
> `app/admin/carreaux-import/page.tsx` (branche
> `refactor/split-carreaux-import`) : 1 526 → 502 lignes, puis
> `components/map/overlays/PilotageOverlay.tsx` (branche
> `refactor/split-pilotage-overlay`) : 1 217 → 244 lignes.
> **Plus aucun fichier > 2000 lignes dans le projet.**
> Révisé : 2026-09-07 (soir) — bug MapLibre de `DualMap` corrigé
> (branche `fix/dualmap-circle-radius`) ; une seconde cause, indépendante,
> est apparue en le vérifiant : la stratégie de démo n'a aucune donnée
> simulée en base. Voir la fin du document.
> Reste ouvert : item 6 (item 8 fermé le 2026-09-07 — routes deja supprimees ;
> aperçu carte du dry-run fermé le meme jour — iframe retiree).
> Révisé : 2026-09-08 — `Step2Geography.tsx` splitté (1 014 → 436 lignes), puis
> **retrait complet de l'overlay Pilotage ML** : les deux constats DualMap
> ci-dessous (bulles invisibles, stratégie de démo sans données simulées)
> disparaissent avec le code qui les portait. Voir la fin du document.

Ce document liste **la dette technique connue et reportée** du projet, pour
qu'un dev externe sache où sont les zones sensibles avant d'y toucher.

## Baseline mesurée le 2026-08-31

| Axe | Valeur |
|---|---|
| `npx tsc --noEmit` | 0 erreur |
| `npm test` | 331 tests / 51 fichiers verts |
| `npm run lint` | 0 erreur, 71 warnings (`<img>`, `exhaustive-deps`, entités) |
| `any` explicites | 13 — **aucun actionnable**, voir §7 |
| `@ts-ignore` / `@ts-expect-error` | 2 — déjà documentés par un `reason:` |
| `catch (e: any)` | 0 |
| imports `../../../` | 0 |
| `console.log` | 0 hors exclusions (voir §2) |
| Routes API | 215, dont 3 réellement publiques (voir §4) |
| Fichiers > 2000 lignes | 2 (et non 3 : `map/page.tsx` est à 1879) |

## 1. Trois fichiers > 2000 lignes — ✅ FERMÉ (2026-09-01 et 2026-09-03)

Décision produit chantier A4.6.2 (D3) : ces 3 fichiers avaient reçu un cleanup
interne (any → typage, console.log à migrer, naming) mais **n'avaient pas été
splittés**, le risque de régression pitch étant jugé trop élevé.

Ils l'ont été depuis, un par un, chacun vérifié en navigateur :

| Fichier | Avant | Après | Date |
|---|---|---|---|
| `app/admin/sources/page.tsx` | 2 544 | 928 | 2026-09-01 |
| `app/map/page.tsx` | 2 329 | 974 | 2026-09-01 |
| `app/map/_components/FilterPanel.tsx` | 3 651 | 892 | 2026-09-08 |

### `app/map/_components/FilterPanel.tsx` — ✅ SPLITTÉ le 2026-09-03 (3651 → 1816 lignes)

**Ce qui était prévu** : 11 sous-composants + un `<FilterPanelContext>` pour
remplacer ~150 props.

**Ce qui a été fait, et pourquoi c'est différent** : le fichier était déjà
partitionné en 4 blocs JSX par la prop `visibleCategory`
(`perimeter` / `terrain` / `audience` / `analyses`), exactement alignés sur les
overlays du rail `/map`. C'est cette frontière qui a été suivie — même découpe
que le produit, et les props restent lisibles section par section (22 pour
Périmètre, 5 à 27 pour les autres) sans contexte fourre-tout.

19 fichiers dans `app/map/_components/filter-panel/` :

| Fichier | Rôle |
|---|---|
| `tokens.ts`, `styles.ts`, `constants.ts` | tokens, helpers purs, constantes |
| `poi-style.ts`, `analysis-types.ts` | types partagés (réexportés par FilterPanel) |
| `FilterSectionHeader`, `MultiDropdown`, `RadioSearchInput` | sous-composants partagés |
| `PerimeterSections` | les 4 sections de la catégorie Périmètre |
| `PoiSection`, `OohSection`, `TransportSection`, `TmjaSection`, `RadioSection` | catégorie Terrain |
| `CarreauxSection`, `IrisSection`, `CivicIndicatorsSection`, `CivicHealthSection`, `MeteoSection` | catégorie Audience |
| `SpatialAnalysisIntro`, `VoronoiTool`, `BattleV2Tool`, `IsochronesTool` | catégorie Analyses |

JSX déplacé verbatim à chaque étape : seule la résolution des variables change,
de la fermeture lexicale vers des props. Les fichiers protégés
(`app/api/isochrone-battle/**`, fonctions PostGIS `battle_*`) n'ont pas été
touchés — seule l'UI de la bataille est découpée.

**Vérification** : smoke test navigateur avec interactions réelles après chaque
extraction, pas seulement une compilation. Référence des 4 overlays capturée
avant toute modification. Points les plus probants : sélection Bretagne qui
désélectionne « France Metro » (`setScope(null)` à travers le composant),
choroplèthe d'abstention peinte sur la carte depuis `CivicIndicatorsSection`,
et « VÉRIFIER CACHE » de `BattleV2Tool` qui remonte jusqu'à l'API et redescend
(95 POIs / 665 isochrones / 570 en cache).

### `FilterPanel.tsx` — ✅ 2ᵉ PASSE le 2026-09-08 (1 816 → 892 lignes)

La première passe avait sorti le **rendu** (23 fichiers). Restait le **cerveau** :
55 `useState`, 13 `useRef`, 9 handlers. Cette passe extrait l'état en dix hooks,
et le fichier devient un pur assembleur.

| Hook | Rôle |
|---|---|
| `types.ts` | contrat public (props + params d'action), réexporté par `FilterPanel` |
| `use-filter-sections` | recherche + sections repliables + persistance localStorage |
| `use-panel-resize` | largeur redimensionnable (hors mode overlay) |
| `use-civic-ingest` | ingestion NDJSON pollen + qualité de l'air (admin) |
| `use-poi-catalog` | catégories et natures POI, chargées dynamiquement |
| `use-territory-selection` | périmètre, référentiel géo, cascade régions→dépts, libellé |
| `use-admin-scope-layer` | filtre admin → couche carte + scope de capture partagé |
| `use-territory-mask` | masque hors-territoire MapLibre |
| `use-poi-styles` | style des pins par catégorie |
| `use-isochrone-battle` | isochrones, cache ORS, bataille V1/V2 |

**Nettoyage au passage** : 20 imports et constantes morts laissés par la
première passe. Ils survivaient parce que `next/core-web-vitals` n'active pas
`no-unused-vars` — le lint était vert malgré eux. À garder en tête : **un lint
vert ne prouve pas l'absence d'imports morts sur ce projet.**

**Seul écart de forme** : la cascade régions → départements était déclarée après
les effets de scope et de masque ; regroupée dans son hook, elle passe avant.
Vérifié au navigateur (sélection Bretagne → la liste se restreint bien à
22/29/35/56).

**Vérifié au navigateur** : 4 overlays sans erreur console ; cascade et libellé
de territoire ; persistance de la sélection à la fermeture/réouverture d'overlay ;
catalogue POI (1 seul fetch par montage, natures à la demande) ; masque
territoire comparé **pixel à pixel avec `main`** ; `handleCheckORS` de bout en
bout (POST 200, « 95 POIs · 190 isochrones · 100 % en cache »).

**Constats préexistants relevés, non corrigés** (identiques sur `main`, donc
antérieurs à cette passe) :
- le masque territoire n'affiche **jamais sa bordure teal** : le layer
  `territory-mask-border` filtre sur `['==', ['geometry-type'], 'MultiPolygon']`,
  or MapLibre normalise un MultiPolygon à un seul polygone en `Polygon` ;
- un **trait diagonal** part du nord de la Bretagne — artefact du polygone à
  trous du masque ;
- `battleGeometry` et `battlePoiGroups` sont écrits mais jamais lus ;
  `setPoisRayon` n'est jamais appelé (`poisRayon` vaut donc toujours `null`
  dans le payload de recherche POI). Vestiges d'une UI de rayon supprimée.

**Reste possible** : les handlers du composant (`runCivicIngestStream`,
`fetchCategories`/`fetchPoiNatures`, `handleBattle`/`handleBattleV2`,
`onResizeMouseDown`) pourraient partir en hooks de domaine, comme sur
`map/page.tsx`. Attention : ils ferment sur beaucoup de state local, une
extraction naïve déplacerait le problème au lieu de le résoudre. À juger hook
par hook.

---

### `app/admin/sources/page.tsx` — ✅ SPLITTÉ le 2026-09-01 (2544 → 928 lignes)

Page back-office de toutes les Data Sources MAGELIAN (POI, OOH, panneaux,
radio, INSEE) avec 3 tabs et un CRUD complet par source.

Découpe livrée : 6 panels de domaine, 3 hooks de state et 3 modules lib.
Les 9 tabs ont été re-vérifiés en navigateur après extraction.

---

### `app/map/page.tsx` — ✅ SPLITTÉ le 2026-09-01 (2329 → 974 lignes)

Page principale carte : ~70 `useState` en top-level, 7 overlays, query params
et wiring des hooks `useMapInit` / `useMapLayers` / `useChatControls`.

Découpe livrée : 5 hooks de domaine — `useRadioLayer`, `useMapDirectActions`,
`useMapMarkers`, `useMeteoLayer`, `useIrisDetail`.

---

## 2. Console.log → logger — ✅ FERMÉ le 2026-08-31

Migration effectuée (90 occurrences restantes, et non 149) sur la branche
`chore/zero-tech-debt`. La décision sémantique a été prise call site par
call site :

- **`logger.info`** — ce qui doit survivre en production : progression
  d'import/batch (`lib/import/inserter.ts`, `admin/geocode/batch`,
  `admin/import-poi/execute`, `inngest/populateCarreauxColumns`), actions
  utilisateur (`saved-maps`, `useSavedMaps`), coût LLM (tokens du chat).
  Contrainte projet : la progression tracée des traitements DB est
  obligatoire, ces logs ne peuvent donc pas être `debug`.
- **`logger.debug`** — tout le diagnostic de dev (palette, choroplèthe,
  drilldown, timings, comptages de lignes, cache HIT/MISS, traces d'outils
  chat), silencieux en prod via `IS_PROD`.

**Exclusions permanentes** — 5 `console.log` subsistent volontairement :
`lib/logger.ts` (c'est l'implémentation), `lib/crypto/secrets.ts` (le
`console.log` est le *contenu* d'un message d'erreur), et
`app/api/isochrone-battle/**` (fichiers protégés par `CLAUDE.md`).

Toute nouvelle occurrence de `console.log` hors de ces fichiers est une
régression.

---

## 3. xlsx → exceljs — ✅ FERMÉ le 2026-09-03

`xlsx` (SheetJS) portait 2 vulnérabilités HIGH sans correctif possible sur
npm (prototype pollution GHSA-4r6h-8v6p-xvw6, ReDoS GHSA-5pgg-2g8v-p4x9) :
l'éditeur a quitté le registre après la 0.18.5, et l'advisory couvre donc
toutes les versions publiées.

La dépendance est retirée. Trois consommateurs, tous des parsers serveur
derrière `requireAdmin()` :

| Fichier | Remplacement |
|---|---|
| `lib/import/file-parser.ts` | `lib/import/xlsx-reader.ts` (exceljs) |
| `lib/dsp-mapping/parser.ts` | `lib/import/xlsx-reader.ts` (exceljs) |
| `lib/radio/arcom-ods-parser.ts` | `lib/import/ods-reader.ts` (jszip, maison) |

**Pourquoi un lecteur ODS maison** : exceljs ne lit pas OpenDocument, et le
fichier de référence Arcom n'existe qu'en `.ods`. Un ODS étant un zip
contenant `content.xml`, le lecteur l'ouvre avec jszip (déjà en dépendance)
et balaie le XML en linéaire, borné par `SHEET_LIMITS`.

**Écarts de comportement assumés** :
- les cellules date sortent en `yyyy-mm-dd` au lieu du format d'affichage du
  fichier. SheetJS rendait « 1/15/26 », que `castToDataType` refusait : tout
  `.xlsx` DSP à colonne date voyait **ses lignes entièrement rejetées** en
  `validationErrors`. Bug latent corrigé au passage ;
- le binaire `.xls` (Excel 97-2003) n'est plus lu — exceljs ne sait pas le
  décoder. Décision produit du 2026-09-03 : format abandonné, erreur
  explicite demandant une conversion en `.xlsx`, extension retirée des
  `accept` de `/admin/import`, `/admin/radio` et du panneau DSP.

**Solde npm audit** : plus aucune vulnérabilité sans correctif. exceljs
apporte `uuid@8.3.2` (moderate, bornes de buffer sur v3/v5/v6 avec argument
`buf`) — chemin non atteignable, exceljs n'appelle que `uuid.v4()`.

**Couverture** : 48 tests sur `tests/unit/import/`,
`tests/unit/campaigns/dsp-xlsx-parser.test.ts` et
`tests/unit/radio/arcom-ods-parser.test.ts`, sur fixtures binaires écrites
par SheetJS avant son retrait (cf. `tests/fixtures/parsers/README.md`).

**Reste à vérifier en conditions réelles** : un import du fichier Arcom
officiel et un import POI depuis un `.xlsx` produit par Excel — aucune
fixture ne provient d'un vrai tableur.

---

## 4. Routes API sans auth explicite — ✅ REQUALIFIÉ le 2026-08-31

Le chiffre de 40 routes était un **faux positif de méthode** : l'audit
comptait les routes dépourvues de guard *dans le fichier de route*, sans
tenir compte de `middleware.ts`, qui protège en amont tout un ensemble de
préfixes `/api/*`. Il ignorait aussi le guard `requireDspAccess` (15 routes
DSP).

Mesure empirique — chaque route sans guard interrogée sur le serveur dev.
**3 routes seulement répondent 200 sans authentification** :

| Route | Nature |
|---|---|
| `/api/iris-tiles/[z]/[x]/[y]` | tuiles MVT IRIS |
| `/api/tmja-tiles/[z]/[x]/[y]` | tuiles MVT TMJA |
| `/api/ref/geo` | référentiel géographique |

(`/api/inngest` répond 200 aussi, mais c'est un webhook signé, exclu du
matcher à dessein.)

**Cause réelle** : une incohérence du `matcher` de `middleware.ts`.
`/api/tiles` y figure et est protégé, mais `/api/iris-tiles` et
`/api/tmja-tiles` non — alors que les trois servent la même classe de
tuiles. Le correctif tient en deux entrées de matcher.

⚠️ **Bloqué** : `middleware.ts` est un fichier protégé par `CLAUDE.md`
(« NE PAS MODIFIER sauf demande explicite »). Nécessite l'accord de Vince.

⚠️ **Piège sur `/api/ref/geo`** : cette route a des appelants **serveur**
internes (`lib/geo/france-admin.ts`), qui n'envoient pas de cookie. La
passer derrière le middleware les casserait — elle demande un traitement
distinct des deux routes de tuiles.

**Note d'architecture à ne pas perdre** : les guards de `lib/api/middleware.ts`
lisent le header `Authorization` et n'ont **aucun fallback cookie**, alors que
`middleware.ts` valide le cookie via `getSession()` (JWT local, zéro appel
réseau). Ajouter un guard de route sur un chemin déjà couvert par le
middleware est donc à la fois redondant *et* nuisible : `getUserFromRequest`
appelle `supabase.auth.getUser(token)`, soit un aller-retour réseau par
requête — exactement ce que `CLAUDE.md` interdit sur les routes API depuis
l'incident du 28/03. Tentative faite puis annulée le 2026-08-31
(commits a6d7cec / 48c523f) : ne pas la refaire.

---

## 5. Table sans PRIMARY KEY : `carreaux_1km` — ✅ FERMÉ (sans action) le 2026-08-31

Investigation faite : **aucune action requise**, l'absence de PK est sans
conséquence ici.

- La table est **vide** (0 ligne, vérifié via l'API REST) et n'a jamais été
  peuplée. La migration `20260424_fix_get_tile_carreaux_z10_z12.sql` le
  documente explicitement (« 0 rows — JAMAIS PEUPLÉE ») et a modifié le RPC
  `get_tile` pour qu'il ne l'interroge plus aux zooms 10-12.
- **Aucun code applicatif ne la lit ni ne l'écrit** : les seules références
  sont `scripts/populate_carreaux_1km.ts` et des migrations historiques.
- Le risque évoqué (un UPSERT non-keyé qui dépendrait de l'absence de PK)
  **n'existe pas** : le script de peuplement fait `TRUNCATE` puis `INSERT`,
  jamais d'UPSERT.

Ajouter une contrainte à une table vide et non interrogée n'apporterait
rien. La vraie question, si elle se pose un jour, est de **la supprimer**
ou de la peupler — décision produit, pas dette technique.

Les agrégats réellement en service sont `carreaux_2km` et `carreaux_5km`
(cf. ARCHITECTURE.md).

---

## 6. Sous-phase C de A4.6.2 (refactor 500-1500 lignes)

25 fichiers entre 500 et 1500 lignes listés dans
`docs/cleanup_targets_phase2.md`. Le splitting de chacun est un risque
modéré : 1 fichier à la fois, smoke E2E manuel par Vince après chaque
extraction.

**Effort estimé** : ~6-8 h Claude Code (1-3 sessions selon la rigueur du
smoke E2E entre chaque fichier).

---

## 7. `any` résiduels — ✅ AUCUN ACTIONNABLE (2026-08-31)

13 `any` explicites subsistent. Aucun n'est corrigeable utilement :

- **9 sont dans `app/api/isochrone-battle/**`** — fichiers protégés par
  `CLAUDE.md`, interdits à la modification.
- **3 sont dans `app/api/isochrone-battle-v2/route.ts`** — non formellement
  protégé, mais c'est le flux le plus critique du pitch. Un changement
  purement cosmétique de typage y présente un risque de régression sans
  aucun gain fonctionnel. Décision : ne pas y toucher.
- **1 est légitime (vendor)** : `app/api/map/pois/route.ts:160`,
  `(q: any): any` type un builder de requête PostgREST dont le type change à
  chaque filtre chaîné.

Les 2 `@ts-expect-error` (`app/api/chat/route.ts`, `lib/mcp/datagouv.ts`)
portent déjà un commentaire `reason:` documentant l'incompatibilité de types
du SDK AI : conformes au protocole, rien à faire.

**Ne pas relancer de chasse aux `any` sur cette base** : le compte de 13 est
un plancher structurel, pas de la dette.

---

## 8. Routes API sans appelant — ✅ FERMÉ (constat du 2026-09-07)

L'item décrivait `/api/carreaux` et `/api/map/tmja` comme candidates à la
suppression, en attente d'un accord produit.

**Elles n'existent plus.** Les deux faisaient partie du lot de 9 routes sans
appelant retirées lors du cleanup précédent — cf. `CHANGELOG-CLEANUP.md`
§1 « Code mort supprimé ». `app/api/carreaux/` et `app/api/map/tmja/` sont
absents du dépôt, et plus aucun fichier `.ts`/`.tsx` ne les référence.

L'item était donc périmé, pas ouvert : l'accord a été donné le 2026-09-07,
il n'y avait rien à supprimer. Aucune action requise.

---

## Résumé

### Fermé le 2026-08-31 (branche `chore/zero-tech-debt`)

| Item | Résolution |
|---|---|
| console.log → logger | 90 occurrences migrées, décision sémantique par call site |
| 40 routes API sans auth | requalifié : 3 routes réellement publiques, cause = matcher middleware |
| `carreaux_1km` PK | fermé sans action — table vide, jamais lue, pas d'UPSERT |
| `any` résiduels | aucun actionnable — 9 en fichiers protégés, 1 vendor, 3 écartés |

### Fermé le 2026-09-01 (branche `refactor/split-gros-fichiers`)

| Item | Résolution |
|---|---|
| `admin/sources/page` split | 2 544 → 928 lignes (6 panels, 3 hooks, 3 modules lib) |
| `map/page` split | 2 329 → 974 lignes (5 hooks de domaine) |

### Fermé le 2026-09-03

| Item | Résolution |
|---|---|
| xlsx → exceljs (2 vuln. HIGH sans correctif) | dépendance retirée, lecteurs maison + 48 tests — cf. §3 |
| `FilterPanel` split (3651 l.) | 3651 → 1816 lignes, 19 fichiers par catégorie d'overlay — cf. §1 |
| `npm audit fix` | 22 → 17 vulnérabilités, lockfile seul ; les 17 restantes demandent un changement cassant et sont dev-only sauf `next` |

### Fermé le 2026-09-07

| Item | Résolution |
|---|---|
| `admin/import/page` split (1 776 l.) | 1 776 → 586 lignes, 7 composants + 2 modules dans `app/admin/import/_components/` — cf. §1 |
| `admin/carreaux-import/page` split (1 526 l.) | 1 526 → 502 lignes, 4 composants + `shared.ts` dans `_components/`, parsers binaires dans `_lib/shapefile.ts` — cf. §1 |
| Parsers shapefile sans test | 36 tests (`tests/unit/import/shapefile.test.ts`) ; suite passée de 388 à 424 tests |
| `PilotageOverlay` split (1 217 l.) | 1 217 → 244 lignes, 8 composants dans `components/map/overlays/pilotage/` — cf. §1 |
| Cercles invisibles du pilotage (`DualMap`) | garde-fou `Math.max(1, …)` retiré, expression extraite en fonction pure + 13 tests — cf. plus bas |
| Interpolation perdue au dry-run | `{'// apercu carte — {dryRunResult.samplePoints.length} premiers points'}` rendait le code en clair depuis `abf5db6` ; seul cas de la branche, corrigé |

### Fermé le 2026-09-08

| Item | Résolution |
|---|---|
| `Step2Geography` split (1 014 l.) | 1 014 → 436 lignes, neuf sous-composants + `shared.ts`/`presets.ts` — puis supprimé avec Pilotage ML le même jour |
| Cercles invisibles `DualMap` | caduc : le composant est supprimé |
| Stratégie de démo sans données simulées | caduc : la vue qui les lisait est supprimée |
| Overlay Pilotage ML et sa dépendance morte | 90 fichiers et 12 728 lignes retirés (dont les 12 du split Step2 du matin même), 22 routes `/api/bidding/*` sans appelant, 3 modules `lib/bidding-ml/`, `app/demo/pilote/_components` — bundle `/map` 189 → 149 kB |
| 71 warnings ESLint | 0 warning : ils vivaient tous dans le code supprimé |
| Traçabilité base | `types/database.types.ts` généré (6 684 l.) + audit RPC complet dans `docs/AUDIT_BASE.md` — 3 RPC appelées mais absentes de la base identifiées |

### Ouvert

| Item | Effort | Risque pitch | Bloqueur |
|---|---|---|---|
| 2 entrées de matcher middleware | 15 min | faible | **fichier protégé — accord Vince** |
| bump `next` 14.2.35 (advisory haute) | 2-4 h | élevé | `audit fix --force` requis + smoke complet |
| Brancher `Database` sur le client Supabase | 4-6 h | medium | 106 erreurs de typage sur 60 fichiers — cf. `docs/AUDIT_BASE.md` |
| `get_radio_coverage_geometry` absente de la base | 1-2 h | faible | **décision produit** : rayon de couverture par portée d'émetteur |
| `get_check_constraint_values` absente (rôles en dur malgré l'appel) | 30 min | faible | décision : créer la fonction ou assumer la constante |
| `compute_panneau_scores` absente (`rescore_all_villes.py` cassé) | 1 h | faible | décision : script mort, ou fonction à écrire |

**Plus aucun fichier de plus de 1 000 lignes au 2026-09-08.** `FilterPanel.tsx`
est sorti de cette liste le jour meme (1 826 → 892, cf. §1). Le plus gros
fichier restant est `app/copilote/_hooks/useMapLayers.ts` (963 lignes), sous le
seuil et hors chantier.

`Step2Geography.tsx` est sorti de cette liste le 2026-09-08 (1 014 → 436 lignes,
neuf sous-composants + `shared.ts` et `presets.ts` dans
`app/strategies/_components/steps/step2/`), **puis a été supprimé le même jour**
avec l'overlay Pilotage ML : il n'était atteignable que par lui.

`components/map/overlays/PilotageOverlay.tsx` est sorti de cette liste le
2026-09-07 : 244 lignes, huit composants dans
`components/map/overlays/pilotage/` (`shared.ts`, `BackBar`, `SelectedRow`,
`CampaignPicker`, `StrategyPicker`, `CreateWizardLoader`, `EditWizardLoader`,
`StrategyDetail`). L'overlay ne garde que la machine à états des trois vues ;
`StrategyDetail` (495 l.) emporte tous les imports lourds, que la liste ne
charge donc plus.

`app/admin/import/page.tsx` est sorti de cette liste le 2026-09-07 : 586 lignes,
sept composants d'étape et deux modules partagés dans
`app/admin/import/_components/` (`UploadStep`, `CategoryStep`, `MappingStep`,
`ColumnSelectionStep`, `GeocodeStep`, `DryRunStep`, `ImportStep`,
`ImportLogPanel`, plus `shared.tsx` et `styles.ts`). La page ne garde que
l'état du wizard, les appels API et l'assemblage des étapes.

> ⚰️ **Les deux constats qui suivent sont caducs depuis le 2026-09-08** :
> `DualMap`, la page `/custom-bidding/[strategyId]` et l'overlay Pilotage ML
> ont été supprimés. Conservés ici pour la trace du raisonnement.

**Cercles invisibles sur la carte du pilotage à faible volume** —
✅ **CORRIGÉ le 2026-09-07** (branche `fix/dualmap-circle-radius`).
`DualMap.tsx` construisait son `circle-radius` en `interpolate` avec des
paliers `Math.max(1, maxImpressions * k)`. Dès que `maxImpressions ≤ 3,33` —
et notamment à 1, sa valeur par défaut quand aucun point n'a de volume —
plusieurs paliers retombaient tous sur 1 : les bornes n'étaient plus
strictement croissantes, MapLibre rejetait l'expression entière sans lever
d'exception (`layers.dual-circle-*.paint.circle-radius[7]` en console) et le
rayon restait au 0 initial. **Le garde-fou était la cause.**

Les bornes dérivent maintenant d'une base toujours strictement positive
(`maxImpressions` sinon 1), ce qui rend `base*0.05 < base*0.3 < base*0.6 <
base` vrai pour toute base > 0. L'expression est sortie du composant vers
`app/custom-bidding/[strategyId]/_lib/circle-radius.ts` — fonction pure,
13 tests dont la propriété de stricte croissance sur toute la plage de
volumes. Vérifié en navigateur : l'expression est acceptée, l'erreur console
a disparu.

**Aucune donnée simulée pour la stratégie de démo `dccc0000-…-000000000012`** —
seconde cause, indépendante, découverte en vérifiant le fix ci-dessus. La
stratégie a 11 435 lignes dans `bidding_zone_configs` mais **0 ligne** dans
`bidding_daily_state`, `bidding_simulations` et `bidding_curve_history`.
Les 6 051 codes postaux renvoyés à `DualMap` ont donc tous leurs métriques à
0 (`leads_real`, `leads_sim`, `impressions_*`, `spend_*`, `clicks_*`), et les
bulles ont un rayon de 0 à juste titre. Ce n'est pas un bug de rendu : le
seed de démo du pilotage n'a jamais été rejoué sur cette base. À trancher
avec Vince — rejouer la simulation, ou retirer cette stratégie de la démo.

**Aperçu carte du dry-run inopérant** — ✅ **FERMÉ le 2026-09-07** :
l'`<iframe>` OpenStreetMap de l'étape 04 était bloqué par le CSP de
`next.config.js:12` (`default-src 'self'`, pas de `frame-src`). Il n'affichait
donc rien, ni en local ni en production — seulement une erreur console à chaque
dry-run. Décision produit : **retirer l'aperçu** plutôt qu'ouvrir le CSP vers
un domaine tiers. L'`<iframe>` et son helper `getMapPreviewUrl` sont supprimés
de `DryRunStep.tsx` ; la liste des points d'aperçu, juste en dessous, reste
consultable — rien n'est perdu pour l'utilisateur.

`app/admin/carreaux-import/page.tsx` est sorti de cette liste le 2026-09-07 :
502 lignes, quatre composants (`Stepper`, `FilesStep`, `MappingStep`,
`ImportStep`) plus `shared.ts` dans `_components/`, et surtout les parsers
binaires `.shp` / `.dbf` isolés dans `_lib/shapefile.ts` — fonctions pures,
sans React, testables pour la première fois. **36 tests les couvrent depuis
le 2026-09-07** (`tests/unit/import/shapefile.test.ts`, fixtures binaires
construites dans le test), vérifiés par mutation.

**Total restant : ~11-16 h**, dont l'essentiel est bloqué non par la
difficulté technique mais par le besoin de validation manuelle en
navigateur après chaque extraction.

Chaque item est isolable et peut faire l'objet d'un chantier dédié indépendant.
