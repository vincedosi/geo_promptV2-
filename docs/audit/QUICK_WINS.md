# QUICK WINS — liste ordonnée

> Audit du 2026-09-13. Un titre par ligne, prêt à devenir un prompt. Ordre =
> (impact sur le plafond d'utilisateurs) / (effort) — **sauf le point 18**, qui
> ouvre la liste parce qu'il ne s'agit pas de vitesse mais de justesse. Les chiffres sont ceux de
> [`ARCHITECTURE_SCALE_AUDIT.md`](./ARCHITECTURE_SCALE_AUDIT.md) et
> [`SCALE_MODEL.md`](./SCALE_MODEL.md).

---

## Avant tout le reste

**0. Relever l'IOPS réellement provisionnée du volume Supabase et la reporter dans `SCALE_MODEL.md` §1.**
Supabase → Settings → Compute and Disk. Tout le classement ci-dessous suppose
250 E/S/s, chiffre venu de `CLAUDE.md` et **non vérifiable en SQL** ; les
réglages relevés (1 Go de RAM) suggèrent un palier Micro, pas Nano. Les
correctifs restent bons dans tous les cas — seule leur **urgence** en dépend.
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

---

## Moins d'une journée

**1. Poser `s-maxage=604800` sur `/api/tiles/[z]/[x]/[y]`, comme le font déjà les tuiles IRIS et TMJA.**
Aujourd'hui : `public, max-age=3600`, sans directive CDN. La route pèse **77 %
du temps base du projet** (40 510 798 ms sur 6 519 appels).
· Effort : 15 min · Gain : la même tuile vue par un deuxième utilisateur passe
de **750 ms de base à ~0**.

**2. Sortir `/api/tiles/**` du cookie de session pour que le CDN puisse vraiment mutualiser.**
Sans cela, le point 1 ne sert qu'à moitié : un CDN ne partage pas une réponse
authentifiée entre visiteurs. Les tuiles ne portent aucune donnée client — ce
sont des agrégats INSEE publics. Option la moins risquée : un jeton de tuile
signé, à courte durée, dans l'URL, plutôt qu'un retrait pur et simple du
middleware.
· Effort : 0,5 j · Gain : **plafond 2-4 → 60-120 utilisateurs simultanés**,
combiné au point 1. C'est le plus gros gain de toute la liste.

**3. Compresser les tuiles carreaux (`gzipSync` + `Content-Encoding: gzip`), exactement comme `/api/tiles/iris`.**
`CLAUDE.md` déclare le gzip **obligatoire** sur les réponses MVT ; les routes
IRIS et TMJA s'y tiennent, la route carreaux **non**. Au passage : trancher si
la règle est vraie, ou la réécrire.
· Effort : 30 min · Gain : une salve de 12 tuiles passe de **3,56 Mo à ~0,89 Mo**.

**4. Lancer `ANALYZE` sur `poi_france`, `carreaux_filosofi` et `iris`, et vérifier pourquoi l'autovacuum ne les a jamais touchées.**
`last_autoanalyze IS NULL` sur les **trois plus grosses tables du projet**. Le
planificateur estime `rows=1` sur une table de 290 877 lignes : toutes ses
décisions de jointure et de tri sont prises à l'aveugle.
· Effort : 10 min pour l'`ANALYZE`, 1 h pour comprendre l'autovacuum · Gain :
des plans justes, partout, gratuitement.

**5. Ramener le cache mémoire de tuiles de 1 000 à 200 entrées et purger par ancienneté d'usage, pas d'insertion.**
1 000 tuiles × 297 Ko = **297 Mo de RSS** dans une fonction de 1 Go. Et la purge
actuelle supprime les 200 **premières clés insérées** : une tuile très demandée
est évincée avant une tuile vue une seule fois.
· Effort : 1 h · Gain : RSS **297 Mo → 59 Mo**, et un cache qui garde ce qui sert.

**6. Supprimer les 12 index jamais parcourus de plus de 1 Mo (236 Mo), après avoir vérifié qu'aucune fonctionnalité en préparation ne les attend.**
Dont `bidding_daily_state` : **0 ligne, 11 Mo d'index**. Réserve explicite : les
169 Mo de `comptages_routiers` (`geom_geog`, `midpoint_geog`, `midpoint`) ne
doivent partir que si le TMJA ne les attend pas — `idx_scan = 0` prouve qu'ils
ne servent pas, pas qu'ils ne serviront jamais.
· Effort : 0,5 j dont l'essentiel en vérification · Gain : **−236 Mo**, cache
moins dilué, écritures allégées.

---

## Un à trois jours

**7. Faire passer le filtre bbox de `/api/map/pois` par l'index spatial au lieu de quatre comparaisons sur `lat`/`lng`.**
`245 337 466 tuples lus séquentiellement` = **843 balayages complets
équivalents**, pendant que **quatre index GiST sur `geom` affichent zéro
parcours** pour 48 Mo. Le plan montre la bbox en `Filter`, jamais en
`Index Cond`.
· Effort : 1-2 j · Gain : c'est le deuxième poste de lecture disque du projet
(77 Go).

**8. Remonter le filtre « par région » de `/api/map/pois` dans SQL, au lieu de tirer 10 000 lignes et de filtrer en JavaScript.**
Le chemin région ne pose **aucun** prédicat géographique : dix pages de 1 000
lignes en `ORDER BY id`, puis un filtre JS sur le nom de région normalisé.
· Effort : 1 j · Gain : −2,5 Mo de JSON par type de POI, et neuf allers-retours
base en moins.

**9. Mettre bataille, Voronoï et clustering derrière une file d'attente, un calcul à la fois par organisation.**
`get_voronoi_by_category` : **79 718 ms de moyenne**, 108 555 ms au pire, sur
6 277 170 blocs disque. Un seul appel monopolise la base une minute. Deux
utilisateurs qui lancent une bataille en même temps mettent tout le monde à
terre.
· Effort : 3-5 j · Gain : supprime le seul mode de panne où **un** utilisateur
sature la plateforme.

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

**12. Donner une clé primaire à `campaign_dsp_report` et couvrir les 19 clés étrangères sans index.**
Advisors `no_primary_key` et `unindexed_foreign_keys`. `campaign_dsp_report` est
déjà idempotente par DELETE ciblé + INSERT — la PK la rendrait vérifiable.
· Effort : 1 j · Gain : suppressions en cascade et jointures qui cessent de
balayer.

---

## À décider, pas à coder

**13. Trancher la version de PostgreSQL dans `CLAUDE.md` et `ARCHITECTURE.md` : la base tourne en 17.6.1.063, les deux documents annoncent 15.**
Deux versions majeures d'écart. Une doc périmée sur ce point ne se contente pas
d'être inutile : elle fait écarter des outils disponibles et en fait attendre
d'autres qui ont changé de comportement.

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
