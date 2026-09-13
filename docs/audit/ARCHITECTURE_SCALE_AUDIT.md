# AUDIT ARCHITECTURE ET PASSAGE À L'ÉCHELLE — MAGELIAN

> **2026-09-13.** Audit en lecture seule. Aucun fichier applicatif modifié,
> aucune migration appliquée. Modèle de calcul isolé dans
> [`SCALE_MODEL.md`](./SCALE_MODEL.md), actions dans
> [`QUICK_WINS.md`](./QUICK_WINS.md).
>
> Étiquettes : `[MESURE]` · `[CALCULE]` (formule affichée) · `[HYPOTHESE]`
> (valeur retenue + fourchette). Un chiffre sans étiquette est un défaut de
> cet audit — il ne devrait pas y en avoir.

---

## Verdict en cinq lignes

1. **Plafond actuel : 2 à 4 utilisateurs simultanés en exploration de carte**, 10 à 20 en navigation tranquille. `[CALCULE]`
2. Le mur est le **disque**, et il est atteint par **une seule route** : `/api/tiles/[z]/[x]/[y]` pèse **40 510 798 ms de temps base**, soit **11 h 15 min** et **77 % du temps total mesuré**, sur 6 519 appels. `[MESURE]`
3. Cette route n'est **pas cachée au CDN** (`max-age` sans `s-maxage`, et derrière un cookie de session) et **n'est pas compressée**, alors que ses deux sœurs IRIS et TMJA font les deux. `[MESURE]`
4. **Plafond atteignable en moins de 5 jours : 60 à 120 utilisateurs simultanés**, sans changer de compute, en corrigeant le cache, la compression et les statistiques de `poi_france`. `[CALCULE]`
5. Il n'y a **aucun trafic de production** : zéro entrée dans les logs Vercel sur 7 jours. Tout ce qui suit est un modèle de coûts unitaires mesurés, pas une observation de charge. `[MESURE]`

---

## 0. Ce que l'audit a trouvé et qui contredit la documentation

Quatre écarts entre ce que le projet écrit sur lui-même et ce que la base répond.
Aucun n'est corrigé ici — l'audit est en lecture seule — mais chacun invalide
une décision qu'on prendrait en lisant la doc.

| Affirmation | Réalité mesurée | Conséquence |
|---|---|---|
| `CLAUDE.md` et `ARCHITECTURE.md` : « PostgreSQL 15 » | **PostgreSQL 17.6.1.063** `[MESURE]` | deux versions majeures d'écart. Les plans, les réglages par défaut et les fonctionnalités disponibles (`MERGE`, index B-tree dédupliqués, statistiques étendues) ne sont pas ceux qu'on croit |
| « compute **Nano** — 250 IOPS, 5 MB/s » | `shared_buffers` 256 Mo, `effective_cache_size` 768 Mo, `max_connections` 60 `[MESURE]` → **≈ 1 Go de RAM**, ce qui correspond au palier **Micro**, pas Nano `[CALCULE]` | les 250 IOPS sont **peut-être** un plafond périmé. **Non vérifiable depuis la base** : l'IOPS du volume ne s'expose pas en SQL. À lire dans le tableau de bord Supabase (Settings → Compute and Disk) **avant** de dimensionner quoi que ce soit |
| Brief d'audit : « legacy Adform intact — 4 campagnes, 294 135 lignes, 172 056 383 tracked_ads » | **3 campagnes** au total, dont **1 Adform** à **171 729 lignes** et **70 844 538 tracked_ads** ; 477 879 lignes toutes campagnes confondues `[MESURE]` | l'invariant tel qu'écrit **n'est pas vérifié**. Explication la plus probable, et bénigne : la route `/absorb` fusionne un import orphelin puis **supprime la coquille source** (comportement voulu), et le seed de démo a été reconstruit (sql/112). **Impossible à prouver sans un instantané daté** — à trancher avec une sauvegarde |
| `CLAUDE.md` : « Gzip obligatoire sur réponses MVT. MapLibre 5.x plante silencieusement sans » | `/api/tiles/iris/…` et `/api/tmja-tiles/…` posent `Content-Encoding: gzip`. **`/api/tiles/[z]/[x]/[y]` ne le pose pas** `[MESURE]` | soit la règle est fausse, soit la route la plus appelée du projet l'enfreint. Les deux méritent d'être tranchés : c'est 3,56 Mo par salve de tuiles au lieu de ~0,9 Mo |

---

## PHASE 1 — Surface d'exécution

### 1.1 Inventaire

