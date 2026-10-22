# La carte en parcours — lot 4 « ④ Couverture générique » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** à l'étape ④ de la carte Angular, CHIFFRER n'importe quelle zone enregistrée (population et cible) sur sa forme TELLE QUELLE, ou découpée par code postal ou par IRIS, sans jamais la convertir ; puis brancher sur cette « zone analysée » les analyses qui savent l'honorer (score composite, couverture par rayon autour d'un type de POI généralisée du module risque, croisements radio / trafic).

**Architecture:** une table ÉTROITE pré-calculée, `carreau_couverture` (un carreau Filosofi = son centroïde 3857, son code postal canonique, son IRIS, sa commune, son département, ses 24 effectifs `real[]`), construite UNE fois par bandes comme `cp_population_totale` ; un dénominateur IRIS (`unite_population_totale`, maille `iris`) construit depuis elle ; une RPC `jsonb` `couverture_geometrie` (lecture seule) et son enveloppe à cache `couverture_zone` ; une route `GET /api/zones/[id]/couverture` ; côté Angular un `ZoneAnalyseeService` (fourni par la page, reflété dans `?zoneAnalyse=`), un sélecteur de zone et l'accordéon « Couverture » en tête de ④, peint sur LA carte. Le lot 4b ajoute `couverture_rayon_poi` (courbe et anneaux par valeur d'un champ, parité prouvée avec le module risque), le score sur la zone et les croisements.

**Tech Stack:** Angular 21.2 standalone zoneless signals, Tailwind 4, Vitest (`cd angular && npx ng test --watch=false`) ; Next.js 15 (routes API), supabase-js, Zod, Vitest racine (`npm run test:unit`, `npm run test:integration`) ; PostgreSQL 17.6 + PostGIS local (`docker exec supabase_db_genesis_app psql -U postgres`).

**Spec:** `docs/superpowers/specs/2026-10-13-carte-en-parcours-design.md` — **§ 16 fait foi** (16.1 ④, 16.2 règles 2 et 5, 16.4 « `cp_couverture_geometrie` devient une couverture générique »), § 17 bis (écarts du lot 3), § 18 (onglets et dossiers : décidé le 19/10, ce lot passe AVANT eux — on ne les construit pas, on ne fait rien qui les empêche : tout l'état neuf vit dans l'URL du § 5, que la version sérialisera). Mémoires : `feedback_polygones_pas_que_cp`, `reference_postgrest_db_max_rows`, `reference_cte_materialized_postgres`.

**Sommaire d'origine :** `docs/superpowers/plans/2026-10-14-carte-en-parcours-lot-3.md`, « ### Lot 4 » (8 points). Ce plan en corrige trois prémisses (§ « Écarts au sommaire »).

---

## Découpage : 4a puis 4b

| Sous-lot | Tâches | Valeur livrée | Fusionnable seul |
|---|---|---|---|
| **4a — chiffrer n'importe quelle zone** | T1 à T9 | ④ dit, pour toute zone enregistrée, combien de personnes de la cible elle contient, et — par CP ou par IRIS — quelle part de chaque territoire elle couvre ; la carte le peint | oui |
| **4b — les analyses de ④ sur la zone choisie** | T10 à T14 | score composite sur la zone, couverture par rayon autour de N'IMPORTE quel type de POI (anneaux par champ, parité risque prouvée), radio et trafic dans la zone | oui, après 4a |

4a passe d'abord parce que c'est l'objet que consomme le lot 5 (`zone_sets` généralisé, « remplissage par `couverture_geometrie` ») : sans lui, ⑤ ne peut pas partir. 4b n'est consommé par aucun lot suivant.

---

## Pré-vol : ce qui existe vraiment (reconnaissance du 22/10, worktree `carte-analyse` = `1c19e0b8`)

Le lot 3 est fusionné dans `feat/angular-lot0` (sql/252-256 présents ; sql/257-259 jamais pris ; dernier fichier **sql/264** — le premier numéro libre est donc **265**, à revérifier à chaque tâche par `ls sql | sort -V | tail -3`).

### Base (locale, mesurée)

