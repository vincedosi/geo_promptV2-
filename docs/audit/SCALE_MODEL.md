# SCALE_MODEL — le calcul isolé

> Audit du 2026-09-13. Ce fichier ne raconte rien : il ne contient que les
> **paramètres d'entrée** et les **formules**. Changer une hypothèse en tête de
> fichier et refaire les divisions suffit à rejouer tous les seuils du rapport.
>
> Étiquettes : `[MESURE]` = sortie d'une commande, d'un log ou d'un catalogue
> Postgres · `[CALCULE]` = dérivé de mesures, formule affichée · `[HYPOTHESE]` =
> valeur assumée, fourchette donnée.

---

## 1. Capacité de la plateforme

| Paramètre | Valeur | Étiquette | Source |
|---|---|---|---|
| `PG_VERSION` | 17.6.1.063 | `[MESURE]` | `get_project` / `current_setting('server_version')` |
| `MAX_CONNECTIONS` | 60 | `[MESURE]` | `current_setting('max_connections')` |
| `SHARED_BUFFERS` | 256 Mo | `[MESURE]` | `current_setting('shared_buffers')` |
| `EFFECTIVE_CACHE_SIZE` | 768 Mo | `[MESURE]` | `current_setting('effective_cache_size')` |
| `RAM_COMPUTE` | ≈ 1 Go | `[CALCULE]` | `EFFECTIVE_CACHE_SIZE / 0,75` — convention Supabase |
| `VCPU` | 2 (partagés) | `[HYPOTHESE]` | palier Supabase cohérent avec les trois lignes ci-dessus ; non lisible en SQL |
| `AUTH_CONNEXIONS` | **10** | `[MESURE]` | advisor `auth_db_connections_absolute` |
| `POSTGREST_POOL` | ≤ 41, valeur réelle inconnue | `[HYPOTHESE]` | `MAX_CONNECTIONS − AUTH_CONNEXIONS − réserve admin/supavisor ≈ 9`. **Non mesurable en l'état** : le réglage vit dans `PGRST_DB_POOL`, hors SQL. Mesure : saturer puis `SELECT count(*) FROM pg_stat_activity WHERE application_name='postgrest'` |
| `IOPS_DISQUE` | 250 | `[HYPOTHESE]` | valeur écrite dans `CLAUDE.md`. **Non vérifiable depuis la base** ; voir §6 du rapport, elle est peut-être périmée |
| `DEBIT_DISQUE` | 5 Mo/s | `[HYPOTHESE]` | valeur écrite dans `CLAUDE.md`. **Contredite par la mesure ci-dessous** |
| `DEBIT_SEQ_MESURE` | **≈ 195 Mo/s** | `[MESURE]` | 2026-09-13, `EXPLAIN (ANALYZE, BUFFERS)` d'un `max(created_at)` sur `comptages_routiers` : `shared read=44505` blocs, soit 348 Mo, en **1 785 ms**. Lecture séquentielle, pages absentes du cache partagé |
| `BLOC_PG` | 8 Kio | `[MESURE]` | constante Postgres |
| `IOPS_EQ_MO` | 2,0 Mo/s | `[CALCULE]` | `IOPS_DISQUE × BLOC_PG` — le plafond **aléatoire** est donc sous le plafond séquentiel annoncé |
| `TAILLE_BASE` | 6 863 Mo | `[MESURE]` | `pg_database_size` |
| `VERCEL_CONCURRENCE` | 1 000 invocations | `[HYPOTHESE]` | défaut plan Pro ; jamais atteint ici (voir §3) |

