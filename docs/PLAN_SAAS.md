# PLAN DU SAAS — MAGELIAN

> Audit du 2026-09-08 (protocole `cleanup-geomatik`). Carte du SaaS et liste des
> candidats au retrait, validés un par un.
> Périmètre vérifié sur le code réel : 27 pages, 184 routes API, `lib/import/`.
>
> **État : groupe A retiré** (13 routes + le leurre `carreaux`, commit `c248677`)
> — il reste **171 routes**. Les groupes B et C attendent un arbitrage.

---

## 1. Carte des pages

**Règle structurelle** (cf. mémoire *Vision map + overlays*) : tout le métier passe
par `/map` et ses overlays ; l'admin est un back-office atteint par l'overlay
Réglages. `AppSidebar` se masque sur `/map` (`return null` si `pathname` commence
par `/map`) et sert donc uniquement de navigation aux pages back-office.

### Métier — `/map` et ses overlays

| Page | Rôle | Atteinte |
|---|---|---|
| `/map` | Carte + rail 8 entrées (geo.prompt, Périmètre, Terrain, Audience, Analyses, Campagne, Zones, Réglages) | racine du produit |
| `/map/custom-geo` | Zones custom + plan média | rail « Zones » et AppSidebar |
| `/map/analyse/digital` | Analyse des campagnes digitales | interne |
| `/demo/pilote` | **redirect** vers l'overlay MAGELIAN sur la campagne de démo | raccourci de démo (8 l.) |

Overlays du rail : `AIOverlay`, `SettingsOverlay`, `ZonesOverlay`, plus l'overlay
MAGELIAN (`components/magelian/`).

### Back-office — atteint par l'overlay Réglages (11 liens) et `AppSidebar`

| Page | Rôle | Dans Réglages | Dans AppSidebar |
|---|---|---|---|
| `/admin/organizations` (+ `/[id]`) | CRUD organisations, membres, sources | oui | oui |
| `/admin/users` | CRUD utilisateurs | oui | oui |
| `/admin/import` | **Import universel POI** | oui | oui |
| `/admin/carreaux-import` | **Import Shapefile (carreaux)** | oui | oui |
| `/admin/ooh-import` | Import OOH ArcGIS | oui | oui |
| `/dashboard/iris-crawler` | **Import IRIS INSEE** | oui | oui |
| `/admin/radio` | Radio FM/DAB+ (ANFR + Arcom) | oui | oui |
| `/admin/api` → `/dv360`, `/tiktok`, `/logs`, `/meta`, `/ttd` | Connexions DSP | oui | oui |
| `/admin/sources` | Sources de données + POI + zones | oui | oui |
| `/admin/imports` | Historique des imports | oui | oui |
| `/admin/health` | Monitoring DB | oui | oui |

`/admin/api/meta` et `/admin/api/ttd` sont des **placeholders produit assumés**
(`ProviderPlaceholder`), pas du code mort : Meta et The Trade Desk restent à brancher.

### Hors navigation

| Page | Lignes | Nature |
|---|---|---|
| `/dashboard` | 207 | accueil après login, tuiles de navigation ; lien « Home » du FilterPanel |
| `/login` | — | authentification |
| `/sign-up` | 6 | **redirect** vers `/login` — garde-fou, à conserver |
| `/init` | 56 | initialisation du premier admin (`ADMIN_INIT_KEY`) — à usage unique |
| `/design-system` | 451 | vitrine des composants shadcn — outil de dev |
| `/dev/test-custom-geo-capture` | 147 | banc de test de la capture custom-geo — outil de dev |

---

## 2. Les systèmes d'import — état réel

Il y a **sept** pipelines d'entrée, pas un seul. Le « truc universel »
(`lib/import/`, 2 457 lignes) ne sert en réalité **qu'aux POI**.

| # | Pipeline | Page | Routes | Bibliothèque | État |
|---|---|---|---|---|---|
| 1 | **POI universel** | `/admin/import` | `import-poi/{parse,dry-run,execute}` + `geocode/{batch,update}` | `lib/import/` | vivant |
| 2 | **Carreaux / Shapefile** | `/admin/carreaux-import` | `import-geo` + `import-geo/register` | `_lib/shapefile.ts` **(parser propre)** | vivant |
| 3 | **IRIS INSEE** | `/dashboard/iris-crawler` | `iris-crawler/{manual-upload,manual-import,import-history}` | `lib/iris-crawler/` | vivant — un seul chemin depuis le 08/09 |
| 4 | **OOH ArcGIS** | `/admin/ooh-import` | `admin/import-ooh/arcgis` | — | vivant |
| 5 | **Radio ANFR/Arcom** | `/admin/radio` | `radio/import-anfr`, `import-arcom-ods`, `crawl-arcom` | `lib/radio/` | vivant |
| 6 | **Campagnes DSP** | overlay MAGELIAN | `admin/campaigns/import` | `lib/campaigns/` | vivant |
| 7 | **data.gouv** | bouton du copilote | `admin/import-datagouv` | `lib/mcp/datagouv` | vivant |

