# QUICK WINS — liste ordonnée

> Audit du 2026-09-13. Un titre par ligne, prêt à devenir un prompt. Ordre =
> (impact sur le plafond d'utilisateurs) / (effort) — **sauf le point 18**, qui
> ouvre la liste parce qu'il ne s'agit pas de vitesse mais de justesse. Les chiffres sont ceux de
> [`ARCHITECTURE_SCALE_AUDIT.md`](./ARCHITECTURE_SCALE_AUDIT.md) et
> [`SCALE_MODEL.md`](./SCALE_MODEL.md).

---

## Avant tout le reste

**0. Relever l'IOPS réellement provisionnée du volume Supabase — TOUJOURS OUVERT, mais la moitié de la réponse est tombée le 2026-09-13.**

Ce qui est désormais **mesuré** :
- Le compute est **Micro**, pas Nano (`shared_buffers` 256 Mo,
  `effective_cache_size` 768 Mo, ≈ 1 Go de RAM). `CLAUDE.md` et
  `ARCHITECTURE.md` sont corrigés.
- Une lecture **séquentielle** de 348 Mo a été chronométrée à **≈ 195 Mo/s**
  (`EXPLAIN (ANALYZE, BUFFERS)`, `shared read=44505` en 1 785 ms), soit **39
  fois** le « 5 Mo/s » qui fonde toute la doctrine d'E/S du projet.

Ce qui reste **non mesurable en SQL**, et pourquoi la tâche reste ouverte :
l'IOPS provisionnée, et surtout le débit **aléatoire** — lui seul explique les
trois incidents, et une mesure séquentielle ne le dit pas. Une mesure unique ne
distingue pas non plus un débit soutenu d'une rafale sur crédits de burst.

**À faire, et cela prend cinq minutes :** Supabase → Settings → Compute and
Disk, relever le palier et l'IOPS, les reporter dans `SCALE_MODEL.md` §1.
Tant que ce n'est pas fait, les seuils du modèle sont des **bornes basses**, pas
des prédictions — et les interdictions de `CLAUDE.md` restent toutes en vigueur.
· Effort : 5 min · Gain : sait-on de quoi on parle.

---

## Avant même les optimisations : une donnée qui ment

> Numérotée 18 parce que trouvée après l'audit du 2026-09-13, placée ici parce
> que l'ordre du reste de cette liste est celui de l'impact sur le **plafond
> d'utilisateurs**. Ce point-ci ne ralentit personne : il donne des réponses
> fausses. Un chiffre faux se corrige avant un chiffre lent.

**18. Le « flux routier TMJA » n'est du TMJA que pour 1 100 de ses 408 030 lignes — séparer les deux sources, ou cesser de les présenter comme une mesure.**

Mesuré le 2026-09-13 :

| source | lignes | valeurs de trafic distinctes | année de mesure |
|---|---|---|---|
| `tmja_rrn_national` | 1 100 | 857 | 2021 à 2024 |
| `osm_highway_proxy` | 406 930 | **11** | **aucune** (`NULL` partout) |

Les onze valeurs sont 800, 1 500, 3 000, 4 000, 5 000, 7 000, 10 000, 12 000,
15 000, 20 000, 30 000. C'est une **constante par classe de route OSM**, pas une
mesure de trafic. Les deux sources sont stockées dans la même table, servies par
la même RPC et peintes sous le même nom et la même échelle de couleur.

**Le consommateur le plus grave n'est pas la carte, c'est la capture de zone.**
`POST /api/custom-geo/source/tmja` → `get_tmja_capture_geometry` filtre sur
`tmja >= p_min_tmja` et **jamais sur `source`**. Ce que rend un seuil :

| seuil demandé | segments mesurés | segments proxy | part de proxy |
|---:|---:|---:|---:|
| 5 000 | 1 095 | 109 182 | **99,0 %** |
| 10 000 | 1 039 | 54 580 | **98,1 %** |
| 20 000 | 772 | 13 621 | **94,6 %** |
| 30 000 | 521 | 4 306 | **89,2 %** |

Un utilisateur qui demande « les axes à plus de 20 000 véhicules par jour »
obtient une géométrie construite à 94,6 % sur une constante de classe de route.
Cette géométrie devient une zone, la zone part au DSP, et le budget suit.

Second défaut du même ressort : avec onze valeurs seulement, le seuil n'est pas
continu. Demander 21 000 ou 29 000 rend **exactement le même jeu** que demander
30 000. La réglette se présente comme continue et se comporte comme un
sélecteur à onze crans.

**Ce qui n'est PAS touché, vérifié.** `panneaux_affichage.score_flux_routier` et
`flux_routier_tmja` sont **vides sur les 1 434 panneaux** : aucun score de
panneau n'est aujourd'hui bâti sur cette donnée. Le défaut est réel mais son
rayon s'arrête à la carte et à la capture de zone. Ne pas le présenter comme
une contamination du scoring — ce serait remplacer une exagération par une autre.

**Trois issues, à trancher avant de coder :**

1. **Séparer en deux calques nommés.** Le TMJA réel garde son échelle continue ;
   le proxy devient « hiérarchie routière OSM » avec une légende à onze classes,
   catégorielle et non continue. Garde la couverture nationale, supprime la
   confusion. Coût : moyen.
2. **N'exposer que le TMJA mesuré.** Honnête et immédiat, mais 1 100 segments
   pour toute la France, c'est un réseau très maigre à l'écran.
3. **Assumer le proxy sous son vrai nom**, et retirer la capture de zone par
   seuil tant qu'elle ne sait pas distinguer les deux.

**Quelle que soit l'issue, quatre choses à faire :**

- Émettre `source` dans la tuile (`get_tmja_tile` ne la porte pas aujourd'hui,
  le client ne PEUT donc pas distinguer) — et bumper la version de tuile, sinon
  le cache CDN sert l'ancien schéma.
- Ajouter un paramètre de source à `get_tmja_capture_geometry`, avec le proxy
  **exclu par défaut** : le défaut doit être le comportement honnête.
- Reprendre la ligne « Flux routier » de l'onglet Fraîcheur données une fois
  tranché — elle décrit aujourd'hui le problème, elle devra décrire la solution.
- Arbitrer les 701 Mo. C'est la deuxième table du projet, et le point 6 de cette
  liste réserve déjà 169 Mo d'index `comptages_routiers` jamais parcourus. Si
  l'issue 2 est retenue, ce sont **700 Mo qui partent** sur un disque contraint.

· Effort : 0,5 j pour le calque et la tuile, 0,5 j pour la capture de zone ·
Gain : la carte et les zones cessent d'annoncer une mesure là où il n'y en a pas.

**19. Normaliser `poi_france.departement` et remplir `code_departement` — le filtre par département rendait ZÉRO lycée (contourné le 2026-09-13, pas guéri).**

Mesuré sur les 5 862 POI non-transport : la colonne `departement` porte **trois
formats incompatibles** selon l'import qui l'a remplie.

| catégorie | lignes | contenu | exemples |
|---|---:|---|---|
| lycee | 5 584 | **le nom** | `Ain`, `Aisne`, `Allier` |
| bmw | 177 | le code | `13`, `69`, `75` |
| cirfa | 101 | le code, 8 déviants | `20A`, `20B`, `3`, `4` |

`/api/map/pois` cherchait `ilike('departement', '%75%')`. Aucun lycée ne pouvait
donc être trouvé : filtrer sur Paris rendait **0 lycée sur 241**, sans erreur ni
message — et le lycée est la catégorie la plus fournie du sélecteur.
`code_departement`, qui porterait le code proprement, n'est renseignée que sur
**177 lignes sur 5 862**, toutes des bmw : c'est pourquoi
`idx_poi_france_departement`, bâti dessus, n'a jamais servi.

**Contournement posé** (`lib/geo/dept-lookup-server.ts`) : la route interroge
désormais toutes les écritures connues du département demandé, sur les deux
colonnes. Vérifié en conditions réelles — Paris 0 → **241**, Allier **32**
(cas du code non complété), Corse-du-Sud **12** (cas `20A`), département
inexistant **0**, et les bmw restent à **4**, donc aucune régression sur le
format qui marchait déjà. Les quatre chiffres correspondent à la base.

**Ce qui reste à faire, et pourquoi ça n'a pas été fait cette nuit.** Le
contournement fait porter à la requête ce qui devrait être une propriété de la
donnée. La vraie correction est de remplir `code_departement` par jointure
spatiale, puis de filtrer dessus seulement. Coût mesuré : 2 000 points joints en
**525 ms** via `idx_ref_communes_geom`, soit ~1,5 s pour les 5 862 POI concernés
— négligeable. **Le piège est ailleurs** : validée contre les bmw, qui portent
déjà les deux colonnes, la jointure `ST_Contains` concorde sur **167 sur 178**
et rend NULL sur 11. Les points non appariés sont hors polygone (littoral,
Monaco, `98`). Une reprise sans repli sur le département le plus proche
créerait donc des NULL là où une valeur existait. C'est cette règle de repli
qui reste à décider, pas le calcul.

**À ne pas confondre avec les 285 015 arrêts de transport**, dont `region`,
`departement`, `code_departement` ET `ville` sont TOUS nuls. Ceux-là ne sont pas
affectés : ils ne sont pas servis par cette route — ils sont exclus du catalogue
de catégories à dessein, et `/api/map/transport` les sert par bbox seule.
· Effort : 0,5 j, dont l'essentiel pour trancher le repli · Gain : la donnée
cesse de dépendre de la requête qui la lit.

---

---

## Moins d'une journée

**1. ~~Poser `s-maxage=604800` sur `/api/tiles/[z]/[x]/[y]`~~ — FAIT le 2026-09-13.**
L'en-tête valait `public, max-age=3600`, sans aucune directive CDN. Il vaut
désormais `public, max-age=86400, s-maxage=604800, immutable` — `immutable` est
sûr parce que la réponse est versionnée par `?v=`.
⚠ Le gain reste **partiel tant que le point 2 n'est pas fait** : un CDN ne
mutualise pas une réponse authentifiée.

**2. Sortir `/api/tiles/**` du cookie de session pour que le CDN puisse vraiment mutualiser.**
Sans cela, le point 1 ne sert qu'à moitié : un CDN ne partage pas une réponse
authentifiée entre visiteurs. Les tuiles ne portent aucune donnée client — ce
sont des agrégats INSEE publics. Option la moins risquée : un jeton de tuile
signé, à courte durée, dans l'URL, plutôt qu'un retrait pur et simple du
middleware.
· Effort : 0,5 j · Gain : **plafond 2-4 → 60-120 utilisateurs simultanés**,
combiné au point 1. C'est le plus gros gain de toute la liste.

**3. ~~Compresser les tuiles carreaux~~ — FAIT le 2026-09-13.**
`gzipSync` au stockage, `Content-Encoding: gzip` et `Vary: Accept-Encoding` à la
sortie, dégzippage à la volée pour le client qui n'accepte pas l'encodage — même
patron que `/api/tiles/iris`.
**Gain RÉEL mesuré, et il est deux fois plus petit qu'annoncé ici :** la tuile
z9/253/176 passe de 200 841 à **103 439 octets sur le fil, soit 1,94x**, pas les
4x que laissait entendre « 3,56 Mo → 0,89 Mo ». Le MVT est du protobuf, déjà
compact : il ne se comprime pas comme du texte. Vérifié de bout en bout, la
couche carreaux s'affiche sur toute la France au palier 20 km.

**4. ~~Lancer `ANALYZE` sur `poi_france`, `carreaux_filosofi` et `iris`~~ — SANS OBJET, la prémisse était fausse (vérifié le 2026-09-13).**
L'audit lisait `pg_stat_user_tables.n_live_tup`, qui vaut bien 0 sur ces trois
tables. Mais **ce n'est pas ce que lit le planificateur** : lui lit
`pg_class.reltuples`, et il y trouve les bons chiffres — 290 877 pour
`poi_france`, 2 298 582 pour `carreaux_filosofi`, 49 448 pour `iris`. Les deux
compteurs ont été confondus.

Les statistiques de colonnes existent et sont **exactes**, contre-vérifiées
sur les données : `poi_france.categorie` annonce 4 valeurs distinctes, il y en a
4 ; `ville` annonce 97,92 % de nuls, il y en a 97,98 %.

Le seul manque réel est `carreaux_filosofi.geom_centroid`, seule colonne sans
statistiques. Son index GiST n'a été parcouru que **6 fois** : un `ANALYZE`
ciblé coûterait environ 234 Mo de lectures aléatoires pour un gain nul. **Ne pas
le faire.**

**5. ~~Ramener le cache mémoire de tuiles à 200 entrées et purger par usage~~ — FAIT le 2026-09-13, autrement et mieux.**
`lib/tiles/cache-lru.ts`, partagé par les **trois** routes de tuiles, qui
portaient toutes la même copie du même défaut.
Deux écarts assumés avec la consigne d'origine :
- **Borne en OCTETS, pas en entrées.** Une tuile pèse de 101 ko à 827 ko : un
  plafond en nombre d'entrées ne borne pas la mémoire. Budget 24 Mo par route.
- **LRU réel.** `Map.keys()` rend l'ordre d'INSERTION ; la purge évinçait donc
  une tuile très demandée avant une tuile vue une fois. Une lecture remet
  désormais l'entrée en queue.
8 tests verrouillent les deux comportements.

**6. Supprimer les index jamais parcourus — 3 SUPPRIMÉS le 2026-09-13 (sql/163, −34 Mo), 8 conservés avec motif, 192 Mo encore en jeu.**

**Préalable qui valide tout le reste : `pg_stat_database.stats_reset` vaut
NULL.** Les compteurs courent depuis la création de la base (février 2026), donc
`idx_scan = 0` signifie vraiment « jamais parcouru ». Sans cette vérification, le
raisonnement entier serait nul — c'est la première chose à refaire si quelqu'un
reprend ce point.

Supprimés, avec preuve :
- `idx_poi_france_geom_geography_gist` (23 Mo) — aucune requête du dépôt
  n'interroge `poi_france` en `geography`.
- `idx_bds_metrics_gin` (5,6 Mo) — la table `bidding_daily_state` est vide MAIS
  a de vrais lecteurs, donc « vide » ne suffisait pas. Ce qui conclut : ces
  lecteurs sélectionnent `metrics` et filtrent sur `strategy_id`, sans jamais
  descendre DANS le jsonb. Un GIN serait inutile même la table remplie.
- `idx_dsp_data_impressions` (5 Mo) — les trois `ORDER BY impressions DESC` du
  dépôt portent sur le résultat d'une agrégation, pas sur les lignes de la
  table.

Conservés, avec motif :
- Les trois de `comptages_routiers` (**169 Mo, l'essentiel du gain**) attendent
  l'arbitrage du **point 18** : si le proxy OSM disparaît, c'est la table
  entière qui part. Les supprimer maintenant trancherait par la bande une
  décision produit qui n'est pas prise.
- `idx_poi_france_geom` (14 Mo) — **le point 7 en aura besoin.** Son jumeau
  partiel `idx_poi_france_geom_cat` ne couvre que `categorie IS NOT NULL`, et le
  planificateur ne peut s'en servir que si la requête porte ce prédicat : la
  route rend la catégorie facultative. Les deux ne sont pas redondants.
- `idx_poi_france_organization` (3,1 Mo) — le **point 10** filtrera dessus.
- `idx_iris_centroid`, `idx_ref_communes_geom`, `idx_emetteurs_freq` — moins de
  2 Mo chacun sur des tables de travail actif : le gain ne paie pas le risque.

---

## Un à trois jours

**7. Faire passer le filtre bbox de `/api/map/pois` par l'index spatial — LE COUPABLE EST L'`ORDER BY id`, pas les comparaisons `lat`/`lng` (mesuré le 2026-09-13).**

Le diagnostic d'origine était incomplet, et le corriger change la solution.
Trois plans mesurés sur la même bbox (Île-de-France) et la même catégorie
(`arret_transport`, 285 015 des 290 877 POI) :

| requête | index choisi | blocs touchés | temps |
|---|---|---:|---:|
| `lat/lng` + `ORDER BY id LIMIT 1000` | `poi_france_pkey` | 10 993 | 4 485 ms |
| `geom &&` + `ORDER BY id LIMIT 1000` | `poi_france_pkey` | 10 986 | — |
| `geom &&` **sans `ORDER BY`**, `LIMIT 1000` | `idx_poi_france_geom_cat` | **1 005** | — |

**Remplacer `lat`/`lng` par `&&` ne suffit PAS.** Tant que `ORDER BY id LIMIT`
est là, le planificateur préfère parcourir la clé primaire dans l'ordre des id
et appliquer la géométrie en `Filter` : il écarte **9 931 lignes pour en trouver
1 000**. Sans le tri, le même prédicat devient un `Index Cond` et n'écarte plus
que 25 lignes. **10,9x moins de blocs.**

L'`ORDER BY id` est là pour rendre la pagination par `range()` stable. La
correction est donc structurelle, pas un remplacement de prédicat :

- Une RPC qui prend la bbox, la catégorie, les natures et les ids de source,
  applique `geom && ST_MakeEnvelope(...)`, et rend **tout le jeu en une fois**
  sous un plafond — au lieu de dix allers-retours paginés de 1 000 lignes.
- Le plafond existe déjà côté route (10 000, ou 4 000 pour une ville) : une
  seule requête bornée rend le même résultat.

⚠ **Le piège à ne pas sous-estimer.** La bbox n'est envoyée QUE si un filtre
carte est actif, donc elle arrive presque toujours COMBINÉE à un département,
une région ou une ville. Les quatre branches de la route doivent être portées
ensemble, sinon le cas courant n'est pas couvert. C'est ce qui rend cette tâche
irréductible à un correctif d'une ligne, et ce qui justifie ses 1-2 jours.

L'index nécessaire **existe déjà** : `idx_poi_france_geom_cat` (GiST partiel,
`WHERE categorie IS NOT NULL`), aujourd'hui à zéro parcours. Rien à créer.
· Effort : 1-2 j · Gain : deuxième poste de lecture disque du projet (77 Go).

**8. ~~Remonter le filtre « par région » dans SQL~~ — FAIT le 2026-09-13.**

Le chemin région ne posait **aucun** prédicat géographique : dix pages de 1 000
lignes en `ORDER BY id`, puis un filtre JavaScript sur le nom normalisé.

**La normalisation JS avait une vraie raison**, qu'il fallait comprendre avant
de la supprimer : l'Île-de-France est stockée sous **deux orthographes** —
`Ile-de-France` sur 981 POI et `Île-de-France` sur 34. Un `eq` naïf en aurait
perdu une. `ecrituresDeLaRegion` génère donc les variantes en amont, ce qui
garde l'insensibilité aux accents **sans renoncer à l'index**.

Mesure du prédicat SQL : `Index Scan using idx_poi_france_region`, **239 blocs,
1,4 ms** pour les 1 015 POI d'Île-de-France, contre 10 000 lignes transférées
auparavant.

**Ce n'était pas qu'un coût.** Au-delà de 10 000 POI dans une catégorie, le
plafond de pagination tronquait la région **en silence**. Latent aujourd'hui —
seuls les arrêts de transport dépassent ce seuil et ils ne passent pas par cette
route — mais c'était un résultat faux qui attendait son volume.

Le repli DROM est conservé à l'identique, en requête séparée plutôt qu'en `or()`
— les noms de région portent apostrophes et traits d'union
(`Provence-Alpes-Côte d'Azur`), que la syntaxe `or()` de PostgREST demanderait
d'échapper ; les deux jeux se fondent dans la table de dédoublonnage par `id`.

Vérifié en conditions réelles et recoupé avec la base : Île-de-France **981**
(inchangé), PACA **391**, La Réunion **82**, les deux régions ensemble **1 372**
soit exactement la somme, région inexistante **0**.

**9. Mettre bataille, Voronoï et clustering derrière une file d'attente — TOUJOURS VALABLE, mais le Voronoï lui-même a été corrigé le 2026-09-13 (sql/164).**

L'audit concluait « file d'attente » sur la foi de 79 718 ms de moyenne et
6 277 170 blocs. C'était traiter le symptôme : **la fonction était quadratique**.

Pour CHAQUE cellule, un `CROSS JOIN LATERAL` cherchait le POI le plus proche
avec `categorie ILIKE` et `ST_Distance(ST_MakePoint(lng, lat), ...)`. Ces deux
formes interdisent tout index : un **balayage parallèle complet de
`poi_france` par cellule**. Mesure d'une seule itération :

| forme | plan | blocs | temps |
|---|---|---:|---:|
| `ILIKE` + `ST_Distance(ST_MakePoint())` | Parallel Seq Scan | 18 930 | 342,8 ms |
| `= ANY` + `geom <->` | Index Scan | **25** | **0,33 ms** |

**Mais le correctif décisif est ailleurs, et c'est le plus instructif :**
`AS MATERIALIZED` sur la CTE des cellules découpées. Depuis PostgreSQL 12 une
CTE est **inlinée par défaut**, donc `ST_Intersection` était recalculée à chaque
référence à la cellule — trois fois par cellule, à 8,8 ms pièce contre une
frontière de **45 781 sommets**. Sans ce seul mot-clé, les deux correctifs
d'index ne suffisaient pas : la fonction expirait encore sur 95 points.

| catégorie | cellules | avant | après |
|---|---:|---|---:|
| cirfa | 95 | expire au-delà de 30 s | **0,7 s** |
| bmw | 175 | — | **13,3 s** |
| lycee | 4 653 | 80 à 108 s | **31,1 s** |

Correction vérifiée par l'invariant du diagramme : 95 cellules, 95 POI
distincts, et **chaque POI tombe dans sa propre cellule**.

**Pourquoi la file d'attente reste demandée.** Le gain est de 43x sur une petite
catégorie mais de **2,6x seulement** sur les lycées : à 4 653 cellules, le
goulot n'est plus la boucle mais la découpe elle-même, incompressible à
géométrie égale. Le levier suivant serait de simplifier le polygone de découpe,
mais cela change le tracé des côtes à l'écran — arbitrage produit, pas
optimisation neutre. Tant qu'il n'est pas pris, 31 s d'occupation restent 31 s,
et la bataille comme le clustering n'ont pas été touchés.
· Effort restant : 3-5 j pour la file · Gain déjà acquis : le Voronoï ne lit
plus 12 Go par appel.

**10. Cloisonner le clustering par organisation (13 routes `/api/poi-clusters/*`).**
`poi_clusters`, `clustering_models` et `clustering_jobs` n'ont **ni
`organization_id` ni `org_id`**. Le middleware vérifie « authentifié », jamais
« de quelle organisation » : un client de l'organisation A voit les modèles de
l'organisation B et peut en lancer un qui consomme le budget E/S commun.
· Effort : 2-3 j · Gain : bloquant à lever **avant** la première organisation
cliente réelle. Non exploitable aujourd'hui (0 admin, 0 client hors comptes de
test).