> ### ⚠ Le débit disque assumé est 39 fois inférieur au débit mesuré
>
> Toute la doctrine d'E/S du projet (`CLAUDE.md`, section ⛔) repose sur
> « 5 Mo/s soutenus ». Une lecture séquentielle de 348 Mo a été chronométrée à
> **195 Mo/s** le 2026-09-13.
>
> **Ce que cela ne prouve PAS**, et il faut le dire avant d'en tirer quoi que ce
> soit : une mesure unique ne distingue pas un débit soutenu d'une rafale sur
> crédits de burst, ni d'un cache de page côté hôte. Les incidents du 28/03 et
> du 08/04 ont bien eu lieu, et ils ont bien saturé quelque chose.
>
> **Ce que cela impose :** ne pas continuer à traiter « 5 Mo/s » comme un fait.
> Soit la valeur est périmée — le palier a pu changer depuis février — soit elle
> décrivait le débit **aléatoire**, pas séquentiel, et les deux ne se confondent
> pas. Tant que l'arbitrage n'est pas fait, les seuils de ce modèle sont des
> bornes basses, pas des prédictions.
>
> Mesure qui tranchera, et qui n'est pas faisable en SQL : relever le palier de
> calcul et l'IOPS provisionnée dans Supabase → Settings → Compute and Disk.
> C'est le point 0 de `QUICK_WINS.md`, et il reste ouvert pour cette raison.

---

## 2. Coûts unitaires mesurés

Tous mesurés le 2026-09-13 sur la base de production, cache chaud, par
`clock_timestamp()` encadrant l'appel. `[MESURE]`.

### 2.1 Tuiles carreaux — `get_tile(z,x,y)`

| z | ms | octets bruts | palier servi |
|---|---|---|---|
| 4 | 199 | 413 321 | 20 km |
| 7 | 543 | 355 499 | 5 km |
| 9 | **750** | 361 679 | 1 km |
| 12 | 239 | 57 737 | 200 m |

`MS_TUILE_CARREAUX` — moyenne des quatre : **433 ms** · pire cas **750 ms** (z9).
`OCTETS_TUILE_CARREAUX` — moyenne des quatre : **297 059 o**.

### 2.2 Tuiles IRIS — `get_iris_tile(z,x,y)`

| z | ms | octets bruts | palier servi |
|---|---|---|---|
| 4 | 449 | 101 368 | département |
| 7 | 245 | 489 045 | commune |
| 9 | 327 | 53 554 | IRIS |
| 11 | 4 | 8 034 | IRIS |

`MS_TUILE_IRIS` — moyenne : **256 ms**.

### 2.3 Coût disque d'une tuile carreaux

| Grandeur | Valeur | Étiquette |
|---|---|---|
| `BLOCS_LUS_get_tile` | 658 124 | `[MESURE]` `pg_stat_statements.shared_blks_read` |
| `APPELS_get_tile` | 6 519 | `[MESURE]` |
| `BLOCS_PAR_TUILE` | **101** | `[CALCULE]` `658 124 / 6 519` |
| `KO_DISQUE_PAR_TUILE` | **808 Ko** | `[CALCULE]` `101 × 8 Kio` |

### 2.4 Autres appels lourds, moyenne sur la fenêtre de 147,9 jours

`[MESURE]`, `pg_stat_statements`. Ces moyennes couvrent **aussi la période
antérieure aux cascades d'agrégation** (sql/129 le 2026-09-11, sql/138-140 le
2026-09-12) : elles décrivent l'historique, pas le coût d'aujourd'hui.

| RPC | appels | ms moyen | ms max |
|---|---|---|---|
| `get_tile` | 6 519 | 6 214,3 | 119 967 |
| `get_digital_campaign_map` (v1, supprimée) | 301 | 12 655,9 | 95 084 |
| `get_digital_campaigns_list` | 1 549 | 1 386,6 | 31 382 |
| `get_tmja_tile` | 1 311 | 723,8 | 17 991 |
| `calculate_coverage_per_group` | 381 | 2 332,8 | 92 880 |
| `get_voronoi_by_category` | 4 | **79 718,3** | 108 555 |
| `get_carreaux_capture_geometry` | 5 | 48 249,8 | 68 776 |
| `fill_carreaux_1km_bande` | 17 | 35 708,8 | 69 103 |
| `get_dsp_campaign_stats` | 277 | 419,7 | — |
| `clip_geojson_to_france` | 674 | 359,9 | 2 359 |

---

## 3. Profil d'usage — le « planner »

Toutes ces valeurs sont des `[HYPOTHESE]`. **Aucune n'est observée** : les logs
d'exécution Vercel de production sur 7 jours contiennent **zéro entrée**
`[MESURE]`. Le modèle ci-dessous décrit un usage plausible, pas un usage constaté.

