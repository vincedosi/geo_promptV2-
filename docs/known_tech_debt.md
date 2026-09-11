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
| `app/map/_components/FilterPanel.tsx` | 3 651 | 897 | 2026-09-08 |

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

### `FilterPanel.tsx` — ✅ 2ᵉ PASSE le 2026-09-08 (1 816 → 897 lignes)

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

## 5. Table sans PRIMARY KEY : `carreaux_1km` — ✅ FERMÉ (recréée) le 2026-09-11

> **Mise à jour du 2026-09-11.** L'analyse ci-dessous était juste au moment où
> elle a été écrite, mais son verdict « aucune action requise » est devenu faux.
> La table a été **recréée avec une clé primaire (`grid_id`) et peuplée**
> (374 511 mailles, 151 Mo) : elle sert désormais les tuiles z9-z11 et c'est
> elle qui a fait passer le zoom 9 de 25 s à 2 s. Voir `sql/129`.
>
> `scripts/populate_carreaux_1km.ts` est désormais **définitivement obsolète** :
> le remplissage se fait par la fonction SQL `fill_carreaux_1km_bande`. Le
> script n'a jamais abouti et n'a plus de raison d'être — candidat à la
> suppression.
>
> Leçon : « table vide, personne ne la lit » ne veut pas dire « table inutile ».
> Elle voulait dire ici « palier manquant dans la cascade ».