**11. Corriger les 109 défauts de RLS dormants avant, et non pendant, le branchement de la clé `anon`.**
55 × `auth_rls_initplan` (`auth.uid()` réévalué **par ligne** — 290 877 appels
de fonction par requête sur `poi_france` ; correctif connu :
`(select auth.uid())`) et 54 × `multiple_permissive_policies` (toutes évaluées,
en `OR`).
· Effort : 2-3 j · Gain : évite que 109 défauts se réveillent le même jour sur
un compute déjà juste.

**12. ~~Clé primaire sur `campaign_dsp_report` et 19 index de clés étrangères~~ — FAIT le 2026-09-13 (sql/162), avec deux écarts assumés.**

**Un index UNIQUE, pas une clé primaire.** Impossible en l'état : `date` est
NULLABLE et vaut NULL sur **2 041 des 2 131 lignes** — c'est le grain « par code
postal », par opposition au grain « par jour ». Une clé primaire refuse les
NULL. Le projet avait déjà résolu ce problème exact sur `dsp_campaign_data`
avec un index d'EXPRESSION où `COALESCE` rend deux NULL égaux
(`idx_dsp_data_unique`) ; même patron, même raison.
`source` fait partie de la clé : les chemins `api` et `simulated` purgent chacun
LEUR source et coexistent légitimement.
Vérifié : 2 131 lignes pour 2 131 clés distinctes avant pose ; la RPC de démo
rejoue sans violation ; un doublon injecté est bien refusé.