| Objet | Ce qu'il est | Source |
|---|---|---|
| `carreaux_filosofi` | 2 324 577 carreaux 200 m (millésime 2021, résolution unique `200m`), **3 195 Mo** ; les 24 effectifs sont dans `metadata` jsonb (≈ 800 octets/ligne) — les colonnes `ind`, `ind_18_24`… sont NULL partout (sql/221:110) ; `geom_centroid` NULL partout (§ 16.6) ; GIST `idx_carreaux_filosofi_geom_3857` | sql/003, scripts/local/07-carreaux-insee.sh:214 |
| `cibles_exposition` | le catalogue des 24 cibles (`code`, libellé, famille, `rang_pop` 1-24) — c'est LA liste des cibles | sql/185:88, sql/229:50 |
| `cp_des_points(ids, pts)` / `cp_du_point(p)` | LA règle carreau → CP : contour qui contient le point, départagé par la distance au centroïde PUIS par le code ; rend le code CANONIQUE (`cp_groupe`, 181 CP à géométrie identique) — `RETURNS TABLE` mais appelée en SQL seulement | sql/228:159, :191 |
| `cp_population_totale` | dénominateur par CP, même règle, 24 cibles ; **6 009 lignes, 63 711 780 hab.** | sql/207, reconstruite sql/228:282 |
| `unite_population_totale` | dénominateurs commune (34 918) / département (98) / région (15) par `lcog_geo` (premier code) ; **pas d'IRIS** | sql/221:53 |
| `carreau_risque_distance` | 880 976 carreaux à portée des sites Seveso : `code_postal`, `pops real[24]`, `centroide_3857` — le patron de la table étroite (sql/229 : 0,9 s au lieu de 11,2 s en ne lisant plus le jsonb) | sql/203, 206, 229 |
| `couverture_rayon_risque` + `lire_couverture_rayon` | courbe population / rayon (pas de 100 m, 10 km) PRÉ-CALCULÉE par département × gravité × nature, sites Seveso hors « fin d'exploitation », distance géodésique centroïde → site, département par `lcog_geo` | sql/198, 200, 201 ; `scripts/construire_couverture_rayon.mjs` |
| `remplir_zone_set_cp` / `appliquer_seuil_zone_set` | le moteur des jeux de zones (CP retenus, taux d'utile) — **NON touché par ce lot** (lot 5) | sql/229:211, sql/225:105 |
| `couverture_carreau_risque` | un DIAGNOSTIC `{construit, territoire_couvert, n_sites, n_seveso}`, aucun chiffre de population | sql/217:41 |
| `resoudre_perimetre` | périmètre de ① → géométrie (`ref_regions`, `ref_departements`, `ref_codes_postaux`, `ref_communes`, `custom_geo_zones`) | sql/253:67 |
| `custom_geo_zones` | `geometry MultiPolygon 4326`, `recette`, `updated_at` **mis à jour par le déclencheur `custom_geo_zones_before_write` à CHAQUE écriture** (recalcul compris) — clé de cache fiable ; pas de `geom_3857` | dump, sql/253 |
| `compute_zone_audience_stats` | `audience_stats` d'une zone par INTERSECTION (pas centroïde), ≤ 5 000 km² ; lu par le plan média des zones custom (Angular `plan-media.service.ts`) | sql/252:22 |
| `emetteurs_radio` (12 704, GIST `geom`, `rayon_couverture_m`), `emetteur_radio_stations` (569 698), `radios` (1 175) ; `comptages_routiers` (**1 100** comptages réels, GIST `geom`) | les données des croisements de 4b | — |
| Météo | **aucune table** : Open-Meteo est lu en direct, rien n'est stocké (Q-D) | — |

### Routes et quotas

- `/api/zones` (POST), `/api/zones/apercu`, `/api/zones/[id]/recalculer` : quota unique `geo:rl:zones` 12/min (`lib/zones/session-zones.ts:30`), garde `requireAuth(` dans la route (L3-7), espace = `profile.organization_id` (`espaceDeZone`, session-zones.ts:45).
- `/api/analyses/score` (POST) accepte DÉJÀ `perimetre: { type: 'zone', code }` (`app/api/analyses/score/route.ts:146`, contrôle `checkZoneAccess` :194) — seul outil de ④ qui sache lire une zone.
- `/api/isochrone-battle` : **fichier protégé**. `/api/isochrone-battle-v2` filtre ses POI par NOM de région (`route.ts:131-182`). `/api/poi-clusters/run` : `geo_filter {metropolitaine, regions, depts}`.
- `/api/risques/exposition/cibles` : le catalogue des cibles, `max-age=86400`, lu par `ProfilRisqueApi.cibles()` (`features/risques/data/profil-risque.api.ts:74`).
- Préfixe `geo:rl:couverture` : libre.

### Angular (`angular/src/app/features/carte/`)

- `panneaux/analyse/panneau-analyse.component.ts` (244 l.) : orchestrateur, aucune analyse propre ; accordéons « Analyse spatiale » (bataille V2, isochrones), « Score composite », « Corrélation », « Clustering » (super admin) ; garde `verifierPerimetreOutil` (:181) — verrou `tests/unit/angular/panneau-analyse-garde.test.ts` qui lit ce source. **Voronoï absent par décision du propriétaire** (:45-47).
- **Aucun outil de ④ ne prend un id de zone** ; `messageGardePerimetre(filtre, zoneSelectionnee?)` (`logique/garde-perimetre.ts:55,63`) prévoit le paramètre, personne ne le passe. Aucun sélecteur de zone réutilisable : la liste inline du filtre ① (`panneau-filtre.component.ts:112-126`, 374 l.) pose un `FiltreActif {type:'zone'}`.
- `carte.page.ts` **371/400 lignes** (plafond `tests/unit/angular/taille-fichiers.test.ts:18`) ; pastille « renseignée » de ④ = `analyseAffichee: score.affiche() || zonesRisque.affichees()` (:199-202).
- `etat/parcours.service.ts` : patron de l'état d'URL (lu à la construction, `replaceUrl` + `merge`, relu à chaque navigation qui ne vient pas de lui) ; la page est RECRÉÉE à un changement d'espace.
- `couches/score.service.ts` + `couche-score.ts` : choroplèthe CP sur les contours de `ContoursZonesService` (`/api/meteo-geo/zones?scale=cp`, ≈ 3,8 Mo, lu une fois) — le patron du rendu par territoire.
- `couches/couche-iris.ts` : source vectorielle `iris-source` (tuiles `get_iris_tile`, IRIS au-delà de `IRIS_ZOOM_PLANCHER`).
- Module risque : `features/risques/etapes/rayon/courbe-rayon.component.ts` (249 l.) — entrées propres au risque (`gravites`, `natures`, `perim`, libellé « autour des sites à risque » :182, export :232) ; `carte/` importe déjà de `risques/` (`couches/couche-risques.ts:2`).
- Inventaire « aucune fonction perdue » : `carte.page.spec.ts:1502-1568`, une seule ligne pour ④ (:1514).

### Écarts au sommaire (corrigés par ce plan)

| # | Le sommaire dit | La réalité | Ce que fait ce plan |
|---|---|---|---|
| E1 | « figer `couverture_carreau_risque`, Seveso France : 1 102 CP retenus, 73,1 % d'utile » | Cette fonction ne rend AUCUN chiffre de population (diagnostic). Les CP retenus / taux d'utile sortent de `remplir_zone_set_cp` (lot 5). « 1 102 / 73,1 % » n'est dans AUCUN test ; `ARCHITECTURE.md:2165-2169` dit 1 112 / 72,3 % puis 1 113 / 75,9 % (seuil 20) et 939 / 88,4 % (seuil 35). | Le lot 4 ne réécrit RIEN du module risque : il caractérise ce que son moteur générique doit REPRODUIRE (la courbe par rayon, T1). Le figeage des jeux de zones reste le point 2 du lot 5, avec les quatre chiffres contradictoires à trancher par mesure. |
| E2 | « caractériser AVANT » | **Le test de caractérisation existant échoue déjà** : `zone-risque-caracterisation.test.ts:118` attend 41 025 366 ; la base rend **42 409 940**. `couverture_rayon_risque` est PÉRIMÉE (construite sur le carroyage d'avant le 22/09, restaurée du dump ; `11-reconstruire.sh:236` la saute si elle n'est pas vide), alors que `carreau_risque_distance`, reconstruite, donne **41 025 520** à ≤ 10 km (880 976 carreaux). | T1 la reconstruit (`--tout`), recoupe, puis fige. On ne re-fige pas un chiffre périmé. |
| E3 | « Score, clustering, Voronoï, corrélation, bataille : entrée zone choisie » | Voronoï : non porté (décision du propriétaire). Corrélation : bornée par une campagne, part en ⑧ (Q1 du § 13, tranché le 13/10). Bataille V1 : route protégée. | A-9 : score + couverture + couverture par rayon + croisements prennent la zone ; bataille V1/V2 et clustering restent sur ① et le disent. |
| E4 | « vignette carte » | V1 : une seule carte, jamais démontée. | A-7 : le résultat se peint sur LA carte. |
| E5 | « `carte/risques` redirige vers ③/④ quand la parité est prouvée » | La parité de la COURBE ne couvre pas les étapes Zones et Campagne du module risque (lot 5-7). | A-10 : parité prouvée par test en 4b ; pas de redirection au lot 4. |

### Constat neuf : les périmètres ont des TROUS (mesuré le 22/10)

`ref_departements` et `ref_regions` sont des unions de communes simplifiées : **45 834 trous intérieurs** sur les départements (47 459 sur les régions), **1 976 km²** au total. Les Bouches-du-Rhône : 678 trous, 21,7 km² (le plus grand 0,78 km²), **356 carreaux, 78 834 habitants** dont le centroïde tombe dans un trou — 4,3 % du département ; 30 de ces carreaux (7 324 hab.) sont au centre d'Aix, d'où « 13100 couvert à 92,5 % par les Bouches-du-Rhône ». ARA : 367,8 km², 2 341 carreaux, **195 756 habitants**. 453 des 816 CP d'ARA ont moins d'habitants dans le périmètre-région que dans leur dénominateur. Les vrais enclaves existent et doivent rester : 26 (enclave des Papes, 129,8 km²), 64 (enclaves des Hautes-Pyrénées, 41,5), 62 (communes du Nord, 23,5), 66 (Llívia, 11,4) ; deux enclaves probables entre 0,3 et 5 km².

Ce défaut touche DÉJÀ le lot 3 : `zone_rayon_poi` découpe par le périmètre (sql/254:136), `zone_seuil_carreaux` retient par centroïde dans le périmètre (sql/255) — une zone « lycées à 5 km, Bouches-du-Rhône » a des trous au centre d'Aix. La couverture d'une telle zone serait fausse de 4 %. T2 le corrige (A-5).

---

## Mesures (base LOCALE, `EXPLAIN (ANALYZE, BUFFERS)`, 22/10)

Prototypes appliqués dans des transactions annulées ou des tables TEMPORAIRES ; rien n'est resté en base. « Accès » = `shared hit + read` (+ `local` pour une table temporaire) : sur un parcours d'index GIST, c'est ≈ une page lue PAR LIGNE, pas par page distincte.

**A. Calcul direct sur `carreaux_filosofi`** (prototype STABLE, CTE `as materialized`, `ST_Subdivide(…, 256)`, centroïde `ST_Centroid(geom_3857)` ; CP par `cp_des_points` ; IRIS par `ST_Contains(iris.geom, centroïde 4326)`, dénominateur IRIS recalculé sur les carreaux des IRIS touchés) :

| Cas | Carreaux | Population (`ind`) | Forme | CP | IRIS |
|---|---|---|---|---|---|
| Rayon 5 km, Lyon (4,8357 ; 45,7640) | 1 661 | 649 832 | 65 ms · 2 736 | 50 ms · 15 675 (21 CP) | 167 ms · 42 781 (266 IRIS) |
| Bouches-du-Rhône (5 088 km²) | 32 462 | 1 827 580 | 3,85 s froid (11 135 lus) · 0,23 s chaud · 46 948 | 1,99 s · 403 549 (126 CP) | 3,26 s · 540 352 (836 IRIS) |
| Auvergne-Rhône-Alpes (70 543 km²) | 309 456 | 7 495 303 | 19,1 s froid (86 215 lus) · 1,57 s · 351 703 | **14,7 s · 2 806 927** (816 CP) | **26,9 s · 4 602 666** (5 486 IRIS) |

Le découpage coûte 10 à 15 fois la forme : chaque centroïde détoaste un contour de CP ou d'IRIS. Sur une région, c'est inacceptable (budget du lot 3 : ≈ 90 000 accès par appel).

**B. Table étroite pré-calculée** (prototype : table temporaire de 433 174 carreaux ARA + PACA, `pops real[24]`, `code_postal` par `cp_des_points`, `code_iris`, GIST sur le centroïde) :

| Cas | Forme | CP | IRIS (dénominateur lu dans la même table) |
|---|---|---|---|
| Lyon 5 km | — | 2,7 ms | — |
| Bouches-du-Rhône | 97 ms · 38 792 | 115 ms · ≈ 39 000 | — |
| ARA | 0,83 s · 316 426 | — | 1,29 s · ≈ 347 000 |

Cohérence : sur ARA, 0 CP n'excède son dénominateur `cp_population_totale` (même règle) ; 363 sur 816 sont égaux, les autres sont amputés par les TROUS du périmètre-région et par la frontière. Construction de la table pour 309 456 carreaux : 4,2 s de lecture (chaud) + 8,5 s de CP + 17,8 s d'IRIS ≈ 30 s → France ≈ **4 min à chaud, 10-15 min à froid** (lecture de 3,2 Go), à faire par bandes.

**C. Courbe de couverture par rayon** (table étroite ; distance min. carreau → POI, paires bornées par `ST_DWithin`) :

| Cas | Durée · accès |
|---|---|
| Bouches-du-Rhône, 160 lycées, 5 km | 0,25 s · 218 000 |
| Bouches-du-Rhône, 160 lycées, 10 km | 0,78 s · 556 000 |
| Bouches-du-Rhône, 1 485 sites ICPE, 5 km | 1,34 s · 1 390 000 |
| ARA, 616 lycées, 10 km | **6,7 s · 2 200 000 + 86 000 pages temporaires** (223 604 carreaux) |

**D. Caractérisation actuelle** : `lire_couverture_rayon('ind')`, courbe `*`, r = 10 km → **42 409 940** (table périmée) ; même département 13 : total 1 596 235, r = 5 km 748 717 (même table, même péremption). `carreau_risque_distance`, ≤ 10 km : **880 976 carreaux, 41 025 520 hab.**

### Bornes déduites (écrites dans le code, verrouillées par test)

| Calcul | Borne | Pourquoi |
|---|---|---|
| `couverture_geometrie` | zone ≤ **100 000 km²** (refuse la France seule : la plus grande région fait 84 617 km²) ; ≤ **400 000 carreaux lus** (`limit + 1`, refus `trop_de_carreaux`) | ARA = 309 456 carreaux, 0,83 s / 316 000 accès (forme), 1,29 s / 347 000 (IRIS) sur la table étroite |
| Quota `geo:rl:couverture` | **12 / min / compte**, cache par `(zone, updated_at, cible, découpage)` | au pire ≈ 4,2 M accès / min / compte SUR UNE TABLE DE ≈ 600 Mo tenue en cache ; un second affichage ne coûte rien |
| `couverture_rayon_poi` | périmètre ≤ **12 000 km²** (département, commune, CP, zone — région refusée), rayon max **≤ 10 km**, **≤ 5 000 POI**, champ ≤ **8 valeurs** | BdR ICPE 5 km 1,4 M accès ; ARA lycées 10 km 6,7 s → refusé, comme le seuil carreaux (Q-G) |
| `croisements_zone` | ≤ **200** émetteurs, ≤ **200** comptages rendus (`limit + 1`, `tronque`) | une zone-région porte plusieurs centaines d'émetteurs |

---

## Global Constraints

- Les huit étapes, leurs valeurs d'URL (`perimetre` · `donnees` · `zones` · `analyse` · `jeu` · `plan` · `activation` · `live`) et « Autres » hors fil sont inchangés. Ce lot ne touche qu'à ④ `analyse` (et au périmètre en base, T2). **Rien de l'existant n'est retiré** de ④ ni du module risque (spec § 16.1) ; React gelé (P5) : aucun fichier de `app/map/**`, `components/**`, `lib/navigation/**`.
- **La forme exacte est la vérité** (§ 16.2-2) : ④ ne CONVERTIT jamais une zone en CP ni en IRIS. Le découpage « par CP / par IRIS » est une LECTURE (« quelle part de chaque territoire la zone couvre ») ; il n'écrit rien, ne crée aucune zone, ne remplit aucun jeu.
- **Une seule règle d'attribution** carreau → territoire, celle des dénominateurs existants : centroïde `ST_Centroid(geom_3857)` ; CP par `cp_des_points` (code canonique) ; commune/département par le premier code de `lcog_geo` (sql/221) ; IRIS par `ST_Contains(iris.geom, centroïde 4326)`. Un numérateur et son dénominateur rattachent le carreau au MÊME territoire (leçon sql/207/221). Jamais `iris.population` (recensement) ni `carreaux_cp_population` (+10,5 %) comme dénominateur.
- **Un carreau compte entier** quand son centroïde est dans la zone (L3-2) ; un carreau sans CP ou sans IRIS reste compté dans la forme et apparaît en « hors code postal » / « hors IRIS ». Le total d'un découpage égale TOUJOURS la population de la forme (test).
- **① borne tout calcul lourd** (§ 16.2-5) : bornes du tableau ci-dessus ; un refus est une RÉPONSE `{ refus }` → HTTP 422 en français, jamais une exception muette ni un résultat tronqué.
- PostgREST coupe à 1 000 lignes : toute RPC neuve rend `jsonb` ; une liste de territoires est rendue EN ENTIER dans le jsonb (5 486 IRIS sur ARA, ≈ 400 Ko) ou refusée, jamais coupée.
- I/O (CLAUDE.md § Disk I/O) : `EXPLAIN (ANALYZE, BUFFERS)` en LOCAL sur chaque RPC neuve, chiffres dans le rapport (s'arrêter si un chiffre dépasse de plus de 50 % la mesure de ce plan) ; quotas par `lib/api/rate-limit.ts` ; ≤ 3 appels Supabase simultanés ; **ouvrir ④ ne lit rien** hors les catalogues déjà chargés (catégories POI, indicateurs) : la liste des zones et celle des cibles se lisent à la PREMIÈRE ouverture du sélecteur, une fois par page.
- Les constructions lourdes (T3, T4, T1) se font par SCRIPT, par bandes, journalisées et reprenables, avec progression visible (`[bande 7/24] 98 213 carreaux — 31 s`) — règle « Imports & batch DB » de CLAUDE.md — et jamais depuis l'interface. **Ne jamais lancer `populate_geom_centroid_async`.**
- **Aucun `DROP`** de fonction ni de table (base locale partagée) ; `create or replace`, `add column if not exists`, migrations rejouables (appliquées DEUX fois, empreinte identique).
- Routes API : `export const dynamic = 'force-dynamic'`, Zod, `lireCorps()` pour un corps (les routes GET lisent `searchParams` par un schéma Zod), garde `requireAuth(request)` DANS le source (L3-7), espace = `profile.organization_id` (`espaceDeZone`), `createAdminClient()` depuis `@/lib/auth`, messages en français, détail Postgres seulement dans `console.error`. `middleware.ts` et `app/api/isochrone-battle/route.ts` ne sont pas touchés.
- Types : `types/database.types.ts` régénéré dans le commit de chaque migration (`npx supabase gen types typescript --db-url "postgresql://postgres:postgres@127.0.0.1:54322/postgres" > types/database.types.ts`) ; le diff n'ajoute QUE les objets de la migration.
- Angular / AIDA (skill `porting-react-to-angular`, à charger avant T7, T8, T11, T13) : aucun `position: fixed`, aucun écouteur sur `window`/`document`, services d'état fournis par la page ou le panneau (jamais `providedIn: 'root'`), services d'API dans `FOURNISSEURS_DISTANTS` (`app.routes.ts:46-69`) et adresses par `HttpBaseService` (`this.baseUrl`) UNIQUEMENT, pas de `@angular/core/rxjs-interop`, couleurs par jetons — MapLibre reçoit des couleurs CALCULÉES (`CouleursService.palette`), jamais `var()` dans `paint`.
- Pièges Angular nommés (chaque brief les recopie) : (P-a) un `effect()` qui écrit un signal qu'il lit boucle — `untracked()` autour des écritures ; (P-b) zoneless : une réponse HTTP ne rafraîchit l'écran QUE si elle passe par un signal ; (P-c) toute souscription est désabonnée au `DestroyRef` et toute réponse porte un JETON de requête (la réponse d'une zone, d'une cible ou d'un espace quittés n'est jamais affichée) ; (P-d) `input()` / `input.required()` se lisent en fonction, jamais copiés dans un champ au constructeur ; (P-e) le panneau d'une étape reste MONTÉ (lot 1, A1) : un résultat survit à ④ → ① → ④, une couche se retire au `DestroyRef` du SERVICE qui l'a posée, pas du composant ; (P-f) une couche MapLibre posée avant le chargement du style est perdue — passer par le pont de carte existant (`PONT_CARTE`, `couches-carte.service.ts`).
- Aucun fichier `.ts` non-spec d'`angular/src` au-delà de 400 lignes ; `carte.page.ts` est à 371 : tout ajout à la page passe par un fichier voisin (fournisseurs, pastilles).
- DESIGN_SYSTEM : sentence case, Inter + JetBrains Mono (chiffres), bordures 0,5 px, accent teal, en-têtes `mg-entete-section`, CTA teal pour « Chiffrer la zone », palette SÉQUENTIELLE (`--seq-1…5`) pour une part de couverture (intensité sans signe), jamais de violet ni d'hexadécimal en dur.
- `ARCHITECTURE.md` (Grep par nom : `## Fonctions RPC PostGIS` l.1978, `## Tables Supabase` l.1791, `## Routes API` l.1401, `### Zones custom` l.1674) et `angular/src/app/features/carte/README.md` mis à jour DANS le commit de chaque tâche qui ajoute une route, une table, une RPC, un service.
- Tests : codes de retour lus SANS pipe (`npx tsc --noEmit` ; `npm run test:unit` ; `npm run test:integration` ; `cd angular && npx ng test --watch=false` ; `cd angular && npm run build -- --output-path=/tmp/ng-lot4` ; `npm run lint`). Après T1, PLUS aucun échec admis (l'échec « habitants » disparaît).
- Preuve navigateur : Angular **:4202**, Next **:3002** (jamais :3000 ni :4200, serveurs de Vincent), un serveur à la fois, tués en fin de tâche ; deux thèmes ; **chaque capture Angular a sa capture React équivalente** quand React a l'équivalent (module risque React pour la courbe ; aucun équivalent React pour la couverture d'une zone : le dire dans le rapport) ; captures dans `.superpowers/sdd/2026-10-22-carte-en-parcours-lot-4/` (non suivi).
- Git : commits atomiques `type: description` sur `feat/carte-analyse`, pas de push, pas de PR, rien sur `main`.

## Contrat AIDA (chaque tâche Angular le vérifie et le dit dans son rapport)

1. Racine d'ombre : aucun style global ajouté ; jetons lus sur `:host` (`angular/src/styles/jetons.css`).
2. Aucune adresse absolue : `HttpBaseService.baseUrl` ; aucune route Angular absolue (navigation relative).
3. Aucun `position: fixed`, aucun écouteur `window`/`document`, aucun `localStorage` neuf.
4. Services d'API dans `FOURNISSEURS_DISTANTS` ; services d'état fournis par la page ou le panneau.
5. Tout état partageable dans l'URL (§ 5) : `?zoneAnalyse=`, `?couverture=` — ce que la version du § 18 sérialisera.
6. Fonctionne dans les deux thèmes (`html.light` / sombre) sans hexadécimal.

## Review Focus

1. **Zone d'un autre espace, supprimée, ou d'un espace quitté pendant un calcul** (`?zoneAnalyse=` d'un lien partagé, super admin qui bascule, onglet laissé ouvert) : 404 « Cette zone n'existe pas dans cet espace » ; la réponse d'un espace quitté n'est jamais affichée ni peinte ; le paramètre est retiré de l'URL. → T5 (`zone_introuvable`), T6 (route), T7 (jeton, page recréée).
2. **Zone recalculée ou renommée après un chiffrage** : le cache ne sert JAMAIS un chiffre d'une ancienne forme (`updated_at`) ; un recalcul en ③ puis un retour en ④ re-chiffre. → T6 (cache), T8 (relance au retour).
3. **Totaux qui ne se recoupent pas** : somme des lignes CP + « hors code postal » = population de la forme, idem IRIS ; aucune part > 100 % ; un CP entièrement dans la zone vaut 100 % (fin du « 13100 à 92,5 % » quand la zone est le département). → T2, T3, T4, T5.
4. **Zone énorme ou France** : refus dit en une ligne, AUCUNE requête lourde partie (onglet Réseau), rien de tronqué ; un IRIS-région (5 486 lignes) s'affiche en entier, paginé côté écran. → T5, T6, T8.
5. **Parité avec le module risque** (4b) : la courbe générique sur les sites Seveso d'un département égale, palier par palier, `lire_couverture_rayon` du même département (table reconstruite en T1). → T1, T11.

## Arbitrages (tranchés ; coût si faux)

Ceux de la spec § 16.8 (A-1 à A-7, préfixés « spec ») et du lot 3 (L3-1 à L3-8) s'appliquent. Ajoutés par ce plan :

| # | Point | Tranché | Coût si faux |
|---|---|---|---|
| A-1 | Calcul direct sur `carreaux_filosofi` ou table étroite pré-calculée ? | **Table étroite `carreau_couverture`** (mesures A/B : ARA IRIS 26,9 s → 1,3 s, BdR CP 403 000 → 39 000 accès). C'est la « table pré-agrégée » que la spec recommandait pour ouvrir la région (Q-G). Pas de repli sur `carreaux_filosofi` si elle est absente : refus `couverture_non_construite` (« deux chemins pour la même donnée divergent », sql/229). | ≈ 600 Mo locaux et 10-15 min de construction par reconstruction de la base ; une étape de plus dans `11-reconstruire.sh` |
| A-2 | Ordre des 24 effectifs dans `pops` | Le `rang_pop` de `cibles_exposition`, LU en base (jamais supposé), comme `carreau_risque_distance` ; test qui compare `pops[rang]` à `metadata->>code` sur un échantillon. | — |
| A-3 | Dénominateur IRIS | **`unite_population_totale`, maille `iris`**, construite DEPUIS `carreau_couverture` (même règle) ; le dénominateur CP reste `cp_population_totale` (lot 5 l'emploie) et un test prouve qu'il égale la somme de la table. | — |
| A-4 | Bornes de `couverture_geometrie` | ≤ 100 000 km² (France refusée), ≤ 400 000 carreaux lus ; région ADMISE (mesure B). Quota 12/min, cache. | une constante |
| A-5 | Les trous des périmètres | **Colonne `geom_perimetre`** sur `ref_departements` et `ref_regions` : la géométrie dont on a BOUCHÉ tout trou intérieur, sauf ceux qu'une commune d'un AUTRE département (resp. d'une autre région) recouvre à plus de 50 % (vraies enclaves : 26, 64, 62, et les petites) ou qui ne contiennent aucune commune française et dépassent 5 km² (Llívia) ; `resoudre_perimetre` la lit. Calculée une fois par migration (122 lignes). `geom` reste intacte (tuiles, React). Effet assumé : un RECALCUL de zone du lot 3 donne une forme pleine (Aix n'a plus de trou). | revenir à `geom` dans une fonction |
| A-6 | Le découpage rend-il les géométries des territoires ? | **Non** : des codes et des chiffres. Les contours viennent de ce que la carte a déjà (CP : `ContoursZonesService` ; IRIS : tuiles `iris-source`). | un champ `geometry` par ligne (poids ×50) |
| A-7 | « Vignette carte » | **Sur LA carte** (V1) : couche `couverture-*` — contour de la zone + choroplèthe séquentielle de la part (CP toujours ; IRIS au-delà du zoom IRIS, sinon une ligne « Zoomez pour voir les IRIS »). Pas de mini-carte. | une mini-carte à ajouter |
| A-8 | Où vit la zone analysée ? | **`ZoneAnalyseeService`**, fourni par `CartePage`, reflété dans `?zoneAnalyse=<uuid>` ; la cible et le découpage dans `?couverture=<cible>.<forme|cp|iris>`. Indépendant du filtre ① (on peut analyser une zone hors du périmètre) et de `?customZone=` (le créneau de bataille, React). | renommer deux paramètres |
| A-9 | Quels outils prennent la zone ? | **Couverture, couverture par rayon, score composite, croisements.** Bataille V1 (route protégée), bataille V2 (filtre ses POI par nom de région) et clustering (`geo_filter` d'un job externe) restent sur ① ; quand une zone est analysée, leur accordéon le dit en une ligne (« Cet outil travaille sur le périmètre de l'étape ① »). Voronoï : non porté (décision du propriétaire, lot 4 Angular) ; corrélation : bornée par une campagne, part en ⑧ (Q1, 13/10). | une route par outil |
| A-10 | Redirection `carte/risques` → ③/④ | **Pas au lot 4.** La courbe générique prouve sa parité (T11), mais les étapes Zones et Campagne du risque n'ont pas encore d'équivalent : on redirigerait vers moins. Redirection au lot 5, quand ⑤ remplace l'étape Zones. | un lien |
| A-11 | Couverture par rayon : quels POI, quels carreaux ? | Les carreaux DU périmètre (périmètre administratif lu par CODE — `code_departement`, `code_commune`, `code_postal` de la table — zone lue par géométrie) ; les POI À MOINS DE `r_max` du périmètre, même hors de lui : on chiffre la population du périmètre, et un lycée de l'autre côté de la limite la couvre. Différent de V-1 (une ZONE ne déborde pas son périmètre) parce que la question est différente. Distance géodésique centroïde → POI, paliers de 100 m, sortie au FORMAT de `lire_couverture_rayon` — c'est ce qui donne la parité exacte avec le risque. | une clause `ST_Intersects` |
| A-12 | Anneaux « par valeur d'un champ » (Q3) | Champ dans une liste FERMÉE : `sous_categorie` (ICPE : `seveso_haut`, `seveso_bas`, … ; lycées : une seule valeur) ; ≤ 8 valeurs (palette `--nature-1…8`), au-delà refus `trop_de_valeurs`. Un profil d'anneaux par valeur (`{ valeur: [r1, r2, …] }`) classe chaque carreau dans la PREMIÈRE valeur (ordre du profil) dont un anneau le contient — la règle de `classe_carreau_risque`, généralisée. Les sites ICPE « en fin d'exploitation » sont exclus par défaut, comme `construire_couverture_rayon` (`p_inclure_inactifs`, comme `risques_industriels_carte`). | élargir la liste |
| A-13 | Croisements | Radio (émetteurs dont le cercle de couverture touche la zone, stations qu'ils portent) et trafic (comptages RÉELS dans la zone). **Météo hors lot 4** : rien n'est stocké (Q-D, lot 10). | une RPC de plus |
| A-14 | Le test « habitants » qui échoue | **Reconstruire `couverture_rayon_risque`** (T1) puis recouper avec `carreau_risque_distance` ; jamais re-figer 42 409 940. | ≈ 30-40 min de construction locale |
| A-15 | `audience_stats` (intersection, ≤ 5 000 km²) contre la couverture (centroïde) | Inchangé au lot 4 : le plan média des zones custom (Angular et React) le lit. La divergence est écrite dans `ARCHITECTURE.md` et le README ; l'unifier relève du lot 7 (plan). | deux chiffres pour une zone pendant trois lots |
| A-16 | Quota de la couverture | `geo:rl:couverture` 12/min/compte, consommé APRÈS lecture du cache : un résultat en cache ne coûte pas de jeton. | une ligne |

## Questions pour Vincent (le moins possible ; recommandation entre crochets)

| # | Question | Ce qui en dépend | Recommandation |
|---|---|---|---|
| Q-I | **Couverture par rayon sur une RÉGION** (ex. lycées d'ARA à 10 km : 6,7 s et 2,2 M accès mesurés) : refusée comme le seuil sur carreaux (Q-G), ou admise par un pré-calcul national par type de POI (le patron de `couverture_rayon_risque`, un script par type) ? | T11 | **Département au lot 4** ; la région par pré-calcul quand un client la demande. |
| Q-J | **Dénominateur « carroyage »** : la part d'un territoire se lit « part des habitants CARROYÉS » (63,7 M, ménages fiscaux Filosofi ; Guadeloupe, Guyane, Mayotte absentes) et non de la population légale (67,8 M). L'écran le dit sous le tableau. Suffisant pour les clients ? | T8 (une phrase) | **Oui** : c'est la seule règle cohérente numérateur/dénominateur (sql/221) ; la phrase suffit. |

(Q-A à Q-H de la spec restent ouvertes et ne touchent pas ce lot ; Q-G est ÉCLAIRÉE par la table de T3 : un seuil sur carreaux par région devient mesurable — à remesurer au lot 5.)

## File Structure

| Fichier | Responsabilité |
|---|---|
| `tests/integration/zone-risque-caracterisation.test.ts` (modifié), `tests/integration/couverture-caracterisation.test.ts` (créé) | T1 : la courbe nationale recoupée ; les courbes et totaux de référence du département 13. |
| `sql/265_perimetres_sans_interstices.sql` (créé) | T2 : `geom_perimetre` + `resoudre_perimetre` qui la lit. |
| `sql/266_carreau_couverture.sql` (créé), `scripts/construire_carreau_couverture.mjs` (créé), `scripts/local/11-reconstruire.sh`, `12-sante.sh`, `10-sauvegarder.sh` (modifiés) | T3 : la table étroite, sa construction par bandes. |
| `sql/267_denominateur_iris.sql` (créé) | T4 : `unite_population_totale` maille `iris`. |
| `sql/268_couverture_geometrie.sql` (créé) | T5 : la RPC de lecture. |
| `sql/269_couverture_zone_cache.sql` (créé), `lib/zones/couverture.ts` (créé), `app/api/zones/[id]/couverture/route.ts` (créé) | T6 : cache, schéma de la requête, route. |
| `angular/.../data/couverture.api.ts`, `etat/zone-analysee.service.ts`, `logique/analyses/couverture.ts`, `panneaux/analyse/choix-zone-analysee.component.ts` (créés) | T7 : API, état d'URL, logique pure, sélecteur. |
| `angular/.../panneaux/analyse/outil-couverture.component.ts`, `tableau-couverture-zone.component.ts`, `couches/couche-couverture.ts`, `couches/couverture.service.ts` (créés) ; `panneau-analyse.component.ts`, `carte.page.ts` + un fichier voisin de fournisseurs/pastilles (modifiés) | T8 : l'écran et la couche. |
| `sql/270_couverture_rayon_poi.sql`, `app/api/analyses/couverture-rayon/route.ts` (créés) | T11. |
| `angular/.../panneaux/analyse/outil-rayon.component.ts`, `features/risques/etapes/rayon/courbe-population.component.ts` (extrait de `courbe-rayon`) | T12. |
| `sql/271_croisements_zone.sql`, `app/api/zones/[id]/croisements/route.ts`, `angular/.../panneaux/analyse/croisements-zone.component.ts` | T13. |

Les numéros 265-271 sont ceux du 22/10 : prendre à chaque tâche le premier numéro libre et chercher les fichiers par SUFFIXE dans les tests.

---

## LOT 4a — Chiffrer n'importe quelle zone (9 tâches)

### Task 1: Caractérisation — reconstruire la courbe périmée, puis figer ce que le moteur générique devra reproduire

**Objectif :** un filet de tests VERT et VRAI avant tout code neuf. Aujourd'hui le test de caractérisation du risque échoue parce que la table qu'il lit est périmée (E2) ; on la reconstruit, on recoupe par une source indépendante, et on fige les références du département 13 que T11 comparera.

**Files:**
- Modify: `tests/integration/zone-risque-caracterisation.test.ts` (le chiffre « habitants » re-mesuré et recoupé ; son commentaire d'histoire complété)
- Create: `tests/integration/couverture-caracterisation.test.ts`
- Modify: `scripts/local/11-reconstruire.sh` (étape 6 : reconstruire aussi quand `couverture_rayon_bandes` est antérieure à `carreau_risque_distance` — le défaut qui a laissé passer la péremption)
- Doc: `ARCHITECTURE.md` (ligne `couverture_rayon_risque` : date de construction, total)

- [ ] **Step 1: Mesurer AVANT** (lecture seule) — noter dans le rapport : `select c->>'total' from jsonb_array_elements(lire_couverture_rayon('ind')->'courbes') c where c->>'cle'='*'` (42 409 940 le 22/10) ; même chose pour `p_perim_niveau => 'departement', p_perim_codes => '{13}'` (1 596 235 ; r = 5 000 → 748 717) ; `select count(*), sum(pops[1]) from carreau_risque_distance where least(coalesce(d_haut_m,1e9), coalesce(d_bas_m,1e9)) <= 10000` (880 976 ; 41 025 520).
- [ ] **Step 2: Reconstruire** — `node scripts/construire_couverture_rayon.mjs --tout` (base LOCALE par défaut : le script lit `.env.development.local` ; ne JAMAIS passer `--prod`). Progression par bande à l'écran ; noter durée totale et bande la plus lente. Si une bande dépasse 120 s ou si la RAM libre de l'hôte tombe sous 300 Mo (`12-sante.sh`), s'arrêter : le script est reprenable.
- [ ] **Step 3: Recouper** — la courbe `*` à r = 10 000 doit égaler la somme directe de `carreau_risque_distance` à ≤ 10 km à **± 300** près (palier fermé d'un côté, ouvert de l'autre — commentaire du test, l.103-116). Si l'écart dépasse 300, s'arrêter et le signaler (une règle diverge, ce n'est plus une péremption).
- [ ] **Step 4: Tests (rouges sur une table vidée, verts après)** — dans `zone-risque-caracterisation.test.ts`, remplacer 41 025 366 par la valeur recoupée, avec la date et la source indépendante. Créer `couverture-caracterisation.test.ts` :

```ts
/**
 * Références du moteur de couverture par rayon (lot 4, T1) — ce que `couverture_rayon_poi` (T11) devra reproduire
 * EXACTEMENT sur les sites Seveso du département 13. Mesurées après reconstruction de `couverture_rayon_risque`
 * (2026-10-2x), recoupées par `carreau_risque_distance`.
 */
const REFERENCES_13 = { total: /* mesuré */ 0, r1000: 0, r5000: 0, r10000: 0, carreaux: 0 };
it('département 13, courbe * : paliers 1, 5 et 10 km', async () => { /* lire_couverture_rayon(ind, null, null, 'departement', ['13']) */ });
it('département 13, une courbe par gravité : seveso_haut et seveso_bas', async () => { /* p_gravites ['seveso_haut'] puis ['seveso_bas'] */ });
it('la somme des incréments égale le dernier cumul (télescopage, sql/201)', async () => { /* ∑ i = p(10 000) */ });
```

Les zéros sont REMPLIS par les mesures du Step 3, jamais laissés.
- [ ] **Step 5: `11-reconstruire.sh`** — l'étape 6 compare `max(construit_le)` de `couverture_rayon_bandes` (ou la date du journal) au `max` de `carreau_risque_distance` et relance `--tout` si la couverture est plus ancienne ; un commentaire raconte le 22/10.
- [ ] **Step 6: PASS** — `npx vitest run --project integration tests/integration/zone-risque-caracterisation.test.ts tests/integration/couverture-caracterisation.test.ts` ; puis `npm run test:integration` : **plus aucun échec admis** (consigner le compte).
- [ ] **Step 7: Doc + commit** — `test(risque): couverture par rayon reconstruite et recoupée, références du département 13 figées (lot 4, T1)`.

**Critère de fin :** les deux fichiers verts ; écart courbe / table des distances ≤ 300 ; durée de reconstruction consignée. Aucun code de production modifié.

---

### Task 2: Des périmètres sans interstices (`geom_perimetre`)

**Objectif :** qu'un département ou une région résolu par `resoudre_perimetre` ne perde plus 4 % de sa population dans les trous de l'union de ses communes (constat du pré-vol), sans boucher les vraies enclaves.

**Files:**
- Create: `sql/265_perimetres_sans_interstices.sql`
- Modify: `types/database.types.ts`
- Test: `tests/integration/perimetres-sans-interstices.test.ts` (créé) ; relancer `zone-rayon-poi`, `zone-seuil-carreaux`, `zone-seuil-territoire`, `zones-recette`
- Doc: `ARCHITECTURE.md` (`ref_departements`, `ref_regions`, `resoudre_perimetre`)

**Interfaces:**
- Produces: `ref_departements.geom_perimetre`, `ref_regions.geom_perimetre` (`geometry(MultiPolygon, 4326)`, valides) ; fonction `public.boucher_interstices(p_geom geometry, p_code text, p_niveau text) → geometry` (IMMUTABLE n'est pas possible : elle lit `ref_communes` ; STABLE) ; `resoudre_perimetre` lit `coalesce(geom_perimetre, geom)` pour `region` et `departement`, rien d'autre ne change (signature, refus, commune, CP, zone).

- [ ] **Step 1: Test (échec)** — `perimetres-sans-interstices.test.ts` :
  - le département 13 n'a plus AUCUN trou (`ST_NRings = ST_NumGeometries`) ; sa surface grandit de 21 à 22 km² (± 1) ;
  - le département 26 GARDE l'enclave des Papes (un trou de 129,8 km² ± 1) ; 62 garde les communes du Nord (23,5 km²) ; 64 garde 41,5 km² ; 66 garde Llívia (11,4 km²) ;
  - région 84 (ARA) : garde le trou de l'enclave des Papes (vaucluse), bouche le reste ;
  - `resoudre_perimetre('departement','13',…)` rend une géométrie sans trou ; `('commune','13001',…)` est INCHANGÉE (md5 de la géométrie avant/après) ;
  - population des carreaux dont le centroïde est dans le périmètre 13 : avant 1 827 580, après **≈ 1 906 400** (1 827 580 + 78 834, ± 50) — le chiffre se lit via `zone_seuil_carreaux('densite_ind','>=',0,'departement','13',null,20000)` → `population` (T5 du lot 3) ou par une requête directe dans le test.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Migration** — la fonction :

```sql
-- Un trou est BOUCHÉ sauf s'il est une vraie enclave : une commune d'une AUTRE unité en recouvre plus de la moitié,
-- ou il ne contient aucune commune française et dépasse 5 km² (Llívia). Mesuré le 22/10 : 45 834 trous, 1 976 km² ;
-- vraies enclaves ≥ 5 km² : 26 (129,8), 64 (41,5), 62 (23,5), 66 (11,4) ; 2 probables entre 0,3 et 5 km².
-- Pour un département, « autre unité » = left(code_commune, 2|3) ≠ code_dept ; pour une région, la commune
-- appartient à un département d'une autre région (ref_departements.code_region).
```

Chaque polygone est reconstruit `ST_MakePolygon(ST_ExteriorRing(p), array[trous gardés])` ; le résultat `ST_Multi(ST_CollectionExtract(ST_MakeValid(…), 3))`. Remplissage : `update ref_departements set geom_perimetre = boucher_interstices(geom, code_dept, 'departement') where geom_perimetre is null` (104 lignes ; une PAR UNE dans une boucle `for … loop` avec `raise notice` de progression — c'est un traitement batch, CLAUDE.md), puis les 18 régions. Rejouable : `where geom_perimetre is null` (une seconde application ne recalcule rien) ; pour forcer, une variable psql documentée. `resoudre_perimetre` est recréée À L'IDENTIQUE de sql/253 à deux lignes près (`coalesce(geom_perimetre, geom)`) — diff relu ligne à ligne dans le rapport.
- [ ] **Step 4: PASS + EXPLAIN** — `EXPLAIN (ANALYZE, BUFFERS) select * from resoudre_perimetre('region','84',null,100000,array['region'])` avant / après (la géométrie bouchée a ≈ 16 000 sommets de moins : l'appel doit être PLUS rapide). Mesurer la durée totale du remplissage (estimation : 1 à 5 min, 45 834 trous testés contre `ref_communes` par `&&`).
- [ ] **Step 5: Non-régression du lot 3** — `npx vitest run --project integration tests/integration/zone-rayon-poi.test.ts tests/integration/zone-seuil-carreaux.test.ts tests/integration/zone-seuil-territoire.test.ts tests/integration/zones-recette.test.ts` : verts. Un chiffre figé qui bouge (plus de carreaux, plus d'habitants) est ATTENDU : le mettre à jour avec « +N, trous bouchés (lot 4, T2) » en commentaire ; un refus qui change de nature est un défaut (s'arrêter).
- [ ] **Step 6: Doc + commit** — `fix(db): périmètres département et région sans interstices — 78 834 habitants retrouvés dans les Bouches-du-Rhône (sql/265)`.

**Critère de fin :** vraies enclaves intactes, trous de couture bouchés, lot 3 vert, durée et chiffres consignés.

---

### Task 3: `carreau_couverture` — la table étroite, construite par bandes

**Objectif :** une ligne par carreau Filosofi avec tout ce qu'il faut pour chiffrer sans relire 3,2 Go de jsonb : centroïde, CP canonique, IRIS, commune, département, 24 effectifs.

**Files:**
- Create: `sql/266_carreau_couverture.sql`, `scripts/construire_carreau_couverture.mjs`
- Modify: `scripts/local/11-reconstruire.sh` (étape « 4quinquies/7 carreau_couverture »), `scripts/local/12-sante.sh` (`vol_table carreau_couverture 2324577`), `scripts/local/10-sauvegarder.sh` (la table ET son journal exclus ENSEMBLE — leçon du 22/09, 11-reconstruire.sh:225-234), `types/database.types.ts`
- Test: `tests/integration/carreau-couverture.test.ts` (créé)
- Doc: `ARCHITECTURE.md` (`## Tables Supabase`, `## Fonctions RPC PostGIS`, « Environnement de développement local »)

**Interfaces:**
- Produces: table `public.carreau_couverture (carreau_id bigint primary key, centroide_3857 geometry(Point,3857) not null, code_postal text, code_iris text, code_commune text, code_departement text, pops real[] not null)` ; RLS activée, `revoke all … from public, anon, authenticated`, `select` à `service_role` ; index GIST `(centroide_3857)`, btree `(code_departement)`, `(code_commune)`, `(code_postal)`, `(code_iris)` ; journal `carreau_couverture_bandes (bande int primary key, lon_min, lon_max, n_carreaux, duree_ms, construit_le)`.
- `construire_carreau_couverture(p_bande int, p_n_bandes int default 24, p_lon_ouest numeric default -5.5, p_lon_est numeric default 9.8, p_bande_id int default null) → jsonb` (`security definer`, `statement_timeout` 30 min, `work_mem` 64 Mo, service_role) — patron EXACT de `remplir_cp_population_totale` (sql/228:282) : bandes de LONGITUDE, outre-mer par appels séparés (`ZONES_LOINTAINES` de `scripts/construire_carreau_risque.mjs`, clés ≥ 1000), `insert … on conflict (carreau_id) do update` (une bande rejouée REMPLACE, n'accumule pas : la clé est le carreau).
- `vider_carreau_couverture() → bigint`.

- [ ] **Step 1: Test (échec)** — `carreau-couverture.test.ts` :
  - **2 324 577** lignes (= `carreaux_filosofi`) ; aucune `pops` nulle ;
  - `pops[rang]` = `metadata->>code` pour les 24 cibles sur un échantillon de 200 carreaux (`order by id limit 200` et 200 d'outre-mer) — l'ordre est celui de `rang_pop` (A-2) ;
  - **par CP** : `sum(pops[1]) group by code_postal` égale `cp_population_totale.populations->>'ind'` pour CHACUN des 6 009 CP (0 écart > 0,5) — même règle, prouvée ; idem pour `men` ;
  - **par commune et par département** : égal à `unite_population_totale` (mailles `commune`, `departement`) ;
  - carreaux sans CP : ≤ 0,2 % (mesuré : 99,83 % rattachés, sql/207) ; sans IRIS : compté et rendu dans le rapport ;
  - aucun `code_postal` qui ne soit pas canonique (`exists` dans `cp_groupe where code_postal = code_canonique`).
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Migration** — la table, les index, le journal, les deux fonctions. Le corps lit `carreaux_filosofi` UNE fois par bande (CTE `as materialized` : `id`, `ST_Centroid(geom_3857)`, `metadata`), le CP par `cp_des_points(array_agg(id), array_agg(ST_Transform(ctr, 4326)))` (UNE fois par bande, pas par carreau), l'IRIS par `left join lateral (select code_iris from iris i where i.geom && p and ST_Contains(i.geom, p) order by code_iris limit 1)` (départage DÉTERMINISTE si deux IRIS se recouvrent : le plus petit code — vérifier en Step 4 combien de carreaux tombent dans deux IRIS), commune/département par `split_part(metadata->>'lcog_geo', ',', 1)` (règle sql/221 ; outre-mer : 3 caractères pour `97x`, comme `construire_couverture_rayon`), `pops` par `array_agg((metadata->>c.code)::real order by c.rang_pop)` sur `cibles_exposition`. Commentaire d'en-tête : les mesures B de ce plan, la raison (A-1), l'interdiction du repli.
- [ ] **Step 4: Le script** — `scripts/construire_carreau_couverture.mjs` copie la structure de `construire_couverture_rayon.mjs` (base LOCALE par défaut, `--prod` bruyant, `--tout` qui vide d'abord, reprise par le journal, une ligne de progression par bande : `[bande 7/24] lon 0,2 → 0,8 · 98 213 carreaux · 31 s · reste ≈ 6 min`), plus les zones lointaines. Lancer `--tout` ; consigner durée totale, bande la plus lente, taille (`pg_total_relation_size`, estimée ≈ 470 Mo + 110 Mo de GIST). Si une bande dépasse 120 s, passer à `--bandes 48`.
- [ ] **Step 5: PASS + EXPLAIN** — le test ; puis, en local, sur la table RÉELLE :

```bash
docker exec supabase_db_genesis_app psql -U postgres -c "EXPLAIN (ANALYZE, BUFFERS) with z as (select ST_Subdivide(ST_Transform(g,3857),256) sg from resoudre_perimetre('region','84',null,100000,array['region'])) select count(*), sum(pops[1]) from z join carreau_couverture c on c.centroide_3857 && z.sg and ST_Contains(z.sg, c.centroide_3857);"
```

Attendu ≤ 1,2 s chaud et ≤ 350 000 accès (mesure B : 0,83 s / 316 426, sur une table temporaire gonflée par deux UPDATE — la vraie doit faire mieux). Au-delà de 50 % d'écart : s'arrêter. Option si les lectures froides dominent : `cluster carreau_couverture using <gist>` UNE fois après construction (documenté, rejoué par le script).
- [ ] **Step 6: Scripts locaux** — 11-reconstruire (après `cp_population_totale`, dont elle dépend pour le test d'égalité), 12-sante, 10-sauvegarder ; relire leurs en-têtes et y écrire pourquoi.
- [ ] **Step 7: Doc + commit** — `feat(db): carreau_couverture, une ligne étroite par carreau pour chiffrer toute zone (sql/266)`.

**Critère de fin :** 2 324 577 lignes, égalités CP / commune / département prouvées, mesure ARA dans la borne, scripts locaux à jour.

---

### Task 4: Le dénominateur IRIS

**Objectif :** la « part d'un IRIS couverte par la zone » rapportée à la population de cet IRIS comptée par la MÊME règle — jamais `iris.population`.

**Files:**
- Create: `sql/267_denominateur_iris.sql`
- Modify: `scripts/local/11-reconstruire.sh` (après T3), `12-sante.sh` (`unite_population_totale` 35 031 → 35 031 + n IRIS), `types/database.types.ts`
- Test: `tests/integration/carreau-couverture.test.ts` (complété)
- Doc: `ARCHITECTURE.md` (ligne `unite_population_totale` : quatre mailles + `iris`)

**Interfaces:**
- Produces: `construire_denominateur_iris() → jsonb` (`{ ok, n_iris, n_carreaux, duree_ms }`), qui `delete from unite_population_totale where maille = 'iris'` (lire son erreur côté script) puis insère `('iris', code_iris, jsonb_object_agg(code, somme), n_carreaux)` depuis `carreau_couverture` ; idempotente.

- [ ] **Step 1: Test (échec)** — maille `iris` présente ; nombre de lignes ≤ 49 448 et ≥ 45 000 (IRIS habités) ; somme `ind` = somme de `carreau_couverture where code_iris is not null` ; aucune part > 100 % possible : pour 50 IRIS tirés, `sum(pops[1]) where code_iris = X` = dénominateur.
- [ ] **Step 2-4: FAIL → migration → PASS** ; `EXPLAIN` de la construction (attendu : quelques secondes, une passe sur la table étroite).
- [ ] **Step 5: Commit** — `feat(db): dénominateur IRIS compté sur le carroyage, même règle que le numérateur (sql/267)`.

---

### Task 5: `couverture_geometrie` — la lecture

**Objectif :** pour une zone de l'espace, une cible et un découpage, les chiffres — en une RPC `jsonb`, en lecture seule, bornée.

**Files:**
- Create: `sql/268_couverture_geometrie.sql`
- Modify: `types/database.types.ts`
- Test: `tests/integration/couverture-geometrie.test.ts` (créé)
- Doc: `ARCHITECTURE.md`

**Interfaces:**
- Produces: `couverture_geometrie(p_zone_id uuid, p_org_id uuid, p_cible text default 'ind', p_decoupage text default 'forme', p_max_carreaux integer default 400000) → jsonb`, `STABLE`, `security invoker`, `set search_path to 'public','pg_catalog'`, service_role seulement. **Aucune table temporaire** (PostgREST exécute un GET en lecture seule — la route appelle en POST, mais la fonction reste lisible partout) : CTE `as materialized` (mémoire `reference_cte_materialized_postgres`).
- Réponse (toutes clés présentes, même à zéro) :

```json
{ "zone_id": "…", "cible": "ind", "decoupage": "cp",
  "surface_km2": 5103.4, "n_carreaux": 33100, "population": 1906400,
  "lignes": [ { "code": "13100", "nom": "Aix-en-Provence", "pop_en_zone": 97172, "pop_totale": 97172, "part": 100.0 } ],
  "hors_territoire": { "n_carreaux": 12, "population": 1786 },
  "n_territoires": 126, "calcule_le": "…" }
```

  `lignes` est vide pour `forme` ; triée par `pop_en_zone` décroissante ; `part` = `round(100 * pop_en_zone / nullif(pop_totale,0), 1)`, jamais > 100 (contrôle : sinon EXCEPTION — une part > 100 % est un défaut de règle, pas une donnée) ; `nom` = `ref_codes_postaux.nom_principal` / `iris.nom_iris`.
- Refus `{ refus }` : `zone_introuvable` (absente OU `org_id <> p_org_id` — même réponse, on ne révèle pas l'existence), `cible_inconnue` (hors `cibles_exposition where actif`), `zone_trop_vaste` (> 100 000 km²), `trop_de_carreaux` (+ `plafond`), `couverture_non_construite` (table vide : `not exists (select 1 from carreau_couverture)`). `p_decoupage` hors `forme|cp|iris` ou plafond hors [1, 400 000] → exception `22023`.

- [ ] **Step 1: Test d'intégration (échec)** — `couverture-geometrie.test.ts` ; zones de test créées par `creer_zone_recette` dans `beforeAll` (espace de test du `_client.ts`), supprimées dans `afterAll` (lire l'erreur du `delete`) :
  - zone « rayon 5 km Lyon » (`zone_rayon(4.8357, 45.7640, 5000)`) : `forme` → 1 661 carreaux, 649 832 hab. (± 0,5 %, ce sont les mesures A) ; `cp` → 21 lignes, `69100` à ≈ 83,7 % ; `iris` → 266 lignes ; **somme des lignes + hors_territoire = population** dans les deux découpages ;
  - zone « département 13 » (zone de recette `codes_postaux`? non : `dessin` de `resoudre_perimetre('departement','13')` APRÈS T2) : `cp` → `13100` à **100,0 %** (fin du 92,5 %) ;
  - zone d'un AUTRE espace → `{ refus: 'zone_introuvable' }` ; id inconnu → même refus ;
  - cible `men_pauv` → population = somme `men_pauv` ; cible `xxx` → `cible_inconnue` ;
  - plafond 10 → `{ refus: 'trop_de_carreaux', plafond: 10 }` ; découpage `commune` → `22023` ;
  - aucune ligne avec `part > 100`.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Migration** — squelette (le prototype mesuré, réécrit sur la table étroite) :

```sql
with z as materialized (
  select ST_Subdivide(ST_Transform(g.geometry, 3857), 256) sg from public.custom_geo_zones g
   where g.id = p_zone_id and g.org_id = p_org_id),
c as materialized (
  select distinct on (cc.carreau_id) cc.carreau_id, cc.pops[v_rang] pop, cc.code_postal, cc.code_iris
    from z join public.carreau_couverture cc on cc.centroide_3857 && z.sg and ST_Contains(z.sg, cc.centroide_3857)
   limit p_max_carreaux + 1)
-- forme : count, sum ; cp : group by code_postal + left join cp_population_totale ; iris : group by code_iris
--   + left join unite_population_totale on maille = 'iris' — hors_territoire = code null
```

  (`distinct on` : un centroïde exactement sur l'arête commune de deux morceaux subdivisés serait sinon compté deux fois — `ST_Contains` exclut la frontière, mais `ST_Subdivide` produit des arêtes partagées ; le test « somme = population » le verrouille.)
- [ ] **Step 4: PASS + EXPLAIN** — les trois cas × trois découpages (Lyon 5 km, BdR, ARA) ; tableau dans le rapport à côté des mesures B. Bornes d'arrêt : ARA `iris` > 2 s ou > 500 000 accès ; BdR `cp` > 0,3 s.
- [ ] **Step 5: Troncature** — `tests/unit/db/troncature-postgrest.test.ts` reste vert sans entrée (RPC `jsonb`).
- [ ] **Step 6: Doc + commit** — `feat(db): couverture_geometrie — chiffrer une zone telle quelle, par CP ou par IRIS (sql/268)`.

---

### Task 6: La route, le cache et le quota

**Objectif :** `GET /api/zones/[id]/couverture?cible=&decoupage=` — un chiffrage par zone, servi du cache tant que la forme n'a pas changé.

**Files:**
- Create: `sql/269_couverture_zone_cache.sql`, `lib/zones/couverture.ts`, `app/api/zones/[id]/couverture/route.ts`
- Modify: `types/database.types.ts`
- Test: `tests/unit/api/couverture-route.test.ts` (créé), `tests/integration/couverture-geometrie.test.ts` (complété : le cache)
- Doc: `ARCHITECTURE.md` (`## Routes API`, `## Tables Supabase`), `lib/api/rate-limit.ts` (aucun changement de code ; le préfixe est listé dans la doc)

**Interfaces:**
- Produces (SQL): table `couverture_zone_cache (zone_id uuid references custom_geo_zones(id) on delete cascade, cible text, decoupage text, zone_maj timestamptz not null, resultat jsonb not null, calcule_le timestamptz default now(), primary key (zone_id, cible, decoupage))`, RLS + service_role ; `couverture_zone(p_zone_id uuid, p_org_id uuid, p_cible text, p_decoupage text) → jsonb` VOLATILE : lit le cache où `zone_maj = custom_geo_zones.updated_at` (rend `resultat || {"cache": true}`), sinon appelle `couverture_geometrie`, et n'écrit le cache que pour un résultat SANS `refus`. Les deux fonctions rendent les mêmes clés.
- Produces (TS) `lib/zones/couverture.ts` : `DECOUPAGES = ['forme','cp','iris'] as const`, `RequeteCouvertureSchema` (Zod : `cible` = `/^[a-z0-9_]{2,20}$/`, `decoupage` ∈ `DECOUPAGES`), `MESSAGES_REFUS_COUVERTURE` (français : « Cette zone n'existe pas dans cet espace. », « Cette cible n'est pas connue. », « La zone est trop vaste : la couverture se calcule jusqu'à la taille d'une région. », « La zone compte plus de 400 000 carreaux habités. », « La couverture n'est pas encore construite sur cette base. »), `statutDuRefus(refus) → 404 | 422 | 503`.
- Route : `requireAuth(req)` → `espaceDeZone` → schéma Zod des `searchParams` + id UUID → **`couverture_zone`** ; quota `createRateLimiter({ max: 12, window: '60 s', prefix: 'geo:rl:couverture' })` consommé SEULEMENT quand la réponse n'est pas en cache (A-16) : la route lit d'abord la ligne de cache par une requête de table bornée (`.select('zone_maj, resultat').eq(...).maybeSingle()` jointe à `updated_at` — une seule lecture), puis le quota, puis la RPC. ≤ 2 appels Supabase séquentiels. `maxDuration = 60`. Réponse 200 = le jsonb ; 4xx = `{ error, refus }`.

- [ ] **Step 1: Tests (échec)** — unitaires (client Supabase factice, patron de `tests/unit/api/zones-routes.test.ts`) : 401 sans session ; 403 sans espace ; 400 sur `decoupage=commune` ou id non UUID (AUCUN appel Supabase) ; cache valide → 200 sans jeton consommé ni RPC de calcul ; cache absent → quota puis RPC ; quota épuisé → 429 sans RPC ; `zone_introuvable` → 404 message français ; `trop_de_carreaux` → 422 ; erreur Postgres → 500 « Calcul de la couverture impossible. » sans détail. Intégration : deux appels → le second `cache: true` ; `remplacer_geometrie_zone` sur la zone → le suivant recalcule (Review Focus 2) ; suppression de la zone → la ligne de cache disparaît (cascade).
- [ ] **Step 2-4: FAIL → implémenter → PASS.**
- [ ] **Step 5: `tests/unit/api/routes-publiques.test.ts`** vert sans élargir `GARDES` (L3-7) ; `tests/unit/api/validation-corps.test.ts` vert.
- [ ] **Step 6: Doc + commit** — `feat(api): GET /api/zones/[id]/couverture, en cache tant que la forme ne change pas (sql/269)`.

---

### Task 7: Angular — l'API, la zone analysée dans l'URL, la logique pure, le sélecteur

**Objectif :** la plomberie de ④ : choisir une zone de l'espace, la garder dans l'URL, demander sa couverture sans jamais afficher la réponse d'une zone, d'une cible ou d'un espace quittés.

**Files:**
- Create: `angular/src/app/features/carte/data/couverture.api.ts` (+ spec), `etat/zone-analysee.service.ts` (+ spec), `logique/analyses/couverture.ts` (+ spec), `panneaux/analyse/choix-zone-analysee.component.ts` (+ spec)
- Modify: `angular/src/app/app.routes.ts` (`CouvertureApi` dans `FOURNISSEURS_DISTANTS`), le fichier voisin des fournisseurs de `carte.page.ts` (créer `carte.fournisseurs.ts` si la page n'en a pas : elle est à 371/400) pour `ZoneAnalyseeService`
- Doc: `angular/src/app/features/carte/README.md` (« ④ Analyse : la zone analysée »)

**Interfaces:**
- `CouvertureApi extends HttpBaseService` : `couverture(zoneId, cible, decoupage): Observable<ResultatCouverture>` → `GET ${baseUrl}/zones/${id}/couverture?cible=…&decoupage=…`. Types `ResultatCouverture`, `LigneCouverture`, `Decoupage` dans `logique/analyses/couverture.ts` (copie des clés de T5 ; un test de parité lit `lib/zones/couverture.ts` et vérifie `DECOUPAGES` et les messages — patron `tests/unit/angular/recette-paritaire.test.ts`).
- `logique/analyses/couverture.ts` (PUR) : `lireParamCouverture(brut) → { cible, decoupage }` (défaut `ind.forme`, valeur illisible → défaut, ne lève jamais), `ecrireParamCouverture`, `trierLignes(lignes, cle, sens)`, `pageDeLignes(lignes, page, taille = 50)`, `libelleDecoupage`, `messageErreurCouverture(e)` (lit `error.error.error`, statut 0 → « Connexion perdue : réessayez. »), `resumeCouverture(r, libelleCible)` (« 1 906 400 habitants · 5 103 km² · 126 codes postaux » via `formaterNombre`).
- `ZoneAnalyseeService` (`@Injectable()`, fourni par la PAGE) : signaux `zoneId`, `cible`, `decoupage`, `resultat`, `enCours`, `erreur` ; `choisir(id | null)`, `regler({cible?, decoupage?})`, `chiffrer()` ; reflet `?zoneAnalyse=` et `?couverture=` (patron EXACT de `ParcoursService` : lu à la construction, `replaceUrl` + `merge`, navigation relative à la route enfant active, relu sur une navigation qui ne vient pas de lui) ; chaque `chiffrer()` incrémente un jeton ; une réponse dont le jeton n'est plus le courant est jetée (P-c) ; changer de zone, de cible ou de découpage efface le résultat ; un 404 retire `?zoneAnalyse=` et affiche le message.
- `mg-choix-zone-analysee` : bouton « Choisir une zone » → à la PREMIÈRE ouverture lit `ZonesCustomApi.lister` (espace actif, `limit` existant de la route ; aucune lecture à l'ouverture de ④) ; liste filtrable par nom ; la zone choisie affiche nom, libellé de recette (`libelleRecette`), « Changer », « Retirer ». Sortie `choisie = output<string | null>()`.

- [ ] **Step 1: Specs (échec)** — `couverture.spec.ts` (pur : lecture/écriture du paramètre, tri, pagination, messages) ; `zone-analysee.service.spec.ts` : URL lue à la construction ; `choisir` écrit `?zoneAnalyse=` en `replaceUrl` ; deux `chiffrer()` rapides → seule la seconde réponse est gardée ; réponse arrivée APRÈS `choisir(autre)` → jetée ; service détruit (page recréée au changement d'espace) → aucune écriture après destruction ; 404 → param retiré + message ; `couverture.api.spec.ts` : adresse construite sur `baseUrl` ; `choix-zone-analysee.component.spec.ts` : aucune requête avant le premier clic, une seule ensuite.
- [ ] **Step 2-4: FAIL → implémenter → PASS** (`cd angular && npx ng test --watch=false --include='**/couverture*.spec.ts' --include='**/zone-analysee*.spec.ts' --include='**/choix-zone-analysee*.spec.ts'`).
- [ ] **Step 5: Vérifications** — `tests/unit/angular/taille-fichiers.test.ts`, build Angular, `tsc`.
- [ ] **Step 6: Commit** — `feat(angular): ④ la zone analysée — API, état d'URL, sélecteur (lot 4, T7)`.

**Pièges nommés :** P-a (l'effet qui relit l'URL n'écrit le signal qu'en `untracked`), P-b, P-c (jeton), P-d, P-e (le service est à la PAGE, pas au panneau : la zone survit à ④ → ① → ④).

---

### Task 8: Angular — l'accordéon « Couverture » et sa couche sur la carte

**Objectif :** l'écran qui donne la valeur : en tête de ④, choisir la zone, la cible, le découpage, « Chiffrer la zone », lire les chiffres et les voir sur la carte.

**Files:**
- Create: `panneaux/analyse/outil-couverture.component.ts` (+ spec), `panneaux/analyse/tableau-couverture-zone.component.ts` (+ spec), `couches/couche-couverture.ts` (+ spec), `couches/couverture.service.ts` (+ spec)
- Modify: `panneaux/analyse/panneau-analyse.component.ts` (l'accordéon « Couverture d'une zone » EN PREMIER, ouvert par défaut ; les autres inchangés), `logique/ordre-couches.ts` (`couverture-*` au-dessus des zones custom, sous les POI), le fichier voisin des pastilles de `carte.page.ts` (`analyseAffichee` ← `|| couverture.affichee()`), `carte.page.spec.ts` (inventaire : ligne « Couverture d'une zone » en ④)
- Doc: README carte, `ARCHITECTURE.md` (§ carte Angular)

**Interfaces / comportement :**
- `mg-outil-couverture` : `mg-choix-zone-analysee` ; sélecteur de cible (catalogue `ProfilRisqueApi.cibles()`, lu à la première ouverture du sélecteur, regroupé par famille, libellés du catalogue) ; découpage en trois boutons segmentés (« Telle quelle » · « Par code postal » · « Par IRIS ») ; CTA teal « Chiffrer la zone » (désactivé sans zone ou en vol) ; barre de progression indéterminée pendant le vol ; résultat : trois chiffres en JetBrains Mono (population de la cible, surface, nombre de territoires), « hors code postal / hors IRIS » s'il y en a, la phrase du dénominateur (Q-J : « Part des habitants carroyés de chaque territoire (Filosofi 2021). »), « Calculé le … · en cache » ; refus et erreurs en une ligne, au-dessus du CTA.
- `mg-tableau-couverture-zone` : colonnes Territoire (code + nom), Dans la zone, Total, Part (barre fine `--seq-*` + nombre) ; tri par colonne ; 50 lignes par page avec « Suivantes » ; survol d'une ligne → surbrillance du territoire sur la carte (sortie `survol`) ; aucune ligne tronquée sans le dire (« 5 486 IRIS · page 3 sur 110 »).
- `CouvertureService` (fourni par la PAGE) + `couche-couverture.ts` (fonctions PURES) : contour de la zone (`ZonesCustomApi.geometrie(id)`, lue une fois par zone) ; `cp` → les contours de `ContoursZonesService` (déjà en mémoire si le score a servi) filtrés aux codes de la réponse, couleur par `part` en cinq classes `--seq-1…5` CALCULÉES (`CouleursService.palette`) ; `iris` → une couche `couverture-iris-fill` sur la source `iris-source` existante (posée si absente, avec son `minzoom` IRIS), expression `match` sur le code ; sous le zoom IRIS, la ligne « Zoomez pour voir les IRIS » ; `forme` → le contour seul. Recadrage sur l'emprise de la zone (padding 60). Retrait au changement de zone et à la destruction du SERVICE (P-e).
- Garde : la couverture n'a pas besoin du filtre ① (la zone EST le périmètre) ; `verifierPerimetreOutil` n'est pas appelé pour elle — le verrou `panneau-analyse-garde.test.ts` est complété (la couverture est DÉCLARÉE hors garde de ①, avec la raison, comme la corrélation).
- A-9 : quand une zone est analysée, les accordéons bataille V1/V2 et clustering affichent « Cet outil travaille sur le périmètre de l'étape ①. » (une ligne, `text-tertiary`), sans autre changement.

- [ ] **Step 1: Specs (échec)** — `outil-couverture` : aucun appel avant « Chiffrer » ; un appel ensuite ; refus 422 → message ; changement de découpage → résultat effacé, rien ne repart seul ; `tableau-couverture-zone` : tri, pagination, compte « page n sur m » ; `couche-couverture` (carte factice) : couches posées/retirées, aucune couleur `var(` ni `#` dans `paint`, `match` construit pour 5 486 codes sans lever ; `couverture.service` : changement de zone → couches de l'ancienne retirées ; inventaire de la page à jour ; `panneau-analyse-garde` complété.
- [ ] **Step 2-4: FAIL → implémenter → PASS** + suite Angular complète + build + `tsc` + `taille-fichiers`.
- [ ] **Step 5: Preuve navigateur** (`:4202` + Next `:3002` du worktree, BMW GROUP puis Marine nationale, deux thèmes, captures `L4a-T8-*`) : (1) ④ ouvert sans zone : aucune requête (onglet Réseau) ; (2) une zone `rayon_poi` des Bouches-du-Rhône chiffrée telle quelle, par CP (Aix 13100 à 100 % si la zone le couvre), par IRIS zoomé et dézoomé ; (3) une zone-région (seuil territoire ARA) par IRIS : 5 000+ lignes paginées, durée relevée ; (4) recalcul de la zone en ③ puis retour en ④ : « Chiffrer » recalcule (pas « en cache ») ; (5) `?zoneAnalyse=` d'une zone de BMW collé dans Marine nationale → « Cette zone n'existe pas dans cet espace », paramètre retiré ; (6) ④ → ① → ④ : le résultat et la couche sont toujours là. Équivalent React : AUCUN (le dire) ; capture React de l'onglet Couverture du module risque pour comparer la lecture du tableau.
- [ ] **Step 6: Doc + commit** — `feat(angular): ④ couverture d'une zone — telle quelle, par CP ou par IRIS, peinte sur la carte (lot 4, T8)`.

**Pièges nommés :** P-b, P-c, P-e, P-f ; le seuil du fil compact (§ 17 : 640 px, pire cas 635) est REMESURÉ avec la pastille ④ allumée.

---

### Task 9: Preuve, documentation et revue de 4a

**Files:** `ARCHITECTURE.md` (§ zones custom : « une zone se chiffre sans se convertir » ; les tables, RPC, route ; la divergence `audience_stats` A-15 ; le constat des trous), README carte, inventaire, `docs/superpowers/specs/…-design.md` (« Écarts à la livraison du lot 4a » — commit `docs(spec)` séparé, appliqué par le contrôleur sur `feat/angular-lot0`).

- [ ] **Step 1: Vérification complète** sans pipe : `npx tsc --noEmit` ; `npm run lint` ; `npm run test:unit` ; `npm run test:integration` (0 échec) ; `cd angular && npx ng test --watch=false` ; build Angular ; `npm run build` (Next, avec `NEXT_PUBLIC_SUPABASE_URL` locale) ; `npm run catalogue` si `knip` a bougé (cliquet 141).
- [ ] **Step 2: Les cinq cas du Review Focus**, capturés dans les deux thèmes.
- [ ] **Step 3: Revue finale de 4a** (modèle le plus capable) avec passe de FACTORISATION inter-tâches (mémoire `feedback_factorisation_fin_de_lot`) ; une seule vague de correctifs ; dire ce qui reste dupliqué.
- [ ] **Step 4: Commit** — `docs: lot 4a — couverture générique livrée`.

---

## LOT 4b — Les analyses de ④ sur la zone choisie (5 tâches)

### Task 10: Le score composite sur la zone analysée

**Objectif :** le seul outil existant qui sache déjà lire une zone (`/api/analyses/score` accepte `perimetre {type:'zone'}`) la reçoit de ④.

**Files:** `logique/analyses/score.ts` (+ spec : `corpsScore(choisis, filtre, …, zoneAnalysee?)`), `etat/score-composite.service.ts` (+ spec), `panneaux/analyse/outil-score.component.ts` (+ spec), `logique/garde-perimetre.ts` (le paramètre `zoneSelectionnee` enfin passé).

- [ ] Specs (échec) : zone analysée posée → corps `perimetre: { type: 'zone', code: id }`, filtre ① ignoré ; sans zone → comportement actuel octet pour octet ; une bascule « Sur : la zone analysée | le périmètre de ① » (deux boutons segmentés, défaut = la zone quand il y en a une) ; garde : une zone suffit (pas de filtre exigé). Le REJEU d'un score enregistré (« Mes analyses ») est inchangé.
- [ ] Implémenter, PASS, preuve navigateur (score sur une zone `rayon_poi`, CP peints = ceux que la route retient pour la zone), deux thèmes ; capture React du score sur le même filtre « zone » (React l'a : filtre zone de ①).
- [ ] Commit `feat(angular): ④ le score composite sur la zone analysée (lot 4, T10)`.

**Pièges :** P-c (un score lancé sur une zone puis la zone changée : réponse jetée).

---

### Task 11: `couverture_rayon_poi` — la courbe et les anneaux autour de n'importe quel type de POI

**Objectif :** la couverture par rayon du module risque, généralisée (spec § 4 ③, Q3, sommaire point 5), sans pré-calcul, bornée au département, et de PARITÉ prouvée.

**Files:** `sql/270_couverture_rayon_poi.sql`, `types/database.types.ts`, `tests/integration/couverture-rayon-poi.test.ts` (créé), `ARCHITECTURE.md`.

**Interfaces:**
- `couverture_rayon_poi(p_categorie text, p_perimetre_type text, p_perimetre_code text, p_org_id uuid, p_sources uuid[], p_cible text default 'ind', p_rayon_max_m integer default 5000, p_champ text default null, p_valeurs text[] default null, p_profil jsonb default null, p_inclure_inactifs boolean default false, p_max_poi integer default 5000) → jsonb`, STABLE, service_role.
- Périmètre : `resoudre_perimetre(…, 12000, array['departement','commune','cp','zone'])` pour la garde et les POI ; carreaux par CODE (`code_departement` / `code_commune` / `code_postal` de `carreau_couverture`) pour un périmètre administratif, par géométrie (`ST_Subdivide`) pour une zone (A-11). POI : catégorie, `p_valeurs` sur le champ, visibilité `data_source_id is null or = any(p_sources)` (sql/254), `ST_DWithin(p.geom::geography, périmètre, p_rayon_max_m)` ; pour `risque_industriel` sans `p_inclure_inactifs`, exclusion de `metadata->>'etat_activite' = 'En fin d''exploitation'` (règle de `construire_couverture_rayon`).
- Distance : `ST_Distance(ST_Transform(centroide_3857, 4326)::geography, poi::geography)`, paires bornées par `ST_DWithin` sur la géographie, `min` par carreau ET par valeur du champ (`grouping sets` comme sql/200), palier `least(floor(d/100)*100, r_max)`, cumul et grille COMPLÈTE `generate_series(100, r_max, 100)` avec report, incrément = différence de cumuls arrondis (sql/201).
- Réponse au FORMAT de `lire_couverture_rayon` (`calculable`, `cible`, `rayon_max_m`, `courbes [{cle, total, carreaux, points [{r,p,i}]}]` — `cle = '*'` + une par valeur) plus `n_poi`, `population_perimetre`, et, si `p_profil` (`{"seveso_haut":[500,1000,2000],"seveso_bas":[500]}`), `classes [{valeur, anneau_m, population}]` + `hors_classes` selon A-12. Refus : `perimetre_*` (ceux de `resoudre_perimetre`, dont `perimetre_trop_grand` pour une région), `trop_de_poi`, `champ_non_admis` (liste fermée `{sous_categorie}`), `trop_de_valeurs` (> 8), `cible_inconnue`, `couverture_non_construite` ; `p_rayon_max_m` hors [100, 10 000] → 22023.

- [ ] **Step 1: Test (échec)** — **PARITÉ** : `couverture_rayon_poi('risque_industriel','departement','13', null, <sources ICPE>, 'ind', 10000, 'sous_categorie', array['seveso_haut','seveso_bas'])` : courbe `*` ÉGALE, palier par palier (les 100), à `lire_couverture_rayon('ind', null, null, 'departement', '{13}')` reconstruite en T1 (`REFERENCES_13`) ; les courbes `seveso_haut` / `seveso_bas` égales à celles filtrées par gravité. Puis : lycées BdR 5 km → `total` > 0, une seule courbe de valeur ; région 84 → `{ refus: 'perimetre_trop_grand' }` sans calcul ; 6 001 POI → `trop_de_poi` ; champ `nom` → `champ_non_admis` ; profil → `∑ classes + hors_classes = population_perimetre`.
- [ ] **Step 2: FAIL. Step 3: Migration. Step 4: PASS + EXPLAIN** : BdR lycées 5 et 10 km, BdR ICPE Seveso 10 km, BdR ICPE toutes natures 5 km (mesure C : 1,34 s / 1,39 M) ; arrêt si > 2 s ou > 2 M accès — alors baisser le rayon max admis à 5 km pour les catégories de plus de 1 000 POI dans le périmètre, et le dire.
- [ ] **Step 5: Commit** — `feat(db): couverture par rayon autour de tout type de POI, de parité prouvée avec le module risque (sql/270)`.

**Si la parité n'est pas exacte :** chercher la règle qui diverge (sites lus par `lng/lat` contre `geom`, département par `lcog` contre géométrie, palier) avant toute tolérance ; une tolérance ne s'accepte qu'écrite avec sa cause mesurée.

---

### Task 12: La route et l'écran de la couverture par rayon

**Files:** `app/api/analyses/couverture-rayon/route.ts` (GET, `requireAuth`, `espaceDeZone`, Zod, `getOrgSourceIds({…}, { vueEspace: true })`, quota `geo:rl:couverture-rayon` 12/min, pas de cache — le résultat dépend de trop de réglages), `tests/unit/api/couverture-rayon-route.test.ts` ; Angular : `data/couverture.api.ts` (méthode `rayon(…)`), `panneaux/analyse/outil-rayon.component.ts` (+ spec), `features/risques/etapes/rayon/courbe-population.component.ts` (extrait, + spec), `courbe-rayon.component.ts` réduit à une enveloppe (son spec INCHANGÉ et vert = preuve que le risque n'a pas bougé).

- [ ] Route : tests 401/403/400/422/429/500 comme T6 ; le périmètre vient de ① OU de la zone analysée (`perimetre_type=zone`).
- [ ] Extraire de `mg-courbe-rayon` la partie de pure présentation (`courbe`, `libelleCible`, `titre`, `rayon`, `rayonMax`, `etiquettes`) dans `mg-courbe-population` ; `mg-courbe-rayon` l'enveloppe avec ses entrées risque (gravités, natures, export) ; spec du risque inchangé et vert.
- [ ] `mg-outil-rayon` (accordéon « Couverture par rayon autour d'un type de POI ») : type de POI (catalogue POI de ②), rayon max (réglette 100 m à 10 km, défaut 5 km), champ (aucun / `sous_categorie`), profil d'anneaux par valeur (réutiliser la logique de `features/risques/logique/profil.ts` si elle est générique, sinon une liste de rayons par valeur), cible ; « Calculer » ; courbe `mg-courbe-population`, tableau des classes ; refus en une ligne. Peint sur la carte : les POI retenus et, pour le rayon choisi sur la courbe, les cercles (`cercleGeoJSON` de `risques/logique/cercle.ts`, déjà importé par `pois.service.ts`).
- [ ] Preuve navigateur (deux thèmes) : sites Seveso des Bouches-du-Rhône, profil haut [500, 1 000, 2 000] / bas [500] → courbe et classes ; **la même capture côté module risque Angular ET React (`/map` → risques)** pour comparer les chiffres (parité visible) ; lycées des Bouches-du-Rhône sur la zone analysée.
- [ ] Commit `feat: ④ couverture par rayon autour de tout type de POI (lot 4, T12)`.

**Pièges :** P-a, P-c, P-d (les entrées de `mg-courbe-population` sont lues en fonction), P-e.

---

### Task 13: Croisements radio et trafic sur la zone

**Files:** `sql/271_croisements_zone.sql`, `app/api/zones/[id]/croisements/route.ts` (+ test), `panneaux/analyse/croisements-zone.component.ts` (+ spec), `data/couverture.api.ts`.

**Interfaces:** `croisements_zone(p_zone_id uuid, p_org_id uuid, p_limite integer default 200) → jsonb` : `{ radio: { n_emetteurs, emetteurs: [{ nom, frequence_mhz, puissance_w, stations: [noms] }], tronque }, trafic: { n_comptages, tmja_max, tmja_median, comptages: [{ route, tmja, annee_mesure, type_comptage }], tronque } }` ; émetteurs dont le cercle `ST_DWithin(geom::geography, zone::geography, rayon_couverture_m)` touche la zone (`limit p_limite + 1`) ; comptages dont `geom` intersecte la zone (les 1 100 RÉELS, `source = 'tmja_rrn_national'` partout le 22/10 : la table ne porte plus de proxy OSM) ; `zone_introuvable` comme T5. Route GET, quota `geo:rl:couverture` partagé avec T6.

- [ ] Test d'intégration (zone BdR : au moins un émetteur, comptages ≥ 0 ; limite 1 → `tronque: true`) ; `EXPLAIN` sur la zone ARA (arrêt > 1 s).
- [ ] Angular : bloc « Dans cette zone » sous le résultat de couverture (deux listes repliables, nombres en Mono, « … et 37 autres » quand tronqué) ; lancé par son propre bouton (aucune lecture automatique).
- [ ] Preuve navigateur deux thèmes ; React : aucun équivalent (le dire). Commit `feat: ④ radio et trafic dans la zone analysée (lot 4, T13)`.

---

### Task 14: Preuve, documentation et revue de 4b

- [ ] Vérification complète (comme T9) ; inventaire de la page (couverture par rayon, croisements) ; README ; `ARCHITECTURE.md` ; « Écarts à la livraison du lot 4b » pour la spec.
- [ ] Revue finale de 4b avec passe de factorisation ; une vague de correctifs ; ce qui reste dupliqué (attendu : la règle « palier + cumul + grille » écrite deux fois, sql/201 et sql/270 — à dire, et à unifier au lot 5 quand `couverture_rayon_risque` pourra être remplacée).
- [ ] Commit `docs: lot 4b — analyses de ④ sur la zone analysée`.

---

## Risques

| Risque | Effet | Parade |
|---|---|---|
| R1 — Construction de `carreau_couverture` sur un poste à 141 Mo de RAM libre (mesuré au démarrage du stack le 22/10) | bandes lentes, VM WSL2 qui gonfle, Docker qui tombe | bandes de 24 → 48, reprise par journal, rien d'autre ne tourne pendant la construction, `12-sante.sh` avant/après |
| R2 — La reconstruction de `couverture_rayon_risque` (T1) dure (122 bandes, 20-30 s les denses) | T1 long | elle est reprenable ; on la lance en premier et on écrit T2 pendant ce temps |
| R3 — Bouchage des trous (T2) qui boucherait une vraie enclave non détectée | un périmètre déborde sur un autre département | règle par recouvrement de communes d'une autre unité, test sur les quatre enclaves connues ; liste des trous ≥ 0,3 km² bouchés dans le rapport, relue |
| R4 — Les chiffres du lot 3 bougent après T2 | tests du lot 3 rouges | ATTENDU et documenté ; un refus qui change de nature est, lui, un défaut |
| R5 — Deux nombres pour une zone (`audience_stats` par intersection, couverture par centroïde) | confusion côté client | A-15, écrit ; unification au lot 7 |
| R6 — `match` MapLibre de 5 000+ codes IRIS | rendu lent au dézoom | n'est posé qu'au-dessus du zoom IRIS ; mesurer le temps de `setPaintProperty` dans la preuve |
| R7 — La base locale est PARTAGÉE avec d'autres agents | une construction longue ralentit leurs tests | annoncer la construction dans le registre ; jamais pendant une revue qui lance `test:integration` |
| R8 — Lot « onglets + dossiers » (§ 18) qui suit | ④ à déménager dans l'onglet Insights | tout l'état neuf est dans l'URL (`zoneAnalyse`, `couverture`) et dans des services de PAGE : le déménagement est un montage, pas une réécriture |

## Registre d'exécution

À tenir dans `.superpowers/sdd/2026-10-22-carte-en-parcours-lot-4/progress.md` (non suivi), même format que le lot 3 : une ligne par dispatch, implémentation, revue, ruling (avec « coût si faux »), et les mesures EXPLAIN de chaque migration à côté de celles de ce plan.