### Réponse directe : par où sont passés les carreaux et les IRIS

- **Carreaux** → `/admin/carreaux-import` (« Import Shapefile ») → `POST /api/admin/import-geo`,
  puis `import-geo/register`. Ce chemin **n'utilise pas** `lib/import/` : il a son
  propre parser binaire `.shp`/`.dbf` dans `app/admin/carreaux-import/_lib/shapefile.ts`
  (isolé et couvert par 36 tests le 07/09).
- **IRIS** → `/dashboard/iris-crawler`, par **dépôt manuel d'un CSV**
  (`manual-upload` → `manual-import`). Le crawler 3 temps a été supprimé en
  2026-07 (staging disque incompatible serverless) et le téléchargement INSEE
  one-shot (`iris-import/insee`) le **08/09** : il n'écrivait rien dans
  `iris_import_history`, et les 8 imports IRIS de la base sont tous des CSV
  Filosofi déposés à la main.

### Le leurre `carreaux` de l'import universel

`lib/import/types.ts` déclarait `DataType = 'poi' | 'carreaux'` et
`validator.ts` acceptait les deux, mais **aucun validator ni inserter
n'implémentait `carreaux`** : le type était exposé sans rien derrière. Signalé
au `docs/AUDIT_IMPORTS.md` du 02/07, **retiré le 08/09** avec les interfaces
mortes qui en dépendaient (`CarreauxSchemaInference`, `ColumnDetection`).

---

## 3. Candidats au retrait

Classés par confiance. Le groupe A est traité ; **B et C ne le sont pas** et
chaque ligne y demande un accord explicite.

### A — ✅ SUPPRIMÉ le 2026-09-08 (13 routes + le leurre `carreaux`)

Orphelins techniques confirmés un par un avant retrait, puis vérifiés au
navigateur : couche IRIS servie par PMTiles (`206 /iris_france.pmtiles`),
choroplèthe d'abstention en 200 sur `insee-variables/[code]/geojson`, page radio
fonctionnelle — aucun échec HTTP, aucune erreur console.

**Six RPC deviennent orphelines EN BASE et n'ont PAS été supprimées** (cela
demande une migration et une décision) : `get_iris_tile`, `get_abstention_stats`,
`get_cps_in_bbox`, `get_codes_postaux_bbox`, `get_digital_cp_iris_detail`,
`get_radios_for_emetteur`. `match_campaign_postal_to_iris` reste utilisée par
l'import de campagnes.

**Point ouvert** : `middleware.ts` (fichier protégé) référence encore
`/api/iris-tiles` et `/api/iris-tiles-proxy` aux lignes 28, 30, 140 et 142.
Sans effet — le matcher ne fait que déclarer des routes publiques qui n'existent
plus — mais à nettoyer avec l'entrée `/campaigns` déjà en attente d'arbitrage.

Liste de ce qui a été retiré :

| Cible | Poids | Pourquoi |
|---|---|---|
| `/api/iris-tiles/[z]/[x]/[y]` | 47 l. | Les IRIS passent par **PMTiles** (`IRIS_PMTILES_URL = '/iris_france.pmtiles'`, `useMapInit.ts:716`). La route MVT n'est plus appelée. |
| `/api/iris-tiles-proxy` | — | Même cause : le proxy GitHub Releases n'est référencé que par un **commentaire** de `lib/version.ts:18`. |
| `/api/insee-variables/list` · `/api/insee-variables/[code]/values` | ~130 l. | Seules `[code]/geojson` et `cp-detail` sont appelées (`CivicIndicatorsLayer`). |
| `/api/digital/codes-postaux` · `/[campaignId]/cp-detail` · `/[campaignId]/report` | — | Aucun appelant. Les deux premières sont encore listées dans `ARCHITECTURE.md`. |
| `/api/radio/stations/[id]` (PUT) · `/api/radio/emetteurs/[staAnfr]` (GET) | — | Seules les routes de **liste** sont appelées. Les détails ne le sont jamais. |
| `/api/custom-geo/[id]/codes` · `/[id]/preview` | — | Aucun appelant. |
| `/api/admin/campaigns/[id]/match-iris` | — | Aucun appelant ; le matching se fait pendant l'import. Documentée dans `ARCHITECTURE.md`. |
| `/api/agent/settings` | — | Reste de la couche GeoAgent. |
| Type `carreaux` de `lib/import` | ~10 l. | Leurre (cf. §2). |

### B — Modules entiers, décision produit requise