**11 index de clés étrangères sur 19, pas 19.** Mesure : les 15 tables
concernées portent **au plus 3 lignes**, et huit sont vides ET sans écrivain
applicatif (`bidding_simulations`, `adaptive_model_state`,
`bidding_drift_events` — voir `ARCHITECTURE.md`). Balayer une table vide est
gratuit : le gain annoncé est nul aujourd'hui. Poser les 19 aurait créé 19 index
à `idx_scan = 0`, c'est-à-dire précisément ce que le point 6 demande de
supprimer.
Les 11 posés réunissent deux conditions : la table parente a une route de
suppression réelle dans l'application, ET la table enfant grossit avec l'usage.
Les 8 autres restent nues **volontairement**, et c'est écrit ici pour que
personne ne prenne cela pour un oubli.

---

## À décider, pas à coder

**13. ~~Trancher la version de PostgreSQL dans `CLAUDE.md` et `ARCHITECTURE.md`~~ — FAIT le 2026-09-13.**
Les deux documents annonçaient 15, la base tourne en **17.6.1.063** : deux
versions majeures d'écart. Corrigé, et le palier de calcul avec — il était
annoncé **Nano**, il est **Micro**.

**14. Trancher l'invariant Adform : le brief annonce 4 campagnes / 294 135 lignes / 172 056 383 tracked_ads, la base contient 1 campagne Adform / 171 729 lignes / 70 844 538 tracked_ads.**
Cause probable et bénigne : la route `/absorb` fusionne un import orphelin puis
**supprime la coquille source** (comportement voulu), plus la reconstruction du
seed de démo (sql/112). Le total toutes campagnes a **augmenté** (477 879
lignes), donc rien ne suggère une perte. Mais **ce n'est pas prouvable sans un
instantané daté** — à confronter à une sauvegarde avant de réécrire
l'invariant.

**15. Décider du sort des trois tables sans RLS : `iris_agg_commune`, `iris_agg_departement`, `spatial_ref_sys`.**
Ce sont des référentiels, pas des données client : aucun risque de fuite
inter-clients. Mais les deux premières sont **écrites par l'application**
(`construire_iris_agg`) et constituent un écart à la convention du projet.

**16. Activer les Log Drains ou Vercel Analytics — sans quoi les p50/p95/p99 par route resteront « non mesurables en l'état ».**
Zéro entrée dans les logs de production sur 7 jours : il n'y a pas de trafic à
percentiler. Tant que cela dure, tout le modèle de charge reste un modèle, et
doit être présenté comme tel.

**17. Instrumenter les trois métriques d'alerte : taux de MISS sur `/api/tiles`, `shared_blks_read` de `get_tile` échantillonné à l'heure, et p95 de l'authentification.**
La troisième est le canari de l'incident du 28/03 : Auth ne tombe pas tout
seul, il tombe **parce que** le disque est saturé — et c'est la déconnexion que
l'utilisateur voit, avant même de remarquer que la carte est lente.