| Grandeur | Valeur | Étiquette |
|---|---|---|
| Routes `app/api/**/route.ts` | **202** | `[MESURE]` |
| Pages `app/**/page.tsx` | 30 | `[MESURE]` |
| Routes en runtime `edge` | **0** | `[MESURE]` |
| `vercel.json` | absent | `[MESURE]` |
| Routes déclarant `maxDuration` | 44 (soit 158 sur le défaut) | `[MESURE]` |
| Node sur Vercel | 24.x | `[MESURE]` |

Répartition des `maxDuration` `[MESURE]` :

| Durée | Routes |
|---|---|
| **300 s** | **9** |
| 120 s | 3 |
| 60 s | 6 |
| 45 s | 2 |
| 30 s | 10 |
| 20 s | 1 |
| 15 s | 6 |
| 10 s | 4 |

> Neuf routes peuvent tenir une invocation **cinq minutes**. Ce n'est pas une
> limite Vercel qui casse — c'est une **facture de compute** et, surtout, une
> connexion PostgREST tenue cinq minutes pendant que le pool en compte ≤ 41.

### 1.2 Les six chemins qui coûtent

| Chemin | Coût base | Coût réseau | Dépendance externe |
|---|---|---|---|
| **Carte — tuiles carreaux** | 433 ms moyen, 750 ms à z9, **808 Ko de disque par tuile** `[MESURE]` | **297 Ko par tuile, non compressés** `[MESURE]` | — |
| Carte — tuiles IRIS | 256 ms moyen `[MESURE]` | 8 à 489 Ko, **gzippés** `[MESURE]` | — |
| **POI — `/api/map/pois`** | jusqu'à **10 pages de 1 000 lignes**, `ORDER BY id`, **aucun prédicat spatial** `[MESURE]` | ~2,5 Mo de JSON par type de POI `[CALCULE]` | — |
| Analyses (score, corrélation) | 23,5 ms pour 500 CP `[MESURE, sql/146]` | faible | — |
| Bataille isochrone | `get_voronoi_by_category` **79 718 ms de moyenne** `[MESURE]` | GeoJSON lourd | **ORS**, 5 POI par appel `[MESURE]` |
| Copilote IA | contexte borné (RPC 098 + journal 25/15/10 + 30 IRIS) | streaming | **Gemini 2.5 Flash** / Mistral Small |

### 1.3 État réel du cache

| Couche | Carreaux | IRIS | TMJA |
|---|---|---|---|
| `Cache-Control` | `public, max-age=3600` | `public, max-age=86400, s-maxage=604800, immutable` | idem IRIS |
| **`s-maxage` (directive CDN)** | **absent** | présent, 7 jours | présent, 7 jours |
| `Content-Encoding: gzip` | **absent** | présent | présent |
| Cache mémoire serveur | `Map`, TTL 1 h, **1 000 tuiles**, purge FIFO de 20 % | présent | — |

Trois conséquences, dans l'ordre de gravité :

1. **Le CDN Vercel ne stocke pas les tuiles carreaux.** La documentation Vercel
   désigne `s-maxage` comme la directive que son Edge Network respecte pour son
   propre stockage ; `max-age` seul n'instruit que le navigateur. `[HYPOTHESE]`
   — vérifiable en une commande :
   `curl -sI https://<domaine>/api/tiles/9/254/176 | grep -i 'x-vercel-cache\|cache-control'`.
2. **Et il ne pourrait pas de toute façon** : la route est derrière
   `middleware.ts` (préfixe `/api/tiles`), donc chaque requête porte le cookie
   de session. Un CDN ne mutualise pas une réponse authentifiée entre visiteurs.
   `[MESURE]` du placement, `[HYPOTHESE]` de la conséquence CDN.
3. **Le cache mémoire est par instance et peut peser 300 Mo.** 1 000 tuiles ×
   297 Ko = **297 Mo de RSS** `[CALCULE]` dans une fonction dont la mémoire par
   défaut est 1 Go. Et la purge supprime les **200 premières clés insérées**,
   pas les moins utilisées : une tuile très demandée est évincée avant une
   tuile vue une fois.

---

## PHASE 2 — Mesure

### 2.1 `pg_stat_statements` — top par temps total

Fenêtre : **2026-04-18 13:57:48 UTC → 2026-09-13**, soit **147 j 22 h**. `[MESURE]`