| Paramètre | Valeur retenue | Fourchette | Commentaire |
|---|---|---|---|
| `SESSIONS_JOUR` | 2 | 1 – 4 | un media planner ouvre la carte le matin et l'après-midi |
| `MIN_SESSION` | 25 | 10 – 60 | |
| `PANS_SESSION` | 20 | 8 – 60 | un « pan » = tout mouvement qui déclenche une salve de tuiles |
| `INTERVALLE_PAN` | 75 s | 15 – 180 s | `[CALCULE]` `MIN_SESSION × 60 / PANS_SESSION` |
| `TUILES_PAR_PAN` | 12 | 9 – 20 | écran 1920×1080, tuiles vectorielles 512 px : `(⌈1920/512⌉+1) × (⌈1080/512⌉+1)` = 5 × 4 = 20 au pire, 12 en pratique |
| `COUCHES_ACTIVES` | 1 | 1 – 3 | **règle produit** : un seul dégradé à la fois (`lib/carte/degrades.ts`). Sans cette règle, ce paramètre vaudrait 6 |
| `ANALYSES_SESSION` | 1 | 0 – 4 | score / corrélation / bataille / clustering |
| `IMPORTS_SESSION` | 0,2 | 0 – 1 | |
| `PROMPTS_IA_SESSION` | 4 | 0 – 20 | |
| `TAUX_CONCURRENCE` | 8 % | 3 – 15 % | part des inscrits simultanément actifs à la pointe |
| `RATIO_GZIP_MVT` | 4:1 | 3 – 5 | compression d'un MVT ; **non mesuré ici** |

---

## 4. Coût d'un utilisateur actif

### 4.1 Par salve de tuiles (un « pan »)

```
MS_DB_PAR_PAN      = TUILES_PAR_PAN × MS_TUILE_CARREAUX
                   = 12 × 750 (z9, pire cas)      = 9 000 ms
                   = 12 × 433 (moyenne des 4 z)   = 5 196 ms   ← retenu

IOPS_PAR_PAN       = TUILES_PAR_PAN × BLOCS_PAR_TUILE
                   = 12 × 101                     = 1 212 E/S

OCTETS_PAR_PAN     = TUILES_PAR_PAN × OCTETS_TUILE_CARREAUX
                   = 12 × 297 059                 = 3,56 Mo bruts
                   ÷ RATIO_GZIP_MVT               = 0,89 Mo si compressé
```

> ⚠ **La route carreaux ne compresse pas** (`[MESURE]`, §5.1 du rapport) : la
> valeur qui part sur le réseau est **3,56 Mo**, pas 0,89 Mo.

### 4.2 Par heure d'utilisateur actif

```
PANS_HEURE         = 3 600 / INTERVALLE_PAN        = 48
MS_DB_HEURE        = PANS_HEURE × MS_DB_PAR_PAN
                   = 48 × 5 196                    = 249 408 ms = 249 s
CHARGE_VCPU        = MS_DB_HEURE / 3 600 000       = 0,069 vCPU
IOPS_MOYEN         = PANS_HEURE × IOPS_PAR_PAN / 3 600
                   = 48 × 1 212 / 3 600            = 16,2 E/S par seconde
MO_HEURE           = PANS_HEURE × 3,56             = 171 Mo
```

En **exploration active** (`INTERVALLE_PAN = 15 s`, soit `PANS_HEURE = 240`) :

```
CHARGE_VCPU        = 0,346 vCPU
IOPS_MOYEN         = 80,8 E/S par seconde
MO_HEURE           = 854 Mo
```

---

## 5. Seuils de saturation

`UTILISATION_CIBLE = 70 %` `[HYPOTHESE]` — au-delà, les files d'attente
Postgres rendent la latence non linéaire.

```
SEUIL(ressource) = CAPACITE × UTILISATION_CIBLE / CONSO_PAR_UTILISATEUR
```