### L'analyse d'origine (2026-08-31)

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
| `compute_panneau_scores` absente — **le scoring des panneaux n'a jamais fonctionné** | 1 h (retrait) ou chantier produit (écriture) | faible | **décision produit, mesurée le 2026-09-10** — voir ci-dessous |
| `maplibre-gl` 5.18 — bypass XSS `DOM.sanitize()` | à rechiffrer | **abaissé** — le chemin d'exploitation chez nous est coupé depuis `d058719` (popups échappées à la source) ; il reste une dépendance vulnérable au catalogue | **TENTÉ ET ABANDONNÉ le 2026-09-11** — la migration du code est faite et propre, mais la v6 ne rend pas. Voir l'encadré ci-dessous. |
| `DROP` de 4 tables et ~55 fonctions sans usage | 2-3 h | faible | cf. `docs/AUDIT_BASE.md` — appliquer les 3 garde-fous d'un audit d'orphelins |
| 25 fichiers de 500-1500 lignes (§6) | 6-8 h | modéré | **valeur devenue faible** : plus aucun fichier > 1 000 l., le seuil qui motivait le chantier |
| `carreauxNormaliseExpr` ne distingue pas « superficie absente » de « superficie nulle » | 1-2 h | modéré — une absence de donnée se lit comme une vraie valeur nulle, donc credible au lieu d'être signalée | aucun ; un `['has', 'superficie_km2']` rendrait l'absence visible |
| Les 28 bornes nationales de `lib/carreaux/bornes.ts` sont un instantané du 2026-09-10 | à chiffrer (script de re-mesure + signal de fraîcheur) | élevé — un ré-import Filosofi les périme **sans aucun signal**, la carte reste plausible mais fausse | décision produit : quel signal de péremption (date stockée + comparaison à l'import, alerte admin, ou re-mesure automatique post-import) |
| Bloc mort `{false && …}` de `MapPanel.tsx` (~115 l.) | 30 min | faible | aucun. Le reste de cette entrée — `CarreauxPMTilesLayer.tsx` — est **fermé le 2026-09-11** : catalogues extraits dans `lib/carreaux/catalogue.ts`, composant supprimé. |

#### `compute_panneau_scores` — ce que la mesure dit (2026-09-10)

La dette annonçait « décision : script mort, ou fonction à écrire ». Mesuré en
base, la question est en réalité tranchée par les faits :

- **1 434 panneaux, tous actifs. `score_ooh_final` et `score_demo` renseignés
  sur les 1 434 — mais avec UNE SEULE valeur distincte : `0.000`.** Tous les
  scores valent zéro.
- **`score_computed_at` est NULL sur les 1 434 lignes** : aucun panneau n'a
  jamais été scoré. Les valeurs à zéro sont des défauts de colonne, pas un
  résultat.
- La table porte **14 colonnes de score** (`score_age_*`, `score_transport`,
  `score_proximite_lycee`, `score_proximite_cirfa`, `score_flux_routier`,
  `score_demo`, `score_ooh_total`, `bonus_isochrone`, `score_ooh_final`).
- **Un seul lecteur applicatif** : `app/api/admin/transport-stats/route.ts`,
  qui agrège `score_transport`, `score_flux_routier` et `score_ooh_total` —
  donc qui agrège des zéros et produit des statistiques vides de sens.
- `scripts/rescore_all_villes.py` (32 l.) appelle la RPC absente : il échoue à
  chaque exécution.
- **Aucune spécification n'existe.** `docs/SCORE.md` concerne un autre sujet
  (le score d'alignement géographique des campagnes DSP).

Ce n'est donc pas un bug à corriger mais **une fonctionnalité jamais terminée**.
Écrire la fonction demande une spécification produit (quelle pondération entre
démographie, transport, flux routier, proximité ?) qui n'a jamais été écrite.

Deux sorties, toutes deux à arbitrer par Vincent :
1. **Retirer** — supprimer `rescore_all_villes.py`, et soit retirer les 14
   colonnes, soit les documenter comme non peuplées. Corriger ou retirer
   `/api/admin/transport-stats`, qui affiche aujourd'hui des moyennes de zéros.
2. **Écrire** — chantier produit à part entière, à cadrer, pas une tâche de
   nettoyage.

#### Nouvelles entrées du 2026-09-11

| Item | Effort | Risque | Bloqueur |
|---|---|---|---|
| `carreaux_filosofi` : 4,6 Go dont un jsonb `metadata` de **806 o/ligne**, lu en entier pour extraire 29 nombres. Plancher d'I/O d'environ 4 s par tuile froide sur Nano | 3-4 h | faible aujourd'hui — le palier ne sert plus que z12+, où les tuiles sont petites | aucun ; la réponse est une table 200 m à colonnes typées (~330 o/ligne, 3,3× moins d'I/O), sur le modèle de `carreaux_1km`. **Ne pas redescendre le seuil du 200 m sous z12 avant de l'avoir faite.** |
| `scripts/populate_carreaux_1km.ts` n'a jamais abouti et est remplacé par `fill_carreaux_1km_bande` | 15 min | nul | aucun ; supprimer le script et les deps `pg`/`@types/pg` si `populate_geom_3857.ts` ne les utilise plus |
| Outils de construction laissés en base : `fill_carreaux_1km_bande` + `carreaux_1km_bandes` (journal) | — | nul | à conserver : ils resservent au prochain ré-import Filosofi. Rejouer une bande journalisée est refusé par conception ; pour tout reconstruire, `TRUNCATE` les deux tables. |


#### `maplibre-gl` 6 — tenté et abandonné le 2026-09-11

**La migration du code est faite, propre, et committée en partie** (`07aa23e`
pour ce qui était réutilisable). Ce qui bloque n'est pas notre code.

Ce qui a été fait et qui marchait :
- `maplibre-gl@6.9.0` puis `@6.4.1` installées, `npx tsc --noEmit` **0 erreur**,
  `npm run lint` 0 warning, **456 tests verts**, `npm run build` réussi.
- 17 imports `import maplibregl from` → `import * as maplibregl from`
  (la v6 n'a plus d'export par défaut).
- Une seule vraie incompatibilité de type dans tout le projet : `patchLabelFr`
  dans `useMapInit.ts`, corrigée proprement et **conservée** en v5.
- Trois ruptures annoncées ne nous concernent pas : `styleimagemissing` n'est
  pas utilisé, aucun `setData` à deux arguments, aucun chaînage sur sa valeur
  de retour.

**Le blocage.** La carte ne rend rien — écran blanc. `map.loaded()` reste
`false` indéfiniment, aucune requête `.pbf` n'est jamais émise, et **aucune
erreur n'est levée nulle part** (ni console, ni événement `error` de la carte).

Ce qui a été écarté par la mesure, et ne doit pas être re-testé :
- **Ce n'est pas notre code** : une carte MapLibre 6 nue, construite à la main
  avec le style standard `openfreemap/positron` et zéro ligne du projet, échoue
  exactement pareil.
- **Ce n'est pas le bundling de production** : même échec en `npm run dev`.
- **Ce n'est pas WebGL2** (exigé par la v6) : contexte WebGL2 obtenu avec
  accélération matérielle réelle (ANGLE/Intel/D3D11), 32 extensions, aucune des
  extensions attendues manquante.
- **Ce n'est pas le worker** : le dispatcher a bien 1 acteur, et les Workers
  classiques comme modules fonctionnent dans la page.
- **Ce n'est pas le réseau** : style, sprites et TileJSON répondent tous 200.

**La piste à suivre — le style est TRONQUÉ.** Le même style rend
**85 couches en v5** et **55 en v6** : 30 couches disparaissent. Cela colle
exactement à une rupture annoncée de la v6 : « Update maplibre-gl-style-spec to
version 25, which now throws an error with warning severity instead of silently
failing ». L'hypothèse à tester en premier est donc que le style
OpenFreeMap/MAGELIAN contient des couches que la spec v25 rejette, et que le
style n'atteint jamais l'état « chargé ». Instrumenter la validation du style
plutôt que de re-tester l'environnement.

**Note sur les versions.** Le correctif XSS est en **6.4.1**, pas en 6.9.0
comme le suggère `npm audit` (qui pointe simplement la dernière). Les deux
échouent identiquement : ce n'est pas une régression récente, c'est toute la
branche v6.

**Effet de bord favorable à connaître** : la v6 étant ESM-only, `dist/` ne
contient plus aucun `.js`. La règle webpack de `next.config.js` qui cible
`maplibre-gl/dist/*.js` ne matcherait donc plus rien, et le crash qu'elle
prévient ne peut plus se produire. Elle sera à retirer le jour de la bascule —
`next.config.js` est un fichier protégé, il faudra l'accord explicite.

### Fermé le 2026-09-11 (seconde passe)

| Item | Résolution |
|---|---|
| **Le contenu des popups de carte n'était pas échappé** — 13 `setHTML` interpolant des valeurs de `poi_france` / `panneaux_affichage`, alimentées par des imports CSV/XLSX/ArcGIS | `lib/map/echapper-html.ts` + 9 tests, appliqué à 30 interpolations dans 7 fichiers (`d058719`) |
| L'échappement local de `useMapMarkers.ts` omettait l'apostrophe | **Trou réel, démontré** : une charge `x' onmouseover='…` dans un attribut en quotes simples produisait les attributs `["title", "onmouseover"]`. Avec le helper partagé : `["title"]`. Le local est supprimé. |

**Ce que cela change pour l'entrée `maplibre-gl` restée ouverte.** `npm audit`
signale le bug de `DOM.sanitize()`. Mais chez nous, le sanitizer de MapLibre
était la **seule** protection entre un import de POI et l'exécution — c'est
cela, le risque exploitable, et il ne dépendait pas de la version installée.
Il est fermé. La faille cataloguée reste ouverte tant que la v6 ne rend pas,
mais son chemin d'exploitation ici est coupé, et l'échappement gardera sa
valeur après la bascule (défense en profondeur).

### Fermé le 2026-09-11

| Item | Résolution |
|---|---|
| Cascade de zoom des carreaux (chantier prioritaire du 10/09) | densité + bornes nationales fixes + palier 20 km, carreaux visibles dès z4 — `sql/124`, `sql/125` |
| **Fluidité du zoom** — « des endroits ok et d'autres non » | deux causes mesurées, voir ci-dessous. Résultat : **plus aucun zoom au-dessus de 3 s** sur tuiles froides, contre plus de 15 s auparavant |
| `code_dept`/`code_region` dans les tuiles carreaux | **retirés** (`sql/126`). Ajoutés en avril 2026 « pour filtre territorial client-side » — filtre jamais construit, zéro lecteur. Ils coûtaient **10 250 ms sur les 11 438 ms** d'une tuile z8 : un `ST_Intersects` par carreau contre les multipolygones départementaux, 2 954 fois. Après retrait : 100 ms |
| Trou z11 → z12 de la cascade (facteur 10) | **palier 1 km construit** (`sql/129`) : 374 511 mailles, 151 Mo, clé primaire, géométrie en 3857. Sert z9-z11 |
| `carreaux_1km` vide depuis toujours | peuplée et branchée — voir §5 |
| `CarreauxPMTilesLayer.tsx` (373 l.), mort comme composant mais vivant comme module | catalogues extraits dans `lib/carreaux/catalogue.ts`, quatre importateurs réaiguillés, composant supprimé (`07aa23e`) |

**L'estimation « coût mesuré nul » de l'entrée `geom_centroid` était fausse.**
Elle ne regardait que le palier 200 m, où la jointure court-circuitait parce que
`geom_centroid` est NULL. Aux paliers 2 km et 5 km, où le centroïde est calculé
à la volée, la même jointure consommait **99 % du temps de la tuile**. Une
mesure partielle avait été généralisée à tort.

**Deux pièges rencontrés en construisant `carreaux_1km`**, dignes d'être retenus
pour toute agrégation par lots :

1. **Un découpage en bandes n'est pas forcément une partition.** `geom_3857 &&
   envelope` compare des *boîtes englobantes* ; un carreau défini en EPSG:3035
   reprojeté en 3857 devient un quadrilatère pivoté dont la boîte déborde. Les
   carreaux de bordure appartenaient à deux bandes et l'agrégation additive les
   comptait deux fois : **68 546 296 habitants au lieu de 62 592 659 (+9,5 %)**.
   Attrapé par un **invariant de totaux**, pas par relecture du code.
2. **Un timeout côté client ne dit rien du sort de la transaction.** Plusieurs
   bandes ont expiré côté client puis se sont validées côté serveur ; les
   rejouer aurait doublé leurs valeurs en silence. Un journal écrit *dans la
   même transaction*, avec clé primaire, est le seul garde-fou fiable.

### Fermé le 2026-09-10

| Item | Comment |
|---|---|
| Pastille de légende ≠ couleur peinte ≠ filtre | `fill-color` posait ses 6 arrêts à `k/5` de l'étendue, légende et filtre découpaient en `k/6`. Remplacé par un `['step', …]` sur les bornes de `palierEchelle` : l'égalité est désormais vraie **par construction**. Effet de forme assumé — dégradé continu → choroplèthe à 6 classes. |
| Palier 0 du filtre non ouvert vers le bas | Les carreaux sous la borne nationale basse étaient peints mais introuvables au clic. Vérifié au navigateur : inatteignable à z10 (un carreau 200 m à 1 habitant vaut déjà 25 hab/km²), et correctement sélectionné à z6 sur le palier 5 km. |

| Item | Comment |
|---|---|
| Brancher `Database` sur le client Supabase | 105 → **0** erreur `tsc`. Quatre helpers documentent les frontières que le générateur ne sait pas typer (`toJson`, `rpcJson`, `nullableArg`, `triggerFilled`). Deux bugs réels déterrés : le rôle `editor` absent des unions TS, et une trace d'audit auto-pilot qui n'a jamais pu s'écrire. |
| bump `next` 14.2.35 → 15.5.25 | Corrige au passage une incohérence préexistante : React 19.2.4 tournait sur Next 14 avec des `@types/react` en 18. Vérifié à l'exécution (`/map` MapLibre, overlay Audience, 0 warning `sync-dynamic-apis`). Déployé en production. |
| `get_radio_coverage_geometry` absente | `sql/121`. Aucune décision produit à prendre : `rayon_couverture_m` était déjà calculé et stocké sur les 11 836 émetteurs. Pire cas mesuré : 1,4 s pour 1 bloc lu. |
| 2 entrées de matcher middleware | Fermé le 2026-09-08 (`b010f78`), avec accord explicite sur le fichier protégé. |
| Rôle `editor` fantôme + modèle de droits non documenté | `editor` supprimé (migration `drop_editor_role`) ; ARCHITECTURE.md gagne le tableau des pouvoirs réels et la mention **RLS dormantes**. |
| Bouton « Inviter » qui n'invitait personne | Parcours de première connexion complet (`/reset-password`), sans système d'email. |
| `get_check_constraint_values` absente | **Appel retiré**, fonction non écrite : la dynamique était structurellement impossible (le filtre `r in ROLE_LEVELS` écartait de toute façon tout rôle absent du code, et un rôle a besoin d'un niveau + libellé que la contrainte CHECK ne porte pas). Le `satisfies Record<UserRole, _>` empêche la dérive, et mieux. |

**Plus aucun fichier de plus de 1 000 lignes au 2026-09-08.** `FilterPanel.tsx`
est sorti de cette liste le jour meme (1 826 → 897, cf. §1). Le plus gros
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