| # | Objet | Appels | ms total | ms moyen | ms max | Blocs disque |
|---|---|---|---|---|---|---|
| 1 | **`get_tile`** | 6 519 | **40 510 798** | 6 214,3 | **119 967** | 658 124 |
| 2 | `get_digital_campaign_map` (v1, supprimée 09-11) | 301 | 3 809 441 | 12 655,9 | 95 084 | 544 564 |
| 3 | `get_digital_campaigns_list` | 1 549 | 2 147 860 | 1 386,6 | 31 382 | 544 607 |
| 4 | `get_tmja_tile` | 1 311 | 948 962 | 723,8 | 17 991 | 290 546 |
| 5 | `calculate_coverage_per_group` | 381 | 888 799 | 2 332,8 | 92 880 | 1 992 977 |
| 6 | `fill_carreaux_1km_bande` (construction) | 17 | 607 050 | 35 708,8 | 69 103 | 747 580 |
| 8 | **`get_voronoi_by_category`** | 4 | 318 873 | **79 718,3** | 108 555 | **6 277 170** |
| 10 | `get_carreaux_capture_geometry` | 5 | 241 249 | 48 249,8 | 68 776 | 1 447 098 |
| — | `get_dsp_campaign_stats` | 277 | 116 250 | 419,7 | — | 417 536 |

**`get_tile` à lui seul = 77 % du temps base mesuré.** `[CALCULE]`

> ⚠ Ces moyennes couvrent **147 jours**, dont la période antérieure aux cascades
> d'agrégation (sql/129 le 2026-09-11, sql/138-140 le 2026-09-12). Le
> `6 214,3 ms` moyen de `get_tile` est un **historique**, pas le coût
> d'aujourd'hui — mesuré ce jour, il est de **199 à 750 ms**. Le rapport de
> réduction est d'environ **×10**. La ligne reste la plus coûteuse du projet,
> par le volume d'appels.

Un pic à **119 967 ms** sur une tuile — deux minutes — dit qu'il a existé un
régime où la carte était totalement inutilisable. C'est le profil de l'incident
du 28/03 inscrit dans les compteurs.

### 2.2 Cache Postgres et lectures disque

| Portée | Taux de cache | Lu depuis le disque sur la fenêtre |
|---|---|---|
| **Global** | **95,21 %** | **239 Go** `[MESURE]` |
| `carreaux_filosofi` | **44,68 %** | 91 Go |
| `poi_france` | **38,12 %** | **77 Go** |
| `iris` | 77,43 % | 44 Go |
| `dsp_campaign_data` | 99,64 % | 14 Go |
| `carreaux_1km` | 88,69 % | 2 159 Mo |

`239 Go / 147,9 j = 1,62 Go/j = 18,7 Ko/s = 2,3 E/S par seconde` `[CALCULE]`,
soit **0,9 % du plafond de 250 E/S/s**. La moyenne est confortable ; **c'est la
pointe qui tue**, et une salve de 12 tuiles en demande 1 212 (§ PHASE 4).

`shared_buffers` vaut 256 Mo pour un `carreaux_filosofi` de **4 630 Mo**
`[MESURE]` : **5,5 %** de la table tiennent en cache `[CALCULE]`. Le taux de
44,68 % n'est donc pas un défaut de réglage, c'est une conséquence arithmétique
de la taille du compute.

### 2.3 `poi_france` — le défaut le plus net de l'audit