| Ressource | Capacité | Conso / utilisateur actif | Seuil (navigation) | Seuil (exploration) |
|---|---|---|---|---|
| CPU base | 2 vCPU | 0,069 / 0,346 vCPU | **20** | **4,0** |
| E/S disque | 250 E/S/s | 16,2 / 80,8 E/S/s | **10,8** | **2,2** |
| Débit disque | 5 Mo/s | 808 Ko × 48/3600 = 10,8 Ko/s … 53,9 Ko/s | 333 | 66 |
| Connexions Auth | 10 | 1 `getUser()` par navigation de page | voir §5.1 | |
| Pool PostgREST | ≤ 41 | 12 requêtes simultanées par salve | **≈ 3 salves simultanées** | idem |
| Bande passante | non plafonnée (facturée) | 171 / 854 Mo par heure | — | — |

> **Le disque casse en premier, et de loin.** 10,8 utilisateurs en navigation
> tranquille, **2,2 en exploration**. Le CPU suit à 20 et 4, soit un facteur
> 1,8 seulement — les deux tombent quasi ensemble, ce qui est cohérent : sur ce
> profil, le temps CPU de `get_tile` EST majoritairement de l'attente disque.
> Le débit séquentiel (333 / 66) et le pool PostgREST sont trente fois plus
> lâches et ne seront jamais le premier mur.

### 5.1 Le cas Auth, qui est celui de l'incident du 28/03

```
CAPACITE_AUTH = AUTH_CONNEXIONS / T_REQUETE_AUTH
```

| `T_REQUETE_AUTH` | Régime | Capacité |
|---|---|---|
| 30 ms | disque au repos `[HYPOTHESE]` | 333 auth/s |
| 500 ms | disque chargé `[HYPOTHESE]` | 20 auth/s |
| **2 000 ms** | **budget E/S épuisé** `[HYPOTHESE]` | **5 auth/s** → file d'attente → 504 |

La capacité d'authentification n'est pas une constante : elle est **le
quotient de 10 par une latence disque que la carte contrôle**. C'est pourquoi
un prefetch de tuiles fait tomber le login, et non l'inverse.

---

## 6. Projection de stockage

```
OCTETS_PAR_LIGNE   = 287 Mo / 477 879 lignes       = 630 o   [CALCULE]
LIGNES_PAR_CAMPAGNE = 238 940 (moyenne)                      [MESURE]
MO_PAR_CAMPAGNE    = 238 940 × 630 / 1024²          = 143 Mo [CALCULE]
CAMPAGNES_AN_PAR_ANNONCEUR = 4                               [HYPOTHESE]
```

| Annonceurs | Campagnes/an | Croissance/an | Base après 1 an | Après 3 ans |
|---|---|---|---|---|
| 10 | 40 | 5,6 Go | 12,5 Go | 23,7 Go |
| 50 | 200 | 28,0 Go | 34,9 Go | 91,0 Go |
| 200 | 800 | 112,1 Go | 119,0 Go | 343,2 Go |

Socle incompressible : **6,9 Go**, dont **4,6 Go de `carreaux_filosofi`**
(67,5 % de la base) qui ne grandit avec aucun client.

---

## 7. Quotas externes

| Service | Quota | Étiquette | Conso par unité métier |
|---|---|---|---|
| OpenRouteService | 2 000 req/j, 40/min (palier gratuit) | `[HYPOTHESE]` | `ORS_BATCH_SIZE = 5` POI par appel `[MESURE]` → une bataille sur 100 POI = **20 appels** → plafond **100 batailles/jour** |
| Gemini 2.5 Flash | 15 req/min, 1 500 req/j (palier gratuit) | `[HYPOTHESE]` | 1 prompt = 1 req → `PROMPTS_IA_SESSION × SESSIONS_JOUR` = 8/utilisateur/jour → **187 utilisateurs/jour** |
| Mistral Small | — | `[HYPOTHESE]` | repli du précédent |
| DV360 | 1 500 req/min projet, 700 écritures/min, 300/min par annonceur | `[HYPOTHESE fournie]` | 1 poussée = 1 appel par line item |
| Modal | — | `[HYPOTHESE]` | `/api/bidding/train` seulement |
| PMTiles / GitHub Releases | — | `[MESURE]` | **chemin mort** : jamais atteint la production (dépôt privé → 404 anonyme) |