| Cible | Poids | Enjeu |
|---|---|---|
| **`/api/demo/*` (7 routes) + `lib/demo/` (409 l.)** | ~575 l. | `seed`, `reset`, `teardown`, `simulate-period`, `apply-rebid`, `report`, `report/narrative`. **Aucune UI ne les appelle plus** — probablement orphelins depuis le retrait de Pilotage ML. Mais c'est la plomberie du sous-projet « démo bout-en-bout » (simulateur d'ad server). **Abandonné ou en pause ?** |
| **`lib/agent/` + `/api/agent/*` + bouton flottant** | 934 l. + 232 l. | Déjà l'item 4 de la dette. La couche survit au retrait du pilotage mais lui était étroitement liée ; `/api/bidding/train` n'est conservé que pour elle. |
| `/api/admin/dsp/dv360/targeting/push` | — | Sans appelant. DV360 est en pause (droits Google), le push n'a jamais été testé. Garder tant que DV360 n'est pas tranché. |

### C — Outils de dev, à trancher

| Cible | Poids | Avis |
|---|---|---|
| `/design-system` | 451 l. | Vitrine shadcn. Utile en référence visuelle, zéro coût runtime (page statique 5,46 kB). |
| `/dev/test-custom-geo-capture` | 147 l. | Banc de test de la capture générique. Sa valeur est de prouver que le système est agnostique. |
| `/init` | 56 l. | Init du premier admin, protégée par `ADMIN_INIT_KEY`. Usage unique, déjà consommé — mais c'est un filet de sécurité en cas de perte d'accès. |

### D — À conserver malgré les apparences

`/demo/pilote` et `/sign-up` ne font que 8 et 6 lignes : ce sont des **redirects**
utiles (raccourci de démo, garde-fou d'inscription). `/admin/api/meta` et
`/admin/api/ttd` sont des placeholders produit. `AppSidebar` n'est pas une
navigation concurrente du rail : elle se masque sur `/map`.

---

## 4. Méthode, et ses pièges

La détection d'orphelins par recherche de l'URL littérale **produit 66 faux
positifs sur 184 routes** : toute route dynamique est appelée par template string
(`/api/digital/${id}/suivi`), et certaines sont assemblées par morceaux —
`SuiviMapLayer.tsx:161` construit `/api/digital/${campaignId}/${cfg.source}/map`,
ce qui rend `suivi/map` et `reconcile/map` invisibles à toute recherche naïve.

La liste du §3 a été obtenue en remplaçant chaque segment `[param]` par un motif
« bout d'URL quelconque », puis en vérifiant **à la main** chaque survivant.
C'est le même piège que celui consigné dans `docs/AUDIT_BASE.md` pour les RPC.

---

## 4bis. Trous de données constatés en base (2026-09-08)

Vérifiés par requête, pas déduits du code.

| Constat | Mesure | Nature |
|---|---|---|
| `nb_emplois` et `nb_emplois_commune` vides | **0 / 16 404 IRIS** | **Donnée jamais importée**, pas un bug. Le mapping (`^P\d{2}_EMPLT$`) et le RPC sont corrects ; le registre ne connaît que `BASE_TD_FILO_IRIS_2021_DEC` et `_DISP` (revenus). Les emplois au lieu de travail sont dans une base INSEE distincte. |
| `ref_codes_postaux` sans alimentation | 6 187 lignes | Consommée par les RPC d'analyse digitale ; sa route d'import a été supprimée. Se périmera en silence. |
| `carreaux_1km` vide | 0 ligne | Post-traitements carreaux non orchestrés (constat C1 de juillet, toujours vrai). |

Le reste est sain : `population`, `taux_chomage`, `taux_emploi`, `nb_csp_*`,
`part_sans_diplome` sont remplis à 16 083-16 240 / 16 404 ; les indicateurs
Filosofi (`rev_median`, `taux_pauvrete`, `indice_gini`, `rev_d1/d9`) à 14 480.

**Corrigé dans la foulée** : `lib/chat/tools/analyseComplete.ts` envoyait
`nb_emplois_commune` au LLM pour chaque IRIS — toujours `null`. Retiré du SELECT
et du type, avec la marche à suivre pour le remettre le jour où la base EMPLT
sera importée.

---

## 5. Documents liés

| Document | Objet | Fraîcheur |
|---|---|---|
| `docs/AUDIT_IMPORTS.md` | Audit détaillé des 9 pipelines d'import, constats C1→C6 | **02/07 — partiellement périmé** (C4/C6 résolus, `integration-panneaux` et le crawler 3-temps supprimés depuis) |
| `docs/AUDIT_BASE.md` | Ce que le code appelle vs ce que la base expose (92 RPC) | 08/09 |
| `docs/known_tech_debt.md` | Dette technique, items ouverts et fermés | 08/09 |
| `ARCHITECTURE.md` | Arborescence, routes, tables, RPC | 08/09 — cite encore des routes du §3.A |