| Grandeur | Valeur | Étiquette |
|---|---|---|
| Lignes | 290 877 | `[MESURE]` |
| Taille | 250 Mo (148 Mo de heap, 102 Mo d'index) | `[MESURE]` |
| **Balayages séquentiels** | **1 954** | `[MESURE]` |
| **Tuples lus séquentiellement** | **245 337 466** | `[MESURE]` |
| Équivalent en balayages complets | **843** | `[CALCULE]` `245 337 466 / 290 877` |
| Parcours par index | 6 603 | `[MESURE]` |
| **Parcours de ses 4 index GiST géométriques** | **0** sur 48 Mo d'index | `[MESURE]` |
| `last_autovacuum` / `last_autoanalyze` | **`NULL`** | `[MESURE]` |

Cause, lue dans le code : `/api/map/pois` filtre par bbox avec
`gte('lat',…).lte('lat',…).gte('lng',…).lte('lng',…)` `[MESURE]` — quatre
comparaisons sur deux colonnes `double precision` **sans index**, et jamais sur
la colonne `geom` qui, elle, en a quatre. Le chemin « par région » ne pose
**aucun** prédicat géographique : il tire jusqu'à 10 000 lignes par
`ORDER BY id` et filtre **en JavaScript**.

Plan réel, sans `ANALYZE`, sur le chemin bbox `[MESURE]` :

```
Limit  (cost=1.81..1.82 rows=1 width=125)
  ->  Sort  (cost=1.81..1.82 rows=1 width=125)
        ->  Index Scan using idx_poi_france_categorie on poi_france  (rows=1)
              Index Cond: (categorie = 'transport')
              Filter: ((lat >= 48.7) AND (lat <= 49) AND (lng >= 2.2) AND (lng <= 2.5))
```

Deux choses dans ce plan :

- la bbox est un **`Filter`**, pas un `Index Cond` : chaque ligne de la
  catégorie est lue depuis le disque puis jetée ;
- **`rows=1`** sur une table de 290 877 lignes. Le planificateur travaille sans
  statistiques — cohérent avec `last_autoanalyze = NULL`. Une estimation fausse
  d'un facteur 10 000 choisit des jointures et des tris faux dès qu'une requête
  se complique.

Trois autres tables partagent ce `last_autoanalyze = NULL` : `carreaux_filosofi`,
`iris`, et `poi_france`. Ce sont **exactement les trois plus grosses**. `[MESURE]`

### 2.4 Index

| Constat | Valeur | Étiquette |
|---|---|---|
| Index jamais parcourus, > 1 Mo, ni PK ni UNIQUE | **12, pour 236 Mo** | `[MESURE]` |
| Advisor `unused_index` | 67 | `[MESURE]` |
| Advisor `unindexed_foreign_keys` | 19 | `[MESURE]` |
| Advisor `no_primary_key` | 1 — `campaign_dsp_report` | `[MESURE]` |
| `bidding_daily_state` | **0 ligne, 11 Mo d'index** | `[MESURE]` |

Les plus gros index morts : `idx_comptages_routiers_geom_geog` (69 Mo),
`idx_comptages_routiers_midpoint_geog` (64 Mo),
`idx_comptages_routiers_midpoint` (36 Mo),
`idx_poi_france_geom_geography_gist` (23 Mo), `idx_poi_france_geom` (14 Mo),
`idx_poi_france_geom_cat` (11 Mo). `[MESURE]`

> Un index mort ne coûte pas qu'en disque : il est **maintenu à chaque écriture**
> et il dilue le cache. Les 169 Mo de `comptages_routiers` sont la cible la plus
> évidente — mais voir « ce qu'il ne faut pas optimiser », § PHASE 7.

### 2.5 Volumétrie de réponse

| Élément | Valeur | Étiquette |
|---|---|---|
| `/map` — poids de la route | 169 Ko | `[MESURE]` build |
| `/map` — **First Load JS** | **725 Ko** | `[MESURE]` build |
| Partagé par toutes les pages | 103 Ko | `[MESURE]` |
| Middleware | 81 Ko | `[MESURE]` |
| Tuile carreaux z4 | 413 321 o **non compressés** | `[MESURE]` |
| Tuile IRIS z7 | 489 045 o avant gzip | `[MESURE]` |
| Salve de 12 tuiles carreaux | **3,56 Mo** | `[CALCULE]` |

**Nombre de requêtes réseau au premier chargement de `/map` : non mesurable en
l'état.** Il faut un navigateur authentifié contre un serveur qui tourne, et la
mesure elle-même consommerait du budget E/S. Commande :
`npm run build && npm start`, puis relever l'onglet Réseau sur `/map`, ou
`npx playwright ... page.on('request')` après connexion.

### 2.6 Concurrence base

| Grandeur | Valeur | Étiquette |
|---|---|---|
| `max_connections` | 60 | `[MESURE]` |
| **Connexions allouées à Auth (GoTrue)** | **10, en valeur absolue** | `[MESURE]` advisor |
| Connexions PostgREST au repos | 2, `idle` | `[MESURE]` |
| Pool PostgREST configuré | **inconnu**, ≤ 41 | `[HYPOTHESE]` |

**L'application ne se connecte pas à Postgres.** Tout passe par PostgREST en
HTTPS (`createAdminClient()`), sauf **une** route — `/api/admin/health` — et un
script hors ligne. `[MESURE]` Le `max_connections` de 60 n'est donc pas la
limite de l'application : la limite est **la taille du pool interne de
PostgREST**, qui n'est pas lisible en SQL.

Conséquence pratique : le mode de pooling (Supavisor transaction ou session)
est **sans effet sur le chemin applicatif**, puisque personne ne l'emprunte.

### 2.7 p50 / p95 / p99 par route, et taux d'erreur

**Non mesurable en l'état.** Les logs d'exécution Vercel en production sur
7 jours contiennent **zéro entrée** `[MESURE]`, et le projet est marqué
`live: false` avec un dernier déploiement de cible `null` (préversion)
`[MESURE]`. Il n'y a pas de trafic à percentiler.

Pour que ces chiffres existent : activer Vercel Analytics ou Log Drains, puis
`get_runtime_logs(group_by: 'route')`. Sans cela, **toute la PHASE 3 reste un
modèle**, et doit être lue comme tel.

---

## PHASE 3 — Modèle de charge

Voir [`SCALE_MODEL.md`](./SCALE_MODEL.md) §3 et §4 pour les paramètres et les
formules. Résumé du coût d'**un** utilisateur actif :

| Axe | Navigation (1 salve / 75 s) | Exploration (1 salve / 15 s) |
|---|---|---|
| Requêtes SQL / heure | 576 tuiles | 2 880 tuiles |
| **Temps base / heure** | **249 s** = 0,069 vCPU | **1 247 s** = 0,346 vCPU |
| **E/S induites** | **16,2 E/S par seconde** | **80,8 E/S par seconde** |
| Mo transférés / heure | **171 Mo** (non compressés) | **854 Mo** |
| Secondes serverless / heure | ≈ 249 s (la fonction attend la base) | ≈ 1 247 s |
| Tokens LLM | `4 prompts × 2 sessions` = 8/jour `[HYPOTHESE]` | idem |
| Appels externes | 0 hors bataille ; 20 appels ORS par bataille de 100 POI `[MESURE]` | idem |
| € / mois | 235 à 255 € HT au total, **indépendant du nombre d'utilisateurs à ce niveau** `[HYPOTHESE fournie]` | idem |

---

## PHASE 4 — Points de saturation, dans l'ordre où ils cassent

`SEUIL = CAPACITE × 70 % / CONSO_PAR_UTILISATEUR` `[CALCULE]`

| # | Ressource | Capacité | Conso / utilisateur | **Seuil navigation** | **Seuil exploration** |
|---|---|---|---|---|---|
| **1** | **E/S disque** | 250 E/S/s `[HYPOTHESE]` | 16,2 / 80,8 E/S/s | **10,8** | **2,2** |
| **2** | **CPU base** | 2 vCPU `[HYPOTHESE]` | 0,069 / 0,346 vCPU | **20** | **4,0** |
| 3 | Pool PostgREST | ≤ 41 `[HYPOTHESE]` | 12 requêtes par salve | ≈ 3 salves **simultanées** | idem |
| 4 | Débit disque | 5 Mo/s | 10,8 / 53,9 Ko/s | 333 | 66 |
| 5 | Quota Gemini | 1 500 req/j `[HYPOTHESE]` | 8 prompts/jour | 187 (en inscrits) | idem |
| 6 | Quota ORS | 2 000 req/j `[HYPOTHESE]` | 20 appels par bataille | 100 batailles/jour | idem |
| 7 | Connexions Auth | **10** `[MESURE]` | voir ci-dessous | non linéaire | non linéaire |
| 8 | Fonctions Vercel | 1 000 simultanées `[HYPOTHESE]` | 12 par salve | ≈ 83 salves simultanées | idem |
| 9 | PMTiles / GitHub | — | — | **sans objet** : chemin mort `[MESURE]` | |

### Pourquoi 1 et 2 tombent presque ensemble

Un facteur 1,8 sépare les deux seuils. Ce n'est pas une coïncidence : sur ce
profil, le « temps CPU » de `get_tile` est **majoritairement de l'attente
disque**. Soulager le disque déplace les deux.

### Le cas Auth n'est pas un seuil, c'est un effet de bord

```
CAPACITE_AUTH = 10 connexions / latence d'une requête d'auth
```

| Latence | Régime | Capacité |
|---|---|---|
| 30 ms | disque au repos `[HYPOTHESE]` | 333 auth/s |
| 500 ms | disque chargé `[HYPOTHESE]` | 20 auth/s |
| **2 000 ms** | **budget E/S épuisé** `[HYPOTHESE]` | **5 auth/s** → file → **504** |

**C'est le mécanisme exact de l'incident du 28/03.** La capacité
d'authentification n'est pas une constante du système : c'est **10 divisé par
une latence que la carte contrôle**. Un prefetch de tuiles fait tomber le login.
La règle de `CLAUDE.md` (« `getSession()` sur les routes API, jamais
`getUser()` ») protège contre le **nombre** d'appels ; elle ne protège pas
contre leur **lenteur**.

### Croissance du stockage

`143 Mo par campagne importée` `[CALCULE]` (`630 o/ligne × 238 940 lignes`).

| Annonceurs | Croissance/an | Base à 1 an | À 3 ans |
|---|---|---|---|
| 10 | 5,6 Go | 12,5 Go | 23,7 Go |
| 50 | 28,0 Go | 34,9 Go | 91,0 Go |
| 200 | 112,1 Go | 119,0 Go | 343,2 Go |

Socle incompressible **6,9 Go**, dont **4,6 Go de `carreaux_filosofi` (67,5 %)**
qui ne grandit avec aucun client. Effet secondaire utile : sur un volume de type
gp3, **l'IOPS croît avec la taille du disque** — le palier 50 annonceurs
achèterait mécaniquement de l'E/S en même temps que de la place.

---

## PHASE 5 — Quatre paliers

`TAUX_CONCURRENCE = 8 %` `[HYPOTHESE]` (fourchette 3-15 %).

| Palier | Inscrits correspondants | Ce qui casse en premier | Symptôme observable | Métrique seuil | Correctif | Nature | Effort | € / mois après |
|---|---|---|---|---|---|---|---|---|
| **5 actifs** | ~63 | **E/S disque** sur `/api/tiles` | la carte met 5 à 15 s à se peupler ; l'app « rame » sans erreur | `shared_blks_read` de `get_tile` ; `X-Tile-Cache: MISS` | `s-maxage` + sortir les tuiles du cookie de session + gzip + `ANALYZE` sur les 3 grosses tables | **archi** (cache/CDN) | **< 1 j** | inchangé, **235-255 €** |
| **25 actifs** | ~313 | E/S disque résiduelles + `poi_france` | lenteurs sur les POI et les analyses, pas sur la carte | balayages séquentiels de `poi_france` | index spatial réellement utilisé sur `/api/map/pois` + purge des 236 Mo d'index morts | **archi** (requête) | 2-3 j | inchangé |
| **100 actifs** | ~1 250 | **CPU base** et `shared_buffers` | p95 qui dérive, pics de latence sur toutes les routes | temps base total, taux de cache < 90 % | compute **Small ou Medium** (2-4 Go de RAM) | **vertical** | 1 j | +15 à +60 $ `[HYPOTHESE]` |
| **500 actifs** | ~6 250 | CPU base, **génération MVT** | saturation générale ; une bataille bloque tout le monde | temps base de `ST_AsMVT`, file d'attente PostgREST | tuiles **pré-calculées** servies par un CDN (le chemin PMTiles, cette fois réellement déployé) + **réplica de lecture** + file d'attente pour battle/clustering/voronoi | **archi** | 15-25 j | +110 à +410 $ `[HYPOTHESE]` |

### Limitations produit à poser plutôt qu'à scaler

- **Bataille isochrone / Voronoï / clustering** : `79 718 ms` de moyenne pour
  `get_voronoi_by_category` `[MESURE]`. Un seul de ces calculs monopolise la
  base une minute. Ils ne doivent pas être synchrones, et surtout pas
  concurrents : **une file d'attente, un à la fois, par organisation.**
- **Quota par compte** sur les analyses : les limiteurs existent déjà
  (`lib/api/rate-limit.ts`, compteur partagé en base via `consommer_quota`) et
  couvrent **14 routes** `[MESURE]`. C'est le bon endroit, il faut l'étendre.

---

## PHASE 6 — Multi-tenant et isolation

### 6.1 Le modèle est multi-tenant, la RLS ne l'applique pas

| Grandeur | Valeur | Étiquette |
|---|---|---|
| Tables `public` | 93 | `[MESURE]` |
| RLS activée | 90 | `[MESURE]` |
| RLS activée **sans aucune policy** (deny-all voulu) | 18 | `[MESURE]` |
| **RLS absente** | **3** | `[MESURE]` |
| Policies au total | 143 | `[MESURE]` |

Les trois sans RLS : `iris_agg_commune`, `iris_agg_departement`,
`spatial_ref_sys`. Ce sont des **référentiels**, pas des données client — le
risque de fuite inter-clients est nul. Mais c'est un écart à la convention du
projet, et les deux premières sont des tables **écrites par l'application**
(`construire_iris_agg`).

**Les policies ne s'exécutent jamais.** Les 202 routes passent par
`createAdminClient()` (clé `service_role`), qui contourne la RLS. L'autorisation
réellement appliquée est celle du middleware plus les gardes de chaque
handler :

| Garde | Routes | Étiquette |
|---|---|---|
| `requireAuth` | 83 | `[MESURE]` |
| `requireAdmin` | 65 | `[MESURE]` |
| `checkCampaignAccess` | 26 | `[MESURE]` |
| `checkZoneAccess` | 11 | `[MESURE]` |
| `getSessionOrg` | 3 | `[MESURE]` |
| Limiteur de quota | 14 | `[MESURE]` |
| **Aucune garde dans le handler** | **48** | `[MESURE]` |

Les 48 sans garde en handler sont **toutes** couvertes par un préfixe de
`middleware.ts` — vérifié une par une — **sauf deux, légitimement** :
`/api/auth/[...auth]` (point d'entrée d'authentification) et `/api/inngest`
(webhook signé par Inngest). `[MESURE]`

### 6.2 Ce que le middleware ne fait pas

**Le middleware vérifie « authentifié », jamais « de quelle organisation ».**
Conséquence mesurée : les **13 routes `/api/poi-clusters/*`** sont protégées par
le middleware et **aucune ne porte d'organisation** — `poi_clusters`,
`clustering_models`, `clustering_jobs` n'ont ni `organization_id` ni `org_id`
`[MESURE]`. Un client de l'organisation A voit donc les modèles de clustering
construits par l'organisation B, et peut en lancer un qui consomme le budget
E/S de tout le monde.

Ce n'est pas exploitable aujourd'hui — **0 admin, 0 client hors comptes de
test** — mais c'est un bloquant avant la première organisation cliente réelle.

### 6.3 Le coût de réveiller la RLS

| Advisor | Occurrences | Ce que ça coûterait |
|---|---|---|
| `auth_rls_initplan` | **55** | `auth.uid()` **réévalué par ligne** au lieu d'une fois. Sur une table de 290 877 lignes, c'est 290 877 appels de fonction par requête. Correctif connu : envelopper en `(select auth.uid())` |
| `multiple_permissive_policies` | **54** | plusieurs policies permissives sur le même rôle et la même action : Postgres les évalue **toutes**, en `OR` |

**109 défauts de performance dormants.** Le jour où la clé `anon` est branchée,
ils se réveillent tous en même temps, sur un compute qui sature déjà à
2-4 utilisateurs. À corriger **avant** d'emprunter ce chemin, pas pendant.

### 6.4 Deux imports simultanés

- Insertion par lots de 50, **une requête par lot**, avec repli ligne à ligne
  (`lib/import/inserter.ts`).
- Le patron d'idempotence est **DELETE ciblé + INSERT**, verrouillé par
  `tests/unit/db/suppressions-sans-garde.test.ts`.
- Deux imports **sur des campagnes différentes** ne se verrouillent pas
  mutuellement : les DELETE portent sur `campaign_id`.
- Deux imports **sur la même campagne** se marchent dessus. Aucun verrou
  applicatif ne l'empêche ; `pg_advisory_xact_lock` n'est utilisé que par
  `publier_strategie` (sql/159) `[MESURE]`.
- Le vrai coût partagé est l'**E/S** : deux imports simultanés se disputent les
  mêmes 250 E/S/s que la carte.

---

## PHASE 7 — Verdict et feuille de route

### 7.1 Top 10 des goulots, triés par (impact sur le plafond) / (effort)

| # | Goulot | Impact | Effort | Preuve |
|---|---|---|---|---|
| 1 | Tuiles carreaux non cachées au CDN (`max-age` sans `s-maxage`, + cookie de session) | **×5 à ×20 sur le plafond** | **< 1 j** | `[MESURE]` en-têtes ; `get_tile` = 77 % du temps base |
| 2 | Tuiles carreaux non compressées | **−75 % de bande passante** | **< 1 h** | `[MESURE]` : IRIS et TMJA le font, pas elle |
| 3 | `poi_france` : bbox sur `lat`/`lng` sans index, 4 GiST à zéro parcours | **−843 balayages complets** | 1-2 j | `[MESURE]` 245 337 466 tuples séquentiels |
| 4 | `ANALYZE` jamais passé sur les 3 plus grosses tables | plans faux partout | **< 1 h** | `[MESURE]` `last_autoanalyze IS NULL`, `rows=1` estimé |
| 5 | `get_voronoi_by_category` à 79,7 s de moyenne | 1 appel = 1 min de base bloquée | 3-5 j (file d'attente) | `[MESURE]` |
| 6 | Cache mémoire de tuiles : 297 Mo de RSS possibles, purge FIFO | OOM de la fonction | **< 1 j** | `[CALCULE]` 1 000 × 297 Ko |
| 7 | `/api/map/pois` : filtre région **en JavaScript** sur 10 000 lignes | −2,5 Mo par type de POI | 1-2 j | `[MESURE]` lecture du code |
| 8 | 236 Mo d'index jamais parcourus + 11 Mo sur une table vide | cache dilué, écritures ralenties | **< 1 j** | `[MESURE]` `idx_scan = 0` |
| 9 | 109 défauts de RLS dormants (`initplan` + policies multiples) | bloquant **si** la clé `anon` est branchée | 2-3 j | `[MESURE]` advisors |
| 10 | Clustering non cloisonné par organisation (13 routes) | fuite inter-clients | 2-3 j | `[MESURE]` aucune colonne org |

### 7.2 Gains de moins d'une journée

Détail et ordre d'exécution dans [`QUICK_WINS.md`](./QUICK_WINS.md). En résumé :

| Action | Gain chiffré attendu |
|---|---|
| `s-maxage=604800` sur `/api/tiles/…` + sortir du cookie | tuile vue par le 2ᵉ utilisateur : **750 ms → ~0 ms de base**. Plafond : **2-4 → 60-120** `[CALCULE]` |
| `Content-Encoding: gzip` sur `/api/tiles/…` | salve : **3,56 Mo → ~0,89 Mo** `[CALCULE]`, ratio 4:1 `[HYPOTHESE]` |
| `ANALYZE poi_france, carreaux_filosofi, iris` | estimation `rows=1` → réelle ; plans de jointure corrects |
| `MAX_CACHE` 1 000 → 200, et purge par ancienneté d'**usage** | RSS **297 Mo → 59 Mo** `[CALCULE]` |
| `DROP` des 12 index morts > 1 Mo | **−236 Mo**, écritures allégées |

### 7.3 Ce qu'il ne faut PAS optimiser maintenant

- **Le pooling Postgres.** L'application n'ouvre pas de connexion : tout passe
  par PostgREST. Régler Supavisor n'aurait aucun effet sur le chemin
  applicatif. `[MESURE]`
- **`carreaux_filosofi` (4,6 Go, 67,5 % de la base).** Les cascades
  d'agrégation (20/5/2/1 km, 200 m) l'ont déjà sortie du chemin chaud : elle
  n'est plus lue qu'au palier 200 m, à z ≥ 12. La normaliser ou la typer serait
  un chantier de plusieurs semaines pour un gain qui appartient déjà aux
  cascades.
- **Les 169 Mo d'index morts de `comptages_routiers`** — *si* et seulement si
  une fonctionnalité TMJA en préparation les attend. `idx_scan = 0` prouve
  qu'ils ne servent pas, **pas** qu'ils ne serviront jamais. Vérifier avant de
  supprimer ; sinon les supprimer avec les autres.
- **Le réplica de lecture, le CDN de tuiles pré-calculées, la file d'attente.**
  Ce sont les correctifs du palier 500. Les construire pour 5 utilisateurs
  réels serait de la sur-ingénierie — et ils deviennent en partie inutiles une
  fois le cache CDN posé.
- **Passer à un compute supérieur tout de suite.** Ce serait payer pour porter
  un défaut de cache. Faire les quick wins **d'abord**, remesurer, décider
  ensuite.

### 7.4 Les trois métriques à instrumenter en continu

1. **`X-Tile-Cache` et `x-vercel-cache` sur `/api/tiles/…`** — le taux de MISS
   est l'indicateur avancé de tout le reste. Il monte avant que quiconque se
   plaigne.
2. **`shared_blks_read` de `get_tile`, échantillonné toutes les heures** depuis
   `pg_stat_statements`. La dérivée de cette valeur, c'est la consommation du
   budget E/S. Un seuil d'alerte à `250 E/S/s × 70 %` donne la marge restante.
3. **Latence p95 de `/api/auth` et profondeur de file de GoTrue.** C'est le
   canari du 28/03 : Auth tombe **parce que** le disque est saturé, et c'est le
   symptôme que l'utilisateur voit en premier (déconnexion, 504), avant même
   de constater que la carte est lente.

Les trois se lisent sans instrumentation nouvelle côté base : `curl -I` pour la
première, `pg_stat_statements` pour la deuxième. Seule la troisième demande
l'activation des Log Drains ou de Vercel Analytics.

---

## Question à laquelle cet audit n'a pas pu répondre

**Le plafond d'E/S est-il réellement de 250 IOPS ?**

Toute la PHASE 4 en dépend : c'est la ressource qui casse en premier, et sa
capacité est la seule grandeur de premier plan que je n'ai pas pu mesurer. Le
chiffre vient de `CLAUDE.md` ; or les réglages Postgres relevés
(`shared_buffers` 256 Mo, `effective_cache_size` 768 Mo, ≈ 1 Go de RAM)
correspondent au palier **Micro**, pas au palier **Nano** que la documentation
nomme. Si le volume a suivi, le plafond réel peut être plusieurs fois supérieur
— et le seuil de 2,2 utilisateurs devient 10, ou 30.

**Non lisible en SQL.** À relever dans Supabase → Settings → Compute and Disk
(taille du disque, type de volume, IOPS provisionnées), puis à réinjecter dans
`SCALE_MODEL.md` §1. C'est la première chose à faire avant d'agir sur ce
rapport — pas parce que les correctifs changeraient (ils sont bons dans tous
les cas), mais parce que **l'urgence, elle, en dépend entièrement**.

---

## Vérification de l'audit

```
git diff --stat   →   docs/audit/ uniquement
```

Aucun fichier applicatif, aucune migration, aucun `apply_migration`. Les seules
requêtes exécutées en base sont des lectures de catalogue, un `EXPLAIN` sans
`ANALYZE`, et huit appels de tuiles chronométrés — soit l'équivalent en E/S de
**deux mouvements de carte**.
